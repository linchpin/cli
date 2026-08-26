const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const BIN_PATH = path.resolve(__dirname, '..', 'dist', 'cli.js');

// GIT_* is stripped so a caller's git environment cannot leak into a fixture
// repo. The update notifier is switched off for a different reason: a suite that
// reaches the npm registry fails offline, and its stderr notice would show up in
// tests asserting on stderr. `test/update.test.js` opts back in deliberately.
const CLEAN_ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
  ),
  LINCHPIN_NO_UPDATE_NOTIFIER: '1',
  LINCHPIN_CACHE_DIR: path.join(os.tmpdir(), 'linchpin-test-cache')
};

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'linchpin-cli-'));
}

function canonicalPath(inputPath) {
  try {
    return fs.realpathSync(inputPath);
  } catch (_error) {
    return path.resolve(inputPath);
  }
}

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: CLEAN_ENV
  }).trimEnd();
}

function runCli(cwd, args) {
  const result = spawnSync(process.execPath, [BIN_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: CLEAN_ENV
  });

  return {
    code: result.status ?? 0,
    stdout: (result.stdout || '').trimEnd(),
    stderr: (result.stderr || '').trimEnd()
  };
}

function createFixture() {
  const root = makeTempDir();
  const originPath = path.join(root, 'origin.git');
  const basePath = path.join(root, 'plugin-repo');

  runGit(root, ['init', '--bare', originPath]);
  runGit(root, ['clone', originPath, basePath]);
  runGit(basePath, ['config', 'user.name', 'Linchpin Test']);
  runGit(basePath, ['config', 'user.email', 'linchpin@example.com']);

  fs.writeFileSync(path.join(basePath, 'README.md'), '# Fixture\n', 'utf8');
  fs.writeFileSync(path.join(basePath, 'CHANGELOG.md'), 'Initial changelog.\n', 'utf8');
  runGit(basePath, ['add', 'README.md', 'CHANGELOG.md']);
  runGit(basePath, ['commit', '-m', 'feat(TEST-1): initial commit']);

  const defaultBranch = runGit(basePath, ['rev-parse', '--abbrev-ref', 'HEAD']);

  runGit(basePath, ['push', '-u', 'origin', defaultBranch]);
  runGit(basePath, ['remote', 'set-head', 'origin', defaultBranch]);

  fs.writeFileSync(path.join(basePath, 'COPY_SOURCE.txt'), 'copy source\n', 'utf8');
  fs.writeFileSync(path.join(basePath, 'LINK_SOURCE.txt'), 'link source\n', 'utf8');
  runGit(basePath, ['add', 'COPY_SOURCE.txt', 'LINK_SOURCE.txt']);
  runGit(basePath, ['commit', '-m', 'feat(TEST-1): add copy and link sources']);
  runGit(basePath, ['push']);

  runGit(basePath, ['switch', '-c', 'remote-only']);
  fs.writeFileSync(path.join(basePath, 'remote-only.txt'), 'remote branch\n', 'utf8');
  runGit(basePath, ['add', 'remote-only.txt']);
  runGit(basePath, ['commit', '-m', 'feat(TEST-1): add remote-only branch']);
  runGit(basePath, ['push', '-u', 'origin', 'remote-only']);
  runGit(basePath, ['switch', defaultBranch]);
  runGit(basePath, ['branch', '-D', 'remote-only']);

  runGit(basePath, ['switch', '-c', 'gone-branch']);
  fs.writeFileSync(path.join(basePath, 'gone.txt'), 'gone branch\n', 'utf8');
  runGit(basePath, ['add', 'gone.txt']);
  runGit(basePath, ['commit', '-m', 'feat(TEST-1): add gone branch']);
  runGit(basePath, ['push', '-u', 'origin', 'gone-branch']);
  runGit(basePath, ['switch', defaultBranch]);
  runGit(basePath, ['merge', '--no-ff', 'gone-branch', '-m', 'chore(TEST-1): merge gone branch']);
  runGit(basePath, ['push']);
  runGit(basePath, ['push', 'origin', '--delete', 'gone-branch']);

  const pluginPath = path.join(root, 'wp', 'wp-content', 'plugins', 'fixture-plugin');
  const config = {
    wordpress: {
      pluginSlug: 'fixture-plugin',
      defaultEnvironment: 'studio',
      environments: {
        studio: pluginPath
      }
    }
  };

  fs.writeFileSync(path.join(basePath, '.linchpin.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  fs.mkdirSync(path.join(basePath, '.linchpin', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(basePath, '.linchpin', 'hooks', 'pre-new'), 'echo pre-new hook\n', 'utf8');

  return {
    root,
    basePath,
    defaultBranch,
    pluginPath
  };
}

module.exports = {
  canonicalPath,
  createFixture,
  runCli
};
