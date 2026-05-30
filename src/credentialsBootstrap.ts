import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { WorkspaceRegistry } from './registry';
import type { SecretStore } from './secrets';
import { RelayClient } from './relay';

interface CredentialsEntry {
  name: string;
  relayUrl: string;
  channelId?: string; // optional — discovered from token if missing
  token: string;
}

interface CredentialsFile {
  workspaces: CredentialsEntry[];
}

/**
 * Read-and-import credentials from a Dropbox-synced (or local) JSON file so a
 * new Mac doesn't have to re-enter tokens via the UI.
 *
 * Lookup order (first existing wins):
 *   1. $HARNESSTUNE_CREDENTIALS — absolute path override
 *   2. ~/.harnesstune/credentials.json — per-machine local override
 *   3. ~/Dropbox/harnesstune-credentials.json — canonical Dropbox location
 *
 * File is read-only from the extension's POV — entries already present in the
 * registry (matched by channelId) are skipped, never overwritten.
 */
export async function bootstrapWorkspacesFromCredentialsFile(
  registry: WorkspaceRegistry,
  secretStore: SecretStore,
): Promise<void> {
  const credsPath = resolveCredentialsPath();
  if (!credsPath) return;

  let raw: string;
  try {
    raw = fs.readFileSync(credsPath, 'utf8');
  } catch (err) {
    console.warn(`HarnessTune: credentials file at ${credsPath} unreadable: ${(err as Error).message}`);
    return;
  }

  let parsed: CredentialsFile;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`HarnessTune: credentials file at ${credsPath} is not valid JSON: ${(err as Error).message}`);
    return;
  }
  if (!parsed.workspaces || !Array.isArray(parsed.workspaces)) return;

  console.log(`HarnessTune: bootstrap from ${credsPath} — ${parsed.workspaces.length} entries`);

  const existing = registry.getAll();
  const existingChannelIds = new Set(
    existing
      .map(ws => ws.channelId)
      .filter((v): v is string => typeof v === 'string'),
  );

  for (const entry of parsed.workspaces) {
    if (!entry.token || !entry.relayUrl) {
      console.warn('HarnessTune: skipping credentials entry missing token/relayUrl');
      continue;
    }
    const relayUrl = entry.relayUrl.endsWith('/api')
      ? entry.relayUrl
      : entry.relayUrl.replace(/\/+$/, '') + '/api';

    let channelId = entry.channelId;
    if (!channelId) {
      try {
        const probe = new RelayClient({ relayUrl, token: entry.token, channelId: '' });
        await probe.checkHealth();
        channelId = await probe.discoverChannelId();
      } catch (err) {
        console.warn(`HarnessTune: bootstrap discovery failed for "${entry.name}": ${(err as Error).message}`);
        continue;
      }
    }
    if (existingChannelIds.has(channelId)) {
      console.log(`HarnessTune: bootstrap skipping "${entry.name}" — channel ${channelId} already registered`);
      continue;
    }

    try {
      const record = await registry.add(entry.name, 'remote://' + channelId, 'remote', {
        mode: 'remote',
        relayUrl,
        channelId,
      });
      await secretStore.setRelayToken(record.id, entry.token);
      console.log(`HarnessTune: bootstrap added "${entry.name}" (workspaceId=${record.id})`);
    } catch (err) {
      console.error(`HarnessTune: bootstrap add failed for "${entry.name}": ${(err as Error).message}`);
    }
  }
}

function resolveCredentialsPath(): string | null {
  const candidates: string[] = [];
  if (process.env.HARNESSTUNE_CREDENTIALS) {
    candidates.push(process.env.HARNESSTUNE_CREDENTIALS);
  }
  const home = os.homedir();
  candidates.push(path.join(home, '.harnesstune', 'credentials.json'));
  candidates.push(path.join(home, 'Dropbox', 'harnesstune-credentials.json'));
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch { /* unreadable */ }
  }
  return null;
}
