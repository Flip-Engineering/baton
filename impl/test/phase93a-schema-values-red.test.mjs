import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  VALUE_SCHEMA_FORMS, canonicalProgramBytes, canonicalValueBytes, createProgramValueAuthority,
  createSchemaRegistry, createTypedValue, createValueRef, createValueSchemaDefinition,
  validateTypedValue, validateValueRef, valueSchemaRef,
} from '../src/program-ir/index.mjs';

const authorityInput = {
  maxJoinMembers: 64, maxProgramBytes: 128 * 1024, maxProgramDepth: 32,
  maxProgramNodes: 256, maxSchemaDefinitions: 64, maxValueBytes: 32 * 1024,
};
const authority = createProgramValueAuthority(authorityInput);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const define = (name, form, definition, version = 1) => createValueSchemaDefinition({
  schemaVersion: 1, kind: 'baton.value_schema', name, version, form, definition,
}, authority);

function fixture() {
  const nothing = define('fixture.null', 'null', { type: 'null' });
  const flag = define('fixture.boolean', 'boolean', { type: 'boolean' });
  const integer = define('fixture.integer', 'integer', { type: 'integer', minimum: -2, maximum: 2 });
  const number = define('fixture.number', 'number', { type: 'number', minimum: -2.5, maximum: 2.5 });
  const text = define('fixture.text', 'string', {
    type: 'string', minBytes: 0, maxBytes: 32, format: 'text', enum: null,
  });
  const alphaTag = define('fixture.tag.alpha', 'string', {
    type: 'string', minBytes: 5, maxBytes: 5, format: 'text', enum: ['alpha'],
  });
  const betaTag = define('fixture.tag.beta', 'string', {
    type: 'string', minBytes: 4, maxBytes: 4, format: 'text', enum: ['beta'],
  });
  const alpha = define('fixture.alpha', 'object', {
    type: 'object', properties: [
      { name: 'n', schema: valueSchemaRef(integer), required: true },
      { name: 'kind', schema: valueSchemaRef(alphaTag), required: true },
    ], additionalProperties: false,
  });
  const beta = define('fixture.beta', 'object', {
    type: 'object', properties: [
      { name: 'text', schema: valueSchemaRef(text), required: true },
      { name: 'kind', schema: valueSchemaRef(betaTag), required: true },
    ], additionalProperties: false,
  });
  const integers = define('fixture.integers', 'array', {
    type: 'array', items: valueSchemaRef(integer), minItems: 0, maxItems: 8, unique: false,
  });
  const pair = define('fixture.pair', 'object', {
    type: 'object', properties: [
      { name: 'a', schema: valueSchemaRef(integer), required: true },
      { name: 'b', schema: valueSchemaRef(integer), required: true },
    ], additionalProperties: false,
  });
  const uniquePairs = define('fixture.unique_pairs', 'array', {
    type: 'array', items: valueSchemaRef(pair), minItems: 0, maxItems: 8, unique: true,
  });
  const union = define('fixture.union', 'union', {
    type: 'union', discriminator: 'kind', variants: [
      { tag: 'beta', schema: valueSchemaRef(beta) },
      { tag: 'alpha', schema: valueSchemaRef(alpha) },
    ],
  });
  const schemas = [nothing, flag, integer, number, text, alphaTag, betaTag, alpha, beta,
    integers, pair, uniquePairs, union];
  return { ...Object.fromEntries(schemas.map((schema) => [schema.name.split('.').at(-1), schema])),
    nothing, flag, integer, number, text, alphaTag, betaTag, alpha, beta, integers, pair,
    uniquePairs, union, registry: createSchemaRegistry(schemas, authority) };
}

test('P93A1-V0: §93.5 is locked to eight distinct forms (brief checklist said seven)', () => {
  assert.deepEqual(VALUE_SCHEMA_FORMS,
    ['null', 'boolean', 'integer', 'number', 'string', 'array', 'object', 'union']);
  const { registry, nothing, integer, number } = fixture();
  assert.notEqual(nothing.digest, integer.digest);
  assert.notEqual(integer.digest, number.digest);
  assert.equal(createTypedValue({ schema: valueSchemaRef(nothing), value: null }, registry, authority).value, null);
  assert.throws(() => createTypedValue({ schema: valueSchemaRef(integer), value: null }, registry, authority));
  assert.equal(createTypedValue({ schema: valueSchemaRef(number), value: 1 }, registry, authority).value, 1);
});

test('P93A1-V1: schema identities, registry order, name/version uniqueness, and closure are exact', () => {
  const { registry, integer } = fixture();
  assert.match(registry.schemaRegistryDigest, /^[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(registry), true);
  assert.deepEqual(registry.schemas.map(({ schemaId }) => schemaId),
    [...registry.schemas.map(({ schemaId }) => schemaId)].sort());
  for (const schema of registry.schemas) {
    assert.equal(schema.schemaId, `schema:${schema.digest}`);
    assert.match(schema.digest, /^[a-f0-9]{64}$/u);
  }
  const collision = define(integer.name, 'integer', { type: 'integer', minimum: 0, maximum: 2 });
  assert.throws(() => createSchemaRegistry([integer, collision], authority), /name\/version/u);
  assert.throws(() => createValueSchemaDefinition({
    schemaVersion: 1, kind: 'baton.value_schema', name: 'bad', version: 1, form: 'string',
    definition: { type: 'string', minBytes: 0, maxBytes: 2, format: 'text', enum: null, default: '' },
  }, authority), /field set/u);
  assert.throws(() => createProgramValueAuthority({ ...authorityInput, callerLimit: 1 }),
    { code: 'program_invalid' });
  assert.equal(Object.isFrozen(authority), true);
});

test('P93A1-V1b: schema and registry identities match independent fixed preimages', () => {
  const { integer, nothing } = fixture();
  const bodyBytes = '{"definition":{"maximum":2,"minimum":-2,"type":"integer"},'
    + '"form":"integer","kind":"baton.value_schema","name":"fixture.integer",'
    + '"schemaVersion":1,"version":1}';
  const bodyDigest = 'c06034ba952280d18f08bac8041ec38c802f06dfa9dc6c38b70dbb4e27489625';
  const { digest: _digest, schemaId: _schemaId, ...body } = integer;
  assert.equal(canonicalProgramBytes(body, authority).toString('utf8'), bodyBytes);
  assert.equal(sha(bodyBytes), bodyDigest);
  assert.equal(integer.digest, bodyDigest);
  assert.equal(integer.schemaId, `schema:${bodyDigest}`);

  const schemaBytes = '{"definition":{"maximum":2,"minimum":-2,"type":"integer"},'
    + `"digest":"${bodyDigest}","form":"integer","kind":"baton.value_schema",`
    + `"name":"fixture.integer","schemaId":"schema:${bodyDigest}",`
    + '"schemaVersion":1,"version":1}';
  const registryBytes = `[${schemaBytes}]`;
  const registryDigest = 'bc6529273f82c9a10fa9cb09d75f0fc1ae3d6baa2d362f80b0505d5900e0a971';
  const one = createSchemaRegistry([integer], authority);
  assert.equal(canonicalProgramBytes(one.schemas, authority).toString('utf8'), registryBytes);
  assert.equal(sha(registryBytes), registryDigest);
  assert.equal(one.schemaRegistryDigest, registryDigest);

  const forward = createSchemaRegistry([nothing, integer], authority);
  const reverse = createSchemaRegistry([integer, nothing], authority);
  assert.deepEqual(reverse, forward);
  assert.deepEqual(canonicalProgramBytes(reverse.schemas, authority),
    canonicalProgramBytes(forward.schemas, authority));
});

test('P93A1-V1c: every SchemaRef coordinate and its discriminator reject tampering', () => {
  const { registry, integer } = fixture();
  const ref = valueSchemaRef(integer);
  for (const changed of [
    { ...ref, kind: 'other_ref' },
    { ...ref, schemaId: `schema:${'0'.repeat(64)}` },
    { ...ref, name: 'fixture.other' },
    { ...ref, version: 2 },
    { ...ref, digest: '0'.repeat(64) },
  ]) {
    assert.throws(() => createTypedValue({ schema: changed, value: 1 }, registry, authority),
      { code: 'program_invalid' });
  }
});

function fakeArraySchema(character, targetCharacter) {
  const digest = character.repeat(64);
  const targetDigest = targetCharacter.repeat(64);
  return {
    schemaVersion: 1, kind: 'baton.value_schema', name: `cycle.${character}`, version: 1,
    form: 'array', definition: {
      type: 'array', items: {
        kind: 'schema_ref', schemaId: `schema:${targetDigest}`, name: `cycle.${targetCharacter}`,
        version: 1, digest: targetDigest,
      }, minItems: 0, maxItems: 1, unique: false,
    }, digest, schemaId: `schema:${digest}`,
  };
}

function fakeObjectSchema(character, targetCharacter) {
  const digest = character.repeat(64);
  const targetDigest = targetCharacter.repeat(64);
  return {
    schemaVersion: 1, kind: 'baton.value_schema', name: `cycle.${character}`, version: 1,
    form: 'object', definition: {
      type: 'object', properties: [{
        name: 'next', required: true, schema: {
          kind: 'schema_ref', schemaId: `schema:${targetDigest}`, name: `cycle.${targetCharacter}`,
          version: 1, digest: targetDigest,
        },
      }], additionalProperties: false,
    }, digest, schemaId: `schema:${digest}`,
  };
}

function fakeUnionSchema(character, targetCharacter) {
  const digest = character.repeat(64);
  const targetDigest = targetCharacter.repeat(64);
  return {
    schemaVersion: 1, kind: 'baton.value_schema', name: `cycle.${character}`, version: 1,
    form: 'union', definition: {
      type: 'union', discriminator: 'kind', variants: [{
        tag: 'next', schema: {
          kind: 'schema_ref', schemaId: `schema:${targetDigest}`, name: `cycle.${targetCharacter}`,
          version: 1, digest: targetDigest,
        },
      }],
    }, digest, schemaId: `schema:${digest}`,
  };
}

test('P93A1-V2: schema reference DAG refuses cycles of length one, two, and N', () => {
  for (const schemas of [
    [fakeArraySchema('a', 'a')],
    [fakeArraySchema('a', 'b'), fakeArraySchema('b', 'a')],
    [fakeArraySchema('a', 'b'), fakeArraySchema('b', 'c'), fakeArraySchema('c', 'd'), fakeArraySchema('d', 'a')],
    [fakeObjectSchema('e', 'e')],
    [fakeUnionSchema('f', 'f')],
  ]) assert.throws(() => createSchemaRegistry(schemas, authority), /cycle/u);
});

test('P93A1-V3: every form validates closed values without coercion and unions match exactly one', () => {
  const f = fixture();
  const valid = [
    [f.nothing, null], [f.flag, true], [f.integer, -2], [f.number, 2.5], [f.text, 'é'],
    [f.integers, [2, 1]], [f.alpha, { kind: 'alpha', n: 1 }],
    [f.union, { kind: 'beta', text: 'ok' }],
  ];
  for (const [schema, value] of valid) {
    const typed = createTypedValue({ schema: valueSchemaRef(schema), value }, f.registry, authority);
    assert.deepEqual(validateTypedValue(typed, f.registry, authority), typed);
  }
  for (const [schema, value] of [
    [f.nothing, false], [f.number, '1'], [f.number, 3], [f.text, 1], [f.text, 'x'.repeat(33)],
    [f.integers, 1], [f.integers, [0, 1, 2, 3, 4, 5, 6, 7, 8]], [f.integers, [0, '1']],
    [f.integer, '1'], [f.integer, 1.5], [f.integer, Number.MAX_SAFE_INTEGER + 1],
    [f.flag, 1], [f.alpha, { kind: 'alpha' }], [f.alpha, { kind: 'alpha', n: 1, extra: true }],
    [f.union, { kind: 'unknown', n: 1 }], [f.union, { kind: 'alpha', n: 1, text: 'overlap' }],
  ]) assert.throws(() => createTypedValue({ schema: valueSchemaRef(schema), value }, f.registry, authority));
});

test('P93A1-V3b: union registry contracts require one tagged object shape', () => {
  const f = fixture();
  const nonObjectUnion = define('invalid.union.non_object', 'union', {
    type: 'union', discriminator: 'kind', variants: [
      { tag: 'alpha', schema: valueSchemaRef(f.integer) },
    ],
  });
  assert.throws(() => createSchemaRegistry([f.integer, nonObjectUnion], authority), /object schemas/u);

  const optionalObject = define('invalid.union.optional_object', 'object', {
    type: 'object', properties: [
      { name: 'kind', schema: valueSchemaRef(f.alphaTag), required: false },
    ], additionalProperties: false,
  });
  const optionalUnion = define('invalid.union.optional', 'union', {
    type: 'union', discriminator: 'kind', variants: [
      { tag: 'alpha', schema: valueSchemaRef(optionalObject) },
    ],
  });
  assert.throws(() => createSchemaRegistry([f.alphaTag, optionalObject, optionalUnion], authority),
    /require its discriminator/u);

  const missingObject = define('invalid.union.missing_object', 'object', {
    type: 'object', properties: [
      { name: 'n', schema: valueSchemaRef(f.integer), required: true },
    ], additionalProperties: false,
  });
  const missingUnion = define('invalid.union.missing', 'union', {
    type: 'union', discriminator: 'kind', variants: [
      { tag: 'alpha', schema: valueSchemaRef(missingObject) },
    ],
  });
  assert.throws(() => createSchemaRegistry([f.integer, missingObject, missingUnion], authority),
    /require its discriminator/u);

  const multipleTags = define('invalid.union.multiple_tags', 'string', {
    type: 'string', minBytes: 4, maxBytes: 5, format: 'text', enum: ['alpha', 'beta'],
  });
  const multipleTagObject = define('invalid.union.multiple_tag_object', 'object', {
    type: 'object', properties: [
      { name: 'kind', schema: valueSchemaRef(multipleTags), required: true },
    ], additionalProperties: false,
  });
  const multipleTagUnion = define('invalid.union.multiple', 'union', {
    type: 'union', discriminator: 'kind', variants: [
      { tag: 'alpha', schema: valueSchemaRef(multipleTagObject) },
    ],
  });
  assert.throws(() => createSchemaRegistry([
    multipleTags, multipleTagObject, multipleTagUnion,
  ], authority), /enumerate exactly/u);
});

test('P93A1-V4: array uniqueness uses canonical bytes and never reorders semantic values', () => {
  const f = fixture();
  const ordered = createTypedValue({ schema: valueSchemaRef(f.integers), value: [2, 0, 1] }, f.registry, authority);
  assert.deepEqual(ordered.value, [2, 0, 1]);
  assert.throws(() => createTypedValue({
    schema: valueSchemaRef(f.uniquePairs), value: [{ b: 2, a: 1 }, { a: 1, b: 2 }],
  }, f.registry, authority), /unique/u);
});

function storedRef(f, bytes, valueDigest) {
  const artifactDigest = sha(bytes);
  return createValueRef({
    artifactId: `artifact:${artifactDigest}`, artifactDigest, schema: valueSchemaRef(f.integer),
    valueDigest, lineageDigest: 'f'.repeat(64),
  }, f.registry, authority);
}

test('P93A1-V5: ValueRef reads are pure, canonical-byte exact, duplicate-aware, and fail closed', () => {
  const f = fixture();
  const typed = createTypedValue({ schema: valueSchemaRef(f.integer), value: 1 }, f.registry, authority);
  const canonical = canonicalValueBytes(typed, authority);
  const reference = storedRef(f, canonical, typed.valueDigest);
  let reads = 0;
  const reader = { readArtifact(locator) {
    reads += 1;
    assert.deepEqual(locator, { artifactId: reference.artifactId, artifactDigest: reference.artifactDigest });
    return canonical;
  } };
  assert.deepEqual(validateValueRef(reference, { registry: f.registry, authority, artifactReader: reader }), reference);
  assert.equal(reads, 1);
  assert.equal(typeof reader.writeArtifact, 'undefined');

  const spaced = Buffer.from(` ${canonical.toString('utf8')}`);
  assert.throws(() => validateValueRef(storedRef(f, spaced, typed.valueDigest), {
    registry: f.registry, authority, artifactReader: { readArtifact: () => spaced },
  }), { code: 'artifact_unavailable' });

  const schema = JSON.stringify(typed.schema);
  const duplicate = Buffer.from(`{"schema":${schema},"value":1,"value":2,"valueDigest":"${typed.valueDigest}"}`);
  assert.throws(() => validateValueRef(storedRef(f, duplicate, typed.valueDigest), {
    registry: f.registry, authority, artifactReader: { readArtifact: () => duplicate },
  }), { code: 'artifact_unavailable' });

  assert.throws(() => validateValueRef(reference, {
    registry: f.registry, authority, artifactReader: { readArtifact: () => null },
  }), { code: 'artifact_unavailable' });
  assert.throws(() => validateValueRef(reference, {
    registry: f.registry, authority, artifactReader: { readArtifact: () => Buffer.from(canonical.toString().replace(':1,', ':2,')) },
  }), { code: 'artifact_unavailable' });
  assert.throws(() => validateValueRef({ ...reference, valueId: `pvalue:${'0'.repeat(64)}` }, {
    registry: f.registry, authority, artifactReader: reader,
  }), { code: 'program_invalid' });
  assert.equal(reads, 1);

  let proxyTraps = 0;
  const trip = () => { proxyTraps += 1; throw new Error('artifact Proxy trap must not run'); };
  const proxiedBytes = new Proxy(Buffer.from(canonical), {
    get: trip, getOwnPropertyDescriptor: trip, getPrototypeOf: trip, has: trip, ownKeys: trip,
  });
  assert.throws(() => validateValueRef(reference, {
    registry: f.registry, authority, artifactReader: { readArtifact: () => proxiedBytes },
  }), { code: 'artifact_unavailable' });
  assert.equal(proxyTraps, 0);

  for (const lossyString of [canonical.toString('utf8'), `${canonical.toString('utf8')}\ud800`]) {
    assert.throws(() => validateValueRef(reference, {
      registry: f.registry, authority, artifactReader: { readArtifact: () => lossyString },
    }), { code: 'artifact_unavailable' });
  }

  let thenReads = 0;
  const accessorResult = {};
  Object.defineProperty(accessorResult, 'then', { get() { thenReads += 1; return () => {}; } });
  assert.throws(() => validateValueRef(reference, {
    registry: f.registry, authority, artifactReader: { readArtifact: () => accessorResult },
  }), { code: 'artifact_unavailable' });
  assert.equal(thenReads, 0);
});
