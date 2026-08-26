import { z } from 'zod';

import {
  detectInstallation,
  formatAge,
  formatCommand,
  resolveUpdateStatus,
  updateCachePath,
} from '../../core/update.js';
import { defineCommand } from '../registry.js';

/**
 * `linchpin version` — the installed version, plus whether a newer one exists.
 *
 * `-v/--version` prints the bare number and nothing else, because a script that
 * parses it should keep working. This command is the human and agent form: one
 * place that answers "what am I running, is it current, and how would I move".
 *
 * Always exits 0, including when the registry cannot be reached. Use
 * `linchpin update --check` for the form that fails when an update is pending.
 */
export const versionCommand = defineCommand({
  meta: {
    name: 'version',
    summary: 'Print the installed version and whether a newer one is published',
    description:
      'Reads the cached result of the last check. Pass --check to query the npm\n' +
      'registry now. Exits 0 either way, so it is safe in a prompt or a status line.',
    group: 'utility',
    examples: [
      'linchpin version',
      'linchpin version --check',
      'linchpin version --check --json',
    ],
  },
  effect: 'read',
  args: z.object({
    check: z
      .boolean()
      .default(false)
      .describe('Query the npm registry now instead of reading the cached answer'),
  }),
  handler: async (args, ctx) => {
    const { output } = ctx;
    const { name, version } = ctx.manifest;
    const installation = detectInstallation(name);

    const status = await resolveUpdateStatus({
      packageName: name,
      current: version,
      refresh: args.check,
      cacheOnly: !args.check,
    });

    const updateCommand = installation.command ? formatCommand(installation.command) : null;

    const lines = [`${name} ${version}`];

    if (status.updateAvailable && status.latest) {
      lines.push(`Update available: ${version} → ${status.latest}`);
      lines.push(
        updateCommand === null
          ? `  ${installation.hint}`
          : `  Run: linchpin update   (or: ${updateCommand})`
      );
    } else if (status.latest !== undefined) {
      const age = status.checkedAt === undefined ? '' : ` (checked ${formatAge(status.checkedAt)})`;
      lines.push(`Up to date${age}`);
    } else {
      lines.push("Update state unknown. Run 'linchpin version --check' to ask the registry.");
    }

    if (status.error !== undefined) {
      lines.push(`  Registry unreachable: ${status.error}`);
    }

    output.result(
      'version',
      {
        name,
        current: version,
        latest: status.latest ?? null,
        updateAvailable: status.updateAvailable,
        checkedAt: status.checkedAt === undefined ? null : new Date(status.checkedAt).toISOString(),
        source: status.source,
        checkError: status.error ?? null,
        install: {
          manager: installation.manager,
          scope: installation.scope,
          path: installation.path,
          updateCommand,
        },
        cachePath: updateCachePath(),
        node: process.versions.node,
      },
      { human: lines.join('\n') }
    );
  },
});
