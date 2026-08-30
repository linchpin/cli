const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { pathToFileURL } = require('node:url');

const legacy = require('../legacy/lib/paths');
const legacyHooks = require('../legacy/lib/hooks');

const { createFixture, runCli } = require('../test-utils/cli-fixture');

const LIB = pathToFileURL(path.resolve(__dirname, '..', 'dist', 'index.js')).href;

let ported;
test.before(async () => {
  ported = await import(LIB);
});

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'linchpin-paths-'));
}

/** Assert both implementations agree, so the port cannot drift from legacy. */
function bothResolve(root, segment) {
  const fromLegacy = legacy.resolveContained(root, segment);
  const fromPorted = ported.resolveContained(root, segment);

  assert.equal(fromPorted, fromLegacy, 'the port diverged from legacy');
  return fromLegacy;
}

test('resolveContained accepts a path inside the root', () => {
  const root = makeTempDir();

  assert.equal(bothResolve(root, 'hook'), path.join(root, 'hook'));
  assert.equal(bothResolve(root, 'nested/hook'), path.join(root, 'nested', 'hook'));
  assert.equal(bothResolve(root, '.'), path.resolve(root));
});

test('resolveContained rejects traversal out of the root', () => {
  const root = makeTempDir();

  assert.equal(bothResolve(root, '../escape'), null);
  assert.equal(bothResolve(root, '../../../../tmp/payload'), null);
  assert.equal(bothResolve(root, 'nested/../../escape'), null);
});

test('resolveContained rejects an absolute path rather than folding it in', () => {
  const root = makeTempDir();

  // path.join would have quietly produced `${root}/etc/passwd`. Rejecting is
  // the honest answer, and it is what stops an absolute argv value.
  assert.equal(bothResolve(root, '/etc/passwd'), null);
});

test('resolveContained does not match a sibling sharing the root name prefix', () => {
  const root = makeTempDir();
  const sibling = `${root}-evil`;

  // The bug a bare startsWith() check would have: `/repo-evil` is not in `/repo`.
  assert.equal(legacy.isContained(root, sibling), false);
  assert.equal(ported.isContained(root, sibling), false);
  assert.equal(legacy.isContained(root, path.join(root, 'child')), true);
  assert.equal(ported.isContained(root, path.join(root, 'child')), true);
});

test('isContainedAfterLinks refuses a symlink pointing out of the root', () => {
  const root = makeTempDir();
  const outside = makeTempDir();
  const secret = path.join(outside, 'payload');

  fs.writeFileSync(secret, 'echo pwned\n', 'utf8');

  const link = path.join(root, 'post-switch');
  fs.symlinkSync(secret, link, 'file');

  // Lexically inside — the escape only shows once the link is followed.
  assert.equal(legacy.isContained(root, link), true);
  assert.equal(legacy.isContainedAfterLinks(root, link), false);
  assert.equal(ported.isContainedAfterLinks(root, link), false);
});

test('isContainedAfterLinks allows a symlink that stays inside the root', () => {
  const root = makeTempDir();
  const real = path.join(root, 'real');

  fs.writeFileSync(real, 'echo fine\n', 'utf8');

  const link = path.join(root, 'alias');
  fs.symlinkSync(real, link, 'file');

  assert.equal(legacy.isContainedAfterLinks(root, link), true);
  assert.equal(ported.isContainedAfterLinks(root, link), true);
});

test('isContainedAfterLinks tolerates a root reached through a symlink', () => {
  // The macOS case: a temp dir is reached via /tmp but resolves to /private/tmp.
  // Resolving only one side would reject every legitimate path here.
  const root = makeTempDir();
  const child = path.join(root, 'child');

  fs.writeFileSync(child, 'contents\n', 'utf8');

  assert.equal(legacy.isContainedAfterLinks(root, child), true);
  assert.equal(ported.isContainedAfterLinks(root, child), true);
});

test('isContainedAfterLinks falls back to the lexical answer for a missing path', () => {
  const root = makeTempDir();
  const notYet = path.join(root, 'does-not-exist-yet');

  // `wt link` names a destination before creating it, so absent must not fail closed.
  assert.equal(legacy.isContainedAfterLinks(root, notYet), true);
  assert.equal(ported.isContainedAfterLinks(root, notYet), true);
  assert.equal(legacy.isContainedAfterLinks(root, path.join(root, '..', 'nope')), false);
  assert.equal(ported.isContainedAfterLinks(root, path.join(root, '..', 'nope')), false);
});

test('requireContained throws naming the boundary that was crossed', () => {
  const root = makeTempDir();

  assert.throws(
    () => legacy.requireContained(root, '../escape', 'the base worktree'),
    /resolves outside the base worktree/
  );
  assert.throws(
    () => ported.requireContained(root, '../escape', 'the base worktree'),
    /resolves outside the base worktree/
  );
  assert.equal(legacy.requireContained(root, 'ok', 'the base worktree'), path.join(root, 'ok'));
});

test('findHookFile refuses a name that escapes the hooks directory', () => {
  const root = makeTempDir();
  const hooksDir = path.join(root, '.linchpin', 'hooks');

  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(path.join(hooksDir, 'pre-new'), 'echo ok\n', 'utf8');

  // The file it would have reached before the fix.
  const outside = path.join(root, 'payload');
  fs.writeFileSync(outside, 'echo pwned\n', 'utf8');

  assert.equal(legacyHooks.findHookFile(root, 'pre-new'), path.join(hooksDir, 'pre-new'));
  assert.equal(ported.findHookFile(root, 'pre-new'), path.join(hooksDir, 'pre-new'));

  assert.equal(legacyHooks.findHookFile(root, '../../payload'), null);
  assert.equal(ported.findHookFile(root, '../../payload'), null);
});

test('findHookFile refuses a hook that is a symlink out of the hooks directory', () => {
  const root = makeTempDir();
  const outside = makeTempDir();
  const hooksDir = path.join(root, '.linchpin', 'hooks');

  fs.mkdirSync(hooksDir, { recursive: true });

  const payload = path.join(outside, 'payload');
  fs.writeFileSync(payload, 'echo pwned\n', 'utf8');

  // git tracks symlinks, so a cloned repo can ship exactly this.
  fs.symlinkSync(payload, path.join(hooksDir, 'post-switch'), 'file');

  assert.equal(legacyHooks.findHookFile(root, 'post-switch'), null);
  assert.equal(ported.findHookFile(root, 'post-switch'), null);
});

test(
  'wt invoke, copy and link refuse arguments that leave their worktree',
  { timeout: 120_000 },
  () => {
    const fixture = createFixture();

    // A real file outside the repo, of the kind `invoke` used to reach and source.
    const outside = path.join(fixture.root, 'outside-payload');
    fs.writeFileSync(outside, 'echo pwned\n', 'utf8');

    const invoke = runCli(fixture.basePath, ['wt', 'invoke', '../../outside-payload']);
    assert.notEqual(invoke.code, 0, 'wt invoke must refuse a traversing hook name');
    assert.match(`${invoke.stdout}${invoke.stderr}`, /does not exist in \.linchpin\/hooks/);
    assert.doesNotMatch(`${invoke.stdout}${invoke.stderr}`, /Ran /);

    // A legitimate hook still runs, so containment did not break the feature.
    const ok = runCli(fixture.basePath, ['wt', 'invoke', 'pre-new']);
    assert.equal(ok.code, 0, `wt invoke should still run a real hook\nSTDERR:\n${ok.stderr}`);
    assert.match(ok.stdout, /Ran /);

    const created = runCli(fixture.basePath, ['wt', 'new', 'feature/containment']);
    assert.equal(created.code, 0, `wt new failed\nSTDERR:\n${created.stderr}`);
    const worktree = created.stdout.split('\n').at(-1);

    const copy = runCli(worktree, ['wt', 'copy', '../outside-payload']);
    assert.notEqual(copy.code, 0, 'wt copy must refuse a traversing path');
    assert.match(`${copy.stdout}${copy.stderr}`, /resolves outside/);

    const link = runCli(worktree, ['wt', 'link', '../../outside-payload']);
    assert.notEqual(link.code, 0, 'wt link must refuse a traversing path');
    assert.match(`${link.stdout}${link.stderr}`, /resolves outside/);

    // Nothing was written outside the worktree by either refusal.
    assert.equal(fs.existsSync(path.join(fixture.root, 'outside-payload')), true);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'echo pwned\n');
  }
);
