const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const LIB = pathToFileURL(path.resolve(__dirname, '..', 'dist', 'index.js')).href;
const DIST_CLI = path.resolve(__dirname, '..', 'dist', 'cli.js');

let lib;
test.before(async () => {
  lib = await import(LIB);
});

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `linchpin-${label}-`));
}

// --- The split: WordPress config is optional -------------------------------

test('a config with no wordpress block is valid, not an error', () => {
  // The previous normalizeConfig threw 'Config is missing wordpress.environments',
  // so every command that read config required a WordPress environment map.
  // This is the hard prerequisite for commit/pr/task/json in Phase 4.
  const config = lib.normalizeConfig({ agents: { codex: '~/Documents/GitHub' } });

  assert.equal(config.wordpress, null);
  assert.deepEqual(Object.keys(config.agents), ['codex']);
});

test('an entirely empty config is valid', () => {
  const config = lib.normalizeConfig({});

  assert.equal(config.wordpress, null);
  assert.equal(config.agents, null);
  assert.equal(config.defaultAgent, null);
});

test('commands work in a repo with no .linchpin.json at all', () => {
  const dir = tempDir('no-config');

  for (const args of [['--help'], ['--version'], ['shell-init']]) {
    const result = spawnSync(process.execPath, [DIST_CLI, ...args], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 0, `linchpin ${args.join(' ')} failed with no config:\n${result.stderr}`);
  }
});

test('requireWordPressConfig names the remedy when environments are absent', () => {
  const config = lib.normalizeConfig({ agents: { codex: '~/x' } });

  assert.throws(() => lib.requireWordPressConfig(config), /wt config init/);

  const withWp = lib.normalizeConfig({
    wordpress: { defaultEnvironment: 'studio', environments: { studio: '/tmp/x' } },
  });
  assert.doesNotThrow(() => lib.requireWordPressConfig(withWp));
});

// --- Round-trip: the keys that used to be silently dropped -----------------

test('contentType and symlinkName round-trip through write then read', () => {
  // Both are README-documented and were built by the wizard, but writeConfig
  // hand-built its payload and emitted neither, so they never came back.
  const dir = tempDir('roundtrip');

  lib.writeConfig(dir, {
    wordpress: {
      contentType: 'theme',
      pluginSlug: 'my-theme',
      symlinkName: 'custom-name',
      defaultEnvironment: 'studio',
      environments: { studio: '/tmp/studio/my-theme' },
    },
  });

  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, '.linchpin.json'), 'utf8'));
  assert.equal(onDisk.wordpress.contentType, 'theme', 'contentType was dropped on write');
  assert.equal(onDisk.wordpress.symlinkName, 'custom-name', 'symlinkName was dropped on write');

  const read = lib.readConfig(dir);
  assert.equal(read.wordpress.contentType, 'theme', 'contentType was dropped on read');
  assert.equal(read.wordpress.symlinkName, 'custom-name', 'symlinkName was dropped on read');
});

test('writeDefaultConfig emits contentType and symlinkName for each content type', () => {
  for (const [contentType, expectedSymlink] of [
    ['plugin', 'sample'],
    ['theme', 'sample'],
    ['wp-content', 'wp-content'],
  ]) {
    const dir = tempDir(`default-${contentType}`);
    lib.writeDefaultConfig(dir, { contentType, pluginSlug: 'sample' });

    const read = lib.readConfig(dir);
    assert.equal(read.wordpress.contentType, contentType);
    assert.equal(read.wordpress.symlinkName, expectedSymlink);
  }
});

// --- Existing behaviour must survive ---------------------------------------

test('normalizeConfig accepts object environments', () => {
  const config = lib.normalizeConfig({
    wordpress: {
      defaultEnvironment: 'studio',
      environments: { studio: '/tmp/studio/plugin', localwp: '/tmp/localwp/plugin' },
    },
  });

  assert.equal(config.wordpress.defaultEnvironment, 'studio');
  assert.equal(config.wordpress.environments.localwp, '/tmp/localwp/plugin');
});

test('normalizeConfig accepts the legacy array environments form', () => {
  const config = lib.normalizeConfig({
    environments: [
      { name: 'studio', path: '/tmp/studio/plugin' },
      { name: 'localwp', path: '/tmp/localwp/plugin' },
    ],
  });

  assert.equal(config.wordpress.defaultEnvironment, 'studio');
  assert.equal(config.wordpress.environments.studio, '/tmp/studio/plugin');
});

test('multi-agent and single-agent forms convert in both directions', () => {
  const multi = lib.normalizeConfig({
    agents: { codex: '~/Documents/GitHub', conductor: '~/conductor' },
    defaultAgent: 'codex',
  });
  assert.deepEqual(Object.keys(multi.agents).sort(), ['codex', 'conductor']);
  assert.equal(multi.defaultAgent, 'codex');

  // Legacy single-agent form becomes a one-entry map...
  const single = lib.normalizeConfig({ agent: 'codex', agentBasePath: '~/Documents/GitHub' });
  assert.deepEqual(single.agents, { codex: '~/Documents/GitHub' });
  // ...and still reports the flat fields for callers that read them.
  assert.equal(single.agent, 'codex');
  assert.equal(single.agentBasePath, '~/Documents/GitHub');
});

test('writeConfig stores home-based paths using ~', () => {
  const dir = tempDir('home');
  const home = os.homedir();

  lib.writeConfig(dir, {
    agentBasePath: path.join(home, 'Documents', 'GitHub'),
    wordpress: {
      pluginSlug: 'plugin',
      defaultEnvironment: 'studio',
      environments: {
        studio: path.join(home, 'Local Sites', 'Example', 'app', 'public'),
        ci: '/tmp/plugin',
      },
    },
  });

  const saved = JSON.parse(fs.readFileSync(path.join(dir, '.linchpin.json'), 'utf8'));
  assert.equal(saved.agentBasePath, '~/Documents/GitHub');
  assert.equal(saved.wordpress.environments.studio, '~/Local Sites/Example/app/public');
  assert.equal(saved.wordpress.environments.ci, '/tmp/plugin', 'a non-home path must be untouched');
});

test('writeConfig writes agents and defaultAgent when there are several', () => {
  const dir = tempDir('multi');
  const home = os.homedir();

  lib.writeConfig(dir, {
    agents: {
      codex: path.join(home, 'Documents', 'GitHub'),
      conductor: path.join(home, 'conductor'),
    },
    defaultAgent: 'codex',
    wordpress: { defaultEnvironment: 'studio', environments: { studio: '/tmp/studio/plugin' } },
  });

  const saved = JSON.parse(fs.readFileSync(path.join(dir, '.linchpin.json'), 'utf8'));
  assert.equal(saved.agents.codex, '~/Documents/GitHub');
  assert.equal(saved.agents.conductor, '~/conductor');
  assert.equal(saved.defaultAgent, 'codex');
});

// --- defaultAgent is now actually read -------------------------------------

test('defaultAgent orders the scan roots instead of being write-only', () => {
  // It was stored and read by nothing. The agent a user nominated as default is
  // the best first guess for where a repo lives, so it goes first.
  const config = lib.normalizeConfig({
    agents: { codex: '/tmp/codex-root', conductor: '/tmp/conductor-root' },
    defaultAgent: 'conductor',
  });

  const ordered = lib.getOrderedAgentRoots(config);
  assert.equal(ordered[0], path.resolve('/tmp/conductor-root'), 'defaultAgent was not honored');
  assert.equal(ordered.length, 2);
  assert.deepEqual([...new Set(ordered)], ordered, 'roots must not repeat');

  assert.deepEqual(lib.getOrderedAgentRoots(null), []);
});

// --- Errors name the offending key -----------------------------------------

test('a malformed config names the offending key', () => {
  const dir = tempDir('malformed');

  // agents must be a map of strings; a number is a type error, not a parse error.
  fs.writeFileSync(
    path.join(dir, '.linchpin.json'),
    JSON.stringify({ agents: { codex: 42 } }),
    'utf8'
  );

  assert.throws(
    () => lib.readConfig(dir),
    (error) => {
      assert.match(error.message, /Invalid \.linchpin\.json/);
      assert.match(error.message, /agents\.codex/, 'the error must name the offending key');
      return true;
    }
  );
});

test('invalid JSON is reported as a parse failure, distinctly', () => {
  const dir = tempDir('badjson');
  fs.writeFileSync(path.join(dir, '.linchpin.json'), '{ not json', 'utf8');

  assert.throws(() => lib.readConfig(dir), /Unable to parse \.linchpin\.json/);
});

test('a defaultEnvironment naming an undeclared environment is still an error', () => {
  assert.throws(
    () =>
      lib.normalizeConfig({
        wordpress: { defaultEnvironment: 'nope', environments: { studio: '/tmp/x' } },
      }),
    /defaultEnvironment 'nope' is not defined/
  );
});

test('readConfigIfPresent returns null rather than throwing when there is no config', () => {
  const dir = tempDir('absent');
  assert.equal(lib.readConfigIfPresent(dir), null);
  assert.throws(() => lib.readConfig(dir), /Missing \.linchpin\.json/);
});
