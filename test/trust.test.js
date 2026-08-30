const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { pathToFileURL } = require('node:url');

const legacy = require('../legacy/lib/trust');
const legacyHooks = require('../legacy/lib/hooks');

const { createFixture, runCli } = require('../test-utils/cli-fixture');

const LIB = pathToFileURL(path.resolve(__dirname, '..', 'dist', 'index.js')).href;

let ported;
test.before(async () => {
  ported = await import(LIB);
});

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'linchpin-trust-'));
}

/** A repo root with one hook in it, plus its own trust file. */
function makeHookRepo(contents = 'echo hello\n') {
  const root = makeTempDir();
  const hooksDir = path.join(root, '.linchpin', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const hookFile = path.join(hooksDir, 'post-switch');
  fs.writeFileSync(hookFile, contents, 'utf8');

  return { root, hookFile, store: path.join(root, 'trust.json') };
}

test('trustFilePath honours LINCHPIN_TRUST_FILE', () => {
  const previous = process.env.LINCHPIN_TRUST_FILE;
  process.env.LINCHPIN_TRUST_FILE = '/tmp/explicit-trust.json';

  try {
    assert.equal(legacy.trustFilePath(), '/tmp/explicit-trust.json');
    assert.equal(ported.trustFilePath(), '/tmp/explicit-trust.json');
  } finally {
    if (previous === undefined) delete process.env.LINCHPIN_TRUST_FILE;
    else process.env.LINCHPIN_TRUST_FILE = previous;
  }
});

test('a hook is untrusted until it is trusted, in both implementations', () => {
  const { hookFile, store } = makeHookRepo();

  assert.equal(legacy.isHookTrusted(hookFile, store), false);
  assert.equal(ported.isHookTrusted(hookFile, store), false);

  const digest = legacy.trustHook(hookFile, store);
  assert.equal(typeof digest, 'string');
  assert.equal(digest.length, 64, 'sha256 hex');

  assert.equal(legacy.isHookTrusted(hookFile, store), true);
  assert.equal(ported.isHookTrusted(hookFile, store), true, 'the port diverged');
});

test('editing a trusted hook withdraws its trust', () => {
  const { hookFile, store } = makeHookRepo();

  legacy.trustHook(hookFile, store);
  assert.equal(legacy.isHookTrusted(hookFile, store), true);

  // Trust is recorded against contents, so this is a different hook now.
  fs.writeFileSync(hookFile, 'echo something else entirely\n', 'utf8');

  assert.equal(legacy.isHookTrusted(hookFile, store), false, 'trust survived an edit');
  assert.equal(ported.isHookTrusted(hookFile, store), false, 'the port diverged');
});

test('revoking withdraws trust and reports whether there was any', () => {
  const { hookFile, store } = makeHookRepo();

  assert.equal(legacy.revokeHook(hookFile, store), false, 'nothing to revoke yet');

  legacy.trustHook(hookFile, store);
  assert.equal(legacy.revokeHook(hookFile, store), true);
  assert.equal(legacy.isHookTrusted(hookFile, store), false);
});

test('a corrupt or missing trust store denies every hook', () => {
  const { hookFile, store } = makeHookRepo();

  // Missing.
  assert.deepEqual(legacy.readTrustStore(store), { hooks: {} });
  assert.deepEqual(ported.readTrustStore(store), { hooks: {} });

  // Corrupt: must not be read as blanket approval.
  fs.writeFileSync(store, '{ this is not json', 'utf8');
  assert.deepEqual(legacy.readTrustStore(store), { hooks: {} });
  assert.equal(legacy.isHookTrusted(hookFile, store), false);
  assert.equal(ported.isHookTrusted(hookFile, store), false);

  // Wrong shape.
  fs.writeFileSync(store, '{"hooks": "everything"}', 'utf8');
  assert.deepEqual(legacy.readTrustStore(store), { hooks: {} });
  assert.deepEqual(ported.readTrustStore(store), { hooks: {} });
});

test('runHook refuses an untrusted hook and explains why', () => {
  const { root, hookFile, store } = makeHookRepo(`touch "${path.join(os.tmpdir(), 'linchpin-should-not-exist')}"\n`);

  const previous = process.env.LINCHPIN_TRUST_FILE;
  process.env.LINCHPIN_TRUST_FILE = store;

  try {
    const blocked = legacyHooks.runHook(root, 'post-switch');

    assert.equal(blocked.ran, false, 'an untrusted hook must not run');
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.hookFile, hookFile);
    assert.match(blocked.reason, /Blocked untrusted hook/);
    assert.match(blocked.reason, /linchpin wt trust post-switch/);

    // And once trusted, it runs.
    legacy.trustHook(hookFile, store);
    const ran = legacyHooks.runHook(root, 'post-switch');
    assert.equal(ran.ran, true);
    assert.equal(ran.blocked, undefined);
  } finally {
    if (previous === undefined) delete process.env.LINCHPIN_TRUST_FILE;
    else process.env.LINCHPIN_TRUST_FILE = previous;
    fs.rmSync(path.join(os.tmpdir(), 'linchpin-should-not-exist'), { force: true });
  }
});

test(
  'a hook that arrived with a clone does not run until it is trusted',
  { timeout: 120_000 },
  () => {
    // The original finding, as a regression test: committing a hook must not be
    // enough to get it executed on someone else's machine.
    const fixture = createFixture();
    const hooksDir = path.join(fixture.basePath, '.linchpin', 'hooks');
    const proof = path.join(fixture.root, 'hook-ran.txt');

    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, 'post-switch'),
      `echo ran > "${proof}"\n`,
      'utf8'
    );

    const blocked = runCli(fixture.basePath, ['wt', 'switch', '--env', 'studio']);
    assert.equal(blocked.code, 0, 'a blocked hook must not fail the command');
    assert.match(blocked.stderr, /Blocked untrusted hook/);
    assert.equal(fs.existsSync(proof), false, 'the untrusted hook executed');

    // Listing shows it as untrusted before it is granted.
    const list = runCli(fixture.basePath, ['wt', 'trust']);
    assert.equal(list.code, 0);
    assert.match(list.stdout, /UNTRUSTED\s+post-switch/);

    const granted = runCli(fixture.basePath, ['wt', 'trust', 'post-switch']);
    assert.equal(granted.code, 0, `wt trust failed\nSTDERR:\n${granted.stderr}`);
    assert.match(granted.stdout, /Trusted post-switch/);

    const allowed = runCli(fixture.basePath, ['wt', 'switch', '--env', 'studio']);
    assert.equal(allowed.code, 0);
    assert.equal(fs.existsSync(proof), true, 'a trusted hook should run');
    assert.match(allowed.stderr, /Ran hook:/);

    // Editing it withdraws trust again, without anyone having to notice.
    fs.rmSync(proof, { force: true });
    fs.writeFileSync(
      path.join(hooksDir, 'post-switch'),
      `echo tampered > "${proof}"\n`,
      'utf8'
    );

    const afterEdit = runCli(fixture.basePath, ['wt', 'switch', '--env', 'studio']);
    assert.match(afterEdit.stderr, /Blocked untrusted hook/, 'an edited hook stayed trusted');
    assert.equal(fs.existsSync(proof), false, 'the edited hook executed');

    // And trust can be withdrawn deliberately.
    runCli(fixture.basePath, ['wt', 'trust', 'post-switch']);
    const revoked = runCli(fixture.basePath, ['wt', 'trust', 'post-switch', '--revoke']);
    assert.equal(revoked.code, 0);
    assert.match(revoked.stdout, /Revoked: post-switch/);
  }
);

test(
  'wt switch --force refuses to delete without confirmation when nobody can answer',
  { timeout: 120_000 },
  () => {
    const fixture = createFixture();

    // A real directory in the WordPress slot, of the kind --force replaces.
    fs.mkdirSync(fixture.pluginPath, { recursive: true });
    fs.writeFileSync(path.join(fixture.pluginPath, 'keep.txt'), 'important\n', 'utf8');

    // runCli is not a TTY, so this is the non-interactive path.
    const refused = runCli(fixture.basePath, ['wt', 'switch', '--env', 'studio', '--force']);
    assert.notEqual(refused.code, 0, '--force must not proceed unattended');
    assert.match(`${refused.stdout}${refused.stderr}`, /without confirmation/);
    assert.equal(
      fs.readFileSync(path.join(fixture.pluginPath, 'keep.txt'), 'utf8'),
      'important\n',
      'data was destroyed despite the refusal'
    );

    // --yes is the explicit, scriptable answer.
    const approved = runCli(fixture.basePath, ['wt', 'switch', '--env', 'studio', '--force', '--yes']);
    assert.equal(approved.code, 0, `--yes should proceed\nSTDERR:\n${approved.stderr}`);
    assert.equal(fs.lstatSync(fixture.pluginPath).isSymbolicLink(), true);
  }
);
