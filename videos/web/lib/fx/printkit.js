// PRINTKIT: hard-edged change and depth for print-style pictures (STUDIO CIV ASSETS c1, 1 Oct).
//
// A press cannot print a blur, a glow or a 30% fade; run through a screen, each of those becomes grey haze (CIVILIZATION
// v10: radial-gradient clouds read as dirt on the lens, mills faded to ghosts, a smear over a whole shot). Print has its
// own language for the same jobs, and this kit draws it as plain Path2D / canvas operations, so it works on any 2D
// context: a plate of lib/fx/plates.js, the plates router (P.tone), or an ordinary canvas.
//
//   depth:      bandCloud (WPA / Hokusai cloud bands: flat lobes, a flat base, a ruled shade band), smoke (hard puffs,
//               shaded crescent, no gradient), sunburst (flat disc + ray wedges), lineTint (a ruled tint inside a shape),
//               stipple (a held dot field inside a shape), offsetPlate (depth by misregistering one plate: Spider-Verse)
//   change:     wipe / iris / blinds / sawWipe (clip paths that reveal), lineOut / dotOut (a shape leaves by being cut into
//               thinning lines or shrinking dots, the print way to fade), registerIn (plate offsets that converge on a hit),
//               steps (quantise a 0..1 fade into a few hard steps for anything that must still fade)
//
// Usage: every function takes the context to draw into and uses its current fillStyle / strokeStyle unless a colour is
// given, so the same call draws into a plate (P.plate('black'), fillStyle = P.cov(1)) or the router (fillStyle = ink(BLK)).
import { W, H } from '../kit.js';

const TAU = Math.PI * 2;
export function rngK(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// ---------------------------------------------------------------- tints inside shapes
// ruled lines inside `path` (Path2D, or null = the whole frame). weight: line width as a fraction of the pitch (0..1)
export function lineTint(g, path, { pitch = 12, angle = 45, weight = 0.35, style = null, rule = 'nonzero', box = [0, 0, W, H] } = {}) {
  const a = angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), [x0, y0, x1, y1] = box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, d = Math.hypot(x1 - x0, y1 - y0) / 2 + pitch;
  g.save(); if (path) g.clip(path, rule); if (style) g.strokeStyle = style; g.lineWidth = Math.max(0.6, pitch * weight); g.lineCap = 'butt'; g.beginPath();
  for (let s = -d; s <= d; s += pitch) { g.moveTo(cx - ca * d - sa * s, cy - sa * d + ca * s); g.lineTo(cx + ca * d - sa * s, cy + sa * d + ca * s); }
  g.stroke(); g.restore();
}
// a held dot field (Ben-Day) inside `path`: dots of radius r on a grid at `pitch`, rotated by angle
export function dotTint(g, path, { pitch = 18, r = 5, angle = 15, style = null, rule = 'nonzero', box = [0, 0, W, H] } = {}) {
  const a = angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), [x0, y0, x1, y1] = box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, d = Math.hypot(x1 - x0, y1 - y0) / 2 + pitch;
  const p = new Path2D();
  for (let v = -d; v <= d; v += pitch) for (let u = -d; u <= d; u += pitch) { const x = cx + u * ca - v * sa, y = cy + u * sa + v * ca; if (x < x0 - r || x > x1 + r || y < y0 - r || y > y1 + r) continue; p.moveTo(x + r, y); p.arc(x, y, r, 0, TAU); }
  g.save(); if (path) g.clip(path, rule); if (style) g.fillStyle = style; g.fill(p); g.restore();
}
// a stipple inside `path`: n jittered dots per 100x100 px, fixed by seed (held: never re-rolled per frame)
export function stipple(g, path, { density = 30, r = 2.2, seed = 1, style = null, box = [0, 0, W, H] } = {}) {
  const R = rngK(seed), [x0, y0, x1, y1] = box, n = Math.round((x1 - x0) * (y1 - y0) / 10000 * density), p = new Path2D();
  for (let i = 0; i < n; i++) { const x = x0 + R() * (x1 - x0), y = y0 + R() * (y1 - y0); p.moveTo(x + r, y); p.arc(x, y, r * (0.7 + 0.6 * R()), 0, TAU); }
  g.save(); if (path) g.clip(path); if (style) g.fillStyle = style; g.fill(p); g.restore();
}

// ---------------------------------------------------------------- depth
// A WPA / Hokusai cloud: overlapping flat lobes on a flat base. Returns { body, shade, base } (Path2D, Path2D, y):
// fill `body` in the light ink, then lineTint / fill `shade` (the band under the lobes' bellies) in the dark one.
// x, y: centre of the base; w: width; h: height of the tallest lobe. drift moves it without re-rolling its shape.
export function bandCloud(x, y, w, h, { seed = 1, lobes = 5, shade = 0.34, flat = true } = {}) {
  const R = rngK(seed), body = new Path2D(), sh = new Path2D(), L = [];
  for (let i = 0; i < lobes; i++) {
    const u = (i + 0.5) / lobes, bell = Math.sin(Math.PI * u) ** 0.7;   // tallest in the middle
    const r = (w / lobes) * (0.62 + 0.4 * R()) * (0.75 + 0.5 * bell), cx = x - w / 2 + u * w + (R() - 0.5) * w / lobes * 0.4;
    const cy = y - Math.max(r * 0.55, h * bell * (0.55 + 0.25 * R()) - r * 0.2);
    L.push([cx, cy, r]);
  }
  // body: the lobes, cut flat at the base
  const clipB = new Path2D(); clipB.rect(x - w, y - h * 3, w * 2, h * 3);
  for (const [cx, cy, r] of L) { body.moveTo(cx + r, cy); body.arc(cx, cy, r, 0, TAU); }
  body.rect(L[0][0], Math.min(...L.map(l => l[1])), L.at(-1)[0] - L[0][0], y - Math.min(...L.map(l => l[1])));
  // shade: a band along the base whose top follows the lobes (a lower copy of each lobe's belly)
  const sy = y - h * shade;
  sh.moveTo(x - w, y); for (const [cx, cy, r] of L) { sh.moveTo(cx + r * 0.95, sy + (cy - sy) * 0.15 + r * 0.25); sh.arc(cx, sy + (cy - sy) * 0.15 + r * 0.25, r * 0.95, 0, TAU); }
  return { body, shade: sh, base: y, clip: flat ? clipB : null, lobes: L,
    // draw: keyline first (wide, so only its outer half survives), then the light body over it, then the shade.
    // light: a fill style, or a function(path) that knocks the body to paper (plates: p => P.knock(p))
    draw(g, { light = null, dark = null, lines = null, key = null, keyW = 2.5 } = {}) {
      g.save(); if (this.clip) g.clip(this.clip);
      if (key) { g.strokeStyle = key; g.lineWidth = keyW * 2; for (const [cx, cy, r] of this.lobes) { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke(); } }
      if (typeof light === 'function') light(body); else if (light) { g.fillStyle = light; g.fill(body); }
      if (dark) { g.save(); g.clip(body); if (lines) lineTint(g, this.shade, { ...lines, style: dark }); else { g.fillStyle = dark; g.fill(this.shade); } g.restore(); }
      g.restore();
    } };
}
// smoke from a stack: hard puffs growing along a drift, each with a shaded crescent on its lee side; t loops
// draw: as bandCloud (keyline first, then the light puffs, then the shade crescents). Returns { puffs, shade, circles, draw }
export function smoke(x, y, t, { n = 7, rise = 360, drift = 160, r0 = 10, r1 = 54, seed = 3, speed = 0.45 } = {}) {
  const R = rngK(seed), puffs = new Path2D(), shade = new Path2D(), circles = [];
  for (let i = 0; i < n; i++) { const q = ((t * speed + i / n) % 1 + 1) % 1, j = R();
    const px = x + q * drift + Math.sin(q * 5 + j * 6) * 12, py = y - q * rise, r = r0 + (r1 - r0) * Math.sqrt(q);
    puffs.moveTo(px + r, py); puffs.arc(px, py, r, 0, TAU); circles.push([px, py, r]);
    // the shade: a crescent on the lee side (the puff minus a copy shifted toward the light, counter-wound)
    shade.moveTo(px + r, py); shade.arc(px, py, r, 0, TAU); shade.moveTo(px - r * 0.32 + r * 0.92, py - r * 0.4); shade.arc(px - r * 0.32, py - r * 0.4, r * 0.92, 0, TAU, true); }
  return { puffs, shade, circles, draw(g, { light = null, dark = null, key = null, keyW = 2.5, lines = null } = {}) {
    if (key) { g.save(); g.strokeStyle = key; g.lineWidth = keyW * 2; for (const [cx, cy, r] of circles) { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke(); } g.restore(); }
    if (typeof light === 'function') light(puffs); else if (light) { g.save(); g.fillStyle = light; g.fill(puffs); g.restore(); }
    if (dark) { g.save(); g.clip(puffs); if (lines) lineTint(g, shade, { ...lines, style: dark }); else { g.fillStyle = dark; g.fill(shade); } g.restore(); } } };
}
// a sun: flat disc and `rays` alternate wedges between r0 and r1 (rotate by `turn` radians); returns { disc, rays }
export function sunburst(x, y, r, { rays = 24, r0 = 1.25, r1 = 9, turn = 0 } = {}) {
  const disc = new Path2D(); disc.arc(x, y, r, 0, TAU);
  const ry = new Path2D(), da = TAU / rays / 2;
  for (let k = 0; k < rays; k++) { const a = turn + k * TAU / rays; ry.moveTo(x + Math.cos(a) * r * r0, y + Math.sin(a) * r * r0);
    ry.lineTo(x + Math.cos(a) * r * r1, y + Math.sin(a) * r * r1); ry.lineTo(x + Math.cos(a + da) * r * r1, y + Math.sin(a + da) * r * r1);
    ry.lineTo(x + Math.cos(a + da) * r * r0, y + Math.sin(a + da) * r * r0); ry.closePath(); }
  return { disc, rays: ry };
}

// ---------------------------------------------------------------- change: reveals and exits (clip paths)
// a straight wipe: the revealed side of a line at angle `angle` (deg) that has travelled p (0..1) across the frame
export function wipe(p, { angle = 0, edge = 'straight', teeth = 14, amp = 40, box = [0, 0, W, H] } = {}) {
  const a = angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), [x0, y0, x1, y1] = box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const d = Math.hypot(x1 - x0, y1 - y0) / 2 + amp, s = -d + 2 * d * p, path = new Path2D(), n = edge === 'straight' ? 1 : teeth * 2;
  const P = (u, v) => [cx + u * ca - v * sa, cy + u * sa + v * ca];
  path.moveTo(...P(-d - amp, -d));
  for (let i = 0; i <= n; i++) { const v = -d + 2 * d * i / n, off = edge === 'saw' ? (i % 2 ? amp : 0) : edge === 'step' ? (Math.floor(i / 2) % 2 ? amp : 0) : 0; path.lineTo(...P(s + off, v)); }
  path.lineTo(...P(-d - amp, d)); path.closePath();
  return path;
}
export const sawWipe = (p, o = {}) => wipe(p, { edge: 'saw', ...o });
export function iris(x, y, r) { const p = new Path2D(); p.arc(x, y, Math.max(0, r), 0, TAU); return p; }
// venetian blinds: n bands at `angle`, each open by p (0..1)
export function blinds(p, { n = 12, angle = 0, box = [0, 0, W, H] } = {}) {
  const a = angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), [x0, y0, x1, y1] = box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, d = Math.hypot(x1 - x0, y1 - y0) / 2;
  const path = new Path2D(), bw = 2 * d / n;
  for (let i = 0; i < n; i++) { const v0 = -d + i * bw, v1 = v0 + bw * Math.max(0, Math.min(1, p));
    const q = [[-d, v0], [d, v0], [d, v1], [-d, v1]].map(([u, v]) => [cx + u * ca - v * sa, cy + u * sa + v * ca]);
    path.moveTo(...q[0]); for (const k of q.slice(1)) path.lineTo(...k); path.closePath(); }
  return path;
}
// a shape that must leave: cut it into lines that thin as p goes 0 -> 1 (it is gone at 1). The print way to fade.
export function lineOut(g, path, p, { pitch = 10, angle = 0, style = null, rule = 'nonzero' } = {}) {
  if (p >= 1) return; if (p <= 0) { g.save(); if (style) g.fillStyle = style; g.fill(path, rule); g.restore(); return; }
  g.save(); g.clip(path, rule); lineTint(g, null, { pitch, angle, weight: 1 - p, style: style || g.fillStyle }); g.restore();
}
export function dotOut(g, path, p, { pitch = 14, angle = 15, style = null } = {}) {
  if (p >= 1) return; const r = pitch * 0.72 * Math.sqrt(1 - p);
  g.save(); g.clip(path); dotTint(g, null, { pitch, r, angle, style: style || g.fillStyle }); g.restore();
}
// plate offsets for lib/fx/plates.js print({ offsets }): the plates fly in from `far` px and register on p = 1
export function registerIn(p, { far = 60, seed = 2 } = {}) {
  const R = rngK(seed), k = Math.pow(1 - Math.max(0, Math.min(1, p)), 2);
  return [0, 1, 2].map(() => { const a = R() * TAU; return [Math.cos(a) * far * k, Math.sin(a) * far * k]; });
}
// depth by misregistration: a constant offset for one plate (what Spider-Verse used instead of defocus): the further
// from the focal plane, the further the plate slips. Returns offsets for print({ offsets }).
export function offsetPlate(depth, { ink = 1, dir = [1, -0.6], px = 10 } = {}) {
  const o = [[0, 0], [0, 0], [0, 0]]; o[ink] = [dir[0] * depth * px, dir[1] * depth * px]; return o;
}
// anything that must still fade: quantise to n hard steps (a fade a printer can pull as n separate runs)
export const steps = (v, n = 3) => Math.round(Math.max(0, Math.min(1, v)) * n) / n;
