/** Raw event record from a single line of an OpenClaw JSONL log */
export interface OpenClawEvent {
  ts: string;          // ISO 8601 timestamp
  agentId: string;     // subdirectory name under ~/.openclaw/agents/
  type: string;        // event kind e.g. 'start' | 'finish' | 'error' | 'tool_call' | 'message'
  exitCode?: number;   // process exit code, present on 'finish' events
  logLine?: string;    // human-readable log text for the event
}

/** One contiguous session segmented from the event stream */
export interface OpenClawSession {
  agentId: string;
  startedAt: string;       // ISO 8601 (timestamp of first event in session)
  finishedAt: string;      // ISO 8601 (timestamp of last event in session)
  events: OpenClawEvent[]; // all events belonging to this session
}
