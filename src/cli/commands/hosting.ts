import { z } from 'zod';

import {
  auditInventory,
  buildInventory,
  clientMatches,
  renderTable,
  type AuditReport,
  type ClientAudit,
  type Finding,
  type Inventory,
  type InventoryRow,
} from '../../core/hosting.js';
import { LinchpinApi, type PressableInstall } from '../../core/linchpin-api.js';
import { EXIT_CODES, UserError } from '../errors.js';
import { defineCommand } from '../registry.js';

/**
 * `linchpin hosting` — a client's hosting environments, as api.linchpin.com
 * knows them, and the gaps against the layout every client is meant to have.
 *
 * Both verbs are reads. Provisioning the missing environments is specified in
 * docs/hosting.md and lands once the api can create a site on a host.
 */

async function loadInventory(): Promise<Inventory> {
  const api = new LinchpinApi();
  const [environments, pressable] = await Promise.all([
    api.listEnvironments(),
    api.listPressableInstalls(),
  ]);
  return buildInventory(environments, pressable.installs);
}

/** The columns `hosting ls` can show, in table order. `--fields` picks from these. */
export const LS_FIELDS = [
  'client',
  'role',
  'hostname',
  'host',
  'ref',
  'type',
  'wp',
  'deploy',
] as const;
export type LsField = (typeof LS_FIELDS)[number];

const FIELD_HEADERS: Record<LsField, string> = {
  client: 'Client',
  role: 'Role',
  hostname: 'Hostname',
  host: 'Host',
  ref: 'Ref',
  type: 'Site type',
  wp: 'WP type',
  deploy: 'Deploy',
};

/** `--brief`: the three columns that identify an environment and nothing else. */
const BRIEF_FIELDS: readonly LsField[] = ['client', 'role', 'hostname'];

/** One environment, flattened to the columns the table and the JSON share. */
export interface LsRow {
  readonly environmentId: number | null;
  readonly clientId: number | null;
  readonly client: string;
  readonly role: string;
  readonly hostname: string;
  readonly host: string;
  readonly ref: string;
  readonly type: string;
  readonly wp: string;
  readonly deploy: string;
}

function rowFor(client: string, clientId: number, row: InventoryRow): LsRow {
  const { environment, install, siteType } = row;
  return {
    environmentId: environment.id,
    clientId,
    client,
    role: environment.role,
    hostname: environment.hostname || environment.label,
    host: environment.provider,
    ref: environment.provider_ref,
    type: install ? siteType : '',
    wp: install ? install.wp_environment_type : '',
    deploy: environment.deploy_branch
      ? `${environment.deploy_environment || '?'}@${environment.deploy_branch}`
      : environment.deploy_environment,
  };
}

function rowForInstall(install: PressableInstall): LsRow {
  return {
    environmentId: null,
    clientId: null,
    client: '',
    role: '',
    hostname: install.url || install.name,
    host: 'pressable',
    ref: install.id,
    type: install.sandbox ? 'sandbox' : install.staging ? 'staging' : 'live',
    wp: install.wp_environment_type,
    deploy: '',
  };
}

/** Every environment as a flat row, production first within each client. */
function flattenInventory(inventory: Inventory): LsRow[] {
  const rows: LsRow[] = [];
  for (const client of inventory.clients) {
    for (const group of client.groups) {
      for (const row of [group.production, ...group.copies]) {
        if (row) rows.push(rowFor(client.clientName, client.clientId, row));
      }
    }
  }
  return rows;
}

/** Parse `--fields a,b,c`, rejecting a name that is not a column. */
export function parseFields(value: string | undefined, brief: boolean): readonly LsField[] {
  if (value === undefined) return brief ? BRIEF_FIELDS : LS_FIELDS;

  const wanted = value
    .split(',')
    .map((field) => field.trim().toLowerCase())
    .filter((field) => field !== '');
  const unknown = wanted.filter((field) => !(LS_FIELDS as readonly string[]).includes(field));

  if (wanted.length === 0 || unknown.length > 0) {
    throw new UserError(
      unknown.length > 0
        ? `Unknown field(s) for --fields: ${unknown.join(', ')}`
        : '--fields needs at least one column',
      {
        exitCode: EXIT_CODES.validation,
        code: 'invalid_fields',
        remedy: `Choose from: ${LS_FIELDS.join(', ')}`,
      }
    );
  }

  return wanted as LsField[];
}

function renderRows(rows: readonly LsRow[], fields: readonly LsField[]): string {
  if (rows.length === 0) return 'No environments.';

  // The client name is printed once per run of rows, as a table reads better
  // that way; the JSON keeps it on every row, as a filter needs it there.
  let previousClient: string | null = null;
  const cells = rows.map((row) => {
    const repeat = row.client === previousClient;
    previousClient = row.client;
    return fields.map((field) => {
      const value = row[field];
      if (field === 'client') {
        if (repeat) return '';
        return value === '' ? '(unregistered)' : value;
      }
      return value === '' ? '—' : value;
    });
  });

  return renderTable(
    fields.map((field) => FIELD_HEADERS[field]),
    cells
  );
}

const MARK: Record<Finding['severity'], string> = { gap: '✗', warning: '⚠', info: '·' };

function renderClientAudit(client: ClientAudit): string[] {
  const lines = [client.clientName];
  const byEnvironment = new Map<number, Finding[]>();
  const missing: Finding[] = [];

  for (const finding of client.findings) {
    if (finding.environmentId === null) {
      missing.push(finding);
      continue;
    }
    byEnvironment.set(finding.environmentId, [
      ...(byEnvironment.get(finding.environmentId) ?? []),
      finding,
    ]);
  }

  for (const row of client.rows) {
    const findings = byEnvironment.get(row.environment.id) ?? [];
    const worst = findings.find((f) => f.severity === 'gap') ?? findings[0];
    const mark = worst ? MARK[worst.severity] : '✓';
    const where = `${row.environment.hostname || row.environment.label}`;
    const detail = row.install
      ? ` (${row.environment.provider} ${row.environment.provider_ref}, ${row.siteType} · ${row.install.wp_environment_type || 'unset'})`
      : row.environment.provider
        ? ` (${row.environment.provider} ${row.environment.provider_ref || '?'})`
        : '';
    lines.push(`  ${mark} ${row.environment.role.padEnd(11)}  ${where}${detail}`);
    for (const finding of findings) {
      lines.push(`      ${finding.message}.`);
      lines.push(`      → ${finding.remedy}`);
    }
  }

  for (const finding of missing) {
    lines.push(`  ${MARK[finding.severity]} ${(finding.role ?? '?').padEnd(11)}  missing — ${finding.message}.`);
    lines.push(`      → ${finding.remedy}`);
  }

  return lines;
}

function renderAudit(report: AuditReport, includeUnregistered: boolean): string {
  const blocks = report.clients.map((client) => renderClientAudit(client).join('\n'));

  if (includeUnregistered && report.unregistered.length > 0) {
    blocks.push(
      [
        'Unregistered Pressable installs',
        ...report.unregistered.map((finding) => `  ${MARK.info} ${finding.message}.`),
        `      → ${report.unregistered[0]?.remedy ?? ''}`,
      ].join('\n')
    );
  }

  const { gaps, warnings, info } = report.totals;
  const summary = `${gaps} gap${gaps === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}` +
    (includeUnregistered ? `, ${info} unregistered` : '');

  return [...blocks, '', summary].join('\n');
}

const clientArg = z
  .string()
  .optional()
  .describe('Client name (substring, case-insensitive) or client id. All clients when omitted')
  .meta({ positional: true, valueName: 'client' });

const unregisteredArg = z
  .boolean()
  .default(false)
  .describe('Also list host installs that no client environment is registered against');

function filterInventory(inventory: Inventory, client: string | undefined): Inventory {
  if (client === undefined) return inventory;
  return {
    clients: inventory.clients.filter((entry) => clientMatches(entry, client)),
    unregistered: inventory.unregistered,
  };
}

export const hostingLsCommand = defineCommand({
  meta: {
    name: 'hosting ls',
    summary: "List a client's hosting environments as api.linchpin.com knows them",
    description:
      "Reads the environment registry and, for Pressable, the host's own view of each\n" +
      'install: site type (live, staging, sandbox) and WP_ENVIRONMENT_TYPE. One row per\n' +
      'environment, grouped by client, production first. --fields picks columns, --brief\n' +
      'keeps client, role and hostname, --limit caps the rows.\n\n' +
      'Needs LINCHPIN_API_CLIENT_ID and LINCHPIN_API_CLIENT_SECRET (an application client\n' +
      'with sites:read), or LINCHPIN_API_TOKEN.',
    group: 'wordpress',
    examples: [
      'linchpin hosting ls',
      'linchpin hosting ls itca',
      'linchpin hosting ls --brief',
      'linchpin hosting ls --fields client,role,hostname,wp --json',
      'linchpin hosting ls --unregistered --limit 20',
    ],
  },
  effect: 'read',
  args: z.object({
    client: clientArg,
    unregistered: unregisteredArg,
    fields: z
      .string()
      .optional()
      .describe(`Comma-separated columns to show: ${LS_FIELDS.join(', ')}`),
    brief: z
      .boolean()
      .default(false)
      .describe('Only client, role and hostname — the shortest output that still identifies each environment'),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Show at most this many rows; the JSON reports total and truncated'),
  }),
  handler: async (args, ctx) => {
    const fields = parseFields(args.fields, args.brief);
    const inventory = filterInventory(await loadInventory(), args.client);

    const all = [
      ...flattenInventory(inventory),
      ...(args.unregistered ? inventory.unregistered.map(rowForInstall) : []),
    ];
    const rows = args.limit === undefined ? all : all.slice(0, args.limit);
    const truncated = rows.length < all.length;

    const projected = rows.map((row) =>
      Object.fromEntries([
        ['environmentId', row.environmentId],
        ['clientId', row.clientId],
        ...fields.map((field) => [field, row[field]] as const),
      ])
    );

    const human = renderRows(rows, fields);
    ctx.output.result(
      'hosting_ls',
      { environments: projected, total: all.length, truncated },
      {
        human: truncated ? `${human}\n\n${rows.length} of ${all.length} rows (--limit)` : human,
      }
    );
  },
});

export const hostingAuditCommand = defineCommand({
  meta: {
    name: 'hosting audit',
    summary: "Report the gaps between a client's hosting and Linchpin's expected layout",
    description:
      'Every production needs at least one copy beside it (two environments), and is\n' +
      'expected to have both a staging and a development environment; more are fine. On\n' +
      'Pressable each copy should be a staging-type site (never a sandbox) whose\n' +
      'WP_ENVIRONMENT_TYPE names its role — that constant is what safety-net and\n' +
      'Sisyphus read.\n\n' +
      'Exits 3 when a gap is found, so an agent or CI can branch on it; warnings (a\n' +
      'missing third environment) and unregistered installs do not fail the run.',
    group: 'wordpress',
    examples: [
      'linchpin hosting audit',
      'linchpin hosting audit linchpin',
      'linchpin hosting audit --unregistered',
      'linchpin hosting audit itca --json',
    ],
  },
  effect: 'read',
  args: z.object({
    client: clientArg,
    unregistered: unregisteredArg,
  }),
  handler: async (args, ctx) => {
    const inventory = filterInventory(await loadInventory(), args.client);
    const report = auditInventory(inventory);

    ctx.output.result(
      'hosting_audit',
      {
        clients: report.clients.map((client) => ({
          clientId: client.clientId,
          clientName: client.clientName,
          findings: client.findings,
        })),
        unregistered: args.unregistered ? report.unregistered : [],
        totals: report.totals,
      },
      { human: renderAudit(report, args.unregistered) }
    );

    return report.totals.gaps > 0 ? EXIT_CODES.precondition : EXIT_CODES.ok;
  },
});
