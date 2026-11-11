import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test as nodeTest } from 'node:test';
import { encode, decode, sha256, validateBake } from '../lib/fx/anatomy/fine/fine_codec.mjs';
import { withFineCache, cachedBake, FINE_TOKEN } from '../lib/fx/anatomy/fine/fine_cache_client.mjs';

const budget = 2 ** 20;
async function test(name, fn) { return nodeTest(name, fn); }
function bakeResult(seed = 3) {
  return { W: 2, H: 1, h: new Float32Array([seed, 2]), grad: new Float32Array([1, 2, 3, 4]),
    cav: new Float32Array([5, 6]), mask: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    cov: new Uint8Array([9, 10]), pos: null, hLo: null, hHi: null, cavHi: null, vHi: null, voHi: null, fHi: null,
    report: { grid: [2, 1], ms: { bake: 17 }, note: 'complete-result' } };
}
function bytes(x) { return new Uint8Array(x.buffer, x.byteOffset, x.byteLength); }
function withoutTypedIdentity(x) { return decode(encode(x, budget), budget); }

await test('Codec preserves complete return object, typed-array classes, raw bits, null states, and report fields', () => {
  const B = bakeResult(); B.h = new Float32Array(new Uint32Array([0x7fc00001, 0x80000000]).buffer);
  const decoded = decode(encode(B, budget), budget);
  assert.deepEqual(decoded, B);
  assert.deepEqual(bytes(decoded.h), bytes(B.h));
  assert.equal(decoded.pos, null); assert.deepEqual(decoded.report, B.report);
  const ordered = { z: 1, a: 2 };
  assert.deepEqual(Object.keys(decode(encode(ordered, budget, false), budget)), ['z', 'a']);
  assert.deepEqual(Object.keys(decode(encode(ordered, budget), budget)), ['a', 'z']);
});
await test('Codec rejects unsupported shapes, accessors, cycles, shared arrays, and byte-budget overflow', () => {
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [cyclic, { get x() { throw new Error('must not run'); } }, { f() {} }, new DataView(new ArrayBuffer(4))]) {
    assert.throws(() => encode(value, budget));
  }
  if (typeof SharedArrayBuffer === 'function') assert.throws(() => encode(new Uint8Array(new SharedArrayBuffer(4)), budget));
  assert.throws(() => encode(bakeResult(), 32));
  assert.throws(() => validateBake({ ...bakeResult(), grad: new Float32Array(1) }));
});
await test('Canonical input digest binds typed-array bytes, type, null/missing, options, source, dependencies, and runtime', async () => {
  const A = { positions: new Float32Array([1, 2]), optional: null, options: { res: 2048 } };
  const base = await sha256(encode(A, budget));
  assert.notEqual(base, await sha256(encode({ ...A, positions: new Float64Array([1, 2]) }, budget)));
  assert.notEqual(base, await sha256(encode({ ...A, optional: undefined }, budget)));
  assert.notEqual(base, await sha256(encode({ ...A, options: { res: 1024 } }, budget)));
  assert.notEqual(await sha256(encode({ source: 'a'.repeat(64), input: A }, budget)),
    await sha256(encode({ source: 'b'.repeat(64), input: A }, budget)));
});

const config = { enabled: true, qualified: true, namespace: 'a'.repeat(64), source_manifest_sha256: 'b'.repeat(64),
  runtime_sha256: 'c'.repeat(64), dependency_sha256: 'd'.repeat(64), endpoint: '/out/.pcache/.singleflight/v1',
  maxInputBytes: budget, maxResultBytes: budget, maxWaitMs: 1000, pollMs: 1, requestTimeoutMs: 100, leaseMs: 5000 };
globalThis.__ACP_FINE_CACHE_CONFIG__ = { ...config };
const savedFetch = globalThis.fetch, savedInfo = console.info; console.info = () => {};
const artifacts = new Map(), leases = new Map(); let claims = 0, publications = 0, fetchHook = null;
function response(value, status = 200, headers = {}) {
  const body = value instanceof Uint8Array ? value : new TextEncoder().encode(JSON.stringify(value));
  return new Response(body, { status, headers: { 'Content-Length': String(body.byteLength), ...headers } });
}
globalThis.fetch = async (url, init = {}) => {
  if (fetchHook) await fetchHook(url, init);
  const path = new URL(url, 'http://cache.invalid').pathname;
  const parts = path.split('/'); const key = parts.at(-2), action = parts.at(-1);
  if (action === 'claim' && init.method === 'POST') {
    claims++; const { token } = JSON.parse(init.body);
    if (artifacts.has(key)) {
      const data = artifacts.get(key);
      return response({ state: 'ready', sha256: await sha256(data), bytes: data.byteLength });
    }
    if (leases.has(key)) return response({ state: 'pending', retryAfterMs: 1 });
    leases.set(key, token); return response({ state: 'owner', ownerToken: token });
  }
  if (action === 'claim' && init.method === 'DELETE') {
    if (leases.get(key) === init.headers['X-Lease-Token']) leases.delete(key);
    return response({ released: true });
  }
  if (action === 'artifact' && (!init.method || init.method === 'GET')) {
    const data = artifacts.get(key);
    return data ? response(data, 200, { 'X-Content-SHA256': await sha256(data) }) : response({ missing: true }, 404);
  }
  if (action === 'artifact' && init.method === 'PUT') {
    if (leases.get(key) !== init.headers['X-Lease-Token']) return response({ stale: true }, 409);
    const data = new Uint8Array(init.body);
    assert.equal(await sha256(data), init.headers['X-Content-SHA256']);
    artifacts.set(key, data.slice()); publications++; return response({ published: true });
  }
  return response({ unknown: true }, 404);
};
function reset() {
  artifacts.clear(); leases.clear(); claims = 0; publications = 0; fetchHook = null;
  globalThis.__ACP_FINE_CACHE_CONFIG__ = { ...config };
}
const inputs = (extra = {}) => () => ({ positions: new Float32Array([1, 2, 3]), chart: { on: new Uint8Array([1, 0]) },
  info: { name: 'fixture', age: 42 }, options: { res: 2, body: true, ...extra }, optionalNavel: null });
let computes = 0;
const run = token => cachedBake(token, () => { computes++; return bakeResult(); });

await test('Concurrent independent callers use one producer and receive independent decoded arrays', async () => {
  reset(); computes = 0;
  const values = await Promise.all(Array.from({ length: 6 }, () => withFineCache(inputs(), run)));
  assert.equal(computes, 1); assert.equal(publications, 1);
  for (const value of values) assert.deepEqual(value, bakeResult());
  values[0].h[0] = 99; assert.equal(values[1].h[0], 3);
});
await test('A ready artifact gives exact result without running producer', async () => {
  reset(); computes = 0; await withFineCache(inputs(), run); const cold = computes;
  const warm = await withFineCache(inputs(), run);
  assert.equal(cold, 1); assert.equal(computes, cold); assert.deepEqual(warm, bakeResult());
});
await test('Input or namespace identity change prevents a cache hit', async () => {
  reset(); computes = 0; await withFineCache(inputs(), run);
  await withFineCache(inputs({ res: 4 }), run);
  for (const [field, value] of [['source_manifest_sha256', 'e'], ['dependency_sha256', 'f'], ['runtime_sha256', '0'], ['namespace', '1']]) {
    globalThis.__ACP_FINE_CACHE_CONFIG__[field] = value.repeat(64);
    await withFineCache(inputs(), run);
  }
  assert.equal(computes, 6); assert.equal(artifacts.size, 6);
});
await test('Mutation while waiting falls back to the original producer and releases stale ownership', async () => {
  reset(); computes = 0; let x = 1, captures = 0;
  // The first capture is snapshotted; mutate when claim is submitted, before the owner is granted.
  fetchHook = async (_url, init) => { if (init.method === 'POST') x = 2; };
  await withFineCache(() => ({ x: ++captures < 0 ? 0 : x }), run);
  assert.equal(computes, 1); assert.equal(publications, 0); assert.equal(leases.size, 0);
});
await test('Mutation in the acquire-to-sync microtask boundary cannot consume a stale hit', async () => {
  reset(); computes = 0; await withFineCache(inputs(), run);
  let x = 1, captures = 0, seen;
  const capture = () => { captures++; const value = { x }; if (captures === 2) queueMicrotask(() => { x = 2; }); return value; };
  await withFineCache(capture, token => { seen = x; return cachedBake(token, () => { computes++; return bakeResult(); }); });
  assert.equal(seen, 2); assert.equal(computes, 2);
});
await test('Unqualified/disabled, unavailable, corrupt, timeout, and failed publication preserve original result', async () => {
  reset(); computes = 0; globalThis.__ACP_FINE_CACHE_CONFIG__.qualified = false;
  assert.deepEqual(await withFineCache(inputs(), run), bakeResult()); assert.equal(claims, 0);
  globalThis.__ACP_FINE_CACHE_CONFIG__.qualified = true;
  fetchHook = async () => { throw new Error('route-unavailable'); };
  assert.deepEqual(await withFineCache(inputs(), run), bakeResult());
  reset(); computes = 0; await withFineCache(inputs(), run);
  const [key, record] = [...artifacts][0]; record[0] ^= 1; artifacts.set(key, record);
  assert.deepEqual(await withFineCache(inputs(), run), bakeResult()); assert.equal(computes, 2);
  reset(); computes = 0; globalThis.__ACP_FINE_CACHE_CONFIG__.maxWaitMs = 4;
  fetchHook = async (url, init) => { if (init.method === 'POST') { const pathname = new URL(url).pathname; leases.set(pathname.split('/').at(-2), 'other'); } };
  assert.deepEqual(await withFineCache(inputs(), run), bakeResult()); assert.equal(computes, 1);
  reset(); computes = 0; fetchHook = async (_url, init) => { if (init.method === 'PUT') throw new Error('store full'); };
  assert.deepEqual(await withFineCache(inputs(), run), bakeResult()); assert.equal(computes, 1);
});
await test('Original producer exception propagates once and releases its lease', async () => {
  reset(); let n = 0;
  await assert.rejects(withFineCache(inputs(), token => cachedBake(token, () => { n++; throw new Error('original-bake-error'); })), /original-bake-error/);
  assert.equal(n, 1); assert.equal(leases.size, 0); assert.equal(publications, 0);
});

// Evaluate the current upstream index after its source-hash-checked private adaptation. All
// geometry, tissue, body, and bake dependencies are inert test stubs; bakeFine is never run.
const indexPath = new URL('../lib/fx/anatomy/fine/index.js', import.meta.url);
const source = readFileSync(indexPath, 'utf8');
const compiled = source.replace(/^import .*;$/gm, '').replace(/^export \{[\s\S]*?\};/gm, '')
  .replace(/^export /gm, '').replaceAll('import.meta.url', JSON.stringify('http://fixture.invalid/index.js'));
class Texture { constructor(data) { this.image = { data }; this.disposed = false; } dispose() { this.disposed = true; } }
const stubB = () => { computes++; return bakeResult(); };
const deps = {
  FT: { faceAnchors: () => ({ o: [0, 0, 0] }) }, loadChart: async () => ({ nb: 1, aspect: 1, ids: new Uint8Array([1]) }),
  chartOnGeometry: () => ({ n: 1, on: new Uint8Array([1]), tris: new Uint32Array([0, 0, 0]), level: 0 }),
  faceFeatures: () => [], tissueState: () => ({ age: 42, sex: 'f', group: 'white', lax: 0, ageK: 0 }),
  FINE_NUMBERS: {}, fineSurface: () => ({}), bakeFine: stubB, lipsInMm: () => [],
  makeTextures: (_K, B) => ({ VT: new Texture(B.h), GT: new Texture(B.grad), MT: new Texture(B.mask), bytes: 1 }),
  fineHook: () => ({ uniforms: { fineK: { value: { x: 1, y: 1, z: 1, w: 1 } } } }), ENGINE_KEY: 'fixture',
  skinReport: () => ({}), SKIN_AGE: {}, skinSet: () => {}, staticFold: () => {}, bodyPatches: () => null,
  packBody: K => ({ K, aspect: 1, BP: null }), bodySource: () => ({ P: new Float32Array([1, 2, 3]), index: new Uint16Array([0, 0, 0]), region: new Uint8Array([1]), rStride: 1, height: 1.7 }),
  prepareBody: async () => null, BODY_FINE: {}, BODY_FINE_VERSION: 1, navelGeometryMap: () => null,
  NAVEL_SOFT_VERSION: 1, NAVEL_TISSUE: {}, navelTissue: () => ({}), navelKey: () => 'n', navelWall: () => ({}),
  solveNavel: () => ({}), prepareNavel: async () => ({}), navelSolved: () => ({ relief: new Float32Array([0]) }),
  LIP_FILM: {}, LIP_PRINT_VERSION: 1, lipPrint: () => ({}), lipZGrid: () => ({}),
  FINE_TOKEN, withFineCache, cachedBake,
};
const moduleKeys = Object.keys(deps), moduleValues = Object.values(deps);
const FakeThree = new Function(...moduleKeys, 'fetch', compiled + '\nreturn { applyFine7, applyFine7Sync };')(...moduleValues, async () => response({ ids: {} }));
function hero() {
  return { body: { geometry: { attributes: { position: { array: new Float32Array([1, 2, 3]) } } } }, mouth5: { m: { lines: null } },
    o: { skinHook: [] }, useSkinHook(hook) { this.hook = hook; } };
}
await test('Adapted async Fine7 path invokes cache around exactly the original bake and leaves sync path uncached', async () => {
  reset(); computes = 0;
  const first = await FakeThree.applyFine7(hero(), { name: 'fixture', age: 42, sex: 'f', group: 'white' }, { res: 2 });
  const second = await FakeThree.applyFine7(hero(), { name: 'fixture', age: 42, sex: 'f', group: 'white' }, { res: 2 });
  assert.equal(computes, 1); assert.equal(publications, 1);
  assert.deepEqual(second.D.B.h, bakeResult().h); assert.deepEqual(second.D.B.grad, bakeResult().grad);
  assert.deepEqual(second.D.B.report, { ...bakeResult().report, ms: { bake: 17, all: 0 }, tissue: { age: 42, sex: 'f', group: 'white', lax: 0, ageK: 0, skin: {} }, chart: { level: 0, verts: 1, on: 1, tris: 1 } });
  assert.notEqual(first.D.B.h.buffer, second.D.B.h.buffer);
  const chart = { nb: 1, aspect: 1 }, beforeSyncClaims = claims;
  FakeThree.applyFine7Sync(hero(), { name: 'sync' }, { res: 2 }, chart, { ids: {} });
  assert.equal(computes, 2); assert.equal(claims, beforeSyncClaims);
});

globalThis.fetch = savedFetch; console.info = savedInfo;
console.log('Fine7 mock-only test suite completed; no actual bake or renderer executed.');
