import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentTranscriptStrategy } from './types.js';

export const claudeStrategy: AgentTranscriptStrategy = {
  id: 'claude',
  label: 'Claude Code',

  // claude is usually fast and atomic, but multi-step tool chains (bash + ssh +
  // analysis) can pause >3s between operations while claude thinks. The default
  // 3s stability heuristic gives up mid-conversation, reads the JSONL while it
  // only contains user/system messages, and extracts 0 assistant text.
  // 20s is a reasonable middle ground — fast simple replies still feel snappy,
  // but real multi-step work has room to finish.
  stableMs: 20000,

  resolveTranscriptDir({ cwd, home }: { cwd: string; home: string }): string | null {
    const sanitizedCwd = cwd.replace(/[/.]/g, '-');
    const dir = path.join(home, '.claude', 'projects', sanitizedCwd);
    return fs.existsSync(dir) ? dir : path.join(home, '.claude', 'projects', sanitizedCwd);
  },

  recursiveTranscriptSearch: false,

  transcriptFilenameFilter(filename: string): boolean {
    return filename.endsWith('.jsonl');
  },

  injectArgs(args: string[]): string[] {
    const userSetPermissionMode =
      args.includes('--permission-mode') ||
      args.includes('--dangerously-skip-permissions');
    if (!userSetPermissionMode) {
      return [...args, '--permission-mode', 'bypassPermissions'];
    }
    return args;
  },

  extractAssistantText(buf: Buffer): string {
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    const texts: string[] = [];
    for (const line of lines) {
      try {
        const d = JSON.parse(line) as {
          message?: {
            role?: string;
            content?: Array<{ type?: string; text?: string }>;
          };
        };
        const msg = d.message ?? {};
        if (msg.role !== 'assistant') continue;
        const content = Array.isArray(msg.content) ? msg.content : [];
        for (const c of content) {
          if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
            texts.push(c.text);
          }
        }
      } catch { /* skip non-JSON lines */ }
    }
    return texts.join('\n\n');
  },
};
