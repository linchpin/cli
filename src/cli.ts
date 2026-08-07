#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CommanderError } from 'commander';

import { COMMANDS } from './cli/commands/index.js';
import { EXIT_CODES } from './cli/errors.js';
import { Output, resolveOutputMode, type OutputMode } from './cli/output.js';
import { CommandError, assertNoControlCharacters, buildProgram } from './cli/program.js';
import { readVersion } from './version.js';

/** Read the mode flags before Commander parses, so failures render correctly too. */
function readModeFlags(argv: readonly string[]): {
  json: boolean;
  plain: boolean;
  quiet: boolean;
} {
  return {
    json: argv.includes('--json'),
    plain: argv.includes('--plain'),
    quiet: argv.includes('--quiet'),
  };
}

/**
 * Parse argv and run the matching command.
 *
 * Resolves to a process exit code. The command surface comes entirely from the
 * registry, so this function has no per-command knowledge.
 */
export async function run(
  argv: readonly string[],
  options: { mode?: OutputMode } = {}
): Promise<number> {
  assertNoControlCharacters(argv);

  const program = buildProgram(COMMANDS, {
    name: 'linchpin',
    version: readVersion(),
    description: "Linchpin's command line tool for WordPress and agent workflows",
    examples: [
      'linchpin wt ls                        List worktrees for this repo',
      'linchpin wt switch feature/checkout   Point the local site at a worktree',
      'linchpin shell-init >> ~/.zshrc       Install the directory-changing wrapper',
      'linchpin <command> --help             Help for one command',
    ],
  });

  // Commander exits the process itself by default, which makes it untestable
  // and steals the exit code from the caller.
  program.exitOverride();

  // In JSON mode stdout and stderr must both stay machine-readable. Commander
  // writes its own plain-text usage errors, which would hand an agent
  // unparseable output at exactly the moment it asked for JSON — so silence it
  // and let the envelope carry the message instead.
  const jsonMode = options.mode === 'json';
  if (jsonMode) {
    program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  }

  try {
    await program.parseAsync([...argv], { from: 'user' });
    return EXIT_CODES.ok;
  } catch (error) {
    // --help and --version are thrown as "errors" once exitOverride is on.
    if (error instanceof CommanderError) {
      if (
        error.code === 'commander.helpDisplayed' ||
        error.code === 'commander.help' ||
        error.code === 'commander.version'
      ) {
        return EXIT_CODES.ok;
      }

      // In human mode Commander already wrote its own message, so carry only the
      // exit code or the user sees the error twice. In JSON mode it was silenced
      // above, so the message has to travel for the envelope to report it.
      throw new CommandError(
        jsonMode ? error.message : '',
        error.exitCode === 0 ? EXIT_CODES.ok : EXIT_CODES.validation
      );
    }

    throw error;
  }
}

/**
 * True when this module is the process entry point.
 *
 * Compares real paths rather than raw strings: npm installs the bin as a
 * symlink, so `process.argv[1]` is `node_modules/.bin/linchpin` while
 * `import.meta.url` is the resolved file in the package. A naive string
 * comparison silently never matches, and the installed CLI prints nothing at
 * all — which a `node dist/cli.js` smoke test does not catch.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;

  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const argv = process.argv.slice(2);
  const output = new Output(resolveOutputMode(readModeFlags(argv)));

  try {
    process.exitCode = await run(argv, { mode: output.mode });
  } catch (error) {
    // Commander-originated failures arrive with an empty message because it has
    // already reported them; rendering again would duplicate the output.
    if (error instanceof CommandError && error.message === '') {
      process.exitCode = error.exitCode;
    } else {
      process.exitCode = output.failure(argv[0] ?? 'linchpin', error);
    }
  }
}
