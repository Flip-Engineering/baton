// Phase 93a.3a suite 5 (§93.23 item 5, impl-decisions rule 10): §93.10 purity acceptance/refusal
// and the §93.10A closed result-schema derivation — every per-op transformer (including
// homogeneous-only collect/finish envelope recursion with exact arity and heterogeneous-chain
// refusal), the pinned derived name/version rule, all-required objects except all-optional
// `project`, the checked-in `repository` item shape and non-`repository` branch refusal, `chunk`
// limited to `by="item"` (Digest key) with field-keyed chunking refused, bottom-up resolution,
// and caller `outputSchema` substitution refusal. Fixtures are built ONLY via the author-aid
// (`f.deriveContext`/`deriveContextSchemaDefinitions`), never hand-computed digests.

import assert from 'node:assert/strict';
import test from 'node:test';

import { ProgramIrError, createValueSchemaDefinition, normalizeProgramSource } from '../src/program-ir/index.mjs';
import { programFixture } from './fixtures/phase93a-program-fixtures.mjs';

const invalid = { code: 'program_invalid' };
const normalize = (source, authority) => normalizeProgramSource(source, { authority });

// Wraps a single context node behind a select so its published `value` port is exercised, using
// the author-aid's derived schemas + mapped policy exactly as f.deriveContext prepared them.
function normalizeContextOnly(f, built) {
  return normalize(f.source([
    built.node, f.nodes.select('main', [['a', 'c', 'value']]),
  ], { nodeKey: 'main' }, { schemas: built.schemas, policy: built.policy }), f.authority);
}

test('P93A3A-OP1: every pure per-op transformer accepts with real registry definitions built via the author aid', () => {
  const f = programFixture();
  const src = f.contextExpression();
  const expressions = {
    source: src,
    outline: { op: 'outline', input: src },
    index: { op: 'index', input: src, after: null },
    search: { op: 'search', input: src, query: 'x', mode: 'literal' },
    slice: { op: 'slice', input: src, selector: { kind: 'indices', values: [0] } },
    filter: { op: 'filter', input: src, predicate: { field: 'path', operator: 'exists' } },
    sort: { op: 'sort', input: src, keys: ['path'] },
    unique: { op: 'unique', input: src, keys: ['path'] },
    project: { op: 'project', input: src, fields: ['path', 'language'] },
    join: { op: 'join', left: src, right: src, on: { left: 'path', right: 'path' } },
    coverage: { op: 'coverage', input: src },
  };
  for (const [op, expression] of Object.entries(expressions)) {
    const built = f.deriveContext('c', expression);
    const result = normalizeContextOnly(f, built);
    const contextNode = result.program.nodes.find((node) => node.kind === 'context');
    assert.match(contextNode.outputSchema.name, /^baton\.derived\.[0-9a-f]{16}$/u, op);
    assert.equal(contextNode.outputSchema.digest, built.derived.at(-1).digest, op);
  }
});

test('P93A3A-CHUNK1: chunk admits only by="item" (Digest key); every field-keyed by is refused', () => {
  const f = programFixture();
  const src = f.contextExpression();
  const built = f.deriveContext('c', { op: 'chunk', input: src, by: 'item' });
  const result = normalizeContextOnly(f, built);
  const contextNode = result.program.nodes.find((node) => node.kind === 'context');
  const envelope = built.derived.at(-1);
  assert.equal(contextNode.outputSchema.digest, envelope.digest);
  const itemsArray = built.derived.find((d) => d.schemaId
    === envelope.definition.properties.find((p) => p.name === 'items').schema.schemaId);
  const chunkObject = built.derived.find((d) => d.schemaId === itemsArray.definition.items.schemaId);
  assert.deepEqual(chunkObject.definition.properties.map((p) => p.name), ['items', 'key']);
  for (const by of ['path', 'language', 'gitMode']) {
    assert.throws(() => {
      const badBuilt = f.deriveContext('c', { op: 'chunk', input: src, by });
      normalizeContextOnly(f, badBuilt);
    }, (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
      && /by="item"/u.test(error.message), by);
  }
});

test('P93A3A-BRANCH1: only source("repository") is admitted; any other branch name refuses '
  + 'naming the 93a.3a deferral', () => {
  const f = programFixture();
  for (const branch of ['workspace', 'notes', 'REPOSITORY']) {
    assert.throws(() => {
      const built = f.deriveContext('c', f.contextExpression(branch));
      normalizeContextOnly(f, built);
    }, (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
      && /93a\.3a/u.test(error.message) && new RegExp(branch, 'u').test(error.message), branch);
  }
});

test('P93A3A-COLLECT1: collect/finish are homogeneous-only with exact arity; heterogeneous '
  + 'chains refuse', () => {
  const f = programFixture();
  const src = f.contextExpression();
  // The inner envelope: what deriveContextResultSchema would publish for `src` alone. Every
  // collect input and every finish value/evidence entry must derive this SAME byte-identical
  // envelope (rule 3); it is also each op's own item schema when nested one level deeper.
  const innerEnvelope = f.deriveContext('c', src).derived.at(-1);

  const collectBuilt = f.deriveContext('c', { op: 'collect', inputs: [src, src, src] });
  const collectResult = normalizeContextOnly(f, collectBuilt);
  const collectEnvelope = collectBuilt.derived.at(-1);
  const collectItemsArray = collectBuilt.derived.find((d) => d.schemaId
    === collectEnvelope.definition.properties.find((p) => p.name === 'items').schema.schemaId);
  assert.equal(collectItemsArray.definition.minItems, 3);
  assert.equal(collectItemsArray.definition.maxItems, 3);
  assert.equal(collectItemsArray.definition.items.schemaId, innerEnvelope.schemaId);
  assert.equal(
    collectResult.program.nodes.find((node) => node.kind === 'context').outputSchema.digest,
    collectEnvelope.digest);

  const finishBuilt = f.deriveContext('c', { op: 'finish', value: src, evidence: [src, src] });
  const finishResult = normalizeContextOnly(f, finishBuilt);
  const finishEnvelope = finishBuilt.derived.at(-1);
  // finishEnvelope.items bound is exact 1 (finish always synthesizes exactly one row); the item
  // itself is the {value,evidence,grounding} object, all-required (finish is not `project`).
  const finishItemsArray = finishBuilt.derived.find((d) => d.schemaId
    === finishEnvelope.definition.properties.find((p) => p.name === 'items').schema.schemaId);
  assert.equal(finishItemsArray.definition.minItems, 1);
  assert.equal(finishItemsArray.definition.maxItems, 1);
  const finishItemObject = finishBuilt.derived.find((d) => d.schemaId === finishItemsArray.definition.items.schemaId);
  assert.deepEqual(finishItemObject.definition.properties.map((p) => p.name).sort(),
    ['evidence', 'grounding', 'value']);
  assert.deepEqual(finishItemObject.definition.properties.map((p) => p.required), [true, true, true]);
  const finishValueSchemaId = finishItemObject.definition.properties.find((p) => p.name === 'value').schema.schemaId;
  assert.equal(finishValueSchemaId, innerEnvelope.schemaId);
  const finishEvidenceArray = finishBuilt.derived.find((d) => d.schemaId
    === finishItemObject.definition.properties.find((p) => p.name === 'evidence').schema.schemaId);
  assert.equal(finishEvidenceArray.definition.minItems, 2);
  assert.equal(finishEvidenceArray.definition.maxItems, 2);
  assert.equal(finishEvidenceArray.definition.items.schemaId, innerEnvelope.schemaId);
  assert.equal(
    finishResult.program.nodes.find((node) => node.kind === 'context').outputSchema.digest,
    finishEnvelope.digest);

  assert.throws(() => {
    const built = f.deriveContext('c', {
      op: 'collect', inputs: [src, { op: 'outline', input: src }],
    });
    normalizeContextOnly(f, built);
  }, (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
    && /collect/u.test(error.message) && /byte-identical/u.test(error.message));
  assert.throws(() => {
    const built = f.deriveContext('c', {
      op: 'finish', value: src, evidence: [{ op: 'outline', input: src }],
    });
    normalizeContextOnly(f, built);
  }, (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
    && /finish/u.test(error.message) && /byte-identical/u.test(error.message));
});

test('P93A3A-REQ1: every derived object is all-required except project, which is all-optional', () => {
  const f = programFixture();
  const src = f.contextExpression();
  const outlineBuilt = f.deriveContext('c', { op: 'outline', input: src });
  const outlineObject = outlineBuilt.derived.find((d) => d.form === 'object'
    && d.definition.properties.some((p) => p.name === 'itemCount'));
  assert.deepEqual(outlineObject.definition.properties.map((p) => p.required), [true, true]);

  const projectBuilt = f.deriveContext('c', { op: 'project', input: src, fields: ['path', 'chunk'] });
  const projectObject = projectBuilt.derived.find((d) => d.form === 'object'
    && d.definition.properties.length === 2
    && d.definition.properties.every((p) => ['chunk', 'path'].includes(p.name)));
  assert.ok(projectObject, 'project object schema must be present in the derived list');
  assert.deepEqual(projectObject.definition.properties.map((p) => p.required), [false, false]);
});

test('P93A3A-PIN1: pinned derived name/version rules — missing, misnamed, and structurally '
  + 'renamed registrations all refuse', () => {
  const f = programFixture();
  const built = f.deriveContext('c', f.contextExpression());
  const envelope = built.derived.at(-1);
  const withoutEnvelope = [...f.registry.schemas, ...built.derived.slice(0, -1)];

  // Unsatisfiable chain (rule 10): the derived definition is simply absent from the registry.
  assert.throws(() => normalizeContextOnly(f, { ...built, schemas: withoutEnvelope }),
    (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
      && /requires a schema registered as/u.test(error.message));

  // Misnamed registered definition: something with WRONG structural bytes sits at the pinned name.
  const wrongBytes = createValueSchemaDefinition({
    schemaVersion: 1, kind: 'baton.value_schema', name: envelope.name, version: 1,
    form: 'object', definition: { type: 'object', properties: [], additionalProperties: false },
  }, f.authority);
  assert.throws(() => normalizeContextOnly(f, { ...built, schemas: [...withoutEnvelope, wrongBytes] }),
    (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
      && /non-matching structural bytes/u.test(error.message));

  // Renamed-but-structural-match: the byte-identical definition is registered under a foreign,
  // non-pinned name, so the pinned-name slot the derivation requires is still empty. Byte-
  // identical definitions under other names are ignored (§93.10A), never substituted in.
  const foreignNamed = createValueSchemaDefinition({
    schemaVersion: 1, kind: 'baton.value_schema', name: 'fixture.foreign_envelope_name', version: 1,
    form: envelope.form, definition: envelope.definition,
  }, f.authority);
  assert.throws(() => normalizeContextOnly(f, { ...built, schemas: [...withoutEnvelope, foreignNamed] }),
    (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
      && /requires a schema registered as/u.test(error.message));

  // A caller cannot substitute any schema for a source/collect context node: the source grammar
  // itself has no outputSchema field to supply (rule 10's "caller outputSchema substitution
  // refusal"), so attempting to declare one is an unknown-field error, not a weaker-schema accept.
  const withOutputSchema = { ...built.node, outputSchema: f.refs.string };
  assert.throws(() => normalize(f.source([
    withOutputSchema, f.nodes.select('main', [['a', 'c', 'value']]),
  ], { nodeKey: 'main' }, { schemas: built.schemas, policy: built.policy }), f.authority),
    (error) => error instanceof ProgramIrError && /field set/u.test(error.message));
});

test('P93A3A-ORDER1: bottom-up resolution is independent of registry insertion order, and '
  + 'programDigest is stable across author nodeKey renames', () => {
  const f = programFixture();
  const built = f.deriveContext('c', {
    op: 'chunk', by: 'item', input: { op: 'project', input: f.contextExpression(), fields: ['path'] },
  });
  const forward = normalizeContextOnly(f, built);
  const shuffled = { ...built, schemas: [...f.registry.schemas, ...[...built.derived].reverse()] };
  const reversed = normalizeContextOnly(f, shuffled);
  assert.equal(reversed.program.programDigest, forward.program.programDigest);

  const renamedNode = f.nodes.context('a-completely-different-label', built.program);
  const renamed = normalize(f.source([
    renamedNode, f.nodes.select('other-main', [['a', 'a-completely-different-label', 'value']]),
  ], { nodeKey: 'other-main' }, { schemas: built.schemas, policy: built.policy }), f.authority);
  assert.equal(renamed.program.programDigest, forward.program.programDigest);
});

test('P93A3A-PURITY1: every effect op refuses before derivation, nested or top-level, and so '
  + 'does an unknown op', () => {
  const f = programFixture();
  const src = f.contextExpression();
  for (const op of ['map', 'reduce', 'review', 'verify']) {
    const expression = op === 'verify'
      ? { op, input: src, gate: 'fixture.gate' }
      : { op, input: src, role: 'fixture.role', instruction: 'do it' };
    assert.throws(() => f.deriveContext('c', expression),
      (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
        && /pure/u.test(error.message), `top-level ${op}`);
    const nested = { op: 'project', input: expression, fields: ['path'] };
    assert.throws(() => f.deriveContext('c', nested),
      (error) => error instanceof ProgramIrError && error.code === 'program_invalid'
        && /pure/u.test(error.message), `nested ${op}`);
  }
  assert.throws(() => f.deriveContext('c', { op: 'teleport' }), invalid);
});
