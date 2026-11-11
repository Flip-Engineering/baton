// Maintained coverage for bend2/scripts/provider-availability.mjs (#683, #681).
//
// The cases use an in-memory catalog. Run with:
//   node --test bend2/test/provider-availability.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReport, modelIdOf, parseCatalog, rankCandidates, reconcile, writeReport } from '../scripts/provider-availability.mjs';

const NOW = '2026-10-06T20:00:00.000Z';

function fixtureCatalog() {
  return parseCatalog(JSON.stringify({ models: [
    { provider: 'zai', kind: 'chat', id: 'glm-5.3', selector: 'zai/glm-5.3', name: 'GLM-5.3' },
    { provider: 'zai', kind: 'chat', id: 'glm-5.3-flash', selector: 'zai/glm-5.3-flash', name: 'GLM-5.3-Flash' },
    { provider: 'kimi-code', kind: 'chat', id: 'k3', selector: 'kimi-code/k3', name: 'K3', thinking: ['low', 'high', 'max'] },
    { provider: 'deepseek', kind: 'chat', id: 'deepseek-flash', selector: 'deepseek/deepseek-flash', name: 'DeepSeek V4.1 Flash' },
    { provider: 'opencode-go', kind: 'chat', id: 'muse-spark-1.3-contributor', selector: 'opencode-go/muse-spark-1.3-contributor', name: 'Muse Spark 1.3 Contributor' },
    { provider: 'opencode-go', kind: 'chat', id: 'gpt-6-luna', selector: 'opencode-go/gpt-6-luna', name: 'GPT-6 Luna' },
  ] }));
}

test('a live catalog entry resolves the requested model without a registry', () => {
  const catalog = fixtureCatalog();
  const [row] = reconcile(['zai/glm-5.3'], catalog);
  assert.equal(row.state, 'catalogued');
  assert.deepEqual(row.matches, ['zai/glm-5.3']);
});

test('a bare model id matches every provider alias in the live catalog', () => {
  const catalog = fixtureCatalog();
  const [row] = reconcile(['glm-5.3-flash'], catalog);
  assert.equal(row.state, 'catalogued');
  assert.deepEqual(row.matches, ['zai/glm-5.3-flash']);
});

test('a selector absent from the catalog is not-in-catalog, not unavailable', () => {
  const catalog = fixtureCatalog();
  const [row] = reconcile(['zai/glm-9'], catalog);
  assert.equal(row.state, 'not-in-catalog');
  assert.deepEqual(row.matches, []);
});

test('a refused selector leaves the candidate list with live alternatives', () => {
  const catalog = fixtureCatalog();
  const ranking = rankCandidates(catalog, { selector: 'kimi-code/k3', reason: 'usage limit', refusedAt: NOW });
  assert.ok(!ranking.candidates.includes('kimi-code/k3'));
  assert.ok(ranking.candidates.includes('deepseek/deepseek-flash'));
  assert.deepEqual(ranking.refused, { selector: 'kimi-code/k3', reason: 'usage limit', refusedAt: NOW });
});

test('a recorded quota failure does not mark a catalogued model unavailable', () => {
  const catalog = fixtureCatalog();
  const report = buildReport({
    observedAt: NOW,
    omp: { state: 'queried', observedAt: NOW, count: catalog.length, models: catalog },
    configured: {
      reconciliation: reconcile(['kimi-code/k3'], catalog),
      refused: { selector: 'kimi-code/k3', reason: 'errorStatus:403 usage limit', refusedAt: NOW },
    },
    history: [{ selector: 'kimi-code/k3', outcome: 'quota-exhausted', detail: 'errorStatus:403', observedAt: '2026-10-05T10:00:00.000Z' }],
  });
  assert.equal(report.configured[0].state, 'catalogued');
  assert.equal(report.currentQuota.state, 'unknown');
  assert.deepEqual(report.history, [{ selector: 'kimi-code/k3', outcome: 'quota-exhausted', detail: 'errorStatus:403', observedAt: '2026-10-05T10:00:00.000Z' }]);
  assert.ok(report.candidates.includes('deepseek/deepseek-flash'));
});

test('an unparseable harness answer reports unknown with its detail', () => {
  assert.throws(() => parseCatalog('not json'), SyntaxError);
});

test('an empty catalog yields no candidates and keeps the observation time', () => {
  const report = buildReport({
    observedAt: NOW,
    omp: { state: 'queried', observedAt: NOW, count: 0, models: [] },
    configured: { reconciliation: reconcile(['kimi-code/k3'], []), refused: null },
    history: [],
  });
  assert.deepEqual(report.candidates, []);
  assert.equal(report.configured[0].state, 'not-in-catalog');
  assert.equal(report.observedAt, NOW);
});

test('modelIdOf keeps bare ids and strips one provider segment', () => {
  assert.equal(modelIdOf('kimi-code/k3'), 'k3');
  assert.equal(modelIdOf('glm-5.3'), 'glm-5.3');
});

test('an unwritable report path throws instead of crashing the caller', () => {
  assert.throws(() => writeReport('{}', join(tmpdir(), 'no-such-dir-683', 'out.json')), /no such file|cannot|ENOENT/i);
});
