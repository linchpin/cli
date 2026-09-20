import { z } from 'zod';

import {
  BANNER_URL,
  CHANNELS,
  loadPin,
  scaffoldPlugin,
} from '../../core/plugin-scaffold.js';
import { EXIT_CODES, UserError } from '../errors.js';
import { defineCommand } from '../registry.js';

/**
 * `linchpin plugin scaffold` — generate a Linchpin WordPress plugin.
 *
 * Writes a local tree from a pinned ref of linchpin/plugin-scaffold. It does
 * not create a GitHub repository or set secrets.
 */
export const pluginScaffoldCommand = defineCommand({
  meta: {
    name: 'plugin scaffold',
    summary: 'Generate a Linchpin WordPress plugin from the house standard',
    description:
      'Copies a pinned ref of linchpin/plugin-scaffold, renames the identity,\n' +
      'and writes a plugin directory that matches wp-plugin-standards.\n' +
      'GitHub repo creation and secret wiring are separate.',
    group: 'wordpress',
    examples: [
      'linchpin plugin scaffold acme',
      'linchpin plugin scaffold acme --with-blocks --channel=wporg',
      'linchpin plugin scaffold acme --path ~/GitHub/acme --dry-run',
    ],
  },
  effect: 'write',
  args: z.object({
    slug: z
      .string()
      .describe('Plugin slug, text domain, and composer package linchpin/<slug>')
      .meta({ positional: true, valueName: 'slug' }),
    name: z
      .string()
      .optional()
      .describe('Plugin Name header and README title. Defaults to a title-cased slug'),
    description: z
      .string()
      .optional()
      .describe('Plugin header and README one-liner'),
    php: z.string().default('8.3').describe('Requires PHP / composer platform PHP'),
    channel: z
      .enum(CHANNELS)
      .default('private')
      .describe('Distribution channel: private, wporg, or self-hosted'),
    withBlocks: z
      .boolean()
      .default(false)
      .describe('Add the nested blocks workspace and an example block'),
    path: z
      .string()
      .optional()
      .describe('Destination directory. Defaults to ./<slug>'),
    ref: z
      .string()
      .optional()
      .describe('Override the pinned tag, sha, or a local template path'),
    force: z
      .boolean()
      .default(false)
      .describe('Overwrite a non-empty destination'),
    dryRun: z
      .boolean()
      .default(false)
      .describe('Print the files that would be written, without writing'),
    git: z
      .boolean()
      .default(false)
      .describe('git init when the destination is not already inside a repository'),
    install: z
      .boolean()
      .default(false)
      .describe('Run composer install and npm install after writing'),
  }),
  handler: async (args, ctx) => {
    const dest = args.path ?? `./${args.slug}`;

    try {
      const result = scaffoldPlugin({
        slug: args.slug,
        dest,
        php: args.php,
        channel: args.channel,
        withBlocks: args.withBlocks,
        force: args.force,
        dryRun: args.dryRun,
        git: args.git,
        install: args.install,
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.ref === undefined ? {} : { ref: args.ref }),
      });

      const pin = loadPin();
      const lines = args.dryRun
        ? [
            `Would write ${result.slug} to ${result.dest}`,
            `Template: ${result.templateRoot}`,
            ...result.files.map((file) => `  ${file}`),
          ]
        : [
            `Wrote ${result.name} (${result.slug}) to ${result.dest}`,
            `Template: ${pin.repo}@${pin.tag} (${pin.sha.slice(0, 7)})`,
            `${result.files.length} files`,
            '',
            'Next:',
            '  linchpin wt config init',
            '  gh repo create linchpin/' + result.slug + ' --private --source . --push',
          ];

      ctx.output.result(
        'plugin_scaffold',
        {
          dest: result.dest,
          slug: result.slug,
          name: result.name,
          wrote: result.wrote,
          fileCount: result.files.length,
          files: result.files,
          templateRoot: result.templateRoot,
          bannerUrl: BANNER_URL,
          pin,
        },
        { human: lines.join('\n') }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      throw new UserError(message, {
        exitCode: message.startsWith('Invalid plugin slug')
          ? EXIT_CODES.validation
          : message.includes('not empty')
            ? EXIT_CODES.refused
            : EXIT_CODES.precondition,
        code: 'plugin_scaffold_failed',
        ...(message.includes('not empty')
          ? { remedy: 'Pass --force to overwrite, or choose another --path' }
          : {}),
      });
    }
  },
});
