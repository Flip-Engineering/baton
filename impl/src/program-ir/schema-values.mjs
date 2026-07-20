import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

import {
  ProgramIrError, canonicalProgramDigest, canonicalValueBytes, canonicalValueDigest,
  canonicalValueText, compareProgramIdentityKeys, deepFreezeProgramValue,
  isProgramValueAuthority, normalizeCanonicalProgramValue, normalizeCanonicalValue,
  normalizeProgramString, parseRawProgramJson,
} from './canonical-value.mjs';

const DIGEST = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9._:@/-]{1,512}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const SCHEMA_FORMS = Object.freeze([
  'null', 'boolean', 'integer', 'number', 'string', 'array', 'object', 'union',
]);
const registries = new WeakMap();
const schemaDefinitions = new WeakSet();

export const VALUE_SCHEMA_FORMS = SCHEMA_FORMS;

function fail(message, code = 'program_invalid') {
  throw new ProgramIrError(message, code);
}

function authority(value) {
  if (!isProgramValueAuthority(value)) fail('Schema validation requires deployment authority', 'program_policy_invalid');
  return value;
}

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const keys = Object.keys(value);
  if (keys.length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) {
    fail(`${label} has an invalid field set`);
  }
}

function safeId(value, label) {
  const normalized = normalizeProgramString(value, label);
  if (!SAFE_ID.test(normalized)) fail(`${label} is not a SafeId`);
  return normalized;
}

function digest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail(`${label} is not a Digest`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive safe integer`);
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer`);
  return value;
}

function nullableSafeInteger(value, label) {
  if (value !== null && !Number.isSafeInteger(value)) fail(`${label} must be null or a safe integer`);
  return value;
}

function nullableFinite(value, label) {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
    fail(`${label} must be null or finite`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function schemaRef(value, label = 'SchemaRef') {
  exact(value, ['kind', 'schemaId', 'name', 'version', 'digest'], label);
  if (value.kind !== 'schema_ref') fail(`${label}.kind is invalid`);
  const normalizedDigest = digest(value.digest, `${label}.digest`);
  if (value.schemaId !== `schema:${normalizedDigest}`) fail(`${label}.schemaId is invalid`);
  return {
    kind: 'schema_ref', schemaId: value.schemaId, name: safeId(value.name, `${label}.name`),
    version: positiveInteger(value.version, `${label}.version`), digest: normalizedDigest,
  };
}

function compareScalarBytes(left, right, deployed) {
  return Buffer.compare(canonicalValueBytes(left, deployed), canonicalValueBytes(right, deployed));
}

function normalizeDefinitionBody(value, deployed) {
  exact(value, ['schemaVersion', 'kind', 'name', 'version', 'form', 'definition'], 'Value schema source');
  if (value.schemaVersion !== 1 || value.kind !== 'baton.value_schema') fail('Value schema header is invalid');
  const name = safeId(value.name, 'Value schema name');
  const version = positiveInteger(value.version, 'Value schema version');
  if (!SCHEMA_FORMS.includes(value.form)) fail('Value schema form is invalid');
  const form = value.form;
  const input = value.definition;
  let definition;
  if (form === 'null' || form === 'boolean') {
    exact(input, ['type'], `${form} schema definition`);
    if (input.type !== form) fail(`${form} schema type is invalid`);
    definition = { type: form };
  } else if (form === 'integer') {
    exact(input, ['type', 'minimum', 'maximum'], 'integer schema definition');
    if (input.type !== form) fail('integer schema type is invalid');
    const minimum = nullableSafeInteger(input.minimum, 'integer schema minimum');
    const maximum = nullableSafeInteger(input.maximum, 'integer schema maximum');
    if (minimum !== null && maximum !== null && minimum > maximum) fail('integer schema bounds are inverted');
    definition = { type: form, minimum, maximum };
  } else if (form === 'number') {
    exact(input, ['type', 'minimum', 'maximum'], 'number schema definition');
    if (input.type !== form) fail('number schema type is invalid');
    const minimum = nullableFinite(input.minimum, 'number schema minimum');
    const maximum = nullableFinite(input.maximum, 'number schema maximum');
    if (minimum !== null && maximum !== null && minimum > maximum) fail('number schema bounds are inverted');
    definition = { type: form, minimum, maximum };
  } else if (form === 'string') {
    exact(input, ['type', 'minBytes', 'maxBytes', 'format', 'enum'], 'string schema definition');
    if (input.type !== form || !['text', 'safe_id', 'digest', 'git_sha'].includes(input.format)) {
      fail('string schema type or format is invalid');
    }
    const minBytes = nonnegativeInteger(input.minBytes, 'string schema minBytes');
    const maxBytes = nonnegativeInteger(input.maxBytes, 'string schema maxBytes');
    if (maxBytes < minBytes || maxBytes > deployed.maxValueBytes) fail('string schema byte bounds are invalid');
    let enumValues = null;
    if (input.enum !== null) {
      if (!Array.isArray(input.enum) || input.enum.length > deployed.maxSchemaDefinitions) {
        fail('string schema enum is invalid');
      }
      enumValues = input.enum.map((entry) => normalizeProgramString(entry, 'string schema enum value'));
      const canonical = new Set(enumValues.map((entry) => canonicalValueText(entry, deployed)));
      if (canonical.size !== enumValues.length) fail('string schema enum contains duplicates');
      enumValues.sort((left, right) => compareScalarBytes(left, right, deployed));
    }
    definition = { type: form, minBytes, maxBytes, format: input.format, enum: enumValues };
  } else if (form === 'array') {
    exact(input, ['type', 'items', 'minItems', 'maxItems', 'unique'], 'array schema definition');
    if (input.type !== form || typeof input.unique !== 'boolean') fail('array schema type or uniqueness is invalid');
    const minItems = nonnegativeInteger(input.minItems, 'array schema minItems');
    const maxItems = nonnegativeInteger(input.maxItems, 'array schema maxItems');
    if (maxItems < minItems || maxItems > deployed.maxJoinMembers) fail('array schema bounds are invalid');
    definition = { type: form, items: schemaRef(input.items), minItems, maxItems, unique: input.unique };
  } else if (form === 'object') {
    exact(input, ['type', 'properties', 'additionalProperties'], 'object schema definition');
    if (input.type !== form || input.additionalProperties !== false || !Array.isArray(input.properties)
      || input.properties.length > deployed.maxSchemaDefinitions) fail('object schema definition is invalid');
    const properties = input.properties.map((property) => {
      exact(property, ['name', 'schema', 'required'], 'object schema property');
      if (typeof property.required !== 'boolean') fail('object schema property.required is invalid');
      return { name: safeId(property.name, 'object schema property name'), schema: schemaRef(property.schema), required: property.required };
    });
    properties.sort((left, right) => compareProgramIdentityKeys(left.name, right.name));
    if (new Set(properties.map(({ name: propertyName }) => propertyName)).size !== properties.length) {
      fail('object schema property names collide after normalization');
    }
    definition = { type: form, properties, additionalProperties: false };
  } else {
    exact(input, ['type', 'discriminator', 'variants'], 'union schema definition');
    if (input.type !== form || !Array.isArray(input.variants) || input.variants.length === 0
      || input.variants.length > deployed.maxSchemaDefinitions) fail('union schema definition is invalid');
    const discriminator = safeId(input.discriminator, 'union schema discriminator');
    const variants = input.variants.map((variant) => {
      exact(variant, ['tag', 'schema'], 'union schema variant');
      const tag = normalizeProgramString(variant.tag, 'union schema variant tag');
      if (tag.length === 0 || Buffer.byteLength(tag, 'utf8') > deployed.maxValueBytes) {
        fail('union schema variant tag is invalid');
      }
      return { tag, schema: schemaRef(variant.schema) };
    });
    variants.sort((left, right) => compareProgramIdentityKeys(left.tag, right.tag));
    if (new Set(variants.map(({ tag }) => tag)).size !== variants.length) fail('union schema variant tags collide');
    definition = { type: form, discriminator, variants };
  }
  return { schemaVersion: 1, kind: 'baton.value_schema', name, version, form, definition };
}

export function createValueSchemaDefinition(source, valueAuthority) {
  const deployed = authority(valueAuthority);
  const normalized = normalizeCanonicalProgramValue(source, deployed);
  const body = normalizeDefinitionBody(normalized, deployed);
  const identityDigest = canonicalProgramDigest(body, deployed);
  const definition = deepFreezeProgramValue({ ...body, digest: identityDigest, schemaId: `schema:${identityDigest}` });
  schemaDefinitions.add(definition);
  return definition;
}

function normalizeDefinition(value, deployed) {
  const normalized = normalizeCanonicalProgramValue(value, deployed);
  exact(normalized, ['schemaVersion', 'kind', 'name', 'version', 'form', 'definition', 'digest', 'schemaId'], 'Value schema');
  const { digest: suppliedDigest, schemaId: suppliedId, ...source } = normalized;
  const result = createValueSchemaDefinition(source, deployed);
  if (suppliedDigest !== result.digest || suppliedId !== result.schemaId) fail('Value schema identity is invalid');
  return result;
}

export function valueSchemaRef(definition) {
  if (!definition || typeof definition !== 'object' || !schemaDefinitions.has(definition)) {
    fail('SchemaRef construction requires a validated schema definition');
  }
  exact(definition, ['schemaVersion', 'kind', 'name', 'version', 'form', 'definition', 'digest', 'schemaId'], 'Value schema');
  return deepFreezeProgramValue({
    kind: 'schema_ref', schemaId: definition.schemaId, name: definition.name,
    version: definition.version, digest: definition.digest,
  });
}

function referencedSchemaIds(definition) {
  if (definition.form === 'array') return [definition.definition.items.schemaId];
  if (definition.form === 'object') return definition.definition.properties.map(({ schema }) => schema.schemaId);
  if (definition.form === 'union') return definition.definition.variants.map(({ schema }) => schema.schemaId);
  return [];
}

function refsInDefinition(definition) {
  if (definition.form === 'array') return [definition.definition.items];
  if (definition.form === 'object') return definition.definition.properties.map(({ schema }) => schema);
  if (definition.form === 'union') return definition.definition.variants.map(({ schema }) => schema);
  return [];
}

function assertSameRef(ref, definition) {
  if (ref.schemaId !== definition.schemaId || ref.name !== definition.name
    || ref.version !== definition.version || ref.digest !== definition.digest) {
    fail('SchemaRef does not exactly match its registry definition');
  }
}

function assertAcyclic(definitions, byId) {
  const states = new Map();
  const visit = (schemaId) => {
    const state = states.get(schemaId);
    if (state === 'visiting') fail('Schema reference graph contains a cycle');
    if (state === 'done') return;
    states.set(schemaId, 'visiting');
    for (const childId of referencedSchemaIds(byId.get(schemaId))) visit(childId);
    states.set(schemaId, 'done');
  };
  for (const definition of definitions) visit(definition.schemaId);
}

// Cycles are refused before identity checks. Valid content-addressed cycles are computationally
// infeasible to construct, but rejection must not accidentally depend on that fact.
function preflightReferenceCycles(input, deployed) {
  const values = normalizeCanonicalProgramValue(input, deployed);
  const edges = new Map();
  for (const value of values) {
    if (!value || typeof value !== 'object' || typeof value.schemaId !== 'string') continue;
    const refs = [];
    if (value.form === 'array' && typeof value.definition?.items?.schemaId === 'string') {
      refs.push(value.definition.items.schemaId);
    } else if (value.form === 'object' && Array.isArray(value.definition?.properties)) {
      for (const property of value.definition.properties) {
        if (typeof property?.schema?.schemaId === 'string') refs.push(property.schema.schemaId);
      }
    } else if (value.form === 'union' && Array.isArray(value.definition?.variants)) {
      for (const variant of value.definition.variants) {
        if (typeof variant?.schema?.schemaId === 'string') refs.push(variant.schema.schemaId);
      }
    }
    edges.set(value.schemaId, refs);
  }
  const states = new Map();
  const visit = (schemaId) => {
    if (!edges.has(schemaId)) return;
    if (states.get(schemaId) === 'visiting') fail('Schema reference graph contains a cycle');
    if (states.get(schemaId) === 'done') return;
    states.set(schemaId, 'visiting');
    for (const child of edges.get(schemaId)) visit(child);
    states.set(schemaId, 'done');
  };
  for (const schemaId of edges.keys()) visit(schemaId);
}

function assertUnionContracts(definitions, byId) {
  for (const definition of definitions.filter(({ form }) => form === 'union')) {
    for (const variant of definition.definition.variants) {
      const target = byId.get(variant.schema.schemaId);
      if (target.form !== 'object') fail('Union variants must reference object schemas');
      const discriminator = target.definition.properties.find(({ name }) => name === definition.definition.discriminator);
      if (!discriminator?.required) fail('Union variant object must require its discriminator');
      const discriminatorSchema = byId.get(discriminator.schema.schemaId);
      if (discriminatorSchema.form !== 'string'
        || discriminatorSchema.definition.enum?.length !== 1
        || discriminatorSchema.definition.enum[0] !== variant.tag) {
        fail('Union discriminator schema must enumerate exactly its variant tag');
      }
    }
  }
}

export function createSchemaRegistry(input, valueAuthority) {
  const deployed = authority(valueAuthority);
  if (utilTypes.isProxy(input)) fail('Schema registry cannot be a Proxy');
  if (!Array.isArray(input) || input.length > deployed.maxSchemaDefinitions) fail('Schema registry is invalid');
  preflightReferenceCycles(input, deployed);
  const definitions = input.map((definition) => normalizeDefinition(definition, deployed));
  definitions.sort((left, right) => compareProgramIdentityKeys(left.schemaId, right.schemaId));
  const byId = new Map();
  const byNameVersion = new Map();
  for (const definition of definitions) {
    if (byId.has(definition.schemaId)) fail('Schema registry contains a duplicate definition');
    const coordinate = `${definition.name}\u0000${definition.version}`;
    if (byNameVersion.has(coordinate)) fail('Schema registry contains a colliding name/version');
    byId.set(definition.schemaId, definition);
    byNameVersion.set(coordinate, definition);
  }
  for (const definition of definitions) {
    for (const ref of refsInDefinition(definition)) {
      const target = byId.get(ref.schemaId);
      if (!target) fail('SchemaRef is not registered');
      assertSameRef(ref, target);
    }
  }
  assertAcyclic(definitions, byId);
  assertUnionContracts(definitions, byId);
  const schemas = deepFreezeProgramValue([...definitions]);
  const schemaRegistryDigest = canonicalProgramDigest(schemas, deployed);
  const registry = deepFreezeProgramValue({ schemas, schemaRegistryDigest });
  registries.set(registry, { byId, authority: deployed });
  return registry;
}

export const normalizeSchemaRegistry = createSchemaRegistry;

function registryState(registry, deployed) {
  const state = registries.get(registry);
  if (!state || state.authority !== deployed) fail('Schema registry does not belong to the injected authority');
  return state;
}

export function resolveSchemaRef(ref, registry, valueAuthority) {
  const deployed = authority(valueAuthority);
  const state = registryState(registry, deployed);
  const normalized = schemaRef(normalizeCanonicalValue(ref, deployed));
  const definition = state.byId.get(normalized.schemaId);
  if (!definition) fail('SchemaRef is not registered');
  assertSameRef(normalized, definition);
  return definition;
}

function validateString(value, definition) {
  if (typeof value !== 'string') fail('TypedValue string has the wrong type');
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes < definition.minBytes || bytes > definition.maxBytes) fail('TypedValue string violates byte bounds');
  if (definition.format === 'safe_id' && !SAFE_ID.test(value)) fail('TypedValue string is not a SafeId');
  if (definition.format === 'digest' && !DIGEST.test(value)) fail('TypedValue string is not a Digest');
  if (definition.format === 'git_sha' && !GIT_SHA.test(value)) fail('TypedValue string is not a GitSha');
  if (definition.enum !== null && !definition.enum.includes(value)) fail('TypedValue string is outside its enum');
}

function validateAgainst(value, definition, state, deployed) {
  const form = definition.form;
  const details = definition.definition;
  if (form === 'null') {
    if (value !== null) fail('TypedValue must be null');
  } else if (form === 'boolean') {
    if (typeof value !== 'boolean') fail('TypedValue must be boolean');
  } else if (form === 'integer') {
    if (!Number.isSafeInteger(value)) fail('TypedValue must be a safe integer');
    if ((details.minimum !== null && value < details.minimum) || (details.maximum !== null && value > details.maximum)) {
      fail('TypedValue integer violates bounds');
    }
  } else if (form === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('TypedValue must be a number');
    if ((details.minimum !== null && value < details.minimum) || (details.maximum !== null && value > details.maximum)) {
      fail('TypedValue number violates bounds');
    }
  } else if (form === 'string') validateString(value, details);
  else if (form === 'array') {
    if (!Array.isArray(value) || value.length < details.minItems || value.length > details.maxItems) {
      fail('TypedValue array violates bounds');
    }
    const itemSchema = state.byId.get(details.items.schemaId);
    for (const item of value) validateAgainst(item, itemSchema, state, deployed);
    if (details.unique) {
      const identities = value.map((item) => canonicalValueText(item, deployed));
      if (new Set(identities).size !== identities.length) fail('TypedValue array items are not unique');
    }
  } else if (form === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('TypedValue must be an object');
    const allowed = new Map(details.properties.map((property) => [property.name, property]));
    if (Object.keys(value).some((key) => !allowed.has(key))) fail('TypedValue object has an additional property');
    for (const property of details.properties) {
      if (property.required && !Object.hasOwn(value, property.name)) fail('TypedValue object is missing a required property');
      if (Object.hasOwn(value, property.name)) {
        validateAgainst(value[property.name], state.byId.get(property.schema.schemaId), state, deployed);
      }
    }
  } else {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('TypedValue union must be an object');
    const tag = value[details.discriminator];
    if (typeof tag !== 'string') fail('TypedValue union discriminator is invalid');
    let matches = 0;
    let selected = null;
    for (const variant of details.variants) {
      try {
        validateAgainst(value, state.byId.get(variant.schema.schemaId), state, deployed);
        matches += 1;
        if (variant.tag === tag) selected = variant;
      } catch (error) {
        if (!(error instanceof ProgramIrError)) throw error;
      }
    }
    if (matches !== 1 || !selected) fail('TypedValue union must match exactly one selected variant');
  }
}

function normalizeTypedParts(schema, value, registry, deployed) {
  const state = registryState(registry, deployed);
  const normalizedSchema = schemaRef(normalizeCanonicalValue(schema, deployed));
  const definition = state.byId.get(normalizedSchema.schemaId);
  if (!definition) fail('TypedValue schema is not registered');
  assertSameRef(normalizedSchema, definition);
  const normalizedValue = normalizeCanonicalValue(value, deployed);
  validateAgainst(normalizedValue, definition, state, deployed);
  return { schema: normalizedSchema, value: normalizedValue, valueDigest: canonicalValueDigest(normalizedValue, deployed) };
}

export function createTypedValue(input, registry, valueAuthority) {
  const deployed = authority(valueAuthority);
  const normalized = normalizeCanonicalValue(input, deployed);
  exact(normalized, ['schema', 'value'], 'TypedValue source');
  return deepFreezeProgramValue(normalizeTypedParts(normalized.schema, normalized.value, registry, deployed));
}

export function validateTypedValue(input, registry, valueAuthority) {
  const deployed = authority(valueAuthority);
  const normalized = normalizeCanonicalValue(input, deployed);
  exact(normalized, ['schema', 'value', 'valueDigest'], 'TypedValue');
  const result = normalizeTypedParts(normalized.schema, normalized.value, registry, deployed);
  if (normalized.valueDigest !== result.valueDigest || !DIGEST.test(normalized.valueDigest ?? '')) {
    fail('TypedValue valueDigest is invalid');
  }
  return deepFreezeProgramValue(result);
}

function normalizeValueRef(input, registry, deployed) {
  const normalized = normalizeCanonicalValue(input, deployed);
  exact(normalized, ['kind', 'valueId', 'artifactId', 'artifactDigest', 'schema', 'valueDigest', 'lineageDigest'], 'ValueRef');
  if (normalized.kind !== 'value_ref') fail('ValueRef kind is invalid');
  const artifactDigest = digest(normalized.artifactDigest, 'ValueRef artifactDigest');
  const valueDigest = digest(normalized.valueDigest, 'ValueRef valueDigest');
  const lineageDigest = digest(normalized.lineageDigest, 'ValueRef lineageDigest');
  if (normalized.artifactId !== `artifact:${artifactDigest}`) fail('ValueRef artifactId is invalid');
  resolveSchemaRef(normalized.schema, registry, deployed);
  const body = { artifactDigest, schema: normalized.schema, valueDigest, lineageDigest };
  const expectedId = `pvalue:${canonicalValueDigest(body, deployed)}`;
  if (normalized.valueId !== expectedId) fail('ValueRef valueId is invalid');
  return {
    kind: 'value_ref', valueId: expectedId, artifactId: normalized.artifactId, artifactDigest,
    schema: normalized.schema, valueDigest, lineageDigest,
  };
}

export function createValueRef(input, registry, valueAuthority) {
  const deployed = authority(valueAuthority);
  const normalized = normalizeCanonicalValue(input, deployed);
  exact(normalized, ['artifactId', 'artifactDigest', 'schema', 'valueDigest', 'lineageDigest'], 'ValueRef source');
  const artifactDigest = digest(normalized.artifactDigest, 'ValueRef artifactDigest');
  const valueDigest = digest(normalized.valueDigest, 'ValueRef valueDigest');
  const lineageDigest = digest(normalized.lineageDigest, 'ValueRef lineageDigest');
  if (normalized.artifactId !== `artifact:${artifactDigest}`) fail('ValueRef artifactId is invalid');
  const normalizedSchema = valueSchemaRef(resolveSchemaRef(normalized.schema, registry, deployed));
  const body = { artifactDigest, schema: normalizedSchema, valueDigest, lineageDigest };
  return deepFreezeProgramValue({
    kind: 'value_ref', valueId: `pvalue:${canonicalValueDigest(body, deployed)}`,
    artifactId: normalized.artifactId, artifactDigest, schema: normalizedSchema, valueDigest, lineageDigest,
  });
}

function artifactBytes(reader, reference) {
  if (!reader || typeof reader !== 'object' || typeof reader.readArtifact !== 'function') {
    fail('ValueRef validation requires an injected read-only artifact reader');
  }
  let result;
  try {
    result = reader.readArtifact(Object.freeze({
      artifactId: reference.artifactId, artifactDigest: reference.artifactDigest,
    }));
  } catch {
    fail('ValueRef artifact is unavailable', 'artifact_unavailable');
  }
  if (utilTypes.isProxy(result)) {
    fail('ValueRef artifact is unavailable', 'artifact_unavailable');
  }
  if (result && typeof result.then === 'function') {
    fail('ValueRef artifact reader must be synchronous and read-only');
  }
  if (result === null || result === undefined
    || !(Buffer.isBuffer(result) || result instanceof Uint8Array)) {
    fail('ValueRef artifact is unavailable', 'artifact_unavailable');
  }
  return Buffer.from(result);
}

export function validateValueRef(input, { registry, authority: valueAuthority, artifactReader }) {
  const deployed = authority(valueAuthority);
  const reference = deepFreezeProgramValue(normalizeValueRef(input, registry, deployed));
  const bytes = artifactBytes(artifactReader, reference);
  if (createHash('sha256').update(bytes).digest('hex') !== reference.artifactDigest) {
    fail('ValueRef artifact bytes changed', 'artifact_unavailable');
  }
  let parsed;
  try {
    parsed = parseRawProgramJson(bytes, deployed);
    const canonical = canonicalValueBytes(parsed, deployed);
    if (!canonical.equals(bytes)) fail('ValueRef artifact bytes are not canonical');
    const typed = validateTypedValue(parsed, registry, deployed);
    if (typed.valueDigest !== reference.valueDigest
      || canonicalValueText(typed.schema, deployed) !== canonicalValueText(reference.schema, deployed)) {
      fail('ValueRef artifact typed identity changed');
    }
  } catch (error) {
    if (error?.code === 'artifact_unavailable') throw error;
    fail('ValueRef artifact is unavailable or corrupt', 'artifact_unavailable');
  }
  return reference;
}
