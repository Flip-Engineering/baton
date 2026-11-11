// ANATOMY / TISSUE9 / LIMB (TISSUE9-LIMB, round 8, 16 Oct 2026; DESIGN: review/studio_human_c8/after/tissue9_limb/DESIGN.md): THE LOWER LIMB AND HIP AS ONE
// GROWN VOLUME, both legs in one domain, from the iliac crest and the inguinal ligament to the ankle.
//   const Z = growLimb(B, K, { rec, h })    B = skeleton/body.js bodyOf(...), K = buildSkeleton(B), rec = the person record (prior person)
//   -> { G, L (labels), phases, groups, fields: { tissue, deep, bone, fat }, info }
// THE CHAIN: (1) the domain (grid.js) and its FIXED parts: the bones (the skeleton's fields), the trunk above the region's top cut and the foot below its
// ankle cut (the person's current body there: the region's boundary condition, nothing else), the pelvic contents; (2) STAGE A, THE DEEP COMPARTMENT: every
// muscle of the hip, thigh and leg a body GROWN from its fibres (attach.js: origin -> insertion on the person's bones) to its volume (data.js: the
// person's leg lean mass), its volume laid along its line by its architecture (the belly between its tendons), in contact with its neighbours and the
// bone, under the deep fascia's tension (grow.js); the knee's fat bodies and the patellar ligament with them; (3) STAGE B, THE SUBCUTANEOUS LAYER: the fat
// in small compartments (the retinacula cutis' lobules: cells of ~3 cm seeded on the grown deep fascia) GROWN to the person's DXA fat (the legs' and the
// hip's budgets, by the site's propensity), under the skin's tension; (4) the skin = the tissue's outer surface (its 0.5 level).
import { makeGrid, partsField, meshInside, edt3 } from '../grid.js';
import { grow, groupField } from '../grow.js';
import { limbFibres } from './attach.js';
import { muscleVolumes, BELLY, bellyF, DEEP_FAT, TENDONS, TENDON_CSA, regionalFat, ADIPOSE_PER_LIPID, IMAT, HIP_PER_GYNOID, DEPOTS, LEG_PROFILE } from './data.js';
import { mad, sub, nrm, dot, len, lerp } from '../../muscle/core.js';
export const TISSUE9_LIMB_VERSION = 1;
const CM = 0.01, ARMS = new Set([3, 4, 5, 6]);
// the tensions (dimensionless: the skin with its superficial fascia = 1). RELATIVE values, the model's parameters (ASSUMED from the tissues' kind, to be
// set from measured resting tensions): the deep fascia (fascia lata, crural fascia) tauter than the skin; the epimysium and intermuscular septa slack
// (bellies slide and pack); a muscle's own segments nearly none; the fat lobules' septa slight; two skins in contact (thigh on thigh) = two skins
export const TENSION = { skin: 1.0, deepFascia: 1.5, epimysium: 0.25, ownSegment: 0.04, fatSepta: 0.02, boneDeep: 0.3, boneFat: 1.2, boneAir: 3.0, viscDeep: 0.3, viscFat: 0.8, trunkFat: 0.08, trunkDeep: 1.2 };

export function growLimb(B, K, o = {}) {
  const t0 = Date.now(), h = o.h ?? 0.005, sx = B.sex === 'f' ? 'f' : 'm', P = K.pts, Gq = K.geo, log = o.log || (() => {}), rec = o.rec || {};
  const FL = Gq.femL, FR = Gq.femR, info = { h, timing: {} }, tick = (k, t) => { info.timing[k] = Date.now() - t; };
  // ---------------- (1) THE DOMAIN
  const crestY = Math.max(P.crestTopL[1], P.crestTopR[1]), ankL = B.J?.['foot.L']?.h, ankR = B.J?.['foot.R']?.h;
  const yAnk = (P.medMalL[1] + P.latMalL[1] + P.medMalR[1] + P.latMalR[1]) / 4 - 0.005;
  const xHalf = Math.max(Math.abs(P.trochanterL[0]), Math.abs(P.trochanterR[0]), Math.abs(P.crestTopL[0]), Math.abs(P.crestTopR[0])) + 0.11;
  const zBack = Math.min(P.coccyxTip[2], P.ischTubL[2], P.sacrumS3[2]) - 0.13, zFront = Math.max(P.asisL[2], P.asisR[2], P.patellaL[2], P.patellaR[2]) + 0.09;
  const box = [-xHalf, yAnk - 0.03, zBack, xHalf, crestY + 0.03, zFront], G = makeGrid(box, h), { nx, ny, nz } = G, nxy = nx * ny;
  info.grid = [nx, ny, nz]; info.box = box.map(v => +v.toFixed(3));
  let t = Date.now();
  // the region's TOP CUT: by azimuth round the hips' centre, through the pubic symphysis' top (the mons is the region's), the ASIS (the inguinal ligament
  // between), the crest's top, the PSIS, and across the sacrum at the PSIS' level (the gluteal region and the sacral triangle are the region's)
  const C = [0, (FL.H[1] + FR.H[1]) / 2, (FL.H[2] + FR.H[2]) / 2], az = p => Math.atan2(Math.abs(p[0]), p[2] - C[2]);
  const yPub = (P.pubTubL[1] + P.pubTubR[1]) / 2, cutPts = [[0, yPub + 3.5 * CM], [az(P.asisL), P.asisL[1]], [az(P.crestTopL), P.crestTopL[1]], [az(P.psisL), P.psisL[1]], [Math.PI, P.psisL[1] - 1 * CM]].sort((a, b) => a[0] - b[0]);
  const yCut = (x, z) => { const f = Math.atan2(Math.abs(x), z - C[2]); for (let i = 0; i + 1 < cutPts.length; i++) if (f <= cutPts[i + 1][0]) { const [f0, y0] = cutPts[i], [f1, y1] = cutPts[i + 1]; return y0 + (y1 - y0) * (f - f0) / Math.max(1e-6, f1 - f0); } return cutPts[cutPts.length - 1][1]; };
  // the bones
  const boneParts = K.parts.filter(p => /^(coxa|sacrum|coccyx|femur|patella|tibia|fibula|foot)/.test(p.name) || /^vert\.(L4|L5)$/.test(p.name));
  const BF = partsField(G, boneParts, 0.03); tick('bones', t); t = Date.now();
  // the person's current body: the boundary condition above the top cut and below the ankle cut, and the pelvic contents' envelope
  const keepTri = q => { const a = B.tri[q * 3], b = B.tri[q * 3 + 1], c = B.tri[q * 3 + 2]; if (a >= B.nb || b >= B.nb || c >= B.nb) return false; if (B.region && (ARMS.has(B.region[a]) || ARMS.has(B.region[b]) || ARMS.has(B.region[c]))) return false; return Math.min(B.pos[a * 3 + 1], B.pos[b * 3 + 1], B.pos[c * 3 + 1]) < box[4] + 0.05; };
  const IN = meshInside(G, B.pos, B.tri, keepTri); tick('template', t); t = Date.now();
  // the phases
  const phases = [{ name: 'air', group: 'air', fixed: false, V: null }], add = p => { phases.push(p); return phases.length - 1; };
  const BONE = add({ name: 'bone', group: 'bone', fixed: true }), TRUNK = add({ name: 'trunk', group: 'trunk', fixed: true }), FOOT = add({ name: 'foot', group: 'trunk', fixed: true }), VISC = add({ name: 'pelvicContents', group: 'visc', fixed: true });
  const L = new Uint16Array(G.n), fixedAir = new Uint8Array(G.n), pp = [0, 0, 0];
  // the pelvic contents: inside the person, below the top cut, inside the bony pelvis' hull at that height (its section's convex hull), above the pelvic
  // floor (the ischial tuberosities + 1.5 cm)
  const yFloor = (P.ischTubL[1] + P.ischTubR[1]) / 2 + 1.5 * CM, hulls = new Map();
  for (let j = 0; j < ny; j++) { const y = box[1] + j * h; if (y < yFloor || y > crestY) continue; const pts = [];
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const v = i + nx * j + nxy * k; if (BF[v] < 0) { const x = box[0] + i * h, z = box[2] + k * h; if (Math.abs(x) < 0.16 && z > P.coccyxTip[2] - 0.02) pts.push([x, z]); } }
    if (pts.length > 6) hulls.set(j, hull2(pts)); }
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = i + nx * j + nxy * k, x = box[0] + i * h, y = box[1] + j * h, z = box[2] + k * h;
    if (BF[v] < 0) { L[v] = BONE; continue; }
    if (y > yCut(x, z)) { if (IN[v]) L[v] = TRUNK; else fixedAir[v] = 1; continue; }
    if (y < yAnk) { if (IN[v]) L[v] = FOOT; else fixedAir[v] = 1; continue; }
    const H2 = hulls.get(j); if (H2 && IN[v] && inHull(H2, x, z)) L[v] = VISC; }
  tick('fixed', t); t = Date.now();
  // ---------------- (2) THE MUSCLES' PHASES: seeds from the fibres (sampled at h / 2, lifted off the bone), segments along the line, volumes
  const MV = muscleVolumes(B, rec), fam = new Map(), famOf = n => { if (!fam.has(n)) fam.set(n, fam.size + 1); return fam.get(n); };
  const bgrad = (v, out) => { const i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / nxy); out[0] = (BF[Math.min(v + 1, G.n - 1)] - BF[Math.max(v - 1, 0)]); out[1] = (BF[Math.min(v + nx, G.n - 1)] - BF[Math.max(v - nx, 0)]); out[2] = (BF[Math.min(v + nxy, G.n - 1)] - BF[Math.max(v - nxy, 0)]); const l = Math.hypot(out[0], out[1], out[2]) || 1; out[0] /= l; out[1] /= l; out[2] /= l; return out; };
  const vox = p => { const i = Math.round((p[0] - box[0]) / h), j = Math.round((p[1] - box[1]) / h), k = Math.round((p[2] - box[2]) / h); return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : i + nx * j + nxy * k; };
  const lift = p => { let q = p.slice(); for (let it = 0; it < 12; it++) { const v = vox(q); if (v < 0) return null; if (BF[v] > 0.6 * h) return q; const g = bgrad(v, [0, 0, 0]); q = mad(q, g, Math.max(0.5 * h, 0.8 * h - BF[v])); } return q; };
  const muscleInfo = {};
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const F = limbFibres(B, K, S_, s);
    for (const [name, M] of Object.entries(F)) { if (name.startsWith('_')) continue;
      const belly = BELLY[name] || [0, 0.5, 1, 1], isDeepFat = DEEP_FAT.has(name), isTendon = TENDONS.has(name);
      let Vt = isTendon ? (TENDON_CSA[name][sx] * 1e-4) * len(sub(M.fibres[0][M.fibres[0].length - 1], M.fibres[0][0])) : MV.V(name) * 1e-6;
      if (!(Vt > 0)) continue;
      // arc-length parameter of each fibre; segment count by the mid fibre's length (~5 cm a segment)
      const fl = M.fibres.map(pts => { const seg = []; let tot = 0; for (let i = 0; i + 1 < pts.length; i++) { const d = len(sub(pts[i + 1], pts[i])); seg.push(d); tot += d; } return { pts, seg, tot }; });
      const Lmid = fl[Math.floor(fl.length / 2)].tot, nSeg = isTendon || isDeepFat ? 1 : Math.max(2, Math.min(10, Math.round(Lmid / 0.05)));
      // the belly's share by segment (the ACSA profile integrated) and the part of the line inside the region (below the top cut, above the ankle cut)
      const share = new Float64Array(nSeg), inside = new Float64Array(nSeg), seeds = Array.from({ length: nSeg }, () => []);
      const N = 400; let tot = 0; for (let q = 0; q < N; q++) { const x = (q + 0.5) / N, f = bellyF(belly, x); tot += f; share[Math.min(nSeg - 1, Math.floor(x * nSeg))] += f; }
      for (const F1 of fl) { const n = Math.max(2, Math.ceil(F1.tot / (0.5 * h)));
        for (let q = 0; q <= n; q++) { const x = q / n; let d = x * F1.tot, i = 0; while (i < F1.seg.length - 1 && d > F1.seg[i]) { d -= F1.seg[i]; i++; } const p = lerp(F1.pts[i], F1.pts[i + 1], Math.min(1, d / Math.max(1e-9, F1.seg[i])));
          const sg = Math.min(nSeg - 1, Math.floor(x * nSeg)), w = bellyF(belly, x);
          const pl = lift(p); if (!pl) continue; const v = vox(pl); if (v < 0) continue; if (L[v] && phases[L[v]].fixed) continue; if (fixedAir[v]) continue;
          seeds[sg].push(v); inside[sg] += 1; } }
      const segN = seeds.map(a => a.length), segTot = segN.reduce((a, b) => a + b, 0);
      if (!segTot) continue;
      const famId = famOf(name + '.' + S_); muscleInfo[name + '.' + S_] = { Vcm3: +(Vt * 1e6).toFixed(1), segs: nSeg, inside: [] };
      // the belly volume of each segment = its share of the belly x the full volume; a segment with no belly is TENDON: its seed alone
      for (let sg = 0; sg < nSeg; sg++) { if (!seeds[sg].length) continue; const sh = tot > 0 ? share[sg] / tot : 1 / nSeg;
        // a segment whose line runs out of the region keeps only its inside share (the part above the top cut is the trunk's)
        const frac = Math.min(1, seeds[sg].length / Math.max(1, (segTot / nSeg) * (seeds[sg].length ? 1 : 1)));
        const Vseg = isTendon ? Vt : sh * Vt;
        add({ name: `${name}.${S_}.${sg}`, group: isTendon ? 'tendon' : isDeepFat ? 'deepfat' : 'muscle', fam: famId, side: s, fixed: false, V: Math.max(0, Vseg), seeds: Int32Array.from(new Set(seeds[sg])), muscle: name, seg: sg });
        muscleInfo[name + '.' + S_].inside.push(+frac.toFixed(2)); } } }
  tick('seeds', t); t = Date.now();
  // ---------------- tensions by group
  const T = { ...TENSION, ...(o.tension || {}) }, deepG = new Set(['muscle', 'deepfat', 'tendon']);
  const sigma = (a, b) => {
    const A = phases[a], Bp = phases[b], ga = A.group, gb = Bp.group;
    if (A.fam && A.fam === Bp.fam) return T.ownSegment;
    if (A.side && Bp.side && A.side !== Bp.side) return ga === 'fat' && gb === 'fat' ? 2 * T.skin : 4 * T.skin;   // left and right: only skin on skin
    const pair = (x, y) => (ga === x && gb === y) || (ga === y && gb === x);
    if (deepG.has(ga) && deepG.has(gb)) return T.epimysium;
    if (pair('air', 'fat')) return T.skin; if (ga === 'fat' && gb === 'fat') return T.fatSepta;
    if ((deepG.has(ga) && gb === 'fat') || (deepG.has(gb) && ga === 'fat')) return T.deepFascia;
    if ((deepG.has(ga) && gb === 'air') || (deepG.has(gb) && ga === 'air')) return T.deepFascia + T.skin + 0.5;
    if ((ga === 'bone' && deepG.has(gb)) || (gb === 'bone' && deepG.has(ga))) return T.boneDeep;
    if (pair('bone', 'fat')) return T.boneFat; if (pair('bone', 'air')) return T.boneAir;
    if ((ga === 'visc' && deepG.has(gb)) || (gb === 'visc' && deepG.has(ga))) return T.viscDeep; if (pair('visc', 'fat')) return T.viscFat; if (pair('visc', 'air')) return T.boneAir;
    if ((ga === 'trunk' && deepG.has(gb)) || (gb === 'trunk' && deepG.has(ga))) return T.trunkDeep; if (pair('trunk', 'fat')) return T.trunkFat; if (pair('trunk', 'air')) return T.skin;
    return T.skin; };
  // ---------------- (2) STAGE A: the deep compartment grows
  const nMus = phases.length;
  const resA = grow(G, L, phases, { sigma, fixedAir, steps: o.stepsA || { grow: 14, relax: 10 }, sigmaK: o.sigmaK ?? 1.4, log: r => log('A', JSON.stringify(r)) });
  tick('stageA', t); t = Date.now();
  // ---------------- (3) STAGE B: the subcutaneous fat. The shell: free air voxels touching the deep compartment, a bone or the pelvic contents
  for (let k = 1; k < nMus; k++) if (!phases[k].fixed) phases[k].fixed = true;   // the deep fascia holds its contents (stiffer than the fat's pressure)
  const isDeep = new Uint8Array(phases.length + 4096); for (let k = 1; k < phases.length; k++) if (deepG.has(phases[k].group) || phases[k].group === 'bone' || phases[k].group === 'visc') isDeep[k] = 1;
  const shell = []; for (let v = 0; v < G.n; v++) { if (L[v] || fixedAir[v]) continue; const i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / nxy); if (i < 1 || j < 1 || k < 1 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1) continue;
    if (isDeep[L[v - 1]] || isDeep[L[v + 1]] || isDeep[L[v - nx]] || isDeep[L[v + nx]] || isDeep[L[v - nxy]] || isDeep[L[v + nxy]]) shell.push(v); }
  // the limb's coordinates of a point: t (0 the hip's centre, 1 the knee, 2 the ankle; < 0 above the hip) and the bearing round the limb (deg: 0 anterior,
  // 90 lateral, 180 posterior, -90 medial)
  const ax = [['L', 1, FL], ['R', -1, FR]].map(([S_, s, F]) => { const Kn = F.K, A = (s > 0 ? ankL : ankR) || mad(Kn, [0, -1, 0], 0.4), uT = nrm(sub(Kn, F.H)), uC = nrm(sub(A, Kn));
    const l = nrm(sub(F.F.l, uT.map(c => c * dot(F.F.l, uT)))), a = nrm(sub(F.F.a, uT.map(c => c * dot(F.F.a, uT)))); return { s, H: F.H, Kn, A, uT, uC, l, a, LT: len(sub(Kn, F.H)), LC: len(sub(A, Kn)) }; });
  const limbCoord = (p, A) => { const dT = dot(sub(p, A.H), A.uT); let tt, c; if (dT <= A.LT) { tt = dT / A.LT; c = mad(A.H, A.uT, dT); } else { const dC = dot(sub(p, A.Kn), A.uC); tt = 1 + dC / A.LC; c = mad(A.Kn, A.uC, dC); }
    const r = sub(p, c), th = Math.atan2(dot(r, A.l), dot(r, A.a)) * 180 / Math.PI; return { t: tt, th }; };
  const RF = regionalFat(sx, (B.pf ?? (sx === 'f' ? 0.28 : 0.18)) * (B.bmi ?? 22) * B.stature * B.stature, B.age, B.stature);
  const Vlegs = RF.legs * (1 - IMAT.L) * 1000 * ADIPOSE_PER_LIPID * 1e-6, Vhip = RF.gynoid * HIP_PER_GYNOID * (1 - IMAT.G) * 1000 * ADIPOSE_PER_LIPID * 1e-6;
  const LP = LEG_PROFILE[sx], prof = tt => tt < 0.5 ? 1 : tt < 1 ? 1 + (LP.knee - 1) * (tt - 0.5) / 0.5 : tt < 1.3 ? LP.knee + (LP.calf - LP.knee) * (tt - 1) / 0.3 : tt < 2 ? LP.calf + (LP.ankle - LP.calf) * (tt - 1.3) / 0.7 : LP.ankle;
  // the site's propensity, blended smoothly round the limb and down it (cosine weights over ~40 deg and ~0.1 of a segment: no step between sites)
  const D = k => DEPOTS[k][sx], sw = (x, e0, w) => 0.5 + 0.5 * Math.tanh((x - e0) / w);
  const angW = (th, c, w = 50) => { let d = Math.abs(((th - c) % 360 + 540) % 360 - 180); return Math.max(0, Math.cos(Math.min(Math.PI / 2, d / w * Math.PI / 2))) ** 2; };
  const ring = (th, ant, lat, post, med) => { const w = [angW(th, 0, 90), angW(th, 90, 90), angW(th, 180, 90), angW(th, -90, 90)], s = w[0] + w[1] + w[2] + w[3] || 1; return (w[0] * ant + w[1] * lat + w[2] * post + w[3] * med) / s; };
  const propensity = (p, c) => {
    const thigh = ring(c.th, D('anteriorThigh'), D('lateralThigh'), D('posteriorThigh'), D('medialThigh')), hip = ring(c.th, D('anteriorThigh'), D('trochanteric'), D('gluteal'), D('medialThigh'));
    const knee = ring(c.th, D('kneeFront'), D('kneeLateral'), D('popliteal'), D('kneeMedial')), leg = ring(c.th, D('shin'), D('shin'), D('calf'), D('medialCalf'));
    const a1 = sw(c.t, 0.25, 0.06), a2 = sw(c.t, 0.85, 0.05), a3 = sw(c.t, 1.15, 0.05), a4 = sw(c.t, 1.85, 0.05);
    let v = hip * (1 - a1) + thigh * a1; v = v * (1 - a2) + knee * a2; v = v * (1 - a3) + leg * a3; v = v * (1 - a4) + D('ankle') * a4;
    if (Math.abs(p[0]) < 0.04 && p[1] > yPub - 2 * CM && p[2] > C[2]) v = D('mons'); if (Math.abs(p[0]) < 0.03 && p[2] < C[2] && p[1] > P.coccyxTip[1]) v = D('sacral');
    return v; };
  // the DXA leg line (the ROI's cut through the femoral neck, in the coronal view): from 4 cm above the greater trochanter laterally to the crotch medially
  const yCr = Math.min(P.ischTubL[1], P.ischTubR[1]) - 2 * CM, legLine = (x, A) => { const xg = Math.abs((A.s > 0 ? FL : FR).gt[0]) + 4 * CM, yg = (A.s > 0 ? FL : FR).gt[1] + 4 * CM; const f = Math.max(0, Math.min(1, Math.abs(x) / xg)); return yCr + (yg - yCr) * f; };
  // demand per shell voxel, its budget (legs | hip), the cells (farthest-point sampling at ~3 cm a side)
  const nS = shell.length, sSide = new Int8Array(nS), dem = new Float32Array(nS), bud = new Uint8Array(nS), tOf = new Float32Array(nS), q3 = [0, 0, 0];
  let Wl = 0, Wh = 0;
  for (let n = 0; n < nS; n++) { G.pos(shell[n], q3); const sd = q3[0] >= 0 ? 0 : 1, A = ax[sd], c = limbCoord(q3, A); sSide[n] = sd; tOf[n] = c.t;
    dem[n] = propensity(q3, c) * prof(Math.max(0, c.t)); bud[n] = q3[1] > legLine(q3[0], A) ? 1 : 0; if (bud[n]) Wh += dem[n]; else Wl += dem[n]; }
  const cellD = o.cell ?? 0.03, cellOf = new Int32Array(nS).fill(-1), centres = [];
  { const P3 = new Float32Array(nS * 3); for (let n = 0; n < nS; n++) { G.pos(shell[n], q3); P3[n * 3] = q3[0]; P3[n * 3 + 1] = q3[1]; P3[n * 3 + 2] = q3[2]; }
    // a coarse lattice of centres (one per cellD cube), each the shell voxel nearest its cube's centre; then every shell voxel to its nearest centre of its side
    const cub = new Map(); for (let n = 0; n < nS; n++) { const key = sSide[n] + ':' + Math.floor(P3[n * 3] / cellD) + ':' + Math.floor(P3[n * 3 + 1] / cellD) + ':' + Math.floor(P3[n * 3 + 2] / cellD); let e = cub.get(key); if (!e) cub.set(key, e = []); e.push(n); }
    for (const e of cub.values()) { let cx = 0, cy = 0, cz = 0; for (const n of e) { cx += P3[n * 3]; cy += P3[n * 3 + 1]; cz += P3[n * 3 + 2]; } cx /= e.length; cy /= e.length; cz /= e.length; let b = e[0], bd = Infinity; for (const n of e) { const d = (P3[n * 3] - cx) ** 2 + (P3[n * 3 + 1] - cy) ** 2 + (P3[n * 3 + 2] - cz) ** 2; if (d < bd) { bd = d; b = n; } } if (e.length >= 3) centres.push(b); }
    // nearest centre (a bucket grid of centres)
    const cb = new Map(), cK = (x, y, z) => Math.floor(x / cellD) + ':' + Math.floor(y / cellD) + ':' + Math.floor(z / cellD);
    centres.forEach((n, ci) => { const key = cK(P3[n * 3], P3[n * 3 + 1], P3[n * 3 + 2]); let e = cb.get(key); if (!e) cb.set(key, e = []); e.push(ci); });
    for (let n = 0; n < nS; n++) { const x = P3[n * 3], y = P3[n * 3 + 1], z = P3[n * 3 + 2], ix = Math.floor(x / cellD), iy = Math.floor(y / cellD), iz = Math.floor(z / cellD); let b = -1, bd = Infinity;
      for (let a = -1; a <= 1; a++) for (let bb = -1; bb <= 1; bb++) for (let cc = -1; cc <= 1; cc++) { const e = cb.get((ix + a) + ':' + (iy + bb) + ':' + (iz + cc)); if (!e) continue; for (const ci of e) { const m = centres[ci]; if (sSide[m] !== sSide[n]) continue; const d = (P3[m * 3] - x) ** 2 + (P3[m * 3 + 1] - y) ** 2 + (P3[m * 3 + 2] - z) ** 2; if (d < bd) { bd = d; b = ci; } } }
      cellOf[n] = b; } }
  const nCell = centres.length, cellV = new Float64Array(nCell), cellSeeds = Array.from({ length: nCell }, () => []), cellAll = Array.from({ length: nCell }, () => []);
  for (let n = 0; n < nS; n++) { const ci = cellOf[n]; if (ci < 0) continue; cellV[ci] += dem[n] * (bud[n] ? Vhip / Wh : Vlegs / Wl); cellAll[ci].push(shell[n]); }
  centres.forEach((n, ci) => cellSeeds[ci].push(shell[n]));
  const fat0 = phases.length;
  for (let ci = 0; ci < nCell; ci++) { const k = add({ name: 'fat.' + ci, group: 'fat', fam: 0, side: sSide[centres[ci]] === 0 ? 1 : -1, fixed: false, column: true, V: cellV[ci], seeds: Int32Array.from(cellSeeds[ci]) });
    for (const v of cellAll[ci]) L[v] = k; }
  // THE COLUMNS (the retinacula cutis): every free air voxel within reach belongs to the lobule whose patch of the fascia is nearest it (a multi-source
  // Dijkstra over the voxels from the shell, 26-neighbour steps), so a lobule grows outward from its own patch and never over its neighbour's
  const column = new Int32Array(G.n).fill(-1);
  { const dist = new Float32Array(G.n).fill(Infinity), maxR = (o.columnReach ?? 0.10) / h, NB = []; for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (di || dj || dk) NB.push([di, dj, dk, Math.hypot(di, dj, dk)]);
    const B2 = 0.25, buckets = []; const push = (v, d) => { const b = Math.floor(d / B2); (buckets[b] ||= []).push(v); };
    for (let ci = 0; ci < nCell; ci++) for (const v of cellAll[ci]) { dist[v] = 0; column[v] = fat0 + ci; push(v, 0); }
    for (let b = 0; b < buckets.length; b++) { const q = buckets[b]; if (!q) continue; for (let n = 0; n < q.length; n++) { const v = q[n], d0 = dist[v]; if (Math.floor(d0 / B2) !== b) continue; if (d0 > maxR) continue;
      const i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / nxy);
      for (const [di, dj, dk, w] of NB) { const ii = i + di, jj = j + dj, kk = k + dk; if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue; const u = ii + nx * jj + nxy * kk;
        if (L[u] || fixedAir[u]) continue; const nd = d0 + w; if (nd < dist[u]) { dist[u] = nd; column[u] = column[v]; push(u, nd); } } } buckets[b] = null; } }
  info.fat = { Vlegs_cm3: +(Vlegs * 1e6).toFixed(0), Vhip_cm3: +(Vhip * 1e6).toFixed(0), RF: Object.fromEntries(Object.entries(RF).map(([k, v]) => [k, +v.toFixed(2)])), cells: nCell, shell: nS };
  tick('stageBsetup', t); t = Date.now();
  const resB = grow(G, L, phases, { sigma, fixedAir, column, steps: o.stepsB || { grow: 14, relax: 8 }, sigmaK: o.sigmaK ?? 1.4, log: r => log('B', JSON.stringify(r)) });
  tick('stageB', t); t = Date.now();
  // ---------------- (4) the fields the surfaces are taken from
  const grp = k => phases[k]?.group;
  const fields = { tissue: groupField(G, L, k => k > 0, o.sigmaK ?? 1.4), deep: groupField(G, L, k => deepG.has(grp(k)), o.sigmaK ?? 1.4) };
  tick('fields', t);
  info.muscles = muscleInfo; info.legLeanKg = +MV.legLeanKg.toFixed(2); info.hf = +MV.hf.toFixed(3); info.ms = Date.now() - t0;
  info.stageA = { ms: resA.ms, phases: resA.phases.filter(p => p.Vtcm3 != null).map(p => [p.name, p.Vcm3, p.Vtcm3]) };
  info.stageB = { ms: resB.ms, fatCm3: resB.phases.slice(fat0).reduce((s, p) => s + p.Vcm3, 0), fatTargetCm3: resB.phases.slice(fat0).reduce((s, p) => s + (p.Vtcm3 || 0), 0) };
  return { G, L, phases, fields, BF, info, yCut, yAnk, limbCoord, ax };
}

// 2-D convex hull (monotone chain) and a point-in-hull test
function hull2(pts) { const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1)); }
function inHull(H, x, z) { for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length]; if ((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false; } return true; }
