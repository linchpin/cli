import { Option } from 'commander';
import { z } from 'zod';

import { readArgMeta, toKebabCase, type ArgMeta } from './registry.js';

/** A schema field reduced to what Commander needs to represent it. */
export interface DerivedField {
  readonly key: string;
  readonly flag: string;
  readonly kind: 'boolean' | 'number' | 'string' | 'enum' | 'array';
  readonly required: boolean;
  readonly positional: boolean;
  readonly variadic: boolean;
  readonly description: string;
  readonly defaultValue: unknown;
  readonly choices: readonly string[] | undefined;
  readonly valueName: string;
  readonly alias: string | undefined;
}

interface Unwrapped {
  readonly core: z.ZodType;
  readonly optional: boolean;
  readonly defaultValue: unknown;
  readonly description: string | undefined;
  readonly meta: ArgMeta;
}

/**
 * Peel `.optional()` / `.default()` / `.nullable()` off a field.
 *
 * `.describe()` and `.meta()` attach at whichever level they were called, so
 * both are collected from the outside in and the first hit wins — otherwise
 * `z.string().describe('x').optional()` and `z.string().optional().describe('x')`
 * would behave differently, which would be a trap rather than a feature.
 */
function unwrap(schema: z.ZodType): Unwrapped {
  let current: z.ZodType = schema;
  let optional = false;
  let defaultValue: unknown;
  let description: string | undefined;
  let meta: ArgMeta = {};

  for (;;) {
    description ??= current.description;
    const found = readArgMeta(current);
    meta = { ...found, ...meta };

    const def = current.def as { type: string; innerType?: z.ZodType; defaultValue?: unknown };

    if (def.type === 'default') {
      const raw = def.defaultValue;
      defaultValue = typeof raw === 'function' ? (raw as () => unknown)() : raw;
    } else if (def.type === 'optional' || def.type === 'nullable') {
      optional = true;
    } else {
      break;
    }

    if (!def.innerType) break;
    current = def.innerType;
  }

  return { core: current, optional, defaultValue, description, meta };
}

function classify(core: z.ZodType): DerivedField['kind'] {
  const type = (core.def as { type: string }).type;

  switch (type) {
    case 'boolean':
      return 'boolean';
    case 'number':
    case 'int':
      return 'number';
    case 'enum':
      return 'enum';
    case 'array':
      return 'array';
    default:
      return 'string';
  }
}

/** Reduce an object schema to the fields Commander should expose. */
export function deriveFields(schema: z.ZodType): DerivedField[] {
  const def = schema.def as { type: string; shape?: Record<string, z.ZodType> };

  if (def.type !== 'object' || !def.shape) return [];

  return Object.entries(def.shape).map(([key, fieldSchema]) => {
    const { core, optional, defaultValue, description, meta } = unwrap(fieldSchema);
    const kind = classify(core);
    const hasDefault = defaultValue !== undefined;
    const kebab = toKebabCase(key);

    const choices =
      kind === 'enum'
        ? ((core as unknown as { options: readonly string[] }).options ?? undefined)
        : undefined;

    return {
      key,
      flag: kebab,
      kind,
      required: !optional && !hasDefault,
      positional: meta.positional === true,
      variadic: meta.variadic === true || kind === 'array',
      description: description ?? '',
      defaultValue,
      choices,
      valueName: meta.valueName ?? kebab,
      alias: meta.alias,
    } satisfies DerivedField;
  });
}

/**
 * Build the Commander flag spec for a field.
 *
 * Commander parses both `--foo bar` and `--foo=bar` for every option it knows
 * about, which is what retires the old hand-rolled `readOptionValue` that was
 * `indexOf`-only and silently ignored the `=` form.
 */
export function buildOption(field: DerivedField): Option {
  const short = field.variadic && field.kind === 'array' ? '...' : '';
  const alias = field.alias ? `-${field.alias}, ` : '';

  const flags =
    field.kind === 'boolean'
      ? `${alias}--${field.flag}`
      : `${alias}--${field.flag} <${field.valueName}${short}>`;

  const option = new Option(flags, field.description);

  if (field.choices) option.choices([...field.choices]);
  if (field.defaultValue !== undefined) option.default(field.defaultValue);
  if (field.required) option.makeOptionMandatory();
  if (field.kind === 'number') option.argParser((value) => Number(value));

  if (field.kind === 'array') {
    option.argParser((value: string, previous: string[] | undefined) => [
      ...(previous ?? []),
      value,
    ]);
  }

  return option;
}
