import { EXIT_CODES, UserError } from '../cli/errors.js';

/**
 * A read client for api.linchpin.com.
 *
 * The api is the system of record for clients, their environments and the
 * installs on Linchpin's hosting accounts (LINCHPIN-5885). Going through it
 * rather than at a host directly means a laptop never holds a Pressable
 * credential, and the host matrix (Pressable today; WP Engine, Cloudways and
 * Pantheon as the api grows them) lives in one place.
 *
 * Nothing here writes to a console. Failures are UserErrors with the exit code
 * an agent can branch on: `auth` for a missing or rejected credential,
 * `precondition` for an api or host that could not be reached.
 */

export const API_URL = 'https://api.linchpin.com/api/v1';

/** How long one api call may take before it is reported as unreachable. */
export const API_TIMEOUT_MS = 15_000;

/** Loopback hosts, where plaintext is a local stub rather than a downgrade. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export type Role = 'production' | 'staging' | 'development' | 'local';

export interface ApiDeploy {
  readonly id: number;
  readonly environment: string;
  readonly repository: string;
  readonly ref: string;
  readonly sha: string;
  readonly tag_name: string;
  readonly status: string;
  readonly commit_count: number;
  readonly log_url: string;
  readonly created_at: string | null;
  readonly finished_at: string | null;
}

export interface ApiMaintenance {
  readonly site_id: number;
  readonly as: 'production' | 'development' | 'staging';
  readonly enabled: boolean;
  readonly run_time: string;
  readonly timezone: string;
  readonly promotion_day: number;
  readonly promotion_target: string;
}

/** One row of `GET /environments`: an install a client's sites run on. */
export interface ApiEnvironment {
  readonly id: number;
  readonly client_id: number;
  readonly client_name: string | null;
  readonly role: Role;
  readonly label: string;
  readonly hostname: string;
  /** Host slug: `pressable`, `wpengine`, `cloudways`, `pantheon`, … */
  readonly provider: string;
  /** The host's own id for the install, e.g. a Pressable site id. */
  readonly provider_ref: string;
  readonly github_repo: string;
  readonly deploy_environment: string;
  readonly deploy_branch: string;
  readonly multisite: boolean;
  /** Null for production and local; the production this is a copy of otherwise. */
  readonly production_environment_id: number | null;
  readonly site_ids: readonly number[];
  readonly latest_deploy: ApiDeploy | null;
  readonly maintenance: ApiMaintenance | null;
}

/** One row of `GET /environments/pressable`: Pressable's own view of an install. */
export interface PressableInstall {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly state: string;
  /** A staging-type site. False for live and for sandbox. */
  readonly staging: boolean;
  /** A sandbox-type site, which Pressable password-protects with an mu-plugin. */
  readonly sandbox: boolean;
  /** The `WP_ENVIRONMENT_TYPE` constant Pressable writes into wp-config.php. */
  readonly wp_environment_type: string;
  readonly multisite: boolean;
  readonly cloned_from_id: string;
  /** The environment row naming this install, or null when none does. */
  readonly environment_id: number | null;
}

export interface PressableInstalls {
  readonly domains_readable: boolean | null;
  readonly installs: readonly PressableInstall[];
}

export interface ApiCredentials {
  readonly kind: 'token' | 'client';
  readonly token?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
}

export interface ApiClientOptions {
  readonly baseUrl?: string | undefined;
  readonly credentials?: ApiCredentials | undefined;
  readonly fetch?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
}

/**
 * The api to talk to, having refused one that cannot be trusted.
 *
 * `LINCHPIN_API_URL` is an environment value, so it is exactly as trustworthy
 * as whatever set it. A plaintext api would send a bearer token where anyone
 * on the path can read it, so http is refused unless the host is loopback —
 * the test stub — or the caller has said out loud that it wants it.
 */
export function resolveApiBase(override?: string): string {
  const candidate = override ?? process.env.LINCHPIN_API_URL?.trim() ?? API_URL;
  const trimmed = candidate.replace(/\/+$/, '');
  if (trimmed === '') return API_URL;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UserError(`LINCHPIN_API_URL is not a URL: ${trimmed}`, {
      exitCode: EXIT_CODES.validation,
      code: 'invalid_api_url',
      remedy: `Set LINCHPIN_API_URL to an https URL, or unset it to use ${API_URL}.`,
    });
  }

  if (parsed.protocol === 'https:') return trimmed;

  const allowInsecure = process.env.LINCHPIN_API_ALLOW_INSECURE?.trim();
  const permitted =
    LOOPBACK_HOSTS.has(parsed.hostname) ||
    (allowInsecure !== undefined && allowInsecure !== '' && allowInsecure !== '0');

  if (parsed.protocol === 'http:' && permitted) return trimmed;

  throw new UserError(`Refusing to send a credential over ${parsed.protocol}//: ${trimmed}`, {
    exitCode: EXIT_CODES.validation,
    code: 'insecure_api_url',
    remedy: 'Use https, or set LINCHPIN_API_ALLOW_INSECURE=1 to accept it.',
  });
}

/**
 * The credential to present, read from the environment.
 *
 * Two forms, because the api issues two: a static agent token
 * (`LINCHPIN_API_TOKEN`) is sent as-is; an application client
 * (`LINCHPIN_API_CLIENT_ID` + `LINCHPIN_API_CLIENT_SECRET`) is exchanged for a
 * one-hour bearer token first. The client form is the one to hand a person or
 * a CI job, because its scopes are visible in the api's admin.
 */
export function resolveCredentials(env: NodeJS.ProcessEnv = process.env): ApiCredentials | null {
  const token = env.LINCHPIN_API_TOKEN?.trim();
  if (token) return { kind: 'token', token };

  const clientId = env.LINCHPIN_API_CLIENT_ID?.trim();
  const clientSecret = env.LINCHPIN_API_CLIENT_SECRET?.trim();
  if (clientId && clientSecret) return { kind: 'client', clientId, clientSecret };

  return null;
}

export function requireCredentials(env: NodeJS.ProcessEnv = process.env): ApiCredentials {
  const credentials = resolveCredentials(env);
  if (credentials) return credentials;

  throw new UserError('No api.linchpin.com credential in the environment', {
    exitCode: EXIT_CODES.auth,
    code: 'missing_credentials',
    remedy:
      'Set LINCHPIN_API_CLIENT_ID and LINCHPIN_API_CLIENT_SECRET (an application client with ' +
      'the sites:read and clients:read scopes), or LINCHPIN_API_TOKEN.',
  });
}

interface ErrorBody {
  readonly ok?: boolean;
  readonly error?: string;
  readonly error_code?: string;
  readonly error_description?: string;
  readonly message?: string;
}

function describeFailure(status: number, body: unknown): string {
  const parsed = (body ?? {}) as ErrorBody;
  const detail = parsed.message ?? parsed.error_description ?? parsed.error_code ?? parsed.error;
  return detail ? `${status}: ${detail}` : `HTTP ${status}`;
}

/**
 * Minimal api client. One method per endpoint the CLI reads, so the surface a
 * test has to stub is the list of methods on this class.
 */
export class LinchpinApi {
  readonly baseUrl: string;
  private readonly credentials: ApiCredentials | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  /** Memoised as a promise so concurrent reads share one exchange. */
  private bearer: Promise<string> | null = null;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = resolveApiBase(options.baseUrl);
    this.credentials = options.credentials ?? resolveCredentials();
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? API_TIMEOUT_MS;
  }

  async listEnvironments(): Promise<readonly ApiEnvironment[]> {
    const body = await this.get<{ environments: ApiEnvironment[] }>('/environments');
    return body.environments ?? [];
  }

  async listPressableInstalls(): Promise<PressableInstalls> {
    const body = await this.get<PressableInstalls>('/environments/pressable');
    return { domains_readable: body.domains_readable ?? null, installs: body.installs ?? [] };
  }

  /** The bearer to send, exchanging client credentials once per process. */
  private token(): Promise<string> {
    this.bearer ??= this.exchange();
    return this.bearer;
  }

  private async exchange(): Promise<string> {
    const credentials = this.credentials ?? requireCredentials();
    if (credentials.kind === 'token' && credentials.token) return credentials.token;

    const response = await this.request('/auth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }),
    });

    const body = (await readJson(response)) as { access_token?: string } & ErrorBody;
    if (!response.ok || !body.access_token) {
      throw new UserError(
        `api.linchpin.com rejected the client credentials (${describeFailure(response.status, body)})`,
        {
          exitCode: EXIT_CODES.auth,
          code: 'auth_rejected',
          remedy: 'Check LINCHPIN_API_CLIENT_ID and LINCHPIN_API_CLIENT_SECRET.',
        }
      );
    }

    return body.access_token;
  }

  private async get<T>(path: string): Promise<T> {
    const bearer = await this.token();
    const response = await this.request(path, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${bearer}` },
    });
    const body = await readJson(response);

    if (response.status === 401 || response.status === 403) {
      throw new UserError(
        `api.linchpin.com refused ${path} (${describeFailure(response.status, body)})`,
        {
          exitCode: EXIT_CODES.auth,
          code: 'auth_rejected',
          remedy:
            'The credential needs the sites:read scope. An application client gets it in the ' +
            'api admin; an agent token has every scope.',
        }
      );
    }

    if (!response.ok) {
      throw new UserError(`api.linchpin.com failed ${path} (${describeFailure(response.status, body)})`, {
        exitCode: EXIT_CODES.precondition,
        code: (body as ErrorBody)?.error_code ?? 'api_error',
      });
    }

    return body as T;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new UserError(`Could not reach ${url}: ${reason}`, {
        exitCode: EXIT_CODES.precondition,
        code: 'api_unreachable',
        remedy: 'Check the network, or LINCHPIN_API_URL if it is set.',
        cause: error,
      });
    }
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 200) };
  }
}
