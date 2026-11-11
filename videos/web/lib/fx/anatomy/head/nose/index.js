// NOSE AND MOUTH (round 7 studio, 8 Oct): THE EXTERNAL NOSE BUILT AS ANATOMY, the parts the skin membrane wraps (never a sculpt).
// Pure JS (node or browser), no three.js; millimetres in the craniometric frame (skull/frame.js: x the person's left, y up normal to the
// Frankfurt horizontal, z forward), on ANAT8-HEAD's skull (lib/fx/anatomy/skull/: the nasal bones, the piriform aperture, the ANS, the bony
// septum and the incisors are ITS; this module starts where the bone ends).
//   const N = buildNose(B, G, st, { params, lip, face })
//     B: skull/skull.js buildSkull(..); G: the bone's sampled, redistanced field (head/index.js buildHead's H.G); st { name, sex, age, group };
//     o.params: nose/params.js noseParams(..) (drawn here when absent); o.lip: { dir: [0, dy, dz] } the upper lip's outer tangent in profile
//     (mouth/index.js: the lip lies on the incisors; default from the incisor and the A point); o.face: (x, y, z) -> the face's skin level
//     away from the nose (negative inside; ANAT8-HEAD's envelope, or the current person's skin), used only to seat the alar base on it
//   N.parts       the SOLIDS as layer/sdf.js primitives, labelled (head/common.js LBL.cartilage) and named: 'septal cartilage', 'upper lateral
//                 cartilage'(_R), 'lower lateral cartilage'(_R) (one strip: footplate, medial crus, intermediate crus, dome, lateral crus);
//                 the drop-in for head/index.js buildNose's parts (the seam with ANAT8-HEAD: NOTES)
//   N.lobules     the ALAR LOBULES (fibrofatty, no cartilage at the rim: Oneal and Beil 2010), soft tissue for the solve (NOSE_TISSUE.alar)
//   N.vestibules  the NOSTRILS as the spaces the crura and the lobule enclose (a cavity: subtract it from the skin)
//   N.envT(p)     the soft-tissue envelope's thickness over the cartilage (subcutaneous + nasal SMAS + dermis; Lessard and Daniel 1985)
//   N.skin(x, y, z) the external nose's outer surface as a distance-like field (negative inside): the framework offset by its envelope,
//                 smooth-joined to the lobules (the supra-alar crease where they meet), the vestibules carved; N.join(face) -> the face's
//                 field with the nose joined (the alar-facial groove: a tight blend where the alar base's dermis is tethered, a wide one
//                 where the sidewall runs into the cheek)
//   N.curves      the feature lines the membrane must hold (hm08's rings onto these): the nostril margins, the alar-facial groove, the
//                 columella's lower edge, the tip-defining points, the dorsal line
//   N.lm          the anatomy's own landmarks (prn, sn (the SKIN's subnasale: NOSE 3), sn0 (the columella's base on the lip), al, ac, c'
//                 (columella), the domes, ASA, the keystone): what the skin should show,
//                 for the measurer (labs/nosemouth/nm_measure.mjs reads the same on any surface)
//   N.mats        materials by part (nose/params.js NOSE_TISSUE) for ANAT8-HEAD's soft-tissue solve; N.report
// HOW IT IS BUILT (each step the anatomy's, in the order the anatomy stands on itself; sources in nose/params.js):
//  1. THE TRIPOD'S BASE: the medial crura's footplates rest on the premaxilla in front of the nasal floor, the subnasale's soft tissue
//     (the upper lip's tissue: the columella stands on the lip, and the lip is a SHEET over the premaxilla's subspinale hollow, hung from
//     the nasal base and resting on the incisors: mouth/index.js lipHull, NOSE 3); the columella's inclination is the lip's tangent turned by
//     the columella-labial angle the medial crura make. The skin's subnasale is where the columella's underside comes out of the lip's skin.
//  2. THE LOWER LATERAL CARTILAGE, one strip a side (its width along the section's U, its thickness along V): the footplate (flared off the
//     midline), the medial crus up the columella, the intermediate crus diverging to the DOME (its arc radius domeR: the tip's definition),
//     the lateral crus on the sidewall at lcAx off the dorsum's axis (out, back and up) for lcLen, its width lcW turned cephalically.
//  3. THE SEPTUM: a plate in the midsagittal plane from under the nasal bones (the keystone) along the dorsum to the anterior septal angle
//     (ASA, held supraBreak behind the domes' fronts: the supratip break is the cartilage's), its caudal border down behind the medial
//     crura (the membranous septum between) to the posterior septal angle at the ANS, its base on the premaxillary crest and the vomer.
//  4. THE UPPER LATERALS: a tent on the septum's dorsal border from under the nasal bones (keystone overlap) to the scroll over the lateral
//     crura's cephalic edge, its free lateral edge falling to the piriform aperture's margin (the aperture's breadth is the skull's).
//  5. THE ALAR LOBULE: fibrofatty, from the ALAR BASE (lateral to the aperture by alBase, seated on the face) forward along the alar rim to
//     the soft triangle under the dome, bowed out by alFlare, alT thick: al-al and the alar-facial groove come from the aperture's breadth,
//     the base, the flare and the lobule's thickness, never from a target width.
//  6. THE ENVELOPE AND THE NOSTRILS: the skin is the framework offset by its envelope (thick at the nasion and the tip, thin at the rhinion
//     and the columella), joined to the lobules; the nostril is the space left between the columella and the lobule, its vestibule rising
//     along the nostril's axis toward the internal valve.
import * as D from '../../layer/sdf.js';
import { noseParams, NOSE_TISSUE, NOSE_PARAMS_VERSION } from './params.js';
import { mouthParams } from '../mouth/params.js';
import { lipHull } from '../mouth/index.js';
export { noseParams, NOSE_TISSUE };
export const NOSE_VERSION = 3;   // 3 (16 Oct, c4 it2): the columella's base on the upper lip's SHEET over the premaxilla's hollow (mouth/ lipHull: S10); lm.sn the SKIN's subnasale (the columella's underside meeting the lip's skin), lm.sn0 the base. 2 (8 Oct): the alare on the alar lobule; the subnasale on the upper lip
const { v3 } = D, clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const LBL_CART = 10, LBL_FAT = 8;   // head/common.js LBL.cartilage, LBL.supFat (the lobule is soft tissue)
const f1 = x => +(+x).toFixed(1), r1 = p => p.map(f1), rad = d => d * Math.PI / 180;
// rotate a profile vector [0, y, z] by a (deg) counter-clockwise in the (z, y) plane (from forward toward up)
const rotYZ = (v, a) => { const c = Math.cos(rad(a)), s = Math.sin(rad(a)); return [v[0], v[1] * c + v[2] * s, v[2] * c - v[1] * s]; };
const mirror = p => [-p[0], p[1], p[2]];
// the first bone surface along -z from in front (the sampled field marched)
function boneZ(G, x, y, z0 = 160) { let t = 0; for (let i = 0; i < 400 && t < 220; i++) { const d = G.value(x, y, z0 - t); if (d < 0.03) return z0 - t; t += Math.max(d * 0.85, 0.05); } return null; }
// the skin of a field along -z (first crossing from in front)
export function fieldZ(F, x, y, z0 = 170, minZ = -20, step = 0.5) { let prev = F(x, y, z0); for (let z = z0 - step; z >= minZ; z -= step) { const f = F(x, y, z); if (f < 0 && prev >= 0) return z + step * (-f) / (prev - f); prev = f; } return null; }

export function buildNose(B, G, st, o = {}) {
  const t0 = Date.now(), lm = B.lm, g = B.geo, K = B.K, P = o.params || noseParams(st, o.paramOpts || {}), m = P.sex === 'm';
  const ANS = lm.ANS, N0 = lm.N, Rhi = lm.Rhi, yANS = ANS[1], zANS = ANS[2], Hap = Rhi[1] - yANS, rep = { params: {} };
  for (const k of ['mcLen', 'domeW', 'domeR', 'lcLen', 'lcW', 'lcT', 'lcAx', 'cla', 'supraBreak', 'alT', 'alFlare', 'alBase', 'keystone', 'thickSkin']) rep.params[k] = +(+P[k]).toFixed(2);
  // the piriform aperture's half-breadth at height y (skull.js's aperture sweep: widest ~ 0.3 Hap above the ANS, narrowing to the nasal
  // bones' free margin): the upper laterals' free edge and the alar base stand on it
  const apW = y => { const t = (y - yANS) / (Hap || 1); return t < 0.3 ? lerp(K.NLB / 2 - 3.5, K.NLB / 2, sstep(-0.1, 0.3, t)) : t < 0.75 ? lerp(K.NLB / 2, K.NLB / 2 - 5, sstep(0.3, 0.75, t)) : lerp(K.NLB / 2 - 5, 2.8, sstep(0.75, 1.0, t)); };
  // ---- 1. the lip's tangent and the columella's inclination
  const lipDir = o.lip?.dir ? v3.norm(o.lip.dir) : v3.norm(v3.sub(lm.UIE, [0, lm.A[1], lm.A[2] + 1.5]));       // the upper lip lies on the premaxilla and the incisor
  const C = v3.norm(rotYZ(lipDir, P.cla)), Cup = v3.norm(rotYZ(C, 90));                                       // the columella's axis (forward-up) and its cephalic normal
  // THE SUBNASALE STANDS ON THE UPPER LIP (iteration 2): the columella's base inserts on the upper lip's skin, and the lip lies on the
  // premaxilla: the subnasale's depth is the premaxilla's front under it (the bone, marched) + the lip's own tissue there (the mouth's
  // layers: the glands and mucosa, the orbicularis' peripheral part, the subcutaneous fat, the dermis: mouth/params.js for this person).
  // Iteration 1 put it a Holdaway number (14-17 mm, x the thick skin) ahead of the ANS: on ANAT8-HEAD's forward maxillae (L03, L05: the
  // current face's subnasale only 4-11 mm ahead of their ANS) the whole nose stood 9-18 mm proud of the person's face, the tip 20-25 mm
  // from the skin's subnasale (the scans: women 14.3 +- 3.4, men 10.7 +- 5.1). The ANS's 'snDepth' is now what the lip makes (reported).
  // (NOSE 3, c4 it2: S10 with ANAT8-HEAD) the lip the columella stands on is a SHEET over the premaxilla's subspinale hollow (mouth/index.js
  // lipHull: hung from the nasal base over the spine and resting on the incisors' crowns; the lip's deep tissue fills the hollow under it),
  // so the base's depth is that sheet + the lip's layers, not the deepest premaxilla + the layers (NOSE 2: on ANAT8-HEAD's skull the
  // subnasale stood 5-10 mm inside the face and the tip and the bridge followed it: ANAT8-HEAD's S10 table)
  const MPs = mouthParams(st), lipT = MPs.mgU + MPs.periT + MPs.fatLip + MPs.dermU, ySn0 = yANS - 4.0, LH = lipHull(B, G), zBone0 = boneZ(G, 0, ySn0) ?? (zANS - 2), zPmx = Math.max(zBone0, LH.hull(ySn0) ?? zBone0);
  const lipFront = y => (LH.hull(y) ?? zPmx) + lipT;   // the upper lip's skin in the midline profile (its layers on the sheet)
  const snDepth = zPmx + lipT - zANS;
  // the SUBNASALE (the columella's base on the lip) snDepth ahead of the ANS and ~4 mm below it (the cephalometric chain: ANS to the
  // incisal edge ~ 28 mm, the upper lip sn-sto ~ 20-22, the display ~ 2-3: Legan and Burstone 1980; McNamara's norms, as recalled); the medial crura's COLUMELLAR segment
  // starts ~2.6 mm deep to it (CB) and runs 62 % of mcLen up the columella; the FOOTPLATE (the rest) flares back and out into the sill
  const sn0 = [0, yANS - 4.0, zANS + snDepth], CB = [1.6, sn0[1] + 2.4, sn0[2] - 2.6], fpLen = 0.38 * P.mcLen;
  const foot = v3.add(CB, v3.add(v3.mul(C, -0.75 * fpLen), [2.2, -0.4, 0]));                                    // the footplate's posterior end (left)
  const mc = (s, x) => { const p = v3.add(CB, v3.mul(C, s)); return [x, p[1], p[2]]; };
  const Gm = mc(0.62 * P.mcLen, 1.35), Cdome = v3.norm(rotYZ(C, 38)), Dm = (() => { const p = v3.add(Gm, v3.mul(Cdome, 2.2 + 0.4 * P.domeR)); return [P.domeW, p[1], p[2]]; })();
  // the lateral crus' axis: on the nasal sidewall, lcAx off the dorsum's axis (Sheen: ~45 deg; nearer the dorsum = cephalic malposition),
  // i.e. between the dorsum's line (toward the rhinion) and the sidewall's lateral run (out and back)
  const upD = v3.norm(v3.sub(Rhi, Dm)), lat0 = v3.norm([1, 0, -0.62]), latS = v3.norm(v3.sub(lat0, v3.mul(upD, v3.dot(lat0, upD)))), ax = rad(P.lcAx);
  const lcDir = v3.norm(v3.add(v3.mul(upD, Math.cos(ax)), v3.mul(latS, Math.sin(ax))));
  const nOut = v3.norm(v3.cross(upD, lcDir)[0] > 0 ? v3.cross(upD, lcDir) : v3.cross(lcDir, upD)), lcU0 = v3.norm(v3.cross(nOut, lcDir)), lcU = lcU0[1] < 0 ? v3.mul(lcU0, -1) : lcU0;   // lcU: across the crus, cephalic
  // the dome: the strip turns from the intermediate crus to the lateral crus over an arc of radius domeR (a sharper dome: a defined tip)
  const Dl = v3.add(Dm, v3.mul(v3.norm(v3.add(lcDir, [0.3, -0.35, 0.2])), P.domeR)), half = P.lcW / 2;
  const lc0 = v3.add(Dl, v3.mul(lcU, 0.3 * half)), lc1 = v3.add(v3.add(Dl, v3.mul(lcDir, 0.5 * P.lcLen)), v3.mul(lcU, 0.85 * half));
  // its lateral half curves back toward the aperture's margin (where the accessory cartilages carry it on): it does not run on outward
  const lcBack = v3.norm(v3.add(v3.mul(lcDir, 0.35), [0, 0.12, -0.65])), lc2 = v3.add(v3.add(lc1, v3.mul(lcBack, 0.5 * P.lcLen)), v3.add(v3.mul(lcU, -0.1 * half), v3.mul(nOut, -1.2)));
  const spine = [foot, v3.lerp(foot, CB, 0.55).map((c, i) => i === 0 ? lerp(foot[0], CB[0], 0.7) : c), CB, mc(0.31 * P.mcLen, 1.3), Gm, [lerp(Gm[0], Dm[0], 0.35), lerp(Gm[1], Dm[1], 0.55), lerp(Gm[2], Dm[2], 0.55)], Dm, Dl, lc0, lc1, lc2];
  const upDome = v3.norm([0.12, 0.72, -0.6]);
  const across = [Cup, Cup, Cup, Cup, Cup, v3.norm(v3.add(Cup, upDome)), upDome, v3.norm(v3.add(upDome, lcU)), lcU, lcU, lcU];
  const widths = [2.4, 2.5, 2.4, 2.3, 2.2, 2.1, 2.2, 2.6, 0.75 * half, half, 0.8 * half], T = P.lcT;
  // the sheet's rows along the strip, four columns across it (caudal margin -> cephalic margin); the across-vector made normal to the strip
  const ctrl = spine.map((c, i) => { const t = v3.norm(v3.sub(spine[Math.min(spine.length - 1, i + 1)], spine[Math.max(0, i - 1)])); let u = v3.sub(across[i], v3.mul(t, v3.dot(across[i], t))); u = v3.norm(u); return [-1, -1 / 3, 1 / 3, 1].map(s => v3.add(c, v3.mul(u, s * widths[i]))); });
  const halfT = spine.map((_, i) => [0, 1, 2, 3].map(() => (i === 0 ? T / 2 + 0.15 : T / 2)));
  const llcL = D.smoothSheet(ctrl, halfT, { nu: 4, nv: 2, label: LBL_CART, name: 'lower lateral cartilage' });
  // ---- 3. the septum: its dorsal border continues the bony dorsum (the nasal bones' line N -> Rhi) under the keystone, to the ASA
  const dorsal = v3.norm(v3.sub(Rhi, N0)), nDors = v3.norm(rotYZ(dorsal, 90)), domeTop = Dm[2] + T / 2;      // nDors: the dorsum's outward normal (forward-up)
  const lineZ = y => Rhi[2] + (y - Rhi[1]) * dorsal[2] / dorsal[1];
  // the ASA: the septum's dorsal corner holds the supratip supraBreak behind the domes' fronts (the septal height carries the tip: the
  // cartilaginous dorsum is the straight border from under the rhinion to it, whatever angle that makes with the bony dorsum: reported)
  const yASA = Dm[1] + 3.6 + 0.4 * P.domeR, zASA = domeTop - P.supraBreak - 1.2, ASA = [0, yASA, zASA];
  const keyY = Rhi[1] + P.keystone * Math.abs(dorsal[1]), K0 = [0, keyY, lineZ(keyY) - 2.0];
  const PSA = [0, yANS + 3.2, zANS + 1.5], cauMid = v3.add(v3.lerp(ASA, PSA, 0.5), v3.mul(Cup, -0.5));
  const septPoly = [[K0[1] + 2, K0[2] - 10], [K0[1], K0[2]], [Rhi[1], lineZ(Rhi[1]) - 1.1], [ASA[1], ASA[2]], [cauMid[1], cauMid[2]], [PSA[1], PSA[2]], [yANS - 0.5, zANS - 6], [yANS - 1, zANS - 24], [K0[1] - 6, K0[2] - 24]];
  const septT = P.septT, septal = D.heightSlab(() => septT / 2, septT, D.regionPoly(septPoly), { axis: 'x', k: 0.8, label: LBL_CART, name: 'septal cartilage',
    aabb: [-septT, yANS - 3, zANS - 28, septT, K0[1] + 4, Math.max(ASA[2], K0[2]) + 2] });
  // ---- 4. the upper laterals: a tent on the septum's dorsal border, under the nasal bones by the keystone, to the scroll
  const dZ = y => y >= Rhi[1] ? lineZ(y) - 1.6 : lerp(lineZ(Rhi[1]) - 1.1, ASA[2] - 0.3, clamp((Rhi[1] - y) / (Rhi[1] - ASA[1] || 1), 0, 1));
  const dorsalBend = (Math.atan2(ASA[2] - (lineZ(Rhi[1]) - 1.1), Rhi[1] - ASA[1]) - Math.atan2(-dorsal[2], dorsal[1]) * -1 * 0 - Math.atan2(dorsal[2], -dorsal[1])) * 180 / Math.PI;   // + = the cartilaginous dorsum turned forward of the bony line (a concave radix-to-tip profile)
  const cot = 1.15 + 0.35 * clamp((Rhi[1] - (Rhi[1] + ASA[1]) / 2) / 20, 0, 1), ulF = (x, y) => dZ(y) - (Math.sqrt(x * x + 4) - 2) * cot;
  const yScroll = Dl[1] + 0.6 * half + 1.0, ulcT = P.ulcT;
  const ulc = D.heightSlab(ulF, ulcT, (x, y) => Math.max(Math.abs(x) - (apW(y) + 1.2), y - keyY, yScroll - y), { k: 1.0, label: LBL_CART, name: 'upper lateral cartilage',
    aabb: [-(K.NLB / 2 + 4), yScroll - 2, Math.min(ASA[2], K0[2]) - 26, K.NLB / 2 + 4, keyY + 2, Math.max(ASA[2], K0[2]) + 2] });
  // ---- 5. the alar lobule (left): from the alar base on the face forward along the rim to the soft triangle
  const acX = apW(yANS + 0.3 * Hap) + P.alBase, xAb = acX - 0.55 * P.alT - P.env.ala, yAb = yANS + 1.6;            // ac: the alar crease's skin point; xAb: the lobule's core
  const zFace = o.face ? fieldZ(o.face, xAb, yAb) : null, zBone = boneZ(G, xAb, yAb) ?? (zANS - 6), zAb = (zFace ?? zBone + (m ? 13 : 12)) - 0.6 * P.alT;
  const Ab = [xAb, yAb, zAb], ST = [P.domeW + 2.4, Dm[1] - 2.9, Dm[2] - 2.4], lobLen = v3.dist(Ab, ST);
  const L1 = [xAb + 0.55 * P.alFlare + 0.4, yAb + 1.6, lerp(zAb, ST[2], 0.32)], L2 = [lerp(xAb, ST[0], 0.62) + 0.45 * P.alFlare, lerp(yAb, ST[1], 0.62) + 1.2, lerp(zAb, ST[2], 0.66)];
  const lobSpine = [v3.add(Ab, [0.4, 0.2, -1.2]), Ab, L1, L2, ST], aT = P.alT;
  const lobSec = [{ a: 2.6, b: 0.55 * aT }, { a: 3.4, b: 0.6 * aT }, { a: 3.3, b: 0.55 * aT }, { a: 2.8, b: 0.45 * aT }, { a: 1.9, b: 0.32 * aT }].map(s => ({ ...s, n: 2.2 }));
  const lobL = D.sweep(lobSpine, lobSec, { up: [0, 1, 0.15], sub: 5, label: LBL_FAT, name: 'alar lobule' });
  // ---- 6. the nostril's vestibule (left): between the columella and the lobule, rising along the nostril's axis toward the internal valve
  const colX = 1.35 + T / 2 + (P.env.columella ?? 1.9), lobIn = s => { const q = v3.lerp(Ab, ST, s); return q[0] + (s < 0.62 ? 0.55 * P.alFlare * sstep(0, 0.62, s) : 0.45 * P.alFlare) - 0.5 * aT - 0.35; };
  // the vestibule: along the nostril's long axis (the sill to the apex under the soft triangle), each station a vertical section as wide
  // as the space the columella and the lobule leave (the nostril is that space), rising into the nose; open below the alar rim
  const vS = [0.1, 0.28, 0.46, 0.62, 0.74], vSt = vS.map((s, i) => { const q = v3.lerp(Ab, ST, s), xi = lobIn(s), w = Math.max(0.55, 0.5 * (xi - colX) - 0.3), a = lerp(4.8, 2.4, i / (vS.length - 1)); return { p: [0.5 * (colX + xi), q[1] - 2.2 + 0.75 * a, q[2]], w, a }; });
  const nAxis = v3.norm(v3.sub(vSt[vSt.length - 1].p, vSt[0].p)), nosLen = v3.dist(vSt[0].p, vSt[vSt.length - 1].p) + 2 * 1.2, nosW = Math.max(...vSt.map(s => s.w)), vC0 = vSt[Math.floor(vSt.length / 2)].p;
  const vest = D.sweep(vSt.map(s => s.p), vSt.map((s, i) => ({ a: [s.a, s.a * 0.8], b: s.w, n: 2.1 })), { up: [0, 1, 0.25], sub: 4, name: 'nasal vestibule' });
  // ---- the parts (mirrored) and the fields
  const parts = [septal, ulc, llcL, D.mirrorX(llcL, { label: LBL_CART, name: 'lower lateral cartilage_R' })];
  const lobules = [lobL, D.mirrorX(lobL, { label: LBL_FAT, name: 'alar lobule_R' })], vestibules = [vest, D.mirrorX(vest, { name: 'nasal vestibule_R' })];
  // the INTERDOMAL soft tissue (the interdomal ligament and its fibrofatty pad between the domes, over the anterior septal angle): it fills
  // the notch between the domes under the skin (without it the two domes printed as a ~1.4 mm midline dip: L08 it1's tip section)
  const idl = D.capsule([P.domeW - 0.6, Dm[1] + 0.2, Dm[2] - 0.2], [-(P.domeW - 0.6), Dm[1] + 0.2, Dm[2] - 0.2], 1.3, { label: LBL_FAT, name: 'interdomal ligament and pad' });
  lobules.push(idl);
  const fw = D.scene([], 'nasal framework', { label: LBL_CART }); fw.add(septal); fw.add(ulc, 1.2); fw.add(llcL, 1.0); fw.add(parts[3], 1.0); fw.add(idl, 1.0);
  // the envelope's thickness: Shepard-weighted anchors on the framework (Lessard and Daniel 1985's sites)
  const E = P.env, sm = (a, b) => [0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]), 0.5 * (a[2] + b[2])], ITp = v3.add(sm(Gm, Dm), [0, -1.5, -0.5]);
  const anchors = [[[0, N0[1], N0[2]], E.nasion], [[0, Rhi[1] + 6, lineZ(Rhi[1] + 6)], 0.5 * (E.nasion + E.rhinion)], [Rhi, E.rhinion], [ASA, E.supratip], [Dm, E.tip], [mirror(Dm), E.tip], [ITp, E.infratip], [mirror(ITp), E.infratip],
    [mc(0.5 * P.mcLen, 1.35), E.columella], [mc(0.5 * P.mcLen, -1.35), E.columella], [foot, E.columella + 0.4], [mirror(foot), E.columella + 0.4], [lc1, E.sidewall], [mirror(lc1), E.sidewall],
    [[apW(yScroll + 6) - 1, yScroll + 6, ulF(apW(yScroll + 6) - 1, yScroll + 6)], E.sidewall], [[-(apW(yScroll + 6) - 1), yScroll + 6, ulF(apW(yScroll + 6) - 1, yScroll + 6)], E.sidewall]];
  const envT = (x, y, z) => { let sw = 0, sv = 0; for (const [a, v] of anchors) { const d2 = (x - a[0]) ** 2 + (y - a[1]) ** 2 + (z - a[2]) ** 2, w = 1 / (d2 + 12) ** 1.5; sw += w; sv += w * v; } return sv / sw; };
  const lobD = (x, y, z) => Math.min(lobL.d(x, y, z), lobules[1].d(x, y, z)), vestD = (x, y, z) => Math.min(vest.d(x, y, z), vestibules[1].d(x, y, z));
  // the external nose: the framework + envelope, joined to the lobules (the supra-alar crease: a ~1.6 mm blend where the lobule meets the
  // sidewall), the vestibules carved (0.5 mm round at the nostril margin)
  const nose0 = (x, y, z) => D.smin(fw.d(x, y, z) - envT(x, y, z), lobD(x, y, z) - E.ala, 1.6);
  const skin = (x, y, z) => D.smax(nose0(x, y, z), -vestD(x, y, z), 0.5);
  const box = [-(xAb + aT + 8), yANS - 6, zAb - 10, xAb + aT + 8, keyY + 8, Dm[2] + 12];
  // the nose joined to a face's skin field: the alar-facial groove (the alar base's dermis tethered: a tight 0.9 mm blend within ~4 mm of the
  // lobule's posterior half), the sidewall into the cheek and the columella into the lip wider (3 mm)
  const grooveD = (x, y, z) => { const ax = Math.abs(x), p = [ax, y, z]; let d = Infinity; for (let i = 0; i + 1 < lobSpine.length - 2; i++) { const a = lobSpine[i], b = lobSpine[i + 1], ab = v3.sub(b, a), t = clamp(v3.dot(v3.sub(p, a), ab) / (v3.dot(ab, ab) || 1), 0, 1); d = Math.min(d, v3.dist(p, v3.add(a, v3.mul(ab, t)))); } return d; };
  const join = (face) => { const f = (x, y, z) => { const a = face(x, y, z); if (x < box[0] - 6 || x > box[3] + 6 || y < box[1] - 6 || y > box[4] + 6 || z < box[2] - 8) return a; const k = lerp(0.9, 3.0, sstep(3.5, 9, grooveD(x, y, z))); return D.smin(a, skin(x, y, z), k); }; return f; };
  // ---- landmarks and curves (the anatomy's, read off its own skin by marching)
  const sk = skin, zOn = (x, y, F = sk) => fieldZ(F, x, y, box[5] + 5, box[2]);
  let prn = null; for (let y = Dm[1] - 4; y <= Dm[1] + 5; y += 0.25) { const z = zOn(0, y); if (z != null && (!prn || z > prn[2])) prn = [0, y, z]; }
  let tdp = null; for (let y = Dm[1] - 4; y <= Dm[1] + 5; y += 0.25) { const z = zOn(Dm[0], y); if (z != null && (!tdp || z > tdp[2])) tdp = [Dm[0], y, z]; }
  // the columella's lower edge (the lowest skin point at x = 0 for each z between the footplates and the tip): march up from below
  const below = (x, z, y0, y1) => { let prev = sk(x, y0, z); for (let y = y0 + 0.25; y <= y1; y += 0.25) { const f = sk(x, y, z); if (f < 0 && prev >= 0) return y; prev = f; } return null; };
  const colEdge = []; for (let z = foot[2] - 2; z <= (prn ? prn[2] - 2 : Dm[2]); z += 1) { const y = below(0, z, yANS - 8, Dm[1] + 4); if (y != null) colEdge.push([0, y, z]); }
  // the ALARE: the most lateral point of the ALAR LOBULE's skin (iteration 2: iteration 1 marched the whole nose's skin and found the
  // sidewall's junction with the cheek over the aperture, 8 mm above the lobule on L08: the wrap pulled hm08's alare up onto it)
  const lobSkin = (x, y, z) => lobL.d(x, y, z) - E.ala;
  let alare = null; for (let y = yAb - 3; y <= yAb + 5; y += 0.5) for (let z = zAb - 4; z <= ST[2] + 1; z += 0.5) { let x = xAb + aT + 8; let prev = lobSkin(x, y, z); for (x -= 0.25; x > 4; x -= 0.25) { const f = lobSkin(x, y, z); if (f < 0 && prev >= 0) { if (!alare || x > alare[0]) alare = [x, y, z]; break; } prev = f; } }
  const nostrilRim = []; for (const side of [1, -1]) for (const st of (side > 0 ? vSt : vSt.slice().reverse())) { const x = st.p[0] + side * st.w * 0.95, y = below(x, st.p[2], yANS - 8, yAb + 6); if (y != null) nostrilRim.push([f1(x), f1(y), f1(st.p[2])]); }
  // THE SKIN'S SUBNASALE (NOSE 3): where the columella's underside comes out of the upper lip's skin (Farkas: the point where the septum
  // meets the lip; the profile's deepest point there), forward along the columella's lower edge from the footplates: sn0 is the columella's
  // BASE on the lip (the cartilage's seat, the lip's tissue runs up to it), and the skin's junction lies 2-5 mm under it (the columella's
  // lower half and its envelope). mouth/ counts the lip's rest length from THIS point (NOSE 2 handed it sn0: the skin's lip was short).
  let sn = null; { const ce = colEdge.slice().sort((a, b) => a[2] - b[2]); let prev = null;
    for (const p of ce) { const s = p[2] - lipFront(p[1]); if (s >= 0) { if (prev) { const sp = prev[2] - lipFront(prev[1]), t = sp / (sp - s); sn = [0, lerp(prev[1], p[1], t), lerp(prev[2], p[2], t)]; } else sn = p.slice(); break; } prev = p; } }
  if (!sn || sn[1] > sn0[1] + 1) sn = sn0.slice();
  const lmk = { prn: prn && r1(prn), tdp: tdp && r1(tdp), sn: sn && r1(sn), sn0: r1(sn0), al: alare && r1(alare), ac: r1([acX, yAb, zAb + 0.6 * aT]), domes: r1(Dm), ASA: r1(ASA), keystone: r1(K0), footplate: r1(foot) };
  const curves = { columella: colEdge.map(r1), nostrilRim_L: nostrilRim, alarGroove_L: [v3.add(Ab, [0, 0.2, -1.2]), Ab, L1].map(p => r1([p[0] + 0.5 * aT, p[1], p[2]])), dorsum: [N0, Rhi, ASA].map(r1), tdp: tdp ? [r1(tdp), r1(mirror(tdp))] : [] };
  // ---- the report: the parts' sizes as built and the external nose's measures (descriptions)
  const sdLen = v3.dist(K0, ASA), colLen = colEdge.length > 1 ? v3.dist(colEdge[0], colEdge[colEdge.length - 1]) : null;
  rep.built = { lcEndToAperture: f1(lc2[0] - apW(lc2[1])), lcEnd: r1(lc2), septDorsalLen: f1(sdLen), supratipBreak: f1(domeTop - ASA[2]), dorsalBend: f1(dorsalBend), boneLineAtDomes: f1(domeTop - lineZ(Dm[1])), snDepth: f1(snDepth), colLen: colLen && f1(colLen), cb: r1(CB),
    alW: alare ? f1(2 * alare[0]) : null, acW: f1(2 * acX), apertureW: f1(2 * apW(yANS + 0.3 * Hap)), tipProjSn0: prn ? f1(prn[2] - sn0[2]) : null, tipProjSn: prn ? f1(prn[2] - sn[2]) : null, nH: sn ? f1(N0[1] - sn[1]) : null,
    snBelowANS: f1(yANS - sn[1]), snSkinDrop: f1(sn0[1] - sn[1]), hullFillAtSn0: f1(zPmx - zBone0),
    nostrilLen: f1(nosLen), nostrilW: f1(2 * nosW), zFace: zFace == null ? null : f1(zFace), zBone: zBone == null ? null : f1(zBone) };
  rep.ms = Date.now() - t0;
  const mats = { 'septal cartilage': NOSE_TISSUE.septal, 'upper lateral cartilage': NOSE_TISSUE.ulc, 'lower lateral cartilage': NOSE_TISSUE.llc, 'lower lateral cartilage_R': NOSE_TISSUE.llc, 'alar lobule': NOSE_TISSUE.alar, 'alar lobule_R': NOSE_TISSUE.alar, 'interdomal ligament and pad': NOSE_TISSUE.alar };
  // the drop-in for head/index.js buildNose (ANAT8-HEAD's cart scene unions `parts`; ASA and dome as its returns)
  return { parts, lobules, vestibules, framework: fw, envT, skin, nose0, join, box, lm: lmk, curves, params: P, mats, ASA, dome: Dm, report: rep, version: NOSE_VERSION, paramsVersion: NOSE_PARAMS_VERSION };
}
