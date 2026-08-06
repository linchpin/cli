const fs = require('node:fs');
const path = require('node:path');

function ensurePluginLink({ sourcePath, targetPath, force = false, dryRun = false }) {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedTarget = path.resolve(targetPath);

  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`Worktree path does not exist: ${resolvedSource}`);
  }

  const parent = path.dirname(resolvedTarget);
  if (!fs.existsSync(parent)) {
    if (dryRun) {
      return {
        changed: false,
        action: `Would create parent directory ${parent}`
      };
    }

    fs.mkdirSync(parent, { recursive: true });
  }

  const existing = readExistingTarget(resolvedTarget);

  if (existing.exists && existing.isSymlink) {
    const currentResolved = safeReadlinkResolved(resolvedTarget);
    if (currentResolved === resolvedSource) {
      return {
        changed: false,
        action: `Already linked: ${resolvedTarget} -> ${resolvedSource}`
      };
    }

    if (!dryRun) {
      removeExisting(resolvedTarget);
      createSymlink(resolvedSource, resolvedTarget);
    }

    return {
      changed: true,
      action: `Repointed symlink: ${resolvedTarget} -> ${resolvedSource}`
    };
  }

  if (existing.exists && !existing.isSymlink) {
    if (!force) {
      throw new Error(
        `Target exists and is not a symlink: ${resolvedTarget}. Re-run with --force to replace it.`
      );
    }

    if (!dryRun) {
      fs.rmSync(resolvedTarget, { force: true, recursive: true });
    }
  }

  if (!dryRun) {
    createSymlink(resolvedSource, resolvedTarget);
  }

  return {
    changed: true,
    action: `${dryRun ? 'Would create' : 'Created'} symlink: ${resolvedTarget} -> ${resolvedSource}`
  };
}

/**
 * Creates a symlink, removing any stale entry (e.g. broken symlink) that
 * exists at the target path. Handles EEXIST from platform edge-cases where
 * lstatSync fails to detect the dangling link.
 *
 * @param {string} source - Absolute path the symlink should point to.
 * @param {string} target - Absolute path where the symlink will be created.
 */
function createSymlink(source, target) {
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  try {
    fs.symlinkSync(source, target, type);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    removeExisting(target);
    fs.symlinkSync(source, target, type);
  }
}

/**
 * Removes a filesystem entry (symlink, file, or directory) if it exists.
 * Uses unlinkSync for symlinks to avoid following a broken target.
 *
 * @param {string} targetPath - Absolute path to remove.
 */
function removeExisting(targetPath) {
  let stat;
  try {
    stat = fs.lstatSync(targetPath);
  } catch (_err) {
    return;
  }
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(targetPath);
  } else {
    fs.rmSync(targetPath, { force: true, recursive: true });
  }
}

function readExistingTarget(targetPath) {
  try {
    const stat = fs.lstatSync(targetPath);
    return {
      exists: true,
      isSymlink: stat.isSymbolicLink()
    };
  } catch (_error) {
    return {
      exists: false,
      isSymlink: false
    };
  }
}

/**
 * Resolves the absolute target of a symlink. Uses readlinkSync so it works
 * for broken symlinks whose target directory no longer exists.
 *
 * @param {string} linkPath - Absolute path to the symlink.
 * @returns {string|null} Resolved absolute path, or null on failure.
 */
function safeReadlinkResolved(linkPath) {
  try {
    const raw = fs.readlinkSync(linkPath);
    return path.resolve(path.dirname(linkPath), raw);
  } catch (_error) {
    return null;
  }
}

module.exports = {
  ensurePluginLink,
  readExistingTarget
};
