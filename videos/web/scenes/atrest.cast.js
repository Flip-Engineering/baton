// AT REST: the people, from the client's person pipeline on main (research/PERSON_PIPELINE.md; lib/fx/person/index.js: the ONE current person,
// makePerson('<name>'), every lane's landed result on; afterPose7 and ensureSkinSSS from the same index). Built lazily,
// one after another (FABRIC7's hooks are page-wide), only in the segments that show them.
//   THE HAND   makePerson('L05_m59_black'): the current skin (SKIN7 rev 7) with DETAIL7's fine tier (gain 1), skin SSS through LitRenderer
//              (ensureSkinSSS). His right arm is placed by HandRig's own planner (planNatural, the pinch grip: Feix 16/18) so the reach is
//              natural for where he stands; then the precision pinch is made on the TAIL itself: the index curls onto it (closeFinger)
//              and the thumb is searched into opposition against it (fitThumb), so the pads face each other across the 1.5 mm thread.
//              The whole body is then placed so that pinch lands on the drop's tail 30 mm from the head, the tail's axis across the
//              pads, rolled about the tail until the pads are edge-on to the lens and the arm comes in from the lower right.
//   THE NINE   the walkers of the wide, each in their own K4 work outfit, walking east to the gate on MOTION rev 7's gait (WalkTurn7: the
//              footstep gait over the ground, arms opposite the legs, the person's own amplitude), straight on: the stop and the turn
//              lie past the end of the shot. Posed per frame (pure functions of t: seekable for segment renders).
import * as THREE from 'three';
import { loadPersonStudio, makePerson } from '../lib/fx/person/index.js';
import { afterPose7 } from '../lib/fx/person/index.js';
import { HandRig, cylinder } from '../lib/fx/rig/index.js';
import { WalkTurn7 } from '../lib/fx/motion/act7.js';
import { WALKERS } from './atrest.plan.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const HAND_WHO = 'L05_m59_black';
let _st = null;
async function studio() { if (!_st) _st = await loadPersonStudio(); return _st; }
async function mk(name, o = {}, log = console.log) {
  const t0 = performance.now();
  const P = await makePerson(name, { studio: await studio(), pose: false, ...o });
  P.h.group.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; } });
  log(`atrest: person ${name} ${Math.round(performance.now() - t0)} ms, seams ${P.report?.seams?.length || 0}`);
  return P;
}
const centroid = (hand, ids) => { const c = V(), p = V(); ids.forEach(v => c.add(hand.skinPt(v, p))); return c.multiplyScalar(1 / Math.max(1, ids.length)); };

// the thumb for a TIP pinch (HandRig's fitThumb aims the pad at the index's middle joint, a power grip's opposition): a search over its
// four angles for the distal pad on the tail's far side from the index pad, touching, not inside the glass or the index
function pinchThumb(hand, sdf, T, n) {
  const S = hand.set.thumb, sub = a => a.filter((_, i) => i % 2 === 0), tip = sub(S[2]), all = sub([...S[0], ...S[1], ...S[2]]);
  const idx = hand.set.index[2].filter((_, i) => i % 4 === 0), p = V(), q = V();
  const cost = T4 => {
    hand.apply({ ...hand.ang, thumb: T4 });
    let pen = 0, gap = Infinity, arg = null, penF = 0;
    for (const v of all) { hand.skinPt(v, p); pen = Math.max(pen, -(sdf.d(p))); }
    for (const v of tip) { hand.skinPt(v, p); const d = sdf.d(p); if (d < gap) { gap = d; arg = p.clone(); } }
    const ip = idx.map(v => hand.skinPt(v, V()));
    for (const v of tip) { hand.skinPt(v, p); for (const o of ip) { const d = p.distanceTo(o); if (d < 0.0012) penF = Math.max(penF, 0.0012 - d); } }
    const side = arg ? arg.clone().sub(T).normalize().dot(n) : 0;              // +1: on the thumb's side, away from the index pad
    return Math.abs(gap) * 14 + pen * 90 + penF * 60 + 0.004 * (1 - side);
  };
  let best = { c: Infinity, T: [0, 0, 0, 0] };
  for (let i = -7; i <= 7; i++) for (let j = -7; j <= 7; j++) for (const c2 of [0.1, 0.35, 0.6, 0.9]) { const T4 = [i * 0.12, j * 0.12, c2, c2 * 0.8]; const c = cost(T4); if (c < best.c) best = { c, T: T4 }; }
  for (let it = 0; it < 6; it++) { const st = 0.06 / (it + 1), b0 = best.T.slice();
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) for (let l = -1; l <= 1; l++) { const T4 = [b0[0] + i * st, b0[1] + j * st, Math.max(0, b0[2] + k * st), Math.max(0, b0[3] + l * st)]; const c = cost(T4); if (c < best.c) best = { c, T: T4 }; } }
  hand.apply({ ...hand.ang, thumb: best.T });
  return best.T;
}

// ---------------------------------------------------------------- the hand
export class Hand {
  constructor() { this.P = null; this.ok = false; this.rep = {}; }
  async build({ log = console.log } = {}) {
    this.P = await mk(HAND_WHO, {}, log);
    const h = this.P.h; h.group.position.set(0, 0, 0); h.group.rotation.set(0, 0, 0); h.update();
    this.stance = h.skeleton.bones.map(b => [b.position.clone(), b.quaternion.clone()]);
    return this;
  }
  // plan the pinch in his own space; returns { T (pinch point), A (tail axis), D (index pad -> thumb pad), F (toward the elbow) }
  plan({ log = console.log } = {}) {
    const h = this.P.h, hand = this.hand = new HandRig(h, 'R');
    // where a man puts his hand to take something in front of him at chest height, a little to his right
    const C = h.joint('spine03').clone().add(V(-0.14, 0.04, 0.36)), a = C.clone().add(V(0.012, 0, 0)), b = C.clone().add(V(-0.012, 0, 0));
    const G0 = hand.planNatural({ grip: 'pinch', obj: cylinder(a, b, 0.00075), at: C.clone(), r: 0.00075 });
    this.arm = hand.snap();
    // the precision shape: the other three fingers folded out of the way, the index in a tip-pinch curl, the thumb brought round
    hand.apply({ index: [0.55, 0.78, 0.38], middle: [1.05, 1.25, 0.8], ring: [1.15, 1.3, 0.85], pinky: [1.2, 1.35, 0.9], spread: {}, thumb: [-0.75, -0.55, 0.25, 0.2] });
    const iC = centroid(hand, hand.set.index[2]), tC = centroid(hand, hand.set.thumb[2]), n = tC.clone().sub(iC).normalize(), r = 0.00075;
    // the index pad's surface point toward the thumb, and the tail just on it (its axis across the pad, along the knuckle line)
    let iPad = iC.clone(), best = -Infinity; const q = V();
    for (const v of hand.set.index[2]) { hand.skinPt(v, q); const d = q.clone().sub(iC).dot(n); if (d > best) { best = d; iPad = q.clone(); } }
    const T = iPad.clone().addScaledVector(n, r + 0.0002);
    let A = G0.a ? G0.a.clone() : V(1, 0, 0); A.addScaledVector(n, -A.dot(n)); if (A.lengthSq() < 1e-8) A = V().crossVectors(n, V(0, 1, 0)); A.normalize();
    const tail = cylinder(T.clone().addScaledVector(A, 0.003), T.clone().addScaledVector(A, -0.003), r);   // short: the thumb must meet it at the index pad
    const thumb = pinchThumb(hand, tail, T, n);
    hand.apply({ ...hand.ang, thumb });
    const fit = { index: hand.ang.index, middle: hand.ang.middle, ring: hand.ang.ring, pinky: hand.ang.pinky, spread: {}, meta: {}, thumb };
    this.G = { ...G0, fit, open: { index: [0.3, 0.42, 0.2], middle: fit.middle, ring: fit.ring, pinky: fit.pinky, spread: {}, meta: {}, thumb: [-0.5, -0.4, 0.05, 0.05] },
      stagger: { index: 0, middle: 0, ring: 0, pinky: 0, thumb: 0.1 } };
    this.tailSDF = tail;
    const m = hand.measure(tail, { only: ['index', 'thumb'] });
    const iPad2 = centroid(hand, hand.set.index[2]), tPad2 = centroid(hand, hand.set.thumb[2]);
    const D = tPad2.clone().sub(iPad2).normalize();
    let gap = Infinity; { const p = V(), q2 = V(); const tv = hand.set.thumb[2].filter((_, i) => i % 2 === 0), iv = hand.set.index[2].filter((_, i) => i % 2 === 0);
      for (const a of tv) { hand.skinPt(a, p); for (const b of iv) { hand.skinPt(b, q2); gap = Math.min(gap, p.distanceTo(q2)); } } }
    const F = h.joint('lowerarm01.R').clone().sub(T).normalize();
    this.rep = { choice: G0.choice, indexGapMm: +m.fingers.index.gapMm.toFixed(2), thumbGapMm: +m.fingers.thumb.gapMm.toFixed(2), penMm: +m.maxPenMm.toFixed(2),
      padsMm: +(iPad2.distanceTo(tPad2) * 1000).toFixed(1), tipGapMm: +(gap * 1000).toFixed(2) };
    log('atrest: pinch ' + JSON.stringify(this.rep));
    this.local = { T, A, D, F };
    return this.local;
  }
  // place him so the pinch lands on the drop's tail: tail { p (m, drop frame), t (unit tangent) }, view (the lens's forward, drop frame)
  place(tail, view = V(0, 0, -1)) {
    const { T, A, D, F } = this.local, Ad = tail.t.clone().normalize();
    let best = null; const lowerRight = V(1, -1, 0).normalize(), toLens = view.clone().negate();
    for (const sgn of [1, -1]) { const q1 = new THREE.Quaternion().setFromUnitVectors(A, Ad.clone().multiplyScalar(sgn));   // a thread is pinched either way round
      for (let k = 0; k < 360; k++) {
        const q = new THREE.Quaternion().setFromAxisAngle(Ad, k / 360 * Math.PI * 2).multiply(q1);
        const Dd = D.clone().applyQuaternion(q), Fd = F.clone().applyQuaternion(q);
        // the pads may turn up to ~25 deg toward the lens (still edge-on enough that they never face it); the arm comes in from the lower
        // right and from behind the tail (toward the window), never between the tail and the lens
        const score = -4 * Math.max(0, Math.abs(Dd.dot(view)) - 0.42) + Fd.dot(lowerRight) - 1.5 * Math.max(0, Fd.dot(toLens) + 0.1);
        if (!best || score > best.score) best = { score, q, Dd, Fd };
      } }
    this.q = best.q; this.t = tail.p.clone().sub(T.clone().applyQuaternion(best.q));
    this.approach = best.Fd.clone();                                              // the hand comes in along the forearm
    this.rep.edgeOn = +(90 - Math.acos(Math.min(1, Math.abs(best.Dd.dot(view)))) * 180 / Math.PI).toFixed(1);   // degrees off edge-on
    this.rep.armImage = [+best.Fd.x.toFixed(2), +best.Fd.y.toFixed(2), +best.Fd.z.toFixed(2)];
    return this;
  }
  // per frame: enter 0..1 (from 40 mm back along the forearm), close 0..1 (the pinch); visible
  pose({ enter = 1, close = 1, visible = true } = {}) {
    const P = this.P, h = P.h; h.group.visible = visible; if (!visible) return;
    h.group.quaternion.copy(this.q); h.group.position.copy(this.t).addScaledVector(this.approach, 0.04 * (1 - enter));
    this.hand.restore(this.arm); this.hand.pose(this.G, close);
    afterPose7(P); h.group.updateMatrixWorld(true);
  }
}

// ---------------------------------------------------------------- the nine walkers
export class Walkers {
  constructor() { this.list = []; }
  async build(scene, { log = console.log, names = WALKERS.map(w => w.name) } = {}) {
    for (const w of WALKERS.filter(x => names.includes(x.name))) {
      let P = null;
      try { P = await mk(w.name, { fine7: false }, log); } catch (e) { log(`atrest: walker ${w.name} FAILED ${e.stack || e}`); continue; }
      P.h.group.position.set(w.from[0], 0, w.from[1]); P.h.update();
      let act = null;
      try { act = new WalkTurn7(P, { from: w.from, dir: 1, dist: 60, face: Math.PI / 2, speedK: w.speedK, startPhase: (w.start * 0.73) % 1 }); }
      catch (e) { log(`atrest: walker ${w.name} act FAILED ${e.message || e}`); }
      scene.add(P.h.group); this.list.push({ w, P, act });
    }
    return this;
  }
  pose(tLocal) {
    for (const { P, act, w } of this.list) { if (!act) continue; try { act.frame(tLocal + w.start); afterPose7(P); } catch (e) { if (!this._warned) { console.log('atrest: walk frame', e.message); this._warned = true; } } }
  }
  get people() { return this.list.map(x => x.P); }
}
