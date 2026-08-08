import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { dedupePaths, getAgentScanRoots } from './agents.js';
import { runCommand } from './exec.js';

export interface WorktreeEntry {
  readonly worktree: string;
  readonly head: string;
  readonly branch: string | null;
  readonly detached: boolean;
}

export interface ResolvedWorktree extends WorktreeEntry {
  readonly resolvedWorktree: string;
}

/** Config shape this module needs. Deliberately narrow — the full config is not its business. */
export interface AgentAwareConfig {
  readonly agents?: Record<string, string> | null;
}

export interface InferenceOptions {
  readonly config?: AgentAwareConfig | null;
}

/**
 * Parse `git worktree list --porcelain`.
 *
 * Pure and directly unit-tested. Records are separated by blank lines; a
 * `worktree` key starts a new record, and keys before the first one are ignored.
 */
export function parseWorktreePorcelain(input: string): WorktreeEntry[] {
  const rows = input.split(/\r?\n/);
  const worktrees: WorktreeEntry[] = [];
  let current: {
    worktree: string;
    head: string;
    branch: string | null;
    detached: boolean;
  } | null = null;

  for (const row of rows) {
    if (!row) {
      if (current?.worktree) worktrees.push(current);
      current = null;
      continue;
    }

    const firstSpace = row.indexOf(' ');
    const key = firstSpace === -1 ? row : row.slice(0, firstSpace);
    const value = firstSpace === -1 ? '' : row.slice(firstSpace + 1);

    if (key === 'worktree') {
      current = { worktree: value, head: '', branch: null, detached: false };
      continue;
    }

    if (!current) continue;

    if (key === 'HEAD') {
      current.head = value;
    } else if (key === 'branch') {
      current.branch = value.replace(/^refs\/heads\//, '');
    } else if (key === 'detached') {
      current.detached = true;
      current.branch = null;
    }
  }

  if (current?.worktree) worktrees.push(current);

  return worktrees;
}

/** `fs.realpathSync`, falling back to a plain resolve when the path does not exist. */
export function safeRealpath(inputPath: string): string {
  try {
    return fs.realpathSync(inputPath);
  } catch {
    return path.resolve(inputPath);
  }
}

/** Walk up until a directory containing `.git` is found. */
export function findGitAnchor(startPath: string): string | null {
  let current = safeRealpath(startPath);

  try {
    if (!fs.statSync(current).isDirectory()) current = path.dirname(current);
  } catch {
    current = path.dirname(current);
  }

  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function getCurrentTopLevel(cwd: string): string {
  const resolvedCwd = safeRealpath(cwd);
  const result = runCommand('git', ['rev-parse', '--show-toplevel'], {
    cwd: resolvedCwd,
    allowFailure: true,
  });

  if (result.ok) return result.stdout;

  const anchor = findGitAnchor(resolvedCwd);
  if (anchor) return safeRealpath(anchor);

  throw new Error(result.stderr || `fatal: not a git repository: ${resolvedCwd}`);
}

/**
 * List worktrees, trying up to three candidate directories.
 *
 * ⚠️ The multiple attempts are load-bearing, not defensive padding. An agent
 * that repoints or archives the symlink a session is sitting in leaves the cwd
 * pointing somewhere git no longer recognises; the inferred base repo is then
 * the only way back. Removing the fallbacks reintroduces the exact failure the
 * `wt-symlink-fallback` tests cover.
 */
export function listWorktrees(cwd: string, options: InferenceOptions = {}): ResolvedWorktree[] {
  const resolvedCwd = safeRealpath(cwd);
  const attempts = [resolvedCwd];

  const inferredBasePath = inferBaseRepoPath(resolvedCwd);
  const inferredBaseByWorktreeId = inferBaseRepoPathFromWorktreeId(resolvedCwd, options);

  if (inferredBasePath && inferredBasePath !== resolvedCwd) {
    attempts.push(inferredBasePath);
  }
  if (
    inferredBaseByWorktreeId &&
    inferredBaseByWorktreeId !== resolvedCwd &&
    !attempts.includes(inferredBaseByWorktreeId)
  ) {
    attempts.push(inferredBaseByWorktreeId);
  }

  let parsed: WorktreeEntry[] | null = null;
  let lastError = '';

  for (const attemptCwd of attempts) {
    const result = runCommand('git', ['worktree', 'list', '--porcelain'], {
      cwd: attemptCwd,
      allowFailure: true,
    });

    if (result.ok) {
      parsed = parseWorktreePorcelain(result.stdout);
      break;
    }

    lastError = result.stderr || lastError;
  }

  if (!parsed) throw new Error(lastError || 'Unable to list git worktrees.');

  return parsed.map((entry) => ({
    ...entry,
    resolvedWorktree: safeRealpath(entry.worktree),
  }));
}

/**
 * The repository's main worktree.
 *
 * ⚠️ Relies on git listing the main worktree **first** in
 * `git worktree list --porcelain`. That ordering is guaranteed by git and is
 * what makes `[0]` correct rather than lucky — do not re-sort the list, and do
 * not replace this with a search by path.
 */
export function getBaseWorktreePath(cwd: string, options: InferenceOptions = {}): string {
  const worktrees = listWorktrees(cwd, options);

  if (worktrees.length === 0) throw new Error('No git worktrees found in this repository.');

  return worktrees[0]!.worktree;
}

/**
 * Resolve a user-supplied reference to a worktree.
 *
 * Order: exact branch, then an existing path, then a basename or `@suffix`
 * match. The fallback refuses to guess when more than one worktree matches.
 */
export function resolveWorktreeRef({
  ref,
  worktrees,
  cwd,
}: {
  ref?: string | null;
  worktrees: readonly ResolvedWorktree[];
  cwd: string;
}): ResolvedWorktree {
  const selectedRef = ref || getCurrentTopLevel(cwd);

  const byBranch = worktrees.find((item) => item.branch === selectedRef);
  if (byBranch) return byBranch;

  const absoluteRef = path.resolve(cwd, selectedRef);
  if (fs.existsSync(absoluteRef)) {
    const resolvedInput = safeRealpath(absoluteRef);
    const pathMatch = worktrees.find((item) => item.resolvedWorktree === resolvedInput);

    if (pathMatch) return pathMatch;

    throw new Error(`'${selectedRef}' exists but is not a tracked git worktree.`);
  }

  const fallbackMatches = worktrees.filter((item) => {
    const basename = path.basename(item.worktree);
    return (
      basename === selectedRef ||
      item.worktree.endsWith(`@${selectedRef}`) ||
      basename.endsWith(`@${selectedRef}`)
    );
  });

  if (fallbackMatches.length === 1) return fallbackMatches[0]!;

  if (fallbackMatches.length > 1) {
    throw new Error(
      `Ambiguous worktree reference '${selectedRef}'. Use a full branch name or full path.`
    );
  }

  throw new Error(
    `Unable to resolve worktree '${selectedRef}'. Run 'linchpin wt ls' to view available worktrees.`
  );
}

/**
 * Infer the base repo by stripping the `@branch` suffix.
 *
 * Worktrees are created as siblings named `${basePath}@${branchName}`, so
 * `~/GitHub/my-plugin@feature/x` implies `~/GitHub/my-plugin`. Only returned
 * when that sibling actually contains a `.git`.
 */
export function inferBaseRepoPath(startPath: string): string | null {
  const anchor = findGitAnchor(startPath);
  if (!anchor) return null;

  const candidates = [anchor, safeRealpath(anchor)];
  for (const candidate of candidates) {
    const baseCandidate = stripWorktreeSuffix(candidate);
    if (!baseCandidate || baseCandidate === candidate) continue;
    if (!fs.existsSync(path.join(baseCandidate, '.git'))) continue;

    return safeRealpath(baseCandidate);
  }

  return null;
}

/**
 * Infer the base repo from the worktree id in its `.git` pointer file.
 *
 * The stronger of the two inferences: it identifies the repo by the metadata
 * git itself wrote (`.git/worktrees/<id>`) rather than by a naming convention,
 * so it survives a renamed or relocated worktree directory.
 *
 * Direct candidates are probed before scanning, because a hit there costs one
 * `existsSync` while a scan reads whole directories.
 */
export function inferBaseRepoPathFromWorktreeId(
  startPath: string,
  options: InferenceOptions = {}
): string | null {
  const anchor = findGitAnchor(startPath);
  if (!anchor) return null;

  const gitdirPointer = readGitdirPointer(anchor);
  const worktreeId = extractWorktreeId(gitdirPointer);
  if (!worktreeId) return null;

  const repoName = path.basename(path.dirname(anchor));
  const parentRoot = path.dirname(path.dirname(anchor));
  const grandparentRoot = path.dirname(parentRoot);

  // Config-declared agent roots come first — see getAgentScanRoots for why this
  // argument exists at all.
  const agentScanRoots = getAgentScanRoots(options.config ?? null);

  const directCandidates = dedupePaths([
    path.join(parentRoot, repoName),
    path.join(grandparentRoot, repoName),
    path.join(os.homedir(), 'Documents', 'GitHub', repoName),
    path.join(os.homedir(), 'Documents', repoName),
    path.join(os.homedir(), repoName),
    ...agentScanRoots.map((root) => path.join(root, repoName)),
  ]);

  for (const candidate of directCandidates) {
    if (hasWorktreeMetadata(candidate, worktreeId)) return safeRealpath(candidate);
  }

  const scanRoots = dedupePaths([
    parentRoot,
    grandparentRoot,
    path.join(os.homedir(), 'Documents', 'GitHub'),
    path.join(os.homedir(), 'Documents'),
    ...agentScanRoots,
  ]);

  for (const root of scanRoots) {
    const fromRoot = findRepoWithWorktreeId(root, worktreeId);
    if (fromRoot) return fromRoot;
  }

  return null;
}

/** Read the `gitdir:` line from a worktree's `.git` file. Directories have none. */
export function readGitdirPointer(worktreePath: string): string | null {
  const gitPath = path.join(worktreePath, '.git');

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(gitPath);
  } catch {
    return null;
  }

  if (!stat.isFile()) return null;

  try {
    const content = fs.readFileSync(gitPath, 'utf8');
    const match = content.match(/^gitdir:\s*(.+)\s*$/m);
    return match?.[1] ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/** Pull `<id>` out of a `…/.git/worktrees/<id>` pointer. Windows separators normalized. */
export function extractWorktreeId(gitdirPointer: string | null): string | null {
  if (!gitdirPointer || typeof gitdirPointer !== 'string') return null;

  const normalized = gitdirPointer.replace(/\\/g, '/');
  const match = normalized.match(/\/\.git\/worktrees\/([^/]+)$/);
  return match?.[1] ?? null;
}

export function hasWorktreeMetadata(repoPath: string | null, worktreeId: string | null): boolean {
  if (!repoPath || !worktreeId) return false;
  return fs.existsSync(path.join(repoPath, '.git', 'worktrees', worktreeId));
}

/** Scan one directory level for a repo whose metadata claims this worktree id. */
export function findRepoWithWorktreeId(rootPath: string, worktreeId: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const candidate = path.join(rootPath, entry.name);
    if (hasWorktreeMetadata(candidate, worktreeId)) return safeRealpath(candidate);
  }

  return null;
}

/**
 * Strip the `@branch` suffix from the nearest ancestor that carries one.
 *
 * `atIndex > 0` rather than `>= 0` on purpose: a directory literally named
 * `@something` has no repo name to recover.
 */
export function stripWorktreeSuffix(repoPath: string): string | null {
  let current = path.resolve(repoPath);

  for (;;) {
    const basename = path.basename(current);
    const atIndex = basename.lastIndexOf('@');

    if (atIndex > 0) {
      const repoName = basename.slice(0, atIndex);
      return path.join(path.dirname(current), repoName);
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

export { dedupePaths };
