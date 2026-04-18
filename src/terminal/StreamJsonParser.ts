import type { StreamJsonEvent } from './types';

/**
 * Newline-delimited JSON parser for Claude Code stream-JSON output.
 *
 * Buffers partial lines from stdout chunks and emits complete parsed
 * JSON events. Lines that fail JSON.parse() are silently skipped
 * (Claude may emit non-JSON startup text).
 */
export class StreamJsonParser {
  private buffer = '';

  /**
   * Feed a raw chunk from stdout. Returns an array of successfully
   * parsed StreamJsonEvents from complete lines in the chunk.
   * Retains any incomplete trailing line in the internal buffer.
   */
  feed(chunk: string): StreamJsonEvent[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');

    // Last element is either empty (chunk ended with \n) or a partial line
    this.buffer = lines.pop() ?? '';

    const events: StreamJsonEvent[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as StreamJsonEvent;
        events.push(parsed);
      } catch {
        // Silently skip non-JSON lines (startup text, etc.)
      }
    }
    return events;
  }

  /** Clear the internal buffer. */
  reset(): void {
    this.buffer = '';
  }
}
