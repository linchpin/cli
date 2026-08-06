<table width="100%">
  <tr>
    <td align="left" width="70%">
      <strong>Linchpin CLI</strong><br />
      Git worktree tooling for WordPress plugin review workflows with Codex, Claude Code, Cursor, Conductor and other agents.
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

## What is this CLI?

`linchpin wt` is a git worktree helper tuned for WordPress plugin development alongside Agent support to help easily swap Symlinks between your local environment and worktrees created by you or agents.

It is designed for this setup:

- Plugin repository in `~/Documents/GitHub/<plugin-name>`.
- Multiple git worktrees created by Codex or other agents.
- A shared local WordPress environment (Studio, `wp-env`, or LocalWP).
- A plugin directory in that environment that should point to a specific worktree via symlink.

### Why symlinks? Why isn’t the repo checked out directly in my environment?

Your plugin repo is **not** checked out directly into Studio, LocalWP, or wp-env on purpose. The workflow relies on **symlinks** so you can **swap** which worktree (branch) the environment sees:

- The repo lives in its own directory (e.g. `~/Documents/GitHub/my-plugin`) with multiple [git worktrees](https://git-scm.com/docs/git-worktree) (e.g. `main`, `conductor/a`, `feature/b`).
- The WordPress environment has **one** plugin (or theme) slot (e.g. `~/Studio/mysite/wp-content/plugins/my-plugin`). That slot is a **symlink** pointing at one of the worktree paths.
- When you run `linchpin wt switch <branch>` (or pick from the list), we repoint that symlink to the chosen worktree. This allows for our local environment to use an already checked out worktree with out any errors. 

So you keep a single WordPress install and switch which worktree it uses by changing the symlink target.

## Should you use this?

Use this CLI if you already like `git worktree` but need WordPress-specific environment switching.

This project does **not** replace git worktrees. It adds a WordPress workflow layer on top of them:

- Store plugin/theme target paths per local environment (`Studio`, `LocalWP`, `wp-env`, custom).
- Repoint one plugin/theme symlink to a different worktree with one command.
- Add safety checks around symlink replacement and worktree deletion.
- Keep one local WordPress install while reviewing many branches/worktrees.

You probably **do not** need this if:

- You only need `git worktree add/list/remove`.
- You do not use a shared local WordPress environment.
- You are fine managing symlink paths and switching manually.

## `linchpin wt` vs plain `git worktree`

| Need | Plain `git worktree` | `linchpin wt` |
|---|---|---|
| Create/list/remove worktrees | Yes (`git worktree ...`) | Yes (wrapper commands: `new`, `ls`, `del`, `get`) |
| Switch which branch your WordPress site loads | Manual symlink edits | Built-in: `linchpin wt switch [branch] --env <name>` |
| Save WordPress environment paths for team use | No | Yes (`linchpin wt config init` + `.linchpin.json`) |
| Guardrails for WP plugin/theme symlink targets | No | Yes (blocks non-symlink target replacement unless `--force`) |
| Interactive worktree picker for switching | No | Yes (TTY picker + optional `fzf` for `cd`) |

If your pain is "I can create worktrees, but switching my WordPress site between them is manual and error-prone," this tool is the fit.

## Install

```bash
npm install -g @linchpinagency/cli
```

For local development in this repository:

```bash
npm link
```

## Team setup guide

### 1. Prerequisites

- `git` 2.37+ (worktree support).
- Node.js `22.12+` and `npm`.
- Optional: `fzf` for interactive `linchpin wt cd`.
- A local WordPress environment (Studio, `wp-env`, or LocalWP).
- Your plugin repository cloned under `~/Documents/GitHub/<plugin-name>`.

### 2. Install CLI

```bash
npm install -g @linchpinagency/cli
```

Confirm install:

```bash
linchpin --help
linchpin wt help
```

### 3. Initialize project config

From the plugin or theme repo root (base worktree), run:

```bash
linchpin wt config init
```

When run in an interactive terminal, you're guided through:

1. **Agents** – Which agent base path(s) you use (Conductor, Claude Code, Codex, and/or Custom Path). You can select **multiple agents** so worktrees are found whether you're under Codex, Conductor, or another path — this avoids detached-HEAD issues when switching between agents. If you pick more than one, you choose a **default agent** for new worktrees.
2. **Plugin, theme, or wp-content** – Whether this repo is a WordPress plugin, theme, or a full wp-content project (the entire wp-content folder is the repo). You can pre-select this with `--type <plugin|theme|wp-content>`.
3. **Slug / symlink name** – For plugins and themes, the WordPress directory name (defaults to the repo directory name). For wp-content projects, the symlink name (defaults to `wp-content`) — useful when your repo has a client name instead of `wp-content`.
4. **Environment(s)** – For each environment: **Environment type** (Studio, LocalWP, wp-env, or Other), which sets the base folder; then for Studio/LocalWP you **pick a site** from that base (list or `fzf` if installed), or for wp-env you enter the WordPress root path; for Other you enter name and full path.
5. Choose the **default environment** for `linchpin wt switch`.

This creates `.linchpin.json`. You can edit it later if paths or environments change.

6. **Create initial symlink(s)** – If the target already exists as a real folder (not a symlink), you're prompted to **back it up** (rename with `.bkp` suffix), **delete** it (with confirmation), or **skip** that environment.

If `.linchpin.json` already exists, the flow offers **Overwrite**, **Edit** (keep existing and add more environments), or **Cancel**.

For scripts or CI (no TTY), use non-interactive mode so a default template is written without prompts:

```bash
linchpin wt config init --type <plugin|theme|wp-content> [--plugin-slug <slug>] [--force] [--no-interactive]
```

Use `--type wp-content` when your repo represents an entire wp-content folder (common for client projects where the repo is named after the client, not `wp-content`). Use `--force` to overwrite an existing `.linchpin.json` without prompting. Use `--no-interactive` to skip prompts even when running in a terminal.

### 4. Paths built by config init

For Studio and LocalWP, paths are built from the environment type and the site you pick:

- **Studio**: `~/Studio/<site>/wp-content/plugins|themes/<slug>` (or `~/Studio/<site>/wp-content` for wp-content projects)
- **LocalWP**: `~/Local Sites/<site>/app/public/wp-content/plugins|themes/<slug>` (or `…/wp-content` for wp-content projects)
- **wp-env**: You provide the WordPress root; the CLI appends `wp-content/plugins|themes/<slug>` (or `wp-content` for wp-content projects).

Use absolute paths in `.linchpin.json` if you edit by hand. `~` is supported.

### 5. Create and switch worktrees

Create a worktree for a new branch:

```bash
linchpin wt new feature/my-change
```

Or attach an existing remote branch:

```bash
linchpin wt get feature/existing-branch
```

Point your WordPress environment to that worktree:

```bash
linchpin wt switch feature/my-change --env studio
```

### 6. Verify active target

Check current worktree metadata:

```bash
linchpin wt current --link --env studio
```

List all worktrees:

```bash
linchpin wt ls
```

### 7. Daily review workflow

1. Open or create a worktree for the branch under review.
2. Run `linchpin wt switch --env <environment>` to repoint the plugin symlink.
3. Test the branch in the shared WordPress install.
4. Repeat for the next worktree/branch.
5. Clean up with `linchpin wt del` when the branch is merged.

### 8. Switch and cd in one step

After `wt switch` repoints a symlink your shell is still in the **old** worktree. Wrap the command in `cd` to land in the new target automatically:

```bash
cd "$(linchpin wt switch feature/my-change)"
cd "$(linchpin wt switch)"                     # interactive picker
cd "$(linchpin wt switch --env localwp)"       # specific environment
```

When piped (wrapped in `$()`), informational output goes to stderr so you still see it, while stdout carries the symlink path for `cd`.

**Optional: fully automatic with shell-init**

If you prefer `linchpin wt switch` to handle the `cd` for you every time, add this to your shell profile (`~/.zshrc`, `~/.bashrc`, or `~/.config/fish/config.fish`):

```bash
eval "$(linchpin shell-init)"
```

This defines a thin wrapper that re-enters your current directory after a successful switch, so the shell picks up the repointed symlink. The shell is auto-detected from `$SHELL`. To force a specific shell: `eval "$(linchpin shell-init --shell zsh)"`.

### 9. Path helpers

Use command substitution for other path-returning commands:

```bash
cd "$(linchpin wt cd)"
cd "$(linchpin wt home)"
```

### 10. Troubleshooting

- `Missing .linchpin.json`:
  Run `linchpin wt config init` in the base worktree (interactive prompts) or `linchpin wt config init --type plugin --plugin-slug <slug> --no-interactive` for a default file.
- `Environment '<name>' is not configured`:
  Add the environment key in `.linchpin.json`.
- `Target exists and is not a symlink`:
  Use `linchpin wt switch ... --force` only if replacing the directory is intended.
- `Worktree has uncommitted changes` on delete:
  Commit/stash first, or force with `linchpin wt del --force`.
- `fzf is not installed`:
  Install `fzf` or pass a branch/path directly to `linchpin wt cd <ref>`.

## Command surface

```bash
linchpin shell-init [--shell bash|zsh|fish]

linchpin wt ls [--json]
linchpin wt current [--link] [--env <name>]
linchpin wt switch [worktree|branch] [--env <name>] [--force] [--dry-run]
  # No argument in a TTY: interactive picker from available worktrees. Non-interactive: use current worktree.
  # When piped, outputs the symlink target path for cd: cd "$(linchpin wt switch ...)"

linchpin wt new [name]
linchpin wt get <branch>
linchpin wt extract
linchpin wt mv <new-branch-name>
linchpin wt del [-f|--force]
linchpin wt cd [branch|path]
linchpin wt home
linchpin wt use
linchpin wt gone
linchpin wt copy <path>
linchpin wt link <path>
linchpin wt invoke <hook>

linchpin wt config init [--type <plugin|theme|wp-content>] [--plugin-slug <slug>] [--force] [--no-interactive]
linchpin wt config show
```

Shell usage notes:

- `linchpin wt cd` and `linchpin wt home` return paths for command substitution.
- Use `cd "$(linchpin wt cd)"` and `cd "$(linchpin wt home)"`.
- `linchpin wt cd` uses `fzf` when no argument is provided.

## Configuration

Create `.linchpin.json` in the base repository root. The easiest way is to run `linchpin wt config init` in a terminal and follow the prompts. You can also create or edit the file manually:

Plugin/theme project:

```json
{
  "agent": "conductor",
  "agentBasePath": "/Users/you/conductor",
  "wordpress": {
    "contentType": "plugin",
    "pluginSlug": "my-plugin",
    "defaultEnvironment": "studio",
    "environments": {
      "studio": "/Users/you/Sites/studio/wp-content/plugins/my-plugin",
      "wp-env": "/Users/you/Documents/projects/site/.wp-env/.../plugins/my-plugin",
      "localwp": "/Users/you/Local Sites/site/app/public/wp-content/plugins/my-plugin"
    }
  }
}
```

WP-content project (repo is the entire wp-content folder):

```json
{
  "agent": "conductor",
  "wordpress": {
    "contentType": "wp-content",
    "defaultEnvironment": "localwp",
    "environments": {
      "localwp": "/Users/you/Local Sites/site/app/public/wp-content"
    }
  }
}
```

Multi-agent (Codex and Conductor, etc.) — we look for worktrees in all listed paths:

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
      "studio": "/Users/you/Sites/studio/wp-content/plugins/my-plugin"
    }
  }
}
```

If the repo uses a custom symlink name (e.g. the repo is named after the client), add `"symlinkName"`:

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

Behavior notes:

- **Agent / base path**: You can use a single agent or **multiple agents**. Single-agent config uses `agent` (Conductor, Claude Code, Codex, or Custom Path) and optional `agentBasePath`. Multi-agent config uses `agents` (object of name → base path) and optional `defaultAgent`. Default base paths: Conductor `~/conductor`, Claude Code `~/Documents`, Codex `~/Documents/GitHub`. For Custom Path you’re prompted for a base path during `config init`. When you use multiple agents (e.g. Codex for some work and Conductor for another), we look for worktrees in all configured paths so the correct main repo is found and detached-HEAD issues are avoided.
- If `defaultEnvironment` is omitted, the first environment key is used.
- `~` is supported in configured paths.
- `linchpin wt switch` without a worktree argument: in an interactive terminal you get a **picker** of available worktrees; in non-interactive use it uses the current worktree.

## Hooks

Hook files are sourced in a subshell when present:

- `.linchpin/hooks/<hook-name>`

Supported lifecycle hooks:

- `pre-switch`, `post-switch`
- `pre-new`, `post-new`
- `pre-get`, `post-get`
- `pre-extract`, `post-extract`
- `pre-mv`, `post-mv`
- `pre-del`, `post-del`

Manual invocation:

```bash
linchpin wt invoke pre-new
linchpin wt invoke post-switch
```

Hook environment variables include `LINCHPIN_BRANCH`, `LINCHPIN_WORKTREE`, and for switch hooks `LINCHPIN_ENVIRONMENT`.

To run commands after switching worktrees (e.g. `composer install`, `npm run build`), create `.linchpin/hooks/post-switch`. The hook runs with the worktree as the current directory:

```bash
#!/bin/bash
composer install
npm install && npm run build
```

## Typical WordPress review flow

1. Open a plugin worktree.
2. Run `cd "$(linchpin wt switch --env studio)"` to repoint the symlink and land in the new target.
3. Use your existing WordPress environment to review that branch.
4. Move to another worktree and switch again.

## Safety behavior

- Existing symlink targets are repointed safely.
- Existing non-symlink targets are blocked unless `--force` is used.
- `linchpin wt del` blocks dirty or unmerged branches unless forced.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsdown -> dist/
npm test            # builds first, then node --test
```

The CLI is TypeScript and ESM, built with [tsdown](https://tsdown.dev). Every runtime
dependency lives in `devDependencies` and is bundled into `dist/`, so the published package
installs with **zero transitive dependencies**. Un-ported CommonJS still lives in `legacy/`,
which carries its own `package.json` declaring `"type": "commonjs"`; it is being drained into
`src/` command by command.

Husky enforces Conventional Commits on `commit-msg`:

```bash
npm run prepare
```

Example commit format:

```text
feat(LINCHPIN-4850): add release automation
```

### Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`: typecheck,
build and tests across Node **22.12** (the `engines` floor) and **24**.

It also gates on **agent-readiness** using
[`cli-agent-lint`](https://github.com/Camil-H/cli-agent-lint), which grades a CLI A–F across
34 checks covering flow safety, token efficiency, self-description, automation safety and
predictability.

**Baseline recorded 2026-08-06, before the command-registry rewrite: 77.2%, grade B** — 24
pass, 8 needing attention. CI fails if the score drops below that floor. The floor is meant
to rise: the outstanding checks are `--json` output (TE-1), `--no-color` and `--quiet`
(TE-3/TE-4), shell completions and schema introspection (SD-3/SD-4), usage examples in help
(SD-6), a `--timeout` flag (PV-1), and documented distinct exit codes (PV-4).

## Releases

Releases are managed by `release-please` in GitHub Actions:

- Pushes to `main` run `.github/workflows/release-please.yml`.
- `release-please` opens/updates a release PR from conventional commits.
- When the release PR is merged, a GitHub release/tag is created.
- If a release is created, the workflow publishes `@linchpinagency/cli` to npm.

![Linchpin an award winning digital agency building immersive, high performing web experiences](https://assets.linchpin.com/github/linchpin-github-repo-banner.jpg)
