const fs = require('node:fs');
const path = require('node:path');
const { runCommand } = require('./shell');

function findHookFile(basePath, hookName) {
  const hookFile = path.join(basePath, '.linchpin', 'hooks', hookName);
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
