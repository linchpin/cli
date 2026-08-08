import pc from 'picocolors';

import { EXIT_CODES, UserError, isUserError } from './errors.js';
import { isAgent, isNonInteractive, supportsColor } from './interactive.js';

/** Version of the JSON envelope. Bump when its shape changes incompatibly. */
export const ENVELOPE_VERSION = 1;

export type OutputMode = 'human' | 'json' | 'quiet';

export interface ModeFlags {
  readonly json?: boolean | undefined;
  readonly plain?: boolean | undefined;
  readonly quiet?: boolean | undefined;
}

/**
 * Decide the output mode once, at startup, in this precedence:
 *
 *   1. an explicit --json / --plain / --quiet flag
 *   2. LINCHPIN_OUTPUT env override (agents set env once, not per call)
 *   3. stdout is not a TTY -> non-interactive
 *   4. an agent is driving -> drop decoration
 *   5. otherwise, the full guided experience
 *
 * Step 4 only ever *subtracts* decoration. Agent detection must never add an
 * obligation the caller then has to satisfy — that is the deadlock in
 * vercel/vercel#15068, where agent mode made a flag mandatory and then ignored it.
 */
export function resolveOutputMode(flags: ModeFlags = {}): OutputMode {
  if (flags.quiet) return 'quiet';
  if (flags.json) return 'json';
  if (flags.plain) return 'human';

  const override = process.env.LINCHPIN_OUTPUT?.trim().toLowerCase();
  if (override === 'json') return 'json';
  if (override === 'quiet') return 'quiet';
  if (override === 'human' || override === 'plain') return 'human';

  // Not a decision about JSON — a non-TTY caller still gets human text unless it
  // asked otherwise. What it must never get is a prompt.
  return 'human';
}

export interface Envelope<T> {
  readonly version: number;
  readonly ok: boolean;
  readonly command: string;
  /** Present on mutations so an agent can tell a no-op from a change. */
  readonly changed?: boolean;
  readonly data?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly remedy?: string;
    readonly exitCode: number;
  };
}

/**
 * The single seam between logic and the terminal.
 *
 * Nothing in `core/` writes to a stream; it returns data and this renders it.
 * That is what keeps the JSON surface from drifting away from the human one —
 * they are two renderings of one value, not two code paths.
 */
export class Output {
  readonly mode: OutputMode;
  private readonly colors: boolean;

  constructor(mode: OutputMode = resolveOutputMode(), colors: boolean = supportsColor()) {
    this.mode = mode;
    this.colors = colors;
  }

  /** Primary result. stdout, and in JSON mode the only thing on stdout. */
  result<T>(command: string, data: T, options: { changed?: boolean; human?: string } = {}): void {
    if (this.mode === 'quiet') return;

    if (this.mode === 'json') {
      const envelope: Envelope<T> = {
        version: ENVELOPE_VERSION,
        ok: true,
        command,
        ...(options.changed === undefined ? {} : { changed: options.changed }),
        data,
      };
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
      return;
    }

    const text = options.human ?? (typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    if (text) process.stdout.write(`${text}\n`);
  }

  /** Conversational text. Suppressed in json and quiet modes. */
  info(message: string): void {
    if (this.mode !== 'human') return;
    process.stdout.write(`${message}\n`);
  }

  /**
   * A warning. **stderr only**, in every mode, so stdout stays parseable even
   * on partial success — a warning mixed into stdout breaks `| jq`.
   */
  warn(message: string): void {
    if (this.mode === 'quiet') return;
    process.stderr.write(`${this.paint(message, pc.yellow)}\n`);
  }

  /**
   * A value substituted because nobody could be asked.
   *
   * Logged rather than thrown, per wrangler's dialogs.ts — a non-destructive
   * confirmation should not stop an automated run. Destructive ones throw
   * RefusedError instead and never reach here.
   */
  fallback(label: string, value: unknown): void {
    if (!isNonInteractive() && !isAgent()) return;
    this.warn(`🤖 Using fallback value in non-interactive context: ${label}=${String(value)}`);
  }

  /** Terminal failure. stderr in human mode; a JSON envelope on stdout in json mode. */
  failure(command: string, error: unknown): number {
    const user = isUserError(error) ? error : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const exitCode = user?.exitCode ?? EXIT_CODES.unexpected;

    if (this.mode === 'json') {
      const envelope: Envelope<never> = {
        version: ENVELOPE_VERSION,
        ok: false,
        command,
        error: {
          code: user?.code ?? 'internal_error',
          message,
          ...(user?.remedy === undefined ? {} : { remedy: user.remedy }),
          exitCode,
        },
      };
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
      return exitCode;
    }

    if (this.mode !== 'quiet') {
      process.stderr.write(`${this.paint('Error:', pc.red)} ${message}\n`);
      if (user?.remedy) process.stderr.write(`${user.remedy}\n`);
      // A UserError is the caller's to fix; a stack would be noise. Anything
      // else is a bug and the stack is the point.
      if (!user && error instanceof Error && error.stack) {
        process.stderr.write(`${error.stack}\n`);
      }
    }

    return exitCode;
  }

  private paint(text: string, color: (input: string) => string): string {
    return this.colors ? color(text) : text;
  }
}

/**
 * Ask for confirmation without ever blocking an automated caller.
 *
 * Non-interactive + non-destructive -> take the fallback and say so.
 * Non-interactive + destructive     -> refuse, naming the bypass flag.
 */
export function confirmOrFallback(
  output: Output,
  options: {
    readonly label: string;
    readonly fallbackValue: boolean;
    readonly destructive?: boolean;
    readonly bypassFlag?: string;
  }
): boolean {
  if (!isNonInteractive()) {
    // A real prompt belongs here once clack lands in LINCHPIN-5376. Until then
    // an interactive caller gets the same defaulting an automated one does.
    return options.fallbackValue;
  }

  if (options.destructive) {
    throw new UserError(`Refused to ${options.label} without confirmation`, {
      exitCode: EXIT_CODES.refused,
      code: 'refused',
      remedy: `Pass --${options.bypassFlag ?? 'force'} to proceed.`,
    });
  }

  output.fallback(options.label, options.fallbackValue);
  return options.fallbackValue;
}
