const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');

const { runCli } = require('../test-utils/cli-fixture');
const { detectShell, posixWrapper, fishWrapper } = require('../legacy/commands/shell-init');

test('shell-init outputs a shell function via CLI', () => {
  const result = runCli(os.tmpdir(), ['shell-init']);

  assert.equal(result.code, 0, `Expected exit 0, got ${result.code}\nSTDERR: ${result.stderr}`);
  assert.match(result.stdout, /linchpin\(\)/);
  assert.match(result.stdout, /wt.*switch/);
  assert.match(result.stdout, /builtin cd/);
});

test('shell-init --shell fish outputs fish function via CLI', () => {
  const result = runCli(os.tmpdir(), ['shell-init', '--shell', 'fish']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /function linchpin/);
  assert.match(result.stdout, /\$argv/);
  assert.match(result.stdout, /end/);
});

test('shell-init --shell=bash outputs posix function via CLI', () => {
  const result = runCli(os.tmpdir(), ['shell-init', '--shell=bash']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /linchpin\(\)/);
  assert.match(result.stdout, /command linchpin "\$@"/);
});

test('detectShell respects --shell flag', () => {
  assert.equal(detectShell(['--shell', 'fish']), 'fish');
  assert.equal(detectShell(['--shell', 'bash']), 'bash');
  assert.equal(detectShell(['--shell', 'zsh']), 'zsh');
  assert.equal(detectShell(['--shell=fish']), 'fish');
});

test('detectShell falls back to $SHELL', () => {
  const original = process.env.SHELL;
  try {
    process.env.SHELL = '/bin/zsh';
    assert.equal(detectShell([]), 'zsh');

    process.env.SHELL = '/usr/local/bin/fish';
    assert.equal(detectShell([]), 'fish');

    process.env.SHELL = '/bin/bash';
    assert.equal(detectShell([]), 'bash');
  } finally {
    if (original === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = original;
    }
  }
});

test('posixWrapper contains the cd-after-switch guard', () => {
  const output = posixWrapper();
  assert.match(output, /command linchpin "\$@"/);
  assert.match(output, /\$__linchpin_exit/);
  assert.match(output, /builtin cd "\$PWD"/);
  assert.match(output, /"wt"/);
  assert.match(output, /"switch"/);
});

test('fishWrapper contains the cd-after-switch guard', () => {
  const output = fishWrapper();
  assert.match(output, /command linchpin \$argv/);
  assert.match(output, /\$status/);
  assert.match(output, /builtin cd "\$PWD"/);
  assert.match(output, /"wt"/);
  assert.match(output, /"switch"/);
});
