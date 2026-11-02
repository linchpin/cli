# Hosting environments

`linchpin hosting` reads a client's hosting environments from api.linchpin.com and reports the
gaps against the layout every Linchpin client site is meant to have: a production, a staging
and a development environment, each registered with the role it plays.

```bash
linchpin hosting ls [client]              # one row per environment, production first
linchpin hosting audit [client]           # the gaps, with a remedy each; exit 3 when there are any
linchpin hosting ls --unregistered        # also the Pressable installs no client owns
linchpin hosting ls --brief               # client, role, hostname — nothing else
linchpin hosting ls --fields role,wp,ref  # pick columns; the same keys in --json
linchpin hosting ls --limit 20            # cap the rows; --json reports total and truncated
```

Both are classified `read`. The layout itself, what each role means on each host, and how to
close a gap are owned by the `wp-hosting-environments` skill in `linchpin/skills`; this page
is the command.

## Where the data comes from

The CLI never talks to a host directly. api.linchpin.com is the system of record:

| Read | Gives |
| --- | --- |
| `GET /api/v1/environments` | Every environment: client, role, hostname, `provider` + `provider_ref` (the host's site id), the production a copy points at, deploy environment and branch |
| `GET /api/v1/environments/pressable` | Pressable's own view of every install on Linchpin's account — site type (live, staging, sandbox), `WP_ENVIRONMENT_TYPE`, state, and the environment that names it, or null |

Going through the api means a laptop never holds a Pressable credential, and the host matrix
(Pressable today; WP Engine, Cloudways and Pantheon as the api grows them) lives in one place.
An environment on a host the api does not integrate yet is still listed and audited from its
register row; it just has no site-type or `WP_ENVIRONMENT_TYPE` column.

## Credentials

| Variable | Meaning |
| --- | --- |
| `LINCHPIN_API_CLIENT_ID` + `LINCHPIN_API_CLIENT_SECRET` | An application client, exchanged for a one-hour bearer with `POST /auth/token`. Needs the `sites:read` scope. This is the form to give a person or a CI job, because its scopes are visible in the api admin |
| `LINCHPIN_API_TOKEN` | A static agent token, sent as-is. Every scope |
| `LINCHPIN_API_URL` | Override the api, for a stub. `http://` is refused unless the host is loopback or `LINCHPIN_API_ALLOW_INSECURE=1` |

Missing credentials exit 4 (`missing_credentials`) naming the variables; a rejected one also
exits 4 (`auth_rejected`). An api or host that cannot be reached exits 3.

## The audit

A finding has a code, a severity, the client and environment it is about, a message and a
remedy. Gaps fail the run with exit 3; warnings and unregistered installs do not.

| Code | Severity | Meaning |
| --- | --- | --- |
| `below-minimum` | gap | A production with fewer than two environments in total — nothing to review or maintain off the live site |
| `missing-role` | warning | No environment of an expected role (staging, development) points at this production |
| `copy-without-production` | gap | A staging or development row names no production of its client |
| `environment-type-mismatch` | gap | The host's `WP_ENVIRONMENT_TYPE` disagrees with the registered role |
| `sandbox-install` | warning | A copy is a Pressable sandbox, which carries a password mu-plugin |
| `live-type-copy` | warning | A copy is a live-type site and billed as one |
| `production-on-staging-type` | warning | Production is a staging-type site |
| `install-not-live` | warning | Pressable reports the install disabled or deploying |
| `unregistered-install` | info | An install on the account that no client environment names (`--unregistered`) |

The policy is the same on every host and lives in `HOST_POLICIES` in `src/core/hosting.ts`:
**at least two** environments per production (the live site plus one copy), **three
expected** (`staging` and `development`), and more allowed — a second staging or a UAT copy
is listed, never reported. A host that needs a different floor gets one entry there rather
than a branch in the audit.

```
$ linchpin hosting audit linchpin
Linchpin
  ✓ production   linchpin.com (pressable 1335128, live · production)
  ✓ development  linchpindev.linchpin.build (pressable 1833215, staging · development)
  ⚠ staging      missing — No staging environment registered for linchpin.com.
      → Create a staging-type site (never a sandbox), set WP_ENVIRONMENT_TYPE to "staging", then register it with role staging against environment 1 — or record on the task that this client runs without one.

0 gaps, 1 warning
```

`--json` carries the same findings in the envelope: `data.clients[].findings[]` and
`data.totals`. `hosting ls --json` is flat — `data.environments[]`, one object per row with
`environmentId`, `clientId` and whichever columns `--fields` kept — plus `data.total` and
`data.truncated`, so an agent can page with `--limit` and project with `--fields` instead
of reading the whole fleet into its context.

## Not built yet: closing a gap from the CLI

> **Status: specification.** `linchpin hosting provision` is not implemented. The skill
> closes gaps today through the Pressable MCP, step by step, with the user confirming each.

The verb that would finish this is one that turns a `below-minimum` or `missing-role` finding into the
environment, with confirmation:

```bash
linchpin hosting provision <client> --role staging          # plan, confirm, create, type, register
linchpin hosting provision <client> --role development --from-production
linchpin hosting register <client> --role staging --pressable 1848725   # an install that exists
```

It is blocked on api.linchpin.com, deliberately: the CLI should stay credential-free for
hosts, so the api needs

1. a `createSite` / `cloneSite` wrapper in its Pressable client (it has list, get, backups,
   sync and WP-CLI today, and no create);
2. a route — `POST /environments/provision` or similar — under a write scope, that clones or
   creates the staging-type site, sets `WP_ENVIRONMENT_TYPE`, tags it, and inserts the
   environment row in one transaction, so a half-made environment cannot exist;
3. a check that the Pressable credential's "Sites read + edit" grant covers site creation.

`register` needs none of that — `POST /environments` already exists — and is the first piece
worth building. Both verbs are `write`, both confirm in a TTY and refuse without
`--yes` elsewhere, and neither ever creates a sandbox or a live-type copy.

## Relationship to `bin/onboard-site`

linchpin/actions ships `bin/onboard-site`, which puts one site on Sisyphus's nightly
maintenance: it reads the same api rows, picks dev and staging from the client's Pressable
staging sites, converts the repo and enrolls the site. The two are complementary, not
overlapping: `hosting audit` tells you whether the environments exist and are typed right;
`onboard-site` assumes they do and wires maintenance to them. Run the audit first; when it is
clean, `onboard-site` has nothing to ask about dev.
