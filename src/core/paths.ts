import fs from 'node:fs';
import path from 'node:path';

/**
 * Path containment — proving a caller-supplied path stays where it belongs.
 *
 * Several commands take a path fragment from argv and join it to a trusted
 * root: `wt invoke <hook>`, `wt copy <path>`, `wt link <path>`. A bare
 * `path.join` is not a boundary. `path.join(root, '../../x')` normalizes
 * happily to a sibling of `root`, so the fragment escapes and the command acts
 * on a file the user never named a root for.
 *
 * That matters more here than in most CLIs. This tool is meant to be
 * pre-approved in an agent allowlist (`Bash(linchpin wt:*)`), and a prefix rule
 * matches the verb without seeing the argument — so an escaping argument is
 * pre-approved right along with a legitimate one.
 */

/**
 * Resolve `segments` under `root`, or null when the result escapes it.
 *
 * ⚠️ `path.resolve`, not `path.join`, and the difference is the point. `join`
 * silently swallows an absolute segment into the root
 * (`join('/repo', '/etc/passwd')` → `/repo/etc/passwd`); `resolve` lets it win
 * (`/etc/passwd`) so the containment check below can *reject* it. Rejecting is
 * honest where quietly rewriting the caller's path is not.
 */
export function resolveContained(root: string, ...segments: string[]): string | null {
  const base = path.resolve(root);
  const resolved = path.resolve(base, ...segments);

  return isContained(base, resolved) ? resolved : null;
}

/**
 * Is `candidate` `base` itself, or something beneath it?
 *
 * ⚠️ The trailing separator is load-bearing. A bare
 * `candidate.startsWith(base)` accepts `/repo-evil` for a base of `/repo`,
 * because the string prefix matches across a directory-name boundary. Compare
 * against `base + sep` so only a real descendant passes.
 */
export function isContained(base: string, candidate: string): boolean {
  const resolvedBase = path.resolve(base);
  const resolvedCandidate = path.resolve(candidate);

  if (resolvedCandidate === resolvedBase) return true;

  const prefix = resolvedBase.endsWith(path.sep) ? resolvedBase : `${resolvedBase}${path.sep}`;
  return resolvedCandidate.startsWith(prefix);
}

/**
 * Containment that a symlink cannot talk its way out of.
 *
 * A lexical check is enough for an argument, but not for a path that already
 * exists on disk: `.linchpin/hooks/post-switch` can itself be a **symlink**,
 * and git tracks symlinks, so a cloned repo can point one anywhere it likes.
 * The lexical check passes — the path really is under the root — while the
 * bytes come from outside it.
 *
 * ⚠️ Both sides are realpath'd, never just the candidate. On macOS a temp dir
 * is reached through `/tmp` but resolves to `/private/tmp`; resolving only the
 * candidate would compare `/private/tmp/...` against `/tmp/...` and reject
 * every legitimate path. Resolving both moves them together.
 *
 * A path that does not exist has no link to follow, so it falls back to the
 * lexical answer rather than failing closed — `wt link` legitimately names a
 * destination that is not there yet.
 */
export function isContainedAfterLinks(base: string, candidate: string): boolean {
  if (!isContained(base, candidate)) return false;

  let realBase: string;
  let realCandidate: string;

  try {
    realBase = fs.realpathSync(base);
  } catch {
    // No base on disk means nothing to compare against; the lexical answer stands.
    return true;
  }

  try {
    realCandidate = fs.realpathSync(candidate);
  } catch {
    // Nothing at the candidate path yet, so no link can be redirecting it.
    return true;
  }

  return isContained(realBase, realCandidate);
}

/**
 * `resolveContained`, but it throws the message a user should see.
 *
 * `label` names the boundary in the caller's own vocabulary — "the hooks
 * directory", "the base worktree" — because "path escapes root" tells someone
 * nothing about which root they crossed.
 */
export function requireContained(
  root: string,
  segment: string,
  label: string
): string {
  const resolved = resolveContained(root, segment);

  if (resolved === null) {
    throw new Error(
      `'${segment}' resolves outside ${label}. Paths must stay within ${path.resolve(root)}.`
    );
  }

  return resolved;
}
