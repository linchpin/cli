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

  const unknown = runCli(fixture.basePath, ['unknown']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /Unknown command 'unknown'/);
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
