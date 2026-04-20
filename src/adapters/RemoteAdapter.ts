import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { AgentBackendAdapter } from './AgentBackendAdapter';
import type { AgentEvent } from '../types/agent';
import type { TimelineItem, RalphReportBody } from '@harnesstune/shared';
import { RelayClient, RelayError } from '../relay';

const DEFAULT_POLL_INTERVAL = 30_000; // 30 seconds
const MAX_BACKOFF = 5 * 60_000;       // 5 minutes
const STALE_THRESHOLD = 15 * 60_000;  // 15 minutes (3 missed heartbeats at 5-min interval)

export class RemoteAdapter implements AgentBackendAdapter {
  readonly id = 'remote';
  readonly name = 'Remote (Relay)';

  private readonly _onDidReceiveEvent = new vscode.EventEmitter<AgentEvent>();
  readonly onDidReceiveEvent: vscode.Event<AgentEvent> = this._onDidReceiveEvent.event;

  private client: RelayClient | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private reportCursor: string | undefined;
  private messageCursor: string | undefined;
  private currentInterval: number = DEFAULT_POLL_INTERVAL;
  private baseInterval: number = DEFAULT_POLL_INTERVAL;
  private consecutiveErrors = 0;
  private workspaceId = '';
  private lastHeartbeatAt: number | undefined;

  private readonly _onStatusChange = new vscode.EventEmitter<{ workspaceId: string; status: string; lastHeartbeatAt?: number }>();
  readonly onStatusChange: vscode.Event<{ workspaceId: string; status: string; lastHeartbeatAt?: number }> = this._onStatusChange.event;

  constructor(
    private readonly relayUrl: string,
    private readonly token: string,
    private readonly channelId: string,
    private readonly pollInterval: number = DEFAULT_POLL_INTERVAL,
    initialCursors?: { reportCursor?: string; messageCursor?: string },
  ) {
    this.baseInterval = pollInterval;
    this.currentInterval = pollInterval;
    this.reportCursor = initialCursors?.reportCursor;
    this.messageCursor = initialCursors?.messageCursor;
  }

  async connect(workspaceId: string, _workspaceRootPath: string): Promise<void> {
    this.workspaceId = workspaceId;
    this.client = new RelayClient({ relayUrl: this.relayUrl, token: this.token, channelId: this.channelId });
    this.startPolling();
  }

  async disconnect(_workspaceId: string): Promise<void> {
    this.stopPolling();
    this.client = undefined;
  }

  dispose(): void {
    this.stopPolling();
    this._onDidReceiveEvent.dispose();
    this._onStatusChange.dispose();
  }

  /** Get current cursors for persistence */
  getCursors(): { reportCursor?: string; messageCursor?: string } {
    return { reportCursor: this.reportCursor, messageCursor: this.messageCursor };
  }

  /** Get RelayClient for direct use (e.g., posting messages) */
  getClient(): RelayClient | undefined {
    return this.client;
  }

  private startPolling(): void {
    // Immediate first poll
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.currentInterval);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private resetPollingInterval(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => this.poll(), this.currentInterval);
  }

  private async poll(): Promise<void> {
    if (!this.client) { return; }
    try {
      const reports = await this.client.getReports(this.reportCursor);

      // Success -- reset backoff
      if (this.consecutiveErrors > 0) {
        this.consecutiveErrors = 0;
        this.currentInterval = this.baseInterval;
        this.resetPollingInterval();
        this._onStatusChange.fire({ workspaceId: this.workspaceId, status: 'idle' });
      }

      for (const report of reports) {
        // Update cursor to latest report timestamp
        if (!this.reportCursor || report.generatedAt > this.reportCursor) {
          this.reportCursor = report.generatedAt;
        }

        // Track heartbeat freshness
        if (report.type === 'heartbeat') {
          this.lastHeartbeatAt = Date.now();
          const body = report.body as { status: string };
          if (body.status === 'connected') {
            this._onStatusChange.fire({ workspaceId: this.workspaceId, status: 'running', lastHeartbeatAt: this.lastHeartbeatAt });
          }
        }

        // Emit synthetic AgentEvent for each report
        const event: AgentEvent = {
          id: crypto.randomUUID(),
          workspaceId: this.workspaceId,
          sessionId: `remote-${this.channelId}`,
          agentId: `remote-${this.channelId}`,
          eventType: 'RemoteReport',
          timestamp: new Date(report.generatedAt).getTime(),
          raw: { type: 'remote_report', report } as unknown,
        };
        this._onDidReceiveEvent.fire(event);
      }

      // Check staleness (3 missed heartbeats = 15 min)
      if (this.lastHeartbeatAt && (Date.now() - this.lastHeartbeatAt) > STALE_THRESHOLD) {
        this._onStatusChange.fire({ workspaceId: this.workspaceId, status: 'stale', lastHeartbeatAt: this.lastHeartbeatAt });
      }
    } catch (err) {
      this.consecutiveErrors++;

      if (err instanceof RelayError && err.status === 401) {
        // Token invalid -- stop polling, require re-configure
        this.stopPolling();
        this._onStatusChange.fire({ workspaceId: this.workspaceId, status: 'auth_error' });
        return;
      }

      // Network error or 5xx -- apply exponential backoff
      this.currentInterval = Math.min(this.baseInterval * Math.pow(2, this.consecutiveErrors), MAX_BACKOFF);
      this.resetPollingInterval();
      this._onStatusChange.fire({ workspaceId: this.workspaceId, status: 'relay_unreachable' });

      console.error(`HarnessTune RemoteAdapter: poll error (attempt ${this.consecutiveErrors}, next in ${this.currentInterval}ms):`, err instanceof Error ? err.message : err);
    }
  }

  /** Get timeline items (reports + messages, heartbeats filtered) */
  async getTimelineItems(): Promise<{ items: TimelineItem[]; loopIterations: Record<string, RalphReportBody[]> }> {
    if (!this.client) { return { items: [], loopIterations: {} }; }

    const [reports, messages] = await Promise.all([
      this.client.getReports(this.reportCursor),
      this.client.getMessages(this.messageCursor),
    ]);

    const items: TimelineItem[] = [];
    const loopMap: Record<string, RalphReportBody[]> = {};

    for (const report of reports) {
      if (!this.reportCursor || report.generatedAt > this.reportCursor) {
        this.reportCursor = report.generatedAt;
      }
      // Track heartbeats for stale detection but don't include in timeline
      if (report.type === 'heartbeat') {
        this.lastHeartbeatAt = Date.now();
        continue;
      }
      items.push({ kind: 'report', data: report, at: report.generatedAt });
      // Collect ralph iterations by loopId
      if (report.type === 'ralph') {
        const body = report.body as RalphReportBody;
        if (!loopMap[body.loopId]) { loopMap[body.loopId] = []; }
        loopMap[body.loopId].push(body);
      }
    }

    for (const msg of messages) {
      if (!this.messageCursor || msg.createdAt > this.messageCursor) {
        this.messageCursor = msg.createdAt;
      }
      items.push({ kind: 'message', data: msg, at: msg.createdAt });
    }

    items.sort((a, b) => b.at.localeCompare(a.at)); // newest first
    return { items, loopIterations: loopMap };
  }
}
