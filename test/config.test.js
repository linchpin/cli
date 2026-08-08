const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const legacy = require('../legacy/lib/config');

// These are the original cases, re-pointed at the ported implementation. Left
// against legacy they passed no matter what the port did (LINCHPIN-5370).
const LIB = pathToFileURL(path.resolve(__dirname, '..', 'dist', 'index.js')).href;

let ported;
test.before(async () => {
  ported = await import(LIB);
});

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `linchpin-config-${label}-`));
}

test('normalizeConfig accepts object environments', () => {
  const config = ported.normalizeConfig({
    wordpress: {
      defaultEnvironment: 'studio',
      environments: {
        studio: '/tmp/studio/plugin',
        localwp: '/tmp/localwp/plugin',
      },
    },
  });

  assert.equal(config.wordpress.defaultEnvironment, 'studio');
  assert.equal(config.wordpress.environments.localwp, '/tmp/localwp/plugin');
});

test('normalizeConfig accepts array environments', () => {
  const config = ported.normalizeConfig({
    environments: [
      { name: 'studio', path: '/tmp/studio/plugin' },
      { name: 'localwp', path: '/tmp/localwp/plugin' },
    ],
  });

  assert.equal(config.wordpress.defaultEnvironment, 'studio');
  assert.equal(config.wordpress.environments.studio, '/tmp/studio/plugin');
});

test('writeConfig stores home-based paths using ~', () => {
  const dir = tempDir('home');
  const home = os.homedir();
  const homeStudioPath = path.join(
    home,
    'Local Sites',
    'Example',
    'app',
    'public',
    'wp-content',
    'plugins',
    'plugin'
  );

  ported.writeConfig(dir, {
    agentBasePath: path.join(home, 'Documents', 'GitHub'),
    wordpress: {
      pluginSlug: 'plugin',
      defaultEnvironment: 'studio',
      environments: { studio: homeStudioPath, ci: '/tmp/plugin' },
    },
  });

  const saved = JSON.parse(fs.readFileSync(path.join(dir, '.linchpin.json'), 'utf8'));
  assert.equal(saved.agentBasePath, '~/Documents/GitHub');
  assert.equal(
    saved.wordpress.environments.studio,
    '~/Local Sites/Example/app/public/wp-content/plugins/plugin'
  );
  assert.equal(saved.wordpress.environments.ci, '/tmp/plugin');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeDefaultConfig stores localwp path with ~', () => {
  const dir = tempDir('default');
  ported.writeDefaultConfig(dir, { pluginSlug: 'sample-plugin' });

  const saved = JSON.parse(fs.readFileSync(path.join(dir, '.linchpin.json'), 'utf8'));
  assert.match(saved.wordpress.environments.localwp, /^~\/Local Sites\//);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('normalizeConfig accepts multi-agent agents object', () => {
  const config = ported.normalizeConfig({
    wordpress: {
      defaultEnvironment: 'studio',
      environments: { studio: '/tmp/studio/plugin' },
    },
    agents: {
      codex: '~/Documents/GitHub',
      conductor: '~/conductor',
    },
    defaultAgent: 'codex',
  });

  assert.deepEqual(Object.keys(config.agents).sort(), ['codex', 'conductor']);
  assert.equal(config.defaultAgent, 'codex');
});

test('writeConfig writes agents and defaultAgent when multiple agents', () => {
  const dir = tempDir('multi');
  const home = os.homedir();

  ported.writeConfig(dir, {
    agents: {
      codex: path.join(home, 'Documents', 'GitHub'),
      conductor: path.join(home, 'conductor'),
    },
    defaultAgent: 'codex',
    wordpress: {
      pluginSlug: 'plugin',
      defaultEnvironment: 'studio',
      environments: { studio: '/tmp/studio/plugin' },
    },
  });

  const saved = JSON.parse(fs.readFileSync(path.join(dir, '.linchpin.json'), 'utf8'));
  assert.equal(saved.agents.codex, '~/Documents/GitHub');
  assert.equal(saved.agents.conductor, '~/conductor');
  assert.equal(saved.defaultAgent, 'codex');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('the one intentional divergence from legacy is a missing wordpress block', () => {
  const withoutWordPress = { agents: { codex: '~/Documents/GitHub' } };

  // Legacy refused outright, which is what made every command require a
  // WordPress environment map.
  assert.throws(
    () => legacy.normalizeConfig(withoutWordPress),
    /missing wordpress\.environments/,
    'legacy is expected to throw here — if it stops, this divergence note is stale'
  );

  // The port accepts it. Everything else in this file asserts the two still agree.
  const config = ported.normalizeConfig(withoutWordPress);
  assert.equal(config.wordpress, null);
});
