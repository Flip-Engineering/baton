// ANAT8-HEAD (it6, 8 Oct): THE FACE'S SOFT TISSUE SOLVED. The layers head/ builds (deep fat, muscles, glands, the superficial fat
// compartments, the dermis) become ONE tissue region for ANAT8-BODY's soft-tissue solver (lib/fx/anatomy/soft/index.js: embedded 5-tet
// grid, stable Neo-Hookean XPBD, sliding / bonded bases, unilateral tethers, a skin membrane, gravity), solved from the UNLOADED anatomy
// (the shape the layers build, gravity-free) to its loaded rest in the upright pose. The loaded outer surface replaces the envelope's level
// set; head/membrane.js fits hm08 onto it unchanged. Node only, baked per person (labs/human8/anat8/anat8_f9.mjs); the page never solves.
//   const sol = solveFaceTissue(H, B, env, st, { gravity })   // H: head/index.js buildHead; B: the skull; env: membrane.js skinEnvelope
//   sol.E (the loaded envelope: a redistanced field, mm, the craniometric frame), sol.U (the displacement on the tet grid), sol.report
// WHAT IS PHYSICAL HERE AND WHAT IS NOT (honestly):
//  - the REGION: everything inside the anatomy's skin and outside the solids (the bone, the real globes, the nose's cartilage), in a box
//    round the face (the scalp above the forehead, the ears and the neck below the chin are cut planes, held: ANAT8-BODY's neck and the hair
//    keep their fit). The oral and nasal cavities inside the offset are not modelled apart (tissue there is bonded to the bone round it).
//  - the COMPARTMENTS by the layer a point lies in (the dermis is NOT a volume here: the skin is the membrane below; at h 2 mm a dermis
//    compartment made the whole outer cell layer a 2 mm stiff shell, the skin counted twice): the muscles (the shells and the
//    mentalis: head/muscles.js), the glands, the deep fat pads by name (ROOF, SOOF, the deep medial cheek, the buccal pad, the orbital fat),
//    the superficial compartments by the compartment that dominates at the point's foot on the bone (head/fat.js: Rohrich and Pessa 2007),
//    and the SEPTA (soft/ v1 has no internal membranes: a septum is the band where two compartments meet, given the fibrous septum's
//    modulus: an embedded stiff sheet ~ a cell thick).
//  - the SUPPORTS: the base BONDED to the bone and the cartilage (the periosteum; the deep fat and the muscles' origins), SLIDING over the
//    globe (the lids); the RETAINING LIGAMENTS (head/fat.js: the tear trough and orbicularis retaining ligaments, the zygomatic ligament,
//    the mandibular ligament, and the nasolabial line's dermal attachments) as unilateral tethers from the bone to the dermis above them,
//    their slack growing with age (FACE6's laxity): where the fat around them descends, they hold the skin and the groove forms.
//  - the SKIN: a membrane on the outer surface (Mazier et al. 2024's in vivo, gravity-calibrated skin modulus: ANAT8-BODY finding 26).
//  - the MODULI (FACE_TISSUE below) are in vivo, small-strain values as recalled from the biomechanics literature (sources inline); the bulk
//    is kept high (nu 0.49): tissue is nearly incompressible however soft its shear. NOTHING here is tuned to a depth, a site or a picture.
import { buildSoft, solveSoft } from '../soft/index.js';
import { sampleField, makeField, redistance } from '../layer/grid.js';
import * as D from '../layer/sdf.js';
import { v3, LBL, onBone, f1, f2 } from './common.js';
import { laxity } from './fat.js';
export const FACE_SOFT_VERSION = 1;   // (lane it22, 02:4x) a rev 2 (the canthal tendons as tethers) was written and WITHDRAWN unverified: its medial tendon found no anchor (a ray at x = xD + 1 passes through the orbit's opening to the medial wall 40 mm back, and the march along that wall's normal never meets the envelope: 0 tethers on L03 / L21), its lateral pulled up to 12.7-15 mm; git history (adb85a73) keeps it; NOTES it22 NEXT B

// materials (Pa, kg / m3); E the small-strain Young's modulus in vivo
export const FACE_TISSUE = {
  supFat: { E: 1500, nu: 0.49, rho: 920, src: 'superficial facial fat, septated: in vivo aspiration / elastography of facial fat ~1-2 kPa (Barbarino et al. 2009 face model, as recalled)' },
  deepFat: { E: 1000, nu: 0.49, rho: 920, src: 'deep fat pads (looser lobules): ~1 kPa, as recalled' },
  septum: { E: 30000, nu: 0.45, rho: 1050, src: 'fibrous septa between the compartments (collagenous: tens of kPa at small strain), as recalled' },
  muscle: { E: 12000, nu: 0.49, rho: 1060, src: 'relaxed skeletal muscle, shear-wave elastography ~3-5 kPa shear (Gennisson 2005, as recalled)' },
  gland: { E: 4000, nu: 0.49, rho: 1040, src: 'parotid / submandibular gland, as recalled' },
  skinMembrane: { E: 22700, src: 'skin in vivo, gravity-calibrated (Mazier et al. 2024 via ANAT8-BODY finding 26)' },
  ligament: { k: 150, src: 'a retaining ligament per 2 mm of its line (collagenous: far stiffer than the fat; N / m), as recalled' },
};
const SUP = ['forehead', 'temporal', 'infraorbital', 'medialCheek', 'middleCheek', 'lateralCheek', 'nasolabial', 'jowl', 'mental', 'submental', 'lips', 'nose'];
const DEEP = ['roof', 'soof', 'dmcf', 'buccalPad', 'orbital', 'temporalPad'];   // (it12) the temporal fat pads (head/fat.js)
const SYM = new Set(['forehead', 'mental', 'submental', 'lips', 'nose']);

// the region: { R (soft/'s region, metres in the craniometric frame), grid, report }
export function faceRegion(H, B, env, st, o = {}) {
  const t0 = Date.now(), lm = B.lm, g = B.geo, h = o.h ?? 2, E = env.E, G = H.G;
  const box = o.box || [-82, Math.round(lm.Me[1] - 30), -8, 82, Math.round(g.yN + 55), Math.ceil(env.box[5])];
  // the SOLIDS: bone (redistanced), the real globes, the nose's cartilage
  const globes = ['L', 'R'].map(s => B.globe[s]);
  const solidD = (x, y, z) => { let d = G.value(x, y, z), lab = 1; for (const gl of globes) { const dg = Math.hypot(x - gl.c[0], y - gl.c[1], z - gl.c[2]) - gl.r; if (dg < d) { d = dg; lab = 2; } }
    const dc = H.cart.d(x, y, z); if (dc < d) { d = dc; lab = 3; } return [d, lab]; };
  const SolF = sampleField({ d: (x, y, z) => solidD(x, y, z)[0] }, box, h, { band: 6 });
  // the COMPARTMENTS (names, materials)
  const comps = [], cIdx = {}; const addC = (name, kind, mat) => { cIdx[name] = comps.length; comps.push({ name, kind, mat: { E: mat.E, nu: mat.nu, rho: mat.rho } }); };
  addC('subcutaneous', 'fat', FACE_TISSUE.supFat); for (const k of SUP) addC(k, 'fat', FACE_TISSUE.supFat);
  for (const k of DEEP) addC(k, 'deep fat', FACE_TISSUE.deepFat);
  addC('septum', 'septum', FACE_TISSUE.septum); addC('muscle', 'muscle', FACE_TISSUE.muscle); addC('gland', 'gland', FACE_TISSUE.gland);
  const fields = H.fat.fields, ft = (f, p) => SYM.has(f.key) ? f.t(p) : f.tBoth(p);
  const classify = (p) => {
    const L = D.labelAt(H.inner, p[0], p[1], p[2]);
    if (L.d < 0) { if (L.label === LBL.muscle) return cIdx.muscle; if (L.label === LBL.gland) return cIdx.gland;
      if (L.label === LBL.deepFat) { const nm = String(L.part || '').replace(/_R$/, ''); return cIdx[nm] ?? cIdx.dmcf; } }
    const f = H.foot(p); let b1 = -1, t1 = 0, t2 = 0; for (let i = 0; i < fields.length; i++) { const t = ft(fields[i], f); if (t > t1) { t2 = t1; t1 = t; b1 = i; } else if (t > t2) t2 = t; }
    if (b1 < 0 || t1 < 0.3) return cIdx.subcutaneous;
    if (t2 > 0.3 && t1 - t2 < 0.06 * t1) return cIdx.septum;     // where two compartments meet: the septum between them (a band ~ a cell wide)
    return cIdx[fields[b1].key];
  };
  // the dense grid of the tissue's field, compartment and boundary label
  const nx = Math.ceil((box[3] - box[0]) / h) + 1, ny = Math.ceil((box[4] - box[1]) / h) + 1, nz = Math.ceil((box[5] - box[2]) / h) + 1, N = nx * ny * nz;
  const Ft = new Float32Array(N), Cc = new Uint8Array(N).fill(255), Lb = new Uint8Array(N), cCount = {}; let tissueNodes = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const n = (k * ny + j) * nx + i, x = box[0] + i * h, y = box[1] + j * h, z = box[2] + k * h;
    const de = E.value(x, y, z), ds = SolF.value(x, y, z); Ft[n] = Math.max(de, -ds); Lb[n] = Math.abs(de) <= Math.abs(ds) ? 0 : solidD(x, y, z)[1];
    if (Ft[n] < h) { Cc[n] = classify([x, y, z]); if (Ft[n] < 0) { tissueNodes++; cCount[Cc[n]] = (cCount[Cc[n]] || 0) + 1; } } }
  const TF = makeField(Ft, [nx, ny, nz], [box[0], box[1], box[2]], h);
  const nearest = (x, y, z, A) => { const i = Math.max(0, Math.min(nx - 1, Math.round((x - box[0]) / h))), j = Math.max(0, Math.min(ny - 1, Math.round((y - box[1]) / h))), k = Math.max(0, Math.min(nz - 1, Math.round((z - box[2]) / h))); return A[(k * ny + j) * nx + i]; };
  const LABS = ['skin', 'bone', 'globe', 'cart'], cutPad = 1.5 * h;
  const fieldF = (u, v, w) => { const x = u * 1000, y = v * 1000, z = w * 1000, d = TF.value(x, y, z); let c = nearest(x, y, z, Cc); if (c === 255) c = cIdx.subcutaneous;
    const cut = x < box[0] + cutPad || x > box[3] - cutPad || y < box[1] + cutPad || y > box[4] - cutPad || z < box[2] + cutPad; return { d: d / 1000, comp: c, label: cut ? 'cut' : LABS[nearest(x, y, z, Lb)] }; };
  const gt = [0, 0, 0];
  const solids = { dg: (x, y, z, out) => { const p = [x * 1000, y * 1000, z * 1000], d = SolF.value(p[0], p[1], p[2]); SolF.grad(p[0], p[1], p[2], gt, 0.6); out[0] = gt[0]; out[1] = gt[1]; out[2] = gt[2]; return d / 1000; } };
  // the RETAINING LIGAMENTS: per 2 mm of each line, the bone's foot (anchor) and the skin above it (the skin end the solver snaps to the
  // nearest skin vertex); both sides
  const lax = laxity(st.age), slack = 0.02 + 0.10 * lax, tethers = [], ligRep = {};
  for (const [key, L] of Object.entries(H.fat.lig0 || {})) { const pts = []; for (let i = 0; i + 1 < L.pts.length; i++) { const a = L.pts[i], b = L.pts[i + 1], n = Math.max(1, Math.round(v3.dist(a, b) / 2)); for (let s = 0; s < n; s++) pts.push(v3.lerp(a, b, s / n)); } pts.push(L.pts[L.pts.length - 1]);
    for (const sg of [1, -1]) { const skin = [], anchor = [];
      for (const p0 of pts) { const p = [sg * p0[0], p0[1], p0[2]], a = onBone(G, p, 0), nrm = G.grad(a[0], a[1], a[2], [0, 0, 0], 0.6); let s = null, prev = E.value(...a);
        for (let t = 0.5; t <= 40; t += 0.5) { const q = v3.add(a, v3.mul(nrm, t)), e = E.value(q[0], q[1], q[2]); if (prev < 0 && e >= 0) { s = v3.add(a, v3.mul(nrm, t - 0.5 * e / Math.max(1e-6, e - prev))); break; } prev = e; }
        if (!s) continue; skin.push(s.map(c => c / 1000)); anchor.push(a.map(c => c / 1000)); }
      if (skin.length) { tethers.push({ name: key + (sg > 0 ? '_L' : '_R'), kind: 'retaining ligament', skin, anchor, k: FACE_TISSUE.ligament.k, slack }); ligRep[key] = (ligRep[key] || 0) + skin.length; } } }
  // tracked points: the skin over a few sites (convergence; where the solve carried them)
  const track = []; for (const s of (H.sites || [])) { if (!['mal_L', 'buc_L', 'pg', 'or_L', 'go_L', 'mm_L'].includes(s.id) || s.built == null) continue; const q = v3.add(s.b, v3.mul(s.n, Math.max(0.5, s.built - 1))); track.push({ name: s.id, p: q.map(c => c / 1000) }); }
  const gq = o.gravity || [0, -9.81, 0];
  const R = { name: 'face', h: h / 1000, box: box.map(c => c / 1000), fieldF, compartments: comps, solids,
    interfaces: [{ label: 'bone', kind: 'bonded' }, { label: 'cart', kind: 'bonded' }, { label: 'globe', kind: 'sliding', G: 200, t: 0.001, kn: 1e6 }],
    membranes: [{ name: 'skin', label: 'skin', E: FACE_TISSUE.skinMembrane.E, t: (o.skinT ?? 1.6) / 1000, laxity: 0, compress: 10 }],
    tethers, colliders: [], gravity: gq, track, surfH: h / 1000, massFloor: 1,
    cuts: [{ p: [box[0] / 1000, 0, 0], n: [-1, 0, 0], kind: 'held' }, { p: [box[3] / 1000, 0, 0], n: [1, 0, 0], kind: 'held' }, { p: [0, box[1] / 1000, 0], n: [0, -1, 0], kind: 'held' },
      { p: [0, box[4] / 1000, 0], n: [0, 1, 0], kind: 'held' }, { p: [0, 0, box[2] / 1000], n: [0, 0, -1], kind: 'held' }] };
  return { R, grid: { box, h, dims: [nx, ny, nz], Cc, comps }, report: { box, h, tissueNodes, cm3: Object.fromEntries(Object.entries(cCount).map(([c, k]) => [comps[c].name, f1(k * h * h * h / 1000)])), slack: f2(slack), laxity: f2(lax), ligaments: ligRep, compartments: comps.map(c => c.name), gravity: gq.map(f2), ms: Date.now() - t0 } };
}

// solve and return the LOADED envelope: the reference envelope advected by the solved displacement (E1(p) = E0(p - u(p))), redistanced
export function solveFaceTissue(H, B, env, st, o = {}) {
  const t0 = Date.now(), FR = faceRegion(H, B, env, st, o), S = buildSoft(FR.R), t1 = Date.now();
  const L = solveSoft(S, { dt: o.dt ?? 0.001, maxTime: o.maxTime ?? 1.0, damping: o.damping ?? 40, tolMm: o.tolMm ?? 0.02, minTime: o.minTime ?? 0.4, log: o.log }), t2 = Date.now();
  // the displacement on the tet grid's nodes (mm), inactive nodes filled from their active neighbours (a few passes), then 0
  const [gx, gy, gz] = S.info.grid, hh = FR.grid.h, b = FR.grid.box, nx = gx + 1, ny = gy + 1, nz = gz + 1, NN = nx * ny * nz, U = new Float32Array(NN * 3), on = new Uint8Array(NN);
  const nN = S.X0.length / 3; let umax = 0, uat = null;
  for (let n = 0; n < nN; n++) { const i = Math.round((S.X0[n * 3] * 1000 - b[0]) / hh), j = Math.round((S.X0[n * 3 + 1] * 1000 - b[1]) / hh), k = Math.round((S.X0[n * 3 + 2] * 1000 - b[2]) / hh); if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
    const m = (k * ny + j) * nx + i; for (let a = 0; a < 3; a++) U[m * 3 + a] = (S.X[n * 3 + a] - S.X0[n * 3 + a]) * 1000; on[m] = 1; const u = Math.hypot(U[m * 3], U[m * 3 + 1], U[m * 3 + 2]); if (u > umax) { umax = u; uat = [S.X0[n * 3], S.X0[n * 3 + 1], S.X0[n * 3 + 2]].map(c => f1(c * 1000)); } }
  for (let pass = 0; pass < 3; pass++) { const add = []; for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const m = (k * ny + j) * nx + i; if (on[m]) continue; let s0 = 0, s1 = 0, s2 = 0, c = 0;
      for (const [a, bb, cc] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const ii = i + a, jj = j + bb, kk = k + cc; if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue; const q = (kk * ny + jj) * nx + ii; if (on[q] !== 1 && !(on[q] === 2 && pass > 0)) continue; s0 += U[q * 3]; s1 += U[q * 3 + 1]; s2 += U[q * 3 + 2]; c++; }
      if (c) add.push([m, s0 / c, s1 / c, s2 / c]); }
    for (const [m, a0, a1, a2] of add) { U[m * 3] = a0; U[m * 3 + 1] = a1; U[m * 3 + 2] = a2; on[m] = 2; } }
  const uAt = (x, y, z, out) => { const fx = Math.max(0, Math.min(nx - 1.0001, (x - b[0]) / hh)), fy = Math.max(0, Math.min(ny - 1.0001, (y - b[1]) / hh)), fz = Math.max(0, Math.min(nz - 1.0001, (z - b[2]) / hh)), i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), u = fx - i, v = fy - j, w = fz - k;
    out[0] = out[1] = out[2] = 0; for (let c = 0; c < 8; c++) { const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1, wt = (di ? u : 1 - u) * (dj ? v : 1 - v) * (dk ? w : 1 - w), m = ((k + dk) * ny + (j + dj)) * nx + (i + di); if (!wt) continue; out[0] += wt * U[m * 3]; out[1] += wt * U[m * 3 + 1]; out[2] += wt * U[m * 3 + 2]; } return out; };
  // the loaded envelope on the reference envelope's grid
  const E0 = env.E, [ex, ey, ez] = E0.dims, [ox, oy, oz] = E0.origin, eh = E0.h, F1 = new Float32Array(E0.F.length), q = [0, 0, 0];
  for (let k = 0; k < ez; k++) for (let j = 0; j < ey; j++) for (let i = 0; i < ex; i++) { const n = (k * ey + j) * ex + i, x = ox + i * eh, y = oy + j * eh, z = oz + k * eh;
    if (x < b[0] || x > b[3] || y < b[1] || y > b[4] || z < b[2] || z > b[5]) { F1[n] = E0.F[n]; continue; } uAt(x, y, z, q); F1[n] = E0.value(x - q[0], y - q[1], z - q[2]); }
  const E1 = redistance(makeField(F1, E0.dims, E0.origin, eh)), t3 = Date.now();
  const track = Object.fromEntries(Object.entries(L.track).map(([k, p]) => { const p0 = FR.R.track.find(t => t.name === k)?.p; return [k, p0 ? [0, 1, 2].map(a => f2((p[a] - p0[a]) * 1000)) : null]; }));
  const report = { version: FACE_SOFT_VERSION, region: FR.report, soft: S.info, solve: { ...L.stats, hist: L.stats.hist.filter((_, i, a) => i % 4 === 0 || i === a.length - 1) }, track, umax: f2(umax), uat, ms: { region: FR.report.ms, build: t1 - t0 - FR.report.ms, solve: t2 - t1, envelope: t3 - t2 } };
  return { E: E1, E0, U: { U, on, dims: [nx, ny, nz], box: b, h: hh, at: uAt }, grid: FR.grid, S, L, report };
}
