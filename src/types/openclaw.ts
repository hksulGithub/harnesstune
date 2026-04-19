/**
 * HarnessTune OpenClaw Integration Spec -- v1
 *
 * OpenClaw agents must write JSONL events to:
 *   ~/.harnesstune/openclaw/<agentId>/events.jsonl
 *
 * Each line must be a valid JSON object matching this interface.
 */
export interface OpenClawEvent {
  type: string;           // 'session_start' | 'tool_use' | 'tool_result' | 'session_end'
  agent_id: string;       // unique per agent instance; used as sessionId
  timestamp: string;      // ISO 8601
  data?: Record<string, unknown>;  // event-specific payload
}
