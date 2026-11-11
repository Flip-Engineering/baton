// BODY / SAMPLER (HUMAN c8 lane A): who a person is, drawn from measured populations, before any mesh exists.
//   1. NHANES 2017-2018 (assets/body/population.json, scripts/body_calib.py): a Gaussian copula per sex x age band (20-39, 40-59, 60-79,
//      80+) with survey-weighted marginals per group: age, stature, BMI, waist (iliac crest), hip, mid-upper-arm circumference, upper
//      leg and upper arm lengths drawn TOGETHER. Fixing a percentile (bmiPct: 0.9) conditions the others on it (z_o | z_f is
//      N(R_of R_ff^-1 z_f, R_oo - R_of R_ff^-1 R_fo)); spread 0 gives the typical person at that percentile, spread 1 a real draw.
//   2. ANSUR II (all 6,068 soldiers): bust/chest, thigh, calf, biacromial, bicristal and hip breadths, crotch height, head and neck
//      circumferences from stature, BMI, hip, age and group, with the residuals' own correlation (a broad-shouldered woman is broad
//      everywhere a little). Age is held at 58 for the prediction (ANSUR's oldest); age then acts through NHANES and DXA.
//   3. NHANES DXA: percent fat, the trunk / arm / leg shares of fat, appendicular lean mass index and FFMI from BMI, age and group,
//      with residuals. 'strong' (z) raises ALMI and FFMI at the same BMI, so the fat fraction falls: a strong heavy woman is a real
//      point (FFMI 18-19 at BMI 28-32, as the women critic asked), not max muscle plus max weight.
//   4. The breast (women): volume per breast from BMI with an individual residual (Coltman et al. 2017's range; our curve, see
//      population.json lit.breast_volume), tied to the ANSUR bust residual so volume and bust tape agree; a ptosis score from age,
//      volume and parity (our assumption, stated: Regnault's grades 0-3 as the read-out), splay and position on the chest wall.
//   5. Fat depots: a sex pattern (Richer 1920 for women's depots; Wells 2007), shifted to the trunk with age and, for women, with
//      menopause (NHANES RHQ: P(post | age) logistic, a50 = 51.1 y; Ambikairajah et al. 2019), then scaled region by region so the
//      added volume lands in trunk / legs / arms in the person's own DXA shares. Muscles: a sex pattern (Janssen et al. 2000: the sex
//      gap is larger in the upper body; loss after 45 mostly in the legs) x ALMI x an occupational pattern.
//   6. Pregnancy by week and postpartum by month (IOM 2009 weight-gain components; fundal height ~ week).
// 'attractive' is never a default: the default is the average of the person's own sex, age band and group. Nothing here sets a
// waist-hip ratio or a bust height directly; they follow from the drawn measures and the person's own depots and ptosis.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export function mulberry32(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const gauss = r => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
export const ncdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
export function ndtri(p) {   // Acklam
  p = clamp(p, 1e-9, 1 - 1e-9);
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00], b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00], d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - 0.02425) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
const interp = (xs, ys, x) => { if (x <= xs[0]) return ys[0] + (x - xs[0]) * (ys[1] - ys[0]) / (xs[1] - xs[0]); const n = xs.length; if (x >= xs[n - 1]) return ys[n - 1] + (x - xs[n - 1]) * (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2]);
  let i = 1; while (xs[i] < x) i++; const u = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + u * (ys[i] - ys[i - 1]); };
const qv = (P, q, u) => interp(P, q, clamp(u, 0.002, 0.998));                      // value at probability u (tails extrapolated a little)
const qinv = (P, q, x) => { const m = q.length; for (let i = 1; i < m; i++) if (q[i] <= q[i - 1]) return 0.5; return interp(q, P, x); };
function chol(A) { const n = A.length, L = A.map(r => r.map(() => 0)); for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = A[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]; L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-9)) : s / L[j][j]; } return L; }
function inv(A) { const n = A.length, M = A.map((r, i) => [...r, ...r.map((_, j) => +(i === j))]);
  for (let i = 0; i < n; i++) { let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k; [M[i], M[p]] = [M[p], M[i]]; const d = M[i][i] || 1e-12;
    for (let j = 0; j < 2 * n; j++) M[i][j] /= d; for (let k = 0; k < n; k++) if (k !== i) { const f = M[k][i]; for (let j = 0; j < 2 * n; j++) M[k][j] -= f * M[i][j]; } }
  return M.map(r => r.slice(n)); }
const mat = (flat, n) => Array.from({ length: n }, (_, i) => flat.slice(i * n, i * n + n));
export const GROUPS = ['white', 'black', 'hispanic', 'asian'];
// FFIT calibration (see the note in sampleTargets): the crest-to-natural-waist offset (m; women), and the class weights
export const NW_OFF = { f: { mu: 0.06, k: 0.002, sd: 0.03 } };
export let FFIT_W = { rectangle: 1, spoon: 4.871, 'inverted triangle': 81.382, hourglass: 1.576, other: 0.454, triangle: 0.454, 'top hourglass': 0.454, 'bottom hourglass': 0.454 };   // 10 fixed-point rounds, 1,600 women 20-79 y, four groups (run 2, 3 Oct): 46.6 / 20.1 / 13.2 / 7.9 %, other 12.3 %. The inverted triangle needs x81: the bust and hip models rarely draw B - H >= 3.6 in
export function setFfitWeights(w) { FFIT_W = { ...FFIT_W, ...w }; }
function ffitClass(B, W, H, HH) {    // Simmons, Istook and Devarajan 2004 (inches); the same rules as measure.js ffit()
  const bh = B - H, hb = H - B, bw = B - W, hw = H - W, rr = HH / W;
  if (bh <= 1 && hb < 3.6 && (bw >= 9 || hw >= 10)) return 'hourglass';
  if (hb >= 3.6 && hb < 10 && hw >= 9 && rr < 1.193) return 'bottom hourglass';
  if (bh > 1 && bh < 10 && bw >= 9) return 'top hourglass';
  if (hb > 2 && hw >= 7 && rr >= 1.193) return 'spoon';
  if (hb >= 3.6 && hw < 9) return 'triangle';
  if (bh >= 3.6 && bw < 9) return 'inverted triangle';
  if (Math.abs(hb) < 3.6 && bw < 9 && hw < 10) return 'rectangle';
  return 'other';
}
export const bandOf = a => a < 40 ? '20-39' : a < 60 ? '40-59' : a < 80 ? '60-79' : '80+';
const groupMix = g => typeof g === 'object' && g ? g : g && GROUPS.includes(g) ? { [g]: 1 } : { all: 1 };
// MakeHuman's race targets are typological raw material, used only as a face/frame basis around the group, never as the group itself
const RACE_OF = { white: { caucasian: 0.92, african: 0.04, asian: 0.04 }, black: { african: 0.78, caucasian: 0.2, asian: 0.02 }, hispanic: { caucasian: 0.55, african: 0.2, asian: 0.25 },
  asian: { asian: 0.85, caucasian: 0.15, african: 0 }, all: { caucasian: 0.6, african: 0.2, asian: 0.2 } };
// ---------------------------------------------------------------- 1. NHANES copula
export function drawNhanes(pop, spec, r, spread) {
  const sex = spec.sex, age = spec.age ?? 40, band = bandOf(age), cell = pop.nhanes.cells[`${sex}|${band}`], V = pop.vars, P = pop.P, n = V.length, R = mat(cell.rho, n);
  const gm = groupMix(spec.group), q = {};
  for (const v of V) { let acc = null, wsum = 0; for (const [g, w] of Object.entries(gm)) { const qq = cell.q[g] || cell.q.all; acc = acc ? acc.map((x, i) => x + w * qq[v][i]) : qq[v].map(x => w * x); wsum += w; } q[v] = acc.map(x => x / wsum); }
  const fixed = {}; fixed[V.indexOf('age')] = ndtri(qinv(P, q.age, age));
  const pctKey = { bmiPct: 'bmi', staturePct: 'stature', waistPct: 'waist', hipPct: 'hip', muacPct: 'muac' };
  for (const [k, v] of Object.entries(pctKey)) if (spec[k] != null) fixed[V.indexOf(v)] = ndtri(spec[k]);
  // integration v3 (SCAN c1's finding, 3 Oct): a BMI (or stature) given as a VALUE was set after the draw, so waist, hip, arm and legs
  // came from another BMI (a BMI 18.8 woman drew a 0.91 m waist). The value's percentile in this cell now conditions the copula, as
  // bmiPct does; a spec that also gives bmiPct / staturePct (CAST's lineup does) draws exactly as before. spec.condValues false = old.
  if (spec.condValues !== false) {
    if (spec.bmi != null && spec.bmiPct == null) fixed[V.indexOf('bmi')] = ndtri(clamp(qinv(P, q.bmi, spec.bmi), 0.003, 0.997));
    if (spec.stature != null && spec.staturePct == null) fixed[V.indexOf('stature')] = ndtri(clamp(qinv(P, q.stature, spec.stature * 100), 0.003, 0.997)); }
  const f = Object.keys(fixed).map(Number), o = V.map((_, i) => i).filter(i => !(i in fixed)), zf = f.map(i => fixed[i]);
  const Rff = f.map(i => f.map(j => R[i][j])), Rof = o.map(i => f.map(j => R[i][j])), Rinv = inv(Rff);
  const mu = Rof.map(row => row.reduce((s, x, j) => s + x * Rinv[j].reduce((t, y, k) => t + y * zf[k], 0), 0));
  const C = o.map((i, a) => o.map((j, b) => R[i][j] - Rof[a].reduce((s, x, k) => s + x * Rinv[k].reduce((t, y, l) => t + y * Rof[b][l], 0), 0)));
  const L = chol(C), e = o.map(() => gauss(r) * spread), zo = mu.map((m, a) => m + L[a].reduce((s, x, k) => s + x * e[k], 0));
  const z = new Array(n); f.forEach((i, k) => z[i] = zf[k]); o.forEach((i, k) => z[i] = zo[k]);
  const x = Object.fromEntries(V.map((v, i) => [v, qv(P, q[v], ncdf(z[i]))])); x.age = age;
  return { x, z: Object.fromEntries(V.map((v, i) => [v, z[i]])), band, cell: `${sex}|${band}`, groups: gm };
}
// ---------------------------------------------------------------- 2. ANSUR conditional measures; 3. DXA composition
const dummies = gm => ['black', 'hispanic', 'asian'].map(g => gm[g] || 0);
function linModel(block, X, r, spread) {
  const T = block.targets || Object.keys(block.models), R = block.rho ? mat(block.rho, T.length) : null, L = R ? chol(R) : null, e = T.map(() => gauss(r) * spread);
  const z = L ? L.map(row => row.reduce((s, x, k) => s + x * e[k], 0)) : e, out = {}, zres = {};
  T.forEach((t, i) => { const m = block.models[t]; out[t] = m.b.reduce((s, b, k) => s + b * X[k], 0) + z[i] * m.sd; zres[t] = z[i]; });
  return { out, zres };
}
export function drawAnsur(pop, sex, x, gm, r, spread) {
  const A = pop.ansur[sex], X = [1, x.stature, x.bmi, x.hip, Math.min(58, x.age), ...dummies(gm)];
  return linModel(A, X, r, spread);
}
export function drawDxa(pop, sex, x, gm, r, spread, strong = 0) {
  const D = pop.dxa[sex], a = (x.age - 50) / 10, X = [1, 1 / x.bmi, x.bmi, a, a * a, ...dummies(gm)];
  const { out, zres } = linModel({ models: D.models, rho: D.rho, targets: ['pf', 'ftr', 'farm', 'fleg', 'almi', 'ffmi'] }, X, r, spread);
  const H = x.stature / 100, mass = x.bmi * H * H;
  if (strong) { out.almi += strong * D.models.almi.sd; out.ffmi += strong * D.models.ffmi.sd; }
  // keep composition consistent: FFM from FFMI, fat = the rest (floors: essential fat ~ 8 % men, 14 % women)
  const pf = clamp(1 - out.ffmi * H * H / mass, sex === 'f' ? 0.14 : 0.07, 0.62); out.pf = pf * 100;
  out.zAlmi = zres.almi + strong;
  return out;
}
// ---------------------------------------------------------------- 4. breast; 5. depot and muscle patterns; 6. pregnancy
export function breastModel(pop, x, sex, zBust, r, spread, o = {}) {
  if (sex !== 'f') return null;   // the volume curve's slope halves past BMI 32 (run 2: the straight exponential gave x5 at BMI 40, past Coltman's 'x2-3')
  const BV = pop.lit.breast_volume, parity = o.parity ?? 0;
  let vol = clamp(Math.exp(Math.log(BV.v22) + BV.k * (Math.min(x.bmi, 32) - 22) + 0.5 * BV.k * Math.max(0, x.bmi - 32) + BV.sd * (0.8 * zBust + 0.6 * gauss(r) * spread)), BV.min, BV.max);
  if (o.volumeMl) vol = o.volumeMl;
  const zp = gauss(r) * spread, zs = gauss(r) * spread, zt = gauss(r) * spread;
  let ptosis = clamp(0.3 + 0.042 * (x.age - 25) + 1.05 * Math.log(vol / 380) + 0.22 * Math.min(parity, 4) + 0.55 * zp, 0, 3);
  if (o.ptosis != null) ptosis = o.ptosis;
  return { volumeMl: vol, ptosis, grade: Math.min(3, Math.floor(ptosis + 0.25)), splay: clamp(0.08 + 0.1 * ptosis + 0.18 * Math.log(vol / 400) + 0.2 * zs + (o.splay || 0), -0.5, 0.8),
    trans: clamp(-0.1 * ptosis + 0.22 * zt + (o.trans || 0), -0.8, 0.5), parity };
}
// the drawn breast -> the mesh's own controls (calibrated on two women, 25 y BMI 26 and 45 y BMI 49, by the mesh-difference volume of
// person.js): below ~240 mL per breast MakeHuman's cup carries it (cup -1 = 90 mL, 0 = 240 mL); above, our mound amplitude m (metres
// at the peak) on the average cup, v(m) = 239 + 15000 m + 70000 m^2 mL. The fit (fit.js) then moves the mound against the ANSUR bust
// tape with this as its prior. Ptosis -> MakeHuman firmness (firm 0.6 at grade 0 to -1 past grade 2.9) and our sag inside the footprint
// (9 mm per grade, x sqrt(volume / 400 mL)): our mapping, by eye against Regnault's grades.
export function breastParams(B) {
  if (!B) return B; const v = B.volumeMl;
  const cup = v <= 240 ? clamp(-1 + (v - 90) / 150, -1, 0) : 0, mound0 = v <= 240 ? 0 : (-15000 + Math.sqrt(15000 * 15000 + 4 * 70000 * (v - 239))) / (2 * 70000);
  return { ...B, cup, mound0, firm: clamp(0.6 - 0.55 * B.ptosis, -1, 1), sag: 0.009 * B.ptosis * Math.sqrt(v / 400) };
}
// depot patterns: peak thickness (m) per unit fat amplitude, women and men at 25 y (Richer 1920 pl. 12-15, 29-30, 51-52 for the women's list)
export const FAT_PATTERN = {
  f: { genTrunk: 0.010, genLeg: 0.010, genArm: 0.009, genHead: 0.006, glute: 0.032, troch: 0.030, subtroch: 0.024, innerThigh: 0.024, kneeInner: 0.013, thighFront: 0.016, abdLower: 0.026, abdUpper: 0.011, visceral: 0.003, flank: 0.020,
       back: 0.010, braLine: 0.009, nape: 0.004, tricepsFat: 0.017, armGen: 0.008, chestFat: 0.0, axillary: 0.011, mons: 0.011, submental: 0.006, neckFat: 0.004, faceFat: 0.004, calf: 0.011 },
  m: { genTrunk: 0.010, genLeg: 0.009, genArm: 0.008, genHead: 0.006, glute: 0.013, troch: 0.006, subtroch: 0.006, innerThigh: 0.010, kneeInner: 0.003, thighFront: 0.009, abdLower: 0.018, abdUpper: 0.021, visceral: 0.024, flank: 0.023,
       back: 0.016, braLine: 0.006, nape: 0.007, tricepsFat: 0.008, armGen: 0.006, chestFat: 0.015, axillary: 0.006, mons: 0.006, submental: 0.009, neckFat: 0.006, faceFat: 0.005, calf: 0.006 },
};
export const DEPOT_GROUP = { genTrunk: 'trunk', genLeg: 'leg', genArm: 'arm', genHead: 'head', glute: 'glut', troch: 'glut', subtroch: 'leg', innerThigh: 'leg', kneeInner: 'leg', thighFront: 'leg', calf: 'leg', abdLower: 'trunk', abdUpper: 'trunk', visceral: 'trunk',
  flank: 'trunk', back: 'trunk', braLine: 'trunk', nape: 'trunk', chestFat: 'trunk', axillary: 'trunk', mons: 'trunk', tricepsFat: 'arm', armGen: 'arm', submental: 'head', neckFat: 'head', faceFat: 'head' };
const TRUNKY = new Set(['abdLower', 'abdUpper', 'visceral', 'flank', 'back', 'braLine', 'nape', 'chestFat']), GYN = new Set(['glute', 'troch', 'subtroch', 'innerThigh', 'kneeInner', 'thighFront']);
export function postMenopause(pop, age) { const m = pop.reproductive.menopause; return 1 / (1 + Math.exp(-(age - m.a50) / m.s)); }
export function fatPattern(pop, sex, age, rnd = null) {
  const base = FAT_PATTERN[sex], out = {}, a = Math.max(0, age - 30), post = sex === 'f' ? postMenopause(pop, age) : 0;
  for (const [k, v] of Object.entries(base)) {
    let w = v;
    if (TRUNKY.has(k)) w *= (1 + (sex === 'm' ? 0.012 : 0.008) * a) * (1 + 0.35 * post) * (k === 'visceral' ? 1 + (sex === 'm' ? 0.02 * a : 1.6 * post) : 1);   // Kuk et al. 2009; menopause
    if (GYN.has(k)) w *= (1 - (sex === 'm' ? 0.006 : 0.004) * a) * (1 - 0.15 * post);
    if (rnd) w *= Math.exp(0.22 * rnd());
    out[k] = w;
  }
  return out;
}
// muscle amplitudes (m) per unit muscularity at ALMI z = 0, women; men scale the upper body by 1.25 (Janssen 2000: 40 % vs 33 % gap)
export const MUSCLE_BASE = { deltoid: 0.006, pectoral: 0.004, trapUpper: 0.006, trapMid: 0.003, trapLower: 0.002, latissimus: 0.004, erector: 0.004, rectusAbd: 0.003, oblique: 0.003, serratus: 0.0015,
  gluteMax: 0.008, gluteMed: 0.005, biceps: 0.005, triceps: 0.005, forearmExt: 0.004, forearmFlex: 0.004, rectusFem: 0.006, vastusLat: 0.007, vastusMed: 0.007, adductors: 0.005, hamstrings: 0.006,
  gastroc: 0.007, soleus: 0.004, tibialisAnt: 0.003, scm: 0.003 };
const UPPER = new Set(['deltoid', 'pectoral', 'trapUpper', 'trapMid', 'trapLower', 'latissimus', 'biceps', 'triceps', 'forearmExt', 'forearmFlex', 'serratus', 'scm']);
const LOWER = new Set(['gluteMax', 'gluteMed', 'rectusFem', 'vastusLat', 'vastusMed', 'adductors', 'hamstrings', 'gastroc', 'soleus', 'tibialisAnt']);
export const OCCUPATION = {
  general: {},
  manual: { forearmExt: 1.6, forearmFlex: 1.6, trapUpper: 1.5, trapMid: 1.4, deltoid: 1.3, latissimus: 1.3, erector: 1.35, biceps: 1.2, triceps: 1.15, vastusLat: 1.15, vastusMed: 1.15, rectusFem: 1.1, gastroc: 1.1, gluteMax: 1.15 },
  carry: { trapUpper: 1.6, forearmFlex: 1.5, forearmExt: 1.3, erector: 1.3, gluteMax: 1.25, vastusLat: 1.25, vastusMed: 1.25, gastroc: 1.3, soleus: 1.3 },
  desk: Object.fromEntries([...UPPER].map(k => [k, 0.8])),
};
export function musclePattern(sex, age, zAlmi, occupation = 'general') {
  const M = Math.max(0.05, 1 + 0.32 * clamp(zAlmi, -2.5, 3)), occ = OCCUPATION[occupation] || {}, out = {}, lowLoss = 1 - 0.006 * Math.max(0, age - 45), upLoss = 1 - 0.003 * Math.max(0, age - 45);
  for (const [k, v] of Object.entries(MUSCLE_BASE)) out[k] = v * M * (occ[k] ?? 1) * (sex === 'm' && UPPER.has(k) ? 1.25 : 1) * (sex === 'm' && LOWER.has(k) ? 1.08 : 1) * (LOWER.has(k) ? lowLoss : upLoss);
  return out;
}
export function pregnancyGain(pop, prepregBmi, week) {
  const L = pop.lit.pregnancy, tg = L.gain_by_bmi.find(([b]) => prepregBmi < b)[1], f = clamp(week / 40), c = L.term_kg;
  const fetus = c.fetus * f ** 3.2, plac = c.placenta * f ** 1.5, fluid = c.fluid * clamp((week - 10) / 25), uterus = c.uterus * f ** 1.2, breasts = c.breasts * f, blood = c.blood * clamp((week - 6) / 28), ecf = c.ecf * f ** 2;
  const fixed = fetus + plac + fluid + uterus + breasts + blood + ecf, fat = Math.max(0, (tg - (c.fetus + c.placenta + c.fluid + c.uterus + c.breasts + c.blood + c.ecf)) * clamp((week - 8) / 22));
  return { total: fixed + fat, fetus, placenta: plac, fluid, uterus, breasts, blood, ecf, fat, termGain: tg, uterusContents: fetus + plac + fluid + uterus };
}
// ---------------------------------------------------------------- the whole draw
export function sampleTargets(pop, spec) {
  const r = mulberry32((spec.seed ?? 1) * 7919 + 13), spread = spec.spread ?? (spec.seed != null ? 1 : 0), sex = spec.sex === 'm' ? 'm' : 'f';
  const nh = drawNhanes(pop, { ...spec, sex }, r, spread), x = { ...nh.x };
  if (spec.measures) for (const [k, v] of Object.entries(spec.measures)) if (k in x) x[k] = v;
  if (spec.stature) x.stature = spec.stature * 100;
  if (spec.bmi) x.bmi = spec.bmi;
  const gm = nh.groups, ans = drawAnsur(pop, sex, x, gm, r, spread), dxa = drawDxa(pop, sex, x, gm, r, spread, spec.strong || 0);
  const H = x.stature / 100;
  const t = { sex, age: x.age, group: spec.group || 'all', stature: H, bmi: x.bmi, mass: x.bmi * H * H, waist: x.waist / 100, hip: x.hip / 100, muac: x.muac / 100,
    bust: ans.out.chestcircumference / 100, thigh: ans.out.thighcircumference / 100, calf: ans.out.calfcircumference / 100, biacromial: ans.out.biacromialbreadth / 100,
    bicristal: ans.out.bicristalbreadth / 100, hipBreadth: ans.out.hipbreadth / 100, crotch: ans.out.crotchheight / 100, headCirc: ans.out.headcircumference / 100, neck: ans.out.neckcircumference / 100,
    buttockDepth: ans.out.buttockdepth / 100, waistDepth: ans.out.waistdepth / 100, waistBreadth: ans.out.waistbreadth / 100,   // P1: ANSUR depths and breadths (fit targets)
    pf: dxa.pf / 100, ftr: dxa.ftr, farm: dxa.farm, fleg: dxa.fleg, almi: dxa.almi, ffmi: dxa.ffmi, zAlmi: dxa.zAlmi, nhanes: nh, ansurZ: ans.zres };
  // bust, natural waist and high hip, JOINTLY (women): NHANES has no natural-waist or bust tape, ANSUR no civilians over 58. For a drawn
  // woman, K candidate triples come from the models (bust = the ANSUR prediction + a residual; natural waist = the iliac-crest waist
  // minus an offset; high hip between them), each is classed by FFIT, and one is chosen with weight FFIT_W[class]: weights CALIBRATED
  // (sampler_calib in body_test.mjs) so that a drawn row of women lands near SizeUSA's shares (46 % rectangle, 20 % spoon, 14 %
  // inverted triangle, 8 % hourglass). A woman whose hips are far wider than her bust still cannot be an inverted triangle: the
  // reweighting only chooses among shapes her own measures allow. Men: natural waist ~ the crest waist (2 +/- 2 cm).
  { const Ab = pop.ansur[sex].models.chestcircumference, zb0 = ans.zres.chestcircumference || 0, b0 = ans.out.chestcircumference - zb0 * Ab.sd, inch = v => v / 2.54;
    if (sex === 'f' && t.waist) {
      const pick = []; const K = spread ? 48 : 1;
      for (let k = 0; k < K; k++) { const zb = spread ? gauss(r) * spread : 0, d = NW_OFF.f.mu + NW_OFF.f.k * (t.bmi - 28) + (spread ? NW_OFF.f.sd * gauss(r) * spread : 0), kap = clamp(0.65 + (spread ? 0.06 * gauss(r) * spread : 0), 0.4, 0.9);
        const bust = (b0 + zb * Ab.sd) / 100, nw = t.waist - d, hh = nw + kap * (t.hip - nw), cls = ffitClass(inch(bust * 100), inch(nw * 100), inch(t.hip * 100), inch(hh * 100));
        pick.push({ zb, bust, nw, hh, kap, cls, w: spread ? (FFIT_W[cls] ?? FFIT_W.other) : 1 }); }
      let u = r() * pick.reduce((a, c) => a + c.w, 0), ch = pick[0]; for (const c of pick) { u -= c.w; if (u <= 0) { ch = c; break; } }
      t.bust = ch.bust; t.naturalWaist = ch.nw; t.highHip = ch.hh; t.ffitDrawn = ch.cls; ans.zres.chestcircumference = ch.zb;
    } else if (t.waist) t.naturalWaist = t.waist - (0.02 + (spread ? 0.02 * gauss(r) * spread : 0));
  }
  // crotch height: ANSUR predicts it from stature; keep the NHANES upper-leg length's residual in it (they measure the same lever)
  t.crotch += 0.35 * (nh.z.upperleg - 0) * (pop.ansur[sex].models.crotchheight.sd / 100) * spread;
  // parity (women): drawn from NHANES RHQ by band unless given
  if (sex === 'f') { const pd = pop.reproductive.parity[nh.band] || pop.reproductive.parity['40-59']; let u = r(), par = 0; for (const [k, p] of [['p0', 0], ['p1', 1], ['p2', 2], ['p3', 3], ['p4+', 4]]) { u -= pd[k]; if (u <= 0) { par = p; break; } }
    t.parity = spec.parity ?? (spread ? par : (nh.band === '20-39' ? 1 : 2)); }
  t.breast = breastModel(pop, x, sex, ans.zres.chestcircumference || 0, r, spread, { parity: t.parity, ...(spec.breast || {}) });
  t.post = sex === 'f' ? postMenopause(pop, x.age) : 0;
  // pregnancy and postpartum: the drawn woman is the pre-pregnancy body
  if (spec.pregnant) { const g = pregnancyGain(pop, x.bmi, spec.pregnant); t.preg = { week: spec.pregnant, gain: g }; t.prepregMass = t.mass; t.mass += g.total; t.bmi = t.mass / (H * H);
    if (t.breast) t.breast.volumeMl += 200 * (spec.pregnant / 40) ** 1.5;   // IOM / Hytten: ~0.41 kg of breast at term, both
    t.waist = null; t.waistDepth = t.waistBreadth = null; t.hip += 0.01 * g.fat; }                                  // the waist is the bump now: not a target
  if (spec.postpartum != null) { const g = pregnancyGain(pop, x.bmi, 40), m = spec.postpartum, keep = Math.max(0, g.termGain - 5.5) * (0.35 + 0.65 * Math.exp(-m / 3));
    t.preg = { postpartumMonths: m, retainedKg: keep }; t.prepregMass = t.mass; t.mass += keep; t.bmi = t.mass / (H * H); t.waistDepth = t.waistBreadth = null; if (spec.parity == null) t.parity = (t.parity || 0) + (t.parity ? 0 : 1);
    if (t.breast && m < (spec.lactatingMonths ?? 6)) t.breast.volumeMl *= 1.3; t.waist = null; }
  t.breast = breastParams(t.breast);
  // MakeHuman macro choices (soft tissue character, not the measures): muscle tone from ALMI, weight from BMI
  t.mhMuscle = clamp(0.5 + 0.1 * t.zAlmi - (x.age > 60 ? 0.08 : 0), 0.2, 0.78); t.mhWeight = clamp(0.5 + 0.055 * (t.bmi - 25), 0.2, 1);
  t.races = jitterRaces(gm, r, spread);
  t.fatPattern = fatPattern(pop, sex, x.age, spread ? () => gauss(r) : null);
  t.muscle = musclePattern(sex, x.age, t.zAlmi, spec.occupation || 'general');
  t.laxity = clamp((x.age - 35) / 55, 0, 0.9) * 0.8 + (sex === 'f' ? 0.06 * Math.min(4, t.parity || 0) : 0) + (spec.postpartum != null ? 0.35 * Math.exp(-spec.postpartum / 8) : 0);
  t.face = faceDraw(r, spread, sex, x.age, x.bmi);
  t.hipSpacing = spec.hipSpacing ?? 1;      // P1: the frame's hip joints on Harrington et al. 2007 (mix.js); 0 = MakeHuman's wide joints (lane A's cast)
  return t;
}
function jitterRaces(gm, r, spread) {
  const out = { african: 0, asian: 0, caucasian: 0 };
  for (const [g, w] of Object.entries(gm)) for (const [k, v] of Object.entries(RACE_OF[g] || RACE_OF.all)) out[k] += w * v;
  if (spread) { for (const k of Object.keys(out)) out[k] = Math.max(0, out[k] + 0.06 * gauss(r) * spread); }
  const s = out.african + out.asian + out.caucasian; for (const k of Object.keys(out)) out[k] /= s; return out;
}
// a face of the person's own: small seeded offsets around the group mean (averageness is the default; Langlois and Roggman 1990), facial
// adiposity from BMI (Coetzee et al. 2009), age in the head target, ears and nose that grow a little with age
const FACE = ['nose/nose-scale-vert-incr', 'nose/nose-scale-horiz-incr', 'nose/nose-hump-incr', 'nose/nose-point-width-incr', 'mouth/mouth-scale-horiz-incr', 'mouth/mouth-lowerlip-height-incr', 'mouth/mouth-upperlip-height-incr',
  'chin/chin-width-incr', 'chin/chin-prominent-incr', 'chin/chin-height-incr', 'cheek/l-cheek-bones-incr', 'eyebrows/eyebrows-trans-up', 'forehead/forehead-scale-vert-incr', 'head/head-oval', 'head/head-round', 'head/head-square'];
function faceDraw(r, spread, sex, age, bmi) {
  const f = {};
  if (spread) for (const k of FACE) { const v = 0.22 * gauss(r) * spread; if (k.startsWith('head/')) { if (v > 0) f[k] = v; } else { const dk = k.endsWith('-up') ? k.replace(/-up$/, '-down') : k.replace('-incr', '-decr'); if (v >= 0) f[k] = v; else f[dk] = -v; } }
  if (f['cheek/l-cheek-bones-incr'] != null) f['cheek/r-cheek-bones-incr'] = f['cheek/l-cheek-bones-incr'] * (0.9 + 0.2 * r());
  if (f['cheek/l-cheek-bones-decr'] != null) f['cheek/r-cheek-bones-decr'] = f['cheek/l-cheek-bones-decr'] * (0.9 + 0.2 * r());
  const fat = clamp((bmi - 25) / 14, -0.4, 0.75); if (fat > 0) f['head/head-fat-incr'] = fat; else f['head/head-fat-decr'] = -fat;
  f['head/head-age-incr'] = clamp((age - 32) / 55, 0, 0.75);
  const ear = clamp((age - 30) / 50, 0, 1) * 0.3; if (ear) { f['ears/l-ear-scale-incr'] = ear; f['ears/r-ear-scale-incr'] = ear; f['ears/l-ear-lobe-incr'] = ear; f['ears/r-ear-lobe-incr'] = ear; }
  if (age > 40) f['nose/nose-scale-vert-incr'] = (f['nose/nose-scale-vert-incr'] || 0) + clamp((age - 40) / 45, 0, 1) * 0.2;
  return f;
}
