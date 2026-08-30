const fs = require('node:fs');
const path = require('node:path');
const { runCommand } = require('./shell');
const { isContainedAfterLinks, resolveContained } = require('./paths');
const { describeUntrustedHook, isHookTrusted } = require('./trust');

/**
 * Resolve `.linchpin/hooks/<name>`, or null when there is no such hook.
 *
 * `hookName` comes from argv via `wt invoke` and the result is sourced as
 * bash, so the join is contained rather than plain — see src/core/paths.ts.
 */
function findHookFile(basePath, hookName) {
  const hooksRoot = path.join(basePath, '.linchpin', 'hooks');
  const hookFile = resolveContained(hooksRoot, hookName);

  if (hookFile === null) {
    return null;
  }

  if (!isContainedAfterLinks(hooksRoot, hookFile)) {
    return null;
  }

  if (fs.existsSync(hookFile) && fs.statSync(hookFile).isFile()) {
    return hookFile;
  }

  return null;
}

function runHook(basePath, hookName, env = {}, options = {}) {
  const hookFile = findHookFile(basePath, hookName);

  if (!hookFile) {
    return {
      ran: false,
      hookFile: null
    };
  }

  // Fail closed: a committed hook runs only once this machine has approved
  // these exact bytes. See legacy/lib/trust.js.
  if (!isHookTrusted(hookFile)) {
    return {
      ran: false,
      hookFile,
      blocked: true,
      reason: describeUntrustedHook(hookFile)
    };
  }

  const execOptions = {
    env: {
      ...process.env,
      ...env
    }
  };
  if (options.cwd) {
    execOptions.cwd = options.cwd;
  }

  runCommand('bash', ['-c', 'source "$1"', 'linchpin-hook', hookFile], execOptions);

  return {
    ran: true,
    hookFile
  };
}

module.exports = {
  findHookFile,
  runHook
};
