const test = require('node:test');
const assert = require('node:assert/strict');

const { parseWorktreePorcelain } = require('../legacy/lib/git');

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
    ''
  ].join('\n');

  const parsed = parseWorktreePorcelain(input);

  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].worktree, '/repo');
  assert.equal(parsed[0].branch, 'main');
  assert.equal(parsed[1].branch, 'feature/test');
  assert.equal(parsed[2].detached, true);
  assert.equal(parsed[2].branch, null);
});
