// The TypeScript provider declaration: the identities the accepted contract names, the effect
// minima, and the completeness check's refusals.
//
// These cases read the declaration as data. They assert that each identity is the one Core's
// accepted registry contract holds, that the artifact rows stay inside this package, and that the
// provider's own completeness check refuses each way the record could drift. The closure case
// checks the declared rows against the provider package on disk and is skipped until a composition
// carries the provider files.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  ADMITTED_EFFECTS,
  DATABASE_PROJECTION,
  DECLARATION_VERSION,
  ENGINE_EFFECTS,
  EXECUTION,
  IMPLEMENTS_OPERATION,
  MODULE_ID,
  MODULE_REVISION,
  OPERATIONS,
  PACKAGE_IDENTITY,
  PACKAGE_ROOT,
  PROTOCOL_VERSION,
  PROVIDER_DECLARATION,
  PROVIDER_DECLARATION_SCHEMA,
  PROVIDER_ENTRY,
  SOURCE_ANALYSIS,
  SOURCE_PROJECTIONS,
  SOURCE_SUBJECT_KINDS,
  SQL_PLAN,
  checkProviderDeclaration,
  verifyDeclaredClosure,
} from './provider-declaration.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function mutated(change) {
  const copy = structuredClone(PROVIDER_DECLARATION);
  change(copy);
  return checkProviderDeclaration(copy);
}

function reasonsOf(result) {
  assert.equal(result.status, 'refused', 'the declaration was admitted');
  return result.reasons.map((reason) => reason.reason);
}

test('the declaration is complete and its own check admits it', () => {
  const result = checkProviderDeclaration(PROVIDER_DECLARATION);
  assert.deepEqual(result.reasons ?? [], [], 'the completeness check reports no reason');
  assert.equal(result.status, 'admitted');

  assert.equal(PROVIDER_DECLARATION.schema, PROVIDER_DECLARATION_SCHEMA);
  assert.equal(PROVIDER_DECLARATION.id, MODULE_ID);
  assert.equal(PROVIDER_DECLARATION.revision, MODULE_REVISION);
  assert.equal(PROVIDER_DECLARATION.packageIdentity, PACKAGE_IDENTITY);
  assert.equal(PROVIDER_DECLARATION.entry.artifact, PROVIDER_ENTRY);
  assert.equal(PROVIDER_DECLARATION.entry.kind, 'process');
  assert.ok(PROVIDER_DECLARATION.entry.argv.length > 0, 'a process entry carries an argv vector');
  assert.ok(PROVIDER_DECLARATION.schemas.length > 0);
  assert.ok(PROVIDER_DECLARATION.applicability.length > 0);

  const declaredPaths = PROVIDER_DECLARATION.artifacts.map((artifact) => artifact.path);
  assert.equal(new Set(declaredPaths).size, declaredPaths.length, 'artifact rows are unique');
  assert.ok(declaredPaths.includes(PROVIDER_ENTRY), 'the entry artifact is declared');
  for (const artifact of PROVIDER_DECLARATION.artifacts) {
    assert.equal(artifact.sha256, null, 'packaging fills the digest');
    assert.ok(artifact.role.length > 0);
  }
});

test('every identity is one an accepted contract names', () => {
  assert.equal(MODULE_ID, 'typescript', "Core's engine identity for this provider");
  assert.deepEqual(
    OPERATIONS.map((operation) => operation.id),
    [SOURCE_ANALYSIS, SQL_PLAN],
    "the two common operations this lane's native half selects",
  );
  for (const operation of OPERATIONS) {
    assert.equal(
      operation.implementsOperation,
      IMPLEMENTS_OPERATION[operation.id],
      'the module-local operation id implements the common operation of the same name',
    );
  }
  assert.deepEqual(SOURCE_SUBJECT_KINDS, ['position', 'symbol', 'diagnostic']);
  assert.deepEqual(
    PROVIDER_DECLARATION.applicability.filter((rule) => rule.kind === 'subject').map((rule) => rule.value),
    [...SOURCE_SUBJECT_KINDS],
  );
});

test('the projections partition the provider set and never overlap', () => {
  const declared = OPERATIONS.flatMap((operation) => operation.projections);
  assert.equal(new Set(declared).size, declared.length, 'no projection is declared twice');
  assert.deepEqual(
    [...declared].sort(),
    [...SOURCE_PROJECTIONS, DATABASE_PROJECTION].sort(),
    'every projection the provider reports is declared by exactly one operation',
  );
  assert.ok(
    OPERATIONS.find((operation) => operation.id === SQL_PLAN).projections.includes(DATABASE_PROJECTION),
    'the database projection belongs to the planning operation',
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
  for (const effect of ENGINE_EFFECTS) {
    assert.ok(ADMITTED_EFFECTS.includes(effect), `${effect} has an admitted meaning`);
  }
  for (const operation of OPERATIONS) {
    assert.equal(operation.lifetimeProfile, '', 'Core requires a lifetime profile only for runtime execution');
    assert.equal(operation.execution, EXECUTION);
    assert.deepEqual(operation.dependencies, []);
  }
});

test('the declaration and protocol versions are the admitted ones', () => {
  assert.equal(DECLARATION_VERSION, '1');
  assert.equal(PROTOCOL_VERSION, '2');
  assert.equal(PROVIDER_DECLARATION.version, DECLARATION_VERSION);
  assert.equal(PROVIDER_DECLARATION.protocolVersion, PROTOCOL_VERSION);
});

test('the completeness check refuses each way the record can drift', () => {
  assert.ok(reasonsOf(mutated((copy) => { copy.id = ''; })).includes('moduleIdEmpty'));
  assert.ok(reasonsOf(mutated((copy) => { copy.version = '2'; })).includes('declarationVersionUnsupported'));
  assert.ok(reasonsOf(mutated((copy) => { copy.protocolVersion = '1'; })).includes('protocolVersionUnsupported'));
  assert.ok(reasonsOf(mutated((copy) => { copy.packageIdentity = 'elsewhere'; })).includes('packageIdentityUnsupported'));
  assert.ok(reasonsOf(mutated((copy) => { copy.schema = 'other'; })).includes('schemaUnsupported'));

  assert.ok(reasonsOf(mutated((copy) => {
    copy.operations[0].id = 'inventedOperation';
  })).includes('implementsOperationUnsupported'));
  assert.ok(reasonsOf(mutated((copy) => {
    copy.operations[0].resultSchema = 'baton2.context.typescript.sourceAnalysis.other.v1';
  })).includes('schemaUnlisted'));
  assert.ok(reasonsOf(mutated((copy) => {
    copy.operations[1].effects = ['inventedEffect'];
  })).includes('effectUnknown'));
  assert.ok(reasonsOf(mutated((copy) => {
    copy.operations[0].effects = ['executeTarget'];
  })).includes('effectsOutsideEngineSet'));
  assert.ok(reasonsOf(mutated((copy) => {
    copy.operations[0].execution = 'eventual';
  })).includes('executionUnsupported'));
  assert.ok(reasonsOf(mutated((copy) => {
    copy.operations = [copy.operations[0], { ...structuredClone(copy.operations[0]) }];
  })).includes('duplicateOperation'));
  assert.ok(reasonsOf(mutated((copy) => {
    copy.operations[1].projections = ['definition'];
  })).includes('projectionDeclaredTwice'));
  assert.ok(reasonsOf(mutated((copy) => { copy.operations = []; })).includes('operationsEmpty'));

  assert.ok(reasonsOf(mutated((copy) => {
    copy.artifacts.push({ path: 'libexec/baton2/context/catalogs/adapter.mjs', sha256: null, role: 'library' });
  })).includes('artifactPathOutsidePackage'));
  assert.ok(reasonsOf(mutated((copy) => {
    copy.entry.artifact = `${PACKAGE_ROOT}/missing.mjs`;
  })).includes('entryArtifactNotDeclared'));
  assert.ok(reasonsOf(mutated((copy) => { copy.entry.argv = []; })).includes('entryVectorEmpty'));
  assert.ok(reasonsOf(mutated((copy) => { copy.artifacts = []; })).includes('artifactsEmpty'));

  assert.ok(reasonsOf(mutated((copy) => { copy.applicability = []; })).includes('applicabilityEmpty'));
  assert.ok(reasonsOf(mutated((copy) => {
    copy.applicability = [{ kind: 'subject', value: 'subject' }];
  })).includes('subjectKindUnknown'));
  assert.ok(reasonsOf(mutated((copy) => {
    copy.applicability = [{ kind: 'guess', value: 'x' }];
  })).includes('applicabilityKindUnsupported'));

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
