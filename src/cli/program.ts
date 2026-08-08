import { Command } from 'commander';
import { z } from 'zod';

import {
  GROUPS,
  assertAllCommandsClassified,
  type CommandDefinition,
} from './registry.js';
import { EXIT_CODE_DESCRIPTIONS, EXIT_CODES, UserError } from './errors.js';
import { buildOption, deriveFields } from './schema-to-options.js';

/**
 * A parsing or dispatch failure the caller can fix.
 *
 * A thin specialisation of UserError so there is one error hierarchy and one
 * place that decides how a failure is rendered and what it exits with.
 */
export class CommandError extends UserError {
  constructor(message: string, exitCode: number = EXIT_CODES.unexpected, remedy?: string) {
    super(message, {
      exitCode,
      code: 'command_error',
      ...(remedy === undefined ? {} : { remedy }),
    });
    this.name = 'CommandError';
  }
}

// ASCII control characters. Excluded from argv entirely: multi-line and binary
// payloads travel by file path in this CLI (--message-file, --body-file), never
// as arguments, so a control character in argv is either a mistake or an
// injection attempt. ANSI escapes in particular can rewrite terminal output an
// agent then reads back.
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;

/**
 * Reject argv containing control characters before parsing.
 *
 * Named so the caller knows exactly which argument was at fault, and reported
 * with the escape sequence made visible rather than pasted through raw.
 */
export function assertNoControlCharacters(argv: readonly string[]): void {
  for (const [index, argument] of argv.entries()) {
    if (!CONTROL_CHARACTERS.test(argument)) continue;

    const visible = argument.replace(
      // eslint-disable-next-line no-control-regex
      /[\x00-\x1f\x7f]/g,
      (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`
    );

    throw new CommandError(
      `Argument ${index + 1} contains a control character: "${visible}". ` +
        'Pass multi-line or binary content by file path instead.',
      EXIT_CODES.validation
    );
  }
}

export interface BuildProgramOptions {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  /** Shown under the root `--help`, so usage is discoverable without docs. */
  readonly examples?: readonly string[];
}

/** Turn a Zod failure into one message an agent can act on without parsing a stack. */
function formatValidationError(name: string, error: z.ZodError): CommandError {
  const details = error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `--${path}: ${issue.message}` : issue.message;
    })
    .join('; ');

  return new CommandError(`Invalid arguments for '${name}': ${details}`, EXIT_CODES.validation);
}

/**
 * Find or create the parent chain for a dotted/spaced command name, so
 * `wt switch` hangs off a `wt` command that may not have been declared itself.
 */
function resolveParent(root: Command, segments: readonly string[]): Command {
  let parent = root;

  for (const segment of segments) {
    const existing = parent.commands.find((command) => command.name() === segment);

    if (existing) {
      parent = existing;
      continue;
    }

    const created = parent.command(segment);
    created.description(`${segment} commands`);
    parent = created;
  }

  return parent;
}

/**
 * Build the Commander program from the registry.
 *
 * Every surface a user or agent sees is derived here rather than hand-wired:
 * flags come from the Zod schema, grouping from `meta.group`, examples from
 * `meta.examples`. Adding a command means adding one definition.
 */
export function buildProgram(
  commands: readonly CommandDefinition[],
  options: BuildProgramOptions
): Command {
  assertAllCommandsClassified(commands);

  const program = new Command(options.name);
  program.version(options.version, '-v, --version', 'Print the version and exit');
  if (options.description) program.description(options.description);

  // Deterministic help: groups appear in GROUPS order, commands sorted within.
  program.configureHelp({ sortSubcommands: true });

  // Required for passThroughOptions on subcommands to take effect.
  program.enablePositionalOptions();

  // Every error ends with something to do next. The dispatcher this replaces
  // said "Run 'linchpin --help'" and losing that made errors less actionable,
  // not more — Commander's bare "unknown command 'x'" names the problem but
  // not the remedy. Suggestions catch typos; the help hint covers the rest.
  program.showSuggestionAfterError(true);
  program.showHelpAfterError("Run 'linchpin --help' to see available commands.");

  // Global flags. The names match the de-facto vocabulary (gh, wrangler, vercel)
  // so an agent recognises them without reading docs.
  program
    .option('--json', 'Emit a machine-readable JSON envelope on stdout')
    .option('--plain', 'Force undecorated human output')
    .option('--quiet', 'Suppress all non-error output')
    .option('--no-input', 'Never prompt; fail naming the missing flags instead')
    .option('--no-color', 'Disable colored output (also honors NO_COLOR)');

  const exitCodeHelp = [
    'Exit codes:',
    ...Object.entries(EXIT_CODE_DESCRIPTIONS).map(([code, text]) => `  ${code}  ${text}`),
  ].join('\n');

  program.addHelpText(
    'after',
    [
      '',
      ...(options.examples?.length
        ? ['Examples:', ...options.examples.map((example) => `  ${example}`), '']
        : []),
      exitCodeHelp,
      '',
    ].join('\n')
  );

  for (const definition of commands) {
    const segments = definition.meta.name.split(/\s+/).filter(Boolean);
    const leaf = segments.at(-1);
    if (leaf === undefined) continue;

    const parent = resolveParent(program, segments.slice(0, -1));
    const command = parent.command(leaf);

    command.description(definition.meta.summary);
    if (definition.meta.hidden) command.helpGroup('');

    // Only top-level commands get a group heading; subcommands are already
    // grouped by their parent in help output.
    if (parent === program) {
      command.helpGroup(GROUPS[definition.meta.group]);
    }

    // A passthrough owns its own argv: Commander must not claim flags it does
    // not know about, or a legacy flag like `wt switch --dry-run` becomes an
    // "unknown option" error instead of reaching the implementation.
    if (definition.meta.passthrough) {
      command.allowUnknownOption(true);
      command.allowExcessArguments(true);
      command.passThroughOptions(true);
    }

    const fields = deriveFields(definition.args);

    for (const field of fields) {
      if (field.positional) {
        const token = field.required ? `<${field.valueName}>` : `[${field.valueName}]`;
        command.argument(field.variadic ? `${token.slice(0, -1)}...>` : token, field.description);
        continue;
      }

      command.addOption(buildOption(field));
    }

    if (definition.meta.description || definition.meta.examples?.length) {
      const parts: string[] = [];
      if (definition.meta.description) parts.push(definition.meta.description);
      if (definition.meta.examples?.length) {
        parts.push(['Examples:', ...definition.meta.examples.map((e) => `  ${e}`)].join('\n'));
      }
      command.addHelpText('after', `\n${parts.join('\n\n')}\n`);
    }

    command.action(async (...actionArgs: unknown[]) => {
      // Commander passes positionals, then the options object, then the Command.
      const positionals = actionArgs.slice(0, -2);
      const optionValues = (actionArgs.at(-2) ?? {}) as Record<string, unknown>;

      const raw: Record<string, unknown> = { ...optionValues };
      fields
        .filter((field) => field.positional)
        .forEach((field, index) => {
          const value = positionals[index];
          if (value !== undefined) raw[field.key] = value;
        });

      const parsed = definition.args.safeParse(raw);
      if (!parsed.success) throw formatValidationError(definition.meta.name, parsed.error);

      const code = await definition.handler(parsed.data, { argv: process.argv.slice(2) });
      if (typeof code === 'number' && code !== 0) {
        throw new CommandError(`'${definition.meta.name}' exited with code ${code}`, code);
      }
    });
  }

  // exitOverride is per-command, not inherited. Without this walk a subcommand
  // calls process.exit() itself on a bad flag, bypassing the caller's error
  // handling entirely — which would take the JSON envelope and exit-code
  // vocabulary in LINCHPIN-5368 with it.
  applyExitOverride(program);

  return program;
}

function applyExitOverride(command: Command): void {
  command.exitOverride();
  for (const child of command.commands) applyExitOverride(child);
}
