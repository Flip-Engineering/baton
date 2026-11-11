import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, sha256 } from '../lib/fx/anatomy/fine/fine_codec.mjs';
import { captureMotion7PoseState, withMotion7TrackCache, replayMotion7Pose } from '../lib/fx/motion/mot4_track_cache.mjs';

const hex = 'a'.repeat(64);
function vector(values = [0, 0, 0]) {
  return { v: [...values], toArray() { return [...this.v]; }, fromArray(a) { this.v = [...a]; }, set(...a) { this.v = a; } };
}
function person() {
  const bones = [{ position: vector(), quaternion: vector([0, 0, 0, 1]), scale: vector([1, 1, 1]) }];
  const rotation = { x: 0, y: 0, z: 0, order: 'XYZ', set(x, y, z, order) { Object.assign(this, { x, y, z, order }); } };
  const group = { position: vector(), quaternion: vector([0, 0, 0, 1]), scale: vector([1, 1, 1]), rotation, updateMatrixWorld() {} };
  return { h: { bones, group, updates: 0, update() { this.updates++; } } };
}
const recipe = Object.freeze({ schema: 1, build_sha256: hex, closure_sha256: hex, person_sha256: hex });
const config = { enabled: true, qualified: true, endpoint: '/out/.pcache/.singleflight/v1', namespace: hex,
  source_manifest_sha256: hex, runtime_sha256: hex, dependency_sha256: hex, maxInputBytes: 64 * 1024,
  maxResultBytes: 1024 * 1024, maxWaitMs: 1000, pollMs: 2, requestTimeoutMs: 1000, leaseMs: 2000 };
const makeA7 = () => ({ actFor7() { return { rep: { kind: 'fixture' }, frame(t) { this.last = t; } }; } });
function makeCM({ rest = () => {} } = {}) {
  return { skinMesh() {}, ClothMotion: class { constructor() {} rest() { rest(); } },
    decodeTrack(buf) { const a = new Uint8Array(buf); return { nf: 3, H: { clip: 'walk', name: 'L01', fps: 15,
      lids: { L: { close: 0.3, sign: 1 }, R: null } }, raw: a[4] }; } };
}
function baked() {
  const buf = new Uint8Array([77, 79, 84, 52, 7]).buffer;
  return { T: { nf: 3, H: { clip: 'walk', name: 'L01', fps: 15, lids: { L: { close: 0.3, sign: 1 }, R: null } } }, buf,
    // bakeTrack7 stores lids in MOT4 metadata; they are absent from `rep`.
    rep: { clip: 'walk', name: 'L01', fps: 15, nf: 3, bytes: 5, cloth: 'live', act: { kind: 'fixture' }, ms: { total: 5 } }, act: null };
}
function contentResponse(status, bytes, headers = {}) {
  const data = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(JSON.stringify(bytes));
  return { ok: status >= 200 && status < 300, status,
    headers: new Headers({ 'Content-Length': String(data.byteLength), ...headers }),
    async arrayBuffer() { return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); } };
}

test('default-off and missing caller recipe execute the original baker unchanged', async () => {
  const oldPolicy = globalThis.__ACP_MOT4_TRACK_CACHE_POLICY__;
  globalThis.__ACP_MOT4_TRACK_CACHE_POLICY__ = { ...config, enabled: false };
  let calls = 0;
  try {
    const result = await withMotion7TrackCache({ P: person(), A7: makeA7(), CM: makeCM(), clip: 'walk', name: 'L01', fps: 15, nf: 3,
      extra: null, cloth: false, hair: false, bake: async () => { calls++; return baked(); } });
    assert.equal(calls, 1); assert.equal(result.rep.ms.total, 5);
    globalThis.__ACP_MOT4_TRACK_CACHE_POLICY__ = config;
    const second = await withMotion7TrackCache({ P: person(), A7: makeA7(), CM: makeCM(), clip: 'walk', name: 'L01', fps: 15, nf: 3,
      extra: null, cloth: false, hair: false, bake: async () => { calls++; return baked(); } });
    assert.equal(calls, 2); assert.equal(second.rep.ms.total, 5);
  } finally { globalThis.__ACP_MOT4_TRACK_CACHE_POLICY__ = oldPolicy; }
});

test('a hit replays the final pose and accepts only matching recorded baker state', async () => {
  const oldPolicy = globalThis.__ACP_MOT4_TRACK_CACHE_POLICY__, oldFetch = globalThis.fetch;
  const P = person(), CM = makeCM(); let bakeCalls = 0, frameCount = 0, claimKey, wrongState = false;
  const oldInfo = console.info; let infoRows = []; console.info = (...args) => infoRows.push(args.join(' '));
  const calibrateLids = (_h, rig) => { rig.L.close = 0.3; rig.L.sign = 1; };
  const capture = { schema: 1, recipe: { build_sha256: hex, closure_sha256: hex, person_sha256: hex },
    source: { manifest: hex, runtime: hex, dependencies: hex, namespace: hex },
    options: { clip: 'walk', name: 'L01', extra: null, fps: 15, nf: 3, key: 3, every: 2, cloth: true, hair: false, rulers: false, popts: null, clothOpts: {} } };
  const input = encode(capture, config.maxInputBytes), inputSha = await sha256(input);
  let envelope;
  const fetcher = async (url, init) => {
    const u = new URL(url, 'http://cache.test');
    if (u.pathname.endsWith('/claim') && init.method === 'POST') {
      claimKey = u.pathname.split('/').at(-2);
      const expectedP = person(); expectedP.h.bones[0].position.v[0] = 2 / 15;
      envelope = encode({ schema: 2, kind: 'MOT4-track', key: claimKey, input_sha256: inputSha,
        state_sha256: wrongState ? '0'.repeat(64) : await sha256(encode(captureMotion7PoseState(expectedP), 1024 * 1024)),
        buf: new Uint8Array(baked().buf), rep: baked().rep }, config.maxResultBytes, false);
      return contentResponse(200, { state: 'ready', sha256: await sha256(envelope), bytes: envelope.byteLength });
    }
    if (u.pathname.endsWith('/artifact')) return contentResponse(200, envelope, { 'X-Content-SHA256': await sha256(envelope) });
    throw new Error(`unexpected route ${u.pathname}`);
  };
  const actorFor = personState => ({ actFor7() { return { L: { rig: { L: {}, R: null } }, rep: { kind: 'fixture' },
    frame(t) { frameCount++; personState.h.bones[0].position.v[0] = t;
      personState.h._h0 = { ...(personState.h._h0 || {}), L: { memo: 'new' } };
      personState.h._flex = { ...personState.h._flex, Lfinger: { memo: 'new' } }; } }; } });
  globalThis.__ACP_MOT4_TRACK_CACHE_POLICY__ = config; globalThis.fetch = fetcher;
  try {
    const result = await withMotion7TrackCache({ P, A7: actorFor(P), CM, clip: 'walk', name: 'L01', extra: null, fps: 15, nf: 3,
      cloth: true, hair: false, cacheRecipe: recipe, calibrateLids,
      bake: async () => { bakeCalls++; return baked(); } });
    assert.equal(bakeCalls, 0, infoRows.join('\n')); assert.equal(frameCount, 3); assert.equal(P.h.bones[0].position.v[0], 2 / 15);
    assert.equal(result.rep.cloth, 'live'); assert.equal(result.rep.ms.total, 5); assert.ok(claimKey);
    const P2 = person(); P2.h.bones[0].position.v[0] = 5; const oldFlex = { retained: true }; P2.h._flex = oldFlex; frameCount = 0; wrongState = true;
    const fallback = await withMotion7TrackCache({ P: P2, A7: actorFor(P2), CM, clip: 'walk', name: 'L01', extra: null, fps: 15, nf: 3,
      cloth: true, hair: false, cacheRecipe: recipe, calibrateLids,
      bake: async () => { bakeCalls++; assert.equal(P2.h.bones[0].position.v[0], 5); return baked(); } });
    assert.equal(bakeCalls, 1); assert.equal(P2.h.bones[0].position.v[0], 5); assert.equal(fallback.rep.ms.total, 5);
    assert.equal(Object.hasOwn(P2.h, '_h0'), false); assert.equal(P2.h._flex, oldFlex); assert.deepEqual(P2.h._flex, { retained: true });
  } finally { globalThis.__ACP_MOT4_TRACK_CACHE_POLICY__ = oldPolicy; globalThis.fetch = oldFetch; console.info = oldInfo; }
});

test('actor replay uses bakeTrack7 time multiplication order', () => {
  const seen = [], P = person(), CM = makeCM(), A7 = { actFor7() { return { rep: null, frame(t) { seen.push(t); } }; } };
  replayMotion7Pose({ P, A7, CM, clip: 'walk', name: 'L01', extra: null, nf: 6, fps: 3,
    cloth: false, hair: false, calibrateLids() {} });
  assert.equal(seen[5], 5 * (1 / 3));
  assert.notEqual(seen[5], 5 / 3);
});

test('an owner publishes the unchanged MOT4 record and releases its lease', async () => {
  const oldPolicy = globalThis.__ACP_MOT4_TRACK_CACHE_POLICY__, oldFetch = globalThis.fetch;
  globalThis.__ACP_MOT4_TRACK_CACHE_POLICY__ = config;
  const seen = []; let bakeCalls = 0;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url, 'http://cache.test'); seen.push({ path: u.pathname, init });
    if (init.method === 'POST') return contentResponse(200, { state: 'owner', ownerToken: JSON.parse(init.body).token });
    if (init.method === 'PUT') return contentResponse(201, { ok: true });
    if (init.method === 'DELETE') return contentResponse(200, { released: true });
    throw new Error('unexpected request');
  };
  try {
    const result = await withMotion7TrackCache({ P: person(), A7: makeA7(), CM: makeCM(), clip: 'walk', name: 'L01', fps: 15, nf: 3,
      extra: null, cloth: false, hair: false, cacheRecipe: recipe, calibrateLids() {},
      bake: async () => { bakeCalls++; return baked(); } });
    assert.equal(bakeCalls, 1); assert.equal(result.rep.bytes, 5);
    assert.deepEqual(seen.map(x => x.init.method), ['POST', 'PUT', 'DELETE']);
    const owner = JSON.parse(seen[0].init.body).token;
    assert.equal(seen[1].init.headers['X-Lease-Token'], owner);
    assert.equal(seen[1].init.headers['X-Content-SHA256'], await sha256(new Uint8Array(seen[1].init.body)));
    assert.equal(seen[2].init.headers['X-Lease-Token'], owner);
  } finally { globalThis.__ACP_MOT4_TRACK_CACHE_POLICY__ = oldPolicy; globalThis.fetch = oldFetch; }
});

test('cloth restoration failure follows the canonical skinned fallback branch', () => {
  const P = person(), CM = makeCM({ rest() { throw new Error('fixture rest failure'); } });
  const A7 = makeA7(); let frames = 0;
  const state = replayMotion7Pose({ P, A7, CM, clip: 'walk', name: 'L01', extra: null, nf: 3, fps: 15, cloth: true, hair: false,
    calibrateLids() {}, });
  assert.equal(state.cloth, 'skinned(fixture rest failure)'); assert.equal(frames, 0); assert.equal(state.act.kind, 'fixture');
});

test('cloth rest is initialized before the actor constructor, as in bakeTrack7', () => {
  const events = [], P = person(), CM = makeCM({ rest() { events.push('rest'); } });
  const A7 = { actFor7() { events.push('actor'); return { rep: null, frame() {} }; } };
  replayMotion7Pose({ P, A7, CM, clip: 'walk', name: 'L01', extra: null, nf: 1, fps: 15,
    cloth: true, hair: false, calibrateLids() {} });
  assert.deepEqual(events, ['rest', 'actor']);
});
