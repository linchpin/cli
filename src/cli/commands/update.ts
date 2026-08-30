import { z } from 'zod';

import { runCommand } from '../../core/exec.js';
import {
  clearUpdateNotice,
  detectInstallation,
  formatCommand,
  resolveUpdateStatus,
  writeUpdateCache,
} from '../../core/update.js';
import { EXIT_CODES, UserError } from '../errors.js';
import { defineCommand } from '../registry.js';
import { syncNoticeFile } from '../update-notifier.js';

/**
 * `linchpin update` — install the newest published version.
 *
 * The install command is derived from where this copy is actually running from,
 * so a pnpm or bun install is not handed an `npm install -g` that would leave
 * two copies on the machine shadowing each other.
 */
export const updateCommand = defineCommand({
  meta: {
    name: 'update',
    summary: 'Update the CLI to the latest published version',
    description:
      'Queries the npm registry, then runs the install command for however this\n' +
      'copy was installed. --check makes it read-only and exits 3 when an update\n' +
      'is pending, so it can gate a release or a CI job.',
    group: 'utility',
    examples: [
      'linchpin update',
      'linchpin update --check',
      'linchpin update --dry-run',
    ],
  },
  effect: 'write',
  args: z.object({
    check: z
      .boolean()
      .default(false)
      .describe('Report whether an update is pending and exit 3 if so; install nothing'),
    dryRun: z
      .boolean()
      .default(false)
      .describe('Print the install command that would run, without running it'),
  }),
  handler: async (args, ctx) => {
    const { output } = ctx;
    const { name, version } = ctx.manifest;
    const installation = detectInstallation(name);

    const status = await resolveUpdateStatus({
      packageName: name,
      current: version,
      refresh: true,
    });

    // Unlike `version`, this command cannot do its job without an answer: it
    // would either install nothing or reinstall blind.
    if (status.latest === undefined) {
      throw new UserError(`Could not reach the npm registry: ${status.error ?? 'unknown error'}`, {
        exitCode: EXIT_CODES.precondition,
        code: 'registry_unreachable',
        remedy: 'Check your network, or set LINCHPIN_REGISTRY if you publish through a mirror.',
      });
    }

    // A reachable cache with an unreachable registry is still actionable — the
    // package manager will report its own network failure if there is one — but
    // acting on a day-old answer without saying so would be dishonest. The
    // warning is human-only; a parser reads `checkError` out of the envelope.
    if (status.error !== undefined && output.mode === 'human') {
      output.warn(`Registry unreachable (${status.error}); using the last cached answer.`);
    }

    const latest = status.latest;

    // Before any of the early returns below: --check and --dry-run are both
    // legitimate ways to learn a release exists, and a shell should say the same.
    syncNoticeFile({ current: version, latest, installation });

    const updateCommand = installation.command;
    const rendered = updateCommand ? formatCommand(updateCommand) : null;

    if (!status.updateAvailable) {
      output.result(
        'update',
        {
          current: version,
          latest,
          updateAvailable: false,
          command: rendered,
          checkError: status.error ?? null,
        },
        { changed: false, human: `${name} ${version} is the latest version.` }
      );
      return;
    }

    // A pending update is a precondition failure on purpose: `--check` exists to
    // gate something, and a gate that exits 0 gates nothing.
    if (args.check) {
      throw new UserError(`Update available: ${version} → ${latest}`, {
        exitCode: EXIT_CODES.precondition,
        code: 'update_available',
        remedy: rendered === null ? installation.hint : `Run 'linchpin update' to install it.`,
      });
    }

    if (updateCommand === undefined || rendered === null) {
      throw new UserError(`Cannot update a ${installation.scope} install automatically`, {
        exitCode: EXIT_CODES.precondition,
        code: 'unsupported_install',
        remedy: installation.hint,
      });
    }

    if (args.dryRun) {
      output.result(
        'update',
        {
          current: version,
          latest,
          updateAvailable: true,
          command: rendered,
          checkError: status.error ?? null,
        },
        { changed: false, human: `Would run: ${rendered}` }
      );
      return;
    }

    output.info(`Updating ${name} ${version} → ${latest}`);

    const [binary, ...rest] = updateCommand;
    const result = runCommand(binary ?? 'npm', rest, {
      allowFailure: true,
      // Silence for the length of an install reads as a hang, so a human watches
      // the package manager directly. A parser gets the envelope instead.
      inherit: output.mode === 'human',
    });

    if (!result.ok) {
      throw new UserError(`Update failed: ${result.stderr || rendered}`, {
        exitCode: EXIT_CODES.unexpected,
        code: 'update_failed',
        remedy: `Run it yourself to see the full output: ${rendered}`,
      });
    }

    // Reset the check window so the notifier does not repeat a notice that has
    // just been acted on, and take down the shell-startup notice with it —
    // otherwise every new terminal keeps advertising an update already installed.
    writeUpdateCache({ checkedAt: Date.now(), latest, current: latest });
    clearUpdateNotice();

    output.result(
      'update',
      {
        current: version,
        latest,
        updateAvailable: false,
        command: rendered,
        checkError: null,
      },
      { changed: true, human: `Updated ${name} ${version} → ${latest}` }
    );
  },
});
