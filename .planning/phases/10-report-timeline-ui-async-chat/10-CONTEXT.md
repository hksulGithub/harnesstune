# Phase 10 Context: Report Timeline UI + Async Chat

**Created:** 2026-04-20
**Phase:** 10 — Report Timeline UI + Async Chat
**Status:** Decisions locked

## Prior Decisions (from earlier phases)

- **Phase 06**: `BackendType = 'claude-code' | 'openclaw' | 'remote'`, pnpm monorepo with `packages/shared`
- **Phase 07**: Relay API endpoints — `GET /channels/:id/reports?since=`, `GET /channels/:id/messages?since=&limit=`, `POST /channels/:id/messages` with `{ direction, body }` payload
- **Phase 08**: `ReportEnvelope` with `BriefingReportBody`, `RalphReportBody`, `HeartbeatReportBody` in `@harnesstune/shared`; report types: `'briefing' | 'ralph' | 'heartbeat'`
- **Phase 09**: `RemoteAdapter` polls reports on 30s interval with exponential backoff; `RelayClient` has `getReports()`, `postMessage()`, `getReport()`, `discoverChannelId()`; message types `reports:list`, `reports:detail`, `reports:sendMessage`, `reports:request` already in `HostToWebviewMessage`/`WebviewToHostMessage`; singleton WebviewPanel pattern established (DashboardPanel, ChatPanel, SchematicPanel)

## Decisions

### D-01: Filter heartbeats from timeline

Timeline only shows `briefing` and `ralph` report types plus chat messages. `HeartbeatReportBody` reports are filtered out before sending to webview — they drive sidebar stale detection (RemoteAdapter) but are not user-facing content. Filter applied in extension host when building the timeline items array.

### D-02: Briefing card layout — blockers expanded, rest collapsed

`BriefingReportCard` renders with:
- **Blockers** section always expanded with amber/red call-out box when `blockers[]` is non-empty. No blockers = section hidden entirely.
- **Goals**, **Progress**, **Next Steps**, **Metrics** sections start collapsed with one-line summary (e.g., "Goals (3)", "Progress: 60% complete", "Metrics: 4 values"). Click to expand.
- **Reply** button at card bottom.

This keeps cards compact in the feed while ensuring blockers — the most actionable information — are immediately visible per TMLN-02 success criteria.

### D-03: Pure SVG convergence chart — no D3 dependency

`RalphLoopChart` React component computes x/y coordinates from iteration data and renders `<svg>` with `<polyline>` elements directly. No D3 library needed — the data shape (iteration number → metric values) is simple enough for manual coordinate computation.

One `<polyline>` per named metric, each with a distinct stroke color. X-axis = iteration number, Y-axis = metric value. Axis labels and light grid lines for readability.

This departs from the Phase 3 pattern (D3 in extension host) because convergence data is trivially plottable without layout algorithms.

### D-04: Convergence chart inline in ralph card, collapsed

Chart section lives inside `RalphLoopReportCard`, collapsed by default with "Show convergence chart" toggle. Chart only renders when 2+ iterations exist for the same `loopId`.

To build the chart, the webview needs all iterations for a given `loopId` — not just the current card's iteration. Extension host sends the full iteration history for each loopId alongside the timeline items via a dedicated `timeline:loopIterations` map.

### D-05: Extension host merges reports + messages into unified timeline

```typescript
type TimelineItem =
  | { kind: 'report'; data: ReportEnvelope; at: string }
  | { kind: 'message'; data: RelayMessage; at: string };
```

RemoteAdapter fetches both `getReports(since)` and `getMessages(since)`, filters out heartbeats, wraps each into `TimelineItem`, sorts by `at` timestamp (newest first), and sends to webview via `timeline:update` postMessage.

Single data stream to webview — it just renders what it receives. Cursor tracking: one cursor for reports, one for messages, both persisted in the adapter.

### D-06: Chat bubbles — compact, aligned by direction

Chat messages render as compact bubbles in the timeline feed:
- **User messages** (`direction: 'to_agent'`): right-aligned, accent background color (VSCode button background)
- **Agent messages** (`direction: 'from_agent'`): left-aligned, neutral background (VSCode editor widget background)
- Sender label ("You" / "Agent") + relative timestamp shown alongside bubble
- Full-width report cards and compact chat bubbles alternate naturally in the chronological feed

### D-07: Message composer — fixed at panel bottom

`MessageComposer` component fixed at the bottom of the ReportPanel (sticky positioning). Always visible when the panel is open for a remote workspace. Text input with Send button.

"Reply" button on report cards scrolls to and focuses the composer, pre-filling metadata with `in_reply_to_report_id`. The reply reference is sent as part of the message body: `{ text, sentAt, inReplyToReportId }`. This extends the existing `RelayClient.postMessage()` which already sends `{ direction: 'to_agent', body: {...} }` — the body is a generic `Record<string, unknown>` on the relay side.

### D-08: ReportPanel follows established WebviewPanel pattern

`ReportPanel` uses the same singleton pattern as `DashboardPanel`/`ChatPanel`/`SchematicPanel`:
- `createOrShow()` / `revive()` static methods
- Separate esbuild entry point at `src/webview/reports/index.tsx`
- React `App.tsx` with `vscodeApi.ts` module-scope wrapper
- `WebviewPanelSerializer` for persistence across restarts
- Panel title: "HarnessTune Reports — {workspaceName}"

### D-09: Filter tabs for report types

Three filter tabs at the top of the timeline: **All** | **Briefings** | **Ralph** | **Chat**. Default: All. Filter state persisted in webview `setState()` so it survives panel hide/show cycles.

Tabs filter the `TimelineItem[]` array client-side — no re-fetch needed. This satisfies TMLN-05.

### D-10: Paginated load — initial 20, "Load more" button

Panel opens with last 20 timeline items (combined reports + messages). "Load more" button at the top of the feed fetches the next page using the oldest item's timestamp as the `since` cursor (inverted — fetching older items). Extension host handles the pagination query and appends to the webview's existing items.

## Canonical Refs

| What | Where |
|------|-------|
| WebviewPanel pattern (DashboardPanel) | `src/panels/DashboardPanel.ts` |
| ChatPanel (singleton pattern reference) | `src/panels/ChatPanel.ts` |
| HostToWebviewMessage / WebviewToHostMessage | `src/types/messages.ts` |
| Report types (shared) | `packages/shared/src/reports.ts` |
| RelayClient (fetch wrapper) | `src/relay/RelayClient.ts` |
| RemoteAdapter (polling loop) | `src/adapters/RemoteAdapter.ts` |
| Relay messages API | `packages/harnesstune-relay/src/routes/messages.ts` |
| Relay reports API | `packages/harnesstune-relay/src/routes/reports.ts` |
| Sidebar WorkspaceItem (click handler) | `src/webview/sidebar/components/WorkspaceItem.tsx` |
| Extension activation + command wiring | `src/extension.ts` |
| Dashboard webview entry | `src/webview/dashboard/index.tsx` |
| Schematic webview entry | `src/webview/schematic/index.tsx` |
| Chat webview entry | `src/webview/chat/index.tsx` |

## Deferred Ideas

- **Message read receipts** (`delivered_at`, `replied_at`) — ACHAT-04 mentions these. For v2.0 launch, display timestamps from relay `createdAt`. Full delivery tracking deferred.
- **Message composer — reply quoting** — showing the original report text in the reply bubble. Nice-to-have, not v2.0 launch.
- **Offline report cache** — caching reports in extension-side SQLite for offline viewing. Relay is source of truth for v2.0.
- **Real-time push** — WebSocket/SSE from relay to eliminate polling. Out of scope per PROJECT.md (v3).

## Requirements Coverage

| Decision | Requirements |
|----------|-------------|
| D-01 | TMLN-01 (chronological feed excludes noise) |
| D-02 | TMLN-02 (briefing card with blocker call-out), BRFG-05 |
| D-03 | TMLN-04 (convergence chart) |
| D-04 | TMLN-04 (chart placement), RLPH-05 |
| D-05 | TMLN-06 (interleaved chat + reports), ACHAT-02 |
| D-06 | TMLN-06 (visual distinction), ACHAT-01, ACHAT-02 |
| D-07 | TMLN-07 (Reply button), ACHAT-01 (post message from extension) |
| D-08 | TMLN-01 (ReportPanel WebviewPanel), RWKS-04 |
| D-09 | TMLN-05 (report type filtering) |
| D-10 | TMLN-08 (paginated load) |
