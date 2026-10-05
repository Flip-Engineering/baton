// Exact-defect diagnostics for known producer defects.
//
// These run ONLY through diagnose/run.mjs and never count toward suite
// acceptance. Each diagnostic constructs the defective input against the
// captured producer bytes and asserts the EXACT historically observed
// defect. When the producer fixes the behavior the diagnostic reports
// defect-absent instead of reproducing, which is a change of source, not an
// acceptance event.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DIAGNOSES = [
  {
    id: 'modeluse/path-name-fallback',
    finding: 'round14 case 4: joinModelUses joined on path and export name when no checker symbol existed',
    sourceExpectation: 'identityBasis exactly "path-and-export-name" on one emitted relation',
    async run(producer) {
      const { joinModelUses } = producer.modules.models.modelUseJoin;
      const model = { module: { path: '/work/m.mjs', sha256: 'a'.repeat(64) }, export: { name: 'UserSchema' }, snapshotId: 'model-snap-1' };
      const use = { kind: 'moduleUse', snapshotId: 'resolver1', value: { module: { resolvedPath: '/work/m.mjs', sha256: 'a'.repeat(64) }, export: { name: 'UserSchema' }, uses: [{ siteRef: { path: '/work/u.ts', sha256: 'c'.repeat(64), range: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } } } }] } };
      const result = joinModelUses({ model, uses: [use] });
      const relation = result.relations[0];
      const reproduced = relation !== undefined && relation.value?.identityBasis === 'path-and-export-name';
      return { reproduced, observed: relation?.value?.identityBasis ?? null, relations: result.relations.length };
    },
  },
  {
    id: 'modeluse/string-siteref-null-evidence',
    finding: 'round14 case 1: a string siteRef produced [source,null,null,...] public evidence',
    sourceExpectation: 'one relation whose evidence[0].path, .sha256 and .range are all null',
    async run(producer) {
      const { joinModelUses } = producer.modules.models.modelUseJoin;
      const model = { module: { path: '/work/m.mjs', sha256: 'a'.repeat(64) }, export: { name: 'UserSchema', symbolId: 's1' }, snapshotId: 'model-snap-1' };
      const use = { kind: 'moduleUse', snapshotId: 'resolver1', value: { module: { resolvedPath: '/work/m.mjs', sha256: 'a'.repeat(64) }, export: { name: 'UserSchema', symbolId: 's1' }, uses: [{ siteRef: '["source","/work/u.ts","cc",1,0,"references"]' }] } };
      const result = joinModelUses({ model, uses: [use] });
      const relation = result.relations[0];
      const evidence = relation?.evidence?.[0];
      const reproduced = evidence !== undefined && evidence.path === null && evidence.sha256 === null && evidence.range === null;
      return { reproduced, observed: evidence ?? null, relations: result.relations.length };
    },
  },
  {
    id: 'modeluse/changed-hash-still-joins',
    finding: 'round14 case 2: same symbolId with changed module/export sha256 still emitted a relation copying the old model hash',
    sourceExpectation: 'one relation whose evidence[1].sha256 equals the OLD model hash aaaa... while the record carried dddd...',
    async run(producer) {
      const { joinModelUses } = producer.modules.models.modelUseJoin;
      const model = { module: { path: '/work/m.mjs', sha256: 'a'.repeat(64) }, export: { name: 'UserSchema', symbolId: 's1' }, snapshotId: 'model-snap-1' };
      const use = { kind: 'moduleUse', snapshotId: 'resolver1', value: { module: { resolvedPath: '/work/m.mjs', sha256: 'd'.repeat(64) }, export: { name: 'UserSchema', symbolId: 's1', sha256: 'd'.repeat(64) }, uses: [{ siteRef: { path: '/work/u.ts', sha256: 'c'.repeat(64), range: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } } } }] } };
      const result = joinModelUses({ model, uses: [use] });
      const relation = result.relations[0];
      const evidence = relation?.evidence?.find(entry => entry.kind === 'document');
      const reproduced = relation !== undefined && evidence !== undefined && evidence.sha256 === 'a'.repeat(64);
      return { reproduced, observed: evidence?.sha256 ?? null, relations: result.relations.length };
    },
  },
  {
    id: 'modeluse/missing-snapshots-null-relation',
    finding: 'round14 case 3: missing snapshot ids still emitted a relation with null resolverSnapshotId and modelSnapshotId',
    sourceExpectation: 'one relation with identityBasis "symbol" and both snapshot fields null',
    async run(producer) {
      const { joinModelUses } = producer.modules.models.modelUseJoin;
      const model = { module: { path: '/work/m.mjs', sha256: 'a'.repeat(64) }, export: { name: 'UserSchema', symbolId: 's1' } };
      const use = { kind: 'moduleUse', value: { module: { resolvedPath: '/work/m.mjs', sha256: 'a'.repeat(64) }, export: { name: 'UserSchema', symbolId: 's1' }, uses: [{ siteRef: { path: '/work/u.ts', sha256: 'c'.repeat(64), range: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } } } }] } };
      const result = joinModelUses({ model, uses: [use] });
      const relation = result.relations[0];
      const reproduced = relation !== undefined
        && relation.value?.identityBasis === 'symbol'
        && relation.value?.resolverSnapshotId === null
        && relation.value?.modelSnapshotId === null;
      return { reproduced, observed: relation?.value ?? null, relations: result.relations.length };
    },
  },
];

export async function runDiagnoses(producerRootLoader, selected = null) {
  const producer = await producerRootLoader();
  const outcomes = [];
  for (const diagnosis of DIAGNOSES) {
    if (selected !== null && !selected.includes(diagnosis.id)) continue;
    try {
      const outcome = await diagnosis.run(producer);
      outcomes.push({ id: diagnosis.id, finding: diagnosis.finding, sourceExpectation: diagnosis.sourceExpectation, ...outcome });
    } catch (error) {
      outcomes.push({ id: diagnosis.id, finding: diagnosis.finding, error: String(error.message) });
    }
  }
  return outcomes;
}

export function diagnosisEntrypointPath() {
  return pathToFileURL(join(import.meta.dirname, 'run.mjs')).href;
}
