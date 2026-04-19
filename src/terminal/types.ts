/**
 * Stream-JSON event types for Claude Code `--output-format stream-json`.
 *
 * Each line of stdout is a newline-delimited JSON object with a `type` field
 * that determines the shape of the event.
 */

// ── Content block types ──────────────────────────────────────────────────────

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

// ── Individual event types ───────────────────────────────────────────────────

export interface StreamJsonAssistantEvent {
  type: 'assistant';
  message: {
    role: 'assistant';
    content: ContentBlock[];
  };
}

export interface StreamJsonToolUseEvent {
  type: 'tool_use';
  name: string;
  input: unknown;
}

export interface StreamJsonToolResultEvent {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface StreamJsonUsageEvent {
  type: 'result';
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  result: string;
  session_id: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export interface StreamJsonSystemEvent {
  type: 'system';
  subtype?: string;
  message?: string;
  session_id?: string;
  [key: string]: unknown;
}

export interface StreamJsonErrorEvent {
  type: 'error';
  error: {
    message: string;
    type: string;
  };
}

// ── Discriminated union ──────────────────────────────────────────────────────

export type StreamJsonEvent =
  | StreamJsonAssistantEvent
  | StreamJsonToolUseEvent
  | StreamJsonToolResultEvent
  | StreamJsonUsageEvent
  | StreamJsonSystemEvent
  | StreamJsonErrorEvent;

// ── Terminal session state ────────────────────────────────────────────────────

export type TerminalSessionState = 'idle' | 'starting' | 'active' | 'ended';
