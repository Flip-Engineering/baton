// ACCELERATE c11: this piece's own diagram pieces, ink on paper like the governor.
//   plateText / flipPlate  the governor's engraved bed plate, re-lettered in place (split-flap): THE MARKET > GOVERNOR > ΚΥΒΕΡΝΗΤΗΣ
//   feedbackLoop           the governor's linkage drawn out into its own closed loop (Maxwell's governors, 1868): sense, compare, act
//   circuits               the loop's rails branching into traces, pads and chips: the steering principle in information form
// The Greek capitals of ΚΥΒΕΡΝΗΤΗΣ (kybernetes, the steersman; Wiener 1948: "governor" is a Latin corruption of it) are K Y B E P N H T H and
// a sigma: the font has no Greek, so the sigma is drawn.
import { W, H, clamp, lerp, smooth, ease, rng } from '../lib/kit.js';

const INK = '#0b0b0b', PAPER = '#f7f7f2', GREY = '#a5a39a', TAU = Math.PI * 2;

function glyph(c, ch, x, y, size) {
  if (ch === 'Σ') {
    const h = size * 0.7, w = size * 0.27, yc = y - size * 0.36;
    c.save(); c.lineWidth = size * 0.12; c.lineJoin = 'miter'; c.lineCap = 'butt'; c.strokeStyle = c.fillStyle;
    c.beginPath(); c.moveTo(x + w, yc - h / 2); c.lineTo(x - w, yc - h / 2); c.lineTo(x + w * 0.1, yc); c.lineTo(x - w, yc + h / 2); c.lineTo(x + w, yc + h / 2); c.stroke(); c.restore();
  } else c.fillText(ch, x, y);
}
// a plate line, letter-spaced (centre x, baseline y), in the engraved mono; opts: pitch (em), alpha
export function plateText(c, str, cx, by, size, o = {}) {
  const pitch = size * (o.pitch ?? 1.2), n = str.length;
  c.save(); c.font = `400 ${size}px "Plex Mono"`; c.textAlign = 'center'; c.fillStyle = o.color ?? PAPER; c.globalAlpha *= o.alpha ?? 1;
  for (let i = 0; i < n; i++) if (str[i] !== ' ') glyph(c, str[i], cx + (i - (n - 1) / 2) * pitch, by, size);
  c.restore();
}
// split-flap re-lettering: each letter folds shut and opens as the next, staggered left to right. u 0..1
export function flipPlate(c, from, to, u, cx, by, size, o = {}) {
  const n = Math.max(from.length, to.length), a = from.padEnd(n), b = to.padEnd(n), pitch = size * (o.pitch ?? 1.2);
  c.save(); c.font = `400 ${size}px "Plex Mono"`; c.textAlign = 'center'; c.fillStyle = o.color ?? PAPER;
  for (let i = 0; i < n; i++) {
    const x = cx + (i - (n - 1) / 2) * pitch, k = clamp(u * (1 + 0.5) - (i / n) * 0.5), ch = k < 0.5 ? a[i] : b[i];
    const sy = Math.abs(Math.cos(Math.PI * k));
    if (ch === ' ') continue;
    c.save(); c.translate(x, by - size * 0.33); c.scale(1, Math.max(0.04, sy)); c.translate(-x, -(by - size * 0.33)); glyph(c, ch, x, by, size); c.restore();
  }
  c.restore();
}

// ---------------------------------------------------------------- the loop
// path: a polyline [x,y]... with rounded corners (radius r). Returns {p: Path2D, len}
function roundedPath(pts, r) {
  const p = new Path2D(); let len = 0;
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) { p.arcTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r); }
  p.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return { p, len, pts };
}
function atLen(pts, L) {
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (L <= d || i === pts.length - 1) { const u = clamp(L / d); return [lerp(pts[i - 1][0], pts[i][0], u), lerp(pts[i - 1][1], pts[i][1], u), Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0])]; } L -= d; }
  return pts[pts.length - 1];
}
function label(c, text, x, y, o = {}) {
  c.save(); c.font = `400 ${o.size ?? 27}px "Plex Mono"`; c.textAlign = o.align ?? 'center'; c.lineJoin = 'round';
  c.strokeStyle = PAPER; c.lineWidth = 9; c.strokeText(text, x, y); c.fillStyle = INK; c.fillText(text, x, y); c.restore();
}
// gx, gy, gs: the governor's anchor and scale (the loop attaches to its spindle top and its throttle valve).
// u: draw-on 0..1; t: seconds (the signal pulses run at one steady speed: no hunting). rails 1..4.
export function feedbackLoop(c, gx, gy, gs, u, t, o = {}) {
  const X = (x, y) => [gx + x * gs, gy - y * gs];
  const sensor = X(0, 52.5), valve = X(-36, -35), L = o.L ?? 70, R = o.R ?? 1010, T = o.T ?? 250, Bm = o.B ?? 1620;
  const cmp = [540, T];
  // sensor -> comparator -> clockwise round the screen -> the valve
  const pts = [sensor, [sensor[0], T + 40], cmp, [R, T], [R, Bm], [L, Bm], [L, valve[1]], valve];
  const { p, len } = roundedPath(pts, 60);
  const drawn = len * ease.inOutCubic(clamp(u));
  c.save(); c.lineCap = 'butt'; c.lineJoin = 'round';
  // rails: ink bars, a paper core, signal packets travelling at one steady speed
  c.setLineDash([drawn, len * 2]); c.strokeStyle = INK; c.lineWidth = 15; c.stroke(p);
  c.strokeStyle = PAPER; c.lineWidth = 3; c.stroke(p);
  c.setLineDash([]);
  if (u > 0.98) {
    const sp = 260, nP = 14;
    for (let k = 0; k < nP; k++) { const L0 = ((k * len / nP + t * sp) % len), [x, y, a] = atLen(pts, L0);
      c.save(); c.translate(x, y); c.rotate(a); c.fillStyle = PAPER; c.fillRect(-14, -3.5, 22, 7); c.fillStyle = INK; c.beginPath(); c.moveTo(18, 0); c.lineTo(8, -9); c.lineTo(8, 9); c.closePath(); c.fill(); c.restore(); }
  }
  // nodes: the comparator (a circle with a plus and a minus), arriving as the line reaches it
  const upC = smooth(0.16, 0.3, u);
  if (upC > 0) { c.save(); c.globalAlpha = upC; c.translate(cmp[0], cmp[1]); c.fillStyle = INK; c.beginPath(); c.arc(0, 0, 54, 0, TAU); c.fill();
    c.strokeStyle = PAPER; c.lineWidth = 7; c.beginPath(); c.moveTo(-26, 0); c.lineTo(26, 0); c.moveTo(0, -26); c.lineTo(0, 26); c.stroke();
    c.lineWidth = 3; c.beginPath(); c.arc(0, 0, 44, 0, TAU); c.stroke(); c.restore(); }
  if (o.labels !== false) {
    c.save(); c.globalAlpha = smooth(0.35, 0.6, u) * (o.labelAlpha ?? 1);
    label(c, 'MEASURE', sensor[0] + 120, (sensor[1] + T) / 2 + 40, { align: 'left' });
    label(c, 'COMPARE', cmp[0], cmp[1] - 78);
    label(c, 'ACT', valve[0] - 30, valve[1] + 76, { align: 'right' });
    c.restore();
  }
  c.restore();
  return { len, pts };
}

// ---------------------------------------------------------------- circuits
// traces grow from the rails of the loop; seeded, so the same board every frame. m 0..1 (growth), t seconds.
const TR = (() => {
  const r = rng(404), a = [], L = 70, R = 1010, T = 250, Bm = 1620;
  const starts = [];
  for (let i = 0; i < 26; i++) { const k = r(); starts.push(k < 0.25 ? [L, lerp(T, Bm, r()), 1, 0] : k < 0.5 ? [R, lerp(T, Bm, r()), -1, 0] : k < 0.75 ? [lerp(L, R, r()), T, 0, 1] : [lerp(L, R, r()), Bm, 0, -1]); }
  for (let i = 0; i < 64; i++) {
    const s = starts[i % starts.length], inward = r() < 0.55 ? 1 : -1;
    let dx = s[2] * inward, dy = s[3] * inward; if (dx === 0 && dy === 0) dx = 1;
    // inward = away from the rail towards the centre of the screen (the traces fill the loop and spill out of it)
    let x = s[0] + (s[2] === 0 ? 0 : 0), y = s[1];
    const pts = [[x, y]];
    const nSeg = 2 + Math.floor(r() * 3);
    for (let k = 0; k < nSeg; k++) {
      const len = 70 + r() * 260; x += dx * len; y += dy * len; pts.push([x, y]);
      const turn = r() < 0.5 ? 1 : -1, ndx = -dy * turn, ndy = dx * turn;
      if (r() < 0.4) { x += (dx + ndx) * 40; y += (dy + ndy) * 40; pts.push([x, y]); }   // a 45 degree chamfer
      dx = ndx; dy = ndy;
    }
    a.push({ pts, w: 4 + Math.floor(r() * 3) * 1.5, delay: r() * 0.55, pad: r() < 0.7, chip: r() < 0.22 });
  }
  return a;
})();
export function circuits(c, m, t, o = {}) {
  c.save(); c.lineCap = 'butt'; c.lineJoin = 'miter';
  for (const tr of TR) {
    const g = clamp((m - tr.delay) / 0.45); if (g <= 0) continue;
    const p = new Path2D(); let len = 0; p.moveTo(...tr.pts[0]);
    for (let i = 1; i < tr.pts.length; i++) { p.lineTo(...tr.pts[i]); len += Math.hypot(tr.pts[i][0] - tr.pts[i - 1][0], tr.pts[i][1] - tr.pts[i - 1][1]); }
    const dl = len * ease.outCubic(g);
    c.setLineDash([dl, len * 2]); c.strokeStyle = INK; c.lineWidth = tr.w; c.stroke(p);
    c.setLineDash([]);
    const e = atLen(tr.pts, dl);
    if (g > 0.98 && tr.pad) { c.fillStyle = PAPER; c.strokeStyle = INK; c.lineWidth = 5; c.beginPath(); c.arc(e[0], e[1], 11, 0, TAU); c.fill(); c.stroke(); }
    if (g > 0.98 && tr.chip) { c.save(); c.translate(e[0], e[1]); c.rotate(Math.round(e[2] / (Math.PI / 2)) * Math.PI / 2); c.fillStyle = INK; c.fillRect(-46, -30, 92, 60);
      c.strokeStyle = INK; c.lineWidth = 3; for (let k = -3; k <= 3; k++) { c.beginPath(); c.moveTo(k * 12, -42); c.lineTo(k * 12, 42); c.stroke(); }
      c.fillStyle = PAPER; c.beginPath(); c.arc(-34, -18, 4, 0, TAU); c.fill(); c.restore(); }
    // a signal running along the finished trace
    if (g > 0.98) { const L0 = (t * 180 + tr.delay * 900) % (len * 1.4); if (L0 < len) { const q = atLen(tr.pts, L0); c.fillStyle = PAPER; c.fillRect(q[0] - 7, q[1] - 2, 14, 4); } }
  }
  c.restore();
}
