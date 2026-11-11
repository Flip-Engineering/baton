// EARTHWORK (Oct 2026; built for THE GRAVEDIGGERS): the ground a crew moves. The Dig act (motion/labour.js; makeDig in motion/dig.js)
// says where each spit is cut, how deep, and where it lands; Earthwork is the earth that answers. Cuts (a pit, a grave, a trench) deepen
// bite by bite and keep every bite as a facet in the wall; what lands heaps up at its angle of repose; the wall between two cuts thins
// as both deepen and breaks through when the bites on either side meet; undermined ground settles, its walls shear and slump in, and
// whatever stands on it is told how far to lean. A pure function of (cuts, events, t): nothing is carried between frames, so stills and
// --from renders are exact (a cache keyed on t is only a speed-up; a seek rebuilds from the nearest keyframe).
//
//   import { Earthwork } from '../lib/fx/earthwork.js';
//   const ew = new Earthwork(THREE, scene, { box: [x0, z0, x1, z1], res: 0.02, near: 6,          // res: heightfield cell (m); a cut nearer
//     soil: { density: 1450, bulk: 1.25, repose: 34 }, lf });                                    // the camera than `near` m is meshed
//   const grave = ew.pit({ rect: [cx, cz, 0.95, 2.2, yaw], floor: -1.8, open: 1, seed });       // open: 1 = dug before t = 0 by a seeded
//                                                                                               // crew (its walls faceted, its spoil heaped)
//   const tr = ew.trench({ path: [[x, z], ...], width: 0.6, floor: -0.9, open: 0 });            // a cut planned along a polyline
//   ew.feed(dig.allEvents, { cut: tr, rate: 1 });   // 'bite' (where, depth, k) carves a blade-shaped wedge (SHOVELS width and cant) in the
//                                                    // planned cut, top bench first; 'land' (where, kg) heaps kg / density x bulk m3.
//                                                    // rate > 1: each bite moves `rate` spits (a fable's pace for a wide shot; 1 = the spit)
//   ew.join(a, b)                                    // the wall between two cuts breaks through when both sides reach it; then one cut
//   ew.settle({ t, cuts, drop: 0.12, shear: 0.25, over: 0.6 })   // the foundation gives: walls slump in, the ground between them drops
//   ew.update(t, camera)   // near cuts -> heightfield meshes (faceted: one normal per bite face); far cuts -> instanced stamps (a dark
//                          // footprint whose value falls with depth); spoil -> instanced heaps; materials through atmos3d patchMaterial
//   ew.depth(cut, t)       -> { mean, max } metres below grade       (export it with the hits: a score can read it)
//   ew.heightAt(x, z, t)   -> y                                       (a digger's base on a deepening floor; a stone's foot)
//   ew.lean(x, z, t)       -> { axis, deg }                           (what settle does to a thing standing at x, z)
//   ew.events(t0, t1)      -> [{ t, kind: 'breach' | 'slump', where }] (for the beat map)
//   ew.stats               -> { cutM3, spoilM3, missBite }            (volume ledger; bites outside their cut, mm)
// Measured (labs/motion/lab_earthwork.js; checks added to labs/motion/motion_test.mjs): cut volume x bulk = spoil within 2 %; every bite's
// facet inside its cut and under the blade's tip within 1 cm; heightAt under a Dig base within 1 cm; a frame rendered cold at t equals
// the cached frame. Uses: graves; trenches and footings (GARY 2036's groundbreaking); ditches and levees (COMMON WEALTH); grading
// (EMPIRE, FRONTIER); ore and coal heaps (ORE TO ORBIT); barricades; any crew at earthwork.
//
// How it is built (8 Oct 2026; research/capabilities/earthwork.md):
// - The ground is a heightfield over `box`: C, the depth cut below grade per cell (y = grade - C), plus the spoil piles (analytic cones and
//   ridges at the angle of repose, added on top). A cut is a planned footprint (a rotated rectangle or a polyline of width w) with a floor;
//   it is rasterised with its edge coverage (a wall that crosses a cell cuts that cell in proportion), so a wall is a 1-cell ramp on its
//   true line, and C never goes below the cut's floor.
// - A spit is the earth on the blade's face. The blade enters at P0 (the Dig's cut, at its base's level) along its own axis b to the tip
//   T = P0 + b depth (the Dig's own tip at the end of the bite: plan(k).fS.b in world); the spit is what lies above both the blade's plane
//   (behind T) and a fracture plane rising from T away from the digger, between the blade's edges (SHOVELS bw). The fracture's slope is
//   solved per spit (bisection, 6..85 deg, reaching no more than 0.5 m past the tip) so the wedge holds kg / density m3 of bank: a V notch
//   whose bottom is the blade's tip, one plane per face (where even the steepest holds too much, the blade goes in less far). A spit cuts
//   only its own cut (and the cuts and walls joined to it). The cut appears when the spit is on the blade (the bite's end, plan(k).tOf(U.D)).
// - Top bench first: a spit whose own place has no earth left (the Dig cuts in one place every cycle), what a partial spit left over, and
//   every spit past the first of a rate > 1 bite go to the highest remaining earth of the cut within `reach` of the digger's cut (then
//   anywhere in it), the nearest first, the blade turned (the digger's line, or a quarter, half or three-quarter turn of it, entering
//   inside the cut) so its tip comes under that high cell, whichever turn holds the most: the cut goes down in level benches with walls on
//   every side. A digger's own feet are never cut (a keep-out disc round each fed Dig's base), so heightAt under it stays its floor.
// - A land heaps what its own bite actually cut, x bulk: the ledger holds even when a cut is nearly done. Lands within 0.3 m make one pile.
// - open: the planned depth x open is cut flat before t = 0 (its spoil a ridge beside the cut, on the cut's +x side or `heap.side`); its
//   walls are faceted in the shader by seeded spade bites (bench and bite cells, 0.21 x 0.185 m: the blade's reach and width, each its own
//   lean and turn and tone), the faces a live spit made keep their true planes.
// - join: the wall between two cuts (the cells on the shortest paths between them) breaks when the cut beside it on each side averages
//   `need` (0.5) of the shallower planned depth, at `at` or later: it drops to the shallower side's level, its earth goes on the nearest
//   heap the crew has made (else beside a), and from then on the two (and the wall) are one cut for top-bench placement. Logged as 'breach'.
// - settle: from t over `over` s (smoother ease), a closed-form overlay on the cut state at t: outside each listed cut, the ground within
//   `shear` of its wall drops to a failure plane from the wall's toe to grade; inside, that earth lies against the toe at the angle of
//   repose (capped by the cut's half width); the ground between any two listed cuts (dA + dB <= their gap + feather) drops `drop`.
//   lean(x, z, t) tilts toward the lower side by the overlay's slope across the base (r), capped (max deg). Logged as 'slump'.
// - Rendering: tiles of `tile` m. A worked tile (cut, or settling) within `near` of the camera is a heightfield mesh (flat-shaded: the bite
//   planes are true facets; skirts close the tile edges); every other tile is an instanced quad at grade whose shader darkens it by the cut
//   depth from a stamp texture (exp(-depth / 0.45) toward the earth colour). Earthwork draws the ground inside its box; the scene's ground
//   must leave the box out (ew.surround({ size }) is a ground square with the box's hole). Piles: cones instanced, ridges one merged mesh.
//   makeDig's own heap (dg.heap) should be hidden where Earthwork heaps the spoil (it counts kg / 1450 as loose; this counts bank x bulk).
import { SHOVELS } from './motion/labour.js';
import { Poser } from './motion/poser.js';
import { patchMaterial } from './atmos3d.js';

const D2R = Math.PI / 180;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smoother = u => { u = clamp(u); return u * u * u * (u * (u * 6 - 15) + 10); };
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
// the blade's set angle (below the horizontal) and azimuth offset from the digger's facing, as Dig plans it (labour.js: phi0 - cant, psi0)
const SET = { spade: { foot: [1.22, 0.55], arms: [0.7, 0.3] }, roundpoint: { foot: [1.1 - 0.33, 0.55], arms: [0.7 - 0.33, 0.3] } };

// signed distance to a cut's footprint (negative inside)
function rectSDF(cx, cz, w, l, yaw) { const c = Math.cos(yaw), s = Math.sin(yaw), hw = w / 2, hl = l / 2;
  return (x, z) => { const dx = x - cx, dz = z - cz, u = Math.abs(dx * c - dz * s) - hw, v = Math.abs(dx * s + dz * c) - hl;
    return Math.hypot(Math.max(u, 0), Math.max(v, 0)) + Math.min(Math.max(u, v), 0); }; }
function pathSDF(path, w) { const P = path.map(p => [p[0], p[1]]);
  return (x, z) => { let d = Infinity; for (let i = 0; i + 1 < P.length; i++) { const [ax, az] = P[i], [bx, bz] = P[i + 1], ux = bx - ax, uz = bz - az, L2 = ux * ux + uz * uz || 1e-12;
      const u = clamp(((x - ax) * ux + (z - az) * uz) / L2); d = Math.min(d, Math.hypot(x - ax - u * ux, z - az - u * uz)); }
    if (P.length === 1) d = Math.hypot(x - P[0][0], z - P[0][1]); return d - w / 2; }; }
// a pile of loose spoil: a ridge of length len along (ax, az) with conical ends (len 0: a cone), its flanks at the angle of repose.
// V = tan(repose) (pi r^3 / 3 + len r^2); h = r tan(repose)
function pileR(vol, len, tn) { if (vol <= 0) return 0; if (len <= 1e-6) return Math.cbrt(3 * vol / (Math.PI * tn));
  let r = Math.min(Math.cbrt(3 * vol / (Math.PI * tn)), Math.sqrt(vol / (tn * len))); for (let i = 0; i < 30; i++) { const f = tn * (Math.PI * r * r * r / 3 + len * r * r) - vol, df = tn * (Math.PI * r * r + 2 * len * r); r = Math.max(1e-6, r - f / df); } return r; }
function pileH(p, x, z, tn) { if (p.r <= 0) return 0; const dx = x - p.x, dz = z - p.z, a = clamp(dx * p.ax + dz * p.az, -p.len / 2, p.len / 2), d = Math.hypot(dx - a * p.ax, dz - a * p.az);
  return d >= p.r ? 0 : (p.r - d) * tn; }

export class Earthwork {
  constructor(THREE, scene, { box, res = 0.02, near = 6, soil = {}, lf = null, y = 0, seed = 1, tile = 1, ground = {}, earth = '#3b3026', spoil = '#4a3a2a', reach = 1, keyEvery = 2, maxKeys = 12, trace = null } = {}) {
    if (!box || box.length < 4) throw new Error('Earthwork: box [x0, z0, x1, z1] is required');
    this.THREE = THREE; this.scene = scene; this.lf = lf; this.trace = trace;   // trace(spit, cells, grid): each spit as cut, [q, before, after] per cell, the live grid (checks)
    this.y0 = y; this.seed = seed; this.res = res; this.near = near; this.reach = reach;
    this.x0 = Math.min(box[0], box[2]); this.z0 = Math.min(box[1], box[3]);
    this.nx = Math.max(1, Math.ceil(Math.abs(box[2] - box[0]) / res - 1e-9)); this.nz = Math.max(1, Math.ceil(Math.abs(box[3] - box[1]) / res - 1e-9)); this.N = this.nx * this.nz;
    this.box = [this.x0, this.z0, this.x0 + this.nx * res, this.z0 + this.nz * res];
    this.soil = { density: 1450, bulk: 1.25, repose: 34, ...soil }; this.tanR = Math.tan(this.soil.repose * D2R);
    this.T = Math.max(4, Math.round(tile / res)); this.tx = Math.max(1, Math.ceil((this.nx - 1) / this.T)); this.tz = Math.max(1, Math.ceil((this.nz - 1) / this.T));   // tile ti: cells ti T .. (ti + 1) T (its edge shared)
    this.colors = { ground: ground.color || '#2b3122', groundRough: ground.roughness ?? 0.97, earth, spoil };
    this.keyEvery = keyEvery; this.maxKeys = maxKeys; this.sMin = Math.tan(6 * D2R); this.sMax = Math.tan(85 * D2R); this.maxF = 0.5;   // a spit's fracture: 6..85 deg, and no further than 0.5 m past the tip
    this.cuts = []; this.feeds = []; this.joins = []; this.settles = []; this.keeps = [];
    this._dirty = true; this._clock = 1; this._evLog = []; this._evHW = 0; this._spitLog = []; this._gfx = null;
  }
  // ------------------------------------------------------------------ the plan: cuts, feeds, joins, settles (each invalidates the cache)
  pit({ rect, floor = -1, open = 0, seed = 1, heap = {} } = {}) {
    const [cx, cz, w, l, yaw = 0] = rect, c = Math.cos(yaw), s = Math.sin(yaw);
    return this._addCut({ kind: 'pit', rect: [cx, cz, w, l, yaw], floor, open, seed, heap, sdf: rectSDF(cx, cz, w, l, yaw), centre: [cx, cz], ex: [c, -s], ez: [s, c], w, l,
      bbox: (() => { const ex = Math.abs(c) * w / 2 + Math.abs(s) * l / 2, ez = Math.abs(s) * w / 2 + Math.abs(c) * l / 2; return [cx - ex, cz - ez, cx + ex, cz + ez]; })() });
  }
  trench({ path, width = 0.6, floor = -0.9, open = 0, seed = 1, heap = {} } = {}) {
    if (!path || !path.length) throw new Error('Earthwork.trench: a path is required');
    const xs = path.map(p => p[0]), zs = path.map(p => p[1]), m = path[Math.floor((path.length - 1) / 2)], n = path[Math.min(path.length - 1, Math.floor((path.length - 1) / 2) + 1)];
    return this._addCut({ kind: 'trench', path: path.map(p => [p[0], p[1]]), floor, open, seed, heap, sdf: pathSDF(path, width), w: width, centre: [(m[0] + n[0]) / 2, (m[1] + n[1]) / 2],
      bbox: [Math.min(...xs) - width / 2, Math.min(...zs) - width / 2, Math.max(...xs) + width / 2, Math.max(...zs) + width / 2] });
  }
  _addCut(c) { c.id = this.cuts.length; c.depth = Math.max(0, this.y0 - c.floor); c.seed = c.seed ?? 1; this.cuts.push(c); this._dirty = true; return c; }
  // events: a Dig (or makeDig's dg.dig), or an array of its events (bite, release, land). opts: cut (else the cut the bite is in, or the
  // nearest), rate, dig (for the blade's exact line and the keep-out round its feet), tool / heading / lead (no dig: the blade from
  // SHOVELS' set), lag (no dig: s from the bite's event to the spit on the blade), reach (m: top-bench placement round the digger's cut),
  // fromHeap (its bites load loose spoil off the nearest heap within 1.5 m, and its lands put it down: a spit thrown from a heap)
  feed(src, { cut = null, rate = 1, dig = null, tool, heading, lead = 'R', drive, lag = 0.4, reach, fromHeap = false } = {}) {
    if (src && !src.allEvents && src.dig && src.dig.allEvents) src = src.dig;                     // makeDig's dg
    if (src && src.allEvents) { dig = dig || src; src = src.allEvents; }
    const tl = dig ? dig.tool : tool || 'spade', W = SHOVELS[tl] || SHOVELS.spade, dv = dig ? dig.drive : drive || W.drive, f = { id: this.feeds.length, events: (src || []).filter(e => e && (e.kind === 'bite' || e.kind === 'land')),
      cut, rate: Math.max(0, rate), dig, tool: W.name, bw: W.bw, kg: W.kg, depth: W.depth, lag, reach: reach ?? this.reach, heading, lead, drive: dv, fromHeap };
    if (dig) { const b = dig.base, fr = dig.frame; let r = 0.3; for (const p of dig.feet0 || []) if (p) { const w = Poser.l2w(fr, p); r = Math.max(r, Math.hypot(w.x - b.x, w.z - b.z) + 0.2); }
      this.keeps.push([b.x, b.z, r]); }
    this.feeds.push(f); this._dirty = true; return f;
  }
  keep(x, z, r) { this.keeps.push([x, z, r]); this._dirty = true; return this; }
  join(a, b, { at = 0, need = 0.5 } = {}) { const j = { id: this.joins.length, a, b, at, need }; this.joins.push(j); this._dirty = true; return j; }
  settle({ t, cuts = [], drop = 0.12, shear = 0.25, over = 0.6, feather = 0.4 } = {}) { const s = { id: this.settles.length, t, cuts, drop, shear, over, feather, D: null }; this.settles.push(s); this._dirty = true; return s; }

  // ------------------------------------------------------------------ queries
  heightAt(x, z, t) { const st = this._state(t); return this._hAt(st, x, z, t, true); }
  depth(cut, t) { const st = this._state(t), C = st.C; let s = 0, m = 0; for (const i of cut.inner) { s += C[i]; m = Math.max(m, C[i]); } return { mean: cut.inner.length ? s / cut.inner.length : 0, max: m }; }
  lean(x, z, t, { r = 0.15, max = 5 } = {}) {
    this._state(t); let gx = 0, gz = 0, dr = 0;
    for (const s of this.settles) { if (!s.D || t <= s.t) continue; const k = smoother((t - s.t) / s.over), D = (a, b) => this._bil(s.D, a, b);
      gx += k * (D(x + r, z) - D(x - r, z)) / (2 * r); gz += k * (D(x, z + r) - D(x, z - r)) / (2 * r); dr += k * D(x, z); }
    const g = Math.hypot(gx, gz), V = this.THREE.Vector3; if (g < 1e-9) return { axis: new V(1, 0, 0), deg: 0, drop: dr, dir: new V(0, 0, 0) };
    const ux = -gx / g, uz = -gz / g;                       // toward the side that went down
    return { axis: new V(uz, 0, -ux), deg: Math.min(max, Math.atan(g) / D2R), drop: dr, dir: new V(ux, 0, uz) };
  }
  events(t0, t1) { if (this._dirty || !this._st || t1 > this._st.tHW) this._state(t1); return this._evLog.filter(e => e.t > t0 && e.t <= t1); }
  spits(t0, t1) { this._state(t1); return this._spitLog.slice(0, this._st.spitsN).filter(r => r.t > t0 && r.t <= t1); }
  ledger(t) { this._state(t); return this.stats; }
  get stats() { const st = this._dirty || !this._st ? this._state(-Infinity) : this._st, c = st.cnt;
    return { cutM3: c.cut, spoilM3: c.spoil, missBite: c.missBite, missN: c.missN, spits: c.spits, shortM3: c.short, flyingM3: c.cut * this.soil.bulk - c.spoil, openM3: c.open, t: st.t }; }
  // the live heightfield at t (read only: valid until the next call): C (m below grade per cell), S (1 = a spit's face), Cmax (the plan)
  grid(t) { const st = this._state(t); return { C: st.C, S: st.S, Cmax: this._Cmax, nx: this.nx, nz: this.nz, res: this.res, x0: this.x0, z0: this.z0, y0: this.y0, piles: st.piles }; }

  // ------------------------------------------------------------------ the static plan, rasterised (on the first query after a change)
  _rebuild() {
    const { N, nx, nz, res, x0, z0 } = this; this._dirty = false;
    this._Cmax0 = new Float32Array(N); this._own = new Int16Array(N); this._keep = new Uint8Array(N); this._seedOf = new Float32Array(N);
    for (const c of this.cuts) {                                                     // footprint, edge coverage, the plan's depth
      const [bx0, bz0, bx1, bz1] = c.bbox, i0 = clamp(Math.floor((bx0 - x0) / res) - 1, 0, nx - 1), i1 = clamp(Math.ceil((bx1 - x0) / res) + 1, 0, nx - 1), j0 = clamp(Math.floor((bz0 - z0) / res) - 1, 0, nz - 1), j1 = clamp(Math.ceil((bz1 - z0) / res) + 1, 0, nz - 1);
      const cells = [], cov = [], inner = []; let deep = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = c.sdf(x0 + (i + 0.5) * res, z0 + (j + 0.5) * res), k = clamp(0.5 - d / res); if (k <= 0) continue;
        const q = j * nx + i; cells.push(q); cov.push(k); if (k >= 0.5) inner.push(q); deep = Math.max(deep, -d);
        this._Cmax0[q] = Math.max(this._Cmax0[q], k * c.depth); if (!this._own[q]) { this._own[q] = c.id + 1; this._seedOf[q] = c.seed; } }
      c.cells = Int32Array.from(cells); c.cov = Float32Array.from(cov); c.inner = Int32Array.from(inner); c.halfW = deep;
      c.cand = Int32Array.from(inner.filter(q => (q % nx) % 2 === 0 && Math.floor(q / nx) % 2 === 0));
      // where its spoil goes (open, breaches, a bite with no land): a ridge beside it on its +x side (heap.side -1: the other side)
      const sd = c.heap.side ?? 1, gap = c.heap.gap ?? 0.35;
      if (c.kind === 'pit') { c.heapSegs = [{ x: c.centre[0], z: c.centre[1], ax: c.ez[0], az: c.ez[1], len: 0.8 * c.l, nx: sd * c.ex[0], nz: sd * c.ex[1], off: c.w / 2 + gap, f: 1 }]; }
      else { const P = c.path, L = []; let tot = 0; for (let i = 0; i + 1 < P.length; i++) { const ux = P[i + 1][0] - P[i][0], uz = P[i + 1][1] - P[i][1], l = Math.hypot(ux, uz); if (l < 1e-6) continue; L.push({ x: (P[i][0] + P[i + 1][0]) / 2, z: (P[i][1] + P[i + 1][1]) / 2, ax: ux / l, az: uz / l, len: 0.9 * l, nx: sd * uz / l, nz: -sd * ux / l, off: c.w / 2 + gap, l }); tot += l; }
        if (!L.length) L.push({ x: P[0][0], z: P[0][1], ax: 1, az: 0, len: 0, nx: 0, nz: sd, off: c.w / 2 + gap, l: 1 }), tot = 1; L.forEach(s => s.f = s.l / tot); c.heapSegs = L; }
      if (c.heap.at) c.heapSegs = [{ x: c.heap.at[0], z: c.heap.at[1], ax: 1, az: 0, len: 0, nx: 0, nz: 0, off: 0, f: 1, fixed: true }];
    }
    for (const [kx, kz, r] of this.keeps) { const i0 = clamp(Math.floor((kx - r - x0) / res), 0, nx - 1), i1 = clamp(Math.ceil((kx + r - x0) / res), 0, nx - 1), j0 = clamp(Math.floor((kz - r - z0) / res), 0, nz - 1), j1 = clamp(Math.ceil((kz + r - z0) / res), 0, nz - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Math.hypot(x0 + (i + 0.5) * res - kx, z0 + (j + 0.5) * res - kz) <= r) this._keep[j * nx + i] = 1; }
    // joins: the wall between a and b is the cells on the shortest paths between their footprints; the sides are each cut's cells by it
    this._bridgeOf = new Int16Array(N);
    for (const J of this.joins) { const A = J.a, B = J.b; let gap = Infinity; for (const q of A.inner) gap = Math.min(gap, Math.max(0, B.sdf(...this._cxz(q))));
      J.gap = gap; J.depth = Math.min(A.depth, B.depth); const br = [], bb = [Math.min(A.bbox[0], B.bbox[0]), Math.min(A.bbox[1], B.bbox[1]), Math.max(A.bbox[2], B.bbox[2]), Math.max(A.bbox[3], B.bbox[3])];
      const i0 = clamp(Math.floor((bb[0] - x0) / res), 0, nx - 1), i1 = clamp(Math.ceil((bb[2] - x0) / res), 0, nx - 1), j0 = clamp(Math.floor((bb[1] - z0) / res), 0, nz - 1), j1 = clamp(Math.ceil((bb[3] - z0) / res), 0, nz - 1);
      let sx = 0, sz = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = x0 + (i + 0.5) * res, z = z0 + (j + 0.5) * res, da = A.sdf(x, z), db = B.sdf(x, z);
        if (da > -0.5 * res && db > -0.5 * res && da + db <= gap + 1.5 * res && !this._keep[j * nx + i]) { br.push(j * nx + i); sx += x; sz += z; } }
      J.bridge = Int32Array.from(br); J.centre = br.length ? [sx / br.length, sz / br.length] : [(A.centre[0] + B.centre[0]) / 2, (A.centre[1] + B.centre[1]) / 2];
      J.cand = Int32Array.from(br.filter(q => (q % nx) % 2 === 0 && Math.floor(q / nx) % 2 === 0)); for (const q of br) if (!this._bridgeOf[q]) this._bridgeOf[q] = J.id + 1;
      J.sideA = Int32Array.from([...A.inner].filter(q => B.sdf(...this._cxz(q)) <= gap + 3 * res)); J.sideB = Int32Array.from([...B.inner].filter(q => A.sdf(...this._cxz(q)) <= gap + 3 * res)); }
    // the ops, in time order (a stable sort: same-t ops keep their order of definition)
    const ops = []; let seq = 0;
    for (const f of this.feeds) { let kmax = 0; for (const e of f.events) kmax = Math.max(kmax, e.k | 0);
      f.nk = kmax + 1;
      for (const e of f.events) { if (!e.where) continue;
        if (e.kind === 'bite') { let tc = e.t + f.lag; if (f.dig && f.dig.plan) { const p = f.dig.plan(e.k); tc = p.tOf(p.U.D); } ops.push({ t: tc, kind: 'bite', f, e, seq: seq++ }); }
        else ops.push({ t: e.t, kind: 'land', f, e, seq: seq++ }); } }
    for (const J of this.joins) ops.push({ t: J.at, kind: 'join', J, seq: seq++ });
    for (const s of this.settles) { s.D = null; ops.push({ t: s.t, kind: 'settle', s, seq: seq++ }); }
    ops.sort((a, b) => a.t - b.t || a.seq - b.seq); this._ops = ops;
    // the base state: every open cut dug flat to open x its depth before t = 0, its spoil heaped beside it
    const st = { i: 0, t: -Infinity, tHW: -Infinity, C: new Float32Array(N), S: new Uint8Array(N), piles: [], taken: this.feeds.map(f => new Float64Array(f.nk)), breached: new Uint8Array(this.joins.length),
      cnt: { cut: 0, spoil: 0, open: 0, missBite: 0, missN: 0, spits: 0, short: 0 }, spitsN: 0, tileVer: new Uint32Array(this.tx * this.tz), tileWork: new Uint8Array(this.tx * this.tz), ver: 0, pileVer: 0 };
    this._Cmax = this._Cmax0.slice();
    for (const c of this.cuts) { if (!(c.open > 0)) continue; const D0 = clamp(c.open) * c.depth; let v = 0;
      for (let n = 0; n < c.cells.length; n++) { const q = c.cells[n], to = Math.min(this._Cmax[q], c.cov[n] * D0); if (to > st.C[q]) { const was = st.C[q]; st.C[q] = to; v += (st.C[q] - was) * res * res; this._touch(st, q); } }
      st.cnt.cut += v; st.cnt.open += v; this._heapBeside(st, c, v); }
    this._base = this._snap(st, true); this._keys = []; this._evLog = []; this._evHW = 0; this._spitLog = []; this._st = st; this._groups = new Map();
    for (const s of this.settles) s.D = null;
  }
  _cxz(q) { const i = q % this.nx, j = (q - i) / this.nx; return [this.x0 + (i + 0.5) * this.res, this.z0 + (j + 0.5) * this.res]; }
  // the tiles a cell's vertex is in (a tile's first row and column are also the last of the tile before it)
  _tilesOf(q, fn) { const T = this.T, i = q % this.nx, j = (q - i) / this.nx, a = Math.min(Math.floor(i / T), this.tx - 1), b = Math.min(Math.floor(j / T), this.tz - 1);
    const as = i % T === 0 && i > 0 && i / T - 1 !== a ? [a, i / T - 1] : [a], bs = j % T === 0 && j > 0 && j / T - 1 !== b ? [b, j / T - 1] : [b];
    for (const bb of bs) for (const aa of as) fn(bb * this.tx + aa); }
  _tileX(ti) { return [this.x0 + ti * this.T * this.res, ti === this.tx - 1 ? this.box[2] : this.x0 + (ti + 1) * this.T * this.res]; }
  _tileZ(tj) { return [this.z0 + tj * this.T * this.res, tj === this.tz - 1 ? this.box[3] : this.z0 + (tj + 1) * this.T * this.res]; }
  _touch(st, q) { const ck = ++this._clock; this._tilesOf(q, ti => { st.tileVer[ti] = ck; st.tileWork[ti] = 1; }); st.ver = ck; }

  // ------------------------------------------------------------------ the replay: state(t) = the base + every op with op.t <= t, in order
  _snap(st, base = false) { return { i: st.i, tLast: st.i ? this._ops[st.i - 1].t : -Infinity, C: st.C.slice(), S: st.S.slice(), piles: st.piles.map(p => ({ ...p })), taken: st.taken.map(a => a.slice()),
    breached: st.breached.slice(), cnt: { ...st.cnt }, spitsN: st.spitsN, base }; }
  _restore(k) { const st = this._st; Object.assign(st, { i: k.i, C: k.C.slice(), S: k.S.slice(), piles: k.piles.map(p => ({ ...p })), taken: k.taken.map(a => a.slice()), breached: k.breached.slice(), cnt: { ...k.cnt }, spitsN: k.spitsN });
    this._Cmax = this._Cmax0.slice(); this.joins.forEach((J, n) => { if (st.breached[n]) for (const q of J.bridge) this._Cmax[q] = Math.max(this._Cmax[q], J.depth); });
    this._groups = new Map(); const ck = ++this._clock; st.tileVer.fill(ck); st.tileWork.fill(0);
    for (let q = 0; q < this.N; q++) if (st.C[q] > 0) this._tilesOf(q, ti => { st.tileWork[ti] = 1; });     // as _touch marked them
    st.ver = ck; st.pileVer = ck; }
  _state(t) {
    if (this._dirty) this._rebuild();
    const st = this._st, ops = this._ops;
    if (st.i > 0 && ops[st.i - 1].t > t) { let k = this._base; for (const kf of this._keys) if (kf.tLast <= t && kf.i > k.i) k = kf; this._restore(k); }
    let nextKey = this._keys.length ? this._keys[this._keys.length - 1].tLast + this.keyEvery : (st.i ? ops[st.i - 1].t : -Infinity) + this.keyEvery;
    while (st.i < ops.length && ops[st.i].t <= t) {
      const op = ops[st.i];
      if (op.t >= nextKey && st.i > 0 && !this._keys.some(k => k.i === st.i)) { this._keys.push(this._snap(st)); this._keys.sort((a, b) => a.i - b.i);
        if (this._keys.length > this.maxKeys) this._keys = this._keys.filter((_, n) => n % 2 === 1 || n === this._keys.length - 1); nextKey = op.t + this.keyEvery; }
      const log = st.i >= this._evHW;
      if (op.kind === 'bite') this._bite(st, op, log); else if (op.kind === 'land') this._land(st, op); else if (op.kind === 'join') this._checkJoins(st, op.t, log); else if (op.kind === 'settle') this._settle(st, op.s, log);
      st.i++; if (log) this._evHW = st.i;
    }
    st.t = t; st.tHW = Math.max(st.tHW, t); return st;
  }

  // ------------------------------------------------------------------ a bite: the spit on the blade, then top bench first for the rest
  _groupOf(st, cut) {                                       // the cuts joined to `cut` by breached walls (and those walls)
    const key = cut.id + ':' + st.breached.join(''); let g = this._groups.get(key); if (g) return g;
    const mem = new Set([cut.id]), walls = []; let grew = true;
    while (grew) { grew = false; this.joins.forEach((J, n) => { if (!st.breached[n]) return; const a = mem.has(J.a.id), b = mem.has(J.b.id); if (a !== b) { mem.add(J.a.id); mem.add(J.b.id); grew = true; } if ((a || b) && !walls.includes(J)) walls.push(J); }); }
    const cuts = [...mem].map(i => this.cuts[i]), cand = []; for (const c of cuts) cand.push(...c.cand); for (const J of walls) cand.push(...J.cand);
    const ids = new Uint8Array(this.cuts.length), wid = new Uint8Array(this.joins.length); for (const c of cuts) ids[c.id] = 1; for (const J of walls) wid[J.id] = 1;
    g = { cuts, walls, ids, wid, cand: Int32Array.from(cand), sdf: (x, z) => { let d = Infinity; for (const c of cuts) d = Math.min(d, c.sdf(x, z)); return d; } }; this._groups.set(key, g); return g;
  }
  _cutFor(p) { let best = null, bd = Infinity; for (const c of this.cuts) { const d = c.sdf(p.x, p.z); if (d < bd) { bd = d; best = c; } } return best; }
  _blade(f, e) {                                            // the blade's line (world, unit, into the ground) for this bite
    const V = this.THREE.Vector3;
    if (f.dig && f.dig.plan) { const p = f.dig.plan(e.k); return new V().copy(p.fS.b).applyQuaternion(f.dig.frame.q).normalize(); }
    const s = (SET[f.tool] || SET.spade)[f.drive === 'arms' ? 'arms' : 'foot'], sd = f.lead === 'L' ? 1 : -1; let az;
    if (f.heading != null) az = f.heading + sd * s[1];
    else { const c = f.cut || this._cutFor(e.where), dx = c.centre[0] - e.where.x, dz = c.centre[1] - e.where.z; az = Math.hypot(dx, dz) > 1e-3 ? Math.atan2(dx, dz) : 0; }
    return new V(Math.sin(az) * Math.cos(s[0]), -Math.sin(s[0]), Math.cos(az) * Math.cos(s[0]));
  }
  _bite(st, op, log) {
    const f = op.f, e = op.e;
    if (f.fromHeap) {                                      // a spit off a heap: loose, so it bulks no further when it lands
      const W = e.where, want = (e.kg ?? f.kg) / this.soil.density * this.soil.bulk * f.rate; let p = null, pd = 1.5;
      for (const q of st.piles) { const dd = Math.max(0, Math.hypot(q.x - W.x, q.z - W.z) - q.r - q.len / 2); if (q.vol > 0 && dd < pd) { pd = dd; p = q; } }
      if (!p) { st.cnt.missN++; return; } const v = Math.min(p.vol, want); p.vol -= v; p.r = pileR(p.vol, p.len, this.tanR); p.h = p.r * this.tanR; st.pileVer = ++this._clock;
      st.cnt.spoil -= v; if (e.k >= 0 && e.k < st.taken[f.id].length) st.taken[f.id][e.k] += v / this.soil.bulk; return; }
    const cut = f.cut || this._cutFor(e.where); if (!cut) return;
    const grp = this._groupOf(st, cut), dens = this.soil.density, tgt = (e.kg ?? f.kg) / dens, total = tgt * f.rate, b = this._blade(f, e), d = e.depth ?? f.depth, W = e.where, res = this.res;
    let left = total, got = 0; const sd = grp.sdf(W.x, W.z);
    if (sd > 0.5 * res) { st.cnt.missN++; st.cnt.missBite = Math.max(st.cnt.missBite, (sd - 0.5 * res) * 1000); }
    else if (left > 0) { const v = this._spit(st, op.t, this._wedge(st, W.x, W.y, W.z, b, d, f.bw, grp), Math.min(left, tgt), true, cut); left -= v; got += v; }
    const tried = [], maxTries = 3 * Math.ceil(f.rate) + 8;
    for (let n = 0; n < maxTries && left > total * 1e-4; n++) {
      const q = this._pick(st, grp, W, f.reach, tried); if (q < 0) break; const want = Math.min(left, tgt);
      const v = this._spit(st, op.t, this._benchSpit(st, q, b, d, f.bw, grp), want, false, cut); left -= v; got += v; if (v < 0.25 * want) tried.push(...this._cxz(q));
    }
    st.cnt.short += Math.max(0, left); if (e.k >= 0 && e.k < st.taken[f.id].length) st.taken[f.id][e.k] += got;
    this._checkJoins(st, op.t, log);
  }
  // the highest earth left in the group within reach of W (then anywhere in it), the nearest first; never a kept cell, nor near a spot
  // that has just given nothing
  _pick(st, grp, W, R, tried) {
    const C = st.C, Cm = this._Cmax, K = this._keep, nx = this.nx, x0 = this.x0 + 0.5 * this.res, z0 = this.z0 + 0.5 * this.res, res = this.res;
    for (const lim of [R, Infinity]) { let best = -1, bs = -Infinity;
      for (let n = 0; n < grp.cand.length; n++) { const q = grp.cand[n]; if (K[q] || Cm[q] - C[q] < 0.03) continue;
        const i = q % nx, x = x0 + i * res, z = z0 + ((q - i) / nx) * res, dd = Math.hypot(x - W.x, z - W.z); if (dd > lim) continue;
        let skip = false; for (let m = 0; m < tried.length; m += 2) if (Math.abs(x - tried[m]) < 0.05 && Math.abs(z - tried[m + 1]) < 0.05) { skip = true; break; } if (skip) continue;
        const sc = -C[q] - 0.04 * dd; if (sc > bs) { bs = sc; best = q; } }
      if (best >= 0) return best; }
    return -1;
  }
  // one spit: the wedge between the blade's plane (from P0 down its line to the tip T) and a fracture rising from T, the blade's width
  // wide (its edges anti-aliased over a cell), no deeper than the plan, never on a kept cell. _wedge gathers the cells it could take
  // (at the flattest fracture, 6 deg); _spit solves its fracture slope so it holds `want` m3 of bank (or all there is), or, where even
  // the steepest (85 deg) is too much, a shallower bite; it returns the m3 cut (summed on the float grid as written).
  _wedge(st, px, py, pz, b, d, bw, grp) {
    const res = this.res, w = 0.6 * res, y0 = this.y0, C = st.C, Cm = this._Cmax, K = this._keep, nx = this.nx, nz = this.nz, own = this._own, bo = this._bridgeOf, gi = grp.ids, gw = grp.wid;
    let hb = Math.hypot(b.x, b.z), ax, az; if (hb < 1e-4) { ax = 0; az = 1; } else { ax = b.x / hb; az = b.z / hb; } hb = Math.max(hb, 0.02);
    const ex = -az, ez = ax, sb = b.y / hb;
    // the floor under the tip: the blade goes no deeper than the plan there
    let tx = px + b.x * d, tz = pz + b.z * d, Ty = py + b.y * d;
    for (let it = 0; it < 3; it++) { const fl = y0 - this._nearestCmax(tx, tz, grp); if (Ty >= fl - 1e-9) break;          // (again where the shorter blade's tip lands)
      if (b.y > -1e-3) return null; d = (py - fl) / -b.y; if (d < 0.01) return null; tx = px + b.x * d; tz = pz + b.z * d; Ty = fl; }
    const aT = d * hb, Lf = aT + w + Math.min(this.maxF, Math.max(0, y0 + 1e-3 - Ty) / this.sMin), half = bw / 2 + res;
    const xs = [px - ax * w + ex * half, px - ax * w - ex * half, px + ax * Lf + ex * half, px + ax * Lf - ex * half], zs = [pz - az * w + ez * half, pz - az * w - ez * half, pz + az * Lf + ez * half, pz + az * Lf - ez * half];
    const i0 = clamp(Math.floor((Math.min(...xs) - this.x0) / res), 0, nx - 1), i1 = clamp(Math.ceil((Math.max(...xs) - this.x0) / res), 0, nx - 1);
    const j0 = clamp(Math.floor((Math.min(...zs) - this.z0) / res), 0, nz - 1), j1 = clamp(Math.ceil((Math.max(...zs) - this.z0) / res), 0, nz - 1);
    const Q = [], A = [], WA = [];
    for (let j = j0; j <= j1; j++) { const z = this.z0 + (j + 0.5) * res - pz; for (let i = i0; i <= i1; i++) { const q = j * nx + i; if (K[q] || Cm[q] <= C[q] || !((own[q] && gi[own[q] - 1]) || (bo[q] && gw[bo[q] - 1]))) continue;   // its own cut (and the walls it broke)
      const x = this.x0 + (i + 0.5) * res - px, al = x * ax + z * az, ac = Math.abs(x * ex + z * ez); if (al < -w - 0.5 * res || al > Lf || ac > half) continue;
      const wa = clamp((bw / 2 - ac) / res + 0.5); if (wa <= 0) continue; Q.push(q); A.push(al); WA.push(wa); } }
    if (!Q.length) return null;
    // the wedge for fracture slope s and blade depth dd (<= d: a smaller footprint inside the one gathered)
    const vol = (s, apply, dd = d) => { const ty = py + b.y * dd, at = dd * hb; let v = 0;
      for (let n = 0; n < Q.length; n++) { const q = Q[n], al = A[n], prof = Math.max(ty, py + (al + w) * sb, ty + (al - at - w) * s), to = Math.min(Cm[q], y0 - prof);
        if (to <= C[q]) continue; const nv = C[q] + WA[n] * (to - C[q]); if (apply) { const was = C[q]; C[q] = nv; v += C[q] - was; st.S[q] = 1; this._touch(st, q); if (apply.push) apply.push([q, was, C[q]]); } else v += nv - C[q]; } return v * res * res; };
    return { px, py, pz, b, d, bw, vol, vMax: vol(this.sMin, false) };
  }
  _spit(st, t, W, want, exact, cut) {
    if (!W || W.vMax <= 0) return 0; let s = this.sMin, dd = W.d;
    if (W.vMax > want) { if (W.vol(this.sMax, false) >= want) { s = this.sMax; let lo = 0, hi = W.d; for (let n = 0; n < 24; n++) { const m = (lo + hi) / 2; if (W.vol(s, false, m) > want) hi = m; else lo = m; } dd = (lo + hi) / 2; }   // even the steepest wedge is too much: a shallower bite
      else { let lo = Math.log(this.sMin), hi = Math.log(this.sMax); for (let n = 0; n < 22; n++) { const m = (lo + hi) / 2; if (W.vol(Math.exp(m), false) > want) lo = m; else hi = m; } s = Math.exp((lo + hi) / 2); } }
    const cells = this.trace ? [] : true, v = W.vol(s, cells, dd); if (v <= 0) return 0;
    st.cnt.cut += v; st.cnt.spits++; const V = this.THREE.Vector3, b = W.b;
    if (st.spitsN < this._spitLog.length) this._spitLog.length = st.spitsN;
    this._spitLog.push({ t, cut: cut.id, exact, P0: new V(W.px, W.py, W.pz), T: new V(W.px + b.x * dd, W.py + b.y * dd, W.pz + b.z * dd), b: b.clone(), d: dd, bw: W.bw, s, m3: v, want }); st.spitsN = this._spitLog.length;
    if (this.trace) this.trace(this._spitLog[this._spitLog.length - 1], cells, { C: st.C, nx: this.nx, nz: this.nz, res: this.res, x0: this.x0, z0: this.z0, y0: this.y0 });
    return v;
  }
  // a top-bench spit at the high cell q: the blade turned (the digger's line, a quarter, a half, three quarters) so its tip comes under
  // q's centre, whichever holds the most
  _benchSpit(st, q, b, d, bw, grp) {
    const [x, z] = this._cxz(q), y = this.y0 - st.C[q]; let best = null;
    for (let k = 0; k < 4; k++) { const c = Math.cos(k * Math.PI / 2), sn = Math.sin(k * Math.PI / 2), bk = b.clone().set(b.x * c + b.z * sn, b.y, -b.x * sn + b.z * c), px = x - bk.x * d, pz = z - bk.z * d;
      if (!(this._nearestCmax(px, pz, grp) > 0)) continue;                                                                   // the blade goes in inside its own cut
      const W = this._wedge(st, px, y, pz, bk, d, bw, grp); if (W && (!best || W.vMax > best.vMax + 1e-12)) best = W; }
    return best;
  }
  _nearestCmax(x, z, grp) { const i = Math.floor((x - this.x0) / this.res), j = Math.floor((z - this.z0) / this.res); if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return 0; const q = j * this.nx + i, o = this._own[q], br = this._bridgeOf[q];
    return (o && grp.ids[o - 1]) || (br && grp.wid[br - 1]) ? this._Cmax[q] : 0; }   // the plan's depth at the tip, in this group's own cuts
  _land(st, op) {
    const f = op.f, e = op.e, k = e.k; if (!(k >= 0 && k < st.taken[f.id].length)) return; const v = st.taken[f.id][k] * this.soil.bulk; st.taken[f.id][k] = 0; if (v <= 0) return;
    this._pile(st, e.where.x, e.where.y, e.where.z, v); st.cnt.spoil += v;
  }
  _pile(st, x, y, z, v, { len = 0, ax = 1, az = 0, merge = 0.3 } = {}) {
    let p = len ? null : st.piles.find(p => !p.len && Math.hypot(p.x - x, p.z - z) < merge && Math.abs(p.y - y) < 0.3);
    if (!p) { p = { x, y, z, vol: 0, len, ax, az, r: 0, h: 0 }; st.piles.push(p); }
    p.vol += v; p.r = pileR(p.vol, p.len, this.tanR); p.h = p.r * this.tanR; st.pileVer = ++this._clock;
  }
  _heapBeside(st, c, v) {                                     // bank m3 v off cut c, bulked, on its heap (one ridge per path segment)
    if (v <= 0) return; const tn = this.tanR;
    for (const s of c.heapSegs) { const vb = v * this.soil.bulk * s.f; if (s.fixed || s.len <= 1e-6) { const r = s.fixed ? 0 : pileR(vb, 0, tn); this._pile(st, s.x + s.nx * (s.off + r), this.y0, s.z + s.nz * (s.off + r), vb, { merge: Math.max(0.3, r) }); continue; }
      // a ridge that would hold the whole of this cut's open spoil sits clear of the wall by `gap`
      const r = pileR(vb, s.len, tn), off = s.off + r, ex = st.piles.find(p => p.len && Math.abs(p.ax - s.ax) < 1e-9 && Math.abs(p.az - s.az) < 1e-9 && p.seg === s);
      if (ex) { ex.vol += vb; ex.r = pileR(ex.vol, ex.len, tn); ex.h = ex.r * tn; st.pileVer = ++this._clock; }
      else { this._pile(st, s.x + s.nx * off, this.y0, s.z + s.nz * off, vb, { len: s.len, ax: s.ax, az: s.az }); st.piles[st.piles.length - 1].seg = s; } }
    st.cnt.spoil += v * this.soil.bulk;
  }
  // ------------------------------------------------------------------ joins: the wall breaks when both sides reach it
  _checkJoins(st, t, log) {
    this.joins.forEach((J, n) => {
      if (st.breached[n] || t < J.at) return; const C = st.C, mean = L => { let s = 0; for (const q of L) s += C[q]; return L.length ? s / L.length : 0; };
      const ma = mean(J.sideA), mb = mean(J.sideB), need = J.need * J.depth; if (ma < need || mb < need) return;
      const lvl = Math.min(ma, mb, J.depth); let v = 0; st.breached[n] = 1;
      for (const q of J.bridge) { this._Cmax[q] = Math.max(this._Cmax[q], J.depth); if (lvl > C[q]) { const was = C[q]; C[q] = lvl; v += (C[q] - was) * this.res * this.res; this._touch(st, q); } }
      st.cnt.cut += v;                                       // its earth: on the nearest heap the crew has made (3 m), else beside a
      let hp = null, hd = 3; for (const p of st.piles) { const dd = Math.hypot(p.x - J.centre[0], p.z - J.centre[1]); if (!p.len && dd < hd) { hd = dd; hp = p; } }
      if (hp && v > 0) { hp.vol += v * this.soil.bulk; hp.r = pileR(hp.vol, 0, this.tanR); hp.h = hp.r * this.tanR; st.pileVer = ++this._clock; st.cnt.spoil += v * this.soil.bulk; } else this._heapBeside(st, J.a, v);
      if (log) this._evLog.push({ t, kind: 'breach', where: new this.THREE.Vector3(J.centre[0], this.y0 - lvl, J.centre[1]), cuts: [J.a.id, J.b.id] });
    });
  }
  // ------------------------------------------------------------------ settle: the overlay, from the cut state at its t
  _settle(st, s, log) {
    if (!s.D) {
      const { N, nx, res, x0, z0, tanR } = this, D = new Float32Array(N), C = st.C, cuts = s.cuts, bil = (x, z) => this._bil(C, x, z);
      for (const c of cuts) {
        const m = s.shear + res * 2, [bx0, bz0, bx1, bz1] = c.bbox, i0 = clamp(Math.floor((bx0 - m - x0) / res), 0, nx - 1), i1 = clamp(Math.ceil((bx1 + m - x0) / res), 0, nx - 1), j0 = clamp(Math.floor((bz0 - m - z0) / res), 0, this.nz - 1), j1 = clamp(Math.ceil((bz1 + m - z0) / res), 0, this.nz - 1);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const q = j * nx + i, x = x0 + (i + 0.5) * res, z = z0 + (j + 0.5) * res, d = c.sdf(x, z);
          if (d > 0 && d < s.shear) {                                                            // the lip: down to the failure plane from the toe
            const gx = c.sdf(x + res, z) - c.sdf(x - res, z), gz = c.sdf(x, z + res) - c.sdf(x, z - res), g = Math.hypot(gx, gz) || 1, H = bil(x - gx / g * (d + 1.5 * res), z - gz / g * (d + 1.5 * res));
            const to = H * (1 - d / s.shear); if (to > C[q] + 1e-4) D[q] = Math.min(D[q], -(to - C[q])); }
          else if (d <= 0 && C[q] > 0) {                                                          // the toe: what fell, at the angle of repose
            const A = 0.5 * s.shear * C[q], wd = Math.min(Math.sqrt(2 * A / tanR), Math.max(res, c.halfW)), hd = 2 * A / wd, up = Math.min(C[q] * 0.9, hd * (1 + d / wd));
            if (up > 0) D[q] = Math.max(D[q], up); } } }
      for (let a = 0; a < cuts.length; a++) for (let b = a + 1; b < cuts.length; b++) {          // the ground between two cuts drops
        const A = cuts[a], B = cuts[b]; let gap = Infinity; for (const q of A.inner) gap = Math.min(gap, Math.max(0, B.sdf(...this._cxz(q))));
        const bb = [Math.min(A.bbox[0], B.bbox[0]) - s.feather, Math.min(A.bbox[1], B.bbox[1]) - s.feather, Math.max(A.bbox[2], B.bbox[2]) + s.feather, Math.max(A.bbox[3], B.bbox[3]) + s.feather];
        const i0 = clamp(Math.floor((bb[0] - x0) / res), 0, nx - 1), i1 = clamp(Math.ceil((bb[2] - x0) / res), 0, nx - 1), j0 = clamp(Math.floor((bb[1] - z0) / res), 0, this.nz - 1), j1 = clamp(Math.ceil((bb[3] - z0) / res), 0, this.nz - 1);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = x0 + (i + 0.5) * res, z = z0 + (j + 0.5) * res, da = A.sdf(x, z), db = B.sdf(x, z); if (da <= 0 || db <= 0) continue;
          const wgt = 1 - sstep(gap, gap + s.feather, da + db); if (wgt > 0) { const q = j * nx + i; D[q] = Math.min(D[q], -s.drop * wgt); } } }
      const tiles = new Set(); let dv = 0; for (let q = 0; q < N; q++) if (D[q] !== 0) { dv += D[q] * res * res; this._tilesOf(q, ti => tiles.add(ti)); }
      s.D = D; s.tiles = [...tiles]; s.m3 = dv;
    }
    if (log) for (const c of s.cuts) this._evLog.push({ t: s.t, kind: 'slump', where: new this.THREE.Vector3(c.centre[0], this.y0 - (this._depthNow(st, c)), c.centre[1]), cut: c.id });
  }
  _depthNow(st, c) { let s = 0; for (const q of c.inner) s += st.C[q]; return c.inner.length ? s / c.inner.length : 0; }
  _bil(A, x, z) { const fx = (x - this.x0) / this.res - 0.5, fz = (z - this.z0) / this.res - 0.5, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, nx = this.nx, nz = this.nz;
    const g = (a, b) => (a < 0 || b < 0 || a >= nx || b >= nz) ? 0 : A[b * nx + a]; return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v; }
  _settleAt(x, z, t) { let h = 0; for (const s of this.settles) if (s.D && t > s.t) h += smoother((t - s.t) / s.over) * this._bil(s.D, x, z); return h; }
  _hAt(st, x, z, t, piles) { let y = this.y0 - this._bil(st.C, x, z) + this._settleAt(x, z, t); if (piles) for (const p of st.piles) y += pileH(p, x, z, this.tanR); return y; }

  // ------------------------------------------------------------------ drawing
  update(t, camera, { near = this.near } = {}) {
    const st = this._state(t); if (!this.scene) return this.stats;
    const G = this._gfx || this._makeGfx(), THREE = this.THREE, cam = camera ? (camera.position || new THREE.Vector3(...camera)) : null, T = this.T, res = this.res;
    const ks = this.settles.map(s => (s.D && t > s.t ? smoother((t - s.t) / s.over) : 0)), sTile = new Map();
    this.settles.forEach((s, n) => { if (ks[n] > 0) for (const ti of s.tiles) sTile.set(ti, (sTile.get(ti) || '') + n + ':' + ks[n] + ';'); });
    const farList = [];
    for (let tj = 0; tj < this.tz; tj++) for (let ti = 0; ti < this.tx; ti++) {
      const id = tj * this.tx + ti, [xa, xb] = this._tileX(ti), [za, zb] = this._tileZ(tj);
      const worked = st.tileWork[id] || sTile.has(id), dist = cam ? Math.hypot(Math.max(xa - cam.x, 0, cam.x - xb), cam.y - this.y0, Math.max(za - cam.z, 0, cam.z - zb)) : Infinity;
      let m = G.tiles.get(id);
      if (worked && dist < near) { if (!m) { m = this._tileMesh(ti, tj); G.tiles.set(id, m); G.group.add(m); }
        const key = st.tileVer[id] + '|' + (sTile.get(id) || ''); if (m.userData.key !== key) { this._fillTile(st, m, ti, tj, t); m.userData.key = key; } m.visible = true; }
      else { if (m) m.visible = false; farList.push(xa, za, xb, zb); }
    }
    const fk = farList.join(','); if (fk !== G.farKey) { G.farKey = fk; const M = new THREE.Matrix4(), n = farList.length / 4;
      for (let k = 0; k < n; k++) { const [xa, za, xb, zb] = farList.slice(k * 4, k * 4 + 4); M.makeScale(xb - xa, 1, zb - za).setPosition((xa + xb) / 2, this.y0, (za + zb) / 2); G.far.setMatrixAt(k, M); }
      G.far.count = n; G.far.instanceMatrix.needsUpdate = true; }
    if (G.stampVer !== st.ver) { this._fillStamp(st); G.stampVer = st.ver; }
    if (G.pileVer !== st.pileVer) { this._fillPiles(st); G.pileVer = st.pileVer; }
    return this.stats;
  }
  setVisible(v) { if (this._gfx) this._gfx.group.visible = v; }
  // a ground square `size` m across round the box, with the box's hole: the scene's ground outside Earthwork's
  surround({ size = 2000 } = {}) {
    const THREE = this.THREE, G = this._gfx || this._makeGfx(), [a, b, c, d] = this.box, cx = (a + c) / 2, cz = (b + d) / 2, h = size / 2, y = this.y0;
    const P = [[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h], [a, b], [c, b], [c, d], [a, d]], pos = [], idx = [];
    for (const [x, z] of P) pos.push(x, y, z); for (let k = 0; k < 4; k++) { const o0 = k, o1 = (k + 1) % 4, i0 = 4 + k, i1 = 4 + (k + 1) % 4; idx.push(o0, i0, o1, o1, i0, i1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, G.groundMat); m.receiveShadow = true; m.name = 'earthwork.surround'; G.group.add(m); return m;
  }
  _makeGfx() {
    const THREE = this.THREE, G = this._gfx = { tiles: new Map(), farKey: null, stampVer: -1, pileVer: -1, group: new THREE.Group() }; G.group.name = 'earthwork';
    if (this.scene) this.scene.add(G.group);
    const lin = h => new THREE.Color(h), lf = this.lf, patch = m => { if (lf) patchMaterial(m, lf, { wallFall: 6 }); return m; };
    this._lin = { ground: lin(this.colors.ground), earth: lin(this.colors.earth) };
    // near: vertex colours (grass at grade, earth in the cut), flat shading (a facet per triangle: the spit's planes are true), and on the
    // steep faces of the open cut a seeded spade bite per bench and blade's width (aEWf = 1 where no live spit has cut)
    const nm = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0 }), U = { uEWy0: { value: this.y0 }, uEWSeed: { value: (this.seed % 997) * 1.37 }, uEWBench: { value: new THREE.Vector2(0.21, 0.185) } };
    nm.onBeforeCompile = sh => { Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aEWf; attribute float aEWs; varying float vEWf; varying float vEWs; varying vec3 vEWp;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n vEWf = aEWf; vEWs = aEWs; vEWp = (modelMatrix * vec4(transformed, 1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying float vEWf; varying float vEWs; varying vec3 vEWp; uniform float uEWy0, uEWSeed; uniform vec2 uEWBench;
float ew_h(float n){ return fract(sin(n * 127.1 + 311.7) * 43758.5453); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  vec3 ewN = normalize(cross(dFdx(vEWp), dFdy(vEWp))); if (dot(ewN, cameraPosition - vEWp) < 0.) ewN = -ewN;
  float ewF = vEWf * (1. - smoothstep(0.45, 0.7, abs(ewN.y))); vec3 ewQ = ewN;
  if (ewF > 0.001) {
    vec2 hz = normalize(ewN.xz + 1e-6), al = vec2(-hz.y, hz.x); float sd = uEWSeed + vEWs * 7.31, s = dot(vEWp.xz, al), yb = uEWy0 - vEWp.y;
    float bench = floor(yb / uEWBench.x + 0.35 * ew_h(floor(s / 0.93) + sd));
    float bite = floor((s + ew_h(bench * 7.13 + sd) * uEWBench.y) / uEWBench.y);
    float h1 = ew_h(bench * 17.1 + bite * 3.7 + sd), h2 = ew_h(bench * 5.3 + bite * 11.9 + sd + 2.), h3 = ew_h(bench * 2.9 + bite * 23.3 + sd + 5.);
    float pitch = mix(0.1, 0.36, h1), yaw = (h2 - 0.5) * 0.4;
    vec3 hzw = vec3(hz.x, 0., hz.y), alw = vec3(al.x, 0., al.y);
    vec3 np = normalize(hzw * cos(pitch) + vec3(0., 1., 0.) * sin(pitch)); np = normalize(np * cos(yaw) + alw * sin(yaw));
    ewQ = normalize(mix(ewN, np, ewF)); diffuseColor.rgb *= mix(1., 0.9 + 0.2 * h3, ewF);
  }`)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  if (ewF > 0.001) normal = normalize((viewMatrix * vec4(ewQ, 0.)).xyz);'); };
    nm.customProgramCacheKey = () => 'earthwork-near';
    G.nearMat = patch(nm);
    // far: the ground at grade, darkened by the cut's depth (a stamp texture over the box, 4 cells a texel)
    const sx = Math.ceil(this.nx / 4), sz = Math.ceil(this.nz / 4); G.stampW = sx; G.stampH = sz; G.stampData = new Uint8Array(sx * sz * 4);
    G.stamp = new THREE.DataTexture(G.stampData, sx, sz, THREE.RGBAFormat, THREE.UnsignedByteType); G.stamp.magFilter = G.stamp.minFilter = THREE.LinearFilter; G.stamp.wrapS = G.stamp.wrapT = THREE.ClampToEdgeWrapping; G.stamp.needsUpdate = true;
    const fm = new THREE.MeshStandardMaterial({ color: this.colors.ground, roughness: this.colors.groundRough, metalness: 0 }), FU = { uEWStamp: { value: G.stamp }, uEWBox: { value: new THREE.Vector4(this.box[0], this.box[1], this.box[2] - this.box[0], this.box[3] - this.box[1]) }, uEWEarth: { value: this._lin.earth } };
    fm.onBeforeCompile = sh => { Object.assign(sh.uniforms, FU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vEWw;').replace('#include <project_vertex>', `#include <project_vertex>
  { vec4 ewp = vec4(transformed, 1.);
    #ifdef USE_INSTANCING
    ewp = instanceMatrix * ewp;
    #endif
    vEWw = (modelMatrix * ewp).xyz; }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vEWw; uniform sampler2D uEWStamp; uniform vec4 uEWBox; uniform vec3 uEWEarth;')
        .replace('#include <color_fragment>', `#include <color_fragment>
  { float ewD = texture2D(uEWStamp, (vEWw.xz - uEWBox.xy) / uEWBox.zw).r * 3.0, ewK = smoothstep(0.004, 0.04, ewD);
    diffuseColor.rgb = mix(diffuseColor.rgb, uEWEarth * exp(-ewD / 0.45), ewK); }`); };
    fm.customProgramCacheKey = () => 'earthwork-far';
    G.farMat = patch(fm); G.groundMat = patch(new THREE.MeshStandardMaterial({ color: this.colors.ground, roughness: this.colors.groundRough, metalness: 0 }));
    const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
    G.far = new THREE.InstancedMesh(pg, G.farMat, this.tx * this.tz); G.far.count = 0; G.far.receiveShadow = true; G.far.frustumCulled = false; G.far.name = 'earthwork.far'; G.group.add(G.far);
    // spoil: loose earth, smooth
    G.pileMat = patch(new THREE.MeshStandardMaterial({ color: this.colors.spoil, roughness: 1, metalness: 0 }));
    const cg = new THREE.ConeGeometry(1, 1, 32, 4, true); cg.translate(0, 0.5, 0); G.coneGeo = cg; G.cones = null; G.ridges = null;
    return G;
  }
  _tileMesh(ti, tj) {
    const THREE = this.THREE, T = this.T, i0 = ti * T, j0 = tj * T, i1 = Math.min(this.nx - 1, i0 + T), j1 = Math.min(this.nz - 1, j0 + T), w = i1 - i0 + 1, h = j1 - j0 + 1, nv = w * h, ns = 2 * (w + h);
    const g = new THREE.BufferGeometry(), A = (n, k) => new THREE.BufferAttribute(new Float32Array(n * k), k);
    g.setAttribute('position', A(nv + 2 * ns, 3)); g.setAttribute('normal', A(nv + 2 * ns, 3)); g.setAttribute('color', A(nv + 2 * ns, 3)); g.setAttribute('aEWf', A(nv + 2 * ns, 1)); g.setAttribute('aEWs', A(nv + 2 * ns, 1));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(6 * ((w - 1) * (h - 1) + ns)), 1));
    const m = new THREE.Mesh(g, this._gfx.nearMat); m.castShadow = m.receiveShadow = true; m.frustumCulled = false; m.name = `earthwork.tile.${ti}.${tj}`;
    m.userData = { i0, j0, w, h, key: null }; return m;
  }
  // the tile's vertices at its cells' centres (the first and last row and column pulled out to the tile's edges, so tiles meet the far
  // quads without a crack), heights from the cut and the settle overlay, each quad split on its flatter diagonal; skirts 1.5 m down
  _fillTile(st, m, ti, tj, t) {
    const { i0, j0, w, h } = m.userData, g = m.geometry, P = g.attributes.position.array, Nn = g.attributes.normal.array, Cc = g.attributes.color.array, F = g.attributes.aEWf.array, Sd = g.attributes.aEWs.array, I = g.index.array;
    const { nx, res, y0 } = this, C = st.C, S = st.S, gC = this._lin.ground, eC = this._lin.earth, [xa, xb] = this._tileX(ti), [za, zb] = this._tileZ(tj);
    const act = this.settles.map(s => (s.D && t > s.t ? smoother((t - s.t) / s.over) : 0)), Y = new Float32Array(w * h);
    for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) { const q = (j0 + b) * nx + i0 + a; let y = y0 - C[q], drop = 0; this.settles.forEach((s, n) => { if (act[n]) { y += act[n] * s.D[q]; drop = Math.max(drop, -act[n] * s.D[q]); } }); Y[b * w + a] = y;
      const v = b * w + a, x = a === 0 ? xa : a === w - 1 ? xb : this.x0 + (i0 + a + 0.5) * res, z = b === 0 ? za : b === h - 1 ? zb : this.z0 + (j0 + b + 0.5) * res;
      P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
      const c = Math.max(C[q], drop), k = sstep(0.004, 0.035, c), dk = 1 - 0.3 * clamp(C[q] / 1.8);
      Cc[v * 3] = gC.r + (eC.r * dk - gC.r) * k; Cc[v * 3 + 1] = gC.g + (eC.g * dk - gC.g) * k; Cc[v * 3 + 2] = gC.b + (eC.b * dk - gC.b) * k; F[v] = S[q] ? 0 : 1; Sd[v] = this._seedOf[q] % 1000; }
    for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) { const v = b * w + a, yl = Y[b * w + Math.max(0, a - 1)], yr = Y[b * w + Math.min(w - 1, a + 1)], yd = Y[Math.max(0, b - 1) * w + a], yu = Y[Math.min(h - 1, b + 1) * w + a];
      const nx_ = -(yr - yl) / (2 * res), nz_ = -(yu - yd) / (2 * res), l = Math.hypot(nx_, 1, nz_); Nn[v * 3] = nx_ / l; Nn[v * 3 + 1] = 1 / l; Nn[v * 3 + 2] = nz_ / l; }
    let n = 0;
    for (let b = 0; b + 1 < h; b++) for (let a = 0; a + 1 < w; a++) { const v00 = b * w + a, v10 = v00 + 1, v01 = v00 + w, v11 = v01 + 1;
      if (Math.abs(Y[v00] - Y[v11]) <= Math.abs(Y[v10] - Y[v01])) { I[n++] = v00; I[n++] = v01; I[n++] = v11; I[n++] = v00; I[n++] = v11; I[n++] = v10; }
      else { I[n++] = v00; I[n++] = v01; I[n++] = v10; I[n++] = v10; I[n++] = v01; I[n++] = v11; } }
    // skirts: each edge's vertices and a copy 1.5 m under them, wound to face out of the tile
    let sv = w * h; const edge = (list, out) => { for (let k = 0; k + 1 < list.length; k++) { const a = list[k], b2 = list[k + 1], s0 = sv; for (const v of [a, b2]) { P[sv * 3] = P[v * 3]; P[sv * 3 + 1] = P[v * 3 + 1] - 1.5; P[sv * 3 + 2] = P[v * 3 + 2]; Nn[sv * 3] = out[0]; Nn[sv * 3 + 1] = 0; Nn[sv * 3 + 2] = out[1];
          Cc[sv * 3] = eC.r * 0.6; Cc[sv * 3 + 1] = eC.g * 0.6; Cc[sv * 3 + 2] = eC.b * 0.6; F[sv] = 0; Sd[sv] = 0; sv++; }
        I[n++] = a; I[n++] = s0; I[n++] = b2; I[n++] = b2; I[n++] = s0; I[n++] = s0 + 1; } };
    const row = b => Array.from({ length: w }, (_, a) => b * w + a), col = a => Array.from({ length: h }, (_, b) => b * w + a);
    edge(row(0).reverse(), [0, -1]); edge(row(h - 1), [0, 1]); edge(col(0), [-1, 0]); edge(col(w - 1).reverse(), [1, 0]);
    g.setDrawRange(0, n); for (const k of ['position', 'normal', 'color', 'aEWf', 'aEWs']) g.attributes[k].needsUpdate = true; g.index.needsUpdate = true;
    g.boundingSphere = null; g.boundingBox = null;
  }
  _fillStamp(st) {
    const G = this._gfx, D = G.stampData, { nx, nz } = this, C = st.C;
    for (let b = 0; b < G.stampH; b++) for (let a = 0; a < G.stampW; a++) { let s = 0, n = 0; for (let j = b * 4; j < Math.min(nz, b * 4 + 4); j++) for (let i = a * 4; i < Math.min(nx, a * 4 + 4); i++) { s += C[j * nx + i]; n++; }
      const v = Math.round(clamp(s / Math.max(1, n) / 3) * 255), o = (b * G.stampW + a) * 4; D[o] = D[o + 1] = D[o + 2] = v; D[o + 3] = 255; }
    G.stamp.needsUpdate = true;
  }
  _fillPiles(st) {
    const THREE = this.THREE, G = this._gfx, cones = st.piles.filter(p => !p.len && p.r > 0.005), ridges = st.piles.filter(p => p.len && p.r > 0.005);
    if (!G.cones || G.cones.instanceMatrix.count < cones.length) { if (G.cones) { G.group.remove(G.cones); G.cones.dispose(); }
      G.cones = new THREE.InstancedMesh(G.coneGeo, G.pileMat, Math.max(16, 2 * cones.length)); G.cones.castShadow = G.cones.receiveShadow = true; G.cones.frustumCulled = false; G.cones.name = 'earthwork.heaps'; G.group.add(G.cones); }
    const M = new THREE.Matrix4(); cones.forEach((p, k) => { M.makeScale(p.r, p.h, p.r).setPosition(p.x, p.y, p.z); G.cones.setMatrixAt(k, M); }); G.cones.count = cones.length; G.cones.instanceMatrix.needsUpdate = true;
    // ridges: a stadium of radius r round a spine of length len, each boundary point joined to the spine's top
    const pos = [], idx = []; for (const p of ridges) { const n0 = pos.length / 3, nr = 24, B = [];
      for (const sgn of [1, -1]) for (let k = 0; k <= nr; k++) { const a = -Math.PI / 2 + Math.PI * k / nr, ux = Math.cos(a), uy = Math.sin(a), s = sgn * p.len / 2, dx = sgn * ux, dz = sgn * uy;
        B.push([p.x + p.ax * s + (p.ax * dx - p.az * dz) * p.r, p.z + p.az * s + (p.az * dx + p.ax * dz) * p.r, s]); }
      for (const [x, z, s] of B) pos.push(p.x + p.ax * s, p.y + p.h, p.z + p.az * s, x, p.y, z);
      for (let k = 0; k < B.length; k++) { const a = n0 + 2 * k, b = n0 + 2 * ((k + 1) % B.length); idx.push(a, b, a + 1, b, b + 1, a + 1); } }
    if (G.ridges) { G.group.remove(G.ridges); G.ridges.geometry.dispose(); G.ridges = null; }
    if (pos.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      G.ridges = new THREE.Mesh(g, G.pileMat); G.ridges.castShadow = G.ridges.receiveShadow = true; G.ridges.name = 'earthwork.ridges'; G.group.add(G.ridges); }
  }
}
Earthwork.TOOLS = SHOVELS;
