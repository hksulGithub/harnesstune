# Phase 16 Context: Fleet Dashboard + Historical Reporting UI

## Domain Boundary

Redesign the Dashboard panel for multi-agent fleet model — aggregate fleet overview, workspace drill-down, agent detail with run history, health indicators, cost summaries. Reports panel stays unchanged.

## Canonical Refs

- `.planning/ROADMAP.md` (Phase 16 section, lines 528–647)
- `.planning/REQUIREMENTS.md` (FDSH-01 through FDSH-06)
- `.planning/phases/10-report-timeline-ui-async-chat/10-CONTEXT.md` (prior UI decisions)
- `src/webview/dashboard/App.tsx` (current Dashboard implementation)
- `src/webview/reports/App.tsx` (Reports panel — unchanged by this phase)
- `src/relay/RelayClient.ts` (AgentSummary, ChannelSummaryResponse, RunRecord types)
- `packages/harnesstune-collector/src/plugins/claude-code/types.ts` (CronRunFile)

## Prior Decisions Carried Forward

- **Phase 10 D-01:** ReportPanel singleton pattern (one panel instance)
- **Phase 10 D-03:** FilterTabs component for category filtering
- **Phase 10 D-07:** `timeline:update` message protocol for webview-extension comms
- **Phase 10 D-08:** Paginated load with cursor-based append

## Decisions

### D-01: Panel Architecture — Redesign Dashboard, Keep Reports Separate

The existing Dashboard panel is redesigned from a live-session viewer into a fleet-first panel with three drill-down levels: Fleet Overview → Workspace → Agent Detail. Live session info becomes one section within agent detail. The Reports panel remains separate and unchanged for timeline/chat/report viewing.

**Rationale:** Avoids introducing a third panel. Dashboard already has the infrastructure (webview, message protocol, component tree) — it gets repurposed rather than duplicated. Reports panel serves a distinct purpose (temporal feed + chat) that doesn't overlap with fleet aggregation.

### D-02: Agent Detail — In-Dashboard, Not Cross-Panel

The agent detail view with run history table (FDSH-03) lives entirely inside the redesigned Dashboard panel. Clicking an agent does NOT open or navigate to the Reports panel. The Dashboard is self-contained for fleet exploration.

**Rationale:** Cross-panel navigation adds complexity and breaks the user's mental model of "drill down, then back up." Self-contained drill-down is simpler and keeps the Dashboard as the single source for fleet health.

### D-03: Navigation — Breadcrumb Drill-Down

Fleet → Workspace → Agent navigation uses a view-replacement model with breadcrumb trail. Clicking a workspace card replaces the fleet overview with the workspace's agent list. Clicking an agent replaces with the agent detail view. Breadcrumb links (e.g., "Fleet > MyWorkspace > bot-a") allow jumping back to any level.

**Rationale:** Familiar pattern that scales well regardless of workspace count. Avoids sidebar tree (horizontal space) and accordion (vertical overflow). Existing WorkspaceTabs component is retired in favor of the fleet card grid at level 1.

### D-04: Date Range Selector — Persists Across Drill-Down Levels

The date range selector (FDSH-04: 24h/3d/7d/30d) appears at every drill-down level and persists its value when navigating between levels. User picks 7d at fleet level → drilling into a workspace or agent keeps 7d. Stored as React state in the Dashboard root component, passed down to all views.

**Rationale:** Consistent and predictable. Reduces clicks. The date range is a global filter, not a per-view setting.

### D-05: Data Unification — FleetDataProvider Abstraction

A `FleetDataProvider` interface abstracts data access for both local and remote workspaces:

```typescript
interface FleetDataProvider {
  getWorkspaceSummary(days: number): Promise<WorkspaceSummary>;
  getAgentRuns(agentId: string, days: number): Promise<RunRecord[]>;
}
```

Two implementations:
- **LocalFleetProvider** — reads collector output from `~/.harnesstune/cron-runs/` directory, filters by date range, aggregates in-process. Uses existing `CronRunFile` type from Phase 14.
- **RemoteFleetProvider** — wraps `RelayClient`, calls `GET /channels/:id/summary?days=N`.

Dashboard components call the provider without knowing whether the workspace is local or remote.

**Rationale:** Clean separation of concerns. Dashboard stays presentation-only. Adding new data sources (future adapters) means implementing one more provider, not scattering conditionals across components.

### D-06: Local Data Access — Direct File Read

`LocalFleetProvider` reads `~/.harnesstune/cron-runs/*.json` files directly rather than requiring a local HTTP endpoint from the collector daemon. Scans directory, filters by date range based on `startedAt` field, aggregates counts and costs.

**Rationale:** No additional daemon infrastructure needed. The collector already writes structured JSON files. Extension host has Node.js `fs` access. Avoids port management and daemon dependency for dashboard rendering.

## Deferred Ideas

(none)
