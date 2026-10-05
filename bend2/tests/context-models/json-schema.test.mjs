// Domain provider tests: JSON Schema admission and validation through the real
// Ajv 8.17.1 draft 2020-12 entry point.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DRAFT_2020_12, createJsonSchemaProvider, readJsonSample, resolveJsonPointer } from '../../context/models/index.mjs';
import { loadAjv2020, loadAjvVersion } from './helpers/deps.mjs';

async function buildProvider() {
  const { constructor, specifier } = await loadAjv2020();
  const { version, manifest } = await loadAjvVersion();
  return { provider: createJsonSchemaProvider({ Ajv2020: constructor, version, path: manifest }), specifier, version };
}

const ORDER_SCHEMA = {
  $schema: DRAFT_2020_12,
  $id: 'https://example.test/order',
  type: 'object',
  properties: {
    email: { type: 'string' },
    total_cents: { type: 'integer', minimum: 0 },
  },
  required: ['email', 'total_cents'],
  additionalProperties: false,
};

test('the provider reports the real Ajv package it was built from', async () => {
  const { provider, specifier, version } = await buildProvider();
  assert.equal(version, '8.17.1');
  assert.equal(provider.provider.name, 'ajv');
  assert.equal(provider.provider.version, '8.17.1');
  assert.equal(provider.provider.options.strict, true);
  assert.equal(provider.provider.options.allErrors, true);
  assert.equal(provider.provider.options.validateFormats, true);
  assert.equal(provider.provider.options.coerceTypes, false);
  assert.equal(provider.provider.options.useDefaults, false);
  assert.ok(specifier.endsWith('ajv/dist/2020.js'), 'the draft 2020-12 entry point is the imported specifier');
});

test('a draft 2020-12 document is admitted and an instance is validated with the rule parameters', async () => {
  const { provider } = await buildProvider();
  const metaschema = provider.validateSchema({ schema: ORDER_SCHEMA });
  assert.equal(metaschema.verdict, true);

  const good = provider.validate({ schema: ORDER_SCHEMA, instance: { email: 'a@b.co', total_cents: 1250 } });
  assert.equal(good.status, 'validated');
  assert.equal(good.verdict, true);
  assert.deepEqual(good.errors, []);

  const bad = provider.validate({ schema: ORDER_SCHEMA, instance: { email: 'a@b.co', total_cents: -5, extra: 1 } });
  assert.equal(bad.verdict, false);
  const minimum = bad.errors.find(error => error.keyword === 'minimum');
  assert.ok(minimum, 'the failing rule is reported with its own keyword');
  assert.equal(minimum.instancePath, '/total_cents');
  assert.equal(minimum.schemaPath, '#/properties/total_cents/minimum');
  assert.deepEqual(minimum.params, { comparison: '>=', limit: 0 });
  const additional = bad.errors.find(error => error.keyword === 'additionalProperties');
  assert.equal(additional.instancePath, '');
  assert.equal(additional.params.additionalProperty, 'extra');
});

test('an unknown format rejects schema admission', async () => {
  const { provider } = await buildProvider();
  const refused = provider.admit({ schema: { $schema: DRAFT_2020_12, type: 'string', format: 'phone-number' } });
  assert.equal(refused.status, 'refused');
  assert.equal(refused.reason, 'unknownFormat');
  assert.match(refused.detail, /unknown format/);
});

test('a reference outside the supplied resources is refused before any loader runs', async () => {
  const { provider } = await buildProvider();
  const remote = provider.admit({
    schema: { $schema: DRAFT_2020_12, type: 'object', properties: { user: { $ref: 'https://example.test/user' } } },
    resources: [],
  });
  assert.equal(remote.status, 'refused');
  assert.equal(remote.reason, 'referenceOutsideResources');

  const missing = provider.admit({
    schema: { $schema: DRAFT_2020_12, $ref: 'other.json#/$defs/user' },
    resources: [],
  });
  assert.equal(missing.reason, 'referenceOutsideResources');
});

test('a reference inside the explicit local resources resolves and validates', async () => {
  const { provider } = await buildProvider();
  const user = { $schema: DRAFT_2020_12, $id: 'https://example.test/user', type: 'object', properties: { email: { type: 'string' } }, required: ['email'] };
  const order = { $schema: DRAFT_2020_12, $id: 'https://example.test/order-ref', type: 'object', properties: { user: { $ref: 'https://example.test/user' } }, required: ['user'] };
  const verdict = provider.validate({ schema: order, resources: [user], instance: { user: { email: 'a@b.co' } } });
  assert.equal(verdict.status, 'validated');
  assert.equal(verdict.verdict, true);
  const rejected = provider.validate({ schema: order, resources: [user], instance: { user: {} } });
  assert.equal(rejected.verdict, false);
  assert.equal(rejected.errors[0].instancePath, '/user');
  assert.equal(rejected.errors[0].keyword, 'required');
});

test('a duplicated resource id refuses admission', async () => {
  const { provider } = await buildProvider();
  const resource = { $schema: DRAFT_2020_12, $id: 'https://example.test/dup', type: 'object' };
  const refused = provider.admit({ schema: { $schema: DRAFT_2020_12, type: 'object' }, resources: [resource, resource] });
  assert.equal(refused.status, 'refused');
  assert.equal(refused.reason, 'duplicateResourceId');
});

test('a sample records its bytes, digest and pointer resolution', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'baton-context-sample-'));
  try {
    const path = join(dir, 'sample.json');
    writeFileSync(path, '{"lines":[{"sku":"a"},{"sku":"b"}]}');
    const sample = readJsonSample({ path });
    assert.equal(sample.status, 'ok');
    assert.match(sample.sha256, /^[0-9a-f]{64}$/);
    assert.equal(sample.evidence.pointer, '');
    const resolved = resolveJsonPointer(sample.value, '/lines/1/sku');
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.value, 'b');
    assert.equal(resolveJsonPointer(sample.value, '/lines/2').reason, 'pointerOutOfRange');
    assert.equal(resolveJsonPointer(sample.value, 'lines').reason, 'pointerNotAbsolute');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
