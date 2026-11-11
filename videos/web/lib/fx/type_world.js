// TYPE WORLD (TYPE studio, cycle 1): words made by the world's own process, struck on a hit, sized by role.
// The kit caption (kit.cue / headline / line) is one lower-third subtitle track re-skinned per piece; this module is
// its replacement for pieces. Three layers:
//
//   1. layout   setBlock(): the role ladder (plant / shout / slam / payoff) sets the cap height, never the letter
//               count. A line that is too wide breaks onto two lines in the same frame (one phrase only), and a
//               payoff can justify each line to the full safe width (wood-type poster style). SAFE is the band
//               that Reels / TikTok UI leaves clear (y 270-1250, x 60-960: the right rail is buttons).
//   2. timing   chantAt() (a chant word shows 4-8 frames on its hit, then clears), planLoad() (text-on-screen
//               share and frames per 30 s of a cue table, slams counted apart: a readout), typeAudit (what each frame
//               set, with any block under the platform UI band or cropped by the frame edge; scenes expose it as
//               window.typeInfo). How the type reads is judged on the rendered frames, not by its sizes.
//   fit        fitXform() clamps a block's slam / entry scale, rotation box and stretch to the frame (or the band)
//              with a keyline pad and settles frame 0; blockPath() / applyXform() draw under the same transform;
//              typeAudit records each block's frame crop (TOOLING R1; tools/type_edges.mjs sweeps a scene for it).
//   3. recipes  one per world, each an event on a hit, not a hold:
//               engraved (burin cut + ruled white-face fill), rubber (inked office stamp), riso (two drums off
//               register, multiply overprint), highway (retroreflective sign face, VMS dot matrix, gantry),
//               stamped (letter punches into steel, burr, red paint wipe), letterpress (platen on the kick, wood
//               grain, split fountain), skylight (hundreds of lights assemble the word from the city).
//
// Every recipe bakes its sprites once per block (WeakMap) and draws with drawImage, so a frame costs a few ms.
// Deterministic in (block, age): safe for stills, --from renders and motion blur resampling.
import { W, H, clamp, lerp, ease, rng } from '../kit.js';
import { shape, canvas2d, innerShadow } from './type.js';

// ================================================================ layout
export const SAFE = { x1: 60, x2: 960, y1: 270, y2: 1250, cx: 510, cy: 760 };
// cap heights in px at 1080x1920: the sizing defaults setBlock() and fitBlock() start from (a default, not a test)
export const LADDER = {
  plant: { cap: 170, min: 150, max: 190 },
  shout: { cap: 260, min: 220, max: 320 },
  slam: { cap: 380, min: 220, max: 600 },      // 300-600 for a word of <= 5 letters; a longer chant word takes what the width gives (>= 220)
  payoff: { cap: 300, min: 272, max: 560, k: 1.6, minW: 0.7 },
  micro: { cap: 30, min: 0, max: 40 },          // in-world text that must stay sub-legible at feed size
};
const capOf = f => ((f.tables.os2 && f.tables.os2.sCapHeight) || f.unitsPerEm * 0.7) / f.unitsPerEm;
// width in px of text in font at a cap height (per-char advances + kerning, like shape())
export function measure(font, text, cap, tracking = 0) {
  const size = cap / capOf(font), gl = [...text].map(c => font.charToGlyph(c)); let w = 0;
  gl.forEach((g, i) => { w += g.advanceWidth || 0; if (i < gl.length - 1) w += font.getKerningValue(g, gl[i + 1]) + tracking * font.unitsPerEm; });
  return w * size / font.unitsPerEm;
}
// compress a shaped Word horizontally about ax (sx < 1: the condensed series of the same alphabet, e.g. FHWA C/D from E)
function condense(word, sx, ax) {
  if (sx === 1) return word;
  const M = new DOMMatrix().scaleSelf(sx, 1);
  for (const g of word.glyphs) {
    g.ox = ax + (g.ox - ax) * sx;
    const p = new Path2D(); p.addPath(g.path, M); g.path = p;
    for (const k of ['x1', 'x2']) g.bb[k] *= sx; g.bb.w *= sx;
    for (const c of g.contours) for (let i = 0; i < c.pts.length; i += 2) c.pts[i] *= sx;
    const ring = new Path2D(); ring.rect(g.bb.x1 - 80, g.bb.y1 - 80, g.bb.w + 160, g.bb.h + 160); ring.addPath(p); g.ring = ring;
    g.cmds = null;
  }
  word.bbox.x1 = ax + (word.bbox.x1 - ax) * sx; word.bbox.x2 = ax + (word.bbox.x2 - ax) * sx; word.width *= sx;
  return word;
}
// setBlock(font, text | lines, o) -> Block (a Word-like object: glyphs[] with line index, bbox, caps[], cap, role)
//   text    one phrase; auto-breaks onto two lines when it will not fit maxW at the role cap
//   lines   [string | { text, font, cap, sx, tracking, fill }] explicit lines (mixed faces allowed)
//   o.role  plant | shout | slam | payoff | micro  (default plant)   o.cap overrides the role cap
//   o.x / o.y  anchor (default SAFE.cx / SAFE.cy); o.align left|center|right; o.maxW (default the safe width)
//   o.justify  every line is scaled to fill maxW (capped at the role max): the poster lockup
//   o.sx    horizontal compression for every line; o.gap line gap in cap units (default 0.2)
// Nothing ever shrinks silently: a line that still does not fit is scaled and the block is flagged shrunk.
export function setBlock(font, text, o = {}) {
  const role = o.role || 'plant', R = LADDER[role] || LADDER.plant;
  const maxW = o.maxW ?? (SAFE.x2 - SAFE.x1), align = o.align || 'center';
  const ax = o.x ?? (align === 'left' ? SAFE.x1 : align === 'right' ? SAFE.x2 : SAFE.cx), cy = o.y ?? SAFE.cy;
  const base = o.cap ?? R.cap, trk = o.tracking ?? 0;
  let specs = Array.isArray(text) ? text.map(l => typeof l === 'string' ? { text: l } : { ...l }) : [{ text }];
  if (!Array.isArray(text) && measure(font, text, base, trk) * (o.sx ?? 1) > maxW && text.includes(' ')) {
    const ws = text.split(' '); let best = null;
    for (let i = 1; i < ws.length; i++) {
      const a = ws.slice(0, i).join(' '), b = ws.slice(i).join(' '), m = Math.max(measure(font, a, base, trk), measure(font, b, base, trk));
      if (!best || m < best[0]) best = [m, a, b];
    }
    specs = [{ text: best[1] }, { text: best[2] }];
  }
  let shrunk = false;
  for (const s of specs) {
    s.font = s.font || font; s.sx = s.sx ?? o.sx ?? 1; s.tracking = s.tracking ?? trk;
    let cap = s.cap ?? base; const w = measure(s.font, s.text, cap, s.tracking) * s.sx;
    if (s.fill ?? o.justify) cap = Math.min(s.max ?? R.max, cap * maxW / w);
    else if (w > maxW) { cap *= maxW / w; if (cap < R.min) shrunk = true; }
    s.cap = cap;
  }
  const gap = o.gap ?? 0.2;
  const gaps = specs.slice(1).map((s, i) => gap * Math.min(s.cap, specs[i].cap));
  const total = specs.reduce((a, s) => a + s.cap, 0) + gaps.reduce((a, b) => a + b, 0);
  let base0 = cy - total / 2, glyphs = [], k = 0;
  const lines = specs.map((s, li) => {
    base0 += s.cap;
    const wd = shape(s.font, s.text, { capH: s.cap, x: ax, y: base0, align, valign: 'baseline', tracking: s.tracking });
    condense(wd, s.sx, align === 'center' ? ax : align === 'left' ? ax : ax);
    for (const g of wd.glyphs) glyphs.push({ ...g, i: k++, line: li, cap: s.cap });
    base0 += gaps[li] || 0;
    wd.cap = s.cap; return wd;
  });
  const bbox = { x1: Math.min(...lines.map(l => l.bbox.x1)), x2: Math.max(...lines.map(l => l.bbox.x2)),
    y1: Math.min(...lines.map(l => l.bbox.y1)), y2: Math.max(...lines.map(l => l.bbox.y2)) };
  const caps = specs.map(s => s.cap);
  return { font, text: specs.map(s => s.text).join(' '), role, lines, glyphs, bbox, caps, cap: Math.max(...caps), n: glyphs.length,
    size: Math.max(...lines.map(l => l.size)), shrunk, len: glyphs.reduce((a, g) => a + g.len, 0) };
}
// setFit(faces, text, o): the no-shrink rule as a search. Tries one line, then a balanced two-line and three-line
// break of the one phrase, in each face in order (a wide display face first, its condensed partner after), and takes
// the first layout whose lines all reach the role floor at one shared cap (<= the role cap). Nothing fits: the last
// try is set and flagged shrunk. o as setBlock (role, x, y, align, maxW, sx, gap).
export function setFit(faces, text, o = {}) {
  const R = LADDER[o.role || 'plant'] || LADDER.plant, maxW = o.maxW ?? (SAFE.x2 - SAFE.x1), sx = o.sx ?? 1;
  faces = Array.isArray(faces) ? faces : [faces];
  const ws = text.split(' '), tries = [[text]];
  const best = (n) => { let b = null; const rec = (i, acc) => { if (acc.length === n - 1) { const ls = [...acc, ws.slice(i).join(' ')]; if (ls.every(Boolean)) { const m = Math.max(...ls.map(l => l.length)); if (!b || m < b[0]) b = [m, ls]; } return; }
    for (let j = i + 1; j < ws.length; j++) rec(j, [...acc, ws.slice(i, j).join(' ')]); }; rec(0, []); return b && b[1]; };
  for (const n of [2, 3]) if (ws.length >= n) tries.push(best(n));
  let last = null;
  for (const lines of tries) for (const f of faces) {
    const cap = Math.min(o.cap ?? R.cap, ...lines.map(l => maxW / (measure(f, l, 1, o.tracking || 0) * sx)));
    last = [f, lines, cap];
    if (cap >= R.min) return setBlock(f, lines.map(t => ({ text: t, cap })), o);
  }
  const b = setBlock(last[0], last[1].map(t => ({ text: t, cap: last[2] })), o); b.shrunk = true; return b;
}
// translate a block in place-free style: returns a shallow copy moved by dx, dy (sprites are keyed per block, so
// move with the ctx transform instead when a recipe has baked it)
export const blockCentre = b => [(b.bbox.x1 + b.bbox.x2) / 2, (b.bbox.y1 + b.bbox.y2) / 2];

// ================================================================ frame fit (TOOLING R1)
// A block's on-screen transform: xf = { s, sx, sy, rot, dx, dy, pivot }. M = translate(pivot + d) . rotate(rot) .
// scale(s*sx, s*sy) . translate(-pivot); pivot defaults to the block centre. s is the slam / entry scale, sx / sy a
// stretch (a 4x-tall wood-type word), rot radians, dx / dy px. Same convention as typeAudit.add().
export function xfMatrix(block, xf = {}) {
  const [px, py] = xf.pivot || blockCentre(block), s = xf.s ?? 1;
  return new DOMMatrix().translate(px + (xf.dx ?? 0), py + (xf.dy ?? 0)).rotate((xf.rot ?? 0) * 180 / Math.PI)
    .scale(s * (xf.sx ?? 1), s * (xf.sy ?? 1)).translate(-px, -py);
}
// the transformed bbox corners' extent -> { x1, x2, y1, y2 }
export function xfBBox(block, xf = {}) {
  const M = xfMatrix(block, xf), b = block.bbox;
  const pts = [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]].map(([x, y]) => M.transformPoint({ x, y }));
  return { x1: Math.min(...pts.map(p => p.x)), x2: Math.max(...pts.map(p => p.x)), y1: Math.min(...pts.map(p => p.y)), y2: Math.max(...pts.map(p => p.y)) };
}
// every glyph of the block as one Path2D under xf (fill / stroke / clip it; a keyline is a stroke of this path)
export function blockPath(block, xf = {}) {
  const M = xfMatrix(block, xf), p = new Path2D();
  for (const g of block.glyphs) p.addPath(g.path, M.translate(g.ox ?? 0, g.oy ?? 0));
  return p;
}
// set ctx to xf, for recipes that draw the block themselves (engraved, stamped, letterpress sprites): ctx.save();
// applyXform(ctx, block, xf); recipe.draw(ctx, block, age); ctx.restore()
export const applyXform = (ctx, block, xf = {}) => { const M = xfMatrix(block, xf); ctx.transform(M.a, M.b, M.c, M.d, M.e, M.f); };
const BOUNDS = { frame: () => ({ x1: 0, x2: W, y1: 0, y2: H }), safe: () => ({ ...SAFE }) };
// fitXform(block, xf, o) -> xf clamped so the transformed block, plus o.pad px (the keyline, fringe, burr or shadow
// it carries), stays inside o.bounds. The scale comes down first (never the rotation, never the stretch ratio),
// then the block slides in. Nothing crops, whatever the slam, the entry overshoot or the stretch asks for.
//   o.bounds  'frame' (default: the 1080x1920 edge) | 'safe' (the Reels band) | { x1, x2, y1, y2 }
//   o.pad     px kept clear inside the bounds (default 28; add the keyline width + fringe reach)
//   o.settle  true on the thumbnail / frame-0 draw: the entry scale and rotation are dropped (s 1, rot 0; the
//             stretch and offset stay) so frame 0 shows the settled block. Pass `settle: t < 0.5 / fps` or `age <= 0`.
//   o.axis    'xy' (default) | 'x' | 'y': which axes are clamped (a word that bleeds off the top on purpose: 'x')
// Returns { ...xf, s, dx, dy, bbox, clamped: { scale, shift } }. Cheap (a DOMMatrix and four points): call per frame.
export function fitXform(block, xf = {}, o = {}) {
  const B = typeof o.bounds === 'object' ? o.bounds : BOUNDS[o.bounds || 'frame'](), pad = o.pad ?? 28, axis = o.axis || 'xy';
  const out = { ...xf, s: xf.s ?? 1, rot: xf.rot ?? 0, dx: xf.dx ?? 0, dy: xf.dy ?? 0 };
  if (o.settle) { out.s = 1; out.rot = 0; }
  const clamped = { scale: false, shift: false };
  const bw = block.bbox.x2 - block.bbox.x1, bh = block.bbox.y2 - block.bbox.y1, sx = out.sx ?? 1, sy = out.sy ?? 1;
  const c = Math.abs(Math.cos(out.rot)), sn = Math.abs(Math.sin(out.rot));
  const ew = c * bw * sx + sn * bh * sy, eh = sn * bw * sx + c * bh * sy;          // extent at s = 1
  const aw = B.x2 - B.x1 - 2 * pad, ah = B.y2 - B.y1 - 2 * pad;
  const sMax = Math.min(axis.includes('x') ? aw / ew : Infinity, axis.includes('y') ? ah / eh : Infinity);
  if (out.s > sMax) { out.s = Math.max(0, sMax); clamped.scale = true; }
  const bb = xfBBox(block, out);
  const slide = (lo, hi, a, b) => (a < lo ? lo - a : b > hi ? hi - b : 0);
  const mx = axis.includes('x') ? slide(B.x1 + pad, B.x2 - pad, bb.x1, bb.x2) : 0;
  const my = axis.includes('y') ? slide(B.y1 + pad, B.y2 - pad, bb.y1, bb.y2) : 0;
  if (Math.abs(mx) > 0.01 || Math.abs(my) > 0.01) { out.dx += mx; out.dy += my; clamped.shift = true; }
  out.bbox = { x1: bb.x1 + mx, x2: bb.x2 + mx, y1: bb.y1 + my, y2: bb.y2 + my };
  out.clamped = clamped;
  return out;
}
// frameCrop(bbox) -> px of the box beyond each frame edge { l, r, t, b, max } (0 when inside)
export function frameCrop(bb) {
  const r = { l: Math.max(0, -bb.x1), r: Math.max(0, bb.x2 - W), t: Math.max(0, -bb.y1), b: Math.max(0, bb.y2 - H) };
  r.max = Math.max(r.l, r.r, r.t, r.b); return r;
}

// ================================================================ timing + audit
// chantAt(hits, t, o): the chant slam live at t. hits: sorted times (s). A word shows `frames` frames from its hit
// (lead s early so it is legible on the hit), then clears. -> { i, h, age, on, u (0..1 through the slam) } | null
export function chantAt(hits, t, { frames = 6, fps = 30, lead = 0.033 } = {}) {
  let i = -1; for (let k = 0; k < hits.length; k++) if (hits[k] - lead <= t + 1e-6) i = k; else break;
  if (i < 0) return null;
  const age = t - hits[i], dur = frames / fps;
  return { i, h: hits[i], age, on: age >= -lead && age < dur, u: clamp((age + lead) / (dur + lead)) };
}
// planLoad(cues, spb, dur, o): planned text load of a cue table [{s, e, text, slam?}] in beats.
// A cue shorter than o.slam seconds (or flagged slam) is a chant slam: counted in the share, not as a text frame.
export function planLoad(cues, spb, dur, { slam = 0.5 } = {}) {
  let on = 0, held = 0, slams = 0;
  for (const c of cues) if (c.text) { const d = (c.e - c.s) * spb; on += d; if (c.slam || d < slam) slams++; else held++; }
  return { share: on / dur, held, slams, per30: held * 30 / dur, slamsPer30: slams * 30 / dur };
}
// typeAudit: every frame, a scene resets it and adds each block it draws legibly (read >= 0.6). window.typeInfo()
// returns the list; tools/type_reel.mjs reads it. Issues are placement facts only: a block under the platform UI (out
// of the SAFE band) or cropped by the frame edge.
export const typeAudit = {
  items: [], plantCap: LADDER.plant.cap,
  reset() { this.items = []; },
  add(block, { role = block.role, read = 1, dx = 0, dy = 0, s = 1, sx = 1, sy = 1, rot = 0, pivot = null, bleed = false, world = '', ctx = null } = {}) {
    const [cx, cy] = pivot || blockCentre(block), c = Math.cos(rot), sn = Math.sin(rot), b0 = block.bbox;
    const pts = [[b0.x1, b0.y1], [b0.x2, b0.y1], [b0.x2, b0.y2], [b0.x1, b0.y2]].map(([x, y]) => { const u = (x - cx) * s * sx, v = (y - cy) * s * sy; return [cx + u * c - v * sn + dx, cy + u * sn + v * c + dy]; });
    const bb = { x1: Math.min(...pts.map(p => p[0])), x2: Math.max(...pts.map(p => p[0])), y1: Math.min(...pts.map(p => p[1])), y2: Math.max(...pts.map(p => p[1])) };
    const caps = block.caps.map(c => c * s * sy), issues = [], crop = frameCrop(bb);
    if (read >= 0.6) {
      if (!bleed && (bb.x1 < SAFE.x1 - 2 || bb.x2 > SAFE.x2 + 2)) issues.push(`x ${bb.x1.toFixed(0)}-${bb.x2.toFixed(0)} outside ${SAFE.x1}-${SAFE.x2}`);
      if (bb.y1 < SAFE.y1 - 2 || bb.y2 > SAFE.y2 + 2) issues.push(`y ${bb.y1.toFixed(0)}-${bb.y2.toFixed(0)} outside ${SAFE.y1}-${SAFE.y2}`);
      if (!bleed && crop.max > 1) issues.push(`cropped by the frame edge (${['l', 'r', 't', 'b'].filter(k => crop[k] > 1).map(k => `${k} ${crop[k].toFixed(0)}px`).join(', ')}): fitXform()`);
    }
    this.items.push({ text: block.text, role, world, read: +read.toFixed(2), caps: caps.map(c => Math.round(c)), bbox: Object.fromEntries(Object.entries(bb).map(([k, v]) => [k, Math.round(v)])), crop: Math.round(crop.max), issues });
  },
};

// cheapEffects(ctx, block, o) (TYPE c2): read the RENDERED canvas round a block's glyphs and flag the retired cheap
// effects, whatever drew them (a recipe, a post pass, a look): o.dx/dy offset the block as drawn.
//   outline/halo  the ring 1.5-3 px outside the glyph edge differs from the 8-12 px reference ring by dE > 8 (Lab) on
//                 more than 40% of its pixels (a keyline, a paper halo, an offset contour)
//   glow          the difference from the reference falls monotonically across 1.5-20 px and still exceeds dE 5 at 6-10 px
//                 (it spreads: a keyline does not) on more than 60% of 12 sectors (against a 20-28 px reference ring)
//   shadow        the inner ring is one-sided: the down-right half differs from the up-left half by dE > 10
// -> { flags: [], ring: { dE, share }, glowSectors, sideDE }. Costs one getImageData of the block box: audit frames only.
export function cheapEffects(ctx, block, { dx = 0, dy = 0 } = {}) {
  const pad = 34, b = block.bbox, x0 = Math.max(0, Math.floor(b.x1 + dx - pad)), y0 = Math.max(0, Math.floor(b.y1 + dy - pad));
  const w = Math.min(ctx.canvas.width - x0, Math.ceil(b.x2 - b.x1 + 2 * pad)), h = Math.min(ctx.canvas.height - y0, Math.ceil(b.y2 - b.y1 + 2 * pad));
  if (w <= 0 || h <= 0) return { flags: [] };
  const img = ctx.getImageData(x0, y0, w, h).data;
  // dilation bands by stroking the glyphs: band(r) = glyph grown by r px
  const band = r => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
    g.translate(-x0 + dx, -y0 + dy); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineJoin = 'round'; g.lineWidth = 2 * r;
    for (const G of block.glyphs) { g.save(); g.translate(G.ox, G.oy); g.fill(G.path); if (r > 0) g.stroke(G.path); g.restore(); }
    const d = g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) m[i] = d[i * 4 + 3] > 127; return m; };
  const R = [0, 1.5, 3, 6, 8, 10, 12, 15, 20, 28].map(r => [r, band(r)]), B = Object.fromEntries(R);
  const lab = i => { const f = v => { v /= 255; v = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); return v; };
    const r = f(img[i * 4]), g = f(img[i * 4 + 1]), bb = f(img[i * 4 + 2]);
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * bb) / 0.9505, Y = 0.2126 * r + 0.7152 * g + 0.0722 * bb, Z = (0.0193 * r + 0.1192 * g + 0.9505 * bb) / 1.089;
    const q = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; return [116 * q(Y) - 16, 500 * (q(X) - q(Y)), 200 * (q(Y) - q(Z))]; };
  const ringPx = (a, c) => { const out = []; for (let i = 0; i < w * h; i++) if (B[c][i] && !B[a][i]) out.push(i); return out; };
  const inner = ringPx(1.5, 3), ref = ringPx(8, 12);
  if (!inner.length || !ref.length) return { flags: [] };
  const mean = px => { const s = [0, 0, 0]; for (const i of px) { const L = lab(i); s[0] += L[0]; s[1] += L[1]; s[2] += L[2]; } return s.map(v => v / px.length); };
  const dE = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]), mr = mean(ref);
  let over = 0, sum = 0; for (const i of inner) { const e = dE(lab(i), mr); sum += e; if (e > 8) over++; }
  const share = over / inner.length, flags = [];
  if (share > 0.4) flags.push(`outline/halo >3px (dE ${(sum / inner.length).toFixed(0)} on ${(share * 100).toFixed(0)}% of the ring)`);
  // glow: per sector, the luminance of successive bands 3..20 px falls monotonically and by > 6 L
  const mFar = mean(ringPx(20, 28));
  const cx = (b.x1 + b.x2) / 2 + dx - x0, cy = (b.y1 + b.y2) / 2 + dy - y0, NS = 12, bands = [[1.5, 3], [3, 6], [6, 10], [10, 15], [15, 20]];
  const sect = Array.from({ length: NS }, () => bands.map(() => [0, 0]));
  bands.forEach(([a, c], k) => { for (const i of ringPx(a, c)) { const x = i % w, y = (i / w) | 0, s2 = Math.floor(((Math.atan2(y - cy, x - cx) + Math.PI) / (2 * Math.PI)) * NS) % NS; const e = dE(lab(i), mFar); sect[s2][k][0] += e; sect[s2][k][1]++; } });
  let glowS = 0, used = 0;
  for (const S of sect) { const v = S.map(([a, n]) => n ? a / n : null); if (v.some(x => x === null)) continue; used++; let mono = true; for (let k = 1; k < v.length; k++) if (v[k] > v[k - 1] + 0.5) mono = false; if (mono && v[2] > 5 && v[0] - v[v.length - 1] > 5) glowS++; }
  if (used && glowS / used > 0.6) flags.push(`glow (${glowS}/${used} sectors fall off monotonically)`);
  // shadow: one-sided inner ring
  const dr = [], ul = []; for (const i of inner) { const x = i % w, y = (i / w) | 0; ((x - cx) + (y - cy) > 0 ? dr : ul).push(i); }
  const side = dr.length && ul.length ? dE(mean(dr), mean(ul)) : 0;
  if (side > 10 && share > 0.2) flags.push(`shadow (one-sided ring, dE ${side.toFixed(0)})`);
  return { flags, ring: { dE: +(sum / inner.length).toFixed(1), share: +share.toFixed(2) }, glowSectors: [glowS, used], sideDE: +side.toFixed(1) };
}

// ================================================================ shared textures
// Alpha-noise tiles for ink voids (riso speckle, rubber stamp starvation, letterpress salt). Cached per key.
const tiles = new Map();
function voidTile(seed = 1, { n = 2600, r0 = 0.5, r1 = 2.2, a0 = 0.2, a1 = 0.9, blobs = 18, size = 256 } = {}) {
  const key = [seed, n, r0, r1, a0, a1, blobs, size].join(); if (tiles.has(key)) return tiles.get(key);
  const L = canvas2d(size, size), g = L.g, r = rng(seed);
  for (let k = 0; k < blobs; k++) {      // soft low-frequency mottle (the drum/roller did not lay ink evenly)
    const x = r() * size, y = r() * size, R = 20 + r() * 50, gr = g.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, `rgba(0,0,0,${0.10 + r() * 0.16})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) { g.save(); g.translate(ox, oy); g.fillStyle = gr; g.fillRect(x - R, y - R, 2 * R, 2 * R); g.restore(); }
  }
  for (let k = 0; k < n; k++) { g.fillStyle = `rgba(0,0,0,${lerp(a0, a1, r())})`; g.beginPath();
    g.ellipse(r() * size, r() * size, lerp(r0, r1, r() * r()), lerp(r0, r1, r() * r()) * 0.7, r() * 3, 0, 7); g.fill(); }
  g.getImageData(0, 0, 1, 1); tiles.set(key, L.cv); return L.cv;
}
function eat(g, tile, w, h, alpha = 1, off = [0, 0]) {    // destination-out a tile over (0,0,w,h)
  g.save(); g.globalCompositeOperation = 'destination-out'; g.globalAlpha = alpha; g.translate(off[0], off[1]);
  g.fillStyle = g.createPattern(tile, 'repeat'); g.fillRect(-off[0], -off[1], w, h); g.restore();
}
// bake(block, pad, draw) -> { cv, x, y, w, h }: a sprite covering block.bbox + pad, drawn in frame coordinates
function bakeBlock(block, pad, draw, res = 1) {
  const x = Math.floor(block.bbox.x1 - pad), y = Math.floor(block.bbox.y1 - pad);
  const w = Math.ceil(block.bbox.x2 + pad) - x, h = Math.ceil(block.bbox.y2 + pad) - y;
  const L = canvas2d(Math.ceil(w * res), Math.ceil(h * res)); L.g.scale(res, res); L.g.translate(-x, -y); draw(L.g, w, h, x, y);
  L.g.getImageData(0, 0, 1, 1);
  return { cv: L.cv, x, y, w, h };
}
const eachGlyph = (g, block, fn) => { for (const G of block.glyphs) { g.save(); g.translate(G.ox, G.oy); fn(G); g.restore(); } };
const blit = (ctx, S, alpha = 1) => { if (alpha <= 0) return; ctx.save(); ctx.globalAlpha *= alpha; ctx.drawImage(S.cv, S.x, S.y, S.w, S.h); ctx.restore(); };
const memo = () => { const m = new WeakMap(); return (block, key, make) => { let e = m.get(block); if (!e) m.set(block, e = {}); return e[key] || (e[key] = make()); }; };

// ================================================================ engraved: the burin cuts the letter, the ruled fill lands on the hit
// White-face banknote lettering: an engraved outline and horizontal rulings inside the letter that swell toward
// the shadow side, with a clear breathing margin burnished out of the plate around the word (no cartouche box).
// draw(ctx, block, age): age = s since the hit. From -cut the contours are cut (on twos, burin tips live),
// on the hit the rulings sweep down in 3 frames, then a raking light catches the cut edges.
export function engraved({ ink = '#0e0b0a', paper = '#efe6cf', margin = 18, cut = 0.34, fps = 15, pitch = 26, weight = null, sheen = 'rgba(255,250,236,0.95)' } = {}) {
  // weight [top, bottom]: ruling thickness as a fraction of the pitch (default lighter for small caps); [0.75, 1] is near-solid ink with white hairlines
  const M = memo();
  const bake = block => ({
    clear: M(block, 'clear', () => bakeBlock(block, margin + 4, g => eachGlyph(g, block, G => { g.lineJoin = 'round'; g.lineWidth = margin * 2; g.strokeStyle = paper; g.stroke(G.path); g.fillStyle = paper; g.fill(G.path); }))),
    letter: M(block, 'letter', () => bakeBlock(block, 6, g => eachGlyph(g, block, G => {
      const p = Math.max(3.2, G.cap / pitch), b = G.bb;
      g.save(); g.clip(G.path); g.strokeStyle = ink;
      for (let y = b.y1 + p * 0.5; y < b.y2 + p; y += p) { const u = clamp((y - b.y1) / b.h); g.lineWidth = p * (weight ? lerp(weight[0], weight[1], u * u) : lerp(G.cap > 240 ? 0.55 : 0.4, 0.92, u * u)); g.beginPath(); g.moveTo(b.x1 - 2, y); g.lineTo(b.x2 + 2, y); g.stroke(); }
      g.restore(); g.lineJoin = 'round'; g.lineWidth = Math.max(1.6, G.cap / 70); g.strokeStyle = ink; g.stroke(G.path);
    }))),
    outline: M(block, 'outline', () => bakeBlock(block, 6, g => eachGlyph(g, block, G => { g.lineJoin = 'round'; g.lineWidth = Math.max(1.6, G.cap / 70); g.strokeStyle = ink; g.stroke(G.path); }))),
    edge: M(block, 'edge', () => bakeBlock(block, 8, g => eachGlyph(g, block, G => {      // lit top-left lips of the cut
      const lw = Math.max(1.2, G.cap / 150); g.lineWidth = lw * 1.6; g.strokeStyle = sheen; g.stroke(G.path);
      g.save(); g.globalCompositeOperation = 'destination-out'; g.translate(lw * 1.4, lw * 1.4); g.lineWidth = lw * 2.4; g.stroke(G.path); g.restore();
    }))),
  });
  const R = {
    warm(block) { bake(block); return R; },
    draw(ctx, block, age, { light = 1, clearAlpha = 1 } = {}) {
      if (age < -cut) return;
      const S = bake(block), n = block.glyphs.length;
      let u = clamp((age + cut) / cut); if (fps) u = Math.floor(u * cut * fps + 1e-6) / (cut * fps);
      blit(ctx, S.clear, clamp(u * 3) * clearAlpha);
      if (age < 0) {        // the cut: every glyph's contours in parallel, staggered left to right, burin tip glinting
        ctx.save(); ctx.strokeStyle = ink; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        for (const G of block.glyphs) {
          const p = clamp((u - G.i / Math.max(1, n - 1) * 0.35) / 0.65); if (p <= 0) continue;
          ctx.save(); ctx.translate(G.ox, G.oy); ctx.lineWidth = Math.max(1.6, G.cap / 70);
          for (const cn of G.contours) {
            const L = cn.len * p, pts = cn.pts; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); let j = 1;
            for (; j < cn.cum.length && cn.cum[j] <= L; j++) ctx.lineTo(pts[2 * j], pts[2 * j + 1]);
            ctx.stroke();
            if (p < 1 && j < cn.cum.length) { const x = pts[2 * j - 2], y = pts[2 * j - 1];
              ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 7); ctx.fill();
              ctx.strokeStyle = 'rgba(40,30,25,0.8)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x + 5, y - 5, 5, 0.3, 4.2); ctx.stroke(); ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1.6, G.cap / 70); }
          }
          ctx.restore();
        }
        ctx.restore(); return;
      }
      blit(ctx, S.outline);
      const f = clamp(age / 0.1);            // rulings sweep top to bottom in 3 frames
      if (f >= 1) blit(ctx, S.letter);
      else { ctx.save(); ctx.beginPath(); ctx.rect(S.letter.x, S.letter.y, S.letter.w, S.letter.h * f); ctx.clip(); blit(ctx, S.letter); ctx.restore(); }
      blit(ctx, S.edge, light * (0.35 + 0.65 * Math.exp(-age * 4)));
    },
    readable: (block, age) => age >= 0 ? 1 : age >= -cut * 0.25 ? 0.7 : 0,
  };
  return R;
}

// ================================================================ rubber: an inked office stamp struck over the world
// Framed or bare, rotated, starved and pooled ink, multiply. Appears whole on the hit (a stamp is instant) with a
// 2-frame overpressure. A stamp is the one in-world object that may carry a rule frame: it is part of the tool.
export function rubber({ ink = '#c4161c', frame = true, rot = -0.1, seed = 7, starve = 0.55, mode = 'multiply' } = {}) {
  const M = memo();
  const bake = block => M(block, 'stamp', () => bakeBlock(block, 70, (g, w, h, x, y) => {
    g.fillStyle = ink; eachGlyph(g, block, G => g.fill(G.path));
    if (frame) { const b = block.bbox, p = block.cap * 0.22, lw = Math.max(5, block.cap * 0.05); g.strokeStyle = ink; g.lineWidth = lw;
      g.beginPath(); g.roundRect(b.x1 - p, b.y1 - p, b.x2 - b.x1 + 2 * p, b.y2 - b.y1 + 2 * p, p * 0.5); g.stroke();
      g.lineWidth = lw * 0.4; g.beginPath(); g.roundRect(b.x1 - p * 0.62, b.y1 - p * 0.62, b.x2 - b.x1 + 1.24 * p, b.y2 - b.y1 + 1.24 * p, p * 0.3); g.stroke(); }
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    eat(g, voidTile(seed, { n: 5200, r1: 3.4, a1: 1, blobs: 26 }), g.canvas.width, g.canvas.height, starve);
    const gr = g.createLinearGradient(0, 0, g.canvas.width, g.canvas.height * 0.4);     // the stamp rocked: one side lighter
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = gr; g.fillRect(0, 0, g.canvas.width, g.canvas.height); g.restore();
  }));
  const R = {
    warm(block) { bake(block); return R; },
    draw(ctx, block, age, { angle = rot, alpha = 1 } = {}) {
      if (age < 0) return;
      const S = bake(block), [cx, cy] = blockCentre(block), s = age < 0.067 ? 1.035 : 1;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle); ctx.scale(s, s); ctx.translate(-cx, -cy);
      ctx.globalCompositeOperation = mode; ctx.globalAlpha *= alpha; ctx.drawImage(S.cv, S.x, S.y, S.w, S.h); ctx.restore();
    },
    readable: (block, age) => age >= 0 ? 1 : 0,
  };
  return R;
}

// ================================================================ riso: two drums, two hits, off register
// plate(content, ink): content is a Block or a draw(g) function (bars, wedges, halftone images) in frame coords;
// the plate is that content in one riso ink with speckle voids, roller streaks and mottle. print() lays it on the
// stock with multiply (riso ink is translucent: black over red makes the third colour), offset by the drum's
// registration error. On the hit frame the sheet is still feeding: one smeared frame, then it sits.
export function riso({ seed = 3, speckle = 0.55, streak = 0.10 } = {}) {
  const M = memo(), cacheFn = new Map();
  const texture = (g, w, h, sd) => {
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    eat(g, voidTile(sd, { n: 3400, r0: 0.4, r1: 1.8, a0: 0.25, a1: 1, blobs: 30 }), w, h, speckle, [sd * 37 % 256, sd * 91 % 256]);
    g.globalCompositeOperation = 'destination-out';
    for (let y = 0; y < h; y += 3) { const a = streak * (0.5 + 0.5 * Math.sin(y * 0.021 + sd) * Math.sin(y * 0.0047 + sd * 2)); if (a > 0.01) { g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(0, y, w, 2); } }
    g.restore();
  };
  const R = {
    plate(content, ink, { seed: sd = seed, key = ink, only = null } = {}) {
      const make = () => {
        if (typeof content === 'function') { const L = canvas2d(W, H); L.g.fillStyle = ink; L.g.strokeStyle = ink; content(L.g); texture(L.g, W, H, sd); L.g.getImageData(0, 0, 1, 1); return { cv: L.cv, x: 0, y: 0, w: W, h: H }; }
        return bakeBlock(content, 30, (g, w, h) => { g.fillStyle = ink; eachGlyph(g, content, G => { if (!only || only.includes(G.line)) g.fill(G.path); }); texture(g, g.canvas.width, g.canvas.height, sd); });
      };
      if (typeof content === 'function') { if (!cacheFn.has(content)) cacheFn.set(content, new Map()); const m = cacheFn.get(content); if (!m.has(key)) m.set(key, make()); return m.get(key); }
      return M(content, 'p' + key + sd + (only || ''), make);
    },
    // age: s since this drum's hit. reg: [dx, dy] px registration error, rot: drum skew (rad)
    print(ctx, P, age, { reg = [0, 0], rot = 0, alpha = 1 } = {}) {
      if (age < 0) return;
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha *= alpha;
      ctx.translate(W / 2 + reg[0], H / 2 + reg[1]); ctx.rotate(rot); ctx.translate(-W / 2, -H / 2);
      if (age < 0.034) { for (const [dy, a] of [[46, 0.28], [22, 0.4], [0, 0.55]]) { ctx.globalAlpha = alpha * a; ctx.drawImage(P.cv, P.x, P.y + dy, P.w, P.h); } }
      else ctx.drawImage(P.cv, P.x, P.y, P.w, P.h);
      ctx.restore();
    },
    readable: age => age >= 0.034 ? 1 : age >= 0 ? 0.6 : 0,
  };
  return R;
}

// ================================================================ highway: the sign is a real object in the road world
// sign(): a guide-sign face (FHWA green, white legend and border, rounded corners, bolts, prismatic sheeting) baked
// at pxPerM texture px per metre. Legends drop the period (signs carry no punctuation). draw() places it with a
// projection scale and a retroreflection level: at night the face is dark until the headlights reach it; the
// legend sheeting returns light toward the source, so lum > 1 blows the legend to white (the camera clips it),
// and it falls dark again as the rig passes under. No glow is added: that is the whole trick.
export function highway({ face = null, green = '#0d6a40', legend = '#f4f4ee', amber = '255,176,48' } = {}) {
  const R = {
    sign(lines, { wM = 9, hM = 3.4, pxPerM = 100, font = face, sx = 1, cap = null, arrows = 0, justify = false } = {}) {
      const w = Math.round(wM * pxPerM), h = Math.round(hM * pxPerM), r = 0.22 * pxPerM, bw = 0.06 * pxPerM, bi = 0.12 * pxPerM;
      const L = canvas2d(w, h), g = L.g, mk = canvas2d(w, h), m = mk.g;
      g.fillStyle = green; g.beginPath(); g.roundRect(0, 0, w, h, r); g.fill();
      g.save(); g.clip(); const rr = rng(11); g.globalAlpha = 0.06;       // prismatic sheeting: faint diamond lattice + mottle
      for (let x = -h; x < w; x += 0.09 * pxPerM) { g.strokeStyle = rr() < 0.5 ? '#ffffff' : '#000000'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.moveTo(x + h, 0); g.lineTo(x, h); g.stroke(); }
      g.restore();
      for (const c of [g, m]) { c.strokeStyle = legend; c.lineWidth = bw; c.beginPath(); c.roundRect(bi, bi, w - 2 * bi, h - 2 * bi, r * 0.7); c.stroke(); }
      const aH = arrows ? 0.9 * pxPerM : 0;
      const strip = t => t.replace(/[.!,]/g, '');            // sign legends carry no punctuation
      const B = setBlock(font, lines.map(l => typeof l === 'string' ? { text: strip(l) } : { ...l, text: strip(l.text) }),
        { role: 'plant', cap: cap ?? h * 0.32, x: w / 2, y: (h - aH) / 2 + bi * 0.3, maxW: w - 2 * bi - 0.5 * pxPerM, justify, sx, gap: 0.26 });
      for (const G of B.glyphs) for (const c of [g, m]) { c.save(); c.translate(G.ox, G.oy); c.fillStyle = legend; c.fill(G.path); c.restore(); }
      for (let k = 0; k < arrows; k++) {             // down arrows, one per lane
        const ax = w * (k + 0.5) / arrows, ay = h - bi - aH * 0.55, s = aH * 0.42;
        for (const c of [g, m]) { c.fillStyle = legend; c.beginPath(); c.moveTo(ax - s * 0.18, ay - s); c.lineTo(ax + s * 0.18, ay - s); c.lineTo(ax + s * 0.18, ay); c.lineTo(ax + s * 0.5, ay); c.lineTo(ax, ay + s * 0.6); c.lineTo(ax - s * 0.5, ay); c.lineTo(ax - s * 0.18, ay); c.fill(); }
      }
      g.fillStyle = '#1a2a22'; for (const [x, y] of [[0.5, 0.5], [w - 0.5 * pxPerM, 0.5], [0.5, h - 0.5 * pxPerM], [w - 0.5 * pxPerM, h - 0.5 * pxPerM]]) { g.beginPath(); g.arc(x === 0.5 ? 0.5 * pxPerM : x, y === 0.5 ? 0.5 * pxPerM : y, 0.05 * pxPerM, 0, 7); g.fill(); }
      g.getImageData(0, 0, 1, 1); m.getImageData(0, 0, 1, 1);
      return { cv: L.cv, mask: mk.cv, wM, hM, w, h, block: B, bb: B.bbox, pxPerM, capM: B.cap / pxPerM, capsM: B.caps.map(c => c / pxPerM) };
    },
    // VMS: amber LED dot matrix (a real variable message sign). The word is rasterised to the matrix; on = lit dots.
    vms(text, { cols = 48, rows = 14, pitchM = 0.066, font = face, cap = 0.8, sx = 0.62 } = {}) {
      const S = canvas2d(cols, rows); S.g.fillStyle = '#000'; S.g.fillRect(0, 0, cols, rows);
      const B = setBlock(font, [{ text }], { cap: rows * cap, x: cols / 2, y: rows / 2, maxW: cols - 2, role: 'micro', sx });
      S.g.fillStyle = '#fff'; for (const G of B.glyphs) { S.g.save(); S.g.translate(G.ox, G.oy); S.g.fill(G.path); S.g.restore(); }
      const d = S.g.getImageData(0, 0, cols, rows).data, on = [];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (d[(y * cols + x) * 4] > 110) on.push([x, y]);
      return { cols, rows, pitchM, on, wM: cols * pitchM + 0.5, hM: rows * pitchM + 0.5, text, capRows: B.cap, wCols: B.bbox.x2 - B.bbox.x1 };
    },
    drawVms(ctx, V, x, y, s, lit, { lum = 0.3 } = {}) {   // x, y: centre; s px per metre
      const w = V.wM * s, h = V.hM * s, p = V.pitchM * s, x0 = x - V.cols * p / 2 + p / 2, y0 = y - V.rows * p / 2 + p / 2;
      ctx.save(); ctx.fillStyle = `rgb(${14 + 30 * lum},${15 + 30 * lum},${16 + 30 * lum})`; ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.fillStyle = '#050505'; ctx.fillRect(x - w / 2 + s * 0.12, y - h / 2 + s * 0.12, w - s * 0.24, h - s * 0.24);
      const r = Math.max(0.6, p * 0.36);
      if (p > 2.5) { ctx.fillStyle = 'rgba(70,52,30,0.55)'; for (let j = 0; j < V.rows; j++) for (let i = 0; i < V.cols; i++) ctx.fillRect(x0 + i * p - r * 0.7, y0 + j * p - r * 0.7, r * 1.4, r * 1.4); }
      if (lit > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(${amber},${0.22 * lit})`; for (const [i, j] of V.on) { ctx.beginPath(); ctx.arc(x0 + i * p, y0 + j * p, r * 2.1, 0, 7); ctx.fill(); }
        ctx.fillStyle = `rgba(255,${200 + 40 * lit | 0},140,${lit})`; for (const [i, j] of V.on) { ctx.beginPath(); ctx.arc(x0 + i * p, y0 + j * p, r, 0, 7); ctx.fill(); }
      }
      ctx.restore();
    },
    // x, y: sign centre on screen; s: px per metre; lum: 0 dark .. 1 fully lit .. 1.6 legend clipped white
    draw(ctx, S, x, y, s, lum) {
      const w = S.wM * s, h = S.hM * s;
      ctx.save(); ctx.fillStyle = '#030805'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, 0.22 * s); ctx.fill();
      ctx.globalAlpha = clamp(0.06 + lum); ctx.drawImage(S.cv, x - w / 2, y - h / 2, w, h);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'multiply';          // the beam's vertical falloff across the face
      const bg = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2); bg.addColorStop(0, 'rgb(150,150,150)'); bg.addColorStop(1, 'rgb(255,255,255)');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, 0.22 * s); ctx.fill(); ctx.globalCompositeOperation = 'source-over';
      if (lum > 1) { ctx.globalAlpha = clamp((lum - 1) * 1.6); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(S.mask, x - w / 2, y - h / 2, w, h); }
      ctx.restore();
      return { x1: x - w / 2, x2: x + w / 2, y1: y - h / 2, y2: y + h / 2 };
    },
    // retroreflection toward a camera riding with the lights: d = distance to the sign (m), dh = sign height above
    // the lamps (m), flash = high-beam / light-bar envelope. Dark far away (1/d^2), brightest while the sign is in
    // the upper beam, gone once it is overhead (the lamps do not reach up there).
    lum(d, dh = 4, flash = 0) {
      if (d <= 0.5) return 0;
      const ang = Math.atan2(dh, d), beam = 1 - smoothstep(0.3, 1.0, ang), far = 1 / (1 + Math.pow(d / 55, 2));
      return clamp((beam * far * 1.15 + flash * beam * 0.9), 0, 1.8);
    },
    // box-truss gantry across the road at depth d (m), drawn with a pinhole projection P(X, Y, d) -> {x, y, s}
    gantry(ctx, P, d, { spanM = 22, yLo = 5.4, yHi = 7.6, lum = 0.4, depthM = 1.0 } = {}) {
      ctx.save(); ctx.lineCap = 'round';
      const v = Math.round(20 + 90 * clamp(lum)), col = `rgb(${v},${v + 3},${v + 6})`, dark = `rgb(${v * 0.45 | 0},${v * 0.47 | 0},${v * 0.5 | 0})`;
      for (const dz of [depthM, 0]) {
        const a = P(-spanM / 2, yLo, d + dz), b = P(spanM / 2, yLo, d + dz), c = P(-spanM / 2, yHi, d + dz), e = P(spanM / 2, yHi, d + dz);
        if (!a || !c) continue;
        ctx.strokeStyle = dz ? dark : col; ctx.lineWidth = Math.max(1, 0.22 * a.s);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.moveTo(c.x, c.y); ctx.lineTo(e.x, e.y); ctx.stroke();
        ctx.lineWidth = Math.max(0.7, 0.08 * a.s); ctx.beginPath();
        const n = 14; for (let k = 0; k < n; k++) { const u0 = k / n, u1 = (k + 1) / n; const p0 = P(lerp(-spanM / 2, spanM / 2, u0), k % 2 ? yHi : yLo, d + dz), p1 = P(lerp(-spanM / 2, spanM / 2, u1), k % 2 ? yLo : yHi, d + dz); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); }
        ctx.stroke();
        for (const X of [-spanM / 2, spanM / 2]) { const g0 = P(X, 0, d + dz), g1 = P(X, yHi + 0.3, d + dz); ctx.lineWidth = Math.max(1.5, 0.45 * g0.s); ctx.strokeStyle = dz ? dark : col; ctx.beginPath(); ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.stroke(); }
      }
      ctx.restore();
    },
    readable: lum => clamp((lum - 0.12) / 0.3),
  };
  return R;
}
function smoothstep(a, b, x) { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); }

// ================================================================ steel + stamped: letter punches struck into a plate
// steelPlate(): brushed mild steel under a raking light, mill scale and scratches (bake once).
export function steelPlate({ w = W, h = H, seed = 4, tone = 132, rust = 0.25, light = [0.15, 0.1] } = {}) {
  const L = canvas2d(w, h), g = L.g, r = rng(seed), id = g.createImageData(w, h), d = id.data;
  const rows = new Float32Array(h); for (let y = 0; y < h; y++) rows[y] = (r() - 0.5) * 16 + Math.sin(y * 0.07) * 3;
  for (let y = 0; y < h; y++) { let run = 0; for (let x = 0; x < w; x++) { if ((x & 7) === 0) run = (r() - 0.5) * 10; const v = tone + rows[y] + run * 0.6 + (r() - 0.5) * 8; const i = (y * w + x) * 4; d[i] = v - 4; d[i + 1] = v; d[i + 2] = v + 6; d[i + 3] = 255; } }
  g.putImageData(id, 0, 0);
  for (let k = 0; k < 26; k++) { const x = r() * w, y = r() * h, R = 14 + r() * 60, gr = g.createRadialGradient(x, y, 0, x, y, R);   // mill scale
    gr.addColorStop(0, `rgba(30,38,52,${0.1 + r() * 0.16})`); gr.addColorStop(1, 'rgba(40,48,60,0)'); g.fillStyle = gr; g.fillRect(x - R, y - R, 2 * R, 2 * R); }
  if (rust) for (let k = 0; k < 40; k++) { const x = r() < 0.5 ? r() * w * 0.15 : w - r() * w * 0.15, y = r() * h, R = 20 + r() * 90, gr = g.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, `rgba(120,55,25,${rust * (0.3 + r() * 0.5)})`); gr.addColorStop(1, 'rgba(120,55,25,0)'); g.fillStyle = gr; g.fillRect(x - R, y - R, 2 * R, 2 * R); }
  g.lineCap = 'round'; for (let k = 0; k < 140; k++) { g.strokeStyle = `rgba(${r() < 0.5 ? '230,236,240' : '20,22,26'},${0.08 + r() * 0.2})`; g.lineWidth = 0.6 + r() * 1.2;
    const x = r() * w, y = r() * h, a = (r() - 0.5) * 0.7 + (r() < 0.3 ? 1.2 : 0), l = 20 + r() * 220; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  const gr = g.createLinearGradient(w * light[0], h * light[1], w * 0.9, h * 0.8); gr.addColorStop(0, 'rgba(255,248,236,0.34)'); gr.addColorStop(0.45, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(8,10,16,0.55)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h); g.getImageData(0, 0, 1, 1);
  return L.cv;
}
// stamped(): each glyph is a punch with its own depth, tilt and baseline error (hand stamping is never even).
// draw(ctx, block, t, strikes): strikes = the hit time of each glyph (one blow per letter) or one time for the whole
// die. A struck glyph flashes white-hot for 2 frames and throws sparks; shake(t) gives the scene its camera kick.
// paint(ctx, block, u): red paint wiped into the dents (u 0..1 across the word), shading kept (multiply).
export function stamped({ seed = 9, depth = [0.6, 1], tilt = 0.07, jit = 6, paintInk = '#b8141c', spark = '255,196,120' } = {}) {
  const M = memo();
  const J = (block, G) => { const r = rng(seed * 997 + G.i * 131 + block.n); return { rot: (r() - 0.5) * 2 * tilt, dx: (r() - 0.5) * jit, dy: (r() - 0.5) * 2 * jit, dep: lerp(depth[0], depth[1], r()) }; };
  const sprites = block => M(block, 'dents', () => block.glyphs.map(G => {
    const j = J(block, G), D = Math.max(3, G.cap * 0.045 * j.dep), pad = D * 3 + 8, b = G.bb;
    const L = canvas2d(Math.ceil(b.w + 2 * pad), Math.ceil(b.h + 2 * pad)), g = L.g; g.translate(pad - b.x1, pad - b.y1);
    g.save(); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.5)'; g.translate(-1.5, -1.5); g.stroke(G.path); g.restore();   // burr: lit lip
    g.save(); g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.45)'; g.translate(2, 2); g.stroke(G.path); g.restore();
    const fl = g.createLinearGradient(b.x1, b.y1, b.x2, b.y2); fl.addColorStop(0, `rgba(22,23,27,${0.8 + 0.2 * j.dep})`); fl.addColorStop(1, `rgba(52,54,60,${0.7 + 0.2 * j.dep})`);
    g.fillStyle = fl; g.fill(G.path);                                                                                          // floor of the dent (rough, dark)
    g.save(); g.clip(G.path); const rr = rng(seed + G.i); g.fillStyle = 'rgba(255,255,255,0.05)';                           // tool-struck grain on the floor
    for (let k = 0; k < b.w * b.h / 60; k++) g.fillRect(lerp(b.x1, b.x2, rr()), lerp(b.y1, b.y2, rr()), 1 + rr() * 2, 1); g.restore();
    innerShadow(g, G, 'rgba(0,0,0,0.95)', D * 1.3, D * 1.3, D * 0.35);                                                       // wall away from the light
    innerShadow(g, G, 'rgba(0,0,0,0.5)', D * 2.4, D * 2.4, D * 1.2);
    innerShadow(g, G, 'rgba(246,248,252,0.95)', -D * 0.7, -D * 0.7, D * 0.2);                                               // wall facing it: a hard lit bevel
    g.getImageData(0, 0, 1, 1);
    return { cv: L.cv, x: b.x1 - pad, y: b.y1 - pad, w: L.cv.width, h: L.cv.height, j };
  }));
  const at = (strikes, G) => Array.isArray(strikes) ? strikes[G.i] ?? strikes[strikes.length - 1] : strikes;
  const R = {
    warm(block) { sprites(block); return R; },
    draw(ctx, block, t, strikes, { sparksOn = true } = {}) {
      const S = sprites(block), hot = [];
      for (const G of block.glyphs) {
        const age = t - at(strikes, G); if (age < 0) continue; const s = S[G.i], j = s.j;
        ctx.save(); ctx.translate(G.ox + j.dx, G.oy + j.dy); ctx.rotate(j.rot); ctx.drawImage(s.cv, s.x, s.y, s.w, s.h);
        if (age < 0.067) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,236,200,${0.75 * (1 - age / 0.067)})`; ctx.fill(G.path); }
        ctx.restore();
        if (sparksOn && age < 0.3) hot.push({ x: G.ox + j.dx, y: G.oy + j.dy + G.bb.y2 * 0.6, age, i: G.i });
      }
      if (hot.length) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        for (const h of hot) { const r = rng(seed + h.i * 71); for (let k = 0; k < 9; k++) {
          const a = -Math.PI * (0.1 + 0.8 * r()), v = 500 + 900 * r(), x = h.x + (r() - 0.5) * 60, y = h.y, tt = h.age, px = x + Math.cos(a) * v * tt, py = y + Math.sin(a) * v * tt + 1600 * tt * tt;
          const al = clamp(1 - tt / (0.15 + 0.15 * r())); if (al <= 0) continue;
          ctx.strokeStyle = `rgba(${spark},${al})`; ctx.lineWidth = 2 + r() * 2; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - Math.cos(a) * v * 0.025, py - Math.sin(a) * v * 0.025 - 3200 * tt * 0.025); ctx.stroke(); } }
        ctx.restore();
      }
    },
    shake(block, t, strikes) { let e = 0; for (const G of block.glyphs) { const a = t - at(strikes, G); if (a >= 0) e = Math.max(e, Math.exp(-a * 22)); } return e; },
    paint(ctx, block, u, { ink = paintInk } = {}) {
      if (u <= 0) return; const S = sprites(block), b = block.bbox, xw = lerp(b.x1 - 40, b.x2 + 40, clamp(u));
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, xw, H); ctx.clip();
      for (const G of block.glyphs) { const j = S[G.i].j; ctx.save(); ctx.translate(G.ox + j.dx, G.oy + j.dy); ctx.rotate(j.rot); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = ink; ctx.fill(G.path); ctx.restore(); }
      if (u < 1) { ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = ink; const r = rng(seed + 5);                  // the rag's front: a wet smear on the face
        for (let k = 0; k < 14; k++) { const y = lerp(b.y1, b.y2, r()), hh = 4 + r() * 22; ctx.globalAlpha = 0.1 + 0.2 * r(); ctx.fillRect(xw - 60 - r() * 80, y, 60 + r() * 80, hh); } }
      ctx.restore();
    },
    readable: (block, t, strikes) => block.glyphs.filter(G => t - at(strikes, G) >= 0).length / block.n,
  };
  return R;
}

// ================================================================ letterpress: the platen comes down on the kick
// impression(block, {ink | fountain}): wood type inked on the press: a split fountain (two inks blended on one
// roller) or one ink, wood grain streaks and salt where the ink starved, a squeezed darker rim, a light deboss.
// shade(ctx, age): the platen closing, a dark edge sweeping down in the 0.2 s before the hit (scene-level).
export function letterpress({ seed = 12, grain = 0.5, salt = 0.4, deboss = 0.35 } = {}) {
  const M = memo();
  const R = {
    impression(block, { ink = '#161112', fountain = null, key = '', only = null } = {}) {
      return M(block, 'imp' + ink + (fountain || []).join() + key + (only || ''), () => bakeBlock(block, 24, (g, w, h, x, y) => {
        const b = block.bbox, eachGlyph2 = (g2, blk, fn) => eachGlyph(g2, blk, G => { if (!only || only.includes(G.line)) fn(G); });
        let fill = ink; if (fountain) { const gr = g.createLinearGradient(b.x1, 0, b.x2, 0); fountain.forEach((c, i) => gr.addColorStop(i / (fountain.length - 1), c)); fill = gr; }
        g.fillStyle = fill; eachGlyph2(g, block, G => g.fill(G.path));
        g.save(); g.globalCompositeOperation = 'destination-out'; const r = rng(seed);            // wood grain: long wavy streaks
        for (let k = 0; k < (b.y2 - b.y1) * 0.9; k++) { const yy = lerp(b.y1, b.y2, r()), a = grain * (0.08 + 0.32 * r() * r()); g.strokeStyle = `rgba(0,0,0,${a})`; g.lineWidth = 0.6 + r() * 2.2;
          g.beginPath(); const ph = r() * 6, amp = 1 + r() * 4; for (let xx = b.x1 - 10; xx <= b.x2 + 10; xx += 12) { const Y = yy + Math.sin(xx * 0.011 + ph) * amp; xx === b.x1 - 10 ? g.moveTo(xx, Y) : g.lineTo(xx, Y); } g.stroke(); }
        g.restore();
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); eat(g, voidTile(seed + 3, { n: 2600, r0: 0.4, r1: 2.8, a1: 1, blobs: 14 }), g.canvas.width, g.canvas.height, salt); g.restore();
        g.save(); g.lineJoin = 'round'; eachGlyph2(g, block, G => { g.save(); g.clip(G.path); g.lineWidth = Math.max(2, G.cap * 0.02); g.strokeStyle = typeof fill === 'string' ? fill : ink; g.globalAlpha = 0.7; g.stroke(G.path); g.restore(); }); g.restore();
        if (deboss) eachGlyph2(g, block, G => { innerShadow(g, G, `rgba(0,0,0,${deboss})`, 3, 4, 3); innerShadow(g, G, `rgba(255,248,230,${deboss * 0.7})`, -2, -2, 2); });
      }));
    },
    // age: s since this impression's hit. The sheet settles from a 1% lift on the hit frame.
    print(ctx, I, age, { alpha = 1 } = {}) {
      if (age < 0) return; const s = age < 0.034 ? 1.012 : 1;
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha *= alpha;
      if (s !== 1) { ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2); }
      ctx.drawImage(I.cv, I.x, I.y, I.w, I.h); ctx.restore();
    },
    shade(ctx, age, { dur = 0.2, max = 0.82 } = {}) {        // the platen swinging shut: age < 0 before the hit
      if (age >= 0 || age < -dur) return; const u = 1 + age / dur, edge = lerp(-200, H + 200, ease.inCubic(u));
      const gr = ctx.createLinearGradient(0, edge - 500, 0, edge); gr.addColorStop(0, `rgba(12,8,6,${max * u})`); gr.addColorStop(1, 'rgba(12,8,6,0)');
      ctx.save(); ctx.fillStyle = `rgba(12,8,6,${max * u})`; ctx.fillRect(0, 0, W, Math.max(0, edge - 500)); ctx.fillStyle = gr; ctx.fillRect(0, edge - 500, W, 500); ctx.restore();
    },
    readable: age => age >= 0 ? 1 : 0,
  };
  return R;
}

// ================================================================ skylight: hundreds of lights assemble the word
// points(block, spacing): a drone-show formation sampled on a jittered grid inside the glyphs. draw() flies every
// light from its source (city windows, the convoy) along a rising arc, staggered, locking `lock` s before the hit;
// after `burst` s the formation blows outward and fades (the chant clears). Bloom lives only on the points.
export function skylight({ seed = 21, core = '255,246,232', warm = '255,90,70', r = 3.8, halo = 16 } = {}) {
  const M = memo(), spr = new Map();
  const sprite = (col) => { if (spr.has(col)) return spr.get(col); const s = Math.ceil(halo * 2 + 2), L = canvas2d(s, s), g = L.g, c = s / 2;
    const gr = g.createRadialGradient(c, c, 0, c, c, halo); gr.addColorStop(0, `rgba(${col},0.85)`); gr.addColorStop(0.22, `rgba(${col},0.28)`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, s, s); g.fillStyle = `rgba(${col},1)`; g.beginPath(); g.arc(c, c, r, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(c, c, r * 0.5, 0, 7); g.fill();
    g.getImageData(0, 0, 1, 1); spr.set(col, L.cv); return L.cv; };
  const R = {
    points(block, { spacing = 13, jitter = 0.18 } = {}) {
      return M(block, 'pts' + spacing, () => {
        const b = block.bbox, x0 = Math.floor(b.x1 - 4), y0 = Math.floor(b.y1 - 4), w = Math.ceil(b.x2 - b.x1 + 8), h = Math.ceil(b.y2 - b.y1 + 8);
        const L = canvas2d(w, h); L.g.translate(-x0, -y0); L.g.fillStyle = '#fff'; eachGlyph(L.g, block, G => L.g.fill(G.path));
        const d = L.g.getImageData(0, 0, w, h).data, out = [], rr = rng(seed);
        for (let y = spacing / 2; y < h; y += spacing) for (let x = spacing / 2 + ((y / spacing | 0) % 2) * spacing * 0.5; x < w; x += spacing) {
          const px = Math.round(x + (rr() - 0.5) * spacing * jitter), py = Math.round(y + (rr() - 0.5) * spacing * jitter);
          if (px >= 0 && py >= 0 && px < w && py < h && d[(py * w + px) * 4] > 128) out.push({ x: px + x0, y: py + y0, k: rr(), c: rr() });
        }
        return out;
      });
    },
    // age: s since the hit. src(i, p) -> [x, y] launch point. arrive: s of flight; lock: settle before the hit.
    draw(ctx, pts, age, { src, arrive = 1.0, lock = 0.06, burst = null, spread = 0.35, red = 0, twinkle = 1 } = {}) {
      const cs = sprite(core), ws = sprite(warm), hs = cs.width / 2;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      let home = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], d0 = p.k * spread * arrive, T = arrive - d0 - lock, tt = age + arrive - d0;
        if (tt < 0) continue;
        let x, y, a = 1;
        if (tt < T) { const [sx, sy] = src(i, p), u = ease.inOutCubic(tt / T), cx = lerp(sx, p.x, 0.3) + (p.c - 0.5) * 300, cy = Math.min(sy, p.y) - 260 - p.c * 240;
          const v = 1 - u; x = v * v * sx + 2 * v * u * cx + u * u * p.x; y = v * v * sy + 2 * v * u * cy + u * u * p.y; a = 0.35 + 0.65 * u; }
        else { x = p.x + (twinkle ? Math.sin(age * 7 + i) * 0.7 : 0); y = p.y + (twinkle ? Math.cos(age * 5 + i * 1.3) * 0.7 : 0); home++; }
        if (burst != null && age > burst) { const b = age - burst, [cx2, cy2] = [p.x - 510, p.y - 760], L = Math.hypot(cx2, cy2) + 1;
          x += cx2 / L * (400 + 600 * p.c) * b; y += cy2 / L * (400 + 600 * p.c) * b + 300 * b * b; a *= clamp(1 - b / 0.45); }
        if (a <= 0.02) continue;
        ctx.globalAlpha = a; ctx.drawImage(red && p.c < red ? ws : cs, x - hs, y - hs);
      }
      ctx.restore();
      return home / Math.max(1, pts.length);
    },
    // every light locks at -lock whatever its launch (launches are staggered, arrivals are not)
    readable(pts, age, { lock = 0.06, burst = null } = {}) { if (burst != null && age > burst + 0.1) return 0; return age >= -lock ? 1 : age >= -lock - 0.08 ? 0.6 : 0; },
  };
  return R;
}
