/**
 * Outputs a shell wrapper function for the current shell.
 *
 * After `linchpin wt switch` repoints a symlink the kernel cwd still
 * resolves to the *old* worktree.  The wrapper re-enters `$PWD` (the
 * logical / symlink path) so the shell lands in the new target.
 *
 * Usage:
 *   eval "$(linchpin shell-init)"        # zsh / bash
 *
 * @param {string[]} argv - Remaining CLI arguments (currently unused).
 * @returns {number} Exit code.
 */
function runShellInit(argv) {
  const shell = detectShell(argv);

  if (shell === 'fish') {
    process.stdout.write(fishWrapper());
  } else {
    process.stdout.write(posixWrapper());
  }

  return 0;
}

/**
 * Detect the target shell from explicit flag or $SHELL.
 *
 * @param {string[]} argv - CLI arguments.
 * @returns {'bash'|'zsh'|'fish'|'posix'} Shell identifier.
 */
function detectShell(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--shell' && argv[i + 1]) {
      return normalizeShellName(argv[i + 1]);
    }
    if (argv[i].startsWith('--shell=')) {
      return normalizeShellName(argv[i].slice('--shell='.length));
    }
  }

  const envShell = process.env.SHELL || '';
  return normalizeShellName(envShell);
}

/**
 * @param {string} name - Raw shell name or path (e.g. "/bin/zsh").
 * @returns {'bash'|'zsh'|'fish'|'posix'}
 */
function normalizeShellName(name) {
  const base = name.split('/').pop() || '';
  if (base === 'fish') {
    return 'fish';
  }
  if (base === 'zsh' || base === 'bash') {
    return base;
  }
  return 'posix';
}

function posixWrapper() {
  return [
    'linchpin() {',
    '  command linchpin "$@"',
    '  local __linchpin_exit=$?',
    '',
    '  if [ $__linchpin_exit -eq 0 ] && [ "$1" = "wt" ] && [ "$2" = "switch" ]; then',
    '    builtin cd "$PWD" 2>/dev/null || true',
    '  fi',
    '',
    '  return $__linchpin_exit',
    '}',
    ''
  ].join('\n');
}

function fishWrapper() {
  return [
    'function linchpin',
    '  command linchpin $argv',
    '  set -l __linchpin_exit $status',
    '',
    '  if test $__linchpin_exit -eq 0; and test "$argv[1]" = "wt"; and test "$argv[2]" = "switch"',
    '    builtin cd "$PWD" 2>/dev/null; or true',
    '  end',
    '',
    '  return $__linchpin_exit',
    'end',
    ''
  ].join('\n');
}

module.exports = {
  runShellInit,
  detectShell,
  posixWrapper,
  fishWrapper
};
