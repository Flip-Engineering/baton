// ANATOMY / SOFT: THE SOFT-TISSUE SOLVER (ANAT8-BODY, 8 Oct 2026, lane iteration 8 = c3 iteration 1; NOTES.md iteration 8, S1-S7). The house's first
// volumetric XPBD: soft tissue (fat, gland, later relaxed muscle) as tetrahedra, hung on the deep fascia through sliding layers, tethered by ligaments,
// wrapped in a skin membrane, loaded by gravity from its unloaded reference (the gravity-free shape the anatomy builds), solved to static equilibrium.
// Node-side, baked per person; the page never runs it. Generic across regions: the breast (soft/breast.js, ANAT8-BODY), the hips, waist, groin and
// buttocks (ANAT8-PELVIS: lib/fx/anatomy/pelvis/), the face's fat pads (ANAT8-HEAD). Opt-in: nothing outside the anatomy lanes imports it.
//
//   import { buildSoft, solveSoft } from '.../lib/fx/anatomy/soft/index.js';
//   const S = buildSoft(R)                      // the tets, the embedding, the constraints (deterministic)
//   const L = solveSoft(S, { dt, maxTime, damping, tol, log })
// R (the region; the API agreed with ANAT8-PELVIS, NOTES.md iteration 8 S5):
//   { name, h,                                   the tet grid's spacing (m)
//     frame: { O, ax: [e1, e2, e3] },            the grid's frame (default the bind identity); box: [u0, v0, w0, u1, v1, w1] in that frame
//     fieldF(u, v, w) -> { d, comp, label }      the region's composed field IN THE FRAME (d < 0 inside the tissue; comp the compartment index; label of
//                                                the nearest boundary: 'skin' | 'base' | 'cut' | ...). Must be cheap (sample SDF parts to a grid first).
//     compartments: [{ name, kind, mat: { E (Pa), nu, rho (kg/m3) } }],
//     solids: { dg(x, y, z, g) -> d }            the deep boundary (bone + muscle; kinematic in v1): signed distance and its unit gradient written to g
//     interfaces: [{ label, kind: 'sliding' | 'bonded' | 'free', G (Pa), t (m), kn (Pa/m) }]   surface points of that label on the deep fascia
//     membranes: [{ name, label, E (Pa), t (m), laxity, compress, tension, bend, nu }]   edge springs on the fine surface's triangles of that label;
//                                                tension: 'field' (ANAT8-PELVIS, lane iteration 16) = a TENSION-FIELD membrane: no compressive stiffness
//                                                (compress ignored); bend: true (D = E t^3 / (12 (1 - nu^2)), nu default 0.5) or D (N m) = a bending
//                                                term on the same triangles' hinges, so a compressed skin BUCKLES (folds, creases) at the wavelength its
//                                                bending and the tissue under it set, instead of shortening (see WRINKLING below)
//     tethers: [{ name, kind, skin: [[x,y,z]...], anchor: [[x,y,z]...], k (N/m each, or an array per point), slack, give }]   unilateral, rest = reference
//                                                length x (1 + slack); kind 'bound' (lane iteration 15, ANAT8-PELVIS's ask): a ZONE OF ADHERENCE, the skin
//                                                point held to its own REST position within `give` (m; anchor ignored: the deep fascia is kinematic)
//     colliders: [{ name, dg(x, y, z, g) -> d, applies(p0) -> bool, margin }]   points (surface, by reference position) kept outside
//     cuts: [{ p, n, kind: 'held' }]             region boundary planes (n outward): grid nodes within 0.75 h held
//     gravity: [0, -9.81, 0], track: [{ name, p }], surfH (the fine surface's spacing, default h / 2) }
// Discretisation (S2): a regular grid in the frame, each ACTIVE cell (tissue in it, or a surface vertex) split into 5 tets (alternating parity: the
// faces' diagonals agree), the cell's tissue fraction (27 samples) scaling its tets' mass and stiffness (EMBEDDED / immersed: no slivers at grazing
// boundaries; a layer 1-2 cells thick still works). The fine surface (surface nets of the field, layer/grid.js) and the tracked points are EMBEDDED in the
// tets by barycentric weights; constraints on them distribute over the four nodes (generalised inverse mass sum_k w_k b_k^2).
// Material (S3): stable Neo-Hookean tets, Macklin and Mueller 2021 ('A constraint-based formulation of stable Neo-Hookean materials', MIG 2021):
// C_D = sqrt(tr F^T F), alpha_D = 1 / (mu V); C_H = det F - (1 + mu / lambda), alpha_H = 1 / (lambda V); XPBD (Macklin, Mueller and Chentanez 2016) with
// ONE iteration a substep and many substeps (Macklin et al. 2019, 'Small steps'), as lib/fx/cloth/xpbd.js (the house cloth solver: learned from, not
// edited); velocity damping; run to static equilibrium. Units: metres, kilograms, seconds, pascals.
import { makeField, surfaceNets } from '../layer/grid.js';
export const SOFT_VERSION = 1;   // (16 Oct, ANAT8-PELVIS) membranes[].tension / .bend are ADDITIVE: a membrane without them solves exactly as before, so the version (in the breast's bake key) is unchanged
const sqrt = Math.sqrt, abs = Math.abs, floor = Math.floor;

// the 5-tet split of a cube; corners c = bx + 2 by + 4 bz; even cells: the four corner tets at the even corners + the central tet of the odd ones; odd
// cells the mirror (so neighbouring cells' face diagonals agree)
const TET5 = [[[0, 1, 2, 4], [3, 1, 2, 7], [5, 1, 4, 7], [6, 2, 4, 7], [1, 2, 4, 7]], [[1, 0, 3, 5], [2, 0, 3, 6], [4, 0, 5, 6], [7, 3, 5, 6], [0, 3, 5, 6]]];

export function buildSoft(R, opts = {}) {
  const t0 = Date.now(), h = R.h, fr = R.frame || { O: [0, 0, 0], ax: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }, [e1, e2, e3] = fr.ax, O = fr.O;
  const [u0, v0, w0, u1, v1, w1] = R.box, nx = Math.ceil((u1 - u0) / h), ny = Math.ceil((v1 - v0) / h), nz = Math.ceil((w1 - w0) / h);
  const toW = (u, v, w) => [O[0] + e1[0] * u + e2[0] * v + e3[0] * w, O[1] + e1[1] * u + e2[1] * v + e3[1] * w, O[2] + e1[2] * u + e2[2] * v + e3[2] * w];
  const toF = p => { const x = p[0] - O[0], y = p[1] - O[1], z = p[2] - O[2]; return [x * e1[0] + y * e1[1] + z * e1[2], x * e2[0] + y * e2[1] + z * e2[2], x * e3[0] + y * e3[1] + z * e3[2]]; };
  const nC = R.compartments.length;
  // 1. cell fractions and compartments (27 samples a cell)
  const ncell = nx * ny * nz, frac = new Float32Array(ncell), ccomp = new Int16Array(ncell), cnt = new Float32Array(nC);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let inside = 0; cnt.fill(0);
    { const q = R.fieldF(u0 + (i + 0.5) * h, v0 + (j + 0.5) * h, w0 + (k + 0.5) * h), id = (k * ny + j) * nx + i;   // far from the boundary (the field ~1-Lipschitz): all or nothing
      if (q.d > 0.9 * h) { frac[id] = 0; continue; } if (q.d < -0.9 * h) { frac[id] = 1; ccomp[id] = q.comp || 0; continue; } }
    for (let c = 0; c < 27; c++) { const a = c % 3, b = floor(c / 3) % 3, g = floor(c / 9), q = R.fieldF(u0 + (i + (a + 0.5) / 3) * h, v0 + (j + (b + 0.5) / 3) * h, w0 + (k + (g + 0.5) / 3) * h);
      if (q.d < 0) { inside++; cnt[q.comp || 0]++; } }
    const id = (k * ny + j) * nx + i; frac[id] = inside / 27; let best = 0; for (let m = 1; m < nC; m++) if (cnt[m] > cnt[best]) best = m; ccomp[id] = best;
  }
  // 2. the fine surface (surface nets of the field sampled at surfH in the frame), its labels; the cells holding a vertex are active too
  const hs = R.surfH || h / 2, sx = Math.ceil((u1 - u0) / hs) + 1, sy = Math.ceil((v1 - v0) / hs) + 1, sz = Math.ceil((w1 - w0) / hs) + 1, Fs = new Float32Array(sx * sy * sz);
  for (let k = 0; k < sz; k++) for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) Fs[(k * sy + j) * sx + i] = R.fieldF(u0 + i * hs, v0 + j * hs, w0 + k * hs).d;
  const M = surfaceNets(makeField(Fs, [sx, sy, sz], [u0, v0, w0], hs)), nv = M.pos.length / 3, labels = [...new Set(['skin', 'base', 'cut'])], vlab = new Int16Array(nv), labIdx = {};
  const labOf = s => { if (!(s in labIdx)) { labIdx[s] = labels.indexOf(s) >= 0 ? labels.indexOf(s) : labels.push(s) - 1; } return labIdx[s]; };
  const cellOf = (u, v, w) => { const i = Math.min(nx - 1, Math.max(0, floor((u - u0) / h))), j = Math.min(ny - 1, Math.max(0, floor((v - v0) / h))), k = Math.min(nz - 1, Math.max(0, floor((w - w0) / h))); return [i, j, k]; };
  const forced = new Uint8Array(ncell);
  for (let v = 0; v < nv; v++) { const u = M.pos[v * 3], vv = M.pos[v * 3 + 1], w = M.pos[v * 3 + 2]; vlab[v] = labOf(R.fieldF(u, vv, w).label || 'skin'); const [i, j, k] = cellOf(u, vv, w); forced[(k * ny + j) * nx + i] = 1; }
  const trackF = (R.track || []).map(t => toF(t.p)); for (const q of trackF) { const [i, j, k] = cellOf(...q); forced[(k * ny + j) * nx + i] = 1; }
  // 3. nodes and tets of the active cells
  const nodeId = new Int32Array((nx + 1) * (ny + 1) * (nz + 1)).fill(-1), X0 = [], tets = [], tfrac = [], tcomp = [], cellTet = new Int32Array(ncell).fill(-1);
  const nid = (i, j, k) => { const g = (k * (ny + 1) + j) * (nx + 1) + i; if (nodeId[g] < 0) { nodeId[g] = X0.length / 3; X0.push(...toW(u0 + i * h, v0 + j * h, w0 + k * h)); } return nodeId[g]; };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const id = (k * ny + j) * nx + i; if (!(frac[id] > 0) && !forced[id]) continue;
    const cn = [0, 1, 2, 3, 4, 5, 6, 7].map(c => nid(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))), par = (i + j + k) & 1;
    cellTet[id] = tets.length / 4;
    for (const T of TET5[par]) { tets.push(cn[T[0]], cn[T[1]], cn[T[2]], cn[T[3]]); tfrac.push(Math.max(frac[id], 0.05)); tcomp.push(ccomp[id]); }
  }
  const nN = X0.length / 3, nT = tets.length / 4, X = Float64Array.from(X0), TT = Int32Array.from(tets), TF = Float32Array.from(tfrac), TC = Int16Array.from(tcomp);
  // rest matrices, volumes, masses, compliances
  const DmInv = new Float64Array(nT * 9), Vol = new Float64Array(nT), mass = new Float64Array(nN), aD = new Float64Array(nT), aH = new Float64Array(nT), gam = new Float64Array(nT);
  for (let t = 0; t < nT; t++) {
    let a = TT[t * 4], b = TT[t * 4 + 1], c = TT[t * 4 + 2], d = TT[t * 4 + 3];
    let m00 = X[b * 3] - X[a * 3], m10 = X[b * 3 + 1] - X[a * 3 + 1], m20 = X[b * 3 + 2] - X[a * 3 + 2], m01 = X[c * 3] - X[a * 3], m11 = X[c * 3 + 1] - X[a * 3 + 1], m21 = X[c * 3 + 2] - X[a * 3 + 2];
    let m02 = X[d * 3] - X[a * 3], m12 = X[d * 3 + 1] - X[a * 3 + 1], m22 = X[d * 3 + 2] - X[a * 3 + 2];
    let det = m00 * (m11 * m22 - m12 * m21) - m01 * (m10 * m22 - m12 * m20) + m02 * (m10 * m21 - m11 * m20);
    if (det < 0) { TT[t * 4 + 2] = d; TT[t * 4 + 3] = c; [m01, m02] = [m02, m01]; [m11, m12] = [m12, m11]; [m21, m22] = [m22, m21]; det = -det; }
    const id = 1 / det, o = t * 9;
    DmInv[o] = (m11 * m22 - m12 * m21) * id; DmInv[o + 1] = (m02 * m21 - m01 * m22) * id; DmInv[o + 2] = (m01 * m12 - m02 * m11) * id;
    DmInv[o + 3] = (m12 * m20 - m10 * m22) * id; DmInv[o + 4] = (m00 * m22 - m02 * m20) * id; DmInv[o + 5] = (m02 * m10 - m00 * m12) * id;
    DmInv[o + 6] = (m10 * m21 - m11 * m20) * id; DmInv[o + 7] = (m01 * m20 - m00 * m21) * id; DmInv[o + 8] = (m00 * m11 - m01 * m10) * id;
    // muScale: the RELAXED shear modulus under a sustained load (the bulk modulus, lambda, unchanged: tissue stays nearly incompressible however far its
    // shear relaxes)
    const V = det / 6, f = TF[t], mat = R.compartments[TC[t]].mat, mu = mat.E / (2 * (1 + mat.nu)) * (mat.muScale ?? 1), lam = mat.E * mat.nu / ((1 + mat.nu) * (1 - 2 * mat.nu));
    Vol[t] = V; aD[t] = 1 / (mu * V * f); aH[t] = 1 / (lam * V * f); gam[t] = 1 + mu / lam;
    const mq = mat.rho * V * f / 4; for (let q = 0; q < 4; q++) mass[TT[t * 4 + q]] += mq;
  }
  // R.massFloor (opt-in; v1 none): the 'small cut cell' cure of embedded methods: a node whose tissue is a sliver (a cell 5 % full) is nearly massless, and the
  // skin's and the contacts' stiff constraints on it chatter (lane iteration 9: one 0.03 g node at 245 mm/s held the solve open). Its INERTIAL mass is floored
  // at massFloor x a full cell's node mass; gravity acts on the true mass only (gS = m / m_inertial), so the load is unchanged and only the dynamics are.
  const gS = new Float64Array(nN).fill(1);
  if (R.massFloor > 0) { const full = Math.max(...R.compartments.map(c => c.mat.rho)) * h * h * h, mf = R.massFloor * full;   // an interior grid node's mean mass (8 cells share a node)
    for (let n = 0; n < nN; n++) if (mass[n] > 0 && mass[n] < mf) { gS[n] = mass[n] / mf; mass[n] = mf; } }
  const invM = new Float64Array(nN); for (let n = 0; n < nN; n++) invM[n] = mass[n] > 0 ? 1 / mass[n] : 0;
  // held nodes (the cuts)
  let held = 0; for (const c of R.cuts || []) if (c.kind === 'held') for (let n = 0; n < nN; n++) {
    const s = (X[n * 3] - c.p[0]) * c.n[0] + (X[n * 3 + 1] - c.p[1]) * c.n[1] + (X[n * 3 + 2] - c.p[2]) * c.n[2]; if (s >= -0.75 * h && invM[n] > 0) { invM[n] = 0; held++; } }
  // 4. the embedding: a point in the frame -> its cell's tet -> barycentric weights (clamped into the tet when a point sits a hair outside)
  const embed = (pF, out, o) => {
    const [i, j, k] = cellOf(...pF), id = (k * ny + j) * nx + i, t0c = cellTet[id]; if (t0c < 0) return -1;
    const p = toW(...pF); let best = -1, bestMin = -Infinity, bw = null;
    for (let t = t0c; t < t0c + 5; t++) { const w = bary(X, TT, DmInv, t, p), mn = Math.min(w[0], w[1], w[2], w[3]); if (mn > bestMin) { bestMin = mn; best = t; bw = w; } }
    let s = 0; for (let q = 0; q < 4; q++) { bw[q] = Math.max(0, bw[q]); s += bw[q]; } for (let q = 0; q < 4; q++) out[o + q] = bw[q] / s; return best;
  };
  const embT = new Int32Array(nv), embW = new Float64Array(nv * 4), pos0 = new Float64Array(nv * 3);
  for (let v = 0; v < nv; v++) { const pF = [M.pos[v * 3], M.pos[v * 3 + 1], M.pos[v * 3 + 2]], p = toW(...pF); pos0[v * 3] = p[0]; pos0[v * 3 + 1] = p[1]; pos0[v * 3 + 2] = p[2]; embT[v] = embed(pF, embW, v * 4); }
  const trk = (R.track || []).map((t, m) => { const W4 = new Float64Array(4), tt = embed(trackF[m], W4, 0); return { name: t.name, t: tt, w: W4, p0: t.p.slice() }; });
  // embed an arbitrary world point (the tethers' skin ends): the nearest fine-surface vertex of a label when asked (so a tether pulls the skin), else its own cell
  const nearestV = (p, lab) => { let b = -1, bd = Infinity; for (let v = 0; v < nv; v++) { if (lab != null && vlab[v] !== lab) continue; const dx = pos0[v * 3] - p[0], dy = pos0[v * 3 + 1] - p[1], dz = pos0[v * 3 + 2] - p[2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; b = v; } } return b; };
  // 5. constraints on embedded points
  const skinLab = labOf('skin'), cons = { base: [], memb: [], teth: [], coll: [], hinge: [] };
  for (const I of R.interfaces || []) { const L = labOf(I.label); const kt = I.kind === 'sliding' ? I.G / I.t : I.kind === 'bonded' ? 1e7 : 0, kn = I.kn ?? 1e7; if (I.kind === 'free') continue;
    const area = vertexAreas(pos0, M.idx, nv);
    for (let v = 0; v < nv; v++) if (vlab[v] === L && embT[v] >= 0) cons.base.push({ v, p0: [pos0[v * 3], pos0[v * 3 + 1], pos0[v * 3 + 2]], aT: 1 / (kt * Math.max(area[v], 1e-7)), aN: 1 / (kn * Math.max(area[v], 1e-7)) }); }
  let membInfo = [];
  for (const Mb of R.membranes || []) { const L = labOf(Mb.label), Y = Mb.E * Mb.t, E = new Map(), triA = [], tf = Mb.tension === 'field';
    for (let f = 0; f < M.idx.length; f += 3) { const a = M.idx[f], b = M.idx[f + 1], c = M.idx[f + 2]; if (vlab[a] !== L || vlab[b] !== L || vlab[c] !== L) continue;
      const A = triArea3(pos0, a, b, c); for (const [p, q] of [[a, b], [b, c], [c, a]]) { const key = p < q ? p * nv + q : q * nv + p; E.set(key, (E.get(key) || 0) + A / 3); } triA.push(A); }
    let ne = 0; for (const [key, Ae] of E) { const p = floor(key / nv), q = key % nv; if (embT[p] < 0 || embT[q] < 0) continue; const L0 = dist3(pos0, p, q); if (L0 < 1e-5) continue;
      const k = 3 * Y * Ae / (L0 * L0), Lr = L0 * (1 + (Mb.laxity || 0)), lock = Mb.lock ?? Infinity, k2 = Mb.Elin ? 3 * Mb.Elin * Mb.t * Ae / (L0 * L0) : k;
      // Mb.beta (lane iteration 11): a SMOOTH strain-stiffening (Fung-type exponential) tension, f = (k Lr / beta) (exp(beta e) - 1), e = (l - Lr) / Lr: the
      // small-strain stiffness k (from E) stiffening without a corner (the tangent k exp(beta e)); solved as the energy U(l) = int f dl (memb.fung below).
      // Otherwise a J-curve (bilinear): the toe (E) to the lock strain, then the linear region (Elin), continuous: beyond the lock C = l - Leff, Leff = Lr (1 + lock) - (k / k2) Lr lock
      const aC = tf ? Infinity : (Mb.compress ?? 10) / k;   // a tension field: a compressed edge carries nothing (the skin buckles; WRINKLING below)
      if (Mb.beta > 0) cons.memb.push({ a: p, b: q, L: Lr, k, beta: Mb.beta, aT: 1 / k, aC, Llock: Infinity });
      else cons.memb.push({ a: p, b: q, L: Lr, aT: 1 / k, aC, Llock: Lr * (1 + lock), Leff: Lr * (1 + lock) - (k / k2) * Lr * lock, aL: 1 / k2 }); ne++; }
    const D = Mb.bend === true ? Mb.E * Mb.t ** 3 / (12 * (1 - (Mb.nu ?? 0.5) ** 2)) : +Mb.bend || 0, nh = D > 0 ? buildHinges(cons.hinge, M.idx, pos0, vlab, L, embT, D) : 0;
    membInfo.push({ name: Mb.name, edges: ne, Y, ...(Mb.beta > 0 ? { law: 'fung', beta: Mb.beta } : { law: 'jcurve', Ylin: Mb.Elin ? Mb.Elin * Mb.t : null, lock: Mb.lock ?? null }), areaCm2: +(triA.reduce((s, a) => s + a, 0) * 1e4).toFixed(0),
      ...(tf ? { tension: 'field' } : { compress: Mb.compress ?? 10 }), ...(D > 0 ? { bendNm: +D.toExponential(3), hinges: nh, wrinkleMm: wrinkleOf(Mb, R) } : {}) }); }
  // 'bound' (lane iteration 15): a unilateral DISTANCE to an anchor on the deep fascia stops the skin lifting but lets it slide almost freely along the
  // fascia (a point on a sphere round its anchor: the stretch is second order in the slide; ANAT8-PELVIS iteration 3 found it, pelvis/index.js boundSkin);
  // a zone of adherence (dense septa from the dermis to the deep fascia) holds the skin against sliding as much as against lifting: its anchor is the skin
  // point's own rest position (the deep fascia is kinematic here, so a point fixed relative to it is fixed in space), its rest length the septa's give
  for (const T of R.tethers || []) for (let m = 0; m < T.skin.length; m++) { const v = nearestV(T.skin[m], skinLab); if (v < 0 || embT[v] < 0) continue;
    const p = [pos0[v * 3], pos0[v * 3 + 1], pos0[v * 3 + 2]], k = Array.isArray(T.k) ? T.k[m] : T.k;
    if (T.kind === 'bound') { const g = T.give ?? 0.001; cons.teth.push({ name: T.name, v, a: p.slice(), L: g, L0: g, alpha: 1 / k, bound: true }); continue; }
    const a = T.anchor[m], L0 = Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]); cons.teth.push({ name: T.name, v, a: a.slice(), L: L0 * (1 + (T.slack || 0)), L0, alpha: 1 / k }); }
  for (const C of R.colliders || []) for (let v = 0; v < nv; v++) if (embT[v] >= 0 && C.applies([pos0[v * 3], pos0[v * 3 + 1], pos0[v * 3 + 2]], R.labels ? R.labels[vlab[v]] : labels[vlab[v]])) cons.coll.push({ v, C, margin: C.margin || 0 });
  const st = meshVol(pos0, M.idx);
  const info = { version: SOFT_VERSION, grid: [nx, ny, nz], h, cells: cellTet.reduce((s, c) => s + (c >= 0 ? 1 : 0), 0), nodes: nN, tets: nT, held, surfVerts: nv, surfTris: M.idx.length / 3,
    labels: labels.map((l, i) => ({ l, n: vlab.reduce((s, x) => s + (x === i ? 1 : 0), 0) })), base: cons.base.length, membranes: membInfo, tethers: cons.teth.length, colliders: cons.coll.length,
    massKg: +mass.reduce((s, m, n) => s + m * gS[n], 0).toFixed(4), ...(R.massFloor > 0 ? { massFloor: R.massFloor, massFloored: gS.reduce((s, g) => s + (g < 1 ? 1 : 0), 0) } : {}), tissueCm3: +(Vol.reduce((s, V, t) => s + V * (TF[t] > 0.05 ? TF[t] : 0), 0) * 1e6).toFixed(1), surfVolCm3: +(abs(st.volume) * 1e6).toFixed(1), openEdges: st.open, ms: Date.now() - t0 };
  return { R, X0: Float64Array.from(X0), X, TT, TF, TC, DmInv, Vol, aD, aH, gam, invM, mass, gS, surf: { pos0, tri: M.idx, label: vlab, labels, embT, embW }, trk, cons, toW, toF, info };
}

// GROWTH (lane iteration 14): a tissue's rest state grown in place, the multiplicative split F = Fe Fg with an isotropic growth Fg = g I (Rodriguez, Hoger
// and McCulloch 1994, J Biomech 27:455: 'Stress-dependent finite growth in soft elastic tissues'): each tet's rest matrix x g (DmInv / g), its rest volume
// x g^3 (the compliances 1 / (mu V), 1 / (lambda V) / g^3), its mass x g^3 (grown tissue of the same density); the embedded surface and the tracked points
// ride the tets as before (their barycentric weights do not change). g: a number for every tet, or a function (compartment name, tet) -> g. setGrowth(S, 1)
// restores the built rest state exactly. Used by soft/breast.js v7 for the breast's load history (the lactating gland); generic (a fat depot's gain, a
// muscle's hypertrophy).
export function setGrowth(S, g) {
  const nT = S.TF.length, nN = S.invM.length, R = S.R;
  if (!S.rest0) S.rest0 = { DmInv: Float64Array.from(S.DmInv), Vol: Float64Array.from(S.Vol), VolM: Float64Array.from(S.Vol), aD: Float64Array.from(S.aD), aH: Float64Array.from(S.aH), invM: Float64Array.from(S.invM), mass: Float64Array.from(S.mass), gS: Float64Array.from(S.gS) };
  const Z = S.rest0, gOf = typeof g === 'function' ? t => g(R.compartments[S.TC[t]].name, t) : () => g, mt = new Float64Array(nN);
  let grown = 0, dV = 0;
  for (let t = 0; t < nT; t++) { const gt = gOf(t) || 1, g3 = gt * gt * gt, o = t * 9;
    for (let q = 0; q < 9; q++) S.DmInv[o + q] = Z.DmInv[o + q] / gt;
    S.Vol[t] = Z.Vol[t] * g3; S.aD[t] = Z.aD[t] / g3; S.aH[t] = Z.aH[t] / g3; if (gt !== 1) { grown++; dV += Z.Vol[t] * (g3 - 1) * (S.TF[t] > 0.05 ? S.TF[t] : 0); }
    const mq = R.compartments[S.TC[t]].mat.rho * Z.VolM[t] * g3 * S.TF[t] / 4; for (let q = 0; q < 4; q++) mt[S.TT[t * 4 + q]] += mq; }   // the mass by the BUILT volume (creep re-forms tissue, it does not add any)
  // the inertial mass and its floor as buildSoft's (R.massFloor); held and massless nodes stay held
  const mf = R.massFloor > 0 ? R.massFloor * Math.max(...R.compartments.map(c => c.mat.rho)) * R.h * R.h * R.h : 0;
  for (let n = 0; n < nN; n++) { const m = mt[n], mi = mf > 0 && m > 0 && m < mf ? mf : m; S.mass[n] = mi; S.gS[n] = mi > 0 ? m / mi : 1; S.invM[n] = Z.invM[n] === 0 ? 0 : mi > 0 ? 1 / mi : 0; }
  return { grownTets: grown, dVcm3: +(dV * 1e6).toFixed(1), massKg: +mt.reduce((s, m) => s + m, 0).toFixed(4) };
}

// CREEP OF THE TISSUE (lane iteration 14): a sustained load's deformation partly RETAINED in the rest state (multiplicative plasticity F = Fe Fp; the retained
// part Fp = I + c (Fe - I), linearised): each tet's (ungrown) rest edge matrix Dm0' = (1 - c) Dm0 + c Ds / g, Ds its current edges, g its current growth; the
// sliding interfaces' rest points move by c x their slide (the loose layer remodels where it was held displaced). c: a number or a function (compartment name)
// -> c (0 = no creep). The masses do not change (the same material, re-formed); the current growth is re-applied. Generic: any soft region's load history.
// (lane iteration 15: the tethers too: a bound zone of adherence's anchor moves by c x its slide, a distance tether's rest length by c x its stretch.)
export function tissueCreep(S, c, g = 1, P = null) {
  if (!S.rest0) setGrowth(S, 1);
  const Z = S.rest0, nT = S.TF.length, X = S.X, TT = S.TT, R = S.R, cOf = typeof c === 'function' ? t => c(R.compartments[S.TC[t]].name) : () => c, gOf = typeof g === 'function' ? t => g(R.compartments[S.TC[t]].name) : () => g;
  const M = new Float64Array(9), sets = []; let n = 0;
  for (let t = 0; t < nT; t++) { const ct = cOf(t) || 0; if (!(ct > 0)) continue; const gt = gOf(t) || 1, o = t * 9, a = TT[t * 4];
    // Dm0 = inverse of the stored DmInv; Ds the current edges (columns b - a, c - a, d - a)
    const Di = Z.DmInv.subarray(o, o + 9), D0 = inv3(Di);
    for (let k = 0; k < 3; k++) { const q = TT[t * 4 + 1 + k]; for (let r = 0; r < 3; r++) M[r * 3 + k] = (1 - ct) * D0[r * 3 + k] + ct * (X[q * 3 + r] - X[a * 3 + r]) / gt; }
    const det = det3(M); if (!(det > 1e-15)) continue;   // never creep a tet into inversion
    const Mi = inv3(M), V0 = Z.Vol[t], V1 = det / 6; for (let q = 0; q < 9; q++) Z.DmInv[o + q] = Mi[q];
    Z.Vol[t] = V1; Z.aD[t] *= V0 / V1; Z.aH[t] *= V0 / V1; sets.push(V1 / V0 - 1); n++; }
  // the sliding layers' rest points (bonded ones barely slide; their creep is the same rule)
  let ni = 0; if (P) { const q = [0, 0, 0]; for (const cn of S.cons.base) { const v = cn.v, cv = typeof c === 'function' ? c('interface') : c; if (!(cv > 0)) continue;
    for (let k = 0; k < 3; k++) cn.p0[k] += cv * (P[v * 3 + k] - cn.p0[k]); ni++; } }
  // the tethers (lane iteration 15): a bound zone of adherence keeps c of its slide (its anchor moves toward the loaded skin point, as a sliding layer's rest
  // point); a distance tether keeps c of its stretch (rest length x (1 + c e))
  let nt = 0; if (P) for (const cn of S.cons.teth) { const cv = typeof c === 'function' ? c('tether') : c; if (!(cv > 0)) continue; const v = cn.v;
    if (cn.bound) { for (let k = 0; k < 3; k++) cn.a[k] += cv * (P[v * 3 + k] - cn.a[k]); nt++; continue; }
    const l = Math.hypot(P[v * 3] - cn.a[0], P[v * 3 + 1] - cn.a[1], P[v * 3 + 2] - cn.a[2]), e = l / cn.L - 1; if (e > 0) { cn.L *= 1 + cv * e; nt++; } }
  setGrowth(S, g);   // re-apply the current growth over the crept rest state (the masses re-derived: unchanged)
  sets.sort((x, y) => x - y); return { tets: n, interfacePts: ni, tethers: nt, restVolChangePct: { p5: sets.length ? +(sets[Math.floor(0.05 * sets.length)] * 100).toFixed(2) : 0, p50: sets.length ? +(sets[Math.floor(0.5 * sets.length)] * 100).toFixed(2) : 0, p95: sets.length ? +(sets[Math.floor(0.95 * sets.length)] * 100).toFixed(2) : 0 } };
}
// SKIN GROWTH (lane iteration 16): skin held stretched past its PHYSIOLOGICAL LIMIT grows new area (mitosis and collagen synthesis) until its elastic stretch
// is back at that limit, and the growth is irreversible: Zoellner, Buganza Tepole and Kuhl 2012 (J Theor Biol 297:166, PMC3278515): the area growth evolves
// by phi = <theta_e - theta_crit> (Macaulay brackets), theta_crit = 1.21 'corresponding to uniaxial stretches of 10 %', 'the physiological threshold value, to
// which the elastic area stretch tends to return during adaptive skin growth'; the model's acute and chronic elastic stretches of expanded skin 25 % and 10 %
// against 36 % and 10 % measured; upon the expander's removal the elastic stretch retracts to 1 and the grown area stays. The model: Buganza Tepole, Ploch,
// Wong, Gosain and Kuhl 2011 (J Mech Phys Solids 59:2177); growth larger along the larger stretch: Buganza Tepole et al. 2015 (Biomech Model Mechanobiol
// 14:1007). Discrete, on the membrane's edges (each edge's own stretch standing in for the area's: the anisotropic reading), at the growth's EQUILIBRIUM (a
// load held for months or years, many adaptation times): 'grow': rest L <- max(L, l / lamCrit), only the over-stretched edges; 'expanded': the CHRONIC state
// of skin EXPANDED IN PLACE by a content that grew under it (an expander; the breast's own gland at puberty): its elastic stretch at the limit, L <- l / lamCrit
// both ways (it grew as much as the expansion demanded and no more), on the share w(p0) in [0, 1] of the skin the content expanded (o.where: the edge's
// reference midpoint -> w; L <- L + w (target - L)). P: the loaded surface positions (S's constraints edited in place). Generic: any region's skin.
export function skinGrowth(S, P, o = {}) {
  const lam = o.lamCrit ?? 1.10, mode = o.mode || 'grow', iL = S.surf.labels.indexOf(o.label || 'skin'), lab = S.surf.label, P0 = S.surf.pos0, where = o.where || null, st = [], ch = [];
  for (const m of S.cons.memb) { if (lab[m.a] !== iL || lab[m.b] !== iL) continue;
    const w = where ? where([(P0[m.a * 3] + P0[m.b * 3]) / 2, (P0[m.a * 3 + 1] + P0[m.b * 3 + 1]) / 2, (P0[m.a * 3 + 2] + P0[m.b * 3 + 2]) / 2]) : 1; if (!(w > 0)) continue;
    const l = Math.hypot(P[m.a * 3] - P[m.b * 3], P[m.a * 3 + 1] - P[m.b * 3 + 1], P[m.a * 3 + 2] - P[m.b * 3 + 2]), T = l / lam; st.push(l / m.L - 1);
    if (mode === 'grow' && T <= m.L) continue;
    const Ln = m.L + Math.min(1, w) * (T - m.L), f = Ln / m.L; if (Math.abs(f - 1) < 1e-9) continue;
    m.L = Ln; if (Number.isFinite(m.Llock)) { m.Llock *= f; m.Leff *= f; } ch.push(f - 1); }
  const pc = (A, q) => { if (!A.length) return 0; const B = A.slice().sort((x, y) => x - y); return +(B[Math.min(B.length - 1, Math.floor(q * B.length))] * 100).toFixed(1); };
  return { mode, lamCrit: lam, edgesSeen: st.length, edges: ch.length, stretchBeforePct: { p5: pc(st, 0.05), p50: pc(st, 0.5), p95: pc(st, 0.95), max: pc(st, 1) }, restChangePct: { p5: pc(ch, 0.05), p50: pc(ch, 0.5), p95: pc(ch, 0.95), max: pc(ch, 1) } };
}
// WRINKLING (ANAT8-PELVIS, lane iteration 16): skin is a stiff thin sheet on a soft substrate (the fat), so in-plane COMPRESSION does not shorten it: past
// a strain of a few per cent it buckles (Cerda and Mahadevan 2003, Phys Rev Lett 90:074302, 'Geometry and physics of wrinkling', skin their example;
// recalled) and the buckled sheet carries ~no compressive stress: the TENSION-FIELD membrane (Wagner 1929; Pipkin 1986, IMA J Appl Math 36:85, the
// relaxed energy of an elastic membrane; Steigmann 1990, Proc R Soc Lond A 429:141; recalled). A membrane with tension: 'field' takes no compressive force
// on its edges; with bend it keeps the sheet's BENDING energy on its hinges, U = (D / 2) |e|^2 (theta - theta0)^2 / (A1 + A2) a hinge (the discrete
// shell's dihedral energy, Grinspun, Hirani, Desbrun and Schroeder 2003, SCA; the factor set so that a cylinder bent on the square-split triangles the
// surface nets make stores the plate's (D / 2) kappa^2 an area), D = E t^3 / (12 (1 - nu^2)), so the buckles come at the wavelength the sheet's bending and
// the tissue under it select, lambda = 2 pi t (Ebar_f / (3 Ebar_s))^(1/3), Ebar = E / (1 - nu^2) (a film on a half-space; the critical strain
// (1/4) (3 Ebar_s / Ebar_f)^(2/3)): wrinkleOf reports both per compartment as a description (the solve does not use them). Where the skin is bound (a zone
// of adherence) and the tissue above it is loaded onto the line, the slack skin folds there: the fold, the crease, the dimple come out of the solve.
function wrinkleOf(Mb, R) { const nu = Mb.nu ?? 0.5, Ef = Mb.E / (1 - nu * nu), out = {};
  for (const c of R.compartments) { const m = c.mat, Es = m.E * (m.muScale ?? 1) / (1 - m.nu * m.nu), r = Ef / (3 * Es);
    out[c.name] = { lambdaMm: +(2 * Math.PI * Mb.t * Math.cbrt(r) * 1000).toFixed(1), critStrainPct: +(25 * Math.pow(1 / r, 2 / 3)).toFixed(2) }; }
  return out; }
// the hinges of a membrane: every interior edge shared by two of its triangles (consistently wound: p -> q in one, q -> p in the other), all four points
// embedded; x3 = p, x4 = q (the edge as the first triangle winds it), x1 the first triangle's third point, x2 the second's (Bridson, Marino and Fedkiw 2003,
// SCA, 'Simulation of clothing with folds and wrinkles': N1 = (x1 - x3) x (x1 - x4), N2 = (x2 - x4) x (x2 - x3), E = x4 - x3); the rest angle the reference's
function buildHinges(out, idx, P0, vlab, L, embT, D) {
  const Ed = new Map(); let n = 0;
  for (let f = 0; f < idx.length; f += 3) { const a = idx[f], b = idx[f + 1], c = idx[f + 2]; if (vlab[a] !== L || vlab[b] !== L || vlab[c] !== L) continue;
    for (const [p, q, r] of [[a, b, c], [b, c, a], [c, a, b]]) { const key = p < q ? p * 4294967296 + q : q * 4294967296 + p, e = Ed.get(key); if (e) e.push([p, q, r]); else Ed.set(key, [[p, q, r]]); } }
  const G = new Float64Array(12);
  for (const e of Ed.values()) { if (e.length !== 2) continue; const [A, B] = e; if (!(A[0] === B[1] && A[1] === B[0])) continue;
    const x3 = A[0], x4 = A[1], x1 = A[2], x2 = B[2]; if (embT[x1] < 0 || embT[x2] < 0 || embT[x3] < 0 || embT[x4] < 0) continue;
    const th = hingeAngle(P0, x1, x2, x3, x4, G); if (th === null) continue;
    const el2 = (P0[x4 * 3] - P0[x3 * 3]) ** 2 + (P0[x4 * 3 + 1] - P0[x3 * 3 + 1]) ** 2 + (P0[x4 * 3 + 2] - P0[x3 * 3 + 2]) ** 2, A12 = triArea3(P0, x3, x4, x1) + triArea3(P0, x4, x3, x2);
    if (!(A12 > 1e-12)) continue; out.push({ x1, x2, x3, x4, th0: th, alpha: A12 / (D * el2) }); n++; }
  return n; }
// the signed dihedral (bending) angle of a hinge, 0 flat, positive folding toward the normals' side, and its gradient (G: d theta / d x1, x2, x3, x4) from
// Bridson et al. 2003's modes u_i (the gradient of the angle up to its sign: u1 = |E| N1 / |N1|^2 ...; checked by finite differences in
// labs/human8/anat8p/wrinkle_test.mjs)
export function hingeAngle(P, x1, x2, x3, x4, G) {
  const ax = P[x3 * 3], ay = P[x3 * 3 + 1], az = P[x3 * 3 + 2], bx = P[x4 * 3], by = P[x4 * 3 + 1], bz = P[x4 * 3 + 2];
  const ex = bx - ax, ey = by - ay, ez = bz - az, el = Math.sqrt(ex * ex + ey * ey + ez * ez); if (el < 1e-12) return null;
  const p1x = P[x1 * 3] - ax, p1y = P[x1 * 3 + 1] - ay, p1z = P[x1 * 3 + 2] - az, q1x = P[x1 * 3] - bx, q1y = P[x1 * 3 + 1] - by, q1z = P[x1 * 3 + 2] - bz;
  const p2x = P[x2 * 3] - bx, p2y = P[x2 * 3 + 1] - by, p2z = P[x2 * 3 + 2] - bz, q2x = P[x2 * 3] - ax, q2y = P[x2 * 3 + 1] - ay, q2z = P[x2 * 3 + 2] - az;
  const n1x = p1y * q1z - p1z * q1y, n1y = p1z * q1x - p1x * q1z, n1z = p1x * q1y - p1y * q1x, n2x = p2y * q2z - p2z * q2y, n2y = p2z * q2x - p2x * q2z, n2z = p2x * q2y - p2y * q2x;
  const l1 = n1x * n1x + n1y * n1y + n1z * n1z, l2 = n2x * n2x + n2y * n2y + n2z * n2z; if (l1 < 1e-24 || l2 < 1e-24) return null;
  const s1 = Math.sqrt(l1), s2 = Math.sqrt(l2), cx = n1y * n2z - n1z * n2y, cy = n1z * n2x - n1x * n2z, cz = n1x * n2y - n1y * n2x;
  const th = Math.atan2((cx * ex + cy * ey + cz * ez) / (el * s1 * s2), (n1x * n2x + n1y * n2y + n1z * n2z) / (s1 * s2));
  if (G) { const f1 = el / l1, f2 = el / l2, d14 = (q1x * ex + q1y * ey + q1z * ez) / el, d24 = (p2x * ex + p2y * ey + p2z * ez) / el, d13 = (p1x * ex + p1y * ey + p1z * ez) / el, d23 = (q2x * ex + q2y * ey + q2z * ez) / el;
    const sg = HSIGN;
    G[0] = sg * f1 * n1x; G[1] = sg * f1 * n1y; G[2] = sg * f1 * n1z; G[3] = sg * f2 * n2x; G[4] = sg * f2 * n2y; G[5] = sg * f2 * n2z;
    G[6] = sg * (d14 * n1x / l1 + d24 * n2x / l2); G[7] = sg * (d14 * n1y / l1 + d24 * n2y / l2); G[8] = sg * (d14 * n1z / l1 + d24 * n2z / l2);
    G[9] = -sg * (d13 * n1x / l1 + d23 * n2x / l2); G[10] = -sg * (d13 * n1y / l1 + d23 * n2y / l2); G[11] = -sg * (d13 * n1z / l1 + d23 * n2z / l2); }
  return th; }
const HSIGN = -1;   // the sign relating Bridson's modes to this angle's gradient (labs/human8/anat8p/wrinkle_test.mjs: central differences agree to 3e-10)
// one hinge on embedded points: the four points' gradients spread over their tets' nodes (up to 16), generalised inverse mass, one XPBD step (lambda 0)
const HN = new Int32Array(16), HG = new Float64Array(48), HP = new Float64Array(12), HGr = new Float64Array(12), HPt = [0, 0, 0];
function projectHinge(S, c, aT) {
  const pts = [c.x1, c.x2, c.x3, c.x4], TT = S.TT, W = S.surf.embW, iM = S.invM, X = S.X;
  for (let i = 0; i < 4; i++) { ptAt(S, pts[i], HPt); HP[i * 3] = HPt[0]; HP[i * 3 + 1] = HPt[1]; HP[i * 3 + 2] = HPt[2]; }
  const th = hingeAngle(HP, 0, 1, 2, 3, HGr); if (th === null) return;
  let C = th - c.th0; if (C > Math.PI) C -= 2 * Math.PI; else if (C < -Math.PI) C += 2 * Math.PI;
  let m = 0;
  for (let i = 0; i < 4; i++) { const t = S.surf.embT[pts[i]]; for (let q = 0; q < 4; q++) { const nd = TT[t * 4 + q], w = W[pts[i] * 4 + q]; if (w === 0) continue; let f = -1; for (let r = 0; r < m; r++) if (HN[r] === nd) { f = r; break; }
      if (f < 0) { f = m++; HN[f] = nd; HG[f * 3] = HG[f * 3 + 1] = HG[f * 3 + 2] = 0; } HG[f * 3] += w * HGr[i * 3]; HG[f * 3 + 1] += w * HGr[i * 3 + 1]; HG[f * 3 + 2] += w * HGr[i * 3 + 2]; } }
  let Wg = 0; for (let r = 0; r < m; r++) Wg += iM[HN[r]] * (HG[r * 3] * HG[r * 3] + HG[r * 3 + 1] * HG[r * 3 + 1] + HG[r * 3 + 2] * HG[r * 3 + 2]);
  const den = Wg + aT; if (!(den > 0)) return; const dl = -C / den;
  for (let r = 0; r < m; r++) { const n = HN[r], s = iM[n] * dl; if (s === 0) continue; X[n * 3] += s * HG[r * 3]; X[n * 3 + 1] += s * HG[r * 3 + 1]; X[n * 3 + 2] += s * HG[r * 3 + 2]; }
}
function det3(m) { return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]); }
function inv3(m) { const d = det3(m), i = 1 / d; return [(m[4] * m[8] - m[5] * m[7]) * i, (m[2] * m[7] - m[1] * m[8]) * i, (m[1] * m[5] - m[2] * m[4]) * i, (m[5] * m[6] - m[3] * m[8]) * i, (m[0] * m[8] - m[2] * m[6]) * i, (m[2] * m[3] - m[0] * m[5]) * i, (m[3] * m[7] - m[4] * m[6]) * i, (m[1] * m[6] - m[0] * m[7]) * i, (m[0] * m[4] - m[1] * m[3]) * i]; }

// a triangle mesh's enclosed volume (divergence theorem, metres) and its open edges
export function meshVol(P, idx) { let vol = 0; const E = new Map();
  for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2], ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3] - ax, by = P[b * 3 + 1] - ay, bz = P[b * 3 + 2] - az, cx = P[c * 3] - ax, cy = P[c * 3 + 1] - ay, cz = P[c * 3 + 2] - az;
    vol += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const key = u < v ? u * 4294967296 + v : v * 4294967296 + u; E.set(key, (E.get(key) || 0) + 1); } }
  let open = 0; for (const c of E.values()) if (c !== 2) open++; return { volume: vol, open }; }
// barycentric coordinates of p in tet t (rest positions X)
function bary(X, TT, DmInv, t, p) {
  const a = TT[t * 4], o = t * 9, dx = p[0] - X[a * 3], dy = p[1] - X[a * 3 + 1], dz = p[2] - X[a * 3 + 2];
  const b1 = DmInv[o] * dx + DmInv[o + 1] * dy + DmInv[o + 2] * dz, b2 = DmInv[o + 3] * dx + DmInv[o + 4] * dy + DmInv[o + 5] * dz, b3 = DmInv[o + 6] * dx + DmInv[o + 7] * dy + DmInv[o + 8] * dz;
  return [1 - b1 - b2 - b3, b1, b2, b3];
}
const dist3 = (P, a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
function triArea3(P, a, b, c) { const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); }
function vertexAreas(P, idx, nv) { const A = new Float64Array(nv); for (let f = 0; f < idx.length; f += 3) { const a = idx[f], b = idx[f + 1], c = idx[f + 2], s = triArea3(P, a, b, c) / 3; A[a] += s; A[b] += s; A[c] += s; } return A; }

// the embedded point's current position
function ptAt(S, v, out) { const t = S.surf.embT[v], W = S.surf.embW, X = S.X, TT = S.TT; out[0] = out[1] = out[2] = 0;
  for (let q = 0; q < 4; q++) { const n = TT[t * 4 + q], w = W[v * 4 + q]; out[0] += X[n * 3] * w; out[1] += X[n * 3 + 1] * w; out[2] += X[n * 3 + 2] * w; } return out; }
export function surfacePositions(S) { const nv = S.surf.label.length, P = new Float64Array(nv * 3), q = [0, 0, 0]; for (let v = 0; v < nv; v++) { if (S.surf.embT[v] < 0) { P[v * 3] = S.surf.pos0[v * 3]; P[v * 3 + 1] = S.surf.pos0[v * 3 + 1]; P[v * 3 + 2] = S.surf.pos0[v * 3 + 2]; continue; } ptAt(S, v, q); P[v * 3] = q[0]; P[v * 3 + 1] = q[1]; P[v * 3 + 2] = q[2]; } return P; }
function trackAt(S, k) { const T = S.trk[k], X = S.X, TT = S.TT, o = [0, 0, 0]; if (T.t < 0) return T.p0.slice(); for (let q = 0; q < 4; q++) { const n = TT[T.t * 4 + q]; o[0] += X[n * 3] * T.w[q]; o[1] += X[n * 3 + 1] * T.w[q]; o[2] += X[n * 3 + 2] * T.w[q]; } return o; }

// a constraint on one or two embedded points with gradient +-g (|g| = 1): node coefficients c_n (= b_n for point A, -b_n for point B), generalised
// inverse mass sum_n w_n c_n^2, dl = -(C) / (W + alpha / dt^2), x_n += w_n c_n g dl
const NB = new Int32Array(8), CB = new Float64Array(8);
function gather(S, va, vb) {   // vb < 0: one point; returns the count of unique nodes in NB / CB
  const TT = S.TT, W = S.surf.embW, ta = S.surf.embT[va]; let m = 0;
  for (let q = 0; q < 4; q++) { NB[m] = TT[ta * 4 + q]; CB[m] = W[va * 4 + q]; m++; }
  if (vb >= 0) { const tb = S.surf.embT[vb]; for (let q = 0; q < 4; q++) { const n = TT[tb * 4 + q], c = -W[vb * 4 + q]; let f = -1; for (let r = 0; r < m; r++) if (NB[r] === n) { f = r; break; } if (f >= 0) CB[f] += c; else { NB[m] = n; CB[m] = c; m++; } } }
  return m;
}
function applyG(S, m, gx, gy, gz, C, alphaT) {
  const iM = S.invM, X = S.X; let W = 0; for (let r = 0; r < m; r++) W += iM[NB[r]] * CB[r] * CB[r];
  const den = W + alphaT; if (den <= 0) return 0; const dl = -C / den;
  for (let r = 0; r < m; r++) { const n = NB[r], s = iM[n] * CB[r] * dl; if (s === 0) continue; X[n * 3] += s * gx; X[n * 3 + 1] += s * gy; X[n * 3 + 2] += s * gz; }
  return dl;
}

export function solveSoft(S, o = {}) {
  const t0 = Date.now(), R = S.R, dt = o.dt ?? 0.001, maxTime = o.maxTime ?? 3, damping = o.damping ?? 40, tol = o.tolMm ?? 0.05, every = o.every ?? 50, g = R.gravity || [0, -9.81, 0];
  const gS = S.gS || new Float64Array(S.invM.length).fill(1), X = S.X, nN = S.invM.length, nT = S.TF.length, V = new Float64Array(nN * 3), Xp = new Float64Array(nN * 3), TT = S.TT, Di = S.DmInv, iM = S.invM, aD = S.aD, aH = S.aH, gam = S.gam;
  const dt2 = dt * dt, damp = Math.exp(-damping * dt), P = [0, 0, 0], Q = [0, 0, 0], G = [0, 0, 0], hist = [];
  const nSteps = Math.round(maxTime / dt); let step = 0, converged = false, lastTrack = null, residual = 0, drift = Infinity, vArg = -1;
  for (step = 0; step < nSteps; step++) {
    for (let n = 0; n < nN; n++) { if (iM[n] === 0) continue; const o3 = n * 3, gs = gS[n] * dt; V[o3] += g[0] * gs; V[o3 + 1] += g[1] * gs; V[o3 + 2] += g[2] * gs;
      Xp[o3] = X[o3]; Xp[o3 + 1] = X[o3 + 1]; Xp[o3 + 2] = X[o3 + 2]; X[o3] += V[o3] * dt; X[o3 + 1] += V[o3 + 1] * dt; X[o3 + 2] += V[o3 + 2] * dt; }
    // the tets: deviatoric then hydrostatic (Macklin and Mueller 2021)
    for (let t = 0; t < nT; t++) projectTet(X, TT, Di, iM, t, aD[t] / dt2, aH[t] / dt2, gam[t]);
    // the deep interface (sliding: on the fascia, a tangential drag to the rest point)
    for (const c of S.cons.base) { ptAt(S, c.v, P); const d = R.solids.dg(P[0], P[1], P[2], G), m = gather(S, c.v, -1);
      applyG(S, m, G[0], G[1], G[2], d, c.aN / dt2);
      ptAt(S, c.v, P); const dx = P[0] - c.p0[0], dy = P[1] - c.p0[1], dz = P[2] - c.p0[2], dn = dx * G[0] + dy * G[1] + dz * G[2], tx = dx - dn * G[0], ty = dy - dn * G[1], tz = dz - dn * G[2], tl = sqrt(tx * tx + ty * ty + tz * tz);
      if (tl > 1e-9) applyG(S, m, tx / tl, ty / tl, tz / tl, tl, c.aT / dt2); }
    // tethers (unilateral)
    for (const c of S.cons.teth) { ptAt(S, c.v, P); const dx = P[0] - c.a[0], dy = P[1] - c.a[1], dz = P[2] - c.a[2], l = sqrt(dx * dx + dy * dy + dz * dz), C = l - c.L; if (C <= 0 || l < 1e-9) continue;
      const m = gather(S, c.v, -1); applyG(S, m, dx / l, dy / l, dz / l, C, c.alpha / dt2); }
    // membranes (edge springs, compression softer)
    for (const c of S.cons.memb) { ptAt(S, c.a, P); ptAt(S, c.b, Q); const dx = P[0] - Q[0], dy = P[1] - Q[1], dz = P[2] - Q[2], l = sqrt(dx * dx + dy * dy + dz * dz); if (l < 1e-9) continue; const C = l - c.L;
      if (C <= 0 && c.aC === Infinity) continue;   // a tension field: slack (buckled) skin carries nothing
      const m = gather(S, c.a, c.b);
      if (c.beta && C > 0) { const q = fungC(c, C); applyG(S, m, dx / l, dy / l, dz / l, q[0], q[1] / dt2); }
      else if (l > c.Llock) applyG(S, m, dx / l, dy / l, dz / l, l - c.Leff, c.aL / dt2); else applyG(S, m, dx / l, dy / l, dz / l, C, (C > 0 ? c.aT : c.aC) / dt2); }
    // the skin's bending (the hinges of a membrane with bend: WRINKLING)
    for (const c of S.cons.hinge) projectHinge(S, c, c.alpha / dt2);
    // colliders (unilateral)
    for (const c of S.cons.coll) { ptAt(S, c.v, P); const d = c.C.dg(P[0], P[1], P[2], G) - c.margin; if (d >= 0) continue; const m = gather(S, c.v, -1); applyG(S, m, G[0], G[1], G[2], d, 0); }
    // velocities, damping
    let vmax = 0; vArg = -1; for (let n = 0; n < nN; n++) { if (iM[n] === 0) continue; const o3 = n * 3;
      V[o3] = (X[o3] - Xp[o3]) / dt * damp; V[o3 + 1] = (X[o3 + 1] - Xp[o3 + 1]) / dt * damp; V[o3 + 2] = (X[o3 + 2] - Xp[o3 + 2]) / dt * damp;
      const s2 = V[o3] * V[o3] + V[o3 + 1] * V[o3 + 1] + V[o3 + 2] * V[o3 + 2]; if (s2 > vmax) { vmax = s2; vArg = n; } }
    residual = sqrt(vmax);
    if ((step + 1) % every === 0) { const tr = S.trk.map((_, k) => trackAt(S, k)), mv = lastTrack ? Math.max(...tr.map((p, k) => Math.hypot(p[0] - lastTrack[k][0], p[1] - lastTrack[k][1], p[2] - lastTrack[k][2]))) : Infinity;
      hist.push({ t: +((step + 1) * dt).toFixed(3), vmaxMmS: +(residual * 1000).toFixed(2), trackMoveMm: Number.isFinite(mv) ? +(mv * 1000).toFixed(3) : null, nip: tr[0] ? tr[0].map(v => +(v * 100).toFixed(2)) : null });
      if (o.log) o.log(hist[hist.length - 1]);
      drift = mv; lastTrack = tr; if (mv * 1000 < tol && residual * 1000 < (o.vmaxMmS ?? 1) && (step + 1) * dt >= (o.minTime ?? 0.3)) { converged = true; step++; break; } }
  }
  // the results: the loaded surface, the tracked points, the volume, inversions, tethers' and membranes' strains
  const pos = surfacePositions(S), track = {}; S.trk.forEach((T, k) => { track[T.name] = trackAt(S, k); });
  const stL = meshVol(pos, S.surf.tri), st0 = meshVol(S.surf.pos0, S.surf.tri);
  const nC = R.compartments.length, v0c = new Float64Array(nC), v1c = new Float64Array(nC); let inv = 0, Jmin = Infinity;
  for (let t = 0; t < nT; t++) { const J = tetJ(X, TT, Di, t); if (S.TF[t] >= 0.25) { if (J <= 0) inv++; if (J < Jmin) Jmin = J; } v0c[S.TC[t]] += S.Vol[t] * S.TF[t]; v1c[S.TC[t]] += S.Vol[t] * S.TF[t] * J; }
  const teth = {}; for (const c of S.cons.teth) { ptAt(S, c.v, P); const l = Math.hypot(P[0] - c.a[0], P[1] - c.a[1], P[2] - c.a[2]), sN = l / c.L0 - 1; const e = teth[c.name] ||= { n: 0, taut: 0, maxStretchPct: -Infinity, maxMm: 0 }; e.n++; if (l > c.L) e.taut++; e.maxMm = Math.max(e.maxMm, +(l * 1000).toFixed(1)); if (!c.bound) e.maxStretchPct = Math.max(e.maxStretchPct, +(sN * 100).toFixed(1)); }
  let mStr = -Infinity, mCmp = Infinity; const es = []; for (const c of S.cons.memb) { ptAt(S, c.a, P); ptAt(S, c.b, Q); const l = Math.hypot(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]), e = l / c.L - 1; es.push(e); if (e > mStr) mStr = e; if (e < mCmp) mCmp = e; }
  es.sort((a, b) => a - b); const pc = q => es.length ? +(es[Math.min(es.length - 1, Math.floor(q * es.length))] * 100).toFixed(1) : null;
  let bendStats = null; if (S.cons.hinge.length) { const HQ = new Float64Array(12), d = []; for (const c of S.cons.hinge) { for (const [i, v] of [c.x1, c.x2, c.x3, c.x4].entries()) { ptAt(S, v, P); HQ[i * 3] = P[0]; HQ[i * 3 + 1] = P[1]; HQ[i * 3 + 2] = P[2]; } const th = hingeAngle(HQ, 0, 1, 2, 3, null); if (th !== null) d.push(Math.abs(th - c.th0) * 180 / Math.PI); }
    d.sort((a, b) => a - b); const q = f => d.length ? +d[Math.min(d.length - 1, Math.floor(f * d.length))].toFixed(1) : null; bendStats = { hinges: d.length, dThetaDeg: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1) } }; }
  const slackPct = es.length ? +(es.filter(e => e < 0).length / es.length * 100).toFixed(1) : null;
  const stats = { steps: step, time: +(step * dt).toFixed(3), dt, damping, converged, residualMmS: +(residual * 1000).toFixed(2), driftMm: Number.isFinite(drift) ? +(drift * 1000).toFixed(3) : null,
    surfVolCm3: { ref: +(abs(st0.volume) * 1e6).toFixed(1), loaded: +(abs(stL.volume) * 1e6).toFixed(1), errPct: +((abs(stL.volume) / abs(st0.volume) - 1) * 100).toFixed(2) },
    volErrPct: Object.fromEntries(R.compartments.map((c, i) => [c.name, +((v1c[i] / v0c[i] - 1) * 100).toFixed(2)])), inverted: inv, Jmin: +Jmin.toFixed(3), tether: teth,
    vmaxAt: vArg >= 0 ? { node: vArg, cm: [0, 1, 2].map(k => +(X[vArg * 3 + k] * 100).toFixed(1)), restCm: [0, 1, 2].map(k => +(S.X0[vArg * 3 + k] * 100).toFixed(1)), massG: +(S.mass[vArg] * 1000).toFixed(3) } : null,   // the fastest node at the end (diagnostic)
    skinStrainPct: { maxTension: +(mStr * 100).toFixed(1), maxCompression: +(mCmp * 100).toFixed(1), p1: pc(0.01), p50: pc(0.5), p95: pc(0.95), p99: pc(0.99), slackPct }, ...(bendStats ? { bend: bendStats } : {}), hist, ms: Date.now() - t0 };
  return { X, surface: { pos, pos0: S.surf.pos0, tri: S.surf.tri, label: S.surf.label, labels: S.surf.labels }, track, stats };
}

// the Fung edge as an XPBD energy constraint (lane iteration 11): U(C) = int_0^C f, f = (k L / beta) expm1(beta C / L); with the constraint
// Ct = sqrt(2 U / k) (compliance 1 / k) XPBD minimises U exactly; its gradient along the edge is s = f / (k Ct), and a constraint with gradient s g is
// the unit-gradient call with C' = Ct / s = 2 U / f and alpha' = (1 / k) / s^2 = 2 U / f^2 (so applyG stays as it is). Small strain: C' = C, alpha' = 1 / k.
const FQ = [0, 0];
function fungC(c, C) {
  const x = Math.min(c.beta * C / c.L, 40), em = Math.expm1(x), g = x < 1e-3 ? x * x / 2 * (1 + x / 3 + x * x / 12) : em - x;   // g = expm1(x) - x, accurate near 0
  const LB = c.L / c.beta, f = c.k * LB * em, U = c.k * LB * LB * g;
  FQ[0] = 2 * U / f; FQ[1] = 2 * U / (f * f); return FQ;
}

function tetJ(X, TT, Di, t) {
  const a = TT[t * 4], b = TT[t * 4 + 1], c = TT[t * 4 + 2], d = TT[t * 4 + 3], o = t * 9;
  const d00 = X[b * 3] - X[a * 3], d10 = X[b * 3 + 1] - X[a * 3 + 1], d20 = X[b * 3 + 2] - X[a * 3 + 2], d01 = X[c * 3] - X[a * 3], d11 = X[c * 3 + 1] - X[a * 3 + 1], d21 = X[c * 3 + 2] - X[a * 3 + 2], d02 = X[d * 3] - X[a * 3], d12 = X[d * 3 + 1] - X[a * 3 + 1], d22 = X[d * 3 + 2] - X[a * 3 + 2];
  const detDs = d00 * (d11 * d22 - d12 * d21) - d01 * (d10 * d22 - d12 * d20) + d02 * (d10 * d21 - d11 * d20);
  const detDi = Di[o] * (Di[o + 4] * Di[o + 8] - Di[o + 5] * Di[o + 7]) - Di[o + 1] * (Di[o + 3] * Di[o + 8] - Di[o + 5] * Di[o + 6]) + Di[o + 2] * (Di[o + 3] * Di[o + 7] - Di[o + 4] * Di[o + 6]);
  return detDs * detDi;
}

// one tet: F = Ds Dm^-1; C_D = sqrt(tr F^T F), dC/dF = F / C_D; C_H = det F - gamma, dC/dF = cof F (columns f1 x f2, f2 x f0, f0 x f1); grad_i =
// (dC/dF) Dm^-T column i (i = 1..3), grad_0 = -sum. The two constraints are solved TOGETHER (a 2 x 2 system a tet, as Macklin and Mueller 2021 suggest
// for high Poisson ratios: solved one after the other, the deviatoric step's volume loss is only half undone and a 5 cm gel column lost 1.6 % of its
// volume in the unit test); XPBD with lambda zero at the substep's start (one iteration a substep).
const GD = new Float64Array(12), GH = new Float64Array(12);
function projectTet(X, TT, Di, iM, t, aDt, aHt, gamma) {
  const a = TT[t * 4], b = TT[t * 4 + 1], c = TT[t * 4 + 2], d = TT[t * 4 + 3], o = t * 9, wa = iM[a], wb = iM[b], wc = iM[c], wd = iM[d];
  if (wa + wb + wc + wd === 0) return;
  const d00 = X[b * 3] - X[a * 3], d10 = X[b * 3 + 1] - X[a * 3 + 1], d20 = X[b * 3 + 2] - X[a * 3 + 2], d01 = X[c * 3] - X[a * 3], d11 = X[c * 3 + 1] - X[a * 3 + 1], d21 = X[c * 3 + 2] - X[a * 3 + 2], d02 = X[d * 3] - X[a * 3], d12 = X[d * 3 + 1] - X[a * 3 + 1], d22 = X[d * 3 + 2] - X[a * 3 + 2];
  const f00 = d00 * Di[o] + d01 * Di[o + 3] + d02 * Di[o + 6], f01 = d00 * Di[o + 1] + d01 * Di[o + 4] + d02 * Di[o + 7], f02 = d00 * Di[o + 2] + d01 * Di[o + 5] + d02 * Di[o + 8];
  const f10 = d10 * Di[o] + d11 * Di[o + 3] + d12 * Di[o + 6], f11 = d10 * Di[o + 1] + d11 * Di[o + 4] + d12 * Di[o + 7], f12 = d10 * Di[o + 2] + d11 * Di[o + 5] + d12 * Di[o + 8];
  const f20 = d20 * Di[o] + d21 * Di[o + 3] + d22 * Di[o + 6], f21 = d20 * Di[o + 1] + d21 * Di[o + 4] + d22 * Di[o + 7], f22 = d20 * Di[o + 2] + d21 * Di[o + 5] + d22 * Di[o + 8];
  const r = sqrt(f00 * f00 + f01 * f01 + f02 * f02 + f10 * f10 + f11 * f11 + f12 * f12 + f20 * f20 + f21 * f21 + f22 * f22); if (r < 1e-12) return;
  const ir = 1 / r, CD = r;
  const H00 = f11 * f22 - f21 * f12, H10 = f21 * f02 - f01 * f22, H20 = f01 * f12 - f11 * f02, H01 = f12 * f20 - f22 * f10, H11 = f22 * f00 - f02 * f20, H21 = f02 * f10 - f12 * f00;
  const H02 = f10 * f21 - f20 * f11, H12 = f20 * f01 - f00 * f21, H22 = f00 * f11 - f10 * f01, CH = f00 * H00 + f10 * H10 + f20 * H20 - gamma;
  for (let i = 0; i < 3; i++) { const q = o + i * 3, x = Di[q], y = Di[q + 1], z = Di[q + 2];
    GD[3 + i * 3] = (f00 * x + f01 * y + f02 * z) * ir; GD[4 + i * 3] = (f10 * x + f11 * y + f12 * z) * ir; GD[5 + i * 3] = (f20 * x + f21 * y + f22 * z) * ir;
    GH[3 + i * 3] = H00 * x + H01 * y + H02 * z; GH[4 + i * 3] = H10 * x + H11 * y + H12 * z; GH[5 + i * 3] = H20 * x + H21 * y + H22 * z; }
  for (let k = 0; k < 3; k++) { GD[k] = -(GD[3 + k] + GD[6 + k] + GD[9 + k]); GH[k] = -(GH[3 + k] + GH[6 + k] + GH[9 + k]); }
  let Add = 0, Adh = 0, Ahh = 0; const w4 = [wa, wb, wc, wd];
  for (let v = 0; v < 4; v++) { const w = w4[v], j = v * 3; if (!w) continue; Add += w * (GD[j] * GD[j] + GD[j + 1] * GD[j + 1] + GD[j + 2] * GD[j + 2]); Adh += w * (GD[j] * GH[j] + GD[j + 1] * GH[j + 1] + GD[j + 2] * GH[j + 2]); Ahh += w * (GH[j] * GH[j] + GH[j + 1] * GH[j + 1] + GH[j + 2] * GH[j + 2]); }
  const m00 = Add + aDt, m11 = Ahh + aHt, det = m00 * m11 - Adh * Adh; if (Math.abs(det) < 1e-30) return;
  const lD = (-CD * m11 + CH * Adh) / det, lH = (-CH * m00 + CD * Adh) / det;
  const vs = [a, b, c, d];
  for (let v = 0; v < 4; v++) { const w = w4[v]; if (!w) continue; const n = vs[v] * 3, j = v * 3; X[n] += w * (GD[j] * lD + GH[j] * lH); X[n + 1] += w * (GD[j + 1] * lD + GH[j + 1] * lH); X[n + 2] += w * (GD[j + 2] * lD + GH[j + 2] * lH); }
}

// a section of a triangle mesh by the plane x = c (world): segments [[y0, z0, y1, z1], ...] of the triangles whose vertices all carry one of `labs`
export function sectionX(pos, tri, label, labs, c) {
  const segs = [];
  for (let f = 0; f < tri.length; f += 3) { const v = [tri[f], tri[f + 1], tri[f + 2]]; if (labs && !v.every(q => labs.includes(label[q]))) continue;
    const pts = []; for (let e = 0; e < 3; e++) { const p = v[e], q = v[(e + 1) % 3], xp = pos[p * 3] - c, xq = pos[q * 3] - c; if ((xp < 0) !== (xq < 0)) { const t = xp / (xp - xq); pts.push([pos[p * 3 + 1] + t * (pos[q * 3 + 1] - pos[p * 3 + 1]), pos[p * 3 + 2] + t * (pos[q * 3 + 2] - pos[p * 3 + 2])]); } }
    if (pts.length === 2) segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]); }
  return segs;
}
