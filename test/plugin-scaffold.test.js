const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { runCli } = require('../test-utils/cli-fixture');

const LIB = pathToFileURL(path.resolve(__dirname, '..', 'dist', 'index.js')).href;
const FIXTURE = path.resolve(__dirname, 'fixtures', 'plugin-scaffold');
const BANNER =
  'https://assets.linchpin.com/github/linchpin-github-repo-banner.jpg';

let lib;

test.before(async () => {
  lib = await import(LIB);
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'linchpin-scaffold-'));
}

function lastNonEmptyLine(text) {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .at(-1);
}

test('plugin scaffold help is registered', () => {
  const help = runCli(process.cwd(), ['plugin', 'scaffold', '--help']);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /Generate a Linchpin WordPress plugin/);
  assert.match(help.stdout, /--with-blocks/);
  assert.match(help.stdout, /--channel/);
});

test('invalid slug is a validation error', () => {
  const dest = tempDir();
  const result = runCli(process.cwd(), [
    'plugin',
    'scaffold',
    'Acme',
    '--path',
    dest,
    '--ref',
    FIXTURE,
  ]);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /Invalid plugin slug/);
});

test('dry-run writes nothing', () => {
  const dest = path.join(tempDir(), 'acme');
  const result = runCli(process.cwd(), [
    'plugin',
    'scaffold',
    'acme',
    '--path',
    dest,
    '--ref',
    FIXTURE,
    '--dry-run',
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.existsSync(dest), false);
  assert.match(result.stdout, /Would write acme/);
});

test('renders acme from the fixture', () => {
  const dest = path.join(tempDir(), 'acme');
  const result = runCli(process.cwd(), [
    'plugin',
    'scaffold',
    'acme',
    '--name',
    'Acme',
    '--description',
    'A test plugin.',
    '--path',
    dest,
    '--ref',
    FIXTURE,
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(dest, 'acme.php')), true);
  assert.equal(fs.existsSync(path.join(dest, 'plugin-scaffold.php')), false);

  const main = fs.readFileSync(path.join(dest, 'acme.php'), 'utf8');
  assert.match(main, /Plugin Name:\s+Acme/);
  assert.match(main, /Description:\s+A test plugin\./);
  assert.match(main, /x-release-please-start-version/);
  assert.match(main, /Text Domain:\s+acme/);
  assert.match(main, /@package Linchpin\\Acme/);
  assert.doesNotMatch(main, /plugin-scaffold/);
  assert.doesNotMatch(main, /Plugin_Scaffold/);

  const composer = JSON.parse(fs.readFileSync(path.join(dest, 'composer.json'), 'utf8'));
  assert.equal(composer.name, 'linchpin/acme');
  assert.ok(composer.scripts['php-lint']);
  assert.ok(composer.scripts.phpstan);
  assert.ok(composer.scripts['check-branch-cs']);

  const phpWorkflow = fs.readFileSync(path.join(dest, '.github/workflows/php.yml'), 'utf8');
  assert.match(phpWorkflow, /php-checks\.yml@v4/);

  const readme = fs.readFileSync(path.join(dest, 'README.md'), 'utf8');
  assert.match(readme, /^# Acme/m);
  assert.match(readme, /A test plugin\./);
  assert.match(readme, /x-release-please-start-version/);
  assert.match(readme, /Latest Release:/);
  assert.match(readme, /linchpin\/acme\/actions/);
  assert.match(readme, /GPL-2\.0-or-later/);
  assert.equal(
    lastNonEmptyLine(readme),
    `![Linchpin an award winning digital agency building immersive, high performing web experiences](${BANNER})`
  );
  assert.doesNotMatch(readme.replaceAll(BANNER, ''), /plugin-scaffold/);

  const leftovers = lib.leftoverIdentity(dest);
  assert.deepEqual(leftovers, []);
});

test('with-blocks and wporg overlays', () => {
  const dest = path.join(tempDir(), 'acme');
  const result = runCli(process.cwd(), [
    'plugin',
    'scaffold',
    'acme',
    '--path',
    dest,
    '--ref',
    FIXTURE,
    '--with-blocks',
    '--channel=wporg',
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(dest, 'includes/Controller/Blocks.php')), true);
  assert.equal(fs.existsSync(path.join(dest, 'blocks/src/example/block.json')), true);
  assert.equal(fs.existsSync(path.join(dest, 'readme.txt')), true);

  const pkg = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['build:all'], 'npm run build && npm run build --prefix blocks');

  const main = fs.readFileSync(path.join(dest, 'acme.php'), 'utf8');
  assert.doesNotMatch(main, /Update URI:/);
});

test('self-hosted adds Update URI and does not add readme.txt', () => {
  const dest = path.join(tempDir(), 'acme');
  const result = runCli(process.cwd(), [
    'plugin',
    'scaffold',
    'acme',
    '--path',
    dest,
    '--ref',
    FIXTURE,
    '--channel=self-hosted',
  ]);

  assert.equal(result.code, 0, result.stderr);
  const main = fs.readFileSync(path.join(dest, 'acme.php'), 'utf8');
  assert.match(main, /Update URI:\s+https:\/\/api\.linchpin\.com\/updates\/acme/);
  assert.equal(fs.existsSync(path.join(dest, 'readme.txt')), false);
});

test('refuses a non-empty destination without --force', () => {
  const dest = path.join(tempDir(), 'acme');
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'keep.txt'), 'nope');

  const result = runCli(process.cwd(), [
    'plugin',
    'scaffold',
    'acme',
    '--path',
    dest,
    '--ref',
    FIXTURE,
  ]);

  assert.equal(result.code, 5);
  assert.match(result.stderr, /not empty/);
  assert.equal(fs.readFileSync(path.join(dest, 'keep.txt'), 'utf8'), 'nope');
});
