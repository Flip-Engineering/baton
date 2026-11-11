// CROWDFLOW (sim2): crowds that flow like crowds, baked once, played back as a pure function of t, drawn with people.js.
//
//   import { CrowdFlow } from '../lib/fx/sim2/crowdflow.js';
//   const cf = new CrowdFlow({ n: 500, bounds: [-40, -60, 40, 20], goal: [[0, -55]], spawn: r => [..], obstacles: [...],
//                              t0: 0, t1: 8, seed: 3 });                       // bake: ~0.2-1.5 s for 500 agents x 8 s
//   cf.attach(folk, { trades: ['steel', 'farm', ...], acts: { fist: 0.25, march: 0.1 }, runner: 0 });   // adds people
//   cf.drive(folk, t);  folk.update(camera);                                   // every frame
//   cf.at(t, i) -> { x, z, heading, speed, ph, dens }                         // for props, flags, lights
//
// Model (Helbing-style social force + a navigation field, the standard pairing in crowd simulation):
//   1. Navigation: a grid over `bounds` (cell 0.5 m); obstacles rasterised; a Dijkstra distance-to-goal field (8-way,
//      exact diagonal costs), so -grad(phi) routes every agent around obstacles and through gates.
//   2. Agents: desired velocity = v(rho) * -grad(phi) + small personal wander; v(rho) is Weidmann's fundamental diagram
//      (free speed 1.1-1.6 m/s, jams to zero at 5.4 p/m^2) with local density rho from a spatial hash (r = 1.2 m).
//      Separation: exponential repulsion between agents (A e^((r_ij - d)/B)) plus body contact, wall repulsion from the
//      field; relaxation time tau = 0.5 s. Integrated at 20 Hz with 2 substeps, recorded at 30 fps.
//   3. Gait: heading follows the velocity with a turn-rate limit; stride phase integrates DISTANCE walked (4.15 rad/m for
//      a 1.78 m person, scaled by height), so feet never skate and a slowed crowd shuffles.
//   Events: { t, kind: 'surge' | 'halt' | 'goal', ... } change speed or goals at a time (declared up front).
import * as THREE from 'three';

function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export class CrowdFlow {
  constructor(o) {
    const { n = 400, bounds = [-30, -30, 30, 30], cell = 0.5, goal = [[0, 0]], spawn, obstacles = [], t0 = 0, t1 = 8, fps = 30, seed = 1,
      speed = [1.1, 1.6], radius = [0.23, 0.3], events = [], preroll = 3, A = 2.1, Bs = 0.3, tau = 0.5, wander = 0.15 } = o;
    Object.assign(this, { n, bounds, cell, t0, t1, fps, seed });
    const r = mulberry(seed * 7717 + 1);
    // ---------------------------------------------------------------- navigation field
    const W = Math.ceil((bounds[2] - bounds[0]) / cell), H = Math.ceil((bounds[3] - bounds[1]) / cell);
    const blocked = new Uint8Array(W * H), toG = (x, z) => [Math.floor((x - bounds[0]) / cell), Math.floor((z - bounds[1]) / cell)];
    const inObs = (x, z) => obstacles.some(ob => ob.r ? Math.hypot(x - ob.x, z - ob.z) < ob.r : (x > ob.x0 && x < ob.x1 && z > ob.z0 && z < ob.z1));
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) blocked[j * W + i] = inObs(bounds[0] + (i + 0.5) * cell, bounds[1] + (j + 0.5) * cell) ? 1 : 0;
    this.W = W; this.H = H; this.blocked = blocked; this.inObs = inObs;
    const field = gl => {
      const D = new Float64Array(W * H).fill(1e9), heap = new MinHeap();
      for (const g of gl) { const [i, j] = toG(g[0], g[1]); if (i >= 0 && j >= 0 && i < W && j < H) { D[j * W + i] = 0; heap.push(0, j * W + i); } }
      const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
      while (heap.size) { const [d, q] = heap.pop(); if (d > D[q]) continue; const i = q % W, j = (q / W) | 0;
        for (const [a, b, c] of NB) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue; const k = jj * W + ii; if (blocked[k]) continue;
          if (a && b && (blocked[j * W + ii] || blocked[jj * W + i])) continue; const nd = d + c * cell; if (nd < D[k]) { D[k] = nd; heap.push(nd, k); } } }
      return D;
    };
    this.fields = [field(goal)];
    const evs = events.slice().sort((a, b) => a.t - b.t); for (const e of evs) if (e.kind === 'goal') e._f = this.fields.push(field(e.goal)) - 1;
    const sampleGrad = (F, x, z, out) => {
      const fx = (x - bounds[0]) / cell - 0.5, fz = (z - bounds[1]) / cell - 0.5, i = clamp(Math.floor(fx), 0, W - 2), j = clamp(Math.floor(fz), 0, H - 2);
      const g = (a, b) => { const v = F[b * W + a]; return v > 1e8 ? null : v; };
      const v00 = g(i, j), v10 = g(i + 1, j), v01 = g(i, j + 1), v11 = g(i + 1, j + 1);
      const c = v00 ?? v10 ?? v01 ?? v11 ?? 0, V = [v00 ?? c + 2, v10 ?? c + 2, v01 ?? c + 2, v11 ?? c + 2];
      const u = clamp(fx - i, 0, 1), w = clamp(fz - j, 0, 1);
      out[0] = -((V[1] - V[0]) * (1 - w) + (V[3] - V[2]) * w); out[1] = -((V[2] - V[0]) * (1 - u) + (V[3] - V[1]) * u);
      const l = Math.hypot(out[0], out[1]) || 1; out[0] /= l; out[1] /= l; out[2] = (V[0] + V[1] + V[2] + V[3]) / 4; return out;
    };
    // ---------------------------------------------------------------- agents
    const X = new Float32Array(n), Z = new Float32Array(n), VX = new Float32Array(n), VZ = new Float32Array(n), V0 = new Float32Array(n), R = new Float32Array(n), HD = new Float32Array(n), PH = new Float32Array(n), WP = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let p; for (let k = 0; k < 40; k++) { p = spawn ? spawn(r, i) : [bounds[0] + r() * (bounds[2] - bounds[0]), bounds[1] + r() * (bounds[3] - bounds[1])]; if (!inObs(p[0], p[1])) break; }
      X[i] = p[0]; Z[i] = p[1]; V0[i] = speed[0] + (speed[1] - speed[0]) * (0.5 + 0.5 * (r() + r() - 1)); R[i] = radius[0] + (radius[1] - radius[0]) * r(); PH[i] = r() * 6.28; WP[i] = r() * 100;
      const gg = sampleGrad(this.fields[0], X[i], Z[i], [0, 0, 0]); HD[i] = Math.atan2(gg[0], gg[1]);
    }
    this.R = R; this.V0 = V0;
    const dt = 1 / 20, sub = 2, h = dt / sub, cs = 1.2, hash = new Map();
    const nF = Math.ceil((t1 - t0) * fps) + 2; this.nF = nF;
    const rec = this.rec = new Float32Array(nF * n * 5);    // x, z, heading, speed, phase (ph in radians)
    const dens = this.dens = new Float32Array(nF * n);
    let t = t0 - preroll, fIdx = 0, fieldIdx = 0, speedK = 1, g3 = [0, 0, 0];
    const rho = new Float32Array(n), stepsTotal = Math.ceil((t1 + 2 / fps - t) / dt);
    const record = (tt) => { while (fIdx < nF && t0 + fIdx / fps <= tt + 1e-9) { const o = fIdx * n * 5; for (let i = 0; i < n; i++) { rec[o + i * 5] = X[i]; rec[o + i * 5 + 1] = Z[i]; rec[o + i * 5 + 2] = HD[i]; rec[o + i * 5 + 3] = Math.hypot(VX[i], VZ[i]); rec[o + i * 5 + 4] = PH[i]; dens[fIdx * n + i] = rho[i]; } fIdx++; } };
    for (let st = 0; st < stepsTotal; st++) {
      for (const e of evs) if (e.t <= t && !e._done) { e._done = true; if (e.kind === 'goal') fieldIdx = e._f; if (e.kind === 'surge') speedK = e.k ?? 1.6; if (e.kind === 'halt') speedK = e.k ?? 0; }
      for (let s = 0; s < sub; s++) {
        hash.clear();
        for (let i = 0; i < n; i++) { const k = ((Math.floor(X[i] / cs) * 73856093) ^ (Math.floor(Z[i] / cs) * 19349663)) | 0; let b = hash.get(k); if (!b) hash.set(k, b = []); b.push(i); }
        for (let i = 0; i < n; i++) {
          // neighbours
          let fx = 0, fz = 0, cnt = 0; const ci = Math.floor(X[i] / cs), cj = Math.floor(Z[i] / cs);
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const lst = hash.get((((ci + a) * 73856093) ^ ((cj + b) * 19349663)) | 0); if (!lst) continue;
            for (const j of lst) { if (j === i) continue; const dx = X[i] - X[j], dz = Z[i] - Z[j], d = Math.hypot(dx, dz) || 1e-4; if (d > 2.4) continue; if (d < 1.2) cnt++;
              const rij = R[i] + R[j], nx = dx / d, nz = dz / d;
              // anisotropy: people react more to those in front
              const ahead = 0.4 + 0.6 * clamp(0.5 - 0.5 * (nx * Math.sin(HD[i]) + nz * Math.cos(HD[i])), 0, 1);
              let f = A * Math.exp((rij - d) / Bs) * ahead; if (d < rij) f += 60 * (rij - d);
              fx += f * nx; fz += f * nz; } }
          rho[i] = cnt / (Math.PI * 1.44);
          const F = this.fields[fieldIdx]; sampleGrad(F, X[i], Z[i], g3);
          const dist = g3[2];
          const vr = V0[i] * speedK * Math.max(0, 1 - Math.exp(-1.913 * (1 / Math.max(rho[i], 0.2) - 1 / 5.4))) * clamp(dist / 2.5, 0, 1);
          const wa = wander * Math.sin(t * 0.7 + WP[i]), cw = Math.cos(wa), sw = Math.sin(wa);
          const dvx = (g3[0] * cw - g3[1] * sw) * vr, dvz = (g3[0] * sw + g3[1] * cw) * vr;
          // walls: push out of blocked cells
          let wx = 0, wz = 0; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const px = X[i] + a * 0.45, pz = Z[i] + b * 0.45; if (inObs(px, pz)) { wx -= a * 4; wz -= b * 4; } }
          VX[i] += ((dvx - VX[i]) / tau + fx + wx) * h; VZ[i] += ((dvz - VZ[i]) / tau + fz + wz) * h;
          const sp = Math.hypot(VX[i], VZ[i]), vmax = V0[i] * speedK * 1.3 + 0.2; if (sp > vmax) { VX[i] *= vmax / sp; VZ[i] *= vmax / sp; }
        }
        for (let i = 0; i < n; i++) {
          const ox = X[i], oz = Z[i]; X[i] += VX[i] * h; Z[i] += VZ[i] * h;
          if (inObs(X[i], Z[i])) { X[i] = ox; Z[i] = oz; VX[i] *= -0.2; VZ[i] *= -0.2; }
          const sp = Math.hypot(VX[i], VZ[i]);
          if (sp > 0.15) { const target = Math.atan2(VX[i], VZ[i]); let dh = target - HD[i]; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); HD[i] += clamp(dh, -3.5 * h, 3.5 * h) * Math.min(1, sp / 0.5); }
          PH[i] += Math.hypot(X[i] - ox, Z[i] - oz) * 4.15;
        }
      }
      t += dt; record(t);
    }
    this.baked = fIdx;
  }
  // interpolated state of agent i at time t
  at(t, i, out = {}) {
    const f = clamp((t - this.t0) * this.fps, 0, this.baked - 1.001), a = Math.floor(f), u = f - a, n = this.n, A = this.rec, o0 = (a * n + i) * 5, o1 = ((a + 1) * n + i) * 5;
    out.x = A[o0] + (A[o1] - A[o0]) * u; out.z = A[o0 + 1] + (A[o1 + 1] - A[o0 + 1]) * u;
    let dh = A[o1 + 2] - A[o0 + 2]; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); out.heading = A[o0 + 2] + dh * u;
    out.speed = A[o0 + 3] + (A[o1 + 3] - A[o0 + 3]) * u; out.ph = A[o0 + 4] + (A[o1 + 4] - A[o0 + 4]) * u; out.dens = this.dens[a * n + i];
    return out;
  }
  // add n people to a People instance: varied trades, builds, and acts. Returns the people ids (index = agent).
  attach(folk, { People, trades = ['steel', 'farm', 'rail', 'overalls', 'weld'], acts = { fist: 0.2, march: 0.12 }, seed = 3, extra = null } = {}) {
    const r = mulberry(seed * 131 + 7); this.ids = []; this.acts = [];
    for (let i = 0; i < this.n; i++) {
      const tr = trades[Math.floor(r() * trades.length)], d = People.random(tr, seed * 1000 + i, extra ? extra(i, r) : {});
      this.ids.push(folk.add(d)); const u = r(); this.acts.push(u < acts.fist ? 'fist' : u < acts.fist + acts.march ? 'march' : 'walk');
      this._h = this._h || []; this._h.push(d.h);
    }
    return this.ids;
  }
  drive(folk, t, { y = 0, pump = null } = {}) {
    const s = {};
    for (let i = 0; i < this.n; i++) {
      this.at(t, i, s); const hk = 1.78 / (this._h ? this._h[i] : 1.78), act = this.acts ? this.acts[i] : 'walk';
      const amt = clamp(s.speed / 1.3, 0.15, 1.15), moving = s.speed > 0.12;
      const st = { x: s.x, y, z: s.z, heading: s.heading, ph: s.ph * hk, amt, speed: amt, t: t + i * 0.37 };
      if (!moving) { st.act = act === 'walk' ? 'stand' : 'fist'; st.mix = null; }
      else if (act === 'walk') { st.act = 'walk'; st.mix = null; }
      else if (act === 'march') { st.act = 'march'; st.mix = null; st.pump = pump != null ? pump : null; }
      else { st.act = 'march'; st.mix = null; }
      folk.set(this.ids[i], st);
    }
  }
}

class MinHeap {
  constructor() { this.k = []; this.v = []; this.size = 0; }
  push(k, v) { let i = this.size++; while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= k) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p; } this.k[i] = k; this.v[i] = v; }
  pop() {
    const top = [this.k[0], this.v[0]], n = --this.size; if (n === 0) return top;
    const lk = this.k[n], lv = this.v[n]; let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && this.k[c + 1] < this.k[c]) c++; if (this.k[c] >= lk) break; this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c; }
    this.k[i] = lk; this.v[i] = lv; return top;
  }
}
