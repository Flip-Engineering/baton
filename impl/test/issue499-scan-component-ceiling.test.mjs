import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PublicSupplyChainOracle } from '../src/index.mjs';

// Issue #499 — the oracle's default maxScanComponents of 256 refused an ordinary
// lockfile: a single-package npm package-lock commonly carries 1,000+ components, so
// the default admission bound refused real, common input before any provider call.
// The ceiling is an admission/memory bound (each coordinate is bounded text, ~1.1 KB
// worst case); the scan's time cost is bounded by maxScanWallMs, which refuses a scan
// that cannot finish as oracle_timeout. These rows pin the repaired default end to
// end: a 300-component scan completes over the real batching and replay seams, and a
// manifest past the new default still refuses at admission.

const root = (name) => mkdtempSync(join(tmpdir(), `baton-499-${name}-`));
const response = (value) => {
  const raw = Buffer.from(JSON.stringify(value));
  return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => raw };
};
const coordinate = (packageName, version = '1.0.0') => ({ ecosystem: 'npm', package: packageName, version });
const lockfile = (count) => Array.from({ length: count }, (_, index) => coordinate(`pkg-${String(index).padStart(5, '0')}`));

// One result per query, no advisories: the response shape _normalizeScanBatch admits.
const querybatchFetch = (calls) => async (_url, init) => {
  const body = JSON.parse(init.body);
  calls.push(body.queries.length);
  return response({ results: body.queries.map(() => ({})) });
};

test('499-a: the default ceiling admits an ordinary lockfile-sized scan end to end', async () => {
  const calls = [];
  const oracle = new PublicSupplyChainOracle({ fetch: querybatchFetch(calls), artifactRoot: root('default'), timeoutMs: 5_000 });
  const scan = await oracle.scan({ coordinates: lockfile(300) });
  assert.equal(scan.coordinates.length, 300, 'all 300 coordinates are scanned');
  assert.equal(scan.results.length, 300, 'every coordinate gets a positional result');
  assert.deepEqual(calls, [100, 100, 100], 'the scan rides three 100-query batches');
  const replay = await oracle.verifyScan(scan);
  assert.equal(replay.ok, true, `the scan replays against its own artifacts (got ${replay.reason ?? 'ok'})`);
});

test('499-b: the default ceiling still refuses a manifest past the admission bound', async () => {
  const oracle = new PublicSupplyChainOracle({ fetch: querybatchFetch([]), artifactRoot: root('overflow'), timeoutMs: 5_000 });
  const over = oracle.card().ceilings.maxScanComponents + 1;
  await assert.rejects(() => oracle.scan({ coordinates: lockfile(over) }), (error) => error.code === 'invalid_package_identity');
});

test('499-c: the card publishes the repaired default so the quartermaster cross-check agrees', async () => {
  const oracle = new PublicSupplyChainOracle({ fetch: querybatchFetch([]), artifactRoot: root('card'), timeoutMs: 5_000 });
  assert.ok(oracle.card().ceilings.maxScanComponents >= 1_000,
    `the default admits an ordinary lockfile (got ${oracle.card().ceilings.maxScanComponents})`);
  assert.equal(oracle.card().ceilings.maxBatchSize, 100, 'batch size stays derived from the transaction envelope');
});
