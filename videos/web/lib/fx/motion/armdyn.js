// ARM DYNAMICS (MOTION c3, round 7, continuation run c4): the arm as ONE physical chain in every act. NEW FILE (one current version; act7.js uses it).
//
// WHY. The acts posed every arm as numbers: a hanging arm drifted on seeded noise, the wave's arm was a path of joint angles from the hanging pose to the wave's and back, and when the wave ended the arm
// was drawn home and stopped dead. A person's arm is a pair of rigid limb segments with the person's own masses, lengths and radii of gyration, hung under gravity from a shoulder that the trunk moves
// and held up by the muscles' DRIVE. While the person drives it (raises it, holds it, waves it) the arm is where the plan puts it; when the person lets go it FALLS, the tone of the muscles and the elbow
// catch it, it overshoots and rings down at the arm's own natural frequency (about a hertz), and gravity makes the lowering unlike the raise run backwards. So:
//
//   ArmDyn    the dynamics: a double SPHERICAL pendulum (the upper arm and the forearm-with-hand as two unit vectors from the shoulder and the elbow) with the person's segment table
//             (armTable: lane F's kin masses, centres and radii of gyration; the lengths of this skeleton), hung from a shoulder that accelerates (the trunk's sway, a weight shift, the wave's
//             rock: a fictitious force on the arm), under gravity; the Lagrangian of the two unit vectors (T = M11/2 |u1'|^2 + M12 u1'.u2' + M22/2 |u2'|^2, V = g (f1 u1.y + f2 u2.y)) with the
//             constraint forces solved exactly. The muscles act as a PD CONTROLLER on the PLAN (the command posture the act poses) and a feed-forward: the shoulder's spring toward the planned upper
//             arm, the elbow's toward the planned forearm in the upper arm's frame (the reaction on the upper arm), tone stiffness and damping seeded per person and side in the literature's
//             ranges (tau 0.4-0.85 of the gravity stiffness, zeta 0.25-0.45; a driven arm co-contracts: A times the stiffness), and the inverse-dynamics feed-forward (the torques that would carry the
//             plan: its inertia and its weight) weighed by DRIVE d: d = 1 the arm IS the plan (its state follows the plan's position and velocity), d < 1 the person lets go: the weight of the arm
//             and its inertial torque are no longer carried (the tone supports a hanging arm, not a raised one), so it falls and swings. Walls: the torso (no adduction through the body, nor the hand
//             into the thigh) and the elbow (a hinge: the forearm stays in the elbow's plane and does not hyperextend).
//   ArmChain  ArmDyn on a hero: reads the SKELETON as the plan (the shoulder, elbow and wrist the act has just posed), advances the dynamics to t, and turns the upper arm and the forearm (the hand
//             goes with it) to the dynamic directions. STATEFUL: call it with the frames in order (a gap or a step back re-starts it on the plan), as every act is called.
//   minJerk   the minimum-jerk profile of a normalised time (Flash and Hogan 1985): the plan's speed.
// Nothing here is tuned to a picture: the parameters are the person's masses and lengths, g, the two scalars of the person's tone (tau, zeta), the co-contraction factor of a driven arm, and the range of
// postures the tone can hold unaided (a hanging arm, not a raised one).
import * as THREE from 'three';
import { heroPoints } from '../rig/person_kin.js';
import { SEGMENTS } from '../rig/balance.js';
import { hash } from './life.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const G = 9.81;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };

// ---------------------------------------------------------------- the segment table of one arm
// m1, l1, L1, I1 (about the shoulder): the upper arm; m2, l2, L2, I2 (about the elbow): the forearm and hand as one body; all in metres, kilograms (the person's own when it has a kin)
export function armTable(h, hp, side) {
  const K = hp.K, P = heroPoints(h, K), segs = K ? K.F.segments : SEGMENTS, row = n => segs.find(r => r[0] === n + side), mass = K ? K.mass : 70;
  const rgT = K ? K.F.rg : { uarm: [0.28, 0.27, 0.15], farm: [0.27, 0.26, 0.1], hand: [0.6, 0.5, 0.4] };
  const sh = P['sh' + side], el = P['el' + side], wr = P['wr' + side], fi = P['fi' + side];
  const L1 = sh.distanceTo(el), L2 = el.distanceTo(wr), Lh = wr.distanceTo(fi);
  const ru = row('uarm'), rf = row('farm'), rh = row('hand'), m1 = ru[3] * mass, mf = rf[3] * mass, mh = rh[3] * mass;
  const l1 = ru[4] * L1, lf = rf[4] * L2, dh = L2 + rh[4] * Lh, rgu = (rgT.uarm[0] + rgT.uarm[1]) / 2 * L1, rgf = (rgT.farm[0] + rgT.farm[1]) / 2 * L2, rgh = (rgT.hand[0] + rgT.hand[1]) / 2 * Lh;
  const m2 = mf + mh, l2 = (mf * lf + mh * dh) / m2;
  const I1 = m1 * (rgu * rgu + l1 * l1), I2 = mf * (rgf * rgf + lf * lf) + mh * (rgh * rgh + dh * dh);   // (about the shoulder; about the elbow, the forearm and the hand: each its own inertia plus m d^2)
  return { m1, l1, L1, I1, m2, l2, L2, I2, mass, mf, mh, Lh, kin: !!K };
}

// ---------------------------------------------------------------- the minimum-jerk profile of a normalised time (0..1): 10 u^3 - 15 u^4 + 6 u^5
export const minJerk = u => { u = clamp(u, 0, 1); return u * u * u * (u * (u * 6 - 15) + 10); };

// ---------------------------------------------------------------- the dynamics (no hero: the table, the vectors)
const tang = (v, u) => v.clone().addScaledVector(u, -v.dot(u));          // the part of v perpendicular to the unit vector u
const angAxis = (a, b) => { const c = V3().crossVectors(a, b), s = c.length(), th = Math.atan2(s, a.dot(b)); return { th, ax: s > 1e-9 ? c.multiplyScalar(1 / s) : V3() }; };   // the rotation taking a to b
export class ArmDyn {
  // T: armTable; o: { tau (tone, 0.35..0.9), zeta (0.25..0.45), A (the stiffness of a driven arm over its tone: 3), sg (+1 left arm, -1 right), muscle (the range of postures the tone holds: [0.35, 0.9] rad from plumb) }
  constructor(T, o = {}) {
    this.T = T; this.tau = o.tau ?? 0.6; this.zeta = o.zeta ?? 0.35; this.A = o.A ?? 3; this.sg = o.sg ?? 1; this.hold = o.hold ?? [0.35, 0.9];
    this.u1 = null; this.u2 = null; this.v1 = V3(); this.v2 = V3(); this.t = null; this.hist = []; this.nh = null; this.nhc = null; this.last = null;
    const M11 = T.I1 + T.m2 * T.L1 * T.L1, M12 = T.m2 * T.L1 * T.l2, M22 = T.I2, det = M11 * M22 - M12 * M12;
    this.M = { M11, M12, M22, det, i11: M22 / det, i12: -M12 / det, i22: M11 / det, f1: T.m1 * T.l1 + T.m2 * T.L1, f2: T.m2 * T.l2 };
    this.kg1 = G * this.M.f1; this.kg2 = G * this.M.f2;
    // the slow mode of the hanging arm on its tone (the generalised eigenproblem K v = w^2 M v of the two joints: gravity and tone springs): its frequency (Hz, the report's number) and the joint dampers
    // scaled so that THIS mode has the person's damping ratio zeta (the dampers are viscous at the shoulder and the elbow; the ratio is of the slow mode, the way a swinging arm's decay is read)
    const Ks = this.tau * this.kg1, Ke = this.tau * 1.15 * this.kg2, a = this.kg1 + Ks + Ke, b = -Ke, c = this.kg2 + Ke, Mm = this.M;
    const qa = Mm.det, qb = a * Mm.M22 + c * Mm.M11 - 2 * b * Mm.M12, qc = a * c - b * b, l1 = (qb - Math.sqrt(Math.max(0, qb * qb - 4 * qa * qc))) / (2 * qa), w1 = Math.sqrt(l1);
    let v = [-(b - l1 * Mm.M12), a - l1 * Mm.M11]; const vn = Math.hypot(v[0], v[1]); v = [v[0] / vn, v[1] / vn];
    const Bs0 = 2 * this.zeta * Math.sqrt((this.kg1 + Ks) * Mm.M11), Be0 = 2 * this.zeta * Math.sqrt((this.kg2 + Ke) * Mm.M22);
    const vCv = (Bs0 + Be0) * v[0] * v[0] - 2 * Be0 * v[0] * v[1] + Be0 * v[1] * v[1], vMv = Mm.M11 * v[0] * v[0] + 2 * Mm.M12 * v[0] * v[1] + Mm.M22 * v[1] * v[1];
    this.kB = this.zeta / (vCv / (2 * w1 * vMv)); this.f0Hz = +(w1 / (2 * Math.PI)).toFixed(2); this.mode = { f0Hz: this.f0Hz, shape: v.map(x => +x.toFixed(2)), kB: +this.kB.toFixed(2) };
  }
  // restart on the plan (no motion): u1c, u2c the planned directions, nh the elbow's hinge axis (world) when the plan is bent
  reset(t, u1c, u2c) { this.t = t; this.u1 = u1c.clone(); this.u2 = u2c.clone(); this.v1.set(0, 0, 0); this.v2.set(0, 0, 0); this.hist = [{ u1: u1c.clone(), u2: u2c.clone(), t }]; this.nhc = null; this.nh = null; this.hingeOf(u1c, u2c); }
  // the elbow's hinge axis from the plan (u1c x u2c while the plan is bent), kept while it is straight
  hingeOf(u1c, u2c) { const c = V3().crossVectors(u1c, u2c); if (c.length() > 0.15) this.nhc = c.normalize(); else if (!this.nhc) this.nhc = c.length() > 1e-6 ? c.normalize() : V3(0, 0, 1);
    const R = new THREE.Quaternion().setFromUnitVectors(u1c, this.u1 || u1c); this.nh = this.nhc.clone().applyQuaternion(R); return this.nh; }
  // advance to time t. plan: { u1, u2 } (world unit vectors: the upper arm and the forearm now planned), d: drive 0..1, aS: the shoulder's acceleration (world, m/s^2), lat: the figure's left axis (world), reach: the wall for
  // the wrist's lateral offset from the shoulder (m, outward positive)
  step(t, plan, d, aS, lat, wallW = 0.02) {
    const T = this.T, Mx = this.M, sg = this.sg;
    if (this.t == null || t - this.t > 0.34 || t < this.t - 1e-6) { this.reset(t, plan.u1, plan.u2); return this.last = this._out(plan, d); }
    const dt = t - this.t; if (dt < 1e-5) return this.last;
    const H = this.hist; H.push({ u1: plan.u1.clone(), u2: plan.u2.clone(), t }); if (H.length > 3) H.shift();
    // the plan's rate and acceleration (backward differences over the last frames; tangent to the plan)
    const p1 = H[H.length - 2], p0 = H.length > 2 ? H[H.length - 3] : null, c = H[H.length - 1];
    const vel = (a, b, ta, tb, u) => tang(a.clone().sub(b).multiplyScalar(1 / (ta - tb)), u);
    const vc1 = vel(c.u1, p1.u1, c.t, p1.t, c.u1), vc2 = vel(c.u2, p1.u2, c.t, p1.t, c.u2);
    let ac1 = V3(), ac2 = V3();
    if (p0) { const vp1 = vel(p1.u1, p0.u1, p1.t, p0.t, p1.u1), vp2 = vel(p1.u2, p0.u2, p1.t, p0.t, p1.u2), dm = (c.t - p0.t) / 2; ac1 = tang(vc1.clone().sub(vp1).multiplyScalar(1 / dm), c.u1); ac2 = tang(vc2.clone().sub(vp2).multiplyScalar(1 / dm), c.u2); }
    this.hingeOf(c.u1, c.u2);
    this.t = t;
    if (d >= 0.999) {   // DRIVEN: the arm is the plan (its position and its velocity)
      this.u1.copy(c.u1); this.u2.copy(c.u2); this.v1.copy(vc1); this.v2.copy(vc2); return this.last = this._out(plan, d); }
    // the feed-forward and the stiffness for this stretch
    const Ak = 1 + (this.A - 1) * d, Ks = Ak * this.tau * this.kg1, Ke = Ak * this.tau * 1.15 * this.kg2;
    const Bs = this.kB * 2 * this.zeta * Math.sqrt((this.kg1 + Ks) * Mx.M11), Be = this.kB * 2 * this.zeta * Math.sqrt((this.kg2 + Ke) * Mx.M22);
    const elev = Math.acos(clamp(-c.u1.y, -1, 1)), hold = 1 - smooth(this.hold[0], this.hold[1], elev), rhoG = d + (1 - d) * hold, rhoI = d;
    const gy = V3(0, G, 0), n = Math.max(1, Math.ceil(dt / (1 / 240))), hs = dt / n, R = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n, u1c = p1.u1.clone().lerp(c.u1, s).normalize(), u2c = p1.u2.clone().lerp(c.u2, s).normalize();
      const w1c = V3().crossVectors(u1c, vc1), w2c = V3().crossVectors(u2c, vc2), w1 = V3().crossVectors(this.u1, this.v1), w2 = V3().crossVectors(this.u2, this.v2);
      // the muscles: the shoulder's spring toward the planned upper arm, the elbow's toward the planned forearm carried with the upper arm (hinge)
      const a1 = angAxis(this.u1, u1c), tS = a1.ax.clone().multiplyScalar(Ks * a1.th).addScaledVector(w1.clone().sub(w1c), -Bs);
      R.setFromUnitVectors(u1c, this.u1); const u2t = u2c.clone().applyQuaternion(R), a2 = angAxis(this.u2, u2t);
      const tE = a2.ax.clone().multiplyScalar(Ke * a2.th).addScaledVector(w2.clone().sub(w1).sub(w2c.clone().sub(w1c)), -Be);
      // the feed-forward at the plan: the torque that would carry it (inertia, weight), weighed by the drive
      const gt1 = tang(gy, u1c), gt2 = tang(gy, u2c);
      const Fe = tang(ac1.clone().multiplyScalar(Mx.M12).addScaledVector(ac2, Mx.M22), u2c).multiplyScalar(rhoI).addScaledVector(gt2, rhoG * Mx.f2);
      const Fs = tang(ac1.clone().multiplyScalar(Mx.M11).addScaledVector(ac2, Mx.M12), u1c).multiplyScalar(rhoI).addScaledVector(gt1, rhoG * Mx.f1);
      const tEff = V3().crossVectors(u2c, Fe), tSff = tEff.clone().add(V3().crossVectors(u1c, Fs));
      tS.add(tSff); tE.add(tEff);
      // the elbow's SOFT STOP (passive tissue and the flexors' co-contraction resist the last ~23 degrees of extension, quadratically, with a damping that rises as it closes): the forearm meets the end of its range slowly, the hard wall below only catches what is left
      { const nh = this.nh, ph = Math.atan2(V3().crossVectors(this.u1, this.u2).dot(nh), this.u1.dot(this.u2)), sx = Math.max(0, 0.4 - ph);
        if (sx > 0) { const wr = w2.clone().sub(w1).dot(nh); tE.addScaledVector(nh, this.kg2 * 8 * sx * sx - (wr < 0 ? Be * 4 * (sx / 0.4) * wr : 0)); } }
      // generalised forces: gravity and the shoulder's acceleration on the two masses, the torques (the elbow's reaction on the upper arm)
      const ge = gy.clone().add(aS);
      const Q1 = ge.clone().multiplyScalar(-Mx.f1).add(V3().crossVectors(tS.clone().sub(tE), this.u1)), Q2 = ge.clone().multiplyScalar(-Mx.f2).add(V3().crossVectors(tE, this.u2));
      // the constraint forces (|u1| = |u2| = 1): u_i . u_i'' = -|u_i'|^2
      const a = this.u1.dot(this.u2), b1 = -this.v1.lengthSq() - Mx.i11 * this.u1.dot(Q1) - Mx.i12 * this.u1.dot(Q2), b2 = -this.v2.lengthSq() - Mx.i12 * this.u2.dot(Q1) - Mx.i22 * this.u2.dot(Q2);
      const m12 = Mx.i12 * a, dd = Mx.i11 * Mx.i22 - m12 * m12, l1 = (b1 * Mx.i22 - m12 * b2) / dd, l2 = (Mx.i11 * b2 - m12 * b1) / dd;
      const P1 = Q1.clone().addScaledVector(this.u1, l1), P2 = Q2.clone().addScaledVector(this.u2, l2);
      const A1 = P1.clone().multiplyScalar(Mx.i11).addScaledVector(P2, Mx.i12), A2 = P1.clone().multiplyScalar(Mx.i12).addScaledVector(P2, Mx.i22);
      this.v1.addScaledVector(A1, hs); this.v2.addScaledVector(A2, hs); this.u1.addScaledVector(this.v1, hs); this.u2.addScaledVector(this.v2, hs);
      this.u1.normalize(); this.u2.normalize(); this.v1.addScaledVector(this.u1, -this.v1.dot(this.u1)); this.v2.addScaledVector(this.u2, -this.v2.dot(this.u2));
      this._walls(lat, wallW);
    }
    return this.last = this._out(plan, d);
  }
  // the walls: the torso (the upper arm's outward lift >= 0.03 rad, the wrist's lateral offset >= wallW) and the elbow's hinge (the forearm in the elbow's plane, flexion >= 0.01 rad)
  _walls(lat, wallW) {
    const T = this.T, sg = this.sg, o = sg > 0 ? lat : lat.clone().negate();
    // the hinge: no motion out of the elbow's plane; no hyperextension
    const nh = this.nh; this.u2.addScaledVector(nh, -this.u2.dot(nh)).normalize(); this.v2.addScaledVector(nh, -this.v2.dot(nh)); this.v2.addScaledVector(this.u2, -this.v2.dot(this.u2));
    const phi = Math.atan2(V3().crossVectors(this.u1, this.u2).dot(nh), this.u1.dot(this.u2));
    if (phi < 0.01) { this.u2.copy(this.u1).applyAxisAngle(nh, 0.01); const w1 = V3().crossVectors(this.u1, this.v1); this.v2.crossVectors(w1, this.u2); }
    // the torso: the upper arm cannot adduct through the body
    const cmin = Math.sin(0.03), c1 = this.u1.dot(o);
    if (c1 < cmin) { this.u1.addScaledVector(o, cmin - c1).normalize(); const vo = this.v1.dot(o); if (vo < 0) this.v1.addScaledVector(o, -vo); this.v1.addScaledVector(this.u1, -this.v1.dot(this.u1)); }
    // and the wrist cannot go into the thigh: its lateral offset from the shoulder >= wallW
    const wl = T.L1 * this.u1.dot(o) + T.L2 * this.u2.dot(o);
    if (wl < wallW) { const need = (wallW - T.L1 * this.u1.dot(o)) / T.L2; if (need < 0.99) { const c2 = this.u2.dot(o); this.u2.addScaledVector(o, need - c2).normalize(); const vo = this.v2.dot(o); if (vo < 0) this.v2.addScaledVector(o, -vo); this.v2.addScaledVector(this.u2, -this.v2.dot(this.u2)); } }
  }
  _out(plan, d) { return { u1: this.u1.clone(), u2: this.u2.clone(), dev1: Math.acos(clamp(this.u1.dot(plan.u1), -1, 1)), dev2: Math.acos(clamp(this.u2.dot(plan.u2), -1, 1)), d }; }
}

// ---------------------------------------------------------------- the chain on a hero
export class ArmChain {
  // h: the hero, hp: a HeroPoser (its heading axes and kin), side 'L' | 'R'; o: { seed, tone (tau, 0.35..0.9), zeta (0.25..0.45) }: each person's own, seeded
  constructor(h, hp, side, o = {}) {
    this.h = h; this.hp = hp; this.side = side; this.sg = side === 'L' ? 1 : -1; this.T = armTable(h, hp, side);
    const r = k => hash((o.seed ?? 1) >>> 0, 700 + k + (side === 'L' ? 0 : 50));
    this.tau = o.tone ?? (0.4 + 0.45 * r(1)); this.zeta = o.zeta ?? (0.25 + 0.2 * r(2));
    this.dyn = new ArmDyn(this.T, { tau: this.tau, zeta: this.zeta, sg: this.sg, A: o.A }); this.S = []; this.dts = [];
    this.rep = { tau: +this.tau.toFixed(2), zeta: +this.zeta.toFixed(2), m1: +this.T.m1.toFixed(2), m2: +this.T.m2.toFixed(2), f0Hz: this.dyn.f0Hz, kin: this.T.kin };
  }
  // the SKELETON as the plan (the shoulder, elbow and wrist the act has posed this frame), advanced to t with drive d (0 = a hanging arm on its tone, 1 = driven); the bones are turned to the dynamic arm.
  // returns { dev1, dev2 (rad between the plan and the arm), moved }
  follow(t, d = 0) {
    const h = this.h, hp = this.hp, s = this.side; h.update();
    const S = h.joint('upperarm01.' + s), E = h.joint('lowerarm01.' + s), W = h.joint('wrist.' + s), plan = { u1: E.clone().sub(S).normalize(), u2: W.clone().sub(E).normalize() };
    // the shoulder's world acceleration (backward second difference over the last three frames), clamped
    const aS = V3(); this.S.push({ p: S.clone(), t }); if (this.S.length > 3) this.S.shift();
    const q = this.S; if (q.length === 3 && t - q[0].t < 0.5) { const d1 = q[1].t - q[0].t, d2 = q[2].t - q[1].t; if (d1 > 1e-5 && d2 > 1e-5) { const v1 = q[1].p.clone().sub(q[0].p).multiplyScalar(1 / d1), v2 = q[2].p.clone().sub(q[1].p).multiplyScalar(1 / d2); aS.copy(v2.sub(v1).multiplyScalar(2 / (d1 + d2))); if (aS.length() > 6) aS.multiplyScalar(6 / aS.length()); } }
    const lat = hp.dirW(V3(1, 0, 0)), out = this.dyn.step(t, plan, d, aS, lat, 0.02 * hp.sx);
    let moved = 0;
    if (out.dev1 > 1e-4 || out.dev2 > 1e-4) {
      const aim = (bone, from, cur, to) => { const u = cur.clone().sub(from).normalize(), c = V3().crossVectors(u, to), sn = c.length(); if (sn < 1e-8) return; h.rotateWorld(bone, c.multiplyScalar(1 / sn), Math.atan2(sn, u.dot(to))); h.update(); };
      aim('upperarm01.' + s, S, E, out.u1); aim('lowerarm01.' + s, h.joint('lowerarm01.' + s), h.joint('wrist.' + s), out.u2); moved = 1; }
    return { dev1: out.dev1, dev2: out.dev2, moved };
  }
}
