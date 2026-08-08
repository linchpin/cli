# Hooks

Every worktree operation can run a project script before and after it. Put an executable-or-not
file at `.linchpin/hooks/<name>` and it runs at that point.

```bash
# .linchpin/hooks/post-switch
cd "$LINCHPIN_WORKTREE" && npm install --silent
```

## The 12 hook points

Two phases across six operations:

| | `switch` | `new` | `get` | `extract` | `mv` | `del` |
| --- | --- | --- | --- | --- | --- | --- |
| **`pre-`** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **`post-`** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Environment

These names are a **public API**. Scripts in the wild depend on them, so they are treated as a
compatibility surface rather than an implementation detail.

| Variable | Set for | Meaning |
| --- | --- | --- |
| `LINCHPIN_WORKTREE` | all | Absolute path of the worktree the operation acted on |
| `LINCHPIN_BRANCH` | all | Branch name, when the operation has one |
| `LINCHPIN_ENVIRONMENT` | environment-targeting operations | Environment name from `.linchpin.json` |
| `LINCHPIN_OLD_BRANCH` | `mv` | The previous branch name |
| `LINCHPIN_OLD_WORKTREE` | `mv` | The previous worktree path |

A variable that does not apply is **absent**, not set to an empty or literal `"undefined"`
value. So the usual guard behaves as you would expect:

```bash
if [ -n "$LINCHPIN_OLD_BRANCH" ]; then
  echo "renamed from $LINCHPIN_OLD_BRANCH"
fi
```

`post-switch` runs with its working directory set to the **new** worktree, so a hook can assume
it is already in the right place.

## Hooks are sourced, not executed

The hook is run as `bash -c 'source "$1"' linchpin-hook <path>`. Two consequences, both
deliberate:

- **No shebang and no execute bit are needed.** A plain file of shell commands works, which is
  what most people write.
- **A hook can export variables and define functions** that affect the surrounding shell.
  Executing it as a separate program would discard those.

The hook path is passed as an argument (`$1`) rather than interpolated into the script, so a
path containing spaces or shell metacharacters stays data.

## Guardrails

- **A failing hook fails the operation.** That is intentional — a `pre-switch` that cannot
  prepare the environment should stop the switch rather than let it half-happen.
- **Hooks run with your full environment and privileges.** They are ordinary shell scripts in
  your repository; review them the way you would review any other code you run.
- **Keep them fast.** A hook on `post-switch` runs every time anyone changes branch.
