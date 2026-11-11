// PHYSICS: deterministic simulations that replay to any t.
//
//   import { initPhysics, RigidWorld, Cloth, Fluid, Flames, Crowd, bolt, drawBolt, crack, drawCrack,
//            maskPoints, noise3 } from '../lib/fx/physics.js';
//   import { RigidView, CrowdView } from '../lib/fx/physics_view.js';        // 2.5D bodies, perspective crowd
//   import { Timeline, sourceKey } from '../lib/fx/physics_timeline.js';    // sections, clocks, budget, sim.bin
//   await initPhysics();                                  // loads rapier2d (wasm) + earcut once
//
// Every simulation here is stepped at a fixed rate from its own t = 0. CPU sims keep a window of
// per-frame snapshots (keep = 120) plus a full-state checkpoint every 30 frames, so renderFrame(t)
// is a pure function of t: sequential renders step once per frame, out-of-order stills restore the
// nearest checkpoint (CPU) or GPU checkpoint (fluid, every 15 frames) and replay the rest. State can
// be exported to / imported from out/.<scene>.sim.bin (physics_timeline.js), so parallel processes
// resume without replaying from t = 0. Anything that happens "at a time" (spawns, releases, blasts,
// kicks, cuts, formations) is declared up front as a scheduled event, never poked from the render loop.
//
//   RigidWorld  rapier2d rigid bodies: boxes, sprites with convex-decomposed colliders (contour ->
//               earcut -> Hertel-Mehlhorn, holes kept), falling type, Voronoi-shattered monuments
//               (release + blast), stamps; impact events for dust. Draw with RigidView for material.
//   Cloth       3D verlet cloth (structural/shear/bend), per-triangle aerodynamic wind, pins that
//               can move, timed cuts (tears), WebGL2 renderer: textured, lit, weave, sheen, back side.
//   Fluid       2D stable fluid on the GPU: MacCormack advection, warm-started multigrid pressure,
//               batched scissored splats, open top/bottom with clean inflow, curl-noise detail at
//               render time; looks via Fluid.preset('smoke' | 'ink' | 'fire' | 'dust').
//   Flames      stateless GPU fire that licks up from any mask canvas (burning type / silhouettes).
//   bolt/crack  midpoint-displacement lightning with branches + L-system cracks, growing over time.
//   Crowd       boids (separation / alignment / cohesion / wander) that converge into formations
//               sampled from any mask (maskPoints, optionally edge-weighted); draw with CrowdView
//               (ground plane, torch-bearers, bloom, haze) or the 2D torch / stroke styles.
import { W, H, rng, clamp, lerp } from '../kit.js';

let RAPIER = null;
export async function initPhysics() {
  if (RAPIER) return RAPIER;
  RAPIER = (await import('../../node_modules/@dimforge/rapier2d-compat/rapier.es.js')).default;
  await RAPIER.init();
  await loadEarcut();
  return RAPIER;
}

// ------------------------------------------------------------------ small shared helpers
const TAU = Math.PI * 2;
function hash3(x, y, z) { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
// smooth 3D value noise in [-1, 1]
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (a, b, d) => hash3(xi + a, yi + b, zi + d);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
}
export const fbm3 = (x, y, z, o = 3) => { let s = 0, a = 0.5; for (let i = 0; i < o; i++) { s += a * noise3(x, y, z); x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; } return s; };

function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }

// convex hull (monotone chain) of [[x,y],...]
export function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop(); return lo.concat(up);
}
function polyArea(P) { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; }
function centroid(P) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length], k = p[0] * q[1] - q[0] * p[1]; a += k; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k; }
  if (Math.abs(a) < 1e-9) return [P.reduce((s, p) => s + p[0], 0) / P.length, P.reduce((s, p) => s + p[1], 0) / P.length];
  return [cx / (3 * a), cy / (3 * a)];
}
// clip convex polygon by half-plane n.(x - m) <= 0
function clipHalf(P, nx, ny, mx, my) {
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const da = nx * (a[0] - mx) + ny * (a[1] - my), db = nx * (b[0] - mx) + ny * (b[1] - my);
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const u = da / (da - db); out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); }
  }
  return out;
}
// Voronoi cells of `sites` inside convex polygon `poly`
export function voronoi(poly, sites) {
  return sites.map((s, i) => {
    let P = poly;
    for (let j = 0; j < sites.length && P.length; j++) {
      if (j === i) continue;
      const o = sites[j], nx = o[0] - s[0], ny = o[1] - s[1];
      if (nx * nx + ny * ny > 4 * 400 * 400) continue;
      P = clipHalf(P, nx, ny, (s[0] + o[0]) / 2, (s[1] + o[1]) / 2);
    }
    return P;
  });
}
// alpha samples of a canvas region -> list of opaque points
function alphaData(cv) { return cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height).data; }
// compound convex decomposition by grid: hull of the opaque samples in each cell
function gridHulls(cv, cell, step = 2, thr = 90, data = alphaData(cv)) {
  const out = [], w = cv.width, h = cv.height;
  for (let cy = 0; cy < h; cy += cell) for (let cx = 0; cx < w; cx += cell) {
    const pts = [];
    for (let y = cy; y < Math.min(h, cy + cell + 1); y += step) for (let x = cx; x < Math.min(w, cx + cell + 1); x += step)
      if (data[(y * w + x) * 4 + 3] > thr) pts.push([x, y]);
    if (pts.length < 4) continue;
    const hl = hull(pts);
    if (hl.length >= 3 && polyArea(hl) > cell * cell * 0.04) out.push(hl);
  }
  return out;
}

// ------------------------------------------------------------------ hashing + binary packing
// FNV-1a over the bytes of any typed array (or a list of them): simulation-state fingerprints.
export function hashBytes(a, h = 0x811c9dc5) {
  if (Array.isArray(a)) { for (const x of a) h = hashBytes(x, h); return h >>> 0; }
  if (a.byteLength % 4 === 0 && a.byteOffset % 4 === 0) { const u = new Uint32Array(a.buffer, a.byteOffset, a.byteLength / 4); for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619); } }
  else { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619); } }
  return h >>> 0;
}
export const hashStr = (s, h = 0x811c9dc5) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const TYPED = { Float32Array, Float64Array, Int32Array, Uint32Array, Uint16Array, Uint8Array, Int16Array, Int8Array };
// nested plain objects / arrays with typed arrays -> one ArrayBuffer ('SIMB' + u32 json length + json + 8-aligned blobs)
export function packBin(obj) {
  const blobs = []; let off = 0;
  const enc = v => {
    if (ArrayBuffer.isView(v)) { const o = off; off += Math.ceil(v.byteLength / 8) * 8; blobs.push([o, v]); return { $t: v.constructor.name, o, n: v.length }; }
    if (Array.isArray(v)) return v.map(enc);
    if (v && typeof v === 'object') { const r = {}; for (const k in v) r[k] = enc(v[k]); return r; }
    return v;
  };
  const json = new TextEncoder().encode(JSON.stringify(enc(obj)));
  const head = 8 + Math.ceil(json.length / 8) * 8, buf = new ArrayBuffer(head + off), u8 = new Uint8Array(buf);
  u8.set([83, 73, 77, 66]); new DataView(buf).setUint32(4, json.length, true); u8.set(json, 8);
  for (const [o, v] of blobs) u8.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), head + o);
  return buf;
}
export function unpackBin(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 83 || u8[1] !== 73 || u8[2] !== 77 || u8[3] !== 66) throw new Error('not a SIMB file');
  const n = new DataView(buf).getUint32(4, true), head = 8 + Math.ceil(n / 8) * 8;
  const dec = v => {
    if (v && v.$t) { const T = TYPED[v.$t]; return new T(buf.slice(head + v.o, head + v.o + v.n * T.BYTES_PER_ELEMENT)); }
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v === 'object') { const r = {}; for (const k in v) r[k] = dec(v[k]); return r; }
    return v;
  };
  return dec(JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + n))));
}
// float32 -> float16 bits (exact for values that came out of an fp16 texture)
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
function toHalf(x) {
  _f32[0] = x; const b = _u32[0], s = (b >>> 16) & 0x8000, e8 = (b >>> 23) & 0xff, m = b & 0x7fffff;
  if (e8 === 255) return s | 0x7c00 | (m ? 0x200 : 0);
  const e = e8 - 112;
  if (e <= 0) return e < -10 ? s : s | ((m | 0x800000) >>> (14 - e));
  if (e >= 31) return s | 0x7c00;
  return s | (e << 10) | (m >>> 13);
}

// ------------------------------------------------------------------ signed distance fields (exact EDT)
// Felzenszwalb-Huttenlocher squared EDT along one line
function edt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edt2(g, w, h) {
  const n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = d[x]; }
  return g;
}
// signed distance (px, negative inside) of alpha > thr; `data` = RGBA bytes of a w x h image
export function sdfOf(data, w, h, thr = 127) {
  const N = w * h, a = new Float64Array(N), b = new Float64Array(N);
  for (let i = 0; i < N; i++) { const ins = data[i * 4 + 3] > thr; a[i] = ins ? 0 : 1e20; b[i] = ins ? 1e20 : 0; }
  edt2(a, w, h); edt2(b, w, h);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = a[i] > 0 ? Math.sqrt(a[i]) - 0.5 : 0.5 - Math.sqrt(b[i]);
  return out;
}

// ------------------------------------------------------------------ convex decomposition of an alpha mask
// contour trace (pixel cracks) -> Douglas-Peucker -> earcut with holes -> Hertel-Mehlhorn merge.
// Counters survive (O, A, P, R keep their holes), so glyphs interlock and stack like the letterforms.
let earcut = null;
async function loadEarcut() { if (!earcut) earcut = (await import('../../node_modules/earcut/src/earcut.js')).default; return earcut; }
function traceLoops(inside, w, h) {
  const out = new Map(), key = (x, y) => y * (w + 1) + x, add = (x0, y0, x1, y1) => { const k = key(x0, y0); (out.get(k) || out.set(k, []).get(k)).push([x1, y1]); };
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && inside[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside[y * w + x]) continue;
    if (!at(x, y - 1)) add(x, y, x + 1, y);
    if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!at(x - 1, y)) add(x, y + 1, x, y);
  }
  const loops = [];
  for (const [k0, list0] of out) {
    while (list0.length) {
      const loop = []; let x = k0 % (w + 1), y = Math.floor(k0 / (w + 1)), dx = 0, dy = 0;
      for (let guard = 0; guard < 1e6; guard++) {
        const l = out.get(key(x, y)); if (!l || !l.length) break;
        let j = 0;
        if (l.length > 1) { // ambiguous corner: take the right turn (keeps diagonal-touching pixels apart)
          let best = -9; l.forEach(([nx, ny], i) => { const ex = nx - x, ey = ny - y, cr = dx * ey - dy * ex, s = cr > 0 ? 1 : cr < 0 ? -1 : 0; if (s > best) { best = s; j = i; } });
        }
        const [nx, ny] = l.splice(j, 1)[0]; loop.push([x, y]); dx = nx - x; dy = ny - y; x = nx; y = ny;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}
function dpOpen(Q, eps) {
  const keep = new Uint8Array(Q.length); keep[0] = keep[Q.length - 1] = 1;
  const st = [[0, Q.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let m = -1, md = eps;
    const [ax, ay] = Q[a], [bx, by] = Q[b], L = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (ay - Q[i][1]) - (ax - Q[i][0]) * (by - ay)) / L; if (d > md) { md = d; m = i; } }
    if (m >= 0) { keep[m] = 1; st.push([a, m], [m, b]); }
  }
  return Q.filter((_, i) => keep[i]);
}
function dpClosed(P, eps) {
  let far = 0, fd = -1; for (let i = 1; i < P.length; i++) { const d = (P[i][0] - P[0][0]) ** 2 + (P[i][1] - P[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const A = dpOpen(P.slice(0, far + 1), eps), B = dpOpen(P.slice(far).concat([P[0]]), eps);
  return A.concat(B.slice(1, -1));
}
const sArea = P => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
function inPoly(P, x, y) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
// Hertel-Mehlhorn: merge triangles across internal diagonals (longest first) while the union stays convex
function hertelMehlhorn(V, tris) {
  let polys = tris.map(t => (sArea(t.map(i => V[i])) < 0 ? t.slice().reverse() : t.slice())).filter(t => Math.abs(sArea(t.map(i => V[i]))) > 1e-6);
  const cross = (o, a, b) => (V[a][0] - V[o][0]) * (V[b][1] - V[o][1]) - (V[a][1] - V[o][1]) * (V[b][0] - V[o][0]);
  const convex = R => { for (let s = 0; s < R.length; s++) if (cross(R[(s - 1 + R.length) % R.length], R[s], R[(s + 1) % R.length]) < -1e-6) return false; return true; };
  for (let pass = 0, merged = true; merged && pass < 64; pass++) {
    merged = false;
    const edges = new Map();
    polys.forEach((P, pi) => P.forEach((a, k) => edges.set(a + ',' + P[(k + 1) % P.length], [pi, k])));
    const cand = [];
    for (const [e, [pi, k]] of edges) { const [a, b] = e.split(',').map(Number); const o = edges.get(b + ',' + a); if (o && pi < o[0]) cand.push([Math.hypot(V[a][0] - V[b][0], V[a][1] - V[b][1]), pi, k, o[0], o[1]]); }
    cand.sort((x, y) => y[0] - x[0]);
    const dead = new Set(), touched = new Set();
    for (const [, pi, k, qi, m] of cand) {
      if (dead.has(pi) || dead.has(qi) || touched.has(pi) || touched.has(qi)) continue;
      const P = polys[pi], Q = polys[qi], n = P.length, mq = Q.length;
      // P has a->b at k, Q has b->a at m: walk P from b round to a, then Q strictly between a and b
      const R = []; for (let s = 1; s <= n; s++) R.push(P[(k + s) % n]);
      for (let s = 2; s < mq; s++) R.push(Q[(m + s) % mq]);
      if (!convex(R)) continue;
      polys[pi] = R; dead.add(qi); touched.add(pi); merged = true;
    }
    polys = polys.filter((_, i) => !dead.has(i));
  }
  return polys.map(P => P.map(i => V[i]));
}
// alpha canvas -> convex parts in sprite px (null when it fails, so callers can fall back to grid hulls)
export function decompose(cv, { thr = 90, step = null, eps = 1.4, minArea = 6, data = alphaData(cv) } = {}) {
  if (!earcut) return null;
  const s = step || Math.max(1, Math.round(Math.min(cv.width, cv.height) / 160)), w = Math.ceil(cv.width / s), h = Math.ceil(cv.height / s);
  const inside = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const ix = Math.min(cv.width - 1, x * s + (s >> 1)), iy = Math.min(cv.height - 1, y * s + (s >> 1)); inside[y * w + x] = data[(iy * cv.width + ix) * 4 + 3] > thr ? 1 : 0; }
  const loops = traceLoops(inside, w, h).map(L => dpClosed(L, eps)).filter(L => L.length >= 3 && Math.abs(sArea(L)) > minArea);
  // pixel-crack loops run clockwise on screen round solid (positive shoelace with y down), holes the other way
  const outers = loops.filter(L => sArea(L) > 0), holes = loops.filter(L => sArea(L) < 0);
  const parts = [];
  for (const O of outers) {
    const my = holes.filter(Hh => inPoly(O, Hh[0][0] + 0.01, Hh[0][1] + 0.01));
    const V = [...O], hi = [];
    for (const Hh of my) { hi.push(V.length); V.push(...Hh); }
    const tri = earcut(V.flat(), hi.length ? hi : undefined, 2);
    const T = []; for (let i = 0; i < tri.length; i += 3) T.push([tri[i], tri[i + 1], tri[i + 2]]);
    for (const P of hertelMehlhorn(V, T)) if (Math.abs(sArea(P)) > minArea * 0.5) parts.push(P.map(([x, y]) => [x * s, y * s]));
  }
  return parts.length ? parts : null;
}

// ------------------------------------------------------------------ frame cache base
// Subclasses implement _init(), _advance(frameIndex), _snap() -> typed array (what draw() reads),
// _state() -> full resumable state and _restore(state). Snapshots are kept in a window of `keep`
// frames around the current step; a full state checkpoint is kept every `every` frames, so seeking
// back replays at most `every` - 1 steps. free() drops everything (the sim re-inits on demand).
// exportState()/importState() move the checkpoints between processes (see physics_timeline.js).
class Replay {
  constructor(fps = 30, { keep = 120, every = 30 } = {}) {
    this.fps = fps; this.keep = keep; this.every = every;
    this.snaps = new Map(); this.ckpt = new Map(); this.cur = -1; this.inited = false; this.stepMs = 0; this.steps = 0;
  }
  get frames() { return this.snaps; }            // back-compat (prof_physics prints the cache size)
  frameIndex(t) { return Math.max(0, Math.round(t * this.fps)); }
  at(t) { return this.frame(this.frameIndex(t)); }
  _rewind(i) {
    let best = -1; for (const k of this.ckpt.keys()) if (k <= i && k > best) best = k;
    if (!this.inited) { this._init(); this.inited = true; }
    else if (best < 0) this._init();
    if (best > 0) { this._restore(this.ckpt.get(best)); this.cur = best; this.snaps.set(best, this._snap(best)); }
    else { if (best === 0) this._restore(this.ckpt.get(0)); this.cur = 0; this.snaps.set(0, this._snap(0)); if (!this.ckpt.has(0)) this.ckpt.set(0, this._state()); }
  }
  frame(i) {
    const s = this.snaps.get(i); if (s) return s;
    if (this.cur < 0 || i < this.cur || !this.inited) this._rewind(i);
    while (this.cur < i) {
      const f = this.cur + 1, t0 = performance.now();
      this._advance(f); this.cur = f; this.steps++;
      this.snaps.set(f, this._snap(f));
      if (f % this.every === 0 && !this.ckpt.has(f)) this.ckpt.set(f, this._state());
      this.stepMs = this.stepMs * 0.9 + (performance.now() - t0) * 0.1;   // stats only: never feeds the sim
    }
    if (this.snaps.size > this.keep * 1.5) for (const k of [...this.snaps.keys()]) if (Math.abs(k - this.cur) > this.keep && k !== i) this.snaps.delete(k);
    return this.snaps.get(i);
  }
  hashAt(t) { return hashBytes(this.at(t)); }
  free() { this.snaps.clear(); this.ckpt.clear(); this.cur = -1; this.inited = false; this._free && this._free(); }
  exportState() { return { ckpts: [...this.ckpt.entries()].map(([f, s]) => ({ f, s })), extra: this._extra ? this._extra() : null }; }
  importState(o) { this.free(); for (const { f, s } of o.ckpts) this.ckpt.set(f, s); if (o.extra && this._loadExtra) this._loadExtra(o.extra); }
}

// ================================================================== RIGID BODIES (rapier2d)
// Units: px, seconds, radians, y down. Sprites are canvases; each body draws its sprite centred on
// its origin (`ox, oy` = origin inside the sprite). Scheduled events: spawn, release, blast, kick.
export class RigidWorld extends Replay {
  constructor({ gravity = 3200, fps = 30, sub = 4, scale = 100, iters = 6, impactThreshold = 520 } = {}) {
    super(fps);
    if (!RAPIER) throw new Error('await initPhysics() first');
    Object.assign(this, { gravity, sub, scale, iters, impactThreshold });
    this.defs = []; this.statics = []; this.events = []; this.impacts = []; this.impUpTo = 0;
  }
  // ---- declaration (before the first at())
  ground(y = H - 40, { x0 = -2000, x1 = W + 2000, friction = 0.8 } = {}) { this.statics.push({ box: [x0, y, x1, y + 400], friction }); return this; }
  walls({ left = -30, right = W + 30, top = -4000, bottom = H + 400 } = {}) {
    this.statics.push({ box: [left - 400, top, left, bottom] }, { box: [right, top, right + 400, bottom] }); return this;
  }
  staticBox(x0, y0, x1, y1, o = {}) { this.statics.push({ box: [x0, y0, x1, y1], ...o }); return this; }
  // generic body: sprite canvas + convex parts (in sprite px); returns its index
  body({ sprite = null, parts = null, ox = null, oy = null, x = W / 2, y = 0, angle = 0, vx = 0, vy = 0, spin = 0, density = 1, bounce = 0.1,
    friction = 0.7, spawn = 0, fixed = false, ccd = false, damping = 0.05, angDamping = 0.1, shadow = true, z = 0, tag = null, tint = null, mat = 0 } = {}) {
    const sw = sprite ? sprite.width : 0, sh = sprite ? sprite.height : 0;
    if (!parts) parts = [[[0, 0], [sw, 0], [sw, sh], [0, sh]]];
    if (ox == null) { const all = parts.flat(); const c = centroid(hull(all)); ox = c[0]; oy = c[1]; }
    const d = { sprite, parts, ox, oy, x, y, angle, vx, vy, spin, density, bounce, friction, spawn, fixed, ccd, damping, angDamping, z, tag, tint, mat };
    if (sprite && shadow) d.shade = shadowOf(sprite, shadow === true ? 14 : shadow);
    this.defs.push(d);
    return this.defs.length - 1;
  }
  box(w, h, o = {}) {
    const c = canvas(w, h), g = c.getContext('2d');
    g.fillStyle = o.color || '#C91F37'; g.fillRect(0, 0, w, h);
    return this.body({ sprite: o.sprite || c, ...o });
  }
  // a sprite canvas with alpha -> body with grid-hull compound collider
  // (convex decomposition that keeps counters; o.decomp = false -> the old grid hulls)
  sprite(cv, o = {}) {
    const data = alphaData(cv);
    const parts = (o.decomp !== false && decompose(cv, { data })) || gridHulls(cv, o.cell || Math.max(16, Math.round(Math.min(cv.width, cv.height) / 4)), 2, 90, data);
    return this.body({ sprite: cv, parts, ...o });
  }
  // falling type: one body per glyph; `paint(g, ch, w, h)` may restyle each glyph sprite
  text(str, { family = 'Anton', size = 300, color = '#F4E6D0', x = W / 2, y = 400, tracking = 0.02, spawn = 0, stagger = 0.06,
    vx = 0, vy = 0, spin = 0, jitter = 0, seed = 1, paint = null, stroke = 0, strokeColor = '#0b0303', cell = null, ...o } = {}) {
    const r = rng(seed), probe = canvas(8, 8).getContext('2d');
    probe.font = `${size}px "${family}"`;
    const widths = [...str].map(ch => probe.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + tracking * size * (str.length - 1);
    let cx = x - total / 2; const ids = [];
    [...str].forEach((ch, i) => {
      const w = widths[i];
      if (ch !== ' ') {
        const pad = Math.ceil(size * 0.08 + stroke), cw = w + pad * 2, ch_ = size * 1.25 + pad * 2;
        const c = canvas(cw, ch_), g = c.getContext('2d');
        g.font = `${size}px "${family}"`; g.textBaseline = 'alphabetic';
        if (paint) paint(g, ch, cw, ch_, pad, size, i);
        else {
          if (stroke) { g.lineWidth = stroke; g.strokeStyle = strokeColor; g.lineJoin = 'round'; g.strokeText(ch, pad, pad + size * 1.02); }
          g.fillStyle = color; g.fillText(ch, pad, pad + size * 1.02);
        }
        const id = this.sprite(c, { cell: cell || Math.round(size / 5), x: cx + cw / 2 - pad, y: y + (r() - 0.5) * jitter,
          spawn: spawn + i * stagger, vx: vx + (r() - 0.5) * jitter, vy, spin: spin * (r() - 0.5) * 2, ...o });
        ids.push(id);
      }
      cx += w + tracking * size;
    });
    return ids;
  }
  // Voronoi shatter: `cv` placed with its top-left at (x, y). Fragments are fixed until `release`.
  // focus = impact point in sprite px (more, smaller shards there). Returns body indices.
  shatter(cv, { x = 0, y = 0, sites = 90, focus = null, bias = 0.55, spread = 0.18, seed = 7, fixed = true, spawn = 0,
    edge = 'rgba(255,236,214,0.55)', edgeDark = 'rgba(0,0,0,0.5)', minArea = 60, ...o } = {}) {
    const r = rng(seed), w = cv.width, h = cv.height;
    const fx = focus ? focus[0] : w / 2, fy = focus ? focus[1] : h / 2;
    const S = [];
    for (let i = 0; i < sites; i++) {
      if (r() < bias) { // gaussian cluster at the focus
        const a = r() * TAU, d = Math.sqrt(-2 * Math.log(1 - r() * 0.999)) * spread * Math.max(w, h) * 0.5;
        S.push([clamp(fx + Math.cos(a) * d, 1, w - 1), clamp(fy + Math.sin(a) * d, 1, h - 1)]);
      } else S.push([r() * w, r() * h]);
    }
    const data = alphaData(cv), ids = [];
    for (const cell of voronoi([[0, 0], [w, 0], [w, h], [0, h]], S)) {
      if (cell.length < 3 || polyArea(cell) < minArea) continue;
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const [px, py] of cell) { bx0 = Math.min(bx0, px); by0 = Math.min(by0, py); bx1 = Math.max(bx1, px); by1 = Math.max(by1, py); }
      bx0 = Math.floor(bx0); by0 = Math.floor(by0); bx1 = Math.ceil(bx1); by1 = Math.ceil(by1);
      // opaque samples inside the cell -> collider hull
      const pts = [], st = Math.max(2, Math.round(Math.sqrt(polyArea(cell)) / 14));
      const ccw = polyArea(cell) && (() => { let s = 0; for (let i = 0; i < cell.length; i++) { const p = cell[i], q = cell[(i + 1) % cell.length]; s += p[0] * q[1] - q[0] * p[1]; } return s > 0; })();
      const C = ccw ? cell : cell.slice().reverse();
      const inC = (px, py) => { for (let i = 0; i < C.length; i++) { const a = C[i], b = C[(i + 1) % C.length]; if ((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]) < -0.01) return false; } return true; };
      for (let py = by0; py <= by1; py += st) for (let px = bx0; px <= bx1; px += st) {
        const ix = Math.min(w - 1, Math.max(0, px)), iy = Math.min(h - 1, Math.max(0, py));
        if (data[(iy * w + ix) * 4 + 3] > 100 && inC(px, py)) pts.push([px - bx0, py - by0]);
      }
      if (pts.length < 4) continue;
      const hl = hull(pts);
      if (hl.length < 3 || polyArea(hl) < minArea * 0.5) continue;
      // cut the sprite
      const sp = canvas(bx1 - bx0 + 2, by1 - by0 + 2), g = sp.getContext('2d');
      g.save(); g.beginPath(); C.forEach(([px, py], i) => (i ? g.lineTo : g.moveTo).call(g, px - bx0, py - by0)); g.closePath(); g.clip();
      g.drawImage(cv, -bx0, -by0); g.restore();
      // fresh-break bevel on the fracture edges (only where there is material)
      g.save(); g.globalCompositeOperation = 'source-atop';
      g.beginPath(); C.forEach(([px, py], i) => (i ? g.lineTo : g.moveTo).call(g, px - bx0, py - by0)); g.closePath();
      g.lineWidth = 5; g.strokeStyle = edgeDark; g.stroke(); g.lineWidth = 2; g.strokeStyle = edge; g.translate(-1, -1); g.stroke();
      g.restore();
      ids.push(this.body({ sprite: sp, parts: [hl], x: 0, y: 0, fixed, spawn, ...o, _place: [x + bx0, y + by0] }));
      const d = this.defs[ids[ids.length - 1]];
      d.x = x + bx0 + d.ox; d.y = y + by0 + d.oy; d.poly = C.map(([px, py]) => [x + px, y + py]); d.hullWorld = hl.map(([px, py]) => [x + bx0 + px, y + by0 + py]);
      d.src = { cv, x: bx0, y: by0 };            // outline SDF of the whole source (RigidView bevels the outer edge before release)
    }
    return ids;
  }
  // scheduled events (t in seconds of this world's clock)
  release(t, ids, { vx = 0, vy = 0, spin = 0 } = {}) { this.events.push({ f: Math.round(t * this.fps), type: 'release', ids, vx, vy, spin }); return this; }
  blast(t, { x, y, radius = 400, force = 2600, up = 0.3, spin = 3, ids = null, seed = 3 }) { this.events.push({ f: Math.round(t * this.fps), type: 'blast', x, y, radius, force, up, spin, ids, seed }); return this; }
  kick(t, ids, { vx = 0, vy = 0, spin = 0 } = {}) { this.events.push({ f: Math.round(t * this.fps), type: 'kick', ids: [].concat(ids), vx, vy, spin }); return this; }
  remove(t, ids) { this.events.push({ f: Math.round(t * this.fps), type: 'remove', ids: [].concat(ids) }); return this; }

  // ---- simulation
  _init() {
    const R = RAPIER, s = 1 / this.scale;
    if (this.world) this.world.free();
    this.world = new R.World({ x: 0, y: this.gravity * s });
    this.world.timestep = 1 / (this.fps * this.sub);
    this.world.numSolverIterations = this.iters;
    for (const st of this.statics) {
      const [x0, y0, x1, y1] = st.box;
      const b = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation((x0 + x1) / 2 * s, (y0 + y1) / 2 * s));
      this.world.createCollider(R.ColliderDesc.cuboid((x1 - x0) / 2 * s, (y1 - y0) / 2 * s).setFriction(st.friction ?? 0.8).setRestitution(st.bounce ?? 0.05), b);
    }
    this.bodies = new Array(this.defs.length).fill(null);
    this.handles = new Float64Array(this.defs.length).fill(-1);
    this.alive = new Uint8Array(this.defs.length);
    this.prevV = new Float32Array(this.defs.length * 2);
    this.lastHit = new Int32Array(this.defs.length).fill(-100);
    this.events.sort((a, b) => a.f - b.f);
    this.spawnOrder = this.defs.map((d, i) => i).sort((a, b) => this.defs[a].spawn - this.defs[b].spawn || a - b);
    this.si = 0; this.ei = 0;
    this._spawnUpTo(0);
  }
  _create(i) {
    const R = RAPIER, s = 1 / this.scale, d = this.defs[i];
    const desc = (d.fixed ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic())
      .setTranslation(d.x * s, d.y * s).setRotation(d.angle).setLinvel(d.vx * s, d.vy * s).setAngvel(d.spin)
      .setLinearDamping(d.damping).setAngularDamping(d.angDamping).setCcdEnabled(d.ccd);
    const b = this.world.createRigidBody(desc);
    for (const P of d.parts) {
      const arr = new Float32Array(P.length * 2);
      P.forEach(([px, py], k) => { arr[k * 2] = (px - d.ox) * s; arr[k * 2 + 1] = (py - d.oy) * s; });
      const cd = R.ColliderDesc.convexHull(arr);
      if (cd) this.world.createCollider(cd.setDensity(d.density).setRestitution(d.bounce).setFriction(d.friction), b);
    }
    this.bodies[i] = b; this.alive[i] = 1; this.handles[i] = b.handle;
    this.prevV[i * 2] = d.vx; this.prevV[i * 2 + 1] = d.vy;
  }
  _spawnUpTo(f) {
    while (this.si < this.spawnOrder.length && Math.round(this.defs[this.spawnOrder[this.si]].spawn * this.fps) <= f) this._create(this.spawnOrder[this.si++]);
  }
  _advance(f) {
    const R = RAPIER, s = 1 / this.scale;
    this._spawnUpTo(f);
    while (this.ei < this.events.length && this.events[this.ei].f <= f) {
      const e = this.events[this.ei++];
      if (e.type === 'release') for (const i of e.ids) { const b = this.bodies[i]; if (!b) continue; b.setBodyType(R.RigidBodyType.Dynamic, true); b.setLinvel({ x: e.vx * s, y: e.vy * s }, true); b.setAngvel(e.spin, true); }
      if (e.type === 'kick') for (const i of e.ids) { const b = this.bodies[i]; if (!b) continue; b.setLinvel({ x: e.vx * s, y: e.vy * s }, true); b.setAngvel(e.spin, true); }
      if (e.type === 'remove') for (const i of e.ids) { const b = this.bodies[i]; if (!b) continue; this.world.removeRigidBody(b); this.bodies[i] = null; this.alive[i] = 0; }
      if (e.type === 'blast') {
        const r = rng(e.seed);
        for (let i = 0; i < this.bodies.length; i++) {
          const b = this.bodies[i]; if (!b || (e.ids && !e.ids.includes(i))) continue;
          if (b.bodyType() !== R.RigidBodyType.Dynamic) b.setBodyType(R.RigidBodyType.Dynamic, true);
          const p = b.translation(), dx = p.x / s - e.x, dy = p.y / s - e.y, d = Math.hypot(dx, dy) + 1;
          if (d > e.radius) continue;
          const k = e.force * Math.pow(1 - d / e.radius, 1.2) * (0.7 + 0.6 * r());
          const v = b.linvel();
          b.setLinvel({ x: v.x + dx / d * k * s, y: v.y + (dy / d - e.up) * k * s }, true);
          b.setAngvel(b.angvel() + (r() - 0.5) * 2 * e.spin, true);
        }
      }
    }
    for (let k = 0; k < this.sub; k++) this.world.step();
    // impacts: sudden velocity change of a dynamic body
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i]; if (!b) continue;
      const v = b.linvel(), vx = v.x / s, vy = v.y / s;
      const dv = Math.hypot(vx - this.prevV[i * 2], vy - this.prevV[i * 2 + 1]);
      this.prevV[i * 2] = vx; this.prevV[i * 2 + 1] = vy;
      if (dv > this.impactThreshold && f - this.lastHit[i] > 3 && b.bodyType() === R.RigidBodyType.Dynamic) {
        const p = b.translation(); this.lastHit[i] = f;
        const area = this.defs[i].sprite ? this.defs[i].sprite.width * this.defs[i].sprite.height : 1e4;
        // a replayed frame (after a rewind) re-detects the same impacts: record each frame once
        if (f > this.impUpTo) this.impacts.push({ f, t: f / this.fps, x: p.x / s, y: p.y / s, e: dv * Math.sqrt(area) / 300, i });
      }
    }
    this.impUpTo = Math.max(this.impUpTo, f);
  }
  _state() {
    return { snap: this.world.takeSnapshot(), handles: new Float64Array(this.handles), alive: new Uint8Array(this.alive), prevV: new Float32Array(this.prevV),
      lastHit: new Int32Array(this.lastHit), idx: new Int32Array([this.si, this.ei]) };
  }
  _restore(st) {
    const R = RAPIER;
    if (this.world) this.world.free();
    this.world = R.World.restoreSnapshot(st.snap);
    this.world.timestep = 1 / (this.fps * this.sub); this.world.numSolverIterations = this.iters;
    this.handles.set(st.handles); this.alive.set(st.alive); this.prevV.set(st.prevV); this.lastHit.set(st.lastHit);
    this.si = st.idx[0]; this.ei = st.idx[1];
    for (let i = 0; i < this.defs.length; i++) this.bodies[i] = this.alive[i] ? this.world.getRigidBody(this.handles[i]) : null;
  }
  _free() { if (this.world) { this.world.free(); this.world = null; } }
  // impacts are part of the exported state (another process needs them without replaying)
  _extra() { const n = this.impacts.length, a = new Float64Array(n * 6); this.impacts.forEach((h, k) => a.set([h.f, h.t, h.x, h.y, h.e, h.i], k * 6)); return { impacts: a, upTo: this.impUpTo }; }
  _loadExtra(x) { this.impacts = []; for (let k = 0; k < x.impacts.length; k += 6) { const a = x.impacts; this.impacts.push({ f: a[k], t: a[k + 1], x: a[k + 2], y: a[k + 3], e: a[k + 4], i: a[k + 5] }); } this.impUpTo = x.upTo; }
  _snap() {
    const n = this.defs.length, out = new Float32Array(n * 3 + n);
    for (let i = 0; i < n; i++) {
      const b = this.bodies && this.bodies[i];
      if (!b) { out[n * 3 + i] = 0; continue; }
      const p = b.translation();
      out[i * 3] = p.x * this.scale; out[i * 3 + 1] = p.y * this.scale; out[i * 3 + 2] = b.rotation(); out[n * 3 + i] = 1;
    }
    return out;
  }
  // impacts in (t0, t1]
  hits(t0, t1) { if (this.frameIndex(t1) > this.impUpTo) this.at(t1); return this.impacts.filter(h => h.t > t0 && h.t <= t1 + 1e-6); }
  pose(t, i) { const s = this.at(t), n = this.defs.length; return s[n * 3 + i] ? { x: s[i * 3], y: s[i * 3 + 1], a: s[i * 3 + 2] } : null; }
  // draw all (or `ids`) bodies: shadow pass then sprite pass, sorted by z
  draw(ctx, t, { ids = null, shadow = 0.55, sx = 10, sy = 16, dx = 0, dy = 0, scale = 1, filter = null } = {}) {
    const st = this.at(t), n = this.defs.length;
    const list = (ids || this.defs.map((_, i) => i)).filter(i => st[n * 3 + i]).sort((a, b) => this.defs[a].z - this.defs[b].z);
    ctx.save(); const M = ctx.getTransform();
    const place = (x, y, a) => { ctx.setTransform(M); ctx.translate(dx + x * scale, dy + y * scale); ctx.scale(scale, scale); ctx.rotate(a); };
    if (shadow) {
      ctx.globalAlpha = shadow;
      for (const i of list) {
        const d = this.defs[i]; if (!d.shade) continue;
        place(st[i * 3] + sx, st[i * 3 + 1] + sy, st[i * 3 + 2]);
        ctx.drawImage(d.shade.c, -d.ox - d.shade.p, -d.oy - d.shade.p);
      }
      ctx.globalAlpha = 1;
    }
    for (const i of list) {
      const d = this.defs[i]; if (!d.sprite || (filter && !filter(i, d))) continue;
      place(st[i * 3], st[i * 3 + 1], st[i * 3 + 2]);
      ctx.drawImage(d.sprite, -d.ox, -d.oy);
    }
    ctx.restore();
  }
}
function shadowOf(sprite, blur) {
  const p = blur * 2, c = canvas(sprite.width + p * 2, sprite.height + p * 2), g = c.getContext('2d');
  g.filter = `blur(${blur}px) brightness(0)`; g.drawImage(sprite, p, p);
  return { c, p };
}

// ================================================================== VERLET CLOTH (3D)
// Rest grid in px on the z = 0 plane, top-left at (x, y). `pins(i, j)` -> true for pinned nodes;
// `pinAt(t, i, j, rest)` may move them. wind(x, y, z, t) -> [wx, wy, wz] in px/s.
export class Cloth extends Replay {
  constructor({ cols = 56, rows = 34, x = 90, y = 300, w = 900, h = 560, fps = 30, sub = 3, iters = 6, gravity = 900, damping = 0.012,
    stiff = 1, bend = 0.35, drag = 0.9, lift = 0.25, pins = (i, j) => j === 0, pinAt = null, wind = null, seed = 1 } = {}) {
    super(fps);
    Object.assign(this, { cols, rows, x, y, w, h, sub, iters, gravity, damping, stiff, bend, drag, lift, pins, pinAt, wind, seed });
    this.cuts = [];
  }
  // tear along a polyline in uv space [[u,v],...] between t0 and t0+dur (the cut travels along the line)
  cut(t0, path, dur = 0.25) { this.cuts.push({ t0, path, dur }); return this; }
  _init() {
    const { cols: C, rows: R } = this, N = C * R;
    this.p = new Float32Array(N * 3); this.q = new Float32Array(N * 3); this.rest = new Float32Array(N * 3);
    this.inv = new Float32Array(N);
    for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) {
      const k = j * C + i, px = this.x + this.w * i / (C - 1), py = this.y + this.h * j / (R - 1);
      this.rest[k * 3] = px; this.rest[k * 3 + 1] = py; this.rest[k * 3 + 2] = 0;
      this.inv[k] = this.pins(i, j) ? 0 : 1;
    }
    this.p.set(this.rest); this.q.set(this.rest);
    const cons = [];
    const add = (i0, j0, i1, j1, k) => { if (i1 < C && j1 < R && i1 >= 0) cons.push(j0 * C + i0, j1 * C + i1, k); };
    for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) {
      add(i, j, i + 1, j, this.stiff); add(i, j, i, j + 1, this.stiff);
      add(i, j, i + 1, j + 1, this.stiff * 0.7); add(i + 1, j, i, j + 1, this.stiff * 0.7);
      add(i, j, i + 2, j, this.bend); add(i, j, i, j + 2, this.bend);
    }
    const M = cons.length / 3;
    this.ca = new Uint32Array(M); this.cb = new Uint32Array(M); this.ck = new Float32Array(M); this.cl = new Float32Array(M); this.cOn = new Uint8Array(M).fill(1);
    this.cCut = new Float32Array(M).fill(Infinity);
    for (let m = 0; m < M; m++) {
      const a = cons[m * 3], b = cons[m * 3 + 1]; this.ca[m] = a; this.cb[m] = b; this.ck[m] = cons[m * 3 + 2];
      this.cl[m] = Math.hypot(this.rest[a * 3] - this.rest[b * 3], this.rest[a * 3 + 1] - this.rest[b * 3 + 1]);
    }
    // cut schedule: constraint uv segment crossing a cut polyline -> the time the blade reaches it
    this.quadCut = new Float32Array((C - 1) * (R - 1)).fill(Infinity);
    const uv = k => [(k % C) / (C - 1), Math.floor(k / C) / (R - 1)];
    const segX = (a, b, c, d) => { const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-12) return -1; const u = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, v = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
      return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? v : -1; };
    for (const cu of this.cuts) {
      const L = []; let tot = 0;
      for (let s = 0; s < cu.path.length - 1; s++) { const l = Math.hypot(cu.path[s + 1][0] - cu.path[s][0], (cu.path[s + 1][1] - cu.path[s][1]) * this.h / this.w); L.push(tot); tot += l; }
      const hit = (A, B) => { for (let s = 0; s < cu.path.length - 1; s++) { const v = segX(A, B, cu.path[s], cu.path[s + 1]);
        if (v >= 0) return cu.t0 + cu.dur * (L[s] + v * Math.hypot(cu.path[s + 1][0] - cu.path[s][0], (cu.path[s + 1][1] - cu.path[s][1]) * this.h / this.w)) / tot; } return Infinity; };
      for (let m = 0; m < M; m++) this.cCut[m] = Math.min(this.cCut[m], hit(uv(this.ca[m]), uv(this.cb[m])));
      for (let j = 0; j < R - 1; j++) for (let i = 0; i < C - 1; i++) {
        const a = [i / (C - 1), j / (R - 1)], b = [(i + 1) / (C - 1), j / (R - 1)], c = [(i + 1) / (C - 1), (j + 1) / (R - 1)], d = [i / (C - 1), (j + 1) / (R - 1)];
        const q = j * (C - 1) + i;
        this.quadCut[q] = Math.min(this.quadCut[q], hit(a, b), hit(b, c), hit(c, d), hit(d, a), hit(a, c));
      }
    }
    this.nrm = new Float32Array(N * 3);
  }
  _advance(f) {
    const { cols: C, rows: R } = this, N = C * R, p = this.p, q = this.q, dt = 1 / (this.fps * this.sub);
    for (let m = 0; m < this.cOn.length; m++) if (this.cOn[m] && this.cCut[m] * this.fps <= f) this.cOn[m] = 0;
    for (let s = 0; s < this.sub; s++) {
      const t = (f - 1 + (s + 1) / this.sub) / this.fps;
      // aerodynamic force per triangle (on the node normals): F = drag * (n . (w - v)) n
      this._normals();
      const acc = new Float32Array(N * 3);
      for (let k = 0; k < N; k++) {
        acc[k * 3 + 1] = this.gravity;
        if (!this.wind) continue;
        const x = p[k * 3], y = p[k * 3 + 1], z = p[k * 3 + 2];
        const w = this.wind(x, y, z, t);
        const vx = (p[k * 3] - q[k * 3]) / dt, vy = (p[k * 3 + 1] - q[k * 3 + 1]) / dt, vz = (p[k * 3 + 2] - q[k * 3 + 2]) / dt;
        const rx = w[0] - vx, ry = w[1] - vy, rz = w[2] - vz;
        const nx = this.nrm[k * 3], ny = this.nrm[k * 3 + 1], nz = this.nrm[k * 3 + 2];
        const dn = rx * nx + ry * ny + rz * nz;
        acc[k * 3] += this.drag * dn * nx + this.lift * rx; acc[k * 3 + 1] += this.drag * dn * ny + this.lift * ry; acc[k * 3 + 2] += this.drag * dn * nz + this.lift * rz;
      }
      const damp = 1 - this.damping;
      for (let k = 0; k < N; k++) {
        if (!this.inv[k]) continue;
        for (let c = 0; c < 3; c++) { const i3 = k * 3 + c, cur = p[i3]; p[i3] = cur + (cur - q[i3]) * damp + acc[i3] * dt * dt; q[i3] = cur; }
      }
      if (this.pinAt) for (let k = 0; k < N; k++) if (!this.inv[k]) {
        const pos = this.pinAt(t, k % C, Math.floor(k / C), [this.rest[k * 3], this.rest[k * 3 + 1], this.rest[k * 3 + 2]]);
        q[k * 3] = p[k * 3]; q[k * 3 + 1] = p[k * 3 + 1]; q[k * 3 + 2] = p[k * 3 + 2];
        p[k * 3] = pos[0]; p[k * 3 + 1] = pos[1]; p[k * 3 + 2] = pos[2];
      }
      const { ca, cb, ck, cl, cOn, inv } = this, M = ca.length;
      for (let it = 0; it < this.iters; it++) {
        for (let m = 0; m < M; m++) {
          if (!cOn[m]) continue;
          const a = ca[m] * 3, b = cb[m] * 3, wa = inv[ca[m]], wb = inv[cb[m]], ws = wa + wb;
          if (!ws) continue;
          const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
          const k = (d - cl[m]) / d * ck[m] / ws;
          p[a] += dx * k * wa; p[a + 1] += dy * k * wa; p[a + 2] += dz * k * wa;
          p[b] -= dx * k * wb; p[b + 1] -= dy * k * wb; p[b + 2] -= dz * k * wb;
        }
      }
    }
  }
  _normals() {
    const { cols: C, rows: R } = this, p = this.p, n = this.nrm;
    for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) {
      const k = j * C + i, l = j * C + Math.max(0, i - 1), r = j * C + Math.min(C - 1, i + 1), u = Math.max(0, j - 1) * C + i, d = Math.min(R - 1, j + 1) * C + i;
      const ax = p[r * 3] - p[l * 3], ay = p[r * 3 + 1] - p[l * 3 + 1], az = p[r * 3 + 2] - p[l * 3 + 2];
      const bx = p[d * 3] - p[u * 3], by = p[d * 3 + 1] - p[u * 3 + 1], bz = p[d * 3 + 2] - p[u * 3 + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const L = Math.hypot(nx, ny, nz) + 1e-9;
      n[k * 3] = nx / L; n[k * 3 + 1] = ny / L; n[k * 3 + 2] = nz / L;
    }
  }
  _snap() { return new Float32Array(this.p); }
  _state() { return { p: new Float32Array(this.p), q: new Float32Array(this.q), cOn: new Uint8Array(this.cOn) }; }
  _restore(s) { this.p.set(s.p); this.q.set(s.q); this.cOn.set(s.cOn); }
}

// ---- WebGL helpers
function glc(w, h, opts = {}) {
  const cv = canvas(w, h);
  const gl = cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true, ...opts });
  if (!gl) throw new Error('webgl2 unavailable');
  return { cv, gl };
}
function prog(gl, vs, fs) {
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n')); return s; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace('[0]', '')] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}
function texFrom(gl, src, tex = null, { flip = true, mip = false, linear = true } = {}) {
  tex = tex || gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
const GLSL_NOISE = `
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++){ v += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return v; }
`;

// Cloth renderer: textured, lit, woven. One per cloth (owns a GL canvas the size of the frame).
export class ClothView {
  constructor(cloth, texture, { width = W, height = H, focal = 1800, light = [-0.45, -0.6, -0.65], color = [1, 1, 1], weave = 0.1, threads = 260,
    sheen = 0.35, ambient = 0.32, back = 0.55, grime = 0.12 } = {}) {
    Object.assign(this, { cloth, width, height, focal, light, color, weave, threads, sheen, ambient, back, grime });
    const { cv, gl } = glc(width, height, { antialias: true });
    this.cv = cv; this.gl = gl;
    this.pr = prog(gl, `#version 300 es
      in vec3 P; in vec3 N; in vec2 UV; uniform vec2 R; uniform float F; out vec3 n; out vec2 uv; out float z;
      void main(){ float s = F / (F + P.z); vec2 c = R * .5; vec2 q = c + (P.xy - c) * s;
        n = N; uv = UV; z = P.z; gl_Position = vec4(q.x / R.x * 2. - 1., 1. - q.y / R.y * 2., P.z / 4000., 1.); }`,
    `#version 300 es
      precision highp float; in vec3 n; in vec2 uv; in float z; out vec4 o;
      uniform sampler2D T; uniform vec3 L, COL; uniform float WEAVE, THR, SHEEN, AMB, BACK, GRIME, AO;
      ${GLSL_NOISE}
      void main(){
        vec3 N = normalize(-n); bool front = gl_FrontFacing; if (!front) N = -N;
        vec2 tuv = front ? uv : vec2(uv.x, uv.y);
        vec4 tx = texture(T, tuv);
        vec3 base = tx.rgb * COL;
        if (!front) base = mix(base, base * vec3(.75, .55, .5), .5) * BACK;     // printed through: darker, warmer
        float wv = sin(uv.x * THR * 6.2831) * sin(uv.y * THR * 1.7 * 6.2831);
        base *= 1. + WEAVE * (wv * .5 + (vn(uv * vec2(THR * .5, THR)) - .5));
        base *= 1. - GRIME * fbm(uv * 6.) ;
        vec3 l = normalize(L), v = vec3(0, 0, -1);
        float d = dot(N, l); float diff = max(d, 0.) * .85 + max(-d, 0.) * .18;       // thin fabric transmits a little
        float rim = pow(1. - abs(dot(N, v)), 2.5);
        vec3 h = normalize(l + v); float spec = pow(max(dot(N, h), 0.), 18.) * SHEEN;
        float fold = clamp(.55 + .45 * N.z * -1., 0., 1.);
        vec3 c = base * (AMB + diff) * mix(.7, 1., fold) + spec * vec3(1., .92, .85) + rim * SHEEN * .6 * base;
        o = vec4(c * tx.a, tx.a);
      }`);
    this.tex = texFrom(gl, texture, null, { flip: false, mip: true });
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const { cols: C, rows: Rr } = cloth, N = C * Rr;
    this.bP = gl.createBuffer(); this.bN = gl.createBuffer(); this.bU = gl.createBuffer(); this.bI = gl.createBuffer();
    const uvs = new Float32Array(N * 2);
    for (let k = 0; k < N; k++) { uvs[k * 2] = (k % C) / (C - 1); uvs[k * 2 + 1] = Math.floor(k / C) / (Rr - 1); }
    const bind = (b, loc, size, data) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); if (data) gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); };
    bind(this.bP, gl.getAttribLocation(this.pr.p, 'P'), 3, new Float32Array(N * 3));
    bind(this.bN, gl.getAttribLocation(this.pr.p, 'N'), 3, new Float32Array(N * 3));
    bind(this.bU, gl.getAttribLocation(this.pr.p, 'UV'), 2, uvs);
    this.idx = new Uint32Array((C - 1) * (Rr - 1) * 6);
  }
  render(t) {
    const gl = this.gl, cl = this.cloth, P = cl.at(t), { cols: C, rows: R } = cl;
    // normals from the cached positions
    const save = cl.p; cl.p = P; cl._normals(); cl.p = save;
    let n = 0; const f = cl.frameIndex(t);
    for (let j = 0; j < R - 1; j++) for (let i = 0; i < C - 1; i++) {
      if (cl.quadCut[j * (C - 1) + i] * cl.fps <= f) continue;
      const a = j * C + i, b = a + 1, c = a + C, d = c + 1;
      this.idx[n++] = a; this.idx[n++] = c; this.idx[n++] = b; this.idx[n++] = b; this.idx[n++] = c; this.idx[n++] = d;
    }
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.pr.p); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bP); gl.bufferData(gl.ARRAY_BUFFER, P, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bN); gl.bufferData(gl.ARRAY_BUFFER, cl.nrm, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bI); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.idx.subarray(0, n), gl.DYNAMIC_DRAW);
    const u = this.pr.u;
    gl.uniform2f(u.R, this.width, this.height); gl.uniform1f(u.F, this.focal);
    gl.uniform3fv(u.L, this.light); gl.uniform3fv(u.COL, this.color);
    gl.uniform1f(u.WEAVE, this.weave); gl.uniform1f(u.THR, this.threads); gl.uniform1f(u.SHEEN, this.sheen); gl.uniform1f(u.AMB, this.ambient);
    gl.uniform1f(u.BACK, this.back); gl.uniform1f(u.GRIME, this.grime);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(u.T, 0);
    gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_INT, 0);
    return this.cv;
  }
}

// ================================================================== STABLE FLUID (WebGL2)
// Velocity in px/s of the 1080x1920 frame, stored on a coarse grid; dye (rgb = coloured density,
// a = temperature) on a finer grid. emit(f, t) -> [{x, y, r, color:[r,g,b], temp, vx, vy} |
// {mask: canvas, color, temp, vx, vy}] is called every step; obstacle(f) -> canvas | null.
//   advection  MacCormack (forward + reverse trace, clamped to the source texel range): sharper curls
//              than semi-Lagrangian at the same grid, no new extrema.
//   pressure   warm-started from the previous step (the field persists) + one multigrid V-cycle
//              (weighted-Jacobi smoothing on 3 coarser levels) instead of 22-28 cold Jacobi sweeps.
//   emitters   all point emitters of a step are one batched pass (up to 16), mask emitters one pass each.
//   boundaries open top / bottom (p = 0) and clean-air inflow: a trace that leaves the domain reads
//              zero dye instead of smearing the edge row upward (the old bottom-edge streaks).
//   render     the dye is upsampled with a flow-advected curl-noise detail layer (a wavelet-turbulence
//              style fake): wisps finer than the grid that move with the flow, instead of a bigger sim.
const FVS = `#version 300 es
out vec2 v; void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); v = p; gl_Position = vec4(p * 2. - 1., 0., 1.); }`;
const FH = `#version 300 es
precision highp float; in vec2 v; out vec4 o;\n`;
// looks: constructor options (sim) + render options (look); Fluid.preset(name, overrides)
export const FLUID_LOOKS = {
  smoke: { sim: { vorticity: 16, buoyancy: 480, weight: 8, dyeDiss: 0.28, heatDiss: 0.3, velDiss: 0.05, open: { top: true, bottom: true } },
    look: { mode: 'smoke', dens: 3.0, detail: 1, shadow: 0.7, light: [-0.35, 1], amb: [0.16, 0.12, 0.12], sun: [1.9, 1.7, 1.5], rim: 0.9, rimc: [1, 0.55, 0.4], contrast: 0.25, dflow: 0.5 } },
  ink: { sim: { vorticity: 12, buoyancy: 0, weight: 60, dyeDiss: 0.08, heatDiss: 1, velDiss: 0.25, open: { top: false, bottom: false } },
    look: { mode: 'ink', dens: 3.2, detail: 1.2, shadow: 0.25, light: [0.3, 1], amb: [0.9, 0.86, 0.8], sun: [0.25, 0.22, 0.2], rim: 0, contrast: 0.8 } },
  fire: { sim: { vorticity: 22, buoyancy: 400, weight: 20, dyeDiss: 0.3, heatDiss: 1.6, velDiss: 0.2, open: { top: true, bottom: true } },
    look: { mode: 'fire', dens: 2.0, detail: 0.9, glow: 0.85, shadow: 0.3, light: [0, 1], amb: [0.1, 0.08, 0.08], sun: [0.5, 0.25, 0.2], rim: 0.3, rimc: [1, 0.4, 0.2], contrast: 0.3 } },
  dust: { sim: { vorticity: 20, buoyancy: 120, weight: 10, dyeDiss: 0.18, heatDiss: 0.8, velDiss: 0.35, open: { top: true, bottom: false } },
    look: { mode: 'smoke', dens: 2.4, detail: 1, shadow: 0.45, light: [0, -1], amb: [0.1, 0.1, 0.12], sun: [1.3, 0.45, 0.35], rim: 0.4, rimc: [1, 0.35, 0.25], contrast: 0.3 } },
};
export class Fluid {
  static preset(name, o = {}) {
    const P = FLUID_LOOKS[name]; if (!P) throw new Error('fluid preset ' + name);
    const f = new Fluid({ ...P.sim, ...o, open: { ...P.sim.open, ...(o.open || {}) } }); f.look = { ...P.look, ...(o.look || {}) }; return f;
  }
  constructor({ sim = [144, 256], dye = [360, 640], fps = 30, sub = 1, vorticity = 20, openTop = true, open = null, solver = 'mg', mg = {}, pressureIters = 22,
    mc = 1, velDiss = 0.15, dyeDiss = 0.25, heatDiss = 0.9, buoyancy = 260, weight = 40, emit = null, obstacle = null, every = 15, out = [W / 2, H / 2], look = {} } = {}) {
    open = { top: openTop, bottom: false, ...(open || {}) };
    Object.assign(this, { simRes: sim, dyeRes: dye, fps, sub, vorticity, open, solver, pressureIters, mc, velDiss, dyeDiss, heatDiss, buoyancy, weight, emit, obstacle, every, look });
    this.mgo = { levels: 3, pre: 2, post: 2, coarse: 8, w: 0.8, ...mg };
    const { cv, gl } = glc(out[0], out[1]);
    this.cv = cv; this.gl = gl; this.outRes = out;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('no float render targets');
    if (!gl.getExtension('OES_texture_float_linear')) console.warn('fluid: no float linear filtering');
    const P = fs => prog(gl, FVS, FH + GLSL_NOISE + fs);
    const NB = `float nb(sampler2D PRt, vec2 p, float c){ return texture(OB, p).a > .5 ? c : texture(PRt, p).x; }
      vec4 nbrs(sampler2D PRt, vec2 p, vec2 t, float c){
        float L = nb(PRt, p - vec2(t.x, 0), c), R = nb(PRt, p + vec2(t.x, 0), c), B = nb(PRt, p - vec2(0, t.y), c), T = nb(PRt, p + vec2(0, t.y), c);
        if (p.y - t.y < 0. && open.x > .5) B = -c; if (p.y + t.y > 1. && open.y > .5) T = -c;    // open bottom / top: p = 0 on the boundary face (ghost = -c), the same place on every MG level
        return vec4(L, R, B, T); }`;
    this.P = {
      splat: P(`uniform sampler2D S, M; uniform float useM, mixv; uniform vec4 A;
        void main(){ vec4 b = texture(S, v); float k = texture(M, v).a;
          o = mixv > 0. ? vec4(mix(b.xy, A.xy, clamp(k * mixv, 0., 1.)), 0, 1) : b + A * k; }`),
      // additive dye sources, drawn in place (blend ONE, ONE) inside a scissor box: no full-res ping-pong
      splatAdd: P(`uniform sampler2D M; uniform float useM; uniform vec4 A, PC; uniform vec2 asp;
        void main(){ float k; if (useM > .5) k = texture(M, v).a; else { vec2 d = (v - PC.xy) * asp; k = exp(-dot(d, d) / (PC.z * PC.z)); } o = A * k; }`),
      // batched point emitters: PC = (x, y, r, jet) in uv, PA = amount (dye) or target velocity (vel)
      splatN: P(`uniform sampler2D S; uniform vec4 PC[16]; uniform vec4 PA[16]; uniform float NP, vel; uniform vec2 asp;
        void main(){ vec4 b = texture(S, v);
          for (int i = 0; i < 16; i++){ if (float(i) >= NP) break;
            vec2 d = (v - PC[i].xy) * asp; float k = exp(-dot(d, d) / (PC[i].z * PC[i].z));
            if (vel > .5) b.xy = mix(b.xy, PA[i].xy, clamp(k * PC[i].w, 0., 1.)); else b += PA[i] * k; }
          o = vel > .5 ? vec4(b.xy, 0, 1) : b; }`),
      curl: P(`uniform sampler2D U; uniform vec2 tx; uniform float h;
        void main(){ float L = texture(U, v - vec2(tx.x, 0)).y, R = texture(U, v + vec2(tx.x, 0)).y, B = texture(U, v - vec2(0, tx.y)).x, T = texture(U, v + vec2(0, tx.y)).x;
          o = vec4((R - L - T + B) / (2. * h), 0, 0, 1); }`),
      vort: P(`uniform sampler2D U, CU, D, OB; uniform vec2 tx; uniform float h, eps, dt, buoy, wgt;
        void main(){ float L = abs(texture(CU, v - vec2(tx.x, 0)).x), R = abs(texture(CU, v + vec2(tx.x, 0)).x), B = abs(texture(CU, v - vec2(0, tx.y)).x), T = abs(texture(CU, v + vec2(0, tx.y)).x);
          float c = texture(CU, v).x; vec2 f = vec2(T - B, R - L) * .5; f /= length(f) + 1e-5; f *= eps * c * vec2(1, -1) * h;
          vec2 u = texture(U, v).xy + f * dt;
          vec4 d = texture(D, v); float den = max(max(d.r, d.g), d.b);
          u.y += (d.a * buoy - den * wgt) * dt;
          if (texture(OB, v).a > .5) u = vec2(0);
          o = vec4(u, 0, 1); }`),
      div: P(`uniform sampler2D U, OB; uniform vec2 tx; uniform float h;
        vec2 vel(vec2 p){ return texture(OB, p).a > .5 ? vec2(0) : texture(U, p).xy; }
        void main(){ float L = vel(v - vec2(tx.x, 0)).x, R = vel(v + vec2(tx.x, 0)).x, B = vel(v - vec2(0, tx.y)).y, T = vel(v + vec2(0, tx.y)).y;
          o = vec4((R - L + T - B) / (2. * h), 0, 0, 1); }`),
      // weighted Jacobi on any level (PR = current estimate, DV = right-hand side)
      // eps: a faint screening term (lap - k) p = div; enclosed fluid pockets inside an obstacle would otherwise
      // be singular (pure Neumann) and their pressure drifts, which the coarse levels then spread
      jac: P(`uniform sampler2D PR, DV, OB; uniform vec2 tx, open; uniform float h, w, eps; ${NB}
        void main(){ float c = texture(PR, v).x; vec4 n = nbrs(PR, v, tx, c);
          float pn = (n.x + n.y + n.z + n.w - h * h * texture(DV, v).x) / (4. + eps);
          o = vec4(texture(OB, v).a > .5 ? c : mix(c, pn, w), 0, 0, 1); }`),
      // residual of the fine level, restricted (2x2 average) onto the coarse texel
      restrict: P(`uniform sampler2D PR, DV, OB; uniform vec2 tx, open; uniform float h, eps; ${NB}
        float res(vec2 p){ if (texture(OB, p).a > .5) return 0.; float c = texture(PR, p).x; vec4 n = nbrs(PR, p, tx, c);
          return texture(DV, p).x - (n.x + n.y + n.z + n.w - (4. + eps) * c) / (h * h); }
        void main(){ vec2 d = tx * .5;
          o = vec4(.25 * (res(v + vec2(-d.x, -d.y)) + res(v + vec2(d.x, -d.y)) + res(v + vec2(-d.x, d.y)) + res(v + d)), 0, 0, 1); }`),
      // coarse obstacle: solid when at least 3 of the 4 children are solid
      obDown: P(`uniform sampler2D S; uniform vec2 tx; void main(){ vec2 d = tx * .5;
          float n = step(.5, texture(S, v + vec2(-d.x, -d.y)).a) + step(.5, texture(S, v + vec2(d.x, -d.y)).a) + step(.5, texture(S, v + vec2(-d.x, d.y)).a) + step(.5, texture(S, v + d).a);
          o = vec4(0, 0, 0, n >= 3. ? 1. : 0.); }`),
      prolong: P(`uniform sampler2D PR, E, OB; void main(){ float c = texture(PR, v).x; o = vec4(texture(OB, v).a > .5 ? c : c + texture(E, v).x, 0, 0, 1); }`),
      grad: P(`uniform sampler2D PR, U, OB; uniform vec2 tx, open; uniform float h; ${NB}
        void main(){ float c = texture(PR, v).x; vec4 n = nbrs(PR, v, tx, c);
          vec2 u = texture(U, v).xy - vec2(n.y - n.x, n.w - n.z) / (2. * h); if (texture(OB, v).a > .5) u = vec2(0); o = vec4(u, 0, 1); }`),
      // MacCormack advection; bnd = (left, right, bottom, top): 1 -> a trace from outside reads clean (zero) fluid
      adv: P(`uniform sampler2D U, S, OB; uniform vec2 px, sres; uniform float dt, mc; uniform vec4 diss, bnd;
        bool outside(vec2 p){ return (p.x < 0. && bnd.x > .5) || (p.x > 1. && bnd.y > .5) || (p.y < 0. && bnd.z > .5) || (p.y > 1. && bnd.w > .5); }
        vec4 S0(vec2 p){ return outside(p) ? vec4(0) : texture(S, p); }
        void main(){
          if (texture(OB, v).a > .5) { o = vec4(0); return; }
          vec2 u0 = texture(U, v).xy, p0 = v - dt * u0 / px;
          vec4 r = S0(p0);
          if (mc > 0. && !outside(p0)) {
            vec2 pf = v + dt * u0 / px;
            vec4 bk = S0(pf - dt * texture(U, pf).xy / px);
            r = r + .5 * mc * (texture(S, v) - bk);
            ivec2 mx = ivec2(sres) - 1, i0 = ivec2(floor(p0 * sres - .5));
            vec4 a = texelFetch(S, clamp(i0, ivec2(0), mx), 0), b = texelFetch(S, clamp(i0 + ivec2(1, 0), ivec2(0), mx), 0),
                 c = texelFetch(S, clamp(i0 + ivec2(0, 1), ivec2(0), mx), 0), d = texelFetch(S, clamp(i0 + ivec2(1, 1), ivec2(0), mx), 0);
            r = clamp(r, min(min(a, b), min(c, d)), max(max(a, b), max(c, d)));
          }
          o = r / (1. + diss * dt); }`),
      // exact copy (texelFetch): a filtered texture() at texel centres is not bit-exact on SwiftShader, and an inexact
      // checkpoint made a still restored from it differ from the clip (caught by web/simtest.mjs)
      copy: P(`uniform sampler2D S; void main(){ o = texelFetch(S, ivec2(gl_FragCoord.xy), 0); }`),
      // tileable curl noise (xy = curl of a periodic fbm potential, z = the potential), baked once
      curlBake: P(`uniform float per;
        float pn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          float a = h12(mod(i, per)), b = h12(mod(i + vec2(1, 0), per)), c = h12(mod(i + vec2(0, 1), per)), d = h12(mod(i + vec2(1, 1), per));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
        float pot(vec2 p){ return pn(p) * .6 + pn(p * 2. + 17.) * .28 * 1. + pn(p * 4. + 5.) * .12; }
        void main(){ vec2 p = v * per; float e = .02;
          float dy = pot(p + vec2(0, e)) - pot(p - vec2(0, e)), dx = pot(p + vec2(e, 0)) - pot(p - vec2(e, 0));
          o = vec4(vec2(dy, -dx) / (2. * e) * .35, pot(p), 1); }`),
      show: P(`uniform sampler2D D, U, CN; uniform vec2 tx, R, px; uniform float mode, dens, t, detail, glow, shadow, rim, contrast, dscale, dflow; uniform vec2 L; uniform vec3 amb, sun, tint, rimc;
        vec3 bb(float x){ x = clamp(x, 0., 1.6);
          vec3 c = mix(vec3(0), vec3(.35, .01, .02), smoothstep(0., .18, x));
          c = mix(c, vec3(.79, .07, .12), smoothstep(.12, .38, x)); c = mix(c, vec3(1., .42, .08), smoothstep(.35, .7, x));
          c = mix(c, vec3(1., .82, .45), smoothstep(.65, 1.05, x)); c = mix(c, vec3(1., .97, .9), smoothstep(1., 1.5, x)); return c; }
        void main(){
          vec2 w = v; float brk = 1.;
          if (detail > 0.) {
            // flow-mapped curl noise: two phases slide along the local velocity and cross-fade, so the
            // sub-grid wisps travel with the smoke instead of swimming over it
            vec2 asp = vec2(1., R.y / R.x), u = texture(U, v).xy / px, q = v * asp * dscale;
            float T = .3, p1 = fract(t / T), p2 = fract(t / T + .5), wa = 1. - abs(2. * p1 - 1.);
            vec3 a = texture(CN, q - u * asp * dscale * p1 * T * dflow).xyz, b = texture(CN, q + .5 - u * asp * dscale * p2 * T * dflow).xyz;
            vec3 n1 = a * wa + b * (1. - wa);
            vec3 n2 = texture(CN, q * 2.37 + n1.xy * .08 + vec2(0, -t * .05)).xyz;
            float e = clamp(length(u * px) / 500., .35, 1.);
            w += (n1.xy * 3.2 + n2.xy * 1.3) * tx * detail * e;
            brk = mix(1., .55 + .9 * (n1.z * .65 + n2.z * .35), clamp(detail * .6, 0., 1.));
          }
          vec4 d = texture(D, w);
          vec3 cd = d.rgb * brk; float den = max(max(cd.r, cd.g), cd.b);
          // self shadow: march toward the light
          float jt = h12(gl_FragCoord.xy + fract(t * 7.3) * 97.);                 // jittered taps: no banding along the light
          float acc = 0.; for (int i = 1; i <= 6; i++){ vec4 s = texture(D, w + L * (float(i) - .5 + jt) * tx * 3.5); acc += max(max(s.r, s.g), s.b); }
          float Tr = exp(-acc * shadow);
          float a = 1. - exp(-den * dens);
          a = mix(a, smoothstep(.04, .8, a), contrast);
          vec3 alb = cd / max(den, 1e-4);
          vec3 lit = alb * (amb + sun * Tr) + rimc * rim * 4. * a * (1. - a) * Tr;          // thin edges catch the backlight
          vec3 c;
          if (mode < .5) { c = lit * a; }                                         // smoke / ink: premultiplied
          else { float te = d.a * brk; vec3 e = bb(te) * smoothstep(.02, .3, te) * glow;       // fire: emission over smoke
            c = lit * a * (1. - smoothstep(.1, .6, te)) + e; a = max(a * (1. - smoothstep(.1, .6, te)), clamp(max(e.r, max(e.g, e.b)), 0., 1.)); }
          c *= tint;
          o = vec4(c, a); }`),
    };
    const quad = gl.createVertexArray(); gl.bindVertexArray(quad);
    this.targets();
    this.maskTex = new WeakMap(); this.obTex = null; this.obSrc = undefined;
    this.f = -1; this.ckpt = new Map(); this.stepMs = 0; this.steps = 0;
  }
  _tex(w, h, fmt, data = null, wrap = null) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    const F = { rg: [gl.RG32F, gl.RG, gl.FLOAT], rgba: [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT], r: [gl.R32F, gl.RED, gl.FLOAT] }[fmt];
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, F[0], w, h, 0, F[1], F[2], data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wr = wrap || gl.CLAMP_TO_EDGE; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    if (!data) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    return { t, fb, w, h, fmt };
  }
  _del(x) { this.gl.deleteTexture(x.t); this.gl.deleteFramebuffer(x.fb); }
  _pair(w, h, fmt) { const a = this._tex(w, h, fmt), b = this._tex(w, h, fmt); return { r: a, w: b, swap() { const x = this.r; this.r = this.w; this.w = x; } }; }
  targets() {
    const [sw, sh] = this.simRes, [dw, dh] = this.dyeRes, gl = this.gl;
    this.U = this._pair(sw, sh, 'rg'); this.D = this._pair(dw, dh, 'rgba'); this.PR = this._pair(sw, sh, 'r');
    this.DV = this._tex(sw, sh, 'r'); this.CU = this._tex(sw, sh, 'r');
    // multigrid levels (scratch: rebuilt every V-cycle, never part of the state)
    this.levels = [];
    let w = sw, h = sh;
    for (let l = 1; l <= this.mgo.levels && w % 2 === 0 && h % 2 === 0 && w >= 8; l++) { w /= 2; h /= 2; this.levels.push({ E: this._pair(w, h, 'r'), RHS: this._tex(w, h, 'r'), OB: this._tex(w, h, 'rgba'), w, h }); }
    this.obLv = null;
    this.blankOb = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.blankOb);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.CN = this._tex(256, 256, 'rgba', null, gl.REPEAT);
    this._run(this.P.curlBake, this.CN, { per: 16 });
  }
  _run(pr, target, uni) {
    const gl = this.gl; gl.useProgram(pr.p);
    let unit = 0;
    for (const [k, val] of Object.entries(uni)) {
      const loc = pr.u[k]; if (loc == null) continue;
      if (val && val.t !== undefined && val.fb !== undefined) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, val.t); gl.uniform1i(loc, unit++); }
      else if (val instanceof WebGLTexture) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, val); gl.uniform1i(loc, unit++); }
      else if (typeof val === 'number') gl.uniform1f(loc, val);
      else if (val.length === 2) gl.uniform2fv(loc, val); else if (val.length === 3) gl.uniform3fv(loc, val); else gl.uniform4fv(loc, val);
    }
    if (target) { gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb); gl.viewport(0, 0, target.w, target.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.outRes[0], this.outRes[1]); }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // additive splat into the current dye texture, scissored to the gaussian's 3-sigma box (p = null: whole target)
  _add(p, uni) {
    const gl = this.gl, [dw, dh] = this.dyeRes;
    if (p) {
      const rx = p[2] * 3.2 * H / W, ry = p[2] * 3.2;
      const x0 = Math.max(0, Math.floor((p[0] - rx) * dw)), x1 = Math.min(dw, Math.ceil((p[0] + rx) * dw)), y0 = Math.max(0, Math.floor((p[1] - ry) * dh)), y1 = Math.min(dh, Math.ceil((p[1] + ry) * dh));
      if (x1 <= x0 || y1 <= y0) return;
      gl.enable(gl.SCISSOR_TEST); gl.scissor(x0, y0, x1 - x0, y1 - y0);
    }
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
    this._run(this.P.splatAdd, this.D.r, uni);
    gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST);
  }
  _ob(f) {
    const src = this.obstacle ? this.obstacle(f) : null;
    if (src !== this.obSrc) {
      this.obSrc = src; this.obTex = src ? texFrom(this.gl, src, this.obTex) : null;
      // per-level obstacle masks for the multigrid (rebuilt only when the obstacle canvas changes)
      let prev = this.obTex || this.blankOb, ptx = [1 / this.simRes[0], 1 / this.simRes[1]];
      for (const l of this.levels) { if (src) this._run(this.P.obDown, l.OB, { S: prev, tx: ptx }); else this._clear(l.OB); prev = l.OB; ptx = [1 / l.w, 1 / l.h]; }
    }
    return this.obTex || this.blankOb;
  }
  _clear(x) { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, x.fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  // one multigrid V-cycle for lap(p) = div, warm-started from the previous step's pressure
  _project(OB, tx, h) {
    const P = this.P, op = [this.open.bottom ? 1 : 0, this.open.top ? 1 : 0], m = this.mgo, kap = (m.screen ?? 0.002) / (h * h);
    const smooth = (pair, rhs, ob, t, hh, n, w) => { for (let i = 0; i < n; i++) { this._run(P.jac, pair.w, { PR: pair.r, DV: rhs, OB: ob, tx: t, h: hh, open: op, w, eps: kap * hh * hh }); pair.swap(); } };
    if (this.solver !== 'mg' || !this.levels.length) { smooth(this.PR, this.DV, OB, tx, h, this.pressureIters, 1); return; }
    const L = [{ E: this.PR, RHS: this.DV, OB, tx, h }, ...this.levels.map((l, k) => ({ E: l.E, RHS: l.RHS, OB: this.obSrc ? l.OB : this.blankOb, tx: [1 / l.w, 1 / l.h], h: h * 2 ** (k + 1) }))];
    const down = k => {
      const a = L[k];
      if (k === L.length - 1) { smooth(a.E, a.RHS, a.OB, a.tx, a.h, m.coarse, 1); return; }
      smooth(a.E, a.RHS, a.OB, a.tx, a.h, m.pre, m.w);
      const b = L[k + 1];
      this._run(P.restrict, b.RHS, { PR: a.E.r, DV: a.RHS, OB: a.OB, tx: a.tx, h: a.h, open: op, eps: kap * a.h * a.h });
      this._clear(b.E.r);
      down(k + 1);
      this._run(P.prolong, a.E.w, { PR: a.E.r, E: b.E.r, OB: a.OB }); a.E.swap();
      smooth(a.E, a.RHS, a.OB, a.tx, a.h, m.post, m.w);
    };
    down(0);
  }
  _step(f) {
    const t = f / this.fps, dt = 1 / (this.fps * this.sub), [sw, sh] = this.simRes, h = W / sw, tx = [1 / sw, 1 / sh];
    const OB = this._ob(f), P = this.P, asp = [W / H, 1];
    const dyeB = [1, 1, 1, 1], velB = [0, 0, this.open.bottom ? 0 : 0, 0];
    for (let s = 0; s < this.sub; s++) {
      // sources: points batched (16 per pass), masks one pass each
      const pts = [], vps = [];
      if (this.emit) for (const e of this.emit(f, t) || []) {
        const col = e.color || [0, 0, 0];
        if (e.mask) {
          let mt = this.maskTex.get(e.mask); if (!mt) { mt = texFrom(this.gl, e.mask); this.maskTex.set(e.mask, mt); }
          this._add(null, { M: mt, useM: 1, A: [col[0] * dt, col[1] * dt, col[2] * dt, (e.temp || 0) * dt], PC: [0, 0, 1, 0], asp });
          if (e.vx || e.vy) { this._run(P.splat, this.U.w, { S: this.U.r, M: mt, mixv: e.jet ?? 0.5, A: [e.vx || 0, -(e.vy || 0), 0, 0] }); this.U.swap(); }
          continue;
        }
        const x = e.x / W, y = 1 - e.y / H, r = (e.r || 40) / H;
        pts.push([x, y, r, 0, col[0] * dt, col[1] * dt, col[2] * dt, (e.temp || 0) * dt]);
        if (e.vx || e.vy) vps.push([x, y, r * 1.2, e.jet ?? 0.6, e.vx || 0, -(e.vy || 0), 0, 0]);
      }
      const batch = (list, pair, vel) => {
        for (let i = 0; i < list.length; i += 16) {
          const chunk = list.slice(i, i + 16), PC = new Float32Array(64), PA = new Float32Array(64);
          chunk.forEach((p, k) => { PC.set(p.slice(0, 4), k * 4); PA.set(p.slice(4), k * 4); });
          this._run(P.splatN, pair.w, { S: pair.r, PC, PA, NP: chunk.length, vel: vel ? 1 : 0, asp }); pair.swap();
        }
      };
      for (const p of pts) this._add(p, { M: this.blankOb, useM: 0, A: p.slice(4), PC: p.slice(0, 4), asp });
      batch(vps, this.U, true);
      this._run(P.curl, this.CU, { U: this.U.r, tx, h });
      this._run(P.vort, this.U.w, { U: this.U.r, CU: this.CU, D: this.D.r, OB, tx, h, eps: this.vorticity, dt, buoy: this.buoyancy, wgt: this.weight }); this.U.swap();
      this._run(P.div, this.DV, { U: this.U.r, OB, tx, h });
      this._project(OB, tx, h);
      this._run(P.grad, this.U.w, { PR: this.PR.r, U: this.U.r, OB, tx, h, open: [this.open.bottom ? 1 : 0, this.open.top ? 1 : 0] }); this.U.swap();
      // dye rides the divergence-free field; then the field advects itself
      this._run(P.adv, this.D.w, { U: this.U.r, S: this.D.r, OB, px: [W, H], sres: this.dyeRes, dt, mc: this.mc, bnd: dyeB, diss: [this.dyeDiss, this.dyeDiss, this.dyeDiss, this.heatDiss] }); this.D.swap();
      this._run(P.adv, this.U.w, { U: this.U.r, S: this.U.r, OB, px: [W, H], sres: this.simRes, dt, mc: this.mc, bnd: velB, diss: [this.velDiss, this.velDiss, 0, 0] }); this.U.swap();
    }
  }
  _save(f) {
    if (this.ckpt.has(f)) return;
    const c = { U: this._tex(...this.simRes, 'rg'), D: this._tex(...this.dyeRes, 'rgba'), PR: this._tex(...this.simRes, 'r') };
    this._run(this.P.copy, c.U, { S: this.U.r }); this._run(this.P.copy, c.D, { S: this.D.r }); this._run(this.P.copy, c.PR, { S: this.PR.r });
    this.ckpt.set(f, c);
  }
  _load(f) {
    const c = this.ckpt.get(f);
    this._run(this.P.copy, this.U.r, { S: c.U }); this._run(this.P.copy, this.D.r, { S: c.D }); this._run(this.P.copy, this.PR.r, { S: c.PR });
    this.f = f;
  }
  _reset() { for (const x of [this.U.r, this.U.w, this.D.r, this.D.w, this.PR.r, this.PR.w]) this._clear(x); this.f = 0; }
  // bring the state to frame i (replaying from the nearest checkpoint when seeking backwards)
  seek(i) {
    if (i < this.f || this.f < 0) {
      let best = -1; for (const k of this.ckpt.keys()) if (k <= i && k > best) best = k;
      if (best >= 0) this._load(best); else this._reset();
    }
    const long = i - this.f > 4, px = new Float32Array(4);
    while (this.f < i) {
      const t0 = performance.now();
      this._step(this.f + 1); this.f++; this.steps++;
      // long replays: drain the GPU queue every few steps so the work completes inside renderFrame
      // (a caller's screenshot timeout would otherwise see one giant queued batch)
      if (long && this.f % 4 === 0) { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, this.U.r.fb); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px); }
      if (this.f % this.every === 0) this._save(this.f);
      this.stepMs = this.stepMs * 0.8 + (performance.now() - t0) * 0.2;
    }
  }
  frameIndex(t) { return Math.max(0, Math.round(t * this.fps)); }
  // drop every checkpoint (GPU memory); the state stays where it is
  free() { for (const c of this.ckpt.values()) { this._del(c.U); this._del(c.D); this._del(c.PR); } this.ckpt.clear(); this.f = -1; }
  _read(x) {
    const gl = this.gl, out = new Float32Array(x.w * x.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, x.fb); gl.readPixels(0, 0, x.w, x.h, gl.RGBA, gl.FLOAT, out); return out;
  }
  // checksum of the state at t (velocity + dye), for the determinism test
  hashAt(t) { this.seek(this.frameIndex(t)); return hashBytes([this._read(this.U.r), this._read(this.D.r)]); }
  exportState() {
    const ck = [];
    for (const [f, c] of this.ckpt) {
      const u = this._read(c.U), p = this._read(c.PR), d = this._read(c.D), n = c.U.w * c.U.h;
      const U2 = new Float32Array(n * 2), P1 = new Float32Array(n), D2 = new Uint16Array(d.length);
      for (let i = 0; i < n; i++) { U2[i * 2] = u[i * 4]; U2[i * 2 + 1] = u[i * 4 + 1]; P1[i] = p[i * 4]; }
      for (let i = 0; i < d.length; i++) D2[i] = toHalf(d[i]);
      ck.push({ f, U: U2, PR: P1, D: D2 });
    }
    return { ckpts: ck };
  }
  importState(o) {
    this.free();
    for (const { f, U, PR, D } of o.ckpts) this.ckpt.set(f, { U: this._tex(...this.simRes, 'rg', U), PR: this._tex(...this.simRes, 'r', PR), D: this._tex(...this.dyeRes, 'rgba', D) });
  }
  // render the state at time t into the fluid's GL canvas and return it (premultiplied RGBA)
  render(t, o = {}) {
    const { mode = 'smoke', dens = 2.2, detail = 0.6, glow = 1.4, shadow = 0.35, light = [0.45, 0.8], amb = [0.28, 0.22, 0.22], sun = [1.1, 0.95, 0.85], tint = [1, 1, 1],
      rim = 0, rimc = [1, 0.6, 0.45], contrast = 0, dscale = 2.6, dflow = 1 } = { ...this.look, ...o };
    const i = this.frameIndex(t); this.seek(i);
    const ll = Math.hypot(light[0], light[1]);
    this._run(this.P.show, null, { D: this.D.r, U: this.U.r, CN: this.CN, tx: [1 / this.dyeRes[0], 1 / this.dyeRes[1]], R: this.outRes, px: [W, H], mode: mode === 'fire' ? 1 : 0, dens, t, detail, glow, shadow,
      L: [light[0] / ll, light[1] / ll], amb, sun, tint, rim, rimc, contrast, dscale, dflow });
    return this.cv;
  }
}

// ================================================================== FLAMES (stateless GPU fire from a mask)
export class Flames {
  constructor({ res = [540, 960] } = {}) {
    const { cv, gl } = glc(res[0], res[1]); this.cv = cv; this.gl = gl; this.res = res;
    this.pr = prog(gl, FVS, FH + GLSL_NOISE + `uniform sampler2D M; uniform float t, height, turb, speed, intensity, seed, cool; uniform vec2 R;
      vec3 bb(float x){ x = clamp(x, 0., 1.6);
        vec3 c = mix(vec3(0), vec3(.35, .01, .02), smoothstep(0., .15, x));
        c = mix(c, vec3(.79, .07, .12), smoothstep(.1, .35, x)); c = mix(c, vec3(1., .42, .08), smoothstep(.32, .68, x));
        c = mix(c, vec3(1., .8, .42), smoothstep(.62, 1., x)); c = mix(c, vec3(1., .97, .9), smoothstep(.95, 1.4, x)); return c; }
      void main(){
        float asp = R.y / R.x; float acc = 0.;
        // look downward through a turbulent column for fuel. The turbulence field is evaluated once per
        // pixel (2 x 4-octave fbm); each of the 18 jittered taps only adds one value-noise lookup.
        vec2 q = v * vec2(1., asp) * 5. + vec2(seed, -t * speed);
        vec2 D = vec2(fbm(q) - .5, fbm(q * 2.1 + vec2(3.1, 7.7) - t * speed * .6) - .5);
        float j = h12(gl_FragCoord.xy + fract(t * 7.) * 91.);
        for (int i = 0; i < 18; i++){
          float k = (float(i) + j) / 18.; float dy = k * height;
          float n3 = vn(q * 3. + vec2(0., dy * 30.)) - .5;
          vec2 s = v - vec2(0., dy) + vec2((D.x + n3 * .5) * turb * (0.3 + k), D.y * turb * .4 * k);
          float m = texture(M, s).a;
          acc += m * exp(-k * cool) * (1. - k * .55);
        }
        acc *= 14. / 18.;
        acc /= 5.2;
        float flick = .75 + .5 * fbm(v * vec2(3., 1.) * 4. + vec2(0, -t * speed * 1.7));
        float te = acc * flick * intensity;
        vec3 c = bb(te) * smoothstep(.03, .25, te);
        o = vec4(c, clamp(max(c.r, max(c.g, c.b)), 0., 1.)); }`);
    gl.bindVertexArray(gl.createVertexArray());
    this.tex = null; this.src = null;
  }
  // mask: canvas whose alpha is fuel (any size, frame-aligned). Returns the fire canvas (additive).
  render(mask, t, { height = 0.16, turb = 0.09, speed = 1.3, intensity = 1.0, seed = 0, cool = 2.2, dirty = false } = {}) {
    const gl = this.gl;
    if (mask !== this.src || dirty) { this.tex = texFrom(gl, mask, this.tex); this.src = mask; }
    gl.useProgram(this.pr.p); gl.viewport(0, 0, ...this.res);
    const u = this.pr.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(u.M, 0);
    gl.uniform1f(u.t, t); gl.uniform1f(u.height, height); gl.uniform1f(u.turb, turb); gl.uniform1f(u.speed, speed); gl.uniform1f(u.intensity, intensity);
    gl.uniform1f(u.seed, seed); gl.uniform1f(u.cool, cool); gl.uniform2f(u.R, ...this.res);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.cv;
  }
}

// fuel from a silhouette: only its upward-facing rim burns (mask minus itself shifted down by `depth`)
export function rimFuel(src, out, depth = 10) {
  const g = out.getContext('2d'); g.clearRect(0, 0, out.width, out.height);
  g.drawImage(src, 0, 0, out.width, out.height);
  g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.85; g.drawImage(src, 0, depth, out.width, out.height);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; return out;
}

// ================================================================== LIGHTNING + CRACKS
// bolt(): midpoint displacement between two points, with forked branches. Each segment carries
// `o` (arrival order 0..1 along the leader) and `w` (intensity) so the strike can grow and flicker.
export function bolt(x0, y0, x1, y1, { seed = 1, detail = 7, rough = 0.36, branch = 0.55, depth = 3, w = 1 } = {}) {
  const r = rng(seed), segs = [];
  function mid(a, b, dispScale, lvl, out) {
    if (lvl === 0) { out.push([a, b]); return; }
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    const off = (r() - 0.5) * 2 * L * dispScale;
    const m = [(a[0] + b[0]) / 2 - dy / L * off, (a[1] + b[1]) / 2 + dx / L * off, (a[2] + b[2]) / 2];
    mid(a, m, dispScale, lvl - 1, out); mid(m, b, dispScale, lvl - 1, out);
  }
  function arm(a, b, o0, o1, wt, d) {
    const pts = []; mid([a[0], a[1], o0], [b[0], b[1], o1], rough, detail - (3 - d), pts);
    for (const [p, q] of pts) segs.push({ x0: p[0], y0: p[1], x1: q[0], y1: q[1], o: q[2], w: wt });
    if (d <= 0) return;
    for (let k = 1; k < pts.length - 1; k++) {
      if (r() > branch * 4 / pts.length) continue;
      const p = pts[k][1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) * (0.18 + 0.35 * r());
      const base = Math.atan2(b[1] - a[1], b[0] - a[0]), ang = base + (r() < 0.5 ? -1 : 1) * (0.35 + r() * 0.6);
      arm([p[0], p[1]], [p[0] + Math.cos(ang) * L, p[1] + Math.sin(ang) * L], p[2], p[2] + (o1 - o0) * 0.5, wt * 0.55, d - 1);
    }
  }
  arm([x0, y0], [x1, y1], 0, 1, w, depth);
  return segs;
}
// L-system crack: F -> F[+F]F[-F]F with jittered angles; grows by `o` like bolt().
export function crack(x, y, { seed = 1, angle = Math.PI / 2, len = 600, gens = 4, spread = 0.55, jitter = 0.35 } = {}) {
  const r = rng(seed), segs = [];
  let str = 'F';
  for (let g = 0; g < gens; g++) str = str.replace(/F/g, () => (r() < 0.7 ? 'F[+F]F[-F]F' : r() < 0.5 ? 'F[+F]F' : 'FF[-F]'));
  const n = (str.match(/F/g) || []).length, step = len / Math.pow(3, gens) * 1.6;
  const st = []; let px = x, py = y, a = angle, o = 0, w = 1, depth = 0;
  for (const c of str) {
    if (c === 'F') { a += (r() - 0.5) * jitter; const nx = px + Math.cos(a) * step, ny = py + Math.sin(a) * step; segs.push({ x0: px, y0: py, x1: nx, y1: ny, o: o, w }); px = nx; py = ny; o += 1 / n * 2.2 / (1 + depth * 0.4); }
    else if (c === '+') a += spread * (0.6 + r() * 0.8);
    else if (c === '-') a -= spread * (0.6 + r() * 0.8);
    else if (c === '[') { st.push([px, py, a, o, w, depth]); w *= 0.62; depth++; }
    else if (c === ']') [px, py, a, o, w, depth] = st.pop();
  }
  const mo = Math.max(...segs.map(s => s.o)); for (const s of segs) s.o /= mo;
  return segs;
}
// draw a bolt/crack. grow 0..1 reveals by arrival order; heat scales brightness (return stroke = 1+).
// Glow = three wide low-alpha additive strokes straight onto the target. Measured on SwiftShader: a
// 40 px stroke of 2k segments on the main canvas costs ~10 ms, while any per-frame offscreen 2D
// canvas (or the blur filter) costs 150-300 ms to draw back, so there is no glow buffer.
export function drawBolt(ctx, segs, o = {}) { drawBolts(ctx, [{ segs, ...o }], o); }
export function drawBolts(ctx, list, { core = '#fffaf2', color = 'rgba(255,70,90,1)', glow = 1, blur = 7, mode = 'lighter' } = {}) {
  const items = list.map(b => ({ ...b, heat: b.heat ?? 1, vis: b.segs.filter(s => s.o <= (b.grow ?? 1)) })).filter(b => b.heat > 0.01 && b.vis.length);
  if (!items.length) return;
  if (glow > 0) {
    ctx.save(); ctx.globalCompositeOperation = mode; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const it of items) {
      ctx.strokeStyle = it.color || color;
      for (const [wk, a] of [[blur * 3.2, 0.045], [blur * 1.6, 0.09], [blur * 0.7, 0.2]]) {
        ctx.lineWidth = (it.width || 5) * wk; ctx.globalAlpha = clamp(a * it.heat * glow);
        ctx.beginPath(); for (const s of it.vis) if (s.w > 0.2) { ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); } ctx.stroke();
      }
    }
    ctx.restore();
  }
  ctx.save(); ctx.globalCompositeOperation = mode; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const it of items) {
    const width = it.width || 5;
    for (const [wk, col, a] of [[2.4, it.color || color, 0.8], [1, it.core || core, 1]]) {
      ctx.strokeStyle = col;
      for (const lo of [0, 0.34, 0.67]) {
        const bucket = it.vis.filter(s => s.w > lo && s.w <= lo + 0.34); if (!bucket.length) continue;
        const w = lo + 0.17; ctx.globalAlpha = clamp(a * w * it.heat); ctx.lineWidth = Math.max(0.8, width * wk * w);
        ctx.beginPath(); for (const s of bucket) { ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); } ctx.stroke();
      }
    }
  }
  ctx.restore();
}
// crack drawn into a surface: dark gouge with a light lip (no glow); for a glowing crack use drawBolt.
export function drawCrack(ctx, segs, { grow = 1, width = 6, dark = 'rgba(8,2,2,0.95)', lip = 'rgba(255,236,214,0.55)', lipOff = [-1.5, -1.5] } = {}) {
  const vis = segs.filter(s => s.o <= grow);
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [col, k, o] of [[lip, 0.5, lipOff], [dark, 1, [0, 0]]]) {
    ctx.strokeStyle = col;
    for (const lo of [0, 0.34, 0.67]) {
      const bucket = vis.filter(s => s.w > lo && s.w <= lo + 0.34); if (!bucket.length) continue;
      ctx.lineWidth = Math.max(0.6, width * (lo + 0.17) * k);
      ctx.beginPath(); for (const s of bucket) { ctx.moveTo(s.x0 + o[0], s.y0 + o[1]); ctx.lineTo(s.x1 + o[0], s.y1 + o[1]); } ctx.stroke();
    }
  }
  ctx.restore();
}
// return-stroke flicker for a strike at t0: leader grows, then 2-3 restrikes decay (deterministic)
export function strike(t, t0, { lead = 0.09, seed = 1 } = {}) {
  const u = t - t0; if (u < 0) return { grow: 0, heat: 0, flash: 0 };
  if (u < lead) return { grow: u / lead, heat: 0.55, flash: 0 };
  const r = rng(seed); const re = [0, 0.07 + r() * 0.05, 0.19 + r() * 0.08];
  let heat = 0; for (const d of re) { const k = u - lead - d; if (k >= 0) heat = Math.max(heat, Math.exp(-k * 16) * (d ? 0.8 : 1.6)); }
  heat = Math.max(heat, Math.exp(-(u - lead) * 3.5) * 0.35);
  return { grow: 1, heat, flash: Math.exp(-(u - lead) * 12) };
}

// ================================================================== BOIDS CROWD
// goal(f, t) -> null | { pts: Float32Array [x,y,...] (length >= 2n), w: 0..1 } : agents seek their
// assigned formation point (assignment is computed once per pts array: sweep-sorted, no crossings).
export class Crowd extends Replay {
  constructor({ n = 2000, seed = 1, fps = 30, sub = 2, spawn = null, speed = 220, force = 900, radius = 34, sep = 1.8, ali = 0.8, coh = 0.5,
    wander = 0.6, bounds = [-100, -100, W + 100, H + 100], goal = null, flow = null } = {}) {
    super(fps);
    Object.assign(this, { n, seed, sub, spawn, speed, force, radius, sep, ali, coh, wander, bounds, goal, flow });
    this.asg = new Map();          // formation assignments, keyed by the content hash of the target array (part of the state)
    this.ptsKey = new WeakMap();
  }
  _init() {
    const r = rng(this.seed), n = this.n;
    this.p = new Float32Array(n * 2); this.v = new Float32Array(n * 2); this.ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = this.spawn ? this.spawn(i, r) : [r() * W, r() * H, (r() - 0.5) * 50, (r() - 0.5) * 50];
      this.p[i * 2] = s[0]; this.p[i * 2 + 1] = s[1]; this.v[i * 2] = s[2]; this.v[i * 2 + 1] = s[3]; this.ph[i] = r() * 100;
    }
    this.cell = this.radius; this.gw = Math.ceil((this.bounds[2] - this.bounds[0]) / this.cell) + 2; this.gh = Math.ceil((this.bounds[3] - this.bounds[1]) / this.cell) + 2;
    this.head = new Int32Array(this.gw * this.gh); this.next = new Int32Array(n);
  }
  _assignFor(pts) {
    let pk = this.ptsKey.get(pts); if (pk === undefined) { pk = pts.length + ':' + hashBytes(pts); this.ptsKey.set(pts, pk); }
    if (this.asg.has(pk)) return this.asg.get(pk);
    const n = this.n, m = pts.length / 2;
    // sweep sort: band by y into sqrt(n) rows, then x within; same for agents -> matched ranks
    const key = (x, y, bands, y0, y1) => Math.floor(clamp((y - y0) / (y1 - y0 + 1e-6), 0, 0.9999) * bands) * 1e6 + x;
    let y0 = Infinity, y1 = -Infinity; for (let k = 0; k < m; k++) { y0 = Math.min(y0, pts[k * 2 + 1]); y1 = Math.max(y1, pts[k * 2 + 1]); }
    let ay0 = Infinity, ay1 = -Infinity; for (let i = 0; i < n; i++) { ay0 = Math.min(ay0, this.p[i * 2 + 1]); ay1 = Math.max(ay1, this.p[i * 2 + 1]); }
    const bands = Math.max(1, Math.round(Math.sqrt(n) / 3));
    const T = [...Array(m).keys()].sort((a, b) => key(pts[a * 2], pts[a * 2 + 1], bands, y0, y1) - key(pts[b * 2], pts[b * 2 + 1], bands, y0, y1));
    const A = [...Array(n).keys()].sort((a, b) => key(this.p[a * 2], this.p[a * 2 + 1], bands, ay0, ay1) - key(this.p[b * 2], this.p[b * 2 + 1], bands, ay0, ay1));
    const out = new Int32Array(n);
    for (let k = 0; k < n; k++) out[A[k]] = T[Math.floor(k * m / n)];
    this.asg.set(pk, out); return out;
  }
  _state() { return { p: new Float32Array(this.p), v: new Float32Array(this.v), asg: [...this.asg.entries()].map(([k, a]) => ({ k, a: new Int32Array(a) })) }; }
  _restore(s) { this.p.set(s.p); this.v.set(s.v); this.asg = new Map(s.asg.map(({ k, a }) => [k, new Int32Array(a)])); }
  _advance(f) {
    const n = this.n, p = this.p, v = this.v, dt = 1 / (this.fps * this.sub), R = this.radius, R2 = R * R, [bx0, by0] = this.bounds;
    for (let s = 0; s < this.sub; s++) {
      const t = (f - 1 + (s + 1) / this.sub) / this.fps;
      const g = this.goal ? this.goal(f, t) : null, as = g ? this._assignFor(g.pts) : null;
      this.head.fill(-1);
      for (let i = 0; i < n; i++) {
        const cx = clamp(Math.floor((p[i * 2] - bx0) / this.cell) + 1, 0, this.gw - 1), cy = clamp(Math.floor((p[i * 2 + 1] - by0) / this.cell) + 1, 0, this.gh - 1);
        const c = cy * this.gw + cx; this.next[i] = this.head[c]; this.head[c] = i;
      }
      for (let i = 0; i < n; i++) {
        const x = p[i * 2], y = p[i * 2 + 1];
        let sx = 0, sy = 0, ax = 0, ay = 0, cx_ = 0, cy_ = 0, k = 0;
        const gx = clamp(Math.floor((x - bx0) / this.cell) + 1, 0, this.gw - 1), gy = clamp(Math.floor((y - by0) / this.cell) + 1, 0, this.gh - 1);
        for (let yy = Math.max(0, gy - 1); yy <= Math.min(this.gh - 1, gy + 1); yy++) for (let xx = Math.max(0, gx - 1); xx <= Math.min(this.gw - 1, gx + 1); xx++) {
          for (let j = this.head[yy * this.gw + xx]; j >= 0; j = this.next[j]) {
            if (j === i) continue;
            const dx = x - p[j * 2], dy = y - p[j * 2 + 1], d2 = dx * dx + dy * dy;
            if (d2 > R2 || d2 < 1e-6) continue;
            const d = Math.sqrt(d2); sx += dx / d * (R - d) / R; sy += dy / d * (R - d) / R;
            ax += v[j * 2]; ay += v[j * 2 + 1]; cx_ += p[j * 2]; cy_ += p[j * 2 + 1]; k++;
          }
        }
        let fx = 0, fy = 0;
        const gw = g ? g.w : 0;
        fx += sx * this.sep * this.force * (1 - 0.7 * gw); fy += sy * this.sep * this.force * (1 - 0.7 * gw);
        if (k) {
          const flock = 1 - gw * 0.9;
          fx += (ax / k - v[i * 2]) * this.ali * 2 * flock; fy += (ay / k - v[i * 2 + 1]) * this.ali * 2 * flock;
          fx += (cx_ / k - x) * this.coh * 2 * flock; fy += (cy_ / k - y) * this.coh * 2 * flock;
        }
        const wa = noise3(x * 0.004, y * 0.004, t * 0.3 + this.ph[i] * 0.01) * Math.PI * 2;
        fx += Math.cos(wa) * this.wander * this.force * (1 - gw); fy += Math.sin(wa) * this.wander * this.force * (1 - gw);
        if (this.flow) { const fl = this.flow(x, y, t, i); fx += fl[0]; fy += fl[1]; }
        let vmax = this.speed;
        if (g && gw > 0) {
          const q = as[i], tx = g.pts[q * 2], ty = g.pts[q * 2 + 1], dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy) + 1e-6;
          const arrive = Math.min(1, d / (g.slow || 160)), want = (g.speed || this.speed * 1.6) * arrive;
          fx += ((dx / d) * want - v[i * 2]) * 6 * gw; fy += ((dy / d) * want - v[i * 2 + 1]) * 6 * gw;
          vmax = lerp(this.speed, g.speed || this.speed * 1.6, gw);
        }
        v[i * 2] += fx * dt; v[i * 2 + 1] += fy * dt;
        const sp = Math.hypot(v[i * 2], v[i * 2 + 1]); if (sp > vmax) { v[i * 2] *= vmax / sp; v[i * 2 + 1] *= vmax / sp; }
      }
      for (let i = 0; i < n * 2; i++) p[i] += v[i] * dt;
    }
  }
  _snap() { const o = new Float32Array(this.n * 4); o.set(this.p, 0); o.set(this.v, this.n * 2); return o; }
  // style: 'torch' (glowing heads + ember trails), 'stroke' (ink dashes), 'dot'
  draw(ctx, t, { style = 'torch', trail = 6, size = 1, color = '#ffb070', core = '#fff4df', alpha = 1, heat = 1, flicker = 1, colorOf = null } = {}) {
    const f = this.frameIndex(t), n = this.n, S = this.frame(f);
    ctx.save();
    if (style === 'stroke') {
      ctx.lineCap = 'round'; ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 3 * size; ctx.beginPath();
      for (let i = 0; i < n; i++) { const x = S[i * 2], y = S[i * 2 + 1], vx = S[n * 2 + i * 2], vy = S[n * 2 + i * 2 + 1], sp = Math.hypot(vx, vy) + 1e-6, L = 6 + 10 * size;
        ctx.moveTo(x - vx / sp * L, y - vy / sp * L); ctx.lineTo(x + vx / sp * L * 0.3, y + vy / sp * L * 0.3); }
      ctx.stroke(); ctx.restore(); return;
    }
    ctx.globalCompositeOperation = 'lighter';
    // trails: one path per age (batched)
    for (let a = trail; a >= 1; a--) {
      const P = this.frame(Math.max(0, f - a)), Q = this.frame(Math.max(0, f - a + 1));
      ctx.strokeStyle = color; ctx.globalAlpha = alpha * 0.22 * heat * (1 - a / (trail + 1)); ctx.lineWidth = 2.2 * size * (1 - a / (trail + 2)); ctx.beginPath();
      for (let i = 0; i < n; i++) { ctx.moveTo(P[i * 2], P[i * 2 + 1]); ctx.lineTo(Q[i * 2], Q[i * 2 + 1]); }
      ctx.stroke();
    }
    const spr = torchSprite(color, core);
    for (let i = 0; i < n; i++) {
      const fl = 1 - flicker * 0.35 * (0.5 + 0.5 * Math.sin(t * 23 + i * 1.7) * Math.sin(t * 7.3 + i * 0.37));
      const s = size * (10 + 5 * ((i * 7919) % 13) / 13) * fl;
      ctx.globalAlpha = alpha * heat * fl;
      ctx.drawImage(colorOf ? torchSprite(colorOf(i), core) : spr, S[i * 2] - s, S[i * 2 + 1] - s, s * 2, s * 2);
    }
    ctx.restore();
  }
}
const _torch = new Map();
function torchSprite(color, core) {
  const k = color + core; if (_torch.has(k)) return _torch.get(k);
  const c = canvas(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, core); gr.addColorStop(0.12, core); gr.addColorStop(0.3, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); _torch.set(k, c); return c;
}

// ------------------------------------------------------------------ formations from masks
// jittered-grid points inside a mask canvas' alpha, count ~ n, placed into the frame rect [x, y, w, h]
// edge > 0: that fraction of the points walks the outline (evenly spaced along the contour, `inset` mask px
// inside it), the rest fills the interior, so a formation reads as a crisp shape instead of a blob.
export function maskPoints(mask, n, { rect = [0, 0, W, H], seed = 5, thr = 128, edge = 0, inset = 2.5 } = {}) {
  const data = alphaData(mask), mw = mask.width, mh = mask.height, r = rng(seed), pts = [];
  const ne = Math.round(n * edge);
  if (ne > 0) {
    // outline: contour loops of the mask eroded by `inset`, sampled evenly by arc length
    const sd = sdfOf(data, mw, mh, thr), ins = new Uint8Array(mw * mh);
    for (let i = 0; i < ins.length; i++) ins[i] = sd[i] < -inset ? 1 : 0;
    const loops = traceLoops(ins, mw, mh).filter(L => L.length > 12);
    const total = loops.reduce((a, L) => a + L.length, 0), gap = total / ne;
    let acc = r() * gap;
    for (const L of loops) for (let k = 0; k < L.length; k++) {
      acc += 1; if (acc < gap) continue; acc -= gap;
      const [x, y] = L[k]; pts.push(rect[0] + x / mw * rect[2], rect[1] + y / mh * rect[3]);
    }
    pts.length = Math.min(pts.length, ne * 2);
  }
  const ni = n - pts.length / 2;
  let inside = 0; for (let i = 3; i < data.length; i += 16) if (data[i] > thr) inside++;
  const area = inside * 4, sp = Math.sqrt(area / Math.max(1, ni)), fill = [];
  for (let y = sp / 2; y < mh; y += sp) for (let x = sp / 2; x < mw; x += sp) {
    const jx = x + (r() - 0.5) * sp * 0.6, jy = y + (r() - 0.5) * sp * 0.6;
    const ix = Math.min(mw - 1, Math.max(0, Math.round(jx))), iy = Math.min(mh - 1, Math.max(0, Math.round(jy)));
    if (data[(iy * mw + ix) * 4 + 3] > thr) fill.push(rect[0] + jx / mw * rect[2], rect[1] + jy / mh * rect[3]);
  }
  while (fill.length < ni * 2) { const k = Math.floor(r() * fill.length / 2); fill.push(fill[k * 2] + (r() - 0.5) * 4, fill[k * 2 + 1] + (r() - 0.5) * 4); }
  pts.push(...fill.slice(0, ni * 2));
  return new Float32Array(pts.slice(0, n * 2));
}

// ------------------------------------------------------------------ analytic sparks / debris dust
// hits: [{t, x, y, e}] (e.g. RigidWorld.hits). Each hit throws `n` ballistic sparks, closed-form in t.
export function drawSparks(ctx, hits, t, { n = 14, speed = 900, life = 0.7, gravity = 2600, color = '#ffb35c', core = '#fff3d6', width = 2.2, minE = 0, up = 0.6 } = {}) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (let h = 0; h < hits.length; h++) {
    const hit = hits[h], age = t - hit.t; if (age < 0 || age > life * 1.4 || hit.e < minE) continue;
    const r = rng(((hit.x * 13 + hit.y * 7 + hit.t * 1000) | 0) + 11), k = Math.min(3, 0.5 + hit.e / 900);
    for (let i = 0; i < n * k; i++) {
      const a = -Math.PI / 2 + (r() - 0.5) * Math.PI * (1.6 - up), s = speed * (0.3 + r()) * Math.min(1.6, k), lf = life * (0.4 + r() * 0.8);
      if (age > lf) continue;
      const vx = Math.cos(a) * s, vy = Math.sin(a) * s;
      const x = hit.x + vx * age, y = hit.y + vy * age + 0.5 * gravity * age * age;
      const px = hit.x + vx * (age - 0.03), py = hit.y + vy * (age - 0.03) + 0.5 * gravity * (age - 0.03) ** 2;
      const fade = 1 - age / lf;
      ctx.globalAlpha = fade; ctx.strokeStyle = color; ctx.lineWidth = width * 2.2; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
      ctx.strokeStyle = core; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
    }
  }
  ctx.restore();
}
// soft dust puffs per hit (cheap alternative to the Fluid for small impacts)
export function drawPuffs(ctx, hits, t, { n = 9, life = 1.2, size = 60, color = [70, 55, 45], alpha = 0.35, drift = 120 } = {}) {
  ctx.save();
  for (const hit of hits) {
    const age = t - hit.t; if (age < 0 || age > life) continue;
    const r = rng(((hit.x * 31 + hit.y * 17 + hit.t * 997) | 0) + 5), k = Math.min(2.5, 0.4 + hit.e / 1200), u = age / life;
    for (let i = 0; i < n; i++) {
      const a = Math.PI + r() * Math.PI, d = (1 - Math.exp(-age * 4)) * drift * (0.5 + r()) * k;
      const x = hit.x + Math.cos(a) * d * 1.6, y = hit.y + Math.sin(a) * d * 0.5 - age * 40, s = size * k * (0.5 + r()) * (0.4 + u);
      const g = ctx.createRadialGradient(x, y, 0, x, y, s);
      g.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},${alpha * (1 - u) * (1 - u)})`); g.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
      ctx.fillStyle = g; ctx.fillRect(x - s, y - s, s * 2, s * 2);
    }
  }
  ctx.restore();
}
