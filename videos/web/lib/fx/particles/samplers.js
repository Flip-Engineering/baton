// particles/samplers: point sets (CPU, build time). A PointSet is { n, pos: Float32Array(n*4) [x,y,z,key],
// col: Uint8Array(n*4) }. The canvas samplers importance-sample pixels (alpha x luma weights, optional edge boost),
// so text, PNGs, SVG paths and silhouettes all go through one routine (samplePixels).
// Cached: samplePixels by a hash of the pixels + options, sampleVolume by its arguments, matchTo by the positions of
// both sets (it stores the permutation only, so colours set later by recolor() are kept). Call
// `await pcache.load(sceneName)` before building and `await pcache.save()` after to keep them on disk.
import { W, H, clamp, rng } from '../../kit.js';
import { pcache, hashBytes, stableKey } from './core.js';

const _sc = document.createElement('canvas'); _sc.width = W; _sc.height = H;
const _sg = _sc.getContext('2d', { willReadFrequently: true });
const clonePS = r => ({ n: r.n, pos: new Float32Array(r.pos), col: new Uint8Array(r.col) });

export function sampleCanvas(draw, n, o = {}) {
  _sg.setTransform(1, 0, 0, 1, 0, 0); _sg.clearRect(0, 0, W, H); _sg.globalAlpha = 1; _sg.globalCompositeOperation = 'source-over';
  draw(_sg);
  const img = _sg.getImageData(0, 0, W, H).data;
  return samplePixels(img, W, H, n, o);
}
export function samplePixels(img, w, h, n, o = {}) {
  const key = 'px:' + hashBytes(img) + ':' + stableKey([w, h, n, o]);
  const hit = pcache.get(key); if (hit) return clonePS(hit);
  return clonePS(pcache.set(key, samplePixelsRaw(img, w, h, n, o)));
}
function samplePixelsRaw(img, w, h, n, { seed = 1, edge = 0, z = 0, zJitter = 0, color = null, weight = 'alpha', order = 'morton', threshold = 0.08, scaleX = 1, scaleY = 1, zFrom = null, flipY = false } = {}) {
  const N = w * h, wt = new Float32Array(N);
  const A = i => weight === 'luma' ? (img[i * 4] * 0.3 + img[i * 4 + 1] * 0.5 + img[i * 4 + 2] * 0.2) / 255 : img[i * 4 + 3] / 255;
  for (let i = 0; i < N; i++) { const a = A(i); wt[i] = a > threshold ? a : 0; }
  if (edge > 0) {           // boost pixels whose neighbourhood changes: crisp outlines read better as points
    const e = new Float32Array(N);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x; if (!wt[i]) continue;
      e[i] = Math.abs(wt[i - 1] - wt[i + 1]) + Math.abs(wt[i - w] - wt[i + w]) + Math.abs(wt[i - 3 < 0 ? i : i - 3] - wt[i]) * 0.5;
    }
    for (let i = 0; i < N; i++) wt[i] = wt[i] * (1 + edge * 6 * Math.min(1, e[i]));
  }
  const cdf = new Float64Array(N); let s = 0;
  for (let i = 0; i < N; i++) { s += wt[i]; cdf[i] = s; }
  const r = rng(seed * 7919 + 13), pos = new Float32Array(n * 4), col = new Uint8Array(n * 4);
  if (s <= 0) throw new Error('sample: empty source');
  for (let k = 0; k < n; k++) {
    const v = r() * s; let lo = 0, hi = N - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < v) lo = m + 1; else hi = m; }
    const x = lo % w, y = (lo / w) | 0, yy = flipY ? h - 1 - y : y;
    pos[k * 4] = (x + r()) * scaleX; pos[k * 4 + 1] = (yy + r()) * scaleY;
    pos[k * 4 + 2] = (zFrom ? zFrom(img, lo) : z) + (r() - 0.5) * zJitter; pos[k * 4 + 3] = r();
    if (color) { col[k * 4] = color[0]; col[k * 4 + 1] = color[1]; col[k * 4 + 2] = color[2]; col[k * 4 + 3] = 255; }
    else { col[k * 4] = img[lo * 4]; col[k * 4 + 1] = img[lo * 4 + 1]; col[k * 4 + 2] = img[lo * 4 + 2]; col[k * 4 + 3] = 255; }
  }
  return reorder({ n, pos, col }, order, seed);
}
// Text as points. o: {family, size, x, y, lineGap, maxW, weight, fill}; lines = string or array.
export function sampleText(lines, n, o = {}) {
  const { family = 'Anton', size = 400, x = W / 2, y = H / 2, lineGap = 0.95, maxW = W - 80, weight = '', ...rest } = o;
  const L = Array.isArray(lines) ? lines : [lines];
  return sampleCanvas(g => {
    g.fillStyle = rest.fill || '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    L.forEach((ln, i) => {
      let s = Array.isArray(size) ? size[i] : size; g.font = `${weight} ${s}px "${family}"`;
      while (g.measureText(ln).width > maxW && s > 20) { s -= 4; g.font = `${weight} ${s}px "${family}"`; }
      const tot = L.length, sz0 = Array.isArray(size) ? size[0] : size;
      g.fillText(ln, x, y + (i - (tot - 1) / 2) * sz0 * lineGap);
    });
  }, n, { color: rest.color || [255, 255, 255], ...rest });
}
// Image (PNG with alpha, or a silhouette photo with weight 'luma') fitted into a box. Colours come from the image.
export function sampleImage(img, n, o = {}) {
  const { x = W / 2, y = H / 2, w = 800, h = null, invert = false, ...rest } = o;
  const hh = h || img.height * w / img.width;
  return sampleCanvas(g => {
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    if (invert) { g.fillStyle = '#fff'; g.fillRect(x - w / 2, y - hh / 2, w, hh); g.globalCompositeOperation = 'destination-out'; }
    g.drawImage(img, x - w / 2, y - hh / 2, w, hh);
  }, n, rest);
}
// SVG path data (string or Path2D) in its own units, placed with a transform [a,b,c,d,e,f]. stroke: px width for outlines.
export function samplePath(d, n, o = {}) {
  const { transform = [1, 0, 0, 1, 0, 0], stroke = 0, ...rest } = o;
  const p = typeof d === 'string' ? new Path2D(d) : d;
  return sampleCanvas(g => { g.setTransform(...transform); g.fillStyle = g.strokeStyle = '#fff';
    if (stroke) { g.lineWidth = stroke; g.lineJoin = 'round'; g.stroke(p); } else g.fill(p); }, n, { color: rest.color || [255, 255, 255], ...rest });
}
// Procedural volumes. kind: 'sphere' (shell), 'ball', 'disc', 'box', 'ring', 'galaxy'.
export function sampleVolume(kind, n, o = {}) {
  const key = 'vol:' + stableKey([kind, n, o]);
  const hit = pcache.get(key); if (hit) return clonePS(hit);
  return clonePS(pcache.set(key, sampleVolumeRaw(kind, n, o)));
}
function sampleVolumeRaw(kind, n, o) {
  const { x = W / 2, y = H / 2, z = 0, r = 500, rz = null, seed = 3, color = [255, 255, 255], order = 'random', arms = 3, w = W, h = H, d = 600 } = o;
  const R = rng(seed), pos = new Float32Array(n * 4), col = new Uint8Array(n * 4);
  for (let k = 0; k < n; k++) {
    let px, py, pz;
    if (kind === 'box') { px = x + (R() - 0.5) * w; py = y + (R() - 0.5) * h; pz = z + (R() - 0.5) * d; }
    else if (kind === 'disc' || kind === 'ring') {
      const a = R() * Math.PI * 2, rr = kind === 'ring' ? r * (0.85 + 0.15 * R()) : r * Math.sqrt(R());
      px = x + Math.cos(a) * rr; py = y + Math.sin(a) * rr; pz = z + (R() - 0.5) * (rz ?? 40);
    } else if (kind === 'galaxy') {
      const arm = Math.floor(R() * arms), t = Math.pow(R(), 0.6), a = arm / arms * Math.PI * 2 + t * 5.5 + (R() - 0.5) * 0.5 * (1 - t * 0.5);
      const rr = r * t; px = x + Math.cos(a) * rr + (R() - 0.5) * 40; py = y + Math.sin(a) * rr * 0.9 + (R() - 0.5) * 40; pz = z + (R() - 0.5) * (rz ?? 120) * (1 - t);
    } else {
      const u = R() * 2 - 1, a = R() * Math.PI * 2, s = Math.sqrt(1 - u * u), rr = kind === 'ball' ? r * Math.cbrt(R()) : r;
      px = x + Math.cos(a) * s * rr; py = y + Math.sin(a) * s * rr; pz = z + u * (rz ?? r);
    }
    pos.set([px, py, pz, R()], k * 4); col.set([color[0], color[1], color[2], 255], k * 4);
  }
  return reorder({ n, pos, col }, order, seed);
}
// Stable orderings. Particle i of shape A flies to point i of shape B, so ordering both shapes the same way
// ('morton', 'x', 'y', 'angle', 'radius') keeps the morph coherent; 'random' makes it a crossing swarm.
export function reorder(ps, order, seed = 1) {
  const { n, pos, col } = ps; if (order === 'none') return ps;
  const key = new Float64Array(n), idx = new Uint32Array(n);
  const R = rng(seed * 31 + 7);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 4], y = pos[i * 4 + 1]; idx[i] = i;
    key[i] = order === 'x' ? x + y * 1e-4 : order === 'y' ? y + x * 1e-4 : order === 'angle' ? Math.atan2(y - H / 2, x - W / 2) :
      order === 'radius' ? Math.hypot(x - W / 2, y - H / 2) : order === 'morton' ? morton(x, y) : R();
  }
  idx.sort((a, b) => key[a] - key[b]);
  return permute(ps, idx);
}
function permute({ n, pos, col }, idx) {
  const p2 = new Float32Array(n * 4), c2 = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { const j = idx[i]; p2.set(pos.subarray(j * 4, j * 4 + 4), i * 4); c2.set(col.subarray(j * 4, j * 4 + 4), i * 4); }
  return { n, pos: p2, col: c2 };
}
function morton(x, y) {
  const xi = clamp(Math.floor((x + 200) / (W + 400) * 1023), 0, 1023), yi = clamp(Math.floor((y + 200) / (H + 400) * 1023), 0, 1023); let m = 0;
  for (let b = 0; b < 10; b++) m |= ((xi >> b) & 1) << (2 * b) | ((yi >> b) & 1) << (2 * b + 1);
  return m;
}
// Reorder `dst` so that point i of dst is the partner of point i of `src` under a 2D quantile map:
// both sets are cut into `bands` equal-count bands along `axis` ('y' | 'x'), and within a band matched by rank on the
// other axis. Neighbours in src land on neighbours in dst, so a morph between unrelated shapes reads as one sheet
// folding into the other. Cost: two sorts, ~0.5 s at 262k (cached: only the permutation is stored).
export function matchTo(dst, src, { bands = 96, axis = 'y' } = {}) {
  const key = 'match:' + hashBytes(dst.pos) + hashBytes(src.pos) + stableKey([bands, axis, dst.n, src.n]);
  let hit = pcache.get(key);
  if (!hit) {
    const n = Math.min(dst.n, src.n), A = axis === 'y' ? 1 : 0, Bx = 1 - A;
    const rank = ps => { const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i;
      const p = ps.pos; idx.sort((a, b) => p[a * 4 + A] - p[b * 4 + A]);
      for (let k = 0; k < bands; k++) { const lo = Math.floor(k * n / bands), hi = Math.floor((k + 1) * n / bands);
        idx.subarray(lo, hi).sort((a, b) => p[a * 4 + Bx] - p[b * 4 + Bx]); }
      return idx; };
    const is = rank(src), id = rank(dst), perm = new Uint32Array(dst.n);
    for (let i = 0; i < dst.n; i++) perm[i] = i;
    for (let k = 0; k < n; k++) perm[is[k]] = id[k];
    hit = pcache.set(key, { perm });
  }
  return permute(dst, hit.perm);
}
// Recolour a point set: fn(x, y, z, i) -> [r,g,b] (0..255).
export function recolor(ps, fn) { for (let i = 0; i < ps.n; i++) ps.col.set(fn(ps.pos[i * 4], ps.pos[i * 4 + 1], ps.pos[i * 4 + 2], i), i * 4); return ps; }
// Cycle / resample a point set to exactly n points (for shapes sampled at a different count).
export function resize(ps, n) {
  if (ps.n === n) return ps;
  const pos = new Float32Array(n * 4), col = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { const j = Math.floor(i * ps.n / n); pos.set(ps.pos.subarray(j * 4, j * 4 + 4), i * 4); col.set(ps.col.subarray(j * 4, j * 4 + 4), i * 4); }
  return { n, pos, col };
}
// Effective screen area of a point set (px^2): the participation ratio (sum c)^2 / sum c^2 of an occupancy grid of
// `cell` px, so a dense core with a sparse halo counts as the core. Used for auto density in Swarm.draw.
export function coverage(ps, cell = 6) {
  const gw = Math.ceil((W + 1200) / cell), gh = Math.ceil((H + 1200) / cell), g = new Uint32Array(gw * gh);
  for (let i = 0; i < ps.n; i++) {
    const x = Math.floor((ps.pos[i * 4] + 600) / cell), y = Math.floor((ps.pos[i * 4 + 1] + 600) / cell);
    if (x >= 0 && y >= 0 && x < gw && y < gh) g[y * gw + x]++;
  }
  let s1 = 0, s2 = 0; for (let k = 0; k < g.length; k++) { const c = g[k]; if (c) { s1 += c; s2 += c * c; } }
  return Math.max(s2 ? s1 * s1 / s2 * cell * cell : 0, 400);
}
