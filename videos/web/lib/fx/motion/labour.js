// MOTION / LABOUR (MOTION studio, cycle 1): work as a cause, not a curve.
// Each act is a small mechanism: the thing being worked (a rope, a box, a hammer, a ladder, a lever, a cart) has a state, the
// hands are ON it (grip points on the object, solved by the Poser's arm IK with a measured miss), the feet are ON the ground or a
// rung (world points that do not move while planted), and the body is SOLVED between them: the trunk angle that keeps straight
// arms on a rope, the pelvis that carries the box's weight over the feet, the knees that take the drop of a sledge. Timing is a
// phase table per act (anticipation, the effort, follow-through, recovery), tagged with Gilbreth's elementary motions
// (therbligs: reach, grasp, move, hold, release, position, use, rest) and exported as events, as the hooves are in horse.js.
//
// Repetition without repetition (Bernstein, the chisel blows at the Central Institute of Labour, 1920s; Scholz and Schoener's
// uncontrolled manifold, 1999): every cycle draws its own depth, timing and joint split from the figure's seed and the cycle
// number, but only in directions the task does not care about. The sledge still lands on the stake head; the elbow, the knees and
// the trunk land differently each time. Fatigue makes later cycles shallower and slower.
//
// Every act: act.sample(t, dt) -> { frame, spec, props: {...world transforms}, phase: name, therblig, effort 0..1 } and act.events.
// All are seekable except where they integrate (the crew's rope is a pure function of the call times; the walker-based acts keep
// state and must be run in time order).
import * as THREE from 'three';
import { Poser, Spring, hash, noise1, fbm, clamp, sstep, smoother, lerp, wrapA, V3, Q, UP } from './poser.js';
import { Idle } from './idle.js';

const ease = (a, b, x) => smoother((x - a) / (b - a));
const jit = (seed, i, k, amt) => (hash(seed * 7919 + i * 131 + k, 77) - 0.5) * 2 * amt;    // a per-cycle draw in [-amt, amt]

// ------------------------------------------------------------------ the call: a crew heaves together on a voice, not as a ripple
// call times are a human's: a period with its own drift, each call a little early or late. calls(t0, n) -> [t]
export function callTimes({ t0 = 0.6, period = 2.5, n = 12, seed = 3, drift = 0.06 } = {}) {
  const T = []; let t = t0; for (let i = 0; i < n; i++) { T.push(t); t += period * (1 + jit(seed, i, 1, drift) + 0.015 * i); } return T;
}
// the rope's travel toward the crew: each heave moves the load D (static friction breaks late, the load lurches and stops)
export function ropeTravel(t, calls, { D = 0.3, start = 0.42, dur = 0.62, seed = 3 } = {}) {
  let r = 0; for (let i = 0; i < calls.length; i++) { const a = calls[i] + start, d = D * (1 - 0.025 * i) * (1 + jit(seed, i, 5, 0.12)); if (t <= a) break;
    const u = clamp((t - a) / dur); r += d * (u < 1 ? (1 - Math.pow(1 - u, 2.2)) * smoother(Math.min(1, u * 3)) : 1); }
  return r;
}
// team tension 0..1: builds in the drop, peaks in the drive, holds, falls in the recovery
export function ropeTension(t, calls, { seed = 3 } = {}) {
  let T = 0.12; for (const c of calls) { const a = t - c; if (a < -0.1 || a > 1.6) continue; T = Math.max(T, a < 0.22 ? lerp(0.12, 1, smoother((a + 0.1) / 0.32)) : a < 1.1 ? 1 : lerp(1, 0.12, smoother((a - 1.1) / 0.45))); } return T;
}

// ------------------------------------------------------------------ HAUL: one hauler on a rope along +z (local), the load ahead
// The coach's brief (tug-of-war handbooks): you are not pulling the rope, you are hanging off it. Arms long and straight, the
// heel-to-shoulder line straight at about 45 degrees in the heave (up to ~58), three phases: DROP (sit back into it), DRIVE (the
// legs push), HOLD; then RECOVER and re-take the rope hand over hand. Here the trunk angle is not keyed: it is SOLVED each frame
// from where the hands are on the rope (material points that move with the rope while gripped) and how long the arms are (bent
// a little when ready, straight in the heave). So the lean is the rope's doing.
export class Haul {
  // o: { seed, dims, sc, bodyKg, base: Vector3 (world ground point between the feet), heading (facing the load), ropeY (world),
  //      ropeSide: +1 | -1 (rope passes left / right of centre), calls, travel(t) (rope travel, m), tension(t), anchor: bool, gapHands }
  constructor(o) {
    Object.assign(this, { seed: 1, bodyKg: 75, anchor: false, ropeSide: 1, gapHands: 0.23, lean0: 0.42, depth: 1, react: 0.17 }, o);
    const s = this.seed, d = this.dims; this.events = [];
    this.frame = Poser.frame(this.base, this.heading, this.sc);
    // stance (local, unscaled metres): front heel forward, rear foot back and turned out; the anchor sits deeper and wider
    this.zF = 0.27 + jit(s, 0, 1, 0.04) + (this.anchor ? 0.06 : 0); this.zR = -0.3 + jit(s, 0, 2, 0.05) - (this.anchor ? 0.08 : 0);
    this.xF = -this.ropeSide * (0.06 + jit(s, 0, 3, 0.02)); this.xR = this.ropeSide * (0.13 + jit(s, 0, 4, 0.03));
    this.Rmax = d.ua + d.fa + 0.07; this.trunk = d.shoulderH - d.hip + 0.0; this.hd0 = d.hip - 0.085;
    this.thetaMax = (this.anchor ? 0.98 : 0.86) + jit(s, 0, 5, 0.05);
    this.phi = 0.1 + jit(s, 0, 6, 0.04);                          // the trunk's own flex off the line (a hauler curls a little round the rope)
    this.ropeX = this.ropeSide * 0.1;
    this.head = new Spring(0, { f: 1.6, zeta: 0.7 }); this.flex = new Spring(this.phi, { f: 2.2, zeta: 0.75 }); this.thS = new Spring(null, { f: 3.5, zeta: 0.85 });
    this.idle = new Idle({ seed: s, exertion: 0.6 });
    // the front hand's grip on the rope (local z, at t = 0, rope travel 0): where straight-ish arms reach at the ready lean
    const S0 = this._S(this.lean0, 0.05); this.g = { F: S0.z + Math.sqrt(Math.max(0.01, (this.Rmax * 0.86) ** 2 - (this._ropeYL() - S0.y) ** 2)) };
    this.g.R = this.g.F - this.gapHands;
  }
  _ropeYL() { return (this.ropeY - this.base.y) / this.sc; }
  // the sagittal mechanism: pivot at the front heel's ankle, line at theta from vertical (backward), hips at hd along it, shoulders above
  _H(theta, crouch) { const hd = this.hd0 * (1 - crouch); return { z: this.zF + 0.02 - Math.sin(theta) * hd, y: 0.085 + Math.cos(theta) * hd }; }
  _S(theta, crouch, phi = this.phi) { const H = this._H(theta, crouch); return { z: H.z - Math.sin(theta - phi) * this.trunk, y: H.y + Math.cos(theta - phi) * this.trunk, H }; }
  // solve the lean from a hand on the rope at local z and an arm length R
  _thetaFor(zHand, R, crouch) { const yR = this._ropeYL();
    // only the branch with the hand AHEAD of the shoulder is a hauler (further back the shoulder would pass the hand)
    const dz = th => zHand - this._S(th, crouch).z, f = th => { const S = this._S(th, crouch); return Math.hypot(zHand - S.z, yR - S.y) - R; };
    let lo = -0.15, hi = this.thetaMax;
    if (dz(lo) < 0) { let a = lo, b = hi; if (dz(b) < 0) return { th: hi, miss: f(hi) }; for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (dz(m) < 0) a = m; else b = m; } lo = b; }
    if (f(hi) < 0) return { th: hi, miss: -f(hi) }; if (f(lo) > 0) return { th: lo, miss: f(lo) };
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; } return { th: (lo + hi) / 2, miss: 0 }; }
  // phase of this hauler relative to its own response to the nearest call
  _cyc(t) { const C = this.calls; let i = -1; for (let k = 0; k < C.length; k++) if (C[k] - 0.5 <= t) i = k; if (i < 0) return { i: -1, a: -9 };
    const fat = 0.012 * i, react = this.react + jit(this.seed, i, 7, 0.045) + fat; return { i, a: t - (C[i] + react), react, fat }; }
  sample(t, dt = 1 / 30) {
    const s = this.seed, c = this._cyc(t), a = c.a, i = c.i, r = this.travel(t), dep = this.depth * (1 - 0.03 * Math.max(0, i)) * (1 + jit(s, i, 8, 0.08));
    // arm length and knee bend through the cycle: anticipation (sink, arms give), DROP (arms straighten, sit back), DRIVE (legs push), HOLD, RECOVER
    const Rr = this.Rmax * 0.86, Rd = this.Rmax * 0.975, cr0 = 0.05, crD = (0.12 + (this.anchor ? 0.05 : 0)) * dep, crE = 0.035;
    let R = Rr, cr = cr0, phase = 'rest', therb = 'hold', eff = 0;
    if (i >= 0) {
      if (a < 0 && a > -0.35) { const u = ease(-0.35, 0, a); R = Rr - 0.03 * Math.sin(Math.PI * u); cr = cr0 + 0.03 * u; phase = 'ready'; therb = 'grasp'; }
      else if (a >= 0 && a < 0.3) { const u = ease(0, 0.3, a); R = lerp(Rr, Rd, u); cr = lerp(cr0 + 0.03, crD, u); phase = 'drop'; therb = 'move'; eff = u; }
      else if (a >= 0.3 && a < 0.95) { const u = ease(0.3, 0.95, a); R = Rd; cr = lerp(crD, crE, u); phase = 'drive'; therb = 'move'; eff = 1; }
      else if (a >= 0.95 && a < 1.2) { R = Rd; cr = crE; phase = 'hold'; therb = 'hold'; eff = 0.85; }
      else if (a >= 1.2) { const u = ease(1.2, 1.65, a); R = lerp(Rd, Rr, u); cr = lerp(crE, cr0, u); phase = 'recover'; therb = 'release'; eff = 0.85 * (1 - u); }
    }
    // grip material points: g.F, g.R move with the rope (world z_local = g - r); regrips slide them forward over 0.25 s each
    let zF = this.g.F - r, zR = this.g.R - r, slideF = 0, slideR = 0;
    for (let k = 0; k < this.calls.length; k++) { const rk = this.react + jit(s, k, 7, 0.045) + 0.012 * k, G = { t0: this.calls[k] + rk + 1.25, first: hash(s * 31 + k, 9) < 0.5 ? 'F' : 'R' }; if (t < G.t0) break;
      const dd = this.travel(this.calls[k] + 2.0) - this.travel(this.calls[k] - 0.2), u1 = ease(0, 0.28, t - G.t0), u2 = ease(0.24, 0.52, t - G.t0);
      const uF = G.first === 'F' ? u1 : u2, uR = G.first === 'F' ? u2 : u1; zF += dd * uF; zR += dd * uR; if (uF > 0 && uF < 1) slideF = 1; if (uR > 0 && uR < 1) slideR = 1; }
    const sol = this._thetaFor(zF, R, cr), th = this.thS.step(sol.th, dt), S = this._S(th, cr), H = S.H;
    // the trunk curls a touch more in the drive, the head goes down on the effort and comes up to look along the line on the recovery
    const flex = this.flex.step(this.phi + 0.05 * eff, dt), id = this.idle.sample(t);
    const look = phase === 'recover' || phase === 'rest' ? 0.25 * noise1(t * 0.4, s) : 0;
    const headP = this.head.step(th * 0.72 - 0.12 + 0.2 * eff + (phase === 'rest' ? id.headPitch : 0), dt);
    const yR = this._ropeYL(), toeUp = this.anchor ? 0.38 : 0.28;
    const spec = {
      pelvis: { p: V3(this.ropeSide * -0.02, H.y, H.z), yaw: -this.ropeSide * 0.12, pitch: -th + 0.06, roll: 0 },
      spine: { flex: flex - 0.03 * id.breath * (1 - eff), twist: this.ropeSide * 0.14, bend: 0 },
      head: { pitch: headP, yaw: look + this.ropeSide * -0.1 },
      feet: [null, null], hands: [null, null], bodyKg: this.bodyKg,
    };
    // feet: the front foot toes up and heel dug in under load, the rear one flat and turned out (left/right by the rope side)
    const kF = this.ropeSide > 0 ? 1 : 0, kR = 1 - kF;
    spec.feet[kF] = { p: V3(this.xF, 0, this.zF), yaw: 0.05 * -this.ropeSide, pitch: toeUp * smoother(Math.min(1, (eff + 0.4))), pivot: 'H' };
    spec.feet[kR] = { p: V3(this.xR, 0, this.zR), yaw: this.ropeSide * 0.45, pitch: 0, pivot: 'M' };
    // hands on the rope; the rope-side hand is the rear one
    const hR = this.ropeSide > 0 ? 0 : 1, hF = 1 - hR, rx = this.ropeX;
    spec.hands[hF] = { p: V3(rx, yR + 0.012 * slideF, zF), curl: slideF ? 0.9 : 1.45, roll: 0, free: !!slideF };
    spec.hands[hR] = { p: V3(rx, yR + 0.012 * slideR, zR), curl: slideR ? 0.9 : 1.45, roll: 0, free: !!slideR };
    this.last = { th, phase, eff, R, cr, miss: sol.miss };
    return { frame: this.frame, spec, phase, therblig: therb, effort: eff, theta: th, grips: [Poser.l2w(this.frame, V3(rx, yR, zF)), Poser.l2w(this.frame, V3(rx, yR, zR))] };
  }
  // the heel-to-shoulder line angle measured on the solved pose (world), for the ruler
  static lineAngle(rep, k) { const nm = k ? 'R' : 'L', an = rep.joints['an' + nm], sh = rep.joints.shoulderMid; const d = sh.clone().sub(an); return Math.atan2(Math.hypot(d.x, d.z), d.y) * 180 / Math.PI; }
}

// ------------------------------------------------------------------ shared: a fixed-place act (feet on the ground or a rung, a
// frame that does not move), with a balance pass: the pelvis is moved until the centre of mass (body + what it holds, + the moment
// of a push or pull at the hands) sits over the support. Rosen's "few strong key poses + springs" for the timing; the solve for the
// rest.
import { Keyed } from '../rig/timing.js';
import { measureLocal, LIMITS } from '../rig/limits.js';
class Act {
  constructor(o) { Object.assign(this, { seed: 1, bodyKg: 75, heading: 0 }, o); this.frame = Poser.frame(this.base, this.heading, this.sc); this.poser = new Poser(); this.Pz = new Float32Array(66); this.events = []; }
  // move spec.pelvis.p horizontally until the COM (with a held load, and a horizontal hand force F (N, local) at height hF) is over
  // the support's centre + bias (local z). Two passes. Returns the report of the last solve.
  balance(spec, { load = null, F = null, hF = 1.0, bias = 0, gain = 0.85, axes = 'z', update = null } = {}) {
    let rep = null; spec.bodyKg = this.bodyKg; if (load) spec.load = load; if (this.segments) spec.segments = this.segments;   // HUMAN c8 lane F: o.segments, a person's own masses (opt-in)
    for (let it = 0; it < 4; it++) {
      if (update) update(spec);
      this.poser.begin(this.Pz, this.st || null); rep = this.poser.solve(this.Pz, spec, null);
      const pts = rep.support; if (!pts || pts.length < 2) break; let cx = 0, cz = 0; for (const p of pts) { cx += p[0]; cz += p[1]; } cx /= pts.length; cz /= pts.length;
      // a horizontal force at the hands moves where the COM must be: m g dx = F h
      const m = this.bodyKg + (load ? load.kg : 0), dz = F ? -F.z * hF / (m * 9.81) : 0, dx = F ? -F.x * hF / (m * 9.81) : 0;
      const ez = (cz + bias + dz) - rep.com.z, ex = (cx + dx) - rep.com.x;
      if (Math.abs(ez) < 0.004 && (axes === 'z' || Math.abs(ex) < 0.004)) break;
      spec.pelvis.p.z += ez * gain; if (axes !== 'z') spec.pelvis.p.x += ex * gain;
    }
    return rep;
  }
}
const loopT = (t, T) => ((t % T) + T) % T;

// ------------------------------------------------------------------ LIFT: a box from the floor to the belly, held, and set down again
// Muybridge plate 317 (lifting and heaving a 75-lb rock) and the safe-lift brief: feet either side of the load, hips back and down
// (a squat with a hinge: the mix is chosen by the load's height), the head comes up FIRST, the hips and knees drive, the box travels
// up close to the shins and thighs, then the trunk leans back over the feet to carry it. Setting down is the same in reverse, slower.
export class Lift extends Act {
  constructor(o) { super(o); const s = this.seed; this.kg = o.kg ?? 18; this.T = o.period ?? 6.6; this.box = o.box || { w: 0.46, h: 0.3, d: 0.34 };
    this.z0 = 0.27 + jit(s, 0, 1, 0.015); this.flexS = new Spring(0, { f: 2.2, zeta: 0.7 }); this.headS = new Spring(0, { f: 2.8, zeta: 0.8 }); this.idle = new Idle({ seed: s, exertion: 0.5 }); }
  sample(t, dt = 1 / 30) {
    const s = this.seed, k = Math.floor(t / this.T), u = loopT(t, this.T), d = this.dims, sq = 1 + jit(s, k, 1, 0.12), hd = this.box.h / 2;
    // keys: pelvis drop (fraction of hip height), pelvis back, trunk flex, head (relative), box height, box z, hands on (0..1)
    // keys: pelvis drop (fraction of hip height), pelvis back (m), trunk flex (rad, pelvis + spine), head, box height, box held (0 on the floor,
    // 1 carried against the belly), hands on (0..1), effort
    const K = new Keyed([
      { t: 0.0, v: { drop: 0, back: 0, flex: 0.05, head: 0.1, by: hd, hold: 0, on: 0, eff: 0 } },
      { t: 0.45, v: { drop: 0.03, back: 0, flex: 0.15, head: 0.5, by: hd, hold: 0, on: 0, eff: 0 }, ease: 'inout' },                       // look at it: the head leads
      { t: 1.25, v: { drop: 0.5 * sq, back: -0.16, flex: 1.28 / sq, head: -0.15, by: hd, hold: 0, on: 0.95, eff: 0.2 }, ease: 'inout' },    // down: hips back, knees out
      { t: 1.45, v: { drop: 0.52 * sq, back: -0.17, flex: 1.32 / sq, head: -0.2, by: hd, hold: 0, on: 1, eff: 0.4 }, ease: 'out' },          // grasp
      { t: 1.8, v: { drop: 0.5 * sq, back: -0.18, flex: 1.2 / sq, head: -0.55, by: hd + 0.006, hold: 0, on: 1, eff: 1 }, ease: 'inout' },  // take the weight: chest and head up first
      { t: 2.2, v: { drop: 0.26 * sq, back: -0.15, flex: 0.85, head: -0.4, by: 0.45, hold: 0.3, on: 1, eff: 1 }, ease: 'in' },               // hips and knees drive, the box up the shins
      { t: 2.65, v: { drop: 0.04, back: -0.02, flex: 0.0, head: -0.05, by: 0.98, hold: 1, on: 1, eff: 0.8 }, ease: 'out' },                  // up, the box at the belly
      { t: 2.95, v: { drop: 0.03, back: 0.0, flex: -0.12, head: 0.08, by: 1.0, hold: 1, on: 1, eff: 0.6 }, ease: 'over' },                   // lean back over the feet
      { t: 4.0, v: { drop: 0.03, back: 0.0, flex: -0.11, head: 0.06, by: 1.0, hold: 1, on: 1, eff: 0.6 } },
      { t: 4.95, v: { drop: 0.28 * sq, back: -0.15, flex: 0.85, head: -0.3, by: 0.4, hold: 0.25, on: 1, eff: 0.9 }, ease: 'inout' },          // set it down: slower, controlled
      { t: 5.4, v: { drop: 0.5 * sq, back: -0.16, flex: 1.28 / sq, head: -0.25, by: hd, hold: 0, on: 1, eff: 0.4 }, ease: 'out' },
      { t: 5.65, v: { drop: 0.48 * sq, back: -0.16, flex: 1.2 / sq, head: -0.1, by: hd, hold: 0, on: 0, eff: 0 }, ease: 'inout' },             // release
      { t: 6.3, v: { drop: 0.02, back: 0, flex: 0.05, head: 0.1, by: hd, hold: 0, on: 0, eff: 0 }, ease: 'inout' },
      { t: this.T, v: { drop: 0, back: 0, flex: 0.05, head: 0.1, by: hd, hold: 0, on: 0, eff: 0 } },
    ]).sample(u);
    const ph = u < 1.25 ? 'reach' : u < 1.8 ? 'grasp' : u < 2.95 ? 'lift' : u < 4.0 ? 'hold' : u < 5.4 ? 'set down' : u < 5.65 ? 'release' : 'rest';
    const flex = this.flexS.step(K.flex, dt), id = this.idle.sample(t), y0 = d.hip;
    const spec = { pelvis: { p: V3(0, y0 * (1 - K.drop), K.back), pitch: flex * 0.55, yaw: 0, roll: 0 }, spine: { flex: flex * 0.45 + 0.02 * id.breath }, head: { pitch: this.headS.step(K.head - flex * 0.55, dt) },
      feet: [{ p: V3(0.17, 0, -0.05), yaw: 0.25, pitch: 0, pivot: 'M' }, { p: V3(-0.17, 0, -0.03), yaw: -0.22, pitch: 0, pivot: 'M' }], hands: [null, null], arms: [POSE_HANG, POSE_HANG] };
    // the box: on the floor it is where it is; carried, it rides against the belly (so it follows the balanced pelvis)
    const B = V3(), carrying = K.on > 0.99 && K.by > hd + 0.004;
    const place = sp => { const zc = lerp(this.z0, sp.pelvis.p.z + 0.31, smoother(K.hold)); B.set(0, K.by, zc);
      const hold = [V3(this.box.w / 2 + 0.01, K.by + 0.0, zc - 0.05), V3(-this.box.w / 2 - 0.01, K.by + 0.0, zc - 0.05)];
      for (let k2 = 0; k2 < 2; k2++) { if (K.on <= 0.01) { sp.hands[k2] = null; continue; } const rest = V3(k2 ? -0.22 : 0.22, sp.pelvis.p.y - 0.12, sp.pelvis.p.z + 0.15); sp.hands[k2] = { p: rest.lerp(hold[k2], smoother(K.on)), curl: 0.6 + 0.9 * K.on, roll: (k2 ? -1 : 1) * 1.3 * K.on, free: K.on < 0.95 }; }
      if (sp.load) sp.load.p = B; };
    const rep = this.balance(spec, { load: carrying ? { kg: this.kg, p: B } : null, bias: 0.05 + 0.04 * clamp(K.drop / 0.4), update: place });
    return { frame: this.frame, spec, rep, phase: ph, therblig: { reach: 'reach', grasp: 'grasp', lift: 'transport loaded', hold: 'hold', 'set down': 'position', release: 'release', rest: 'rest' }[ph], effort: K.eff, props: { box: Poser.l2w(this.frame, B) } };
  }
}
const POSE_HANG = { ua: [0.03, 0, 0.07], fa: [-0.18, 0, 0], hn: [0.05, 0, 0], curl: 0.45 };

// ------------------------------------------------------------------ HAMMER: a two-handed sledge driving a stake
// Bernstein's blacksmiths and Muybridge plates 374-375: the blow is the whole body: the weight goes to the back foot as the sledge
// rises over the shoulder, the front hand slides up the handle to lift it and back down to the end on the downswing, the knees
// give and the trunk flexes INTO the blow, the head follows the head of the hammer. The striking face lands on the stake head
// every time (the task); knees, trunk and the top of the swing vary per blow (the null space).
export class Hammer extends Act {
  constructor(o) { super(o); const s = this.seed; this.T = o.period ?? 1.75; this.L = o.handle ?? 0.86; this.stake = o.stake || V3(0.0, 0.42, 0.74);
    this.flexS = new Spring(0, { f: 3.0, zeta: 0.6 }); this.dropS = new Spring(0, { f: 3.5, zeta: 0.7 }); this.headS = new Spring(0, { f: 2.6, zeta: 0.75 }); this.sink = 0; }
  sample(t, dt = 1 / 30) {
    const s = this.seed, k = Math.floor(t / this.T), u = loopT(t, this.T) / this.T, v = (a) => jit(s, k, a, 1);
    // the impact frame is u = 0 (and 1); keys: handle angle (deg above forward-horizontal), rear-hand point, front-hand slide, body
    const top = 138 + 6 * v(1), kd = 1 + 0.15 * v(2), kf = 1 + 0.15 * v(3), side = -0.18;   // 3 Oct: the top was 158-168 deg with the hands behind the head: shoulders past their range (client: 'an impossible pose')
    const imp = this._impact();
    const K = new Keyed([
      { t: 0.0, v: { ang: imp.ang, ex: imp.E.x, ey: imp.E.y, ez: imp.E.z, sl: 0.06, drop: 0.16 * kd, flex: 0.55 * kf, twist: 0, wt: 0.4 } },
      { t: 0.09, v: { ang: imp.ang + 9, ex: imp.E.x, ey: imp.E.y + 0.03, ez: imp.E.z, sl: 0.08, drop: 0.16 * kd, flex: 0.53 * kf, twist: 0, wt: 0.4 }, ease: 'out' },   // the rebound
      { t: 0.4, v: { ang: 55, ex: side * 0.6, ey: 1.12, ez: 0.34, sl: 0.45, drop: 0.05, flex: 0.12, twist: -0.25, wt: -0.2 }, ease: 'inout' },                 // lift: front hand slides up
      { t: 0.6, v: { ang: top, ex: side, ey: 1.5 + 0.03 * v(4), ez: 0.26, sl: 0.1, drop: 0.03, flex: -0.06, twist: -0.18, wt: -0.4 }, ease: 'out' },   // 3 Oct: hands together and in front of the shoulder at the top (the front arm went through the chest)          // the top: weight back, arched
      { t: 0.67, v: { ang: top - 8, ex: side, ey: 1.52, ez: 0.28, sl: 0.1, drop: 0.03, flex: -0.07, twist: -0.15, wt: -0.35 }, ease: 'inout' },                  // the turn-over
      { t: 0.86, v: { ang: 70, ex: side * 0.4, ey: 1.42, ez: 0.38, sl: 0.08, drop: 0.07 * kd, flex: 0.18 * kf, twist: -0.05, wt: 0.2 }, ease: 'in' },          // downswing: the slide back
      { t: 1.0, v: { ang: imp.ang, ex: imp.E.x, ey: imp.E.y, ez: imp.E.z, sl: 0.06, drop: 0.16 * kd, flex: 0.55 * kf, twist: 0, wt: 0.4 }, ease: 'in' },
    ]).sample(u);
    const a = K.ang * Math.PI / 180, dir = V3(0, Math.sin(a), Math.cos(a)), E = V3(K.ex, K.ey, K.ez), Hd = E.clone().addScaledVector(dir, this.L);
    const d = this.dims, flex = this.flexS.step(K.flex, dt), drop = this.dropS.step(K.drop, dt);
    const spec = { pelvis: { p: V3(0.02, d.hip * (1 - drop) - 0.01, -0.08 + 0.1 * K.wt), pitch: flex * 0.5, yaw: K.twist * 0.4, roll: -0.03 * K.wt },
      spine: { flex: flex * 0.5, twist: K.twist * 0.6 }, head: { pitch: this.headS.step(Math.atan2(-(Hd.y - 1.55), Math.max(0.2, Hd.z)) * 0.6 - flex * 0.3 + 0.15, dt) },
      feet: [{ p: V3(0.15, 0, 0.16), yaw: 0.1, pitch: 0, pivot: 'M' }, { p: V3(-0.17, 0, -0.26), yaw: -0.35, pitch: K.wt > 0.25 ? 0.0 : 0, pivot: 'M' }],
      hands: [{ p: E.clone().addScaledVector(dir, this.L * K.sl * 0.92 + 0.04), curl: 1.5 }, { p: E.clone(), curl: 1.55 }], arms: [null, null] };
    const rep = this.balance(spec, { load: { kg: 5, p: Hd }, bias: 0.04 * K.wt });
    if (u < 0.02 && this._lastK !== k) { this._lastK = k; this.events.push({ t, kind: 'blow', where: Poser.l2w(this.frame, this.stake), strength: 1 }); }
    const ph = u < 0.09 ? 'strike' : u < 0.6 ? 'lift' : u < 0.66 ? 'top' : 'downswing';
    return { frame: this.frame, spec, rep, phase: ph, therblig: ph === 'strike' ? 'use' : ph === 'lift' ? 'transport empty' : ph === 'top' ? 'position' : 'use', effort: ph === 'downswing' || ph === 'strike' ? 1 : 0.5,
      props: { hammer: { E: Poser.l2w(this.frame, E), H: Poser.l2w(this.frame, Hd), dir: Poser.d2l({ qi: this.frame.q }, dir) } } };
  }
  // the handle at impact: the head's face on the stake top, the handle sloping down to it from the hands at the belt
  _impact() { const a = -24 * Math.PI / 180, dir = V3(0, Math.sin(a), Math.cos(a)), H = this.stake.clone().add(V3(0, 0.06, 0)); return { ang: -24, E: H.clone().addScaledVector(dir, -this.L) }; }
}

// ------------------------------------------------------------------ CLIMB: a ladder, three points on it at all times
// Contacts as a gait: right hand, left foot, left hand, right foot (the lateral sequence most people use on a ladder); each limb
// goes up two rungs in its turn, the moving foot swings out from the rungs and back in, the pelvis rises on the stepping leg and
// sways toward the side that bears the weight; the head looks up at the next hand-hold.
export class Climb extends Act {
  constructor(o) { super(o); this.rung = o.rung ?? 0.3; this.lz = o.ladderZ ?? 0.36; this.T = o.period ?? 2.6; this.w = 0.21; this.yS = new Spring(null, { f: 2.0, zeta: 0.9 }); this.xS = new Spring(0, { f: 1.4, zeta: 0.9 }); }
  // limb order and times inside a cycle: [limb, start, end]; limbs: 0 hand L, 1 hand R, 2 foot L, 3 foot R
  _limb(t, limb, base) { const seq = { 1: [0.0, 0.2], 2: [0.22, 0.46], 0: [0.5, 0.7], 3: [0.72, 0.96] }, [a, b] = seq[limb], c = Math.floor(t / this.T), u = loopT(t, this.T) / this.T;
    const done = c * 2 + (u >= b ? 2 : 0), m = u > a && u < b ? smoother((u - a) / (b - a)) : 0; return { r: base + done + 2 * m, moving: m > 0 && m < 1, m }; }
  sample(t, dt = 1 / 30) {
    const d = this.dims, L = [0, 1, 2, 3].map(i => this._limb(t, i, i < 2 ? 5 : 1)), y = r => r * this.rung, lz = this.lz;
    const feetY = (y(L[2].r) + y(L[3].r)) / 2, wantY = Math.min(y(L[2].r), y(L[3].r)) + d.hip * 0.86 + 0.06;
    const py = this.yS.step(wantY, dt), sway = this.xS.step((L[2].moving ? -1 : L[3].moving ? 1 : 0) * 0.045 + (L[0].moving ? -0.02 : L[1].moving ? 0.02 : 0), dt);
    const out = m => Math.sin(Math.PI * m) * 0.09;
    const spec = { pelvis: { p: V3(sway, py, lz - 0.36), pitch: 0.12, yaw: 0, roll: sway * 0.6 }, spine: { flex: 0.08, bend: -sway * 0.8 },
      head: { pitch: -0.35 - 0.2 * (L[0].moving || L[1].moving ? 1 : 0), yaw: (L[0].moving ? 0.15 : L[1].moving ? -0.15 : 0) },
      feet: [2, 3].map(i => { const s = i === 2 ? 1 : -1, l = L[i]; return { p: V3(s * 0.12, y(Math.floor(l.r * 2) / 2 * 0 + l.r) + 0.0 + Math.sin(Math.PI * l.m) * 0.06, lz - 0.08 - out(l.m)), yaw: 0, pitch: l.moving ? -0.3 * Math.sin(Math.PI * l.m) : 0, pivot: 'M', planted: !l.moving }; }),
      hands: [0, 1].map(i => { const s = i === 0 ? 1 : -1, l = L[i]; return { p: V3(s * 0.17, y(l.r) + 0.02, lz - 0.02 - out(l.m) * 0.8), curl: l.moving ? 0.7 : 1.5, roll: s * 1.4, free: l.moving }; }), arms: [null, null] };
    this.poser.begin(this.Pz, null); const rep = this.poser.solve(this.Pz, spec, null);
    const mv = L.findIndex(l => l.moving);
    return { frame: this.frame, spec, rep, phase: ['hand L', 'hand R', 'foot L', 'foot R'][mv] || 'three points', therblig: mv >= 0 ? 'transport empty' : 'hold', effort: mv >= 2 ? 1 : 0.5, rise: py };
  }
}

// ------------------------------------------------------------------ LEVER: a pump/jack lever worked with the body's weight
// A long lever on a fulcrum in front: the downstroke is the work (the body drops onto straight arms, knees give, trunk over the
// hands), the upstroke is light (the arms lift it, the body rises). The lever's angle is the task; the body's split varies per stroke.
export class Lever extends Act {
  constructor(o) { super(o); this.piv = o.pivot || V3(0, 0.82, 0.95); this.len = o.len ?? 0.92; this.T = o.period ?? 1.7; this.flexS = new Spring(0, { f: 2.4, zeta: 0.7 }); this.dropS = new Spring(0, { f: 2.6, zeta: 0.75 }); }
  angle(t) { const u = loopT(t, this.T) / this.T, k = Math.floor(t / this.T), up = 0.62 + jit(this.seed, k, 1, 0.07), dn = -0.32 + jit(this.seed, k, 2, 0.05);
    // a heavy downstroke (0-0.42: slow start, then it gives), a pause at the bottom, a lighter upstroke
    return u < 0.42 ? lerp(up, dn, Math.pow(smoother(u / 0.42), 1.3)) : u < 0.5 ? dn : lerp(dn, up, smoother((u - 0.5) / 0.5)); }
  sample(t, dt = 1 / 30) {
    const d = this.dims, a = this.angle(t), u = loopT(t, this.T) / this.T, down = u < 0.42, push = down ? Math.sin(Math.PI * u / 0.42) : 0, k = Math.floor(t / this.T);
    const g = this.piv.clone().add(V3(0, Math.sin(a), -Math.cos(a)).multiplyScalar(this.len));
    const low = clamp((0.62 - a) / 0.94), flex = this.flexS.step(0.25 + 0.45 * low * (1 + jit(this.seed, k, 3, 0.12)), dt), drop = this.dropS.step(0.03 + 0.13 * low * (1 + jit(this.seed, k, 4, 0.15)), dt);
    const spec = { pelvis: { p: V3(0, d.hip * (1 - drop), -0.1 - 0.05 * low), pitch: flex * 0.5, yaw: 0, roll: 0 }, spine: { flex: flex * 0.5 }, head: { pitch: 0.25 - flex * 0.2 + 0.1 * push },
      feet: [{ p: V3(0.16, 0, 0.12), yaw: 0.12, pivot: 'M' }, { p: V3(-0.16, 0, -0.2), yaw: -0.3, pivot: 'M' }],
      hands: [{ p: g.clone().add(V3(0.2, 0.0, 0)), curl: 1.5, roll: 1.3 }, { p: g.clone().add(V3(-0.2, 0, 0)), curl: 1.5, roll: -1.3 }], arms: [null, null] };
    // the downstroke pushes down at the hands (no horizontal force); the body puts its weight over them
    const rep = this.balance(spec, { bias: 0.06 * push });
    return { frame: this.frame, spec, rep, phase: down ? 'downstroke' : u < 0.5 ? 'bottom' : 'upstroke', therblig: down ? 'use' : 'transport empty', effort: down ? 1 : 0.3, props: { lever: { pivot: Poser.l2w(this.frame, this.piv), grip: Poser.l2w(this.frame, g), a } } };
  }
}
export { Act, jit, POSE_HANG };

// ------------------------------------------------------------------ walking acts: a Walker's output with work in the hands
// PUSH a cart: the body falls forward onto the handle (lean from the push: m g d = F h, deeper while the cart is getting going),
// shorter steps, hands pinned to the handle (a world bar that moves with the cart, not with the pelvis).
export function withCart(o, frame, { handles, effort = 0.5, lean = 0.32 }) {
  const L = lean * (0.4 + 0.6 * effort), sp = o.spec;
  sp.pelvis.pitch += L * 0.6; sp.spine.flex += L * 0.55; sp.head.pitch -= L * 0.7; sp.pelvis.p.y -= 0.03 * effort;
  sp.hands = handles.map((w, k) => ({ p: Poser.w2l(frame, w), curl: 1.5, roll: (k ? -1 : 1) * 1.2 }));
  sp.arms = [null, null]; return o;
}
// WALK WITH LOAD: a box carried in front on both hands at the belly; the trunk leans back over the feet by the load's moment
export function withBox(o, { kg = 15, bodyKg = 75, box = { w: 0.46, h: 0.3, d: 0.34 } } = {}) {
  const sp = o.spec, r = kg / bodyKg, P = sp.pelvis.p;
  sp.spine.flex -= 0.03 + 0.2 * r; sp.pelvis.pitch -= 0.01 + 0.06 * r; sp.head.pitch += 0.04 + 0.14 * r;
  P.z -= 0.02 + 0.06 * r; const B = V3(P.x, P.y + 0.08, P.z + 0.33 + 0.04 * r);
  sp.hands = [V3(box.w / 2 + 0.01, 0, 0), V3(-box.w / 2 - 0.01, 0, 0)].map((o2, k) => ({ p: B.clone().add(o2).add(V3(0, 0.02, 0)), curl: 0.9, roll: (k ? -1 : 1) * 1.35 }));
  sp.arms = [null, null]; o.box = B; return o;
}

// ------------------------------------------------------------------ STOOP: bent over work at hip-to-knee height (a fender, a bench, a
// mould), legs nearly straight, the trunk hinged at the hips, the hands working: one reaches and the other steadies, they trade, the
// weight goes to the side that reaches, the head follows the working hand. The film men in Master Hands work like this.
export class Stoop extends Act {
  constructor(o) { super(o); this.work = o.work || V3(0, 0.62, 0.42); this.flexS = new Spring(null, { f: 1.6, zeta: 0.85 }); this.idle = new Idle({ seed: this.seed, exertion: 0.4, restless: 0.8 }); }
  sample(t, dt = 1 / 30) {
    const s = this.seed, d = this.dims, k = Math.floor(t / 1.4), u = loopT(t, 1.4) / 1.4, side = hash(s * 13 + k, 3) < 0.5 ? 1 : -1, id = this.idle.sample(t);
    const reach = Math.sin(Math.PI * smoother(u)) * (0.6 + 0.4 * hash(s + k, 4)), W0 = this.work;
    const hd = (sd, r) => V3(W0.x + sd * 0.16 + sd * 0.12 * r * (sd === side ? 1 : 0), W0.y + 0.01 * Math.sin(t * 7 + sd) * (sd === side ? reach : 0), W0.z + (sd === side ? 0.14 * r : -0.02));
    const flex = this.flexS.step(1.15 + 0.08 * reach + 0.04 * jit(s, k, 1, 1), dt);
    const spec = { pelvis: { p: V3(side * 0.025 * reach + id.sway[0], d.hip * 0.96, -0.12), pitch: flex * 0.6, yaw: side * 0.06 * reach, roll: -side * 0.03 * reach },
      spine: { flex: flex * 0.4 + 0.015 * id.breath, twist: side * 0.12 * reach }, head: { pitch: 0.35 + 0.1 * reach, yaw: side * 0.25 * reach + id.look * 0.3 },
      feet: [{ p: V3(0.15, 0, -0.02), yaw: 0.2, pivot: 'M' }, { p: V3(-0.15, 0, -0.06), yaw: -0.25, pivot: 'M' }],
      hands: [hd(1, reach), hd(-1, reach)].map((p, i) => ({ p, curl: (i ? -1 : 1) === side ? 0.8 : 0.5, roll: (i ? -1 : 1) * 0.4 })), arms: [null, null] };
    const rep = this.balance(spec, { bias: 0.05 });
    return { frame: this.frame, spec, rep, phase: 'work low', therblig: 'use', effort: 0.4 };
  }
}

// ------------------------------------------------------------------ DIG: a spit of earth cut, lifted and thrown (the first act that MOVES material)
// Taylor's shovelling (The Principles of Scientific Management, 1911: 21 lb a load, the tool sized to the material) and the navvy's two
// tools: the long-handled round-point shovel (it scoops: driven by the arms and a lunge) and the D-handle spade (it cuts: the boot on the
// tread, the body's weight on it); either takes either drive. One cycle, each phase a mechanism with its therblig:
//   SET (position)      the tip on the cut (the task); the hands take their grips, the boot goes up onto the tread
//   BITE (use)          the blade driven `depth` along its own axis: the foot rides the tread down (planted on the TOOL), or the arms
//                       thrust and the body lunges (the thrust's reaction at the hands puts the centre of mass ahead of the feet: m g dz = F h)
//   PRY (use)           the tool turns, the handle back and down, about the cut's edge (a cut: the fulcrum on the ground) or about the
//                       front hand (a thrust: the rear hand bears down over it); the spit breaks loose and the load is on the blade
//   LIFT, THROW (transport loaded)  ONE carry, so the load stays on the blade: its centre goes from rest at the pry's end to the release R,
//                       arriving at the release velocity v (the blade's own velocity at R IS v), its acceleration a ramp from the heave
//                       that then eases off into R; the shaft swings up about the rear hand, which rises on a path out in front of the
//                       body (dipping first: the end of a choked shaft passes under the arm), the face kept up; the front hand slides
//                       down toward the load (a long shovel lifted high is choked: both hands go up it, the end past the hip); the
//                       chest turns to the heap. 'lift' is its first part, 'throw' the rest
//   FOLLOW (release)    the blade leaves R at v and stops within 12 cm about the rear hand, the wrists rolling it over; the load flies,
//                       x(s) = R + v s + g s^2 / 2, to L
//   RETURN (transport empty) the hands lead it back, the shaft turns in and then drops round them onto the next cut from above
//   then WAIT (unavoidable delay: a late call, in the set pose) or, before the first and after the last cycle, REST
// The throw is solved, not keyed. R is placed from the body: the chest turned toward the heap, the rear hand at the front of the rear
// hip, the shaft rising across the body until the load is at the release height, at the azimuth that keeps the front hand in the lead
// arm's reach and range; out of a pit the release rises and is capped at about head height (the eyes: shoulders + 0.16 m), and in a pit
// the blade stays inside the walls (out over the wall's plane only where the line up from the cut clears the lip). v is the lob from R
// to the landing L (the heap: the task) at a launch angle drawn per cycle (steeper in a pit: a heave up and out), steepened where the
// lip must be cleared (closed form: the height over the lip is linear in tan theta; past 78 deg the release moves in from the wall) or
// where the carry could not deliver it without the blade braking under the load, and kept under 7.5 m/s by landing nearer the lip; the
// load is what the throw can carry (1/2 m v^2 <= 45 J: Taylor's 21 lb at 3 m/s), so a gravedigger in a deep hole takes smaller spits.
// In a pit nothing of the tool goes into the wall on the throw side. The body: the keys give the style (knees, trunk, the turn to the
// heap); the solve (_settle: Act.balance with the hands in it) puts the hands ON the shaft, taking what an arm cannot reach up with the
// knees and the hips (in a split drawn per cycle: Bernstein) and the chest's twist, keeps the upper arms in their range, and the centre
// of mass (body + load, + the thrust or the pry at the hands) over the feet; the load's weight, the forces and the drive foot's support
// come in and go out over time, so the pose never jumps.
//
//   const dig = new Dig({ seed, dims, sc, bodyKg, base, heading, tool: 'spade' (default) | 'roundpoint', drive: 'arms' | 'foot'
//     (default by tool), lead: 'R' | 'L' (the front, sliding hand; the throw goes to that side), pit (m: 0 = ground level, else base is
//     the pit floor), edge (m, base to the pit wall on the throw side), throwTo (local: the heap), cut (local), kg, depth, period, calls
//     (callTimes: each bite lands on its call + this digger's reaction, drawn per call), react, cycles, t0, fatigue, st (a people.js
//     figure's state, folk.get(id): the body solved on ITS proportions, as Cast.apply will; without it the hands are fitted to the
//     default body and come off the shaft by a few cm on an ANSUR-proportioned figure) })   (no cycles, or calls: [], is an error)
//   dig.sample(t) -> { frame, spec, rep, phase (set, bite, pry, lift, throw, follow, return, wait, rest), therblig, effort, k (cycle),
//     u (0..1 in it), kg (on the blade), props: { shovel: { M
//     (world Matrix4: origin at the handle's end, +y along the shaft to the blade, +z the blade's face; unit scale: the tool is
//     world-sized), tip, load (the earth's centre on the face: a people.js scene draws the load there itself while loaded), tread,
//     grips: [rear, front], slides: [rear, front] (m from the end), loaded }, clod: { p, v, kg, k } | null (the load in flight) } }
//   dig.events (up to the last sampled t), dig.eventsIn(t0, t1) (t0 < t <= t1), dig.allEvents:
//     { t, kind: 'bite' | 'release' | 'land', k, where, depth (bite) | v, landY, tf (release: m/s, the landing's height, the flight's
//     time) , kg }, all world.
//   Every cycle is planned from the seed (dig.plan(k), pure) and there are no Springs (the eyes' lag is a delayed read of the same
//   path), so sample(t) is a pure function of t (dt is not used): seekable, and a render begun part-way is exact.
//   Dig.TOOLS (SHOVELS); Dig.clods(events, t) (the throws as clods, pure in t: from the release events alone, so dig.events will do),
//   Dig.ledger(events, t) (throws, kg, m3: from the land events), Dig.heap(m3) (a cone)
// Measured (motion_test.mjs): hands on the shaft within ~25 mm, planted feet still, upper arms and elbows inside rig/limits.js; the load
// pressed onto the face through the carry (over 0.2 g) and under 2 g; the tool out of the pit's wall; a choked shaft's end off the arms,
// the head and the trunk; the pelvis never jumps between frames; the lip cleared by the planned 8 cm down to a 2.2 m pit (by a little
// less from about 2.5 m: plan(k).lob.clear). A long shovel driven with the boot is the weak case (its pry swings the hips back fast): a
// gravedigger takes the spade.
const D2R = Math.PI / 180;
const ARMLIM = LIMITS.upperarm.abd[0] + 3;                                                      // keep 3 deg inside the shoulder's adduction limit
// world metres: Ls the shaft from the handle's end to the blade's heel (the socket), bl the blade (heel to tip), bw its width, cant the
// blade's lift off the shaft's line toward its face (the blade's pitch is the shaft's minus cant: a round point lies flat with the shaft
// 19 deg down, and goes in 20 deg nose-down at the 40 deg set, the scoop), dish, r the shaft's radius,
// rear the rear hand from the end, slide the front hand [at the bite, at the lift], kg a load, depth the bite (along the blade), pry (rad)
export const SHOVELS = {
  roundpoint: { name: 'roundpoint', Ls: 1.18, bl: 0.29, bw: 0.23, cant: 0.33, dish: 0.035, r: 0.018, grip: 'end', rear: 0.05, slide: [0.42, 0.6], kg: 9.5, depth: 0.18, pry: 0.3, period: 2.2, drive: 'arms' },
  spade: { name: 'spade', Ls: 0.70, bl: 0.29, bw: 0.185, cant: 0, dish: 0.012, r: 0.017, grip: 'D', rear: 0, slide: [0.24, 0.46], kg: 7, depth: 0.22, pry: 0.3, period: 2.6, drive: 'foot' },
};
// the tool's orientation: the shaft (handle's end -> blade) at azimuth psi (from +z toward +x), phi below the horizontal; the face
// square to it and up, rolled by rho about the shaft (x = y cross z)
function toolQ(psi, phi, rho = 0) {
  const y = V3(Math.sin(psi) * Math.cos(phi), -Math.sin(phi), Math.cos(psi) * Math.cos(phi)), z = UP.clone().addScaledVector(y, -y.y).normalize();
  if (rho) z.applyAxisAngle(y, rho); return Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V3().crossVectors(y, z), y, z));
}
// the lob from R to L under g at launch angle th0, or steeper to pass over a lip (a wall at x = wallX, its top at lipY): with the
// speed fixed by the landing, the height at horizontal distance e is y(e) - R.y = e tan(th) (1 - e / d) + e^2 dy / d^2, linear in tan(th).
// The angle stays 0.1 over the line to L (else no lob reaches it) and under 78 deg unless that line is steeper; clear: the lip is passed
export function lob(R, L, th0, g, wallX = null, lipY = 0) {
  const h = V3(L.x - R.x, 0, L.z - R.z), d = h.length() || 1e-6, dy = L.y - R.y; h.multiplyScalar(1 / d); let tn = Math.tan(th0), e = -1;
  if (wallX != null && Math.abs(h.x) > 1e-3) { e = (wallX - R.x) / h.x; if (e > 0 && e < d) tn = Math.max(tn, (lipY - R.y - e * e * dy / (d * d)) / (e * (1 - e / d))); }
  const lo = dy / d + 0.1; tn = Math.min(Math.max(tn, lo), Math.max(lo, Math.tan(1.36)));
  const th = Math.atan(tn), c = Math.cos(th), sp = Math.sqrt(g * d * d / (2 * c * c * (d * tn - dy)));
  const clear = !(e > 0 && e < d) || e * tn * (1 - e / d) + e * e * dy / (d * d) >= lipY - R.y - 1e-6;
  return { v: h.clone().multiplyScalar(sp * c).setY(sp * Math.sin(th)), th, speed: sp, tf: d / (sp * c), d, clear };
}
// the loaded carry over s = 0..1 (its D seconds; s-units: metres, and metres per unit s squared): from rest, the acceleration ramps from
// a0 (the heave) to a1 by s = tau and is held at a1 to the end (tau = 1: the cubic Hermite). Solved for the displacement Dl and the
// end velocity vD: (tau/2) a0 + (tau/2 + w) a1 = vD, (tau^2/3 + tau w/2) a0 + (tau^2/6 + tau w/2 + w^2/2) a1 = Dl, w = 1 - tau
function carryProfile(tau, Dl, vD) { const w = 1 - tau, c11 = tau / 2, c12 = tau / 2 + w, c21 = tau * tau / 3 + tau * w / 2, c22 = tau * tau / 6 + tau * w / 2 + w * w / 2, det = c11 * c22 - c12 * c21;
  return { tau, a0: vD.clone().multiplyScalar(c22).addScaledVector(Dl, -c12).multiplyScalar(1 / det), a1: Dl.clone().multiplyScalar(c11).addScaledVector(vD, -c21).multiplyScalar(1 / det) }; }
// the carry's displacement from its start at s (or, acc, its acceleration)
function carryAt({ tau, a0, a1 }, s, acc = false) {
  if (acc) return s < tau ? a0.clone().lerp(a1, s / tau) : a1.clone();
  if (s <= tau) return a0.clone().multiplyScalar(s * s / 2 - s * s * s / (6 * tau)).addScaledVector(a1, s * s * s / (6 * tau));
  const g = s - tau; return a0.clone().multiplyScalar(tau * tau / 3 + tau * g / 2).addScaledVector(a1, tau * tau / 6 + tau * g / 2 + g * g / 2); }
const bez = (a, b, c, d, u) => { const v = 1 - u; return a.clone().multiplyScalar(v * v * v).addScaledVector(b, 3 * v * v * u).addScaledVector(c, 3 * v * u * u).addScaledVector(d, u * u * u); };

export class Dig extends Act {
  constructor(o) {
    super(o); const W0 = SHOVELS[o.tool || 'spade'], sc = this.sc, d = this.dims, s = this.seed, sd = this.side = (o.lead || 'R') === 'L' ? 1 : -1, j0 = (i, a) => jit(s, 0, 60 + i, a);
    this.tool = W0.name; this.drive = o.drive || W0.drive; this.kg = o.kg ?? W0.kg; this.fatigue = o.fatigue ?? 1; this.react = o.react ?? 0.16;
    this.period = o.period ?? (this.drive === 'foot' ? Math.max(W0.period, SHOVELS.spade.period) : W0.period);   // the boot's step up and down takes its time
    this.pit = o.pit || 0; this.edge = o.edge ?? 0.45;
    // the tool in this figure's local units: a shovel is the same size in a short digger's hands as in a tall one's
    this.W = { ...W0, Ls: W0.Ls / sc, bl: W0.bl / sc, bw: W0.bw / sc, dish: W0.dish / sc, r: W0.r / sc, rear: W0.rear / sc, slide: W0.slide.map(u => u / sc), depth: (o.depth ?? W0.depth) / sc };
    this.pitL = this.pit / sc; this.edgeL = this.pit ? this.edge / sc : Infinity; this.gL = 9.81 / sc; this.cap = d.shoulderH + 0.16;
    this.kLead = sd > 0 ? 0 : 1; this.idle = new Idle({ seed: s, exertion: 0.7 }); const foot = this.drive === 'foot', kl = this.kLead, ko = 1 - kl;
    // stance: the drive foot square behind the blade, the other back and turned out; for a thrust, fore and aft with the lead foot forward
    this.feet0 = []; this.yaw0 = [];
    this.feet0[kl] = foot ? V3(sd * (0.12 + j0(1, 0.015)), 0, j0(2, 0.02)) : V3(sd * (0.15 + j0(1, 0.02)), 0, 0.1 + j0(2, 0.03));
    this.feet0[ko] = V3(-sd * (0.15 + j0(3, 0.02)), 0, (foot ? -0.1 : -0.24) + j0(4, 0.03));
    this.yaw0[kl] = sd * (foot ? 0.04 : 0.12); this.yaw0[ko] = -sd * 0.32;
    // the set: the shaft's angles as the blade goes in; the cut is where the tip lands with the rear grip at home (the D in front of
    // the rear hip, leaning across to a cut before the drive foot, for a cut with the boot; the end at the rear hip for a thrust)
    this.psi0 = sd * (foot ? 0.55 : 0.3); this.phi0 = foot ? (W0.grip === 'D' ? 1.22 : 1.1) : 0.7;
    // for a cut with the boot the rear hand grips no further than 0.72 m above the blade's heel; a long shovel is set less steep and
    // choked by ch0, no more than 12 cm, so its end stands clear of the rear arm and the head (a D is never choked)
    this.ch0 = foot && W0.grip !== 'D' ? clamp(this.W.Ls - this.W.rear - 0.72, 0, 0.12 / sc) : 0;
    const home = foot ? V3(-sd * 0.2, 0, 0.25) : V3(-sd * 0.17, 0, -0.1), f0 = this._frameOf(toolQ(this.psi0, this.phi0), V3()), g0 = f0.y.clone().multiplyScalar(this.W.rear + this.ch0);
    this.cut = o.cut ? o.cut.clone() : V3(home.x + f0.tip.x - g0.x, 0, home.z + f0.tip.z - g0.z);
    // the phase table (fractions of a cycle; the bite, at B, is the cycle's clock)
    this.U0 = foot ? { B: 0.16, D: 0.32, P: 0.42, L: 0.55, R: 0.71, F: 0.78 } : { B: 0.1, D: 0.25, P: 0.33, L: 0.5, R: 0.67, F: 0.74 };
    // the schedule: free-running (each cycle its own length, longer as it tires), or each bite on a call + this digger's reaction; a
    // late call leaves a wait in the set pose, an early one shortens the cycle
    const U = this.U0, n = o.calls ? o.calls.length : (o.cycles ?? 64); this._cyc = []; let t = o.t0 ?? 0;
    if (!(n >= 1)) throw new Error('Dig: nothing to dig (calls is empty or cycles < 1)');
    for (let k = 0; k < n; k++) { const f = this.fatigue * Math.min(1, k / 40), T = this.period * (1 + 0.18 * f) * (1 + jit(s, k, 3, 0.05));
      const b = o.calls ? o.calls[k] + this.react + jit(s, k, 7, 0.05) + 0.08 * f : t + U.B * T; this._cyc.push({ s: b - U.B * T, b, T }); t = b + (1 - U.B) * T; }
    for (let k = 0; k < n; k++) { const c = this._cyc[k], nx = this._cyc[k + 1]; c.e = c.b + (1 - U.B) * c.T;
      if (nx) { c.e = clamp(nx.s, c.b + 0.6 * (1 - U.B) * c.T, c.e); nx.s = Math.min(Math.max(nx.s, c.e), nx.b - 0.3 * U.B * nx.T); c.e = Math.min(c.e, nx.s); } }
    // the heap (the landing: the task, the same every throw): the scene's, or beyond the nominal release, out of a pit past the lip
    const hr = clamp(this.pitL / 1.2), R0 = this._release(sd * (this.pitL > 0 ? 0.5 : 0.7), Math.min(this.cap, d.hip + 0.12 + 0.6 * this.pitL), this._choke(hr)).R;
    this.heap = o.throwTo ? o.throwTo.clone() : this.pitL > 0 ? V3(sd * (Math.max(this.edgeL, sd * R0.x) + 0.55 / sc), this.pitL, R0.z) : V3(R0.x + sd * 0.95 / sc, 0, R0.z + 0.15 / sc);
    this._plans = []; this.allEvents = []; for (let k = 0; k < n; k++) this.allEvents.push(...this.plan(k).events); this.allEvents.sort((a, b) => a.t - b.t);
  }
  // the tool's points for an orientation q and the handle's end O (local): the socket S, the tip, the load's centre on the face, the tread
  _frameOf(q, O) { const W = this.W, x = V3(1, 0, 0).applyQuaternion(q), y = V3(0, 1, 0).applyQuaternion(q), z = V3(0, 0, 1).applyQuaternion(q);
    const b = y.clone().multiplyScalar(Math.cos(W.cant)).addScaledVector(z, Math.sin(W.cant)), S = O.clone().addScaledVector(y, W.Ls);
    return { q, O, x, y, z, b, S, tip: S.clone().addScaledVector(b, W.bl), load: S.clone().addScaledVector(b, W.bl * 0.5).addScaledVector(z, W.dish + 0.04 / this.sc), tread: S.clone().addScaledVector(x, -this.side * 0.05 / this.sc) }; }
  // the handle's end that puts the tool's point `key` at p
  _place(q, key, p) { return p.clone().sub(this._frameOf(q, V3())[key]); }
  // the tool held at its rear grip G (rr from the handle's end) with the load's centre at p: the shaft through G aimed so the load is on
  // the line G -> p (the face up, its offset from the shaft putting the load delta above the shaft's line), then rolled by rho about the
  // shaft (G stays on it). -> { q, O }
  _aim(G, p, rr, rho = 0) { const W = this.W, A = W.Ls - rr + 0.5 * W.bl * Math.cos(W.cant), B = 0.5 * W.bl * Math.sin(W.cant) + W.dish + 0.04 / this.sc, d = p.clone().sub(G).normalize();
    const psi = Math.atan2(d.x, d.z), phi = Math.atan2(B, A) - Math.asin(clamp(d.y, -1, 1)), q0 = toolQ(psi, phi); return { q: rho ? toolQ(psi, phi, rho) : q0, O: this._place(q0, 'load', p), a: [psi, phi, rho] }; }
  // a long shovel lifted high is choked: both hands up the shaft until the load is no further from the rear hand than a body can hold it
  // (1.4 m at the belt, 0.8 m at the head: hr, the pit's depth); a D-handle is never choked
  _choke(hr) { const W = this.W; return W.grip === 'D' ? 0 : Math.max(this.ch0, W.Ls - W.rear + 0.5 * W.bl - lerp(1.4, 0.8, hr)); }
  // the release, placed from the body: the chest turned toward the heap by psiC, the rear hand at the front of the rear hip (where an
  // arm hangs; a little higher out of a pit), the shaft rising from it across the body toward the throw (al off the chest's line) until
  // the load is at Ry; al is picked so the front hand, where it slid to, is in the lead arm's reach and not pulled across the chest.
  // A long shovel lifted high is choked by ch (_choke), the end past the rear hip. In a pit the blade stays inside the walls (the load m
  // from the wall, the tip 5 cm) unless the line up from the cut passes the wall's plane over the lip: the body turns less, then the
  // shaft swings in.
  _release(psiC, Ry, ch, m = 0.12 / this.sc) {
    const d = this.dims, W = this.W, sd = this.side, sc = this.sc, hr = clamp(this.pitL / 1.2), Hr = V3(-sd * 0.17, d.hip - 0.06 + 0.12 * hr, 0.1 + 0.05 * hr);
    const reach = d.ua + d.fa + 0.03, Sl = V3(sd * 0.185, d.shoulderH - 0.04, 0.06);
    const rel = (psi, al, el) => { const q = toolQ(psi + al, -el), y = V3(0, 1, 0).applyQuaternion(q), O = Hr.clone().applyAxisAngle(UP, psi).addScaledVector(y, -W.rear - ch), Fh = O.clone().addScaledVector(y, W.slide[1] + ch);
      return { q, O, R: this._frameOf(q, O).load, psi, al, el, over: Fh.distanceTo(Sl.clone().applyAxisAngle(UP, psi)) - reach, across: 0.185 - sd * Fh.applyAxisAngle(UP, -psi).x }; };
    const aim = (psi, al) => { let lo = -0.5, hi = 1.45; for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (rel(psi, al, m).R.y < Ry) lo = m; else hi = m; } return rel(psi, al, (lo + hi) / 2); };
    const pick = psi => { let b = null; for (let a = 0.2; a < 1.05; a += 0.1) { const c = aim(psi, sd * a), s2 = Math.max(0, c.over) * 4 + Math.max(0, c.across - 0.1) * 2 + Math.abs(a - 0.55) * 0.2; if (!b || s2 < b.s) { b = c; b.s = s2; } } return b; };
    const into = (p, m2) => { const x = sd * p.x, c = sd * this.cut.x; if (x <= this.edgeL - m2) return false; return this.cut.y + (p.y - this.cut.y) * (this.edgeL - m2 - c) / Math.max(1e-3, x - c) < this.pitL + 0.1 / sc; };
    const out = r => this.pitL > 0 && (into(r.R, m) || into(this._frameOf(r.q, r.O).tip, 0.05 / sc));
    let r = pick(psiC);
    for (let i = 0; i < 24 && out(r); i++) { if (Math.abs(psiC) > 0.15) { psiC *= 0.85; r = pick(psiC); } else r = aim(psiC, r.al * 0.85); }
    return r;
  }
  // cycle k, planned once from the seed: its clock, the set, the bite, the pry, the release and the lob, the load, the null-space draws
  plan(k) {
    if (this._plans[k]) return this._plans[k];
    const s = this.seed, c = this._cyc[k], f = this.fatigue * Math.min(1, k / 40), sd = this.side, d = this.dims, W = this.W, sc = this.sc, J = (i, a) => jit(s, k, 20 + i, a), U0 = this.U0;
    const U = { B: U0.B, D: U0.D + J(1, 0.012), P: U0.P + J(2, 0.012), L: U0.L + J(3, 0.015), R: U0.R + J(4, 0.012), F: U0.F + J(5, 0.012) };
    const tOf = u => u < U.B ? c.s + (c.b - c.s) * u / U.B : c.b + (c.e - c.b) * (u - U.B) / (1 - U.B);
    // SET, BITE: the tip on the cut (the task); the shaft's angle and how deep the blade goes are this cycle's own (shallower tired)
    const psiS = this.psi0 + J(6, 0.04), phiS = this.phi0 + J(7, 0.04), qS = toolQ(psiS, phiS), fS = this._frameOf(qS, V3()), OS = this.cut.clone().sub(fS.tip);
    const depth = W.depth * (1 - 0.25 * f) * (1 + J(8, 0.12)), OD = OS.clone().addScaledVector(fS.b, depth);
    // PRY: the tool turns, the handle back and down, about the cut's edge (a cut: the fulcrum on the ground) or about the front hand
    // (a thrust: the rear hand bears down over it and the scoop comes up)
    // (about the cut the rear hand travels the handle's lever times the angle: a long handle turns less for the same pull, as the spade's)
    const pry = W.pry * (1 + J(9, 0.15)) * (1 - 0.15 * f) * (this.drive === 'foot' ? Math.min(1, 0.95 / sc / (W.Ls - W.rear - this.ch0 + W.bl * Math.cos(W.cant))) : 1), ax = V3(Math.cos(psiS), 0, -Math.sin(psiS)), qr = Q().setFromAxisAngle(ax, -pry);
    const piv = this.drive === 'foot' ? this.cut.clone() : OD.clone().addScaledVector(fS.y, W.slide[0] + this.ch0);
    const qP = qr.clone().multiply(qS), OP = piv.clone().add(OD.clone().sub(piv).applyQuaternion(qr)), Lp = this._frameOf(qP, OP).load;
    // RELEASE, placed from the body (_release); out of a pit higher, and the long shovel choked (ch). The landing (the task) and the lob
    // to it over the lip: nearer the lip if it would take more than 7.5 m/s; a load that would not clear the lip even at 78 deg is
    // released further from the wall (up to 0.55 m in)
    const hr = clamp(this.pitL / 1.2), Ry = Math.min(this.cap, d.hip + 0.12 + 0.6 * this.pitL - 0.04 * f + J(10, 0.03)), psiC = sd * (this.pitL > 0 ? 0.5 : 0.7) * (1 + J(11, 0.12));
    const ch = this._choke(hr), wall = this.pitL > 0 ? sd * this.edgeL : null, lipY = this.pitL + 0.08 / sc;
    const toss = (R, th) => { const L = this.heap.clone(); let lb = lob(R, L, th, this.gL, wall, lipY);
      for (let i = 0; i < 24 && lb.speed * sc > 7.5; i++) { L.x = lerp(R.x, L.x, 0.92); L.z = lerp(R.z, L.z, 0.92); if (wall != null && Math.abs(L.x) < this.edgeL + 0.2 / sc) L.x = sd * (this.edgeL + 0.2 / sc); lb = lob(R, L, th, this.gL, wall, lipY); }
      return { L, lb }; };
    let th = (40 + 22 * hr + J(12, 6)) * D2R, r, tl;                                                  // a pit's throw is steeper: a heave up and out
    for (const m of [0.12, 0.25, 0.4, 0.55]) { r = this._release(psiC, Ry, ch, m / sc); tl = toss(r.R, th); if (tl.lb.clear) break; }
    const R = r.R, qR = r.q;
    // LIFT and THROW are one motion, so the load stays ON the blade: its centre goes from rest at Lp (the pry's end) to R in D seconds,
    // arriving at v (the blade's own velocity at R IS the release velocity), on a carry whose acceleration ramps down from the heave and
    // then eases off into R (carryProfile), so the blade never brakes out from under the load before R (motion_test: the face's push on
    // the load stays over 0.2 g and the load under 2 g). The shaft swings up about the rear hand (Hs: from its grip at the pry's end to
    // its grip at R, out in front of the body), aimed through it at the load with the face kept up (_aim): the blade comes level as the
    // load passes the hands. The ramp's length is picked per cycle (from the cubic down to a short heave) for the face's push furthest
    // over 0.3 g and the load under 1.9 g; where none will do, the toss is steepened (a harder heave and an easier carry: the load goes
    // on rising off the blade instead of the blade braking under it)
    const tP = tOf(U.P), tR = tOf(U.R), D = tR - tP, Df = tOf(U.F) - tR, Dl = R.clone().sub(Lp), cn = Math.cos(W.cant), sn = Math.sin(W.cant);
    const HP = OP.clone().addScaledVector(this._frameOf(qP, V3()).y, W.rear + this.ch0), HR = r.O.clone().addScaledVector(this._frameOf(qR, V3()).y, W.rear + ch), Hf = V3(0, -0.16 / sc, 0.12 / sc);
    const Hs = { HP, HR, Hf, ch }, nAt = (s, p) => { const H = this._hand(Hs, s), F = this._frameOf(this._aim(H, p, this._grip(H, p, ch)).q, V3()); return F.z.multiplyScalar(cn).addScaledVector(F.y, -sn); };
    const carry = v => { let T = null; for (const tau of [1, 0.8, 0.65, 0.5, 0.4, 0.3]) { const T2 = carryProfile(tau, Dl, v.clone().multiplyScalar(D)); let nm = 9, am = 0;
      for (let i = 0; i <= 16; i++) { const s = i / 16, a = carryAt(T2, s, true).multiplyScalar(1 / (D * D)); am = Math.max(am, a.length() / this.gL); a.y += this.gL; nm = Math.min(nm, a.dot(nAt(s, Lp.clone().add(carryAt(T2, s)))) / this.gL); }
      T2.N = nm; T2.amax = am; T2.score = Math.min(nm - 0.3, 1.9 - am); if (!T || T2.score > T.score) T = T2; } return T; };
    let T = carry(tl.lb.v); for (let i = 0; i < 5 && T.N < 0.3 && th < 1.25; i++) { th += 0.1; const t2 = toss(R, th), T2 = carry(t2.lb.v); if (T2.score > T.score) { tl = t2; T = T2; } }
    const { L, lb } = tl, v = lb.v, vh = v.clone().normalize(), kg = Math.min(this.kg * (1 - 0.15 * f) * (1 + J(13, 0.08)), 2 * 45 * (1 - 0.2 * f) / (lb.speed * sc) ** 2);
    // the follow-through leaves R at v and stops within 12 cm (less where the wall is nearer: sF), rolling the face over toward the throw
    // (z turns toward v when the roll has the sign of x . v)
    const room = this.pitL > 0 ? (this.edgeL - 0.1 / sc - sd * R.x) / Math.max(0.05, sd * vh.x) : 9;
    const sF = clamp(Math.min(0.12 / sc, room), 0.02 / sc, lb.speed * Df / 2), nF = lb.speed * Df / sF, Fp = R.clone().addScaledVector(vh, sF);
    const xR = this._frameOf(qR, V3()).x, rhoF = 1.1 * (Math.sign(xR.x * vh.x + xR.z * vh.z) || 1), { q: qF, O: OF, a: aF } = this._aim(HR, Fp, W.rear + ch, rhoF), fF = this._frameOf(qF, V3());
    const l2w = p => Poser.l2w(this.frame, p), d2w = p => p.clone().applyQuaternion(this.frame.q).multiplyScalar(sc);
    const events = [{ t: c.b, kind: 'bite', k, where: l2w(this.cut), depth: depth * sc, kg }, { t: tR, kind: 'release', k, where: l2w(R), v: d2w(v), landY: l2w(L).y, tf: lb.tf, kg }, { t: tR + lb.tf, kind: 'land', k, where: l2w(L), kg }];
    return (this._plans[k] = { k, c, U, tOf, f, psiS, phiS, qS, fS, OS, LS: OS.clone().add(fS.load), depth, OD, ax, piv, pry, qP, OP, Lp, psiC: r.psi, el: r.el, R, qR, L, lob: lb, v, vh, kg, D, T, Hs, sF, nF, rhoF, Fp, qF, OF, aF, yF: fF.y,
      ch, split: 0.5 + J(14, 0.18), lean: 1 + J(15, 0.1), knee: 1 + J(16, 0.15), events, tBite: c.b, tRel: tR, tLand: tR + lb.tf });
  }
  // which cycle, and where in it (u in [0, 1), the bite pinned at U.B to the cycle's clock); before the first, between calls and after
  // the last the digger waits in the set pose
  // (a wait also says how long it has lasted and how long it has left: still, its breath fades in and out)
  _find(t) { const C = this._cyc; if (!C.length || t < C[0].s) return { k: 0, u: 0, wait: 'rest', since: 9, until: C.length ? C[0].s - t : 9 };
    let lo = 0, hi = C.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (C[m].s <= t) lo = m; else hi = m - 1; }
    const c = C[lo]; if (t >= c.e) return lo + 1 < C.length ? { k: lo + 1, u: 0, wait: 'wait', since: t - c.e, until: C[lo + 1].s - t } : { k: lo, u: 0, wait: 'rest', since: t - c.e, until: 9 };
    const U = this.plan(lo).U; return { k: lo, u: t < c.b ? U.B * (t - c.s) / (c.b - c.s) : U.B + (1 - U.B) * (t - c.b) / (c.e - c.b) }; }
  // the carry's rear hand: from its grip at the pry's end to its grip at the release on a path bulging out in front of the body and
  // dipping first (a choked shaft's end then passes under the rear arm, not up through it); outside the carry, how far down the shaft
  // the rear hand is at u (_rr: ch0 to the pry, ch in the follow, back to ch0 over the return)
  _hand(H, s) { const a = smoother(s); return bez(H.HP, H.HP.clone().lerp(H.HR, 0.33).add(H.Hf), H.HP.clone().lerp(H.HR, 0.67).add(H.Hf), H.HR, a); }
  // in the carry the rear hand slides on a long shovel's shaft to where the path puts it (the choke, between ch0 and ch: the load at its
  // distance from the hand); a D-handle cannot slide, the hand stays on the D and only the shaft's line goes through H
  _grip(H, p, ch) { const W = this.W, B = 0.5 * W.bl * Math.sin(W.cant) + W.dish + 0.04 / this.sc, A = Math.sqrt(Math.max(0, p.distanceToSquared(H) - B * B));
    return clamp(W.Ls + 0.5 * W.bl * Math.cos(W.cant) - A, W.rear + Math.min(this.ch0, ch), W.rear + Math.max(this.ch0, ch)); }
  _rr(U, ch, u) { const cs = u < U.P ? 0 : u < U.F ? ease(U.P, lerp(U.P, U.L, 0.7), u) : 1 - ease(U.F, 1, u); return this.W.rear + lerp(this.ch0, ch, cs); }
  // the tool at (k, u): local frame and points, the phase, loaded, the hands' places on the shaft: the front hand slides down it as the
  // load comes in through the carry and back for the bite (sl), and a choke (both hands, from ch0 at the bite to ch at the release: _grip
  // in the carry, _rr elsewhere)
  _tool(k, u) {
    const P = this.plan(k), N = this.plan(Math.min(k + 1, this._cyc.length - 1)), U = P.U, sc = this.sc, W = this.W; let q, O, ph, loaded = false;
    const sl = u < U.P ? 0 : u < U.F ? ease(lerp(U.P, U.R, 0.35), lerp(U.P, U.R, 0.85), u) : 1 - ease(U.F, 1, u); let rear = this._rr(U, P.ch, u);
    if (u < U.B) { q = P.qS; O = P.OS; ph = 'set'; }
    else if (u < U.D) { q = P.qS; O = P.OS.clone().addScaledVector(P.fS.b, P.depth * smoother((u - U.B) / (U.D - U.B))); ph = 'bite'; }
    else if (u < U.P) { const qr = Q().setFromAxisAngle(P.ax, -P.pry * ease(U.D, U.P, u)); q = qr.clone().multiply(P.qS); O = P.piv.clone().add(P.OD.clone().sub(P.piv).applyQuaternion(qr)); ph = 'pry'; loaded = true; }
    else if (u < U.R) { const a = (u - U.P) / (U.R - U.P);                                                             // up out of the cut and on to R: one carry, the
      const H = this._hand(P.Hs, a), p = P.Lp.clone().add(carryAt(P.T, a)); rear = this._grip(H, p, P.ch);                // shaft swung up about the rear hand
      ({ q, O } = this._aim(H, p, rear)); ph = u < U.L ? 'lift' : 'throw'; loaded = true; }
    else if (u < U.F) { const a = (u - U.R) / (U.F - U.R);                                                             // the load gone, the blade stops about the rear hand
      ({ q, O } = this._aim(P.Hs.HR, P.R.clone().addScaledVector(P.vh, P.sF * (1 - Math.pow(1 - a, P.nF))), rear, P.rhoF * smoother(a))); ph = 'follow'; }   // and rolls over
    else { const a = smoother((u - U.F) / (1 - U.F)), b = (u - U.F) / (1 - U.F);                                         // empty: the hands lead it back (the rear hand's path bulges
      q = toolQ(lerp(P.aF[0], P.aF[0] + wrapA(N.psiS - P.aF[0]), ease(0, 0.6, b)), lerp(P.aF[1], N.phiS, ease(0.25, 1, b)), P.aF[2] * (1 - ease(0, 0.5, b)));   // the shaft turns in before it drops
      const A = P.OF.clone().addScaledVector(P.yF, W.rear + P.ch), B = N.OS.clone().addScaledVector(N.fS.y, W.rear + this.ch0), f = V3(0, 0, 0.12 / sc);   // out in front), the blade swings down round them
      O = bez(A, A.clone().lerp(B, 0.33).add(f), A.clone().lerp(B, 0.67).add(f), B, a).addScaledVector(V3(0, 1, 0).applyQuaternion(q), -rear);
      const tip = this._frameOf(q, O).tip; if (tip.y < 0) O.y -= tip.y; ph = 'return'; }                        // and the tip comes onto the cut from above
    // in a pit nothing of the tool goes into the wall on the throw side: from the carry on, the blade is moved off it (x only)
    if (this.pitL > 0 && u >= U.P) { const F0 = this._frameOf(q, O), lim = y => this.edgeL - 0.03 / this.sc + 4 * Math.max(0, y - this.pitL + 0.02 / this.sc);
      const e = Math.max(...['tip', 'load', 'S', 'O'].map(n => this.side * F0[n].x - lim(F0[n].y))); if (e > 0) O = O.clone().setX(O.x - this.side * e); }
    const F = this._frameOf(q, O); F.phase = ph; F.loaded = loaded; F.rear = rear; F.slide = lerp(W.slide[0], W.slide[1], sl) + rear - W.rear;
    return F;
  }
  // the drive foot of a cut with the boot: up onto the tread before the bite, down with it (planted on the TOOL), back to its place
  _foot(P, u, F) { const kl = this.kLead, home = this.feet0[kl], yaw = this.yaw0[kl], U = P.U, a0 = U.B - 0.11, a1 = U.D + 0.14;
    const sw = (A, B, a) => A.clone().lerp(B, smoother(a)).add(V3(0, 0.07 / this.sc * Math.sin(Math.PI * a), 0));
    if (this.drive !== 'foot' || u < a0 || u >= a1) return { p: home.clone(), yaw, pitch: 0, pivot: 'M' };
    // (reach: how much the leg must still reach its target, so the hips do not jump as a foot leaves the ground or lands)
    if (u < U.B) { const a = (u - a0) / (U.B - a0); return { p: sw(home, P.OS.clone().add(P.fS.tread), a), yaw: lerp(yaw, 0, a), pitch: -0.3 * Math.sin(Math.PI * a), pivot: 'M', planted: false, swing: a, reach: smoother(1 - a / 0.3) + smoother((a - 0.7) / 0.3) }; }
    if (u < U.D) return { p: F.tread.clone(), yaw: 0, pitch: 0, pivot: 'M', onTool: true };
    const a = (u - U.D) / (a1 - U.D); return { p: sw(P.OD.clone().add(P.fS.tread), home, a), yaw: lerp(0, yaw, a), pitch: -0.3 * Math.sin(Math.PI * a), pivot: 'M', planted: false, swing: a, reach: smoother(1 - a / 0.3) + smoother((a - 0.7) / 0.3) };
  }
  // where the eyes are: the cut, the load as it comes up, the heap before the throw (the eyes lead it), the cut again
  _gaze(k, u) { const P = this.plan(k), U = P.U, toL = ease(U.L - 0.12, U.L - 0.02, u) * (1 - ease(U.F, U.F + 0.12, u)), toLoad = ease(U.D, U.P, u) * (1 - ease(U.L - 0.12, U.L - 0.02, u));
    const g = this.cut.clone(); if (toLoad > 0) g.lerp(this._tool(k, u).load, toLoad); if (toL > 0) g.lerp(P.L, toL); return g; }
  sample(t, dt = 1 / 30) {
    const at = this._find(t), k = at.k, u = at.u, P = this.plan(k), U = P.U, d = this.dims, sc = this.sc, W = this.W, id = this.idle.sample(t);
    const F = this._tool(k, u), foot = this.drive === 'foot', hr = clamp(this.pitL / 1.2), kl = this.kLead, ko = 1 - kl;
    // keys (the style; the solve moves the knees, hips and chest until the hands are on the shaft): knee drop (fraction of the hip
    // height), trunk flex, the turn toward the heap (fraction of psiC), the centre of mass ahead of the feet (m). Out of a pit the throw
    // stands up straight under the raised load.
    const rows = foot ? [[0, 0.04, 0.45, 0, 0], [U.B, 0.01, 0.38, 0, 0.03], [U.D, 0.06, 0.45, 0, 0.04], [U.P, 0.1, 0.62, -0.1, 0.02], [U.L, 0.12, 0.5, 0.3, 0], [U.R, 0.03, 0.2 - 0.25 * hr, 1, 0], [U.F, 0.04, 0.24 - 0.2 * hr, 1.05, 0], [1, 0.04, 0.45, 0, 0]]
      : [[0, 0.12, 0.72, 0, 0], [U.B, 0.14, 0.76, 0, -0.02], [U.D, 0.12, 0.7, 0, 0.04], [U.P, 0.15, 0.76, -0.1, 0.02], [U.L, 0.12, 0.55, 0.3, 0], [U.R, 0.04, 0.25 - 0.25 * hr, 1, 0], [U.F, 0.05, 0.3 - 0.2 * hr, 1.05, 0], [1, 0.12, 0.72, 0, 0]];
    const K = new Keyed(rows.map(r => ({ t: r[0], v: { drop: r[1], flex: r[2], turn: r[3], bias: r[4] } }))).sample(u);
    // this cycle's own knees and trunk (zero at the cycle's ends, so cycles join), the slump of fatigue (continuous in t)
    const bump = Math.sin(Math.PI * u), fc = this.fatigue * Math.min(1, (k + u) / 40), drop = K.drop * (1 + (P.knee - 1) * bump) + 0.02 * fc, turn = K.turn * P.psiC;
    const fl = K.flex * (1 + (P.lean - 1) * bump) + 0.06 * fc + (at.wait ? 0.02 * id.breath * sstep(0, 0.25, at.since) * sstep(0, 0.25, at.until) : 0);
    const spec = { pelvis: { p: V3(id.sway[0], d.hip * (1 - drop), -0.03 + id.sway[1]), pitch: 0, yaw: turn * 0.3, roll: 0 }, spine: { flex: 0, twist: turn * 0.7, bend: 0 }, head: {},
      feet: [null, null], hands: [null, null], arms: [null, null] };
    spec.feet[ko] = { p: this.feet0[ko].clone(), yaw: this.yaw0[ko], pitch: 0, pivot: 'M' }; spec.feet[kl] = this._foot(P, u, F);
    // hands ON the shaft: the rear on the end (or the D), the front where it slides to
    spec.hands[ko] = { p: F.O.clone().addScaledVector(F.y, F.rear), curl: 1.5 }; spec.hands[kl] = { p: F.O.clone().addScaledVector(F.y, F.slide), curl: 1.45 };
    // a long shovel choked in the lift (the arms' drive) stands its end out past the rear hand: that elbow goes out to the side (the IK's
    // elbow hint, from the usual out, down and back, turned with the chest), so the end passes under the arm, not through it
    { const ch = foot ? 0 : clamp((F.rear - W.rear - 0.06 / sc) / (0.2 / sc)); if (ch > 0) { const s = ko ? -1 : 1; spec.hands[ko].pole = V3(s * 0.55, -1, -0.5).lerp(V3(s, -0.15, 0.3), ch).applyAxisAngle(UP, turn); } }
    // the head on the gaze, read 0.1 s late (the eyes lead and the head follows: a delayed read, not a spring)
    { const g = this._gaze(k, Math.max(0, u - 0.1 / Math.max(0.5, P.c.T))), eye = V3(spec.pelvis.p.x, spec.pelvis.p.y + 0.66 * Math.cos(fl), spec.pelvis.p.z + 0.66 * Math.sin(fl)), to = g.sub(eye);
      spec.head = { pitch: clamp(Math.atan2(-to.y, Math.hypot(to.x, to.z)) - fl, -0.6, 0.85), yaw: clamp(Math.atan2(to.x, to.z) - turn, -0.9, 0.9) }; }
    // the load on the blade; at the hands, the thrust's reaction (pushing the hands back: the body leans into it) and the pry's pull
    // (its weight comes into the balance from the bite's end, the body setting itself before the spit breaks loose, to early in the lift,
    // and goes out of it over the follow and the first of the return, held where it left: the body takes a moment to feel it gone, and
    // the pose does not jump)
    const wl = u < U.R ? ease(lerp(U.B, U.D, 0.6), lerp(U.P, U.R, 0.25), u) : 1 - ease(U.R, lerp(U.R, 1, 0.6), u);
    const load = wl > 0 ? { kg: P.kg * wl, p: u < U.R ? F.load.clone() : P.R.clone() } : null, bh = P.fS.b.clone().setY(0).normalize();
    // (the pry's pull goes on into the lift as the spit tears free: the body leans back into it over a third of a second, not a flick)
    const uP = lerp(U.P, U.R, 0.3), Fh = !foot && F.phase === 'bite' ? bh.multiplyScalar(-90 * Math.sin(Math.PI * clamp((u - U.B) / (U.D - U.B))) ** 2) : u >= U.D && u < uP ? bh.multiplyScalar(60 * Math.sin(Math.PI * (u - U.D) / (uP - U.D)) ** 2) : null;
    // where the drive foot bears: the body goes over the tread from just before the step up to well into the bite, and back over its
    // own feet from late in the bite to after the boot is home, in good time and not with the foot; while a foot is in the air the weight
    // leans a little more over the other (the steps are quick)
    const a0 = U.B - 0.11, a1 = U.D + 0.14, sw = spec.feet[kl].swing, wt = foot ? ease(a0 - 0.05, lerp(U.B, U.D, 0.3), u) - ease(lerp(U.B, U.D, 0.7), a1 + 0.06, u) : 0;
    const rep = this._settle(spec, { load, F: Fh, hF: 0.8, bias: K.bias, split: lerp(0.5, P.split, bump), fl, sup: this.feet0[kl].clone().lerp(P.OS.clone().add(P.fS.tread), wt), single: sw != null ? 0.3 * Math.sin(Math.PI * sw) ** 2 : 0, stance: ko });
    const ph = at.wait || F.phase, eff = { set: 0.25, bite: 1, pry: 0.9, lift: 0.8, throw: 1, follow: 0.4, return: 0.2, wait: 0.1, rest: 0 }[ph];
    const TH = { set: 'position', bite: 'use', pry: 'use', lift: 'transport loaded', throw: 'transport loaded', follow: 'release', return: 'transport empty', wait: 'unavoidable delay', rest: 'rest' };
    // props, world: the shovel's transform and points, the load in flight (the lob, closed form)
    const l2w = p => Poser.l2w(this.frame, p), d2w = v => v.clone().applyQuaternion(this.frame.q);
    const M = new THREE.Matrix4().makeBasis(d2w(F.x), d2w(F.y), d2w(F.z)).setPosition(l2w(F.O));
    let clod = null; for (const kk of [k, k - 1]) { const Q2 = kk >= 0 && this.plan(kk); if (!Q2 || t < Q2.tRel || t >= Q2.tLand) continue; const s2 = t - Q2.tRel, p = Q2.R.clone().addScaledVector(Q2.v, s2); p.y -= 0.5 * this.gL * s2 * s2;
      clod = { p: l2w(p), v: d2w(Q2.v.clone().setY(Q2.v.y - this.gL * s2)).multiplyScalar(sc), kg: Q2.kg, k: kk }; }
    this.events = this.eventsIn(-Infinity, t);
    return { frame: this.frame, spec, rep, phase: ph, therblig: TH[ph], effort: eff, k, u, kg: F.loaded ? P.kg : 0,
      props: { shovel: { M, tip: l2w(F.tip), load: l2w(F.load), tread: l2w(F.tread), grips: [l2w(spec.hands[ko].p), l2w(spec.hands[kl].p)], slides: [F.rear * sc, F.slide * sc], loaded: F.loaded }, clod } };
  }
  eventsIn(t0, t1) { const out = []; for (const e of this.allEvents) { if (e.t > t1) break; if (e.t > t0) out.push(e); } return out; }
  // Act.balance with the hands in it: the COM (body + load, + the moment of a force F at the hands at height hF) over the feet + bias
  // (sup: where the other foot bears, if not where it stands; over the stance foot by `single` while the other steps), each held hand
  // ON its grip and each planted foot in its leg's reach (a stepping foot's by its `reach`).
  // What an arm cannot reach is taken up by the body: the shoulder moves along the line to its grip by what the arm missed (out when
  // the grip is too close to fold to, in when too far), up and down by the knees (split) and the hips (the rest), forward and back by
  // the hips, round by the chest's twist (least squares on the shoulders about the pelvis); a foot out of reach bends the knees; an
  // upper arm pulled across the chest past its range (rig/limits.js: adduction 30 deg) turns the chest toward that hand.
  // Steps are limited and there are always 12 of them (no early exit, no best-of): the same t always settles the same way, and a t a
  // moment later settles a moment's change away (no pops).
  _settle(spec, { load = null, F = null, hF = 1, bias = 0, split = 0.5, fl = 0.3, sup = null, single = 0, stance = 0 } = {}) {
    const P = this.poser, d = this.dims, m = this.bodyKg + (load ? load.kg : 0), tr = d.shoulderH - d.hip, pv = spec.pelvis; let rep = null, tw = spec.spine.twist;
    spec.bodyKg = this.bodyKg; if (load) spec.load = load;
    const C = spec.feet[stance].p.clone().add(sup || spec.feet[1 - stance].p).multiplyScalar(0.5).lerp(spec.feet[stance].p, single);
    const set = () => { pv.pitch = fl * 0.55; spec.spine.flex = fl * 0.45; spec.spine.twist = tw; P.begin(this.Pz, this.st || null); return (rep = P.solve(this.Pz, spec, null)); };
    for (let it = 0; it < 12; it++) {
      set();
      const ez = C.z + bias + (F ? -F.z * hF / (m * 9.81) : 0) - rep.com.z, ex = single * (C.x - rep.com.x), E = V3(); let tq = 0, rr = 0, miss = 0, fm = 0;
      spec.hands.forEach((h, k) => { const r = rep.hands[k]; if (!h || h.free || !r) return; const S = rep.joints[k ? 'shR' : 'shL'], rt = h.p.clone().sub(S), dt = rt.length() || 1e-6, e = rt.multiplyScalar((dt - r.grip.distanceTo(S)) / dt);
        miss = Math.max(miss, r.missMm / 1000); E.add(e); const rx = S.x - pv.p.x, rz = S.z - pv.p.z; tq += rz * e.x - rx * e.z; rr += rx * rx + rz * rz; });
      spec.feet.forEach((f, k) => { if (f && rep.feet[k]) fm = Math.max(fm, (f.planted !== false ? 1 : f.reach || 0) * rep.feet[k].missMm / 1000); });
      let ad = 0; for (const k of [0, 1]) { const x = Math.max(0, ARMLIM - measureLocal(P.F.ql[k ? 9 : 5], 'upperarm', k ? -1 : 1).abd) * D2R; ad += (k ? 1 : -1) * x; tq += (k ? 1 : -1) * x * 0.6 * rr; }
      if (it === 11) break;
      const yw = pv.yaw + tw, wv = V3(Math.sin(yw) * Math.cos(fl), -Math.sin(fl), Math.cos(yw) * Math.cos(fl)), lim = (x, a) => clamp(x, -a, a);   // wv: where the shoulders go as the hips flex
      pv.p.z += lim(ez * 0.85, 0.08); pv.p.x += lim(ex * 0.85, 0.05); pv.p.y = clamp(pv.p.y + lim(E.y * split * 0.7 - fm * 2 - 0.003 * clamp(fm / 4e-4), 0.06), d.hip * 0.55, d.hip - 0.004);
      fl = clamp(fl + lim(E.clone().setY(E.y * (1 - split)).dot(wv) / tr * 0.7, 0.15), -0.25, 1.45); tw = clamp(tw + lim((rr > 1e-4 ? tq / rr : 0) * 0.7, 0.15), -0.9, 0.9);
    }
    return rep;
  }
  // the throws as clods: n per release, each the load's lob with its own small spread (drawn from the event), in flight until it comes
  // down to the landing's height (the release's landY), then lying where it fell for `keep` s (then the heap has it); s is its time in
  // the air (it stops at the landing: a spin read off s stops with it). Pure in t; the release events alone are enough.
  static clods(events, t, { n = 6, spread = 0.1, g = 9.81, keep = 2 } = {}) {
    const out = [], land = new Map(); for (const e of events) if (e.kind === 'land') land.set(e.k, e);
    for (const e of events) { if (e.kind !== 'release' || e.t > t) continue; const L = land.get(e.k), ly = e.landY ?? (L && L.where.y); if (ly == null) continue; const s0 = t - e.t, sp = e.v.length();
      for (let i = 0; i < n; i++) { const r = j => hash(e.k * 977 + i * 31 + j, 41) - 0.5, v = e.v.clone().multiplyScalar(1 + spread * r(1)).add(V3(r(2), r(3), r(4)).multiplyScalar(spread * sp));
        const tl = (v.y + Math.sqrt(Math.max(0, v.y * v.y + 2 * g * (e.where.y - ly)))) / g; if (s0 > tl + keep) continue;
        const s = Math.min(s0, tl), p = e.where.clone().addScaledVector(v, s); p.y -= 0.5 * g * s * s; out.push({ p, k: e.k, i, s, r: 0.02 + 0.03 * (r(5) + 0.5), kg: e.kg / n, flying: s0 < tl }); } }
    return out;
  }
  // what has been moved by t: throws, kg, loose m3 (spoil bulks up: about 1450 kg to the loose m3)
  static ledger(events, t, { density = 1450 } = {}) { let n = 0, kg = 0; for (const e of events) if (e.kind === 'land' && e.t <= t) { n++; kg += e.kg; } return { throws: n, kg, m3: kg / density }; }
  // a spoil heap of m3 at its angle of repose (loose earth about 34 deg): a cone, V = pi r^2 h / 3, h = r tan(repose)
  static heap(m3, repose = 34) { const tn = Math.tan(repose * D2R), r = Math.cbrt(3 * m3 / (Math.PI * tn)); return { r, h: r * tn }; }
}
Dig.TOOLS = SHOVELS;
