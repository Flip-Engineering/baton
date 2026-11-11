// FACE4 (HUMAN c8 round 4, 3 Oct): face rev 4, on top of a finished rev-3 face (a v3 bake's) and FACE3. Opt-in: only
// face3Data(.., face3Spec(info, { rev: 4 })) reaches this file (makePerson('v3:<name>', { face3: { rev: 4 } })); every other person,
// bake and scene renders exactly as before.
//
//  1. RETUNE. makeFace rev 3 put MakeHuman's targets at their real size (FACE3's finding) but kept P2's feature SDs, which were tuned
//     at a tenth of it: every drawn feature acts x10. Most of that is welcome character (noses, brows, cheeks, chins); the MOUTH's
//     features are not: at x10 the drawn lip volumes, heights, protrusion and corner angle and MakeHuman's age target (which sags the
//     mouth) give the sour, pouting and pursed resting mouths judge c9 saw (L12 F39, L06 F53, L20 F29) and the heavy lips (L08). The
//     person's own rev-3 draw is recomputed exactly (rev3Weights: the same seed, look and tables as makeFace; checked 0.0000 mm against
//     the bakes) and those targets are brought back to RETUNE's gains; nothing else moves.
//  2. IDENTITY from real heads. A shape basis on OUR topology from the ten HSRD-100 heads of SCAN c1's library (CC BY 4.0; credit
//     'Face shape statistics: HSRD-100 scans, Digital Reality Lab, CC BY 4.0'): each head at one common size, its deviation from its
//     own sex's mean, facial adiposity (BMI) and age regressed out (the cast's BMI is lane A's and the face's fat layers', age FACE's
//     tissue and forms'), mostly symmetric (35 % of the scans' asymmetry kept: the rest is registration and pose), band-limited (the
//     scans' own small forms folded OUR lids), the mouth and the lids HELD (a local interpolant of the basis there taken out: a
//     narrowed mouth read pursed, scan lids folded ours), masked to the face (the temples, ears and hairline are where the scans saw
//     hair, hats and registration error). A person's field = amp x sum z_h R_h / sqrt(dof), z ~ N(0, 1) by the person's own seed
//     (|z| <= 2), a soft 7 mm cap; applied AFTER the fit, so the fit cannot pull it back (a landmark-neutral basis, the first try,
//     added little: most real identity sits in proportions); the eyes and sockets move rigidly; nothing under the jaw moves.
//     Ten people (6 women, 4 men; one neutral scan each): 6 degrees of freedom. A larger library widens it (NOTES).
//  3. LIPS: the mouth's ARC first (the corners and modiolus set back toward arc 0.33 x the width; the ten scans 0.28-0.43, v3's
//     sour mouths 0.23-0.27), then CAPPED: the vermilion heights and the lips' E-line protrusion at or under the table's mean + capSd SDs for the
//     person's sex and group (LIPS: Dolci 2021, Chong 2021, Bravo-Hammett 2020 ...), by a landmark-held thin-plate warp (only reduced).
//  4. LIDS, by the ten scans' own numbers (the same metric on the registered HSRD-100 heads: MRD1 4.9-7.4, MRD2 2.75-5.3, mean 3.7 mm):
//     ours had the LOWER lid low (MRD2 3.6-6.0: white under the iris, the 'wide, startled' read), the upper lid already at or under
//     the scans' range. So the lower margin rises to MRD2 3.9 (at most 1.2 mm) and an upper lid under 4.6 rises to it (at most
//     1.2 mm); `drop` (off) lowers it as judge c9 asked, which read sleepy. The same warp; the globe never moves.
//  5. EXPRESSION (face3.js with rev 4): neutral to pleasant only: corners level-to-lifted, a trace of the lower-lid raise (soft eyes).
import { drawTargets, drawFeatures, rng, gauss, clamp, hashStr, groupMix } from './sample.js';
import { LOOKS_C2, LIPS, lipColumns, lipMeasures, lidMeasure, frameOf, mrd1Target, mixGroups } from './c2.js';
import { headZone, tps, warpAt, buildWarp, applyWarp } from './warp.js';
import { headFrame } from './scan.js';

export const FACE4_VERSION = 1;
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const at = (P, v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------------------------------------------------------------- defaults (all overridable per call: face3: { rev: 4, f4: {...} })
// RETUNE: [target-name prefix, gain]: the rev-3 weight of a matching target is brought to gain x (rev 3 = 1; P2 / c2 = 0.1)
// (first match wins): the mouth's features at 0.2 (P2's tuned scale x2), the facial fat at 1 (the BMI rule was written for full-size
// targets), MakeHuman's age target at 0.5, every other drawn feature and head shape at 0.3 (the character they add at x10 bloated the
// lower faces of L12 and L06 and turned their mouths down; FACE c2's board at x1 read neutral); the real heads' basis (2) carries variety
export const RETUNE = [['mouth/', 0.2], ['head/head-fat', 1], ['head/head-age-incr', 0.5], ['', 0.3]];
export const F4_DEFAULTS = {
  retune: RETUNE, id: { amp: { f: 2.0, m: 2.4 }, cap: 7, neutral: 0, anti: 0.35, zmax: 2, seed: 0 },
  lips: { capSd: 0.5, eCapSd: 0.25, maxMove: 1.5, relaxMm: null, arc: 0.33, arcGain: 0.7, arcMax: 3.5 }, lids: { drop: 0, min: 3.0, floor: 4.6, mrd2: 3.9, raiseMax: 1.2 },
};
export function face4Spec(info, o = {}) {
  const f4 = typeof o.f4 === 'object' ? o.f4 : {};
  return { v: FACE4_VERSION, name: info.name, look: f4.look ?? o.look ?? null, retune: f4.retune ?? F4_DEFAULTS.retune,
    id: f4.id === false ? false : { ...F4_DEFAULTS.id, ...(f4.id || {}) }, lips: f4.lips === false ? false : { ...F4_DEFAULTS.lips, ...(f4.lips || {}) },
    lids: f4.lids === false ? false : { ...F4_DEFAULTS.lids, ...(f4.lids || {}) } };
}

// ---------------------------------------------------------------- 1. retune
function addTarget(F, P, name, w, k, n) { if (!w) return 0; const t = F.target(name); if (!t) return 0; const { ix, d } = t; let mx = 0;
  for (let i = 0; i < ix.length; i++) { const v = ix[i]; if (v >= n) continue; const q = v * 3; P[q] += w * k * d[i * 3]; P[q + 1] += w * k * d[i * 3 + 1]; P[q + 2] += w * k * d[i * 3 + 2];
    mx = Math.max(mx, Math.abs(w * k) * Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2])); }
  return mx; }
// the person's rev-3 feature weights, exactly as makeFace drew them (rec: the person record: sex, age, group, measures, height; name:
// the variant makeFace saw, i.e. the bake's variant without its '_v3' suffix; look: V2_PLAN's)
export function rev3Weights(F, rec, name, look = 'common', { featureGain = 1 } = {}) {
  const lk = LOOKS_C2[look] || {};
  const S = { sex: rec.sex || 'f', age: rec.age ?? 35, group: rec.group || 'all', bmi: rec.measures?.bmi ?? 25, stature: rec.measures?.stature ?? rec.height ?? 1.7,
    seed: hashStr(name), spread: 1, averageness: lk.averageness ?? 0, symmetry: lk.symmetry ?? 0, dimorphism: lk.dimorphism ?? 0, features: 1, forms: 1, tissue: 1,
    adiposity: lk.adiposity ?? 0, tilt: lk.tilt ?? 0, lipFull: lk.lipFull ?? 0, eyeOpen: lk.eyeOpen ?? 0, rest: 1, lips: 1, jaw: 1, rev: 3, look, featureGain };
  S.bmiFace = S.bmi + (S.adiposity || 0);
  return drawFeatures(S, drawTargets(F.pop, S)).weights;
}
export function retuneShape(F, P, n, W, rules = RETUNE) {
  const I = F.ids, k = (P[I.v * 3 + 1] - P[I.me * 3 + 1]) / (F.lm.baseHeadHeightDm || 2.3358), out = {};
  for (const [name, w] of Object.entries(W)) { const r = rules.find(([p]) => name.startsWith(p)); if (!r || r[1] === 1) continue;
    const mx = addTarget(F, P, name, (r[1] - 1) * w, k, n); if (mx) out[name] = { w: +w.toFixed(3), to: +(w * r[1]).toFixed(3), mm: +(mx * 1000).toFixed(2) }; }
  return out;
}

// ---------------------------------------------------------------- 2. the identity basis from the scan library
const _basis = new Map();
function solveSym(A, B) { const n = A.length, M = A.map((r, i) => [...r, ...B[i]]);   // Gaussian elimination (small systems)
  for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / (M[i][i] || 1e-12); if (f) for (let c = i; c < n + 3; c++) M[r][c] -= f * M[i][c]; } }
  return M.map((r, i) => r.slice(n).map(x => x / (r[i] || 1e-12))); }
function sizeAt(get, I) { return Math.sqrt(dist(get(I.t_L), get(I.t_R)) * dist(get(I.n), get(I.me))); }
// HOLD: the landmarks whose neighbourhood the basis leaves alone (a local Gaussian interpolant of the basis's own displacement there is
// taken out, sigma holdMm): the lids (the eye's opening is FACE c2's MRD1 and rev 4's lids; scan lids landing elsewhere folded the lid
// skin). The MOUTH is held as a shape instead (identityField: the lips move with the field's mean round them, rigidly): pinning its
// landmarks drew a V at the lips' midline (farm job 1003-155835), and a narrowed mouth under full lips read pursed
export const HOLD = ['en_L', 'ex_L', 'ps_L', 'pi_L', 'en_R', 'ex_R', 'ps_R', 'pi_R'];
export function face4Basis(F, L, tri, o = {}) {
  const neutral = o.neutral ?? 1, anti = o.anti ?? 0.35, hold = o.hold ?? HOLD, holdMm = o.holdMm ?? 7, smooth = o.smooth ?? 24, key = `${neutral}|${anti}|${L.k}|${hold.join(',')}|${holdMm}|${smooth}|${!!tri}`;
  if (_basis.has(key)) return _basis.get(key);
  const k = L.k, hv = L.hv, I = F.ids, nAll = L.meta.n, inv = new Int32Array(nAll).fill(-1); for (let v = 0; v < k; v++) inv[hv[v]] = v;
  const heads = L.heads, getX = X => g => { const v = inv[g]; return [X[v * 3], X[v * 3 + 1], X[v * 3 + 2]]; };
  const sizes = heads.map(h => sizeAt(getX(h.X), I)), S0 = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  const Xn = heads.map((h, i) => Float32Array.from(h.X, x => x * S0 / sizes[i]));
  // within-sex residuals, BMI and age regressed out (pooled within-sex slopes per coordinate: the cast's BMI is lane A's and the
  // face's fat layers', its age FACE's tissue and forms'; three of the ten are 60-64 and four BMI 28-35)
  const sexes = ['f', 'm'], mean = {}, cm = {};
  for (const s of sexes) { const ix = heads.map((h, i) => h.sex === s ? i : -1).filter(i => i >= 0); const M = new Float32Array(k * 3); for (const i of ix) for (let j = 0; j < M.length; j++) M[j] += Xn[i][j] / ix.length; mean[s] = M;
    cm[s] = [ix.reduce((a, i) => a + heads[i].bmi, 0) / ix.length, ix.reduce((a, i) => a + heads[i].age, 0) / ix.length]; }
  const MA = new Float32Array(k * 3); for (const X of Xn) for (let j = 0; j < MA.length; j++) MA[j] += X[j] / Xn.length; const MA0 = () => MA;
  const D = heads.map((h, i) => Float32Array.from(Xn[i], (x, j) => x - mean[h.sex][j])), Z = heads.map(h => [h.bmi - cm[h.sex][0], h.age - cm[h.sex][1]]);
  const a11 = Z.reduce((a, z) => a + z[0] * z[0], 0), a12 = Z.reduce((a, z) => a + z[0] * z[1], 0), a22 = Z.reduce((a, z) => a + z[1] * z[1], 0), det = a11 * a22 - a12 * a12;
  const cz = Z.map(z => [(a22 * z[0] - a12 * z[1]) / det, (-a12 * z[0] + a11 * z[1]) / det]);   // (Z'Z)^-1 z_i
  const b1 = new Float32Array(k * 3), b2 = new Float32Array(k * 3);
  for (let i = 0; i < heads.length; i++) for (let j = 0; j < b1.length; j++) { b1[j] += cz[i][0] * D[i][j]; b2[j] += cz[i][1] * D[i][j]; }
  for (let i = 0; i < heads.length; i++) for (let j = 0; j < b1.length; j++) D[i][j] -= Z[i][0] * b1[j] + Z[i][1] * b2[j];
  const dof = heads.length - sexes.length - 2;
  // mostly symmetric (the mirror map is the library's: v <-> mirror[v], x flips)
  for (const R of D) { const Y = Float32Array.from(R); for (let v = 0; v < k; v++) { const m = L.mirror[v];
    const sx = 0.5 * (Y[v * 3] - Y[m * 3]), sy = 0.5 * (Y[v * 3 + 1] + Y[m * 3 + 1]), sz = 0.5 * (Y[v * 3 + 2] + Y[m * 3 + 2]);
    R[v * 3] = sx + anti * (Y[v * 3] - sx); R[v * 3 + 1] = sy + anti * (Y[v * 3 + 1] - sy); R[v * 3 + 2] = sz + anti * (Y[v * 3 + 2] - sz); } }
  // the mean head (all ten, common size) for the landmark-neutral spline and the masks
  const lmv = [...new Set(Object.values(I))].map(g => inv[g]).filter(v => v >= 0);
  // band-limited: the scans' residuals carry their own small forms (lid creases, lip edges, LOD1 facets) that fold OUR forms when added;
  // the basis keeps the shape at the scale of the face's contours (umbrella smoothing over the head mesh, `smooth` passes)
  let adj = null; if (tri) { const nbm = new Map(); for (let i = 0; i < tri.length; i += 3) for (const [p, q] of [[tri[i], tri[i + 1]], [tri[i + 1], tri[i + 2]], [tri[i + 2], tri[i]]]) { const a = inv[p], c = inv[q]; if (a < 0 || c < 0) continue; (nbm.get(a) || nbm.set(a, new Set()).get(a)).add(c); (nbm.get(c) || nbm.set(c, new Set()).get(c)).add(a); } adj = nbm; }
  if (adj && smooth > 0) for (const R of D) for (let it = 0; it < smooth; it++) { const Y = Float32Array.from(R); for (const [v, Ns] of adj) { let x = 0, y = 0, z = 0; for (const u of Ns) { x += Y[u * 3]; y += Y[u * 3 + 1]; z += Y[u * 3 + 2]; } const c = Ns.size; R[v * 3] = 0.5 * Y[v * 3] + 0.5 * x / c; R[v * 3 + 1] = 0.5 * Y[v * 3 + 1] + 0.5 * y / c; R[v * 3 + 2] = 0.5 * Y[v * 3 + 2] + 0.5 * z / c; } }
  // the held neighbourhoods (mouth, lids): a local Gaussian interpolant through the basis's displacement there, taken out
  const hv0 = hold.map(q => I[q]).filter(g => g != null).map(g => inv[g]).filter(v => v >= 0);
  if (hv0.length) { const sg = holdMm / 1000, C = hv0.map(v => at(MA0(), v)), G = C.map(a => C.map(b => Math.exp(-(dist(a, b) ** 2) / (2 * sg * sg)) + (a === b ? 1e-6 : 0)));
    for (const R of D) { const rhs = hv0.map(v => at(R, v)), W = solveSym(G, rhs);
      for (let v = 0; v < k; v++) { const p = at(MA0(), v); let x = 0, y = 0, z = 0; for (let i = 0; i < C.length; i++) { const g = Math.exp(-(dist(p, C[i]) ** 2) / (2 * sg * sg)); if (g < 1e-4) continue; x += g * W[i][0]; y += g * W[i][1]; z += g * W[i][2]; } R[v * 3] -= x; R[v * 3 + 1] -= y; R[v * 3 + 2] -= z; } } }
  if (neutral > 0) for (const R of D) { const W = tps(lmv.map(v => at(MA, v)), lmv.map(v => at(R, v)), 1e-5);
    for (let v = 0; v < k; v++) { const d = warpAt(W, at(MA, v)); for (let a = 0; a < 3; a++) R[v * 3 + a] -= neutral * d[a]; } }
  // the mask: the scan's own head (blend), the face chart (what the scans saw), faded under the jaw line; smoothed over the mesh
  // and to the FACE: the temples, the sides above the ears, the ears and the hairline are where the scans saw hair, hats and
  // registration error (the basis's residuals there reach 10-26 mm), so the field fades out behind the cheekbones and over the brow
  const meY = MA[inv[I.me] * 3 + 1], nY = MA[inv[I.n] * 3 + 1], mask = new Float32Array(k);
  for (let v = 0; v < k; v++) mask[v] = (L.blend[v] / 255) * sst(0.2, 0.95, L.chart[v * 3 + 2]) * sst(meY - 0.035, meY - 0.008, MA[v * 3 + 1])
    * sst(-0.062, -0.035, MA[v * 3 + 2]) * (1 - sst(nY + 0.022, nY + 0.048, MA[v * 3 + 1]));
  if (tri) { const nb = new Map(); for (let i = 0; i < tri.length; i += 3) for (const [p, q] of [[tri[i], tri[i + 1]], [tri[i + 1], tri[i + 2]], [tri[i + 2], tri[i]]]) { const a = inv[p], c = inv[q]; if (a < 0 || c < 0) continue; (nb.get(a) || nb.set(a, []).get(a)).push(c); }
    for (let it = 0; it < 4; it++) { const m2 = Float32Array.from(mask); for (const [v, L2] of nb) { let s = 0; for (const u of L2) s += mask[u]; m2[v] = 0.5 * mask[v] + 0.5 * s / L2.length; } mask.set(m2); } }
  // the expected spread one unit of amp adds (rms over the face region, and per head)
  const B = { k, hv, inv, R: D, dof, S0, mask, MA, heads: heads.map(h => ({ id: h.id, sex: h.sex, age: h.age, group: h.group, bmi: h.bmi })), neutral, anti };
  _basis.set(key, B); return B;
}
// a person's identity field (bind metres, per library vertex) and the eye shifts
export function identityField(F, L, B, P, E, rec, o) {
  const I = F.ids, k = B.k, fr = headFrame(P, I), sp = sizeAt(g => at(P, g), I) / B.S0;
  const r = rng((hashStr('face4:id:' + (o.name || '')) ^ Math.imul((o.seed ?? 0) + 1, 2654435761)) >>> 0);
  const amp = typeof o.amp === 'object' ? (o.amp[rec.sex === 'm' ? 'm' : 'f'] ?? 1) : (o.amp ?? 1), keep = 1 - clamp(o.averageness ?? 0);
  const z = B.R.map(() => clamp(gauss(r), -(o.zmax ?? 2), o.zmax ?? 2) * amp * keep / Math.sqrt(B.dof));
  const Dl = new Float32Array(k * 3);
  for (let h = 0; h < B.R.length; h++) { const R = B.R[h], c = z[h]; if (!c) continue; for (let j = 0; j < Dl.length; j++) Dl[j] += c * R[j]; }
  // a soft limit on the local move (cap mm, tanh): a draw past it is a scan's outlier (an open mouth, a hat's dent), not a face
  const cap = (o.cap ?? 6) / 1000;
  for (let v = 0; v < k; v++) { const l = Math.hypot(Dl[v * 3], Dl[v * 3 + 1], Dl[v * 3 + 2]); if (l > 1e-9) { const f = cap * Math.tanh(l / cap) / l; Dl[v * 3] *= f; Dl[v * 3 + 1] *= f; Dl[v * 3 + 2] *= f; } }
  const Db = new Float32Array(k * 3);
  for (let v = 0; v < k; v++) { const m = B.mask[v] * sp, x = Dl[v * 3], y = Dl[v * 3 + 1], zz = Dl[v * 3 + 2];
    for (let a = 0; a < 3; a++) Db[v * 3 + a] = m * (x * fr.x[a] + y * fr.y[a] + zz * fr.z[a]); }
  // the eyes and their sockets rigid: each eye moves by the mean field over the vertices it rides on; the socket within 10 mm of the
  // eye's centre takes that same shift (fading to the field by 17 mm), so the lids keep their place on the globe
  const eyeShift = { L: [0, 0, 0], R: [0, 0, 0] }, ctr = { L: [0, 0, 0], R: [0, 0, 0] }, cnt = { L: 0, R: 0 };
  if (E && F.eyeRef) { const R = F.eyeRef, acc = { L: [0, 0, 0, 0], R: [0, 0, 0, 0] };
    for (let e = 0; e < R.ne; e++) { const s = E[e * 3] > 0 ? 'L' : 'R'; for (let a = 0; a < 3; a++) ctr[s][a] += E[e * 3 + a]; cnt[s]++;
      for (let m = 0; m < 3; m++) { const v = B.inv[R.idx[e * 3 + m]]; if (v < 0) continue; const w = R.w[e * 3 + m]; for (let a = 0; a < 3; a++) acc[s][a] += w * Db[v * 3 + a]; acc[s][3] += w; } }
    for (const s of ['L', 'R']) { if (acc[s][3] > 0) eyeShift[s] = acc[s].slice(0, 3).map(x => x / acc[s][3]); if (cnt[s]) ctr[s] = ctr[s].map(x => x / cnt[s]); }
    for (let v = 0; v < k; v++) { const p = at(P, B.hv[v]), s = p[0] > 0 ? 'L' : 'R'; if (!cnt[s]) continue; const w = 1 - sst(0.012, 0.026, dist(p, ctr[s]));
      if (w > 0) for (let a = 0; a < 3; a++) Db[v * 3 + a] = Db[v * 3 + a] * (1 - w) + eyeShift[s][a] * w; } }
  // the mouth rigid: the lips to past the corners (30 mm from the mouth's centre) take the field's mean there, fading to the field by
  // 42 mm (a zone that stopped short of the corners let the scans' mouth-width variation narrow L08's and L20's mouths by 7-9 mm)
  { const I2 = F.ids, mc = [0, 1, 2].map(a => (P[I2.ch_L * 3 + a] + P[I2.ch_R * 3 + a] + 2 * P[I2.sto * 3 + a]) / 4), ms = [0, 0, 0]; let mw = 0;
    for (let v = 0; v < k; v++) { const p = at(P, B.hv[v]), dd = dist(p, mc); if (dd < 0.030) { for (let a = 0; a < 3; a++) ms[a] += Db[v * 3 + a]; mw++; } }
    if (mw) { for (let a = 0; a < 3; a++) ms[a] /= mw;
      for (let v = 0; v < k; v++) { const w = 1 - sst(0.030, 0.042, dist(at(P, B.hv[v]), mc)); if (w > 0) for (let a = 0; a < 3; a++) Db[v * 3 + a] = Db[v * 3 + a] * (1 - w) + ms[a] * w; } } }
  return { D: Db, eyeShift, z: z.map(x => +x.toFixed(3)), scale: +sp.toFixed(4) };
}
export function applyIdentity(L, B, P, E, n, fld) {
  const k = B.k; let mx = 0, s = 0, c = 0;
  for (let v = 0; v < k; v++) { const g = B.hv[v]; if (g >= n) continue; for (let a = 0; a < 3; a++) P[g * 3 + a] += fld.D[v * 3 + a]; const l = Math.hypot(fld.D[v * 3], fld.D[v * 3 + 1], fld.D[v * 3 + 2]); mx = Math.max(mx, l); if (B.mask[v] > 0.5) { s += l; c++; } }
  const Hh = L.helpers; for (let i = 0; i < Hh.ids.length; i++) { const g = Hh.ids[i]; if (g >= n) continue; for (let a = 0; a < 3; a++) { let d = 0; for (let c = 0; c < 4; c++) d += Hh.w[i * 4 + c] * fld.D[Hh.j[i * 4 + c] * 3 + a]; P[g * 3 + a] += d; } }
  let E2 = E; if (E) { E2 = new Float32Array(E); for (let i = 0; i < E.length / 3; i++) { const s = E[i * 3] > 0 ? fld.eyeShift.L : fld.eyeShift.R; for (let a = 0; a < 3; a++) E2[i * 3 + a] += s[a]; } }
  return { E: E2, maxMm: +(mx * 1000).toFixed(2), meanMm: +(s / Math.max(1, c) * 1000).toFixed(2) };
}

// ---------------------------------------------------------------- 3-4. lips capped, lids lowered (one landmark-held thin-plate warp)
// the caps: c2's lip tables (lipTargets' means, the same group mixing and age rules) + capSd SDs (vermilion) / eCapSd SDs (E-line)
export function lipCaps(sex, group, age, o) {
  const sx = sex === 'm' ? 'm' : 'f', gm = groupMix(group), ageV = Math.max(0, (age ?? 35) - 25) / 10, ageE = Math.max(0, (age ?? 35) - 30) / 10;
  const vm = mixGroups(LIPS.verm[sx], gm), el = mixGroups(LIPS.eline[sx], gm), sd = LIPS.vermSd[sx];
  return { uv: vm[0] - 0.5 * ageV + o.capSd * sd[0], lv: vm[1] - 0.35 * ageV + o.capSd * sd[1], eU: el[0] - 0.4 * ageE + o.eCapSd * LIPS.elineSd[0], eL: el[1] - 0.4 * ageE + o.eCapSd * LIPS.elineSd[1] };
}
export function lidsLipsWarp(F, P, E, side, src, spec, rec, o = {}) {
  const { region, tri, nb, n } = src, I = F.ids, fr = frameOf(F, P), mm = 0.001, rep = {}, extra = [];
  const toBind = d => [0, 1, 2].map(a => (fr.x[a] * d[0] + fr.y[a] * d[1] + fr.z[a] * d[2]) * mm);
  if (spec.lips) { const cols = lipColumns(F, P, nb, region, o.N || null), m = lipMeasures(F, P, cols), cap = lipCaps(rec.sex, rec.group, rec.age, spec.lips);
    // only reduced, at most maxMove mm, and only where the measure is a vermilion's (c2's column picks the most forward point above the
    // meeting line: on a thin or set-back upper lip that is the philtrum's skin, uv reads 12-18 mm; such a column is left alone)
    const mv = spec.lips.maxMove ?? 1.5, sane = m.uv > 3 && m.uv < cap.uv + 3;
    const dU = sane ? Math.max(-mv, Math.min(0, cap.uv - m.uv)) : 0, zU = sane ? Math.max(-mv, Math.min(0, cap.eU - m.eU)) : 0, zL = m.lowerTurn > 1 && m.lowerTurn < 12 ? Math.max(-mv, Math.min(0, cap.eL - m.eL)) : 0, dL = m.lv != null ? Math.min(mv, Math.max(0, m.lv - cap.lv)) : 0;
    // relaxed, not pursed: the lips' midline sits at most relaxMm ahead of the corners (the 'tube' of a pursed or pouting mouth); the
    // excess goes back, at most maxMove, both lips (OUR rule: the pursed reads on judge c9's board were 12-16 mm)
    const cz = 0.5 * (fr.loc(I.ch_L)[2] + fr.loc(I.ch_R)[2]), relaxTo = spec.lips.relaxMm?.[rec.sex === 'm' ? 'm' : 'f'] ?? Infinity, ex = Math.min(mv, Math.max(0, fr.loc(I.ls)[2] - cz - relaxTo));
    const zU2 = Math.min(zU, -ex), zL2 = Math.min(zL, -ex * 0.8);
    rep.lips_relax = { lsAhead: +(fr.loc(I.ls)[2] - cz).toFixed(2), back: +ex.toFixed(2) };
    // the mouth's ARC (FACE4 after the steer, measured on the ten scans with the same metric): how far the lips' midline sits ahead of
    // the corners, over the mouth's width: real heads 0.28-0.43 (mean 0.37); ours 0.23-0.36, and the three that read sour (L06 0.23,
    // L12 0.26, L14 0.26) are the flattest, under every scan: corners too far forward make the lips a flat bar with a bulb in front.
    // The corners (and the modiolus, half) go back by arcGain of the gap to `arc` x the width, at most arcMax mm
    if (spec.lips.arc) { const chw = fr.loc(I.ch_L)[0] - fr.loc(I.ch_R)[0], ahead = fr.loc(I.ls)[2] - cz, back = Math.min(spec.lips.arcMax ?? 3.5, Math.max(0, (spec.lips.arcGain ?? 0.7) * (spec.lips.arc * chw - ahead)));
      if (back > 0.05) { extra.push({ v: I.ch_L, d: [0, 0, -back] }, { v: I.ch_R, d: [0, 0, -back] }); if (I.mm_L != null) extra.push({ v: I.mm_L, d: [0, 0, -0.5 * back] }, { v: I.mm_R, d: [0, 0, -0.5 * back] }); }
      rep.arc = { ratio: +(ahead / chw).toFixed(3), back: +back.toFixed(2) }; }
    for (const c of cols) { if (c.up != null && (dU || zU2)) extra.push({ v: c.up, d: [0, dU * c.w, zU2 * c.w] }); if (c.lo != null && zL2) extra.push({ v: c.lo, d: [0, 0, zL2 * c.w] });
      if (c.bo != null && dL) extra.push({ v: c.bo, d: [0, dL * c.w, 0.3 * dL * c.w + zL2 * c.w] }); }
    if (zU2 < zU && !cols.some(c => c.up === I.ls)) extra.push({ v: I.ls, d: [0, 0, zU2] }); if (zL2 < zL && !cols.some(c => c.lo === I.li)) extra.push({ v: I.li, d: [0, 0, zL2] });
    rep.lips = { before: Object.fromEntries(Object.entries(m).map(([q, x]) => [q, x == null ? null : +x.toFixed(2)])), cap: Object.fromEntries(Object.entries(cap).map(([q, x]) => [q, +x.toFixed(2)])), move: { uv: +dU.toFixed(2), eU: +zU.toFixed(2), eL: +zL.toFixed(2), lv: +(-dL).toFixed(2) } };
    rep.lips.move.relax = rep.lips_relax; delete rep.lips_relax; if (rep.arc) { rep.lips.arc = rep.arc; delete rep.arc; }
    rep._cols = cols; }
  if (spec.lids && E && side) { const m = lidMeasure(F, P, E, side), r = rng((hashStr('face4:lid:' + (spec.name || '')) >>> 0) || 1);
    const t = Math.max(spec.lids.min, mrd1Target({ sex: rec.sex, age: rec.age, group: rec.group }, r) - spec.lids.drop), m2 = lowerLidMeasure(F, P, E, side);
    rep.lids = { target: +t.toFixed(2), before: m && { L: +m.L.toFixed(2), R: +m.R.toFixed(2) }, mrd2Before: m2 && { L: +m2.L.toFixed(2), R: +m2.R.toFixed(2) } };
    for (const s of ['L', 'R']) { const loop = F.lid[s] || []; if (!loop.length || !m) continue;
      const Q = loop.map(v => [v, fr.loc(v)]), cy = Q.reduce((a, [, q]) => a + q[1], 0) / Q.length, xs = Q.map(([, q]) => q[0]), x0 = Math.min(...xs), x1 = Math.max(...xs), xc = 0.5 * (x0 + x1), hw = 0.5 * (x1 - x0);
      // the upper lid: lowered only if asked (drop); raised to `floor` where it sits under the scans' range (MRD1 4.9-7.4 mm by this
      // metric on the ten HSRD-100 heads; ours 2.7-5.1: rev 4's first 1.2 mm drop read sleepy on F39 and F53)
      const d = spec.lids.drop > 0 ? clamp(m[s] - t, 0, 3.5) : spec.lids.floor ? -clamp(spec.lids.floor - m[s], 0, 1.2) : 0, up2 = m2 ? clamp(m2[s] - spec.lids.mrd2, 0, spec.lids.raiseMax ?? 1.2) : 0;
      for (const [v, q] of Q) { const w = Math.max(0.2, 1 - ((q[0] - xc) / hw) ** 2);
        if (q[1] >= cy + 0.5 && Math.abs(d) > 0.05) extra.push({ v, d: [0, -d * w, 0.45 * d * w] });   // the upper margin down (or up), riding the cornea
        else if (q[1] <= cy - 0.5 && up2 > 0.05) extra.push({ v, d: [0, up2 * w, 0.35 * up2 * w] }); } }   // the lower margin up a little
  }
  if (!extra.length) return { P, E, report: rep };
  // landmarks held (a control that is a landmark takes the move), the neck ring held, the eyes still
  const byV = new Map(Object.entries(I).map(([q, v]) => [v, q])), D = {}, ext = [];
  for (const e of extra) { const d = toBind(e.d), q = byV.get(e.v); if (q) { const o2 = D[q] || [0, 0, 0]; for (let a = 0; a < 3; a++) o2[a] += d[a]; D[q] = o2; } else ext.push({ v: e.v, d }); }
  const zone = headZone(F, P, region, n, nb), W = buildWarp(F, P, zone, { D, extra: ext }), r = applyWarp(F, W, P, E, zone, { L: [0, 0, 0], R: [0, 0, 0] }, n);
  if (rep.lips) { rep.lips.after = Object.fromEntries(Object.entries(lipMeasures(F, r.P, rep._cols)).map(([q, x]) => [q, x == null ? null : +x.toFixed(2)])); }
  delete rep._cols;
  if (rep.lids) { const m = lidMeasure(F, r.P, E, side), m2 = lowerLidMeasure(F, r.P, E, side); rep.lids.after = m && { L: +m.L.toFixed(2), R: +m.R.toFixed(2) }; rep.lids.mrd2After = m2 && { L: +m2.L.toFixed(2), R: +m2.R.toFixed(2) }; }
  return { P: r.P, E: r.E || E, report: rep };
}
// MRD2: the pupil's centre down to the lower lid margin (pi), mm
export function lowerLidMeasure(F, P, E, side) {
  if (!E || !side) return null; const fr = frameOf(F, P), I = F.ids, py = [];
  for (const s of [1, 0]) { let zmax = -Infinity; for (let i = 0; i < side.length; i++) if (side[i] === s) zmax = Math.max(zmax, E[i * 3 + 2]);
    let y = 0, c = 0; for (let i = 0; i < side.length; i++) if (side[i] === s && E[i * 3 + 2] > zmax - 0.006) { const d = [E[i * 3] - fr.o[0], E[i * 3 + 1] - fr.o[1], E[i * 3 + 2] - fr.o[2]]; y += (d[0] * fr.y[0] + d[1] * fr.y[1] + d[2] * fr.y[2]) * 1000; c++; }
    py.push(y / c); }
  return { L: py[0] - fr.loc(I.pi_L)[1], R: py[1] - fr.loc(I.pi_R)[1] };
}

// ---------------------------------------------------------------- the mouth's read (tests and reports): is it level, lifted or turned down?
// corner: the corners' height over the stomion (frame mm); droop: the lips' meeting line at 0.8 of the half-width against its midline
// (negative = the line turns down toward the corners: the 'sour' read); width ch-ch; the lips' measures (c2's columns)
export function mouthRead(F, P, nb, expr) {
  const I = F.ids, fr = frameOf(F, P), sto = fr.loc(I.sto), cl = fr.loc(I.ch_L), cr = fr.loc(I.ch_R), half = Math.abs(cl[0] - cr[0]) / 2;
  const ao = expr ? expr('mouth-open') : null; let droop = null;
  if (ao) { const line = xc => { let yU = Infinity; for (let v = 0; v < nb; v++) { const d = ao[v * 3 + 1]; if (d <= -0.004) continue; const q = fr.loc(v); if (Math.abs(Math.abs(q[0]) - xc) > 1.2 || q[2] < sto[2] - 5 - 0.5 * xc || q[1] < sto[1] - 4 || q[1] > sto[1] + 5) continue; yU = Math.min(yU, q[1]); } return yU; };
    const y0 = line(0), y8 = line(0.8 * half); if (isFinite(y0) && isFinite(y8)) droop = +(y8 - y0).toFixed(2); }
  return { corner: +(0.5 * (cl[1] + cr[1]) - sto[1]).toFixed(2), droop, chch: +(2 * half).toFixed(2) };
}
