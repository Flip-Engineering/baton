// RIG c1 / RIDER: a hero.js body tied to a Horse: the pelvis to the saddle through a spring, the heels in the stirrups (two-bone IK to the
// stirrup), the hands on the reins (HandRig on a rein SDF running from the bit), the torso quiet against the horse's pitch (Remington and Russell
// paint riders that sit INTO the horse, the hips following the back, the shoulders still). The gait sets the seat: upright in the walk and trot,
// a forward seat in the canter, the crouched two-point of the racing jockey in the gallop (pelvis lifted out of the saddle, the trunk near horizontal).
//   const rider = new Rider(hero, horse, { }); rider.update(t, dt)  ->  rep { seatMm, footMissMm{L,R}, handMissMm{L,R}, grip{L,R} }
import * as THREE from 'three';
import { twoBone } from './ik.js';
import { HandRig } from './hand.js';
import { cylinder } from './sdf.js';
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const SEAT = { walk: { lean: 0.06, lift: 0.0, hand: 0.0 }, trot: { lean: 0.14, lift: 0.0, hand: 0.02 }, canter: { lean: 0.32, lift: 0.03, hand: 0.05 }, gallop: { lean: 0.95, lift: 0.14, hand: 0.09 } };

export class Rider {
  constructor(hero, horse, { reinR = 0.007 } = {}) {
    this.h = hero; this.horse = horse; this.reinR = reinR; this.state = { y: null, vy: 0 };
    this.hand = { L: new HandRig(hero, 'L'), R: new HandRig(hero, 'R') }; this.G = { L: null, R: null }; this._fit = {};
    hero.group.scale.multiplyScalar(1);
  }
  // limb IK on the hero: joints a (root), b, c (end) to a world target with a pole; returns the miss (m)
  _reach(names, target, pole) {
    const h = this.h; h.update(); const A = h.joint(names[0]), B = h.joint(names[1]), C = h.joint(names[2]), l1 = A.distanceTo(B), l2 = B.distanceTo(C);
    const sol = twoBone(A, l1, l2, target, pole, { soft: 0.99 });
    h._aimWorld(names[0], B.clone().sub(A), sol.E.clone().sub(A)); h.update();
    const B2 = h.joint(names[1]), C2 = h.joint(names[2]); h._aimWorld(names[1], C2.clone().sub(B2), sol.W.clone().sub(B2)); h.update();
    return sol.miss;
  }
  update(t, dt = 1 / 30) {
    const h = this.h, hs = this.horse, g = hs.gaitName, P = SEAT[g] || SEAT.walk, rep = { footMissMm: {}, handMissMm: {}, grip: {} };
    hs.group.updateMatrixWorld(true); const wp = o => V().setFromMatrixPosition(o.matrixWorld);
    const sad = wp(hs.saddle), pitch = hs.body.rotation.x;
    // the pelvis: a critically damped spring to the saddle (the rider absorbs part of the heave); in the gallop it floats above it
    const ty = sad.y + P.lift + 0.02; if (this.state.y == null) this.state.y = ty;
    const k = 60, c = 2 * Math.sqrt(k); this.state.vy += (k * (ty - this.state.y) - c * this.state.vy) * dt; this.state.y += this.state.vy * dt; rep.seatMm = (this.state.y - ty) * 1000;
    h.resetPose(); h.group.rotation.set(0, Math.PI / 2 * 0, 0); h.group.position.set(0, 0, 0); h.update();
    const hip = h.joint('root'), sc = h.scale; h.group.rotation.y = 0;
    // hero faces +z like the horse; place the pelvis (the root joint) over the saddle
    h.group.position.set(sad.x, 0, sad.z - 0.02); h.update(); const r0 = h.joint('root'); h.group.position.y += this.state.y - r0.y + 0.10 * (1 - P.lift * 3); h.update();
    // the trunk: lean forward about the lateral axis, quiet against the horse's pitch
    const X = V(1, 0, 0), lean = P.lean + pitch * 0.6;
    h.rotateWorld('spine05', X, lean * 0.3); h.rotateWorld('spine04', X, lean * 0.3); h.rotateWorld('spine02', X, lean * 0.25); h.rotateWorld('neck01', X, -lean * 0.35); h.update();
    // legs: the thigh forward and out, the shin down to the stirrup
    for (const s of ['L', 'R']) { const st = wp(hs.stirrup[s]).add(V(0, 0.0, 0)); rep.footMissMm[s] = this._reach([`upperleg01.${s}`, `lowerleg01.${s}`, `foot.${s}`], st.clone().add(V(0, 0.07, 0)), V(s === 'L' ? 0.4 : -0.4, 0.2, 1)) * 1000; }
    // arms: the reins run from the bit to the hands, held just in front of the withers
    const bit = wp(hs.bit), wither = wp(hs.withers);
    for (const s of ['L', 'R']) {
      const sg = s === 'L' ? 1 : -1, hp = wither.clone().add(V(sg * 0.075, 0.08 - P.hand * 0.3, -0.03 + P.hand * 1.2)), rein = cylinder(hp.clone().add(V(0, 0.0, -0.06)), bit.clone().add(V(sg * 0.02, 0, 0)), this.reinR), hr = this.hand[s];
      // the hand to the rein: a power grip on the rein close to the hand end, palm down, thumb on top
      const G = hr.plan({ grip: 'hammer', obj: cylinder(hp.clone().add(V(0, 0, -0.07)), hp.clone().add(V(0, 0, 0.07)), this.reinR), at: hp, axis: V(0, 0, 1), approach: V(sg * 0.2, 1, 0).normalize(), r: this.reinR, wrap: sg, pole: V(sg * 0.6, -1, -0.4) });
      // the grip is fitted once (the rein is rigid in the hand); afterwards each frame only re-places the wrist and keeps the fitted fingers
      let st; if (!this._fit[s]) { st = hr.place(G, undefined, undefined, { pole: G.pole, lean: true }); hr.settle(G); hr.fit(G); this._fit[s] = { fit: G.fit, open: G.open }; }
      else { st = hr.place(G, undefined, undefined, { pole: G.pole, lean: true }); G.fit = this._fit[s].fit; G.open = this._fit[s].open; }
      hr.pose(G, 1);
      rep.handMissMm[s] = st.reachMiss * 1000; rep.grip[s] = hr.measure(G.obj, G); this.G[s] = G;
    }
    h.update(); this.rep = rep; return rep;
  }
}
