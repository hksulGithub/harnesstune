import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentTranscriptStrategy } from './types.js';

export const agyStrategy: AgentTranscriptStrategy = {
  id: 'agy',
  label: 'Antigravity CLI',

  // agy does long multi-step tool use (web search → file ops → bash → analysis
  // → final PLANNER_RESPONSE). Pauses between tool calls — especially after
  // backgrounded `openclaw devices` style commands — can exceed 45 seconds.
  // The default 3s stability heuristic in attach.ts gives up during these
  // pauses and posts whatever partial content was captured. Wait 60s of
  // inactivity before concluding the response is done.
  stableMs: 60000,

  resolveTranscriptDir({ home }: { cwd: string; home: string }): string | null {
    const dir = path.join(home, '.gemini', 'antigravity-cli', 'brain');
    return fs.existsSync(dir) ? dir : null;
  },

  recursiveTranscriptSearch: true,

  transcriptFilenameFilter(filename: string): boolean {
    return filename === 'transcript.jsonl';
  },

  injectArgs(args: string[]): string[] {
    // Same flag name as claude — agy accepts --dangerously-skip-permissions
    // to auto-approve all tool permission requests. Without this, attach
    // sessions stall on permission prompts (no human present to approve).
    if (!args.includes('--dangerously-skip-permissions')) {
      return [...args, '--dangerously-skip-permissions'];
    }
    return args;
  },

  extractAssistantText(buf: Buffer): string {
    // agy persists only the final answer + raw tool events to the JSONL.
    // The natural-language narration ("I will check...", "Let me look...")
    // that appears in agy's TUI is rendered live from streaming output and
    // is NOT stored, so we cannot recover it.
    //
    // PLANNER_RESPONSE rows are heterogeneous — some are the final prose
    // answer, others are wrapped tool events like {"event": "task_updated"...}
    // with stdout dumps. To get the clean final answer:
    //   1. Collect all PLANNER_RESPONSE rows with non-empty content
    //   2. Skip rows that look like raw tool-event JSON (start with `{`)
    //   3. Take the LAST surviving row — that's the model's final reply
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    const candidates: string[] = [];
    for (const line of lines) {
      try {
        const d = JSON.parse(line) as { source?: string; type?: string; content?: string };
        if (
          d.source !== 'MODEL' ||
          d.type !== 'PLANNER_RESPONSE' ||
          typeof d.content !== 'string'
        ) continue;
        const trimmed = d.content.trim();
        if (!trimmed) continue;
        // Skip raw tool-event JSON dumps (e.g. {"event": "task_updated"...}).
        // Real prose answers never start with a bare `{`.
        if (trimmed.startsWith('{')) continue;
        candidates.push(trimmed);
      } catch { /* skip malformed lines */ }
    }
    if (candidates.length === 0) return '';
    return candidates[candidates.length - 1];
  },
};
