import { isCI as stdEnvIsCI } from 'std-env';

/**
 * Three distinct predicates, deliberately not one boolean.
 *
 * ⚠️ The measurement that drives this file, taken inside Claude Code:
 *
 *     isCI: false        <- CI is NOT set
 *     hasTTY: false      <- no stream is a TTY
 *     AI_AGENT: "claude-code_2-1-223_agent"
 *
 * So a wizard gated on a CI check alone classifies an agent as **interactive**
 * and blocks forever on input nobody can supply. The TTY check is the safety
 * net, and it is the one that must never be removed.
 */

/** Running under a recognised CI provider. Never the basis for prompting. */
export function isCI(): boolean {
  return stdEnvIsCI;
}

/**
 * Something is driving this that can't answer a prompt.
 *
 * The load-bearing predicate. stdout not being a TTY is the signal that
 * survives every environment we care about, including the agent case where
 * `CI` is unset.
 */
export function isNonInteractive(): boolean {
  return !process.stdout.isTTY || !process.stdin.isTTY || isCI();
}

/** Safe to prompt: a human is attached to both ends. */
export function isInteractive(): boolean {
  return !isNonInteractive();
}

/**
 * A coding agent is driving.
 *
 * Read synchronously from the environment rather than through
 * `determineAgent()`, which is async — the mode decision happens before any
 * command runs, and making startup await a detection call would cost cold start
 * on every invocation to answer a question that only removes decoration.
 *
 * @see detectAgentDetails for the richer async form.
 */
export function isAgent(): boolean {
  return readAgentName() !== undefined;
}

/** The agent's self-reported name, e.g. `claude-code_2-1-223_agent`. */
export function readAgentName(): string | undefined {
  const value = process.env.AI_AGENT?.trim();
  return value ? value : undefined;
}

/**
 * Full agent detection via `@vercel/detect-agent`, which knows more signals
 * than `AI_AGENT` alone. Async, so reach for it only where awaiting is free.
 */
export async function detectAgentDetails(): Promise<{ isAgent: boolean; name?: string }> {
  try {
    const { determineAgent } = await import('@vercel/detect-agent');
    const result = await determineAgent();
    const name = result?.agent?.name;
    return name ? { isAgent: Boolean(result?.isAgent), name } : { isAgent: Boolean(result?.isAgent) };
  } catch {
    // Detection is an optimisation, never a gate — fall back to the env read.
    const name = readAgentName();
    return name ? { isAgent: true, name } : { isAgent: false };
  }
}

/**
 * Whether an interactive editor may be opened.
 *
 * Claude Code sets `GIT_EDITOR=true` precisely because an agent can never
 * satisfy an editor prompt. Anything that would open `$EDITOR` must ask here
 * first, and fall back to a file path or a flag.
 */
export function canOpenEditor(): boolean {
  return Boolean(process.stdin.isTTY) && !isAgent() && !isCI();
}

/** Colour is off when asked, when piped, or when nobody is watching. */
export function supportsColor(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '') return true;
  return Boolean(process.stdout.isTTY) && !isAgent();
}
