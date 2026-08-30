const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const DIST_CLI = path.join(ROOT, 'dist', 'cli.js');
const LIB = pathToFileURL(path.join(ROOT, 'dist', 'index.js')).href;
const { version: packageVersion, name: packageName } = require('../package.json');

let lib;
test.before(async () => {
  lib = await import(LIB);
});

/**
 * A registry that answers only the dist-tags endpoint.
 *
 * Every test here goes through this rather than npmjs.org: a suite that reaches
 * the real registry fails on a plane, and it would also make "is an update
 * available" depend on whatever happens to be published that day.
 */
function startRegistry(latest) {
  const requests = [];

  const server = http.createServer((request, response) => {
    requests.push(request.url);

    if (!request.url.endsWith('/dist-tags')) {
      response.writeHead(404).end('{}');
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ latest }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * A copy of the built CLI at a path that looks like a global npm install.
 *
 * Install detection reads the path the process is running from, and
 * `realpathSync` defeats a symlink, so the files have to actually be there.
 */
function fakeGlobalInstall() {
  const root = tempDir('linchpin-global-');
  const packageRoot = path.join(root, 'lib', 'node_modules', packageName);

  fs.mkdirSync(packageRoot, { recursive: true });
  fs.cpSync(path.join(ROOT, 'dist'), path.join(packageRoot, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(packageRoot, 'package.json'));

  return { root, cli: path.join(packageRoot, 'dist', 'cli.js') };
}

/**
 * Run the CLI with CI and AI_AGENT unset unless a case sets them itself.
 *
 * Both suppress the update notice, so a notifier test that inherits either one
 * passes for the wrong reason — and the caller's env is applied *after* the
 * scrub, or a case that sets AI_AGENT deliberately would have it removed again.
 *
 * Asynchronous on purpose: `spawnSync` blocks this process's event loop, so the
 * registry stub living here could never answer the child's request and every
 * check would fail on a three-second timeout.
 */
function run(cli, args, env = {}) {
  const base = { ...process.env };
  delete base.CI;
  delete base.AI_AGENT;
  delete base.GITHUB_ACTIONS;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...base, ...env },
      timeout: 20_000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('versions compare by precedence, prereleases included', () => {
  const { compareVersions } = lib;

  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('2.0.0', '10.0.0'), -1, 'numeric, not lexical');
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0, 'a leading v is noise');

  // A release outranks its own prereleases; prerelease identifiers compare
  // numerically when they are numbers and lexically when they are not.
  assert.equal(compareVersions('1.2.0', '1.2.0-rc.1'), 1);
  assert.equal(compareVersions('1.2.0-rc.2', '1.2.0-rc.10'), -1);
  assert.equal(compareVersions('1.2.0-alpha', '1.2.0-beta'), -1);
});

test('an unparseable version never reads as newer', () => {
  const { compareVersions, isUpdateAvailable } = lib;

  // Otherwise a registry answering with something unexpected nags on every
  // invocation, with no version that could ever satisfy it.
  assert.equal(compareVersions('1.2.3', 'nightly'), 0);
  assert.equal(isUpdateAvailable('1.2.3', 'nightly'), false);
  assert.equal(isUpdateAvailable('1.2.3', undefined), false);
  assert.equal(isUpdateAvailable('1.2.3', '1.3.0'), true);
});

test('the install method is read from the path, and drives the update command', () => {
  const { detectInstallation } = lib;

  const cases = [
    ['/usr/local/lib/node_modules/@x/cli/dist/cli.js', 'npm', 'global', 'npm install -g @x/cli@latest'],
    ['/Users/x/project/node_modules/@x/cli/dist/cli.js', 'npm', 'local', 'npm install @x/cli@latest'],
    ['/Users/x/Library/pnpm/global/5/node_modules/@x/cli/dist/cli.js', 'pnpm', 'global', 'pnpm add -g @x/cli@latest'],
    ['/Users/x/.bun/install/global/node_modules/@x/cli/dist/cli.js', 'bun', 'global', 'bun add -g @x/cli@latest'],
    ['/Users/x/.config/yarn/global/node_modules/@x/cli/dist/cli.js', 'yarn', 'global', 'yarn global add @x/cli@latest'],
  ];

  for (const [modulePath, manager, scope, command] of cases) {
    const installation = detectInstallation('@x/cli', modulePath);
    assert.equal(installation.manager, manager, modulePath);
    assert.equal(installation.scope, scope, modulePath);
    assert.equal(lib.formatCommand(installation.command), command, modulePath);
  }

  // Neither of these can be upgraded by a package manager, and both must say so
  // rather than hand back an `npm install -g` that would install a second copy.
  const npx = detectInstallation('@x/cli', '/Users/x/.npm/_npx/abc123/node_modules/@x/cli/dist/cli.js');
  assert.equal(npx.scope, 'npx');
  assert.equal(npx.command, undefined);

  const source = detectInstallation('@x/cli', '/Users/x/GitHub/cli/dist/cli.js');
  assert.equal(source.scope, 'source');
  assert.equal(source.command, undefined);
  assert.match(source.hint, /git pull/);
});

test('a corrupt or missing cache means "ask again", not a thrown error', () => {
  const { readUpdateCache, writeUpdateCache, isCacheFresh } = lib;
  const dir = tempDir('linchpin-cache-');
  const file = path.join(dir, 'update-check.json');

  assert.equal(readUpdateCache(file), undefined, 'missing file');

  fs.writeFileSync(file, '{not json', 'utf8');
  assert.equal(readUpdateCache(file), undefined, 'corrupt file');

  fs.writeFileSync(file, JSON.stringify({ latest: 5 }), 'utf8');
  assert.equal(readUpdateCache(file), undefined, 'wrong shape');

  const now = Date.now();
  assert.equal(writeUpdateCache({ checkedAt: now, latest: '9.9.9', current: '1.0.0' }, file), true);
  assert.equal(readUpdateCache(file).latest, '9.9.9');

  assert.equal(isCacheFresh(readUpdateCache(file)), true);
  assert.equal(isCacheFresh({ checkedAt: now - 48 * 3600 * 1000, latest: '9.9.9' }), false);
  // A timestamp in the future is a clock change, not a fresh answer.
  assert.equal(isCacheFresh({ checkedAt: now + 3600 * 1000, latest: '9.9.9' }), false);
});

test('the registry is asked for one dist-tag, not the whole packument', async (t) => {
  const registry = await startRegistry('4.5.6');
  t.after(() => registry.close());

  const latest = await lib.fetchLatestVersion({ packageName: '@x/cli', registry: registry.url });

  assert.equal(latest, '4.5.6');
  assert.deepEqual(registry.requests, ['/-/package/%40x%2Fcli/dist-tags']);
});

test('an unreachable registry is reported, never thrown at the caller', async (t) => {
  const registry = await startRegistry('4.5.6');
  const url = registry.url;
  await registry.close();

  const status = await lib.resolveUpdateStatus({
    packageName: '@x/cli',
    current: '1.0.0',
    refresh: true,
    registry: url,
    timeoutMs: 1_000,
    cachePath: path.join(tempDir('linchpin-cache-'), 'update-check.json'),
  });

  assert.equal(status.latest, undefined);
  assert.equal(status.updateAvailable, false);
  assert.equal(status.source, 'none');
  assert.match(status.error, /fetch failed|ECONNREFUSED|terminated/i);
});

test('version --check reports the newer release and caches the answer', async (t) => {
  const registry = await startRegistry('99.0.0');
  t.after(() => registry.close());
  const cacheDir = tempDir('linchpin-cache-');

  const env = { LINCHPIN_REGISTRY: registry.url, LINCHPIN_CACHE_DIR: cacheDir };
  const result = await run(DIST_CLI, ['version', '--check'], env);

  assert.equal(result.code, 0, `informational, so always 0\nSTDERR:\n${result.stderr}`);
  assert.match(result.stdout, new RegExp(`Update available: ${packageVersion} → 99\\.0\\.0`));

  const cached = JSON.parse(fs.readFileSync(path.join(cacheDir, 'update-check.json'), 'utf8'));
  assert.equal(cached.latest, '99.0.0');

  // The JSON form is the agent's path to the same facts, and it carries the
  // cache location so uninstall instructions do not have to guess at it.
  const json = await run(DIST_CLI, ['version', '--json'], env);
  const envelope = JSON.parse(json.stdout);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.updateAvailable, true);
  assert.equal(envelope.data.latest, '99.0.0');
  assert.equal(envelope.data.source, 'cache', 'without --check it must not re-ask');
  assert.equal(envelope.data.cachePath, path.join(cacheDir, 'update-check.json'));
  assert.equal(json.stderr, '', 'stderr stays empty in json mode');
});

test('update --check exits 3 when an update is pending, so it can gate CI', async (t) => {
  const registry = await startRegistry('99.0.0');
  t.after(() => registry.close());

  const result = await run(DIST_CLI, ['update', '--check'], {
    LINCHPIN_REGISTRY: registry.url,
    LINCHPIN_CACHE_DIR: tempDir('linchpin-cache-'),
  });

  assert.equal(result.code, 3);
  assert.match(result.stderr, /Update available/);
});

test('update --check exits 0 when there is nothing to do', async (t) => {
  const registry = await startRegistry(packageVersion);
  t.after(() => registry.close());

  const result = await run(DIST_CLI, ['update', '--check'], {
    LINCHPIN_REGISTRY: registry.url,
    LINCHPIN_CACHE_DIR: tempDir('linchpin-cache-'),
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /is the latest version/);
});

test('a source checkout is told to use git rather than a package manager', async (t) => {
  const registry = await startRegistry('99.0.0');
  t.after(() => registry.close());

  // DIST_CLI is a working tree, not an install — the case a contributor hits.
  const result = await run(DIST_CLI, ['update'], {
    LINCHPIN_REGISTRY: registry.url,
    LINCHPIN_CACHE_DIR: tempDir('linchpin-cache-'),
  });

  assert.equal(result.code, 3);
  assert.match(result.stderr, /Cannot update a source install/);
  assert.match(result.stderr, /git pull/);
});

test('a global install resolves the real install command without running it', async (t) => {
  const registry = await startRegistry('99.0.0');
  t.after(() => registry.close());
  const install = fakeGlobalInstall();

  const result = await run(install.cli, ['update', '--dry-run'], {
    LINCHPIN_REGISTRY: registry.url,
    LINCHPIN_CACHE_DIR: tempDir('linchpin-cache-'),
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`Would run: npm install -g ${packageName}@latest`));
});

test('the update notice goes to stderr, and never to a machine reader', async (t) => {
  const registry = await startRegistry('99.0.0');
  t.after(() => registry.close());

  const install = fakeGlobalInstall();
  const cacheDir = tempDir('linchpin-cache-');

  // A fresh cache, so the notice is available with no network call of its own
  // and no detached refresh is spawned.
  fs.writeFileSync(
    path.join(cacheDir, 'update-check.json'),
    JSON.stringify({ checkedAt: Date.now(), latest: '99.0.0', current: packageVersion }),
    'utf8'
  );

  const env = { LINCHPIN_REGISTRY: registry.url, LINCHPIN_CACHE_DIR: cacheDir };

  const human = await run(install.cli, ['shell-init', '--shell', 'zsh'], env);
  assert.equal(human.code, 0, human.stderr);
  assert.match(human.stderr, /Update available: .* → 99\.0\.0/);
  assert.match(human.stderr, /linchpin update/);
  assert.doesNotMatch(human.stdout, /Update available/, 'stdout must stay usable for eval and cd');

  // Anything parsing output must not be handed an unrequested line.
  const json = await run(install.cli, ['shell-init', '--shell', 'zsh', '--json'], env);
  assert.equal(json.stderr, '');

  const quiet = await run(install.cli, ['shell-init', '--shell', 'zsh', '--quiet'], env);
  assert.equal(quiet.stderr, '');

  // Opting out is honoured, and so is the agent case: an agent gets the answer
  // from `version --json` when it asks, never as unsolicited stderr.
  const optedOut = await run(install.cli, ['shell-init', '--shell', 'zsh'], {
    ...env,
    LINCHPIN_NO_UPDATE_NOTIFIER: '1',
  });
  assert.equal(optedOut.stderr, '');

  const agent = await run(install.cli, ['shell-init', '--shell', 'zsh'], {
    ...env,
    AI_AGENT: 'claude-code_2-1-223_agent',
  });
  assert.equal(agent.stderr, '');

  const ci = await run(install.cli, ['shell-init', '--shell', 'zsh'], { ...env, CI: 'true' });
  assert.equal(ci.stderr, '');
});

test('version and update are registered as read and write', async () => {
  const byName = Object.fromEntries(lib.COMMANDS.map((command) => [command.meta.name, command]));

  assert.equal(byName.version.effect, 'read', 'version must be allowlistable without a prompt');
  assert.equal(byName.update.effect, 'write');
});

test('the notice file is written, refreshed and taken down by the CLI itself', async (t) => {
  const registry = await startRegistry('99.0.0');
  t.after(() => registry.close());

  const install = fakeGlobalInstall();
  const cacheDir = tempDir('linchpin-cache-');
  const noticePath = path.join(cacheDir, 'update-notice.txt');
  const env = { LINCHPIN_REGISTRY: registry.url, LINCHPIN_CACHE_DIR: cacheDir };

  // `version --check` is what the shell snippet spawns in the background, so it
  // is the thing that has to leave a notice behind for the next shell to print.
  const checked = await run(install.cli, ['version', '--check', '--quiet'], env);
  assert.equal(checked.code, 0, checked.stderr);
  assert.equal(checked.stdout, '', '--quiet must stay quiet');

  const notice = fs.readFileSync(noticePath, 'utf8');
  assert.match(notice, new RegExp(`Update available: ${packageVersion} . 99\\.0\\.0`));
  assert.match(notice, /Run: linchpin update/);

  // No ANSI: the process that writes this is detached with its stdio ignored,
  // so it has no terminal to detect colour support against, and the shell that
  // eventually cats it may be redirecting anywhere.
  assert.doesNotMatch(notice, new RegExp(String.fromCharCode(27)));

  // An answer of "you are current" takes the notice down, so a shell stops
  // announcing a release the moment it stops being one.
  const current = await startRegistry(packageVersion);
  t.after(() => current.close());

  const uptodate = await run(install.cli, ['version', '--check', '--quiet'], {
    ...env,
    LINCHPIN_REGISTRY: current.url,
  });
  assert.equal(uptodate.code, 0, uptodate.stderr);
  assert.equal(fs.existsSync(noticePath), false, 'an up-to-date answer clears the notice');
});

test('a source checkout neither writes nor clears the shared notice', async (t) => {
  const registry = await startRegistry('99.0.0');
  t.after(() => registry.close());

  const cacheDir = tempDir('linchpin-cache-');
  const noticePath = path.join(cacheDir, 'update-notice.txt');
  fs.writeFileSync(noticePath, 'Update available: written by the global install\n', 'utf8');

  // DIST_CLI is a checkout, not an install: `detectInstallation` finds no
  // node_modules and reports `source`. Wiping the file from here would silence
  // a release for every shell on the machine, over a working tree that has
  // nothing to do with the installed copy.
  const result = await run(DIST_CLI, ['version', '--check', '--quiet'], {
    LINCHPIN_REGISTRY: registry.url,
    LINCHPIN_CACHE_DIR: cacheDir,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(fs.readFileSync(noticePath, 'utf8'), /written by the global install/);
});

test('an unchanged notice is not rewritten under a shell that may be reading it', () => {
  const { writeUpdateNotice, readUpdateNotice, clearUpdateNotice } = lib;
  const noticePath = path.join(tempDir('linchpin-cache-'), 'update-notice.txt');

  assert.equal(readUpdateNotice(noticePath), undefined, 'absent means nothing to say');

  assert.equal(writeUpdateNotice('Update available: 1.0.0 to 2.0.0', noticePath), true);
  assert.equal(readUpdateNotice(noticePath), 'Update available: 1.0.0 to 2.0.0\n');

  // Called after every human command, so a rewrite that changes nothing must
  // not churn a file a shell may be reading.
  const before = fs.statSync(noticePath).mtimeMs;
  writeUpdateNotice('Update available: 1.0.0 to 2.0.0\n', noticePath);
  assert.equal(fs.statSync(noticePath).mtimeMs, before, 'an identical write is skipped');

  assert.equal(clearUpdateNotice(noticePath), true);
  assert.equal(clearUpdateNotice(noticePath), true, 'clearing an absent notice is not a failure');
  assert.equal(readUpdateNotice(noticePath), undefined);
});
