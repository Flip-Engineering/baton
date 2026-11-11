// ANATOMY / FAT / BREAST + NIPPLE-AREOLA COMPLEX (ANAT8-BODY, 8 Oct 2026, iteration 4; NOTES.md D4, first part): the women's breast as a GLAND-AND-FAT
// VOLUME on the pectoral fascia, and the nipple-areola complex (NAC) PLACED BY THE ANATOMY BUILT UNDER IT, for both sexes; never at fixed mesh vertices.
// Metres, the person's bind space (x lateral, L = +x; y up; z forward), the same SDF part contract as the skeleton and the muscles (skeleton/sdf.js:
// a breast is a FIELD part, kind 'fat', meshable by meshPart and composable by sdParts). Opt-in: nothing imports this but the ANAT8-BODY lab and tests.
//
//   import { buildBreasts } from '.../lib/fx/anatomy/fat/breast.js';
//   const F = buildBreasts(B, K, M)     B = bodyOf(...), K = buildSkeleton(B), M = buildMuscles(B, K, { rec })
//   F = { version, parts: [breast.L, breast.R] (women; [] for men), nac: { L, R }, info }
//   nac[S] = { skin [x,y,z] (the NAC on the anatomical skin: the apex + the subcutaneous fat), deep (the apex of the gland-and-fat volume, or the
//              point on the pectoralis), dir (the nipple's axis), r (areola radius, m), v6 (v6's skin along the same ray), source, check {...} }
//
// THE ANATOMY (each rule with its reason; the numbers are the literature as I recall it, ranges to CHECK, marked 'recalled'):
// WOMEN. The breast lies on the pectoralis major's fascia (2/3) and the serratus' (1/3) with the retromammary fat between; its BASE spans the 2nd to the
//   6th rib vertically on the midclavicular line and the sternal edge to near the midaxillary line horizontally (the textbook footprint); the
//   INFRAMAMMARY FOLD is the base's lower arc over the 6th rib, rising medially and laterally. Here the base is an ellipse in the breast's own oblique
//   frame (E1 lateral, E2 up, D = forward turned 12 deg outward): from the 2nd rib's front on the person's midclavicular line to the 6th's, from the
//   sternal edge + 1 cm (on the fascia) to the midaxillary line (the cage's ribs 4-6 + 1.5 cm); the breast is a height field along D over it. The VOLUME is the person's (D6: the anatomy places, the measures size): v6's own tissue over that base, less the chest's
//   ordinary subcutaneous layer, clamped 120-1400 cm3; it is redistributed into the breast's form: an apex (the nipple) on the meridian 0.5 cm lateral
//   of the midclavicular line, 42 % of the base's height above the fold less the ptosis (age, volume); the UPPER POLE a straight-to-slightly-concave
//   slope from the 2nd rib to the nipple, the LOWER POLE convex and steep at the fold (the fold is where the convex lower pole meets the chest wall),
//   the lateral and medial edges convex. The NAC is the apex; its axis the outer surface's normal there.
//   NOT YET: the lower pole overhanging the fold (Regnault grade II-III ptosis), the axillary tail, Cooper's ligaments' tethering, cleavage by posture.
// MEN. The NAC sits on the pectoralis major's lower-lateral part, ~2.5 cm above its inferior border on the midclavicular line (recalled from the
//   male-chest literature: 2-3 cm), over the 4th-5th intercostal space; it is found on the person's own built pectoralis (muscle/trunk.js), carried
//   along the chest wall's outward normal there (forward, 20 deg outward; the drape axis' radial, ~65 deg there, threw it 2 cm lateral) to v6's skin.
// THE CHECKS (reported, not fitted): ANSUR II chest height under the person's sternal notch and the bust-point / nipple breadth as BODY7's nipple.js
//   rule reads them (men 0.0817 H below, 0.0575 H from the midline; women 0.0952 H below, 0.056 H), hm08's fixed nipple vertex, sternal-notch-to-
//   nipple 18-22 cm (young women, more with ptosis; recalled), nipple-to-midline 9-11 cm, nipple-to-fold 5-8 cm along the lower pole (recalled).
import { dropOn, layerOf, nrm, clamp, ss, len, sub } from '../muscle/core.js';
import { rayToSkin, midline } from '../skeleton/body.js';
import { sdParts } from '../skeleton/sdf.js';
import { chestLevels } from '../skeleton/chest.js';
import { FATREF } from '../muscle/index.js';
export const BREAST_VERSION = 2;   // the one current version (lane iteration 10 deleted v1 and the cancelled v3; git history keeps them). The WOMEN'S
// breast FORM is now the soft-tissue solver's (soft/breast.js); this module keeps the static gland-and-fat field (the sections' and cutaways' layer), the
// men's NAC on the built pectoralis, and the helpers soft/ shares (trunkAxis, ribAt, blur2).
const CM = 0.01;
export const NAC_REF = { m: { aboveBorder: 2.5, carryDeg: 20, r: 0.0135, ansurBelow: 0.0817, ansurHalf: 0.0575 }, f: { r: 0.019, ansurBelow: 0.0952, ansurHalf: 0.056, apexUp: 0.42, latDeg: 3, yawDeg: 12, latCm: 0.5 } };

// the trunk's axis in the thorax (the drape rays of muscle/trunk.js start on it): x = 0, z = the vertebral bodies' line + 6.5 cm (x stature scale);
// .lev = the vertebral bodies' line itself (where the men's pectoral scan and the women's fascia lines start; a radial frame from either axis did not
// suit the breast: from the drape axis the base fell within 60-95 deg, from the vertebral line the apex went 4-5 cm lateral: see the oblique frame below)
function trunkAxis(K, sT) {
  const LV = Object.values(K.geo.lev).map(c => ({ y: c[1], z: c[2] })).sort((a, b) => a.y - b.y);
  const zLev = y => { if (y <= LV[0].y) return LV[0].z; if (y >= LV[LV.length - 1].y) return LV[LV.length - 1].z; let i = 1; while (LV[i].y < y) i++; const t = (y - LV[i - 1].y) / (LV[i].y - LV[i - 1].y); return LV[i - 1].z + t * (LV[i].z - LV[i - 1].z); };
  const zAx = y => zLev(y) + 6.5 * CM * sT; zAx.lev = zLev; return zAx;
}
// a rib's height (and depth) where its FRONT half crosses |x| = xm (bony rib + cartilage; the posterior half also crosses that x, higher up)
function ribAt(K, k, S_, xm) {
  const R = K.geo.ribs['rib' + k + S_], zMin = K.pts.xiphisternal[2] - 0.07, pts = R.path.concat(R.cart).filter(p => p[2] > zMin);
  let best = null; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], xa = Math.abs(a[0]), xb = Math.abs(b[0]);
    if ((xa - xm) * (xb - xm) <= 0 && xa !== xb) { const t = (xm - xa) / (xb - xa), p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]; if (!best || p[2] > best[2]) best = p; } }
  if (best) return best; let q = pts[0]; for (const p of pts) if (Math.abs(Math.abs(p[0]) - xm) < Math.abs(Math.abs(q[0]) - xm)) q = p; return q;
}
const r1 = v => +(v * 100).toFixed(1);
const r1v = p => p && p.map(r1);

export function buildBreasts(B, K, M, opts = {}) { return breastsV2(B, K, M, opts); }
// ================================================================================================================================================
// BREAST v2 + NAC v2 (ANAT8-BODY, lane iteration 6, 8 Oct; NOTES.md iteration 6). The measurer's c2 it1 verdict: the anatomical NAC sat 2.1-2.5 cm (men)
// and 3.0-4.3 cm (women) above ANSUR II's chest height, further from it than hm08's old vertex; the women's nipple axis yawed 39-68 deg out. Causes: the
// men's NAC hung 2.5 cm above a pectoral border that crossed the midclavicular line 3 cm high (fixed in muscles v2, trunk.js); the women's breast had its
// fold on the 6th rib's CENTRELINE, its apex 42 % of the base above it, no gravity, and its axis the local surface normal of tissue laid on a receding wall.
// v2 places by sourced anatomy and sizes by the person's own record:
// MEN: the NAC on the 4th intercostal space's LOWER EDGE (the 5th rib's upper edge) on the midclavicular line (the nipple over ICS4 in 41 / 50 young men and
//   the 5th space or rib in 9 / 50: the Korean NAC study; ANSUR II's chest height falls on rib 5's upper edge in v3's cage: chest_test M1b), on the built
//   pectoralis; carried 20 deg outward to v6's skin as v1. CHECK: 1.0-3.5 cm above the pectoral's lower border on the line (one photographed lean man: 1-3 cm).
// WOMEN: (1) the FOLD (the base's lower edge on the MCL) at the sourced inframammary level (skeleton/chest.js chestLevels().fold: Wang 2023 MRI n 120 and
//   Oh 2020 CT n 80; Azadgoli 2023: the 5th space); the base's top at the 2nd rib, medial at 1.8 cm from the midline (the parasternal line: the sternal
//   edge, so the intermammary gap is the sternum's width, not 5 cm), lateral at the midaxillary line (v1). (2) The VOLUME is the person's own sampled breast
//   (rec.targets.breast.volumeMl: sampler.js breastModel, Coltman et al. 2017's 3D-scan volumes by BMI, bust z and age: the mound over the chest wall's
//   own surface, which is what this part is; the ordinary subcutaneous layer and the skin go on top of everything); v6's own tissue over the base is
//   reported (Vv6) as the check, no longer the input (CHECK.md finding 6). (3) The FORM: a DOME over the base whose summit along the breast's axis is the
//   nipple (the outer surface interpolated from the base's edge to the summit by v1's profiles: the upper pole straight to slightly concave, the lower
//   pole convex and steep at the fold; the summit 0.5 cm medial of the MCL, on the 4th intercostal space or 40 % of the base above the fold, the lower),
//   so the axis is the breast's own (yaw 12 deg out + 20 x the record's splay, clamped 6-22; pitch down 2 + 6 x ptosis deg, at most 20) and no longer
//   the receding wall's normal; the summit is rounded over ~30 % of its radius (first v2 build: 10 % as v1, a cone tip whose areola faced 5-16 deg UP
//   at every ptosis; 30 %: +8 deg at grade 0, ~0 at I-II: still too little DOWN for a ptotic breast (9 x ptosis, 30 deg max, moved L06 only -1 to -2 deg):
//   the nipple should sit BELOW the summit on the lower pole there: next). (4) GRAVITY: the tissue is SHEARED downward in proportion to its distance from the chest wall (b -= k w'; volume-
//   preserving), with k chosen so the nipple lands at the person's ptosis level against the fold (Regnault's grades on the record's continuous ptosis p
//   (sampler.js: age, volume, parity): 1 cm above the fold at p = 0, at the fold at p = 1 (grade I), 2 cm below at p = 2 (II), 4 cm below at 3 (III), x
//   the stature scale), k at most 1.5 (a small firm breast cannot lean far: its nipple stays higher, reported); the lower pole then hangs over the fold
//   and meets the chest wall in a crease (the field is clipped by the wall). Not yet: the axillary tail, Cooper's tethering, the lateral fall.
// CHECKS (reported; fat_test.mjs asserts them): ANSUR II's chest height (the sourced ratios 0.0840 / 0.0971 S; women's ANSUR is a SUPPORTED bust point (the
//   survey's women wore a sports bra, as I recall the protocol: to check), so a nude ptotic breast's nipple may sit below it, never far above it).
export const NAC_REF2 = { m: { r: 0.0135, carryDeg: 20, ansur: 0.0840 }, f: { r: 0.019, ansur: 0.0971, apexUp: 0.40, latCm: -0.5, medCm: 1.8, yaw0: 12, yawSplay: 20, yawMin: 6, yawMax: 22, pitch0: 2, pitchP: 6, pitchMax: 20 } };
export const ptosisLevelCm = p => p <= 1 ? 1.0 * (1 - p) : -2.0 * (p - 1);   // the nipple above (+) / below (-) the fold, cm at the reference stature
function breastsV2(B, K, M, opts = {}) {
  const sexF = B.sex === 'f', H = B.stature, sT = H / (sexF ? 1.625 : 1.755), P = K.pts, zAx = trunkAxis(K, sT), t0 = Date.now(), rec = opts.rec || {};
  const U = layerOf(K.parts.concat(M.parts), 0.12), sup = B.lm.suprasternale || P.jugular;
  const pf = B.pf ?? (sexF ? 0.28 : 0.18), fk = Math.pow(pf / (sexF ? 0.28 : 0.18), 1.2), tSC = (FATREF.chest[sexF ? 'f' : 'm'] * fk + 1.5) / 1000;
  const parts = [], nac = {}, info = { version: 2, tSCmm: +(tSC * 1000).toFixed(1), sides: {} }, ref1 = NAC_REF[sexF ? 'f' : 'm'], ref = NAC_REF2[sexF ? 'f' : 'm'];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const CL = chestLevels(K, S_), xm = CL.xm, lmN = B.lm['nipple' + S_], ansurY = sup[1] - ref.ansur * H;
    const common = y => ({ belowNotchS: +((sup[1] - y) / H).toFixed(4), ansurBelowS: ref.ansur, dyAnsurCm: r1(y - ansurY), dyRuleCm: r1(y - (sup[1] - ref1.ansurBelow * H)), mclCm: r1(xm),
      hm08: r1v(lmN), dyHm08Cm: lmN ? r1(y - lmN[1]) : null, rib5hiCm: r1(CL.hi(5)), rib5loCm: r1(CL.lo(5)), foldCm: r1(CL.fold) });
    if (!sexF) {
      // ---------------------------------------------------------------- MEN: the 4th space's lower edge on the MCL, on the built pectoralis
      const pec = M.parts.filter(q => /^pectoralis/.test(q.name) && q.name.endsWith('.' + S_)), x = s * xm;
      const zRange = y => { let zin = null, zout = null; for (let z = zAx.lev(y); z < zAx.lev(y) + 0.25; z += 0.002) { if (sdParts(pec, x, y, z, 0.02).d < 0) { if (zin == null) zin = z; zout = z; } } return zin == null || zout - zin < 0.004 ? null : [zin, zout]; };
      let yB = null; for (let y = P.sternalAngle[1]; y > P.xiphoidTip[1] - 0.08; y -= 0.002) { if (zRange(y)) yB = y; else if (yB != null && yB - y > 0.006) break; }
      const r5 = CL.hi(5), yN = r5 === r5 ? r5 : sup[1] - ref.ansur * H, zr = zRange(yN);
      let deep = zr ? [x, yN, zr[1] + 0.002] : null, src = deep ? 'pectoralis' : 'chest wall';
      if (!deep) { const zc = zAx(yN); let z = zc + 0.22; while (z > zc && U.d(x, yN, z) > 0.001) z -= 0.002; deep = [x, yN, z]; }
      const n = [s * Math.sin(ref.carryDeg * Math.PI / 180), 0, Math.cos(ref.carryDeg * Math.PI / 180)], d = rayToSkin(B, deep, n), skin = d < 0.15 ? [deep[0] + n[0] * d, deep[1], deep[2] + n[2] * d] : null;
      nac[S_] = { skin: skin || deep, deep, dir: n, r: ref.r, v6: skin, source: src, level: r5 === r5 ? 'ICS4 lower edge (rib 5 upper edge)' : 'ANSUR (rib 5 not on the line)', border: yB,
        check: { ...common(yN), halfCm: r1(Math.abs((skin || deep)[0])), ruleHalfCm: r1(ref1.ansurHalf * H), dxHm08Cm: lmN ? r1(Math.abs((skin || deep)[0]) - Math.abs(lmN[0])) : null,
          snNcm: skin ? r1(len(sub(skin, sup))) : null, pecBorderYcm: yB != null ? r1(yB) : null, aboveBorderCm: yB != null ? r1(yN - yB) : null, pecToSkinMm: skin ? +(d * 1000).toFixed(1) : null } };
      continue;
    }
    // ---------------------------------------------------------------- WOMEN
    const tb = rec.targets?.breast || rec.prior?.targets?.breast || null, age = B.age ?? 35;
    const splay = tb?.splay ?? 0.08, yawD = clamp(ref.yaw0 + ref.yawSplay * splay, ref.yawMin, ref.yawMax);
    // the frame: D the breast's axis (out by yaw, down by pitch), E1 lateral (horizontal), E2 = D x E1 (up, tilted forward with the pitch)
    const r2pt = ribAt(K, 2, S_, xm), yC = (r2pt[1] + CL.fold) / 2;
    const onFascia = (x, y) => { let z = (midline(B, y).front || 0.15) + 0.03; for (let i = 0; i < 200 && U.d(x, y, z) > 0.0008; i++) z -= Math.max(0.0005, 0.7 * (U.d(x, y, z) - 0.0008)); return [x, y, z]; };
    const pRec = tb?.ptosis, O = onFascia(s * xm, yC);
    const build = (p) => {
      const pitchD = clamp(ref.pitch0 + ref.pitchP * p, 0, ref.pitchMax), yaw = yawD * Math.PI / 180, pit = pitchD * Math.PI / 180;
      const D = [s * Math.sin(yaw) * Math.cos(pit), -Math.sin(pit), Math.cos(yaw) * Math.cos(pit)], E1 = [s * Math.cos(yaw), 0, -Math.sin(yaw)];
      let E2 = nrm([D[1] * E1[2] - D[2] * E1[1], D[2] * E1[0] - D[0] * E1[2], D[0] * E1[1] - D[1] * E1[0]]); if (E2[1] < 0) E2 = E2.map(c => -c);
      return { pitchD, D, E1, E2 };
    };
    // the ptosis: the record's (sampler.js breastModel); without one, the sampler's own rule on age and v6's volume (its random parts at 0), set below
    let p = pRec ?? null, F0 = build(p ?? 0.5);
    const frame = F => {
      const { D, E1, E2 } = F, ab = q => { const d = sub(q, O); return [dot3(d, E1), dot3(d, E2)]; }, W = q => dot3(sub(q, O), D), pt3 = (a, b, w) => [O[0] + E1[0] * a + E2[0] * b + D[0] * w, O[1] + E1[1] * a + E2[1] * b + D[1] * w, O[2] + E1[2] * a + E2[2] * b + D[2] * w];
      return { ...F, ab, W, pt3 };
    };
    let Fm = frame(F0);
    const fasciaOn = (Fm, g, skinToo = true) => { const C0 = [0, g[1], zAx.lev(g[1]) + 0.04], t0 = dot3(sub(C0, g), Fm.D), A = [g[0] + Fm.D[0] * t0, g[1] + Fm.D[1] * t0, g[2] + Fm.D[2] * t0], ts = skinToo ? rayToSkin(B, A, Fm.D) : Infinity;
      const tf = dropOn(U, A, Fm.D, 0.0008, { from: (ts < 0.4 ? ts : 0.25) + 0.005 }); return { tf: tf == null ? NaN : t0 + tf, ts: ts < 0.4 ? t0 + ts : NaN }; };
    // the base (in the frame): top at the 2nd rib, the fold at the sourced level, medial at the parasternal line, lateral at the midaxillary line
    const latR = [4, 5, 6].map(k => K.geo.ribs['rib' + k + S_].lat), xLat = Math.max(...latR.map(q => Math.abs(q[0]))) + 1.5 * CM * sT, pLat = [s * xLat, yC, latR.reduce((a, q) => a + q[2], 0) / 3];
    const pMed = onFascia(s * ref.medCm * CM * sT, yC), pTop = onFascia(s * xm, r2pt[1]), pFold = onFascia(s * xm, CL.fold);
    const grid = Fm => {
      const aMed = Fm.ab(pMed)[0], aLat = Fm.ab(pLat)[0], bTop = Fm.ab(pTop)[1], bImf = Fm.ab(pFold)[1];
      const aC = (aMed + aLat) / 2, ha = (aLat - aMed) / 2, bC = (bTop + bImf) / 2, hb = (bTop - bImf) / 2;
      const da = 0.005, a0 = aMed - 0.02, a1 = aLat + 0.02, b0 = bImf - 0.10, b1 = bTop + 0.02, na = Math.ceil((a1 - a0) / da) + 1, nbb = Math.ceil((b1 - b0) / da) + 1;
      const HF = new Float32Array(na * nbb).fill(NaN), HS = new Float32Array(na * nbb).fill(NaN), ell = (a, b) => Math.hypot((a - aC) / ha, (b - bC) / hb);
      for (let j = 0; j < nbb; j++) for (let i = 0; i < na; i++) { const a = a0 + i * da, b = b0 + j * da, inB = ell(a, b) <= 1.1, q = fasciaOn(Fm, Fm.pt3(a, b, 0), inB); HF[i + na * j] = q.tf; if (inB) HS[i + na * j] = q.ts; }
      for (let j = 0; j < nbb; j++) for (let i = 0; i < na; i++) if (!(HF[i + na * j] === HF[i + na * j])) { let v = NaN; for (let q = 1; q < na && v !== v; q++) { const l = HF[Math.max(0, i - q) + na * j], r = HF[Math.min(na - 1, i + q) + na * j]; v = l === l ? l : r; } HF[i + na * j] = v === v ? v : 0; }
      const bil = (G, a, b) => { const fi = clamp((a - a0) / da, 0, na - 1.001), fj = clamp((b - b0) / da, 0, nbb - 1.001), i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
        return (G[i + na * j] * (1 - u) + G[i + 1 + na * j] * u) * (1 - v) + (G[i + na * (j + 1)] * (1 - u) + G[i + 1 + na * (j + 1)] * u) * v; };
      return { aMed, aLat, bTop, bImf, aC, ha, bC, hb, da, a0, b0, na, nbb, HF, HS, ell, bil, hF: (a, b) => bil(HF, a, b) };
    };
    let G = grid(Fm);
    // v6's tissue over the base beyond the ordinary subcutaneous layer (along D) and the base's area
    const v6vol = G => { let V = 0, A = 0; for (let j = 0; j < G.nbb; j++) for (let i = 0; i < G.na; i++) { const a = G.a0 + i * G.da, b = G.b0 + j * G.da; if (G.ell(a, b) > 1) continue; A += G.da * G.da; const hs = G.HS[i + G.na * j]; if (hs === hs) V += Math.max(0, hs - G.HF[i + G.na * j] - tSC) * G.da * G.da; } return { V, A }; };
    let { V: Vv6, A: Abase } = v6vol(G);
    if (p == null) { p = clamp(0.3 + 0.042 * (age - 25) + 1.05 * Math.log(Math.max(60, Vv6 * 1e6 + Abase * 1e4 * tSC * 100) / 380), 0, 3); const F1 = build(p); if (Math.abs(F1.pitchD - F0.pitchD) > 0.5) { Fm = frame(F1); G = grid(Fm); ({ V: Vv6, A: Abase } = v6vol(G)); } }
    else if (Math.abs(build(p).pitchD - F0.pitchD) > 0.5) { Fm = frame(build(p)); G = grid(Fm); ({ V: Vv6, A: Abase } = v6vol(G)); }
    const { aC, ha, bC, hb, aMed, aLat, bTop, bImf, ell, hF, bil } = G, { ab, W, pt3, D } = Fm;
    // the volume: the record's breast as it is (Coltman et al. 2017 measured 3D scans: the mound over the chest wall's surface interpolated under it, i.e.
    // over the chest's ordinary subcutaneous layer, which is what this part is: the skin and that layer go on top of it everywhere)
    const Vlit = tb?.volumeMl ? tb.volumeMl * 1e-6 : null, V = clamp(Vlit != null ? Vlit : Vv6, 100e-6, 1400e-6);
    // the dome: the summit (the nipple's base point before the sag) on the meridian 0.5 cm MEDIAL of the MCL (the axis' yaw carries the nipple ~1-1.5 cm out:
    // the nipple 'slightly lateral of the midclavicular line'), 40 % of the base's height above the fold or the 4th
    // intercostal space (the textbook nipple level of the youthful breast, supine), the lower
    const aN = ref.latCm * CM, pI4 = onFascia(s * xm, CL.ics(4)), bI4 = CL.ics(4) === CL.ics(4) ? ab(pI4)[1] : Infinity, bN0 = Math.min(bImf + ref.apexUp * (bTop - bImf), bI4), u0 = (aN - aC) / ha, v0 = (bN0 - bC) / hb, eps = 0.3, ptN = clamp(p / 3, 0, 1), pLo = 2.2 - 0.8 * ptN, qLo = 0.55 - 0.15 * ptN;
    const geo = (a, b) => { const u = (a - aN) / ha, v = (b - bN0) / hb, l = Math.hypot(u, v); if (l < 1e-9) return { rho: 0, dv: 0, ae: aN, be: bN0, on: true };
      const du = u / l, dv = v / l, bq = u0 * du + v0 * dv, cq = u0 * u0 + v0 * v0 - 1, tE = -bq + Math.sqrt(Math.max(0, bq * bq - cq)); return { rho: l / tE, dv, ae: aN + tE * du * ha, be: bN0 + tE * dv * hb, on: l < tE }; };
    const prof = (rho, dv) => { const rr = Math.sqrt(rho * rho + eps * eps) - eps, rn = rr / (Math.sqrt(1 + eps * eps) - eps), up = Math.pow(Math.max(0, 1 - rn), 1.15), lo = Math.pow(Math.max(0, 1 - Math.pow(rn, pLo)), qLo), w = ss((dv + 0.25) / 0.75); return Math.max(0, w * up + (1 - w) * lo); };
    const domeT = (a, b, Wap) => { const g = geo(a, b); if (!g.on) return 0; const hfe = hF(g.ae, g.be), pr = prof(g.rho, g.dv); return Math.max(0, hfe + (Wap - hfe) * pr - hF(a, b)); };
    const volOf = Wap => { let Vs = 0; for (let j = 0; j < G.nbb; j++) for (let i = 0; i < G.na; i++) Vs += domeT(G.a0 + i * G.da, G.b0 + j * G.da, Wap) * G.da * G.da; return Vs; };
    let lo = hF(aN, bN0), hi = lo + 0.25; for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (volOf(m) < V) lo = m; else hi = m; }
    const Wap = (lo + hi) / 2, T = (a, b) => domeT(a, b, Wap), Tap = T(aN, bN0);
    // the sag: shear b -= k w' (w' the tissue's distance out from the wall) so the nipple (on the skin) lands at the ptosis level against the fold
    const dyCm = ptosisLevelCm(p) * sT, yTarget = CL.fold + dyCm * CM, apex0 = pt3(aN, bN0, hF(aN, bN0) + Tap), skin0 = [apex0[0] + D[0] * tSC, apex0[1] + D[1] * tSC, apex0[2] + D[2] * tSC];
    const kRaw = (skin0[1] - yTarget) / (Fm.E2[1] * Tap), k = clamp(kRaw, 0, 1.5);   // at most ~56 deg of lean: a small firm breast cannot reach a low target (its nipple stays higher: reported)
    const unshear = (a, b, w) => { let b0 = b; for (let it = 0; it < 4; it++) b0 = b + k * Math.max(0, w - hF(a, b0)); return b0; };
    const fieldAt = (x, y, z) => { const q = [x, y, z], [a, b] = ab(q), w = W(q), b0 = unshear(a, b, w), hf = hF(a, b0), t = T(a, b0), e = 0.002;
      const ga = (T(a + e, b0) - T(a - e, b0) + hF(a + e, b0) - hF(a - e, b0)) / (2 * e), gb = (T(a, b0 + e) - T(a, b0 - e) + hF(a, b0 + e) - hF(a, b0 - e)) / (2 * e), slope = Math.sqrt(1 + ga * ga + gb * gb) * (1 + 0.5 * k);
      return Math.max((w - (hf + t)) / slope, hf - w, (ell(a, b0) - 1) * Math.min(ha, hb), hF(a, b) - w - 0.0005); };
    const sheared = (a, b0, w) => pt3(a, b0 - k * Math.max(0, w - hF(a, b0)), w), outer = (a, b0) => sheared(a, b0, hF(a, b0) + T(a, b0));
    const bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; for (let j = 0; j < G.nbb; j += 2) for (let i = 0; i < G.na; i += 2) { const a = G.a0 + i * G.da, b = G.b0 + j * G.da; if (ell(a, b) > 1.05) continue;
      for (const q of [sheared(a, b, hF(a, b) - 0.004), outer(a, b)].map((q, m) => m ? [q[0] + D[0] * 0.004, q[1] + D[1] * 0.004, q[2] + D[2] * 0.004] : q)) for (let c = 0; c < 3; c++) { bb[c] = Math.min(bb[c], q[c] - 0.004); bb[c + 3] = Math.max(bb[c + 3], q[c] + 0.004); } }
    parts.push({ name: 'breast.' + S_, group: 'breast', kind: 'fat', prims: [], k: 0, bb, fn: fieldAt, meta: { Vcm3: +(V * 1e6).toFixed(0), version: 2 } });
    // the NAC: the summit after the sag, its axis the breast's (D: the dome's summit is level along D, and the shear keeps the tangent plane there)
    const apex = outer(aN, bN0), skin = [apex[0] + D[0] * tSC, apex[1] + D[1] * tSC, apex[2] + D[2] * tSC], [aA, bA] = ab(apex), hsN = bil(G.HS, aA, bA), v6 = hsN === hsN ? pt3(aA, bA, hsN) : null;
    // the lower pole along the nipple's meridian: the arc to the fold, its lowest point (the overhang below the fold), checked on the sheared surface
    let arc = 0, prev = apex, lowY = apex[1]; for (let b = bN0 - 0.002; b > bImf - 0.002; b -= 0.002) { const tq = T(aN, b), q = outer(aN, b); lowY = Math.min(lowY, q[1]); if (tq <= 1e-4) { arc += len(sub(q, prev)); break; } arc += len(sub(q, prev)); prev = q; }
    const aSt = aMed + 0.01, hsC = bil(G.HS, aSt, bN0), hfC = hF(aSt, bN0), bUp = bTop - 0.25 * (bTop - bN0), hsUp = bil(G.HS, aN, bUp);
    // the surface's own orientation at the areola's scale (+-1.5 cm about the summit in the base's parameters, on the SHEARED surface): a measure, not the
    // construction's axis
    const e3 = 0.015, sa = sub(outer(aN + e3, bN0), outer(aN - e3, bN0)), sb = sub(outer(aN, bN0 + e3), outer(aN, bN0 - e3));
    let ns = nrm([sa[1] * sb[2] - sa[2] * sb[1], sa[2] * sb[0] - sa[0] * sb[2], sa[0] * sb[1] - sa[1] * sb[0]]); if (dot3(ns, D) < 0) ns = ns.map(c => -c);
    nac[S_] = { skin, deep: apex, dir: D.slice(), r: ref.r, v6, source: 'breast v2 summit',
      check: { ...common(skin[1]), halfCm: r1(Math.abs(skin[0])), ruleHalfCm: r1(ref1.ansurHalf * H), dxHm08Cm: lmN ? r1(Math.abs(skin[0]) - Math.abs(lmN[0])) : null,
        snNcm: r1(len(sub(skin, sup))), nImfArcCm: r1(arc), nAboveFoldCm: r1(skin[1] - CL.fold), overhangCm: r1(CL.fold - lowY), ptosis: +p.toFixed(2), ptosisSrc: pRec != null ? 'record' : 'rule',
        pitchDeg: +(Math.asin(clamp(D[1], -1, 1)) * 180 / Math.PI).toFixed(1), yawOutDeg: +(Math.atan2(s * D[0], D[2]) * 180 / Math.PI).toFixed(1), shearK: +k.toFixed(2), shearKraw: +kRaw.toFixed(2), surfPitchDeg: +(Math.asin(clamp(ns[1], -1, 1)) * 180 / Math.PI).toFixed(1), surfYawDeg: +(Math.atan2(s * ns[0], ns[2]) * 180 / Math.PI).toFixed(1),
        v6MinusAnatMm: hsN === hsN ? +((hsN - W(apex) - tSC) * 1000).toFixed(1) : null,
        cleavageV6Mm: hsC === hsC ? +((hsC - hfC - tSC) * 1000).toFixed(1) : null, upperPoleV6MinusAnatMm: hsUp === hsUp ? +((hsUp - hF(aN, bUp) - T(aN, bUp) - tSC) * 1000).toFixed(1) : null } };
    info.sides[S_] = { Vcm3: +(V * 1e6).toFixed(0), VlitCm3: Vlit != null ? +(Vlit * 1e6).toFixed(0) : null, Vv6cm3: +(Vv6 * 1e6).toFixed(0), baseAreaCm2: +(Abase * 1e4).toFixed(0), TmaxCm: r1(Tap), ptosis: +p.toFixed(2),
      base: { rib2Ycm: r1(r2pt[1]), foldYcm: r1(CL.fold), heightCm: r1(bTop - bImf), widthCm: r1(aLat - aMed), medXcm: r1(Math.abs(pMed[0])), latXcm: r1(xLat), yawDeg: +yawD.toFixed(1), pitchDeg: +Fm.pitchD.toFixed(1) } };
  }
  info.ms = Date.now() - t0;
  return { version: 2, parts, nac, info };
}

function blur2(G, na, nb, sig) {   // separable Gaussian (sig in cells), edges clamped
  const R = Math.ceil(3 * sig), w = []; let sw = 0; for (let k = -R; k <= R; k++) { const v = Math.exp(-0.5 * k * k / (sig * sig)); w.push(v); sw += v; }
  const A = new Float32Array(na * nb), Bo = new Float32Array(na * nb);
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) { let v = 0; for (let k = -R; k <= R; k++) v += w[k + R] * G[clamp(i + k, 0, na - 1) + na * j]; A[i + na * j] = v / sw; }
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) { let v = 0; for (let k = -R; k <= R; k++) v += w[k + R] * A[i + na * clamp(j + k, 0, nb - 1)]; Bo[i + na * j] = v / sw; }
  return Bo;
}

// shared with soft/breast.js (lane iteration 8; additive: nothing above changes)
export { trunkAxis, ribAt, blur2 };
