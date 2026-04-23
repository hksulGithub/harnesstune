# Phase 13 Context: Paperclip Adapter

**Created:** 2026-04-23
**Phase:** 13 — Paperclip Adapter
**Status:** Decisions locked

## Prior Decisions (from earlier phases)

- **Phase 12 D-01**: Collector is `packages/harnesstune-collector`, separate from agent CLI
- **Phase 12 D-03**: `PlatformPlugin` interface is locked — `detect()`, `setup()`, `discover()`, `collectRuns(since)`. Daemon owns the schedule (60s poll). Plugins are pure data sources with no internal state.
- **Phase 12 D-04**: Config at `~/.harnesstune/collector.json`, platforms[].config holds per-platform settings
- **Phase 12 D-05**: One channel per collector/machine, `resolveToken()` for auth
- **Phase 11**: `RunReport` type in `@harnesstune/shared` with `agentId`, `startedAt`, `finishedAt`, `status`, `durationMs`, `logExcerpt`, `errorSummary`, `tokenUsage`, `costCents`
- **Phase 11**: `AgentIdentity` type with `agentId`, `name`, `platform`, `schedule`, `lastRunAt`, `status`
- **Phase 12**: Scheduler (`daemon/scheduler.ts`) handles agent registration with relay, run upload, cursor advancement, retry queue — plugins just return data

## Decisions

### D-01: PaperclipClient abstraction layer

All Paperclip HTTP calls and response parsing are encapsulated in a `PaperclipClient` class. The plugin depends on client methods, not raw HTTP.

**Client interface:**
```typescript
class PaperclipClient {
  constructor(serverUrl: string, apiKey: string)

  // Validate credentials + discover companies
  getCompanies(): Promise<PaperclipCompany[]>

  // List all agents for a company
  getAgents(companyId: string): Promise<PaperclipAgent[]>

  // Get task sessions (runs) for an agent since a timestamp
  getTaskSessions(agentId: string, since: Date): Promise<PaperclipTaskSession[]>

  // Get per-agent cost data for a date range (fallback enrichment)
  getCostsByAgent(companyId: string, from: Date, to: Date): Promise<PaperclipCostEntry[]>

  // Get activity/audit trail for an agent
  getActivity(companyId: string, agentId: string, since: Date): Promise<PaperclipActivity[]>
}
```

**Rationale:** Isolates API shape assumptions into one file. Plugin is unit-testable with a mock client. When the real Paperclip API is validated, only the client needs updating.

**Response types:** Define `PaperclipAgent`, `PaperclipTaskSession`, `PaperclipCostEntry`, `PaperclipActivity` interfaces based on assumed API shapes. Client maps these to `AgentIdentity` and `RunReport` via dedicated mapping functions.

### D-02: Auto-discover companyId during setup

During `setup()`, after user provides `serverUrl` + `apiKey`:
1. Call `client.getCompanies()` to list available companies
2. If one company → auto-select, print name for confirmation
3. If multiple companies → prompt user to choose from list
4. Store selected `companyId` in `platforms[].config.companyId`

This also validates credentials at setup time — if the API call fails, setup reports the error before writing config.

**Config shape after setup:**
```json
{
  "serverUrl": "https://paperclip.example.com",
  "apiKey": "pk-...",
  "companyId": "comp-abc123"
}
```

### D-03: Per-run cost from task session responses

Token usage and cost are extracted directly from each task session response. Map per-session fields to:
- `RunReport.tokenUsage.inputTokens` / `outputTokens`
- `RunReport.costCents`

The batch cost endpoint (`GET /companies/:companyId/costs/by-agent?from=&to=`) is available as a fallback enrichment method only if task session responses lack per-session cost fields. Primary data source is always the task session itself.

**Mapping priority:**
1. Task session cost fields → `RunReport.costCents` (preferred)
2. Batch cost endpoint → enrich runs missing cost data (fallback)

### D-04: Activity mapping — deferred to planning

Activity/audit trail mapping (PCLP-05) deferred to plan-phase analysis. Straightforward mapping from Paperclip activity events to either:
- Additional fields on `RunReport` (if activity is per-run)
- Separate timeline events (if activity is independent of runs)

Planner decides based on assumed Paperclip activity API shape.

### D-05: Historical backfill — cursor-based

First-connect backfill (COLL-06) uses the existing scheduler cursor mechanism:
- When `cursors[plugin.id]` is undefined, scheduler defaults to `Date.now() - 7 days` (already implemented in `scheduler.ts` line 64)
- No special backfill logic needed in the plugin — `collectRuns(since)` with a 7-day-old timestamp naturally returns historical data
- Pagination: `PaperclipClient.getTaskSessions()` handles paginated responses internally, returning all results as a flat array

## Canonical Refs

| What | Where |
|------|-------|
| Paperclip stub plugin | `packages/harnesstune-collector/src/plugins/stubs/paperclip.ts` |
| PlatformPlugin interface | `packages/harnesstune-collector/src/plugins/interface.ts` |
| Scheduler (poll loop) | `packages/harnesstune-collector/src/daemon/scheduler.ts` |
| Collector config | `packages/harnesstune-collector/src/config.ts` |
| AgentIdentity (collector) | `packages/harnesstune-collector/src/types.ts` |
| RunReport shared type | `packages/shared/src/reports.ts` |
| Setup command (existing) | `packages/harnesstune-collector/src/commands/setup.ts` |

## Deferred Ideas

- **Webhook-based updates**: Paperclip could push events to the collector instead of polling. Requires Paperclip webhook support and inbound port, conflicts with relay/mailbox pattern.
- **Real-time task monitoring**: Watch currently-running tasks for live progress. Out of scope per PROJECT.md (async/polling pattern).
- **Multi-company support**: Single collector monitoring agents across multiple Paperclip companies. Adds complexity without clear user need.
- **Paperclip MCP integration**: Use Paperclip's MCP server if available instead of REST API. Future enhancement when MCP ecosystem matures.

## Requirements Coverage

| Decision | Requirements |
|----------|-------------|
| D-01 | PCLP-01 (REST API polling with Bearer auth) |
| D-02 | PCLP-06 (setup prompts for server URL + API key), PCLP-02 (agent discovery endpoint) |
| D-03 | PCLP-04 (cost data per agent), COLL-05 (per-agent run reporting) |
| D-04 | PCLP-05 (activity/audit mapping) |
| D-05 | COLL-06 (historical batch sync), PCLP-03 (run history) |
