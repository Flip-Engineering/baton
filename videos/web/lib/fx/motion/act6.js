// POSE AND ACTING on the dressed people (MOTION c2 + c3, HUMAN c8; one current version): the skeleton's acts. act7.js builds the studio's acts on these (LiftCarry7, Wave7, WalkTurn7, Dress7).
//   HeroPoser6      lane F's HeroPoser with three additions done from outside (a subclass): the feet's bind orientation kept in the figure's own frame (a figure that turns plants its feet at its new heading), a TOE
//                   JOINT (the foot rises about the MTP line and the toes stay flat on the ground: no toe sinking), and the toe heights reported
//   gait6           the walk, planted in the WORLD (the swing leaves and lands at rest over the moving ground: no skid), heel strike -> foot flat -> heel-off about the MTP line with the toes kept down -> toe-off; a
//                   loading-response knee; pelvis rotation and drop; the thorax turning against the pelvis; arms swinging opposite the legs by the person's own amplitude (lane F's kin gait); the head kept level
//                   against the bob; small seeded irregularities (arm amplitude per stride, trunk and head drift)
//   WalkTurn6       gait6 over the ground, a stop with a SETTLE, a turn led by the eyes, then the head, then the body, and a settle into weight on one leg
//   LiftCarry6      HANDS THAT ACT: the box gripped low on its sides with the fingers closed under its bottom edge (lane F's HandRig closing each finger on the box's SDF, measured on the skin), lifted, re-gripped from
//                   BELOW at the belly (palms up under the box, the fingers closed on its bottom), carried with bent elbows and a lean back, contact kept (the hands ride in the box's frame); the hands as a person's
//                   hands (the resting fan, the thumb clear of the carton, enslaving); the lean back SOLVED from the load (_solveLean)
//   Wave6           the weight's target and the timing of a wave (the frame is Wave7's)
//   Dress6          the idle (Life) on a DRESSED stance (folded, clasped, a hand in a pocket, a hand on the hip: the bake's own stance, assets/person/motion6/dress7/), a pocketed or hip hand kept on the pelvis
//   CLIPS6          the clip table's casting and garment bakes (the dressed poses' bakes: person/ reads CLIPS6.row6.bake)
// Every act is a pure function of t when its frames are called in order from t = 0 (the grips and the lean are solved at first use). The figure's group is set by the act (world metres, the stage floor at y = 0).
import * as THREE from 'three';
import { HeroPoser } from './hero_poser.js';
import { Life, breathe, blinkLids, lookHead, resetScales, hash, noise1, seedOf } from './life.js';
import { WalkTurn } from './act4.js';
import { HandRig } from '../rig/hand.js';
import { box as sdfBox } from '../rig/sdf.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Qt = () => new THREE.Quaternion();
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smoother = x => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (a, b, x) => smoother((x - a) / (b - a));
const angLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const TAU = Math.PI * 2;
const hp0 = (a, v) => a.hp.dirW(v);
const herm2 = (p0, v0, p1, v1, D, tau) => { const u = clamp(tau / D), h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2; return h00 * p0 + h10 * D * v0 + h01 * p1 + h11 * D * v1; };
const herm = (p0, v0, p1, D, tau) => { const u = clamp(tau / D), h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2; return h00 * p0 + h10 * D * v0 + h01 * p1; };
// a damped oscillation that starts at 0 with unit initial velocity-shape: used for settles (overshoot and return)
const settle = (tau, f = 1.2, zeta = 0.45) => { if (tau <= 0) return 0; const w = TAU * f, wd = w * Math.sqrt(1 - zeta * zeta); return Math.exp(-zeta * w * tau) * Math.sin(wd * tau); };

// ---------------------------------------------------------------- HeroPoser6: feet in the figure's frame, a toe joint (opt-in, from outside)
const TOES = ['toe1-1', 'toe2-1', 'toe3-1', 'toe4-1', 'toe5-1'];
export class HeroPoser6 extends HeroPoser {
  constructor(h, o = {}) {
    const q = Qt(); h.group.updateMatrixWorld(true); h.group.getWorldQuaternion(q);
    super(h, o); this._q0 = q;
    // lane F keeps the feet's bind orientation as WORLD quaternions taken here: kept in the GROUP's frame and re-based at every solve
    this._fq0g = { L: q.clone().invert().multiply(this.fq0.L), R: q.clone().invert().multiply(this.fq0.R) };
    // the MTP line (the toes' proximal joints) per side in the figure's frame, in the bind (the HeroPoser constructor reset the pose)
    this.toeB = {}; this.mtp = {}; this.toeTip0 = {};
    for (const s of ['L', 'R']) { const names = TOES.map(n => `${n}.${s}`).filter(n => h.bone(n)); this.toeB[s] = names;
      const P = names.map(n => this.local(h.joint(n))), c = P.reduce((a, p) => a.add(p), V3()).multiplyScalar(1 / Math.max(1, P.length)); this.mtp[s] = c;
      const tip = h.bone(`toe3-3.${s}`) ? this.local(h.joint(`toe3-3.${s}`)) : c.clone(); this.toeTip0[s] = tip.y; }
    this.ball6 = this.mtp.L.z - this.ank0.L.z; this.ballY6 = this.mtp.L.y; this.heel6 = 0.055 * this.sx;
    // the contact points in each foot bone's own frame (the heel under the ankle's back, the MTP line): the planted-contact slide ruler
    this.cp = {}; for (const s of ['L', 'R']) { h.update(); const Mi = h.bone(`foot.${s}`).matrixWorld.clone().invert(), a = this.ank0[s];
      this.cp[s] = { heel: this.world(V3(a.x, 0.004, a.z - this.heel6)).applyMatrix4(Mi), mtp: this.world(this.mtp[s].clone().setY(0.004)).applyMatrix4(Mi) }; }
  }
  contactPoints() { this.h.update(); const o = {}; for (const s of ['L', 'R']) { const M = this.h.bone(`foot.${s}`).matrixWorld; o[s] = { heel: this.cp[s].heel.clone().applyMatrix4(M), mtp: this.cp[s].mtp.clone().applyMatrix4(M) }; } return o; }
  rebase() { const q = Qt(); this.h.group.updateMatrixWorld(true); this.h.group.getWorldQuaternion(q); this.fq0 = { L: q.clone().multiply(this._fq0g.L), R: q.clone().multiply(this._fq0g.R) }; }
  // feet[k] may carry `toe` (0..1): the share of a heel-up pitch the toes give back (they stay flat on the ground about the MTP line)
  solve(S) { this.rebase(); const r = super.solve(S);
    if (S.feet) S.feet.forEach((f, k) => { if (!f || !(f.pitch < 0) || !f.toe) return; const s = k ? 'R' : 'L', ax = this.dirW(V3(1, 0, 0)).applyAxisAngle(V3(0, 1, 0), f.yaw || 0);
      for (const n of this.toeB[s]) this.h.rotateWorld(n, ax, f.pitch * f.toe); });
    this.h.update(); return r; }
  // the toes' lowest point over the floor (mm) per side: the toe-sinking ruler
  toeHeights() { const out = {}; for (const s of ['L', 'R']) { let m = Infinity; for (const n of [`toe1-2.${s}`, `toe3-3.${s}`, `toe5-3.${s}`]) { if (!this.h.bone(n)) continue; m = Math.min(m, this.h.joint(n).y); } out[s] = +(m * 1000).toFixed(1); } return out; }
}

// the ankle (local, relative to the bind ankle's z) of a foot whose flat-foot ankle point is at zFlat, pitched about the heel (> 0) or the
// MTP line (< 0): gait6's rockers, for the first step of the carry
export function footRoll(hp, zFlat, pitch) { const ay0 = hp.ank0.L.y, heel = hp.heel6, ball = hp.ball6, yB = hp.ballY6;
  if (pitch > 0) { const y = ay0 * Math.cos(pitch) + heel * Math.sin(pitch), z = -ay0 * Math.sin(pitch) + heel * Math.cos(pitch); return V3(0, y, zFlat - heel + z); }
  if (pitch < 0) { const ry = ay0 - yB, rz = -ball, y = yB + ry * Math.cos(pitch) + rz * Math.sin(pitch), z = -ry * Math.sin(pitch) + rz * Math.cos(pitch); return V3(0, y, zFlat + ball + z); }
  return V3(0, ay0, zFlat); }
// ---------------------------------------------------------------- the walk (gait6)
// o: { phase (cycle phase at t = 0), terms (lane F's gaitTerms, possibly scaled), v (m/s over the ground), seed, armK (0 = no swing) }.
// The local frame is the figure's (x left, z forward); the group moves at v along its heading (the act sets it). Returns the report.
export function gait6(hp, t, o) {
  const G = o.terms, s = hp.sx, T = 120 / G.cadence, ph = (((t / T + (o.phase || 0)) % 1) + 1) % 1, Ls = G.step, legLen = hp.legLen, v = o.v ?? (2 * Ls / T), seed = o.seed || 1;
  const ay0 = hp.ank0.L.y, zA = hp.ank0.L.z, heel = hp.heel6, ball = hp.ball6, yB = hp.ballY6;
  const pHS = 0.26, pTO = o.pTO ?? 1.0;
  const roll = (zFlat, pitch) => { if (pitch > 0) { const ry = ay0, rz = heel, y = ry * Math.cos(pitch) + rz * Math.sin(pitch), z = -ry * Math.sin(pitch) + rz * Math.cos(pitch); return V3(0, y, zFlat - heel + z); }
    if (pitch < 0) { const ry = ay0 - yB, rz = -ball, y = yB + ry * Math.cos(pitch) + rz * Math.sin(pitch), z = -ry * Math.sin(pitch) + rz * Math.cos(pitch); return V3(0, y, zFlat + ball + z); }
    return V3(0, ay0, zFlat); };
  const stanceAt = p => { const zF = Ls * 0.5 - (p / 0.5) * Ls, pitch = p < 0.1 ? pHS * (1 - sstep(0, 0.1, p)) : p > 0.3 ? -pTO * Math.pow(sstep(0.3, 0.6, p), 1.35) : 0; return { A: roll(zF, pitch), pitch }; };
  const foot = (p, sg) => { let A, pitch, toe = 1, stance = p < 0.6;
    if (stance) ({ A, pitch } = stanceAt(p));
    else { const u = (p - 0.6) / 0.4, e = u * u * u * (u * (u * 6 - 15) + 10), a0 = stanceAt(0.6), a1 = stanceAt(1e-6);
      // the swing in the WORLD: the ankle leaves and lands at rest over the ground (local = world - the group's travel)
      A = a0.A.clone().lerp(a1.A, e); A.z += v * 0.4 * T * (e - u);
      A.y += (o.swingLift ?? 0.12) * s * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.42)), 1.3);   // the heel comes up behind in early swing
      pitch = a0.pitch + (a1.pitch - a0.pitch) * sstep(0.04, 0.8, u); toe = 1 - sstep(0, 0.35, u); }
    A.x = sg * G.width / 2; return { p: V3(A.x, 0, A.z + zA), yaw: sg * G.toe, pitch, toe, lift: A.y - ay0 - (pitch ? 0.06 * Math.sin(Math.abs(pitch)) : 0), stance, A, ph: p }; };
  const fL = foot(ph, 1), fR = foot((ph + 0.5) % 1, -1);
  const obl = G.oblRangeDeg / 2 * Math.PI / 180 * Math.sin(TAU * (ph + 0.1)), yaw = -(G.yaw * 1.15) * Math.cos(TAU * ph), sway = G.sway * Math.sin(TAU * ph);
  const top = hp._gaitTop && hp._gaitTop.w === G.width ? hp._gaitTop.y : (hp._gaitTop = { w: G.width, y: hp._hipY(G.width / 2, 0) }).y;
  // the hips: highest at mid-stance, lowest at the double support; a LOADING RESPONSE dip just after each heel strike (the stance knee
  // takes the weight: ~15 deg), the person's posture (lane F) on top
  const bump = x => { const d = ((x % 0.5) + 0.5) % 0.5 - 0.12; return Math.exp(-(d * d) / (0.055 * 0.055)); };
  let py = top - 0.004 * s - G.comVertPct / 100 * legLen * 0.5 * (1 + Math.cos(2 * TAU * ph)) - (o.lr ?? 0.02) * s * bump(ph) + (G.posture ? -G.posture.kneeBend * 0.05 * s : 0);
  const hx = hp.hipHalf0, pz = hp.hip0.z + 0.02 * s;
  for (const [f, sg] of [[fL, 1], [fR, -1]]) if ((f.stance && f.ph <= 0.52) || (!f.stance && f.A.y < hp.ank0.L.y + 0.04 * s)) { const dx = sway + sg * hx * Math.cos(obl) - f.A.x, dz = pz + Math.abs(hx * Math.sin(yaw)) - (f.A.z + zA), dy0 = sg * hx * Math.sin(obl);
    const lim = f.A.y - dy0 + Math.sqrt(Math.max(0, (legLen * 0.999) ** 2 - dx * dx - dz * dz)); py = Math.min(py, lim); }
  // a foot out of the leg's reach comes in along it: in pre-swing only when truly unreachable, in early swing at a soft knee, in late swing
  // the leg reaching nearly straight for the heel strike (lane F held every swing at 0.97 of the leg: a knee stuck near 28 deg)
  for (const [f, sg] of [[fL, 1], [fR, -1]]) if (!f.stance || f.ph > 0.52) { const u = f.stance ? 0 : (f.ph - 0.6) / 0.4, Hj = V3(sway + sg * hx, py + sg * hx * Math.sin(obl), pz), A = V3(f.A.x, f.A.y, f.A.z + zA), w = A.clone().sub(Hj), L = w.length(), Lm = legLen * (f.stance ? 0.995 : lerp(0.975, 0.997, sstep(0.45, 0.85, u)));
    if (L > Lm) { A.copy(Hj).addScaledVector(w, Lm / L); f.p.set(A.x, 0, A.z); f.lift = A.y - ay0 - (f.pitch ? 0.06 * Math.sin(Math.abs(f.pitch)) : 0); } }
  const P = G.posture || {}, k = Math.floor(t / T + (o.phase || 0)), drift = 0.012 * noise1(t * 0.35, seed + 21);
  const pelvis = { p: V3(sway, py, pz), yaw, pitch: o.pitch ?? 0.06, roll: -obl };   // (rev 7: o.pitch / o.flex lean the loaded carry back; the defaults are the walk's)
  hp.solve({ pelvis, spine: { flex: 0.035 + (P.kyphosis || 0) * 0.4 + 0.006 * Math.cos(2 * TAU * ph + 0.6) + (o.flex || 0), twist: -yaw * 1.35 + drift, bend: obl * 0.9 },
    head: { yaw: yaw * 0.3 - drift * 0.8, pitch: -(P.headFwd || 0) * 0.3 + 0.012 * Math.sin(2 * TAU * ph + 0.4), roll: -obl * 0.3 },
    feet: [{ p: fL.p, yaw: fL.yaw, pitch: fL.pitch, lift: fL.lift, toe: fL.toe }, { p: fR.p, yaw: fR.yaw, pitch: fR.pitch, lift: fR.lift, toe: fR.toe }] });
  // the arms: opposite the legs, farther forward than back, the elbow lagging the shoulder; the person's amplitude (lane F), each side its
  // own (seeded), varying a little stride to stride
  const armK = o.armK ?? 1;
  if (armK > 0) for (const [sd, sg] of [['L', 1], ['R', -1]]) { const own = 1 + 0.12 * (hash(seed, sg > 0 ? 41 : 43) - 0.5) + 0.08 * noise1(k * 0.7 + (sg > 0 ? 0 : 5.3), seed + 17);
    const c = -sg * Math.cos(TAU * (ph - 0.05)), ce = -sg * Math.cos(TAU * (ph - 0.11)), amp = G.armSwing * armK * own;
    const a = amp * (c > 0 ? 0.3 * c : 0.22 * c);
    hp.hang(sd, { out: 0.1 + 0.02 * Math.max(0, -c), back: -a, elbow: 0.24 + 0.42 * Math.max(0, ce) * amp + 0.05 * (1 - Math.abs(ce)), palm: 'in', relax: 0.9 }); }
  const add = { L: hp.hipAngles('L').add, R: hp.hipAngles('R').add };
  return { ph, pelvis, stance: { L: fL.stance, R: fR.stance }, feet: { L: fL, R: fR }, oblDeg: obl * 180 / Math.PI, yawDeg: yaw * 180 / Math.PI, swayM: sway, hipAdd: add, knee: hp.rep.feet ? { L: hp.rep.feet.L?.kneeFlex, R: hp.rep.feet.R?.kneeFlex } : null };
}

// ---------------------------------------------------------------- WALK across, STOP with a settle, TURN eyes-head-body, SETTLE on one leg
export class WalkTurn6 extends WalkTurn {
  // o.start (s, opt-in): the person STANDS that long, then starts from standing (a first step: the left foot stays and rolls onto its toes,
  // the right steps to its heel strike, the arms begin to swing) into the walk; without it the take starts mid-stride as MOTION c1's did
  constructor(P, o = {}) { super(P, o); this.hp = new HeroPoser6(P.h, { kin: !!P.h.meta?.kin, person: P.p }); this.G = { ...this.hp.gaitTerms(), ...(o.terms || {}) };
    if (o.speedK) { this.G.cadence *= o.speedK; this.G.step *= Math.sqrt(o.speedK); }
    this.T = 120 / this.G.cadence; this.v = this.G.step * this.G.cadence / 60; const dist = o.dist ?? 3.2;
    if (o.start != null) { this.tS0 = o.start; this.Dstep = this.T / 2; this.tS1 = this.tS0 + this.Dstep; this.D0 = this.G.step / 2;
      const k = Math.max(1, Math.ceil((dist - this.D0) / (this.v * this.T) + 0.25)); this.ts = this.tS1 + (k - 0.25) * this.T; }
    else { const tw = dist / this.v; const k = Math.ceil((tw / this.T + this.phase0 - 0.25)); this.ts = (k + 0.25 - this.phase0) * this.T; if (this.ts < 0.5) this.ts += this.T; }
    this.Dstop = 0.7; this.tTurn = this.ts + this.Dstop + 0.12; this.Dturn = 1.3; this.tEnd = this.tTurn + this.Dturn; this._ss = null; this._ts = null;
    // the hold: the weight goes onto one leg (the person's own standing side from her stance record), the free knee softens
    this.standSide = (P.pose?.side === 'R') ? 'R' : 'L';
    this.rep = { gait: { step: this.G.step, cadence: this.G.cadence, speed: this.v, width: this.G.width, armSwing: this.G.armSwing }, start: this.tS0 ?? null, stopAt: this.ts, turnAt: this.tTurn, act: 'WalkTurn6' };
  }
  // the gait's own time and phase (with a start: the cycle begins at the first heel strike, phase 0.5)
  gt(t) { return this.tS1 != null ? t - this.tS1 : t; }
  get gph() { return this.tS1 != null ? 0.5 : this.phase0; }
  groupAt(t) { let d; if (this.tS1 == null) d = this.v * Math.min(t, this.ts);
    else d = t < this.tS0 ? 0 : t < this.tS1 ? herm2(0, 0, this.D0, this.v, this.Dstep, t - this.tS0) : this.D0 + this.v * (Math.min(t, this.ts) - this.tS1);
    return { x: this.from[0] + this.dir * d, z: this.from[1], yaw: this.yaw0 }; }
  // the arm swing gait6 gives at a phase (for the start's blend)
  _armAt(sd, ph) { const sg = sd === 'L' ? 1 : -1, c = -sg * Math.cos(TAU * (ph - 0.05)), ce = -sg * Math.cos(TAU * (ph - 0.11)), amp = this.G.armSwing, a = amp * (c > 0 ? 0.3 * c : 0.22 * c);
    return { back: -a, elbow: 0.24 + 0.42 * Math.max(0, ce) * amp + 0.05 * (1 - Math.abs(ce)), out: 0.1 + 0.02 * Math.max(0, -c) }; }
  _startState() { if (this._s0) return this._s0; const hp = this.hp, h = this.h, w = this.G.width / 2;
    const g = this.groupAt(this.tS1); this._setGroup(g.x, g.z, g.yaw); const r = gait6(hp, 0, { phase: 0.5, terms: this.G, v: this.v, seed: this.seed });
    const pel1 = { p: r.pelvis.p.clone().add(V3(0, 0, this.D0)), yaw: r.pelvis.yaw, pitch: r.pelvis.pitch, roll: r.pelvis.roll };
    const pel0 = { p: V3(0, hp._hipY(w, 0) - 0.006 * hp.sx, hp.hip0.z + 0.01 * hp.sx), pitch: 0.03 };
    this._s0 = { w, pitchL: r.feet.L.pitch, pitchR: r.feet.R.pitch, pel0, pel1 }; return this._s0; }
  _start(t, c) { const h = this.h, hp = this.hp, S = this._startState(), g = this.groupAt(t), d = t < this.tS0 ? 0 : (g.x - this.from[0]) * this.dir; this._setGroup(g.x, g.z, g.yaw);
    const zA = hp.ank0.L.z, u = clamp((t - this.tS0) / this.Dstep), e = smoother(u), stepping = t >= this.tS0;
    // standing: the weight comes over the left foot just before it (the centre of pressure goes the other way first)
    const shift = 0.022 * hp.sx * (ease(this.tS0 - 0.35, this.tS0 + 0.05, t) - 0.5 * ease(this.tS0 + 0.05, this.tS1, t)) - 0.006 * hp.sx * Math.sin(Math.PI * clamp((t - this.tS0 + 0.5) / 0.35));
    const pL = S.pitchL * Math.pow(sstep(0.3, 1, u), 1.35), AL = footRoll(hp, 0 - d, stepping ? pL : 0);
    const zR = lerp(0, this.G.step * 0.5 + this.D0, smoother((u - 0.12) / 0.78)) - d, pR = stepping ? S.pitchR * sstep(0.3, 0.9, u) : 0, AR = footRoll(hp, zR, pR), liftR = stepping ? 0.045 * hp.sx * Math.pow(Math.sin(Math.PI * u), 1.2) : 0;
    const fL = { p: V3(S.w, 0, AL.z + zA), yaw: this.G.toe, pitch: stepping ? pL : 0, lift: AL.y - hp.ank0.L.y - (pL && stepping ? 0.06 * Math.sin(Math.abs(pL)) : 0), toe: 1 };
    const fR = { p: V3(-S.w, 0, AR.z + zA), yaw: -this.G.toe, pitch: pR, lift: AR.y - hp.ank0.R.y - (pR ? 0.06 * Math.sin(Math.abs(pR)) : 0) + liftR };
    const pe = V3().lerpVectors(S.pel0.p, S.pel1.p, e); pe.z -= d; pe.x += shift;
    hp.solve({ pelvis: { p: pe, yaw: lerp(0, S.pel1.yaw, e), pitch: lerp(S.pel0.pitch, S.pel1.pitch, e), roll: lerp(0, S.pel1.roll, e) }, spine: { flex: lerp(0.02, 0.035, e) }, feet: [fL, fR] });
    for (const sd of ['L', 'R']) { const A = this._armAt(sd, 0.5); hp.hang(sd, { out: lerp(0.1, A.out, e), back: lerp(0.03, A.back, e), elbow: lerp(0.22, A.elbow, e), palm: 'in', relax: 0.9 }); }
    lookHead(h, 0.03 * noise1(t * 0.7, this.seed), -0.03 * e);
    return { g: [g.x, g.z, g.yaw], phase: stepping ? 'start' : 'stand', eyeYaw: c.eyeYaw * 0.4, eyePitch: -0.04 * e }; }
  _setGroup(x, z, yaw) { const g = this.h.group; g.position.x = x; g.position.z = z; g.rotation.y = yaw; g.updateMatrixWorld(true); this.hp.rebase(); }
  _walk(t, c) { if (this.tS1 != null && t < this.tS1) return this._start(t, c); const h = this.h, g = this.groupAt(t); this._setGroup(g.x, g.z, g.yaw);
    const r = gait6(this.hp, this.gt(t), { phase: this.gph, terms: this.G, v: this.v, seed: this.seed }); this._last = r;
    // the gaze leads the turn: the eyes start toward the camera ~0.7 s before the stop, the head follows 0.25 s later
    const want = Math.atan2(Math.sin(this.face - this.yaw0), Math.cos(this.face - this.yaw0)), eLead = ease(this.ts - 0.75, this.ts + 0.1, t), hLead = ease(this.ts - 0.5, this.ts + 0.3, t);
    lookHead(h, want * 0.3 * hLead + 0.03 * noise1(t * 0.7, this.seed), -0.06 * (1 - hLead));
    return { g: [g.x, g.z, g.yaw], phase: 'walk', ph: r.ph, knee: r.knee, eyeYaw: want * 0.55 * eLead, eyePitch: -0.08 * (1 - eLead) }; }
  _stopState() { if (this._ss) return this._ss; const h = this.h, hp = this.hp, g = this.groupAt(this.ts); this._setGroup(g.x, g.z, g.yaw);
    gait6(hp, this.gt(this.ts), { phase: this.gph, terms: this.G, v: this.v, seed: this.seed }); h.update();
    const L = hp.local(h.joint('foot.L')), R = hp.local(h.joint('foot.R')), hips = hp.local(h.joint('upperleg01.L').add(h.joint('upperleg01.R')).multiplyScalar(0.5));
    const ankL = V3(L.x, 0, L.z), ankR = V3(R.x, 0, R.z), Rlift = R.y - hp.ank0.R.y, T = hp.stanceTerms();
    // the arms' swing at the stop: where each was in its cycle (the settle swings on from there)
    const ph = (((this.gt(this.ts) / this.T + this.gph) % 1) + 1) % 1, arm = { L: -Math.cos(TAU * (ph - 0.05)), R: Math.cos(TAU * (ph - 0.05)) };
    this._ss = { g, ankL, ankR, Rlift, hips, hx: T.ankleSep / 2, toe: T.toe, vz: this.v, py0: hips.y, arm };
    return this._ss; }
  // the stop: the right foot lands beside the planted left; the hips run on and come back over the feet (a damped overshoot), the trunk
  // rocks forward and back, the arms swing on from where they were and die out
  _stop(t, c) { const h = this.h, hp = this.hp, S = this._stopState(), tau = t - this.ts; this._setGroup(S.g.x, S.g.z, S.g.yaw);
    const u = clamp(tau / 0.36), e = smoother(u);
    const land = V3(S.ankL.x - 2 * S.hx, 0, S.ankL.z + 0.015);
    const fR = { p: V3(lerp(S.ankR.x, land.x, e), 0, lerp(S.ankR.z, land.z, e)), yaw: -S.toe, lift: Math.max(0, S.Rlift * (1 - e) + 0.03 * Math.sin(Math.PI * u) * (1 - u)) };
    const fL = { p: S.ankL.clone(), yaw: S.toe, lock: 0.5 };
    const midX = (S.ankL.x + land.x) / 2, midZ = (S.ankL.z + land.z) / 2 + hp.hip0.z - hp.ank0.L.z - 0.004;
    const over = 0.018 * hp.sx * settle(tau - 0.25, 1.1, 0.5);   // the run-on past the feet and back
    const pz = herm(S.hips.z, S.vz, midZ, this.Dstop, tau) + over, px = herm(S.hips.x, 0, midX, this.Dstop * 0.8, tau);
    const py = lerp(S.py0, hp._hipY(S.hx, 0) - 0.008 * hp.sx, ease(0, this.Dstop, tau));
    const rock = 0.05 * settle(tau - 0.15, 1.0, 0.45);
    hp.solve({ pelvis: { p: V3(px, py, pz), pitch: 0.06 * (1 - ease(0, this.Dstop, tau)) }, spine: { flex: 0.03 * (1 - ease(0, this.Dstop, tau)) + rock }, feet: [fL, fR] });
    for (const sd of ['L', 'R']) { const a0 = S.arm[sd] * 0.3 * this.G.armSwing, a = a0 * Math.cos(TAU * 0.9 * tau) * Math.exp(-2.4 * tau) + 0.06 * this.G.armSwing * settle(tau, 0.9, 0.35);
      hp.hang(sd, { out: 0.1, back: -a, elbow: 0.25 + 0.35 * Math.max(0, a), palm: 'in', relax: 0.9 }); }
    const want = Math.atan2(Math.sin(this.face - this.yaw0), Math.cos(this.face - this.yaw0)), lead = 0.3 + 0.3 * ease(0, this.Dstop, tau);
    lookHead(h, want * lead, 0);
    return { g: [S.g.x, S.g.z, S.g.yaw], phase: 'stop', eyeYaw: want * 0.55, eyePitch: 0 }; }
  _turnState() { if (this._ts) return this._ts; const S = this._stopState(), hp = this.hp; this._stop(this.tTurn, this.life.at(this.tTurn)); const h = this.h;
    const wL = h.joint('foot.L'), wR = h.joint('foot.R'), mid = wL.clone().add(wR).multiplyScalar(0.5), hipsW = h.joint('upperleg01.L').add(h.joint('upperleg01.R')).multiplyScalar(0.5);
    const yaw0 = this.yaw0, yaw1 = this.face, turnR = Math.sin(yaw1 - yaw0) < 0, z0 = hp.ank0.L.z;
    const g0 = this._gAt(mid, z0, yaw0), lh = this._toLocal(hipsW, g0.x, g0.z, yaw0);
    const g1 = this._gAt(mid, z0, yaw1), end = s => this._toWorld(V3(s === 'L' ? S.hx : -S.hx, 0, z0), g1.x, g1.z, yaw1);
    this._ts = { mid, z0, lh, yaw0, yaw1, first: turnR ? 'R' : 'L', start: { L: V3(wL.x, 0, wL.z), R: V3(wR.x, 0, wR.z) }, end: { L: end('L'), R: end('R') }, py0: hp.local(hipsW).y };
    return this._ts; }
  // the turn: the eyes go first, the head 0.15 s later, the body in two steps; after it the weight settles onto one leg (the hips over the
  // standing foot, the free hip dropping, the free knee softening) and the arms swing out of the turn and die out; the hold breathes
  _turn(t, c) { const h = this.h, hp = this.hp, S = this._stopState(), U = this._turnState(), tau = t - this.tTurn, D = this.Dturn;
    const k = ease(0.08 * D, D, tau), yaw = angLerp(U.yaw0, U.yaw1, k), G = this._gAt(U.mid, U.z0, yaw); this._setGroup(G.x, G.z, yaw);
    const foot = (s, a, b) => { const m = 0.18 * (b - a), u = ease((a + m) * D, (b - m) * D, tau), lift = 0.045 * hp.sx * Math.sin(Math.PI * clamp((tau - a * D) / ((b - a) * D))), w = U.start[s].clone().lerp(U.end[s], u);
      const fyaw = angLerp(U.yaw0, U.yaw1, u) + (s === 'L' ? S.toe : -S.toe); const l = this._toLocal(w, G.x, G.z, yaw); return { p: V3(l.x, 0, l.z), yaw: fyaw - yaw, lift: (tau > a * D && tau < b * D) ? lift : 0 }; };
    const first = U.first, second = first === 'L' ? 'R' : 'L', F = { [first]: foot(first, 0.06, 0.52), [second]: foot(second, 0.44, 0.94) };
    const b1 = Math.sin(Math.PI * clamp((tau - 0.06 * D) / (0.46 * D))), b2 = Math.sin(Math.PI * clamp((tau - 0.44 * D) / (0.5 * D)));
    const dip = 0.007 * hp.sx * (b1 + b2), shift = 0.028 * hp.sx * (first === 'R' ? 1 : -1) * (b1 - b2);
    // the settle onto the standing leg after the turn (0.75 D .. D + 0.9 s)
    const sw = ease(0.75 * D, D + 0.9, tau), sgW = this.standSide === 'L' ? 1 : -1, wShift = sw * 0.62 * S.hx * sgW, drop = sw * 0.06 * sgW;
    const ks = ease(0, D, tau), py = lerp(U.py0, hp._hipY(S.hx, 0) - 0.008 * hp.sx, ks) - dip - sw * 0.006 * hp.sx;
    const px = lerp(U.lh.x, hp.hip0.x, ks) + shift + wShift, pz = lerp(U.lh.z, hp.hip0.z - 0.006 * hp.sx, ks);
    const fl = { ...F.L, lock: this.standSide === 'L' ? 0.6 * sw : 0 }, fr = { ...F.R, lock: this.standSide === 'R' ? 0.6 * sw : 0 };
    hp.solve({ pelvis: { p: V3(px, py, pz), yaw: 0, roll: -drop }, spine: { bend: drop * 1.3 }, feet: [fl, fr] });
    const swing = 0.08 * settle(tau - 0.55 * D, 0.95, 0.4);
    for (const sd of ['L', 'R']) hp.hang(sd, { out: 0.1, back: 0.03 + (sd === first ? swing : -swing), elbow: 0.22, palm: 'in', relax: 0.9 });
    // the eyes lead by ~0.4 s, the head by ~0.25 s
    const kh = ease(-0.25 * D, D - 0.3, tau), hy = angLerp(U.yaw0, U.yaw1, kh) - yaw;
    const rest = tau > D ? 0.04 * noise1((t - this.tEnd) * 0.4, this.seed + 3) : 0;
    lookHead(h, hy * 0.9 + rest, 0.02);
    // the head comes level over the counter-tilted shoulders (POSE's neck takes back most of the tilt)
    if (sw > 0) { const q = Qt(); h.group.getWorldQuaternion(q); h.rotateWorld('neck01', V3(0, 0, 1).applyQuaternion(q), -drop * 0.8); h.update(); }
    const ey = angLerp(U.yaw0, U.yaw1, ease(-0.45 * D, D - 0.55, tau)) - (yaw + hy * 0.9);
    return { g: [G.x, G.z, yaw], phase: tau < D ? 'turn' : 'hold', eyeYaw: clamp(ey, -0.35, 0.35) + c.eyeYaw * 0.3, eyePitch: c.eyePitch * 0.3, smile: tau > D * 0.7 ? c.smile + 0.04 * ease(D * 0.7, D + 0.6, tau) : c.smile }; }
  frame(t) { const out = super.frame(t); out.toe = this.hp.toeHeights(); return out; }
}

// ---------------------------------------------------------------- the hands on a box (lane F's HandRig closing the fingers on its SDF)
// the wrist's world quaternion that puts the hand's bind frame (a across the knuckles, f along the fingers, n out of the palm) on (f, n)
// given in the WORLD
// (the bind frame's handedness differs between the hands: hero.js turns n toward the thumb, so a is taken with the same handedness here,
// or the left hand's rotation would come out improper; act4.js's handQ did not, which put MOTION c1's left palm off the box)
export function handQW(h, side, fW, nW) { const H = h._hand0(side), f = fW.clone().normalize(), n = nW.clone().addScaledVector(f, -nW.dot(f)).normalize(), hs = Math.sign(H.a.dot(V3().crossVectors(H.n, H.f))) || 1, a = V3().crossVectors(n, f).multiplyScalar(hs);
  const M0 = new THREE.Matrix4().makeBasis(H.a, H.f, H.n), M1 = new THREE.Matrix4().makeBasis(a, f, n), R = new THREE.Matrix4().multiplyMatrices(M1, M0.clone().transpose());
  return Qt().setFromRotationMatrix(R); }
export function wristForW(h, side, palmW, q) { const H = h._hand0(side), off = H.palm.clone().sub(H.w).multiplyScalar(h.scale); return palmW.clone().sub(off.applyQuaternion(q)); }
// the box frame (world): centre c, yaw; its local axes x (width), y (up), z (depth)
export const boxM = (c, yaw) => new THREE.Matrix4().compose(c, Qt().setFromAxisAngle(V3(0, 1, 0), yaw), V3(1, 1, 1));

// ---------------------------------------------------------------- LIFT a box from the floor, re-grip it from below, CARRY it, STOP
// ---------------------------------------------------------------- the hand's resting posture (rev 7e, opt-in)
// The adjacent fingers' angles in the palm plane (deg; + = the pair fanned apart) from the skeleton: [index-middle, middle-ring, ring-pinky] and the thumb axis to the index axis; A: each finger's direction
// in the palm plane (+ toward the little finger). The bind hand's fan is 26 / 1 / 15 deg (an A-pose hand), the photographs' relaxed hands 5.8 / 8.2 / 12.6 (MediaPipe HandLandmarker, 16 hands of 35 lifting and carrying photographs).
export function handFan(h, sd) { const J = n => h.joint(n + '.' + sd), n = h.palm(sd).n.clone().normalize(), proj = v => v.clone().addScaledVector(n, -v.dot(n)), prox = k => proj(J(`finger${k}-2`).sub(J(`finger${k}-1`))).normalize();
  const d = [2, 3, 4, 5].map(prox), u = proj(J('finger5-1').sub(J('finger2-1'))).normalize(), fw = d.reduce((a, v) => a.add(v), V3()).normalize(), A = d.map(v => Math.atan2(v.dot(u), v.dot(fw)) * 180 / Math.PI);
  const th = proj(J('finger1-2').sub(J('finger1-1'))).normalize();
  return { A, n, fan: [A[1] - A[0], A[2] - A[1], A[3] - A[2]], thumb: Math.acos(clamp(th.dot(d[0]), -1, 1)) * 180 / Math.PI }; }
export const HAND_REST7 = { im: 6, mr: 8, rp: 12 };
const _restSign = new WeakMap();
// the hand held at its resting fan: the three outer fingers' proximal bones turned about the palm normal (closed loop on the skeleton, idempotent: a hand already at rest is not moved). The middle finger is the reference.
export function restHand7(h, sd, rest = HAND_REST7) { h.update(); const key = h; let C = _restSign.get(key); if (!C) _restSign.set(key, C = {});
  if (C[sd] == null) { const F0 = handFan(h, sd), b = h.bone('finger2-1.' + sd), q0 = b.quaternion.clone(); h.rotateWorld('finger2-1.' + sd, F0.n, 0.05); h.update(); const F1 = handFan(h, sd); C[sd] = Math.sign(F1.A[0] - F0.A[0]) || 1; b.quaternion.copy(q0); h.update(); }
  const F = handFan(h, sd), sg = C[sd], Am = F.A[1], tgt = [Am - rest.im, Am, Am + rest.mr]; tgt.push(tgt[2] + rest.rp);
  for (const [k, n] of [[0, 2], [2, 4], [3, 5]]) { const d = (tgt[k] - F.A[k]) * Math.PI / 180; if (Math.abs(d) > 1e-4) h.rotateWorld(`finger${n}-1.${sd}`, F.n, sg * d); }
  h.update(); }
// The loaded carry's parameters: THE acting (one current version). `w7` on an act overrides them, only for the one A/B switch being measured (this iteration: `balance`).
//   balance (rev 8): the lean is SOLVED from the load (_solveLean: the person's own segment masses and the box's mass over the feet), `leanBones` / `pelvisPitch` / `shoulder` are its SHAPE
//   (how a lean is shared down the trunk), their amplitude is the solution; with balance false they are the amplitude (the dial; its stopPitch / stopHold with them: delete when the measurer rules)
export const LIFT = { boxUp: 0.09, boxOut: 0.02, leanBones: [['spine04', 0.095], ['spine03', 0.04], ['spine02', 0.075]], headDown: 0.19, pole: [0.55, -0.75, -0.25], poleSide: null, bob: 0.009, lr: 0.026,
  pelvisPitch: -0.115, spineFlex: 0, stopPitch: -0.115, stopHold: 0.9, stepK: 0.68, cadK: 0.92, shoulder: { fwd: 0.18, down: 0.06 }, balance: true,
  side: { dx: 0.02, yaw: 0.3, dxF: 0.034, yawF: 0.3, L: { yaw: 0.4, yawF: 0.3 }, R: { dx: 0.016, yaw: 0.15, dxF: 0.032, yawF: 0.15 } }, regripStag: 0.4,
  hand7: { rest: { im: 6, mr: 8, rp: 12 }, enslave: true, thumb: true, thumbClear: 0.0015, reachBlend: true },
  rolls: [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45], pitches: [0, 0.07, 0.13, 0.2, 0.28], fitPalm: true };
export class LiftCarry6 {
  constructor(P, { seed = null, kg = 8, box = null, at = [0, 0], yaw = 0, carrySteps = 4, tCarry = 3.75, w7 = null } = {}) {
    this.P = P; const h = this.h = P.h; this.seed = seed ?? seedOf(P.info?.name || 'l');
    h.group.position.x = at[0]; h.group.position.z = at[1]; h.group.rotation.y = yaw; h.group.updateMatrixWorld(true);
    this.hp = new HeroPoser6(h, { kin: !!h.meta?.kin, person: P.p }); const sx = this.hp.sx;
    this.box = box || { w: 0.40 * sx, h: 0.28 * sx, d: 0.30 * sx }; this.kg = kg; this.at = at; this.yaw = yaw;
    this.life = new Life(h, { seed: this.seed, rec: P.pose || {}, person: P.p, kin: !!h.meta?.kin, look: 0.4 });
    const Wp = { ...LIFT, ...(w7 || {}) }; this.G = { ...this.hp.gaitTerms() }; this.G.step *= Wp.stepK; this.G.cadence *= Wp.cadK; this.G.armSwing = 0;   // (stepK / cadK: the loaded gait's scale)
    this.T = 120 / this.G.cadence; this.v = this.G.step * this.G.cadence / 60; this.tCarry = tCarry; this.nSteps = carrySteps;
    const T = this.hp.stanceTerms(); this.hx = Math.max(T.ankleSep / 2 + 0.03 * sx, 0.11 * sx); this.toe = T.toe + 0.1;
    // a carrying base: the steps as wide as the stance the box was lifted from and turned out as it was (a load widens the base); the
    // first step from standing (T / 2 before the carry), 3.5 steps of carry ending at the left foot's mid-stance, then the stop step
    this.G.width = 2 * this.hx; this.G.toe = this.toe; this.tStep0 = tCarry - this.T / 2; this.Dstep = this.T / 2;
    this.tStop = tCarry + (Math.max(1, carrySteps / 2 - 0.25)) * this.T; this.Dstop = 0.65; this.tEnd = this.tStop + this.Dstop;
    this.z0 = this.hp.ank0.L.z + 0.29 * sx;
    this.rig = { L: new HandRig(h, 'L'), R: new HandRig(h, 'R') }; this.grips = {};
    this.rep = { kg, box: this.box, carry: { step: this.G.step, cadence: this.G.cadence, speed: this.v }, act: 'LiftCarry6' };
    this.W = Wp;
  }
  // the lift's phase table (act4's, re-timed: a re-grip at the belly 2.95-3.45 s before the carry)
  keys(u) { const sq = 1 + (hash(this.seed, 5) - 0.5) * 0.16, hd = this.box.h / 2;
    const K = [[0.0, { drop: 0, back: 0, flex: 0.05, head: 0.1, by: hd, hold: 0, on: 0 }], [0.45, { drop: 0.02, back: 0, flex: 0.15, head: 0.45, by: hd, hold: 0, on: 0 }],
      [1.25, { drop: 0.44 * sq, back: -0.16, flex: 1.08 / sq, head: -0.1, by: hd, hold: 0, on: 0.95 }], [1.5, { drop: 0.47 * sq, back: -0.17, flex: 1.12 / sq, head: -0.15, by: hd, hold: 0, on: 1 }],
      [1.85, { drop: 0.46 * sq, back: -0.18, flex: 1.06 / sq, head: -0.4, by: hd + 0.025, hold: 0, on: 1 }], [2.25, { drop: 0.2 * sq, back: -0.12, flex: 0.66, head: -0.3, by: 0.42, hold: 0.3, on: 1 }],
      [2.7, { drop: 0.02, back: -0.02, flex: 0.02, head: -0.05, by: 0.98, hold: 1, on: 1 }], [3.0, { drop: 0.015, back: 0, flex: -0.06, head: 0.02, by: 1, hold: 1, on: 1 }], [99, { drop: 0.015, back: 0, flex: -0.06, head: 0.05, by: 1, hold: 1, on: 1 }]];
    let i = 0; while (i < K.length - 2 && K[i + 1][0] <= u) i++; const [ta, A] = K[i], [tb, B] = K[i + 1], w = smoother((u - ta) / (tb - ta)), o = {};
    for (const k in A) o[k] = lerp(A[k], B[k], w); return o; }
  _setGroup(x, z, yaw) { const g = this.h.group; g.position.x = x; g.position.z = z; g.rotation.y = yaw; g.updateMatrixWorld(true); this.hp.rebase(); }
  // the first step's ends: the standing feet (world z along the heading, from the lift's stance), the gait's double support it lands in
  _stepState() { if (this._s0) return this._s0; const hp = this.hp, h = this.h, sx = hp.sx, Ls = this.G.step, D0 = Ls / 2 - 0.03 * sx;
    const st = { L: V3(this.hx, 0, hp.ank0.L.z - 0.03 * sx), R: V3(-this.hx, 0, hp.ank0.R.z - 0.01 * sx) };
    // the gait at the carry's start (phase 0.5: the right heel strikes, the left on its toes) with the group D0 on
    const fwd = V3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); this._setGroup(this.at[0] + fwd.x * D0, this.at[1] + fwd.z * D0, this.yaw);
    const r = gait6(hp, 0, { phase: 0.5, terms: this.G, v: this.v, seed: this.seed, armK: 0, lr: this.W.lr, pitch: this._pitch(), flex: this.W.spineFlex });
    const pel1 = { p: r.pelvis.p.clone().add(V3(0, 0, D0)), yaw: r.pelvis.yaw, pitch: r.pelvis.pitch, roll: r.pelvis.roll };   // (in the start frame)
    this._setGroup(this.at[0], this.at[1], this.yaw);
    // the pelvis at the start: as the lift's hold leaves it (the last key)
    const K = this.keys(this.tStep0), pel0 = { p: V3(0, hp.hip0.y - K.drop * hp.legLen, hp.hip0.z + K.back * sx), pitch: K.flex * 0.55 };
    const rf = r.feet.R; this._s0 = { L: st.L, R: st.R, Rend: Ls * 0.5 + hp.ank0.R.z, pitchL: r.feet.L.pitch, pitchR: rf.pitch, pel0, pel1 };
    // (the pelvis targets are in the frame of the group at the step's start; the step's solve runs in the moving group's frame)
    return this._s0; }
  _carryStop() { if (this._cs) return this._cs; const h = this.h, hp = this.hp, Ls = this.G.step, D0 = Ls / 2 - 0.03 * hp.sx, d = D0 + this.v * (this.tStop - this.tCarry), fw = V3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this._setGroup(this.at[0] + fw.x * d, this.at[1] + fw.z * d, this.yaw); gait6(hp, this.tStop - this.tCarry, { phase: 0.5, terms: this.G, v: this.v, seed: this.seed, armK: 0, lr: this.W.lr, pitch: this._pitch(), flex: this.W.spineFlex }); h.update();
    const L = hp.local(h.joint('foot.L')), R = hp.local(h.joint('foot.R')), hips = hp.local(h.joint('upperleg01.L').add(h.joint('upperleg01.R')).multiplyScalar(0.5));
    this._cs = { ankL: V3(L.x, 0, L.z), ankR: V3(R.x, 0, R.z), Rlift: R.y - hp.ank0.R.y, hips }; return this._cs; }
  // ---- THE LEAN IS SOLVED FROM THE LOAD (iteration 1 of c3 run 2; the dial it replaces is kept only as the A/B switch `balance: false`, to delete when the measurer rules)
  // The carrying lean is not a number to set: a person holding a mass in front of the body leans back until the COMBINED centre of mass (the person's own segment masses, lane F's kin: the arms
  // forward on the box too, and the box's mass at the box's place) is over the feet where the unloaded person's own centre of mass was over the same feet. The lean's SHAPE (how the extension is
  // shared between the pelvis' tilt, the lumbar, thoracic and cervicothoracic spine and the clavicles: W.pelvisPitch / leanBones / shoulder at lam 1) is the one anatomical assumption; its AMPLITUDE
  // lam is the solution (secant on the COM's depth), once per act at the carry's first double support, and holds through the stop (the load is still in the arms).
  _leanBones(f) { const h = this.h, hp = this.hp;
    for (const [lb, la] of this.W.leanBones) h.rotateWorld(lb, hp.dirW(V3(1, 0, 0)), -la * f);
    if (this.W.shoulder) for (const [sd, sg] of [['L', 1], ['R', -1]]) { h.rotateWorld(`clavicle.${sd}`, hp.dirW(V3(0, 1, 0)), -sg * this.W.shoulder.fwd * f); h.rotateWorld(`clavicle.${sd}`, hp.dirW(V3(0, 0, 1)), -sg * this.W.shoulder.down * f); } }   // (the shoulders drawn forward and down round the load)
  // the box held in the chest's frame (from the lift's hold over the first step): its centre in the figure's local frame and its yaw, for the pose the bones hold now
  _boxCentre(lean = 1) { const h = this.h, hp = this.hp, sx = hp.sx; h.update();
    const ch = hp.local(h.joint('spine03')), pel = hp.local(h.joint('upperleg01.L').add(h.joint('upperleg01.R')).multiplyScalar(0.5));
    const Bc = V3(pel.x * 0.5 + ch.x * 0.5, hp.hip0.y + 0.065 * sx + this.box.h / 2 + (pel.y - hp.hip0.y) * 0.8, ch.z + 0.135 * sx + this.box.d / 2);
    Bc.y += this.W.boxUp * sx; Bc.z += this.W.boxOut * sx;
    if (lean < 1) { const Bh = V3(0, hp.hip0.y + 0.065 * sx + this.box.h / 2 - 0.01 + this.W.boxUp * sx, hp.hip0.z + 0.235 * sx); Bc.lerpVectors(Bh, Bc, lean); }
    return { Bc, byaw: 0.25 * (ch.x - pel.x) * lean }; }
  _lam() { if (!this.W.balance) return 1; if (!this._lean) this._solveLean(); return this._lean.lam; }
  _pitch() { return this.W.balance ? lerp(0.06, this.W.pelvisPitch, this._lam()) : this.W.pelvisPitch; }
  _solveLean() { const h = this.h, hp = this.hp, sx = hp.sx, W = this.W, Ls = this.G.step, D0 = Ls / 2 - 0.03 * sx, fw = V3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), g0 = [h.group.position.x, h.group.position.z, h.group.rotation.y];
    this._setGroup(this.at[0] + fw.x * D0, this.at[1] + fw.z * D0, this.yaw);   // the carry's first double support (phase 0.5: the right heel strikes, the left on its toes), as _stepState poses it
    const pose = lam => { gait6(hp, 0, { phase: 0.5, terms: this.G, v: this.v, seed: this.seed, armK: 0, lr: W.lr, pitch: lerp(0.06, W.pelvisPitch, lam), flex: W.spineFlex }); this._leanBones(lam); h.update(); };
    // the unloaded person's own balance over these feet: arms hanging
    pose(0); for (const sd of ['L', 'R']) hp.hang(sd, { out: 0.1, back: 0.0, elbow: 0.24, palm: 'in', relax: 0.9 }); h.update(); const ref = hp.balanceErr().err.z;
    // the loaded person: the box in the arms (the arms to its under grips), the box's mass at its centre
    const load = lam => { pose(lam); const X = this._boxCentre(1); this._reachable(X.Bc, X.byaw, 'under'); const BW = hp.world(X.Bc.clone()); BW.y = X.Bc.y; const M = boxM(BW, h.group.rotation.y + X.byaw);
      for (const sd of ['L', 'R']) { const sg = sd === 'L' ? 1 : -1; this._reach(sd, this._gripWorld('under', sd, M), hp.dirW(V3(sg * W.pole[0], W.pole[1], W.pole[2]).normalize())); } h.update();
      return hp.balanceErr({ load: { kg: this.kg, p: BW } }).err.z - ref; };
    const LMAX = 2.5; let a = 0, fa = load(0), b = 1, fb = load(1), it = 0; const f0 = fa;
    for (; it < 8 && Math.abs(fb) > 0.0015; it++) { const d = fb - fa; if (Math.abs(d) < 1e-9) break; let c = b - fb * (b - a) / d; c = Math.min(LMAX, Math.max(0, c)); if (c === b) break; a = b; fa = fb; b = c; fb = load(b); }
    const lam = b; pose(lam);   // (leaves the person at the solution)
    const sm = hp.local(h.joint('upperarm01.L').add(h.joint('upperarm01.R')).multiplyScalar(0.5)), hm = hp.local(h.joint('upperleg01.L').add(h.joint('upperleg01.R')).multiplyScalar(0.5));
    this._lean = { lam, kg: this.kg, comShiftMm: +(f0 * 1000).toFixed(1), residMm: +(fb * 1000).toFixed(1), iters: it, atLimit: lam >= LMAX - 1e-6 || lam <= 1e-6, trunkDeg: +(Math.atan2(hm.z - sm.z, sm.y - hm.y) * 180 / Math.PI).toFixed(1) };
    this.rep.lean = this._lean; this._setGroup(g0[0], g0[1], g0[2]); return this._lean; }
  // a grip in the BOX's frame: the palm point and the hand's frame (f, n), for side sd; kind 'side' (low on the side face, the fingers
  // down to the bottom edge and closed under it) or 'under' (palm up under the bottom near the side, the fingers forward and inward)
  _gripLocal(kind, sd) { const sg = sd === 'L' ? 1 : -1, B = this.box, s = this.hp.sx;
    if (kind === 'side') { const g = { p: V3(sg * (B.w / 2 + 0.007 * s), -B.h / 2 + 0.1 * s, -0.035 * s), f: V3(sg * 0.08, -0.75, 0.62), n: V3(-sg, 0.15, 0) }, S = this.W.side;
      // the side grip's frame moved OUT (dx m x scale), along z (dz) and up (dy), the fingers turned about the box's vertical toward its middle by `yaw` rad: the arms hang straight beside a box as wide as the shoulders,
      // so the wrist swings out, clear of the box's rear corner, and the fingertips hook the face and its lower edge; S.L / S.R override per hand; dxF / yawF: the same while the box is on the floor (the squat's arms hang further in)
      const T = { ...S, ...(S[sd] || {}) }, fk = this._floorK || 0, dx = lerp(T.dx || 0, T.dxF ?? (T.dx || 0), fk), yw = lerp(T.yaw || 0, T.yawF ?? (T.yaw || 0), fk);
      g.p.x += sg * dx * s; g.p.z += (T.dz || 0) * s; g.p.y += (T.dy || 0) * s;
      if (yw) { const ang = -sg * yw; g.f.applyAxisAngle(V3(0, 1, 0), ang); g.n.applyAxisAngle(V3(0, 1, 0), ang); }
      return g; }
    const u = { p: V3(sg * (B.w / 2 - 0.075 * s), -B.h / 2 - 0.012 * s, -B.d / 2 + 0.085 * s), f: V3(-sg * 0.32, -0.14, 1), n: V3(-sg * 0.03, 1, 0.12) }, F = this.fit && this.fit['under' + sd];
    if (F) { u.p.y += F.dy;   // (the palm fitted to the box's bottom, act7.js: its height, its pitch (the fingers tilted toward the palm's normal: > 0 lifts them to the bottom) and its roll)
      if (F.pitch) { const ax = V3().crossVectors(u.f.clone().normalize(), u.n.clone().normalize()).normalize(); u.f.applyAxisAngle(ax, F.pitch); u.n.applyAxisAngle(ax, F.pitch); }
      if (F.roll) u.n.applyAxisAngle(u.f.clone().normalize(), F.roll); }
    return u; }
  _gripWorld(kind, sd, M) { const g = this._gripLocal(kind, sd), q = Qt().setFromRotationMatrix(M); return { p: g.p.clone().applyMatrix4(M), f: g.f.clone().applyQuaternion(q), n: g.n.clone().applyQuaternion(q) }; }
  // put a hand on a grip (world), the arm by IK (the elbow out and back), the wrist in the hand's frame
  _reach(sd, G, pole, w = 1, from = null) { const h = this.h, hp = this.hp, q = handQW(h, sd, G.f, G.n); let wr = wristForW(h, sd, G.p, q);
    if (from && w < 0.999) { wr = from.clone().lerp(wr, smoother(w)); return hp.arm(sd, wr, null, pole) * 1000; }
    return hp.arm(sd, wr, q, pole) * 1000; }
  // the fingers closed on the box (HandRig.closeFinger on the box's SDF, measured on the skin), once per grip kind at its reference pose;
  // stored as joint angles and applied every frame the grip holds (the hand rides in the box's frame, so the contact holds)
  // the side grip's frame differs on the floor (the squat's arms hang further in: W.side.dxF / yawF) and on the lift, so its fingers are closed once for EACH regime and blended by the floor weight
  _closeS(sd, M, pole) {
    const k0 = this._floorK || 0, get = (reg) => { const key = 'side' + sd + reg; if (reg === 'L') get('F');   /* (the floor regime first: the lift regime's thumb is chosen nearest it) */ if (!this.grips[key]) { this._floorK = reg === 'F' ? 1 : 0; try { this.grips[key] = this._close('side', sd, M, pole, reg); } finally { this._floorK = k0; } } return this.grips[key]; };
    if (k0 >= 0.999) return get('F'); if (k0 <= 0.001) return get('L'); const a = get('F').A, b = get('L').A, w = 1 - k0, A = { spread: b.spread }, mix = (x, y) => x.map((v, i) => lerp(v, y[i], w));
    for (const f of ['index', 'middle', 'ring', 'pinky']) A[f] = mix(a[f], b[f]); A.thumb = mix(a.thumb, b.thumb); return { A, meas: b.meas }; }
  // ---- the hand as a person's hand ----------------------------------------------------------------------------------------------------------------------------------------------------
  // The adjacent fingers' angle in the palm plane (deg): the proximal phalanges' axes projected on the palm (the skeleton's, 3-D); [index-middle, middle-ring, ring-pinky, thumb axis to the index axis]
  handAngles(sd) { const F = handFan(this.h, sd); return [...F.fan, F.thumb]; }   // (signed: + = the pair fanned apart; the last: the thumb axis to the index axis)
  // The spreads (rad, HandRig.apply's A.spread) that give the fingers their RESTING adjacent angles { im, mr, rp } (deg) on THIS hand, closed loop on the skeleton: a Newton step on the measured angle
  // (the bind hand's fan is 26 / 1 / 15 deg: an A-pose hand, not a relaxed one). Order: the middle finger is the reference (0), the ring from it, the pinky from the ring, the index from the middle.
  _restSpread(sd, pre, rest) { const R = this.rig[sd], F = ['index', 'middle', 'ring', 'pinky'], base = {}; for (const f of F) base[f] = pre.slice();
    const sp = { index: 0, middle: 0, ring: 0, pinky: 0 }, idx = { index: 0, ring: 1, pinky: 2 }, tgt = { index: rest.im, ring: rest.mr, pinky: rest.rp };
    const meas = f => { R.apply({ ...base, spread: sp, thumb: [0, 0, 0, 0] }); return this.handAngles(sd)[idx[f]]; };
    for (const f of ['ring', 'pinky', 'index']) { let a = meas(f); const dl = 0.05; sp[f] += dl; const a1 = meas(f); sp[f] -= dl; let slope = (a1 - a) / dl; if (Math.abs(slope) < 20) slope = (f === 'pinky' ? -57 : 57);
      for (let it = 0; it < 5; it++) { const e = a - tgt[f]; if (Math.abs(e) < 0.25) break; sp[f] -= e / slope; a = meas(f); } }
    this.rep.rest ||= {}; R.apply({ ...base, spread: sp, thumb: [0, 0, 0, 0] }); this.rep.rest[sd] = this.handAngles(sd).map(x => +x.toFixed(1));
    return { index: sp.index, middle: sp.middle, ring: sp.ring, pinky: sp.pinky }; }
  // Enslaving (finger independence is partial: Zatsiorsky, Li and Latash 1998): a finger that finds no surface does not run to its joint limits; it takes the flexion of its nearest touching neighbour
  // (the cascade of a hand closing on something it cannot reach with every finger). A finger is FREE when it did not touch (skin > 4 mm off the box) and sits within 0.04 rad of a joint limit.
  _enslave(sd, A, sdf, pre, kind) { const R = this.rig[sd], F = ['index', 'middle', 'ring', 'pinky'], LIMS = [1.62, 1.85, 1.25], tol = 0.0004;
    R.apply({ ...R.ang, ...A }); const gap = f => Math.min(...R.set[f].map(ids => R.minD(ids, sdf).d)), touching = {}, free = {};
    for (const f of F) { touching[f] = gap(f) < 0.004; free[f] = !touching[f] && A[f].some((x, k) => x >= LIMS[k] - 0.04); }
    const src = f => { const i = F.indexOf(f); for (let r = 1; r < 4; r++) for (const j of [i - r, i + r]) if (j >= 0 && j < 4 && touching[F[j]] && !free[F[j]]) return F[j]; return null; };
    for (const f of F) if (free[f]) { const s = src(f); if (!s) continue; const th = A[s].slice(); R.apply({ ...R.ang, ...A, [f]: th });
      for (let i = 0; i < 80 && Math.min(...R.set[f].map(ids => R.minD(ids, sdf).d)) < -tol; i++) { for (let k = 0; k < 3; k++) th[k] = Math.max(0, th[k] - 0.02); R.apply({ ...R.ang, ...A, [f]: th }); }
      A[f] = th; (this.rep.enslaved ||= []).push(`${kind}${sd}:${f}<-${s}`); }
    R.apply({ ...R.ang, ...A }); }
  // The thumb at rest: drawn in against the index (the thumb-index web closed: a hand holding something up from below keeps it alongside), clear of the box and of the fingers, and
  // nearest the OTHER regime's thumb when there is one (a thumb that jumps a radian between the floor grip and the lift grip is a snap: the 7d finger blend). cost = penetration + thumb-index angle + distance from the prior
  _thumbRest(sd, A, sdf, T0, kind, tag) { const R = this.rig[sd], H7 = this.W.hand7, h = this.h, key = kind + sd, prior = kind === 'under' ? (this.grips['side' + sd + 'L'] ? this.grips['side' + sd + 'L'].A.thumb : null) : (this._thumbPrior && this._thumbPrior[key] && tag === 'L' ? this._thumbPrior[key] : null); let best = null;
    const okD = H7.thumbClear ?? -0.0004, kA = H7.thumbK ?? 0.05, kP = prior ? 2.0 : 0, ref = prior || T0, sc = h.scale || 1, sub = (a, k) => a.filter((_, i) => i % k === 0), p = V3();
    const thumbS = sub([...R.set.thumb[0], ...R.set.thumb[1], ...R.set.thumb[2]], 3), others = [];
    for (const f of ['index', 'middle', 'ring', 'pinky']) for (const k of [0, 1, 2]) others.push(...sub(R.set[f][k], 6)); others.push(...sub(R.set.palm, 5));
    R.apply({ ...R.ang, ...A, thumb: [0, 0, 0, 0] }); const bindT = thumbS.map(v => R.skinPt(v, V3())), O0 = others.map(v => R.skinPt(v, V3())), skip = bindT.map(t => O0.some(o => o.distanceTo(t) < 0.009 * sc));   // (thumb skin that starts next to the palm's web is not a collision)
    for (let a = -1.4; a <= 0.61; a += 0.2) for (let b = -0.9; b <= 0.71; b += 0.2) for (const c2 of [0.08, 0.45, 0.9]) { const T = [a, b, c2, c2 * 0.75]; R.apply({ ...R.ang, ...A, thumb: T });
      let d = Infinity; for (const ids of R.set.thumb) d = Math.min(d, R.minD(ids, sdf).d); if (d < okD) continue;
      const O = others.map(v => R.skinPt(v, V3())); let pen = 0; thumbS.forEach((v, i) => { if (skip[i]) return; R.skinPt(v, p); for (const o of O) { const dd = p.distanceTo(o); if (dd < 0.007 * sc) pen = Math.max(pen, 0.007 * sc - dd); } }); if (pen > 0.001) continue;
      const cost = kA * this.handAngles(sd)[3] + kP * Math.hypot(a - ref[0], b - ref[1], 0.6 * (c2 - (ref[2] ?? 0.08))) + (prior ? 0 : 0.3 * Math.hypot(a - T0[0], b - T0[1]));
      if (!best || cost < best.cost) best = { cost, T, d: Math.min(0.002, d) }; }
    if (best && tag === 'F') (this._thumbPrior ||= {})[key] = best.T;
    return best; }
  _close(kind, sd, M, pole, tag = '') { const key = kind + sd + tag; if (this.grips[key]) return this.grips[key]; const R = this.rig[sd], B = this.box, h = this.h;
    if (kind === 'under' && !this.grips['side' + sd + 'L']) { const sg0 = sd === 'L' ? 1 : -1, PS = this.W.poleSide; this._closeS(sd, M, hp0(this, V3(sg0 * (PS ? PS[0] : 0.8), PS ? PS[1] : -0.5, PS ? PS[2] : -0.5).normalize())); }   // (the side grips first: the under grip's thumb is chosen nearest the side grip's)
    // at the grip's own placement (the arm put there, then put back): the angles hold wherever the box goes (the hand rides in its frame)
    const snap = R.snap(), fsnap = R.handBoneList().map(([b]) => b ? b.quaternion.clone() : null);
    this._reach(sd, this._gripWorld(kind, sd, M), pole); R.refresh();
    const sdf = sdfBox(M, V3(B.w / 2, B.h / 2, B.d / 2), 0.004);
    const pre = kind === 'side' ? [0.3, 0.35, 0.15] : [0.08, 0.12, 0.05], H7 = this.W.hand7, A = { spread: { index: -0.04, ring: 0.03, pinky: 0.07 } };
    try { A.spread = this._restSpread(sd, pre, H7.rest); } catch (e) { this.rep.errHand = 'rest ' + String((e && e.message) || e).slice(0, 120); }   // the fingers' spread solved closed-loop to the hand's resting adjacent angles, not the bind's fan
    for (const f of ['index', 'middle', 'ring', 'pinky']) A[f] = R.closeFinger(f, sdf, { pre, spread: A.spread[f] || 0, step: 0.03 });
    try { this._enslave(sd, A, sdf, pre, kind); } catch (e) { this.rep.errHand = 'enslave ' + String((e && e.message) || e).slice(0, 120); }   // a finger that found no surface follows its touching neighbour, it does not run to its joint limits
    // the thumb: along the box's side (side grip: against the face beside the fingers; under: along the side face from below), opened until clear
    // the thumb: a small search over its two base angles for the pose nearest the preset that keeps it (and the thenar) out of the box
    const T0 = kind === 'side' ? [-0.25, -0.15, 0.1, 0.1] : [-0.55, -0.3, 0.12, 0.08], dT = () => Math.min(...R.set.thumb.map(ids => R.minD(ids, sdf).d), R.minD(R.set.palm, sdf).d);
    let best = null;
    try { best = this._thumbRest(sd, A, sdf, T0, kind, tag); } catch (e) { this.rep.errHand = 'thumb ' + String((e && e.message) || e).slice(0, 120); best = null; }   // the thumb drawn in against the index (the hand's rest), nearest the other regime's thumb, clear of the box
    if (!best) for (let a = -1.4; a <= 0.61; a += 0.25) for (let b = -0.9; b <= 0.61; b += 0.25) { const T = [a, b, 0.08, 0.06]; R.apply({ ...R.ang, ...A, thumb: T }); const d = Math.min(0.002, dT()), cost = -d * 1000 * 10 + Math.hypot(a - T0[0], b - T0[1]);
      if (!best || cost < best.cost) best = { cost, T, d }; }
    A.thumb = best.T; R.apply({ ...R.ang, ...A });
    const meas = {}; for (const f of ['index', 'middle', 'ring', 'pinky', 'thumb']) meas[f] = +(Math.min(...R.set[f].map(ids => R.minD(ids, sdf).d)) * 1000).toFixed(1);
    meas.palm = +(sdf.d(h.palm(sd).palm) * 1000).toFixed(1);
    R.restore(snap); R.handBoneList().forEach(([b], i) => { if (b && fsnap[i]) b.quaternion.copy(fsnap[i]); }); h.update();
    return (this.grips[key] = { A, meas }); }
  // the box held where the hands can hold it: a grip out of the arm's reach brings the box (local Bc) toward the shoulders
  _reachable(Bc, byaw, kind) { const h = this.h, hp = this.hp, sx = hp.sx, mid = hp.local(h.joint('upperarm01.L').add(h.joint('upperarm01.R')).multiplyScalar(0.5));
    for (let it = 0; it < 4; it++) { const BW = hp.world(Bc.clone()); BW.y = Bc.y; const M = boxM(BW, h.group.rotation.y + byaw); let worst = 0;
      for (const sd of ['L', 'R']) { const G = this._gripWorld(kind, sd, M), sh = h.joint(`upperarm01.${sd}`), q = handQW(h, sd, G.f, G.n), wr = wristForW(h, sd, G.p, q); worst = Math.max(worst, sh.distanceTo(wr) - hp.armLen * 0.975); }
      if (worst <= 0.002) break; const d = mid.clone().sub(Bc); d.y *= 0.6; const L = d.length(); if (L < 1e-6) break; Bc.addScaledVector(d, Math.min(1, (worst + 0.004) / L)); }
    return Bc; }
  _applyFingers(sd, A, w = 1) { const R = this.rig[sd]; if (w >= 0.999) { R.apply(A); return; }
    // (the thumb is solved clear of the box at its OWN pose: scaled to 35 % it passes through the carton)
    const B = {}; for (const f of ['index', 'middle', 'ring', 'pinky']) B[f] = A[f].map(x => x * w); B.spread = A.spread; B.thumb = A.thumb.slice(); R.apply(B); }
  // contact ruler: the fingertip segments' and the palm's skin to the box (mm; < 0 inside)
  contact(M) { const B = this.box, sdf = sdfBox(M, V3(B.w / 2, B.h / 2, B.d / 2), 0.004), out = {};
    for (const sd of ['L', 'R']) { const R = this.rig[sd]; R.refresh(); const tips = ['index', 'middle', 'ring', 'pinky'].map(f => R.minD(R.set[f][2], sdf).d * 1000), palm = sdf.d(this.h.palm(sd).palm) * 1000;
      let pen = Infinity; for (const k of Object.keys(R.set)) { const L = k === 'palm' ? [R.set.palm] : R.set[k]; for (const ids of L) pen = Math.min(pen, R.minD(ids, sdf).d * 1000); }
      out[sd] = { tipMin: +Math.min(...tips).toFixed(1), tipMax: +Math.max(...tips).toFixed(1), palm: +palm.toFixed(1), deepest: +pen.toFixed(1) }; }
    return out; }
  frame(t) {
    const h = this.h, hp = this.hp, c = this.life.sample(t), sx = hp.sx; resetScales(h);
    let g = { x: this.at[0], z: this.at[1], yaw: this.yaw }, phase, Bc, byaw = 0, eff = 0, grip = 'side', gw = 0, regrip = 0;
    const tR1 = Math.min(3.45, this.tStep0 - 0.04), tR0 = tR1 - 0.42;   // the re-grip finishes BEFORE the first step
    if (t < this.tStep0) {   // the lift, in place, and the re-grip at the belly
      this._setGroup(g.x, g.z, g.yaw); const K = this.keys(t), legLen = hp.legLen;
      phase = t < 1.25 ? 'reach' : t < 1.85 ? 'grasp' : t < tR0 ? 'lift' : t < tR1 ? 'regrip' : 'hold';
      let pz = hp.hip0.z + K.back * sx; const bz = lerp(this.z0, hp.hip0.z + 0.25 * sx, Math.max(smoother(K.hold), 0.7 * ease(1.85, 2.4, t)));
      Bc = V3(0, K.by, bz); if (K.hold > 0) Bc.y = lerp(this.box.h / 2 + 0.025, hp.hip0.y + 0.065 * sx + this.box.h / 2 + this.W.boxUp * sx * K.hold, smoother(Math.min(1, (K.by - this.box.h / 2) / (1 - this.box.h / 2))));
      // the re-grip: the box settles 1 cm onto the hands as they come under it, and comes in against the belly
      regrip = ease(tR0, tR1, t); Bc.y -= 0.01 * regrip; Bc.z -= 0.015 * sx * regrip;
      const load = K.on > 0.99 && K.by > this.box.h / 2 + 0.01 ? { kg: this.kg, p: null } : null;
      for (let it = 0; it < 3; it++) {
        hp.solve({ pelvis: { p: V3(0, hp.hip0.y - K.drop * legLen, pz), pitch: K.flex * 0.55 }, spine: { flex: K.flex * 0.45 + 0.012 * c.breath - 0.05 * regrip }, head: { pitch: K.head - K.flex * 0.5 },
          feet: [{ p: V3(this.hx, 0, hp.ank0.L.z - 0.03 * sx), yaw: this.toe, kneeOut: 0.15 + 0.7 * clamp(K.drop / 0.3) }, { p: V3(-this.hx, 0, hp.ank0.R.z - 0.01 * sx), yaw: -this.toe, kneeOut: 0.15 + 0.7 * clamp(K.drop / 0.3) }] });
        if (load) load.p = hp.world(Bc.clone());
        const e = hp.balanceErr({ load }); if (Math.abs(e.err.z) < 0.004) break; pz -= e.err.z * 0.85; }
      // on the floor the box cannot come to the hands: a grasp out of reach takes more hip and trunk flexion (and knee) until it is in reach
      if (K.on > 0.5 && K.by < this.box.h / 2 + 0.03) { for (let k = 0; k < 6; k++) { const BW = hp.world(Bc.clone()); BW.y = Bc.y; const M0 = boxM(BW, g.yaw); let worst = 0;
          for (const sd of ['L', 'R']) { const G = this._gripWorld('side', sd, M0), q = handQW(h, sd, G.f, G.n), wr = wristForW(h, sd, G.p, q); worst = Math.max(worst, h.joint(`upperarm01.${sd}`).distanceTo(wr) - hp.armLen * 0.975); }
          if (worst <= 0.003) break; const dk = Math.min(0.12, worst * 1.6) * K.on;
          K.flex += dk; K.drop += dk * 0.25; pz -= dk * 0.08 * sx;
          hp.solve({ pelvis: { p: V3(0, hp.hip0.y - K.drop * legLen, pz), pitch: K.flex * 0.55 }, spine: { flex: K.flex * 0.45 + 0.012 * c.breath }, head: { pitch: K.head - K.flex * 0.5 },
            feet: [{ p: V3(this.hx, 0, hp.ank0.L.z - 0.03 * sx), yaw: this.toe, kneeOut: 0.15 + 0.7 * clamp(K.drop / 0.3) }, { p: V3(-this.hx, 0, hp.ank0.R.z - 0.01 * sx), yaw: -this.toe, kneeOut: 0.15 + 0.7 * clamp(K.drop / 0.3) }] }); } }
      else if (K.on > 0.99) this._reachable(Bc, 0, regrip > 0.5 ? 'under' : 'side');
      for (const sd of ['L', 'R']) hp.hang(sd, { out: 0.12, back: 0.0, elbow: 0.25, palm: 'in', relax: 0.9 });
      gw = clamp((K.by - this.box.h / 2) / 0.02);   // the fingers close under the edge as the box leaves the floor
      this._floorK = 1 - smoother(clamp((K.by - this.box.h / 2) / 0.1));   // 1 while the box is on the floor, 0 once it is well off it: the side grip's frame follows
      grip = regrip > 0.5 ? 'under' : 'side'; eff = K.on;
      this.rep.miss = this._hands(Bc, 0, K.on, gw, regrip);
    } else {               // the first step from standing, the carry (short wide steps, the box on the hands at the belly riding with the chest, a lean back), the stop
      const Ls = this.G.step, fw = V3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), D0 = Ls / 2 - 0.03 * sx, legLen = hp.legLen;
      const dAt = tt => tt < this.tCarry ? herm2(0, 0, D0, this.v, this.Dstep, tt - this.tStep0) : D0 + this.v * (Math.min(tt, this.tStop) - this.tCarry);
      const d = dAt(t); g = { x: this.at[0] + fw.x * d, z: this.at[1] + fw.z * d, yaw: this.yaw }; this._setGroup(g.x, g.z, g.yaw);
      let lean = 1;
      if (t < this.tCarry) {   // the first step: the left foot stays (its heel rising about the MTP line), the right steps to its heel strike
        phase = 'step'; const u = clamp((t - this.tStep0) / this.Dstep), e = smoother(u), S0 = this._stepState();
        const zL = S0.L.z - d, pL = S0.pitchL * Math.pow(sstep(0.3, 1, u), 1.35), AL = footRoll(hp, zL - hp.ank0.L.z, pL);
        const zR = lerp(S0.R.z, S0.Rend + D0, smoother((u - 0.12) / 0.78)) - d, pR = S0.pitchR * sstep(0.3, 0.9, u);
        const ARp = footRoll(hp, zR - hp.ank0.R.z, pR), liftR = 0.045 * sx * Math.pow(Math.sin(Math.PI * u), 1.2);
        const fL = { p: V3(this.hx, 0, AL.z + hp.ank0.L.z), yaw: this.toe, pitch: pL, lift: AL.y - hp.ank0.L.y - (pL ? 0.06 * Math.sin(Math.abs(pL)) : 0), toe: 1 };
        const fR = { p: V3(-this.hx, 0, ARp.z + hp.ank0.R.z), yaw: -this.toe, pitch: pR, lift: ARp.y - hp.ank0.R.y - (pR ? 0.06 * Math.sin(Math.abs(pR)) : 0) + liftR };
        const P0 = S0.pel0, P1 = S0.pel1, pe = V3().lerpVectors(P0.p, P1.p, e); pe.z -= d;
        hp.solve({ pelvis: { p: pe, yaw: lerp(0, P1.yaw, e), pitch: lerp(P0.pitch, P1.pitch, e), roll: lerp(0, P1.roll, e) }, spine: { flex: lerp(-0.06, 0.035, e) }, feet: [fL, fR] });
        lean = e;
      } else if (t < this.tStop) { phase = 'carry'; gait6(hp, t - this.tCarry, { phase: 0.5, terms: this.G, v: this.v, seed: this.seed, armK: 0, lr: this.W.lr, pitch: this._pitch(), flex: this.W.spineFlex }); }
      else {                   // the stop: the right foot comes down beside the planted left, the hips run on and settle over the feet
        phase = 'stop'; const S = this._carryStop(), tau = t - this.tStop, u = clamp(tau / 0.36), e = smoother(u);
        const land = V3(S.ankL.x - 2 * this.hx, 0, S.ankL.z + 0.01);
        const fR = { p: V3(lerp(S.ankR.x, land.x, e), 0, lerp(S.ankR.z, land.z, e)), yaw: -this.toe, lift: Math.max(0, S.Rlift * (1 - e) + 0.025 * Math.sin(Math.PI * u) * (1 - u)) };
        const fL = { p: S.ankL.clone(), yaw: this.toe, lock: 0.4 };
        const midX = (S.ankL.x + land.x) / 2, midZ = (S.ankL.z + land.z) / 2 + hp.hip0.z - hp.ank0.L.z;
        const pz = herm(S.hips.z, this.v, midZ, this.Dstop, tau) + 0.012 * sx * settle(tau - 0.25, 1.1, 0.5), px = herm(S.hips.x, 0, midX, this.Dstop * 0.8, tau);
        const py = lerp(S.hips.y, hp._hipY(this.hx, 0) - 0.012 * sx, ease(0, this.Dstop, tau));
        hp.solve({ pelvis: { p: V3(px, py, pz), pitch: this.W.balance ? this._pitch() : this.W.stopPitch * (1 - ease(this.W.stopHold || 0, this.Dstop + (this.W.stopHold || 0), tau)) }, spine: { flex: 0.03 * (1 - ease(0, this.Dstop, tau)) + 0.03 * settle(tau - 0.15, 1.0, 0.45) }, feet: [fL, fR] }); }
      // the lean back against the load (the trunk's extension), then the box in the chest's frame (from the lift's hold over the first step)
      const lam = this._lam(); this._leanBones(lean * lam);
      const BX = this._boxCentre(lean); Bc = BX.Bc;
      if (this.W.bob && phase === 'carry') { const pc = (((t - this.tCarry) / this.T + 0.5) % 1 + 1) % 1; Bc.y += this.W.bob * sx * Math.sin(TAU * 2 * pc - 1.0) * smoother((t - this.tCarry) / 0.5) * (1 - smoother((t - (this.tStop - 0.4)) / 0.4)); }   // the box's weight on the arms at each step
      byaw = BX.byaw; grip = 'under'; gw = 1; regrip = 1; eff = 0.7; this._reachable(Bc, byaw, 'under');
      this.rep.miss = this._hands(Bc, byaw, 1, 1, 1);
      lookHead(h, 0.03 * noise1(t * 0.6, this.seed), 0.06 + this.W.headDown * lean * lam);
    }
    if (this._post7) this._post7(t, phase, c, eff);
    blinkLids(h, this.life.rig, c.blink);
    breathe(h, c.breath * (0.7 + 0.6 * eff), { belly: 0.022, chest: 0.014 }); h.update();
    const BW = hp.world(Bc.clone()); BW.y = Bc.y;
    const M = boxM(BW, g.yaw + byaw);
    const out = { g: [g.x, g.z, g.yaw], phase, grip, c: { eyeYaw: c.eyeYaw * 0.3, eyePitch: c.eyePitch * 0.3 - (phase === 'reach' || phase === 'grasp' ? 0.25 : 0), smile: Math.min(0.1, c.smile * 0.5), blink: c.blink, breath: c.breath,
      boxX: BW.x, boxY: BW.y, boxZ: BW.z, boxYaw: g.yaw + byaw } };
    if (this._chan7) Object.assign(out.c, this._chan7(t, phase, c));
    out.toe = hp.toeHeights(); out.M = M;
    return out;
  }
  // both hands: reach (on < 1), the side grip low on the box (the fingers closing under its edge by gw), the re-grip from below (rg)
  _hands(Bc, byaw, on, gw, rg0) { const h = this.h, hp = this.hp, miss = {}; const BW = hp.world(Bc.clone()); BW.y = Bc.y; const M = boxM(BW, h.group.rotation.y + byaw);
    const RH = this.W.hand7.rest;   // a relaxed hand rests at its resting fan, not the bind's
    for (const sd of ['L', 'R']) { if (on <= 0.01) { restHand7(h, sd, RH); continue; } const sg = sd === 'L' ? 1 : -1; let rg = rg0;
      const poleSide = hp.dirW(V3(sg * (this.W.poleSide ? this.W.poleSide[0] : 0.8), this.W.poleSide ? this.W.poleSide[1] : -0.5, this.W.poleSide ? this.W.poleSide[2] : -0.5).normalize()), poleUnder = hp.dirW(V3(sg * this.W.pole[0], this.W.pole[1], this.W.pole[2]).normalize());
      const Gs = this._gripWorld('side', sd, M), Gu = this._gripWorld('under', sd, M);
      // the approach: from the hanging hand to a point beside the box (out and up from the grip), then in onto the grip (never through the box)
      if (on < 0.999) { const q = Qt().setFromRotationMatrix(M), ap = Gs.p.clone().add(V3(sg * 0.09, 0.06, 0).applyQuaternion(q)), hang = h.joint(`wrist.${sd}`);
        if (on < 0.7) { const qa = handQW(h, sd, Gs.f, Gs.n), wa = wristForW(h, sd, ap, qa); miss[sd] = hp.arm(sd, hang.clone().lerp(wa, smoother(on / 0.7)), null, poleSide) * 1000; h.relaxHand(sd, 0.4, { cascade: true }); restHand7(h, sd, RH);
          continue; }
        const e = smoother((on - 0.7) / 0.3), G = { p: ap.clone().lerp(Gs.p, e), f: Gs.f, n: Gs.n }; miss[sd] = this._reach(sd, G, poleSide); h.relaxHand(sd, 0.4 * (1 - e), { cascade: true }); restHand7(h, sd, RH);
        const gr = this._closeS(sd, M, poleSide);
        { const R = this.rig[sd], HB = R.handBoneList(), L0 = HB.map(([b]) => b ? b.quaternion.clone() : null);   // the fingers leave the hanging hand's relaxed curl and OPEN INTO the grip (writing the flat rest pose over it at on = 0.7 was 56 deg a frame at 0.97 s)
          this._applyFingers(sd, gr.A, 0.35 * e); HB.forEach(([b], i) => { if (b && L0[i]) b.quaternion.slerp(L0[i], 1 - e); }); h.update(); continue; } }
      // the hands re-grip ONE AFTER THE OTHER (W.regripStag in 0..0.6: the left leaves first and is under the box when the right leaves): the box is never left with both hands off it
      let rgs = rg; if (this.W.regripStag > 0 && rg > 0.001 && rg < 0.999) { let lo = 0, hi = 1; for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (smoother(m) < rg) lo = m; else hi = m; }
        const u0 = (lo + hi) / 2, stg = this.W.regripStag; rgs = smoother(clamp((u0 - (sd === 'L' ? 0 : stg)) / (1 - stg))); } rg = rgs;
      if (rg <= 0.001 || rg >= 0.999) { const G = rg >= 0.999 ? Gu : Gs, pole = rg >= 0.999 ? poleUnder : poleSide; miss[sd] = this._reach(sd, G, pole);
        const gr = rg >= 0.999 ? this._close('under', sd, M, pole) : this._closeS(sd, M, pole); this._applyFingers(sd, gr.A, rg >= 0.999 ? 1 : 0.35 + 0.65 * gw); continue; }
      // the re-grip: the hand leaves the side (opening), passes below the box's edge, comes under it palm up (the box rests on the body)
      const e = smoother(rg), p = Gs.p.clone().lerp(Gu.p, e);
      {   // a path in the BOX's frame that never crosses its side face: out and down beside it (to 5 cm out, 4.5 cm below the bottom), in under the bottom, up onto the grip
        let lo = 0, hi = 1; for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (smoother(m) < rg) lo = m; else hi = m; }   // (rg is already eased: the path runs on the time fraction u)
        const u = (lo + hi) / 2, B = this.box, s = hp.sx, lg = this._gripLocal('side', sd), lu = this._gripLocal('under', sd);
        const P1 = V3(sg * (B.w / 2 + 0.05 * s), -B.h / 2 - 0.045 * s, lg.p.z), P2 = V3(lu.p.x, -B.h / 2 - 0.045 * s, lu.p.z);
        p.copy(lg.p).lerp(P1, ease(0, 0.45, u)).lerp(P2, ease(0.35, 0.8, u)).lerp(lu.p, ease(0.75, 1, u)).applyMatrix4(M); }
      const f = Gs.f.clone().lerp(Gu.f, e).normalize(), n = Gs.n.clone().lerp(Gu.n, e).normalize(), pole = poleSide.clone().lerp(poleUnder, e).normalize();
      miss[sd] = this._reach(sd, { p, f, n }, pole);
      const A0 = this._closeS(sd, M, poleSide).A, A1 = this._close('under', sd, M, poleUnder).A, open = Math.sin(Math.PI * e), A = { spread: A1.spread };
      for (const fn of ['index', 'middle', 'ring', 'pinky']) A[fn] = A0[fn].map((x, i) => lerp(x, A1[fn][i], e) * (1 - 0.7 * open)); A.thumb = A0.thumb.map((x, i) => lerp(x, A1.thumb[i], e));
      this.rig[sd].apply(A); }
    h.update(); return miss; }
}

// ---------------------------------------------------------------- WAVE: the constructor (the weight's target, the timing); the frame is Wave7's (act7.js)
export class Wave6 {
  constructor(P, { seed = null, side = 'R', t0 = 0.9, n = 3, hz = 1.8, smile = 0.22 } = {}) {
    this.P = P; this.h = P.h; this.seed = seed ?? seedOf(P.info?.name || 'v'); this.side = side; this.t0 = t0; this.n = n; this.hz = hz; this.smileTop = smile;
    this.L = new Life(P.h, { seed: this.seed, rec: P.pose || {}, person: P.p, kin: !!P.h.meta?.kin, look: 0.3 }).capture(); this.hp = new HeroPoser6(P.h, { kin: !!P.h.meta?.kin, person: P.p });
    this.L.apply(0); this.tShift = t0 - 0.45; this.tUp = t0 + 0.6; this.tDown = this.tUp + n / hz; this.tEnd = this.tDown + 0.75;
    this.armBones = P.h.bones.filter(B => new RegExp(`^(clavicle|shoulder01|upperarm0|lowerarm0|wrist|finger|metacarpal).*\\.${side}$`).test(B.name));
    // the weight goes onto the leg AWAY from the waving arm: Life's weight channel (0 = the stance's standing leg, 1 = the free one)
    const st = this.L.stand; this.wTarget = st === side ? 0.95 : -0.35;
    this.rep = { act: 'Wave6', side, standing: st, onto: st === side ? this.L.free : st };
  }
  // (the act's frame is Wave7's: act7.js)
}

// ---------------------------------------------------------------- the idle on a DRESSED stance (the bake's own: folded, clasp, pocket, hip)
// Life on the stance; a hand in a pocket or on the hip is kept where it rests on the PELVIS through the weight shifts (two-bone IK to its
// captured place in the pelvis' frame; the wrist keeps its orientation there): the hand stays in the pocket as the hips move
export class Dress6 {
  constructor(P, { seed = null } = {}) { this.P = P; const h = this.h = P.h; this.rec = P.pose || {};
    this.L = new Life(h, { seed: seed ?? seedOf(P.info?.name || 'i'), rec: this.rec, person: P.p, kin: !!h.meta?.kin }).capture();
    this.hold = {}; h.update();
    const sides = this.rec.arms === 'pocket' || this.rec.arms === 'hip' ? [this.rec.armSide] : [];
    const R = h.bone('root'), rq = Qt(); R.getWorldQuaternion(rq); const rp = h.joint('root'), rqi = rq.clone().invert();
    for (const sd of sides) { const W = h.joint(`wrist.${sd}`), wq = Qt(); h.bone(`wrist.${sd}`).getWorldQuaternion(wq);
      this.hold[sd] = { p: W.sub(rp).applyQuaternion(rqi), q: rqi.clone().multiply(wq), pole: h.joint(`lowerarm01.${sd}`).sub(h.joint(`upperarm01.${sd}`).lerp(h.joint(`wrist.${sd}`), 0.5)).applyQuaternion(rqi) }; }
    this.hp = Object.keys(this.hold).length ? new HeroPoser6(h, { kin: !!h.meta?.kin, person: P.p }) : null;
    if (this.hp) this.L.apply(0);
    this.rep = { act: 'Dress6', arms: this.rec.arms, armSide: this.rec.armSide || null };
  }
  frame(t) { const h = this.h, c = this.L.apply(t), miss = {};
    if (this.hp) { const R = h.bone('root'), rq = Qt(); R.getWorldQuaternion(rq); const rp = h.joint('root');
      for (const [sd, H] of Object.entries(this.hold)) { const p = H.p.clone().applyQuaternion(rq).add(rp), q = rq.clone().multiply(H.q), pole = H.pole.clone().applyQuaternion(rq);
        const fq = []; for (let n = 1; n <= 5; n++) for (let k = 1; k <= 3; k++) { const B = h.bone(`finger${n}-${k}.${sd}`); if (B) fq.push([B, B.quaternion.clone()]); }
        miss[sd] = +(this.hp.arm(sd, p, q, pole, { carry: false }) * 1000).toFixed(1); fq.forEach(([B, qq]) => B.quaternion.copy(qq)); }
      h.update(); }
    return { g: [h.group.position.x, h.group.position.z, h.group.rotation.y], phase: 'idle', miss, c: { eyeYaw: c.eyeYaw, eyePitch: c.eyePitch, smile: c.smile, blink: c.blink, breath: c.breath, weight: c.weight } }; }
}

// ---------------------------------------------------------------- the MOTION clips' casting (plain data: act7.js's CLIPS7 builds on it)
// per clip: who (the casting: women half overall, each act by a woman and by a man), the stage, the length, the place of each act. The garment bakes are NOT named here: a clip's people are the CURRENT person (makePerson's
// own chain of bakes); only the row's dressed arm poses keep a name (`bake`, read by person/build.js: the dressed pose's stance record and its re-finish v8c/dress7).
const DRESS = 'motion6/dress7';
export const CLIPS6 = {
  // the row idling, every arm pose of POSE's (folded, clasped, a pocket, a hip) on women and men
  row6: { act: 'dress', dur: 6, gap: 0.8, stage: 'yard@5', fps: 15,
    who: ['L08_f24_hispanic', 'L22_f27_black', 'L20_f29_asian', 'L12_f39_white', 'L14_f42_black', 'L06_f53_white', 'L21_m32_black', 'L11_m23_white', 'L17_m28_hispanic', 'L03_m38_asian', 'L23_m45_white', 'L05_m59_black'],
    bake: { L08_f24_hispanic: DRESS, L22_f27_black: DRESS, L20_f29_asian: DRESS, L14_f42_black: DRESS, L21_m32_black: DRESS, L17_m28_hispanic: DRESS, L05_m59_black: DRESS },
    arms: { L08_f24_hispanic: 'pocket', L22_f27_black: 'clasp', L20_f29_asian: 'folded', L14_f42_black: 'folded', L21_m32_black: 'pocket', L17_m28_hispanic: 'folded', L05_m59_black: 'clasp' } },
  // the walk and turn of two people (MOTION c1's pair)
  walk6: { act: 'walkturn', who: ['L08_f24_hispanic', 'L21_m32_black'], dur: 7.0, stage: 'studio@5', fps: 30,
    place: { L08_f24_hispanic: { from: [-2.5, 0.5], dist: 2.3, speedK: 0.88, start: 0.35 }, L21_m32_black: { from: [-2.95, -0.6], dist: 3.1, speedK: 0.9, start: 0.6 } } },
  // the lift and carry: a woman (MOTION c1's L22) and a man side by side
  lift6: { act: 'lift', who: ['L22_f27_black', 'L17_m28_hispanic'], dur: 7.0, stage: 'yard@5', fps: 15,
    place: { L22_f27_black: { at: [-2.2, 0.45], yaw: Math.PI / 2 }, L17_m28_hispanic: { at: [-0.55, -0.45], yaw: Math.PI / 2 } } },
  // the wave: a woman and a man (MOTION c1's L03) side by side
  wave6: { act: 'wave', who: ['L14_f42_black', 'L03_m38_asian'], dur: 4.8, stage: 'yard@5', fps: 15,
    place: { L14_f42_black: { side: 'R', x: -0.55 }, L03_m38_asian: { side: 'R', x: 0.55, t0: 1.05 } } },
};
