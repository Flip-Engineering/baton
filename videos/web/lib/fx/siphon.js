// SIPHON (lib/fx/siphon.js; DEAD LABOUR, Oct 2026): light drawn along threads from many sources into one sink, and given back,
// with a ledger that conserves it. The studio's verb for extraction and its reversal.
//   "What you gain in labour I lose in substance." (Marx, Capital I, ch. 10; research/sources/texts/marx-capital1-ch10.txt:41)
// Dead labour makes no light of its own: a sink holds only what it took and gives back only that (there is no 'emit').
// Stateless: every frame is a pure function of t (no integration, no history), so --seg, --stills and the farm's out-of-order
// frames match a full render.
//
//   import { Siphon, SiphonLedger, Siphon2D } from '../lib/fx/siphon.js';
//   const sy = new Siphon(scene, { max: 2400, seg: 24, width: 0.6, minPx: 1.3, warm: '#ffc27a', cold: '#d8ecff',
//                                  lift: 0.35, sag: 0.12, curl: 0.08, reach: 1500, seed: 1867, atmos: A });
//   sy.sink('body', { face: { p, n, w, h } });             // a face rectangle; { p, r } a sphere; { box: { c, half } } a box's
//                                                         // faces (each thread to the face turned to it); { glyph: pts, n }
//   sy.sink('h18', { glyph: pts3, n: [0, 0, 1] });         // points inside type (Siphon.glyphPoints): arriving light fills it
//   const i = sy.source({ p, w: 1, group: 'r7' });         // a window floor, a lamp, an eye pair, a county's town light
//   sy.flow({ group: 'r1', sink: 'body', dir: +1, t0: -3, t1: 6.8 });                       // +1 drain (sources -> sink)
//   sy.flow({ group: 'O',  sink: 'body', dir: +1, flux: [[11.2, 0], [11.8, 1], [15.7, 1], [16.0, 0]] });  // a dip is a stall
//   sy.flow({ group: 'r7', sink: 'h18', dir: -1, at: 21.4, dur: 0.8 });                    // -1 return (sink -> its own sources)
//   sy.train(times);                                   // packets ride the threads on these times (the score's exported beats)
//   sy.update(t, camera, viewH);                       // once a frame before render: uniforms and one small texture, O(sources) CPU
//
// Per flow: spread (each source's own departure, as a fraction of the flow's progress; default 0.35), travel (seconds from one end
// of a thread to the other; default 1), key / range (the order the sources go in: by default distance xz from the sink's centre
// minus yK * height, so a ring's top floors go first, ranked over `range` [lo, hi] or over the flow's own sources).
//
// Reads (pure functions of t):
//   sy.left(i, t)        0..1 light still at source i      -> dim the host by exactly that (window, lamp, eye)
//   sy.held(sink, t)     light the sink holds              -> its glow, a glyph's fill, a filter macro in the score
//   sy.cap(sink)         the most the sink ever holds in the plan (held / cap is a 0..1 level)
//   sy.wipe(sink, t)     { a, d }: the share of cap that has arrived, and the share given back (held / cap = a - d): a glyph
//                        fills top-down to a and empties top-down to d, because its points are handed out to the sources in order
//   sy.front(group, t)   { drain, ret, ... }: the group's drain progress and its return's arrival progress (facadeDrain's front)
//   sy.ledger(t)         { atSources, inFlight, held, total }   total never changes; the node checks test every frame
//   sy.arrivals(t0, t1)  [{ t, i, sink, dir }]              packet arrivals, for the cue sheet and the score
//   sy.share(f, sink)    sources nearest the sink holding fraction f of the weight (honest proportions for data pieces)
//   SiphonLedger         the same ledger with no WebGL (runs in node): writes the curves the song reads
//
// Adapters (no engine file is edited):
//   Siphon.facadeDrain(mat, sy, { c, rings: [{ r0, r1, group, yMax }], yK: 0.6, cold: '#33404c', keep: 0.55 })
//     chains an americana_city facadeMaterial's onBeforeCompile (throws when 'winEm *= uWG;' is not found; new program cache key):
//     each ring's windows lose their warmth to `cold` as left(group) falls, top floors first (order = dist_xz - yK*y); never black
//   sy.toLightField(lf, { group: indices }, { buckets: 8 })
//     LightField practicals follow left() through americana_c2.lfSwitch, quantised so the lightmap redraws at most 8x per flow
//   sy.moveSink(name, { sy, oy })   a sink's points move with its host (y' = y * sy + oy: a slab whose height is data)
//   new Siphon2D(sy, project).draw(ctx, t)   the same threads as canvas strokes for maps and print (USMap: p => us.toScreen(p))
//
// Drawing: one InstancedMesh of camera-facing ribbon segments, additive, depth-tested (heads and towers hide threads), not
// depth-written (eyes.js's pattern; in an Atmos world the threads go in A.overlay and test the scene's depth texture per fragment,
// and take the haze like the LightField sprites); width in metres with a floor in pixels (a thread thinner than its floor is
// dimmed by the ratio, down to 0.3, so a far thread is not as bright as a near one). Each thread is a cubic from source to sink
// point, lifted, sagged and lightly curled by a hashed seed: smooth light, never a tentacle. What a thread shows is exactly the
// light in flight on it: at u (0 at the source) the light that left t - u*travel ago (a drain) or arrives in (1 - u)*travel (a
// return), as the ledger has it, binned in 8 along the thread. Warm at the source, cold at the sink, so the living light dies on
// the way; a return runs its packets backward. ~2,400 threads x 24 segments = ~58k quads, one draw. Not particles/swarm.js
// (raw-WebGL2 A->B morph on its own canvas: no scene depth, no ledger) nor streaks.js (multiply-blended ink on white).
// Checks: node web/labs/siphon/siphon_test.mjs (the ledger on every frame, drain/return symmetry, the facade patch on three's own
// shader source, lfSwitch redraw counts, share, arrivals). Notes: research/capabilities/siphon.md.
import * as THREE from 'three';
import { ATMOS_GLSL } from './atmos3d.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sst = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
function mulberry(seed) { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const V = a => Array.isArray(a) ? a.slice(0, 3) : [a.x, a.y, a.z];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]), nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ------------------------------------------------------------------ a flow's progress P(t), 0..1, closed form
// a window [t0, t1] (or at, dur) is a constant flux; a flux curve [[t, f], ...] is piecewise linear and P is its normalised
// integral (exact: each piece integrates to a trapezoid), so a dip in the flux is a stall and every frame is a pure function of t
class Progress {
  constructor(f) {
    let pts = f.flux;
    if (!pts) { const t0 = f.t0 ?? f.at, t1 = f.t1 ?? (f.at + (f.dur ?? 1)); if (!(t1 > t0)) throw new Error(`siphon: flow on '${f.group}' has no span`); pts = [[t0, 1], [t1, 1]]; this.box = true; }
    this.T = pts.map(p => +p[0]); this.F = pts.map(p => Math.max(0, +p[1]));
    for (let i = 1; i < this.T.length; i++) if (!(this.T[i] > this.T[i - 1])) throw new Error('siphon: flux times must increase');
    this.C = [0]; for (let i = 1; i < this.T.length; i++) this.C.push(this.C[i - 1] + 0.5 * (this.F[i] + this.F[i - 1]) * (this.T[i] - this.T[i - 1]));
    this.total = this.C[this.C.length - 1]; if (!(this.total > 0)) throw new Error(`siphon: flow on '${f.group}' moves nothing (zero flux)`);
    this.t0 = this.T[0]; this.t1 = this.T[this.T.length - 1];
  }
  at(t) {
    const T = this.T; if (t <= T[0]) return 0; if (t >= T[T.length - 1]) return 1;
    let i = 0; while (t > T[i + 1]) i++;
    const h = t - T[i], f0 = this.F[i], f1 = this.F[i + 1], k = (f1 - f0) / (T[i + 1] - T[i]);
    return (this.C[i] + f0 * h + 0.5 * k * h * h) / this.total;
  }
  rate(t) {          // dP/dt (for packets: light leaves only where the flux is on)
    const T = this.T; if (t < T[0] || t > T[T.length - 1]) return 0;
    let i = 0; while (i < T.length - 2 && t > T[i + 1]) i++;
    const u = (t - T[i]) / (T[i + 1] - T[i]); return (this.F[i] + (this.F[i + 1] - this.F[i]) * u) / this.total;
  }
}

// ------------------------------------------------------------------ the ledger (pure: node and the browser)
export class SiphonLedger {
  constructor({ yK = 0.6, seed = 1867, lift = 0.35, sag = 0.12, curl = 0.08, reach = 1500 } = {}) {
    this.opt = { yK, seed, lift, sag, curl, reach };
    this.src = []; this.sinks = new Map(); this.flows = []; this.trainT = []; this.built = false;
  }
  sink(name, def = {}) { if (this.built) throw new Error('siphon: sink() after build()'); this.sinks.set(name, { name, def, i: this.sinks.size, sy: 1, oy: 0 }); return this; }
  source({ p, w = 1, group, col = null, key = null }) {
    if (this.built) throw new Error('siphon: source() after build()');
    this.src.push({ p: V(p), w: +w, group, col, key }); return this.src.length - 1;
  }
  flow(o) { if (this.built) throw new Error('siphon: flow() after build()'); this.flows.push({ ...o }); return this; }
  train(times) { this.trainT = [...times].map(Number).sort((a, b) => a - b); return this; }
  sinkCentre(name) {
    const S = this.sinks.get(name); if (!S) throw new Error(`siphon: no sink '${name}'`); const d = S.def;
    if (d.c) return V(d.c); if (d.face) return V(d.face.p); if (d.box) return V(d.box.c); if (d.p) return V(d.p);
    if (d.glyph && d.glyph.length) { const c = [0, 0, 0]; for (const q of d.glyph) { const v = V(q); c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; } return mul(c, 1 / d.glyph.length); }
    return [0, 0, 0];
  }
  build() {
    if (this.built) return this; this.built = true;
    const { yK, seed } = this.opt, R = mulberry(seed);
    const byGroup = new Map(); this.src.forEach((s, i) => { if (!byGroup.has(s.group)) byGroup.set(s.group, []); byGroup.get(s.group).push(i); });
    this.groups = byGroup;
    this.flows.forEach((f, fi) => {
      if (!this.sinks.has(f.sink)) throw new Error(`siphon: flow ${fi} names no sink '${f.sink}'`);
      f.idx = fi; f.dir = f.dir < 0 ? -1 : 1; f.P = new Progress(f); f.spread = clamp(f.spread ?? 0.35, 0.02, 1); f.travel = Math.max(1e-3, f.travel ?? 1);
      f.members = byGroup.get(f.group) || [];
      if (!f.members.length) throw new Error(`siphon: flow ${fi} drains an empty group '${f.group}'`);
      const c = this.sinkCentre(f.sink), keyOf = typeof f.key === 'function' ? f.key : (s => s.key ?? Math.hypot(s.p[0] - c[0], s.p[2] - c[2]) - (f.yK ?? yK) * s.p[1]);
      const keys = f.members.map(i => keyOf(this.src[i]));
      const [lo, hi] = f.range || [Math.min(...keys), Math.max(...keys)];
      f.rank = new Map(); f.members.forEach((i, k) => f.rank.set(i, hi > lo ? clamp((keys[k] - lo) / (hi - lo)) : 0));
      f.range = [lo, hi];
      // the light leaves one source over spread x the flow's span (in progress); its nominal duration in seconds, for brightness
      f.dNom = f.spread * (f.P.t1 - f.P.t0);
    });
    // per source: its flows in time order, the amount each moves (the plan's own balance: a drain takes all that is at the source,
    // a return gives back all that source has in that sink), one sink per source (one thread)
    this.per = this.src.map(() => []); this.sinkOf = new Array(this.src.length).fill(null); this.peak = new Map();
    const order = [...this.flows].sort((a, b) => a.P.t0 - b.P.t0 || a.idx - b.idx);
    for (const f of order) for (const i of f.members) {
      if (this.sinkOf[i] && this.sinkOf[i] !== f.sink) throw new Error(`siphon: source ${i} ('${this.src[i].group}') flows to two sinks (${this.sinkOf[i]}, ${f.sink}): one thread per source`);
      this.sinkOf[i] = f.sink; this.per[i].push({ f, m: 0 });
    }
    this.src.forEach((s, i) => { let at = 1, held = 0, pk = 0;
      for (const e of this.per[i]) { if (e.f.dir > 0) { e.m = at; held += at; at = 0; } else { e.m = held; at += held; held = 0; } pk = Math.max(pk, held); }
      if (this.sinkOf[i]) this.peak.set(this.sinkOf[i], (this.peak.get(this.sinkOf[i]) || 0) + pk * s.w); });
    this.W = this.src.reduce((a, s) => a + s.w, 0);
    this.tauMax = Math.max(0, ...this.flows.map(f => f.travel));
    this._threads(R);
    return this;
  }
  // each source's sink point and its thread (a cubic): glyph points go out in rank order (the top of the type to the first sources)
  _threads(R) {
    const { lift, sag, curl } = this.opt, up = [0, 1, 0];
    this.th = this.src.map(() => null);
    const glyphNext = new Map();
    for (const [name, S] of this.sinks) {
      if (!S.def.glyph) continue;
      const pts = S.def.glyph.map(V).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      if (!pts.length) throw new Error(`siphon: glyph sink '${name}' has no points`);
      // sources into this sink, in the order of their first flow's rank
      const users = [];
      this.src.forEach((s, i) => { if (this.sinkOf[i] === name) users.push([i, this.per[i][0].f.rank.get(i) + 1e-9 * i]); });
      users.sort((a, b) => a[1] - b[1]);
      const map = new Map(); users.forEach(([i], k) => map.set(i, pts[Math.min(pts.length - 1, Math.floor((k + 0.5) / users.length * pts.length))]));
      glyphNext.set(name, map);
    }
    this.src.forEach((s, i) => {
      const name = this.sinkOf[i]; if (!name) return;
      const S = this.sinks.get(name), d = S.def, p0 = s.p; let p1, n1;
      if (d.glyph) { p1 = glyphNext.get(name).get(i); n1 = nrm(V(d.n || [0, 0, 1])); }
      else if (d.face) { const F = d.face, n = nrm(V(F.n)), ref = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : up, rt = nrm(cross(ref, n)), vu = cross(n, rt);
        p1 = add(add(V(F.p), mul(rt, (R() - 0.5) * F.w)), mul(vu, (R() - 0.5) * F.h)); n1 = n; }
      else if (d.box) { const c = V(d.box.c), h = V(d.box.half), dir = nrm(sub(p0, c));
        // the face turned to the source (weighted by how squarely it faces it), a point on it
        const faces = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(n => [n, Math.max(0, dot(n, [dir[0], 0, dir[2]])) ** 2 * (n[0] ? h[2] : h[0])]);
        let tot = faces.reduce((a, f) => a + f[1], 0), q = R() * tot, n = faces[0][0]; for (const f of faces) { if ((q -= f[1]) <= 0) { n = f[0]; break; } }
        const ax = n[0] ? 2 : 0; p1 = [c[0] + n[0] * h[0], c[1] + (R() - 0.5) * 2 * h[1], c[2] + n[2] * h[2]]; p1[ax] = c[ax] + (R() - 0.5) * 2 * h[ax] * 0.96; n1 = n; }
      else { const c = V(d.p || d.c || [0, 0, 0]), r = d.r ?? 1; let v = nrm([R() - 0.5, R() - 0.5, R() - 0.5]); if (dot(v, sub(p0, c)) < 0) v = mul(v, -1); p1 = add(c, mul(v, r)); n1 = v; }
      // the arc: lifted off the source, coming in along the sink's normal, sagging a little under the line but never below the sink's
      // own height by more than a quarter of it (a thread does not dive under the ground); lift and approach saturate at `reach` metres
      const L = len(sub(p1, p0)), Lr = Math.min(L, this.opt.reach), h1 = R(), h2 = R(), h3 = R();
      const side = nrm(cross(sub(p1, p0), up)), wob = (h1 - 0.5) * 2 * curl * Lr;
      const c0 = add(add(p0, mul(up, lift * Lr * (0.75 + 0.5 * h2))), mul(side, wob));
      const c1 = add(add(add(p1, mul(n1, 0.3 * Lr)), mul(up, -Math.min(sag * Lr * (0.6 + 0.8 * h3), 0.25 * Math.max(0, p1[1])))), mul(side, -0.6 * wob));
      this.th[i] = { p0, c0, c1, p1, n1, L, seed: h1, sink: S.i };
    });
  }
  // ---------------------------------------------------------------- reads (pure in t)
  out(e, i, t) { const f = e.f, r = f.rank.get(i), dl = f.spread; return sst((f.P.at(t) - r * (1 - dl)) / dl); }
  // one source at t: { s, f, h } fractions of its weight (at the source, in flight, in its sink) ; s + f + h = 1 exactly
  state(i, t) {
    let s = 1, fl = 0, h = 0;
    for (const e of this.per[i]) { if (t < e.f.P.t0 || e.m === 0) continue;
      const o = this.out(e, i, t), a = this.out(e, i, t - e.f.travel);
      if (e.f.dir > 0) { s -= e.m * o; fl += e.m * (o - a); h += e.m * a; } else { h -= e.m * o; fl += e.m * (o - a); s += e.m * a; } }
    return { s, f: fl, h };
  }
  left(i, t) { return this.state(i, t).s; }
  held(name, t) { let h = 0; this.src.forEach((s, i) => { if (this.sinkOf[i] === name) h += s.w * this.state(i, t).h; }); return h; }
  cap(name) { return this.peak.get(name) || 0; }
  wipe(name, t) {
    let a = 0, d = 0; const c = this.cap(name) || 1;
    this.src.forEach((s, i) => { if (this.sinkOf[i] !== name) return;
      for (const e of this.per[i]) { if (t < e.f.P.t0 || e.m === 0) continue; if (e.f.dir > 0) a += s.w * e.m * this.out(e, i, t - e.f.travel); else d += s.w * e.m * this.out(e, i, t); } });
    return { a: a / c, d: d / c };
  }
  ledger(t) {
    let atSources = 0, inFlight = 0; const held = {};
    for (const n of this.sinks.keys()) held[n] = 0;
    this.src.forEach((s, i) => { const q = this.state(i, t); atSources += s.w * q.s; inFlight += s.w * q.f; if (this.sinkOf[i]) held[this.sinkOf[i]] += s.w * q.h; });
    const H = Object.values(held).reduce((a, b) => a + b, 0);
    return { atSources, inFlight, held, total: atSources + inFlight + H };
  }
  front(group, t) {
    const fs = this.flows.filter(f => f.group === group), d = fs.find(f => f.dir > 0), r = fs.find(f => f.dir < 0);
    return { drain: d ? d.P.at(t) : 0, dSpread: d ? d.spread : 0.35, ret: r ? r.P.at(t - r.travel) : 0, rSpread: r ? r.spread : 0.35,
      range: (d || r) ? (d || r).range : [0, 1] };
  }
  arrivals(t0, t1) {
    const out = [];
    for (const T of this.trainT) {
      if (T > t1 || T < t0 - this.tauMax - 1e-9) continue;
      this.src.forEach((s, i) => { for (const e of this.per[i]) { const f = e.f, ta = T + f.travel; if (ta < t0 || ta > t1 || e.m === 0) continue;
        const r = f.rank.get(i), x = (f.P.at(T) - r * (1 - f.spread)) / f.spread;
        if (x > 0 && x < 1 && f.P.rate(T) > 0) out.push({ t: +ta.toFixed(4), i, sink: f.sink, dir: f.dir }); } });
    }
    return out.sort((a, b) => a.t - b.t || a.i - b.i);
  }
  share(f, name) {
    const c = this.sinkCentre(name), ids = []; this.src.forEach((s, i) => { if (this.sinkOf[i] === name) ids.push(i); });
    ids.sort((a, b) => len(sub(this.src[a].p, c)) - len(sub(this.src[b].p, c)) || a - b);
    const tot = ids.reduce((a, i) => a + this.src[i].w, 0), out = []; let acc = 0;
    for (const i of ids) { if (acc >= f * tot - 1e-12) break; out.push(i); acc += this.src[i].w; }
    return out;
  }
  // the light in flight along source i's thread at t: 9 samples of the cumulative departure, u = 0 .. 1 (0 at the source), and
  // the thread's travel; bins between samples hold the light on that eighth of the thread (exact, in the ledger's own terms)
  samples(i, t, out = new Float32Array(9)) {
    out.fill(0); let tau = 1, dir = 1, m = 0, dn = 1;
    for (const e of this.per[i]) { const f = e.f; if (e.m === 0 || t < f.P.t0 || t > f.P.t1 + f.travel + 1e-6) continue;
      for (let s = 0; s < 9; s++) { const u = s / 8; out[s] += e.m * (f.dir > 0 ? this.out(e, i, t - u * f.travel) : this.out(e, i, t - (1 - u) * f.travel)); }
      tau = f.travel; dir = f.dir; m = e.m; dn = f.dNom; }
    return { O: out, tau, dir, m, dn };
  }
}

// ------------------------------------------------------------------ the threads (three.js)
const VS = /* glsl */`
attribute float aThread, aSeg;
uniform sampler2D tStatic, tDyn; uniform vec2 uTex; uniform float uSeg, uWidth, uMinPx, uMaxPx, uScale, uPkSig, uPkGain; uniform vec2 uRes;
uniform float uPk[8]; uniform vec2 uSinkY[16];
varying float vU, vSide, vB, vDim; varying vec3 vWP;
vec4 tx(sampler2D T, float k){ return texture2D(T, (vec2(mod(k, uTex.x), floor(k / uTex.x)) + .5) / uTex); }
void main(){
  float base = aThread * 4.;
  vec4 D2 = tx(tDyn, base + 2.);
  if (D2.z <= 0.) { gl_Position = vec4(2., 2., 2., 1.); return; }
  vec4 S0 = tx(tStatic, base), S1 = tx(tStatic, base + 1.), S2 = tx(tStatic, base + 2.), S3 = tx(tStatic, base + 3.);
  vec4 D0 = tx(tDyn, base), D1 = tx(tDyn, base + 1.);
  vec2 sy = uSinkY[int(S1.w + .5)];
  vec3 a = S0.xyz, b = S1.xyz, c = S2.xyz, d = S3.xyz; c.y = c.y * sy.x + sy.y; d.y = d.y * sy.x + sy.y;
  float u = (aSeg + position.x) / uSeg, v = 1. - u;
  vec3 wp = v*v*v*a + 3.*v*v*u*b + 3.*v*u*u*c + u*u*u*d;
  vec3 tg = 3.*v*v*(b - a) + 6.*v*u*(c - b) + 3.*u*u*(d - c);
  // the light on this part of the thread: the bins between the 9 samples, interpolated at u
  float O[9]; O[0] = D0.x; O[1] = D0.y; O[2] = D0.z; O[3] = D0.w; O[4] = D1.x; O[5] = D1.y; O[6] = D1.z; O[7] = D1.w; O[8] = D2.x;
  float f = clamp(u * 8. - .5, 0., 7.); int i0 = int(floor(f)); int i1 = min(i0 + 1, 7); float fr = f - float(i0);
  float rho = mix(abs(O[i0] - O[i0 + 1]), abs(O[i1] - O[i1 + 1]), fr) * 8.;
  float tau = max(1e-3, D2.w), dir = D2.y, bump = 0.;
  for (int j = 0; j < 8; j++) { float age = uPk[j]; if (age < 0. || age > tau) continue; float q = age / tau; float pos = dir > 0. ? q : 1. - q;
    float e = (u - pos) / uPkSig; bump += exp(-e * e); }
  vB = D2.z * rho * (1. - uPkGain + uPkGain * 2.2 * min(bump, 1.2));
  vU = u; vSide = position.y; vWP = wp;
  vec4 cp = projectionMatrix * viewMatrix * vec4(wp, 1.);
  vec4 cq = projectionMatrix * viewMatrix * vec4(wp + normalize(tg + vec3(1e-6)) * .5, 1.);
  float wpx = uWidth * uScale / max(.05, cp.w), px = min(max(uMinPx, wpx), uMaxPx);
  vDim = clamp(wpx / px, .3, 1.) * clamp(uMaxPx / max(wpx, 1e-3), .12, 1.);      // a thread passing the lens: capped and faded (maxPx; default no cap)
  if (cp.w > .05 && cq.w > .05) {
    vec2 dd = (cq.xy / cq.w - cp.xy / cp.w) * uRes; float L = length(dd);
    vec2 n = L > 1e-6 ? vec2(-dd.y, dd.x) / L : vec2(0., 1.);
    cp.xy += n * position.y * px / uRes * cp.w;
  }
  gl_Position = cp;
}`;
const FS = (atmos) => (atmos ? ATMOS_GLSL : '') + /* glsl */`
uniform vec3 uWarm, uCold; uniform float uGain; uniform vec2 uRes;
${atmos ? 'uniform sampler2D tDepth; uniform float uOcc;' : ''}
varying float vU, vSide, vB, vDim; varying vec3 vWP;
void main(){
  float b = vB * vDim * exp(-2.2 * vSide * vSide) * smoothstep(0., .02, vU) * (1. - smoothstep(.985, 1., vU));
  ${atmos ? `if (uOcc > .5 && texture2D(tDepth, gl_FragCoord.xy / uRes).r < gl_FragCoord.z - 2e-6) discard;
  { vec3 dd = vWP - uCamPos; float s = length(dd); b *= mix(fogTr(dd / max(s, 1e-3), s), 1., .15); }` : ''}
  if (b < .002) discard;
  vec3 col = mix(uWarm, uCold, smoothstep(.08, .82, vU));
  gl_FragColor = vec4(col * b * uGain, 1.);
}`;

export class Siphon extends SiphonLedger {
  constructor(scene, { max = 2400, seg = 24, width = 0.6, minPx = 1.3, maxPx = 1e6, warm = '#ffc27a', cold = '#d8ecff', lift = 0.35, sag = 0.12, curl = 0.08, seed = 1867,
    yK = 0.6, gain = 1, pkGain = 0.45, pkSig = 0.06, atmos = null, reach = 1500 } = {}) {
    super({ yK, seed, lift, sag, curl, reach });
    Object.assign(this.opt, { max, seg, width, minPx, maxPx, warm, cold, gain, pkGain, pkSig });
    this.scene = scene; this.atmos = atmos; this.mesh = null; this._smp = new Float32Array(9);
  }
  build() {
    if (this.built) return this; super.build();
    const n = this.src.length, o = this.opt;
    if (n > o.max) throw new Error(`siphon: ${n} sources > max ${o.max}`);
    if (this.sinks.size > 16) throw new Error('siphon: at most 16 sinks');
    const TW = 1024, TH = Math.max(1, Math.ceil(n * 4 / TW));
    const st = new Float32Array(TW * TH * 4); this.dyn = new Float32Array(TW * TH * 4);
    this.src.forEach((s, i) => { const T = this.th[i]; if (!T) return; const k = i * 16;
      st.set([...T.p0, T.seed, ...T.c0, T.sink, ...T.c1, s.w, ...T.p1, this.per[i][0]?.f.travel ?? 1], k); });
    const mk = (a) => { const tx = new THREE.DataTexture(a, TW, TH, THREE.RGBAFormat, THREE.FloatType); tx.minFilter = tx.magFilter = THREE.NearestFilter; tx.needsUpdate = true; return tx; };
    this.tStatic = mk(st); this.tDyn = mk(this.dyn);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3)); g.setIndex([0, 1, 2, 2, 1, 3]);
    const N = n * o.seg, aT = new Float32Array(N), aS = new Float32Array(N);
    for (let i = 0; i < n; i++) for (let j = 0; j < o.seg; j++) { aT[i * o.seg + j] = i; aS[i * o.seg + j] = j; }
    g.setAttribute('aThread', new THREE.InstancedBufferAttribute(aT, 1)); g.setAttribute('aSeg', new THREE.InstancedBufferAttribute(aS, 1)); g.instanceCount = N;
    const A = this.atmos, lin = c => new THREE.Color(c);
    this.U = { tStatic: { value: this.tStatic }, tDyn: { value: this.tDyn }, uTex: { value: new THREE.Vector2(TW, TH) }, uSeg: { value: o.seg }, uWidth: { value: o.width },
      uMinPx: { value: o.minPx }, uMaxPx: { value: o.maxPx }, uScale: { value: 1000 }, uPkSig: { value: o.pkSig }, uPkGain: { value: o.pkGain }, uRes: { value: new THREE.Vector2(1080, 1920) },
      uPk: { value: new Array(8).fill(-1) }, uSinkY: { value: Array.from({ length: 16 }, () => new THREE.Vector2(1, 0)) },
      uWarm: { value: lin(o.warm) }, uCold: { value: lin(o.cold) }, uGain: { value: o.gain } };
    if (A) { Object.assign(this.U, A.U, { tDepth: A.frameU.tDepth, uOcc: A.frameU.uOcc }); this.U.uRes = A.frameU.uRes; }
    this.material = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS(!!A), uniforms: this.U, transparent: true, depthWrite: false, depthTest: !A,
      blending: THREE.AdditiveBlending });
    this.mesh = new THREE.Mesh(g, this.material); this.mesh.frustumCulled = false; this.mesh.renderOrder = 9;
    if (this.scene) this.scene.add(this.mesh);
    for (const S of this.sinks.values()) this.U.uSinkY.value[S.i].set(S.sy, S.oy);
    return this;
  }
  moveSink(name, { sy = 1, oy = 0 } = {}) { const S = this.sinks.get(name); if (!S) throw new Error(`siphon: no sink '${name}'`); S.sy = sy; S.oy = oy; if (this.U) this.U.uSinkY.value[S.i].set(sy, oy); return this; }
  set gain(v) { this.opt.gain = v; if (this.U) this.U.uGain.value = v; }
  set visible(v) { if (this.mesh) this.mesh.visible = v; }
  // once a frame: the light in flight on every thread (9 samples each), the packets, the camera's pixel scale. O(sources).
  update(t, camera, viewH = 1920) {
    this.build(); const D = this.dyn, o = this.opt;
    for (let i = 0; i < this.src.length; i++) {
      const k = i * 16, q = this.samples(i, t, this._smp), O = q.O;
      let live = 0; for (let s = 0; s < 8; s++) live = Math.max(live, Math.abs(O[s] - O[s + 1]));
      for (let s = 0; s < 9; s++) D[k + s] = O[s];
      D[k + 9] = q.dir; D[k + 10] = live > 1e-5 ? q.dn / q.tau : 0; D[k + 11] = q.tau;
    }
    this.tDyn.needsUpdate = true;
    const pk = this.U.uPk.value; pk.fill(-1); let j = 0;
    for (let k = this.trainT.length - 1; k >= 0 && j < 8; k--) { const age = t - this.trainT[k]; if (age < 0) continue; if (age > this.tauMax + 0.05) break; pk[j++] = age; }
    if (camera) this.U.uScale.value = viewH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    if (!this.atmos) this.U.uRes.value.set(viewH * (camera ? camera.aspect : 0.5625), viewH);
    return this;
  }
  // LightField practicals that follow left(): map { group: [record indices] }; each group's mean left, quantised to `buckets`
  // steps, is written with americana_c2's lfSwitch only when its step changes (the lightmap redraws at most `buckets` x a flow).
  // The output is a pure function of t (the step), the cache only saves redraws. Returns the number of lfSwitch calls made.
  toLightField(lf, map, { buckets = 8, floor = 0, lfSwitch = null } = {}) {
    const sw = lfSwitch || this._lfSwitch; if (!sw) throw new Error('siphon: toLightField needs { lfSwitch } (lib/fx/americana_c2.js)');
    this._lfSwitch = sw; const ids = new Map();
    for (const g of Object.keys(map)) ids.set(g, this.src.map((s, i) => s.group === g ? i : -1).filter(i => i >= 0));
    const last = new Map(); let calls = 0;
    this._lfApply = (t) => { let n = 0;
      for (const [g, recs] of Object.entries(map)) { const S = ids.get(g); if (!S.length) continue;
        const k = S.reduce((a, i) => a + this.left(i, t), 0) / S.length, step = Math.round(clamp(k) * buckets);
        if (last.get(g) === step) continue; last.set(g, step); sw(lf, recs, floor + (1 - floor) * step / buckets); n++; calls++; }
      return n; };
    this._lfCalls = () => calls;
    return this;
  }
  lights(t) { return this._lfApply ? this._lfApply(t) : 0; }
  // points inside type, for a glyph sink: src a Path2D (filled with the canvas's isPointInPath) or a canvas / ImageData whose red
  // channel is the type's mask; rect [x, y, w, h] in that 2D space; n points, seeded (rejection sampling, a fixed number of tries)
  static glyphPoints(src, rect, n = 400, seed = 1) {
    const R = mulberry(seed), [x0, y0, w, h] = rect, out = [];
    let test;
    if (typeof Path2D !== 'undefined' && src instanceof Path2D) { const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : document.createElement('canvas'), g = cv.getContext('2d'); test = (x, y) => g.isPointInPath(src, x, y); }
    else { const id = src.data ? src : src.getContext('2d').getImageData(0, 0, src.width, src.height), W = id.width, H = id.height;
      test = (x, y) => { const i = Math.floor(x), j = Math.floor(y); return i >= 0 && j >= 0 && i < W && j < H && id.data[(j * W + i) * 4] > 127; }; }
    for (let k = 0; k < n * 200 && out.length < n; k++) { const x = x0 + R() * w, y = y0 + R() * h; if (test(x, y)) out.push([x, y]); }
    return out;
  }
  // an americana_city facadeMaterial's windows drained by the siphon: per ring (r0..r1 m from c, xz) the window's warmth goes to
  // `cold` as its rank (dist - yK*y over the ring's range [r0 - yK*yMax, r1]) is passed by the group's drain front, and comes back
  // as its return's front arrives. `keep` is how much of the window's luminance a drained window keeps (lit floors stay lit).
  static facadeDrain(mat, sy, { c = [0, 0], rings = [], yK = 0.6, cold = '#33404c', keep = 0.55 } = {}) {
    if (rings.length > 8) throw new Error('siphon.facadeDrain: at most 8 rings');
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
    const cc = new THREE.Color(cold), L = 0.2126 * cc.r + 0.7152 * cc.g + 0.0722 * cc.b;
    const U = { uDrC: { value: new THREE.Vector2(c[0], c[1]) }, uDrK: { value: yK }, uDrN: { value: rings.length }, uDrCold: { value: new THREE.Vector3(cc.r / L, cc.g / L, cc.b / L) },
      uDrKeep: { value: keep }, uDrR: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -1, 0, 1)) }, uDrP: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0.35, 0.35)) } };
    rings.forEach((g, k) => U.uDrR.value[k].set(g.r0, g.r1, g.r0 - yK * (g.yMax ?? 200), g.r1));
    const info = { patched: false, rings };
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(mat, sh, r);
      const A = 'winEm *= uWG;';
      if (!sh.fragmentShader.includes(A)) throw new Error("siphon.facadeDrain: 'winEm *= uWG;' not found in the facade shader (americana_city facadeMaterial changed)");
      Object.assign(sh.uniforms, U);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform vec2 uDrC; uniform float uDrK, uDrKeep; uniform int uDrN; uniform vec3 uDrCold; uniform vec4 uDrR[8], uDrP[8];`)
        .replace(A, `${A}
        { float dd = distance(vWP.xz, uDrC), warm = 1.;
          for (int k = 0; k < 8; k++) { if (k >= uDrN) break; vec4 R = uDrR[k], P = uDrP[k];
            if (dd < R.x || dd >= R.y) continue;
            float rk = clamp((dd - uDrK * vWP.y - R.z) / max(1e-3, R.w - R.z), 0., 1.);
            float o = smoothstep(0., 1., clamp((P.x - rk * (1. - P.z)) / P.z, 0., 1.)), b = smoothstep(0., 1., clamp((P.y - rk * (1. - P.w)) / P.w, 0., 1.));
            warm = clamp(1. - o + b, 0., 1.); }
          float e = dot(winEm, vec3(.2126, .7152, .0722));
          winEm = mix(uDrCold * e * uDrKeep, winEm, warm); }`);
      info.patched = true;
    };
    mat.customProgramCacheKey = () => prevKey() + '|siphon' + rings.length;
    mat.needsUpdate = true;
    const update = (t) => { rings.forEach((g, k) => { const F = sy.front(g.group, t); U.uDrP.value[k].set(F.drain, F.ret, F.dSpread, F.rSpread); }); };
    return { U, info, update };
  }
}

// ------------------------------------------------------------------ the same threads in 2D (maps, print)
export class Siphon2D {
  constructor(sy, project, { width = 2, warm = null, cold = null, steps = 16 } = {}) { this.sy = sy.build(); this.project = project; this.o = { width, steps, warm: warm || sy.opt?.warm || '#ffc27a', cold: cold || sy.opt?.cold || '#d8ecff' }; }
  draw(ctx, t, { alpha = 1 } = {}) {
    const sy = this.sy, o = this.o, cw = new THREE.Color(o.warm), cc = new THREE.Color(o.cold), c = new THREE.Color(), smp = new Float32Array(9);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    sy.src.forEach((s, i) => { const T = sy.th[i]; if (!T) return; const q = sy.samples(i, t, smp); const S = sy.sinks.get(sy.sinkOf[i]);
      let prev = null;
      for (let k = 0; k <= o.steps; k++) { const u = k / o.steps, v = 1 - u, p1y = T.p1[1] * S.sy + S.oy, c1y = T.c1[1] * S.sy + S.oy;
        const P = [0, 1, 2].map(a => { const A0 = T.p0[a], B = T.c0[a], C = a === 1 ? c1y : T.c1[a], D = a === 1 ? p1y : T.p1[a]; return v * v * v * A0 + 3 * v * v * u * B + 3 * v * u * u * C + u * u * u * D; });
        const xy = this.project(P);
        if (prev && xy) { const f = clamp(u * 8 - 0.5, 0, 7), i0 = Math.floor(f), b = Math.abs(q.O[i0] - q.O[i0 + 1]) * 8 * (q.dn / q.tau);
          if (b > 0.002) { c.copy(cw).lerp(cc, sst((u - 0.08) / 0.74)); ctx.strokeStyle = `rgba(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0},${clamp(b * alpha)})`; ctx.lineWidth = o.width;
            ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(xy[0], xy[1]); ctx.stroke(); } }
        prev = xy; } });
    ctx.restore();
  }
}
