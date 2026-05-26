# Handoff Brief — Codex CLI (Phase 18)

**Repo:** `/Users/hksul/Dropbox/Research_obsidian/ClaudeVault2/agents/Ethan/harnesstune`
**Branch:** `main` (worktree clean as of `0b11a0f`)
**Plan:** see `.planning/v3.2-async-chat/PLAN.md` (read this first, end-to-end)
**Account:** Dealytics ChatGPT Pro
**Goal:** Fill the v3.0 gap where `harnesstune-agent`'s message routing is half-finished.

---

## Execution order

Follow the 4-commit task breakdown in `PLAN.md` exactly. Each task is a single commit, conventional commit messages, no `--no-verify`.

1. **Commit 1:** Types + config plumbing
2. **Commit 2:** Agent routing rewrite (`routeMessage` + serial queue + `runCapture`)
3. **Commit 3:** VS Code timeline integration (`chat_response` bubble pairing)
4. **Commit 4:** Tests + README + `.planning/STATE.md` update

---

## Pre-flight verification (REQUIRED)

Before writing any code that parses Claude's output, **SSH to Mac B and inspect a real `claude -p --output-format json` response**:

```bash
ssh hongkeesul@10.243.69.40 'export PATH=/opt/homebrew/bin:$HOME/.nvm/versions/node/v20.20.1/bin:$PATH; claude -p "hello, what is 2+2?" --output-format json' 2>&1 | head -100
```

Pin field names to what you observe (likely `session_id` and `result`, but VERIFY). Document the actual shape in the PR / final report.

---

## Live acceptance test (REQUIRED before declaring done)

The agent on Mac B is already running under launchd as user `hongkeesul`. After deploying your changes:

1. Rebuild + redeploy: copy the updated `packages/harnesstune-agent/dist/` to Mac B (it's Dropbox-synced, so just commit + wait for sync, OR `scp -r` after build)
2. Restart the agent on Mac B:
   ```bash
   ssh hongkeesul@10.243.69.40 'launchctl stop com.harnesstune.agent 2>/dev/null; launchctl start com.harnesstune.agent'
   ```
3. From Mac A VS Code (already has the extension installed): click the `Hongui-MacBookAir` workspace → use the "Message your agent..." input → send "what is 2 + 2?"
4. Within 90s, a `from_agent` chat bubble should appear in the timeline with "4" (or claude's verbose equivalent)
5. Send "and 3 + 3?" → "6" (proves session continuity)

If the agent isn't yet configured (no `.harnesstune/config.json` on Mac B), you'll need to set it up first. The collector's channel ID + token can be read from Mac B at `~/.harnesstune/collector.json` and written into the agent's config (path is `$CWD/.harnesstune/config.json` where CWD is the agent's working dir under launchd). Set the agent CWD to `~/.harnesstune-agent/` via the launchd plist, then write config there.

---

## Hard constraints (re-stated)

- **No new runtime dependencies.** In-house serial queue ~10 lines.
- **No relay changes.** Envelope already accepts arbitrary `type` strings.
- **No breaking changes to existing `harnesstune-agent` subcommands.**
- **No `--no-verify`.** No skipping git hooks.
- **Verify Claude JSON output shape before parsing.** Pin field names to observed reality.
- **Serial message processing only.** One Claude in-flight at a time.

---

## Reporting back

When done, return:
1. The 4 commit SHAs in order
2. Output of `pnpm test` (full suite must pass, including new tests)
3. Output of the live acceptance test (paste the bubble text you observed for "2+2" and "3+3")
4. Path to the new VSIX (if rebuilt) and its size
5. Any decision points you hit that weren't covered in `PLAN.md` (and what you decided)

If you hit a blocker not covered in the plan, **stop and report** rather than guessing.
