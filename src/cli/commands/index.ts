import type { CommandDefinition } from '../registry.js';

import { shellInitCommand } from './shell-init.js';
import { wtCommand } from './wt.js';

/**
 * Every command the CLI exposes.
 *
 * This array is the single source `--help`, shell completions, the README and
 * `linchpin schema` are generated from. Adding a command means adding a file
 * here and one entry — nothing else.
 */
export const COMMANDS: readonly CommandDefinition[] = [wtCommand, shellInitCommand];
