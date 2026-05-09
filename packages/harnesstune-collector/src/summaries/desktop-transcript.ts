import { existsSync } from 'node:fs';

export function resolveClaudeDesktopTranscriptPath(sessionJsonPath: string): string | null {
  const candidates = [
    sessionJsonPath.replace(/\.json$/, '.md'),
    sessionJsonPath.replace(/\.json$/, '.transcript.md'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
