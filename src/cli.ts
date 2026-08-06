#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readVersion } from './version.js';

// Transitional imports. These resolve to the un-ported CommonJS in legacy/ and
// are bundled into dist/ at build time, so the published package ships no
// dependencies. Each disappears as its command moves onto the registry
// (LINCHPIN-5367 .. LINCHPIN-5372), and legacy/ is deleted when the last one goes.
import { runWt } from '../legacy/commands/wt.js';
import { runShellInit } from '../legacy/commands/shell-init.js';

const HELP = `linchpin

Usage:
  linchpin wt <command>
  linchpin shell-init [--shell bash|zsh|fish]

Commands:
  wt           Manage worktree workflows and WordPress plugin symlink switching
  shell-init   Output shell wrapper (auto-cd after wt switch)
`;

/**
 * Top-level dispatch.
 *
 * Resolves to a process exit code. Commands signal failure by throwing; the
 * entry point below turns that into exit 1. The richer exit-code vocabulary
 * (2 validation, 3 precondition, 4 auth, 5 refused) arrives with the dual-mode
 * contract in LINCHPIN-5368.
 */
export async function run(argv: readonly string[]): Promise<number> {
  const command = argv[0] ?? 'help';

  switch (command) {
    case 'wt':
      return await runWt(argv.slice(1));
    case 'shell-init':
      return await runShellInit(argv.slice(1));
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP);
      return 0;
    case '--version':
    case '-v':
      process.stdout.write(`${readVersion()}\n`);
      return 0;
    default:
      throw new Error(`Unknown command '${command}'. Run 'linchpin --help'.`);
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
    const code = await run(process.argv.slice(2));
    process.exitCode = typeof code === 'number' ? code : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  }
}
