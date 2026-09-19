# Command reference

Every command the CLI exposes today, its flags, and what it does to the world. Flags and
descriptions here are transcribed from the command registry in `src/cli/commands/` and from
`--help` output captured against the built binary, so this page and the tool agree.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/callout",
  "attrs": {
    "tone": "note",
    "title": "Authored, not yet generated",
    "content": "<p>The registry in <code>src/cli/registry.ts</code> already holds everything this page states — summary, description, examples, flags, and the <code>effect</code> classification. The generator that would emit this page from it is not built yet, so it is written by hand and verified against captured <code>--help</code> output. Treat <code>linchpin &lt;command&gt; --help</code> as the tiebreaker.</p>",
    "collapsible": false
  }
}
-->
> [!NOTE]
>
> **Authored, not yet generated**
>
> The registry in `src/cli/registry.ts` already holds everything this page states — summary, description, examples, flags, and the `effect` classification. The generator that would emit this page from it is not built yet, so it is written by hand and verified against captured `--help` output. Treat `linchpin <command> --help` as the tiebreaker.
<!-- /docspress:block -->

## The shape of the surface

Four commands are registered. `wt` carries eighteen subcommands of its own through a
dispatcher that has not been ported yet, which is why it behaves differently from the other
three in several ways this page calls out.

| Command | What it does | Effect | Group |
| --- | --- | --- | --- |
| `wt` | Worktrees, and the WordPress symlink swap | `destructive` | Worktrees |
| `shell-init` | Emit the shell wrapper, and optionally the startup notice | `read` | Utilities |
| `version` | Report the installed version and update state | `read` | Utilities |
| `update` | Install the latest published version | `write` | Utilities |

`effect` is a required field on every command definition, and
`assertAllCommandsClassified()` throws at startup if one is missing. It is what a skill's
`allowed-tools` list reads to decide what an agent may run unattended: pre-approve `read`,
never blanket-approve `destructive`.

## Global flags

Accepted before or after the command name. The output mode is resolved once from the whole
argv at startup, so `linchpin --json version` and `linchpin version --json` are the same
command.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/fields",
  "attrs": {
    "title": "Global flags",
    "description": "Registered on the root program and on every non-passthrough command.",
    "fields": [
      {
        "name": "-v, --version",
        "type": "boolean",
        "required": false,
        "defaultValue": "",
        "description": "Print the bare version number and exit. Distinct from the version command, which also reports update state.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "-h, --help",
        "type": "boolean",
        "required": false,
        "defaultValue": "",
        "description": "Show help for the program or for one command.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "--json",
        "type": "boolean",
        "required": false,
        "defaultValue": "false",
        "description": "Emit a machine-readable JSON envelope on stdout. See the envelope note below for how wt differs.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "--plain",
        "type": "boolean",
        "required": false,
        "defaultValue": "false",
        "description": "Force undecorated human output.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "--quiet",
        "type": "boolean",
        "required": false,
        "defaultValue": "false",
        "description": "Suppress all non-error output.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "--no-input",
        "type": "boolean",
        "required": false,
        "defaultValue": "false",
        "description": "Never prompt; fail naming the missing flags instead.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "--no-color",
        "type": "boolean",
        "required": false,
        "defaultValue": "false",
        "description": "Disable colored output. NO_COLOR is honored too.",
        "values": "",
        "deprecated": false
      }
    ],
    "searchable": true,
    "compact": false
  }
}
-->
#### Global flags

Registered on the root program and on every non-passthrough command.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `-v, --version` | boolean | No |  | Print the bare version number and exit. Distinct from the version command, which also reports update state. |
| `-h, --help` | boolean | No |  | Show help for the program or for one command. |
| `--json` | boolean | No | false | Emit a machine-readable JSON envelope on stdout. See the envelope note below for how wt differs. |
| `--plain` | boolean | No | false | Force undecorated human output. |
| `--quiet` | boolean | No | false | Suppress all non-error output. |
| `--no-input` | boolean | No | false | Never prompt; fail naming the missing flags instead. |
| `--no-color` | boolean | No | false | Disable colored output. NO_COLOR is honored too. |
<!-- /docspress:block -->

Control characters are rejected in `argv` before parsing, naming the offending argument with
the escape made visible. Multi-line and binary content travels by file path in this CLI, never
as an argument, so a control character there is either a mistake or an attempt to rewrite
terminal output an agent will read back.

```console
$ linchpin version "$(printf 'a\tb')"
Error: Argument 2 contains a control character: "a\x09b". Pass multi-line or binary content by file path instead.
```

## Exit codes

Borrowed from `gh`, and printed at the bottom of `linchpin --help` so they need not be
discovered by experiment.

| Code | Meaning | What to do |
| --- | --- | --- |
| 0 | Success | — |
| 1 | Unexpected error | A bug; report it |
| 2 | Validation or usage error | Fix the command, do not retry it unchanged |
| 3 | Precondition not met | No repo, no config, dirty tree — fix the state |
| 4 | Authentication required or rejected | Supply or refresh credentials |
| 5 | Refused by a safety check | Pass the named bypass flag if you mean it |

Codes 0, 1, 2 and 3 are all reachable today. Code 5 has a raising path —
`confirmOrFallback()` throws it when a destructive confirmation cannot be asked — but nothing
in the current surface calls it yet, and code 4 has only its constructor. Both are part of the
contract commands are being ported onto, not dead entries.

The `wt` refusals that exist today predate this vocabulary and surface as plain errors instead.
`wt switch --force` without a TTY and without `--yes` raises *Refusing to replace … without
confirmation* and exits **1**, where a ported command would exit **5**.

## `wt`

Create, list, switch and delete git worktrees, and repoint the WordPress plugin or theme
symlink at the worktree your local site should load. The mechanic itself is explained in
[Worktrees and the symlink swap](worktrees.md).

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/callout",
  "attrs": {
    "tone": "warning",
    "title": "Two different help screens",
    "content": "<p><code>linchpin wt --help</code> and <code>linchpin wt help</code> print different things. The first is Commander's help for the registry wrapper: it describes the group and shows four examples, but never enumerates the subcommand surface. The second reaches the dispatcher and lists all eighteen usages. Use <code>linchpin wt help</code> until <code>wt</code> is ported.</p>",
    "collapsible": false
  }
}
-->
> [!WARNING]
>
> **Two different help screens**
>
> `linchpin wt --help` and `linchpin wt help` print different things. The first is Commander's help for the registry wrapper: it describes the group and shows four examples, but never enumerates the subcommand surface. The second reaches the dispatcher and lists all eighteen usages. Use `linchpin wt help` until `wt` is ported.
<!-- /docspress:block -->

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/terminal-session",
  "attrs": {
    "title": "The full subcommand list",
    "shell": "bash",
    "prompt": "$",
    "command": "linchpin wt help",
    "output": "linchpin wt\n\nUsage:\n  linchpin wt ls [--json]\n  linchpin wt current [--link] [--env <name>]\n  linchpin wt switch [worktree|branch] [--env <name>] [--force] [--yes] [--dry-run]\n  linchpin wt new [name]\n  linchpin wt get <branch>\n  linchpin wt extract\n  linchpin wt mv <new-branch-name>\n  linchpin wt del [-f|--force]\n  linchpin wt cd [branch|path]\n  linchpin wt home\n  linchpin wt use\n  linchpin wt gone\n  linchpin wt copy <path>\n  linchpin wt link <path>\n  linchpin wt invoke <hook>\n  linchpin wt trust [<hook>|--all] [--revoke]\n  linchpin wt config init [--plugin-slug <slug>] [--force] [--no-interactive]\n  linchpin wt config show"
  }
}
-->
#### The full subcommand list

```bash
$ linchpin wt help
```

**Output**

```text
linchpin wt

Usage:
  linchpin wt ls [--json]
  linchpin wt current [--link] [--env <name>]
  linchpin wt switch [worktree|branch] [--env <name>] [--force] [--yes] [--dry-run]
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
  linchpin wt trust [<hook>|--all] [--revoke]
  linchpin wt config init [--plugin-slug <slug>] [--force] [--no-interactive]
  linchpin wt config show
```
<!-- /docspress:block -->

### Reading the repository

| Subcommand | Does | Notes |
| --- | --- | --- |
| `wt ls` (alias `wt list`) | List every worktree for this repo, marking the current one with `*` | `--json` prints an array of `{worktree, branch, detached, current}` |
| `wt current` | Report the active worktree | Always prints a JSON object. `--link` or `--env <name>` adds `environment` and the resolved `linkPath` |
| `wt home` | Print the base worktree path | For `cd "$(linchpin wt home)"` |
| `wt cd [branch\|path]` | Print a worktree path | With no argument it opens an `fzf` picker, and fails if `fzf` is absent |
| `wt config show` | Print the resolved `.linchpin.json` | Normalized, so legacy config shapes appear in their current form |

### Creating and moving worktrees

| Subcommand | Does | Notes |
| --- | --- | --- |
| `wt new [name]` | Create a branch and a worktree from the remote head | Name defaults to `wip-<random>`. Fetches first, then `git worktree add --detach` followed by `git switch --create --no-track` |
| `wt get <branch>` | Attach an existing remote branch as a worktree | Fails if `origin/<branch>` does not exist |
| `wt extract` | Move the branch you are on in the base worktree out into its own worktree | Must run from the base worktree, and not on a detached HEAD. Leaves the base detached on the remote head |
| `wt mv <new-branch-name>` | Rename the current worktree's branch and move its directory to match | Must run from a linked worktree, not the base |
| `wt use` | Detach the base worktree onto the current worktree's commit | Must run from a linked worktree |

Worktrees are always created as siblings of the base repo, named `<basePath>@<branchName>`.
That convention is what lets any worktree find its base by stripping the suffix.

### Removing worktrees

| Subcommand | Does | Notes |
| --- | --- | --- |
| `wt del [-f\|--force]` | Remove the current worktree and delete its branch | Refuses on uncommitted changes, and refuses a branch not merged into the remote head. `--force` overrides both and switches `git branch -d` to `-D` |
| `wt gone` | Remove every worktree whose upstream branch is gone, then delete the branch | Fetches first, then reads `git branch -vv` for `: gone]`. A failure on one branch is reported and the loop continues |

### The symlink swap

`wt switch [worktree|branch]` repoints the configured environment's symlink at a worktree.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/fields",
  "attrs": {
    "title": "linchpin wt switch",
    "description": "Flags are parsed by the dispatcher's own parser, which rejects any unrecognized token rather than ignoring it.",
    "fields": [
      {
        "name": "[worktree|branch]",
        "type": "string",
        "required": false,
        "defaultValue": "",
        "description": "Which worktree to point at. Omitted with a TTY it opens a picker; omitted without one it resolves to the current worktree, which is what makes it safe for an agent to call.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "--env",
        "type": "string",
        "required": false,
        "defaultValue": "wordpress.defaultEnvironment",
        "description": "Which environment from .linchpin.json to repoint. Also accepts --env=name.",
        "values": "any key under wordpress.environments",
        "deprecated": false
      },
      {
        "name": "--force",
        "type": "boolean",
        "required": false,
        "defaultValue": "false",
        "description": "Replace a real directory sitting in the plugin slot. Without it, a non-symlink target is refused.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "--yes, -y",
        "type": "boolean",
        "required": false,
        "defaultValue": "false",
        "description": "Answer the deletion confirmation that --force raises. Required with --force when no TTY is attached, otherwise the command refuses rather than assuming consent.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "--dry-run",
        "type": "boolean",
        "required": false,
        "defaultValue": "false",
        "description": "Report the action without touching the filesystem. Skips both hooks and the confirmation.",
        "values": "",
        "deprecated": false
      }
    ],
    "searchable": true,
    "compact": false
  }
}
-->
#### linchpin wt switch

Flags are parsed by the dispatcher's own parser, which rejects any unrecognized token rather than ignoring it.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `[worktree\|branch]` | string | No |  | Which worktree to point at. Omitted with a TTY it opens a picker; omitted without one it resolves to the current worktree, which is what makes it safe for an agent to call. |
| `--env` | string | No | wordpress.defaultEnvironment | Which environment from .linchpin.json to repoint. Also accepts --env=name. |
| `--force` | boolean | No | false | Replace a real directory sitting in the plugin slot. Without it, a non-symlink target is refused. |
| `--yes, -y` | boolean | No | false | Answer the deletion confirmation that --force raises. Required with --force when no TTY is attached, otherwise the command refuses rather than assuming consent. |
| `--dry-run` | boolean | No | false | Report the action without touching the filesystem. Skips both hooks and the confirmation. |
<!-- /docspress:block -->

Where the result goes depends on who is reading. With a TTY on stdout the human summary is
printed there. Without one, the summary goes to **stderr** and the resolved target path goes
to **stdout** alone, which is what makes the wrapper idiom work:

```bash
cd "$(linchpin wt switch feature/checkout --env studio)"
```

`pre-switch` runs before the link changes and `post-switch` after, the latter with its working
directory set to the new worktree. Neither runs under `--dry-run`.

### Files, hooks and trust

| Subcommand | Does | Notes |
| --- | --- | --- |
| `wt copy <path>` | Copy a file or directory from the base worktree into this one | Both ends are containment-checked, so `../` cannot read or write outside the two worktrees. Refuses if the destination exists |
| `wt link <path>` | Symlink a base-worktree path into this one | Same containment check. Replaces an existing symlink, refuses a real file |
| `wt invoke <hook>` | Run one hook by hand | Exits `1` if the hook is present but untrusted |
| `wt trust [<hook>\|--all] [--revoke]` | Review and approve hooks | With no argument, lists every hook and its state alongside the trust file path |

`copy` and `link` must both run from a linked worktree, not the base. Hook behavior, the
environment contract and why trust is per-machine are covered in [Hooks](hooks.md).

### Configuration

`wt config init` writes `.linchpin.json`. With a TTY and without `--no-interactive` it runs a
five-question wizard; otherwise it writes a default file non-interactively.

| Flag | Effect |
| --- | --- |
| `--type <plugin\|theme\|wp-content>` | Pre-select what the repo is. Also spelled `--content-type`. An invalid value exits `1` with a message naming the three valid ones |
| `--plugin-slug <slug>` | Pre-fill the WordPress directory name |
| `--force` | Overwrite an existing `.linchpin.json` |
| `--no-interactive` | Skip the wizard even with a TTY attached |

Everything the file can hold is documented in [Configuration](configuration.md).

## `shell-init`

Prints shell source to stdout for you to `eval`. It writes nothing and touches nothing, which
is why it is classified `read` and is safe to pre-approve.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/fields",
  "attrs": {
    "title": "linchpin shell-init",
    "description": "Output the shell wrapper that makes wt switch change directory.",
    "fields": [
      {
        "name": "--shell",
        "type": "enum",
        "required": false,
        "defaultValue": "detected from $SHELL",
        "description": "Which shell to emit a wrapper for.",
        "values": "bash, zsh, fish",
        "deprecated": false
      },
      {
        "name": "--notify",
        "type": "boolean",
        "required": false,
        "defaultValue": "false",
        "description": "Also emit the block that prints a notice at shell startup when a newer version has been published.",
        "values": "",
        "deprecated": false
      }
    ],
    "searchable": false,
    "compact": true
  }
}
-->
#### linchpin shell-init

Output the shell wrapper that makes wt switch change directory.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `--shell` | enum | No | detected from $SHELL | Which shell to emit a wrapper for. |
| `--notify` | boolean | No | false | Also emit the block that prints a notice at shell startup when a newer version has been published. |
<!-- /docspress:block -->

```bash
eval "$(linchpin shell-init --notify)"     # in ~/.zshrc, ~/.bashrc or config.fish
linchpin shell-init --shell fish           # force one instead of detecting
```

The wrapper exists because a child process cannot change its parent shell's directory. It
re-enters `$PWD` after a successful `wt switch`, which is enough for the shell to follow a
repointed symlink. Details of the startup notice, including why it is a second pre-rendered
file rather than a second read of the cache, are in
[Installing, updating and uninstalling](updating.md).

## `version`

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/fields",
  "attrs": {
    "title": "linchpin version",
    "description": "Reads the cached result of the last check unless asked to refresh it.",
    "fields": [
      {
        "name": "--check",
        "type": "boolean",
        "required": false,
        "defaultValue": "false",
        "description": "Query the npm registry now instead of reading the cached answer, then cache what it learns.",
        "values": "",
        "deprecated": false
      }
    ],
    "searchable": false,
    "compact": true
  }
}
-->
#### linchpin version

Reads the cached result of the last check unless asked to refresh it.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `--check` | boolean | No | false | Query the npm registry now instead of reading the cached answer, then cache what it learns. |
<!-- /docspress:block -->

**Always exits 0**, including when the registry cannot be reached, so it is safe in a shell
prompt or a status line. A caller that needs failure-on-stale wants `linchpin update --check`
instead.

The JSON form carries everything a bug report or an agent needs. Captured from a source
checkout, where `install.scope` is `source` and there is no update command to offer:

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/colorful-code",
  "attrs": {
    "language": "json",
    "filename": "linchpin version --json",
    "code": "{\n  \"version\": 1,\n  \"ok\": true,\n  \"command\": \"version\",\n  \"data\": {\n    \"name\": \"@linchpinagency/cli\",\n    \"current\": \"1.2.1\",\n    \"latest\": null,\n    \"updateAvailable\": false,\n    \"checkedAt\": null,\n    \"source\": \"none\",\n    \"checkError\": null,\n    \"install\": {\n      \"manager\": \"npm\",\n      \"scope\": \"source\",\n      \"path\": \"/Users/you/GitHub/cli/dist/cli.js\",\n      \"updateCommand\": null\n    },\n    \"cachePath\": \"/Users/you/.cache/linchpin/update-check.json\",\n    \"node\": \"24.14.1\"\n  }\n}",
    "showLineNumbers": false,
    "caption": "source is one of registry, cache or none; scope is one of global, local, npx or source.",
    "diffMode": "none",
    "copyMode": "all"
  }
}
-->
**linchpin version --json — source is one of registry, cache or none; scope is one of global, local, npx or source.**

```json
{
  "version": 1,
  "ok": true,
  "command": "version",
  "data": {
    "name": "@linchpinagency/cli",
    "current": "1.2.1",
    "latest": null,
    "updateAvailable": false,
    "checkedAt": null,
    "source": "none",
    "checkError": null,
    "install": {
      "manager": "npm",
      "scope": "source",
      "path": "/Users/you/GitHub/cli/dist/cli.js",
      "updateCommand": null
    },
    "cachePath": "/Users/you/.cache/linchpin/update-check.json",
    "node": "24.14.1"
  }
}
```
<!-- /docspress:block -->

## `update`

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/fields",
  "attrs": {
    "title": "linchpin update",
    "description": "Queries the registry, then runs the install command matching however this copy was installed.",
    "fields": [
      {
        "name": "--check",
        "type": "boolean",
        "required": false,
        "defaultValue": "false",
        "description": "Report whether an update is pending and exit 3 if so. Installs nothing.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "--dry-run",
        "type": "boolean",
        "required": false,
        "defaultValue": "false",
        "description": "Print the install command that would run, without running it.",
        "values": "",
        "deprecated": false
      }
    ],
    "searchable": false,
    "compact": true
  }
}
-->
#### linchpin update

Queries the registry, then runs the install command matching however this copy was installed.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `--check` | boolean | No | false | Report whether an update is pending and exit 3 if so. Installs nothing. |
| `--dry-run` | boolean | No | false | Print the install command that would run, without running it. |
<!-- /docspress:block -->

Unlike `version`, this command cannot do its job without an answer, so an unreachable registry
is a **precondition failure** (exit `3`, code `registry_unreachable`) rather than a shrug. A
reachable cache with an unreachable registry is still acted on, with a warning on stderr in
human mode and `checkError` set in the envelope.

`--check` exits **3** when an update is pending and **0** when there is nothing to do, so it
gates a job with no output to parse:

```bash
linchpin update --check || echo "CLI is behind — releasing with an old toolchain"
```

How the install method is detected, and which command each one maps to, is in
[Installing, updating and uninstalling](updating.md).

## Output modes and the JSON envelope

Mode is resolved once at startup: an explicit `--json` / `--plain` / `--quiet` flag first,
then `LINCHPIN_OUTPUT`, then a default of human text. Warnings always go to stderr so stdout
stays parseable.

Registry-native commands render through one `Output` seam, so their JSON is a versioned
envelope. `changed` appears on mutations, distinguishing a real change from a no-op:

```json
{"version":1,"ok":true,"command":"update","changed":true,"data":{"current":"1.2.0","latest":"1.2.1"}}
```

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/callout",
  "attrs": {
    "tone": "warning",
    "title": "wt subcommands do not emit the envelope on success",
    "content": "<p>The <code>wt</code> dispatcher predates the envelope and writes its own output. <code>linchpin wt ls --json</code> prints a bare JSON array, and <code>linchpin wt current</code> prints a bare JSON object in every mode. Parse those shapes directly rather than reaching for <code>.data</code>.</p><p>Failures are different: a <code>wt</code> error thrown up to the entry point is rendered by the same <code>Output</code> seam, so <code>--json</code> does produce a proper envelope on stdout with stderr empty.</p>",
    "collapsible": false
  }
}
-->
> [!WARNING]
>
> **wt subcommands do not emit the envelope on success**
>
> The `wt` dispatcher predates the envelope and writes its own output. `linchpin wt ls --json` prints a bare JSON array, and `linchpin wt current` prints a bare JSON object in every mode. Parse those shapes directly rather than reaching for `.data`.
>
> Failures are different: a `wt` error thrown up to the entry point is rendered by the same `Output` seam, so `--json` does produce a proper envelope on stdout with stderr empty.
<!-- /docspress:block -->

A second consequence of the passthrough: `wt` errors are plain `Error` objects, not
`UserError`, so they exit **1** with `code: "internal_error"` and print a stack trace in human
mode — even when the cause is an ordinary missing-config precondition that would otherwise
exit `3`. Verified against a repository with no `.linchpin.json`:

```console
$ linchpin wt config show --json ; echo "exit=$?"
{"version":1,"ok":false,"command":"wt","error":{"code":"internal_error","message":"Missing .linchpin.json at /Users/you/GitHub/cli. Run 'linchpin wt config init' to create one.","exitCode":1}}
exit=1
```

Both differences disappear as each subcommand is ported onto its own definition. Until then,
an agent should branch on the top-level command rather than assume one shape.

## Library entry

`src/index.ts` exports the registry, the error types, the `Output` renderer and everything
under `core/`, and it builds to `dist/index.js`. It exists so the command surface can be
exercised directly rather than only through a spawned binary.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/callout",
  "attrs": {
    "tone": "note",
    "title": "Not a published entry point",
    "content": "<p><code>package.json</code> declares <code>bin</code> but no <code>main</code>, <code>module</code>, <code>exports</code> or <code>types</code> field, so <code>import '@linchpinagency/cli'</code> does not resolve. Today these exports are reachable only from inside the repository, or by a deep path into <code>dist/</code>. Treat the CLI as the supported interface until an export map is declared.</p>",
    "collapsible": false
  }
}
-->
> [!NOTE]
>
> **Not a published entry point**
>
> `package.json` declares `bin` but no `main`, `module`, `exports` or `types` field, so `import '@linchpinagency/cli'` does not resolve. Today these exports are reachable only from inside the repository, or by a deep path into `dist/`. Treat the CLI as the supported interface until an export map is declared.
<!-- /docspress:block -->

## Adding a command

One `defineCommand()` definition per command, and nothing is wired twice — flags come from the
Zod schema, help grouping from `meta.group`, examples from `meta.examples`, and the effect
classification from `read` / `write` / `destructive`.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/colorful-code",
  "attrs": {
    "language": "typescript",
    "filename": "src/cli/commands/version.ts",
    "code": "export const versionCommand = defineCommand({\n  meta: {\n    name: 'version',\n    summary: 'Print the installed version and whether a newer one is published',\n    group: 'utility',\n    examples: ['linchpin version', 'linchpin version --check'],\n  },\n  effect: 'read',\n  args: z.object({\n    check: z\n      .boolean()\n      .default(false)\n      .describe('Query the npm registry now instead of reading the cached answer'),\n  }),\n  handler: async (args, ctx) => {\n    // ...\n  },\n});",
    "highlightedLines": "3,8,9",
    "showLineNumbers": true,
    "caption": "The name, the effect and the schema are the three things every command must declare.",
    "diffMode": "none",
    "copyMode": "all"
  }
}
-->
**src/cli/commands/version.ts — The name, the effect and the schema are the three things every command must declare.**

```typescript
export const versionCommand = defineCommand({
  meta: {
    name: 'version',
    summary: 'Print the installed version and whether a newer one is published',
    group: 'utility',
    examples: ['linchpin version', 'linchpin version --check'],
  },
  effect: 'read',
  args: z.object({
    check: z
      .boolean()
      .default(false)
      .describe('Query the npm registry now instead of reading the cached answer'),
  }),
  handler: async (args, ctx) => {
    // ...
  },
});
```
<!-- /docspress:block -->

Add the definition to `COMMANDS` in `src/cli/commands/index.ts` and it appears in `--help`,
grouped, with its examples and flags. A name containing a space — `wt switch` — hangs itself
off a parent that is created on demand, which is how the dispatcher will be dismantled one
subcommand at a time.
