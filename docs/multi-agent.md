# Multi-Agent Support in `attach`

## Overview

The `attach` subcommand uses a strategy pattern to support multiple AI coding tools as bridgeable backends. Each tool is encapsulated in a single `AgentTranscriptStrategy` object that tells `attach` how to inject startup flags, where the tool writes its transcript on disk, how to filter candidate transcript files, and how to parse new bytes into clean assistant text. The PTY pipeline, relay polling loop, 429 backoff, and `postReport` logic are tool-agnostic and never change when a new backend is added.

## Supported agents

| id      | label            | Transcript path                                                        |
|---------|------------------|------------------------------------------------------------------------|
| `claude` | Claude Code     | `~/.claude/projects/<sanitized-cwd>/<session-uuid>.jsonl`              |
| `agy`   | Antigravity CLI  | `~/.gemini/antigravity-cli/brain/<convo-uuid>/.system_generated/logs/transcript.jsonl` |

## Adding a new strategy

1. Create `packages/harnesstune-agent/src/strategies/<name>.ts` implementing `AgentTranscriptStrategy` (see `types.ts` for the interface).
2. Register it in `packages/harnesstune-agent/src/strategies/index.ts` — add an import and a `[strategy.id]: strategy` entry in `REGISTRY`.
3. Run `pnpm run build` and verify the sanity check (`resolveStrategy('<name>')?.label`) returns the expected label.

That's it. No changes to `attach.ts` are needed.

## Note on agy's convo-UUID layout

`agy` creates a fresh UUID per conversation under `~/.gemini/antigravity-cli/brain/<uuid>/`. Because the active conversation UUID is not known ahead of time, the `agy` strategy sets `recursiveTranscriptSearch: true` and `transcriptFilenameFilter` to match only `transcript.jsonl` (excluding `transcript_full.jsonl`). The watcher in `attach.ts` walks the entire `brain/` subtree, snapshots all matching files at message-injection time, and picks the one that grows — the same active-file-detection approach used for claude's multi-session rotation.
