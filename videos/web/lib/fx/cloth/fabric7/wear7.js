// FABRIC7 wear7 (c6 it2, 15 Oct): WEAR FROM THE BODY'S MOTION. What it replaces: fabric6.js's wearZones, a set of Gaussians hand-placed on bones ('the front of the knee', 'the lap, 2-24 cm below the hip joint', 'the seat'): zone art,
// the same on every person and every garment, which is why the jeans' whiskers read as painted ripples (the critic of 15 Oct: 'they have no relation to where the cloth creases'; the client: no zones painted by hand).
//
// THE MODEL. Cloth wears where it is worked. A person's day is a handful of postures, each a pose of the person's OWN skeleton (the hero's bones, by name: hip, knee, elbow, shoulder, lumbar flexion). Each posture is
// run on the garment on the CPU: every vertex skinned by the garment's own skin weights (the dressing's weights, the ones the engine draws with), the strain of the posed cloth against its flat pattern measured the way
// strainField measures the dressed one (the deformation gradient of every triangle from the pattern: fabric6.js tensorField). What the posture adds to the strain the garment already has standing is its WORK:
//   compression  the smaller principal stretch falls below the pattern's: the cloth folds (the front of the hip and the groin when sitting, the back of the knee, the crook of the elbow), in lines ACROSS the compression
//   tension      the larger stretch exceeds the pattern's: the cloth is dragged and rubbed (the front of the knee, the seat, the point of the elbow, the shoulder blades)
// Wear accumulates over the day's postures, weighted by how often each is taken (POSTURES7; our assumption, from time-use studies: sitting dominates a working adult's day, walking a little over an hour, the rest brief):
//   T  the abrasion, 1 - exp(-sum_k w_k tension_k / T_ref)        the fade, pilling, shine of a rubbed place
//   F  the fold wear, 1 - exp(-sum_k w_k compression_k / F_ref)   the pale creased line: the ridge of a crease the cloth takes again and again
//   d  the direction the compression comes from (the doubled angle theta of the pattern frame, vector-averaged over the postures) and its coherence (1: one direction, 0: none): the lines lie across it
// A person who flexes less (a stiffer or older body: the posture's angles are capped by the person's own range) or whose garment does not move with the joint wears less THERE; a garment that fits loose does not fold. Nothing
// here knows a body part by name except the joints the postures bend: where the wear lands is where the garment's own strain says.
// aF6w (fabric6.js; 4 floats a vertex): (T, F, cos 2theta x coherence, sin 2theta x coherence); the shader draws the fold wear as the cascade's own sparse ridge kernels along the stored direction (F6_WEAR).
// HOW MUCH is the garment's age (the shader's); this module says WHERE: the work is normalised by the garment's own 90th percentile of the worked places (WEAR7.slack is the floor: strain under ~1 % is not wrinkling).
import * as THREE from 'three';
import { tensorField } from '../fabric6.js';

const D2R = Math.PI / 180;
// the day's postures: joint angles in degrees (hip, knee, elbow and shoulder flexion, lumbar flexion spread over spine05 .. spine03) and the share of the day's movement each accounts for. `mirror` runs the posture on the other side too.
export const POSTURES7 = [
  { name: 'sit',    w: 0.34, L: { hip: 95, knee: 95, elbow: 90, shoulder: 20 }, R: { hip: 95, knee: 95, elbow: 90, shoulder: 20 }, spine: 0 },
  { name: 'stride', w: 0.20, L: { hip: 28, knee: 60, elbow: 25, shoulder: -20 }, R: { hip: -12, knee: 5, elbow: 20, shoulder: 20 }, spine: 0, mirror: true },
  { name: 'crouch', w: 0.08, L: { hip: 115, knee: 125, elbow: 60, shoulder: 30 }, R: { hip: 115, knee: 125, elbow: 60, shoulder: 30 }, spine: 15 },
  { name: 'stoop',  w: 0.08, L: { hip: 20, knee: 8, elbow: 20, shoulder: 40 }, R: { hip: 20, knee: 8, elbow: 20, shoulder: 40 }, spine: 45 },
  { name: 'reach',  w: 0.06, L: { hip: 0, knee: 0, elbow: 20, shoulder: 130 }, R: { hip: 0, knee: 0, elbow: 20, shoulder: 130 }, spine: -5 },
  { name: 'carry',  w: 0.10, L: { hip: 0, knee: 0, elbow: 100, shoulder: 25 }, R: { hip: 0, knee: 0, elbow: 100, shoulder: 25 }, spine: 0 },
];
export const WEAR7 = { slack: 0.012, passes: 4, ref: 'time-use: sedentary ~ 8 h of a waking day (Matthews 2008); walking ~ 1 h; the posture shares are our assumption' };

const AX = new THREE.Vector3(1, 0, 0);
function bindPose(skel) {   // each bone's bind-local transform from the bind-world matrices (boneInverses): the pose the garment's vertices are in
  const W = skel.bones.map((b, i) => skel.boneInverses[i].clone().invert()), idx = new Map(skel.bones.map((b, i) => [b, i])), out = [];
  skel.bones.forEach((b, i) => { const par = b.parent && idx.has(b.parent) ? idx.get(b.parent) : -1, L = par >= 0 ? W[par].clone().invert().multiply(W[i]) : b.parent ? b.parent.matrixWorld.clone().invert().multiply(W[i]) : W[i].clone(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); L.decompose(p, q, s); out.push({ p, q, s }); });
  return out;
}

// the person's own posture: the joint angle the posture asks, capped at the range the person has (kin.ranges, when the hero carries it: a stiffer or older body flexes less); null range: the angle as given
function cap(angle, range) { return range && Number.isFinite(range) ? Math.min(angle, range) : angle; }

// skin every vertex with the pose the bones are in now: P' = bindInv * sum_k w_k (bone_k.matrixWorld * boneInverse_k) * bind * P (three's own skinning)
function skin(obj, P, n, out) {
  const sk = obj.skeleton, SI = obj.geometry.attributes.skinIndex.array, SW = obj.geometry.attributes.skinWeight.array, bind = obj.bindMatrix, bi = obj.bindMatrixInverse;
  const A = sk.bones.map((b, i) => bi.clone().multiply(b.matrixWorld).multiply(sk.boneInverses[i]).multiply(bind).elements);
  for (let v = 0; v < n; v++) { const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 4; k++) { const w = SW[v * 4 + k]; if (!(w > 0)) continue; const e = A[SI[v * 4 + k]];
      ox += w * (e[0] * x + e[4] * y + e[8] * z + e[12]); oy += w * (e[1] * x + e[5] * y + e[9] * z + e[13]); oz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]); }
    out[v * 3] = ox; out[v * 3 + 1] = oy; out[v * 3 + 2] = oz; }
  return out;
}

// the compression and tension each vertex carries in one pose: the principal stretches of tensorField against the pattern (norm: the bind state's own normalisation), the compressed direction as a doubled angle
function strainOf(P, UV, I, n, sc, norm, slack) {
  const { eig } = tensorField(P, UV, I, n, sc), comp = new Float32Array(n), ten = new Float32Array(n), cx = new Float32Array(n), cy = new Float32Array(n);
  for (let v = 0; v < n; v++) { const e = eig(v); if (!e) continue; const lo = Math.sqrt(Math.max(0, e.lo)) / norm, hi = Math.sqrt(Math.max(0, e.hi)) / norm;
    comp[v] = Math.max(0, 1 - lo - slack); ten[v] = Math.max(0, hi - 1 - slack);
    let ex = e.b, ey = e.lo - e.a; if (Math.hypot(ex, ey) < 1e-12) { ex = e.lo - e.d; ey = e.b; } if (Math.hypot(ex, ey) < 1e-12) { ex = 1; ey = 0; }
    const th = Math.atan2(ey, ex); cx[v] = Math.cos(2 * th); cy[v] = Math.sin(2 * th); }
  return { comp, ten, cx, cy };
}

// the hook fabric6Attributes calls for a skinned garment (setWear7): fills W (aF6w) for this host
export function wear7(obj, g, P, UV, I, n, sc, W, rep, opts = {}) {
  const t0 = (globalThis.performance || Date).now(), sk = obj.skeleton, A = g.attributes; if (!obj.isSkinnedMesh || !sk || !A.skinIndex || !A.skinWeight || !UV) { rep.wear7 = 'no skin'; return; }
  const O = { ...WEAR7, ...opts }, byName = new Map(sk.bones.map(b => [b.name, b]));
  if (!byName.get('upperleg01.L') || !byName.get('lowerleg01.L') || !byName.get('upperarm01.L') || !byName.get('lowerarm01.L')) { rep.wear7 = 'no joints'; return; }
  const saved = sk.bones.map(b => ({ p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() })), bind = bindPose(sk), ranges = opts.ranges || {};
  const setBind = () => sk.bones.forEach((b, i) => { b.position.copy(bind[i].p); b.quaternion.copy(bind[i].q); b.scale.copy(bind[i].s); });
  const rot = (nm, ang) => { const b = byName.get(nm); if (b) b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(AX, ang * D2R)); };
  const Pp = new Float32Array(n * 3), root = sk.bones.find(b => !b.parent || !sk.bones.includes(b.parent)) || sk.bones[0];
  try {
    setBind(); root.updateMatrixWorld(true);
    const tf0 = tensorField(P, UV, I, n, sc), norm = tf0.norm, base = strainOf(P, UV, I, n, sc, norm, O.slack);
    // the self-check: the bones at bind reproduce the garment's own positions (the bind frame and the skin agree)
    skin(obj, P, n, Pp); let e0 = 0; for (let i = 0; i < n * 3; i++) e0 = Math.max(e0, Math.abs(Pp[i] - P[i])); rep.wear7Bind = +(e0 * 1000).toFixed(3);
    const T = new Float32Array(n), F = new Float32Array(n), Fx = new Float32Array(n), Fy = new Float32Array(n);
    for (const pose of POSTURES7) for (const flip of pose.mirror ? [false, true] : [false]) {
      setBind();
      for (const S of ['L', 'R']) { const j = pose[flip ? (S === 'L' ? 'R' : 'L') : S]; if (!j) continue;
        rot('upperleg01.' + S, -cap(j.hip, ranges.hip)); rot('lowerleg01.' + S, cap(j.knee, ranges.knee)); rot('lowerarm01.' + S, -cap(j.elbow, ranges.elbow)); rot('upperarm01.' + S, -cap(j.shoulder, ranges.shoulder)); }
      if (pose.spine) for (const nm of ['spine05', 'spine04', 'spine03']) rot(nm, pose.spine / 3);
      root.updateMatrixWorld(true); skin(obj, P, n, Pp);
      const s = strainOf(Pp, UV, I, n, sc, norm, O.slack), w = pose.w / (pose.mirror ? 2 : 1);
      for (let v = 0; v < n; v++) { const dc = Math.max(0, s.comp[v] - base.comp[v]), dt = Math.max(0, s.ten[v] - base.ten[v]); T[v] += w * dt; F[v] += w * dc; Fx[v] += w * dc * s.cx[v]; Fy[v] += w * dc * s.cy[v]; } }
    // a coherent field: the same neighbour passes the strain field takes (the mesh's per-vertex noise is not a crease's length)
    const nb = Array.from({ length: n }, () => []); for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k], b = I[t + (k + 1) % 3]; nb[a].push(b); nb[b].push(a); }
    for (let it = 0; it < O.passes; it++) for (const X of [T, F, Fx, Fy]) { const Y = new Float32Array(n); for (let v = 0; v < n; v++) { let s = X[v] * 2, c = 2; for (const u of nb[v]) { s += X[u]; c++; } Y[v] = s / c; } X.set(Y); }
    // how much: the work is normalised by the garment's own 90th percentile of the worked places (a floor at the solver's own slack: strain under ~1 % is not wrinkling), so the fields say WHERE the body works this cloth and
    // the garment's age (the shader's) says how worn it is: a loose coat and a pair of jeans differ in where they are worked and in the folds the cloth can take, not in how long they have been worn
    const pc = (X, q) => { const a = []; for (let v = 0; v < n; v++) if (X[v] > 1e-6) a.push(X[v]); a.sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 0; };
    const tRef = Math.max(pc(T, 0.9), O.slack), fRef = Math.max(pc(F, 0.9), O.slack); let tMax = 0, fMax = 0, nT = 0, nF = 0;
    for (let v = 0; v < n; v++) { const f = 1 - Math.exp(-F[v] / fRef), t = 1 - Math.exp(-T[v] / tRef), mag = Math.hypot(Fx[v], Fy[v]), coh = F[v] > 1e-9 ? Math.min(1, mag / F[v]) : 0, k = mag > 1e-12 ? coh / mag : 0;
      W[v * 4] = t; W[v * 4 + 1] = f; W[v * 4 + 2] = Fx[v] * k; W[v * 4 + 3] = Fy[v] * k; tMax = Math.max(tMax, t); fMax = Math.max(fMax, f); if (t > 0.25) nT++; if (f > 0.25) nF++; }
    rep.wear7 = { postures: POSTURES7.length, tRef: +tRef.toFixed(4), fRef: +fRef.toFixed(4), tMax: +tMax.toFixed(3), fMax: +fMax.toFixed(3), tShare: +(nT / n).toFixed(3), fShare: +(nF / n).toFixed(3), bindMm: rep.wear7Bind, ms: Math.round((globalThis.performance || Date).now() - t0) };
  } finally { sk.bones.forEach((b, i) => { b.position.copy(saved[i].p); b.quaternion.copy(saved[i].q); b.scale.copy(saved[i].s); }); root.updateMatrixWorld(true); }
}

// the construction meshes of a garment (pockets, plackets, rivets: cut from the garment's cloth) carry the wear of the garment surface under them: the nearest vertex of a host of their own dye, within 15 mm (the abrasion and the fold-wear
// amount; the direction is in the host's pattern frame, so a rider draws no lines of its own)
export function wearRiders7(root) {
  const hosts = [], riders = [];
  root.traverse(m => { if (!m.isMesh || !m.geometry?.attributes?.aF6w) return; const k = m.userData?.k3; if (k?.group === 'garment' && m.geometry.attributes.uv) hosts.push(m); else if (k?.group === 'construction') riders.push(m); });
  if (!hosts.length || !riders.length) return { riders: 0 };
  const cell = 0.015, G = new Map(), key = (x, y, z) => `${x},${y},${z}`; let done = 0;
  hosts.forEach((m, hi) => { const P = m.geometry.attributes.position.array, n = m.geometry.attributes.position.count; for (let v = 0; v < n; v++) { const k = key(Math.floor(P[v * 3] / cell), Math.floor(P[v * 3 + 1] / cell), Math.floor(P[v * 3 + 2] / cell)); const L = G.get(k); if (L) L.push(hi, v); else G.set(k, [hi, v]); } });
  for (const m of riders) { const dye = hosts.map((H, i) => H.userData.k3.color && H.userData.k3.color === m.userData.k3.color ? i : -1).filter(i => i >= 0), ok = dye.length ? new Set(dye) : null;
    const g = m.geometry, n = g.attributes.position.count, P = g.attributes.position.array, W = g.attributes.aF6w.array; let any = false;
    for (let v = 0; v < n; v++) { const cx = Math.floor(P[v * 3] / cell), cy = Math.floor(P[v * 3 + 1] / cell), cz = Math.floor(P[v * 3 + 2] / cell); let best = cell * cell, bh = -1, bw = -1;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const L = G.get(key(cx + a, cy + b, cz + c)); if (!L) continue;
        for (let i = 0; i < L.length; i += 2) { if (ok && !ok.has(L[i])) continue; const HP = hosts[L[i]].geometry.attributes.position.array, w = L[i + 1], d = (HP[w * 3] - P[v * 3]) ** 2 + (HP[w * 3 + 1] - P[v * 3 + 1]) ** 2 + (HP[w * 3 + 2] - P[v * 3 + 2]) ** 2; if (d < best) { best = d; bh = L[i]; bw = w; } } }
      if (bh < 0) continue; const HW = hosts[bh].geometry.attributes.aF6w.array; W[v * 4] = HW[bw * 4]; W[v * 4 + 1] = HW[bw * 4 + 1]; W[v * 4 + 2] = 0; W[v * 4 + 3] = 0; any = true; }
    if (any) { g.attributes.aF6w.needsUpdate = true; done++; } }
  return { riders: done };
}
