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

Presets exist for `conductor` (`~/conductor`), `claude-code` (`~/GitHub`) and `codex`
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

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/code-tabs",
  "attrs": {
    "tabs": [
      {
        "label": "Plugin",
        "language": "json",
        "filename": ".linchpin.json",
        "code": "{\n  \"wordpress\": {\n    \"contentType\": \"plugin\",\n    \"pluginSlug\": \"my-plugin\",\n    \"defaultEnvironment\": \"studio\",\n    \"environments\": {\n      \"studio\": \"~/Studio/mysite/wp-content/plugins/my-plugin\"\n    }\n  }\n}"
      },
      {
        "label": "Theme",
        "language": "json",
        "filename": ".linchpin.json",
        "code": "{\n  \"wordpress\": {\n    \"contentType\": \"theme\",\n    \"pluginSlug\": \"my-theme\",\n    \"defaultEnvironment\": \"localwp\",\n    \"environments\": {\n      \"localwp\": \"~/Local Sites/mysite/app/public/wp-content/themes/my-theme\"\n    }\n  }\n}"
      },
      {
        "label": "wp-content",
        "language": "json",
        "filename": ".linchpin.json",
        "code": "{\n  \"wordpress\": {\n    \"contentType\": \"wp-content\",\n    \"symlinkName\": \"client-wp-content\",\n    \"defaultEnvironment\": \"localwp\",\n    \"environments\": {\n      \"localwp\": \"~/Local Sites/site/app/public/client-wp-content\"\n    }\n  }\n}"
      }
    ],
    "showLineNumbers": false,
    "caption": "The same block for each of the three repository shapes. symlinkName only matters when the repo name and the WordPress directory name differ."
  }
}
-->
#### Plugin — .linchpin.json

```json
{
  "wordpress": {
    "contentType": "plugin",
    "pluginSlug": "my-plugin",
    "defaultEnvironment": "studio",
    "environments": {
      "studio": "~/Studio/mysite/wp-content/plugins/my-plugin"
    }
  }
}
```

#### Theme — .linchpin.json

```json
{
  "wordpress": {
    "contentType": "theme",
    "pluginSlug": "my-theme",
    "defaultEnvironment": "localwp",
    "environments": {
      "localwp": "~/Local Sites/mysite/app/public/wp-content/themes/my-theme"
    }
  }
}
```

#### wp-content — .linchpin.json

```json
{
  "wordpress": {
    "contentType": "wp-content",
    "symlinkName": "client-wp-content",
    "defaultEnvironment": "localwp",
    "environments": {
      "localwp": "~/Local Sites/site/app/public/client-wp-content"
    }
  }
}
```

_The same block for each of the three repository shapes. symlinkName only matters when the repo name and the WordPress directory name differ._
<!-- /docspress:block -->

### Every key

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/fields",
  "attrs": {
    "title": ".linchpin.json",
    "description": "Parsed by a Zod schema, so an unreadable file fails with the offending path named rather than a stack trace. Unknown keys are ignored.",
    "fields": [
      {
        "name": "agents",
        "type": "object",
        "required": false,
        "defaultValue": "",
        "description": "Agent name to the directory its repositories live under. Every value is searched when locating a base repo.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "defaultAgent",
        "type": "string",
        "required": false,
        "defaultValue": "",
        "description": "Which agent under agents is searched first. A path you configured is a better guess than a preset one.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "agent",
        "type": "string",
        "required": false,
        "defaultValue": "",
        "description": "Single-agent form, still read. Prefer agents.",
        "values": "conductor, claude-code, codex, custom",
        "deprecated": true
      },
      {
        "name": "agentBasePath",
        "type": "string",
        "required": false,
        "defaultValue": "",
        "description": "Base path for the single-agent form, still read. Prefer agents.",
        "values": "",
        "deprecated": true
      },
      {
        "name": "wordpress.contentType",
        "type": "enum",
        "required": false,
        "defaultValue": "",
        "description": "What this repository is.",
        "values": "plugin, theme, wp-content",
        "deprecated": false
      },
      {
        "name": "wordpress.pluginSlug",
        "type": "string",
        "required": false,
        "defaultValue": "the repo directory name",
        "description": "The WordPress directory name for a plugin or theme.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "wordpress.symlinkName",
        "type": "string",
        "required": false,
        "defaultValue": "the slug, or wp-content",
        "description": "Overrides the directory name the symlink is created under.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "wordpress.defaultEnvironment",
        "type": "string",
        "required": false,
        "defaultValue": "the first environments key",
        "description": "Which environment wt switch uses when --env is omitted.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "wordpress.environments",
        "type": "object",
        "required": false,
        "defaultValue": "",
        "description": "Environment name to the absolute path of the plugin, theme or wp-content slot. An array of {name, path} is still read and normalized.",
        "values": "",
        "deprecated": false
      }
    ],
    "searchable": true,
    "compact": false
  }
}
-->
#### .linchpin.json

Parsed by a Zod schema, so an unreadable file fails with the offending path named rather than a stack trace. Unknown keys are ignored.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `agents` | object | No |  | Agent name to the directory its repositories live under. Every value is searched when locating a base repo. |
| `defaultAgent` | string | No |  | Which agent under agents is searched first. A path you configured is a better guess than a preset one. |
| `agent` | string | No |  | Single-agent form, still read. Prefer agents. |
| `agentBasePath` | string | No |  | Base path for the single-agent form, still read. Prefer agents. |
| `wordpress.contentType` | enum | No |  | What this repository is. |
| `wordpress.pluginSlug` | string | No | the repo directory name | The WordPress directory name for a plugin or theme. |
| `wordpress.symlinkName` | string | No | the slug, or wp-content | Overrides the directory name the symlink is created under. |
| `wordpress.defaultEnvironment` | string | No | the first environments key | Which environment wt switch uses when --env is omitted. |
| `wordpress.environments` | object | No |  | Environment name to the absolute path of the plugin, theme or wp-content slot. An array of {name, path} is still read and normalized. |
<!-- /docspress:block -->

A top-level `environments` or `pluginSlug`, from before the `wordpress` block existed, is still
read and moved into place. `linchpin wt config show` prints the normalized result, which is the
version the CLI actually acts on.

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

## Environment variables

Neither file is the whole story. These are every variable the CLI reads, and the ones you may
usefully set.

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/fields",
  "attrs": {
    "title": "Variables you set",
    "description": "Read at the moment they are needed, so exporting one mid-session takes effect on the next command.",
    "fields": [
      {
        "name": "LINCHPIN_OUTPUT",
        "type": "enum",
        "required": false,
        "defaultValue": "human",
        "description": "Set the output mode once instead of passing a flag per call. Trimmed and lowercased; plain is a synonym for human. An explicit --json, --plain or --quiet still wins.",
        "values": "json, quiet, human, plain",
        "deprecated": false
      },
      {
        "name": "LINCHPIN_CACHE_DIR",
        "type": "string",
        "required": false,
        "defaultValue": "$XDG_CACHE_HOME/linchpin, else ~/.cache/linchpin",
        "description": "Where update-check.json and update-notice.txt live. Set at runtime it also overrides the path baked into the shell-init --notify block.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "LINCHPIN_TRUST_FILE",
        "type": "string",
        "required": false,
        "defaultValue": "$XDG_DATA_HOME/linchpin/trust.json, else ~/.local/share/linchpin/trust.json",
        "description": "Where hook approvals are recorded. Data rather than cache on purpose: clearing a cache should cost a network round trip, never a silent re-grant of code execution.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "LINCHPIN_REGISTRY",
        "type": "url",
        "required": false,
        "defaultValue": "https://registry.npmjs.org",
        "description": "Registry to ask for the latest dist-tag. Falls back to npm_config_registry, then npmjs.org. An unparseable value falls back rather than throwing.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "LINCHPIN_REGISTRY_ALLOW_INSECURE",
        "type": "boolean",
        "required": false,
        "defaultValue": "unset",
        "description": "Permit an http registry. Loopback hosts are allowed without it. Any value other than empty or 0 counts as set.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "LINCHPIN_NO_UPDATE_NOTIFIER",
        "type": "boolean",
        "required": false,
        "defaultValue": "unset",
        "description": "Never print the update notice, after a command or at shell startup. The conventional NO_UPDATE_NOTIFIER is honored identically. Empty, 0 and false all count as unset.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "NO_COLOR",
        "type": "boolean",
        "required": false,
        "defaultValue": "unset",
        "description": "Standard opt-out. Any non-empty value disables color, and beats FORCE_COLOR.",
        "values": "",
        "deprecated": false
      },
      {
        "name": "FORCE_COLOR",
        "type": "boolean",
        "required": false,
        "defaultValue": "unset",
        "description": "Force color on even when stdout is not a TTY or an agent is detected.",
        "values": "",
        "deprecated": false
      }
    ],
    "searchable": true,
    "compact": false
  }
}
-->
#### Variables you set

Read at the moment they are needed, so exporting one mid-session takes effect on the next command.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `LINCHPIN_OUTPUT` | enum | No | human | Set the output mode once instead of passing a flag per call. Trimmed and lowercased; plain is a synonym for human. An explicit --json, --plain or --quiet still wins. |
| `LINCHPIN_CACHE_DIR` | string | No | $XDG_CACHE_HOME/linchpin, else ~/.cache/linchpin | Where update-check.json and update-notice.txt live. Set at runtime it also overrides the path baked into the shell-init --notify block. |
| `LINCHPIN_TRUST_FILE` | string | No | $XDG_DATA_HOME/linchpin/trust.json, else ~/.local/share/linchpin/trust.json | Where hook approvals are recorded. Data rather than cache on purpose: clearing a cache should cost a network round trip, never a silent re-grant of code execution. |
| `LINCHPIN_REGISTRY` | url | No | https://registry.npmjs.org | Registry to ask for the latest dist-tag. Falls back to npm_config_registry, then npmjs.org. An unparseable value falls back rather than throwing. |
| `LINCHPIN_REGISTRY_ALLOW_INSECURE` | boolean | No | unset | Permit an http registry. Loopback hosts are allowed without it. Any value other than empty or 0 counts as set. |
| `LINCHPIN_NO_UPDATE_NOTIFIER` | boolean | No | unset | Never print the update notice, after a command or at shell startup. The conventional NO_UPDATE_NOTIFIER is honored identically. Empty, 0 and false all count as unset. |
| `NO_COLOR` | boolean | No | unset | Standard opt-out. Any non-empty value disables color, and beats FORCE_COLOR. |
| `FORCE_COLOR` | boolean | No | unset | Force color on even when stdout is not a TTY or an agent is detected. |
<!-- /docspress:block -->

### Variables the CLI only reads

You do not set these; something else does, and the CLI adapts.

| Variable | Set by | What it changes |
| --- | --- | --- |
| `AI_AGENT` | Claude Code and other agents | Suppresses the update notice and drops color. Detection only ever *removes* decoration — it never adds an obligation the caller then has to satisfy |
| `CI` and the other provider flags | CI systems, via `std-env` | Suppresses the update notice, and counts toward the non-interactive check |
| `SHELL` | your login shell | Which wrapper `shell-init` emits when `--shell` is omitted |
| `XDG_CACHE_HOME`, `XDG_DATA_HOME` | your environment | Where the cache and the trust file default to |
| `LOCALAPPDATA` | Windows | Trust file location, when `XDG_DATA_HOME` is unset |
| `npm_config_registry` | npm, during `npm install` | Registry fallback when `LINCHPIN_REGISTRY` is unset |
| `LINCHPIN_UPDATE_CHECK_CHILD` | the CLI itself | Marks the detached refresh process so it cannot spawn a refresh of its own |

<!-- docspress:block
{
  "version": 1,
  "name": "docspress/callout",
  "attrs": {
    "tone": "warning",
    "title": "A registry variable is only as trustworthy as whatever set it",
    "content": "<p><code>LINCHPIN_REGISTRY</code> and <code>npm_config_registry</code> come from a <code>.envrc</code>, a CI config, or a shell profile. A plaintext registry is a downgrade anyone on the network path can answer, so <code>http</code> is refused unless the host is loopback or <code>LINCHPIN_REGISTRY_ALLOW_INSECURE</code> says otherwise.</p><p>Text the registry chose — a status line, a dist-tag — is stripped of control characters and length-capped before it reaches a terminal, because the update notice is a natural place to forge a line the reader trusts.</p>",
    "collapsible": false
  }
}
-->
> [!WARNING]
>
> **A registry variable is only as trustworthy as whatever set it**
>
> `LINCHPIN_REGISTRY` and `npm_config_registry` come from a `.envrc`, a CI config, or a shell profile. A plaintext registry is a downgrade anyone on the network path can answer, so `http` is refused unless the host is loopback or `LINCHPIN_REGISTRY_ALLOW_INSECURE` says otherwise.
>
> Text the registry chose — a status line, a dist-tag — is stripped of control characters and length-capped before it reaches a terminal, because the update notice is a natural place to forge a line the reader trusts.
<!-- /docspress:block -->
