/**
 * Exit codes, adopted from `gh` so agents that already know one CLI know this one.
 *
 * Documented in `--help` and declared in `linchpin schema`, because an exit code
 * an agent has to discover by experiment is not an interface.
 */
export const EXIT_CODES = {
  /** Completed. */
  ok: 0,
  /** An unexpected failure — a bug, not the caller's fault. */
  unexpected: 1,
  /** Bad or missing input. The caller should change the command, not retry it. */
  validation: 2,
  /** The world isn't ready: no git repo, no config, dirty tree. */
  precondition: 3,
  /** Missing or rejected credentials. */
  auth: 4,
  /** Refused on purpose. A destructive action without its bypass flag. */
  refused: 5,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export const EXIT_CODE_DESCRIPTIONS: Readonly<Record<number, string>> = {
  0: 'Success',
  1: 'Unexpected error',
  2: 'Validation or usage error',
  3: 'Precondition not met',
  4: 'Authentication required or rejected',
  5: 'Refused by a safety check',
};

/**
 * A failure the caller can fix — bad flags, a missing file, a refused action.
 *
 * Reported as a plain message with no stack, because a stack trace tells the
 * user nothing they can act on and costs an agent tokens to read.
 */
export class UserError extends Error {
  readonly exitCode: number;
  /** Machine-readable discriminator for the JSON envelope. */
  readonly code: string;
  /** What to do about it, when there is a specific next step. */
  readonly remedy: string | undefined;

  constructor(
    message: string,
    options: { exitCode?: number; code?: string; remedy?: string; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'UserError';
    this.exitCode = options.exitCode ?? EXIT_CODES.validation;
    this.code = options.code ?? 'user_error';
    this.remedy = options.remedy;
  }
}

/** A bug. Reported with its stack, because someone has to debug it. */
export class InternalError extends Error {
  readonly exitCode = EXIT_CODES.unexpected;
  readonly code = 'internal_error';

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'InternalError';
  }
}

/**
 * Required input was missing and we could not ask for it.
 *
 * Names the exact flags so the caller's next attempt succeeds. This is the
 * error that must appear instead of a wizard blocking forever on a stream
 * nobody is attached to.
 */
export class MissingInputError extends UserError {
  constructor(flags: readonly string[], context?: string) {
    const named = flags.map((flag) => `--${flag}`).join(' ');
    super(
      `Missing required input in a non-interactive context: ${named}` +
        (context ? ` (${context})` : ''),
      {
        exitCode: EXIT_CODES.validation,
        code: 'missing_input',
        remedy: `Pass ${named}, or run in a terminal to be prompted.`,
      }
    );
    this.name = 'MissingInputError';
  }
}

/** A destructive action declined because its bypass flag was not given. */
export class RefusedError extends UserError {
  constructor(action: string, bypassFlag: string) {
    super(`Refused to ${action} without confirmation`, {
      exitCode: EXIT_CODES.refused,
      code: 'refused',
      remedy: `Pass --${bypassFlag} to proceed.`,
    });
    this.name = 'RefusedError';
  }
}

export function isUserError(error: unknown): error is UserError {
  return error instanceof UserError;
}

/** The exit code an arbitrary thrown value should produce. */
export function exitCodeFor(error: unknown): number {
  if (error instanceof UserError) return error.exitCode;
  if (error instanceof InternalError) return error.exitCode;

  const candidate = (error as { exitCode?: unknown } | null)?.exitCode;
  return typeof candidate === 'number' ? candidate : EXIT_CODES.unexpected;
}
