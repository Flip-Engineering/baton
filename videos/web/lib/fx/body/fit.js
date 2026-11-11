// BODY / FIT (HUMAN c8 lane A): measure, then fit. A person's sampled measures (sampler.js) are reached by Levenberg-Marquardt on a
// few physically meaningful amounts, each one a layer of mix.js, with every evaluation a real build and a real measurement (measure.js):
//   fat     log amplitude of the person's own depot pattern          -> mass (from volume and body density)
//   tau     trunk vs gluteofemoral tilt of that pattern               -> waist (iliac crest) against hip
//   arm     arm-fat factor                                            -> mid-upper-arm circumference
//   thigh   thigh-depot factor                                        -> thigh circumference
//   breast  women: our mound beyond MakeHuman's cup (m); men: chest fat factor  -> bust / chest
//   troch   the trochanteric (lateral) depots against the gluteal (posterior) one   -> hip breadth at the same hip tape
//   shoulder, pelvis, flare, legs, head: the frame (MakeHuman shoulder-distance target, our pelvis breadth, our iliac flare, leg-length
//           targets, head scale) -> biacromial, bicristal, crotch height, head circumference
// The residuals are relative (per cent of the target), weighted, with a weak prior on each amount (the pattern the sampler drew), so a
// measure the mesh cannot reach is missed gracefully and reported, not forced. Statures are exact (the last uniform scale).
import { build, stageA } from './mix.js';
import { measure } from './measure.js';
import { DEPOT_GROUP } from './sampler.js';
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const FIT_PARAMS = ['fat', 'tau', 'fill', 'arm', 'thigh', 'breast', 'shoulder', 'pelvis', 'flare', 'troch', 'legs', 'head', 'musc', 'wdep'];
// P1 (3 Oct): wdep, the abdomen's forward depots (visceral, upper and lower abdomen) against the flank roll -> ANSUR waist depth vs breadth;
// the hip joints sit on Harrington's regression (frame.hipSpacing, mix.js) and ANSUR buttock depth joins the targets, so the hip tape is
// reached through a deeper, narrower hip section rather than MakeHuman's broad shallow one. A target without these (lane A's cast) fits as before.
const TRUNKY = new Set(['abdLower', 'abdUpper', 'visceral', 'flank', 'back', 'braLine', 'nape', 'chestFat']), GYN = new Set(['glute', 'troch', 'subtroch', 'innerThigh', 'kneeInner', 'thighFront']);
const THIGH = new Set(['subtroch', 'innerThigh', 'thighFront', 'kneeInner', 'genLeg']), FILL = new Set(['abdUpper', 'back', 'braLine']);
// the arm and thigh factors scale that limb's muscles with its fat (a mid-upper-arm tape is both), at half strength
const ARM_M = new Set(['deltoid', 'biceps', 'triceps', 'forearmExt', 'forearmFlex']), THIGH_M = new Set(['rectusFem', 'vastusLat', 'vastusMed', 'adductors', 'hamstrings']);
// how much each depot adds in trunk / legs / arms per unit amplitude (DXA's regions: the buttocks are partly 'trunk' above the femoral-neck cut)
const REGION_SPLIT = { glut: { trunk: 0.5, leg: 0.5 }, trunk: { trunk: 1 }, leg: { leg: 1 }, arm: { arm: 1 } };
function depotAreas(S) {
  if (S._depA) return S._depA;
  const t = S.tri, nb = S.nb, P = S.base, A = new Float32Array(nb);
  for (let i = 0; i < t.length; i += 3) { const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * 0.01 / 3; A[t[i]] += ar; A[t[i + 1]] += ar; A[t[i + 2]] += ar; }
  const out = {}; for (const d of Object.keys(DEPOT_GROUP)) { const f = S.field(d); let s = 0; if (f) for (let i = 0; i < f.ix.length; i++) if (f.ix[i] < nb) s += f.f[i] * A[f.ix[i]]; out[d] = s; }
  return (S._depA = out);
}
// the depot pattern scaled region by region so its added volume lands in the person's DXA shares (trunk : legs : arms)
export function dxaPattern(S, t) {
  const A = depotAreas(S), pat = t.fatPattern, vol = { trunk: 0, leg: 0, arm: 0 };
  for (const [d, w] of Object.entries(pat)) { const sp = REGION_SPLIT[DEPOT_GROUP[d]]; if (!sp) continue; for (const [r, k] of Object.entries(sp)) vol[r] += w * A[d] * k; }
  const tot = vol.trunk + vol.leg + vol.arm, want = { trunk: t.ftr, leg: t.fleg, arm: t.farm }, ws = want.trunk + want.leg + want.arm, sc = {};
  for (const r of Object.keys(vol)) sc[r] = vol[r] > 0 ? clamp(want[r] / ws * tot / vol[r], 0.4, 2.5) : 1;
  const out = {};
  for (const [d, w] of Object.entries(pat)) { const sp = REGION_SPLIT[DEPOT_GROUP[d]]; let k = 1; if (sp) { k = 0; for (const [r, f] of Object.entries(sp)) k += f * sc[r]; } out[d] = w * k; }
  return { pattern: out, scale: sc };
}
export function paramsFrom(t, th, pat) {
  const fat = {}, ef = Math.exp(th.fat);
  for (const [d, w] of Object.entries(pat)) { let a = w * ef; if (TRUNKY.has(d)) a *= Math.exp(th.tau); else if (GYN.has(d)) a *= Math.exp(-th.tau);
    if (FILL.has(d)) a *= Math.exp(th.fill); if (DEPOT_GROUP[d] === 'arm') a *= Math.exp(th.arm); if (d === 'troch' || d === 'subtroch') a *= Math.exp(th.troch || 0); else if (d === 'glute') a *= Math.exp(-0.5 * (th.troch || 0)); if (THIGH.has(d)) a *= Math.exp(th.thigh); if (d === 'chestFat' && t.sex === 'm') a *= Math.exp(th.breast); if (th.wdep) { if (d === 'visceral' || d === 'abdUpper' || d === 'abdLower') a *= Math.exp(th.wdep); else if (d === 'flank') a *= Math.exp(-th.wdep); } fat[d] = a; }
  const B = t.breast;
  return { sex: t.sex, age: t.age, races: t.races, mhMuscle: t.mhMuscle, mhWeight: t.mhWeight, cup: B ? B.cup ?? 0 : 0, firm: B ? B.firm ?? 0 : 0,
    breastShape: B ? { splay: B.splay, trans: B.trans, volVert: -0.12 * B.ptosis } : null, face: t.face,
    frame: { waist: clamp(0.6 * th.fill, -1, 1), shoulder: th.shoulder, pelvis: Math.exp(th.pelvis), flare: th.flare || 0, legs: th.legs, head: Math.exp(th.head), upperarm: t.frame?.upperarm || 0, lowerarm: t.frame?.lowerarm || 0, valgus: t.frame?.valgus || 0, ...(t.hipSpacing ? { hipSpacing: t.hipSpacing } : {}) },
    muscle: Object.fromEntries(Object.entries(t.muscle).map(([k, v]) => [k, v * Math.exp(th.musc + (ARM_M.has(k) ? th.arm : 0) + (THIGH_M.has(k) ? th.thigh : 0))])), fat, breast: B ? { mound: Math.max(0, th.breast), sag: B.sag || 0 } : null, laxity: t.laxity, preg: t.preg ? { week: t.preg.week, postpartumMonths: t.preg.postpartumMonths } : null,
    stature: t.stature, relief: t.relief ?? 1, ...(t.form ? { form: t.form, pf: Math.round(t.pf * 1e4) / 1e4 } : {}) };
}
const PW = { fat: 0.02, tau: 0.1, fill: 0.1, arm: 0.1, thigh: 0.1, breast: 0.1, shoulder: 0.04, pelvis: 0.04, flare: 0.04, troch: 0.1, legs: 0.04, head: 0.04, musc: 0.15, wdep: 0.1 };
// FORM 1 (3 Oct): the levers that reshape the body LOCALLY (trunk vs hips, the trochanters, thighs, arms, the waist fill, the abdomen's
// depth, the pelvis) are held nearer the drawn pattern: a cm or two of tape is missed rather than bought with a local bulge.
const PW1 = { ...PW, tau: 0.15, fill: 0.15, troch: 0.25, wdep: 0.12, pelvis: 0.1, flare: 0.08 };
const W = { mass: 4, waist: 2.5, naturalWaist: 1.6, hip: 2.5, bust: 1.6, muac: 1.2, thigh: 1.0, biacromial: 1.0, bicristal: 0.8, hipBreadth: 1.0, crotch: 3, headCirc: 1.2, buttockDepth: 1.0, waistDepth: 0.8, waistBreadth: 0.6 };
export function fitPerson(S, t, { iters = 10, verbose = false, theta0 = null } = {}) {
  const t0 = Date.now(), { pattern } = dxaPattern(S, t), sex = t.sex;
  const th0 = theta0 || { fat: Math.log(clamp((t.bmi - (sex === 'f' ? 19 : 20)) / 9, 0.03, 4)), tau: 0, fill: 0, arm: 0, thigh: 0, breast: sex === 'f' ? (t.breast?.mound0 ?? 0) : 0, shoulder: 0, pelvis: 0, flare: 0, troch: 0, legs: 0, head: 0, musc: 0, wdep: 0 };
  const prior = { ...th0 }, sig = { fat: 3, tau: 0.6, fill: 0.8, arm: 0.7, thigh: 0.7, breast: sex === 'f' ? 0.015 : 0.8, shoulder: 1.5, pelvis: 0.15, flare: 0.25, troch: 0.5, legs: 1.2, head: 0.08, musc: 0.35, wdep: 0.5 };
  const lo = { fat: -6, tau: -1.6, fill: -2, arm: -1.6, thigh: -1.6, breast: sex === 'f' ? 0 : -2, shoulder: -1.6, pelvis: -0.15, flare: -0.2, troch: -1.2, legs: -1, head: -0.12, musc: -1.2, wdep: -1.2 }, hi = { fat: 2.6, tau: 1.6, fill: 2, arm: 1.6, thigh: 1.6, breast: sex === 'f' ? Math.max(0.09, (t.breast?.mound0 ?? 0) + 0.04) : 2, shoulder: 2, pelvis: 0.22, flare: 0.4, troch: 1, legs: 1, head: 0.12, musc: 0.6, wdep: 1.2 };
  const step = { fat: 0.08, tau: 0.08, fill: 0.08, arm: 0.08, thigh: 0.08, breast: sex === 'f' ? 0.002 : 0.08, shoulder: 0.08, pelvis: 0.01, flare: 0.02, troch: 0.08, legs: 0.06, head: 0.01, musc: 0.06, wdep: 0.08 };
  const keys = FIT_PARAMS.filter(k => !(k === 'breast' && sex === 'm' && !pattern.chestFat) && !(k === 'wdep' && t.waistDepth == null));
  const VA = stageA(S, paramsFrom(t, th0, pattern));
  const tg = { mass: t.mass, waist: t.waist, naturalWaist: t.naturalWaist, hip: t.hip, bust: t.bust, muac: t.muac, thigh: t.thigh, biacromial: t.biacromial, bicristal: t.bicristal, hipBreadth: t.hipBreadth, crotch: t.crotch, headCirc: t.headCirc, buttockDepth: t.buttockDepth, waistDepth: t.waistDepth, waistBreadth: t.waistBreadth };
  let evals = 0;
  const evalT = th => { evals++; const p = paramsFrom(t, th, pattern), B = build(S, p, VA), m = measure(S, B, { sex, pf: t.pf, age: t.age, quick: true }); return { p, B, m }; };
  const resid = (th, m) => { const r = [];
    for (const [k, w] of Object.entries(W)) { if (tg[k] == null || m[k] == null || !isFinite(m[k])) continue; r.push(w * (m[k] - tg[k]) / tg[k]); }
    const pw = t.form >= 1 ? PW1 : PW; for (const k of keys) r.push((th[k] - prior[k]) / sig[k] * (pw[k] ?? 0.1));
    return r; };
  let th = { ...th0 }, cur = evalT(th), r = resid(th, cur.m), cost = r.reduce((s, x) => s + x * x, 0), lam = 0.01;
  for (let it = 0; it < iters; it++) {
    const Jc = keys.map(k => { const t2 = { ...th }; t2[k] = clamp(th[k] + step[k], lo[k], hi[k]); if (t2[k] === th[k]) t2[k] = th[k] - step[k]; const e = evalT(t2), r2 = resid(t2, e.m), h = t2[k] - th[k]; return r2.map((x, i) => (x - r[i]) / h); });
    const n = keys.length, A = keys.map((_, i) => keys.map((_, j) => Jc[i].reduce((s, x, q) => s + x * Jc[j][q], 0))), g = keys.map((_, i) => Jc[i].reduce((s, x, q) => s + x * r[q], 0));
    let improved = false;
    for (let tries = 0; tries < 5; tries++) {
      const M = A.map((row, i) => row.map((x, j) => x + (i === j ? lam * (A[i][i] + 1e-6) : 0))), d = solve(M, g.map(x => -x)), t2 = { ...th };
      keys.forEach((k, i) => t2[k] = clamp(th[k] + d[i], lo[k], hi[k]));
      const e = evalT(t2), r2 = resid(t2, e.m), c2 = r2.reduce((s, x) => s + x * x, 0);
      if (c2 < cost) { th = t2; cur = e; r = r2; const gain = cost - c2; cost = c2; lam = Math.max(1e-4, lam / 3); improved = true; if (verbose) console.log(`  it ${it} cost ${cost.toFixed(5)} lam ${lam.toExponential(1)}`); if (gain < 1e-6) it = iters; break; }
      lam *= 4;
    }
    if (!improved) break;
  }
  const err = {}; for (const k of Object.keys(W)) if (tg[k] != null && cur.m[k] != null) err[k] = +((cur.m[k] - tg[k]) / tg[k] * 100).toFixed(1);
  return { theta: th, params: cur.p, built: cur.B, quick: cur.m, errPct: err, cost, evals, ms: Date.now() - t0, pattern };
}
function solve(A, b) { const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) { let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k; [M[i], M[p]] = [M[p], M[i]]; const d = M[i][i] || 1e-12;
    for (let j = i; j <= n; j++) M[i][j] /= d; for (let k = 0; k < n; k++) if (k !== i) { const f = M[k][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; } }
  return M.map(r => r[n]); }
