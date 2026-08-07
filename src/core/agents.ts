import os from 'node:os';
import path from 'node:path';

export const AGENT_VALUES = ['conductor', 'claude-code', 'codex', 'custom'] as const;
export type AgentName = (typeof AGENT_VALUES)[number];

/**
 * Default base path per agent — the directory its repos live under.
 * `custom` has no default; the user supplies the path.
 */
export const AGENT_BASE_PATHS: Readonly<Record<AgentName, string | null>> = {
  conductor: '~/conductor',
  'claude-code': '~/Documents',
  codex: '~/Documents/GitHub',
  custom: null,
};

export function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function collapseHome(input: string): string {
  const home = os.homedir();
  return input === home || input.startsWith(`${home}/`) ? `~${input.slice(home.length)}` : input;
}

export function getAgentBasePath(agent: string | null | undefined): string | null {
  if (!agent || agent === 'custom') return null;
  const raw = AGENT_BASE_PATHS[agent as AgentName];
  return raw ? path.resolve(expandHome(raw)) : null;
}

/** Resolve one agent's base path, honoring a user-supplied path for `custom`. */
export function resolveAgentPath(
  name: string | null | undefined,
  customPath?: string | null
): string | null {
  if (!name) return null;
  if (name === 'custom' && customPath && customPath.trim()) {
    return path.resolve(expandHome(customPath.trim()));
  }
  return getAgentBasePath(name);
}

/** Every agent base path declared in a project's config. */
export function getAgentBasePathsFromConfig(config: {
  agents?: Record<string, string> | null;
}): string[] {
  const agents = config.agents;
  if (!agents || Object.keys(agents).length === 0) return [];

  return Object.values(agents)
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map((value) => path.resolve(expandHome(value)));
}

/**
 * Roots to scan when locating a base repo from a worktree.
 *
 * ⚠️ The bug this signature fixes: the previous `getDefaultAgentScanRoots()`
 * took **no arguments** and returned only the three hardcoded presets, so a
 * user's `custom` agent path — the whole point of the multi-agent config — was
 * written to `.linchpin.json` and then never read during inference. The
 * config's paths now come first, since a declared path is a stronger signal
 * than a preset guess.
 */
export function getAgentScanRoots(
  config?: { agents?: Record<string, string> | null } | null
): string[] {
  const fromConfig = config ? getAgentBasePathsFromConfig(config) : [];

  const presets = (['conductor', 'claude-code', 'codex'] as const)
    .map((agent) => getAgentBasePath(agent))
    .filter((value): value is string => value !== null);

  return dedupePaths([...fromConfig, ...presets]);
}

/** Resolve, normalize and de-duplicate a list of candidate paths, dropping empties. */
export function dedupePaths(paths: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const candidate of paths) {
    if (!candidate) continue;

    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    results.push(normalized);
  }

  return results;
}
