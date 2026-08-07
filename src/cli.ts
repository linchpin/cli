#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CommanderError } from 'commander';

import { COMMANDS } from './cli/commands/index.js';
import { CommandError, assertNoControlCharacters, buildProgram } from './cli/program.js';
import { readVersion } from './version.js';

/**
 * Parse argv and run the matching command.
 *
 * Resolves to a process exit code. The command surface comes entirely from the
 * registry, so this function has no per-command knowledge.
 */
export async function run(argv: readonly string[]): Promise<number> {
  // Before anything parses or echoes an argument.
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

  try {
    await program.parseAsync([...argv], { from: 'user' });
    return 0;
  } catch (error) {
    // --help and --version are thrown as "errors" once exitOverride is on.
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.help') return 0;
      if (error.code === 'commander.version') return 0;
      // Commander already wrote its own message to stderr. Carry the exit code
      // but not the text, or the user sees the same error twice.
      throw new CommandError('', error.exitCode === 0 ? 0 : 2);
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
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CommandError) {
      if (error.exitCode !== 0 && error.message) {
        process.stderr.write(`Error: ${error.message}\n`);
      }
      process.exitCode = error.exitCode;
    } else {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
