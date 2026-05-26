#!/usr/bin/env node
/**
 * harnesstune-agent CLI — subcommand dispatcher
 * No external argv parsing dependencies (D-01).
 */

import { register } from './commands/register.js';
import { start } from './commands/start.js';
import { stop } from './commands/stop.js';
import { report } from './commands/report.js';
import { attach } from './commands/attach.js';

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes('--dry-run');
const args = rawArgs.filter(a => a !== '--dry-run');
const [subcommand, ...rest] = args;

switch (subcommand) {
  case 'register':
    await register(rest);
    break;
  case 'start':
    await start(rest, { dryRun });
    break;
  case 'stop':
    await stop(rest);
    break;
  case 'report':
    await report(rest, { dryRun });
    break;
  case 'attach':
    await attach(rest, { dryRun });
    break;
  default:
    console.error(`Unknown subcommand: ${subcommand ?? '(none)'}`);
    console.error('Usage: harnesstune-agent <register|start|stop|report|attach> [options]');
    console.error('Flags: --dry-run  Validate setup without uploading data');
    console.error('attach: harnesstune-agent attach -- <command> [args...]');
    process.exit(1);
}
