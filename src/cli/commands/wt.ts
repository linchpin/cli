import { z } from 'zod';

import { defineCommand } from '../registry.js';
// Transitional: the wt implementation still lives in legacy/ and is ported
// subcommand by subcommand in LINCHPIN-5369 .. LINCHPIN-5372.
import { runWt } from '../../../legacy/commands/wt.js';

/**
 * `wt` currently forwards its whole argv to the legacy dispatcher, so it is
 * registered as a single passthrough rather than 17 definitions.
 *
 * It is classified **destructive** deliberately: the subcommand set includes
 * `del`, and until each is split out with its own effect the safe reading is
 * the most dangerous one it contains. LINCHPIN-5372 replaces this entry with
 * per-subcommand definitions, most of which will be `read`.
 */
export const wtCommand = defineCommand({
  meta: {
    name: 'wt',
    summary: 'Manage worktree workflows and WordPress plugin symlink switching',
    description:
      'Create, list, switch and delete git worktrees, and repoint the WordPress\n' +
      'plugin or theme symlink at the worktree you want your local site to load.',
    group: 'worktree',
    examples: [
      'linchpin wt ls',
      'linchpin wt new feature/checkout',
      'linchpin wt switch feature/checkout --env studio',
      'linchpin wt config init --type plugin',
    ],
    passthrough: true,
  },
  effect: 'destructive',
  args: z.object({
    passthrough: z
      .array(z.string())
      .default([])
      .describe('Arguments forwarded to the wt dispatcher')
      .meta({ positional: true, variadic: true, valueName: 'args' }),
  }),
  handler: async (args) => runWt([...args.passthrough]),
});
