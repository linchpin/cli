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

// --- The shell-startup update notice (linchpin shell-init --notify) ----------

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const LIB = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.js')).href;

let lib;
test.before(async () => {
  lib = await import(LIB);
});

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'linchpin-notice-'));
}

/**
 * A `linchpin` on PATH that records how it was called instead of doing work.
 *
 * The point of the snippet is that a shell startup does *not* start Node, so
 * the stub is how a test can tell the difference between reading the cache and
 * spawning a refresh.
 */
function stubBin(root) {
  const bin = path.join(root, 'bin');
  const marker = path.join(root, 'calls.txt');

  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'linchpin'),
    `#!/bin/sh\necho "$@" >> ${JSON.stringify(marker)}\n`,
    'utf8'
  );
  fs.chmodSync(path.join(bin, 'linchpin'), 0o755);

  return { bin, marker };
}

/** Source a snippet in an interactive bash and return what each stream saw. */
function sourceInBash(snippet, root, env = {}, { interactive = true } = {}) {
  const file = path.join(root, 'snippet.sh');
  fs.writeFileSync(file, snippet, 'utf8');

  const result = spawnSync('bash', [...(interactive ? ['-i'] : []), '-c', `source ${JSON.stringify(file)}`], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

  return {
    code: result.status ?? 0,
    stdout: result.stdout ?? '',
    // `bash -i` without a controlling terminal announces its lack of job
    // control on stderr. That is bash talking, not the snippet.
    stderr: (result.stderr ?? '')
      .split('\n')
      .filter((line) => !line.includes('no job control'))
      .join('\n')
      .trim(),
  };
}

/** The detached refresh outlives the shell, so its marker has to be waited for. */
function waitForMarker(marker, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      return fs.readFileSync(marker, 'utf8');
    } catch {
      spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 50)']);
    }
  }

  return undefined;
}

test('shell-init only emits the notice block when asked', () => {
  const plain = runCli(os.tmpdir(), ['shell-init', '--shell', 'zsh']);
  assert.equal(plain.code, 0, plain.stderr);
  assert.doesNotMatch(plain.stdout, /__linchpin_update_notice/);

  const notify = runCli(os.tmpdir(), ['shell-init', '--shell', 'zsh', '--notify']);
  assert.equal(notify.code, 0, notify.stderr);
  // The wrapper is still there: --notify adds, it does not replace.
  assert.match(notify.stdout, /linchpin\(\)/);
  assert.match(notify.stdout, /__linchpin_update_notice/);
  assert.match(notify.stdout, /update-notice\.txt/);

  const fish = runCli(os.tmpdir(), ['shell-init', '--shell', 'fish', '--notify']);
  assert.equal(fish.code, 0, fish.stderr);
  assert.match(fish.stdout, /function __linchpin_update_notice/);
  assert.match(fish.stdout, /status is-interactive/);
});

test('the baked cache path is a shell literal, apostrophes included', () => {
  const snippet = lib.posixNoticeSnippet({ cacheDir: "/Users/o'brien/.cache/linchpin" });

  // Naively interpolated, the apostrophe would end the string and the rest of
  // the line would be executed as shell.
  assert.match(snippet, /'\/Users\/o'\\''brien\/\.cache\/linchpin'/);

  const check = spawnSync('bash', ['-n', '-c', snippet], { encoding: 'utf8' });
  assert.equal(check.status, 0, `emitted snippet must parse: ${check.stderr}`);
});

test('a shell startup prints the cached notice, and starts no CLI to do it', () => {
  const root = scratch();
  const cache = path.join(root, 'cache');
  const { bin, marker } = stubBin(root);

  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(
    path.join(cache, 'update-notice.txt'),
    'Update available: 1.0.0 → 9.9.9\n  Run: linchpin update\n',
    'utf8'
  );
  // Fresh, so nothing is due for a refresh.
  fs.writeFileSync(
    path.join(cache, 'update-check.json'),
    JSON.stringify({ checkedAt: Date.now(), latest: '9.9.9', current: '1.0.0' }),
    'utf8'
  );

  const snippet = lib.posixNoticeSnippet({ cacheDir: cache });
  const env = { PATH: `${bin}:${process.env.PATH}`, LINCHPIN_CACHE_DIR: '' };

  const shown = sourceInBash(snippet, root, env);
  assert.equal(shown.code, 0);
  assert.match(shown.stderr, /Update available: 1\.0\.0 → 9\.9\.9/);
  // stdout is shell source and command substitution. A notice there gets eval'd.
  assert.equal(shown.stdout, '', 'the notice must never reach stdout');
  assert.equal(fs.existsSync(marker), false, 'a fresh cache must not start the CLI');

  // Non-interactive: a script that sources a profile is not a person to tell.
  const script = sourceInBash(snippet, root, env, { interactive: false });
  assert.equal(script.stderr, '');
  assert.equal(script.stdout, '');

  // Both opt-outs, and the "0 means not disabled" reading the notifier uses.
  for (const key of ['LINCHPIN_NO_UPDATE_NOTIFIER', 'NO_UPDATE_NOTIFIER']) {
    const off = sourceInBash(snippet, root, { ...env, [key]: '1' });
    assert.equal(off.stderr, '', `${key} must silence the notice`);

    const zero = sourceInBash(snippet, root, { ...env, [key]: '0' });
    assert.match(zero.stderr, /Update available/, `${key}=0 is not an opt-out`);
  }

  // Nothing to say once the file is gone — that is how `linchpin update` and a
  // manual `npm i -g` both take the notice down.
  fs.rmSync(path.join(cache, 'update-notice.txt'));
  const silent = sourceInBash(snippet, root, env);
  assert.equal(silent.code, 0);
  assert.equal(silent.stderr, '');
});

test('a stale cache refreshes in the background, and an uninstalled CLI is left alone', () => {
  const root = scratch();
  const cache = path.join(root, 'cache');
  const { bin, marker } = stubBin(root);

  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(
    path.join(cache, 'update-check.json'),
    JSON.stringify({ checkedAt: 1, latest: '9.9.9', current: '1.0.0' }),
    'utf8'
  );
  // Two days old: past the day the snippet trusts an answer for.
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  fs.utimesSync(path.join(cache, 'update-check.json'), old, old);

  const snippet = lib.posixNoticeSnippet({ cacheDir: cache });

  const refreshed = sourceInBash(snippet, root, {
    PATH: `${bin}:${process.env.PATH}`,
    LINCHPIN_CACHE_DIR: '',
  });
  assert.equal(refreshed.code, 0);
  assert.equal(refreshed.stdout, '', 'the refresh must not leak into stdout');
  assert.equal(refreshed.stderr, '', 'the refresh must not leak into stderr');

  const calls = waitForMarker(marker);
  assert.ok(calls, 'a stale cache must spawn a refresh');
  assert.match(calls, /version --check --quiet/);

  // With no linchpin on PATH there is nothing to advise and nothing to spawn.
  fs.rmSync(marker);
  const uninstalled = sourceInBash(snippet, root, { PATH: '/nonexistent', LINCHPIN_CACHE_DIR: '' });
  assert.equal(uninstalled.code, 0);
  assert.equal(uninstalled.stderr, '');
  assert.equal(fs.existsSync(marker), false);
});

test('LINCHPIN_CACHE_DIR at runtime beats the path baked in at generation time', () => {
  const root = scratch();
  const elsewhere = path.join(root, 'moved');
  const { bin } = stubBin(root);

  fs.mkdirSync(elsewhere, { recursive: true });
  fs.writeFileSync(path.join(elsewhere, 'update-notice.txt'), 'Update available: moved\n', 'utf8');
  fs.writeFileSync(
    path.join(elsewhere, 'update-check.json'),
    JSON.stringify({ checkedAt: Date.now(), latest: '9.9.9', current: '1.0.0' }),
    'utf8'
  );

  const snippet = lib.posixNoticeSnippet({ cacheDir: path.join(root, 'baked-in') });
  const result = sourceInBash(snippet, root, {
    PATH: `${bin}:${process.env.PATH}`,
    LINCHPIN_CACHE_DIR: elsewhere,
  });

  assert.match(result.stderr, /Update available: moved/);
});
