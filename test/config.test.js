const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  normalizeConfig,
  writeConfig,
  writeDefaultConfig
} = require('../legacy/lib/config');

test('normalizeConfig accepts object environments', () => {
  const config = normalizeConfig({
    wordpress: {
      defaultEnvironment: 'studio',
      environments: {
        studio: '/tmp/studio/plugin',
        localwp: '/tmp/localwp/plugin'
      }
    }
  });

  assert.equal(config.wordpress.defaultEnvironment, 'studio');
  assert.equal(config.wordpress.environments.localwp, '/tmp/localwp/plugin');
});

test('normalizeConfig accepts array environments', () => {
  const config = normalizeConfig({
    environments: [
      { name: 'studio', path: '/tmp/studio/plugin' },
      { name: 'localwp', path: '/tmp/localwp/plugin' }
    ]
  });

  assert.equal(config.wordpress.defaultEnvironment, 'studio');
  assert.equal(config.wordpress.environments.studio, '/tmp/studio/plugin');
});

test('writeConfig stores home-based paths using ~', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linchpin-config-'));
  const home = os.homedir();
  const homeStudioPath = path.join(home, 'Local Sites', 'Example', 'app', 'public', 'wp-content', 'plugins', 'plugin');

  writeConfig(tempDir, {
    agentBasePath: path.join(home, 'Documents', 'GitHub'),
    wordpress: {
      pluginSlug: 'plugin',
      defaultEnvironment: 'studio',
      environments: {
        studio: homeStudioPath,
        ci: '/tmp/plugin'
      }
    }
  });

  const saved = JSON.parse(fs.readFileSync(path.join(tempDir, '.linchpin.json'), 'utf8'));
  assert.equal(saved.agentBasePath, '~/Documents/GitHub');
  assert.equal(saved.wordpress.environments.studio, '~/Local Sites/Example/app/public/wp-content/plugins/plugin');
  assert.equal(saved.wordpress.environments.ci, '/tmp/plugin');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('writeDefaultConfig stores localwp path with ~', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linchpin-config-default-'));
  writeDefaultConfig(tempDir, { pluginSlug: 'sample-plugin' });

  const saved = JSON.parse(fs.readFileSync(path.join(tempDir, '.linchpin.json'), 'utf8'));
  assert.match(saved.wordpress.environments.localwp, /^~\/Local Sites\//);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('normalizeConfig accepts multi-agent agents object', () => {
  const config = normalizeConfig({
    wordpress: {
      defaultEnvironment: 'studio',
      environments: { studio: '/tmp/studio/plugin' }
    },
    agents: {
      codex: '~/Documents/GitHub',
      conductor: '~/conductor'
    },
    defaultAgent: 'codex'
  });

  assert.deepEqual(Object.keys(config.agents).sort(), ['codex', 'conductor']);
  assert.equal(config.defaultAgent, 'codex');
});

test('writeConfig writes agents and defaultAgent when multiple agents', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linchpin-config-multi-'));
  const home = os.homedir();

  writeConfig(tempDir, {
    agents: {
      codex: path.join(home, 'Documents', 'GitHub'),
      conductor: path.join(home, 'conductor')
    },
    defaultAgent: 'codex',
    wordpress: {
      pluginSlug: 'plugin',
      defaultEnvironment: 'studio',
      environments: { studio: '/tmp/studio/plugin' }
    }
  });

  const saved = JSON.parse(fs.readFileSync(path.join(tempDir, '.linchpin.json'), 'utf8'));
  assert.equal(saved.agents.codex, '~/Documents/GitHub');
  assert.equal(saved.agents.conductor, '~/conductor');
  assert.equal(saved.defaultAgent, 'codex');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

