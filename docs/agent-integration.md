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
{"version":1,"ok":true,"command":"update","changed":true,"data":{"current":"1.2.0","latest":"1.2.1"}}
```

`changed` distinguishes a real mutation from a no-op, so an agent can tell "already correct"
from "just fixed".

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/callout",
  "attrs": {
    "tone": "warning",
    "title": "The envelope does not cover wt yet",
    "content": "<p>Registry-native commands — <code>version</code>, <code>update</code>, <code>shell-init</code> — render through the shared <code>Output</code> seam and emit the envelope above. <code>wt</code> is still a passthrough to a dispatcher that owns its own argv and writes its own output, so on success it emits neither an envelope nor <code>changed</code>:</p><ul><li><code>linchpin wt ls --json</code> prints a bare JSON array.</li><li><code>linchpin wt current</code> prints a bare JSON object in every mode, whether or not you asked for JSON.</li><li><code>linchpin wt switch</code> prints a human summary and, without a TTY, the resolved path alone on stdout.</li></ul><p>Failures <em>do</em> travel through the seam, so a failing <code>wt</code> command under <code>--json</code> produces a proper envelope on stdout with stderr empty. Branch on the top-level command rather than assuming one shape.</p>",
    "collapsible": false
  }
}
-->
> [!WARNING]
>
> **The envelope does not cover wt yet**
>
> Registry-native commands — `version`, `update`, `shell-init` — render through the shared `Output` seam and emit the envelope above. `wt` is still a passthrough to a dispatcher that owns its own argv and writes its own output, so on success it emits neither an envelope nor `changed`:
>
> - `linchpin wt ls --json` prints a bare JSON array.
> - `linchpin wt current` prints a bare JSON object in every mode, whether or not you asked for JSON.
> - `linchpin wt switch` prints a human summary and, without a TTY, the resolved path alone on stdout.
>
> Failures _do_ travel through the seam, so a failing `wt` command under `--json` produces a proper envelope on stdout with stderr empty. Branch on the top-level command rather than assuming one shape.
<!-- /docspress:block -->

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

The same passthrough caveat applies here. `wt` raises plain `Error` objects rather than
`UserError`, so an ordinary precondition — no `.linchpin.json`, an unknown environment — exits
**1** with `code: "internal_error"` instead of **3**, and prints a stack trace in human mode.
Do not read a `1` from `wt` as "this is a bug in the CLI" until the subcommands are ported.

## Never hanging

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/callout",
  "attrs": {
    "tone": "danger",
    "title": "CI is unset inside an agent",
    "content": "<p>Measured inside Claude Code: <code>isCI: false</code>, <code>hasTTY: false</code>, <code>AI_AGENT: \"claude-code_2-1-223_agent\"</code>.</p><p>Anything that decides whether to prompt by checking <code>CI</code> alone therefore classifies an agent as <em>interactive</em> — and then blocks forever waiting for input nobody can supply. The non-TTY check is the safety net, and it is the one that must never be removed.</p>",
    "collapsible": false
  }
}
-->
> [!CAUTION]
>
> **CI is unset inside an agent**
>
> Measured inside Claude Code: `isCI: false`, `hasTTY: false`, `AI_AGENT: "claude-code_2-1-223_agent"`.
>
> Anything that decides whether to prompt by checking `CI` alone therefore classifies an agent as _interactive_ — and then blocks forever waiting for input nobody can supply. The non-TTY check is the safety net, and it is the one that must never be removed.
<!-- /docspress:block -->

When required input is missing and there is no terminal, the command **fails immediately
naming the exact flags** rather than prompting:

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

## Pre-approving commands in a skill

Every command declares an `effect` of `read`, `write` or `destructive`, and that field exists
so an `allowed-tools` list can be written from the classification rather than from a guess.
Pre-approve `read`. Never blanket-approve `destructive`.

Today the whole `wt` group is registered as a single `destructive` passthrough, because the
safe reading of a group containing `del` is the most dangerous verb in it — so `wt ls`, which
will be `read` once ported, currently inherits that classification. Allowlist the specific
subcommands you want rather than the group.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/prompt",
  "attrs": {
    "prompt": "Audit this repository's linchpin usage. Read .linchpin.json and report which environments resolve to paths that exist on this machine, then list every hook in .linchpin/hooks/ with its trust state. Use linchpin wt config show and linchpin wt trust rather than reading the files directly, and do not switch environments or trust anything.",
    "model": "Claude",
    "mode": "ask",
    "thinking": false,
    "context": "@repository, .linchpin.json, .linchpin/hooks/",
    "caption": "A read-only audit that touches nothing"
  }
}
-->
#### A read-only audit that touches nothing

> Audit this repository's linchpin usage. Read .linchpin.json and report which environments resolve to paths that exist on this machine, then list every hook in .linchpin/hooks/ with its trust state. Use linchpin wt config show and linchpin wt trust rather than reading the files directly, and do not switch environments or trust anything.

_Model: Claude · Mode: ask · Thinking: off · Context: @repository, .linchpin.json, .linchpin/hooks/_
<!-- /docspress:block -->

Both commands in that prompt are informational: `wt config show` prints resolved configuration,
and `wt trust` with no argument only lists state. Neither writes anything.
