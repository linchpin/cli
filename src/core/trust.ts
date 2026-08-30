import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Which hooks this machine has agreed to run.
 *
 * `.linchpin/hooks/*` are committed project files, so they arrive with a clone
 * — unlike `.git/hooks`, which git deliberately refuses to transfer for exactly
 * this reason. A hook is *sourced*, needing no execute bit and no shebang, so
 * nothing about the file in a diff marks it as code that will run.
 *
 * The answer is the one `direnv` and `mise` settled on: a hook does nothing
 * until this machine has vouched for its **contents**. Editing a trusted hook
 * changes its digest and withdraws that trust, so approval covers the bytes
 * that were reviewed rather than the filename.
 *
 * Trust is per-machine and lives outside the repo — a repo that could grant
 * its own trust would grant nothing at all.
 */

export interface TrustStore {
  /** Absolute hook path → sha256 of the contents that were approved. */
  readonly hooks: Record<string, string>;
}

export const EMPTY_TRUST_STORE: TrustStore = { hooks: {} };

/**
 * Where the trust file lives.
 *
 * State, not cache: a cleared cache should cost a network round trip, never a
 * silent re-grant of code execution. Hence XDG_DATA_HOME rather than the
 * update checker's XDG_CACHE_HOME.
 */
export function trustFilePath(): string {
  const explicit = process.env.LINCHPIN_TRUST_FILE?.trim();
  if (explicit) return explicit;

  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg) return path.join(xdg, 'linchpin', 'trust.json');

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA?.trim();
    if (local) return path.join(local, 'linchpin', 'trust.json');
  }

  return path.join(homedir(), '.local', 'share', 'linchpin', 'trust.json');
}

/**
 * The key a hook is stored under.
 *
 * ⚠️ realpath, not `path.resolve`. The CLI reaches a repo through
 * `safeRealpath`, so on macOS it sees `/private/var/…` where a caller may have
 * said `/var/…`. Keying on the un-resolved string would file trust under one
 * name and look it up under the other — the hook would read as untrusted
 * immediately after being trusted.
 */
function trustKey(hookFile: string): string {
  try {
    return fs.realpathSync(hookFile);
  } catch {
    return path.resolve(hookFile);
  }
}

/** sha256 of a hook's contents, or null when it cannot be read. */
export function hashHookFile(hookFile: string): string | null {
  try {
    return createHash('sha256').update(fs.readFileSync(hookFile)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Read the store. Never throws.
 *
 * ⚠️ An unreadable or malformed store returns **empty**, which denies every
 * hook. That is the direction a failure here must fall: a corrupt file may not
 * be read as blanket approval.
 */
export function readTrustStore(filePath: string = trustFilePath()): TrustStore {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (typeof parsed !== 'object' || parsed === null || !('hooks' in parsed)) {
      return EMPTY_TRUST_STORE;
    }

    const { hooks } = parsed as { hooks: unknown };
    if (typeof hooks !== 'object' || hooks === null) return EMPTY_TRUST_STORE;

    const entries = Object.entries(hooks as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    );

    return { hooks: Object.fromEntries(entries) };
  } catch {
    return EMPTY_TRUST_STORE;
  }
}

/** Persist the store. Returns whether it landed; a read-only home is not fatal. */
export function writeTrustStore(store: TrustStore, filePath: string = trustFilePath()): boolean {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Has this exact hook file, with these exact contents, been approved here?
 *
 * The digest comparison is what makes an edit withdraw trust: a hook approved
 * yesterday and rewritten today is a different hook.
 */
export function isHookTrusted(hookFile: string, filePath: string = trustFilePath()): boolean {
  const digest = hashHookFile(hookFile);
  if (digest === null) return false;

  const store = readTrustStore(filePath);
  return store.hooks[trustKey(hookFile)] === digest;
}

/** Approve a hook's current contents. Returns the digest recorded, or null. */
export function trustHook(hookFile: string, filePath: string = trustFilePath()): string | null {
  const digest = hashHookFile(hookFile);
  if (digest === null) return null;

  const store = readTrustStore(filePath);
  const hooks = { ...store.hooks, [trustKey(hookFile)]: digest };

  return writeTrustStore({ hooks }, filePath) ? digest : null;
}

/** Withdraw approval. Returns whether there was anything to withdraw. */
export function revokeHook(hookFile: string, filePath: string = trustFilePath()): boolean {
  const store = readTrustStore(filePath);
  const key = trustKey(hookFile);

  if (!(key in store.hooks)) return false;

  const hooks = { ...store.hooks };
  delete hooks[key];

  return writeTrustStore({ hooks }, filePath);
}

/**
 * What to tell someone whose hook did not run.
 *
 * Names the file and the one command that changes the outcome. A blocked hook
 * that only says "blocked" turns a security control into a mystery, and a
 * mystery gets worked around rather than reviewed.
 */
export function describeUntrustedHook(hookFile: string): string {
  return (
    `Blocked untrusted hook: ${hookFile}\n` +
    `  This file is committed to the repository and would be sourced by your shell.\n` +
    `  Review it, then run: linchpin wt trust ${path.basename(hookFile)}`
  );
}
