const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const DIST_CLI = path.resolve(__dirname, '..', 'dist', 'cli.js');
const LIB = pathToFileURL(path.resolve(__dirname, '..', 'dist', 'index.js')).href;

let lib;
test.before(async () => {
  lib = await import(LIB);
});

/**
 * Spawn the CLI in the exact shape of a Claude Code Bash call: stdio piped so
 * nothing is a TTY, and CI deliberately UNSET. That combination is what makes a
 * CI-gated wizard classify an agent as interactive and block forever.
 */
function runDetached(args, env = {}) {
  const clean = { ...process.env, ...env };
  delete clean.CI;

  const result = spawnSync(process.execPath, [DIST_CLI, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10_000,
    env: clean,
  });

  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: result.error?.code === 'ETIMEDOUT',
  };
}

test('no command hangs when nothing is a TTY and CI is unset', () => {
  // The measured Claude Code shape. A command that blocks here blocks forever.
  for (const args of [[], ['--help'], ['--version'], ['wt', 'ls'], ['shell-init']]) {
    const result = runDetached(args);
    assert.equal(
      result.timedOut,
      false,
      `linchpin ${args.join(' ')} hung with no TTY and CI unset — this is the deadlock this contract exists to prevent`
    );
    assert.notEqual(result.code, null, `linchpin ${args.join(' ')} did not exit`);
  }
});

test('detection reports the agent shape rather than the CI shape', () => {
  const { isCI, isNonInteractive } = lib;

  // Inside this very session: CI unset, no TTY, AI_AGENT set. A CI-only check
  // would call this interactive; the TTY check is what saves it.
  assert.equal(typeof isCI(), 'boolean');
  assert.equal(
    isNonInteractive(),
    true,
    'a piped, non-TTY process must be non-interactive regardless of CI'
  );
});

test('isCI alone is not sufficient to detect a non-interactive caller', () => {
  const { isCI, isNonInteractive } = lib;

  // The precise failure mode: not CI, but still unable to answer a prompt.
  if (!isCI()) {
    assert.equal(
      isNonInteractive(),
      true,
      'CI is false here, so anything gated on CI alone would have prompted'
    );
  }
});

test('exit codes are documented in --help', () => {
  const help = runDetached(['--help']);

  assert.equal(help.code, 0);
  assert.match(help.stdout, /Exit codes:/);
  for (const [code, text] of Object.entries(lib.EXIT_CODE_DESCRIPTIONS)) {
    assert.match(help.stdout, new RegExp(`${code}\\s+${text}`), `exit code ${code} undocumented`);
  }
});

test('every exit code in the vocabulary is distinct and reachable', () => {
  const { EXIT_CODES } = lib;

  assert.deepEqual(EXIT_CODES, {
    ok: 0,
    unexpected: 1,
    validation: 2,
    precondition: 3,
    auth: 4,
    refused: 5,
  });

  // 0 and 2 are exercised end to end here; 1/3/4/5 are exercised through their
  // error classes below, since no command raises them until Phase 4.
  assert.equal(runDetached(['--version']).code, EXIT_CODES.ok);
  assert.equal(runDetached(['definitely-not-a-command']).code, EXIT_CODES.validation);
});

test('error classes carry the right exit code and a remedy', () => {
  const { MissingInputError, RefusedError, UserError, InternalError, exitCodeFor, EXIT_CODES } = lib;

  const missing = new MissingInputError(['message-file', 'branch']);
  assert.equal(missing.exitCode, EXIT_CODES.validation);
  assert.match(missing.message, /--message-file --branch/);
  assert.match(missing.remedy, /run in a terminal/);

  const refused = new RefusedError('delete the worktree', 'force');
  assert.equal(refused.exitCode, EXIT_CODES.refused);
  assert.match(refused.remedy, /--force/);

  assert.equal(exitCodeFor(new UserError('x', { exitCode: EXIT_CODES.auth })), EXIT_CODES.auth);
  assert.equal(exitCodeFor(new InternalError('boom')), EXIT_CODES.unexpected);
  // An arbitrary throw is a bug, not a user error.
  assert.equal(exitCodeFor(new Error('unlabelled')), EXIT_CODES.unexpected);
});

test('output mode precedence puts explicit flags first', () => {
  const { resolveOutputMode } = lib;

  assert.equal(resolveOutputMode({ json: true }), 'json');
  assert.equal(resolveOutputMode({ quiet: true }), 'quiet');
  // quiet wins over json when both are passed, rather than producing partial JSON.
  assert.equal(resolveOutputMode({ json: true, quiet: true }), 'quiet');
  assert.equal(resolveOutputMode({ plain: true }), 'human');
  assert.equal(resolveOutputMode({}), 'human');
});

test('LINCHPIN_OUTPUT is honored so agents set it once, not per call', () => {
  const { resolveOutputMode } = lib;
  const original = process.env.LINCHPIN_OUTPUT;

  try {
    process.env.LINCHPIN_OUTPUT = 'json';
    assert.equal(resolveOutputMode({}), 'json');
    // An explicit flag still outranks the env override.
    assert.equal(resolveOutputMode({ plain: true }), 'human');

    process.env.LINCHPIN_OUTPUT = 'quiet';
    assert.equal(resolveOutputMode({}), 'quiet');

    process.env.LINCHPIN_OUTPUT = 'nonsense';
    assert.equal(resolveOutputMode({}), 'human', 'an unknown value must not change behavior');
  } finally {
    if (original === undefined) delete process.env.LINCHPIN_OUTPUT;
    else process.env.LINCHPIN_OUTPUT = original;
  }
});

test('NO_COLOR and piping produce ANSI-free output', () => {
  const withNoColor = runDetached(['definitely-not-a-command'], { NO_COLOR: '1' });
  const piped = runDetached(['definitely-not-a-command']);

  const ansi = /\[[0-9;]*m/;
  assert.doesNotMatch(withNoColor.stderr, ansi, 'NO_COLOR output still contained ANSI codes');
  assert.doesNotMatch(piped.stderr, ansi, 'piped output still contained ANSI codes');
  assert.doesNotMatch(withNoColor.stdout, ansi);
});

test('warnings go to stderr so stdout stays parseable', () => {
  const { Output } = lib;

  const chunks = { out: [], err: [] };
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = (chunk) => (chunks.out.push(String(chunk)), true);
  process.stderr.write = (chunk) => (chunks.err.push(String(chunk)), true);

  try {
    const output = new Output('json', false);
    output.warn('something to note');
    output.result('demo', { id: 'abc' }, { changed: true });
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }

  assert.equal(chunks.err.join(''), 'something to note\n');
  // stdout must be exactly one JSON document — a warning mixed in breaks `| jq`.
  const parsed = JSON.parse(chunks.out.join(''));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.changed, true);
  assert.equal(parsed.version, lib.ENVELOPE_VERSION);
  assert.deepEqual(parsed.data, { id: 'abc' });
});

test('--json keeps stdout parseable even when the command fails', () => {
  const result = runDetached(['__nonexistent__', '--json']);

  // The moment an agent most needs structured output is the moment it fails.
  // Commander writes plain-text usage errors of its own, so it has to be
  // silenced in JSON mode or stdout stops being parseable exactly then.
  assert.equal(result.code, lib.EXIT_CODES.validation);
  assert.equal(result.stderr, '', 'stderr must stay empty in JSON mode');

  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.version, lib.ENVELOPE_VERSION);
  assert.equal(envelope.error.exitCode, lib.EXIT_CODES.validation);
  assert.match(envelope.error.message, /unknown command/i);
});

test('a destructive confirmation refuses instead of defaulting', () => {
  const { Output, confirmOrFallback, EXIT_CODES } = lib;
  const output = new Output('quiet', false);

  // Non-destructive: take the fallback and carry on.
  assert.equal(
    confirmOrFallback(output, { label: 'continue', fallbackValue: true }),
    true
  );

  // Destructive: refuse, name the bypass flag, exit 5.
  try {
    confirmOrFallback(output, {
      label: 'delete the worktree',
      fallbackValue: true,
      destructive: true,
      bypassFlag: 'force',
    });
    assert.fail('a destructive confirmation must not silently default');
  } catch (error) {
    assert.equal(error.exitCode, EXIT_CODES.refused);
    assert.match(error.remedy, /--force/);
  }
});
