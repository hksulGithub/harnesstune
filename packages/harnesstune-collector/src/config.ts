import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Per-platform entry in collector.json */
export interface PlatformEntry {
  id: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

/** Collector daemon config — machine-level, stored at ~/.harnesstune/collector.json */
export interface CollectorConfig {
  relayUrl: string;
  channelId: string;
  token: string;
  /** Poll interval in ms (default 60000) */
  pollInterval?: number;
  /** Heartbeat interval in ms (default 300000) */
  heartbeatInterval?: number;
  platforms: PlatformEntry[];
}

/** Status snapshot written by daemon every heartbeat cycle */
export interface CollectorStatus {
  pid: number;
  startedAt: string;
  lastHeartbeat: string;
  lastPoll: string;
  plugins: Record<string, { enabled: boolean; agentCount: number }>;
}

export const COLLECTOR_DIR = join(homedir(), '.harnesstune');
export const CONFIG_FILE = join(COLLECTOR_DIR, 'collector.json');
export const PID_FILE = join(COLLECTOR_DIR, 'collector.pid');
export const STATUS_FILE = join(COLLECTOR_DIR, 'collector-status.json');
const QUEUE_DIR = join(COLLECTOR_DIR, 'queue');

/** Default platform entries (all disabled until setup enables them) */
const DEFAULT_PLATFORMS: PlatformEntry[] = [
  { id: 'paperclip', enabled: false, config: {} },
  { id: 'claude-desktop', enabled: false, config: {} },
  { id: 'claude-code', enabled: false, config: {} },
  { id: 'openclaw', enabled: false, config: {} },
];

export function readConfig(): CollectorConfig {
  if (!existsSync(CONFIG_FILE)) {
    throw new Error('No collector config found. Run: harnesstune-collector setup');
  }
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as CollectorConfig;
}

export function writeConfig(config: CollectorConfig): void {
  mkdirSync(COLLECTOR_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  // Restrict permissions: only owner can read/write (contains token)
  chmodSync(CONFIG_FILE, 0o600);
}

export function createDefaultConfig(
  relayUrl: string,
  channelId: string,
  token: string,
): CollectorConfig {
  return {
    relayUrl,
    channelId,
    token,
    pollInterval: 60_000,
    heartbeatInterval: 300_000,
    platforms: DEFAULT_PLATFORMS,
  };
}

export function writePid(pid: number): void {
  mkdirSync(COLLECTOR_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(pid), 'utf-8');
}

export function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, 'utf-8').trim();
  return raw ? parseInt(raw, 10) : null;
}

export function removePid(): void {
  if (existsSync(PID_FILE)) {
    rmSync(PID_FILE);
  }
}

export function writeStatus(status: CollectorStatus): void {
  mkdirSync(COLLECTOR_DIR, { recursive: true });
  writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');
}

export function readStatus(): CollectorStatus | null {
  if (!existsSync(STATUS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATUS_FILE, 'utf-8')) as CollectorStatus;
  } catch {
    return null;
  }
}

export function getQueueDir(): string {
  mkdirSync(QUEUE_DIR, { recursive: true });
  return QUEUE_DIR;
}

/** Resolve token: HARNESSTUNE_TOKEN env var takes priority over config file */
export function resolveToken(config: CollectorConfig): string {
  return process.env['HARNESSTUNE_TOKEN'] ?? config.token;
}
