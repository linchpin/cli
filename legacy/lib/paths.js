const fs = require('node:fs');
const path = require('node:path');

/**
 * CommonJS twin of src/core/paths.ts.
 *
 * ⚠️ Kept byte-for-byte equivalent in behaviour, not merely similar. The
 * dual-mode tests in test/paths.test.js assert both answer identically for
 * every case, the same way the hooks and symlink pairs are held together while
 * the port is in flight. Change one, change the other.
 */

/**
 * Resolve `segments` under `root`, or null when the result escapes it.
 *
 * `path.resolve` rather than `path.join` so an absolute segment is rejected
 * outright instead of being silently folded into the root.
 */
function resolveContained(root, ...segments) {
  const base = path.resolve(root);
  const resolved = path.resolve(base, ...segments);

  return isContained(base, resolved) ? resolved : null;
}

/**
 * Is `candidate` `base` itself, or something beneath it?
 *
 * The trailing separator stops `/repo-evil` matching a base of `/repo`.
 */
function isContained(base, candidate) {
  const resolvedBase = path.resolve(base);
  const resolvedCandidate = path.resolve(candidate);

  if (resolvedCandidate === resolvedBase) return true;

  const prefix = resolvedBase.endsWith(path.sep) ? resolvedBase : `${resolvedBase}${path.sep}`;
  return resolvedCandidate.startsWith(prefix);
}

/**
 * Containment that a symlink cannot talk its way out of.
 *
 * Both sides are realpath'd so a symlinked root (macOS `/tmp` →
 * `/private/tmp`) does not reject every legitimate path. A path that does not
 * exist yet falls back to the lexical answer.
 */
function isContainedAfterLinks(base, candidate) {
  if (!isContained(base, candidate)) return false;

  let realBase;
  let realCandidate;

  try {
    realBase = fs.realpathSync(base);
  } catch (_error) {
    return true;
  }

  try {
    realCandidate = fs.realpathSync(candidate);
  } catch (_error) {
    return true;
  }

  return isContained(realBase, realCandidate);
}

/** `resolveContained`, but it throws the message a user should see. */
function requireContained(root, segment, label) {
  const resolved = resolveContained(root, segment);

  if (resolved === null) {
    throw new Error(
      `'${segment}' resolves outside ${label}. Paths must stay within ${path.resolve(root)}.`
    );
  }

  return resolved;
}

module.exports = {
  isContained,
  isContainedAfterLinks,
  requireContained,
  resolveContained
};
