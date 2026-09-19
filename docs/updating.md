# Installing, updating and uninstalling

The CLI knows what version it is, whether a newer one is published, and how this particular copy
was installed. This page is the mechanism; the [README](../README.md#staying-up-to-date) is the
walkthrough.

## Install

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/code-tabs",
  "attrs": {
    "tabs": [
      {
        "label": "npm",
        "language": "bash",
        "filename": "Terminal",
        "code": "npm install -g @linchpinagency/cli"
      },
      {
        "label": "pnpm",
        "language": "bash",
        "filename": "Terminal",
        "code": "pnpm add -g @linchpinagency/cli"
      },
      {
        "label": "bun",
        "language": "bash",
        "filename": "Terminal",
        "code": "bun add -g @linchpinagency/cli"
      },
      {
        "label": "yarn",
        "language": "bash",
        "filename": "Terminal",
        "code": "yarn global add @linchpinagency/cli"
      }
    ],
    "showLineNumbers": false,
    "caption": "yarn global add is yarn 1.x only; yarn 2+ removed it. Whichever you use, linchpin update will detect it later from the path this copy runs from."
  }
}
-->
#### npm — Terminal

```bash
npm install -g @linchpinagency/cli
```

#### pnpm — Terminal

```bash
pnpm add -g @linchpinagency/cli
```

#### bun — Terminal

```bash
bun add -g @linchpinagency/cli
```

#### yarn — Terminal

```bash
yarn global add @linchpinagency/cli
```

_yarn global add is yarn 1.x only; yarn 2+ removed it. Whichever you use, linchpin update will detect it later from the path this copy runs from._
<!-- /docspress:block -->

Global, not a project dependency: it is a tool you point at many repositories. Node **22.12**
or newer is required — that is the `engines` floor CI tests against.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/terminal-session",
  "attrs": {
    "title": "Confirm the install, and that PATH picked it up",
    "shell": "bash",
    "prompt": "$",
    "command": "linchpin version",
    "output": "@linchpinagency/cli 1.2.1\nUp to date (checked just now)"
  }
}
-->
#### Confirm the install, and that PATH picked it up

```bash
$ linchpin version
```

**Output**

```text
@linchpinagency/cli 1.2.1
Up to date (checked just now)
```
<!-- /docspress:block -->

`linchpin shell-init` emits a shell function that re-enters your current directory after a
successful `wt switch`, because a child process cannot change its parent shell's directory. Add
`eval "$(linchpin shell-init --notify)"` to your profile, or wrap each call as
`cd "$(linchpin wt switch …)"`. `--notify` adds the [shell-startup
notice](#the-shell-startup-notice).

## Two ways to ask about the version

| Command | Answers | Exit code |
| --- | --- | --- |
| `linchpin --version` | The bare number, nothing else | 0 |
| `linchpin version` | Version, cached update state, how it was installed | 0 |
| `linchpin version --check` | Same, after asking the registry | 0 — always |
| `linchpin update --check` | Whether an update is pending | **3** if pending, 0 if not |

Two commands rather than one flag, because the two callers want opposite things. A person or an
agent asking "what am I running" must not be handed a failure for the answer "there is a newer
one" — that would make the informational path unusable in a prompt or a status line. A CI job
gating on staleness needs exactly that failure, with no output to parse.

## How the check works

**The registry is asked for one dist-tag.** `GET /-/package/<name>/dist-tags` returns
`{"latest":"1.2.0"}` — a few dozen bytes, rather than the full packument with every version's
metadata. Override the host with `LINCHPIN_REGISTRY`; it falls back to `npm_config_registry`,
then npmjs.org.

**The answer is cached for 24 hours**, at `$XDG_CACHE_HOME/linchpin/update-check.json` or
`~/.cache/linchpin/update-check.json` (`LINCHPIN_CACHE_DIR` overrides, and
`linchpin version --json` reports the resolved path as `cachePath`). Beside it sits
`update-notice.txt`, the finished text a shell should print — see below for why it is a second
file rather than a second read of the first.

**A notice costs no latency.** The notifier reads the cache file and nothing else. If the cache
has gone stale it spawns a detached process to refresh it — `detached`, stdio ignored,
`unref()`ed — so the command you actually ran never waits on a network round trip. That child is
marked with `LINCHPIN_UPDATE_CHECK_CHILD`, so it cannot spawn a refresh of its own.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/callout",
  "attrs": {
    "tone": "note",
    "title": "Everything on this path fails soft",
    "content": "<p><strong>A corrupt cache means \"ask again\", not \"fail\".</strong> Every read and write here is best-effort: a read-only home directory or a truncated file must never break the command someone was running.</p><p><strong>An unparseable version never reads as newer.</strong> If a registry answers with something that is not a semver, the comparison returns \"equal\" rather than \"newer\" — otherwise every invocation would nag with no version that could ever satisfy it.</p><p><strong>A checkedAt in the future is treated as stale.</strong> That is a clock change, not a fresh answer.</p>",
    "collapsible": false
  }
}
-->
> [!NOTE]
>
> **Everything on this path fails soft**
>
> **A corrupt cache means "ask again", not "fail".** Every read and write here is best-effort: a read-only home directory or a truncated file must never break the command someone was running.
>
> **An unparseable version never reads as newer.** If a registry answers with something that is not a semver, the comparison returns "equal" rather than "newer" — otherwise every invocation would nag with no version that could ever satisfy it.
>
> **A checkedAt in the future is treated as stale.** That is a clock change, not a fresh answer.
<!-- /docspress:block -->

## Who gets told, after a command

There are two surfaces. This section is the notice printed after a command you ran; the next one
is the notice printed when a shell starts. Both write to **stderr**, and both honour the same
opt-out.

The in-command notice is written after the command completes, and only when all of these hold:

| Condition | Why |
| --- | --- |
| Output mode is `human` | `--json` keeps stdout to one envelope and stderr empty; `--quiet` means quiet |
| Not CI | A build log is not a person |
| Not an agent (`AI_AGENT` is unset) | An unrequested line is a token cost an agent cannot act on. It asks instead: `linchpin version --check --json`. Read straight from the environment rather than through the async `@vercel/detect-agent` call, so no invocation pays a detection cost to answer a question that only *removes* output |
| `LINCHPIN_NO_UPDATE_NOTIFIER` / `NO_UPDATE_NOTIFIER` unset | The opt-out, including the conventional name other tools use |
| The command is not `version` or `update` | Both report update state themselves |
| This install *can* be updated | A source checkout or an `npx` run would only get advice it cannot take |

stderr rather than stdout is load-bearing, not stylistic: `cd "$(linchpin wt switch)"` and
`eval "$(linchpin shell-init)"` both consume stdout, and a notice there would be executed.

## The shell-startup notice

The notifier above only speaks after someone runs a command, which means it never reaches the
person most likely to be out of date: the one who has not opened the CLI in a fortnight.
`linchpin shell-init --notify` emits a second block for a shell profile, so a release is
announced by opening a terminal.

```bash
linchpin shell-init --notify >> ~/.zshrc     # or eval "$(linchpin shell-init --notify)"
```

Nothing in it is terminal-specific. Ghostty, Terminal.app, iTerm, VS Code and the terminal
inside Herd all start the user's shell, and the shell is what reads this.

**No Node on the startup path.** This is why `update-notice.txt` exists as its own file. The
cache is an *answer* that still has to be interpreted — compare two versions by semver
precedence, work out which package manager installed this copy — and doing that at startup means
starting Node in front of the first prompt: ~35ms, several times a day, to print nothing on all
but a handful of shells. The notice file holds the finished two lines instead, so the common
path is a `test` and a `cat`, measured at about 6ms per shell.

**Only the CLI writes it.** Every `linchpin version` and `linchpin update` syncs the file to
what it just learned, so it is written when a release appears and removed the moment it stops
being one. `linchpin update` clears it on success, and any human command clears it after a
manual `npm install -g` — otherwise every new terminal would keep advertising an update that was
already installed. An identical write is skipped rather than performed, so a file a shell may be
reading is not churned on every command.

**A copy that cannot update itself stays out of it.** A source checkout or an `npx` run neither
writes nor clears: the notice on that machine belongs to the global install, and an `npm link`ed
working tree wiping it would silence a release for shells that have nothing to do with the
checkout.

**The refresh is the shell's job when nothing else runs the CLI.** If `update-check.json` is
missing or more than a day old, the block spawns `linchpin version --check --quiet` detached,
with its stdio on `/dev/null`, and returns immediately. That is what keeps a machine that never
runs the CLI from going stale forever.

The block declines to say anything when any of these hold:

| Condition | Why |
| --- | --- |
| The shell is not interactive | A script that sources a profile is not a person. `case $- in *i*)` in POSIX shells, `status is-interactive` in fish |
| `LINCHPIN_NO_UPDATE_NOTIFIER` / `NO_UPDATE_NOTIFIER` is set | The same opt-out the in-command notifier uses, read the same way: `0` and `false` count as unset |
| `linchpin` is not on `PATH` | Uninstalled. Advice that cannot be taken, and nothing to spawn |
| `update-notice.txt` is absent | The "nothing to say" state |

The cache directory is baked into the emitted block as a shell literal — single-quoted, with
embedded apostrophes escaped, since it is a path from `$HOME` going into a file that is sourced
without review. Resolving XDG in shell would be a second implementation of `cacheDirectory()`
free to drift from the first. A `LINCHPIN_CACHE_DIR` set at runtime still wins; move your cache
any other way and re-run `shell-init`.

## Install-method detection

`linchpin update` derives its command from the path the process is running from — resolved
through `realpathSync`, since npm installs the bin as a symlink.

| Path contains | Manager | Update command |
| --- | --- | --- |
| `lib/node_modules/` or `npm/node_modules/` | npm, global | `npm install -g <pkg>@latest` |
| `node_modules/` anywhere else | npm, local | `npm install <pkg>@latest` |
| `/.pnpm/`, `pnpm/global/`, `Library/pnpm/` | pnpm | `pnpm add -g <pkg>@latest` |
| `/.bun/` | bun | `bun add -g <pkg>@latest` |
| `/.yarn/`, `yarn/global/` | yarn 1.x | `yarn global add <pkg>@latest` |
| `/_npx/` | — | Nothing; npx already fetched the latest |
| No `node_modules` at all | — | A checkout or `npm link`: `git pull && npm install && npm run build` |

Read from the path rather than from `npm_config_user_agent`, which is only set while npm itself
is the parent process — true during `npm install`, never when a user runs `linchpin`.

Getting this wrong is not cosmetic. Handing a pnpm or bun install an `npm install -g` leaves two
copies on the machine, and which one answers depends on `PATH` order.

Check what it decided without running anything:

```bash
linchpin update --dry-run       # prints the command it would run, and stops
linchpin version --json         # install.manager, install.scope, install.updateCommand
```

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/result",
  "attrs": {
    "status": "success",
    "title": "What a completed update looks like",
    "content": "<p>The check window is reset so the notifier does not repeat a notice that has just been acted on, and <code>update-notice.txt</code> is removed with it — otherwise every new terminal would keep advertising an update that is already installed.</p>",
    "meta": "linchpin update · exit 0 · changed: true"
  }
}
-->
> [!TIP]
>
> **What a completed update looks like**
>
> The check window is reset so the notifier does not repeat a notice that has just been acted on, and `update-notice.txt` is removed with it — otherwise every new terminal would keep advertising an update that is already installed.
>
> _linchpin update · exit 0 · changed: true_
<!-- /docspress:block -->

## Uninstall

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/code-tabs",
  "attrs": {
    "tabs": [
      {
        "label": "npm",
        "language": "bash",
        "filename": "Terminal",
        "code": "npm uninstall -g @linchpinagency/cli\nrm -rf ~/.cache/linchpin"
      },
      {
        "label": "pnpm",
        "language": "bash",
        "filename": "Terminal",
        "code": "pnpm remove -g @linchpinagency/cli\nrm -rf ~/.cache/linchpin"
      },
      {
        "label": "bun",
        "language": "bash",
        "filename": "Terminal",
        "code": "bun remove -g @linchpinagency/cli\nrm -rf ~/.cache/linchpin"
      },
      {
        "label": "yarn",
        "language": "bash",
        "filename": "Terminal",
        "code": "yarn global remove @linchpinagency/cli\nrm -rf ~/.cache/linchpin"
      },
      {
        "label": "npm link",
        "language": "bash",
        "filename": "Terminal",
        "code": "npm unlink -g @linchpinagency/cli"
      }
    ],
    "showLineNumbers": false,
    "caption": "linchpin version names the manager under install.manager, and the exact cache location under cachePath, if you are unsure. A source checkout never wrote the cache, so there is nothing to remove."
  }
}
-->
#### npm — Terminal

```bash
npm uninstall -g @linchpinagency/cli
rm -rf ~/.cache/linchpin
```

#### pnpm — Terminal

```bash
pnpm remove -g @linchpinagency/cli
rm -rf ~/.cache/linchpin
```

#### bun — Terminal

```bash
bun remove -g @linchpinagency/cli
rm -rf ~/.cache/linchpin
```

#### yarn — Terminal

```bash
yarn global remove @linchpinagency/cli
rm -rf ~/.cache/linchpin
```

#### npm link — Terminal

```bash
npm unlink -g @linchpinagency/cli
```

_linchpin version names the manager under install.manager, and the exact cache location under cachePath, if you are unsure. A source checkout never wrote the cache, so there is nothing to remove._
<!-- /docspress:block -->

Hook approvals live outside the cache, at `~/.local/share/linchpin/trust.json` by default.
Removing them is optional; leaving them means a reinstall does not have to re-approve hooks
you already reviewed.

Then remove the `eval "$(linchpin shell-init --notify)"` line from your shell profile. Left
behind, the notice block is harmless — it checks for `linchpin` on `PATH` and returns — but the
`eval` around it will report `command not found` on every new shell.

`.linchpin.json` and `.linchpin/hooks/` stay: they are committed project files that a teammate
still needs. Worktrees and symlinks stay too — they are plain git worktrees and plain symlinks,
and the CLI only ever pointed them at each other.
