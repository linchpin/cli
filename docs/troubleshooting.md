# Troubleshooting

Every symptom below is an error string that exists in the source, a guardrail that refuses on
purpose, or a behaviour people reliably misread. Each one is paired with the check that
confirms it and the safe way out.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/troubleshooter",
  "attrs": {
    "title": "Start here",
    "intro": "Three questions that separate the four things that actually go wrong.",
    "startId": "found",
    "questions": [
      {
        "id": "found",
        "question": "Does your shell find the linchpin command at all?",
        "yesLabel": "Yes, it runs",
        "yesNext": "config",
        "noLabel": "command not found",
        "noNext": "path"
      },
      {
        "id": "config",
        "question": "Does linchpin wt config show print your configuration?",
        "yesLabel": "Yes, it prints JSON",
        "yesNext": "switch",
        "noLabel": "No, it errors",
        "noNext": "noconfig"
      },
      {
        "id": "switch",
        "question": "Does the site load the worktree you switched to?",
        "yesLabel": "Yes",
        "yesNext": "fine",
        "noLabel": "No, it is serving the old one",
        "noNext": "stale"
      }
    ],
    "outcomes": [
      {
        "id": "path",
        "status": "warning",
        "title": "The global bin directory is not on PATH",
        "content": "<p>Run <code>npm prefix -g</code> and add its <code>bin</code> subdirectory to your shell profile. See <em>command not found</em> below.</p>"
      },
      {
        "id": "noconfig",
        "status": "warning",
        "title": "This repository has no .linchpin.json yet",
        "content": "<p>Run <code>linchpin wt config init</code> from the <strong>base</strong> worktree, not from a linked one.</p>"
      },
      {
        "id": "stale",
        "status": "neutral",
        "title": "The symlink moved but something else is holding the old files",
        "content": "<p>Confirm the link with <code>linchpin wt current --link</code>, then look at your shell's working directory and any PHP opcode or object cache. See <em>the site still serves the old branch</em> below.</p>"
      },
      {
        "id": "fine",
        "status": "success",
        "title": "The mechanic is working",
        "content": "<p>Whatever is wrong is more specific than setup. Find the exact error message in the sections below.</p>"
      }
    ],
    "showProgress": true
  }
}
-->
## Start here

Three questions that separate the four things that actually go wrong.

- **Does your shell find the linchpin command at all?** — Yes, it runs / command not found
- **Does linchpin wt config show print your configuration?** — Yes, it prints JSON / No, it errors
- **Does the site load the worktree you switched to?** — Yes / No, it is serving the old one

### The global bin directory is not on PATH

Run `npm prefix -g` and add its `bin` subdirectory to your shell profile. See _command not found_ below.

### This repository has no .linchpin.json yet

Run `linchpin wt config init` from the **base** worktree, not from a linked one.

### The symlink moved but something else is holding the old files

Confirm the link with `linchpin wt current --link`, then look at your shell's working directory and any PHP opcode or object cache. See _the site still serves the old branch_ below.

### The mechanic is working

Whatever is wrong is more specific than setup. Find the exact error message in the sections below.
<!-- /docspress:block -->

## Install and PATH

### `command not found: linchpin`

The package installed, but its global bin directory is not on `PATH`.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/terminal-session",
  "attrs": {
    "title": "Find the directory your package manager installs into",
    "shell": "bash",
    "prompt": "$",
    "command": "npm prefix -g",
    "output": "/opt/homebrew"
  }
}
-->
#### Find the directory your package manager installs into

```bash
$ npm prefix -g
```

**Output**

```text
/opt/homebrew
```
<!-- /docspress:block -->

Add `$(npm prefix -g)/bin` to `PATH` in your shell profile. If you installed with pnpm, bun or
yarn, ask that tool for its own global bin directory instead.

### Every new shell prints `command not found`

You removed the package but left `eval "$(linchpin shell-init --notify)"` in your profile.
Delete that line. The notice block itself is harmless once the binary is gone — it checks
`PATH` and returns — but the `eval` around it still runs.

## Configuration

### `Missing .linchpin.json at <path>. Run 'linchpin wt config init' to create one.`

No configuration in the base repository. Run the wizard from the **base** worktree — the
original clone, not a `@branch` sibling:

```bash
cd ~/GitHub/my-plugin
linchpin wt config init
```

For a script or an agent, skip the prompts entirely:

```bash
linchpin wt config init --type plugin --plugin-slug my-plugin --no-interactive
```

### `Environment '<name>' is not configured. Available: …`

The `--env` you passed, or `wordpress.defaultEnvironment`, names a key that is not under
`wordpress.environments`. The message lists the keys that do exist. `linchpin wt config show`
prints the resolved configuration, which is the version the CLI is actually reading.

### `.linchpin.json already exists. Use --force to overwrite it.`

Non-interactive `config init` will not clobber a committed team file. Pass `--force` if you
mean to replace it, or run it in a terminal, where you are offered **Overwrite**, **Edit** or
**Cancel** instead.

### `Config is missing wordpress.environments.`

Raised only by the commands that genuinely need a WordPress environment. A repository with no
`wordpress` block at all is a normal state, not a misconfiguration — everything that does not
touch a WordPress install works without one.

## The symlink swap

### `Target exists and is not a symlink: <path>. Re-run with --force to replace it.`

A real directory occupies the plugin or theme slot. That directory may be the only copy of
something, so it is never replaced silently.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/flow",
  "attrs": {
    "start": 1,
    "steps": [
      {
        "title": "Look at what is actually there",
        "content": "<p><code>ls -la</code> the parent directory. A symlink shows an arrow; a real directory does not.</p>"
      },
      {
        "title": "Decide whether it is worth keeping",
        "content": "<p>If it holds uncommitted work, move it aside yourself before going further. The setup wizard offers a <code>.bkp</code> rename for exactly this, and refuses to overwrite an existing <code>.bkp</code>.</p>"
      },
      {
        "title": "Replace it deliberately",
        "content": "<p>Re-run with <code>--force</code>. Without a TTY you must add <code>--yes</code> as well, or the command refuses rather than assuming consent.</p>"
      }
    ]
  }
}
-->
1. **Look at what is actually there**

   `ls -la` the parent directory. A symlink shows an arrow; a real directory does not.

2. **Decide whether it is worth keeping**

   If it holds uncommitted work, move it aside yourself before going further. The setup wizard offers a `.bkp` rename for exactly this, and refuses to overwrite an existing `.bkp`.

3. **Replace it deliberately**

   Re-run with `--force`. Without a TTY you must add `--yes` as well, or the command refuses rather than assuming consent.
<!-- /docspress:block -->

### `Refusing to replace <path> without confirmation. Re-run with --yes if you intend to delete it.`

`--force` was passed with no terminal attached. Deleting a directory named by a committed
config file is not something to infer from silence, so the non-interactive path refuses
instead of assuming. `--yes` is the explicit, scriptable answer.

### `Refusing to delete <path>: it is not inside a WordPress content directory.`

A second guard behind `--force`. The path came from `.linchpin.json`, which the repository
controls, so its shape is checked before any recursive delete. A target qualifies only if some
segment is `wp-content`, or its parent directory is `plugins`, `themes` or `mu-plugins`.

Seeing this means an environment path is wrong. Fix `wordpress.environments` rather than
looking for a way around the check.

### The site still serves the old branch

Confirm where the link actually points first:

```bash
linchpin wt current --link --env studio
```

If `linkPath` is right and WordPress still disagrees, the CLI is done and something downstream
is holding the old files — an opcode cache, a persistent object cache, or a dev server that
resolved the real path at boot. If `linkPath` is wrong, the switch did not target the
environment you assumed; pass `--env` explicitly.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/callout",
  "attrs": {
    "tone": "tip",
    "title": "Your shell is a separate problem from your site",
    "content": "<p>A switch repoints the symlink, but a child process cannot move its parent shell. If your terminal is still sitting in the old worktree, install the wrapper with <code>eval \"$(linchpin shell-init)\"</code>, or wrap the call as <code>cd \"$(linchpin wt switch feature/x)\"</code>. The site was probably right all along.</p>",
    "collapsible": false
  }
}
-->
> [!TIP]
>
> **Your shell is a separate problem from your site**
>
> A switch repoints the symlink, but a child process cannot move its parent shell. If your terminal is still sitting in the old worktree, install the wrapper with `eval "$(linchpin shell-init)"`, or wrap the call as `cd "$(linchpin wt switch feature/x)"`. The site was probably right all along.
<!-- /docspress:block -->

## Worktrees

### `Worktree has uncommitted changes. Re-run with --force.`

`wt del` will not throw away work. Commit or stash first. `--force` also switches the branch
delete from `git branch -d` to `-D`, so it discards an unmerged branch too.

### `Branch '<name>' is not merged into <remote head>. Re-run with --force.`

The second half of the same guard. The branch has commits that are not in the remote head, so
deleting it would lose them.

### `This command must be run inside a linked worktree (not base).`

`mv`, `del`, `use`, `copy` and `link` all act on the worktree you are standing in, so running
them from the base repository is meaningless. `cd "$(linchpin wt cd <branch>)"` first.

### `Extract must be run from the base worktree.`

The mirror image. `wt extract` moves the branch you have checked out in the base repo into its
own worktree, so it has to start from the base.

### `Worktree path already exists: <path>`

A directory is already sitting where the new worktree would go. Either it is a worktree git
has forgotten (`git worktree prune`), or it is unrelated and needs a different branch name.

### `Remote branch origin/<name> does not exist.`

`wt get` attaches an existing remote branch and fetches before checking, so this means the
branch genuinely is not on the remote. `wt new <name>` creates one instead.

### `Current directory is not an active git worktree: <path>`

Usually an agent moved or archived the worktree underneath you. The CLI already tries three
ways to find the repository — the current directory, the base inferred by stripping the
`@branch` suffix, and the repo named by the worktree id in the worktree's own `.git` file. If
all three miss, `cd "$(linchpin wt home)"` from anywhere inside the base repo.

If you work under more than one agent root, list them all under `agents` in
[`.linchpin.json`](configuration.md) so each is searched.

### `fzf is not installed. Provide a reference: linchpin wt cd <branch|path>`

`wt cd` with no argument opens a fuzzy picker. Install `fzf`, or name the target directly.

## Hooks

### A hook did not run, and stderr says `Blocked untrusted hook`

Working as designed. `.linchpin/hooks/` is committed, so hooks arrive with a clone, and they
are *sourced* — no execute bit, no shebang, nothing in a diff marking the file as code that
will run. Nothing runs until this machine has approved those exact bytes.

```bash
linchpin wt trust                       # list every hook and its state
linchpin wt trust post-switch           # approve one, after reading it
```

Trust is recorded against a hash of the contents, so editing a trusted hook withdraws its
trust automatically. Pulling a branch that changes a hook you approved last week does not
inherit that approval.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/callout",
  "attrs": {
    "tone": "danger",
    "title": "Read the hook before you trust it",
    "content": "<p>Trusting a hook means agreeing to run whatever it contains, with your full environment and privileges, every time that operation happens. <code>--all</code> approves every hook in the repository at once; use it only on a repository whose hooks you have actually read.</p>",
    "collapsible": false
  }
}
-->
> [!CAUTION]
>
> **Read the hook before you trust it**
>
> Trusting a hook means agreeing to run whatever it contains, with your full environment and privileges, every time that operation happens. `--all` approves every hook in the repository at once; use it only on a repository whose hooks you have actually read.
<!-- /docspress:block -->

### `Hook '<name>' does not exist in .linchpin/hooks.`

Either the file is genuinely absent, or the name resolved outside the hooks directory. A name
that escapes through `../`, and a symlink pointing out of the directory, are both refused — and
from the caller's side both read as "no such hook".

### A hook ran and the whole operation failed

Deliberate. A `pre-switch` that cannot prepare the environment should stop the switch rather
than let it half-happen. Every hook that runs prints `Ran hook: <path>` to stderr, so sourcing
a file from the repository is never silent.

## Updates and the registry

### `Could not reach the npm registry: <reason>`

Only `linchpin update` raises this, because it cannot do its job without an answer. It exits
**3**. `linchpin version` deliberately exits **0** in the same situation so it stays safe in a
shell prompt.

Behind a mirror, point the CLI at it:

```bash
export LINCHPIN_REGISTRY=https://registry.internal.example
```

### `Refusing to query registry over http//: <url>`

A plaintext registry is a downgrade anyone on the network path can answer, and
`LINCHPIN_REGISTRY` is only as trustworthy as whatever set it. Loopback hosts — `localhost`,
`127.0.0.1`, `::1` — are allowed automatically, for a local mirror such as Verdaccio.
Anything else needs `LINCHPIN_REGISTRY_ALLOW_INSECURE=1` said out loud.

### The update notice will not go away

You are still on the older version. Update however this copy was installed —
`linchpin update` works it out from the path it is running from — or silence the notice with
`LINCHPIN_NO_UPDATE_NOTIFIER=1`.

The notice clears itself on the next command after any successful update, including a manual
`npm install -g`. A source checkout neither writes nor clears it, so an `npm link`ed working
tree cannot silence a release for the global install on the same machine.

### `linchpin update` says it cannot update this install

Expected for two scopes. An `npx` run already fetched the version it was asked for, and a
source checkout is updated with git:

```bash
git pull && npm install && npm run build
```

`linchpin version --json` reports `install.scope` and `install.updateCommand`, which is the
fastest way to see which case you are in.

## Agents and automation

### A command hangs forever with no output

The failure mode this CLI is built to avoid, so it is worth confirming what is actually
blocking. Inside Claude Code, `CI` is unset, no stream is a TTY, and `AI_AGENT` is set —
anything that decides whether to prompt from a `CI` check alone classifies an agent as
interactive and then waits for input nobody can supply.

Where required input is missing and there is no terminal, the command fails immediately and
names the flags:

```text
Error: Missing required input in a non-interactive context: --message-file --branch
Pass --message-file --branch, or run in a terminal to be prompted.
```

If something still hangs, it is reaching a prompt it should not. That is a bug worth
reporting, with the command and `linchpin version --json` attached.

### `--json` returned something that is not an envelope

Expected for `wt` today. Its dispatcher predates the envelope: `wt ls --json` prints a bare
array and `wt current` prints a bare object in every mode. Failures do produce a proper
envelope. The full picture is in the
[command reference](cli-reference.md#output-modes-and-the-json-envelope).

### `Argument N contains a control character: "…"`

Multi-line and binary content travels by file path in this CLI, never as an argument, so
control characters are rejected in `argv` before parsing. Write the content to a file with
your own file-writing tool and pass the path. ANSI escapes in particular can rewrite terminal
output that an agent then reads back, which is why this is refused rather than sanitised.

## Still stuck

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/terminal-session",
  "attrs": {
    "title": "What to attach to a bug report",
    "shell": "bash",
    "prompt": "$",
    "command": "linchpin version --check --json\nlinchpin wt config show\nlinchpin wt ls --json",
    "output": "The first names the version, how it was installed and the cache path.\nThe second is the configuration as the CLI resolved it, not as written.\nThe third is every worktree the repository knows about."
  }
}
-->
#### What to attach to a bug report

```bash
$ linchpin version --check --json
$ linchpin wt config show
$ linchpin wt ls --json
```

**Output**

```text
The first names the version, how it was installed and the cache path.
The second is the configuration as the CLI resolved it, not as written.
The third is every worktree the repository knows about.
```
<!-- /docspress:block -->

All three are read-only. None of them contains a credential — `.clickup.json` holds workspace
and list ids, which are not secrets, and the API still requires a token that lives elsewhere.
