import fs from 'node:fs';
import path from 'node:path';

import { runCommand } from './exec.js';
import { isContainedAfterLinks, resolveContained } from './paths.js';
import { describeUntrustedHook, isHookTrusted } from './trust.js';

/** Operations that can carry hooks. */
export const HOOK_OPERATIONS = ['switch', 'new', 'get', 'extract', 'mv', 'del'] as const;
export type HookOperation = (typeof HOOK_OPERATIONS)[number];

export const HOOK_PHASES = ['pre', 'post'] as const;
export type HookPhase = (typeof HOOK_PHASES)[number];

/**
 * All 12 hook points: `pre|post` × the six operations.
 *
 * Derived rather than listed, so a new operation cannot be added with only half
 * its hooks wired up.
 */
export const HOOK_POINTS: readonly string[] = HOOK_PHASES.flatMap((phase) =>
  HOOK_OPERATIONS.map((operation) => `${phase}-${operation}`)
);

export function isHookPoint(name: string): boolean {
  return HOOK_POINTS.includes(name);
}

/**
 * The environment a hook is given.
 *
 * This is a **documented public API** — someone's `post-switch` script depends
 * on these names, so renaming one is a breaking change.
 */
export interface HookEnvironment {
  /** Absolute path of the worktree the operation acted on. */
  LINCHPIN_WORKTREE?: string;
  /** Branch name, when the operation has one. */
  LINCHPIN_BRANCH?: string;
  /** Environment name from the config, for operations that target one. */
  LINCHPIN_ENVIRONMENT?: string;
  /** Previous branch — `mv` only. */
  LINCHPIN_OLD_BRANCH?: string;
  /** Previous worktree path — `mv` only. */
  LINCHPIN_OLD_WORKTREE?: string;
}

export interface HookResult {
  readonly ran: boolean;
  readonly hookFile: string | null;
  /** True when a hook was found but this machine has not approved its contents. */
  readonly blocked?: boolean;
  /** What to show the user when `blocked` — names the file and the remedy. */
  readonly reason?: string;
}

/**
 * Resolve `.linchpin/hooks/<name>`, or null when there is no such hook.
 *
 * ⚠️ `hookName` reaches here straight from argv via `wt invoke`, and this
 * function's answer is **sourced as bash**. A plain `path.join` let
 * `../../../payload` normalize its way clear of the repo and run any file on
 * the machine, so the join is contained; a symlink pointing out of the hooks
 * directory is refused too, since git tracks symlinks and a cloned repo can
 * plant one aimed anywhere.
 *
 * Returning null rather than throwing keeps the 12 lifecycle points quiet when
 * a repo simply has no hook; `wt invoke` reports the miss itself.
 */
export function findHookFile(basePath: string, hookName: string): string | null {
  const hooksRoot = path.join(basePath, '.linchpin', 'hooks');
  const hookFile = resolveContained(hooksRoot, hookName);

  if (hookFile === null) return null;
  if (!isContainedAfterLinks(hooksRoot, hookFile)) return null;

  try {
    if (fs.statSync(hookFile).isFile()) return hookFile;
  } catch {
    return null;
  }

  return null;
}

/**
 * Run a hook, if one exists.
 *
 * ⚠️ Hooks are **sourced**, not executed: `bash -c 'source "$1"'`. That is
 * deliberate and load-bearing — sourcing lets a hook export environment
 * variables and define functions that affect the surrounding shell, which
 * executing it as a subprocess would not. It also means a hook needs no
 * shebang and no execute bit, which is what most people write.
 *
 * The hook path is passed as an **argument** (`$1`), never interpolated into
 * the script string, so a path containing spaces or shell metacharacters stays
 * data.
 */
export function runHook(
  basePath: string,
  hookName: string,
  env: HookEnvironment = {},
  options: { cwd?: string } = {}
): HookResult {
  const hookFile = findHookFile(basePath, hookName);

  if (!hookFile) return { ran: false, hookFile: null };

  // ⚠️ Fail closed. A committed hook is code that arrived with a clone, so it
  // runs only once this machine has approved these exact bytes — see trust.ts.
  // Returning rather than throwing keeps a blocked hook from failing the
  // command around it; the caller reports the reason.
  if (!isHookTrusted(hookFile)) {
    return { ran: false, hookFile, blocked: true, reason: describeUntrustedHook(hookFile) };
  }

  runCommand('bash', ['-c', 'source "$1"', 'linchpin-hook', hookFile], {
    env: { ...process.env, ...env },
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });

  return { ran: true, hookFile };
}

/**
 * Build the environment for a hook.
 *
 * Undefined values are dropped rather than passed as the string "undefined",
 * which is what a hook would otherwise see when testing `-n "$LINCHPIN_BRANCH"`.
 */
export function buildHookEnvironment(input: {
  worktree?: string | null;
  branch?: string | null;
  environment?: string | null;
  oldBranch?: string | null;
  oldWorktree?: string | null;
}): HookEnvironment {
  const env: HookEnvironment = {};

  if (input.worktree) env.LINCHPIN_WORKTREE = input.worktree;
  if (input.branch) env.LINCHPIN_BRANCH = input.branch;
  if (input.environment) env.LINCHPIN_ENVIRONMENT = input.environment;
  if (input.oldBranch) env.LINCHPIN_OLD_BRANCH = input.oldBranch;
  if (input.oldWorktree) env.LINCHPIN_OLD_WORKTREE = input.oldWorktree;

  return env;
}
