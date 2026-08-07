const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { pathToFileURL } = require('node:url');

const legacy = require('../legacy/lib/hooks');

const LIB = pathToFileURL(path.resolve(__dirname, '..', 'dist', 'index.js')).href;

let ported;
test.before(async () => {
  ported = await import(LIB);
});

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'linchpin-hooks-'));
}

test('findHookFile resolves hook from .linchpin/hooks', () => {
  const root = makeTempDir();
  const modernDir = path.join(root, '.linchpin', 'hooks');

  fs.mkdirSync(modernDir, { recursive: true });

  const modernHook = path.join(modernDir, 'pre-new');

  fs.writeFileSync(modernHook, 'echo modern\n', 'utf8');

  assert.equal(legacy.findHookFile(root, 'pre-new'), modernHook);
  assert.equal(ported.findHookFile(root, 'pre-new'), modernHook, 'the port diverged');
});
