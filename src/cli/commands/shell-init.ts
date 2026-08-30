import { z } from 'zod';

import { defineCommand } from '../registry.js';
import { noticeSnippet } from '../shell-notice.js';
// Transitional: ported in LINCHPIN-5372.
import { detectShell, runShellInit } from '../../../legacy/commands/shell-init.js';

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
      '`wt switch` need a shell function wrapper. Add the output to your shell rc file.\n' +
      '\n' +
      '--notify adds a second block that prints a short notice when a newer version\n' +
      'has been published, so a release reaches someone who has not run the CLI\n' +
      'lately. It reads a pre-rendered cache file rather than starting the CLI —\n' +
      'about 6ms per shell against ~35ms for a Node start — and refreshes that file\n' +
      'in a detached process at most once a day.',
    group: 'utility',
    examples: [
      'linchpin shell-init >> ~/.zshrc',
      'linchpin shell-init --notify >> ~/.zshrc',
      'linchpin shell-init --shell fish',
      'eval "$(linchpin shell-init --notify)"',
    ],
  },
  effect: 'read',
  args: z.object({
    shell: z
      .enum(['bash', 'zsh', 'fish'])
      .optional()
      .describe('Shell to emit a wrapper for. Detected from $SHELL when omitted.'),
    notify: z
      .boolean()
      .default(false)
      .describe('Also print a notice at shell startup when a newer version is published'),
  }),
  handler: async (args) => {
    const argv = args.shell ? ['--shell', args.shell] : [];
    const code = runShellInit(argv);

    // Written straight to stdout rather than through `output`, matching the
    // wrapper above it: this command's whole contract is that its stdout is
    // shell source, so an envelope or a suppressed mode would be a bug here.
    if (args.notify) {
      process.stdout.write(`\n${noticeSnippet(detectShell(argv))}`);
    }

    return code;
  },
});
