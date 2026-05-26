# Phase 18 (v2) — Live Claude Session Bridge via PTY Wrapper

**Milestone:** v3.2
**Owner of plan:** Ethan
**Implementer:** Claude (Codex unreliable; see session log)
**Date:** 2026-05-27

---

## What was wrong with Phase 18 v1

v1 plan (now discarded) spawned a fresh `claude -p` per inbound message. Two fatal problems:

1. **No real session continuity** — every message is a new Claude conversation despite `--resume`. The user actually wants to chat with a long-lived claude process.
2. **Keychain auth fails non-interactively** — `claude` invoked via SSH/launchd/cron crashes inside its JWT decoder because macOS Keychain isn't unlockable outside a graphical login session.

Together these mean v1's architecture is wrong AND can't even run.

---

## What we're actually building

A wrapper command — `harnesstune-agent attach -- claude` — that the user runs **inside an interactive Terminal session on Mac B**. The wrapper:

1. Spawns `claude` in a real pseudo-terminal (PTY) — so Claude detects a TTY, runs in interactive mode, and inherits the user's keychain access
2. Acts as a transparent proxy between the user's actual terminal and the PTY — they keep typing in claude normally
3. Mirrors PTY output to the relay in time-batched chunks (every ~2s) as `from_agent` reports
4. Polls the relay every 10s for `to_agent` messages and writes them into the PTY stdin (visible in the local terminal — no surprise injection)

End-state UX:
- User keeps a Terminal tab open on Mac B with `harnesstune-agent attach -- claude` running
- They chat with claude there as usual
- From Mac A VS Code, they send a chat message → it appears in Mac B's terminal as if typed → claude responds → response appears in Mac A's timeline within ~2-5s

## Acceptance

1. On Mac B (interactive Terminal): `harnesstune-agent attach -- claude` — claude starts normally
2. From Mac A VS Code: send "what is 2 + 2?" → see message appear in Mac B's terminal → see "4" in Mac A's timeline within 10s
3. From Mac A: send "and 3 + 3?" → see "6" → session continuity is automatic (it's the same claude process)
4. User can also type locally on Mac B during the conversation — works without conflict (or at worst, prompts interleave; documented limitation for v1)
5. Existing `harnesstune-agent start` / `stop` / `register` / `report` subcommands unaffected

---

## Architecture

```
Mac B Terminal (user's interactive session)
        │
        │ keys typed
        ▼
   harnesstune-agent attach
        │   ┌─────────────────────────┐
        │   │ node-pty spawned claude │
        │   └─────────────────────────┘
        ├─── user input ────► PTY stdin
        ├──── PTY stdout ───► user terminal stdout
        │
        ├──── PTY stdout ───► output buffer ──every 2s──► POST relay /reports (type: chat_response)
        │
        └──── poll relay /messages every 10s ──► PTY stdin (visible in terminal)
```

## Files touched

**New:**
- `packages/harnesstune-agent/src/commands/attach.ts` (~150 lines)

**Modified:**
- `packages/harnesstune-agent/src/cli.ts` — register `attach` subcommand
- `packages/harnesstune-agent/package.json` — add `node-pty` to dependencies
- `packages/harnesstune-agent/src/config.ts` — no change (reuses existing config)
- `src/webview/reports/components/TimelineFeed.tsx` (or equivalent) — render `chat_response` reports as agent-side ChatBubbles (paired with outbound user messages where possible)
- `src/types/messages.ts` (or wherever timeline types live) — add `ChatResponseReportBody` discriminant
- `README.md` — new "Chat with a live remote Claude session" section
- `.planning/STATE.md` — v3.2 entry

## Commit breakdown

1. **`feat(agent): add attach subcommand skeleton + node-pty dep`**
   - New `attach.ts` with config load + PTY spawn + transparent bidirectional terminal proxy
   - No relay integration yet — just `harnesstune-agent attach -- claude` works as a transparent wrapper locally
   - Wire into cli.ts
   - Add `node-pty` to dependencies, regenerate lockfile
2. **`feat(agent): bridge PTY output + relay polling for live chat`**
   - Output buffer + 2s flush → POST as `chat_response` envelope
   - Poll loop for `to_agent` messages → write to PTY stdin
   - Graceful shutdown (Ctrl-C, exit code from claude)
3. **`feat(reports): render chat_response as agent ChatBubble in timeline`**
   - Pair `chat_response` reports with outbound messages where possible
   - Reuse existing ChatBubble component
4. **`docs: README + STATE.md for v3.2 chat bridge; rebuild VSIX`**
   - README usage section
   - STATE.md v3.2 entry
   - Repackage VSIX

## Hard constraints

- **One new runtime dep:** `node-pty` (necessary for real PTY; no alternative). Document in commit message.
- **No relay changes** — envelope accepts arbitrary `type`.
- **No new VS Code permissions** — chat already supported.
- **Don't break existing agent subcommands.**
- **Conventional commits, no `--no-verify`.**

## Open items for v1 / deferred to v1.1

- **Concurrency annotation** — distinguish user-typed-locally vs. Mac-A-injected input in the relay POSTs. v1: doesn't matter; both look the same.
- **Output stripping** — claude TUI uses ANSI escape codes; raw mirror will include them. v1: POST raw; VS Code can render or strip. Strip on the agent side if it looks ugly.
- **Reconnect** — if the agent restarts, the in-flight claude session dies. No auto-reattach. User must rerun.
- **Multiple parallel sessions** — only one attached agent per channel. If user runs `attach` twice, relay sees two sources; v1 just lets them race.

## Verification

1. `pnpm build` clean
2. `pnpm test` green (no new tests required for v1; PTY behavior is hard to unit-test cleanly)
3. Manual smoke on Mac B:
   - Open Terminal via screen share
   - Run `harnesstune-agent attach -- claude`
   - Verify claude starts, type something locally — works
   - From Mac A VS Code, send a message — verify appears in Mac B Terminal and Claude's response shows in Mac A timeline
4. Rebuild VSIX, install on Mac A
