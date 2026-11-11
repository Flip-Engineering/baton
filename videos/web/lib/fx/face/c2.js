// FACE c2 (HUMAN c8, 3 Oct): the second face pass. Everything here is opt-in through makeFace(F, src, { rev: 2, ... }); rev 1 (P2)
// rebuilds byte-identically. What c2 adds, and why (the client: faces "puffy", "glum", "waxy", "lumpy and unrealistic"):
//  1. STRUCTURE. P2's warp narrowed the face at the cheekbones (ANSUR zy-zy) but its 'gonion' was lane A's vertex behind the ear and
//     its mid-masseter site sat on the wrong side, so the jaw never followed: the lower face stayed ~0.85 of the cheekbone width where
//     real faces taper to ~0.70-0.78 (Farkas 2005). That box under narrowed cheekbones is the 'puffy' read. c2 finds the soft-tissue
//     gonion on each person's own jaw contour and places the bigonial breadth from the cited go-go / zy-zy ratio by sex and group.
//  2. SOFT TISSUE from a cited CT table (Sultanova et al. 2026, PLoS ONE, 300 adults, by sex, BMI < 25 / >= 25 and age group; checked
//     against Moritsugui et al. 2022, Brazil) at the corrected sites, with a narrower field so the sites' contrasts survive.
//  3. LIPS placed from measured vermilion heights and lip protrusion (E-line) by sex, age and group, in place of MakeHuman's tall,
//     forward upper lip; lane B's painted vermilion fitted to the same numbers (fitLipMask).
//  4. A RESTING EXPRESSION: the mouth corners brought level (or a little above, for the 'pleasant' looks) with hero.js's own
//     zygomaticus morph (mouth-corner-puller) at a small weight solved from the corner's height, baked into the face; never a grin.
//  5. LOOKS as grounded controls (averageness, symmetry, moderate dimorphism, facial adiposity, skin evenness and health, clear sclera).
// Numbers: every table value below carries its source; OUR marks a choice or an estimate made here.
import { clamp, rng, gauss, groupMix, baseMix } from './sample.js';
import { faceFrame } from './forms.js';

// ---------------------------------------------------------------- 1. jaw: bigonial / bizygomatic breadth (soft tissue, direct anthropometry)
// Farkas LG et al. 2005, 'International anthropometric study of facial morphology in various ethnic groups/races', J Craniofac Surg
// 16:615-646, as tabulated (mean +/- 2 SD) in Staka G et al. 2017, Acta Stomatol Croat 51(3), doi 10.15644/asc51/3/3, Tables 6-7.
// ratio = go-go / zy-zy of the sample means. East Asian = the mean of the Singaporean Chinese, Vietnamese, Thai and Japanese samples.
export const JAW_SRC = 'Farkas et al. 2005 (J Craniofac Surg 16:615) via Staka et al. 2017 (doi 10.15644/asc51/3/3) Tables 6-7';
export const JAW = {
  m: { white: { goGo: 97.1, zyZy: 137.1 }, black: { goGo: 104.2, zyZy: 138.7 }, asian: { goGo: (107.3 + 110.4 + 109.5 + 117.3) / 4, zyZy: (144.6 + 144.0 + 147.1 + 147.2) / 4 } },
  f: { white: { goGo: 91.1, zyZy: 129.9 }, black: { goGo: 96.7, zyZy: 130.5 }, asian: { goGo: (102.3 + 104.8 + 106.0 + 115.6) / 4, zyZy: (136.2 + 134.3 + 138.3 + 141.2) / 4 } },
};
export const JAW_RATIO_SD = 0.035;   // OUR: go-go SD ~5-6 mm (Farkas) against a correlated zy-zy, as a ratio SD

// ---------------------------------------------------------------- 2. soft-tissue depths (mm), CT, living adults
// Sultanova N, Bayramov R, Maharammova N, Pascoletti G 2026, 'Facial soft tissue thicknesses of Azerbaijan adult population: CT study',
// PLoS ONE, doi 10.1371/journal.pone.0348124: Table 9 (men, BMI < 25 | >= 25), Table 10 (women), Table 4 (age 18-25 | 26-45 | >= 46,
// sexes pooled). Bilateral sites: the mean of right and left. Our site <- their landmark: sg supraglabella, g glabella, n nasion, rhi
// rhinion, mph mid-philtrum, ls supradentale (the upper lip over the alveolus), li infradentale, sl mentolabial sulcus, pg pogonion,
// gn and me gnathion ('beneath chin'), so supraorbital, or infraorbital, mal inferior malar, zy zygion, buc supra-M2, mas occlusal line
// (mid-masseter), mm infra-M2, go gonion. (Cross-check: Moritsugui et al. 2022, the Brazilian CBCT means by sex, PLoS ONE, doi 10.1371/journal.pone.0270980,
// agree within ~1-2 mm at the midline; their 'malar' is a different site.)
// BMI: the two groups' mean BMIs are not printed; OUR assumption: 22.5 and 28.5 (6 units apart), so the per-unit slope = difference / 6.
// Age: cross-sectional (group I ~22 y, group III ~55 y: 3.3 decades); older people in the sample are also heavier, so away from the
// lips HALF the cross-sectional slope is used (OUR correction for that confound); the lips' thinning is used whole.
const T9 = { sg: [5.15, 6.13], g: [5.77, 6.47], n: [7.38, 8.34], rhi: [2.93, 3.58], mph: [15.63, 15.75], ls: [12.28, 12.51], li: [12.90, 12.84], sl: [12.85, 14.64], pg: [11.03, 13.21], gn: [7.52, 10.42],
  so: [6.31, 7.54], or: [4.56, 5.78], mal: [12.66, 15.33], zy: [9.74, 13.66], buc: [26.54, 30.40], mas: [21.64, 25.17], mm: [21.75, 25.30], go: [12.37, 18.47] };
const T10 = { sg: [5.18, 5.82], g: [5.59, 6.29], n: [6.03, 6.90], rhi: [2.50, 3.08], mph: [13.13, 12.47], ls: [9.57, 10.06], li: [11.12, 11.65], sl: [11.49, 12.77], pg: [10.14, 11.73], gn: [6.06, 7.90],
  so: [5.83, 7.42], or: [4.96, 6.79], mal: [12.04, 14.12], zy: [9.65, 13.04], buc: [25.05, 29.55], mas: [21.0, 24.2], mm: [21.2, 22.65], go: [12.21, 16.36] };
const T4 = { sg: [5.34, 6.15], g: [5.99, 6.62], n: [7.33, 7.58], rhi: [2.79, 3.37], mph: [15.89, 13.62], ls: [12.01, 11.03], li: [11.85, 12.31], sl: [12.64, 13.52], pg: [11.06, 12.12], gn: [7.65, 8.75],
  so: [6.30, 7.35], or: [4.72, 6.37], mal: [12.80, 14.63], zy: [10.08, 12.93], buc: [27.5, 29.99], mas: [22.26, 24.06], mm: [22.91, 22.59], go: [12.75, 16.42] };
const LIPS_SITES = new Set(['mph', 'ls', 'li']);
export const TISSUE_SRC = 'Sultanova et al. 2026, PLoS ONE, doi 10.1371/journal.pone.0348124 (CT, 300 adults): Tables 4, 9, 10; BMI groups assumed 6 units apart (OUR); age slope halved away from the lips (OUR)';
export const TISSUE_C2 = Object.fromEntries(Object.keys(T9).map(k => {
  const perBMI = { m: (T9[k][1] - T9[k][0]) / 6, f: (T10[k][1] - T10[k][0]) / 6 }, dec = (T4[k][1] - T4[k][0]) / 3.3 * (LIPS_SITES.has(k) ? 1 : 0.5);
  return [k, { m: (T9[k][0] + T9[k][1]) / 2, f: (T10[k][0] + T10[k][1]) / 2, perBMI, perDecade: dec }];
}));
TISSUE_C2.me = { ...TISSUE_C2.gn };
// what the mesh already does per BMI unit before the layer (mm / BMI unit), measured by face2_test.mjs (5) at the c2 sites: a lane A
// woman and man of 40, BMI p20 vs p80 (12.6 and 9.2 BMI apart), mean of the two. The mesh's fat goes to the masseter and the gonion
// (0.96, 1.09 against the CT's 0.56, 0.86) and too little to the zygoma, the orbits and the chin: heavier people get jowls before a
// fuller face. The layer adds the table's slope minus this.
export const MESH_BMI_C2 = { sg: 0.02, g: 0.015, n: 0, rhi: 0, mph: -0.04, ls: 0.095, li: 0, sl: 0.06, pg: 0.15, gn: 0.215, me: 0.295, so: 0.11, or: 0.015, mal: 0.33, zy: 0.305, buc: 0.48, mas: 0.96, mm: -0.05, go: 1.09 };

// ---------------------------------------------------------------- 3. lips
// Vermilion heights at the midline (mm, young adults): ls-sto upper, sto-li lower.
//  white and black: the direct-anthropometry values tabulated by Dolci C et al. 2021, Children 8:574, doi 10.3390/children8070574
//    (Tables 4-5: NAW, Farkas; African-American, Farkas et al.), caliper.
//  asian (women): Chong Y et al. 2021, Skin Res Technol 27:206, doi 10.1111/srt.12906, Chinese women 20-29 (upper lip height minus the
//    cutaneous height; lower likewise), stereophotogrammetry; East Asian men: OUR (the women's values + the NAW men-women difference).
//  age: upper -0.5, lower -0.35 mm a decade from 25 (Chong 2021 across 20-59, Chinese women; applied to everyone: OUR generalisation).
// Lip protrusion to Ricketts' E-line (prn - pg'), mm, + ahead of the line:
//  white: Caucasian adults n 535 as tabulated by Bravo-Hammett S et al. 2020, Eur J Dent 14:259, doi 10.1055/s-0040-1712071;
//  hispanic: the Colombian adults of the same paper; asian: Vietnamese adults 18-25, Le LN et al. 2023, J Orthod Sci 12:26,
//  doi 10.4103/jos.jos_105_22; black women: young Black South African women, Wilson SP et al. 2023, PRS Global Open 11:e4942,
//  doi 10.1097/GOX.0000000000004942; black men OUR (women's - the Caucasian men-women difference). Age: -0.4 mm a decade past 30 (OUR;
//  the lips retrude and thin with age, Iblher et al. 2008 direction).
export const LIPS = {
  verm: { m: { white: [8.0, 9.3], black: [13.6, 13.8], asian: [7.4, 9.5] }, f: { white: [8.7, 9.4], black: [13.3, 13.2], asian: [8.1, 9.6] } },
  vermSd: { m: [1.6, 1.8], f: [1.5, 1.7] },
  eline: { m: { white: [-6.03, -3.95], hispanic: [-3.68, -2.05], asian: [-2.52, -0.95], black: [0.96, 3.55] }, f: { white: [-4.59, -2.3], hispanic: [-2.66, -0.83], asian: [-2.5, -0.95], black: [2.4, 5.2] } },
  elineSd: [2.0, 2.0],
  src: 'vermilion: Dolci et al. 2021 (doi 10.3390/children8070574, NAW and AA caliper), Chong et al. 2021 (doi 10.1111/srt.12906, Chinese women); E-line: Bravo-Hammett et al. 2020 (doi 10.1055/s-0040-1712071, Caucasian and Colombian), Le et al. 2023 (doi 10.4103/jos.jos_105_22, Vietnamese), Wilson et al. 2023 (doi 10.1097/GOX.0000000000004942, Black South African women); OUR where marked',
};
// Winiarska N et al. 2025, Aesthetic Plast Surg, doi 10.1007/s00266-024-04299-1 (Caucasian women): the cupid's bow peaks stand 1.29 x the
// midline upper vermilion height; used for the painted vermilion's shape (fitLipMask)
export const BOW_RATIO = 1.29;

// ---------------------------------------------------------------- lids: the upper lid's resting height
// MRD1 (the upper lid margin above the pupil's centre, primary gaze), adults without lid conditions: Zhou JW et al. 2026, Int
// Ophthalmol, doi 10.1007/s10792-026-04124-5 (6,231 patients): 3.72 mm at 18-27, 4.08 at 28-37, 3.85 at 38-47, 3.54 at 48-57, about
// -0.2 mm a decade; women +0.35 over men; Asian -0.33 against white; the normal range 2.5-5 mm, the lid 1-2 mm under the upper limbus.
// hm08's upper lid sits ~7 mm over the pupil (face2_test): the iris shows whole with white above it, the 'staring eye' CYCLES saw at 1:1
// (and MediaPipe reads our fissures ~30 % taller than the reference photographs'). c2 lowers the upper margin to the person's MRD1.
export const MRD1_SRC = 'Zhou et al. 2026, Int Ophthalmol, doi 10.1007/s10792-026-04124-5';
export function mrd1Target(S, r) {
  // 4.05 mm to the late thirties (the table's 28-37 cell; its 18-27 cell, 3.72, is the smallest, n 103), then -0.25 mm a decade
  const age = S.age ?? 35, base = age < 38 ? 4.05 : 4.05 - 0.25 * (age - 38) / 10, gm = groupMix(S.group), keep = 1 - clamp(S.averageness ?? 0);
  return base + (S.sex === 'm' ? -0.17 : 0.17) - 0.33 * (gm.asian || 0) + clamp(gauss(r), -1.5, 1.5) * 0.6 * keep + (S.eyeOpen ?? 0);   // SD 0.6: OUR (the EHR's 1.3 includes measurement noise)
}
export function lidMeasure(F, P, E, side) {
  if (!E || !side) return null; const fr = frameOf(F, P), I = F.ids, pu = pupilsOf(E, side);
  const py = pu.map(q => { const d = [q[0] - fr.o[0], q[1] - fr.o[1], q[2] - fr.o[2]]; return (d[0] * fr.y[0] + d[1] * fr.y[1] + d[2] * fr.y[2]) * 1000; });
  return { L: fr.loc(I.ps_L)[1] - py[0], R: fr.loc(I.ps_R)[1] - py[1] };
}
// the upper lid margin's loop vertices as extra warp controls, moved down (and a little forward: the margin rides on the globe and the
// cornea's bulge) by the person's excess over the target, full over the pupil, a fifth at the canthi; the canthi and the brow stay
export function lidPlan(F, P, E, side, target, max = 3.5) {
  const m = lidMeasure(F, P, E, side); if (!m) return { extra: [], m };
  const fr = frameOf(F, P), extra = [];
  for (const [s, sg] of [['L', 1], ['R', -1]]) { const loop = F.lid[s] || []; if (!loop.length) continue;
    const Q = loop.map(v => [v, fr.loc(v)]), cy = Q.reduce((a, [, q]) => a + q[1], 0) / Q.length, xs = Q.map(([, q]) => q[0]), x0 = Math.min(...xs), x1 = Math.max(...xs), xc = 0.5 * (x0 + x1), hw = 0.5 * (x1 - x0);
    const d = clamp(m[s] - target, 0, max);
    if (d < 0.05) continue;
    for (const [v, q] of Q) { if (q[1] < cy + 0.5) continue; const w = Math.max(0.2, 1 - ((q[0] - xc) / hw) ** 2); extra.push({ v, d: [0, -d * w, 0.45 * d * w] }); } }
  return { extra, m };
}
function pupilsOf(E, side) {          // = measure.js pupils (kept local to avoid a cycle)
  const out = [];
  for (const s of [1, 0]) { let zmax = -Infinity; for (let i = 0; i < side.length; i++) if (side[i] === s) zmax = Math.max(zmax, E[i * 3 + 2]);
    let x = 0, y = 0, z = 0, k = 0; for (let i = 0; i < side.length; i++) if (side[i] === s && E[i * 3 + 2] > zmax - 0.006) { x += E[i * 3]; y += E[i * 3 + 1]; z += E[i * 3 + 2]; k++; }
    out.push([x / k, y / k, z / k]); }
  return out;
}

// ---------------------------------------------------------------- 5. looks (the client's common / pleasant / attractive)
// averageness: shrink every individual deviation toward the person's own sex / age / group mean (Langlois and Roggman 1990);
// symmetry (Rhodes 2006); dimorphism, moderate (Perrett et al. 1998; Rhodes 2006); facial adiposity a little lower within the healthy
// range (Coetzee et al. 2009, Perception 38:1700: perceived facial adiposity tracks health and is rated less attractive); skin evenness
// (Fink et al. 2006) and the health colour of carotenoids and oxygenated blood (Stephen et al. 2009); clear sclera (Provine et al. 2011:
// reddened sclera read as less healthy and attractive); a relaxed, pleasant resting mouth (corners level to a little up); for
// 'attractive' also fuller lips (+0.5 SD of the vermilion for women, +0.2 for men) and the lids 0.3 mm higher (an alert, open eye),
// both inside the normal ranges, both OUR settings (the first looks board read 'attractive' as barely different). Never one face,
// never make-up, never a grin. The numbers are OUR settings of these levers. The corner tilt is for women; men's resting corners sit
// 1 mm lower (spec.tiltMen, default -1.0): the reference photographs' corners (MediaPipe, closed mouths) sit ~3 mm over the stomion line
// in women and ~level in men (ref_vs_renders.json), and c2's first board put men's corners above the photos'.
export const LOOKS_C2 = {
  common: { averageness: 0, symmetry: 0, dimorphism: 0, adiposity: 0, tilt: 0.0, skin: { homogeneity: 0.5, health: 0 }, eyes: { vessels: 0.6 } },
  pleasant: { averageness: 0.4, symmetry: 0.5, dimorphism: 0.1, adiposity: -0.6, tilt: 0.3, skin: { homogeneity: 0.62, health: 0.25 }, eyes: { vessels: 0.45 } },
  attractive: { averageness: 0.7, symmetry: 0.85, dimorphism: 0.35, adiposity: -1.5, tilt: 0.5, lipFull: 0.5, eyeOpen: 0.3, skin: { homogeneity: 0.78, health: 0.55 }, eyes: { vessels: 0.25 } },
};
// skin at 1:1 (lane B's applySkin params; OUR, by eye on probe stills of L23 under the key, out/face2/probe s_a..s_c): at a head-and-
// shoulders 1:1 frame a pore is ~0.5 px, so lane B's footprint fade turned all micro relief into sheen and the face read as wax. c2
// keeps more of it (microFade 0.33: the pores and furrows fade at a third of the footprint), deepens pores and relief, lowers the
// pre-integrated scattering (1.0 against lane B's 1.6: a crisper terminator) and strengthens the fine lines a little. Risk: below 1 the
// fade lets sub-pixel detail alias; in motion this can shimmer (to check on a clip; lane B's own TAA / supersampling decides).
export const SKIN_C2 = { sss: 1.0, pores: 2.2, relief: 2.0, microFade: 0.33, lines: 1.2, oil: 0.4 };   // oil: lane B 0.5; a little less sheen on deep skin under the sun (probe t_L05_oil)

// ---------------------------------------------------------------- helpers in the face frame
const F3 = (P, v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
export function frameOf(F, P) {
  const fr = faceFrame(F, P);
  fr.loc = v => { const d = [P[v * 3] - fr.o[0], P[v * 3 + 1] - fr.o[1], P[v * 3 + 2] - fr.o[2]];
    return [(d[0] * fr.x[0] + d[1] * fr.x[1] + d[2] * fr.x[2]) * 1000, (d[0] * fr.y[0] + d[1] * fr.y[1] + d[2] * fr.y[2]) * 1000, (d[0] * fr.z[0] + d[1] * fr.z[1] + d[2] * fr.z[2]) * 1000]; };
  return fr;
}
// mix a per-group table over the person's group mix (Hispanic expanded with sample.js's HISP unless the table has its own column)
export function mixGroups(tab, gm) {   // (exported for FACE4)
  if (tab.hispanic) { let s = 0, o = null; for (const g of ['white', 'black', 'hispanic', 'asian']) { const w = gm[g] || 0; if (!w || !tab[g]) continue; const v = [].concat(tab[g]); o = o ? o.map((x, i) => x + w * v[i]) : v.map(x => w * x); s += w; } return o.map(x => x / s); }
  const bm = baseMix(gm); let s = 0, o = null; for (const g of ['white', 'black', 'asian']) { const w = bm[g] || 0; if (!w) continue; const v = [].concat(tab[g]); o = o ? o.map((x, i) => x + w * v[i]) : v.map(x => w * x); s += w; } return o.map(x => x / s);
}

// ---------------------------------------------------------------- structure: the soft-tissue gonion and the lower-face contour
// The jaw contour in the frontal view: for a height y (frame mm), the most lateral head / jaw vertex on one side, kept near the depth of
// the tragion (the ramus lies under the ear; the cheek's front and the neck's back are excluded). Gonion: the contour point 30 % of the
// way from menton up to tragion (OUR rule: the mandibular angle's height on an adult skull is roughly a third of menton-tragion);
// the lower cheek ('mas2', the mid-masseter on the correct side): the contour at the stomion's height.
export function jawSites(F, P, region, nb) {
  const fr = frameOf(F, P), I = F.ids, t = [fr.loc(I.t_L), fr.loc(I.t_R)], me = fr.loc(I.me), sto = fr.loc(I.sto), out = {};
  for (const [s, sg, ti] of [['L', 1, 0], ['R', -1, 1]]) {
    const tz = t[ti][2], at = (y, tol, z0, z1) => { let best = -1, bx = -1e9;
      for (let v = 0; v < nb; v++) { const r = region[v]; if (r !== 0 && r !== 11) continue; const q = fr.loc(v); if (sg * q[0] < 15) continue;
        if (Math.abs(q[1] - y) > tol || q[2] < tz + z0 || q[2] > tz + z1) continue; if (sg * q[0] > bx) { bx = sg * q[0]; best = v; } }
      return best; };
    const yGo = me[1] + 0.30 * (t[ti][1] - me[1]);
    // the gonion lies under the ear (the lobe ends above it); the lower cheek at the mouth's height is taken in front of the ear's
    // front edge (the lobe hangs to about that height)
    out['go_' + s] = at(yGo, 3, -12, 38); out['mas_' + s] = at(sto[1], 3, 10, 40);
  }
  return out;
}
// the lips' columns: at offsets across the mouth, the most forward upper-lip vertex (between subnasale and stomion) and the most forward
// lower-lip vertex (within 14 mm under the stomion); x in frame mm. They carry the vermilion and protrusion placement into the warp.
export function lipColumns(F, P, nb, region, N = null) {
  const fr = frameOf(F, P), I = F.ids, sn = fr.loc(I.sn), sto = fr.loc(I.sto), cL = fr.loc(I.ch_L), cR = fr.loc(I.ch_R), half = Math.abs(cL[0] - cR[0]) / 2, cols = [];
  // the lips' meeting line across the mouth: the stomion at the middle, the corners at the sides (a corner sits lower or higher than the
  // stomion: searching above / below the stomion's own height at the sides picked the other lip)
  const line = x => sto[1] + (0.5 * (cL[1] + cR[1]) - sto[1]) * Math.min(1, (x / half) ** 2);
  const Q = []; for (let v = 0; v < nb; v++) { if (region && region[v] !== 0 && region[v] !== 11) continue; const q = fr.loc(v); if (Math.abs(q[0]) > half || q[1] > sn[1] || q[1] < sto[1] - 18 || q[2] < sto[2] - 14) continue; Q.push([v, q]); }
  for (const xc of [0, -4, 4, -8, 8, -12, 12, -16, 16]) { if (Math.abs(xc) > 0.7 * half) continue; let up = null, lo = null; const yl = line(xc);
    for (const [v, q] of Q) { if (Math.abs(q[0] - xc) > 1.4) continue;
      if (q[1] < sn[1] - 2 && q[1] > yl + 0.8 && (!up || q[2] > up.q[2])) up = { v, q };
      if (q[1] < yl - 1.2 && q[1] > yl - 14 && (!lo || q[2] > lo.q[2])) lo = { v, q }; }
    const w = Math.max(0, 1 - (xc / (0.8 * half)) ** 2);
    // the lower lip's border: under its forward point, the vertex whose normal points most DOWN (the roll's underside, where the
    // vermilion meets the skin above the mentolabial sulcus)
    let bo = null;
    if (lo && xc === 0 && N) for (const [v, q] of Q) { if (Math.abs(q[0] - xc) > 1.4 || q[1] > lo.q[1] - 1 || q[1] < lo.q[1] - 10 || q[2] < lo.q[2] - 7) continue;
      const ny = N[v * 3] * fr.y[0] + N[v * 3 + 1] * fr.y[1] + N[v * 3 + 2] * fr.y[2]; if (!bo || ny < bo.ny) bo = { v, ny }; }
    // the lower lip is moved at its midline only (the warp spreads it; the stomion and the corners hold): the mesh's lower lip is too
    // sparse off the midline for a column search to pick mirror-consistent vertices, and one-sided picks twisted the lip
    cols.push({ x: xc, w, up: up && up.v, lo: lo && xc === 0 ? lo.v : null, bo: bo && bo.ny < -0.3 ? bo.v : null }); }
  return cols;
}
// the lip measures c2 places (frame mm): midline upper vermilion height (the upper lip's most forward point above the stomion) and the
// two lips' protrusion to the E-line (prn - pg)
export function lipMeasures(F, P, cols) {
  const fr = frameOf(F, P), I = F.ids, sto = fr.loc(I.sto), prn = fr.loc(I.prn), pg = fr.loc(I.pg), c0 = cols.find(c => c.x === 0) || cols[0];
  const u = fr.loc(c0.up), l = fr.loc(c0.lo), b = c0.bo != null ? fr.loc(c0.bo) : null;
  const eline = q => { const dy = pg[1] - prn[1], dz = pg[2] - prn[2], L = Math.hypot(dy, dz), ny = -dz / L, nz = dy / L, s = Math.sign(nz) || 1;   // the normal pointing forward
    return ((q[1] - prn[1]) * ny + (q[2] - prn[2]) * nz) * s; };
  return { uv: u[1] - sto[1], eU: eline(u), eL: eline(l), lowerTurn: sto[1] - l[1], lv: b ? sto[1] - b[1] : null };
}
// the drawn lip targets for a person (frame mm)
export function lipTargets(S, r) {
  const sex = S.sex === 'm' ? 'm' : 'f', gm = groupMix(S.group), keep = 1 - clamp(S.averageness ?? 0), ageV = Math.max(0, (S.age ?? 35) - 25) / 10, ageE = Math.max(0, (S.age ?? 35) - 30) / 10;
  const vm = mixGroups(LIPS.verm[sex], gm), el = mixGroups(LIPS.eline[sex], gm), z1 = clamp(gauss(r), -1, 1) * keep, z2 = clamp(gauss(r), -1.5, 1.5) * keep;   // vermilion within 1 SD, protrusion 1.5 (OUR: past it the CG lip reads as a defect first)
  const full = (S.lipFull ?? 0) * (sex === 'f' ? 1 : 0.4);
  return { uv: vm[0] - 0.5 * ageV + (z1 + full) * LIPS.vermSd[sex][0], lv: vm[1] - 0.35 * ageV + (0.6 * z1 + full) * LIPS.vermSd[sex][1],
    eU: el[0] - 0.4 * ageE + z2 * LIPS.elineSd[0], eL: el[1] - 0.4 * ageE + 0.8 * z2 * LIPS.elineSd[1], z: [z1, z2] };
}
// the drawn jaw target: go-go = ratio(sex, group) x zy-zy, + the gonion's extra soft tissue with BMI beyond what the ratio scales
// (Sultanova 2026 per-BMI slopes at gonion and zygion; Farkas samples ~BMI 22, OUR), + 0.8 mm a decade past 25 (OUR, half the CT's
// cross-sectional gonion change)
export function jawTarget(S, zyTarget, r) {
  const sex = S.sex === 'm' ? 'm' : 'f', gm = groupMix(S.group), keep = 1 - clamp(S.averageness ?? 0), d = clamp(S.dimorphism ?? 0, -1, 1);
  const rt = t => t.goGo / t.zyZy, J = JAW[sex], Jo = JAW[sex === 'm' ? 'f' : 'm'];
  const ratio = mixGroups({ white: rt(J.white), black: rt(J.black), asian: rt(J.asian) }, gm)[0], ratioO = mixGroups({ white: rt(Jo.white), black: rt(Jo.black), asian: rt(Jo.asian) }, gm)[0];
  const z = clamp(gauss(r), -2, 2) * keep, sG = TISSUE_C2.go.perBMI[sex], sZ = TISSUE_C2.zy.perBMI[sex], bmi = S.bmi ?? 23;
  const rr = ratio + z * JAW_RATIO_SD + d * 0.5 * (ratio - ratioO) * (sex === 'm' ? 1 : -1) * 0;   // (the men-women ratio difference is tiny; dimorphism acts through zy-zy)
  return { value: rr * zyTarget + (2 * sG - rr * 2 * sZ) * (bmi - 22) + 0.8 * Math.max(0, (S.age ?? 35) - 25) / 10, ratio: rr, z };
}

// ---------------------------------------------------------------- the soft-tissue layer (c2)
// At each site: (the table's change for this person's BMI and age from the reference person, BMI 24, age 35) minus what the mesh already
// does with BMI; spread by a normalised Gaussian field with a narrower reach than P2's (11 mm against 16) so the sites' contrasts
// (thin over the zygoma and the chin, thick over the buccal and masseter) are not averaged away.
// the jaw's breadth at the gonion and the lower cheek is placed by the warp from Farkas' living-face anthropometry (soft tissue
// included, + the CT's per-BMI gonion slope in jawTarget): the layer leaves those two sites at 0 so the tissue is not counted twice
const PLACED_BY_WARP = new Set(['go', 'mas']);
export function tissueC2(F, ids, P, N, nb, S, facing, sst) {
  const sex = S.sex === 'm' ? 'm' : 'f', dec = ((S.age ?? 35) - 35) / 10, dB = (S.bmiFace ?? S.bmi ?? 24) - 24, sites = [];
  for (const [k, s] of Object.entries(TISSUE_C2)) { if (PLACED_BY_WARP.has(k)) continue;
    const res = s.perBMI[sex] - (MESH_BMI_C2[k] ?? s.perBMI[sex]), d = s.perDecade * dec + Math.max(-2.5, Math.min(4, res * dB)); if (!d) continue;
    for (const nm of [k, k + '_L', k + '_R']) if (ids[nm] != null && ids[nm] >= 0) sites.push({ k: nm, v: ids[nm], d: d / 1000 }); }
  const D = new Float32Array(nb), sg = 0.011, bg = 0.25, zT = P[ids.t_L * 3 + 2];
  for (let v = 0; v < nb; v++) { const zf = sst(zT - 0.035, zT + 0.005, P[v * 3 + 2]); if (!zf || !facing[v]) continue;
    let ws = bg, s = 0; for (const q of sites) { const dx = P[v * 3] - P[q.v * 3], dy = P[v * 3 + 1] - P[q.v * 3 + 1], dz = P[v * 3 + 2] - P[q.v * 3 + 2], w = Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * sg * sg)); ws += w; s += w * q.d; }
    D[v] = zf * facing[v] * s / ws; }
  return { D, sites: Object.fromEntries(sites.map(s => [s.k, +(s.d * 1000).toFixed(2)])) };
}
// facing for the lateral sites too: the c2 layer also reaches the jaw's side (the gonion faces sideways), so its mask is 'skin that
// faces out of the head' (normal away from the head's axis), not P2's 'faces forward'
export function outwardMask(F, P, N, nb, region, sst) {
  const fr = frameOf(F, P), M = new Float32Array(nb), I = F.ids, c = [0.5 * (P[I.t_L * 3] + P[I.t_R * 3]), 0.5 * (P[I.t_L * 3 + 1] + P[I.t_R * 3 + 1]), 0.5 * (P[I.t_L * 3 + 2] + P[I.t_R * 3 + 2])];
  for (let v = 0; v < nb; v++) { const r = region[v]; if (r !== 0 && r !== 11 && r !== 1) continue;
    const d = [P[v * 3] - c[0], 0, P[v * 3 + 2] - c[2]], l = Math.hypot(d[0], d[2]) || 1, o = (N[v * 3] * d[0] + N[v * 3 + 2] * d[2]) / l;
    // the inner lips and nostrils (normals pointing up / down into the mouth and nose) keep still: P2's forward mask there
    M[v] = sst(0.15, 0.45, o); }
  return M;
}

// ---------------------------------------------------------------- 4. the resting expression
// hero.js's mouth-corner-puller (MakeHuman's zygomaticus major unit) raises the corner ~11 mm at weight 1 (face2_probe.mjs): solve the
// weight that brings the corners from where the face left them to the look's target tilt (corner height above the stomion, mm), within
// 0-0.15 (a smirk starts past that on an asymmetric mouth; a grin far past it). The tilt targets: OUR settings, checked against the reference photos' resting corners
// (review/studio_human_c8/after/face2/ref_measures.json corner_tilt).
export function restExpression(src, F, P, tiltTarget) {
  const I = F.ids, fr = frameOf(F, P), a = src.data.arr('expr_mouth-corner-puller');
  if (!a) return { w: 0 };
  const sto = fr.loc(I.sto), cl = fr.loc(I.ch_L), cr = fr.loc(I.ch_R), tilt = 0.5 * (cl[1] + cr[1]) - sto[1];
  const dy = 0.5 * ((a[I.ch_L * 3] * fr.y[0] + a[I.ch_L * 3 + 1] * fr.y[1] + a[I.ch_L * 3 + 2] * fr.y[2]) + (a[I.ch_R * 3] * fr.y[0] + a[I.ch_R * 3 + 1] * fr.y[1] + a[I.ch_R * 3 + 2] * fr.y[2])) * 1000 - 0;
  const w = clamp((tiltTarget - tilt) / Math.max(1, dy), 0, 0.15);   // 0.15: ~1.6 mm of lift; past it the unit reads as a smirk on an asymmetric mouth
  return { w, tilt0: tilt, perUnit: dy, delta: a };
}

// ---------------------------------------------------------------- lane B's painted vermilion, fitted to this face (from outside)
// likeness/skin.js paints the vermilion as an analytic shape round h.mouth with fixed numbers (2.5 cm half-width, 8.5 / 10.5 mm up and
// down). This wraps the skin material's onBeforeCompile AFTER applySkin and replaces those literals with the face's own: half the mouth
// width, the bow peaks at 1.29 x the midline upper vermilion (Winiarska 2025), the lower vermilion height. Guarded: if lane B's text is
// not found nothing changes (a console note). Hand-off: lane B to read these as uniforms (h.faceLips) so this patch can go.
export const LIP_RE = /float x = b\.x \/ 0\.025, yu = \(b\.y - hMouth\.y\), top = 0\.0085 \* \(1\.0 - 0\.55 \* x \* x\) - 0\.0016 \* exp\(-x \* x \* 30\.0\), bot = -0\.0105 \* \(1\.0 - 0\.6 \* x \* x\);/;
export function fitLipMask(h, lips) {
  if (!lips) return null;
  const f = x => Math.max(0.0001, x).toFixed(5), half = lips.halfW, top = lips.uv * BOW_RATIO, notch = lips.uv * (BOW_RATIO - 1), bot = lips.lv;
  const rep = `float x = b.x / ${f(half)}, yu = (b.y - hMouth.y), top = ${f(top)} * (1.0 - 0.55 * x * x) - ${f(notch)} * exp(-x * x * 30.0), bot = -${f(bot)} * (1.0 - 0.6 * x * x);`;
  const mat = h.body.material, prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat); let hit = null;
  mat.onBeforeCompile = (sh, r) => { prev?.(sh, r); if (LIP_RE.test(sh.fragmentShader)) { sh.fragmentShader = sh.fragmentShader.replace(LIP_RE, rep); hit = true; } else { hit = false; console.warn('face c2: lane B lip mask text not found; the painted vermilion is left as lane B drew it'); } };
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + `|faceLips${f(half)}${f(top)}${f(bot)}`;
  mat.needsUpdate = true;
  h.faceLips = { halfW: half, top, notch, bot };
  return { rep, hit: () => hit };
}
