# Plugin scaffold

`linchpin plugin scaffold <slug>` writes a new WordPress plugin from the house standard at [`linchpin/plugin-scaffold`](https://github.com/linchpin/plugin-scaffold).

It is the WP-CLI `wp scaffold plugin` analog for how Linchpin actually ships plugins: `{slug}.php`, `includes/` Bootstrap and Controller, `linchpin/coding-standards`, `linchpin/actions@v4` callers, release-please, husky, `.distignore`, and the house README (release line, badges, license, banner).

This command writes a **local directory**. It does not create a GitHub repository or set secrets.

## This is not `linchpin repo plugin --scaffold`

[Repo tasks](repo-tasks.md) uses `--scaffold` for a different job: render *workflow* templates onto an *existing* repository and open a PR. Keep that name for that job.

## Usage

```bash
linchpin plugin scaffold acme
linchpin plugin scaffold acme --with-blocks --channel=wporg
linchpin plugin scaffold acme --path ~/GitHub/acme --dry-run
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--name` | title-cased slug | Plugin Name and README title |
| `--description` | generated one-liner | Plugin header and README one-liner |
| `--php` | `8.3` | Requires PHP |
| `--channel` | `private` | `private`, `wporg`, or `self-hosted` |
| `--with-blocks` | off | Nested `blocks/` workspace and an example block |
| `--path` | `./<slug>` | Destination |
| `--ref` | pinned tag | Tag, sha, or a local template path |
| `--force` | off | Overwrite a non-empty destination |
| `--dry-run` | off | Print the plan, write nothing |
| `--git` | off | `git init` when the destination is not already inside a repo |
| `--install` | off | `composer install` and `npm install` |

The pin lives in `src/core/plugin-scaffold-pin.json` (and `PLUGIN_SCAFFOLD_PIN`). Default runtime fetch is `gh repo clone linchpin/plugin-scaffold` at that tag, cached under `~/.linchpin/cache/plugin-scaffold/`. Tests use `test/fixtures/plugin-scaffold/` via `--ref`.

## After it writes

```bash
cd acme
linchpin wt config init
# later: gh repo create, then linchpin repo plugin --connect
```

What a generated plugin must contain is owned by `wp-plugin-standards`. This command is that skill's executable form for greenfield repos.
