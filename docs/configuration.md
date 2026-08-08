# Configuration

Two files, two owners. Both live at the repo root and both are committed, so the team shares
one answer rather than each person configuring their own.

| File | Owns |
| --- | --- |
| `.linchpin.json` | Agent base paths, and optionally the WordPress environments to symlink into |
| `.clickup.json` | Which ClickUp space and list this repo's tasks belong to |

## `.linchpin.json`

Created by `linchpin wt config init`, which walks you through the questions and writes the
result. Home directories are stored collapsed to `~` so the file is portable between machines.

```json
{
  "agents": {
    "codex": "~/Documents/GitHub",
    "conductor": "~/conductor"
  },
  "defaultAgent": "codex",
  "wordpress": {
    "contentType": "plugin",
    "pluginSlug": "my-plugin",
    "defaultEnvironment": "studio",
    "environments": {
      "studio": "~/Studio/mysite/wp-content/plugins/my-plugin",
      "localwp": "~/Local Sites/mysite/app/public/wp-content/plugins/my-plugin"
    }
  }
}
```

### The `wordpress` block is optional

A repo with no WordPress environments is a perfectly normal state, not a misconfiguration.
Commands that do not touch a WordPress install — anything to do with commits, pull requests,
tasks or JSON editing — work fine without it. Only the commands that genuinely need an
environment ask for one, and they fail with a precondition telling you to run
`linchpin wt config init`.

### Agents

`agents` maps an agent name to the directory its repositories live under. It matters because
worktree operations need to find the base repository, and different agents keep checkouts in
different places.

`defaultAgent` is not decorative: the agent you nominate is searched **first** when locating a
repository, on the reasoning that a path you configured is a better guess than a preset one.

Presets exist for `conductor` (`~/conductor`), `claude-code` (`~/Documents`) and `codex`
(`~/Documents/GitHub`). A `custom` entry takes any path you give it.

The older single-agent form is still read:

```json
{ "agent": "codex", "agentBasePath": "~/Documents/GitHub" }
```

### Content types

`contentType` is one of `plugin`, `theme` or `wp-content`. The last is for repos where the
repository *is* the whole `wp-content` directory — common on client projects where the repo is
named after the client. `symlinkName` overrides the directory name the symlink is created
under, which is what you want when the repo name and the WordPress directory name differ.

## `.clickup.json`

Pins where this repo's tasks live, so creating one is a single confirmation rather than a crawl
through the workspace hierarchy. Only `space` and `defaultList` are required — a two-key file is
already useful.

```json
{
  "space": { "id": "90140688927", "name": "Linchpin", "customIdPrefix": "LINCHPIN" },
  "defaultList": {
    "id": "901418862156",
    "name": "List",
    "path": "Linchpin › CLI › List",
    "use": "All work on the linchpin CLI."
  }
}
```

Two rules matter more than the shape:

- **IDs are the contract; names are for humans.** Lists get renamed and the id survives it.
- **It holds no secrets.** Workspace, folder and list ids are not credentials, and the API still
  requires a token. It is dev-time metadata, so exclude it from any distributable — this repo's
  `files` allowlist already does.

The full schema, including the optional `lists`, `folders` and `moduleRouting` maps, is
documented in the `task-tracking` skill.
