/**
 * End-to-end UAT integration test against a live seeded relay.
 *
 * Guarded by env var UAT_RELAY_URL — default `pnpm test` skips this suite.
 * Run with: `pnpm test:uat` (sets UAT_RELAY_URL, UAT_DB_PATH, tokens).
 *
 * Covers automatically (UAT-3..7):
 *  - RelayClient round-trips against the live HTTP server
 *  - RemoteFleetProvider summary/detail/run aggregation
 *  - AlertEngine transition detection across populated + empty workspaces
 *  - RemoteAdapter timeline assembly (heartbeats filtered)
 *  - fleetBuilder.mergeWorkspaceSummaries dedup
 *
 * Manual residue:
 *  - UAT-1: sidebar panel mounted in actual VS Code chrome
 *  - UAT-9: full reconnect UX (status pill flip in sidebar)
 *           — data layer covered automatically via UAT-9a below
 */
import { spawnSync } from 'child_process';
import * as path from 'path';
import { RelayClient } from '../../src/relay/RelayClient';
import { RemoteAdapter } from '../../src/adapters/RemoteAdapter';
import { RemoteFleetProvider } from '../../src/providers/RemoteFleetProvider';
import { AlertEngine } from '../../src/alerts/AlertEngine';
import { mergeWorkspaceSummaries } from '../../src/providers/fleetBuilder';
import type { AlertCycleSummary } from '../../src/types/alerts';
import type {
  IWorkspaceRegistry,
  WorkspaceRecord,
} from '../../src/types/workspace';
import type { FleetWorkspaceSummary } from '../../src/types/fleet';

const RELAY_URL = process.env.UAT_RELAY_URL;
const POPULATED_TOKEN = process.env.UAT_POPULATED_TOKEN ?? 'uat-token-ws-populated';
const EMPTY_TOKEN = process.env.UAT_EMPTY_TOKEN ?? 'uat-token-ws-empty';
const DB_PATH = process.env.UAT_DB_PATH;
const SEED_SCRIPT = process.env.UAT_SEED_SCRIPT;

const describeIfRelay = RELAY_URL ? describe : describe.skip;

describeIfRelay('UAT integration against live relay', () => {
  let populatedClient: RelayClient;
  let emptyClient: RelayClient;

  beforeAll(async () => {
    // Refresh seeded timestamps so agent-fresh remains "fresh" and stale-thresholds
    // are computed against now. Without this, the test outcome drifts as the seeded
    // DB ages between manual `scripts/seed-uat.sh` runs.
    if (DB_PATH && SEED_SCRIPT) {
      const result = spawnSync('node', [SEED_SCRIPT], {
        cwd: path.dirname(SEED_SCRIPT),
        env: {
          ...process.env,
          UAT_DB_PATH: DB_PATH,
          UAT_POPULATED_TOKEN: POPULATED_TOKEN,
          UAT_EMPTY_TOKEN: EMPTY_TOKEN,
        },
        stdio: 'pipe',
      });
      if (result.status !== 0) {
        throw new Error(
          `Seed refresh failed (exit ${result.status}): ${result.stderr.toString()}`,
        );
      }
    }

    populatedClient = new RelayClient({
      relayUrl: RELAY_URL!,
      token: POPULATED_TOKEN,
      channelId: 'ws-populated',
    });
    emptyClient = new RelayClient({
      relayUrl: RELAY_URL!,
      token: EMPTY_TOKEN,
      channelId: 'ws-empty',
    });

    const health = await populatedClient.checkHealth();
    expect(health.status).toBe('ok');
  });

  describe('RelayClient (UAT-3: raw HTTP contract)', () => {
    it('rejects bad bearer tokens with 401', async () => {
      const bogus = new RelayClient({
        relayUrl: RELAY_URL!,
        token: 'wrong-token',
        channelId: 'ws-populated',
      });
      await expect(bogus.getAgents()).rejects.toMatchObject({ status: 401 });
    });

    it('returns 3 agents + 3 reports for ws-populated', async () => {
      const [agents, reports, summary] = await Promise.all([
        populatedClient.getAgents(),
        populatedClient.getReports(),
        populatedClient.getSummary(7),
      ]);
      expect(agents).toHaveLength(3);
      expect(agents.map(a => a.agentId).sort()).toEqual([
        'agent-failing',
        'agent-fresh',
        'agent-stale',
      ]);
      expect(reports).toHaveLength(3);
      expect(reports.filter(r => r.type === 'alert')).toHaveLength(2);
      expect(reports.filter(r => r.type === 'heartbeat')).toHaveLength(1);
      expect(summary.agents).toHaveLength(3);
    });

    it('returns empty arrays for ws-empty (isolation)', async () => {
      const [agents, reports, summary] = await Promise.all([
        emptyClient.getAgents(),
        emptyClient.getReports(),
        emptyClient.getSummary(7),
      ]);
      expect(agents).toHaveLength(0);
      expect(reports).toHaveLength(0);
      expect(summary.agents).toHaveLength(0);
    });

    it('returns 3 failure runs for agent-failing', async () => {
      const runs = await populatedClient.getRuns('agent-failing');
      expect(runs).toHaveLength(3);
      expect(runs.every(r => r.status === 'failure')).toBe(true);
    });
  });

  describe('RemoteFleetProvider (UAT-5: summary → dashboard)', () => {
    it('aggregates 3 agents with failing health for ws-populated', async () => {
      const registry = makeRegistry([
        makeRemoteWorkspace({ id: 'ws-populated', name: 'ws-populated', channelId: 'ws-populated' }),
        makeRemoteWorkspace({ id: 'ws-empty', name: 'ws-empty', channelId: 'ws-empty' }),
      ]);
      const provider = new RemoteFleetProvider(
        new Map([
          ['ws-populated', populatedClient],
          ['ws-empty', emptyClient],
        ]),
        registry,
      );

      const summaries = await provider.getWorkspaceSummaries(7);
      expect(summaries).toHaveLength(2);

      const populated = summaries.find(s => s.id === 'ws-populated')!;
      expect(populated.agentCount).toBe(3);
      // 3 failures / 9 total runs = 33.33%
      expect(populated.errorRatePct).toBeCloseTo(33.33, 1);
      // Mixed: at least one failing agent → health 'failing'
      expect(populated.health).toBe('failing');
      expect(populated.lastActivityTs).toBeGreaterThan(0);

      const empty = summaries.find(s => s.id === 'ws-empty')!;
      expect(empty.agentCount).toBe(0);
      expect(empty.errorRatePct).toBe(0);
      expect(empty.health).toBe('no-data');
      expect(empty.lastActivityTs).toBe(0);
    });

    it('returns per-agent detail with correct health for ws-populated', async () => {
      const registry = makeRegistry([
        makeRemoteWorkspace({ id: 'ws-populated', name: 'ws-populated', channelId: 'ws-populated' }),
      ]);
      const provider = new RemoteFleetProvider(
        new Map([['ws-populated', populatedClient]]),
        registry,
      );

      const detail = await provider.getWorkspaceDetail('ws-populated', 7);
      expect(detail.agents).toHaveLength(3);

      const byId = new Map(detail.agents.map(a => [a.id, a]));
      expect(byId.get('agent-failing')!.health).toBe('failing');
      expect(byId.get('agent-fresh')!.health).toBe('healthy');
      // agent-stale: 100% success rate, but lastRunAt = now-30h > 24h staleness window
      expect(byId.get('agent-stale')!.health).toBe('degraded');

      expect(detail.cost.totalCostUsd).toBeGreaterThan(0);
    });

    it('returns run history for agent-failing', async () => {
      const registry = makeRegistry([
        makeRemoteWorkspace({ id: 'ws-populated', name: 'ws-populated', channelId: 'ws-populated' }),
      ]);
      const provider = new RemoteFleetProvider(
        new Map([['ws-populated', populatedClient]]),
        registry,
      );

      const detail = await provider.getAgentDetail('ws-populated', 'agent-failing', 7);
      expect(detail.runs).toHaveLength(3);
      expect(detail.runs.every(r => r.status === 'failing')).toBe(true);
      expect(detail.cost.totalCostUsd).toBeGreaterThan(0);
    });
  });

  describe('AlertEngine (UAT-6: alerts wired)', () => {
    it('fires problem transitions for stale + failing agents on ws-populated', async () => {
      const wsPopulated = makeRemoteWorkspace({
        id: 'ws-populated',
        name: 'ws-populated',
        channelId: 'ws-populated',
        agents: [
          makeAgentIdentity('agent-failing', '*/10 * * * *'),
          makeAgentIdentity('agent-fresh', '*/5 * * * *'),
          makeAgentIdentity('agent-stale', '*/15 * * * *'),
        ],
      });
      const wsEmpty = makeRemoteWorkspace({
        id: 'ws-empty',
        name: 'ws-empty',
        channelId: 'ws-empty',
      });
      const registry = makeRegistry([wsPopulated, wsEmpty]);
      const provider = new RemoteFleetProvider(
        new Map([
          ['ws-populated', populatedClient],
          ['ws-empty', emptyClient],
        ]),
        registry,
      );

      const engine = new AlertEngine(provider, registry);
      const cycle = await new Promise<AlertCycleSummary>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('AlertEngine never fired')), 8000);
        engine.onDidDetectAlerts(summary => {
          clearTimeout(timeout);
          resolve(summary);
        });
        engine.start();
      });
      engine.dispose();

      expect(cycle.recoveries).toHaveLength(0);
      // agent-failing: 3 failures, last run -10min, cron */10 → 20min threshold → 'failing'
      // agent-stale: 30h since last run > 30min stale threshold → 'stale'
      // agent-fresh: newest run -45s, cron */5 → 10min threshold → no transition (healthy)
      const transitions = cycle.problems.map(p => ({
        agentId: p.agentId,
        currentState: p.currentState,
      }));
      const failingTransition = transitions.find(t => t.agentId === 'agent-failing');
      const staleTransition = transitions.find(t => t.agentId === 'agent-stale');
      const freshTransition = transitions.find(t => t.agentId === 'agent-fresh');

      expect(failingTransition).toBeDefined();
      expect(failingTransition!.currentState).toBe('failing');
      expect(staleTransition).toBeDefined();
      expect(staleTransition!.currentState).toBe('stale');
      expect(freshTransition).toBeUndefined();
      // ws-empty has zero agents → contributes no transitions
      expect(cycle.problems.every(p => p.workspaceId === 'ws-populated')).toBe(true);
    });
  });

  describe('RemoteAdapter (UAT-7: timeline panel)', () => {
    it('returns 2 alert items for ws-populated (heartbeat filtered)', async () => {
      const adapter = new RemoteAdapter(
        RELAY_URL!,
        POPULATED_TOKEN,
        'ws-populated',
        30_000,
      );
      await adapter.connect('ws-populated', '');
      try {
        const { items } = await adapter.getTimelineItems();
        expect(items).toHaveLength(2);
        expect(items.every(i => i.kind === 'report')).toBe(true);
        // Newest first
        expect(items[0].at >= items[1].at).toBe(true);
      } finally {
        await adapter.disconnect('ws-populated');
        adapter.dispose();
      }
    });

    it('returns empty timeline for ws-empty', async () => {
      const adapter = new RemoteAdapter(
        RELAY_URL!,
        EMPTY_TOKEN,
        'ws-empty',
        30_000,
      );
      await adapter.connect('ws-empty', '');
      try {
        const { items } = await adapter.getTimelineItems();
        expect(items).toHaveLength(0);
      } finally {
        await adapter.disconnect('ws-empty');
        adapter.dispose();
      }
    });
  });

  describe('Unreachable relay (UAT-9a: data layer for reconnect UX)', () => {
    // Port 1 is reserved (tcpmux); a connection attempt fails fast with ECONNREFUSED
    // on every common platform, so we don't need to spin up a sacrificial server.
    const DEAD_URL = 'http://127.0.0.1:1/api';

    it('surfaces a network error from RelayClient when the relay is unreachable', async () => {
      const dead = new RelayClient({
        relayUrl: DEAD_URL,
        token: POPULATED_TOKEN,
        channelId: 'ws-populated',
      });
      await expect(dead.getAgents()).rejects.toThrow();
    });

    // Note: the "status pill flip in the sidebar" half of UAT-9 remains a manual
    // smoke item — these assertions only cover the data layer: a dead relay
    // surfaces as 'unreachable', and an equivalent provider built against a live
    // relay returns the expected 'failing' health (per UAT-5). The in-process
    // reconnect path (existing provider re-pointed at a new URL mid-lifecycle)
    // is exercised by VS Code's command flow, not by RemoteFleetProvider itself.
    it("RemoteFleetProvider reports health 'unreachable' for a dead relay; live relay returns expected health", async () => {
      const deadClient = new RelayClient({
        relayUrl: DEAD_URL,
        token: POPULATED_TOKEN,
        channelId: 'ws-populated',
      });
      const registry = makeRegistry([
        makeRemoteWorkspace({ id: 'ws-populated', name: 'ws-populated', channelId: 'ws-populated' }),
      ]);
      const downProvider = new RemoteFleetProvider(
        new Map([['ws-populated', deadClient]]),
        registry,
      );
      const downSummaries = await downProvider.getWorkspaceSummaries(7);
      const downEntry = downSummaries.find(s => s.id === 'ws-populated')!;
      expect(downEntry.health).toBe('unreachable');

      const upProvider = new RemoteFleetProvider(
        new Map([['ws-populated', populatedClient]]),
        registry,
      );
      const upSummaries = await upProvider.getWorkspaceSummaries(7);
      const upEntry = upSummaries.find(s => s.id === 'ws-populated')!;
      expect(upEntry.health).toBe('failing'); // matches UAT-5 baseline
    });
  });

  describe('fleetBuilder.mergeWorkspaceSummaries (UAT-4: local+remote dedup)', () => {
    it('dedupes a local workspace that has a remote shadow', () => {
      const local: FleetWorkspaceSummary[] = [
        { id: 'ws-populated', name: 'local-name', platform: 'local', health: 'healthy', agentCount: 1, errorRatePct: 0, lastActivityTs: 1 },
        { id: 'ws-other', name: 'other', platform: 'local', health: 'healthy', agentCount: 0, errorRatePct: 0, lastActivityTs: 1 },
      ];
      const relay: FleetWorkspaceSummary[] = [
        { id: 'ws-populated', name: 'ws-populated', platform: 'Remote', health: 'failing', agentCount: 3, errorRatePct: 33, lastActivityTs: 2 },
        { id: 'ws-empty', name: 'ws-empty', platform: 'Remote', health: 'no-data', agentCount: 0, errorRatePct: 0, lastActivityTs: 0 },
      ];

      const merged = mergeWorkspaceSummaries(local, relay);
      expect(merged.map(m => m.id).sort()).toEqual([
        'ws-empty',
        'ws-other',
        'ws-populated',
      ]);
      const populatedShadow = merged.find(m => m.id === 'ws-populated')!;
      expect(populatedShadow.name).toBe('local-name'); // local wins for shared field
      expect(populatedShadow.relayStatus).toBe('failing'); // relay health bubbles up
    });
  });
});

// ---- helpers ----

function makeRemoteWorkspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: 'ws-remote',
    name: 'Remote Workspace',
    rootPath: 'remote://' + (overrides.channelId ?? 'channel-1'),
    status: 'running',
    addedAt: '2026-05-09T00:00:00.000Z',
    lastUpdatedAt: '2026-05-09T00:00:00.000Z',
    runningAgentCount: 0,
    errorCount: 0,
    backendType: 'remote',
    mode: 'remote',
    relayUrl: RELAY_URL!,
    channelId: overrides.channelId ?? 'channel-1',
    agents: [],
    ...overrides,
  };
}

function makeAgentIdentity(agentId: string, schedule: string) {
  return {
    id: agentId,
    agentId,
    name: agentId,
    platform: 'claude-code',
    schedule,
    lastRunAt: null,
    status: 'idle',
  };
}

function makeRegistry(workspaces: WorkspaceRecord[]): IWorkspaceRegistry {
  return {
    getAll: () => workspaces,
    getById: (id: string) => workspaces.find(ws => ws.id === id),
    add: jest.fn(),
    remove: jest.fn(),
    update: jest.fn(),
    onDidChange: jest.fn(),
  } as unknown as IWorkspaceRegistry;
}
