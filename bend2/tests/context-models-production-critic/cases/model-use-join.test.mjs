// Model-use join qualification (conductor round14 four unjustified-relation
// cases and the agreed v1 record boundary).
//
// Required checks below assert the required behavior and fail on violations
// against the exercised producer bytes; the historically observed defects
// themselves are demonstrated with exact expectations in
// diagnose/DIAGNOSES.mjs, which never counts toward acceptance. The current
// captured producer bytes (model-use-join.mjs 53b57a18) still consume the
// flat value shape and exhibit the four defects, so these checks fail until
// the consumer adaptation lands.

import { check } from '../lib/harness.mjs';

const MODEL = {
  module: { path: '/work/src/user-model.mjs', realPath: '/work/src/user-model.mjs', sha256: 'a'.repeat(64) },
  export: { name: 'UserSchema', symbolId: 'sym-777' },
  snapshotId: 'model-snap-1',
  provider: { engine: 'zod', version: '4.3.6' },
};

function v1UseRecord({ snapshotId = 'resolver-snap-1', moduleSha = 'a'.repeat(64), exportSha = 'a'.repeat(64), symbolId = 'sym-777', siteRef, withSnapshots = true } = {}) {
  const record = {
    schema: 'baton2.context.resolver-record.v1',
    kind: 'modelUse',
    provider: { engine: 'typescript', version: '5.9.3' },
    snapshotId: withSnapshots ? snapshotId : undefined,
    useSite: siteRef,
    module: { path: MODEL.module.path, sha256: moduleSha },
    export: 'UserSchema',
    resolution: {
      status: 'resolved',
      declaration: { path: MODEL.module.path, sha256: exportSha, range: { start: { line: 7, column: 0 }, end: { line: 7, column: 26 } } },
      symbolId,
    },
    limits: [],
  };
  if (!withSnapshots) delete record.snapshotId;
  return record;
}

function v1Fact(record) {
  return { kind: 'fact', value: { record } };
}

check({
  id: 'modeluse/v1-positive-complete-evidence',
  requirement: 'agreed boundary: ResolverUseRecord v1 with full provenance (symbol identity, module/export sha, snapshot ids, object use site) produces a modelUse relation whose refs and evidence carry no null fields',
  async run({ producer }) {
    const join = producer.modules.models.modelUseJoin.joinModelUses;
    const record = v1UseRecord({
      siteRef: { path: '/work/src/handler.ts', sha256: 'c'.repeat(64), range: { start: { line: 20, column: 2 }, end: { line: 20, column: 30 } }, role: 'call' },
    });
    const result = join({ model: MODEL, uses: [v1Fact(record)] });
    const relation = result.relations[0];
    if (relation === undefined) throw new Error(`v1 fact produced no relation; limits=${JSON.stringify(result.limits)}`);
    for (const item of relation.evidence ?? []) {
      for (const [field, value] of Object.entries(item)) {
        if (value === null) throw new Error(`evidence ${item.kind}.${field} is null`);
      }
    }
    for (const field of ['resolverSnapshotId', 'modelSnapshotId']) {
      if (relation.value?.[field] === null) throw new Error(`relation value ${field} is null`);
    }
    return { from: relation.from, to: relation.to, identityBasis: relation.value?.identityBasis ?? null };
  },
});

check({
  id: 'modeluse/string-site-ref-no-null-evidence',
  requirement: 'round14 case 1: a string siteRef must not become null-valued refs/evidence; consume the object site or refuse with a precise limit (observed 79629c3d emitted [source,null,null,null,null,...])',
  async run({ producer }) {
    const join = producer.modules.models.modelUseJoin.joinModelUses;
    const record = v1UseRecord({ siteRef: '["source","/work/src/handler.ts","cc",20,2,"references"]' });
    const result = join({ model: MODEL, uses: [v1Fact(record)] });
    const relation = result.relations[0];
    if (relation !== undefined) {
      if (String(relation.from).includes('null')) throw new Error(`string siteRef built null-valued ref ${relation.from}`);
      for (const item of relation.evidence ?? []) {
        for (const [field, value] of Object.entries(item)) {
          if (value === null) throw new Error(`evidence ${item.kind}.${field} is null under string siteRef`);
        }
      }
      throw new Error('string siteRef produced a relation instead of a precise refusal');
    }
    if (result.limits.length === 0) throw new Error('string siteRef neither joined correctly nor limited');
    return { limits: result.limits.map(entry => entry.code) };
  },
});

check({
  id: 'modeluse/changed-hashes-refuse',
  requirement: 'round14 case 2: same symbolId with changed module/export sha256 must refuse the join with a precise limit; the old model hash must not be copied into new evidence (observed 79629c3d emitted the relation)',
  async run({ producer }) {
    const join = producer.modules.models.modelUseJoin.joinModelUses;
    const record = v1UseRecord({
      moduleSha: 'd'.repeat(64),
      exportSha: 'd'.repeat(64),
      siteRef: { path: '/work/src/handler.ts', sha256: 'c'.repeat(64), range: { start: { line: 20, column: 2 }, end: { line: 20, column: 30 } }, role: 'call' },
    });
    const result = join({ model: MODEL, uses: [v1Fact(record)] });
    if (result.relations.length !== 0) throw new Error('changed module/export hashes still joined');
    const limited = result.limits.some(entry => entry.code !== 'unsupportedRecordKind');
    if (!limited) throw new Error(`no content-identity limit: ${JSON.stringify(result.limits.map(entry => entry.code))}`);
    return { limits: result.limits.map(entry => entry.code) };
  },
});

check({
  id: 'modeluse/missing-snapshots-limited',
  requirement: 'round14 case 3: missing model/resolver snapshotId must emit a precise limit and no relation; null snapshots must not join (observed 79629c3d emitted null-snapshot relation)',
  async run({ producer }) {
    const join = producer.modules.models.modelUseJoin.joinModelUses;
    const model = structuredClone(MODEL);
    delete model.snapshotId;
    const record = v1UseRecord({
      withSnapshots: false,
      siteRef: { path: '/work/src/handler.ts', sha256: 'c'.repeat(64), range: { start: { line: 20, column: 2 }, end: { line: 20, column: 30 } }, role: 'call' },
    });
    const result = join({ model, uses: [v1Fact(record)] });
    if (result.relations.length !== 0) throw new Error('missing snapshots still joined');
    const limited = result.limits.some(entry => entry.code !== 'unsupportedRecordKind');
    if (!limited) throw new Error(`no snapshot limit: ${JSON.stringify(result.limits.map(entry => entry.code))}`);
    return { limits: result.limits.map(entry => entry.code) };
  },
});

check({
  id: 'modeluse/no-symbol-fallback-refused',
  requirement: 'round14 case 4: without checker symbol identity, matching path/export name alone must NOT join (observed 79629c3d fell back to identityBasis path-and-export-name; the existing producer test blessed this)',
  async run({ producer }) {
    const join = producer.modules.models.modelUseJoin.joinModelUses;
    const model = structuredClone(MODEL);
    delete model.export.symbolId;
    const record = v1UseRecord({ symbolId: undefined, siteRef: { path: '/work/src/handler.ts', sha256: 'c'.repeat(64), range: { start: { line: 20, column: 2 }, end: { line: 20, column: 30 } }, role: 'call' } });
    const result = join({ model, uses: [v1Fact(record)] });
    const relation = result.relations[0];
    if (relation !== undefined && relation.value?.identityBasis === 'path-and-export-name') {
      throw new Error('path/export-name fallback produced a relation');
    }
    if (relation !== undefined && relation.value?.identityBasis !== 'symbol') {
      throw new Error(`relation joined on non-symbol basis ${relation.value?.identityBasis}`);
    }
    if (relation === undefined && result.limits.length === 0) throw new Error('no fallback relation and no precise limit');
    return { relations: result.relations.length, limits: result.limits.map(entry => entry.code) };
  },
});

check({
  id: 'modeluse/symbol-mismatch-refused',
  requirement: 'conductor round18: alias/re-export negatives — a use record resolving a different export symbol must not join the observed model export; unresolved alias chains stay limited',
  async run({ producer }) {
    const join = producer.modules.models.modelUseJoin.joinModelUses;
    const record = v1UseRecord({
      symbolId: 'sym-other-export',
      siteRef: { path: '/work/src/reexport.ts', sha256: 'e'.repeat(64), range: { start: { line: 2, column: 0 }, end: { line: 2, column: 40 } }, role: 'reference' },
    });
    const result = join({ model: MODEL, uses: [v1Fact(record)] });
    const relation = result.relations.find(entry => entry.value?.identityBasis === 'symbol');
    if (relation !== undefined) throw new Error('different symbol identity joined');
    return { relations: result.relations.length, limits: result.limits.map(entry => entry.code) };
  },
});

check({
  id: 'modeluse/public-ref-shape-valid',
  requirement: 'public refs use accepted selector kinds and projections; private tags (source-module) and invented projection tags (modelUse) never appear in public ref IDs (conductor ref-schema correction)',
  async run({ producer }) {
    const join = producer.modules.models.modelUseJoin.joinModelUses;
    const record = v1UseRecord({
      siteRef: { path: '/work/src/handler.ts', sha256: 'c'.repeat(64), range: { start: { line: 20, column: 2 }, end: { line: 20, column: 30 } }, role: 'call' },
    });
    const result = join({ model: MODEL, uses: [v1Fact(record)] });
    const relation = result.relations[0];
    if (relation === undefined) throw new Error(`no relation to inspect: ${JSON.stringify(result.limits)}`);
    const offenders = [];
    for (const refId of [relation.from, relation.to, ...result.refs.map(ref => ref.id)]) {
      let parsed;
      try { parsed = JSON.parse(refId); } catch { offenders.push({ refId, reason: 'not a canonical JSON array' }); continue; }
      const kind = parsed[0];
      const projection = parsed[parsed.length - 1];
      const acceptedKinds = ['source', 'symbol', 'diagnostic', 'entity', 'model', 'schema', 'security', 'migration', 'program', 'dataset', 'runtime', 'query-control', 'ref'];
      const acceptedSourceProjections = ['definition', 'type', 'references', 'calls', 'callers', 'dependencies', 'diagnostics', 'flow', 'exceptions', 'databaseAccesses', 'authorization'];
      if (!acceptedKinds.includes(kind)) offenders.push({ refId, reason: `invented selector kind ${kind}` });
      if (kind === 'source' && !acceptedSourceProjections.includes(projection)) offenders.push({ refId, reason: `invented source projection ${projection}` });
    }
    if (offenders.length > 0) throw new Error(`invalid public refs: ${JSON.stringify(offenders)}`);
    return { from: relation.from, to: relation.to };
  },
});
