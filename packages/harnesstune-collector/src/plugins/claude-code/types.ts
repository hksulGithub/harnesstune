/** Run result file written by harnesstune-wrap to ~/.harnesstune/cron-runs/ */
export interface CronRunFile {
  agentName: string;
  command: string;
  exitCode: number;
  startedAt: string;   // ISO 8601
  finishedAt: string;  // ISO 8601
  durationMs: number;
  outputTail: string;  // last 50 lines of stdout+stderr
}

/** Parsed crontab entry containing harnesstune-wrap */
export interface CrontabEntry {
  schedule: string;    // cron expression e.g. '0 9 * * *' or '@reboot'
  agentName: string;   // extracted from --name flag
  rawLine: string;     // original crontab line for debugging
}
