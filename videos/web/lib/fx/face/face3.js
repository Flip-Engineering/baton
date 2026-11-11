// FACE3 (HUMAN c8 round 3, 3 Oct): the women's heads, the seams, the eyes, the resting expression and an optional light make-up,
// on top of FACE c2. Opt-in: nothing imports this file unless asked (makePerson v2 with `opts.face3`, lab_person `face3=1`); a
// person built without it renders exactly as before.
//
// What it does (each part switchable through the spec: dimorph, expr, seal, makeup, eyes, seams):
//  1. DIMORPHISM WITHIN RANGE (women): a per-person femininity d (drawn around the women's own mean, never one ideal: d ~ 0.65 +- 0.18,
//     0.3..0.9, by the person's own seed) moves MakeHuman's CC0 face targets a few millimetres along the directions that separate
//     women's faces from men's in the anthropometric and perception literature: higher brows with more arch and a flatter brow ridge
//     (Farkas 1994; Enlow and Hans 1996), a narrower, less projecting chin and a softer gonial angle, fuller upper lips, fuller and
//     higher cheeks (malar fat; Sultanova et al. 2026's CT: women carry more tissue over the zygoma), a smaller nose with a slightly
//     upturned tip (Perrett et al. 1998 found the feminised direction preferred, moderately; we stay within range). The card brows
//     (lane D) follow: lifted and arched by the same d, lashes a little longer and denser. Group and age scale the parts the tables
//     already carry (East Asian brow ridge lower, Black women's lips already fuller, lip volume falls with age).
//  2. EXPRESSION, seeded per person: a closed-mouth neutral or a slight smile (hero.js's zygomaticus unit, mouth-corner-puller, at a
//     corner lift of 1.6-3 mm, with a trace of the lower-lid raise of a real smile, Duchenne's orbicularis), then the LIPS SEALED:
//     hm08's upper lip's front edge sits ~1 mm above the lower lip's top (the 'slack, slightly open mouth'): the upper lip's margin comes
//     down to rest on the lower lip (70 / 30), column by column, tapering to the corners. hero.js's painted 3 mm parting band is
//     traded for a 0.5 mm contact line along the lips' real meeting line (through the corners).
//  3. SEAMS: the 1-px lines a GPU draws where a shader takes derivatives inside non-uniform control flow (lane D's hairline and
//     beard-zone bump and follicle dashes; P1's vein bands). The real fixes belong in hair/shade.js (HAIR3) and body/detail.js; this
//     applies them from outside, guarded (a missing text changes nothing and is reported): the derivatives are taken in uniform flow
//     and only the result is masked, so away from the contour every pixel is what it was.
//  4. EYES (lane B's likeness/eyes.js, its opt-in `wet` option): a tear meniscus strip along the lower lid margin, a caruncle at the
//     inner corner, a deeper lid occlusion, a wetter tear film and the globe's falloff toward the corners.
//  5. MAKE-UP (optional, light; off by default, on in casting presets where appropriate): brow fill (lane D's soft brow base under the
//     cards, stronger), a little lip colour by skin depth, lash darkening (a 0.5 mm line at the upper lash roots; lashes a little longer),
//     a touch more evenness. Women's faces show more luminance contrast between the eyes, lips and the surrounding skin than men's
//     (Russell 2009, 'A sex difference in facial contrast'); light make-up raises it a little, which is why it reads.
//
//   import { face3Spec, face3Data, face3Skin, FACE3_CAST } from '../face/face3.js';
//   const s = face3Spec(info, { seed, ...FACE3_CAST[name], ...opts });   // info: { name, sex, age, group }
//   const r = await face3Data(data, variant, s);   // { data, variant, f3 }: a hero data object with the face3 positions (before new Hero)
//   ... new Hero(r.data, ...), hair with { ...r.f3.hair }, applySkin, fitLipMask ...
//   face3Skin(h, r.f3);   // AFTER applySkin and fitLipMask: contact line, make-up, the seam fix (an H1 skin hook + a guarded patch)
//   buildEyes(h, { ...r.f3.eyes });   // lane B's eyes with the wet option
import { loadFaceStudio } from './data.js';
import { rng, gauss, clamp, hashStr, groupMix, baseMix } from './sample.js';
import { face4Spec } from './face4.js';
import { mouthSpec, mouthSkin } from './mouth.js';
import { face5Spec, face5Shape, face5Skin } from './face5.js';
import { face6Spec } from './face6.js';
import { face7Spec, f6ExprOf, face7Geo, face7Hair, face7Eyes, face7Skin } from './face7.js';
import { face9Spec, face9Apply } from './face9.js';   // ANAT8-HEAD face rev 9 (opt-in: f9)

export const FACE3_VERSION = 1;
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// the casting presets (V2_PLAN's twelve): make-up where it fits the person; the rest draw from their seed
export const FACE3_CAST = {
  L08_f24_hispanic: { makeup: 'light' }, L22_f27_black: { makeup: 'light' }, L20_f29_asian: { makeup: 'light' },
  L12_f39_white: { makeup: 'light' }, L14_f42_black: { makeup: null }, L06_f53_white: { makeup: 'light' },
};

// women's dimorphism: [target, weight per unit d, scale(ctx)] (MakeHuman CC0 targets, face_basis.json; weights OURS, a few mm in all)
// measured at weight 1 on hm08 (face3_probe2): brow up 4-6 mm, brow back 3-4 mm, chin narrower ~5 mm, chin back 9 mm, upper lip +1.5 mm
// forward, cheek bones +6 mm out, cheek up +5 mm, nose tip -12 mm depth (so the weights below move 0.5-2.5 mm)
const both = (pre, suf) => [`${pre}/l-${suf}`, `${pre}/r-${suf}`];
export const DIMORPH_F = [
  ['eyebrows/eyebrows-trans-up', 0.32, c => 1 - 0.3 * c.ageK],
  ['eyebrows/eyebrows-trans-backward', 0.42, c => 1 - 0.45 * c.asian],
  ['eyebrows/eyebrows-angle-up', 0.18, () => 1],
  ['chin/chin-bones-decr', 0.55, () => 1],
  ['chin/chin-width-decr', 0.45, () => 1],
  ['chin/chin-prominent-decr', 0.12, () => 1],
  ['chin/chin-height-decr', 0.1, () => 1],
  ['mouth/mouth-upperlip-volume-incr', 0.38, c => (1 - 0.5 * c.black) * (1 - 0.4 * c.ageK)],
  ['mouth/mouth-lowerlip-volume-incr', 0.1, c => (1 - 0.5 * c.black) * (1 - 0.4 * c.ageK)],
  ...both('cheek', 'cheek-bones-incr').map(t => [t, 0.22, () => 1]),
  ...both('cheek', 'cheek-trans-up').map(t => [t, 0.18, c => 1 - 0.5 * c.ageK]),
  ...both('cheek', 'cheek-volume-incr').map(t => [t, 0.18, c => 1 - 0.3 * c.ageK]),
  ['nose/nose-scale-horiz-decr', 0.25, () => 1],
  ['nose/nose-scale-depth-decr', 0.1, () => 1],
  ['nose/nose-point-up', 0.15, c => 1 - 0.5 * c.ageK],
  // a slightly more open eye: c2's lids sit at MRD1 ~4 mm (Zhou 2026: women +0.35 mm over men); eye-height2 opens ps +1.9 / pi -1.4 mm at 1
  ...both('eyes', 'eye-height2-incr').map(t => [t, 0.2, c => 1 - 0.3 * c.asian]),
];

// ---------------------------------------------------------------- the spec (per person, seeded)
// info: { name, sex, age, group }; o: { seed, fem (0..1 or null = drawn), dimorph, expr ('neutral' | 'smile' | null = drawn),
//   smile (corner lift mm), seal, makeup ('light' | null), eyes (true | lane B wet params | false), seams, hair (true) }
export function face3Spec(info, o = {}) {
  // FACE6 (face rev 7, opt-in: rev 7, or rev >= 4 with an `f6` object): the face from our tissue system (face6.js); f6.age re-ages the face
  const F6on = (o.rev ?? 1) >= 4 && ((o.rev ?? 1) >= 7 || o.f6 === true || (o.f6 && typeof o.f6 === 'object')) && o.f6 !== false;
  if (F6on && typeof o.f6 === 'object' && o.f6.age != null) info = { ...info, age: o.f6.age, ageCast: info.age };
  const r = rng((hashStr('face3:' + (info.name || '')) ^ Math.imul((o.seed ?? 1) + 7, 2654435761)) >>> 0);
  const f = info.sex === 'f', g1 = gauss(r), g2 = gauss(r), u = r(), u2 = r();
  const fem = f ? clamp(o.fem ?? 0.65 + 0.18 * clamp(g1, -1.7, 1.7), 0, 1) : 0;
  if (F6on) return face3Spec7(info, o, fem);
  const kind = o.expr ?? (u < 0.45 ? 'neutral' : 'smile');
  // corner lift above the stomion (mm): a neutral mouth rests level or a hair up; a slight smile 1.6-3 mm (a grin is 6+)
  // FACE4 (rev 4, opt-in): neutral-to-pleasant only: a neutral rests a little lifted (women 0.8-1.3, men 0.4-0.9 mm: the reference
  // photographs' closed mouths, c2's note), a slight smile 1.6-2.4 mm; a trace of the lower-lid raise on the neutral too (soft eyes)
  const R4 = (o.rev ?? 1) >= 4;
  const lift = o.smile ?? (kind === 'smile' ? (R4 ? 1.6 + 0.8 * u2 : 1.6 + 1.4 * u2) : R4 ? (f ? 0.8 + 0.5 * u2 : 0.4 + 0.5 * u2) : 0.2 + 0.4 * u2);
  return { v: FACE3_VERSION, name: info.name, sex: info.sex, age: info.age ?? 35, group: info.group || 'white', fem, dimorph: o.dimorph ?? true,
    expr: { kind, lift: +lift.toFixed(2), squint: kind === 'smile' ? +(0.06 + 0.05 * clamp(g2, -1, 1)).toFixed(3) : 0, ...(R4 ? { base: +(f ? 0.8 + 0.5 * u2 : 0.4 + 0.5 * u2).toFixed(2) } : {}) },
    seal: o.seal ?? true, makeup: o.makeup === undefined ? null : o.makeup, eyes: o.eyes ?? true, seams: o.seams ?? true, hair: o.hair ?? true,
    ...(R4 ? { rev: (o.rev ?? 1) >= 5 ? 5 : 4, f4: face4Spec(info, o) } : {}),
    // MOUTH (rev 5, opt-in; or rev 4 with a `mouth` object): the lips' form from the scans, their colour from the same outline (mouth.js)
    ...(R4 && ((o.rev ?? 1) >= 5 || o.mouth === true || (o.mouth && typeof o.mouth === 'object')) && o.mouth !== false ? { mouth: mouthSpec(info, o) } : {}),
    // FACE5 (face rev 6, opt-in: rev 6, or rev 4 / 5 with an `f5` object): age-true creases, a pleasant rest, lips, eyes (face5.js)
    ...(R4 && ((o.rev ?? 1) >= 6 || o.f5 === true || (o.f5 && typeof o.f5 === 'object')) && o.f5 !== false ? { f5: face5Spec(info, o) } : {}) };
}

// face rev 7 (FACE6): v5's rev 6 spec with the tissue system on: FACE4's scan identity off (f6.scanId puts it back), its retune with
// MakeHuman's age and fat targets at 0, FACE3's dimorphism targets off (the skeleton's sex and femininity terms carry it), the expression
// FACE3 / MOUTH / FACE5 drew replaced by our muscles (face6.js), FACE5's age geometry by the layers (its skin zones, lips and eyes kept)
function face3Spec7(info, o, fem) {
  // FACE7 (face rev 8, opt-in: an `f7` object or true): FACE6's rest with FACE7's expression defaults (the person's own f6.expr wins)
  const f7 = o.f7 && o.f7 !== false ? face7Spec(info, o) : null;
  if (f7) { const f6o = typeof o.f6 === 'object' && o.f6 ? o.f6 : {}; const ex = f6ExprOf(f7, f6o.expr); o = { ...o, f6: { ...f6o, ...(ex ? { expr: ex } : {}) } }; }
  const f6 = face6Spec(info, { ...o, fem: info.sex === 'f' ? fem : null });
  const f4o = { ...(typeof o.f4 === 'object' ? o.f4 : {}), retune: f6.retune, ...(f6.scanId ? {} : { id: false }) };
  const mo = mouthSpec(info, o); mo.rest = false; if (f6.lips === false) mo.shape = false;
  const f5 = face5Spec(info, o); f5.rest = false; f5.ageGeo = false;
  return { v: FACE3_VERSION, name: info.name, sex: info.sex, age: info.age ?? 35, group: info.group || 'white', fem, dimorph: !!f6.dimorph,
    expr: { kind: 'neutral', lift: 0, squint: 0, base: 0 }, seal: o.seal ?? true, makeup: o.makeup === undefined ? null : o.makeup, eyes: o.eyes ?? true, seams: o.seams ?? true, hair: o.hair ?? true,
    rev: 7, f4: face4Spec(info, { ...o, f4: f4o }), mouth: mo, f5, f6, ...(f7 ? { f7 } : {}), ...(o.f9 ? { f9: face9Spec(info, o) } : {}) };   // ANAT8-HEAD face rev 9 (opt-in: f9)
}

// ---------------------------------------------------------------- geometry
function addTarget(F, P, name, w, k, n) { if (!w) return 0; const t = F.target(name); if (!t) return 0; const { ix, d } = t; let mx = 0;
  for (let i = 0; i < ix.length; i++) { const v = ix[i]; if (v >= n) continue; const q = v * 3; P[q] += w * k * d[i * 3]; P[q + 1] += w * k * d[i * 3 + 1]; P[q + 2] += w * k * d[i * 3 + 2];
    mx = Math.max(mx, Math.abs(w * k) * Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2])); }
  return mx; }
const at = (P, v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
// the lips' meeting line (c2's: the stomion at the middle, the corners at the sides)
function mouthLine(P, I) { const sto = at(P, I.sto), cL = at(P, I.ch_L), cR = at(P, I.ch_R), half = Math.abs(cL[0] - cR[0]) / 2, yc = 0.5 * (cL[1] + cR[1]);
  return { sto, half, yc, line: x => sto[1] + (yc - sto[1]) * Math.min(1, (x / half) ** 2) }; }
// the visible gap at the midline: the upper lip's lowest FRONT vertex over the lower lip's highest front vertex (m)
function midGap(P, I, up, lo, nb) { const sto = at(P, I.sto); let yU = Infinity, yL = -Infinity;
  for (let v = 0; v < nb; v++) { const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; if (Math.abs(x) > 0.0016 || z < sto[2] - 0.0015) continue;
    if (up[v] && y > sto[1] - 0.001 && y < sto[1] + 0.004) yU = Math.min(yU, y); if (lo[v] && y < sto[1] + 0.002 && y > sto[1] - 0.004) yL = Math.max(yL, y); }
  return { yU, yL, gap: isFinite(yU) && isFinite(yL) ? yU - yL : 0 }; }

// face3Shape(F, P, nb, n, expr, spec) -> { P, report }: dimorphism, the expression, the seal (positions in the data's bind space, metres)
export function face3Shape(F, pos, nb, n, expr, spec, mid = null) {
  const I = F.ids, P = new Float32Array(pos), R = { fem: +spec.fem.toFixed(3) };
  // metres per target decimetre at this head's size: the targets are MakeHuman decimetres on hm08, whose head (vertex to menton) is
  // baseHeadHeightDm decimetres. (face.js makeFace uses 0.1 x this: P2 / c2's features act at a TENTH of MakeHuman's strength; see NOTES)
  const k = (P[I.v * 3 + 1] - P[I.me * 3 + 1]) / (F.lm.baseHeadHeightDm || 2.3358);
  // 1. dimorphism (women)
  if (spec.sex === 'f' && spec.dimorph && spec.fem > 0) { const gm = baseMix(groupMix(spec.group)), c = { ...gm, ageK: clamp(((spec.age ?? 35) - 30) / 50) }; R.dimorph = {};
    // rev 4: the fuller upper lip at half (FACE4 caps the lips after), no extra eye opening (FACE4 lowers the lids)
    const g4 = t => (spec.rev ?? 3) < 4 ? 1 : /^mouth\/.*volume-incr/.test(t) ? 0.5 : /eye-height2/.test(t) ? 0 : 1;
    for (const [t, w, sc] of DIMORPH_F) { const ww = w * spec.fem * sc(c) * g4(t); const mx = addTarget(F, P, t, ww, k, n); if (mx) R.dimorph[t] = { w: +ww.toFixed(3), mm: +(mx * 1000).toFixed(2) }; } }
  // rev 4: FACE4's lips cap and lids (a landmark-held warp) between the dimorphism and the expression
  if (mid) { const r = mid(P); if (r?.P && r.P !== P) P.set(r.P); if (r?.report) R.f4 = r.report; }
  // 2. expression (baked, like c2's rest: hero.js's own expression morphs still add on top at run time)
  const before = mouthLine(P, I), tilt0 = (before.yc - before.sto[1]) * 1000; R.tilt0 = +tilt0.toFixed(2);
  const cp = expr('mouth-corner-puller');
  // rev 4: the resting corners first as a SHAPE (MakeHuman's mouth-angles-up, up to 0.35: a level-to-lifted resting mouth, not a
  // muscle pull); the zygomaticus only for a slight smile's remainder, at most 0.2 (at 0.3 on a turned head it read as a smirk)
  let tiltNow = tilt0;
  if ((spec.rev ?? 3) >= 4 && spec.expr) { const ta = F.target('mouth/mouth-angles-up');
    if (ta) { const dyOf = v => { const j = Array.prototype.indexOf.call(ta.ix, v); return j >= 0 ? ta.d[j * 3 + 1] * k * 1000 : 0; }, dA = 0.5 * (dyOf(I.ch_L) + dyOf(I.ch_R)) - dyOf(I.sto);
      const base = Math.min(spec.expr.base ?? spec.expr.lift, spec.expr.lift), wA = clamp((base - tilt0) / Math.max(0.5, dA), 0, 0.35);
      if (wA > 0.001) addTarget(F, P, 'mouth/mouth-angles-up', wA, k, n);
      const ml = mouthLine(P, I); tiltNow = (ml.yc - ml.sto[1]) * 1000; R.angles = { w: +wA.toFixed(3), mmPerUnit: +dA.toFixed(2), tilt: +tiltNow.toFixed(2) }; } }
  if (cp && spec.expr) { const dy = 0.5 * (cp[I.ch_L * 3 + 1] + cp[I.ch_R * 3 + 1]) * 1000 - 0.5 * (cp[I.sto * 3 + 1]) * 1000;
    const w = clamp((spec.expr.lift - tiltNow) / Math.max(1, dy), 0, (spec.rev ?? 3) >= 4 ? 0.2 : 0.32); R.smile = { w: +w.toFixed(3), mmPerUnit: +dy.toFixed(2) };
    if (w) for (let i = 0; i < nb * 3; i++) P[i] += w * cp[i];
    const sq = spec.expr.squint || 0; if (sq) for (const e of ['eye-left-slit', 'eye-right-slit']) { const a = expr(e); if (a) for (let i = 0; i < nb * 3; i++) P[i] += sq * a[i]; }
    R.squint = sq; }
  // 3. the seal: the upper lip's margin down onto the lower lip (the classes from hero.js's mouth-open unit: the lower lip goes with the jaw)
  const ao = expr('mouth-open');
  if (spec.seal && ao) { const up = new Uint8Array(nb), lo = new Uint8Array(nb); for (let v = 0; v < nb; v++) { const d = ao[v * 3 + 1]; if (d > -0.004) up[v] = 1; else if (d < -0.012) lo[v] = 1; }
    const g0 = midGap(P, I, up, lo, nb), ml = mouthLine(P, I), move = clamp(g0.gap + 0.00015, 0, 0.0025);
    if (move > 0.0001) { const z0 = ml.sto[2] - 0.008;
      for (let v = 0; v < nb; v++) { if (!up[v] && !lo[v]) continue; const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; if (z < z0 || Math.abs(x) > ml.half * 1.05) continue;
        // rev 4: the lower lip rises to meet the upper (35 / 65) under a flatter taper: rev 4's gaps run 1-2 mm, and the upper lip's
        // margin pulled down 70 % at the midline drew a V (a cupid's-bow pucker) on L08, L20 and L14 (farm job 1003-155835)
        const r4 = (spec.rev ?? 3) >= 4, cw = r4 ? Math.pow(Math.max(0, 1 - (x / ml.half) ** 2), 0.35) : Math.pow(Math.max(0, 1 - (x / (0.95 * ml.half)) ** 2), 0.7); if (!cw) continue; const h = (y - ml.line(x)) * 1000;
        if (up[v] && h > -1.5 && h < 4.5) P[v * 3 + 1] -= (r4 ? 0.35 : 0.7) * move * cw * (1 - sst(1.5, 4.5, h));
        if (lo[v] && h < 1.5 && h > -4.5) P[v * 3 + 1] += (r4 ? 0.65 : 0.3) * move * cw * (1 - sst(1.5, 4.5, -h)); } }
    const g1 = midGap(P, I, up, lo, nb); R.seal = { gapBefore: +(g0.gap * 1000).toFixed(2), gapAfter: +(g1.gap * 1000).toFixed(2), move: +(move * 1000).toFixed(2) }; }
  const after = mouthLine(P, I); R.tilt = +((after.yc - after.sto[1]) * 1000).toFixed(2);
  const mouth = [0, P[I.sto * 3 + 1], Math.max(P[I.ls * 3 + 2], P[I.li * 3 + 2])];
  // rev 4: the lips' real meeting line (the upper lip's lower edge, front vertices) fitted as sto + curve (x / half)^4 over 1/4..3/4 of
  // the half-width (flat in the middle, rising to the corners, as the probes read it): lane B paints the vermilion as a lens round a HORIZONTAL line through the stomion, and where the real line rises
  // toward the corners the paint's lower half spills onto the skin under the lateral lower lip and the coloured lips read turned down
  // (judge c9's 'corners down'); face3Skin bends the paint and the contact line to this curve (0..6 mm at the corner, so <= 1.9 mm at 3/4: never bent down; a quadratic fit drew a cupid's-bow pucker on L08 and L20)
  let curve = null;
  if ((spec.rev ?? 3) >= 4 && ao) { let sxy = 0, sxx = 0; const sto = after.sto, half = after.half;
    for (let f = 0.25; f <= 0.76; f += 0.125) { const xb = f * half; let yU = Infinity;
      for (let v = 0; v < nb; v++) { const x = Math.abs(P[v * 3]), y = P[v * 3 + 1], z = P[v * 3 + 2]; if (Math.abs(x - xb) > 0.0012 || Math.abs(y - sto[1]) > 0.008 || z < sto[2] - 0.004 - 0.6 * xb) continue; if (ao[v * 3 + 1] > -0.004 && y < yU) yU = y; }
      if (isFinite(yU)) { const q = f ** 4; sxy += q * (yU - sto[1]); sxx += q * q; } }
    if (sxx > 0) { curve = clamp(sxy / sxx, 0, 0.006); R.curve = +(curve * 1000).toFixed(2); } }
  return { P, mouth, line: { half: after.half, corner: after.yc - after.sto[1], ...(curve != null ? { curve } : {}) }, report: R };
}

// the upper lid margins (lash roots) in bind space, ordered nasal -> temporal (landmarks.json lidMargin, the vertices above the eye's centre)
function lidLines(F, P, E, side) {
  const out = {};
  for (const s of ['L', 'R']) { const ring = F.lid?.[s]; if (!ring) continue; const pts = ring.map(v => at(P, v)), cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
    const xs = pts.map(q => q[0]), x0 = Math.min(...xs), x1 = Math.max(...xs);
    // the upper margin: per x bin the highest point (the ring's top half), 10 points across the fissure
    const bins = Array.from({ length: 10 }, () => null);
    for (const q of pts) { if (q[1] < cy - 0.0005) continue; const b = Math.min(9, Math.floor((q[0] - x0) / (x1 - x0 + 1e-9) * 10)); if (!bins[b] || q[1] > bins[b][1]) bins[b] = q; }
    let L = bins.filter(Boolean); if (Math.sign(L[0][0]) > 0) L.sort((a, b) => a[0] - b[0]); else L.sort((a, b) => b[0] - a[0]);   // nasal (small |x|) first
    while (L.length < 10) L.push(L[L.length - 1]); out[s] = L.slice(0, 10); }
  return out;
}

// the teeth and tongue helper vertices (they ride the bone: FACE6's skeleton moves them whole)
function teethOf(data, n) { const S = new Set(); for (const k of ['helper-upper-teeth', 'helper-lower-teeth', 'helper-tongue']) { try { for (const v of data.arr('idx_' + k)) if (v < n) S.add(v); } catch { /* none */ } } return Uint32Array.from(S); }
// face3Data(data, variant, spec) -> { data, variant, f3 }: a hero data object (lane A's contract, like face.js withFace) carrying the
// face3 positions and mouth; f3 carries what the later stages need (hair options, skin hook params, eye params, the report)
export async function face3Data(data, variant, spec, { F = null } = {}) {
  const t0 = Date.now(); F ||= await loadFaceStudio();
  const meta = data.meta, V = meta.variants.find(v => v.name === variant) || meta.variants[0]; let pos = data.arr('pos_' + V.name), eyes = data.arr('eyes_' + V.name);
  const nb = data._S?.nb || 13380, n = meta.n, expr = k => { try { return data.arr('expr_' + k); } catch { return null; } };
  // FACE4 (rev 4, opt-in): the rev-3 mouth features retuned and the identity from real heads (on a procedural face only; a scanned
  // head is a real person and keeps its own shape), then the lips cap and the lids inside face3Shape (mid)
  let mid = null, f4 = null, F6m = null, f6 = null, f6ctx = null, f6layers = null, f6A = null, f6tr = null;
  if ((spec.rev ?? 3) >= 4 && spec.f4) { const F4 = await import('./face4.js'), t4 = Date.now(), sp4 = spec.f4, rec = data; f4 = {};
    const tri = data.arr('idx_body'), region = data.arr('region'), side = data.arr('eye_side'), scanned = /_scan$/.test(V.name);
    pos = new Float32Array(pos);
    if (!scanned) { const look = sp4.look ?? (await import('../person/core.js').then(m => m.V2_PLAN?.[spec.name]?.look).catch(() => null)) ?? 'common';
      const W = F4.rev3Weights(F, rec, V.name.replace(/_v\d+$/, ''), look);
      if (sp4.retune) f4.retune = F4.retuneShape(F, pos, n, W, sp4.retune);
      if (sp4.id) { const SC = await import('./scan.js'), L = await SC.loadScanHeads(), B = F4.face4Basis(F, L, tri, sp4.id);
        const av = (await import('./c2.js')).LOOKS_C2[look]?.averageness ?? 0, fld = F4.identityField(F, L, B, pos, eyes, rec, { ...sp4.id, name: spec.name, averageness: 0.5 * av });
        const r = F4.applyIdentity(L, B, pos, eyes, n, fld); eyes = r.E; f4.id = { z: fld.z, scale: fld.scale, maxMm: r.maxMm, meanMm: r.meanMm, dof: B.dof, look }; f4.credit = 'Face shape statistics: HSRD-100 scans, Digital Reality Lab, CC BY 4.0'; } }
    else f4.scanned = true;
    // FACE6 (rev 7): the tissue system (skeleton, muscles, fat compartments, skin) on our own face; a scanned head keeps its own shape
    if (spec.f6 && !scanned) { const t6 = Date.now(); F6m = await import('./face6.js');
      const look6 = spec.f6.look ?? sp4.look ?? (await import('../person/core.js').then(m => m.V2_PLAN?.[spec.name]?.look).catch(() => null)) ?? 'common', av6 = (await import('./c2.js')).LOOKS_C2[look6]?.averageness ?? 0;
      f6ctx = { nb, n, tri, side, adj: F6m.adjacency(tri, nb), teeth: teethOf(data, n), bakeAge: spec.f6.ageCast, averageness: av6 };
      f6tr = F6m.teethRead(F, pos, f6ctx.teeth, (await import('../body/face_tissue.js')).faceAnchors(pos, F.ids, nb));
      const r6 = F6m.face6Tissue(F, pos, eyes, f6ctx, spec.f6); pos = r6.P; eyes = r6.E; f6 = { ...r6.report, ms: Date.now() - t6 }; f6layers = r6.layers || null; f6A = r6.dT; }
    const E4 = eyes; mid = P => F4.lidsLipsWarp(F, P, E4, side, { region, tri, nb, n }, sp4, rec); f4.ms = Date.now() - t4; }
  const S = face3Shape(F, pos, nb, n, expr, spec, mid), nm = V.name + '_f3';
  if (spec.f9) { const r9 = await face9Apply(F, S.P, eyes, spec.f9, { nb, n }); S.P = r9.P; if (r9.E) eyes = r9.E; S.report.f9 = r9.report; }   // ANAT8-HEAD face rev 9: the form from the skull out (face9.js); (it22) the eyes seated by the bone (r9.E)
  // FACE5 (rev 6): symmetry, age, the pleasant rest on the finished shape (before MOUTH's outline and occlusion read it)
  let f5r = null; const f5Geo = async () => { if (!spec.f5) { if (f6) await f6Geo(); return; } const t6 = Date.now(), SC = await import('./scan.js'), r = face5Shape(F, S.P, { nb, n, tri: data.arr('idx_body'), expr, L: await SC.loadScanHeads() }, spec.f5);
    S.P = r.P; f5r = { ...r.report, ms: Date.now() - t6 }; S.report.f5 = f5r; if (f6) await f6Geo(); };
  // FACE6 (rev 7) after FACE5's symmetry: the expression from our muscles (the seeded rest), the same field as the rig's smile channel,
  // then the lids seated on the globe; the teeth's cover read
  let f6chan = null, f7r = null; const f6Geo = async () => { const t7 = Date.now(), FT = await import('../body/face_tissue.js'), A = FT.faceAnchors(S.P, F.ids, nb), cp = expr('mouth-corner-puller');
    const fld = F6m.smileField(F, S.P, f6ctx, spec.f6, A); const per = cp ? (0.5 * (cp[F.ids.ch_L * 3 + 1] + cp[F.ids.ch_R * 3 + 1]) - cp[F.ids.sto * 3 + 1]) * 1000 : null;
    if (per && fld.corner.dy > 0.1) { const k = per / fld.corner.dy; for (let i = 0; i < fld.D.length; i++) fld.D[i] *= k; fld.corner = { dy: +(fld.corner.dy * k).toFixed(2), dx: +(fld.corner.dx * k).toFixed(2) }; }
    const ex = F6m.face6Expr(F, S.P, f6ctx, spec.f6, fld); S.P = ex.P; f6.expr = ex.report; f6.channel = { perUnitOrig: per && +per.toFixed(2), perUnit: fld.corner };
    if (spec.f6.expr?.channel !== false) f6chan = fld.D;
    // FACE7: the lids on the drawn globe after FACE6's seating (their seat, their rest from the lid's anatomy, the seal, the lid tissue);
    // (c7 it 17) nothing before the seating: the young women's narrowing is deleted; the lower face's form is the anatomy's (face9 above)
    if (spec.f7) f7r = {};
    const st = F6m.seatLids(F, S.P, eyes, data.arr('eye_side'), f6ctx, spec.f6); S.P = st.P; f6.seat = st.report;
    if (spec.f7) { const g7 = face7Geo(F, S.P, eyes, spec.f7.globe ? { ...f6ctx, idxE: data.arr('idx_eyes') } : f6ctx, spec.f7); S.P = g7.P; Object.assign(f7r, g7.report); }
    f6.teeth = { before: f6tr, after: F6m.teethRead(F, S.P, f6ctx.teeth, A) }; f6.msGeo = Date.now() - t7;
    if (spec.f6.layersOut) f6layers = F6m.layerSurfaces(F, S.P, eyes, f6ctx, spec.f6, A, f6A); };
  if (!spec.mouth) await f5Geo();
  // MOUTH (rev 5): the lips' form (a scanned head keeps its own: only the outline for the paint), then the outline on the final shape
  let mo = null;
  if (spec.mouth) { const MO = await import('./mouth.js'), SC = await import('./scan.js'), t5 = Date.now(), tri = data.arr('idx_body'), ao = expr('mouth-open'), scanned = /_scan$/.test(V.name);
    const src = { nb, n, tri, ao }; let rep = { scanned };
    // (FACE6, rev 7: our lip form in place of the scans' mean relief; MOUTH's machinery, seal and depth hold as before)
    const form6 = F6m ? (spec.f7?.lips ? { ...F6m.LIP_FORM[spec.sex === 'm' ? 'm' : 'f'], k: spec.f7.lips.groove } : F6m.LIP_FORM[spec.sex === 'm' ? 'm' : 'f']) : null;
    const ours = spec.f6?.lips === 'ours' && F6m ? (P_, sets_, M_) => F6m.lipResidual(F, P_, sets_, M_, form6, spec.mouth, ao) : null;
    if (!scanned && spec.mouth.shape) { const r5 = MO.mouthShape(F, S.P, src, spec.mouth, ours ? null : MO.closedScans(await SC.loadScanHeads(), F), ours); S.P = r5.P; rep = r5.report; if (ours) rep.form = 'ours'; }
    const I5 = F.ids, tiltB = () => (0.5 * (S.P[I5.ch_L * 3 + 1] + S.P[I5.ch_R * 3 + 1]) - S.P[I5.sto * 3 + 1]) * 1000;
    // the resting corners once more (the steer: level with or 0.5-1.5 mm over the stomion, never under; the bind frame is the frontal
    // view of an upright head): MakeHuman's mouth-angles-up as a shape (FACE4's lever), up to the spec's resting lift
    if (spec.expr && spec.mouth.rest !== false) { const t0r = tiltB(), want = Math.max(spec.mouth.minTilt ?? 0.5, Math.min(spec.expr.base ?? spec.expr.lift, spec.expr.lift)), ta = F.target('mouth/mouth-angles-up');
      if (ta && t0r < want) { const k = (S.P[I5.v * 3 + 1] - S.P[I5.me * 3 + 1]) / (F.lm.baseHeadHeightDm || 2.3358), dyOf = v => { const j = Array.prototype.indexOf.call(ta.ix, v); return j >= 0 ? ta.d[j * 3 + 1] * k * 1000 : 0; };
        const dA = 0.5 * (dyOf(I5.ch_L) + dyOf(I5.ch_R)) - dyOf(I5.sto), w = clamp((want - t0r) / Math.max(0.5, dA), 0, 0.6); if (w > 0.001) addTarget(F, S.P, 'mouth/mouth-angles-up', w, k, n);
        rep.rest = { before: +t0r.toFixed(2), want: +want.toFixed(2), w: +w.toFixed(3), after: +tiltB().toFixed(2) }; } else rep.rest = { before: +t0r.toFixed(2), want: +want.toFixed(2), w: 0, after: +t0r.toFixed(2) }; }
    await f5Geo();
    S.mouth = [0, S.P[I5.sto * 3 + 1], Math.max(S.P[I5.ls * 3 + 2], S.P[I5.li * 3 + 2])];
    const lines = MO.mouthLines(F, S.P, src, spec.mouth), occ = spec.mouth.paint.ao > 0 ? MO.mouthAO(F, S.P, src) : null; rep.ms = Date.now() - t5; S.report.mouth = rep;
    mo = { spec: spec.mouth, lines, ao: occ, report: rep }; }
  if (f4) S.report.f4 = { ...f4, ...(S.report.f4 || {}) };
  if (spec.f5 && !spec.mouth) S.mouth = [0, S.P[F.ids.sto * 3 + 1], Math.max(S.P[F.ids.ls * 3 + 2], S.P[F.ids.li * 3 + 2])];
  const V2 = { ...V, name: nm, mouth: S.mouth }, ex = new Map([['pos_' + nm, S.P], ['eyes_' + nm, eyes]]);
  if (f6) { S.report.f6 = f6; if (f6chan) ex.set('expr_mouth-corner-puller', f6chan); }
  const out = { ...data, name: (data.name || V.name) + '_f3', meta: { ...meta, variants: [...meta.variants.filter(v => v.name !== nm), V2] }, arr: k => (ex.has(k) ? ex.get(k) : data.arr(k)) };
  const I = F.ids, f = spec.sex === 'f', mk = spec.makeup === 'light', d = spec.fem;
  // lane D's card brows and lashes (options its groomHero already takes): lifted and arched with the face's brow; make-up fills and darkens
  const hair = !spec.hair ? {} : f ? { brows: { lift: +(0.12 * d).toFixed(3), arch: +(1 + 0.2 * d).toFixed(3), thick: +(1 - 0.18 * d).toFixed(3), ...(mk ? { base: 1.7, density: 1.1 } : {}) },
    lashes: { len: +(1 + 0.12 * d + (mk ? 0.15 : 0)).toFixed(3), upper: Math.round(36 + 6 * d + (mk ? 8 : 0)) } } : {};
  if (spec.f5?.ageO?.lowerLashes != null && spec.hair) hair.lashes = { ...(hair.lashes || {}), lower: spec.f5.ageO.lowerLashes };   // FACE5: fewer lower lashes (each a dash at 1:1)
  if (spec.f7 && spec.hair) Object.assign(hair, face7Hair(spec.f7, hair, { seed: spec.f7.seed, globe: f7r?.globe7 || null }));
  const lids = lidLines(F, S.P, eyes);
  const can = { L: at(S.P, I.en_L), R: at(S.P, I.en_R) };
  const eyesP = spec.eyes === false ? {} : { wet: { ...(typeof spec.eyes === 'object' ? spec.eyes : {}), canthus: can, lidsLower: lowerLids(F, S.P) }, ...(spec.f5?.eyes ? { f5: spec.f5.eyes } : {}) };
  const eyes7 = spec.f7 && spec.eyes !== false ? face7Eyes(spec.f7, eyesP) : eyesP;
  if (f7r) S.report.f7 = f7r;
  const f3 = { spec, hair, eyes: eyes7, line: S.line, lids, makeup: mk ? makeupOf(spec) : null, ...(mo ? { mouth: mo } : {}), ...(spec.f5 ? { f5: { spec: spec.f5, report: f5r } } : {}), ...(f6 ? { f6: { spec: spec.f6, report: f6, layers: f6layers } } : {}), ...(spec.f7 ? { f7: { spec: spec.f7, report: f7r } } : {}), report: { ...S.report, ms: Date.now() - t0 } };
  return { data: out, variant: nm, f3 };
}
// the lower lid margins (bind), each ordered nasal -> temporal: the meniscus strip's spine
function lowerLids(F, P) {
  const out = {};
  for (const s of ['L', 'R']) { const ring = F.lid?.[s]; if (!ring) continue; const pts = ring.map(v => at(P, v)), cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
    const xs = pts.map(q => q[0]), x0 = Math.min(...xs), x1 = Math.max(...xs), bins = Array.from({ length: 12 }, () => null);
    for (const q of pts) { if (q[1] > cy + 0.0005) continue; const b = Math.min(11, Math.floor((q[0] - x0) / (x1 - x0 + 1e-9) * 12)); if (!bins[b] || q[1] < bins[b][1]) bins[b] = q; }
    const L = bins.filter(Boolean); L.sort((a, b) => Math.abs(a[0]) - Math.abs(b[0])); out[s] = L; }
  return out;
}
// light make-up, by the person's skin depth (OUR): lip colour a rose on light skin, a deeper berry-brown on deep skin; strengths small
export function makeupOf(spec) {
  const deep = spec.group === 'black' ? 1 : spec.group === 'hispanic' ? 0.4 : spec.group === 'asian' ? 0.2 : 0;
  return { lip: 0.32, lipTint: deep > 0.5 ? [0.78, 0.5, 0.52] : [0.95, 0.62, 0.66], lipGloss: 0.06, lash: 0.5, evenness: 0.1, deep };
}

// ---------------------------------------------------------------- shading (after applySkin and fitLipMask)
const F3_PARS = `uniform vec4 f3Mouth; uniform vec4 f3Lip; uniform vec4 f3Mk; uniform vec3 f3Tint; uniform vec3 f3LidL[10]; uniform vec3 f3LidR[10];
float f3Seg(vec2 p, vec2 a, vec2 b){ vec2 e = b - a; float t = clamp(dot(p - a, e) / max(dot(e, e), 1e-12), 0.0, 1.0); return length(p - a - e * t); }
float f3Lash(vec3 b, bool L){ float d = 1.0; float side = 0.0;
  for (int i = 0; i < 9; i++) { vec3 a = L ? f3LidL[i] : f3LidR[i], c = L ? f3LidL[i + 1] : f3LidR[i + 1]; float s = f3Seg(b.xy, a.xy, c.xy);
    if (s < d) { d = s; vec2 e = c.xy - a.xy; side = (b.y - mix(a.y, c.y, clamp(dot(b.xy - a.xy, e) / max(dot(e, e), 1e-12), 0.0, 1.0))); } }
  // a line on the lid skin at the lash roots (just above the margin), thicker toward the outer corner
  return exp(-pow(d / 0.00055, 2.0)) * smoothstep(-0.0004, 0.0001, side); }
`;
// at the H1 frag slot (after lane B's albedo, before lane D's paint): hero.js's parting band out, the contact line in, the make-up
const F3_FRAG = `
{ vec3 b = vBind; float reg = vHero.x; if (b.y > hEyeL.y - 0.15 && reg > 1.5 && reg < 10.5) reg = 11.;
  if (reg < 1.5 || reg > 10.5) { float ax = abs(b.x);
    if (f3Mouth.x > 0.5) {
      float hb = 1.0 - 0.5 * exp(-(pow(b.x / 0.024, 2.0) + pow((b.y - hMouth.y) / 0.0016, 2.0))) * step(hMouth.z - 0.02, b.z);
      diffuseColor.rgb /= max(hb, 0.25);
      float yl = hMouth.y + f3Mouth.z * min(1.0, pow(b.x / f3Mouth.y, 2.0));
      float ln = exp(-pow((b.y - yl) / 0.00045, 2.0)) * smoothstep(f3Mouth.y * 1.04, f3Mouth.y * 0.8, ax) * smoothstep(hMouth.z - 0.03, hMouth.z - 0.016, b.z);
      diffuseColor.rgb *= 1.0 - f3Mouth.w * ln; }
    if (f3Mk.x > 0.0) {   // lip colour inside lane B's vermilion (the fitted mask's numbers)
      float x = b.x / f3Lip.x, yu = b.y - hMouth.y, top = f3Lip.y * (1.0 - 0.55 * x * x) - f3Lip.z * exp(-x * x * 30.0), bot = -f3Lip.w * (1.0 - 0.6 * x * x);
      float inL = smoothstep(1.02, 0.85, abs(x)) * smoothstep(top + 0.0008, top - 0.0004, yu) * smoothstep(bot - 0.0008, bot + 0.0004, yu) * step(hMouth.z - 0.02, b.z);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * f3Tint, f3Mk.x * inL); roughnessFactor = mix(roughnessFactor, roughnessFactor - f3Mk.z, inL); }
    if (f3Mk.y > 0.0 && b.z > hEyeL.z - 0.02 && abs(b.y - hEyeL.y) < 0.012) {   // lash darkening: the roots' line on the upper lid
      float la = b.x > 0.0 ? f3Lash(b, true) : f3Lash(b, false);
      diffuseColor.rgb *= 1.0 - f3Mk.y * la; } } }
`;
// the seam fix: lane D's and P1's derivatives taken in uniform control flow (see the header); each replacement guarded
// integration v3 (3 Oct): RETIRED. The derivatives now sit in uniform control flow at the source (hair/shade.js SKIN_F and SKIN_N,
// body/detail.js NORMAL), so these patterns find nothing; the list is kept empty so `seams` stays a harmless switch. FACE3's entries
// were: hair-normal, hair-scalp-dash, hair-beard-dash (shade.js) and detail-normal (detail.js).
export const SEAM_FIX = [];
// face3Skin(h, f3): the contact line and the make-up as one H1 skin hook (key 'face3'), the seam fix as a guarded patch on the
// compiled text. Call after applySkin (lane B) and fitLipMask (c2); lane D's hair may come before or after.
export function face3Skin(h, f3, o = {}) {
  const sp = f3.spec, mk = f3.makeup, V = a => ({ value: new Float32Array(a) });
  const lip = h.faceLips ? [h.faceLips.halfW, h.faceLips.top, h.faceLips.notch, h.faceLips.bot] : [0.025, 0.0085, 0.0016, 0.0105];
  const U = { f3Mouth: V([sp.seal ? 1 : 0, f3.line.half, f3.line.corner, 0.32]), f3Lip: V(lip), f3Mk: V([mk ? mk.lip : 0, mk ? mk.lash : 0, mk ? mk.lipGloss : 0, 0]),
    f3Tint: V(mk ? mk.lipTint : [1, 1, 1]), f3LidL: V((f3.lids.L || Array(10).fill([0, -9, 0])).flat()), f3LidR: V((f3.lids.R || Array(10).fill([0, -9, 0])).flat()) };
  const report = { hook: false, seams: {} };
  // rev 4: the contact line and the make-up's lip colour follow the fitted meeting line (line.curve), and lane B's painted vermilion
  // (as c2's fitLipMask set it) is bent the same way: yu - curve x^2 (a guarded text patch; without rev 4 nothing here runs)
  const cv = (sp.rev ?? 3) >= 4 && !f3.mouth && f3.line.curve != null ? f3.line.curve : null;
  // rev 5 (MOUTH): the parting band, the contact line and the make-up's lip colour move to mouth.js's hook (the geometric outline)
  if (f3.mouth) { U.f3Mouth.value[0] = 0; U.f3Mk.value[0] = 0; }
  if (cv != null) U.f3Mouth.value[2] = cv;
  const frag = cv == null ? F3_FRAG : F3_FRAG.replace('float x = b.x / f3Lip.x, yu = b.y - hMouth.y,', `float x = b.x / f3Lip.x, yu = b.y - hMouth.y - ${cv.toFixed(5)} * min(1.0, x * x * x * x),`)
    .replace('float yl = hMouth.y + f3Mouth.z * min(1.0, pow(b.x / f3Mouth.y, 2.0));', 'float yl = hMouth.y + f3Mouth.z * min(1.0, pow(abs(b.x / f3Mouth.y), 4.0));');
  if ((sp.seal || mk) && typeof h.useSkinHook === 'function') { h.useSkinHook({ key: f3.mouth ? 'face3r5' : cv == null ? 'face3' : 'face3r4', uniforms: U, fragPars: F3_PARS, frag }); report.hook = true; }
  if (f3.mouth) report.mouth = mouthSkin(h, f3.mouth, { makeup: mk });
  if (f3.f5) report.f5 = face5Skin(h, f3);   // FACE5 (rev 6): the age gate on the skin's zones and lines, the lips' lines and wet band
  if (f3.f7) report.f7 = face7Skin(h, f3);   // FACE7 (rev 8): the lips' satin wet band, the brows' material
  if (cv != null) { const mat = h.body.material, prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat), RE = /(float x = b\.x \/ [0-9.]+, yu = \(b\.y - hMouth\.y\))(, top = )/;
    mat.onBeforeCompile = (sh, r) => { prev?.call(mat, sh, r); report.lipCurve = RE.test(sh.fragmentShader); if (report.lipCurve) sh.fragmentShader = sh.fragmentShader.replace(RE, `$1 - ${cv.toFixed(5)} * min(1.0, x * x * x * x)$2`); };
    mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|f4curve' + cv.toFixed(5); mat.needsUpdate = true; }
  if (sp.seams) {
    const mat = h.body.material, prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat);
    mat.onBeforeCompile = (sh, r) => { prev?.call(mat, sh, r); let fs = sh.fragmentShader;
      for (const s of SEAM_FIX) { const hit = s.re.test(fs); report.seams[s.name] = hit; if (hit) fs = fs.replace(s.re, s.to); }
      sh.fragmentShader = fs; };
    mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|face3seam';
    mat.needsUpdate = true; }
  // lane B's evenness a touch higher under make-up (a live uniform)
  if (mk && h.likeness?.skin?.U?.likeK0) { const k = h.likeness.skin.U.likeK0.value; k.y = Math.min(0.85, k.y + mk.evenness); }
  h.face3 = { f3, U, report };
  return report;
}
