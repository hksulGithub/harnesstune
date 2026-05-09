---
phase: 13
plan: 02
name: plugin-promotion-and-loader
wave: 2
depends_on: [1]
files_modified:
  - packages/harnesstune-collector/src/plugins/stubs/paperclip.ts
  - packages/harnesstune-collector/src/plugins/loader.ts
autonomous: true
requirements:
  - PCLP-01
  - PCLP-02
  - PCLP-03
  - PCLP-04
  - PCLP-05
  - PCLP-06
  - COLL-05
  - COLL-06
---

# Plan 02: Plugin Promotion & Loader Update

<objective>
Promote the Paperclip stub plugin to a fully functional implementation that uses PaperclipClient and mappers, and update the plugin loader to inject platform config at construction time so the plugin has credentials for API calls.
</objective>

<threat_model>
- **API key passed at construction:** PaperclipPlugin receives `platformConfig` containing the API key from `collector.json`. The key stays in memory on the plugin instance. Mitigation: `collector.json` is chmod 600; key is never logged by the plugin.
- **Setup credential validation:** `setup()` calls `client.getCompanies()` to validate the API key before saving to config. If the key is invalid, the error is caught and reported without writing the invalid key to disk.
- **Config read at module load:** `loader.ts` calls `readConfig()` at import time. If config doesn't exist (pre-setup), the try/catch returns empty config so plugins get no credentials. No crash on first run.
- **No sensitive data in error messages:** Plugin catch blocks log `err.message` (which contains status + path from PaperclipApiError) but never the API key itself.
</threat_model>

<tasks>

## Task 1: Promote PaperclipPlugin Stub to Real Implementation

<read_first>
- packages/harnesstune-collector/src/plugins/stubs/paperclip.ts
- packages/harnesstune-collector/src/plugins/interface.ts
- packages/harnesstune-collector/src/plugins/paperclip/client.ts
- packages/harnesstune-collector/src/plugins/paperclip/mappers.ts
- packages/harnesstune-collector/src/plugins/paperclip/types.ts
- packages/harnesstune-collector/src/types.ts
- packages/shared/src/reports.ts
- packages/harnesstune-collector/src/daemon/scheduler.ts
- .planning/phases/13-paperclip-adapter/13-CONTEXT.md
</read_first>

<action>
Replace the contents of `packages/harnesstune-collector/src/plugins/stubs/paperclip.ts` with:

```typescript
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { RunReport } from '@harnesstune/shared';
import type { PlatformPlugin, PlatformConfig } from '../interface.js';
import type { AgentIdentity } from '../../types.js';
import { PaperclipClient } from '../paperclip/client.js';
import { mapAgent, mapTaskSession, enrichWithCosts, mapActivitiesToEvents } from '../paperclip/mappers.js';

/**
 * Paperclip platform plugin.
 *
 * detect(): checks for common Paperclip installation markers.
 * setup(): prompts for serverUrl + apiKey, validates credentials via getCompanies(),
 *          auto-selects or prompts for companyId (D-02).
 * discover(): calls getAgents(companyId) and maps to AgentIdentity[] (PCLP-02).
 * collectRuns(): calls getTaskSessions + getCostsByAgent + getActivity, maps to RunReport[] (PCLP-03, PCLP-04, PCLP-05).
 */
export class PaperclipPlugin implements PlatformPlugin {
  readonly id = 'paperclip';
  readonly displayName = 'Paperclip';

  private client?: PaperclipClient;
  private companyId?: string;

  constructor(private readonly platformConfig?: PlatformConfig) {
    if (platformConfig?.['serverUrl'] && platformConfig?.['apiKey']) {
      this.client = new PaperclipClient(
        platformConfig['serverUrl'] as string,
        platformConfig['apiKey'] as string,
      );
      this.companyId = (platformConfig['companyId'] as string) || undefined;
    }
  }

  async detect(): Promise<boolean> {
    const markers = [
      join(homedir(), '.paperclip'),
      join(homedir(), 'Library', 'Application Support', 'Paperclip'),
      '/usr/local/bin/paperclip',
      '/opt/homebrew/bin/paperclip',
    ];
    return markers.some(p => existsSync(p));
  }

  async setup(existing?: PlatformConfig): Promise<PlatformConfig> {
    const rl = createInterface({ input, output });
    try {
      // Step 1: prompt for server URL and API key
      const defaultUrl = (existing?.['serverUrl'] as string | undefined) ?? '';
      const serverUrl = (
        await rl.question(`Paperclip server URL${defaultUrl ? ` [${defaultUrl}]` : ''}: `)
      ).trim() || defaultUrl;

      const apiKey = (await rl.question('Paperclip Board API Key: ')).trim();

      if (!serverUrl || !apiKey) {
        throw new Error('Server URL and API key are required.');
      }

      // Step 2: validate credentials by fetching companies (D-02)
      const client = new PaperclipClient(serverUrl, apiKey);
      console.log('\nValidating credentials...');
      const companies = await client.getCompanies();

      if (companies.length === 0) {
        throw new Error('No companies found. Check your API key permissions.');
      }

      // Step 3: select companyId (D-02)
      let companyId: string;
      if (companies.length === 1) {
        companyId = companies[0].id;
        console.log(`Company: ${companies[0].name} (${companyId})`);
      } else {
        console.log('\nMultiple companies found:');
        companies.forEach((c, i) => console.log(`  ${i + 1}. ${c.name} (${c.id})`));
        const choice = await rl.question(`Select company [1-${companies.length}]: `);
        const idx = parseInt(choice.trim(), 10) - 1;
        if (idx < 0 || idx >= companies.length) {
          throw new Error('Invalid selection.');
        }
        companyId = companies[idx].id;
        console.log(`Selected: ${companies[idx].name}`);
      }

      return { serverUrl, apiKey, companyId };
    } finally {
      rl.close();
    }
  }

  async discover(): Promise<AgentIdentity[]> {
    if (!this.client || !this.companyId) {
      return [];
    }
    const agents = await this.client.getAgents(this.companyId);
    return agents.map(mapAgent);
  }

  async collectRuns(since: Date): Promise<RunReport[]> {
    if (!this.client || !this.companyId) {
      return [];
    }

    // Step 1: discover agents to iterate (PCLP-02)
    const agents = await this.client.getAgents(this.companyId);

    // Step 2: collect task sessions for each agent (PCLP-03)
    let allRuns: RunReport[] = [];
    for (const agent of agents) {
      const sessions = await this.client.getTaskSessions(agent.id, since);
      const runs = sessions.map(mapTaskSession);
      allRuns.push(...runs);
    }

    // Step 3: fallback cost enrichment for runs missing costCents (PCLP-04, D-03)
    const runsWithoutCost = allRuns.filter(r => r.costCents == null);
    if (runsWithoutCost.length > 0) {
      try {
        const now = new Date();
        const costs = await this.client.getCostsByAgent(this.companyId, since, now);
        allRuns = enrichWithCosts(allRuns, costs);
      } catch (err) {
        // Cost enrichment is best-effort; don't fail the whole collection
        console.error('Paperclip cost enrichment failed:', (err as Error).message);
      }
    }

    // Step 4: collect activity/audit events (PCLP-05)
    try {
      for (const agent of agents) {
        const activities = await this.client.getActivity(this.companyId, agent.id, since);
        if (activities.length > 0) {
          const activityRuns = mapActivitiesToEvents(activities);
          allRuns.push(...activityRuns);
        }
      }
    } catch (err) {
      // Activity collection is best-effort; don't fail the whole collection
      console.error('Paperclip activity collection failed:', (err as Error).message);
    }

    return allRuns;
  }
}
```

Key changes from stub:
1. Constructor accepts optional `PlatformConfig` and initializes `PaperclipClient` + `companyId` from it.
2. `setup()` extended: after prompting for serverUrl/apiKey, validates credentials via `getCompanies()`, then auto-selects or prompts for companyId (D-02). Returns `{ serverUrl, apiKey, companyId }`.
3. `discover()` calls `client.getAgents(companyId)` and maps via `mapAgent()` (PCLP-02).
4. `collectRuns(since)` iterates all agents, fetches task sessions per agent (PCLP-03), enriches with fallback cost data if needed (PCLP-04, D-03), and appends activity events (PCLP-05). Cost enrichment and activity collection are best-effort with try/catch.
5. Gracefully returns `[]` if client/companyId not configured (pre-setup state).
</action>

<acceptance_criteria>
- grep -c "export class PaperclipPlugin implements PlatformPlugin" packages/harnesstune-collector/src/plugins/stubs/paperclip.ts returns 1
- grep -c "private client?: PaperclipClient" packages/harnesstune-collector/src/plugins/stubs/paperclip.ts returns 1
- grep -c "private companyId?: string" packages/harnesstune-collector/src/plugins/stubs/paperclip.ts returns 1
- grep -c "constructor(private readonly platformConfig?: PlatformConfig)" packages/harnesstune-collector/src/plugins/stubs/paperclip.ts returns 1
- grep -c "client.getCompanies()" packages/harnesstune-collector/src/plugins/stubs/paperclip.ts returns 1
- grep -c "client.getAgents" packages/harnesstune-collector/src/plugins/stubs/paperclip.ts returns at least 2
- grep -c "client.getTaskSessions" packages/harnesstune-collector/src/plugins/stubs/paperclip.ts returns 1
- grep -c "client.getCostsByAgent" packages/harnesstune-collector/src/plugins/stubs/paperclip.ts returns 1
- grep -c "client.getActivity" packages/harnesstune-collector/src/plugins/stubs/paperclip.ts returns 1
- grep -c "mapAgent" packages/harnesstune-collector/src/plugins/stubs/paperclip.ts returns at least 2
- grep -c "mapTaskSession" packages/harnesstune-collector/src/plugins/stubs/paperclip.ts returns at least 2
- grep -c "enrichWithCosts" packages/harnesstune-collector/src/plugins/stubs/paperclip.ts returns at least 2
- grep -c "mapActivitiesToEvents" packages/harnesstune-collector/src/plugins/stubs/paperclip.ts returns at least 2
- grep "Stub" packages/harnesstune-collector/src/plugins/stubs/paperclip.ts returns empty (no more stub references)
</acceptance_criteria>

## Task 2: Update Plugin Loader to Inject Config

<read_first>
- packages/harnesstune-collector/src/plugins/loader.ts
- packages/harnesstune-collector/src/config.ts
- packages/harnesstune-collector/src/plugins/stubs/paperclip.ts (just updated in Task 1)
</read_first>

<action>
Replace the contents of `packages/harnesstune-collector/src/plugins/loader.ts` with:

```typescript
import type { PlatformPlugin } from './interface.js';
import { PaperclipPlugin } from './stubs/paperclip.js';
import { ClaudeDesktopPlugin } from './stubs/claude-desktop.js';
import { ClaudeCodePlugin } from './stubs/claude-code.js';
import { OpenClawPlugin } from './stubs/openclaw.js';
import { readConfig } from '../config.js';

/**
 * Build the plugin registry with injected config.
 *
 * Reads collector.json to pass platform-specific config to plugins that
 * need credentials at construction time (e.g., PaperclipPlugin needs
 * serverUrl + apiKey to initialize its HTTP client).
 *
 * If config doesn't exist (pre-setup), all plugins get undefined config.
 */
function buildPlugins(): PlatformPlugin[] {
  let platformConfigs: Record<string, Record<string, unknown>> = {};
  try {
    const cfg = readConfig();
    for (const p of cfg.platforms) {
      platformConfigs[p.id] = p.config;
    }
  } catch {
    // Config not yet written (pre-setup); plugins get no config
  }

  return [
    new PaperclipPlugin(platformConfigs['paperclip']),
    new ClaudeDesktopPlugin(),
    new ClaudeCodePlugin(),
    new OpenClawPlugin(),
  ];
}

/** Static plugin registry — built once at module load with injected config */
export const ALL_PLUGINS: PlatformPlugin[] = buildPlugins();

/** Return all registered plugins */
export function getAllPlugins(): PlatformPlugin[] {
  return ALL_PLUGINS;
}

/** Return a plugin by its id, or undefined if not found */
export function getPlugin(id: string): PlatformPlugin | undefined {
  return ALL_PLUGINS.find(p => p.id === id);
}

/** Return plugins whose ids appear in the given enabled-ids list */
export function getEnabledPlugins(enabledIds: string[]): PlatformPlugin[] {
  return ALL_PLUGINS.filter(p => enabledIds.includes(p.id));
}
```

Key changes:
1. Added `import { readConfig } from '../config.js'`.
2. Replaced inline `new PaperclipPlugin()` with `buildPlugins()` function that reads config and passes `platformConfigs['paperclip']` to the PaperclipPlugin constructor.
3. Other plugins (`ClaudeDesktopPlugin`, `ClaudeCodePlugin`, `OpenClawPlugin`) are unchanged — they don't need config injection yet (their phases are future).
4. `try/catch` around `readConfig()` so module load doesn't crash if config file doesn't exist yet.
5. All existing exports (`ALL_PLUGINS`, `getAllPlugins`, `getPlugin`, `getEnabledPlugins`) preserved with identical signatures.
</action>

<acceptance_criteria>
- grep -c "import { readConfig } from '../config.js'" packages/harnesstune-collector/src/plugins/loader.ts returns 1
- grep -c "function buildPlugins" packages/harnesstune-collector/src/plugins/loader.ts returns 1
- grep -c "new PaperclipPlugin(platformConfigs\['paperclip'\])" packages/harnesstune-collector/src/plugins/loader.ts returns 1
- grep -c "new ClaudeDesktopPlugin()" packages/harnesstune-collector/src/plugins/loader.ts returns 1
- grep -c "new ClaudeCodePlugin()" packages/harnesstune-collector/src/plugins/loader.ts returns 1
- grep -c "new OpenClawPlugin()" packages/harnesstune-collector/src/plugins/loader.ts returns 1
- grep -c "export const ALL_PLUGINS" packages/harnesstune-collector/src/plugins/loader.ts returns 1
- grep -c "export function getAllPlugins" packages/harnesstune-collector/src/plugins/loader.ts returns 1
- grep -c "export function getPlugin" packages/harnesstune-collector/src/plugins/loader.ts returns 1
- grep -c "export function getEnabledPlugins" packages/harnesstune-collector/src/plugins/loader.ts returns 1
</acceptance_criteria>

</tasks>

<verification>
1. `cd packages/harnesstune-collector && npx tsc --noEmit` — full type check passes (plugin, loader, and new modules all compile)
2. `pnpm run build:packages` from repo root — monorepo build succeeds
3. `grep -r "Stub" packages/harnesstune-collector/src/plugins/stubs/paperclip.ts` — returns empty (stub references removed)
4. `grep -c "PaperclipClient" packages/harnesstune-collector/src/plugins/stubs/paperclip.ts` — returns at least 2 (import + usage)
</verification>

<must_haves>
- PaperclipPlugin constructor accepts optional PlatformConfig and initializes client + companyId
- setup() validates credentials via getCompanies() and resolves companyId (D-02)
- setup() returns { serverUrl, apiKey, companyId } config object (PCLP-06)
- discover() calls getAgents(companyId) and returns AgentIdentity[] via mapAgent (PCLP-02)
- collectRuns() iterates agents, fetches task sessions, maps to RunReport[] (PCLP-03, COLL-05)
- collectRuns() applies fallback cost enrichment for runs missing costCents (PCLP-04, D-03)
- collectRuns() collects activity/audit events and appends as RunReports (PCLP-05)
- collectRuns() returns [] gracefully if client/companyId not configured
- Loader injects platformConfig to PaperclipPlugin constructor from collector.json
- Loader handles missing config file (pre-setup) without crashing
- Historical backfill works automatically via scheduler cursor default (now - 7 days) (COLL-06)
</must_haves>
