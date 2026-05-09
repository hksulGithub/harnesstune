# Phase 11 Discussion Log

**Date:** 2026-04-22
**Phase:** 11 — Multi-Agent Model + Relay Extensions
**Areas discussed:** 4

## Area 1: RunReport vs ReportEnvelope

**Question:** The roadmap introduces RunReport (structured execution records) and agent_runs table, while the existing pipeline uses ReportEnvelope (narrative reports) in the reports table. How do these coexist?

**Decision:** Two-table model. `agent_runs` stores structured execution records (status, duration, cost). `reports` gets an `agentId` column for narrative report attribution. Different concerns, different tables.

## Area 2: Agent Registration Flow

**Question:** Who creates agent records in the relay? Explicit endpoint, implicit on first report, or both?

**Decision:** Both — explicit + upsert. `POST /channels/:id/agents` for full registration. Auto-create stub when report/run arrives with unknown agentId.

**Follow-up:** Platform field is freeform string (not enum) — no migration needed for new platforms.

## Area 3: Registry v2→v3 Migration

**Question:** Should local workspaces (claude-code, openclaw) get agent entries during migration?

**Decision:** Empty array for all. Migration sets `agents: []`. Remote workspaces populate from relay on first poll. Local workspaces stay empty — 1:1 relationship, no agentId concept needed yet.

## Area 4: Summary Endpoint Strategy

**Question:** Should GET /channels/:id/summary?days=N compute on-the-fly or use pre-aggregation?

**Decision:** On-the-fly aggregation with (channelId, startedAt) composite index. Expected volumes well within SQLite query-time capabilities. No pre-aggregation complexity.
