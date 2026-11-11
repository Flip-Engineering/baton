// ACTING on the dressed people (MOTION c3, round 7; one current version): the acts of the studio, on act6.js's skeleton, gait, grips and hands.
//   LiftCarry7   a WEIGHTED carry: the box held high and close (the forearms near horizontal under it), the lean back SOLVED from the load (act6.js _solveLean: the person's own segment masses and the box's
//                over the feet), the box bobbing on the arms at each step, a loading-response knee, the shoulders drawn round the load, the hands as a person's hands (act6.js), and the PALMS FITTED to the box's
//                bottom (a closed-loop search of each hand's height, roll and pitch in the box's frame: the nearest palm skin meets the bottom and the thenar and thumb are not pressed through it)
//   Wave7        the arm is DRIVEN up (a joint-space plan: the upper arm turns up and out, the elbow flexes, at the minimum-jerk speed), held and waved (the wave's posture in the person's own joint angles and segment lengths), then LET GO: the drive falls over the lowering and the arm's own weight, tone and damping (armdyn.js ArmDyn: the person's masses) drop it, overshoot it and ring it down; the hand under tone (toneHand7: the finger cascade, the wrist extended); the FREE arm hangs from the moving shoulder as the same chain (it answers the body); the trunk and pelvis rock with the wave, a head tilt, the eyes on the camera, the smile built before the arm rises
//   WalkTurn7    gait6's walk, stop and turn with the face arc, and the arms alive after the turn (not rigid)
//   Dress7       the idle on a dressed stance with the HANGING arms alive (the commanded posture drifts: elbow bend, hands forward or back, finger curl, each person and side its own; the arm hangs from the moving shoulder as a double pendulum with muscle tone: armdyn.js ArmChain); a GESTURE arm on some figures
//   FACE ARC     per act, on channels the old tracks did not carry: brow (MakeHuman's eyebrows-*-down: concentration), squint (eye-*-slit: effort, or the cheek of a real smile), platysma (neck tension in the
//                lift) beside the smile (mouth-corner-puller): small and never a grin (smile <= 0.24, brow <= 0.31)
//   CLIPS7, actFor7, personOpts7, angles7 (the elbow / hip / trunk-lean / shoulder angles from the skeleton, derive.angles' definitions), applyFace7 (the lab and the integrator apply a track's face channels)
// Every act is a pure function of t when its frames are called in order from t = 0 (the grips and the lean are solved at first use).
import * as THREE from 'three';
import { HeroPoser6, WalkTurn6, LiftCarry6, Wave6, Dress6, handQW, wristForW, restHand7, handFan, HAND_REST7, CLIPS6 } from './act6.js';
import { box as sdfBox } from '../rig/sdf.js';
import { noise1, hash, seedOf, settleHand, lookHead } from './life.js';
import { ArmChain, armTable, minJerk } from './armdyn.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Qt = () => new THREE.Quaternion();
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smoother = x => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (a, b, x) => smoother((x - a) / (b - a));
const TAU = Math.PI * 2;
const errOf = e => String((e && e.message) || e).slice(0, 160);

// ---------------------------------------------------------------- the face channels (small, never a grin)
// MakeHuman's expression units on the hero body (the brow, lash and beard cards carry the same morph deltas, so they move with the skin):
// brow = eyebrows-left/right-down (1.0 = the full unit: a frown; the arcs below use <= 0.28), squint = eye-left/right-slit (<= 0.16), platysma = neck-platysma (<= 0.25),
// smile = mouth-corner-puller (FACE6's channel: <= 0.24). No jaw, no teeth, no corners down: a person concentrating, straining, pleased.
export const FACE7 = ['brow', 'squint', 'platysma'];
export function applyFace7(h, get) {
  const E = h.exprIndex, inf = h.body && h.body.morphTargetInfluences; if (!E || !inf) return;
  const set = (k, v) => { if (E[k] != null) inf[E[k]] = v || 0; };
  set('mouth-corner-puller', get('smile'));
  const b = get('brow'); set('eyebrows-left-down', b); set('eyebrows-right-down', b);
  const s = get('squint'); set('eye-left-slit', s); set('eye-right-slit', s);
  set('neck-platysma', get('platysma'));
}
// the arcs (t seconds; T the act's own times)
export function arcLift(t, T) {
  const u = (a, b) => ease(a, b, t);
  const focus = u(0.15, 0.9) * (1 - u(1.5, 2.0)), effort = u(1.45, 2.05) * (1 - u(2.7, 3.3)), carry = u(3.3, 4.0) * (1 - u(T.tStop - 0.2, T.tStop + 0.5)), rel = u(T.tStop + 0.05, T.tStop + 0.9);
  // (the glance at the viewer after the stop settles the brow a hair (0.03) and takes the squint of a person pleased to be done (0.11): a wide-eyed glance reads as a stare)
  return { brow: 0.07 * focus + 0.24 * effort + 0.07 * carry + 0.03 * rel, squint: 0.03 * focus + 0.14 * effort + 0.04 * carry + 0.11 * rel, platysma: 0.22 * effort + 0.06 * carry, smile: 0.1 * rel };
}
export function arcWalk(t, W) {
  const u = (a, b) => ease(a, b, t), face = u(W.ts + 0.1, W.tTurn + 0.9), walk = 1 - u(W.ts - 0.2, W.ts + 0.5);
  return { brow: 0.05 * walk * u(0.2, 0.8), squint: 0.05 * face, smile: 0.11 * face };
}

// ---------------------------------------------------------------- skeleton angles (derive.angles' definitions on our joints, 3-D, y up)
export function angles7(h) {
  const J = n => h.joint(n), ang = (a, b, c) => { const u = a.clone().sub(b), v = c.clone().sub(b); return Math.acos(clamp(u.dot(v) / ((u.length() * v.length()) || 1), -1, 1)) * 180 / Math.PI; };
  const sh = { L: J('upperarm01.L'), R: J('upperarm01.R') }, el = { L: J('lowerarm01.L'), R: J('lowerarm01.R') }, wr = { L: J('wrist.L'), R: J('wrist.R') };
  const hp = { L: J('upperleg01.L'), R: J('upperleg01.R') }, kn = { L: J('lowerleg01.L'), R: J('lowerleg01.R') };
  const shM = sh.L.clone().add(sh.R).multiplyScalar(0.5), hpM = hp.L.clone().add(hp.R).multiplyScalar(0.5), tr = shM.clone().sub(hpM), mean = f => (f('L') + f('R')) / 2;
  const r1 = x => +x.toFixed(1);
  return { elbow: r1(mean(s => 180 - ang(sh[s], el[s], wr[s]))), hip: r1(mean(s => 180 - ang(hp[s].clone().add(tr), hp[s], kn[s]))),
    trunk: r1(Math.acos(clamp(tr.y / (tr.length() || 1), -1, 1)) * 180 / Math.PI), shoulderElev: r1(mean(s => ang(sh[s].clone().sub(tr), sh[s], el[s]))) };
}

// the arm's chain (armdyn.js) of one side of an armSet7 (created at first use, the person's own tone and damping from the seed)
export const chainOf7 = (h, hp, a, sd) => a.chain ||= new ArmChain(h, hp, sd, { seed: a.seed ?? 1 });
// ---------------------------------------------------------------- arm life for a hanging arm (elbow bend, hand forward or back, finger curl: seeded per person and per side)
const ARM_RE = {}; for (const s of ['L', 'R']) ARM_RE[s] = new RegExp(`^(clavicle|shoulder01|upperarm0|lowerarm0|wrist|finger|metacarpal).*\\.${s}$`);
// armSet7: each person's and each side's hanging arm (seeded): the elbow bend, the hand forward or back, the finger curl, the phase of its drift; the hands rest at the resting fan (HAND_REST7).
// A GESTURE arm (gest = 'L' | 'R'): REFMEASURE counts a standing figure as hanging when BOTH arms hang; the photographs' clothed standing people do something with one arm 63 % of the time. The gesture arm: the upper arm
// out from the trunk (the elbow clear of the garment), the forearm brought forward and up, turned toward the body's midline until the hand is at the front of the chest, the hand open and drifting on a 3.5-6 s cycle,
// a small conversational beat of the forearm that comes and goes.
export function armSet7(seed, gest = null) {
  const r = k => hash(seed >>> 0, 900 + k), side = k => ({ out: 0.07 + 0.10 * r(k), back: (r(k + 1) - 0.5) * 0.14, elb: 0.14 + 0.24 * r(k + 2), rel: 0.65 + 0.4 * r(k + 3), ph: TAU * r(k + 4), seed: seed >>> 0 });
  const A = { L: side(1), R: side(11) };
  if (gest === 'L' || gest === 'R') A[gest].g = { out: 0.64 + 0.10 * r(21), back: -(0.08 + 0.14 * r(22)), elb: 1.15 + 0.22 * r(23), rel: 0.5 + 0.25 * r(24), per: 3.5 + 2.5 * r(25), in: 0.42 + 0.14 * r(26), add: 0.46 + 0.08 * r(27), up: 0.42 + 0.12 * r(28), beat: 0.14 + 0.06 * r(29), tx: 0.19 + 0.04 * r(30) };
  return A;
}
// hp: a HeroPoser6 on h; the hanging arms re-solved with their own bend, drifting slowly; w < 1 blends from the pose the bones hold now (a settle into it)
export function armLife7(h, hp, t, A, w = 1, c = null, skip = null) {
  for (const sd of ['L', 'R']) { const a = A[sd], bones = h.bones.filter(B => ARM_RE[sd].test(B.name)), q0 = bones.map(B => B.quaternion.clone());
    if (a.g) { const g = a.g, lift = noise1(t / g.per + a.ph, 21);   // (the gesture arm: the forearm rises and falls a little on its slow cycle, the elbow out a hair more as it rises)
      hp.hang(sd, { out: g.out + 0.03 * lift + 0.03 * noise1(t * 0.13 + a.ph, 5), back: g.back + 0.05 * noise1(t * 0.1 + a.ph, 7), elbow: g.elb + 0.2 * lift + 0.05 * noise1(t * 0.31 + a.ph, 9), palm: 'in', relax: g.rel });
      const sg = sd === 'L' ? 1 : -1;
      if (g.in) { h.rotateWorld(`lowerarm01.${sd}`, hp.dirW(V3(0, 1, 0)), -sg * g.in * (1 + 0.12 * lift)); h.update(); }
      if (g.add) { h.rotateWorld(`upperarm01.${sd}`, hp.dirW(V3(0, 0, 1)), -sg * g.add * (1 + 0.15 * lift)); h.update(); }   // (the whole arm in toward the trunk, about the forward axis through the shoulder)
      if (g.up) { const bt = g.beat * Math.max(0, noise1(t * 0.45 + a.ph, 33)) * Math.sin(TAU * 0.8 * t + a.ph); h.rotateWorld(`lowerarm01.${sd}`, hp.dirW(V3(1, 0, 0)), -(g.up * (1 + 0.35 * lift) + bt)); h.update(); }   // (the forearm up about the lateral axis, a beat that comes and goes)
      if (g.tx) for (let it = 0; it < 3; it++) {   // (closed loop: the forearm turned about the vertical through the elbow until the hand is g.tx metres (x the person's scale) from the midline: the carrying angle of the kinematic arm sent L03's hand 3 cm OUT of his elbow, toward his neighbour)
        const mid = (hp.local(h.joint('upperarm01.L')).x + hp.local(h.joint('upperarm01.R')).x) / 2, w = hp.local(h.joint(`wrist.${sd}`)), e = hp.local(h.joint(`lowerarm01.${sd}`)), xw = sg * (w.x - mid), r = Math.hypot(w.x - e.x, w.z - e.z);
        const d = clamp((xw - g.tx * hp.sx) / Math.max(0.08, r), -0.7, 0.7); if (Math.abs(d) < 0.012) break; h.rotateWorld(`lowerarm01.${sd}`, hp.dirW(V3(0, 1, 0)), -sg * d); h.update(); }
      if (g.in) hp._palm(sd, hp.dirW(V3(-sg * 0.45, 0.85, 0.25).normalize()), 0.9); }
    else {   // (the hanging arm: the posture the person COMMANDS drifts slowly; the arm HANGS from the moving shoulder as a double pendulum under gravity with the person's own masses and its muscle tone (armdyn.js): it answers the weight shifts, the sway, the trunk's rock. `skip`: an arm the act drives itself (the wave's), which only gets its hang posture here)
      const cmd = { out: a.out + 0.02 * noise1(t * 0.11 + a.ph, 5), back: a.back + 0.03 * noise1(t * 0.09 + a.ph, 7), elbow: a.elb + 0.06 * noise1(t * 0.13 + a.ph, 9) };
      hp.hang(sd, { out: cmd.out, back: cmd.back, elbow: cmd.elbow, palm: 'in', relax: a.rel });
      if (!(skip && skip.includes(sd))) { a.defl = chainOf7(h, hp, a, sd).follow(t, 0); } }
    if (c && c.hands) settleHand(h, sd, c.hands[sd === 'L' ? 0 : 1]);
    if (w < 0.999) { const q1 = bones.map(B => B.quaternion.clone()); bones.forEach((B, i) => B.quaternion.copy(q0[i]).slerp(q1[i], w)); }
    h.update(); restHand7(h, sd, HAND_REST7); }
  h.update();
}

// ---------------------------------------------------------------- LIFT and CARRY with weight (act6's LiftCarry6, its parameters LIFT)
// boxUp / boxOut (x the person's scale, m): the box carried high and a little OUT from the chest (the box follows the chest in depth, act6.js: Bc.z = chest.z + 0.135 + d / 2 + boxOut, so the lean back does not pull it away;
// the height is what bends the elbows: the forearms near horizontal). leanBones / pelvisPitch / shoulder: the SHAPE of the lean (how it is shared down the trunk and the clavicles; act6.js _solveLean sets its amplitude);
// headDown: head pitch added with the lean; pole: the elbow hint of the under-grip (the elbows down and tucked); bob: the box's weight arriving at each step; lr: the carry's loading-response dip; stepK / cadK: the loaded gait
// (a short careful step); side: the side grip's frame (the wrists swing out clear of the box's rear corner, the fingertips hook the face and its lower edge); regripStag: the hands re-grip one after the other, so the box is
// never left with both hands off it.
// the hand laid flat for the fit (fingers straight to a few degrees, the thumb at rest): the palm's distance to the box is read on THIS hand, the fingers' sinking too
const FLAT7 = { index: [0.05, 0.05, 0.02], middle: [0.05, 0.05, 0.02], ring: [0.05, 0.05, 0.02], pinky: [0.05, 0.05, 0.02], spread: {}, thumb: [0, 0, 0, 0] };
export class LiftCarry7 extends LiftCarry6 {
  constructor(P, o = {}) { super(P, o); this.fit = {}; this.rep.act = 'LiftCarry7'; this.rep.w7 = { ...this.W }; this.rep.fits = {}; }
  // the palm-facing skin of one hand: the palm set's vertices whose bind normal faces the palm normal
  _palmFace(sd) { const R = this.rig[sd]; if (R._pf7) return R._pf7; const h = this.h, H = h._hand0(sd), N = h.nrm;
    R._pf7 = R.set.palm.filter(v => N[v * 3] * H.n.x + N[v * 3 + 1] * H.n.y + N[v * 3 + 2] * H.n.z > 0.55); return R._pf7; }
  // the signed distances (m) of the palm-facing skin to the box (the hand refreshed): min, lower quartile, median
  _palmGap(sd, sdf) { const R = this.rig[sd], p = V3(), d = []; for (const v of this._palmFace(sd)) d.push(sdf.d(R.skinPt(v, p))); d.sort((a, b) => a - b); const n = d.length;
    return n ? { min: d[0], p25: d[n >> 2], p50: d[n >> 1], n } : { min: NaN, p25: NaN, p50: NaN, n: 0 }; }
  // one trial of the fit: the hand put on the 'under' grip at this roll and pitch, its height (dy, in the box's frame) iterated until the nearest palm skin is 0.6 mm off the bottom.
  // the hand is laid FLAT (FLAT7) for the measure, and the deepest finger skin is read beside the thumb's (fp, th: m, < 0 inside the box)
  _trial(sd, M, pole, roll, pitch, sdf) { const key = 'under' + sd, R = this.rig[sd]; let dy = 0, g = null;
    for (let it = 0; it < 4; it++) { this.fit[key] = { dy, roll, pitch }; this._reach(sd, this._gripWorld('under', sd, M), pole); R.apply(FLAT7); g = this._palmGap(sd, sdf);
      const e = g.min - 0.0006; if (!(Math.abs(e) > 0.0003) || it === 3) break; dy += e; }
    const th = Math.min(R.minD(R.set.thumb[0], sdf).d, R.minD(R.set.thumb[1], sdf).d);
    let fp = Infinity; for (const f of ['index', 'middle', 'ring', 'pinky']) for (const ids of R.set[f]) fp = Math.min(fp, R.minD(ids.length > 30 ? ids.filter((_, k) => k % 3 === 0) : ids, sdf).d);   // (every third skin vertex: the fit runs 35 trials a hand)
    return { dy, roll, pitch, g, th, fp }; }
  _fitUnder(sd, M, pole) {
    const key = 'under' + sd, R = this.rig[sd], B = this.box, h = this.h, sdf = sdfBox(M, V3(B.w / 2, B.h / 2, B.d / 2), 0.004);
    const snap = R.snap(), fsnap = R.handBoneList().map(([b]) => b ? b.quaternion.clone() : null); let best = null;
    for (const pitch of (this.W.pitches || [0])) for (const roll of this.W.rolls) { const r = this._trial(sd, M, pole, roll, pitch, sdf);
      if (!(r.g.min === r.g.min)) continue;   // (no palm vertices: nothing to fit)
      // the palm as a whole (its median and lower quartile, not only its nearest vertex), the thumb and the fingers not sunk, the small preference for the plain frame (no roll, the flat pitch 0.13)
      const cost = Math.max(0, r.g.p50 - 0.004) * 1500 + Math.max(0, r.g.p25 - 0.003) * 2500 + Math.max(0, -r.th - 0.004) * 1000 + Math.max(0, -r.fp - 0.0015) * 3000 + Math.abs(roll) * 1.5 + Math.abs(pitch - 0.13) * 4;
      if (!best || cost < best.cost) best = { ...r, cost }; }
    R.restore(snap); R.handBoneList().forEach(([b], i) => { if (b && fsnap[i]) b.quaternion.copy(fsnap[i]); }); h.update();
    if (!best) throw new Error('no palm skin');
    this.fit[key] = { dy: best.dy, roll: best.roll, pitch: best.pitch };
    this.rep.fits[key] = { dyMm: +(best.dy * 1000).toFixed(1), rollDeg: +(best.roll * 180 / Math.PI).toFixed(0), pitchDeg: +(best.pitch * 180 / Math.PI).toFixed(0), palmMinMm: +(best.g.min * 1000).toFixed(1), palmP25Mm: +(best.g.p25 * 1000).toFixed(1), palmP50Mm: +(best.g.p50 * 1000).toFixed(1),
      thumbDeepMm: +(best.th * 1000).toFixed(1), fingerDeepMm: +(best.fp * 1000).toFixed(1), cost: +best.cost.toFixed(2), n: best.g.n };
  }
  _close(kind, sd, M, pole, tag = '') {
    if (kind === 'under' && !this.fit['under' + sd]) {
      try { this._fitUnder(sd, M, pole); } catch (e) { this.fit['under' + sd] = { dy: 0.009, roll: 0 }; this.rep.err7 = 'fit ' + errOf(e); } }
    return super._close(kind, sd, M, pole, tag); }
  // the contact ruler with the palm gap (mm) added per hand: min, p25, p50 of the palm skin's distance to the box (< 0 inside)
  // tipMin (the nearest fingertip skin) is kept per hand for the support count; torso = the nearest torso / neck / clavicle skin to the box (mm, < 0 inside: the box in the chest)
  _torso() { if (this._ti7) return this._ti7; const h = this.h, g = h.body.geometry, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, n = g.attributes.position.count, bn = h.skeleton.bones, ids = [];
    for (let v = 0; v < n; v += 2) { let bi = SI[v * 4], bw = SW[v * 4]; for (let q = 1; q < 4; q++) if (SW[v * 4 + q] > bw) { bw = SW[v * 4 + q]; bi = SI[v * 4 + q]; } if (/^(spine|pelvis|root|neck|clavicle|breast|stomach|belly)/.test(bn[bi].name)) ids.push(v); }
    return (this._ti7 = ids); }
  contact(M) { const out = super.contact(M), B = this.box, sdf = sdfBox(M, V3(B.w / 2, B.h / 2, B.d / 2), 0.004);
    for (const sd of ['L', 'R']) { try { const g = this._palmGap(sd, sdf); out[sd].palmMin = +(g.min * 1000).toFixed(1); out[sd].palmP25 = +(g.p25 * 1000).toFixed(1); out[sd].palmP50 = +(g.p50 * 1000).toFixed(1); } catch (e) { out[sd].palmErr = errOf(e); }
      try { const F = handFan(this.h, sd); out[sd].fan = F.fan.map(x => +x.toFixed(1)); out[sd].thumb = +F.thumb.toFixed(0); } catch (e) { out[sd].fanErr = errOf(e); } }   // (rev 7e: the fingers' fan and the thumb's angle to the index, deg)
    try { const h = this.h, p = V3(); let m = Infinity; for (const v of this._torso()) { h.body.getVertexPosition(v, p); p.applyMatrix4(h.body.matrixWorld); m = Math.min(m, sdf.d(p)); } out.torso = +(m * 1000).toFixed(1); } catch (e) { out.torsoErr = errOf(e); }
    return out; }
  // after the stop the lifter GLANCES at the viewer (the camera is on the person's right: the head and eyes turn that way): the act's last beat, with the small release smile
  _post7(t, phase, c, eff) { if (t > this.tStop + 0.05) { const g = ease(this.tStop + 0.1, this.tStop + 0.8, t); lookHead(this.h, -0.8 * g, -0.02 * g); } }
  // the lifter's effort channels, one arc for everyone (arcLift): the brow stays under 0.31 and the smile under 0.14: a person straining, never a frown or a grin. (A per-person strength, faceK 1.25 for L17 whose landmarker
  // reading was 'at rest', was a number tuned to one person's measurement: deleted 15 Oct; a face that reads at rest under effort is the face system's to fix)
  _chan7(t, phase, c) { const a = arcLift(t, { tStop: this.tStop }), g = ease(this.tStop + 0.2, this.tStop + 0.9, t);
    return { brow: Math.min(0.31, a.brow), squint: Math.min(0.2, a.squint), platysma: Math.min(0.3, a.platysma), smile: Math.min(0.14, Math.min(0.1, c.smile * 0.5) + a.smile), eyeYaw: c.eyeYaw * 0.3 - 0.3 * g }; }
}

// ---------------------------------------------------------------- the WAVE: the arm is DRIVEN up, held and waved, then LET GO; the other arm hangs and answers the body's motion
// the hand beside the head, swinging; the trunk and pelvis rocking with it; the weight onto the leg away from the waving arm; a head tilt, the eyes on the camera, the smile built before the arm rises.
// THE WAVE ARM is one arm model with the hanging arms (armdyn.js): the act PLANS the arm (the upper arm turns up and out from where it hangs to the wave's posture by the minimal rotation, the elbow flexes and the
// forearm turns in the upper arm's frame, at the minimum-jerk speed, the person's two-bone arm solved to the planned elbow and wrist, the fingers opening as it goes) and the arm FOLLOWS the plan while the person drives it (DRIVE 1: the raise, the hold, the wave);
// when the wave ends the person lets go: the drive falls over the lowering and the arm's own weight and tone take over (gravity does the work of the lowering, so it is not the raise run backwards; the arm
// overshoots the hang a little and rings down at the natural frequency of the person's own masses). Between waves, and after, it hangs on its tone like the other arm.
// THE WAVE'S POSTURE is SOLVED (wavePosture7, below): the open hand at the eye line, the upper arm in the scapular plane, the forearm vertical, the least elevation that reaches: four joint angles that fall out of the
// person's own arm lengths and eyes (a long arm waves lower and straighter); and THE SHOULDER GIRDLE follows the arm (girdleRhythm7: the scapulohumeral rhythm). THE HAND is a hand under tone (toneHand7): the fingers
// curled by the relaxed cascade (the index least, the little finger most), each person's own, the wrist extended.
export const WAVE7 = { rhythm: 1, swing: 0.33, lean: 0.035, rock: 0.007, tilt: 0.16, hand: { tone: [0.55, 0.85], ext: 0.22 }, rel: 0.25 };
// The posture is NOT in this table any more: wavePosture7 solves it from the goal (the open hand seen at the eye line, beside the head) and the arm's own physics (the person's segment masses and
// lengths: the posture that costs the least gravity torque at the shoulder and the elbow among those that put the hand there). `a7: { elev, plane, flex, rot }` (joint angles, rad) still OVERRIDES a solved
// angle (an A/B, a director's pose); `a7: { yGoal }` moves the goal (m above the shoulder joint).
// ---------------------------------------------------------------- THE WAVE'S POSTURE FROM A GOAL AND THE ARM'S OWN PHYSICS (c5 iteration 1)
// The greeting is a SIGNAL: the open hand must be seen by the person it greets: near the line of the eyes, clear of the head's silhouette. How the arm gets it there is the body's business, and it is
// worked out from the person's own arm, not set: (1) the upper arm is raised in the SCAPULAR PLANE, 30 deg in front of the frontal plane, where the capsule is least twisted and the arm rises with the least
// effort (Johnston 1937; Dvir and Berme 1978); (2) the FOREARM IS HELD VERTICAL: its weight then lies over the elbow (zero elbow torque) and the wave's swing about it is symmetric, so the mean effort of
// the whole gesture is least; (3) the upper arm is raised only as far as the hand needs: the gravity torque of the arm's mass about the shoulder grows with sin(elevation) below the horizontal, so the least
// effort that puts the centre of the open hand at the goal height is the LOWEST elevation that does: cos(elev) = (L2 + hc - yGoal) / L1 (L1, L2 the person's upper arm and forearm; hc the hand's centre
// from the wrist; yGoal the goal height over the shoulder joint, the eye line), capped at the horizontal (the elbow does not go above the shoulder in a greeting; a person whose arm cannot reach the goal
// below it raises the elbow as far as it must). The elbow's flexion then is pi - elevation (the angle between the upper arm and the vertical forearm); a long arm waves lower and straighter, a short one
// higher and more bent, a person whose eye line stands high over the shoulder higher, all of it from the person. T: armTable; yGoal / hc in m; rom: the elbow's range (rad).
export const WAVEGOAL7 = { plane: 0.5236, cap: 1.5708, max: 2.0 };
export function wavePosture7(T, { yGoal, hc, rom = 2.53, plane = WAVEGOAL7.plane } = {}) {
  const { L1, L2 } = T, c = (L2 + hc - yGoal) / L1;            // cos(elev) at which the vertical forearm's hand centre is at the goal
  let elev = Math.acos(Math.max(-1, Math.min(1, c))), capped = false;
  if (c < 0) { /* the goal is above the horizontal-arm reach: the elbow rises until it is met (or the person's max) */ elev = Math.min(WAVEGOAL7.max, elev); capped = elev >= WAVEGOAL7.max - 1e-6; }
  else if (c > 1) { elev = 0.35; }                              // (the goal is under the hanging arm's own hand: the least raise a greeting has)
  elev = Math.max(0.35, elev); let flex = Math.PI - elev; flex = Math.min(flex, rom - 0.17);
  const handY = -L1 * Math.cos(elev) + L2 + hc, g = 9.81;
  const tauSh = g * (T.m1 * T.l1 + T.m2 * T.L1) * Math.sin(elev);   // (the shoulder's gravity torque, for the report: the vertical forearm's weight hangs over the elbow, a lever L1 sin(elev))
  return { elev, plane, flex, rot: 0, handY, effortNm: tauSh, reached: handY >= yGoal - 1e-4 && !capped };
}
// ---------------------------------------------------------------- THE SHOULDER GIRDLE'S RHYTHM (scapulohumeral rhythm, c5 iteration 1)
// The arm does not turn on a fixed trunk: beyond the first ~30 deg of elevation (the setting phase: Inman, Saunders and Abbott 1944) the scapula turns upward about 0.5 deg for each degree of humeral
// elevation, the clavicle elevates about 0.17 and retracts about 0.2 (Ludewig et al. 2009, Mc Clure et al. 2001: scapular-plane elevation to 120 deg: scapular upward rotation ~45-50, clavicular elevation 11-15,
// retraction ~15-20). In this skeleton the clavicle turns about the sternoclavicular joint and `shoulder01` (the acromioclavicular end: the scapula's) carries the glenohumeral joint: the glenoid rises and
// the shoulder shrugs with the arm, for every raised arm (the wave, the box held up, a gesture). The senses are found on the skeleton (closed loop: the joint is nudged and the sign kept that moves it
// the way the rhythm says), so a hero with its bones the other way round is no problem.
export const RHYTHM7 = { set: 0.5236, scap: 0.5, clavUp: 0.17, clavBack: 0.2 };
const _rsign = new WeakMap();
function signFor(h, side, label, bone, axisOf, joint, wantOf) {
  let C = _rsign.get(h); if (!C) _rsign.set(h, C = {}); const key = label + side; if (C[key] != null) return C[key];
  const B = h.bone(`${bone}.${side}`), q0 = B.quaternion.clone(); h.update(); const j0 = h.joint(`${joint}.${side}`);
  h.rotateWorld(`${bone}.${side}`, axisOf(), 0.05); h.update(); const d = h.joint(`${joint}.${side}`).sub(j0); B.quaternion.copy(q0); h.update();
  return C[key] = Math.sign(d.dot(wantOf())) || 1;
}
export function girdleRhythm7(h, hp, side, elev, k = 1) {
  const s = Math.max(0, elev - RHYTHM7.set) * k, up = V3(0, 1, 0), fw = hp.dirW(V3(0, 0, 1));
  const sc = signFor(h, side, 'scap', 'shoulder01', () => fw, 'upperarm01', () => up), cl = signFor(h, side, 'clavUp', 'clavicle', () => fw, 'upperarm01', () => up), cb = signFor(h, side, 'clavBack', 'clavicle', () => up, 'upperarm01', () => fw.clone().negate());
  const a = { scap: RHYTHM7.scap * s, clavUp: RHYTHM7.clavUp * s, clavBack: RHYTHM7.clavBack * s };
  if (a.clavUp > 1e-5) { h.rotateWorld(`clavicle.${side}`, fw, cl * a.clavUp); }
  if (a.clavBack > 1e-5) { h.rotateWorld(`clavicle.${side}`, up, cb * a.clavBack); }
  if (a.scap > 1e-5) { h.rotateWorld(`shoulder01.${side}`, fw, sc * a.scap); }
  h.update(); return a;
}
// the relaxed hand's cascade of flexion (rad per joint at tone 1, the index least curled, the little finger most; hero.js relaxHand's table): MCP, PIP, DIP
const CASCADE7 = { 2: [0.22, 0.42, 0.2], 3: [0.32, 0.55, 0.26], 4: [0.42, 0.66, 0.3], 5: [0.52, 0.76, 0.34], 1: [0.12, 0.22, 0.2] };
// a hand under tone: every finger joint reset, then each finger curled by the cascade x the hand's tone x its own factor (seeded, drifting slowly: the tone of a raised hand is never the same in two fingers or two seconds);
// the wrist extended (the extensors hold the raised hand back from the forearm): closed loop on the skeleton, the fingers move toward the dorsum
export function toneHand7(h, s, { tone = 0.6, seed = 1, t = 0, ext = 0.3, extK = 1 } = {}) {
  const r = (k, m) => hash(seed >>> 0, 300 + k + (s === 'L' ? 0 : 40) + m);
  for (const n of [1, 2, 3, 4, 5]) for (let k = 1; k <= 3; k++) { const B = h.bone(`finger${n}-${k}.${s}`); if (B) B.quaternion.identity(); }
  for (const n of [1, 2, 3, 4, 5]) for (let k = 1; k <= 3; k++) { const j = `finger${n}-${k}`, B = h.bone(`${j}.${s}`); if (!B) continue;
    const f = 1 + 0.3 * (r(n, 0) - 0.5) * 2 + 0.12 * noise1(t * 0.6 + n * 1.7 + r(n, 9) * 6, 17 + n); B.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(h._flexAxis(s, j), CASCADE7[n][k - 1] * tone * f)); }
  h.update();
  if (ext) { const P = h.palm(s), fing = () => h.joint(`finger3-1.${s}`).sub(h.joint(`wrist.${s}`)).normalize(), f0 = fing(), W = `wrist.${s}`;
    h.rotateWorld(W, P.a, 0.05); h.update(); const toward = Math.sign(fing().sub(f0).dot(P.n)) || 1; h.rotateWorld(W, P.a, -0.05); h.update();
    h.rotateWorld(W, P.a, -toward * ext * extK); h.update(); }   // (toward = +1 when a positive turn about the palm's lateral axis moves the fingers to the palm's side; the extension turns the other way)
}
export class Wave7 extends Wave6 {
  constructor(P, o = {}) { super(P, o); this.A = { ...WAVE7, ...(o.a7 || {}) }; this.other = this.side === 'L' ? 'R' : 'L'; this.A7 = armSet7(this.seed, null); this.rep.act = 'Wave7'; this.rep.a7 = { ...this.A };
    const r = k => hash(this.seed >>> 0, 1300 + k), T = this.A.hand.tone; this.handTone = T[0] + (T[1] - T[0]) * r(1); this.rep.hand = { tone: +this.handTone.toFixed(2) };
    this.solvePosture7();
    // THE GREETING ENDS WITH A GLANCE AWAY: the person is on the viewer from just before the arm rises until it goes down; as the lowering begins the person's own gaze takes the eyes and head back (Life.force: the eyes jump first,
    // the head follows 60 ms behind; the direction and size from the person's seed, the glance statistics), so the body is not left square to the viewer with nothing moving
    this.tGlance = this.tDown + 0.3; const g = this.L.force(this.tGlance, { look: 1, salt: 7 }); this.rep.glance = { t: +this.tGlance.toFixed(2), yawDeg: +(g.yaw * 57.3).toFixed(1), pitchDeg: +(g.pitch * 57.3).toFixed(1), holdS: +g.d.toFixed(2) }; }
  // the wave's posture from the goal (wavePosture7) on THIS person's arm at its stance: the eye line over the shoulder joint, the open hand's length, the elbow's range (any joint angle in a7 overrides the solved one)
  solvePosture7() {
    const h = this.h, s = this.side, sx = this.hp.sx, A = this.A; h.update();
    const T = armTable(h, this.hp, s), eyeY = (h.joint('eye.L').y + h.joint('eye.R').y) / 2, shY = h.joint(`upperarm01.${s}`).y, handLen = h.joint(`wrist.${s}`).distanceTo(h.joint(`finger3-3.${s}`)) + 0.035 * sx;
    const rom = (this.hp.K?.rom?.elbowFlex?.deg ?? 145) * Math.PI / 180, yGoal = A.yGoal ?? (eyeY - shY);
    const S = wavePosture7(T, { yGoal, hc: 0.5 * handLen, rom, plane: A.plane ?? WAVEGOAL7.plane });
    this.post = { elev: A.elev ?? S.elev, plane: A.plane ?? S.plane, flex: A.flex ?? S.flex, rot: A.rot ?? S.rot };
    this.rep.post = { elevDeg: +(this.post.elev * 180 / Math.PI).toFixed(1), flexDeg: +(this.post.flex * 180 / Math.PI).toFixed(1), rotDeg: +(this.post.rot * 180 / Math.PI).toFixed(1), planeDeg: +(this.post.plane * 180 / Math.PI).toFixed(0),
      yGoalCm: +(yGoal * 100).toFixed(1), handCm: +(S.handY * 100).toFixed(1), effortNm: S.effortNm != null ? +S.effortNm.toFixed(2) : null, reached: S.reached, solved: A.elev == null }; }
  // the girdle's elevation (rad of the arm's, what girdleRhythm7 takes): the plan's while the person DRIVES the arm; when the drive lets go, a damped follower of the plan at the wave arm's own f0 and zeta (armdyn.js: from the
  // person's masses and tone), carrying the velocity the drive had. STATEFUL (frames in order, as every act); a gap restarts it on the plan
  _girdle7(t, target, drive) {
    const G = this._gs || (this._gs = { e: target, v: 0, t }), dt = t - G.t; G.t = t;
    if (dt <= 1e-6 || dt > 0.34) { G.e = target; G.v = 0; return G.e; }
    if (drive >= 0.999) { G.v = (target - G.e) / dt; G.e = target; return G.e; }
    const ch = this.chainW, w = 2 * Math.PI * (ch?.dyn.f0Hz ?? 1), z = ch?.zeta ?? 0.35, n = Math.max(1, Math.ceil(dt * 240)), hs = dt / n;
    for (let i = 0; i < n; i++) { G.v += (-w * w * (G.e - target) - 2 * z * w * G.v) * hs; G.e += G.v * hs; }
    return G.e; }
  frame(t) { return this._frame7(t); }
  _frame7(t) {
    const h = this.h, hp = this.hp, s = this.side, sg = s === 'L' ? 1 : -1, o = this.other, c = this.L.sample(t), A = this.A;
    const wsh = ease(this.tShift, this.t0 + 0.2, t) * (1 - ease(this.tDown + 0.3, this.tEnd + 0.6, t));
    c.weight = lerp(c.weight * 0.5, this.wTarget, wsh);
    // the PLAN's progress: the hand goes (the raise begins a quarter second before the wave's own clock, so it takes ~0.85 s) and comes back (the plan of the lowering)
    const up = ease(this.t0 - 0.25, this.tUp, t) * (1 - ease(this.tDown, this.tEnd, t));
    // the DRIVE: the muscles take the arm just before the plan moves and keep it through the wave; when the lowering begins the person lets go (the drive falls over the lowering)
    const drive = ease(this.t0 - 0.45, this.t0 - 0.25, t) * (1 - ease(this.tDown + A.rel, this.tEnd, t));
    // ENGAGEMENT: the person's gaze is on the viewer from before the arm rises (t0 - 0.5 .. t0 + 0.2) until the lowering begins (tDown .. tDown + 0.3); the drawn glances are silent while it holds and the person's
    // own gaze (the called glance above, then Life's drawn ones) has the head and eyes after it (the head had stayed square to the viewer for the rest of the clip)
    const eng = ease(this.t0 - 0.5, this.t0 + 0.2, t) * (1 - ease(this.tDown, this.tGlance, t));
    c.yaw *= 1 - eng; c.pitch *= 1 - eng; c.eyeYaw *= 1 - 0.8 * eng; c.eyePitch *= 1 - 0.8 * eng;
    const tw = t - this.tUp, envW = t > this.tUp && t < this.tDown ? Math.sin(Math.PI * clamp(tw / (this.tDown - this.tUp))) ** 0.5 : 0;
    const wv = Math.sin(TAU * this.hz * tw) * envW, wl = Math.sin(TAU * this.hz * tw - 1.0) * envW, bs = Math.sin(TAU * this.hz * 0.5 * tw) * envW;
    c.sway = [c.sway[0] + A.rock * hp.sx * bs, c.sway[1]];   // the pelvis rocks at half the wave's rate (the feet stay planted: Life's IK)
    this.L.apply(t, { channels: c });
    const q = Qt(); h.group.getWorldQuaternion(q); const fwd = V3(0, 0, 1).applyQuaternion(q);
    // the BODY first (the girdle lifts and the trunk leans as the arm rises), then both arms at their own hanging posture hung from the moved shoulders (the free arm's chain answers the body's motion; the wave arm is
    // only posed here: the act drives it), then the wave arm's plan
    // (the girdle is driven with the arm and RELEASED with it: once the person lets go, the shoulder girdle falls back on its own tone, a second-order follower at the arm's own natural frequency and damping, so the shoulders settle after the arm instead of snapping square with the plan)
    const eNow = 0.2 + (this.post.elev - 0.2) * minJerk(up), eG = this._girdle7(t, eNow, drive);
    if (eG > RHYTHM7.set + 1e-4) { try { this.rep.rhythm = girdleRhythm7(h, hp, s, eG, A.rhythm ?? 1); } catch (er) { this.rep.err7 = 'rhythm ' + errOf(er); } }
    if (up > 0.001) { h.rotateWorld('spine04', fwd, sg * A.lean * up); h.update(); }
    try { armLife7(h, hp, t, this.A7, 1, c, [s]); } catch (er) { this.rep.err7 = 'arms ' + errOf(er); }
    if (up > 0.001) {
      // the hanging posture the wave arm leaves (this frame's), the fingers at rest
      const S0 = h.joint(`upperarm01.${s}`), E0 = h.joint(`lowerarm01.${s}`), W0 = h.joint(`wrist.${s}`), q0 = Qt(); h.bone(`wrist.${s}`).getWorldQuaternion(q0);
      const Fb = this.armBones.filter(B => /^(finger|metacarpal)/.test(B.name)), F0 = Fb.map(B => B.quaternion.clone());
      const lat = hp.dirW(V3(1, 0, 0)), fw = hp.dirW(V3(0, 0, 1)), L1 = S0.distanceTo(E0), L2 = E0.distanceTo(W0), e = minJerk(up), out = lat.clone().multiplyScalar(sg);
      // the wave's posture from the person's own arm: the upper arm raised to elevation `elev` in the plane `plane` in front of the frontal one, the forearm flexed by `flex` and turned forward by `rot` about the upper arm
      const u1h = E0.clone().sub(S0).normalize(), u2h = W0.clone().sub(E0).normalize();
      const PO = this.post, u1w = V3(0, -Math.cos(PO.elev), 0).addScaledVector(out.clone().multiplyScalar(Math.cos(PO.plane)).addScaledVector(fw, Math.sin(PO.plane)), Math.sin(PO.elev)).normalize();
      const pu = V3(0, 1, 0).addScaledVector(u1w, -u1w.y).normalize(), pf = fw.clone().addScaledVector(u1w, -fw.dot(u1w)).addScaledVector(pu, -fw.dot(pu)).normalize();
      const u2w = u1w.clone().multiplyScalar(Math.cos(PO.flex)).addScaledVector(pu.clone().multiplyScalar(Math.cos(PO.rot)).addScaledVector(pf, Math.sin(PO.rot)), Math.sin(PO.flex)).normalize();
      // the PLAN in joints (the arm goes up as a person raises it: the shoulder turns the upper arm up and out by the minimal rotation, the elbow flexes and the forearm turns in the upper arm's frame, both at the minimum-jerk speed)
      const Qs = new THREE.Quaternion().setFromUnitVectors(u1h, u1w), Qe = Qt().slerp(Qs, e), u1 = u1h.clone().applyQuaternion(Qe);
      const u2r = u2w.clone().applyQuaternion(Qs.clone().invert()), Qf = new THREE.Quaternion().setFromUnitVectors(u2h, u2r), u2 = u2h.clone().applyQuaternion(Qt().slerp(Qf, e)).applyQuaternion(Qe).applyAxisAngle(fw, -sg * A.swing * wv * e).normalize();
      const Wt = S0.clone().addScaledVector(u1, L1).addScaledVector(u2, L2), ax = Wt.clone().sub(S0).normalize(), pl = u1.clone().addScaledVector(ax, -u1.dot(ax));
      const fW = V3(sg * (0.1 + 0.42 * wv + 0.36 * wl), 1, 0.1).normalize(), nW = V3(sg * 0.05 * wl, 0.08, 1).normalize(), qL = handQW(h, s, fW, nW), qe = q0.clone().slerp(qL, e);
      hp.arm(s, Wt, qe, pl.lengthSq() > 1e-4 ? pl.normalize() : hp.dirW(V3(sg * 0.5, -0.8, -0.2).normalize()));
      toneHand7(h, s, { tone: this.handTone, seed: this.seed, t, ext: A.hand.ext, extK: e });
      const F1 = Fb.map(B => B.quaternion.clone()); Fb.forEach((B, i) => B.quaternion.copy(F0[i]).slerp(F1[i], e)); h.update();
    }
    // the wave arm's chain: it follows the plan while it is driven, hangs on its tone before and after, and falls when it is let go
    try { this.chainW ||= chainOf7(h, hp, this.A7[s], s); this.dev = this.chainW.follow(t, drive); } catch (er) { this.rep.err7 = 'wave arm ' + errOf(er); }
    // the head tilts toward the wave; the eyes on the camera (c.eyeYaw damped above)
    const tilt = ease(this.t0 + 0.1, this.tUp + 0.2, t) * (1 - ease(this.tDown + 0.1, this.tEnd + 0.4, t));
    if (tilt > 0) { const hq = Qt(); h.bone('head').getWorldQuaternion(hq); const hf = V3(0, 0, 1).applyQuaternion(hq); h.rotateWorld('head', hf, -sg * A.tilt * tilt); h.rotateWorld('neck02', hf, -sg * 0.05 * tilt); h.update(); }
    // the arc: the smile builds BEFORE the arm rises (recognition), peaks with the wave with the cheek (squint) of a real smile, and leaves a trace
    const sm = ease(this.t0 - 0.35, this.tUp + 0.2, t) * (1 - ease(this.tDown + 0.4, this.tEnd + 1.4, t)), after = ease(this.tDown, this.tEnd + 0.6, t);
    const smile = Math.min(0.24, c.smile * 0.5 + 0.19 * sm + 0.05 * after * (1 - sm));
    return { g: [h.group.position.x, h.group.position.z, h.group.rotation.y], phase: up > 0.99 ? 'wave' : up > 0 ? 'raise' : wsh > 0 ? 'shift' : 'stand',
      c: { eyeYaw: c.eyeYaw, eyePitch: c.eyePitch, smile, blink: c.blink, breath: c.breath, weight: c.weight, brow: 0, squint: 0.12 * sm, platysma: 0 }, toe: hp.toeHeights() };
  }
}

// ---------------------------------------------------------------- the WALK, stop and turn (act6's) with the face arc and arms that are alive after the turn
export class WalkTurn7 extends WalkTurn6 {
  constructor(P, o = {}) { super(P, o); this.rep.act = 'WalkTurn7'; this.A7 = armSet7(this.seed, null); }
  frame(t) {
    const out = super.frame(t), a = arcWalk(t, { ts: this.ts, tTurn: this.tTurn });
    const w = ease(this.tEnd - 0.3, this.tEnd + 0.8, t);
    if (w > 0.001) { try { armLife7(this.h, this.hp, t, this.A7, w, this.life.at(t)); } catch (e) { this.rep.err7 = 'arms ' + errOf(e); } }
    out.c = { ...out.c, brow: a.brow, squint: a.squint, platysma: 0, smile: Math.min(0.16, (out.c.smile ?? 0) + a.smile) };
    return out;
  }
}

// ---------------------------------------------------------------- the IDLE on a dressed stance, the hanging arms alive
export class Dress7 extends Dress6 {
  constructor(P, o = {}) { super(P, o); this.hangs = !this.rec.arms || this.rec.arms === 'hang'; this.seed7 = o.seed ?? seedOf(P.info?.name || 'i'); this.A7 = armSet7(this.seed7, this.hangs ? o.gest : null);
    if (this.hangs) { try { this.hp7 = new HeroPoser6(P.h, { kin: !!P.h.meta?.kin, person: P.p }); this.L.apply(0); } catch (e) { this.hangs = false; this.err = errOf(e); } }
    this.rep.act = 'Dress7'; this.rep.armLife = this.hangs; this.rep.gest = this.hangs && o.gest || null; if (this.err) this.rep.err7 = this.err; }
  frame(t) {
    const out = super.frame(t), c = out.c;
    if (this.hangs) { try { armLife7(this.h, this.hp7, t, this.A7, 1, this.L.sample(t)); } catch (e) { this.rep.err7 = 'arms ' + errOf(e); } }
    out.c = { ...c, brow: 0.05 * Math.max(0, noise1(t * 0.2, this.seed7 + 31)), squint: 0.5 * (c.smile || 0), platysma: 0 };
    return out;
  }
}

// ---------------------------------------------------------------- the MOTION c3 clips (plain data: the bake tools and the lab share it)
// the same people as MOTION c2's clips (so before | after compare). A clip names NO garment bake and NO pose keys: the people are the CURRENT person (makePerson's own chain of garment bakes, CLOTH9's seat and sleeve fall
// on them) and the garments move with the act by the cloth layers baked in place (cloth_motion.js: the spring and contact layers over the skinned garments). (Until 15 Oct a clip pinned CLOTH7's v7c / motion6 garments and
// CLOTH's pose keys made for the 8 Oct wave's raised pose: the keys were stale the day the posture changed, and the sleeves tore.)
const clip7 = (C, o) => { const { bake, keys, ...r } = C; return { ...r, ...o }; };
export const CLIPS7 = {
  // two of the three figures whose arms would hang (L12, L03; L23 keeps both hanging, alive) get a gesture arm (armSet7), one a woman and one a man
  row7: clip7(CLIPS6.row6, { act: 'dress7', place: { L12_f39_white: { gest: 'R' }, L03_m38_asian: { gest: 'L' } } }),
  walk7: clip7(CLIPS6.walk6, { act: 'walkturn7' }),
  lift7: clip7(CLIPS6.lift6, { act: 'lift7' }),
  wave7: clip7(CLIPS6.wave6, { act: 'wave7', dur: 5.6,
    place: { L14_f42_black: { side: 'R', x: -0.55, n: 4, hz: 2.0 }, L03_m38_asian: { side: 'R', x: 0.55, t0: 1.05, n: 4, hz: 2.0 } } }),
};
export function actFor7(clip, P, name, extra = null) { const C = CLIPS7[clip], o = { ...(C.place?.[name] || {}), ...(extra || {}) };   // (extra: { w7: {...} } overrides LIFT7's options, the sweep lab's variants; null = the clip as it is)
  if (C.act === 'wave7' && o.x != null) { P.h.group.position.x = o.x; P.h.group.updateMatrixWorld(true); }
  return C.act === 'dress7' ? new Dress7(P, o) : C.act === 'wave7' ? new Wave7(P, o) : C.act === 'lift7' ? new LiftCarry7(P, o) : new WalkTurn7(P, o); }
// the person options of a clip's people: NONE that choose a garment bake (the person system's current chain does); the acts that stand the person in the stance (wave, lift, walk) say so (pose: false), the row keeps the
// person's dressed arm poses (folded, clasped, a pocket, a hip: the dressed pose's own bake, CLOTH8's v8c/dress7)
export function personOpts7(clip, name, extra = {}) { const C = CLIPS7[clip]; return { ...(C.act === 'dress7' ? {} : { pose: false }), ...extra }; }
