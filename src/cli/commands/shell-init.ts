import { z } from 'zod';

import { defineCommand } from '../registry.js';
// Transitional: ported in LINCHPIN-5372.
import { runShellInit } from '../../../legacy/commands/shell-init.js';

/**
 * Prints a shell function to stdout for the user to eval or source. It writes
 * nothing and touches nothing, so it is a `read` and safe to pre-approve in a
 * skill's allowed-tools.
 */
export const shellInitCommand = defineCommand({
  meta: {
    name: 'shell-init',
    summary: 'Output the shell wrapper that makes wt switch change directory',
    description:
      'A child process cannot change its parent shell\'s directory, so `wt cd` and\n' +
      '`wt switch` need a shell function wrapper. Add the output to your shell rc file.',
    group: 'utility',
    examples: [
      'linchpin shell-init >> ~/.zshrc',
      'linchpin shell-init --shell fish',
      'eval "$(linchpin shell-init)"',
    ],
  },
  effect: 'read',
  args: z.object({
    shell: z
      .enum(['bash', 'zsh', 'fish'])
      .optional()
      .describe('Shell to emit a wrapper for. Detected from $SHELL when omitted.'),
  }),
  handler: async (args) => {
    const argv = args.shell ? ['--shell', args.shell] : [];
    return runShellInit(argv);
  },
});
