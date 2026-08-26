# Installing, updating and uninstalling

The CLI knows what version it is, whether a newer one is published, and how this particular copy
was installed. This page is the mechanism; the [README](../README.md#staying-up-to-date) is the
walkthrough.

## Install

```bash
npm install -g @linchpinagency/cli      # or pnpm add -g / bun add -g
linchpin version
```

Global, not a project dependency: it is a tool you point at many repositories.

`linchpin shell-init` emits a shell function that re-enters your current directory after a
successful `wt switch`, because a child process cannot change its parent shell's directory. Add
`eval "$(linchpin shell-init)"` to your profile, or wrap each call as
`cd "$(linchpin wt switch …)"`.

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
`linchpin version --json` reports the resolved path as `cachePath`).

**A notice costs no latency.** The notifier reads the cache file and nothing else. If the cache
has gone stale it spawns a detached process to refresh it — `detached`, stdio ignored,
`unref()`ed — so the command you actually ran never waits on a network round trip. That child is
marked with `LINCHPIN_UPDATE_CHECK_CHILD`, so it cannot spawn a refresh of its own.

**A corrupt cache means "ask again", not "fail".** Every read and write here is best-effort: a
read-only home directory or a truncated file must never break the command someone was running.

**An unparseable version never reads as newer.** If a registry answers with something that is
not a semver, the comparison returns "equal" rather than "newer" — otherwise every invocation
would nag with no version that could ever satisfy it.

## Who gets told

The notice is written to **stderr**, after the command completes, and only when all of these
hold:

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

## Uninstall

```bash
npm uninstall -g @linchpinagency/cli     # or pnpm remove -g / bun remove -g
rm -rf ~/.cache/linchpin                 # the update-check cache
```

Then remove the `eval "$(linchpin shell-init)"` line from your shell profile.

`.linchpin.json` and `.linchpin/hooks/` stay: they are committed project files that a teammate
still needs. Worktrees and symlinks stay too — they are plain git worktrees and plain symlinks,
and the CLI only ever pointed them at each other.
