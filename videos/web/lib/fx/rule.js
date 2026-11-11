// RULE (AUTHORITY's engine; Oct 2026, built for BY AUTHORITY): where the workers' authority has reached, as a field over a surface.
// The episode's rule decides WHEN each region changes state; RULE turns that schedule into a progress u(x, y, t) in [0, 1] and a signed
// distance to the moving edge, as pure functions of t: nothing is carried between frames, so stills, --from renders and the record agree.
// research/capabilities/devplate.md has the account; research/series/authority/BIBLE.md says what the series uses it for.
//
//   import { Rule } from '../lib/fx/rule.js';
//   const R = new Rule({ regions: [
//     { id: 'water', box: [x0, y0, x1, y1],                       // the region in surface units (a plate's rectangle on the lightbox)
//       shape: { rect: { aspect: 1.475 } } | { poly: [[x, y], ...] } | { line: [[x0, y0], [x1, y1]] },   // the front's own outline
//       from: [u, v] | 'centre',                                  // where the front starts, in region uv
//       t0: 20.714, dur: 1.429, ease: 'inout',                    // when, and how long (omit t0 for a region that only runs later)
//       edge: { noise: 0.004, scale: 0.02, seed: 7 },             // a meniscus wobble on the edge (seeded integer hash: same in node and GLSL)
//       soft: 0.003 }, ... ],                                     // the front's own softness (region units)
//     reverse: [{ ids: [...], t0: 48.571, dur: 1.429 }],          // a front run backward (the Crown's view)
//     forward: [{ ids: [...], t0, dur, stagger }] });             // a front run forward again (or for the first time) later
//   R.u(id, u, v, t)        -> 0..1        progress at a point (0 = the state before, 1 = the state the rule grants)
//   R.edge(id, u, v, t)     -> d           signed distance to the front (negative = passed), in region units
//   R.coverage(id, t)       -> 0..1        share of the region passed (analytic for rect and line; 64x64 samples for poly)
//   R.events(t0, t1)        -> [{ t, id, kind: 'start' | 'done' | 'reverse' }]   for the record and the beat map; the score never reads them
//   Rule.order(kind, items, opts) -> schedule   kind 'permit' (a given order, a given spacing) | 'lowman' (next = least accumulated)
//                                               | 'row' (a fell advancing row by row): the three rules the series has met
//   R.glsl                  -> the same u/edge functions as a GLSL chunk (a uniform block of up to 32 regions); R.uniforms(t) fills it
//                              (a rule used only in JS, e.g. type on a 2D canvas, may hold any number of regions)
//
// REGION UNITS. A region's distances are in units of its box's shorter side (1 = the short side of the plate). The front's outline is
// laid out in SURFACE units (so a 1.475:1 rect front is 1.475:1 on the lightbox whatever the box's own aspect) and reported in region units.
// THE FRONT. Each shape has a gauge g(p) >= 0 (rect: the rectangular radius max(|dx| / aspect, |dy|); line: the distance along the normal;
// poly: the scale at which the outline, laid about `from`, reaches p). A run moves the front's radius r(t) from -m to rMax + m (forward)
// or back (reverse), m = the noise amplitude + 2 x soft, so at a run's start nothing has passed and at its end everything has: exactly.
// RUNS. A region holds a list of runs (its own t0, the reverse list, the forward list) that may not overlap in time; the state at t is
// the latest run that has begun (before any run: nothing passed). That is the whole of the state: there is none between frames.

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
export const EASES = {
  linear: x => clamp(x),
  inout: x => { x = clamp(x); return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; },
  out: x => 1 - Math.pow(1 - clamp(x), 2),
  in: x => clamp(x) * clamp(x),
  smooth: x => { x = clamp(x); return x * x * (3 - 2 * x); },
};
const EASE_ID = { linear: 0, inout: 1, out: 2, in: 3, smooth: 4 };

// ---------------------------------------------------------------- the seeded integer hash (PCG3D, as lib/printlab.js) and value noise
export function pcg3d(x, y, z) {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0; y = (Math.imul(y, 1664525) + 1013904223) >>> 0; z = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
  x ^= x >>> 16; y ^= y >>> 16; z ^= z >>> 16;
  x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
  return [x >>> 0, y >>> 0, z >>> 0];
}
const u01 = h => ((h >>> 8) + 0.5) / 16777216;
const lat = (ix, iy, seed) => 2 * u01(pcg3d(ix | 0, iy | 0, seed | 0)[0]) - 1;          // a lattice value in -1..1
// smooth value noise in -1..1 at (x, y) in lattice units (a cell = 1)
export function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = lat(ix, iy, seed), b = lat(ix + 1, iy, seed), c = lat(ix, iy + 1, seed), d = lat(ix + 1, iy + 1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

// ---------------------------------------------------------------- convex clipping (the analytic coverage)
function clipHalf(poly, nx, ny, c) {          // keep nx*x + ny*y <= c
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length], dp = nx * P[0] + ny * P[1] - c, dq = nx * Q[0] + ny * Q[1] - c;
    if (dp <= 0) out.push(P);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) { const k = dp / (dp - dq); out.push([P[0] + k * (Q[0] - P[0]), P[1] + k * (Q[1] - P[1])]); }
  }
  return out;
}
const area = poly => { let a = 0; for (let i = 0; i < poly.length; i++) { const P = poly[i], Q = poly[(i + 1) % poly.length]; a += P[0] * Q[1] - Q[0] * P[1]; } return Math.abs(a) / 2; };

// ---------------------------------------------------------------- one region
class Region {
  constructor(spec, k) {
    if (!spec.id) throw new Error('rule: a region needs an id');
    const [x0, y0, x1, y1] = spec.box || [0, 0, 1, 1];
    if (!(x1 > x0 && y1 > y0)) throw new Error(`rule: region ${spec.id}: box must be [x0, y0, x1, y1] with x1 > x0 and y1 > y0`);
    Object.assign(this, { id: spec.id, k, x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 });
    this.L = Math.min(this.w, this.h);                                     // region unit, in surface units
    const sh = spec.shape || { rect: { aspect: this.w / this.h } };
    const from = spec.from === 'centre' || spec.from == null ? [0.5, 0.5] : spec.from;
    this.fx = x0 + from[0] * this.w; this.fy = y0 + from[1] * this.h;    // the front's origin, surface units
    this.noise = spec.edge?.noise ?? 0; this.nscale = spec.edge?.scale ?? 0.02; this.seed = (spec.edge?.seed ?? 1) | 0;
    this.soft = spec.soft ?? 0.003;
    this.m = this.noise + 2 * this.soft;                                   // the run's overshoot at each end (region units)
    this.ease = spec.ease || 'inout';
    if (sh.rect) { this.kind = 0; this.aspect = sh.rect.aspect ?? (this.w / this.h); }
    else if (sh.line) {                                                    // the line gives the front's orientation; it sweeps along its normal
      this.kind = 1; const [[a, b], [c, d]] = sh.line; let nx = -(d - b) * this.h, ny = (c - a) * this.w;   // the normal in surface units
      const n = Math.hypot(nx, ny) || 1; nx /= n; ny /= n;
      const cx = x0 + this.w / 2, cy = y0 + this.h / 2;                    // point the normal from `from` into the region
      if ((cx - this.fx) * nx + (cy - this.fy) * ny < 0) { nx = -nx; ny = -ny; }
      this.nx = nx; this.ny = ny;
      this.two = Math.abs((cx - this.fx) * nx + (cy - this.fy) * ny) < 1e-9 * this.L;   // from on the centre line: it sweeps both ways
    } else if (sh.poly) {                                                  // the outline about `from` (surface units relative to from, unit scale)
      this.kind = 2; this.poly = sh.poly.map(([x, y]) => [x, y]);
      if (this.poly.length < 3 || this.poly.length > 16) throw new Error(`rule: region ${spec.id}: a poly front has 3-16 points`);
      // the outline's RMS radius: a poly front's gauge is (the scale at which the outline reaches the point) x rho0, in region units
      let s2 = 0; for (const [x, y] of this.poly) s2 += x * x + y * y; this.rho0 = Math.sqrt(s2 / this.poly.length) / this.L;
    } else throw new Error(`rule: region ${spec.id}: shape must be rect, line or poly`);
    // a one-sided line front starts at the box's edge behind it (from only orients it); its gauge is measured from there
    this.smin = 0;
    if (this.kind === 1 && !this.two) this.smin = Math.min(...[[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => ((x - this.fx) * this.nx + (y - this.fy) * this.ny) / this.L));
    // rMax: the gauge that covers the whole box (the largest gauge over its corners; every gauge here is quasi-convex)
    const cs = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
    this.rMax = Math.max(...cs.map(([x, y]) => this.gauge(x, y)));
    if (!Number.isFinite(this.rMax)) throw new Error(`rule: region ${spec.id}: the poly outline must contain its origin (from)`);
    this.runs = [];
  }
  // the gauge of a surface point, in region units (0 at `from`)
  gauge(x, y) {
    const dx = x - this.fx, dy = y - this.fy;
    if (this.kind === 0) return Math.max(Math.abs(dx) / this.aspect, Math.abs(dy)) / this.L;
    if (this.kind === 1) { const s = (dx * this.nx + dy * this.ny) / this.L; return this.two ? Math.abs(s) : s - this.smin; }
    return this.polyGauge(dx, dy);
  }
  // poly: the scale s at which the outline (about the origin) reaches (dx, dy), times the distance per unit scale along that ray
  polyGauge(dx, dy) {
    const r = Math.hypot(dx, dy); if (r < 1e-12) return 0;
    const ux = dx / r, uy = dy / r; let best = Infinity;
    const P = this.poly;
    for (let i = 0; i < P.length; i++) {
      const [ax, ay] = P[i], [bx, by] = P[(i + 1) % P.length], ex = bx - ax, ey = by - ay;
      const den = ux * ey - uy * ex; if (Math.abs(den) < 1e-12) continue;
      const tR = (ax * ey - ay * ex) / den, sE = (ax * uy - ay * ux) / den;    // ray o + tR*u hits a + sE*e
      if (tR > 1e-12 && sE >= -1e-9 && sE <= 1 + 1e-9) best = Math.min(best, tR);
    }
    if (!Number.isFinite(best)) return Infinity;                          // the origin is outside the outline in this direction
    return (r / best) * this.rho0;                                        // the scale at which the outline reaches p, x its RMS radius
  }
  // the front's radius at t (region units), and which run is acting
  radius(t) {
    let cur = null;
    for (const R of this.runs) if (t >= R.t0) cur = R; else break;
    if (!cur) return { r: -this.m, run: null };
    const e = EASES[cur.ease || this.ease] || EASES.inout, p = e((t - cur.t0) / cur.dur);
    const lo = -this.m, hi = this.rMax + this.m;
    return { r: cur.dir > 0 ? lo + p * (hi - lo) : hi - p * (hi - lo), run: cur };
  }
  edgeAt(x, y, t) {                                                       // signed distance to the front, region units, negative = passed
    const { r } = this.radius(t);
    let g = this.gauge(x, y);
    if (this.noise) g += this.noise * vnoise(x / (this.nscale * this.L), y / (this.nscale * this.L), this.seed);
    return g - r;
  }
  coverage(t) {
    const { r } = this.radius(t);
    if (r <= 0) return 0;
    if (r >= this.rMax) return 1;
    const box = [[this.x0, this.y0], [this.x1, this.y0], [this.x1, this.y1], [this.x0, this.y1]], A = this.w * this.h, rs = r * this.L;
    if (this.kind === 0) {
      let p = box; const ax = rs * this.aspect;
      p = clipHalf(p, 1, 0, this.fx + ax); p = clipHalf(p, -1, 0, -(this.fx - ax)); p = clipHalf(p, 0, 1, this.fy + rs); p = clipHalf(p, 0, -1, -(this.fy - rs));
      return p.length < 3 ? 0 : clamp(area(p) / A);
    }
    if (this.kind === 1) {
      const c0 = this.nx * this.fx + this.ny * this.fy;
      let p = clipHalf(box, this.nx, this.ny, c0 + (this.smin * this.L) + rs);
      if (this.two) p = clipHalf(p, -this.nx, -this.ny, -(c0 - rs));
      return p.length < 3 ? 0 : clamp(area(p) / A);
    }
    let n = 0; const N = 64;                                              // poly: sampled
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { if (this.gauge(this.x0 + (i + 0.5) / N * this.w, this.y0 + (j + 0.5) / N * this.h) <= r) n++; }
    return n / (N * N);
  }
}

export class Rule {
  constructor({ regions = [], reverse = [], forward = [] } = {}) {
    this.regions = regions.map((s, k) => new Region(s, k));
    this.byId = new Map(this.regions.map(r => [r.id, r]));
    if (this.byId.size !== this.regions.length) throw new Error('rule: region ids must be unique');
    regions.forEach((s, k) => { if (s.t0 != null) this.regions[k].runs.push({ t0: +s.t0, dur: +(s.dur ?? 1), dir: 1, ease: s.ease }); });
    const add = (list, dir) => { for (const L of list) (L.ids || []).forEach((id, i) => {
      const R = this.byId.get(id); if (!R) throw new Error(`rule: ${dir > 0 ? 'forward' : 'reverse'} names unknown region ${id}`);
      R.runs.push({ t0: +L.t0 + i * (L.stagger || 0), dur: +(L.dur ?? 1), dir, ease: L.ease });
    }); };
    add(reverse, -1); add(forward, 1);
    for (const R of this.regions) {
      R.runs.sort((a, b) => a.t0 - b.t0);
      for (let i = 1; i < R.runs.length; i++) if (R.runs[i].t0 < R.runs[i - 1].t0 + R.runs[i - 1].dur - 1e-9)
        throw new Error(`rule: region ${R.id}: runs overlap (${R.runs[i - 1].t0}+${R.runs[i - 1].dur} and ${R.runs[i].t0})`);
      for (const r of R.runs) if (!(r.dur > 0)) throw new Error(`rule: region ${R.id}: a run needs dur > 0`);
    }
  }
  region(id) { const R = this.byId.get(id); if (!R) throw new Error(`rule: no region ${id}`); return R; }
  // region uv -> surface point
  _xy(R, u, v) { return [R.x0 + u * R.w, R.y0 + v * R.h]; }
  edge(id, u, v, t) { const R = this.region(id), [x, y] = this._xy(R, u, v); return R.edgeAt(x, y, t); }
  u(id, u, v, t) { const R = this.region(id), d = this.edge(id, u, v, t); return 1 - sstep(-R.soft, R.soft, d); }
  // the same in surface units (what a scene with surface coordinates already has)
  edgeXY(id, x, y, t) { return this.region(id).edgeAt(x, y, t); }
  uXY(id, x, y, t) { const R = this.region(id); return 1 - sstep(-R.soft, R.soft, R.edgeAt(x, y, t)); }
  coverage(id, t) { return this.region(id).coverage(t); }
  radius(id, t) { return this.region(id).radius(t).r; }
  // the front's radius in surface units as a rect (for a scene drawing a clip): { kind, cx, cy, hw, hh } when kind 'rect'
  frontRect(id, t) { const R = this.region(id), r = Math.max(0, R.radius(t).r) * R.L; return { kind: R.kind, cx: R.fx, cy: R.fy, hw: R.kind === 0 ? r * R.aspect : r, hh: r }; }
  events(t0 = -Infinity, t1 = Infinity) {
    const out = [];
    for (const R of this.regions) for (const r of R.runs) {
      if (r.t0 >= t0 && r.t0 < t1) out.push({ t: r.t0, id: R.id, kind: r.dir > 0 ? 'start' : 'reverse' });
      const te = r.t0 + r.dur; if (r.dir > 0 && te >= t0 && te < t1) out.push({ t: te, id: R.id, kind: 'done' });
    }
    return out.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  // ---------------------------------------------------------------- schedulers: the three rules the series has met
  // permit: items in the given order (or opts.order), one every opts.spacing from opts.t0, each opts.dur long
  // lowman: items [{ id, acc }]; opts.slots turns; each turn goes to the least accumulated so far (ties: the earlier item), adding opts.cost
  // row:    items [{ id, y }] (or with box): rows sorted by y (opts.dir 1 = up, -1 = down), the fell advancing one row every opts.spacing
  static order(kind, items, opts = {}) {
    const { t0 = 0, spacing = 1, dur = 1 } = opts;
    if (kind === 'permit') {
      const ids = (opts.order || items.map(it => (typeof it === 'string' ? it : it.id)));
      return ids.map((id, i) => ({ id, t0: +(t0 + i * spacing).toFixed(6), dur }));
    }
    if (kind === 'lowman') {
      const acc = items.map(it => ({ id: it.id, acc: it.acc || 0 })), out = [], n = opts.slots ?? items.length, cost = opts.cost ?? 1;
      for (let s = 0; s < n; s++) { let b = 0; for (let i = 1; i < acc.length; i++) if (acc[i].acc < acc[b].acc - 1e-12) b = i;
        out.push({ id: acc[b].id, t0: +(t0 + s * spacing).toFixed(6), dur, acc: acc[b].acc }); acc[b].acc += cost; }
      return out;
    }
    if (kind === 'row') {
      const dir = opts.dir ?? -1, ys = items.map(it => ({ id: it.id, y: it.y ?? (it.box ? (it.box[1] + it.box[3]) / 2 : 0) }));
      ys.sort((a, b) => dir < 0 ? b.y - a.y : a.y - b.y);
      return ys.map((it, i) => ({ id: it.id, t0: +(t0 + i * spacing).toFixed(6), dur }));
    }
    throw new Error(`rule: unknown order ${kind}`);
  }
  // a schedule -> forward runs (the Rule constructor's `forward` list)
  static runs(schedule) { return schedule.map(s => ({ ids: [s.id], t0: s.t0, dur: s.dur })); }

  // ---------------------------------------------------------------- GLSL: the same functions, a uniform block of up to 32 regions
  // uRuleA[i] = (x0, y0, x1, y1) surface box; uRuleB[i] = (fx, fy, L, r) origin, region unit, the front's radius at t (region units)
  // uRuleC[i] = (kind, aspect | nx, soft | ny, two | polyStart); uRuleD[i] = (noise, nscale, seed, polyCount); uRulePoly[64]: poly points
  get glsl() { return RULE_GLSL; }
  uniforms(t, into = null) {
    const n = this.regions.length, F = () => new Float32Array(128);
    if (n > 32) throw new Error(`rule: the GLSL block holds 32 regions (this rule has ${n}; a JS-only rule may have any number)`);
    const U = into || { A: F(), B: F(), C: F(), D: F(), E: F(), P: new Float32Array(128) };
    let pi = 0;
    for (const R of this.regions) {
      const k = R.k * 4, r = R.radius(t).r;
      U.A.set([R.x0, R.y0, R.x1, R.y1], k);
      U.B.set([R.fx, R.fy, R.L, r], k);
      if (R.kind === 0) { U.C.set([0, R.aspect, 0, 0], k); U.E.set([R.soft, 0, 0, 0], k); }
      else if (R.kind === 1) { U.C.set([1, R.nx, R.ny, R.two ? 1 : 0], k); U.E.set([R.soft, R.smin, 0, 0], k); }
      else { U.C.set([2, 0, 0, pi], k); U.E.set([R.soft, R.rho0, 0, 0], k);
        for (const [x, y] of R.poly) { if (pi >= 64) throw new Error('rule: the GLSL pool holds 64 poly points'); U.P[2 * pi] = x; U.P[2 * pi + 1] = y; pi++; } }
      U.D.set([R.noise, R.nscale, R.seed, R.kind === 2 ? R.poly.length : 0], k);
    }
    U.n = n; return U;
  }
  softOf(id) { return this.region(id).soft; }
  indexOf(id) { return this.region(id).k; }
}

// The GLSL chunk (WebGL2 / GLSL ES 3.00). ruleEdge(i, p) is Region.edgeAt for region i at surface point p (the radius r comes in the
// uniforms, computed by R.uniforms(t) in JS: the schedule is evaluated once, in one place); ruleU(i, p) = 1 - smoothstep(-soft, soft, edge).
// uRuleA = (x0, y0, x1, y1); uRuleB = (fx, fy, L, r); uRuleC = (kind, aspect | nx, ny, two | polyStart); uRuleD = (noise, nscale, seed,
// polyCount); uRuleE = (soft, smin | rho0, 0, 0); uRulePoly: the poly pool (surface units about each region's origin).
export const RULE_GLSL = /* glsl */`
uniform vec4 uRuleA[32];
uniform vec4 uRuleB[32];
uniform vec4 uRuleC[32];
uniform vec4 uRuleD[32];
uniform vec4 uRuleE[32];
uniform vec2 uRulePoly[64];
uvec3 rule_pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
float rule_lat(ivec2 i, int seed) { uvec3 h = rule_pcg3d(uvec3(uint(i.x), uint(i.y), uint(seed))); return 2.0 * ((float(h.x >> 8u) + 0.5) / 16777216.0) - 1.0; }
float rule_vnoise(vec2 p, int seed) {
  vec2 f0 = floor(p); ivec2 i = ivec2(f0); vec2 f = p - f0; vec2 s = f * f * (3.0 - 2.0 * f);
  float a = rule_lat(i, seed), b = rule_lat(i + ivec2(1, 0), seed), c = rule_lat(i + ivec2(0, 1), seed), d = rule_lat(i + ivec2(1, 1), seed);
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}
float rule_polyGauge(vec2 d, int start, int cnt, float rho0) {
  float r = length(d); if (r < 1e-9) return 0.0;
  vec2 u = d / r; float best = 1e20;
  for (int k = 0; k < 16; k++) {
    if (k >= cnt) break;
    vec2 a = uRulePoly[start + k], b = uRulePoly[start + (k + 1 == cnt ? 0 : k + 1)], e = b - a;
    float den = u.x * e.y - u.y * e.x; if (abs(den) < 1e-12) continue;
    float tR = (a.x * e.y - a.y * e.x) / den, sE = (a.x * u.y - a.y * u.x) / den;
    if (tR > 1e-9 && sE >= -1e-6 && sE <= 1.0 + 1e-6) best = min(best, tR);
  }
  if (best > 1e19) return 1e20;
  return r / best * rho0;
}
float ruleGauge(int i, vec2 p) {
  vec4 B = uRuleB[i], C = uRuleC[i], D = uRuleD[i], E = uRuleE[i];
  vec2 d = p - B.xy; float L = B.z;
  if (C.x < 0.5) return max(abs(d.x) / C.y, abs(d.y)) / L;
  if (C.x < 1.5) { float s = dot(d, C.yz) / L; return C.w > 0.5 ? abs(s) : s - E.y; }
  return rule_polyGauge(d, int(C.w + 0.5), int(D.w + 0.5), E.y);
}
float ruleEdge(int i, vec2 p) {
  vec4 B = uRuleB[i], D = uRuleD[i];
  float g = ruleGauge(i, p);
  if (D.x > 0.0) g += D.x * rule_vnoise(p / (D.y * B.z), int(D.z + 0.5));
  return g - B.w;
}
float ruleU(int i, vec2 p) { float s = uRuleE[i].x; return 1.0 - smoothstep(-s, s, ruleEdge(i, p)); }
`;
