# HarnessTune

## Chat with a live remote Claude session (v3.2+)

Run an interactive Claude session on a remote Mac and chat with it asynchronously from VS Code on another machine. Each remote message appears in the live terminal session as if typed, and Claude's responses stream back to VS Code in ~2s batches.

**On the remote Mac (interactive Terminal — keychain must be unlocked):**
```sh
# One-time setup: write ~/.harnesstune-agent/.harnesstune/config.json
# pointing at your relay URL + channel token. Easiest path: reuse the
# collector's channel from ~/.harnesstune/collector.json.

cd ~/.harnesstune-agent
~/.harnesstune/bin/harnesstune-agent attach -- claude
```

**On the client machine (VS Code with HarnessTune installed):**
1. **HarnessTune: Add Remote Workspace** — paste your relay URL + token (or reuse an existing workspace if same channel)
2. Click the workspace card → open Chat panel → send messages
3. Replies stream into the "All" and "Chat" tabs of the Reports panel as agent ChatBubbles

`Ctrl-]` in the attached terminal detaches the harnesstune bridge without killing the underlying Claude session.

The attach wrapper runs Claude in a real PTY, so TUI rendering + macOS Keychain authentication both work (unlike non-interactive `claude -p` over SSH/launchd).

## Local UAT

Run the deterministic local UAT fixture from the repo root:

```sh
scripts/seed-uat.sh
```

The script builds and starts the local relay on `http://127.0.0.1:8787/api`, resets the UAT database, and prints the tokens for two remote workspaces:

- `ws-populated` has three agents: fresh, stale, and failing. Each has three historical runs, plus seeded token-usage and stale-agent alert reports.
- `ws-empty` has no agents and is used to verify empty workspace states.

In the VS Code extension dev host, run **HarnessTune: Add Remote Workspace**, paste the printed relay URL, then paste the token for the workspace you want to inspect. Re-running the script is safe and resets the same fixture state.

### Automated UAT suite

With the relay running, run:

```sh
pnpm test:uat
```

This executes `tests/integration/uatRelayLive.test.ts` against the live relay (re-seeding the DB in `beforeAll`) and codifies UAT-3 through UAT-7 as Jest assertions:

- **UAT-3** RelayClient auth, agent/report/run/summary endpoints
- **UAT-4** `fleetBuilder.mergeWorkspaceSummaries` dedup + `relayStatus` bubble-up
- **UAT-5** `RemoteFleetProvider` health classification (failing / degraded / healthy / no-data)
- **UAT-6** `AlertEngine` problem transitions for stale + failing agents
- **UAT-7** `RemoteAdapter.getTimelineItems` (heartbeats filtered, newest-first, empty channel)

The suite is gated by the `UAT_RELAY_URL` env var, so the default `pnpm test` continues to pass when the relay is not running. UAT-1 (sidebar mount) and UAT-9 (relay reconnect UX) remain manual smoke items in the VS Code dev host.
