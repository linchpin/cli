const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const LIB = pathToFileURL(path.resolve(__dirname, '..', 'dist', 'index.js')).href;

let lib;
test.before(async () => {
  lib = await import(LIB);
});

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}

/**
 * A real repo with a real linked worktree, created as the sibling
 * `${basePath}@${branch}` the CLI's convention expects.
 */
function makeRepoWithWorktree(root, repoName, branch = 'feature') {
  const repoPath = path.join(root, repoName);
  fs.mkdirSync(repoPath, { recursive: true });

  git(repoPath, ['init', '-q', '-b', 'main']);
  git(repoPath, ['config', 'user.email', 'test@example.com']);
  git(repoPath, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# test\n');
  git(repoPath, ['add', '.']);
  git(repoPath, ['commit', '-q', '-m', 'init']);

  const worktreePath = `${repoPath}@${branch}`;
  git(repoPath, ['worktree', 'add', '-q', '-b', branch, worktreePath]);

  return { repoPath, worktreePath };
}

function tempRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `linchpin-${label}-`));
}

test('parseWorktreePorcelain handles records, detached heads and trailing data', () => {
  const { parseWorktreePorcelain } = lib;

  const parsed = parseWorktreePorcelain(
    [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo@feature',
      'HEAD def456',
      'detached',
      '',
    ].join('\n')
  );

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].worktree, '/repo');
  // refs/heads/ is stripped so the branch matches what a user would type.
  assert.equal(parsed[0].branch, 'main');
  assert.equal(parsed[0].detached, false);
  assert.equal(parsed[1].detached, true);
  assert.equal(parsed[1].branch, null, 'a detached head must not report a branch');
});

test('parseWorktreePorcelain keeps a final record with no trailing blank line', () => {
  const { parseWorktreePorcelain } = lib;

  const parsed = parseWorktreePorcelain('worktree /only\nHEAD abc\nbranch refs/heads/main');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].branch, 'main');
});

test('stripWorktreeSuffix recovers the base repo name', () => {
  const { stripWorktreeSuffix } = lib;

  assert.equal(stripWorktreeSuffix('/a/b/repo@feature'), path.resolve('/a/b/repo'));
  // A directory literally named "@thing" has no repo name to recover, so the
  // index must be > 0 rather than >= 0.
  assert.equal(stripWorktreeSuffix('/a/b/@feature'), null);
  assert.equal(stripWorktreeSuffix('/a/b/plain'), null);
});

test('extractWorktreeId reads the id from a gitdir pointer, including Windows separators', () => {
  const { extractWorktreeId } = lib;

  assert.equal(extractWorktreeId('/repo/.git/worktrees/feature'), 'feature');
  assert.equal(extractWorktreeId('C:\\repo\\.git\\worktrees\\feature'), 'feature');
  assert.equal(extractWorktreeId('/repo/.git'), null);
  assert.equal(extractWorktreeId(null), null);
});

test('inferBaseRepoPath finds the base repo from a worktree sibling', () => {
  const root = tempRoot('infer');
  const { repoPath, worktreePath } = makeRepoWithWorktree(root, 'my-plugin');

  const inferred = lib.inferBaseRepoPath(worktreePath);
  assert.equal(inferred, fs.realpathSync(repoPath));
});

test('base-repo inference works when the same repo name exists under two agent roots', () => {
  // The case the heuristic exists for: two agents each hold a checkout of the
  // same project, so matching on name alone would pick the wrong one. The
  // worktree id in .git/worktrees/<id> is what disambiguates them.
  const root = tempRoot('two-agents');
  const agentA = path.join(root, 'agent-a');
  const agentB = path.join(root, 'agent-b');
  fs.mkdirSync(agentA, { recursive: true });
  fs.mkdirSync(agentB, { recursive: true });

  const a = makeRepoWithWorktree(agentA, 'shared-name', 'branch-a');
  const b = makeRepoWithWorktree(agentB, 'shared-name', 'branch-b');

  const fromA = lib.inferBaseRepoPathFromWorktreeId(a.worktreePath, {
    config: { agents: { 'claude-code': agentA, custom: agentB } },
  });
  const fromB = lib.inferBaseRepoPathFromWorktreeId(b.worktreePath, {
    config: { agents: { 'claude-code': agentA, custom: agentB } },
  });

  assert.equal(fromA, fs.realpathSync(a.repoPath), 'resolved to the wrong agent root');
  assert.equal(fromB, fs.realpathSync(b.repoPath), 'resolved to the wrong agent root');
  assert.notEqual(fromA, fromB);
});

test('a custom agent path from config is actually used during inference', () => {
  // Regression for the write-only multi-agent config: getDefaultAgentScanRoots()
  // took no arguments and returned only the three hardcoded presets, so a
  // custom path was stored in .linchpin.json and never read.
  const root = tempRoot('custom-agent');
  const customRoot = path.join(root, 'somewhere', 'unusual');
  fs.mkdirSync(customRoot, { recursive: true });

  const { repoPath, worktreePath } = makeRepoWithWorktree(customRoot, 'proj');

  // Move the worktree out of its sibling position so the name-based inference
  // cannot succeed and only the scan-root path can find it.
  const detached = path.join(root, 'detached-copy');
  fs.renameSync(worktreePath, detached);

  const withoutConfig = lib.inferBaseRepoPathFromWorktreeId(detached, { config: null });
  const withConfig = lib.inferBaseRepoPathFromWorktreeId(detached, {
    config: { agents: { custom: customRoot } },
  });

  assert.equal(withConfig, fs.realpathSync(repoPath), 'the custom agent root was not scanned');
  assert.notEqual(
    withoutConfig,
    withConfig,
    'this case must be unreachable without the config, or it proves nothing'
  );
});

test('getAgentScanRoots puts config paths ahead of presets and de-duplicates', () => {
  const { getAgentScanRoots } = lib;

  const withoutConfig = getAgentScanRoots(null);
  assert.ok(withoutConfig.length >= 3, 'the three presets should always be present');

  const withConfig = getAgentScanRoots({ agents: { custom: '/tmp/my-agent-root' } });
  assert.equal(
    withConfig[0],
    path.resolve('/tmp/my-agent-root'),
    'a declared path is a stronger signal than a preset guess and must come first'
  );

  // Declaring a path that equals a preset must not produce a duplicate scan.
  const preset = withoutConfig[0];
  const overlapping = getAgentScanRoots({ agents: { conductor: preset } });
  assert.equal(overlapping.filter((entry) => entry === preset).length, 1);
});

test('listWorktrees recovers when cwd is a worktree rather than the base repo', () => {
  const root = tempRoot('list');
  const { repoPath, worktreePath } = makeRepoWithWorktree(root, 'listrepo');

  const fromWorktree = lib.listWorktrees(worktreePath);
  assert.equal(fromWorktree.length, 2);

  // git guarantees the main worktree is listed first — getBaseWorktreePath
  // depends on that ordering.
  assert.equal(lib.getBaseWorktreePath(worktreePath), fs.realpathSync(repoPath));
});

test('resolveWorktreeRef matches by branch, path and @suffix, and refuses ambiguity', () => {
  const { resolveWorktreeRef } = lib;

  const worktrees = [
    { worktree: '/r/proj', resolvedWorktree: '/r/proj', branch: 'main', head: 'a', detached: false },
    {
      worktree: '/r/proj@feature',
      resolvedWorktree: '/r/proj@feature',
      branch: 'feature',
      head: 'b',
      detached: false,
    },
  ];

  assert.equal(resolveWorktreeRef({ ref: 'feature', worktrees, cwd: '/r' }).branch, 'feature');
  assert.equal(resolveWorktreeRef({ ref: 'proj@feature', worktrees, cwd: '/r' }).branch, 'feature');

  assert.throws(
    () => resolveWorktreeRef({ ref: 'nope', worktrees, cwd: '/r' }),
    /Unable to resolve worktree/
  );

  const ambiguous = [
    { worktree: '/a/x@dev', resolvedWorktree: '/a/x@dev', branch: 'one', head: 'a', detached: false },
    { worktree: '/b/y@dev', resolvedWorktree: '/b/y@dev', branch: 'two', head: 'b', detached: false },
  ];

  // cwd must be somewhere the ref cannot resolve to a real path, or the path
  // branch short-circuits the @suffix fallback. Resolving 'dev' against '/'
  // finds /dev on macOS and never reaches the ambiguity check.
  const isolated = tempRoot('ambiguous');
  assert.throws(
    () => resolveWorktreeRef({ ref: 'dev', worktrees: ambiguous, cwd: isolated }),
    /Ambiguous worktree reference/
  );
});

test('an existing path outranks the @suffix fallback', () => {
  const { resolveWorktreeRef } = lib;

  // Precedence is branch, then existing path, then basename/@suffix. A ref that
  // names a real directory is treated as a path even when it would also have
  // matched a suffix — and if that path is not a tracked worktree, that is an
  // error rather than a reason to keep looking.
  const root = tempRoot('precedence');
  fs.mkdirSync(path.join(root, 'dev'));

  const worktrees = [
    { worktree: '/a/x@dev', resolvedWorktree: '/a/x@dev', branch: 'one', head: 'a', detached: false },
  ];

  assert.throws(
    () => resolveWorktreeRef({ ref: 'dev', worktrees, cwd: root }),
    /exists but is not a tracked git worktree/
  );
});

test('runCommand is argv-based, so shell metacharacters are data not syntax', () => {
  const { runCommand } = lib;

  // If this ever went through a shell, the subshell would execute and the
  // output would differ. It must come back as a literal string.
  const injection = '$(touch /tmp/linchpin-pwned); echo hi';
  const result = runCommand('git', ['rev-parse', '--show-toplevel'], {
    cwd: path.resolve(__dirname, '..'),
    allowFailure: true,
  });
  assert.equal(result.ok, true);

  const echoed = runCommand('echo', [injection], { allowFailure: true });
  assert.equal(echoed.ok, true);
  assert.equal(echoed.stdout, injection, 'the argument was interpreted rather than passed through');
  assert.equal(fs.existsSync('/tmp/linchpin-pwned'), false, 'a subshell executed');
});

test('runCommand reports a missing binary instead of throwing when allowFailure is set', () => {
  const { runCommand } = lib;

  // spawnSync throws ENOENT rather than returning a non-zero exit, so this is
  // the case allowFailure exists for and the one easiest to get wrong.
  const result = runCommand('definitely-no-such-binary-xyz', [], { allowFailure: true });
  assert.equal(result.ok, false);
  assert.match(result.stderr, /ENOENT|not found/i);

  assert.throws(() => runCommand('definitely-no-such-binary-xyz', []), /ENOENT|not found/i);
});

test('core/ contains no process.chdir', () => {
  // wt.js:472 calls process.chdir() — a global side effect in library-shaped
  // code. It must not survive the port into core/.
  const coreDir = path.resolve(__dirname, '..', 'src', 'core');

  for (const entry of fs.readdirSync(coreDir)) {
    const source = fs.readFileSync(path.join(coreDir, entry), 'utf8');
    assert.doesNotMatch(source, /process\.chdir/, `${entry} calls process.chdir`);
  }
});
