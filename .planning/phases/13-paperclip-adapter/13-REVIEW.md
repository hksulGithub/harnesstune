---
phase: 13
phase_name: paperclip-adapter
status: issues_found
depth: standard
files_reviewed: 5
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
---

# Phase 13 — Paperclip Adapter: Code Review

## Critical

### CR-01 — SSRF via user-supplied `serverUrl`

**File:** `packages/harnesstune-collector/src/plugins/paperclip/client.ts` (lines 25-28)
**Also:** `packages/harnesstune-collector/src/plugins/stubs/paperclip.ts` (line 64)

The `PaperclipClient` constructor accepts an arbitrary `serverUrl` that is used directly in `new URL(...)` to make HTTP requests. A malicious or misconfigured `serverUrl` value (e.g., `http://169.254.169.254/latest/meta-data/` or `http://localhost:8080/admin`) could cause the collector to make requests to internal services (SSRF).

**Suggested fix:** Validate `serverUrl` at construction time — at minimum, reject non-HTTPS URLs, loopback addresses, link-local ranges, and private RFC-1918 ranges. Consider an allowlist of known Paperclip domains if the product supports hosted-only deployments.

```typescript
const parsed = new URL(serverUrl);
if (parsed.protocol !== 'https:') {
  throw new Error('Paperclip server URL must use HTTPS');
}
```

---

## Warning

### WR-01 — Unbounded pagination can exhaust memory

**File:** `packages/harnesstune-collector/src/plugins/paperclip/client.ts` (lines 73-96)

`getAll<T>()` accumulates all pages into a single in-memory array with no upper bound. A misconfigured or adversarial API could return `hasMore: true` indefinitely (with or without valid data), causing OOM. This also applies to legitimate large datasets.

**Suggested fix:** Add a `maxPages` guard (e.g., 100) and/or a `maxResults` limit. Log a warning if the cap is hit.

```typescript
const MAX_PAGES = 100;
let pageCount = 0;
do {
  if (++pageCount > MAX_PAGES) {
    console.warn(`Paperclip: hit max page limit (${MAX_PAGES}) on ${path}`);
    break;
  }
  // ...existing fetch logic...
} while (cursor);
```

### WR-02 — Sequential per-agent API calls create O(N) waterfall

**File:** `packages/harnesstune-collector/src/plugins/stubs/paperclip.ts` (lines 113-117, 134-139)

`collectRuns()` issues `getTaskSessions()` and `getActivity()` sequentially for every agent. With many agents this becomes very slow and risks hitting API rate limits unpredictably.

**Suggested fix:** Use `Promise.all` (or `Promise.allSettled`) with a concurrency limiter (e.g., `p-limit`) to parallelize requests with a bounded concurrency of 3-5.

### WR-03 — `mapActivitiesToEvents` produces RunReports with hardcoded `status: 'success'`

**File:** `packages/harnesstune-collector/src/plugins/paperclip/mappers.ts` (lines 66-77)

Activity events are mapped to `RunReport` with `status: 'success'` and `durationMs: 0`. These synthetic runs are indistinguishable from real runs in downstream processing, which could corrupt success-rate metrics, SLA calculations, and cost aggregation.

**Suggested fix:** Either (a) use a distinct status value like `'info'` if the `RunReport.status` union is extended, or (b) add a discriminator field (e.g., `synthetic: true`) so downstream consumers can filter them, or (c) return these as a separate data type rather than mixing them into `RunReport[]`.

### WR-04 — API key prompted in cleartext

**File:** `packages/harnesstune-collector/src/plugins/stubs/paperclip.ts` (line 57)

`rl.question('Paperclip Board API Key: ')` echoes the API key to stdout as the user types. Readline does not support hidden input natively.

**Suggested fix:** Use a library like `read` or a custom raw-mode stdin reader to mask the input, or note in the prompt that the key will be visible.

---

## Info

### IR-01 — `durationMs` fallback can produce negative values

**File:** `packages/harnesstune-collector/src/plugins/paperclip/mappers.ts` (lines 19-21)

When `session.durationMs` is absent, the fallback computes `finishedAt - startedAt`. If the API returns malformed timestamps (e.g., `finishedAt` before `startedAt`, or unparseable strings), `durationMs` could be negative or `NaN`. Neither case is guarded.

**Suggested fix:** Clamp to `Math.max(0, ...)` and guard against `NaN`:

```typescript
const computed = new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime();
const durationMs = session.durationMs ?? (Number.isFinite(computed) ? Math.max(0, computed) : 0);
```

### IR-02 — Module-level side effect in `loader.ts`

**File:** `packages/harnesstune-collector/src/plugins/loader.ts` (line 37)

`ALL_PLUGINS` is evaluated at module load time via `buildPlugins()`. This means importing `loader.ts` in tests will attempt to read `collector.json` from disk and construct real plugin instances. This makes unit testing harder and can cause unexpected side effects during import.

**Suggested fix:** Consider lazy initialization (e.g., a `getPlugins()` function that builds on first call) or dependency injection to improve testability.

---

## Summary

The implementation is well-structured and follows the existing plugin patterns cleanly. The type mappings are accurate against the `AgentIdentity` and `RunReport` interfaces. The main concerns are: (1) the SSRF vector from unvalidated server URLs, (2) unbounded pagination, and (3) synthetic activity events being mixed into real run data. Items WR-03 and CR-01 should be addressed before production use.
