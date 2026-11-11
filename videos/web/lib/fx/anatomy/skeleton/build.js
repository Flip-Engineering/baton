// ANATOMY / SKELETON / BUILD (ANAT8-BODY, 8 Oct 2026): the person's skeleton as SDF parts, placed by the rig's joint centres and sized by sex,
// stature and segment length. NOTES.md D2: a long bone's LENGTH is the person's joint-to-joint distance, its WIDTHS are osteometric means by
// sex scaled by that length; the trunk's bony frame (pelvis, column levels, sternum, scapulae) is placed from the joints and FITTED to the
// palpable landmarks minus their soft-tissue depth (a radiologist's inference), clamped to the osteometric range.
//
//   const K = buildSkeleton(B, opts)    B = bodyOf(S, built, rec)
//   K = { parts: [part ...] (sdf.js), groups: { spine, ribs, sternum, girdle, pelvis, arm, hand, leg, foot }, pts: { <bony landmark>: [x, y, z] },
//         info: { tilt, tiltSkin, pw, levels, sternum, cage, ... }, tests: [{ skin, part?, lo, hi }] }
// Dimensions: centimetres in the tables, scaled; MALE reference at stature 175.5 cm, FEMALE at 162.5 cm. The numbers are textbook osteometric
// means as I know them (Gray's; Bass, Human Osteology; Harrington et al. 2007 for the hip joint; Bellemare et al. 2003 for the rib cage's sex
// difference), typed from memory, NOT yet checked against a measured atlas: the atlas subsets (BodyParts3D / Z-Anatomy, CC BY-SA, measuring
// only) are iteration 2's check. Every one is a parameter here, so a correction is one number.
import { cone, sphere, ell, box, tube, sheet, ribbon, part, sdParts, sdPart, shiftPart } from './sdf.js';
import { profile, skinNormals, rayToSkin, midline, oralLining } from './body.js';
import { headFrameFH } from '../skull/frame.js';   // ANAT8-HEAD's craniometric frame (the neck seam: C1 hangs under HEAD's basion)
// SKELETON_VERSION 2 (iteration 2, 8 Oct): placement by anatomy where iteration 1 copied misplaced hm08 landmarks (the measurer's it1 verdict):
// C1 under the basion (not hm08's 'tragion', 5 cm behind the ear canal); the scapulae by the column's levels (not hm08's scapRoot / scapInf, ~4
// levels low); the pelvic tilt from the literature by sex (a +-2.5 deg window for the depth fit); the greater trochanter's reach 2.4 cm; the tibia
// fitted along its crest; the hand bones fitted inside the hand's skin; ribs 11-12 in the lateral fit; the sternum's slope 14-25 deg.
// SKELETON_VERSION 3 (c2 iteration 1, 8 Oct): THE ANTERIOR CHEST WALL from a measured atlas, not from memory. The checker (CHECK.md 4) showed the sternum is
// normal (sourced: MSCT, Folia Morphol 2018: manubrium + body women 133, men 154 mm; ours 1 / -8 %); the fault is the costal cartilages 4-7: in v2 they
// dropped 1.0 / 2.0 / 3.4 / 5.4 cm to costochondral junctions (CCJs) 0.54-0.73 of the rib's half-width out, so the ribs on the midclavicular line sat 2-3 cm
// high (chest_test.mjs: the men's 4th space 10.2 cm under the notch in L21 against ANSUR II's nipple 15.3, z -2.9). Measured on BodyParts3D's male
// (CC BY-SA 2.1 JP, measurement only; ~/.cache/acp_human/atlas/bp3d, measures/bp3d_chest.json): the sternal ends of cartilages 3-6 at 0.27 / 0.51 / 0.72 /
// 0.90 of the sternal body (v2 0.20 / 0.42 / 0.62 / 0.80), the CCJs of 4-7 at 0.50 / 0.63 / 0.68 / 0.79 of the rib's half-width, 0.13 / 0.26 / 0.37 / 0.53
// of the sternum (manubrium + body) BELOW their sternal ends. (v2 deleted in lane iteration 10: one current version; git history keeps it.)
export const SKELETON_VERSION = 3;
// FACE's P2 landmark ids on hm08 (assets/face/landmarks.json 'ids'; the mesh topology is fixed): the tragions, the nasion and the orbitales, for the
// craniometric frame when the caller does not pass them (opts.faceIds / B.faceIds)
export const FACE_IDS = { t_L: 12048, t_R: 5449, n: 132, or_L: 6918, or_R: 140 };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]), nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mad = (o, ...terms) => { const r = o.slice(); for (let i = 0; i < terms.length; i += 2) { r[0] += terms[i][0] * terms[i + 1]; r[1] += terms[i][1] * terms[i + 1]; r[2] += terms[i][2] * terms[i + 1]; } return r; };
const ss = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const KJ = 1.7;   // the knee's joint line below the rig's knee joint (cm, male; the rig's knee sits at the flexion axis)
const CM = 0.01, X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
// a bone frame: u along the bone (proximal -> distal), a anterior (from a hint, orthogonalised), l = lateral for the side (s = +1 left, -1 right)
function frameOf(u, aHint, s) { u = nrm(u); let a = sub(aHint, mul(u, dot(aHint, u))); a = nrm(a); let l = crs(u, a); if (dot(l, X) * s < 0) l = mul(l, -1); return { u, a, l }; }
// local (lateral, along, anterior) in cm, times k -> world
const at = (o, F, x, y, z, k = 1) => [o[0] + (F.l[0] * x + F.u[0] * y + F.a[0] * z) * CM * k, o[1] + (F.l[1] * x + F.u[1] * y + F.a[1] * z) * CM * k, o[2] + (F.l[2] * x + F.u[2] * y + F.a[2] * z) * CM * k];
const axesOf = F => [F.l, F.u, F.a];
// ---------------------------------------------------------------- reference dimensions (cm), male at 175.5, female at 162.5
export const DIMS = {
  stature: { m: 175.5, f: 162.5 },
  femurHead: { m: 2.4, f: 2.1 }, femurNeck: { m: 5.3, f: 4.8 }, neckShaft: { m: 127, f: 125 }, antev: { m: 12, f: 14 }, femurShaft: { m: 1.45, f: 1.28 },
  humerusHead: { m: 2.3, f: 2.0 }, humerusShaft: { m: 1.1, f: 0.95 },
  clavicle: { m: 15.0, f: 13.6 }, scapulaH: { m: 15.5, f: 14.0 },
  patella: { m: [2.2, 2.15, 1.05], f: [2.0, 1.95, 0.95] },
  sternum: { m: [5.0, 10.0, 3.0], f: [4.6, 8.6, 2.6] },
  // pelvis (Harrington's pelvic frame: origin at the ASIS midpoint, ASIS-PSIS plane horizontal): bi-ASIS and depth
  // tilt: the standing ASIS-PSIS angle (anterior positive), the literature's means by sex (women ~11-13, men ~8-10: the measurer's it1 D); the depth
  // fit may move it by tiltWin either way (iteration 1's free fit reversed the sex trend by trading the tilt against the v6 posture; with a 2.5 deg
  // window, then a 1 deg one, it ran to the window's edges every time, women down and men up: the assumed ASIS / PSIS tissue depths and v6's lower
  // back disagree, so the tilt is the literature's (window 0) and the fit sizes the pelvis; the residual is reported in info.pelvis.fit)
  pw: { m: 23.5, f: 24.0 }, pd: { m: 15.5, f: 15.0 }, tilt: { m: 8.5, f: 12 }, tiltWin: 0,
  // the scapula: the root of its spine from the midline (cm; resting, arms down) and the sternum's slope window (deg from the vertical, top back)
  scapRootX: { m: 6.0, f: 5.6 }, sternSlope: { m: [14, 25], f: [15, 25] },
  // rib cage external half-width by rib (1..12), male; women x0.93 at the same stature (Bellemare 2003: smaller cage for the same lungs)
  ribWf: 0.93,
  ribZp: [2.0, 3.2, 3.9, 4.3, 4.4, 4.4, 4.4, 4.4, 4.4, 4.2, 4.0, 3.6],                    // posterior reach of the rib angle behind the body centre
  ribH: [0.9, 0.62, 0.66, 0.68, 0.7, 0.7, 0.7, 0.68, 0.66, 0.6, 0.5, 0.4],                // rib shaft half-height
  cart: [2.5, 3.0, 3.6, 4.5, 5.6, 7.0, 9.5],                                               // costal cartilage length (ribs 1-3: the CCJ by length)
  // v3 (the atlas, above): the CCJ's drop (cm at the male reference: the atlas' fraction of its sternum x 15 cm; rib 1 kept), the CCJ's lateral reach as a
  // fraction of the rib's own half-width (ribs 4-7; 1-3 keep the cartilage length), the sternal attachments of cartilages 3-6 along the body
  // v3: the half-widths from the atlas's ratios to rib 7 (0.50 / 0.71 / 0.79 / 0.85 / 0.93 / 0.98 / 1 / 0.97 / 0.94 / 0.90 / 0.81 / 0.63) x 13.7: v2's upper
  // cage was 7-14 % narrower (the midclavicular line met ribs 2-3 near their lateral extremes) and its lower cage widest at rib 8; the global width is
  // fitted at rib 7's lateral extreme in v3 (rib 8's now lies 4-6 cm lower, at the waist), ribs 7-10 each to the skin at their own height as before
  ribW3: [6.85, 9.7, 10.8, 11.65, 12.7, 13.4, 13.7, 13.3, 12.9, 12.3, 11.1, 8.6],
  // v3: ribs 8-12 descend from the head, not at the front: the atlas puts their lateral extremes 71 / 76 / 87 / 91 % of the way from the head's level to the
  // anterior tip (v2's front-loaded curve: 36 %, so the lower cage's sides sat 4-6 cm high and the waist's skeleton was wrong); g = 1 - (1 - t)^p
  ribDescent3: [1.6, 1.85, 2.5, 1.9, 2.5],
  cartDrop3: [1.0, 0.3, -0.6, 1.9, 4.0, 5.6, 8.0], cartX3: [0, 0, 0, 0.50, 0.63, 0.68, 0.79], attB3: [0.27, 0.51, 0.72, 0.90],
};
// vertebrae (male): body width, depth, height; spinous length (from the body's back), its drop; TP half-span; TP tip behind the body centre; body+disc spacing
const VERT = {
  C1: [2.0, 1.2, 1.0, 1.2, 0.0, 4.0, 0.6, 1.8], C2: [2.0, 1.6, 2.0, 3.0, 0.6, 2.6, 0.5, 2.0], C3: [2.1, 1.6, 1.4, 2.4, 0.6, 2.7, 0.3, 1.75], C4: [2.2, 1.6, 1.4, 2.5, 0.6, 2.7, 0.3, 1.75],
  C5: [2.3, 1.6, 1.4, 2.6, 0.6, 2.8, 0.3, 1.75], C6: [2.4, 1.6, 1.4, 2.9, 0.8, 2.9, 0.4, 1.7], C7: [2.6, 1.7, 1.5, 4.2, 1.2, 3.4, 0.7, 1.8],
  T1: [2.8, 1.8, 1.6, 4.3, 1.8, 3.8, 1.6, 2.0], T2: [2.8, 2.1, 1.8, 4.4, 2.4, 3.6, 1.9, 2.1], T3: [2.8, 2.3, 1.85, 4.4, 2.5, 3.5, 1.9, 2.2], T4: [2.9, 2.5, 1.9, 4.4, 2.6, 3.4, 2.0, 2.25],
  T5: [3.0, 2.6, 2.0, 4.4, 2.7, 3.3, 2.0, 2.3], T6: [3.1, 2.7, 2.1, 4.4, 2.7, 3.2, 2.0, 2.4], T7: [3.2, 2.8, 2.2, 4.3, 2.6, 3.1, 2.0, 2.45], T8: [3.3, 2.85, 2.25, 4.2, 2.4, 3.0, 2.0, 2.55],
  T9: [3.4, 2.9, 2.3, 4.1, 2.2, 2.9, 2.0, 2.6], T10: [3.6, 3.0, 2.4, 3.8, 1.8, 2.6, 1.8, 2.7], T11: [3.9, 3.1, 2.5, 3.6, 1.4, 2.4, 1.6, 2.85], T12: [4.2, 3.2, 2.6, 3.4, 1.0, 2.2, 1.4, 3.0],
  L1: [4.4, 3.2, 2.6, 3.4, 0.6, 3.2, 1.0, 3.6], L2: [4.6, 3.3, 2.7, 3.4, 0.6, 3.8, 1.0, 3.75], L3: [4.9, 3.4, 2.7, 3.4, 0.5, 4.4, 1.0, 3.8], L4: [5.0, 3.4, 2.7, 3.3, 0.5, 4.0, 1.0, 3.8],
  L5: [5.2, 3.4, 2.6, 3.0, 0.5, 3.6, 0.8, 3.6],
};
const LEVELS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'L1', 'L2', 'L3', 'L4', 'L5'];
// soft-tissue depth over the subcutaneous bony landmarks (mm, lean-to-average adults; women thicker where fat lies): approximate literature
// ranges as I know them (ultrasound / CT soft-tissue thickness studies and the gait-marker literature), the TEST of the bones not fitted to them
export const TISSUE = {
  clavicleMid: [3, 12], acromion: [4, 14], suprasternale: [6, 22], xiphoid: [8, 30], cervicale: [5, 16], scapRoot: [6, 22], scapInf: [8, 28],
  olecranon: [3, 10], latEpicondyle: [3, 12], medEpicondyle: [3, 10], ulnarHead: [2, 8], radialStyloid: [2, 8], met3: [3, 9],
  asis: [8, 35], iliacCrest: [10, 45], psis: [6, 28], sacrum: [6, 25], trochanter: [15, 60], patella: [3, 12], tibialTub: [3, 10],
  latMalleolus: [2, 8], medMalleolus: [2, 8], heel: [8, 22], rib10: [8, 40], pubis: [12, 50], tibialShaft: [2, 9], sternum: [6, 25], deltoid: [12, 40],
  prevert: [2, 8], tibialCrest: [2, 9], nuchal: [15, 50],
};
// ---------------------------------------------------------------- the build
export function buildSkeleton(B, opts = {}) {
  const sexF = B.sex === 'f', sx = sexF ? 'f' : 'm', D = k => DIMS[k][sx], st = B.stature * 100, sT = st / DIMS.stature[sx];
  const cartDrop = DIMS.cartDrop3, attB = DIMS.attB3;
  const fatK = clamp(((B.pf ?? 0.25) - (sexF ? 0.25 : 0.15)) / 0.1, -1, 2);       // soft-tissue thickening by body fat (per 10 % over the sex's healthy mid)
  const geo = {};   // construction geometry for the layers above (muscle/: attachments by name); additive, never read by the skeleton itself
  const J = B.J, lm = B.lm, parts = [], pts = {}, rays = [], info = { sex: B.sex, stature: B.stature, sT, version: SKELETON_VERSION }, tests = [], P = profile(B), Nsk = skinNormals(B);
  const skinN = k => { const v = B.lmIdx[k]; return [Nsk[v * 3], Nsk[v * 3 + 1], Nsk[v * 3 + 2]]; };
  const inward = (k, mm) => mad(lm[k], skinN(k), -mm / 1000);                     // a skin landmark moved in along the skin normal (mm)
  const add_ = (name, prims, group, k = 0.004, meta = {}) => { const p = part(name, prims.flat(), { k, group, meta }); parts.push(p); return p; };
  const j = (n, e = 'h') => J[n][e];
  // ============================================================ PELVIS (Harrington's pelvic frame, canonical cm, left side x > 0)
  const HL = j('upperleg01.L'), HR = j('upperleg01.R'), Hm = lerp(HL, HR, 0.5), hjX = (HL[0] - HR[0]) / 2 * 100;
  const pwRef = D('pw') * sT, pwSkin = Math.abs(lm.asisL[0] - lm.asisR[0]) * 100 - 2 * 0.8;
  const PW = clamp(pwSkin, 0.9 * pwRef, 1.12 * pwRef), sv = sT * (sexF ? 0.97 : 1);
  const sxTop = PW / 23.5, sxBot = hjX / 8.9, tA = (sexF ? 22 : 15) + 6 * Math.max(0, fatK), tP = 12 + 4 * Math.max(0, fatK);
  const pdSkin = ((lm.asisL[2] - lm.psisL[2]) + (lm.asisR[2] - lm.psisR[2])) / 2 * 100 - (tA + tP) / 10, pdRef = D('pd') * sv, sz = sv * D('pd') / 15.5;   // pdSkin is reported only: the skin's ASIS landmark sits on a thick layer in front of the bone
  // the standing tilt (ASIS-PSIS line, anterior positive): the literature mean by sex unless asked; the skin's own (landmarks) is reported
  const tiltSkin = Math.atan2(((lm.psisL[1] + lm.psisR[1]) - (lm.asisL[1] + lm.asisR[1])) / 2, ((lm.asisL[2] + lm.asisR[2]) - (lm.psisL[2] + lm.psisR[2])) / 2) * 180 / Math.PI;
  let tilt = opts.tilt ?? D('tilt'), th = tilt * Math.PI / 180, ct = Math.cos(th), st_ = Math.sin(th);
  const setTilt = t => { tilt = t; th = t * Math.PI / 180; ct = Math.cos(th); st_ = Math.sin(th); };
  const W = (p, side = 1) => { const [x, y, z] = p, w = ss((-2 - y) / 5), k = sxTop + (sxBot - sxTop) * w, yy = y * sv * kP, zz = z * sz * kP;
    return [side * x * k * CM, (yy * ct - zz * st_) * CM, (yy * st_ + zz * ct) * CM]; };
  let O = null; const place = () => { const hjc0 = W([8.9, -8.1, -4.7]); O = [Hm[0], Hm[1] - hjc0[1], Hm[2] - hjc0[2]]; };   // the ASIS midpoint, so the canonical HJC lands on the rig's
  const PW_ = (p, side = 1) => add(O, W(p, side));
  // the pelvis FITTED to its palpable landmarks: the standing tilt and the sagittal size (kP) that put the PSIS ~12 mm under the skin behind them, the
  // ASIS ~15 mm (men) / 22 mm (women) under the skin in front (more with fat), and the PSIS near the dimples' height (weak weight). A grid over tilt and
  // kP; what remains (the residuals) is a finding about the v6 posture, reported (NOTES).
  let kP = 1; const pfit = {}; if (opts.tilt == null && opts.tiltFit !== false) {
    const yD = (lm.psisL[1] + lm.psisR[1]) / 2; let best = null;
    const t0 = D('tilt') - DIMS.tiltWin, t1 = D('tilt') + DIMS.tiltWin + 1e-6;
    for (let t = t0; t <= t1; t += 0.5) for (let k = 0.88; k <= 1.065; k += 0.03) { setTilt(t); kP = k; place();
      const pL = PW_([4.6, 0, -16.2], 1), aL = PW_([11.75, 0, 0.5], 1), rP = rayToSkin(B, pL, [0, 0, -1]) * 1000, rA = rayToSkin(B, aL, nrm([0.3, 0, 1])) * 1000;
      const eP = rP < 1e6 ? (rP - tP) / 6 : 8, eA = rA < 1e6 ? (rA - tA) / 8 : 8, eY = (pL[1] - yD) * 1000 / 20, e = eP * eP + eA * eA + eY * eY;
      if (!best || e < best.e) best = { e, t, k, rP, rA, dy: (pL[1] - yD) * 1000 }; }
    setTilt(best.t); kP = best.k; Object.assign(pfit, { err: +best.e.toFixed(2), psisMm: +best.rP.toFixed(1), asisMm: +best.rA.toFixed(1), psisDyMm: +best.dy.toFixed(1) }); }
  place();
  info.pelvis = { pw: +PW.toFixed(1), pwSkin: +pwSkin.toFixed(1), pwRef: +pwRef.toFixed(1), hjX: +hjX.toFixed(2), pdSkin: +pdSkin.toFixed(1), sz: +(sz / sv).toFixed(3), sxTop: +sxTop.toFixed(3), sxBot: +sxBot.toFixed(3), tilt: +tilt.toFixed(1), tiltLit: D('tilt'), tiltSkin: +tiltSkin.toFixed(1), kP: +kP.toFixed(3), fit: pfit };
  const F_ = (m, f) => sexF ? f : m;   // a canonical number, male or female
  for (const side of [1, -1]) {
    const S_ = side > 0 ? 'L' : 'R', pp = p => PW_(p, side);
    const crestY = F_(1, 0.84);
    const crest = [[11.75, 0, 0], [13.2, 1.4, -2.6], [14.0, 2.4, -5.2], [13.6, 3.4, -8.0], [11.8, 3.9, -10.8], [9.2, 3.2, -13.4], [6.6, 1.5, -15.0], [4.6, 0, -15.6]].map(([x, y, z]) => [x, y * crestY, z]);
    const lower = [[10.6, -4.0, -0.9], [10.4, -5.4, -3.3], [9.9, -5.4, -6.4], [8.6, -6.4, -9.4], [7.0, -5.6, -11.6], [5.9, -3.6, -13.2], [5.2, -1.8, -14.6], [4.7, -1.6, -15.5]];
    const bow = [0.3, 1, 1, 1, 0.8, 0.4, 0.2, 0], rows = [], thk = [];
    const thC = [0.55, 0.6, 0.85, 0.7, 0.65, 0.6, 0.6, 0.65], thL = [0.6, 1.0, 1.2, 1.0, 0.9, 0.9, 0.7, 0.6];
    for (const t of [0, 0.33, 0.66, 1]) { rows.push(crest.map((c, i) => { const q = lerp(c, lower[i], t); q[0] -= 1.3 * bow[i] * Math.sin(Math.PI * t); return pp(q); }));
      thk.push(crest.map((_, i) => (t === 0 ? thC[i] : t === 1 ? thL[i] : 0.24 + 0.1 * (1 - bow[i])) * CM * sv)); }
    const HJ = side > 0 ? HL : HR, hjL = [8.9, -8.1, -4.7];
    const ac = mad(HJ, [side, 0, 0], -1.2 * CM * sv, Y, 0.4 * CM * sv, Z, -0.4 * CM * sv);
    const pr = [sheet(rows, thk), ell(ac, [X, Y, Z], [2.0, 3.3, 3.4].map(v => v * CM * sv)),
      tube([pp(lower[1]), mad(HJ, [side, 0, 0], -0.5 * CM, Y, 2.0 * CM * sv, Z, 0.5 * CM * sv)], [1.5 * CM * sv, 1.6 * CM * sv]),
      tube([pp(lower[3]), mad(HJ, [side, 0, 0], -0.8 * CM, Y, 1.5 * CM * sv, Z, -2.2 * CM * sv)], [1.3 * CM * sv, 1.5 * CM * sv])];
    // ischium and pubis (women: the subpubic arch and the tuberosities wider, the lower pelvis shorter)
    const lw = (x, d) => x + (sexF ? d : 0), lh = y => y * (sexF && y < -9 ? 0.93 : 1);
    const q = (x, y, z, d = 0) => pp([lw(x, d), lh(y), z]);
    pr.push(tube([q(8.4, -10.6, -7.2), q(7.4, -14.0, -8.4, 0.6), q(6.6, -16.2, -8.6, 1.0)], [1.6, 1.3, 1.2].map(v => v * CM * sv)));
    const tub = q(6.4, -16.8, -8.2, 1.0); pr.push(ell(tub, [X, nrm([0, 1, 0.35]), nrm([0, -0.35, 1])], [1.3, 2.3, 1.8].map(v => v * CM * sv)));
    pr.push(cone(q(7.2, -11.8, -9.8, 0.4), q(5.4, -12.0, -10.6, 0.4), 0.6 * CM * sv, 0.3 * CM * sv));                                   // ischial spine
    pr.push(tube([q(6.2, -17.8, -6.6, 1.0), q(4.6, -16.8, -3.6, 1.0), q(3.4, -15.0, -1.2, 1.0)], [0.9, 0.75, 0.7].map(v => v * CM * sv)));   // ischial ramus
    pr.push(tube([q(3.4, -15.0, -1.2, 1.0), q(2.3, -13.3, 0.2, 0.7), q(1.6, -11.8, 1.0, 0.3)], [0.7, 0.7, 0.8].map(v => v * CM * sv)));   // inferior pubic ramus
    const pb = q(1.7, -10.6, 1.4, 0.3); pr.push(ell(pb, [X, nrm([0, 1, -0.25]), nrm([0, 0.25, 1])], [1.25, F_(2.1, 1.85), 1.0].map(v => v * CM * sv)));   // pubic body
    pr.push(tube([q(2.2, -9.5, 1.7, 0.3), q(4.4, -9.1, 0.9, 0.3), q(6.4, -8.8, -0.7, 0.15), q(8.0, -8.9, -2.6)], [0.8, 0.75, 0.85, 1.2].map(v => v * CM * sv)));   // superior ramus
    pr.push(sphere(q(2.6, -9.0, 2.4, 0.3), 0.45 * CM * sv));
    add_('coxa.' + S_, pr, 'pelvis', 0.006 * sv);
    pts['asis' + S_] = pp([11.75, 0, 0.5]); pts['psis' + S_] = pp([4.6, 0, -16.2]); pts['crestTub' + S_] = pp([14.6, 2.4 * crestY, -5.2]); pts['crestTop' + S_] = pp([11.8, 4.5 * crestY, -10.8]);
    pts['ischTub' + S_] = q(6.4, -18.9, -8.2, 1.0);
    geo['pelvis' + S_] = { crest: crest.map(pp), lower: lower.map(pp), at: pp, q, hj: HJ };
    rays.push({ name: 'asis' + S_, o: pts['asis' + S_], d: nrm([side * 0.3, 0, 1]), key: 'asis' }, { name: 'crestTub' + S_, o: pts['crestTub' + S_], d: [side, 0, 0], key: 'iliacCrest' }, { name: 'psis' + S_, o: pts['psis' + S_], d: [0, 0, -1], key: 'psis' }); pts['pubTub' + S_] = q(2.6, -9.0, 2.85, 0.3);
  }
  // sacrum and coccyx (women: alae wider, shorter, flatter)
  { const aw = F_(1, 1.08), ln = F_(1, 0.93), pc = (x, y, z) => PW_([x * aw, y * ln, z]);
    const cl = [[0, -2.6, -10.2], [0, -5.4, -11.9 + F_(0, 0.3)], [0, -8.0, -12.7 + F_(0, 0.4)], [0, -10.3, -12.8 + F_(0, 0.3)], [0, -12.2, -12.3]];
    const wx = [5.3, 4.6, 3.6, 2.4, 1.4], tk = [2.0, 1.7, 1.2, 0.8, 0.55];
    const rowsS = [cl.map(([, y, z], i) => pc(wx[i], y, z)), cl.map(([, y, z]) => pc(0, y, z - 0.2)), cl.map(([, y, z], i) => pc(-wx[i], y, z))];
    const S1 = pc(0, -2.4, -10.0), S1t = nrm(sub(pc(0, -1.0, -9.6), pc(0, -4.4, -11.0)));
    const Fs = frameOf(S1t, Z, 1);
    const pr = [sheet(rowsS, [tk, tk, tk].map(r => r.map(v => v * CM * sv))), box(S1, axesOf(Fs), [2.6, 1.35, 1.8].map(v => v * CM * sv), 0.5 * CM * sv),
      ell(pc(3.8, -2.4, -10.8), [X, Y, Z], [2.2, 1.6, 2.4].map(v => v * CM * sv)), ell(pc(-3.8, -2.4, -10.8), [X, Y, Z], [2.2, 1.6, 2.4].map(v => v * CM * sv)),
      tube([pc(0, -3.4, -13.4), pc(0, -6.0, -14.4), pc(0, -8.6, -14.6), pc(0, -10.5, -14.1)], 0.45 * CM * sv)];
    add_('sacrum', pr, 'pelvis', 0.006 * sv);
    add_('coccyx', [tube([pc(0, -12.6, -11.6), pc(0, -13.6, -10.8), pc(0, -14.7, -9.6), pc(0, -15.5, -8.3)], [0.9, 0.7, 0.55, 0.4].map(v => v * CM * sv))], 'pelvis', 0.003);
    rays.push({ name: 'sacrumS3', o: pc(0, -8.6, -15.1), d: [0, 0, -1], key: 'sacrum' }, { name: 'pubicSymph', o: pc(0, -10.0, 2.4), d: [0, 0, 1], key: 'pubis' });
    geo.sacrum = { rows: rowsS, at: pc };
    pts.S1 = S1; pts.S1top = pc(0, -1.0, -9.6); pts.sacrumS3 = pc(0, -8.4, -15.1); pts.coccyxTip = pc(0, -16.2, -8.6);
    info.S1 = S1;
  }
  // ============================================================ COLUMN: S1 (pelvis) .. C7 (fitted to cervicale) .. C1 (below the tragion)
  const vk = sexF ? 0.92 : 1, vs = v => v * vk * sT;
  const c7tip = inward('cervicale', 9 + 3 * Math.max(0, fatK)), c7 = mad(c7tip, Y, 1.0 * CM * sT, Z, 5.0 * CM * sT * vk);
  // C1 under the skull's BASION (the ANAT8 neck seam): in ANAT8-HEAD's craniometric frame (skull/frame.js; mm, origin the bony porions (FACE's tragion
  // ids 8 mm back and medial), y normal to the Frankfurt horizontal) the basion lies ~20.5 mm under the FH (HEAD's rule) and ~5 mm behind the porion
  // (Ricketts' cranial deflection: Ba-N ~27 deg to the FH at a BNL of ~98-105 mm); the atlas ring's centre 13 mm under and 3 mm behind it (the dens
  // under the basion, the anterior arch in front). Then FITTED to the PREVERTEBRAL depth (below, after the cervical levels): the pharynx's back wall
  // (hm08's oral lining) 3.5 mm or more in front of C2's and C3's bodies (adults 2-7 mm), the column's top moved -14..+12 mm; the move is the seam's residual
  // for HEAD. Iteration 1 hung C1 under hm08's 'tragion' landmark, 4-5 cm BEHIND FACE's tragion (on the back of the ear): C1-C3 met the nape.
  const fids = opts.faceIds || B.faceIds || FACE_IDS, frH = headFrameFH(B.pos, fids, { sex: B.sex });
  const Ba = frH.toBind([0, -20.5, -5]), c1 = (q => [0, q[1], q[2]])(frH.toBind([0, -33.5, -8]));
  pts.basion = [0, Ba[1], Ba[2]]; info.neck = { basion: Ba.map(v => +(v * 100).toFixed(1)), hm08TragionBehindPorionCm: +(-(frH.toMm(lerp(lm.tragionL, lm.tragionR, 0.5))[2]) / 10).toFixed(1) };
  // the thoracolumbar centreline: the rig's spine chain between S1 and C7, sorted by height, then the levels by the spacing table along its arc
  const S1c = info.S1, chain = ['spine04', 'spine03', 'spine02', 'spine01'].map(n => j(n)).filter(p => p[1] > S1c[1] + 0.03 && p[1] < c7[1] - 0.03);
  const ctrl = [S1c, ...chain, c7].map(p => [0, p[1], p[2]]);
  const cr = catmull(ctrl, 16), arcs = arcLen(cr);
  const lowLevels = LEVELS.slice(6).reverse();   // L5 .. C7: bottom to top (C7 is the top anchor)
  const sp = [VERT.L5[7] / 2 + 1.7]; for (let i = 1; i < lowLevels.length; i++) sp.push((VERT[lowLevels[i - 1]][7] + VERT[lowLevels[i]][7]) / 2);   // S1 -> L5: half L5 + half S1 (~1.7)
  const tot = sp.reduce((a, b) => a + b, 0), L = arcs[arcs.length - 1]; let acc = 0; const lev = {};
  for (let i = 0; i < lowLevels.length; i++) { acc += sp[i]; lev[lowLevels[i]] = pointAt(cr, arcs, acc / tot * L); }
  // cervical: C7 -> C1 with a forward lordosis bow (1.3 cm at C4; iteration 1's 0.8 cm gave a flat ~14 deg, 1.6 cm pushed C3 into the pharynx)
  const cv = ['C6', 'C5', 'C4', 'C3', 'C2'];
  const cervical = () => { for (let i = 0; i < cv.length; i++) { const t = (i + 1) / 6, p = lerp(c7, c1, t); p[2] += 1.3 * CM * sT * Math.sin(Math.PI * t); lev[cv[i]] = [0, p[1], p[2]]; } lev.C1 = c1.slice(); };
  cervical(); lev.C7 = [0, c7[1], c7[2]];
  // the prevertebral fit: from C2's and C3's body fronts, the pharynx wall straight ahead (or, when the bone has entered the airway, straight
  // behind); the nearer of the two held at 3.5 mm
  { let moved = 0, prev = NaN; const front = n => [0, lev[n][1], lev[n][2] + VERT[n][1] * vk * sT / 2 * CM];
    const gap = n => { const o = front(n), fw = rayToSkin(B, o, Z), bk = rayToSkin(B, o, [0, 0, -1]); return bk < 0.03 ? -bk : fw < 0.03 ? fw : NaN; };
    for (let it = 0; it < 5; it++) { const g2 = gap('C2'), g3 = gap('C3'); prev = Math.min(g2 === g2 ? g2 : 1, g3 === g3 ? g3 : 1); if (prev >= 1) { prev = NaN; break; }
      const dz = clamp((prev - 0.0035) / 0.85, -0.014 - moved, 0.012 - moved); if (Math.abs(dz) < 2e-4) break; c1[2] += dz; moved += dz; cervical(); }
    Object.assign(info.neck, { prevertMinMm: prev === prev ? +(prev * 1000).toFixed(1) : null, c1MovedMm: +(moved * 1000).toFixed(1), c1: c1.map(v => +(v * 100).toFixed(1)) }); }
  // the thoracolumbar column's depth FITTED to the back's midline (the spinous line, palpable): body centre = skin + t_sp + the vertebra's own reach
  // (spinous length, canal, half the body); the rig's MakeHuman spine joints sit 2-4 cm too far back in the men (NOTES); smoothed, +-4.5 cm of the rig
  { const TL = LEVELS.slice(7), dz = {};
    for (const n of TL) { const [, d, , spl, spd] = VERT[n].map(v => vs(v)), canal = n[0] === 'L' ? vs(1.6) : vs(1.5), yt = lev[n][1] - spd * CM, zb = midline(B, yt).back;
      if (zb === zb) { const reach = (d / 2 + canal + 0.3 * vk * sT + spl * (n[0] === 'L' ? 1 : 0.9)) * CM + ((n[0] === 'L' ? 14 : 7) * (1 + 0.5 * Math.max(0, fatK)) + 2 + 4) / 1000; dz[n] = clamp(zb + reach - lev[n][2], -0.045, 0.045); } }
    const raw = TL.map(n => dz[n] ?? 0), sm = raw.map((v, i) => (raw[Math.max(0, i - 1)] + 2 * v + raw[Math.min(raw.length - 1, i + 1)]) / 4);
    TL.forEach((n, i) => { const w = n === 'L5' ? 0.5 : 1; lev[n] = [0, lev[n][1], lev[n][2] + sm[i] * w]; });
    info.columnShift = Object.fromEntries(TL.map((n, i) => [n, +(sm[i] * 100).toFixed(1)])); }
  info.colScale = +(L / (tot * CM * sT * vk)).toFixed(3); const spFit = {}; info.spFit = spFit;   // the arc against the table's spacing (1 = textbook proportions)
  for (const n of LEVELS) {
    const c = lev[n], i = LEVELS.indexOf(n), up = nrm(sub(lev[LEVELS[Math.max(0, i - 1)]], lev[LEVELS[Math.min(23, i + 1)]])), Fv = frameOf(up, Z, 1);
    const [w, d, hb, spl, spd, tps, tpb] = VERT[n].map((v, q) => q < 7 ? vs(v) : v), pr = [];
    if (n === 'C1') { const ring = []; for (let a = 0; a <= 16; a++) { const t = a / 16 * Math.PI * 2; ring.push(at(c, Fv, Math.sin(t) * vs(1.7), 0, Math.cos(t) * vs(1.9) - vs(0.9))); }
      pr.push(tube(ring, vs(0.45) * CM), cone(at(c, Fv, -vs(1.2), 0, -vs(0.5)), at(c, Fv, -tps, 0, -vs(0.6)), vs(0.6) * CM, vs(0.45) * CM), cone(at(c, Fv, vs(1.2), 0, -vs(0.5)), at(c, Fv, tps, 0, -vs(0.6)), vs(0.6) * CM, vs(0.45) * CM)); }
    else {
      pr.push(box(c, axesOf(Fv), [w / 2, hb / 2, d / 2].map(v => v * CM), Math.min(0.45, hb / 2 - 0.05) * CM));
      const back = -d / 2, canal = n[0] === 'L' ? vs(1.6) : n[0] === 'T' ? vs(1.5) : vs(1.4), base = at(c, Fv, 0, 0, back - canal - vs(0.3));
      const ring = [at(c, Fv, w * 0.33, 0, back), at(c, Fv, w * 0.38 + vs(0.3), 0, back - canal * 0.6), base, at(c, Fv, -w * 0.38 - vs(0.3), 0, back - canal * 0.6), at(c, Fv, -w * 0.33, 0, back)];
      pr.push(tube(ring, vs(n[0] === 'C' ? 0.35 : 0.5) * CM));
      let tip = at(c, Fv, 0, -spd, back - spl);
      if (n === 'C7' || n[0] === 'T' || n[0] === 'L') { const zs = midline(B, tip[1]).back; if (zs === zs) { const tsp = ((n[0] === 'L' ? 14 : n === 'C7' ? 9 : 7) * (1 + 0.5 * Math.max(0, fatK)) + 2) / 1000, dv = nrm(sub(tip, base));
        const Lw = (base[2] - (zs + tsp + vs(0.42) * CM)) / Math.max(0.2, -dv[2]), L0 = len(sub(tip, base)); tip = mad(base, dv, clamp(Lw, 0.7 * L0, 1.3 * L0)); spFit[n] = +(Lw / L0).toFixed(2); } }
      if (n[0] === 'L') pr.push(ribbon([base, tip], nrm(sub(at(c, Fv, 0, 1, 0), c)), vs(0.75) * CM, vs(0.32) * CM));
      else pr.push(cone(base, tip, vs(n === 'C7' || n === 'T1' ? 0.55 : 0.45) * CM, vs(n[0] === 'C' && n !== 'C7' ? 0.35 : 0.42) * CM));
      for (const s of [1, -1]) pr.push(cone(at(c, Fv, s * w * 0.38, vs(0.2), back - canal * 0.6), at(c, Fv, s * tps, n[0] === 'T' ? vs(0.2) : 0, -tpb), vs(0.45) * CM, vs(n[0] === 'L' ? 0.35 : 0.42) * CM));
      pts['sp_' + n] = tip;
    }
    add_('vert.' + n, pr, 'spine', 0.004 * vk);
  }
  geo.lev = lev; geo.vert = Object.fromEntries(LEVELS.map(n => { const [w, d, hb, spl, spd, tps, tpb] = VERT[n].map((v, q) => q < 7 ? vs(v) * CM : v * CM); return [n, { c: lev[n], w, d, hb, spl, spd, tps, tpb, canal: (n[0] === 'L' ? vs(1.6) : n[0] === 'T' ? vs(1.5) : vs(1.4)) * CM }]; })); geo.frH = frH;
  info.levels = Object.fromEntries(LEVELS.map(n => [n, +(lev[n][1] * 100).toFixed(1)]));
  // the prevertebral soft tissue (the pharynx's back wall, hm08's oral lining, in front of C2 and C3's bodies: adults 2-7 mm): the column's depth against the
  // head's own anatomy at the seam
  for (const n of ['C2', 'C3']) { const c = lev[n], d = VERT[n][1] * vk * sT / 2; rays.push({ name: 'prevert' + n, o: [0, c[1], c[2] + d * CM], d: [0, 0, 1], key: 'prevert' }); }
  // the nuchal muscles over C3-C4's spinous tips (semispinalis, splenius, trapezius and the ligament: 15-50 mm; C2-C6's tips are not subcutaneous)
  for (const n of ['C3', 'C4']) rays.push({ name: 'nuchal' + n, o: pts['sp_' + n], d: [0, 0, -1], key: 'nuchal' });
  pts.C7tip = pts.sp_C7;
  // ============================================================ STERNUM: the jugular notch and the xiphoid tip fitted to their skin landmarks (minus tissue)
  const tJ = (sexF ? 13 : 11) + 4 * Math.max(0, fatK), tX = (sexF ? 19 : 15) + 7 * Math.max(0, fatK);
  const Jn = mad(lm.suprasternale, Y, -0.3 * CM * sT, Z, -tJ / 1000); let Xt = mad(lm.xiphoid, Y, 0.4 * CM * sT, Z, -tX / 1000);
  // the slope held in the anatomical window (DIMS.sternSlope, deg from the vertical, top back; iteration 2: four v6 men's chests gave 10.5-13 deg):
  // the xiphoid end turned about the jugular notch, the extra tissue over it reported
  { const d = sub(Xt, Jn), L0 = len(d), a0 = Math.atan2(d[2], -d[1]) * 180 / Math.PI, [lo, hi] = DIMS.sternSlope[sx], a1 = clamp(a0, lo, hi);
    if (a1 !== a0) { const r = a1 * Math.PI / 180; Xt = [Xt[0], Jn[1] - L0 * Math.cos(r), Jn[2] + L0 * Math.sin(r)]; } info.sternumSlope = { skin: +a0.toFixed(1), used: +a1.toFixed(1), xiphoidMovedMm: +(len(sub(Xt, mad(lm.xiphoid, Y, 0.4 * CM * sT, Z, -tX / 1000))) * 1000).toFixed(1) }; }
  // v3: the sternum's LENGTH from the source (MSCT, Folia Morphol 2018: manubrium + body women 133 mm at ANSUR's mean stature 162.9 cm, men 154 at 175.6), not
  // from hm08's xiphoid skin landmark (v2: the men's 5-10 % short); its slope still from the two skin landmarks in the window; the skin's length is reported
  const [mL, bL, xL] = D('sternum').map(v => v * sT), want = len(sub(Xt, Jn)) * 100, srcMB = (sexF ? 13.3 : 15.4) * st / (sexF ? 162.9 : 175.6);
  const kb = clamp((srcMB - mL) / bL, 0.85, 1.18), bodyL = bL * kb;
  const sd = nrm(sub(Xt, Jn)), Fst = frameOf(sd, Z, 1), sAt = (dist, x = 0, z = 0) => at(Jn, Fst, x, dist, z);
  const angle = mL, xs = mL + bodyL;
  const sk = sexF ? 0.9 : 1, stw = v => v * sk * sT;
  { const top = [sAt(0.2, -stw(2.8)), sAt(0.65, 0), sAt(0.2, stw(2.8))], mid = [sAt(angle * 0.55, -stw(2.1)), sAt(angle * 0.55, 0), sAt(angle * 0.55, stw(2.1))], bot = [sAt(angle, -stw(1.55)), sAt(angle, 0), sAt(angle, stw(1.55))];
    const body = [0, 0.22, 0.45, 0.7, 1].map(t => { const d = angle + t * bodyL, hw = stw([1.55, 1.75, 1.85, 1.65, 1.3][Math.round(t * 4)] ?? 1.6); return [sAt(d, -hw), sAt(d, 0), sAt(d, hw)]; });
    const pr = [sheet([top, mid, bot], stw(0.62) * CM), sheet(body, stw(0.5) * CM), cone(sAt(angle, -stw(1.4), 0.25), sAt(angle, stw(1.4), 0.25), stw(0.45) * CM, stw(0.45) * CM),
      ribbon([sAt(xs, 0), sAt(xs + xL * 0.6, 0, -0.2), sAt(xs + xL, 0, -0.4)], Fst.l, [stw(1.0) * CM, stw(0.7) * CM, stw(0.35) * CM], stw(0.25) * CM),
      sphere(sAt(0.3, -stw(2.6)), stw(0.6) * CM), sphere(sAt(0.3, stw(2.6)), stw(0.6) * CM)];
    add_('sternum', pr, 'sternum', 0.004 * sk);
    rays.push({ name: 'sternumMid', o: sAt(angle + 0.45 * bodyL, 0, stw(0.5)), d: Fst.a, key: 'sternum' });
    pts.jugular = sAt(0, 0, 0.6); pts.sternalAngle = sAt(angle, 0, 0.7); pts.xiphisternal = sAt(xs, 0, 0.5); pts.xiphoidTip = sAt(xs + xL, 0, 0.2);
    geo.sternum = { at: sAt, Jn, dir: sd, F: Fst, angle, bodyL, xs, xL, attD: [1.6, angle, ...attB.map(f => angle + f * bodyL), xs], stw };
    info.sternum = { length: +(mL + bodyL + xL).toFixed(1), bodyScale: +kb.toFixed(3), wantLength: +want.toFixed(1), tiltDeg: +(Math.acos(clamp(-sd[1], -1, 1)) * 180 / Math.PI).toFixed(1) };
  }
  // sternal attachments of ribs 1..7 (distance down the sternum) and the costal margin
  const attD = [1.6, angle, ...attB.map(f => angle + f * bodyL), xs];
  const XS = sAt(xs, 0, 0);
  const mEndY = lev.L3[1] + 1.5 * CM * sT, mDrop = (XS[1] - mEndY) * 100, mBack = 0.4 * (XS[2] - (lev.T12[2] - 4.4 * CM * sT)) * 100;
  // ============================================================ RIB CAGE
  // half-widths: the table x stature x sex, then FITTED to the skin's breadth at the 8th rib's lateral max (minus lateral tissue: 1.3 cm of serratus / latissimus /
  // obliques + the person's fat), clamped to +-10 % of the table
  const ribW0 = DIMS.ribW3.map(v => v * sT * (sexF ? DIMS.ribWf : 1));
  const latT = 1.3 + (sexF ? 0.5 : 0.3) + 0.8 * Math.max(0, fatK); let kW = 1, ribW = ribW0.slice(), skinHalf = NaN;
  info.cage = { latTissue: +latT.toFixed(1) };
  // v3: THE COSTAL MARGIN follows the 7th cartilage. The atlas (BodyParts3D's male): the margin runs from the xiphoid along the 7th cartilage's lower border
  // (down-lateral at ~45 deg to 0.4 of the cage's half-width, then level) to the 7th CCJ, then nearly straight down past the 8th, 9th and 10th ribs' tips
  // (0.38 / 0.68 / 1.0 of that drop; x 0.83-0.87 of the half-width). v2's margin started at the xiphoid with the infrasternal angle and met ribs 8-10 there,
  // which v3's longer 7th cartilage would cross. built per side once rib 7 exists; margin3(u) by arc length from the xiphoid; u7 = the 7th CCJ.
  let mg3 = null;
  const margin3Of = (ribPts, side) => { const S_ = side > 0 ? 'L' : 'R', c7 = ribPts['rib7' + S_].cart.slice().reverse(), dn = 0.5 * sT * vk * CM;
    const P2 = [side * (1.0 + Math.max(7.5 * sT, mDrop * 0.62)) * CM, mEndY, XS[2] - mBack * CM], pts = [mad(XS, X, side * 1.0 * CM, Y, -dn)];
    for (const q of c7) if (Math.abs(q[0]) > 1.2 * CM) pts.push([q[0], q[1] - dn, q[2]]);
    const C7 = pts[pts.length - 1], n7 = pts.length - 1;
    for (let i = 1; i <= 10; i++) { const t = i / 10, q = lerp(C7, P2, t); pts.push(mad(q, X, side * 0.6 * CM * sT * Math.sin(Math.PI * t))); }
    const A = arcLen(pts); return { pts, A, u7: A[n7] / A[A.length - 1] }; };
  const margin3 = (u, side) => { const m = mg3[side > 0 ? 0 : 1]; return pointAt(m.pts, m.A, clamp(u, 0, 1) * m.A[m.A.length - 1]); };
  const ribsWith = ribW => { const ribPts = {}, out = []; mg3 = null;
  for (let k = 1; k <= 12; k++) {
    if (k === 8) mg3 = [margin3Of(ribPts, 1), margin3Of(ribPts, -1)];
    const n = 'T' + k, c = lev[n], [w, d, hb, , , tps, tpb] = VERT[n].map((v, q) => q < 7 ? vs(v) : v);
    const Wk = ribW[k - 1], Zp = DIMS.ribZp[k - 1] * sT * vk, hh = DIMS.ribH[k - 1] * sT * vk, zb = c[2] * 100 - Zp;
    for (const side of [1, -1]) {
      const S_ = side > 0 ? 'L' : 'R';
      // the anterior end: the sternum (1-7), the costal margin (8-10), free (11-12)
      let endP, ccjP = null, cartTo = null;
      if (k <= 7) { endP = sAt(attD[k - 1], side * stw(k === 1 ? 2.1 : [1.6, 1.7, 1.8, 1.75, 1.6, 1.35][k - 2]), -0.1); }
      else if (k <= 10) { const u7 = mg3[side > 0 ? 0 : 1].u7, lo = f => u7 + (1 - u7) * f; endP = margin3(lo([0.38, 0.68, 0.98][k - 8]), side); endP = mad(endP, X, side * 0.4 * CM * sT);
        cartTo = k === 8 ? margin3(0.9 * u7, side) : margin3(lo([0, 0.3, 0.6][k - 8]), side); }
      const xf = endP ? Math.abs(endP[0]) * 100 : 0.3 * Wk, zf = endP ? endP[2] * 100 : zb + 1.1 * (DIMS.ribZp[6] + 9) * sT;
      const zm = zb + 0.45 * (zf - zb), aK = (k === 1 ? 0.55 : 0.40) * Wk;
      // the plan curve phi 0..pi: back extreme -> lateral max -> front
      const plan = phi => { const x = phi <= Math.PI / 2 ? aK + (Wk - aK) * Math.pow(Math.sin(phi), 0.9) : xf + (Wk - xf) * Math.pow(Math.sin(phi), 1.15);
        const z = phi <= Math.PI / 2 ? zm - (zm - zb) * Math.cos(phi) : zm - (zf - zm) * Math.cos(phi); return [x, z]; };
      const phiEnd = k === 11 ? 0.70 * Math.PI : k === 12 ? 0.42 * Math.PI : Math.PI;
      // the CCJ: for 1-7 the cartilage's length back from the sternal end along the plan; 8-10 end at the CCJ (on the margin)
      const NS = 40, phis = Array.from({ length: NS + 1 }, (_, i) => i / NS * phiEnd), pl = phis.map(plan);
      let iC = NS; if (k <= 7) { const fx = DIMS.cartX3[k - 1]; let a = 0; for (let i = NS; i > 0; i--) { a += Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]);
        if (fx ? pl[i - 1][0] >= fx * Wk : a >= DIMS.cart[k - 1] * sT * vk) { iC = i - (fx ? 1 : 0); break; } } }
      const yHead = c[1] * 100 + 0.35 * hb, yA = c[1] * 100 - 0.6;
      const yEnd = endP ? endP[1] * 100 : yA - (k === 11 ? 8.5 : 5.5) * sT, yC = k <= 7 ? yEnd - cartDrop[k - 1] * sT * vk : yEnd;
      const sag = [0.3, 0.6, 0.9, 1.1, 1.2, 1.2, 1.2, 1.1, 1.0, 0.8, 0.5, 0.3][k - 1] * sT;
      const bony = [], cart = [];
      bony.push([side * (w / 2 + 0.15) * CM, yHead * CM, (c[2] * 100 - 0.25 * d) * CM]);
      bony.push([side * tps * CM, (c[1] * 100 - 0.2) * CM, (c[2] * 100 - tpb - 0.3) * CM]);
      for (let i = 0; i <= iC; i++) { const t = i / Math.max(1, iC), g = k >= 8 ? 1 - Math.pow(1 - t, DIMS.ribDescent3[k - 8]) : 0.15 * t + 0.85 * Math.pow(t, 1.6), y = yA - (yA - yC) * g - sag * Math.sin(Math.PI * t) * 0.5;
        bony.push([side * pl[i][0] * CM, y * CM, pl[i][1] * CM]); }
      if (k <= 7) for (let i = iC; i <= NS; i++) { const t = (i - iC) / Math.max(1, NS - iC), y = yC + (yEnd - yC) * ss(t); cart.push([side * pl[i][0] * CM, y * CM, pl[i][1] * CM]); }
      else if (cartTo) { const a = bony[bony.length - 1], m = mad(lerp(a, cartTo, 0.5), Y, -0.6 * CM * sT, Z, 0.4 * CM * sT); cart.push(a, m, cartTo); }
      // decimate the bony path (every other point) and build the band; rib 1's flat faces look up and down (its band lies in its own plane)
      const path = bony.filter((_, i) => i < 2 || i === bony.length - 1 || i % 2 === 0), ups = path.map((p, i) => { const tt = nrm(sub(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)]));
        if (k === 1) return nrm(crs(tt, Y)); return nrm(sub(Y, mul(tt, dot(Y, tt)))); });
      const hw = path.map((_, i) => (i < 2 ? 0.45 * sT * vk : hh) * CM), thk = (k === 1 ? 0.35 : 0.28) * sT * vk * CM;
      const pr = [ribbon(path, ups, hw, thk)];
      if (cart.length) pr.push(tube(cart, cart.map((_, i) => (0.55 - 0.15 * i / cart.length) * sT * vk * CM)));
      out.push(part(`rib${k}.${S_}`, pr.flat(), { k: 0.003, group: 'ribs' }));
      ribPts[`rib${k}${S_}`] = { head: path[0], lat: path.reduce((a, p) => Math.abs(p[0]) > Math.abs(a[0]) ? p : a, path[0]), ccj: bony[bony.length - 1], end: cart.length ? cart[cart.length - 1] : bony[bony.length - 1] , path, cart };
    }
  }
  return { out, ribPts }; };
  // per-rib fit of the lateral wall (ribs 5-10): each rib's widest point to the skin's trunk breadth at its height minus the lateral tissue, clamped to
  // 0.85-1.1 of the table, smoothed with its neighbours; ribs 1-4 (under the axilla) and 11-12 keep the global factor
  let R0 = ribsWith(ribW); { const kF = 7, r8 = R0.ribPts['rib' + kF + 'L'].lat, r8r = R0.ribPts['rib' + kF + 'R'].lat, y8 = (r8[1] + r8r[1]) / 2; skinHalf = (P.lat(y8, 1) + P.lat(y8, -1)) / 2 * 100;
    if (skinHalf === skinHalf) { kW = clamp((skinHalf - latT) / ((Math.abs(r8[0]) + Math.abs(r8r[0])) / 2 * 100), 0.85, 1.1); ribW = ribW0.map(v => v * kW); R0 = ribsWith(ribW); } }
  info.cage.kW = +kW.toFixed(3); info.cage.skinHalf8 = +skinHalf.toFixed(1); info.cage.width8 = +(2 * ribW[7]).toFixed(1); info.cage.pinched = kW <= 0.851;
  const fk = ribW.map(() => 1), fitR = {};
  for (let k = 7; k <= 10; k++) { const L_ = R0.ribPts['rib' + k + 'L'].lat, R_ = R0.ribPts['rib' + k + 'R'].lat, y = (L_[1] + R_[1]) / 2, x = (Math.abs(L_[0]) + Math.abs(R_[0])) / 2 * 100;
    const sk = (P.lat(y, 1) + P.lat(y, -1)) / 2 * 100; if (sk === sk) { fk[k - 1] = clamp((sk - latT) / x, 0.85 * ribW0[k - 1] / ribW[k - 1], 1.1 * ribW0[k - 1] / ribW[k - 1]); fitR[k] = +(sk - latT - x).toFixed(1); } }
  // the floating ribs 11-12 at the waist (iteration 2: they crossed the women's waist skin): only ever narrowed, to the skin's breadth at their lateral
  // extreme less the waist's lateral tissue (latissimus, obliques, fat: 0.4 cm more than the cage's)
  for (let k = 11; k <= 12; k++) { const L_ = R0.ribPts['rib' + k + 'L'].lat, R_ = R0.ribPts['rib' + k + 'R'].lat, y = (L_[1] + R_[1]) / 2, x = (Math.abs(L_[0]) + Math.abs(R_[0])) / 2 * 100;
    const sk = (P.lat(y, 1) + P.lat(y, -1)) / 2 * 100; if (sk === sk) { fk[k - 1] = clamp((sk - latT - 0.4) / x, 0.8, 1); fitR[k] = +(sk - latT - 0.4 - x).toFixed(1); } }
  fk[4] = 1 + (fk[6] - 1) / 3; fk[5] = 1 + 2 * (fk[6] - 1) / 3;
  const fs = fk.map((f, i) => i >= 6 && i <= 9 ? (fk[i - 1] + 2 * f + (i < 9 ? fk[i + 1] : Math.max(f, fk[i + 1]))) / 4 : f);
  const ribW2 = ribW.map((w, i) => w * fs[i]); R0 = ribsWith(ribW2);
  // the cage's ANTEROLATERAL clearance (iteration 3, measured, not fitted): from each of ribs 5-10's front-half points outward along the cage's own
  // normal to v6's skin (cm, the rib's surface). The muscles built on v2 showed it 0-2 cm in the men where serratus + the external oblique + fat
  // need ~1.8-2.1 (latT); a steeper front curve (the plan's exponent up to 2.6) gained only 0.2-0.6 cm: v6's lower chest is widest ~3-5 cm further
  // back than the cage and narrows in front (L21 at the 7th rib: skin widest at z -2..0, the rib at z +3). Reported for the plates to decide.
  { const c = {}; for (let k = 5; k <= 10; k++) { let m = Infinity; for (const S_ of ['L', 'R']) { const q = R0.ribPts['rib' + k + S_], pa = q.path; let iL = 0; for (let i = 0; i < pa.length; i++) if (Math.abs(pa[i][0]) > Math.abs(pa[iL][0])) iL = i;
      for (let i = iL + 1; i < pa.length - 2; i++) { const p = pa[i], d = nrm([p[0], 0, p[2] - q.lat[2]]), t = rayToSkin(B, p, d); if (t < 0.2) m = Math.min(m, t * 100 - 0.3); } } c[k] = +m.toFixed(1); }
    info.cage.anteroLateral = { clearCm: c, needCm: +latT.toFixed(1) }; }
  parts.push(...R0.out); const ribPts = R0.ribPts;
  info.cage.ribFit = fitR; info.cage.ribScale = fs.map(f => +f.toFixed(3));
  pts.rib10L = ribPts.rib10L.lat; pts.rib10R = ribPts.rib10R.lat; pts.costalLowL = ribPts.rib10L.ccj; pts.costalLowR = ribPts.rib10R.ccj;
  info.cage.lowestMarginY = +(Math.min(ribPts.rib10L.ccj[1], ribPts.rib10R.ccj[1]) * 100).toFixed(1); info.cage.L3y = info.levels.L3;
  // ============================================================ SHOULDER GIRDLE: clavicle SC -> AC; the scapula on the cage from the glenoid and its palpable points
  const ribParts = parts.filter(p => p.group === 'ribs');
  for (const side of [1, -1]) {
    const S_ = side > 0 ? 'L' : 'R', Sh = j('upperarm01.' + S_), Rh = D('humerusHead') * sT * vk;
    const acrB = mad(lm['acromion' + S_], skinN('acromion' + S_), -(7 + 2 * Math.max(0, fatK)) / 1000);   // the acromion's lateral edge (bone)
    const ac = mad(acrB, X, -side * 3.3 * CM * sT, Y, -0.2 * CM * sT, Z, 0.3 * CM * sT);                      // AC joint (3.3 cm medial of the acromion's lateral edge)
    const sc = mad(Jn, X, side * stw(2.4) * CM, Y, 0.5 * CM * sT, Z, -1.2 * CM * sT);                        // SC joint (the medial end over the clavicular notch)
    const ch = sub(ac, sc), Lc = len(ch) * 100, cu = nrm(ch), fw = nrm(sub(Z, mul(cu, dot(Z, cu)))), b1 = 0.11 * Lc, b2 = 0.06 * Lc;
    const cpts = [0, 0.12, 0.3, 0.5, 0.66, 0.8, 0.92, 1].map(t => { const f = t < 0.66 ? b1 * Math.sin(Math.PI * t / 0.66) : -b2 * Math.sin(Math.PI * (t - 0.66) / 0.34); return mad(lerp(sc, ac, t), fw, f * CM); });
    const ck = sexF ? 0.88 : 1, rc = [1.0, 0.85, 0.68, 0.62, 0.66, 0.72, 0.75, 0.7].map(v => v * ck * sT * CM);
    const Fa = frameOf(cu, Y, side);
    add_('clavicle.' + S_, [tube(cpts, rc), ell(mad(ac, cu, -0.9 * CM * sT), [cu, Y, fw], [1.4, 0.55, 1.15].map(v => v * ck * sT * CM))], 'girdle', 0.004);
    geo['clav' + S_] = { pts: cpts, fw, cu, sc, ac, r: rc };
    pts['clavMid' + S_] = mad(cpts[3], fw, 0.6 * CM * ck * sT); rays.push({ name: 'clavMid' + S_, o: pts['clavMid' + S_], d: nrm(add(fw, mul(Y, 0.4))), key: 'clavicleMid' }); pts['sc' + S_] = sc; pts['ac' + S_] = ac;
    info['clavicle' + S_] = +Lc.toFixed(1);
    // scapula (iteration 2: placed by the COLUMN, not by hm08's scapRoot / scapInf skin landmarks, which sit ~4 vertebral levels low: the measurer's
    // it1 B1): the root of the spine level with T3's spinous tip, DIMS.scapRootX from the midline; the medial border down 0.71 of the scapula's height
    // to the inferior angle (level with T7's tip at rest), turned upward by the bind pose's arm abduction (the scapulohumeral rhythm: a third of the
    // abduction past 25 deg, + 3 deg at rest); the blade ON the cage's posterior wall (subscapularis + serratus between: 1.0 cm under the medial
    // border, 1.4 cm under the fossa). The glenoid stays at the humeral head; the landmarks are reported (info.scapula).
    const gn = nrm([side * Math.cos(35 * Math.PI / 180), 0.1, Math.sin(35 * Math.PI / 180)]), G = mad(Sh, gn, -(Rh + 0.25 * sT) * CM);
    const hS = D('scapulaH') * sT, armD = nrm(sub(j('lowerarm01.' + S_), Sh)), abd = Math.atan2(Math.abs(armD[0]), -armD[1]) * 180 / Math.PI, psi = (3 + Math.max(0, abd - 25) / 3) * Math.PI / 180;
    const onCage = (x, y, clr) => { const zc = lev.T6[2]; for (let z = zc - 0.16; z < zc + 0.02; z += 0.002) { let d = 1; for (const dy of [-0.012, -0.006, 0, 0.006, 0.012]) d = Math.min(d, sdParts(ribParts, x, y + dy, z, 0.05).d); if (d < clr) return z; } return zc - 0.06; };
    const xR = side * D('scapRootX') * sT * CM, yR = pts.sp_T3[1], Lmi = 0.71 * hS * CM, c1m = 1.0 * CM * sT;
    const root = [xR, yR, onCage(xR, yR, c1m)], infXY = [xR + side * Lmi * Math.sin(psi), yR - Lmi * Math.cos(psi)], inf = [infXY[0], infXY[1], onCage(infXY[0], infXY[1], c1m)];
    const md = nrm(sub(root, inf)), sa0 = mad(root, md, 0.29 * hS * CM), sa = [sa0[0], sa0[1], onCage(sa0[0], sa0[1], c1m)];
    const igl = mad(G, Y, -1.6 * CM * sT, gn, -0.6 * CM * sT), gtop = mad(G, Y, 1.5 * CM * sT, gn, -0.8 * CM * sT);
    // grid: rows superior border (sa -> gtop) .. inferior (inf -> igl); the medial two columns laid on the cage, the lateral ones interpolated, then all
    // kept off the ribs
    const rowsSc = []; for (const t of [0, 0.25, 0.5, 0.75, 1]) { const medial = t < 0.3 ? lerp(sa, root, t / 0.3) : lerp(root, inf, (t - 0.3) / 0.7), lateral = lerp(gtop, igl, Math.min(1, t * 1.6)), lt = t > 0.6 ? lerp(igl, inf, (t - 0.6) / 0.4 * 0.85) : lateral;
      rowsSc.push([0, 0.33, 0.66, 1].map(u => lerp(medial, lt, u))); }
    rowsSc.forEach(r => r.forEach((p, u) => { if (u <= 1) p[2] = onCage(p[0], p[1], (u === 0 ? 1.0 : 1.4) * CM * sT); }));
    { const lvl = y => { let best = null, bd = 1e9; for (const n of LEVELS) { const tp = pts['sp_' + n]; if (tp && n[0] === 'T' && Math.abs(tp[1] - y) < bd) { bd = Math.abs(tp[1] - y); best = n; } } return best; };
      info['scapula' + S_] = { abdDeg: +abd.toFixed(1), upRotDeg: +(psi * 180 / Math.PI).toFixed(1), rootXcm: +(Math.abs(root[0]) * 100).toFixed(1), infXcm: +(Math.abs(inf[0]) * 100).toFixed(1), rootLevel: lvl(root[1]), infLevel: lvl(inf[1]),
        infAboveXiphoidCm: +((inf[1] - pts.xiphoidTip[1]) * 100).toFixed(1), hm08RootLowCm: +((root[1] - lm['scapRoot' + S_][1]) * 100).toFixed(1), hm08InfLowCm: +((inf[1] - lm['scapInf' + S_][1]) * 100).toFixed(1) }; }
    const clear = (1.2 + 0.2 * Math.max(0, fatK)) * CM * sT;
    for (let it = 0; it < 4; it++) for (const r of rowsSc) for (const p of r) { const { d: dd } = sdParts(ribParts, p[0], p[1], p[2], 0.05); if (dd < clear) p[2] -= (clear - dd) * 0.9; }
    const tS = rowsSc.map((r, i) => r.map((_, u) => ((u === 0 || i === 0) ? 0.32 : u === 3 ? 0.5 : 0.18) * CM * sT * vk));
    const nb = nrm(crs(sub(rowsSc[0][3], rowsSc[0][0]), sub(rowsSc[4][0], rowsSc[0][0]))), post = dot(nb, Z) < 0 ? nb : mul(nb, -1);   // the body's posterior normal
    const acB = mad(acrB, X, -side * 1.7 * CM * sT, Y, -0.3 * CM * sT), spBase = lerp(root, mad(acB, X, -side * 1.5 * CM * sT), 0.0);
    const spine = [root, lerp(root, acB, 0.35), lerp(root, acB, 0.7), mad(acB, X, -side * 0.6 * CM * sT)].map((p, i) => mad(p, post, [0.4, 0.9, 1.3, 1.3][i] * CM * sT));
    const spineBase = [root, lerp(root, acB, 0.35), lerp(root, acB, 0.7)];
    const pr = [sheet(rowsSc, tS), tube(spine, [0.35, 0.42, 0.5, 0.55].map(v => v * CM * sT * vk)), sheet([spineBase, spine.slice(0, 3)], 0.2 * CM * sT),
      ell(mad(acrB, X, -side * 1.5 * CM * sT, Y, -0.35 * CM * sT, Z, -0.4 * CM * sT), [nrm([side, 0.18, 0]), nrm([-0.18 * side, 1, 0]), Z], [2.2, 0.5, 1.7].map(v => v * CM * sT * vk)),   // acromion
      ell(G, [gn, Y, nrm(crs(gn, Y))], [0.7, 1.9, 1.35].map(v => v * CM * sT * vk)), cone(mad(G, gn, -1.5 * CM * sT), G, 1.3 * CM * sT * vk, 1.0 * CM * sT * vk),   // glenoid and neck
      tube([mad(G, Y, 2.0 * CM * sT, gn, -1.0 * CM * sT, Z, 0.6 * CM * sT), mad(G, Y, 2.9 * CM * sT, gn, -1.0 * CM * sT, Z, 2.0 * CM * sT), mad(G, Y, 2.2 * CM * sT, gn, 0.1 * CM * sT, Z, 3.4 * CM * sT)], [0.75, 0.65, 0.5].map(v => v * CM * sT * vk))];   // coracoid
    add_('scapula.' + S_, pr, 'girdle', 0.005);
    geo['scap' + S_] = { rows: rowsSc, spine, root, inf, sa, acrB, acB, G, gn, post, igl, gtop };
    pts['acromion' + S_] = acrB; pts['scapRoot' + S_] = mad(root, post, 0.6 * CM); pts['scapInf' + S_] = inf; pts['glenoid' + S_] = G;
    // the tissue over the root of the spine and the inferior angle: rays outward (posterior) from the bone's surface (hm08's landmarks are not over them)
    { const scP = parts[parts.length - 1], surf = o => { for (let q = 0; q < 60; q++) { const pq = mad(o, post, q * 0.0005); if (sdPart(scP, pq[0], pq[1], pq[2]) > 0) return pq; } return o; };
      rays.push({ name: 'scapRoot' + S_, o: surf(root), d: post, key: 'scapRoot' }, { name: 'scapInf' + S_, o: surf(inf), d: post, key: 'scapInf' }); }
  }
  // ============================================================ THE NIPPLE RULE (a reference the skeleton can already give; D4 places the nipple-areola complex by the
  // anatomy built over it): the 4th intercostal space on the MIDCLAVICULAR line (the vertical through the clavicle's middle), carried forward to the v6
  // skin. For men this is the nipple (on the pectoral's lower-lateral contour); for women the breast's base, not its apex. Reported beside hm08's
  // nipple landmark (BODY7 and SKIN7 place the current system's nipples now: a check value for them)
  { const r4 = parts.filter(q => /^rib4\./.test(q.name)), r5 = parts.filter(q => /^rib5\./.test(q.name)), rule = {};
    for (const [S_, s] of [['L', 1], ['R', -1]]) { const x = (pts['sc' + S_][0] + pts['ac' + S_][0]) / 2, yTop = pts.sternalAngle[1] + 0.02, yBot = pts.xiphoidTip[1] - 0.06;
      const zF = pts.xiphisternal[2] - 0.07;   // the front half of the cage only (the same rib's posterior part also crosses this x, higher up)
      const ribY = R => { let sy = 0, n = 0; for (let y = yBot; y < yTop; y += 0.002) for (let z = 0.2; z > zF; z -= 0.003) { if (sdParts(R, x, y, z, 0.02).d < 0) { sy += y; n++; break; } } return n ? sy / n : NaN; };
      const y4 = ribY(r4), y5 = ribY(r5), y = (y4 + y5) / 2; let z = 0.2; for (; z > -0.05; z -= 0.002) if (sdParts(ribParts, x, y, z, 0.03).d < 0.004) break;
      const d = rayToSkin(B, [x, y, z], Z), sk = d < 0.2 ? [x, y, z + d] : null, lmN = lm['nipple' + S_];
      rule[S_] = { mcl: +(x * 100).toFixed(1), ics4: +(y * 100).toFixed(1), skin: sk && sk.map(v => +(v * 100).toFixed(1)), hm08: lmN && lmN.map(v => +(v * 100).toFixed(1)), dxCm: sk && lmN ? +((Math.abs(sk[0]) - Math.abs(lmN[0])) * 100).toFixed(1) : null, dyCm: sk && lmN ? +((sk[1] - lmN[1]) * 100).toFixed(1) : null };
      if (sk) pts['nippleRule' + S_] = sk; }
    info.nippleRule = rule; }
  // ============================================================ ARMS
  const rob = opts.robust ?? 1, wM = sT * (sexF ? 0.9 : 1) * rob, wD = sT * rob;   // width scales: male literals x sex; the sex-specific D() values x stature only
  for (const side of [1, -1]) {
    const S_ = side > 0 ? 'L' : 'R', Sh = j('upperarm01.' + S_), E = j('lowerarm01.' + S_), Wr = j('wrist.' + S_);
    const Lh = len(sub(E, Sh)) * 100, kh = wM, se = sub(E, Sh), ew = sub(Wr, E);
    let fa = nrm(crs(se, ew)); if (dot(fa, X) * side < 0) fa = mul(fa, -1);
    const u = nrm(se); let an = nrm(crs(u, fa)); if (dot(an, ew) < 0) an = mul(an, -1);
    const FH = { u, a: an, l: fa }, Rh = D('humerusHead') * wD, sh = D('humerusShaft') * wD;
    const Ee = mad(E, u, -0.5 * CM * kh), dLat = rayToSkin(B, Ee, fa) * 100, dMed = rayToSkin(B, Ee, mul(fa, -1)) * 100, bt = 6.5 * kh, bw = clamp((dLat + dMed - 1.0) / bt, 0.85, 1.05);
    const eShift = (dLat < 50 && dMed < 50) ? clamp(((dLat - 0.5 - 2.85 * kh * bw) - (dMed - 0.5 - 3.65 * kh * bw)) / 2, -1.5, 1.5) : 0, Ec = mad(E, fa, eShift * CM);
    info['elbow' + S_] = { skinBreadth: +(dLat + dMed).toFixed(1), shift: +eShift.toFixed(2), scale: +bw.toFixed(2) };
    const prH = [sphere(Sh, Rh * CM), ell(at(Sh, FH, Rh * 0.72, 0.6 * kh, 0.35 * kh), [FH.l, FH.u, FH.a], [1.1, 1.9, 1.4].map(v => v * kh * CM)), sphere(at(Sh, FH, -0.2 * kh, 1.0 * kh, Rh * 0.8), 0.7 * kh * CM),
      cone(at(Sh, FH, 0, 0.8 * kh, 0), at(Sh, FH, 0.5 * kh, 5.0 * kh, 0), 1.9 * kh * CM, 1.25 * kh * CM),
      tube([at(Sh, FH, 0.5 * kh, 5.0 * kh, 0), at(Sh, FH, 0.3 * kh, Lh * 0.5, 0.15 * kh), at(E, FH, 0, -6.0 * kh, 0)], [1.25 * kh * CM, sh * CM, 1.05 * kh * CM]),
      box(at(Ec, FH, -0.2 * kh, -2.0 * kh, -0.2 * kh), axesOf(FH), [2.4 * bw, 1.8, 0.95].map(v => v * kh * CM), 0.6 * kh * CM),
      ell(at(Ec, FH, -2.8 * kh * bw, -0.4 * kh, -0.3 * kh), axesOf(FH), [0.85, 1.1, 0.8].map(v => v * kh * bw * CM)), ell(at(Ec, FH, 2.2 * kh * bw, -0.6 * kh, -0.1 * kh), axesOf(FH), [0.65, 1.0, 0.75].map(v => v * kh * bw * CM)),
      cone(at(E, FH, -1.9 * kh, 0.15 * kh, 0), at(E, FH, -0.1 * kh, 0.15 * kh, 0), 1.15 * kh * CM, 1.05 * kh * CM), sphere(at(E, FH, 1.1 * kh, 0.1 * kh, 0.35 * kh), 1.0 * kh * CM)];
    add_('humerus.' + S_, prH, 'arm', 0.005 * kh);
    geo['hum' + S_] = { Sh, E, Ec, F: FH, Lh, Rh, kh, at: (x, y, z) => at(Sh, FH, x, y, z) };
    rays.push({ name: 'medEpi' + S_, o: at(Ec, FH, -3.65 * kh * bw, -0.4 * kh, -0.3 * kh), d: mul(fa, -1), key: 'medEpicondyle', fit: true }, { name: 'latEpi' + S_, o: at(Ec, FH, 2.85 * kh * bw, -0.6 * kh, -0.1 * kh), d: fa, key: 'latEpicondyle', fit: true }, { name: 'greaterTub' + S_, o: at(Sh, FH, Rh * 0.72 + 1.1 * kh, 0.6 * kh, 0.35 * kh), d: fa, key: 'deltoid' });
    pts['medEpi' + S_] = at(Ec, FH, -3.65 * kh * bw, -0.4 * kh, -0.3 * kh); pts['latEpi' + S_] = at(Ec, FH, 2.85 * kh * bw, -0.6 * kh, -0.1 * kh); pts['greaterTub' + S_] = at(Sh, FH, Rh * 0.72 + 1.1 * kh, 0.6 * kh, 0.35 * kh);
    info['humerus' + S_] = +(Lh + Rh).toFixed(1);
    // forearm: f along, fa the flexion axis (lateral in anatomical position), nf the flexor side; distal ends from the skin's ulnar head and radial styloid (3.5 mm in)
    const f = nrm(ew), nf0 = nrm(crs(fa, f)), nf = dot(nf0, an) < -0.5 ? mul(nf0, -1) : nf0, FF = { u: f, a: nf, l: fa }, Lf = len(ew) * 100, kf = wM;
    const uh = inward('ulnarHead' + S_, 4), rs = inward('radialStyloid' + S_, 3.5);
    const olec = mad(inward('olecranon' + S_, 6), nrm(add(mul(nf, -0.6), mul(f, -0.8))), -1.0 * CM * kf);   // fitted: the tip 6 mm under the skin's olecranon
    add_('ulna.' + S_, [tube([olec, at(E, FF, -0.9 * kf, -0.4 * kf, -0.8 * kf), at(E, FF, -0.9 * kf, 1.5 * kf, 0.3 * kf), at(E, FF, -0.8 * kf, 5.0 * kf, -0.1 * kf), mad(uh, f, -5 * CM * kf), mad(uh, f, -1.2 * CM * kf)],
      [1.0, 1.15, 1.0, 0.75, 0.55, 0.6].map(v => v * kf * CM)), sphere(mad(uh, f, -0.8 * CM * kf), 0.85 * kf * CM), cone(mad(uh, f, -0.6 * CM * kf), mad(uh, f, 0.3 * CM * kf, nf, -0.3 * CM * kf), 0.35 * kf * CM, 0.2 * kf * CM)], 'arm', 0.004 * kf);
    const rAx = nrm(sub(rs, uh)), rd = mad(lerp(rs, uh, 0.4), f, -0.9 * CM * kf), Fr = frameOf(f, nrm(crs(rAx, f)), 1);
    add_('radius.' + S_, [tube([at(E, FF, 1.1 * kf, 0.8 * kf, 0.1 * kf), at(E, FF, 1.1 * kf, 1.8 * kf, 0.1 * kf)], [1.1, 1.0].map(v => v * kf * CM)),
      tube([at(E, FF, 1.1 * kf, 1.8 * kf, 0.1 * kf), at(E, FF, 0.9 * kf, 3.0 * kf, 0.35 * kf), mad(lerp(at(E, FF, 0.9 * kf, 3.0 * kf, 0.3 * kf), rd, 0.5), rAx, 0.8 * CM * kf), mad(rd, f, -2.5 * CM * kf)], [0.65, 0.75, 0.7, 0.95].map(v => v * kf * CM)),
      box(rd, [rAx, f, nrm(crs(rAx, f))], [1.4, 0.9, 0.85].map(v => v * kf * CM), 0.55 * kf * CM), cone(mad(rd, rAx, 1.0 * CM * kf), mad(rs, f, 0.2 * CM * kf), 0.75 * kf * CM, 0.35 * kf * CM)], 'arm', 0.004 * kf);
    pts['olecranon' + S_] = mad(olec, f, -1.0 * CM * kf); rays.push({ name: 'olecranon' + S_, o: mad(olec, nrm(add(mul(nf, -0.6), mul(f, -0.8))), 1.0 * CM * kf), d: nrm(add(mul(nf, -0.6), mul(f, -0.8))), key: 'olecranon', fit: true }); pts['ulnarHead' + S_] = uh; pts['radialStyloid' + S_] = rs;
    info['forearm' + S_] = +Lf.toFixed(1);
    // hand: carpus, metacarpals (knuckle heads), phalanges along the rig's finger bones (joint gaps 1.5 mm). Iteration 2: every segment FITTED inside the
    // hand's own skin (v6's hand is thin): rays from the segment's middle to the dorsal, palmar and side skin; the bone's radius at most the table's and
    // what leaves 2.5 mm of dorsal / 4 mm of palmar / 2.5 mm of side tissue (metacarpals: 3.5 mm dorsal), the bone set 2.5 / 3.5 mm under the dorsum
    // and centred side to side (the thumb centred both ways); shifts capped at 5 mm
    const hk = kf, bases = [1, 2, 3, 4].map(i => j(`metacarpal${i}.${S_}`)), mcp = [1, 2, 3, 4].map(i => j(`metacarpal${i}.${S_}`, 't'));
    const bm = bases.reduce((a, b) => add(a, mul(b, 0.25)), [0, 0, 0]), across = nrm(sub(bases[0], bases[3])), along = nrm(sub(bm, Wr)), pn = nrm(crs(across, along));   // pn: dorsal
    const fitSeg = (a, b, r0, { tD = 0.0025, tP = 0.004, tL = 0.0025, side: sd = true, thumb = false } = {}) => {
      const m = lerp(a, b, 0.5), u = nrm(sub(b, a)), dv = nrm(sub(pn, mul(u, dot(pn, u)))), lv = nrm(crs(u, dv)), R = d => rayToSkin(B, m, d);
      const hD = R(dv), hP = R(mul(dv, -1)), hL = sd ? R(lv) : Infinity, hM = sd ? R(mul(lv, -1)) : Infinity; if (!(hD < 0.04 && hP < 0.06)) return { a, b, r: r0, sh: [0, 0, 0] };
      let r = Math.min(r0, (hD + hP - tD - tP) / 2); if (hL < 0.04 && hM < 0.04) r = Math.min(r, (hL + hM) / 2 - tL); r = Math.max(r, 0.5 * r0);
      const c = thumb ? (hD - hP) / 2 : clamp(hD - tD - r, tP + r - hP, 1), cl = (hL < 0.04 && hM < 0.04) ? (hL - hM) / 2 : 0;
      let sh = add(mul(dv, c), mul(lv, cl)); const l = len(sh); if (l > 0.005) sh = mul(sh, 0.005 / l); return { a: add(a, sh), b: add(b, sh), r, sh }; };
    const cc = lerp(lerp(uh, rs, 0.5), bm, 0.55), half = len(sub(bm, lerp(uh, rs, 0.5))) * 100 * 0.42;
    // the carpus: a rounded mass centred in the wrist's skin (its thickness and breadth at most the skin's less 3 mm a side)
    const cR = d => rayToSkin(B, cc, d), cD = cR(pn), cP = cR(mul(pn, -1)), cA = cR(across), cB = cR(mul(across, -1)), cok = cD < 0.04 && cP < 0.04 && cA < 0.06 && cB < 0.06;
    const cHT = Math.min(0.62 * hk * CM, cok ? (cD + cP) / 2 - 0.003 : 1), cHW = Math.min((len(sub(bases[0], bases[3])) * 50 + 0.7 * hk) * CM, cok ? (cA + cB) / 2 - 0.003 : 1);
    const ccF = cok ? mad(cc, pn, clamp((cD - cP) / 2, -0.004, 0.004), across, clamp((cA - cB) / 2, -0.004, 0.004)) : cc;
    const prHd = [ell(ccF, [across, along, pn], [Math.max(cHW, 0.012) * 1.05, half * CM * 1.1, Math.max(cHT, 0.004) * 1.05])];   // an ellipsoid: no corners to meet the thenar web
    const fitH = info['hand' + S_] = { rScale: [], shiftMm: [] };
    for (let i = 0; i < 4; i++) { const a0 = mad(bases[i], along, 0.3 * CM * hk), b0 = mcp[i], d0 = nrm(sub(b0, a0)), q = fitSeg(a0, mad(b0, d0, -0.35 * CM * hk), 0.4 * hk * CM, { tD: 0.0035, tP: 0.006, side: false }), k = q.r / (0.4 * hk * CM);
      let hc = add(mad(b0, d0, -0.45 * CM * hk), q.sh); const rh = Math.min(0.52 * hk * CM, q.r * 1.45), hD = rayToSkin(B, hc, pn); if (hD < rh + 0.002) hc = mad(hc, pn, -Math.min(0.003, rh + 0.002 - hD));
      prHd.push(tube([q.a, lerp(q.a, q.b, 0.5), q.b], [0.5 * k, 0.33 * k, 0.42 * k].map(v => Math.min(v, 0.5) * hk * CM)), sphere(hc, rh)); fitH.rScale.push(+k.toFixed(2)); fitH.shiftMm.push(+(len(q.sh) * 1000).toFixed(1)); }
    { const th1 = j(`finger1-1.${S_}`), th1t = j(`finger1-1.${S_}`, 't'), q = fitSeg(mad(th1, nrm(sub(th1t, th1)), 0.2 * CM), mad(th1t, nrm(sub(th1t, th1)), -0.3 * CM * hk), 0.5 * hk * CM, { tD: 0.003, tP: 0.003, thumb: true }), k = q.r / (0.5 * hk * CM);
      prHd.push(tube([q.a, lerp(q.a, q.b, 0.5), q.b], [0.6, 0.42, 0.55].map(v => v * k * hk * CM))); }
    for (let fi = 1; fi <= 5; fi++) for (let ph = (fi === 1 ? 2 : 1); ph <= 3; ph++) { const a = j(`finger${fi}-${ph}.${S_}`), b0 = j(`finger${fi}-${ph}.${S_}`, 't'), dd = nrm(sub(b0, a)), Lp = len(sub(b0, a));
      const b = ph === 3 ? mad(a, dd, Lp * 0.78) : mad(b0, dd, -0.15 * CM), a2 = mad(a, dd, 0.15 * CM), r0 = (fi === 1 ? [0, 0.6, 0.48, 0.4] : [0, 0.45, 0.38, 0.32])[ph] * hk, r1 = (fi === 1 ? [0, 0.42, 0.33, 0.33] : [0, 0.32, 0.27, 0.28])[ph] * hk;
      const q = fitSeg(a2, b, Math.max(r0, r1) * CM, fi === 1 ? { tD: 0.003, tP: 0.003, thumb: true } : {}), k = q.r / (Math.max(r0, r1) * CM); fitH.rScale.push(+k.toFixed(2)); fitH.shiftMm.push(+(len(q.sh) * 1000).toFixed(1));
      prHd.push(tube([q.a, lerp(q.a, q.b, 0.5), q.b], [r0 * k, r1 * k, (ph === 3 ? r1 * 1.1 : r0 * 0.9) * k].map(v => v * CM))); }
    add_('hand.' + S_, prHd, 'hand', 0.0025);
    pts['met3' + S_] = mad(mcp[1], pn, -0.0);
  }
  // ============================================================ LEGS
  for (const side of [1, -1]) {
    const S_ = side > 0 ? 'L' : 'R', H = j('upperleg01.' + S_), K = j('lowerleg01.' + S_), A = j('foot.' + S_);
    const Lfm = len(sub(K, H)) * 100, kfm = wM, u = nrm(sub(K, H)), FL = frameOf(u, Z, side);
    const Rf = D('femurHead') * wD, Ln = D('femurNeck') * wD, nsa = D('neckShaft') * Math.PI / 180, av = D('antev') * Math.PI / 180;
    const offP = Ln * Math.sin(Math.PI - nsa), offU = Ln * Math.cos(Math.PI - nsa);             // head centre: off the shaft axis by offP, above the neck's base by offU
    const Kn = at(K, FL, 0, -1.0 * kfm, 0), alpha = Math.asin(clamp(offP * CM / len(sub(H, Kn)), 0, 0.3));
    const sdir = nrm(add(mul(nrm(sub(H, Kn)), Math.cos(alpha)), mul(FL.l, Math.sin(alpha))));   // the shaft axis (upward), its top lateral of the head
    const med = nrm(add(mul(FL.l, -Math.cos(av)), mul(FL.a, Math.sin(av))));                   // from the shaft toward the head: medial, anteverted
    const Pn = mad(H, med, -offP * CM, sdir, -offU * CM);                                      // the neck's base on the shaft axis
    const shTop = mad(Pn, sdir, -2.0 * CM * kfm), shR = D('femurShaft') * wD;
    // the distal femur FITTED in the knee's skin (iteration 2; v6's knees are narrow, ~8.8-10 cm across in the men against ~10-11): the condyles'
    // centre midway between the skin's sides at the epicondyles' height (+-0.6 cm), their breadth the skin's less 7 mm a side (0.88-1.0 of the table)
    const Ke = at(K, FL, 0, -0.5 * kfm, 0), kl = rayToSkin(B, Ke, FL.l) * 100, km = rayToSkin(B, Ke, mul(FL.l, -1)) * 100, kOK = kl < 20 && km < 20;
    const kW = kOK ? clamp((kl + km - 1.4) / (8.2 * kfm), 0.88, 1.0) : 1, kS = kOK ? clamp((kl - km) / 2 - (3.95 - 4.25) * kfm * kW / 2, -0.6, 0.6) : 0, Kc = at(K, FL, kS, 0, 0);
    info['knee' + S_] = { skinBreadth: +(kl + km).toFixed(1), shift: +kS.toFixed(2), scale: +kW.toFixed(2) };
    const prF = [sphere(H, Rf * CM), cone(mad(H, med, -0.6 * CM * kfm), Pn, 1.65 * kfm * CM, 1.9 * kfm * CM),
      ell(mad(Pn, sdir, 1.0 * CM * kfm, FL.l, 1.05 * CM * kfm, FL.a, -0.7 * CM * kfm), [FL.l, sdir, FL.a], [1.35, 2.6, 2.1].map(v => v * kfm * CM)),   // greater trochanter (lateral reach 2.4 cm from the shaft axis; iteration 1: 3.45)
      sphere(mad(Pn, sdir, -2.6 * CM * kfm, med, 1.2 * CM * kfm, FL.a, -1.2 * CM * kfm), 0.95 * kfm * CM),                                          // lesser trochanter
      tube([mad(Pn, sdir, 1.0 * CM * kfm), shTop, mad(lerp(shTop, Kn, 0.5), FL.a, 0.7 * CM * kfm), at(K, FL, 0, -9.0 * kfm, 0.1 * kfm)], [2.0 * kfm * CM, 1.7 * kfm * CM, shR * CM, 1.5 * kfm * CM]),
      cone(at(K, FL, kS * 0.5, -9.0 * kfm, 0.1 * kfm), at(Kc, FL, 0, -2.8 * kfm, -0.2 * kfm), 1.5 * kfm * CM, 2.9 * kfm * kW * CM),
      ell(at(Kc, FL, 2.15 * kfm * kW, -0.4 * kfm, -0.45 * kfm), axesOf(FL), [1.55 * kW, 2.15, 2.8].map(v => v * kfm * CM)), ell(at(Kc, FL, -2.15 * kfm * kW, -0.35 * kfm, -0.5 * kfm), axesOf(FL), [1.6 * kW, 2.1, 2.85].map(v => v * kfm * CM)),
      ell(at(Kc, FL, 0, -0.8 * kfm, 1.4 * kfm), axesOf(FL), [2.4 * kW, 2.0, 1.5].map(v => v * kfm * CM)),
      sphere(at(Kc, FL, 3.3 * kfm * kW, -0.5 * kfm, -0.1 * kfm), 0.65 * kfm * CM), sphere(at(Kc, FL, -3.5 * kfm * kW, -0.6 * kfm, -0.2 * kfm), 0.75 * kfm * CM)];
    add_('femur.' + S_, prF, 'leg', 0.006 * kfm);
    geo['fem' + S_] = { H, K, Kc, Pn, sdir, F: FL, Lfm, kfm, med, gt: mad(Pn, sdir, 1.0 * CM * kfm, FL.l, 1.05 * CM * kfm, FL.a, -0.7 * CM * kfm), shTop };
    pts['trochanter' + S_] = mad(Pn, sdir, 1.0 * CM * kfm, FL.l, 2.4 * CM * kfm, FL.a, -0.7 * CM * kfm);
    info['femur' + S_] = +(Lfm + Rf + KJ * kfm).toFixed(1); rays.push({ name: 'trochanter' + S_, o: pts['trochanter' + S_], d: FL.l, key: 'trochanter' });
    // patella
    const pd = D('patella').map(v => v * wD), Pc = at(K, FL, kS * 0.4, -0.3 * kfm, 2.5 * kfm + pd[2]);   // the patella over the trochlea, half way to the fitted centre
    add_('patella.' + S_, [ell(Pc, axesOf(FL), pd.map(v => v * CM)), cone(Pc, at(Pc, FL, 0, 2.0 * kfm, -0.3 * kfm), 1.3 * kfm * CM, 0.5 * kfm * CM)], 'leg', 0.006 * kfm);
    pts['patella' + S_] = at(Pc, FL, 0, 0, pd[2]); rays.push({ name: 'patella' + S_, o: pts['patella' + S_], d: FL.a, key: 'patella' });
    // tibia and fibula
    const Kj = at(K, FL, 0, KJ * kfm, 0), ut = nrm(sub(A, Kj)), FT = frameOf(ut, Z, side), Lt = len(sub(A, Kj)) * 100, kt = wM, Pl = mad(A, ut, -1.6 * CM * kt);
    const mmC = mad(inward('medMalleolus' + S_, 4), FT.l, 0.7 * kt * CM), lmC = mad(inward('latMalleolus' + S_, 4), FT.l, -0.78 * kt * CM);
    // the shaft FITTED inside the shin at three heights (iteration 2): the anterior CREST (the most subcutaneous bone in the body) 4 mm under the skin
    // straight ahead and the anteromedial face 4.5 mm under it (+1.5 mm per unit of fatK each), solved for a shift in the (anterior, lateral) plane;
    // iteration 1 fitted the anteromedial face alone and the crest came through the shin in all six men
    const amd = nrm(add(mul(FT.a, 0.7), mul(FT.l, -0.7))), mid = at(Kj, FT, 0, Lt * 0.5, 0.2 * kt), surf = (1.3 + 0.45) * kt;
    const tCr = 4 + 1.5 * Math.max(0, fatK), tAm = 4.5 + 1.5 * Math.max(0, fatK), HTS = [0.3, 0.5, 0.72], AZ = [0.1, 0.2, 0.15], CRZ = [1.55, 1.45, 1.3], CRR = [0.42, 0.40, 0.38], SHR = [1.45, 1.35, 1.3];
    const tsv = HTS.map((h, i) => { const m = at(Kj, FT, 0, Lt * h, AZ[i] * kt), rA = rayToSkin(B, m, FT.a) * 100, rM = rayToSkin(B, m, amd) * 100;
      if (!(rA < 50 && rM < 50)) return [0, 0];
      const sa = clamp(rA - (CRZ[i] - AZ[i] + CRR[i]) * kt - tCr / 10, -0.9, 0.8), sm = rM - SHR[i] * kt - tAm / 10, sl = clamp(sa - Math.SQRT2 * sm, -0.8, 0.8); return [sa, sl]; });
    info['tibiaShift' + S_] = tsv.map(v => v.map(x => +x.toFixed(2)));
    const tsh = (p, i, w = 1) => mad(p, FT.a, tsv[i][0] * w * CM, FT.l, tsv[i][1] * w * CM);   // i: the fitted height; w fades toward the plateau and the plafond
    // the tibial plateau FITTED like the condyles: centred between the skin's sides at its height (+-0.6 cm), its breadth the skin's less 8 mm a side
    // (measured at the plateau's top, middle and bottom; the narrowest decides: v6's men's knees narrow downward)
    let pl_ = Infinity, pm_ = Infinity; for (const h of [0.6, 1.6, 2.6]) { const Kp = at(Kj, FT, 0, h * kt, 0), a_ = rayToSkin(B, Kp, FT.l) * 100, b_ = rayToSkin(B, Kp, mul(FT.l, -1)) * 100; if (a_ < 20 && b_ < 20 && a_ + b_ < pl_ + pm_) { pl_ = a_; pm_ = b_; } }
    const pOK = pl_ < 20, tW = pOK ? clamp((pl_ + pm_ - 1.6) / (7.4 * kt), 0.88, 1.0) : 1, tS = pOK ? clamp((pl_ - pm_) / 2, -0.6, 0.6) : 0; info['plateau' + S_] = { skinBreadth: pOK ? +(pl_ + pm_).toFixed(1) : null, shift: +tS.toFixed(2), scale: +tW.toFixed(2) };
    const prT = [box(at(Kj, FT, tS, 1.6 * kt, -0.3 * kt), axesOf(FT), [3.7 * tW, 1.6, 2.4].map(v => v * kt * CM), 1.45 * kt * CM),   // the condyles rounded off (a kidney in plan, not a slab)
      ell(at(Kj, FT, 0.2 * kt + tS, 3.3 * kt, 2.35 * kt), axesOf(FT), [1.2, 1.6, 0.75].map(v => v * kt * CM)),
      tube([at(Kj, FT, tS * 0.6, 4.5 * kt, 0), tsh(at(Kj, FT, 0, Lt * 0.3, 0.1 * kt), 0), tsh(at(Kj, FT, 0, Lt * 0.5, 0.2 * kt), 1), tsh(at(Kj, FT, 0, Lt * 0.72, 0.15 * kt), 2), tsh(mad(Pl, ut, -6 * CM * kt), 2, 0.4)], [2.4, 1.45, 1.35, 1.3, 1.25].map(v => v * kt * CM)),
      tube([at(Kj, FT, 0.1 * kt, 5.0 * kt, 1.75 * kt), tsh(at(Kj, FT, 0.0, Lt * 0.3, 1.55 * kt), 0), tsh(at(Kj, FT, -0.1 * kt, Lt * 0.5, 1.45 * kt), 1), tsh(at(Kj, FT, -0.15 * kt, Lt * 0.72, 1.3 * kt), 2), tsh(at(Pl, FT, -0.2 * kt, -6 * kt, 1.1 * kt), 2, 0.4)], [0.5, 0.42, 0.4, 0.38, 0.35].map(v => v * kt * CM)),   // the anterior crest
      box(at(Pl, FT, -0.1 * kt, -1.3 * kt, 0), axesOf(FT), [2.3, 1.7, 1.9].map(v => v * kt * CM), 0.8 * kt * CM),
      cone(at(Pl, FT, -1.2 * kt, -1.6 * kt, 0.1 * kt), mmC, 1.2 * kt * CM, 0.9 * kt * CM), ell(mmC, axesOf(FT), [0.7, 1.45, 1.3].map(v => v * kt * CM))];   // medial malleolus (fitted: skin landmark 4 mm in)
    add_('tibia.' + S_, prT, 'leg', 0.006 * kt);
    const fh = at(Kj, FT, 3.6 * kt * tW + tS, 1.6 * kt, -1.6 * kt), lmal = lmC;
    add_('fibula.' + S_, [sphere(fh, 1.15 * kt * CM), tube([fh, at(Kj, FT, 2.7 * kt, Lt * 0.5, -1.2 * kt), at(A, FT, 2.5 * kt, -5 * kt, -0.9 * kt), lmal], [0.8, 0.6, 0.75, 0.9].map(v => v * kt * CM)),
      ell(lmal, axesOf(FT), [0.78, 1.6, 1.2].map(v => v * kt * CM))], 'leg', 0.005 * kt);
    pts['tibialTub' + S_] = at(Kj, FT, 0.2 * kt + tS, 3.3 * kt, 3.1 * kt); pts['medMal' + S_] = mad(mmC, FT.l, -0.7 * kt * CM); pts['latMal' + S_] = at(lmal, FT, 0.78 * kt, 0, 0); pts['fibHead' + S_] = fh;
    info['tibia' + S_] = +(Lt + 0.5).toFixed(1); const tibP = parts.find(q => q.name === 'tibia.' + S_); let so = mid; for (let q = 0; q < 80; q++) { const pq = mad(mid, amd, q * 0.0005); if (sdPart(tibP, pq[0], pq[1], pq[2]) > 0) { so = pq; break; } }
    const crestAt = h => { const m = at(Kj, FT, 0, Lt * h, 0.1 * kt); for (let q = 0; q < 80; q++) { const pq = mad(m, FT.a, q * 0.0005); if (sdPart(tibP, pq[0], pq[1], pq[2]) > 0) return pq; } return m; };
    rays.push({ name: 'tibialTub' + S_, o: pts['tibialTub' + S_], d: FT.a, key: 'tibialTub' }, { name: 'tibialShaft' + S_, o: so, d: amd, key: 'tibialShaft' },
      { name: 'crest30' + S_, o: crestAt(0.3), d: FT.a, key: 'tibialCrest' }, { name: 'crest50' + S_, o: crestAt(0.5), d: FT.a, key: 'tibialCrest' }, { name: 'crest75' + S_, o: crestAt(0.75), d: FT.a, key: 'tibialCrest' });
    // foot: talus, calcaneus (inside the heel pad), navicular, cuboid, cuneiforms, metatarsals to the MTP joints, phalanges along the rig's toes
    const fk = kt, mtp = [1, 2, 3, 4, 5].map(i => j(`toe${i}-1.${S_}`)), mm = mtp.reduce((a, b) => add(a, mul(b, 0.2)), [0, 0, 0]);
    const heelB = lm['heel' + S_];
    const ff = nrm([mm[0] - heelB[0], 0, mm[2] - heelB[2]]), FFt = frameOf(Y, ff, side), lf = FFt.l, up = Y;
    const ft = (o, x, y, z) => mad(o, lf, x * CM * fk, up, y * CM * fk, ff, z * CM * fk);
    const tub_ = [heelB[0] + ff[0] * 2.8 * CM * fk, 3.5 * CM * fk, heelB[2] + ff[2] * 2.8 * CM * fk], ccj = ft(A, 1.3, -4.0, 4.6);   // the tuber: 1 cm of posterior pad, 1.5 cm of plantar pad
    const prFt = [ell(ft(A, 0, -0.5, 0.2), [lf, up, ff], [1.5, 1.45, 2.0].map(v => v * fk * CM)), cone(ft(A, -0.1, -0.9, 1.4), ft(A, -0.6, -1.9, 3.3), 1.25 * fk * CM, 1.15 * fk * CM),
      ell(tub_, [lf, up, ff], [1.4, 2.0, 1.6].map(v => v * fk * CM)), box(lerp(tub_, ccj, 0.5), [lf, nrm(crs(nrm(sub(ccj, tub_)), lf)), nrm(sub(ccj, tub_))], [1.35, 1.5, len(sub(ccj, tub_)) * 50].map(v => v * fk * CM), 0.8 * fk * CM),
      ell(ft(A, -1.3, -2.4, 0.9), [lf, up, ff], [1.0, 0.6, 1.4].map(v => v * fk * CM)),
      ell(ft(A, -0.9, -2.6, 4.4), [lf, up, ff], [1.25, 1.2, 0.75].map(v => v * fk * CM)), sphere(ft(A, -2.1, -3.2, 4.0), 0.6 * fk * CM),
      box(ft(A, 1.4, -3.9, 5.8), [lf, up, ff], [1.0, 0.95, 1.3].map(v => v * fk * CM), 0.5 * fk * CM), box(ft(A, -0.7, -2.9, 6.2), [lf, up, ff], [1.6, 1.0, 1.0].map(v => v * fk * CM), 0.5 * fk * CM)];
    const tmt = [ft(A, -1.6, -3.2, 7.2), ft(A, -0.5, -2.9, 7.0), ft(A, 0.4, -3.0, 6.8), ft(A, 1.3, -3.4, 6.8), ft(A, 2.4, -4.0, 6.7)];
    for (let i = 0; i < 5; i++) { const r = i === 0 ? [0.9, 0.65, 0.95] : [0.7, 0.42, 0.68], hd = mad(mtp[i], ff, -0.5 * CM * fk); hd[1] = Math.max(hd[1], (1.1 + r[2]) * fk * CM);   /* the forefoot pad under the heads */ prFt.push(tube([tmt[i], lerp(tmt[i], hd, 0.5), hd], r.map(v => v * fk * CM)), sphere(hd, r[2] * fk * CM)); }
    prFt.push(sphere(mad(tmt[4], lf, 0.6 * CM * fk), 0.7 * fk * CM));
    for (let ti = 1; ti <= 5; ti++) for (let ph = 1; ph <= (ti === 1 ? 2 : 3); ph++) { const a = j(`toe${ti}-${ph}.${S_}`), b0 = j(`toe${ti}-${ph}.${S_}`, 't'), dd = nrm(sub(b0, a)), Lp = len(sub(b0, a));
      const b = ph === (ti === 1 ? 2 : 3) ? mad(a, dd, Lp * 0.75) : mad(b0, dd, -0.12 * CM), a2 = mad(a, dd, 0.12 * CM), r = (ti === 1 ? 0.55 : 0.33) * fk * (ph === 1 ? 1 : 0.85);
      for (const q of [a2, b]) q[1] = Math.max(q[1], (0.9 + r) * CM); prFt.push(tube([a2, b], [r * CM, r * 0.85 * CM])); }
    add_('foot.' + S_, prFt, 'foot', 0.004 * fk);
    pts['heel' + S_] = mad(tub_, ff, -1.6 * CM * fk); rays.push({ name: 'heel' + S_, o: pts['heel' + S_], d: mul(ff, -1), key: 'heel' });
  }
  // ============================================================ CLEARANCE: the small bones fitted inside the skin. A part whose surface comes within 2.5 mm of the
  // skin (or through it) is moved rigidly inward along the mean skin normal of the offending vertices, capped per group. The femur and the pelvis are
  // NOT moved: where they meet the skin it is a finding (the trochanters; NOTES), for the envelope to answer.
  const CAP = { spine: 6, ribs: 6, girdle: 8, sternum: 4, arm: 4, hand: 3, leg: 3, foot: 5 }, cmin = 0.0025, Psk = B.pos, oral = oralLining(B, fids); info.clear = {};
  if (opts.clear !== false) for (const p of parts) { const cap = CAP[p.group]; if (!cap || /^femur/.test(p.name)) continue; let moved = [0, 0, 0];
    for (let it = 0; it < 3; it++) { let need = 0, nx = 0, ny = 0, nz = 0, cnt = 0; const bb = p.bb;
      for (let v = 0; v < B.nb; v++) { if (oral.has(v)) continue; const x = Psk[v * 3], y = Psk[v * 3 + 1], z = Psk[v * 3 + 2]; if (x < bb[0] - 0.01 || x > bb[3] + 0.01 || y < bb[1] - 0.01 || y > bb[4] + 0.01 || z < bb[2] - 0.01 || z > bb[5] + 0.01) continue;
        const d = sdPart(p, x, y, z, 0.02); if (d < cmin) { need = Math.max(need, cmin - d); nx += Nsk[v * 3]; ny += Nsk[v * 3 + 1]; nz += Nsk[v * 3 + 2]; cnt++; } }
      if (!cnt) break; const nn = nrm([nx, ny, nz]), left = cap / 1000 - len(moved), stp = Math.min(need, Math.max(0, left)); if (stp <= 1e-5) break;
      const dd = mul(nn, -stp); shiftPart(p, dd); moved = add(moved, dd); }
    if (len(moved) > 1e-5) info.clear[p.name] = +(len(moved) * 1000).toFixed(1); }
  // ============================================================ the tests: tissue depth over the subcutaneous landmarks (skin landmark -> nearest bone)
  const T = (skin, key) => { if (lm[skin]) tests.push({ skin, key, lo: TISSUE[key][0], hi: TISSUE[key][1] }); };
  for (const S_ of ['L', 'R']) { T('clavicleMid' + S_, 'clavicleMid'); T('acromion' + S_, 'acromion'); T('olecranon' + S_, 'olecranon'); T('latEpicondyle' + S_, 'latEpicondyle'); T('medEpicondyle' + S_, 'medEpicondyle');
    T('met3' + S_, 'met3'); T('asis' + S_, 'asis'); T('iliacCrest' + S_, 'iliacCrest'); T('psis' + S_, 'psis'); T('trochanter' + S_, 'trochanter'); T('patella' + S_, 'patella'); T('tibialTub' + S_, 'tibialTub');
    T('latMalleolus' + S_, 'latMalleolus'); T('medMalleolus' + S_, 'medMalleolus'); T('heel' + S_, 'heel'); T('rib10' + S_, 'rib10');
    T('ulnarHead' + S_, 'ulnarHead'); T('radialStyloid' + S_, 'radialStyloid'); }
  T('suprasternale', 'suprasternale'); T('xiphoid', 'xiphoid'); T('cervicale', 'cervicale'); T('sacrum', 'sacrum'); T('pubis', 'pubis');
  // which tests are fits (the bone was placed from that landmark): reported, not scored
  const FIT = new Set(['suprasternale', 'xiphoid', 'cervicale', 'acromionL', 'acromionR', 'scapRootL', 'scapRootR', 'scapInfL', 'scapInfR', 'ulnarHeadL', 'ulnarHeadR', 'radialStyloidL', 'radialStyloidR']);
  for (const t of tests) t.fit = FIT.has(t.skin);
  // lateral tests (the skin's trunk breadth at a bone's height minus the bone's lateral reach): the greater trochanter and the cage's widest rib
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const gt = pts['trochanter' + S_]; tests.push({ skin: 'trochanterLat' + S_, key: 'trochanter', lo: TISSUE.trochanter[0], hi: TISSUE.trochanter[1], lat: { y: gt[1], x: Math.abs(gt[0]), s } });
    const r8 = ribPts['rib8' + S_].lat; tests.push({ skin: 'cageLat' + S_, key: 'rib10', lo: 10, hi: 40, lat: { y: r8[1], x: Math.abs(r8[0]), s } }); }
  const groups = {}; for (const p of parts) (groups[p.group] ||= []).push(p);
  for (const r of rays) { r.lo = TISSUE[r.key][0]; r.hi = TISSUE[r.key][1]; }
  geo.ribs = ribPts; geo.margin = margin3;
  return { version: SKELETON_VERSION, parts, groups, pts, info, tests, rays, faceIds: fids, geo };
}
// ---------------------------------------------------------------- curve helpers
function catmull(P, n = 12) {
  const out = []; for (let i = 0; i + 1 < P.length; i++) { const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t; out.push([0, 1, 2].map(a => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3))); } }
  out.push(P[P.length - 1].slice()); return out;
}
function arcLen(C) { const a = [0]; for (let i = 1; i < C.length; i++) a.push(a[i - 1] + len(sub(C[i], C[i - 1]))); return a; }
function pointAt(C, A, s) { for (let i = 1; i < C.length; i++) if (A[i] >= s) { const t = (s - A[i - 1]) / Math.max(1e-9, A[i] - A[i - 1]); return lerp(C[i - 1], C[i], t); } return C[C.length - 1].slice(); }
// tissue depth at every test landmark: the skin point's distance to the nearest bone (positive = skin outside the bone); and the skin vertices inside bone
export function tissueReport(B, K) {
  const Pf = profile(B);
  const rows = K.tests.map(t => { if (t.lat) { const mm = (Pf.lat(t.lat.y, t.lat.s) - t.lat.x) * 1000; return { ...t, mm: +mm.toFixed(1), part: 'lateral', verdict: mm < 0 ? 'THROUGH' : mm < t.lo ? 'thin' : mm > t.hi ? 'thick' : 'ok' }; }
    const p = B.lm[t.skin], r = sdParts(K.parts, p[0], p[1], p[2], 0.2); const mm = r.d * 1000;
    return { ...t, mm: +mm.toFixed(1), part: r.i >= 0 ? K.parts[r.i].name : null, verdict: t.fit ? 'fit' : mm < 0 ? 'THROUGH' : mm < t.lo ? 'thin' : mm > t.hi ? 'thick' : 'ok' }; });
  const rayRows = (K.rays || []).map(r => { const mm = rayToSkin(B, r.o, r.d) * 1000; return { name: r.name, key: r.key, lo: r.lo, hi: r.hi, mm: +mm.toFixed(1), fit: !!r.fit, verdict: !(mm < 1e6) ? 'OUT' : r.fit ? 'fit' : mm < r.lo ? 'thin' : mm > r.hi ? 'thick' : 'ok' }; });
  let inside = 0; const by = {}; const P = B.pos;
  const oral = oralLining(B, K.faceIds);
  for (let v = 0; v < B.nb; v++) { if (oral.has(v)) continue; const r = sdParts(K.parts, P[v * 3], P[v * 3 + 1], P[v * 3 + 2], 0.003); if (r.d < 0) { inside++; const n = K.parts[r.i].name; const q = by[n] ||= { n: 0, y0: 999, y1: -999, dmin: 0 }; q.n++; q.y0 = Math.min(q.y0, +(P[v * 3 + 1] * 100).toFixed(1)); q.y1 = Math.max(q.y1, +(P[v * 3 + 1] * 100).toFixed(1)); q.dmin = Math.min(q.dmin, +(r.d * 1000).toFixed(1)); } }
  return { rows, rays: rayRows, inside, insideBy: by };
}
