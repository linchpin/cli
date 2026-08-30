import { cacheDirectory } from '../core/update.js';
import { CHILD_ENV_FLAG } from './update-notifier.js';

/**
 * The shell-startup half of update notification.
 *
 * The notifier in `update-notifier.ts` only speaks after someone runs a
 * command, which means the person most likely to be out of date — the one who
 * has not opened the CLI in a fortnight — is exactly the person it never
 * reaches. This emits a snippet for their shell profile instead, so a release
 * is announced by opening a terminal.
 *
 * Two properties make it safe to put in a profile:
 *
 * **No Node on the startup path.** The common case is `test` plus `cat` against
 * a pre-rendered file. Starting the CLI to decide whether to say anything would
 * put ~100ms in front of every new prompt, several times a day, to print
 * nothing on all but a handful of them.
 *
 * **Nothing runs in the foreground.** The refresh is detached and redirected to
 * /dev/null, so a slow or unreachable registry can never hold up a prompt.
 *
 * Nothing here is terminal-specific: Ghostty, Terminal.app, iTerm, VS Code and
 * the terminal inside Herd all just start the user's shell.
 */

/** Roughly a day, in the minutes `find -mmin` counts. Matches CHECK_INTERVAL_MS. */
const STALE_AFTER_MINUTES = 24 * 60;

export interface NoticeSnippetOptions {
  /**
   * Cache directory baked into the snippet, so the shell does not have to
   * reimplement XDG resolution and drift from `cacheDirectory()`.
   */
  readonly cacheDir?: string;
}

/**
 * Single-quote a path for a shell literal.
 *
 * A home directory can contain an apostrophe, and the emitted line goes
 * straight into a profile that is sourced without review.
 */
function quote(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}

export function posixNoticeSnippet(options: NoticeSnippetOptions = {}): string {
  const dir = quote(options.cacheDir ?? cacheDirectory());

  return [
    '# linchpin: report a newer published version when a shell starts.',
    '__linchpin_update_notice() {',
    '  # Interactive shells only. A script that sources this profile is not a person.',
    '  case $- in',
    '    *i*) ;;',
    '    *) return 0 ;;',
    '  esac',
    '',
    '  # Same opt-outs the in-command notifier honours, including "0" and "false".',
    '  local __linchpin_off',
    '  for __linchpin_off in "${LINCHPIN_NO_UPDATE_NOTIFIER:-}" "${NO_UPDATE_NOTIFIER:-}"; do',
    '    case "$__linchpin_off" in',
    '      "" | 0 | false) ;;',
    '      *) return 0 ;;',
    '    esac',
    '  done',
    '',
    '  # Uninstalled: say nothing rather than advise an update that cannot happen.',
    '  command -v linchpin >/dev/null 2>&1 || return 0',
    '',
    // Assigned in two steps rather than with `${VAR:-default}`: the default is a
    // single-quoted literal, and inside the double quotes of an assignment those
    // quotes would land in the path itself.
    `  local __linchpin_dir=${dir}`,
    '  [ -n "${LINCHPIN_CACHE_DIR:-}" ] && __linchpin_dir="$LINCHPIN_CACHE_DIR"',
    '  local __linchpin_notice="$__linchpin_dir/update-notice.txt"',
    '  local __linchpin_cache="$__linchpin_dir/update-check.json"',
    '',
    '  # stderr, so a profile whose stdout is captured stays clean.',
    '  [ -r "$__linchpin_notice" ] && cat "$__linchpin_notice" >&2',
    '',
    '  # Refresh in the background when the answer is missing or a day old, so a',
    '  # machine that never runs the CLI still learns that a release happened.',
    '  if [ ! -f "$__linchpin_cache" ] ||',
    `     [ -n "$(find "$__linchpin_cache" -mmin +${String(STALE_AFTER_MINUTES)} 2>/dev/null)" ]; then`,
    `    (env ${CHILD_ENV_FLAG}=1 linchpin version --check --quiet >/dev/null 2>&1 &)`,
    '  fi',
    '',
    '  return 0',
    '}',
    '__linchpin_update_notice',
    '',
  ].join('\n');
}

export function fishNoticeSnippet(options: NoticeSnippetOptions = {}): string {
  const dir = quote(options.cacheDir ?? cacheDirectory());

  return [
    '# linchpin: report a newer published version when a shell starts.',
    'function __linchpin_update_notice',
    '  status is-interactive; or return 0',
    '',
    '  # Same opt-outs the in-command notifier honours, including "0" and "false".',
    '  for __linchpin_off in "$LINCHPIN_NO_UPDATE_NOTIFIER" "$NO_UPDATE_NOTIFIER"',
    '    switch "$__linchpin_off"',
    "      case '' 0 false",
    "      case '*'",
    '        return 0',
    '    end',
    '  end',
    '',
    '  # Uninstalled: say nothing rather than advise an update that cannot happen.',
    '  command -q linchpin; or return 0',
    '',
    '  set -l __linchpin_dir "$LINCHPIN_CACHE_DIR"',
    `  test -n "$__linchpin_dir"; or set __linchpin_dir ${dir}`,
    '  set -l __linchpin_notice "$__linchpin_dir/update-notice.txt"',
    '  set -l __linchpin_cache "$__linchpin_dir/update-check.json"',
    '',
    '  # stderr, so a profile whose stdout is captured stays clean.',
    '  if test -r "$__linchpin_notice"',
    '    cat "$__linchpin_notice" >&2',
    '  end',
    '',
    '  # Refresh in the background when the answer is missing or a day old, so a',
    '  # machine that never runs the CLI still learns that a release happened.',
    `  set -l __linchpin_stale (find "$__linchpin_cache" -mmin +${String(STALE_AFTER_MINUTES)} 2>/dev/null)`,
    '  if not test -f "$__linchpin_cache"; or test -n "$__linchpin_stale"',
    `    env ${CHILD_ENV_FLAG}=1 linchpin version --check --quiet >/dev/null 2>&1 &`,
    '    disown 2>/dev/null',
    '  end',
    '',
    '  return 0',
    'end',
    '__linchpin_update_notice',
    '',
  ].join('\n');
}

export function noticeSnippet(
  shell: 'bash' | 'zsh' | 'fish' | 'posix',
  options: NoticeSnippetOptions = {}
): string {
  return shell === 'fish' ? fishNoticeSnippet(options) : posixNoticeSnippet(options);
}
