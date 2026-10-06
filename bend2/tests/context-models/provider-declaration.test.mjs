// Provider declaration and invocation-mapping discriminators.
//
// These cases exercise the catalog provider's own declaration values and its
// single decision boundary for one invocation frame. Everything is in-process
// data: the closure is the two provider modules and node:test, with no engine,
// no adapter import and no capture payload parsing.
//
// A supplied frame is admitted data, so these cases check the mapping and its
// refusals, never provenance. Unexecuted: all gates run on admitted remote
// runners.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CATALOG_COMMON_OPERATIONS,
  CATALOG_EXECUTION,
  PROVIDER_DECLARATIONS,
  PROVIDER_DECLARATION_SCHEMA,
  TYPESCRIPT_PRODUCER_ID_STATUS,
  TYPESCRIPT_PRODUCER_MODULE,
  TYPESCRIPT_PRODUCER_OPERATION,
  TYPESCRIPT_RECORD_KIND,
  TYPESCRIPT_RECORD_SCHEMA,
  checkProviderDeclaration,
  declarationForModule,
} from '../../context/catalogs/provider-declaration.mjs';
import {
  CAPTURE_MEMBERS,
  INVOCATION_MEMBERS,
  SOURCE_CAPTURE_ROLE,
  STEP_MEMBERS,
  captureProducer,
  mapInvocationFrame,
} from '../../context/catalogs/transfer-mapping.mjs';
import { CATALOG_OPERATIONS, CATALOG_UNSUPPORTED_OPERATIONS } from '../../context/catalogs/operations.mjs';

const MY_DIGEST = 'd'.repeat(64);
const TS_DIGEST = 'e'.repeat(64);

function declarationOf(moduleId) {
  const declaration = declarationForModule(moduleId);
  assert.notEqual(declaration, null);
  return declaration;
}

// The invocation frame Codec carries: the frozen binding, the admitted records
// and the operation plan, each member rendered by Core's engines-wire.bend.
function bindingFor(declaration, operation) {
  return {
    id: declaration.moduleId,
    revision: 'rev-1',
    declarationDigest: MY_DIGEST,
    protocolVersion: '1',
    operation,
    artifactIdentities: declaration.artifacts.map(artifact => ({ ...artifact, sha256: 'f'.repeat(64) })),
    schemaIdentities: [...declaration.schemas],
  };
}

function stepFor(declaration, operation, overrides = {}) {
  const declared = declaration.operations.find(entry => entry.operation === operation);
  return {
    binding: bindingFor(declaration, operation),
    common: operation,
    declaredEffects: [...declared.effects],
    execution: declared.execution,
    dependencies: [],
    resultSchema: declared.resultSchema,
    ...overrides,
  };
}

function tsStepRef() {
  return { moduleId: TYPESCRIPT_PRODUCER_MODULE, declarationDigest: TS_DIGEST, operation: TYPESCRIPT_PRODUCER_OPERATION };
}

// One admitted captured record. Its producer identity is the only thing that
// attributes it to a step.
function recordFor(producerModule, producerOperation, producerDigest, overrides = {}) {
  return {
    [CAPTURE_MEMBERS.captureKind]: 'file',
    [CAPTURE_MEMBERS.role]: 'record',
    [CAPTURE_MEMBERS.path]: '/work/records.json',
    [CAPTURE_MEMBERS.marker]: 'a'.repeat(64),
    [CAPTURE_MEMBERS.payload]: '{}',
    [CAPTURE_MEMBERS.payloadEncoding]: 'json',
    [CAPTURE_MEMBERS.producerModule]: producerModule,
    [CAPTURE_MEMBERS.producerDigest]: producerDigest,
    [CAPTURE_MEMBERS.producerOperation]: producerOperation,
    ...overrides,
  };
}

function frameFor(declaration, operation, { steps, records }) {
  return {
    [INVOCATION_MEMBERS.moduleBinding]: bindingFor(declaration, operation),
    [INVOCATION_MEMBERS.operationPlan]: steps,
    [INVOCATION_MEMBERS.inputIdentities]: records,
  };
}

function assertRefused(verdict, code) {
  assert.equal(verdict.status, 'refused', JSON.stringify(verdict));
  assert.equal(verdict.code, code, JSON.stringify(verdict));
}

test('both shipped declarations are complete and consume a distinct producer record schema', () => {
  assert.deepEqual(PROVIDER_DECLARATIONS.map(entry => entry.moduleId), ['sqlite-schema', 'postgres-schema']);
  for (const declaration of PROVIDER_DECLARATIONS) {
    const verdict = checkProviderDeclaration(declaration);
    assert.deepEqual(verdict.reasons ?? [], [], `${declaration.moduleId} declares a complete contract`);
    assert.equal(verdict.status, 'admitted');
    assert.equal(declaration.schema, PROVIDER_DECLARATION_SCHEMA);
    assert.deepEqual(declaration.operations.map(entry => entry.operation), CATALOG_COMMON_OPERATIONS);
    for (const operation of declaration.operations) {
      assert.equal(operation.execution, CATALOG_EXECUTION);
      assert.equal(declaration.schemas.includes(operation.resultSchema), true);
      for (const edge of operation.consumes) {
        assert.notEqual(edge.schema, operation.resultSchema, 'an operation never consumes its own result schema');
      }
    }
    const read = declaration.operations.find(entry => entry.operation === 'catalogCapture');
    const plan = declaration.operations.find(entry => entry.operation === 'sqlPlan');
    const join = declaration.operations.find(entry => entry.operation === 'codeAccessJoin');
    assert.deepEqual(read.effects, [], 'a catalog read needs no target effect');
    assert.deepEqual(plan.effects, ['planTargetSql'], 'planning target SQL needs its grant');
    assert.deepEqual(join.effects, ['planTargetSql']);
    assert.deepEqual(join.consumes, [{
      moduleId: TYPESCRIPT_PRODUCER_MODULE,
      operation: TYPESCRIPT_PRODUCER_OPERATION,
      idStatus: TYPESCRIPT_PRODUCER_ID_STATUS,
      schema: TYPESCRIPT_RECORD_SCHEMA,
      kind: TYPESCRIPT_RECORD_KIND,
      envelope: { factKind: 'sqlCall', recordMember: 'value.record' },
    }]);
    assert.equal(declaration.lifetime.profile, 'held-read-transaction');
    assert.ok(declaration.artifacts.some(artifact => artifact.path === declaration.entry.path));
  }
});

test('the declared operation effects agree with the callable inventory', () => {
  const byEngine = new Map();
  for (const entry of CATALOG_OPERATIONS) {
    const engine = entry.subject.database.engine;
    if (!byEngine.has(engine)) byEngine.set(engine, new Map());
    const effects = byEngine.get(engine);
    const named = effects.get(entry.operation) ?? [];
    for (const effect of entry.requiredEffects) {
      if (!named.includes(effect)) named.push(effect);
    }
    effects.set(entry.operation, named);
  }
  for (const declaration of PROVIDER_DECLARATIONS) {
    const inventory = byEngine.get(declaration.moduleId);
    assert.notEqual(inventory, undefined, `${declaration.moduleId} is named by the callable inventory`);
    assert.deepEqual([...inventory.keys()].sort(), declaration.operations.map(entry => entry.operation).sort());
    for (const operation of declaration.operations) {
      assert.deepEqual(
        [...operation.effects].sort(),
        [...inventory.get(operation.operation)].sort(),
        `${declaration.moduleId}.${operation.operation} effects agree with the callable inventory`,
      );
    }
  }
  for (const unsupported of CATALOG_UNSUPPORTED_OPERATIONS) {
    assert.equal(CATALOG_COMMON_OPERATIONS.includes(unsupported), false, `${unsupported} is not an operation this provider implements`);
  }
});

test('the consumed edge carries a pending producer id rather than a published one', () => {
  assert.equal(TYPESCRIPT_PRODUCER_ID_STATUS, 'required-pending');
  for (const declaration of PROVIDER_DECLARATIONS) {
    const join = declaration.operations.find(entry => entry.operation === 'codeAccessJoin');
    for (const edge of join.consumes) {
      assert.equal(edge.idStatus, 'required-pending', `${declaration.moduleId} records the producer id as required pending`);
      assert.equal(edge.schema, TYPESCRIPT_RECORD_SCHEMA, 'the record schema is the one the TypeScript lane publishes');
      assert.equal(edge.kind, TYPESCRIPT_RECORD_KIND);
      assert.equal(edge.moduleId, TYPESCRIPT_PRODUCER_MODULE);
      assert.equal(edge.operation, TYPESCRIPT_PRODUCER_OPERATION);
    }
  }
});

test('a declaration the mapping cannot compare against is refused with a provider-local code', () => {
  const declaration = declarationOf('sqlite-schema');
  const cases = [
    { name: 'no operation', mutate: value => ({ ...value, operations: [] }), code: 'operationsEmpty' },
    { name: 'result schema outside the set', mutate: value => ({ ...value, operations: value.operations.map(entry => ({ ...entry, resultSchema: 'baton2.context.unknown.result.v1' })) }), code: 'resultSchemaUnlisted' },
    { name: 'no execution token', mutate: value => ({ ...value, operations: value.operations.map(entry => ({ ...entry, execution: undefined })) }), code: 'executionMissing' },
    { name: 'edge without kind', mutate: value => ({ ...value, operations: value.operations.map(entry => (entry.operation === 'codeAccessJoin' ? { ...entry, consumes: [{ moduleId: 'typescript', operation: 'sourceAnalysis', schema: TYPESCRIPT_RECORD_SCHEMA }] } : entry)) }), code: 'edgeIncomplete' },
    { name: 'edge without an envelope', mutate: value => ({ ...value, operations: value.operations.map(entry => (entry.operation === 'codeAccessJoin' ? { ...entry, consumes: entry.consumes.map(edge => ({ moduleId: edge.moduleId, operation: edge.operation, schema: edge.schema, kind: edge.kind })) } : entry)) }), code: 'edgeEnvelopeAbsent' },
    { name: 'edge without a producer id status', mutate: value => ({ ...value, operations: value.operations.map(entry => (entry.operation === 'codeAccessJoin' ? { ...entry, consumes: entry.consumes.map(edge => ({ moduleId: edge.moduleId, operation: edge.operation, schema: edge.schema, kind: edge.kind, envelope: { ...edge.envelope } })) } : entry)) }), code: 'edgeIdStatusAbsent' },
    { name: 'edge carrying the operation result schema', mutate: value => ({ ...value, operations: value.operations.map(entry => (entry.operation === 'codeAccessJoin' ? { ...entry, consumes: [{ moduleId: 'typescript', operation: 'sourceAnalysis', idStatus: TYPESCRIPT_PRODUCER_ID_STATUS, schema: entry.resultSchema, kind: TYPESCRIPT_RECORD_KIND, envelope: { factKind: 'sqlCall', recordMember: 'value.record' } }] } : entry)) }), code: 'edgeSchemaNotDistinct' },
  ];
  for (const entry of cases) {
    const verdict = checkProviderDeclaration(entry.mutate(declaration));
    assert.equal(verdict.status, 'refused', entry.name);
    assert.ok(verdict.reasons.some(reason => reason.code === entry.code), `${entry.name} reports ${entry.code}: ${JSON.stringify(verdict.reasons)}`);
  }
});

test('a catalog read maps its own binding and its own captured record', () => {
  const declaration = declarationOf('sqlite-schema');
  const mine = recordFor(declaration.moduleId, 'catalogCapture', MY_DIGEST, { role: 'catalog' });
  const mapped = mapInvocationFrame({
    frame: frameFor(declaration, 'catalogCapture', { steps: [stepFor(declaration, 'catalogCapture')], records: [mine] }),
    declaration,
  });
  assert.equal(mapped.status, 'mapped', JSON.stringify(mapped));
  const o = mapped.operands;
  assert.equal(o.binding.id, 'sqlite-schema');
  assert.equal(o.binding.operation, 'catalogCapture');
  assert.equal(o.binding.declarationDigest, MY_DIGEST);
  assert.equal(o.binding.protocolVersion, '1');
  assert.equal(o.binding.artifactIdentities[0].sha256, 'f'.repeat(64));
  assert.deepEqual(o.binding.schemaIdentities, declaration.schemas);
  assert.equal(o.common, 'catalogCapture');
  assert.equal(o.execution, 'managed');
  assert.equal(o.resultSchema, 'baton2.context.sqlite-schema.catalogCapture.result.v1');
  assert.deepEqual(o.declaredEffects, []);
  assert.equal(o.lifetimeProfile, 'held-read-transaction');
  assert.equal(o.captures.length, 1, 'the record this step produced is its input');
  assert.deepEqual(o.dependencyInputs, []);
  assert.deepEqual(o.unattributedCaptures, []);
  assert.deepEqual(o.dependencies, []);
});

test('a declared producer edge is served only from records that producer returned', () => {
  const declaration = declarationOf('sqlite-schema');
  const steps = [stepFor(declaration, 'codeAccessJoin', { dependencies: [tsStepRef()] })];
  const joinFrame = records => frameFor(declaration, 'codeAccessJoin', { steps, records });

  const served = mapInvocationFrame({
    frame: joinFrame([recordFor(TYPESCRIPT_PRODUCER_MODULE, TYPESCRIPT_PRODUCER_OPERATION, TS_DIGEST)]),
    declaration,
  });
  assert.equal(served.status, 'mapped', JSON.stringify(served));
  assert.equal(served.operands.dependencyInputs.length, 1);
  assert.equal(served.operands.dependencyInputs[0].records.length, 1);
  assert.equal(served.operands.dependencyInputs[0].declarationDigest, TS_DIGEST);
  assert.deepEqual(served.operands.dependencyInputs[0].edge, {
    moduleId: TYPESCRIPT_PRODUCER_MODULE,
    operation: TYPESCRIPT_PRODUCER_OPERATION,
    idStatus: TYPESCRIPT_PRODUCER_ID_STATUS,
    schema: TYPESCRIPT_RECORD_SCHEMA,
    kind: TYPESCRIPT_RECORD_KIND,
    envelope: { factKind: 'sqlCall', recordMember: 'value.record' },
  });
  assert.notEqual(served.operands.resultSchema, TYPESCRIPT_RECORD_SCHEMA);
  assert.deepEqual(served.operands.consumes, [{
    moduleId: TYPESCRIPT_PRODUCER_MODULE,
    operation: TYPESCRIPT_PRODUCER_OPERATION,
    idStatus: TYPESCRIPT_PRODUCER_ID_STATUS,
    schema: TYPESCRIPT_RECORD_SCHEMA,
    kind: TYPESCRIPT_RECORD_KIND,
    envelope: { factKind: 'sqlCall', recordMember: 'value.record' },
  }]);

  // A source capture is the producer's own input, not the record it returned.
  const sourceOnly = mapInvocationFrame({
    frame: joinFrame([recordFor(TYPESCRIPT_PRODUCER_MODULE, TYPESCRIPT_PRODUCER_OPERATION, TS_DIGEST, {
      [CAPTURE_MEMBERS.role]: SOURCE_CAPTURE_ROLE,
      [CAPTURE_MEMBERS.path]: '/work/src/shop.ts',
      [CAPTURE_MEMBERS.payloadEncoding]: 'utf8',
    })]),
    declaration,
  });
  assertRefused(sourceOnly, 'dependencyInputAbsent');
  assert.match(sourceOnly.detail, /source captures \/work\/src\/shop\.ts and no record of baton2\.context\.resolver-record\.v1/);

  // An empty input set is not a completed empty analysis by the producer.
  const absent = mapInvocationFrame({ frame: joinFrame([]), declaration });
  assertRefused(absent, 'dependencyInputAbsent');
  assert.match(absent.detail, /attributes no record to it/);

  // The producer step must be in the plan at all.
  const unplanned = mapInvocationFrame({
    frame: frameFor(declaration, 'codeAccessJoin', {
      steps: [stepFor(declaration, 'codeAccessJoin')],
      records: [recordFor(TYPESCRIPT_PRODUCER_MODULE, TYPESCRIPT_PRODUCER_OPERATION, TS_DIGEST)],
    }),
    declaration,
  });
  assertRefused(unplanned, 'edgeMissingFromPlan');
  assert.match(unplanned.detail, /typescript\.sourceAnalysis is a declared input of codeAccessJoin/);
});

test('a record from another producer revision or an undeclared producer is refused or reported', () => {
  const declaration = declarationOf('sqlite-schema');
  const steps = [stepFor(declaration, 'codeAccessJoin', { dependencies: [tsStepRef()] })];
  const stale = mapInvocationFrame({
    frame: frameFor(declaration, 'codeAccessJoin', {
      steps,
      records: [recordFor(TYPESCRIPT_PRODUCER_MODULE, TYPESCRIPT_PRODUCER_OPERATION, 'a'.repeat(64))],
    }),
    declaration,
  });
  assertRefused(stale, 'producerRevisionMismatch');

  const stranger = recordFor('python-models', 'modelScan', 'b'.repeat(64), { [CAPTURE_MEMBERS.path]: '/work/models.json' });
  const mapped = mapInvocationFrame({
    frame: frameFor(declaration, 'codeAccessJoin', {
      steps,
      records: [recordFor(TYPESCRIPT_PRODUCER_MODULE, TYPESCRIPT_PRODUCER_OPERATION, TS_DIGEST), stranger],
    }),
    declaration,
  });
  assert.equal(mapped.status, 'mapped', JSON.stringify(mapped));
  assert.equal(mapped.operands.dependencyInputs[0].records.length, 1, 'the declared edge is served from its own producer');
  assert.deepEqual(mapped.operands.unattributedCaptures, [{
    producer: { moduleId: 'python-models', declarationDigest: 'b'.repeat(64), operation: 'modelScan' },
    captureKind: 'file',
    path: '/work/models.json',
  }]);
});

test('the step result schema must be the declared result and never a consumed record schema', () => {
  const declaration = declarationOf('sqlite-schema');
  const wrong = mapInvocationFrame({
    frame: frameFor(declaration, 'codeAccessJoin', {
      steps: [stepFor(declaration, 'codeAccessJoin', { dependencies: [tsStepRef()], resultSchema: TYPESCRIPT_RECORD_SCHEMA })],
      records: [recordFor(TYPESCRIPT_PRODUCER_MODULE, TYPESCRIPT_PRODUCER_OPERATION, TS_DIGEST)],
    }),
    declaration,
  });
  assertRefused(wrong, 'resultSchemaMismatch');
});

test('absent and wrong-kind members refuse and are never filled from a default', () => {
  const declaration = declarationOf('sqlite-schema');
  const step = stepFor(declaration, 'catalogCapture');
  const ok = () => frameFor(declaration, 'catalogCapture', { steps: [step], records: [] });

  assertRefused(mapInvocationFrame({ frame: null, declaration }), 'frameAbsent');
  assertRefused(mapInvocationFrame({ frame: ok(), declaration: null }), 'declarationAbsent');
  assertRefused(mapInvocationFrame({ frame: { ...ok(), moduleBinding: undefined }, declaration }), 'moduleBindingAbsent');

  const noDigest = ok();
  delete noDigest.moduleBinding.declarationDigest;
  const incomplete = mapInvocationFrame({ frame: noDigest, declaration });
  assertRefused(incomplete, 'bindingIncomplete');
  assert.match(incomplete.detail, /moduleBinding\.declarationDigest/);

  const noArtifacts = ok();
  noArtifacts.moduleBinding.artifactIdentities = null;
  const arrayIncomplete = mapInvocationFrame({ frame: noArtifacts, declaration });
  assertRefused(arrayIncomplete, 'bindingIncomplete');
  assert.match(arrayIncomplete.detail, /artifactIdentities must be an array/);

  const otherModule = ok();
  otherModule.moduleBinding.id = 'postgres-schema';
  assertRefused(mapInvocationFrame({ frame: otherModule, declaration }), 'bindingModuleMismatch');

  const unknownOperation = ok();
  unknownOperation.moduleBinding.operation = 'catalogReplay';
  assertRefused(mapInvocationFrame({ frame: unknownOperation, declaration }), 'unknownOperation');

  assertRefused(mapInvocationFrame({ frame: { ...ok(), operationPlan: null }, declaration }), 'operationPlanAbsent');
  const absentStep = mapInvocationFrame({ frame: { ...ok(), operationPlan: [stepFor(declaration, 'sqlPlan')] }, declaration });
  assertRefused(absentStep, 'stepAbsent');
  assert.match(absentStep.detail, /sqlite-schema\.catalogCapture at d{64}/);

  const wrongExecution = mapInvocationFrame({
    frame: frameFor(declaration, 'catalogCapture', { steps: [stepFor(declaration, 'catalogCapture', { execution: 'pure' })], records: [] }),
    declaration,
  });
  assertRefused(wrongExecution, 'executionMismatch');

  const undeclared = mapInvocationFrame({
    frame: frameFor(declaration, 'catalogCapture', { steps: [stepFor(declaration, 'catalogCapture', { declaredEffects: ['planTargetSql'] })], records: [] }),
    declaration,
  });
  assertRefused(undeclared, 'undeclaredEffect');

  const selfEdge = mapInvocationFrame({
    frame: frameFor(declaration, 'catalogCapture', {
      steps: [stepFor(declaration, 'catalogCapture', { dependencies: [{ moduleId: 'sqlite-schema', declarationDigest: MY_DIGEST, operation: 'catalogCapture' }] })],
      records: [],
    }),
    declaration,
  });
  assertRefused(selfEdge, 'selfDependency');

  const shortRecord = { [CAPTURE_MEMBERS.role]: 'catalog' };
  const incompleteRecord = mapInvocationFrame({
    frame: frameFor(declaration, 'catalogCapture', { steps: [step], records: [shortRecord] }),
    declaration,
  });
  assertRefused(incompleteRecord, 'captureIncomplete');
  assert.match(incompleteRecord.detail, /captureKind/);

  const noRecords = ok();
  noRecords.inputIdentities = 'none';
  assertRefused(mapInvocationFrame({ frame: noRecords, declaration }), 'inputIdentitiesAbsent');
});

test('a producer identity is read from the record and not inferred from another member', () => {
  const declaration = declarationOf('sqlite-schema');
  const record = recordFor(TYPESCRIPT_PRODUCER_MODULE, TYPESCRIPT_PRODUCER_OPERATION, TS_DIGEST);
  assert.deepEqual(captureProducer(record), {
    moduleId: TYPESCRIPT_PRODUCER_MODULE,
    declarationDigest: TS_DIGEST,
    operation: TYPESCRIPT_PRODUCER_OPERATION,
  });
});
