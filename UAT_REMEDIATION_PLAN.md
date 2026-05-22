# Harnesstune — UAT Remediation Plan

**Status:** Draft — handoff brief for implementer (Gavin / Codex / gemini-coder)
**Owner of plan:** Ethan
**Date:** 2026-05-10
**Source:** UAT run against v3.1 followups on dev host (2026-05-10)

---

## Why this plan exists

Live UAT against the v3.1 followups VSIX surfaced two real defects and a structural gap that blocks 7 of 10 UAT items. The worktree is currently dirty; nothing should be committed until the fixes below land.

**Confirmed working:** Fleet renders 8 workspaces, relay-unreachable copy fires correctly, VSIX packages cleanly (1.23 MB, 25 files), 15 test suites / 71 tests green.

**Confirmed broken or untestable:**
1. **UAT-7 — Empty-state regression.** Clicking a workspace with zero agents yields blank Agents / Runs / Topology / Schematic panels. No "No agents yet" copy. Looks like a dead UI.
2. **Duplicate workspace entries.** The local workspace appears twice on the fleet — once as `local`, once via relay fanout. Likely a fanout dedupe miss on the relay /reports route.
3. **No fixture or seed script.** `scripts/` contains only `install-collector.sh`. There is no path to populate a workspace with agents/runs/alerts, so UAT-3 through UAT-10 cannot be exercised end-to-end.

---

## Phase A — Empty-state copy (UAT-7 fix)

**Goal:** When a workspace has zero agents / zero runs / no topology / no schematic data, the corresponding panel renders a clear empty state, not a blank rectangle.

**Acceptance:**
- Clicking a workspace with no agents shows "No agents connected yet" copy in the Agents panel and equivalent copy in Runs, Topology, and Schematic.
- Empty-state copy includes a primary action where it makes sense (e.g., "Install collector" link in Agents panel pointing at `scripts/install-collector.sh`).
- Visual regression: snapshot test added for the empty workspace case in the existing webview test harness.

**Scope guardrails:**
- No new dependencies.
- No restructuring of the workspace detail layout. Only fill the blank panels with content.

**Estimated size:** Small — 1 webview component change per panel + 1 snapshot test.

---

## Phase B — Fixture / seed script

**Goal:** A single command produces a deterministic local dataset sufficient to exercise every UAT path.

**Deliverable:** `scripts/seed-uat.sh` (or `pnpm seed:uat`) that:
- Spins up a local relay on a fixed port.
- Registers 2 workspaces.
- Workspace 1: 3 agents (1 fresh / running, 1 stale / idle, 1 failing). Each agent has 3 historical runs with realistic timestamps, durations, and exit codes. At least one run trips a token-usage alert and at least one trips a stale-agent alert.
- Workspace 2: zero agents (so UAT-7 empty-state can be re-verified).
- Output: prints connect URL the user can paste into "Add Remote Workspace".
- Idempotent: rerunning resets to the same known state.

**Acceptance:**
- Running the script and opening the dev host lets the user complete UAT-3 through UAT-10 without further setup.
- Script documented in `README.md` under a "Local UAT" heading (incremental edit, not a rewrite).

**Scope guardrails:**
- Use existing collector/relay binaries — do not write a parallel test harness.
- No CI integration in this phase. Local-only.

**Estimated size:** Medium — touches collector CLI invocation, relay HTTP setup, and a small fixtures JSON.

---

## Phase C — Duplicate workspace dedupe

**Goal:** A workspace that is both locally connected and reachable via relay fanout appears exactly once in the fleet view.

**Acceptance:**
- Fleet view shows N workspaces, where N equals the number of *distinct* workspace IDs across local + relay sources.
- Tie-breaker: prefer the local connection over the relay shadow when both exist; surface the relay status as a badge on the local card rather than as a second card.
- Unit test added against the fleet-builder reducer covering the local+relay overlap case.

**Estimated size:** Small — fleet aggregation reducer + one test.

---

## Phase D — Re-run UAT and commit

**Goal:** Close out the v3.1 followups branch cleanly.

**Steps:**
1. Run `pnpm seed:uat`, re-launch dev host.
2. Walk UAT-1 through UAT-10. All must PASS.
3. Stage only the files touched in Phases A–C (plus this plan). Diff-review before commit.
4. Single commit per phase, in order A → B → C. Conventional commit messages.
5. Repackage VSIX. Confirm size delta is reasonable (<1.5 MB target).

---

## Handoff notes for the implementer

- The dirty worktree contains in-progress v3.1 followups. Do **not** discard it — stage and review first.
- Empty-state copy strings should be reviewed by the user (Hong Kee Sul) before merge — keep them in one file so review is one diff.
- The fixture script is the unblocker. If time-boxed, prioritize Phase B over Phase A.
- Implementation will be handed to **Codex CLI** (Dealytics ChatGPT Pro account, verified 2026-05-22). See `HANDOFF_CODEX.md`.

---

## Decisions (locked 2026-05-22)

1. **Handoff target: Codex CLI** (Dealytics ChatGPT Pro account, verified 2026-05-22). All three phases are mechanical and touch multiple files — fits the delegation profile per `feedback_codex_subagent.md`.
2. **Empty-state copy tone: instructional.** A user staring at an empty workspace needs a next step, not just an acknowledgement. Example: "No agents connected yet. Run `scripts/install-collector.sh` on a machine to see it here."
3. **Seed script relay-unreachable scenario: skip.** UAT-2 already covers this organically by stopping the relay process; adding it to the seed script is marginal value.

## Execution Notes (2026-05-22)

- Phase A implemented instructional empty states for Agents, Runs, Topology, and Schematic, with a webview snapshot test.
- Phase B added `scripts/seed-uat.sh` and Local UAT README documentation. The repo did not have an existing root `README.md`, so the Local UAT section was added in a minimal new file.
- Phase C added fleet summary deduplication by workspace ID, preferring local summaries and surfacing relay shadow status as a badge.
- Local relay launch was blocked in this Codex sandbox by `listen EPERM`; the seed script did build and seed the deterministic local database before the listener failed.
