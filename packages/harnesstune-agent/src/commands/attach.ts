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
import { resolveStrategy } from '../strategies/index.js';

const require = createRequire(import.meta.url);

// node-pty is loaded lazily so other subcommands don't pay the native-module cost
type IPty = {
  write: (data: string) => void;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void;
  kill: (signal?: string) => void;
  resize: (cols: number, rows: number) => void;
};

const POLL_INTERVAL_MS = 10_000;

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

  const [cmd, ...cmdArgsRaw] = target;
  const cmdBasename = path.basename(cmd);
  const strategyOrNull = resolveStrategy(cmdBasename);
  if (!strategyOrNull) {
    console.error(`Error: '${cmdBasename}' is not a supported agent.`);
    console.error('Supported agents: claude, agy');
    console.error('Example: harnesstune-agent attach -- claude');
    process.exit(2);
  }
  // Non-null assertion safe: process.exit(2) above makes this branch unreachable if null
  const strategy = strategyOrNull!;
  // Delegate flag injection to the strategy (e.g. claude injects --permission-mode bypassPermissions)
  const cmdArgs = strategy.injectArgs(cmdArgsRaw);
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
  let lastMessageCursor = new Date().toISOString();

  // --- Send announcement so Mac A can see the agent attached ---
  await postReport(client, config.channelId, 'agent_attached', {
    target: target.join(' '),
    pid: process.pid,
    cwd: process.cwd(),
    agent: strategy.id,
  });

  // --- PTY output → user's terminal (no relay streaming — see JSONL watcher below) ---
  ptyProc.onData((data: string) => {
    process.stdout.write(data);
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

  // --- Find the agent's transcript JSONL file via strategy ---
  const home = process.env.HOME ?? '';
  const transcriptDir = strategy.resolveTranscriptDir({ cwd: process.cwd(), home });
  dbg(`session scope: [${strategy.label}] ${transcriptDir ?? '(dir not yet created)'}`);

  /** Return true if filename should be included per strategy filter. */
  function acceptFile(filename: string): boolean {
    return strategy.transcriptFilenameFilter
      ? strategy.transcriptFilenameFilter(filename)
      : filename.endsWith('.jsonl');
  }

  /**
   * Collect all candidate transcript files under the strategy's transcript dir.
   * For recursive strategies (agy), walks the full subtree. For non-recursive
   * (claude), scans one level deep inside the scoped project subdir.
   */
  function listSessionFiles(): Array<{ p: string; size: number }> {
    const dir = strategy.resolveTranscriptDir({ cwd: process.cwd(), home });
    if (!dir || !fs.existsSync(dir)) return [];
    const out: Array<{ p: string; size: number }> = [];
    if (strategy.recursiveTranscriptSearch) {
      // Recursive walk for agy: brain/<uuid>/.system_generated/logs/transcript.jsonl
      const walk = (d: string) => {
        try {
          for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
              walk(full);
            } else if (entry.isFile() && acceptFile(entry.name)) {
              try { out.push({ p: full, size: fs.statSync(full).size }); } catch { /* skip */ }
            }
          }
        } catch { /* unreadable */ }
      };
      walk(dir);
    } else {
      // Non-recursive: scan one level deep (claude scopes to sanitized-cwd subdir)
      try {
        for (const f of fs.readdirSync(dir)) {
          if (!acceptFile(f)) continue;
          const p = path.join(dir, f);
          try { out.push({ p, size: fs.statSync(p).size }); } catch { /* skip */ }
        }
      } catch { /* unreadable */ }
    }
    return out;
  }

  function findCurrentSessionLog(): string | null {
    const files = listSessionFiles();
    if (files.length === 0) {
      // Dir doesn't exist yet or no matching files — fall back to scanning
      // the parent transcript dir for the most recently modified matching file
      const dir = strategy.resolveTranscriptDir({ cwd: process.cwd(), home });
      if (!dir || !fs.existsSync(dir)) return null;
      return null; // listSessionFiles already covers the dir; nothing to fall back to
    }
    let latest: { p: string; mtime: number } | null = null;
    for (const f of files) {
      try {
        const m = fs.statSync(f.p).mtimeMs;
        if (!latest || m > latest.mtime) latest = { p: f.p, mtime: m };
      } catch { /* skip */ }
    }
    return latest?.p ?? null;
  }

  let sessionLogPath: string | null = findCurrentSessionLog();
  dbg(`session JSONL: ${sessionLogPath ?? '(none yet)'}`);

  /**
   * Wait for Claude's response to land in the JSONL, then return the clean text.
   * Strategy: poll file size every 500ms. Once it has grown AND been stable for
   * 3 seconds, consider the response done. Read newly-appended bytes, parse the
   * JSONL lines, and pull out assistant text content (no thinking / tool_use).
   */
  async function waitForResponseAndExtract(baselineOffset: number): Promise<string> {
    // Snapshot every .jsonl in the scoped project dir at start. Claude may
    // append to the existing session OR rotate to a brand-new file mid-session
    // (newer claude versions do this on certain triggers). Pick the one that
    // grew the most during the wait — that's the active write target.
    const initialFiles = listSessionFiles();
    const initialPath = findCurrentSessionLog();
    dbg(`  wait: scoped to ${transcriptDir ?? '(not yet created)'} (${initialFiles.length} jsonl files, latest=${initialPath ? path.basename(initialPath) : 'none'})`);

    const startedAt = Date.now();
    // Strategies with hasFinalResponse may sit through a multi-minute brew
    // install or git clone — give them up to 30 minutes. Stability-only
    // strategies keep the original 5-minute cap so a stalled tool doesn't
    // pin the watcher forever.
    const TIMEOUT_MS = strategy.hasFinalResponse ? 30 * 60 * 1000 : 5 * 60 * 1000;
    // Per-strategy stability window. claude is fast and atomic (3s default);
    // agy does multi-step tool use with long inter-call pauses (overrides to 30s).
    const STABLE_MS = strategy.stableMs ?? 3000;
    let lastHeartbeatLog = Date.now();
    dbg(`  wait: stability window=${STABLE_MS}ms (strategy=${strategy.label}, semanticEndDetector=${!!strategy.hasFinalResponse})`);

    // sizes[path] = last observed size; updated each tick
    const sizes = new Map<string, number>();
    for (const f of initialFiles) sizes.set(f.p, f.size);
    if (initialPath && !sizes.has(initialPath)) {
      try { sizes.set(initialPath, fs.statSync(initialPath).size); } catch { /* */ }
    }

    let stableAt = 0;
    let activePath: string | null = null;
    let activeStartSize = 0;
    let activeLastSize = 0;

    while (Date.now() - startedAt < TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, 500));

      // Rescan dir to catch newly-created files
      const current = listSessionFiles();
      let frameGrew = false;
      for (const f of current) {
        const prev = sizes.get(f.p);
        if (prev === undefined) {
          // New file appeared — treat its starting size as 0 so all of it counts as growth
          sizes.set(f.p, 0);
          if (!activePath) {
            activePath = f.p;
            activeStartSize = 0;
            dbg(`  wait: new jsonl appeared: ${path.basename(f.p)}`);
          }
        }
        const prevSize = sizes.get(f.p) ?? 0;
        if (f.size > prevSize) {
          sizes.set(f.p, f.size);
          if (!activePath) {
            activePath = f.p;
            activeStartSize = prevSize;
            dbg(`  wait: detected active file ${path.basename(f.p)} (start=${prevSize})`);
          }
          if (f.p === activePath) {
            activeLastSize = f.size;
            frameGrew = true;
          }
        }
      }

      if (frameGrew) {
        stableAt = 0;
      } else if (activePath && activeLastSize > activeStartSize) {
        if (stableAt === 0) stableAt = Date.now();
        if (Date.now() - stableAt > STABLE_MS) {
          // Stability satisfied — but if the strategy can tell us whether the
          // agent's actual end-of-turn has fired, use that as the real gate.
          // Without this, agy posts a half-finished "I'll check progress soon"
          // reply during a long external wait and gives up before the model
          // writes its real summary.
          if (strategy.hasFinalResponse) {
            try {
              const fd = fs.openSync(activePath, 'r');
              try {
                const buf = Buffer.alloc(activeLastSize - activeStartSize);
                fs.readSync(fd, buf, 0, buf.length, activeStartSize);
                if (strategy.hasFinalResponse(buf)) break;
              } finally { fs.closeSync(fd); }
            } catch { /* fall through and keep waiting */ }
            // Not yet final — reset the stability clock and keep watching.
            // Don't reset activeStartSize, so the next extraction still
            // captures everything since the user's message.
            stableAt = 0;
          } else {
            break;
          }
        }
      }

      // Heartbeat log every 10s so we know the watcher is alive
      if (Date.now() - lastHeartbeatLog > 10_000) {
        const activeBasename = activePath ? path.basename(activePath) : 'none';
        dbg(`  wait: heartbeat — active=${activeBasename} start=${activeStartSize} now=${activeLastSize} (elapsed ${Math.floor((Date.now() - startedAt) / 1000)}s)`);
        lastHeartbeatLog = Date.now();
      }
    }

    if (!activePath || activeLastSize <= activeStartSize) {
      dbg(`  wait: timed out or no growth (elapsed=${Date.now() - startedAt}ms)`);
      return '';
    }

    void baselineOffset; // legacy param kept for signature; we now use per-file deltas
    dbg(`  wait: reading ${path.basename(activePath)} bytes [${activeStartSize}..${activeLastSize})`);
    // Read new bytes and delegate extraction to the strategy
    const fd = fs.openSync(activePath, 'r');
    try {
      const buf = Buffer.alloc(activeLastSize - activeStartSize);
      fs.readSync(fd, buf, 0, buf.length, activeStartSize);
      const result = strategy.extractAssistantText(buf);
      const segmentCount = result ? result.split('\n\n').length : 0;
      dbg(`  wait: extracted ${segmentCount} segment(s) via ${strategy.label}`);
      return result;
    } finally {
      fs.closeSync(fd);
    }
  }

  // --- Poll relay for inbound messages → write to PTY, wait for response, POST clean text ---
  // pausePollUntil = epoch ms; if set, poll cycles bail out early until passed.
  // Lets us honor 429 Retry-After without spamming the relay.
  let pausePollUntil = 0;
  const pollTimer = setInterval(() => {
    void pollMessages();
  }, POLL_INTERVAL_MS);
  pollTimer.unref();

  async function pollMessages(): Promise<void> {
    if (shuttingDown) return;
    if (Date.now() < pausePollUntil) {
      dbg(`poll: paused (rate-limited), ${Math.ceil((pausePollUntil - Date.now()) / 1000)}s remaining`);
      return;
    }
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
        if (res.status === 429) {
          // Parse retryAfter from header or body, default 30s.
          const headerVal = res.headers.get('retry-after');
          let retrySec = headerVal ? parseInt(headerVal, 10) : NaN;
          if (Number.isNaN(retrySec)) {
            try {
              const parsed = JSON.parse(errBody) as { retryAfter?: number };
              if (typeof parsed.retryAfter === 'number') retrySec = parsed.retryAfter;
            } catch { /* ignore */ }
          }
          if (Number.isNaN(retrySec) || retrySec <= 0) retrySec = 30;
          pausePollUntil = Date.now() + (retrySec + 1) * 1000;
          dbg(`poll: rate-limited, pausing ${retrySec + 1}s`);
        }
        return;
      }
      const data = (await res.json()) as { messages: Array<{ id: string; direction: string; body: Record<string, unknown>; createdAt: string }> };
      dbg(`poll: got ${data.messages.length} messages`);
      for (const msg of data.messages) {
        dbg(`  msg id=${msg.id} dir=${msg.direction} body=${JSON.stringify(msg.body).slice(0, 80)}`);
        if (msg.direction === 'to_agent') {
          const text = typeof msg.body.text === 'string' ? msg.body.text : JSON.stringify(msg.body);
          // Capture baseline file size BEFORE injecting (so we read only Claude's reply)
          const currentPath = findCurrentSessionLog();
          const baseline = currentPath ? (() => { try { return fs.statSync(currentPath).size; } catch { return 0; } })() : 0;
          if (currentPath) sessionLogPath = currentPath;
          dbg(`  -> writing to PTY: ${text.slice(0, 80)} (baseline offset=${baseline})`);
          process.stdout.write(`\r\n\x1b[33m[remote] ${text}\x1b[0m\r\n`);
          ptyProc.write(text + '\r');
          // Don't delete the message — keep it so the client UI shows the
          // full conversation history. The cursor (lastMessageCursor) is
          // advanced below so we won't re-inject it on the next poll.

          // Fire-and-forget the response watcher so subsequent polls aren't blocked
          waitForResponseAndExtract(baseline).then(async (responseText) => {
            if (!responseText.trim()) {
              dbg('  response: empty after extract, not posting');
              return;
            }
            // If we're currently rate-limited, defer the post until the window
            // passes so the response isn't lost to a 429.
            if (Date.now() < pausePollUntil) {
              const wait = pausePollUntil - Date.now();
              dbg(`  response: rate-limit pause active, deferring ${wait}ms`);
              await new Promise(r => setTimeout(r, wait));
            }
            dbg(`  response: posting ${responseText.length} chars`);
            await postReport(client, config.channelId, 'chat_response', {
              text: responseText,
              inReplyTo: msg.id,
              flushedAt: new Date().toISOString(),
            }, dbg);
          }).catch((err) => dbg(`  response: watcher error: ${(err as Error).message}`));
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
    clearInterval(pollTimer);
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch { /* ignore */ }
    }
    process.stdin.pause();
    // Race the agent_detached post against a 3s timeout. Without this, an
    // unreachable relay would hang the await forever and process.exit would
    // never fire — leaving an orphan attach process polling on a stale cursor.
    // Orphans accumulate across redeploys and cause every user message to be
    // answered N times in the UI (one chat_response per surviving attach).
    await Promise.race([
      postReport(client, config.channelId, 'agent_detached', { exitCode: code }).catch(() => undefined),
      new Promise(r => setTimeout(r, 3000)),
    ]);
    process.exit(code);
  }

  ptyProc.onExit(({ exitCode }) => {
    console.log(`\n[harnesstune-attach] PTY child exited (code ${exitCode})`);
    void gracefulExit(exitCode);
  });

  // SIGTERM/SIGHUP: forward to the PTY child (it owns the foreground claude
  // session) AND start gracefulExit on ourselves. Previously we only forwarded
  // to the child, so if claude ignored the signal or took long to die we'd
  // survive — and a subsequent `attach` invocation would create a duplicate
  // poller, causing every UI message to be answered twice.
  function handleTermSignal(sig: 'SIGTERM' | 'SIGHUP'): void {
    try { ptyProc.kill(sig); } catch { /* ignore */ }
    // Give the PTY child a moment to exit cleanly so its ptyProc.onExit fires
    // with the real exit code. If it doesn't, force our own exit at 1s.
    setTimeout(() => { void gracefulExit(sig === 'SIGTERM' ? 143 : 129); }, 1000);
  }
  process.on('SIGTERM', () => handleTermSignal('SIGTERM'));
  process.on('SIGHUP', () => handleTermSignal('SIGHUP'));

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
  dbg?: (msg: string) => void,
): Promise<void> {
  const envelope = {
    type,
    body,
    generatedAt: new Date().toISOString(),
    reportId: randomUUID(),
  };
  // Retry once on 429 — chat_response posts MUST land or the user never sees
  // claude's reply. The relay rate-limits per token at 60 req/min; if we hit it,
  // wait until the next minute window and try again.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client.post(`/api/channels/${channelId}/reports`, envelope);
      if (!res.ok) {
        if (res.status === 429 && attempt === 0) {
          // 429 retryAfter is at most 60s (seconds until next minute boundary).
          // Sleep + 1s safety margin, then retry.
          const wait = 61_000;
          dbg?.(`postReport(${type}): 429, sleeping ${wait}ms before retry`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        dbg?.(`postReport(${type}): HTTP ${res.status}, giving up`);
        return;
      }
      return;
    } catch (err) {
      dbg?.(`postReport(${type}): caught ${(err as Error).message}`);
      return;
    }
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
