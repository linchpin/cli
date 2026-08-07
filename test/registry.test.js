const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The registry is ESM; this test file is CommonJS. Dynamic import bridges them.
const LIB = pathToFileURL(path.resolve(__dirname, '..', 'dist', 'index.js')).href;

let lib;
test.before(async () => {
  lib = await import(LIB);
});

test('every registered command declares an effect', () => {
  const { COMMANDS, EFFECTS, assertAllCommandsClassified } = lib;

  assert.ok(COMMANDS.length > 0, 'expected at least one registered command');

  for (const command of COMMANDS) {
    assert.ok(
      EFFECTS.includes(command.effect),
      `${command.meta.name} has effect ${JSON.stringify(command.effect)}, expected one of ${EFFECTS.join(' | ')}`
    );
  }

  assert.doesNotThrow(() => assertAllCommandsClassified(COMMANDS));
});

test('an unclassified command is rejected rather than assumed safe', () => {
  const { assertAllCommandsClassified } = lib;

  const unclassified = [{ meta: { name: 'rogue' }, effect: undefined }];
  assert.throws(() => assertAllCommandsClassified(unclassified), /missing a valid effect/);

  // "safe-looking" is not a classification either.
  const bogus = [{ meta: { name: 'rogue' }, effect: 'safe' }];
  assert.throws(() => assertAllCommandsClassified(bogus), /missing a valid effect/);
});

test('every command carries the metadata help and the manifest need', () => {
  const { COMMANDS, GROUPS } = lib;

  for (const command of COMMANDS) {
    const { name, summary, group } = command.meta;
    assert.ok(name && name.trim().length > 0, 'command needs a name');
    assert.ok(summary && summary.trim().length > 0, `${name} needs a summary`);
    assert.ok(group in GROUPS, `${name} has group ${group}, which is not in GROUPS`);
    assert.doesNotMatch(summary, /\.$/, `${name} summary should not end with a period`);
  }
});

test('schema fields derive into CLI flags', async () => {
  const { deriveFields } = lib;
  const { z } = await import('zod');

  const schema = z.object({
    pluginSlug: z.string().describe('Plugin slug'),
    force: z.boolean().default(false),
    mode: z.enum(['plugin', 'theme']).optional(),
    count: z.number().optional(),
    file: z.array(z.string()).optional(),
  });

  const fields = Object.fromEntries(deriveFields(schema).map((f) => [f.key, f]));

  // camelCase field -> kebab-case flag. This is the pairing the old
  // readOptionValue got wrong: --plugin-slug=x was silently ignored.
  assert.equal(fields.pluginSlug.flag, 'plugin-slug');
  assert.equal(fields.pluginSlug.required, true);
  assert.equal(fields.pluginSlug.description, 'Plugin slug');

  // A default makes a field optional at the CLI boundary.
  assert.equal(fields.force.kind, 'boolean');
  assert.equal(fields.force.required, false);
  assert.equal(fields.force.defaultValue, false);

  assert.equal(fields.mode.kind, 'enum');
  assert.deepEqual([...fields.mode.choices], ['plugin', 'theme']);
  assert.equal(fields.mode.required, false);

  assert.equal(fields.count.kind, 'number');
  assert.equal(fields.file.kind, 'array');
  assert.equal(fields.file.variadic, true);
});

test('describe and meta are found wherever they sit in the wrapper chain', async () => {
  const { deriveFields } = lib;
  const { z } = await import('zod');

  // .describe()/.meta() attach at the level they were called, so both orderings
  // must behave identically or the ordering becomes a trap.
  const schema = z.object({
    before: z.string().describe('described first').optional(),
    after: z.string().optional().describe('described last'),
    aliased: z.string().meta({ alias: 'b', valueName: 'branch' }).optional(),
  });

  const fields = Object.fromEntries(deriveFields(schema).map((f) => [f.key, f]));

  assert.equal(fields.before.description, 'described first');
  assert.equal(fields.after.description, 'described last');
  assert.equal(fields.aliased.alias, 'b');
  assert.equal(fields.aliased.valueName, 'branch');
});

test('the registry produces a JSON Schema for the agent manifest', async () => {
  const { COMMANDS } = lib;
  const { z } = await import('zod');

  for (const command of COMMANDS) {
    const json = z.toJSONSchema(command.args);
    assert.equal(json.type, 'object', `${command.meta.name} args should be an object schema`);
  }
});
