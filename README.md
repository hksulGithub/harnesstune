# HarnessTune

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
