// BODY / PERSON (HUMAN c8 lane A): one person record, end to end: draw (sampler.js) -> fit (fit.js) -> build (mix.js) -> measure
// (measure.js) -> kinematic model (kin.js) -> a hero data object. A person IS a hero data object ({ meta, arr }, one variant named
// p.name), so new Hero(p, { variant: p.name, height: p.height, ... }) renders it with every hero layer (skin, cloth, poser) unchanged.
// The shared arrays (skin weights, regions, index buffers, expression morphs) are the base bundle's, read through the studio's own
// loader: hero.js's loadHeroData() cache is never touched, so CREW8 renders exactly as before.
//   castBody(S, spec)        spec: { sex 'f'|'m', age, group 'white'|'black'|'hispanic'|'asian' (or a mix), bmiPct, staturePct, waistPct,
//                            hipPct, muacPct (0..1, fixed percentiles; the rest drawn jointly), seed, spread (0 = the typical person at
//                            those percentiles, 1 = a real draw; default 1 with a seed), strong (z of lean mass at the same BMI),
//                            occupation 'general'|'manual'|'carry'|'desk', pregnant (week), postpartum (months), parity, breast {...},
//                            stature (m) / bmi / measures {...} overrides, name, label, iters }
//   p.supported(type)        women: positions with the bust in a support ('period' | 'soft' | 'sports'), else null
//   p.withSupport(type)      the same person as a hero data object carrying that support (variant p.name + '_' + type)
//   loadCast(S)              the demo cast (assets/body/cast.json): stored fitted parameters, rebuilt (no fit, no measuring at load)
import { sampleTargets } from './sampler.js';
import { fitPerson } from './fit.js';
import { build } from './mix.js';
import { measure, breastVolume, volume } from './measure.js';
import { kinematics, KIN_VERSION } from './kin.js';
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const rnd6 = x => typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x;
const deep = (o, f) => Array.isArray(o) ? o.map(x => deep(x, f)) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deep(v, f)])) : f(o);
// a render hint only (lane B's applySkin is the skin model): a seeded tone inside a broad range per group, light to deep
const SKIN = { white: ['#e6c2a6', '#c4906a'], black: ['#8a5a3c', '#3e2618'], hispanic: ['#d2a27c', '#8e6040'], asian: ['#e0b894', '#a87a52'], all: ['#e0b898', '#4a2e1c'] };
const hexMix = (a, b, u) => '#' + [0, 1, 2].map(i => Math.round(parseInt(a.slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - u) + parseInt(b.slice(1 + 2 * i, 3 + 2 * i), 16) * u).toString(16).padStart(2, '0')).join('');
export function skinHint(group, seed) { const g = typeof group === 'string' && SKIN[group] ? group : 'all', u = ((Math.sin((seed || 1) * 12.9898) * 43758.5453) % 1 + 1) % 1; return hexMix(...SKIN[g], u); }
const MEAS_KEYS = ['stature', 'mass', 'bmi', 'waist', 'naturalWaist', 'highHip', 'hip', 'bust', 'bustMax', 'underbust', 'muac', 'thigh', 'calf', 'biacromial', 'bicristal', 'hipBreadth', 'crotch', 'sitting', 'headCirc', 'neck', 'buttockDepth', 'waistDepth', 'waistBreadth', 'heads', 'apexHeads', 'whr', 'whrNatural', 'whtr', 'ffit', 'vol', 'density'];
const TARGET_KEYS = ['stature', 'mass', 'bmi', 'waist', 'naturalWaist', 'highHip', 'hip', 'bust', 'muac', 'thigh', 'calf', 'biacromial', 'bicristal', 'hipBreadth', 'crotch', 'headCirc', 'neck', 'buttockDepth', 'waistDepth', 'waistBreadth', 'hipSpacing', 'pf', 'ftr', 'farm', 'fleg', 'almi', 'ffmi', 'zAlmi', 'parity', 'post', 'ffitDrawn', 'prepregMass', 'laxity'];
const pick = (o, ks) => Object.fromEntries(ks.filter(k => o[k] != null).map(k => [k, typeof o[k] === 'number' ? Math.round(o[k] * 1e4) / 1e4 : o[k]]));
// the breast volume per breast (mL): the person against the same person with MakeHuman's smallest cup and no mound (the same sag, so
// the sag's own displacement of the chest wall cancels), plus that small
// breast's own ~100 mL (a membrane over the curved ribcage would count the ribcage's own convexity); breastVolume() (membrane) beside it
export function breastVolumes(S, params, B) {
  if (params.sex !== 'f') return null;
  const flat = build(S, { ...params, cup: -1, breast: { mound: 0, sag: params.breast?.sag || 0 }, breastShape: null }), dv = (volume(S, B.pos) - volume(S, flat.pos)) * 1e6 / 2;
  return { diffMl: Math.round(dv + 100), membraneMl: Math.round(breastVolume(S, B)) };
}
// FORM (3 Oct): new people are built with the form-1 soft tissue (mix.js) unless spec.form === 0 (lane A / P1's build, exactly);
// with it, MakeHuman's macro muscle (volume-neutral, artist-sculpted, no local lumps) carries the person's tone: an active adult's
// baseline (men 0.62, women 0.58), + 0.07 per z of lean mass (capped 0.75: past it the frame's arms alone overshoot a MUAC), less with age past 45 (sampler.js's own mapping is 0.5 + 0.1 z, -0.08 past
// 60); and MakeHuman's macro WEIGHT, a weak volume lever but a strong shape character (its average-weight sculpt carries the soft belly
// and the flank roll), sits 0.15 lower at the same BMI (sampler: 0.5 + 0.055 (BMI - 25)): the bulk comes from the smooth soft tissue.
export const FORM = 1;
export const toneOf = t => clamp((t.sex === 'm' ? 0.62 : 0.58) + 0.07 * (t.zAlmi || 0) - 0.12 * clamp((t.age - 45) / 35), 0.3, 0.75);
export const macroWeightOf = t => clamp(0.35 + 0.055 * (t.bmi - 25), 0.15, 1);
export function castBody(S, spec = {}) {
  const t = sampleTargets(S.pop, spec), form = spec.form ?? FORM;
  if (form >= 1) { t.form = form; t.mhMuscle = spec.mhMuscle ?? toneOf(t); t.mhWeight = spec.mhWeight ?? macroWeightOf(t); }
  const r = fitPerson(S, t, { iters: spec.iters ?? 12 }), B = r.built;
  const m = measure(S, B, { sex: t.sex, pf: t.pf, age: t.age }), seed = spec.seed ?? 1;
  const kin = kinematics(S, B, m, t, { seed });
  const pct = spec.bmiPct != null ? 'p' + Math.round(spec.bmiPct * 100) : 'draw';
  const name = spec.name || [t.sex + Math.round(t.age), typeof spec.group === 'string' ? spec.group : 'mix', pct, spec.strong ? 'strong' + spec.strong : '', spec.pregnant ? 'preg' + spec.pregnant : '', spec.postpartum != null ? 'pp' + spec.postpartum : '', 's' + seed].filter(Boolean).join('_');
  const rec = { name, label: spec.label || name, spec: { ...spec }, sex: t.sex, age: t.age, group: spec.group || 'all', params: deep(r.params, rnd6), theta: deep(r.theta, rnd6), errPct: r.errPct,
    measures: pick(m, MEAS_KEYS), targets: pick(t, TARGET_KEYS), kin, skin: spec.skin || skinHint(spec.group, seed), breast: t.breast ? pick(t.breast, ['volumeMl', 'ptosis', 'grade', 'splay', 'trans', 'parity']) : null,
    preg: t.preg ? { week: t.preg.week ?? null, postpartumMonths: t.preg.postpartumMonths ?? null, gainKg: t.preg.gain ? Math.round(t.preg.gain.total * 10) / 10 : null, retainedKg: t.preg.retainedKg != null ? Math.round(t.preg.retainedKg * 10) / 10 : null } : null };
  if (t.sex === 'f') rec.breast = { ...rec.breast, measured: breastVolumes(S, r.params, B) };
  rec.fit = { cost: +r.cost.toFixed(5), evals: r.evals, ms: r.ms };
  return person(S, rec, B);
}
// a record + its built mesh -> the hero data object
export function person(S, rec, B = null) {
  B ||= build(S, rec.params);
  const name = rec.name, H = B.stature, pos = B.pos, eyes = B.eyes;
  const V = { name, note: rec.label, sex: rec.sex, age: rec.age, heads: B.heads.map(h => h.slice()), tails: B.tails.map(h => h.slice()), height: H };
  const meta = { ...S.hero.meta, variants: [V], kin: rec.kin, person: name };
  const extra = new Map([['pos_' + name, pos], ['eyes_' + name, eyes]]);
  const p = { meta, arr: k => extra.has(k) ? extra.get(k) : S.hero.arr(k), ...rec, height: H, pregnant: !!rec.preg?.week, built: B, _S: S, _extra: extra };
  p.landmarks = Object.fromEntries(Object.entries(S.landmarks).map(([k, v]) => [k, [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]].map(x => Math.round(x * 1e5) / 1e5)]));
  p.supported = type => supportedPositions(S, p, type);
  p.withSupport = type => { const P2 = p.supported(type); if (!P2) return null; const nm = name + '_' + type, V2 = { ...V, name: nm }, ex = new Map([['pos_' + nm, P2], ['eyes_' + nm, eyes]]);
    return { ...p, name: nm, meta: { ...meta, variants: [V2] }, arr: k => ex.has(k) ? ex.get(k) : S.hero.arr(k), support: type }; };
  p.toJSON = () => record(p);
  return p;
}
export const record = p => ({ name: p.name, label: p.label, spec: p.spec, sex: p.sex, age: p.age, group: p.group, skin: p.skin, params: p.params, theta: p.theta, errPct: p.errPct, measures: p.measures, targets: p.targets, breast: p.breast, preg: p.preg, fit: p.fit, kin: p.kin });
// ---------------------------------------------------------------- the bust in a support (for CLOTHING): a rebuild with the support's lift and shape, then (sports)
// a compression of the breast's height above the chest wall. Our model, by eye against period and current foundation garments: a
// 'period' brassiere (1940s-50s: lifted, projected, the apex pointed), a 'soft' cup (a little lift, the natural round), a 'sports'
// compression bra (lifted, flattened and spread). Volume is NOT conserved exactly (reported by body_test.mjs).
export const SUPPORTS = { period: { lift: 1, trans: 0.35, point: 0.55, volVert: 0.25, compress: 1 }, soft: { lift: 0.6, trans: 0.15, point: 0, volVert: 0.1, compress: 1 }, sports: { lift: 1, trans: 0.2, point: -0.5, volVert: 0, compress: 0.8 } };
export function supportedPositions(S, p, type) {
  if (p.sex !== 'f' || !p.params.breast) return null; const T = SUPPORTS[type]; if (!T) throw new Error('unknown support ' + type);
  const q = p.params, sh = q.breastShape || {}, pr = { ...q, breast: { ...q.breast, sag: (q.breast.sag || 0) * (1 - T.lift) }, breastShape: { ...sh, trans: (sh.trans || 0) + T.trans, point: (sh.point || 0) + T.point, volVert: Math.max(0, (sh.volVert || 0) + T.volVert) },
    laxity: q.laxity };
  const B = build(S, pr), P = new Float32Array(B.pos);
  // compression: the breast's height above the same person's flat chest (MakeHuman's smallest cup, no mound), inside the footprint
  if (T.compress < 1) { const F = build(S, { ...pr, cup: -1, breast: { mound: 0, sag: 0 }, breastShape: null }).pos, fp = S.field('breastFoot'), N = B.N;
    for (let i = 0; i < fp.ix.length; i++) { const v = fp.ix[i], w = fp.f[i]; if (v >= S.nb || w < 0.02) continue; const h = (P[v * 3] - F[v * 3]) * N[v * 3] + (P[v * 3 + 1] - F[v * 3 + 1]) * N[v * 3 + 1] + (P[v * 3 + 2] - F[v * 3 + 2]) * N[v * 3 + 2]; if (h <= 0) continue;
      const k = (1 - T.compress) * h * Math.min(1, w * 3); P[v * 3] -= k * N[v * 3]; P[v * 3 + 1] -= k * N[v * 3 + 1]; P[v * 3 + 2] -= k * N[v * 3 + 2]; } }
  return P;
}
// ---------------------------------------------------------------- the demo cast
export async function loadCast(S, { url = new URL('../../../assets/body/cast.json', import.meta.url).href, force = false } = {}) {
  if (S._cast && !force) return S._cast;
  const J = await fetch(url).then(r => r.json());
  const people = J.people.map(rec => person(S, rec));
  return (S._cast = { version: J.version, built: J.built, kinVersion: KIN_VERSION, people, find: n => people.find(q => q.name === n || q.label === n) });
}
