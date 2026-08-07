const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const legacy = require('../legacy/lib/symlink');

// Every case runs against both implementations. Left pointing only at legacy
// these passed regardless of what the port did (LINCHPIN-5371).
const LIB = pathToFileURL(path.resolve(__dirname, '..', 'dist', 'index.js')).href;

let ported;
test.before(async () => {
  ported = await import(LIB);
});

function implementations() {
  return [
    ['legacy', legacy.ensurePluginLink],
    ['ported', ported.ensurePluginLink],
  ];
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'linchpin-'));
}

test('ensurePluginLink creates and repoints symlink', () => {
  for (const [impl, ensurePluginLink] of implementations()) {
    const root = makeTempDir();
    const sourceA = path.join(root, 'repo@a');
    const sourceB = path.join(root, 'repo@b');
    const target = path.join(root, 'wp-content', 'plugins', 'my-plugin');

    fs.mkdirSync(sourceA, { recursive: true });
    fs.mkdirSync(sourceB, { recursive: true });

    const first = ensurePluginLink({ sourcePath: sourceA, targetPath: target });
    assert.equal(first.changed, true, impl);
    assert.equal(fs.realpathSync(target), fs.realpathSync(sourceA), impl);

    const second = ensurePluginLink({ sourcePath: sourceB, targetPath: target });
    assert.equal(second.changed, true, impl);
    assert.equal(fs.realpathSync(target), fs.realpathSync(sourceB), impl);
  }
});

test('ensurePluginLink replaces a broken symlink whose target was deleted', () => {
  for (const [impl, ensurePluginLink] of implementations()) {
    const root = makeTempDir();
    const archived = path.join(root, 'repo@archived');
    const main = path.join(root, 'repo@main');
    const target = path.join(root, 'wp-content', 'plugins', 'my-plugin');

    fs.mkdirSync(archived, { recursive: true });
    fs.mkdirSync(main, { recursive: true });

    ensurePluginLink({ sourcePath: archived, targetPath: target });
    assert.equal(fs.realpathSync(target), fs.realpathSync(archived), impl);

    fs.rmSync(archived, { recursive: true, force: true });
    assert.ok(fs.lstatSync(target).isSymbolicLink(), `${impl}: symlink entry still exists`);
    assert.ok(!fs.existsSync(target), `${impl}: symlink target is gone (broken)`);

    const result = ensurePluginLink({ sourcePath: main, targetPath: target });
    assert.equal(result.changed, true, impl);
    assert.match(result.action, /symlink/i, impl);
    assert.equal(fs.realpathSync(target), fs.realpathSync(main), impl);
  }
});

test('ensurePluginLink no-ops when already linked to the same source', () => {
  for (const [impl, ensurePluginLink] of implementations()) {
    const root = makeTempDir();
    const source = path.join(root, 'repo@main');
    const target = path.join(root, 'wp-content', 'plugins', 'my-plugin');

    fs.mkdirSync(source, { recursive: true });

    ensurePluginLink({ sourcePath: source, targetPath: target });
    const result = ensurePluginLink({ sourcePath: source, targetPath: target });

    assert.equal(result.changed, false, impl);
    assert.match(result.action, /already linked/i, impl);
  }
});

test('both implementations report the same action strings', () => {
  // The action text is user-facing and matched by regex elsewhere, so a
  // reworded message is a behaviour change worth catching.
  const results = implementations().map(([, ensurePluginLink]) => {
    const root = makeTempDir();
    const source = path.join(root, 'wt');
    const target = path.join(root, 'slot');
    fs.mkdirSync(source, { recursive: true });

    const created = ensurePluginLink({ sourcePath: source, targetPath: target });
    const again = ensurePluginLink({ sourcePath: source, targetPath: target });

    // Strip absolute paths so only the message shape is compared.
    return [created, again].map((entry) => ({
      changed: entry.changed,
      shape: entry.action.replace(/\/\S+/g, '<path>'),
    }));
  });

  assert.deepEqual(results[1], results[0], 'the ported action strings diverged from legacy');
});
