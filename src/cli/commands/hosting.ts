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
import { EXIT_CODES } from '../errors.js';
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

function describeRow(row: InventoryRow): readonly string[] {
  const { environment, install, siteType } = row;
  return [
    environment.role,
    environment.hostname || environment.label || '—',
    environment.provider || '—',
    environment.provider_ref || '—',
    install ? siteType : '—',
    install ? install.wp_environment_type || 'unset' : '—',
    environment.deploy_branch
      ? `${environment.deploy_environment || '?'}@${environment.deploy_branch}`
      : environment.deploy_environment || '—',
  ];
}

function describeInstall(install: PressableInstall): readonly string[] {
  return [
    '—',
    install.url || install.name,
    'pressable',
    install.id,
    install.sandbox ? 'sandbox' : install.staging ? 'staging' : 'live',
    install.wp_environment_type || 'unset',
    '—',
  ];
}

const HEADER = ['Client', 'Role', 'Hostname', 'Host', 'Ref', 'Site type', 'WP type', 'Deploy'];

function renderInventory(inventory: Inventory, includeUnregistered: boolean): string {
  const rows: string[][] = [];

  for (const client of inventory.clients) {
    let first = true;
    for (const group of client.groups) {
      for (const row of [group.production, ...group.copies]) {
        if (!row) continue;
        rows.push([first ? client.clientName : '', ...describeRow(row)]);
        first = false;
      }
    }
  }

  if (includeUnregistered) {
    let first = true;
    for (const install of inventory.unregistered) {
      rows.push([first ? '(unregistered)' : '', ...describeInstall(install)]);
      first = false;
    }
  }

  if (rows.length === 0) return 'No environments.';
  return renderTable(HEADER, rows);
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
      'Reads the environment registry and, for Pressable, the host\'s own view of each\n' +
      'install: site type (live, staging, sandbox) and WP_ENVIRONMENT_TYPE. One row per\n' +
      'environment, grouped by client, production first.\n\n' +
      'Needs LINCHPIN_API_CLIENT_ID and LINCHPIN_API_CLIENT_SECRET (an application client\n' +
      'with sites:read), or LINCHPIN_API_TOKEN.',
    group: 'wordpress',
    examples: [
      'linchpin hosting ls',
      'linchpin hosting ls itca',
      'linchpin hosting ls --unregistered',
      'linchpin hosting ls linchpin --json',
    ],
  },
  effect: 'read',
  args: z.object({
    client: clientArg,
    unregistered: unregisteredArg,
  }),
  handler: async (args, ctx) => {
    const inventory = filterInventory(await loadInventory(), args.client);

    ctx.output.result(
      'hosting_ls',
      {
        clients: inventory.clients,
        unregistered: args.unregistered ? inventory.unregistered : [],
      },
      { human: renderInventory(inventory, args.unregistered) }
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
