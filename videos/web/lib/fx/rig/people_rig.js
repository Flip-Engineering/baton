// RIG / PEOPLE RIG (HUMAN studio, cycle 5): the solver that sits between a people.js pose and the skinning.
// people.js poses are Euler numbers per bone. That cannot say "this hand is ON that handle" or "this foot STAYS there".
// PeopleRig takes the act's pose (walk, stand, work, a BVH clip: whatever the scene set) and, per figure that opts in with
// st.rig, corrects it so that contact is a constraint with a measured residual:
//
//   st.rig = {
//     feet: 'auto' | 'lock' | 'free',            // auto: plant when the animated foot is down (Kovar footskate cleanup); lock: always
//     hands: [{ side: 1 | -1, p: Vector3 | () => Vector3, axis?: Vector3, curl?: 0..1.6, w?: 0..1 }],  // world point (+ handle axis) for the palm's grip point
//     weight: -1..1,                             // stand: pelvis over the left (+1) or right (-1) foot; the free hip drops, the shoulders counter
//     load: { dir: Vector3, kg },                // a horizontal pull on the hands (a rope, a cable): counter-lean against it
//     look: Vector3 | null, lookW: 0..1,         // staggered eyes -> head -> neck -> chest look-at
//     autoPhase: stepLength | false,             // drive the walk phase from the ground covered, so stride and phase agree
//     approach: { speed },                        // if the hand still misses after leaning, walk toward it (feet step; nothing teleports)
//     limits: 'enforce' | 'report' | false,
//     segments: a balance.js table (HUMAN c8 lane F, opt-in: a person's own masses, or de Leva by sex; default Dempster)
//     limitsTable: a limits.js table (HUMAN c8 lane F, opt-in: rig/limits.js limitsFor(kin); default AAOS)
//   }
// Output: st.rig.rep (every frame; world space) = { feet[], hands[], com, support, joints, limits[] }, the diagnostic overlay's input,
// and st.rig.stats (running max of hand miss in mm, foot slide in mm per frame). Contact holds by construction where reachable,
// and the miss says so where it is not. All state lives in st.rig: call in time order (a seek: st.rig._s = null).
import * as THREE from 'three';
import { twoBone, fabrik } from './ik.js';
import { FootPlant, phaseFromDistance } from './ground.js';
import { com as comOf, supportPolygon, insideDist, centroid } from './balance.js';
import { LookCascade } from './look.js';
import { clampLocal, measureLocal, PEOPLE_LIMIT_NAMES } from './limits.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), Q = () => new THREE.Quaternion();
const UP = V3(0, 1, 0), X = V3(1, 0, 0), Z = V3(0, 0, 1);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const signedAngle = (a, b, axis) => Math.atan2(V3().crossVectors(a, b).dot(axis), a.dot(b));

export class PeopleRig {
  // S = { NB, PARENT, JOINT, ARM(s), LEG(s), FOOTPTS }  (people.js hands its own skeleton in)
  constructor(S) {
    this.S = S; const { NB, JOINT: J } = S;
    this.J = J.map(j => V3(...j));
    const dv = (a, b) => this.J[b].clone().sub(this.J[a]);
    this.len = { thigh: dv(13, 14).length(), shin: dv(14, 15).length(), ua: dv(5, 6).length(), fa: dv(6, 7).length() }; this.len0 = { ...this.len }; this._SC = null;
    // bind bone directions (what each bone points along at identity)
    this.dir = Array.from({ length: NB }, () => V3(0, -1, 0));
    const set = (b, c) => (this.dir[b] = dv(b, c).normalize());
    set(1, 2); this.dir[2] = V3(0, 1, 0); set(3, 4); this.dir[4] = V3(0, 1, 0);
    for (const s of [1, -1]) { const [ua, fa, hn, fg] = S.ARM(s), [th, sh, ft] = S.LEG(s); set(ua, fa); set(fa, hn); set(hn, fg); set(th, sh); set(sh, ft); this.dir[ft] = V3(0, -0.3, 1).normalize(); }
    // the grip point in the finger bone's frame, and the wrist->grip offset in the hand frame (bind; scaled by the fist)
    this.gripL = V3(0, -0.045, 0.02);
    this.cLocal = [1, -1].map(s => { const [, , hn, fg] = S.ARM(s); return dv(hn, fg).add(this.gripL); });
    this.chestTop = V3(0, 0.18, -0.015);              // shoulder mid above the chest joint (bind)
    this._e = new THREE.Euler();
  }

  // ---------------------------------------------------------------- forward kinematics (mirrors people.js update())
  // HUMAN c6: a body of its own proportions (people.js d.body): per-bone scales [sx, sy, sz] of each segment; bone offsets to the
  // children and the limb lengths the IK uses follow them. null = the bind proportions (every older call).
  setBody(SC) { this._SC = SC || null; const L = this.len0, k = (b) => SC ? SC[b * 3 + 1] : 1;
    this.len = { thigh: L.thigh * k(13), shin: L.shin * k(14), ua: L.ua * k(5), fa: L.fa * k(6) }; }
  fk(Pz, fs = [1, 1], F = null) {
    const { NB, PARENT } = this.S, e = this._e;
    F = F || { q: Array.from({ length: NB }, Q), p: Array.from({ length: NB }, V3), s: new Float32Array(NB), ql: Array.from({ length: NB }, Q) };
    const v = V3(), v2 = V3(), qq = Q();
    for (let b = 0; b < NB; b++) {
      const p = PARENT[b];
      e.set(Pz[b * 3], Pz[b * 3 + 1], Pz[b * 3 + 2], 'XYZ'); F.ql[b].setFromEuler(e);
      v.copy(this.J[b]); if (p >= 0) { v.sub(this.J[p]); if (this._SC) { v.x *= this._SC[p * 3]; v.y *= this._SC[p * 3 + 1]; v.z *= this._SC[p * 3 + 2]; } }
      if (b === 0) { v.x += Pz[NB * 3]; v.y += Pz[NB * 3 + 1]; v.z += Pz[NB * 3 + 2]; }
      if (b === 5 || b === 9) { v2.set(0, -1, 0).applyQuaternion(F.ql[b]); const lift = sstep(-0.2, 0.9, v2.y); v.y += 0.045 * lift; v.x -= Math.sign(this.J[b].x) * 0.018 * lift; v.z -= 0.006 * lift; }
      if (p < 0) { F.q[b].copy(F.ql[b]); F.p[b].copy(v); F.s[b] = (b === 7 || b === 11) ? fs[b === 7 ? 0 : 1] : 1; }
      else { F.q[b].copy(F.q[p]).multiply(F.ql[b]); F.p[b].copy(v).multiplyScalar(F.s[p]).applyQuaternion(F.q[p]).add(F.p[p]); F.s[b] = F.s[p] * ((b === 7 || b === 11) ? fs[b === 7 ? 0 : 1] : 1); }
    }
    return F;
  }
  _setLocal(Pz, b, ql) { this._e.setFromQuaternion(ql, 'XYZ'); Pz[b * 3] = this._e.x; Pz[b * 3 + 1] = this._e.y; Pz[b * 3 + 2] = this._e.z; }
  // set bone b's WORLD rotation to qw (parents already final in F), write its local Euler
  _setWorld(F, Pz, b, qw, fs) { const p = this.S.PARENT[b]; const ql = p < 0 ? qw.clone() : F.q[p].clone().invert().multiply(qw); this._setLocal(Pz, b, ql); this.fk(Pz, fs, F); }
  // aim bone b so its bind axis points along world direction d (minimal swing: keeps its twist)
  _aim(F, Pz, b, d, fs) {
    const cur = this.dir[b].clone().applyQuaternion(F.q[b]), dq = Q().setFromUnitVectors(cur, d.clone().normalize());
    this._setWorld(F, Pz, b, dq.multiply(F.q[b]), fs);
  }
  // twist bone b about its own axis so its local +x maps to world axis n (the hinge of an elbow or a knee)
  _hinge(F, Pz, b, n, sign, fs) {
    const ax = this.dir[b].clone().applyQuaternion(F.q[b]).normalize(), hx = X.clone().applyQuaternion(F.q[b]).multiplyScalar(sign);
    const nn = n.clone().addScaledVector(ax, -n.dot(ax)); if (nn.lengthSq() < 1e-8) return; nn.normalize(); hx.addScaledVector(ax, -hx.dot(ax)).normalize();
    const a = signedAngle(hx, nn, ax); this._setWorld(F, Pz, b, Q().setFromAxisAngle(ax, a).multiply(F.q[b]), fs);
  }
  _footPts(F, ft, out) { const [h, t] = this.S.FOOTPTS; out.H.set(h[0], h[1], h[2]).applyQuaternion(F.q[ft]).add(F.p[ft]); out.T.set(t[0], t[1], t[2]).applyQuaternion(F.q[ft]).add(F.p[ft]); return out; }
  _yawOf(q) { const f = Z.clone().applyQuaternion(q); return Math.atan2(f.x, f.z); }

  // ---------------------------------------------------------------- state
  _init(R) {
    return (R._s = { t: null, planted: [new FootPlant(), new FootPlant()], look: new LookCascade(), lastPos: null, lastContact: [null, null], phase: 0, pelvis: V3(), lean: 0, weight: 0, fs: [1, 1], slide: [0, 0], comHist: null, F: null, F0: null });
  }
  // called BEFORE the act's pose: the walk phase from the ground covered
  prepare(st, dt) {
    const R = st.rig; if (!R || !R.autoPhase) return;
    const S = R._s || this._init(R), x = st.x, z = st.z;
    if (S.lastPos && dt > 0 && dt < 0.5) { const d = Math.hypot(x - S.lastPos[0], z - S.lastPos[1]); S.phase += phaseFromDistance(d, R.autoPhase * (st.amt ?? 1)); st.ph = S.phase; }
    else if (S.lastPos) st.ph = S.phase;
    if (dt !== 0 || !S.lastPos) S.lastPos = [x, z];
  }

  // ---------------------------------------------------------------- the solve
  // pos: the figure's world position (Vector3), heading (rad), sc: metres scale, dt: seconds since the last call (0 = same frame again)
  solve(st, Pz, pos, heading, sc, dt, fs = [1, 1]) {
    const R = st.rig, S = R._s || this._init(R), { NB } = this.S;
    if (dt < 0 || dt > 0.5) { S.planted.forEach(f => f.reset()); S.look.reset(); S.t = null; S.lastContact = [null, null]; }
    const frozen = dt === 0, measureOnly = R.mode === 'measure';
    const qh = Q().setFromAxisAngle(UP, heading), qhi = qh.clone().invert();
    const toL = (w, o = V3()) => o.copy(w).sub(pos).multiplyScalar(1 / sc).applyQuaternion(qhi);
    const toLd = (w, o = V3()) => o.copy(w).applyQuaternion(qhi);
    const toW = (l, o = V3()) => o.copy(l).multiplyScalar(sc).applyQuaternion(qh).add(pos);
    const lift = (st.lift || 0) / sc, floor = lift;
    const F = S.F = this.fk(Pz, fs, S.F);
    const rep = { feet: [], hands: [], com: null, support: [], joints: {}, limits: [], flags: [] };
    const idxL = { ua: [5, 9], fa: [6, 10], hn: [7, 11], fg: [8, 12], th: [13, 16], sh: [14, 17], ft: [15, 18] };  // [left, right]
    const FT = [{ H: V3(), T: V3() }, { H: V3(), T: V3() }];

    // ---- baseline: the act's own planting (lowest sole on the floor), so a pose without contact info keeps its bob
    if (st.plant !== false) {
      let low = Infinity; for (let k = 0; k < 2; k++) { this._footPts(F, idxL.ft[k], FT[k]); low = Math.min(low, FT[k].H.y, FT[k].T.y); }
      Pz[NB * 3 + 1] += floor - low; this.fk(Pz, fs, F);
    }
    if (measureOnly) { this._measure(st, Pz, F, S, rep, toW, fs, dt, floor); R.rep = rep; return rep; }

    // ---- look: eyes, head, neck, chest (angles added to the pose)
    if (R.look) {
      const tl = toL(typeof R.look === 'function' ? R.look() : R.look), hp = F.p[4].clone().add(V3(0, 0.07, 0.02).applyQuaternion(F.q[4]));
      const d = tl.sub(hp), f = Z.clone().applyQuaternion(F.q[4]), fh = V3(f.x, 0, f.z).normalize(), dh = V3(d.x, 0, d.z).normalize();
      const yaw = signedAngle(fh, dh, UP), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) - Math.atan2(f.y, Math.hypot(f.x, f.z));
      const o = S.look.update({ yaw, pitch, dt: frozen ? 0.0001 : (dt || 1 / 30), weight: R.lookW ?? 1 });
      Pz[3 * 3 + 1] += o.neck.yaw; Pz[4 * 3 + 1] += o.head.yaw; Pz[2 * 3 + 1] += o.chest.yaw;
      Pz[3 * 3] -= o.neck.pitch; Pz[4 * 3] -= o.head.pitch; Pz[2 * 3] -= o.chest.pitch * 0.5;
      rep.look = { eyes: o.eyes, yaw, pitch, target: toW(tl.add(hp).addScaledVector(d, 0)) };
      this.fk(Pz, fs, F);
    }

    // ---- balance, first pass: weight shift and the counter-lean against a load (about the support centre)
    const feetMode = k => (typeof R.feet === 'object' ? R.feet[k ? 'R' : 'L'] : R.feet) || 'auto';
    let cen = V3(); { const a = F.p[15], b = F.p[18]; cen.set((a.x + b.x) / 2, floor, (a.z + b.z) / 2); }
    if (S.planted.some(f => f.planted)) { const pts = S.planted.filter(f => f.planted).map(f => toL(f.pin)); cen.set(pts.reduce((a, p) => a + p.x, 0) / pts.length, floor, pts.reduce((a, p) => a + p.z, 0) / pts.length); }
    let leanA = R.lean || 0, leanDir = null;
    if (R.load && R.load.kg) {
      const ld = toLd(V3(R.load.dir.x, 0, R.load.dir.z)).normalize(); leanDir = ld.clone().negate();
      leanA += clamp(Math.atan2(R.load.kg, R.bodyKg || 75), 0, 0.5) * (R.leanGain ?? 1);
    }
    S.lean += ((leanA) - S.lean) * (frozen ? 0 : 1 - Math.exp(-(dt || 1 / 30) / 0.16)); if (S.t == null) S.lean = leanA;
    const wTarget = R.weight || 0; S.weight += (wTarget - S.weight) * (frozen ? 0 : 1 - Math.exp(-(dt || 1 / 30) / 0.3)); if (S.t == null) S.weight = wTarget;
    let shift = V3(0, 0, 0);
    if (Math.abs(S.lean) > 1e-3 && leanDir) {
      const ax = V3().crossVectors(UP, leanDir).normalize(), Rl = Q().setFromAxisAngle(ax, S.lean);
      const pel = F.p[0].clone(), np = cen.clone().add(pel.clone().sub(cen).applyQuaternion(Rl)); shift.add(np.sub(pel));
      const qh0 = F.ql[0].clone(); this._setLocal(Pz, 0, Rl.clone().multiply(qh0));
      // the spine takes a little of it back so the head stays over the work
      const back = Q().setFromAxisAngle(ax, -S.lean * (R.spineBack ?? 0.45)); for (const b of [1, 2]) { const q = F.ql[b].clone(); this._setLocal(Pz, b, back.clone().multiply(q)); }   // (frame: local ~ world at small angles about the lateral axis)
    }
    if (Math.abs(S.weight) > 1e-3) {
      const sep = Math.abs(F.p[15].x - F.p[18].x) + 0.12; shift.x += S.weight * 0.34 * sep * 0.5;
      const roll = S.weight * 0.075, qz = Q().setFromAxisAngle(Z, roll), q0 = F.ql[0].clone(); this._setLocal(Pz, 0, qz.multiply(q0));
      const c = F.ql[1].clone(); this._setLocal(Pz, 1, Q().setFromAxisAngle(Z, -roll * 0.9).multiply(c)); const c2 = F.ql[2].clone(); this._setLocal(Pz, 2, Q().setFromAxisAngle(Z, -roll * 0.7).multiply(c2));
    }
    Pz[NB * 3] += shift.x; Pz[NB * 3 + 1] += shift.y; Pz[NB * 3 + 2] += shift.z; this.fk(Pz, fs, F);

    // ---- feet: contact, world locks, pelvis reach, leg IK. (two passes: the second adds the COM correction)
    let comShift = V3(), comInfo = null;
    for (let pass = 0; pass < 2; pass++) {
      const base = pass ? S.F0 : null; if (pass) { Pz.set(S.P0); this.fk(Pz, fs, F); }
      if (pass) { Pz[NB * 3] += comShift.x; Pz[NB * 3 + 1] += comShift.y; Pz[NB * 3 + 2] += comShift.z; this.fk(Pz, fs, F); }
      const anim = [0, 1].map(k => { const ft = idxL.ft[k]; return { A: F.p[ft].clone(), Rf: F.q[ft].clone(), pts: this._footPts(F, ft, { H: V3(), T: V3() }) }; });
      const tgt = [null, null], Rt = [null, null];
      for (let k = 0; k < 2; k++) {
        const fp = S.planted[k], a = anim[k], mode = feetMode(k), yaw = this._yawOf(a.Rf), Hw = toW(a.pts.H), Tw = toW(a.pts.T), floorW = pos.y + (st.lift || 0);
        if (pass === 0 && !frozen) fp.update({ H: Hw, T: Tw, floor: floorW, dt: dt || 1 / 30, force: mode === 'lock' ? 'lock' : mode === 'free' ? 'free' : null, yaw: yaw + heading });
        else if (pass === 0 && frozen && mode === 'lock' && !fp.planted) fp.update({ H: Hw, T: Tw, floor: floorW, dt: 1 / 30, force: 'lock', yaw: yaw + heading });
        if (pass === 0 && !frozen && fp.justPlanted && R.stance && R.stance[k ? 'R' : 'L']) { const o = R.stance[k ? 'R' : 'L'], w = V3(o[0], 0, o[1]).applyQuaternion(qh); fp.pin.x += w.x * sc; fp.pin.z += w.z * sc; }   // a stance: where the foot goes at plant, relative to the body (x left, z forward)
        if (fp.planted) {
          const Rc = Q().setFromAxisAngle(UP, fp.yaw - heading - yaw), c = (fp.cp === 'H' ? a.pts.H : a.pts.T).clone().sub(a.A).applyQuaternion(Rc), pl = toL(fp.pin);
          tgt[k] = V3(pl.x, floor, pl.z).sub(c); Rt[k] = Rc.multiply(a.Rf);
        } else { tgt[k] = a.A.clone().add(fp.off); Rt[k] = a.Rf.clone(); }
      }
      // pelvis reach: pull the pelvis toward any planted foot it cannot reach; if it needs too much, that foot steps
      const Lmax = this.len.thigh + this.len.shin, pel = V3();
      // a foot that is too far from the hip: bend the knees (drop the pelvis) first; only when it is out of reach horizontally pull the pelvis over; past the limit, step
      const lim = 0.955 * Lmax;
      for (let it = 0; it < 3; it++) {
        let wk = -1, wd = 0;
        for (let k = 0; k < 2; k++) {
          if (!S.planted[k].planted) continue;
          const hip = F.p[idxL.th[k]].clone().add(pel), d = tgt[k].clone().sub(hip), hd = Math.hypot(d.x, d.z), v = -d.y;
          if (globalThis.__DBG2) console.log('  foot', k, 'hd', hd.toFixed(3), 'v', v.toFixed(3), 'pin', fp_dbg(S.planted[k]), 'anim', anim[k].A.toArray().map(x=>x.toFixed(2)).join(','), 'tgt', tgt[k].toArray().map(x=>x.toFixed(2)).join(','));
          if (hd < lim * 0.97) { const vneed = Math.sqrt(lim * lim - hd * hd); if (v > vneed) { pel.y -= (v - vneed); } }
          else { pel.x += d.x / hd * (hd - lim * 0.9); pel.z += d.z / hd * (hd - lim * 0.9); }
          const D = tgt[k].clone().sub(F.p[idxL.th[k]].clone().add(pel)).length(); if (D > wd) { wd = D; wk = k; }
        }
        if (globalThis.__DBG2) console.log('pel', it, pel.toArray().map(v => v.toFixed(3)).join(','), 'worst', wd.toFixed(3));
        if (wk >= 0 && (Math.hypot(pel.x, pel.z) > 0.12 || -pel.y > (R.pelvisMax ?? 0.07))) { if (!frozen) S.planted[wk].release(); else S.planted[wk].planted = false; tgt[wk] = anim[wk].A.clone().add(S.planted[wk].off); Rt[wk] = anim[wk].Rf.clone(); pel.set(0, 0, 0); }
      }
      if (pel.lengthSq() > 0) { Pz[NB * 3] += pel.x; Pz[NB * 3 + 1] += pel.y; Pz[NB * 3 + 2] += pel.z; this.fk(Pz, fs, F); for (let k = 0; k < 2; k++) if (!S.planted[k].planted) { tgt[k].add(pel); } }
      if (pass === 0) S.P0 = Float32Array.from(Pz);
      // legs
      for (let k = 0; k < 2; k++) {
        const s = k ? -1 : 1, th = idxL.th[k], sh = idxL.sh[k], ft = idxL.ft[k], hip = F.p[th].clone(); let A = tgt[k].clone();
        // never through the floor: the lowest sole point of the target foot sits on or above it
        { const h = V3(...this.S.FOOTPTS[0]).applyQuaternion(Rt[k]), t = V3(...this.S.FOOTPTS[1]).applyQuaternion(Rt[k]); const lo = A.y + Math.min(h.y, t.y); if (lo < floor) A.y += floor - lo; }
        const yaw = this._yawOf(Rt[k]), pole = V3(Math.sin(yaw) + s * 0.12 * Math.cos(yaw), 0, Math.cos(yaw) - s * 0.12 * Math.sin(yaw));
        const r = twoBone(hip, this.len.thigh, this.len.shin, A, pole, { soft: 0.995 });
        this._aim(F, Pz, th, r.E.clone().sub(hip), fs);
        this._hinge(F, Pz, th, V3().crossVectors(r.E.clone().sub(hip), r.W.clone().sub(r.E)), 1, fs);
        this._aim(F, Pz, sh, r.W.clone().sub(r.E), fs);
        this._hinge(F, Pz, sh, V3().crossVectors(r.E.clone().sub(hip), r.W.clone().sub(r.E)), 1, fs);
        this._setWorld(F, Pz, ft, Rt[k].clone(), fs);
        rep.feet[k] = { side: s, planted: S.planted[k].planted, cp: S.planted[k].cp, missMm: r.miss * sc * 1000 };
      }
      // balance, second pass: put the centre of mass over the support (the planted feet's footprints)
      if (pass === 0) {
        const P = this._named(F), C = comOf(P, undefined, R.segments), pts = [];
        // HUMAN c6: a pull at the hands moves the point the body balances about: with a load the centre of mass sits BEHIND the feet
        // by its height x force / weight (a hauler hangs back on the rope). Balance the effective centre, not the bare one.
        if (R.load && R.load.kg && R.load.balance !== false) { const ld = toLd(V3(R.load.dir.x, 0, R.load.dir.z)).normalize(), k = clamp(R.load.kg / (R.bodyKg || 75), 0, 0.9), hC = Math.max(0, C.y - floor); C.x += ld.x * hC * k; C.z += ld.z * hC * k; }
        for (let k = 0; k < 2; k++) if (S.planted[k].planted || feetMode(k) === 'lock') { const fp = this._footPts(F, idxL.ft[k], { H: V3(), T: V3() }); pts.push(fp.H, fp.T); }
        if (pts.length >= 2 && R.balance !== false) {
          const poly = supportPolygon(pts), d = insideDist(poly, C.x, C.z); comInfo = { d, poly };
          if (d > 0.005) { const ct = centroid(poly); comShift.set((ct[0] - C.x) * 0.85, 0, (ct[1] - C.z) * 0.85); comShift.clampLength(0, 0.12); }
        }
        if (comShift.lengthSq() === 0) break;
      }
    }
    // ---- hands: body reach (the spine leans toward what it can't reach), then two-bone IK on the palm's grip point
    const targets = (R.hands || []).filter(h => h && (h.w ?? 1) > 0);
    const handIdx = s => (s > 0 ? 0 : 1);
    if (targets.length) {
      const T = targets.map(h => ({ h, k: handIdx(h.side), p: toL(typeof h.p === 'function' ? h.p() : h.p), a: h.axis ? toLd(h.axis).normalize() : null }));
      for (const t of T) { const s = t.k ? -1 : 1, w = t.h.w ?? 1, fg = idxL.fg[t.k], curl = t.h.curl ?? 1.3; Pz[fg * 3 + 2] = -s * curl * w + Pz[fg * 3 + 2] * (1 - w); const d = this.S.ARM(s)[4]; Pz[d * 3 + 2] = Pz[fg * 3 + 2] * 1.15; Pz[d * 3] = Pz[fg * 3]; }
      this.fk(Pz, fs, F);
      const cOf = k => { const fg = idxL.fg[k]; return this.J[fg].clone().sub(this.J[idxL.hn[k]]).add(this.gripL.clone().applyQuaternion(F.ql[fg])).multiplyScalar(fs[k]); };
      // spine reach (an arc, cone-limited): move the shoulder mid toward the worst-short target
      let need = V3(), worst = 0;
      for (const t of T) { const sh = F.p[idxL.ua[t.k]], c = cOf(t.k).applyQuaternion(F.q[idxL.fa[t.k]]), Wt = t.p.clone().sub(c), d = Wt.sub(sh), D = d.length(), over = D - 0.9 * (this.len.ua + this.len.fa); if (over > worst) { worst = over; need = d.normalize().multiplyScalar(over); } }
      const leanBy = need => {
          // lean the spine like an arc: rotate spine and chest a share each about the axis that swings the shoulder mid toward the goal (a chain solve that folds back is a bad spine)
          const smOf = () => F.p[2].clone().add(this.chestTop.clone().applyQuaternion(F.q[2])), tg = smOf().add(need), p1 = F.p[1].clone();
          const dn = need.clone().normalize();
          for (let it = 0; it < 10; it++) {
            const sm = smOf(), r = sm.clone().sub(p1), e = tg.clone().sub(sm).dot(dn); if (e < 0.003) break;   // progress along the wanted direction only: a rotation cannot hit an exact point
            const ax = V3().crossVectors(r, dn); if (ax.lengthSq() < 1e-10) break; ax.normalize();
            const ang = clamp(e / r.length(), 0, 0.12);
            for (const b of [1, 2]) {
              const cur = this.dir[b].clone().applyQuaternion(F.q[b]), lim = b === 1 ? 0.5 : 0.45;
              const a0 = Math.acos(clamp(cur.dot(V3(0, 1, 0).applyQuaternion(F.q[b === 1 ? 0 : 1])), -1, 1));
              if (a0 > lim && ax.dot(V3().crossVectors(V3(0, 1, 0), dn)) > 0) continue;
              this._setWorld(F, Pz, b, Q().setFromAxisAngle(ax, ang * 0.5).multiply(F.q[b]), fs);
            }
          }
      };
      const solveHands = () => {
        for (const t of T) {
          const k = t.k, s = k ? -1 : 1, [ua, fa, hn, fg] = [idxL.ua[k], idxL.fa[k], idxL.hn[k], idxL.fg[k]], w = t.h.w ?? 1;
          const pole = V3(s * 0.5, -1, -0.45).applyQuaternion(F.q[2]);
          const Pz0 = Float32Array.from(Pz);
          let Rh = null, res = null; const corr = V3(), wm = R.wristMax ?? 1.15;
          const iter = () => {
            const Sh = F.p[ua].clone(), c = cOf(k);
            if (!Rh) { const dd = t.p.clone().sub(Sh).normalize(); Rh = Q().setFromUnitVectors(this.dir[fa], dd); if (t.a) { const z0 = Z.clone().applyQuaternion(Rh), aa = t.a.dot(z0) >= 0 ? t.a : t.a.clone().negate(); Rh = Q().setFromUnitVectors(z0, aa).multiply(Rh); } }
            const Wt = t.p.clone().sub(c.clone().applyQuaternion(Rh)).add(corr);
            res = twoBone(Sh, this.len.ua, this.len.fa, Wt, pole, { soft: 0.999 });
            this._aim(F, Pz, ua, res.E.clone().sub(Sh), fs);
            const n = V3().crossVectors(res.E.clone().sub(Sh), res.W.clone().sub(res.E));
            this._hinge(F, Pz, ua, n, -1, fs);
            this._aim(F, Pz, fa, res.W.clone().sub(res.E), fs);
            this._hinge(F, Pz, fa, n, -1, fs);
            // hand orientation: forearm frame, rolled about the forearm so the palm's bar axis (hand z) lies along the handle, then swung the rest
            const Rf = F.q[fa].clone(), fd = this.dir[fa].clone().applyQuaternion(Rf).normalize();
            let Rn = Rf.clone();
            if (t.a) {
              const z0 = Z.clone().applyQuaternion(Rf); let a = t.a.dot(z0) >= 0 ? t.a.clone() : t.a.clone().negate();
              { const fdn = fd.clone().multiplyScalar(a.dot(fd) >= 0 ? 1 : -1), gap = Math.acos(clamp(a.dot(fdn), -1, 1)), minA = R.gripAngle ?? 1.25;   // a handle nearly along the forearm (a rope you pull on) is gripped across the palm at an angle, as a hand does
                if (gap < minA) { let nn = V3().crossVectors(fdn, a); if (nn.lengthSq() < 1e-6) nn = V3().crossVectors(fdn, UP); nn.normalize(); a = fdn.clone().applyAxisAngle(nn, minA); } }
              const zp = z0.clone().addScaledVector(fd, -z0.dot(fd)), ap = a.clone().addScaledVector(fd, -a.dot(fd));
              if (zp.lengthSq() > 1e-6 && ap.lengthSq() > 1e-6) Rn = Q().setFromAxisAngle(fd, signedAngle(zp.normalize(), ap.normalize(), fd)).multiply(Rn);
              const z1 = Z.clone().applyQuaternion(Rn), sw = Q().setFromUnitVectors(z1, a), ang = 2 * Math.acos(clamp(sw.w, -1, 1));
              if (ang > wm) sw.setFromAxisAngle(V3(sw.x, sw.y, sw.z).normalize(), wm); Rn = sw.multiply(Rn);
            }
            Rh = Rn;
            // measure where the grip point really is and push the next wrist target by the error (the curl and the twist bend the estimate)
            this._setWorld(F, Pz, hn, Rh.clone(), fs);
            const fgb = idxL.fg[k], G = this.gripL.clone().multiplyScalar(F.s[fgb]).applyQuaternion(F.q[fgb]).add(F.p[fgb]);
            return t.p.distanceTo(G);
                    };
          // fixed-point on the wrist target with an adaptive gain: the grip point moves with the hand's turn, so a fixed gain can diverge
          let gain = 0.7, best = Infinity; const bestCorr = V3();
          for (let it = 0; it < 14; it++) {
            const e = iter();
            if (e < best) { best = e; bestCorr.copy(corr); gain = Math.min(0.9, gain * 1.1); } else { gain *= 0.5; corr.copy(bestCorr); }
            if (it >= 2) { const fgb = idxL.fg[k], G = this.gripL.clone().multiplyScalar(F.s[fgb]).applyQuaternion(F.q[fgb]).add(F.p[fgb]); corr.addScaledVector(t.p.clone().sub(G), gain); }
            if (best < 0.0004) break;
          }
          corr.copy(bestCorr); iter();
          // forearm carries the pronation, the wrist the rest: split the twist between forearm and hand
          this._setWorld(F, Pz, hn, Rh.clone(), fs);
          { const tw = measureLocal(F.ql[hn], 'hand', s).twist * Math.PI / 180;
            if (Math.abs(tw) > 0.05) { const fdv = this.dir[fa].clone().applyQuaternion(F.q[fa]).normalize(); this._setWorld(F, Pz, fa, Q().setFromAxisAngle(fdv.negate(), tw * 0.9).multiply(F.q[fa]), fs); this._setWorld(F, Pz, hn, Rh.clone(), fs); } }
          if (w < 1) { for (let i = 0; i < NB * 3; i++) if ([ua, fa, hn].includes(Math.floor(i / 3))) Pz[i] = Pz0[i] + (Pz[i] - Pz0[i]) * w; }
          this.fk(Pz, fs, F);
        }
      };
      if (worst > 0 && R.reach !== false) leanBy(need);
      solveHands();
      // the estimate of where the grip lands was made before the hand turned; measure it and lean the rest of the way
      for (let rr = 0; rr < 3 && R.reach !== false; rr++) {
        const errs = T.map(t => { const fgb = idxL.fg[t.k], G = this.gripL.clone().multiplyScalar(F.s[fgb]).applyQuaternion(F.q[fgb]).add(F.p[fgb]); return t.p.clone().sub(G); });
        const worstE = errs.reduce((a, e) => Math.max(a, e.length()), 0); if (globalThis.__DBG3) console.log('rr', rr, 'errs', errs.map(e => e.toArray().map(v => v.toFixed(3)).join(',')).join(' | ')); if (worstE < 0.003) break;
        let nd = V3(), best = 0; T.forEach((t, i) => { const fgb = idxL.fg[t.k], cNow = this.gripL.clone().multiplyScalar(F.s[fgb]).applyQuaternion(F.q[fgb]).add(F.p[fgb]).sub(F.p[idxL.hn[t.k]]), req = t.p.clone().sub(cNow).sub(F.p[idxL.ua[t.k]]), sh = req.length() - 0.97 * (this.len.ua + this.len.fa); if (globalThis.__DBG3) console.log('  short', i, sh.toFixed(3), 'req', req.length().toFixed(3)); if (sh > best) { best = sh; nd = req.normalize().multiplyScalar(sh + 0.01); } });   // the wrist the grip needs is out of reach: lean toward it
        if (nd.lengthSq() === 0) break; leanBy(nd); solveHands();
      }
    }
    // ---- limits (spine, neck, head, foot enforced; arms and legs reported: the IK is exact, so a violation is the target's fault)
    if (R.limits !== false) {
      const enf = R.limits !== 'report';
      for (const b in PEOPLE_LIMIT_NAMES) {
        const nm = PEOPLE_LIMIT_NAMES[b], bi = +b, side = bi === 5 || bi === 6 || bi === 7 || bi === 13 || bi === 14 || bi === 15 ? 1 : -1;
        const LT = R.limitsTable || LIMITS_, m = measureLocal(F.ql[bi], nm, side, LT), L = LT[nm] || LIMITS_[nm];
        const out = m.flex < L.flex[0] - 1 || m.flex > L.flex[1] + 1 || m.abd < L.abd[0] - 1 || m.abd > L.abd[1] + 1;
        if (out) { rep.limits.push({ bone: bi, name: nm, flex: +m.flex.toFixed(0), abd: +m.abd.toFixed(0), twist: +m.twist.toFixed(0) }); if (enf && ['spine', 'chest', 'neck', 'head'].includes(nm)) { const c = clampLocal(F.ql[bi], nm, side, undefined, LT); this._setLocal(Pz, bi, c); } }
      }
      if (rep.limits.length) this.fk(Pz, fs, F);
    }

    // ---- report (world space) and the running stats
    const P = this._named(F), C = comOf(P, undefined, R.segments);
    rep.com = toW(C); rep.comGround = toW(V3(C.x, floor, C.z));
    const pts = []; for (let k = 0; k < 2; k++) if (rep.feet[k] && rep.feet[k].planted) { const fp = this._footPts(F, idxL.ft[k], { H: V3(), T: V3() }); pts.push(fp.H, fp.T); }
    const poly = supportPolygon(pts); rep.support = poly.map(p => toW(V3(p[0], floor, p[1])).toArray()); rep.comOut = pts.length ? insideDist(poly, C.x, C.z) * sc : 0;
    for (const n of Object.keys(P)) rep.joints[n] = toW(P[n]).toArray();
    for (let k = 0; k < 2; k++) {
      const fp = S.planted[k], ftp = this._footPts(F, idxL.ft[k], { H: V3(), T: V3() }), cp = fp.cp === 'H' ? ftp.H : ftp.T, cw = toW(cp);
      const r = rep.feet[k] || (rep.feet[k] = { side: k ? -1 : 1 }); r.contact = cw.toArray(); r.pin = fp.planted ? fp.pin.toArray() : null;
      // slide: how far the contact point moved on the ground since the last frame, in the figure's own frame (so a walking root doesn't count) — measured against the pin
      r.holdMm = fp.planted ? Math.hypot(cw.x - r.pin[0], cw.z - r.pin[2]) * 1000 : 0;
      r.planted = fp.planted;
      if (fp.planted && !fp.justPlanted && !frozen) { const lc = S.lastContact[k]; if (lc && fp.cp === lc.cp) { r.slideMm = Math.hypot(cw.x - lc.x, cw.z - lc.z) * 1000; } }
      S.lastContact[k] = fp.planted ? { x: cw.x, z: cw.z, cp: fp.cp } : null;
    }
    if (targets.length) for (const h of targets) {
      const k = handIdx(h.side), fgb = idxL.fg[k], g = this.gripL.clone().multiplyScalar(1).multiplyScalar(F.s[fgb]).applyQuaternion(F.q[fgb]).add(F.p[fgb]), gw = toW(g), tw = typeof h.p === 'function' ? h.p() : h.p;
      rep.hands[k] = { side: h.side, target: tw.toArray(), grip: gw.toArray(), missMm: gw.distanceTo(tw) * 1000, wrist: toW(F.p[idxL.hn[k]]).toArray() };
    }
    // approach: the hand still misses after the body leaned as far as it can, so walk toward it (the feet will step)
    if (R.approach && !frozen && targets.length) {
      const h = rep.hands.find(x => x && x.missMm > (R.approach.tol ?? 25)); if (h && dt > 0) {
        const tw = V3(...h.target), d = V3(tw.x - st.x, 0, tw.z - st.z), dist = d.length(); if (dist > (R.approach.stop ?? 0.35)) { d.normalize(); st.x += d.x * R.approach.speed * dt; st.z += d.z * R.approach.speed * dt; } }
    }
    const stt = R.stats || (R.stats = { slideMax: 0, slideSum: 0, slideN: 0, missMax: 0, holdMax: 0, frames: 0 });
    if (!frozen) { stt.frames++; for (const f of rep.feet) { if (f && f.slideMm != null) { stt.slideMax = Math.max(stt.slideMax, f.slideMm); stt.slideSum += f.slideMm; stt.slideN++; } if (f) stt.holdMax = Math.max(stt.holdMax, f.holdMm || 0); } for (const h of rep.hands) if (h) stt.missMax = Math.max(stt.missMax, h.missMm); }
    if (!frozen) S.t = st.t ?? 0;
    R.rep = rep; return rep;
  }


  // ---------------------------------------------------------------- pose from joint positions (film retarget)
  // J: { hipL, hipR, shL, shR, elL, elR, wrL, wrR, knL, knR, anL, anR, toL, toR, heL, heR, nose, earL, earR } as Vector3 in the body frame
  // (x left, y up, z forward). Only DIRECTIONS are used: the rig keeps its own bone lengths.
  poseFromJoints(Pz, J, fs = [1, 1], { curl = 1.1 } = {}) {
    const { NB } = this.S, F = this.fk(Pz.fill(0), fs);
    const basis = (x, y) => { const X = x.clone().normalize(), Z = V3().crossVectors(X, y).normalize(), Y = V3().crossVectors(Z, X); return Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z)); };
    const hipLine = J.hipL.clone().sub(J.hipR), shLine = J.shL.clone().sub(J.shR), spine = J.shMid.clone().sub(J.hipMid || V3()).normalize();
    const qh = basis(hipLine, V3(0, 1, 0).lerp(spine, 0.35)), qc = basis(shLine, spine);
    this._setWorld(F, Pz, 0, qh, fs);
    this._setWorld(F, Pz, 1, qh.clone().slerp(qc, 0.5), fs);
    this._setWorld(F, Pz, 2, qc, fs);
    const headUp = J.earMid.clone().sub(J.shMid).normalize(), qhd = basis(J.earL.clone().sub(J.earR), headUp);
    this._setWorld(F, Pz, 3, qc.clone().slerp(qhd, 0.4), fs); this._setWorld(F, Pz, 4, qhd, fs);
    const limb = (b1, b2, a, m, e, sign) => { const d1 = m.clone().sub(a), d2 = e.clone().sub(m); if (d1.lengthSq() < 1e-8 || d2.lengthSq() < 1e-8) return;
      this._aim(F, Pz, b1, d1, fs); const n = V3().crossVectors(d1, d2); if (n.lengthSq() > 1e-6) this._hinge(F, Pz, b1, n, sign, fs); this._aim(F, Pz, b2, d2, fs); if (n.lengthSq() > 1e-6) this._hinge(F, Pz, b2, n, sign, fs); };
    for (const k of [0, 1]) { const s = k ? -1 : 1, sf = k ? 'R' : 'L', [ua, fa, hn, fg] = this.S.ARM(s), [th, sh, ft] = this.S.LEG(s);
      limb(ua, fa, J['sh' + sf], J['el' + sf], J['wr' + sf], -1);
      this._setWorld(F, Pz, hn, F.q[fa].clone(), fs);
      Pz[fg * 3 + 2] = -s * curl; const d = this.S.ARM(s)[4]; Pz[d * 3 + 2] = Pz[fg * 3 + 2] * 1.15; Pz[d * 3] = Pz[fg * 3];
      limb(th, sh, J['hip' + sf], J['kn' + sf], J['an' + sf], 1);
      const fd = J['to' + sf].clone().sub(J['an' + sf]); if (fd.lengthSq() > 1e-8) this._aim(F, Pz, ft, fd, fs); }
    this.fk(Pz, fs, F); return Pz;
  }
  // measure only (a figure without the rig): the same contact detector on the raw pose, so before and after share one ruler
  _measure(st, Pz, F, S, rep, toW, fs, dt, floor) {
    for (let k = 0; k < 2; k++) {
      const ft = k ? 18 : 15, p = this._footPts(F, ft, { H: V3(), T: V3() }), fp = S.planted[k];
      if (dt !== 0) fp.update({ H: toW(p.H), T: toW(p.T), floor: toW(V3(0, floor, 0)).y, dt: dt || 1 / 30, force: null, yaw: 0 });
      const cp = fp.cp === 'H' ? p.H : p.T, cw = toW(cp), r = rep.feet[k] = { side: k ? -1 : 1, planted: fp.planted, cp: fp.cp, contact: cw.toArray(), pin: null, holdMm: 0 };
      if (fp.planted && !fp.justPlanted && dt !== 0) { const lc = S.lastContact[k]; if (lc && fp.cp === lc.cp) r.slideMm = Math.hypot(cw.x - lc.x, cw.z - lc.z) * 1000; }
      S.lastContact[k] = fp.planted ? { x: cw.x, z: cw.z, cp: fp.cp } : null;
    }
    const stt = st.rig.stats || (st.rig.stats = { slideMax: 0, slideSum: 0, slideN: 0, missMax: 0, holdMax: 0, frames: 0 });
    if (dt !== 0) { stt.frames++; for (const f of rep.feet) if (f && f.slideMm != null) { stt.slideMax = Math.max(stt.slideMax, f.slideMm); stt.slideSum += f.slideMm; stt.slideN++; } }
    for (const [n, v] of Object.entries(this._named(F))) rep.joints[n] = toW(v).toArray();
    if (st.rig.hands) for (const h of st.rig.hands) { const k = h.side > 0 ? 0 : 1, fgb = k ? 12 : 8, g = this.gripL.clone().multiplyScalar(F.s[fgb]).applyQuaternion(F.q[fgb]).add(F.p[fgb]), gw = toW(g), tw = typeof h.p === 'function' ? h.p() : h.p; rep.hands[k] = { side: h.side, target: tw.toArray(), grip: gw.toArray(), missMm: gw.distanceTo(tw) * 1000 }; if (dt !== 0) stt.missMax = Math.max(stt.missMax, rep.hands[k].missMm); }
    S.t = st.t ?? 0;
  }
  _named(F) {
    const p = F.p, q = F.q, o = {};
    o.hips = p[0]; o.neck = p[3]; o.headTop = p[4].clone().add(V3(0, 0.16, 0).applyQuaternion(q[4])); o.shoulderMid = p[2].clone().add(this.chestTop.clone().applyQuaternion(q[2]));
    o.head = p[4];
    for (const [k, sfx] of [[0, 'L'], [1, 'R']]) { const s = k ? -1 : 1, [ua, fa, hn, fg] = this.S.ARM(s), [th, sh, ft] = this.S.LEG(s);
      o['sh' + sfx] = p[ua]; o['el' + sfx] = p[fa]; o['wr' + sfx] = p[hn]; o['fi' + sfx] = p[fg];
      o['hip' + sfx] = p[th]; o['kn' + sfx] = p[sh]; o['an' + sfx] = p[ft]; o['to' + sfx] = V3(...this.S.FOOTPTS[1]).applyQuaternion(q[ft]).add(p[ft]); }
    return o;
  }
}
import { LIMITS as LIMITS_ } from './limits.js';
export { phaseFromDistance };
const fp_dbg = f => f.pin.toArray().map(x => x.toFixed(2)).join(',') + ' cp' + f.cp;
