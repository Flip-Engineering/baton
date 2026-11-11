// TYPE: kinetic typography from real glyph outlines.
// opentype.js turns the local @fontsource .woff files into per-glyph vector paths, so every
// letter is an object we can spring, slam, draw along its contour, shatter, use as a mask,
// press into paper or extrude in three.js. Everything is deterministic in its inputs (age/u).
//
//   const anton = await loadFace('anton');
//   const w = shape(anton, 'BUILD', { size: 420, x: W / 2, y: 900, valign: 'center' });
//   glyphs(ctx, w, springs(age, { from: { dy: 300, rot: 0.4 } }), look.fill(C.cream), { shutter: 4 });
//
// LAZY BAKES: look.cache sprites, their hi-res mip, and Shatter shard/edge sprites are rasterised on
// first use, and Chromium defers even canvas work it has recorded. A render that starts mid-piece
// (--from) would otherwise pay 9-14 s on its first frame. Call prewarm({...}) before
// window.sceneReady = true so every render path starts from the same warm state.
import { W, H, C, clamp, lerp, ease, rng } from '../kit.js';
import { parse as otParse } from '../../node_modules/opentype.js/dist/opentype.mjs';

// ---------------------------------------------------------------- faces
export const FACES = {
  anton: 'anton/files/anton-latin-400-normal.woff',                     // condensed poster grotesk
  archivo: 'archivo-black/files/archivo-black-latin-400-normal.woff',   // fat grotesk
  michroma: 'michroma/files/michroma-latin-400-normal.woff',            // wide techno
  plex: 'ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff',      // mono / data
  bebas: 'bebas-neue/files/bebas-neue-latin-400-normal.woff',           // tall caps
  oswald: 'oswald/files/oswald-latin-700-normal.woff',                  // condensed bold
  shoulders: 'big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff', // Chicago industrial, ultra
  cinzel: 'cinzel/files/cinzel-latin-900-normal.woff',                  // Roman inscription caps (mythic)
  playfair: 'playfair-display/files/playfair-display-latin-900-normal.woff',   // high-contrast bank serif
  playfairItalic: 'playfair-display/files/playfair-display-latin-900-italic.woff',
  fell: 'im-fell-english/files/im-fell-english-latin-400-normal.woff',  // 1700s broadside
  // TYPE studio cycle 1 (world type, type_world.js)
  overpass: 'overpass/files/overpass-latin-800-normal.woff',            // Highway Gothic derivative (FHWA sign legends)
  ultra: 'ultra/files/ultra-latin-400-normal.woff',                     // fat Clarendon: wood-type poster
  stencil: 'big-shoulders-stencil-display/files/big-shoulders-stencil-display-latin-900-normal.woff', // industrial stencil
  oranienbaum: 'oranienbaum/files/oranienbaum-latin-400-normal.woff',   // condensed high-contrast antiqua (engraved legends)
};
const faceCache = new Map();
export async function loadFace(name) {
  if (!faceCache.has(name)) {
    const url = new URL('../../node_modules/@fontsource/' + (FACES[name] || name), import.meta.url);
    faceCache.set(name, fetch(url).then(r => r.arrayBuffer()).then(b => otParse(b)));
  }
  return faceCache.get(name);
}

// ---------------------------------------------------------------- shaping
// shape(font, text, o) -> Word { glyphs: [G], bbox, size, text }
// Each G: { ch, i, ox, oy (world pivot = ink-box centre), cmds/path (local, pivot-centred),
//           bb (local ink box), contours [{pts, cum, len}], len, ring (Path2D for inner shadows) }
// o: size | capH (size from cap height) | maxW | x, y | align left/center/right |
//    valign baseline/center/cap (cap: y is the cap-top) | tracking (em) | kerning
export function shape(font, text, o = {}) {
  const { x = W / 2, y = H / 2, align = 'center', valign = 'baseline', tracking = 0, kerning = true, maxW = null, tol = 1.2 } = o;
  const upm = font.unitsPerEm, cap = (font.tables.os2 && font.tables.os2.sCapHeight) || upm * 0.7;
  let size = o.capH ? o.capH * upm / cap : (o.size || 300);
  const gl = [...text].map(ch => font.charToGlyph(ch));   // per-char: no GSUB (opentype.js 2 throws on some lookups)
  const adv = gl.map((g, i) => (g.advanceWidth || 0) + (kerning && i < gl.length - 1 ? font.getKerningValue(g, gl[i + 1]) : 0)
    + (i < gl.length - 1 ? tracking * upm : 0));
  const total = adv.reduce((a, b) => a + b, 0);
  if (maxW && total * size / upm > maxW) size = maxW / (total / upm);
  const k = size / upm;
  const raw = [];
  let pen = 0;
  gl.forEach((g, i) => {
    const p = g.getPath(pen, 0, size);
    if (p.commands.length) raw.push({ ch: text[i], cmds: p.commands, bb: p.getBoundingBox(), pen, adv: adv[i] * k });
    pen += adv[i] * k;
  });
  const width = pen - (gl.length ? tracking * upm * k : 0);
  let x0 = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  let ink = { y1: 1e9, y2: -1e9 };
  for (const r of raw) { ink.y1 = Math.min(ink.y1, r.bb.y1); ink.y2 = Math.max(ink.y2, r.bb.y2); }
  let y0 = y;
  if (valign === 'center') y0 = y - (ink.y1 + ink.y2) / 2;
  else if (valign === 'cap') y0 = y + cap * k;
  const glyphs = raw.map((r, i) => {
    const cx = (r.bb.x1 + r.bb.x2) / 2, cy = (r.bb.y1 + r.bb.y2) / 2;
    const cmds = r.cmds.map(c => {
      const q = { type: c.type };
      for (const kk of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) if (c[kk] !== undefined) q[kk] = c[kk] - (kk[0] === 'x' ? cx : cy);
      return q;
    });
    const path = toPath2D(cmds);
    const bb = { x1: r.bb.x1 - cx, y1: r.bb.y1 - cy, x2: r.bb.x2 - cx, y2: r.bb.y2 - cy };
    bb.w = bb.x2 - bb.x1; bb.h = bb.y2 - bb.y1;
    const contours = flatten(cmds, tol);
    const rp = 80, ring = new Path2D(); ring.rect(bb.x1 - rp, bb.y1 - rp, bb.w + 2 * rp, bb.h + 2 * rp); ring.addPath(path);   // tight: blur cost scales with this area
    return { ch: r.ch, i, ox: x0 + cx, oy: y0 + cy, cmds, path, bb, contours, len: contours.reduce((a, c) => a + c.len, 0), ring };
  });
  const bbox = { x1: x0, x2: x0 + width, y1: y0 + ink.y1, y2: y0 + ink.y2 };
  return { font, text, size, glyphs, bbox, x0, y0, width, n: glyphs.length, len: glyphs.reduce((a, g) => a + g.len, 0) };
}

// Stack several lines into one Word-like block (glyph indices run through all lines).
export function shapeLines(font, lines, o = {}) {
  const { y = H / 2, lead = 1.0 } = o;
  const words = lines.map(l => shape(font, typeof l === 'string' ? l : l.text, { ...o, ...(typeof l === 'string' ? {} : l), valign: 'baseline', y: 0 }));
  const hs = words.map(w => w.bbox.y2 - w.bbox.y1);
  const total = hs.reduce((a, b) => a + b, 0) + (words.length - 1) * (o.gap ?? 0.12 * words[0].size) * lead;
  let yy = y - total / 2, glyphs = [];
  words.forEach((w, li) => {
    const dy = yy - w.bbox.y1;
    for (const g of w.glyphs) glyphs.push({ ...g, oy: g.oy + dy, line: li, i: glyphs.length });
    w.bbox.y1 += dy; w.bbox.y2 += dy; w.y0 += dy;
    yy += hs[li] + (o.gap ?? 0.12 * w.size) * lead;
  });
  const bbox = { x1: Math.min(...words.map(w => w.bbox.x1)), x2: Math.max(...words.map(w => w.bbox.x2)), y1: words[0].bbox.y1, y2: words.at(-1).bbox.y2 };
  return { font, lines: words, glyphs, bbox, n: glyphs.length, size: words[0].size, len: glyphs.reduce((a, g) => a + g.len, 0) };
}

function toPath2D(cmds, dx = 0, dy = 0) {
  const p = new Path2D();
  for (const c of cmds) {
    if (c.type === 'M') p.moveTo(c.x + dx, c.y + dy);
    else if (c.type === 'L') p.lineTo(c.x + dx, c.y + dy);
    else if (c.type === 'Q') p.quadraticCurveTo(c.x1 + dx, c.y1 + dy, c.x + dx, c.y + dy);
    else if (c.type === 'C') p.bezierCurveTo(c.x1 + dx, c.y1 + dy, c.x2 + dx, c.y2 + dy, c.x + dx, c.y + dy);
    else if (c.type === 'Z') p.closePath();
  }
  return p;
}

// Contours as polylines with cumulative arc length (for draw-on and tips).
function flatten(cmds, tol) {
  const out = []; let cur = null, sx = 0, sy = 0, px = 0, py = 0;
  const push = (x, y) => { const n = cur.pts.length; const lx = cur.pts[n - 2], ly = cur.pts[n - 1];
    const d = Math.hypot(x - lx, y - ly); if (d < 1e-3) return; cur.pts.push(x, y); cur.len += d; cur.cum.push(cur.len); };
  const segs = L => clamp(Math.ceil(Math.sqrt(L / tol) * 1.2), 2, 48);
  for (const c of cmds) {
    if (c.type === 'M') { cur = { pts: [c.x, c.y], cum: [0], len: 0 }; out.push(cur); sx = px = c.x; sy = py = c.y; }
    else if (c.type === 'L') { push(c.x, c.y); px = c.x; py = c.y; }
    else if (c.type === 'Q') {
      const n = segs(Math.hypot(c.x1 - px, c.y1 - py) + Math.hypot(c.x - c.x1, c.y - c.y1));
      for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; push(u * u * px + 2 * u * t * c.x1 + t * t * c.x, u * u * py + 2 * u * t * c.y1 + t * t * c.y); }
      px = c.x; py = c.y;
    } else if (c.type === 'C') {
      const n = segs(Math.hypot(c.x1 - px, c.y1 - py) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x - c.x2, c.y - c.y2));
      for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t;
        push(u * u * u * px + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x, u * u * u * py + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y); }
      px = c.x; py = c.y;
    } else if (c.type === 'Z' && cur) { push(sx, sy); px = sx; py = sy; }
  }
  return out.filter(c => c.len > 0);
}

// ---------------------------------------------------------------- transforms
// A transform fn tf(g, i, n, word) -> {dx, dy, sx, sy, s, rot, skx, alpha} | null (skip glyph).
// Transforms built by springs/slam/timed carry tf.age and tf.at(age2) -> the same transform at another
// age. Everything is deterministic in age, so glyphs(..., {shutter}) can sample sub-frame ages.
export function timed(make, age) { const tf = make(age); tf.age = age; tf.at = a => timed(make, a); return tf; }
function applyTf(ctx, g, t) {
  ctx.translate(g.ox + (t.dx || 0), g.oy + (t.dy || 0));
  if (t.rot) ctx.rotate(t.rot);
  if (t.skx) ctx.transform(1, 0, t.skx, 1, 0, 0);
  const s = t.s ?? 1;
  ctx.scale(s * (t.sx ?? 1), s * (t.sy ?? 1));
  if (t.alpha !== undefined) ctx.globalAlpha *= clamp(t.alpha);
}
const ID = {};
// Paint every glyph of a word through tf with a look.
// o.shutter = n (3-5): real motion blur. The transform is re-sampled at n sub-frame ages over a
// 180-degree shutter (o.angle / o.fps seconds, trailing, so the current pose is the sharpest) and the
// samples are averaged exactly (premultiplied 'lighter' accumulation at 1/n). Only glyphs that move
// more than o.minMove device px are blurred; the rest are drawn once. Needs tf.at (springs/slam/timed).
export function glyphs(ctx, word, tf, paint, o = {}) {
  const n = word.glyphs.length;
  if (o.shutter > 1 && tf && tf.at) return blurGlyphs(ctx, word, tf, paint, o);
  for (const g of word.glyphs) {
    const t = tf ? tf(g, g.i, n, word) : ID;
    if (!t) continue;
    ctx.save(); applyTf(ctx, g, t); paint(ctx, g, t); ctx.restore();
  }
}
function tfMatrix(g, t) {
  const m = new DOMMatrix().translate(g.ox + (t.dx || 0), g.oy + (t.dy || 0));
  if (t.rot) m.rotateSelf(t.rot * 180 / Math.PI);
  if (t.skx) m.multiplySelf(new DOMMatrix([1, 0, t.skx, 1, 0, 0]));
  const s = t.s ?? 1; return m.scaleSelf(s * (t.sx ?? 1), s * (t.sy ?? 1));
}
function boxCorners(M, x1, y1, x2, y2) {
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]].map(([x, y]) => [M.a * x + M.c * y + M.e, M.b * x + M.d * y + M.f]);
}
function blurGlyphs(ctx, word, tf, paint, { shutter = 4, angle = 0.5, fps = 30, minMove = 2, lores = 60, res } = {}) {
  const n = word.glyphs.length, span = angle / fps, M0 = ctx.getTransform();
  const pad = paint.pad ?? Math.max(24, word.size * 0.12);
  const tfs = Array.from({ length: shutter }, (_, k) => k === shutter - 1 ? tf : tf.at(tf.age - span * (1 - k / (shutter - 1))));
  const moving = [], box = [1e9, 1e9, -1e9, -1e9]; let mvMax = 0;
  for (const g of word.glyphs) {
    const ts = tfs.map(f => f(g, g.i, n, word)), last = ts[shutter - 1];
    if (!ts.some(Boolean)) continue;
    const cs = ts.map(t => t && boxCorners(M0.multiply(tfMatrix(g, t)), g.bb.x1 - pad, g.bb.y1 - pad, g.bb.x2 + pad, g.bb.y2 + pad));
    let mv = 0;
    for (let k = 0; k < shutter - 1; k++) {
      if (!cs[k] || !last) { mv = 1e9; break; }
      for (let j = 0; j < 4; j++) mv = Math.max(mv, Math.hypot(cs[k][j][0] - cs[shutter - 1][j][0], cs[k][j][1] - cs[shutter - 1][j][1]));
    }
    if (mv < minMove) { ctx.save(); applyTf(ctx, g, last); paint(ctx, g, last); ctx.restore(); continue; }
    moving.push([g, ts]); mvMax = Math.max(mvMax, mv);
    for (const c of cs) if (c) for (const [x, y] of c) { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); }
  }
  if (!moving.length) return;
  // fast movers (> lores device px across the shutter) are accumulated at half resolution: the smear hides it
  // and every scratch pass costs a quarter. res overrides (1 = always full res).
  accumulate(ctx, box, shutter, (k, g2) => {
    for (const [g, ts] of moving) { const t = ts[k]; if (!t) continue; g2.save(); applyTf(g2, g, t); paint(g2, g, t); g2.restore(); }
  }, { res: res ?? (mvMax > lores ? 0.5 : 1) });
}
// Exact n-sample average of drawSample(k, ctx2) for k = 0..n-1, composited onto ctx inside the device
// rect `box` [x1, y1, x2, y2]. Each sample is painted normally (source-over, so multi-layer looks stay
// correct) into scratch S, then added into A with 'lighter' at 1/n. Work scales with the rect, not the frame.
// o.res < 1 accumulates at that resolution (scratch pixels = res^2) and upscales once: for big fast smears.
const ACC = {};
export function accumulate(ctx, box, n, drawSample, { res = 1 } = {}) {
  const x = Math.max(0, Math.floor(box[0])), y = Math.max(0, Math.floor(box[1]));
  const w = Math.min(W, Math.ceil(box[2])) - x, h = Math.min(H, Math.ceil(box[3])) - y;
  if (w <= 0 || h <= 0) return;
  const S = ACC.S || (ACC.S = canvas2d()), A = ACC.A || (ACC.A = canvas2d()), M0 = ctx.getTransform();
  const sw = Math.ceil(w * res), sh = Math.ceil(h * res);
  A.g.setTransform(1, 0, 0, 1, 0, 0); A.g.globalCompositeOperation = 'source-over'; A.g.globalAlpha = 1; A.g.clearRect(0, 0, sw, sh);
  for (let k = 0; k < n; k++) {
    S.g.setTransform(1, 0, 0, 1, 0, 0); S.g.globalAlpha = 1; S.g.globalCompositeOperation = 'source-over'; S.g.clearRect(0, 0, sw, sh);
    S.g.save(); S.g.beginPath(); S.g.rect(0, 0, sw, sh); S.g.clip();
    S.g.setTransform(res, 0, 0, res, -x * res, -y * res); S.g.transform(M0.a, M0.b, M0.c, M0.d, M0.e, M0.f);
    drawSample(k, S.g); S.g.restore();
    A.g.globalCompositeOperation = 'lighter'; A.g.globalAlpha = 1 / n; A.g.drawImage(S.cv, 0, 0, sw, sh, 0, 0, sw, sh);
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(A.cv, 0, 0, sw, sh, x, y, w, h); ctx.restore();
}
// One Path2D for the whole (transformed) word, in world space: clip/mask/hit with it.
export function wordPath(word, tf, into = null) {
  const p = into || new Path2D(), n = word.glyphs.length;
  for (const g of word.glyphs) {
    const t = tf ? tf(g, g.i, n, word) : ID;
    if (!t || t.alpha === 0) continue;
    p.addPath(g.path, tfMatrix(g, t));
  }
  return p;
}
// Several [word, tf] pairs as one Path2D: mask/rings/clip them in one pass.
export function wordsPath(pairs) { const p = new Path2D(); for (const [w, tf] of pairs) wordPath(w, tf, p); return p; }

// Legibility guard: the fraction of a word's glyphs that sit near home, i.e. visible (alpha >= minAlpha),
// scale within tol (15 %), rotation/skew within rotTol (15 deg), offset within tol x glyph height.
// Frame rule of thumb: some word on stage should score >= 0.6 on every beat (see type_sets.seq().readable).
export function readable(word, tf, { tol = 0.15, rotTol = 0.26, minAlpha = 0.5 } = {}) {
  if (!tf) return 1;
  const n = word.glyphs.length; let ok = 0;
  for (const g of word.glyphs) {
    const t = tf(g, g.i, n, word); if (!t) continue;
    const s = t.s ?? 1, sx = s * (t.sx ?? 1), sy = s * (t.sy ?? 1), h = Math.max(g.bb.h, (word.size || 300) * 0.5);
    if ((t.alpha ?? 1) >= minAlpha && Math.abs(sx - 1) <= tol && Math.abs(sy - 1) <= tol && Math.abs(t.rot || 0) <= rotTol
      && Math.abs(t.skx || 0) <= rotTol && Math.hypot(t.dx || 0, t.dy || 0) <= tol * h) ok++;
  }
  return ok / n;
}

// Glyph order for staggers: ltr | rtl | center | edges | random(seed)
export function order(n, mode = 'ltr', seed = 1) {
  const idx = [...Array(n).keys()];
  if (mode === 'rtl') idx.reverse();
  else if (mode === 'center') idx.sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2));
  else if (mode === 'edges') idx.sort((a, b) => Math.abs(b - (n - 1) / 2) - Math.abs(a - (n - 1) / 2));
  else if (mode === 'random') { const r = rng(seed); for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } }
  const rank = new Array(n); idx.forEach((g, k) => { rank[g] = k; }); return rank;
}

// Damped spring 0 -> 1 (overshoots). f = Hz, z = damping ratio.
export function spring(a, f = 3, z = 0.35) {
  if (a <= 0) return 0;
  const w = 2 * Math.PI * f, wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * a) * (Math.cos(wd * a) + (z * w / wd) * Math.sin(wd * a));
}

// Staggered spring-in: glyphs fly from `from` offsets into place.
// o: from {dx, dy, s, rot, skx}, stagger (s/glyph), order, f, z, fade, out (age of exit), outTo
export function springs(age, o = {}) {
  const { from = { dy: 260 }, stagger = 0.045, mode = 'ltr', f = 2.6, z = 0.38, fade = 0.08, out = null, outTo = { dy: -200, alpha: 0 }, outDur = 0.22, seed = 1 } = o;
  let rank = null;
  const tf = (g, i, n) => {
    rank = rank && rank.length === n ? rank : order(n, mode, seed);
    const a = age - rank[i] * stagger;
    if (a <= 0) return null;
    const v = spring(a, f, z), q = 1 - v;
    const t = { dx: (from.dx || 0) * q, dy: (from.dy || 0) * q, s: 1 + ((from.s ?? 1) - 1) * q, rot: (from.rot || 0) * q, skx: (from.skx || 0) * q,
      alpha: fade ? clamp(a / fade) : 1 };
    if (out != null) {
      const u = ease.inCubic((age - out - rank[i] * stagger * 0.5) / outDur);
      if (u >= 1) return null;
      if (u > 0) { t.dx += (outTo.dx || 0) * u; t.dy += (outTo.dy || 0) * u; t.s *= 1 + ((outTo.s ?? 1) - 1) * u; t.rot += (outTo.rot || 0) * u; t.alpha *= 1 - u * (1 - (outTo.alpha ?? 1)); }
    }
    return t;
  };
  tf.age = age; tf.at = a => springs(a, o);
  return tf;
}

// Slam: each glyph drops from huge scale, lands with a squash and settles. `hits(age)` gives landing envelopes.
// o: from (scale), fall (s), stagger, mode, squash
export function slam(age, o = {}) {
  const { from = 4, fall = 0.14, stagger = 0.06, mode = 'ltr', squash = 0.28, rot = 0.25, seed = 5, out = null, outDur = 0.2 } = o;
  const r = rng(seed); const rr = Array.from({ length: 64 }, () => r() - 0.5);
  let rank = null;
  const tf = (g, i, n) => {
    rank = rank && rank.length === n ? rank : order(n, mode, seed);
    const a = age - rank[i] * stagger;
    if (a <= 0) return null;
    if (a < fall) { const u = ease.inCubic(a / fall); return { s: lerp(from, 1, u), rot: rr[i % 64] * rot * (1 - u), alpha: clamp(a / fall * 3) }; }
    const b = a - fall, k = Math.exp(-b * 9) * Math.cos(b * 38);
    const t = { sx: 1 + squash * k * 0.8, sy: 1 - squash * k, dy: g.bb.h * squash * k * 0.5 };
    if (out != null && age > out) { const u = ease.inExpo((age - out) / outDur); if (u >= 1) return null; t.sy *= 1 - u; t.sx *= 1 + u * 0.3; }
    return t;
  };
  tf.impact = (n) => { let e = 0; const rk = order(n, mode, seed); for (let i = 0; i < n; i++) { const b = age - rk[i] * stagger - fall; if (b >= 0) e = Math.max(e, Math.exp(-b * 10)); } return e; };
  tf.age = age; tf.at = a => slam(a, o); tf.peak = from;
  return tf;
}

// Combine: jitter a transform per frame (tremor/glitch)
export function jitter(tf, amt, seed) {
  const jt = (g, i, n, w) => { const t = tf ? tf(g, i, n, w) : {}; if (!t) return t; const r = rng(seed * 131 + i * 17);
    return { ...t, dx: (t.dx || 0) + (r() - 0.5) * amt, dy: (t.dy || 0) + (r() - 0.5) * amt * 0.5, rot: (t.rot || 0) + (r() - 0.5) * amt * 0.002 }; };
  if (tf && tf.at) { jt.age = tf.age; jt.at = a => jitter(tf.at(a), amt, seed); }
  return jt;
}
// Offset/override a transform (keeps .at so it still motion-blurs): map(tf, t => ({...t, dx: t.dx + 8}))
export function mapTf(tf, fn) {
  const m = (g, i, n, w) => { const t = tf ? tf(g, i, n, w) : { ...ID }; return t && fn({ ...t }, g, i, n); };
  if (tf && tf.at) { m.age = tf.age; m.at = a => mapTf(tf.at(a), fn); }
  return m;
}

// ---------------------------------------------------------------- looks: (ctx, g) painters in glyph-local space
export const look = {
  fill: color => (ctx, g) => { ctx.fillStyle = color; ctx.fill(g.path); },
  outline: (color, w = 4) => (ctx, g) => { ctx.lineJoin = 'round'; ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke(g.path); },
  // stroke drawn behind the fill (sticker/poster outline)
  stroked: (fill, stroke, w = 12) => (ctx, g) => { ctx.lineJoin = 'round'; ctx.lineWidth = w * 2; ctx.strokeStyle = stroke; ctx.stroke(g.path); ctx.fillStyle = fill; ctx.fill(g.path); },
  // inline: a thin line running inside the letter, parallel to its edge
  inline: (fill, lineCol, gap = 8, th = 4) => (ctx, g) => {
    ctx.fillStyle = fill; ctx.fill(g.path);
    ctx.save(); ctx.clip(g.path); ctx.lineJoin = 'round';
    ctx.lineWidth = 2 * (gap + th); ctx.strokeStyle = lineCol; ctx.stroke(g.path);
    ctx.lineWidth = 2 * gap; ctx.strokeStyle = fill; ctx.stroke(g.path); ctx.restore();
  },
  gradient: (stops, { angle = Math.PI / 2 } = {}) => (ctx, g) => {
    const r = Math.max(g.bb.w, g.bb.h) / 2, cx = Math.cos(angle) * r, cy = Math.sin(angle) * r;
    const gr = ctx.createLinearGradient(-cx, -cy, cx, cy); stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
    ctx.fillStyle = gr; ctx.fill(g.path);
  },
  // solid 2D extrusion: stacked offsets along (ang), side colour darkening to `far`
  extrude: (face, side, far, depth = 40, ang = Math.PI * 0.3, step = 2) => (ctx, g) => {
    const n = Math.ceil(depth / step), ex = Math.cos(ang), ey = Math.sin(ang);
    for (let k = n; k >= 1; k--) {
      ctx.save(); ctx.translate(ex * k * step, ey * k * step); ctx.fillStyle = k === n ? far : mix(side, far, k / n); ctx.fill(g.path); ctx.restore();
    }
    if (typeof face === 'function') face(ctx, g); else { ctx.fillStyle = face; ctx.fill(g.path); }
  },
  // debossed into paper: ink + inner shadow (light from top-left) + a lit lower lip
  letterpress: (ink, { depth = 5, blur = 6, dark = 'rgba(40,0,0,0.75)', light = 'rgba(255,248,235,0.7)' } = {}) => (ctx, g) => {
    ctx.save(); ctx.shadowColor = light; ctx.shadowOffsetX = depth * 0.3; ctx.shadowOffsetY = depth * 0.5; ctx.shadowBlur = 1;
    ctx.fillStyle = ink; ctx.fill(g.path); ctx.restore();
    innerShadow(ctx, g, dark, depth, depth, blur);
    innerShadow(ctx, g, 'rgba(255,255,255,0.18)', -depth * 0.6, -depth * 0.6, blur);
  },
  // raised/embossed: drop shadow + bevel highlight/shade
  emboss: (face, { height = 8, blur = 10 } = {}) => (ctx, g) => {
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowOffsetX = height * 0.8; ctx.shadowOffsetY = height * 1.2; ctx.shadowBlur = blur * 1.5;
    ctx.fillStyle = face; ctx.fill(g.path); ctx.restore();
    innerShadow(ctx, g, 'rgba(255,245,230,0.75)', height * 0.6, height * 0.6, blur * 0.6);
    innerShadow(ctx, g, 'rgba(0,0,0,0.55)', -height * 0.7, -height * 0.7, blur * 0.7);
  },
  // chrome/steel: banded vertical gradient with a horizon line, plus a hard outline
  chrome: ({ top = '#fff8ee', mid = '#8a6f6a', horizon = '#1a0508', low = '#f4c9a0', edge = '#0b0303', w = 3 } = {}) => (ctx, g) => {
    const gr = ctx.createLinearGradient(0, g.bb.y1, 0, g.bb.y2);
    gr.addColorStop(0, top); gr.addColorStop(0.48, mid); gr.addColorStop(0.5, horizon); gr.addColorStop(0.52, '#5a1015'); gr.addColorStop(1, low);
    ctx.fillStyle = gr; ctx.fill(g.path); ctx.lineWidth = w; ctx.strokeStyle = edge; ctx.stroke(g.path);
  },
  // engraved: fill + diagonal hatching that thickens toward the shadow side (banknote/engraving)
  hatch: (fill, ink, { gap = 7, w = 2.2, ang = -0.5, edge = null, edgeW = 3 } = {}) => (ctx, g) => {
    ctx.fillStyle = fill; ctx.fill(g.path);
    ctx.save(); ctx.clip(g.path); ctx.rotate(ang); ctx.strokeStyle = ink;
    const R = Math.hypot(g.bb.w, g.bb.h) / 2 + 4;
    for (let y = -R; y <= R; y += gap) { const u = (y + R) / (2 * R); ctx.lineWidth = w * (0.25 + 1.5 * u * u); ctx.beginPath(); ctx.moveTo(-R, y); ctx.lineTo(R, y); ctx.stroke(); }
    ctx.restore();
    if (edge) { ctx.lineJoin = 'round'; ctx.lineWidth = edgeW; ctx.strokeStyle = edge; ctx.stroke(g.path); }
  },
  // bake any look into a per-glyph sprite once; afterwards each glyph is one drawImage (springs/slams stay cheap).
  // Two-level mip: level 0 at `res`, level 1 at res x peak (pass the transform's peak scale, e.g. slam's
  // `from`, or tf.peak). Level 1 is used whenever the device scale exceeds res x 1.15, so a 4-5x slam
  // stays crisp while the settled glyph draws from the small sprite. Sprites are capped at maxPx a side.
  // Bakes lazily on first draw: call .warm(word) (or prewarm) before sceneReady.
  cache: (paint, { pad = 40, res = 1, peak = 1, maxPx = 4096 } = {}) => {
    const m = new WeakMap(), levels = peak > 1.3 ? [res, res * peak] : [res];
    const bake = (g, r) => {
      const w = g.bb.w + 2 * pad, h = g.bb.h + 2 * pad; r = Math.min(r, maxPx / Math.max(w, h));
      const L = canvas2d(Math.ceil(w * r), Math.ceil(h * r));
      L.g.scale(r, r); L.g.translate(pad - g.bb.x1, pad - g.bb.y1); paint(L.g, g, {});
      L.g.getImageData(0, 0, 1, 1);                       // force the deferred raster now
      return { cv: L.cv, x: g.bb.x1 - pad, y: g.bb.y1 - pad, w, h, r };
    };
    const get = (g, li) => { let e = m.get(g); if (!e) m.set(g, e = []); return e[li] || (e[li] = bake(g, levels[li])); };
    const fn = (ctx, g) => {
      let li = 0;
      if (levels.length > 1) { const M = ctx.getTransform(); if (Math.sqrt(Math.abs(M.a * M.d - M.b * M.c)) > res * 1.15) li = 1; }
      const e = get(g, li);
      ctx.drawImage(e.cv, e.x, e.y, e.w, e.h);
    };
    fn.pad = pad; fn.single = true;
    fn.warm = word => { for (const g of (word.glyphs || word)) levels.forEach((_, li) => get(g, li)); return fn; };
    return fn;
  },
  // knock-out plate: a fat keyline in `color` (w px each side) plus the fill, drawn under outline or
  // window type so it reads over any background at thumbnail size.
  knockout: (color = '#070102', w = 14) => (ctx, g) => { ctx.lineJoin = 'round'; ctx.lineWidth = 2 * w; ctx.strokeStyle = color; ctx.stroke(g.path); ctx.fillStyle = color; ctx.fill(g.path); },
  // keyline: any look over a knock-out plate
  keyline: (paint, color = '#070102', w = 14) => (ctx, g, t) => { look.knockout(color, w)(ctx, g); paint(ctx, g, t); },
  // --- print / material (bake these with look.cache: they are several fills per glyph)
  // misregistration: a second colour plate printed off-register under the look
  misreg: (paint, { color = 'rgba(40,120,160,0.55)', dx = 5, dy = -3 } = {}) => (ctx, g, t) => {
    ctx.save(); ctx.translate(dx, dy); ctx.fillStyle = color; ctx.fill(g.path); ctx.restore(); paint(ctx, g, t);
  },
  // ink spread: squashed ink bleeding past the edge (a rough halo), plus voids where the paper did not take ink
  inkSpread: (ink, { spread = 3, voids = 0.6, seed = 3, halo = 'rgba(120,10,20,0.35)' } = {}) => (ctx, g) => {
    ctx.save(); ctx.lineJoin = 'round';
    ctx.strokeStyle = halo; ctx.lineWidth = spread * 2.6; ctx.stroke(g.path);
    ctx.lineWidth = spread; ctx.strokeStyle = ink; ctx.stroke(g.path);
    ctx.fillStyle = ink; ctx.fill(g.path);
    if (voids > 0) {
      ctx.clip(g.path); const r = rng(seed + g.i * 97), N = Math.round(g.bb.w * g.bb.h / 900 * voids);
      ctx.globalCompositeOperation = 'destination-out';
      for (let k = 0; k < N; k++) { ctx.globalAlpha = 0.15 + r() * 0.5; ctx.beginPath();
        ctx.ellipse(lerp(g.bb.x1, g.bb.x2, r()), lerp(g.bb.y1, g.bb.y2, r()), 0.6 + r() * 2.4, 0.4 + r() * 1.2, r() * 3, 0, 7); ctx.fill(); }
    }
    ctx.restore();
  },
  // compose several looks
  stack: (...ls) => (ctx, g, t) => { for (const l of ls) l(ctx, g, t); },
  // glow behind (lighter blend)
  glow: (color, blur = 30) => (ctx, g) => { ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.fillStyle = color; ctx.fill(g.path); ctx.restore(); },
};
export function innerShadow(ctx, g, color, ox, oy, blur) {
  ctx.save(); ctx.clip(g.path);
  ctx.shadowColor = color; ctx.shadowOffsetX = ox; ctx.shadowOffsetY = oy; ctx.shadowBlur = blur;
  ctx.fillStyle = '#000'; ctx.fill(g.ring, 'evenodd'); ctx.restore();
}
function mix(a, b, u) {
  const p = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
  const A = p(a), B = p(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], u))).join(',')})`;
}

// ---------------------------------------------------------------- layers + masks
// cpuCanvas: scratch layers as software (willReadFrequently) canvases. Under SwiftShader, Chromium's
// "accelerated" 2D canvas is emulated GPU and is far slower for big fills, blurs and compositing.
export const TYPE_OPTS = { cpuCanvas: true };
export function canvas2d(w = W, h = H) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { cv: c, g: c.getContext('2d', { willReadFrequently: TYPE_OPTS.cpuCanvas }) };
}
// Call before kit.outCanvas(): makes the output canvas a software canvas too.
export function cpuOut() { return document.getElementById('out').getContext('2d', { willReadFrequently: true }); }
const layers = [];
export function layer(k = 0) {
  while (layers.length <= k) layers.push(canvas2d());
  const L = layers[k]; L.g.setTransform(1, 0, 0, 1, 0, 0); L.g.globalAlpha = 1; L.g.globalCompositeOperation = 'source-over'; L.g.clearRect(0, 0, W, H);
  return L;
}
// Text as a window: paint is kept only inside the (transformed) glyphs; invert keeps it outside.
// word may be a Word (with tf) or a ready Path2D (wordsPath for several words in one pass).
// paint may be a function (called with ctx, in ctx's current transform) or a canvas/image drawn full-frame
// (e.g. the one shared heat.render() texture). Not inverted = clip and paint straight onto ctx: no
// full-frame layer, no composite (cost = whatever paint costs inside the clip). Inverted = scratch layer k.
export function mask(ctx, word, tf, paint, { invert = false, k = 1, alpha = 1 } = {}) {
  const p = word instanceof Path2D ? word : wordPath(word, tf);
  const run = g => { if (typeof paint === 'function') paint(g); else g.drawImage(paint, 0, 0, W, H); };
  if (!invert) { ctx.save(); ctx.globalAlpha *= alpha; ctx.clip(p); run(ctx); ctx.restore(); return p; }
  const L = layer(k);
  L.g.setTransform(ctx.getTransform()); run(L.g);
  L.g.setTransform(ctx.getTransform()); L.g.globalCompositeOperation = 'destination-out';
  L.g.fillStyle = '#000'; L.g.fill(p);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= alpha; ctx.drawImage(L.cv, 0, 0); ctx.restore();
  return p;
}
// Concentric outline rings around the word (offset contours), outermost first. Returns nothing; draws to ctx.
// word may be a Word (with tf) or a Path2D.
export function rings(ctx, word, tf, { n = 4, gap = 14, th = 4, colors = [C.cream], fill = null, k = 2, alpha = 1 } = {}) {
  const L = layer(k), p = word instanceof Path2D ? word : wordPath(word, tf), g = L.g; g.lineJoin = 'round';
  g.setTransform(ctx.getTransform());
  for (let j = n; j >= 1; j--) {
    g.globalCompositeOperation = 'source-over'; g.lineWidth = 2 * j * gap + th; g.strokeStyle = colors[(j - 1) % colors.length]; g.stroke(p);
    g.globalCompositeOperation = 'destination-out'; g.lineWidth = 2 * j * gap - th; g.stroke(p);
  }
  g.globalCompositeOperation = 'source-over';
  if (fill) { g.fillStyle = fill; g.fill(p); }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= alpha; ctx.drawImage(L.cv, 0, 0); ctx.restore();
}

// ---------------------------------------------------------------- draw-on (stroke reveal)
// u in [0,1] over the whole word; glyphs start staggered (overlap 0..1), all contours of a glyph in parallel.
// Returns tip points [{x, y, g}] (world) for sparks/pens.
export function drawOn(ctx, word, u, { color = C.cream, width = 4, overlap = 0.55, tf = null, tipColor = '#fff', tip = 10, glow = 24, fillFrom = 1.01, fill = null } = {}) {
  const n = word.glyphs.length, tips = [];
  const span = 1 / (1 + (n - 1) * (1 - overlap));
  for (const g of word.glyphs) {
    const a = clamp((u - g.i * span * (1 - overlap)) / span);
    if (a <= 0) continue;
    const t = tf ? tf(g, g.i, n, word) : ID;
    if (!t) continue;
    ctx.save(); applyTf(ctx, g, t);
    if (fill && a >= fillFrom) { ctx.save(); ctx.globalAlpha *= ease.outCubic((a - fillFrom) / (1 - fillFrom + 1e-6)); fill(ctx, g); ctx.restore(); }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = width; ctx.strokeStyle = color;
    const e = ease.inOutCubic(a);
    for (const c of g.contours) {
      const L = c.len * e, pts = c.pts;
      ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
      let j = 1;
      for (; j < c.cum.length && c.cum[j] <= L; j++) ctx.lineTo(pts[2 * j], pts[2 * j + 1]);
      let tx = pts[2 * j - 2], ty = pts[2 * j - 1];
      if (j < c.cum.length) { const f = (L - c.cum[j - 1]) / (c.cum[j] - c.cum[j - 1]); tx = lerp(pts[2 * j - 2], pts[2 * j], f); ty = lerp(pts[2 * j - 1], pts[2 * j + 1], f); ctx.lineTo(tx, ty); }
      ctx.stroke();
      if (a < 1) { const m = ctx.getTransform(); const w = m.transformPoint(new DOMPoint(tx, ty)); tips.push({ x: w.x, y: w.y, g }); }
    }
    ctx.restore();
  }
  if (tip && tips.length) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const p of tips) {
      const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glow);
      gr.addColorStop(0, tipColor); gr.addColorStop(0.25, 'rgba(255,120,60,0.6)'); gr.addColorStop(1, 'rgba(255,40,20,0)');
      ctx.fillStyle = gr; ctx.fillRect(p.x - glow, p.y - glow, glow * 2, glow * 2);
    }
    ctx.restore();
  }
  return tips;
}

// ---------------------------------------------------------------- shatter
// Voronoi-fracture every glyph once, then fly the shards. Everything is baked in the constructor:
// the glyph sprite, one pre-clipped sprite per shard (face, back, side) and the fracture-edge sprites,
// so a draw is only drawImage calls (no clip per shard). Shards that hold no ink are dropped.
// o.thick (px) gives the shards a depth: each shard tumbles about its own in-plane axis, foreshortens,
// shows its side wall (side colour, stepped) and its back (back colour) when it turns over, so the
// pieces read as chunks of plate, not flat paper.
export class Shatter {
  constructor(word, paint, { n = 16, seed = 7, pad = 24, focus = null, focusBias = 0.6, thick = 0, side = '#1a0406', back = null, edge = '#ff6a3a', edgeW = 3 } = {}) {
    this.word = word; this.pieces = []; this.glyph = new Map(); this.opt = { thick, side, back: back || side, edgeW };
    this.edgeCache = new Map();
    const r = rng(seed);
    for (const g of word.glyphs) {
      const bb = g.bb, w = Math.ceil(bb.w + pad * 2), h = Math.ceil(bb.h + pad * 2);
      const S = canvas2d(w, h); S.g.translate(pad - bb.x1, pad - bb.y1); paint(S.g, g, {});
      const polys = [];
      const cnt = Math.max(4, Math.round(n * Math.sqrt(bb.w * bb.h) / word.size));
      const seeds = [];
      for (let k = 0; k < cnt; k++) {
        let x = lerp(bb.x1, bb.x2, r()), y = lerp(bb.y1, bb.y2, r());
        if (focus && r() < focusBias) { const fx = focus.x - g.ox, fy = focus.y - g.oy; const q = r() * r(); x = lerp(fx, x, q + 0.15); y = lerp(fy, y, q + 0.15); }
        seeds.push([x, y]);
      }
      const box = [[bb.x1 - pad, bb.y1 - pad], [bb.x2 + pad, bb.y1 - pad], [bb.x2 + pad, bb.y2 + pad], [bb.x1 - pad, bb.y2 + pad]];
      for (let a = 0; a < seeds.length; a++) {
        let poly = box;
        for (let b = 0; b < seeds.length && poly.length; b++) if (a !== b) poly = clipHalf(poly, seeds[a], seeds[b]);
        const rr = [r(), r(), r(), r(), r(), r()];
        if (poly.length < 3) continue;
        let cx = 0, cy = 0; for (const p of poly) { cx += p[0]; cy += p[1]; } cx /= poly.length; cy /= poly.length;
        const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
        const x1 = Math.floor(Math.min(...xs)) - 2, y1 = Math.floor(Math.min(...ys)) - 2, pw = Math.ceil(Math.max(...xs)) + 2 - x1, ph = Math.ceil(Math.max(...ys)) + 2 - y1;
        const gpath = new Path2D(); poly.forEach((p, k) => k ? gpath.lineTo(p[0], p[1]) : gpath.moveTo(p[0], p[1])); gpath.closePath();
        const F = canvas2d(pw, ph); F.g.translate(-x1, -y1); F.g.save(); F.g.clip(gpath); F.g.drawImage(S.cv, bb.x1 - pad, bb.y1 - pad); F.g.restore();
        const id = F.g.getImageData(0, 0, pw, ph).data; let cov = 0; for (let i = 3; i < id.length; i += 16) cov += id[i];
        cov /= (id.length / 16) * 255;
        if (cov < 0.02) continue;                       // pad-only cell: no ink, never drawn
        const piece = { g, face: F.cv, fx: x1 - cx, fy: y1 - cy, pw, ph, cx, cy, gpath, cov, rad: Math.hypot(pw, ph) / 2,
          r1: rr[0], r2: rr[1], r3: rr[2], r4: rr[3], ax: rr[4] * Math.PI, r6: rr[5] };
        if (thick > 0) { piece.side = tintCanvas(F.cv, this.opt.side); piece.back = tintCanvas(F.cv, this.opt.back, 0.35, F.cv); }
        this.pieces.push(piece);
      }
      this.glyph.set(g, { sp: S.cv, x: bb.x1 - pad, y: bb.y1 - pad, pieces: this.pieces.filter(p => p.g === g) });
    }
    this.edges(edge, edgeW);
  }
  // fracture-edge sprites (per piece, and all cracks per glyph), baked once per colour
  edges(color, w = this.opt.edgeW) {
    if (!color) return null;
    const key = color + '|' + w;
    if (this.edgeCache.has(key)) return this.edgeCache.get(key);
    const per = new Map(), glyph = new Map();
    for (const [g, G] of this.glyph) {
      const C2 = canvas2d(G.sp.width, G.sp.height); C2.g.translate(-G.x, -G.y);
      C2.g.lineWidth = w * 2; C2.g.strokeStyle = color; C2.g.lineJoin = 'round';
      for (const p of G.pieces) {
        C2.g.stroke(p.gpath);
        const E = canvas2d(p.pw, p.ph); E.g.translate(-(p.fx + p.cx), -(p.fy + p.cy));
        E.g.lineWidth = w * 2; E.g.strokeStyle = color; E.g.lineJoin = 'round'; E.g.stroke(p.gpath);
        E.g.setTransform(1, 0, 0, 1, 0, 0); E.g.globalCompositeOperation = 'destination-in'; E.g.drawImage(p.face, 0, 0);
        E.g.getImageData(0, 0, 1, 1); per.set(p, E.cv);
      }
      C2.g.setTransform(1, 0, 0, 1, 0, 0); C2.g.globalCompositeOperation = 'destination-in'; C2.g.drawImage(G.sp, 0, 0);
      C2.g.getImageData(0, 0, 1, 1); glyph.set(g, C2.cv);
    }
    const e = { per, glyph }; this.edgeCache.set(key, e); return e;
  }
  // Force every sprite to raster now (Chromium defers recorded canvas work). colors: extra edge colours.
  warm(colors = []) {
    const c = canvas2d(4, 4);
    for (const G of this.glyph.values()) c.g.drawImage(G.sp, 0, 0, 1, 1);
    for (const p of this.pieces) { c.g.drawImage(p.face, 0, 0, 1, 1); if (p.side) { c.g.drawImage(p.side, 0, 0, 1, 1); c.g.drawImage(p.back, 0, 0, 1, 1); } }
    for (const col of colors) this.edges(col);
    c.g.getImageData(0, 0, 1, 1); return this;
  }
  // pose of one shard `tau` s after the break (negative force + tau counting down = assemble)
  pose(p, tau, t, { origin, force, spin, gravity, drag, fade, z, tumble }) {
    const sc = t.s ?? 1;
    const wx = p.g.ox + (t.dx || 0) + p.cx * sc, wy = p.g.oy + (t.dy || 0) + p.cy * sc;
    let dx = wx - origin.x, dy = wy - origin.y; const d = Math.hypot(dx, dy) + 1e-3; dx /= d; dy /= d;
    const sp = force * (0.45 + p.r1 * 0.9) * (0.5 + 400 / (d + 400));
    const k = (1 - Math.exp(-drag * tau)) / drag;
    return { x: wx + (dx * sp + (p.r3 - 0.5) * force * 0.3) * k, y: wy + (dy * sp + (p.r4 - 0.5) * force * 0.3) * k + 0.5 * gravity * tau * tau,
      rot: (t.rot || 0) + (p.r2 - 0.5) * spin * k * 2, s: sc * (1 + (p.r1 - 0.3) * z * k),
      phi: (p.r6 - 0.5) * spin * k * 2.4 * tumble, a: (t.alpha ?? 1) * (1 - clamp((tau - fade * (0.5 + p.r2 * 0.5)) / 0.4)) };
  }
  // tau: seconds since the break (<=0 = intact, with optional glowing cracks).
  // o: origin {x,y}, force px/s, spin rad/s, gravity px/s^2, drag, edge (colour or null), edgeW, tf, fade, crack 0..1, z,
  //    tumble (0 = flat spin only), shutter n (motion blur, while tau < blurUntil), dir (+1: tau grows with time; -1: assembling)
  draw(ctx, tau, o = {}) {
    const O = { origin: { x: W / 2, y: H / 2 }, force: 1400, spin: 6, gravity: 900, drag: 1.4, edge: null, edgeW: this.opt.edgeW, tf: null, fade: 1.2, crack: 0, z: 0.6,
      tumble: 1, shutter: 0, angle: 0.5, fps: 30, dir: 1, blurUntil: 0.7, ...o };
    const n = this.word.glyphs.length, E = O.edge ? this.edges(O.edge, O.edgeW) : null;
    const tfOf = g => O.tf ? O.tf(g, g.i, n, this.word) : ID;
    if (tau <= 0) {                                       // intact: one sprite per glyph (+ cracks)
      for (const [g, G] of this.glyph) {
        const t = tfOf(g); if (!t) continue;
        ctx.save(); applyTf(ctx, g, t); ctx.drawImage(G.sp, G.x, G.y);
        if (E && O.crack > 0) { ctx.globalAlpha *= clamp(O.crack); ctx.drawImage(E.glyph.get(g), G.x, G.y); }
        ctx.restore();
      }
      return;
    }
    const span = O.angle / O.fps;
    if (O.shutter > 1 && tau < O.blurUntil) {
      const taus = Array.from({ length: O.shutter }, (_, k) => tau - O.dir * span * (1 - k / (O.shutter - 1)));
      const M0 = ctx.getTransform(), box = [1e9, 1e9, -1e9, -1e9], sc = Math.hypot(M0.a, M0.b);
      for (const tk of taus) for (const p of this.pieces) {
        const t = tfOf(p.g); if (!t) continue;
        const q = tk > 0 ? this.pose(p, tk, t, O) : { x: p.g.ox + (t.dx || 0) + p.cx, y: p.g.oy + (t.dy || 0) + p.cy, s: t.s ?? 1 };
        const R = (p.rad * q.s + this.opt.thick) * sc, X = M0.a * q.x + M0.c * q.y + M0.e, Y = M0.b * q.x + M0.d * q.y + M0.f;
        box[0] = Math.min(box[0], X - R); box[1] = Math.min(box[1], Y - R); box[2] = Math.max(box[2], X + R); box[3] = Math.max(box[3], Y + R);
      }
      accumulate(ctx, box, O.shutter, (k, g2) => this.draw(g2, taus[k], { ...o, shutter: 0 }), { res: O.res ?? ((box[2] - box[0]) * (box[3] - box[1]) > W * H * 0.35 ? 0.5 : 1) });
      return;
    }
    const th = this.opt.thick;
    for (const p of this.pieces) {
      const t = tfOf(p.g); if (!t) continue;
      const q = this.pose(p, tau, t, O);
      if (q.a <= 0) continue;
      ctx.save(); ctx.globalAlpha *= q.a; ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.scale(q.s, q.s);
      let img = p.face;
      if (th > 0 && Math.abs(q.phi) > 0.02) {
        const c = Math.cos(q.phi), sn = Math.sin(q.phi);
        ctx.rotate(p.ax); ctx.scale(1, Math.max(0.04, Math.abs(c))); ctx.rotate(-p.ax);
        const off = th * sn / Math.max(0.04, Math.abs(c)), nx = -Math.sin(p.ax) * off, ny = Math.cos(p.ax) * off;
        const steps = Math.min(6, 1 + Math.ceil(Math.abs(th * sn) / 3));
        for (let k = steps; k >= 1; k--) ctx.drawImage(p.side, p.fx + nx * k / steps, p.fy + ny * k / steps);
        if (c < 0) img = p.back;
      }
      ctx.drawImage(img, p.fx, p.fy);
      const e = clamp(1 - tau * 1.5);
      if (E && e > 0 && img === p.face) { ctx.globalAlpha *= e; ctx.drawImage(E.per.get(p), p.fx, p.fy); }
      ctx.restore();
    }
  }
  // Legibility: ink-weighted fraction of shards within tol x glyph height of home, rotated < 15 deg, not turned away.
  readable(tau, o = {}) {
    if (tau <= 0) return 1;
    const O = { origin: { x: W / 2, y: H / 2 }, force: 1400, spin: 6, gravity: 900, drag: 1.4, fade: 1.2, z: 0.6, tumble: 1, tol: 0.15, ...o };
    let ok = 0, all = 0;
    for (const p of this.pieces) {
      const q = this.pose(p, tau, ID, O), hx = p.g.ox + p.cx, hy = p.g.oy + p.cy;
      all += p.cov;
      if (q.a > 0.5 && Math.hypot(q.x - hx, q.y - hy) < O.tol * Math.max(p.g.bb.h, this.word.size * 0.5) && Math.abs(q.rot) < 0.26 && Math.abs(q.phi) < 0.5) ok += p.cov;
    }
    return all ? ok / all : 1;
  }
}
// alpha of `src` filled with `color` (optionally mixed over src at `keep`)
function tintCanvas(src, color, keep = 0, over = null) {
  const T = canvas2d(src.width, src.height);
  T.g.drawImage(src, 0, 0); T.g.globalCompositeOperation = 'source-in'; T.g.fillStyle = color; T.g.fillRect(0, 0, src.width, src.height);
  if (keep && over) { T.g.globalCompositeOperation = 'source-atop'; T.g.globalAlpha = keep; T.g.drawImage(over, 0, 0); }
  return T.cv;
}
function clipHalf(poly, a, b) {           // keep points closer to a than b
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, nx = b[0] - a[0], ny = b[1] - a[1];
  const side = p => (p[0] - mx) * nx + (p[1] - my) * ny;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length], sp = side(P), sq = side(Q);
    if (sp <= 0) out.push(P);
    if ((sp <= 0) !== (sq <= 0)) { const f = sp / (sp - sq); out.push([P[0] + (Q[0] - P[0]) * f, P[1] + (Q[1] - P[1]) * f]); }
  }
  return out;
}

// ---------------------------------------------------------------- 3D extruded type (three.js)
// const T3 = await Type3D.create({ scale: 0.75 });
// const m = T3.word(shape(anton, 'GIANT', {...}), { depth: 120, bevel: 10 });
// per frame: m.glyphs[i].position/rotation..., T3.camera..., T3.draw(ctx)
// World units = pixels at z=0: a glyph placed at its 2D pivot lands exactly where the 2D layout put it.
export class Type3D {
  static async create(o = {}) { const THREE = await import('three'); const t = new Type3D(THREE, o); await t.init(o); return t; }
  constructor(THREE, { scale = 0.75, fov = 30, shadows = false } = {}) {
    this.THREE = THREE; this.scale = scale;
    this.cv = document.createElement('canvas'); this.cv.width = Math.round(W * scale); this.cv.height = Math.round(H * scale);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1); this.renderer.setSize(this.cv.width, this.cv.height, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = shadows; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, W / H, 10, 20000);
    this.dist = (H / 2) / Math.tan(fov * Math.PI / 360);
    this.camera.position.set(0, 0, this.dist);
    this.root = new THREE.Group(); this.scene.add(this.root);
  }
  async init({ env = true, key = 0xfff0e0, rim = 0xff2030, ambient = 0x301010 } = {}) {
    const THREE = this.THREE;
    if (env) {
      const { RoomEnvironment } = await import('../../node_modules/three/examples/jsm/environments/RoomEnvironment.js');
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.55;
    }
    this.scene.add(new THREE.AmbientLight(ambient, 1.2));
    const k = this.key = new THREE.DirectionalLight(key, 3.2); k.position.set(-700, 900, 1400); this.scene.add(k);
    k.castShadow = true; k.shadow.mapSize.set(1024, 1024); Object.assign(k.shadow.camera, { left: -900, right: 900, top: 900, bottom: -900, near: 10, far: 5000 });
    const r = this.rim = new THREE.DirectionalLight(rim, 4); r.position.set(900, -300, -900); this.scene.add(r);
    const f = this.fill = new THREE.PointLight(0xff5020, 2.5, 0, 0); f.position.set(0, -800, 600); this.scene.add(f);
  }
  materials({ face = 0xc91f37, side = 0x5a0a12, metal = 0.55, rough = 0.32 } = {}) {
    const THREE = this.THREE;
    return [new THREE.MeshStandardMaterial({ color: face, metalness: metal, roughness: rough }),
      new THREE.MeshStandardMaterial({ color: side, metalness: Math.min(1, metal + 0.2), roughness: rough + 0.1 })];
  }
  // Word -> Group of glyph meshes positioned at their 2D pivots.
  word(word, { depth = 100, bevel = 8, bevelSeg = 3, curveSeg = 6, mats = null, z = 0 } = {}) {
    const THREE = this.THREE, grp = new THREE.Group(); grp.glyphs = [];
    const M = mats || this.materials();
    for (const g of word.glyphs) {
      const shapes = glyphShapes(THREE, g.cmds);
      const geo = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: bevelSeg, curveSegments: curveSeg });
      geo.translate(0, 0, -depth / 2);
      const mesh = new THREE.Mesh(geo, M); mesh.castShadow = mesh.receiveShadow = true;
      const pivot = new THREE.Group(); pivot.add(mesh);
      pivot.position.set(g.ox - W / 2, -(g.oy - H / 2), z); pivot.home = pivot.position.clone(); pivot.g = g;
      grp.add(pivot); grp.glyphs.push(pivot);
    }
    this.root.add(grp);
    return grp;
  }
  clear() { for (const c of [...this.root.children]) { this.root.remove(c); c.traverse(o => { if (o.geometry) o.geometry.dispose(); }); } }
  draw(ctx, alpha = 1) {
    this.renderer.render(this.scene, this.camera);
    ctx.save(); ctx.globalAlpha *= alpha; ctx.drawImage(this.cv, 0, 0, W, H); ctx.restore();
  }
  // Motion blur: pose(dt) must set the scene for dt seconds relative to now (dt <= 0; everything is
  // deterministic in time). n renders are averaged at the renderer's own resolution, then drawn once.
  // Each sample is a full three.js render (~110 ms at scale 0.75 on the idle box): use n = 2-3 and only while glyphs move.
  drawBlur(ctx, n, pose, { angle = 0.5, fps = 30, alpha = 1 } = {}) {
    if (n < 2) { pose(0); return this.draw(ctx, alpha); }
    const span = angle / fps;
    if (!this.acc) this.acc = canvas2d(this.cv.width, this.cv.height);
    const A = this.acc.g; A.globalCompositeOperation = 'source-over'; A.globalAlpha = 1; A.clearRect(0, 0, this.cv.width, this.cv.height);
    for (let k = 0; k < n; k++) {
      pose(-span * (1 - k / (n - 1))); this.renderer.render(this.scene, this.camera);
      A.globalCompositeOperation = 'lighter'; A.globalAlpha = 1 / n; A.drawImage(this.cv, 0, 0);
    }
    ctx.save(); ctx.globalAlpha *= alpha; ctx.drawImage(this.acc.cv, 0, 0, W, H); ctx.restore();
  }
  // compile shaders + PMREM + one render now, so the first real frame is not a 5-10 s outlier
  warm() { this.renderer.compile(this.scene, this.camera); this.renderer.render(this.scene, this.camera); return this; }
  // Legibility of a word group: fraction of glyph pivots within tol x glyph height of home and rotated < rotTol
  readable(grp, { tol = 0.15, rotTol = 0.26 } = {}) {
    let ok = 0;
    for (const p of grp.glyphs) {
      if (!p.visible) continue;
      const r = Math.max(Math.abs(p.rotation.x), Math.abs(p.rotation.y), Math.abs(p.rotation.z));
      if (p.position.distanceTo(p.home) <= tol * Math.max(p.g.bb.h, 100) && r <= rotTol) ok++;
    }
    return ok / grp.glyphs.length;
  }
}

// Bake every lazy cache before window.sceneReady, so --from renders and full renders start identically
// and no frame pays the 9-14 s warm-up:
//   await prewarm({ looks: [[look, word], ...], shatters: [[sh, ['#ff6a3a']], ...], type3d: [T3], heat: [[heat, {field: ...}], ...],
//                   frames: { render: window.renderFrame, at: [t, t, ...] } })
// frames: render one real frame per segment too. Beyond the explicit caches, the first frame pays ~5 s of
// one-off Chromium/SwiftShader set-up (scratch canvases, patterns, glyph rasters, GL programs); rendering
// throwaway frames here moves that out of the timed/output frames. Safe because renderFrame is pure in t.
export async function prewarm({ looks = [], shatters = [], type3d = [], heat = [], also = null, frames = null } = {}) {
  for (const [l, w] of looks) if (l && l.warm) (Array.isArray(w) ? w : [w]).forEach(x => l.warm(x));
  for (const x of shatters) { const [sh, cols] = Array.isArray(x) ? x : [x, []]; sh.warm(cols); }
  for (const T of type3d) T.warm();
  for (const [h, o] of heat) h.render(0, o);
  if (also) await also();                    // any other lazy bake (e.g. type_sets.finishPlate().warm)
  if (frames) for (const t of frames.at) await frames.render(t);
}
// opentype commands (y down, pivot-centred) -> THREE.Shape[] with holes by winding + containment.
function glyphShapes(THREE, cmds) {
  const polys = []; let cur = null;
  for (const c of cmds) {
    if (c.type === 'M') { cur = { path: new THREE.Path(), pts: [] }; polys.push(cur); cur.path.moveTo(c.x, -c.y); cur.pts.push([c.x, -c.y]); }
    else if (c.type === 'L') { cur.path.lineTo(c.x, -c.y); cur.pts.push([c.x, -c.y]); }
    else if (c.type === 'Q') { cur.path.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y); cur.pts.push([c.x1, -c.y1], [c.x, -c.y]); }
    else if (c.type === 'C') { cur.path.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y); cur.pts.push([c.x1, -c.y1], [c.x2, -c.y2], [c.x, -c.y]); }
  }
  const area = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const inside = (pt, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  polys.forEach(p => { p.a = area(p.pts); });
  const big = polys.reduce((m, p) => Math.abs(p.a) > Math.abs(m.a) ? p : m, polys[0]);
  const sgn = Math.sign(big.a);
  const outers = polys.filter(p => Math.sign(p.a) === sgn), holes = polys.filter(p => Math.sign(p.a) !== sgn);
  const shapes = outers.map(o => { const s = new THREE.Shape(); s.curves = o.path.curves; s.currentPoint = o.path.currentPoint; s.o = o; return s; });
  for (const h of holes) {
    const host = shapes.filter(s => inside(h.pts[0], s.o.pts)).sort((a, b) => Math.abs(a.o.a) - Math.abs(b.o.a))[0];
    if (host) host.holes.push(h.path);
  }
  return shapes;
}
