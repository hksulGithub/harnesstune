/**
 * One AgentTranscriptStrategy per AI coding tool we bridge through attach.
 *
 * Existing strategies: claude, agy. Future: codex, aider, hermes.
 *
 * The pipeline in attach.ts owns PTY spawning, message polling, and report
 * posting. Strategies own everything that varies by tool:
 *   - which flags to auto-inject before spawn
 *   - where on disk the tool writes its transcript
 *   - how to parse that transcript and pull out clean assistant text
 */
export interface AgentTranscriptStrategy {
  /** stable identifier — also matches the basename of the command */
  readonly id: string;

  /** human-readable label for logs */
  readonly label: string;

  /**
   * Return the directory that contains candidate transcript files for the
   * current process cwd. The watcher will scan this dir for `.jsonl` files
   * and pick the one that grows after the next user message.
   *
   * Return `null` if the dir doesn't exist yet (first launch, before the
   * tool has created its workspace).
   */
  resolveTranscriptDir(opts: { cwd: string; home: string }): string | null;

  /**
   * Filter candidate files inside the transcript dir.
   * E.g. agy stores `transcript.jsonl` and `transcript_full.jsonl`; we only
   * want `transcript.jsonl`. Default (if not provided): all `.jsonl` files.
   *
   * The agent caller should check `transcriptFilenameFilter?.(filename) ?? filename.endsWith('.jsonl')`
   */
  transcriptFilenameFilter?(filename: string): boolean;

  /**
   * agy uses a nested layout (`brain/<uuid>/.system_generated/logs/transcript.jsonl`).
   * If `true`, the watcher does a recursive search under `resolveTranscriptDir`
   * for files matching `transcriptFilenameFilter`. If `false` (default), it
   * looks only one level deep.
   */
  readonly recursiveTranscriptSearch?: boolean;

  /**
   * Optionally inject CLI flags before spawn (e.g. `--permission-mode bypassPermissions`
   * for claude). Mutate `args` or return new args. Return the (possibly new) array.
   */
  injectArgs(args: string[]): string[];

  /**
   * Given a Buffer of newly-appended bytes from the transcript file, parse and
   * return clean assistant text. Returns empty string when nothing extractable.
   */
  extractAssistantText(buf: Buffer): string;

  /**
   * How long (ms) the transcript file must remain unchanged before the watcher
   * concludes the agent is done responding. Default 3000ms — works for
   * single-shot agents like claude. Multi-tool agents like agy pause between
   * tool calls; if this is too short, the watcher gives up mid-conversation.
   *
   * If omitted, the pipeline uses its default (3000ms).
   */
  readonly stableMs?: number;

  /**
   * Optional semantic end-of-turn detector. When provided, the watcher keeps
   * polling past the `stableMs` window until this returns true (or until the
   * overall timeout). Use to avoid posting a half-finished response when the
   * agent goes quiet during a long external operation (e.g. agy waiting for
   * `git clone` to finish — looks "stable" but isn't done).
   *
   * If omitted, stability alone determines completion (current behavior).
   */
  hasFinalResponse?(buf: Buffer): boolean;
}
