# Linchpin CLI

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/hero",
  "attrs": {
    "eyebrow": "WordPress and agent workflows",
    "title": "One WordPress install, every branch",
    "description": "linchpin repoints the plugin or theme slot in your local site at whichever git worktree you want it to load. Nothing is copied, nothing is rebuilt, and every command is safe for an agent to call.",
    "primaryLabel": "Install and update",
    "primaryUrl": "/cli/updating/",
    "primaryNewTab": false,
    "secondaryLabel": "Command reference",
    "secondaryUrl": "/cli/cli-reference/",
    "secondaryNewTab": false,
    "visualVariant": "sync-diagram",
    "layout": "split",
    "mediaPosition": "right",
    "mediaWidth": 44,
    "imageScale": 100,
    "height": "standard",
    "tone": "theme",
    "textAlign": "left",
    "showGrid": false,
    "showOrbit": false
  }
}
-->
_WordPress and agent workflows_

## One WordPress install, every branch

linchpin repoints the plugin or theme slot in your local site at whichever git worktree you want it to load. Nothing is copied, nothing is rebuilt, and every command is safe for an agent to call.

[Install and update](/cli/updating/) · [Command reference](/cli/cli-reference/)
<!-- /docspress:block -->

```bash
npm install -g @linchpinagency/cli
linchpin --help
linchpin version        # what you are running, and whether a newer one exists
```

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/audience-paths",
  "attrs": {
    "eyebrow": "Choose a path",
    "title": "What brought you here?",
    "description": "Four ways into the same tool.",
    "paths": [
      {
        "title": "Set up a repository",
        "description": "Install the CLI, run the wizard once per repo, and point your local site at a worktree.",
        "url": "/cli/updating/",
        "cta": "Start installing",
        "icon": "rocket",
        "accent": "blue",
        "newTab": false
      },
      {
        "title": "Understand the mechanic",
        "description": "Why a symlink swap rather than a checkout, and how this differs from plain git worktree.",
        "url": "/cli/worktrees/",
        "cta": "Read the mechanic",
        "icon": "branch",
        "accent": "gold",
        "newTab": false
      },
      {
        "title": "Drive it from an agent",
        "description": "Output modes, exit codes, and the approval friction this CLI exists to remove.",
        "url": "/cli/agent-integration/",
        "cta": "Integrate an agent",
        "icon": "code",
        "accent": "green",
        "newTab": false
      },
      {
        "title": "Look up a command",
        "description": "Every command, flag and effect classification, with the wt caveats spelled out.",
        "url": "/cli/cli-reference/",
        "cta": "Open the reference",
        "icon": "terminal",
        "accent": "coral",
        "newTab": false
      }
    ],
    "columns": 2,
    "tone": "theme",
    "textAlign": "left",
    "compact": false,
    "showNumbers": false
  }
}
-->
_Choose a path_

## What brought you here?

Four ways into the same tool.

### Set up a repository

Install the CLI, run the wizard once per repo, and point your local site at a worktree.

[Start installing](/cli/updating/)

### Understand the mechanic

Why a symlink swap rather than a checkout, and how this differs from plain git worktree.

[Read the mechanic](/cli/worktrees/)

### Drive it from an agent

Output modes, exit codes, and the approval friction this CLI exists to remove.

[Integrate an agent](/cli/agent-integration/)

### Look up a command

Every command, flag and effect classification, with the wt caveats spelled out.

[Open the reference](/cli/cli-reference/)
<!-- /docspress:block -->

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
| [Configuration](configuration.md) | `.linchpin.json` and `.clickup.json` — what each file owns and what is optional — plus every environment variable the CLI reads |
| [Hooks](hooks.md) | The 12 hook points, the environment contract, and why hooks are sourced rather than executed |
| [Command reference](cli-reference.md) | Every command and flag, the effect classification, exit codes, and where `wt` still behaves differently from the rest |
| [Agent integration](agent-integration.md) | Output modes, exit codes, and the approval-friction problem this CLI exists to remove |
| [Troubleshooting](troubleshooting.md) | Real error strings, the guardrails that raise them, and the safe way past each one |
| [Conventions from the skills library](skills-conventions.md) | The conventions every command must honour, extracted from `linchpin/skills` |
| [Repo tasks](repo-tasks.md) | **Spec, not yet built.** `linchpin repo <task>` — connecting a repository to the release infrastructure in one command |

## Status

The CLI is mid-rewrite from CommonJS to TypeScript behind a declarative command registry.

Four commands are registered today. Three of them — `shell-init`, `version` and `update` — are
fully ported: their flags come from a Zod schema, their help from `meta`, and their output from
the shared `Output` seam. The fourth, `wt`, is still a single passthrough to the legacy
dispatcher that owns its own argv, its own help screen and its own output shapes.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/callout",
  "attrs": {
    "tone": "note",
    "title": "The reference is authored, not generated yet",
    "content": "<p>Per-command detail is <em>declared</em> in the registry — summary, description, examples, flags and the <code>effect</code> classification all live in one definition each. The generator that would emit a reference page from it is not built, so <a href=\"/cli/cli-reference/\">Command reference</a> is written by hand and checked against captured <code>--help</code> output. When the generator lands, that page becomes its output and cannot drift again.</p>",
    "collapsible": false
  }
}
-->
> [!NOTE]
>
> **The reference is authored, not generated yet**
>
> Per-command detail is _declared_ in the registry — summary, description, examples, flags and the `effect` classification all live in one definition each. The generator that would emit a reference page from it is not built, so [Command reference](cli-reference.md) is written by hand and checked against captured `--help` output. When the generator lands, that page becomes its output and cannot drift again.
<!-- /docspress:block -->
