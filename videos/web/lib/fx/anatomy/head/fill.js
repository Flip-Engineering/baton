// ANAT8-HEAD (it7, 8 Oct; REV 2 at lane it20, 15 Oct): THE SUPERFICIAL FAT FILLS, UNDER A TENSIONED SKIN, AT ITS GROWN EQUILIBRIUM.
// Pure JS (node), no three.js; millimetres in the craniometric frame (skull/frame.js). Runs OFFLINE in the bake (anatomy/head/bake9.js,
// labs/human8/anat8/anat8_f9.mjs); the page never runs it.
//   const env = fillEnvelope(H, B, st, { E0 })   // H: head/index.js buildHead; B: the skull; E0: membrane.js skinEnvelope's field (the
//                                                // offset skin: the surface the solved skin is a displacement of)
//   env.E (the unloaded skin as a redistanced field, as skinEnvelope's), env.report.fill (per compartment: volume, footprint, thickness)
//
// WHY (rev 1, it7): head/fat.js's superficial layer was a THICKNESS OFFSET of the deep layers, so the skin followed every form beneath it
// (the arch's strip, the masseter's edge, the buccal pad as a lump). Real superficial fat is a VOLUME per compartment (Rohrich and Pessa
// 2007) between the deep layer and the dermis, and the skin over it is a TENSIONED membrane: at equilibrium T * 2H = p (Young-Laplace),
// the skin a surface of constant mean curvature over the fat, the one of least area for its volume.
//
// WHY REV 2 (lane it20; the it12 plates and this file's own numbers, L08: ON reads lumpy, gaunt and old beside a 24-year-old's photographs):
//  (1) REV 1 SOLVED THE FAT ALONG THE DEEP SURFACE'S NORMALS, and the deep surface (the union of bone, muscles, glands, deep fat) has
//      crevices, fins and pinches, and faces inward at the commissure and the vestibule. Fat dropped into a crevice costs the skin no area,
//      so the solve ran away there (L08: middleCheek_L 29 mm at a pinch of seven surface-nets vertices at [48, -7, 80] beside one held at
//      0.3; nasolabial_R 19 mm along a normal facing the MOUTH, [0.84, 0, -0.54] at [-16, -45, 70]; 260 free vertices over 8 mm; the
//      thickness still growing at iteration 1500), and the field read back from those skins put needles and holes in the cheek and round
//      the mouth. The fat does not grow along the deep layer's normals; it lies UNDER THE SKIN. REV 2 SOLVES ON THE SKIN: the unknown is
//      the skin itself, the offset skin E0's own surface (outward by construction: no crevice, no inward face) displaced along its normal,
//      and the fat under a skin point is its depth to the deep layer. Where that deep point is not below the skin (it lies to the side:
//      a lip's overhang, the vestibule) the skin is not over the cheek's fat and is held.
//  (2) THE GROWN EQUILIBRIUM. Rev 1 solved each compartment for its own volume and held the skin at every retaining ligament at FACE6's
//      thickness there (the table's, while the compartments' volumes were raised ~1.8x to the CT volumetry): each compartment came out a
//      separate dome and every ligament a groove, at 24 as at 60. The anatomy says otherwise: the YOUNG face's compartments meet in
//      smooth transitions, and the abrupt contour breaks between them (the tear trough, the nasolabial fold, the jowl) come with AGE, as
//      the compartments change volume independently and descend (Rohrich and Pessa 2007; Gierloff et al. 2012; Wan et al. 2013). A
//      model that gives both: over growth (to ~30) fat fills its space to uniform stress, and the septa between the compartments are
//      thin and compliant, so neighbouring compartments reach ONE pressure: STAGE 1 solves the young face (the person's own age, or 30)
//      with the compartments of a region sharing one pressure, and no ligament acting (the ligaments grew with the tissue: their REST
//      LENGTH is the fat's depth at their line in this state). Each compartment's grown share comes out of that solve. STAGE 2 (age > 30
//      only) is the person: each compartment keeps its grown share changed by its OWN age terms (FACE6's: deflation, growth; head/fat.js
//      FAT) and descends by its own descent; the septa now hold (each compartment its own volume: the change cannot flow across them),
//      and the ligaments hold the skin at their rest length plus their slack (laxity(age)). So a 24-year-old's cheek is one smooth
//      convexity, and a 59-year-old's breaks where his fat has changed, as the anatomy makes it, not as a line drawn.
//  The firm septum: the inferior temporal septum and the zygomatic ligaments along the arch part the temple from the cheek even in the
//  young face (the temporal fat is its own region).
//
// WHY REV 3 (lane it23; the orchestrator's 16 Oct ~05:05 read of it20 L12: a deep pit under the zygoma, a lumpy ridge on the cheekbone, a
// hard nasolabial gutter; its direction: the fat compartments' amounts from the published tissue depths, the skin solving between them
// with a bending stiffness). Measured on L12 (probe it23, the same envelope): at the malar site the offset skin stood at 6.3 mm over the
// bone (the table 6.9), rev 2's fill 4.1, the soft solve 3.8, the final skin 3.0: ONE PRESSURE for the whole cheek drains the fat off the
// zygoma's convexity into the dips round it (a liquid under a membrane does exactly that), and the ridge reads; and 180 skin triangles of
// the fill folded. A first rev 3 trial kept the liquid and moved each compartment's VOLUME until its sites reached the table: where a site
// could not rise (L05 at 59, the ligaments' pins) the volume ran away (the fill's area 519 -> 1065 cm2, the jowl 74 mm thick): withdrawn.
// REV 3 (this file):
//  (1) THE AMOUNTS from the depth table: head/index.js solveAmounts scales each compartment (one k a compartment) so the layers supply the
//      2023 T-Table's depth over the sites in it (the PARAMETER; head/depths.js); the offset skin E0 this fill starts from carries them;
//  (2) THE FAT HOLDS ITS THICKNESS: a septated solid, not a liquid: an elastic (two-parameter) foundation under the tensioned skin, which
//      levels the fat's surface over a length set by the fat's own thickness (~2.6 mm over 3 mm of fat, ~9.6 mm over 15: below); no volume
//      constraints, no shared pressure, no CT rescale (that volumetry is now a description: report.ctCheek); one solve at the person's age
//      (the age is in the fat's own thickness: FACE6's terms, descent and the ligaments' hold by laxity in head/fat.js; the ligaments act
//      again as tethers in the soft solve, head/soft.js);
//  (3) THE SKIN BENDS: a bending energy (bending length 3 mm) beside the tension, so the skin joins the held regions and the neighbouring
//      compartments with a continuous slope instead of a crease.
// THE MODEL (one law for every person; nothing in it is fitted to a render, a photograph or a depth table; the depth table sets the
// compartments' AMOUNTS, a parameter, as the client's 15 Oct directive has the photographs and the literature set the simulation's):
//  - THE FAT: the grown thickness s0 under each skin point (the offset skin E0: the compartments' amounts, shapes, descent, ligaments);
//  - THE SKIN: a membrane at tension T with bending stiffness T l_B^2 over the fat; its thickness is the skin's own (H.skin);
//  - THE HOLD: per unit area E / t against T + G t (the fat's Young's and shear moduli, its thickness t);
//  - THE CONSTRAINTS: the fat >= a film (0.3 mm);
//  - HELD (not this model's): the lips, the nose's soft envelope, the lids and the orbit, the forehead and the chin (crossed by the
//    frontalis' and the mentalis' insertions), the infraorbital fat over the orbicularis, the submental fat, the scalp, the ears.
// DISCRETE: the skin mesh Y = surface nets of E0 (its normals n = grad E0); per skin vertex the fat under it s0 = depth to the deep layer
// (the inner layers' redistanced field I) less the skin's thickness; the solved skin X = Y + (s - s0) n. Minimise the energy over s by
// gradient descent (the step scaled for the bending's stability), s clamped to the film. The field: E = E0 - (s - s0) at each point's
// foot on E0's surface (zero outside the fill: E0 exactly), cleaned, blurred and redistanced as skinEnvelope's, so head/soft.js and
// head/membrane.js consume it unchanged.
import { sampleField, makeField, redistance, blurField, keepComponents, surfaceNets } from '../layer/grid.js';
import * as D from '../layer/sdf.js';
import { v3, clamp, sstep, f1, f2 } from './common.js';
import { fatT, descentOf } from './fat.js';
import { depthAt } from './depths.js';
export const FILL_VERSION = 3;   // (lane it23) each compartment its OWN amount (head/index.js solveAmounts: the 2023 T-Table at the sites over it) held at its sites through the fill (the site loop), the skin with a BENDING stiffness; no shared region pressure, no CT rescale. (was 2 (lane it20): on the skin, at the grown equilibrium; rev 1: along the deep normals)
// The compartments that FILL: the midface and lateral pillows, free between their ligaments (head/fat.js's superficial set; the rest HELD,
// above)
export const FILLED = ['temporal', 'medialCheek', 'middleCheek', 'lateralCheek', 'nasolabial', 'jowl'];
// (rev 3, lane it23) REGIONS (rev 2: the cheek's compartments at one pressure in the grown face) DELETED: each compartment now carries its own
// amount from the depth table (the published depths say the pressure is not one: the malar fat stands 7 mm over the zygoma's convexity,
// where one pressure drained it to 3-4 mm: L12's mal 6.3 -> 4.1 through rev 2's fill), and the septa between compartments hold it; the
// young face's smooth joins come from the skin's bending stiffness (BEND below), not from a shared pressure.

export function fillEnvelope(H, B, st, o = {}) {
  const t0 = Date.now(), lm = B.lm, g = B.geo, h = o.h ?? 2, front = Math.max(H.soft.prn[2], g.zN + 30) + 14, E0 = o.E0;
  if (!E0 || !E0.F) throw new Error('fill: needs the offset skin E0 (a sampled field)');
  const box = o.box || [-90, Math.round(lm.Me[1] - 46), -24, 90, Math.round(g.yN + 84), Math.round(front)];
  // 1. THE DEEP LAYER: what the superficial fat lies on (bone, globes, muscles, glands, deep fat, the nose's cartilage: head/index.js's
  // inner layers, the composition its phiSub uses), sampled and redistanced: the depth of the fat under a skin point is I there
  const innerS = (x, y, z) => { const dR = Math.min(H.innerM.d(x, y, z), H.deepF.d(x, y, z)), dC = H.cart.d(x, y, z); return Math.min(dR, D.smin(dR, dC, 1.0)); };
  const I = redistance(sampleField({ d: innerS }, box, h, { band: o.band ?? 3 })), t1 = Date.now();
  const projI = q => { let p = q.slice(); const gg = [0, 0, 0]; for (let it = 0; it < 8; it++) { const d = I.value(p[0], p[1], p[2]); if (Math.abs(d) < 0.05) break; I.grad(p[0], p[1], p[2], gg, 0.6 * h); p = [p[0] - d * gg[0], p[1] - d * gg[1], p[2] - d * gg[2]]; } return p; };
  // 2. THE SKIN: the offset skin's own surface (surface nets of E0), its outward normals (E0's gradient) and vertex areas
  const M = surfaceNets(E0), pos = M.pos, idx = M.idx, nV = pos.length / 3, nT = idx.length / 3, Y = i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const N = new Float64Array(nV * 3), gq = [0, 0, 0]; for (let i = 0; i < nV; i++) { E0.grad(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], gq, 0.6 * E0.h); N[i * 3] = gq[0]; N[i * 3 + 1] = gq[1]; N[i * 3 + 2] = gq[2]; }
  const A = new Float64Array(nV); for (let t = 0; t < nT; t++) { const a = idx[t * 3], c = idx[t * 3 + 1], d = idx[t * 3 + 2], P = Y(a), Q = Y(c), R = Y(d), ar = 0.5 * v3.len(v3.cross(v3.sub(Q, P), v3.sub(R, P))) / 3; A[a] += ar; A[c] += ar; A[d] += ar; }
  const adj = Array.from({ length: nV }, () => []); for (let t = 0; t < nT; t++) { const a = idx[t * 3], c = idx[t * 3 + 1], d = idx[t * 3 + 2]; adj[a].push(c, d); adj[c].push(a, d); adj[d].push(a, c); }
  // 3. PER SKIN VERTEX: the fat under it (s0), the deep point under it (its foot on I), whether that deep point lies BELOW the skin (along
  // its normal), the skin's thickness, the bone's foot (for the ligaments)
  const fat = H.fat, sym = fat.symmetric, globes = ['L', 'R'].map(s => B.globe[s]), smin = o.minFilm ?? 0.3;
  const s0 = new Float64Array(nV), K = new Float64Array(nV), foot = new Array(nV), under = new Uint8Array(nV), depth = new Float64Array(nV); const why = { far: 0, notBelow: 0, globe: 0, nose: 0 };
  for (let i = 0; i < nV; i++) { const p = Y(i), q = p; if (q[1] < box[1] || q[1] > box[4] || q[2] < box[2] || Math.abs(q[0]) > box[3]) { why.far++; continue; }
    const t = I.value(p[0], p[1], p[2]); if (!(t > 0.3 && t < 45)) { why.far++; continue; }
    const f = projI(p), v = v3.sub(p, f), lv = v3.len(v) || 1e-9; if (v[0] * N[i * 3] + v[1] * N[i * 3 + 1] + v[2] * N[i * 3 + 2] < 0.6 * lv) { why.notBelow++; continue; }
    let onGlobe = false; for (const gl of globes) if (Math.abs(v3.dist(f, gl.c) - gl.r) < 1.2) onGlobe = true; if (onGlobe) { why.globe++; continue; }
    if (H.cart.d(f[0], f[1], f[2]) < Math.min(H.innerM.d(f[0], f[1], f[2]), H.deepF.d(f[0], f[1], f[2])) + 0.5) { why.nose++; continue; }
    K[i] = H.skin(p); s0[i] = Math.max(0, t - K[i]); foot[i] = f; under[i] = 1; depth[i] = Math.max(0, H.G.value(p[0], p[1], p[2])); }
  // THE COMPARTMENTS at a stage (its age: the thickness FACE6 gives, the descent): each compartment's shape (head/fat.js's landmarks and
  // radii) placed on the DEEP layer (its points projected onto it) and read at each skin vertex's deep point
  const projC = new Map(), pj = (k, p) => { const key = k + p.join(','); if (!projC.has(key)) projC.set(key, projI(p)); return projC.get(key); };
  // a shape's normalised distance from its descriptor: a blob, a capsule, or (lane it24: the middle cheek) the union of a blob and a capsule
  const eOf = (key, ds, dd) => { if (ds.kind === 'blob+cap') { const e1 = eOf(key + 'B', ds.blob, dd), e2 = eOf(key + 'C', ds.cap, dd); return p => Math.min(e1(p), e2(p)); }
    if (ds.kind === 'blob') { const C = pj(key, ds.c), r = ds.r; return p => Math.hypot((p[0] - C[0]) / r[0], (p[1] + dd - C[1]) / r[1], (p[2] - C[2]) / r[2]); }
    const Aa = pj(key + 'a', ds.a), Bq = pj(key + 'b', ds.b), ab = v3.sub(Bq, Aa), l2 = v3.dot(ab, ab) || 1, r = ds.r;
    return p => { const q = [p[0], p[1] + dd, p[2]], t = clamp(v3.dot(v3.sub(q, Aa), ab) / l2, 0, 1); return v3.dist(q, v3.add(Aa, v3.mul(ab, t))) / r; }; };
  const stageShapes = sS => fat.fields.map(f => { const dd = descentOf(f.key, sS), t0f = fatT(f.key, sS) * (f.k ?? 1);   // (rev 3) the amount from the depth table (head/index.js solveAmounts)
    return { key: f.key, t0: t0f, e: eOf(f.key, f.desc, dd) }; });
  const mirP = (k, p) => (sym.has(k) || p[0] >= 0 ? p : [-p[0], p[1], p[2]]);
  const FILLSET = new Set(o.filled || FILLED);
  // a stage's partition: per skin vertex its compartment (name with side), its raw thickness (the compartments' amount there + the base
  // film, no ligament hold); per compartment its members and raw volume
  function partition(sS) { const S = stageShapes(sS), comp = new Int16Array(nV).fill(-1), raw = new Float64Array(nV), names = [], cId = {};
    for (let i = 0; i < nV; i++) { if (!under[i]) continue; const f = foot[i]; let best = null, be = 2, t = 0; for (const s of S) { const e = s.e(mirP(s.key, f)); if (e < 1) t += s.t0 * sstep(1, 0.45, e); if (e < be) { be = e; best = s.key; } }
      if (!best || !FILLSET.has(best)) continue; const nm = sym.has(best) ? best : best + (f[0] >= 0 ? '_L' : '_R'); if (cId[nm] == null) { cId[nm] = names.length; names.push(nm); } comp[i] = cId[nm]; raw[i] = t + 1.2; }   // 1.2: the base subcutaneous film (head/index.js BASE_SUP x 0.6)
    const members = names.map(() => []), V = new Float64Array(names.length); for (let i = 0; i < nV; i++) if (comp[i] >= 0) { members[comp[i]].push(i); V[comp[i]] += A[i] * raw[i]; }
    return { comp, raw, names, cId, members, V }; }
  // (rev 3) THE CT RESCALE IS GONE: rev 2 scaled the superficial cheek (medial + middle + nasolabial) to 10.7 mL a side (CT volumetry at 50,
  // Aesthetic Plast Surg 2018, doi 10.1007/s00266-018-1134-x); each compartment's amount now comes from the depth table (head/index.js
  // solveAmounts), in the offset skin E0 this fill starts from; that volumetry is now a DESCRIPTION (report.ctCheek).
  // THE SITES (a description of the fill, not a constraint): per forensic site (H.sites: on our bone, b and its direction n) the skin
  // vertices within 2.5 mm of its ray; the depth there = their mean (X - b) . n
  const siteRays = (H.sites || []).map(S => { const b = S.b, n = S.n, vs = []; if (!b || !n) return null;
    for (let i = 0; i < nV; i++) { if (!under[i]) continue; const dx = pos[i * 3] - b[0], dy = pos[i * 3 + 1] - b[1], dz = pos[i * 3 + 2] - b[2], t = dx * n[0] + dy * n[1] + dz * n[2]; if (t < 0 || t > 45) continue; if (dx * dx + dy * dy + dz * dz - t * t < 6.25) vs.push(i); }
    return vs.length ? { id: S.id, key: S.key, b, n, vs } : null; }).filter(Boolean);
  // THE SOLVE (rev 3): the skin over the filled compartments at the least energy of
  //   TENSION x its area  +  BENDING (1/2 T l_B^2 sum A kappa^2)  +  THE FAT'S ELASTIC HOLD (1/2 sum A k_i (s_i - s0_i)^2)
  // s0 the grown fat's thickness under each skin point (the offset: the compartments' amounts from the depth table, their descent and their
  // ligaments' hold by age: head/fat.js, head/index.js). WHY A HOLD and not rev 2's volumes at one pressure: the fat is a septated solid,
  // not a liquid; rev 2's liquid drained the malar fat off the zygoma's convexity into the dips round it (L12 mal 6.3 -> 4.1 mm), and with
  // the depth table's amounts a volume per compartment ran away where a site could not rise (L05 at 59: the fill's area 519 -> 1065 cm2,
  // the jowl 74 mm thick, in the first rev 3 trial: withdrawn). THE HOLD'S STIFFNESS: the fat layer as a two-parameter (Pasternak) elastic
  // foundation under the tensioned skin: per unit area E / t against the tension T plus the layer's own shear G t, so the skin's tension
  // levels the fat's surface over a length l_i = sqrt((T + G t) t / E) (t the fat's thickness there): ~2.6 mm over 3 mm of fat, ~5.6 mm
  // over 8, ~9.6 mm over 15 (E 1.5 kPa, G = E / 3: head/soft.js FACE_TISSUE.supFat; T ~1.8 N / m as above): thin fat keeps the bone's form
  // crisp, thick fat smooths the deep layer's lumps (the masseter's edge, the pad's rim) as an elastic layer of that thickness does.
  // In the gradient (per unit T): A_i (s_i - s0_i) / l_i^2. Bounds: the fat >= the film (0.3 mm).
  const Ef = 1.5e-3, Gf = Ef / 3, Tsk = 1.8e-3;   // N / mm2, N / mm2, N / mm
  const holdK = new Float64Array(nV); for (let i = 0; i < nV; i++) { const t = Math.max(1, s0[i]); holdK[i] = 1 / ((Tsk + Gf * t) * t / Ef); }
  let eLen = 0; for (let t = 0; t < Math.min(nT, 20000); t++) eLen += v3.dist(Y(idx[t * 3]), Y(idx[t * 3 + 1])); eLen /= Math.min(nT, 20000);
  // (rev 3) THE SKIN'S BENDING: E_b = 1/2 T l_B^2 sum_i A_i kappa_i^2 (kappa the discrete mean curvature, 2 |L X| / e^2 on the umbrella),
  // l_B = sqrt(D / T) the skin's bending length: the dermis alone (in vivo E 22.7 kPa, Mazier et al. 2024 via ANAT8-BODY; t 1.6 mm; D = E t^3
  // / 12 (1 - nu^2) ~ 1.0e-5 N m) under a resting tension of ~5 % strain (T = E t 0.05 ~ 1.8 N / m) gives ~2.4 mm; with the superficial fascia
  // over the midface the sheet is stiffer: 3 mm taken (the low end; as estimated, not measured). The step is scaled down for stability.
  const bendL = o.bend ?? 3, nbr = Array.from({ length: nV }, (_, i) => Array.from(new Set(adj[i]))), deg = nbr.map(a => a.length || 1);
  let aBar = 0; for (let i = 0; i < nV; i++) aBar += A[i]; aBar /= Math.max(1, nV); const cB = 4 * bendL * bendL * aBar / eLen ** 4;
  const eta = (o.eta ?? 0.1) * eLen * eLen / (bendL > 0 ? 0.5 + 1.6 * bendL * bendL / (eLen * eLen) : 1), dsMax = o.dsMax ?? 0.25 * eLen, X = new Float64Array(nV * 3), Gs = new Float64Array(nV), LX = new Float64Array(nV * 3);
  function solve(s, free, lo, hi, iters, tag) {
    const place = () => { for (let i = 0; i < nV; i++) { const d = s[i] - s0[i]; X[i * 3] = pos[i * 3] + d * N[i * 3]; X[i * 3 + 1] = pos[i * 3 + 1] + d * N[i * 3 + 1]; X[i * 3 + 2] = pos[i * 3 + 2] + d * N[i * 3 + 2]; } };
    const tris = []; for (let t = 0; t < nT; t++) if (free[idx[t * 3]] || free[idx[t * 3 + 1]] || free[idx[t * 3 + 2]]) tris.push(t);
    const bRows = []; { const m = new Uint8Array(nV); for (let i = 0; i < nV; i++) if (free[i]) { m[i] = 1; for (const j of nbr[i]) m[j] = 1; } for (let i = 0; i < nV; i++) if (m[i]) bRows.push(i); }
    const area = () => { let a = 0; for (const t of tris) { const ia = idx[t * 3] * 3, ib = idx[t * 3 + 1] * 3, ic = idx[t * 3 + 2] * 3, ux = X[ib] - X[ia], uy = X[ib + 1] - X[ia + 1], uz = X[ib + 2] - X[ia + 2], wx = X[ic] - X[ia], wy = X[ic + 1] - X[ia + 1], wz = X[ic + 2] - X[ia + 2]; a += 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx); } return a; };
    place(); const area0 = area(), hist = []; let folded = 0, settle = 0;
    for (let it = 0; it < iters; it++) { Gs.fill(0);
      for (const t of tris) { const a = idx[t * 3], c = idx[t * 3 + 1], d = idx[t * 3 + 2], ia = a * 3, ib = c * 3, ic = d * 3;
        const ux = X[ib] - X[ia], uy = X[ib + 1] - X[ia + 1], uz = X[ib + 2] - X[ia + 2], wx = X[ic] - X[ia], wy = X[ic + 1] - X[ia + 1], wz = X[ic + 2] - X[ia + 2];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = Math.hypot(nx, ny, nz); if (l < 1e-12) continue; nx /= l; ny /= l; nz /= l;
        // dA / dX_v = 0.5 (X_next - X_prev) x n_t (cyclic), along the skin's normal at v
        for (const [v, nxt, prv] of [[a, c, d], [c, d, a], [d, a, c]]) { if (!free[v]) continue; const ex = X[nxt * 3] - X[prv * 3], ey = X[nxt * 3 + 1] - X[prv * 3 + 1], ez = X[nxt * 3 + 2] - X[prv * 3 + 2];
          Gs[v] += 0.5 * ((ey * nz - ez * ny) * N[v * 3] + (ez * nx - ex * nz) * N[v * 3 + 1] + (ex * ny - ey * nx) * N[v * 3 + 2]); } }
      // the bending term's gradient along each free vertex's normal: cB (-(L X)_m + sum over m's neighbours i of (L X)_i / deg_i)
      if (bendL > 0) { for (const i of bRows) { const a = nbr[i]; let sx = 0, sy = 0, sz = 0; for (const j of a) { sx += X[j * 3]; sy += X[j * 3 + 1]; sz += X[j * 3 + 2]; } const k = 1 / deg[i]; LX[i * 3] = sx * k - X[i * 3]; LX[i * 3 + 1] = sy * k - X[i * 3 + 1]; LX[i * 3 + 2] = sz * k - X[i * 3 + 2]; }
        for (let m = 0; m < nV; m++) { if (!free[m]) continue; let gx = -LX[m * 3], gy = -LX[m * 3 + 1], gz = -LX[m * 3 + 2]; for (const i of nbr[m]) { const k = 1 / deg[i]; gx += LX[i * 3] * k; gy += LX[i * 3 + 1] * k; gz += LX[i * 3 + 2] * k; }
          Gs[m] += cB * (gx * N[m * 3] + gy * N[m * 3 + 1] + gz * N[m * 3 + 2]); } }
      // the fat's elastic hold toward its grown thickness
      for (let i = 0; i < nV; i++) if (free[i]) Gs[i] += A[i] * holdK[i] * (s[i] - s0[i]);
      const sPrev = Float64Array.from(s); for (let i = 0; i < nV; i++) if (free[i]) s[i] = clamp(s[i] + clamp(-eta * Gs[i] / Math.max(A[i], 0.25 * eLen * eLen), -dsMax, dsMax), lo[i], hi[i]);
      place(); let mx = 0; for (let i = 0; i < nV; i++) if (free[i]) mx = Math.max(mx, Math.abs(s[i] - sPrev[i])); settle = mx;
      if (it % 100 === 0 || it === iters - 1) hist.push({ it, area: f1(area()), maxDs: f2(mx) }); }
    for (const t of tris) { const a = idx[t * 3], c = idx[t * 3 + 1], d = idx[t * 3 + 2], u = [X[c * 3] - X[a * 3], X[c * 3 + 1] - X[a * 3 + 1], X[c * 3 + 2] - X[a * 3 + 2]], w = [X[d * 3] - X[a * 3], X[d * 3 + 1] - X[a * 3 + 1], X[d * 3 + 2] - X[a * 3 + 2]], nn = v3.cross(u, w); if (nn[0] * (N[a * 3] + N[c * 3] + N[d * 3]) + nn[1] * (N[a * 3 + 1] + N[c * 3 + 1] + N[d * 3 + 1]) + nn[2] * (N[a * 3 + 2] + N[c * 3 + 2] + N[d * 3 + 2]) < 0) folded++; }
    return { tag, area: { before: f1(area0 / 100), after: f1(area() / 100) }, settle: f2(settle), folded, hist }; }
  const report = { version: FILL_VERSION, box, h, skinVerts: nV, under: under.reduce((a, b) => a + b, 0), why, stages: [] };
  // (rev 3) ONE SOLVE AT THE PERSON'S AGE (rev 2's grown stage and its age stage, the shared pressure, the ligaments' pins DELETED: the age is in
  // the fat's own thickness (FACE6's terms, descent and the ligaments' hold by laxity, head/fat.js), the ligaments act again as tethers in
  // the soft solve (head/soft.js))
  const age = st.age ?? 35, P = partition(st), free = new Uint8Array(nV); for (let i = 0; i < nV; i++) if (P.comp[i] >= 0) free[i] = 1;
  const lo = new Float64Array(nV).fill(smin), hi = new Float64Array(nV).fill(Infinity), nPinned = 0;
  const s = Float64Array.from(s0), t2 = Date.now(), r1 = solve(s, free, lo, hi, o.iters ?? 1500, 'person');
  report.stages.push({ ...r1, age }); report.slack = null;
  report.sites = siteRays.map(R => { let d0 = 0, d1 = 0; for (const i of R.vs) { const q0 = [pos[i * 3] - R.b[0], pos[i * 3 + 1] - R.b[1], pos[i * 3 + 2] - R.b[2]], u = q0[0] * R.n[0] + q0[1] * R.n[1] + q0[2] * R.n[2], dn = (s[i] - s0[i]) * (N[i * 3] * R.n[0] + N[i * 3 + 1] * R.n[1] + N[i * 3 + 2] * R.n[2]); d0 += u; d1 += u + dn; }
    return { id: R.id, D: f2(depthAt(R.key, st)), offset: f2(d0 / R.vs.length), fill: f2(d1 / R.vs.length) }; });
  report.pinned = nPinned;
  const t3 = Date.now();
  // 4. BACK TO A FIELD: E = E0 - (s - s0) read at each grid node's foot on E0's surface (inverse-distance over the skin vertices within
  // 3 mm, the held ones counting with their 0), within `band` of the skin; elsewhere (and wherever the fill did not act) E0 exactly
  const dh = new Float64Array(nV); let nMoved = 0; for (let i = 0; i < nV; i++) { dh[i] = s[i] - s0[i]; if (Math.abs(dh[i]) > 0.01) nMoved++; }
  const VC = 3, vkey = (a, b, c) => ((a + 300) * 600 + (b + 300)) * 600 + (c + 300), vcells = new Map();
  for (let i = 0; i < nV; i++) { const kq = vkey(Math.floor(pos[i * 3] / VC), Math.floor(pos[i * 3 + 1] / VC), Math.floor(pos[i * 3 + 2] / VC)); let L = vcells.get(kq); if (!L) vcells.set(kq, L = []); L.push(i); }
  const band = o.fieldBand ?? 10, [nx, ny, nz] = E0.dims, [x0, y0, z0] = E0.origin, hE = E0.h, F = Float32Array.from(E0.F), gg = [0, 0, 0]; let nearX = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const m = (k * ny + j) * nx + i, e = E0.F[m]; if (Math.abs(e) > band) continue;
    const x = x0 + i * hE, y = y0 + j * hE, z = z0 + k * hE; E0.grad(x, y, z, gg, 0.5 * hE); const fx = x - e * gg[0], fy = y - e * gg[1], fz = z - e * gg[2], ci = Math.floor(fx / VC), cj = Math.floor(fy / VC), ck = Math.floor(fz / VC);
    let sw = 0, sd = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const L = vcells.get(vkey(ci + a, cj + b, ck + c)); if (!L) continue;
      for (const v of L) { const d2 = (pos[v * 3] - fx) ** 2 + (pos[v * 3 + 1] - fy) ** 2 + (pos[v * 3 + 2] - fz) ** 2; if (d2 > 9) continue; const w = 1 / (d2 + 0.25); sw += w; sd += w * dh[v]; } }
    if (sw > 0) { F[m] = e - sd / sw; nearX++; } }
  const G0 = makeField(F, E0.dims, E0.origin, hE), { G: G1, cleared } = keepComponents(G0, (i, j, k, x, y, z) => H.G.value(x, y, z) < -1.5);
  const E = redistance(o.sigma === 0 ? G1 : blurField(G1, o.sigma ?? 1.6)), t4 = Date.now();
  // the report: per compartment (the person's partition) the volume (mL), footprint (cm2), vertices, mean fat after, max raw -> max after
  const per = {}; P.names.forEach((nm, c) => { let s1m = 0, ar = 0, s1x = 0, r0x = 0; for (const i of P.members[c]) { s1m += A[i] * s[i]; ar += A[i]; s1x = Math.max(s1x, s[i]); r0x = Math.max(r0x, P.raw[i]); }
    per[nm] = { mL: f2(s1m / 1000), cm2: f1(ar / 100), n: P.members[c].length, meanS: f2(s1m / Math.max(1e-9, ar)), maxS0: f2(r0x), maxS: f2(s1x) }; });
  let dmx = 0, dmean = 0, nf = 0; for (let i = 0; i < nV; i++) if (free[i]) { dmx = Math.max(dmx, Math.abs(dh[i])); dmean += Math.abs(dh[i]); nf++; }
  // (rev 3) the CT volumetry as a DESCRIPTION: the superficial cheek (medial + middle + nasolabial) a side against 10.7 mL at 50, BMI 24
  const ctCheek = {}; for (const sd of ['_L', '_R']) ctCheek[sd] = f2(['medialCheek', 'middleCheek', 'nasolabial'].reduce((a, k) => a + (per[k + sd]?.mL || 0), 0));
  Object.assign(report, { free: nf, moved: nMoved, eta: f2(eta), bend: bendL, ds: { mean: f2(dmean / Math.max(1, nf)), max: f2(dmx) }, nearX, compartments: per, ctCheek: { ...ctCheek, ref: '10.7 mL a side at 50, BMI 24 (CT, Aesthetic Plast Surg 2018)' }, cleared, ms: { inner: t1 - t0, partition: t2 - t1, solve: t3 - t2, field: t4 - t3 } });
  return { E, I, M: { pos, idx, N, A, S0: s0, s, K, comp: P.comp, free, names: P.names, hi }, box, report: { box, h, sigma: o.sigma ?? 1.6, cleared, ms: { sample: t1 - t0, clean: t4 - t1 }, fill: report } };
}
