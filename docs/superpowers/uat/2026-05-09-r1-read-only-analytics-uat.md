# R1 Read-Only Analytics UAT

## Environment

1. On `Hongui-MacBookAir`, confirm `harnesstune-collector start` is running with `claude-code` and `claude-desktop` enabled and `summaries: "on"` in `~/.harnesstune/collector.json`.
2. Confirm relay is reachable and the VS Code remote workspace is connected.

## Claude Code Summary Check

1. Trigger a known Claude Code cron entry wrapped by `harnesstune-wrap --name <agent> ...`.
2. Wait one collector cycle.
3. Call the relay runs endpoint for that agent.
4. Verify the newest run contains `summary.status === "ok"` or `summary.status === "error"`.
5. If `ok`, verify `oneLineSummary`, non-empty `bullets`, `tags`, and numeric `tokenCount`.
6. If `error`, verify the main run still has the correct `status` and `durationMs`.

## Claude Desktop Summary Check

1. Trigger a scheduled Claude Desktop task from the Claude UI.
2. Wait until the matching `local_*.json` session file stops changing.
3. Wait one collector cycle.
4. Verify the corresponding relay run contains a `summary` object.
5. Verify no ad-hoc Claude Desktop chat without `scheduledTaskId` creates a summarized run.

## Dashboard Analytics Check

1. Open the Dashboard tab in VS Code.
2. Confirm the new analytics panel is visible on fleet, workspace, and agent views.
3. Confirm each view shows `24h`, `7d`, and `30d`.
4. Manually count known runs from relay for one agent.
5. Verify dashboard `runCount`, `averageDurationMs`, and `successRatePct` match the relay data.

## Reports Rendering Check

1. Open the Reports tab for the same workspace.
2. Confirm the latest `run_batch` item shows the one-line summary inline.
3. Expand the details section.
4. Confirm bullets and tags appear.
5. Confirm a summary error case renders a non-crashing fallback message.
6. Confirm no new Ask/meta-analysis UI was introduced.

## Gate

R1 passes when summaries appear for new `RunReport`s within one collector cycle of ingest and both Dashboard and Reports surfaces reflect the new data without blocking the underlying run pipeline.
