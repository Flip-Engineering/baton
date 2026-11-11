// CORRECT5 (HUMAN c8 round 5b, 4 Oct): pose-space correctives for a person's body: the shoulder (raised arm, arm across the chest, the
// clasp), the elbow (flexion volume), the armpit and pectoral, the hip and glute (squat, stride), the knee (flexion) and the forearm /
// wrist twist (no candy-wrapper). NEW FILE, opt-in: nothing imports it but makePerson's `correct` option (integrator), the CORRECT5 lab
// and its test. A body nobody calls applyCorrectives on renders exactly as before.
//
// What plain (linear blend) skinning does wrong, and what each corrective puts back (derived per person from her own mesh):
//   1. BENDS (shoulder, elbow, hip, knee): the blended vertices take the chord between their bones' rigid positions, so the joint loses
//      volume on the outside (a pinched elbow point, a dent on top of the shoulder, a collapsed buttock) and its two sides pass through each
//      other on the inside. The target pose of each sample is built from anatomy, in this order:
//        a. ROTATION, NOT CHORD: dual-quaternion blend of the same weights (the skin wraps the joint on an arc: volume kept);
//        b. SKIN SLIDING: the chest skin does not follow the arm when it swings forward or across (the pectoral is held by the ribs; the
//           arm slides under its own skin), so trunk-side vertices near the armpit follow the arm only as far as their arm weight says
//           past 0.5 (per sample: full sliding for the clasp and the arm across, none for the arm raised, where the axillary skin is
//           pulled up with the arm);
//        c. RELAXATION (Delta Mush, Mancewicz et al. 2014): the joint zone is smoothed and its own bind-space detail added back in the
//           smoothed surface's frame: stretched and folded triangles even out (the pectoral facet, the armpit crease), the forms stay;
//        d. CONTACT and FAT COMPRESSION: on the flexion side (the elbow crease, the back of the knee, the groin) tissue of the two segments
//           meets on the bisecting plane of the joint instead of passing through; at the armpit and the chest wall the arm's surface and
//           the trunk's are kept apart (the trunk gives way in proportion to its fat). The volume pushed away comes back as a bulge in a
//           band beside the crease, larger where the subcutaneous fat is thicker (P1's per-vertex fat thickness): a lean and a soft
//           body bend differently;
//      then the difference to plain skinning, taken back to bind space through each vertex's blended skin matrix, is one sample.
//      Samples: shoulder 8 arm directions (hang, side 90, up 150, forward 90, up-forward, across the chest, the clasp, back 40), hip 6
//      thigh directions (flexion 45 / 90 / 120, squat 100 with the knees out, extension 25, abduction 45), elbow and knee 4 flexions
//      each (inside the person's own range from p.kin). In the page each sample's weight comes from the joint's angle (a normalised
//      Gaussian RBF over the limb's direction in its parent's frame for the shoulder and hip, a tent over the flexion angle for the
//      elbow and knee; the bind pose is the zero sample), read from the bones every frame (update()).
//   2. TWIST (forearm: lowerarm01, its twist bone lowerarm02, the wrist): a vertex shared by bones twisted by different angles about the
//      forearm's axis shrinks toward the axis by |sum w e^(i phi)| (the candy-wrapper). That factor is exact for a pure twist, so it is put
//      back analytically in the vertex shader from the vertex's own skin weights and the three twist angles (no samples).
// GPU: one vec4 attribute (aCorr: two slots), one float texture of sample deltas (position + normal, bind space), small uniforms; applied
// in bind space after the morph targets (before skinning), the normal after morphnormal. No varyings (the 15-varying limit is untouched).
// Chained after whatever onBeforeCompile the body material has (like P1's detail.js). CPU: correctedBind() gives the bind positions with
// the current pose's correctives (export, cloth contact, Cycles).
//
//   import { applyCorrectives } from '/web/lib/fx/body/correct.js';
//   const C = applyCorrectives(P);        // P = a makePerson v4 person (P.h, P.p, P.detail), or { h } for any hero with kin
//   ... pose ...; h.update(); C.update(); // every frame after the pose (with P.detail?.update())
//   C.set({ on: false })                  // before / after on the same person; C.stats: cost and sizes
import * as THREE from 'three';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const now = () => (globalThis.performance ? performance.now() : Date.now());
const deg = Math.PI / 180;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export const CORRECT_VERSION = 1;
export const CORRECT_DEFAULTS = { dq: 1, shoulder: 1, elbow: 1, hip: 1, knee: 1, twist: 1, contact: 1, bulge: 1, relax: 1, slide: 0, normals: false, sigma: 30, iters: 14, minMm: 0.15 };
export const KMAX = 8;               // samples a group at most
export const TEXW = 2048;            // texture width (texels)

// ---------------------------------------------------------------- the groups (R side numbers; L mirrors x)
// swing samples: the limb's direction in its parent's (bind) frame; slide = how much the trunk skin is held back (shoulder only)
// dq: how much of the dual-quaternion arc the sample takes (1 = all): raising the arm, the arc keeps the deltoid's volume (plain skinning
// collapses the top of the shoulder); swinging it forward and across, the arc carries the pectoral's edge forward into a fold, so
// those samples keep the chord there and rely on the relaxation (seen on L21's clasp, lab_correct5 vars)
const SHOULDER_DIRS = [
  { name: 'hang', d: [-0.12, -0.99, 0.02], slide: 0.6, dq: 0.5 }, { name: 'side90', d: [-1, 0, 0.02], slide: 0.15, dq: 1 }, { name: 'up150', d: [-0.5, 0.866, 0.02], slide: 0, dq: 1 },
  { name: 'fwd90', d: [-0.12, 0, 0.99], slide: 0.7, dq: 0.4 }, { name: 'upfwd', d: [-0.25, 0.85, 0.47], slide: 0.1, dq: 1 }, { name: 'across', d: [0.45, -0.05, 0.89], slide: 1, dq: 0.15 },
  { name: 'clasp', d: [0.25, -0.85, 0.45], slide: 1, dq: 0.15 }, { name: 'back40', d: [-0.12, -0.77, -0.63], slide: 0.5, dq: 0.5 }];
const HIP_DIRS = [
  { name: 'flex45', d: [-0.1, -0.71, 0.7] }, { name: 'flex90', d: [-0.1, 0, 0.995] }, { name: 'flex120', d: [-0.1, 0.5, 0.86] },
  { name: 'squat', d: [-0.5, 0.17, 0.85] }, { name: 'ext25', d: [-0.1, -0.9, -0.42] }, { name: 'abd45', d: [-0.7, -0.71, 0.05] }];
export const GROUPS = ['shoulder.L', 'shoulder.R', 'elbow.L', 'elbow.R', 'hip.L', 'hip.R', 'knee.L', 'knee.R'];
const ARM_CHILD = /^(upperarm0|lowerarm0|wrist|finger|metacarpal)/, LEG_CHILD = /^(upperleg0|lowerleg0|foot|toe)/;
const FORE_CHILD = /^(lowerarm0|wrist|finger|metacarpal)/, SHIN_CHILD = /^(lowerleg0|foot|toe)/;

function groupSpec(h, name, o, k) {
  const [kind, X] = name.split('.'), sg = X === 'L' ? 1 : -1, J = n => h.head0[h.idx[n + '.' + X]].clone();
  const kin = h.meta?.kin, rom = kin?.rom || {};
  if (kind === 'shoulder') return { kind: 'swing', name, X, sg, bone: 'upperarm01.' + X, parent: 'shoulder01.' + X, c: J('upperarm01'), tip: J('lowerarm01'), R: 0.19 * k, Rc: 0.3 * k, child: ARM_CHILD, contact: 'surface',
    samples: SHOULDER_DIRS.map(s => ({ ...s, d: V3(...s.d) })) };
  if (kind === 'hip') return { kind: 'swing', name, X, sg, bone: 'upperleg01.' + X, parent: 'pelvis.' + X, c: J('upperleg01'), tip: J('lowerleg01'), R: 0.24 * k, child: LEG_CHILD, contact: 'surface', up: V3(0, 1, 0),
    samples: HIP_DIRS.map(s => ({ ...s, d: V3(...s.d) })) };
  if (kind === 'elbow') { const mx = (rom.elbowFlex?.deg || 145); return { kind: 'hinge', name, X, sg, bone: 'lowerarm01.' + X, a: J('upperarm01'), c: J('lowerarm01'), b: J('wrist'), R: 0.12 * k, Rc: 0.17 * k, child: FORE_CHILD, contact: 'plane',
    flex: [0, 95, 122, Math.min(142, mx - 4)] }; }
  if (kind === 'knee') { const mx = (rom.kneeFlex?.deg || 135); return { kind: 'hinge', name, X, sg, bone: 'lowerleg01.' + X, a: J('upperleg01'), c: J('lowerleg01'), b: J('foot'), R: 0.13 * k, Rc: 0.21 * k, child: SHIN_CHILD, contact: 'plane',
    flex: [45, 90, 120, Math.min(140, mx - 4)] }; }
  void o; return null;
}
// mirror helper: the tables are written for the R side (x < 0 lateral); for L the x component flips
function sideDir(d, sg) { return sg > 0 ? V3(-d.x, d.y, d.z).normalize() : d.clone().normalize(); }

// ---------------------------------------------------------------- skinning on the CPU (three's formula, mesh-local), with the per-bone matrices
function boneMats(m) {
  m.updateMatrixWorld(true); m.skeleton.update();
  const BM = m.skeleton.boneMatrices, nb = BM.length / 16, W = new Float64Array(nb * 16), T = new THREE.Matrix4(), Bk = new THREE.Matrix4(), bi = m.bindMatrixInverse, b = m.bindMatrix;
  for (let k = 0; k < nb; k++) { Bk.fromArray(BM, k * 16); T.multiplyMatrices(bi, Bk).multiply(b); W.set(T.elements, k * 16); }
  return W;
}
function skinLBS(W, P, SI, SW, n, X, A) {
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; let ox = 0, oy = 0, oz = 0, a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0, a6 = 0, a7 = 0, a8 = 0;
    for (let j = 0; j < 4; j++) { const w = SW[i * 4 + j]; if (!w) continue; const e = SI[i * 4 + j] * 16;
      ox += w * (W[e] * x + W[e + 4] * y + W[e + 8] * z + W[e + 12]); oy += w * (W[e + 1] * x + W[e + 5] * y + W[e + 9] * z + W[e + 13]); oz += w * (W[e + 2] * x + W[e + 6] * y + W[e + 10] * z + W[e + 14]);
      a0 += w * W[e]; a1 += w * W[e + 1]; a2 += w * W[e + 2]; a3 += w * W[e + 4]; a4 += w * W[e + 5]; a5 += w * W[e + 6]; a6 += w * W[e + 8]; a7 += w * W[e + 9]; a8 += w * W[e + 10]; }
    X[i * 3] = ox; X[i * 3 + 1] = oy; X[i * 3 + 2] = oz;
    if (A) { const o = i * 9; A[o] = a0; A[o + 1] = a1; A[o + 2] = a2; A[o + 3] = a3; A[o + 4] = a4; A[o + 5] = a5; A[o + 6] = a6; A[o + 7] = a7; A[o + 8] = a8; }
  }
}
// dual quaternions per bone (rigid part of W_k)
function boneDQ(W) {
  const nb = W.length / 16, D = new Float64Array(nb * 8), M = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V3(), s = V3();
  for (let k = 0; k < nb; k++) { M.fromArray(W, k * 16); M.decompose(p, q, s);
    const o = k * 8; D[o] = q.x; D[o + 1] = q.y; D[o + 2] = q.z; D[o + 3] = q.w;
    // q_d = 0.5 * (t, 0) * q_r
    const tx = p.x, ty = p.y, tz = p.z, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    D[o + 4] = 0.5 * (tx * qw + ty * qz - tz * qy); D[o + 5] = 0.5 * (-tx * qz + ty * qw + tz * qx); D[o + 6] = 0.5 * (tx * qy - ty * qx + tz * qw); D[o + 7] = -0.5 * (tx * qx + ty * qy + tz * qz); }
  return D;
}
function skinDQ(D, P, SI, SW, i, out, oi) {
  let rx = 0, ry = 0, rz = 0, rw = 0, dx = 0, dy = 0, dz = 0, dw = 0, s0x = 0, s0y = 0, s0z = 0, s0w = 0, first = true;
  for (let j = 0; j < 4; j++) { const w = SW[i * 4 + j]; if (!w) continue; const o = SI[i * 4 + j] * 8;
    if (first) { s0x = D[o]; s0y = D[o + 1]; s0z = D[o + 2]; s0w = D[o + 3]; first = false; }
    const sgn = (D[o] * s0x + D[o + 1] * s0y + D[o + 2] * s0z + D[o + 3] * s0w) < 0 ? -w : w;
    rx += sgn * D[o]; ry += sgn * D[o + 1]; rz += sgn * D[o + 2]; rw += sgn * D[o + 3]; dx += sgn * D[o + 4]; dy += sgn * D[o + 5]; dz += sgn * D[o + 6]; dw += sgn * D[o + 7]; }
  const L = Math.hypot(rx, ry, rz, rw) || 1; rx /= L; ry /= L; rz /= L; rw /= L; dx /= L; dy /= L; dz /= L; dw /= L;
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
  // rotate p by r: p + 2 r.xyz x (r.xyz x p + w p)
  const cx = ry * z - rz * y + rw * x, cy = rz * x - rx * z + rw * y, cz = rx * y - ry * x + rw * z;
  const px = x + 2 * (ry * cz - rz * cy), py = y + 2 * (rz * cx - rx * cz), pz = z + 2 * (rx * cy - ry * cx);
  // translation 2 (w_r v_d - w_d v_r + v_r x v_d)
  const tx = 2 * (rw * dx - dw * rx + ry * dz - rz * dy), ty = 2 * (rw * dy - dw * ry + rz * dx - rx * dz), tz = 2 * (rw * dz - dw * rz + rx * dy - ry * dx);
  out[oi] = px + tx; out[oi + 1] = py + ty; out[oi + 2] = pz + tz;
}
function invApply(A, o, dx, dy, dz, out, oi) {
  const a = A[o], b = A[o + 3], c = A[o + 6], d = A[o + 1], e = A[o + 4], f = A[o + 7], g = A[o + 2], h = A[o + 5], k = A[o + 8];
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g); if (Math.abs(det) < 1e-12) { out[oi] = 0; out[oi + 1] = 0; out[oi + 2] = 0; return; }
  const id = 1 / det;
  out[oi] = ((e * k - f * h) * dx + (c * h - b * k) * dy + (b * f - c * e) * dz) * id;
  out[oi + 1] = ((f * g - d * k) * dx + (a * k - c * g) * dy + (c * d - a * f) * dz) * id;
  out[oi + 2] = ((d * h - e * g) * dx + (b * g - a * h) * dy + (a * e - b * d) * dz) * id;
}
function normalsOf(X, I, out) {
  out.fill(0);
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz; out[b] += nx; out[b + 1] += ny; out[b + 2] += nz; out[c] += nx; out[c + 1] += ny; out[c + 2] += nz; }
  for (let i = 0; i < out.length; i += 3) { const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1; out[i] /= l; out[i + 1] /= l; out[i + 2] /= l; }
  return out;
}
// vertex adjacency (CSR) from a triangle index
function adjacency(I, n) {
  const deg_ = new Int32Array(n + 1); const pairs = new Set();
  const E = []; for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = I[t + e], b = I[t + (e + 1) % 3]; const lo = Math.min(a, b), hi = Math.max(a, b), key = lo * 4194304 + hi; if (pairs.has(key)) continue; pairs.add(key); E.push(lo, hi); deg_[lo]++; deg_[hi]++; }
  const off = new Int32Array(n + 1); for (let i = 0; i < n; i++) off[i + 1] = off[i] + deg_[i];
  const nb = new Int32Array(off[n]), fill = off.slice(0, n);
  for (let k = 0; k < E.length; k += 2) { const a = E[k], b = E[k + 1]; nb[fill[a]++] = b; nb[fill[b]++] = a; }
  return { off, nb };
}
// a uniform grid of a vertex subset (posed positions): nearest within r
class Grid {
  constructor(X, list, cell) { this.X = X; this.c = cell; this.M = new Map(); for (const i of list) { const k = this.key(X[i * 3], X[i * 3 + 1], X[i * 3 + 2]); let L = this.M.get(k); if (!L) this.M.set(k, L = []); L.push(i); } }
  key(x, y, z) { return ((Math.floor(x / this.c) + 512) * 1024 + (Math.floor(y / this.c) + 512)) * 1024 + (Math.floor(z / this.c) + 512); }
  each(x, y, z, r, fn) { const c = this.c, kk = Math.ceil(r / c), X = this.X, r2 = r * r, ix = Math.floor(x / c), iy = Math.floor(y / c), iz = Math.floor(z / c);
    for (let a = -kk; a <= kk; a++) for (let b = -kk; b <= kk; b++) for (let d = -kk; d <= kk; d++) { const L = this.M.get(((ix + a + 512) * 1024 + (iy + b + 512)) * 1024 + (iz + d + 512)); if (!L) continue;
      for (const i of L) { const dx = X[i * 3] - x, dy = X[i * 3 + 1] - y, dz = X[i * 3 + 2] - z, q = dx * dx + dy * dy + dz * dz; if (q < r2) fn(i, q); } } }
  nearest(x, y, z, r) { const c = this.c, kk = Math.ceil(r / c), X = this.X; let best = -1, bd = r * r; const ix = Math.floor(x / c), iy = Math.floor(y / c), iz = Math.floor(z / c);
    for (let a = -kk; a <= kk; a++) for (let b = -kk; b <= kk; b++) for (let d = -kk; d <= kk; d++) { const L = this.M.get(((ix + a + 512) * 1024 + (iy + b + 512)) * 1024 + (iz + d + 512)); if (!L) continue;
      for (const i of L) { const dx = X[i * 3] - x, dy = X[i * 3 + 1] - y, dz = X[i * 3 + 2] - z, q = dx * dx + dy * dy + dz * dz; if (q < bd) { bd = q; best = i; } } }
    return best; }
}

// ---------------------------------------------------------------- the bake: every group's samples for this body
export function bakeCorrectives(h, opts = {}) {
  const o = { ...CORRECT_DEFAULTS, ...opts }, T0 = now(), m = h.body, g = m.geometry, n = g.attributes.position.count;
  // the FULL triangle list (makePerson culls the skin under garments from the drawn index; the correctives are made there too, for the
  // garments that follow the body: applyCorrectives' garment transfer)
  const P0 = g.attributes.position.array, N0 = g.attributes.normal.array, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, I = g.userData.plan?.tri || g.userData.fullIndex || g.index.array;
  const fatT = h.detail?.T && h.detail.T.length === n ? h.detail.T : null;
  // the body's own size (mesh units): the radii and gaps scale with it
  let ymin = Infinity, ymax = -Infinity; for (let i = 1; i < P0.length; i += 3) { ymin = Math.min(ymin, P0[i]); ymax = Math.max(ymax, P0[i]); }
  const k = (ymax - ymin) / 1.7;
  const { off, nb } = adjacency(I, n);
  const drawn = new Uint8Array(n); for (let t = 0; t < I.length; t++) drawn[I[t]] = 1;   // MakeHuman's helper vertices are in no triangle: never moved
  const names = h.names, boneRe = re => { const s = new Uint8Array(names.length); names.forEach((nm, i) => { if (re.test(nm)) s[i] = 1; }); return s; };
  // save the pose, go to bind
  const save = h.bones.map(B => [B.quaternion.clone(), B.position.clone(), B.scale.clone()]);
  const toBind = () => { h.bones.forEach((B, i) => { B.quaternion.identity(); B.position.copy(h.bindPos[i]); B.scale.set(1, 1, 1); }); };
  toBind();
  const X = new Float32Array(n * 3), A = new Float32Array(n * 9), Tg = new Float32Array(n * 3), NT = new Float32Array(n * 3), tmp = new Float32Array(n * 3);
  const groups = [], tGroup = {};
  const want = new Set(GROUPS.filter(nm => o[nm.split('.')[0]]));
  for (const gname of GROUPS) {
    if (!want.has(gname)) continue;
    const t0 = now(), G = groupSpec(h, gname, o, k); if (!G) continue;
    // region: within R of the joint (bind), this side only (a midline fade for the trunk), not the head
    // R: the joint's own zone (rotation, sliding, relaxation); Rc >= R: the contact's reach (the arm against the side of the chest)
    const reg = [], fall = new Float32Array(n), zf = new Float32Array(n), cx = G.c.x, cy = G.c.y, cz = G.c.z, R = G.Rc || G.R, Rz = G.R;
    const childB = boneRe(new RegExp(G.child.source + '.*\\.' + G.X + '$')), headB = boneRe(/^(head|neck0|jaw|special|tongue|orbic|oculi|levator|eye|temporalis|oris|risorius|nose|brow|cheek|ear)/);
    for (let i = 0; i < n; i++) { const x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2], d = Math.hypot(x - cx, y - cy, z - cz); if (d > R || !drawn[i]) continue;
      let hw = 0; for (let j = 0; j < 4; j++) if (headB[SI[i * 4 + j]]) hw += SW[i * 4 + j]; if (hw > 0.3) continue;
      const mid = sst(-0.005 * k, 0.03 * k, x * G.sg); if (mid <= 0) continue; const f = (1 - sst(0.6 * R, R, d)) * mid; if (f <= 0) continue; fall[i] = f; zf[i] = (1 - sst(0.6 * Rz, Rz, d)) * mid; reg.push(i); }
    const inReg = new Uint8Array(n); for (const i of reg) inReg[i] = 1;
    // childness: the vertex's weight on the moving segment
    const om = new Float32Array(n); for (const i of reg) { let s = 0; for (let j = 0; j < 4; j++) if (childB[SI[i * 4 + j]]) s += SW[i * 4 + j]; om[i] = s; }
    // the relaxation's bind data (Delta Mush): smoothed bind positions inside the zone, the detail in the smoothed frame
    const zone = reg.filter(i => zf[i] > 0.02), S0 = Float32Array.from(P0), it = o.iters;
    smooth(S0, zone, off, nb, it, tmp);
    const NS0 = normalsOf(S0, I, new Float32Array(n * 3)), dl = new Float32Array(n * 3);
    for (const i of zone) { const f = frameAt(S0, NS0, off, nb, i); const dx = P0[i * 3] - S0[i * 3], dy = P0[i * 3 + 1] - S0[i * 3 + 1], dz = P0[i * 3 + 2] - S0[i * 3 + 2];
      dl[i * 3] = dx * f[0] + dy * f[1] + dz * f[2]; dl[i * 3 + 1] = dx * f[3] + dy * f[4] + dz * f[5]; dl[i * 3 + 2] = dx * f[6] + dy * f[7] + dz * f[8]; }
    // the samples
    const B = h.bone(G.bone), samples = [];
    const list = G.kind === 'swing' ? G.samples.map(s => ({ name: s.name, dir: sideDir(s.d, G.sg), slide: s.slide || 0, dq: s.dq ?? 1 })) : G.flex.map(f => ({ name: 'flex' + f, flex: f }));
    // the hinge's bind flexion and axis
    let f0 = 0, axis = null, d0 = null;
    if (G.kind === 'hinge') { const u = G.c.clone().sub(G.a).normalize(), v = G.b.clone().sub(G.c).normalize(); f0 = Math.acos(clamp(u.dot(v), -1, 1)) / deg; axis = u.clone().cross(v);
      if (axis.length() < 1e-3) axis = G.kind === 'hinge' && /knee/.test(gname) ? V3(1, 0, 0) : V3(0, 0, 1); axis.normalize();
      // the flexion direction: knee: the ankle goes back; elbow: the wrist comes toward the shoulder
      const test = v.clone().applyAxisAngle(axis, 0.3); const fl = Math.acos(clamp(u.dot(test), -1, 1)) / deg; if (fl < f0) axis.negate(); G.f0 = f0; G.axis = axis; }
    else { d0 = G.tip.clone().sub(G.c).normalize(); G.d0 = d0; }
    for (const s of list) {
      toBind();
      if (G.kind === 'hinge') { if (Math.abs(s.flex - f0) < 4) continue; B.quaternion.setFromAxisAngle(axis, (s.flex - f0) * deg); }
      else B.quaternion.setFromUnitVectors(d0, s.dir);
      h.group.updateMatrixWorld(true);
      const W = boneMats(m), D = boneDQ(W);
      skinLBS(W, P0, SI, SW, n, X, A);
      Tg.set(X);
      const dbgM = () => { let mx = 0, mi = -1; for (const i of reg) { const d = Math.hypot(Tg[i * 3] - X[i * 3], Tg[i * 3 + 1] - X[i * 3 + 1], Tg[i * 3 + 2] - X[i * 3 + 2]); if (d > mx) { mx = d; mi = i; } } return [+(mx * 1000).toFixed(1), mi, +om[mi]?.toFixed(2)]; }, dbg = o.debug ? {} : null;
      // a. dual-quaternion blend in the region
      { const dqk = (s.dq ?? 1) * (o.dq ?? 1), q3 = [0, 0, 0]; if (dqk > 0) for (const i of reg) { skinDQ(D, P0, SI, SW, i, q3, 0); Tg[i * 3] += (q3[0] - Tg[i * 3]) * dqk; Tg[i * 3 + 1] += (q3[1] - Tg[i * 3 + 1]) * dqk; Tg[i * 3 + 2] += (q3[2] - Tg[i * 3 + 2]) * dqk; } }
      if (dbg) dbg.dq = dbgM();
      // b. skin sliding (the shoulder): trunk-side vertices hold back toward their trunk-rigid position
      if (G.kind === 'swing' && G.name.startsWith('shoulder') && s.slide > 0 && o.slide) {
        for (const i of reg) { const w = om[i]; if (w >= 0.7) continue; const keep = s.slide * o.slide * (1 - sst(0.25, 0.7, w)) * zf[i];
          if (keep <= 0) continue; // trunk-rigid: the vertex skinned by its non-arm bones only (renormalised)
          let rx = 0, ry = 0, rz = 0, ws = 0; const x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2];
          for (let j = 0; j < 4; j++) { const w2 = SW[i * 4 + j]; if (!w2 || childB[SI[i * 4 + j]]) continue; const e = SI[i * 4 + j] * 16; ws += w2;
            rx += w2 * (W[e] * x + W[e + 4] * y + W[e + 8] * z + W[e + 12]); ry += w2 * (W[e + 1] * x + W[e + 5] * y + W[e + 9] * z + W[e + 13]); rz += w2 * (W[e + 2] * x + W[e + 6] * y + W[e + 10] * z + W[e + 14]); }
          if (ws < 1e-3) continue; rx /= ws; ry /= ws; rz /= ws;
          Tg[i * 3] += (rx - Tg[i * 3]) * keep; Tg[i * 3 + 1] += (ry - Tg[i * 3 + 1]) * keep; Tg[i * 3 + 2] += (rz - Tg[i * 3 + 2]) * keep; } }
      if (dbg) dbg.slide = dbgM();
      // c. relaxation (Delta Mush in the zone): smooth, add the bind detail back in the smoothed frame
      if (o.relax) { const S = Float32Array.from(Tg); smooth(S, zone, off, nb, it, tmp); const NS = normalsOf(S, I, NT);
        for (const i of zone) { const f = frameAt(S, NS, off, nb, i), a = dl[i * 3], b = dl[i * 3 + 1], c = dl[i * 3 + 2];
          const qx = S[i * 3] + a * f[0] + b * f[3] + c * f[6], qy = S[i * 3 + 1] + a * f[1] + b * f[4] + c * f[7], qz = S[i * 3 + 2] + a * f[2] + b * f[5] + c * f[8];
          const r = o.relax * sst(0.15, 0.6, zf[i]); Tg[i * 3] += (qx - Tg[i * 3]) * r; Tg[i * 3 + 1] += (qy - Tg[i * 3 + 1]) * r; Tg[i * 3 + 2] += (qz - Tg[i * 3 + 2]) * r; } }
      if (dbg) dbg.relax = dbgM();
      // d. contact and fat compression
      let pen = null;
      if (o.contact) pen = G.contact === 'plane' ? contactPlane(h, G, s, reg, om, Tg, fatT, k) : contactSurface(G, reg, om, Tg, I, fatT, k, NT, s);
      if (dbg) dbg.contact = dbgM();
      if (pen && o.bulge) bulgeBand(reg, pen, Tg, I, off, nb, fatT, k, NT, inReg, o.bulge);
      if (dbg) { dbg.bulge = dbgM(); console.log('dbg', gname, s.name, JSON.stringify(dbg)); }
      // the delta in bind space, smoothed lightly as a field (no sharp edge where the contact stops), faded at the region's edge
      const dW = new Float32Array(n * 3); for (const i of reg) { const f = fall[i]; dW[i * 3] = (Tg[i * 3] - X[i * 3]) * f; dW[i * 3 + 1] = (Tg[i * 3 + 1] - X[i * 3 + 1]) * f; dW[i * 3 + 2] = (Tg[i * 3 + 2] - X[i * 3 + 2]) * f; }
      smoothField(dW, reg, inReg, off, nb, 2, tmp);
      const dP = new Float32Array(reg.length * 3), dN = new Float32Array(reg.length * 3);
      // a collapsed vertex's blended matrix is near-singular: its plain inverse blows the delta up (and overshoots between samples), and a
      // per-vertex cap left steps between neighbours (a crease under exact normals). Tikhonov: dP = (A^T A + l^2 I)^-1 A^T dW, l = 0.35,
      // smooth in A (so over the mesh), exact where A is a rotation
      for (let r = 0; r < reg.length; r++) { const i = reg[r]; tikhonov(A, i * 9, dW[i * 3], dW[i * 3 + 1], dW[i * 3 + 2], 0.35 * 0.35, dP, r * 3); }
      // normals: the change the correction makes to the posed (geometric) normal, rotated back to bind space by the ROTATION part of the
      // vertex's blended matrix (polar decomposition; A^-1 itself is near-singular where plain skinning collapses and turned the change
      // into a dark notch at the front of the armpit: lab_correct5 vars, L21 clasp). In the shader A (n0 + dN) = A n0 + R S R^T dN_world.
      if (o.normals) { const Y = Float32Array.from(X); for (const i of reg) { Y[i * 3] += dW[i * 3]; Y[i * 3 + 1] += dW[i * 3 + 1]; Y[i * 3 + 2] += dW[i * 3 + 2]; }
        const NY = normalsOf(Y, I, NT), NX = normalsOf(X, I, new Float32Array(n * 3)), Rm = new Float64Array(9);
        for (let r = 0; r < reg.length; r++) { const i = reg[r], dx = NY[i * 3] - NX[i * 3], dy = NY[i * 3 + 1] - NX[i * 3 + 1], dz = NY[i * 3 + 2] - NX[i * 3 + 2];
          if (dx * dx + dy * dy + dz * dz < 1e-8) continue; polarRot(A, i * 9, Rm);
          // R^T d (Rm column-major like A: element (row a, col b) at b * 3 + a)
          dN[r * 3] = Rm[0] * dx + Rm[1] * dy + Rm[2] * dz; dN[r * 3 + 1] = Rm[3] * dx + Rm[4] * dy + Rm[5] * dz; dN[r * 3 + 2] = Rm[6] * dx + Rm[7] * dy + Rm[8] * dz; } }
      let mx = 0; for (let r = 0; r < reg.length; r++) mx = Math.max(mx, Math.hypot(dP[r * 3], dP[r * 3 + 1], dP[r * 3 + 2]));
      samples.push({ name: s.name, dir: s.dir ? s.dir.toArray() : null, flex: s.flex ?? null, dP, dN, maxMm: +(mx * 1000 / (k || 1)).toFixed(1), penMm: pen ? +(pen.max * 1000).toFixed(1) : 0 });
    }
    groups.push({ name: gname, kind: G.kind, X: G.X, sg: G.sg, bone: G.bone, parent: G.parent || null, reg: Int32Array.from(reg), samples, f0: G.f0 ?? null, axis: G.axis?.toArray() || null, d0: G.d0?.toArray() || null,
      a: G.a?.toArray() || null, c: G.c.toArray(), b: G.b?.toArray() || null });
    tGroup[gname] = Math.round(now() - t0);
  }
  // restore the pose
  h.bones.forEach((Bn, i) => { Bn.quaternion.copy(save[i][0]); Bn.position.copy(save[i][1]); Bn.scale.copy(save[i][2]); }); h.group.updateMatrixWorld(true);
  // the forearm twist (analytic): per side the elbow centre, the bind forearm axis and length, the three bones
  const twist = ['L', 'R'].map(Xs => { const e = h.head0[h.idx['lowerarm01.' + Xs]], w = h.head0[h.idx['wrist.' + Xs]], ax = w.clone().sub(e); const L = ax.length(); ax.normalize();
    return { X: Xs, c: e.toArray(), ax: ax.toArray(), L, bones: ['lowerarm01.' + Xs, 'lowerarm02.' + Xs, 'wrist.' + Xs].map(b => h.idx[b]) }; });
  return { version: CORRECT_VERSION, n, k, groups, twist, opts: o, ms: { total: Math.round(now() - T0), groups: tGroup }, fat: !!fatT };
}
// x = (A^T A + l2 I)^-1 A^T d (A column-major: element (row a, col b) at o + b * 3 + a)
function tikhonov(A, o, dx, dy, dz, l2, out, oi) {
  const c0 = [A[o], A[o + 1], A[o + 2]], c1 = [A[o + 3], A[o + 4], A[o + 5]], c2 = [A[o + 6], A[o + 7], A[o + 8]], C = [c0, c1, c2], dd = [dx, dy, dz];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const M = [[dot(c0, c0) + l2, dot(c0, c1), dot(c0, c2)], [dot(c1, c0), dot(c1, c1) + l2, dot(c1, c2)], [dot(c2, c0), dot(c2, c1), dot(c2, c2) + l2]], b = C.map(c => dot(c, dd));
  const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  if (Math.abs(det) < 1e-12) { out[oi] = out[oi + 1] = out[oi + 2] = 0; return; }
  const inv = [[M[1][1] * M[2][2] - M[1][2] * M[2][1], M[0][2] * M[2][1] - M[0][1] * M[2][2], M[0][1] * M[1][2] - M[0][2] * M[1][1]],
    [M[1][2] * M[2][0] - M[1][0] * M[2][2], M[0][0] * M[2][2] - M[0][2] * M[2][0], M[0][2] * M[1][0] - M[0][0] * M[1][2]],
    [M[1][0] * M[2][1] - M[1][1] * M[2][0], M[0][1] * M[2][0] - M[0][0] * M[2][1], M[0][0] * M[1][1] - M[0][1] * M[1][0]]];
  // l2 also shrinks a pure rotation's solution by 1 / (1 + l2): put that back so a rigid vertex is exact
  const f = (1 + l2) / det; for (let a = 0; a < 3; a++) out[oi + a] = f * (inv[a][0] * b[0] + inv[a][1] * b[1] + inv[a][2] * b[2]);
}
// the rotation of a 3x3 (column-major, as A) by Newton's polar iteration X <- (X + X^-T) / 2
function polarRot(A, o, R) {
  let a = A[o], b = A[o + 3], c = A[o + 6], d = A[o + 1], e = A[o + 4], f = A[o + 7], g = A[o + 2], h = A[o + 5], k = A[o + 8];   // row-major a b c / d e f / g h k
  for (let it = 0; it < 8; it++) { const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g); if (Math.abs(det) < 1e-9) break; const id = 1 / det;
    // inverse transpose = cofactor / det
    const ia = (e * k - f * h) * id, ib = -(d * k - f * g) * id, ic = (d * h - e * g) * id, id_ = -(b * k - c * h) * id, ie = (a * k - c * g) * id, if_ = -(a * h - b * g) * id, ig = (b * f - c * e) * id, ih = -(a * f - c * d) * id, ik = (a * e - b * d) * id;
    a = 0.5 * (a + ia); b = 0.5 * (b + ib); c = 0.5 * (c + ic); d = 0.5 * (d + id_); e = 0.5 * (e + ie); f = 0.5 * (f + if_); g = 0.5 * (g + ig); h = 0.5 * (h + ih); k = 0.5 * (k + ik); }
  R[0] = a; R[1] = d; R[2] = g; R[3] = b; R[4] = e; R[5] = h; R[6] = c; R[7] = f; R[8] = k;
}
// Laplacian smoothing of positions on a vertex subset (the rest held), Jacobi, lambda 0.5
function smooth(S, list, off, nb, iters, tmp) {
  for (let t = 0; t < iters; t++) {
    for (const i of list) { let x = 0, y = 0, z = 0; const a = off[i], b = off[i + 1]; for (let e = a; e < b; e++) { const j = nb[e]; x += S[j * 3]; y += S[j * 3 + 1]; z += S[j * 3 + 2]; } const c = b - a || 1;
      tmp[i * 3] = S[i * 3] + 0.5 * (x / c - S[i * 3]); tmp[i * 3 + 1] = S[i * 3 + 1] + 0.5 * (y / c - S[i * 3 + 1]); tmp[i * 3 + 2] = S[i * 3 + 2] + 0.5 * (z / c - S[i * 3 + 2]); }
    for (const i of list) { S[i * 3] = tmp[i * 3]; S[i * 3 + 1] = tmp[i * 3 + 1]; S[i * 3 + 2] = tmp[i * 3 + 2]; } }
}
function smoothField(F, list, inReg, off, nb, iters, tmp) {
  for (let t = 0; t < iters; t++) {
    for (const i of list) { let x = 0, y = 0, z = 0, c = 0; for (let e = off[i]; e < off[i + 1]; e++) { const j = nb[e]; x += F[j * 3]; y += F[j * 3 + 1]; z += F[j * 3 + 2]; c++; } c = c || 1;
      tmp[i * 3] = 0.5 * F[i * 3] + 0.5 * x / c; tmp[i * 3 + 1] = 0.5 * F[i * 3 + 1] + 0.5 * y / c; tmp[i * 3 + 2] = 0.5 * F[i * 3 + 2] + 0.5 * z / c; }
    for (const i of list) { F[i * 3] = tmp[i * 3]; F[i * 3 + 1] = tmp[i * 3 + 1]; F[i * 3 + 2] = tmp[i * 3 + 2]; } }
  void inReg;
}
// an orthonormal frame at a vertex of a surface (rows: tangent, bitangent, normal), the tangent toward its first neighbour
function frameAt(S, N, off, nb, i) {
  const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2], j = nb[off[i]];
  let tx = S[j * 3] - S[i * 3], ty = S[j * 3 + 1] - S[i * 3 + 1], tz = S[j * 3 + 2] - S[i * 3 + 2]; const dd = tx * nx + ty * ny + tz * nz; tx -= dd * nx; ty -= dd * ny; tz -= dd * nz;
  const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l; const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
  return [tx, ty, tz, bx, by, bz, nx, ny, nz];
}
// contact on the bisecting plane of a hinge (elbow, knee) or of the hip (the trunk's axis and the thigh): the two segments' tissue
// meets on the plane on the flexion side instead of passing through. Returns the penetration per vertex (metres) for the bulge.
function contactPlane(h, G, s, reg, om, T, fatT, k) {
  h.group.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(h.body.matrixWorld).invert(), J = nm => V3().setFromMatrixPosition(h.bone(nm).matrixWorld).applyMatrix4(toLocal);
  let c, up, uc;
  if (G.kind === 'hinge') { const nmA = G.name.startsWith('elbow') ? 'upperarm01.' : 'upperleg01.', nmB = G.name.startsWith('elbow') ? 'wrist.' : 'foot.';
    c = J(G.bone); up = J(nmA + G.X).sub(c).normalize(); uc = J(nmB + G.X).sub(c).normalize(); }
  else { c = J(G.bone); up = V3(0, 1, 0); uc = J('lowerleg01.' + G.X).sub(c).normalize(); }
  const inner = up.clone().add(uc); if (inner.length() < 0.8) return null;           // the segments more than ~130 deg apart: nothing meets
  inner.normalize(); const nrm = uc.clone().sub(up).normalize(), gap = 0.0008 * k;
  const pen = new Float32Array(T.length / 3); let mx = 0, cnt = 0;
  for (const i of reg) { const w = om[i]; const x = T[i * 3] - c.x, y = T[i * 3 + 1] - c.y, z = T[i * 3 + 2] - c.z;
    if (x * inner.x + y * inner.y + z * inner.z <= 0) continue;                         // the flexion side only
    const sd = x * nrm.x + y * nrm.y + z * nrm.z;                                        // + = the child's half
    // the child's tissue may not cross into the parent's half and vice versa; a vertex shared by both (w ~ 0.5) sits on the plane
    const target = w > 0.62 ? Math.max(sd, gap) : w < 0.38 ? Math.min(sd, -gap) : 0;
    if ((w > 0.62 && sd >= gap) || (w < 0.38 && sd <= -gap)) continue;
    const mv = target - sd; if (Math.abs(mv) < 1e-6) continue;
    T[i * 3] += nrm.x * mv; T[i * 3 + 1] += nrm.y * mv; T[i * 3 + 2] += nrm.z * mv; pen[i] = Math.abs(mv); mx = Math.max(mx, Math.abs(mv)); cnt++; }
  void s; void fatT; return { pen, max: mx, count: cnt };
}
// contact between the arm's surface and the trunk's (the armpit, the chest wall under an adducted arm): each side's vertices inside
// the other's surface (signed distance along the other's normal) are pushed out; the trunk gives way by its fat's share
function contactSurface(G, reg, om, T, I, fatT, k, NT, s) {
  const n = T.length / 3, N = normalsOf(T, I, NT), arm = [], trunk = []; for (const i of reg) { if (om[i] > 0.75) arm.push(i); else if (om[i] < 0.25) trunk.push(i); }
  if (!arm.length || !trunk.length) return null;
  const gap = 0.001 * k, r = 0.03 * k, gA = new Grid(T, arm, 0.015 * k), gT = new Grid(T, trunk, 0.015 * k), pen = new Float32Array(n), mv = new Float32Array(n * 3); let mx = 0, cnt = 0;
  const soft = i => fatT ? clamp(fatT[i] / 0.03, 0.15, 0.85) : 0.5;
  const pass = (from, grid, share) => { for (const i of from) { const j = grid.nearest(T[i * 3], T[i * 3 + 1], T[i * 3 + 2], r); if (j < 0) continue;
      const nx = N[j * 3], ny = N[j * 3 + 1], nz = N[j * 3 + 2], sd = (T[i * 3] - T[j * 3]) * nx + (T[i * 3 + 1] - T[j * 3 + 1]) * ny + (T[i * 3 + 2] - T[j * 3 + 2]) * nz;
      if (sd >= gap) continue; if (N[i * 3] * nx + N[i * 3 + 1] * ny + N[i * 3 + 2] * nz > -0.2) continue;   // facing each other only (inside, not beside)
      const d = (gap - sd) * share(i, j); if (d <= 0) continue; mv[i * 3] += nx * d; mv[i * 3 + 1] += ny * d; mv[i * 3 + 2] += nz * d; pen[i] = Math.max(pen[i], d); mx = Math.max(mx, d); cnt++; } };
  pass(arm, gT, (i, j) => 1 - soft(j));      // the arm gives (1 - the trunk's softness)
  pass(trunk, gA, (i) => soft(i));           // the trunk gives its softness
  for (let i = 0; i < n; i++) if (pen[i]) { T[i * 3] += mv[i * 3]; T[i * 3 + 1] += mv[i * 3 + 1]; T[i * 3 + 2] += mv[i * 3 + 2]; }
  void s; void G; return { pen, max: mx, count: cnt };
}
// the displaced tissue: a bulge beside the contact along the posed normal, from the penetration diffused 2-3 cm, larger where the fat is thick
function bulgeBand(reg, P, T, I, off, nb, fatT, k, NT, inReg, gain) {
  const pen = P.pen, n = T.length / 3, F = new Float32Array(n), F2 = new Float32Array(n);
  for (const i of reg) F[i] = pen[i];
  for (let t = 0; t < 10; t++) { for (const i of reg) { let s = 0, c = 0; for (let e = off[i]; e < off[i + 1]; e++) { const j = nb[e]; if (!inReg[j]) continue; s += F[j]; c++; } F2[i] = Math.max(pen[i], c ? 0.5 * F[i] + 0.5 * s / c : F[i]); } for (const i of reg) F[i] = F2[i]; }
  const N = normalsOf(T, I, NT);
  for (const i of reg) { if (pen[i] > 0) continue; const f = F[i]; if (f <= 1e-5) continue; const kap = (0.25 + 0.45 * (fatT ? clamp(fatT[i] / 0.025) : 0.4)) * gain, b = Math.min(f * kap, 0.012 * k);
    T[i * 3] += N[i * 3] * b; T[i * 3 + 1] += N[i * 3 + 1] * b; T[i * 3 + 2] += N[i * 3 + 2] * b; }
}

// ---------------------------------------------------------------- the GPU side
const VERT_PARS = `attribute vec4 aCorr; uniform highp sampler2D uCorrTex; uniform vec4 uCorrW[16]; uniform int uCorrK[8]; uniform float uCorrOn, uCorrTw;
uniform vec3 uTwA[2]; uniform vec3 uTwB[2]; uniform vec3 uTwC[2]; uniform vec3 uTwX[2]; uniform vec2 uTwL;
vec3 crFetch(int i) { return texelFetch(uCorrTex, ivec2(i % ${TEXW}, i / ${TEXW}), 0).xyz; }
float crW(int g, int k) { int j = g * ${KMAX} + k; return uCorrW[j / 4][j % 4]; }
vec3 crTwist(vec3 p) {
#ifdef USE_SKINNING
  vec2 z = vec2(0.0); float wm = 0.0; int sd = -1;
  for (int j = 0; j < 4; j++) { float w = skinWeight[j]; if (w <= 0.0) continue; float b = skinIndex[j];
    for (int s = 0; s < 2; s++) { vec3 B = uTwB[s], Aa = uTwA[s]; float a = 0.0; bool m = false;
      if (abs(b - B.x) < 0.5) { a = Aa.x; m = true; } else if (abs(b - B.y) < 0.5) { a = Aa.y; m = true; } else if (abs(b - B.z) < 0.5) { a = Aa.z; m = true; }
      if (m) { z += w * vec2(cos(a), sin(a)); wm += w; sd = s; } } }
  if (sd < 0) return vec3(0.0);
  vec3 c = uTwC[sd], ax = uTwX[sd]; vec3 d = p - c; float al = dot(d, ax), L = sd == 0 ? uTwL.x : uTwL.y; vec3 r = d - al * ax;
  float rest = al > 0.5 * L ? uTwA[sd].z : 0.0; z += (1.0 - wm) * vec2(cos(rest), sin(rest));
  float mg = length(z), s = 1.0 / max(mg, 0.55) - 1.0;
  float fade = smoothstep(-0.07 * L, -0.02 * L, al) * (1.0 - smoothstep(L + 0.1 * L, L + 0.25 * L, al));
  return r * s * fade;
#else
  return vec3(0.0);   // an unskinned draw of a corrected body (the Cycles UV bake strips skinIndex / skinWeight): no twist
#endif
}`;
const VERT_C = `
vec3 crDP = vec3(0.0), crDN = vec3(0.0);
if (uCorrOn > 0.0) {
  for (int s = 0; s < 2; s++) { float base = s == 0 ? aCorr.x : aCorr.z; if (base < 0.5) continue; int g = int((s == 0 ? aCorr.y : aCorr.w) + 0.5), b0 = int(base + 0.5) - 1, K = uCorrK[g];
    for (int k = 0; k < ${KMAX}; k++) { if (k >= K) break; float w = crW(g, k); if (abs(w) < 1e-4) continue; int t = (b0 + k) * 2; crDP += w * crFetch(t); crDN += w * crFetch(t + 1); } }
  crDP *= uCorrOn; crDN *= uCorrOn; }`;
const VERT_NADD = `\nobjectNormal += crDN;`;
const VERT_P = `if (uCorrOn > 0.0) { transformed += crDP; if (uCorrTw > 0.0) transformed += uCorrTw * crTwist(transformed); }`;

function patchMaterial(mat, U) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (sh, r) => { prev?.(sh, r); let vs = sh.vertexShader; if (!vs.includes('#include <morphtarget_vertex>') || !vs.includes('#include <common>')) return;   // no anchor: left as it was
    Object.assign(sh.uniforms, U); const hasN = vs.includes('#include <morphnormal_vertex>');
    vs = vs.replace('#include <common>', '#include <common>\n' + VERT_PARS);
    if (hasN) vs = vs.replace('#include <morphnormal_vertex>', '#include <morphnormal_vertex>\n' + VERT_C + VERT_NADD);
    sh.vertexShader = vs.replace('#include <morphtarget_vertex>', '#include <morphtarget_vertex>\n' + (hasN ? '' : VERT_C) + VERT_P); };
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|correct5';
  mat.needsUpdate = true;
}

// pack the samples: per (vertex, group) a slot of K samples, each two texels (position, normal); aCorr = (slot0 + 1, group0, slot1 + 1, group1)
export function packCorrectives(data, minMm = CORRECT_DEFAULTS.minMm, extra = null) {
  const n = data.n, aCorr = new Float32Array(n * 4), used = new Uint8Array(n), thr = minMm / 1000 * data.k;
  const rows = []; let next = 0; const gK = new Int32Array(GROUPS.length);
  for (const G of data.groups) { const gi = GROUPS.indexOf(G.name), K = G.samples.length; gK[gi] = K;
    for (let r = 0; r < G.reg.length; r++) { const i = G.reg[r]; let mx = 0; for (const s of G.samples) mx = Math.max(mx, Math.abs(s.dP[r * 3]), Math.abs(s.dP[r * 3 + 1]), Math.abs(s.dP[r * 3 + 2])); if (mx < thr) continue;
      if (used[i] >= 2) continue; const sl = used[i]++; aCorr[i * 4 + sl * 2] = next + 1; aCorr[i * 4 + sl * 2 + 1] = gi; rows.push([G, r, next]); next += K; } }
  // rows of other meshes (the garments' own, carried from the body: carryParts) after the body's
  const ex = extra ? extra(next, thr) : null; if (ex) next = ex.next;
  const texels = next * 2, H = Math.max(1, Math.ceil(texels / TEXW)), buf = new Float32Array(TEXW * H * 4);
  for (const [G, r, b0] of rows) G.samples.forEach((s, kk) => { const t = (b0 + kk) * 2; buf.set([s.dP[r * 3], s.dP[r * 3 + 1], s.dP[r * 3 + 2], 0], t * 4); buf.set([s.dN[r * 3], s.dN[r * 3 + 1], s.dN[r * 3 + 2], 0], (t + 1) * 4); });
  if (ex) for (const R of ex.rows) for (let kk = 0; kk < R.K; kk++) { const t = (R.base + kk) * 2; buf.set([R.dP[kk * 3], R.dP[kk * 3 + 1], R.dP[kk * 3 + 2], 0], t * 4); buf.set([R.dN[kk * 3], R.dN[kk * 3 + 1], R.dN[kk * 3 + 2], 0], (t + 1) * 4); }
  return { aCorr, buf, H, slots: rows.length + (ex ? ex.rows.length : 0), samples: next, gK, bytes: buf.byteLength + aCorr.byteLength, extra: ex };
}
// the garments (and underwear) follow the corrected body: each part vertex gets its OWN rows, the body's sample deltas averaged over the
// body vertices within 2.5 cm of it in bind space (Gaussian, 1.2 cm), so a strap or a waistband moves as one piece (copying the nearest
// body vertex's slots tore thin straps into shards: farm job 1004-023133, L22 raise)
function carryParts(h, data, parts, next0, thr) {
  const g = h.body.geometry, n = data.n, bodyP = g.attributes.position.array, I0 = g.userData.plan?.tri || g.index.array, seen = new Uint8Array(n), list = [];
  for (let t = 0; t < I0.length; t++) { const i = I0[t]; if (!seen[i]) { seen[i] = 1; list.push(i); } }
  const k = data.k, grid = new Grid(bodyP, list, 0.02 * k), R = 0.025 * k, s2 = (0.012 * k) ** 2, ridx = data.groups.map(G => { const m = new Int32Array(n).fill(-1); G.reg.forEach((i, r) => { m[i] = r; }); return m; });
  let next = next0; const rows = [], attrs = [], js = [], ws = [];
  for (const pm of parts) { const X = pm.geometry.attributes.position.array, np = X.length / 3, a = new Float32Array(np * 4); let hit = 0;
    for (let v = 0; v < np; v++) { js.length = 0; ws.length = 0; grid.each(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], R, (j, q) => { js.push(j); ws.push(Math.exp(-q / s2)); }); if (!js.length) continue;
      let wsum = 0; for (const w of ws) wsum += w; const cand = [];
      data.groups.forEach((G, gi) => { const K = G.samples.length, m = ridx[gi]; let any = false; for (const j of js) if (m[j] >= 0) { any = true; break; } if (!any) return;
        const dP = new Float32Array(K * 3), dN = new Float32Array(K * 3); let mx = 0;
        G.samples.forEach((sm, kk) => { let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0; for (let q = 0; q < js.length; q++) { const r = m[js[q]]; if (r < 0) continue; const w = ws[q]; x += w * sm.dP[r * 3]; y += w * sm.dP[r * 3 + 1]; z += w * sm.dP[r * 3 + 2]; nx += w * sm.dN[r * 3]; ny += w * sm.dN[r * 3 + 1]; nz += w * sm.dN[r * 3 + 2]; }
          dP[kk * 3] = x / wsum; dP[kk * 3 + 1] = y / wsum; dP[kk * 3 + 2] = z / wsum; dN[kk * 3] = nx / wsum; dN[kk * 3 + 1] = ny / wsum; dN[kk * 3 + 2] = nz / wsum; mx = Math.max(mx, Math.abs(dP[kk * 3]), Math.abs(dP[kk * 3 + 1]), Math.abs(dP[kk * 3 + 2])); });
        if (mx >= thr) cand.push({ gi: GROUPS.indexOf(G.name), K, dP, dN, mx }); });
      cand.sort((p, q) => q.mx - p.mx); cand.slice(0, 2).forEach((c, sl) => { a[v * 4 + sl * 2] = next + 1; a[v * 4 + sl * 2 + 1] = c.gi; rows.push({ base: next, K: c.K, dP: c.dP, dN: c.dN }); next += c.K; });
      if (cand.length) hit++; }
    attrs.push({ pm, a, hit }); }
  return { rows, next, attrs };
}

// ---------------------------------------------------------------- the drivers (per frame)
const swingTwistAngle = (q, ax) => 2 * Math.atan2(q.x * ax.x + q.y * ax.y + q.z * ax.z, q.w);
export function correctiveWeights(h, data, o = {}) {
  const sig = (o.sigma ?? data.opts.sigma) * deg, W = new Float32Array(GROUPS.length * KMAX), drive = {};
  h.group.updateMatrixWorld(true);
  const qG = new THREE.Quaternion(); h.group.getWorldQuaternion(qG); const qGi = qG.clone().invert();
  const J = nm => V3().setFromMatrixPosition(h.bone(nm).matrixWorld);
  for (const G of data.groups) { const gi = GROUPS.indexOf(G.name), K = G.samples.length;
    if (G.kind === 'swing') {
      const qB = new THREE.Quaternion(); h.bone(G.parent).getWorldQuaternion(qB); const qRel = qGi.clone().multiply(qB).invert();
      const d = J(G.bone.replace('01', '01')).negate().add(J(G.name.startsWith('shoulder') ? 'lowerarm01.' + G.X : 'lowerleg01.' + G.X)).applyQuaternion(qGi).applyQuaternion(qRel).normalize();
      const d0 = V3(...G.d0), ws = [], a0 = Math.acos(clamp(d.dot(d0), -1, 1)); let sum = Math.exp(-((a0 / sig) ** 2));
      for (const s of G.samples) { const a = Math.acos(clamp(d.dot(V3(...s.dir)), -1, 1)), w = Math.exp(-((a / sig) ** 2)); ws.push(w); sum += w; }
      if (sum < 1e-6) { // far from every sample: the nearest one
        let bi = -1, ba = Infinity; G.samples.forEach((s, kk) => { const a = Math.acos(clamp(d.dot(V3(...s.dir)), -1, 1)); if (a < ba) { ba = a; bi = kk; } }); if (a0 > ba) ws[bi] = 1; sum = 1; }
      ws.forEach((w, kk) => { W[gi * KMAX + kk] = w / sum; }); drive[G.name] = { dir: d.toArray().map(x => +x.toFixed(3)), fromBindDeg: +(a0 / deg).toFixed(1) };
    } else {
      const a = J(G.name.startsWith('elbow') ? 'upperarm01.' + G.X : 'upperleg01.' + G.X), c = J(G.bone), b = J(G.name.startsWith('elbow') ? 'wrist.' + G.X : 'foot.' + G.X);
      const f = Math.acos(clamp(c.clone().sub(a).normalize().dot(b.clone().sub(c).normalize()), -1, 1)) / deg;
      // a tent over the knots (the bind flexion = the zero sample)
      const knots = [{ f: G.f0, k: -1 }, ...G.samples.map((s, kk) => ({ f: s.flex, k: kk }))].sort((p, q) => p.f - q.f);
      let j = 0; while (j < knots.length - 1 && f > knots[j + 1].f) j++;
      if (f <= knots[0].f) { if (knots[0].k >= 0) W[gi * KMAX + knots[0].k] = clamp(1 - (knots[0].f - f) / 30); }
      else if (j >= knots.length - 1) { const kl = knots[knots.length - 1]; if (kl.k >= 0) W[gi * KMAX + kl.k] = 1; }
      else { const p = knots[j], q = knots[j + 1], u = (f - p.f) / Math.max(1e-6, q.f - p.f); if (p.k >= 0) W[gi * KMAX + p.k] = 1 - u; if (q.k >= 0) W[gi * KMAX + q.k] = u; }
      drive[G.name] = { flex: +f.toFixed(1), bind: +G.f0.toFixed(1) };
    }
    void K; }
  // the forearm twist: cumulative twist of lowerarm01, lowerarm02, the wrist about the bind forearm axis (radians)
  const tw = data.twist.map(T => { const ax = V3(...T.ax); let acc = 0; return T.bones.map(bi => { acc += swingTwistAngle(h.bones[bi].quaternion, ax); return acc; }); });
  data.twist.forEach((T, s) => { drive['twist.' + T.X] = tw[s].map(x => +(x / deg).toFixed(1)); });
  return { W, tw, drive };
}

// ---------------------------------------------------------------- apply to a person (page or node)
export function applyCorrectives(P, opts = {}) {
  const h = P.h || P, t0 = now();
  if (!h.body?.isSkinnedMesh) throw new Error('applyCorrectives: a hero with a skinned body');
  if (h.correct) h.correct.dispose();
  const data = opts.data || bakeCorrectives(h, opts), tBake = now() - t0, parts = opts.garments === false ? [] : partsOf(h);
  const pk = packCorrectives(data, opts.minMm ?? CORRECT_DEFAULTS.minMm, parts.length ? (n0, thr) => carryParts(h, data, parts, n0, thr) : null), tPack = now();
  const g = h.body.geometry; g.setAttribute('aCorr', new THREE.BufferAttribute(pk.aCorr, 4));
  const tex = new THREE.DataTexture(pk.buf, TEXW, pk.H, THREE.RGBAFormat, THREE.FloatType); tex.needsUpdate = true; tex.magFilter = tex.minFilter = THREE.NearestFilter;
  const U = { uCorrTex: { value: tex }, uCorrW: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }, uCorrK: { value: Array.from(pk.gK) }, uCorrOn: { value: 1 }, uCorrTw: { value: opts.twist === 0 || opts.twist === false ? 0 : 1 },
    uTwA: { value: [V3(), V3()] }, uTwB: { value: data.twist.map(T => V3(...T.bones)) }, uTwC: { value: data.twist.map(T => V3(...T.c)) }, uTwX: { value: data.twist.map(T => V3(...T.ax)) }, uTwL: { value: new THREE.Vector2(data.twist[0].L, data.twist[1].L) } };
  const mat = h.body.material; if (!mat.userData.correct5) { patchMaterial(mat, U); mat.userData.correct5 = U; } else Object.assign(mat.userData.correct5.uCorrTex, { value: tex });
  const Uu = mat.userData.correct5; Object.assign(Uu.uCorrK, U.uCorrK); Uu.uTwB.value = U.uTwB.value; Uu.uTwC.value = U.uTwC.value; Uu.uTwX.value = U.uTwX.value; Uu.uTwL.value = U.uTwL.value; Uu.uCorrTex.value = tex;
  // the garments' rows (carryParts, packed above): their attribute and the same patch, sharing this body's uniforms
  const partRep = [];
  for (const { pm, a, hit } of (pk.extra?.attrs || [])) { pm.geometry.setAttribute('aCorr', new THREE.BufferAttribute(a, 4)); const pmat = pm.material; if (!pmat.userData.correct5) { patchMaterial(pmat, Uu); pmat.userData.correct5 = Uu; }
    partRep.push({ name: pm.userData.k3?.name || pm.name || 'part', n: a.length / 4, carried: hit }); }
  let last = null, gain = 1;
  const update = () => { const r = correctiveWeights(h, data); for (let j = 0; j < 16; j++) Uu.uCorrW.value[j].set(r.W[j * 4] * gain, r.W[j * 4 + 1] * gain, r.W[j * 4 + 2] * gain, r.W[j * 4 + 3] * gain);
    Uu.uTwA.value[0].set(...r.tw[0]); Uu.uTwA.value[1].set(...r.tw[1]); last = r; return r; };
  // the bind positions with the current pose's correctives (for an export or a cloth bake that skins on the CPU)
  const correctedBind = (out = null) => { const r = last || update(), P0 = (h.body.userData.correctBase ||= Float32Array.from(g.attributes.position.array)), n = data.n; out = out || new Float32Array(n * 3); out.set(P0);
    if (!Uu.uCorrOn.value) return out; const on = Uu.uCorrOn.value * gain;
    for (const G of data.groups) { const gi = GROUPS.indexOf(G.name); G.samples.forEach((s, kk) => { const w = r.W[gi * KMAX + kk] * on; if (Math.abs(w) < 1e-4) return;
      for (let q = 0; q < G.reg.length; q++) { const i = G.reg[q]; if (!slotted(pk.aCorr, i, gi)) continue; out[i * 3] += w * s.dP[q * 3]; out[i * 3 + 1] += w * s.dP[q * 3 + 1]; out[i * 3 + 2] += w * s.dP[q * 3 + 2]; } }); }
    if (Uu.uCorrTw.value) twistCPU(out, g.attributes.skinIndex.array, g.attributes.skinWeight.array, data, r.tw, Uu.uCorrTw.value);
    return out; };
  const stats = { version: CORRECT_VERSION, bakeMs: Math.round(tBake), groups: data.groups.map(G => ({ name: G.name, region: G.reg.length, samples: G.samples.map(s => ({ name: s.name, maxMm: s.maxMm, penMm: s.penMm })) })),
    slots: pk.slots, samples: pk.samples, texture: [TEXW, pk.H], bytes: pk.bytes, fat: data.fat, ms: data.ms, parts: partRep, packMs: Math.round(tPack - t0 - tBake) };
  const C = { data, stats, U: Uu, update, correctedBind, get last() { return last; },
    set: q => { if (q.on != null) Uu.uCorrOn.value = q.on ? 1 : 0; if (q.twist != null) Uu.uCorrTw.value = +q.twist; if (q.gain != null) { gain = q.gain; update(); } },
    dispose: () => { tex.dispose(); } };
  h.correct = C; if (P.h) P.correct = C; update();
  return C;
}
// the parts that ride this body's skeleton (makePerson's garments, underwear, boots: meshes carrying userData.k3)
function partsOf(h) { const L = []; (h.body.parent || h.group).traverse(m => { if (m !== h.body && m.isSkinnedMesh && m.skeleton === h.skeleton && m.userData?.k3 && m.geometry?.attributes?.skinIndex && !Array.isArray(m.material)) L.push(m); }); return L; }
function slotted(aCorr, i, gi) { return (aCorr[i * 4] > 0 && aCorr[i * 4 + 1] === gi) || (aCorr[i * 4 + 2] > 0 && aCorr[i * 4 + 3] === gi); }
function twistCPU(out, SI, SW, data, tw, gain) {
  for (let i = 0; i < data.n; i++) { let zx = 0, zy = 0, wm = 0, sd = -1;
    for (let j = 0; j < 4; j++) { const w = SW[i * 4 + j]; if (!w) continue; const b = SI[i * 4 + j];
      for (let s = 0; s < 2; s++) { const kk = data.twist[s].bones.indexOf(b); if (kk < 0) continue; zx += w * Math.cos(tw[s][kk]); zy += w * Math.sin(tw[s][kk]); wm += w; sd = s; } }
    if (sd < 0) continue; const T = data.twist[sd], c = T.c, ax = T.ax, L = T.L, dx = out[i * 3] - c[0], dy = out[i * 3 + 1] - c[1], dz = out[i * 3 + 2] - c[2], al = dx * ax[0] + dy * ax[1] + dz * ax[2];
    const rest = al > 0.5 * L ? tw[sd][2] : 0; zx += (1 - wm) * Math.cos(rest); zy += (1 - wm) * Math.sin(rest);
    const s = 1 / Math.max(Math.hypot(zx, zy), 0.55) - 1, fade = sst(-0.07 * L, -0.02 * L, al) * (1 - sst(1.1 * L, 1.25 * L, al)), f = s * fade * gain;
    out[i * 3] += (dx - al * ax[0]) * f; out[i * 3 + 1] += (dy - al * ax[1]) * f; out[i * 3 + 2] += (dz - al * ax[2]) * f; }
}
// for the test and the lab's rulers
export const _internal = { boneMats, skinLBS, normalsOf, adjacency, Grid, sideDir, SHOULDER_DIRS, HIP_DIRS };
