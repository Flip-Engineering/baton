// ERECT acts (MODELING c4): choreography for the ERECTOR giant, as functions of time that return a pose, the support state and
// the contact EVENTS (for dust, debris, shake and sound). Built on rigkit (IK to placed feet, balance on the centre of mass).
//
//   KneelStand: down on the right knee, left foot forward, left forearm on the left knee. It leans its weight over the front
//               foot (anticipation), the knee leaves the ground, it rises on the left leg while the right foot pushes off its
//               toes, steps through and PLANTS, settles (a dip and a recovery: weight), stands at work.
//   Carry:      crouches to a girder staged on timber cribs, closes its hands on the ends, stands with the load, raises it and
//               sets it on two columns, lets go.
// Pace (see rigkit): a kneel-to-stand of ~1.4 s for a person is ~5.5-6 s here.
import * as THREE from 'three';
import { applyPose, balance, Keyed, mixPose, soleCorners, hull, insideDist, footTargetW, solveLimb } from './rigkit.js';
import { DIM } from './erector.js';

const d2r = Math.PI / 180, V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)), lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, t) => { const u = clamp((t - a) / (b - a)); return u * u * (3 - 2 * u); };
const smoother = (a, b, t) => { const u = clamp((t - a) / (b - a)); return u * u * u * (u * (6 * u - 15) + 10); };
// a hand's world rotation (relative to the base) from where the palm faces and where the fingers point
export function handQ(s, palm, fingers) {
  const pn = palm.clone().normalize(), x = pn.clone().multiplyScalar(-s);   // palm normal is -s * local x
  let y = fingers.clone().normalize().multiplyScalar(-1); y.addScaledVector(x, -y.dot(x)).normalize();   // fingers are local -y
  const z = new THREE.Vector3().crossVectors(x, y); return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
// the base-frame position of a joint (after applyPose)
const jointB = (E, k) => { const p = E.J[k].getWorldPosition(V3()); return p.applyMatrix4(E.g.matrixWorld.clone().invert()); };

export class KneelStand {
  // stomp (c5, default for the c5 design): the stepping foot travels first, hangs flat over its patch, then DROPS the last
  // metres and arrives with speed (c4 eased it in: it touched down at zero velocity, so nothing said "weight")
  constructor(E, { T0 = 1.2, knee = [-5.2, 3.35, 1.6], toeR = [-5.6, -10.2], footL = [5.4, 13.8], footR = [-5.8, 12.8], tLift = 2.9, tStep = [4.3, 5.7], tUp = 7.5, tEnd = 9.8, stomp = !!E.C5 } = {}) {
    this.E = E; this.o = { T0, knee, toeR, footL, footR, tLift, tStep, tUp, tEnd, stomp };
    // timing (s, from the start of the clip): hold, lean (anticipation), knee lifts, rise, step, plant, settle
    this.events = [
      { t: T0 + .2, kind: 'hiss', where: 'hips', strength: .5 },
      { t: T0 + tLift - T0, kind: 'knee_lift', strength: .8 },
      { t: tStep[0], kind: 'foot_lift', side: 'R', strength: .6 },
      { t: tStep[1], kind: 'plant', side: 'R', strength: 1 },
      { t: tStep[1] + .9, kind: 'settle', strength: .6 },
      { t: tUp + .2, kind: 'hiss', where: 'knees', strength: .7 },
    ];
  }
  // the R knee pinned at K: the hip swings about it (thigh angle a from vertical, + = forward); the trailing foot finds the heel lift
  // that keeps the shin exactly its length between the knee and the toe pad
  kneelRoot(a, pitch) {
    const { knee: K, toeR } = this.o, Kv = V3(...K);
    const hipR = Kv.clone().add(V3(0, Math.cos(a * d2r), Math.sin(a * d2r)).multiplyScalar(DIM.thigh));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * d2r, 0, 0, 'YXZ')), off = V3(-DIM.hipX, -DIM.hipDrop, 0).applyQuaternion(q);
    const root = hipR.clone().sub(off);
    // phi: |ankle(phi) - K| = shin
    const ankle = phi => { const qq = new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), phi * d2r), H = V3(toeR[0], DIM.ankleH + DIM.toe[1], toeR[1]); return H.add(V3(-DIM.toe[0], -DIM.toe[1], -DIM.toe[2]).applyQuaternion(qq)); };
    let lo = 0, hi = 88; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ankle(m).distanceTo(Kv) > DIM.shin) hi = m; else lo = m; }
    return { root: [root.x, root.y, root.z], phi: (lo + hi) / 2 };
  }
  pose(t) {
    const E = this.E, o = this.o, { T0, tLift, tStep, tUp } = o;
    // torso: lean in over the front foot before rising, come up as the legs extend
    const lean = lerp(8, 17, sstep(T0, tLift, t)) * (1 - smoother(tLift + .6, tUp, t)) + 2 * smoother(tLift + .6, tUp, t);
    const chestP = lerp(4, 9, sstep(T0, tLift, t)) * (1 - smoother(tLift + .4, tUp, t)) + 2 * smoother(tLift + .4, tUp, t);
    const P = { root: { p: [0, 0, 0], r: [lean, 0, 0] }, waist: [0, lerp(-6, 3, smoother(T0, tUp, t)), 0], chest: [chestP, 0, lerp(2, -1, smoother(T0, tUp, t))], legs: {}, arms: {}, curl: {} };
    P.legs.L = { p: o.footL, yaw: -3 };
    const a0 = 1, a1 = 21; let phiR;
    if (t <= tLift) { const a = lerp(a0, a1, smoother(T0, tLift, t)), kr = this.kneelRoot(a, lean); P.root.p = kr.root; phiR = kr.phi; P.legs.R = { p: o.toeR, phi: phiR }; this.contactKnee = true; }
    else {
      // after the knee leaves the ground: root keyed from the lift pose to standing; the COM is kept over the left foot until the plant
      const kl = this.kneelRoot(a1, lerp(8, 17, 1)), r0 = kl.root, r1 = [0.6, E.rootY - .5, 9.4];
      // low through the step (it steps first, then stands): up a little and forward until the plant, then up on both legs;
      // a dip as the weight arrives on the planted foot, a small overshoot as the rams catch it
      const ymid = r0[1] + 3.0, u1 = smoother(tLift, tStep[1], t), u2 = smoother(tStep[1] + .25, tUp, t), uz = smoother(tStep[0] - .2, tStep[1], t);
      const dip = -1.0 * Math.sin(Math.PI * clamp((t - tStep[1]) / 1.0)) * (t > tStep[1] ? 1 : 0) + .22 * Math.sin(Math.PI * clamp((t - tUp) / 1.2)) * (t > tUp ? 1 : 0);
      P.root.p = [lerp(r0[0], r1[0], u1), lerp(lerp(r0[1], ymid, u1), r1[1], u2) + dip, lerp(r0[2], lerp(r0[2], r1[2], .7), uz) + (r1[2] - lerp(r0[2], r1[2], .7)) * u2];
      this.contactKnee = false;
      if (t < tStep[0]) { phiR = lerp(kl.phi, kl.phi + 30, sstep(tLift, tStep[0], t)); P.legs.R = { p: o.toeR, phi: phiR }; }
      else if (o.stomp) { // c5: travel in the first 80% of the step, then the flat foot drops onto its patch and arrives fast
        const tau = clamp((t - tStep[0]) / (tStep[1] - tStep[0])), s = smoother(0, .8, tau);
        const Hh = 4.6, lift = tau < .45 ? Hh * Math.sin(Math.PI / 2 * tau / .45) : Hh * (1 - Math.pow((tau - .45) / .55, 2.2));
        P.legs.R = { p: [lerp(o.toeR[0], o.footR[0], s), lerp(o.toeR[1], o.footR[1], s)], phi: lerp(kl.phi + 30, 0, sstep(0, .7, tau)), lift: Math.max(0, lift) + .02, yaw: lerp(0, 8, s), toe: lerp(-(kl.phi + 30), 0, sstep(0, .5, tau)) * (1 - s) };
        this.footLift = lift;
      }
      else { // the step: toe-off, swing (lift and travel), heel-strike flat
        const s = smoother(tStep[0], tStep[1], t), arc = Math.sin(Math.PI * s);
        P.legs.R = { p: [lerp(o.toeR[0], o.footR[0], s), lerp(o.toeR[1], o.footR[1], s)], phi: lerp(kl.phi + 30, 0, sstep(tStep[0], tStep[1] - .25, t)) , lift: 4.2 * arc + .02, yaw: lerp(0, 8, s), toe: lerp(-(kl.phi + 30), 0, sstep(tStep[0], tStep[0] + .7, t)) * (1 - s) };
      }
      // balance: x/z from the keys, then the COM is pulled over the support (left foot while the right is up; both after the plant)
      // over the left sole's centre (its yaw included): that is where the weight must be before the right foot leaves the ground
      const sc = soleCorners({ p: o.footL, yaw: -3 }), over = [sc.reduce((a, q) => a + q[0], 0) / sc.length - 1.6, 9.2];
      const both = [(o.footL[0] + o.footR[0]) / 2, (o.footL[1] + o.footR[1]) / 2 - 5.5];
      const tgt = t < tStep[1] ? over : [lerp(over[0], both[0], sstep(tStep[1], tUp + .8, t)), lerp(over[1], both[1], sstep(tStep[1], tUp + .8, t))];
      // the weight goes over between the knee leaving the ground and the back foot leaving it (the toe pad props it meanwhile),
      // eased both ends: ~5 m in ~1.8 s, a person's half-hip-width shift at this size and pace
      const w = smoother(tLift, tStep[0] - .1, t);
      this._bal = { tgt, w };
    }
    // arms: in the kneel, left forearm on the left knee, right arm hanging relaxed forward; they push and swing as it rises
    P.curl = { L: { c: lerp(.25, .5, sstep(tLift, tUp, t)), thumb: .3 }, R: { c: lerp(.5, .35, sstep(T0, tUp, t)) } };
    P.arms.R = { fk: { sh: [lerp(-14, 6, smoother(tLift - .3, tUp, t)) - 8 * Math.sin(Math.PI * clamp((t - tStep[0]) / 2.2)), 0, lerp(-8, -10, sstep(T0, tUp, t))], el: [lerp(-34, -14, smoother(tLift, tUp + .6, t)), 0, 0] } };
    applyPose(E, P);
    if (this._bal && t > tLift) { const { tgt, w } = this._bal, inv = E.g.matrixWorld.clone().invert(), c0 = E.com().applyMatrix4(inv), want = [lerp(c0.x, tgt[0], w), lerp(c0.z, tgt[1], w)];
      for (let k = 0; k < 5; k++) { const cl = E.com().applyMatrix4(inv), ex = want[0] - cl.x, ez = want[1] - cl.z; if (Math.hypot(ex, ez) < .02) break; P.root.p[0] += ex * 1.2; P.root.p[2] += ez * 1.2; applyPose(E, P); } }
    // left hand: on the knee until it pushes off, then down to the side
    const kn = jointB(E, 'knL'), onKnee = V3(kn.x + .6, kn.y + 5.6, kn.z + 2.2), side = V3(DIM.shX + 2.2, 30.5, P.root.p[2] + 3.5);
    const uh = smoother(tLift + .8, tUp - .3, t), wt = onKnee.clone().lerp(side, uh);
    P.arms.L = { ik: [wt.x, wt.y, wt.z], pole: [.7, -.1, -1], handQ: handQ(1, V3(0, -1, 0).lerp(V3(-1, 0, 0), uh), V3(0, -.4, 1).lerp(V3(0, -1, .2), uh)), hand: 1 };
    applyPose(E, P); this.P = P;
    // support and margin
    const pts = [...soleCorners(P.legs.L), ...soleCorners(P.legs.R)]; if (this.contactKnee) { const k = jointB(E, 'knR'); pts.push([k.x - 2.4, k.z - 1], [k.x + 2.4, k.z - 1], [k.x - 2.4, k.z + 2.5], [k.x + 2.4, k.z + 2.5]); }
    const H = hull(pts), c = E.com().applyMatrix4(E.g.matrixWorld.clone().invert());
    this.state = { com: c, hull: H, margin: insideDist(H, c.x, c.z), knee: this.contactKnee, rams: { ...E.ramRep }, miss: E.rep.miss };
    return P;
  }
}

// carry: a girder staged on cribs in front; crouch, grip, stand with it, raise it, set it on two column heads, let go
export class Carry {
  // c5 options: close (the fingers close on the girder's section, E.gripOn), gripY (wrist height over the girder's centre: 3.65
  // puts the knuckles just under the bottom flange so the fingers hook under it), gripX (wrist outboard of the end plate)
  constructor(E, girder, { cribTop = 12, z = 9, zCol = 11.6, colTop = 33, T = [1.0, 3.6, 4.4, 7.4, 10.0, 11.6, 12.6], close = !!E.C5, gripY = E.C5 ? 3.65 : 3.0, gripX = E.C5 ? 1.47 : 1.35 } = {}) {
    this.E = E; this.G = girder; this.o = { cribTop, z, zCol, colTop, T, close, gripY, gripX };
    const [tCrouch, tReach, tGrip, tStand, tRaise, tSet, tLet] = T;
    this.events = [{ t: tGrip, kind: 'grip', strength: .7 }, { t: tGrip + .5, kind: 'lift_off', strength: .8 }, { t: tSet, kind: 'set_down', strength: 1 }, { t: tLet, kind: 'release', strength: .4 }, { t: tGrip + 1.2, kind: 'hiss', where: 'elbows', strength: .6 }];
  }
  // where the girder is (its centre, base frame) at time t
  girderAt(t) {
    const { cribTop, z, zCol, colTop, T } = this.o, [tC, tR, tG, tS, tRa, tSe] = T, h = this.G.depth;
    const y0 = cribTop + h / 2, yCarry = 26.8, ySet = colTop + h / 2;
    if (t <= tG + .4) return V3(0, y0, z);
    if (t <= tS) { const u = smoother(tG + .4, tS, t); return V3(0, lerp(y0, yCarry, u), lerp(z, z - 2, u)); }
    // up clear of the column heads, across onto them, then down: the load never passes through the columns
    if (t <= tRa) { const u = smoother(tS + .3, tRa, t); return V3(0, lerp(yCarry, ySet + 1.8, u), z - 2); }
    if (t <= tRa + .9) { const u = smoother(tRa, tRa + .9, t); return V3(0, ySet + 1.8, lerp(z - 2, zCol, u)); }
    if (t <= tSe) { const u = smoother(tRa + .9, tSe, t); return V3(0, lerp(ySet + 1.8, ySet, u), zCol); }
    return V3(0, ySet, zCol);
  }
  pose(t) {
    const E = this.E, { T, z } = this.o, [tC, tR, tG, tS, tRa, tSe, tL] = T;
    let gc = this.girderAt(t); const held = t > tG - .1 && t < tL + .3;
    // body: crouch to reach, stand with the load (leaning back against it), reach up to set it
    const crouch = smoother(.0, tC + 1.4, t) * (1 - smoother(tG + .3, tS, t)), reachUp = smoother(tS + .4, tSe, t);
    const P = { root: { p: [0, E.rootY - .5 - 12.5 * crouch + .12 * reachUp, -1 - 4 * crouch], r: [3 + 22 * crouch - 6 * reachUp * (held ? 1 : 0), 0, 0] }, waist: [0, 0, 0], chest: [6 * crouch - 5 * reachUp, 0, 0], legs: { L: { p: [6.6, 3.2], yaw: -8, kneeOut: .35 }, R: { p: [-6.6, 3.2], yaw: 8, kneeOut: .35 } }, arms: {}, curl: {} };
    const load = held && t > tG + .3 ? { p: () => gc.clone().applyMatrix4(E.g.matrixWorld), t: this.G.mass } : null;
    // the hands take the girder by its ends: palms on the end plates (the hand's natural palm-in), fingers down the end and curling
    // under the bottom flange, so the load sits on the fingers
    const half = this.G.len / 2 + this.o.gripX;
    const setArms = () => { for (const [L, s] of [['L', 1], ['R', -1]]) {
      const grip = V3(s * half, gc.y + this.o.gripY, gc.z), rest = V3(s * (DIM.shX + 1.2), 29.5, 3);
      const reach = smoother(tC, tR, t), out = smoother(tL, tL + 1.6, t), w = held ? 1 : reach * (1 - out);
      const wt = rest.clone().lerp(grip, w).add(V3(0, 1.2 * (1 - smoother(tR, tG, t)) * (t < tG ? 1 : 0), 0));
      P.arms[L] = { ik: [wt.x, wt.y, wt.z], pole: [s * .9, -.3, -1], handQ: handQ(s, V3(-s, 0, 0), V3(0, -1, 0)), hand: 1 };
      P.curl[L] = { c: lerp(.15, .62, smoother(tR + .2, tG, t)) * (1 - smoother(tL, tL + .7, t)) + .2 * smoother(tL, tL + .7, t), thumb: .2 }; } };
    setArms();
    // balance: the COM (with the load once lifted) over the middle of the feet
    let b = balance(E, P, { target: 'feet', load, iters: 4 });
    // while it is held the load hangs from straight arms: if the keyed path asks for more reach than the arms have, the girder rides
    // up and in with the body (it follows the hands, the hands do not leave it)
    if (held) for (let k = 0; k < 5; k++) { const m = Math.max(E.rep.miss.armL || 0, E.rep.miss.armR || 0); if (m < .01) break; gc.y += m * .95; setArms(); applyPose(E, P); }
    this.gcHeld = gc.clone();
    const c = E.com(load ? { p: load.p(), t: load.t } : null).applyMatrix4(E.g.matrixWorld.clone().invert());
    this.P = P; this.state = { com: c, hull: b.hull, margin: insideDist(b.hull, c.x, c.z), rams: { ...E.ramRep }, miss: { ...E.rep.miss }, load: !!load, girder: gc.toArray() };
    // the girder follows the hands while held
    this.G.set(gc);
    // c5: the hands close on the section as they take it, and open as they let go
    if (this.o.close) { const amt = smoother(tR + .2, tG, t) * (1 - smoother(tL, tL + .7, t)); if (amt > 0) { E.g.updateMatrixWorld(true); const bx = this.G.boxes(); for (const L of ['L', 'R']) E.gripOn(L, bx, { amount: amt, c0: P.curl[L].c }); } }
    return P;
  }
}

// LAND (MODELING c5): one end of a girder set down on a column head while the hands still carry the other end high: the moment a
// heavy member is LANDED (a crane crew always lands one end first, then lets the other down). It gives the hero frame its diagonal:
// the girder runs from the column on one side, up through both hands, against the sky. A pose for stills and slow holds.
//   new Land(E, girder, { side: 1 (the low end on the giant's left, +x), tilt: 18 (deg), colTop: 30, z: 11 })  .pose(t)
export class Land {
  constructor(E, girder, { side = 1, tilt = 18, colTop = 30, z = 11, reach = 1, breathe = .25 } = {}) { this.E = E; this.G = girder; this.o = { side, tilt, colTop, z, reach, breathe }; this.events = []; }
  girder(t = 0) {
    const { side, tilt, colTop, z } = this.o, G = this.G, th = side * -tilt * d2r, L = G.len / 2 - 1.2;
    // the low end sits on the column head: its underside point 1.2 m in from the end is at colTop
    const endLow = V3(side * L, colTop + G.depth / 2, z), c = endLow.clone().add(V3(-side * L * Math.cos(th), -side * L * Math.sin(th), 0));
    c.y += .12 * Math.sin(t * .9) * this.o.breathe;   // the held end rides on the rams' pressure
    return { c, th, col: [side * (L + .2), z] };
  }
  pose(t = 0) {
    const E = this.E, G = this.G, { c, th } = this.girder(t), qg = new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), th);
    G.set(c, th);
    // where along the girder each hand takes it: the low hand steadies near the column (palm on the top flange), the high hand
    // carries the end (palm on the end plate, fingers hooked under)
    const s0 = this.o.side, ax = V3(1, 0, 0).applyQuaternion(qg), upG = V3(0, 1, 0).applyQuaternion(qg);
    const hiEnd = c.clone().addScaledVector(ax, -s0 * (G.len / 2 + 1.47)).addScaledVector(upG, 3.65);
    const loHold = c.clone().addScaledVector(ax, s0 * (G.len / 2 - 6.5)).addScaledVector(upG, G.depth / 2 + 3.2);
    const lean = 6 + 2 * Math.sin(t * .6);
    // braced, not crouched: the leg on the low end's side forward, the other back and straight (it pushes the load across)
    const P = { root: { p: [-s0 * 1.0, E.rootY - 1.4, 2.0], r: [lean, -s0 * 7, s0 * 1.2] }, waist: [0, -s0 * 5, 0], chest: [-3, -s0 * 3, s0 * 1.5],
      legs: { L: { p: [6.4, s0 > 0 ? 8.4 : 0.2], yaw: -6, kneeOut: .15 }, R: { p: [-6.6, s0 > 0 ? 0.0 : 8.2], yaw: 9, kneeOut: .15 } }, arms: {}, curl: { L: { c: .3 }, R: { c: .3 } } };
    const hand = s0 > 0 ? { lo: 'L', hi: 'R' } : { lo: 'R', hi: 'L' };
    const setArms = () => {
      const sh = hand.hi === 'L' ? 1 : -1, sl = -sh;
      P.arms[hand.hi] = { ik: hiEnd.toArray(), pole: [sh * .9, -.4, -1], handQ: handQ(sh, ax.clone().multiplyScalar(s0), upG.clone().negate()), hand: 1 };
      P.arms[hand.lo] = { ik: loHold.toArray(), pole: [sl * .9, -.2, -1], handQ: handQ(sl, upG.clone().negate().lerp(ax.clone().multiplyScalar(-s0), .25), ax.clone().multiplyScalar(-s0).lerp(V3(0, 0, 1), .3)), hand: 1 };
    };
    setArms();
    const load = { p: () => c.clone().applyMatrix4(E.g.matrixWorld), t: G.mass * .5 };
    const b = balance(E, P, { target: 'feet', load, iters: 4 }); setArms(); applyPose(E, P);
    E.g.updateMatrixWorld(true); const bx = G.boxes(); for (const L of ['L', 'R']) E.gripOn(L, bx, { amount: 1, c0: .3 });
    const cc = E.com({ p: load.p(), t: load.t }).applyMatrix4(E.g.matrixWorld.clone().invert());
    this.P = P; this.state = { com: cc, hull: b.hull, margin: insideDist(b.hull, cc.x, cc.z), miss: { ...E.rep.miss }, rams: { ...E.ramRep } };
    return P;
  }
}
