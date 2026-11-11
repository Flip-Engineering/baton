// MOTION c1 / ACTS on the dressed person (HUMAN c8 round 5, 3 Oct). NEW FILE, opt-in (only the MOTION labs and bake tools import it).
// Lane F's machinery on a v3 / v4 hero: HeroPoser with the person's kin (her ranges, her carrying angle), hp.gait (her step, cadence,
// width, obliquity) moved over the ground so the stance foot stays planted, labour.js's Lift phase table (look, down with the hips back
// and the knees out, grasp, take the weight chest first, drive, up with the box at the belly, lean back over the feet) mapped onto hero
// bones, and the Life layer (breath, blinks, the eyes) on top of every act. Neutral, everyday actions only.
//
//   const A = new WalkTurn(P, { seed, from: [x, z], dist, lane, startPhase });  A.frame(t) -> { g: [x, z, yaw], c: channels } (hero posed)
//   const B = new LiftCarry(P, { seed, kg, carrySteps });                        B.frame(t) -> { g, c (box: boxX.. in world) }
//   const W = new Wave(P, { seed, side });                                       W.frame(t)
// Every act is a pure function of t (seekable): the walk, the stop, the turn and the lift are closed-form in t; nothing integrates.
// The figure's group (h.group.position / rotation.y) is set by the act (world metres, the stage floor y = 0 under the feet).
import * as THREE from 'three';
import { HeroPoser } from './hero_poser.js';
import { Life, breathe, blinkLids, lookHead, resetScales, hash, noise1, seedOf } from './life.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smoother = x => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (a, b, x) => smoother((x - a) / (b - a));
const angLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
// a cubic Hermite from (p0, v0) to (p1, 0) over D seconds, at tau
const herm = (p0, v0, p1, D, tau) => { const u = clamp(tau / D), h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2; return h00 * p0 + h10 * D * v0 + h01 * p1; };

// HeroPoser keeps the feet's bind orientation as WORLD quaternions taken when it was made (fq0), so a figure whose group turns later
// would plant its feet at the old heading: re-base them on the group's heading now (lane F's file untouched)
function headed(hp) { const q = new THREE.Quaternion(); if (!hp._fq0b) { hp._q0 = hp._q0 || q.clone(); hp._fq0b = { L: hp._q0.clone().invert().multiply(hp.fq0.L), R: hp._q0.clone().invert().multiply(hp.fq0.R) }; }
  hp.h.group.updateMatrixWorld(true); hp.h.group.getWorldQuaternion(q); hp.fq0 = { L: q.clone().multiply(hp._fq0b.L), R: q.clone().multiply(hp._fq0b.R) }; }
function poser(h, P) { const q = new THREE.Quaternion(); h.group.updateMatrixWorld(true); h.group.getWorldQuaternion(q); const hp = new HeroPoser(h, { kin: !!h.meta?.kin, person: P.p }); hp._q0 = q; return hp; }
// hp.gait walks IN PLACE (the ground moves under the stance foot) and its swing ends at rest in the figure's frame; moved over the ground at
// the walking speed, the swing foot would then reach the ground still travelling. The swing's travel is re-timed in the WORLD (it leaves
// and lands at rest): dz = v x 0.4 T x (e(u) - u) on the swing foot's local target (u: the swing's own time, e: gait's quintic)
function gaitOver(hp, t, o, v) { const G = o.terms, T = 120 / G.cadence, ph = (((t / T + (o.phase || 0)) % 1) + 1) % 1, orig = hp.solve;
  hp.solve = S => { [0, 1].forEach(k => { const f = S.feet?.[k], p = k ? (ph + 0.5) % 1 : ph; if (!f || p < 0.6) return; const u = (p - 0.6) / 0.4, e = u * u * u * (u * (u * 6 - 15) + 10); f.p = f.p.clone(); f.p.z += v * 0.4 * T * (e - u); }); return orig.call(hp, S); };
  try { return hp.gait(t, o); } finally { hp.solve = orig; } }

// the person's life layer for an act: blinks, breath, the eyes (no weight shifts: the act owns the legs)
class ActLife {
  constructor(P, seed) { this.L = new Life(P.h, { seed, rec: P.pose || {}, person: P.p, kin: !!P.h.meta?.kin, look: 0.5 }); }
  at(t) { return this.L.sample(t); }
  lids(h, c) { blinkLids(h, this.L.rig, c.blink); }
}

// the wrist's world quaternion that puts the hand's frame (bind: a across the knuckles, f along the fingers, n out of the palm) on
// (aW, fW, nW) given in the GROUP's frame
function handQ(h, side, fW, nW) { const H = h._hand0(side), f = fW.clone().normalize(), n = nW.clone().addScaledVector(f, -nW.dot(f)).normalize(), a = V3().crossVectors(n, f);
  const M0 = new THREE.Matrix4().makeBasis(H.a, H.f, H.n), M1 = new THREE.Matrix4().makeBasis(a, f, n), R = new THREE.Matrix4().multiplyMatrices(M1, M0.clone().transpose());
  const qR = new THREE.Quaternion().setFromRotationMatrix(R), qg = new THREE.Quaternion(); h.group.getWorldQuaternion(qg); return qg.multiply(qR); }
// the wrist target that puts the palm point on `palmW` (world) with the wrist at world quaternion q (in the bind the wrist's world rotation
// is the group's and the palm sits at (palm - wrist) in the group frame, so posed it sits at q . that)
function wristFor(h, side, palmW, q) { const H = h._hand0(side), off = H.palm.clone().sub(H.w).multiplyScalar(h.scale); return palmW.clone().sub(off.applyQuaternion(q)); }

// ---------------------------------------------------------------- WALK across the stage, STOP, TURN to camera, HOLD
export class WalkTurn {
  // from: [x, z] world start of the hips; dir: +1 walks toward +x (stage right), -1 toward -x; dist: metres of walk before the stop step;
  // face: the world yaw to turn to at the end (0 = toward a camera on +z); t0: when the walk starts (s; before it the walker is out of view)
  constructor(P, { seed = null, from = [-2, 0], dir = 1, dist = 3.2, face = 0, startPhase = 0.1, speedK = 1, hold = true } = {}) {
    this.P = P; const h = this.h = P.h; this.seed = seed ?? seedOf(P.info?.name || 'w'); this.hp = poser(h, P);
    this.life = new ActLife(P, this.seed); this.G = { ...this.hp.gaitTerms() }; this.G.cadence *= speedK; this.G.step *= Math.sqrt(speedK);
    this.T = 120 / this.G.cadence; this.v = this.G.step * this.G.cadence / 60; this.dir = dir; this.yaw0 = dir > 0 ? Math.PI / 2 : -Math.PI / 2; this.face = face;
    this.from = from; this.phase0 = startPhase;
    // the stop: the first time after `dist` metres when the left foot is at mid-stance (phase 0.25): the right foot then lands beside it
    const tw = dist / this.v; let k = Math.ceil((tw / this.T + this.phase0 - 0.25)); this.ts = (k + 0.25 - this.phase0) * this.T; if (this.ts < 0.5) this.ts += this.T;
    this.Dstop = 0.62; this.tTurn = this.ts + this.Dstop + 0.18; this.Dturn = 1.25; this.tEnd = this.tTurn + this.Dturn;
    this.rep = { gait: { step: this.G.step, cadence: this.G.cadence, speed: this.v, width: this.G.width }, stopAt: this.ts, turnAt: this.tTurn };
  }
  groupAt(t) { const d = this.v * Math.min(t, this.ts); return { x: this.from[0] + this.dir * d, z: this.from[1], yaw: this.yaw0 }; }
  _setGroup(x, z, yaw) { const g = this.h.group; g.position.x = x; g.position.z = z; g.rotation.y = yaw; g.updateMatrixWorld(true); headed(this.hp); }
  // world <-> local for the feet (local: the figure's frame, x its left, z its front)
  _toLocal(p, gx, gz, yaw) { const dx = p.x - gx, dz = p.z - gz, c = Math.cos(yaw), s = Math.sin(yaw); return V3(c * dx - s * dz, p.y || 0, s * dx + c * dz); }
  _toWorld(l, gx, gz, yaw) { const c = Math.cos(yaw), s = Math.sin(yaw); return V3(gx + c * l.x + s * l.z, l.y || 0, gz - s * l.x + c * l.z); }
  frame(t) {
    const h = this.h, hp = this.hp, c = this.life.at(t); resetScales(h);
    let out;
    if (t <= this.ts) out = this._walk(t, c);
    else if (t <= this.tTurn) out = this._stop(t, c);
    else out = this._turn(t, c);
    breathe(h, c.breath * 0.7, { belly: 0.02, chest: 0.012 }); this.life.lids(h, c); h.update();
    // the eyes stay within ~17 deg of the head's straight ahead (the head does the rest of a look)
    out.c = { eyeYaw: clamp(out.eyeYaw ?? c.eyeYaw * 0.4, -0.3, 0.3), eyePitch: clamp(out.eyePitch ?? c.eyePitch * 0.4, -0.25, 0.2), smile: out.smile ?? c.smile, blink: c.blink, breath: c.breath };
    return out;
  }
  _walk(t, c) { const h = this.h, g = this.groupAt(t); this._setGroup(g.x, g.z, g.yaw);
    const r = gaitOver(this.hp, t, { phase: this.phase0, terms: this.G }, this.v); this._last = r;
    // the head: ahead and a little down, the eyes on the path; toward the end of the walk the head starts toward where it will face
    const lead = ease(this.ts - 0.5, this.ts + 0.2, t), want = Math.atan2(Math.sin(this.face - this.yaw0), Math.cos(this.face - this.yaw0));
    lookHead(h, want * 0.35 * lead + 0.03 * noise1(t * 0.7, this.seed), -0.06 * (1 - lead));
    return { g: [g.x, g.z, g.yaw], phase: 'walk', ph: r.ph, eyeYaw: want * 0.5 * lead, eyePitch: -0.08 * (1 - lead) }; }
  // the stop: the stance foot (left, at mid-stance at ts) stays; the right foot lands beside it; the hips come over the feet and stop
  _stopState() { if (this._ss) return this._ss; const h = this.h, hp = this.hp, g = this.groupAt(this.ts); this._setGroup(g.x, g.z, g.yaw);
    gaitOver(hp, this.ts, { phase: this.phase0, terms: this.G }, this.v); h.update();
    const L = hp.local(h.joint('foot.L')), R = hp.local(h.joint('foot.R')), hips = hp.local(h.joint('upperleg01.L').add(h.joint('upperleg01.R')).multiplyScalar(0.5));
    // the local spec the gait used at ts (ankle points on the ground plan): recompute from the joints (y = ground, as solve expects)
    const ankL = V3(L.x, 0, L.z), ankR = V3(R.x, 0, R.z), Rlift = R.y - hp.ank0.R.y;
    const T = hp.stanceTerms(), hx = T.ankleSep / 2, toe = T.toe;
    this._ss = { g, ankL, ankR, Rlift, hips, hx, toe, vz: this.v, py0: hips.y };
    return this._ss; }
  _stop(t, c) { const h = this.h, hp = this.hp, S = this._stopState(), tau = t - this.ts; this._setGroup(S.g.x, S.g.z, S.g.yaw);
    const u = clamp(tau / 0.36), e = smoother(u);
    const land = V3(S.ankL.x - 2 * S.hx, 0, S.ankL.z + 0.015);
    const fR = { p: V3(lerp(S.ankR.x, land.x, e), 0, lerp(S.ankR.z, land.z, e)), yaw: -S.toe, lift: Math.max(0, S.Rlift * (1 - e) + 0.03 * Math.sin(Math.PI * u) * (1 - u)) };
    const fL = { p: S.ankL.clone(), yaw: S.toe, lock: 0.5 };
    // the hips: carry on at the walking speed and come to rest over the middle of the feet (Hermite), down to the standing height
    const midX = (S.ankL.x + land.x) / 2, midZ = (S.ankL.z + land.z) / 2 + hp.hip0.z - hp.ank0.L.z - 0.004;
    const pz = herm(S.hips.z, S.vz, midZ, this.Dstop, tau), px = herm(S.hips.x, 0, midX, this.Dstop * 0.8, tau);
    const py = lerp(S.py0, hp._hipY(S.hx, 0) - 0.008 * hp.sx, ease(0, this.Dstop, tau));
    hp.solve({ pelvis: { p: V3(px, py, pz), pitch: 0.06 * (1 - ease(0, this.Dstop, tau)) }, spine: { flex: 0.03 * (1 - ease(0, this.Dstop, tau)) }, feet: [fL, fR] });
    // the arms swing out of their last swing to rest
    const sw = 1 - ease(0, this.Dstop * 0.9, tau);
    for (const [sd, sg] of [['L', 1], ['R', -1]]) { const a = -sg * 0.3 * this.G.armSwing * Math.cos(2 * Math.PI * ((this.ts + tau * 0.6) / this.T + this.phase0 - 0.04)) * sw;
      hp.hang(sd, { out: 0.1, back: -a, elbow: 0.25 + 0.4 * Math.max(0, a), palm: 'in', relax: 0.9 }); }
    const want = Math.atan2(Math.sin(this.face - this.yaw0), Math.cos(this.face - this.yaw0)), lead = 0.35 + 0.25 * ease(0, this.Dstop, tau);
    lookHead(h, want * lead, 0);
    return { g: [S.g.x, S.g.z, S.g.yaw], phase: 'stop', eyeYaw: want * 0.5, eyePitch: 0 }; }
  // the turn: the body turns about the middle of the feet in two steps (the near foot first), the head leading; then the hold
  _turnState() { if (this._ts) return this._ts; const S = this._stopState(), hp = this.hp; this._stop(this.tTurn, this.life.at(this.tTurn)); const h = this.h;
    const wL = h.joint('foot.L'), wR = h.joint('foot.R'), mid = wL.clone().add(wR).multiplyScalar(0.5), hipsW = h.joint('upperleg01.L').add(h.joint('upperleg01.R')).multiplyScalar(0.5);
    const yaw0 = this.yaw0, yaw1 = this.face, turnR = Math.sin(yaw1 - yaw0) < 0, z0 = hp.ank0.L.z;   // a right turn: clockwise from above
    const g0 = this._gAt(mid, z0, yaw0), lh = this._toLocal(hipsW, g0.x, g0.z, yaw0);
    // the feet's final places: the person's stance about the same middle, facing yaw1
    const g1 = this._gAt(mid, z0, yaw1), end = s => this._toWorld(V3(s === 'L' ? S.hx : -S.hx, 0, z0), g1.x, g1.z, yaw1);
    this._ts = { mid, z0, lh, yaw0, yaw1, first: turnR ? 'R' : 'L', start: { L: V3(wL.x, 0, wL.z), R: V3(wR.x, 0, wR.z) }, end: { L: end('L'), R: end('R') }, py0: hp.local(hipsW).y };
    return this._ts; }
  // the group that keeps the local point (0, 0, z0) (the middle of the feet) on the world point m
  _gAt(m, z0, yaw) { return { x: m.x - Math.sin(yaw) * z0, z: m.z - Math.cos(yaw) * z0 }; }
  _turn(t, c) { const h = this.h, hp = this.hp, S = this._stopState(), U = this._turnState(), tau = t - this.tTurn, D = this.Dturn;
    const k = ease(0.05 * D, D, tau), yaw = angLerp(U.yaw0, U.yaw1, k), G = this._gAt(U.mid, U.z0, yaw); this._setGroup(G.x, G.z, yaw);
    // the feet: the first foot steps (0.04-0.5 of D), the second (0.42-0.92); each lifts ~4.5 cm and turns as it travels; a planted foot keeps its world place and yaw
    const foot = (s, a, b) => { const m = 0.18 * (b - a), u = ease((a + m) * D, (b - m) * D, tau), lift = 0.045 * hp.sx * Math.sin(Math.PI * clamp((tau - a * D) / ((b - a) * D))), w = U.start[s].clone().lerp(U.end[s], u);
      const fyaw = angLerp(U.yaw0, U.yaw1, u) + (s === 'L' ? S.toe : -S.toe); const l = this._toLocal(w, G.x, G.z, yaw); return { p: V3(l.x, 0, l.z), yaw: fyaw - yaw, lift: (tau > a * D && tau < b * D) ? lift : 0 }; };
    const first = U.first, second = first === 'L' ? 'R' : 'L', F = { [first]: foot(first, 0.04, 0.5), [second]: foot(second, 0.42, 0.92) };
    // the hips: they turn with the body over the middle of the feet and settle to the person's standing height and place; a dip and a
    // shift of weight onto the planted foot while the other one steps
    const b1 = Math.sin(Math.PI * clamp((tau - 0.04 * D) / (0.46 * D))), b2 = Math.sin(Math.PI * clamp((tau - 0.42 * D) / (0.5 * D)));
    const dip = 0.007 * hp.sx * (b1 + b2), shift = 0.028 * hp.sx * (first === 'R' ? 1 : -1) * (b1 - b2);
    const ks = ease(0, D, tau), py = lerp(U.py0, hp._hipY(S.hx, 0) - 0.008 * hp.sx, ks) - dip;
    const px = lerp(U.lh.x, hp.hip0.x, ks) + shift, pz = lerp(U.lh.z, hp.hip0.z - 0.006 * hp.sx, ks);
    hp.solve({ pelvis: { p: V3(px, py, pz), yaw: 0 }, feet: [F.L, F.R] });
    for (const sd of ['L', 'R']) hp.hang(sd, { out: 0.1, back: 0.03, elbow: 0.22, palm: 'in', relax: 0.9 });
    // the head leads the body by ~0.25 s and arrives on the camera (the face yaw); the eyes lead the head
    const kh = ease(-0.25 * D, D - 0.3, tau), hy = angLerp(U.yaw0, U.yaw1, kh) - yaw;
    const rest = tau > D ? 0.04 * noise1((t - this.tEnd) * 0.4, this.seed + 3) : 0;
    lookHead(h, hy * 0.9 + rest, 0.02);
    const ey = angLerp(U.yaw0, U.yaw1, ease(-0.4 * D, D - 0.5, tau)) - (yaw + hy * 0.9);
    return { g: [G.x, G.z, yaw], phase: tau < D ? 'turn' : 'hold', eyeYaw: clamp(ey, -0.35, 0.35) + c.eyeYaw * 0.3, eyePitch: c.eyePitch * 0.3, smile: tau > D * 0.7 ? c.smile + 0.05 * ease(D * 0.7, D + 0.6, tau) : c.smile }; }
}

// ---------------------------------------------------------------- LIFT a box from the floor and CARRY it a few steps
// labour.js Lift's phase table (the look, down with the hips back and the knees out, the grasp, the weight taken chest first, the drive,
// up with the box at the belly, the lean back over the feet), on hero bones: the pelvis drop as a fraction of the person's leg length, the
// trunk flex split pelvis 55 % / spine 45 %, the COM over the feet (body + box, the person's own segments) by moving the pelvis back;
// hands on the box's sides (palms in, fingers forward and down); then the carry: the person's gait, 0.85 x the step, the box riding
// with the chest, the arms on it; then the stop.
export class LiftCarry {
  constructor(P, { seed = null, kg = 8, box = null, at = [0, 0], yaw = 0, carrySteps = 4, tCarry = 3.4 } = {}) {
    this.P = P; const h = this.h = P.h; this.seed = seed ?? seedOf(P.info?.name || 'l'); this.hp = poser(h, P);
    const sx = this.hp.sx; this.box = box || { w: 0.40 * sx, h: 0.28 * sx, d: 0.30 * sx }; this.kg = kg; this.at = at; this.yaw = yaw;
    this.life = new ActLife(P, this.seed); this.G = { ...this.hp.gaitTerms() }; this.G.step *= 0.82; this.G.cadence *= 0.94; this.G.armSwing = 0;
    this.T = 120 / this.G.cadence; this.v = this.G.step * this.G.cadence / 60; this.tCarry = tCarry; this.nSteps = carrySteps;
    this.tStop = tCarry + carrySteps * this.T / 2 + 0.05; this.Dstop = 0.6; this.tEnd = this.tStop + this.Dstop;
    const T = this.hp.stanceTerms(); this.hx = Math.max(T.ankleSep / 2 + 0.03 * sx, 0.11 * sx); this.toe = T.toe + 0.1;
    this.z0 = this.hp.ank0.L.z + 0.34 * sx;    // the box's centre ahead of the ankles, on the floor
    this.rep = { kg, box: this.box, carry: { step: this.G.step, cadence: this.G.cadence, speed: this.v } };
  }
  keys(u) { const sq = 1 + (hash(this.seed, 5) - 0.5) * 0.16, hd = this.box.h / 2;
    const K = [[0.0, { drop: 0, back: 0, flex: 0.05, head: 0.1, by: hd, hold: 0, on: 0 }], [0.45, { drop: 0.02, back: 0, flex: 0.15, head: 0.45, by: hd, hold: 0, on: 0 }],
      [1.25, { drop: 0.36 * sq, back: -0.14, flex: 1.05 / sq, head: -0.1, by: hd, hold: 0, on: 0.95 }], [1.45, { drop: 0.38 * sq, back: -0.15, flex: 1.08 / sq, head: -0.15, by: hd, hold: 0, on: 1 }],
      [1.8, { drop: 0.36 * sq, back: -0.16, flex: 0.98 / sq, head: -0.45, by: hd + 0.006, hold: 0, on: 1 }], [2.2, { drop: 0.2 * sq, back: -0.12, flex: 0.7, head: -0.35, by: 0.42, hold: 0.3, on: 1 }],
      [2.65, { drop: 0.02, back: -0.02, flex: 0.02, head: -0.05, by: 0.98, hold: 1, on: 1 }], [2.95, { drop: 0.015, back: 0, flex: -0.08, head: 0.05, by: 1, hold: 1, on: 1 }], [99, { drop: 0.015, back: 0, flex: -0.07, head: 0.05, by: 1, hold: 1, on: 1 }]];
    let i = 0; while (i < K.length - 2 && K[i + 1][0] <= u) i++; const [ta, A] = K[i], [tb, B] = K[i + 1], w = smoother((u - ta) / (tb - ta)), o = {};
    for (const k in A) o[k] = lerp(A[k], B[k], w); return o; }
  _setGroup(x, z, yaw) { const g = this.h.group; g.position.x = x; g.position.z = z; g.rotation.y = yaw; g.updateMatrixWorld(true); headed(this.hp); }
  // the hands on the box: palms in on its sides, a little behind its middle and below its top; the box's frame in the group (local) frame
  _hands(Bc, byaw, on, curl) { const h = this.h, hp = this.hp, wq = new THREE.Quaternion(); h.group.getWorldQuaternion(wq); const miss = {};
    for (const [sd, sg] of [['L', 1], ['R', -1]]) { if (on <= 0.01) continue;
      const loc = V3(sg * (this.box.w / 2 + 0.006), -0.02, -0.05).applyAxisAngle(V3(0, 1, 0), byaw).add(Bc), palmW = hp.world(loc);
      const fL = V3(0, -0.45, 1).normalize().applyAxisAngle(V3(0, 1, 0), byaw), nL = V3(-sg, 0, 0).applyAxisAngle(V3(0, 1, 0), byaw), q = handQ(h, sd, fL, nL);
      const wr = wristFor(h, sd, palmW, q), pole = hp.dirW(V3(sg * 0.8, -0.5, -0.5).normalize());
      // reach from the hanging arm to the box as the hands come on (on < 1: the arm on its way)
      if (on < 0.999) { const hang = h.joint(`wrist.${sd}`), mid = hang.clone().lerp(wr, smoother(on)); miss[sd] = hp.arm(sd, mid, null, pole) * 1000; }
      else miss[sd] = hp.arm(sd, wr, q, pole) * 1000;
      h.relaxHand(sd, curl, { cascade: true }); }
    return miss; }
  frame(t) {
    const h = this.h, hp = this.hp, c = this.life.at(t), sx = hp.sx; resetScales(h);
    let g = { x: this.at[0], z: this.at[1], yaw: this.yaw }, phase, Bc, byaw = 0, eff = 0;
    if (t < this.tCarry) {   // the lift, in place
      this._setGroup(g.x, g.z, g.yaw); const K = this.keys(t), legLen = hp.legLen;
      phase = t < 1.25 ? 'reach' : t < 1.8 ? 'grasp' : t < 2.95 ? 'lift' : 'hold';
      let pz = hp.hip0.z + K.back * sx; const bz = lerp(this.z0, hp.hip0.z + 0.27 * sx, smoother(K.hold));
      Bc = V3(0, K.by * (K.by > 0.9 ? 1 : 1) * (K.hold > 0 ? 1 : 1), bz); if (K.hold > 0) Bc.y = lerp(this.box.h / 2, hp.hip0.y + 0.12 * sx, smoother(Math.min(1, (K.by - this.box.h / 2) / (1 - this.box.h / 2))));
      const load = K.on > 0.99 && K.hold > 0.02 ? { kg: this.kg, p: null } : null;
      for (let it = 0; it < 3; it++) {
        hp.solve({ pelvis: { p: V3(0, hp.hip0.y - K.drop * legLen, pz), pitch: K.flex * 0.55 }, spine: { flex: K.flex * 0.45 + 0.012 * c.breath }, head: { pitch: K.head - K.flex * 0.5 },
          feet: [{ p: V3(this.hx, 0, hp.ank0.L.z - 0.03 * sx), yaw: this.toe, kneeOut: 0.15 + 0.7 * clamp(K.drop / 0.3) }, { p: V3(-this.hx, 0, hp.ank0.R.z - 0.01 * sx), yaw: -this.toe, kneeOut: 0.15 + 0.7 * clamp(K.drop / 0.3) }] });
        if (load) load.p = hp.world(Bc.clone());
        const e = hp.balanceErr({ load }); if (Math.abs(e.err.z) < 0.004) break; pz -= e.err.z * 0.85; }
      for (const sd of ['L', 'R']) hp.hang(sd, { out: 0.12, back: 0.0, elbow: 0.25, palm: 'in', relax: 0.9 });
      this.rep.miss = this._hands(Bc, 0, K.on, 0.25 + 0.4 * K.on); eff = K.on;
      this.life.lids(h, c);
    } else {               // the carry: the person's gait (short steps), the box at the belly riding with the chest; then the stop
      const tc = t - this.tCarry, walking = t < this.tStop, d = this.v * Math.min(tc, this.tStop - this.tCarry) + (walking ? 0 : herm(0, this.v, this.v * 0.18, this.Dstop, t - this.tStop));
      const fw = V3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); g = { x: this.at[0] + fw.x * d, z: this.at[1] + fw.z * d, yaw: this.yaw }; this._setGroup(g.x, g.z, g.yaw);
      // start the gait at a double stance (phase 0.5 - the first step is the left one): ease the cycle in over the first step
      const ph0 = 0.0, tt = tc;
      if (walking) { gaitOver(hp, tt, { phase: ph0, terms: this.G }, this.v); phase = 'carry'; }
      else { gaitOver(hp, this.tStop - this.tCarry, { phase: ph0, terms: this.G }, this.v); phase = 'stop'; }
      // the box rides in front of the chest / belly, the trunk leans back a little over the feet against it
      const ch = hp.local(h.joint('spine03')), pel = hp.local(h.joint('upperleg01.L').add(h.joint('upperleg01.R')).multiplyScalar(0.5));
      Bc = V3(pel.x * 0.6 + ch.x * 0.4, hp.hip0.y + 0.12 * sx + (ch.y - (hp.hip0.y + 0.2 * sx)) * 0.5, ch.z + 0.2 * sx + this.box.d / 2 - 0.06);
      byaw = 0.3 * (hp.local(h.joint('spine03').add(V3(0, 0, 0))).x - pel.x);
      h.rotateWorld('spine04', hp.dirW(V3(1, 0, 0)), -0.05); h.update();
      this.rep.miss = this._hands(Bc, byaw, 1, 0.65); eff = 0.7;
      lookHead(h, 0.03 * noise1(t * 0.6, this.seed), 0.08);
      this.life.lids(h, c);
    }
    breathe(h, c.breath * (0.7 + 0.6 * eff), { belly: 0.022, chest: 0.014 }); h.update();
    const BW = hp.world(Bc.clone()); BW.y = Bc.y;   // (local y = world y: the stage floor at 0)
    return { g: [g.x, g.z, g.yaw], phase, c: { eyeYaw: c.eyeYaw * 0.3, eyePitch: c.eyePitch * 0.3 - (phase === 'reach' || phase === 'grasp' ? 0.25 : 0), smile: c.smile * 0.6, blink: c.blink, breath: c.breath,
      boxX: BW.x, boxY: BW.y, boxZ: BW.z, boxYaw: g.yaw + byaw } };
  }
}

// ---------------------------------------------------------------- WAVE (a raised hand) from the person's own stance and life
// the arm leaves the stance, rises (elbow ~90, the forearm up, the palm to the camera), waves 2-3 times about the elbow and wrist, comes
// back down into the stance; the head turns to the camera, a small smile; the Life layer (weight, breath, blinks) runs underneath
export class Wave {
  constructor(P, { seed = null, side = 'R', t0 = 0.8, n = 3, hz = 1.9 } = {}) {
    this.P = P; this.h = P.h; this.seed = seed ?? seedOf(P.info?.name || 'v'); this.side = side; this.t0 = t0; this.n = n; this.hz = hz;
    this.L = new Life(P.h, { seed: this.seed, rec: P.pose || {}, person: P.p, kin: !!P.h.meta?.kin, look: 0.3 }).capture(); this.hp = poser(P.h, P);
    // the HeroPoser constructor reset the pose: put the stance back (Life keeps it)
    this.L.apply(0); this.tUp = t0 + 0.65; this.tDown = this.tUp + n / hz; this.tEnd = this.tDown + 0.8;
    this.armBones = P.h.bones.filter(B => new RegExp(`^(clavicle|shoulder01|upperarm0|lowerarm0|wrist|finger|metacarpal).*\\.${side}$`).test(B.name));
  }
  frame(t) {
    const h = this.h, hp = this.hp, s = this.side, sg = s === 'L' ? 1 : -1, c = this.L.sample(t); c.weight *= 0.6;
    const up = ease(this.t0, this.tUp, t) * (1 - ease(this.tDown, this.tEnd, t));
    c.yaw = lerp(c.yaw, 0, ease(this.t0 - 0.4, this.t0 + 0.3, t)); c.eyeYaw *= 1 - 0.7 * up;
    this.L.apply(t, { channels: c });
    if (up > 0.001) {
      const A = this.armBones.map(B => B.quaternion.clone());
      const S = h.joint(`upperarm01.${s}`), lat = hp.dirW(V3(1, 0, 0)), fwd = hp.dirW(V3(0, 0, 1)), sx = hp.sx;
      const wv = t > this.tUp && t < this.tDown ? Math.sin(2 * Math.PI * this.hz * (t - this.tUp)) * Math.sin(Math.PI * clamp((t - this.tUp) / (this.tDown - this.tUp))) ** 0.5 : 0;
      const tgt = S.clone().addScaledVector(lat, sg * (0.2 + 0.05 * wv) * sx).add(V3(0, 0.2 * sx, 0)).addScaledVector(fwd, 0.1 * sx);
      const fW = V3(sg * (0.12 + 0.35 * wv), 1, 0.08).normalize(), nW = V3(0, 0.1, 1).normalize(), qL = handQ(h, s, fW, nW);
      hp.arm(s, wristFor(h, s, tgt, qL), qL, hp.dirW(V3(sg * 0.5, -0.8, -0.2).normalize()));
      for (const n of [1, 2, 3, 4, 5]) for (const k of [1, 2, 3]) { const B = h.bone(`finger${n}-${k}.${s}`); if (B) B.quaternion.identity(); }
      h.relaxHand(s, 0.25, { cascade: true });
      const B1 = this.armBones.map(B => B.quaternion.clone()), e = smoother(up);
      this.armBones.forEach((B, i) => B.quaternion.copy(A[i]).slerp(B1[i], e)); h.update();
    }
    return { g: [h.group.position.x, h.group.position.z, h.group.rotation.y], phase: up > 0.99 ? 'wave' : up > 0 ? 'raise' : 'stand', c: { eyeYaw: c.eyeYaw, eyePitch: c.eyePitch, smile: Math.min(0.16, c.smile + 0.08 * up), blink: c.blink, breath: c.breath } };
  }
}

// the idle row: Life on the person's stance (the bake's own); a frame = its channels
export class Idle4 {
  constructor(P, { seed = null } = {}) { this.P = P; this.L = new Life(P.h, { seed: seed ?? seedOf(P.info?.name || 'i'), rec: P.pose || {}, person: P.p, kin: !!P.h.meta?.kin }).capture(); }
  frame(t) { const h = this.P.h, c = this.L.apply(t); return { g: [h.group.position.x, h.group.position.z, h.group.rotation.y], phase: 'idle', c: { eyeYaw: c.eyeYaw, eyePitch: c.eyePitch, smile: c.smile, blink: c.blink, breath: c.breath, weight: c.weight } }; }
}

// ---------------------------------------------------------------- the MOTION c1 clips (plain data: the bake tool and the lab share it)
// who: the people (v4 names); place: per person the act's options (world metres, the stage's floor at y = 0); dur (s); stage; study: the
// figure-study register (the _base bake: K3's underwear on the same body)
export const CLIPS4 = {
  row: { act: 'idle', who: ['L08_f24_hispanic', 'L22_f27_black', 'L20_f29_asian', 'L12_f39_white', 'L14_f42_black', 'L06_f53_white', 'L21_m32_black', 'L11_m23_white', 'L17_m28_hispanic', 'L03_m38_asian', 'L23_m45_white', 'L05_m59_black'], dur: 6, gap: 0.78, stage: 'yard' },
  walkturn: { act: 'walkturn', who: ['L08_f24_hispanic', 'L21_m32_black'], dur: 6.2, stage: 'studio',
    place: { L08_f24_hispanic: { from: [-2.5, 0.5], dist: 2.3, startPhase: 0.1 }, L21_m32_black: { from: [-3.1, -0.6], dist: 3.3, startPhase: 0.55 } } },
  lift: { act: 'lift', who: ['L22_f27_black'], dur: 6.8, stage: 'yard', place: { L22_f27_black: { at: [-1.1, 0], yaw: Math.PI / 2 } } },
  wave: { act: 'wave', who: ['L03_m38_asian'], dur: 4.6, stage: 'yard' },
  study: { act: 'walkturn', who: ['L12_f39_white'], dur: 6.2, stage: 'window', study: true, place: { L12_f39_white: { from: [-2.3, 0], dist: 2.3, startPhase: 0.3 } } },
};
export function actFor(clip, P, name) { const C = CLIPS4[clip], o = C.place?.[name] || {};
  return C.act === 'idle' ? new Idle4(P) : C.act === 'wave' ? new Wave(P, o) : C.act === 'lift' ? new LiftCarry(P, o) : new WalkTurn(P, o); }
