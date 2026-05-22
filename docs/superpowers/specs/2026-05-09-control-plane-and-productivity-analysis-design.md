# Control Plane and Productivity Analysis — Design Spec

**Date:** 2026-05-09
**Status:** Draft for review
**Builds on:** Phase 14 (cron adapters, RunReport pipeline) — UAT complete

## 1. Goal

From the HarnessTune VSCode UI, control and analyze remote Claude Desktop and Claude Code agents through the existing relay — without a new inbound port on the remote machine and without a separate LLM billing surface.

A user in VSCode should be able to:

1. **Pause / resume** a scheduled agent task on a remote Mac.
2. **Modify** a task's schedule (cron expression) or payload (prompt for Claude Desktop, command line for Claude Code).
3. **See productivity stats** (counts, durations, success rates) per agent and per workspace.
4. **Read per-run summaries** of what each agent actually did.
5. **Ask higher-level questions** about a date range, agent, or workspace and get an LLM-synthesized answer.

**Out of scope:**
- Real-time streaming of agent output back to VSCode.
- Creating new agent tasks from VSCode (deferred).
- Multi-step transactional commands. Each command is one file edit.
- Rollback. If a command was applied and later regretted, the user issues a new command.

## 2. Architecture

Two planes share one transport — the existing collector poll cycle.

### 2.1 Control plane (mailbox-pull)

```
VSCode UI ──POST──▶ Relay /commands queue (per agent)
                            ▲
                            │ poll on existing collector tick
                            │
              Collector ◀───┘
                  │
                  ├─ apply with mtime / hash guard
                  │   • Claude Desktop:  edit scheduled-tasks.json (enabled, cronExpression)
                  │                      or rewrite task.filePath .md (prompt)
                  │   • Claude Code:     edit crontab line for `--name <id>` entry
                  │   • Meta-analysis:   spawn local `claude` CLI over scoped summaries
                  │
                  └─ POST ack ──▶ Relay /commands/:id/ack ──▶ VSCode shows result
```

No new inbound port on the remote Mac. Pull-only. Reuses existing bearer-token auth.

### 2.2 Analytics plane (existing data, local LLM)

```
Wrapped run completes
       │
       ├─ harnesstune-wrap post-hook spawns short `claude` CLI:
       │     "summarize the session you just finished, output JSON"
       │
       └─ RunReport + summary uploaded to Relay
                      │
                      ├─ Aggregator   → Dashboard reads stats
                      ├─ Reports list → per-run summary inline
                      └─ Ask box      → issues runMetaAnalysis command
                                         → collector spawns `claude` over scoped summaries
                                         → answer returned via ack
```

The relay never calls an LLM. All inference is local on the remote Mac, billed against the user's existing Claude account.

## 3. Components

### 3.1 Relay: `/v1/agents/:agentId/commands` (3 endpoints)

```
POST   /commands              — VSCode enqueues; returns { commandId }
GET    /commands?since=<ts>   — Collector polls; returns pending[]
POST   /commands/:id/ack      — Collector reports outcome
GET    /summaries?agentId=…&workspace=…&since=…&until=…
                              — Collector fetches summaries for a runMetaAnalysis command
```

Storage: same Vercel KV / blob store as RunReports. TTL 7 days on completed commands.

Concurrency: only one pending command per `(agentId, taskId)`. Relay rejects new commands for the same target while one is pending. Acks are idempotent by `commandId`.

### 3.2 Command schema (wire contract)

```ts
type Command =
  | { kind: 'pause',    target: { plugin: 'claude-desktop' | 'claude-code', taskId: string } }
  | { kind: 'resume',   target: {...} }
  | { kind: 'setSchedule', target: {...}, cronExpression: string }
  | { kind: 'setPayload',  target: {...},
      payload: { type: 'prompt',  markdown: string }     // Claude Desktop
              | { type: 'command', shell: string } }     // Claude Code
  | { kind: 'runMetaAnalysis',
      scope: { agentId?: string, workspace?: string, since: string, until: string },
      question: string };

type Ack = {
  commandId: string;
  status: 'applied' | 'rejected' | 'failed';
  error?: string;
  appliedAt: string;
  mtimeBefore?: number;     // for file-edit kinds
  mtimeAfter?: number;
  result?: { answer: string };  // for runMetaAnalysis
};
```

### 3.3 Collector: `CommandConsumer` module

- Hooks into existing poll tick — no new timer.
- Per command: load file → mtime guard check → apply edit → re-stat → ack.
- For `setPayload` on Claude Desktop, writes the `.md` at `task.filePath`.
- For Claude Code, rewrites the post-`--name` portion of the crontab line.
- For `runMetaAnalysis`, queries relay for summaries in scope, spawns local `claude` CLI, returns answer in ack.
- Plugin-dispatched: each plugin (`claude-desktop`, `claude-code`) exposes `applyCommand(cmd): Ack`.
- Serial per plugin — no parallel writes to the same file.

### 3.4 Wrapper: per-run summary post-hook

`harnesstune-wrap` already wraps Claude Code invocations and emits RunReports. It gains a post-run step:

1. After the wrapped command exits, capture the session transcript path.
2. Spawn a short `claude` CLI invocation: feed transcript + summarize prompt, request JSON output `{ oneLineSummary, bullets[], tags[], tokenCount }`.
3. Attach the summary blob to the RunReport upload.
4. On failure (rate limit, non-zero exit, JSON parse error): mark `summary: { status: 'error', reason }`, do not retry, do not block the main run.

Per-agent toggle: `summaries: 'on' | 'sample-1-in-N' | 'off'`. Default `on`. Configured in collector config under each plugin's section.

For Claude Desktop, the equivalent post-hook lives in the collector's existing scheduled-tasks watch loop — when a new completion is detected, the collector spawns a local `claude` summarize call against the session content.

### 3.5 VSCode surfaces

- **Sidebar agent row**: pause/resume toggle + ⋯ menu (Modify schedule, Modify payload). Optimistic UI; reconciles on ack.
- **Dashboard tab**: existing live status + new aggregation panel (last 24h / 7d / 30d, per agent and per workspace).
- **Reports tab**: existing RunReport list, summary preview inline, "Ask" box at top with scope picker (agent / workspace / date range).

No changes to: collector daemon lifecycle, auth model, VSIX bundling, RunReport upload pipeline.

## 4. Data Flows

### 4.1 Pause an agent (happy path)

1. User clicks pause on agent row.
2. VSCode → `POST /commands { kind: 'pause', target: { plugin: 'claude-desktop', taskId: 'abc' } }`.
3. Relay stores command, status `pending`; returns `commandId`.
4. VSCode sets row to "pausing…" (optimistic).
5. Next collector tick (≤ 30s): `GET /commands` → `[{ id, kind: 'pause', ... }]`.
6. Collector loads `scheduled-tasks.json`, captures mtime.
7. Collector flips `task.enabled = false`, atomic write (tmp file + rename).
8. Collector re-stats, posts `ack { applied, mtimeBefore, mtimeAfter }`.
9. VSCode receives ack → row shows "paused".

### 4.2 Modify Claude Desktop prompt

Same as 4.1, but step 7 writes the `.md` at `task.filePath` (mtime-guarded on the `.md`, not the JSON). Server-side validation: reject empty markdown, reject paths outside the configured Claude Desktop directory.

### 4.3 Modify Claude Code crontab line

Collector reads crontab via `crontab -l`, finds the line containing `harnesstune-wrap --name <id>`, replaces the post-`--name` portion, writes via `crontab -` from a temp file. Hash-of-current-crontab guard replaces the mtime guard (crontab has no stable mtime). If the hash differs from when the command was issued, reject with `crontab_changed`.

### 4.4 Per-run summary

```
Wrapped run exits
  → post-hook spawns: claude --print < transcript --prompt "summarize as JSON ..."
  → on success: attach { oneLineSummary, bullets, tags } to RunReport upload
  → on failure (rate limit / error): attach { status: 'error', reason }; main run already succeeded
  → relay stores RunReport + summary together; no separate worker
```

### 4.5 Meta-analysis

```
User types question + scope in Reports tab
  → VSCode → POST /commands { kind: 'runMetaAnalysis', scope, question }
  → collector picks up, calls GET /summaries with the same scope filters
  → spawns local `claude --print` with summaries + question
  → posts ack { status: 'applied', result: { answer } }
  → VSCode renders answer
```

Cost gate: VSCode shows scope size before submission; refuses if > N summaries unless user confirms.

## 5. Error Handling

| Failure | Detection | User-visible behavior |
|---|---|---|
| Network drop during enqueue | VSCode catch | "Queue failed — retry?"; command never reaches relay |
| Collector offline | Relay shows last-poll timestamp; command stays pending | "Agent offline (last seen Xm ago)"; auto-cancels after 24h |
| File mtime changed mid-flight | Collector mtime guard | Ack `rejected: stale`; VSCode reverts optimistic UI, shows "external change detected, refresh" |
| File missing / unparseable | Collector load step | Ack `failed: <reason>`; not auto-retried |
| Crontab write conflict | Hash guard | Same as mtime: rejected, user prompted to refresh |
| Per-run summary fails (rate limit) | Wrapper post-hook exit code | Summary cell shows "—"; main run still recorded |
| Meta-analysis fails | Collector ack | Inline error in Ask box; no partial answer shown |
| Relay storage outage | Relay 5xx | "Relay unavailable"; commands stay in local outbox until retry |
| Claude usage throttle on remote | Wrapper / meta-analysis exit code | Summaries pile up visibly; Ask box surfaces "rate-limited, try again later" |

## 6. Security

- Reuses existing bearer-token auth on the relay. No new credential surface.
- `setPayload` for Claude Desktop validates path is within the configured Claude Desktop dir (no `../`).
- `setPayload` for Claude Code rejects shell strings containing `;`, `&&`, `||`, backticks, or `$(` unless an explicit opt-in flag is set (default deny).
- LLM API key concern is removed entirely — the relay never makes inference calls. All Claude usage is the user's existing local account on the remote Mac.

## 7. Testing

**Unit**
- `claude-desktop.applyCommand` — pause/resume/setSchedule/setPayload against fixture `scheduled-tasks.json` and `.md` files. Mtime-guard rejection covered.
- `claude-code.applyCommand` — crontab line rewrite against fixture strings. Hash-guard rejection covered.
- Command schema validators — every union variant + malformed-input rejection.
- Wrapper post-hook — JSON parse, error handling, sample-rate gating.

**Integration**
- In-process relay + collector. Enqueue each command kind, assert ack roundtrip.
- Concurrency: enqueue two commands for same target — second rejected.
- Stale mtime: mutate fixture between enqueue and apply — assert `rejected: stale`.

**LLM pipeline**
- Mocked Claude CLI client by default. Snapshot summary structure (not exact text).
- Token-budget assertions on summarizer prompt.
- Meta-analysis scope-size cost gate test.
- Nightly job hits real local Claude to catch prompt drift.

**VSCode UI (manual UAT)**
- Pause toggle reflects ack within one poll cycle.
- "External change detected" banner appears when file edited outside extension mid-command.
- Dashboard aggregation matches manual count over a known fixture window.
- Ask box returns answer; shows scope size before submission.

**End-to-end smoke**
- Live `Hongui-MacBookAir` agent. Scripted scenario: pause Claude Desktop task → verify `enabled: false` on remote → resume → verify next scheduled run fires.

## 8. Rollout

| Phase | Scope | Gate |
|---|---|---|
| **R1 — Read-only analytics** | Per-run summary post-hook + Reports tab summary preview + Dashboard aggregation panel. No control plane. | Summaries appear for new RunReports within one collector cycle of ingest. |
| **R2 — Control: pause/resume** | Relay /commands endpoints + collector consumer + sidebar toggle. Only `pause` / `resume`. | Toggle round-trips on Hongui-MacBookAir in < 60s. |
| **R3 — Control: modify** | Adds `setSchedule` + `setPayload`. UI: ⋯ menu with two modal editors. | Edits persist + survive collector restart. |
| **R4 — Meta-analysis** | `runMetaAnalysis` command + Ask box. | Scope cost gate works; one real query under $0.05 in Claude usage. |

**Order rationale:** R1 ships value with zero risk to the remote machine (read-only). R2 is the smallest possible control-plane surface to validate the mailbox-pull pattern. R3 reuses R2's transport. R4 is the most expensive — last.

## 9. Observability

- Relay logs: command lifecycle (enqueued / picked / acked / expired) per agent.
- Collector logs (already present): apply outcomes with mtime values.
- VSCode dev console: optimistic → reconciled transitions.
- Wrapper exit codes already feed RunReport `exitCode`; summary failures attach a status field.

## 10. Open Questions

1. **Per-agent summary toggle default.** Default to `on`; expose `sample-1-in-N` and `off` in agent config.
2. **Summary retention.** Recommend same TTL as RunReports (current default).
3. **Meta-analysis cost gate threshold N.** Recommend 200 summaries by default — tune after R4 dogfooding.
4. **Claude Desktop summarizer trigger.** Claude Desktop sessions are not invoked via `harnesstune-wrap`. The collector's existing scheduled-tasks watch loop must spawn the summarizer when it detects a new completion. Confirm the watch loop has access to the session transcript path.
