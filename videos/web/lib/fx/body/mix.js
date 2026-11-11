// BODY / MIX (HUMAN c8 lane A): a person's mesh from a parameter set, in layers, the way a figure-drawing teacher builds one.
//   1. FRAME (MakeHuman CC0 raw material, mixed exactly as scripts/bake_hero.py does): macro race x sex x age x muscle x weight
//      (MakeHuman's MacroModifier rule: a universal target weighs sex x age x muscle x weight, a race target race x sex x age; age 25 =
//      'young', 90 = 'old'), the breast cup x firmness x weight targets (women), measure targets for shoulder breadth and segment
//      lengths, face targets; then two frame operations of our own: the pelvis widened about the midline with the legs carried
//      (bicristal / hip breadth) and the head scaled on its own skin weights (the head canon follows stature: Richer's 7.5 heads is
//      a mean, not a rule; ANSUR head circumference hardly grows with stature). Joint centres (MakeHuman's vertex-group means) and
//      the fitted eyes (MakeHuman proxy fitting) are taken HERE, before any soft tissue: fat and muscle never move a joint.
//   2. MUSCLE: bellies along the person's own smoothed bind normals, P += m_i f_i N (bake_body.py: origin/insertion fields).
//   3. FAT: the depot thickness T(v) = sum a_d f_d(v), P += T N (the visceral dome along N + forward). Heavy thighs meet: the
//      medial thigh is clamped at the midline (contact, not interpenetration).
//   4. BREAST (women): MakeHuman's cup x firmness shapes plus our mound beyond them, splay, position, and a ptosis sag inside the
//      footprint; men's chest fat is the chestFat depot of layer 3.
//   5. SAG: soft tissue moves down with laxity (age, parity, weight loss) in proportion to its own thickness: dy = -k lax T.
//   6. PREGNANCY: the gravid uterus as an ellipsoid on the pubic symphysis, sized by week (fundal height ~ week in cm), the abdominal
//      wall (fat + 12 mm) pushed out to enclose it; postpartum: a soft residual and laxity.
//   7. RELIEF: the bony landmarks where the person is lean (amplitude x exp(-T / 6 mm)), the folds where fat makes them.
//   8. Ground at y = 0 and a uniform scale to the person's stature.
// build(S, p) -> { pos, eyes, heads, tails, T, N, stature, parts }. Everything is a pure function of p (no randomness here).
// FORM 1 (p.form >= 1; HUMAN c8 FORM, 3 Oct; a record without `form` builds exactly as lane A / P1 left it): layers 2-4 become ONE soft
// tissue: every depot and every muscle belly is low-passed on the surface (formField: umbrella diffusion on the base topology, the
// field's area integral kept) at its own length scale (depots ~6-8 cm, bellies ~4 cm, the breast mound's edge ~3 cm) and the sum is
// displaced along normals smoothed further (8 iterations); a belly's own high-pass comes back only as DEFINITION, scaled by how lean the
// skin over it is (FORM_DEF x exp(-(T + s0) / 8 mm)); bone relief is seen through the person's real subcutaneous layer (s0 from her fat
// fraction, P1's calibration) and the fold creases start at a real fat level (reliefMod). Why: review/studio_human_c8/after/form/NOTES.md.
import { volume } from './measure.js';
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const RACES = ['african', 'asian', 'caucasian'];
const tri = v => v >= 0.5 ? { max: (v - 0.5) * 2, average: 1 - (v - 0.5) * 2, min: 0 } : { min: (0.5 - v) * 2, average: 1 - (0.5 - v) * 2, max: 0 };
const tri1 = v => v >= 0 ? { max: v, average: 1 - v, min: 0 } : { min: -v, average: 1 + v, max: 0 };   // -1..1 axes (cup, firmness)
// MakeHuman's macro rule, as bake_hero.macro (gender 1 = male, 0 = female)
export function macroMix({ gender, age, races, muscle = 0.5, weight = 0.5 }) {
  const gw = { male: gender, female: 1 - gender }, old = clamp((age - 25) / 65), aw = { young: 1 - old, old }, mw = tri(muscle), ww = tri(weight), out = [];
  for (const [g, gv] of Object.entries(gw)) { if (gv <= 0) continue;
    for (const [a, av] of Object.entries(aw)) { if (av <= 0) continue;
      for (const [r, rv] of Object.entries(races)) if (rv > 0) out.push([`macrodetails/${r}-${g}-${a}`, rv * gv * av]);
      for (const [m, mv] of Object.entries(mw)) for (const [w, wv] of Object.entries(ww)) { const k = gv * av * mv * wv; if (k > 1e-4) out.push([`macrodetails/universal-${g}-${a}-${m}muscle-${w}weight`, k]); } } }
  return out;
}
// MakeHuman's breast targets (average muscle only are vendored): cup and firmness on -1..1, mixed with sex, age and macro weight
export function breastMix({ gender, age, weight = 0.5, cup = 0, firm = 0 }) {
  const fw = 1 - gender; if (fw <= 0) return [];
  const old = clamp((age - 25) / 65), aw = { young: 1 - old, old }, ww = tri(weight), cw = tri1(cup), fm = tri1(firm), out = [];
  for (const [a, av] of Object.entries(aw)) for (const [w, wv] of Object.entries(ww)) for (const [c, cv] of Object.entries(cw)) for (const [f, fv] of Object.entries(fm)) {
    if (c === 'average' && f === 'average') continue; const k = fw * av * wv * cv * fv;
    if (k > 1e-4) out.push([`breast/female-${a}-averagemuscle-${w}weight-${c}cup-${f}firmness`, k]); }
  return out;
}
const pm = (name, v) => v > 0 ? [[`${name}-incr`, v]] : v < 0 ? [[`${name}-decr`, -v]] : [];
// ---------------------------------------------------------------- topology helpers (cached on the studio)
function topo(S) {
  if (S._topo) return S._topo;
  const nb = S.nb, t = S.tri, deg = new Uint32Array(nb + 1), seen = new Set(), pairs = [];
  for (let i = 0; i < t.length; i += 3) for (const [a, b] of [[t[i], t[i + 1]], [t[i + 1], t[i + 2]], [t[i + 2], t[i]]]) { const k = a < b ? a * 65536 + b : b * 65536 + a; if (!seen.has(k)) { seen.add(k); pairs.push(a, b); deg[a]++; deg[b]++; } }
  const off = new Uint32Array(nb + 1); for (let i = 0; i < nb; i++) off[i + 1] = off[i] + deg[i];
  const nbr = new Uint32Array(off[nb]), fill = off.slice(0, nb);
  for (let i = 0; i < pairs.length; i += 2) { const a = pairs[i], b = pairs[i + 1]; nbr[fill[a]++] = b; nbr[fill[b]++] = a; }
  const L = S.landmarks, lm = k => L[k];
  return (S._topo = { off, nbr, lm });
}
export function normals(S, P, smoothIt = 2) {
  const nb = S.nb, t = S.tri, N = new Float32Array(nb * 3);
  for (let i = 0; i < t.length; i += 3) { const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const q of [a, b, c]) { N[q] += nx; N[q + 1] += ny; N[q + 2] += nz; } }
  const nz_ = () => { for (let v = 0; v < nb; v++) { const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1; N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l; } };
  nz_();
  const { off, nbr } = topo(S);
  for (let it = 0; it < smoothIt; it++) { const M = new Float32Array(N);
    for (let v = 0; v < nb; v++) { let x = N[v * 3], y = N[v * 3 + 1], z = N[v * 3 + 2]; for (let j = off[v]; j < off[v + 1]; j++) { const u = nbr[j] * 3; x += N[u]; y += N[u + 1]; z += N[u + 2]; } M[v * 3] = x; M[v * 3 + 1] = y; M[v * 3 + 2] = z; }
    N.set(M); nz_(); }
  return N;
}
export function smoothScalar(S, f, it = 4, lam = 0.5, mask = null) {
  const { off, nbr } = topo(S), nb = S.nb; let a = f;
  for (let k = 0; k < it; k++) { const b = new Float32Array(a);
    for (let v = 0; v < nb; v++) { if (mask && !mask[v]) continue; const d = off[v + 1] - off[v]; if (!d) continue; let s = 0; for (let j = off[v]; j < off[v + 1]; j++) s += a[nbr[j]]; b[v] = a[v] + lam * (s / d - a[v]); }
    a = b; }
  return a;
}
// ---------------------------------------------------------------- FORM 1 helpers
// diffusion lengths (umbrella iterations on the base topology, lambda 0.5; torso edges ~1.8 cm, thigh 2.6 cm: 40 its ~ sigma 6-8 cm)
export const FORM_IT = { depot: 40, visceral: 30, muscle: 14, breast: 10 };
export const FORM_DEF = 0.35;                                         // the share of a belly's high-pass kept as definition (lean skin)
// a belly's low-pass share where its broad swell reads as something else: the external oblique's pad over the crest is the 'love handle'
// in a soft body (the iliac roll of a lean one is its high-pass, kept as definition)
export const FORM_LP = { oblique: 0.4 };
function baseArea(S) {
  if (S._bA) return S._bA; const t = S.tri, P = S.base, nb = S.nb, A = new Float32Array(nb);
  for (let i = 0; i < t.length; i += 3) { const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3; if (t[i] >= nb || t[i + 1] >= nb || t[i + 2] >= nb) continue;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 6; A[t[i]] += ar; A[t[i + 1]] += ar; A[t[i + 2]] += ar; }
  return (S._bA = A);
}
// a field low-passed on the surface (dense over the body's nb vertices), its area integral kept; cached per studio
export function formField(S, name, it) {
  const key = name + '@' + it; S._ff ||= new Map(); if (S._ff.has(key)) return S._ff.get(key);
  const fl = S.field(name); if (!fl) { S._ff.set(key, null); return null; }
  const nb = S.nb, f = new Float32Array(nb); for (let i = 0; i < fl.ix.length; i++) if (fl.ix[i] < nb) f[fl.ix[i]] = fl.f[i];
  const g = smoothScalar(S, f, it, 0.5), A = baseArea(S); let s0 = 0, s1 = 0; for (let v = 0; v < nb; v++) { s0 += f[v] * A[v]; s1 += g[v] * A[v]; }
  const k = s1 > 0 ? s0 / s1 : 1; for (let v = 0; v < nb; v++) g[v] *= k;
  const out = { f, g }; S._ff.set(key, out); return out;
}
// the person's own subcutaneous layer under lane A's depots (P1's calibration in detail.js: 1.5 mm + 3 mm per 10 % fat over 6 %)
export const subcut = pf => 0.0015 + 0.03 * Math.max(0, (pf ?? 0.25) - 0.06);
// how much of a relief field shows at fat thickness te (m): bone through fat, folds from a real fat level. Form 0 = lane A's.
export function reliefMod(mode, te, form = 0) {
  if (form >= 1) return mode === 'fold' ? clamp((te - 0.016) / 0.02, 0, 1.6) : 1.5 * Math.exp(-te / 0.009);
  return mode === 'fold' ? clamp((te - 0.006) / 0.02, 0, 1.6) : Math.exp(-te / 0.006);
}
export const reliefBase = p => (p.form || 0) >= 1 ? subcut(p.pf) : 0.003 + 0.01 * clamp(p.mhWeight ?? 0.5);
// a muscle's displacement field as the base mesh carries it (detail.js re-shapes from this): raw (form 0) or low-pass + gated definition
export function muscleField(S, p, name, T = null) {
  if ((p.form || 0) < 1) { const fl = S.field(name); if (!fl) return null; const o = new Float32Array(S.nb); for (let i = 0; i < fl.ix.length; i++) if (fl.ix[i] < S.nb) o[fl.ix[i]] = fl.f[i]; return o; }
  const F = formField(S, name, FORM_IT.muscle); if (!F) return null; const s0 = subcut(p.pf), o = new Float32Array(S.nb);
  const lp = FORM_LP[name] ?? 1; for (let v = 0; v < S.nb; v++) o[v] = lp * F.g[v] + FORM_DEF * Math.exp(-((T ? T[v] : 0) + s0) / 0.008) * (F.f[v] - F.g[v]);
  return o;
}
// ---------------------------------------------------------------- stage A: the MakeHuman part that the fit does not touch
export function frameMix(p) {
  const g = p.sex === 'f' ? 0 : 1, f = p.frame || {}, out = [...macroMix({ gender: g, age: p.age, races: p.races, muscle: p.mhMuscle, weight: p.mhWeight })];
  if (g === 0) out.push(...breastMix({ gender: g, age: p.age, weight: p.mhWeight, cup: p.cup || 0, firm: p.firm || 0 }));
  const B = p.breastShape || {};
  out.push(...pm('breast/breast-dist', B.splay || 0), ...pm('breast/breast-point', B.point || 0));
  if (B.trans) out.push([B.trans > 0 ? 'breast/breast-trans-up' : 'breast/breast-trans-down', Math.abs(B.trans)]);
  if (B.volVert) out.push([B.volVert > 0 ? 'breast/breast-volume-vert-up' : 'breast/breast-volume-vert-down', Math.abs(B.volVert)]);
  out.push(...pm('measure/measure-upperarm-length', f.upperarm || 0), ...pm('measure/measure-lowerarm-length', f.lowerarm || 0), ...pm('measure/measure-napetowaist-dist', f.torso || 0), ...pm('measure/measure-neck-height', f.neck || 0));
  for (const s of 'lr') out.push(...pm(`armslegs/${s}-leg-valgus`, f.valgus || 0), ...pm(`armslegs/${s}-hand-scale`, f.hand || 0), ...pm(`armslegs/${s}-foot-scale`, f.foot || 0));
  for (const [k, w] of Object.entries(p.face || {})) if (w) out.push([k, w]);
  return out;
}
export function stageA(S, p) {
  const V = new Float32Array(S.base);
  addTargets(S, V, frameMix(p));
  return V;
}
export function addTargets(S, V, list) {
  for (const [name, w] of list) { if (!w) continue; const t = S.target(name); if (!t) { (S._missing ||= new Set()).add(name); continue; }
    const ix = t.ix, d = t.d; for (let i = 0; i < ix.length; i++) { const q = ix[i] * 3; V[q] += w * d[i * 3]; V[q + 1] += w * d[i * 3 + 1]; V[q + 2] += w * d[i * 3 + 2]; } }
}
// the helper vertices of every joint of the leg chains (heads and tails of upperleg*, lowerleg*, foot*, toe*, and any joint within 1.5 cm
// of a hip joint, e.g. pelvis.L's tail): moved with the legs as one piece by the hip-spacing lever
function legJoints(S) {
  if (S._legJ) return S._legJ;
  const B = S.basis.bones, J = S.basis.joints, js = new Set(), out = new Set();
  for (const b of B) if (/^(upperleg|lowerleg|foot|toe)/.test(b.name)) { js.add(b.head); js.add(b.tail); }
  const hip = [boneJ(S, 'upperleg01.L'), boneJ(S, 'upperleg01.R')].map(j => jointMean(S, S.base, j));
  J.forEach((_, j) => { const m = jointMean(S, S.base, j); if (hip.some(h => Math.hypot(m[0] - h[0], m[1] - h[1], m[2] - h[2]) < 0.15)) js.add(j); });
  for (const j of js) for (const v of J[j]) out.add(v);
  return (S._legJ = out);
}
const jointMean = (S, V, j) => { const ids = S.basis.joints[j]; let x = 0, y = 0, z = 0; for (const i of ids) { x += V[i * 3]; y += V[i * 3 + 1]; z += V[i * 3 + 2]; } return [x / ids.length, y / ids.length, z / ids.length]; };
const boneJ = (S, name, end = 'head') => { const b = S.basis.bones.find(x => x.name === name); return b[end]; };
// ---------------------------------------------------------------- stage B: frame fit parameters, joints, eyes, then the soft layers
export function build(S, p, VA = null) {
  const n = S.n, nb = S.nb, V = new Float32Array(VA || stageA(S, p)), f = p.frame || {};
  addTargets(S, V, [...pm('measure/measure-shoulder-dist', f.shoulder || 0), ...pm('measure/measure-waist-circ', f.waist || 0), ...pm('armslegs/upperlegs-height', f.legs || 0), ...pm('armslegs/lowerlegs-height', (f.legs || 0) + (f.shins || 0))]);
  // pelvis breadth: x scaled about the midline on the pelvis weights, the legs carried with the hip joints
  if (f.pelvis && f.pelvis !== 1) { const wp = S.dense('pelvisW'), wl = S.dense('legW'), hj = jointMean(S, V, boneJ(S, 'upperleg01.L')), k = f.pelvis - 1;
    for (let v = 0; v < n; v++) { const x = V[v * 3]; V[v * 3] = x + k * (wp[v] * x + (1 - wp[v]) * wl[v] * Math.sign(x) * Math.abs(hj[0])); } }
  // iliac flare: the pelvis widened (or narrowed) at the crests and not at the hip joints: x scaled on the pelvis weights by a bump that is
  // 0 at the hip-joint level, 1 at the crests and fades over half that height above them (a woman's crests stand wide of her waist),
  if (f.flare) { const wp = S.dense('pelvisW'), L = S.landmarks, yc = (V[L.iliacCrestL * 3 + 1] + V[L.iliacCrestR * 3 + 1]) / 2, yh = jointMean(S, V, boneJ(S, 'upperleg01.L'))[1], k = f.flare, dh = yc - yh;
    const zc = (V[L.asisL * 3 + 2] + V[L.psisL * 3 + 2]) / 2;      // and flattened front to back about the pelvis's own middle, so a tape there grows little
    for (let v = 0; v < n; v++) { const w = wp[v]; if (!w) continue; const y = V[v * 3 + 1], u = y <= yc ? clamp((y - yh) / dh) : 1 - clamp((y - yc) / (0.5 * dh)), b = u * u * (3 - 2 * u), e = 1 + k * w * b;
      V[v * 3] *= e; V[v * 3 + 2] = zc + (V[v * 3 + 2] - zc) / e; } }
  // hip-joint spacing (P1, 3 Oct): MakeHuman's hip joint centres sit 18.9 (women) to 22.2 cm (men) apart where Harrington et al. 2007
  // (J Biomech 40:595) put them at 2 x (0.33 inter-ASIS + 7.3 mm) on the same pelvis (~16 cm); the legs, the hip joints and every joint
  // below them move medially by f.hipSpacing (0 = MakeHuman's, 1 = Harrington's) of the difference. Taken AFTER the pelvis and flare
  // levers (which carry the legs), so the joints land on the regression whatever the pelvis breadth. Between the midline and the hip
  // joint the upper thigh is compressed rather than shifted (nothing crosses the midline), fading to a rigid shift 10-20 cm below the
  // joint. The lateral hip (trochanter) comes in with the leg: the hip breadth falls, the fit puts the hip tape back through depth.
  if (f.hipSpacing) { const legJ = legJoints(S), wl = S.dense('legW'), hl = jointMean(S, V, boneJ(S, 'upperleg01.L')), hr = jointMean(S, V, boneJ(S, 'upperleg01.R')), L = S.landmarks;
    const pw = Math.abs(V[L.asisL * 3] - V[L.asisR * 3]) - 0.2, want = 0.33 * pw + 0.073, cur = (hl[0] - hr[0]) / 2, d = (cur - want) * f.hipSpacing, yh = (hl[1] + hr[1]) / 2;
    if (d > 0) for (let v = 0; v < n; v++) { const w = legJ.has(v) ? 1 : wl[v]; if (!w) continue; const x = V[v * 3], ax = Math.abs(x);
      const c = legJ.has(v) ? 1 : (q => q + (1 - q) * clamp((yh - 1.0 - V[v * 3 + 1]) / 1.0))(clamp(ax / cur) ** 1.5);
      V[v * 3] = x - Math.sign(x) * d * w * c; } }
  // head scale about the head joint on the head bones' skin weights (the head canon from stature)
  if (f.head && f.head !== 1) { const wh = S.dense('headW'), c = jointMean(S, V, boneJ(S, 'neck03', 'tail')), k = f.head - 1;
    for (let v = 0; v < n; v++) { const w = wh[v]; if (!w) continue; for (let a = 0; a < 3; a++) V[v * 3 + a] = c[a] + (V[v * 3 + a] - c[a]) * (1 + k * w); } }
  const bones = S.basis.bones, jv = S.basis.joints.map((_, j) => jointMean(S, V, j));
  // eyes: MakeHuman proxy fitting on this mesh (barycentric + offset scaled by the mesh's own x/y/z measures)
  const E = S.eyes, sc = ['x', 'y', 'z'].map((a, i) => { const [u, w, d] = E.scale[a]; return Math.abs(V[u * 3 + i] - V[w * 3 + i]) / d; }), eyes = new Float32Array(E.ne * 3);
  for (let k = 0; k < E.ne; k++) for (let a = 0; a < 3; a++) { let s = 0; for (let m = 0; m < 3; m++) s += E.w[k * 3 + m] * V[E.idx[k * 3 + m] * 3 + a]; eyes[k * 3 + a] = s + E.off[k * 3 + a] * sc[a]; }
  // to metres (ground and stature come last)
  const P = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) P[i] = V[i] * 0.1;
  const N = normals(S, P, 2), T = new Float32Array(nb), parts = {}, pre = new Float32Array(P.subarray(0, nb * 3));   // pre: the frame before soft tissue (bony measures)
  const lay = (name, amp, dir = null, acc = null) => { if (!amp) return; const fl = S.field(name); if (!fl) return; const ix = fl.ix, fv = fl.f;
    for (let i = 0; i < ix.length; i++) { const v = ix[i]; if (v >= nb) continue; const a = amp * fv[i]; let nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
      if (dir) { nx += dir[0]; ny += dir[1]; nz += dir[2]; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l; }
      P[v * 3] += a * nx; P[v * 3 + 1] += a * ny; P[v * 3 + 2] += a * nz; if (acc) acc[v] += a; } };
  const F1 = (p.form || 0) >= 1;
  if (!F1) {
  // 2. muscle
  for (const [name, a] of Object.entries(p.muscle || {})) lay(name, a);
  // 3. fat (the visceral dome along N + forward)
  for (const [name, a] of Object.entries(p.fat || {})) { const m = S.basis.fields[name]; if (!m) continue; lay(name, a, m.dir || null, T); }
  } else softTissue(S, p, P, T);
  // contact: the medial thighs meet at the midline
  { const c = S.field('contactThigh'); if (c) for (let i = 0; i < c.ix.length; i++) { const v = c.ix[i], w = c.f[i], x0 = S.base[v * 3], x = P[v * 3]; if (w < 0.05 || Math.abs(x0) < 1e-4) continue; const s = Math.sign(x0), lim = 0.0025;
      if (s * x < lim) P[v * 3] = x + (s * lim - x) * Math.min(1, w * 2); } }
  // 4. breast (women): our mound beyond the cup targets, and ptosis inside the footprint
  if (p.breast && !F1) { const B = p.breast, tb = new Float32Array(nb); lay('breastMound', B.mound || 0, [0, -0.1, 0.25], tb); parts.breastMoundT = tb;
    if (B.sag) { const fl = S.field('breastMound'); for (let i = 0; i < fl.ix.length; i++) { const v = fl.ix[i], w = fl.f[i]; P[v * 3 + 1] -= B.sag * w * w; P[v * 3 + 2] += 0.25 * B.sag * w * w; } } }
  if (p.breast && F1) { const B = p.breast, tb = new Float32Array(nb), F = formField(S, 'breastMound', FORM_IT.breast), d0 = [0, -0.1, 0.25];   // the mound's edge blended into the chest
    if (F) for (let v = 0; v < nb; v++) { const w = F.g[v]; if (w < 1e-4) continue; const a = (B.mound || 0) * w; let nx = N[v * 3] + d0[0], ny = N[v * 3 + 1] + d0[1], nz = N[v * 3 + 2] + d0[2]; const l = Math.hypot(nx, ny, nz);
      P[v * 3] += a * nx / l; P[v * 3 + 1] += a * ny / l; P[v * 3 + 2] += a * nz / l; tb[v] = a; if (B.sag) { const w2 = Math.min(1, w) ** 2; P[v * 3 + 1] -= B.sag * w2; P[v * 3 + 2] += 0.25 * B.sag * w2; } }
    parts.breastMoundT = tb; }
  // 5. sag with laxity, proportional to the soft tissue's own thickness
  if (p.laxity) { const sg = S.field('sag'); for (let i = 0; i < sg.ix.length; i++) { const v = sg.ix[i]; if (v >= nb) continue; P[v * 3 + 1] -= p.laxity * 0.45 * sg.f[i] * (T[v] + 0.004); P[v * 3 + 2] += p.laxity * 0.08 * sg.f[i] * T[v] * Math.sign(N[v * 3 + 2]); } }
  // 6. pregnancy / postpartum
  if (p.preg) pregnancy(S, P, N, T, p.preg, jv, parts, p.stature, pre);
  // 7. relief: bone where lean, folds where fat
  const rk = p.relief ?? 1, base0 = reliefBase(p), fm = p.form || 0;
  if (rk) for (const name of S.fieldsOf('relief')) { const fl = S.field(name), m = fl.meta, amp = m.amp * rk * (p.reliefK?.[name] ?? 1);
    for (let i = 0; i < fl.ix.length; i++) { const v = fl.ix[i]; if (v >= nb) continue; const te = T[v] + base0, mod = reliefMod(m.mode, te, fm), a = amp * fl.f[i] * mod;
      P[v * 3] += a * N[v * 3]; P[v * 3 + 1] += a * N[v * 3 + 1]; P[v * 3 + 2] += a * N[v * 3 + 2]; } }
  // 8. ground and stature (joints and eyes ride along)
  let y0 = Infinity, y1 = -Infinity; for (let v = 0; v < nb; v++) { const y = P[v * 3 + 1]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const s = p.stature ? p.stature / (y1 - y0) : 1;
  for (let i = 0; i < n; i++) { P[i * 3] *= s; P[i * 3 + 1] = (P[i * 3 + 1] - y0) * s; P[i * 3 + 2] *= s; }
  for (let i = 0; i < E.ne; i++) { eyes[i * 3] *= 0.1 * s; eyes[i * 3 + 1] = (eyes[i * 3 + 1] * 0.1 - y0) * s; eyes[i * 3 + 2] *= 0.1 * s; }
  const J = jv.map(q => [q[0] * 0.1 * s, (q[1] * 0.1 - y0) * s, q[2] * 0.1 * s]);
  for (let v = 0; v < nb; v++) { T[v] *= s; pre[v * 3] *= s; pre[v * 3 + 1] = (pre[v * 3 + 1] - y0) * s; pre[v * 3 + 2] *= s; }
  const heads = bones.map(b => J[b.head]), tails = bones.map(b => J[b.tail]);
  if (parts.uterus) { const u = parts.uterus; u.c = [u.c[0] * s, (u.c[1] - y0) * s, u.c[2] * s]; u.r = u.r.map(r => r * s); }
  return { pos: P, pre, eyes, heads, tails, T, N, stature: (y1 - y0) * s, scale: s, parts, joints: J };
}
// FORM 1: muscle and fat as one soft tissue, low-passed, along well-smoothed normals; T = the fat part (for sag, relief, detail)
function softTissue(S, p, P, T) {
  const nb = S.nb, Ns = normals(S, P, 8), M = new Float32Array(nb), H = new Float32Array(nb), V = new Float32Array(nb);
  for (const [name, a] of Object.entries(p.fat || {})) { if (!a) continue; const m = S.basis.fields[name]; if (!m) continue; const F = formField(S, name, m.dir ? FORM_IT.visceral : FORM_IT.depot); if (!F) continue;
    const dst = m.dir ? V : T; for (let v = 0; v < nb; v++) dst[v] += a * F.g[v]; }
  for (const [name, a] of Object.entries(p.muscle || {})) { if (!a) continue; const F = formField(S, name, FORM_IT.muscle); if (!F) continue; const lp = FORM_LP[name] ?? 1; for (let v = 0; v < nb; v++) { M[v] += a * lp * F.g[v]; H[v] += a * (F.f[v] - F.g[v]); } }
  const s0 = subcut(p.pf), vd = (S.basis.fields.visceral || {}).dir || [0, 0, 1.6];
  for (let v = 0; v < nb; v++) { const d = M[v] + FORM_DEF * Math.exp(-(T[v] + V[v] + s0) / 0.008) * H[v] + T[v];
    let x = Ns[v * 3], y = Ns[v * 3 + 1], z = Ns[v * 3 + 2]; P[v * 3] += d * x; P[v * 3 + 1] += d * y; P[v * 3 + 2] += d * z;
    if (V[v]) { x += vd[0]; y += vd[1]; z += vd[2]; const l = Math.hypot(x, y, z); P[v * 3] += V[v] * x / l; P[v * 3 + 1] += V[v] * y / l; P[v * 3 + 2] += V[v] * z / l; T[v] += V[v]; } }
}
// the gravid uterus, by week: an ellipsoid standing on the symphysis, anteverted; fundal height ~ week (cm) for weeks 20-36
export function uterusAt(week) {
  const w = clamp(week, 0, 41), fh = w <= 12 ? 4 + w * 0.25 : w <= 20 ? 7 + (w - 12) * (13 / 8) : w <= 37 ? w : 37 - (w - 37) * 0.3;
  const L = Math.max(0.07, fh / 100 * 0.98), W = 0.74 * L, D = 0.7 * L;
  return { fundalHeightCm: +fh.toFixed(1), length: L, width: W, depth: D };
}
function pregnancy(S, P, N, T, pr, jv, parts, stature = null, pre = null) {
  const nb = S.nb, lm = S.landmarks, pub = lm.pubis, nav = lm.omphalion, ab = S.field('abdomen');
  const wk = pr.week ?? 0, pp = pr.postpartumMonths;
  let week = wk; if (pp != null) week = 16 * Math.exp(-pp / 1.2);          // a soft residual after birth, involuting over weeks
  if (week < 8 || !ab) return;
  const Q = pre || P, U = uterusAt(week), pb = [Q[pub * 3], Q[pub * 3 + 1], Q[pub * 3 + 2]], nv = [Q[nav * 3], Q[nav * 3 + 1], Q[nav * 3 + 2]];   // anchored on the bony frame (run 2: a heavy mons carried it forward)
  // axis: from just inside the symphysis toward the navel's inside, tipped forward (anteversion)
  const base = [0, pb[1] + 0.01, pb[2] - 0.045], up = [0, 1, 0.3], ul = Math.hypot(...up), ax = up.map(x => x / ul);
  const c = base.map((x, i) => x + ax[i] * U.length * 0.5);
  const ey = ax, ex = [1, 0, 0], ez = [0, -ax[2], ax[1]];               // ellipsoid frame: long axis ey, width ex, depth ez (forward)
  const disp = new Float32Array(nb * 3), wall = 0.012;
  for (let i = 0; i < ab.ix.length; i++) { const v = ab.ix[i]; if (v >= nb) continue; const m = ab.f[i]; if (m < 0.02) continue;
    const d = [P[v * 3] - c[0], P[v * 3 + 1] - c[1], P[v * 3 + 2] - c[2]], r = Math.hypot(...d); if (r < 1e-6) continue;
    const u = d.map(x => x / r), a = u[0] * ex[0] + u[1] * ex[1] + u[2] * ex[2], b = u[0] * ey[0] + u[1] * ey[1] + u[2] * ey[2], e = u[0] * ez[0] + u[1] * ez[1] + u[2] * ez[2];
    const re = 1 / Math.sqrt((a / (U.width / 2)) ** 2 + (b / (U.length / 2)) ** 2 + (Math.max(e, -0.2) / (U.depth / 2)) ** 2), need = re + wall + T[v];
    if (r < need) { const k = (need - r) * m; disp[v * 3] = u[0] * k; disp[v * 3 + 1] = u[1] * k; disp[v * 3 + 2] = u[2] * k; } }
  // run 2: the bump must add the uterus's own volume whatever the body. In a heavy woman the enclosure alone can sit inside her belly and
  // show nothing (the 36-week cast woman did), so after the enclosure the abdominal wall is pushed further out, forward-weighted, until
  // the mesh's added volume reaches 85 % of the uterus and its contents by week (IOM 2009 term components: fetus 3.4, placenta 0.65,
  // fluid 0.8, uterus 0.97 kg ~ L; the 85 % is OUR assumption: the rest is taken up by viscera moving up and aside). Measured, not estimated:
  // two mesh volumes and a secant step.
  const f = clamp(week / 40), contents = 3.4 * f ** 3.2 + 0.65 * f ** 1.5 + 0.8 * clamp((week - 10) / 25) + 0.97 * f ** 1.2;
  let y0 = Infinity, y1 = -Infinity; for (let v = 0; v < nb; v++) { const y = P[v * 3 + 1]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const sc = stature ? stature / (y1 - y0) : 1, want = 0.85 * contents / 1000 / (sc * sc * sc), V0 = volume(S, P);
  const smooth3 = D => { const out = new Float32Array(nb * 3); for (let a = 0; a < 3; a++) { let g = new Float32Array(nb); for (let v = 0; v < nb; v++) g[v] = D[v * 3 + a]; g = smoothScalar(S, g, 8, 0.5); for (let v = 0; v < nb; v++) out[v * 3 + a] = g[v]; } return out; };
  const E = smooth3(disp); for (let i = 0; i < nb * 3; i++) P[i] += E[i];
  const V1 = volume(S, P); let k = 0;
  if (V1 - V0 < want) { const gx = new Float32Array(nb * 3);
    for (let i = 0; i < ab.ix.length; i++) { const v = ab.ix[i]; if (v >= nb) continue; const m = ab.f[i]; if (m < 0.02) continue;
      const d = [P[v * 3] - c[0], P[v * 3 + 1] - c[1], P[v * 3 + 2] - c[2]], r = Math.hypot(...d); if (r < 1e-6) continue; const u = d.map(x => x / r), e = u[0] * ez[0] + u[1] * ez[1] + u[2] * ez[2];
      const g = m * Math.max(0, e) ** 1.5 * clamp(1 - Math.abs(P[v * 3 + 1] - c[1]) / (U.length * 0.75)); gx[v * 3] = g * u[0]; gx[v * 3 + 1] = g * u[1]; gx[v * 3 + 2] = g * u[2]; }
    const G = smooth3(gx), k0 = 0.03; for (let i = 0; i < nb * 3; i++) P[i] += k0 * G[i];
    const V2 = volume(S, P); k = V2 > V1 ? clamp(k0 * (want - (V1 - V0)) / (V2 - V1), 0, 0.2) : k0; for (let i = 0; i < nb * 3; i++) P[i] += (k - k0) * G[i]; }
  parts.bumpVolumeL = +((volume(S, P) - V0) * sc * sc * sc * 1000).toFixed(2); parts.bumpWantL = +(0.85 * contents).toFixed(2); parts.bumpPush = +k.toFixed(4);
  parts.uterus = { week: +week.toFixed(1), ...U, c, r: [U.width / 2, U.length / 2, U.depth / 2], axis: ax };
}
