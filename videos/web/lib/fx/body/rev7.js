// BODY / REV 7 (HUMAN c8 round 7, BODY7, 8 Oct 2026): the body calibrated to the photographs. castPrior runs it with every tissue top-up (c3, 8 Oct:
// one current version); a rev 7 record is an ordinary record (its params carry only fat depots, muscle fields and frame levers that mix.js build()
// already reads), so no build code changed.
//
// WHAT THE PHOTOGRAPHS SAY (research/PERSON_TARGETS.md section 4, gate 6; review/studio_human_c8/after/body7/NOTES.md for the numbers):
//   REFS c4's nude standing fronts (n = 9-25 per sex and build, 25 of 46 of them Friedler's 350 x 500 px diptychs) give widths over stature read by
//   derive.measure() on a person mask: shoulder (the full silhouette at the shoulder line, deltoids and hanging arms), chest, waist (the narrowest
//   trunk width between 0.50 and 0.88 of the shoulder-hip drop), hip (the widest between 0.85 and the crotch). ANSUR II (the same soldiers the sampler
//   draws from; BMI 19-26) gives the same quantities with caliper definitions: bideltoid, chest, waist (at the navel) and hip breadth. The two anchors
//   are not the same instrument (a segmentation mask is dilated a little; the caliper levels differ), so the calibrated target is their MEAN, and the
//   pull is a HINGE: a width inside the band [target - w, target + w] feels nothing; outside it, a relative residual that joins the fit's own
//   (ANSUR tape) residuals at a weight below theirs. A person the photographs and ANSUR agree on is not moved; a width both say is too narrow is lifted.
//   The cast is lean (BMI 20-26, the sampler's BMI percentiles 5-35): the targets are the HEALTHY-build photographs (women slim / average / athletic,
//   men all builds), never the pooled set that includes the 'curvy' women.
import { slicePlane, triSet } from './measure.js';
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const REV7_VERSION = 3;      // 2 (iteration 1, 8 Oct 03:45): the hinge bites (band 1 %, weights 3, leash 0.05); levers by anatomy and sex (see shape7)
// 3 (iteration 2, 8 Oct 07:10): (a) the photographs' quartiles re-read on REFMEASURE's corrected yardstick (c2 + knee-normalised c4, pooled; the raw table's c4
// half had extrapolated statures, CHECK H1); (b) no shoulder-width push (uDelt retired, no trapezius / deltoid baseline: the men were already at or above
// the corrected median, and the mass widened a high shoulder shelf); (c) stage 1 held at v6 (prior.js); (d) the shoulder girdle: girdle7.js, the
// clavicle depressed when the arm hangs, calibrated per person to ANSUR II's acromion against the sternal notch and C7 (girdleOf7 below)

// ---------------------------------------------------------------- the calibration table (fractions of stature)
// photo: REFS c4 + nude typical, healthy builds, derive.measure() medians and quartiles (after/body7/measures/photo_profile7.json, table 'front'; n 9-25);
// ansur: ANSUR II, BMI 18.5-30, a regression of each caliper breadth over stature on BMI (value at BMI 23.4, slope per BMI unit, computed from the raw
// files); k: the caliper level to the silhouette's level (the waist's narrowest level sits above the navel: 0.95 on L08's own mesh).
// The photographs' BMI is not known (build labels by eye: slim / average / athletic): ASSUMED 23.0.
export const PHOTO_BMI = 23.0;
// 7.3: photo = [p25, p50, p75] of REFMEASURE's corrected pooled set (m_body.SETS 'pooled' = c2 + knee-normalised c4, all builds; n f / m: shoulder 15 / 20,
// waist 15 / 23, hip 16 / 24; read 8 Oct 07:00 with m_body.photo_records / set_items).
export const CALIB7 = {
  f: { shoulder: { photo: [0.2503, 0.2565, 0.2692], a0: 0.2683, b: 0.00417 }, waist: { photo: [0.1496, 0.1586, 0.1863], a0: 0.1747, b: 0.00467, k: 0.95 }, hip: { photo: [0.1940, 0.2101, 0.2340], a0: 0.2101, b: 0.00355 } },
  m: { shoulder: { photo: [0.2611, 0.2655, 0.2762], a0: 0.2742, b: 0.0040 }, waist: { photo: [0.1569, 0.1646, 0.1765], a0: 0.1675, b: 0.0044, k: 0.95 }, hip: { photo: [0.1960, 0.2086, 0.2173], a0: 0.1858, b: 0.00262 } },
};
// the target and the dead-band half-width for one width of one person: the MEAN of the photographs' median and ANSUR's value, both carried to the
// person's own BMI (a lean person is not asked to be as broad as the pooled photographs); the half-width the smaller of the photographs' half IQR
// and BAND7 of the target. rev 7.1 had 3 % and a firm leash: every lever stayed at 0 (the widths sat at the band's lower edge, the gate's FAIL side);
// 7.2 pulls to within 1 % of the anchors' mean (the mean already sits between ANSUR and the photographs, so it is not the photographs alone)
export const BAND7 = 0.01;
export function target7(sex, key, bmi = PHOTO_BMI) {
  const c = CALIB7[sex]?.[key]; if (!c) return null;
  const p = c.photo[1] + c.b * (bmi - PHOTO_BMI), a = (c.a0 + c.b * (bmi - 23.4)) * (c.k ?? 1), t = (p + a) / 2;
  return { t, w: Math.min((c.photo[2] - c.photo[0]) / 2, BAND7 * t), photo: p, ansur: a };
}
// all the targets of a sampled person (sampler.js hands this to the fits as t.rev7)
export function targets7(t) { const o = { sex: t.sex, bmi: t.bmi }; for (const k of Object.keys(CALIB7[t.sex])) o[k] = target7(t.sex, k, t.bmi); return o; }

// ---------------------------------------------------------------- the frontal widths of a built body, in the bind pose (fractions of stature)
// The same landmark-relative levels and rules as derive.measure() (REFMEASURE's gate 6), read off the mesh by plane slices with the arms left out of
// the trunk (a photograph's arm-contact rules estimate the same thing). shoulder = the full width at the shoulder line with the arm swung to hang
// straight down about its shoulder joint (the bind pose holds the arms out in an A; the photographs' arms hang): the extent of the rotated upper-arm
// vertices and the neck / torso vertices within 0.02 H above to 0.03 H below the shoulder joints.
export function frontal7(S, B, m = null, opts = {}) {
  const n = opts.n ?? 8;
  const P = B.pos, H = B.stature, bones = S.hero.meta.bones, J = (nm, end = 'heads') => B[end][bones.findIndex(b => b.name === nm)];
  const shL = J('upperarm01.L'), shR = J('upperarm01.R'), elL = J('lowerarm01.L'), elR = J('lowerarm01.R'), hpL = J('upperleg01.L'), hpR = J('upperleg01.R');
  const shY = (shL[1] + shR[1]) / 2, hpY = (hpL[1] + hpR[1]) / 2, T = shY - hpY, mid = (shL[0] + shR[0] + hpL[0] + hpR[0]) / 4;
  const out = { shoulderJoints: Math.abs(shL[0] - shR[0]) / H };
  // crotch: lowest point of pelvis / torso near the midline on the frame (measure.js: m.crotch), else the hip joint minus a leg-length guess
  const yc = m?.crotch ?? (hpY - 0.07 * H);
  const ext = (tris, y) => { const q = slicePlane(S, P, tris, [0, y, 0], [0, 1, 0]); if (!q.length) return null; let a = Infinity, b = -Infinity; for (const p of q) { if (p[2] < a) a = p[2]; if (p[2] > b) b = p[2]; } return b - a; };
  const scan = (f0, f1, kind, tris, yMin = -Infinity) => { let best = null; for (let i = 0; i < n; i++) { const f = f0 + (f1 - f0) * i / (n - 1), y = shY - f * T; if (y < yMin) continue; const w = ext(tris, y); if (w == null) continue; if (best == null || (kind === 'max' ? w > best : w < best)) best = w; } return best == null ? null : best / H; };
  out.chest = scan(0.18, 0.45, 'max', triSet(S, [1, 2, 7]));
  out.waist = scan(0.50, 0.88, 'min', triSet(S, [2, 7, 8]));
  const f1 = Math.min(1.30, (shY - yc) / T); out.hip = scan(0.85, Math.max(0.86, f1), 'max', triSet(S, [2, 7, 8]));
  // 7.2 diagnostics (not fitted): the levels (fractions of the drop) of the narrowest waist and the widest hip, and the waist-to-hip line's bulge: the
  // width halfway between them over the straight line joining them, fraction of stature (+ convex, the high hip; 0 a straight line, AUDIT7's read)
  if (opts.diag) { const tr = triSet(S, [2, 7, 8]), at = (f0, f1_, kind) => { let bf = f0, bw = null; for (let i = 0; i < 16; i++) { const f = f0 + (f1_ - f0) * i / 15, w = ext(tr, shY - f * T); if (w == null) continue; if (bw == null || (kind === 'max' ? w > bw : w < bw)) { bw = w; bf = f; } } return [bf, bw]; };
    const [fw, ww] = at(0.40, 0.88, 'min'), [fh, wh] = at(0.85, Math.max(0.86, f1), 'max'), wm = ext(tr, shY - (fw + fh) / 2 * T);
    Object.assign(out, { waistAt: +fw.toFixed(3), hipAt: +fh.toFixed(3), bulge: wm == null || ww == null || wh == null ? null : (wm - (ww + wh) / 2) / H }); }
  // shoulder: swing each arm (region 3) about its shoulder joint to hang vertically (the frontal-plane angle between the joint-to-elbow vector and straight down)
  { const R = S.region, nb = S.nb, y0 = shY - 0.03 * H, y1 = shY + 0.02 * H; let xmax = -Infinity, xmin = Infinity;
    for (const [sh, el, side] of [[shL, elL, 1], [shR, elR, -1]]) { const dx = el[0] - sh[0], dy = el[1] - sh[1], ang = Math.atan2(dx, -dy), c = Math.cos(-ang), s = Math.sin(-ang);   // rotate by -ang about z so (dx, dy) -> (0, -|d|)
      for (let v = 0; v < nb; v++) { if (R[v] !== 3) continue; const x = P[v * 3] - sh[0], y = P[v * 3 + 1] - sh[1]; if (Math.sign(P[v * 3] - mid) !== side) continue;
        const xr = sh[0] + x * c - y * s, yr = sh[1] + x * s + y * c; if (yr < y0 || yr > y1) continue; if (side > 0) xmax = Math.max(xmax, xr); else xmin = Math.min(xmin, xr); } }
    for (let v = 0; v < nb; v++) { const r = R[v]; if (r !== 1 && r !== 2) continue; const y = P[v * 3 + 1]; if (y < y0 || y > y1) continue; xmax = Math.max(xmax, P[v * 3]); xmin = Math.min(xmin, P[v * 3]); }
    out.shoulder = isFinite(xmax) && isFinite(xmin) ? (xmax - xmin) / H : null; }
  out.waistHip = out.waist && out.hip ? out.waist / out.hip : null;
  return out;
}

// the hinge residuals: 0 at or above the band's lower edge (t - w), else the relative miss below it, times the weight. ONE-SIDED: the evidence is that
// ours are narrower than the photographed and the ANSUR-at-BMI persons; a person already broader than the band is the tape fit's business (older and
// heavier men carry a wider waist for good reason), never pulled in. two = true: also past the upper edge.
export function resid7(T7, f7, wts, two = false) {
  const r = [];
  for (const [k, w] of Object.entries(wts)) { const T = T7?.[k], v = f7?.[k]; if (!T || v == null || !isFinite(v)) { r.push(0); continue; }
    const lo = T.t - T.w, hi = T.t + T.w; r.push(w * (v < lo ? (v - lo) / T.t : two && v > hi ? (v - hi) / T.t : 0)); }
  return r;
}
export const W7 = { waist: 3, hip: 3 };     // 7.3: the shoulder width is no longer pulled (7.2: shoulder 3): on the corrected yardstick both sexes sit at or above the median
export const W7_72 = { shoulder: 3, waist: 3, hip: 3 };      // 7.1 had 1.5 / 1.2 / 1.5, below the tapes' 2-2.5: the tapes won and nothing moved. Now a frontal width 3 % under
// its band costs what a tape 4-5 % off costs; the tapes still hold the girths, so the fit answers a narrow frontal width by REDISTRIBUTING (a wider,
// shallower waist; a fuller lateral hip), not by inflating the person

// ---------------------------------------------------------------- tissue: what a learned-prior body lacks, and softness for any body
// A prior body (prior.js: SOMA / MHR, fitted to the ANSUR / NHANES tapes) carries neither a muscle nor a fat layer of the person's own: its learned
// surface is the scan population's average adult. Rev 7 adds, from the person's OWN drawn targets, what that average does not know. Amplitudes are
// metres along the form-1 soft tissue's smoothed normals (mix.js softTissue low-passes every field at 6-8 cm), so a few mm read as a swell, not a lump.
//   muscle7: the SURPLUS of the person's muscle pattern (sampler.js musclePattern at their drawn ALMI z and occupation) over the same person at z = 0,
//            'general': 'strong 2' and a manual or carrying job show in the shoulders, back, arms and thighs; never negative (the prior cannot lose muscle)
//   shoulder baseline: the neck-shoulder slope (upper trapezius), the deltoid cap and the lat sweep of an ACTIVE adult, which the scan mean lacks
//            (AUDIT7: 'the men's shoulders are narrow and sloped'; the bench shows it: trapezius line falls straight from the ear)
//   soft7:   age and body-fat softness: the trunk (and for women the upper arm and the hip) carry more at the same BMI from the thirties on (Kuk 2009,
//            NHANES DXA: the trunk share of fat rises ~6 points from 25 to 55 y at a fixed BMI), scaled by the person's own drawn body-fat fraction.
//            OUR magnitudes (the DXA gives shares, not thicknesses), kept to a few mm.
import { musclePattern } from './sampler.js';
const MUSCLE_K = 0.7, TRAPU7 = 0.35;
// 7.3: no upper-trapezius or deltoid baseline (7.2 had trapUpper 3.5 / 1.5 mm and deltoid 2.5 / 1.2 mm: it raised the neck base +0.025 of stature wide at
// the 0.86 level and squared the deltoid corner; the shoulder's real fault is the girdle's height, girdle7.js); the mid-back and lat sweep stay
const SHOULDER_BASE = { m: { trapMid: 0.0010, latissimus: 0.0015 }, f: { latissimus: 0.0006 } };
const SOFT_MM = { f: { abdLower: 0.005, flank: 0.004, back: 0.003, braLine: 0.003, tricepsFat: 0.003, submental: 0.0015, subtroch: 0.002 },
                  m: { abdUpper: 0.004, visceral: 0.003, flank: 0.005, back: 0.003, nape: 0.003, chestFat: 0.003, submental: 0.002 } };
const PF_REF = { f: 0.30, m: 0.22 };
export function muscle7(t) {
  const ref = musclePattern(t.sex, t.age, 0, 'general'), out = {};
  for (const [k, v] of Object.entries(t.muscle || {})) { const d = v - (ref[k] ?? 0); if (d > 2e-4) out[k] = (out[k] || 0) + d * MUSCLE_K; }
  // 7.3: most of the upper trapezius' surplus goes to the mid trapezius (the back): on hm08 the trapUpper field sits on the neck base, and 4-6 mm of
  // it (the manual-work pattern: L03, L11, L12, L23) widened the neck base +0.01 of stature over the photographs' 0.073 at 0.86 of stature
  if (out.trapUpper) { out.trapMid = (out.trapMid || 0) + (1 - TRAPU7) * out.trapUpper; out.trapUpper *= TRAPU7; }
  for (const [k, v] of Object.entries(SHOULDER_BASE[t.sex])) out[k] = (out[k] || 0) + v * (1 - 0.35 * clamp((t.age - 40) / 30, 0, 1));
  return out;
}
export function soft7(t) {
  const x = clamp((t.age - 28) / 32, 0, 1.25), k = clamp((t.pf ?? PF_REF[t.sex]) / PF_REF[t.sex], 0.6, 1.5), out = {};
  for (const [d, a] of Object.entries(SOFT_MM[t.sex])) out[d] = a * x * k;
  return out;
}
const addTo = (o, k, v) => { if (v) o[k] = (o[k] || 0) + v; };
// the base add-ons (deterministic from the targets) and the fitted levers uDelt / uHip / uWst (metres; fitted against the frontal widths) laid onto a
// params object's fat and muscle dictionaries. Returns the same object.
export function shape7(p, t, th = null, { prior = true } = {}) {
  p.fat = { ...p.fat }; p.muscle = { ...p.muscle };
  if (prior) for (const [k, v] of Object.entries(muscle7(t))) addTo(p.muscle, k, v);      // form-1 bodies already carry the pattern
  for (const [k, v] of Object.entries(soft7(t))) addTo(p.fat, k, v);
  if (th) {
    const dl = th.uDelt || 0, hp = th.uHip || 0, ws = th.uWst || 0, f = t.sex === 'f';
    // the shoulder: the deltoid cap, the upper trapezius slope and a little pectoral (both sexes)
    if (dl) { addTo(p.muscle, 'deltoid', dl); addTo(p.muscle, 'trapUpper', 0.7 * dl); addTo(p.muscle, 'pectoral', 0.25 * dl); }
    // the lateral hip (7.2, by sex; the fields' own levels on hm08, as fractions of the shoulder-to-hip-joint drop: gluteMed 0.72-1.03, troch 0.98-1.40,
    // subtroch 1.08-1.72): a woman's is the gluteofemoral depot over the gluteus medius, which turns the straight waist-to-hip line (AUDIT7) into the
    // convex high hip; a man's is the gluteus medius and the TFL over the trochanter with a thin fat cover
    if (hp) { if (f) { addTo(p.fat, 'troch', hp); addTo(p.fat, 'subtroch', 0.6 * hp); addTo(p.fat, 'glute', 0.4 * hp); addTo(p.muscle, 'gluteMed', 0.25 * hp); }
              else { addTo(p.muscle, 'gluteMed', hp); addTo(p.muscle, 'gluteMax', 0.3 * hp); addTo(p.fat, 'troch', 0.4 * hp); } }
    // the waist (7.2). 7.1 laid the flank depot (0.60-0.92 of the drop, centre 0.75) with 0.7 on the upper abdomen and 0.5 on the back. Measured on
    // the v6 women (node, 8 Oct): their narrowest frontal width sits HIGH, at 0.53-0.56 of the drop (the lower ribs), 22-24 cm on a 1.6 m woman,
    // while at the navel and the crests (0.75-0.9) the breadth is 4-13 % OVER ANSUR's waist breadth and the crest tape 2-6 % over NHANES, and the
    // natural-waist tape is 3-4.5 % UNDER: a corset pinch at the lower ribs above a full crest line. The photographs (waist / hip 0.775) and the
    // natural-waist tape agree. So a woman's waist lever moves tissue UP the waist at a near-constant crest girth: per 5 mm on L22 (measured), the
    // latissimus' lower border +3.3, the back depot +3.2, the external oblique +1.5 thousandths of stature at the narrowest level, the flank +1.5
    // but +1.5 % on the crest tape; so latissimus 0.5, back 0.4, oblique 0.5 in, flank and upper abdomen 0.3 each out (about +0.6 thousandths of
    // stature a mm, the crest tape unchanged, the natural-waist tape +0.3 % a mm). A man's narrowest sits at the flank's own level: flank + oblique.
    if (ws) { if (f) { addTo(p.muscle, 'latissimus', 0.5 * ws); addTo(p.fat, 'back', 0.4 * ws); addTo(p.muscle, 'oblique', 0.5 * ws); addTo(p.fat, 'flank', -0.3 * ws); addTo(p.fat, 'abdUpper', -0.3 * ws); }
              else { addTo(p.fat, 'flank', ws); addTo(p.muscle, 'oblique', 0.3 * ws); } }
  }
  return p;
}
export const LEVERS7 = { keys: ['uHip', 'uWst'],     // 7.3: uDelt retired (shape7 still reads it from a 7.2 record's theta, so those rebuild as cast)
  keysAll: ['uDelt', 'uHip', 'uWst'], step: { uDelt: 0.001, uHip: 0.001, uWst: 0.001 }, lo: { uDelt: 0, uHip: 0, uWst: 0 }, hi: { uDelt: 0.012, uHip: 0.012, uWst: 0.016 },
  sd: { uDelt: 0.005, uHip: 0.005, uWst: 0.005 }, pw: { uDelt: 0.05, uHip: 0.05, uWst: 0.05 },
  // 7.3: with stage 1 held (the bones no longer re-fit around the rev 7 tissue), the broad depots must absorb the muscle surplus and the softness at
  // the person's own mass and tapes: their leash to zero is loosened (MHR 0.2 / SOMA 0.08 -> 0.05) on a rev 7 cast only (measured: at 0.2 the men
  // came out +1.6 to +2.5 % over their mass and +1 to +2.6 points over the natural-waist tape)
  upw: { uTrunk: 0.05, uLeg: 0.05, uArm: 0.05 } };   // a weak leash to zero (7.1: sd 0.004, pw 0.15 held every lever at 0)

// ---------------------------------------------------------------- hands and feet (ANSUR II lengths over stature; the prior's hands and feet are the learned mean's)
// The prior bodies' hands and feet are the scan mean's: ANSUR percentile 1-7 for hand length over stature on the cast (the bench's own read), the men's
// feet p1. The MakeHuman hand / foot scale targets do not reach a prior body (only its head is taken from stageA), so the scale is applied here, about the
// wrist (hand bones: metacarpals and fingers) and the ankle (foot and toe bones), by the bones' skin weights, smooth across the wrist and the ankle.
// params.frame.hand / .foot = the fractional scale (0 = as the learned body has it); priorVA applies it (a record without it rebuilds exactly as before).
export const ANSUR7 = { f: { hand: 0.1105, foot: 0.1506 }, m: { hand: 0.1094, foot: 0.1533 } };
const HAND_B = /^(metacarpal\d|finger\d-\d)\.[LR]$/, FOOT_B = /^(foot|toe\d-\d)\.[LR]$/;
function extWeights(S) {
  if (S._ext7) return S._ext7; const bones = S.hero.meta.bones, n = S.n, sw = S.hero.arr('skinWeight'), si = S.hero.arr('skinIndex'), hand = new Float32Array(n), foot = new Float32Array(n), side = new Int8Array(n);
  const isH = bones.map(b => HAND_B.test(b.name)), isF = bones.map(b => FOOT_B.test(b.name)), isL = bones.map(b => /\.L$/.test(b.name));
  for (let v = 0; v < n; v++) for (let j = 0; j < 4; j++) { const b = si[v * 4 + j], w = sw[v * 4 + j]; if (!w) continue; if (isH[b]) { hand[v] += w; side[v] = isL[b] ? 1 : -1; } if (isF[b]) { foot[v] += w; side[v] = isL[b] ? 1 : -1; } }
  return (S._ext7 = { hand, foot, side });
}
// scale the hands (k.hand) and the feet (k.foot) of V (MakeHuman decimetres, S.n x 3) about the wrist / ankle joint centres of V itself
export function scaleExtremities(S, V, k) {
  if (!k || (!k.hand && !k.foot)) return V;
  const W = extWeights(S), bones = S.basis.bones, J = S.basis.joints, jm = j => { const ids = J[j]; let x = 0, y = 0, z = 0; for (const i of ids) { x += V[i * 3]; y += V[i * 3 + 1]; z += V[i * 3 + 2]; } return [x / ids.length, y / ids.length, z / ids.length]; };
  const jc = {}; for (const nm of ['wrist.L', 'wrist.R', 'foot.L', 'foot.R']) jc[nm] = jm(bones.find(b => b.name === nm).head);
  const out = new Float32Array(V);
  for (let v = 0; v < S.n; v++) { const sd = W.side[v]; if (!sd) continue; const S_ = sd > 0 ? 'L' : 'R';
    for (const [key, w, nm] of [['hand', W.hand[v], 'wrist.' + S_], ['foot', W.foot[v], 'foot.' + S_]]) { const kk = k[key]; if (!kk || !w) continue; const c = jc[nm], f = 1 + kk * Math.min(1, w);
      for (let a = 0; a < 3; a++) out[v * 3 + a] = c[a] + (out[v * 3 + a] - c[a]) * f; } }
  return out;
}
// hand length (the wrist joint to the farthest hand / finger vertex, left) and foot length (heel to toe-tip landmarks, left) of a built body, metres
export function hands7(S, B) {
  const P = B.pos, R = S.region, bones = S.hero.meta.bones, wr = B.heads[bones.findIndex(b => b.name === 'wrist.L')]; let far = 0;
  for (let v = 0; v < S.nb; v++) if ((R[v] === 5 || R[v] === 6) && P[v * 3] > 0) { const d = Math.hypot(P[v * 3] - wr[0], P[v * 3 + 1] - wr[1], P[v * 3 + 2] - wr[2]); if (d > far) far = d; }
  const L = S.landmarks, h = L.heelL * 3, t = L.toeTipL * 3;
  return { hand: far, foot: Math.hypot(P[h] - P[t], P[h + 1] - P[t + 1], P[h + 2] - P[t + 2]) };
}
// the target lengths (m): the ANSUR median over stature (hand: wrist crease to tip, so the joint-centre-to-tip target adds 0.8 cm) for a stature
export const handTargets7 = (sex, H) => ({ hand: ANSUR7[sex].hand * H + 0.008, foot: ANSUR7[sex].foot * H });
