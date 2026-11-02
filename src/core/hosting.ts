import type { ApiEnvironment, PressableInstall, Role } from './linchpin-api.js';

/**
 * Hosting inventory and the audit against Linchpin's expected layout.
 *
 * Pure: takes what api.linchpin.com returned, returns rows and findings.
 * The command renders; nothing here writes to a stream.
 *
 * The layout this audits for is the one the `wp-hosting-environments` skill
 * owns: every client site has a production, a staging and a development
 * environment, each registered in the api with the role it plays. On
 * Pressable a staging or development environment is a *staging-type* site
 * (never a sandbox, whose password mu-plugin gets in the way) whose
 * `WP_ENVIRONMENT_TYPE` names the role — that constant is what safety-net and
 * Sisyphus read, not Pressable's own site type.
 */

/**
 * What a production is expected to have around it, per host.
 *
 * `minimum` counts the production itself: two means production plus at least
 * one copy, which is the floor below which nothing can be reviewed or
 * maintained off the live site. `expected` is the layout every client should
 * have; a role missing from it is reported, but as a warning rather than a
 * gap, because a client may legitimately promote straight to production. More
 * environments than expected — a second staging, a UAT copy — are fine and
 * never a finding.
 */
export interface LayoutPolicy {
  readonly minimum: number;
  readonly expected: readonly Role[];
}

export const DEFAULT_POLICY: LayoutPolicy = {
  minimum: 2,
  expected: ['production', 'staging', 'development'],
};

/** Hosts the api does not integrate yet still get a policy, so a client registered there is audited the same way. */
export const HOST_POLICIES: Readonly<Record<string, LayoutPolicy>> = {
  pressable: DEFAULT_POLICY,
  wpengine: DEFAULT_POLICY,
  cloudways: DEFAULT_POLICY,
  pantheon: DEFAULT_POLICY,
};

/** Order environments are listed in: production first, then its copies. */
export const ROLE_ORDER: readonly Role[] = ['production', 'staging', 'development', 'local'];

export function policyFor(provider: string): LayoutPolicy {
  return HOST_POLICIES[provider.toLowerCase()] ?? DEFAULT_POLICY;
}

export function expectedRolesFor(provider: string): readonly Role[] {
  return policyFor(provider).expected;
}

/** The host's own site type, as far as the api reports it. */
export type SiteType = 'live' | 'staging' | 'sandbox' | 'unknown';

export function siteTypeOf(install: PressableInstall | null): SiteType {
  if (!install) return 'unknown';
  if (install.sandbox) return 'sandbox';
  if (install.staging) return 'staging';
  return 'live';
}

/** One environment, joined to the host's view of its install where there is one. */
export interface InventoryRow {
  readonly environment: ApiEnvironment;
  readonly install: PressableInstall | null;
  readonly siteType: SiteType;
}

/** A production and the copies registered against it. */
export interface ProductionGroup {
  readonly production: InventoryRow | null;
  readonly copies: readonly InventoryRow[];
}

export interface ClientInventory {
  readonly clientId: number;
  readonly clientName: string;
  readonly groups: readonly ProductionGroup[];
}

export interface Inventory {
  readonly clients: readonly ClientInventory[];
  /** Host installs no environment row names. */
  readonly unregistered: readonly PressableInstall[];
}

function roleRank(role: Role): number {
  const index = ROLE_ORDER.indexOf(role);
  return index === -1 ? ROLE_ORDER.length : index;
}

function compareRows(a: InventoryRow, b: InventoryRow): number {
  return (
    roleRank(a.environment.role) - roleRank(b.environment.role) ||
    a.environment.hostname.localeCompare(b.environment.hostname)
  );
}

/**
 * Group environments by client, then by the production each copy points at.
 *
 * A copy whose `production_environment_id` names nothing the client owns
 * lands in a group with a null production, which is itself a finding.
 */
export function buildInventory(
  environments: readonly ApiEnvironment[],
  installs: readonly PressableInstall[] = []
): Inventory {
  const installById = new Map(installs.map((install) => [String(install.id), install]));

  const rowFor = (environment: ApiEnvironment): InventoryRow => {
    const install =
      environment.provider.toLowerCase() === 'pressable'
        ? (installById.get(environment.provider_ref) ?? null)
        : null;
    return { environment, install, siteType: siteTypeOf(install) };
  };

  const byClient = new Map<number, { name: string; rows: InventoryRow[] }>();
  for (const environment of environments) {
    const entry = byClient.get(environment.client_id) ?? {
      name: environment.client_name ?? `client ${environment.client_id}`,
      rows: [],
    };
    entry.rows.push(rowFor(environment));
    byClient.set(environment.client_id, entry);
  }

  const clients: ClientInventory[] = [...byClient.entries()]
    .map(([clientId, { name, rows }]) => {
      const productions = rows.filter((row) => row.environment.role === 'production');
      const groups: ProductionGroup[] = productions.map((production) => ({
        production,
        copies: rows
          .filter(
            (row) =>
              row.environment.role !== 'production' &&
              row.environment.production_environment_id === production.environment.id
          )
          .sort(compareRows),
      }));

      const claimed = new Set(
        groups.flatMap((group) => group.copies.map((row) => row.environment.id))
      );
      const orphans = rows
        .filter((row) => row.environment.role !== 'production' && !claimed.has(row.environment.id))
        .sort(compareRows);
      if (orphans.length > 0) groups.push({ production: null, copies: orphans });

      return { clientId, clientName: name, groups };
    })
    .sort((a, b) => a.clientName.localeCompare(b.clientName));

  const unregistered = installs
    .filter((install) => install.environment_id === null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { clients, unregistered };
}

export type Severity = 'gap' | 'warning' | 'info';

export type FindingCode =
  | 'below-minimum'
  | 'missing-role'
  | 'copy-without-production'
  | 'environment-type-mismatch'
  | 'sandbox-install'
  | 'live-type-copy'
  | 'production-on-staging-type'
  | 'install-not-live'
  | 'unregistered-install';

export interface Finding {
  readonly code: FindingCode;
  readonly severity: Severity;
  readonly clientId: number | null;
  readonly clientName: string;
  readonly role: Role | null;
  readonly environmentId: number | null;
  readonly hostname: string;
  readonly provider: string;
  readonly message: string;
  readonly remedy: string;
}

export interface ClientAudit {
  readonly clientId: number;
  readonly clientName: string;
  readonly rows: readonly InventoryRow[];
  readonly findings: readonly Finding[];
}

export interface AuditReport {
  readonly clients: readonly ClientAudit[];
  readonly unregistered: readonly Finding[];
  readonly totals: { readonly gaps: number; readonly warnings: number; readonly info: number };
}

function auditRow(row: InventoryRow, clientName: string): Finding[] {
  const { environment, install, siteType } = row;
  const base = {
    clientId: environment.client_id,
    clientName,
    role: environment.role,
    environmentId: environment.id,
    hostname: environment.hostname,
    provider: environment.provider,
  };
  const findings: Finding[] = [];

  if (!install) return findings;

  if (install.state !== 'live') {
    findings.push({
      ...base,
      code: 'install-not-live',
      severity: 'warning',
      message: `Pressable reports the install as "${install.state}"`,
      remedy: 'Check the site in MyPressable; a disabled or deploying site serves nothing.',
    });
  }

  if (siteType === 'sandbox') {
    findings.push({
      ...base,
      code: 'sandbox-install',
      severity: 'warning',
      message: 'Runs on a sandbox-type site, which carries Pressable\'s password-protection mu-plugin',
      remedy:
        'Convert it to a staging-type site (convert_site_type) and keep WP_ENVIRONMENT_TYPE ' +
        `set to "${environment.role}".`,
    });
  }

  if (environment.role === 'production' && siteType === 'staging') {
    findings.push({
      ...base,
      code: 'production-on-staging-type',
      severity: 'warning',
      message: 'Production runs on a staging-type site',
      remedy: 'Convert it to a live site before it takes real traffic (convert_site_type).',
    });
  }

  if (environment.role !== 'production' && siteType === 'live') {
    findings.push({
      ...base,
      code: 'live-type-copy',
      severity: 'warning',
      message: `A ${environment.role} environment runs on a live-type site, which counts against the plan`,
      remedy: 'Convert it to a staging-type site (convert_site_type) once its domains allow.',
    });
  }

  if (install.wp_environment_type !== environment.role) {
    findings.push({
      ...base,
      code: 'environment-type-mismatch',
      severity: 'gap',
      message:
        `WP_ENVIRONMENT_TYPE is "${install.wp_environment_type || 'unset'}" but the environment ` +
        `is registered as ${environment.role}`,
      remedy:
        `Set WP_ENVIRONMENT_TYPE to "${environment.role}" (update_site_wp_environment_type), ` +
        'or correct the role in api.linchpin.com. safety-net and Sisyphus read the constant.',
    });
  }

  return findings;
}

/**
 * Audit every client against the expected layout.
 *
 * Findings are per production group, so a client with two production sites
 * gets two sets of expectations rather than one that cannot be satisfied.
 */
export function auditInventory(inventory: Inventory): AuditReport {
  const clients: ClientAudit[] = inventory.clients.map((client) => {
    const rows: InventoryRow[] = [];
    const findings: Finding[] = [];

    for (const group of client.groups) {
      if (group.production) rows.push(group.production);
      rows.push(...group.copies);

      if (!group.production) {
        for (const row of group.copies) {
          findings.push({
            code: 'copy-without-production',
            severity: 'gap',
            clientId: client.clientId,
            clientName: client.clientName,
            role: row.environment.role,
            environmentId: row.environment.id,
            hostname: row.environment.hostname,
            provider: row.environment.provider,
            message: `Registered as ${row.environment.role} but points at no production of this client`,
            remedy:
              'Set production_environment_id on the environment (PATCH /environments/{id}) to the ' +
              'production it is a copy of.',
          });
        }
        continue;
      }

      const production = group.production.environment;
      const policy = policyFor(production.provider);
      const count = 1 + group.copies.length;
      const present = new Set<Role>([
        'production',
        ...group.copies.map((row) => row.environment.role),
      ]);
      const pressable = production.provider.toLowerCase() === 'pressable';

      if (count < policy.minimum) {
        findings.push({
          code: 'below-minimum',
          severity: 'gap',
          clientId: client.clientId,
          clientName: client.clientName,
          role: null,
          environmentId: production.id,
          hostname: production.hostname,
          provider: production.provider,
          message:
            `${production.hostname} has ${count === 1 ? 'only production' : `${count} environments`}; ` +
            `at least ${policy.minimum} are required`,
          remedy: pressable
            ? 'Create at least one copy as a staging-type site (never a sandbox), set its ' +
              'WP_ENVIRONMENT_TYPE to staging or development, and register it against ' +
              `environment ${production.id}.`
            : `Create a staging or development environment on ${production.provider} and ` +
              `register it against environment ${production.id}.`,
        });
      }

      for (const role of policy.expected) {
        if (present.has(role)) continue;
        findings.push({
          code: 'missing-role',
          severity: 'warning',
          clientId: client.clientId,
          clientName: client.clientName,
          role,
          environmentId: null,
          hostname: production.hostname,
          provider: production.provider,
          message: `No ${role} environment registered for ${production.hostname}`,
          remedy: pressable
            ? `Create a staging-type site (never a sandbox), set WP_ENVIRONMENT_TYPE to "${role}", ` +
              `then register it with role ${role} against environment ${production.id} — or record ` +
              'on the task that this client runs without one.'
            : `Create the ${role} environment on ${production.provider} and register it with ` +
              `role ${role} against environment ${production.id} — or record on the task that ` +
              'this client runs without one.',
        });
      }

      for (const row of [group.production, ...group.copies]) {
        findings.push(...auditRow(row, client.clientName));
      }
    }

    return { clientId: client.clientId, clientName: client.clientName, rows, findings };
  });

  const unregistered: Finding[] = inventory.unregistered.map((install) => ({
    code: 'unregistered-install',
    severity: 'info',
    clientId: null,
    clientName: '',
    role: null,
    environmentId: null,
    hostname: install.url || install.name,
    provider: 'pressable',
    message:
      `Pressable install ${install.id} (${install.name}, ${siteTypeOf(install)}, ` +
      `WP_ENVIRONMENT_TYPE=${install.wp_environment_type || 'unset'}) is registered to no client`,
    remedy:
      'Register it (POST /environments) with its client and role, or leave it if it is not a ' +
      'client environment.',
  }));

  const all = [...clients.flatMap((client) => client.findings), ...unregistered];
  const totals = {
    gaps: all.filter((finding) => finding.severity === 'gap').length,
    warnings: all.filter((finding) => finding.severity === 'warning').length,
    info: all.filter((finding) => finding.severity === 'info').length,
  };

  return { clients, unregistered, totals };
}

/** Case-insensitive match of a client by id, or by a substring of its name. */
export function clientMatches(client: { clientId: number; clientName: string }, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  if (/^\d+$/.test(needle)) return String(client.clientId) === needle;
  return client.clientName.toLowerCase().includes(needle);
}

/** Pad columns so a table reads in a terminal without a dependency. */
export function renderTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...rows.map((row) => (row[index] ?? '').length))
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
      .join('  ')
      .trimEnd();
  return [line(header), ...rows.map(line)].join('\n');
}
