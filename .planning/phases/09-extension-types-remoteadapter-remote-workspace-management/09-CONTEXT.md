# Phase 09 Context: Extension ↔ Relay Integration

**Created:** 2026-04-19
**Phase:** 09 — Extension Types + RemoteAdapter + Remote Workspace Management
**Status:** Decisions locked

## Prior Decisions (from earlier phases)

- **Phase 06**: `BackendType = 'claude-code' | 'openclaw' | 'remote'`, `WorkspaceMode = 'local' | 'remote'` discriminant, `assertNeverBackendType()` exhaustive switch, pnpm workspaces, `packages/shared` for cross-package types
- **Phase 07**: Relay API endpoints (`GET /channels/:id/reports?since=`, `GET /channels/:id/reports/:reportId`, `POST /channels/:id/messages`, `DELETE /messages/:id`, `GET /health`), Bearer token auth (SHA-256 hash + timingSafeEqual), Turso-backed rate limiting (60 req/min)
- **Phase 08**: `ReportEnvelope` with `BriefingReportBody`, `RalphReportBody`, `HeartbeatReportBody` in `@harnesstune/shared`, Agent CLI uploads reports/heartbeats to relay

## Decisions

### D-01: RemoteAdapter polling interval — 30s default, configurable

RemoteAdapter uses `setInterval` with a 30-second default polling interval. Interval is configurable per-workspace via `pollInterval` field on `WorkspaceRecord` (stored in registry). On each tick, adapter calls `GET /channels/:id/reports?since=<cursor>` to fetch new reports.

30s balances freshness against relay load for async briefing/ralph reports. Users can increase to 60s for low-priority workspaces or decrease to 15s for active monitoring.

### D-02: Synthetic AgentEvent for remote reports

Create a new `AgentEvent` variant with `type: 'remote_report'` that wraps the `ReportEnvelope` from the relay. The existing `handleEvent` pipeline in `extension.ts` routes this event type to the dashboard and timeline UI. No transformation into existing event types (StatusUpdate, Heartbeat, etc.) — the report envelope is the native data shape.

```typescript
interface RemoteReportEvent {
  type: 'remote_report';
  timestamp: string;
  workspaceId: string;
  report: ReportEnvelope;  // from @harnesstune/shared
}
```

This keeps the event pipeline uniform (all adapters emit AgentEvents) while preserving full report fidelity for the timeline UI.

### D-03: Exponential backoff + status badge on relay errors

When RemoteAdapter encounters a network error or 5xx from the relay:

1. Switch workspace status to `'relay_unreachable'`
2. Apply exponential backoff: 30s → 60s → 120s → 5min cap
3. StatusBar shows network error badge (reuse existing error badge mechanism)
4. On 401 (token invalid): stop polling, set status to `'auth_error'`, surface re-configure prompt
5. On recovery (successful poll after errors): reset to normal interval, clear error status

This distinguishes relay-unreachable (transient, auto-retry) from token-invalid (permanent, needs user action) per RWKS-08.

### D-04: Cursor persistence — in-memory + registry

RemoteAdapter keeps the `since` cursor (ISO 8601 timestamp of latest fetched report) in memory during the session. On each successful poll, persist the cursor to `WorkspaceRecord.lastCursor` field in the registry.

On extension activation / adapter reconnect, read `lastCursor` from registry to resume where it left off. If no cursor exists (first connection), fetch last 20 reports (relay default page size).

Cursor is a single timestamp value — no need for a dedicated cursor store.

### D-05: Add Remote Workspace — 3-step QuickInput flow

`harnesstune.addRemoteWorkspace` command triggers a sequential QuickInput flow:

1. **InputBox**: Relay URL (e.g., `https://harnesstune-relay.vercel.app`). Validate format, append `/api` if bare domain.
2. **InputBox** (password mode): Agent Bearer token. Never displayed in plaintext after entry.
3. **Auto health-check**: Call `GET {relayUrl}/health` to verify relay reachable, then `GET /channels/:id/reports` with the token to verify auth. On success: auto-name workspace from channel metadata (or relay URL hostname as fallback), save to registry. On failure: show error message with "Retry" / "Cancel" options.

No manual naming step — auto-naming from channel metadata keeps the flow to 3 steps. User can rename later via Configure.

### D-06: Per-workspace token in SecretStore

Agent tokens stored with key pattern `harnesstune.relay.{workspaceId}`. Matches the existing SecretStore pattern (`harnesstune.apiKey.{provider}`).

```typescript
// Store token after successful registration
await secretStore.set(`harnesstune.relay.${workspaceId}`, token);

// Retrieve for polling
const token = await secretStore.get(`harnesstune.relay.${workspaceId}`);

// Delete on workspace removal
await secretStore.delete(`harnesstune.relay.${workspaceId}`);
```

Token is entered once via QuickInput (password mode) and never shown again. Re-entering token is available via Configure context menu action.

### D-07: Mixed sidebar list with cloud icon badge

Remote and local workspaces appear in the same flat list, sorted alphabetically. Remote workspaces display a `$(cloud)` codicon badge next to their name. Status indicators (running/idle/stale/error/relay_unreachable/auth_error) render in the same position as local workspace indicators.

No separate "Remote" section — remote workspaces are first-class citizens in the sidebar per RWKS-02.

### D-08: Right-click context menu — Message / Configure / Remove

Remote workspace context menu has three actions:

1. **Message Agent** — opens async chat compose panel for that workspace (posts to `POST /channels/:id/messages`)
2. **Configure** — QuickInput flow to update relay URL, poll interval, or re-enter token. Partial updates (only change what's needed).
3. **Remove** — disconnects workspace from registry, deletes token from SecretStore. Does NOT delete relay-side data (channel, reports, messages persist).

Same context menu pattern as local workspaces (which have Configure / Remove). Remote adds "Message Agent" as the first item.

## Canonical Refs

| What | Where |
|------|-------|
| AgentBackendAdapter interface | `src/adapters/AgentBackendAdapter.ts` |
| AdapterFactory + config | `src/adapters/AdapterFactory.ts` |
| AdapterRegistry (factory map) | `src/adapters/AdapterRegistry.ts` |
| WorkspaceRecord + BackendType | `src/types/workspace.ts` |
| WorkspaceRegistry | `src/registry/WorkspaceRegistry.ts` |
| SecretStore | `src/secrets/SecretStore.ts` |
| HostToWebviewMessage / WebviewToHostMessage | `src/types/messages.ts` |
| handleEvent pipeline | `src/extension.ts` (lines 290-336) |
| SidebarViewProvider | `src/panels/SidebarViewProvider.ts` |
| Report types (shared) | `packages/shared/src/reports.ts` |
| Relay API routes | `packages/harnesstune-relay/src/app.ts` |

## Deferred Ideas

- **WebSocket/SSE push** from relay — eliminates polling entirely. Out of scope per PROJECT.md (v3 feature).
- **Report caching** in extension-side SQLite — useful for offline viewing of historical reports. Adds complexity; relay is the source of truth for v2.0.
- **Batch workspace add** — import multiple remote workspaces from a config file. Low priority for v2.0 launch.
- **Custom workspace icons** — user-chosen icons beyond cloud badge. Nice-to-have, not v2.0.

## Requirements Coverage

| Decision | Requirements |
|----------|-------------|
| D-01 | RWKS-03 (status from report data requires polling) |
| D-02 | RLPH-01, RLPH-02, RLPH-03 (ralph reports flow through pipeline) |
| D-03 | RWKS-08 (connection error handling) |
| D-04 | RWKS-03 (cursor enables incremental report fetching) |
| D-05 | RWKS-01 (Add Remote Workspace command + QuickInput) |
| D-06 | RWKS-09 (tokens in SecretStore) |
| D-07 | RWKS-02 (mixed sidebar), RWKS-03 (status indicators) |
| D-08 | RWKS-05 (Message Agent), RWKS-06 (Configure), RWKS-07 (Remove) |
