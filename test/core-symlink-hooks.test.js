const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const LIB = pathToFileURL(path.resolve(__dirname, '..', 'dist', 'index.js')).href;

let lib;
test.before(async () => {
  lib = await import(LIB);
});

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `linchpin-${label}-`));
}

// Hooks are committed files and now run only once this machine has approved
// their contents, so a test that wants one to fire says so first — the same
// grant `linchpin wt trust` records.
function writeTrustedHook(root, name, contents) {
  const hooksDir = path.join(root, '.linchpin', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const hookFile = path.join(hooksDir, name);
  fs.writeFileSync(hookFile, contents, 'utf8');
  lib.trustHook(hookFile);

  return hookFile;
}

// --- ensurePluginLink -------------------------------------------------------

test('ensurePluginLink creates, is idempotent, and repoints', () => {
  const root = tempDir('link');
  const sourceA = path.join(root, 'worktree-a');
  const sourceB = path.join(root, 'worktree-b');
  const target = path.join(root, 'site', 'wp-content', 'plugins', 'my-plugin');
  fs.mkdirSync(sourceA);
  fs.mkdirSync(sourceB);

  const created = lib.ensurePluginLink({ sourcePath: sourceA, targetPath: target });
  assert.equal(created.changed, true);
  assert.equal(fs.realpathSync(target), fs.realpathSync(sourceA));

  // Same source again must be a no-op, not a churny relink.
  const again = lib.ensurePluginLink({ sourcePath: sourceA, targetPath: target });
  assert.equal(again.changed, false);
  assert.match(again.action, /Already linked/);

  const repointed = lib.ensurePluginLink({ sourcePath: sourceB, targetPath: target });
  assert.equal(repointed.changed, true);
  assert.equal(fs.realpathSync(target), fs.realpathSync(sourceB));
});

test('repointing over a BROKEN symlink succeeds', () => {
  // The reason "already linked" is detected with readlinkSync rather than an
  // existence check: after an agent deletes or moves a worktree, the link is
  // dangling. existsSync follows the link and reports false, so a naive
  // implementation takes the "create" path and fails EEXIST.
  const root = tempDir('broken');
  const gone = path.join(root, 'deleted-worktree');
  const live = path.join(root, 'live-worktree');
  const target = path.join(root, 'plugins', 'slot');

  fs.mkdirSync(gone);
  fs.mkdirSync(live);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(gone, target, 'dir');
  fs.rmSync(gone, { recursive: true, force: true });

  assert.equal(fs.existsSync(target), false, 'precondition: the link is dangling');
  assert.equal(lib.readExistingTarget(target).isSymlink, true, 'lstat still sees the link');

  const result = lib.ensurePluginLink({ sourcePath: live, targetPath: target });
  assert.equal(result.changed, true);
  assert.equal(fs.realpathSync(target), fs.realpathSync(live));
});

test('a broken symlink pointing at the intended source is still "already linked"', () => {
  // The subtler half: the link is dangling but records the right target, so it
  // must be recognised rather than needlessly recreated.
  const root = tempDir('broken-same');
  const source = path.join(root, 'wt');
  const target = path.join(root, 'slot');

  fs.mkdirSync(source);
  fs.symlinkSync(source, target, 'dir');
  fs.rmSync(source, { recursive: true, force: true });
  fs.mkdirSync(source);

  const result = lib.ensurePluginLink({ sourcePath: source, targetPath: target });
  assert.equal(result.changed, false);
  assert.match(result.action, /Already linked/);
});

test('refuses to clobber a real directory without force', () => {
  const root = tempDir('clobber');
  const source = path.join(root, 'wt');
  // A real WordPress slot, because --force is only authority over one of those.
  const target = path.join(root, 'wp-content', 'plugins', 'fixture');
  fs.mkdirSync(source);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'important.txt'), 'do not lose me');

  assert.throws(
    () => lib.ensurePluginLink({ sourcePath: source, targetPath: target }),
    /exists and is not a symlink/
  );
  assert.equal(fs.existsSync(path.join(target, 'important.txt')), true, 'data was destroyed');

  const forced = lib.ensurePluginLink({ sourcePath: source, targetPath: target, force: true });
  assert.equal(forced.changed, true);
  assert.equal(fs.realpathSync(target), fs.realpathSync(source));
});

test('--force is not authority to delete a path outside a WordPress install', () => {
  const root = tempDir('outside');
  const source = path.join(root, 'wt');
  // The shape a committed .linchpin.json could otherwise point --force at.
  const target = path.join(root, 'precious');
  fs.mkdirSync(source);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'important.txt'), 'irreplaceable');

  assert.throws(
    () => lib.ensurePluginLink({ sourcePath: source, targetPath: target, force: true }),
    /not inside a WordPress content directory/
  );
  assert.equal(
    fs.readFileSync(path.join(target, 'important.txt'), 'utf8'),
    'irreplaceable',
    'data was destroyed despite the refusal'
  );
});

test('isWordPressContentTarget recognises the slots wt switch builds', () => {
  assert.equal(lib.isWordPressContentTarget('/srv/site/wp-content/plugins/acme'), true);
  assert.equal(lib.isWordPressContentTarget('/srv/site/wp-content/themes/acme'), true);
  assert.equal(lib.isWordPressContentTarget('/srv/site/wp-content'), true);
  assert.equal(lib.isWordPressContentTarget('/srv/site/public/plugins/acme'), true);

  assert.equal(lib.isWordPressContentTarget('/Users/someone'), false);
  assert.equal(lib.isWordPressContentTarget('/Users/someone/Documents'), false);
  assert.equal(lib.isWordPressContentTarget('/'), false);
});

test('dry run reports without touching the filesystem', () => {
  const root = tempDir('dry');
  const source = path.join(root, 'wt');
  const target = path.join(root, 'slot');
  fs.mkdirSync(source);

  const result = lib.ensurePluginLink({ sourcePath: source, targetPath: target, dryRun: true });
  assert.match(result.action, /Would create/);
  assert.equal(fs.existsSync(target), false, 'dry run created something');
});

test('a missing source is an error rather than a dangling link', () => {
  const root = tempDir('nosource');
  assert.throws(
    () =>
      lib.ensurePluginLink({
        sourcePath: path.join(root, 'nope'),
        targetPath: path.join(root, 'slot'),
      }),
    /Worktree path does not exist/
  );
});

// --- The three conflict resolutions (previously zero coverage) --------------

test('conflict resolution: backup renames to .bkp', () => {
  const root = tempDir('conflict-backup');
  const target = path.join(root, 'plugins', 'slot');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'keep.txt'), 'data');

  const outcome = lib.resolveTargetConflict({ targetPath: target, resolution: 'backup' });

  assert.equal(outcome.resolved, true);
  assert.equal(fs.existsSync(target), false, 'the original should have moved');
  assert.equal(fs.readFileSync(path.join(`${target}.bkp`, 'keep.txt'), 'utf8'), 'data');
});

test('conflict resolution: backup refuses when a .bkp already exists', () => {
  // Overwriting would destroy the backup taken by the previous run — which is
  // the only copy of the user's data at that point.
  const root = tempDir('conflict-backup-twice');
  const target = path.join(root, 'slot');
  fs.mkdirSync(target);
  fs.mkdirSync(`${target}.bkp`);
  fs.writeFileSync(path.join(`${target}.bkp`, 'first-backup.txt'), 'original');

  const outcome = lib.resolveTargetConflict({ targetPath: target, resolution: 'backup' });

  assert.equal(outcome.resolved, false);
  assert.match(outcome.action, /Backup path already exists/);
  assert.equal(
    fs.readFileSync(path.join(`${target}.bkp`, 'first-backup.txt'), 'utf8'),
    'original',
    'the earlier backup was overwritten'
  );
  assert.equal(fs.existsSync(target), true, 'the target should be left alone');
});

test('conflict resolution: delete removes the directory', () => {
  const root = tempDir('conflict-delete');
  const target = path.join(root, 'slot');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'gone.txt'), 'x');

  const outcome = lib.resolveTargetConflict({ targetPath: target, resolution: 'delete' });

  assert.equal(outcome.resolved, true);
  assert.equal(fs.existsSync(target), false);
});

test('conflict resolution: skip leaves everything alone', () => {
  const root = tempDir('conflict-skip');
  const target = path.join(root, 'slot');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'kept.txt'), 'x');

  const outcome = lib.resolveTargetConflict({ targetPath: target, resolution: 'skip' });

  assert.equal(outcome.resolved, false);
  assert.equal(fs.existsSync(path.join(target, 'kept.txt')), true);
});

test('conflict resolution honors dry run for the destructive branches', () => {
  const root = tempDir('conflict-dry');
  const target = path.join(root, 'slot');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'safe.txt'), 'x');

  const deleted = lib.resolveTargetConflict({
    targetPath: target,
    resolution: 'delete',
    dryRun: true,
  });
  assert.match(deleted.action, /Would delete/);
  assert.equal(fs.existsSync(path.join(target, 'safe.txt')), true, 'dry run deleted real data');

  const backed = lib.resolveTargetConflict({
    targetPath: target,
    resolution: 'backup',
    dryRun: true,
  });
  assert.match(backed.action, /Would rename/);
  assert.equal(fs.existsSync(target), true, 'dry run moved the directory');
});

// --- Hooks ------------------------------------------------------------------

test('all 12 hook points exist and are derived, not hand-listed', () => {
  const { HOOK_POINTS, HOOK_OPERATIONS, HOOK_PHASES, isHookPoint } = lib;

  assert.equal(HOOK_POINTS.length, 12);
  assert.equal(HOOK_OPERATIONS.length * HOOK_PHASES.length, HOOK_POINTS.length);

  for (const operation of ['switch', 'new', 'get', 'extract', 'mv', 'del']) {
    assert.ok(isHookPoint(`pre-${operation}`), `missing pre-${operation}`);
    assert.ok(isHookPoint(`post-${operation}`), `missing post-${operation}`);
  }

  assert.equal(isHookPoint('pre-nonsense'), false);
});

test('findHookFile resolves .linchpin/hooks/<name> and ignores directories', () => {
  const root = tempDir('hookfind');
  const hooksDir = path.join(root, '.linchpin', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(path.join(hooksDir, 'post-switch'), 'echo hi\n');
  fs.mkdirSync(path.join(hooksDir, 'pre-switch'));

  assert.equal(lib.findHookFile(root, 'post-switch'), path.join(hooksDir, 'post-switch'));
  assert.equal(lib.findHookFile(root, 'pre-switch'), null, 'a directory is not a hook');
  assert.equal(lib.findHookFile(root, 'post-new'), null);
});

test('hooks are SOURCED, not executed — no shebang or execute bit needed', () => {
  // Sourcing is what lets a hook export variables and define functions for the
  // caller. It also means most people's hooks (no shebang, not chmod +x) work.
  const root = tempDir('hooksource');
  const outFile = path.join(root, 'proof.txt');

  const hookFile = writeTrustedHook(root, 'post-switch', `echo sourced > "${outFile}"\n`);
  // Deliberately not executable and with no shebang.
  fs.chmodSync(hookFile, 0o644);

  const result = lib.runHook(root, 'post-switch');

  assert.equal(result.ran, true);
  assert.equal(fs.readFileSync(outFile, 'utf8').trim(), 'sourced');
});

test('the hook environment contract is honored', () => {
  // These names are a documented public API — someone's post-switch depends on
  // them, so renaming one is a breaking change.
  const root = tempDir('hookenv');
  const outFile = path.join(root, 'env.txt');

  writeTrustedHook(
    root,
    'post-mv',
    `printf '%s|%s|%s|%s|%s' ` +
      `"$LINCHPIN_WORKTREE" "$LINCHPIN_BRANCH" "$LINCHPIN_ENVIRONMENT" ` +
      `"$LINCHPIN_OLD_BRANCH" "$LINCHPIN_OLD_WORKTREE" > "${outFile}"\n`
  );

  const env = lib.buildHookEnvironment({
    worktree: '/wt/new',
    branch: 'feature',
    environment: 'studio',
    oldBranch: 'old-feature',
    oldWorktree: '/wt/old',
  });

  lib.runHook(root, 'post-mv', env);

  assert.equal(
    fs.readFileSync(outFile, 'utf8'),
    '/wt/new|feature|studio|old-feature|/wt/old'
  );
});

test('unset hook variables are absent rather than the string "undefined"', () => {
  // A hook testing -n "$LINCHPIN_OLD_BRANCH" must see empty, not "undefined".
  const env = lib.buildHookEnvironment({ worktree: '/wt', branch: 'main' });

  assert.deepEqual(Object.keys(env).sort(), ['LINCHPIN_BRANCH', 'LINCHPIN_WORKTREE']);
  assert.equal('LINCHPIN_OLD_BRANCH' in env, false);
});

test('post-switch runs with cwd set to the new worktree', () => {
  const root = tempDir('hookcwd');
  const worktree = path.join(root, 'the-worktree');
  const outFile = path.join(root, 'cwd.txt');
  fs.mkdirSync(worktree);

  writeTrustedHook(root, 'post-switch', `pwd > "${outFile}"\n`);

  lib.runHook(root, 'post-switch', {}, { cwd: worktree });

  assert.equal(fs.readFileSync(outFile, 'utf8').trim(), fs.realpathSync(worktree));
});

test('a missing hook is a silent no-op', () => {
  const root = tempDir('hooknone');
  const result = lib.runHook(root, 'post-switch');

  assert.equal(result.ran, false);
  assert.equal(result.hookFile, null);
});

test('a hook path containing spaces and metacharacters stays data', () => {
  // The hook path is passed as $1, never interpolated into the script string.
  const root = tempDir('hookodd');
  const outFile = path.join(root, 'ok.txt');
  const base = path.join(root, 'weird dir; touch /tmp/linchpin-hook-pwned');
  writeTrustedHook(base, 'post-get', `echo fine > "${outFile}"\n`);
  const result = lib.runHook(base, 'post-get');

  assert.equal(result.ran, true);
  assert.equal(fs.readFileSync(outFile, 'utf8').trim(), 'fine');
  assert.equal(fs.existsSync('/tmp/linchpin-hook-pwned'), false, 'the path was interpreted');
});
