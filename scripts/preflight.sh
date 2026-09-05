#!/usr/bin/env bash
#
# Run what CI runs, before CI runs it.
#
#   scripts/preflight.sh              the local gates: typecheck, build, test
#   scripts/preflight.sh --linux      the same gates on Linux, on every Node in
#                                     the CI matrix, plus the agent-readiness floor
#   scripts/preflight.sh --linux --node 24        one version of the matrix
#   scripts/preflight.sh --linux --no-agent-lint  gates only, no network
#
# Why --linux exists: this repo shells out — to bash, to git, to the filesystem —
# and those differ between a macOS workstation and an ubuntu-latest runner. bash
# 3.2 and bash 5 word the same warning differently; BSD and GNU coreutils take
# different flags; the macOS filesystem is case-insensitive. A green local run is
# evidence about macOS, not about CI. --linux is the evidence about CI.
#
# The container gets a *clean checkout plus your uncommitted edits*: ignored
# files are removed inside it, so an untracked file on your workstation cannot
# make a gate pass that would fail on a fresh clone.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$REPO/.github/workflows/ci.yml"

LINUX=0
AGENT_LINT=1
NODE_VERSIONS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --linux) LINUX=1 ;;
    --node) NODE_VERSIONS=("$2"); shift ;;
    --no-agent-lint) AGENT_LINT=0 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "preflight: unknown option '$1'" >&2; exit 2 ;;
  esac
  shift
done

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✖ %s\033[0m\n' "$1" >&2; exit 1; }

# --- The local gates ---------------------------------------------------------

step 'Local: typecheck'
npm run --silent typecheck

step 'Local: build'
npm run --silent build

step 'Local: test'
npm test

if [ "$LINUX" -eq 0 ]; then
  printf '\n\033[32m✔ Local gates pass.\033[0m\n'
  printf 'These ran on %s. CI runs on Linux — if this change touches shell, git,\n' "$(uname -s)"
  printf 'paths or process behaviour, confirm it there too:  npm run preflight:linux\n'
  exit 0
fi

# --- The CI matrix, on Linux -------------------------------------------------

command -v docker >/dev/null 2>&1 || fail 'docker is not installed; --linux needs it'
docker info >/dev/null 2>&1 || fail 'docker is installed but not running'

# Read the matrix out of the workflow rather than restating it, so the preflight
# cannot drift away from the thing it is previewing.
if [ "${#NODE_VERSIONS[@]}" -eq 0 ]; then
  matrix_line="$(grep -E "^ *node: \[" "$WORKFLOW" || true)"
  # shellcheck disable=SC2207
  NODE_VERSIONS=($(printf '%s' "$matrix_line" | grep -oE "'[0-9.]+'" | tr -d "'"))
  [ "${#NODE_VERSIONS[@]}" -gt 0 ] || fail "could not read the node matrix from $WORKFLOW"
fi

LINT_VERSION="$(grep -E "^ *CLI_AGENT_LINT_VERSION:" "$WORKFLOW" | grep -oE "'[^']+'" | tr -d "'")"
LINT_FLOOR="$(grep -E "^ *CLI_AGENT_LINT_MIN_SCORE:" "$WORKFLOW" | grep -oE "'[^']+'" | tr -d "'")"
# bash 3.2 ships on macOS and has no negative array indexing.
LAST_NODE="${NODE_VERSIONS[$(( ${#NODE_VERSIONS[@]} - 1 ))]}"

printf '\nMatrix from %s: node %s\n' ".github/workflows/ci.yml" "${NODE_VERSIONS[*]}"

# npm's cache and the linter binary survive between runs, so only the first
# preflight of the day pays for them.
docker volume create linchpin-preflight-npm >/dev/null
docker volume create linchpin-preflight-tools >/dev/null

# Staged into /work rather than run from the mount: the mount is read-only, and
# a build must not write Linux artifacts into the host's dist/ or node_modules/.
STAGE='
  mkdir -p /work
  tar -C /src --exclude=./node_modules --exclude=./dist -cf - . 2>/dev/null \
    | tar -C /work --no-same-owner -xf -
  cd /work
  git clean -Xdfq
'

for node_version in "${NODE_VERSIONS[@]}"; do
  step "Linux / node ${node_version}: install, typecheck, build, test"
  docker run --rm \
    -v "$REPO:/src:ro" \
    -v linchpin-preflight-npm:/root/.npm \
    -e HUSKY=0 \
    -e CI=1 \
    "node:${node_version}" \
    bash -euo pipefail -c "${STAGE}"'
      npm ci --no-audit --no-fund --silent
      npm run typecheck
      npm run build
      npm test
    ' || fail "Linux / node ${node_version} failed — this is what CI will report"
done

if [ "$AGENT_LINT" -eq 1 ]; then
  step "Linux / node ${LAST_NODE}: agent-readiness (floor ${LINT_FLOOR}%)"
  docker run --rm \
    -v "$REPO:/src:ro" \
    -v linchpin-preflight-npm:/root/.npm \
    -v linchpin-preflight-tools:/tools \
    -e HUSKY=0 \
    -e CI=1 \
    -e CLI_AGENT_LINT_VERSION="$LINT_VERSION" \
    -e CLI_AGENT_LINT_MIN_SCORE="$LINT_FLOOR" \
    "node:${LAST_NODE}" \
    bash -euo pipefail -c "${STAGE}"'
      npm ci --no-audit --no-fund --silent
      npm run build

      bin="/tools/cli-agent-lint-${CLI_AGENT_LINT_VERSION}"
      if [ ! -x "$bin" ]; then
        url="https://github.com/Camil-H/cli-agent-lint/releases/download/v${CLI_AGENT_LINT_VERSION}/cli-agent-lint_${CLI_AGENT_LINT_VERSION}_linux_amd64.tar.gz"
        curl -fsSL -o /tmp/cli-agent-lint.tar.gz "$url"
        tar -xzf /tmp/cli-agent-lint.tar.gz -C /tmp
        install -m 0755 /tmp/cli-agent-lint "$bin"
      fi

      "$bin" check ./dist/cli.js -o json > /tmp/report.json 2>/dev/null || true
      node scripts/agent-lint-report.mjs /tmp/report.json
    ' || fail 'agent-readiness failed — this is what CI will report'
fi

printf '\n\033[32m✔ Linux matrix passes. This is the evidence CI will produce.\033[0m\n'
