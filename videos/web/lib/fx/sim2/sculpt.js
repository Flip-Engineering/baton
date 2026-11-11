// SCULPT (sim2): SDF-sculpted heads and busts for close-ups, meshed once, shaded as skin, bronze or silhouette.
//
//   import { Head, bakeHead, HEADS } from '../lib/fx/sim2/sculpt.js';
//   const head = await Head.create(scene, { ...HEADS.ironworker, look: 'skin' });     // or look: 'bronze' | 'shadow'
//   head.group.position.set(0, 1.6, 0); head.group.rotation.y = 0.6;                   // a THREE.Group (head + hat + bust)
//   head.light({ key: { dir, color }, rims: [{ dir, color }, ...], sky, ground, fog, fogD });
//   head.update(t);     // micro-motion only (breath, a blink); the sculpt itself is static
//
// Modelling: a head is an explicit anatomical SDF (JS): cranium, frontal bone, brow ridge, temples, zygomatic arches and
// cheekbones, maxilla, mandible (ramus, angle, body, mental protuberance), orbits, eyeballs with upper and lower lids,
// nose (bridge, dorsum, tip, alae, nostrils, columella), lips with a mouth line and nasolabial folds, ears (helix,
// concha), neck (sternocleidomastoids, larynx), trapezius and a work-jacket collar; a hard hat, a cap, or cropped hair.
// Every landmark is a named parameter (HEADS.* are presets: ironworker, farmer, elder, young, woman), so one module
// makes many distinct faces. Proportions follow the classical canon (eye line at half height, 5 eye-widths across).
// Meshing: block-sparse naive surface nets on a ~2 mm grid, vertices Newton-projected onto the surface (p -= d grad d),
// normals from the SDF gradient. Per-vertex bakes from the SDF itself: ambient occlusion (5 taps along the normal),
// mean curvature (Laplacian), thickness (march inward to the far side: ears and nostrils are thin and glow when
// backlit), and a material id. bakeHead() is pure JS (no DOM): tools/bake_sim2.mjs writes the result to
// assets/bake/sim2/head_<name>.bin; Head.create() loads that file when it exists, else bakes live (~2-6 s).
// Shading (one draw per material group): pre-integrated-style skin (curvature-driven red-shifted terminator),
// transmission through thin tissue, two-lobe specular with oily zones, pore / stubble / wrinkle micro-normals from a
// baked detail texture (triplanar, 3 taps), wet eyes; plastic hard hat with scuffs; canvas duck jacket.
import * as THREE from 'three';

// ---------------------------------------------------------------- SDF primitives (JS)
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
function sdEll(px, py, pz, cx, cy, cz, rx, ry, rz) {     // iq's ellipsoid bound
  const x = px - cx, y = py - cy, z = pz - cz; const k0 = len3(x / rx, y / ry, z / rz), k1 = len3(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : k0 * (k0 - 1) / k1;
}
function sdSph(px, py, pz, cx, cy, cz, r) { return len3(px - cx, py - cy, pz - cz) - r; }
function sdCap(px, py, pz, a, b, r) {
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2], bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return len3(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}
function sdRCone(px, py, pz, a, b, r1, r2) {    // round cone between two spheres
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2], l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2], y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const xx = len3(pax * l2 - bax * y, pay * l2 - bay * y, paz * l2 - baz * y); const x2 = xx * xx, y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
const mirror = (x) => Math.abs(x);

// ---------------------------------------------------------------- parameters
// All in metres. s* = scale factors about the defaults. Every preset is an adult worker.
export const HEADS = {
  ironworker: { seed: 1, jaw: 1.18, chin: 1.12, brow: 1.3, nose: 1.15, noseBridge: 1.2, cheek: 1.08, lips: 0.95, ears: 0.95, neck: 1.25, age: 0.45, hat: 'hard', hatColor: '#d8d2c6', bust: 'jacket', clothColor: '#5a4632', hair: 'crop', beard: 'stubble', skin: '#b07a5a', gaunt: 0.3 },
  farmer: { seed: 2, jaw: 1.02, chin: 1.0, brow: 1.05, nose: 1.12, noseBridge: 1.0, cheek: 1.1, lips: 0.9, ears: 1.08, neck: 1.05, age: 0.7, hat: 'cap', hatColor: '#8a1c1c', bust: 'jacket', clothColor: '#3a4a5a', hair: 'crop', beard: 'stubble', skin: '#c08a66', gaunt: 0.55 },
  young: { seed: 3, jaw: 1.0, chin: 1.05, brow: 1.0, nose: 0.95, noseBridge: 0.95, cheek: 1.0, lips: 1.05, ears: 0.95, neck: 1.1, age: 0.1, hat: 'none', hatColor: '#222', bust: 'jacket', clothColor: '#2a2a2e', hair: 'crop', beard: 'none', skin: '#8a5a40', gaunt: 0.15 },
  elder: { seed: 4, jaw: 1.0, chin: 0.95, brow: 1.15, nose: 1.15, noseBridge: 1.15, cheek: 0.95, lips: 0.85, ears: 1.15, neck: 1.0, age: 1.0, hat: 'cap', hatColor: '#2a2a2a', bust: 'jacket', clothColor: '#4a3a2a', hair: 'crop', beard: 'stubble', hairColor: '#8a8680', skin: '#c89478', gaunt: 0.8 },
  woman: { seed: 5, jaw: 0.9, chin: 0.92, brow: 0.8, nose: 0.9, noseBridge: 0.9, cheek: 1.08, lips: 1.12, ears: 0.92, neck: 0.9, age: 0.3, hat: 'hard', hatColor: '#e8c020', bust: 'jacket', clothColor: '#e06a14', hair: 'bun', beard: 'none', skin: '#a8704e', gaunt: 0.2, fem: 1 },
};

// Region ids (material): 0 skin, 1 eye, 2 hat, 3 cloth, 4 hair
export function headSDF(P) {
  const J = P.jaw, Ch = P.chin, Br = P.brow, N = P.nose, Nb = P.noseBridge, Ck = P.cheek, L = P.lips, E = P.ears, Nk = P.neck, fem = P.fem || 0, G = P.gaunt || 0;
  const skin = (x, y, z) => {
    const ax = mirror(x);
    // cranium + frontal bone
    let d = sdEll(x, y, z, 0, 0.028, -0.014, 0.0715 - 0.003 * fem, 0.084, 0.095);
    d = smin(d, sdEll(x, y, z, 0, 0.043, 0.026, 0.064, 0.066, 0.07), 0.02);
    // brow ridge (glabella + supraorbital), and the lateral brow
    d = smin(d, sdCap(ax, y, z, [0, 0.029, 0.082 + 0.003 * Br], [0.036, 0.031, 0.081], 0.0078 * Br + 0.0025), 0.014);
    d = smin(d, sdCap(ax, y, z, [0.036, 0.031, 0.079], [0.059, 0.03, 0.061], 0.0075 * Br), 0.012);
    // temples: a shallow hollow
    d = smax(d, -sdSph(ax, y, z, 0.1 + 0.004 * (1 - G), 0.032, 0.035, 0.028), 0.02);
    // zygomatic: cheekbones + arches
    d = smin(d, sdEll(ax, y, z, 0.047, -0.003, 0.061, 0.02 * Ck, 0.013, 0.019), 0.018);
    d = smin(d, sdCap(ax, y, z, [0.048, -0.003, 0.055], [0.067, -0.001, 0.004], 0.0095 * Ck), 0.012);
    // maxilla / midface
    d = smin(d, sdEll(x, y, z, 0, -0.03, 0.066, 0.039, 0.036, 0.034), 0.02);
    // cheeks (soft tissue; hollowed by age / gauntness under the cheekbone)
    d = smin(d, sdEll(ax, y, z, 0.036, -0.036, 0.052, 0.03 - 0.005 * G, 0.032, 0.029 - 0.006 * G), 0.026);
    // mandible: ramus, angle, body; chin
    const gon = [0.053 * J, -0.047 * (0.9 + 0.1 * J), -0.004];
    d = smin(d, sdCap(ax, y, z, [0.057, 0.0, -0.012], gon, 0.011), 0.022);
    d = smin(d, sdCap(ax, y, z, gon, [0.022 * Ch, -0.09 - 0.004 * (Ch - 1), 0.071], 0.0138 + 0.003 * (J - 1)), 0.026);
    d = smin(d, sdEll(x, y, z, 0, -0.09 - 0.004 * (Ch - 1), 0.078 + 0.003 * (Ch - 1), 0.023 * Ch, 0.017, 0.016), 0.016);
    // orbits
    d = smax(d, -sdEll(ax, y, z, 0.032, 0.013, 0.093, 0.0175, 0.012, 0.012), 0.012);
    // lids: shells of the eyeball, cut above / below the aperture
    const lidU = Math.max(sdSph(ax, y, z, 0.032, 0.012, 0.075, 0.0136), -(y - (0.0156 + 0.06 * (ax - 0.032) + 25 * (ax - 0.032) * (ax - 0.032))));
    const lidL = Math.max(sdSph(ax, y, z, 0.032, 0.012, 0.075, 0.0133), (y - (0.0086 - 0.03 * (ax - 0.032) - 18 * (ax - 0.032) * (ax - 0.032))));
    d = smin(d, lidU, 0.0022); d = smin(d, lidL, 0.0022);
    // nose: dorsum, tip, alae, columella; nostrils
    d = smin(d, sdRCone(x, y, z, [0, 0.02, 0.089], [0, -0.022 * N, 0.115 + 0.008 * (N - 1)], 0.0064 * Nb, 0.0078), 0.01);
    d = smin(d, sdEll(x, y, z, 0, -0.026 * N, 0.1145 + 0.008 * (N - 1), 0.0095, 0.009, 0.009), 0.008);
    d = smin(d, sdEll(ax, y, z, 0.0122, -0.03 * N, 0.1015 + 0.004 * (N - 1), 0.0075, 0.0062, 0.0082), 0.008);
    d = smax(d, -sdEll(ax, y, z, 0.0068, -0.0355 * N, 0.1065 + 0.004 * (N - 1), 0.0038, 0.0022, 0.0048), 0.002);
    // lips, mouth line, philtrum, nasolabial folds
    d = smin(d, sdEll(ax, y, z, 0.0065, -0.0505, 0.0905, 0.0165 * L, 0.0052 * L, 0.0105), 0.009);
    d = smin(d, sdEll(x, y, z, 0, -0.0612, 0.0885, 0.0182 * L, 0.0058 * L, 0.0102), 0.009);
    d = smax(d, -sdEll(x, y, z, 0, -0.0556, 0.0985, 0.0232 * L, 0.0009, 0.012), 0.0018);
    d = smax(d, -sdCap(x, y, z, [0, -0.041, 0.104], [0, -0.046, 0.104], 0.0022), 0.003);
    d = smax(d, -sdCap(ax, y, z, [0.019, -0.032, 0.1], [0.028, -0.062, 0.088], 0.0022 + 0.002 * P.age), 0.006);
    // ears: helix shell with a concha
    {
      const ex = ax - 0.078, ey = y - 0.0, ez = z + 0.012, ca = Math.cos(0.18), sa = Math.sin(0.18); const ry = ey * ca - ez * sa, rz = ey * sa + ez * ca;
      let e = sdEll(ex, ry, rz, 0, 0, 0, 0.009, 0.031 * E, 0.0185 * E);
      e = smax(e, -sdEll(ex, ry, rz, 0.006, 0.001, 0.001, 0.0062, 0.023 * E, 0.012 * E), 0.003);
      e = smax(e, -sdSph(ex, ry, rz, 0.008, -0.006, 0.003, 0.0085), 0.003);
      d = smin(d, e, 0.006);
    }
    // neck: column, sternocleidomastoids, larynx; nape
    d = smin(d, sdRCone(x, y, z, [0, -0.05, -0.02], [0, -0.2, -0.012], 0.053 * Nk, 0.06 * Nk), 0.034);
    d = smin(d, sdCap(ax, y, z, [0.053, -0.035, -0.028], [0.014, -0.178, 0.045], 0.0135 * Nk), 0.02);
    d = smin(d, sdSph(x, y, z, 0, -0.112, 0.024 + 0.004 * Nk, 0.009 * (1 - 0.6 * fem)), 0.014);
    return d;
  };
  const eye = (x, y, z) => sdSph(mirror(x), y, z, 0.032, 0.012, 0.075, 0.0125);
  const hat = (x, y, z) => {
    if (P.hat === 'hard') {
      // shell sits on the crown: rim just above the brow at the front, over the occiput at the back
      const cy = 0.072, cz = -0.004;
      let s = sdEll(x, y, z, 0, cy, cz, 0.097, 0.093, 0.114);
      s = smin(s, sdEll(x, y, z, 0, cy + 0.003, cz, 0.018, 0.1, 0.123), 0.012);                          // centre crest
      for (const cx of [0.036, -0.036]) s = smin(s, sdEll(x - cx, y, z, 0, cy + 0.0005, cz, 0.013, 0.0975, 0.1205), 0.01);
      s = Math.max(s, -sdEll(x, y, z, 0, cy, cz, 0.09, 0.086, 0.107));
      const cut = 0.052 - 0.18 * Math.max(0, -z - 0.02) + 0.04 * Math.max(0, z - 0.06);
      s = Math.max(s, -(y - cut));
      // brim: a thin flared disc, peaked over the face
      const br = sdEll(x, y - (cut + 0.001) - 0.25 * Math.max(0, z - 0.1) * Math.max(0, z - 0.1) * 10, z, 0, 0, 0.012, 0.113, 0.007, 0.146);
      s = Math.min(s, Math.max(br, -sdEll(x, y, z, 0, cy, cz, 0.092, 0.2, 0.109)));
      return s;
    }
    if (P.hat === 'cap') {
      // six-panel work cap: crown over the cranium, a curved bill, a button, a sweatband line
      let s = sdEll(x, y, z, 0, 0.047, -0.008, 0.083, 0.089, 0.104);
      s = Math.max(s, -sdEll(x, y, z, 0, 0.047, -0.008, 0.078, 0.084, 0.099));
      s = Math.max(s, -(y - (0.04 - 0.35 * Math.max(0, -z - 0.03) + 0.1 * Math.max(0, z - 0.05))));
      const by = y - (0.046 - 0.35 * Math.max(0, z - 0.09) * Math.max(0, z - 0.09) * 10 + 0.02 * x * x * 40);
      const bill = sdEll(x, by, z, 0, 0, 0.1, 0.074, 0.0045, 0.072);
      s = Math.min(s, Math.max(bill, -(z - 0.085)));
      s = Math.min(s, sdSph(x, y, z, 0, 0.136, -0.008, 0.007));
      return s;
    }
    return 1;
  };
  const cloth = (x, y, z) => {
    const ax = mirror(x);
    if (P.bust === 'none') return 1;
    let d = sdEll(x, y, z, 0, -0.3, -0.025, 0.18, 0.1, 0.11);
    d = smin(d, sdCap(ax, y, z, [0.035, -0.19, -0.035], [0.165, -0.255, -0.03], 0.048), 0.05);
    d = smin(d, sdSph(ax, y, z, 0.17, -0.28, -0.03, 0.058), 0.04);
    // fabric folds at the armpit and chest (a few shallow grooves)
    for (const k of [0, 1, 2]) d = smax(d, -sdCap(ax, y, z, [0.07 + k * 0.03, -0.24 - k * 0.012, 0.09], [0.1 + k * 0.03, -0.33, 0.06], 0.004), 0.01);
    // collar: a raised band around the neck, open at the front
    const cr = Math.hypot(x, z + 0.012) - 0.066, cy = y + 0.182; let col = Math.hypot(cr, cy * 0.6) - 0.018;
    col = Math.max(col, -Math.max(0.028 - z, Math.abs(x) - 0.026));
    d = smin(d, col, 0.012);
    // shoulder yoke seam relief
    d = smax(d, -sdCap(ax, y, z, [0.05, -0.215, 0.04], [0.16, -0.255, 0.03], 0.0025), 0.004);
    return d;
  };
  const hair = (x, y, z) => {
    if (P.hair === 'none') return 1;
    // cropped hair: a thin shell over the cranium behind the hairline, above the ears
    let h = sdEll(x, y, z, 0, 0.03, -0.014, 0.0775, 0.0915, 0.1025);
    const lim = 0.022 - 1.0 * Math.max(0, -0.03 - z);                 // above the ears, down to the nape at the back
    h = Math.max(h, Math.max(lim - y, z - 0.045));
    if (P.hair === 'bun') h = Math.min(h, sdEll(x, y, z, 0, 0.02, -0.115, 0.03, 0.028, 0.026));
    // full beard: an offset of the jaw region
    if (P.beard === 'full') {
      let b = smin(sdCap(mirror(x), y, z, [0.057, -0.028, -0.004], [0.02, -0.09, 0.071], 0.02), sdEll(x, y, z, 0, -0.094, 0.079, 0.031, 0.027, 0.024), 0.02);
      b = Math.max(b, y + 0.03 - 0.25 * Math.max(0, 0.06 - Math.abs(x)) * 0);           // below the cheek line
      b = Math.max(b, -sdEll(x, y, z, 0, -0.056, 0.1, 0.021, 0.008, 0.03));             // the mouth stays open
      const mo = sdEll(x, y, z, 0, -0.0445, 0.1, 0.027, 0.0055, 0.011);                  // moustache
      h = Math.min(h, b, mo);
    }
    return h;
  };
  const all = (x, y, z) => Math.max(Math.min(skin(x, y, z), eye(x, y, z), hat(x, y, z), cloth(x, y, z), hair(x, y, z)), -(y + 0.34));
  const region = (x, y, z) => { const v = [skin(x, y, z), eye(x, y, z), hat(x, y, z), cloth(x, y, z), hair(x, y, z)]; let k = 0; for (let i = 1; i < 5; i++) if (v[i] < v[k]) k = i; return k; };
  return { all, region, skin };
}

// ---------------------------------------------------------------- mesher + bakes (pure JS)
export function bakeHead(P, { h = 0.0021, box = [[-0.23, -0.38, -0.16], [0.23, 0.18, 0.2]] } = {}) {
  const S = headSDF(P), f = S.all;
  const nx = Math.ceil((box[1][0] - box[0][0]) / h), ny = Math.ceil((box[1][1] - box[0][1]) / h), nz = Math.ceil((box[1][2] - box[0][2]) / h);
  const X = i => box[0][0] + i * h, Y = j => box[0][1] + j * h, Z = k => box[0][2] + k * h;
  // block-sparse sampling: 8^3 blocks whose centre is farther than their half-diagonal are skipped (sign from the centre)
  const BS = 8, bx = Math.ceil(nx / BS), by = Math.ceil(ny / BS), bz = Math.ceil(nz / BS);
  const grid = new Float32Array((nx + 1) * (ny + 1) * (nz + 1)).fill(NaN);
  const gi = (i, j, k) => (k * (ny + 1) + j) * (nx + 1) + i;
  const hd = Math.sqrt(3) * BS * h * 0.5 * 1.08;
  const active = new Uint8Array(bx * by * bz);
  for (let K = 0; K < bz; K++) for (let J = 0; J < by; J++) for (let I = 0; I < bx; I++) {
    const c = f(X((I + 0.5) * BS), Y((J + 0.5) * BS), Z((K + 0.5) * BS));
    if (Math.abs(c) > hd) continue; active[(K * by + J) * bx + I] = 1;
    for (let k = K * BS; k <= Math.min(nz, K * BS + BS); k++) for (let j = J * BS; j <= Math.min(ny, J * BS + BS); j++) for (let i = I * BS; i <= Math.min(nx, I * BS + BS); i++) {
      const q = gi(i, j, k); if (Number.isNaN(grid[q])) grid[q] = f(X(i), Y(j), Z(k));
    }
  }
  // surface nets: one vertex per cell with a sign change
  const vid = new Int32Array(nx * ny * nz).fill(-1), ci = (i, j, k) => (k * ny + j) * nx + i;
  const pos = [];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const v8 = new Float32Array(8);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let neg = 0, nan = false;
    for (let c = 0; c < 8; c++) { const v = grid[gi(i + CO[c][0], j + CO[c][1], k + CO[c][2])]; if (Number.isNaN(v)) { nan = true; break; } v8[c] = v; if (v < 0) neg++; }
    if (nan || neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) { const va = v8[a], vb = v8[b]; if ((va < 0) === (vb < 0)) continue; const t = va / (va - vb);
      sx += CO[a][0] + (CO[b][0] - CO[a][0]) * t; sy += CO[a][1] + (CO[b][1] - CO[a][1]) * t; sz += CO[a][2] + (CO[b][2] - CO[a][2]) * t; n++; }
    vid[ci(i, j, k)] = pos.length / 3; pos.push(X(i + sx / n), Y(j + sy / n), Z(k + sz / n));
  }
  const idx = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c); };
  for (let k = 1; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) {
    const v0 = grid[gi(i, j, k)]; if (Number.isNaN(v0)) continue;
    const vx = grid[gi(i + 1, j, k)], vy = grid[gi(i, j + 1, k)], vz = grid[gi(i, j, k + 1)];
    if (!Number.isNaN(vx) && (v0 < 0) !== (vx < 0)) quad(vid[ci(i, j - 1, k - 1)], vid[ci(i, j, k - 1)], vid[ci(i, j, k)], vid[ci(i, j - 1, k)], v0 < 0);
    if (!Number.isNaN(vy) && (v0 < 0) !== (vy < 0)) quad(vid[ci(i - 1, j, k - 1)], vid[ci(i - 1, j, k)], vid[ci(i, j, k)], vid[ci(i, j, k - 1)], v0 < 0);
    if (!Number.isNaN(vz) && (v0 < 0) !== (vz < 0)) quad(vid[ci(i - 1, j - 1, k)], vid[ci(i, j - 1, k)], vid[ci(i, j, k)], vid[ci(i - 1, j, k)], v0 < 0);
  }
  // Newton projection, normals, bakes
  const NV = pos.length / 3, P3 = new Float32Array(pos), NRM = new Float32Array(NV * 3), AUX = new Float32Array(NV * 4);   // ao, curvature, thickness, region
  const e = h * 0.5;
  const grad = (x, y, z, o) => { o[0] = f(x + e, y, z) - f(x - e, y, z); o[1] = f(x, y + e, z) - f(x, y - e, z); o[2] = f(x, y, z + e) - f(x, y, z - e); const l = len3(o[0], o[1], o[2]) || 1; o[0] /= l; o[1] /= l; o[2] /= l; return o; };
  const g = [0, 0, 0];
  for (let v = 0; v < NV; v++) {
    let x = P3[v * 3], y = P3[v * 3 + 1], z = P3[v * 3 + 2];
    for (let it = 0; it < 2; it++) { const d = f(x, y, z); grad(x, y, z, g); x -= d * g[0]; y -= d * g[1]; z -= d * g[2]; }
    P3[v * 3] = x; P3[v * 3 + 1] = y; P3[v * 3 + 2] = z; grad(x, y, z, g); NRM.set(g, v * 3);
    // AO: 5 taps along the normal
    let ao = 0; for (let s = 1; s <= 5; s++) { const dd = 0.0035 * s * s * 0.6; ao += (dd - f(x + g[0] * dd, y + g[1] * dd, z + g[2] * dd)) / dd / (s * 0.9); }
    AUX[v * 4] = Math.max(0, Math.min(1, 1 - ao * 0.55));
    // mean curvature ~ Laplacian of the distance field at the surface
    const c = 0.004; const lap = (f(x + c, y, z) + f(x - c, y, z) + f(x, y + c, z) + f(x, y - c, z) + f(x, y, z + c) + f(x, y, z - c)) / (c * c);
    AUX[v * 4 + 1] = lap * 0.5;
    // thickness: march inward until outside again
    let tk = 0.06; for (let s = 1; s <= 24; s++) { const dd = s * 0.0025; if (f(x - g[0] * dd, y - g[1] * dd, z - g[2] * dd) > 0) { tk = dd; break; } }
    AUX[v * 4 + 2] = tk;
    AUX[v * 4 + 3] = S.region(x - g[0] * 0.0006, y - g[1] * 0.0006, z - g[2] * 0.0006);
  }
  return { pos: P3, nrm: NRM, aux: AUX, idx: new Uint32Array(idx), params: P };
}
export function packHead(b) {
  const hdr = new Uint32Array([0x48454144, b.pos.length / 3, b.idx.length]);
  const out = new Uint8Array(12 + b.pos.byteLength + b.nrm.byteLength + b.aux.byteLength + b.idx.byteLength); let o = 0;
  for (const a of [hdr, b.pos, b.nrm, b.aux, b.idx]) { out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), o); o += a.byteLength; }
  return out;
}
export function unpackHead(buf) {
  const u = new Uint32Array(buf, 0, 3); if (u[0] !== 0x48454144) throw new Error('not a head bin'); const nv = u[1], ni = u[2]; let o = 12;
  const pos = new Float32Array(buf, o, nv * 3); o += nv * 12; const nrm = new Float32Array(buf, o, nv * 3); o += nv * 12; const aux = new Float32Array(buf, o, nv * 4); o += nv * 16;
  const idx = new Uint32Array(buf, o, ni); return { pos, nrm, aux, idx };
}

// ---------------------------------------------------------------- detail texture (pores, stubble, wrinkles, weave), baked once
let DETAIL = null;
function detailTex() {
  if (DETAIL) return DETAIL;
  const n = 512, d = new Uint8Array(n * n * 4); let s = 0x2545F491;
  const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const H = new Float32Array(n * n), T = new Float32Array(n * n), W = new Float32Array(n * n);
  // pores: small pits; stubble: dark dots, directional
  for (let k = 0; k < 9000; k++) { const x = r() * n, y = r() * n, rad = 0.8 + r() * 1.6, depth = 0.4 + r() * 0.6;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const px = (Math.floor(x) + dx + n) % n, py = (Math.floor(y) + dy + n) % n, q = ((px + 0.5 - x) ** 2 + (py + 0.5 - y) ** 2) / (rad * rad); if (q < 1) H[py * n + px] -= depth * (1 - q) ** 2; } }
  for (let k = 0; k < 16000; k++) { const x = r() * n, y = r() * n; for (let t = 0; t < 3; t++) { const px = (Math.floor(x + t * 0.6) + n) % n, py = (Math.floor(y + t * 0.3) + n) % n; T[py * n + px] = Math.min(1, T[py * n + px] + 0.6); } }
  // fine skin cross-hatching (the "cell" micro relief) + weave for cloth
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = Math.sin((x + y) * 0.9 + Math.sin(y * 0.13) * 3) * 0.12 + Math.sin((x - y) * 0.7 + Math.sin(x * 0.11) * 3) * 0.12; H[y * n + x] += a;
    W[y * n + x] = 0.5 + 0.5 * Math.sin(x * Math.PI / 2) * Math.sin(y * Math.PI / 2 + (Math.floor(x / 2) % 2) * Math.PI / 2);
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const q = y * n + x, hx = H[y * n + (x + 1) % n] - H[y * n + (x - 1 + n) % n], hy = H[((y + 1) % n) * n + x] - H[((y - 1 + n) % n) * n + x];
    d[q * 4] = Math.max(0, Math.min(255, 128 + hx * 90)); d[q * 4 + 1] = Math.max(0, Math.min(255, 128 + hy * 90)); d[q * 4 + 2] = T[q] * 255; d[q * 4 + 3] = W[q] * 255;
  }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return (DETAIL = t);
}

// ---------------------------------------------------------------- three.js head
export class Head {
  static async create(scene, o = {}) {
    const P = { ...HEADS.ironworker, ...o };
    let b = null;
    if (o.bin !== false) { try { const name = o.name || Object.keys(HEADS).find(k => HEADS[k] === o.preset) || 'custom'; const r = await fetch(o.bin || `../assets/bake/sim2/head_${name}.bin`); if (r.ok) b = unpackHead(await r.arrayBuffer()); } catch (e) { b = null; } }
    const t0 = performance.now();
    if (!b) b = bakeHead(P, o.bake || {});
    const h = new Head(scene, b, P); h.bakeMs = performance.now() - t0; return h;
  }
  constructor(scene, b, P) {
    this.P = P;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(b.nrm, 3)); g.setAttribute('aAux', new THREE.BufferAttribute(b.aux, 4));
    g.setIndex(new THREE.BufferAttribute(b.idx, 1)); g.computeBoundingSphere();
    this.geo = g; this.nv = b.pos.length / 3; this.ntri = b.idx.length / 3;
    const U = this.uni = {
      uDet: { value: detailTex() }, uLook: { value: { skin: 0, bronze: 1, shadow: 2 }[P.look || 'skin'] },
      uSkin: { value: new THREE.Color(P.skin) }, uHat: { value: new THREE.Color(P.hatColor) }, uCloth: { value: new THREE.Color(P.clothColor) }, uHair: { value: new THREE.Color(P.hairColor || '#2e2016') },
      uKeyD: { value: new THREE.Vector3(0.5, 0.4, 0.6).normalize() }, uKeyC: { value: new THREE.Color(2, 1.8, 1.6) },
      uRimD: { value: [new THREE.Vector3(-0.6, 0.3, -0.7).normalize(), new THREE.Vector3(0.7, 0.2, -0.6).normalize()] }, uRimC: { value: [new THREE.Color(0, 0, 0), new THREE.Color(0, 0, 0)] },
      uSky: { value: new THREE.Color(0.2, 0.22, 0.28) }, uGnd: { value: new THREE.Color(0.08, 0.06, 0.05) }, uFogC: { value: new THREE.Color(0, 0, 0) }, uFogD: { value: 0 },
      uStub: { value: P.beard === 'stubble' ? 1 : P.beard === 'full' ? 0.4 : 0 }, uAge: { value: P.age || 0 }, uSweat: { value: P.sweat ?? 0.6 }, uDirt: { value: P.dirt ?? 0.35 },
      uBronze: { value: new THREE.Color(P.bronze || '#8a5a2e') }, uDecal: { value: null }, uHasDecal: { value: 0 }, uFlat: { value: new THREE.Color(P.flat || '#0b0507') },
    };
    if (P.decal) { const t = new THREE.CanvasTexture(P.decal); t.colorSpace = THREE.SRGBColorSpace; U.uDecal.value = t; U.uHasDecal.value = 1; }
    this.mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: HEAD_VS, fragmentShader: HEAD_FS, extensions: { derivatives: true } });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.castShadow = true; this.mesh.receiveShadow = false; this.mesh.userData.subject = 1;
    this.group = new THREE.Group(); this.group.add(this.mesh); scene.add(this.group);
  }
  light({ key, rims, sky, ground, fog, fogD } = {}) {
    const U = this.uni;
    if (key) { U.uKeyD.value.copy(key.dir).normalize(); U.uKeyC.value.copy(key.color); }
    if (rims) rims.slice(0, 2).forEach((r, i) => { U.uRimD.value[i].copy(r.dir).normalize(); U.uRimC.value[i].copy(r.color); });
    if (sky) U.uSky.value.copy(sky); if (ground) U.uGnd.value.copy(ground); if (fog) U.uFogC.value.copy(fog); if (fogD != null) U.uFogD.value = fogD;
    return this;
  }
  update(t) { this.mesh.position.y = 0.0015 * Math.sin(t * 1.3); this.mesh.rotation.x = 0.004 * Math.sin(t * 1.3 + 0.5); return this; }
}

const HEAD_VS = /* glsl */`
attribute vec4 aAux; varying vec3 vN, vW, vO; varying vec4 vAux; varying vec4 vReg;
void main(){ vAux = aAux; int r = int(aAux.w + 0.5); vReg = vec4(r == 0, r == 1, r == 2, r == 3); vO = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const HEAD_FS = /* glsl */`
uniform sampler2D uDet, uDecal; uniform int uLook; uniform float uStub, uAge, uSweat, uDirt, uFogD, uHasDecal;
uniform vec3 uSkin, uHat, uCloth, uHair, uKeyD, uKeyC, uSky, uGnd, uFogC, uBronze, uFlat; uniform vec3 uRimD[2]; uniform vec3 uRimC[2];
varying vec3 vN, vW, vO; varying vec4 vAux; varying vec4 vReg;
vec4 tri(vec3 p, vec3 n, float s){ vec3 w = pow(abs(n), vec3(4.0)); w /= dot(w, vec3(1.0)); return texture2D(uDet, p.yz * s) * w.x + texture2D(uDet, p.xz * s) * w.y + texture2D(uDet, p.xy * s) * w.z; }
float D_GGX(float nh, float a){ float a2 = a*a; float d = nh*nh*(a2-1.0)+1.0; return a2 / (3.14159 * d * d); }
float h13(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main(){
  vec3 V = normalize(cameraPosition - vW), N0 = normalize(vN);
  float ao = vAux.x, curv = vAux.y, thick = vAux.z; vec4 rw = vReg; float rh = 1.0 - rw.x - rw.y - rw.z - rw.w; int reg = 0; float best = rw.x;
  if (rw.y > best) { best = rw.y; reg = 1; } if (rw.z > best) { best = rw.z; reg = 2; } if (rw.w > best) { best = rw.w; reg = 3; } if (rh > best) { reg = 4; }
  vec3 o = vO;
  // zone masks in object space (face regions)
  float ax = abs(o.x);
  float beardZ = smoothstep(-0.02, -0.045, o.y) * smoothstep(0.02, 0.05, o.z) * (1.0 - smoothstep(-0.105, -0.12, o.y) * 0.0) * smoothstep(0.075, 0.05, ax) * (1.0 - smoothstep(-0.025, -0.012, o.y - 0.0));
  float lipZone = smoothstep(0.03, 0.02, ax) * smoothstep(0.012, 0.006, abs(o.y + 0.056)) * step(0.085, o.z);
  beardZ = max(beardZ, smoothstep(0.024, 0.016, ax) * smoothstep(-0.034, -0.04, o.y) * smoothstep(-0.05, -0.046, o.y) * step(0.09, o.z)) * (1.0 - lipZone);
  float oily = max(smoothstep(0.03, 0.0, ax) * smoothstep(0.02, 0.06, o.y) * step(0.05, o.z), smoothstep(0.02, 0.0, ax) * smoothstep(0.02, -0.01, o.y) * step(0.09, o.z));
  oily = max(oily, smoothstep(0.02, 0.0, abs(ax - 0.047)) * smoothstep(0.015, 0.0, abs(o.y + 0.005)) * step(0.05, o.z));
  // micro normal
  vec4 dt = tri(o, N0, 11.0), dt2 = tri(o, N0, 3.0);
  vec3 N = N0; float bump = reg == 0 ? 0.3 : reg == 3 ? 0.5 : reg == 4 ? 0.9 : 0.0;
  // forehead wrinkles and crow's feet (age)
  float wr = uAge * 0.45 * smoothstep(0.03, 0.05, o.y) * smoothstep(0.085, 0.07, o.y) * step(0.05, o.z) * sin(o.y * 900.0 + sin(o.x * 60.0) * 2.0) * smoothstep(0.35, 0.75, dt2.w + dt2.z * 0.5) * smoothstep(0.05, 0.02, ax);
  float cf = uAge * smoothstep(0.014, 0.0, abs(ax - 0.054)) * smoothstep(0.02, 0.0, abs(o.y - 0.012)) * sin(atan(o.y - 0.012, ax - 0.032) * 18.0);
  vec2 g = (dt.xy - 0.5) * bump + vec2(0.0, (wr + cf) * 0.4);
  vec3 T = normalize(cross(N0, vec3(0.0, 1.0, 0.0)) + 1e-4), Bt = cross(N0, T); N = normalize(N0 + T * g.x + Bt * g.y);
  vec3 L = normalize(uKeyD);
  vec3 col = vec3(0.0);
  if (uLook == 2) {                          // shadow: a flat silhouette with the rim only (poster restraint)
    col = uFlat;
    for (int i = 0; i < 2; i++) { float r = pow(1.0 - max(dot(N0, V), 0.0), 3.0) * max(dot(N0, normalize(uRimD[i])) + 0.25, 0.0); col += uRimC[i] * r * 1.4; }
  } else if (uLook == 1) {                   // bronze: a cast monument, patina in the hollows, polished on the high points
    vec3 alb = uBronze; float pat = smoothstep(0.75, 0.35, ao) + smoothstep(-8.0, -30.0, curv) * 0.5;
    alb = mix(alb, vec3(0.12, 0.2, 0.16), clamp(pat, 0.0, 0.7));
    float rough = mix(0.28, 0.6, clamp(pat, 0.0, 1.0));
    vec3 H = normalize(L + V); float nl = max(dot(N, L), 0.0);
    vec3 F = mix(alb, vec3(1.0), pow(1.0 - max(dot(H, V), 0.0), 5.0));
    col = uKeyC * nl * (alb * 0.15 + F * D_GGX(max(dot(N, H), 0.0), rough) * 0.25);
    for (int i = 0; i < 2; i++) { vec3 R = normalize(uRimD[i]); vec3 Hr = normalize(R + V); col += uRimC[i] * max(dot(N, R), 0.0) * alb * (0.2 + D_GGX(max(dot(N, Hr), 0.0), rough) * 0.3); }
    col += mix(uGnd, uSky, 0.5 + 0.5 * N.y) * alb * ao * 0.6;
  } else {
    vec3 alb; float rough = 0.45, F0 = 0.028, sss = 0.0, spec = 1.0;
    if (reg == 0) {
      alb = uSkin;
      // colour zones: redder cheeks, nose and ears; darker lids; paler lips
      alb *= mix(vec3(1.0), vec3(1.08, 0.9, 0.86), smoothstep(0.02, 0.0, abs(ax - 0.04)) * smoothstep(0.03, 0.0, abs(o.y + 0.02)) * step(0.04, o.z));
      alb *= mix(vec3(1.0), vec3(1.1, 0.86, 0.84), smoothstep(0.02, 0.0, ax) * smoothstep(0.0, -0.03, o.y) * smoothstep(-0.04, -0.028, o.y) * step(0.1, o.z));
      alb *= mix(vec3(1.0), vec3(1.05, 0.82, 0.82), smoothstep(0.07, 0.078, ax));
      alb = mix(alb, alb * vec3(1.02, 0.78, 0.78), lipZone);
      alb *= 1.0 - 0.18 * smoothstep(0.02, 0.0, abs(o.y - 0.018)) * smoothstep(0.02, 0.0, abs(ax - 0.032)) * step(0.06, o.z);
      // stubble / beard shadow: pigment + hair dots
      float st = uStub * beardZ; alb = mix(alb, alb * vec3(0.55, 0.52, 0.52), st * 0.6); alb = mix(alb, uHair * 0.6, st * dt.z * 0.85);
      // grime and sweat
      alb *= 1.0 - uDirt * 0.25 * smoothstep(0.4, 0.8, dt2.z) - uDirt * 0.12 * (1.0 - ao);
      rough = mix(0.5, 0.3, oily * uSweat) + st * 0.2; sss = 1.0;
    } else if (reg == 1) { alb = vec3(0.62, 0.56, 0.5) * mix(0.5, 1.0, ao); float iris = smoothstep(0.0066, 0.006, length(o.xy - vec2(sign(o.x) * 0.032, 0.0118))); alb = mix(alb, vec3(0.08, 0.06, 0.05), iris); rough = 0.05; F0 = 0.04; spec = 2.0; }
    else if (reg == 2) { alb = uHat; float sc = smoothstep(0.55, 0.8, dt2.z) * 0.5 + smoothstep(0.62, 0.9, tri(o, N0, 0.9).z); alb *= 1.0 - 0.35 * sc * uDirt; rough = 0.22 + 0.4 * sc; F0 = 0.045;
      if (uHasDecal > 0.5 && o.z > 0.07 && o.y > 0.06) { vec2 du = vec2(o.x / 0.07 + 0.5, (o.y - 0.075) / 0.05 + 0.5); if (du.x > 0.0 && du.x < 1.0 && du.y > 0.0 && du.y < 1.0) { vec4 dc = texture2D(uDecal, vec2(du.x, 1.0 - du.y)); alb = mix(alb, dc.rgb, dc.a); } } }
    else if (reg == 3) { alb = uCloth * (0.8 + 0.3 * dt.w) * (1.0 - 0.2 * smoothstep(0.5, 0.8, dt2.z)); rough = 0.85; F0 = 0.02; }
    else { alb = uHair * (0.7 + 0.5 * dt.z); rough = 0.4; F0 = 0.04; }
    // lights: key + two rims
    vec3 dirs[3]; vec3 cols[3]; dirs[0] = L; cols[0] = uKeyC; dirs[1] = normalize(uRimD[0]); cols[1] = uRimC[0]; dirs[2] = normalize(uRimD[1]); cols[2] = uRimC[1];
    for (int i = 0; i < 3; i++) {
      vec3 Ld = dirs[i]; float nl = dot(N, Ld);
      // pre-integrated-style scattering: the terminator wraps further in red than in green and blue, more on curved parts
      vec3 w = sss * vec3(0.5, 0.2, 0.12) * (0.6 + clamp(abs(curv) * 0.012, 0.0, 1.2));
      vec3 dif = clamp((vec3(nl) + w) / (1.0 + w), 0.0, 1.0); dif *= dif;
      vec3 Hh = normalize(Ld + V); float nh = max(dot(N, Hh), 0.0), nv = max(dot(N, V), 0.001);
      float Fr = F0 + (1.0 - F0) * pow(1.0 - max(dot(Hh, V), 0.0), 5.0);
      float sp = (D_GGX(nh, rough) * 0.75 + D_GGX(nh, rough * 1.9) * 0.25) * Fr * max(nl, 0.0) * spec / (4.0 * nv * max(nl, 0.1) + 0.2);
      if (reg == 4) { vec3 Th = normalize(cross(N, vec3(1.0, 0.0, 0.0)) + 1e-4); float th = dot(Th, Hh); sp = 0.25 * pow(sqrt(max(0.0, 1.0 - th * th)), 80.0) * max(nl, 0.0) + 0.12 * pow(sqrt(max(0.0, 1.0 - th * th)), 12.0) * max(nl, 0.0) * dot(alb, vec3(3.0)); }
      // transmission through thin tissue (ears, nostrils, edges of the nose) when the light is behind
      vec3 tr = sss * exp(-thick / 0.0045 * vec3(1.0, 2.8, 4.6)) * max(0.0, -dot(N0, Ld) + 0.25) * vec3(1.0, 0.35, 0.2) * 1.6;
      // vellus / sweat sheen: back light grazing the silhouette (what makes back-lit skin read as skin)
      float sheen = sss * pow(1.0 - nv, 3.0) * max(dot(N0, Ld) + 0.35, 0.0) * max(dot(-V, Ld) + 0.2, 0.0) * 1.2;
      col += cols[i] * (alb * dif * mix(1.0, ao, 0.3) + sp + alb * tr + mix(alb, vec3(1.0, 0.85, 0.7), 0.5) * sheen);
    }
    col += mix(uGnd, uSky, 0.5 + 0.5 * N.y) * alb * ao * ao;
  }
  float d = length(cameraPosition - vW); col = mix(col, uFogC, 1.0 - exp(-d * uFogD));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
