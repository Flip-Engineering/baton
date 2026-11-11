// MOTION / HERO POSER (HUMAN c7): the motion layer's intents on hero.js bodies, with the HandRig owning the hands.
// MOTION c1's Poser turns intents (pelvis, spine, head, feet on the ground, hands on the work) into a people.js pose. Hero bodies
// (MakeHuman skeleton, 163 bones) took none of it: every hero was posed by hand. HeroPoser takes the SAME spec (local figure frame:
// metres, x = the figure's left, y up, z forward) and solves it on hero bones: the pelvis placed and tipped, the bend spread down
// the five spine bones, the head on the neck, two-bone IK on each leg to put the sole where the act says (the foot keeps its
// orientation: no skating), two-bone IK on each arm to a wrist TARGET that the tool supplies.
//
// The tool owns the hands (ToolGrip): once, at a reference pose, HandRig.planNatural chooses how each hand takes the handle (the
// approach that keeps the wrist sane), settle/fit close the fingers on its SDF; the grip is stored as the wrist's transform in the
// TOOL's frame plus the finger joints. Each frame the tool's transform (from the act) carries the wrist targets; the arm IK reaches
// them; the wrist is set to the stored orientation and the fingers to their fitted curl. A sliding hand moves along the handle axis.
//
//   const hp = new HeroPoser(hero);                      hero placed with group.position = base, group.rotation.y = heading
//   const tg = new ToolGrip(hero, [{ side, at: u along the handle, grip: 'power' }], handleSdfAt(T))   (T: tool Matrix4 at the reference pose)
//   per frame: hp.solve(spec); tg.apply(T, { slide: { R: du } }); hero.update()
//
// HUMAN c8 lane F (opt-in): new HeroPoser(h, { kin: true }) on a hero built from a person (lane A's castBody: h.meta.kin) adopts the person's
// kinematic model through rig/person_kin.js: the knees and elbows keep to the person's own range (the soft-tissue flexion limit of a heavy
// body; hyperextension when a foot spec or an arm asks to `lock`), an arm that holds something keeps the person's carrying angle at the elbow
// (the wrist stays on its target), and the pose helpers below take the person's stance, masses and gait. Without { kin } (or with a hero
// that has none) every method here does exactly what it did before. The helpers work either way (without kin: generic terms, the bench's).
//   hp.stand({ palms: 'in' | 'forward', lock })   a two-footed stance at the person's ankle spacing and toe-out, knees locked to the person's
//                                                 own hyperextension, arms hanging (palms forward shows the carrying angle)
//   hp.carryLoad({ kg, side })                   a bucket in one hand: the trunk leans away until the COM of body + load is over the feet
//                                                 (the person's segment masses, or Dempster at 75 kg without kin)
//   hp.reachLow({ target })                      a reach to the floor: the stoop that keeps hip and knee flexion inside the person's ranges
//                                                 (soft knees; a heavy body whose thighs meet its belly bends the knees and spreads them)
//   hp.gait(t, o)                                a walk cycle in place at the person's step, cadence, step width, pelvic obliquity, sway
//   hp.gaitTerms()                               the terms it uses (kin, or the bench's generic walk)
import * as THREE from 'three';
import { HandRig } from '../rig/hand.js';
import { cylinder } from '../rig/sdf.js';
import { kinOf, twoBoneKin, hingeOf, carrying, armFrame, heroPoints, heroCom } from '../rig/person_kin.js';
import { SEGMENTS, com as comOf } from '../rig/balance.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), Q = () => new THREE.Quaternion();
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const SPINE = [['spine05', 0.12], ['spine04', 0.22], ['spine03', 0.26], ['spine02', 0.22], ['spine01', 0.18]];

export class HeroPoser {
  constructor(h, { kin = false, person = null } = {}) {
    this.h = h; h.resetPose(); h.update();
    this.K = kin ? kinOf(h, { kin: kin === true ? null : kin, person }) : null;   // HUMAN c8 lane F: the person's kinematic model, opt-in
    // bind data in the figure's local frame (metres): ankle heights and sole offsets, the root height, limb lengths
    const L = n => this.local(h.joint(n));
    this.ank0 = { L: L('foot.L'), R: L('foot.R') }; this.root0 = L('root'); this.hip0 = L('upperleg01.L').add(L('upperleg01.R')).multiplyScalar(0.5);
    this.fq0 = { L: this._wq('foot.L'), R: this._wq('foot.R') };
    this.legLen = h.joint('upperleg01.L').distanceTo(h.joint('lowerleg01.L')) + h.joint('lowerleg01.L').distanceTo(h.joint('foot.L'));
    this.armLen = h.joint('upperarm01.R').distanceTo(h.joint('lowerarm01.R')) + h.joint('lowerarm01.R').distanceTo(h.joint('wrist.R'));
    this.hipHalf0 = Math.abs(L('upperleg01.L').x - this.hip0.x);   // HUMAN c8 lane F (the gait helper)
    this.rep = {};
  }
  // world <-> the figure's local frame (the group's position and heading, NOT its scale: local is in metres)
  local(w) { const g = this.h.group; return w.clone().sub(g.position).applyAxisAngle(V3(0, 1, 0), -g.rotation.y); }
  world(l) { const g = this.h.group; return l.clone().applyAxisAngle(V3(0, 1, 0), g.rotation.y).add(g.position); }
  dirW(l) { return l.clone().applyAxisAngle(V3(0, 1, 0), this.h.group.rotation.y); }
  _wq(n) { this.h.update(); const q = Q(); this.h.bone(n).getWorldQuaternion(q); return q; }
  _setWQ(n, qw) { const B = this.h.bone(n), pq = Q(); B.parent.getWorldQuaternion(pq); B.quaternion.copy(pq.invert().multiply(qw)); this.h.update(); }
  // two-bone IK on hero joints a -> b -> c, the end at `target` (world), bending toward `pole` (world direction)
  twoBone(a, b, c, target, pole) {
    const h = this.h; h.update();
    const A = h.joint(a), B = h.joint(b), C = h.joint(c), L1 = A.distanceTo(B), L2 = B.distanceTo(C);
    const d = clamp(A.distanceTo(target), Math.abs(L1 - L2) + 1e-4, (L1 + L2) * 0.999);
    const ax = target.clone().sub(A).normalize(), pl = pole.clone().addScaledVector(ax, -pole.dot(ax)).normalize();
    const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    const Bt = A.clone().addScaledVector(ax, L1 * cosA).addScaledVector(pl, L1 * sinA);
    const aim = (bone, from, cur, to) => { const u = cur.clone().sub(from).normalize(), v = to.clone().sub(from).normalize(), axis = V3().crossVectors(u, v), s = axis.length(); if (s < 1e-7) return; h.rotateWorld(bone, axis.normalize(), Math.atan2(s, u.dot(v))); h.update(); };
    aim(a, A, B, Bt); aim(b, h.joint(b), h.joint(c), target);
    return h.joint(c).distanceTo(target);
  }
  // spec: as motion/poser.js (LOCAL, metres): pelvis { p (hips joint centre), yaw, pitch, roll }, spine { flex, bend, twist },
  // head { pitch, yaw, roll }, feet [L, R] { p (ankle point on the ground plan: x, z; y = 0 floor), yaw, pitch (toe up), lift (m) },
  // shoulders { L: raise, R: raise } (clavicle elevation, rad)
  solve(S) {
    const h = this.h, sc = h.scale, up = V3(0, 1, 0), fwd = this.dirW(V3(0, 0, 1)), lat = this.dirW(V3(1, 0, 0));
    h.resetPose(); h.update();
    const pv = S.pelvis || {};
    // the pelvis: move the root so the hips' centre lands on p, then tip it (about the hips' centre)
    if (pv.p) { const d = pv.p.clone().sub(this.hip0), R = h.bone('root'); R.position.add(d.multiplyScalar(1 / sc)); h.update(); }
    const hipC = () => h.joint('upperleg01.L').add(h.joint('upperleg01.R')).multiplyScalar(0.5);
    const tip = (axis, ang) => { if (!ang) return; const c0 = hipC(); h.rotateWorld('root', axis, ang); h.update(); const c1 = hipC(); h.bone('root').position.add(this.local(c0).sub(this.local(c1)).multiplyScalar(1 / sc)); h.update(); };
    tip(up, pv.yaw || 0); tip(lat, pv.pitch || 0); tip(fwd, -(pv.roll || 0));
    // the spine: flex (about the body's lateral axis, + forward), bend (+ to the left), twist (+ chest to the left), shared down the column
    const sp = S.spine || {};
    for (const [n, k] of SPINE) { if (sp.flex) h.rotateWorld(n, lat, sp.flex * k); if (sp.bend) h.rotateWorld(n, fwd, -sp.bend * k); if (sp.twist) h.rotateWorld(n, up, sp.twist * k); }
    h.update();
    const hd = S.head || {};
    for (const [n, k] of [['neck01', 0.45], ['head', 0.55]]) { if (hd.pitch) h.rotateWorld(n, lat, hd.pitch * k); if (hd.yaw) h.rotateWorld(n, up, hd.yaw * k); if (hd.roll) h.rotateWorld(n, fwd, -hd.roll * k); }
    if (S.shoulders) for (const s of ['L', 'R']) { const r = S.shoulders[s] || 0; if (r) h.rotateWorld(`clavicle.${s}`, fwd, (s === 'L' ? 1 : -1) * r); }
    h.update();
    // the legs: the ankle on its ground point (bind ankle height + lift), the foot turned by yaw and pitched about the ball
    this.rep.feet = {};
    if (S.feet) S.feet.forEach((f, k) => { if (!f) return; const s = k ? 'R' : 'L', sg = k ? -1 : 1, a0 = this.ank0[s];
      const qf = Q().setFromAxisAngle(up, f.yaw || 0).multiply(Q().setFromAxisAngle(lat, -(f.pitch || 0))).multiply(this.fq0[s]);
      const tgt = this.world(V3(f.p.x, a0.y + (f.lift || 0) + (f.pitch ? 0.06 * Math.sin(Math.abs(f.pitch)) : 0), f.p.z));
      const pole = this.dirW(V3(Math.sin(f.yaw || 0) + sg * (f.kneeOut ?? 0.15), 0, Math.cos(f.yaw || 0)));
      if (this.K) { const r = twoBoneKin(h, `upperleg01.${s}`, `lowerleg01.${s}`, `foot.${s}`, tgt, pole, { ...hingeOf(this.K, 'knee'), lock: f.lock || 0 }); this._setWQ(`foot.${s}`, qf); this.rep.feet[s] = { missMm: r.miss * 1000, kneeFlex: r.flex, clamped: r.clamped }; return; }
      const miss = this.twoBone(`upperleg01.${s}`, `lowerleg01.${s}`, `foot.${s}`, tgt, pole); this._setWQ(`foot.${s}`, qf); this.rep.feet[s] = { missMm: miss * 1000 }; });
    h.update();
    return this.rep;
  }
  // an arm to a wrist target (world position, world quaternion); pole: elbow hint (world direction)
  arm(side, pos, q, pole, o = {}) { const K = this.K, miss = K ? twoBoneKin(this.h, `upperarm01.${side}`, `lowerarm01.${side}`, `wrist.${side}`, pos, pole, { ...hingeOf(K, 'elbow'), lock: o.lock || 0 }).miss
      : this.twoBone(`upperarm01.${side}`, `lowerarm01.${side}`, `wrist.${side}`, pos, pole);
    if (q) { // the forearm takes most of the roll the wrist needs (pronation lives in the forearm, not the wrist): split it
      const qw = this._wq(`wrist.${side}`), dq = q.clone().multiply(qw.clone().invert()), ax = this.h.joint(`wrist.${side}`).sub(this.h.joint(`lowerarm01.${side}`)).normalize();
      const v = V3(dq.x, dq.y, dq.z), twist = 2 * Math.atan2(v.dot(ax), dq.w); this.h.rotateWorld(`lowerarm02.${side}`, ax, twist * 0.6); this.h.update(); this._setWQ(`wrist.${side}`, q);
      // HUMAN c8 lane F: the person's carrying angle at this flexion and supination, the wrist kept on its target and in its orientation
      if (K && o.carry !== false) { this.rep.carry ||= {}; this.rep.carry[side] = carrying(this.h, side, K, { pole, keep: 'wrist', target: pos }); this._setWQ(`wrist.${side}`, q); return this.h.joint(`wrist.${side}`).distanceTo(pos); } }
    return miss; }

  // ---------------------------------------------------------------- HUMAN c8 lane F: pose helpers (the person's kin when this.K, else generic)
  get sx() { return this.h.o.height / 1.7; }
  // roll a forearm (and the wrist) so the palm normal turns toward `want` (world): workforce.js's palmToward
  _palm(side, want, k = 0.8) { const h = this.h;
    for (let it = 0; it < 2; it++) { const E = h.joint(`lowerarm01.${side}`), axis = h.joint(`wrist.${side}`).sub(E).normalize();
      const ww = want.clone().addScaledVector(axis, -want.dot(axis)).normalize(), sa = n => { const nn = n.clone().addScaledVector(axis, -n.dot(axis)).normalize(); return Math.atan2(V3().crossVectors(nn, ww).dot(axis), nn.dot(ww)); };
      h.rotateWorld(`lowerarm01.${side}`, axis, sa(h.palm(side).n) * k); h.update(); h.rotateWorld(`wrist.${side}`, axis, sa(h.palm(side).n)); h.update(); } }
  // an arm hanging from its shoulder: out (rad, abduction), back (rad), elbow (rad), palm 'in' | 'forward' | 'back', lock (0..1, kin only);
  // with kin the carrying angle is then set at the elbow (keep 'upper': the hand carries out from the hip as far as the angle says)
  hang(side, { out = 0.1, back = 0.03, elbow = 0.2, palm = 'in', lock = 0, relax = 0.85, reach = 0.999 } = {}) {
    const h = this.h, sg = side === 'L' ? 1 : -1, lat = this.dirW(V3(1, 0, 0)), fwd = this.dirW(V3(0, 0, 1)), S = h.joint(`upperarm01.${side}`), E = h.joint(`lowerarm01.${side}`), Wr = h.joint(`wrist.${side}`);
    const L1 = S.distanceTo(E), L2 = E.distanceTo(Wr), dU = V3(0, -1, 0).addScaledVector(lat, sg * Math.tan(out)).addScaledVector(fwd, -Math.tan(back)).normalize();
    const Et = S.clone().addScaledVector(dU, L1), dF = dU.clone().applyAxisAngle(lat, -elbow).normalize(), tgt = Et.addScaledVector(dF, L2), pole = fwd.clone().negate().addScaledVector(lat, sg * 0.3).normalize();
    const T = S.clone().addScaledVector(tgt.clone().sub(S).normalize(), Math.min(S.distanceTo(tgt), (L1 + L2) * reach));
    this.arm(side, T, null, pole, { lock });
    const want = palm === 'forward' ? fwd.clone() : palm === 'back' ? fwd.clone().negate() : lat.clone().multiplyScalar(-sg).addScaledVector(fwd, -0.25).normalize();
    this._palm(side, want, palm === 'forward' ? 1 : 0.75);
    let c = null; if (this.K) c = carrying(h, side, this.K, { pole, keep: 'upper' });
    if (relax) h.relaxHand(side, relax, { cascade: true }); h.update(); return c;
  }
  // stance terms: the person's (ankle spacing from the 0.114 H rule and the corrected hip breadth, her own toe-out) or the bench's anat
  stanceTerms() { const K = this.K, s = this.sx;
    return K ? { ankleSep: K.F.stance.ankleSep, toe: K.F.stance.footAngle / 2 * Math.PI / 180, src: K.F.stance.src } : { ankleSep: 0.11 * s, toe: 0.14, src: 'figure bench anat (heels a hand apart)' }; }
  // the hips' height over two feet at +/- hx with the knees at flexion `flexDeg` (negative: hyperextended)
  _hipY(hx, flexDeg = 0) { const h = this.h; h.resetPose(); h.update();
    const hipX = Math.abs(this.local(h.joint('upperleg01.L')).x), L1 = h.joint('upperleg01.L').distanceTo(h.joint('lowerleg01.L')), L2 = h.joint('lowerleg01.L').distanceTo(h.joint('foot.L'));
    const d = Math.min(Math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(flexDeg * Math.PI / 180)), (L1 + L2) * 0.99995), dx = hipX - hx, dz = this.hip0.z - this.ank0.L.z;
    return this.ank0.L.y + Math.sqrt(Math.max(1e-6, d * d - dx * dx - dz * dz)) + (this.hip0.y - this.local(h.joint('upperleg01.L')).y); }
  stand({ palms = 'in', lock = 1, shift = 0, arms = true } = {}) {
    const K = this.K, s = this.sx, T = this.stanceTerms(), hx = T.ankleSep / 2, ext = K ? hingeOf(K, 'knee').ext * lock : 0;
    const py = K ? this._hipY(hx, -ext) : this.hip0.y - 0.004 * s;
    this.solve({ pelvis: { p: V3(this.hip0.x + shift, py, this.hip0.z) }, feet: [{ p: V3(hx, 0, this.ank0.L.z), yaw: T.toe, lock }, { p: V3(-hx, 0, this.ank0.R.z), yaw: -T.toe, lock }] });
    const rep = { ankleSep: T.ankleSep, toeOutDeg: 2 * T.toe * 180 / Math.PI, kneeExt: ext, carry: {} };
    if (arms) for (const sd of ['L', 'R']) rep.carry[sd] = this.hang(sd, palms === 'forward' ? { out: 0.12, back: 0.0, elbow: 0.0, palm: 'forward', lock: 1, relax: 0.5 } : { out: 0.1, back: 0.03, elbow: 0.22, palm: 'in' });
    this.rep.stand = rep; return rep;
  }
  // hip flexion and adduction of a thigh relative to the pelvis (deg), knee flexion (deg)
  _pelvisAxes() { const q = Q(); this.h.bone('root').getWorldQuaternion(q); return { down: V3(0, -1, 0).applyQuaternion(q), fwd: V3(0, 0, 1).applyQuaternion(q), lat: V3(1, 0, 0).applyQuaternion(q) }; }
  hipAngles(side) { const h = this.h; h.update(); const P = this._pelvisAxes(), d = h.joint(`lowerleg01.${side}`).sub(h.joint(`upperleg01.${side}`)).normalize(), sg = side === 'L' ? 1 : -1;
    const sh = h.joint(`foot.${side}`).sub(h.joint(`lowerleg01.${side}`)).normalize();
    return { flex: Math.atan2(d.dot(P.fwd), d.dot(P.down)) * 180 / Math.PI, add: Math.atan2(-sg * d.dot(P.lat), d.dot(P.down)) * 180 / Math.PI, knee: Math.acos(clamp(d.dot(sh), -1, 1)) * 180 / Math.PI }; }
  // the COM of the body (and a load) against the planted feet's support centre, in the figure's local frame (m)
  balanceErr({ load = null } = {}) { const K = this.K, segs = K ? K.F.segments : SEGMENTS, mass = K ? K.mass : (this.bodyKg || 75), P = heroPoints(this.h, K);
    const C = comOf(P, V3(), segs); if (load) C.multiplyScalar(mass).addScaledVector(load.p, load.kg).multiplyScalar(1 / (mass + load.kg));
    const ctr = P.heelL.clone().add(P.heelR).add(P.toL).add(P.toR).multiplyScalar(0.25); return { C: this.local(C), ctr: this.local(ctr), err: this.local(C).sub(this.local(ctr)) }; }
  // a pail in one hand: the free arm out, the trunk leaning away from the load until body + load balance over the feet
  carryLoad({ kg = 10, side = 'R', iters = 8, gain = 0.85 } = {}) {
    const K = this.K, s = this.sx, T = this.stanceTerms(), hx = K ? T.ankleSep / 2 : 0.07 * s, toe = K ? T.toe : 0.12, sgL = side === 'L' ? 1 : -1, other = side === 'L' ? 'R' : 'L', h = this.h;
    const mass = K ? K.mass : (this.bodyKg || 75), H = h.o.height;
    let bend = 0, px = 0, e = null, Pl = null;
    for (let it = 0; it < iters; it++) {
      this.solve({ pelvis: { p: this.hip0.clone().add(V3(px, -0.012 * s, 0)) }, spine: { bend }, head: { roll: -bend * 0.6 }, shoulders: { [side]: -0.06 - 0.004 * kg, [other]: 0.02 },
        feet: [{ p: V3(hx, 0, this.ank0.L.z), yaw: toe }, { p: V3(-hx, 0, this.ank0.R.z), yaw: -toe }] });
      this.hang(side, { out: 0.15 + 0.004 * kg, back: 0, elbow: 0.04, palm: 'in', relax: 0 }); this.hang(other, { out: 0.2 + 0.012 * kg, back: 0.02, elbow: 0.35, relax: 0.8 });
      h.relaxHand(side, 1.3, { cascade: false });
      Pl = h.joint(`wrist.${side}`).add(V3(0, -0.2 * s, 0)); e = this.balanceErr({ load: { p: Pl, kg } });
      if (Math.abs(e.err.x) < 0.002) break;
      bend += -e.err.x / (0.6 * 0.3 * H) * gain * 0.8; px += -e.err.x * gain * 0.25;
    }
    const sm = this.local(h.joint('upperarm01.L').add(h.joint('upperarm01.R')).multiplyScalar(0.5)), hp = this.local(h.joint('upperleg01.L').add(h.joint('upperleg01.R')).multiplyScalar(0.5));
    const rep = { kg, side, mass, leanDeg: Math.atan2(sm.x - hp.x, sm.y - hp.y) * 180 / Math.PI, comErrMm: e.err.x * 1000, pelvisShiftMm: px * 1000, spineBendDeg: bend * 180 / Math.PI, pail: Pl, src: K ? 'person (kin segments)' : 'Dempster, 75 kg' };
    void sgL; this.rep.carryLoad = rep; return rep;
  }
  // a reach to the floor with both hands (an object `target` in the local frame, hands `apart` m): the stoop with the least effort that keeps
  // hip flexion (thigh against trunk: the person's range, its soft-tissue limit) and knee flexion inside the ranges, the COM over the feet
  reachLow({ target = null, apart = null, pitches = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4], drops = [0, 0.04, 0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.36, 0.42] } = {}) {
    const K = this.K, s = this.sx, h = this.h, T = this.stanceTerms(), hx = Math.max(T.ankleSep / 2, 0.075 * s), toe = Math.max(T.toe, 0.12);
    const soft = K && K.rom.hipFlex.limitedBy === 'soft tissue', H = this.h.o.height, tg = target || V3(0, 0.25 * H, this.ank0.L.z + 0.23 * H), ap = apart ?? 0.26 * s, hipMax = K ? K.rom.hipFlex.deg : 120, kneeMax = K ? K.rom.kneeFlex.deg : 135;
    const pose = (pitch, drop, z) => { const kOut = 0.15 + 0.6 * clamp(drop / 0.3);
      this.solve({ pelvis: { p: V3(0, this.hip0.y - drop * this.legLen, this.hip0.z + z), pitch }, spine: { flex: 0.45 * pitch }, head: { pitch: -0.4 * pitch },
        feet: [{ p: V3(hx, 0, this.ank0.L.z), yaw: toe, kneeOut: kOut }, { p: V3(-hx, 0, this.ank0.R.z), yaw: -toe, kneeOut: kOut }] }); };
    let best = null; const tried = [];
    for (const pitch of pitches) for (const drop of drops) {
      let z = -0.1 * pitch * s; for (let it = 0; it < 3; it++) { pose(pitch, drop, z); const e = this.balanceErr(); if (Math.abs(e.err.z) < 0.004) break; z -= e.err.z * 0.9; }
      // the range binds on the thigh against the PELVIS when the joint limits it (CDC goniometry), against the TRUNK (the lumbar spine's
      // share of the bend added) when the soft tissue does (thigh meets belly)
      const A = this.hipAngles('L'), hipTrunk = A.flex + (soft ? 0.34 * 0.45 * pitch * 180 / Math.PI : 0), reach = ['L', 'R'].map(sd => h.joint(`upperarm01.${sd}`).distanceTo(this.world(tg.clone().add(V3((sd === 'L' ? 1 : -1) * ap / 2, 0, 0))))) ;
      const ok = Math.max(...reach) <= this.armLen * 0.995 && hipTrunk <= hipMax && A.knee <= kneeMax && Math.abs(this.balanceErr().err.z) < 0.03;
      // effort: knees soft (Durieu's stooping man: 25-48 deg), the trunk inclined but not past ~75 deg (the head below the hips is a fold,
      // not a reach), the hip off its end range, the arms not at full stretch
      const nk = this.local(h.joint('neck01')), hc = this.local(h.joint('upperleg01.L').add(h.joint('upperleg01.R')).multiplyScalar(0.5)), trunkDeg = Math.atan2(nk.z - hc.z, nk.y - hc.y) * 180 / Math.PI;
      const cost = Math.abs(A.knee - 38) / 30 + 0.4 * pitch + Math.max(0, trunkDeg - 80) / 8 + 2 * Math.max(0, hipTrunk - 0.9 * hipMax) / 10 + 0.5 * Math.max(0, Math.max(...reach) - this.armLen * 0.9) / 0.05;
      tried.push({ pitch, drop, z, ok, miss: Math.max(0, hipTrunk - hipMax) / 10 + Math.max(0, Math.max(...reach) - this.armLen * 0.995) / 0.02 }); if (ok && (!best || cost < best.cost)) best = { pitch, drop, z, cost, hipTrunk, hip: A.flex, knee: A.knee, kneeOut: 0.15 + 0.6 * clamp(drop / 0.3) };
    }
    // nothing inside the ranges reaches: take the closest (the least range overrun plus shortfall), and say so (the hands stop short)
    if (!best) { let bc = Infinity; for (const t of tried) if (t.miss < bc) { bc = t.miss; best = { ...t, cost: Infinity, outOfRange: true }; } }
    pose(best.pitch, best.drop, best.z);
    for (const sd of ['L', 'R']) { const sg = sd === 'L' ? 1 : -1, w = this.world(tg.clone().add(V3(sg * ap / 2, 0, 0))); this.arm(sd, w, null, this.dirW(V3(sg * 0.6, 0.4, -1)).normalize()); this._palm(sd, this.dirW(V3(-sg, -0.4, 0)).normalize(), 0.8); h.relaxHand(sd, 1.1, { cascade: true }); }
    const A = this.hipAngles('L'); h.update();
    const trunk = this.local(h.joint('neck01')).sub(this.local(h.joint('upperleg01.L').add(h.joint('upperleg01.R')).multiplyScalar(0.5)));
    const rep = { ...best, hip: A.flex, knee: A.knee, hipTrunk: A.flex + (soft ? 0.34 * 0.45 * best.pitch * 180 / Math.PI : 0), hipMax, kneeMax, hipLimitedBy: K ? K.rom.hipFlex.limitedBy : 'AAOS', trunkFromVerticalDeg: Math.atan2(trunk.z, trunk.y) * 180 / Math.PI,
      handMissMm: ['L', 'R'].map(sd => +(h.joint(`wrist.${sd}`).distanceTo(this.world(tg.clone().add(V3((sd === 'L' ? 1 : -1) * ap / 2, 0, 0)))) * 1000).toFixed(0)), target: tg, feasible: tried.filter(t => t.ok).length, tried: tried.length }; delete rep.miss;
    this.rep.reachLow = rep; return rep;
  }
  // ---- gait: a walk cycle in place (the ground moves under the stance foot), seekable: a pure function of t
  gaitTerms() { const K = this.K, s = this.sx, H = this.h.o.height, f = (this.h.meta?.variants?.[0]?.sex || this.h.o.sex || (K && K.sex)) === 'f';
    if (K) { const g = K.F.gait; return { step: g.stepLength, cadence: g.cadence, speed: g.speed, width: g.stepWidth, oblRangeDeg: g.pelvicObliquity, sway: g.sway, comVertPct: g.comVerticalPctLeg, armSwing: g.armSwing, toe: K.F.stance.footAngle / 2 * Math.PI / 180,
      yaw: 0.08, posture: g.posture, hipAddTarget: g.hipAdductionPeak, src: 'kin: Bohannon speed, Sekiya walk ratio, Smith 2002 obliquity, step width on Harrington' }; }
    const step = 0.41 * H, speed = 1.3; return { step, cadence: speed / step * 60, speed, width: 0.1 * s, oblRangeDeg: 2 * (f ? 0.05 : 0.03) * 180 / Math.PI, sway: 0.025 * s, comVertPct: 3.5, armSwing: 1, toe: 0.06, yaw: 0.09, posture: null, hipAddTarget: null,
      src: 'generic: the figure bench walk (step 0.41 H, roll 0.05 f / 0.03 m rad), 1.3 m/s' }; }
  gait(t, { phase = 0, terms = null } = {}) {
    const G = terms || this.gaitTerms(), s = this.sx, T = 120 / G.cadence, ph = (((t / T + phase) % 1) + 1) % 1, Ls = G.step, legLen = this.legLen, TAU = Math.PI * 2;
    // a foot as a rigid body on the moving ground: its flat-foot ankle point moves back at the walking speed through stance (heel strike at
    // +Ls/2), rolling over the heel (toe up) at strike and over the ball (heel up) from heel-off to toe-off; the swing carries the ankle from
    // where toe-off left it to where the next strike puts it. Returns the ankle (local) and the foot's pitch.
    const ay0 = this.ank0.L.y, zA = this.ank0.L.z, heel = 0.05 * s, ball = 0.13 * s;
    const rollAbout = (z, pitch, piv) => { const a = -pitch, r = piv === 'H' ? V3(0, ay0, heel) : V3(0, ay0, -ball), y = r.y * Math.cos(a) - r.z * Math.sin(a), zz = r.y * Math.sin(a) + r.z * Math.cos(a);
      const P0 = piv === 'H' ? z - heel : z + ball; return V3(0, y, P0 + zz); };
    const stanceAt = p => { const z = Ls * 0.5 - (p / 0.5) * Ls, pitch = p < 0.08 ? 0.25 * (1 - sstep(0, 0.08, p)) : p > 0.34 ? -0.75 * sstep(0.34, 0.6, p) : 0;
      return { A: pitch > 0 ? rollAbout(z, pitch, 'H') : pitch < 0 ? rollAbout(z, pitch, 'B') : V3(0, ay0, z), pitch }; };
    const foot = (p, sg) => { let A, pitch, stance = p < 0.6;
      if (stance) ({ A, pitch } = stanceAt(p));
      else { const u = (p - 0.6) / 0.4, e = u * u * u * (u * (u * 6 - 15) + 10), a0 = stanceAt(0.6), a1 = stanceAt(1e-6);
        A = a0.A.clone().lerp(a1.A, e); A.y += 0.06 * s * Math.pow(Math.sin(Math.PI * u), 1.3); pitch = a0.pitch + (a1.pitch - a0.pitch) * sstep(0.05, 0.95, u); }
      A.x = sg * G.width / 2; return { p: V3(A.x, 0, A.z + zA), yaw: sg * G.toe, pitch, lift: A.y - ay0 - (pitch ? 0.06 * Math.sin(Math.abs(pitch)) : 0), stance, A, ph: p }; };
    const fL = foot(ph, 1), fR = foot((ph + 0.5) % 1, -1);
    const obl = G.oblRangeDeg / 2 * Math.PI / 180 * Math.sin(TAU * (ph + 0.1)), yaw = -G.yaw * Math.cos(TAU * ph), sway = G.sway * Math.sin(TAU * ph);
    // the hips: the vertical excursion (highest at mid-stance), capped by what the stance legs reach (the hip joints moved by the roll and yaw)
    // (the top of the excursion: straight legs over feet at the step width, not the A-pose bind's lower hips)
    const top = this._gaitTop && this._gaitTop.w === G.width ? this._gaitTop.y : (this._gaitTop = { w: G.width, y: this._hipY(G.width / 2, 0) }).y;
    let py = top - 0.006 * s - G.comVertPct / 100 * legLen * 0.5 * (1 + Math.cos(2 * TAU * ph)) + (G.posture ? -G.posture.kneeBend * 0.05 * s : 0);
    const hx = this.hipHalf0, pz = this.hip0.z + 0.02 * s;
    for (const [f, sg] of [[fL, 1], [fR, -1]]) if ((f.stance && f.ph <= 0.52) || (!f.stance && f.A.y < this.ank0.L.y + 0.04 * s)) { const dx = sway + sg * hx * Math.cos(obl) - f.A.x, dz = pz + Math.abs(hx * Math.sin(yaw)) - (f.A.z + zA), dy0 = sg * hx * Math.sin(obl);
      const lim = f.A.y - dy0 + Math.sqrt(Math.max(0, (legLen * 0.999) ** 2 - dx * dx - dz * dz)); py = Math.min(py, lim); }
    // a swing foot out of the leg's reach (just after toe-off, the hips still rising) comes in along the leg: the knee bends, as it does
    for (const [f, sg] of [[fL, 1], [fR, -1]]) if (!f.stance || f.ph > 0.52) { const Hj = V3(sway + sg * hx, py + sg * hx * Math.sin(obl), pz), A = V3(f.A.x, f.A.y, f.A.z + zA), v = A.clone().sub(Hj), L = v.length(), Lm = legLen * 0.97;
      if (L > Lm) { A.copy(Hj).addScaledVector(v, Lm / L); f.p.set(A.x, 0, A.z); f.lift = A.y - ay0 - (f.pitch ? 0.06 * Math.sin(Math.abs(f.pitch)) : 0); } }
    const P = G.posture || {};
    this.solve({ pelvis: { p: V3(sway, py, pz), yaw, pitch: 0.06, roll: -obl }, spine: { flex: 0.03 + (P.kyphosis || 0) * 0.4, twist: -yaw * 1.3, bend: obl * 0.9 },
      head: { yaw: yaw * 0.3, pitch: -(P.headFwd || 0) * 0.3, roll: -obl * 0.3 },
      feet: [{ p: fL.p, yaw: fL.yaw, pitch: fL.pitch, lift: fL.lift }, { p: fR.p, yaw: fR.yaw, pitch: fR.pitch, lift: fR.lift }] });
    // arms swing against the legs, lagging a little; the elbow bends more as the arm comes forward
    for (const [sd, sg] of [['L', 1], ['R', -1]]) { const a = -sg * 0.3 * G.armSwing * Math.cos(TAU * (ph - 0.04)), fw = Math.max(0, a);
      this.hang(sd, { out: 0.1, back: -Math.tan(a) === 0 ? 0 : -a, elbow: 0.25 + 0.6 * fw, palm: 'in', relax: 0.9 }); }
    const add = { L: this.hipAngles('L').add, R: this.hipAngles('R').add };
    return { ph, stance: { L: fL.stance, R: fR.stance }, oblDeg: obl * 180 / Math.PI, swayM: sway, hipAdd: add, terms: G };
  }
}

// ---------------------------------------------------------------- a tool's grips, planned once by the HandRig, carried by the tool
// specs: [{ side, u (metres from the handle's end along +axis), grip: 'power', prefer, preferW, obj (the SDF the fingers close on, world at
// T0, when more than the handle is in reach: a D's stiles), roll (how far apply's free may turn the hand about the handle, rad: 1.2) }];
// handle: { L (length), r (radius) }
// T0: the tool's world Matrix4 at the reference pose (origin at the handle's end, +y along the handle toward the head)
export class ToolGrip {
  constructor(h, specs, { L = 0.9, r = 0.018 } = {}, T0) {
    this.h = h; this.specs = specs; this.L = L; this.r = r; this.g = {}; this.report = [];
    const T0i = T0.clone().invert(), o = V3().setFromMatrixPosition(T0), ax = V3(0, 1, 0).transformDirection(T0);
    for (const s of specs) {
      // open the hand, plan the approach, close the fingers on the handle's SDF (HUMAN c6's planNatural / settle / fit)
      for (let n = 1; n <= 5; n++) for (let k = 1; k <= 3; k++) { const B = h.bone(`finger${n}-${k}.${s.side}`); if (B) B.quaternion.identity(); }
      for (let n = 1; n <= 4; n++) { const B = h.bone(`metacarpal${n}.${s.side}`); if (B) B.quaternion.identity(); } h.update();
      const obj = s.obj || cylinder(o, o.clone().addScaledVector(ax, L), r), at = o.clone().addScaledVector(ax, s.u);   // s.obj: the handle with what is round it (world SDF at T0)
      const hand = new HandRig(h, s.side, { skin: h.o.gloves ? 0.0035 : 0 });
      const G = hand.planNatural({ grip: s.grip || 'power', obj, at, axis: ax }, { prefer: s.prefer, preferW: s.preferW ?? 0.25 }); hand.settle(G); hand.fit(G); hand.pose(G, 1); h.update();
      const m = hand.measure(obj, G);
      const W = h.bone(`wrist.${s.side}`); h.update(); const wp = V3(), wq = Q(), ws = V3(); W.matrixWorld.decompose(wp, wq, ws);
      const rel = T0i.clone().multiply(new THREE.Matrix4().compose(wp, wq, V3(1, 1, 1)));
      const fing = []; for (const B of h.bones) if ((B.name.startsWith('finger') || B.name.startsWith('metacarpal')) && B.name.endsWith('.' + s.side)) fing.push([B, B.quaternion.clone()]);
      // the wrist and the hand's direction (wrist -> middle knuckle) in the tool's frame, for a hand turned about the handle (apply's free)
      const hd = h.joint(`finger3-1.${s.side}`).sub(wp).transformDirection(T0i);
      this.g[s.side] = { rel, fing, u0: s.u, hand: hd, wrist: V3().setFromMatrixPosition(rel), roll: s.roll ?? 1.2 };
      this.report.push({ side: s.side, wristDeg: +(((G.state || {}).wristAngle || 0) * 180 / Math.PI).toFixed(1), maxGapMm: +m.maxGapMm.toFixed(1), maxPenMm: +m.maxPenMm.toFixed(1), contacts: m.contacts });
    }
  }
  // the wrist targets for a tool transform T (world); slide: { side: u } moves that hand to u along the handle; roll: { side: rad } turns
  // that hand about the handle's axis
  targets(T, slide = {}, roll = {}) { const out = {};
    for (const [side, g] of Object.entries(this.g)) { const du = (slide[side] ?? g.u0) - g.u0, M = T.clone().multiply(new THREE.Matrix4().makeRotationY(roll[side] || 0)).multiply(new THREE.Matrix4().makeTranslation(0, du, 0)).multiply(g.rel), p = V3(), q = Q(), s = V3(); M.decompose(p, q, s); out[side] = { p, q }; }
    return out; }
  // drive the arms (HeroPoser.arm) to the grips and restore the fitted fingers; poles: { L, R } elbow hints (world). free: a power grip on a
  // round handle may turn about it, so each hand takes the turn (within its spec's roll) that lines the hand up with its forearm, read from
  // where the elbow is with the grip as planned (a pure function of the pose: seekable). this.wristDeg: { side: the wrist's bend, deg:
  // the forearm, elbow -> wrist, against the hand, wrist -> middle knuckle; about 5 at rest }
  apply(hp, T, { slide = {}, poles = {}, free = false } = {}) { const miss = {}, h = this.h, roll = {}; this.wristDeg = {};
    for (const [side, g] of Object.entries(this.g)) { const pole = poles[side] || hp.dirW(V3(side === 'L' ? 1 : -1, -0.6, -0.4)), du = (slide[side] ?? g.u0) - g.u0;
      if (free) { const t0 = this.targets(T, slide)[side]; hp.arm(side, t0.p, t0.q, pole); const E = h.joint(`lowerarm01.${side}`).applyMatrix4(T.clone().invert());
        const f = a => { const c = Math.cos(a), s = Math.sin(a), w = V3(c * g.wrist.x + s * g.wrist.z, g.wrist.y + du, -s * g.wrist.x + c * g.wrist.z); return w.sub(E).normalize().dot(V3(c * g.hand.x + s * g.hand.z, g.hand.y, -s * g.hand.x + c * g.hand.z)); };
        let a = 0, fb = -9; for (let x = -g.roll; x <= g.roll + 1e-4; x += g.roll / 20) { const v = f(x); if (v > fb) { fb = v; a = x; } }
        const st = g.roll / 20, fm = f(a - st), fp = f(a + st), cv = fm - 2 * fb + fp; if (cv < -1e-9) a += Math.max(-st / 2, Math.min(st / 2, st / 2 * (fm - fp) / cv)); roll[side] = Math.max(-g.roll, Math.min(g.roll, a)); }   // the best turn, refined between samples
      const t = this.targets(T, slide, roll)[side]; miss[side] = hp.arm(side, t.p, t.q, pole) * 1000; for (const [B, q] of g.fing) B.quaternion.copy(q); }
    h.update();
    for (const side of Object.keys(this.g)) { const W = h.joint(`wrist.${side}`), fa = W.clone().sub(h.joint(`lowerarm01.${side}`)).normalize(), hd = h.joint(`finger3-1.${side}`).sub(W).normalize(); this.wristDeg[side] = Math.acos(clamp(fa.dot(hd), -1, 1)) * 180 / Math.PI; }
    return miss; }
}
