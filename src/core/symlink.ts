import fs from 'node:fs';
import path from 'node:path';

/**
 * Does this path look like a slot a WordPress install actually owns?
 *
 * ⚠️ This is the guard on a recursive delete whose target comes from
 * `.linchpin.json` — a **committed** file, so a cloned repo chooses it. Without
 * a check, `wt switch --force` would remove any absolute path a repository
 * cared to name.
 *
 * The test mirrors how `buildTargetPath` composes these paths in the first
 * place: something under a `wp-content` directory, or a directory that is one.
 * A deliberately loose fit — someone's install can live anywhere — but it does
 * rule out a home directory, a source tree, or a volume root, which is the
 * class of mistake worth refusing.
 */
export function isWordPressContentTarget(targetPath: string): boolean {
  const segments = path.resolve(targetPath).split(path.sep).filter(Boolean);
  if (segments.length === 0) return false;

  if (segments.includes('wp-content')) return true;

  // A `wp-content` repo may be linked in under its own name, in which case the
  // parent is the WordPress root and holds the usual siblings.
  const parent = segments[segments.length - 2];
  return parent === 'plugins' || parent === 'themes' || parent === 'mu-plugins';
}

export interface ExistingTarget {
  readonly exists: boolean;
  readonly isSymlink: boolean;
}

export interface LinkResult {
  readonly changed: boolean;
  readonly action: string;
}

export interface EnsureLinkOptions {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
}

/**
 * Point `targetPath` at `sourcePath`, idempotently.
 *
 * This is the core mechanic of the whole worktree feature: it is how a
 * WordPress install gets repointed at a different worktree without moving
 * files.
 */
export function ensurePluginLink({
  sourcePath,
  targetPath,
  force = false,
  dryRun = false,
}: EnsureLinkOptions): LinkResult {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedTarget = path.resolve(targetPath);

  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`Worktree path does not exist: ${resolvedSource}`);
  }

  const parent = path.dirname(resolvedTarget);
  if (!fs.existsSync(parent)) {
    if (dryRun) {
      return { changed: false, action: `Would create parent directory ${parent}` };
    }
    fs.mkdirSync(parent, { recursive: true });
  }

  const existing = readExistingTarget(resolvedTarget);

  if (existing.exists && existing.isSymlink) {
    const currentResolved = safeReadlinkResolved(resolvedTarget);

    if (currentResolved === resolvedSource) {
      return { changed: false, action: `Already linked: ${resolvedTarget} -> ${resolvedSource}` };
    }

    if (!dryRun) {
      removeExisting(resolvedTarget);
      createSymlink(resolvedSource, resolvedTarget);
    }

    return { changed: true, action: `Repointed symlink: ${resolvedTarget} -> ${resolvedSource}` };
  }

  if (existing.exists && !existing.isSymlink) {
    if (!force) {
      throw new Error(
        `Target exists and is not a symlink: ${resolvedTarget}. Re-run with --force to replace it.`
      );
    }

    // `--force` authorises replacing a WordPress content slot. It is not
    // authority to delete an arbitrary path, and the path came from a file the
    // repository controls, so the shape of the target is checked before the
    // recursive remove rather than after.
    if (!isWordPressContentTarget(resolvedTarget)) {
      throw new Error(
        `Refusing to delete ${resolvedTarget}: it is not inside a WordPress content directory. ` +
          `Check wordpress.environments in .linchpin.json.`
      );
    }

    if (!dryRun) fs.rmSync(resolvedTarget, { force: true, recursive: true });
  }

  if (!dryRun) createSymlink(resolvedSource, resolvedTarget);

  return {
    changed: true,
    action: `${dryRun ? 'Would create' : 'Created'} symlink: ${resolvedTarget} -> ${resolvedSource}`,
  };
}

/**
 * Create a symlink, clearing a stale entry first.
 *
 * `junction` on win32 because a plain symlink there needs elevated privileges;
 * a junction does not and behaves the same for a directory target.
 */
function createSymlink(source: string, target: string): void {
  const type = process.platform === 'win32' ? 'junction' : 'dir';

  try {
    fs.symlinkSync(source, target, type);
  } catch (error) {
    // Some platforms fail to report a dangling link through lstat, so the
    // create races ahead and fails EEXIST. Clear and retry once.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    removeExisting(target);
    fs.symlinkSync(source, target, type);
  }
}

/** Remove a symlink, file or directory if present. */
function removeExisting(targetPath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(targetPath);
  } catch {
    return;
  }

  // unlink rather than rm for a symlink, so a broken link is removed without
  // following it to a target that may not exist.
  if (stat.isSymbolicLink()) fs.unlinkSync(targetPath);
  else fs.rmSync(targetPath, { force: true, recursive: true });
}

/** Does something exist at this path, and is it a symlink? Uses lstat, so it does not follow. */
export function readExistingTarget(targetPath: string): ExistingTarget {
  try {
    const stat = fs.lstatSync(targetPath);
    return { exists: true, isSymlink: stat.isSymbolicLink() };
  } catch {
    return { exists: false, isSymlink: false };
  }
}

/**
 * Resolve a symlink's target.
 *
 * ⚠️ `readlinkSync`, deliberately — **not** `realpathSync` or an existence
 * check. It reads the link's recorded target without following it, so
 * "already linked" is still detected correctly when the target directory has
 * been deleted. Simplifying this to an existence check silently breaks
 * repointing over a broken link, which is the common case after an agent moves
 * a worktree.
 */
function safeReadlinkResolved(linkPath: string): string | null {
  try {
    const raw = fs.readlinkSync(linkPath);
    return path.resolve(path.dirname(linkPath), raw);
  } catch {
    return null;
  }
}

export type ConflictResolution = 'backup' | 'delete' | 'skip';

export interface ConflictOutcome {
  readonly resolved: boolean;
  readonly action: string;
  readonly backupPath?: string;
}

/**
 * Apply a chosen resolution to a real directory sitting where a symlink should go.
 *
 * The **decision** belongs to the caller — this takes one already made. Keeping
 * the effect here rather than inline in the wizard is what makes all three
 * branches testable; they previously lived between two prompts and had no
 * coverage at all.
 */
export function resolveTargetConflict({
  targetPath,
  resolution,
  dryRun = false,
}: {
  targetPath: string;
  resolution: ConflictResolution;
  dryRun?: boolean;
}): ConflictOutcome {
  const resolvedTarget = path.resolve(targetPath);

  if (resolution === 'skip') {
    return { resolved: false, action: 'Skipped' };
  }

  if (resolution === 'delete') {
    if (!dryRun) fs.rmSync(resolvedTarget, { force: true, recursive: true });
    return { resolved: true, action: `${dryRun ? 'Would delete' : 'Deleted'} existing folder` };
  }

  const backupPath = `${resolvedTarget}.bkp`;

  // Refuse rather than overwrite: a second run would otherwise destroy the
  // backup taken by the first, which is the one copy of the user's data.
  if (fs.existsSync(backupPath)) {
    return {
      resolved: false,
      action: `Backup path already exists: ${backupPath}. Skipping.`,
      backupPath,
    };
  }

  if (!dryRun) fs.renameSync(resolvedTarget, backupPath);

  return {
    resolved: true,
    action: `${dryRun ? 'Would rename' : 'Renamed'} existing folder to ${path.basename(backupPath)}`,
    backupPath,
  };
}
