# Repo tasks

> **Status: specification.** Nothing described here is implemented. This page is the design
> being handed to whoever builds it, and it should be edited as decisions land rather than
> left to drift from the code.

`linchpin repo <task>` connects a repository to Linchpin's release infrastructure in one
command. The unit is the outcome — "publish this repo's docs" — not the secret.

```bash
linchpin repo plugin --connect          # the whole bundle for a new plugin repo
linchpin repo docs --repo=linchpin/x    # one outcome
linchpin repo status                    # every task, one table
```

## The problem this replaces

Wiring a new plugin repository into the release infrastructure currently means reading two or
three other repositories to work out what it needs, then setting secrets by hand out of
personal 1Password copies.

The most recent case, `linchpin/block-alchemy`, took a manual diff of `linchpin/linchpin-blocks`
and `linchpin/mantle` to establish four facts: three secrets were present, four were missing,
two more were inherited from the organisation, and one workflow file did not exist at all.
Every one of those is machine-derivable.

Two properties make it automatable:

**The repository already declares what it needs.** Every `${{ secrets.X }}` in
`.github/workflows/` is a requirement the repo states about itself, so the required set is
*computed* and can never drift from the workflows that consume it.

**The credentials always live in the same 1Password items.** The map from outcome to credential
is an organisation constant, so it belongs in this tool rather than repeated across thirty-eight
repositories.

## Task catalog

Each task is one thing a person wants to be true about a repository. Secret names are an
implementation detail inside the task and never appear on the command line.

| Task | Outcome | Sets |
| --- | --- | --- |
| `release` | Versions, tags and `CHANGELOG.md` via release-please | `GH_BOT_TOKEN` |
| `packagist` | `composer require linchpin/x` resolves | `SSH_HOST`, `SSH_USER`, `SSH_PASS` |
| `docs` | Docs publish to docs.linchpin.com | `WP_ACCESS_TOKEN` |
| `release-post` | Releases announced on builditbelieveit.com | `WP_USER`, `WP_PASS`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` |
| `plugin` | All four of the above | The whole set |

`plugin` is the meta-task and the one-liner worth having.

`wporg` is deliberately **not** in this catalog. It is SVN rather than git, with an assets
directory, a readme the directory validates, and a human review queue in the middle. It gets its
own verbs — `linchpin wporg check`, `linchpin wporg submit` — rather than a slot in a bundle.

### Tasks have dependencies; secrets do not

This only exists in the task frame. `release-post` is inert without `release` — not because they
share a credential, but because **GitHub raises no `release: published` event for a release
created with `GITHUB_TOKEN`**, so the announcement workflow never fires at all. The same
dependency holds for `packagist`. A per-secret tool cannot know that. A task graph can, and must
either pull the dependency in behind the task or refuse and say why.

### Reference 1Password by UUID, never by title

The vaults themselves prove why: `DevOps` holds two separate items both titled *OpenAI API Key*,
and builditbelieveit appears as both *builditbelieveit.com* and *Builditbelieveit*. A
title-based `op://` reference would silently resolve to the wrong item. UUIDs survive renames.

## Command surface

| Flag | Behaviour |
| --- | --- |
| `--connect` | Default. Fills only what is missing. Idempotent, never touches an existing value |
| `--update` | Overwrites. The rotation path, and explicit on purpose — see below |
| `--check` | Read-only, non-zero exit when a task is incomplete |
| `--dry-run` | Pairs with `--update`. Prints names and outcomes, never values |
| `--repo` | Defaults to the git remote of the working directory |

`--update` has to be explicit because **secrets are write-only**: the API returns names and
`updated_at`, never values, so the tool cannot tell a good value from a stale one. Overwriting
can only ever be a human's decision.

`--check` and `status` are classified `effect: read` in the registry, so they land in skill
allowlists without an approval prompt and can gate CI. `--connect` and `--update` are `write`.
Nothing here is `destructive`, but `--update` sits close enough that its confirmation should be
real.

### Output is task-shaped

One line per outcome. Secret names appear only as parenthetical evidence, and a blocked task
names the single human step left rather than dumping four missing names on the reader.

```
$ linchpin repo plugin --connect
  linchpin/block-alchemy

  ✓ release        inherited from org  (GH_BOT_TOKEN)
  ✓ packagist      already connected
  ✓ docs           connected — dry-run dispatch passed
  ⚠ release-post   blocked: no service item for the builditbelieveit
                   application password. Add it to Agent/Service Accounts,
                   then re-run. (CF Access token is set.)

  3 connected, 1 blocked
```

`--json` emits the same information through the existing envelope.

## Resolution order

Per secret, inside a task. Step one is the one that saves the archaeology.

1. **Already visible as an organisation secret?** Write nothing; report `inherited`.
   `GET /repos/{owner}/{repo}/actions/organization-secrets` answers this, and it is the endpoint
   nobody reaches for. `WP_ACCESS_TOKEN` and `GH_BOT_TOKEN` are org-level, so
   `linchpin repo docs --connect` on a Linchpin repository should print "inherited, nothing to
   do" and exit 0.
2. **Present at repository level?** `--connect` skips; `--update` overwrites.
3. **Missing?** Read the credential, validate it, then write it.

### Never shadow an organisation secret

A repository-level copy silently wins over the organisation value and then goes stale.
`linchpin/mantle` already carries this bug — a repo-level `WP_ACCESS_TOKEN` duplicating the
org one — while `linchpin-blocks` has no copy and works correctly. `--check` should flag a
shadowing secret as a warning, and `--connect` must refuse to create one without `--force`.

### Validate before writing, not after

Because secrets are write-only, a tool that stops at `gh secret set` can only report that it
typed something in. But the CLI **holds the plaintext at write time**, so it can prove each
credential against the real service first:

| Task | Pre-write validation | Post-write proof |
| --- | --- | --- |
| `docs` | `GET docs.linchpin.com/wp-json/` with the bearer token | Dispatch `sync-docs.yml` with `dry-run: true`, require success |
| `packagist` | Open the SSH connection | — |
| `release-post` | Reach builditbelieveit through the CF Access service token | The action's own `dry-run` input |
| `release` | `gh api user` as the bot | — |

A dead credential then fails at the source, naming the 1Password item to fix, instead of landing
silently in GitHub and surfacing weeks later as a red release.

## Templates and drift

A task is not connected if the workflow that consumes its secrets does not exist. Each task
therefore owns a template under `templates/`, rendered with per-repository values.

| Variable | Source | Appears in |
| --- | --- | --- |
| `slug` | Repository name | `managed-path: wordpress-plugins/{{slug}}`, `docs/{{slug}}/`, `{{slug}}.zip`, `build/{{slug}}` |
| `product` | `composer.json` description, or the plugin header | `product: {{product}}` in `release-post.yml` |

Both are readable over the API, so no clone is needed.

### Drift is the sleeper feature

Once the template is the source of truth, the interesting case is not "file missing" but "file
exists and has diverged." Compare the rendered template against the repository's current file
and there are exactly three outcomes: identical, so nothing to do; missing, so open a PR that
adds it; or different, so open a PR showing precisely how this repository diverged.

That last case is the manual three-repository diff, as one command across every repository. It
is also how a real bug would have been caught the day it was written rather than months later:
`linchpin/block-alchemy` had `token: ${{ secrets.GH_BOT_TOKEN || secrets.GITHUB_TOKEN }}` in its
release workflow, and that fallback silently disables every workflow that reacts to a release.

## Landing files without a clone

Three routes exist. Use the third.

| Route | Assessment |
| --- | --- |
| `PUT /repos/{owner}/{repo}/contents/{path}` | One file per call, needs the blob `sha` to update. Acceptable for a single file, awkward beyond that |
| Git Data API (blob → tree → commit → ref) | Atomic multi-file, but four round-trips and you assemble the tree by hand |
| **GraphQL `createCommitOnBranch`** | One call, multiple files, atomic — and GitHub signs the commit, so the bot's work shows as Verified |

```
# 1. branch off the base sha
POST /repos/{owner}/{repo}/git/refs   { ref: "refs/heads/ci/docs-sync", sha }

# 2. one atomic, signed commit
mutation($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) { commit { url } }
}

$input = {
  branch:          { repositoryNameWithOwner, branchName },
  expectedHeadOid: "<base sha>",
  message:         { headline, body },
  fileChanges:     { additions: [{ path, contents: "<base64>" }] }
}

# 3. open the PR
POST /repos/{owner}/{repo}/pulls
```

`expectedHeadOid` is worth the extra read: if the base branch moved underneath you, the mutation
fails instead of clobbering.

### The `workflow` scope refusal

A token without the `workflow` OAuth scope is **refused** when creating or updating anything
under `.github/workflows/` — which is every template this feature ships. Preflight
`gh auth status` and tell the operator to run `gh auth refresh -s workflow`, rather than
surfacing GitHub's raw refusal. A GitHub App needs `workflows: write` instead.

### The PR title is the only commitlint gate

An API commit **bypasses commitlint entirely** — husky is a local hook and there is no
server-side check. But these repositories squash-merge, so the PR title becomes the commit
message and feeds release-please. The generated title has to conform:

```
ci(NO-TASK): Add the docs sync workflow
```

`ci` is in the type-enum, `NO-TASK` is an accepted scope, and the subject is sentence case with
no forbidden punctuation. Get it wrong and the changelog breaks in a way nobody notices until
release. `ci` is also hidden from the changelog in these configs, which is the right home for a
workflow addition.

## Registry shape

One declaration per task, holding everything it needs: secrets, their 1Password references, its
workflow template, its validation, and its dependencies.

```ts
export const TASKS = {
  docs: {
    summary:  "Publish this repo's docs to docs.linchpin.com",
    requires: [ 'release' ],
    secrets: [
      {
        name: 'WP_ACCESS_TOKEN',
        ref: 'op://<vault>/<item>/credential',
        scope: 'org', // expect inherited; never write a repo copy
      },
    ],
    workflow: {
      path: '.github/workflows/sync-docs.yml',
      template: 'workflows/sync-docs.yml.tpl',
    },
    validate: verifyDocsToken,
    prove: dispatchDryRun( 'sync-docs.yml' ),
  },
  // packagist, release, release-post, plugin…
};
```

Commands register through the existing registry: `name: 'repo docs'`, `group: 'git'`, and the
`effect` classification above.

Shell out to `gh` and `op` through `tinyexec`. Do not reimplement the libsodium sealed-box
encryption the secrets REST API requires — `gh secret set` already does it client-side, and it
also covers organisation, environment and `--app` scopes.

## Build order

Genuinely sequential. Each stage ships on its own, and the first needs no vault access at all,
so it is testable without a single credential.

1. **`linchpin repo status` and `--check`.** Pure introspection: scan `${{ secrets.X }}` out of
   `.github/workflows/`, diff against repo secrets ∪ org-visible secrets, report per task. No
   1Password, no writes, fully testable against fixtures — and it delivers the whole value of
   the diagnosis on its own.
2. **`--connect` and `--update`.** Adds the vault: read by UUID, validate before writing, then
   `gh secret set`. The org-shadow refusal lands here.
3. **Template rendering and `--scaffold`.** Render, compare, open the PR. The missing-file case
   first; drift is the same code path with a different PR body.
4. **Post-write proof.** Dispatch the dry-run workflow and wait on the conclusion, so a task
   only reports connected once something has actually run green.

## Traps

- **Secrets are write-only.** Presence is verifiable; correctness is not. This shapes
  `--connect` versus `--update`, and it is why validation happens at the source.
- **Trailing newlines.** `op read` terminates its output with a newline, and that byte inside a
  token or SSH key produces failures that look exactly like a bad credential. Use the no-newline
  flag, or strip it. This is the most likely bug in the first version.
- **Four separate stores.** `actions`, `agents`, `codespaces` and `dependabot` do not share
  values. A Dependabot-only secret is invisible to Actions.
- **Environment secrets** need the environment to exist first.
- **`admin:org` is not in a normal token.** `GET /orgs/{org}/actions/secrets` returns 403 without
  it. Use the per-repo `organization-secrets` endpoint, which needs only `repo`.
- **Never log a value** — not in `--json` output, not in an error message. Names and outcomes
  only.
- **In CI, use a 1Password service account** (`OP_SERVICE_ACCOUNT_TOKEN`) rather than a user
  session.

## Open decisions

**Where does the registry live?** This repository is public and publishes a public npm package.
Vault and item UUIDs are not credentials — access is still gated by vault membership — but the
registry does disclose the internal service inventory: packagist SFTP, the docs bearer token,
the CF Access bypass, the bot account. Options are to ship it as-is, to move it into a private
`@linchpinagency/secrets-map` dependency, or to read it from `~/.linchpin/secrets.json` seeded by
an init command. **Recommendation: private package.** It keeps the one-line UX and keeps the
inventory off npm. Until this is settled, the UUIDs are deliberately omitted from this page.

**The builditbelieveit application password has no service item.** `WP_USER` and `WP_PASS` exist
only as personal copies in the `Employee` vault, yet both `linchpin-blocks` and `mantle` have
them set — somebody typed them in from a personal item. Until an item lands in
`Agent/Service Accounts`, `release-post` can only ever report blocked. This is a vault change,
not a code change, and it blocks nothing else.

**Does a task ever write files without being asked?** Recommendation: no. `--connect` handles
secrets and *reports* a missing workflow; `--scaffold` opens the PR. Dropping a workflow into a
repository is a commit, not a configuration change, and the two deserve different consent.
