import { xSync } from 'tinyexec';

export interface RunResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  /** Return a failed result instead of throwing. */
  readonly allowFailure?: boolean;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Stream the child's output straight to the terminal instead of capturing it.
   *
   * For a long-running command whose progress is the point — a package manager
   * installing an upgrade — silence for thirty seconds reads as a hang. The
   * returned stdout and stderr are empty in this mode; nothing captured them.
   */
  readonly inherit?: boolean;
}

/**
 * Run a command as an argv array.
 *
 * **No shell, ever.** The command and its arguments go straight to `spawnSync`,
 * so a branch name containing `;` or `$(…)` is data rather than syntax. That is
 * why this CLI has no command-injection surface, and it is the property to
 * protect when touching this file — never add a `shell: true` option and never
 * build a command string.
 *
 * Kept synchronous, matching the `execFileSync` implementation it replaces. The
 * worktree inference heuristics call it in tight loops over candidate
 * directories; making it async would ripple through every caller for no
 * behavioural gain.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  options: RunOptions = {}
): RunResult {
  const { allowFailure = false, cwd, env, inherit = false } = options;

  let exitCode: number;
  let stdout: string;
  let stderr: string;

  try {
    const result = xSync(command, [...args], {
      throwOnError: false,
      nodeOptions: {
        // stdin ignored: nothing here is interactive, and inheriting it would
        // let a subprocess block on a stream nobody is attached to.
        stdio: inherit ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
        ...(cwd === undefined ? {} : { cwd }),
        ...(env === undefined ? {} : { env }),
      },
    });

    exitCode = result.exitCode ?? 0;
    stdout = (result.stdout ?? '').trimEnd();
    stderr = (result.stderr ?? '').trim();
  } catch (error) {
    // A missing binary throws ENOENT out of spawnSync rather than returning a
    // non-zero result, so it must be caught here — otherwise `allowFailure`
    // would not cover the "git isn't installed" case it exists for.
    const message = error instanceof Error ? error.message : String(error);
    if (allowFailure) return { ok: false, stdout: '', stderr: message };
    throw new Error(message);
  }

  if (exitCode === 0) return { ok: true, stdout, stderr: '' };
  if (allowFailure) return { ok: false, stdout, stderr };

  throw new Error(stderr || `${command} exited with code ${String(exitCode)}`);
}
