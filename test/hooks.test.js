const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { findHookFile } = require('../legacy/lib/hooks');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'linchpin-hooks-'));
}

test('findHookFile resolves hook from .linchpin/hooks', () => {
  const root = makeTempDir();
  const modernDir = path.join(root, '.linchpin', 'hooks');

  fs.mkdirSync(modernDir, { recursive: true });

  const modernHook = path.join(modernDir, 'pre-new');

  fs.writeFileSync(modernHook, 'echo modern\n', 'utf8');

  assert.equal(findHookFile(root, 'pre-new'), modernHook);
});
