// Domain provider tests: the model-use join over the TypeScript resolver's
// ResolverUseRecord boundary.
//
// Every fact carries `value.record`; `value.useSiteRef` is a string ref id and
// never a site object. The join refuses a record whose module digest, export
// declaration identity, export name or snapshot identity is absent or
// disagrees with the observed model, and it never falls back to a name match.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { joinModelUses } from '../../context/models/index.mjs';

const MODULE = { realPath: '/work/src/models/user.mjs', path: '/work/src/models/user.mjs', sha256: 'c'.repeat(64) };
const DECLARATION = { path: MODULE.path, sha256: MODULE.sha256, range: { start: { line: 3, column: 13 }, end: { line: 5, column: 2 } } };
const USE_SITE = { path: '/work/src/handler.mjs', sha256: 'd'.repeat(64), range: { start: { line: 12, column: 1 }, end: { line: 12, column: 20 } }, role: 'call' };

const model = {
  module: MODULE,
  export: { name: 'User' },
  snapshotId: 'model-snapshot-1',
  provider: { name: 'zod', version: '4.3.6' },
};

function moduleUseFact({ record: overrides = {}, value: valueOverrides = {} } = {}) {
  const record = {
    schema: 'baton2.context.resolver-record.v1',
    kind: 'modelUse',
    provider: { engine: 'typescript', version: '5.9.3', libraryPath: '/ts/lib/typescript.js', librarySha: 'e'.repeat(64) },
    snapshotId: 'resolver-snapshot-1',
    useSite: USE_SITE,
    module: { path: MODULE.path, sha256: MODULE.sha256 },
    export: 'User',
    resolution: { status: 'resolved', declaration: DECLARATION },
    limits: [],
    ...overrides,
  };
  return {
    id: 'module-use-1',
    kind: 'moduleUse',
    classification: 'static-possible',
    value: {
      record,
      useSiteRef: '["source","/work/src/handler.mjs","dddd",12,1,"callers"]',
      snapshotId: record.snapshotId,
      ...valueOverrides,
    },
    evidence: [],
    limits: [],
  };
}

test('a resolved use of the observed export becomes a model-use relation bound to both snapshots', () => {
  const joined = joinModelUses({ model, uses: [moduleUseFact()] });
  assert.equal(joined.relations.length, 1);
  const relation = joined.relations[0];
  assert.equal(relation.kind, 'modelUse');
  assert.equal(relation.classification, 'static-possible');
  assert.equal(relation.value.form, 'call');
  assert.equal(relation.value.identityBasis, 'declaration-path-and-digest');
  assert.equal(relation.value.resolverSnapshotId, 'resolver-snapshot-1');
  assert.equal(relation.value.modelSnapshotId, 'model-snapshot-1');
  assert.deepEqual(relation.evidence.map(entry => entry.kind), ['source', 'source']);
  assert.equal(relation.evidence[0].sha256, USE_SITE.sha256);
  assert.equal(relation.evidence[0].range.start.line, 12);
  assert.equal(relation.evidence[1].sha256, MODULE.sha256, 'the export declaration evidence carries the compared digest');
  assert.equal(joined.refs.length, 2);
  for (const ref of joined.refs) {
    assert.equal(ref.subject.kind, 'position', 'a public ref uses an admitted selector kind');
    assert.equal(typeof ref.subject.line, 'number');
    assert.equal(ref.subject.path.startsWith('/'), true);
    assert.equal(ref.snapshotId, 'resolver-snapshot-1');
  }
  assert.deepEqual(joined.refs.map(ref => ref.projections[0]).sort(), ['callers', 'definition']);
  assert.equal(joined.limits.length, 0);
  assert.match(joined.joinDigest, /^[0-9a-f]{64}$/);
});

test('a string use-site ref id is an id and never the source of evidence', () => {
  const fact = moduleUseFact();
  fact.value.useSiteRef = 'opaque-id-string';
  const joined = joinModelUses({ model, uses: [fact] });
  assert.equal(joined.relations.length, 1);
  const evidence = joined.relations[0].evidence[0];
  assert.equal(evidence.kind, 'source');
  assert.equal(evidence.path, USE_SITE.path, 'evidence comes from the record site, not from the ref id string');
  assert.equal(joined.relations[0].from, joined.refs[0].id);
  assert.ok(joined.refs[0].id.includes(USE_SITE.path));
});

test('an absent record, snapshot, use site or module refuses with its own code', () => {
  const noRecord = joinModelUses({ model, uses: [{ id: 'x', kind: 'moduleUse', value: { sqlLiteral: { form: 'stringLiteral', text: 'x' } } }] });
  assert.equal(noRecord.relations.length, 0);
  assert.equal(noRecord.limits[0].code, 'recordAbsent');

  const noSnapshot = joinModelUses({ model, uses: [moduleUseFact({ record: { snapshotId: '' } })] });
  assert.equal(noSnapshot.limits[0].code, 'resolverSnapshotAbsent');

  const noSite = joinModelUses({ model, uses: [moduleUseFact({ record: { useSite: { path: '', sha256: '', range: {} } } })] });
  assert.equal(noSite.limits[0].code, 'useSiteAbsent');

  const noModule = joinModelUses({ model, uses: [moduleUseFact({ record: { module: { path: '', sha256: '' } } })] });
  assert.equal(noModule.limits[0].code, 'resolvedModuleIncomplete');

  const noModelSnapshot = joinModelUses({ model: { ...model, snapshotId: null }, uses: [moduleUseFact()] });
  assert.equal(noModelSnapshot.relations.length, 0);
  assert.equal(noModelSnapshot.limits[0].code, 'modelSnapshotAbsent');
});

test('a changed module digest, a declaration outside the module and a different export name each refuse', () => {
  const changedModule = joinModelUses({ model, uses: [moduleUseFact({ record: { module: { path: MODULE.path, sha256: 'f'.repeat(64) } } })] });
  assert.equal(changedModule.relations.length, 0);
  assert.equal(changedModule.limits[0].code, 'modelModuleHashMismatch');

  const elsewhere = joinModelUses({ model, uses: [moduleUseFact({ record: { resolution: { status: 'resolved', declaration: { ...DECLARATION, path: '/work/src/other.mjs' } } } })] });
  assert.equal(elsewhere.limits[0].code, 'exportDeclarationOutsideModule');

  const changedHash = joinModelUses({ model, uses: [moduleUseFact({ record: { resolution: { status: 'resolved', declaration: { ...DECLARATION, sha256: '0'.repeat(64) } } } })] });
  assert.equal(changedHash.limits[0].code, 'exportDeclarationHashMismatch');

  const otherExport = joinModelUses({ model, uses: [moduleUseFact({ record: { export: 'Order' } })] });
  assert.equal(otherExport.limits[0].code, 'modelExportMismatch');

  const otherModule = joinModelUses({ model, uses: [moduleUseFact({ record: { module: { path: '/work/src/other.mjs', sha256: MODULE.sha256 } } })] });
  assert.equal(otherModule.limits[0].code, 'modelModuleMismatch');
});

test('an unresolved or local export resolution refuses and keeps its reason', () => {
  const unresolved = joinModelUses({ model, uses: [moduleUseFact({ record: { resolution: { status: 'unresolved', reason: 'dynamic_import' } } })] });
  assert.equal(unresolved.relations.length, 0);
  assert.equal(unresolved.limits[0].code, 'exportUnresolved');
  assert.match(unresolved.limits[0].detail, /dynamic_import/);

  const local = joinModelUses({ model, uses: [moduleUseFact({ record: { resolution: { status: 'local', reason: 'shadowed_local' } } })] });
  assert.equal(local.limits[0].code, 'exportUnresolved');
});

test('record limits are reported without suppressing an admitted relation', () => {
  const joined = joinModelUses({ model, uses: [moduleUseFact({ record: { limits: ['computed_property_access_untreated'] } })] });
  assert.equal(joined.relations.length, 1);
  assert.equal(joined.limits[0].code, 'recordLimit');
  assert.match(joined.limits[0].detail, /computed_property_access_untreated/);
});

test('a model record without a module or snapshot cannot bind any use edge', () => {
  const joined = joinModelUses({ model: { module: {}, export: { name: 'User' } }, uses: [moduleUseFact()] });
  assert.equal(joined.relations.length, 0);
  assert.equal(joined.limits[0].code, 'modelIdentityAbsent');
});
