import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { runCommand } from './exec.js';

export interface PluginScaffoldPin {
  readonly repo: string;
  readonly tag: string;
  readonly sha: string;
}

/** Keep in lockstep with plugin-scaffold-pin.json. */
export const PLUGIN_SCAFFOLD_PIN: PluginScaffoldPin = {
  repo: 'linchpin/plugin-scaffold',
  tag: 'v0.1.0',
  sha: 'bfe22dd413997562d015f4fa1a1f4b0bc54a1e40',
};

export const CHANNELS = ['private', 'wporg', 'self-hosted'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface ScaffoldOptions {
  readonly slug: string;
  readonly name?: string;
  readonly description?: string;
  readonly php?: string;
  readonly channel?: Channel;
  readonly withBlocks?: boolean;
  readonly dest: string;
  readonly ref?: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
  readonly git?: boolean;
  readonly install?: boolean;
}

export interface ScaffoldResult {
  readonly dest: string;
  readonly slug: string;
  readonly name: string;
  readonly files: readonly string[];
  readonly wrote: boolean;
  readonly templateRoot: string;
}

const SKIP_FROM_TEMPLATE = new Set([
  '.git',
  'node_modules',
  'vendor',
  'overlays',
  '.phpunit.cache',
  '.php-cs-fixer.cache',
]);

const SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;
const BANNER_URL = 'https://assets.linchpin.com/github/linchpin-github-repo-banner.jpg';

export function loadPin(): PluginScaffoldPin {
  return PLUGIN_SCAFFOLD_PIN;
}

export function titleCaseSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function studlySlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('_');
}

export function constSlug(slug: string): string {
  return slug.toUpperCase().replace(/-/g, '_');
}

export function assertValidSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `Invalid plugin slug "${slug}". Use a lowercase kebab-case name starting with a letter.`
    );
  }
}

export function cacheDirectory(): string {
  return process.env.LINCHPIN_CACHE_DIR ?? join(homedir(), '.linchpin', 'cache');
}

/**
 * A local directory, or a cached clone of the pinned (or overridden) ref.
 */
export function resolveTemplateRoot(ref?: string): string {
  const pin = loadPin();
  const requested = ref ?? pin.tag;

  if (requested.startsWith('file:')) {
    return resolve(requested.slice('file:'.length));
  }

  if (requested.startsWith('/') || requested.startsWith('.')) {
    return resolve(requested);
  }

  const dest = join(cacheDirectory(), 'plugin-scaffold', requested.replace(/[^a-zA-Z0-9._-]/g, '_'));

  if (existsSync(join(dest, 'plugin-scaffold.php'))) {
    return dest;
  }

  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }

  const result = runCommand(
    'gh',
    ['repo', 'clone', pin.repo, dest, '--', '--depth', '1', '--branch', requested],
    { allowFailure: true }
  );

  if (!result.ok) {
    throw new Error(
      `Could not fetch ${pin.repo}@${requested}. ${result.stderr.trim() || result.stdout.trim()}`
    );
  }

  return dest;
}

function listFiles(root: string): string[] {
  const out: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      out.push(full);
    }
  };

  walk(root);
  return out.sort();
}

function isInsideGitRepo(dir: string): boolean {
  const result = runCommand('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir,
    allowFailure: true,
  });
  return result.ok;
}

function destinationOccupied(dest: string): boolean {
  if (!existsSync(dest)) {
    return false;
  }

  return readdirSync(dest).length > 0;
}

function copyTemplate(templateRoot: string, dest: string): void {
  mkdirSync(dest, { recursive: true });

  for (const entry of readdirSync(templateRoot, { withFileTypes: true })) {
    if (SKIP_FROM_TEMPLATE.has(entry.name)) {
      continue;
    }

    cpSync(join(templateRoot, entry.name), join(dest, entry.name), { recursive: true });
  }
}

function copyOverlay(templateRoot: string, dest: string, name: string): void {
  const overlay = join(templateRoot, 'overlays', name);
  if (!existsSync(overlay)) {
    throw new Error(`Overlay "${name}" is missing from ${templateRoot}`);
  }

  for (const entry of readdirSync(overlay, { withFileTypes: true })) {
    if (entry.name === 'package-scripts.json') {
      continue;
    }

    cpSync(join(overlay, entry.name), join(dest, entry.name), { recursive: true });
  }

  const scriptsPath = join(overlay, 'package-scripts.json');
  if (existsSync(scriptsPath)) {
    mergePackageScripts(dest, JSON.parse(readFileSync(scriptsPath, 'utf8')) as Record<string, string>);
  }
}

function mergePackageScripts(dest: string, extra: Record<string, string>): void {
  const packagePath = join(dest, 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, string> };
  pkg.scripts = { ...pkg.scripts, ...extra };
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function insertUpdateUri(dest: string, slug: string): void {
  const mainFile = join(dest, `${slug}.php`);
  const source = readFileSync(mainFile, 'utf8');
  if (source.includes('Update URI:')) {
    return;
  }

  const updated = source.replace(
    /(\s*\*\s*Plugin URI:\s*.+\n)/,
    `$1 * Update URI:        https://api.linchpin.com/updates/${slug}\n`
  );
  writeFileSync(mainFile, updated);
}

function renameIdentity(dest: string, slug: string): void {
  const replacements: ReadonlyArray<readonly [string, string]> = [
    ['Linchpin\\Plugin_Scaffold', `Linchpin\\${studlySlug(slug)}`],
    ['linchpin/plugin-scaffold', `linchpin/${slug}`],
    ['plugin-scaffold', slug],
    ['Plugin_Scaffold', studlySlug(slug)],
    ['PLUGIN_SCAFFOLD', constSlug(slug)],
  ];

  for (const file of listFiles(dest)) {
    const raw = readFileSync(file);
    if (raw.includes(0)) {
      continue;
    }

    let text = raw.toString('utf8');
    if (text.includes(BANNER_URL)) {
      const parts = text.split(BANNER_URL);
      const rewritten = parts.map((part, index) => {
        if (index === parts.length - 1) {
          return applyReplacements(part, replacements);
        }
        return applyReplacements(part, replacements);
      });
      // Banner URL is spliced back in unchanged.
      text = rewritten.join(BANNER_URL);
    } else {
      text = applyReplacements(text, replacements);
    }

    writeFileSync(file, text);
  }

  renamePaths(dest, 'plugin-scaffold', slug);
}

function applyReplacements(
  text: string,
  replacements: ReadonlyArray<readonly [string, string]>
): string {
  let next = text;
  for (const [from, to] of replacements) {
    next = next.split(from).join(to);
  }
  return next;
}

function renamePaths(root: string, from: string, to: string): void {
  const entries = listFiles(root)
    .map((file) => relative(root, file))
    .filter((rel) => rel.includes(from))
    .sort((a, b) => b.length - a.length);

  for (const rel of entries) {
    const source = join(root, rel);
    const targetRel = rel.split(from).join(to);
    const target = join(root, targetRel);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
    rmSync(source);
  }

  pruneEmptyDirs(root);
}

function pruneEmptyDirs(root: string): void {
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const full = join(dir, entry.name);
      walk(full);
      if (readdirSync(full).length === 0) {
        rmSync(full, { recursive: true, force: true });
      }
    }
  };

  walk(root);
}

function applyDisplayIdentity(
  dest: string,
  slug: string,
  name: string,
  description: string,
  php: string
): void {
  const mainFile = join(dest, `${slug}.php`);
  let phpSource = readFileSync(mainFile, 'utf8');
  phpSource = phpSource.replace(/^(\s*\*\s*Plugin Name:\s*).+$/m, `$1${name}`);
  phpSource = phpSource.replace(/^(\s*\*\s*Description:\s*).+$/m, `$1${description}`);
  if (php !== '8.3') {
    phpSource = phpSource.replace(/Requires PHP:\s*8\.3/, `Requires PHP:      ${php}`);
  }
  writeFileSync(mainFile, phpSource);

  const readmePath = join(dest, 'README.md');
  let readme = readFileSync(readmePath, 'utf8');
  readme = readme.replace(/^# .+$/m, `# ${name}`);
  readme = readme.replace(/^(# .+\n\n).+(\n)/, `$1${description}$2`);
  writeFileSync(readmePath, readme);

  const composerPath = join(dest, 'composer.json');
  const composer = JSON.parse(readFileSync(composerPath, 'utf8')) as {
    description?: string;
    require?: Record<string, string>;
    config?: { platform?: { php?: string } };
  };
  composer.description = description;
  if (php !== '8.3') {
    if (composer.require) {
      composer.require.php = `>=${php}`;
    }
    if (composer.config?.platform) {
      composer.config.platform.php = `${php}.0`;
    }
  }
  writeFileSync(composerPath, `${JSON.stringify(composer, null, 2)}\n`);
}

export function leftoverIdentity(dest: string): string[] {
  const leftovers: string[] = [];

  for (const file of listFiles(dest)) {
    const raw = readFileSync(file);
    if (raw.includes(0)) {
      continue;
    }

    const text = raw.toString('utf8');
    const withoutBanner = text.split(BANNER_URL).join('');
    if (
      withoutBanner.includes('plugin-scaffold') ||
      withoutBanner.includes('Plugin_Scaffold') ||
      withoutBanner.includes('PLUGIN_SCAFFOLD')
    ) {
      leftovers.push(relative(dest, file));
    }
  }

  return leftovers;
}

export function collectPlannedFiles(
  templateRoot: string,
  options: Pick<ScaffoldOptions, 'withBlocks' | 'channel'>
): string[] {
  const names = readdirSync(templateRoot).filter((name) => !SKIP_FROM_TEMPLATE.has(name));
  const planned = new Set(names);

  if (options.withBlocks) {
    planned.add('blocks');
    planned.add(join('includes', 'Controller', 'Blocks.php'));
  }

  if (options.channel === 'wporg') {
    planned.add('readme.txt');
    planned.add('.wordpress-org');
  }

  return [...planned].sort();
}

/**
 * Render a Linchpin plugin from the house standard.
 */
export function scaffoldPlugin(options: ScaffoldOptions): ScaffoldResult {
  assertValidSlug(options.slug);

  const dest = resolve(options.dest);
  const name = options.name?.trim() || titleCaseSlug(options.slug);
  const description =
    options.description?.trim() ||
    `A WordPress plugin generated from the Linchpin plugin standard.`;
  const php = options.php ?? '8.3';
  const channel = options.channel ?? 'private';
  const templateRoot = resolveTemplateRoot(options.ref);

  if (!existsSync(join(templateRoot, 'plugin-scaffold.php'))) {
    throw new Error(`Template at ${templateRoot} is not a plugin-scaffold tree.`);
  }

  if (destinationOccupied(dest) && !options.force) {
    throw new Error(
      `Destination ${dest} is not empty. Pass --force to overwrite, or choose another --path.`
    );
  }

  const planned = collectPlannedFiles(templateRoot, options);

  if (options.dryRun) {
    return {
      dest,
      slug: options.slug,
      name,
      files: planned,
      wrote: false,
      templateRoot,
    };
  }

  if (existsSync(dest) && options.force) {
    rmSync(dest, { recursive: true, force: true });
  }

  copyTemplate(templateRoot, dest);

  if (options.withBlocks) {
    copyOverlay(templateRoot, dest, 'blocks');
  }

  if (channel === 'wporg') {
    copyOverlay(templateRoot, dest, 'wporg');
  }

  if (channel === 'self-hosted') {
    copyOverlay(templateRoot, dest, 'self-hosted');
  }

  renameIdentity(dest, options.slug);
  applyDisplayIdentity(dest, options.slug, name, description, php);

  if (channel === 'self-hosted') {
    insertUpdateUri(dest, options.slug);
  }

  const leftovers = leftoverIdentity(dest);
  if (leftovers.length > 0) {
    throw new Error(
      `Rename left plugin-scaffold identity in: ${leftovers.slice(0, 8).join(', ')}`
    );
  }

  if (options.git && !isInsideGitRepo(dest)) {
    runCommand('git', ['init', '-b', 'main'], { cwd: dest });
  }

  if (options.install) {
    runCommand('composer', ['install'], { cwd: dest, inherit: true });
    runCommand('npm', ['install'], { cwd: dest, inherit: true });
  }

  const files = listFiles(dest).map((file) => relative(dest, file).split(sep).join('/'));

  return {
    dest,
    slug: options.slug,
    name,
    files,
    wrote: true,
    templateRoot,
  };
}

export function assertBannerIntact(dest: string): void {
  const readme = readFileSync(join(dest, 'README.md'), 'utf8');
  if (!readme.includes(BANNER_URL)) {
    throw new Error('README.md is missing the house banner URL.');
  }
}

export { BANNER_URL };
