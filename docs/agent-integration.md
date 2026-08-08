# Agent integration

This CLI is built to be driven by a coding agent as comfortably as by a person. That means two
distinct things: not blocking when nobody can answer a prompt, and not triggering approval
dialogs that cannot be dismissed.

## The approval problem

Claude Code asks for approval on any Bash command it cannot statically analyse, and **those
prompts cannot be permanently allowlisted**. Three shapes trigger it:

| Command | Why it prompts |
| --- | --- |
| `git commit -F - <<'EOF' … EOF` | Contains shell syntax that cannot be statically analysed |
| `cat > patch.py <<'PY' … PY` | Brace with quote character, read as expansion obfuscation |
| `export X=… && npx --yes …` | Allowlistable in principle, but `npx` is never stripped, so each new invocation re-prompts |

Every one is an agent reaching for shell plumbing to move **multi-line text**.

Worse, approving a multi-line command appends that entire command verbatim to
`settings.local.json` — which then never matches again, because the next commit message is
different. The file grows without bound and nothing gets quieter.

## The fix: pass a path, never a pipe

Recognised command separators include `&&`, `||`, `;`, `|` and newlines, and an allow rule must
match **each** subcommand independently.

```bash
# Two subcommands -> two rules needed -> prompts every time
printf '%s' "$BODY" | linchpin pr body -F -

# One subcommand -> one rule -> silent
linchpin pr edit --pr 42 --body-file .linchpin/tmp/body.md
```

A pipe defeats the prefix matching that makes allowlisting work at all. The agent writes the
prose with its own file-writing tool — which never touches a shell, so there is nothing to
escape — then passes the path. As a bonus every operation becomes idempotent and retryable.

## Output modes

The mode is decided **once at startup**, in this order:

1. an explicit `--json`, `--plain` or `--quiet` flag
2. the `LINCHPIN_OUTPUT` environment variable, so an agent sets it once rather than per call
3. whether stdout is a TTY

Warnings always go to **stderr**, so stdout stays parseable even on partial success. In
`--json` mode stdout carries exactly one envelope and stderr stays empty — including when the
command fails, which is precisely when structured output matters most.

```json
{"version":1,"ok":true,"command":"wt switch","changed":true,"data":{"branch":"feature-b"}}
```

`changed` distinguishes a real mutation from a no-op, so an agent can tell "already correct"
from "just fixed".

## Exit codes

Borrowed from `gh`, so an agent that knows one CLI knows this one. They are documented in
`--help` rather than left to be discovered by experiment.

| Code | Meaning | What to do |
| --- | --- | --- |
| 0 | Success | — |
| 1 | Unexpected error | A bug; report it |
| 2 | Validation or usage error | Fix the command, do not retry it unchanged |
| 3 | Precondition not met | No repo, no config, dirty tree — fix the state |
| 4 | Authentication required or rejected | Supply or refresh credentials |
| 5 | Refused by a safety check | Pass the named bypass flag if you mean it |

## Never hanging

⚠️ Inside Claude Code, **`CI` is unset**, no stream is a TTY, and `AI_AGENT` is set. Anything
that decides whether to prompt by checking `CI` alone therefore classifies an agent as
*interactive* — and then blocks forever waiting for input nobody can supply.

The non-TTY check is the safety net. When required input is missing and there is no terminal,
the command **fails immediately naming the exact flags** rather than prompting:

```
Error: Missing required input in a non-interactive context: --message-file --branch
Pass --message-file --branch, or run in a terminal to be prompted.
```

Two rules follow from this:

- **Agent detection only ever removes decoration.** It never adds an obligation the caller then
  has to satisfy — that pattern deadlocks agents rather than helping them.
- **Non-destructive confirmations take their default and say so**, rather than failing an
  automated run. Destructive ones do the opposite: they refuse, exit `5`, and name the flag
  that would authorise them.

`$EDITOR` is never opened unless stdin is a TTY. Claude Code sets `GIT_EDITOR=true` precisely
because an agent can never satisfy an editor prompt.

## Colour

`NO_COLOR` is honoured, and colour is dropped automatically when output is piped or an agent is
detected. `--no-color` forces it off explicitly.
