import { spawn } from 'node:child_process';

import {
  clearUpdateNotice,
  isCacheFresh,
  isUpdateAvailable,
  readUpdateCache,
  writeUpdateNotice,
  type Installation,
} from '../core/update.js';
import { isAgent, isCI } from './interactive.js';
import type { Output } from './output.js';

/**
 * Telling someone a newer version exists, without ever being in the way.
 *
 * Two rules shape this file. The notice costs no latency — it is read from a
 * cache file and refreshed by a process that outlives this one. And it never
 * lands on stdout, so `cd "$(linchpin wt switch)"` keeps working and a `--json`
 * envelope stays the only thing a parser sees.
 */

/** Commands that report update state themselves; a second notice would be noise. */
const SELF_REPORTING = new Set(['version', 'update']);

/** Marks the detached refresh, so it cannot spawn a refresh of its own. */
export const CHILD_ENV_FLAG = 'LINCHPIN_UPDATE_CHECK_CHILD';

function isEnabled(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0' && value !== 'false';
}

/**
 * Whether this invocation may be told about a new version.
 *
 * Agents and CI are excluded on purpose. An agent parses what a command emits,
 * and an unrequested line on stderr is a token cost it cannot act on — the
 * structured answer is available on demand through `linchpin version --check
 * --json` instead.
 */
export function notificationsAllowed(): boolean {
  if (isEnabled(process.env.LINCHPIN_NO_UPDATE_NOTIFIER)) return false;
  if (isEnabled(process.env.NO_UPDATE_NOTIFIER)) return false;
  if (isEnabled(process.env[CHILD_ENV_FLAG])) return false;
  return !isCI() && !isAgent();
}

export function renderUpdateNotice(
  current: string,
  latest: string,
  installation: Installation
): string {
  const lines = [`Update available: ${current} → ${latest}`];

  lines.push(
    installation.command
      ? '  Run: linchpin update'
      : `  ${installation.hint}`
  );

  return lines.join('\n');
}

/**
 * Keep the pre-rendered shell-startup notice in step with what we now know.
 *
 * Cheap enough to call after every command: `writeUpdateNotice` skips a write
 * that would not change the file, so the steady state is one small read.
 *
 * A copy that cannot update itself — a source checkout, an `npx` run — neither
 * writes nor clears. It has no standing to speak: the notice on this machine
 * was written by the global install, and a `npm link`ed working tree wiping it
 * would silence a release for a shell that had nothing to do with the checkout.
 */
export function syncNoticeFile(options: {
  readonly current: string;
  readonly latest: string | undefined;
  readonly installation: Installation;
}): void {
  try {
    if (options.installation.command === undefined) return;

    if (!isUpdateAvailable(options.current, options.latest)) {
      clearUpdateNotice();
      return;
    }

    writeUpdateNotice(
      // Non-null: isUpdateAvailable is false for an absent latest.
      renderUpdateNotice(options.current, options.latest ?? '', options.installation)
    );
  } catch {
    // The notice is a convenience. Never let it affect the command that ran.
  }
}

/**
 * Refresh the cache in a process that outlives this one.
 *
 * `detached` plus `unref()` plus ignored stdio is what keeps a piped caller from
 * waiting on a registry round trip it never asked for.
 */
function spawnBackgroundCheck(entryPath: string): void {
  try {
    const child = spawn(process.execPath, [entryPath, 'version', '--check', '--quiet'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, [CHILD_ENV_FLAG]: '1' },
    });

    child.unref();
  } catch {
    // A refusal to spawn is not the user's problem; the notice simply waits.
  }
}

/**
 * Warn about a newer version, and top up the cache when it has gone stale.
 *
 * Call this *after* the command has run, so a failure in here can never affect
 * the thing the user asked for.
 */
export function notifyAboutUpdates(
  output: Output,
  options: {
    readonly current: string;
    readonly installation: Installation;
    readonly entryPath: string;
    readonly commandName: string | undefined;
  }
): void {
  if (output.mode !== 'human') return;
  if (!notificationsAllowed()) return;
  if (options.commandName !== undefined && SELF_REPORTING.has(options.commandName)) return;

  // Nothing to upgrade, so nothing worth saying — a source checkout or an npx
  // run would only get a notice it cannot act on.
  if (options.installation.command === undefined) return;

  const cache = readUpdateCache();

  if (isUpdateAvailable(options.current, cache?.latest)) {
    // Non-null: isUpdateAvailable is false for an absent latest.
    output.warn(renderUpdateNotice(options.current, cache?.latest ?? '', options.installation));
  }

  // Keeps the shell-startup notice honest for someone who updated with their
  // package manager directly: the next command they run clears the file, rather
  // than every new shell repeating a notice until the cache next refreshes.
  syncNoticeFile({
    current: options.current,
    latest: cache?.latest,
    installation: options.installation,
  });

  if (!isCacheFresh(cache)) spawnBackgroundCheck(options.entryPath);
}
