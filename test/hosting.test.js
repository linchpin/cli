const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const os = require('node:os');

// The shared fixture's clean environment, rebuilt here because the module does
// not export it: GIT_* stripped, the update notifier off, and any real
// api.linchpin.com credential removed so no test can reach the live api.
const CLEAN_ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith('GIT_') && !key.startsWith('LINCHPIN_API_')
    )
  ),
  LINCHPIN_NO_UPDATE_NOTIFIER: '1',
  LINCHPIN_CACHE_DIR: path.join(os.tmpdir(), 'linchpin-test-cache'),
};

const BIN = path.resolve(__dirname, '..', 'dist', 'cli.js');
const LIB = pathToFileURL(path.resolve(__dirname, '..', 'dist', 'index.js')).href;
const FIXTURES = path.resolve(__dirname, 'fixtures', 'hosting');

const environments = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'environments.json'), 'utf8'));
const pressable = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'pressable.json'), 'utf8'));

let lib;
test.before(async () => {
  lib = await import(LIB);
});

/**
 * An api.linchpin.com that answers only what `linchpin hosting` reads.
 *
 * Every test goes through this rather than the real api: a suite that reaches
 * it needs a credential and a network, and its answer changes whenever a
 * client's hosting does.
 */
function startApi(options = {}) {
  const requests = [];
  const token = options.token ?? 'agent-token';

  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({ url: request.url, authorization: request.headers.authorization, body });

      const json = (status, payload) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      };

      if (request.url === '/api/v1/auth/token') {
        const parsed = JSON.parse(body || '{}');
        if (parsed.client_id === 'cli' && parsed.client_secret === 'secret') {
          json(200, { access_token: token, token_type: 'Bearer', expires_in: 3600, scope: 'sites:read' });
        } else {
          json(401, { error: 'invalid_client', error_description: 'Invalid client credentials' });
        }
        return;
      }

      if (request.headers.authorization !== `Bearer ${token}`) {
        json(401, { ok: false, error_code: 'unauthorized', message: 'Missing or invalid bearer' });
        return;
      }

      if (request.url === '/api/v1/environments') {
        json(200, options.environments ?? environments);
        return;
      }

      if (request.url === '/api/v1/environments/pressable') {
        if (options.pressableDown) {
          json(502, { ok: false, error_code: 'pressable_unreachable', message: 'Could not list sites on Pressable' });
          return;
        }
        json(200, options.pressable ?? pressable);
        return;
      }

      json(404, { ok: false, error_code: 'not_found', message: request.url });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/api/v1`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

/**
 * Asynchronous on purpose: `spawnSync` blocks this process's event loop, so
 * the api stub living here could never answer the child's request.
 */
function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...CLEAN_ENV, ...env },
      timeout: 20_000,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: stdout.trimEnd(), stderr: stderr.trimEnd() }));
  });
}

test('hosting commands are registered as reads', async () => {
  const { COMMANDS } = lib;
  const ls = COMMANDS.find((command) => command.meta.name === 'hosting ls');
  const audit = COMMANDS.find((command) => command.meta.name === 'hosting audit');
  assert.ok(ls && audit, 'hosting ls and hosting audit are registered');
  assert.equal(ls.effect, 'read');
  assert.equal(audit.effect, 'read');

  const help = await run(['hosting', 'audit', '--help'], {});
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /expected layout/);
  assert.match(help.stdout, /--unregistered/);
});

test('without a credential it fails with the auth exit code and names the variables', async () => {
  const result = await run(['hosting', 'ls', '--json'], {});
  assert.equal(result.code, lib.EXIT_CODES.auth);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, 'missing_credentials');
  assert.match(envelope.error.remedy, /LINCHPIN_API_CLIENT_ID/);
  assert.match(envelope.error.remedy, /LINCHPIN_API_TOKEN/);
});

test('a plaintext api that is not loopback is refused', async () => {
  const result = await run(['hosting', 'ls', '--json'], {
    LINCHPIN_API_URL: 'http://api.example.com/api/v1',
    LINCHPIN_API_TOKEN: 'x',
  });
  assert.equal(result.code, lib.EXIT_CODES.validation);
  assert.equal(JSON.parse(result.stdout).error.code, 'insecure_api_url');
});

test('hosting ls lists every environment grouped by client, production first', async () => {
  const api = await startApi();
  try {
    const result = await run(['hosting', 'ls'], { LINCHPIN_API_URL: api.url, LINCHPIN_API_TOKEN: 'agent-token' });
    assert.equal(result.code, 0, result.stderr);

    const lines = result.stdout.split('\n');
    assert.match(lines[0], /^Client\s+Role\s+Hostname\s+Host\s+Ref\s+Site type\s+WP type\s+Deploy$/);

    const itca = lines.findIndex((line) => line.startsWith('ITCA'));
    assert.ok(itca > 0, 'ITCA row present');
    assert.match(lines[itca], /production\s+ideainfanttoddler\.linchpin\.site\s+pressable\s+1769760\s+live\s+production\s+production@main/);
    assert.match(lines[itca + 1], /^\s+staging\s+itcastg\.linchpin\.build\s+pressable\s+1848725\s+staging\s+staging/);
    assert.match(lines[itca + 2], /^\s+development\s+itcadev\.linchpin\.build\s+pressable\s+1848726\s+sandbox\s+production/);

    // A wpengine environment has no Pressable install to join, and says so.
    const wheaton = lines.find((line) => line.startsWith('Wheaton'));
    assert.match(wheaton, /production\s+wheaton\.example\s+wpengine\s+wheatonprod\s+—\s+—/);

    assert.doesNotMatch(result.stdout, /unregistered/, 'unregistered installs are opt-in');
    assert.equal(result.stderr, '', 'nothing on stderr');
  } finally {
    await api.close();
  }
});

test('hosting ls filters by client name or id and can include unregistered installs', async () => {
  const api = await startApi();
  try {
    const byName = await run(['hosting', 'ls', 'itca', '--json'], { LINCHPIN_API_URL: api.url, LINCHPIN_API_TOKEN: 'agent-token' });
    assert.equal(byName.code, 0, byName.stderr);
    const envelope = JSON.parse(byName.stdout);
    assert.equal(envelope.command, 'hosting_ls');
    assert.deepEqual(
      envelope.data.environments.map((row) => [row.client, row.role, row.hostname]),
      [
        ['ITCA', 'production', 'ideainfanttoddler.linchpin.site'],
        ['ITCA', 'staging', 'itcastg.linchpin.build'],
        ['ITCA', 'development', 'itcadev.linchpin.build'],
      ]
    );
    assert.equal(envelope.data.total, 3);
    assert.equal(envelope.data.truncated, false);

    const byId = await run(['hosting', 'ls', '10', '--unregistered', '--json'], { LINCHPIN_API_URL: api.url, LINCHPIN_API_TOKEN: 'agent-token' });
    const data = JSON.parse(byId.stdout).data;
    assert.deepEqual(
      data.environments.map((row) => [row.client, row.ref]),
      [['Linchpin', '1335128'], ['Linchpin', '1833215'], ['', '1743803']]
    );

    const human = await run(['hosting', 'ls', '--unregistered'], { LINCHPIN_API_URL: api.url, LINCHPIN_API_TOKEN: 'agent-token' });
    assert.match(human.stdout, /\(unregistered\)\s+—\s+linchpin-legacy\.mystagingwebsite\.com\s+pressable\s+1743803\s+live\s+production/);
  } finally {
    await api.close();
  }
});

test('hosting ls trims its output with --fields, --brief and --limit', async () => {
  const api = await startApi();
  try {
    const env = { LINCHPIN_API_URL: api.url, LINCHPIN_API_TOKEN: 'agent-token' };

    const brief = await run(['hosting', 'ls', 'itca', '--brief'], env);
    assert.equal(brief.code, 0, brief.stderr);
    assert.deepEqual(brief.stdout.split('\n'), [
      'Client  Role         Hostname',
      'ITCA    production   ideainfanttoddler.linchpin.site',
      '        staging      itcastg.linchpin.build',
      '        development  itcadev.linchpin.build',
    ]);

    const fields = await run(['hosting', 'ls', 'itca', '--fields', 'role,wp', '--json'], env);
    const rows = JSON.parse(fields.stdout).data.environments;
    assert.deepEqual(Object.keys(rows[0]), ['environmentId', 'clientId', 'role', 'wp']);
    assert.deepEqual(rows.map((row) => row.wp), ['production', 'staging', 'production']);

    const limited = await run(['hosting', 'ls', '--limit', '2', '--json'], env);
    const data = JSON.parse(limited.stdout).data;
    assert.equal(data.environments.length, 2);
    assert.equal(data.total, 7);
    assert.equal(data.truncated, true);
    const human = await run(['hosting', 'ls', '--limit', '2'], env);
    assert.match(human.stdout, /\n\n2 of 7 rows \(--limit\)$/);

    const bad = await run(['hosting', 'ls', '--fields', 'role,colour', '--json'], env);
    assert.equal(bad.code, lib.EXIT_CODES.validation);
    const error = JSON.parse(bad.stdout).error;
    assert.equal(error.code, 'invalid_fields');
    assert.match(error.message, /colour/);
    assert.match(error.remedy, /client, role, hostname/);
  } finally {
    await api.close();
  }
});

test('hosting audit names each gap with a remedy and exits 3 when one exists', async () => {
  const api = await startApi();
  try {
    const result = await run(['hosting', 'audit'], { LINCHPIN_API_URL: api.url, LINCHPIN_API_TOKEN: 'agent-token' });
    assert.equal(result.code, lib.EXIT_CODES.precondition, 'gaps fail the run');

    // Linchpin: production and development present, staging missing — two
    // environments clears the floor, so the missing third is a warning.
    assert.match(result.stdout, /Linchpin\n  ✓ production\s+linchpin\.com \(pressable 1335128, live · production\)\n  ✓ development\s+linchpindev\.linchpin\.build/);
    assert.match(result.stdout, /⚠ staging\s+missing — No staging environment registered for linchpin\.com\./);
    assert.match(result.stdout, /→ Create a staging-type site \(never a sandbox\), set WP_ENVIRONMENT_TYPE to "staging"/);

    // ITCA dev: a sandbox whose constant says production — one warning, one gap.
    assert.match(result.stdout, /✗ development\s+itcadev\.linchpin\.build \(pressable 1848726, sandbox · production\)/);
    assert.match(result.stdout, /WP_ENVIRONMENT_TYPE is "production" but the environment is registered as development/);
    assert.match(result.stdout, /sandbox-type site, which carries Pressable's password-protection mu-plugin/);

    // Acme: a staging copy that points at no production.
    assert.match(result.stdout, /Acme\n  ✗ staging\s+acmestg\.linchpin\.build.*\n\s+Registered as staging but points at no production of this client\./);

    // Wheaton: production alone is below the floor — a gap on any host — and
    // both expected copies are warned about, without a host join.
    assert.match(result.stdout, /Wheaton\n  ✗ production\s+wheaton\.example \(wpengine wheatonprod\)\n\s+wheaton\.example has only production; at least 2 are required\./);
    assert.match(result.stdout, /⚠ staging\s+missing — No staging environment registered for wheaton\.example/);
    assert.match(result.stdout, /⚠ development\s+missing — No development environment registered for wheaton\.example/);

    assert.match(result.stdout, /\n3 gaps, 4 warnings$/);
  } finally {
    await api.close();
  }
});

test('hosting audit --json carries findings and totals, and exits 0 for a complete client', async () => {
  const api = await startApi();
  try {
    const result = await run(['hosting', 'audit', 'itca', '--json'], { LINCHPIN_API_URL: api.url, LINCHPIN_API_TOKEN: 'agent-token' });
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'hosting_audit');
    assert.deepEqual(envelope.data.totals, { gaps: 1, warnings: 1, info: 1 });
    const codes = envelope.data.clients[0].findings.map((finding) => finding.code).sort();
    assert.deepEqual(codes, ['environment-type-mismatch', 'sandbox-install']);
    assert.equal(result.code, lib.EXIT_CODES.precondition);

    // Fix the fixture's dev site and the client is clean.
    const fixed = {
      ...pressable,
      installs: pressable.installs.map((install) =>
        install.id === '1848726' ? { ...install, sandbox: false, wp_environment_type: 'development' } : install
      ),
    };
    const clean = await startApi({ pressable: fixed });
    try {
      const ok = await run(['hosting', 'audit', 'itca'], { LINCHPIN_API_URL: clean.url, LINCHPIN_API_TOKEN: 'agent-token' });
      assert.equal(ok.code, 0, ok.stdout);
      assert.match(ok.stdout, /0 gaps, 0 warnings$/);
    } finally {
      await clean.close();
    }
  } finally {
    await api.close();
  }
});

test('client credentials are exchanged for a token once', async () => {
  const api = await startApi();
  try {
    const result = await run(['hosting', 'ls', '--json'], {
      LINCHPIN_API_URL: api.url,
      LINCHPIN_API_CLIENT_ID: 'cli',
      LINCHPIN_API_CLIENT_SECRET: 'secret',
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(api.requests.filter((request) => request.url === '/api/v1/auth/token').length, 1);
    assert.ok(
      api.requests.filter((request) => request.url !== '/api/v1/auth/token').every((request) => request.authorization === 'Bearer agent-token'),
      'the exchanged token is sent on every read'
    );

    const rejected = await run(['hosting', 'ls', '--json'], {
      LINCHPIN_API_URL: api.url,
      LINCHPIN_API_CLIENT_ID: 'cli',
      LINCHPIN_API_CLIENT_SECRET: 'wrong',
    });
    assert.equal(rejected.code, lib.EXIT_CODES.auth);
    assert.equal(JSON.parse(rejected.stdout).error.code, 'auth_rejected');
  } finally {
    await api.close();
  }
});

test('a host the api cannot reach is a precondition failure, not a crash', async () => {
  const api = await startApi({ pressableDown: true });
  try {
    const result = await run(['hosting', 'audit', '--json'], { LINCHPIN_API_URL: api.url, LINCHPIN_API_TOKEN: 'agent-token' });
    assert.equal(result.code, lib.EXIT_CODES.precondition);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'pressable_unreachable');
    assert.equal(result.stderr, '', 'json mode keeps stderr empty');
  } finally {
    await api.close();
  }
});

test('auditInventory is pure and applies the layout policy per host', () => {
  const { auditInventory, buildInventory, expectedRolesFor, policyFor } = lib;
  assert.deepEqual(expectedRolesFor('pressable'), ['production', 'staging', 'development']);
  assert.deepEqual(expectedRolesFor('pantheon'), ['production', 'staging', 'development']);
  assert.deepEqual(expectedRolesFor('something-new'), ['production', 'staging', 'development']);
  assert.equal(policyFor('wpengine').minimum, 2);

  const report = auditInventory(buildInventory(environments.environments, pressable.installs));
  const linchpin = report.clients.find((client) => client.clientName === 'Linchpin');
  assert.deepEqual(
    linchpin.findings.map((finding) => [finding.code, finding.severity, finding.role]),
    [['missing-role', 'warning', 'staging']]
  );
  const wheaton = report.clients.find((client) => client.clientName === 'Wheaton');
  assert.deepEqual(
    wheaton.findings.map((finding) => [finding.code, finding.severity]),
    [['below-minimum', 'gap'], ['missing-role', 'warning'], ['missing-role', 'warning']]
  );

  // A production with two copies of the same role, or a fourth environment, is
  // never a finding: more than expected is allowed.
  const extra = buildInventory(
    [
      ...environments.environments.filter((row) => row.client_id === 20),
      { ...environments.environments[3], id: 99, hostname: 'itcauat.linchpin.build', provider_ref: '999' },
    ],
    pressable.installs
  );
  const itca = auditInventory(extra).clients[0];
  assert.deepEqual(
    itca.findings.map((finding) => finding.code).sort(),
    ['environment-type-mismatch', 'sandbox-install']
  );
  assert.equal(report.unregistered.length, 1);
  assert.equal(report.unregistered[0].code, 'unregistered-install');
});
