// BODY / PRIOR (HUMAN c8 PRIOR, 3 Oct 2026): a LEARNED shape prior under castBody, opt-in. Our shape space is hand-built (MakeHuman
// hm08 targets + lane A's fields, fitted to tape measures); this one is learned from real body scans: MHR, Meta's Momentum Human Rig
// (Nov 2025, Apache-2.0, github.com/facebookresearch/MHR), its 20 body and 20 head identity directions carried onto OUR hm08 topology
// (videos/sources/body/mhr/register.py: MHR posed and proportioned onto hm08's bind skeleton with its own rig, hm08 registered onto it
// non-rigidly, the directions resampled; assets/body/prior_mhr.{json,bin}, 3 MB). Nothing imports this file unless it asks: castBody,
// loadCast and every existing person, scene and hero render exactly as before.
//
//   import { loadPrior, castPrior, priorPerson } from '../lib/fx/body/prior.js';
//   const P = await loadPrior(S);                                   // S = await loadBodyStudio()
//   const p = castPrior(S, P, { sex: 'f', age: 34, group: 'black', bmiPct: 0.4, seed: 3 });   // the castBody spec, same targets
//   const p = castPrior(S, P, spec, { topUp: true, relief: 0, head: { gamma, averageness, symmetry, dimorphism } });
//   p.prior = { model: 'mhr', beta[20], gamma[20], frame, misses, topUp, cost, ms }; p.measures, p.errPct, p.kin, p.landmarks as castBody
//   priorPerson(S, P, rec)       // rebuild a stored record (person() alone would rebuild it WITHOUT the prior)
//   const Q = await loadPrior(S, { model: 'soma' }); castPrior(S, Q, spec, { topUp: true })   // BASE c2: NVIDIA SOMA (fitSoma below)
//
// What a prior person is made of:
//   BODY (everything but the head, neck and feet) = MHR's identity 0 + sum beta_k D_k on our topology. MHR's identity drives the surface
//     only (its skeleton is set by separate bone-length parameters), so the SKELETON and proportions stay lane A's: the hm08 bind
//     skeleton, lane A's frame levers (shoulder breadth, pelvis, legs, head scale, hip-joint spacing) and the stature (the last scale).
//   HEAD, NECK, FEET = hm08's own (lane A's macro head for sex, age and group, P2's face targets), positioned by a harmonic extension of
//     MHR's displacement; MHR's mitten-like feet and its face do not register cleanly onto hm08's toes, closed eye sockets and mouth.
//     The 20 head directions are sampled on the head (smoothly, band-limited): head SHAPE (skull, jaw, cheeks, overall proportions),
//     not features; P2's forms and lane B's skin go on top as before.
//   FIT: Levenberg-Marquardt on beta (20) + the frame levers against lane A's target measures (mass from volume, crest waist, natural
//     waist, hip, bust, MUAC, thigh, biacromial, bicristal, hip breadth, crotch height, head circumference, buttock / waist depth and
//     breadth): every evaluation a real build + measure. beta is held to MHR's learned distribution (zero mean, unit variance: a person
//     is the most typical body that wears those measures). MHR's space is ONE space for both sexes and beta_1 is its sex axis (read off
//     the components on our topology: -2 a man, 0 androgynous, +1.5..+2 a woman's breasts, hips and pubic contour), so beta_1 is held to
//     its sex's side: women mean +1.8 (bounds +1.3..+3.2), men -1.5 (-3.2..-0.6), sd 0.3 (OUR reading, by eye: the first fit with a
//     loose prior let slim women drift to 0 and look male). No muscle, fat or relief layers.
//   TOP-UP (opt-in, topUp: true): lane A's broad depots (genTrunk, genLeg, genArm, the lower + upper abdomen, signed; women: the breast
//     mound) add only what the measures still miss after the learned fit, against lane A's own tape weights (the crest waist and the
//     abdomen's depth, which the learned fit holds loosely), each held near zero (a few mm), so the learned surface stays smooth.
import { build, stageA } from './mix.js';
import { measure } from './measure.js';
import { kinematics } from './kin.js';
import { sampleTargets } from './sampler.js';
import { person, castBody, skinHint, SUPPORTS } from './person.js';
import * as R7 from './rev7.js';      // rev 7 (BODY7): the calibrated tissue top-up (castPrior: on with the top-up) and params.frame.hand|foot
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const PRIOR_VERSION = 1;
const _priors = new Map();
// model: 'mhr' (BASE c1, the default) or 'soma' (BASE c2: NVIDIA SOMA, assets/body/prior_soma.{json,bin}); each cached on its own
export async function loadPrior(S, { model = 'mhr', url = new URL('../../../assets/body/', import.meta.url).href, force = false } = {}) {
  const c = _priors.get(model); if (c && !force && c._S === S) return c;
  const [J, bin] = await Promise.all([fetch(url + `prior_${model}.json`).then(r => r.json()), fetch(url + `prior_${model}.bin`).then(r => r.arrayBuffer())]);
  const n = J.n, comp = c => { const ix = new Uint16Array(bin, c.o, c.k), q = new Int16Array(bin, c.o + ((c.k * 2 + 3) & ~3), c.k * 3), d = new Float32Array(c.k * 3); for (let i = 0; i < d.length; i++) d[i] = q[i] * c.s; return { ix, d }; };
  const P = { meta: J, n, nb: J.nb, mean: new Float32Array(bin, J.mean.o, n * 3), body: J.comps.body.map(comp), head: J.comps.head.map(comp), hand: J.comps.hand.map(comp),
    headW: Float32Array.from(new Uint8Array(bin, J.headW.o, n), x => x / 255), mirror: new Uint16Array(bin, J.mirror.o, n), dimorphism: J.headDimorphism?.gamma || null, _S: S,
    model: J.model || model, sexAxis: J.sexAxis || null };
  if (n !== S.n) throw new Error(`prior topology ${n} != studio ${S.n}`);
  _priors.set(model, P); return P;
}
const addComps = (V, comps, w) => { for (let k = 0; k < comps.length; k++) { const a = w?.[k]; if (!a) continue; const { ix, d } = comps[k]; for (let i = 0; i < ix.length; i++) { const q = ix[i] * 3; V[q] += a * d[i * 3]; V[q + 1] += a * d[i * 3 + 1]; V[q + 2] += a * d[i * 3 + 2]; } } };
// the head coefficients after P2's controls, reinterpreted on the learned space: averageness shrinks toward MHR's mean head,
// dimorphism moves along the MakeHuman male - female direction expressed in MHR's head space (+ more male), symmetry is applied to
// the displacement in priorVA (the mirror map)
export function headGamma(P, { gamma = null, averageness = 0, dimorphism = 0 } = {}) {
  const g = new Float32Array(20); if (gamma) for (let k = 0; k < 20; k++) g[k] = gamma[k] || 0;
  const s = 1 - clamp(averageness, 0, 1); for (let k = 0; k < 20; k++) g[k] *= s;
  if (dimorphism && P.dimorphism) for (let k = 0; k < 20; k++) g[k] += dimorphism * 0.25 * P.dimorphism[k];
  return g;
}
// the frame before soft tissue, in MakeHuman decimetres (what stageA returns): MHR's body at beta, hm08's / lane A's head laid back
// on the head weight (its translation from the base taken out, so it sits on MHR's neck), the head directions, symmetry
export function priorVA(S, P, params, { beta, gamma = null, hand = null, symmetry = 0, VA0 = null } = {}) {
  const n = S.n, V = new Float32Array(n * 3), B = S.base, M = P.mean;
  for (let i = 0; i < n * 3; i++) V[i] = B[i] + M[i];
  addComps(V, P.body, beta); if (hand) addComps(V, P.hand, hand);
  const A = VA0 || stageA(S, params), w = P.headW;                 // lane A's own head (macro head + P2/lane A face targets)
  let tx = 0, ty = 0, tz = 0, sw = 0; for (let v = 0; v < n; v++) { const k = w[v]; if (k < 0.99) continue; tx += A[v * 3] - B[v * 3]; ty += A[v * 3 + 1] - B[v * 3 + 1]; tz += A[v * 3 + 2] - B[v * 3 + 2]; sw++; }
  if (sw) { tx /= sw; ty /= sw; tz /= sw; }
  const H = new Float32Array(n * 3);                                // the head's own displacement (lane A detail + MHR head directions)
  for (let v = 0; v < n; v++) { const k = w[v]; if (!k) continue; H[v * 3] = k * (A[v * 3] - B[v * 3] - tx); H[v * 3 + 1] = k * (A[v * 3 + 1] - B[v * 3 + 1] - ty); H[v * 3 + 2] = k * (A[v * 3 + 2] - B[v * 3 + 2] - tz); }
  if (gamma) addComps(H, P.head, gamma);
  if (symmetry) { const m = P.mirror, s = clamp(symmetry, 0, 1), H2 = new Float32Array(H);
    for (let v = 0; v < n; v++) { const u = m[v], k = w[v]; if (!k) continue; const mx = -H[u * 3], my = H[u * 3 + 1], mz = H[u * 3 + 2]; H2[v * 3] += s * 0.5 * (mx - H[v * 3]); H2[v * 3 + 1] += s * 0.5 * (my - H[v * 3 + 1]); H2[v * 3 + 2] += s * 0.5 * (mz - H[v * 3 + 2]); }
    H.set(H2); }
  for (let i = 0; i < n * 3; i++) V[i] += H[i];
  const fr = params?.frame; if (fr && (fr.hand || fr.foot)) return R7.scaleExtremities(S, V, { hand: fr.hand, foot: fr.foot });     // rev 7: the prior's hands and feet scaled to ANSUR (a record without it is untouched)
  return V;
}
// lane A's parameters, the soft layers switched off (the learned surface carries them), the frame from the fit
// lane A's layers that live on the kept head and neck stay as lane A fitted them (the face's fat, the submental and neck depots, the
// sternocleidomastoid): without them the face is not the same face (the lips and cheeks thinned at 1:1)
const HEAD_FAT = ['faceFat', 'submental', 'genHead', 'neckFat'], HEAD_MUSCLE = ['scm'];
const pick = (o, ks) => Object.fromEntries(ks.filter(k => o?.[k]).map(k => [k, o[k]]));
function priorParams(t, base, th, topUp, extra = null, r7 = null) {
  const p = { ...base, frame: { ...base.frame, shoulder: th.shoulder, pelvis: Math.exp(th.pelvis), legs: th.legs, head: Math.exp(th.head), flare: 0, waist: 0 }, muscle: pick(base.muscle, HEAD_MUSCLE), fat: pick(base.fat, HEAD_FAT), breast: null, laxity: base.laxity, relief: th.relief ?? 0 };
  if (extra) { Object.assign(p.frame, extra.frame || {}); if (extra.form != null) { p.form = extra.form; p.pf = t.pf ?? base.pf; } }
  if (topUp) { p.fat = { ...p.fat, genTrunk: th.uTrunk || 0, genLeg: th.uLeg || 0, genArm: th.uArm || 0, abdLower: th.uAbd || 0, abdUpper: 0.6 * (th.uAbd || 0) }; if (t.sex === 'f' && th.uBreast > 0) p.breast = { mound: th.uBreast, sag: 0 }; }
  if (r7) R7.shape7(p, t, th, { prior: true });                    // rev 7: muscle surplus, shoulder baseline, softness, and the fitted levers (uHip, uWst; uDelt retired in 7.3)
  // rev 7.3 (BODY7 iteration 2): the rev 7 tissue is laid in the TOP-UP stage only (evalT passes r7 when tu): stage 1 (the learned betas and the frame levers: the bones) is then v6's own solution, to the digit, so a rev 7 body is the v6 person
  // plus a tissue delta (7.2 laid it in stage 1 too and the bones re-fitted around it: every beta moved, men 5-8 mm shorter; measurer it1 section 4)
  return p;
}
// the tapes a tailor and a survey take, and the bony breadths; the section depths and breadths P1 added (buttock depth, waist depth and
// breadth) and the hip breadth are left to the learned shape at a low weight: on the registered surface their landmark-defined levels
// slide (the NICP holds the face, not the iliac crests), and pulling on them dragged the women's fits toward MHR's androgynous middle.
// The crest waist (NHANES) is held loosely too: on MHR's women the girth at hm08's crest level runs 10-20 % over NHANES at a matched
// mass (the female hip shelf starts higher on MHR's surface than on hm08's pelvis), so the natural waist carries the waist instead
const W = { mass: 4, waist: 0.4, naturalWaist: 2.2, hip: 2.5, bust: 2.0, muac: 0.6, thigh: 1.0, biacromial: 1.0, bicristal: 0.3, hipBreadth: 0.3, crotch: 3, headCirc: 1.2, buttockDepth: 0.2, waistDepth: 0.2, waistBreadth: 0.2 };
// the top-up (lane A's layers) answers to lane A's own weights: the crest waist and the abdomen's depth are what it is for
const W2 = { mass: 4, waist: 2.5, naturalWaist: 1.6, hip: 2.5, bust: 1.6, muac: 1.2, thigh: 1.0, biacromial: 1.0, bicristal: 0.3, hipBreadth: 0.3, crotch: 3, headCirc: 1.2, buttockDepth: 0.6, waistDepth: 0.8, waistBreadth: 0.6 };
const TG = Object.keys(W);
function lm(keys, th0, evalR, { lo, hi, step, iters }) {
  let th = { ...th0 }, cur = evalR(th), cost = cur.r.reduce((s, x) => s + x * x, 0), lam = 0.01, evals = 1;
  for (let it = 0; it < iters; it++) {
    const Jc = keys.map(k => { const t2 = { ...th }; t2[k] = clamp(th[k] + step[k], lo[k], hi[k]); if (t2[k] === th[k]) t2[k] = th[k] - step[k]; const e = evalR(t2); evals++; const h = t2[k] - th[k]; return e.r.map((x, i) => (x - cur.r[i]) / h); });
    const n = keys.length, A = keys.map((_, i) => keys.map((_, j) => Jc[i].reduce((s, x, q) => s + x * Jc[j][q], 0))), g = keys.map((_, i) => Jc[i].reduce((s, x, q) => s + x * cur.r[q], 0));
    let improved = false;
    for (let tries = 0; tries < 5; tries++) {
      const M = A.map((row, i) => row.map((x, j) => x + (i === j ? lam * (A[i][i] + 1e-6) : 0))), d = solve(M, g.map(x => -x)), t2 = { ...th };
      keys.forEach((k, i) => t2[k] = clamp(th[k] + d[i], lo[k], hi[k]));
      const e = evalR(t2); evals++; const c2 = e.r.reduce((s, x) => s + x * x, 0);
      if (c2 < cost) { const gain = cost - c2; th = t2; cur = e; cost = c2; lam = Math.max(1e-4, lam / 3); improved = true; if (gain < 1e-6) it = iters; break; }
      lam *= 4;
    }
    if (!improved) break;
  }
  return { th, cur, cost, evals };
}
function solve(A, b) { const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) { let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k; [M[i], M[p]] = [M[p], M[i]]; const d = M[i][i] || 1e-12;
    for (let j = i; j <= n; j++) M[i][j] /= d; for (let k = 0; k < n; k++) if (k !== i) { const f = M[k][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; } }
  return M.map(r => r[n]); }
// fit the learned body to a target set t (lane A's sampleTargets output). base: lane A's parameter set for the same person (sex, age,
// races, face, frame.hipSpacing, laxity, preg, stature); from castBody's fit when given, else a neutral one.
export function fitPrior(S, P, t, base, opts = {}) {
  return P.model === 'soma' ? fitSoma(S, P, t, base, opts) : fitMhr(S, P, t, base, opts);
}
function fitMhr(S, P, t, base, { iters = 10, nBeta = 20, topUp = false, head = {}, relief = 0, rev7 = null } = {}) {
  const t0 = Date.now(), sex = t.sex, VA0 = stageA(S, base), gamma = headGamma(P, head), bk = [...Array(nBeta).keys()].map(k => 'b' + k);
  const r7 = rev7 || null, T7 = r7 ? (t.rev7 || R7.targets7(t)) : null, r7res = e => r7 ? R7.resid7(T7, R7.frontal7(S, e.B, e.m), r7.w || R7.W7) : [], X7 = r7 ? R7.LEVERS7 : null;
  const bMean = k => k === 1 ? (sex === 'f' ? 1.8 : -1.5) : 0, bSd = k => k === 1 ? 0.3 : 1;
  const tg = Object.fromEntries(TG.map(k => [k, t[k]]));
  let evals = 0;
  const evalT = (th, tu) => { evals++; const beta = bk.map((k, i) => th[k]); const VA = priorVA(S, P, base, { beta, gamma, symmetry: head.symmetry || 0, VA0 }), p = priorParams(t, base, { ...th, relief }, tu, null, tu ? r7 : null), B = build(S, p, VA), m = measure(S, B, { sex, pf: t.pf, age: t.age, quick: true }); return { p, B, m, VA, beta }; };
  const resid = (m, th, keys, mean, sd, pw, Wt = W) => { const r = []; for (const k of TG) { if (tg[k] == null || m[k] == null || !isFinite(m[k])) continue; r.push(Wt[k] * (m[k] - tg[k]) / tg[k]); } for (const k of keys) r.push((th[k] - mean[k]) / sd[k] * pw[k]); return r; };
  // 1. the learned fit: beta + the frame
  const fk = ['shoulder', 'pelvis', 'legs', 'head'], keys = [...bk, ...fk];
  const mean = { ...Object.fromEntries(bk.map((k, i) => [k, bMean(i)])), shoulder: 0, pelvis: 0, legs: 0, head: 0 }, sd = { ...Object.fromEntries(bk.map((k, i) => [k, bSd(i)])), shoulder: 1.5, pelvis: 0.15, legs: 1.2, head: 0.08 };
  const pw = { ...Object.fromEntries(bk.map(k => [k, 0.06])), shoulder: 0.04, pelvis: 0.06, legs: 0.04, head: 0.04 };
  const lo = { ...Object.fromEntries(bk.map(k => [k, -3.5])), shoulder: -1.6, pelvis: -0.15, legs: -1, head: -0.12 }, hi = { ...Object.fromEntries(bk.map(k => [k, 3.5])), shoulder: 2, pelvis: 0.22, legs: 1, head: 0.12 };
  if (sex === 'f') { lo.b1 = 1.3; hi.b1 = 3.2; } else { lo.b1 = -3.2; hi.b1 = -0.6; }
  const step = { ...Object.fromEntries(bk.map(k => [k, 0.15])), shoulder: 0.08, pelvis: 0.01, legs: 0.06, head: 0.01 };
  const th0 = { ...mean, b0: clamp(((t.bmi || 24) - 26) / 4, -2.5, 2.5) };   // b0 is MHR's adiposity axis (lean - heavy); a start, not a prior
  const R1 = lm(keys, th0, th => { const e = evalT(th, false); return { ...e, r: resid(e.m, th, keys, mean, sd, pw) }; }, { lo, hi, step, iters });   // the bones (stage 1) answer ANSUR's tapes and bony breadths only; the photographs' widths are the tissue's (stage 2)
  let th = R1.th, cur = R1.cur;
  const miss = m => Object.fromEntries(TG.filter(k => tg[k] != null && m[k] != null).map(k => [k, +((m[k] - tg[k]) / tg[k] * 100).toFixed(1)]));
  const learnedMiss = miss(cur.m);
  // 2. the top-up: lane A's broad depots (metres along the normal) and the women's mound, only what the measures still ask
  if (topUp) {
    const uk = ['uTrunk', 'uLeg', 'uArm', 'uAbd', ...(sex === 'f' ? ['uBreast'] : []), ...(X7 ? X7.keys : [])], um = Object.fromEntries(uk.map(k => [k, 0])), us = { uTrunk: 0.004, uLeg: 0.004, uArm: 0.003, uAbd: 0.008, uBreast: 0.01, ...(X7 ? X7.sd : {}) }, upw = { ...Object.fromEntries(uk.map(k => [k, 0.2])), ...(X7 ? { ...X7.pw, ...X7.upw } : {}) };
    const R2 = lm(uk, { ...th, ...um }, th2 => { const e = evalT(th2, true); return { ...e, r: resid(e.m, th2, uk, um, us, upw, W2).concat(r7res(e)) }; }, { lo: { uTrunk: -0.01, uLeg: -0.01, uArm: -0.006, uAbd: -0.02, uBreast: 0, ...(X7 ? X7.lo : {}) }, hi: { uTrunk: 0.015, uLeg: 0.012, uArm: 0.008, uAbd: 0.015, uBreast: 0.04, ...(X7 ? X7.hi : {}) }, step: { uTrunk: 0.001, uLeg: 0.001, uArm: 0.001, uAbd: 0.0015, uBreast: 0.002, ...(X7 ? X7.step : {}) }, iters: 6 });
    th = R2.th; cur = R2.cur;
  }
  return { theta: th, beta: cur.beta, gamma: Array.from(gamma), params: cur.p, built: cur.B, VA: cur.VA, quick: cur.m, errPct: miss(cur.m), learnedMiss, evals, ms: Date.now() - t0 };
}
// SOMA (BASE c2, 3 Oct): NVIDIA SOMA's 128-direction PCA (SizeUSA + TripleGangers scans; assets/body/prior_soma.*, the first 32 shipped)
// on our topology. Unlike MHR, SOMA's identity carries stature and PROPORTIONS (limb lengths, shoulder and pelvis breadth): the learned
// space does the frame's work, so lane A's frame levers are held near 0 (head scale free, legs and shoulder on short leashes, pelvis and
// hip spacing off) and the stature is exact by the last scale as before. Lane A's body landmarks were held in the registration, so the
// crest waist, the depths and the bony breadths are fitted at lane A's own weights (WS). Sex: SOMA has one space for both sexes; its
// sex axis (sexAxis: SOMA's first component, stature and sex together; OUR reading by eye) holds a woman near -1.0 and a man near
// +0.9, moved 0.04 a cm of stature and kept on the sex's side (sd 0.3; a free fit let the men drift to the androgynous middle and
// read wide-hipped, the women flat-chested). Top-up (opt-in) as for MHR but through FORM's form-1 soft tissue (low-passed depots): the learned surface and FORM's smooth
// field compose (the learned shape carries the person, the low-passed depots only the tape residue).
// bicristal at 0.1: lane A measures it on the frame BEFORE soft tissue minus its own depot fat; a learned surface already carries the
// person's fat over the crests, so the landmark breadth reads 9-13 % over the caliper target on any SOMA body (a definition gap)
const WS = { mass: 4, waist: 2.0, naturalWaist: 1.6, hip: 2.5, bust: 2.0, muac: 1.0, thigh: 1.0, biacromial: 1.0, bicristal: 0.1, hipBreadth: 0.4, crotch: 3, headCirc: 1.2, buttockDepth: 0.5, waistDepth: 0.7, waistBreadth: 0.5 };
function fitSoma(S, P, t, base, { iters = 12, nBeta = 24, topUp = false, relief = 0, sexSd: sexSdOpt = null, form = 1, priorW = 0.06, lean = null, rev7 = null } = {}) {
  let sexSd = sexSdOpt ?? 0.5;
  const r7 = rev7 || null, T7 = r7 ? (t.rev7 || R7.targets7(t)) : null, r7res = e => r7 ? R7.resid7(T7, R7.frontal7(S, e.B, e.m), r7.w || R7.W7) : [], X7 = r7 ? R7.LEVERS7 : null;
  const t0 = Date.now(), sex = t.sex, VA0 = stageA(S, base), bk = [...Array(Math.min(nBeta, P.body.length)).keys()].map(k => 'b' + k);
  const ax = P.sexAxis, u = ax?.u || null, extra = { form };   // lane A's hip spacing (P1's Harrington stance) kept: SOMA stands on hm08's MakeHuman-wide hip joints like ours does
  // the sex's point on u for this stature (taller women and men sit further toward + on SOMA's first component; the range keeps each
  // on its own side); sexSd from the asset unless given
  const sT = !ax ? 0 : clamp(ax[sex] + (ax.perCm || 0) * ((t.stature || 1.7) * 100 - (ax.stature?.[sex] ?? 170)), ...(ax.range?.[sex] || [-9, 9]));
  if (ax?.sd && sexSdOpt == null) sexSd = ax.sd;
  const tg = Object.fromEntries(TG.map(k => [k, t[k]]));
  let evals = 0;
  const evalT = (th, tu) => { evals++; const beta = bk.map(k => th[k]); const VA = priorVA(S, P, base, { beta, VA0 }), p = priorParams(t, base, { ...th, relief }, tu, extra, tu ? r7 : null), B = build(S, p, VA), m = measure(S, B, { sex, pf: t.pf, age: t.age, quick: true }); return { p, B, m, VA, beta }; };
  const sexOf = th => { let s = 0; if (u) for (let i = 0; i < bk.length && i < u.length; i++) s += u[i] * th[bk[i]]; return s; };
  const resid = (m, th, keys, mean, sd, pw) => { const r = []; for (const k of TG) { if (tg[k] == null || m[k] == null || !isFinite(m[k])) continue; r.push(WS[k] * (m[k] - tg[k]) / tg[k]); }
    for (const k of keys) r.push((th[k] - mean[k]) / sd[k] * pw[k]); if (u) r.push(0.15 * (sexOf(th) - sT) / sexSd); return r; };
  const fk = ['legs', 'shoulder', 'head'], keys = [...bk, ...fk];
  const mean = { ...Object.fromEntries(bk.map(k => [k, 0])), legs: 0, shoulder: 0, head: 0 }, sd = { ...Object.fromEntries(bk.map(k => [k, 1])), legs: 0.4, shoulder: 0.6, head: 0.08 };
  const pw = { ...Object.fromEntries(bk.map(k => [k, priorW])), legs: 0.04, shoulder: 0.04, head: 0.04 };
  const lo = { ...Object.fromEntries(bk.map(k => [k, -3.5])), legs: -1, shoulder: -1.6, head: -0.12 }, hi = { ...Object.fromEntries(bk.map(k => [k, 3.5])), legs: 1, shoulder: 2, head: 0.12 };
  const step = { ...Object.fromEntries(bk.map(k => [k, 0.15])), legs: 0.06, shoulder: 0.08, head: 0.01 };
  // lean (opt-in): SOMA's second component is adiposity (- soft / heavy, + lean, muscle showing); holding it toward + at the same tapes
  // asks for the leaner, more trained body that wears them (OUR lever for an active cast; the scan population's mean is softer)
  if (lean != null && bk.includes('b1')) mean.b1 = lean;
  const th0 = { ...mean, pelvis: 0 }; if (u) bk.forEach((k, i) => th0[k] = clamp(sT * (u[i] || 0) + (k === 'b1' ? mean.b1 : 0), -3, 3));   // start at the sex's point on u
  const R1 = lm(keys, th0, th => { const e = evalT(th, false); return { ...e, r: resid(e.m, th, keys, mean, sd, pw) }; }, { lo, hi, step, iters });   // the bones (stage 1) answer ANSUR's tapes and bony breadths only; the photographs' widths are the tissue's (stage 2)
  let th = R1.th, cur = R1.cur;
  const miss = m => Object.fromEntries(TG.filter(k => tg[k] != null && m[k] != null).map(k => [k, +((m[k] - tg[k]) / tg[k] * 100).toFixed(1)]));
  const learnedMiss = miss(cur.m);
  if (topUp) {
    const uk = ['uTrunk', 'uLeg', 'uArm', 'uAbd', ...(sex === 'f' ? ['uBreast'] : []), ...(X7 ? X7.keys : [])], um = Object.fromEntries(uk.map(k => [k, 0])), us = { uTrunk: 0.004, uLeg: 0.004, uArm: 0.003, uAbd: 0.008, uBreast: 0.01, ...(X7 ? X7.sd : {}) }, upw = { ...Object.fromEntries(uk.map(k => [k, 0.08])), ...(X7 ? { ...X7.pw, ...X7.upw } : {}) };   // looser than MHR's 0.2: FORM's low-passed depots stay smooth at a cm
    const R2 = lm(uk, { ...th, ...um }, th2 => { const e = evalT(th2, true); return { ...e, r: resid(e.m, th2, uk, um, us, upw).concat(r7res(e)) }; }, { lo: { uTrunk: -0.01, uLeg: -0.01, uArm: -0.006, uAbd: -0.02, uBreast: 0, ...(X7 ? X7.lo : {}) }, hi: { uTrunk: 0.015, uLeg: 0.012, uArm: 0.008, uAbd: 0.015, uBreast: 0.04, ...(X7 ? X7.hi : {}) }, step: { uTrunk: 0.001, uLeg: 0.001, uArm: 0.001, uAbd: 0.0015, uBreast: 0.002, ...(X7 ? X7.step : {}) }, iters: 6 });
    th = R2.th; cur = R2.cur;
  }
  return { theta: th, beta: cur.beta, gamma: [], params: cur.p, built: cur.B, VA: cur.VA, quick: cur.m, errPct: miss(cur.m), learnedMiss, sex: +sexOf(th).toFixed(3), evals, ms: Date.now() - t0 };
}
// a person through the prior: the castBody spec -> lane A's targets (the same draw) -> the learned fit -> measures, kin, a hero data object
export function castPrior(S, P, spec = {}, opts = {}) {
  const t = sampleTargets(S.pop, spec), seed = spec.seed ?? 1;
  const base = opts.base || castBody(S, spec).params;          // lane A's fit gives the head's own layers, face targets, races, laxity
  // c3 (8 Oct, one current version): rev 7 (the tissue top-up with BODY7's calibration, hands and feet to ANSUR II) is THE prior body: on whenever
  // the top-up runs (the people7.json records were cast so); the pre-rev-7 top-up is deleted (git history)
  if (opts.topUp && opts.rev7 == null) opts = { ...opts, rev7: {} };
  const r = fitPrior(S, P, t, base, opts), B = r.built;
  const m = measure(S, B, { sex: t.sex, pf: t.pf, age: t.age }), kin = kinematics(S, B, m, t, { seed });
  const pct = spec.bmiPct != null ? 'p' + Math.round(spec.bmiPct * 100) : 'draw';
  const tag = P.model === 'soma' ? 'soma' : 'mhr';
  const name = (spec.name ? spec.name : [t.sex + Math.round(t.age), typeof spec.group === 'string' ? spec.group : 'mix', pct, 's' + seed].join('_')) + '_' + tag;
  const rec = { name, label: (spec.label || name) + (tag === 'soma' ? ' (SOMA prior)' : ' (MHR prior)'), spec: { ...spec }, sex: t.sex, age: t.age, group: spec.group || 'all', params: r.params, theta: r.theta, errPct: r.errPct,
    measures: m, targets: t, kin, skin: spec.skin || skinHint(spec.group, seed), breast: null, preg: t.preg ? { week: t.preg.week ?? null } : null,
    prior: { model: tag, version: PRIOR_VERSION, beta: r.beta.map(x => +x.toFixed(4)), gamma: r.gamma.map(x => +x.toFixed(4)), head: opts.head || {}, topUp: !!opts.topUp, learnedMiss: r.learnedMiss, ...(r.sex != null ? { sexU: r.sex } : {}), ms: r.ms, evals: r.evals } };
  return withPrior(S, P, person(S, rec, B), r.VA);
}
// rebuild a stored prior record (rec.prior.beta / gamma + rec.params)
export function priorPerson(S, P, rec) {
  const VA = priorVA(S, P, rec.params, { beta: rec.prior.beta, gamma: rec.prior.gamma, symmetry: rec.prior.head?.symmetry || 0 });
  return withPrior(S, P, person(S, rec, build(S, rec.params, VA)), VA);
}
// the bust in a support, on the prior body (person.js's supportedPositions rebuilds WITHOUT the prior): MHR's breast is the learned
// surface, so a support here is lane A's lift and shape terms laid over it with the mound at 0 (OUR approximation; CLOTHING's K1 reads it)
function withPrior(S, P, p, VA) {
  p.priorVA = VA;
  p.supported = type => { if (p.sex !== 'f') return null; const T = SUPPORTS[type]; if (!T) throw new Error('unknown support ' + type);
    const q = p.params, B = build(S, { ...q, breast: { mound: 0, sag: -0.004 * T.lift }, breastShape: { trans: T.trans, point: T.point, volVert: T.volVert } }, VA); return B.pos; };
  p.withSupport = type => { const P2 = p.supported(type); if (!P2) return null; const nm = p.name + '_' + type, V2 = { ...p.meta.variants[0], name: nm }, ex = new Map([['pos_' + nm, P2], ['eyes_' + nm, p.built.eyes]]);
    return { ...p, name: nm, meta: { ...p.meta, variants: [V2] }, arr: k => ex.has(k) ? ex.get(k) : S.hero.arr(k), support: type }; };
  return p;
}
// lane A's parameters for a target set without running lane A's fit (the prior fits the frame itself)
export function neutralParams(t) {
  return { sex: t.sex, age: t.age, races: t.races, mhMuscle: t.mhMuscle ?? 0.5, mhWeight: t.mhWeight ?? 0.5, cup: 0, firm: 0, breastShape: null, face: t.face,
    frame: { waist: 0, shoulder: 0, pelvis: 1, flare: 0, legs: 0, head: 1, ...(t.hipSpacing ? { hipSpacing: t.hipSpacing } : {}) }, muscle: {}, fat: {}, breast: null,
    laxity: t.laxity, preg: t.preg ? { week: t.preg.week, postpartumMonths: t.preg.postpartumMonths } : null, stature: t.stature, relief: 0 };
}
