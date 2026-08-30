# Linchpin CLI

`linchpin` is Linchpin's command line tool for WordPress and agent workflows — git worktree
management, local environment setup, and deterministic verbs that agents can call without
tripping approval prompts.

```bash
npm install -g @linchpinagency/cli
linchpin --help
linchpin version        # what you are running, and whether a newer one exists
```

→ [Installing, updating and uninstalling](updating.md)

## What it solves

**One WordPress install, many branches.** A plugin or theme repo has many git worktrees, but a
local WordPress install has exactly one directory slot for it. `linchpin wt switch` repoints
that slot's symlink at the worktree you want, so a single install serves every branch without
copying files. → [Worktrees and the symlink swap](worktrees.md)

**Agents that stop asking permission.** Claude Code cannot statically analyse a heredoc or a
pipe, so it prompts for approval every time — and those prompts cannot be permanently
dismissed. Passing a **file path** instead of piping content keeps a command to one statically
analysable subcommand, which an allowlist rule matches once and keeps matching.
→ [Agent integration](agent-integration.md)

**Hooks at every lifecycle point.** Twelve `pre`/`post` hooks let a project run its own build,
cache flush, or environment fixup around each worktree operation.
→ [Hooks](hooks.md)

## Pages

| Page | What's in it |
| --- | --- |
| [Installing, updating and uninstalling](updating.md) | How version detection works, who sees an update notice after a command and at shell startup, install-method detection, and how to remove it cleanly |
| [Worktrees and the symlink swap](worktrees.md) | The core mechanic, why symlinks rather than checkouts, and how this differs from plain `git worktree` |
| [Configuration](configuration.md) | `.linchpin.json` and `.clickup.json` — what each file owns and what is optional |
| [Hooks](hooks.md) | The 12 hook points, the environment contract, and why hooks are sourced rather than executed |
| [Agent integration](agent-integration.md) | Output modes, exit codes, and the approval-friction problem this CLI exists to remove |
| [Conventions from the skills library](skills-conventions.md) | The conventions every command must honour, extracted from `linchpin/skills` |
| [Repo tasks](repo-tasks.md) | **Spec, not yet built.** `linchpin repo <task>` — connecting a repository to the release infrastructure in one command |

## Status

The CLI is mid-rewrite from CommonJS to TypeScript behind a declarative command registry.

Per-command reference — every flag, its type, and each command's `effect` classification — is
**generated from that registry** rather than written by hand, so `--help`, `linchpin schema` and
these pages cannot disagree. Until that generator lands, this section carries authored narrative
only, and command specifics live in `linchpin <command> --help`.
