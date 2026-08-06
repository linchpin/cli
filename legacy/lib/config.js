const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CONFIG_FILE_NAME = '.linchpin.json';

function configPathFor(basePath) {
  return path.join(basePath, CONFIG_FILE_NAME);
}

function readConfig(basePath) {
  const filePath = configPathFor(basePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${CONFIG_FILE_NAME} at ${basePath}. Run 'linchpin wt config init' to create one.`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse ${CONFIG_FILE_NAME}: ${error.message}`);
  }

  return normalizeConfig(parsed);
}

const AGENT_VALUES = Object.freeze(['conductor', 'claude-code', 'codex', 'custom']);

/** Default base path per agent (repos live under this directory). Custom has no default. */
const AGENT_BASE_PATHS = Object.freeze({
  conductor: '~/conductor',
  'claude-code': '~/Documents',
  codex: '~/Documents/GitHub',
  custom: null
});

function getAgentBasePath(agent) {
  if (!agent || agent === 'custom') {
    return null;
  }
  const raw = AGENT_BASE_PATHS[agent];
  return raw ? path.resolve(expandHome(raw)) : null;
}

/**
 * Resolve a single agent path (preset or custom).
 * @param {string} name - Agent key (e.g. 'codex', 'conductor', 'custom').
 * @param {string|null} customPath - For 'custom', the user-provided path.
 * @returns {string|null} Resolved absolute path or null.
 */
function resolveAgentPath(name, customPath) {
  if (!name) return null;
  if (name === 'custom' && customPath && customPath.trim()) {
    return path.resolve(expandHome(customPath.trim()));
  }
  return getAgentBasePath(name);
}

/**
 * All known agent base paths for scanning (e.g. finding main repo from a worktree).
 * Used when config is not available (e.g. during inference).
 * @returns {string[]} Absolute paths to scan.
 */
function getDefaultAgentScanRoots() {
  return [
    path.resolve(expandHome(AGENT_BASE_PATHS.conductor)),
    path.resolve(expandHome(AGENT_BASE_PATHS['claude-code'])),
    path.resolve(expandHome(AGENT_BASE_PATHS.codex))
  ].filter(Boolean);
}

function normalizeConfig(input) {
  const root = input || {};
  const wp = root.wordpress || {};
  const environments = normalizeEnvironments(wp.environments || root.environments);

  if (!Object.keys(environments).length) {
    throw new Error('Config is missing wordpress.environments.');
  }

  const defaultEnvironment = wp.defaultEnvironment || Object.keys(environments)[0];

  if (!environments[defaultEnvironment]) {
    throw new Error(
      `Config defaultEnvironment '${defaultEnvironment}' is not defined in wordpress.environments.`
    );
  }

  const agent = root.agent && AGENT_VALUES.includes(root.agent) ? root.agent : null;
  const agentBasePath =
    typeof root.agentBasePath === 'string' && root.agentBasePath.trim()
      ? root.agentBasePath.trim()
      : null;

  // Multi-agent: agents = { [name]: basePath }. Backward compat: single agent + agentBasePath.
  let agents = null;
  if (root.agents && typeof root.agents === 'object' && Object.keys(root.agents).length > 0) {
    agents = Object.fromEntries(
      Object.entries(root.agents)
        .filter(([, p]) => typeof p === 'string' && p.trim())
        .map(([k, p]) => [k, String(p).trim()])
    );
    if (Object.keys(agents).length === 0) agents = null;
  }
  if (!agents && agent && agentBasePath) {
    agents = { [agent]: agentBasePath };
  }

  const defaultAgent =
    typeof root.defaultAgent === 'string' && root.defaultAgent.trim()
      ? root.defaultAgent.trim()
      : agents ? Object.keys(agents)[0] : null;

  return {
    agent: agents && Object.keys(agents).length === 1 ? Object.keys(agents)[0] : agent,
    agentBasePath: agents && Object.keys(agents).length === 1 ? Object.values(agents)[0] : agentBasePath,
    agents,
    defaultAgent: agents ? defaultAgent : null,
    wordpress: {
      pluginSlug: wp.pluginSlug || root.pluginSlug || null,
      defaultEnvironment,
      environments
    }
  };
}

function normalizeEnvironments(rawEnvironments) {
  if (!rawEnvironments) {
    return {};
  }

  if (Array.isArray(rawEnvironments)) {
    const normalized = {};
    for (const item of rawEnvironments) {
      if (!item || !item.name || !item.path) {
        continue;
      }
      normalized[item.name] = String(item.path);
    }
    return normalized;
  }

  if (typeof rawEnvironments === 'object') {
    return Object.fromEntries(
      Object.entries(rawEnvironments).map(([name, targetPath]) => [name, String(targetPath)])
    );
  }

  return {};
}

function expandHome(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return inputPath;
  }

  if (inputPath === '~') {
    return os.homedir();
  }

  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function writeConfig(basePath, config, options = {}) {
  const filePath = configPathFor(basePath);

  if (fs.existsSync(filePath) && !options.force) {
    throw new Error(`${CONFIG_FILE_NAME} already exists. Use --force to overwrite it.`);
  }

  const normalizedEnvironments = Object.fromEntries(
    Object.entries(config.wordpress.environments || {}).map(([name, targetPath]) => [
      name,
      collapseHome(String(targetPath))
    ])
  );

  const hasMultipleAgents = config.agents && Object.keys(config.agents).length > 1;
  const agentsPayload =
    config.agents && Object.keys(config.agents).length > 0
      ? Object.fromEntries(
          Object.entries(config.agents).map(([k, p]) => [k, collapseHome(String(p))])
        )
      : undefined;

  const payload = {
    ...(hasMultipleAgents
      ? { agents: agentsPayload, ...(config.defaultAgent && { defaultAgent: config.defaultAgent }) }
      : config.agents && Object.keys(config.agents).length === 1
        ? {
            agent: Object.keys(config.agents)[0],
            agentBasePath: collapseHome(Object.values(config.agents)[0])
          }
        : config.agent && config.agentBasePath
          ? {
              agent: config.agent,
              agentBasePath: collapseHome(config.agentBasePath)
            }
          : config.agentBasePath
            ? { agentBasePath: collapseHome(config.agentBasePath) }
            : {}),
    wordpress: {
      pluginSlug: config.wordpress.pluginSlug,
      defaultEnvironment: config.wordpress.defaultEnvironment,
      environments: normalizedEnvironments
    }
  };

  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  return filePath;
}

function writeDefaultConfig(basePath, options = {}) {
  const contentType = options.contentType || 'plugin';
  const pluginSlug = options.pluginSlug || path.basename(basePath);
  const isWpContent = contentType === 'wp-content';
  const contentSubdir = contentType === 'theme' ? 'themes' : 'plugins';

  const defaultConfig = {
    wordpress: {
      contentType,
      ...(isWpContent ? {} : { pluginSlug }),
      defaultEnvironment: 'studio',
      environments: isWpContent
        ? {
            studio: '/path/to/wordpress/wp-content',
            'wp-env': '/path/to/.wp-env/.../wp-content',
            localwp: `${os.homedir()}/Local Sites/<site>/app/public/wp-content`
          }
        : {
            studio: `/path/to/wordpress/wp-content/${contentSubdir}/${pluginSlug}`,
            'wp-env': `/path/to/.wp-env/.../${contentSubdir}/${pluginSlug}`,
            localwp: `${os.homedir()}/Local Sites/<site>/app/public/wp-content/${contentSubdir}/${pluginSlug}`
          }
    }
  };

  return writeConfig(basePath, defaultConfig, options);
}

function collapseHome(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return inputPath;
  }

  if (inputPath === '~' || inputPath.startsWith('~/')) {
    return inputPath;
  }

  if (!path.isAbsolute(inputPath)) {
    return inputPath;
  }

  const normalizedInput = path.normalize(inputPath);
  const normalizedHome = path.normalize(os.homedir());

  if (normalizedInput === normalizedHome) {
    return '~';
  }

  if (normalizedInput.startsWith(`${normalizedHome}${path.sep}`)) {
    return `~${normalizedInput.slice(normalizedHome.length)}`;
  }

  return inputPath;
}

/**
 * All resolved agent base paths from config (for discovery / scanning).
 * @param {{ agents?: Record<string, string> }} config - Normalized config.
 * @returns {string[]} Absolute paths.
 */
function getAgentBasePathsFromConfig(config) {
  if (!config.agents || Object.keys(config.agents).length === 0) return [];
  return Object.values(config.agents)
    .map((p) => path.resolve(expandHome(p)))
    .filter(Boolean);
}

module.exports = {
  AGENT_BASE_PATHS,
  AGENT_VALUES,
  CONFIG_FILE_NAME,
  collapseHome,
  configPathFor,
  expandHome,
  getAgentBasePath,
  getAgentBasePathsFromConfig,
  getDefaultAgentScanRoots,
  normalizeConfig,
  readConfig,
  resolveAgentPath,
  writeConfig,
  writeDefaultConfig
};
