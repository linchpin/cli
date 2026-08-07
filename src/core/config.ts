import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import { AGENT_VALUES, collapseHome, expandHome, getAgentBasePathsFromConfig } from './agents.js';

export const CONFIG_FILE_NAME = '.linchpin.json';

export function configPathFor(basePath: string): string {
  return path.join(basePath, CONFIG_FILE_NAME);
}

/** What the repo is: a plugin, a theme, or the whole `wp-content` directory. */
export const CONTENT_TYPES = ['plugin', 'theme', 'wp-content'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/**
 * Environments accept two shapes on disk.
 *
 * The object form is what we write; the array form predates it and is still in
 * the wild, so it is read and normalized rather than rejected.
 */
const environmentsSchema = z
  .union([
    z.record(z.string(), z.union([z.string(), z.number()])),
    z.array(z.object({ name: z.string(), path: z.union([z.string(), z.number()]) })),
  ])
  .transform((value): Record<string, string> => {
    if (Array.isArray(value)) {
      const normalized: Record<string, string> = {};
      for (const item of value) {
        if (!item?.name || item.path === undefined || item.path === null) continue;
        normalized[item.name] = String(item.path);
      }
      return normalized;
    }

    return Object.fromEntries(Object.entries(value).map(([name, target]) => [name, String(target)]));
  });

/**
 * The optional WordPress block.
 *
 * ⚠️ Optional is the whole point of LINCHPIN-5370. The previous
 * `normalizeConfig` **threw** when `wordpress.environments` was missing, so
 * every command that read config required a WordPress environment map — which
 * would have made `commit`, `pr`, `task` and `json` unusable in a plain repo,
 * including this CLI's own. Per the skills library, a repo with no WordPress
 * environments is now the normal case, not an edge case.
 */
const wordpressSchema = z.object({
  /** Plugin, theme, or the whole wp-content directory. */
  contentType: z.enum(CONTENT_TYPES).optional(),
  pluginSlug: z.string().nullish(),
  /** Directory name for the symlink; defaults to the slug, or `wp-content`. */
  symlinkName: z.string().nullish(),
  defaultEnvironment: z.string().optional(),
  environments: environmentsSchema.optional(),
});

const rawConfigSchema = z.object({
  // Legacy single-agent form, still read.
  agent: z.string().nullish(),
  agentBasePath: z.string().nullish(),
  // Multi-agent form.
  agents: z.record(z.string(), z.string()).nullish(),
  defaultAgent: z.string().nullish(),

  wordpress: wordpressSchema.optional(),

  // Pre-`wordpress`-block placements, still read.
  environments: environmentsSchema.optional(),
  pluginSlug: z.string().nullish(),
});

export interface WordPressConfig {
  readonly contentType: ContentType | null;
  readonly pluginSlug: string | null;
  readonly symlinkName: string | null;
  readonly defaultEnvironment: string | null;
  readonly environments: Record<string, string>;
}

export interface LinchpinConfig {
  readonly agent: string | null;
  readonly agentBasePath: string | null;
  readonly agents: Record<string, string> | null;
  readonly defaultAgent: string | null;
  /** Null when the repo has no WordPress environments — a normal, supported state. */
  readonly wordpress: WordPressConfig | null;
}

/**
 * Validate and normalize a parsed config object.
 *
 * Never throws for a missing `wordpress` block. It still throws for a config
 * that is internally inconsistent — a `defaultEnvironment` naming an
 * environment that was not declared is a mistake worth surfacing.
 */
export function normalizeConfig(input: unknown): LinchpinConfig {
  const parsed = rawConfigSchema.safeParse(input ?? {});

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => {
        const key = issue.path.join('.');
        return key ? `${key}: ${issue.message}` : issue.message;
      })
      .join('; ');
    throw new Error(`Invalid ${CONFIG_FILE_NAME}: ${detail}`);
  }

  const root = parsed.data;
  const wp = root.wordpress ?? {};

  const agent = root.agent && AGENT_VALUES.includes(root.agent as never) ? root.agent : null;
  const agentBasePath = root.agentBasePath?.trim() ? root.agentBasePath.trim() : null;

  let agents: Record<string, string> | null = null;
  if (root.agents && Object.keys(root.agents).length > 0) {
    const entries = Object.entries(root.agents)
      .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
      .map(([key, value]) => [key, value.trim()] as const);
    agents = entries.length > 0 ? Object.fromEntries(entries) : null;
  }
  // Backward compatibility: the single-agent form becomes a one-entry map.
  if (!agents && agent && agentBasePath) {
    agents = { [agent]: agentBasePath };
  }

  const declaredDefaultAgent = root.defaultAgent?.trim() ? root.defaultAgent.trim() : null;
  const defaultAgent = agents
    ? (declaredDefaultAgent ?? Object.keys(agents)[0] ?? null)
    : null;

  const environments = wp.environments ?? root.environments ?? {};
  const hasEnvironments = Object.keys(environments).length > 0;

  let wordpress: WordPressConfig | null = null;
  if (hasEnvironments || wp.contentType || wp.pluginSlug || root.pluginSlug) {
    const defaultEnvironment =
      wp.defaultEnvironment ?? (hasEnvironments ? (Object.keys(environments)[0] ?? null) : null);

    if (defaultEnvironment && hasEnvironments && !environments[defaultEnvironment]) {
      throw new Error(
        `Config defaultEnvironment '${defaultEnvironment}' is not defined in wordpress.environments.`
      );
    }

    wordpress = {
      contentType: wp.contentType ?? null,
      pluginSlug: wp.pluginSlug ?? root.pluginSlug ?? null,
      // Round-tripped rather than dropped — see writeConfig.
      symlinkName: wp.symlinkName ?? null,
      defaultEnvironment,
      environments,
    };
  }

  const singleAgentEntry =
    agents && Object.keys(agents).length === 1 ? Object.entries(agents)[0] : undefined;

  return {
    agent: singleAgentEntry ? singleAgentEntry[0] : agent,
    agentBasePath: singleAgentEntry ? singleAgentEntry[1] : agentBasePath,
    agents,
    defaultAgent,
    wordpress,
  };
}

/** Read and normalize the config, or throw naming the file and the remedy. */
export function readConfig(basePath: string): LinchpinConfig {
  const filePath = configPathFor(basePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${CONFIG_FILE_NAME} at ${basePath}. Run 'linchpin wt config init' to create one.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${CONFIG_FILE_NAME}: ${message}`);
  }

  return normalizeConfig(parsed);
}

/** Read the config if there is one, else null. For commands that do not require it. */
export function readConfigIfPresent(basePath: string): LinchpinConfig | null {
  return fs.existsSync(configPathFor(basePath)) ? readConfig(basePath) : null;
}

/**
 * The WordPress block, or a precondition error naming what to run.
 *
 * Commands that genuinely need environments call this; everything else uses
 * `readConfig` and tolerates `wordpress: null`.
 */
export function requireWordPressConfig(config: LinchpinConfig): WordPressConfig {
  if (!config.wordpress || Object.keys(config.wordpress.environments).length === 0) {
    throw new Error(
      `This command needs WordPress environments in ${CONFIG_FILE_NAME}. ` +
        `Run 'linchpin wt config init' to add them.`
    );
  }

  return config.wordpress;
}

export interface WriteConfigOptions {
  readonly force?: boolean;
}

/**
 * Write the config, collapsing home directories back to `~`.
 *
 * ⚠️ Every field on the config is emitted here. The previous implementation
 * hand-built its payload and silently dropped `contentType` and `symlinkName`,
 * so two README-documented keys never round-tripped and never appeared in
 * `wt config show`. Anything added to the schema must be added here too — the
 * round-trip test is what catches it.
 */
export function writeConfig(
  basePath: string,
  config: {
    agent?: string | null;
    agentBasePath?: string | null;
    agents?: Record<string, string> | null;
    defaultAgent?: string | null;
    wordpress?: Partial<WordPressConfig> | null;
  },
  options: WriteConfigOptions = {}
): string {
  const filePath = configPathFor(basePath);

  if (fs.existsSync(filePath) && !options.force) {
    throw new Error(`${CONFIG_FILE_NAME} already exists. Use --force to overwrite it.`);
  }

  const payload: Record<string, unknown> = {};

  const agents = config.agents ?? null;
  const agentCount = agents ? Object.keys(agents).length : 0;

  if (agentCount > 1 && agents) {
    payload.agents = Object.fromEntries(
      Object.entries(agents).map(([key, value]) => [key, collapseHome(String(value))])
    );
    if (config.defaultAgent) payload.defaultAgent = config.defaultAgent;
  } else if (agentCount === 1 && agents) {
    const [name, value] = Object.entries(agents)[0]!;
    payload.agent = name;
    payload.agentBasePath = collapseHome(String(value));
  } else if (config.agent && config.agentBasePath) {
    payload.agent = config.agent;
    payload.agentBasePath = collapseHome(config.agentBasePath);
  } else if (config.agentBasePath) {
    payload.agentBasePath = collapseHome(config.agentBasePath);
  }

  const wp = config.wordpress;
  if (wp) {
    const environments = Object.fromEntries(
      Object.entries(wp.environments ?? {}).map(([name, target]) => [
        name,
        collapseHome(String(target)),
      ])
    );

    payload.wordpress = {
      ...(wp.contentType ? { contentType: wp.contentType } : {}),
      ...(wp.pluginSlug ? { pluginSlug: wp.pluginSlug } : {}),
      ...(wp.symlinkName ? { symlinkName: wp.symlinkName } : {}),
      ...(wp.defaultEnvironment ? { defaultEnvironment: wp.defaultEnvironment } : {}),
      environments,
    };
  }

  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  return filePath;
}

export interface DefaultConfigOptions {
  readonly contentType?: ContentType;
  readonly pluginSlug?: string;
  readonly symlinkName?: string;
  readonly force?: boolean;
}

/** Write a starter config for a repo that has none. */
export function writeDefaultConfig(basePath: string, options: DefaultConfigOptions = {}): string {
  const contentType: ContentType = options.contentType ?? 'plugin';
  const pluginSlug = options.pluginSlug ?? path.basename(basePath);
  const isWpContent = contentType === 'wp-content';
  const contentSubdir = contentType === 'theme' ? 'themes' : 'plugins';
  const symlinkName = options.symlinkName ?? (isWpContent ? 'wp-content' : pluginSlug);

  const environments = isWpContent
    ? {
        studio: '/path/to/wordpress/wp-content',
        'wp-env': '/path/to/.wp-env/.../wp-content',
        localwp: path.join(os.homedir(), 'Local Sites', '<site>', 'app', 'public', 'wp-content'),
      }
    : {
        studio: `/path/to/wordpress/wp-content/${contentSubdir}/${pluginSlug}`,
        'wp-env': `/path/to/.wp-env/.../wp-content/${contentSubdir}/${pluginSlug}`,
        localwp: path.join(
          os.homedir(),
          'Local Sites',
          '<site>',
          'app',
          'public',
          'wp-content',
          contentSubdir,
          pluginSlug
        ),
      };

  return writeConfig(
    basePath,
    {
      wordpress: {
        contentType,
        ...(isWpContent ? {} : { pluginSlug }),
        symlinkName,
        defaultEnvironment: 'studio',
        environments,
      },
    },
    { force: options.force ?? false }
  );
}

/**
 * Agent roots to scan, ordered by how likely each is to hold the repo.
 *
 * This is what makes `defaultAgent` load-bearing rather than decorative. It was
 * previously written to the config and read by nothing; the agent a user
 * nominated as their default is the best first guess, so it goes first and the
 * scan usually stops there.
 */
export function getOrderedAgentRoots(config: LinchpinConfig | null): string[] {
  if (!config?.agents) return [];

  const { defaultAgent, agents } = config;
  const defaultPath =
    defaultAgent && agents[defaultAgent]
      ? path.resolve(expandHome(agents[defaultAgent]))
      : null;

  const rest = getAgentBasePathsFromConfig({ agents });
  const ordered = defaultPath ? [defaultPath, ...rest.filter((p) => p !== defaultPath)] : rest;

  return ordered;
}

export { collapseHome, expandHome };
