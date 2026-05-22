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
