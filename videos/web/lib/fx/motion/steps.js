// MOTION / STEPS (MOTION studio, cycle 1): footprints first, then the body. Locomotion for people.js figures that cannot skate.
// After van de Panne ("From Footprints to Animation", 1997) and the horse in rig/horse.js (gait as a footfall table, feet pinned in
// stance): each step is an EVENT. When a foot lifts, the walker decides where it will land (the root's predicted position at
// heel strike, half a step ahead, half a stance width out, turned toward where the body is going) and the swing carries it there;
// in stance the foot is a fixed world point and it rolls heel -> flat -> toe about that point. The pelvis rides on the legs: its
// height is whatever the stance legs can reach (so the bob comes out of the geometry), it sways over the stance foot, rotates
// with the stride, and the shoulders counter-rotate. Arms swing as damped pendulums driven by the opposite leg, so they lag.
// Nothing is a shared oscillator: cadence, step length, swing, sway come from the body and a seed, and each step's timing and
// length carry their own small variation (a person never repeats a step exactly).
//
// Speed -> step: the walk ratio (step length / cadence, about 0.0064 m per step/min for adults, scaled by stature; Sekiya and
// Nagasaki 1998) gives step length s = sqrt(v * 60 * WR) and cadence v / s. Standing still is the same machine with no root
// motion: a step happens only when a foot is far from where the body wants it (a turn on the spot is a sequence of pivot steps).
//
//   const w = new Walker({ seed, h, dims, speed, carry })        // dims = Poser.dims() of the figure; h = stature (m)
//   w.place(x, z, heading)                                         // feet side by side
//   w.update(t, dt, { vel: [vx, vz], face: heading | null, idle })   -> { frame: { pos, heading, sc }, spec }  (spec: Poser input, LOCAL)
//   w.events  [{ t, kind: 'strike' | 'lift', foot, p }]  (drained by the caller: footfalls for the music)
//   w.stats   { slideMm (max over planted frames), steps }
import * as THREE from 'three';
import { Poser, FOOT, Spring, Pendulum, noise1, fbm, hash, clamp, sstep, smoother, lerp, wrapA, V3, Q, UP } from './poser.js';
import { Idle } from './idle.js';

export const WALK_RATIO = 0.0064;                 // m per (step/min), 1.75 m adult
export function gaitFor(v, h = 1.75, { ratio = 1 } = {}) {
  const WR = WALK_RATIO * (h / 1.75) * ratio, s = Math.sqrt(Math.max(0, v) * 60 * WR), c = s > 1e-3 ? v / s : 0;
  return { step: s, cadence: c, Ts: c > 0 ? 1 / c : Infinity };
}

export class Walker {
  // HUMAN c8 lane F (opt-in): kin = a person's kinematic model (rig/person_kin.js kinOf(h), or lane A's p.kin): the person's speed, walk
  // ratio, step width (on the Harrington hip-joint estimate), toe-out, arm swing, pelvic obliquity, body mass and segment masses replace the
  // seeded population draws; h should then be the person's stature. Without kin nothing changes.
  constructor({ seed = 1, h = 1.75, dims, sc = 1, speed = 1.3, ratio = 1, swing = 1, lean = 0.04, width = 0.09, toeOut = 0.1, carry = null, bodyKg = 75, age = 0.3, idle = {}, kin = null } = {}) {
    this.seed = seed; this.h = h; this.d = dims; this.sc = sc; this.vPref = speed; this.ratio = ratio * (0.84 + 0.32 * hash(seed, 3)); this.swingAmt = swing * (0.8 + 0.4 * hash(seed, 4));   // the walk ratio varies ~10 % between adults (Sekiya and Nagasaki 1998)
    this.lean = lean; this.width = width * (0.85 + 0.3 * hash(seed, 5)); this.toeOut = toeOut * (0.6 + 0.8 * hash(seed, 6)); this.bodyKg = bodyKg; this.age = age;
    this.roll = 0.045; this.segments = null;
    if (kin) { const g = kin.F ? kin.F.gait : kin.gait, H = kin.stature;
      this.vPref = g.speed; this.ratio = g.walkRatio / (WALK_RATIO * (h / 1.75)); void H; this.swingAmt = g.armSwing; this.width = g.stepWidth / (2 * 0.85 * sc);
      this.toeOut = (kin.F ? kin.F.stance.footAngle : kin.stance.footAngle) / 2 * Math.PI / 180; this.bodyKg = kin.mass; this.age = clamp((kin.age - 18) / 45); this.roll = g.pelvicObliquity / 2 * Math.PI / 180;
      this.lean = 0.02 + 0.5 * (g.posture?.kyphosis ?? 0.05); this.segments = kin.F ? kin.F.segments : kin.balanceSegments; idle = { kin, ...idle }; this.kin = kin; }
    this.carry = carry;                           // { side: 1 | -1, kg, L (bail length), two: false }
    this.feet = [0, 1].map(() => ({ H: V3(), yaw: 0, planted: true, tPlant: 0, sw: null, last: null }));
    this.root = V3(); this.vel = V3(); this.heading = 0; this.next = 0; this.stepI = 0; this.tLast = null;
    this.pel = { y: new Spring(null, { f: 3.2, zeta: 0.9 }), x: new Spring(0, { f: 1.4, zeta: 0.8 }), yaw: new Spring(0, { f: 2.2, zeta: 0.8 }), roll: new Spring(0, { f: 2.5, zeta: 0.85 }) };
    this.arm = [new Spring(0, { f: 1.15 + 0.15 * hash(seed, 7), zeta: 0.42 }), new Spring(0, { f: 1.15 + 0.15 * hash(seed, 8), zeta: 0.42 })];
    this.lean0 = new Spring(0, { f: 1.2, zeta: 1 }); this.acc = V3(); this.headYaw = new Spring(0, { f: 1.8, zeta: 0.9 });
    this.idle = new Idle({ seed, ...idle }); this.events = []; this.stats = { slideMm: 0, steps: 0, reachMm: 0 };
    this.bob = carry && !carry.two ? new Pendulum(carry.L ?? 0.22, { damp: carry.damp ?? 2.6, kg: carry.kg ?? 5 }) : null;
  }
  get footLen() { return this.d.foot * this.sc; }
  // a foot's world sole point by name ('H', 'T', 'M') for a flat foot at H with yaw
  _pt(f, nm, out = V3()) { const L = this.footLen, k = nm === 'H' ? 0 : nm === 'T' ? 1 : 0.5; return out.set(f.H.x + Math.sin(f.yaw) * L * k, f.H.y, f.H.z + Math.cos(f.yaw) * L * k); }
  place(x, z, heading = 0, y = 0) {
    this.root.set(x, y, z); this.heading = heading; this.vel.set(0, 0, 0); this.y0 = y;
    for (let k = 0; k < 2; k++) { const s = k ? -1 : 1, f = this.feet[k], yaw = heading + s * this.toeOut, side = V3(Math.cos(heading), 0, -Math.sin(heading)).multiplyScalar(s * this.width * this.sc);
      f.yaw = yaw; f.H.set(x, y, z).add(side).addScaledVector(V3(Math.sin(yaw), 0, Math.cos(yaw)), -0.42 * this.footLen); f.planted = true; f.sw = null; f.tPlant = -1; f.last = null; }
    this.tLast = null; this.next = 0; this.pel.y.init = false; return this;
  }
  // where foot k wants to land when the root is at R heading h, moving at speed v (world)
  _target(k, R, h, v, gait) {
    const s = k ? -1 : 1, fwd = V3(Math.sin(h), 0, Math.cos(h)), left = V3(Math.cos(h), 0, -Math.sin(h));
    const ahead = v > 0.05 ? 0.5 * gait.step * (1 + 0.06 * (hash(this.stepI, this.seed) - 0.5)) : 0;
    const yaw = h + s * this.toeOut, M = R.clone().addScaledVector(left, s * this.width * this.sc * (v > 0.05 ? 0.85 : 1.35)).addScaledVector(fwd, ahead);
    return { H: M.addScaledVector(V3(Math.sin(yaw), 0, Math.cos(yaw)), -0.42 * this.footLen), yaw };
  }
  // the root's position dT ahead, with the current acceleration toward the wish (capped), and its speed then
  _pred(dT) { const a = this._accWish || V3(), tc = Math.min(dT, this._accT || 0); return this.root.clone().addScaledVector(this.vel, dT).addScaledVector(a, 0.5 * tc * tc + tc * (dT - tc)); }
  _vAt(dT) { const a = this._accWish || V3(), tc = Math.min(dT, this._accT || 0); return this.vel.clone().addScaledVector(a, tc).length(); }
  update(t, dt, { vel = null, face = null, idle = true, look = null, y = null } = {}) {
    const first = this.tLast == null; this.tLast = t; if (y != null) this.y0 = y;
    if (dt <= 0 || dt > 0.25) dt = 1 / 30;
    // ---- root: the agent's wish, limited by what a walker can do
    const want = vel ? V3(vel[0], 0, vel[1]) : V3();
    const vmax = this.vPref * 1.35; if (want.length() > vmax) want.setLength(vmax);
    const dv = want.clone().sub(this.vel), amax = 1.6; if (dv.length() > amax * dt) dv.setLength(amax * dt);
    this.acc.copy(dv).multiplyScalar(1 / dt); this.vel.add(dv); this.root.addScaledVector(this.vel, dt);
    { const rest = want.clone().sub(this.vel), rl = rest.length(); this._accWish = rl > 1e-4 ? rest.clone().setLength(amax) : V3(); this._accT = rl / amax; }
    const v = this.vel.length();
    // heading: toward travel when moving, else toward `face`; it turns at a human rate
    let hWant = this.heading; if (v > 0.25) hWant = Math.atan2(this.vel.x, this.vel.z); else if (face != null) hWant = face;
    const dh = wrapA(hWant - this.heading), rate = v > 0.25 ? 2.2 : 1.6; this.heading += clamp(dh, -rate * dt, rate * dt);
    const gait = gaitFor(Math.max(v, 0.05), this.h, { ratio: this.ratio });
    // ---- steps: event-driven
    const F = this.feet, swinging = F.findIndex(f => !f.planted);
    if (swinging < 0 && t < this.next && v > 0.05 && this._rearFar) this.next = t;     // the trailing leg is at full stretch: toe off now
    if (swinging < 0 && t >= this.next) {
      // which foot: alternate while walking; standing, the one furthest from where the body wants it
      const Ts = v > 0.05 ? clamp(gait.Ts, 0.42, 0.72) : 0.62, pred = this._pred(Ts * 0.78);
      let k = -1;
      if (v > 0.12) k = this.lastFoot == null ? 0 : 1 - this.lastFoot;
      else { let worst = 0; for (let j = 0; j < 2; j++) { const tg = this._target(j, pred, this.heading, 0, gait), e = tg.H.distanceTo(F[j].H) + 0.12 * Math.abs(wrapA(tg.yaw - F[j].yaw)); if (e > worst) { worst = e; k = j; } }
        if (worst < 0.09 + 0.04 * hash(this.stepI, this.seed + 1)) k = -1; }
      if (k >= 0) {
        const swingT = Ts * (v > 0.12 ? 0.76 : 0.85) * (1 + 0.08 * (hash(this.stepI, this.seed + 2) - 0.5));      // stride time varies ~2-3% step to step
        const vL = this._vAt(swingT), tg = this._target(k, this._pred(swingT * 0.95), this.heading, vL, gaitFor(Math.max(vL, 0.05), this.h, { ratio: this.ratio }));
        const f = F[k], pitch0 = this._W && this._W[k] && this._W[k].pivot === 'T' ? this._W[k].pitch : 0; f.planted = false; f.sw = { pitch0, t0: t, t1: t + swingT, H0: f.H.clone(), yaw0: f.yaw, H1: tg.H, yaw1: tg.yaw, lift: (v > 0.12 ? 0.055 + 0.03 * Math.min(1, v / 1.6) : 0.035) * this.sc, k };
        this.events.push({ t, kind: 'lift', foot: k, p: this._pt(f, 'T') }); this.lastFoot = k; this.stepI++;
      } else this.next = t + 0.1;
    }
    for (let k = 0; k < 2; k++) { const f = F[k]; if (f.planted || !f.sw) continue; const S = f.sw;
      // keep steering the landing while the swing is young (the body changed its mind)
      if (t < S.t0 + 0.6 * (S.t1 - S.t0)) { const dT = Math.max(0, S.t1 - t), vL = this._vAt(dT), tg = this._target(k, this._pred(dT), this.heading, vL, gaitFor(Math.max(vL, 0.05), this.h, { ratio: this.ratio })); S.H1.lerp(tg.H, 0.35); S.yaw1 = S.yaw1 + wrapA(tg.yaw - S.yaw1) * 0.35; }
      if (t >= S.t1) { f.H.copy(S.H1); f.yaw = S.yaw1; f.planted = true; f.sw = null; f.tPlant = t; f.last = null; this.stats.steps++;
        const Ts = v > 0.05 ? clamp(gait.Ts, 0.42, 0.72) : 0.62; this.next = t + (v > 0.12 ? 0.24 * Ts * (0.85 + 0.3 * hash(this.stepI, this.seed + 5)) : 0.15 + 0.25 * hash(this.stepI, this.seed + 9));
        this.events.push({ t, kind: 'strike', foot: k, p: f.H.clone() }); } }
    // ---- per-foot sole: pivot point and pitch (heel rocker, flat, forefoot rocker) or the swing
    const Ts = v > 0.05 ? clamp(gait.Ts, 0.42, 0.72) : 0.62, footSpec = [], W = [];
    for (let k = 0; k < 2; k++) {
      const f = F[k];
      if (f.planted) {
        const a = t - f.tPlant, other = F[1 - k], walking = v > 0.12 || f.tPlant > t - 0.3;
        // heel rocker: toe comes down over 0.1 s; forefoot rocker: heel rises while the other foot swings past and lands ahead
        const down = f.tPlant < 0 ? 1 : sstep(0, 0.11, a), strikeP = 0.2 * Math.min(1, v / 1.2);
        let heelUp = 0;
        if (!other.planted && other.sw && v > 0.12) { const u = (t - other.sw.t0) / (other.sw.t1 - other.sw.t0); heelUp = 0.35 * sstep(0.45, 1.0, u); }
        else if (other.planted && v > 0.12 && other.tPlant > f.tPlant) { heelUp = 0.35 + 0.45 * sstep(0, 0.24 * Ts, t - other.tPlant); }
        if (heelUp > 0.01) { W[k] = { p: this._pt(f, 'T'), pitch: -heelUp, pivot: 'T' }; }
        else if (down < 1) W[k] = { p: f.H.clone(), pitch: strikeP * (1 - down), pivot: 'H' };
        else W[k] = { p: f.H.clone(), pitch: 0, pivot: 'H' };
        W[k].yaw = f.yaw; W[k].planted = true;
        // the ruler: a planted pivot never moves (by construction); measure the solved sole anyway (below)
      } else {
        const S = f.sw, u = clamp((t - S.t0) / (S.t1 - S.t0)), e = smoother(u);
        // the mid-sole moves from where the toe-off left it to where the heel strike will put it; the foot pitches toe-down then toe-up
        const p0T = this._pt({ H: S.H0, yaw: S.yaw0 }, 'T'), pitch0 = S.pitch0, pitch1 = 0.2 * Math.min(1, v / 1.2);
        const pitch = lerp(pitch0, pitch1, sstep(0.1, 0.95, u)), yaw = S.yaw0 + wrapA(S.yaw1 - S.yaw0) * e;
        // the mid-sole point at lift-off (toe on the ground, heel up) and at strike (heel on the ground, toe up), interpolated
        const mid = (P, yw, pt, from) => { const Rf = Q().setFromAxisAngle(UP, yw).multiply(Q().setFromAxisAngle(V3(1, 0, 0), -pt)); return P.clone().add(FOOT.M.clone().sub(FOOT[from]).multiplyScalar(this.sc).applyQuaternion(Rf)); };
        const m0 = mid(p0T, S.yaw0, pitch0, 'T'), m1 = mid(S.H1, S.yaw1, pitch1, 'H');
        const p = m0.clone().lerp(m1, e); p.y = lerp(m0.y, m1.y, e) + S.lift * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 1.3);
        W[k] = { p, pitch, pivot: 'M', yaw, planted: false };
      }
    }
    // ---- pelvis: over the stance, as high as the stance legs allow
    const h = this.heading, fwd = V3(Math.sin(h), 0, Math.cos(h)), left = V3(Math.cos(h), 0, -Math.sin(h));
    const id = idle && v < 0.15 ? this.idle.sample(t) : null;
    const planted = F.filter(f => f.planted);
    // lateral sway toward the stance foot (walking) or the weight foot (standing, from the idle)
    let swayT = 0;
    if (planted.length === 1) { const k = F.indexOf(planted[0]); swayT = (k ? -1 : 1) * this.width * this.sc * (0.55 - 0.25 * Math.min(1, v / 1.6)); }
    if (id) swayT = id.weight * this.width * this.sc * 0.75 + id.sway[0] * this.sc;
    const sway = this.pel.x.step(swayT, dt);
    const R = this.root.clone().addScaledVector(left, sway);
    if (id) R.addScaledVector(fwd, id.sway[1] * this.sc);
    // carried load: the trunk leans away from it, and the root shifts to keep the joint centre over the feet
    const cy = this.carry, ratio = cy ? (cy.kg || 0) / this.bodyKg : 0;
    if (cy && !cy.two) R.addScaledVector(left, -cy.side * ratio * 0.12 * this.sc);
    // height: nominal minus a bend, limited by every planted foot's reach
    const dm = this.d, sc = this.sc, Lmax = (dm.thigh + dm.shin) * sc * 0.985;
    let yT = (dm.hip - (0.012 + 0.03 * Math.min(1, v / 1.5)) - (cy ? 0.02 * ratio * 8 : 0) - (id ? id.dip : 0)) * sc + this.y0;
    const hipOff = (k) => left.clone().multiplyScalar((k ? -1 : 1) * 0.095 * sc).add(V3(0, -0.04 * sc, 0));
    const ankleOf = (w) => { const Rf = Q().setFromAxisAngle(UP, w.yaw).multiply(Q().setFromAxisAngle(V3(1, 0, 0), -w.pitch)), piv = FOOT[w.pivot || 'M'].clone().multiplyScalar(sc).applyQuaternion(Rf); return w.p.clone().sub(piv); };
    // the body follows the feet: a root that has run ahead of what the planted legs can reach is held back (and the wish is told so)
    for (let it = 0; it < 2; it++) for (let k = 0; k < 2; k++) { if (!W[k].planted) continue; const A = ankleOf(W[k]), Hj = R.clone().add(hipOff(k)), dx = Hj.x - A.x, dz = Hj.z - A.z, dxz = Math.hypot(dx, dz), lim = Lmax * 0.93;
      if (dxz > lim) { const ex = (dxz - lim) / dxz; R.x -= dx * ex; R.z -= dz * ex; this.root.x -= dx * ex; this.root.z -= dz * ex; const vd = (this.vel.x * dx + this.vel.z * dz) / dxz; if (vd > 0) { this.vel.x -= dx / dxz * vd; this.vel.z -= dz / dxz * vd; } this.next = Math.min(this.next, t); this._held = (this._held || 0) + 1; } }
    let yMax = Infinity; this._rearFar = false;
    for (let k = 0; k < 2; k++) { if (!W[k].planted) continue; const A = ankleOf(W[k]), Hj = R.clone().add(hipOff(k)), dxz = Math.hypot(Hj.x - A.x, Hj.z - A.z);
      const lim = dxz < Lmax ? A.y + Math.sqrt(Lmax * Lmax - dxz * dxz) + 0.04 * sc : A.y + 0.04 * sc; yMax = Math.min(yMax, lim);
      if (lim < yT - 0.05 * sc && planted.length === 2) this._rearFar = true; if (dxz >= Lmax) this.stats.reachMm = Math.max(this.stats.reachMm, (dxz - Lmax) * 1000); }
    let py = this.pel.y.step(Math.min(yT, yMax), dt); if (py > yMax) { py = yMax; this.pel.y.x = py; this.pel.y.v = Math.min(0, this.pel.y.v); }
    if (first) { this.pel.y.set(Math.min(yT, yMax)); py = this.pel.y.x; }
    // ---- frame and the local spec
    const frame = Poser.frame(V3(R.x, this.y0, R.z), h, sc), toL = p => Poser.w2l(frame, p);
    const pz = toL(V3(R.x, py, R.z));
    // stride rotation: the pelvis turns with the forward leg, the chest against it; from the feet's fore-aft spread
    const fz = W.map(w => toL(w.p).z), spread = (fz[0] - fz[1]) / Math.max(0.2, (gait.step || 0.5) / sc);
    const pyaw = this.pel.yaw.step(v > 0.12 ? -0.09 * spread : 0, dt);
    const swingSide = F.findIndex(f => !f.planted), proll = this.pel.roll.step(swingSide >= 0 && v > 0.12 ? (swingSide ? -1 : 1) * this.roll : id ? -id.weight * 0.05 : 0, dt);
    const accF = this.acc.dot(fwd), lean = this.lean0.step(this.lean + 0.03 * Math.min(1, v / 1.5) + clamp(accF * 0.05, -0.08, 0.1) + this.age * 0.08, dt);
    const spec = {
      pelvis: { p: pz, yaw: pyaw + (id ? id.hipYaw : 0), pitch: 0.06 + lean * 0.4, roll: proll + (cy && !cy.two ? cy.side * ratio * 0.25 : 0) },
      spine: { flex: lean * 0.9 + (id ? id.slump : 0) + (cy && cy.two ? -0.15 - ratio * 0.6 : 0), bend: -(id ? id.weight * 0.04 : 0) - proll * 0.6 - (cy && !cy.two ? cy.side * ratio * 0.9 : 0), twist: -pyaw * 1.6 + (id ? id.chestYaw : 0) },
      head: { pitch: -lean * 1.1 - 0.06 * Math.min(1, v) + (id ? id.headPitch : 0) + (id ? id.breath * 0.02 : 0), yaw: pyaw * 0.6 + (id ? id.look : 0) + (look || 0), roll: -proll * 0.5 },
      feet: W.map(w => ({ p: toL(w.p), yaw: wrapA(w.yaw - h), pitch: w.pitch, pivot: w.pivot, planted: w.planted })),
      arms: [null, null], hands: [null, null], bodyKg: this.bodyKg,
    };
    if (this.segments) spec.segments = this.segments;   // HUMAN c8 lane F: the person's own masses for the Poser's COM report
    if (id) { spec.spine.flex += -id.breath * 0.015; }
    // arms: pendulums driven by the opposite leg (left arm forward when the right foot is forward)
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1, carrying = cy && (cy.two || cy.side === s), amp = (0.22 + 0.25 * Math.min(1, v / 1.6)) * this.swingAmt * (carrying ? 0.2 : 1) * (1 - this.age * 0.4);
      const drive = v > 0.12 ? -spread * s * amp : 0, a = this.arm[k].step(drive, dt);
      const pose = id && !carrying ? id.arms[k] : null;
      if (carrying && cy.two) spec.arms[k] = null;
      else if (carrying) spec.arms[k] = { ua: [a * 0.5, 0, 0.12 + ratio * 0.45], fa: [-0.06, 0, 0], hn: [0.05, 0, 0], curl: 1.5 };      // the loaded arm hangs nearly still, held out from the leg
      else if (pose) spec.arms[k] = pose;
      else spec.arms[k] = { ua: [a, 0, 0.07 + (cy && !cy.two ? ratio * 1.2 : 0)], fa: [-(0.2 + 0.35 * Math.max(0, -a) / 0.4 + 0.05 * v), 0, 0], hn: [0.05 + 0.1 * a, 0, 0], curl: 0.45 + 0.1 * hash(this.seed, 11) };
    }
    this._W = W; return { frame, spec, v };
  }
  // after the pose is solved: the slide ruler. The planted foot's active pivot (heel, flat, toe) in world, frame to frame, from the
  // SOLVED pose (Poser.solePts), so an IK miss would show here.
  afterSolve(poser, frame) {
    for (let k = 0; k < 2; k++) {
      const f = this.feet[k], w = this._W && this._W[k]; if (!f.planted || !w) { f.last = null; continue; }
      const sp = poser.solePts(k), loc = w.pivot === 'T' ? sp.T : w.pivot === 'H' ? sp.H : sp.H.clone().lerp(sp.T, 0.5), pt = Poser.l2w(frame, loc);
      if (f.last && f.lastPiv === w.pivot) { const d = Math.hypot(pt.x - f.last.x, pt.z - f.last.z) * 1000; this.stats.slideMm = Math.max(this.stats.slideMm, d); this.stats.slideSum = (this.stats.slideSum || 0) + d; this.stats.slideN = (this.stats.slideN || 0) + 1; }
      f.last = pt; f.lastPiv = w.pivot;
    }
  }
  swingCarry(gripW, t, dt) { if (!this.bob) return null; const p = this.bob.step(gripW, dt), d = gripW.clone().sub(p), fwd = V3(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.bobSwing = -Math.atan2(d.clone().dot(fwd), d.y) * 0.6; return p; }
}
