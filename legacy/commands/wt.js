const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  getBaseWorktreePath,
  getCurrentTopLevel,
  listWorktrees,
  resolveWorktreeRef,
  safeRealpath
} = require('../lib/git');
const { runCommand } = require('../lib/shell');
const {
  configPathFor,
  expandHome,
  getAgentBasePath,
  readConfig,
  writeConfig,
  writeDefaultConfig
} = require('../lib/config');
const { ensurePluginLink, readExistingTarget } = require('../lib/symlink');
const { findHookFile, runHook } = require('../lib/hooks');

/** Environment types: base path getters for config init. */
const ENV_TYPE_BASES = Object.freeze({
  studio: () => path.join(expandHome('~/Studio')),
  localwp: () => path.join(expandHome('~/Local Sites')),
  'wp-env': (basePath) => basePath || ''
});

function getEnvTypeBasePath(envType, basePath) {
  if (envType === 'wp-env') {
    return ENV_TYPE_BASES['wp-env'](basePath);
  }
  const fn = ENV_TYPE_BASES[envType];
  return fn ? fn() : '';
}

/** List direct subdirectories of basePath that look like site folders (non-hidden). */
function listSitesInBase(basePath) {
  const expanded = path.resolve(expandHome(basePath));
  if (!fs.existsSync(expanded)) {
    return [];
  }
  try {
    return fs
      .readdirSync(expanded, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/** Pick one site: use fzf if available and multiple sites, else return null (caller uses select). */
function pickSiteWithFzf(sites) {
  if (sites.length === 0 || !hasCommand('fzf')) {
    return null;
  }
  const result = runCommand('fzf', ['--no-multi', '--exit-0', '--height', '10'], {
    input: sites.join('\n'),
    allowFailure: true
  });
  if (!result.ok || !result.stdout) {
    return null;
  }
  return result.stdout.trim();
}

/**
 * Pick one worktree via @inquirer/prompts select.
 * @param {Array<{ worktree: string, branch?: string | null, head: string, resolvedWorktree: string }>} worktrees
 * @returns {Promise<{ worktree: string, branch?: string | null, head: string, resolvedWorktree: string }>}
 */
async function pickWorktreeWithSelect(worktrees) {
  const { select } = await import('@inquirer/prompts');
  const choice = await select({
    message: 'Which worktree should the environment use?',
    choices: worktrees.map((item) => {
      const label = item.branch || `detached (${item.head.slice(0, 7)})`;
      return { value: item.worktree, name: `${label}  →  ${item.worktree}` };
    })
  });
  return worktrees.find((item) => item.worktree === choice);
}

function buildTargetPath(envType, site, contentDir, slug, wpEnvBase, linkName) {
  const isWpContent = contentDir === 'wp-content';
  const wpContentDir = linkName || 'wp-content';
  const contentSubdir = contentDir === 'theme' ? 'themes' : 'plugins';
  if (envType === 'studio') {
    const base = getEnvTypeBasePath('studio');
    return isWpContent
      ? path.join(base, site, wpContentDir)
      : path.join(base, site, 'wp-content', contentSubdir, slug);
  }
  if (envType === 'localwp') {
    const base = getEnvTypeBasePath('localwp');
    return isWpContent
      ? path.join(base, site, 'app', 'public', wpContentDir)
      : path.join(base, site, 'app', 'public', 'wp-content', contentSubdir, slug);
  }
  if (envType === 'wp-env' && wpEnvBase) {
    return isWpContent
      ? path.join(wpEnvBase, wpContentDir)
      : path.join(wpEnvBase, 'wp-content', contentSubdir, slug);
  }
  return '';
}

function runWt(argv, options = {}) {
  const cwd = options.cwd || process.cwd();
  const command = argv[0] || 'help';

  switch (command) {
    case 'ls':
    case 'list':
      return commandList(cwd, argv.slice(1));
    case 'current':
      return commandCurrent(cwd, argv.slice(1));
    case 'switch':
      return commandSwitch(cwd, argv.slice(1));
    case 'new':
      return commandNew(cwd, argv.slice(1));
    case 'get':
      return commandGet(cwd, argv.slice(1));
    case 'extract':
      return commandExtract(cwd);
    case 'mv':
      return commandMove(cwd, argv.slice(1));
    case 'del':
      return commandDelete(cwd, argv.slice(1));
    case 'cd':
      return commandCd(cwd, argv.slice(1));
    case 'home':
      return commandHome(cwd);
    case 'use':
      return commandUse(cwd);
    case 'gone':
      return commandGone(cwd);
    case 'copy':
      return commandCopy(cwd, argv.slice(1));
    case 'link':
      return commandLink(cwd, argv.slice(1));
    case 'invoke':
      return commandInvoke(cwd, argv.slice(1));
    case 'config':
      return commandConfig(cwd, argv.slice(1));
    case 'help':
    case '--help':
    case '-h':
      printWtHelp();
      return 0;
    default:
      throw new Error(`Unknown wt command '${command}'. Run 'linchpin wt help'.`);
  }
}

function commandList(cwd, argv) {
  const worktrees = listWorktrees(cwd);
  const current = safeRealpath(getCurrentTopLevel(cwd));
  const useJson = argv.includes('--json');

  if (useJson) {
    const payload = worktrees.map((item) => ({
      worktree: item.worktree,
      branch: item.branch,
      detached: item.detached,
      current: item.resolvedWorktree === current
    }));

    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  process.stdout.write('Worktrees\n');

  for (const item of worktrees) {
    const marker = item.resolvedWorktree === current ? '*' : ' ';
    const label = item.branch || `detached (${item.head.slice(0, 7)})`;
    process.stdout.write(`${marker} ${label.padEnd(30)} ${item.worktree}\n`);
  }

  return 0;
}

function commandCurrent(cwd, argv) {
  const basePath = getBaseWorktreePath(cwd);
  const worktrees = listWorktrees(cwd);
  const currentPath = safeRealpath(getCurrentTopLevel(cwd));
  const current = worktrees.find((item) => item.resolvedWorktree === currentPath);

  if (!current) {
    throw new Error(`Current directory is not an active git worktree: ${cwd}`);
  }

  const envOption = readOptionValue(argv, '--env');
  const output = {
    basePath,
    worktree: current.worktree,
    branch: current.branch,
    detached: current.detached
  };

  const wantsLink = argv.includes('--link') || !!envOption;
  if (wantsLink) {
    const config = readConfig(basePath);
    const envName = envOption || config.wordpress.defaultEnvironment;
    const targetPath = config.wordpress.environments[envName];

    if (!targetPath) {
      throw new Error(`Unknown environment '${envName}'.`);
    }

    output.environment = envName;
    output.linkPath = path.resolve(expandHome(targetPath));
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return 0;
}

async function commandSwitch(cwd, argv) {
  const basePath = getBaseWorktreePath(cwd);
  const worktrees = listWorktrees(cwd);

  const options = parseSwitchArgs(argv);
  const config = readConfig(basePath);
  const environmentName = options.environment || config.wordpress.defaultEnvironment;
  const targetPathRaw = config.wordpress.environments[environmentName];

  if (!targetPathRaw) {
    throw new Error(
      `Environment '${environmentName}' is not configured. Available: ${Object.keys(config.wordpress.environments).join(', ')}`
    );
  }

  let selected;
  if (options.ref != null) {
    selected = resolveWorktreeRef({ ref: options.ref, worktrees, cwd });
  } else if (process.stdin.isTTY && worktrees.length >= 1) {
    selected = await pickWorktreeWithSelect(worktrees);
  } else {
    selected = resolveWorktreeRef({
      ref: getCurrentTopLevel(cwd),
      worktrees,
      cwd
    });
  }

  const sourcePath = selected.worktree;
  const targetPath = path.resolve(expandHome(targetPathRaw));
  const switchEnv = {
    LINCHPIN_WORKTREE: sourcePath,
    LINCHPIN_BRANCH: selected.branch || 'detached',
    LINCHPIN_ENVIRONMENT: environmentName
  };

  if (!options.dryRun) {
    runHook(basePath, 'pre-switch', switchEnv);
  }

  const result = ensurePluginLink({
    sourcePath,
    targetPath,
    force: options.force,
    dryRun: options.dryRun
  });

  const info = `${result.action}\nEnvironment: ${environmentName} | Worktree: ${selected.worktree} | Branch: ${selected.branch || 'detached'}\n`;

  if (process.stdout.isTTY) {
    process.stdout.write(info);
  } else {
    process.stderr.write(info);
    if (!options.dryRun) {
      process.stdout.write(`${targetPath}\n`);
    }
  }

  if (!options.dryRun) {
    runHook(basePath, 'post-switch', switchEnv, { cwd: sourcePath });
  }

  return 0;
}

function commandNew(cwd, argv) {
  const branchName = argv[0] || `wip-${Math.floor(Math.random() * 100000)}`;

  validateBranchName(branchName);

  const basePath = getBaseWorktreePath(cwd);
  const worktreePath = branchWorktreePath(basePath, branchName);

  runHook(basePath, 'pre-new', {
    LINCHPIN_BRANCH: branchName,
    LINCHPIN_WORKTREE: worktreePath
  });

  fetchAll(basePath);

  if (pathExists(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}`);
  }

  runCommand('git', ['worktree', 'add', '--detach', worktreePath, remoteHead(basePath)], { cwd: basePath });
  runCommand('git', ['switch', '--create', branchName, '--no-track'], { cwd: worktreePath });

  runHook(basePath, 'post-new', {
    LINCHPIN_BRANCH: branchName,
    LINCHPIN_WORKTREE: worktreePath
  });

  process.stdout.write(`${worktreePath}\n`);
  return 0;
}

function commandGet(cwd, argv) {
  const branchName = argv[0];
  if (!branchName) {
    throw new Error('Usage: linchpin wt get <branch>');
  }

  const basePath = getBaseWorktreePath(cwd);
  const worktreePath = branchWorktreePath(basePath, branchName);

  runHook(basePath, 'pre-get', {
    LINCHPIN_BRANCH: branchName,
    LINCHPIN_WORKTREE: worktreePath
  });

  fetchAll(basePath);

  if (!remoteBranchExists(basePath, branchName)) {
    throw new Error(`Remote branch origin/${branchName} does not exist.`);
  }

  if (pathExists(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}`);
  }

  if (localBranchExists(basePath, branchName)) {
    runCommand('git', ['worktree', 'add', worktreePath, branchName], { cwd: basePath });
  } else {
    runCommand('git', ['worktree', 'add', '-b', branchName, '--track', worktreePath, `origin/${branchName}`], {
      cwd: basePath
    });
  }

  runHook(basePath, 'post-get', {
    LINCHPIN_BRANCH: branchName,
    LINCHPIN_WORKTREE: worktreePath
  });

  process.stdout.write(`${worktreePath}\n`);
  return 0;
}

function commandExtract(cwd) {
  const basePath = getBaseWorktreePath(cwd);
  const currentTopLevel = getCurrentTopLevel(cwd);

  if (safeRealpath(currentTopLevel) !== safeRealpath(basePath)) {
    throw new Error('Extract must be run from the base worktree.');
  }

  const branchName = runCommand('git', ['branch', '--show-current'], { cwd: basePath }).stdout;

  if (!branchName) {
    throw new Error('Not on a branch (detached HEAD).');
  }

  const worktreePath = branchWorktreePath(basePath, branchName);

  if (pathExists(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}`);
  }

  runHook(basePath, 'pre-extract', {
    LINCHPIN_BRANCH: branchName,
    LINCHPIN_WORKTREE: worktreePath
  });

  runCommand('git', ['switch', '--detach', remoteHead(basePath)], { cwd: basePath });
  runCommand('git', ['worktree', 'add', worktreePath, branchName], { cwd: basePath });

  runHook(basePath, 'post-extract', {
    LINCHPIN_BRANCH: branchName,
    LINCHPIN_WORKTREE: worktreePath
  });

  process.stdout.write(`${worktreePath}\n`);
  return 0;
}

function commandMove(cwd, argv) {
  const newName = argv[0];
  if (!newName) {
    throw new Error('Usage: linchpin wt mv <new-branch-name>');
  }

  validateBranchName(newName);

  const basePath = getBaseWorktreePath(cwd);
  assertInLinkedWorktree(cwd, basePath);

  const currentPath = getCurrentTopLevel(cwd);
  const currentBranch = runCommand('git', ['branch', '--show-current'], { cwd: currentPath }).stdout;

  if (!currentBranch) {
    throw new Error('Cannot rename while in detached HEAD state.');
  }

  const newPath = branchWorktreePath(basePath, newName);

  runHook(basePath, 'pre-mv', {
    LINCHPIN_BRANCH: newName,
    LINCHPIN_WORKTREE: newPath,
    LINCHPIN_OLD_BRANCH: currentBranch,
    LINCHPIN_OLD_WORKTREE: currentPath
  });

  if (pathExists(newPath)) {
    throw new Error(`Target worktree path already exists: ${newPath}`);
  }

  runCommand('git', ['branch', '-m', newName], { cwd: currentPath });
  runCommand('git', ['worktree', 'move', currentPath, newPath], { cwd: basePath });

  runHook(basePath, 'post-mv', {
    LINCHPIN_BRANCH: newName,
    LINCHPIN_WORKTREE: newPath,
    LINCHPIN_OLD_BRANCH: currentBranch,
    LINCHPIN_OLD_WORKTREE: currentPath
  });

  process.stdout.write(`${newPath}\n`);
  return 0;
}

function commandDelete(cwd, argv) {
  const force = argv.includes('--force') || argv.includes('-f');

  const basePath = getBaseWorktreePath(cwd);
  assertInLinkedWorktree(cwd, basePath);

  const currentPath = getCurrentTopLevel(cwd);
  const branchName = runCommand('git', ['branch', '--show-current'], { cwd: currentPath }).stdout;

  if (!branchName) {
    throw new Error('Cannot delete: current worktree is detached and has no branch.');
  }

  runHook(basePath, 'pre-del', {
    LINCHPIN_BRANCH: branchName,
    LINCHPIN_WORKTREE: currentPath
  });

  if (!force) {
    const dirty = runCommand('git', ['status', '--porcelain'], { cwd: currentPath }).stdout;

    if (dirty) {
      throw new Error('Worktree has uncommitted changes. Re-run with --force.');
    }

    if (!isMergedIntoRemoteHead(basePath, branchName)) {
      throw new Error(`Branch '${branchName}' is not merged into ${remoteHead(basePath)}. Re-run with --force.`);
    }
  }

  process.chdir(basePath);

  const removeArgs = ['worktree', 'remove'];
  if (force) {
    removeArgs.push('--force');
  }
  removeArgs.push(currentPath);

  runCommand('git', removeArgs, { cwd: basePath });

  runCommand('git', ['branch', force ? '-D' : '-d', branchName], { cwd: basePath });

  runHook(basePath, 'post-del', {
    LINCHPIN_BRANCH: branchName,
    LINCHPIN_WORKTREE: currentPath
  });

  process.stdout.write(`Deleted ${branchName} (${currentPath})\n`);
  process.stdout.write(`${basePath}\n`);
  return 0;
}

function commandCd(cwd, argv) {
  const basePath = getBaseWorktreePath(cwd);
  const worktrees = listWorktrees(cwd);

  if (argv[0]) {
    const selected = resolveWorktreeRef({ ref: argv[0], worktrees, cwd });
    process.stdout.write(`${selected.worktree}\n`);
    return 0;
  }

  if (!hasCommand('fzf')) {
    throw new Error("fzf is not installed. Provide a reference: linchpin wt cd <branch|path>");
  }

  const lines = worktrees.map((item) => {
    const label = item.branch || `detached ${item.head.slice(0, 7)}`;
    return `${label}\t${item.worktree}`;
  });

  const selected = runCommand(
    'fzf',
    ['--no-multi', '--exit-0', '-d', '\t', '--with-nth=1', '--preview', 'git -C {2} log -15 --oneline --decorate'],
    {
      input: lines.join('\n'),
      allowFailure: true
    }
  );

  if (!selected.ok || !selected.stdout) {
    return 0;
  }

  const outputPath = selected.stdout.split('\t')[1] || '';
  if (outputPath) {
    process.stdout.write(`${outputPath.trim()}\n`);
  }

  return 0;
}

function commandHome(cwd) {
  const basePath = getBaseWorktreePath(cwd);
  process.stdout.write(`${basePath}\n`);
  return 0;
}

function commandUse(cwd) {
  const basePath = getBaseWorktreePath(cwd);
  assertInLinkedWorktree(cwd, basePath);

  const commit = runCommand('git', ['rev-parse', 'HEAD'], { cwd }).stdout;
  runCommand('git', ['-C', basePath, '-c', 'advice.detachedHead=false', 'switch', '--detach', commit], { cwd: basePath });

  process.stdout.write(`Base switched to ${commit.slice(0, 12)}\n`);
  return 0;
}

function commandGone(cwd) {
  const basePath = getBaseWorktreePath(cwd);

  fetchAll(basePath);

  const goneLines = runCommand('git', ['branch', '-vv'], { cwd: basePath }).stdout;
  const goneBranches = goneLines
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes(': gone]'))
    .map((line) => line.replace(/^\*\s+/, '').split(/\s+/)[0])
    .filter(Boolean);

  if (!goneBranches.length) {
    process.stdout.write('No gone branches found\n');
    return 0;
  }

  const worktrees = listWorktrees(basePath);

  for (const branch of goneBranches) {
    const wt = worktrees.find((item) => item.branch === branch);
    if (wt) {
      process.stdout.write(`Removing worktree: ${wt.worktree}\n`);
      const removed = runCommand('git', ['worktree', 'remove', wt.worktree], {
        cwd: basePath,
        allowFailure: true
      });

      if (!removed.ok) {
        process.stderr.write(`Failed removing worktree ${wt.worktree}: ${removed.stderr}\n`);
        continue;
      }
    }

    process.stdout.write(`Deleting branch: ${branch}\n`);
    const deleted = runCommand('git', ['branch', '-d', branch], { cwd: basePath, allowFailure: true });
    if (!deleted.ok) {
      process.stderr.write(`Failed deleting branch ${branch}: ${deleted.stderr}\n`);
    }
  }

  return 0;
}

function commandCopy(cwd, argv) {
  const target = argv[0];
  if (!target) {
    throw new Error('Usage: linchpin wt copy <path>');
  }

  const basePath = getBaseWorktreePath(cwd);
  assertInLinkedWorktree(cwd, basePath);

  const currentPath = getCurrentTopLevel(cwd);
  const source = path.join(basePath, target);
  const destination = path.join(currentPath, target);

  if (!pathExists(source)) {
    throw new Error(`'${target}' does not exist in base worktree.`);
  }

  if (pathExists(destination)) {
    throw new Error(`'${target}' already exists in current worktree.`);
  }

  fs.cpSync(source, destination, { recursive: true });
  process.stdout.write(`Copied ${target}\n`);
  return 0;
}

function commandLink(cwd, argv) {
  const target = argv[0];
  if (!target) {
    throw new Error('Usage: linchpin wt link <path>');
  }

  const basePath = getBaseWorktreePath(cwd);
  assertInLinkedWorktree(cwd, basePath);

  const currentPath = getCurrentTopLevel(cwd);
  const source = path.join(basePath, target);
  const destination = path.join(currentPath, target);

  if (!pathExists(source)) {
    throw new Error(`'${target}' does not exist in base worktree.`);
  }

  const existingStat = safeLstat(destination);
  if (existingStat && !existingStat.isSymbolicLink()) {
    throw new Error(`'${target}' already exists in current worktree.`);
  }

  const parent = path.dirname(destination);
  if (!pathExists(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }

  if (existingStat) {
    fs.unlinkSync(destination);
  }

  fs.symlinkSync(source, destination, fs.lstatSync(source).isDirectory() ? 'dir' : 'file');
  process.stdout.write(`Linked ${target}\n`);
  return 0;
}

function commandInvoke(cwd, argv) {
  const hookName = argv[0];
  if (!hookName) {
    throw new Error('Usage: linchpin wt invoke <hook>');
  }

  const basePath = getBaseWorktreePath(cwd);
  const hookFile = findHookFile(basePath, hookName);

  if (!hookFile) {
    throw new Error(`Hook '${hookName}' does not exist in .linchpin/hooks.`);
  }

  runHook(basePath, hookName);
  process.stdout.write(`Ran ${hookFile}\n`);
  return 0;
}

async function runConfigInitPrompts(basePath, options = {}) {
  const { confirm, input, select } = await import('@inquirer/prompts');
  const CONFIG_FILE_NAME = '.linchpin.json';

  if (fs.existsSync(configPathFor(basePath)) && !options.force) {
    const action = await select({
      message: `${CONFIG_FILE_NAME} already exists. What do you want to do?`,
      choices: [
        { value: 'overwrite', name: 'Overwrite (replace with new config)' },
        { value: 'edit', name: 'Edit (use existing as defaults)' },
        { value: 'cancel', name: 'Cancel' }
      ]
    });

    if (action === 'cancel') {
      return 0;
    }

    if (action === 'overwrite') {
      options.force = true;
    }

    if (action === 'edit') {
      try {
        options.existingConfig = readConfig(basePath);
      } catch (err) {
        process.stderr.write(`Cannot read existing config: ${err.message}\n`);
        return 1;
      }
      options.force = true;
    }
  }

  const existing = options.existingConfig?.wordpress;
  const existingAgents = options.existingConfig?.agents;
  const existingDefaultAgent = options.existingConfig?.defaultAgent;
  const defaultSlug = existing?.pluginSlug || options.defaultPluginSlug || path.basename(basePath);

  const { checkbox } = await import('@inquirer/prompts');

  const agentChoices = [
    { value: 'conductor', name: 'Conductor (~/conductor)' },
    { value: 'claude-code', name: 'Claude Code (~/Documents)' },
    { value: 'codex', name: 'Codex (~/Documents/GitHub)' },
    {
      value: 'custom',
      name: 'Custom Path (e.g. ~/my-projects — add another base directory)'
    }
  ];

  const defaultAgentSelection =
    existingAgents && Object.keys(existingAgents).length > 0
      ? Object.keys(existingAgents)
      : options.existingConfig?.agent
        ? [options.existingConfig.agent]
        : existingDefaultAgent
          ? [existingDefaultAgent]
          : [];

  const selectedAgentValues = await checkbox({
    message:
      'Which agents do you use? (We\'ll look for worktrees in all selected paths — e.g. Codex for some work, Conductor for another.)',
    choices: agentChoices,
    default: defaultAgentSelection.length > 0 ? defaultAgentSelection.filter((a) => agentChoices.some((c) => c.value === a)) : []
  });

  if (!selectedAgentValues || selectedAgentValues.length === 0) {
    throw new Error('At least one agent path is required.');
  }

  const agents = {};
  for (const agent of selectedAgentValues) {
    if (agent === 'custom') {
      const customBase = await input({
        message: 'Base path for this custom agent (e.g. ~/my-projects)',
        default: existingAgents?.custom || ''
      });
      if (customBase && customBase.trim()) {
        agents.custom = path.resolve(expandHome(customBase.trim()));
      }
    } else {
      const resolved = getAgentBasePath(agent);
      if (resolved) agents[agent] = resolved;
    }
  }

  if (Object.keys(agents).length === 0) {
    throw new Error('At least one agent base path is required.');
  }

  let defaultAgent = existingDefaultAgent && agents[existingDefaultAgent]
    ? existingDefaultAgent
    : Object.keys(agents)[0];
  if (Object.keys(agents).length > 1) {
    defaultAgent = await select({
      message: 'Default agent (used when creating new worktrees or when path cannot be inferred)',
      choices: Object.keys(agents).map((key) => ({
        value: key,
        name: `${key}  →  ${agents[key]}`
      })),
      default: defaultAgent
    });
  }

  const singleAgent = Object.keys(agents).length === 1 ? Object.keys(agents)[0] : null;
  const agentBasePath = singleAgent ? agents[singleAgent] : null;

  // Project context: what are you working on?
  const contentType = await select({
    message: 'Are you working on a plugin, a theme, or a full wp-content project?',
    choices: [
      { value: 'plugin', name: 'Plugin' },
      { value: 'theme', name: 'Theme' },
      { value: 'wp-content', name: 'WP Content Project (entire wp-content folder is the repo)' }
    ],
    default: options.defaultContentType || existing?.contentType || 'plugin'
  });

  let slug = '';
  let symlinkName = '';
  if (contentType !== 'wp-content') {
    const pluginSlug = await input({
      message: `WordPress directory name (slug) for this ${contentType}`,
      default: defaultSlug
    });

    if (!pluginSlug || !pluginSlug.trim()) {
      throw new Error('A plugin/theme slug is required.');
    }

    slug = pluginSlug.trim();
  } else {
    const linkName = await input({
      message: 'Symlink name (the directory name that will be created in the target environment)',
      default: existing?.symlinkName || 'wp-content'
    });
    symlinkName = (linkName && linkName.trim()) ? linkName.trim() : 'wp-content';
  }
  const environments = existing ? { ...existing.environments } : {};

  const addEnvironment = async () => {
    const envType = await select({
      message: 'Environment type (this sets the base folder we’ll use next)',
      choices: [
        { value: 'studio', name: 'Studio' },
        { value: 'localwp', name: 'LocalWP' },
        { value: 'wp-env', name: 'wp-env' },
        { value: 'other', name: 'Other (enter path manually)' }
      ]
    });

    if (envType === 'other') {
      const name = await input({
        message: 'Environment name (e.g. custom)',
        default: 'custom'
      });
      const rawPath = await input({
        message: contentType === 'wp-content' ? 'Full path to wp-content directory' : 'Full path to plugin/theme directory',
        default: ''
      });
      if (name && name.trim() && rawPath && rawPath.trim()) {
        environments[name.trim()] = rawPath.trim();
      }
      return;
    }

    let targetPath = '';
    let envName = envType;

    if (envType === 'studio' || envType === 'localwp') {
      const base = getEnvTypeBasePath(envType);
      const sites = listSitesInBase(base);

      if (sites.length === 0) {
        process.stdout.write(
          `No site folders found in ${base}. Enter the path manually or create a site first.\n`
        );
        const wpDir = symlinkName || 'wp-content';
        const manualDefault = contentType === 'wp-content'
          ? (envType === 'studio'
            ? path.join(base, '<site>', wpDir)
            : path.join(base, '<site>', 'app', 'public', wpDir))
          : (envType === 'studio'
            ? path.join(base, '<site>', 'wp-content', contentType === 'theme' ? 'themes' : 'plugins', slug)
            : path.join(base, '<site>', 'app', 'public', 'wp-content', contentType === 'theme' ? 'themes' : 'plugins', slug));
        const manual = await input({
          message: `Path to ${contentType === 'wp-content' ? 'wp-content' : contentType} directory for "${envType}"`,
          default: manualDefault
        });
        if (manual && manual.trim()) {
          targetPath = manual.trim();
          envName = envType;
        }
      } else {
        let site = pickSiteWithFzf(sites);
        if (site == null) {
          site = await select({
            message: `Which site in ${base}?`,
            choices: sites.map((s) => ({ value: s, name: s }))
          });
        }
        if (site) {
          targetPath = buildTargetPath(envType, site, contentType, slug, undefined, symlinkName);
          envName = `${envType}-${site}`;
        }
      }
    } else if (envType === 'wp-env') {
      const defaultWpEnv = path.join(basePath, '.wp-env', 'volumes', 'wordpress');
      const wpEnvRoot = await input({
        message: 'Path to wp-env WordPress root (e.g. …/.wp-env/volumes/wordpress)',
        default: defaultWpEnv
      });
      if (wpEnvRoot && wpEnvRoot.trim()) {
        targetPath = buildTargetPath('wp-env', null, contentType, slug, wpEnvRoot.trim(), symlinkName);
        envName = 'wp-env';
      }
    }

    if (targetPath) {
      let finalName = envName;
      if (Object.keys(environments).includes(envName)) {
        finalName = await input({
          message: 'Environment name (already used; choose another)',
          default: `${envName}-2`
        });
      }
      if (finalName && finalName.trim()) {
        environments[finalName.trim()] = targetPath;
      }
    }
  };

  if (Object.keys(environments).length === 0) {
    await addEnvironment();
  }

  if (Object.keys(environments).length === 0) {
    throw new Error('At least one environment is required.');
  }

  const currentDefault =
    existing?.defaultEnvironment && environments[existing.defaultEnvironment]
      ? existing.defaultEnvironment
      : Object.keys(environments)[0];
  const defaultEnvironment = await select({
    message: 'Default environment to use with linchpin wt switch',
    choices: Object.entries(environments).map(([name, targetPath]) => ({
      value: name,
      name: `${name}  →  ${path.resolve(expandHome(targetPath))}`
    })),
    default: currentDefault
  });

  const config = {
    ...(Object.keys(agents).length > 1
      ? { agents, defaultAgent }
      : {
          agent: singleAgent,
          ...(agentBasePath && { agentBasePath })
        }),
    wordpress: {
      contentType,
      ...(slug && { pluginSlug: slug }),
      ...(symlinkName && symlinkName !== 'wp-content' && { symlinkName }),
      defaultEnvironment,
      environments
    }
  };

  const filePath = writeConfig(basePath, config, { force: options.force });

  process.stdout.write(`Created ${filePath}\n`);

  const createInitialLinks = await confirm({
    message:
      contentType === 'wp-content'
        ? 'Create initial symlink(s) from this repo to your local environment(s)? (Points the wp-content directory at this worktree so you can use it before running linchpin wt switch.)'
        : 'Create initial symlink(s) from this repo to your local environment(s)? (Points the plugin/theme slot at this worktree so you can use it before running linchpin wt switch.)',
    default: true
  });

  if (createInitialLinks) {
    for (const [envName, targetPathRaw] of Object.entries(environments)) {
      const targetPath = path.resolve(expandHome(targetPathRaw));

      // Check if a real (non-symlink) directory already exists at the target
      const existingTarget = readExistingTarget(targetPath);
      if (existingTarget.exists && !existingTarget.isSymlink) {
        process.stdout.write(`\n  A folder already exists at: ${targetPath}\n`);
        const conflictAction = await select({
          message: `"${envName}" target already exists. How would you like to handle it?`,
          choices: [
            { value: 'backup', name: `Rename existing folder to ${path.basename(targetPath)}.bkp` },
            { value: 'delete', name: 'Delete existing folder' },
            { value: 'skip', name: 'Skip this environment' }
          ]
        });

        if (conflictAction === 'skip') {
          process.stdout.write(`  ${envName}: Skipped\n`);
          continue;
        }

        if (conflictAction === 'delete') {
          const confirmDelete = await confirm({
            message: `Are you sure you want to permanently delete ${targetPath}?`,
            default: false
          });
          if (!confirmDelete) {
            process.stdout.write(`  ${envName}: Skipped (delete cancelled)\n`);
            continue;
          }
          fs.rmSync(targetPath, { force: true, recursive: true });
          process.stdout.write(`  ${envName}: Deleted existing folder\n`);
        }

        if (conflictAction === 'backup') {
          const backupPath = `${targetPath}.bkp`;
          if (fs.existsSync(backupPath)) {
            process.stderr.write(`  ${envName}: Backup path already exists: ${backupPath}. Skipping.\n`);
            continue;
          }
          fs.renameSync(targetPath, backupPath);
          process.stdout.write(`  ${envName}: Renamed existing folder to ${path.basename(backupPath)}\n`);
        }
      }

      try {
        const result = ensurePluginLink({
          sourcePath: basePath,
          targetPath,
          force: false,
          dryRun: false
        });
        process.stdout.write(`  ${envName}: ${result.action}\n`);
      } catch (err) {
        process.stderr.write(
          `  ${envName}: ${err.message} (run 'linchpin wt switch --env ${envName} --force' to replace.)\n`
        );
      }
    }
  }

  return 0;
}

function commandConfig(cwd, argv) {
  const sub = argv[0] || 'help';

  if (sub === 'init') {
    const basePath = getBaseWorktreePath(cwd);
    const pluginSlugOpt = readOptionValue(argv.slice(1), '--plugin-slug');
    const contentTypeOpt = readOptionValue(argv.slice(1), '--type') || readOptionValue(argv.slice(1), '--content-type');
    const force = argv.includes('--force');
    const noInteractive = argv.includes('--no-interactive');

    if (contentTypeOpt && !['plugin', 'theme', 'wp-content'].includes(contentTypeOpt)) {
      process.stderr.write(`Invalid --type "${contentTypeOpt}". Must be one of: plugin, theme, wp-content\n`);
      return 1;
    }

    const usePrompts = process.stdin.isTTY && !noInteractive;

    if (usePrompts) {
      return runConfigInitPrompts(basePath, { force, defaultPluginSlug: pluginSlugOpt, defaultContentType: contentTypeOpt });
    }

    const filePath = writeDefaultConfig(basePath, {
      force,
      pluginSlug: pluginSlugOpt,
      contentType: contentTypeOpt
    });

    process.stdout.write(`Created ${filePath}\n`);
    process.stdout.write('Update environment paths before running linchpin wt switch.\n');
    return 0;
  }

  if (sub === 'show') {
    const basePath = getBaseWorktreePath(cwd);
    const config = readConfig(basePath);
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    return 0;
  }

  printConfigHelp();
  return 0;
}

function parseSwitchArgs(argv) {
  let ref = null;
  let environment = null;
  let force = false;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--env') {
      environment = argv[index + 1];
      index += 1;
      continue;
    }

    if (token.startsWith('--env=')) {
      environment = token.slice('--env='.length);
      continue;
    }

    if (token === '--force') {
      force = true;
      continue;
    }

    if (token === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (!token.startsWith('-') && ref === null) {
      ref = token;
      continue;
    }

    throw new Error(`Unexpected argument '${token}' for 'linchpin wt switch'.`);
  }

  return {
    ref,
    environment,
    force,
    dryRun
  };
}

function readOptionValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  const nextValue = argv[index + 1];
  if (!nextValue || nextValue.startsWith('-')) {
    throw new Error(`Expected a value after ${flag}.`);
  }

  return nextValue;
}

function assertInLinkedWorktree(cwd, basePath) {
  const current = safeRealpath(getCurrentTopLevel(cwd));
  const base = safeRealpath(basePath);

  if (current === base) {
    throw new Error('This command must be run inside a linked worktree (not base).');
  }
}

function pathExists(filePath) {
  return fs.existsSync(filePath);
}

/**
 * Returns the lstat result for a path without following symlinks,
 * or null if the path does not exist at all.
 *
 * @param {string} filePath - Path to stat.
 * @returns {fs.Stats|null}
 */
function safeLstat(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (_err) {
    return null;
  }
}

function remoteHead(cwd) {
  return runCommand('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd }).stdout;
}

function fetchAll(cwd) {
  runCommand('git', ['fetch', '--all', '--prune', '--quiet'], { cwd });
}

function validateBranchName(branchName) {
  const result = runCommand('git', ['check-ref-format', '--branch', branchName], { allowFailure: true });
  if (!result.ok) {
    throw new Error(`Invalid branch name '${branchName}'.`);
  }
}

function branchWorktreePath(basePath, branchName) {
  return `${basePath}@${branchName}`;
}

function localBranchExists(cwd, branchName) {
  return runCommand('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], { allowFailure: true }).ok;
}

function remoteBranchExists(cwd, branchName) {
  return runCommand('git', ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branchName}`], {
    allowFailure: true
  }).ok;
}

function isMergedIntoRemoteHead(cwd, branchName) {
  const mergeCheck = runCommand('git', ['merge-base', '--is-ancestor', branchName, remoteHead(cwd)], {
    cwd,
    allowFailure: true
  });
  return mergeCheck.ok;
}

function hasCommand(commandName) {
  return runCommand('which', [commandName], { allowFailure: true }).ok;
}

function printWtHelp() {
  process.stdout.write(`linchpin wt\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  linchpin wt ls [--json]\n`);
  process.stdout.write(`  linchpin wt current [--link] [--env <name>]\n`);
  process.stdout.write(`  linchpin wt switch [worktree|branch] [--env <name>] [--force] [--dry-run]\n`);
  process.stdout.write(`  linchpin wt new [name]\n`);
  process.stdout.write(`  linchpin wt get <branch>\n`);
  process.stdout.write(`  linchpin wt extract\n`);
  process.stdout.write(`  linchpin wt mv <new-branch-name>\n`);
  process.stdout.write(`  linchpin wt del [-f|--force]\n`);
  process.stdout.write(`  linchpin wt cd [branch|path]\n`);
  process.stdout.write(`  linchpin wt home\n`);
  process.stdout.write(`  linchpin wt use\n`);
  process.stdout.write(`  linchpin wt gone\n`);
  process.stdout.write(`  linchpin wt copy <path>\n`);
  process.stdout.write(`  linchpin wt link <path>\n`);
  process.stdout.write(`  linchpin wt invoke <hook>\n`);
  process.stdout.write(`  linchpin wt config init [--plugin-slug <slug>] [--force] [--no-interactive]\n`);
  process.stdout.write(`  linchpin wt config show\n`);
  process.stdout.write(`\n`);
  process.stdout.write(`Tips:\n`);
  process.stdout.write(`  cd \"$(linchpin wt cd)\"               # interactive jump with fzf\n`);
  process.stdout.write(`  cd \"$(linchpin wt home)\"             # jump to base worktree\n`);
}

function printConfigHelp() {
  process.stdout.write('linchpin wt config\n\n');
  process.stdout.write('Usage:\n');
  process.stdout.write('  linchpin wt config init [--type <plugin|theme|wp-content>] [--plugin-slug <slug>] [--force] [--no-interactive]\n');
  process.stdout.write('  linchpin wt config show\n');
}

module.exports = {
  runWt
};
