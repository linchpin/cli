import { z } from 'zod';

/**
 * What a command does to the world.
 *
 * One field, four consumers: the `allowed-tools` allowlists shipped in skills
 * (pre-approve every `read`, never a `destructive`), confirmation logic,
 * `linchpin schema` output, and the MCP adapter later.
 *
 * Unclassified must never be treated as safe — the type makes it required, and
 * `assertAllCommandsClassified()` enforces it at runtime for anything built
 * dynamically.
 */
export const EFFECTS = ['read', 'write', 'destructive'] as const;
export type Effect = (typeof EFFECTS)[number];

/** Topic groupings for `--help`. Order here is the order shown. */
export const GROUPS = {
  worktree: 'Worktrees',
  wordpress: 'WordPress environments',
  git: 'Git and GitHub',
  tasks: 'Tasks',
  agent: 'Agent integration',
  utility: 'Utilities',
} as const;

export type Group = keyof typeof GROUPS;

export interface CommandMeta {
  /** Space-separated path, e.g. `wt switch`. The first token is the top-level command. */
  readonly name: string;
  /** One line, shown in `--help` listings. No trailing period. */
  readonly summary: string;
  /** Longer prose for the command's own `--help`. */
  readonly description?: string;
  readonly group: Group;
  /**
   * Concrete invocations. cli-agent-lint check SD-6 wants these in help output
   * so an agent can learn usage without guessing.
   */
  readonly examples?: readonly string[];
  readonly hidden?: boolean;
  /**
   * Forward every argument through untouched instead of parsing flags.
   *
   * Transitional, for commands whose implementation still lives in `legacy/`
   * and owns its own argv. A passthrough command cannot be introspected, so it
   * contributes nothing useful to `schema` or completions — each one should
   * disappear as its subcommands get real definitions.
   */
  readonly passthrough?: boolean;
}

/**
 * Per-field CLI metadata, attached with Zod 4's `.meta()`.
 *
 * Anything not expressible in the schema itself lives here, so a field stays a
 * single declaration rather than a schema entry plus a parallel flag table.
 */
export interface ArgMeta {
  /** Single-character alias, e.g. `f` for `--force`. */
  readonly alias?: string;
  /** Consume as a positional argument instead of a flag. */
  readonly positional?: boolean;
  /** Placeholder in help, e.g. `<branch>`. Defaults to the field name. */
  readonly valueName?: string;
  /** Repeatable flag; collects into an array. */
  readonly variadic?: boolean;
}

export interface CommandContext {
  readonly argv: readonly string[];
}

export type CommandHandler<S extends z.ZodType> = (
  args: z.infer<S>,
  ctx: CommandContext
) => Promise<number | void> | number | void;

export interface CommandDefinition<S extends z.ZodType = z.ZodType> {
  readonly meta: CommandMeta;
  readonly effect: Effect;
  readonly args: S;
  readonly handler: CommandHandler<S>;
}

/**
 * Declare a command. This is the only place a command is described; `--help`,
 * shell completions, the README and `linchpin schema` are all generated from
 * the result rather than written alongside it.
 */
export function defineCommand<S extends z.ZodType>(
  definition: CommandDefinition<S>
): CommandDefinition<S> {
  return definition;
}

/**
 * Runtime guard for the CI gate. The `effect` field is type-required, but a
 * command assembled dynamically or through an `as` cast can still slip past the
 * compiler, and an unclassified command must never be read as safe.
 */
export function assertAllCommandsClassified(
  commands: readonly CommandDefinition[]
): void {
  const unclassified = commands.filter(
    (command) => !EFFECTS.includes(command.effect)
  );

  if (unclassified.length > 0) {
    const names = unclassified
      .map((command) => `${command.meta.name} (effect: ${String(command.effect)})`)
      .join(', ');

    throw new Error(
      `Command(s) missing a valid effect classification: ${names}. ` +
        `Every command must declare one of: ${EFFECTS.join(' | ')}.`
    );
  }
}

/** `pluginSlug` -> `plugin-slug`. Flags are kebab-case; schema fields are camelCase. */
export function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

/** Read the CLI metadata a field was declared with, if any. */
export function readArgMeta(schema: z.ZodType): ArgMeta {
  const meta = z.globalRegistry.get(schema);
  return (meta ?? {}) as ArgMeta;
}
