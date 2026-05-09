#!/usr/bin/env node
/**
 * harnesstune-collector CLI — subcommand dispatcher
 * No external argv parsing dependencies.
 */

import { setup } from './commands/setup.js';
import { start } from './commands/start.js';
import { stop } from './commands/stop.js';
import { status } from './commands/status.js';
import { install } from './commands/install.js';

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes('--dry-run');
const args = rawArgs.filter(a => a !== '--dry-run');
const [subcommand, ...rest] = args;

switch (subcommand) {
  case 'setup':
    await setup(rest);
    break;
  case 'start':
    await start(rest, { dryRun });
    break;
  case 'stop':
    await stop(rest);
    break;
  case 'status':
    await status(rest);
    break;
  case 'install':
    await install(rest);
    break;
  default:
    console.error(`Unknown subcommand: ${subcommand ?? '(none)'}`);
    console.error('Usage: harnesstune-collector <setup|start|stop|status|install> [options]');
    console.error('Flags: --dry-run  Validate setup without starting the daemon');
    process.exit(1);
}
