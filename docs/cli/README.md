# Linchpin CLI

`linchpin` is Linchpin's command line tool for WordPress and agent workflows — git worktree
management, local environment setup, and deterministic verbs that agents can call without
tripping approval prompts.

```bash
npm install -g @linchpinagency/cli
linchpin --help
```

## Why it exists

Two problems, one fix.

**Worktree switching.** A plugin or theme repo has many git worktrees, but a local WordPress
install has exactly one slot for it. `linchpin wt switch` repoints that slot's symlink at the
worktree you want, so one WordPress install serves every branch.

**Agent approval friction.** Claude Code cannot statically analyse a heredoc or a pipe, so it
prompts for approval every time — and those prompts cannot be permanently dismissed. Passing a
**file path** instead of piping content keeps a command to a single statically analysable
subcommand, which an allowlist rule can match once and keep matching.

```bash
# Two subcommands, two allow rules, prompts every time
printf '%s' "$BODY" | linchpin pr body -F -

# One subcommand, one allow rule, silent
linchpin pr edit --pr 42 --body-file .linchpin/tmp/body.md
```

## Output modes and exit codes

The mode is decided once at startup: an explicit `--json` / `--plain` / `--quiet` flag, then
`LINCHPIN_OUTPUT`, then whether stdout is a TTY. Warnings always go to stderr, so stdout stays
parseable. In `--json` mode stdout carries exactly one envelope and stderr stays empty, even on
failure.

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Unexpected error |
| 2 | Validation or usage error |
| 3 | Precondition not met |
| 4 | Authentication required or rejected |
| 5 | Refused by a safety check |

## Pages

- [Conventions extracted from the skills library](skills-conventions.md) — the conventions
  every command must honour, read out of `linchpin/skills`, and the four places the
  implementation plan contradicted a shipped skill.

## Status

The CLI is mid-rewrite from CommonJS to TypeScript behind a declarative command registry.
Reference documentation for each command is generated from that registry rather than written by
hand, so `--help`, `linchpin schema` and these pages cannot disagree. Until that generator lands
this section carries authored prose only.
