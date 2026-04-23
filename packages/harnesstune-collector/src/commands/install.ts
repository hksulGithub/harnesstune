import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readConfig, resolveToken } from '../config.js';

const execFileAsync = promisify(execFile);

const PLIST_ID = 'com.harnesstune.collector';
const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH = join(LAUNCH_AGENTS_DIR, `${PLIST_ID}.plist`);

/**
 * `harnesstune-collector install` — generate and load a launchd plist.
 *
 * The plist starts the collector daemon at login and restarts it if it exits.
 * The token is injected into the plist EnvironmentVariables so the daemon
 * picks it up via the HARNESSTUNE_TOKEN env var (D-05 token precedence).
 */
export async function install(_args: string[]): Promise<void> {
  const config = readConfig();
  const token = resolveToken(config);

  // Resolve harnesstune-collector binary path
  const collectorBin = process.execPath; // node binary
  const collectorScript = new URL(import.meta.url).pathname.replace('/commands/install.js', '/cli.js');

  const plistContent = generatePlist({
    label: PLIST_ID,
    nodeBin: collectorBin,
    script: collectorScript,
    token,
    logPath: join(homedir(), '.harnesstune', 'collector.log'),
    errorLogPath: join(homedir(), '.harnesstune', 'collector-error.log'),
  });

  // Write plist
  mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
  writeFileSync(PLIST_PATH, plistContent, 'utf-8');
  console.log(`Plist written to: ${PLIST_PATH}`);

  // Unload first if already loaded (ignore errors)
  try {
    await execFileAsync('launchctl', ['unload', PLIST_PATH]);
  } catch {
    // Not previously loaded — expected on first install
  }

  // Load the plist
  if (!existsSync('/bin/launchctl') && !existsSync('/usr/bin/launchctl')) {
    console.log('launchctl not found — skipping launchd registration (non-macOS?)');
    console.log('Plist has been written. Load manually with:');
    console.log(`  launchctl load ${PLIST_PATH}`);
    return;
  }

  try {
    await execFileAsync('launchctl', ['load', PLIST_PATH]);
    console.log(`Service loaded: ${PLIST_ID}`);
    console.log('The collector will start automatically on next login.');
    console.log('To start immediately: launchctl start com.harnesstune.collector');
  } catch (err) {
    console.error('Failed to load plist via launchctl:', err);
    console.log('You can load it manually:');
    console.log(`  launchctl load ${PLIST_PATH}`);
    process.exit(1);
  }
}

interface PlistOptions {
  label: string;
  nodeBin: string;
  script: string;
  token: string;
  logPath: string;
  errorLogPath: string;
}

function generatePlist(opts: PlistOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${opts.label}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${opts.nodeBin}</string>
    <string>${opts.script}</string>
    <string>start</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>HARNESSTUNE_TOKEN</key>
    <string>${opts.token}</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${opts.logPath}</string>

  <key>StandardErrorPath</key>
  <string>${opts.errorLogPath}</string>

  <key>ThrottleInterval</key>
  <integer>30</integer>
</dict>
</plist>
`;
}
