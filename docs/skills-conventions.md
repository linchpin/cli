# Conventions the CLI must honor, extracted from `linchpin/skills`

**Authored prose — not generated.** `linchpin docs generate` must never clobber this file.

**Task:** [LINCHPIN-5383](https://app.clickup.com/t/86bb9q8je) · **Read against:**
`@linchpinagency/skills` npm `0.1.10`, working tree at `5c553c1` (22 first-party skills +
7 vendored from `WordPress/agent-skills` pinned at `aa735ea`).

The skills library already encodes the conventions this CLI is meant to automate. Building a
command without reading its skill first invents a second, conflicting convention — worse than
none, because an agent finds both and picks unpredictably. **The skills are the spec; the CLI
is their executable form.**

This file is the extraction. Each section names the command, the skill that owns the
convention, and the behavior that follows. Where a convention contradicts the implementation
plan, it is flagged **⚠ CORRECTION** and the plan is wrong until someone decides otherwise.

---

## 0. The rule that binds every command

`write-a-linchpin-skill` house rule 2: **one owner per concern.** Every fact lives in exactly
one skill; skills link rather than restate. The CLI inherits this directly:

> A command may not hardcode a value that a skill tells you to read at runtime.

House rule 1 is the same rule pointed at repos: **detect, don't assume.** `quality-gates`,
`project-context`, and `commit-and-release` all open with it, because Linchpin repos genuinely
differ — commitlint types, PHP gates, and local environments vary per repo. Any command that
reads a repo reads its actual config.

And its corollary, from `quality-gates`:

> **A silently skipped gate reads as a passing gate.**

This is a schema constraint, not a slogan — see §5.

---

## 1. `linchpin commit` — LINCHPIN-5377

Owners: `commit-and-release` (message grammar, release boundary) · `task-tracking` (scope key,
branch) · `quality-gates` (verification before the commit).

### Read the repo, never port a rule

| Read | Yields |
| --- | --- |
| `commitlint.config.{js,cjs}` → `type-enum` | The types **this** repo accepts |
| `commitlint.config.{js,cjs}` → `parserOpts.headerPattern` | The header regex, including which scopes count |
| `release-please-config.json` → `changelog-sections` | Which types surface in the changelog |
| `release-please-config.json` → `extra-files` | Every machine-owned version string — never hand-edit |
| `.release-please-manifest.json` | Current version (machine-owned) |

Real variation the skill names: one repo accepts `update` and `improve`, another omits
`update`, another also accepts `NO-JIRA`, another enforces only sentence-case with no scope
pattern. **Read the file.**

### This repo's actual rules (`commitlint.config.cjs`)

```
type-enum:     improve build chore ci docs feat fix perf refactor revert style test update
headerPattern: ^(improve|build|ci|feat|fix|docs|style|revert|perf|refactor|test|chore)
               \(((?:[A-Z]+-\d+)|(?:NO-TASK)|(?:\#\d+))\):\s?([\w\d\s,\-]*)
subject-case:  sentence-case, severity 1 (warning)
```

### Three validations commitlint itself cannot give you

These are the reason `linchpin commit` is worth building rather than shelling straight to git.

**1. Subject truncation is silent, and it passes.** The subject group is `[\w\d\s,\-]*` —
letters, digits, underscore, whitespace, comma, hyphen. A period, colon, paren, or slash does
not *fail*; it ends the captured subject early. `commit-and-release` gives the worked example,
and this repo's config reproduces it exactly:

```
$ echo "feat(LINCHPIN-5383): Update wp-scripts to v27.1" | npx commitlint --verbose
✔   found 0 problems, 0 warnings      # subject silently parsed as "Update wp-scripts to v27"
```

A clean pass is the worst possible outcome here: nothing downstream ever reports the loss, and
the truncated subject is what reaches the changelog.

> `linchpin commit` must warn when the subject contains a character outside the header
> pattern's subject class, quoting the subject as it will actually parse. This is the single
> highest-value check in the command.

**2. `update` is in `type-enum` but missing from `headerPattern`** — plan bug #8, confirmed by
running it. When `headerPattern` doesn't match, commitlint parses empty fields and reports:

```
$ echo "update(LINCHPIN-5383): Test subject" | npx commitlint
✖   subject may not be empty [subject-empty]
✖   type may not be empty [type-empty]
```

Neither error names `update`, and the message is actively misleading — both a type and a
subject are plainly present. An agent reading this rewrites the wrong thing.

> Reconcile the config as part of this task, and have `linchpin commit` detect the
> type-enum ∖ headerPattern set difference in any repo and name it explicitly.

**3. Scope must be a real key.** `task-tracking`: *never invent a task key*, and never fall back
to the internal id (`86bb9q8je`) because a create returned `custom_id: null`. `NO-TASK` is a
legitimate, always-available answer; a fabricated key is not.

### Guardrails that become refusals

| Skill guardrail | Command behavior |
| --- | --- |
| Never commit with `--no-verify` (`commit-and-release`, `quality-gates`) | Never pass it. Let husky run — see below |
| Never commit directly to `main` | Refuse on the default branch, exit `5`, name `--branch` |
| Never hand-edit `CHANGELOG.md`, the manifest, or any `extra-files` version | Refuse to stage them; exit `5` |
| Never create tags or GitHub releases by hand | Out of scope for this CLI entirely |
| Don't bundle unrelated changes | Not enforceable; state it in `--help` |

⚠ **The `--no-verify` constraint has a design consequence.** If `linchpin commit` validates
against commitlint *and* then runs `git commit`, husky runs commitlint a second time. The
tempting fix is `--no-verify`. Two skills ban it outright. Accept the double-run: pre-validation
exists to give the agent a **structured exit `2` before anything is staged**, not to replace the
hook.

### ⚠ CORRECTION — branch naming is specified, and the plan omits it

`task-tracking` owns branch naming and mandates a form:

- **`issue/<custom_id>`** — the ClickUp custom ID verbatim (`issue/LINCHPIN-5383`), never the
  internal id, never a slug.
- **`no-task/<short-kebab-slug>`** without a task, since a bare `issue/no-task` would collide.
- Created a task after starting NO-TASK? `git branch -m issue/<custom_id>`.
- Cut from an up-to-date `main`.

The plan specifies `linchpin commit --branch <name>` as a free-form string. It should **default
to the skill's form** derived from the resolved scope key, and warn when an explicitly passed
`--branch` doesn't match either shape.

---

## 2. `linchpin pr` — LINCHPIN-5378

Owner: `commit-and-release` for the title, `task-tracking` for the body link.

- **Title follows the commit convention.** Squash merges use the PR title as the commit
  message, so a malformed title breaks the changelog. Same validation path as §1.
- **The body must link the ClickUp task** — `https://app.clickup.com/t/<custom_id>` plus the
  key. For NO-TASK, note explicitly that there is no task.
- A trailing `(#758)` is appended by the PR/release flow, **not by hand**.
- Never push to `main`; PR against the base branch.

`linchpin pr create` should compose the task link into the body automatically from the resolved
scope key, rather than relying on the agent to remember — that is the whole friction argument.

---

## 3. `linchpin task` — LINCHPIN-5379

Owners: `task-tracking` (mechanics) · `engagement-types` (placement) ·
`references/clickup-json.md` (routing file).

### Config: `.clickup.json`, not `.linchpin.json`

Confirmed and already written for this repo. Required keys are **`space`** and
**`defaultList`** only — a two-key file is useful. Optional: `lists`, `folders`,
`moduleRouting`, `unmapped`.

Two rules that outrank the shape:

- **IDs are the contract; names are for humans.** Lists get renamed freely; the id survives.
  Route on the id, display the name.
- **`moduleRouting` points at names, not ids** — a key in `lists` — so a rename is a one-line
  fix instead of a find-and-replace.

`$comment` keys are ignored by every JSON parser and are the sanctioned way to annotate. The
lookup order is `.clickup.json` → a ClickUp section in `CLAUDE.md`/`AGENTS.md` → hierarchy
lookup, and on the third path the CLI should **offer to write the file**.

### Failure behaviors that are specified, not incidental

| Condition | Required behavior | Exit |
| --- | --- | --- |
| No ClickUp credential | **Say so out loud.** "A missing MCP is a reportable condition, not a silent skip" | `4` |
| Pinned list id no longer resolves | Say it and re-look-up. **Never silently fall back to `defaultList`** — "tasks quietly pile up in the wrong place" | `3` |
| `create` returned `custom_id: null` | Re-fetch until populated. `null` means "not yet", never "this space has no keys" | — |
| `--status` not valid for the list | Exit with the valid set named. Statuses are per-Space/List and there are dozens | `2` |

The `custom_id: null` quirk is documented in both the skill and
`references/clickup-mcp-tools.md`, matching the plan's observation independently.

### Hierarchy lookups must be scoped

> **Never dump the full workspace hierarchy into a prompt.**

Call `clickup_get_workspace_hierarchy` with `max_depth: 2` and `space_ids` set to the likely
space. Widen to a space picker only when the space can't be inferred from the git remote or
repo name.

### ⚠ Terminal statuses need gating

`task-tracking`: *never mark a task complete on your own judgment*, *don't close what you can't
verify* — an open PR is at most "in review" — and *subtasks close as they land; the parent
closes last*.

> `linchpin task update --status` is `effect: "write"`, but moving to a **terminal** status
> must require confirmation and refuse in non-interactive contexts without an explicit flag.
> This is the clearest instance of the plan's rule that a confirmation logs a fallback except
> where the operation is destructive, in which case it refuses.

### Placement is `engagement-types`' call, not the CLI's

Space = client or product. Folder = engagement (`Support Requests`, `<Site> Site Maintenance`,
dated `Tasks & Projects`, `Sprint Folder`). **Multi-site clients get a folder per site, and
"which site?" is a required question, not an inference.** *Never create folders or lists to fit
one task.*

> `linchpin task create` resolves within pinned routing. It must not invent structure, and
> should refuse to create a list or folder at all.

---

## 4. `linchpin doctor` — LINCHPIN-5373

Owner: `project-context`. Its "orientation pass" *is* doctor's read half:

```bash
git rev-parse --show-toplevel && git branch --show-current && git remote get-url origin
ls .linchpin.json composer.json package.json phpcs.xml.dist .wp-env.json wrangler.toml
```

The signal table maps directly to checks: repo shape (site repo = repo is `wp-content` /
plugin repo / Workers service), local env, host, release model, ClickUp space from the remote.
Its "what to report" example is the human output format — one or two lines, stated back before
the work starts.

### ⚠ CORRECTION — `--fix` cannot share `doctor`'s effect classification

`project-context` guardrail: **"Never run an environment-changing command as part of
orientation. This pass is read-only."**

The plan specifies `linchpin doctor [--json] [--fix]` as one command carrying one `effect`. It
cannot: bare `doctor` is `read` and belongs in every skill's pre-approved allowlist; `--fix`
mutates. Options, in preference order:

1. Split — `doctor` (`read`) and `doctor fix` (`write`). Cleanest for allowlisting, since a
   prefix rule `Bash(linchpin doctor:*)` would otherwise pre-approve the mutating path.
2. Keep the flag and classify the command as `write`, losing `read` pre-approval for the
   common case.

**Recommend option 1.** The plan's own rule — *treat unclassified as needing confirmation,
never as safe* — argues against a command whose effect depends on a flag.

Two more `project-context` guardrails that shape output: *never assume the environment from a
config file's presence alone* (a leftover `.wp-env.json` in a Studio project is history, not
intent — when two exist, **ask**), and *never infer the host from the repo name* — read the
deploy workflows.

---

## 5. `linchpin check` (deferred) — and the three-state result

Owner: `quality-gates`. Even deferred, one convention constrains `doctor`'s JSON envelope now.

Detection table: `composer.json` → `scripts.lint` · `phpcs.xml.dist` · `phpstan.neon(.dist)` ·
`.php-cs-fixer.dist.php` · `package.json` scripts · `lint-staged.config.js` + `.husky/` ·
**nested `package.json` (gates run in that workspace, not the root)** · `.linchpin.json`.

House order, cheapest failure first: `php-lint` → `phpcs` → `fixer:test` → `phpstan`.

### ⚠ A boolean pass/fail is a spec violation

> **"If a tool can't run (not installed, no config, requires Docker that isn't up), say so
> explicitly. A silently skipped gate reads as a passing gate."**

Plus: *PHPCS with no `phpcs.xml.dist` — skip it and report it. Do not fall back to a global
standard.*

> Every check result in the JSON envelope needs **four** states, not two:
> `pass` · `fail` · `not-applicable` (with the reason) · `could-not-run` (with the reason).
> `doctor --json` must not collapse the last two into either of the first two.

Guardrails that must never become CLI conveniences: never silence a violation to make a gate
pass, never reformat files the change didn't touch, never run `composer update`/`npm update` to
fix a lint failure.

---

## 6. `linchpin skills list | install | update` — LINCHPIN-5383

The library already ships all three behaviors. **Delegate; do not reimplement.**

### `bin/install.mjs` — what it actually does

- Installs into per-agent directories, each a **list** because some agents read more than one:
  `claude-code` → `.claude/skills` · `github-copilot` → `.agents/skills` **and**
  `.github/skills` · `codex` → `.codex/skills` · `cursor` → `.cursor/skills` · `all`.
- `--global` targets `$HOME` instead of cwd; `--list`; `--skip-upstream`; positional skill names.
- Vendors upstream by fetching `codeload.github.com/<repo>/tar.gz/<ref>` and extracting with
  **system `tar`**. Best-effort: any failure warns and continues; the Linchpin install still
  succeeds.
- Writes a stamp at `<dir>/.linchpin-skills/version.json` recording package, version,
  `installedAt`, agent, scope, **the exact `updateCommand` that reproduces the install**, the
  skills, and upstream results — then copies `update-check.mjs` beside it so the installed copy
  is self-contained.
- Stamps **last**, so `upstream` reflects what landed rather than what was intended.
- Exit 1 on unknown skill or unknown agent.

### `bin/update-check.mjs` — the update-nag already exists

Do not write another one. It has: a 24h throttle cached under `XDG_CACHE_HOME`, an off switch
(`LINCHPIN_SKILLS_UPDATE_CHECK=0`), a registry override (`LINCHPIN_SKILLS_REGISTRY`), `--force`,
`--json`, `--hook`, and **exits 0 on every path** — offline, unwritable cache, missing stamp,
malformed JSON — because its stdout becomes SessionStart context and a failure there is the
first thing an agent reads.

⚠ **Do not copy its `CI` check into the CLI's own interactive detection.** It is correct there
(nobody reads a CI log for upgrade nudges) but the plan's central measured finding is that
**`CI` is unset inside Claude Code** while no stream is a TTY. The CLI's mode precedence must
key on `!process.stdout.isTTY`, not `CI`.

### ⚠ CORRECTION — delegating via `npx` reintroduces the exact friction this project exists to remove

The plan's own table lists `npx --yes --package …` as case 3: allowlistable in principle, but
**`npx` is never stripped, so each novel invocation re-prompts.** A `linchpin skills install`
that shells out to `npx @linchpinagency/skills` hands the friction straight back.

> Resolve `bin/install.mjs` from a declared dependency and spawn it by absolute path
> (`import.meta.resolve`), or import it. Never through `npx`.

This collides with the plan's **"one package with zero transitive deps"** build decision, since
`@linchpinagency/skills` ships markdown content that `tsdown` will not bundle. Three options,
none free:

| Option | Cost |
| --- | --- |
| Real runtime dependency on `@linchpinagency/skills` | Breaks "zero transitive deps"; but it is itself zero-dep, so the tree stays depth-1 |
| Vendor the skills as `templates/`-style data at build time | Version skew between CLI and library releases |
| `linchpin skills` shells to a resolved local install, else instructs the user | Degrades when not installed |

**Open decision for LINCHPIN-5366 / LINCHPIN-5381.** Recommend the first: depth-1 on a
zero-dependency, first-party package is a far smaller cost than either alternative, and it is
the only option that satisfies *"produces the same result as the library's own installer"*.

### Mirroring `scripts/validate-skills.mjs`

The house standard, mechanically. Any skill this CLI ships must pass it:

**Frontmatter** — `name` (kebab-case, **must equal the directory name**), `description`
(80–1000 chars, warn over 700, **must match `/\bUse (when|whenever|for|before|after|during)\b/i`**),
`version` (semver).
**Required sections** — `## When to use` · `## Guardrails` · `## Done`.
**Warnings** — body over 200 lines with no `references/` directory.
**Errors** — machine-specific absolute paths (`/Users/…`, `/home/…`, `C:\…`) unless the user
segment is a placeholder; a referenced relative path that doesn't exist; **not being listed in
the README's "Available skills" table**.

That last check is repo-local: it reads the *library's* README. Mirroring the validator here
means this repo needs its own skills catalog table and its own validator run wired to `test`
and `prepublishOnly`, exactly as the library does.

---

## 7. `linchpin agent setup` — LINCHPIN-5374

Owner: `safety-hooks`, which is the library's **one deliberately Claude-Code-only skill** and
documents the precedent for making that trade explicitly.

Its self-description is the honesty bar `agent setup` must clear:

> **"This is a speed bump, not a sandbox. It fails *open*… Never describe it to a client or
> teammate as a security control."**

- Guardrails: never disable a hook to get a command through; never widen the safe-exception
  list to silence a prompt; **never set an edit boundary without telling the user**.
- If `agent setup` writes hook config, it must report what it turned on and how to clear it.
- The plan's own requirement stands: tell the user that **project allow rules do not take
  effect until workspace trust is accepted**, while deny/ask rules apply regardless.

### ⚠ CORRECTION — `allowed-tools:` contradicts the house standard as written

`write-a-linchpin-skill`, on frontmatter:

> "Optional and portable: nothing else is needed. **Avoid agent-specific keys (`allowed-tools`,
> `context: fork`)** unless a skill genuinely can't work without them — they're ignored or
> mishandled by other agents."

Phase 5 of the plan proposes shipping skills whose frontmatter carries exactly
`allowed-tools: Bash(linchpin commit *) …`. That is the "genuinely can't work without them"
case — pre-approval *is* the feature — but the standard requires it be deliberate rather than
incidental.

> Follow the precedent `safety-hooks` set: give the bundled skills a short **"Portability
> exception"** section stating that they are Claude-Code-targeted, why, and what degrades
> elsewhere. Do not let `allowed-tools` appear without that note.

---

## 8. Config layering — LINCHPIN-5370

Two files, two owners, and they do not merge:

| File | Owner | Contents |
| --- | --- | --- |
| `.clickup.json` | `task-tracking` | Space, default list, list/folder maps, module routing |
| `.linchpin.json` | `project-context` | Plugin slug, declared local environments and paths, preferred agent |

`project-context` describes `.linchpin.json` as "house metadata — plugin slug, declared local
environments and their paths, preferred agent". `quality-gates` lists it as optional
("not every repo has one"), and `toolchain.md` treats
`.linchpin.json → wordpress.environments` as a **legacy** LocalWP/declared-path signal, with
Studio as the default for new work.

This independently confirms the plan's Phase 1 warning: `normalizeConfig` currently **throws**
`'Config is missing wordpress.environments'`, so every command reading config requires a
WordPress environment map. `commit`, `pr`, `task`, and `json` must work in a repo that has none
— and per the skills, a repo having none is now the *normal* case, not an edge case.

Packaging note from `clickup-json.md`: exclude `.clickup.json` from distributables
(`.distignore`, `.npmignore` or a `files` allowlist). It holds no secrets — IDs are not
credentials — but it is dev-time metadata with no runtime meaning. **This repo's
`package.json` uses a `files` allowlist, so it is already excluded.**

---

## 9. Effect classification, seeded from the skills

The plan requires `effect: "read" | "write" | "destructive"` on every command and CI failure on
any unclassified one. The skills settle several:

| Command | Effect | Skill basis |
| --- | --- | --- |
| `doctor` (no `--fix`) | `read` | `project-context`: "this pass is read-only" |
| `doctor fix` | `write` | Same guardrail, inverted — see §4 |
| `schema`, `completion`, `skills list` | `read` | No side effects |
| `commit`, `pr create/edit/comment` | `write` | — |
| `commit` on the default branch | **refuse**, exit `5` | `commit-and-release`: never commit directly to `main` |
| `task create`, `task comment` | `write` | — |
| `task update --status <terminal>` | `write` + confirm | `task-tracking`: never mark complete on your own judgment |
| `skills install`, `skills update` | `write` | Overwrites installed skill directories in place |
| `agent setup` | `write` | Writes settings and hook config |
| `json set/patch/merge` | `write` | — |

`skills install` deserves a note: the library's installer **`rmSync` + `cpSync` each destination
skill directory**, and `write-a-linchpin-skill` warns *never hand-edit skills in a consuming
project's `.claude/skills/` — the installer overwrites them.* That is `write` with real data
loss for anyone who ignored the warning; `--dry-run` should list exactly which directories
would be replaced.

---

## 10. What the CLI must not build

| Tempting | Why not |
| --- | --- |
| Its own update-nag | `bin/update-check.mjs` exists, is battle-hardened around SessionStart, and is copied next to every install |
| Its own skill installer | `bin/install.mjs` owns four agents' directory conventions and the pinned-SHA vendoring |
| Its own upstream vendoring scheme | `upstream.json` is the pattern: `{repo, ref (commit SHA), license, skills[]}`, pinned deliberately and re-tested on bump |
| Its own skill validator rules | Mirror `scripts/validate-skills.mjs`; don't diverge |
| A GitHub issue path in `linchpin task` | `task-tracking`: "issue/task/ticket/bug" all mean ClickUp unless the user names GitHub |
| Folder/list creation in `linchpin task` | `engagement-types`: never create folders or lists to fit one task |

`upstream.json` also carries the discipline, not just the shape: *don't bump the pinned `ref`
as a side effect of unrelated work; it changes agent behavior silently and needs its own
re-test.* Any CLI command that touches it must refuse to bump it implicitly.

---

## 11. Acceptance criteria — status

From LINCHPIN-5383:

- [x] **Read all 22 first-party skills; write down every convention a command must honor** —
      this document.
- [x] **Check `bin/update-check.mjs` before writing any update-nag of our own** — §6. Verdict:
      write none.
- [x] **Reuse `upstream.json`'s pinned-SHA vendoring pattern** — §10, shape and discipline recorded.
- [x] **Mirror `scripts/validate-skills.mjs`** — §6, rules extracted; needs a local catalog table.
- [x] `.clickup.json` written for this repo and validated against the documented schema.
- [ ] **Support `.clickup.json` in `core/config.ts` alongside `.linchpin.json`** — blocked:
      `core/` does not exist (LINCHPIN-5366, LINCHPIN-5370). Spec in §8.
- [ ] **Add `linchpin skills list | install | update`** — blocked on the registry
      (LINCHPIN-5367). Spec and the delegation decision in §6.
- [ ] **`linchpin task create` resolves its list from `.clickup.json` with no flags** — blocked
      on LINCHPIN-5379. Routing file is in place, so this is now a code-only task.
- [ ] **No convention in this CLI contradicts a shipped skill** — four contradictions found and
      recorded (§1 branch naming, §4 `doctor --fix`, §6 `npx` delegation, §7 `allowed-tools`).
      Open until each is decided.

## Open decisions this raised

1. **`doctor --fix` vs `doctor fix`** (§4) — recommend the subcommand split.
2. **How `linchpin skills` depends on the library** (§6) — recommend a real depth-1 dependency;
   affects the zero-transitive-deps build decision in LINCHPIN-5366.
3. **Whether bundled skills may carry `allowed-tools`** (§7) — recommend yes, with a stated
   portability exception per `safety-hooks`' precedent.
4. **Reconciling `update` in this repo's commitlint config** (§1) — plan bug #8; decide whether
   to add it to `headerPattern` or drop it from `type-enum`.
