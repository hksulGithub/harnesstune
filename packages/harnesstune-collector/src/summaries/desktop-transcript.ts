import { existsSync } from 'node:fs';

/**
 * Resolve the transcript companion (.md) sitting next to a Claude Desktop
 * session JSON file. Returns null if the input is not a `.json` path or no
 * companion exists.
 */
export function resolveClaudeDesktopTranscriptPath(sessionJsonPath: string): string | null {
  if (!sessionJsonPath.endsWith('.json')) return null;

  const candidate = sessionJsonPath.replace(/\.json$/, '.md');
  return existsSync(candidate) ? candidate : null;
}
