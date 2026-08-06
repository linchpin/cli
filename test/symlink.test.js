const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ensurePluginLink } = require('../legacy/lib/symlink');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'linchpin-'));
}

test('ensurePluginLink creates and repoints symlink', () => {
  const root = makeTempDir();
  const sourceA = path.join(root, 'repo@a');
  const sourceB = path.join(root, 'repo@b');
  const target = path.join(root, 'wp-content', 'plugins', 'my-plugin');

  fs.mkdirSync(sourceA, { recursive: true });
  fs.mkdirSync(sourceB, { recursive: true });

  const first = ensurePluginLink({ sourcePath: sourceA, targetPath: target });
  assert.equal(first.changed, true);

  const firstReal = fs.realpathSync(target);
  assert.equal(firstReal, fs.realpathSync(sourceA));

  const second = ensurePluginLink({ sourcePath: sourceB, targetPath: target });
  assert.equal(second.changed, true);

  const secondReal = fs.realpathSync(target);
  assert.equal(secondReal, fs.realpathSync(sourceB));
});

test('ensurePluginLink replaces a broken symlink whose target was deleted', () => {
  const root = makeTempDir();
  const archived = path.join(root, 'repo@archived');
  const main = path.join(root, 'repo@main');
  const target = path.join(root, 'wp-content', 'plugins', 'my-plugin');

  fs.mkdirSync(archived, { recursive: true });
  fs.mkdirSync(main, { recursive: true });

  ensurePluginLink({ sourcePath: archived, targetPath: target });
  assert.equal(fs.realpathSync(target), fs.realpathSync(archived));

  fs.rmSync(archived, { recursive: true, force: true });
  const stat = fs.lstatSync(target);
  assert.ok(stat.isSymbolicLink(), 'symlink entry itself still exists');
  assert.ok(!fs.existsSync(target), 'symlink target is gone (broken)');

  const result = ensurePluginLink({ sourcePath: main, targetPath: target });
  assert.equal(result.changed, true);
  assert.match(result.action, /symlink/i);

  const newReal = fs.realpathSync(target);
  assert.equal(newReal, fs.realpathSync(main));
});

test('ensurePluginLink no-ops when already linked to the same source', () => {
  const root = makeTempDir();
  const source = path.join(root, 'repo@main');
  const target = path.join(root, 'wp-content', 'plugins', 'my-plugin');

  fs.mkdirSync(source, { recursive: true });

  ensurePluginLink({ sourcePath: source, targetPath: target });
  const result = ensurePluginLink({ sourcePath: source, targetPath: target });
  assert.equal(result.changed, false);
  assert.match(result.action, /already linked/i);
});
