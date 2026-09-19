# Hooks

Every worktree operation can run a project script before and after it. Put an executable-or-not
file at `.linchpin/hooks/<name>`, approve it with `linchpin wt trust`, and it runs at that
point.

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

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/fields",
  "attrs": {
    "title": "Hook environment",
    "description": "Set on the hook process in addition to your own environment. A variable that does not apply is absent, never an empty or literal \"undefined\" string.",
    "fields": [
      {
        "name": "LINCHPIN_WORKTREE",
        "type": "string",
        "required": true,
        "defaultValue": "",
        "description": "Absolute path of the worktree the operation acted on.",
        "values": "every hook point",
        "deprecated": false
      },
      {
        "name": "LINCHPIN_BRANCH",
        "type": "string",
        "required": false,
        "defaultValue": "",
        "description": "Branch name, when the operation has one. Absent on a detached HEAD.",
        "values": "every hook point",
        "deprecated": false
      },
      {
        "name": "LINCHPIN_ENVIRONMENT",
        "type": "string",
        "required": false,
        "defaultValue": "",
        "description": "Environment name from .linchpin.json, for operations that target one.",
        "values": "pre-switch, post-switch",
        "deprecated": false
      },
      {
        "name": "LINCHPIN_OLD_BRANCH",
        "type": "string",
        "required": false,
        "defaultValue": "",
        "description": "The branch name before the rename.",
        "values": "pre-mv, post-mv",
        "deprecated": false
      },
      {
        "name": "LINCHPIN_OLD_WORKTREE",
        "type": "string",
        "required": false,
        "defaultValue": "",
        "description": "The worktree path before the rename.",
        "values": "pre-mv, post-mv",
        "deprecated": false
      }
    ],
    "searchable": false,
    "compact": false
  }
}
-->
#### Hook environment

Set on the hook process in addition to your own environment. A variable that does not apply is absent, never an empty or literal "undefined" string.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `LINCHPIN_WORKTREE` | string | Yes |  | Absolute path of the worktree the operation acted on. |
| `LINCHPIN_BRANCH` | string | No |  | Branch name, when the operation has one. Absent on a detached HEAD. |
| `LINCHPIN_ENVIRONMENT` | string | No |  | Environment name from .linchpin.json, for operations that target one. |
| `LINCHPIN_OLD_BRANCH` | string | No |  | The branch name before the rename. |
| `LINCHPIN_OLD_WORKTREE` | string | No |  | The worktree path before the rename. |
<!-- /docspress:block -->

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

## Hooks must be trusted before they run

`.linchpin/hooks/` is committed, so hooks arrive with a `git clone` — unlike `.git/hooks`,
which git deliberately refuses to transfer for exactly this reason. Combined with sourcing,
that would make cloning a repository equivalent to running whatever it shipped: no execute bit,
no shebang, nothing in a diff marking the file as code that will run.

So a hook does nothing until this machine has approved it, the same way `direnv` and `mise`
handle `.envrc`:

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/flow",
  "attrs": {
    "start": 1,
    "steps": [
      {
        "title": "See what the repository ships",
        "content": "<p><code>linchpin wt trust</code> with no argument lists every file in <code>.linchpin/hooks/</code> as <code>trusted</code> or <code>UNTRUSTED</code>, and prints the path of the trust file holding those decisions.</p>"
      },
      {
        "title": "Read the hook",
        "content": "<p>It will be sourced by your shell with your full environment and privileges. Review it the way you would review any other code you are about to run.</p>"
      },
      {
        "title": "Approve it by name",
        "content": "<p><code>linchpin wt trust post-switch</code> records a sha256 of the contents you just read. <code>--all</code> approves every hook in the repository at once.</p>"
      },
      {
        "title": "Withdraw it whenever",
        "content": "<p><code>linchpin wt trust post-switch --revoke</code> removes the entry. Editing the file revokes it too, automatically, because the digest no longer matches.</p>"
      }
    ]
  }
}
-->
1. **See what the repository ships**

   `linchpin wt trust` with no argument lists every file in `.linchpin/hooks/` as `trusted` or `UNTRUSTED`, and prints the path of the trust file holding those decisions.

2. **Read the hook**

   It will be sourced by your shell with your full environment and privileges. Review it the way you would review any other code you are about to run.

3. **Approve it by name**

   `linchpin wt trust post-switch` records a sha256 of the contents you just read. `--all` approves every hook in the repository at once.

4. **Withdraw it whenever**

   `linchpin wt trust post-switch --revoke` removes the entry. Editing the file revokes it too, automatically, because the digest no longer matches.
<!-- /docspress:block -->

```bash
linchpin wt trust                      # list this repo's hooks and their state
linchpin wt trust post-switch          # approve one, after reading it
linchpin wt trust --all                # approve every hook in the repo
linchpin wt trust post-switch --revoke # withdraw approval
```

An untrusted hook is skipped with a message naming the file and the command that would approve
it. The operation itself still succeeds — a blocked hook is not a failed switch.

**Approval covers the contents, not the filename.** Trust is recorded against a hash of the
file, so editing a trusted hook withdraws its trust automatically and it has to be reviewed
again. Pulling a branch that changes a hook you trusted last week does not inherit that trust.

Approvals are per-machine and live outside the repository — at `$XDG_DATA_HOME/linchpin/trust.json`,
or `~/.local/share/linchpin/trust.json` by default, overridable with `LINCHPIN_TRUST_FILE`. A
repository cannot grant its own trust.

## Guardrails

- **A failing hook fails the operation.** That is intentional — a `pre-switch` that cannot
  prepare the environment should stop the switch rather than let it half-happen.
- **A hook that runs says so.** Each one prints `Ran hook: <path>` to stderr, so sourcing a file
  from the repo is never silent.
- **A blocked hook is not a failed operation.** An untrusted hook is skipped with a message
  naming the file and the command that would approve it; the switch itself still succeeds.
- **Keep them fast.** A hook on `post-switch` runs every time anyone changes branch.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/callout",
  "attrs": {
    "tone": "danger",
    "title": "Hooks run with your full environment and privileges",
    "content": "<p>They are ordinary shell scripts, sourced into a shell that inherits everything your session has — credentials in the environment, agent tokens, SSH access. Trust is the only thing between a cloned repository and that.</p><p>A hook name reaching <code>wt invoke</code> from argv is contained to the hooks directory, and a symlink pointing out of it is refused, so neither <code>../</code> nor a planted link can reach a file elsewhere on the machine. That containment does not replace reading the hook before approving it.</p>",
    "collapsible": false
  }
}
-->
> [!CAUTION]
>
> **Hooks run with your full environment and privileges**
>
> They are ordinary shell scripts, sourced into a shell that inherits everything your session has — credentials in the environment, agent tokens, SSH access. Trust is the only thing between a cloned repository and that.
>
> A hook name reaching `wt invoke` from argv is contained to the hooks directory, and a symlink pointing out of it is refused, so neither `../` nor a planted link can reach a file elsewhere on the machine. That containment does not replace reading the hook before approving it.
<!-- /docspress:block -->
