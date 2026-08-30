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

// core/ — all logic, no console, no prompts, no process.exit.
export { runCommand, type RunOptions, type RunResult } from './core/exec.js';
export {
  AGENT_BASE_PATHS,
  AGENT_VALUES,
  collapseHome,
  dedupePaths,
  expandHome,
  getAgentBasePath,
  getAgentBasePathsFromConfig,
  getAgentScanRoots,
  resolveAgentPath,
  type AgentName,
} from './core/agents.js';
export {
  extractWorktreeId,
  findGitAnchor,
  findRepoWithWorktreeId,
  getBaseWorktreePath,
  getCurrentTopLevel,
  hasWorktreeMetadata,
  inferBaseRepoPath,
  inferBaseRepoPathFromWorktreeId,
  listWorktrees,
  parseWorktreePorcelain,
  readGitdirPointer,
  resolveWorktreeRef,
  safeRealpath,
  stripWorktreeSuffix,
  type ResolvedWorktree,
  type WorktreeEntry,
} from './core/git.js';

export {
  CONFIG_FILE_NAME,
  CONTENT_TYPES,
  configPathFor,
  getOrderedAgentRoots,
  normalizeConfig,
  readConfig,
  readConfigIfPresent,
  requireWordPressConfig,
  writeConfig,
  writeDefaultConfig,
  type ContentType,
  type LinchpinConfig,
  type WordPressConfig,
} from './core/config.js';

export {
  ensurePluginLink,
  readExistingTarget,
  resolveTargetConflict,
  type ConflictOutcome,
  type ConflictResolution,
  type EnsureLinkOptions,
  type LinkResult,
} from './core/symlink.js';

export {
  HOOK_OPERATIONS,
  HOOK_PHASES,
  HOOK_POINTS,
  buildHookEnvironment,
  findHookFile,
  isHookPoint,
  runHook,
  type HookEnvironment,
  type HookOperation,
  type HookPhase,
} from './core/hooks.js';

export { readManifest, readVersion, type Manifest } from './version.js';

export {
  CHECK_INTERVAL_MS,
  FETCH_TIMEOUT_MS,
  REGISTRY_URL,
  cacheDirectory,
  clearUpdateNotice,
  compareVersions,
  currentInstallPath,
  detectInstallation,
  fetchLatestVersion,
  formatAge,
  formatCommand,
  isCacheFresh,
  isUpdateAvailable,
  readUpdateCache,
  readUpdateNotice,
  resolveUpdateStatus,
  updateCachePath,
  updateNoticePath,
  writeUpdateCache,
  writeUpdateNotice,
  type InstallScope,
  type Installation,
  type PackageManager,
  type UpdateCache,
  type UpdateSource,
  type UpdateStatus,
} from './core/update.js';

export {
  CHILD_ENV_FLAG,
  notificationsAllowed,
  notifyAboutUpdates,
  renderUpdateNotice,
  syncNoticeFile,
} from './cli/update-notifier.js';

export {
  fishNoticeSnippet,
  noticeSnippet,
  posixNoticeSnippet,
  type NoticeSnippetOptions,
} from './cli/shell-notice.js';
