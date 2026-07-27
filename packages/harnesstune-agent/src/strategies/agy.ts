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
    // The model's real final answer is a PLANNER_RESPONSE with `content` and
    // NO `tool_calls`. Intermediate rows with `tool_calls` either kick off
    // the next bash command or summarize a step — not the answer. Strict
    // filtering avoids posting "I will check the progress in a moment..."
    // as if it were the final reply when the agent later writes a full
    // summary after a long external wait.
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    const candidates: string[] = [];
    for (const line of lines) {
      try {
        const d = JSON.parse(line) as { source?: string; type?: string; content?: string; tool_calls?: unknown[] };
        if (
          d.source !== 'MODEL' ||
          d.type !== 'PLANNER_RESPONSE' ||
          typeof d.content !== 'string'
        ) continue;
        const trimmed = d.content.trim();
        if (!trimmed) continue;
        // Skip raw tool-event JSON dumps (e.g. {"event": "task_updated"...}).
        if (trimmed.startsWith('{')) continue;
        // Skip rows where the model is still issuing tool calls — that's a
        // mid-thought commentary, not the final answer.
        if (Array.isArray(d.tool_calls) && d.tool_calls.length > 0) continue;
        candidates.push(trimmed);
      } catch { /* skip malformed lines */ }
    }
    if (candidates.length === 0) return '';
    return candidates[candidates.length - 1];
  },

  hasFinalResponse(buf: Buffer): boolean {
    // True iff the LATEST PLANNER_RESPONSE (by file order) has content and no
    // tool_calls. Anything else means the agent is still working — keep
    // watching. Lets a 5-minute brew install or git clone finish before the
    // watcher posts.
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    let latestIsFinal = false;
    for (const line of lines) {
      try {
        const d = JSON.parse(line) as { source?: string; type?: string; content?: string; tool_calls?: unknown[] };
        if (d.source !== 'MODEL' || d.type !== 'PLANNER_RESPONSE') continue;
        const hasContent =
          typeof d.content === 'string' &&
          d.content.trim().length > 0 &&
          !d.content.trim().startsWith('{');
        const hasTools = Array.isArray(d.tool_calls) && d.tool_calls.length > 0;
        latestIsFinal = hasContent && !hasTools;
      } catch { /* skip */ }
    }
    return latestIsFinal;
  },
};
