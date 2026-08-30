import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Version detection: is a newer release published, and what would install it?
 *
 * Nothing here writes to a stream or exits. `cli/update-notifier.ts` owns the
 * policy (who gets told) and the rendering; this file owns the facts.
 */

/** Default registry. Overridden by LINCHPIN_REGISTRY, then npm's own config. */
export const REGISTRY_URL = 'https://registry.npmjs.org';

/** How long a registry answer is trusted before it is worth asking again. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Short enough that a background refresh cannot outlive the shell that spawned it. */
export const FETCH_TIMEOUT_MS = 3_000;

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * Where this copy came from. `source` is a clone or `npm link`; `npx` is a
 * one-off run that already fetched the version it was asked for.
 */
export type InstallScope = 'global' | 'local' | 'npx' | 'source';

export interface Installation {
  readonly manager: PackageManager;
  readonly scope: InstallScope;
  /** argv that upgrades this install, or undefined when no single command can. */
  readonly command: readonly string[] | undefined;
  /** What to tell a caller `command` cannot help. */
  readonly hint: string;
  readonly path: string;
}

export interface UpdateCache {
  /** Epoch ms. */
  readonly checkedAt: number;
  readonly latest: string;
  /** The version that performed the check, kept for debugging a stale file. */
  readonly current: string;
}

export type UpdateSource = 'registry' | 'cache' | 'none';

export interface UpdateStatus {
  readonly current: string;
  readonly latest: string | undefined;
  readonly updateAvailable: boolean;
  /** Epoch ms of the answer being reported, or undefined when there is none. */
  readonly checkedAt: number | undefined;
  readonly source: UpdateSource;
  /** Why the registry could not be reached, when that is why `latest` is absent. */
  readonly error: string | undefined;
}

interface ParsedVersion {
  readonly parts: readonly [number, number, number];
  readonly prerelease: readonly string[];
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;

function parseVersion(value: string): ParsedVersion | undefined {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return undefined;

  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

/** Compare two prerelease identifier lists per semver's precedence rules. */
function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  // A release outranks any prerelease of the same numbers: 1.2.0 > 1.2.0-rc.1.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index];
    const right = b[index];

    // A shorter set of identifiers has lower precedence.
    if (left === undefined) return -1;
    if (right === undefined) return 1;

    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);

    if (leftNumeric && rightNumeric) {
      if (Number(left) !== Number(right)) return Number(left) < Number(right) ? -1 : 1;
      continue;
    }

    // Numeric identifiers always have lower precedence than alphanumeric ones.
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (left !== right) return left < right ? -1 : 1;
  }

  return 0;
}

/**
 * -1, 0 or 1, the way `Array#sort` wants it.
 *
 * An unparseable version compares equal rather than greater. A registry that
 * answers with something unexpected must never be read as "you are out of
 * date" — that would nag every single invocation with no way to satisfy it.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;

  for (let index = 0; index < 3; index += 1) {
    const l = left.parts[index] ?? 0;
    const r = right.parts[index] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

/** True when `latest` is a version worth moving to from `current`. */
export function isUpdateAvailable(current: string, latest: string | undefined): boolean {
  if (!latest) return false;
  return compareVersions(latest, current) > 0;
}

/**
 * Cache location, XDG first so a user who has moved their cache is respected.
 *
 * Exposed through `linchpin version --json` as `cachePath`, so uninstall
 * instructions can name the real directory rather than guess at it.
 */
export function cacheDirectory(): string {
  const explicit = process.env.LINCHPIN_CACHE_DIR?.trim();
  if (explicit) return explicit;

  const xdg = process.env.XDG_CACHE_HOME?.trim();
  if (xdg) return join(xdg, 'linchpin');

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA?.trim();
    if (local) return join(local, 'linchpin', 'cache');
  }

  return join(homedir(), '.cache', 'linchpin');
}

export function updateCachePath(): string {
  return join(cacheDirectory(), 'update-check.json');
}

/**
 * Read the last answer. Never throws: a corrupt or unreadable cache means "ask
 * again", not "fail the command the user actually ran".
 */
export function readUpdateCache(path: string = updateCachePath()): UpdateCache | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('checkedAt' in parsed) ||
      !('latest' in parsed) ||
      typeof parsed.checkedAt !== 'number' ||
      typeof parsed.latest !== 'string'
    ) {
      return undefined;
    }

    const current =
      'current' in parsed && typeof parsed.current === 'string' ? parsed.current : '';

    return { checkedAt: parsed.checkedAt, latest: parsed.latest, current };
  } catch {
    return undefined;
  }
}

/** Persist an answer. Returns whether it landed; a read-only home is not fatal. */
export function writeUpdateCache(cache: UpdateCache, path: string = updateCachePath()): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the pre-rendered shell-startup notice lives.
 *
 * A separate file from the cache on purpose. The cache is an answer that still
 * has to be interpreted — compare two versions, work out the install command —
 * and doing that at every shell startup would mean starting Node before the
 * first prompt. This file holds the finished text, so the shell snippet emitted
 * by `linchpin shell-init --notify` is a `test` and a `cat`.
 */
export function updateNoticePath(): string {
  return join(cacheDirectory(), 'update-notice.txt');
}

/**
 * Write the notice a shell should print, skipping the write when it would not
 * change the file.
 *
 * Deliberately plain text, with no ANSI: the process that writes it is detached
 * with its stdio ignored, so it has no terminal to detect colour support
 * against, and the shell that eventually `cat`s it may be redirecting anywhere.
 */
export function writeUpdateNotice(text: string, path: string = updateNoticePath()): boolean {
  const content = text.endsWith('\n') ? text : `${text}\n`;

  try {
    if (readFileSync(path, 'utf8') === content) return true;
  } catch {
    // No readable file yet, which is the normal first-write case.
  }

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Remove the notice. Absence is the "nothing to say" state, so this is a no-op when it is gone. */
export function clearUpdateNotice(path: string = updateNoticePath()): boolean {
  try {
    rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** The notice text a shell would print right now, or undefined when there is none. */
export function readUpdateNotice(path: string = updateNoticePath()): string | undefined {
  try {
    const text = readFileSync(path, 'utf8');
    return text.trim() === '' ? undefined : text;
  } catch {
    return undefined;
  }
}

export function isCacheFresh(
  cache: UpdateCache | undefined,
  maxAgeMs: number = CHECK_INTERVAL_MS,
  now: number = Date.now()
): boolean {
  if (!cache) return false;
  const age = now - cache.checkedAt;
  // A checkedAt in the future means a clock change, not a fresh answer.
  return age >= 0 && age < maxAgeMs;
}

function registryBase(override?: string): string {
  const candidate =
    override ??
    process.env.LINCHPIN_REGISTRY?.trim() ??
    process.env.npm_config_registry?.trim() ??
    REGISTRY_URL;

  return candidate.replace(/\/+$/, '');
}

/**
 * Ask the registry for the `latest` dist-tag.
 *
 * The dist-tags endpoint rather than the packument: one small JSON object
 * instead of every version's metadata, which for a package with a long history
 * is the difference between a kilobyte and a megabyte.
 */
export async function fetchLatestVersion(options: {
  readonly packageName: string;
  readonly registry?: string;
  readonly timeoutMs?: number;
}): Promise<string> {
  const base = registryBase(options.registry);
  const url = `${base}/-/package/${encodeURIComponent(options.packageName)}/dist-tags`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(
      `${options.packageName}: registry answered ${String(response.status)} ${response.statusText}`
    );
  }

  const body: unknown = await response.json();

  if (
    typeof body !== 'object' ||
    body === null ||
    !('latest' in body) ||
    typeof body.latest !== 'string'
  ) {
    throw new Error(`${options.packageName}: registry response has no "latest" dist-tag`);
  }

  return body.latest;
}

/**
 * The current update picture, from the cache when it is fresh enough.
 *
 * `cacheOnly` is the notifier's path: it must add no latency to a command the
 * user actually asked for, so it reports whatever is on disk — even stale — and
 * leaves refreshing to a detached process.
 */
export async function resolveUpdateStatus(options: {
  readonly packageName: string;
  readonly current: string;
  readonly refresh?: boolean;
  readonly cacheOnly?: boolean;
  readonly maxAgeMs?: number;
  readonly registry?: string;
  readonly timeoutMs?: number;
  readonly cachePath?: string;
}): Promise<UpdateStatus> {
  const cachePath = options.cachePath ?? updateCachePath();
  const cache = readUpdateCache(cachePath);

  const fromCache = (source: UpdateSource): UpdateStatus => ({
    current: options.current,
    latest: cache?.latest,
    updateAvailable: isUpdateAvailable(options.current, cache?.latest),
    checkedAt: cache?.checkedAt,
    source: cache ? source : 'none',
    error: undefined,
  });

  if (options.cacheOnly) return fromCache('cache');
  if (!options.refresh && isCacheFresh(cache, options.maxAgeMs)) return fromCache('cache');

  try {
    const latest = await fetchLatestVersion({
      packageName: options.packageName,
      ...(options.registry === undefined ? {} : { registry: options.registry }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });

    const checkedAt = Date.now();
    writeUpdateCache({ checkedAt, latest, current: options.current }, cachePath);

    return {
      current: options.current,
      latest,
      updateAvailable: isUpdateAvailable(options.current, latest),
      checkedAt,
      source: 'registry',
      error: undefined,
    };
  } catch (error) {
    // A registry that cannot be reached is not a failed command. Report what is
    // known, name why it is not newer, and let the caller decide.
    const message = error instanceof Error ? error.message : String(error);
    return { ...fromCache('cache'), error: message };
  }
}

/** The path this process is actually running from, symlinks resolved. */
export function currentInstallPath(): string {
  const entry = process.argv[1];

  if (entry !== undefined && entry !== '') {
    try {
      return realpathSync(entry);
    } catch {
      return entry;
    }
  }

  return fileURLToPath(import.meta.url);
}

function containsSegment(path: string, fragment: string): boolean {
  return path.includes(fragment.split('/').join(sep));
}

/**
 * Work out how this copy was installed, and therefore what would update it.
 *
 * Read from the path the process is running from rather than from an env var,
 * because `npm_config_user_agent` is only set when npm itself is the parent —
 * which it is during `npm install`, and never when a user runs `linchpin`.
 */
export function detectInstallation(
  packageName: string,
  path: string = currentInstallPath()
): Installation {
  const at = `${packageName}@latest`;

  // A one-off run already fetched what it was asked for; there is nothing local
  // to upgrade, and telling someone to install globally would be a different
  // decision than the one they made.
  if (containsSegment(path, '/_npx/')) {
    return {
      manager: 'npm',
      scope: 'npx',
      command: undefined,
      hint: `npx fetches a fresh copy each run. Install it for good with: npm install -g ${packageName}`,
      path,
    };
  }

  if (containsSegment(path, '/.bun/')) {
    return {
      manager: 'bun',
      scope: 'global',
      command: ['bun', 'add', '-g', at],
      hint: '',
      path,
    };
  }

  if (
    containsSegment(path, '/.pnpm/') ||
    containsSegment(path, '/pnpm/global/') ||
    containsSegment(path, '/Library/pnpm/') ||
    containsSegment(path, '/.local/share/pnpm/')
  ) {
    return {
      manager: 'pnpm',
      scope: 'global',
      command: ['pnpm', 'add', '-g', at],
      hint: '',
      path,
    };
  }

  if (
    containsSegment(path, '/.yarn/') ||
    containsSegment(path, '/yarn/global/') ||
    containsSegment(path, '/.config/yarn/global/')
  ) {
    return {
      manager: 'yarn',
      scope: 'global',
      command: ['yarn', 'global', 'add', at],
      hint: 'Yarn 2+ has no global add — install with npm instead.',
      path,
    };
  }

  if (containsSegment(path, '/node_modules/')) {
    // A global npm prefix always ends in `lib/node_modules` on macOS and Linux,
    // and `npm/node_modules` under AppData on Windows. Anything else is a
    // project-local dependency, which must not be upgraded with `-g`.
    const global =
      containsSegment(path, '/lib/node_modules/') || containsSegment(path, '/npm/node_modules/');

    return {
      manager: 'npm',
      scope: global ? 'global' : 'local',
      command: global ? ['npm', 'install', '-g', at] : ['npm', 'install', at],
      hint: '',
      path,
    };
  }

  // Outside node_modules entirely: a clone, or `npm link` pointing the global
  // bin at a working tree. Updating that means git, not a package manager.
  return {
    manager: 'npm',
    scope: 'source',
    command: undefined,
    hint: 'Running from a source checkout. Update with: git pull && npm install && npm run build',
    path,
  };
}

/** An argv rendered as something a person can paste into a shell. */
export function formatCommand(command: readonly string[]): string {
  return command.join(' ');
}

/** "just now", "3 hours ago" — enough precision to judge whether to re-check. */
export function formatAge(checkedAt: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - checkedAt) / 1000));

  if (seconds < 60) return 'just now';

  const units: readonly [number, string][] = [
    [60, 'minute'],
    [60, 'hour'],
    [24, 'day'],
  ];

  let value = seconds;
  let label = 'second';

  for (const [factor, name] of units) {
    if (value < factor) break;
    value = Math.floor(value / factor);
    label = name;
  }

  return `${String(value)} ${label}${value === 1 ? '' : 's'} ago`;
}
