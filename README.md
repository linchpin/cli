<table width="100%">
  <tr>
    <td align="left" width="70%">
      <strong>Linchpin CLI</strong><br />
      One command line tool for WordPress and agent workflows — git worktree management, local environment switching, and deterministic verbs agents can call without approval prompts.
    </td>
    <td align="center" width="30%">
      <img src="https://badge.fury.io/js/@linchpinagency%2Fcli.svg" alt="npm version" />
      <img src="https://img.shields.io/github/license/linchpin/cli" alt="License" />
      <img src="https://img.shields.io/badge/Node-%3E%3D22.12-339933?logo=node.js&logoColor=white" alt="Node >= 22.12" />
      <br />
      <img src="https://img.shields.io/github/actions/workflow/status/linchpin/cli/ci.yml?label=CI" alt="CI status" />
      <img src="https://img.shields.io/github/actions/workflow/status/linchpin/cli/release-please.yml?label=release" alt="Release status" />
      <br />
      <img src="https://img.shields.io/github/last-commit/linchpin/cli" alt="Last commit" />
      <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs welcome" />
      <img src="https://img.shields.io/badge/WordPress-%2321759B?logo=wordpress&logoColor=white" alt="WordPress" />
    </td>
  </tr>
  <tr>
    <td>
      A <strong><a href="https://linchpin.com">Linchpin</a></strong> project · <em>Actively maintained</em>
    </td>
    <td align="center" width="30%">
      <img src="https://assets.linchpin.com/linchpin-logo-primary.svg" width="100" alt="Linchpin" />
    </td>
  </tr>
</table>

```bash
npm install -g @linchpinagency/cli
linchpin --help
```

**Contents** · [What this is](#what-this-is) · [Command surface](#command-surface) · [Requirements](#requirements) ·
[Install](#install) · [Set up a project](#set-up-a-project) · [Daily use](#daily-use) ·
[Staying up to date](#staying-up-to-date) · [Uninstall](#uninstall) · [Configuration](#configuration) ·
[Hooks](#hooks) · [Agents, output modes and exit codes](#agents-output-modes-and-exit-codes) ·
[Troubleshooting](#troubleshooting) · [Development](#development) · [Releases](#releases)

## What this is

`linchpin` is a single binary that carries every repeatable piece of Linchpin's WordPress
workflow. It is not a wrapper around one thing — commands are declared in a registry that
generates `--help`, flag parsing, effect classification and (soon) shell completions from one
definition each, so the surface grows without the tool getting harder to learn.

Three properties hold across every command:

**One local WordPress install, many branches.** A plugin or theme repo can have any number of
git worktrees, but a local WordPress install has exactly one directory slot for it.
`linchpin wt switch` repoints that slot's symlink at the worktree you want, so one install
serves every branch without copying files or re-checking-out.

**Built to be driven by an agent.** Every command is classified `read`, `write` or
`destructive`, takes file paths rather than piped heredocs, emits a JSON envelope on request,
and uses documented exit codes. Claude Code, Codex, Cursor and Conductor can call it without
tripping approval prompts that cannot be permanently allowlisted.

**It never blocks on a prompt nobody can answer.** Interactivity is decided from whether a TTY
is attached, not from whether `CI` is set — because inside an agent `CI` is unset and no stream
is a TTY, which is exactly the combination that makes a naive wizard hang forever.

Deeper background lives in [`docs/`](docs/README.md): [worktrees and the symlink
swap](docs/worktrees.md), [configuration](docs/configuration.md), [hooks](docs/hooks.md),
and [agent integration](docs/agent-integration.md).

## Command surface

```bash
linchpin --help                 # every command, grouped by topic
linchpin <command> --help       # flags, examples and description for one
```

| Command | What it does | Effect |
| --- | --- | --- |
| `wt ls` / `wt current` | List worktrees, or report the active one and its symlink | read |
| `wt switch [ref]` | Repoint the WordPress plugin/theme symlink at a worktree | write |
| `wt new` / `wt get` / `wt extract` | Create a worktree from a new branch, a remote branch, or the current one | write |
| `wt mv` / `wt del` / `wt gone` | Rename, remove, or prune worktrees whose remote branch is gone | destructive |
| `wt cd` / `wt home` | Print a worktree path for `cd "$(…)"` | read |
| `wt use` | Detach the base worktree onto the current worktree's commit | write |
| `wt copy <path>` / `wt link <path>` | Copy or symlink a file from the base worktree into this one | write |
| `wt config init` / `wt config show` | Create or inspect `.linchpin.json` | write / read |
| `wt invoke <hook>` | Run a lifecycle hook by hand | write |
| `shell-init` | Emit the shell wrapper that lets `wt switch` change your directory, and with `--notify` the shell-startup update notice | read |
| `version` | Print the installed version and whether a newer one is published | read |
| `update` | Install the latest published version | write |

The effect column is what each subcommand does to the world — the classification skills use to
decide what an agent may run without asking. `wt` is still registered as a **single
`destructive` passthrough** to the legacy dispatcher, because the safe reading of a group
containing `del` is the most dangerous verb in it; the per-subcommand effects above land as each
one is ported.

`linchpin repo <task>` — connecting a repository to the release infrastructure in one command —
is specified but **not yet built**. See [docs/repo-tasks.md](docs/repo-tasks.md).

## Requirements

- Node.js **22.12+** and npm (the `engines` floor CI tests against).
- `git` **2.37+**, for worktree support.
- A local WordPress environment: [Studio](https://developer.wordpress.com/studio/), `wp-env`,
  or LocalWP.
- Your plugin, theme or `wp-content` repository cloned somewhere stable, e.g.
  `~/Documents/GitHub/<name>`.
- Optional: [`fzf`](https://github.com/junegunn/fzf), which turns the site and worktree pickers
  into fuzzy finders.

## Install

Install it globally — this is a tool you run against many repositories, not a project
dependency.

```bash
npm install -g @linchpinagency/cli      # npm
pnpm add -g @linchpinagency/cli         # pnpm
bun add -g @linchpinagency/cli          # bun
yarn global add @linchpinagency/cli     # yarn 1.x only; yarn 2+ has no global add
```

Verify the install, which is also the fastest way to confirm your `PATH` picked up your package
manager's global bin directory:

```bash
linchpin version
# @linchpinagency/cli 1.1.3
# Up to date (checked just now)
```

If your shell reports `command not found`, the global bin directory is missing from `PATH`.
`npm prefix -g` prints it; add `$(npm prefix -g)/bin` to your shell profile.

### Install the shell wrapper (recommended)

A child process cannot change its parent shell's directory. Without the wrapper, `linchpin wt
switch` repoints the symlink but leaves your shell sitting in the **old** worktree. Add this to
`~/.zshrc`, `~/.bashrc` or `~/.config/fish/config.fish`:

```bash
eval "$(linchpin shell-init --notify)"
```

The shell is detected from `$SHELL`; force one with `linchpin shell-init --shell fish`. If you
would rather not add anything to your profile, wrap the command instead —
`cd "$(linchpin wt switch feature/x)"` — which works because path output goes to stdout while
everything informational goes to stderr.

`--notify` is the second half: it adds a block that tells you at shell startup when a newer
version has been published. Leave it off with a bare `linchpin shell-init` if you only want the
directory wrapper. See [Being told about a new version](#being-told-about-a-new-version).

### Install from source

For contributing, or to run an unreleased branch:

```bash
git clone https://github.com/linchpin/cli.git
cd cli
npm install
npm run build
npm link            # puts this working tree on your PATH as `linchpin`
```

`linchpin version` reports a source install and will tell you to use `git pull` rather than a
package manager. Undo it with `npm unlink -g @linchpinagency/cli`.

## Set up a project

Run this once per repository, from the **base worktree** (the original clone, not a worktree):

```bash
cd ~/Documents/GitHub/my-plugin
linchpin wt config init
```

In a terminal you are walked through five questions, and the answers become `.linchpin.json`:

1. **Agents** — which agent base path(s) you use (Conductor, Claude Code, Codex, or a custom
   path). Pick **several** if you work under more than one, so worktrees are found wherever they
   were created; this is what avoids detached-HEAD surprises when switching between agents. With
   more than one, you also choose a default for new worktrees.
2. **Plugin, theme, or wp-content** — what this repo is. Pre-select it with
   `--type <plugin|theme|wp-content>`. Use `wp-content` when the repo *is* an entire wp-content
   directory, which is common on client projects named after the client.
3. **Slug / symlink name** — the WordPress directory name, defaulting to the repo directory
   name (or `wp-content` for a wp-content project).
4. **Environment(s)** — pick Studio, LocalWP, wp-env or Other. Studio and LocalWP list your
   sites to choose from (`fzf` if installed); wp-env asks for the WordPress root; Other asks for
   a name and a full path.
5. **Default environment** — which one `linchpin wt switch` uses when `--env` is omitted.

Paths are then built for you:

| Environment | Path built |
| --- | --- |
| Studio | `~/Studio/<site>/wp-content/plugins\|themes/<slug>` |
| LocalWP | `~/Local Sites/<site>/app/public/wp-content/plugins\|themes/<slug>` |
| wp-env | `<root you gave>/wp-content/plugins\|themes/<slug>` |

Finally, if the target already exists as a **real directory** rather than a symlink, you are
asked to back it up (`.bkp` suffix), delete it, or skip that environment. Nothing is replaced
silently.

Re-running `config init` on a repo that already has `.linchpin.json` offers **Overwrite**,
**Edit** (keep what is there and add environments), or **Cancel**.

For scripts, CI, or an agent, skip the prompts entirely:

```bash
linchpin wt config init --type plugin --plugin-slug my-plugin --no-interactive
linchpin wt config show          # what the CLI actually resolved
```

## Daily use

```bash
linchpin wt new feature/checkout          # new branch + worktree
linchpin wt get feature/existing         # attach an existing remote branch
cd "$(linchpin wt switch feature/checkout --env studio)"
```

That third line is the whole point: your one WordPress install now loads that worktree. Review
the branch, then move on:

```bash
linchpin wt ls                            # every worktree for this repo
linchpin wt current --link --env studio    # what the symlink points at right now
cd "$(linchpin wt switch)"                # no argument in a TTY: pick from a list
linchpin wt del                           # clean up once the branch is merged
```

With no argument and no TTY, `wt switch` uses the current worktree rather than prompting —
which is what lets an agent call it safely.

Guardrails, so a switch can't quietly eat your work:

- An existing **symlink** target is repointed.
- An existing **real directory** is refused unless you pass `--force`.
- `wt del` refuses a worktree with uncommitted changes or an unmerged branch unless forced.

## Staying up to date

The CLI knows what version it is and whether a newer one has been published.

### Being told about a new version

There are two places a newer version gets announced. Both print the same two lines, both to
**stderr**, and both are off for machine readers.

**After a command you ran.** Automatic, nothing to install:

```
Update available: 1.1.3 → 1.2.0
  Run: linchpin update
```

**When you open a terminal.** Opt in once, by adding `--notify` to the `shell-init` line in your
profile:

```bash
eval "$(linchpin shell-init --notify)"
```

The second one exists because the first only reaches people who are already running the CLI —
the teammate who has not opened it in a fortnight is exactly the one who is out of date and
never hears about it. It is not tied to any particular terminal: Ghostty, Terminal.app, iTerm,
VS Code and the terminal inside Herd all just start your shell.

Four things make both safe to leave on:

- **They cost nothing.** The version is read from a small cache file, never from the network, so
  no command and no shell startup waits on a registry round trip. When the cache is more than 24
  hours old a detached background process refreshes it and exits; nothing blocks on it. The
  startup block is a `test` and a `cat` — about 6ms, against ~35ms if it had to start Node.
- **They never touch stdout.** `cd "$(linchpin wt switch)"` and `eval "$(linchpin shell-init)"`
  keep working, and a `--json` envelope stays the only thing on stdout.
- **Machine readers never see them.** Suppressed in `--json` and `--quiet` mode, in CI, when an
  agent is driving, and — for the startup block — in any non-interactive shell, so a script that
  sources your profile stays clean. An agent that wants the facts asks for them:
  `linchpin version --check --json`.
- **They are two lines, and you can turn them off.** Set `LINCHPIN_NO_UPDATE_NOTIFIER=1` (or the
  conventional `NO_UPDATE_NOTIFIER=1`); both honour it. The notice disappears on its own once
  you update, however you update — `linchpin update` clears it, and so does the next command you
  run after a manual `npm install -g`.

### Asking directly

```bash
linchpin --version           # just the number, for scripts that parse it
linchpin version             # version + cached update state + how it was installed
linchpin version --check     # ask the registry now, then cache the answer
linchpin version --check --json
```

`linchpin version` always exits **0**, including when the registry is unreachable — it is safe
in a shell prompt or a status line. The JSON form carries everything a bug report or an agent
needs:

```json
{
  "version": 1, "ok": true, "command": "version",
  "data": {
    "name": "@linchpinagency/cli",
    "current": "1.1.3",
    "latest": "1.2.0",
    "updateAvailable": true,
    "checkedAt": "2026-08-26T14:17:31.655Z",
    "source": "registry",
    "checkError": null,
    "install": {
      "manager": "npm", "scope": "global",
      "path": "/opt/homebrew/lib/node_modules/@linchpinagency/cli/dist/cli.js",
      "updateCommand": "npm install -g @linchpinagency/cli@latest"
    },
    "cachePath": "/Users/you/.cache/linchpin/update-check.json",
    "node": "24.14.1"
  }
}
```

### Updating

```bash
linchpin update              # install the latest published version
linchpin update --dry-run    # print the command it would run, and stop
linchpin update --check      # read-only; exits 3 if an update is pending
```

`update` works out how *this* copy was installed — from the path it is running from, not a
guess — and runs the matching command, so a pnpm or bun install is never handed an
`npm install -g` that would leave two copies shadowing each other:

| How it was installed | What `linchpin update` runs |
| --- | --- |
| npm, global | `npm install -g @linchpinagency/cli@latest` |
| npm, project-local | `npm install @linchpinagency/cli@latest` |
| pnpm | `pnpm add -g @linchpinagency/cli@latest` |
| bun | `bun add -g @linchpinagency/cli@latest` |
| yarn 1.x | `yarn global add @linchpinagency/cli@latest` |
| `npx` | Nothing — each run already fetches the latest |
| source checkout / `npm link` | Nothing. It tells you to `git pull && npm install && npm run build` |

`--check` exits **3** ("precondition not met") when an update is pending and **0** when there is
nothing to do, so it can gate a job without any parsing:

```bash
linchpin update --check || echo "CLI is behind — releasing with an old toolchain"
```

### Environment variables

| Variable | Effect |
| --- | --- |
| `LINCHPIN_NO_UPDATE_NOTIFIER` / `NO_UPDATE_NOTIFIER` | Never print the update notice, after a command or at shell startup. `0` and `false` mean *not* set |
| `LINCHPIN_REGISTRY` | Registry to check, for a mirror or an air-gapped network. Falls back to `npm_config_registry`, then npmjs.org |
| `LINCHPIN_CACHE_DIR` | Where the update-check cache and the pre-rendered startup notice live. Defaults to `$XDG_CACHE_HOME/linchpin`, then `~/.cache/linchpin`. Set at runtime it also overrides the path baked into the `shell-init --notify` block |
| `LINCHPIN_OUTPUT` | `json`, `quiet`, `human` — set the output mode once instead of per call |
| `NO_COLOR` / `FORCE_COLOR` | Standard colour control |

## Uninstall

Remove the binary with whichever package manager installed it — `linchpin version` names it
under `install.manager` if you are unsure:

```bash
npm uninstall -g @linchpinagency/cli
pnpm remove -g @linchpinagency/cli
bun remove -g @linchpinagency/cli
yarn global remove @linchpinagency/cli
npm unlink -g @linchpinagency/cli       # a source install made with npm link
```

Then clean up the two things that live outside the package. First the update-check cache —
`linchpin version --json` reports its exact location as `cachePath`, and by default it is:

```bash
rm -rf ~/.cache/linchpin
```

Second, delete the `eval "$(linchpin shell-init --notify)"` line from your shell profile, or
every new shell will print `command not found`.

Nothing else is left behind. In particular:

- **`.linchpin.json` and `.linchpin/hooks/` are project files**, committed to the repository and
  shared with your team. Uninstalling the CLI does not touch them, and it should not — a
  teammate still needs them.
- **Your worktrees and symlinks are untouched.** They are plain git worktrees and plain
  symlinks; the CLI only ever pointed them at each other. Remove worktrees with
  `git worktree remove` (or `linchpin wt del` before uninstalling) and delete a symlinked plugin
  slot with `rm` — you are deleting a link, not your code.

## Configuration

`.linchpin.json` lives in the base repository root. `linchpin wt config init` writes it; this is
what it writes. Full reference in [docs/configuration.md](docs/configuration.md).

```json
{
  "agents": {
    "codex": "~/Documents/GitHub",
    "conductor": "~/conductor"
  },
  "defaultAgent": "codex",
  "wordpress": {
    "contentType": "plugin",
    "pluginSlug": "my-plugin",
    "defaultEnvironment": "studio",
    "environments": {
      "studio": "/Users/you/Studio/mysite/wp-content/plugins/my-plugin",
      "localwp": "/Users/you/Local Sites/mysite/app/public/wp-content/plugins/my-plugin"
    }
  }
}
```

A repo that is an entire wp-content directory, under a name that is not `wp-content`:

```json
{
  "wordpress": {
    "contentType": "wp-content",
    "symlinkName": "client-wp-content",
    "defaultEnvironment": "localwp",
    "environments": {
      "localwp": "/Users/you/Local Sites/site/app/public/client-wp-content"
    }
  }
}
```

Notes that save an afternoon:

- **One agent or many.** A single agent uses `agent` plus an optional `agentBasePath`; several
  use `agents` (name → base path) plus an optional `defaultAgent`. Defaults: Conductor
  `~/conductor`, Claude Code `~/Documents`, Codex `~/Documents/GitHub`. With several configured,
  every path is searched, so the right base repo is found no matter which agent made the
  worktree.
- `defaultEnvironment` may be omitted; the first environment key wins.
- `~` is expanded. Anything else should be absolute.

## Hooks

Twelve lifecycle points let a project run its own build, cache flush or fixup around each
operation. A hook is a file at `.linchpin/hooks/<name>`, **sourced** in a subshell with the
worktree as the working directory:

`pre-switch` · `post-switch` · `pre-new` · `post-new` · `pre-get` · `post-get` ·
`pre-extract` · `post-extract` · `pre-mv` · `post-mv` · `pre-del` · `post-del`

```bash
# .linchpin/hooks/post-switch — rebuild whatever the new branch needs
composer install
npm install && npm run build
```

`LINCHPIN_BRANCH` and `LINCHPIN_WORKTREE` are always set; switch hooks also get
`LINCHPIN_ENVIRONMENT`. Run one by hand with `linchpin wt invoke post-switch`. Details and the
full environment contract: [docs/hooks.md](docs/hooks.md).

## Agents, output modes and exit codes

Mode is decided once at startup: an explicit `--json` / `--plain` / `--quiet` flag, then
`LINCHPIN_OUTPUT`, then whether stdout is a TTY. Warnings and notices always go to stderr so
stdout stays parseable.

```bash
linchpin wt ls --json
linchpin version --check --json
```

In `--json` mode stdout carries exactly one envelope and stderr stays empty — including on
failure, which is precisely when structured output matters most. `changed` distinguishes a real
mutation from a no-op.

```json
{"version":1,"ok":true,"command":"wt switch","changed":true,"data":{"branch":"feature-b"}}
```

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Unexpected error |
| 2 | Validation or usage error |
| 3 | Precondition not met |
| 4 | Authentication required or rejected |
| 5 | Refused by a safety check |

⚠️ **`CI` is unset inside Claude Code while no stream is a TTY.** Anything that gates prompting
on a CI check alone classifies an agent as interactive and blocks forever. The non-TTY check is
the safety net. More on why this shapes the whole design:
[docs/agent-integration.md](docs/agent-integration.md).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `command not found: linchpin` | The global bin dir is not on `PATH`. Add `$(npm prefix -g)/bin` |
| `Missing .linchpin.json` | Run `linchpin wt config init` in the **base** worktree, not a worktree |
| `Environment '<name>' is not configured` | Add the key under `wordpress.environments`, or pass `--env` with one that exists |
| `Target exists and is not a symlink` | A real directory is in the plugin slot. Back it up, or pass `--force` if replacing it is intended |
| `Worktree has uncommitted changes` on delete | Commit or stash first, or `linchpin wt del --force` |
| `fzf is not installed` | Install `fzf`, or pass a branch or path directly: `linchpin wt cd <ref>` |
| Your shell stays in the old worktree after a switch | Install the wrapper: `eval "$(linchpin shell-init)"`, or use `cd "$(linchpin wt switch …)"` |
| Update notice will not go away | You are on an older version. `linchpin update`, or silence it with `LINCHPIN_NO_UPDATE_NOTIFIER=1` |
| `Could not reach the npm registry` | Offline, or behind a mirror. Set `LINCHPIN_REGISTRY` |

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsdown -> dist/
npm test            # builds first, then node --test
```

TypeScript and ESM, built with [tsdown](https://tsdown.dev). Every runtime dependency lives in
`devDependencies` and is bundled into `dist/`, so the published package installs with **zero
transitive dependencies**. Un-ported CommonJS still lives in `legacy/`, which carries its own
`package.json` declaring `"type": "commonjs"`; it is being drained into `src/` command by
command.

Adding a command means adding one `defineCommand()` definition — flags come from its Zod schema,
help grouping from `meta.group`, examples from `meta.examples`, and its `effect` classification
from `read` / `write` / `destructive`. Nothing is hand-wired twice.

The test suite never reaches the network: the update checker is exercised against a local
registry stub, and the shared fixture sets `LINCHPIN_NO_UPDATE_NOTIFIER` so no test can be
perturbed by a real release.

Husky enforces Conventional Commits on `commit-msg` (`npm run prepare` installs it):

```text
feat(LINCHPIN-4850): add release automation
```

### Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`: typecheck, build
and tests across Node **22.12** (the `engines` floor) and **24**.

It also gates on **agent-readiness** using
[`cli-agent-lint`](https://github.com/Camil-H/cli-agent-lint), which grades a CLI A–F across 34
checks covering flow safety, token efficiency, self-description, automation safety and
predictability. CI fails if the score drops below a recorded floor, and the floor rises whenever
the score does, so a gain can't be given back silently.

| Recorded | Score | Where | What moved |
| --- | --- | --- | --- |
| 2026-08-06 | 77.2% (B) | local | Baseline, pre-rewrite surface |
| 2026-08-06 | 80.7% (B) | local | Command registry — usage examples in help, actionable errors, control characters rejected in argv |
| 2026-08-06 | **84.7% (B)** | **CI** | Dual-mode contract — `--json`, `--quiet`, `--no-color`, documented exit codes |

⚠️ **Record the number CI reports, not a local run.** SD-5 (skill / context files) passes on a
workstation off an untracked, gitignored `.claude/` directory that doesn't exist in a clean
checkout, so local runs read roughly 1.7 points high.

Still outstanding: shell completions and schema introspection (SD-3/SD-4), env-var auth (FS-4,
arrives with `linchpin task`), skill/context files (SD-5, arrives with the bundled skills), and
a `--timeout` flag (PV-1).

One check stays a warning **on purpose**. SD-1 wants errors to be JSON on stderr by default;
this CLI is human-readable by default and structured only when asked (`--json`), matching `gh`
and `wrangler`.

## Releases

Releases are managed by `release-please` in GitHub Actions:

1. Pushes to `main` run `.github/workflows/release-please.yml`.
2. `release-please` opens or updates a release PR from the conventional commits since the last
   release.
3. Merging that PR creates the GitHub release and tag.
4. The `publish-npm` job then builds, tests and publishes to npm with provenance.

Step 4 authenticates with the `NPM_TOKEN` repository secret, and that token needs write access
to the **whole `@linchpinagency` scope** — a granular npm token only ever covers packages that
existed when it was created, so one minted before a package's first publish cannot publish it.
npm answers an unauthorized write with `404`, not `403`, so the symptom is a confusing
`E404 … PUT https://registry.npmjs.org/@linchpinagency%2fcli`, not a permission error. The job
verifies the credential before building so that failure names its own cause.

A publish that failed for a credential reason needs no new release: fix the token and re-run the
`publish-npm` job on the existing tag.

![Linchpin an award winning digital agency building immersive, high performing web experiences](https://assets.linchpin.com/github/linchpin-github-repo-banner.jpg)
