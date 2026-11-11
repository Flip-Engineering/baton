// Optional exact MOT4 byte reuse around attachMotion7. The caller supplies the
// pinned bake/decode modules and a closed input recipe; missing policy bypasses it.
import { decode as decodeRecord, encode, equalBytes, sha256 } from '../anatomy/fine/fine_codec.mjs';

const BASE = '/out/.pcache/.singleflight/v1';
const DIGEST = /^[a-f0-9]{64}$/;
const MAGIC = new Uint8Array([77, 79, 84, 52]);

function policy() {
  const c = globalThis.__ACP_MOT4_TRACK_CACHE_POLICY__;
  if (!c || c.enabled !== true || c.qualified !== true || c.endpoint !== BASE) return null;
  for (const k of ['namespace', 'source_manifest_sha256', 'runtime_sha256', 'dependency_sha256'])
    if (typeof c[k] !== 'string' || !DIGEST.test(c[k])) return null;
  for (const k of ['maxInputBytes', 'maxResultBytes', 'maxWaitMs', 'pollMs', 'requestTimeoutMs', 'leaseMs'])
    if (!Number.isSafeInteger(c[k]) || c[k] <= 0) return null;
  if (c.leaseMs < c.requestTimeoutMs) return null;
  return { ...c };
}

async function request(c, route, init = {}, binary = false) {
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), c.requestTimeoutMs);
  try {
    const res = await fetch(c.endpoint + route, { ...init, signal: abort.signal, credentials: 'same-origin', cache: 'no-store' });
    const len = Number(res.headers.get('Content-Length')), max = binary ? c.maxResultBytes : 64 * 1024;
    if (!Number.isSafeInteger(len) || len < 1 || len > max) throw new Error('invalid MOT4 cache response length');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength !== len) throw new Error('truncated MOT4 cache response');
    return { ok: res.ok, status: res.status, headers: res.headers, bytes,
      value: binary ? null : JSON.parse(new TextDecoder().decode(bytes)) };
  } finally { clearTimeout(timer); }
}

function tokenHex() {
  const bytes = new Uint8Array(32); globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
}
function diagnostics(row) { try { console.info('[FARM_MOT4_CACHE]', JSON.stringify(row)); } catch {} }
async function release(c, key, token) {
  try { await request(c, `/${key}/claim`, { method: 'DELETE', headers: { 'X-Lease-Token': token } }); } catch {}
}

function sameSnapshot(before, capture, c) {
  return equalBytes(before, encode(capture(), c.maxInputBytes));
}
function routeError(message, status) { const e = new Error(message); e.status = status; return e; }

function validateEnvelope(bytes, c, key, inputSha, decodeTrack, want) {
  const envelope = decodeRecord(bytes, c.maxResultBytes);
  if (envelope?.schema !== 2 || envelope.kind !== 'MOT4-track' || envelope.key !== key
      || envelope.input_sha256 !== inputSha || !(envelope.buf instanceof Uint8Array)
      || envelope.buf.byteLength < MAGIC.byteLength || !equalBytes(envelope.buf.subarray(0, 4), MAGIC)
      || typeof envelope.state_sha256 !== 'string' || !DIGEST.test(envelope.state_sha256)
      || !envelope.rep || typeof envelope.rep !== 'object' || Array.isArray(envelope.rep)) {
    throw new Error('MOT4 cache artifact identity or shape mismatch');
  }
  const owned = envelope.buf.buffer.slice(envelope.buf.byteOffset, envelope.buf.byteOffset + envelope.buf.byteLength);
  const T = decodeTrack(owned);
  const rep = envelope.rep;
  if (!T || T.nf !== want.nf || T.H?.clip !== want.clip || T.H?.name !== want.name || T.H?.fps !== want.fps
      || rep.clip !== want.clip || rep.name !== want.name || rep.fps !== want.fps || rep.nf !== want.nf
      || rep.bytes !== owned.byteLength || !/^(?:off|live|skinned\(.*\))$/s.test(rep.cloth)) {
    throw new Error('MOT4 track header does not match recipe');
  }
  return { T, buf: owned, rep, state_sha256: envelope.state_sha256, act: null };
}

async function claim(c, key) {
  const ownerToken = tokenHex(), start = Date.now();
  for (;;) {
    const res = await request(c, `/${key}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: ownerToken, ttlMs: c.leaseMs }) });
    if (!res.ok) throw routeError('MOT4 cache claim failed: ' + res.status, res.status);
    const v = res.value;
    if (v.state === 'owner') {
      if (v.ownerToken !== ownerToken) throw new Error('MOT4 cache owner token mismatch');
      return { mode: 'owner', token: ownerToken, started: start };
    }
    if (v.state === 'ready') return { mode: 'ready', ready: v, started: start };
    if (v.state !== 'pending') throw new Error('unknown MOT4 cache claim state');
    const elapsed = Date.now() - start;
    if (elapsed >= c.maxWaitMs) throw new Error('MOT4 cache wait budget exhausted');
    await new Promise(resolve => setTimeout(resolve, Math.min(c.pollMs, c.maxWaitMs - elapsed)));
  }
}

function copyPose(P) {
  const h = P.h;
  return { bones: h.bones.map(b => ({ p: b.position.toArray(), q: b.quaternion.toArray(), s: b.scale.toArray() })),
    groupP: h.group.position.toArray(), groupQ: h.group.quaternion.toArray(), groupS: h.group.scale.toArray(),
    groupR: { x: h.group.rotation.x, y: h.group.rotation.y, z: h.group.rotation.z, order: h.group.rotation.order } };
}
function restorePose(P, pose) {
  P.h.bones.forEach((b, i) => { b.position.fromArray(pose.bones[i].p); b.quaternion.fromArray(pose.bones[i].q); b.scale.fromArray(pose.bones[i].s); });
  P.h.group.position.fromArray(pose.groupP); P.h.group.quaternion.fromArray(pose.groupQ); P.h.group.scale.fromArray(pose.groupS);
  P.h.group.rotation.order = pose.groupR.order; P.h.group.rotation.set(pose.groupR.x, pose.groupR.y, pose.groupR.z, pose.groupR.order); P.h.update();
}
export function captureMotion7PoseState(P) {
  const h = P.h;
  return { bones: h.bones.map(b => ({ p: b.position.toArray(), q: b.quaternion.toArray(), s: b.scale.toArray() })),
    group: { p: h.group.position.toArray(), q: h.group.quaternion.toArray(), s: h.group.scale.toArray(),
      r: { x: h.group.rotation.x, y: h.group.rotation.y, z: h.group.rotation.z, order: h.group.rotation.order } } };
}

function copyMotionMemoState(h) {
  // Motion actors populate these Hero caches while evaluating frames. The
  // uncached baker leaves that state on the person, so a failed replay must
  // remove only cache entries introduced by the attempted replay.
  const fields = ['_h0', '_flex', '_gest', '_fistInfo'];
  return Object.fromEntries(fields.map(key => [key, {
    own: Object.hasOwn(h, key), value: h[key],
    descriptors: h[key] && typeof h[key] === 'object' ? Object.getOwnPropertyDescriptors(h[key]) : null,
  }]));
}
function restoreMotionMemoState(h, snapshot) {
  for (const [key, saved] of Object.entries(snapshot)) {
    if (saved.own && saved.descriptors) {
      for (const ownKey of Reflect.ownKeys(saved.value)) if (!Object.hasOwn(saved.descriptors, ownKey)) delete saved.value[ownKey];
      Object.defineProperties(saved.value, saved.descriptors);
      h[key] = saved.value;
    }
    else if (saved.own) h[key] = saved.value;
    else delete h[key];
  }
}

// The uncached baker leaves the rig at its final actor frame and then attachMotion7
// resets the group. Replaying actor frames preserves those observable rig side effects
// while omitting only per-frame cloth simulation and track encoding. A failed replay
// restores the starting transforms and makes the original baker authoritative.
export function replayMotion7Pose({ P, A7, CM, clip, name, extra, nf, fps, cloth, hair, calibrateLids }) {
  const h = P.h; h.update();
  let clothState = cloth ? 'live' : 'off';
  if (cloth) {
    // Match bakeTrack7: cloth initialization failures are represented as a
    // skinned track and do not abort the actor bake.
    try { const C = new CM.ClothMotion(P, {}); C.rest(); }
    catch (error) { clothState = 'skinned(' + String((error && error.message) || error).slice(0, 160) + ')'; }
  }
  // bakeTrack7 constructs the actor only after the cloth rest pose is ready.
  const act = A7.actFor7(clip, P, name, extra);
  let lids = null;
  const life = act.L || act.life?.L || act.life;
  if (life) {
    try {
      calibrateLids(h, life.rig, m => CM.skinMesh(m));
      lids = Object.fromEntries(['L', 'R'].map(s => [s, life.rig[s] && { close: life.rig[s].close, sign: life.rig[s].sign }]));
    } catch (error) { lids = { err: String((error && error.message) || error).slice(0, 160) }; }
  }
  // Match bakeTrack7's `dt = 1 / fps; t = i * dt` operation order exactly.
  const dt = 1 / fps;
  for (let i = 0; i < nf; i++) { act.frame(i * dt); h.update(); }
  // HairSway only contributes channels to the encoded track; its state is local and
  // does not mutate the person rig. The cached MOT4 carries those exact channels.
  void hair;
  return { cloth: clothState, lids, act: act.rep || null };
}

function validCallerRecipe(recipe) {
  if (!recipe || Object.getPrototypeOf(recipe) !== Object.prototype || !Object.isFrozen(recipe)) return false;
  const keys = Object.keys(recipe).sort().join('|');
  if (Object.getOwnPropertySymbols(recipe).length || Object.getOwnPropertyNames(recipe).length !== 4) return false;
  for (const key of Object.keys(recipe)) {
    const d = Object.getOwnPropertyDescriptor(recipe, key);
    if (!d || !Object.hasOwn(d, 'value') || d.enumerable !== true || d.writable !== false || d.configurable !== false) return false;
  }
  return keys === 'build_sha256|closure_sha256|person_sha256|schema'
    && recipe.schema === 1
    && ['build_sha256', 'closure_sha256', 'person_sha256'].every(k => typeof recipe[k] === 'string' && DIGEST.test(recipe[k]));
}

export async function withMotion7TrackCache({ P, A7, CM, clip, name, extra, fps, nf, cloth, hair, cacheRecipe, calibrateLids, bake }) {
  const c = policy();
  if (!c || !validCallerRecipe(cacheRecipe) || typeof calibrateLids !== 'function') return bake();
  const capture = () => ({ schema: 1, recipe: {
    build_sha256: cacheRecipe.build_sha256, closure_sha256: cacheRecipe.closure_sha256,
    person_sha256: cacheRecipe.person_sha256,
  }, source: { manifest: c.source_manifest_sha256, runtime: c.runtime_sha256, dependencies: c.dependency_sha256,
    namespace: c.namespace }, options: { clip, name, extra, fps, nf, key: 3, every: 2, cloth, hair, rulers: false, popts: null, clothOpts: {} } });
  let before, inputSha, key, lease;
  const want = { clip, name, fps, nf };
  try {
    before = encode(capture(), c.maxInputBytes);
    inputSha = await sha256(before);
    key = await sha256(new TextEncoder().encode(`${c.namespace}\n${inputSha}`));
    lease = await claim(c, key);
    if (!sameSnapshot(before, capture, c)) throw new Error('MOT4 input recipe changed while acquiring cache entry');
    if (lease.mode === 'ready') {
      const res = await request(c, `/${key}/artifact`, {}, true);
      if (!res.ok) throw routeError('MOT4 artifact fetch failed: ' + res.status, res.status);
      const digest = await sha256(res.bytes);
      if (digest !== res.headers.get('X-Content-SHA256')
          || lease.ready.sha256 !== digest || lease.ready.bytes !== res.bytes.byteLength) throw new Error('MOT4 artifact checksum mismatch');
      const B = validateEnvelope(res.bytes, c, key, inputSha, CM.decodeTrack, want);
      if (!sameSnapshot(before, capture, c)) throw new Error('MOT4 input recipe changed while loading cache entry');
      const pose = copyPose(P);
      const memo = copyMotionMemoState(P.h);
      try {
        const state = replayMotion7Pose({ P, A7, CM, clip, name, extra, nf, fps, cloth, hair, calibrateLids });
        if (state.cloth !== B.rep.cloth) throw new Error('replayed cloth mode differs from cached baker metadata');
        if (!equalBytes(encode(state.lids, 16 * 1024), encode(B.T.H.lids ?? null, 16 * 1024))) throw new Error('replayed lid calibration differs from cached MOT4 header');
        if (!equalBytes(encode(state.act, 64 * 1024), encode(B.rep.act, 64 * 1024))) throw new Error('replayed actor report differs from cached baker metadata');
        const currentPose = captureMotion7PoseState(P), currentPoseSha = await sha256(encode(currentPose, 1024 * 1024));
        if (currentPoseSha !== B.state_sha256) throw new Error('replayed final pose differs from cached baker state');
      }
      catch (error) { restorePose(P, pose); restoreMotionMemoState(P.h, memo); throw new Error('MOT4 state restoration failed: ' + String(error?.message || error)); }
      diagnostics({ state: 'hit', key, bytes: res.bytes.byteLength, elapsed_ms: Date.now() - lease.started });
      return B;
    }
  } catch (error) {
    if (lease?.mode === 'owner') await release(c, key, lease.token);
    diagnostics({ state: 'original', reason: String(error?.message || error) });
    return bake();
  }

  // Recheck immediately before the existing calculation. If the producer throws,
  // preserve that exception and release the claim; cache failures never replace it.
  try {
    if (!sameSnapshot(before, capture, c)) throw new Error('MOT4 input recipe changed before bake');
  } catch (error) {
    await release(c, key, lease.token);
    diagnostics({ state: 'original', reason: String(error?.message || error) });
    return bake();
  }
  let B, bakeError;
  try { B = await bake(); } catch (error) { bakeError = error; }
  try {
    if (bakeError) throw bakeError;
    if (!sameSnapshot(before, capture, c)) throw new Error('MOT4 input recipe changed during bake');
    if (!(B?.buf instanceof ArrayBuffer) || B.buf.byteLength < 4 || !equalBytes(new Uint8Array(B.buf, 0, 4), MAGIC)) throw new Error('original baker returned invalid MOT4 bytes');
    const check = CM.decodeTrack(B.buf);
    if (check.nf !== nf || check.H?.clip !== clip || check.H?.name !== name || check.H?.fps !== fps) throw new Error('original baker returned a mismatched MOT4 header');
    if (!B.rep || B.rep.clip !== clip || B.rep.name !== name || B.rep.fps !== fps || B.rep.nf !== nf
        || B.rep.bytes !== B.buf.byteLength || !/^(?:off|live|skinned\(.*\))$/s.test(B.rep.cloth)) throw new Error('original baker returned mismatched MOT4 metadata');
    const stateSha = await sha256(encode(captureMotion7PoseState(P), 1024 * 1024));
    const record = encode({ schema: 2, kind: 'MOT4-track', key, input_sha256: inputSha, state_sha256: stateSha,
      buf: new Uint8Array(B.buf), rep: B.rep }, c.maxResultBytes, false);
    const result = await request(c, `/${key}/artifact`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream',
      'X-Lease-Token': lease.token, 'X-Content-SHA256': await sha256(record) }, body: record });
    if (!result.ok) throw routeError('MOT4 artifact publication refused: ' + result.status, result.status);
    diagnostics({ state: 'published', key, bytes: record.byteLength, elapsed_ms: Date.now() - lease.started });
  } catch (error) {
    if (bakeError) throw bakeError;
    diagnostics({ state: 'publication_failed', key, reason: String(error?.message || error) });
  } finally { await release(c, key, lease.token); }
  if (bakeError) throw bakeError;
  return B;
}
