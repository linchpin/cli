/**
 * Library entry.
 *
 * The registry is exported so it can be exercised directly rather than only
 * through a spawned binary, and so `linchpin schema` (LINCHPIN-5375) and the
 * docs generator (LINCHPIN-5384) have one place to read the command surface
 * from. Nothing here writes to a console or exits the process.
 */
export {
  EFFECTS,
  GROUPS,
  assertAllCommandsClassified,
  defineCommand,
  readArgMeta,
  toKebabCase,
  type ArgMeta,
  type CommandDefinition,
  type CommandMeta,
  type Effect,
  type Group,
} from './cli/registry.js';

export { buildOption, deriveFields, type DerivedField } from './cli/schema-to-options.js';
export { CommandError, buildProgram } from './cli/program.js';
export { COMMANDS } from './cli/commands/index.js';
export {
  EXIT_CODES,
  EXIT_CODE_DESCRIPTIONS,
  InternalError,
  MissingInputError,
  RefusedError,
  UserError,
  exitCodeFor,
  isUserError,
  type ExitCode,
} from './cli/errors.js';

export {
  canOpenEditor,
  detectAgentDetails,
  isAgent,
  isCI,
  isInteractive,
  isNonInteractive,
  readAgentName,
  supportsColor,
} from './cli/interactive.js';

export {
  ENVELOPE_VERSION,
  Output,
  confirmOrFallback,
  resolveOutputMode,
  type Envelope,
  type OutputMode,
} from './cli/output.js';

export { readVersion } from './version.js';
