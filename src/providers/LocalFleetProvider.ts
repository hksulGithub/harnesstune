import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FleetDataProvider } from './FleetDataProvider.js';
import type {
  FleetWorkspaceSummary,
  FleetWorkspaceDetail,
  FleetAgentSummary,
  FleetAgentDetail,
  FleetRunRecord,
  FleetCostSummary,
  HealthState,
} from '../types/fleet.js';
import type { IWorkspaceRegistry } from '../types/workspace.js';

/** Run result file written by harnesstune-wrap to ~/.harnesstune/cron-runs/ */
interface CronRunFile {
  agentName: string;
  command: string;
  exitCode: number;
  startedAt: string;   // ISO 8601
  finishedAt: string;  // ISO 8601
  durationMs: number;
  outputTail: string;  // last 50 lines of stdout+stderr
}

function computeHealth(runs: Array<{ exitCode: number; startedAt: string }>): HealthState {
  if (runs.length === 0) { return 'no-data'; }
  const sorted = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (sorted.every(r => r.exitCode === 0)) { return 'healthy'; }
  let consecutiveFails = 0;
  for (const r of sorted) {
    if (r.exitCode !== 0) {
      consecutiveFails++;
    } else {
      break;
    }
  }
  if (consecutiveFails >= 3) { return 'failing'; }
  return 'degraded';
}

export class LocalFleetProvider implements FleetDataProvider {
  private readonly registry: IWorkspaceRegistry;
  private readonly cronRunsDir: string;

  constructor(registry: IWorkspaceRegistry) {
    this.registry = registry;
    this.cronRunsDir = path.join(os.homedir(), '.harnesstune/cron-runs/');
  }

  private async readCronRunFiles(cutoffMs: number): Promise<Array<CronRunFile & { filename: string }>> {
    let filenames: string[];
    try {
      filenames = await fs.promises.readdir(this.cronRunsDir);
    } catch {
      return [];
    }

    const results: Array<CronRunFile & { filename: string }> = [];
    for (const filename of filenames) {
      if (!filename.endsWith('.json')) { continue; }
      const filepath = path.join(this.cronRunsDir, filename);
      let raw: string;
      try {
        const stat = await fs.promises.stat(filepath);
        if (stat.mtimeMs < cutoffMs) { continue; }
        raw = await fs.promises.readFile(filepath, 'utf-8');
      } catch {
        continue;
      }
      let parsed: CronRunFile;
      try {
        parsed = JSON.parse(raw) as CronRunFile;
      } catch {
        continue;
      }
      if (Date.parse(parsed.startedAt) < cutoffMs) { continue; }
      results.push({ ...parsed, filename });
    }
    return results;
  }

  async getWorkspaceSummaries(days: number): Promise<FleetWorkspaceSummary[]> {
    const cutoffMs = Date.now() - days * 86400000;
    const files = await this.readCronRunFiles(cutoffMs);
    const workspaces = this.registry.getAll();

    return workspaces.map(ws => {
      const wsFiles = files; // local provider uses a single shared dir; all runs belong to the local workspace
      const agentNames = new Set(wsFiles.map(f => f.agentName));
      const totalFiles = wsFiles.length;
      const errorFiles = wsFiles.filter(f => f.exitCode !== 0).length;
      const errorRatePct = totalFiles > 0 ? (errorFiles / totalFiles) * 100 : 0;
      const lastActivityTs = wsFiles.length > 0
        ? Math.max(...wsFiles.map(f => Date.parse(f.finishedAt)))
        : 0;
      const health = computeHealth(wsFiles.map(f => ({ exitCode: f.exitCode, startedAt: f.startedAt })));

      return {
        id: ws.id,
        name: ws.name,
        platform: 'local',
        health,
        agentCount: agentNames.size,
        errorRatePct,
        lastActivityTs,
      } satisfies FleetWorkspaceSummary;
    });
  }

  async getWorkspaceDetail(workspaceId: string, days: number): Promise<FleetWorkspaceDetail> {
    const cutoffMs = Date.now() - days * 86400000;
    const files = await this.readCronRunFiles(cutoffMs);

    // Group by agentName
    const byAgent = new Map<string, Array<CronRunFile & { filename: string }>>();
    for (const f of files) {
      const existing = byAgent.get(f.agentName) ?? [];
      existing.push(f);
      byAgent.set(f.agentName, existing);
    }

    const agents: FleetAgentSummary[] = [];
    for (const [agentName, runs] of byAgent.entries()) {
      const successCount = runs.filter(r => r.exitCode === 0).length;
      const successRatePct = runs.length > 0 ? (successCount / runs.length) * 100 : 0;
      const lastRunTs = runs.length > 0
        ? Math.max(...runs.map(r => Date.parse(r.startedAt)))
        : 0;
      const health = computeHealth(runs.map(r => ({ exitCode: r.exitCode, startedAt: r.startedAt })));

      agents.push({
        id: agentName,
        name: agentName,
        health,
        successRatePct,
        lastRunTs,
        costUsd: 0,
        costTrend: 'flat',
      });
    }

    const cost: FleetCostSummary = {
      totalCostUsd: 0,
      totalTokens: 0,
      trend: 'flat',
    };

    void workspaceId; // local provider aggregates all runs regardless of workspace
    return { agents, cost };
  }

  async getAgentDetail(workspaceId: string, agentId: string, days: number): Promise<FleetAgentDetail> {
    const cutoffMs = Date.now() - days * 86400000;
    const files = await this.readCronRunFiles(cutoffMs);

    const agentFiles = files.filter(f => f.agentName === agentId);

    const runs: FleetRunRecord[] = agentFiles.map(f => ({
      runId: f.filename.replace(/\.json$/, ''),
      timestampTs: Date.parse(f.startedAt),
      durationMs: f.durationMs,
      status: f.exitCode === 0 ? 'healthy' : ('failing' as HealthState),
      costUsd: 0,
      logText: f.outputTail ?? '',
    }));

    runs.sort((a, b) => b.timestampTs - a.timestampTs);

    const cost: FleetCostSummary = {
      totalCostUsd: 0,
      totalTokens: 0,
      trend: 'flat',
    };

    void workspaceId;
    return { runs, cost };
  }
}
