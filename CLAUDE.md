# Working in this repo

TypeScript + ESM, built with tsdown into `dist/`. Tests are `node --test` against the
**built** output (`pretest` builds first), so a source change is only tested once it has
been built. Un-ported CommonJS lives in `legacy/`.

## Before you push: preflight

```bash
npm run preflight         # typecheck, build, test — on this machine (~10s)
npm run preflight:linux   # the same gates on Linux, on every Node in the CI matrix,
                          # plus the agent-readiness floor (needs Docker, ~2min)
```

`npm run preflight` also runs automatically on `git push` (husky `pre-push`).

**`npm run preflight` passing is not evidence that CI will pass.** It ran on macOS; CI runs
on `ubuntu-latest`. `preflight:linux` stages the working tree into a `node:<version>`
container, removes ignored files so it is a clean checkout plus your uncommitted edits, and
runs exactly what `.github/workflows/ci.yml` runs. It reads the Node matrix and the
agent-readiness floor out of the workflow file, and scores agent-readiness with the same
`scripts/agent-lint-report.mjs` CI uses, so the preflight cannot drift away from the gate it
is previewing.

## When preflight:linux is not optional

Run it before pushing whenever the change touches anything whose behaviour is supplied by
the operating system rather than by this codebase:

- **Spawning a shell** — `bash`, `sh`, `zsh`, `fish`, or any snippet this CLI emits for one.
- **Shelling out at all** — `git`, `npm`, coreutils. Flags and messages differ between BSD
  and GNU.
- **Filesystem semantics** — case sensitivity, symlinks, permissions, `os.tmpdir()`.
- **Process and TTY behaviour** — job control, signals, detached children, `isatty`.

macOS ships **bash 3.2**; every CI runner has **bash 5**. They differ in features *and* in
wording. This is not hypothetical — it is how [#71][pr71] went red: a test filtered bash's
job-control complaint by matching `no job control`, which is the entire message bash 3.2
prints. bash 5 prints `cannot set terminal process group (N): Inappropriate ioctl for
device` first, so the filter let it through and an `assert.equal(stderr, '')` failed on
Linux only.

[pr71]: https://github.com/linchpin/cli/pull/71

## Writing tests that survive the crossing

- **Never assert on the exact text a system tool emits.** Its wording is version- and
  platform-specific. Assert on the shape you care about, and filter the noise by its
  *family* — every phrasing you know of, not the one your laptop happens to print.
- **Assert positively where you can.** `assert.match(stderr, /Update available/)` is stable;
  `assert.equal(stderr, '')` fails on any unrelated chatter the platform decides to add.
- **Nothing may reach the network.** The update checker runs against a local registry stub
  and the shared fixture sets `LINCHPIN_NO_UPDATE_NOTIFIER`.
- **Nothing may depend on an untracked file.** `preflight:linux` deletes ignored files
  inside the container, which is what a fresh clone looks like. (This is also why the
  agent-readiness score reads ~1.7 points high locally: SD-5 passes off a gitignored
  `.claude/` that CI never sees. Record the number CI reports.)

## Commits and releases

Conventional Commits, enforced by commitlint on `commit-msg`. The scope carries the task key
or `NO-TASK`:

```text
feat(LINCHPIN-4850): add release automation
fix(NO-TASK): filter bash 5's job-control warning too
```

release-please owns `version` in `package.json`, `CHANGELOG.md` and
`.release-please-manifest.json`. Never edit those by hand.
