import { claudeStrategy } from './claude.js';
import { agyStrategy } from './agy.js';
import type { AgentTranscriptStrategy } from './types.js';

const REGISTRY: Record<string, AgentTranscriptStrategy> = {
  [claudeStrategy.id]: claudeStrategy,
  [agyStrategy.id]: agyStrategy,
};

export function resolveStrategy(cmdBasename: string): AgentTranscriptStrategy | null {
  return REGISTRY[cmdBasename] ?? null;
}

export type { AgentTranscriptStrategy } from './types.js';
