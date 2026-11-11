// HAIR / v7 (HAIR7, round 7, 8 Oct; AUDIT7 cause 1, against the c3 portraits): the round-7 pieces of the ONE current hair (index.js
// groomHero builds every groom with them; rev 6's helical curls, settle and BSDF are their base; superseded revisions are in git history).
// What AUDIT7's twelve auditors found against the photographs, and what rev 7 changes for it:
//   - HAIRLINES built from cards read as stripes, stair-steps and rows of dashes (L08's temples, L20's band, L03's slivers, L17's stencil):
//     rev 6 split every card rooted within 1 cm of the line into three short staggered ones (the dashes and slivers) and the scalp's painted
//     root base ran ahead of the cards as a flat tinted band. Rev 7: no split; a LINE of single fine strands (line7: 2-6 mm cards of a few
//     strands, the sparse tile outside, the straight tile inside) rooted across a band that straddles the line (from 3 mm outside to 16 mm
//     inside), its root density rising across it, each strand's length growing with its depth into the band and lying with the style's own
//     comb, so the edge is a ramp of hairs; the painted base starts 2.5 mm inside the line, under the strands, not ahead of them.
//   - PARTINGS read as ruler stripes (L08, L12, L06): the part's skin line narrower and weaker (1.2 mm at 30 %: rev 6 2 mm at 55 %), the
//     root gap ZIG-ZAGS (two sines along the part, 2.2 mm), and a root on the other side of the jagged line combs to that side (the hair
//     crosses the part where it does), more and longer fine hairs falling across it from both sides (part5: 760, 0.8-2.8 cm).
//   - TEMPLES: ten of twelve showed skin or background beside the face where the photos show hair (REFMEASURE hair_face_Y: the patch
//     0.13-0.27 IPD outside the face oval at the temple). On our plates the hair's silhouette there ends ~0.2 IPD outside the oval: the
//     hair lies flat on the skull. Rev 7 gives the hair beside the face its VOLUME: at the temples and over the ears (azimuth 45-115 deg,
//     from the ear's top to 8 cm above the eyes) every point of the hair's body (not its roots, not the fine strands) is held up to
//     `side.k` cm further off the head, and a crop's clipper-short sides keep at least `side.len` of the top's length.
//   - MEN'S FRONTS sat high (0.62-1.0 IPD above the brow against the photos' p50 0.37-0.47): the men's front line `hl.menFront` cm lower
//     and the temple recess halved; the line's outermost strands fall forward a few millimetres at the front. The women's temple hair comes
//     down a centimetre further in front of the ear (`hl.womenSide`: the style's side knot, 1.6 cm above the eyes, was the patch's height).
//   - SHEEN on dark and grey hair (a grey-white sheen on L11, L06, L17; L05's grey crop as white glitter): the primary lobe and the
//     environment's sheen capped by the melanin (dark hair) and by the grey share; the unpigmented strands' albedo lowered and fewer of
//     them drawn at full coverage (grey hair is a mixture, not white flecks).
//   - THE LENGTH BELOW THE EARS stood out past the shoulders as a cape (the Cycles 'wings', L08-17, L12-03; iteration 2): the groom's
//     flare over the bind pose's sloping shoulders, kept by the settle's shape constraints; rev 7's settle hangs the rest below the ears
//     (sim6.js drape7Rest, REV7.drape), so the length lies on the shoulders, chest and back.
//   - ROPES (box braids, locs; c2 iteration 4): the rope's base laid along the scalp by its comb (rope7); since c5 it 10 back and down from
//     the hairline, away from the face (the old horizontal base deleted c7 it 1: git history).
//   - LOCKS (c3 iteration 1; the behaviour since c7 it 1, no switch): the Cycles strands of a card cohere into locks (person_hair.py).
//   - FOLLICLES (c3 iteration 2): every Cycles scalp fibre grows from its OWN follicle on the skin (person_hair.py FOL, follicle_strands):
//     the head's follicle field (the hairline, the jagged part, the scalp's radius) rides in the export marker (fol7), and the skin's
//     painted part line follows the same jag as the roots (shade.js hzPart3). The behaviour since c7 it 1 (no switch).
//     (c3 iteration 3) under fol the follicle field ALONE makes the hair-skin interface in Cycles: the painted root base retired (index.js
//     baseK 0), each follicle a follicular unit (singles at the line), the hairline's fine hairs pigmented, an afro's shell fibres rising
//     from follicles under them (person_hair.py). The base is retired only where the person is built for Cycles (o.cycles: makePerson's
//     export); the engine's cards are not fibres and keep it.
//   - BOX BRAIDS AS A BRAIDER MAKES THEM (c4 iteration 1, since c5 it 9 the behaviour, no switch; ropes: box braids and locs): the scalp PARTED into boxes (rows by
//     distance over the scalp from the hairline, columns by arc along each row from the part, brick-laid), one rope per box rooted at its
//     centre, each box's own hair gathered taut on the skin into its rope (the partings between boxes are the only scalp that shows), and
//     a braid a THREE-STRAND PLAIT (the over-under; engine: the tube's relief from the plait's strands; Cycles: three bundles of fibres on
//     the plait's paths) where it was a three-lobed twist. box7, plait7r below; v3.js ropes; person_hair.py rope_strands.
// Constants in REV7. No switches (c7 it 1, the 15 Oct directive: every built system ON): rope7 with its fall, cohere7, locks and follicles
// are the behaviour for every groom; box braids since c5 it 9.
import * as THREE from 'three';
import { sstep, faceDir } from './field.js';
import { V, sampleRoots, skinBlend, scalpCells } from './grow.js';
import { REG } from './field.js';
import { registerLayer, FORMS, cm, rr } from './styles.js';
import { growV3, flow3, faceWindow } from './v3.js';

export const REV7 = {
  part: { half: 0.06, skin: 0.3 }, part5: { count: 760, band: 0.6, len: [0.8, 2.8] },
  jag: { amp: 0.22, lam: [1.35, 0.55] },                                  // cm: the part's zig-zag
  line: { count: 950, out: 0.3, band: 1.6, w: [0.2, 0.55], len: [0.6, 5.0], fwd: 0.35 },   // cm (count per head)
  hl: { menFront: -0.9, menTemple: 0.5, womenFront: 0, womenTemple: 0.7, womenSide: -1.0, menSide: 0 },  // front, side: cm added to the style's; temple: x the recess
  side: { k: { m: 0.7, f: 0.5 }, len: 0.5, from: 0.0015 },                 // cm of extra volume beside the face; a crop's side length floor
  base: { inset: 0.25, ramp: 0.6 },                                        // cm: the painted root base inside the line, its ramp
  shade: { eu: [0.9, 2.6], darkR: 0.45, darkE: 0.4, grey: [0.12, 0.5], greyR: 0.45, greyE: 0.35, greyAlb: 0.3, greyCut: 0.25 },
  // ropes off the face (c2 iteration 4): rope7, the rope's BASE laid along the scalp by its comb to where it can fall clear of the face
  braid: { up: 0.35, a: [0.85, 1.25], band: 6.0, maxBase: 12, share: 0.4,
    // (c5 it 10) the base follows the braider's pull AWAY FROM THE FACE: from a point `pf` x rz in front of the skull at the eyes' height, plus
    // `side` toward the part's side, along the scalp; it stops once behind `zBack` x rz (behind it a fall never crosses the face) or clear of
    // the face at the side; it rises `over` x its offset within `overL` cm so it lies over the next rows' boxes (a braider's layering)
    pf: 2.0, side: 0.5, zBack: 0.15, over: 2.0, overL: 1.5,
    // (c5 it 11, cohere7) hanging ropes that come to lie within `reach` cm of each other (mean over their lower part) TOUCH and hang as one
    // bundle: friction and the fibres' fuzz hold braids in contact; round braids of one radius pack into bundles of at most `max` that all
    // touch (a fourth no longer touches every other: it lies beside, a new bundle); the contact grows along the rope over t[0]..t[1] of
    // its arc (the hold and the base near the scalp keep each braid in its own box); `k` of the gap closed
    co: { reach: 2.4, max: 3, t: [0.35, 0.8], k: 0.85 } },
  // METRES from the eyes (bind). Iteration 3 (sim6.js drape7Hang): each strand's CENTRELINE (smoothed over +-sm of arc) hangs
  // below y0 (full by y1), or below the eyes (yl) wherever it stands c[0]..c[1] outside the head's horizontal outline; its curl (the
  // residual) is added back turned with it; strands shorter than len[0] keep their groom (full drape from len[1]); per strand the outward
  // cut is lat less up to `spread` (a ragged edge, not a plane); by form lat (the outward part removed) and down (the pull toward straight
  // down): curls and coils keep a little of their spread (a curly mass widens below the shoulders in the photographs; it does not stand
  // off them).
  drape: { y0: -0.03, y1: -0.055, c: [0.01, 0.025], yl: [0.0, -0.02], len: [0.10, 0.18], spread: 0.3, curl: 1,
    sm: { straight: 0.008, wavy: 0.014, curly: 0.022, coily: 0.018 },
    lat: { straight: 1.0, wavy: 1.0, curly: 0.9, coily: 0.85 }, down: { straight: 0.9, wavy: 0.85, curly: 0.8, coily: 0.75 } },
  sub: { k: 1.25, min: 0.8 },                                             // the guide's runs no longer than max(k x its segLen, min cm) (sub7)
  // box braids (c4 iteration 1, box7 / plait7r): the parting's width (cm), a box under `merge` x the mean box joins its neighbour, `K`
  // gather cards a box (the edges of its outline seen from its root: a fan), the plait's strands in units of the braid's radius (lateral swing ax, depth swing az,
  // strand radius rho: az >= 1.155 rho so two strands crossing never meet; a V (one crossing) per braid diameter; the engine tube keeps
  // `relief` of the strands' outline: the fibres' fuzz and the strands' flattening fill part of the grooves), the tube's sides
  box: { gutter: 0.25, merge: 0.4, K: 16, off0: 0.05, wK: 1.06, plait: { ax: 0.55, az: 0.6, rho: 0.5, relief: 0.5 }, sides: 8, bins: 72 },
};
// the drape for a groom of `form` (numbers for sim6.js)
export function drape7(form) {
  const by = v => typeof v === 'number' ? v : (v[form] ?? v.straight), D = REV7.drape;
  return { y0: D.y0, y1: D.y1, c0: D.c[0], c1: D.c[1], yl0: D.yl[0], yl1: D.yl[1], len: D.len, spread: D.spread, curl: D.curl, sm: by(D.sm), lat: by(D.lat), down: by(D.down) };
}
// the guide's points with every run longer than max(k x segLen, min) split evenly (straight in between: the corkscrew, the drape and the
// settle bend it)
export function sub7() {
  const R = REV7.sub;
  const yMax = F => F.eyeY + (REV7.drape.y0 ?? -0.03);   // only runs that reach below the drape's start (above it the groom stays exactly as it was)
  return (pts, segLen, F) => { const mx = Math.max(R.k * (segLen || 0.012), R.min / 100), y0 = F ? yMax(F) : Infinity, long = k => pts[k].distanceTo(pts[k - 1]) > mx && Math.min(pts[k].y, pts[k - 1].y) < y0;
    let any = false; for (let k = 1; k < pts.length && !any; k++) if (long(k)) any = true; if (!any) return pts;
    const out = [pts[0]]; for (let k = 1; k < pts.length; k++) { if (long(k)) { const n = Math.ceil(pts[k].distanceTo(pts[k - 1]) / mx); for (let j = 1; j < n; j++) out.push(pts[k - 1].clone().lerp(pts[k], j / n)); } out.push(pts[k]); } return out; };
}
// (HAIR7 c5 iteration 9, 15 Oct) box braids ARE the rope groom (the parting grid, gathered boxes, the plait): no switch; boxOn stays only
// so the call sites read; every rope groom is parted into boxes
export const boxOn = () => true;

// ---------------------------------------------------------------- the hairline (the style's own, men's fronts lower)
export function hairline7(H = {}, sex) {
  const R = REV7.hl, fem = sex === 'f', H7 = { ...H };
  const front = H.front ?? (fem ? 6.0 : 6.4), temple = H.temple ?? (fem ? 0.4 : 1.0);
  H7.front = front + (fem ? R.womenFront : R.menFront); H7.temple = temple * (fem ? R.womenTemple : R.menTemple);
  // (the women's temple hair came down only to 1.6 cm above the eyes: the temple patch beside the face sat on the line itself, roots and skin)
  H7.side = (H.side ?? (fem ? 1.6 : -1.0)) + (fem ? R.womenSide : R.menSide);
  return H7;
}

// ---------------------------------------------------------------- the part: a jagged line, hair that crosses it
export function part7(part, F, o = {}) {
  if (!part) return part;
  const J = REV7.jag, a = cm(J.amp), l0 = cm(J.lam[0]), l1 = cm(J.lam[1]), ph0 = (o.seed ?? 1) * 1.7, ph1 = (o.seed ?? 1) * 2.9;
  const m = part.m, C = F.C;
  // the signed distance from the jagged part (m: the plane's normal; the jag runs along the part, i.e. along z over the top)
  const jag = p => a * (0.65 * Math.sin((p.z - C.z) / l0 * 2 * Math.PI + ph0) + 0.35 * Math.sin((p.z - C.z) / l1 * 2 * Math.PI + ph1));
  const sd = p => (p.x - C.x) * m.x + (p.z - C.z) * m.z - jag(p);
  const dist = p => Math.abs(sd(p)), hw = part.hw;
  return { ...part, sd, dist, jag, jagP: [a, l0, l1, ph0, ph1], gap: p => 0.97 * sstep(hw * 1.35, hw * 0.55, dist(p)) * part.along(p) };
}
// the comb: a root on the other side of the jagged line than of the straight plane combs to its own side (the across-part part of the
// flow mirrored), within 2.5 cm of the part over the top of the head only
export function flow7(part) {
  if (!part?.sd) return null;
  const m = part.m;
  return (flow0, F) => (p, n) => { const v = flow0(p, n); if (part.along(p) < 0.05) return v;
    const s0 = (p.x - F.C.x) * m.x + (p.z - F.C.z) * m.z, s7 = part.sd(p); if (Math.abs(s0) > 0.025 || Math.sign(s0) === Math.sign(s7)) return v;
    const vm = v.x * m.x + v.z * m.z, w = vm * Math.sign(s0) > 0 ? 1 : 0; if (!w) return v;
    const r = v.clone(); r.x -= 2 * vm * m.x; r.z -= 2 * vm * m.z; return r.addScaledVector(n, -r.dot(n)).normalize(); };
}
// roots out of the jagged band (the hairline fn keeps .dist / .extra / .line / .knots)
export function densWithPart7(dens, part) {
  if (!part) return dens;
  const fn = (p, ph) => dens(p, ph) * (1 - part.gap(p));
  return Object.assign(fn, dens);
}

// ---------------------------------------------------------------- the volume beside the face
// a push for the hair's body: points held off the head by `off` are held off by off + k more where the hair lies beside the face (the
// temples and over the ears); the roots and the fine strands (off under `from`) are left as they were, so the hair rises off the scalp
// over its first centimetres instead of standing up at the root
export function sideRegion(F) {
  const top = F.earTop - F.eyeY;
  return p => { const aph = Math.abs(Math.atan2(p.x - F.C.x, p.z - F.C.z)), ys = p.y - F.eyeY;
    return sstep(0.72, 0.98, aph) * sstep(2.15, 1.85, aph) * sstep(top - 0.012, top + 0.012, ys) * sstep(0.085, 0.05, ys); };
}
export function sidePush7(F, push0, k, from = REV7.side.from) {
  const reg = sideRegion(F);
  return (p, off = 0.002) => { const e = k * reg(p) * sstep(from * 0.5, from, off); return push0(p, off + e); };
}
// a crop's clipper-short sides kept at least `len` of the top's length (rev 7 only: a 30 % side under a flat card was scalp with dashes)
export function layer7(L) {
  const f = REV7.side.len; if (!L.taper || (L.taper.side ?? 1) >= f) return L;
  return { ...L, taper: { ...L.taper, side: f } };
}

// ---------------------------------------------------------------- the line: single fine strands across the hairline
const outOf = F => p => { const a = p.clone().sub(F.C).normalize(), t = sstep(F.chinY + 0.01, F.chinY - 0.05, p.y); if (t <= 0) return a;
  const b = V(p.x, 0, p.z - F.axZ); if (b.lengthSq() < 1e-8) return a; b.normalize(); return a.multiplyScalar(1 - t).addScaledVector(b, t).normalize(); };
const SRC = ['mane', 'scalp', 'guides', 'braids', 'locs3', 'afro', 'coils', 'cornrows', 'locs', 'frame'];
registerLayer('line7', (ctx, L, dens) => {
  const { F, B, rnd, o, style } = ctx; if (!dens?.dist || !dens.line) return;
  const R = { ...REV7.line, ...L }, src = (style?.layers || []).find(l => SRC.includes(l.kind)) || {}, Fm = FORMS[src.form || ctx.form] || FORMS.straight;
  const fl0 = flow3(F, { ...(src.flow || { type: 'back' }), to: src.flow?.to || src.gather?.to }), flow = ctx.flow7 ? ctx.flow7(fl0, F) : fl0;
  const out = cm(R.out), band = cm(R.band), part = ctx.part5;
  const d7 = (p, ph) => { const e = dens.dist(p, ph); return sstep(-out, out * 0.6, e) * (0.45 + 0.55 * sstep(0, band * 0.5, e)) * sstep(band, band * 0.55, e) * dens.extra(p) * (part ? 1 - part.gap(p) : 1); };
  const roots = sampleRoots(F, d7, Math.round(R.count * (o.density ?? 1)), rnd);
  // the source layer's own length (the strands inside the band reach toward it; a crop's are short)
  const sLen = Array.isArray(src.len) ? (src.len[0] + src.len[1]) / 2 : (src.len ?? 6), lenMax = Math.max(R.len[0] + 0.3, Math.min(R.len[1], sLen * 0.7 * (Fm.len ?? 1)));
  const curl = Fm.kind === 'curl' && Fm.A > 0, outF = outOf(F), face = faceWindow(F, {}), C = F.C;
  const taut = tautOf7(F);   // (c6 it 3: a parted groom's line hairs are combed taut into their box)
  let made = 0, combed = 0;
  for (const sp of roots) {
    const e = dens.dist(sp.p, sp.ph), inK = sstep(-out, band * 0.8, e), front = sstep(0.95, 0.45, Math.abs(sp.ph));
    const tb = taut ? taut(sp.p) : null;
    if (tb) { const g = growV3(F, sp, Math.min(cm(R.len[1]), tb.reach), { lift: 0.01, stiff: 0.95, comb: 1, grav: 0, jit: 0.05, off0: 0.0002, off1: 0.0005, ramp: 0.02, crown: 0, cling: 1, clingY: -1,
        segLen: cm(0.3), maxSeg: 16, face }, rnd, tb.flow);
      if (g.pts.length < 2) continue;
      const w = cm(R.w[0] + (R.w[1] - R.w[0]) * inK) * (0.7 + 0.6 * rnd()), ua = rnd() * 0.4;
      B.ribbon(g.pts, { tile: 'straight', ua, ub: ua + 0.45 + 0.15 * rnd(), w0: w, w1: w * 0.35, taper: 1.2, roll: (rnd() - 0.5) * 0.3, depth: 0.12, rand: rnd(), grey: ctx.greyBias(sp.p),
        out: outF, bend: 0.85, skin: p => skinBlend(F, sp, p), rootL: 0.002, C });
      made++; combed++; continue; }
    const len = cm(R.len[0] + (lenMax - R.len[0]) * Math.pow(inK, 1.3)) * (0.65 + 0.7 * rnd()) * (curl ? 0.7 : 1);
    // outside the line and at the front the strand falls forward a little (a soft overhang, not a comb line)
    const fwd = R.fwd * (1 - inK) * front, fl = fwd > 0.01 ? (p, n) => { const v = flow(p, n).clone().addScaledVector(V(0, -1, 0.35).normalize(), fwd); return v.addScaledVector(n, -v.dot(n)).normalize(); } : flow;
    const g = growV3(F, sp, len, { lift: 0.03 + 0.06 * inK, stiff: 0.9, comb: 0.9, grav: 0.15 + 0.5 * inK, jit: 0.14, off0: 0.0003, off1: 0.0012 + 0.003 * inK, ramp: 0.03, crown: 0, cling: 0.95, clingY: -1,
      segLen: cm(curl ? 0.25 : 0.45), maxSeg: 16, face }, rnd, fl);
    let pts = g.pts; if (pts.length < 2) continue;
    if (curl) { const A = cm(0.12 + 0.12 * inK), lam = cm(0.5 + 0.4 * inK); pts = wave7(F, pts, A, lam, rnd() * 6.283); for (const p of pts) face(p); }
    const w = cm(R.w[0] + (R.w[1] - R.w[0]) * inK) * (0.7 + 0.6 * rnd()), ua = rnd() * 0.4;
    B.ribbon(pts, { tile: inK < 0.35 ? 'sparse' : 'straight', ua, ub: ua + 0.45 + 0.15 * rnd(), w0: w, w1: w * 0.35, taper: 1.2, roll: (rnd() - 0.5) * 0.5, depth: 0.12 + 0.3 * inK, rand: rnd(), grey: ctx.greyBias(sp.p),
      out: outF, bend: 0.8, skin: p => skinBlend(F, sp, p), rootL: 0.002, C });
    made++;
  }
  ctx.stats.push({ kind: 'line7', strands: made, ...(taut ? { combed } : {}) });
});
// (c6 iteration 3, 15 Oct; the behaviour, no switch) THE HAIRLINE OF A PARTED GROOM IS COMBED TAUT INTO ITS BOXES. What the Cycles
// portrait showed (060212, L14 1:1): a dark coiled ruff hanging 0.5-1 cm below the box braids' front edge onto the forehead. Node (the
// front +-40 deg, L14): line7's strands reached 1.0 cm below the line (the vellus 0.3 cm), grown along the braid layer's flow with
// gravity, a forward fall and the coily wave, as if the hairline were loose hair. How box braids are made: the braider combs every
// terminal hair of a box from the box's edge to its centre under tension and plaits it there; the hairline's hairs are the front boxes'
// own and go into them (only the vellus beyond the line stays, fringe3's). So: in a groom parted into boxes (box7, F._box7), a line7 root
// that lies in a box (within 1.5 cells of one of its cells) grows along the skin toward its box's root (the comb direction under tension:
// no gravity, no fall, no wave, clinging), as long as the way to the root at most; a root beyond every box is left as before. Any person,
// any parted groom (braids, sectioned locs); unparted grooms are untouched.
function tautOf7(F) {
  const bx = F._box7; if (!bx?.boxes?.length) return null;
  const h = 0.004, key = (x, y, z) => `${x},${y},${z}`, grid = new Map(), cellM = (bx.cellMm || 1) / 1000, near = Math.max(0.0025, 1.5 * cellM);
  bx.boxes.forEach((b, bi) => { for (const c of b.cells) { const k = key(Math.floor(c.p.x / h), Math.floor(c.p.y / h), Math.floor(c.p.z / h)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([c.p, bi]); } });
  return p => {
    const a = Math.floor(p.x / h), b = Math.floor(p.y / h), c = Math.floor(p.z / h); let best = -1, bd = near;
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) { const L = grid.get(key(a + x, b + y, c + z)); if (L) for (const [q, bi] of L) { const d = p.distanceTo(q); if (d < bd) { bd = d; best = bi; } } }
    if (best < 0) return null;
    const r = bx.boxes[best].sp.p, reach = p.distanceTo(r) * 0.95; if (reach < 0.002) return null;
    // the comb: toward the box's root along the skin (the tangent part of the way there)
    return { reach, flow: (q, n) => { const v = r.clone().sub(q); v.addScaledVector(n, -v.dot(n)); return v.lengthSq() > 1e-10 ? v.normalize() : n.clone().cross(V(1, 0, 0)).normalize(); } };
  };
}
// a planar wave in the hair surface (curly hairlines: the edge's hairs are looser than the curls behind them)
function wave7(F, pts, A, lam, ph) {
  const outp = [pts[0].clone()]; let s = 0;
  for (let k = 1; k < pts.length; k++) { s += pts[k].distanceTo(pts[k - 1]);
    const d = (k < pts.length - 1 ? pts[k + 1] : pts[k]).clone().sub(pts[k - 1]).normalize(), o = pts[k].clone().sub(F.C).normalize(), side = d.clone().cross(o).normalize();
    outp.push(F.push(pts[k].clone().addScaledVector(side, A * sstep(0, 0.004, s) * Math.sin(ph + s / lam * 2 * Math.PI)), 0.0004)); }
  return outp;
}

// (c2 iteration 4 replaced iteration 1's per-point keep-out, brow7, which made L14's rope cage; it is in git history)
// ---------------------------------------------------------------- ropes: the BASE laid along the scalp by its comb (c2 iteration 4)
// What the plates showed of iteration 1's keep-out (the orchestrator, 8 Oct 13:55, board7_s5_women_1to1_final: 'in front the ropes stand
// out from the crown as a box of straws, in three-quarter they cross the face'; node, labs/human8/hair7_scratch/ropes4.mjs on L14's
// settled ropes: 232 rope nodes standing > 2 cm off the forehead and temples (v6 2), 143 right-angle jogs (v6 51), 185 nodes over the
// face in a 35 deg three-quarter view (v6 116)): brow7 lifted each point that fell below the line over the forehead ONTO the line at its
// own distance off the skull, so a rope hanging 5 cm in front of the forehead became a shelf 5 cm in front of the hairline (the box's top)
// that slid sideways until it left the reach and dropped (its sides); and it moved points one at a time, so a rope's neighbours on either
// side of the keep's edge were centimetres apart (the jogs that cross the cheek in three-quarter).
// Why real box braids leave the face (a braider's view, not a target): each braid is anchored in its box, and the braider pulls the hair
// AWAY FROM THE FACE as she plaits, so the braid's base (the scalp hair plaited into it, and the first centimetres of the plait under its
// tension) lies ALONG THE SCALP in that direction: from a box at the front hairline sideways along the line toward the temple, from a box
// further back sideways round the head above it; the rope hangs from where its base ends. Nothing then holds it off the forehead: it is
// never there. v6's ropes had a 3 cm base grown along the 'drape' comb, which at the front points down (and gravity bent the growth down
// within a few cm), so the front ropes hung down the forehead (the forks).
// rope7: for a rope rooted in the front sector (|azimuth| < a[1]) within `band` cm inside the hairline and still in front of the face
// (|x| < xClear: the face window's half-width plus the rope), the base runs on the scalp (at the rope's own layer off it) back and down
// from the hairline toward the side its comb points to (c5 it 10), never below the line + `up`, until it is clear of the face
// (or maxBase cm, or `share` of the rope); the rest is grown from the base's end exactly as before (the same comb, gravity, volume) and the
// settle (v3.js settleRope) holds the base and lets the rest fall. Returns null for every other rope (they are grown as in v6).
export function rope7(F, dens, o = {}) {
  if (!dens?.line || !dens.dist) return null;
  const R = REV7.braid;
  const C = F.C, band = cm(R.band), up = cm(R.up), maxL = cm(R.maxBase);
  // the point at height y over the scalp at `off` off the skull, moved horizontally (a radial move from the skull centre, which lies above
  // the forehead, would change its height)
  const onSkullH = (p, off) => { for (let it = 0; it < 4; it++) { const qx = p.x - C.x, qy = p.y - C.y, qz = p.z - C.z, q = Math.hypot(qx, qy, qz), h = Math.hypot(qx, qz); if (q < 1e-6 || h < 1e-5) break;
    const rq = F.rAt(qx / q, qy / q, qz / q); if (!(rq > 0)) break; const t = rq + off, hh = Math.sqrt(Math.max(0, t * t - qy * qy)), k = hh / h; if (Math.abs(k - 1) < 1e-4) break; p.x = C.x + qx * k; p.z = C.z + qz * k; } return p; };
  return (sp, { off, total, xClear, flow, step }) => {
    const p0 = sp.p, a0 = Math.atan2(p0.x - C.x, p0.z - C.z); if (Math.abs(a0) > R.a[1] || Math.abs(p0.x - C.x) >= xClear) return null;
    const e = dens.dist(p0, sp.ph); if (e < -cm(0.5) || e > band) return null;
    // the side its comb points to (the part's side: the comb's component round the head), else the side it is on
    const ta = V(Math.cos(a0), 0, -Math.sin(a0)), fv = flow ? flow(p0, sp.n) : null, s = Math.sign(fv ? fv.dot(ta) : 0) || Math.sign(p0.x - C.x) || 1;
    const lim = Math.min(maxL, total * R.share);
    {   // (c5 it 10) back and down from the hairline, the pull away from the face, lying over the rows behind
      const Pf = V(C.x, F.eyeY, C.z + R.pf * F.rz), offAt = L => off * (1 + R.over * sstep(0, cm(R.overL), L));
      const onSkullR = (p, of) => { const d = p.clone().sub(C), l = d.length() || 1; d.multiplyScalar(1 / l); const rq = F.rAt(d.x, d.y, d.z); return rq > 0 ? p.copy(C).addScaledVector(d, rq + of) : p; };
      const pts = [onSkullR(p0.clone(), off)]; let L = 0;
      while (L < lim) { const q = pts.at(-1), a = Math.atan2(q.x - C.x, q.z - C.z);
        if (s * (q.x - C.x) >= xClear || q.z - C.z <= R.zBack * F.rz) break;
        const nq = q.clone().sub(C).normalize(), u = q.clone().sub(Pf).normalize().addScaledVector(V(Math.cos(a) * s, 0, -Math.sin(a) * s), R.side);
        u.addScaledVector(nq, -u.dot(nq)); if (u.lengthSq() < 1e-10) break; u.normalize();
        const n = q.clone().addScaledVector(u, step); onSkullR(n, offAt(L + step));
        const yMin = F.eyeY + dens.line(Math.abs(Math.atan2(n.x - C.x, n.z - C.z))) + up; if (n.y < yMin) { n.y = yMin; onSkullH(n, offAt(L + step)); }
        L += n.distanceTo(q); pts.push(n); }
      if (pts.length < 2) return null;
      const end = pts.at(-1), dd = end.clone().sub(C), l = dd.length() || 1;
      return { pts, len: L, end, n: dd.multiplyScalar(1 / l) };
    }
  };
}

// ---------------------------------------------------------------- hanging ropes cohere (c5 iteration 11; no switch since c7 it 1)
// Why real braids hang in twos and threes (a physical view, not a target): settled one by one, each rope hung on its own path and the
// ends fanned out evenly, a comb's teeth. Real braids are heavy fibre cylinders with fuzzy surfaces: two that come to rest near each
// other touch, their friction and the interlocked surface fibres hold the contact, and from there down they hang as one bundle; a bundle
// of equal round braids is closed at three (each touches the other two). The mechanism here: after every rope has settled, pair ropes by
// how close their lower parts hang (greedy, closest first, a bundle closed at `max`, every member within `reach` of every other), then
// draw each member toward its bundle's centreline until it touches (r for two, 2r/sqrt3 for three), the pull growing along the arc so the
// roots stay in their boxes; then out of the body again (push). recs: [{ pts (settled), r, lay }]. Returns the bundle sizes.
export function cohere7(F, recs, push, o = {}) {
  if (recs.length < 2) return null;
  const R = REV7.braid.co, reach = cm(R.reach), at = (X, t) => { const f = t * (X.length - 1), k = Math.min(X.length - 2, Math.floor(f)), u = f - k; return X[k].clone().lerp(X[k + 1], u); };
  const hang = recs.map(q => q.pts.length >= 4 && q.pts.at(-1).y < F.chinY), sig = recs.map(q => [0.6, 0.8, 1].map(t => at(q.pts, t)));
  const dist = (i, j) => (sig[i][0].distanceTo(sig[j][0]) + sig[i][1].distanceTo(sig[j][1]) + sig[i][2].distanceTo(sig[j][2])) / 3;
  const P = []; for (let i = 0; i < recs.length; i++) if (hang[i]) for (let j = i + 1; j < recs.length; j++) if (hang[j]) { const d = dist(i, j); if (d < reach) P.push([d, i, j]); }
  P.sort((a, b) => a[0] - b[0]);
  const g = recs.map((_, i) => [i]);
  for (const [, i, j] of P) { const A = g[i], B = g[j]; if (A === B || A.length + B.length > R.max) continue;
    if (!A.every(a => B.every(b => dist(a, b) < reach))) continue;
    const M = A.concat(B); for (const m of M) g[m] = M; }
  const groups = [...new Set(g)].filter(G => G.length > 1);
  for (const G of groups) {
    const rr0 = G.reduce((s, i) => s + recs[i].r, 0) / G.length, touch = rr0 * (G.length === 2 ? 1 : 2 / Math.sqrt(3));
    const moved = G.map(i => { const X = recs[i].pts, n = X.length;
      return X.map((p, k) => { const t = k / (n - 1), w = R.k * sstep(R.t[0], R.t[1], t); if (w <= 0) return p.clone();
        const c = V(0, 0, 0); for (const m of G) c.add(at(recs[m].pts, t)); c.multiplyScalar(1 / G.length);
        const d = p.clone().sub(c), dl = d.length(); if (dl <= touch || dl < 1e-6) return p.clone();
        return c.addScaledVector(d, (1 - w) + w * touch / dl); }); });
    G.forEach((i, gi) => { const X = recs[i].pts; for (let k = 1; k < X.length; k++) { X[k].copy(moved[gi][k]); push(F, X[k], recs[i].lay * 0.9); } });
  }
  const sizes = {}; for (const G of groups) sizes[G.length] = (sizes[G.length] || 0) + 1;
  return { bundles: sizes, alone: recs.length - groups.reduce((s, G) => s + G.length, 0) };
}

// ---------------------------------------------------------------- box braids: the parting grid and the plait (c4 iteration 1, since c5 it 9 the behaviour, no switch)
// What the plates showed (L14, engine 1008-144043 and Cycles 1008-144054 at 1:1; the orchestrator's 21:10 look: 'flat plastic strips with a
// spider pattern over the scalp'): rope7's bases lie as a comb of tubes across BARE scalp, a bare band either side of the centre part, the
// crown from behind a bare dome. The cause: every rope is rooted at a blue-noise point (sampleRoots) and nothing of the hair between the
// roots is on the skin; the tube between is the only hair. How box braids are made (a braider's craft, not a target): the head is PARTED
// into a grid of boxes, in rows from the hairline (along it at the front, across the back), each row into boxes of about the same width,
// brick-laid so a braid of one row hangs between two of the row below; the box's hair is combed TAUT from the box's edges to its centre
// and plaited from there, so each box is covered by its own hair converging on its braid and only the partings (2-3 mm) show scalp; a
// braid is three strands crossed over (or under) the middle in turn, so its surface is a stack of V's, one a braid diameter long.
// box7: rows = geodesic distance over the scalp from the hairline (a Dijkstra over the head's scalp cells), cut every box height;
// columns = arc along each row from the part (the part is a parting: the part's plane, from the rope layer's flow), cut every box width
// (that row's arc split evenly), odd rows offset half a box (the end half-boxes joined to their neighbours); a box smaller than `merge` x
// the mean joins the nearest box on its side; the box size from the style's rope count (the hair-bearing area / count). The rope is rooted
// at the box's centroid on the skin; the box's cells come back for its gather cards (v3.js ropes). No per-person value: the grid is the
// head's and the style's.
export function box7(F, dens0, o = {}) {
  if (!boxOn(o) || !dens0) return null;
  const R = REV7.box, C = F.C;
  return (L, n, rnd) => {
    const all = scalpCells(F), cells = all.filter(c => dens0(c.p, c.ph) >= 0.5); if (cells.length < 50 || n < 1) return null;
    const N = cells.length; let area = 0; for (const c of cells) area += c.area; const A = area / n, W = Math.sqrt(A);
    // the scalp's neighbour graph (cube-map cells, ~1-1.5 mm apart): a spatial hash, neighbours within 2.6 mm
    const h = 0.003, rad = 0.0026, key = (x, y, z) => `${x},${y},${z}`, grid = new Map(), ix = p => [Math.floor(p.x / h), Math.floor(p.y / h), Math.floor(p.z / h)];
    cells.forEach((c, i) => { const k = key(...ix(c.p)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
    const hairK = new Set(cells.map(c => c.ci)), nb = cells.map(() => []), src = new Uint8Array(N);
    const gridAll = new Map(); for (const c of all) { if (hairK.has(c.ci)) continue; const k = key(...ix(c.p)); if (!gridAll.has(k)) gridAll.set(k, []); gridAll.get(k).push(c); }
    cells.forEach((c, i) => { const [a, b, e] = ix(c.p);
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
        const L1 = grid.get(key(a + x, b + y, e + z)); if (L1) for (const j of L1) { if (j === i) continue; const d = c.p.distanceTo(cells[j].p); if (d < rad) nb[i].push(j, d); }
        const L2 = gridAll.get(key(a + x, b + y, e + z)); if (L2 && !src[i]) for (const q of L2) if (c.p.distanceTo(q.p) < rad) { src[i] = 1; break; } } });
    // geodesic distance from the line (multi-source Dijkstra; a binary heap)
    const g = new Float64Array(N).fill(Infinity), H = [], push = (d, i) => { H.push([d, i]); let k = H.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (H[p][0] <= H[k][0]) break; [H[p], H[k]] = [H[k], H[p]]; k = p; } },
      pop = () => { const top = H[0], last = H.pop(); if (H.length) { H[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < H.length && H[l][0] < H[m][0]) m = l; if (r < H.length && H[r][0] < H[m][0]) m = r; if (m === k) break; [H[m], H[k]] = [H[k], H[m]]; k = m; } } return top; };
    for (let i = 0; i < N; i++) if (src[i]) { g[i] = 0; push(0, i); }
    if (!H.length) return null;
    while (H.length) { const [d, i] = pop(); if (d > g[i]) continue; const L1 = nb[i]; for (let k = 0; k < L1.length; k += 2) { const j = L1[k], dj = d + L1[k + 1]; if (dj < g[j]) { g[j] = dj; push(dj, j); } } }
    // the part: the rope layer's flow part (degrees; partOf's plane), its front azimuth
    const pa = ((L.flow?.part ?? 0) * Math.PI) / 180, wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
    const row = new Int32Array(N), side = new Int8Array(N), az = new Float64Array(N);
    let rows = 0; cells.forEach((c, i) => { const gi = Number.isFinite(g[i]) ? g[i] : 0; row[i] = Math.floor(gi / W); rows = Math.max(rows, row[i] + 1); az[i] = wrap(c.ph - pa); side[i] = az[i] >= 0 ? 1 : -1; });
    // columns: per row and side, the arc along the row (bin means joined in order from the part), split evenly into boxes
    const col = new Int32Array(N), nB = R.bins / 2, bw = Math.PI / nB;
    for (let r0 = 0; r0 < rows; r0++) for (const sd of [1, -1]) {
      const idx = []; for (let i = 0; i < N; i++) if (row[i] === r0 && side[i] === sd) idx.push(i); if (!idx.length) continue;
      const M = Array.from({ length: nB }, () => [0, 0, 0, 0]); for (const i of idx) { const b = Math.min(nB - 1, Math.floor(Math.abs(az[i]) / bw)), m = M[b], w = cells[i].area; m[0] += cells[i].p.x * w; m[1] += cells[i].p.y * w; m[2] += cells[i].p.z * w; m[3] += w; }
      const kn = []; let cum = 0, prev = null; for (let b = 0; b < nB; b++) { const m = M[b]; if (!m[3]) continue; const q = V(m[0] / m[3], m[1] / m[3], m[2] / m[3]); if (prev) cum += q.distanceTo(prev); kn.push([(b + 0.5) * bw, cum]); prev = q; }
      const sOf = a => { if (kn.length === 1) return a * W / bw; if (a <= kn[0][0]) { const rate = (kn[1][1] - kn[0][1]) / (kn[1][0] - kn[0][0]); return kn[0][1] + (a - kn[0][0]) * rate; }
        for (let k = 1; k < kn.length; k++) if (a <= kn[k][0]) return kn[k - 1][1] + (a - kn[k - 1][0]) * (kn[k][1] - kn[k - 1][1]) / (kn[k][0] - kn[k - 1][0]);
        const k = kn.length - 1, rate = (kn[k][1] - kn[k - 1][1]) / (kn[k][0] - kn[k - 1][0]); return kn[k][1] + (a - kn[k][0]) * rate; };
      const s0 = sOf(0), S = Math.max(1e-4, sOf(Math.PI) - s0), nc = Math.max(1, Math.round(S / W)), wr = S / nc, odd = r0 % 2 === 1;
      for (const i of idx) { const s = Math.max(0, sOf(Math.abs(az[i])) - s0); let c = Math.floor(s / wr + (odd ? 0.5 : 0)); c = odd && nc >= 2 ? Math.min(nc - 1, Math.max(1, c)) : Math.min(nc - 1, Math.max(0, c)); col[i] = c; } }
    // boxes, their area and centroid; small ones join the nearest box on their side
    const keyB = i => row[i] * 4096 + (side[i] > 0 ? 2048 : 0) + col[i], B = new Map();
    const build = () => { B.clear(); for (let i = 0; i < N; i++) { const k = keyB(i); let b = B.get(k); if (!b) B.set(k, b = { key: k, row: row[i], side: side[i], col: col[i], cells: [], area: 0, c: V() }); b.cells.push(i); b.area += cells[i].area; b.c.addScaledVector(cells[i].p, cells[i].area); } for (const b of B.values()) b.c.multiplyScalar(1 / b.area); };
    build(); let merged = 0;
    for (const b of [...B.values()].sort((x, y) => x.area - y.area)) { if (b.area >= R.merge * A || B.size < 2) continue; let best = null, bd = 1e9;
      for (const o2 of B.values()) { if (o2 === b || o2.side !== b.side || o2.area < R.merge * A) continue; const d = o2.c.distanceTo(b.c) + (o2.row === b.row ? 0 : 0.25 * W); if (d < bd) { bd = d; best = o2; } }
      if (!best) continue; for (const i of b.cells) { row[i] = best.row; col[i] = best.col; side[i] = best.side; } best.cells.push(...b.cells); best.c.multiplyScalar(best.area).addScaledVector(b.c, b.area); best.area += b.area; best.c.multiplyScalar(1 / best.area); B.delete(b.key); merged++; }
    // the root on the skin at the centroid (cast from the skull's centre)
    const roots = [], boxes = []; let miss = 0;
    for (const b of [...B.values()].sort((x, y) => x.key - y.key)) {
      const d = b.c.clone().sub(C).normalize(), hit = F.cast(d.x, d.y, d.z); let sp = hit ? F.surf(hit.tri, hit.b1, hit.b2) : null;
      if (!sp || F.h.aHero[sp.verts[0] * 4] !== REG.head) { let bi = b.cells[0], bd2 = 1e9; for (const i of b.cells) { const q = cells[i].p.distanceToSquared(b.c); if (q < bd2) { bd2 = q; bi = i; } }
        const d2 = cells[bi].p.clone().sub(C).normalize(), h2 = F.cast(d2.x, d2.y, d2.z); sp = h2 ? F.surf(h2.tri, h2.b1, h2.b2) : null; if (!sp) { miss++; continue; } }
      sp.ph = Math.atan2(sp.p.x - C.x, sp.p.z - C.z); sp.dens = dens0(sp.p, sp.ph); sp.box = boxes.length;
      roots.push(sp); boxes.push({ row: b.row, side: b.side, col: b.col, area: b.area, cells: b.cells.map(i => cells[i]), sp });
    }
    // shuffle the order (the rope stream draws per rope: a spatial order would correlate the ropes' randoms with their place)
    for (let k = roots.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [roots[k], roots[j]] = [roots[j], roots[k]]; [boxes[k], boxes[j]] = [boxes[j], boxes[k]]; }
    roots.forEach((sp, k) => { sp.box = k; });
    return { roots, boxes, W, A, rows, merged, miss, cellMm: Math.sqrt(area / N) * 1000 };
  };
}
// the gather cards of one box: the box's outline seen from its root (the farthest box cell in each of `bins` directions round the root
// on the skin, plus half a cell), pulled in by half the parting's width, cut at K directions; one card per edge of that polygon, from the
// edge's middle to the root (a fan: the cards together cover the box inside its partings), lying on the skin and rising into the rope's
// start; returns [{ pts, w0, w1 }]
export function gather7(F, box, r, cellMm = 0.94) {
  const R = REV7.box, C = F.C, sp = box.sp, n = sp.n.clone().normalize(), t1 = (Math.abs(n.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).cross(n).normalize(), t2 = n.clone().cross(t1);
  const NB = 72, rho = new Float64Array(NB).fill(-1), half = cellMm / 2000, gut = R.gutter / 200;
  for (const c of box.cells) { const d = c.p.clone().sub(sp.p), x = d.dot(t1), y = d.dot(t2), l = Math.hypot(x, y); if (l < 1e-5) continue;
    const b = Math.min(NB - 1, Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * NB)); if (l > rho[b]) rho[b] = l; }
  if (!rho.some(x => x > 0)) return [];
  for (let b = 0; b < NB; b++) if (rho[b] < 0) { let k = 1; while (k < NB && rho[(b + k) % NB] < 0 && rho[(b - k + NB) % NB] < 0) k++; rho[b] = Math.max(rho[(b + k) % NB], rho[(b - k + NB) % NB]); }
  const onSkin = (q, off) => { const d = q.clone().sub(C), l = d.length() || 1; d.multiplyScalar(1 / l); const rr0 = F.rAt(d.x, d.y, d.z); return rr0 > 0 ? C.clone().addScaledVector(d, rr0 + off) : q; };
  const K = R.K, Vk = [];
  for (let k = 0; k < K; k++) { const a = -Math.PI + ((k + 0.5) / K) * 2 * Math.PI, b = Math.min(NB - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * NB));
    const reach = Math.max(0, Math.max(rho[b], rho[(b + 1) % NB], rho[(b + NB - 1) % NB]) + half - gut); Vk.push(sp.p.clone().addScaledVector(t1, Math.cos(a) * reach).addScaledVector(t2, Math.sin(a) * reach)); }
  const out = [];
  for (let k = 0; k < K; k++) { const A = Vk[k], B = Vk[(k + 1) % K], start = A.clone().add(B).multiplyScalar(0.5), w0 = A.distanceTo(B) * R.wK;
    if (start.distanceTo(sp.p) < 0.0015 || w0 < 0.0005) continue;
    const m = 4, pts = []; for (let j = 0; j < m; j++) { const t = j / (m - 1), q = start.clone().lerp(sp.p, t); pts.push(onSkin(q, R.off0 / 100 + (r * 0.6 - R.off0 / 100) * t * t)); }
    out.push({ pts, w0: Math.min(0.012, w0), w1: Math.max(0.0015, (2 * Math.PI * r) / K) }); }
  return out;
}
// the plait's relief for the engine's tube (B.tube rTh): three strands of radius rho on the plait's paths (lateral ax sin u, depth az sin 2u,
// u = 2 pi s / P + 2 pi i / 3; P = three V's), the tube's surface at angle th the outermost strand there (a groove where the ray passes
// between strands), normalised to a mean of 1 so the tube's mean radius is the rope's; lam = the length of TWO V's (the 'net' tile's height)
export function plait7r(lam, ph = 0) {
  const { ax, az, rho, relief } = REV7.box.plait, P = 1.5 * lam;
  const raw = (th, s) => { const ex = Math.cos(th), ey = Math.sin(th); let best = -1e9;
    for (let i = 0; i < 3; i++) { const u = (2 * Math.PI * s) / P + (2 * Math.PI * i) / 3 + ph, cx = ax * Math.sin(u), cy = az * Math.sin(2 * u), pr = cx * ex + cy * ey, pp = cx * cx + cy * cy - pr * pr;
      best = Math.max(best, pp < rho * rho ? pr + Math.sqrt(rho * rho - pp) : pr); }
    return best; };
  let m = 0, cnt = 0; for (let a = 0; a < 24; a++) for (let b = 0; b < 24; b++) { m += raw((a / 24) * 2 * Math.PI, (b / 24) * P); cnt++; } m /= cnt;
  return (th, t, s) => 1 + relief * (raw(th, s) / m - 1);
}

// ---------------------------------------------------------------- the follicle field for Cycles (c3 iteration 2; every groom since c7 it 1)
// What the Cycles portraits showed beside the photographs (the critic's it5 rank 1, all four women): the hair-skin interface reads as a
// lace-front wig: L08's part a ruler-straight pale stripe with sparse dark cards beside it over a painted brown 'lace' of scalp, the hairline
// a hard scalloped edge, L12 the same. The cause in the strand model: person_hair.py roots EVERY fibre of a card on the card's root edge (a
// 2-8 mm segment), so the head's ~100 k fibres leave the skin from ~2-5 k short ROWS, evenly spread across each card and lying flat in it;
// between the rows, near the part and the hairline where no card from further up lies over them, the painted root base shows. On a real
// scalp the follicles are spread over the whole area (of the order of 150-250 hairs / cm2, in follicular units of 1-4 hairs: the phototrichogram literature), a clump of hair
// gathers the fibres of the follicles UNDER it (the area it lies on as it leaves the scalp), each fibre leaves the skin at its follicle's
// angle (an acute 15-60 degrees: the follicle is oblique in the dermis) and only then joins the clump; at the frontal hairline the terminal
// hairs give way over ~1 cm to finer, shorter, paler intermediate hairs (the hairline's transition zone, as hair-restoration surgeons describe it); a part
// is where the hair DIVERGES (follicles on its line, their hair lying to one side or the other, a few crossing), not a strip without roots.
// The engine's field already knows all of this (the hairline's knots, the jagged part, the scalp's radius); person_hair.py does not. fol7
// hands it over in the scalp material's export marker (bind frame, three's axes; person_hair.py maps the posed cards back to it with
// the export's head matrix): { C, eyeY, kn (the hairline's 12 knots: azimuth, height above the eyes, slope), soft, part ({ m, hw, jag,
// ry, rz } or null), N, R (the scalp's radius about C on an N x N cube map, 0.05 mm units) }. No per-person value: the field is the head's.
export function fol7(F, dens, part, o = {}) {
  if (!dens?.knots) return null;
  const N = 48, R = new Array(6 * N * N), d = [0, 0, 0];
  for (let f = 0; f < 6; f++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { faceDir(f, (i + 0.5) / N * 2 - 1, (j + 0.5) / N * 2 - 1, d); const r = F.rAt(d[0], d[1], d[2]); R[(f * N + j) * N + i] = r > 0 ? Math.round(r * 20000) : 0; }
  const r6 = x => +x.toFixed(6);
  return { v: 1, C: F.C.toArray().map(r6), eyeY: r6(F.eyeY), kn: dens.knots.map(k => k.map(r6)), soft: r6(dens.soft ?? 0.004),
    part: part?.jagP ? { m: [r6(part.m.x), r6(part.m.z)], hw: r6(part.hw), jag: part.jagP.map(r6), ry: r6(F.ry), rz: r6(F.rz) } : null, N, R };
}

// ---------------------------------------------------------------- the material: dark and grey hair's sheen, grey strands not white flecks
// (uniforms only: rev 7's hair program is rev 6's)
export function shade7(mel, grey, form, base = {}) {
  const S = REV7.shade, dark = sstep(S.eu[0], S.eu[1], mel.eu ?? 0), g = sstep(S.grey[0], S.grey[1], grey ?? 0);
  const kR = (1 - S.darkR * dark) * (1 - S.greyR * g), kE = (1 - S.darkE * dark) * (1 - S.greyE * g), h4G = base.h4G || [0.3, 1.6, 0.8, 0.85];
  return { specR6: (base.specR6 ?? 1.0) * kR, h6egain: (base.h6egain ?? 1.0) * kE, h4G: [h4G[0] + S.greyCut * g, h4G[1], h4G[2], h4G[3] * (1 - S.greyAlb * g)] };
}
