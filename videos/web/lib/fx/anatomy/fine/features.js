// ANATOMY / FINE / FEATURES (DETAIL7, 8 Oct 2026): the face's sub-millimetre anatomy as FEATURE CURVES on the person's own surface, each
// with a PROFILE across it, placed from the person's landmarks (FACE P2's Farkas set on hm08 ids), MOUTH's vermilion outline (the lines the
// skin paints from), FACE6's retaining ligaments (lib/fx/body/face_tissue.js) and the tissue state (laxity by age, sex, ancestry). Ours, CC0.
//
// Why curves: the photographs carry FORM at 0.3-1 mm (a lid margin, the supratarsal crease and the hood over it, the vermilion's white roll,
// the philtral columns, the alar groove and the alar-facial crease) that no vertex of hm08 (2-3 mm apart even subdivided) can hold. A curve
// is resolution-free: the bake (bake.js) rasterizes its profile into the head chart at any texel size, the engine reads its gradient, Cycles
// displaces by it.
//
// Profiles (mm in, mm out; s = signed distance across the curve, + on the curve's positive side; t = 0..1 along it):
//   groove  -D exp(-(s/W)^2)                                  a crease line (fine lines, the alar groove)
//   ridge   +D exp(-((s - c)/W)^2)                            a roll or a column (the white roll at c ~ +0.5 mm, the philtral columns)
//   fold    -D exp(-(s/W)^2) + O sstep(0, Wo, s) exp(-(max(0, s - Ro)/Fo)^2)   a crease with the skin on its + side standing proud (a hood)
//   crease  -D exp(-(sqrt(s^2 + r^2) - r)/w)                  iteration 6: a SET fold (the age lines): a cusp hinged at its floor (bake.js)
// Every amplitude is x an along-curve envelope (knots) with soft ends. Numbers: see FEATURE NUMBERS below (literature first, then to be
// FITTED to the photographs' profiles at 1:1: iteration 2+ of DETAIL7; each is a named constant here).
import * as FT from '../../body/face_tissue.js';
import { marginArcs, offsetArc } from './bake.js';
import { skinSet, staticFold } from './skin_age.js';

export const FEATURES_VERSION = 5;   // iteration 6: every static line's depth from the skin (skin_age.js: the fold an expression makes x the share the skin keeps by age, sex and its UV screen), the age lines' cross-section a CREASE (a cusp). iteration 5: the age lines as photographs draw them (broken forehead lines, 2-4 unequal curved crow's feet, glabellar by sex, none under ~25). iteration 4: soft bands (taper, profiles along the curve), the alar crease one arc, the asymmetric white roll
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const len = a => Math.hypot(a[0], a[1], a[2]), unit = a => mul(a, 1 / (len(a) || 1));

// ---------------------------------------------------------------- FEATURE NUMBERS (mm unless said; f / m where they differ)
// supratarsal crease height over the lid margin at the mid-pupil: Caucasian women ~8-10, men ~6-8 (oculoplastic texts, as recalled); East
// Asian lower or absent (a single lid in about half); the hood (dermatochalasis) and the crease's depth grow with the skin's laxity.
// ITERATION 2 (8 Oct): the creases are VALLEYS sized to the photographs' 1:1 cross-sections (review/.../detail7/tools/xsect7.py, measures/
// xsect7_photo_dist_s42.json: 31 frontal c3 portraits at a common 0.42 mm/px, the same code on our plates). What the photographs carry:
//   alar-facial crease: a soft band, cheek-side half width at half depth 2.1 mm (p25-p75 1.6-2.6), ala side ~1.0 mm, depth ~3.4 L* (p50)
//   nasolabial line: full width at half depth 4.1 mm (p25-p75 2.3-6.3), lateral (cheek) half 2.75, medial 1.5, depth 5.9 L* (young 5.9 too)
//   upper-lid crease: 8.8 mm over the margin (p25-p75 5.0-11.0), full width 2.2 mm (half widths ~0.95 each side), depth 13 L* under the hood
//   upper vermilion border: a white roll 2.8 L* over the skin (p25 0.0, p75 5.2) inside 2.5 mm of the border; 10-90 % transition 1.75 mm
//   lower lip lines: high-pass RMS 0.50 L* (p10 0.24) in the 0.6-2 mm band, dominant wavelength ~1.3-1.9 mm
// Ours at iteration 1 (the same code, 8 plates): alar half width 1.13 (narrower than v6's own 1.75: the incised line), naso lateral half
// 1.66, white roll 0.4 L*, lip lines 0.08-0.12 L*. A crease that runs DOWN the face (alar, nasolabial, marionette) reads under a key light from
// above by its OCCLUSION, not by its wall's tilt (the walls tilt sideways: a second-order change in N.L), so its visible width is the width
// of the band whose sky it hides: hence the walls' widths below, and the cavity now computed from the relief's own horizon (bake.js).
// Lines that run ACROSS the face (the lid crease, forehead lines, the labiomental crease) read by both: the lower wall faces the light.
// ITERATION 4 (8 Oct), from iteration 3's plates (measures/it3.md): every feature the engine drew as an OUTLINE is refit as the band a camera
// records. (1) the lid crease was a 2-4 px red arc (its 0.1 mm core and 0.45 mm tarsal wall) where the photographs show a 2.2 mm soft shadow
// band under the hood: walls 0.95 / 1.15 mm, the core 0.04 mm over 0.3; (2) the alar-facial crease was a 3 mm stub between its two 2 mm
// fades (the nostril-sill 'ticks', alar.hw_out 0.45-0.89 on three faces against 1.63-2.59): now ONE arc with the alar groove round the
// whole ala (front, over the top, down its lateral side, round its base), deepest and widest (cheek wall 2.4 mm, no core) at the base,
// shallowing AND narrowing over 3 mm at both ends; (3) the philtral columns were highest where they met the border (the pale wedge with a
// hard V): lower, wider, flat-topped, ramped out 1.3 mm above the border into the roll's skin flank; (4) the white roll is ASYMMETRIC
// (ridge2): a 1 mm gentle flank on the skin side that faces the key light (a pale band: verm.roll was 0.28 L* against 2.8) and a 0.3 mm
// steep one down to the border; (5) the age lines lose most of their narrow core (the 'carved' crow's feet / forehead lines on L05).
// ITERATION 6 (8 Oct, c2 run iteration 2): THE STATIC LINES FROM THE SKIN. The measurer (iteration 5): the age lines were the right kind but
// ABSENT (L05 Cycles E 0.136 = its off twin; L06, 53, a woman: none at all, her sex x 0.65 on top of the age ramp; L23 one 6 mm piece); the
// orchestrator (iteration 4's Cycles): a 27-year-old (L22) aged by a midcheek groove and a cut nasolabial line. Both came from per-feature
// [young, old] depth ramps with sex multipliers. Now ONE model (skin_age.js): every static line's depth is the fold its muscle makes in an
// expression (lambda / pi x sqrt(strain), Cerda and Mahadevan 2003) x the share of it the person's skin keeps (its lost elastic recovery since
// ~25: intrinsic, photo-ageing through the epidermis' UV screen, the menopause's collagen loss); the age lines' cross-section is a CREASE (a
// cusp hinged at its floor, walls ~0.35 x the skin's thickness) instead of a Gaussian valley with a 12 % core. Where the lines run (the
// muscles' fibres, iteration 5's placement) is unchanged. Predicted depths (skin_age.js skinReport; forehead / glabella / crow's feet, mm):
// L05 (59, Black man) 0.25 / 0.31 / 0.17 (set 0.23), L06 (53, white woman) 0.31 / 0.38 / 0.21 (0.31), L23 (45, white man) 0.24 / 0.29 / 0.16
// (0.20), L12 (39, white woman) 0.15 / 0.18 / 0.10, L03 (38, East Asian man) 0.12 / 0.15 / 0.08, L21 (32, Black man) 0.06 / 0.07 / 0.04, L22
// (27) and L08 (24): none (under 20 um; their nasolabial 0.02 / 0 mm and no lid-cheek groove, against 0.18 and 0.07 mm at iteration 5),
// each line x its own share (forehead amp 0.75-1.25 x the wander; crow's feet 0.45-1).
export const FINE_NUMBERS = {
  crease: { H: { f: 8.5, m: 7.0 }, group: { asian: 0.6, black: 0.9, hispanic: 0.95, white: 1, mena: 0.95, indigenous: 0.8, southasian: 0.9 }, single: { asian: 0.45 },
    D: [0.55, 0.95], Wm: 0.95, Wp: 1.15, Dc: 0.04, Wc: 0.3, O: [0.25, 0.85], c: 1.6, Wr: 1.5 },   // D, O: [young, + x laxity]; - side the tarsal platform, + the hood
  marginRoll: { up: { c: 0.75, W: 0.38, D: 0.13 }, lo: { c: 0.75, W: 0.5, D: 0.16 } },          // the lid margin's anterior edge (the lower one reads as a pale band)
  infraciliary: { off: 2.3, D: [0.04, 0.14], Wm: 0.35, Wp: 0.6 },
  // the age lines (iteration 5: placed as the photographs draw them; see AGE LINES in faceFeatures). ITERATION 6: their DEPTH and their
  // crease's wall width are no longer numbers here: skin_age.js staticFold(st, site) (the fold the site's muscle makes x the share the
  // person's skin keeps); what stays here is WHERE they run (L: crow's feet length at set 0 / +1, angles; forehead heights and spacing)
  crowsFeet: { L: [5, 9], ang: [-6, -30, 21], ang4: [44, -50] },
  lidCheek: { W: 1.2 },
  foreheadLines: { y0: [11, 15], gap: [6.5, 11], top: 46, half: [28, 44], halfRef: 38 },
  glabellar: { x: 4.8, len: 13 },
  crease7: { r: 0.04 },   // the crease's floor rounding (mm): a cusp a texel can sample
  vermUpper: { roll: { c: 0.35, Wm: 0.3, Wp: 1.05, D: 0.3 }, edge: { D: 0.04, W: 0.3 } },     // iteration 4: the roll asymmetric (ridge2); the slope break softer
  vermLower: { roll: { c: 0.8, W: 0.7, D: 0.1 }, edge: { D: 0.025, W: 0.3 } },                 // the lower border fades into the skin: no line
  philtrum: { col: { D: 0.28, W: 1.7 }, groove: { D: 0.16, W: 1.8 }, baseX: 2.6, ageFlat: 0.4, endUp: 1.3, grooveUp: 1.4 },   // iteration 4: lower, wider, ending 1.3 mm over the border
  // (c6 iteration 20) the lips' pleats: lips.js LIP_FILM (the film and the compression), no spacing or depth numbers here
  commissure: { W: 0.5, len: [3, 8] },
  alarGroove: { D: 0.22, Wm: 0.6, Wp: 0.9 },                                                     // (iteration 4: the front part of the alar arc)
  alarFacial: { D: 0.45, Wm: 0.7, Wp: 2.4, taper: 0.35, fade: 3.0 },                             // - side the ala (steep), + the cheek (gentle); no core
  // iteration 6: the ligament creases' DEPTH from the skin (skin_age.js: the nasolabial, marionette, labiomental, commissure and lid-cheek
  // sites); their walls stay the photographs' cross-sections (xsect7) and the cheek standing over the nasolabial line stays the tissue's laxity
  nasolabial: { Wm: [0.9, 1.3], Wp: [1.9, 2.6], O: [0.0, 0.35], c: 2.2, Wr: 2.4 },
  labiomental: { W: 1.2 },
  marionette: { Wm: 0.8, Wp: 1.2 },
};

// the person's tissue state: laxity (FACE6's curve), an age line factor, sex, group; seed from the name
export function tissueState(info, o = {}) {
  const age = o.age ?? info.age ?? 35, sex = info.sex === 'm' ? 'm' : 'f', group = String(info.group || 'white').toLowerCase();
  let s = 2166136261; for (const ch of String(info.name || 'x')) s = Math.imul(s ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const st = { age, sex, group, bmi: info.bmi ?? 24, lax: FT.laxity(age), ageK: clamp((age - 28) / 30), rnd, name: info.name };
  st.skin = skinSet(st);   // iteration 6: the share of a fold this skin keeps (skin_age.js)
  return st;
}
// iteration 5: a person's own stream per feature family (the age lines draw from these, so adding a line never moves another family's draws)
export function subRnd(st, tag) {
  let s = 2166136261; for (const ch of String(st.name || 'x') + '|' + tag) s = Math.imul(s ^ ch.charCodeAt(0), 16777619) >>> 0; s = s || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// ---------------------------------------------------------------- the curves
// faceFeatures(ctx) -> [{ id, kind, pts (mm, A frame), side (vec or per point), prof, along, ray (dir to snap along, A frame), fade }]
// ctx: { A (FT.faceAnchors), lm (landmarks.json), st (tissueState), S (bake.js fineSurface: the chart in mm), lips ({ rows, half, center } MOUTH's lines in bind metres) | null }
export function faceFeatures(ctx) {
  const { A, lm, st } = ctx, F = [], N = FINE_NUMBERS, CR = N.crease7.r;
  const P = A.P, toMm = A.toMm, vtx = v => toMm([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
  const L = k => A.lm(k), S = (k, sg) => A.side(k, sg), grp = st.group;
  const mix2 = (a, k) => a[0] + (a[1] - a[0]) * k;
  // AGE LINES (iteration 5: placement; iteration 6: depth and cross-section from the skin). Each family draws from its own stream (subRnd).
  // The crow's feet's pattern is the person's (both sides), each side jittered. How many lines a family shows grows with the share of its
  // folds the skin has kept (setN = set / 0.35: 0 young, 1 for a fair-skinned 60-year-old), and a line is drawn only where the skin keeps
  // 20 um or more (a young face carries none: the old 'young' cut is now the skin's own onset at ~25).
  const SK = st.skin || skinSet(st), fold = site => staticFold(st, site), cb = subRnd(st, 'crowBase'), CFn = N.crowsFeet;
  const nCF = Math.max(2, Math.min(4, Math.round(1.6 + 1.6 * SK.setN + 0.9 * cb())));
  const cfBase = [...CFn.ang, CFn.ang4[cb() < 0.5 ? 0 : 1]].slice(0, nCF).map((a, k) => ({ th: a + (cb() - 0.5) * 10, L: k ? 0.5 + 0.35 * cb() : 0.95 + 0.2 * cb(),
    D: k ? 0.45 + 0.4 * cb() : 1, bend: (8 + 10 * cb()) * (a < 0 ? -1 : 1), off: 4.2 + 2.2 * cb(), W: 0.85 + 0.3 * cb() }));
  // the eyes
  for (const sg of [1, -1]) {
    // the lid margins: the chart's eye-hole boundary (the skin's edge against the socket's lining), medial -> lateral, + side = the skin
    const M = marginArcs(ctx.S, sg);
    if (M) {
      F.push({ id: `lidRollUp_${sg}`, kind: 'ridge', uv: M.up, prof: { ...N.marginRoll.up }, along: [[0, 0.3], [0.15, 1], [0.85, 1], [1, 0.4]], fade: 0.8 });
      F.push({ id: `lidRollLo_${sg}`, kind: 'ridge', uv: M.lo, prof: { ...N.marginRoll.lo }, along: [[0, 0.3], [0.2, 1], [0.8, 1], [1, 0.4]], fade: 0.8 });
      // the supratarsal crease (fold: the preseptal skin and its fat stand over it): a parallel curve H(t) mm over the upper margin inside
      // the chart, highest a little medial of the pupil, converging toward the canthi; it runs on past the lateral canthus into the hood
      const C = N.crease, single = (C.single[grp] ?? 0) > 0 && st.rnd() < (C.single[grp] ?? 0);
      const H = C.H[st.sex] * (C.group[grp] ?? 1) * (1 + 0.04 * Math.max(0, st.age - 45) / 10) * A.s;
      const Hf = t => H * (0.38 + 0.62 * Math.pow(Math.sin(Math.PI * clamp(0.06 + 0.92 * Math.pow(t, 0.9))), 0.55));
      const cr = offsetArc(M.up, Hf, 4);
      F.push({ id: `crease_${sg}`, kind: 'valley', uv: cr, prof: { D: mix2(C.D, st.lax) * (single ? 0.15 : 1), Wm: C.Wm, Wp: C.Wp, Dc: C.Dc * (single ? 0.2 : 1), Wc: C.Wc, O: mix2(C.O, Math.pow(st.lax, 1.3)) * (single ? 0.5 : 1), c: C.c, Wr: C.Wr },
        along: [[0, 0.05], [0.2, 0.7], [0.55, 1], [0.85, 1.05], [1, 0.45]], fade: 2.5, taper: 0.5, info: { H: +H.toFixed(2), single } });
      // the lower lid: the infraciliary crease ~2.3 mm under the margin
      const IC = N.infraciliary, ic = offsetArc(M.lo.slice(2, -2), () => IC.off * A.s, 3);
      F.push({ id: `infraciliary_${sg}`, kind: 'valley', uv: ic, prof: { D: mix2(IC.D, st.lax), Wm: IC.Wm, Wp: IC.Wp }, along: [[0, 0.2], [0.3, 1], [0.8, 1], [1, 0.3]], fade: 1.2 });
    }
    const lig = FT.ligaments(A, sg), eyeRay = [0, 0, -1];
    { const D = fold('lidCheek').D;   // iteration 6: the skin's set at the lid-cheek junction (was 0.04 mm at any age + laxity: a groove on a 27-year-old)
      if (D >= 0.01) F.push({ id: `lidCheek_${sg}`, kind: 'valley', pts: lig.lid.pts, side: [0, -1, 0], ray: eyeRay, prof: { D, Wm: N.lidCheek.W, Wp: N.lidCheek.W }, along: [[0, 0.3], [0.5, 1], [1, 0.3]], fade: 3 }); }
    // the lateral canthal lines (crow's feet), iteration 5: 2-4 UNEQUAL lines, not a fan of five. A photograph of a 45-60-year-old shows a
    // main line at about the canthus' level (a little below), deepest and longest, one lower running onto the cheek, one upper toward the
    // brow's tail, sometimes a fourth; each CURVES away from the horizontal as it goes (the lines cross orbicularis' circular fibres, so they
    // follow the orbit's rim), each starts at its own distance beyond the canthus, and the depth swells and fades along it. The two sides
    // share the person's pattern with their own jitter (faces are near-symmetric in their lines, never mirror-exact).
    for (let q = 0; q < 25; q++) st.rnd();   // keep the person's main stream where iteration 4 left it (the other eye's single / double lid draws from it)
    const ex = S('ex', sg), CF = N.crowsFeet, cr = subRnd(st, `crow${sg}`), fc = fold('crow');
    for (const [k, b] of cfBase.entries()) {
      const th0 = (b.th + (cr() - 0.5) * 6) * Math.PI / 180, bend = b.bend * (0.8 + 0.4 * cr()) * Math.PI / 180, Lk = (CF.L[0] + CF.L[1] * SK.setN) * b.L * (0.9 + 0.2 * cr()) * A.s;
      const p0 = add(ex, [sg * (b.off - 1.5 * (1 - Math.cos(th0))) * A.s, 6.5 * Math.sin(th0) * A.s, -2.2]), pts = [p0]; let q = p0;   // the starts along an arc round the orbit's rim: the lines do not converge on one point
      for (let i = 1; i <= 10; i++) { const th = th0 + bend * (i - 0.5) / 10; q = add(q, mul([sg * Math.cos(th), Math.sin(th), -0.45 * Math.cos(th)], Lk / 10)); pts.push(q); }
      const Dk = fc.D * b.D * (0.85 + 0.3 * cr());   // iteration 6: the skin's set fold (skin_age.js 'crow'), the line's own share of it
      if (Dk < 0.02) continue;   // under 20 um: no visible relief; no feature (a young face carries none)
      const Wk = fc.w * b.W;
      F.push({ id: `crow_${sg}_${k}`, kind: 'crease', pts, side: [0, 1, 0], ray: [-sg * 0.75, 0, -0.66], prof: { D: Dk, Wm: Wk, Wp: Wk * (0.9 + 0.25 * cr()), r: CR },
        along: [[0, 0.25], [0.2, 1], [0.5, 0.7 + 0.45 * cr()], [0.75, 0.55 + 0.3 * cr()], [1, 0]], fade: 2.0, taper: 0.4 });
    }
    // the nose: the alar groove (over the ala, separating it from the tip and sidewall) and the alar-facial crease (round its base)
    const al = S('al', sg), sn = L('sn'), prn = L('prn');
    const alTop = add(al, [-sg * 1.8 * A.s, 4.2 * A.s, 1.5]), alFront = lerp(al, prn, 0.55), alFrontB = add(alFront, [0, -1.0 * A.s, -1.0]);
    // iteration 4: the alar groove and the alar-facial crease are ONE crease round the ala (as in a photograph: a C round the alar lobule),
    // from the lobule's front over the ala's top, down its lateral side, round its base toward the sill; shallow and narrow over the top
    // (the alar groove), deepest with the widest cheek wall at the base (the alar-facial crease), and at both ends narrowing as it shallows
    // (taper). Iteration 2-3's two curves met in a fade at the ala's top and the facial one was a 3 mm stub between 2 mm fades: the 'ticks'.
    // The + side is away from the ala (the sidewall over the top, the cheek at the side and base), the - side the ala's own steep wall.
    const AG = N.alarGroove, AF = N.alarFacial, ctrA = add(al, [-sg * 3.2 * A.s, 0.6 * A.s, 1.0]);
    const arc = [alFrontB, add(lerp(alTop, alFront, 0.5), [0, 0.8, 0.6]), alTop, add(al, [sg * 0.25, 2.3 * A.s, -2.4]), add(al, [sg * 0.8, -0.5 * A.s, -2.2]),
      add(al, [sg * 0.25, -2.6 * A.s, -1.1]), add(al, [-sg * 1.1 * A.s, -3.7 * A.s, -0.2])];
    const arcSide = arc.map(q => { const d = sub(q, ctrA); return [d[0], d[1], 0]; });
    F.push({ id: `alarCrease_${sg}`, kind: 'valley', pts: arc, side: arcSide, ray: [-sg * 0.52, 0.1, -0.85], prof: { D: AF.D, Wm: AF.Wm, Wp: AF.Wp },
      // t along the arc (L08: 30 mm snapped): 0-0.5 the alar groove over the top, 0.5-0.68 the ala's upper-lateral junction, 0.68-0.9 its lateral
      // side and base (the alar-facial crease proper), then 3 mm of taper toward the sill
      profAlong: [[0, { D: AG.D * 0.8, Wm: AG.Wm * 0.85, Wp: AG.Wp * 0.85 }], [0.3, { D: AG.D, Wm: AG.Wm, Wp: AG.Wp }], [0.5, { D: 0.3, Wm: 0.7, Wp: 1.6 }],
        [0.68, { D: AF.D, Wm: AF.Wm, Wp: AF.Wp }], [0.9, { D: AF.D, Wm: AF.Wm, Wp: AF.Wp }], [1, { D: AF.D * 0.5, Wm: 0.55, Wp: 1.6 }]],
      along: [[0, 1], [1, 1]], fade: AF.fade, taper: AF.taper });
    // the nasolabial line (FACE6's ligament: the fold's medial edge) and the cheek standing over it with laxity
    const NL = N.nasolabial;
    F.push({ id: `nasolabial_${sg}`, kind: 'valley', pts: lig.nl.pts, side: [sg, 0.3, 0], ray: [-sg * 0.35, 0, -0.94],
      prof: { D: fold('nasolabial').D, Wm: mix2(NL.Wm, st.lax), Wp: mix2(NL.Wp, st.lax), O: mix2(NL.O, st.lax * st.lax), c: NL.c, Wr: NL.Wr }, along: [[0, 0.35], [0.2, 1], [0.7, 0.9], [1, 0.1]], fade: 4 });
    { const D = fold('marionette').D; if (D >= 0.01) F.push({ id: `marionette_${sg}`, kind: 'valley', pts: lig.mar.pts, side: [sg, 0, 0], ray: [-sg * 0.3, 0, -0.95], prof: { D, Wm: N.marionette.Wm, Wp: N.marionette.Wp }, along: [[0, 0.3], [0.4, 1], [1, 0]], fade: 3 }); }
  }
  // the forehead (frontalis lines), iteration 5: lines that VARY and BREAK, as a photograph shows them. Iteration 4 drew four 76 mm arcs at
  // fixed heights (11 / 19 / 27 / 35 mm) with one envelope: on L05 in Cycles the top one read as a line drawn with a ruler. A first try at
  // iteration 5 (short segments with gaps) read in the node relief as a wall of dashes: wrong too. A real forehead carries 2-5 lines by age at
  // irregular spacing (6.5-11 mm), each a long furrow over most of the forehead whose DEPTH WANDERS along it (low-frequency, +-35 %), which
  // fades out gradually at its lateral ends (over a third of its half length) and which BREAKS 0-2 times, a 2-6 mm gap where the depth
  // falls to nothing; across a break the next piece often steps 0.8-2 mm up or down and overlaps the last by 1.5-3 mm (en echelon). In about
  // half of people the lines break or shallow over the midline (the frontalis's two bellies meet at an aponeurosis); the lowest line is the
  // shortest (between the brows' heads). Each piece is its own valley; its envelope (the wander, the fades, the breaks) is sampled every 2 mm.
  const g = L('g'), FL = N.foreheadLines, fr = subRnd(st, 'forehead');
  for (let q = 0; q < 8; q++) st.rnd();   // the main stream as iteration 4 left it (nothing after draws from it today; kept for the next feature that does)
  const ff = fold('forehead'), nFL = Math.max(2, Math.min(5, Math.round(2 + 2.4 * SK.setN + 0.9 * fr()))), central = fr() < 0.55, DL = ff.D;
  let yk = FL.y0[0] + (FL.y0[1] - FL.y0[0]) * fr();
  for (let k = 0; k < nFL && yk < FL.top && DL >= 0.02; k++) {
    const half = (FL.half[0] + (FL.half[1] - FL.half[0]) * Math.min(1, k / 2)) * (0.88 + 0.24 * fr()) * (1 - 0.3 * sst(30, 46, yk)), amp = (1 - 0.1 * Math.abs(k - 1.3)) * (0.75 + 0.5 * fr());
    const wob = fr() * 6.28, rise = 2.2 + 2.4 * fr(), Wk = ff.w * (1 + 0.12 * k) * (0.85 + 0.3 * fr()), sh = (fr() - 0.5) * 6;   // sh: the line's centre off the midline
    const vw = 2 * Math.PI / (15 + 12 * fr()), vp = fr() * 6.28, va = 0.3 + 0.4 * fr();   // a second, shorter vertical wander (a real furrow is never a drawn curve)
    const yAt = x => yk + rise * (x / FL.halfRef) ** 2 + 0.9 * Math.sin(wob + 3.1 * x / FL.halfRef) + va * Math.sin(vw * x + vp);
    // the wander: three sinusoids, wavelengths 12-34 mm, random phases
    const wv = [0, 1, 2].map(() => [2 * Math.PI / (12 + 22 * fr()), fr() * 6.28, 0.4 + 0.6 * fr()]), wn = wv.reduce((s, q) => s + q[2], 0);
    const breaks = []; if (central && fr() < 0.75) breaks.push([sh + (fr() - 0.5) * 8, 2.5 + 3 * fr()]);
    for (let b = 0, nb = fr() < 0.2 ? 0 : fr() < 0.65 ? 1 : 2; b < nb; b++) breaks.push([sh + (fr() * 2 - 1) * 0.7 * half, 2 + 4 * fr()]);
    const env = x => { const u = x - sh; let e = sst(-half, -half * 0.62, u) * (1 - sst(half * 0.62, half, u)) * (0.65 + 0.35 * wv.reduce((s, q) => s + q[2] * Math.sin(q[0] * x + q[1]), 0) / wn);
      if (central) e *= 0.45 + 0.55 * sst(2, 10, Math.abs(x));
      for (const [xb, w] of breaks) e *= sst(w * 0.5, w * 0.5 + 3, Math.abs(x - xb));
      return Math.max(0, e); };
    // pieces: runs where the envelope stays over 0.04, sampled every 2 mm (a run shorter than 6 mm is dropped: a dash, not a line)
    const xs = []; for (let x = sh - half; x <= sh + half + 1e-6; x += 2) xs.push(x);
    const runs = []; let cur = null;
    for (const x of xs) { if (env(x) > 0.04) { if (!cur) runs.push(cur = []); cur.push(x); } else cur = null; }
    let dy = 0, j = 0;
    for (const r of runs) {
      if (r[r.length - 1] - r[0] < 6) continue;
      const x0 = r[0] - (j ? 1.5 + 1.5 * fr() : 2), x1 = r[r.length - 1] + 2, n = Math.max(4, Math.round((x1 - x0) / 2)), pts = [], along = [];
      for (let i = 0; i <= n; i++) { const t = i / n, x = x0 + (x1 - x0) * t; pts.push([x * A.s, g[1] + (yAt(x) + dy) * A.s, g[2] + 20]); along.push([t, env(x)]); }
      F.push({ id: `forehead_${k}_${j}`, kind: 'crease', pts, side: [0, 1, 0], ray: [0, 0, -1], prof: { D: DL * amp, Wm: Wk * 0.9, Wp: Wk * 1.1, r: CR },
        along, fade: Math.min(6, 0.25 * (x1 - x0)), taper: 0.45, info: { k, j, x0: +x0.toFixed(1), x1: +x1.toFixed(1), dy: +dy.toFixed(1), D: +(DL * amp).toFixed(3), w: +Wk.toFixed(2) } });
      j++; if (fr() < 0.45) dy += (fr() < 0.5 ? -1 : 1) * (0.8 + 1.2 * fr());
    }
    yk += FL.gap[0] + (FL.gap[1] - FL.gap[0]) * fr();
  }
  // the glabellar lines (corrugators), iteration 5: in about four of ten women one line alone or one much fainter, each slightly bowed and of
  // its own length. Iteration 6: their depth from the skin (skin_age.js 'glabella': men deeper through their thicker skin; no sex multiplier),
  // and the transverse procerus line over the nasal root for anyone whose skin keeps it (iteration 5: men over ~40 only)
  const gr = subRnd(st, 'glabella'), GL = N.glabellar, fg = fold('glabella'), both = st.sex === 'm' || gr() < 0.6, oneSide = gr() < 0.5 ? 1 : -1;
  for (const sg of [1, -1]) {
    const kD = both ? 0.7 + 0.5 * gr() : (sg === oneSide ? 1 : 0.25), bow = (gr() - 0.5) * 1.6, lenK = 0.75 + 0.45 * gr(), pts = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([sg * (GL.x * (1 + 0.18 * t) + bow * Math.sin(Math.PI * t)) * A.s, g[1] - 4 * A.s + GL.len * lenK * A.s * t, g[2] + 20]); }
    const Dg = fg.D * kD;
    if (Dg >= 0.02) F.push({ id: `glabellar_${sg}`, kind: 'crease', pts, side: [sg, 0, 0], ray: [0, 0, -1], prof: { D: Dg, Wm: fg.w, Wp: fg.w, r: CR }, along: [[0, 0.3], [0.3, 1], [0.75, 0.75], [1, 0]], fade: 2, taper: 0.45, info: { D: +Dg.toFixed(3), w: +fg.w.toFixed(2) } });
  }
  { const fp = fold('procerus'), Dp = fp.D * (0.7 + 0.6 * gr());
    if (Dp >= 0.02) { const nn = L('n'), yP = nn[1] + 3 * A.s, pts = []; for (let i = 0; i <= 6; i++) { const u = -1 + 2 * i / 6; pts.push([u * (5 + 2 * gr()) * A.s, yP + 0.8 * u * u * A.s, nn[2] + 20]); }
      F.push({ id: 'procerus', kind: 'crease', pts, side: [0, 1, 0], ray: [0, 0, -1], prof: { D: Dp, Wm: fp.w * 0.9, Wp: fp.w * 1.1, r: CR }, along: [[0, 0], [0.3, 1], [0.7, 1], [1, 0]], fade: 2, taper: 0.5, info: { D: +Dp.toFixed(3) } }); } }
  // the lips: the vermilion borders from MOUTH's lines (the outline the skin paints), the philtrum, the lip lines' region, the commissures
  if (ctx.lips) {
    const LP = ctx.lips, rows = LP.rows, cx = LP.center || 0, half = LP.half, mm = (x, y) => toMm([cx + x, y, 0]);
    const at = (ax, k) => { if (ax <= rows[0][0]) return rows[0][k]; for (let i = 1; i < rows.length; i++) if (ax <= rows[i][0]) { const t = (ax - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0] || 1); return rows[i - 1][k] + (rows[i][k] - rows[i - 1][k]) * t; } return rows[rows.length - 1][k]; };
    const zf = toMm([0, 0, LP.z])[2] + 25, top = [], bot = [], meet = [];
    for (let i = 0; i <= 40; i++) { const x = (-1 + 2 * i / 40) * half * 0.985; const t = toMm([cx + x, at(Math.abs(x), 2), 0]), b = toMm([cx + x, at(Math.abs(x), 3), 0]), m = toMm([cx + x, at(Math.abs(x), 1), 0]);
      top.push([t[0], t[1], zf]); bot.push([b[0], b[1], zf]); meet.push([m[0], m[1], zf]); }
    const VU = N.vermUpper, VL = N.vermLower, rollAge = 1 - 0.45 * st.lax;
    const bowEnv = [[0, 0.15], [0.12, 0.55], [0.32, 1], [0.5, 1.1], [0.68, 1], [0.88, 0.55], [1, 0.15]];
    F.push({ id: 'vermUpperRoll', kind: 'ridge2', pts: top, side: [0, 1, 0], ray: [0, 0, -1], prof: { c: VU.roll.c, Wm: VU.roll.Wm, Wp: VU.roll.Wp, D: VU.roll.D * rollAge }, along: bowEnv, fade: 0.6, mask: 'vermTop' });
    F.push({ id: 'vermUpperEdge', kind: 'valley', pts: top, side: [0, 1, 0], ray: [0, 0, -1], prof: { D: VU.edge.D, Wm: VU.edge.W, Wp: VU.edge.W }, along: bowEnv, fade: 0.6 });
    const loEnv = [[0, 0.1], [0.15, 0.6], [0.35, 1], [0.65, 1], [0.85, 0.6], [1, 0.1]];
    F.push({ id: 'vermLowerRoll', kind: 'ridge', pts: bot, side: [0, -1, 0], ray: [0, 0, -1], prof: { c: VL.roll.c, W: VL.roll.W, D: VL.roll.D * rollAge }, along: loEnv, fade: 0.6, mask: 'vermBot' });
    F.push({ id: 'vermLowerEdge', kind: 'valley', pts: bot, side: [0, -1, 0], ray: [0, 0, -1], prof: { D: VL.edge.D, Wm: VL.edge.W, Wp: VL.edge.W }, along: loEnv, fade: 0.6 });
    // the philtral columns: from the columella's base (either side of the subnasale) down to the Cupid's bow peaks (vermShape's peak at
    // u ~0.2 of the half-width; the top row's highest point there); the groove between them
    const PH = N.philtrum, sn = L('sn'), flat = 1 - PH.ageFlat * st.lax;
    let pk = 0.2; { let best = -1e9; for (let u = 0.1; u <= 0.35; u += 0.01) { const y = at(u * half, 2); if (y > best) { best = y; pk = u; } } }
    for (const sg of [1, -1]) {
      const bowP = mm(sg * pk * half, at(pk * half, 2)), b0 = [sg * PH.baseX * A.s, sn[1] - 1.5 * A.s, zf], b1 = [bowP[0], bowP[1] + PH.endUp, zf];
      const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(lerp(b0, b1, t)); }
      F.push({ id: `philtrumCol_${sg}`, kind: 'ridge', pts, side: [sg, 0, 0], ray: [0, 0, -1], prof: { c: 0, W: PH.col.W * A.s, D: PH.col.D * flat }, along: [[0, 0.15], [0.3, 0.75], [0.65, 1], [1, 0.6]], fade: 1.6, taper: 0.6 });
    }
    const gpts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; gpts.push([0, sn[1] - 1.5 * A.s + (mm(0, at(0, 2))[1] + PH.grooveUp - (sn[1] - 1.5 * A.s)) * t, zf]); }
    F.push({ id: 'philtrumGroove', kind: 'groove', pts: gpts, side: [1, 0, 0], ray: [0, 0, -1], prof: { D: PH.groove.D * flat, W: PH.groove.W * A.s }, along: [[0, 0.2], [0.3, 1], [0.8, 0.9], [1, 0.4]], fade: 1.5, taper: 0.6 });
    // the commissures' small crease (the modiolus), longer and deeper with age
    for (const sg of [1, -1]) { const c0 = mm(sg * half, at(half, 1)), CM = N.commissure, Lc = mix2(CM.len, st.lax) * A.s, pts = [];
      for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([c0[0] + sg * (0.6 + 0.45 * Lc * t), c0[1] - 0.2 - 0.9 * Lc * t, zf]); }
      const D = fold('commissure').D; if (D >= 0.01) F.push({ id: `commissure_${sg}`, kind: 'valley', pts, side: [sg, 0, 0], ray: [-sg * 0.3, 0, -0.95], prof: { D, Wm: CM.W, Wp: CM.W }, along: [[0, 0.6], [0.3, 1], [1, 0]], fade: 0.8 }); }
    ctx.lipRows = { top, bot, meet };
  }
  // the labiomental crease across the chin at the sublabiale, its sides rising
  { const sl = L('sl'), LM = N.labiomental, pts = []; for (let i = 0; i <= 12; i++) { const u = -1 + 2 * i / 12; pts.push([u * 13 * A.s, sl[1] + 2.5 * u * u * A.s, sl[2] + 20]); }
    const D = fold('labiomental').D; if (D >= 0.01) F.push({ id: 'labiomental', kind: 'valley', pts, side: [0, 1, 0], ray: [0, 0, -1], prof: { D, Wm: LM.W * 0.8, Wp: LM.W * 1.2 }, along: [[0, 0], [0.25, 0.8], [0.5, 1], [0.75, 0.8], [1, 0]], fade: 3 }); }
  return F;
}

// the micro parameters by region at a point (mm, A frame): pores [diameter, depth, per mm2], the furrow network [cell, depth]; and the
// size class (0..1) and depth the engine's region map stores. Lids and the vermilion: no pores, a finer network (lids) / none (lips).
export function regionMicro(A, st, p, masks = {}) {
  const L = k => A.lm(k), dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const prn = L('prn'), n = L('n'), g = L('g'), pg = L('pg');
  const e = sg => lerp(A.side('en', sg), A.side('ex', sg), 0.5);
  const dNose = Math.min(dist(p, prn) - 6, segD(p, n, prn) - 4), nose = 1 - sst(2, 9, dNose);
  const dEye = Math.min(...[1, -1].map(sg => { const c = e(sg); return Math.hypot((p[0] - c[0]) / 1.35, (p[1] - c[1] + 1) / 1.0, (p[2] - c[2]) / 1.5); }));
  const lid = 1 - sst(9, 13, dEye);
  const cheekM = Math.max(...[1, -1].map(sg => 1 - sst(10, 22, Math.hypot(p[0] - sg * 24 * A.s, p[1] - (L('sn')[1] + 6), (p[2] - (prn[2] - 25)) * 0.5))));
  const fore = sst(g[1] + 6, g[1] + 16, p[1]) * (1 - sst(40, 55, Math.abs(p[0])));
  const chin = 1 - sst(8, 18, dist(p, pg));
  const verm = masks.verm ?? 0;
  // size class: nose 1, medial cheek 0.62, chin 0.5, forehead 0.38, elsewhere 0.15
  let sz = 0.15; sz = Math.max(sz, 0.38 * fore, 0.5 * chin, 0.62 * cheekM, 1.0 * nose);
  const ageD = 1 + 0.35 * st.ageK, sexD = st.sex === 'm' ? 1.2 : (st.age < 30 ? 0.85 : 1);
  let depth = (0.025 + 0.07 * sz) * ageD * sexD * (1 - lid) * (1 - verm);
  const dia = (0.08 + 0.17 * sz) * (st.sex === 'm' ? 1.12 : 1), dens = 1.4 + 2.8 * sz;
  const netCell = (0.42 + 0.3 * st.ageK) * (1 - 0.3 * lid), netDepth = (0.01 + 0.022 * st.ageK + 0.012 * lid * st.ageK) * (1 - verm);
  return { pore: [dia, depth, dens], net: [netCell, netDepth], sz, depth, lid, verm };
}
function segD(p, a, b) { const e = sub(b, a), w = sub(p, a), t = clamp((w[0] * e[0] + w[1] * e[1] + w[2] * e[2]) / Math.max(1e-9, e[0] * e[0] + e[1] * e[1] + e[2] * e[2])); return len(sub(w, mul(e, t))); }
export { unit };
