import { readFileSync } from 'node:fs';

/**
 * The published version, read from package.json at runtime.
 *
 * Read rather than inlined at build time so the value cannot drift from the
 * manifest release-please owns. The bundled entry lives in `dist/`, one level
 * below the manifest — the same depth as `src/` during development, so this
 * relative path resolves identically in both.
 *
 * Fixes the hardcoded '0.1.0' that shipped while the package was at 1.0.19
 * (LINCHPIN-5366).
 */
export function readVersion(): string {
  const manifestUrl = new URL('../package.json', import.meta.url);
  const raw = readFileSync(manifestUrl, 'utf8');
  const parsed: unknown = JSON.parse(raw);

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    typeof parsed.version !== 'string'
  ) {
    throw new Error('package.json is missing a string "version" field');
  }

  return parsed.version;
}
