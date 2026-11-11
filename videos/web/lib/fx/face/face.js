// FACE / FACE (HUMAN c8 P2): a person's own face, built from structure and fitted like lane A fits bodies.
//   1. NEUTRAL: the person's head with lane A's few face weights taken back out (lane A drew small offsets around the group mean; this
//      generator replaces them), so every person starts from the same hm08 face at their own size.
//   2. FEATURES: variation the tables do not measure, as data (sample.js FEATURES: nose, lips, chin and jaw, cheeks, brow, lids and
//      canthi, ears, head shape; facial fat from BMI; MakeHuman's age target), each a CC0 MakeHuman target pair.
//   3. PROPORTIONS: the drawn measures placed by a landmark warp (warp.js: each landmark displaced as its target measures ask, a 3D
//      thin-plate spline through them and a still ring round the neck, the eyes moved rigidly with their sockets), twice (the second
//      pass takes up what the first left). MakeHuman's own face targets move the measures by only 1-3 mm at full weight, where the
//      population spans 10-20, so they carry character (2) and the warp carries proportion.
//   4. ASYMMETRY: real faces are not mirror-exact (hm08 is): the same warp displaces one eye up and over, the nose tip and the chin to
//      one side, one mouth corner up, one cheekbone out, one ear up (SDs of ~1 mm: left-right differences in healthy adults are of that
//      size, Farkas and Cheung 1981, as recalled), and MakeHuman's per-side ear rotation; scaled by (1 - symmetry).
//   5. SOFT TISSUE WITH AGE: the change of the facial soft-tissue depth from age 35 at the forensic sites (lips thin, the cheeks and the
//      jaw thicken; face_pop.json tissue, APPROXIMATE), spread over the face from the sites and laid along the normals. BMI is carried by
//      lane A's depots and the head-fat feature (face_test.mjs measures the mesh's BMI response at the sites against the table).
//   6. SMALL FORMS: forms.js (nasolabial fold, philtrum columns, lid crease and margin, alar crease, tear trough, marionette, mentolabial
//      sulcus, jowl), resolution-independent fields band-limited to the mesh's own spacing.
// Positions are metres in the person's bind space; a target's decimetre deltas scale by the person's head size against hm08's.
import { drawTargets, drawFeatures, rng, gauss, clamp, hashStr } from './sample.js';
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
import { faceMeasures, pupils } from './measure.js';
import { formsField, faceFrame } from './forms.js';
import { headZone, plan, buildWarp, applyWarp } from './warp.js';
import { LOOKS_C2, SKIN_C2, jawSites, jawTarget, lipColumns, lipMeasures, lipTargets, tissueC2, outwardMask, restExpression, mrd1Target, lidPlan, lidMeasure } from './c2.js';
// the measures the warp places (the rest are reported); the numbers are a reading tolerance (mm) for the test
export const FIT = { 'zy-zy': 1.5, 'eu-eu': 1.5, 'g-op': 2, 't-v': 2.5, 'n-me': 1.5, 'n-sn': 1.2, 'sn-me': 1.5, 'sn-sto': 1.2, 'al-al': 1, 'ch-ch': 1.2, 'en-en': 1.5, 'ex-ex': 1.5, 'ipd': 1, 'sa-sba': 1.5 };
// ---------------------------------------------------------------- helpers
function addTarget(F, P, name, w, k, n) { if (!w) return; const t = F.target(name); if (!t) return; const { ix, d } = t;
  for (let i = 0; i < ix.length; i++) { const v = ix[i]; if (v >= n) continue; const q = v * 3; P[q] += w * k * d[i * 3]; P[q + 1] += w * k * d[i * 3 + 1]; P[q + 2] += w * k * d[i * 3 + 2]; } }
function moveEyes(F, E, P0, P1) {                       // the eye proxy rides on its 3 reference vertices (MakeHuman proxy fitting)
  const R = F.eyeRef, out = new Float32Array(E);
  for (let e = 0; e < R.ne; e++) for (let m = 0; m < 3; m++) { const v = R.idx[e * 3 + m], w = R.w[e * 3 + m]; for (let a = 0; a < 3; a++) out[e * 3 + a] += w * (P1[v * 3 + a] - P0[v * 3 + a]); }
  return out;
}
export function vnormals(P, tri, nb) {
  const N = new Float32Array(nb * 3);
  for (let i = 0; i < tri.length; i += 3) { const a = tri[i] * 3, b = tri[i + 1] * 3, c = tri[i + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const q of [a, b, c]) { N[q] += nx; N[q + 1] += ny; N[q + 2] += nz; } }
  for (let v = 0; v < nb; v++) { const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1; N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l; }
  return N;
}
// mean incident edge length per vertex (the mesh's own sampling, for band-limiting the small forms)
export function spacing(P, tri, nb) {
  const s = new Float32Array(nb), c = new Uint16Array(nb);
  for (let i = 0; i < tri.length; i += 3) for (const [a, b] of [[tri[i], tri[i + 1]], [tri[i + 1], tri[i + 2]], [tri[i + 2], tri[i]]]) {
    const l = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]); s[a] += l; s[b] += l; c[a]++; c[b]++; }
  for (let v = 0; v < nb; v++) s[v] = c[v] ? s[v] / c[v] : 0.004;
  return s;
}
// ---------------------------------------------------------------- the person's source arrays
// src: a lane A person (castBody / loadCast) or any hero data object + variant name
export function sourceOf(data, variant) {
  const meta = data.meta, V = variant ? meta.variants.find(v => v.name === variant) : meta.variants[0];
  if (!V) throw new Error('face: no variant ' + variant);
  const pos = data.arr('pos_' + V.name), eyes = data.arr('eyes_' + V.name), side = data.arr('eye_side'), tri = data.arr('idx_body'), region = data.arr('region');
  return { data, V, name: V.name, pos, eyes, side, tri, region, n: meta.n, nb: data._S?.nb || 13380, params: data.params || null, rec: data };
}
// ---------------------------------------------------------------- the generator
// makeFace(F, src, spec) -> face record (positions, eyes, report). spec (all optional; defaults from the person record):
//   sex, age, group, bmi, stature, seed, spread (1 = a real draw), averageness 0..1, symmetry 0..1, dimorphism -1..1,
//   look 'common' | 'pleasant' | 'attractive' (a preset of the three plus skin homogeneity), features 0..1, forms 0..1, tissue 0..1,
//   measures { key: mm } (override drawn targets), asym { ... } (override drawn asymmetry), fit false (skip the fit: features only)
export const LOOKS = { common: { averageness: 0, symmetry: 0, homogeneity: null }, pleasant: { averageness: 0.35, symmetry: 0.45, homogeneity: 0.6 }, attractive: { averageness: 0.6, symmetry: 0.75, homogeneity: 0.8 } };
// spec.rev: 1 (default) = P2 exactly; 2 = FACE c2 (c2.js): the jaw placed from the cited go-go / zy-zy ratio on a gonion found on the
// person's own jaw, the cited CT soft-tissue table at the corrected sites, the lips placed from vermilion heights and E-line protrusion,
// a resting expression (spec.tilt: the corners' height above the stomion, mm), the c2 looks (adiposity, skin, eyes) and prior means.
export function makeFace(F, src, spec = {}) {
  const t0 = Date.now(), rec = src.rec || {}, C2 = (spec.rev ?? 1) >= 2, look = (C2 ? LOOKS_C2 : LOOKS)[spec.look] || {};
  const S = { sex: rec.sex || spec.sex || 'f', age: rec.age ?? 35, group: rec.group || 'all', bmi: rec.measures?.bmi ?? 25, stature: rec.measures?.stature ?? rec.height ?? 1.7,
    seed: hashStr(src.name), spread: 1, averageness: look.averageness ?? 0, symmetry: look.symmetry ?? 0, dimorphism: look.dimorphism ?? 0, features: 1, forms: 1, tissue: 1,
    ...(C2 ? { adiposity: look.adiposity ?? 0, tilt: look.tilt ?? 0, lipFull: look.lipFull ?? 0, eyeOpen: look.eyeOpen ?? 0, rest: 1, lips: 1, jaw: 1 } : {}), ...spec };
  if (C2) S.bmiFace = S.bmi + (S.adiposity || 0);
  const { pos, n, nb, tri } = src;
  let ids = F.ids;
  // 1. neutral: lane A's face weights out; the scale of a decimetre target at this person's head size
  // rev 3 (integration v3, 3 Oct; FACE3's finding): MakeHuman's targets are decimetres and this k already converts (head height in m /
  // the base head's 2.3358 dm); P2 / c2 multiplied by a further 0.1, so every feature (and the removal of lane A's own face weights)
  // acted at a TENTH of its size. spec.targetScale (default 0.1 for rev 1-2, exactly as before; 1 for rev 3) and spec.featureGain
  // (rev 3: the drawn feature weights x this; P2's SDs were tuned at the small scale) make the fix a revision, never a silent change.
  const R3 = (spec.rev ?? 1) >= 3, tScale = spec.targetScale ?? (R3 ? 1 : 0.1), fGain = spec.featureGain ?? 1;
  const k = tScale * (pos[ids.v * 3 + 1] - pos[ids.me * 3 + 1]) / (F.lm.baseHeadHeightDm || 2.3358);
  const P0 = new Float32Array(pos);
  const old = src.params?.face || {};
  for (const [name, w] of Object.entries(old)) addTarget(F, P0, name, -w, k, n);
  // 2. targets and features
  const T = drawTargets(F.pop, S), FE = drawFeatures(S, T);
  if (spec.measures) for (const [m, v] of Object.entries(spec.measures)) if (T.targets[m]) T.targets[m].value = v;
  const P1 = new Float32Array(P0);
  for (const [name, w] of Object.entries(FE.weights)) addTarget(F, P1, name, w * S.features * fGain, k, n);
  let E1 = moveEyes(F, src.eyes, pos, P1);
  // c2: the soft-tissue gonion and the lower cheek on this person's own jaw (P2's 'go' is lane A's vertex behind the ear); the jaw and
  // lip targets, drawn from their own stream (rev 1's draws untouched)
  let FF = F, c2 = null;
  if (C2) { const js = jawSites(F, P1, src.region, nb); ids = { ...F.ids, ...Object.fromEntries(Object.entries(js).filter(([, v]) => v >= 0)) }; FF = { ...F, ids };
    const r2 = rng(((S.seed ?? 1) * 48271 + 11) >>> 0), jt = jawTarget(S, T.targets['zy-zy'].value, r2), lt = lipTargets(S, r2), mrd1 = mrd1Target(S, r2);
    if (S.jaw) T.targets['go-go'] = { mean: null, sd: null, value: jt.value, src: 'c2: Farkas 2005 go-go / zy-zy ratio x the drawn zy-zy (+ BMI, age)' };
    c2 = { jaw: jt, lips: lt, sites: js, lids: { target: +mrd1.toFixed(2) } }; }
  const FITX = C2 && S.jaw ? { ...FIT, 'go-go': 2 } : FIT;
  // the lips' columns as extra warp controls (c2): upper vermilion height and both lips' E-line protrusion moved toward their targets
  // (the columns are material points: found once on the featured face, then followed, so a measure never jumps to another vertex)
  const lipCols = C2 ? lipColumns(FF, P1, nb, src.region, vnormals(P1, tri, nb)) : null;
  const lidsOn = C2 && (S.lids ?? 1);
  const lipPlan = (P, E = null) => { const frac = 1; if (!C2 || (!S.lips && !lidsOn)) return null;
    // the lids from the second pass on (the eyes have their place by then)
    const lid = lidsOn && E ? lidPlan(F, P, E, src.side, c2.lids.target) : { extra: [] }; if (lid.m) c2.lids.before ||= { L: +lid.m.L.toFixed(2), R: +lid.m.R.toFixed(2) };
    if (!S.lips) return { mas: 0.5, extra: lid.extra };
    const cols = lipCols, m = lipMeasures(FF, P, cols), lt = c2.lips;
    // the goal, set once from the first measure: protrusion moves mostly BACK (MakeHuman's lips sit forward; pushing a CG lip forward
    // reads as a pout, and the E-line also carries the drawn nose and chin): -1.5..+0.5 mm in all (a bigger retrusion flattened the
    // mouth on the probes); the vermilion height within 3 mm of where the face had it (OUR)
    // the lower vermilion (stomion to the roll's underside) only comes DOWN in height toward the table: MakeHuman's lower lip is a
    // tall roll (the photo check read our lower vermilions ~30 % taller than the photographs')
    const g = c2.lipGoal ||= { uv: clamp(lt.uv, m.uv - 3, m.uv + 3), eU: clamp(lt.eU, m.eU - 1.5, m.eU + 0.5), eL: clamp(lt.eL, m.eL - 1.5, m.eL + 0.5), lv: m.lv != null ? clamp(lt.lv, m.lv - 3, m.lv) : null };
    const dU = (g.uv - m.uv) * frac, zU = (g.eU - m.eU) * frac, zL = (g.eL - m.eL) * frac, dL = g.lv != null && m.lv != null ? (m.lv - g.lv) * frac : 0, extra = [];
    for (const c of cols) { if (c.up != null) extra.push({ v: c.up, d: [0, dU * c.w, zU * c.w] }); if (c.lo != null) extra.push({ v: c.lo, d: [0, 0, zL * c.w] }); if (c.bo != null && dL) extra.push({ v: c.bo, d: [0, dL * c.w, 0.3 * dL * c.w + zL * c.w] }); }
    if (ids.mph != null && !cols.some(c => c.up === ids.mph)) extra.push({ v: ids.mph, d: [0, 0.5 * dU, 0.5 * zU] });
    // the lips' own landmarks move with their columns (ls left behind while its column passed it folded the bow)
    if (!cols.some(c => c.up === ids.ls)) extra.push({ v: ids.ls, d: [0, dU, zU] }); if (!cols.some(c => c.lo === ids.li)) extra.push({ v: ids.li, d: [0, 0, zL] });
    extra.push(...lid.extra);
    c2.lipsBefore ||= m; return { mas: 0.5, extra }; };
  // 3-4. proportions and asymmetry: the landmark warp, two passes
  const asym = drawAsym(S, spec.asym), zone = headZone(F, P1, src.region, n, nb);
  let P2 = P1, E2 = E1, pass = [];
  const cur0 = faceMeasures(P1, E1, src.side, ids);
  for (const m of ['en-en', 'ex-ex']) if (T.targets[m]?.rel) T.targets[m].value = cur0[m] * (T.targets.ipd.value / cur0.ipd) * T.targets[m].rel;
  for (let it = 0; it < 2; it++) {
    const cur = faceMeasures(P2, E2, src.side, ids), tv = Object.fromEntries(Object.keys(FITX).filter(m => T.targets[m]?.value != null).map(m => [m, T.targets[m].value]));
    tv.fracSn = T.fracSn; tv.fracSto = T.fracSto;
    const pl = plan(FF, P2, cur, tv, it === 0 ? asym : null, faceFrame(FF, P2), lipPlan(P2, it === 1 ? E2 : null)), W = buildWarp(FF, P2, zone, pl), r = applyWarp(F, W, P2, E2, zone, pl.eyeShift, n);
    pass.push(Object.fromEntries(Object.keys(tv).filter(m => cur[m] != null).map(m => [m, +(cur[m] - tv[m]).toFixed(2)]))); P2 = r.P; E2 = r.E;
  }
  if (asym.earRot) { const nm = asym.earRot > 0 ? ['ears/l-ear-rot-backward', 'ears/r-ear-rot-forward'] : ['ears/l-ear-rot-forward', 'ears/r-ear-rot-backward'];
    const P2b = new Float32Array(P2); for (const t of nm) addTarget(F, P2b, t, Math.abs(asym.earRot) / 2, k, n); E2 = moveEyes(F, E2, P2, P2b); P2 = P2b; }
  const fit = { passes: pass };
  // 5. soft tissue with age, 6. small forms (both along the normals of the shaped face)
  const N = vnormals(P2, tri, nb), H = spacing(P2, tri, nb);
  const P3 = new Float32Array(P2);
  const fr = faceFrame(F, P2), facing = new Float32Array(nb);           // only skin that faces the camera side of the face: the inner lips, the
  for (let v = 0; v < nb; v++) { const c = N[v * 3] * fr.z[0] + N[v * 3 + 1] * fr.z[1] + N[v * 3 + 2] * fr.z[2], t = clamp((c - 0.05) / 0.3); facing[v] = t * t * (3 - 2 * t); }   // nostrils and the lids' undersides keep still
  const tissue = !S.tissue ? null : C2 ? tissueC2(F, ids, P2, N, nb, S, outwardMask(FF, P2, N, nb, src.region, sst), sst) : tissueAge(F, P2, N, nb, S, src.region, facing);
  if (tissue) for (let v = 0; v < nb; v++) { const t = tissue.D[v] * S.tissue; if (t) { P3[v * 3] += t * N[v * 3]; P3[v * 3 + 1] += t * N[v * 3 + 1]; P3[v * 3 + 2] += t * N[v * 3 + 2]; } }
  const forms = S.forms ? formsField(F, P2, N, H, nb, { sex: S.sex, age: S.age, bmi: S.bmi, group: T.group, ctx: FE.ctx, scale: S.forms, seed: S.seed, region: src.region, facing }) : null;
  if (forms) for (let v = 0; v < nb; v++) { const t = forms.D[v]; if (t) { P3[v * 3] += t * N[v * 3]; P3[v * 3 + 1] += t * N[v * 3 + 1]; P3[v * 3 + 2] += t * N[v * 3 + 2]; } }
  let E3 = moveEyes(F, E2, P2, P3);
  // a last warp pass takes up what the soft tissue and the forms moved the landmarks by (sub-millimetre; smooth, so the forms keep)
  // c2: the resting expression's weight is solved here, before the last pass, so the pass can leave room for the corners' outward
  // pull (the zygomaticus unit widens the mouth ~0.55 mm a side per 0.1; the photo check read c2's mouths ~5 % wide without this)
  let re = null;
  if (C2 && S.rest) { re = restExpression(src, FF, P3, (S.tilt ?? 0) + (S.sex === 'm' ? (S.tiltMen ?? -1.0) : 0)); }
  { const cur = faceMeasures(P3, E3, src.side, ids), tv = Object.fromEntries(Object.keys(FITX).filter(m => T.targets[m]?.value != null).map(m => [m, T.targets[m].value]));
    tv.fracSn = T.fracSn; tv.fracSto = T.fracSto;
    if (re?.w && tv['ch-ch'] != null) { const a = re.delta, fr0 = faceFrame(FF, P3), dx = (v, sg) => sg * (a[v * 3] * fr0.x[0] + a[v * 3 + 1] * fr0.x[1] + a[v * 3 + 2] * fr0.x[2]) * 1000;
      tv['ch-ch'] -= re.w * S.rest * (dx(ids.ch_L, 1) + dx(ids.ch_R, -1)); }
    const pl = plan(FF, P3, cur, tv, null, faceFrame(FF, P3), lipPlan(P3, E3)), W = buildWarp(FF, P3, zone, pl), r = applyWarp(F, W, P3, E3, zone, pl.eyeShift, n);
    pass.push(Object.fromEntries(Object.keys(tv).filter(m => cur[m] != null).map(m => [m, +(cur[m] - tv[m]).toFixed(2)]))); P3.set(r.P); E3 = r.E; }
  // c2: the resting expression, baked last (hero.js's own expression morphs still add on top at run time)
  if (C2 && S.rest) { if (re.w) { const a = re.delta, w = re.w * S.rest; for (let i = 0; i < nb * 3; i++) P3[i] += w * a[i]; }
    c2.rest = { w: +(re.w * S.rest).toFixed(3), tilt0: +(re.tilt0 ?? 0).toFixed(2), mmPerUnit: +(re.perUnit ?? 0).toFixed(2) };
    c2.lipsAfter = lipMeasures(FF, P3, lipCols); const lm = lidMeasure(F, P3, E3, src.side); if (lm) c2.lids.after = { L: +lm.L.toFixed(2), R: +lm.R.toFixed(2) }; }
  const mouth = [0, P3[ids.sto * 3 + 1], Math.max(P3[ids.ls * 3 + 2], P3[ids.li * 3 + 2])];   // for a V.mouth hook in hero.js (NOTES)
  const before = faceMeasures(pos, src.eyes, src.side, ids), after = faceMeasures(P3, E3, src.side, ids);
  if (C2) { const lt = c2.lips; c2.lipsMask = { halfW: after['ch-ch'] / 2000, uv: Math.max(5, lt.uv) / 1000, lv: Math.max(6, lt.lv) / 1000 };
    c2.skin = { ...SKIN_C2, ...(look.skin || {}), ...(spec.skin || {}) }; c2.eyes = { ...(look.eyes || {}), ...(spec.eyes || {}) }; }
  const tgt = Object.fromEntries(Object.entries(T.targets).map(([m, v]) => [m, +v.value.toFixed(2)]));
  return { name: src.name, mouth, spec: { ...S }, look: spec.look || null, homogeneity: spec.homogeneity ?? look.homogeneity ?? (C2 ? c2.skin.homogeneity : null), pos: P3, eyes: E3, targets: tgt, targetsFull: T, features: FE.values, weights: FE.weights,
    fit, ...(C2 ? { rev: R3 ? 3 : 2, c2, ids } : {}), ...(R3 ? { targetScale: tScale, featureGain: fGain } : {}),
    asym, tissue: tissue && tissue.sites, forms: forms && forms.report, formsBuilt: forms && forms.built, before, after, ms: Date.now() - t0, k };
}
// ---------------------------------------------------------------- 4. asymmetry
export function drawAsym(S, over = null) {
  const r = rng(((S.seed ?? 1) * 104729 + 7) >>> 0), a = 1 - clamp(S.symmetry ?? 0);
  const g = sd => gauss(r) * sd * a;
  return { eyeY: g(1.0), eyeX: g(0.8), cheek: g(1.0), earY: g(1.5), earRot: g(0.3), noseX: g(1.0), chinX: g(1.2), mouthY: g(0.8), ...(over || {}) };   // mm (earRot: MakeHuman weight)
}
// ---------------------------------------------------------------- 5. soft tissue with age (and the BMI the mesh does not carry)
// MESH_BMI: how far the face's skin moves out per BMI unit at each site BEFORE this layer (lane A's depots + MakeHuman's head-fat
// target), measured by face_test.mjs (5) on 3 Oct (a woman and a man of 40, BMI p20 vs p90, mean of the two; mm per BMI unit).
// The layer adds the table's slope minus this (the cheeks, the masseter and the jaw line carry too little fat on the mesh), capped
// at +4 / -1.5 mm. The table is approximate (face_pop.json tissue.src), so this is a correction of the right sign and rough size.
const MESH_BMI = { sg: 0.015, g: 0.01, n: 0, rhi: 0, mph: -0.05, ls: 0.095, li: -0.01, sl: 0.08, pg: 0.19, gn: 0.235, me: 0.305, so: 0.1, or: 0.03, mal: 0.29, buc: 0.375, mas: 0.08, mm: 0, go: 0.95 };
function tissueAge(F, P, N, nb, S, region, facing) {
  const T = F.pop.tissue, ids = F.ids, dec = (S.age - (T.ref.age || 35)) / 10, dB = (S.bmi ?? 24) - (T.ref.bmi || 24), sites = [];
  for (const [k, s] of Object.entries(T.sites)) { const res = s.perBMI - (MESH_BMI[k] ?? s.perBMI), d = s.perDecade * dec + Math.max(-1.5, Math.min(4, res * dB)); if (!d) continue;
    for (const nm of [k, k + '_L', k + '_R']) if (ids[nm] != null) sites.push({ k: nm, v: ids[nm], d: d / 1000 }); }
  const D = new Float32Array(nb), sg = 0.016, bg = 0.2;               // Gaussian reach 16 mm; a background weight so the field fades to 0 away from the sites
  const out = Object.fromEntries(sites.map(s => [s.k, +(s.d * 1000).toFixed(2)]));
  // no hard cuts anywhere (a region seam or a depth plane where the field is not yet zero draws a crease line in the shading): the
  // Gaussians' own falloff keeps the field on the face; a smooth fade behind the ears
  const zT = P[ids.t_L * 3 + 2];
  for (let v = 0; v < nb; v++) { const zf = sst(zT - 0.03, zT + 0.01, P[v * 3 + 2]); if (!zf) continue;
    let ws = bg, s = 0; for (const q of sites) { const dx = P[v * 3] - P[q.v * 3], dy = P[v * 3 + 1] - P[q.v * 3 + 1], dz = P[v * 3 + 2] - P[q.v * 3 + 2], w = Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * sg * sg)); ws += w; s += w * q.d; }
    D[v] = zf * facing[v] * s / ws; }
  return { D, sites: out };
}
// ---------------------------------------------------------------- the person with this face
// withFace(src, face): a hero data object (lane A's contract): one variant named <name>_face carrying the new positions and eyes; every
// shared array delegates. Face bones (jaw, eyes, lips) keep their bind heads: the changes are millimetres and the skin weights carry them.
export function withFace(src, face, suffix = '_face') {
  const data = src.data, V = src.V, nm = V.name + suffix, I = face.ids || null, V2 = { ...V, name: nm, mouth: face.mouth || null }, ex = new Map([['pos_' + nm, face.pos], ['eyes_' + nm, face.eyes]]);
  const meta = { ...data.meta, variants: [...data.meta.variants.filter(v => v.name !== nm), V2] };
  return { ...data, name: data.name ? data.name + suffix : nm, meta, arr: k => ex.has(k) ? ex.get(k) : data.arr(k), face, variant: nm };
}
// after new Hero(withFace(...)): hero.js finds the mouth by a rule of thumb tuned to its own faces (the most forward midline point
// 5.5-8.5 cm under the eyes, less 4 mm); on a generated face that rule can land on the lower lip or the chin, and the painted parting
// line, the lip tint (lane B), the stubble edge and the hair's mouth clearance follow it. This puts h.mouth at the face's own stomion
// (the same Vector3 the shaders' uniforms hold) and hChin after it. Call it BEFORE applySkin and lane D's hair, which read h.mouth.
export function fitHeroFeatures(h, face, F) {
  const I = F.ids, P = face.pos, y = P[I.sto * 3 + 1], z = Math.max(P[I.ls * 3 + 2], P[I.li * 3 + 2]);
  // HUMAN c8 HOOKS: a hero.js with the P2 mouth hook already built h.mouth (and hChin) from withFace's V.mouth: then this is a no-op
  if (h.mouthFrom === 'V.mouth' && Math.abs(h.mouth.y - y) < 1e-7 && Math.abs(h.mouth.z - z) < 1e-7 && h.mouth.x === 0) return { was: h.mouth.clone(), now: h.mouth.clone(), hook: true };
  const was = h.mouth.clone(); h.mouth.set(0, y, z);
  if (h.skinU?.hChin) h.skinU.hChin.value.set(0, y - 0.05, z - 0.01);
  return { was, now: h.mouth.clone() };
}
