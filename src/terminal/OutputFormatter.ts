import type { StreamJsonEvent } from './types';

// ── ANSI escape sequences ────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const BOLD_RED = '\x1b[1;31m';
const BOLD_GREEN = '\x1b[1;32m';
const DIM_ITALIC = '\x1b[2;3m';

/**
 * Formats parsed StreamJsonEvents into ANSI-colored terminal output strings.
 * Stateless — all methods are static.
 */
export class OutputFormatter {
  /**
   * Format a single StreamJsonEvent into an ANSI-styled string for terminal
   * display. Returns empty string for events that should be suppressed.
   */
  static format(event: StreamJsonEvent): string {
    switch (event.type) {
      case 'assistant':
        return OutputFormatter.formatAssistant(event);
      case 'tool_use':
        return OutputFormatter.formatToolUse(event);
      case 'tool_result':
        return OutputFormatter.formatToolResult(event);
      case 'result':
        return OutputFormatter.formatUsage(event);
      case 'system':
        return OutputFormatter.formatSystem(event);
      case 'error':
        return OutputFormatter.formatError(event);
      default:
        return '';
    }
  }

  /** "Press Enter to start a Claude Code session..." welcome prompt. */
  static formatPrompt(workspaceName: string): string {
    return (
      `\r\n${BOLD}${GREEN}HarnessTune Terminal${RESET} - ${workspaceName}\r\n` +
      `${DIM}Press Enter to start a Claude Code session...${RESET}\r\n`
    );
  }

  /** Bold green input prompt prefix: "> " */
  static formatInputPrefix(): string {
    return `${BOLD_GREEN}> ${RESET}`;
  }

  /** Styled session-end message. */
  static formatSessionEnd(reason: string): string {
    return `\r\n${DIM}--- Session ended: ${reason} ---${RESET}\r\n`;
  }

  // ── Private formatters ──────────────────────────────────────────────────────

  private static formatAssistant(
    event: Extract<StreamJsonEvent, { type: 'assistant' }>,
  ): string {
    const parts: string[] = [];
    for (const block of event.message.content) {
      if (block.type === 'text') {
        // Apply bold to markdown headings, convert \n to \r\n for terminal
        const lines = block.text.split('\n');
        const formatted = lines
          .map(line => (line.startsWith('#') ? `${BOLD}${line}${RESET}` : line))
          .join('\r\n');
        parts.push(formatted);
      }
      // tool_use content blocks within assistant events are handled
      // by the separate 'tool_use' event; skip here.
    }
    return parts.length > 0 ? parts.join('') + '\r\n' : '';
  }

  private static formatToolUse(
    event: Extract<StreamJsonEvent, { type: 'tool_use' }>,
  ): string {
    const summary = OutputFormatter.summarizeInput(event.input);
    return `${CYAN}[${event.name}]${RESET} ${summary}\r\n`;
  }

  private static formatToolResult(
    event: Extract<StreamJsonEvent, { type: 'tool_result' }>,
  ): string {
    if (event.is_error) {
      const preview = event.content.length > 120
        ? event.content.slice(0, 120) + '...'
        : event.content;
      return `${RED}[Error] ${preview}${RESET}\r\n`;
    }
    // Non-error tool results are verbose; suppress.
    return '';
  }

  private static formatUsage(
    event: Extract<StreamJsonEvent, { type: 'result' }>,
  ): string {
    const totalTokens = event.usage.input_tokens + event.usage.output_tokens;
    return (
      `${DIM}--- ${event.num_turns} turns | ` +
      `$${event.total_cost_usd.toFixed(4)} USD | ` +
      `${totalTokens} tokens ---${RESET}\r\n`
    );
  }

  private static formatSystem(
    event: Extract<StreamJsonEvent, { type: 'system' }>,
  ): string {
    return `${DIM_ITALIC}${event.message}${RESET}\r\n`;
  }

  private static formatError(
    event: Extract<StreamJsonEvent, { type: 'error' }>,
  ): string {
    return `${BOLD_RED}Error: ${event.error.message}${RESET}\r\n`;
  }

  /**
   * Produce a compact summary of tool input for display.
   * Prefers file_path/path, then command (truncated), then raw JSON (truncated).
   */
  private static summarizeInput(input: unknown): string {
    if (input && typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      if (typeof obj.file_path === 'string') { return obj.file_path; }
      if (typeof obj.path === 'string') { return obj.path; }
      if (typeof obj.command === 'string') {
        return obj.command.length > 60
          ? obj.command.slice(0, 60) + '...'
          : obj.command;
      }
    }
    const raw = JSON.stringify(input);
    return raw.length > 80 ? raw.slice(0, 80) + '...' : raw;
  }
}
