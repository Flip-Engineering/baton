// Phase 93a.3a §93.10A context result-schema derivation (§93.9 context node + collect derivation,
// §93.10 purity, §93.10A per-op transformer table). This module is pure — no I/O, no Date, no
// randomness — and performs two closed normalization operations, never runtime inference:
//
//   deriveContextResultSchema  — normalizer-facing (§93.9 context canonical form). Given an
//     already-normalized, already-pure baton.context_program and the Program's own schema
//     registry, resolves the exact SchemaRef the node's port publishes. Every derived definition
//     (envelope and every derived child, bottom-up) MUST already be registered under its pinned
//     name; nothing is auto-registered here.
//   deriveContextSchemaDefinitions / deriveCollectSchemaDefinition — author-aid (rule 6). The
//     SAME derivation walk, but in "create" mode: it freshly registers (via
//     createValueSchemaDefinition) every definition the walk needs and returns the complete
//     frozen list an author must add to Program `schemas` before building nodes. Tests and
//     fixtures use ONLY these helpers — never hand-computed digests.
//
// §93.20 amended for 93a.3a: the embedded baton.context_program is normalized under a Context
// policy synthesized from the Program's own ProgramPolicy per the exact table in impl-decisions
// rule 1 (maxProgramBytes/maxProgramNodes/maxProgramDepth/maxValueBytes->maxArtifactBytes/
// maxJoinMembers->maxResultItems/maxJoinComparisons/maxChildDepth->recursionDepth); every other
// Context policy v1 field takes its v1 default. This module never reads a deployment Context
// policy directly — the proof that this mapping is the deployment's exact lower authority is 93E
// scope; 93a.3a performs only the arithmetic-free field copy.

import { createHash } from 'node:crypto';

import {
  canonicalValueBytes, canonicalValueText, compareProgramIdentityKeys,
} from './canonical-value.mjs';
import { createValueSchemaDefinition, valueSchemaRef } from './schema-values.mjs';
import { fail } from './control-nodes.mjs';
import {
  DEFAULT_CONTEXT_PROGRAM_POLICY, contextProgramPure, normalizeContextProgram,
  normalizeContextProgramPolicy,
} from '../context-program.mjs';

function pinnedName(definitionBody, authority) {
  const bytes = canonicalValueBytes(definitionBody, authority);
  return `baton.derived.${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`;
}

function sortedProperties(properties) {
  return [...properties].sort((left, right) => compareProgramIdentityKeys(left.name, right.name));
}

// §93.20's table binds Program.maxChildDepth one-to-one to Context Program policy v1's
// recursionDepth, which normalizeContextProgramPolicy pins to exactly 1 (a Context v1 constant,
// not a caller-selectable value). `recursionDepth` is threaded through as a parameter, not read
// from `policy`: Context v1 programs are depth-1 by construction, and the Program's own
// repeat/child depth bound (ProgramPolicy.maxChildDepth) is a different axis that context
// normalization never gates on (§93.10A).
function synthesizeContextPolicy(policy, recursionDepth) {
  return normalizeContextProgramPolicy({
    schemaVersion: 1,
    language: DEFAULT_CONTEXT_PROGRAM_POLICY.language,
    stateMode: DEFAULT_CONTEXT_PROGRAM_POLICY.stateMode,
    recursionDepth,
    maxManifestBranches: DEFAULT_CONTEXT_PROGRAM_POLICY.maxManifestBranches,
    maxProgramBytes: policy.maxProgramBytes,
    maxProgramNodes: policy.maxProgramNodes,
    maxProgramDepth: policy.maxProgramDepth,
    maxResultItems: policy.maxJoinMembers,
    maxJoinComparisons: policy.maxJoinComparisons,
    maxCellsPerSession: DEFAULT_CONTEXT_PROGRAM_POLICY.maxCellsPerSession,
    maxTextBytes: DEFAULT_CONTEXT_PROGRAM_POLICY.maxTextBytes,
    maxArtifactBytes: policy.maxValueBytes,
    maxEvidenceCoordinates: DEFAULT_CONTEXT_PROGRAM_POLICY.maxEvidenceCoordinates,
  });
}

export function mapProgramPolicyToContextPolicy(policy) {
  // recursionDepth stays the Context v1 constant 1 (Context v1 programs are depth-1 by
  // construction). ProgramPolicy.maxChildDepth is the Program's repeat/child depth bound and is
  // never rewritten or gated by context normalization (§93.10A).
  return synthesizeContextPolicy(policy, 1);
}

export function normalizeContextNodeProgram(program, { policy }) {
  let normalized;
  try {
    normalized = normalizeContextProgram(program, synthesizeContextPolicy(policy, 1));
  } catch (error) {
    if (error?.code === 'program_invalid') throw error;
    fail(`context node program is not a valid normalized baton.context_program v1 under the `
      + `Context policy mapped from ProgramPolicy per §93.20: ${error?.message ?? error}`);
  }
  if (!contextProgramPure(normalized.expression)) {
    fail('context node program must be pure under §93.10 (map/reduce/review/verify and unknown '
      + 'operations are forbidden)');
  }
  return normalized;
}

function leafDefinitions() {
  return {
    int: { type: 'integer', minimum: 0, maximum: null },
    schemaVersion: { type: 'integer', minimum: 1, maximum: 1 },
    kind: {
      type: 'string',
      minBytes: Buffer.byteLength('baton.context_value'),
      maxBytes: Buffer.byteLength('baton.context_value'),
      format: 'text',
      enum: ['baton.context_value'],
    },
    safeId: { type: 'string', minBytes: 1, maxBytes: 512, format: 'safe_id', enum: null },
    digest: { type: 'string', minBytes: 64, maxBytes: 64, format: 'digest', enum: null },
    gitSha: { type: 'string', minBytes: 40, maxBytes: 40, format: 'git_sha', enum: null },
    path: { type: 'string', minBytes: 1, maxBytes: 4096, format: 'text', enum: null },
    language: { type: 'string', minBytes: 0, maxBytes: 128, format: 'text', enum: null },
    gitMode: {
      type: 'string', minBytes: 6, maxBytes: 6, format: 'text', enum: ['100644', '100755'],
    },
    grounding: {
      type: 'string',
      minBytes: Buffer.byteLength('asserted'),
      maxBytes: Buffer.byteLength('asserted'),
      format: 'text',
      enum: ['asserted'],
    },
  };
}

const LEAF_FORMS = Object.freeze({
  int: 'integer', schemaVersion: 'integer', kind: 'string', safeId: 'string', digest: 'string',
  gitSha: 'string', path: 'string', language: 'string', gitMode: 'string', grounding: 'string',
});

function createResolver(mode) {
  const cache = new Map();
  const created = [];
  const { authority } = mode;
  function resolve(form, definitionBody) {
    const name = pinnedName(definitionBody, authority);
    const cached = cache.get(name);
    if (cached) return cached;
    let result;
    if (mode.kind === 'create') {
      const definition = createValueSchemaDefinition({
        schemaVersion: 1, kind: 'baton.value_schema', name, version: 1, form,
        definition: definitionBody,
      }, authority);
      result = { schema: valueSchemaRef(definition), definition };
      created.push(definition);
    } else {
      const match = mode.registry.schemas.find((entry) => entry.name === name && entry.version === 1);
      if (!match) {
        fail(`Context Program result-schema derivation requires a schema registered as ${name} `
          + '(bottom-up pinned-name resolution; author labels never reach Program identity)');
      }
      if (match.form !== form || canonicalValueText(match.definition, authority)
        !== canonicalValueText(definitionBody, authority)) {
        fail(`Context Program result-schema derivation found ${name} registered with `
          + 'non-matching structural bytes');
      }
      result = { schema: valueSchemaRef(match), definition: match };
    }
    cache.set(name, result);
    return result;
  }
  return { resolve, created };
}

function scalarRef(ctx, key) {
  return ctx.resolver.resolve(LEAF_FORMS[key], ctx.leaf[key]).schema;
}

function arrayOf(ctx, itemSchema, { minItems, maxItems, unique }) {
  return ctx.resolver.resolve('array', {
    type: 'array', items: itemSchema, minItems, maxItems, unique,
  });
}

function objectOf(ctx, properties) {
  return ctx.resolver.resolve('object', {
    type: 'object', properties: sortedProperties(properties), additionalProperties: false,
  });
}

function repositoryChunkItemSchema(ctx) {
  const textRef = ctx.resolver.resolve('string', {
    type: 'string', minBytes: 0, maxBytes: ctx.policy.maxValueBytes, format: 'text', enum: null,
  }).schema;
  return objectOf(ctx, [
    { name: 'path', schema: scalarRef(ctx, 'path'), required: true },
    { name: 'chunk', schema: scalarRef(ctx, 'int'), required: true },
    { name: 'gitMode', schema: scalarRef(ctx, 'gitMode'), required: true },
    { name: 'gitBlobOid', schema: scalarRef(ctx, 'gitSha'), required: true },
    { name: 'blobBytes', schema: scalarRef(ctx, 'int'), required: true },
    { name: 'byteStart', schema: scalarRef(ctx, 'int'), required: true },
    { name: 'byteEnd', schema: scalarRef(ctx, 'int'), required: true },
    { name: 'contentDigest', schema: scalarRef(ctx, 'digest'), required: true },
    { name: 'text', schema: textRef, required: true },
    { name: 'language', schema: scalarRef(ctx, 'language'), required: true },
  ]);
}

function assertHomogeneous(envelopes, label) {
  const [first] = envelopes;
  if (!first || envelopes.some((entry) => entry.definition !== first.definition)) {
    fail(`Context Program ${label} requires every input to derive the byte-identical envelope `
      + 'schema (heterogeneous chains are program_invalid in 93a.3a)');
  }
  return first;
}

// The per-element item schema ("I" in the §93.10A table): what each op's own produced `.items`
// array element looks like. Reused verbatim by consumers (index/chunk/project/join wrap it;
// search/slice/filter/sort/unique pass it through unchanged).
function deriveItem(expr, ctx) {
  switch (expr.op) {
    case 'source': {
      if (expr.branch !== 'repository') {
        fail(`Context Program source branch "${expr.branch}" is not admitted; only the reserved `
          + 'branch name "repository" is bound in 93a.3a (other branch kinds require a '
          + 'branch->schema binding no shipped authority provides until a later slice)');
      }
      return repositoryChunkItemSchema(ctx);
    }
    case 'outline': {
      deriveItem(expr.input, ctx);
      const fieldsArray = arrayOf(ctx, scalarRef(ctx, 'safeId'),
        { minItems: 0, maxItems: ctx.policy.maxJoinMembers, unique: true });
      return objectOf(ctx, [
        { name: 'itemCount', schema: scalarRef(ctx, 'int'), required: true },
        { name: 'fields', schema: fieldsArray.schema, required: true },
      ]);
    }
    case 'index': {
      const item = deriveItem(expr.input, ctx);
      return objectOf(ctx, [
        { name: 'index', schema: scalarRef(ctx, 'int'), required: true },
        { name: 'value', schema: item.schema, required: true },
      ]);
    }
    case 'search':
    case 'slice':
    case 'filter':
    case 'sort':
    case 'unique':
      return deriveItem(expr.input, ctx);
    case 'chunk': {
      if (expr.by !== 'item') {
        fail('Context Program chunk admits only by="item" (Digest key) in 93a.3a; field-keyed '
          + 'chunking is deferred to the canonical-text/nullable schema rung, since the evaluator '
          + 'emits a raw field value or null and §93.5 unions require object-variant '
          + 'discriminators, making a scalar-or-null key inexpressible today');
      }
      const item = deriveItem(expr.input, ctx);
      const itemsArray = arrayOf(ctx, item.schema,
        { minItems: 0, maxItems: ctx.policy.maxJoinMembers, unique: false });
      return objectOf(ctx, [
        { name: 'key', schema: scalarRef(ctx, 'digest'), required: true },
        { name: 'items', schema: itemsArray.schema, required: true },
      ]);
    }
    case 'project': {
      const item = deriveItem(expr.input, ctx);
      if (item.definition.form !== 'object') {
        fail('Context Program project requires an object item schema to intersect its fields '
          + 'against');
      }
      const selected = item.definition.definition.properties
        .filter((property) => expr.fields.includes(property.name))
        .map((property) => ({ name: property.name, schema: property.schema, required: false }));
      return objectOf(ctx, selected);
    }
    case 'join': {
      const left = deriveItem(expr.left, ctx);
      const right = deriveItem(expr.right, ctx);
      return objectOf(ctx, [
        { name: 'left', schema: left.schema, required: true },
        { name: 'right', schema: right.schema, required: true },
      ]);
    }
    case 'collect': {
      const envelopes = expr.inputs.map((input) => deriveEnvelope(input, ctx));
      return assertHomogeneous(envelopes, 'collect');
    }
    case 'coverage': {
      deriveItem(expr.input, ctx);
      const sourceBranchesArray = arrayOf(ctx, scalarRef(ctx, 'safeId'),
        { minItems: 0, maxItems: ctx.policy.maxJoinMembers, unique: true });
      return objectOf(ctx, [
        { name: 'selectedItems', schema: scalarRef(ctx, 'int'), required: true },
        { name: 'sourceBranches', schema: sourceBranchesArray.schema, required: true },
        { name: 'manifestBranches', schema: scalarRef(ctx, 'int'), required: true },
        { name: 'unreadBranches', schema: scalarRef(ctx, 'int'), required: true },
        { name: 'chunks', schema: scalarRef(ctx, 'int'), required: true },
        { name: 'sourceItems', schema: scalarRef(ctx, 'int'), required: true },
        { name: 'selectedSourceItems', schema: scalarRef(ctx, 'int'), required: true },
      ]);
    }
    case 'finish': {
      const valueEnvelope = deriveEnvelope(expr.value, ctx);
      const evidenceEnvelopes = expr.evidence.map((entry) => deriveEnvelope(entry, ctx));
      assertHomogeneous([valueEnvelope, ...evidenceEnvelopes], 'finish');
      const evidenceArray = arrayOf(ctx, valueEnvelope.schema, {
        minItems: expr.evidence.length, maxItems: expr.evidence.length, unique: false,
      });
      return objectOf(ctx, [
        { name: 'value', schema: valueEnvelope.schema, required: true },
        { name: 'evidence', schema: evidenceArray.schema, required: true },
        { name: 'grounding', schema: scalarRef(ctx, 'grounding'), required: true },
      ]);
    }
    default:
      fail(`Context Program ${String(expr.op)} has no checked-in §93.10A schema transformer`);
  }
}

// The envelope's own `items` array-field bound. Every op uses the generic policy.maxJoinMembers
// bound EXCEPT collect (exact input arity), and finish/outline/coverage (exactly one item) —
// each of which always produces exactly that many rows, never more or fewer (§93.10A table).
function envelopeItemsBound(expr, ctx) {
  if (expr.op === 'collect') {
    return { minItems: expr.inputs.length, maxItems: expr.inputs.length };
  }
  if (expr.op === 'finish' || expr.op === 'outline' || expr.op === 'coverage') {
    return { minItems: 1, maxItems: 1 };
  }
  return { minItems: 0, maxItems: ctx.policy.maxJoinMembers };
}

// ContextCellValue (§93.10A): the closed envelope every Context node/collect-input publishes,
// wrapping this expression's own per-element item schema as its `items` array.
function deriveEnvelope(expr, ctx) {
  const item = deriveItem(expr, ctx);
  const bound = envelopeItemsBound(expr, ctx);
  const itemsArray = arrayOf(ctx, item.schema, { ...bound, unique: false });
  const sourceBranchesArray = arrayOf(ctx, scalarRef(ctx, 'safeId'),
    { minItems: 0, maxItems: ctx.policy.maxJoinMembers, unique: true });
  return objectOf(ctx, [
    { name: 'schemaVersion', schema: scalarRef(ctx, 'schemaVersion'), required: true },
    { name: 'kind', schema: scalarRef(ctx, 'kind'), required: true },
    { name: 'items', schema: itemsArray.schema, required: true },
    { name: 'sourceBranches', schema: sourceBranchesArray.schema, required: true },
    { name: 'sourceItems', schema: scalarRef(ctx, 'int'), required: true },
    { name: 'selectedSourceItems', schema: scalarRef(ctx, 'int'), required: true },
    { name: 'chunks', schema: scalarRef(ctx, 'int'), required: true },
  ]);
}

// Normalizer-facing (lookup mode): `normalizedProgram` is already normalized and already proven
// pure by normalizeContextNodeProgram. Every definition the walk needs MUST already be present in
// `registry` under its pinned name; nothing is auto-registered.
export function deriveContextResultSchema(normalizedProgram, { authority, policy, registry }) {
  const resolver = createResolver({ kind: 'lookup', authority, registry });
  const ctx = { resolver, policy, leaf: leafDefinitions() };
  return deriveEnvelope(normalizedProgram.expression, ctx);
}

// Author-aid (rule 6, create mode): accepts a raw/unnormalized baton.context_program, normalizes
// and purity-checks it exactly as the normalizer will, then freshly registers (via
// createValueSchemaDefinition) every definition the walk needs, returning the complete frozen
// list — in bottom-up emission order — an author must add to Program `schemas`.
export function deriveContextSchemaDefinitions(program, { authority, policy }) {
  const normalized = normalizeContextNodeProgram(program, { policy });
  const resolver = createResolver({ kind: 'create', authority });
  const ctx = { resolver, policy, leaf: leafDefinitions() };
  deriveEnvelope(normalized.expression, ctx);
  return Object.freeze([...resolver.created]);
}

// §93.9 Program-level `collect` control node (not the Context-internal `collect` op above). Rule
// 7 back-port: the SAME pinned-name rule as §93.10A, so author labels never reach Program
// identity for `collect` either. `items` = [{name, schema: SchemaRef}], already resolved by the
// caller; `collect` requires every property present (no `project`-style optional exception).
export function deriveCollectSchemaDefinition(items, { authority }) {
  const resolver = createResolver({ kind: 'create', authority });
  const definition = objectOf({ resolver }, items.map(({ name, schema }) => (
    { name, schema, required: true })));
  return definition.definition;
}

export function resolveCollectResultSchema(items, { authority, registry }) {
  const resolver = createResolver({ kind: 'lookup', authority, registry });
  return objectOf({ resolver }, items.map(({ name, schema }) => ({ name, schema, required: true })));
}
