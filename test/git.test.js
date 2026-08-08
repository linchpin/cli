const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const legacy = require('../legacy/lib/git');

// The ported implementation. Both are exercised against the same cases so this
// file proves the port is behaviourally identical rather than passing because
// it still points at the old code (LINCHPIN-5369).
const LIB = pathToFileURL(path.resolve(__dirname, '..', 'dist', 'index.js')).href;

let ported;
test.before(async () => {
  ported = await import(LIB);
});

function implementations() {
  return [
    ['legacy', legacy.parseWorktreePorcelain],
    ['ported', ported.parseWorktreePorcelain],
  ];
}

test('parseWorktreePorcelain parses branches and detached entries', () => {
  const input = [
    'worktree /repo',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    'worktree /repo@feature/test',
    'HEAD 2222222222222222222222222222222222222222',
    'branch refs/heads/feature/test',
    '',
    'worktree /repo@detached',
    'HEAD 3333333333333333333333333333333333333333',
    'detached',
    '',
  ].join('\n');

  for (const [name, parseWorktreePorcelain] of implementations()) {
    const parsed = parseWorktreePorcelain(input);

    assert.equal(parsed.length, 3, name);
    assert.equal(parsed[0].worktree, '/repo', name);
    assert.equal(parsed[0].branch, 'main', name);
    assert.equal(parsed[1].branch, 'feature/test', name);
    assert.equal(parsed[2].detached, true, name);
    assert.equal(parsed[2].branch, null, name);
  }
});

test('both implementations agree on the same inputs', () => {
  const inputs = [
    '',
    'worktree /solo',
    'worktree /a\nHEAD abc\nbranch refs/heads/main',
    'worktree /a\nHEAD abc\nbranch refs/heads/main\n\n',
    // A key before any worktree record must be ignored rather than crash.
    'HEAD orphan\nworktree /a\nbranch refs/heads/x\n',
    // CRLF, as produced on Windows.
    'worktree /a\r\nHEAD abc\r\nbranch refs/heads/main\r\n\r\n',
    // Detached after a branch line: detached must win and clear the branch.
    'worktree /a\nbranch refs/heads/main\ndetached\n',
    // A path containing spaces — the key/value split is on the first space only.
    'worktree /a/my repo\nHEAD abc\nbranch refs/heads/main\n',
  ];

  for (const input of inputs) {
    assert.deepEqual(
      ported.parseWorktreePorcelain(input),
      legacy.parseWorktreePorcelain(input),
      `implementations diverged on input: ${JSON.stringify(input)}`
    );
  }
});
