// MOTION / HAUL CYCLE (HUMAN c7): hauling a load over distance as a CYCLE, not one held lean.
// MOTION c1's Haul hangs each body off the rope (the lean solved from the hands on it), but the feet never move and the re-grip is a
// 0.2 m slide: from the side the haul read as one beat. Sailors and riggers hauling a fall over distance do one of two things, timed to
// a call (S. Hugill, Shanties from the Seven Seas, 1961: the short-drag shanty puts one pull on the stressed beat; stamp-and-go walks
// away with the fall): hand over hand in place, or the line walks back. This cycle does both, in order, per call:
//   ready   (the call)            sink a little, arms long
//   heave   (the stressed beat)   drop back and drive: the rope gains D1 (the load lurches and stops); the lean deepens with it
//   hold                          the load held on the lean
//   step back                     the rear foot, then the front foot, each a footstep event; the rope comes with the body (D2 = the step)
//   regrip  (hand over hand)      the rear hand lets go, passes over the front hand and takes the rope a forearm ahead; it is now the
//                                 front hand; the body comes up to the ready lean on it
// Every phase time carries the hauler's own reaction and a per-call draw (Bernstein); the step length and the regrip reach come from
// the body. The rope's travel is a pure function of the call times (ropeTravelCycle) so a crew shares one rope; the hands are material
// points on it while they grip.
import { Haul, jit } from './labour.js';
import { Poser, Spring, hash, noise1, clamp, sstep, smoother, lerp, V3 } from './poser.js';

const ease = (a, b, x) => smoother((x - a) / (b - a));
export const CYCLE = { heave: [0, 0.95], hold: [0.95, 1.15], stepR: [1.15, 1.45], stepF: [1.42, 1.72], regrip: [1.72, 2.14], settle: [1.95, 2.45] };
// the crew's rope: per call, the heave's gain D1 (fast, from start to start + dur) and the walk-back gain D2 over the two steps
export function ropeTravelCycle(t, calls, { D1 = 0.32, D2 = 0.36, start = 0.42, dur = 0.6, react = 0.17, seed = 3 } = {}) {
  let r = 0; for (let i = 0; i < calls.length; i++) { const c = calls[i] + react, d1 = D1 * (1 + jit(seed, i, 5, 0.1)); if (t <= c + start) break;
    const u = clamp((t - c - start) / dur); r += d1 * (u < 1 ? (1 - Math.pow(1 - u, 2.2)) * smoother(Math.min(1, u * 3)) : 1);
    r += D2 * ease(CYCLE.stepR[0], CYCLE.stepF[1], t - c); }
  return r;
}
export function ropeTensionCycle(t, calls, { react = 0.17 } = {}) {
  let T = 0.12; for (const c0 of calls) { const a = t - c0 - react; if (a < -0.1 || a > 2.4) continue;
    T = Math.max(T, a < 0.22 ? lerp(0.12, 1, smoother((a + 0.1) / 0.32)) : a < 1.15 ? 1 : a < 1.72 ? 0.7 : lerp(0.7, 0.15, smoother((a - 1.72) / 0.3))); } return T;
}

export class HaulCycle extends Haul {
  // o: as Haul + { D1, D2 (= the step length, local m), regrip (how far ahead of the front hand the new grip is taken) }
  constructor(o) {
    super({ gapHands: 0.3, ...o });
    this.D1 = o.D1 ?? 0.32; this.step = (o.D2 ?? 0.36) / (this.sc || 1); this.zF0 = this.zF; this.zR0 = this.zR;
    this.g0F = this.g.F; this.footS = [new Spring(0, { f: 3, zeta: 0.9 }), new Spring(0, { f: 3, zeta: 0.9 })];
    this.events = [];
  }
  // the material coordinates of the two hands at time t, which hand is in front, and the regrip in progress
  _grips(t) {
    let mF = this.g0F, mR = this.g0F - this.gapHands, frontIsA = true, moving = null;
    for (let k = 0; k < this.calls.length; k++) { const c = this.calls[k] + this.react + jit(this.seed, k, 7, 0.04), t0 = c + CYCLE.regrip[0] + jit(this.seed, k, 11, 0.05), t1 = c + CYCLE.regrip[1] + jit(this.seed, k, 12, 0.05);
      if (t < t0) break;
      const shift = this.step * (k + 1), mNew = this.g0F - shift + this.travel(t0) / this.sc + 0.02 * jit(this.seed, k, 13, 1);   // a forearm ahead: where the ready lean wants the front hand
      if (t < t1) { moving = { from: mR, to: mNew, u: (t - t0) / (t1 - t0), k }; break; }
      [mF, mR] = [mNew, mF]; frontIsA = !frontIsA; }
    return { mF, mR, frontIsA, moving };
  }
  sample(t, dt = 1 / 30) {
    const s = this.seed, c = this._cyc(t), a = c.a, i = c.i, r = this.travel(t) / this.sc;
    // feet: whole cycles done shift the stance back by `step`; inside a cycle the rear foot then the front foot step (footprint events)
    const done = Math.max(0, i), uR = i >= 0 ? ease(CYCLE.stepR[0], CYCLE.stepR[1], a) : 0, uF = i >= 0 ? ease(CYCLE.stepF[0], CYCLE.stepF[1], a) : 0;
    const zFoF = this.zF0 - this.step * (done + uF), zFoR = this.zR0 - this.step * (done + uR);
    for (const [u, k] of [[uR, 'R'], [uF, 'F']]) { const key = `${k}${i}`; if (u > 0 && !this['_l' + key]) { this['_l' + key] = 1; this.events.push({ t, kind: 'lift', foot: k }); } if (u >= 1 && !this['_s' + key]) { this['_s' + key] = 1; this.events.push({ t, kind: 'strike', foot: k }); } }
    this.zF = zFoF; this.zR = zFoR;
    // arms and knees through the cycle (Haul's phases for the heave), recovering while the steps and the regrip happen
    const dep = this.depth * (1 - 0.03 * Math.max(0, i)) * (1 + jit(s, i, 8, 0.08));
    const Rr = this.Rmax * 0.86, Rd = this.Rmax * 0.975, cr0 = 0.05, crD = (0.12 + (this.anchor ? 0.05 : 0)) * dep, crE = 0.035;
    let R = Rr, cr = cr0, phase = 'rest', therb = 'hold', eff = 0;
    if (i >= 0) {
      if (a < 0 && a > -0.35) { const u = ease(-0.35, 0, a); R = Rr - 0.03 * Math.sin(Math.PI * u); cr = cr0 + 0.03 * u; phase = 'ready'; therb = 'grasp'; }
      else if (a >= 0 && a < 0.3) { const u = ease(0, 0.3, a); R = lerp(Rr, Rd, u); cr = lerp(cr0 + 0.03, crD, u); phase = 'heave'; therb = 'move'; eff = u; }
      else if (a >= 0.3 && a < CYCLE.heave[1]) { const u = ease(0.3, CYCLE.heave[1], a); R = Rd; cr = lerp(crD, crE, u); phase = 'heave'; therb = 'move'; eff = 1; }
      else if (a < CYCLE.hold[1]) { R = Rd; cr = crE; phase = 'hold'; therb = 'hold'; eff = 0.85; }
      else if (a < CYCLE.stepF[1]) { R = Rd; cr = crE + 0.02 * Math.sin(Math.PI * (uR + uF) / 2); phase = 'step back'; therb = 'transport loaded'; eff = 0.6; }
      else if (a < CYCLE.regrip[1]) { R = Rd; cr = crE; phase = 'regrip'; therb = 'release'; eff = 0.4; }
      else { const u = ease(CYCLE.settle[0], CYCLE.settle[1], a); R = lerp(Rd, Rr, u); cr = lerp(crE, cr0, u); phase = u < 1 ? 'settle' : 'rest'; therb = 'rest'; eff = 0.4 * (1 - u); }
    }
    const G = this._grips(t), zFront = G.mF - r, zRear = G.mR - r;
    const sol = this._thetaFor(zFront, R, cr), th = this.thS.step(sol.th, dt), S = this._S(th, cr), H = S.H;
    const flex = this.flex.step(this.phi + 0.05 * eff, dt), id = this.idle.sample(t);
    const look = phase === 'settle' || phase === 'rest' || phase === 'regrip' ? 0.25 * noise1(t * 0.4, s) : 0;
    const headP = this.head.step(th * 0.72 - 0.12 + 0.2 * eff - (phase === 'regrip' ? 0.15 : 0) + (phase === 'rest' ? id.headPitch : 0), dt);
    const yR = this._ropeYL(), toeUp = this.anchor ? 0.38 : 0.28;
    const spec = { pelvis: { p: V3(this.ropeSide * -0.02, H.y, H.z), yaw: -this.ropeSide * 0.12, pitch: -th + 0.06, roll: 0 }, spine: { flex: flex - 0.03 * id.breath * (1 - eff), twist: this.ropeSide * 0.14, bend: 0 },
      head: { pitch: headP, yaw: look + this.ropeSide * -0.1 }, feet: [null, null], hands: [null, null], bodyKg: this.bodyKg };
    const kF = this.ropeSide > 0 ? 1 : 0, kR = 1 - kF, lift = u => 0.07 * Math.sin(Math.PI * u);
    spec.feet[kF] = { p: V3(this.xF, lift(uF > 0 && uF < 1 ? uF : 0), zFoF), yaw: 0.05 * -this.ropeSide, pitch: (uF > 0 && uF < 1) ? -0.25 * Math.sin(Math.PI * uF) : toeUp * smoother(Math.min(1, eff + 0.4)), pivot: 'H', planted: !(uF > 0 && uF < 1) };
    spec.feet[kR] = { p: V3(this.xR, lift(uR > 0 && uR < 1 ? uR : 0), zFoR), yaw: this.ropeSide * 0.45, pitch: (uR > 0 && uR < 1) ? -0.2 * Math.sin(Math.PI * uR) : 0, pivot: 'M', planted: !(uR > 0 && uR < 1) };
    // hands: A starts as the front hand (the one away from the rope side), they swap at each regrip; the moving hand arcs over the other
    const hA = this.ropeSide > 0 ? 1 : 0, hB = 1 - hA, rx = this.ropeX, fr = G.frontIsA ? hA : hB, re = G.frontIsA ? hB : hA;
    spec.hands[fr] = { p: V3(rx, yR, zFront), curl: 1.45, roll: 0 };
    if (G.moving) { const u = smoother(G.moving.u), z = lerp(G.moving.from, G.moving.to, u) - r; spec.hands[re] = { p: V3(rx - this.ropeSide * 0.07 * Math.sin(Math.PI * u), yR + 0.11 * Math.sin(Math.PI * u), z), curl: 0.5 + 0.9 * Math.abs(2 * u - 1) ** 3, roll: 0, free: true }; }
    else spec.hands[re] = { p: V3(rx, yR, zRear), curl: 1.45, roll: 0 };
    this.last = { th, phase, eff, R, cr, miss: sol.miss };
    const grips = []; grips[fr] = Poser.l2w(this.frame, V3(rx, yR, zFront)); grips[re] = G.moving ? null : Poser.l2w(this.frame, V3(rx, yR, zRear));
    return { frame: this.frame, spec, phase, therblig: therb, effort: eff, theta: th, grips, gripM: { [fr]: G.mF, ...(G.moving ? {} : { [re]: G.mR }) }, moving: !!G.moving };
  }
}

// ------------------------------------------------------------------ the rope as a chain (Verlet, length constraints, hand pins, a floor
// with friction): it hangs between the hands, goes taut on the heave, and the hauled-in fall feeds out behind the last hand and piles.
// s: material coordinate (m from the load end). pins: [{ s, p (world) }] for this step; load: world point of s = 0.
export class RopeChain {
  constructor({ length = 16, ds = 0.08, radius = 0.016, start, dir, floorY = 0 } = {}) {
    this.ds = ds; this.n = Math.round(length / ds) + 1; this.r = radius; this.floorY = floorY;
    this.p = []; this.q = []; for (let i = 0; i < this.n; i++) { const x = start.clone().addScaledVector(dir, i * ds); x.y = Math.max(floorY + radius, x.y - 0.02 * i); this.p.push(x); this.q.push(x.clone()); }
  }
  step(dt, load, pins) {
    const n = this.n, sub = 3, h = dt / sub, g = -9.81 * h * h;
    const pin = new Map(); for (const P of pins) { const i = Math.max(0, Math.min(n - 1, Math.round(P.s / this.ds))); pin.set(i, P.p); }
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < n; i++) { const p = this.p[i], q = this.q[i], vx = (p.x - q.x) * 0.985, vy = (p.y - q.y) * 0.985, vz = (p.z - q.z) * 0.985; q.copy(p);
        const onF = p.y <= this.floorY + this.r + 0.002; p.x += vx * (onF ? 0.35 : 1); p.y += vy + g; p.z += vz * (onF ? 0.35 : 1); }
      for (let it = 0; it < 24; it++) {
        this.p[0].copy(load); for (const [i, P] of pin) this.p[i].copy(P);
        for (let i = 0; i < n - 1; i++) { const a = this.p[i], b = this.p[i + 1], dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz) || 1e-9, e = (d - this.ds) / d;
          const fa = i === 0 || pin.has(i) ? 0 : 0.5, fb = pin.has(i + 1) ? 0 : 0.5, w = fa + fb || 1, ka = fa / w, kb = fb / w;
          a.x += dx * e * ka; a.y += dy * e * ka; a.z += dz * e * ka; b.x -= dx * e * kb; b.y -= dy * e * kb; b.z -= dz * e * kb; }
        for (const p of this.p) if (p.y < this.floorY + this.r) p.y = this.floorY + this.r;
      }
    }
    return this.p;
  }
}
