// The TypeScript provider declaration: the versions kept apart, the holes and their authorities, and
// the completeness check's refusals.
//
// These cases read the declaration as data. They assert that each identity is the one an accepted
// contract names, that the declared transport is the version this module's frames actually carry
// rather than the version Core admits, that every member package admission owns stays a named hole,
// and that the provider's own completeness check refuses each way the record can drift and admits a
// record whose holes are filled. The closure case checks the declared rows against the provider
// package on disk.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  ADMISSION_HOLES,
  ADMITTED_EFFECTS,
  ADMITTED_TRANSPORT_VERSION,
  DATABASE_PROJECTION,
  DECLARATION_VERSION,
  DECLARED_TRANSPORT_VERSION,
  ENGINE_EFFECTS,
  EXECUTION,
  IMPLEMENTS_OPERATION,
  LIFECYCLE,
  MODULE_ID,
  MODULE_REVISION,
  OPERATIONS,
  PACKAGE_IDENTITY,
  PACKAGE_ROOT,
  PROVIDER_DECLARATION,
  PROVIDER_DECLARATION_SCHEMA,
  PROVIDER_ENTRY,
  SCHEMA_ROLES,
  SOURCE_ANALYSIS,
  SOURCE_PROJECTIONS,
  SOURCE_SUBJECT_KINDS,
  SQL_PLAN,
  admissionRequirements,
  checkProviderDeclaration,
  verifyDeclaredClosure,
} from './provider-declaration.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// A record whose holes are filled with fixture values. The values exercise the check; they are not
// claims about any admitted inventory.
function filledRecord() {
  const copy = structuredClone(PROVIDER_DECLARATION);
  copy.protocolVersion = ADMITTED_TRANSPORT_VERSION;
  copy.activation.argv = ['node', 'provider.mjs'];
  copy.activation.sha256 = 'a'.repeat(64);
  copy.activation.status = 'admitted';
  for (const artifact of copy.artifacts) artifact.sha256 = 'b'.repeat(64);
  for (const operation of copy.operations) {
    for (const row of operation.schemas) {
      row.identity = `baton2.context.typescript.${operation.id}.${row.role}.fixture.v1`;
      row.status = 'admitted';
    }
  }
  return copy;
}

function mutated(change, base = PROVIDER_DECLARATION) {
  const copy = structuredClone(base);
  change(copy);
  return checkProviderDeclaration(copy);
}

function reasonsOf(result) {
  assert.equal(result.status, 'refused', 'the record was admitted');
  return result.reasons.map((reason) => reason.reason);
}

test('the declaration schema version and the transport version stay apart', () => {
  assert.equal(DECLARATION_VERSION, '1', "Core admits declaration schema '1'");
  assert.equal(DECLARED_TRANSPORT_VERSION, '1', "the version this provider's frames carry");
  assert.equal(ADMITTED_TRANSPORT_VERSION, '2', "the transport Core admits");
  assert.notEqual(DECLARED_TRANSPORT_VERSION, ADMITTED_TRANSPORT_VERSION);
  assert.equal(PROVIDER_DECLARATION.version, DECLARATION_VERSION);
  assert.equal(
    PROVIDER_DECLARATION.protocolVersion,
    DECLARED_TRANSPORT_VERSION,
    'the record declares the wire it writes, never the transport it does not speak',
  );
  assert.ok(
    ADMISSION_HOLES.some((hole) => hole.code === 'transportVersionUnadmitted'),
    'the version-1 wire is carried as a hole with the bridge or migration it needs',
  );
});

test('the record is refused, and every hole it carries is reported with its authority', () => {
  const result = checkProviderDeclaration(PROVIDER_DECLARATION);
  const reasons = reasonsOf(result);
  for (const hole of ADMISSION_HOLES) {
    assert.ok(reasons.includes(hole.code), `${hole.code} is reported`);
    assert.ok(hole.authority.length > 0 && hole.detail.length > 0, `${hole.code} names its authority and condition`);
  }
  assert.ok(reasons.includes('schemaIdentityUnadmitted'), 'the unadmitted schema identities are reported');
  assert.ok(reasons.includes('artifactDigestUnadmitted'), 'the unadmitted artifact digests are reported');
  const identities = result.reasons.filter((reason) => reason.reason === 'schemaIdentityUnadmitted');
  assert.equal(
    identities.length,
    OPERATIONS.length * SCHEMA_ROLES.length,
    'one reported identity per operation and schema role',
  );
});

test('a record whose holes are filled is admitted', () => {
  const filled = filledRecord();
  const result = checkProviderDeclaration(filled);
  assert.deepEqual(result.reasons ?? [], [], 'the completeness check reports no reason');
  assert.equal(result.status, 'admitted');
});

test('filling each hole back is refused by the reason that names it', () => {
  const filled = filledRecord();
  assert.ok(reasonsOf(mutated((copy) => { copy.protocolVersion = DECLARED_TRANSPORT_VERSION; }, filled))
    .includes('transportVersionUnadmitted'));
  assert.ok(reasonsOf(mutated((copy) => { copy.activation.argv = null; }, filled))
    .includes('invocationVectorUnadmitted'));
  assert.ok(reasonsOf(mutated((copy) => { copy.activation.argv = []; }, filled))
    .includes('invocationVectorUnadmitted'));
  assert.ok(reasonsOf(mutated((copy) => { copy.activation.argv = ['node', '']; }, filled))
    .includes('invocationVectorUnadmitted'));
  assert.ok(reasonsOf(mutated((copy) => { copy.artifacts[0].sha256 = null; }, filled))
    .includes('artifactDigestUnadmitted'));
  assert.ok(reasonsOf(mutated((copy) => { copy.activation.sha256 = null; }, filled))
    .includes('artifactDigestUnadmitted'));
  assert.ok(reasonsOf(mutated((copy) => { copy.operations[0].schemas[4].identity = null; }, filled))
    .includes('schemaIdentityUnadmitted'));
});

test('every identity is one an accepted contract names', () => {
  assert.equal(MODULE_ID, 'typescript', "Core's engine identity for this provider");
  assert.equal(MODULE_REVISION, '1');
  assert.equal(PACKAGE_IDENTITY, 'baton2-context');
  assert.deepEqual(
    OPERATIONS.map((operation) => operation.id),
    [SOURCE_ANALYSIS, SQL_PLAN],
    "the two common operations this lane's native half selects",
  );
  for (const operation of OPERATIONS) {
    assert.equal(operation.implementsOperation, IMPLEMENTS_OPERATION[operation.id]);
    assert.deepEqual(operation.dependencies, []);
  }
  assert.deepEqual(SOURCE_SUBJECT_KINDS, ['position', 'symbol', 'diagnostic']);
  assert.deepEqual(
    PROVIDER_DECLARATION.applicability.filter((rule) => rule.kind === 'subject').map((rule) => rule.value),
    [...SOURCE_SUBJECT_KINDS],
  );
  assert.equal(PROVIDER_DECLARATION.activation.artifact, PROVIDER_ENTRY);
  assert.equal(PROVIDER_DECLARATION.activation.argv, null, 'the record holds no launch vector it does not own');
  for (const artifact of PROVIDER_DECLARATION.artifacts) {
    assert.equal(artifact.sha256, null, 'packaging computes the digest');
    assert.ok(artifact.role.length > 0);
    assert.ok(artifact.path.startsWith(`${PACKAGE_ROOT}/`));
  }
});

test('the projections partition the provider set and never overlap', () => {
  const declared = OPERATIONS.flatMap((operation) => operation.projections);
  assert.equal(new Set(declared).size, declared.length, 'no projection is declared twice');
  assert.deepEqual(
    [...declared].sort(),
    [...SOURCE_PROJECTIONS, DATABASE_PROJECTION].sort(),
    'every projection the provider reports is declared by exactly one operation',
  );
});

test('the per-operation effects meet the engine set Core admits', () => {
  const source = OPERATIONS.find((operation) => operation.id === SOURCE_ANALYSIS);
  const plan = OPERATIONS.find((operation) => operation.id === SQL_PLAN);
  assert.deepEqual(source.effects, [], 'extraction from captured source requires no effect');
  assert.deepEqual(plan.effects, ['planTargetSql'], 'the planning join requires the plan grant');
  assert.deepEqual(
    [...new Set(OPERATIONS.flatMap((operation) => operation.effects))].sort(),
    [...ENGINE_EFFECTS].sort(),
  );
  for (const effect of ENGINE_EFFECTS) assert.ok(ADMITTED_EFFECTS.includes(effect));
});

test('the lifecycle states the process the provider actually runs', () => {
  assert.equal(EXECUTION, 'managed');
  assert.equal(LIFECYCLE.profile, '', 'Core requires a lifetime profile only for runtime execution');
  assert.match(LIFECYCLE.detail, /one child process per query/);
  assert.match(LIFECYCLE.detail, /no keeper is retained/);
  for (const operation of OPERATIONS) {
    assert.equal(operation.execution, EXECUTION);
    assert.equal(operation.lifetimeProfile, '');
  }
  assert.equal(PROVIDER_DECLARATION.lifecycle.profile, '');
  assert.deepEqual(
    OPERATIONS.map((operation) => operation.schemas.length),
    OPERATIONS.map(() => SCHEMA_ROLES.length),
    'every operation carries one row per schema role',
  );

  const filled = filledRecord();
  assert.ok(reasonsOf(mutated((copy) => { copy.operations[0].lifetimeProfile = 'held'; }, filled))
    .includes('lifetimeProfileUnsupported'));
});

test('admission lists what the packager must supply, item by item', () => {
  const requirements = admissionRequirements(PROVIDER_DECLARATION);
  assert.equal(requirements.moduleId, MODULE_ID);
  assert.equal(requirements.declaredTransportVersion, DECLARED_TRANSPORT_VERSION);
  assert.equal(requirements.admittedTransportVersion, ADMITTED_TRANSPORT_VERSION);
  assert.equal(requirements.transportStatus, 'unadmitted');
  assert.equal(requirements.invocation.argv, null);
  assert.equal(requirements.invocation.status, 'unadmitted');
  assert.equal(requirements.invocation.artifact, PROVIDER_ENTRY);
  assert.equal(requirements.artifacts.length, PROVIDER_DECLARATION.artifacts.length);
  for (const artifact of requirements.artifacts) {
    assert.equal(artifact.digest, null);
    assert.equal(artifact.status, 'unadmitted');
    assert.ok(artifact.path.startsWith(`${PACKAGE_ROOT}/`));
    assert.ok(artifact.role.length > 0);
  }
  assert.equal(requirements.schemas.length, OPERATIONS.length * SCHEMA_ROLES.length);
  for (const schema of requirements.schemas) {
    assert.equal(schema.identity, null, 'the inventory request carries no invented identity');
    assert.equal(schema.status, 'unadmitted');
    assert.ok(SCHEMA_ROLES.includes(schema.role));
  }
  const filled = admissionRequirements(filledRecord());
  assert.equal(filled.transportStatus, 'admitted');
  assert.equal(filled.invocation.status, 'admitted');
  assert.ok(filled.artifacts.every((artifact) => artifact.status === 'admitted'));
  assert.ok(filled.schemas.every((schema) => schema.status === 'admitted'));
});

test('the completeness check refuses each way the record can drift', () => {
  assert.ok(reasonsOf(mutated((copy) => { copy.id = ''; })).includes('moduleIdEmpty'));
  assert.ok(reasonsOf(mutated((copy) => { copy.version = '2'; })).includes('declarationVersionUnsupported'));
  assert.ok(reasonsOf(mutated((copy) => { copy.schema = 'other'; })).includes('schemaUnsupported'));
  assert.ok(reasonsOf(mutated((copy) => { copy.packageIdentity = 'elsewhere'; })).includes('packageIdentityUnsupported'));
  assert.ok(reasonsOf(mutated((copy) => { copy.activation = null; })).includes('activationMissing'));
  assert.ok(reasonsOf(mutated((copy) => { copy.activation.artifact = `${PACKAGE_ROOT}/missing.mjs`; }))
    .includes('activationArtifactNotDeclared'));
  assert.ok(reasonsOf(mutated((copy) => {
    copy.artifacts.push({ path: 'libexec/baton2/context/catalogs/adapter.mjs', sha256: null, role: 'library' });
  })).includes('artifactPathOutsidePackage'));
  assert.ok(reasonsOf(mutated((copy) => { copy.artifacts = []; })).includes('artifactsEmpty'));
  assert.ok(reasonsOf(mutated((copy) => { copy.operations = []; })).includes('operationsEmpty'));

  assert.ok(reasonsOf(mutated((copy) => { copy.operations[0].id = 'inventedOperation'; }))
    .includes('implementsOperationUnsupported'));
  assert.ok(reasonsOf(mutated((copy) => {
    copy.operations = [copy.operations[0], structuredClone(copy.operations[0])];
  })).includes('duplicateOperation'));
  assert.ok(reasonsOf(mutated((copy) => { copy.operations[0].execution = 'eventual'; }))
    .includes('executionUnsupported'));
  assert.ok(reasonsOf(mutated((copy) => { copy.operations[0].effects = ['executeTarget']; }))
    .includes('effectsOutsideEngineSet'));
  assert.ok(reasonsOf(mutated((copy) => { copy.operations[1].effects = ['inventedEffect']; }))
    .includes('effectUnknown'));
  assert.ok(reasonsOf(mutated((copy) => { copy.operations[1].projections = ['definition']; }))
    .includes('projectionDeclaredTwice'));
  const withoutEvent = filledRecord();
  withoutEvent.operations[0].schemas = withoutEvent.operations[0].schemas.filter((row) => row.role !== 'event');
  assert.ok(reasonsOf(checkProviderDeclaration(withoutEvent)).includes('schemaRoleMissing'));

  assert.ok(reasonsOf(mutated((copy) => { copy.applicability = []; })).includes('applicabilityEmpty'));
  assert.ok(reasonsOf(mutated((copy) => { copy.applicability = [{ kind: 'subject', value: 'subject' }]; }))
    .includes('subjectKindUnknown'));
  assert.ok(reasonsOf(mutated((copy) => { copy.applicability = [{ kind: 'guess', value: 'x' }]; }))
    .includes('applicabilityKindUnsupported'));

  assert.equal(checkProviderDeclaration(null).status, 'refused');
});

test('the declared artifact closure matches the provider package on disk', (t) => {
  const packageRoot = join(HERE, '..', 'typescript');
  if (!existsSync(join(packageRoot, 'provider.mjs'))) {
    t.skip('the provider package is not present in this tree; checked after composition');
    return;
  }
  const { missing, undeclared } = verifyDeclaredClosure(PROVIDER_DECLARATION, packageRoot);
  assert.deepEqual(missing, [], 'every declared artifact exists in the package');
  assert.deepEqual(undeclared, [], 'every provider module is declared');
});
