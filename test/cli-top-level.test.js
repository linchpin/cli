const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { createFixture, runCli } = require('../test-utils/cli-fixture');
const { version: packageVersion } = require('../package.json');

const DIST_ENTRY = path.resolve(__dirname, '..', 'dist', 'cli.js');

function assertOk(result, message) {
  assert.equal(result.code, 0, `${message}\nSTDERR:\n${result.stderr}`);
}

test('top-level CLI commands work', () => {
  const fixture = createFixture();

  const help = runCli(fixture.basePath, ['--help']);
  assertOk(help, 'linchpin --help should succeed');
  assert.match(help.stdout, /Usage:/);

  const version = runCli(fixture.basePath, ['--version']);
  assertOk(version, 'linchpin --version should succeed');
  assert.equal(version.stdout, packageVersion);

  // Behavior change in LINCHPIN-5367: Commander now owns dispatch, so an unknown
  // command is a usage error and exits 2 rather than 1. That matches the planned
  // vocabulary (2 = validation/user error) which LINCHPIN-5368 formalizes.
  const unknown = runCli(fixture.basePath, ['unknown']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /unknown command 'unknown'/i);
  assert.doesNotMatch(
    unknown.stderr,
    /unknown command 'unknown'[\s\S]*unknown command 'unknown'/i,
    'the error should be reported once, not by both Commander and the entry point'
  );
});

test('help groups commands by topic', () => {
  const fixture = createFixture();
  const help = runCli(fixture.basePath, ['--help']);

  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Worktrees$/m);
  assert.match(help.stdout, /^Utilities$/m);
  assert.match(help.stdout, /wt .*Manage worktree workflows/s);
});

test('both --flag=value and --flag value are accepted', () => {
  const fixture = createFixture();

  // The hand-rolled readOptionValue this replaces was indexOf-only, so the
  // equals form was silently ignored rather than rejected.
  const equalsForm = runCli(fixture.basePath, ['shell-init', '--shell=fish']);
  const spaceForm = runCli(fixture.basePath, ['shell-init', '--shell', 'fish']);

  assert.equal(equalsForm.code, 0);
  assert.equal(spaceForm.code, 0);
  assert.equal(equalsForm.stdout, spaceForm.stdout);
  assert.match(equalsForm.stdout, /^function linchpin/);
});

test('control characters in argv are rejected, not echoed back', () => {
  const fixture = createFixture();

  // An ANSI escape passed through to output could rewrite the terminal an agent
  // then reads back, so it is refused up front.
  const result = runCli(fixture.basePath, ['help', '\u001b[31mRED']);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /control character/);
  // The escape must be rendered as text, never replayed raw into the stream.
  assert.match(result.stderr, /\\x1b/);
  assert.doesNotMatch(result.stderr, /\u001b\[31m/);
});

test('an invalid flag value is a usage error, at any command depth', () => {
  const fixture = createFixture();

  const result = runCli(fixture.basePath, ['shell-init', '--shell=nonsense']);

  // exitOverride is per-command in Commander; without applying it across the
  // whole tree a subcommand calls process.exit() itself and this returns 1.
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Allowed choices are bash, zsh, fish/);
});

// npm installs the bin as a symlink, so process.argv[1] is node_modules/.bin/linchpin
// while import.meta.url is the resolved file inside the package. An entry-point guard
// that compares those as raw strings never matches and the CLI prints nothing at all.
// Spawning dist/cli.js directly cannot catch that, so go through a symlink here.
test('CLI runs when invoked through a bin symlink', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linchpin-binlink-'));
  const link = path.join(dir, 'linchpin');
  fs.symlinkSync(DIST_ENTRY, link);

  const result = spawnSync(process.execPath, [link, '--version'], { encoding: 'utf8' });

  assert.equal(result.status, 0, `STDERR:\n${result.stderr}`);
  assert.equal(
    (result.stdout || '').trimEnd(),
    packageVersion,
    'CLI produced no output through a symlink — the entry-point guard is comparing raw paths'
  );
});
