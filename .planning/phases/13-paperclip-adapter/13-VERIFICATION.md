---
phase: 13
phase_name: paperclip-adapter
status: human_needed
must_haves_verified: 8/8
requirements_covered: [PCLP-01, PCLP-02, PCLP-03, PCLP-04, PCLP-05, PCLP-06, COLL-05, COLL-06]
requirements_missing: []
---

# Phase 13 Verification: Paperclip Adapter

## Phase Goal

> The collector's Paperclip plugin pulls agent data, run history, and cost metrics from a Paperclip instance via its REST API, and reports them through the relay.

## Requirement Verification

### PCLP-01: REST API polling with Bearer auth
**Status:** PASS (code verified)

`PaperclipClient` constructor (client.ts:25-31) sets `Authorization: Bearer ${apiKey}` in headers. All five public methods delegate to `getAll<T>` (client.ts:73-96) which uses `fetch()` with these headers on every request. Non-2xx responses throw `PaperclipApiError` with status and path but never the API key.

- File: `packages/harnesstune-collector/src/plugins/paperclip/client.ts`

### PCLP-02: Agent discovery endpoint
**Status:** PASS (code verified)

`PaperclipClient.getAgents(companyId)` (client.ts:39-41) calls `GET /api/companies/${companyId}/agents`. `PaperclipPlugin.discover()` (paperclip.ts:95-101) calls `client.getAgents()` and maps results through `mapAgent()` which returns `AgentIdentity` with `platform: 'paperclip'`.

- Files: `client.ts:39-41`, `stubs/paperclip.ts:95-101`, `mappers.ts:6-15`

### PCLP-03: Run history (task sessions)
**Status:** PASS (code verified)

`PaperclipClient.getTaskSessions(agentId, since)` (client.ts:44-48) calls `GET /api/agents/${agentId}/task-sessions?since=`. `PaperclipPlugin.collectRuns()` (paperclip.ts:103-147) iterates all discovered agents and calls `getTaskSessions()` for each, mapping via `mapTaskSession()` which produces `RunReport` with `agentId`, `startedAt`, `finishedAt`, `status`, `durationMs` (with fallback computation from timestamps), `logExcerpt`, `errorSummary`, `tokenUsage`, `costCents`.

- Files: `client.ts:44-48`, `stubs/paperclip.ts:108-117`, `mappers.ts:18-39`

### PCLP-04: Cost data per agent
**Status:** PASS (code verified)

`PaperclipClient.getCostsByAgent(companyId, from, to)` (client.ts:52-58) calls `GET /api/companies/${companyId}/costs/by-agent?from=&to=`. `collectRuns()` (paperclip.ts:119-130) checks for runs with null `costCents`, then calls `getCostsByAgent()` and applies `enrichWithCosts()` which is a pure function that only patches null values (D-03 priority). Cost enrichment is best-effort with try/catch.

- Files: `client.ts:52-58`, `stubs/paperclip.ts:119-130`, `mappers.ts:46-58`

### PCLP-05: Activity/audit mapping
**Status:** PASS (code verified)

`PaperclipClient.getActivity(companyId, agentId, since)` (client.ts:61-67) calls `GET /api/companies/${companyId}/activity?agentId=&since=`. `collectRuns()` (paperclip.ts:132-144) iterates agents and calls `getActivity()`, mapping through `mapActivitiesToEvents()` which converts activities to lightweight `RunReport` entries with `[eventType] detail` in `logExcerpt`. Activity collection is best-effort with try/catch.

- Files: `client.ts:61-67`, `stubs/paperclip.ts:132-144`, `mappers.ts:66-77`

### PCLP-06: Setup prompts for server URL + API key
**Status:** PASS (code verified)

`PaperclipPlugin.setup()` (paperclip.ts:48-93) uses `readline/promises` to prompt for server URL (with default from existing config) and Board API Key. Validates credentials by calling `client.getCompanies()`. Auto-selects company if only one exists, otherwise prompts user to choose. Returns `{ serverUrl, apiKey, companyId }`.

- File: `stubs/paperclip.ts:48-93`

### COLL-05: Per-agent run reporting
**Status:** PASS (code verified)

`collectRuns()` iterates all agents individually (paperclip.ts:113-117): `for (const agent of agents) { const sessions = await this.client.getTaskSessions(agent.id, since); }`. Each `RunReport` carries `agentId`. The scheduler (scheduler.ts:68-89) uploads each run to the relay as a `run_batch` report with the `agentId` preserved.

- Files: `stubs/paperclip.ts:113-117`, `daemon/scheduler.ts:68-89`

### COLL-06: Historical batch sync (7-day backfill)
**Status:** PASS (code verified)

Scheduler (scheduler.ts:64) defaults the cursor to `new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)` when no prior cursor exists for a plugin. On first connect, this causes the plugin to fetch 7 days of history. The `collectRuns(since)` method on PaperclipPlugin passes this `since` directly to `getTaskSessions()`, `getCostsByAgent()`, and `getActivity()`.

- File: `daemon/scheduler.ts:64`

## Must-Haves Checklist

| # | Must-Have | Verified |
|---|-----------|----------|
| 1 | PaperclipClient class with Bearer auth and 5 public methods | YES — client.ts has getCompanies, getAgents, getTaskSessions, getCostsByAgent, getActivity |
| 2 | PaperclipApiError typed error class for non-2xx responses | YES — client.ts:10-19 |
| 3 | Internal pagination handling (getAll generic method) | YES — client.ts:73-96, cursor-based |
| 4 | mapAgent returns AgentIdentity with platform='paperclip' | YES — mappers.ts:6-15 |
| 5 | mapTaskSession returns RunReport with computed durationMs fallback and optional tokenUsage/costCents | YES — mappers.ts:18-39 |
| 6 | enrichWithCosts patches only runs with null costCents (D-03 priority) | YES — mappers.ts:46-58 |
| 7 | mapActivitiesToEvents for PCLP-05 audit trail | YES — mappers.ts:66-77 |
| 8 | All 6 Paperclip API response type interfaces defined | YES — types.ts has PaperclipCompany, PaperclipAgent, PaperclipTaskSession, PaperclipCostEntry, PaperclipActivity, PaperclipPaginatedResponse |

## Status: human_needed

All 8 requirements are implemented in code and match the PLAN specifications. Code compiles per SUMMARY reports. However, end-to-end verification requires a live Paperclip instance to confirm:

1. Actual API response shapes match the assumed type interfaces
2. Pagination cursor behavior works with real Paperclip API
3. Cost enrichment fallback correctly patches real cost data
4. Activity endpoint returns data in the expected format
5. Setup credential validation flow works against a real server

No gaps found in the implementation relative to the requirements. The `human_needed` status reflects the inability to integration-test without a Paperclip instance.

## Files Verified

- `packages/harnesstune-collector/src/plugins/paperclip/types.ts` (6 interfaces)
- `packages/harnesstune-collector/src/plugins/paperclip/client.ts` (PaperclipClient + PaperclipApiError)
- `packages/harnesstune-collector/src/plugins/paperclip/mappers.ts` (4 mapping functions)
- `packages/harnesstune-collector/src/plugins/stubs/paperclip.ts` (PaperclipPlugin — promoted from stub)
- `packages/harnesstune-collector/src/plugins/loader.ts` (config injection via buildPlugins)
- `packages/harnesstune-collector/src/plugins/interface.ts` (PlatformPlugin interface)
- `packages/harnesstune-collector/src/daemon/scheduler.ts` (7-day backfill default, relay upload loop)
