# Handoff Brief — Codex CLI

**Account:** Dealytics (`dealytics5unicorn@gmail.com`) · ChatGPT Pro plan, active until 2026-06-10
**Invocation:** `cd harnesstune && codex exec "$(cat HANDOFF_CODEX.md)"` for non-interactive, or just `codex` in the folder for interactive
**Repo:** `/Users/hksul/Dropbox/Research_obsidian/ClaudeVault2/agents/Ethan/harnesstune`
**Plan:** see `UAT_REMEDIATION_PLAN.md` (read this first)
**Branch state:** dirty worktree with in-progress v3.1 followups — do NOT discard or stash without review
**Execution order:** Phase B → Phase A → Phase C → Phase D

---

## Phase B — Seed script (do this first; it unblocks everything else)

Create `scripts/seed-uat.sh` that:
- Starts the local relay (use the existing relay binary in `packages/harnesstune-relay`) on a fixed port.
- Registers two workspaces:
  - **ws-populated**: 3 agents — `agent-fresh` (running, last heartbeat <1min), `agent-stale` (idle >24h), `agent-failing` (last 3 runs exit non-zero). Each agent gets 3 historical runs with realistic durations, exit codes, and timestamps spread across the last 7 days. At least one run triggers a token-usage alert; at least one triggers a stale-agent alert.
  - **ws-empty**: zero agents (this exists to re-verify the empty-state fix from Phase A).
- Idempotent: rerunning resets to the same known state.
- Prints the connect URL for the user to paste into "Add Remote Workspace".

Document under a "Local UAT" heading in `README.md` (incremental edit, not a rewrite).

---

## Phase A — Empty-state copy (UAT-7 fix)

When a workspace has zero agents / runs / topology / schematic data, fill the panels with **instructional** copy, not blank rectangles.

Example strings (use these or close paraphrases):
- Agents panel: "No agents connected yet. Run `scripts/install-collector.sh` on a machine to see it here."
- Runs panel: "No runs recorded. Runs appear here once an agent executes a task."
- Topology panel: "Topology will render once at least one agent is connected."
- Schematic panel: "Schematic will render once an agent reports its task graph."

Add a snapshot test for the empty workspace case in the existing webview test harness. No new deps.

---

## Phase C — Duplicate workspace dedupe

Fleet view currently shows the local workspace twice — once as `local`, once via relay fanout. Fix the fleet-builder reducer so:
- Workspaces are deduped by workspace ID.
- When a workspace appears in both local and relay sources, prefer the local entry and surface relay status as a badge on that card.
- Add a unit test against the reducer covering the local+relay overlap case.

---

## Phase D — Re-run UAT and commit

1. Run the seed script. Launch the dev host. Walk UAT-1 through UAT-10. All must PASS.
2. Stage only files touched in Phases A–C plus the two planning docs (`UAT_REMEDIATION_PLAN.md`, `HANDOFF_CODEX.md`).
3. One commit per phase, conventional commit messages, in order A → B → C, then a final commit for the planning docs.
4. Repackage VSIX. Target <1.5 MB.
5. Report back: VSIX path, commit SHAs, UAT pass confirmation.

---

## Hard constraints

- No new runtime dependencies.
- Do not restructure existing layouts — only fill blanks and fix the reducer.
- Do not skip git hooks. Do not `--no-verify`.
- If you hit a decision point not covered here, stop and report rather than guessing.

## Completion Note (2026-05-22)

Codex implemented Phases A, B, and C and recorded the Phase D relay/dev-host blocker in `UAT_REMEDIATION_PLAN.md`. The root README was absent at execution time, so Local UAT documentation was added as a minimal new `README.md`.
