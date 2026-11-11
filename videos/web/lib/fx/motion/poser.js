// MOTION / POSER (MOTION studio, cycle 1): a people.js body built from intents, not from Euler numbers.
// The acts in this folder say what a body is DOING (where the pelvis is and how it is tipped, how the spine bends, where each
// foot is on the ground and how it rolls, where each hand grips); the poser turns that into people.js's per-bone Euler array
// (Pz) with two-bone IK on the legs and the arms, and measures what it could not do (reach misses, the centre of mass against
// the support). Nothing slides because a planted foot is a world point the caller keeps fixed: the IK puts the sole there.
//
//   const P = new Poser();                                      // one per People (it holds scratch state only)
//   P.begin(Pz, st)                                             // zero the pose, take the figure's body proportions (st._SC)
//   P.solve(Pz, spec, frame)                                    // spec below; frame = { pos: Vector3, heading, sc } (the figure's instance)
//   -> rep = { feet: [{ missMm }], hands: [{ missMm }], com (local), comW (world), support[], comOutMm, joints (world) }
//
// spec (LOCAL figure frame: metres before the figure's scale, x = the figure's left, y up, z forward; `w2l` converts world points):
//   pelvis: { p: Vector3 (the hips joint), yaw, pitch (+ forward), roll (+ dips the left hip) }
//   spine:  { flex (+ forward), bend (+ toward the left), twist (+ turns the chest to the left), share: [spine, chest] }
//   head:   { pitch (+ down), yaw (+ left), roll }   (added on neck 40 % / head 60 %)
//   feet:   [L, R] { p: Vector3 (the sole point `pivot` sits on), yaw, pitch (+ toe up), pivot: 'H' | 'T' | 'M' }
//   hands:  [L, R] { p: Vector3 (the palm's grip point), roll (about the forearm), curl, pole: Vector3 (elbow hint, local) } | null
//   arms:   [L, R] free-arm Euler sets applied before IK when the hand has no target: { ua: [x,y,z], fa: [x,y,z], hn: [x,y,z], curl }
import * as THREE from 'three';
import { PeopleRig } from '../rig/people_rig.js';
import { twoBone } from '../rig/ik.js';
import { com as comOf, supportPolygon, insideDist } from '../rig/balance.js';
import { PEOPLE_SKEL } from '../people.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), Q = () => new THREE.Quaternion();
const UP = V3(0, 1, 0), X = V3(1, 0, 0), Z = V3(0, 0, 1);
const NB = 21;
export const BONES = { hips: 0, spine: 1, chest: 2, neck: 3, head: 4, uaL: 5, faL: 6, hnL: 7, fgL: 8, uaR: 9, faR: 10, hnR: 11, fgR: 12, thL: 13, shL: 14, ftL: 15, thR: 16, shR: 17, ftR: 18 };
const LEG = [[13, 14, 15], [16, 17, 18]], ARM = [[5, 6, 7, 8, 19], [9, 10, 11, 12, 20]];
export const FOOT = { H: V3(0, -0.083, -0.07), T: V3(0, -0.083, 0.19), M: V3(0, -0.083, 0.06) };   // sole points in the foot bone's frame (people.js FOOTPTS)
const GRIP = V3(0, -0.045, 0.02);                                                                 // the palm's grip point in the finger bone's frame

export class Poser {
  constructor() {
    this.rig = new PeopleRig(PEOPLE_SKEL); this.F = null; this.SC = null;
    this._e = new THREE.Euler(); this._q = Q(); this._q2 = Q();
  }
  // the figure's body (people.js d.body proportions) and a clean pose
  begin(Pz, st = null) { Pz.fill(0); this.SC = st && st._SC ? st._SC : null; this.rig.setBody(this.SC); return Pz; }
  // hips joint height when standing straight (local metres), the leg length, the foot length
  dims() { const r = this.rig, J = r.J, sy = b => (this.SC ? this.SC[b * 3 + 1] : 1);
    // the hips joint over a straight leg: thigh joint 0.04 under the hips (scaled with the torso), ankle 0.085 over the sole
    return { hip: 0.04 * sy(0) + r.len.thigh + r.len.shin + 0.083 * sy(15), leg: r.len.thigh + r.len.shin, thigh: r.len.thigh, shin: r.len.shin, ua: r.len.ua, fa: r.len.fa, foot: 0.26 * sy(15), ankle: 0.085, shoulderH: J[5].y, shW: J[5].x - J[9].x, hipW: J[13].x - J[16].x }; }
  // world <-> local for a figure instance
  static frame(pos, heading, sc) { const q = Q().setFromAxisAngle(UP, heading); return { pos: pos.clone(), heading, sc, q, qi: q.clone().invert() }; }
  static w2l(fr, w, o = V3()) { return o.copy(w).sub(fr.pos).multiplyScalar(1 / fr.sc).applyQuaternion(fr.qi); }
  static l2w(fr, l, o = V3()) { return o.copy(l).multiplyScalar(fr.sc).applyQuaternion(fr.q).add(fr.pos); }
  static d2l(fr, d, o = V3()) { return o.copy(d).applyQuaternion(fr.qi); }

  _setE(Pz, b, x, y, z) { Pz[b * 3] = x; Pz[b * 3 + 1] = y; Pz[b * 3 + 2] = z; }
  _local(Pz, b) { this._e.set(Pz[b * 3], Pz[b * 3 + 1], Pz[b * 3 + 2], 'XYZ'); return Q().setFromEuler(this._e); }
  _fk(Pz) { return (this.F = this.rig.fk(Pz, [1, 1], this.F)); }

  solve(Pz, S, fr = null) {
    const r = this.rig, rep = { feet: [], hands: [], joints: {} };
    // ---- trunk: pelvis, spine, chest, neck, head
    const pv = S.pelvis || {};
    { const q = Q().setFromAxisAngle(UP, pv.yaw || 0).multiply(Q().setFromAxisAngle(X, pv.pitch || 0)).multiply(Q().setFromAxisAngle(Z, -(pv.roll || 0)));
      this._e.setFromQuaternion(q, 'XYZ'); this._setE(Pz, 0, this._e.x, this._e.y, this._e.z);
      const p = pv.p || r.J[0]; Pz[NB * 3] = p.x - r.J[0].x; Pz[NB * 3 + 1] = p.y - r.J[0].y; Pz[NB * 3 + 2] = p.z - r.J[0].z; }
    const sp = S.spine || {}, sh = sp.share || [0.45, 0.55];
    for (const [b, k] of [[1, sh[0]], [2, sh[1]]]) { const q = Q().setFromAxisAngle(UP, (sp.twist || 0) * k).multiply(Q().setFromAxisAngle(X, (sp.flex || 0) * k)).multiply(Q().setFromAxisAngle(Z, -(sp.bend || 0) * k));
      this._e.setFromQuaternion(q, 'XYZ'); this._setE(Pz, b, this._e.x, this._e.y, this._e.z); }
    const hd = S.head || {};
    for (const [b, k] of [[3, 0.4], [4, 0.6]]) { const q = Q().setFromAxisAngle(UP, (hd.yaw || 0) * k).multiply(Q().setFromAxisAngle(X, (hd.pitch || 0) * k)).multiply(Q().setFromAxisAngle(Z, -(hd.roll || 0) * k));
      this._e.setFromQuaternion(q, 'XYZ'); this._setE(Pz, b, this._e.x, this._e.y, this._e.z); }
    // free arms (Euler sets) before IK
    if (S.arms) S.arms.forEach((a, k) => { if (!a) return; const [ua, fa, hn, fg] = ARM[k], s = k ? -1 : 1;
      if (a.ua) this._setE(Pz, ua, a.ua[0], a.ua[1] * s, a.ua[2] * s); if (a.fa) this._setE(Pz, fa, a.fa[0], a.fa[1] * s, a.fa[2] * s); if (a.hn) this._setE(Pz, hn, a.hn[0], a.hn[1] * s, a.hn[2] * s);
      Pz[fg * 3 + 2] = -s * (a.curl ?? 0.4); });
    let F = this._fk(Pz);
    // ---- legs: the sole's pivot point on its target, the foot rolled about it
    const dm = this.dims();
    if (S.feet) S.feet.forEach((f, k) => { if (!f) return;
      const [th, sh2, ft] = LEG[k], s = k ? -1 : 1, scl = this.SC ? this.SC[ft * 3 + 1] : 1;
      const Rf = Q().setFromAxisAngle(UP, f.yaw || 0).multiply(Q().setFromAxisAngle(X, -(f.pitch || 0))).multiply(Q().setFromAxisAngle(Z, -s * (f.bank || 0)));
      const piv = FOOT[f.pivot || 'M'].clone().multiplyScalar(scl).applyQuaternion(Rf), A = f.p.clone().sub(piv);
      const hip = F.p[th].clone(), yaw = f.yaw || 0, out = f.kneeOut ?? 0.12;
      const pole = V3(Math.sin(yaw) + s * out * Math.cos(yaw), 0, Math.cos(yaw) - s * out * Math.sin(yaw));
      const res = twoBone(hip, r.len.thigh, r.len.shin, A, pole, { soft: 0.992 });
      const n = V3().crossVectors(res.E.clone().sub(hip), res.W.clone().sub(res.E));
      r._aim(F, Pz, th, res.E.clone().sub(hip), [1, 1]); r._hinge(F, Pz, th, n, 1, [1, 1]);
      r._aim(F, Pz, sh2, res.W.clone().sub(res.E), [1, 1]); r._hinge(F, Pz, sh2, n, 1, [1, 1]);
      r._setWorld(F, Pz, ft, Rf, [1, 1]);
      rep.feet[k] = { missMm: res.miss * 1000 * (fr ? fr.sc : 1), knee: res.flex };
    });
    // ---- hands: two-bone IK of shoulder -> wrist, then the grip point measured and the wrist target corrected
    if (S.hands) S.hands.forEach((h, k) => { if (!h || !h.p) return;
      const [ua, fa, hn, fg, dg] = ARM[k], s = k ? -1 : 1;
      Pz[fg * 3 + 2] = -s * (h.curl ?? 1.35); Pz[dg * 3 + 2] = Pz[fg * 3 + 2] * 1.15;
      const corr = V3(); let res = null, best = Infinity; const bestC = V3();
      for (let it = 0; it < 6; it++) {
        F = this._fk(Pz);
        const Sh = F.p[ua].clone(), c = V3(0, -0.085, 0.012);                     // wrist -> grip, roughly, in the forearm's frame; corrected below
        const d0 = h.p.clone().sub(Sh).normalize(), Wt = h.p.clone().sub(d0.multiplyScalar(c.length())).add(corr);
        const pole = h.pole ? h.pole.clone() : V3(s * 0.55, -1, -0.5).applyQuaternion(F.q[2]);
        res = twoBone(Sh, r.len.ua, r.len.fa, Wt, pole, { soft: 0.997 });
        const n = V3().crossVectors(res.E.clone().sub(Sh), res.W.clone().sub(res.E));
        r._aim(F, Pz, ua, res.E.clone().sub(Sh), [1, 1]); r._hinge(F, Pz, ua, n, -1, [1, 1]);
        r._aim(F, Pz, fa, res.W.clone().sub(res.E), [1, 1]); r._hinge(F, Pz, fa, n, -1, [1, 1]);
        // the hand: along the forearm, flexed a little at the wrist, rolled about the forearm
        { const fd = r.dir[fa].clone().applyQuaternion(F.q[fa]).normalize(); let q = F.q[fa].clone();
          if (h.roll) q = Q().setFromAxisAngle(fd, h.roll).multiply(q);
          if (h.wrist) { const ax = X.clone().applyQuaternion(q); q = Q().setFromAxisAngle(ax, h.wrist).multiply(q); }
          r._setWorld(F, Pz, hn, q, [1, 1]); }
        F = this._fk(Pz);
        const G = GRIP.clone().applyQuaternion(F.q[fg]).add(F.p[fg]), e = h.p.clone().sub(G), el = e.length();
        if (el < best) { best = el; bestC.copy(corr); }
        if (el < 0.002) break; corr.add(e);
      }
      if (best < Infinity && corr.distanceTo(bestC) > 1e-6) { /* keep the last solve: it is at least as good as the corrected one in practice */ }
      F = this._fk(Pz);
      const G = GRIP.clone().applyQuaternion(F.q[fg]).add(F.p[fg]);
      rep.hands[k] = { missMm: G.distanceTo(h.p) * 1000 * (fr ? fr.sc : 1), elbow: res ? res.flex : 0, grip: G };
    });
    F = this._fk(Pz);
    // ---- report: centre of mass (with a carried or pulled load if given) against the support
    const P = r._named(F), C = comOf(P, undefined, S.segments);          // S.segments: a balance.js table (HUMAN c8 lane F, opt-in)
    if (S.load && S.load.kg) { const mB = S.bodyKg || 75, w = S.load.kg / (mB + S.load.kg); C.lerp(S.load.p, w); }
    rep.com = C.clone(); const pts = [];
    if (S.feet) S.feet.forEach((f, k) => { if (!f || f.planted === false) return; const ft = LEG[k][2]; for (const nm of ['H', 'T']) pts.push(FOOT[nm].clone().applyQuaternion(F.q[ft]).add(F.p[ft])); });
    const poly = supportPolygon(pts); rep.support = poly; rep.comOutMm = pts.length >= 2 ? insideDist(poly, C.x, C.z) * 1000 * (fr ? fr.sc : 1) : null;
    if (fr) { for (const n of Object.keys(P)) rep.joints[n] = Poser.l2w(fr, P[n]); rep.comW = Poser.l2w(fr, C); }
    else rep.joints = P;
    return rep;
  }
  // local positions of the sole points of foot k in the current pose
  solePts(k) { const ft = LEG[k][2], F = this.F; return { H: FOOT.H.clone().applyQuaternion(F.q[ft]).add(F.p[ft]), T: FOOT.T.clone().applyQuaternion(F.q[ft]).add(F.p[ft]) }; }
}

// ------------------------------------------------------------------ small dynamics shared by the acts
// a critically damped (or set-damping) second-order follower: the value lags its target with mass, overshoots if zeta < 1.
// The single tool for follow-through, drag and settle (Rosen's springs, Overgrowth).
export class Spring {
  constructor(x0 = 0, { f = 2, zeta = 1 } = {}) { this.x = x0; this.v = 0; this.f = f; this.zeta = zeta; this.init = x0 != null; }
  set(x) { this.x = x; this.v = 0; this.init = true; return this; }
  step(target, dt) { if (!this.init) { this.set(target); return this.x; } if (dt <= 0) return this.x;
    const w = 2 * Math.PI * this.f, n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
    for (let i = 0; i < n; i++) { const a = w * w * (target - this.x) - 2 * this.zeta * w * this.v; this.v += a * h; this.x += this.v * h; } return this.x; }
}
export class Spring3 {
  constructor(o = {}) { this.s = [0, 1, 2].map(() => new Spring(null, o)); this.s.forEach(s => (s.init = false)); this.v = V3(); }
  set(p) { this.s.forEach((s, i) => s.set(p.getComponent(i))); this.v.copy(p); return this; }
  step(p, dt) { this.s.forEach((s, i) => s.step(p.getComponent(i), dt)); return this.v.set(this.s[0].x, this.s[1].x, this.s[2].x); }
}
// a point mass hung from a moving pivot on a rod of length L: a carried pail, a case, a lamp, a hook. Verlet with a distance
// constraint and air/joint damping; `bob` is the mass's world position; `swing` the angle from the vertical (radians).
// A 0.25 m pendulum swings at sqrt(g / L) / 2pi = 1.0 Hz, close to a walk's step rate, which is why carried pails slop.
export class Pendulum {
  constructor(L = 0.25, { damp = 1.2, kg = 5 } = {}) { this.L = L; this.damp = damp; this.kg = kg; this.p = null; this.pp = null; this.swing = 0; this.pull = V3(); }
  reset(pivot) { this.p = pivot.clone().add(V3(0, -this.L, 0)); this.pp = this.p.clone(); }
  step(pivot, dt) {
    if (!this.p || dt <= 0 || dt > 0.25) { this.reset(pivot); return this.p; }
    const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
    for (let i = 0; i < n; i++) {
      const v = this.p.clone().sub(this.pp).multiplyScalar(Math.exp(-this.damp * h)); this.pp.copy(this.p);
      this.p.add(v).add(V3(0, -9.81 * h * h, 0));
      const d = this.p.clone().sub(pivot), l = d.length() || 1e-6; this.p.copy(pivot).addScaledVector(d, this.L / l);
    }
    const d = pivot.clone().sub(this.p); this.swing = Math.acos(Math.max(-1, Math.min(1, d.y / (d.length() || 1))));
    this.pull.copy(d).normalize().multiplyScalar(this.kg * 9.81);        // roughly: what the hand feels (static part)
    return this.p;
  }
  // the orientation of a hung object: its +y along bob -> pivot, its +z kept near `fwd`
  quat(pivot, fwd, out = Q()) { const y = pivot.clone().sub(this.p).normalize(), z = fwd.clone().addScaledVector(y, -fwd.dot(y)).normalize(), x = V3().crossVectors(y, z); return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)); }
}
// counter-based hash noise (deterministic, seekable): smooth 1D value noise and a hash
export const hash = (i, s = 0) => { let n = Math.imul((i | 0) + Math.imul(s | 0, 7919), 374761393); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
export function noise1(x, s = 0) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return (hash(i, s) * (1 - u) + hash(i + 1, s) * u) * 2 - 1; }
export function fbm(x, s = 0, oct = 3) { let a = 0, w = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { a += w * noise1(x * f, s + o * 31); n += w; w *= 0.5; f *= 2.03; } return a / n; }
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
export const smoother = u => { u = clamp(u); return u * u * u * (u * (u * 6 - 15) + 10); };
export const lerp = (a, b, u) => a + (b - a) * u;
export const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
export { V3, Q, UP };
