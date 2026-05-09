export type AgentEventType =
  | 'SessionStart' | 'SessionEnd'
  | 'SubagentStart' | 'SubagentStop'
  | 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure'
  | 'Stop' | 'StopFailure'
  | 'RemoteReport';

export interface AgentTokenUsage {
  inputTokens?: number;      // gen_ai.usage.input_tokens
  outputTokens?: number;     // gen_ai.usage.output_tokens
  cacheReadTokens?: number;  // gen_ai.usage.cache_read.input_tokens
}

export interface AgentEvent {
  id: string;                    // uuid v4, generated on receipt
  workspaceId: string;           // from adapter context
  sessionId: string;             // gen_ai.conversation.id equivalent
  agentId: string;               // gen_ai.agent.id equivalent
  eventType: AgentEventType;
  timestamp: number;             // Unix ms
  toolName?: string;             // For PreToolUse/PostToolUse events
  toolInput?: unknown;           // Raw tool input JSON
  model?: string;                // gen_ai.request.model
  tokenUsage?: AgentTokenUsage;
  error?: string;                // For failure events
  parentToolUseId?: string;      // For SubagentStart — links child to parent
  parentSessionId?: string;      // Resolved by topology reducer from parentToolUseId correlation
  raw: unknown;                  // Full original hook payload
}

export type AgentControlState = 'running' | 'paused' | 'stopping' | 'stopped';

export interface AgentSession {
  sessionId: string;
  workspaceId: string;
  pid?: number;
  controlState: AgentControlState;
  pausedAt?: number;
  startedAt: number;
  model?: string;
  agentRole?: string;
}
