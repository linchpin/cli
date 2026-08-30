const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { pathToFileURL } = require('node:url');

const LIB = pathToFileURL(path.resolve(__dirname, '..', 'dist', 'index.js')).href;

let lib;
test.before(async () => {
  lib = await import(LIB);
});

const REGISTRY_KEYS = [
  'LINCHPIN_REGISTRY',
  'npm_config_registry',
  'LINCHPIN_REGISTRY_ALLOW_INSECURE',
];

/** Run `fn` with the registry environment set to exactly `env`. */
function withRegistryEnv(env, fn) {
  const previous = Object.fromEntries(REGISTRY_KEYS.map((key) => [key, process.env[key]]));

  for (const key of REGISTRY_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;

  try {
    return fn();
  } finally {
    for (const key of REGISTRY_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

/**
 * `registryBase` is private, so it is exercised through the one caller that
 * reaches it before any network work — an unreachable host still proves which
 * URL was accepted, because a refusal throws before the fetch is attempted.
 */
function resolveRegistry(env) {
  return withRegistryEnv(env, async () => {
    try {
      await lib.fetchLatestVersion({
        packageName: '@linchpinagency/cli',
        timeoutMs: 1,
      });
      return { refused: false };
    } catch (error) {
      return { refused: /Refusing to query registry/.test(error.message), message: error.message };
    }
  });
}

test('a plaintext registry is refused', async () => {
  const result = await resolveRegistry({ LINCHPIN_REGISTRY: 'http://registry.example.com' });

  assert.equal(result.refused, true, 'http registry was accepted');
  assert.match(result.message, /LINCHPIN_REGISTRY_ALLOW_INSECURE/, 'the remedy was not named');
});

test('npm_config_registry is held to the same standard', async () => {
  // It is an environment value like any other — a .envrc or CI config sets it.
  const result = await resolveRegistry({ npm_config_registry: 'http://registry.example.com' });

  assert.equal(result.refused, true, 'http via npm_config_registry was accepted');
});

test('a plaintext registry is allowed when explicitly permitted', async () => {
  const result = await resolveRegistry({
    LINCHPIN_REGISTRY: 'http://registry.example.com',
    LINCHPIN_REGISTRY_ALLOW_INSECURE: '1',
  });

  assert.equal(result.refused, false, 'the explicit override was ignored');
});

test('a loopback registry is allowed, so a local mirror still works', async () => {
  for (const url of ['http://localhost:4873', 'http://127.0.0.1:4873']) {
    const result = await resolveRegistry({ LINCHPIN_REGISTRY: url });
    assert.equal(result.refused, false, `${url} should be allowed`);
  }
});

test('https is accepted without ceremony', async () => {
  const result = await resolveRegistry({ LINCHPIN_REGISTRY: 'https://registry.example.com' });

  assert.equal(result.refused, false);
});

test('an unusable registry value falls back to the default rather than breaking', async () => {
  // The empty string previously produced a relative URL and a confusing failure.
  for (const value of ['', 'not a url']) {
    const result = await resolveRegistry({ LINCHPIN_REGISTRY: value });
    assert.equal(result.refused, false, `${JSON.stringify(value)} should fall back, not refuse`);
  }
});

test('safeRemoteText strips control characters the registry chose', () => {
  // An ANSI escape in a version string or a status line would otherwise rewrite
  // the terminal around the update notice.
  const hostile = '1.0.0[2K\rEverything is fine';

  const cleaned = lib.safeRemoteText(hostile);

  assert.equal(cleaned.includes(''), false, 'escape survived');
  assert.equal(cleaned.includes('\r'), false, 'carriage return survived');
  assert.equal(cleaned, '1.0.0[2KEverything is fine');
});

test('safeRemoteText caps length so a notice cannot be scrolled away', () => {
  const cleaned = lib.safeRemoteText('9'.repeat(500));

  assert.equal(cleaned.length, 97, 'expected 96 characters plus an ellipsis');
  assert.ok(cleaned.endsWith('…'));
});
