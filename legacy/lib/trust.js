const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * CommonJS twin of src/core/trust.ts — which carries the full reasoning.
 *
 * ⚠️ Behaviour must match exactly; test/trust.test.js asserts both answer the
 * same for every case, as with the hooks, symlink and paths pairs.
 */

const EMPTY_TRUST_STORE = { hooks: {} };

function trustFilePath() {
  const explicit = process.env.LINCHPIN_TRUST_FILE && process.env.LINCHPIN_TRUST_FILE.trim();
  if (explicit) {
    return explicit;
  }

  const xdg = process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.trim();
  if (xdg) {
    return path.join(xdg, 'linchpin', 'trust.json');
  }

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA && process.env.LOCALAPPDATA.trim();
    if (local) {
      return path.join(local, 'linchpin', 'trust.json');
    }
  }

  return path.join(os.homedir(), '.local', 'share', 'linchpin', 'trust.json');
}

/**
 * The key a hook is stored under — realpath, so /var and /private/var on macOS
 * do not file and look up trust under two different names.
 */
function trustKey(hookFile) {
  try {
    return fs.realpathSync(hookFile);
  } catch (_error) {
    return path.resolve(hookFile);
  }
}

function hashHookFile(hookFile) {
  try {
    return createHash('sha256').update(fs.readFileSync(hookFile)).digest('hex');
  } catch (_error) {
    return null;
  }
}

/** A corrupt store denies every hook; it is never read as blanket approval. */
function readTrustStore(filePath = trustFilePath()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (typeof parsed !== 'object' || parsed === null || !parsed.hooks) {
      return EMPTY_TRUST_STORE;
    }

    if (typeof parsed.hooks !== 'object' || parsed.hooks === null) {
      return EMPTY_TRUST_STORE;
    }

    const hooks = {};
    for (const [key, value] of Object.entries(parsed.hooks)) {
      if (typeof value === 'string') {
        hooks[key] = value;
      }
    }

    return { hooks };
  } catch (_error) {
    return EMPTY_TRUST_STORE;
  }
}

function writeTrustStore(store, filePath = trustFilePath()) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    return true;
  } catch (_error) {
    return false;
  }
}

function isHookTrusted(hookFile, filePath = trustFilePath()) {
  const digest = hashHookFile(hookFile);
  if (digest === null) {
    return false;
  }

  const store = readTrustStore(filePath);
  return store.hooks[trustKey(hookFile)] === digest;
}

function trustHook(hookFile, filePath = trustFilePath()) {
  const digest = hashHookFile(hookFile);
  if (digest === null) {
    return null;
  }

  const store = readTrustStore(filePath);
  const hooks = { ...store.hooks, [trustKey(hookFile)]: digest };

  return writeTrustStore({ hooks }, filePath) ? digest : null;
}

function revokeHook(hookFile, filePath = trustFilePath()) {
  const store = readTrustStore(filePath);
  const key = trustKey(hookFile);

  if (!(key in store.hooks)) {
    return false;
  }

  const hooks = { ...store.hooks };
  delete hooks[key];

  return writeTrustStore({ hooks }, filePath);
}

function describeUntrustedHook(hookFile) {
  return (
    `Blocked untrusted hook: ${hookFile}\n` +
    `  This file is committed to the repository and would be sourced by your shell.\n` +
    `  Review it, then run: linchpin wt trust ${path.basename(hookFile)}`
  );
}

module.exports = {
  EMPTY_TRUST_STORE,
  describeUntrustedHook,
  hashHookFile,
  isHookTrusted,
  readTrustStore,
  revokeHook,
  trustFilePath,
  trustHook,
  writeTrustStore
};
