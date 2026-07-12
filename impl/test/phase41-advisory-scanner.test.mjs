import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PublicSupplyChainOracle } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase41-${name}-`));
const response = (value, status = 200) => {
  const raw = Buffer.from(JSON.stringify(value));
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, arrayBuffer: async () => raw };
};
const coordinate = (packageName, version = '1.0.0') => ({ ecosystem: 'npm', package: packageName, version });
const advisory = (id, modified = '2026-07-12T00:00:00Z') => ({ id, modified });
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const sha = (value) => createHash('sha256').update(value).digest('hex');

test('AS1/AS2: card exposes deployment scanner identity and scan canonicalizes, batches, and positionally binds exact npm coordinates', async () => {
  const calls = []; const artifactRoot = root('basic');
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url: String(url), init, body });
    return response({ results: body.queries.map((query, index) => ({ vulns: [advisory(`OSV-${query.package.name}-${index}`)] })) });
  };
  const oracle = new PublicSupplyChainOracle({ fetch, artifactRoot, scannerId: 'deployment-a:osv', now: () => Date.parse('2026-07-12T12:00:00Z'), maxScanComponents: 5, maxBatchSize: 2, maxScanAdvisories: 8, maxResponseBytes: 64 * 1024, timeoutMs: 1_000 });
  assert.deepEqual(oracle.card().scan, { scannerId: 'deployment-a:osv', provider: 'osv.dev', operation: 'QueryBatch', method: 'POST', url: 'https://api.osv.dev/v1/querybatch', ecosystem: 'npm', versionSemantics: 'exact_input_provider_fuzzy_match' });
  assert.deepEqual(oracle.card().ceilings, { maxScanComponents: 5, maxBatchSize: 2, maxScanAdvisories: 8, maxResponseBytes: 64 * 1024, maxTransactionBytes: 262_144, perResponseTimeoutMs: 1_000, maxScanWallMs: 30_000 });
  const scan = await oracle.scan({ coordinates: [coordinate('zeta'), coordinate('alpha', '2.0.0'), coordinate('alpha'), coordinate('alpha')] });
  assert.deepEqual(scan.coordinates, [coordinate('alpha'), coordinate('alpha', '2.0.0'), coordinate('zeta')]);
  assert.deepEqual(scan.batches.map(({ offset, count }) => ({ offset, count })), [{ offset: 0, count: 2 }, { offset: 2, count: 1 }]);
  assert.equal(calls.length, 2); assert.equal(calls.every((call) => call.url === 'https://api.osv.dev/v1/querybatch' && call.init.method === 'POST' && call.init.redirect === 'error'), true);
  assert.deepEqual(calls[0].body, { queries: [{ package: { ecosystem: 'npm', name: 'alpha' }, version: '1.0.0' }, { package: { ecosystem: 'npm', name: 'alpha' }, version: '2.0.0' }] });
  assert.equal(scan.results[0].coordinate.package, 'alpha'); assert.equal(scan.results[0].advisories[0].id, 'OSV-alpha-0');
  assert.equal(scan.results[2].coordinate.package, 'zeta'); assert.equal(scan.results[2].advisories[0].id, 'OSV-zeta-0');
  assert.equal(scan.observedAt, '2026-07-12T12:00:00.000Z'); assert.equal(JSON.stringify(JSON.parse(JSON.stringify(scan))), JSON.stringify(scan));
  assert.equal(scan.sources.every((source) => existsSync(join(artifactRoot, `${source.digest}.scan.json`))), true);
  assert.equal(existsSync(join(artifactRoot, `${scan.session.digest}.session.json`)), true);
  assert.equal(scan.batches.every((batch, index) => batch.sourceDigest === scan.sources[index].digest), true);
});

test('AS3: verifyScan is zero-network semantic replay over private raw CAS and rejects claim/source substitution', async () => {
  let calls = 0; const artifactRoot = root('verify');
  const oracle = new PublicSupplyChainOracle({
    artifactRoot, scannerId: 'scanner-replay', maxScanComponents: 4, maxBatchSize: 1, maxScanAdvisories: 8, timeoutMs: 1_000, maxResponseBytes: 16 * 1024,
    fetch: async () => { calls += 1; return response({ results: [{ vulns: [advisory('OSV-z'), advisory('OSV-a')] }] }); },
  });
  const scan = await oracle.scan({ coordinates: [coordinate('beta'), coordinate('alpha')] }); const afterScan = calls;
  const verified = oracle.verifyScan(JSON.parse(JSON.stringify(scan)));
  assert.equal(verified.ok, true); assert.deepEqual(verified.normalized, scan); assert.equal(calls, afterScan);
  assert.deepEqual(verified.normalized.results[0].advisories, [{ id: 'OSV-a', modified: '2026-07-12T00:00:00Z' }, { id: 'OSV-z', modified: '2026-07-12T00:00:00Z' }]);
  const forged = structuredClone(scan); forged.results[0].advisories[0].id = 'FORGED'; assert.deepEqual(oracle.verifyScan(forged), { ok: false, reason: 'scan_semantic_mismatch' });
  const reordered = structuredClone(scan); reordered.coordinates.reverse(); assert.deepEqual(oracle.verifyScan(reordered), { ok: false, reason: 'scan_coordinate_order' });
  const retimed = structuredClone(scan); retimed.observedAt = '2099-01-01T00:00:00Z'; assert.deepEqual(oracle.verifyScan(retimed), { ok: false, reason: 'scan_transaction_invalid' });
  const span = structuredClone(scan); span.batches[0].count = 2; assert.equal(oracle.verifyScan(span).ok, false);
  const responseOversize = structuredClone(scan); const oldSource = responseOversize.sources[0]; const transaction = JSON.parse(readFileSync(join(artifactRoot, `${oldSource.digest}.scan.json`)));
  const responseRaw = Buffer.from(`${JSON.stringify({ results: [{ vulns: [advisory('OSV-z'), advisory('OSV-a')] }] })}${' '.repeat(17_000)}`); const responseDigest = sha(responseRaw); writeFileSync(join(artifactRoot, `${responseDigest}.json`), responseRaw);
  transaction.response = { handle: `art:sha256:${responseDigest}`, digest: responseDigest, bytes: responseRaw.length, mediaType: 'application/json' };
  const transactionRaw = Buffer.from(`${stable(transaction)}\n`); const transactionDigest = sha(transactionRaw); writeFileSync(join(artifactRoot, `${transactionDigest}.scan.json`), transactionRaw);
  responseOversize.sources[0] = { ...oldSource, handle: `art:sha256:${transactionDigest}`, digest: transactionDigest, bytes: transactionRaw.length }; responseOversize.batches[0].sourceDigest = transactionDigest;
  const sessionValue = JSON.parse(readFileSync(join(artifactRoot, `${responseOversize.session.digest}.session.json`))); sessionValue.batches[0].sourceDigest = transactionDigest; sessionValue.sourceDigests[0] = transactionDigest;
  const sessionRaw = Buffer.from(`${stable(sessionValue)}\n`); const sessionDigest = sha(sessionRaw); writeFileSync(join(artifactRoot, `${sessionDigest}.session.json`), sessionRaw); responseOversize.session = { ...responseOversize.session, handle: `art:sha256:${sessionDigest}`, digest: sessionDigest, bytes: sessionRaw.length };
  assert.deepEqual(oracle.verifyScan(responseOversize), { ok: false, reason: 'scan_response_oversize' });
  const envelopeOversize = structuredClone(scan); envelopeOversize.sources[0].bytes = oracle.maxTransactionBytes + 1;
  assert.deepEqual(oracle.verifyScan(envelopeOversize), { ok: false, reason: 'scan_transaction_oversize' });
  const source = scan.sources[0]; writeFileSync(join(artifactRoot, `${source.digest}.scan.json`), `${readFileSync(join(artifactRoot, `${source.digest}.scan.json`), 'utf8')} `);
  assert.deepEqual(oracle.verifyScan(scan), { ok: false, reason: 'source_digest_mismatch' }); assert.equal(calls, afterScan);
});

test('AS3: request-response transaction envelope rejects cross-coordinate raw CAS splicing', async () => {
  const artifactRoot = root('splice');
  const oracle = new PublicSupplyChainOracle({ artifactRoot, maxScanComponents: 2, maxBatchSize: 1, fetch: async (_url, init) => { const name = JSON.parse(init.body).queries[0].package.name; return response({ results: [{ vulns: [advisory(`OSV-${name}`)] }] }); } });
  const alpha = await oracle.scan({ coordinates: [coordinate('alpha')] }); const beta = await oracle.scan({ coordinates: [coordinate('beta')] });
  const forged = structuredClone(alpha); forged.sources[0] = beta.sources[0]; forged.batches[0].sourceDigest = beta.sources[0].digest; forged.results = beta.results.map((row) => ({ ...row, coordinate: coordinate('alpha') }));
  assert.deepEqual(oracle.verifyScan(forged), { ok: false, reason: 'scan_transaction_invalid' });
  const temporal = structuredClone(alpha); temporal.session = beta.session; assert.equal(oracle.verifyScan(temporal).ok, false);
});

test('AS4: scan rejects non-exact/unsupported coordinates, component overflow, result-count drift, pagination, and malformed advisory identity/time', async () => {
  const make = (value, opts = {}) => new PublicSupplyChainOracle({ fetch: async () => response(value), artifactRoot: root('schema'), timeoutMs: 100, maxResponseBytes: 16 * 1024, maxScanComponents: opts.maxScanComponents ?? 2, maxBatchSize: opts.maxBatchSize ?? 2, maxScanAdvisories: opts.maxScanAdvisories ?? 4 });
  const valid = make({ results: [{ vulns: [] }] });
  for (const bad of [coordinate('pkg', '^1.0.0'), { ecosystem: 'pypi', package: 'pkg', version: '1.0.0' }, { ...coordinate('pkg'), extra: true }]) await assert.rejects(() => valid.scan({ coordinates: [bad] }), (error) => error.code === 'invalid_package_identity');
  await assert.rejects(() => valid.scan({ coordinates: [coordinate('a'), coordinate('b'), coordinate('c')] }), (error) => error.code === 'invalid_package_identity');
  await assert.rejects(() => make({ results: [] }).scan({ coordinates: [coordinate('a')] }), (error) => error.code === 'oracle_schema_invalid');
  await assert.rejects(() => make({ results: [{ vulns: [] }], next_page_token: 'more' }).scan({ coordinates: [coordinate('a')] }), (error) => error.code === 'oracle_incomplete');
  await assert.rejects(() => make({ results: [{ vulns: [], next_page_token: 'more' }] }).scan({ coordinates: [coordinate('a')] }), (error) => error.code === 'oracle_incomplete');
  await assert.rejects(() => make({ results: [{ vulns: [] }], extra: true }).scan({ coordinates: [coordinate('a')] }), (error) => error.code === 'oracle_schema_invalid');
  await assert.rejects(() => make({ results: [{ vulns: [], extra: true }] }).scan({ coordinates: [coordinate('a')] }), (error) => error.code === 'oracle_schema_invalid');
  for (const bad of [{ modified: '2026-01-01T00:00:00Z' }, { id: 'OSV-x', modified: 'not-a-time' }, { id: 'OSV-x', modified: '2026-01-01' }, { id: 'OSV-x', modified: null }, { id: 'OSV-x', modified: '2026-01-01T01:00:00+01:00' }, { id: 'OSV-x', modified: '2026-02-30T00:00:00Z' }, { id: 'OSV-x', modified: '2026-01-01T24:00:00Z' }, { id: '', modified: '2026-01-01T00:00:00Z' }, { id: ' OSV-x', modified: '2026-01-01T00:00:00Z' }]) {
    await assert.rejects(() => make({ results: [{ vulns: [bad] }] }).scan({ coordinates: [coordinate('a')] }), (error) => error.code === 'oracle_schema_invalid');
  }
  await assert.rejects(() => make({ results: [{ vulns: [advisory('OSV-dup'), advisory('OSV-dup')] }] }).scan({ coordinates: [coordinate('a')] }), (error) => error.code === 'oracle_schema_invalid');
});

test('AS5: response bytes, cumulative advisory count, outage, timeout, and cancellation fail closed across split batches', async () => {
  const oversized = new PublicSupplyChainOracle({ fetch: async () => response({ results: [{ vulns: [], padding: 'x'.repeat(1_000) }] }), artifactRoot: root('oversize'), timeoutMs: 100, maxResponseBytes: 100, maxScanComponents: 2, maxBatchSize: 2, maxScanAdvisories: 4 });
  await assert.rejects(() => oversized.scan({ coordinates: [coordinate('a')] }), (error) => error.code === 'oracle_response_oversize');
  const counted = new PublicSupplyChainOracle({ fetch: async () => response({ results: [{ vulns: [advisory('OSV-1'), advisory('OSV-2')] }] }), artifactRoot: root('count'), timeoutMs: 100, maxResponseBytes: 16 * 1024, maxScanComponents: 2, maxBatchSize: 1, maxScanAdvisories: 3 });
  await assert.rejects(() => counted.scan({ coordinates: [coordinate('a'), coordinate('b')] }), (error) => error.code === 'oracle_response_oversize');
  const unavailable = new PublicSupplyChainOracle({ fetch: async () => response({}, 503), artifactRoot: root('unavailable'), timeoutMs: 100, maxResponseBytes: 1024 });
  await assert.rejects(() => unavailable.scan({ coordinates: [coordinate('a')] }), (error) => error.code === 'oracle_unavailable');
  const hangingFetch = async (_url, init) => new Promise((_resolve, reject) => {
    if (init.signal.aborted) reject(new Error('aborted')); else init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const timing = new PublicSupplyChainOracle({ fetch: hangingFetch, artifactRoot: root('timing'), timeoutMs: 5, maxResponseBytes: 1024 });
  await assert.rejects(() => timing.scan({ coordinates: [coordinate('a')] }), (error) => error.code === 'oracle_timeout');
  const wall = new PublicSupplyChainOracle({ fetch: hangingFetch, artifactRoot: root('wall'), timeoutMs: 100, maxScanWallMs: 5, maxResponseBytes: 1024 });
  await assert.rejects(() => wall.scan({ coordinates: [coordinate('a')] }), (error) => error.code === 'oracle_timeout');
  const controller = new AbortController(); controller.abort('stop');
  await assert.rejects(() => timing.scan({ coordinates: [coordinate('a')] }, { signal: controller.signal }), (error) => error.code === 'cancelled');
  const abortingFetch = async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
  const domTimeout = new PublicSupplyChainOracle({ fetch: abortingFetch, artifactRoot: root('dom-timeout'), timeoutMs: 5 });
  await assert.rejects(() => domTimeout.scan({ coordinates: [coordinate('a')] }), (error) => error.code === 'oracle_timeout');
  const domCancel = new PublicSupplyChainOracle({ fetch: abortingFetch, artifactRoot: root('dom-cancel'), timeoutMs: 100 }); const domController = new AbortController();
  const pending = domCancel.scan({ coordinates: [coordinate('a')] }, { signal: domController.signal }); domController.abort(); await assert.rejects(pending, (error) => error.code === 'cancelled');
  const domWall = new PublicSupplyChainOracle({ fetch: abortingFetch, artifactRoot: root('dom-wall'), timeoutMs: 100, maxScanWallMs: 5 });
  await assert.rejects(() => domWall.scan({ coordinates: [coordinate('a')] }), (error) => error.code === 'oracle_timeout');
});

test('AS6: constructor defaults preserve vet compatibility while validating scanner ceilings', async () => {
  const oracle = new PublicSupplyChainOracle({ fetch: async (url) => String(url).includes('api.osv.dev') ? response({ vulns: [] }) : response({ versionKey: { system: 'NPM', name: 'pkg', version: '1.0.0' }, advisoryKeys: [] }), artifactRoot: root('compat') });
  assert.deepEqual(oracle.card().ceilings, { maxScanComponents: 256, maxBatchSize: 100, maxScanAdvisories: 1_000, maxResponseBytes: 1_048_576, maxTransactionBytes: 262_144, perResponseTimeoutMs: 5_000, maxScanWallMs: 30_000 });
  const narrowed = new PublicSupplyChainOracle({ fetch: async () => response({ results: [] }), artifactRoot: root('narrowed'), maxScanComponents: 4 }); assert.equal(narrowed.card().ceilings.maxBatchSize, 4);
  const vetted = await oracle.vet({ ecosystem: 'npm', package: 'pkg', version: '1.0.0' }); assert.deepEqual(vetted.requested, coordinate('pkg'));
  assert.throws(() => new PublicSupplyChainOracle({ fetch: async () => response({}), artifactRoot: root('bad-batch'), maxScanComponents: 1, maxBatchSize: 2 }), /maxBatchSize/);
  assert.throws(() => new PublicSupplyChainOracle({ fetch: async () => response({}), artifactRoot: root('bad-advisories'), maxScanAdvisories: 0 }), /maxScanAdvisories/);
  assert.throws(() => new PublicSupplyChainOracle({ fetch: async () => response({}), artifactRoot: root('bad-transactions'), maxTransactionBytes: 0 }), /maxTransactionBytes/);
  assert.throws(() => new PublicSupplyChainOracle({ fetch: async () => response({}), artifactRoot: root('bad-id'), scannerId: '' }), /scannerId/);
});

test('AS7: an empty exact graph yields a replayable zero-call manifest rather than an invented provider result', async () => {
  let calls = 0; const oracle = new PublicSupplyChainOracle({ artifactRoot: root('empty'), fetch: async () => { calls += 1; throw new Error('must not fetch'); } });
  const scan = await oracle.scan({ coordinates: [] });
  assert.deepEqual(scan.coordinates, []); assert.deepEqual(scan.results, []); assert.deepEqual(scan.batches, []); assert.deepEqual(scan.sources, []); assert.equal(scan.session.operation, 'ScanSession'); assert.equal(calls, 0);
  assert.deepEqual(oracle.verifyScan(scan), { ok: true, normalized: scan });
});
