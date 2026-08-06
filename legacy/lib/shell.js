const { execFileSync } = require('node:child_process');

function runCommand(command, args, options = {}) {
  const { allowFailure = false, ...execOptions } = options;

  try {
    const output = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...execOptions
    });

    return {
      ok: true,
      stdout: output.trimEnd(),
      stderr: ''
    };
  } catch (error) {
    const stderr = error && error.stderr ? String(error.stderr).trim() : '';

    if (allowFailure) {
      return {
        ok: false,
        stdout: error && error.stdout ? String(error.stdout).trimEnd() : '',
        stderr
      };
    }

    throw new Error(stderr || error.message);
  }
}

module.exports = {
  runCommand
};
