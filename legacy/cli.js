const { runWt } = require('./commands/wt');
const { runShellInit } = require('./commands/shell-init');

async function run(argv) {
  const command = argv[0] || 'help';

  switch (command) {
    case 'wt':
      return runWt(argv.slice(1));
    case 'shell-init':
      return runShellInit(argv.slice(1));
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return 0;
    case '--version':
    case '-v':
      process.stdout.write('0.1.0\n');
      return 0;
    default:
      throw new Error(`Unknown command '${command}'. Run 'linchpin --help'.`);
  }
}

function printHelp() {
  process.stdout.write('linchpin\n\n');
  process.stdout.write('Usage:\n');
  process.stdout.write('  linchpin wt <command>\n');
  process.stdout.write('  linchpin shell-init [--shell bash|zsh|fish]\n\n');
  process.stdout.write('Commands:\n');
  process.stdout.write('  wt           Manage worktree workflows and WordPress plugin symlink switching\n');
  process.stdout.write('  shell-init   Output shell wrapper (auto-cd after wt switch)\n');
}

module.exports = {
  run
};
