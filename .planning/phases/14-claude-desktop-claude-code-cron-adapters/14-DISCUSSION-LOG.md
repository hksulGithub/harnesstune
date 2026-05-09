# Phase 14: Claude Desktop + Claude Code Cron Adapters - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 14-claude-desktop-claude-code-cron-adapters
**Areas discussed:** Session Correlation, Wrapper Script Design, File Watcher vs Polling

---

## Session Correlation

| Option | Description | Selected |
|--------|-------------|----------|
| Filename-based | Use session filename pattern + file mtime to correlate with scheduled task timestamps. No content parsing. | ✓ |
| initialMessage matching | Parse session file, extract initialMessage, compare against scheduled task prompt text. More precise but brittle. | |
| Timestamp proximity only | Match sessions purely by creation/modification time within a window. Simplest but may produce false matches. | |

**User's choice:** Filename-based
**Notes:** None — straightforward selection.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Ignore orphans | Only report runs that correlate to known scheduled tasks. | ✓ |
| Report as unscheduled | Include orphan sessions with synthetic 'unscheduled' agent identity. | |

**User's choice:** Ignore orphans

---

| Option | Description | Selected |
|--------|-------------|----------|
| mtime guard + full parse | Check file mtime first; skip if unchanged. When changed, parse full file and diff. | ✓ |
| Full parse every poll | Always read and parse on each 60s cycle. Simpler code, slightly more I/O. | |
| You decide | Let Claude pick during planning. | |

**User's choice:** mtime guard + full parse

---

| Option | Description | Selected |
|--------|-------------|----------|
| Status + duration + error | Extract success/failure, compute duration from timestamps, pull error. Skip token/cost. | ✓ |
| Full conversation extract | Parse full conversation for logExcerpt. Heavier, schema-dependent. | |

**User's choice:** Status + duration + error

---

## Wrapper Script Design

| Option | Description | Selected |
|--------|-------------|----------|
| Shell script | Bash wrapper — zero dependencies, captures + uploads via curl. | |
| Node.js script | TypeScript — reuses shared types and RelayClient. Requires Node in cron PATH. | |
| Shell wrapper + collector pickup | Shell captures exit code/duration/output, writes JSON to ~/.harnesstune/cron-runs/. Collector picks up on next poll. | ✓ |

**User's choice:** Shell wrapper + collector pickup
**Notes:** User provided detailed rationale: "Shell captures, collector uploads. Clean separation." Option 1 puts curl + auth token + error handling + retry logic in bash — that's a second relay client in a different language. Option 2 requires Node in cron PATH. The collector already has relay communication, retry queue, auth, and error handling built.

---

| Option | Description | Selected |
|--------|-------------|----------|
| ~/.harnesstune/bin/ via setup | Plugin setup() writes the script, makes it executable. User adds to PATH or uses full path in crontab. | ✓ |
| npm global bin | Ship as bin entry in collector package. Ties shell script to Node package manager. | |
| /usr/local/bin | System-wide, requires sudo. | |

**User's choice:** ~/.harnesstune/bin/ via setup

---

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal: exit + timing + tail | command, exitCode, startedAt, finishedAt, durationMs, outputTail. One file per run. | ✓ |
| Full RunReport shape | Already matches RunReport schema. Wrapper does more work. | |

**User's choice:** Minimal: exit + timing + tail

---

| Option | Description | Selected |
|--------|-------------|----------|
| Scan cron-runs/ filenames | discover() scans existing run files to build agent list from unique commands. | |
| Parse crontab -l | discover() runs crontab -l, greps for harnesstune-wrap entries. Sees agents before first run. | ✓ |
| Config-based registration | User registers agents during setup(). Most explicit but manual. | |

**User's choice:** Parse crontab -l

---

| Option | Description | Selected |
|--------|-------------|----------|
| Wrapper --name flag | Required flag — becomes agentId in run file. Usage error if missing. | ✓ |
| Hash of wrapped command | Auto-generate agentId from command hash. Opaque names in dashboard. | |

**User's choice:** Wrapper --name flag

---

## File Watcher vs Polling

| Option | Description | Selected |
|--------|-------------|----------|
| Polling only, drop watcher req | Daemon's 60s poll + mtime guard satisfies CDSK-05 intent. Preserves Phase 12 D-03. | ✓ |
| Daemon-level watcher | Add optional file watcher in daemon/scheduler, not in plugin. Plugin stays pure. | |
| Carve out exception | Allow Claude Desktop plugin to use fs.watch. Document as justified exception to D-03. | |

**User's choice:** Polling only, drop watcher req

---

## Claude's Discretion

- Output tail length (lines captured by harnesstune-wrap)
- Run file cleanup policy
- Claude Desktop session file glob pattern
- Error message extraction strategy

## Deferred Ideas

None — discussion stayed within phase scope
