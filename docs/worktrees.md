# Worktrees and the symlink swap

The problem this solves is narrow and specific. A plugin repo can have any number of git
worktrees, but the WordPress install you develop against has exactly **one** directory where
that plugin lives. You cannot have `wp-content/plugins/my-plugin` be three branches at once.

The usual answers are all bad: cloning the repo once per branch wastes disk and drifts,
switching branches in place loses your work in progress, and copying files back and forth
invites the copy and the repo to disagree.

## The mechanic

The plugin slot in your WordPress install is a **symlink**, and switching branches means
repointing it.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/file-tree",
  "attrs": {
    "root": "~/GitHub/",
    "tree": "my-plugin/            the base repo, on main\nmy-plugin@feature-a/  a worktree\nmy-plugin@feature-b/  another worktree",
    "caption": "Each worktree keeps its own uncommitted state, and its own node_modules and vendor directories."
  }
}
-->
#### ~/GitHub/

```text
my-plugin/            the base repo, on main
my-plugin@feature-a/  a worktree
my-plugin@feature-b/  another worktree
```

_Each worktree keeps its own uncommitted state, and its own node_modules and vendor directories._
<!-- /docspress:block -->

The WordPress install holds one slot for the plugin, and that slot is a symlink:

```text
~/Studio/mysite/wp-content/plugins/my-plugin
        └── symlink, currently pointing at ~/GitHub/my-plugin@feature-a
```

```bash
linchpin wt switch feature-b
```

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/diagram",
  "attrs": {
    "title": "What a switch actually does",
    "type": "flow",
    "source": "linchpin wt switch -> plugin slot symlink: repoint\nplugin slot symlink -> my-plugin@feature-b: now resolves to\nWordPress -> plugin slot symlink: next request reads",
    "caption": "One inode changes. Nothing is copied and nothing is rebuilt."
  }
}
-->
#### What a switch actually does

```text
linchpin wt switch -> plugin slot symlink: repoint
plugin slot symlink -> my-plugin@feature-b: now resolves to
WordPress -> plugin slot symlink: next request reads
```

_One inode changes. Nothing is copied and nothing is rebuilt._
<!-- /docspress:block -->

The symlink now points at `my-plugin@feature-b`. WordPress is unaware anything happened; the
next request simply reads different files. Nothing is copied, nothing is rebuilt, and every
worktree keeps its own uncommitted state.

Worktrees are created as **siblings** of the repo with an `@` separator —
`${basePath}@${branchName}`. That convention is what lets the CLI find the base repo from any
worktree by stripping the suffix.

## Why not check the repo out inside WordPress directly

Because then you are back to one branch at a time. The whole point is that the repo lives
outside the WordPress install and the install *borrows* one worktree at a time.

It also keeps WordPress core, `wp-config.php` and the site's uploads out of your repo, which is
what makes the repo shaped like `wp-content` rather than like a whole site.

## Compared with plain `git worktree`

This does not replace `git worktree`. It adds the WordPress layer on top.

| Need | Plain `git worktree` | `linchpin wt` |
| --- | --- | --- |
| Create, list, remove worktrees | Yes | Yes — `new`, `ls`, `del`, `get` |
| Switch which branch WordPress loads | Manual symlink editing | `linchpin wt switch [branch] --env <name>` |
| Store environment paths for the team | No | `.linchpin.json`, shared in the repo |
| Guardrails around replacing a real directory | No | Refuses without `--force` |
| Interactive picker | No | TTY picker, with `fzf` when installed |

If your difficulty is "I can make worktrees, but pointing my site at them is manual and
error-prone", that gap is what this fills.

## Two behaviours worth knowing

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/callout",
  "attrs": {
    "tone": "tip",
    "title": "Repointing is idempotent, including over a broken link",
    "content": "<p>Switching to the branch you are already on reports \"already linked\" and changes nothing. More usefully, a link whose target was deleted — say an agent removed a worktree while you were away — is still recognised and repointed rather than erroring. The check reads the path the link <em>records</em> rather than following it, which is why a dangling link is not a dead end.</p>",
    "collapsible": false
  }
}
-->
> [!TIP]
>
> **Repointing is idempotent, including over a broken link**
>
> Switching to the branch you are already on reports "already linked" and changes nothing. More usefully, a link whose target was deleted — say an agent removed a worktree while you were away — is still recognised and repointed rather than erroring. The check reads the path the link _records_ rather than following it, which is why a dangling link is not a dead end.
<!-- /docspress:block -->

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/callout",
  "attrs": {
    "tone": "warning",
    "title": "A real directory is never silently replaced",
    "content": "<p>If the plugin slot holds an actual directory rather than a symlink, the switch refuses and tells you to pass <code>--force</code>. That directory may be the only copy of something.</p><p>Two further guards sit behind <code>--force</code>. Without a TTY it also requires <code>--yes</code>, rather than reading silence as consent. And the target must look like a WordPress content path — some segment named <code>wp-content</code>, or a parent of <code>plugins</code>, <code>themes</code> or <code>mu-plugins</code> — before anything is deleted, because the path came from a file the repository controls.</p><p>When the setup wizard meets the same situation it offers to rename the directory to <code>.bkp</code>, delete it, or skip. It refuses to overwrite an existing <code>.bkp</code>, because at that point the backup is the only copy.</p>",
    "collapsible": false
  }
}
-->
> [!WARNING]
>
> **A real directory is never silently replaced**
>
> If the plugin slot holds an actual directory rather than a symlink, the switch refuses and tells you to pass `--force`. That directory may be the only copy of something.
>
> Two further guards sit behind `--force`. Without a TTY it also requires `--yes`, rather than reading silence as consent. And the target must look like a WordPress content path — some segment named `wp-content`, or a parent of `plugins`, `themes` or `mu-plugins` — before anything is deleted, because the path came from a file the repository controls.
>
> When the setup wizard meets the same situation it offers to rename the directory to `.bkp`, delete it, or skip. It refuses to overwrite an existing `.bkp`, because at that point the backup is the only copy.
<!-- /docspress:block -->

## Recovering when the ground moves

Agents move and archive worktrees mid-session, which can leave your shell sitting in a
directory git no longer recognises. Rather than failing, the CLI tries up to three places to
find the repository: the current directory, the base repo inferred by stripping the `@branch`
suffix, and the repo identified by the worktree id recorded in the worktree's own `.git` file.

The last of those is the strongest, because it matches on metadata git itself wrote rather than
on a naming convention — so it still works when a worktree has been renamed or moved somewhere
unexpected. If you work under several agent roots, list them in
[`.linchpin.json`](configuration.md) so they are searched too.
