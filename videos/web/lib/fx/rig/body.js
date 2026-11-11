// RIG c1 / BODY: skeletons and bodies as data. A body is one REAL SUBJECT of ANSUR II (US Army survey, 2012; 4,082 men and 1,986 women;
// a US Government work, public) drawn with its measurements together, so a short broad welder and a tall lanky lineman are both
// people who exist, where independent sliders make impossible ones. assets/rig/ansur_subjects.json is baked by scripts/bake_ansur.py.
//
//   const A = await loadAnsur();
//   const b = sampleBody(A, rng, { sex: 'm', stature: [1.62, 1.72], build: 'stocky', age: [45, 60] });   // -> a Body (proportions + why)
//   const hero = new Hero(data, { ...heroOptions(b, { outfit: 'flannel' }) });  applyBody(hero, b);       // the mesh takes the body
//   walkStyle(b)   -> { speed, cadence, swing, lean, take }   stride, cadence and posture that follow the body (Froude number, age, bulk)
//
// Proportions are applied RELATIVE to the population mean (a subject at the mean changes nothing), by bone scale along the limb or
// the torso, with the children counter-scaled so a hand stays a hand. This is what a rig-as-data means here: a body is a row.
import * as THREE from 'three';
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export function mulberry32(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

let _A = null;
export function parseAnsur(j) {
  const ix = Object.fromEntries(j.cols.map((c, i) => [c, i]));
  const prep = rows => rows.map(r => ({ r, stature: r[ix.stature] / 1000, bmi: r[ix.weightkg] / Math.pow(r[ix.stature] / 1000, 2), age: r[ix.Age] }));
  const A = { ix, men: prep(j.men), women: prep(j.women), cols: j.cols, mean: null, source: j.source };
  const ratios = (rows, c) => { const x = rows.map(o => o.r[ix[c]] / o.r[ix.stature]); return x.reduce((a, b) => a + b, 0) / x.length; };
  const RC = ['trochanterionheight', 'kneeheightmidpatella', 'acromialheight', 'biacromialbreadth', 'bicristalbreadth', 'chestbreadth', 'chestdepth', 'waistbreadth', 'waistdepth', 'shoulderelbowlength', 'forearmhandlength', 'handlength', 'neckcircumference', 'sittingheight'];
  A.mean = { m: {}, f: {} }; for (const c of RC) { A.mean.m[c] = ratios(A.men, c); A.mean.f[c] = ratios(A.women, c); }
  A.meanBmi = { m: A.men.reduce((a, o) => a + o.bmi, 0) / A.men.length, f: A.women.reduce((a, o) => a + o.bmi, 0) / A.women.length };
  return A;
}
export async function loadAnsur(url = new URL('../../../assets/rig/ansur_subjects.json', import.meta.url).href) {
  if (_A) return _A;
  return (_A = parseAnsur(await (await fetch(url)).json()));
}
const BUILD = {   // a build is a region of (stature percentile, bmi) space, so "stocky" is a real kind of person and not a slider
  lean: o => o.bmi < 22.3, average: o => o.bmi > 23 && o.bmi < 27, stocky: o => o.bmi > 27.5, heavy: o => o.bmi > 30.5, any: () => true,
};
// spec: { sex: 'm' | 'f' | null (null: 80 / 20 by the survey's own counts), stature: [lo, hi] m, build, age: [lo, hi] years, tall/short outliers: statureOut: 'tall' | 'short' }
// HUMAN c8 lane F: spec.women = the share of women when sex is null (0.5: half and half, the studio's rule for new work); default 0.2 (the
// survey's own counts) so existing callers draw exactly as before
export function sampleBody(A, rand, spec = {}) {
  const sex = spec.sex || (rand() < (spec.women ?? 0.2) ? 'f' : 'm'), rows = sex === 'f' ? A.women : A.men;
  const [s0, s1] = spec.stature || [0, 9], [a0, a1] = spec.age || [0, 99], bf = BUILD[spec.build || 'any'];
  let pool = rows.filter(o => o.stature >= s0 && o.stature <= s1 && o.age >= a0 && o.age <= a1 && bf(o));
  if (!pool.length) pool = rows.filter(o => o.stature >= s0 - 0.03 && o.stature <= s1 + 0.03 && bf(o));
  if (!pool.length) pool = rows;
  const o = pool[Math.floor(rand() * pool.length)], ix = A.ix, r = o.r, S = r[ix.stature];
  const M = A.mean[sex], rel = c => (r[ix[c]] / S) / M[c];
  const b = { sex, statureM: S / 1000, weightKg: r[ix.weightkg], bmi: o.bmi, ageY: r[ix.Age],
    // proportions relative to the population mean of that sex (1 = average)
    k: { thigh: (r[ix.trochanterionheight] - r[ix.kneeheightmidpatella]) / S / (M.trochanterionheight - M.kneeheightmidpatella), shin: rel('kneeheightmidpatella'),
      torso: (r[ix.acromialheight] - r[ix.trochanterionheight]) / S / (M.acromialheight - M.trochanterionheight), shoulders: rel('biacromialbreadth'), hips: rel('bicristalbreadth'),
      chestX: rel('chestbreadth'), chestZ: rel('chestdepth'), waistX: rel('waistbreadth'), waistZ: rel('waistdepth'), upperArm: rel('shoulderelbowlength'), foreArm: rel('forearmhandlength'),
      hand: rel('handlength'), neck: rel('neckcircumference'), sitting: rel('sittingheight') },
    fat: clamp((o.bmi - A.meanBmi[sex === 'f' ? 'f' : 'm']) / 12, -0.35, 0.6),
    raw: Object.fromEntries(A.cols.map((c, i) => [c, r[i]])) };
  b.legLenM = (r[ix.trochanterionheight]) / 1000;
  b.summary = `${sex === 'f' ? 'woman' : 'man'}, ${b.ageY | 0} y, ${(b.statureM * 100) | 0} cm, ${b.weightKg | 0} kg, BMI ${b.bmi.toFixed(1)}, legs ${(b.legLenM / b.statureM * 100) | 0}% of stature, shoulders x${b.k.shoulders.toFixed(2)}`;
  return b;
}
// which hero variant (the mesh family) suits the body, and the constructor options
export function heroOptions(b, { outfit = 'work', seed = 1, ...rest } = {}) {
  const variant = b.bmi > 29.5 || (b.statureM < 1.72 && b.bmi > 26.5) ? 'heavy' : (b.statureM > 1.84 && b.bmi < 25 ? 'plains' : 'forge');
  const old = clamp((b.ageY - 20) / 50, 0, 1);
  return { variant, height: b.statureM, kind: outfit, age: 0.1 + 0.85 * old, seed, beard: b.sex === 'f' ? 0 : 0.15 + 0.4 * ((seed * 7919) % 100) / 100, stubble: b.sex === 'f' ? 0 : 0.5, ...rest };
}
// the mesh takes the body: bone scale along limbs and torso (children counter-scaled so hands, feet, head and neck keep their shape)
// HUMAN c6: { lengths: true } applies the lengths only (legs, torso, arms, hand, shoulders), not the girths: a c6 population mesh already
// carries its own build (sex, weight, muscle from MakeHuman's macro targets), and girth scaling on top of it distorts the clothes' hang
export function applyBody(hero, b, { lengths = false } = {}) {
  const k = lengths ? { ...b.k, waistX: 1, waistZ: 1, chestX: 1, chestZ: 1, hips: 1, neck: 1 } : b.k, B = n => hero.bone(n), sc = (n, x, y, z) => { const bn = B(n); if (bn) bn.scale.set(x, y, z); };
  const fat = lengths ? 0 : b.fat, waistX = k.waistX * (1 + 0.25 * fat), waistZ = k.waistZ * (1 + 0.45 * fat);
  const hipX = k.hips, chX = k.chestX / waistX, chZ = k.chestZ / waistZ;
  sc('root', hipX, 1, 1);
  for (const s of ['L', 'R']) sc(`pelvis.${s}`, 1 / hipX, 1, 1);
  sc('spine05', waistX / hipX, k.torso, waistZ);       // the waist: width, length, depth (children inherit)
  sc('spine03', chX, 1, chZ);                          // the chest, relative to the waist
  const chestWorldX = waistX / hipX * hipX * chX, chestWorldZ = waistZ * chZ;
  for (const s of ['L', 'R']) {
    // shoulders: the clavicle spans the biacromial breadth; its children keep their own size
    sc(`clavicle.${s}`, k.shoulders / chestWorldX, 1 / k.torso, 1 / chestWorldZ);
    sc(`shoulder01.${s}`, 1 / (k.shoulders / chestWorldX), 1, 1);
    // arms: uniform scale (an arm is not axis-aligned in the bind)
    const ua = k.upperArm * (1 + 0.1 * fat), fa = k.foreArm / k.upperArm;
    sc(`upperarm01.${s}`, ua * 1 / 1, ua, ua); sc(`lowerarm01.${s}`, fa, fa, fa);
    { const w = B(`wrist.${s}`); if (w) { const kh = k.hand / (ua * fa); w.scale.set(kh, kh, kh); } }
    // legs: thigh and shin along y, the foot counter-scaled
    sc(`upperleg01.${s}`, 1 + 0.35 * fat, k.thigh, 1 + 0.35 * fat); sc(`lowerleg01.${s}`, 1 / (1 + 0.35 * fat) * (1 + 0.15 * fat), k.shin / k.thigh, 1 / (1 + 0.35 * fat) * (1 + 0.15 * fat));
    sc(`foot.${s}`, 1 / (1 + 0.15 * fat), 1 / k.shin, 1 / (1 + 0.15 * fat));
  }
  { const nk = k.neck * (1 + 0.15 * fat); sc('neck01', nk / chestWorldX, 1 / k.torso, nk / chestWorldZ); sc('head', 1 / nk, 1, 1 / nk); }   // a neck of its own girth under a head of its own size
  hero.update(); hero._bodyScaled = true; hero._body_k = b;
}
// posture from age and bulk: added to a pose as angles (rad); gait from the body (Froude scaling: cadence follows leg length, stride follows both)
// HUMAN c8 lane F: a body that carries a kinematic model (b.kin: lane A's p.kin, or kinBody(kin) below) walks by its own gait terms:
// Bohannon's speed by sex and decade, the walk ratio's step and cadence, Smith's pelvic obliquity, the person's hip adduction, arm swing
// and posture (pregnancy's lumbar extension). Without b.kin nothing changes (the same draws from rand, in the same order).
export function walkStyle(b, rand = Math.random) {
  if (b.kin && b.kin.gait) { const g = b.kin.gait, P = g.posture || {}, heavy = clamp(((b.bmi ?? 25) - 25) / 10, 0, 1);
    return { speed: g.speed, froude: g.froude, kyphosis: P.kyphosis, headFwd: P.headFwd, kneeBend: P.kneeBend, swing: g.armSwing, sway: 0.5 + 0.7 * heavy, lumbarExtension: P.lumbarExtension || 0,
      stepLength: g.stepLength, cadence: g.cadence, stepWidth: g.stepWidth, pelvicObliquity: g.pelvicObliquity, hipAdductionPeak: g.hipAdductionPeak, comVerticalPctLeg: g.comVerticalPctLeg, kin: true,
      take: ['02_01', '05_01', '06_01', '07_01', '08_01', '12_01', '16_15', '26_01', '35_01', '38_01', '45_01', '46_01', '49_01'][Math.floor(rand() * 13)] }; }
  const old = clamp((b.ageY - 35) / 45, 0, 1), heavy = clamp((b.bmi - 25) / 10, 0, 1), leg = b.legLenM;
  const froude = 0.25 - 0.05 * old - 0.02 * heavy + 0.06 * (rand() - 0.5);          // Fr = v^2 / (g L): a stroll 0.2, a brisk walk 0.35, a hurry 0.5
  const speed = Math.sqrt(Math.max(0.05, froude) * 9.81 * leg);
  return { speed, froude, kyphosis: 0.05 + 0.22 * old + 0.08 * heavy, headFwd: 0.04 + 0.16 * old, kneeBend: 0.03 + 0.08 * old, swing: 1 - 0.35 * old - 0.15 * heavy, sway: 0.5 + 0.7 * heavy,
    take: ['02_01', '05_01', '06_01', '07_01', '08_01', '12_01', '16_15', '26_01', '35_01', '38_01', '45_01', '46_01', '49_01'][Math.floor(rand() * 13)] };
}
// posture as a pose layer on a hero: call after the clip is applied and before update()
export function applyPosture(hero, ws) {
  const rot = (n, ax, a) => { const bn = hero.bone(n); if (bn) bn.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(ax, a)); };
  const X = new THREE.Vector3(1, 0, 0);
  rot('spine04', X, -ws.kyphosis * 0.35); rot('spine02', X, -ws.kyphosis * 0.45); rot('neck01', X, -ws.headFwd * 0.5); rot('head', X, ws.headFwd * 0.2);
  if (ws.lumbarExtension) { rot('spine05', X, -ws.lumbarExtension * 0.5); rot('spine04', X, -ws.lumbarExtension * 0.5); }   // HUMAN c8 lane F: pregnancy's lordosis (kin.gait.posture): -x on a hero spine bone tips the trunk above it BACK (checked: labs/human8/kin_test.mjs)
}
// HUMAN c8 lane F: a Body-like record from a person's kinematic model (lane A's p.kin), so code written for ANSUR bodies (walkStyle,
// people.js d.body through workerDesc-style mapping) takes a person: stature, mass, age, leg length, and proportions k relative to lane A's
// demo cast medians by sex (KIN_REF below, measured by labs/human8/kin_test.mjs; 1 = that sex's typical proportion)
export const KIN_REF = {
  f: { thigh: 0.2356, shin: 0.2390, torso: 0.2741, shoulders: 0.2219, hips: 0.2534, upperArm: 0.1413, foreArm: 0.1334, legH: 0.5141 },
  m: { thigh: 0.2323, shin: 0.2556, torso: 0.2714, shoulders: 0.2470, hips: 0.2200, upperArm: 0.1429, foreArm: 0.1479, legH: 0.5284 },
};
export function kinBody(kin, { name = null } = {}) {
  const J = kin.joints, H = kin.stature, sex = kin.sex === 'm' ? 'm' : 'f', R = KIN_REF[sex], d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), av = (a, b) => (a + b) / 2;
  const thigh = av(d(J.HJC_L, J.KJC_L), d(J.HJC_R, J.KJC_R)) / H, shin = av(d(J.KJC_L, J.AJC_L), d(J.KJC_R, J.AJC_R)) / H, torso = (J.SJCmid[1] - J.MIDH[1]) / H;
  const ua = av(d(J.SJC_L, J.EJC_L), d(J.SJC_R, J.EJC_R)) / H, fa = av(d(J.EJC_L, J.WJC_L), d(J.EJC_R, J.WJC_R)) / H, sh = Math.abs(J.SJC_L[0] - J.SJC_R[0]) / H, hb = kin.stance.hipBreadth / H;
  const bmi = kin.mass / (H * H);
  const k = { thigh: thigh / R.thigh, shin: shin / R.shin, torso: torso / R.torso, shoulders: sh / R.shoulders, hips: hb / R.hips, chestX: 1, chestZ: 1, waistX: 1, waistZ: 1, upperArm: ua / R.upperArm, foreArm: fa / R.foreArm, hand: 1, neck: 1, sitting: 1 };
  const b = { sex, statureM: H, weightKg: kin.mass, bmi, ageY: kin.age, k, fat: clamp((bmi - (sex === 'f' ? 27.5 : 28)) / 12, -0.35, 0.6), legLenM: kin.gait.legLength, kin, raw: null };
  b.summary = `${name ? name + ': ' : ''}${sex === 'f' ? 'woman' : 'man'}, ${b.ageY | 0} y, ${(H * 100) | 0} cm, ${b.weightKg | 0} kg, BMI ${bmi.toFixed(1)} (kinematic model)`;
  return b;
}

// the retargeted walk leaves the trunk pitched a little back on some takes; set the trunk's lean (rad, + forward along `fwd`, world) by turning the spine about the lateral axis
export function setTorsoLean(hero, fwd, target) {
  const up = new THREE.Vector3(0, 1, 0), lat = new THREE.Vector3().crossVectors(up, fwd).normalize();
  const meas = () => { hero.update(); const v = hero.joint('neck01').sub(hero.joint('spine05')); return Math.atan2(v.dot(fwd), v.y); };
  let a = meas();
  for (let k = 0; k < 2; k++) { const d = target - a; if (Math.abs(d) < 0.01) break; hero.rotateWorld('spine04', lat, d * 0.5); hero.rotateWorld('spine02', lat, d * 0.5); const b = meas(); if (Math.abs(target - b) > Math.abs(d)) { hero.rotateWorld('spine04', lat, -d * 0.5 * 2); hero.rotateWorld('spine02', lat, -d * 0.5 * 2); a = meas(); } else a = b; }
  return a;
}
