// Mutation control for the critic fixtures (foreign-execution flavor).
//
// Each mutation is a deliberately defective twin of one discriminated rule.
// Running the twin through the same assertion logic the case files use must
// FAIL. A twin that passes its assertions marks a fixture sensitivity gap.
//
//   node bend2/tests/context-models-production-critic/mutation/run-mutations.mjs

import { strict as assert } from 'node:assert';

// Mutation 1: the removed researcher name-equality origin fallback.
function originByNameFallback({ resultName, columns }) {
  const match = columns.find(column => column.name === resultName);
  if (match !== undefined) {
    return { availability: 'available', tier: 'origin-metadata', columns: [{ resultName, table: match.table, column: match.name }] };
  }
  return { availability: 'unavailable', reason: 'originCapabilityUnqualified', columns: [] };
}

// Mutation 2: catalog freshness that treats data_version movement as staleness.
function compareWithFreshnessDataVersion(before, after) {
  const changed = [];
  if (before.catalogDigest !== after.catalogDigest) changed.push('catalogDigest');
  if (before.dataVersion !== after.dataVersion) changed.push('dataVersion');
  return { applicability: changed.length === 0 ? 'current' : 'stale', changedInputs: changed };
}

// Mutation 3: a JSON.parse-based dataset value layer (rounds beyond-double integers).
function datasetTokenViaJsonParse(text, pointer) {
  const value = pointer.split('/').filter(Boolean).reduce((node, key) => node[key], JSON.parse(text));
  return { kind: 'number', token: String(value) };
}

const results = [];

// 1: the consumer boundary must refuse the fabricated origin.
try {
  const fabricated = originByNameFallback({ resultName: 'id', columns: [{ table: 'users', name: 'id' }] });
  assert.equal(fabricated.availability, 'unavailable', 'name-equality fallback must be refused');
  results.push({ id: 'origin-name-equality-fallback', detected: false, reason: 'twin output accepted: fixture cannot detect the fallback' });
} catch {
  results.push({ id: 'origin-name-equality-fallback', detected: true });
}

// 2: freshness must stay current across a data-only write.
try {
  const comparison = compareWithFreshnessDataVersion(
    { catalogDigest: 'same', dataVersion: 11 },
    { catalogDigest: 'same', dataVersion: 12 },
  );
  assert.equal(comparison.applicability, 'current', 'data-only write must keep applicability current');
  results.push({ id: 'freshness-includes-dataversion', detected: false, reason: 'twin marked a data-only write stale without detection' });
} catch {
  results.push({ id: 'freshness-includes-dataversion', detected: true });
}

// 3: dataset tokens must survive exactly.
try {
  const text = '{"beyondDouble":9007199254740993}';
  const observed = datasetTokenViaJsonParse(text, '/beyondDouble');
  assert.equal(observed.token, '9007199254740993', 'exact token must survive');
  results.push({ id: 'dataset-json-parse-rounding', detected: false, reason: `twin produced ${observed.token} and passed` });
} catch {
  results.push({ id: 'dataset-json-parse-rounding', detected: true });
}

console.log(JSON.stringify({ mutationControl: results }, null, 2));
process.exit(results.every(entry => entry.detected) ? 0 : 1);
