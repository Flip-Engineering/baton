// SIMULATION (acp.prepared-render port): CPU numerical tests for videos/web/native/simulation.mjs.
// Differential against the pinned runtime: real three@0.170.0 and the real page-side players
// (cloth_motion.js TrackPlayer/HairPlayer/EyePlayer, act7.js applyFace7, sim6.js HairPlayer6,
// body/correct.js correctiveWeights) on a synthetic small hero + synthetic tracks. No rendering, no GPU.
//
// Run: node --test videos/web/test/native-simulation.test.mjs   (from the repo root; needs
// videos/web/node_modules with three@0.170.0 — the campaign keeps one at build-cache/npm/node_modules).
// Golden vectors for the Rust cross-check: ACP_GOLDEN_WRITE=1 node videos/web/test/native-simulation.test.mjs
// rewrites videos/web/native/golden/simulation-vectors.json.
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import * as CM from '../lib/fx/motion/cloth_motion.js';
import * as A7 from '../lib/fx/motion/act7.js';
import * as S6 from '../lib/fx/hair/sim6.js';
import * as C5 from '../lib/fx/body/correct.js';
import * as NS from '../native/simulation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(HERE, '..', 'native', 'golden', 'simulation-vectors.json');
const GOLDEN_WRITE = !!process.env.ACP_GOLDEN_WRITE;

// ---------------------------------------------------------------- a synthetic hero (hero.js construction: identity bind rotations, heads at bindPos)
const NAMES = ['root', 'pelvis', 'pelvis.L', 'pelvis.R', 'spine01', 'spine02', 'spine03', 'spine04', 'spine05', 'neck01', 'neck03', 'head', 'jaw',
  'clavicle.L', 'shoulder01.L', 'upperarm01.L', 'lowerarm01.L', 'lowerarm02.L', 'wrist.L',
  'clavicle.R', 'shoulder01.R', 'upperarm01.R', 'lowerarm01.R', 'lowerarm02.R', 'wrist.R',
  'upperleg01.L', 'lowerleg01.L', 'foot.L', 'upperleg01.R', 'lowerleg01.R', 'foot.R', 'breast.L', 'breast.R'];
const HEAD = {   // bind heads (world at bind), y up, metres
  'root': [0, 0, 0], 'pelvis': [0, 0.98, 0], 'pelvis.L': [-0.09, 0.96, 0], 'pelvis.R': [0.09, 0.96, 0],
  'spine01': [0, 1.06, 0], 'spine02': [0, 1.16, 0], 'spine03': [0, 1.26, 0], 'spine04': [0, 1.36, 0], 'spine05': [0, 1.44, 0],
  'neck01': [0, 1.50, 0], 'neck03': [0, 1.58, 0.01], 'head': [0, 1.64, 0.02], 'jaw': [0, 1.60, 0.05],
  'clavicle.L': [-0.06, 1.44, 0], 'shoulder01.L': [-0.14, 1.42, 0], 'upperarm01.L': [-0.20, 1.40, 0], 'lowerarm01.L': [-0.24, 1.13, 0], 'lowerarm02.L': [-0.26, 0.99, 0], 'wrist.L': [-0.27, 0.86, 0],
  'clavicle.R': [0.06, 1.44, 0], 'shoulder01.R': [0.14, 1.42, 0], 'upperarm01.R': [0.20, 1.40, 0], 'lowerarm01.R': [0.24, 1.13, 0], 'lowerarm02.R': [0.26, 0.99, 0], 'wrist.R': [0.27, 0.86, 0],
  'upperleg01.L': [-0.10, 0.94, 0], 'lowerleg01.L': [-0.11, 0.50, 0], 'foot.L': [-0.11, 0.08, 0.04],
  'upperleg01.R': [0.10, 0.94, 0], 'lowerleg01.R': [0.11, 0.50, 0], 'foot.R': [0.11, 0.08, 0.04],
  'breast.L': [-0.07, 1.32, 0.06], 'breast.R': [0.07, 1.32, 0.06],
};
const PARENT = {
  root: -1, pelvis: 'root', 'pelvis.L': 'pelvis', 'pelvis.R': 'pelvis', spine01: 'pelvis', spine02: 'spine01', spine03: 'spine02', spine04: 'spine03', spine05: 'spine04',
  neck01: 'spine05', neck03: 'neck01', head: 'neck03', jaw: 'head',
  'clavicle.L': 'spine05', 'shoulder01.L': 'clavicle.L', 'upperarm01.L': 'shoulder01.L', 'lowerarm01.L': 'upperarm01.L', 'lowerarm02.L': 'lowerarm01.L', 'wrist.L': 'lowerarm02.L',
  'clavicle.R': 'spine05', 'shoulder01.R': 'clavicle.R', 'upperarm01.R': 'shoulder01.R', 'lowerarm01.R': 'upperarm01.R', 'lowerarm02.R': 'lowerarm01.R', 'wrist.R': 'lowerarm02.R',
  'upperleg01.L': 'pelvis.L', 'lowerleg01.L': 'upperleg01.L', 'foot.L': 'lowerleg01.L',
  'upperleg01.R': 'pelvis.R', 'lowerleg01.R': 'upperleg01.R', 'foot.R': 'lowerleg01.R',
  'breast.L': 'spine04', 'breast.R': 'spine04',
};
const IDX = Object.fromEntries(NAMES.map((n, i) => [n, i]));
const PARENTS = Int32Array.from(NAMES.map(n => { const p = PARENT[n]; return p === -1 ? -1 : IDX[p]; }));
const BINDPOS = new Float64Array(NAMES.length * 3);
NAMES.forEach((n, i) => { const p = PARENT[n]; const ph = p === -1 ? [0, 0, 0] : HEAD[p]; for (let k = 0; k < 3; k++) BINDPOS[i * 3 + k] = HEAD[n][k] - ph[k]; });

function makeHero() {   // the h of makePerson, minimally: bones, group, bone(), update()
  const bones = NAMES.map((n, i) => { const B = new THREE.Bone(); B.name = n; B.position.set(BINDPOS[i * 3], BINDPOS[i * 3 + 1], BINDPOS[i * 3 + 2]); return B; });
  NAMES.forEach((n, i) => { if (PARENTS[i] >= 0) bones[PARENTS[i]].add(bones[i]); });
  const group = new THREE.Group(); group.add(bones[IDX.root]);
  const h = { bones, idx: IDX, group, bindPos: bones.map(B => B.position.clone()) };
  h.bone = n => bones[IDX[n]];
  h.update = () => group.updateMatrixWorld(true);
  h.head0 = NAMES.map(n => new THREE.Vector3(...HEAD[n]));
  h.eyeL = new THREE.Vector3(-0.033, 1.65, 0.06); h.eyeR = new THREE.Vector3(0.033, 1.65, 0.06);
  h.update();
  return h;
}

// ---------------------------------------------------------------- deterministic synthetic track (real encodeTrack)
function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const FPS = 15, NF = 7, KEY = 2;
// The exact bake channel census (bake7.js:17 CH7 = 14 fixed + 9 HAIR_CHANS + 3 FACE7 = 26).
// The wire stride is header-driven on both sides (C = chans.length); this fixture proves the
// real 26-name bake case, not a reduced synthetic set.
const CH7_FIXED = ['eyeYaw', 'eyePitch', 'smile', 'blink', 'breath', 'weight', 'boxX', 'boxY', 'boxZ', 'boxYaw', 's3x', 's3z', 's2x', 's2z'];
const HAIR_CHANS_FIXTURE = ['L', 'R', 'C'].flatMap(g => ['x', 'y', 'z'].map(a => 'hair' + g + a));
const FACE7_FIXTURE = ['brow', 'squint', 'platysma'];
const CHANS = [...CH7_FIXED, ...HAIR_CHANS_FIXTURE, ...FACE7_FIXTURE];
if (CHANS.length !== 26) throw new Error(`fixture channel census must be the 26-name bake set, got ${CHANS.length}`);
const MOVING = [IDX.spine02, IDX.spine03, IDX['upperarm01.L'], IDX['lowerarm01.L'], IDX.head];
const CLOTH_N = [5, 4];

function makeTrackBuf(rnd) {
  const frames = [];
  for (let i = 0; i < NF; i++) {
    const q = NAMES.map(() => { const e = [ (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.1 ]; const Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0] * i * 0.3, e[1] * i * 0.3, e[2] * i * 0.3)); return Q.toArray(); });
    const c = {}; CHANS.forEach((n, k) => { c[n] = n.startsWith('s') && n[1] <= '3' && n.length === 3 ? 1 + 0.02 * Math.sin(i * 0.7 + k) : (rnd() - 0.5) * 0.4; });
    frames.push({ q, root: [0.01 * i, 0.98 + 0.004 * Math.sin(i), 0.005 * i], g: [0.2 * i, -0.05 * i, 0.03 * i], c });
  }
  const still = NAMES.map((n, b) => MOVING.includes(b) ? null : frames[0].q[b].map(x => +x.toFixed(6)));
  const parts = CLOTH_N.map((n, pi) => {
    const nk = Math.floor((NF - 1) / KEY) + 1, active = []; for (let v = pi; v < n; v += 2) active.push(v);
    const q = 0.0005 + 0.0001 * pi, data = new Int8Array(nk * active.length * 3);
    for (let k = 0; k < nk; k++) for (let a = 0; a < active.length; a++) for (let c = 0; c < 3; c++) data[(k * active.length + a) * 3 + c] = Math.round((rnd() - 0.5) * 120);
    return { name: 'part' + pi, n, active, q, data };
  });
  const meta = { clip: 'synthetic', name: 'syn', fps: FPS, bones: MOVING, still, chans: CHANS };
  return CM.encodeTrack(meta, frames, { key: KEY, parts });
}

function makePerson(rnd) {   // the P the page players see: h + parts + groom + meshes
  const h = makeHero();
  const parts = CLOTH_N.map((n, pi) => {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3);
    for (let v = 0; v < n * 3; v++) pos[v] = (rnd() - 0.5) * 0.3;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    m.userData.k3 = { group: 'garment', name: 'part' + pi };
    return m;
  });
  const scalp = (() => {   // pendulum-hair scalp mesh with aSway
    const n = 8, g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), sw = new Float32Array(n);
    for (let v = 0; v < n; v++) { pos[v * 3] = -0.08 + 0.02 * v; pos[v * 3 + 1] = 1.6 - 0.03 * v; pos[v * 3 + 2] = -0.02; sw[v] = (v % 5) * 0.2; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial()); m.userData.hairPart = 'scalp';
    return m;
  })();
  const eye = (() => {   // an eye globe with aEyeL
    const n = 6, g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), loc = new Float32Array(n * 4);
    const C = [-0.033, 1.65, 0.06];
    for (let v = 0; v < n; v++) { const a = v / n * Math.PI * 2; pos[v * 3] = C[0] + 0.012 * Math.cos(a); pos[v * 3 + 1] = C[1] + 0.012 * Math.sin(a); pos[v * 3 + 2] = C[2];
      nrm[v * 3] = Math.cos(a); nrm[v * 3 + 1] = Math.sin(a); nrm[v * 3 + 2] = 0;
      loc[v * 4] = C[0]; loc[v * 4 + 1] = C[1]; loc[v * 4 + 2] = C[2]; loc[v * 4 + 3] = 1; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('aEyeL', new THREE.BufferAttribute(loc, 4));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial()); m.userData.part = 'eye';
    return m;
  })();
  h.meshes = [eye];
  h.exprIndex = { 'mouth-corner-puller': 0, 'eyebrows-left-down': 1, 'eyebrows-right-down': 2, 'eye-left-slit': 3, 'eye-right-slit': 4, 'neck-platysma': 5 };
  h.body = { morphTargetInfluences: new Array(6).fill(0) };
  return { h, parts, groom: { meshes: [scalp] } };
}

// ---------------------------------------------------------------- differential harness
const eqExact = (a, b, what) => {
  assert.equal(a.length, b.length, `${what}: length`);
  for (let i = 0; i < a.length; i++) assert.ok(Object.is(a[i], b[i]), `${what}[${i}]: ${a[i]} !== ${b[i]} (bitwise)`);
};
const f64 = a => Array.from(a, x => {
  if (typeof x !== 'number') return x;
  const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, x); return b.getBigUint64(0).toString(16).padStart(16, '0');
});
const fromBits = h => { const b = new DataView(new ArrayBuffer(8)); b.setBigUint64(0, BigInt('0x' + h)); return b.getFloat64(0); };

const rnd = mulberry(20261016);
const BUF = makeTrackBuf(rnd);
const T_REAL = CM.decodeTrack(BUF);
const TIMES = [0, 0.02, 0.1333, 0.2, 0.3667, 0.4 - 1e-9, 0.4, 0.7, 12.5];   // interior, key boundaries, past the end

nodeTest('decode: decodeMot4 matches decodeTrack bitwise', () => {
  const T = NS.decodeMot4(BUF);
  assert.deepEqual(T.H, T_REAL.H);
  eqExact(T.pose, T_REAL.pose, 'pose'); eqExact(T.grp, T_REAL.grp, 'grp'); eqExact(T.ch, T_REAL.ch, 'ch');
  assert.equal(T.nk, T_REAL.nk);
  T.parts.forEach((p, k) => { eqExact(p.active, T_REAL.parts[k].active, `parts[${k}].active`); eqExact(p.data, T_REAL.parts[k].data, `parts[${k}].data`); assert.equal(p.q, T_REAL.parts[k].q); });
});

nodeTest('TrackEval: skeleton/root/group/cloth match TrackPlayer bitwise over sampled times', () => {
  for (const t of TIMES) {
    const P = makePerson(mulberry(7));   // fresh, identically-seeded person per time
    const tp = new CM.TrackPlayer(P, CM.decodeTrack(BUF));   // captures cloth X0 at construction
    const clothX0 = P.parts.map(m => Float32Array.from(m.geometry.attributes.position.array));
    const frR = tp.apply(t, { cloth: true });
    const layout = {
      bones: { names: NAMES, parents: PARENTS, bindPos: BINDPOS }, groupScale: 1,
      cloth: P.parts.map((m, k) => ({ name: m.userData.k3.name, X0: clothX0[k] })),
    };
    const ev = new NS.TrackEval(NS.decodeMot4(BUF), layout);
    const frN = ev.apply(t, { cloth: true });
    assert.equal(frN, frR, `fr at t=${t}`);
    NAMES.forEach((n, b) => {
      eqExact(ev.localQ.subarray(b * 4, b * 4 + 4), P.h.bones[b].quaternion.toArray(), `t=${t} bone ${n} quaternion`);
      eqExact(ev.scales.subarray(b * 3, b * 3 + 3), P.h.bones[b].scale.toArray(), `t=${t} bone ${n} scale`);
      const mw = P.h.bones[b].matrixWorld.elements;
      eqExact(ev.world.subarray(b * 16, b * 16 + 16), mw, `t=${t} bone ${n} matrixWorld`);
    });
    eqExact(ev.rootPos, P.h.bone('root').position.toArray(), `t=${t} root position`);
    eqExact(ev.groupPos, P.h.group.position.toArray(), `t=${t} group position`);
    assert.ok(Object.is(ev.groupYaw, P.h.group.rotation.y), `t=${t} group yaw`);
    ev.cloth.forEach((c, k) => { if (!c) return; eqExact(c.out, P.parts[k].geometry.attributes.position.array, `t=${t} cloth part ${k}`); });
    // getWorldQuaternion under breath's non-uniform ancestor scales (the decompose path)
    const q = new THREE.Quaternion(); P.h.bone('spine03').getWorldQuaternion(q);
    eqExact(ev.worldQuat(IDX.spine03), q.toArray(), `t=${t} spine03 world quaternion`);
    const qh = new THREE.Quaternion(); P.h.bone('head').getWorldQuaternion(qh);
    eqExact(ev.worldQuat(IDX.head), qh.toArray(), `t=${t} head world quaternion`);
  }
});

nodeTest('TrackEval: chan matches TrackPlayer.chan bitwise; face influences match applyFace7', () => {
  const P = makePerson(mulberry(11));
  const tp = new CM.TrackPlayer(P, CM.decodeTrack(BUF));
  const ev = new NS.TrackEval(NS.decodeMot4(BUF), { bones: { names: NAMES, parents: PARENTS, bindPos: BINDPOS }, cloth: P.parts.map(m => ({ name: 'x', X0: Float32Array.from(m.geometry.attributes.position.array) })), exprIndex: P.h.exprIndex });
  for (const t of TIMES) {
    const fr = tp.apply(t, { cloth: false });
    ev.apply(t, { cloth: false });
    for (const c of CHANS) assert.ok(Object.is(ev.chan(c, fr), tp.chan(c, fr)), `chan ${c} at t=${t}`);
    assert.ok(Object.is(ev.chan('no-such-chan', fr), tp.chan('no-such-chan', fr)), 'absent channel');
    A7.applyFace7(P.h, nm => tp.chan(nm, fr));
    const inf = new Float64Array(6); ev.faceInfluences(fr, inf);
    eqExact(inf, P.h.body.morphTargetInfluences, `t=${t} face influences`);
  }
});

nodeTest('HairPendulumEval matches HairPlayer bitwise (aSway path, bind-frame conversion)', () => {
  for (const t of TIMES) {
    const P = makePerson(mulberry(13));
    const tp = new CM.TrackPlayer(P, CM.decodeTrack(BUF));
    const hp = new CM.HairPlayer(P, tp);
    const fr = tp.apply(t, { cloth: false }); hp.apply(tp, fr);
    const scalp = P.groom.meshes[0];
    const layout = {
      bones: { names: NAMES, parents: PARENTS, bindPos: BINDPOS }, landmarks: { jawY: HEAD.jaw[1], eyeY: (P.h.eyeL.y + P.h.eyeR.y) / 2 },
    };
    const ev = new NS.TrackEval(NS.decodeMot4(BUF), layout);
    const frN = ev.apply(t, { cloth: false });
    assert.equal(frN, fr);
    const he = new NS.HairPendulumEval(ev, [{ X0: Float32Array.from(makePerson(mulberry(13)).groom.meshes[0].geometry.attributes.position.array), aSway: Float32Array.from(scalp.geometry.attributes.aSway.array) }]);
    he.apply(fr);
    eqExact(he.meshes[0].out, scalp.geometry.attributes.position.array, `t=${t} pendulum hair positions`);
  }
});

nodeTest('EyeEval matches EyePlayer bitwise (positions and normals)', () => {
  const P = makePerson(mulberry(17));
  const ep = new CM.EyePlayer(P);
  const eye0 = P.groom ? null : null; void eye0;
  const X0 = Float32Array.from(P.h.meshes[0].geometry.attributes.position.array);
  const N0 = Float32Array.from(P.h.meshes[0].geometry.attributes.normal.array);
  const L = Float32Array.from(P.h.meshes[0].geometry.attributes.aEyeL.array);
  const ee = new NS.EyeEval([{ X0, N0, L }]);
  for (const [yaw, pitch] of [[0, 0], [0.3, -0.2], [-0.41, 0.37], [1e-9, -1e-9]]) {
    ep.apply(yaw, pitch);
    ee.apply(yaw, pitch);
    eqExact(ee.st[0].out, P.h.meshes[0].geometry.attributes.position.array, `eye pos ${yaw},${pitch}`);
    eqExact(ee.st[0].nOut, P.h.meshes[0].geometry.attributes.normal.array, `eye nrm ${yaw},${pitch}`);
  }
});

// ---------------------------------------------------------------- hair6
function makeHair6Fixture(rnd) {
  // three strands x four nodes, two verts per node; guides = strands 0 and 2
  const strands = [{ a: 0, b: 4, len: 0.30 }, { a: 4, b: 8, len: 0.22 }, { a: 8, b: 12, len: 0.26 }];
  const N = 12, nv0 = [], nv1 = [], P = new Float64Array(N * 3), s = new Float64Array(N);
  for (const [si, S] of strands.entries()) {
    let acc = 0;
    for (let k = S.a; k < S.b; k++) {
      nv0.push(k * 2); nv1.push(k * 2 + 2);
      P[k * 3] = -0.05 + si * 0.05 + (rnd() - 0.5) * 0.004; P[k * 3 + 1] = 1.62 - (k - S.a) * 0.07; P[k * 3 + 2] = -0.03;
      if (k > S.a) acc += Math.hypot(P[k * 3] - P[k * 3 - 3], P[k * 3 + 1] - P[k * 3 - 2], P[k * 3 + 2] - P[k * 3 - 1]);
      s[k] = acc;
    }
  }
  const S = { nv0: Int32Array.from(nv0), nv1: Int32Array.from(nv1), P, s, strands, N, held: () => false };
  const nodes = [0, 1, 2, 3, 8, 9, 10, 11], guides = [0, 2], ga = [0, 4];
  const H = { v: 1, fps: FPS, nf: NF, key: 2, guides, nodes, ga, mesh: { verts: N * 2, strands: 3 } };
  const keys = []; for (let k = 0; k < Math.floor((NF - 1) / 2) + 1; k++) { const K = new Float64Array(nodes.length * 3); for (let i = 0; i < K.length; i++) K[i] = (rnd() - 0.5) * 0.02; keys.push(K); }
  const buf = S6.encodeHair6(H, keys);
  // the page-side mesh + person
  const nV = N * 2, g = new THREE.BufferGeometry(), pos = new Float32Array(nV * 3), tan = new Float32Array(nV * 3);
  for (let k = 0; k < N; k++) for (let v = 0; v < 2; v++) { const i = k * 2 + v; pos[i * 3] = P[k * 3] + (v ? 0.01 : -0.01); pos[i * 3 + 1] = P[k * 3 + 1]; pos[i * 3 + 2] = P[k * 3 + 2];
    tan[i * 3] = 0; tan[i * 3 + 1] = -1; tan[i * 3 + 2] = 0.05 * (v ? 1 : -1); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aHairT', new THREE.BufferAttribute(tan, 3));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial()); mesh.userData.hairPart = 'scalp'; mesh.userData.h6 = { S };
  S.mesh = mesh;   // strandsOf keeps the back-reference; applyNodeOffsets reads S.mesh.geometry
  const Pp = { groom: { meshes: [mesh] } };
  return { S, buf, mesh, Pp };
}

nodeTest('decodeHair6 matches the real decoder; Hair6Eval matches HairPlayer6 bitwise', () => {
  const F = makeHair6Fixture(mulberry(23));
  const real = S6.decodeHair6(F.buf), mine = NS.decodeHair6(F.buf);
  assert.deepEqual(mine.H, real.H); eqExact(mine.data, real.data, 'hair6 data');
  for (const t of TIMES) {
    const G = makeHair6Fixture(mulberry(23));   // identical fresh mesh
    const pl = new S6.HairPlayer6(G.Pp, S6.decodeHair6(G.buf));
    assert.ok(!pl.bad, 'hair6 player accepts the fixture');
    const fr = pl.apply(t);
    const fresh = makeHair6Fixture(mulberry(23));
    const X0 = Float32Array.from(fresh.mesh.geometry.attributes.position.array);
    const T0 = Float32Array.from(fresh.mesh.geometry.attributes.aHairT.array);
    const ev = new NS.Hair6Eval(F.S, NS.decodeHair6(F.buf), { mesh: { verts: 24, strands: 3 } });
    const X = new Float32Array(X0.length), Tn = new Float32Array(T0.length);
    const frN = ev.apply(t, X0, T0, X, Tn);
    assert.equal(frN, fr, `hair6 fr at t=${t}`);
    eqExact(X, G.mesh.geometry.attributes.position.array, `t=${t} hair6 positions`);
    eqExact(Tn, G.mesh.geometry.attributes.aHairT.array, `t=${t} hair6 tangents`);
  }
});

// ---------------------------------------------------------------- CORRECT5 weights
function correctiveData() {
  return {
    opts: { sigma: 14 }, n: 0,
    groups: [
      { name: 'shoulder.L', kind: 'swing', X: 'L', bone: 'upperarm01.L', parent: 'shoulder01.L', d0: [0.12, -0.99, 0.02], samples: [{ dir: [0.12, -0.99, 0.02] }, { dir: [-1, 0, 0.02] }, { dir: [-0.5, 0.866, 0.02] }], reg: new Int32Array(0) },
      { name: 'hip.R', kind: 'swing', X: 'R', bone: 'upperleg01.R', parent: 'pelvis.R', d0: [0.05, -0.99, 0.03], samples: [{ dir: [0.05, -0.99, 0.03] }, { dir: [0.6, -0.7, 0.1] }], reg: new Int32Array(0) },
      { name: 'elbow.L', kind: 'hinge', X: 'L', bone: 'lowerarm01.L', f0: 8.5, samples: [{ flex: 40 }, { flex: 95 }, { flex: 122 }], reg: new Int32Array(0) },
      { name: 'knee.R', kind: 'hinge', X: 'R', bone: 'lowerleg01.R', f0: 6, samples: [{ flex: 45 }, { flex: 90 }], reg: new Int32Array(0) },
    ],
    twist: [
      { bones: [IDX['lowerarm01.L'], IDX['lowerarm02.L'], IDX['wrist.L']], ax: [-0.15, -1, 0], c: HEAD['lowerarm01.L'], L: 0.27, X: 'L' },
      { bones: [IDX['lowerarm01.R'], IDX['lowerarm02.R'], IDX['wrist.R']], ax: [0.15, -1, 0], c: HEAD['lowerarm01.R'], L: 0.27, X: 'R' },
    ],
  };
}

nodeTest('correctiveWeightsEval matches correctiveWeights bitwise (swing RBF, hinge tent, twist)', () => {
  const data = correctiveData();
  for (const t of TIMES) {
    const P = makePerson(mulberry(29));
    const tp = new CM.TrackPlayer(P, CM.decodeTrack(BUF));
    tp.apply(t, { cloth: false }); P.h.update();
    const r = C5.correctiveWeights(P.h, data);
    const ev = new NS.TrackEval(NS.decodeMot4(BUF), { bones: { names: NAMES, parents: PARENTS, bindPos: BINDPOS } });
    ev.apply(t, { cloth: false });
    const rn = NS.correctiveWeightsEval(ev, { ...data, sigmaDeg: data.opts.sigma });
    eqExact(rn.W, r.W, `t=${t} corrective W`);
    r.tw.forEach((row, s) => eqExact(rn.tw[s], row, `t=${t} twist ${s}`));
  }
});

nodeTest('corruption sweep: single-byte mutations never escape as foreign errors', () => {
  // deterministic: every byte position x {xor 0xFF, set 0x00, set 0x7F}; decoding must either
  // validate or throw SimulationError - never a TypeError/RangeError from unguarded indexing.
  const bases = [['mot4', BUF], ['hair6', makeHair6Fixture(mulberry(23)).buf]];
  let ok = 0, rejected = 0;
  for (const [kind, buf] of bases) {
    for (let pos = 0; pos < buf.byteLength; pos += 1) {
      for (const mut of [0xFF, 0x00, 0x7F]) {
        const b = new Uint8Array(buf.slice(0)); b[pos] ^= mut;
        try {
          const t = kind === 'mot4' ? NS.decodeMot4(b.buffer) : NS.decodeHair6(b.buffer);
          assert.ok(t && (kind === 'mot4' ? t.nf > 0 && t.pose.length > 0 : t.data.length > 0));
          ok++;
        } catch (e) {
          assert.ok(e instanceof NS.SimulationError, `${kind} pos ${pos} mut ${mut}: ${e?.constructor?.name}: ${e?.message}`);
          rejected++;
        }
      }
    }
  }
  assert.ok(rejected > 0 && ok + rejected === (BUF.byteLength + makeHair6Fixture(mulberry(23)).buf.byteLength) * 3);
});

// ---------------------------------------------------------------- fail-closed validation
// ---------------------------------------------------------------- malformed-input parity with the Rust mirror (golden.rs validation_failures)
// The fixture list is duplicated in Rust; both sides must reject with SimulationError, never throw
// a foreign error type, panic, or silently clamp.
export function malformedFixtures() {
  const good = new Uint8Array(BUF.slice(0));
  const hdrLen = new DataView(good.buffer).getUint32(4, true);
  const hdr = JSON.parse(new TextDecoder().decode(good.subarray(8, 8 + hdrLen)));
  const withHeader = (patch) => {
    const h = new TextEncoder().encode(JSON.stringify({ ...hdr, ...patch }));
    const rest = good.subarray(8 + hdrLen + (4 - (8 + hdrLen) % 4) % 4);
    const hl = h.length, hp = (4 - (8 + hl) % 4) % 4;
    const out = new Uint8Array(8 + hl + hp + rest.length);
    out.set([77, 79, 84, 52]); new DataView(out.buffer).setUint32(4, hl, true); out.set(h, 8); out.set(rest, 8 + hl + hp);
    return out.buffer;
  };
  return {
    'short-buffer': new ArrayBuffer(4),
    'bad-magic': (() => { const b = new Uint8Array(BUF.slice(0)); b[0] = 88; return b.buffer; })(),
    'truncated-body': BUF.slice(0, BUF.byteLength - 7),
    'trailing-bytes': (() => { const b = new Uint8Array(BUF.byteLength + 4); b.set(new Uint8Array(BUF)); return b.buffer; })(),
    'bones-not-array': withHeader({ bones: 'root' }),
    'bones-negative': withHeader({ bones: [-1] }),
    'nf-zero': withHeader({ nf: 0 }),
    'key-zero': withHeader({ key: 0 }),
    'chans-dup': withHeader({ chans: ['eyeYaw', 'eyeYaw', 'smile'] }),
    'still-malformed': withHeader({ still: [[1, 2, 3]] }),
    'parts-not-array': withHeader({ parts: 7 }),
    'nf-overflow': withHeader({ nf: Number.MAX_SAFE_INTEGER }),
    'header-not-object': (() => { const h = new TextEncoder().encode('[1,2]'); const out = new Uint8Array(8 + h.length + 64); out.set([77, 79, 84, 52]); new DataView(out.buffer).setUint32(4, h.length, true); out.set(h, 8); return out.buffer; })(),
  };
}

nodeTest('validation: malformed MOT4 fixtures fail with SimulationError (parity set)', () => {
  for (const [name, buf] of Object.entries(malformedFixtures())) {
    assert.throws(() => NS.decodeMot4(buf), NS.SimulationError, `fixture ${name}`);
  }
  // hair6 parity set
  const F = makeHair6Fixture(mulberry(23));
  const h6bad = [
    ['short', new ArrayBuffer(2)],
    ['truncated', F.buf.slice(0, F.buf.byteLength - 2)],
    ['trailing', (() => { const b = new Uint8Array(F.buf.byteLength + 2); b.set(new Uint8Array(F.buf)); return b.buffer; })()],
  ];
  const dv = new DataView(F.buf), hl = dv.getUint32(0, true), H = JSON.parse(new TextDecoder().decode(new Uint8Array(F.buf, 4, hl)));
  for (const [nm, patch] of [['nk-zero', { nk: 0 }], ['key-zero', { key: 0 }], ['fps-negative', { fps: -15 }], ['ga-misaligned', { ga: [0] }]]) {
    const hh = new TextEncoder().encode(JSON.stringify({ ...H, ...patch }));
    const data = new Uint8Array(F.buf, 4 + hl);
    const pad = (4 - ((4 + hh.length) % 4)) % 4;
    const b = new Uint8Array(4 + hh.length + pad + data.byteLength);
    new DataView(b.buffer).setUint32(0, hh.length + pad, true); b.set(hh, 4); b.set(data, 4 + hh.length + pad);
    h6bad.push([nm, b.buffer]);
  }
  for (const [name, buf] of h6bad) assert.throws(() => NS.decodeHair6(buf), NS.SimulationError, `hair6 ${name}`);
});

nodeTest('validation: layout/doc failures and schema acceptance', () => {
  const layout = { bones: { names: NAMES, parents: PARENTS, bindPos: BINDPOS } };
  assert.throws(() => new NS.TrackEval(NS.decodeMot4(BUF), { bones: { names: NAMES.slice(0, 4), parents: PARENTS.slice(0, 4), bindPos: BINDPOS.slice(0, 12) } }), NS.SimulationError, 'missing breath bones fail');
  assert.throws(() => new NS.TrackEval(NS.decodeMot4(BUF), { bones: { names: NAMES, parents: PARENTS, bindPos: BINDPOS }, cloth: [{ name: 'x', X0: new Float32Array(99) }] }), NS.SimulationError, 'cloth count mismatch fails');
  assert.throws(() => NS.validateSimulationDoc({ schema: 'acp.simulation/v1' }), NS.SimulationError, 'incomplete doc');
  const mkDoc = (over = {}) => ({
    schema: 'acp.simulation/v1', playback: 'direct',
    persons: [{ id: 'syn', preparedPerson: 'a'.repeat(64), tracks: [{ kind: 'mot4', clip: 'synthetic', ref: { path: 'sim/syn/mot4.bin', sha256: 'b'.repeat(64), bytes: BUF.byteLength }, history: { mode: 'baked', from: 0, to: NF - 1, clothKeyframes: Math.floor((NF - 1) / KEY) + 1 } }] }],
    ...over,
  });
  assert.equal(NS.validateSimulationDoc(mkDoc()).schema, 'acp.simulation/v1');
  assert.equal(NS.validateSimulationDoc(mkDoc({ playback: 'attach-motion7' })).playback, 'attach-motion7');
  assert.throws(() => NS.validateSimulationDoc(mkDoc({ playback: 'oneshot-fixed' })), NS.SimulationError, 'unimplemented playback profiles reject');
  const noHist = mkDoc(); delete noHist.persons[0].tracks[0].history;
  assert.throws(() => NS.validateSimulationDoc(noHist), NS.SimulationError, 'missing history provenance rejects');
  const badFrom = mkDoc(); badFrom.persons[0].tracks[0].history.from = 3;
  assert.throws(() => NS.validateSimulationDoc(badFrom), NS.SimulationError, 'partial-history bakes reject');
  assert.equal(NS.SIMULATION_SCHEMA, 'acp.simulation/v1');
  void layout;
});

nodeTest('playback profiles: applyMotionFrame matches both page conventions bitwise', () => {
  for (const t of [0.1333, 0.3667]) {
    // direct (oneshot.js poseAt): hp.apply(tp, fr); ep.apply(chan eyeYaw, chan eyePitch)
    const P1 = makePerson(mulberry(41));
    const tp1 = new CM.TrackPlayer(P1, CM.decodeTrack(BUF));
    const hp1 = new CM.HairPlayer(P1, tp1), ep1 = new CM.EyePlayer(P1);
    const fr1 = tp1.apply(t, { cloth: true }); hp1.apply(tp1, fr1); ep1.apply(tp1.chan('eyeYaw', fr1), tp1.chan('eyePitch', fr1));
    // attach-motion7 (build.js M.apply): hp.apply(t, fr) throws swallowed (hair unmoved); ep.apply(t, fr)
    const P2 = makePerson(mulberry(41));
    const tp2 = new CM.TrackPlayer(P2, CM.decodeTrack(BUF));
    const hp2 = new CM.HairPlayer(P2, tp2), ep2 = new CM.EyePlayer(P2);
    const fr2 = tp2.apply(t, { cloth: true });
    try { hp2.apply(t, fr2); } catch (e) { /* swallowed on the page */ }
    try { ep2.apply(t, fr2); } catch (e) { /* swallowed on the page */ }
    for (const [prof, Pr, wantHairMoved] of [['direct', P1, true], ['attach-motion7', P2, false]]) {
      const Pf = makePerson(mulberry(41));
      const layout = {
        bones: { names: NAMES, parents: PARENTS, bindPos: BINDPOS },
        cloth: Pf.parts.map(m => ({ name: m.userData.k3.name, X0: Float32Array.from(m.geometry.attributes.position.array) })),
        landmarks: { jawY: HEAD.jaw[1], eyeY: 1.65 }, exprIndex: Pf.h.exprIndex,
      };
      const ev = new NS.TrackEval(NS.decodeMot4(BUF), layout);
      const he = new NS.HairPendulumEval(ev, [{ X0: Float32Array.from(Pf.groom.meshes[0].geometry.attributes.position.array), aSway: Float32Array.from(Pf.groom.meshes[0].geometry.attributes.aSway.array) }]);
      const ee = new NS.EyeEval([{ X0: Float32Array.from(Pf.h.meshes[0].geometry.attributes.position.array), N0: Float32Array.from(Pf.h.meshes[0].geometry.attributes.normal.array), L: Float32Array.from(Pf.h.meshes[0].geometry.attributes.aEyeL.array) }]);
      const faceOut = new Float64Array(6);
      const frN = NS.applyMotionFrame(ev, { hair: he, eyes: ee, faceOut, t, profile: prof });
      assert.equal(frN, prof === 'direct' ? fr1 : fr2);
      const scalpR = Pr.groom.meshes[0].geometry.attributes.position.array;
      eqExact(he.meshes[0].out, scalpR, `${prof} hair at t=${t}`);
      if (!wantHairMoved) eqExact(he.meshes[0].out, he.meshes[0].X0, `${prof} hair unmoved at t=${t}`);
      eqExact(ee.st[0].out, Pr.h.meshes[0].geometry.attributes.position.array, `${prof} eye at t=${t}`);
      A7.applyFace7(Pr.h, nm => (prof === 'direct' ? tp1 : tp2).chan(nm, prof === 'direct' ? fr1 : fr2));
      eqExact(faceOut, Pr.h.body.morphTargetInfluences, `${prof} face at t=${t}`);
    }
  }
  const P = makePerson(mulberry(43));
  const ev = new NS.TrackEval(NS.decodeMot4(BUF), { bones: { names: NAMES, parents: PARENTS, bindPos: BINDPOS }, cloth: P.parts.map(m => ({ name: 'x', X0: Float32Array.from(m.geometry.attributes.position.array) })) });
  assert.throws(() => NS.applyMotionFrame(ev, { t: 0.1, profile: 'other' }), NS.SimulationError, 'unknown profile throws');
});

nodeTest('HairPendulumEval aHair length path matches HairPlayer bitwise (no aSway)', () => {
  // a scalp mesh WITHOUT aSway: weights derive from aHair.x past the jaw (cloth_motion.js hairWeights)
  const mkScalp = rndS => {
    const r = mulberry(rndS), n = 9, pos = new Float32Array(n * 3), a4 = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) { pos[v * 3] = -0.07 + 0.017 * v; pos[v * 3 + 1] = 1.66 - 0.045 * v; pos[v * 3 + 2] = -0.03 + 0.01 * r(); a4[v * 4] = (v % 6) / 5; a4[v * 4 + 1] = 0; a4[v * 4 + 2] = 0; a4[v * 4 + 3] = 1; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aHair', new THREE.BufferAttribute(a4, 4));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial()); m.userData.hairPart = 'scalp';
    return m;
  };
  for (const t of [0.1333, 0.3667]) {
    const P = makePerson(mulberry(53));
    P.groom.meshes = [mkScalp(53)];
    const tp = new CM.TrackPlayer(P, CM.decodeTrack(BUF));
    const hp = new CM.HairPlayer(P, tp);
    const fr = tp.apply(t, { cloth: false }); hp.apply(tp, fr);
    const scalp = P.groom.meshes[0];
    const layout = { bones: { names: NAMES, parents: PARENTS, bindPos: BINDPOS }, landmarks: { jawY: HEAD.jaw[1], eyeY: (P.h.eyeL.y + P.h.eyeR.y) / 2 } };
    const ev = new NS.TrackEval(NS.decodeMot4(BUF), layout);
    const frN = ev.apply(t, { cloth: false }); assert.equal(frN, fr);
    const fresh = mkScalp(53);
    const he = new NS.HairPendulumEval(ev, [{ X0: Float32Array.from(fresh.geometry.attributes.position.array), aHair: Float32Array.from(fresh.geometry.attributes.aHair.array) }]);
    assert.equal(he.meshes.length, 1, 'aHair scalp carries sway weight');
    assert.equal(he.meshes[0].src, 'length');
    he.apply(fr);
    eqExact(he.meshes[0].out, scalp.geometry.attributes.position.array, `t=${t} aHair-path pendulum positions`);
  }
});

nodeTest('layoutFromPrepared: acp.prepared/v1 person -> playback layout, fail-closed', () => {
  // a minimal synthetic artifact in asset-contract's manifest shape (prepared.mjs c670041)
  const f32 = a => Float32Array.from(a);
  const buffers = {};
  const ref = (key, typed, itemSize) => { buffers[key] = typed; return { key, type: typed.constructor.name, length: typed.length, itemSize }; };
  const clothX0 = f32(Array.from({ length: 15 }, (_, i) => 0.01 * i));
  const person = {
    name: 'syn',
    joints: { names: NAMES, parents: Array.from(PARENTS), groupScale: 1.25, bindLocalSource: 'bindPos', bindLocal: ref('p0.bindLocal', f32(BINDPOS), 3) },
    meshes: [
      { name: 'part0', kind: 'garment', vertexCount: 5, attributes: { position: ref('p0.m0.position', clothX0, 3) } },
      { name: 'scalp', kind: 'hair', vertexCount: 3, attributes: { position: ref('p0.m1.position', f32([0, 1.7, 0, 0.02, 1.6, 0, -0.02, 1.5, 0]), 3), aSway: ref('p0.m1.aSway', f32([0.5, 0.3, 0.1]), 1) } },
      { name: 'eye.L', kind: 'eye', vertexCount: 2, attributes: { position: ref('p0.m2.position', f32([0, 0, 0, 0.01, 0, 0]), 3), normal: ref('p0.m2.normal', f32([0, 0, 1, 0, 0, 1]), 3), aEyeL: ref('p0.m2.aEyeL', f32([0, 0, 0, 1, 0, 0, 0, 1]), 4) } },
    ],
    channels: { cloth: [{ part: 'part0', mesh: 'part0', quantum: 0.0005, active: [0, 2, 4], k3: { name: 'part0', group: 'garment' } }], hair: [{ part: 'scalp' }], eyes: null, face: ['smile'] },
    landmarks: { jawY: 1.60, eyeLY: 1.65, eyeRY: 1.65 },
    exprIndex: { 'mouth-corner-puller': 0 },
  };
  const layout = NS.layoutFromPrepared(person, buffers);
  assert.equal(layout.bones.names.length, NAMES.length);
  assert.equal(layout.groupScale, 1.25);
  assert.equal(layout.bones.bindPos[4], buffers['p0.bindLocal'][4], 'f32->f64 promotion is exact (of the f32 value)');
  assert.notEqual(layout.bones.bindPos[4], BINDPOS[4], 'artifact f32 quantization IS observable: bindLocal must go f64 (raised with asset-contract)');
  assert.equal(layout.cloth.length, 1);
  eqExact(layout.cloth[0].X0, clothX0, 'cloth X0');
  assert.equal(layout.groom.length, 1); assert.equal(layout.groom[0].aSway.length, 3);
  assert.equal(layout.eyes.length, 1); assert.equal(layout.eyes[0].L.length, 8);
  assert.deepEqual(layout.landmarks, { jawY: 1.60, eyeY: 1.65 });
  assert.equal(layout.exprIndex['mouth-corner-puller'], 0);
  // fail-closed: missing buffer
  const bad = { ...person, joints: { ...person.joints, bindLocal: { key: 'nope', type: 'Float32Array', length: NAMES.length * 3, itemSize: 3 } } };
  assert.throws(() => NS.layoutFromPrepared(bad, buffers), NS.SimulationError, 'missing buffer rejects');
  const badCloth = JSON.parse(JSON.stringify(person, (k, v) => v)); badCloth.meshes = []; badCloth.channels.cloth = [{ part: 'ghost', mesh: 'ghost', quantum: 0.0005, active: [0] }];
  assert.throws(() => NS.layoutFromPrepared(badCloth, buffers), NS.SimulationError, 'unbound cloth part rejects');
});
nodeTest('golden vectors', () => {
  const P = makePerson(mulberry(31));
  const track = NS.decodeMot4(BUF);
  const layout = {
    bones: { names: NAMES, parents: PARENTS, bindPos: BINDPOS },
    cloth: P.parts.map(m => ({ name: m.userData.k3.name, X0: Float32Array.from(m.geometry.attributes.position.array) })),
    landmarks: { jawY: HEAD.jaw[1], eyeY: 1.65 }, exprIndex: P.h.exprIndex,
  };
  const ev = new NS.TrackEval(track, layout);
  const scalp0 = makePerson(mulberry(31)).groom.meshes[0];
  const pendX0 = Float32Array.from(scalp0.geometry.attributes.position.array);
  const pendSway = Float32Array.from(scalp0.geometry.attributes.aSway.array);
  const he = new NS.HairPendulumEval(ev, [{ X0: pendX0, aSway: pendSway }]);
  const eyeX0 = Float32Array.from(P.h.meshes[0].geometry.attributes.position.array);
  const eyeN0 = Float32Array.from(P.h.meshes[0].geometry.attributes.normal.array);
  const eyeL = Float32Array.from(P.h.meshes[0].geometry.attributes.aEyeL.array);
  const ee = new NS.EyeEval([{ X0: eyeX0, N0: eyeN0, L: eyeL }]);
  const cdata = correctiveData();
  const frames = [];
  for (const t of TIMES) {
    const fr = ev.apply(t, { cloth: true });
    he.apply(fr);
    ee.apply(ev.chan('eyeYaw', fr), ev.chan('eyePitch', fr));
    const inf = new Float64Array(6); ev.faceInfluences(fr, inf);
    const corr = NS.correctiveWeightsEval(ev, { ...cdata, sigmaDeg: cdata.opts.sigma });
    const F = makeHair6Fixture(mulberry(23));
    const h6 = new NS.Hair6Eval(F.S, NS.decodeHair6(F.buf), { mesh: { verts: 24, strands: 3 } });
    const X0 = Float32Array.from(F.mesh.geometry.attributes.position.array), T0 = Float32Array.from(F.mesh.geometry.attributes.aHairT.array);
    const X = new Float32Array(X0.length), Tn = new Float32Array(T0.length);
    h6.apply(t, X0, T0, X, Tn);
    frames.push({
      t, fr,
      localQ: f64(ev.localQ), scales: f64(ev.scales), rootPos: f64(ev.rootPos), groupPos: f64(ev.groupPos), groupYaw: f64([ev.groupYaw])[0],
      world: f64(ev.world),
      cloth: ev.cloth.map(c => c ? f64(c.out) : null),
      pendHair: f64(he.meshes[0].out),
      eyeOut: f64(ee.st[0].out), eyeN: f64(ee.st[0].nOut),
      face: f64(inf),
      corrW: f64(corr.W), corrTw: corr.tw.map(f64),
      hair6X: f64(X), hair6T: f64(Tn),
    });
  }
  const doc = {
    format: 'acp-simulation-golden/v1',
    note: 'f64 lane values as hex IEEE-754 bits; f32 lanes as the f64 value of the stored f32. TIMES=' + JSON.stringify(TIMES),
    skeleton: { names: NAMES, parents: Array.from(PARENTS), bindPos: f64(BINDPOS), head: HEAD },
    mot4B64: Buffer.from(BUF).toString('base64'),
    clothX0: layout.cloth.map(c => f64(c.X0)),
    chans: CHANS, moving: MOVING, fps: FPS, nf: NF, key: KEY,
    pendulum: { X0: f64(pendX0), aSway: f64(pendSway), jawY: layout.landmarks.jawY, eyeY: layout.landmarks.eyeY },
    eye: { X0: f64(eyeX0), N0: f64(eyeN0), L: f64(eyeL) },
    exprIndex: P.h.exprIndex,
    correct: { sigmaDeg: cdata.opts.sigma, twist: cdata.twist.map(T => ({ bones: T.bones, ax: T.ax, c: T.c, L: T.L })), groups: cdata.groups.map(G => ({ name: G.name, kind: G.kind, X: G.X, bone: G.bone, parent: G.parent ?? null, d0: G.d0 ?? null, f0: G.f0 ?? null, samples: G.samples.map(s => ({ dir: s.dir ?? null, flex: s.flex ?? null })) })) },
    hair6: (() => { const F = makeHair6Fixture(mulberry(23)); return {
      bufB64: Buffer.from(F.buf).toString('base64'),
      S: { nv0: Array.from(F.S.nv0), nv1: Array.from(F.S.nv1), P: f64(F.S.P), s: f64(F.S.s), strands: F.S.strands, N: F.S.N },
      X0: f64(F.mesh.geometry.attributes.position.array), T0: f64(F.mesh.geometry.attributes.aHairT.array),
    }; })(),
    frames,
  };
  if (GOLDEN_WRITE) { fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true }); fs.writeFileSync(GOLDEN_PATH, JSON.stringify(doc)); }
  const disk = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
  assert.deepEqual(doc, disk, 'golden vectors differ from disk (regenerate with ACP_GOLDEN_WRITE=1 after intentional changes)');
  void fromBits;
});
