// PEOPLE: detailed, instanced, GPU-skinned working people for the three.js scenes.
//
//   import { People } from '../lib/fx/people.js';
//   const folk = new People(scene, { max: 600, viewH: RH });             // RH = render-target height in px (LOD)
//   const id = folk.add(People.random('steel', 7));                      // or folk.add({ trade:'farm', h:1.8, heavy:0.4, ... })
//   folk.set(id, { x, y, z, heading, act: 'walk', ph: t * 5.5 });        // every frame, for every visible person
//   folk.update(camera);                                                 // once per frame, before renderer.render
//
// Trades (each its own silhouette, headwear and cloth): 'steel' hard hat + hi-vis vest + duck pants + gloves,
// 'farm' trucker cap + flannel (rolled sleeves) + jeans, 'rail' striped rail cap + canvas chore coat (corduroy collar)
// + jeans, 'overalls' cap + bib overalls over a tee, 'weld' knit cap + leather welding jacket + gloves.
// Acts: 'walk' (ph = stride phase, radians; ~5.6 rad/s at 1.35 m/s), 'stand' (t = seconds; weight shift, breath,
// glances; 3 variants by seed), 'work' (hammer blows; ph = cycle 0..1), 'fist' (raised fist; pump = 0..1 beat
// envelope, or omitted for a self-driven pump), 'march' (walk legs + raised fist). mix: {walk:.5, fist:.5} blends
// whole poses. look: head yaw (rad). lift: metres off the ground (a jump). Feet are planted by solving the pelvis
// height each frame, so stride length and bob come from the legs.
//
// Cycle-1 additions (HUMAN studio; all opt-in, old calls render as before):
//   act: 'clip' plays real motion: st.clip = a bvh.js Clip retargeted with PEOPLE_MAP onto People.RIG, st.ct = its time
//   (s), st.loop (stride loop, root motion accumulates), st.twos (hold poses on twos), st.rootMotion (move the person by
//   the take's own root so the feet never slide; st.x/z become the start point). st.plant = false keeps the take's hip
//   height instead of planting the lowest foot (ladders, jumps). The shoulder rises with a raised arm (scapular lift),
//   for every act. People.varied(trade, seed) spends the variety where viewers look (McDonnell et al. 2009): hats,
//   hair, beards, head size, shoulder build, a height spread of about 6 cm; People.crowdLayout() places clumped
//   crowds with gaps; folk.hazards(camera) finds hands or props of one person that land on another's crotch in frame.
// Cycle-2 additions (HUMAN studio): st.gesture = { name, side: -1 right | 1 left | 2 both, p: pump 0..1, w: weight }
//   (or an array of them) poses the arm by IK from gesture.js (ROTFRONT, OVERHEAD, PUMP, CLIMB_REACH, BANNER_TOP,
//   BANNER_LOW, SHOULDER_TOOL). acts 'fist' and 'march' now raise the arm as PUMP (only the elbow moves; the fist goes
//   up and down beside the head, never forward) unless the scene set its own st.pose hook; st.legacyFist = true keeps
//   the old Euler arm. st.fistScale (default
//   1.3 near, 1.6 at crowd size on a raised fist) draws the fist oversized, the poster caricature that keeps it
//   legible. folk.gestures(camera, W, H) measures every raised arm from the posed joints and on screen and flags
//   SALUTE_STRAIGHT / SALUTE_FOREARM / FIST_UNREADABLE (hard fails); folk.fixHazards(camera, W, H) re-seeds the
//   people whose hands land on another's crotch until there are none. Every People registers with the audit that
//   render.mjs saves for gate.py's people check.
// st.shadowOnly (8 Oct 2026, opt-in; A SPECTRE IS HAUNTING): this person is kept only for the shadow it throws into the frame (a cull
//   margin): it ranks after everyone on screen for the LOD budgets and draws at LOD2, so it never takes a LOD0/LOD1 slot from a face in frame.
// Everything is one skeleton (19 bones) whose per-instance skinning matrices are computed on the CPU and uploaded
// as a float texture; the vertex shader skins with two bones per vertex, applies two build morphs (heavy, fem) and
// the palette, and the fragment shader draws cloth by zone in bind space (plaid, denim seams and fades, hi-vis with
// reflective tape, pockets, plackets, buttons, belt, laces, faces: sockets, brows, lips, stubble). 3 LODs per trade,
// chosen per person by projected height; one draw call per trade per LOD (+ shadow). Pure function of the inputs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GESTURES, gestureSolve, measureArm, registerAudit } from './gesture.js';
import { PeopleRig } from './rig/people_rig.js';

// ------------------------------------------------------------------ skeleton (bind pose, metres, 1.78 m person, facing +Z, left = +X)
const NB = 21;
const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 7, 2, 9, 10, 11, 0, 13, 14, 0, 16, 17, 8, 12];
const JOINT = [
  [0, 0.97, 0], [0, 1.08, -0.005], [0, 1.26, -0.01], [0, 1.50, -0.022], [0, 1.60, -0.008],
  [0.185, 1.44, -0.02], [0.215, 1.155, -0.035], [0.235, 0.9, -0.012], [0.24, 0.815, 0.0],
  [-0.185, 1.44, -0.02], [-0.215, 1.155, -0.035], [-0.235, 0.9, -0.012], [-0.24, 0.815, 0.0],
  [0.095, 0.93, 0], [0.1, 0.505, 0.012], [0.105, 0.085, -0.02],
  [-0.095, 0.93, 0], [-0.1, 0.505, 0.012], [-0.105, 0.085, -0.02],
  [0.241, 0.772, 0.002], [-0.241, 0.772, 0.002],
];
const B = { hips: 0, spine: 1, chest: 2, neck: 3, head: 4 };
const ARM = s => s > 0 ? [5, 6, 7, 8, 19] : [9, 10, 11, 12, 20];     // upper arm, forearm, hand, fingers (proximal), fingers (distal)
const LEG = s => s > 0 ? [13, 14, 15] : [16, 17, 18];         // thigh, shin, foot
const HEADC = [0, 1.665, 0.01];

// part ids (shared with the shader)
const P = { HEAD: 0, NECK: 1, TORSO: 2, ARM: 3, HAND: 4, FING: 5, PELVIS: 6, LEG: 7, BOOT: 8, HAIR: 9, BEARD: 10, HAT: 11, BRIM: 12, VEST: 13, COLLAR: 14, EAR: 15, BUN: 16, PROP: 17 };
export const TRADES = ['steel', 'farm', 'rail', 'overalls', 'weld'];
const OUTFIT = { steel: 0, farm: 1, rail: 2, overalls: 3, weld: 4 };

// ------------------------------------------------------------------ small math
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, x) => a + (b - a) * x;
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const gauss = (d2, s2) => Math.exp(-d2 / s2);
const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function vnoise1(x, s = 0) { const i = Math.floor(x), f = x - i, h = k => { let n = Math.imul((k + s * 131) | 0, 374761393); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }; const u = f * f * (3 - 2 * f); return lerp(h(i), h(i + 1), u) * 2 - 1; }
// Catmull-Rom through keys [[y, a, b, c, ...], ...] (sorted by y ascending), returns the interpolated row at y
function keyAt(keys, y) {
  const n = keys.length; if (y <= keys[0][0]) return keys[0].slice(1); if (y >= keys[n - 1][0]) return keys[n - 1].slice(1);
  let i = 0; while (i < n - 2 && y > keys[i + 1][0]) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(n - 1, i + 2)], f = (y - k1[0]) / (k2[0] - k1[0]);
  const out = []; for (let j = 1; j < k1.length; j++) { const p0 = k0[j], p1 = k1[j], p2 = k2[j], p3 = k3[j];
    out.push(0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f)); }
  return out;
}
const spow = (c, e) => Math.sign(c) * Math.pow(Math.abs(c), e);

// ------------------------------------------------------------------ geometry builder
// grid(): an (nu+1) x (nv+1) sheet from fn(u, v) -> [x,y,z]; normals smoothed across the u seam and at poles,
// oriented outward (away from the part's centroid); every vertex carries aSkin = (bone0, bone1, w0, part).
function grid(parts, { part, nu, nv, fn, skin, uvf, closedU = true }) {
  const cols = nu + 1, rows = nv + 1, N = cols * rows;
  const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2), sk = new Float32Array(N * 4);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i, u = i / nu, v = j / nv, p = fn(u, v);
    pos.set(p, k * 3); const t = uvf ? uvf(u, v, p) : [u, v]; uv.set(t, k * 2);
    const s = skin(p); sk.set([s[0], s[1], s[2], part], k * 4);
  }
  const idx = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('aSkin', new THREE.BufferAttribute(sk, 4));
  g.setIndex(idx); g.computeVertexNormals();
  // orientation
  const cen = [0, 0, 0]; for (let k = 0; k < N; k++) for (let c = 0; c < 3; c++) cen[c] += pos[k * 3 + c] / N;
  const nor = g.attributes.normal.array; let sum = 0;
  for (let k = 0; k < N; k++) sum += (pos[k * 3] - cen[0]) * nor[k * 3] + (pos[k * 3 + 1] - cen[1]) * nor[k * 3 + 1] + (pos[k * 3 + 2] - cen[2]) * nor[k * 3 + 2];
  if (sum < 0) { for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; } g.setIndex(idx); g.computeVertexNormals(); }
  const n = g.attributes.normal.array;
  const avg = ks => { let x = 0, y = 0, z = 0; for (const k of ks) { x += n[k * 3]; y += n[k * 3 + 1]; z += n[k * 3 + 2]; } const l = Math.hypot(x, y, z) || 1; for (const k of ks) n.set([x / l, y / l, z / l], k * 3); };
  if (closedU) for (let j = 0; j < rows; j++) avg([j * cols, j * cols + nu]);
  for (const j of [0, nv]) { const r = []; let spread = 0; for (let i = 0; i < cols; i++) { r.push(j * cols + i); spread = Math.max(spread, Math.hypot(pos[(j * cols + i) * 3] - pos[j * cols * 3], pos[(j * cols + i) * 3 + 1] - pos[j * cols * 3 + 1], pos[(j * cols + i) * 3 + 2] - pos[j * cols * 3 + 2])); } if (spread < 1e-4) avg(r); }
  parts.push(g);
}
// loft(): rings of superellipse sections. ring = { c:[x,y,z], rx, rz, n?, X?, Z? } ; f(theta, ring, p) -> extra [dx,dy,dz]
function loft(parts, { part, seg, rings, skin, f, cap0 = 0, cap1 = 0, uvScale = 1 }) {
  const R = rings.slice();
  const pole = (r, d) => { const X = r.X || [1, 0, 0], Z = r.Z || [0, 0, 1], A = [X[1] * Z[2] - X[2] * Z[1], X[2] * Z[0] - X[0] * Z[2], X[0] * Z[1] - X[1] * Z[0]];
    return { ...r, c: [r.c[0] + A[0] * d, r.c[1] + A[1] * d, r.c[2] + A[2] * d], rx: 0, rz: 0 }; };
  if (cap0) R.unshift(pole(R[0], cap0)); if (cap1) R.push(pole(R[R.length - 1], cap1));
  let along = [0]; for (let j = 1; j < R.length; j++) along.push(along[j - 1] + Math.hypot(R[j].c[0] - R[j - 1].c[0], R[j].c[1] - R[j - 1].c[1], R[j].c[2] - R[j - 1].c[2]));
  const nv = R.length - 1;
  const pt = (u, v) => {
    const j = Math.round(v * nv), r = R[j], th = u * Math.PI * 2, e = 2 / (r.n || 2), X = r.X || [1, 0, 0], Z = r.Z || [0, 0, 1];
    const a = r.rx * spow(Math.cos(th), e), b = r.rz * spow(Math.sin(th), e);
    let p = [r.c[0] + X[0] * a + Z[0] * b, r.c[1] + X[1] * a + Z[1] * b, r.c[2] + X[2] * a + Z[2] * b];
    if (f) { const d = f(th, r, p, j); p = [p[0] + d[0], p[1] + d[1], p[2] + d[2]]; }
    return p;
  };
  grid(parts, { part, nu: seg, nv, fn: pt, skin, uvf: (u, v) => { const r = R[Math.round(v * nv)]; return [u * Math.PI * (r.rx + r.rz + 1e-3) * uvScale, along[Math.round(v * nv)]]; } });
}
// ellipsoid-ish sheet around centre c with radii, theta over [t0,t1], phi (from +Y) over [p0,p1(theta)]; shape(ux,uy,uz) -> [x,y,z] offset
function dome(parts, { part, nu, nv, c, r, t0 = 0, t1 = Math.PI * 2, p0 = 0, p1 = () => Math.PI, shape, skin, closedU = true }) {
  grid(parts, { part, nu, nv, closedU, skin, fn: (u, v) => {
    const th = lerp(t0, t1, u), ph = lerp(p0, p1(th), v), ux = Math.sin(ph) * Math.cos(th), uy = Math.cos(ph), uz = Math.sin(ph) * Math.sin(th);
    const d = shape ? shape(ux, uy, uz, ph, th) : [0, 0, 0];
    return [c[0] + ux * r[0] + d[0], c[1] + uy * r[1] + d[1], c[2] + uz * r[2] + d[2]];
  }, uvf: (u, v) => [u, v] });
}
const S1 = b => () => [b, b, 1];
const S2 = (b0, b1, w) => [b0, b1, w];

// ------------------------------------------------------------------ the body, by trade, LOD and build (heavy, fem in 0..1)
function buildBody(trade, q, heavy, fem, lod = 0) {
  const O = OUTFIT[trade], parts = [];
  const coat = O === 2 || O === 4, baggy = O === 3 ? 0.012 : O === 0 ? 0.006 : 0.0;
  const ease = coat ? 0.018 : O === 1 ? 0.008 : O === 0 ? 0.006 : 0.0;
  const SEG = (n, m = 6) => Math.max(lod >= 2 ? Math.min(m, m >= 5 ? 4 : 3) : lod === 1 ? Math.min(m, 5) : m, Math.round(n * q));

  // --- torso (the top garment)
  const TK = [ // y, halfW, dFront, dBack, cz, n
    [0.78, 0.172, 0.108, 0.112, 0.0, 2.4], [0.86, 0.168, 0.105, 0.106, 0.0, 2.4], [0.96, 0.170, 0.108, 0.105, 0.0, 2.5],
    [1.04, 0.160, 0.105, 0.098, 0.005, 2.5], [1.12, 0.162, 0.108, 0.100, 0.008, 2.5], [1.22, 0.178, 0.118, 0.105, 0.008, 2.6],
    [1.31, 0.192, 0.120, 0.105, 0.004, 2.8], [1.39, 0.205, 0.106, 0.101, -0.004, 2.7], [1.44, 0.198, 0.088, 0.091, -0.012, 2.5],
    [1.48, 0.15, 0.07, 0.079, -0.02, 2.3], [1.515, 0.09, 0.060, 0.066, -0.022, 2.2], [1.545, 0.064, 0.056, 0.058, -0.02, 2.0],
  ];
  const torsoSec = (y, add = 0) => {
    let [w, dF, dB, cz, n] = keyAt(TK, y);
    const belly = gauss((y - 1.1) ** 2, 0.006), chest = gauss((y - 1.3) ** 2, 0.006), hip = gauss((y - 0.93) ** 2, 0.004), waist = gauss((y - 1.09) ** 2, 0.003), sh = gauss((y - 1.43) ** 2, 0.002);
    w += heavy * (0.035 * belly + 0.02 * chest + 0.02 * hip) + fem * (-0.022 * waist + 0.014 * hip - 0.024 * sh);
    dF += heavy * (0.06 * belly + 0.012 * chest) + fem * (0.02 * gauss((y - 1.27) ** 2, 0.002) - 0.01 * waist);
    dB += heavy * 0.015 * belly + fem * 0.012 * hip;
    const e = y > 1.49 ? ease * 0.4 : ease;
    if (coat && y < 1.05) { const k = sstep(1.05, 0.9, y); w += 0.012 * k + 0.02 * sstep(0.9, 0.78, y); dF += 0.012 * k; dB += 0.014 * k; }            // coat hem flares over the hips
    return { w: w + e + add, dF: dF + e * 0.8 + add, dB: dB + e * 0.8 + add, cz, n };
  };
  const torsoSkin = p => {
    const y = p[1], ax = Math.abs(p[0]), s = Math.sign(p[0]) || 1;
    const armW = 0.4 * sstep(0.11, 0.19, ax) * sstep(1.3, 1.44, y);
    if (armW > 0.01) return S2(B.chest, ARM(s)[0], 1 - armW);
    if (y > 1.47) return S2(B.chest, B.neck, 1 - 0.7 * sstep(1.47, 1.55, y));
    if (y > 1.17) return S2(B.chest, B.spine, sstep(1.13, 1.28, y));
    if (y > 1.0) return S2(B.spine, B.hips, sstep(0.98, 1.12, y));
    const legW = 0.35 * sstep(0.92, 0.8, y) * sstep(0.02, 0.1, ax);
    return legW > 0.01 ? S2(B.hips, LEG(s)[0], 1 - legW) : S2(B.hips, B.hips, 1);
  };
  const torsoRings = (y0, y1, nr, add = 0) => { const R = []; for (let j = 0; j <= nr; j++) { const y = lerp(y0, y1, j / nr), s = torsoSec(y, add); R.push({ c: [0, y, s.cz], rx: s.w, rz: s.dF, n: s.n, dB: s.dB, y }); } return R; };
  const torsoF = (th, r) => { const sn = Math.sin(th); return sn < 0 ? [0, 0, (r.dB - r.rz) * spow(sn, 2 / r.n)] : [0, 0, 0]; };
  const ty0 = coat ? 0.78 : O === 3 ? 0.95 : 1.03;          // shirts tucked in: the waistband laps over the hem
  // folded-over coat collar / shirt collar sits at the top; the torso ends at the neck
  loft(parts, { part: P.TORSO, seg: SEG(34, 12), rings: torsoRings(ty0, 1.545, SEG(30, 9)), skin: torsoSkin, f: torsoF });

  // --- vest (steel): a shell over the torso; armholes and the zip are cut in the shader
  if (O === 0) loft(parts, { part: P.VEST, seg: SEG(34, 12), rings: torsoRings(1.0, 1.49, SEG(20, 6), 0.013), skin: torsoSkin, f: torsoF });

  // --- pants top / seat
  const PK = [[0.81, 0.035, 0.04, 0.04, 0.0], [0.835, 0.08, 0.066, 0.075, 0.0], [0.87, 0.14, 0.092, 0.1, -0.002], [0.94, 0.163, 0.1, 0.108, -0.004],
    [1.01, 0.170, 0.104, 0.106, 0.0], [1.08, 0.166, 0.104, 0.100, 0.004]];
  { const R = []; const nr = SEG(12, 5);
    for (let j = 0; j <= nr; j++) { const y = lerp(0.81, O === 3 ? 1.1 : 1.08, j / nr); let [w, dF, dB, cz] = keyAt(PK, y);
      const belly = gauss((y - 1.08) ** 2, 0.004), hip = gauss((y - 0.93) ** 2, 0.004);
      w += heavy * (0.03 * belly + 0.02 * hip) + fem * 0.016 * hip + baggy * (y > 1.0 ? 0.3 : 1) + (O !== 2 && O !== 4 ? 0.009 * sstep(0.98, 1.04, y) : 0); dF += heavy * 0.045 * belly + baggy + (O !== 2 && O !== 4 ? 0.008 * sstep(0.98, 1.04, y) : 0); dB += fem * 0.014 * hip + heavy * 0.01 + baggy + (O !== 2 && O !== 4 ? 0.008 * sstep(0.98, 1.04, y) : 0);
      R.push({ c: [0, y, cz], rx: w, rz: dF, dB, n: 2.3 }); }
    loft(parts, { part: P.PELVIS, seg: SEG(30, 10), rings: R, cap0: 0.012, skin: p => { const ax = Math.abs(p[0]), s = Math.sign(p[0]) || 1, lw = 0.4 * sstep(0.93, 0.82, p[1]) * sstep(0.03, 0.11, ax); return lw > 0.01 ? S2(B.hips, LEG(s)[0], 1 - lw) : S2(B.hips, B.hips, 1); },
      f: (th, r) => { const sn = Math.sin(th); return sn < 0 ? [0, 0, (r.dB - r.rz) * spow(sn, 2 / r.n)] : [0, 0, 0]; } }); }

  // --- legs (pants), hip -> knee -> ankle
  const LK = [[0.095, 0.064, 0.070, 0.005], [0.105, 0.066, 0.072, 0.005], [0.16, 0.057, 0.062, 0.0], [0.24, 0.056, 0.061, 0.0], [0.34, 0.061, 0.068, -0.004], [0.44, 0.060, 0.066, 0.004],
    [0.50, 0.060, 0.064, 0.014], [0.56, 0.063, 0.066, 0.012], [0.68, 0.072, 0.075, 0.008], [0.80, 0.080, 0.086, 0.005], [0.88, 0.085, 0.09, 0.0], [0.95, 0.08, 0.085, 0.0], [0.99, 0.07, 0.075, 0.0]];
  for (const s of [1, -1]) {
    const [th, sh, ft] = LEG(s), R = [], nr = SEG(26, 8);
    for (let j = 0; j <= nr; j++) {
      const y = lerp(0.99, 0.095, j / nr); let [rx, rz, dz] = keyAt(LK, y);
      const thigh = sstep(0.5, 0.75, y), calf = gauss((y - 0.34) ** 2, 0.006);
      rx += heavy * (0.018 * thigh + 0.008 * calf) + fem * 0.008 * thigh + baggy; rz += heavy * (0.016 * thigh + 0.008 * calf) + fem * 0.006 * thigh + baggy;
      const cx = y > 0.505 ? lerp(0.1, 0.092, (y - 0.505) / 0.485) - 0.012 * sstep(0.88, 0.99, y) : lerp(0.105, 0.1, (y - 0.085) / 0.42), cz = y > 0.505 ? lerp(0.012, 0, (y - 0.505) / 0.485) : lerp(-0.02, 0.012, (y - 0.085) / 0.42);
      R.push({ c: [s * cx, y, cz + dz], rx, rz, n: 2.1 });
    }
    R.push({ c: [s * 0.104, 0.1, 0.0], rx: 0.045, rz: 0.05, n: 2 });
    loft(parts, { part: P.LEG, seg: SEG(20, 7), rings: R, skin: p => { const y = p[1];
      if (y > 0.86) return S2(th, B.hips, 1 - 0.45 * sstep(0.86, 0.99, y));
      if (y > 0.2) return S2(th, sh, sstep(0.43, 0.57, y));
      return S2(sh, ft, sstep(0.06, 0.16, y)); } });
    // boot: shaft + foot
    { const RS = []; for (let j = 0; j <= SEG(6, 3); j++) { const y = lerp(0.22, 0.07, j / SEG(6, 3)); RS.push({ c: [s * 0.104, y, -0.016], rx: 0.05 + heavy * 0.004, rz: 0.057, n: 2.2 }); }
      loft(parts, { part: P.BOOT, seg: SEG(16, 7), rings: RS, skin: p => S2(sh, ft, sstep(0.07, 0.2, p[1])) }); }
    { const BK = [[-0.092, 0.012, 0.02, 0.045], [-0.085, 0.030, 0.036, 0.047], [-0.07, 0.042, 0.046, 0.05], [-0.04, 0.046, 0.055, 0.06], [0.0, 0.048, 0.058, 0.062], [0.05, 0.050, 0.047, 0.051],
        [0.10, 0.051, 0.037, 0.042], [0.14, 0.049, 0.031, 0.036], [0.17, 0.043, 0.027, 0.031], [0.19, 0.031, 0.021, 0.028], [0.199, 0.014, 0.012, 0.027]];
      const R2 = [], nr = SEG(16, 7); for (let j = 0; j <= nr; j++) { const z = lerp(-0.092, 0.199, j / nr), [w, h, yc] = keyAt(BK, z);
        R2.push({ c: [s * (0.105 + z * 0.06), yc, z], rx: w, rz: h, n: 3.2, X: [1, 0, 0], Z: [0, 1, 0] }); }
      loft(parts, { part: P.BOOT, seg: SEG(18, 8), rings: R2, cap0: -0.004, cap1: 0.004, skin: S1(ft) }); }
  }

  // --- arms (sleeves), shoulder -> elbow -> wrist, and hands
  const AK = [[0.895, 0.030, 0.032], [0.905, 0.042, 0.044], [0.93, 0.038, 0.041], [1.0, 0.043, 0.046], [1.10, 0.049, 0.052], [1.17, 0.047, 0.050], [1.25, 0.052, 0.055],
    [1.34, 0.057, 0.060], [1.40, 0.058, 0.061], [1.43, 0.048, 0.052], [1.445, 0.03, 0.034]];
  for (const s of [1, -1]) {
    const [ua, fa, hn, fg] = ARM(s), R = [], nr = SEG(24, 8);
    const cx = y => y > 1.155 ? lerp(0.215, 0.175, (y - 1.155) / 0.32) : lerp(0.235, 0.215, (y - 0.895) / 0.26);
    const cz = y => y > 1.155 ? lerp(-0.035, -0.02, (y - 1.155) / 0.345) : lerp(-0.012, -0.035, (y - 0.895) / 0.26);
    for (let j = 0; j <= nr; j++) { const y = lerp(1.445, 0.895, j / nr); let [rx, rz] = keyAt(AK, y);
      const up = sstep(1.15, 1.3, y), e = coat ? 0.011 : O === 0 ? 0.004 : 0;
      let cuff = 0; if (O === 1) cuff = 0.007 * gauss((y - 1.095) ** 2, 0.00015);             // rolled flannel sleeve
      if (O === 3) cuff = 0.006 * gauss((y - 1.29) ** 2, 0.0001);                               // tee sleeve hem
      if (O === 3 && y < 1.28 || O === 1 && y < 1.085) { rx -= 0.006; rz -= 0.006; }           // bare forearm is slimmer than cloth
      rx += heavy * (0.012 * up + 0.006) - fem * 0.007 + e + cuff; rz += heavy * (0.012 * up + 0.006) - fem * 0.006 + e + cuff;
      R.push({ c: [s * cx(y), y, cz(y)], rx, rz, n: 2 }); }
    loft(parts, { part: P.ARM, seg: SEG(18, 7), rings: R, cap0: -0.014, skin: p => { const y = p[1];
      if (y > 1.38) return S2(ua, B.chest, 1 - 0.55 * sstep(1.4, 1.5, y));
      if (y > 1.0) return S2(ua, fa, sstep(1.1, 1.21, y));
      return S2(fa, hn, sstep(0.88, 0.93, y)); } });
    // hand: palm, fingers (curl on the finger bone), thumb
    const hx = s * 0.237, gl = O === 4 || O === 0 ? 0.004 : 0;
    { const R2 = []; const nr2 = SEG(6, 3), yEnd = lod >= 2 ? 0.76 : 0.81; for (let j = 0; j <= nr2; j++) { const y = lerp(0.915, yEnd, j / nr2), k = (0.915 - y) / 0.105;
        R2.push({ c: [hx, y, lerp(-0.012, 0.0, k)], rx: lerp(0.024, 0.017, k) + gl + heavy * 0.003, rz: lerp(0.032, 0.043, Math.sqrt(k)) + gl, n: 2.6 }); }
      loft(parts, { part: P.HAND, seg: SEG(12, 6), rings: R2, skin: p => S2(hn, fa, 1 - sstep(0.88, 0.925, p[1])) }); }
    { const R3 = []; const nr3 = SEG(7, 3); for (let j = 0; j <= nr3; j++) { const y = lerp(0.83, 0.735, j / nr3), k = (0.83 - y) / 0.095;
        R3.push({ c: [hx - s * 0.002 * k, y, 0.002 - 0.004 * k], rx: lerp(0.016, 0.011, k) + gl, rz: lerp(0.041, 0.034, k) * (k > 0.85 ? Math.sqrt(1 - (k - 0.85) / 0.15 * 0.75) : 1) + gl, n: 2.4 }); }
      if (lod < 2) loft(parts, { part: P.FING, seg: SEG(12, 6), rings: R3, cap1: 0.006, skin: p => p[1] > 0.8 ? S2(fg, hn, 1 - sstep(0.805, 0.83, p[1])) : S2(ARM(s)[4], fg, 1 - sstep(0.758, 0.785, p[1])) }); }
    if (lod < 2) { const R4 = []; for (let j = 0; j <= 4; j++) { const k = j / 4; R4.push({ c: [hx - s * 0.014 * k - s * 0.004, lerp(0.885, 0.835, k), lerp(0.024, 0.05, k)], rx: 0.0115 + gl * 0.6 - k * 0.002, rz: 0.012 + gl * 0.6 - k * 0.002, n: 2 }); }
      loft(parts, { part: P.HAND, seg: SEG(8, 5), rings: R4, cap1: 0.008, skin: p => S2(fg, hn, 0.5 * sstep(0.87, 0.835, p[1])) }); }
    // the right hand holds a hammer when asked (flag)
    if (s < 0 && lod < 1) {
      const R5 = []; for (let j = 0; j <= 3; j++) R5.push({ c: [hx + 0.004, 0.795, lerp(-0.07, 0.30, j / 3)], rx: 0.013, rz: 0.016, n: 2, X: [1, 0, 0], Z: [0, 1, 0] });
      loft(parts, { part: P.PROP, seg: SEG(8, 5), rings: R5, cap0: -0.006, cap1: 0.006, skin: S1(hn) });
      const R6 = []; for (let j = 0; j <= 3; j++) R6.push({ c: [hx + 0.004, lerp(0.73, 0.87, j / 3), 0.31], rx: 0.03, rz: 0.03, n: 5 });
      loft(parts, { part: P.PROP, seg: SEG(10, 6), rings: R6, cap0: -0.004, cap1: 0.004, skin: S1(hn) });
    }
  }

  // --- neck
  { const R = []; const nr = SEG(6, 3); for (let j = 0; j <= nr; j++) { const y = lerp(1.47, 1.62, j / nr); R.push({ c: [0, y, lerp(-0.026, -0.012, j / nr)], rx: 0.05 + heavy * 0.01 - fem * 0.006, rz: 0.053 + heavy * 0.01 - fem * 0.004, n: 2 }); }
    loft(parts, { part: P.NECK, seg: SEG(16, 7), rings: R, skin: p => p[1] > 1.57 ? S2(B.head, B.neck, sstep(1.57, 1.61, p[1])) : S2(B.neck, B.chest, sstep(1.49, 1.54, p[1])) }); }

  // --- head: an ellipsoid carved into a face (brow, sockets, nose, cheekbones, lips, chin, jaw, occiput)
  const HR = [0.077, 0.118, 0.099];
  const headShape = (ux, uy, uz, off = 0) => {
    let kx = 1 - 0.19 * sstep(0.1, 0.95, -uy) + 0.04 * Math.max(0, uy) - fem * 0.05 * sstep(0.1, 0.9, -uy) + heavy * 0.08 * gauss((uy + 0.45) ** 2, 0.08);
    let x = ux * HR[0] * kx, y = uy * HR[1], z = uz * HR[2] * (uz > 0 ? 0.97 : 1.02);
    const fr = sstep(0.55, 0.95, uz), ax = Math.abs(ux);
    let rad = 0;
    rad += fr * lerp(0.005, 0.027, sstep(0.12, -0.2, uy)) * gauss(ux * ux, 0.0055) * sstep(-0.31, -0.21, uy) * sstep(0.22, 0.1, uy);           // nose bridge -> tip
    rad += fr * 0.009 * gauss((ax - 0.12) ** 2, 0.004) * gauss((uy + 0.22) ** 2, 0.003);                                                  // alae
    rad += fr * 0.013 * (1 - fem * 0.5) * gauss((uy - 0.21) ** 2, 0.004) * sstep(0.75, 0.25, ax);                                       // brow ridge
    rad -= fr * 0.021 * gauss((ax - 0.33) ** 2 + (uy - 0.1) ** 2 * 1.5, 0.012);                                                          // eye sockets
    rad += fr * 0.008 * gauss((ax - 0.33) ** 2 + (uy - 0.085) ** 2 * 3, 0.0035);                                                           // the eyeball under the lid
    rad += 0.011 * gauss((ax - 0.56) ** 2 + (uy + 0.03) ** 2, 0.012) * sstep(0.2, 0.6, uz);                                               // cheekbones
    rad += 0.003 * gauss((ax - 0.45) ** 2 + (uy + 0.25) ** 2, 0.03) * sstep(0.2, 0.6, uz) - 0.005 * gauss((ax - 0.5) ** 2 + (uy + 0.3) ** 2, 0.012) * sstep(0.2, 0.6, uz) * (1 - heavy);                                                // cheeks
    rad -= 0.004 * gauss((ax - 0.85) ** 2 + (uy - 0.25) ** 2, 0.02);                                                                      // temples
    rad += fr * 0.008 * gauss(ux * ux, 0.045) * gauss((uy + 0.38) ** 2, 0.003) + fr * 0.006 * gauss(ux * ux, 0.035) * gauss((uy + 0.43) ** 2, 0.002);                                                         // lips
    rad -= fr * 0.004 * gauss(ux * ux, 0.08) * gauss((uy + 0.5) ** 2, 0.002);                                                            // under the lip
    rad += fr * 0.013 * gauss(ux * ux, 0.08) * gauss((uy + 0.68) ** 2, 0.01);                                                           // chin
    rad += 0.012 * gauss((ax - 0.78) ** 2 + (uy + 0.5) ** 2 + (uz - 0.1) ** 2, 0.025) * (1 - fem * 0.6);                                  // jaw angle
    rad += 0.009 * gauss(ux * ux + (uy - 0.15) ** 2 + (uz + 1) ** 2, 0.3);                                                                // occiput
    rad += heavy * 0.008 * gauss((ax - 0.55) ** 2 + (uy + 0.4) ** 2, 0.05);                                                               // fuller cheeks
    rad += off;
    const l = Math.hypot(ux, uy, uz) || 1;
    return [x + ux / l * rad, y + uy / l * rad, z + uz / l * rad];
  };
  dome(parts, { part: P.HEAD, nu: SEG(44, 12), nv: SEG(32, 9), c: HEADC, r: [0, 0, 0], shape: (ux, uy, uz) => headShape(ux, uy, uz), skin: S1(B.head) });
  // ears
  if (lod < 1) for (const s of [1, -1]) dome(parts, { part: P.EAR, nu: SEG(10, 5), nv: SEG(8, 4), c: [s * 0.077, 1.655, -0.004], r: [0.011, 0.03, 0.019],
    shape: (ux, uy, uz) => [0, 0, -0.006 * uy], skin: S1(B.head) });
  // hair: a shell over the scalp down to a hairline (front higher), with a longer fall at the back (cut per style in the shader)
  const hairP1 = th => { const fz = Math.sin(th); return fz > 0.3 ? lerp(0.62, 0.36, sstep(0.3, 0.95, fz)) * Math.PI : lerp(0.8, 0.95, sstep(0.0, 0.8, -fz)) * Math.PI; };
  dome(parts, { part: P.HAIR, nu: SEG(40, 10), nv: SEG(18, 6), c: HEADC, r: [0, 0, 0], p1: hairP1,
    shape: (ux, uy, uz, ph, th) => { const back = sstep(0.62 * Math.PI, 0.95 * Math.PI, ph) * (1 - sstep(0.1, 0.4, uz / (Math.sin(ph) || 1)));
      const edge = sstep(1.0, 0.72, ph / hairP1(th)) * (Math.sin(th) > 0.3 ? 1 : 0) + (Math.sin(th) > 0.3 ? 0 : 1);
      if (back > 0) { const ph0 = 0.62 * Math.PI, u0 = [Math.sin(ph0) * ux / (Math.sin(ph) || 1), Math.cos(ph0), Math.sin(ph0) * uz / (Math.sin(ph) || 1)];
        const p = headShape(u0[0], u0[1], u0[2], 0.009 + 0.009 * back); return [p[0] * (1 - 0.05 * back), p[1] - 0.12 * back, p[2] - 0.004 * back]; }
      return headShape(ux, uy, uz, 0.0015 + (0.003 + 0.007 * sstep(-0.2, 0.6, uy) + 0.003 * sstep(0, -1, uz)) * edge); },
    skin: p => p[1] < 1.6 ? S2(B.head, B.neck, 0.6) : S2(B.head, B.head, 1) });
  if (lod < 1) dome(parts, { part: P.BUN, nu: SEG(12, 6), nv: SEG(8, 4), c: [0, 1.7, -0.115], r: [0.034, 0.03, 0.03], skin: S1(B.head) });
  if (lod < 2) dome(parts, { part: P.BEARD, nu: SEG(30, 8), nv: SEG(12, 5), c: HEADC, r: [0, 0, 0], t0: -0.25, t1: Math.PI + 0.25, closedU: false, p0: 0.52 * Math.PI, p1: () => 0.93 * Math.PI,
    shape: (ux, uy, uz) => headShape(ux, uy, uz, 0.003 + 0.006 * sstep(-0.4, -0.8, uy)), skin: S1(B.head) });

  // --- headwear (built at the brow, then seated: lifted to mid-forehead and tipped back so the brim clears the eyes)
  const hc = HEADC, hat0 = parts.length;
  if (O === 0) {  // hard hat: dome with a centre ridge, short front peak, rim
    const R = [0.113, 0.125, 0.137], cy = 1.688, cz = 0.0;
    dome(parts, { part: P.HAT, nu: SEG(36, 10), nv: SEG(14, 5), c: [0, cy, cz], r: R, p1: () => Math.PI * 0.5,
      shape: (ux, uy, uz) => [0, 0.008 * gauss(ux * ux, 0.004) * sstep(0.1, 0.4, uy) + 0.004 * gauss((Math.abs(ux) - 0.3) ** 2, 0.002) * sstep(0.2, 0.5, uy) - 0.02 * Math.max(0, uy) ** 3, 0], skin: S1(B.head) });
    const ringR = [], nr = 4; for (let j = 0; j <= nr; j++) { const k = j / nr; ringR.push({ c: [0, cy - 0.002 - 0.005 * Math.sin(k * Math.PI), cz], rx: R[0] - 0.003 + 0.022 * Math.sin(k * Math.PI), rz: R[2] - 0.003 + 0.022 * Math.sin(k * Math.PI), n: 2, k }); }
    loft(parts, { part: P.BRIM, seg: SEG(36, 10), rings: ringR, skin: S1(B.head), f: (th, r) => { const fz = Math.max(0, Math.sin(th)) ** 3 * Math.sin(r.k * Math.PI); return [0, -0.012 * fz, 0.05 * fz]; } });
  } else if (O === 1 || O === 3) { // trucker cap: tall foam front, mesh back, curved bill
    const R = [0.098, 0.116, 0.123], cy = 1.69, cz = 0.004;
    dome(parts, { part: P.HAT, nu: SEG(34, 10), nv: SEG(12, 5), c: [0, cy, cz], r: R, p1: () => Math.PI * 0.53,
      shape: (ux, uy, uz) => { const hug = -0.008 * (1 - sstep(0.0, 0.3, uy)); return [ux * hug, 0.012 * Math.max(0, uz) * Math.max(0, uy) - 0.012 * Math.max(0, uy) ** 4, uz * hug + 0.006 * Math.max(0, uz) * Math.max(0, uy)]; }, skin: S1(B.head) });
    const Rb = [], nb = SEG(8, 4); for (let j = 0; j <= nb; j++) { const k = j / nb, z = cz + 0.108 + k * 0.078; Rb.push({ c: [0, cy - 0.006 - 0.02 * k * k, z], rx: 0.09 * Math.sqrt(1 - 0.75 * k * k), rz: 0.0035, n: 2.2, X: [1, 0, 0], Z: [0, 1, 0] }); }
    loft(parts, { part: P.BRIM, seg: SEG(20, 8), rings: Rb, skin: S1(B.head), f: (th, r) => { const x = r.rx * Math.cos(th); return [0, -1.6 * x * x, -0.25 * x * x]; } });
  } else if (O === 2) { // rail cap: puffed striped crown, flat top, short bill
    const R = [0.1, 0.095, 0.12], cy = 1.705, cz = 0.0;
    dome(parts, { part: P.HAT, nu: SEG(34, 10), nv: SEG(12, 5), c: [0, cy, cz], r: R, p1: () => Math.PI * 0.6,
      shape: (ux, uy, uz) => { const hug = -0.016 * (1 - sstep(0.0, 0.3, uy)), puff = 0.01 * gauss((uy - 0.45) ** 2, 0.03); return [ux * (hug + puff), -0.025 * Math.max(0, uy - 0.55) + 0.006 * Math.max(0, uz) * Math.max(0, uy), uz * (hug + puff)]; }, skin: S1(B.head) });
    const Rb = [], nb = SEG(6, 3); for (let j = 0; j <= nb; j++) { const k = j / nb; Rb.push({ c: [0, cy - 0.022 - 0.012 * k, cz + 0.108 + k * 0.055], rx: 0.085 * Math.sqrt(1 - 0.7 * k * k), rz: 0.003, n: 2, X: [1, 0, 0], Z: [0, 1, 0] }); }
    loft(parts, { part: P.BRIM, seg: SEG(16, 7), rings: Rb, skin: S1(B.head), f: (th, r) => { const x = r.rx * Math.cos(th); return [0, -0.8 * x * x, -0.25 * x * x]; } });
  } else {        // knit cap with a folded cuff
    const R = [0.097, 0.14, 0.124], cy = 1.672, cz = 0.004;
    dome(parts, { part: P.HAT, nu: SEG(34, 10), nv: SEG(14, 5), c: [0, cy, cz], r: R, p1: th => Math.PI * (Math.sin(th) > 0 ? 0.46 : 0.54),
      shape: (ux, uy, uz, ph) => { const cuff = sstep(0.34 * Math.PI, 0.42 * Math.PI, ph); const l = Math.hypot(ux, uz) || 1; return [ux / l * 0.008 * cuff, -0.015 * Math.max(0, uy) ** 3, uz / l * 0.008 * cuff]; }, skin: S1(B.head) });
  }

  { const [dy, tilt] = [[0.02, -0.1], [0.024, -0.12], [0.03, -0.14], [0.024, -0.12], [0.014, -0.08]][O];
    for (let i = hat0; i < parts.length; i++) parts[i].translate(0, -1.7, 0).rotateX(tilt).translate(0, 1.7 + dy, 0); }

  // --- collar
  if (lod < 2) { const tall = O === 4 ? 0.06 : O === 2 ? 0.04 : O === 3 ? 0.012 : 0.035, big = O === 2 ? 0.022 : O === 4 ? 0.006 : 0.004;
    const R = []; const nr = O === 3 ? 2 : 4;
    for (let j = 0; j <= nr; j++) { const k = j / nr;
      const up = O === 4 || O === 3 ? k : Math.sin(k * Math.PI), out = O === 4 || O === 3 ? 0 : k > 0.5 ? (k - 0.5) * 2 : 0;
      R.push({ c: [0, 1.5 + tall * up, -0.022 + 0.004 * k], rx: 0.064 + heavy * 0.01 + 0.004 + big * out + 0.006 * out, rz: 0.058 + heavy * 0.01 + 0.004 + big * out + 0.006 * out, n: 2, k }); }
    loft(parts, { part: P.COLLAR, seg: SEG(26, 9), rings: R, skin: p => S2(B.chest, B.neck, 1 - 0.5 * sstep(1.5, 1.56, p[1])),
      f: (th, r) => { const fz = Math.max(0, Math.sin(th)), v = O === 4 || O === 3 ? 0 : fz ** 6; return [0, -0.045 * v * (0.3 + r.k), 0.01 * v]; } }); }

  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  return g;
}

function buildTrade(trade, q, lod) {
  const g0 = buildBody(trade, q, 0, 0, lod), gH = buildBody(trade, q, 1, 0, lod), gF = buildBody(trade, q, 0, 1, lod);
  const p0 = g0.attributes.position.array, pH = gH.attributes.position.array, pF = gF.attributes.position.array;
  const a = new Float32Array(p0.length), b = new Float32Array(p0.length);
  for (let i = 0; i < p0.length; i++) { a[i] = pH[i] - p0[i]; b[i] = pF[i] - p0[i]; }
  const g = new THREE.InstancedBufferGeometry();
  for (const k of ['position', 'normal', 'uv', 'aSkin']) g.setAttribute(k, g0.attributes[k]);
  g.setAttribute('aMA', new THREE.BufferAttribute(a, 3)); g.setAttribute('aMB', new THREE.BufferAttribute(b, 3)); g.setIndex(g0.index);
  g.userData.verts = p0.length / 3; g.userData.tris = g0.index.count / 3;
  return g;
}

// PRODUCTION (round 7): People's own parts of a trade (hats, brims, props; the head), for the crowd bake that seats them on a person
export const PEOPLE_PARTS = P;
export function tradeParts(trade, lod = 0, keep = [P.HAT, P.BRIM, P.PROP]) {
  const g = buildBody(trade, [1, 0.3, 0.14][lod] ?? 1, 0, 0, lod), sk = g.attributes.aSkin.array, pos = g.attributes.position.array, I = g.index.array, K = new Set(keep);
  const map = new Map(), P2 = [], S4 = [], idx = [];
  for (let t = 0; t < I.length; t += 3) { if (!K.has(sk[I[t] * 4 + 3])) continue;
    for (let c = 0; c < 3; c++) { const v = I[t + c]; let k = map.get(v); if (k == null) { k = P2.length / 3; map.set(v, k); P2.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); S4.push(sk[v * 4], sk[v * 4 + 1], sk[v * 4 + 2], sk[v * 4 + 3]); } idx.push(k); } }
  return { pos: new Float32Array(P2), sk: new Float32Array(S4), idx: new Uint32Array(idx) };
}

// ------------------------------------------------------------------ shaders
const TEXW = NB * 3;       // 63 texels per person: each bone's skinning matrix as three rows of an affine 3x4
const GLSL_COMMON = /* glsl */`
#define P_HEAD 0
#define P_NECK 1
#define P_TORSO 2
#define P_ARM 3
#define P_HAND 4
#define P_FING 5
#define P_PELVIS 6
#define P_LEG 7
#define P_BOOT 8
#define P_HAIR 9
#define P_BEARD 10
#define P_HAT 11
#define P_BRIM 12
#define P_VEST 13
#define P_COLLAR 14
#define P_EAR 15
#define P_BUN 16
#define P_PROP 17
flat varying vec4 pSkin; flat varying vec4 pTop; flat varying vec4 pBot; flat varying vec4 pHat; flat varying vec4 pHair; flat varying vec4 pAcc; flat varying vec4 pJnt;
flat varying float pPart; varying vec3 pBind; varying vec2 pUv;
`;
const GLSL_VERT = GLSL_COMMON + /* glsl */`
uniform highp sampler2D pplTex;
attribute float aRow; attribute vec4 aSkin; attribute vec3 aMA; attribute vec3 aMB;
attribute vec4 iSkin; attribute vec4 iTop; attribute vec4 iBot; attribute vec4 iHat; attribute vec4 iHair; attribute vec4 iAcc; attribute vec4 iJnt;
vec4 pR0, pR1, pR2;     // the blended bone transform, as the three rows of an affine 3x4
void pplSetup(){
  int r = int(aRow + 0.5), c0 = int(aSkin.x + 0.5) * 3;
#if PPL_LOD >= 2
  pR0 = texelFetch(pplTex, ivec2(c0, r), 0); pR1 = texelFetch(pplTex, ivec2(c0 + 1, r), 0); pR2 = texelFetch(pplTex, ivec2(c0 + 2, r), 0);
  if (aSkin.z < 0.5) { int c1 = int(aSkin.y + 0.5) * 3; pR0 = texelFetch(pplTex, ivec2(c1, r), 0); pR1 = texelFetch(pplTex, ivec2(c1 + 1, r), 0); pR2 = texelFetch(pplTex, ivec2(c1 + 2, r), 0); }
#else
  int c1 = int(aSkin.y + 0.5) * 3; float w = aSkin.z;
  pR0 = texelFetch(pplTex, ivec2(c0, r), 0); pR1 = texelFetch(pplTex, ivec2(c0 + 1, r), 0); pR2 = texelFetch(pplTex, ivec2(c0 + 2, r), 0);
  if (w < 0.999) { pR0 = mix(texelFetch(pplTex, ivec2(c1, r), 0), pR0, w); pR1 = mix(texelFetch(pplTex, ivec2(c1 + 1, r), 0), pR1, w); pR2 = mix(texelFetch(pplTex, ivec2(c1 + 2, r), 0), pR2, w); }
#endif
  pSkin = iSkin; pTop = iTop; pBot = iBot; pHat = iHat; pHair = iHair; pAcc = iAcc; pJnt = iJnt;
  pPart = aSkin.w; pBind = position + aMA * pSkin.a + aMB * pTop.a; pUv = uv;
  int fl = int(pBot.a + 0.5);
  if ((fl & 1) != 0 && (int(pPart + 0.5) == P_HAIR || int(pPart + 0.5) == P_BUN)) {       // hat on: press the hair under the crown
    vec3 hc = vec3(0.0, 1.665, 0.01); float k = smoothstep(1.64, 1.72, pBind.y);
    pBind = mix(pBind, hc + (pBind - hc) * vec3(0.94, 0.9, 0.94), k);
  }
}
vec3 pplXf(vec3 p){ vec4 q = vec4(p, 1.0); return vec3(dot(pR0, q), dot(pR1, q), dot(pR2, q)); }
vec3 pplXn(vec3 n){ return normalize(vec3(dot(pR0.xyz, n), dot(pR1.xyz, n), dot(pR2.xyz, n))); }
bool pplHidden(){
  int f = int(pBot.a + 0.5), p = int(pPart + 0.5), hs = (f >> 1) & 3;
  if ((p == P_HAT || p == P_BRIM) && (f & 1) == 0) return true;
  if (p == P_HAIR && hs == 0) return true;
  if (p == P_BUN && hs != 3) return true;
  if (p == P_BEARD && (f & 8) == 0) return true;
  if (p == P_PROP && (f & 32) == 0) return true;
  if (p == P_VEST && (f & 128) != 0) return true;              // HUMAN c6: no vest (a coverall, a shirt on its own)
  return false;
}
`;
// cut-outs shared by the colour and shadow passes (vest armholes, hairline and hair length)
const GLSL_CLIP = /* glsl */`
float ph12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float pvn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(ph12(i), ph12(i + vec2(1, 0)), f.x), mix(ph12(i + vec2(0, 1)), ph12(i + vec2(1, 1)), f.x), f.y); }
vec3 pHeadU(){ return normalize((pBind - vec3(0.0, 1.665, 0.01)) / vec3(0.077, 0.118, 0.099)); }
void pplClip(){
  int p = int(pPart + 0.5), f = int(pBot.a + 0.5), hs = (f >> 1) & 3;
  vec3 b = pBind; float ax = abs(b.x);
  if (p == P_VEST) {
    vec2 q = vec2((ax - 0.205) / 0.085, (b.y - 1.43) / 0.2);
    if (dot(q, q) < 1.0) discard;
    if (b.z > 0.0 && ax < 0.0045) discard;
    if (b.y > 1.44 && abs(ax - 0.085) > 0.035) discard;
  }
  if (p == P_HAIR) {
    vec3 u = pHeadU(); float n = pvn(vec2(atan(u.z, u.x) * 9.0, u.y * 7.0)) - 0.5;
    float line = mix(0.3, 0.56, smoothstep(0.35, 0.95, u.z)) + 0.06 * smoothstep(0.15, 0.45, abs(u.x)) * smoothstep(0.5, 0.9, u.z);   // hairline (front higher, temples)
    line = mix(line, 0.02, smoothstep(0.4, -0.2, u.z));
    line += pHat.a * pHat.a * 0.22 * smoothstep(0.3, 0.9, u.z);                     // age recedes the front
    if (u.z > (hs == 2 ? 0.45 : -0.1) && u.y < line + n * 0.05) discard;
    if (hs != 2 && b.y < mix(1.615, 1.57, smoothstep(-0.1, -0.7, u.z)) + n * 0.012 && u.z < 0.35) discard;   // short / tied back: sideburns, nape
    if (hs == 2 && b.y < 1.47 + n * 0.03) discard;
  }
  if (p == P_BEARD) {
    vec3 u = pHeadU(); float n = pvn(vec2(atan(u.z, u.x) * 12.0, u.y * 10.0)) - 0.5;
    float top = mix(-0.34, -0.05, smoothstep(0.5, 0.9, abs(u.x)));
    bool must = abs(u.x) < 0.34 && u.y < -0.25 && u.y > -0.36 && u.z > 0.5;
    if (u.y > top + n * 0.06 && !must) discard;
    if (pow(u.x / 0.19, 2.0) + pow((u.y + 0.405) / 0.032, 2.0) < 1.0 && u.z > 0.5) discard;       // the mouth
  }
}
`;
const GLSL_FRAG = GLSL_COMMON + GLSL_CLIP + /* glsl */`
uniform float pplShout;
float band(float x, float c, float w){ return smoothstep(w, w * 0.4, abs(x - c)); }
float seam(float d, float w){ return smoothstep(w, 0.0, abs(d)); }
float rectEdge(vec2 p, vec2 lo, vec2 hi, float w){ vec2 c = (lo + hi) * 0.5, h = (hi - lo) * 0.5; vec2 d = abs(p - c) - h; float e = max(d.x, d.y); return smoothstep(w, 0.0, abs(e)); }
float inRect(vec2 p, vec2 lo, vec2 hi){ return step(lo.x, p.x) * step(p.x, hi.x) * step(lo.y, p.y) * step(p.y, hi.y); }
float pMetalV = 0.0, pRetroM = 0.0;
uniform float pplRetro;
void pplShade(inout vec3 col, inout float rough, inout float bump){
  int p = int(pPart + 0.5), f = int(pBot.a + 0.5);
  vec3 b = pBind; float ax = abs(b.x), sd = sign(b.x), age = pHat.a, seed = pHair.a;
  bool gloves = (f & 16) != 0, stubble = (f & 64) != 0, cover = (f & 256) != 0, c6 = (f & 512) != 0;
  float wear = c6 ? pJnt.w : 0.0;
  vec3 skin = pSkin.rgb, top = pTop.rgb, bot = pBot.rgb, hat = pHat.rgb, hair = mix(pHair.rgb, vec3(0.42, 0.41, 0.4), smoothstep(0.35, 1.0, age) * 0.85), acc = pAcc.rgb;
  float fine = 1.0 - smoothstep(0.004, 0.02, length(fwidth(b)));     // fade fine detail with distance
  float n1 = pvn(b.xy * 60.0 + b.z * 37.0), n2 = pvn(b.zy * 18.0 + seed * 40.0);
  float ao = 1.0;
  col = top; rough = 0.85;
  if (p == P_HEAD || p == P_NECK || p == P_EAR) {
    col = skin * (0.94 + 0.1 * n2) * mix(vec3(1.0), vec3(1.04, 0.95, 0.93), pvn(b.xy * 25.0 + seed * 9.0)); rough = 0.68;
    if (p == P_HEAD) {
      vec3 u = pHeadU(); float fr = smoothstep(0.45, 0.85, u.z);
      float sock = exp(-(pow(abs(u.x) - 0.33, 2.0) / 0.014 + pow(u.y - 0.1, 2.0) / 0.007)) * fr;
      col *= 1.0 - 0.28 * sock;
      { vec2 e = vec2(abs(u.x) - 0.355, u.y - 0.09 - 0.05 * pow(abs(u.x) - 0.355, 2.0));
        float lidH = 0.03 * (1.0 - pow(clamp(abs(e.x) / 0.14, 0.0, 1.0), 2.0));        // almond aperture
        float ap = smoothstep(0.004, -0.004, abs(e.y + 0.004) - lidH) * step(abs(e.x), 0.14) * fr;
        float iris = smoothstep(0.062, 0.05, length(vec2(e.x + 0.012 * sign(u.x), e.y * 1.4))) * ap;
        float pupil = smoothstep(0.024, 0.016, length(vec2(e.x + 0.012 * sign(u.x), e.y * 1.4))) * ap;
        float lid = smoothstep(0.012, 0.0, abs(e.y - lidH - 0.002)) * step(abs(e.x), 0.15) * fr;   // upper lid line + lashes
        float crease = smoothstep(0.012, 0.0, abs(e.y - lidH - 0.035)) * step(abs(e.x), 0.13) * fr;
        vec3 white = vec3(0.78, 0.72, 0.66) * (0.55 + 0.45 * smoothstep(0.14, 0.05, abs(e.x)));
        float fe = fine * fine;
        col = mix(col, white * dot(skin, vec3(0.3)) * 2.2, ap * 0.85 * fe);
        col = mix(col, mix(vec3(0.16, 0.1, 0.05), vec3(0.2, 0.24, 0.26), step(0.75, fract(seed * 5.3))), iris * fe);
        col = mix(col, vec3(0.02), pupil * fe);
        col = mix(col, vec3(0.05, 0.035, 0.03), lid * 0.85 * fe);
        col *= 1.0 - 0.2 * crease * fe;
        col = mix(col, col * 0.55, ap * (1.0 - fe));                                  // far: just the dark of the eye
        rough = mix(rough, 0.25, ap * fe); }
      float brow = smoothstep(0.035, 0.012, abs(u.y - 0.205 + 0.05 * pow(abs(u.x) - 0.3, 2.0) * 6.0)) * smoothstep(0.1, 0.18, abs(u.x)) * smoothstep(0.6, 0.48, abs(u.x)) * fr;
      col = mix(col, hair * 0.55, 0.85 * brow);
      float lip = exp(-(u.x * u.x / 0.035 + pow(u.y + 0.4, 2.0) / 0.0025)) * fr;
      col = mix(col, col * vec3(0.78, 0.52, 0.5), 0.55 * lip);
      float mouth = exp(-(u.x * u.x / 0.03 + pow(u.y + 0.393, 2.0) / 0.00022)) * fr;
      col *= 1.0 - 0.55 * mouth * fine;
      if (pplShout > 0.001) {                                       // the shout: an open mouth, dark cavity, upper teeth
        float sh = pplShout, yc = -0.41 - 0.07 * sh, hh = 0.02 + 0.115 * sh, ww = 0.17 + 0.09 * sh;
        float q = pow(u.x / ww, 2.0) + pow((u.y - yc) / hh, 2.0);
        float cav = smoothstep(1.0, 0.8, q) * fr;
        float teeth = cav * smoothstep(yc + hh * 0.35, yc + hh * 0.5, u.y) * step(abs(u.x), ww * 0.8);
        float tongue = cav * smoothstep(yc - hh * 0.3, yc - hh * 0.8, u.y);
        col = mix(col, vec3(0.07, 0.015, 0.015), cav);
        col = mix(col, vec3(0.32, 0.07, 0.07), tongue * 0.7);
        col = mix(col, vec3(0.78, 0.72, 0.62), teeth);
        col = mix(col, col * vec3(0.8, 0.55, 0.5), smoothstep(1.35, 1.0, q) * (1.0 - cav) * 0.6 * fr);   // the lips stretched round it
        ao *= 1.0 - 0.25 * sh * exp(-(u.x * u.x / 0.05 + pow(u.y + 0.6, 2.0) / 0.01)) * fr;                  // the chin drops into shadow
      }
      col = mix(col, col * vec3(1.05, 0.8, 0.75), 0.25 * exp(-(pow(abs(u.x) - 0.5, 2.0) / 0.03 + pow(u.y + 0.15, 2.0) / 0.02)) * fr);   // cheeks
      col = mix(col, col * vec3(1.04, 0.82, 0.78), 0.3 * exp(-(u.x * u.x / 0.008 + pow(u.y + 0.2, 2.0) / 0.01)) * fr);                // nose
      if (stubble) col = mix(col, hair * 0.6, 0.35 * smoothstep(-0.2, -0.36, u.y + 0.12 * smoothstep(0.4, 0.9, abs(u.x))) * smoothstep(-0.3, 0.2, u.z) * (0.7 + 0.3 * n1));
      ao *= mix(1.0, 0.72, smoothstep(-0.65, -0.95, u.y));
      ao *= mix(1.0, 0.8, smoothstep(0.3, -0.2, u.z) * smoothstep(-0.2, -0.6, u.y));
      bump += (n1 - 0.5) * 0.0004 * fine * (0.4 + age);
    }
    if (p == P_NECK) ao *= mix(0.62, 1.0, smoothstep(1.55, 1.5, b.y)) * mix(0.75, 1.0, smoothstep(0.02, -0.03, b.z));
    if (p == P_EAR) { col *= vec3(1.02, 0.86, 0.82); ao *= 0.85; }
  } else if (p == P_HAIR || p == P_BUN || p == P_BEARD) {
    float fh = 1.0 - smoothstep(0.0015, 0.006, length(fwidth(b)));
    float strand = p == P_BEARD ? pvn(b.xy * 900.0 + b.z * 700.0) : pvn(vec2(atan(b.z, b.x) * 160.0, b.y * 12.0));
    col = hair * (0.86 + 0.28 * (strand - 0.5) * fh); rough = 0.7; bump += (strand - 0.5) * 0.0008 * fh;
    if (p == P_BEARD) { col *= 0.8; rough = 0.85; }
    if (p == P_HAIR) col *= 0.8 + 0.25 * smoothstep(-0.2, 0.8, pHeadU().y);             // crown catches light, nape in shade
  } else if (p == P_HAND || p == P_FING) {
    col = skin; rough = 0.6;
    if (gloves) { col = OUTFIT == 4 ? vec3(0.3, 0.19, 0.1) : vec3(0.26, 0.2, 0.13); col *= 0.85 + 0.3 * n2; rough = 0.9; bump += (n1 - 0.5) * 0.0008 * fine;
      float cuff = smoothstep(0.895, 0.905, b.y); col = mix(col, OUTFIT == 4 ? vec3(0.22, 0.14, 0.08) : vec3(0.42, 0.12, 0.06), cuff); bump += cuff * sin(b.y * 900.0) * 0.0006 * fine;
      col *= 1.0 - 0.4 * band(b.y, 0.895, 0.006) * fine; }
    if (p == P_FING) { float gz = abs(fract((b.z + 0.041) / 0.0205) - 0.5); col *= mix(1.0, 0.45, smoothstep(0.16, 0.0, gz) * fine); bump -= smoothstep(0.2, 0.0, gz) * 0.0016 * fine;
      col *= mix(1.0, 0.75, band(b.y, 0.79, 0.006) * fine); }
    if (p == P_HAND && !gloves) col *= mix(1.0, 0.92, smoothstep(0.86, 0.9, b.y));
  } else if (p == P_BOOT) {
    col = mix(vec3(0.3, 0.17, 0.08), vec3(0.09, 0.065, 0.05), step(0.5, fract(seed * 7.31))); rough = 0.55;
    col *= 0.8 + 0.3 * n2;
    col = mix(col, col * 1.6 + 0.04, 0.35 * smoothstep(0.13, 0.19, b.z) * smoothstep(0.035, 0.02, b.y));          // scuffed toe
    if (b.y < 0.022) { col = vec3(0.05, 0.045, 0.04); rough = 0.95; }
    col *= mix(1.0, 0.55, band(b.y, 0.024, 0.004));                                                               // welt
    float lace = step(0.0, b.z) * step(b.z, 0.09) * smoothstep(0.02, 0.012, abs(ax - 0.105 - b.z * 0.06)) * step(0.05, b.y);
    col = mix(col, vec3(0.35, 0.25, 0.14), lace * step(0.5, fract(b.z * 80.0)) * fine);
  } else if (p == P_PELVIS || p == P_LEG) {
    col = bot; rough = 0.9;
    bool denim = OUTFIT == 1 || OUTFIT == 2 || OUTFIT == 3;
    if (denim) {
      col *= 1.0 + 0.28 * exp(-pow(b.y - 0.72, 2.0) / 0.012) * smoothstep(-0.02, 0.06, b.z) + 0.18 * exp(-pow(b.y - 0.5, 2.0) / 0.003) * smoothstep(0.0, 0.06, b.z);
      col *= 0.92 + 0.12 * n2;
    } else col *= 0.9 + 0.15 * n2;
    float legcx = p == P_LEG ? ax - (b.y > 0.5 ? mix(0.1, 0.092, (b.y - 0.5) / 0.49) : 0.1) : 0.0;
    float sideSeam = p == P_LEG ? seam(b.z - 0.004, 0.0035) : 0.0;
    col *= 1.0 - 0.3 * sideSeam * fine; bump -= sideSeam * 0.0006 * fine;
    // folds: stacking at the boot, knees, the seat
    float fold = 0.0;
    if (p == P_LEG) {
      float ang = atan(b.z, legcx);
      fold += sin(b.y * 420.0 + sin(ang * 3.0 + seed * 9.0) * 2.5) * smoothstep(0.24, 0.1, b.y);
      fold += 0.7 * sin(b.y * 300.0 + sin(ang * 2.0) * 3.0) * exp(-pow(b.y - 0.52, 2.0) / 0.003) * smoothstep(0.05, -0.02, b.z - 0.01);
      fold += 0.5 * sin((b.y + legcx * 2.0) * 180.0) * exp(-pow(b.y - 0.84, 2.0) / 0.003) * step(0.0, b.z);
    }
    bump += fold * 0.0006 * fine * (0.4 + 0.9 * n2);
    ao *= mix(1.0, 0.7, smoothstep(0.045, 0.0, ax) * step(b.y, 0.9));
    if (p == P_PELVIS && OUTFIT != 3 && !cover) {   // belt and buckle
      float belt = step(1.035, b.y) * step(b.y, 1.07);
      col = mix(col, vec3(0.1, 0.07, 0.05), belt); rough = mix(rough, 0.5, belt);
      float buckle = belt * step(ax, 0.028) * step(0.05, b.z);
      col = mix(col, vec3(0.55, 0.5, 0.42), buckle); bump += (belt * 0.0015 + buckle * 0.002) * fine;
      // back pockets
      col *= 1.0 - 0.35 * fine * rectEdge(vec2(ax, b.y), vec2(0.035, 0.87), vec2(0.13, 1.0), 0.003) * step(b.z, -0.02);
    }
    if (OUTFIT == 3) { col *= 1.0 - 0.3 * fine * rectEdge(vec2(ax, b.y), vec2(0.04, 0.9), vec2(0.13, 1.02), 0.003) * step(b.z, -0.02); }
  } else if (p == P_HAT || p == P_BRIM) {
    col = hat; rough = 0.8;
    vec3 u = pHeadU();
    if (OUTFIT == 0 && c6) { float sc6 = smoothstep(0.85, 0.97, pvn(vec2(atan(u.z, u.x) * 30.0, u.y * 60.0) + seed * 9.0)); col = mix(col, col * 0.6, wear * (0.4 * sc6 + 0.5 * smoothstep(0.5, 0.8, n2) * (1.0 - smoothstep(0.2, 0.6, u.y)))); col = mix(col, col * 0.85 + 0.08, wear * 0.4 * smoothstep(0.4, 1.0, u.y)); }
    if (OUTFIT == 0) { rough = c6 ? 0.45 + 0.2 * wear : 0.28; col *= 0.95 + 0.08 * n2; float stk = exp(-(u.x * u.x / 0.02 + pow(u.y - 0.55, 2.0) / 0.02)) * step(0.3, u.z); col = mix(col, vec3(0.55, 0.04, 0.03), smoothstep(0.5, 0.6, stk)); }
    if (OUTFIT == 1 || OUTFIT == 3) {
      if (p == P_HAT && b.z < 0.05) { float m = step(0.5, fract(b.x * 260.0)) * step(0.5, fract(b.y * 260.0)); col = mix(col * 0.8 + 0.05, col * 0.55, 0.5 * m * fine); }        // mesh back in the cap's colour
      if (p == P_HAT) bump += seam(abs(b.x) - 0.002, 0.003) * 0.001 * fine;
      if (p == P_BRIM) { col *= 0.9; bump += band(fract(b.z * 70.0), 0.5, 0.1) * 0.0003 * fine; }
    }
    if (OUTFIT == 2) { float st = step(0.62, fract((atan(b.z - 0.01, b.x) / 6.2832) * 70.0)); col = mix(col, vec3(0.8, 0.8, 0.76), st * fine * float(p == P_HAT)); }
    if (OUTFIT == 4) { float rib = abs(fract(atan(b.z, b.x) / 6.2832 * 90.0) - 0.5); bump += rib * 0.0012 * fine; col *= 0.85 + 0.25 * rib; }
    if (p == P_BRIM) ao *= 0.85;
  } else if (p == P_PROP) {
    col = b.z < 0.27 ? vec3(0.42, 0.28, 0.14) : vec3(0.2, 0.2, 0.21); rough = b.z < 0.27 ? 0.7 : 0.35;
  } else if (p == P_VEST) {
    col = acc * 1.1; rough = 0.8;
    float tape = max(band(b.y, 1.075, 0.016), band(b.y, 1.185, 0.016));
    tape = max(tape, band(ax, 0.085, 0.016) * step(1.19, b.y));
    col = mix(col, c6 ? vec3(0.24, 0.25, 0.25) : vec3(0.78, 0.8, 0.8), tape); rough = mix(rough, c6 ? 0.5 : 0.25, tape); if (c6) pRetroM = tape;
    col *= 1.0 - 0.25 * seam(ax - 0.006, 0.003) * step(0.0, b.z) * fine;
    bump += (n1 - 0.5) * 0.0004 * fine;
  } else if (p == P_COLLAR) {
    col = OUTFIT == 2 ? acc : top; rough = 0.9;
    if (OUTFIT == 2) { float rib = abs(fract(atan(b.z, b.x) / 6.2832 * 160.0) - 0.5); bump += rib * 0.0008 * fine; col *= 0.85 + 0.25 * rib; }
    if (OUTFIT == 1) { vec2 g = vec2(atan(b.z, b.x) * 0.07, b.y) * 11.0; col = mix(col, col * 0.35, 0.5 * step(0.62, fract(g.x))); }
    ao *= 0.9;
  } else {
    // ---------------- torso & sleeves
    bool arm = p == P_ARM;
    float V = b.y, U = pUv.x;
    col = top;
    if (OUTFIT == 1) {           // flannel
      vec2 g = vec2(arm ? U : atan(b.z, b.x) * 0.16, V) * 10.5 + seed * 3.0;
      float sx = step(0.58, fract(g.x)), sy = step(0.58, fract(g.y)), lx = band(fract(g.x * 1.0), 0.29, 0.03), ly = band(fract(g.y), 0.29, 0.03);
      vec3 pl = top * (1.0 - 0.42 * sx - 0.42 * sy + 0.2 * sx * sy); pl = mix(pl, mix(top, acc, 0.5), 0.45 * max(lx, ly));
      col = mix(top * 0.72, pl, fine); rough = 0.95; bump += (pvn(vec2(U, V) * 400.0) - 0.5) * 0.0003 * fine;
      if (arm && V < 1.085) { col = skin; rough = 0.6; }
      if (arm && V >= 1.085 && V < 1.11) { col = top * 0.8; }
    } else if (OUTFIT == 0) {    // work shirt under the vest
      rough = 0.85; col *= 0.9 + 0.12 * n2;
    } else if (OUTFIT == 2) {    // canvas chore coat
      col *= 0.88 + 0.2 * n2; rough = 0.95;
      col *= 1.0 + 0.12 * pvn(vec2(U, V) * 900.0) * fine;
    } else if (OUTFIT == 4) {    // leather welding jacket
      col *= 0.8 + 0.35 * n2; rough = 0.72 + 0.2 * n2;
      float scorch = smoothstep(0.62, 0.8, pvn(b.xy * 14.0 + seed * 20.0)) * (arm ? 1.0 : 0.5);
      col = mix(col, vec3(0.06, 0.04, 0.03), 0.6 * scorch);
      if (dot(top, vec3(0.33)) > 0.4) {             // aluminized melter's coat: dirty silver, quilted, buckled straps
        col = vec3(0.55, 0.55, 0.53) * (0.7 + 0.35 * n2) * (1.0 - 0.35 * smoothstep(0.55, 0.85, pvn(b.xy * 9.0 + seed * 3.0)));
        rough = 0.5 + 0.15 * n2; pMetalV = 0.75;
        bump += sin(V * 160.0) * 0.0006 * fine;
        if (!arm) { float st = max(max(band(V, 1.0, 0.012), band(V, 1.15, 0.012)), band(V, 1.3, 0.012)) * step(0.0, b.z) * step(ax, 0.09);
          col = mix(col, vec3(0.08, 0.07, 0.06), st); rough = mix(rough, 0.8, st); pMetalV *= 1.0 - st;
          float bk = st * smoothstep(0.02, 0.012, abs(b.x - 0.05)); col = mix(col, vec3(0.5, 0.46, 0.4), bk); pMetalV = max(pMetalV, bk); }
      }
    } else if (OUTFIT == 3) {    // tee under bib overalls
      rough = 0.9; col *= 0.92 + 0.1 * n2;
      if (arm && V < 1.285) { col = skin; rough = 0.6; }
    }
    if (!arm) {
      // plackets, buttons, pockets
      bool front = b.z > 0.0;
      if (OUTFIT == 1 || OUTFIT == 0 || OUTFIT == 2) {
        float pl = seam(b.x - 0.012, 0.0025) * step(0.0, b.z);
        col *= 1.0 - 0.35 * pl * fine; bump -= pl * 0.0008 * fine;
        for (int i = 0; i < 5; i++) { float by = 1.0 + float(i) * 0.1; if (OUTFIT == 2) by = 0.9 + float(i) * 0.12;
          float bt = smoothstep(0.0075, 0.005, length(vec2(b.x - 0.02, b.y - by))) * step(0.0, b.z);
          col = mix(col, OUTFIT == 2 ? vec3(0.12, 0.1, 0.08) : col * 0.6, bt * fine); bump += bt * 0.0015 * fine; }
        vec2 cp = vec2(ax, V); float pk = rectEdge(cp, vec2(0.04, 1.26), vec2(0.13, 1.37), 0.0025) * step(0.0, b.z);
        if (OUTFIT == 2) pk = max(pk, rectEdge(cp, vec2(0.04, 0.84), vec2(0.155, 1.0), 0.0025) * step(0.0, b.z));
        if (OUTFIT == 2 && sd < 0.0) pk *= 0.0 + step(1.2, V);
        col *= 1.0 - 0.35 * pk * fine; bump -= pk * 0.0012 * fine;
      }
      if (OUTFIT == 4) { float zp = seam(b.x - 0.004, 0.003) * step(0.0, b.z); col *= 1.0 - 0.5 * zp * fine;
        for (int i = 0; i < 5; i++) { float bt = smoothstep(0.007, 0.004, length(vec2(b.x - 0.03, b.y - (0.92 + float(i) * 0.13)))) * step(0.0, b.z); col = mix(col, vec3(0.4, 0.38, 0.33), bt * fine); rough = mix(rough, 0.3, bt); } }
      if (OUTFIT == 3) {        // bib, straps, buckles
        float bibW = 0.125 - (V - 1.1) * 0.08;
        float bib = (front && ax < bibW && V < 1.35) || V < 1.075 ? 1.0 : 0.0;
        float sx = front ? 0.095 : mix(0.02, 0.11, smoothstep(1.2, 1.48, V));
        float strap = smoothstep(0.02, 0.016, abs(ax - sx)) * step(front ? 1.34 : 1.15, V);
        float m = max(bib, strap);
        vec3 den = bot * (0.92 + 0.12 * n2);
        col = mix(col, den, m); rough = mix(rough, 0.9, m);
        col *= 1.0 - 0.3 * fine * rectEdge(vec2(ax, V), vec2(0.0, 1.18), vec2(0.075, 1.3), 0.0025) * step(0.0, b.z);
        float bk = smoothstep(0.014, 0.01, length(vec2(ax - 0.095, V - 1.335))) * step(0.0, b.z);
        col = mix(col, vec3(0.6, 0.56, 0.48), bk); rough = mix(rough, 0.3, bk); bump += bk * 0.002 + strap * 0.001 * fine;
        col *= 1.0 - 0.3 * seam(abs(ax - bibW), 0.003) * step(0.0, b.z) * step(V, 1.35) * step(1.075, V) * fine;
      }
      // folds: waist, armpits, back
      float fold = sin(V * 260.0 + sin(atan(b.z, b.x) * 3.0 + seed * 7.0) * 2.0) * exp(-pow(V - 1.06, 2.0) / 0.002);
      fold += sin((V - ax * 1.4) * 220.0) * smoothstep(0.11, 0.17, ax) * exp(-pow(V - 1.3, 2.0) / 0.004);
      bump += fold * 0.0007 * fine * (0.3 + n2);
      ao *= mix(1.0, 0.72, smoothstep(0.13, 0.18, ax) * exp(-pow(V - 1.3, 2.0) / 0.006));        // under the arms
      ao *= mix(1.0, 0.8, smoothstep(1.52, 1.545, V));
      if (OUTFIT == 2 || OUTFIT == 4) ao *= mix(1.0, 0.8, smoothstep(0.83, 0.78, V));
    } else {
      float fold = sin(V * 340.0 + sin(atan(b.z, b.x) * 2.0 + seed * 5.0) * 2.5) * exp(-pow(V - 1.16, 2.0) / 0.0025);
      fold += 0.6 * sin(V * 250.0 + atan(b.z, b.x) * 1.5) * exp(-pow(V - 0.93, 2.0) / 0.001);   // cuff bunching
      bump += fold * 0.0007 * fine * (0.3 + n2);
      if (OUTFIT == 1 && V >= 1.085 && V < 1.11) bump += sin(V * 700.0) * 0.001 * fine;
      col *= 1.0 - 0.3 * band(V, 1.405, 0.005) * fine; bump -= band(V, 1.405, 0.005) * 0.001 * fine;       // the armhole seam
      ao *= 1.0 - 0.22 * exp(-pow(V - 1.16, 2.0) / 0.0012);                                                 // the elbow crease
      ao *= mix(1.0, 0.8, smoothstep(1.43, 1.49, V));
    }
  }
  if (cover && (p == P_TORSO || p == P_ARM || p == P_LEG || p == P_PELVIS || p == P_COLLAR)) {   // HUMAN c6: a coverall: one cloth, a zip, a chest pocket, reflective bands
    if (p == P_TORSO && b.z > 0.0) { float zp = seam(b.x, 0.004); col *= 1.0 - 0.45 * zp * fine; bump -= zp * 0.0008 * fine;
      col *= 1.0 - 0.35 * fine * rectEdge(vec2(b.x, b.y), vec2(0.04, 1.27), vec2(0.13, 1.38), 0.003); }
    float band = 0.0;
    if (p == P_TORSO) band = smoothstep(0.03, 0.022, abs(b.y - 1.22));
    if (p == P_ARM) band = smoothstep(0.025, 0.018, abs(b.y - 1.17));
    if (p == P_LEG) band = smoothstep(0.025, 0.018, abs(b.y - 0.36));
    if ((f & 1024) != 0) { col = mix(col, c6 ? vec3(0.24, 0.25, 0.25) : vec3(0.75), band); rough = mix(rough, 0.5, band); pRetroM = max(pRetroM, band); }
  }
  if (c6 && (p == P_LEG || p == P_PELVIS || p == P_TORSO || p == P_ARM)) {       // HUMAN c6: wear where the work touches the cloth; folds that follow the joints
    float ax2 = abs(b.x), sp = pvn(b.xy * 9.0 + seed * 21.0) * 0.6 + n2 * 0.4;
    vec3 dust = vec3(0.5, 0.45, 0.38);
    if (p == P_LEG) { float knee = exp(-pow(b.y - 0.5, 2.0) / 0.004) * smoothstep(-0.01, 0.04, b.z);
      col = mix(col, col * 1.3 + 0.03, 0.55 * wear * knee * smoothstep(0.35, 0.65, sp));
      col = mix(col, mix(col, dust * 0.7, 0.6), 0.4 * wear * smoothstep(0.22, 0.08, b.y) * (0.6 + 0.4 * sp));
      col = mix(col, col * 0.55, 0.45 * wear * smoothstep(0.7, 0.62, b.y) * smoothstep(0.58, 0.66, b.y) * smoothstep(0.55, 0.75, sp) * step(0.0, b.z));
      float kF = sd > 0.0 ? pJnt.y : pJnt.z;
      bump += kF * 0.0011 * fine * sin(b.y * 260.0 + n1 * 3.0) * exp(-pow(b.y - 0.5, 2.0) / 0.003) * smoothstep(0.02, -0.04, b.z); }
    if (p == P_ARM) { float eF = pJnt.x;
      bump += eF * 0.001 * fine * sin(b.y * 300.0 + n1 * 3.0) * exp(-pow(b.y - 1.155, 2.0) / 0.0025);
      col = mix(col, col * 0.6, 0.4 * wear * smoothstep(0.98, 0.92, b.y) * smoothstep(0.5, 0.7, sp)); }
    if (p == P_TORSO) col = mix(col, col * 0.62, 0.35 * wear * smoothstep(0.62, 0.8, pvn(b.xy * 11.0 + seed * 5.0)));
  }
  // HUMAN c7 (d.backs): a garment's BACK has its own construction, and against a low sun a back with no cues reads as a front (the
  // MODELING c5 critic's crop): a yoke across the shoulder blades with a centre pleat under it, back pockets with a flap seam on the
  // trousers or coverall seat, the collar's stand seen from behind with its band, a hard hat's nape strap
  if ((f & 2048) != 0 && b.z < 0.0) { float bk = smoothstep(0.0, -0.035, b.z) * fine;
    if (p == P_TORSO) { float yy = 1.395 + 0.9 * ax * ax, yoke = seam(b.y - yy, 0.0045); col *= 1.0 - 0.42 * yoke * bk; bump -= yoke * 0.0009 * bk;
      col *= 1.0 - 0.07 * step(yy, b.y) * bk;                                                                   // the doubled yoke panel
      float pl = seam(b.x, 0.004) * smoothstep(yy, yy - 0.04, b.y) * smoothstep(1.12, 1.2, b.y); col *= 1.0 - 0.3 * pl * bk; bump -= pl * 0.0006 * bk;
      col *= 1.0 - 0.25 * seam(b.y - 1.06, 0.006) * bk; }                                                       // the waist seam / belt line from behind
    if (p == P_PELVIS || (p == P_LEG && b.y > 0.84)) { vec2 q = vec2(ax, b.y);
      float e = rectEdge(q, vec2(0.035, 0.885), vec2(0.135, 1.0), 0.0035), fl = seam(b.y - 0.975, 0.003) * inRect(q, vec2(0.035, 0.88), vec2(0.135, 1.01));
      col *= 1.0 - (0.45 * e + 0.3 * fl) * bk; col *= 1.0 - 0.05 * inRect(q, vec2(0.035, 0.885), vec2(0.135, 1.0)) * bk; bump -= (e + fl) * 0.0007 * bk;
      col *= 1.0 - 0.3 * seam(b.x, 0.004) * smoothstep(0.84, 0.9, b.y) * bk; }                                   // the centre back seam of the seat
    if (p == P_COLLAR) col *= 0.86;                                                                          // the collar's stand from behind: its shadowed band
    if (p == P_HEAD && (f & 1) != 0) { vec3 u = pHeadU(); float strap = smoothstep(0.035, 0.015, abs(u.y + 0.35)) * smoothstep(-0.2, -0.6, u.z); col = mix(col, vec3(0.06, 0.055, 0.05), 0.85 * strap * fine); }
  }
  // work dirt, age and wear
  col *= mix(1.0, 0.8 + 0.2 * n2, pAcc.a);
  col *= ao;
}
vec3 pplPerturb(vec3 sp, vec3 sn, float h){
  vec3 dx = dFdx(sp), dy = dFdy(sp), r1 = cross(dy, sn), r2 = cross(sn, dx);
  float det = dot(dx, r1); vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * sn - grad);
}
`;

// rain: 0 dry .. 1 soaked (wet cloth goes darker and glossier; skin and hi-vis tape keep their sheen). Shared by every People.
const WET = { value: 0 };
const SHOUT = { value: 0 };        // 0..1: every face's mouth open in a shout (dark cavity, upper teeth); 0 = closed
const RETRO_P = { value: 0 };      // HUMAN c6: a light at the lens (headlamp, truck lights, flash): c6 retroreflective tape sends it straight back
// PRODUCTION (iteration 5): while a person's material compiles through the hooks a scene put on People's own material (adopted: People
// _adopt), People's own base hook draws the person instead (BASE_SWAP.fn), so the scene's layers land on the person's shader
const BASE_SWAP = { fn: null };
function makeMaterials(outfit, lod, tex) {
  const uni = { pplTex: { value: tex }, pplWet: WET, pplShout: SHOUT, pplRetro: RETRO_P }, defines = { OUTFIT: outfit, PPL_LOD: lod };
  const VX = 'vec3 transformed = pplHidden() ? vec3(pR0.w, pR1.w, pR2.w) : pplXf(pBind);';
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  mat.defines = defines;
  mat.onBeforeCompile = (sh, r) => {
    if (BASE_SWAP.fn) return BASE_SWAP.fn(sh, r);
    sh.uniforms.pplTex = uni.pplTex; sh.uniforms.pplWet = uni.pplWet; sh.uniforms.pplShout = uni.pplShout; sh.uniforms.pplRetro = uni.pplRetro;
    sh.vertexShader = GLSL_VERT + sh.vertexShader
      .replace('#include <beginnormal_vertex>', 'pplSetup(); vec3 objectNormal = pplXn(normal);')
      .replace('#include <begin_vertex>', VX);
    sh.fragmentShader = GLSL_FRAG + sh.fragmentShader
      .replace('void main() {', 'void main() {\n pplClip();')
      .replace('#include <color_fragment>', 'float pRough = 0.85, pBumpH = 0.0; pplShade(diffuseColor.rgb, pRough, pBumpH);\n diffuseColor.rgb *= 1.0 - 0.3 * pplWet * step(0.7, pRough); pRough = pRough >= 0.7 ? max(0.78, mix(pRough, pRough * 0.9, pplWet)) : mix(pRough, pRough * 0.8, pplWet);')
      .replace('#include <common>', '#include <common>\nuniform float pplWet;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = pRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = pMetalV;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n#if PPL_LOD < 2\n normal = pplPerturb(-vViewPosition, normal, pBumpH);\n#endif')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * pRetroM * pplRetro * clamp(dot(normal, normalize(vViewPosition)) * 1.3 - 0.1, 0.0, 1.0);');
  };
  mat.customProgramCacheKey = () => `ppl-std-${outfit}-${lod}`;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.defines = defines;
  depth.onBeforeCompile = sh => {
    sh.uniforms.pplTex = uni.pplTex;
    sh.vertexShader = GLSL_VERT + sh.vertexShader.replace('#include <begin_vertex>', 'pplSetup(); ' + VX);
    sh.fragmentShader = GLSL_COMMON + GLSL_CLIP + sh.fragmentShader.replace('void main() {', 'void main() {\n pplClip();');
  };
  depth.customProgramCacheKey = () => `ppl-depth-${outfit}-${lod}`;
  return { mat, depth };
}

// ------------------------------------------------------------------ palettes (sRGB hex) and the random worker
const SKINS = ['#f0c8a8', '#e3b08c', '#d09a74', '#b98160', '#9a6446', '#7c4e34', '#5e3a26', '#46291a'];
const HAIRS = ['#1a120c', '#2a1c12', '#3e2a1a', '#5a3e24', '#7a5a3a', '#a07850', '#c8a878', '#2c2622'];
const PAL = {
  steel: { top: ['#3a4452', '#4a5058', '#2e3844', '#5a5248', '#445a6a'], bottom: ['#6a4a2a', '#5a4630', '#3a3a3c', '#7a5a34'], hat: ['#e8e4dc', '#e8c020', '#d8d8d4', '#e06a14', '#2a5ab0'], accent: ['#c8f020', '#ff7a14', '#e0f030'] },
  farm: { top: ['#8a1c1c', '#1c3a6a', '#2a5a34', '#6a1418', '#a07020', '#3a3a44'], bottom: ['#2c3e5e', '#34486a', '#26344e', '#3e5070'], hat: ['#8a1c1c', '#2a3a2a', '#1c2a4a', '#6a5a3a', '#c8c0b0', '#1c1c1c'], accent: ['#e8e0c8', '#101010', '#d8b040'] },
  rail: { top: ['#8a6232', '#6e5230', '#3a4a6a', '#9a7a48', '#4a3a2a'], bottom: ['#2c3e5e', '#26344e', '#3a3a3c'], hat: ['#2a3a6a', '#3a3a3a', '#2a2a44'], accent: ['#3a2618', '#2a1c14', '#4a3420'] },
  overalls: { top: ['#d8d0c0', '#8a1c1c', '#3a3a44', '#5a6a4a', '#c8b89a', '#2a2a30'], bottom: ['#34486a', '#2c3e5e', '#4a5a6a', '#6a5a3a'], hat: ['#8a1c1c', '#1c2a4a', '#c8c0b0', '#2a3a2a'], accent: ['#e8e0c8'] },
  weld: { top: ['#7a5230', '#6a4428', '#8a6a44', '#4a3020', '#3a2a22'], bottom: ['#2a2a2c', '#3a3226', '#2c3444'], hat: ['#1c1c1c', '#6a1414', '#2a3a2a', '#3a3a44', '#7a6a4a'], accent: ['#3a2618'] },
};
function pick(r, a) { return a[Math.floor(r() * a.length) % a.length]; }

// ------------------------------------------------------------------ poses (per bone Euler XYZ + hip offset)
const PW = NB * 3 + 3;
const UP = new THREE.Vector3(0, 1, 0);
function zero(Pz) { Pz.fill(0); }
function setArmHang(Pz, s, curl = 0.35, fw = 0.18) { const [ua, fa, hn, fg] = ARM(s); Pz[ua * 3 + 2] = s * 0.07; Pz[fa * 3] = -fw; Pz[hn * 3] = 0.05; Pz[fg * 3 + 2] = -s * curl; }
function poseStand(Pz, t, seed, age) {
  zero(Pz);
  const v = Math.floor(seed * 3) % 3, w = Math.sin(t * 0.45 + seed * 6.28), n = k => vnoise1(t * 0.35 + seed * 13 + k * 7.1, k);
  Pz[NB * 3] = 0.014 * w; Pz[B.hips * 3 + 2] = -0.035 * w; Pz[B.hips * 3 + 1] = 0.05 * n(1);
  Pz[B.spine * 3 + 2] = 0.02 * w; Pz[B.chest * 3 + 2] = 0.015 * w; Pz[B.chest * 3] = 0.02 + 0.012 * Math.sin(t * 1.5 + seed * 5) + age * 0.16; Pz[B.spine * 3] = age * 0.06;
  Pz[B.head * 3] = -0.03 + 0.05 * n(2) - age * 0.12; Pz[B.head * 3 + 1] = 0.4 * n(3); Pz[B.head * 3 + 2] = 0.03 * w + 0.02 * n(4);
  for (const s of [1, -1]) { const [th, sh, ft] = LEG(s), relax = clamp(0.5 - 0.5 * s * w);
    Pz[th * 3] = -0.04 - 0.08 * relax; Pz[th * 3 + 2] = s * (0.035 + 0.02 * relax); Pz[sh * 3] = 0.06 + 0.2 * relax; Pz[ft * 3] = -Pz[th * 3] - Pz[sh * 3]; Pz[ft * 3 + 2] = -Pz[th * 3 + 2];
    setArmHang(Pz, s, 0.35 + 0.1 * n(5 + s), 0.18 + 0.03 * Math.sin(t * 1.5 + seed * 5));
    const [ua, fa, hn, fg] = ARM(s);
    Pz[ua * 3] = 0.04 + 0.02 * Math.sin(t * 1.5 + seed * 5) + 0.02 * s * w;
    if (v === 1) { Pz[ua * 3] = 0.25; Pz[ua * 3 + 2] = s * 0.14; Pz[fa * 3] = -1.05; Pz[ua * 3 + 1] = -s * 0.35; Pz[fg * 3 + 2] = -s * 0.9; }     // thumbs at the belt
    if (v === 2) { Pz[ua * 3] = 0.12; Pz[fa * 3] = -0.32; Pz[fg * 3 + 2] = -s * 1.1; Pz[hn * 3] = 0.25; }                                     // hands loose, fists
  }
}
function poseWalk(Pz, ph, amt = 1, speed = 1, age = 0) {
  zero(Pz);
  for (const s of [1, -1]) {
    const phi = ph + (s > 0 ? 0 : Math.PI), [th, sh, ft] = LEG(s), [ua, fa, hn, fg] = ARM(s);
    const thr = -(0.04 + 0.42 * Math.sin(phi)) * amt;
    const knee = amt * (0.17 + 1.0 * Math.pow(Math.max(0, Math.cos(phi + 0.25)), 2) + 0.14 * Math.exp(-(wrap(phi - 2.4) ** 2) / 0.3));
    Pz[th * 3] = thr; Pz[th * 3 + 2] = s * 0.02; Pz[sh * 3] = knee;
    Pz[ft * 3] = -(thr + knee) + amt * (0.35 * Math.exp(-(wrap(phi + 1.35) ** 2) / 0.2) - 0.18 * Math.exp(-(wrap(phi - 1.5) ** 2) / 0.12)); Pz[ft * 3 + 2] = -s * 0.02;
    Pz[ua * 3] = 0.38 * amt * Math.sin(phi - 0.2) * (1 - age * 0.4); Pz[ua * 3 + 2] = s * 0.1;
    Pz[fa * 3] = -(0.22 + 0.4 * Math.max(0, -Math.sin(phi - 0.5))) * amt - 0.08; Pz[hn * 3] = 0.12 * Math.sin(phi - 0.9) * amt; Pz[fg * 3 + 2] = -s * 0.45;
  }
  Pz[NB * 3] = -0.02 * Math.cos(ph) * amt;
  Pz[B.hips * 3 + 1] = -0.12 * Math.sin(ph) * amt; Pz[B.hips * 3 + 2] = 0.06 * Math.cos(ph) * amt;
  Pz[B.spine * 3 + 1] = 0.04 * Math.sin(ph) * amt; Pz[B.chest * 3 + 1] = 0.16 * Math.sin(ph) * amt; Pz[B.chest * 3 + 2] = -0.02 * Math.cos(ph) * amt;
  const lean = 0.035 + 0.04 * speed * amt + age * 0.15; Pz[B.spine * 3] = lean * 0.5; Pz[B.chest * 3] = lean * 0.6;
  Pz[B.head * 3] = -lean * 0.9 + 0.02 * Math.cos(2 * ph) * amt; Pz[B.head * 3 + 1] = -0.5 * (Pz[B.chest * 3 + 1] + Pz[B.spine * 3 + 1] + Pz[B.hips * 3 + 1]);
}
function poseWork(Pz, c, seed) {   // hammer blows; c = cycle phase 0..1
  zero(Pz); c = ((c % 1) + 1) % 1;
  const raise = sstep(0.0, 0.55, c), strike = sstep(0.55, 0.66, c), settle = sstep(0.66, 1.0, c);
  const up = raise * (1 - strike), hit = strike * (1 - settle * 0.6);
  const [ua, fa, hn, fg] = ARM(-1), [ua2, fa2, hn2, fg2] = ARM(1);
  Pz[ua * 3] = lerp(-0.45, -2.5, up) + hit * 0.1; Pz[ua * 3 + 2] = -0.18 * up - 0.05; Pz[fa * 3] = lerp(-0.5, -1.5, up) * (1 - hit * 0.8) - 0.1; Pz[hn * 3] = 0.3 * up - 0.4 * hit; Pz[fg * 3 + 2] = 1.7;
  Pz[ua2 * 3] = -0.6 - 0.2 * hit; Pz[ua2 * 3 + 2] = 0.1; Pz[fa2 * 3] = -0.9 + 0.2 * up; Pz[fg2 * 3 + 2] = -0.6;
  Pz[B.chest * 3] = -0.12 * up + 0.32 * hit + 0.12; Pz[B.spine * 3] = 0.12 * hit + 0.08; Pz[B.chest * 3 + 1] = 0.12 * up - 0.08 * hit; Pz[B.chest * 3 + 2] = 0.04 * up;
  Pz[B.head * 3] = 0.25 + 0.12 * hit - 0.25 * up; Pz[B.head * 3 + 1] = -0.1 * up;
  for (const s of [1, -1]) { const [th, sh, ft] = LEG(s); Pz[th * 3] = -0.18 - 0.2 * hit - (s > 0 ? 0.15 : -0.1); Pz[th * 3 + 2] = s * 0.1; Pz[sh * 3] = 0.25 + 0.25 * hit; Pz[ft * 3] = -Pz[th * 3] - Pz[sh * 3]; Pz[ft * 3 + 2] = -s * 0.1; }
  Pz[NB * 3 + 2] = -0.02;
}
function poseFistArm(Pz, s, pump, t, seed) {
  const [ua, fa, hn, fg] = ARM(s);
  Pz[ua * 3] = -2.25 - 0.55 * pump; Pz[ua * 3 + 1] = -s * 0.25; Pz[ua * 3 + 2] = s * (0.34 - 0.14 * pump);
  Pz[fa * 3] = -(0.95 - 0.8 * pump); Pz[hn * 3] = 0.15 - 0.2 * pump; Pz[hn * 3 + 2] = 0; Pz[fg * 3 + 2] = -s * 1.75;
}
function poseFist(Pz, t, pump, seed, both = false) {
  poseStand(Pz, t, seed * 0.33, 0);
  poseFistArm(Pz, -1, pump, t, seed); if (both) poseFistArm(Pz, 1, pump, t, seed);
  else { const [ua, fa, hn, fg] = ARM(1); Pz[fa * 3] = -0.3; Pz[fg * 3 + 2] = -1.3; }
  Pz[B.chest * 3] = -0.05 - 0.06 * pump; Pz[B.chest * 3 + 2] = 0.05; Pz[B.head * 3] = -0.18 - 0.12 * pump; Pz[B.head * 3 + 1] *= 0.3;
  for (const s of [1, -1]) { const [th, sh, ft] = LEG(s); Pz[th * 3] = -0.06 - 0.12 * pump; Pz[th * 3 + 2] = s * 0.07; Pz[sh * 3] = 0.1 + 0.25 * pump; Pz[ft * 3] = -Pz[th * 3] - Pz[sh * 3]; Pz[ft * 3 + 2] = -s * 0.07; }
}
function poseMarch(Pz, ph, pump, amt) {
  poseWalk(Pz, ph, amt * 0.85, 0.8, 0);
  poseFistArm(Pz, -1, pump, 0, 0);
  Pz[B.chest * 3] -= 0.06; Pz[B.head * 3] -= 0.1;
}

// per-bone Euler XYZ in Pz[b * 3 + 0..2]; Pz[NB * 3 + 0..2] is the hip offset. For st.pose hooks.
const POSE_API = { NB, B, ARM, LEG, setArmHang };
// ------------------------------------------------------------------ People
const PAL_ATTR = ['iSkin', 'iTop', 'iBot', 'iHat', 'iHair', 'iAcc', 'iJnt'], PALW = PAL_ATTR.length * 4;
export class People {
  // scene: THREE.Scene. max: people capacity. viewH: render-target height in px (LOD is chosen by projected height).
  // lodPx: [LOD0 above, LOD1 above] px; budget: at most [n LOD0, n LOD1] (nearest first, the rest drop a level).
  // shadows: 'proxy' (LOD0 casts its own; everyone else casts through a shadow-only LOD2 proxy), 'full' (every LOD
  // casts its own geometry) or 'none'.
  constructor(scene, { max = 512, viewH = 1440, lodPx = [260, 90], budget = [24, 160], quality = [1, 0.3, 0.14], shadows = 'proxy', receiveShadow = true } = {}) {
    this.max = max; this.viewH = viewH; this.lodPx = lodPx; this.budget = budget; this.n = 0; this._px = new Float32Array(max); this._ord = [];
    this.data = new Float32Array(TEXW * max * 4);
    this.tex = new THREE.DataTexture(this.data, TEXW, max, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter; this.tex.needsUpdate = true;
    this.people = []; this.meshes = []; this.groups = {}; this.proxies = {}; this.pal = new Float32Array(max * PALW);
    this.stats = { verts: {}, tris: {}, drawn: [0, 0, 0] };
    // shadow proxies must be invisible to the main pass but drawn by the shadow pass: they stay hidden through
    // the renderer's projection and a zero-area sentinel ahead of them in the scene turns them on as shadows start
    if (shadows === 'proxy') {
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
      this.sentinel = new THREE.Mesh(sg, new THREE.MeshBasicMaterial()); this.sentinel.frustumCulled = false; this.sentinel.castShadow = true;
      this.sentinel.onBeforeShadow = () => { for (const t in this.proxies) this.proxies[t].m.visible = this.proxies[t].g.instanceCount > 0; if (this.person) for (const P2 of this.person.proxies) if (P2) P2.m.visible = P2.g.instanceCount > 0; };
      scene.add(this.sentinel);
    }
    const mkGroup = (g0, mat, depth) => {
      const g = new THREE.InstancedBufferGeometry();
      for (const k in g0.attributes) g.setAttribute(k, g0.attributes[k]); g.setIndex(g0.index);
      const rows = new Float32Array(max), attr = new THREE.InstancedBufferAttribute(rows, 1); attr.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aRow', attr);
      const pal = PAL_ATTR.map(k => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); return a; });
      g.instanceCount = 0;
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.customDepthMaterial = depth; m.receiveShadow = receiveShadow; m.visible = false;
      scene.add(m); this.meshes.push(m);
      return { g, attr, rows, pal, m };
    };
    for (const trade of TRADES) {
      this.groups[trade] = quality.map((q, lod) => {
        const { mat, depth } = makeMaterials(OUTFIT[trade], lod, this.tex), g0 = buildTrade(trade, q, lod);
        const G = mkGroup(g0, mat, depth);
        G.m.castShadow = shadows === 'full' || (shadows === 'proxy' && lod === 0);
        this.stats.verts[trade + lod] = g0.userData.verts; this.stats.tris[trade + lod] = g0.userData.tris;
        return G;
      });
      if (shadows === 'proxy') {
        const L2 = this.groups[trade][2], P2 = mkGroup(L2.g, L2.m.material, L2.m.customDepthMaterial);
        P2.m.castShadow = true; P2.m.receiveShadow = false; P2.m.userData.proxy = true;
        this.proxies[trade] = P2;
      }
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._inst = new THREE.Matrix4(); this._w = Array.from({ length: NB }, () => new THREE.Matrix4());
    this._P = new Float32Array(PW); this._Q = new Float32Array(PW);
    this._cam = new THREE.Vector3(); this._pos = new THREE.Vector3(); this.att = []; this._v2 = new THREE.Vector3();
    this.rigger = new PeopleRig({ NB, PARENT, JOINT, ARM, LEG, FOOTPTS });      // cycle 5: st.rig = { feet, hands, weight, load, look, ... } (lib/fx/rig/)
    this.scene = scene; this._mkGroup = mkGroup; this._shadowMode = shadows; this._matFns = []; this.person = null;
    if (personWanted()) { this._snapStandIns(); this._personStart(); }      // PRODUCTION: the crowd is the current person (below)
    this._qc = new THREE.Quaternion(); this._qh = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._m2 = new THREE.Matrix4(); this._t3 = new THREE.Vector3(); this._s3 = new THREE.Vector3();
    registerAudit(this);
  }
  // world-space frames for props, valid after update(): head (bone origin at the neck top, +y up the face, +z forward)
  // and grip(s): s = 1 the person's left hand (+X), s = -1 the right; origin at the knuckles, -y along the fingers.
  head(id) { return this.att[id]?.head; }
  grip(id, s) { return this.att[id]?.grip[s > 0 ? 0 : 1]; }
  gripPos(id, s, out = new THREE.Vector3()) { const m = this.grip(id, s); return m ? out.set(0, -0.045, 0.02).applyMatrix4(m) : out.set(0, -1e4, 0); }
  // every figure material, fn(material, trade, lod), one per trade and LOD (the shadow proxies share LOD2's): for a host's own patch on top of
  // the figures' skinning, e.g. atmos3d patchMaterial (8 Oct, GRAPHICS 4.B; it chains). Reads only.
  // (PRODUCTION, iteration 5) before the person arrives the hook goes on People's own materials (the stand-ins) and the person adopts it
  // with everything else the scene did to them (_adopt); once the person is drawn it goes on the person's materials only.
  eachMaterial(fn) { this._matFns.push(fn); if (this.person && this.person.state === 'person') { this._personMats(fn); return this; }
    for (const t of TRADES) this.groups[t].forEach((G, lod) => fn(G.m.material, t, lod)); return this; }
  // A believable random worker of a trade. Override any field.
  static get wet() { return WET; }
  static get shout() { return SHOUT; }
  static get retro() { return RETRO_P; }      // HUMAN c6: People.retro.value = a light at the lens (0 = none)
  static get API() { return POSE_API; }
  static random(trade = 'farm', seed = 1, o = {}) {
    const r = mulberry(seed * 7919 + 13), pal = PAL[trade], fem = r() < 0.28 ? 1 : 0, age = r() * r(), sk = Math.floor(r() * SKINS.length);
    const hairStyle = fem ? (r() < 0.3 ? 2 : 3) : (age > 0.6 && r() < 0.4 ? 0 : 1);
    return { trade, seed, fem, age, h: fem ? 1.6 + r() * 0.14 : 1.7 + r() * 0.18, heavy: clamp(r() * r() * 1.1 + age * 0.3),
      skin: SKINS[sk], hair: sk >= 4 || r() < 0.45 ? HAIRS[Math.floor(r() * 3)] : pick(r, HAIRS), top: pick(r, pal.top), bottom: pick(r, pal.bottom), hatColor: pick(r, pal.hat), accent: pick(r, pal.accent),
      hat: trade === 'steel' ? r() < 0.9 : trade === 'overalls' ? r() < 0.6 : r() < 0.8, hairStyle, beard: !fem && r() < 0.18, stubble: !fem && r() < 0.6,
      gloves: trade === 'weld' ? r() < 0.8 : trade === 'steel' ? r() < 0.4 : false, prop: false, dirt: r() * 0.6, ...o };
  }
  // HUMAN c6: a body of its own proportions. d.body = { leg, torso, arm, sh, hip, girth } (1 = the bind man; workforce.js fills them
  // from a real ANSUR II subject). Each segment is scaled along its length (and girth across it) in the skinning, the children's
  // offsets follow, the head and hands keep their size, and the stature stays d.h. Without d.body nothing changes.
  static _bodyScales(st) {
    const b = st.d.body, SC = new Float32Array(NB * 3).fill(1), set = (i, x, y, z) => { SC[i * 3] = x; SC[i * 3 + 1] = y; SC[i * 3 + 2] = z; };
    const g = b.girth ?? 1, gl = 1 + (g - 1) * 0.8, leg = b.leg ?? 1, tor = b.torso ?? 1, arm = b.arm ?? 1, sh = b.sh ?? 1, hip = b.hip ?? 1;
    set(B.hips, hip * g, tor, g); set(B.spine, g, tor, g); set(B.chest, sh * (0.5 + 0.5 * g), tor, 0.5 + 0.5 * g); set(B.neck, b.neck ?? 1, 1, b.neck ?? 1);
    for (const s of [1, -1]) { const A = ARM(s), L = LEG(s); set(A[0], gl, arm, gl); set(A[1], 0.5 + 0.5 * gl, arm, 0.5 + 0.5 * gl); set(L[0], gl, leg, gl); set(L[1], 0.5 + 0.5 * gl, leg, 0.5 + 0.5 * gl); }
    st._SC = SC;
    st._H0 = 0.085 + 0.845 * leg + 0.04 + 0.53 * tor + 0.28;          // the bind stature with these proportions: d.h / _H0 is the instance scale
  }
  // the retarget rig for bvh.js (identity bind rotations; bone directions from the bind joints)
  static get RIG() {
    if (People._rig) return People._rig;
    const V = (a, b) => new THREE.Vector3(JOINT[b][0] - JOINT[a][0], JOINT[b][1] - JOINT[a][1], JOINT[b][2] - JOINT[a][2]).normalize();
    const tip = [1, 2, 3, 4, -1, 6, 7, 8, 19, 10, 11, 12, 20, 14, 15, -2, 17, 18, -2, -1, -1];
    const dir = tip.map((t, b) => t >= 0 ? V(b, t) : t === -2 ? new THREE.Vector3(0, -0.3, 1).normalize() : b === 4 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, -1, 0));
    return (People._rig = { parent: PARENT.slice(), dir, legLen: Math.hypot(JOINT[13][1] - JOINT[15][1], JOINT[13][2] - JOINT[15][2]) });
  }
  // a worker whose variety sits where people look: head, hat, hair, beard, shoulders, height (not only shirt colour)
  static varied(trade = 'farm', seed = 1, o = {}) {
    const d = People.random(trade, seed), r = mulberry(seed * 104729 + 17), g = () => { let u = 0; for (let k = 0; k < 4; k++) u += r(); return (u - 2) / 0.577; };
    d.h = clamp((d.fem ? 1.64 : 1.77) + 0.06 * g(), 1.5, 1.98);
    d.heavy = clamp(d.heavy + 0.25 * g(), 0, 1);
    const hatRoll = r();
    d.hat = trade === 'steel' ? hatRoll < 0.8 : hatRoll < (trade === 'weld' ? 0.55 : 0.45);                   // more bare heads
    if (!d.hat) d.hairStyle = d.fem ? (r() < 0.5 ? 2 : 3) : (d.age > 0.55 && r() < 0.5 ? 0 : 1);
    d.beard = !d.fem && r() < 0.32; d.stubble = !d.fem && !d.beard && r() < 0.6;
    const HAIR2 = ['#0e0a08', '#1a120c', '#3e2a1a', '#6a4a2a', '#8a7a68', '#b8b0a4', '#2c2622'];
    d.hair = HAIR2[Math.floor(r() * HAIR2.length)];
    if (d.age > 0.6 && r() < 0.6) d.hair = '#9a948c';
    return { ...d, ...o };
  }
  // clumped crowd positions: groups of 1-7 round Poisson centres, gaps between groups, a looser rear. Returns [{x, z, g}]
  static crowdLayout(n, { width = 16, depth = 60, z0 = -4, seed = 5, clump = 0.7, minGap = 0.55 } = {}) {
    const r = mulberry(seed * 7 + 1), out = [];
    while (out.length < n) {
      const cz = z0 - Math.pow(r(), 0.85) * depth, cx = (r() - 0.5) * (width + (z0 - cz) * 0.15), k = 1 + Math.floor(r() * r() * 7), g = out.length;
      for (let i = 0; i < k && out.length < n; i++) {
        for (let tries = 0; tries < 12; tries++) {
          const x = cx + (r() - 0.5) * (1.2 + 1.6 * (1 - clump)) * Math.sqrt(k), z = cz + (r() - 0.5) * (1.0 + 1.4 * (1 - clump)) * Math.sqrt(k);
          if (out.every(p => (p.x - x) ** 2 + (p.z - z) ** 2 > minGap * minGap)) { out.push({ x, z, g }); break; }
        }
      }
    }
    return out;
  }
  // the crotch-hand hazard (studio cycle 1): after update(), report pairs where a hand or prop of person A projects
  // within `px` of person B's crotch point and sits in front of it. [{ a, b, dist }]
  // Only readable figures count (projected height >= minPx); the radius scales with the victim's size (frac of height).
  hazards(camera, W = 1080, H = 1920, frac = 0.05, minPx = 90) {
    camera.updateMatrixWorld();
    const pr = (p) => { const v = p.clone().project(camera); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H, v.z]; };
    const crotch = [], hands = [], hpx = this.viewH / H;
    for (let id = 0; id < this.n; id++) { const st = this.people[id], at = this.att[id]; if (!st.visible || !at || !at.hips) continue;
      const c = new THREE.Vector3(0, -0.1, 0.07).applyMatrix4(at.hips), px = this._px[id] / hpx;
      if (px >= minPx) crotch.push([id, pr(c), px]);
      for (const s of [1, -1]) hands.push([id, pr(this.gripPos(id, s))]); }
    const out = [];
    for (const [a, h] of hands) for (const [b, c, px] of crotch) { if (a === b) continue; const d = Math.hypot(h[0] - c[0], h[1] - c[1]); if (d < frac * px && h[2] < c[2]) out.push({ a, b, dist: +d.toFixed(1) }); }
    return out;
  }
  // the gesture measure (HUMAN cycle 2): every raised arm of every visible person, measured from the posed joints
  // (elbow interior angle, upper-arm elevation, the hand ahead of the head) and on screen (forearm off vertical, fist
  // size in px). [{ id, side, name, interior, elev, faDev, ahead, fistPx, hand:[x,y], elbow:[x,y], px, flags[] }]
  gestures(camera, W = 1080, H = 1920) {
    camera.updateMatrixWorld();
    const f = H / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov || 50) / 2)), inv = camera.matrixWorldInverse, v = new THREE.Vector3();
    const P3 = p => Array.isArray(p) ? v.set(p[0], p[1], p[2]) : v.copy(p);
    const proj = p => { P3(p).project(camera); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H]; };
    const ppm = p => f / Math.max(0.05, -P3(p).applyMatrix4(inv).z);
    const out = [];
    for (let id = 0; id < this.n; id++) { const st = this.people[id], at = this.att[id]; if (!st.visible || !at || !at.arm) continue;
      for (let k = 0; k < 2; k++) { const a = at.arm[k]; if (a.W.y <= a.S.y + 0.02) continue;
        v.copy(a.W).applyMatrix4(inv); if (v.z > -0.05) continue;
        const hp = proj(a.W); if (hp[0] < -20 || hp[0] > W + 20 || hp[1] < -20 || hp[1] > H + 20) continue;
        const m = measureArm({ S: a.S, E: a.E, Wr: a.W, head: at.headP, fwd: at.fwd, prop: !!(a.g && GESTURES[a.g.name]?.prop) || !!st.propArm?.[k] || st.act === 'work' }, proj, ppm, 0.1 * a.fs * st.d.h / 1.78);
        const px = Math.round(this._px[id] * H / this.viewH);
        if (m && px < 30) m.flags = m.flags.filter(f => f !== 'FIST_UNREADABLE');     // a figure under 30 px is a speck: no gesture reads either way
        if (m) out.push({ id, side: k ? -1 : 1, name: a.g ? a.g.name : st.act, px, ...m });
      } }
    return out;
  }
  // re-seed the people whose hands land on another's crotch (hazards()) until there are none: jitter the hand owner's
  // x/z and heading, up to `tries` rounds. Returns { rounds, left } (left = pairs still flagged).
  fixHazards(camera, W = 1080, H = 1920, { tries = 20, jitter = 0.45, seed = 3, frac, minPx } = {}) {
    const r = mulberry(seed); let hz = [], k = 0;
    for (; k <= tries; k++) {
      this.update(camera); hz = this.hazards(camera, W, H, frac, minPx); if (!hz.length) break;
      const movers = new Set(hz.map(h => h.a));
      for (const id of movers) { const st = this.people[id]; st.x += (r() - 0.5) * 2 * jitter; st.z += (r() - 0.5) * 2 * jitter; st.heading += (r() - 0.5) * 0.4; }
    }
    return { rounds: k, left: hz.length, pairs: hz };
  }
  add(o = {}) {
    if (this.n >= this.max) throw new Error('People: max reached');
    const id = this.n++, d = { trade: 'farm', seed: id + 1, fem: 0, age: 0.3, h: 1.78, heavy: 0.3, skin: '#b98160', hair: '#2a1c12', top: '#8a1c1c', bottom: '#2c3e5e',
      hatColor: '#8a1c1c', accent: '#e8e0c8', hat: true, hairStyle: 1, beard: false, stubble: false, gloves: false, prop: false, dirt: 0.2, ...o };
    const st = { d, x: 0, y: 0, z: 0, heading: 0, act: 'stand', ph: 0, t: 0, amt: 1, pump: null, look: 0, lift: 0, visible: true, mix: null, speed: 1 };
    if (d.body) People._bodyScales(st);
    this.people.push(st); this.palette(id);
    return id;
  }
  // re-derive the per-person palette after changing st.d (colours, hat, hair style, beard, gloves, prop, build)
  palette(id) {
    const { d } = this.people[id], o = id * PALW, c = new THREE.Color();
    const put = (k, hex, a) => { c.set(hex); this.pal.set([c.r, c.g, c.b, a], o + k * 4); };
    const flags = (d.hat ? 1 : 0) | ((d.hairStyle & 3) << 1) | (d.beard ? 8 : 0) | (d.gloves ? 16 : 0) | (d.prop ? 32 : 0) | (d.stubble ? 64 : 0)
      | (d.noVest || d.coverall ? 128 : 0) | (d.coverall ? 256 : 0) | (d.c6 ? 512 : 0) | (d.bands ? 1024 : 0) | (d.backs ? 2048 : 0);     // HUMAN c6; c7: d.backs
    this.pal[o + 27] = d.c6 ? (d.wear ?? 0.4) : 0;
    put(0, d.skin, d.heavy); put(1, d.top, d.fem); put(2, d.bottom, flags); put(3, d.hatColor, d.age); put(4, d.hair, (d.seed * 0.618) % 1); put(5, d.accent, d.dirt);
  }
  set(id, s) { Object.assign(this.people[id], s); }
  get(id) { return this.people[id]; }
  _pose(st, out) {
    const d = st.d, seed = (d.seed * 0.618) % 1;
    const one = (act, Pz) => {
      const pump = st.pump == null ? Math.pow(Math.max(0, Math.sin(st.t * 5.0 + seed * 6)), 2) : st.pump;
      if (act === 'walk') poseWalk(Pz, st.ph, st.amt, st.speed, d.age);
      else if (act === 'work') poseWork(Pz, st.ph, seed);
      else if (act === 'fist') poseFist(Pz, st.t, pump, seed, st.both);
      else if (act === 'march') poseMarch(Pz, st.ph, pump, st.amt);
      else if (act === 'clip' && st.clip) this._clipPose(st, Pz);
      else poseStand(Pz, st.t, seed, d.age);
    };
    if (st.mix) { out.fill(0); let tw = 0; for (const k in st.mix) { const w = st.mix[k]; if (w <= 0) continue; one(k, this._Q); for (let i = 0; i < PW; i++) out[i] += this._Q[i] * w; tw += w; } if (tw > 0) for (let i = 0; i < PW; i++) out[i] /= tw; }
    else one(st.act, out);
    out[B.head * 3 + 1] += st.look || 0;
    if (st.pose) st.pose(out, st, POSE_API);        // a scene's own pose on top of the act (a clasp, a pole, a rope)
    for (const s of [1, -1]) { const A = ARM(s); out[A[4] * 3 + 2] = out[A[3] * 3 + 2] * 1.15; out[A[4] * 3] = out[A[3] * 3]; }
  }
  // a bvh.js clip sample -> Euler XYZ per bone (+ the hip offset); relaxed fingers
  _clipPose(st, Pz) {
    const smp = st.clip.sample(st.ct ?? st.t, { loop: !!st.loop, twos: !!st.twos }, st._smp);
    st._smp = smp; Pz.fill(0);
    const e = this._e;
    for (let b = 0; b < NB; b++) { e.setFromQuaternion(smp.q[b], 'XYZ'); Pz[b * 3] = e.x; Pz[b * 3 + 1] = e.y; Pz[b * 3 + 2] = e.z; }
    for (const s of [1, -1]) { const A = ARM(s); Pz[A[3] * 3 + 2] = -s * (st.curl ?? 0.45); }
    Pz[NB * 3 + 1] = smp.root.y - JOINT[0][1];
  }
  update(camera) {
    const cam = this._cam; camera.getWorldPosition(cam); this._auditCam = camera;
    const fpx = this.viewH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov || 50) / 2));
    const groups = [];
    for (const t of TRADES) { for (const G of this.groups[t]) { G.g.instanceCount = 0; groups.push(G); } if (this.proxies[t]) { this.proxies[t].g.instanceCount = 0; groups.push(this.proxies[t]); } }
    const PM = this.person && this.person.state === 'person' ? this.person : null;
    if (PM) for (const Gs of [...PM.groups, PM.proxies]) for (const G of Gs) if (G) { G.g.instanceCount = 0; groups.push(G); }
    this.stats.drawn = [0, 0, 0];
    const W = this._w, Pz = this._P, m = this._m, e = this._e, q = this._q, v = this._v, one = this._s, D = this.data, PA = this.pal;
    const push = (G, id) => { const k = G.g.instanceCount++; G.rows[k] = id; for (let a = 0; a < PAL_ATTR.length; a++) G.pal[a].array.set(PA.subarray(id * PALW + a * 4, id * PALW + a * 4 + 4), k * 4); };
    // LOD by projected height, nearest first, within the per-LOD budgets
    const ord = this._ord; ord.length = 0;
    for (let id = 0; id < this.n; id++) { const st = this.people[id]; if (!st.visible) continue;
      this._px[id] = st.d.h * fpx / Math.max(0.1, Math.hypot(st.x - cam.x, st.y + 1 - cam.y, st.z - cam.z)); ord.push(id); }
    ord.sort((a, b) => (this.people[a].shadowOnly ? 1 : 0) - (this.people[b].shadowOnly ? 1 : 0) || this._px[b] - this._px[a]);
    let n0 = 0, n1 = 0;
    for (const id of ord) {
      const st = this.people[id], d = st.d, px = this._px[id];
      const pm = PM ? this._castOf(st) : null, sc = pm ? d.h / pm.H0 : d.h / (st._H0 || 1.78), SC = pm ? null : st._SC, JT = pm ? pm.J : JOINT, FP = pm ? pm.FP : FOOTPTS;
      st._pmOn = pm;
      let lod = st.shadowOnly ? 2 : px > this.lodPx[0] ? 0 : px > this.lodPx[1] ? 1 : 2;
      if (lod === 0 && n0 >= this.budget[0]) lod = 1;
      if (lod === 1 && n1 >= this.budget[1]) lod = 2;
      if (lod === 0) n0++; else if (lod === 1) n1++;
      this.stats.drawn[lod]++;
      let rdt = 0;
      if (st.rig) { this.rigger.setBody(pm ? pm.rigSC : SC); const rt = st.rig.time ?? st.t ?? 0, last = st.rig._tLast; st.rig._tLast = rt; rdt = last == null ? 1 / 30 : rt - last; this.rigger.prepare(st, rdt); }
      this._pose(st, Pz);
      if (d.c6) { const o4 = id * PALW + 24; PA[o4] = Math.min(1.6, Math.abs(Pz[6 * 3]) * 0.5 + Math.abs(Pz[10 * 3]) * 0.5); PA[o4 + 1] = Math.min(1.6, Math.abs(Pz[14 * 3])); PA[o4 + 2] = Math.min(1.6, Math.abs(Pz[17 * 3])); }
      if (pm) { PA[id * PALW + 3] = OUTFIT[d.trade] ?? 0; push(PM.groups[pm.i][lod], id); if (lod > 0 && PM.proxies[pm.i]) push(PM.proxies[pm.i], id); }   // the trade -> iSkin.a
      else { push(this.groups[d.trade][lod], id); if (lod > 0 && this.proxies[d.trade]) push(this.proxies[d.trade], id); }
      const gl = this._gestList(st); st._gl = gl;
      this._pos.set(st.x, st.y, st.z);
      if (st.act === 'clip' && st.rootMotion && st._smp) { const r = st._smp.root, c = Math.cos(st.heading), sn = Math.sin(st.heading); this._pos.x += (r.x * c + r.z * sn) * sc; this._pos.z += (-r.x * sn + r.z * c) * sc; }
      if (st.rig) this.rigger.solve(st, Pz, this._pos, st.heading, sc, rdt, [this._fistScale(st, 1, px), this._fistScale(st, -1, px)]);
      q.setFromAxisAngle(UP, st.heading); one.set(sc, sc, sc); this._inst.compose(this._pos, q, one);
      for (let b = 0; b < NB; b++) {
        const p = PARENT[b], J = JT[b], Jp = p < 0 ? ZERO3 : JT[p];
        v.set(J[0] - Jp[0], J[1] - Jp[1], J[2] - Jp[2]);
        if (SC && p >= 0) { v.x *= SC[p * 3]; v.y *= SC[p * 3 + 1]; v.z *= SC[p * 3 + 2]; }
        if (b === 0) { v.x += Pz[NB * 3]; v.y += Pz[NB * 3 + 1]; v.z += Pz[NB * 3 + 2]; }
        if ((b === 5 || b === 9) && gl) { const s = b === 5 ? 1 : -1, g = gl.find(x => x.side === s || x.side === 2); if (g) this._armIK(g, s, W[2], Pz, st); }
        if (b === 5 || b === 9) {        // scapular lift: a raised arm takes the shoulder up and in with it (no hinge at the armpit)
          e.set(Pz[b * 3], Pz[b * 3 + 1], Pz[b * 3 + 2], 'XYZ'); q.setFromEuler(e); this._v2.set(0, -1, 0).applyQuaternion(q);
          const lift = sstep(-0.2, 0.9, this._v2.y); v.y += 0.045 * lift; v.x -= Math.sign(J[0]) * 0.018 * lift; v.z -= 0.006 * lift; }
        e.set(Pz[b * 3], Pz[b * 3 + 1], Pz[b * 3 + 2], 'XYZ'); q.setFromEuler(e);
        const fs = (b === 7 || b === 11) ? this._fistScale(st, b === 7 ? 1 : -1, px) : 1; one.set(fs, fs, fs); m.compose(v, q, one);
        W[b].multiplyMatrices(p < 0 ? this._inst : W[p], m);
      }
      // plant the feet: the lowest heel/toe touches the ground
      let low = Infinity;
      for (const f of [15, 18]) for (const pt of FP) { v.set(pt[0], pt[1], pt[2]).applyMatrix4(W[f]); low = Math.min(low, v.y); }
      const dy = st.plant === false ? st.y + (st.lift || 0) : st.y + (st.lift || 0) - low;
      const o = id * TEXW * 4;
      for (let b = 0; b < NB; b++) {
        let E = W[b].elements; const J = JT[b], k = o + b * 12;
        E[13] += dy;
        if (SC) { const T = this._Es || (this._Es = new Float32Array(16)); T.set(E); for (let c = 0; c < 3; c++) { const f = SC[b * 3 + c]; T[c * 4] *= f; T[c * 4 + 1] *= f; T[c * 4 + 2] *= f; } E = T; }
        // skin = world * T(-bind joint), stored as rows
        D[k] = E[0]; D[k + 1] = E[4]; D[k + 2] = E[8]; D[k + 3] = E[12] - (E[0] * J[0] + E[4] * J[1] + E[8] * J[2]);
        D[k + 4] = E[1]; D[k + 5] = E[5]; D[k + 6] = E[9]; D[k + 7] = E[13] - (E[1] * J[0] + E[5] * J[1] + E[9] * J[2]);
        D[k + 8] = E[2]; D[k + 9] = E[6]; D[k + 10] = E[10]; D[k + 11] = E[14] - (E[2] * J[0] + E[6] * J[1] + E[10] * J[2]);
      }
      // attachment frames for props (world space, after the feet are planted): head, left grip, right grip
      const at = this.att[id] || (this.att[id] = { head: new THREE.Matrix4(), grip: [new THREE.Matrix4(), new THREE.Matrix4()], hips: new THREE.Matrix4(), lod: 0 });
      at.head.copy(W[4]); if (pm && pm.headOff) at.head.multiply(this._m2.makeTranslation(pm.headOff[0], pm.headOff[1], pm.headOff[2]));   // a person's head frame: People's eyes on this face
      at.grip[0].copy(W[8]); at.grip[1].copy(W[12]); (at.hips ||= new THREE.Matrix4()).copy(W[0]); at.lod = lod;
      // joints for the gesture measure: shoulder, elbow, wrist per arm (0 = left, 1 = right), the head's centre, facing
      if (!at.arm) { at.arm = [0, 1].map(() => ({ S: new THREE.Vector3(), E: new THREE.Vector3(), W: new THREE.Vector3(), g: null, fs: 1 })); at.headP = new THREE.Vector3(); at.fwd = new THREE.Vector3(); }
      for (let k = 0; k < 2; k++) { const A = k ? [9, 10, 11] : [5, 6, 7], a = at.arm[k], s = k ? -1 : 1;
        a.S.setFromMatrixPosition(W[A[0]]); a.E.setFromMatrixPosition(W[A[1]]); a.W.setFromMatrixPosition(W[A[2]]);
        a.g = gl ? gl.find(x => x.side === s || x.side === 2) || null : null; a.fs = this._fistScale(st, s, px); }
      at.headP.set(0, 0.065, 0.02).applyMatrix4(W[4]);
      { const E = W[0].elements; at.fwd.set(E[8], 0, E[10]); if (at.fwd.lengthSq() < 1e-6) at.fwd.set(Math.sin(st.heading), 0, Math.cos(st.heading)); at.fwd.normalize(); }
    }
    for (const G of groups) { G.attr.needsUpdate = true; for (const a of G.pal) a.needsUpdate = true; G.m.visible = !G.m.userData.proxy && G.g.instanceCount > 0; }
    this.tex.needsUpdate = true;
  }
  // the arm gestures this person holds this frame: st.gesture (one or a list), else the PUMP for acts fist / march
  _gestList(st) {
    let g = st.gesture;
    if (!g && !st.legacyFist && !st.pose) {        // a scene's own st.pose hook keeps its arms (the audit still measures them)
      const w = st.mix ? (() => { let a = 0, t = 0; for (const k in st.mix) { t += Math.max(0, st.mix[k]); if (k === 'fist' || k === 'march') a += Math.max(0, st.mix[k]); } return t > 0 ? a / t : 0; })() : (st.act === 'fist' || st.act === 'march') ? 1 : 0;
      if (w > 0) { const seed = (st.d.seed * 0.618) % 1, pump = st.pump == null ? Math.pow(Math.max(0, Math.sin(st.t * 5.0 + seed * 6)), 2) : st.pump;
        g = { name: 'PUMP', side: st.both ? 2 : -1, p: pump, w }; }
    }
    if (!g) return null;
    return Array.isArray(g) ? g : [g];
  }
  _fistScale(st, s, px) {
    if (st.fistScale != null) return st.fistScale;
    const gl = st._gl, g = gl && gl.find(x => x.side === s || x.side === 2); if (!g) return 1;
    const G = GESTURES[g.name]; if (!G) return 1;
    return G.prop ? 1.12 : G.fist ? (px > this.lodPx[0] ? 1.3 : 1.6) : 1;
  }
  // two-bone IK of one arm onto a gesture: the upper arm and forearm local rotations in the chest's frame (Wc), from
  // body-frame directions (gesture.js), blended with the act's own arm by g.w; the hand closes to a fist or a grip
  _armIK(g, s, Wc, Pz, st) {
    const A = ARM(s), [ua, fa, hn, fg] = A, J = st._pmOn ? st._pmOn.J : JOINT, qc = this._qc, qh = this._qh, sc3 = this._s3, t3 = this._t3;
    Wc.decompose(t3, qc, sc3); qh.setFromAxisAngle(UP, st.heading);
    let dirs;
    if (GESTURES[g.name]?.target) {       // the shoulder in the (unscaled) body frame, for target-mode gestures
      const sh = this._v2.set(J[ua][0] - J[2][0], J[ua][1] - J[2][1] + 0.03, J[ua][2] - J[2][2]).applyMatrix4(Wc).applyMatrix4(this._m2.copy(this._inst).invert());
      dirs = gestureSolve(g.name, s, { p: g.p ?? 0.5, shoulder: [sh.x, sh.y, sh.z] });
    } else dirs = gestureSolve(g.name, s, { p: g.p ?? 0.5 });
    if (!dirs) return;
    const qi = qc.clone().invert().multiply(qh);
    const u = new THREE.Vector3(...dirs.u).applyQuaternion(qi), f = new THREE.Vector3(...dirs.f).applyQuaternion(qi);
    const R = REST_ARM[s > 0 ? 0 : 1];
    let fb = f.clone().addScaledVector(u, -f.dot(u));
    if (fb.lengthSq() < 1e-4) fb = new THREE.Vector3(0, 0, 1).applyQuaternion(qi).addScaledVector(u, -new THREE.Vector3(0, 0, 1).applyQuaternion(qi).dot(u));
    fb.normalize();
    const M1 = this._m2.makeBasis(u, fb, new THREE.Vector3().crossVectors(u, fb)), q1 = new THREE.Quaternion().setFromRotationMatrix(M1);
    const qU = q1.multiply(R.q0inv);
    const qF = new THREE.Quaternion().setFromUnitVectors(R.d1, f.clone().applyQuaternion(qU.clone().invert()).normalize());
    const w = g.w ?? 1, e = this._e;
    const put = (b, qT) => { if (w < 1) { e.set(Pz[b * 3], Pz[b * 3 + 1], Pz[b * 3 + 2], 'XYZ'); qT = new THREE.Quaternion().setFromEuler(e).slerp(qT, w); } e.setFromQuaternion(qT, 'XYZ'); Pz[b * 3] = e.x; Pz[b * 3 + 1] = e.y; Pz[b * 3 + 2] = e.z; };
    put(ua, qU); put(fa, qF);
    const G = GESTURES[g.name];
    if (G.fist || G.prop) { Pz[hn * 3] = 0.1 * w + Pz[hn * 3] * (1 - w); Pz[hn * 3 + 1] = (G.fist ? s * (st.fistTwist ?? FIST_TWIST) : 0) * w + Pz[hn * 3 + 1] * (1 - w); Pz[hn * 3 + 2] *= 1 - w;
      const c = -s * (G.fist ? 1.75 : 1.45); Pz[fg * 3 + 2] = c * w + Pz[fg * 3 + 2] * (1 - w); Pz[A[4] * 3 + 2] = Pz[fg * 3 + 2] * 1.15; Pz[A[4] * 3] = Pz[fg * 3]; }
  }
  dispose() { for (const m of this.meshes) { m.parent?.remove(m); m.geometry.dispose(); } this.tex.dispose(); }
  // ---------------- PRODUCTION (round 7): the crowd IS the current person (below: personWanted, loadCrowd, makePersonMaterials)
  _personStart() {
    personGate();
    const P0 = this.person = { state: 'loading', groups: [], proxies: [], members: null, error: null, ms: null }, t0 = (PGL.performance || Date).now();
    const job = loadCrowd().then(C => {
      P0.members = C.members;
      for (const m of C.members) {
        P0.groups[m.i] = m.lods.map((g0, lod) => { const { mat, depth } = makePersonMaterials(lod, this.tex, m.hc), G = this._mkGroup(g0, mat, depth);
          G.m.castShadow = this._shadowMode === 'full' || (this._shadowMode === 'proxy' && lod === 0); G.m.userData.person = m.name; G.m.userData.lod = lod; return G; });
        if (this._shadowMode === 'proxy') { const L2 = P0.groups[m.i][2], P2 = this._mkGroup(L2.g, L2.m.material, L2.m.customDepthMaterial); P2.m.castShadow = true; P2.m.receiveShadow = false; P2.m.userData.proxy = true; P0.proxies[m.i] = P2; }
      }
      try { P0.adopted = this._adopt(P0); }       // what the scene did to People's figures before the person arrived (layers, flags, material hooks)
      catch (e) { P0.adopted = { error: String((e && e.stack) || e).slice(0, 400) }; try { console.warn('[person] the scene\'s setup of People\'s figures did not carry to the crowd: ' + P0.adopted.error.split('\n')[0]); } catch (e2) { /* no console */ } }
      P0.state = 'person'; P0.ms = Math.round((PGL.performance || Date).now() - t0);
      try { console.log(`[person] crowd: ${C.members.length} people of the current person system (bake ${C.fp || '?'}, ${C.made || '?'}), ${C.members.map(m => m.lods.map(g => g.userData.tris).join('/')).join(' ')} tris (${P0.ms} ms); the scene's setup carried: ${JSON.stringify(P0.adopted)}`); } catch (e) { /* no console */ }
    }).catch(e => { P0.state = 'off'; P0.error = String((e && e.stack) || e).slice(0, 600); try { console.warn('[person] the crowd stays People\'s own: ' + P0.error.split('\n')[0]); } catch (e2) { /* no console */ } });
    PEND.add(job); job.then(() => PEND.delete(job)); P0.ready = job;
    return job;
  }
  _personMats(fn) { for (const Gs of this.person.groups) if (Gs) Gs.forEach((G, lod) => fn(G.m.material, 'person', lod)); }
  // (PRODUCTION, iteration 5) THE SCENE'S LOOK REACHES THE PERSON. A scene sets up People's figures on the lines after `new People(...)`, before
  // the crowd of persons has loaded: it puts the meshes on layers (giant, giant_c5, closer_c1_giant: the atmosphere's mask), marks them
  // (userData.subject), turns shadows on, or wraps their materials' onBeforeCompile (commonwealth3's silhouette plate, flesh.js patchPeople,
  // engrave.js engravePeople, atmos3d patchMaterial through eachMaterial). People's own meshes are therefore the scene's STAND-INS: their
  // state at construction is recorded (_snapStandIns) and, when the persons arrive, every person mesh takes what the scene changed on the
  // stand-in of its LOD (the layers, the shadow flags, the render order, new userData keys, changed material properties and defines, and the
  // material hook chain: the person's material compiles through the scene's hooks with People's own base hook swapped for the person's,
  // so the scene's shader edits land on the person's shader); then the stand-ins leave the scene and folk.meshes (a later loop over
  // folk.meshes reaches the persons). A scene that REPLACED a stand-in's material keeps the person's own (said in the log).
  _snapStandIns() {
    const MP = ['toneMapped', 'transparent', 'opacity', 'depthWrite', 'depthTest', 'side', 'blending', 'colorWrite', 'fog', 'alphaTest', 'wireframe', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'visible', 'dithering'];
    const snap = G => { const m = G.m, mat = m.material; G.snap = { mask: m.layers.mask, cast: m.castShadow, recv: m.receiveShadow, ro: m.renderOrder, fc: m.frustumCulled, obr: m.onBeforeRender, ud: new Set(Object.keys(m.userData)),
      mat, obc: mat.onBeforeCompile, key: mat.customProgramCacheKey, mp: Object.fromEntries(MP.map(k => [k, mat[k]])), defs: { ...(mat.defines || {}) } }; };
    this._MP = MP; for (const t of TRADES) { this.groups[t].forEach(snap); if (this.proxies[t]) snap(this.proxies[t]); }
  }
  _adopt(P0) {
    const changed = G => { const s = G.snap, m = G.m; if (!s) return false; return m.layers.mask !== s.mask || m.castShadow !== s.cast || m.receiveShadow !== s.recv || m.renderOrder !== s.ro || m.frustumCulled !== s.fc
      || m.onBeforeRender !== s.obr || Object.keys(m.userData).some(k => !s.ud.has(k)) || m.material !== s.mat || m.material.onBeforeCompile !== s.obc || m.material.customProgramCacheKey !== s.key
      || this._MP.some(k => m.material[k] !== s.mp[k]) || Object.keys(m.material.defines || {}).some(k => !(k in s.defs)); };
    const standIn = lod => { for (const t of TRADES) if (changed(this.groups[t][lod])) return this.groups[t][lod]; return this.groups[TRADES[0]][lod]; };
    const standInProxy = () => { for (const t of TRADES) if (this.proxies[t] && changed(this.proxies[t])) return this.proxies[t]; return this.proxies[TRADES[0]] || null; };
    const rep = { layers: 0, flags: 0, userData: 0, props: 0, hooks: 0, replaced: 0 }, done = new Set();      // a proxy shares its LOD2's material: one adoption per material
    const take = (src, dst, lod) => { const s = src.snap, a = src.m, b = dst.m; if (!s) return;
      if (a.layers.mask !== s.mask) { b.layers.mask = a.layers.mask; rep.layers++; }
      if (a.castShadow !== s.cast) { b.castShadow = a.castShadow; rep.flags++; } if (a.receiveShadow !== s.recv) { b.receiveShadow = a.receiveShadow; rep.flags++; }
      if (a.renderOrder !== s.ro) { b.renderOrder = a.renderOrder; rep.flags++; } if (a.frustumCulled !== s.fc) { b.frustumCulled = a.frustumCulled; rep.flags++; }
      if (a.onBeforeRender !== s.obr) { b.onBeforeRender = a.onBeforeRender; rep.flags++; }
      for (const k of Object.keys(a.userData)) if (!s.ud.has(k) && k !== 'person' && k !== 'lod') { b.userData[k] = a.userData[k]; rep.userData++; }
      if (a.material !== s.mat) { rep.replaced++; return; }
      const am = a.material, bm = b.material; if (done.has(bm)) return; done.add(bm);
      for (const k of this._MP) if (am[k] !== s.mp[k]) { bm[k] = am[k]; rep.props++; }
      for (const k of Object.keys(am.defines || {})) if (!(k in s.defs)) { (bm.defines ||= {})[k] = am.defines[k]; rep.props++; }
      if (am.onBeforeCompile !== s.obc || am.customProgramCacheKey !== s.key) {
        const chain = am.onBeforeCompile, base = bm.onBeforeCompile, akey = am.customProgramCacheKey.bind(am), bkey = bm.customProgramCacheKey.bind(bm);
        bm.onBeforeCompile = function (sh, r) { const prev = BASE_SWAP.fn; BASE_SWAP.fn = base; try { chain.call(am, sh, r); } finally { BASE_SWAP.fn = prev; } };
        bm.customProgramCacheKey = () => bkey() + '|' + akey(); bm.needsUpdate = true; rep.hooks++; } };
    for (const Gs of P0.groups) if (Gs) Gs.forEach((G, lod) => take(standIn(lod), G, lod));
    const sp = standInProxy(); if (sp) for (const G of P0.proxies) if (G) take(sp, G, 2);
    // the stand-ins leave the scene and folk.meshes (update() keeps zeroing their instances; ?person=0 never gets here)
    const standIns = new Set(); for (const t of TRADES) { this.groups[t].forEach(G => standIns.add(G.m)); if (this.proxies[t]) standIns.add(this.proxies[t].m); }
    for (const m of standIns) { if (m.parent) m.parent.remove(m); m.visible = false; }
    for (let i = this.meshes.length - 1; i >= 0; i--) if (standIns.has(this.meshes[i])) this.meshes.splice(i, 1);     // in place: a scene may hold the array
    if (rep.replaced) try { console.warn(`[person] the scene replaced People's figure material on ${rep.replaced} groups before the crowd arrived: the persons keep their own`); } catch (e) { /* no console */ }
    return rep;
  }
  // the scene's figure -> a person of the cast: same sex, nearest skin lightness (CIE L*), then age and build; spread over the two
  // nearest by the figure's seed (so a crowd of one description is not one face)
  _castOf(st) {
    const d = st.d, key = `${d.fem ? 1 : 0}|${d.skin}|${d.age}|${d.heavy}|${d.seed}`;
    if (st._pmKey === key && st._pm) return st._pm;
    const M = this.person.members, sex = d.fem ? 'f' : 'm', pool = M.some(m => m.sex === sex) ? M.filter(m => m.sex === sex) : M;
    const L = lstarOf(d.skin || '#b98160'), age = 20 + 45 * clamp(d.age ?? 0.3), bmi = 21.5 + 7 * clamp(d.heavy ?? 0.3);
    const sc = pool.map(m => ({ m, s: Math.abs(m.L - L) / 8 + Math.abs(m.age - age) / 18 + Math.abs((m.bmi || 23) - bmi) / 5 })).sort((a, b) => a.s - b.s);
    const k = Math.min(sc.length, 2), f = ((((d.seed ?? 1) * 0.6180339887) % 1) + 1) % 1;
    st._pmKey = key; st._pm = sc[Math.min(k - 1, Math.floor(f * k))].m; return st._pm;
  }
}
// ------------------------------------------------------------------ PRODUCTION (round 7, 8 Oct): the crowd IS the current person
// review/studio_human_c8/after/production/NOTES.md. With the switch on, a People loads the crowd bake of the current person system
// (assets/person/crowd/: labs/production/bake_crowd.mjs: each person the system builds, dressed, re-rigged onto these 21 bones at its
// own size and joints, three LODs) and draws every figure as a person of that cast (People._castOf): the same instancing, the same
// matrix texture, the scene's acts, gestures, clips and rig on the same bones; per member its own joint table (J), foot points (FP),
// stature (H0) and the hat's seat (hc). The scene's trade colours dress the person's top and bottom; the trade's hat and prop show
// where the scene asked for them. A bake that does not load leaves People's own figures (person.error). Frames wait for the load.
// ITERATION 5: People's own figures are the scene's STAND-INS until the persons arrive: what a scene does to them on its load lines (layers,
// shadow flags, userData, material hooks: atmosphere masks, silhouette plates, flesh.js, engrave.js, atmos3d) is adopted by the persons
// (People._adopt), and the stand-ins leave the scene and folk.meshes; the bake carries People's part codes (head, neck, arm, hand, fingers,
// torso, pelvis, leg, boot, hair, beard) and the person shader gives People's looks the person's own skin colour (pSkin) and bare hands.
// DEFAULT ON in a page (iteration 4, as hero.js since iteration 3): every scene's crowd is the current person system. `?person=0` on
// the page (or globalThis.ACP_PERSON = 0) draws People's own figures: the one A/B switch, for the gate's BEFORE; it goes with the
// deletion of People's own figure. Node tools opt in (ACP_PERSON=1), so headless tests of People's own geometry are unchanged.
const PGL = globalThis;
export function personWanted() {
  if (PGL.ACP_PERSON != null) return !!+PGL.ACP_PERSON;
  try { const q = PGL.location && PGL.location.search ? new URLSearchParams(PGL.location.search).get('person') : null; if (q != null) return q !== '0'; } catch (e) { /* no page */ }
  try { const v = PGL.process && PGL.process.env && PGL.process.env.ACP_PERSON; if (v != null) return v !== '0'; } catch (e) { /* no env */ }
  return typeof PGL.window !== 'undefined' && typeof PGL.document !== 'undefined';
}
// one page-wide set of pending person work (hero.js adds its grafts to the same set): a frame waits for all of it
const PEND = PGL.__acpPersonPending || (PGL.__acpPersonPending = new Set());
function personGate() {
  if (typeof window === 'undefined' || PGL.__personGate) return; PGL.__personGate = true;
  const wrap = f => (typeof f !== 'function' || f.__personGated) ? f : Object.assign(function (...a) { return PEND.size ? Promise.all([...PEND]).then(() => f.apply(this, a)) : f.apply(this, a); }, { __personGated: true });
  let rf = wrap(window.renderFrame);
  try { Object.defineProperty(window, 'renderFrame', { configurable: true, enumerable: true, get: () => rf, set: f => { rf = wrap(f); } }); } catch (e) { /* a scene's own accessor: frames do not wait */ }
}
const lstarOf = hex => { const c = new THREE.Color(hex), f = x => (x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116); if (!THREE.ColorManagement.enabled) c.convertSRGBToLinear();
  return 116 * f(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) - 16; };
let CROWD = null;
export function loadCrowd(base = new URL('../../assets/person/crowd/', import.meta.url).href) {
  return CROWD || (CROWD = (async () => {
    const r0 = await fetch(base + 'index.json'); if (!r0 || r0.ok === false) throw new Error('no crowd bake at ' + base);
    const I = await r0.json(); if (!I || !I.members || !I.members.length) throw new Error('an empty crowd bake at ' + base);
    const members = await Promise.all(I.members.map(async (m, i) => {
      const buf = await fetch(base + m.file).then(r => r.arrayBuffer());
      const lods = m.lods.map(L => { const n = L.verts, g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, L.pos, n * 3), 3));
        const N4 = new Int16Array(buf, L.nrm, n * 4), N3 = new Int16Array(n * 3); for (let k = 0; k < n; k++) { N3[k * 3] = N4[k * 4]; N3[k * 3 + 1] = N4[k * 4 + 1]; N3[k * 3 + 2] = N4[k * 4 + 2]; }
        g.setAttribute('normal', new THREE.BufferAttribute(N3, 3, true));
        g.setAttribute('aCol', new THREE.BufferAttribute(new Uint8Array(buf, L.col, n * 4), 4, true));
        const S8 = new Uint8Array(buf, L.sk, n * 4), SK = new Float32Array(n * 4); for (let k = 0; k < n * 4; k++) SK[k] = (k & 3) === 2 ? S8[k] / 255 : S8[k];
        g.setAttribute('aSkin', new THREE.BufferAttribute(SK, 4));
        g.setIndex(new THREE.BufferAttribute(L.idx32 ? new Uint32Array(buf, L.idx, L.tris * 3) : new Uint16Array(buf, L.idx, L.tris * 3), 1));
        g.userData.verts = n; g.userData.tris = L.tris; return g; });
      return { ...m, i, L: lstarOf(m.skin || '#b98160'), lods };
    }));
    return { members, made: I.made, fp: I.person && I.person.fingerprint };
  })());
}
const GLSL_PVERT = GLSL_COMMON + /* glsl */`
uniform highp sampler2D pplTex; uniform vec3 pplHC;
attribute float aRow; attribute vec4 aSkin; attribute vec4 aCol;
attribute vec4 iSkin; attribute vec4 iTop; attribute vec4 iBot; attribute vec4 iHat; attribute vec4 iHair; attribute vec4 iAcc; attribute vec4 iJnt;
varying vec4 pCol; flat varying float pReg;
vec4 pR0, pR1, pR2;
vec3 pplLinV(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
void pplSetupP(){
  int r = int(aRow + 0.5), c0 = int(aSkin.x + 0.5) * 3;
#if PPL_LOD >= 2
  pR0 = texelFetch(pplTex, ivec2(c0, r), 0); pR1 = texelFetch(pplTex, ivec2(c0 + 1, r), 0); pR2 = texelFetch(pplTex, ivec2(c0 + 2, r), 0);
  if (aSkin.z < 0.5) { int c1 = int(aSkin.y + 0.5) * 3; pR0 = texelFetch(pplTex, ivec2(c1, r), 0); pR1 = texelFetch(pplTex, ivec2(c1 + 1, r), 0); pR2 = texelFetch(pplTex, ivec2(c1 + 2, r), 0); }
#else
  int c1 = int(aSkin.y + 0.5) * 3; float w = aSkin.z;
  pR0 = texelFetch(pplTex, ivec2(c0, r), 0); pR1 = texelFetch(pplTex, ivec2(c0 + 1, r), 0); pR2 = texelFetch(pplTex, ivec2(c0 + 2, r), 0);
  if (w < 0.999) { pR0 = mix(texelFetch(pplTex, ivec2(c1, r), 0), pR0, w); pR1 = mix(texelFetch(pplTex, ivec2(c1 + 1, r), 0), pR1, w); pR2 = mix(texelFetch(pplTex, ivec2(c1 + 2, r), 0), pR2, w); }
#endif
  pSkin = iSkin; pTop = iTop; pBot = iBot; pHat = iHat; pHair = iHair; pAcc = iAcc; pJnt = iJnt;
  pPart = aSkin.w; pBind = position; pUv = vec2(0.0); pCol = aCol; pReg = aCol.a * 255.0;
  if (int(pReg + 0.5) == 0) pSkin = vec4(pplLinV(aCol.rgb), iSkin.a);       // the figure's skin colour is the person's own here (flesh.js compares against it)
  pBot.a = float(int(pBot.a + 0.5) & ~16);                                   // the person's hands are bare (People's gloves are not carried): read as skin
  int fl = int(pBot.a + 0.5);
  if ((fl & 1) != 0 && int(pPart + 0.5) == P_HAIR) {       // a hat on: the person's hair pressed under the crown (pplHC: this person's hat centre)
    float k = smoothstep(pplHC.y - 0.03, pplHC.y + 0.05, pBind.y); pBind = mix(pBind, pplHC + (pBind - pplHC) * vec3(0.94, 0.9, 0.94), k);
  }
}
vec3 pplXf(vec3 p){ vec4 q = vec4(p, 1.0); return vec3(dot(pR0, q), dot(pR1, q), dot(pR2, q)); }
vec3 pplXn(vec3 n){ return normalize(vec3(dot(pR0.xyz, n), dot(pR1.xyz, n), dot(pR2.xyz, n))); }
bool pplHiddenP(){       // the trades' hats / brims / props (parts 20 + 3 trade + k): only the figure's trade, only where asked
  int p = int(pPart + 0.5); if (p < 20) return false;
  int f = int(pBot.a + 0.5), q = p - 20, t = q / 3, k = q - t * 3;
  if (t != int(pSkin.a + 0.5)) return true;
  return k < 2 ? (f & 1) == 0 : (f & 32) == 0;
}
`;
const GLSL_PFRAG = GLSL_COMMON + /* glsl */`
varying vec4 pCol; flat varying float pReg;
vec3 pplLin(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
void pplShadeP(inout vec3 col, inout float rough){
  int r = int(pReg + 0.5), p = int(pPart + 0.5);
  col = pplLin(pCol.rgb); rough = 0.85;
  if (r == 0) rough = 0.6; else if (r == 7) rough = 0.45;                       // skin, lips
  else if (r == 1) col = pTop.rgb; else if (r == 2) col = pBot.rgb;            // the scene's trade colours dress the top and the bottom
  else if (r == 3) rough = 0.55; else if (r == 5) rough = 0.72; else if (r == 6) rough = 0.2;
  if (p >= 20) { int q = p - 20, t = q / 3, k = q - t * 3;
    if (k < 2) { col = pHat.rgb * (k == 1 ? 0.9 : 1.0); rough = t == 0 ? 0.3 : 0.8; } else { col = vec3(0.3, 0.22, 0.14); rough = 0.6; } }
  col *= mix(1.0, 0.85, pAcc.a * 0.4);                                           // work dirt
}
`;
function makePersonMaterials(lod, tex, hc) {
  const HC = { value: new THREE.Vector3(hc[0], hc[1], hc[2]) }, defines = { PPL_LOD: lod };
  const VX = 'vec3 transformed = pplHiddenP() ? vec3(pR0.w, pR1.w, pR2.w) : pplXf(pBind);';
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.defines = defines;
  mat.onBeforeCompile = sh => {
    sh.uniforms.pplTex = { value: tex }; sh.uniforms.pplWet = WET; sh.uniforms.pplHC = HC;
    sh.vertexShader = GLSL_PVERT + sh.vertexShader
      .replace('#include <beginnormal_vertex>', 'pplSetupP(); vec3 objectNormal = pplXn(normal);')
      .replace('#include <begin_vertex>', VX);
    sh.fragmentShader = GLSL_PFRAG + sh.fragmentShader
      .replace('#include <color_fragment>', 'float pRough = 0.85; pplShadeP(diffuseColor.rgb, pRough);\n diffuseColor.rgb *= 1.0 - 0.3 * pplWet * step(0.7, pRough); pRough = pRough >= 0.7 ? max(0.78, mix(pRough, pRough * 0.9, pplWet)) : mix(pRough, pRough * 0.8, pplWet);')
      .replace('#include <common>', '#include <common>\nuniform float pplWet;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = pRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;');
  };
  mat.customProgramCacheKey = () => `ppl-person-${lod}`;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.defines = defines;
  depth.onBeforeCompile = sh => {
    sh.uniforms.pplTex = { value: tex }; sh.uniforms.pplHC = HC;
    sh.vertexShader = GLSL_PVERT + sh.vertexShader.replace('#include <begin_vertex>', 'pplSetupP(); ' + VX);
  };
  depth.customProgramCacheKey = () => `ppl-person-depth-${lod}`;
  return { mat, depth };
}
// the raised fist turns its palm toward the front (seen front-on the fist reads as a fist; seen from the thumb side it
// reads as a cup)
export let FIST_TWIST = 1.2;
export function setFistTwist(v) { FIST_TWIST = v; }
const ZERO3 = [0, 0, 0], FOOTPTS = [[0, -0.083, -0.07], [0, -0.083, 0.19]];
// the arm's bind frame for the IK: upper-arm direction d0, its bend-forward axis f0 (the elbow flexes toward +z), the
// forearm's bind direction d1
const REST_ARM = [1, -1].map(s => { const [ua, fa, hn] = ARM(s), J = JOINT;
  const d0 = new THREE.Vector3(J[fa][0] - J[ua][0], J[fa][1] - J[ua][1], J[fa][2] - J[ua][2]).normalize();
  const f0 = new THREE.Vector3(0, 0, 1).addScaledVector(d0, -d0.z).normalize();
  const q0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(d0, f0, new THREE.Vector3().crossVectors(d0, f0)));
  return { d0, f0, q0inv: q0.invert(), d1: new THREE.Vector3(J[hn][0] - J[fa][0], J[hn][1] - J[fa][1], J[hn][2] - J[fa][2]).normalize() }; });
export { JOINT as PEOPLE_JOINTS };
export { PeopleRig };
export const PEOPLE_SKEL = { NB, PARENT, JOINT, ARM, LEG, FOOTPTS };
