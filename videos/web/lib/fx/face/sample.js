// FACE / SAMPLE (HUMAN c8 P2): who a face is. A person's craniofacial targets drawn from measured populations, and the feature
// variation the tables do not measure drawn as data with stated priors. Deterministic from a seed.
//
// Measures (assets/face/face_pop.json, sources/face/bake_face.py):
//   ANSUR II (US Army 2012, public microdata; computed here): face width zy-zy, face length n-me (menton-sellion), interpupillary
//     breadth, head breadth eu-eu, head length g-op, ear length, tragion-to-top; per sex: an intercept per group + slopes on age (per
//     decade, within the survey's 17-58), stature and BMI, with the residuals' SDs and correlations (drawn jointly through a Cholesky).
//   Farkas-style direct anthropometry, young adults, per sex and group (NAW: Farkas 1994; African-American: Farkas, Katic and Forrest
//     2007; East Asian eyes: Jayaratne et al. 2013; East Asian nose and mouth: OUR estimate; Hispanic: OUR mixture): used for the
//     PROPORTIONS inside ANSUR's frame (nose height and lip heights as fractions of the face length; ANSUR and Farkas measure different
//     samples and the absolute lengths disagree by up to 5 mm, so the frame comes from the larger survey and the proportions from the
//     anthropometrist) and absolutely for the horizontal soft-tissue widths (en-en, ex-ex, al-al, ch-ch).
//   Age past the tables: ear length +0.22 mm a year (Heathcote 1995); nose height, upper lip and mouth width by OUR per-decade rules.
// Controls (the client's 'common to attractive', as grounded levers, never one ideal):
//   averageness a (0..1): every individual deviation, measures and features, shrinks by (1 - a) toward the person's OWN sex / age /
//     group mean (Langlois and Roggman 1990: averaged faces are judged more attractive; the mean here is the person's own population's).
//   dimorphism d (-1..1, default 0 = the own-sex mean): sex-typicality. Each sex-linked target moves by d x half the men-women difference
//     in the person's group, away from (d > 0) or toward (d < 0) the other sex's mean, for women and men alike (Perrett et al. 1998;
//     Rhodes 2006 for the mixed evidence on men).
//   symmetry and skin homogeneity are applied elsewhere (asym in face.js; homogeneity is lane B's applySkin parameter, passed through).
export const GROUPS = ['white', 'black', 'hispanic', 'asian'];
// draws are truncated at 2 SD: the tails are real people, but past 2 SD a generated face reads as a caricature before it reads as a
// person (Rosa's first draw put her pupils 68 mm apart, +2.1 SD); spec.zmax widens it for anyone who wants the tails
let ZMAX = 2;
export const HISP = { white: 0.55, black: 0.20, asian: 0.25 };      // lane A's RACE_OF hispanic (OUR assumption, as lane A's)
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
export const hashStr = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export function groupMix(g) {
  const o = { white: 0, black: 0, hispanic: 0, asian: 0 };
  if (g && typeof g === 'object') { for (const k of GROUPS) o[k] = g[k] || 0; }
  else if (GROUPS.includes(g)) o[g] = 1; else { o.white = 0.6; o.black = 0.15; o.hispanic = 0.15; o.asian = 0.1; }
  const s = GROUPS.reduce((a, k) => a + o[k], 0) || 1; for (const k of GROUPS) o[k] /= s; return o;
}
// the three tabulated groups behind a mix (Hispanic expanded): for the feature priors and the Farkas tables without a Hispanic column
export function baseMix(gm) { return { white: gm.white + gm.hispanic * HISP.white, black: gm.black + gm.hispanic * HISP.black, asian: gm.asian + gm.hispanic * HISP.asian }; }
function chol(A) { const n = A.length, L = A.map(r => r.map(() => 0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = A[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]; L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-9)) : s / L[j][j]; }
  return L; }
const ANSUR_FIT = ['zy-zy', 'n-me', 'ipd', 'eu-eu', 'g-op', 'sa-sba', 't-v'];
const FARKAS_KEYS = ['n-sn', 'sn-me', 'sn-sto', 'sto-sl', 'en-en', 'ex-ex', 'al-al', 'ch-ch'];
// a Farkas cell for a group mix (the bake already wrote a Hispanic mixture; a mix of groups mixes means and variances)
function farkasCell(pop, sex, gm) {
  const T = pop.farkas[sex], out = {};
  for (const k of FARKAS_KEYS) { let w = 0, mu = 0, m2 = 0;
    for (const g of GROUPS) { const c = T[g]?.[k]; if (!c || !gm[g]) continue; w += gm[g]; mu += gm[g] * c.mean; m2 += gm[g] * (c.sd * c.sd + c.mean * c.mean); }
    if (!w) continue; mu /= w; m2 /= w; out[k] = { mean: mu, sd: Math.sqrt(Math.max(m2 - mu * mu, 0.25)) }; }
  return out;
}
function ansurMean(pop, sex, gm, age, stature, bmi) {
  const A = pop.ansur[sex], out = {}, ageA = clamp(age, 17, 58);
  for (const k of A.keys) { let mu = 0; for (const g of GROUPS) if (gm[g]) mu += gm[g] * A.cells[g].intercept[k];
    mu += A.slopes.perDecade[k] * (ageA - 35) / 10 + A.slopes.per10cmStature[k] * (stature - 1.7) * 10 + A.slopes.per5BMI[k] * (bmi - 26) / 5;
    out[k] = mu; }
  if (age > 58) out['sa-sba'] += 2.2 * (age - 58) / 10;                // Heathcote 1995 past the survey's ages
  return out;
}
// a person's measure targets (mm). spec: { sex, age, group, stature, bmi, seed, spread, averageness, dimorphism }
export function drawTargets(pop, spec) {   // spec.rev 2: FACE c2's table updates (popC2); rev 1 = P2 exactly
  ZMAX = spec.zmax ?? 2;
  const sex = spec.sex === 'm' ? 'm' : 'f', other = sex === 'm' ? 'f' : 'm', gm = groupMix(spec.group), bm = baseMix(gm);
  const age = spec.age ?? 35, stature = spec.stature ?? (sex === 'm' ? 1.75 : 1.62), bmi = spec.bmi ?? 26;
  const r = rng(spec.seed ?? 1), spread = spec.spread ?? 1, keep = 1 - clamp(spec.averageness ?? 0), d = clamp(spec.dimorphism ?? 0, -1, 1);
  const A = pop.ansur[sex];
  if ((spec.rev ?? 1) >= 2) pop = popC2(pop);
  // ANSUR: the own mean, the other sex's mean at the same group / age (and the own body: dimorphism of the face, not of stature)
  const mu = ansurMean(pop, sex, gm, age, stature, bmi), muO = ansurMean(pop, other, gm, age, stature, bmi);
  const ks = A.keys, C = A.residCorr, L = chol(C), e = ks.map(() => gauss(r)), z = ks.map((_, i) => clamp(L[i].reduce((s, x, j) => s + x * e[j], 0), -ZMAX, ZMAX));
  const out = { sex, age, group: gm, stature, bmi, keep, d, targets: {}, z: {} };
  ks.forEach((k, i) => { if (!ANSUR_FIT.includes(k)) return; const sd = A.residSd[k], zi = z[i] * spread * keep;
    out.z[k] = +zi.toFixed(3); out.targets[k] = { mean: mu[k], sd, value: mu[k] + zi * sd + d * 0.5 * (mu[k] - muO[k]), src: 'ANSUR II' }; });
  // Farkas: own and other cells; draws correlated with the frame (OUR assumption: verticals with the face length's residual at r 0.5,
  // horizontals with the face width's at r 0.4)
  const Fo = farkasCell(pop, sex, gm), Fx = farkasCell(pop, other, gm), zL = z[ks.indexOf('n-me')], zW = z[ks.indexOf('zy-zy')];
  const ageF = Math.max(0, age - 30) / 10, AG = { 'n-sn': 0.6, 'sn-sto': 0.5, 'ch-ch': 0.3 };
  const fv = {};
  for (const k of FARKAS_KEYS) { const c = Fo[k], cx = Fx[k]; if (!c) continue;
    const rho = ['n-sn', 'sn-me', 'sn-sto', 'sto-sl'].includes(k) ? 0.5 : 0.4, zf = clamp(rho * (['n-sn', 'sn-me', 'sn-sto', 'sto-sl'].includes(k) ? zL : zW) + Math.sqrt(1 - rho * rho) * gauss(r), -ZMAX, ZMAX) * spread * keep;
    fv[k] = { mean: c.mean + (AG[k] || 0) * ageF, sd: c.sd, value: c.mean + (AG[k] || 0) * ageF + zf * c.sd + d * 0.5 * (c.mean - (cx ? cx.mean : c.mean)), z: zf }; }
  // the vertical proportions inside ANSUR's face length (n-me ~ n-sn + sn-me along the profile)
  const NL = out.targets['n-me'].value, fr = fv['n-sn'].value / (fv['n-sn'].value + fv['sn-me'].value);
  out.targets['n-sn'] = { mean: null, sd: 2.5, value: NL * fr, src: 'Farkas proportion x ANSUR face length' };
  const LF = NL - out.targets['n-sn'].value;
  out.targets['sn-me'] = { mean: null, sd: 3, value: LF, src: 'ANSUR face length - nose height' };
  out.targets['sn-sto'] = { mean: null, sd: 2, value: LF * fv['sn-sto'].value / fv['sn-me'].value, src: 'Farkas proportion x lower face' };
  out.fracSn = fr; out.fracSto = fv['sn-sto'].value / fv['sn-me'].value;                  // the proportions the warp places (warp.js)
  for (const k of ['al-al', 'ch-ch']) { out.targets[k] = { mean: fv[k].mean, sd: fv[k].sd, value: fv[k].value, src: 'Farkas-style direct anthropometry' }; out.z[k] = +fv[k].z.toFixed(3); }
  // the canthi: the mesh's lid-margin landmarks are not the caliper's commissures, and the East Asian eye values come from 3D
  // photogrammetry (a different method), so the canthi keep the mesh's own proportion to the pupils and carry only the person's own
  // deviation (z) and the dimorphism shift as a relative factor; the group's eye shape comes from the features (epicanthus, tilt)
  for (const k of ['en-en', 'ex-ex']) { out.targets[k] = { mean: fv[k].mean, sd: fv[k].sd, value: null, rel: fv[k].value / fv[k].mean, src: 'relative: the mesh\'s own canthal proportion x (1 + the drawn deviation)' }; out.z[k] = +fv[k].z.toFixed(3); }
  out.farkas = Object.fromEntries(Object.entries(fv).map(([k, v]) => [k, +v.value.toFixed(2)]));
  return out;
}
// ---------------------------------------------------------------- features: variation the tables do not measure, as data
// Each feature is a MakeHuman CC0 target pair (+ / -) with a draw SD and a prior mean from context c = { male, female, white, black,
// asian (the tabulated mix, Hispanic expanded), ageK (0 at 30 .. 1 at 80), bmiK }. Group shifts are kept SMALL (a fraction of the
// within-group SD: faces vary far more within a group than between groups), and each is either cited for its direction or marked OURS:
//  - shallower nasal dorsum and tip protrusion, broader tip and alae in African-American and East Asian groups (Farkas et al. 2005;
//    Zhuang et al. 2010 as summarised in PMC10456199: 'African Americans had shorter, wider and shallower noses than Caucasians');
//  - fuller lips (vermilion) in African-American faces (Farkas, Katic and Forrest 2007: larger lip heights); the vermilion thins with
//    age (Iblher et al. 2008);
//  - epicanthic fold, upturned canthal axis, lower and often absent supratarsal crease in East Asian eyes (Sim et al. 2000: crease ~6 mm
//    from the lash margin in southern Chinese women; Jayaratne et al. 2013);
//  - more prominent brow ridge, chin and gonial angles in men; higher brows in women (standard dimorphism: Farkas 1994; Enlow);
//  - the nasal tip descends, the mouth corners turn down, lower-lid bags and ear lobes grow with age (Sforza et al. 2010-11 direction);
//  - head shapes: small weights on MakeHuman's shape targets, square / rectangular leaning male, oval / round leaning female (OURS).
const F_ = (pos, neg, sd, mean = () => 0, sexK = 0) => ({ pos: [].concat(pos), neg: neg ? [].concat(neg) : null, sd, mean, sexK });
const both = (pre, suf) => [`${pre}/l-${suf}`, `${pre}/r-${suf}`];
export const FEATURES = {
  noseHump: F_('nose/nose-hump-incr', 'nose/nose-hump-decr', 0.3, c => 0.12 * c.white - 0.15 * c.black - 0.2 * c.asian, 0.1),
  noseDepth: F_('nose/nose-scale-depth-incr', 'nose/nose-scale-depth-decr', 0.28, c => 0.08 * c.white - 0.22 * c.black - 0.28 * c.asian, 0.08),
  noseTipW: F_('nose/nose-point-width-incr', 'nose/nose-point-width-decr', 0.3, c => 0.28 * c.black + 0.18 * c.asian - 0.05 * c.white),
  noseFlare: F_('nose/nose-flaring-incr', 'nose/nose-flaring-decr', 0.28, c => 0.25 * c.black + 0.1 * c.asian),
  noseSeptum: F_('nose/nose-septumangle-incr', 'nose/nose-septumangle-decr', 0.25),
  noseTip: F_('nose/nose-point-up', 'nose/nose-point-down', 0.3, c => -0.45 * c.ageK + 0.05),
  noseGreek: F_('nose/nose-greek-incr', 'nose/nose-greek-decr', 0.22, c => -0.1 * c.asian - 0.05 * c.black),
  noseBase: F_('nose/nose-base-up', 'nose/nose-base-down', 0.22),
  noseCurve: F_('nose/nose-curve-convex', 'nose/nose-curve-concave', 0.18, c => -0.05 * c.asian),
  noseNostril: F_('nose/nose-nostrils-angle-up', 'nose/nose-nostrils-angle-down', 0.22),
  lipUpper: F_('mouth/mouth-upperlip-volume-incr', 'mouth/mouth-upperlip-volume-decr', 0.28, c => 0.35 * c.black + 0.05 * c.asian - 0.35 * c.ageK, -0.05),
  lipLower: F_('mouth/mouth-lowerlip-volume-incr', 'mouth/mouth-lowerlip-volume-decr', 0.28, c => 0.35 * c.black + 0.05 * c.asian - 0.3 * c.ageK, -0.04),
  cupid: F_('mouth/mouth-cupidsbow-width-incr', 'mouth/mouth-cupidsbow-width-decr', 0.25),
  philtrum: F_('mouth/mouth-philtrum-volume-incr', 'mouth/mouth-philtrum-volume-decr', 0.25, c => 0.1 - 0.25 * c.ageK),
  mouthAngle: F_('mouth/mouth-angles-up', 'mouth/mouth-angles-down', 0.15, c => 0.06 - 0.12 * c.ageK),   // a resting mouth: corners level, a little lower with age (the first board read sad at 0.3)
  lipProt: F_('mouth/mouth-scale-depth-incr', 'mouth/mouth-scale-depth-decr', 0.25, c => 0.28 * c.black + 0.15 * c.asian - 0.05 * c.white - 0.15 * c.ageK),
  upperLipH: F_('mouth/mouth-upperlip-height-incr', 'mouth/mouth-upperlip-height-decr', 0.22, c => 0.15 * c.black - 0.2 * c.ageK),
  lowerLipH: F_('mouth/mouth-lowerlip-height-incr', 'mouth/mouth-lowerlip-height-decr', 0.22, c => 0.12 * c.black - 0.15 * c.ageK),
  chinProm: F_('chin/chin-prominent-incr', 'chin/chin-prominent-decr', 0.3, c => -0.12 * c.asian, 0.15),
  chinW: F_('chin/chin-width-incr', 'chin/chin-width-decr', 0.25, () => 0, 0.18),
  chinCleft: F_('chin/chin-cleft-incr', null, 0, c => c.cleft),
  gonial: F_('chin/chin-bones-incr', 'chin/chin-bones-decr', 0.1, () => 0, 0.08),
  prognath: F_('chin/chin-prognathism-incr', 'chin/chin-prognathism-decr', 0.12, c => 0.06 * c.black),
  cheekVol: F_(both('cheek', 'cheek-volume-incr'), both('cheek', 'cheek-volume-decr'), 0.25, c => 0.4 * c.bmiK - 0.15 * c.ageK, -0.06),
  cheekInner: F_(both('cheek', 'cheek-inner-incr'), both('cheek', 'cheek-inner-decr'), 0.22, c => 0.25 * c.bmiK + 0.1 * c.ageK),
  cheekY: F_(both('cheek', 'cheek-trans-up'), both('cheek', 'cheek-trans-down'), 0.2, c => -0.3 * c.ageK),
  foreSlope: F_('forehead/forehead-nubian-incr', 'forehead/forehead-nubian-decr', 0.06, () => 0, 0.03),
  temple: F_('forehead/forehead-temple-incr', 'forehead/forehead-temple-decr', 0.2, c => -0.35 * c.ageK + 0.15 * c.bmiK),
  browFwd: F_('eyebrows/eyebrows-trans-forward', 'eyebrows/eyebrows-trans-backward', 0.1, c => -0.04 * c.asian, 0.13),
  browY: F_('eyebrows/eyebrows-trans-up', 'eyebrows/eyebrows-trans-down', 0.2, c => -0.15 * c.ageK, -0.12),
  browAngle: F_('eyebrows/eyebrows-angle-up', 'eyebrows/eyebrows-angle-down', 0.2, c => -0.2 * c.ageK, -0.06),
  epicanthus: F_(both('eyes', 'eye-epicanthus-in'), both('eyes', 'eye-epicanthus-out'), 0.2, c => 0.55 * c.asian),
  canthalTilt: F_(both('eyes', 'eye-corner1-up'), both('eyes', 'eye-corner1-down'), 0.25, c => 0.3 * c.asian - 0.25 * c.ageK, -0.05),
  innerCorner: F_(both('eyes', 'eye-corner2-up'), both('eyes', 'eye-corner2-down'), 0.2),
  eyeOpen: F_(both('eyes', 'eye-height1-incr'), both('eyes', 'eye-height1-decr'), 0.22, c => -0.15 * c.asian - 0.2 * c.ageK, -0.05),
  eyeOpen2: F_(both('eyes', 'eye-height2-incr'), both('eyes', 'eye-height2-decr'), 0.2, c => -0.1 * c.asian),
  eyeBag: F_(both('eyes', 'eye-bag-incr'), both('eyes', 'eye-bag-decr'), 0.2, c => 0.55 * c.ageK + 0.15 * c.bmiK + 0.1 * c.asian),
  eyeSet: F_(both('eyes', 'eye-push1-out'), both('eyes', 'eye-push1-in'), 0.2, c => 0.2 * c.asian - 0.05 * c.white),
  earRot: F_(both('ears', 'ear-rot-backward'), both('ears', 'ear-rot-forward'), 0.25),
  earLobe: F_(both('ears', 'ear-lobe-incr'), both('ears', 'ear-lobe-decr'), 0.3, c => 0.4 * c.ageK),
  earFlap: F_(both('ears', 'ear-flap-incr'), both('ears', 'ear-flap-decr'), 0.3),
  earWing: F_(both('ears', 'ear-wing-incr'), both('ears', 'ear-wing-decr'), 0.2),
};
// FACE c2 (rev 2) prior means where P2's read glum or tired on the cast: the resting mouth angle a little up and less turned down with
// age (the c2 resting expression then levels the corners), lower-lid bags lighter (P2's 0.55 x ageK gave a 45-year-old visible bags).
// OUR settings, by eye against the reference photographs' resting faces.
export const FEATURES_C2_MEAN = {
  mouthAngle: c => 0.1 - 0.08 * c.ageK,
  eyeBag: c => 0.35 * c.ageK + 0.1 * c.bmiK + 0.05 * c.asian,
  // MakeHuman's lower lip is a thick round roll with an undercut (the 'puffy' lower lip at 1:1): less volume for everyone, the group
  // and age terms kept; its forward point is then placed by the E-line (c2.js)
  lipLower: c => 0.35 * c.black + 0.05 * c.asian - 0.3 * c.ageK - 0.3,
};
// Farkas et al. 2005 (J Craniofac Surg 16:615) East Asian nose and mouth widths, the mean of the Singaporean Chinese, Vietnamese, Thai
// and Japanese samples as tabulated by Staka et al. 2017 (doi 10.15644/asc51/3/3); SD = the mean sample SD widened for the spread
// between the four samples. Replaces P2's own estimate for East Asian al-al and ch-ch at rev 2.
export const FARKAS_C2_ASIAN = { m: { 'al-al': { mean: 39.6, sd: 2.7 }, 'ch-ch': { mean: 48.95, sd: 3.5 } }, f: { 'al-al': { mean: 38.6, sd: 2.6 }, 'ch-ch': { mean: 46.9, sd: 3.5 } } };
const _popC2 = new WeakMap();
export function popC2(pop) {
  if (_popC2.has(pop)) return _popC2.get(pop);
  const far = JSON.parse(JSON.stringify(pop.farkas));
  for (const sx of ['m', 'f']) { Object.assign(far[sx].asian, FARKAS_C2_ASIAN[sx]);
    // the Hispanic column is a mixture (bake_face.py HISP_MIX): re-mix the two changed measures
    for (const k of ['al-al', 'ch-ch']) { let mu = 0, m2 = 0, s = 0; for (const [g, w] of Object.entries(HISP)) { const c = far[sx][g][k]; if (!c) continue; mu += w * c.mean; m2 += w * (c.sd * c.sd + c.mean * c.mean); s += w; }
      mu /= s; m2 /= s; far[sx].hispanic[k] = { mean: +mu.toFixed(2), sd: +Math.sqrt(Math.max(0.25, m2 - mu * mu)).toFixed(2) }; } }
  const out = { ...pop, farkas: far }; _popC2.set(pop, out); return out;
}
export const HEAD_SHAPES = { 'head/head-oval': -0.5, 'head/head-round': -0.3, 'head/head-square': 0.6, 'head/head-rectangular': 0.4, 'head/head-triangular': 0, 'head/head-diamond': 0 };
// -> { weights: { target: w }, values: { feature: v } }
export function drawFeatures(spec, t) {
  const r = rng(((spec.seed ?? 1) * 7919 + 13) >>> 0), keep = t.keep, d = t.d, spread = spec.spread ?? 1, male = t.sex === 'm' ? 1 : 0;
  const bm = baseMix(t.group), ageK = clamp(((spec.age ?? 35) - 30) / 50), bmiK = clamp(((spec.bmi ?? 25) - 24) / 12, -0.5, 1);
  const c = { male, female: 1 - male, ...bm, ageK, bmiK, cleft: (r() < (male ? 0.12 : 0.04)) ? 0.25 + 0.35 * r() : 0 };
  const sexSign = male ? 1 : -1, W = {}, V = {};
  const add = (name, w) => { if (Math.abs(w) > 1e-4) W[name] = (W[name] || 0) + w; };
  const c2 = (spec.rev ?? 1) >= 2;
  for (const [k, f] of Object.entries(FEATURES)) {
    const v = ((c2 && FEATURES_C2_MEAN[k]) || f.mean)(c) + sexSign * f.sexK * (1 + d) + gauss(r) * f.sd * spread * keep;
    V[k] = +v.toFixed(3);
    if (v >= 0) for (const n of f.pos) add(n, Math.min(v, 1)); else if (f.neg) for (const n of f.neg) add(n, Math.min(-v, 1));
  }
  // head shape: small weights, the leaning by sex scaled by (1 + d)
  for (const [n, lean] of Object.entries(HEAD_SHAPES)) { const v = 0.12 + 0.1 * lean * sexSign * (1 + d) * 0.5 + 0.12 * gauss(r) * spread * keep; if (v > 0.02) add(n, Math.min(v, 0.45)); V[n.slice(5)] = +v.toFixed(3); }
  // facial adiposity and age (lane A's sampler used the same two rules; Coetzee et al. 2009 for BMI in the face)
  const bmiF = c2 ? (spec.bmiFace ?? spec.bmi ?? 25) : (spec.bmi ?? 25);
  const fat = clamp((bmiF - 25) / 14, -0.4, 0.75); if (fat > 0) add('head/head-fat-incr', fat); else add('head/head-fat-decr', -fat);
  // MakeHuman's age target sags the mouth and the cheeks as a whole (P2's board read glum from middle age): c2 starts it later and
  // caps it lower, the small forms (nasolabial, marionette, lids) carrying age instead (OUR)
  add('head/head-age-incr', c2 ? clamp(((spec.age ?? 35) - 35) / 60, 0, 0.5) : clamp(((spec.age ?? 35) - 32) / 55, 0, 0.75));
  return { weights: W, values: V, ctx: c };
}
