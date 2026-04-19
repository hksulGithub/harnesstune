import { readPid, removePid } from '../config.js';

export async function stop(_args: string[]): Promise<void> {
  const pid = readPid();
  if (!pid) {
    console.error('No running agent found (.harnesstune/agent.pid not present)');
    process.exit(1);
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Sent SIGTERM to agent (PID ${pid})`);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ESRCH') {
      console.error(`Process ${pid} not found -- removing stale PID file`);
      removePid();
    } else {
      throw err;
    }
  }
}
