// MOTION / CROWD (MOTION studio, cycle 1): a crowd that walks, stops, turns and mills with its feet planted.
// Each agent is a goal-seeking point with a preferred speed of its own; steering is time-to-collision avoidance (Karamouzas,
// Skinner and Guy, "Universal power law governing pedestrian interactions", PRL 2014: the interaction energy falls off with the
// time to the next collision, not the distance, so people side-step early and pass close at the last moment), plus a soft
// separation. The agent's wish is handed to a steps.js Walker, which decides where the feet go; the body follows the feet. So
// slowing, stopping, turning on the spot and starting again are all footsteps, and a planted foot never moves.
//
//   const crowd = new Crowd({ seed, bounds });
//   crowd.add({ walker, x, z, heading, plan: [...] })   plan items: { go: [x, z], speed? } | { wait: seconds, face? } | { face: heading, wait }
//                                                       | { join: groupId } (stand in a ring and talk) | { loop: true } (start the plan again)
//   crowd.step(t, dt)  -> per agent { frame, spec } via agent.out (call Cast.apply with it)
import { V3, hash, clamp, wrapA } from './poser.js';

export class Crowd {
  constructor({ seed = 1, cell = 2 } = {}) { this.seed = seed; this.A = []; this.cell = cell; this.groups = new Map(); this.obst = []; }
  obstacle(x, z, r) { this.obst.push({ x, z, r }); }
  add(o) { const a = { i: this.A.length, x: o.x, z: o.z, vx: 0, vz: 0, heading: o.heading || 0, walker: o.walker, plan: o.plan || [], pi: 0, waitUntil: null, speed: o.speed ?? o.walker.vPref, r: o.r ?? 0.28, data: o.data || {}, look: 0, out: null };
    o.walker.place(o.x, o.z, a.heading); this.A.push(a); return a; }
  group(id, cx, cz, r = 0.7) { if (!this.groups.has(id)) this.groups.set(id, { cx, cz, r, mem: [], speaker: 0, next: 0 }); return this.groups.get(id); }
  _grid() { const G = new Map(), c = this.cell; for (const a of this.A) { const k = Math.floor(a.walker.root.x / c) + ',' + Math.floor(a.walker.root.z / c); (G.get(k) || G.set(k, []).get(k)).push(a); } return G; }
  _near(G, a) { const c = this.cell, gx = Math.floor(a.walker.root.x / c), gz = Math.floor(a.walker.root.z / c), out = []; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const L = G.get((gx + dx) + ',' + (gz + dz)); if (L) for (const b of L) if (b !== a) out.push(b); } return out; }
  step(t, dt) {
    const G = this._grid();
    for (const a of this.A) {
      const W = a.walker, p = W.root, it = a.plan[a.pi];
      let want = [0, 0], face = null, idle = true;
      if (it) {
        if (it.loop) { a.pi = 0; }
        else if (it.go) { const dx = it.go[0] - p.x, dz = it.go[1] - p.z, d = Math.hypot(dx, dz), sp = it.speed ?? a.speed;
          if (d < (it.tol ?? 0.35)) { a.pi++; } else { const s = Math.min(sp, sp * d / 1.2 + 0.25); want = [dx / d * s, dz / d * s]; } }
        else if (it.wait != null || it.face != null) { if (a.waitUntil == null) a.waitUntil = t + (it.wait ?? 2); face = it.face ?? null; if (t >= a.waitUntil) { a.waitUntil = null; a.pi++; } }
        else if (it.join != null) { const g = this.groups.get(it.join); if (!g.mem.includes(a)) g.mem.push(a); const k = g.mem.indexOf(a), n = g.mem.length, ang = (k / n) * Math.PI * 2 + (a.i % 3) * 0.2;
          const tx = g.cx + Math.cos(ang) * g.r * (1 + 0.1 * (n - 2)), tz = g.cz + Math.sin(ang) * g.r * (1 + 0.1 * (n - 2)), dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
          if (d > 0.25) { const s = Math.min(a.speed, d * 1.2); want = [dx / d * s, dz / d * s]; }
          const sp = g.mem[g.speaker % n], tgt = sp === a ? { x: g.cx, z: g.cz } : sp.walker.root; face = Math.atan2(g.cx - p.x, g.cz - p.z);
          let lk = Math.atan2(tgt.x - p.x, tgt.z - p.z) - W.heading; a.look = clamp(wrapA(lk), -0.9, 0.9);
          if (it.until != null && t >= it.until) { g.mem.splice(k, 1); a.pi++; a.look = 0; } }
      }
      // avoidance: time-to-collision (power law) + soft separation, only when moving or someone is about to walk into us
      const ws = Math.hypot(want[0], want[1]); let fx = 0, fz = 0;
      for (const b of this._near(G, a)) {
        const q = b.walker.root, rx = q.x - p.x, rz = q.z - p.z, dist = Math.hypot(rx, rz), R = a.r + b.r;
        if (dist < R + 0.15 && dist > 1e-3) { const k = (R + 0.15 - dist) * 3; fx -= rx / dist * k; fz -= rz / dist * k; }
        if (ws < 0.05) continue;
        const vx = W.vel.x - b.walker.vel.x, vz = W.vel.z - b.walker.vel.z, a2 = vx * vx + vz * vz, bq = -(rx * vx + rz * vz), c = dist * dist - R * R;
        if (a2 < 1e-6) continue; const disc = bq * bq - a2 * c; if (disc <= 0) continue; const tau = (bq - Math.sqrt(disc)) / a2; if (tau <= 0 || tau > 3) continue;
        const k = 1.5 * Math.exp(-tau / 3) / (tau * tau) * 0.25;                     // power law with an exponential cutoff
        const cx = rx - vx * tau, cz = rz - vz * tau, cl = Math.hypot(cx, cz) || 1; fx -= cx / cl * k; fz -= cz / cl * k;
      }
      for (const o of this.obst) { const rx = o.x - p.x, rz = o.z - p.z, dist = Math.hypot(rx, rz), R = a.r + o.r; if (dist > R + 2.5) continue;
        if (dist < R + 0.2) { const k = (R + 0.2 - dist) * 4; fx -= rx / dist * k; fz -= rz / dist * k; }
        if (ws > 0.05) { const vx = W.vel.x, vz = W.vel.z, a2 = vx * vx + vz * vz, bq = -(rx * vx + rz * vz), c = dist * dist - R * R, disc = bq * bq - a2 * c;
          if (a2 > 1e-6 && disc > 0) { const tau = (bq - Math.sqrt(disc)) / a2; if (tau > 0 && tau < 3) { const k = 2 * Math.exp(-tau / 3) / (tau * tau) * 0.25, cx = rx - vx * tau, cz = rz - vz * tau, cl = Math.hypot(cx, cz) || 1; fx -= cx / cl * k; fz -= cz / cl * k; } } } }
      const fl = Math.hypot(fx, fz), fm = 1.2; if (fl > fm) { fx *= fm / fl; fz *= fm / fl; }
      want = [want[0] + fx * (ws > 0.05 ? 1 : 0.35), want[1] + fz * (ws > 0.05 ? 1 : 0.35)];
      if (Math.hypot(...want) < 0.08) want = [0, 0];
      a.out = W.update(t, dt, { vel: want, face, idle, look: a.look });
    }
    // groups: the speaker changes every few seconds, at its own pace
    for (const [id, g] of this.groups) if (t >= g.next) { g.speaker = Math.floor(hash(Math.floor(t * 10), id * 31 + this.seed) * 97); g.next = t + 1.8 + 3.5 * hash(Math.floor(t * 10), id * 17 + 3); }
  }
}
