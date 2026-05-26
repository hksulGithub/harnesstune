/**
 * harnesstune-agent attach — bridge an interactive command (e.g. `claude`) to the relay.
 *
 * Usage: harnesstune-agent attach -- <command> [args...]
 *
 * Spawns the target command in a real PTY (so TUI / keychain auth works), proxies
 * the user's terminal transparently, and bridges the PTY in both directions to the
 * relay: PTY stdout is batched and POSTed as chat_response reports; to_agent
 * messages from the relay are written into the PTY stdin (visible in the local
 * terminal — no surprise injection).
 *
 * Designed for the case where the user has an interactive Terminal session on a
 * remote Mac and wants to chat with that live Claude Code session from VS Code
 * on another machine via the harnesstune relay.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readConfig } from '../config.js';
import { createClient, type RelayClient } from '../client.js';

const require = createRequire(import.meta.url);

// node-pty is loaded lazily so other subcommands don't pay the native-module cost
type IPty = {
  write: (data: string) => void;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void;
  kill: (signal?: string) => void;
  resize: (cols: number, rows: number) => void;
};

const OUTPUT_FLUSH_MS = 2000;
const POLL_INTERVAL_MS = 10_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

export async function attach(args: string[], opts?: { dryRun?: boolean }): Promise<void> {
  // Parse: everything after `--` is the target command + args
  const sepIdx = args.indexOf('--');
  const target = sepIdx >= 0 ? args.slice(sepIdx + 1) : args;
  if (target.length === 0) {
    console.error('Usage: harnesstune-agent attach -- <command> [args...]');
    console.error('Example: harnesstune-agent attach -- claude');
    process.exit(2);
  }

  const config = readConfig();
  const client = createClient(config.relayUrl, config.token);

  if (opts?.dryRun) {
    console.log('Dry run: config + target validated');
    console.log(`  relay URL:  ${config.relayUrl}`);
    console.log(`  channel ID: ${config.channelId}`);
    console.log(`  target:     ${target.join(' ')}`);
    process.exit(0);
  }

  // Lazy require so other subcommands aren't gated on node-pty being installed
  let pty: { spawn: (cmd: string, args: string[], opts: Record<string, unknown>) => IPty };
  try {
    pty = (await import('node-pty')) as unknown as typeof pty;
  } catch (err) {
    console.error('Error: node-pty is required for the attach subcommand.');
    console.error('Install it: pnpm --filter @harnesstune/agent add node-pty');
    console.error(`Underlying error: ${(err as Error).message}`);
    process.exit(1);
  }

  // Self-heal: Dropbox can strip the execute bit from node-pty's spawn-helper
  // binary during sync, which causes posix_spawnp to fail with a generic
  // "posix_spawnp failed" message. Ensure the spawn-helper is executable.
  ensureNodePtySpawnHelperExecutable();

  const [cmd, ...cmdArgs] = target;
  // node-pty uses posix_spawnp on macOS. Resolve bare command names to absolute
  // paths via $PATH ourselves so the child doesn't depend on the (stripped) PATH
  // inherited by posix_spawn.
  const resolvedCmd = resolveBin(cmd);
  if (!resolvedCmd) {
    console.error(`Error: '${cmd}' not found on PATH.`);
    console.error('Tried:', (process.env.PATH ?? '').split(':').join(', '));
    console.error('Hint: pass an absolute path, e.g. attach -- /opt/homebrew/bin/claude');
    process.exit(127);
  }
  // Augment PATH so /usr/bin/env-style shebang interpreters can find their target.
  const nodeDir = path.dirname(process.execPath);
  const binDir = path.dirname(resolvedCmd);
  const augmentedPath = [binDir, nodeDir, process.env.PATH ?? '']
    .filter(Boolean)
    .join(':');
  const childEnv = { ...process.env, PATH: augmentedPath };

  // macOS posix_spawnp doesn't always honor #!/usr/bin/env <interpreter> shebangs
  // when the interpreter is a separately-managed Node install. Read the shebang
  // ourselves and rewrite the spawn to invoke the interpreter directly with the
  // script as the first argument. This bypasses the kernel's flaky shebang
  // handling entirely.
  const { execCmd, execArgs } = unwrapShebang(resolvedCmd, cmdArgs, nodeDir);

  let ptyProc: IPty;
  try {
    ptyProc = pty.spawn(execCmd, execArgs, {
      name: process.env.TERM ?? 'xterm-256color',
      cols: process.stdout.columns ?? 80,
      rows: process.stdout.rows ?? 24,
      env: childEnv,
      cwd: process.cwd(),
    });
  } catch (err) {
    console.error(`Error: failed to spawn '${execCmd}' (orig '${resolvedCmd}'): ${(err as Error).message}`);
    console.error(`Augmented PATH was: ${augmentedPath}`);
    console.error(`Args: ${JSON.stringify(execArgs)}`);
    process.exit(1);
  }

  // --- File-based debug log (TTY is owned by claude's TUI, console output gets clobbered) ---
  const logPath = path.join(process.cwd(), 'attach.log');
  const dbg = (msg: string) => {
    try {
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
    } catch { /* best-effort */ }
  };
  dbg(`attach starting: cwd=${process.cwd()} target=${JSON.stringify(target)} resolved=${resolvedCmd} execCmd=${execCmd}`);

  let shuttingDown = false;
  let outputBuffer: string[] = [];
  let lastFlushAt = Date.now();
  let lastMessageCursor = new Date().toISOString();

  // --- Send announcement so Mac A can see the agent attached ---
  await postReport(client, config.channelId, 'agent_attached', {
    target: target.join(' '),
    pid: process.pid,
    cwd: process.cwd(),
  });

  // --- PTY output → user's terminal AND relay buffer ---
  ptyProc.onData((data: string) => {
    process.stdout.write(data);
    outputBuffer.push(data);
    // Cap buffer to MAX_OUTPUT_BYTES; trim oldest on overflow
    let total = outputBuffer.reduce((n, s) => n + s.length, 0);
    while (total > MAX_OUTPUT_BYTES && outputBuffer.length > 1) {
      total -= outputBuffer.shift()!.length;
    }
  });

  // --- User's terminal input → PTY ---
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on('data', (chunk) => {
    // Ctrl-] (0x1d) — local escape to detach without killing the PTY child
    // Ctrl-C still passes through to claude as SIGINT (via PTY)
    if (chunk.length === 1 && chunk[0] === 0x1d) {
      console.log('\n[harnesstune-attach] Detaching (PTY child kept running)');
      void gracefulExit(0);
      return;
    }
    ptyProc.write(chunk.toString('utf8'));
  });

  // --- Resize forwarding ---
  process.stdout.on('resize', () => {
    try {
      ptyProc.resize(process.stdout.columns ?? 80, process.stdout.rows ?? 24);
    } catch {
      /* ignore resize on dead PTY */
    }
  });

  // --- Flush output buffer to relay every OUTPUT_FLUSH_MS ---
  const flushTimer = setInterval(() => {
    void flushOutput();
  }, OUTPUT_FLUSH_MS);
  flushTimer.unref();

  async function flushOutput(): Promise<void> {
    if (outputBuffer.length === 0) return;
    const chunk = outputBuffer.join('');
    outputBuffer = [];
    lastFlushAt = Date.now();
    // Strip ANSI escape sequences for readability in the timeline
    const stripped = stripAnsi(chunk);
    if (stripped.trim().length === 0) return;
    await postReport(client, config.channelId, 'chat_response', {
      text: stripped,
      raw: chunk.length !== stripped.length ? chunk : undefined,
      flushedAt: new Date().toISOString(),
    });
  }

  // --- Poll relay for inbound messages → write to PTY stdin ---
  const pollTimer = setInterval(() => {
    void pollMessages();
  }, POLL_INTERVAL_MS);
  pollTimer.unref();

  async function pollMessages(): Promise<void> {
    if (shuttingDown) return;
    dbg(`poll: GET messages since=${lastMessageCursor}`);
    try {
      const res = await client.get(`/api/channels/${config.channelId}/messages`, {
        limit: '50',
        since: lastMessageCursor,
      });
      dbg(`poll: HTTP ${res.status}`);
      if (!res.ok) {
        const errBody = await res.text().catch(() => '<unreadable>');
        dbg(`poll: error body: ${errBody.slice(0, 200)}`);
        return;
      }
      const data = (await res.json()) as { messages: Array<{ id: string; direction: string; body: Record<string, unknown>; createdAt: string }> };
      dbg(`poll: got ${data.messages.length} messages`);
      for (const msg of data.messages) {
        dbg(`  msg id=${msg.id} dir=${msg.direction} body=${JSON.stringify(msg.body).slice(0, 80)}`);
        if (msg.direction === 'to_agent') {
          const text = typeof msg.body.text === 'string' ? msg.body.text : JSON.stringify(msg.body);
          dbg(`  -> writing to PTY: ${text.slice(0, 80)}`);
          process.stdout.write(`\r\n\x1b[33m[remote] ${text}\x1b[0m\r\n`);
          ptyProc.write(text + '\r');
          await client.delete(`/api/channels/${config.channelId}/messages/${msg.id}`).catch(() => undefined);
        }
        lastMessageCursor = msg.createdAt;
      }
    } catch (err) {
      dbg(`poll: caught error: ${(err as Error).message}`);
    }
  }

  // --- Graceful shutdown ---
  async function gracefulExit(code: number): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(flushTimer);
    clearInterval(pollTimer);
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch { /* ignore */ }
    }
    process.stdin.pause();
    await flushOutput().catch(() => undefined);
    await postReport(client, config.channelId, 'agent_detached', {
      exitCode: code,
    }).catch(() => undefined);
    process.exit(code);
  }

  ptyProc.onExit(({ exitCode }) => {
    console.log(`\n[harnesstune-attach] PTY child exited (code ${exitCode})`);
    void gracefulExit(exitCode);
  });

  process.on('SIGTERM', () => {
    try { ptyProc.kill('SIGTERM'); } catch { /* ignore */ }
  });
  process.on('SIGHUP', () => {
    try { ptyProc.kill('SIGHUP'); } catch { /* ignore */ }
  });

  const ptyPid = (ptyProc as unknown as { pid?: number }).pid;
  console.log(`[harnesstune-attach] resolved: ${resolvedCmd}`);
  console.log(`[harnesstune-attach] spawned : ${execCmd} ${JSON.stringify(execArgs)}`);
  console.log(`[harnesstune-attach] child PID: ${ptyPid ?? 'unknown'}`);
  console.log(`[harnesstune-attach] Attached — Ctrl-] to detach`);
}

async function postReport(
  client: RelayClient,
  channelId: string,
  type: string,
  body: Record<string, unknown>,
): Promise<void> {
  const envelope = {
    type,
    body,
    generatedAt: new Date().toISOString(),
    reportId: randomUUID(),
  };
  try {
    await client.post(`/api/channels/${channelId}/reports`, envelope);
  } catch {
    /* swallow — best-effort streaming */
  }
}

// Minimal ANSI escape stripper — handles CSI, OSC, and a few common single-char sequences.
// Good enough to make claude's TUI output readable in the timeline; not exhaustive.
function stripAnsi(s: string): string {
  return s
    // CSI: ESC [ ... letter
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    // OSC: ESC ] ... BEL or ESC \
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    // Single-char escapes
    .replace(/\x1b[@-Z\\-_]/g, '')
    // Carriage returns inside a single line (cursor reset)
    .replace(/\r(?!\n)/g, '');
}

/**
 * Walk up from this file to find node-pty's package dir and ensure spawn-helper
 * has the execute bit set. Dropbox-synced installs frequently lose chmod +x.
 */
function ensureNodePtySpawnHelperExecutable(): void {
  try {
    const ptyPkgPath = require.resolve('node-pty/package.json');
    const ptyDir = path.dirname(ptyPkgPath);
    const helperPath = path.join(ptyDir, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper');
    if (fs.existsSync(helperPath)) {
      const stat = fs.statSync(helperPath);
      if ((stat.mode & 0o111) === 0) {
        fs.chmodSync(helperPath, stat.mode | 0o755);
        console.error(`[harnesstune-attach] chmod +x ${helperPath} (Dropbox stripped exec bit)`);
      }
    }
  } catch {
    /* best-effort; spawn will surface a clear error if helper still unusable */
  }
}

/**
 * If the resolved binary is a #!/usr/bin/env <interp> script, parse the shebang
 * and return an exec spec that invokes the interpreter directly with the script
 * as its first argument. This dodges macOS posix_spawnp's flaky shebang chain
 * handling (the original cause of `posix_spawnp failed` when spawning claude).
 *
 * Falls through to the original spec if the file isn't a script or the shebang
 * can't be parsed cleanly.
 */
function unwrapShebang(
  resolvedCmd: string,
  cmdArgs: string[],
  nodeDir: string,
): { execCmd: string; execArgs: string[] } {
  try {
    const fd = fs.openSync(resolvedCmd, 'r');
    try {
      const buf = Buffer.alloc(256);
      const n = fs.readSync(fd, buf, 0, 256, 0);
      const firstLine = buf.slice(0, n).toString('utf8').split('\n')[0];
      if (!firstLine.startsWith('#!')) {
        return { execCmd: resolvedCmd, execArgs: cmdArgs };
      }
      const shebangBody = firstLine.slice(2).trim();
      const parts = shebangBody.split(/\s+/);
      // Handle '/usr/bin/env <interp> [interp-args...]'
      if (parts[0] === '/usr/bin/env' && parts.length >= 2) {
        const interpName = parts[1];
        // Resolve interpreter. Priority for 'node':
        //   1. node sitting next to the script (matches the version the script
        //      was installed against — critical for nvm/brew-managed installs
        //      where running with a mismatched Node version causes silent crash)
        //   2. first 'node' on PATH (what /usr/bin/env would have done)
        //   3. our own process.execPath as last resort
        let interpPath: string | null = null;
        if (interpName === 'node') {
          const sideBySide = path.join(path.dirname(resolvedCmd), 'node');
          if (fs.existsSync(sideBySide)) {
            interpPath = sideBySide;
          } else {
            interpPath = resolveBin('node') ?? process.execPath;
          }
        } else {
          interpPath = resolveBin(interpName);
        }
        if (interpPath) {
          return { execCmd: interpPath, execArgs: [...parts.slice(2), resolvedCmd, ...cmdArgs] };
        }
      }
      // Direct interpreter path: '#!/usr/local/bin/node'
      if (parts[0].startsWith('/')) {
        if (fs.existsSync(parts[0])) {
          return { execCmd: parts[0], execArgs: [...parts.slice(1), resolvedCmd, ...cmdArgs] };
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* fall through */
  }
  return { execCmd: resolvedCmd, execArgs: cmdArgs };
}

/**
 * Resolve a command name to its absolute path by walking $PATH ourselves.
 * node-pty's posix_spawnp on macOS uses a stripped PATH that doesn't include
 * /opt/homebrew/bin or user-installed Node binaries, so we must resolve before
 * spawning. Returns null if not found. If the command already contains a slash,
 * it's treated as a direct path and only checked for executability.
 */
function resolveBin(cmd: string): string | null {
  if (cmd.includes('/')) {
    try {
      const stat = fs.statSync(cmd);
      if (stat.isFile() && (stat.mode & 0o111)) return cmd;
    } catch {
      /* not found */
    }
    return null;
  }
  const pathDirs = (process.env.PATH ?? '').split(':').filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, cmd);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111)) return candidate;
    } catch {
      /* skip */
    }
  }
  return null;
}
