// RIG c1 / SERIAL: a robot arm from its published geometry, on the same solve-and-measure footing as the people.
// The arm is a Denavit-Hartenberg table (Universal Robots publish theirs for every UR arm), forward kinematics, a damped-least-squares
// pose IK with joint limits, and a mesh built from the table (drums on each axis, tubes along each link) so the picture IS the model.
//
//   const arm = new SerialArm('UR5e');          // or 'UR10e'
//   const r = arm.solve(targetMatrix4, { q0, iters: 40 });   // -> { q, errMm, errDeg, margins, singular }  the flange reaches the target or says by how much it does not
//   arm.setQ(q); scene.add(arm.group);  arm.flange  (Object3D)  arm.handle (the hand-guiding grip, an SDF)
//   arm.follow(targetMatrix4, dt, { lagS })  -> hand guiding: the arm follows the target with a lag and a joint-speed cap, then settles.
//
// UR DH (standard convention, from the UR support article "DH parameters for calculations of kinematics and dynamics"):
//   UR5e  d = [0.1625, 0, 0, 0.1333, 0.0997, 0.0996]  a = [0, -0.425, -0.3922, 0, 0, 0]  alpha = [pi/2, 0, 0, pi/2, -pi/2, 0]
//   UR10e d = [0.1807, 0, 0, 0.17415, 0.11985, 0.11655]  a = [0, -0.6127, -0.57155, 0, 0, 0]  same alphas
import * as THREE from 'three';
import { cylinder, moved } from './sdf.js';
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const DH = {
  UR5e: { d: [0.1625, 0, 0, 0.1333, 0.0997, 0.0996], a: [0, -0.425, -0.3922, 0, 0, 0], alpha: [Math.PI / 2, 0, 0, Math.PI / 2, -Math.PI / 2, 0], radius: [0.0535, 0.0535, 0.0435, 0.0385, 0.0385, 0.0385], reach: 0.85 },
  UR10e: { d: [0.1807, 0, 0, 0.17415, 0.11985, 0.11655], a: [0, -0.6127, -0.57155, 0, 0, 0], alpha: [Math.PI / 2, 0, 0, Math.PI / 2, -Math.PI / 2, 0], radius: [0.0765, 0.0765, 0.0605, 0.0425, 0.0425, 0.0425], reach: 1.3 },
};
const HOME = [0, -Math.PI / 2, Math.PI / 2, -Math.PI / 2, -Math.PI / 2, 0];   // the UR "home": elbow up, tool down
const LIMIT = 2 * Math.PI;                                                     // +-360 deg on every joint of the e-Series

function solve6(A, b) {   // Gaussian elimination, 6x6
  const n = 6, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; [M[i], M[p]] = [M[p], M[i]];
    const d = M[i][i] || 1e-12; for (let r = i + 1; r < n; r++) { const f = M[r][i] / d; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; } }
  const x = new Array(n).fill(0); for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c]; x[i] = s / (M[i][i] || 1e-12); } return x;
}
export class SerialArm {
  constructor(kind = 'UR5e', { paint = 0xe6e4de, cap = 0x3a6ea5, riser = 0 } = {}) {
    this.kind = kind; this.P = DH[kind]; this.q = HOME.slice(); this.qDot = new Array(6).fill(0); this.lastErr = { mm: 0, deg: 0 };
    this._T = new THREE.Matrix4(); this.group = new THREE.Group(); this.group.rotation.x = -Math.PI / 2; this.group.position.y = riser;   // the DH base frame has z up; the world has y up
    this._build(paint, cap);
    this.setQ(this.q);
  }
  // ---- kinematics
  frameMatrices(q = this.q, out = null) {
    const { d, a, alpha } = this.P, M = out || Array.from({ length: 7 }, () => new THREE.Matrix4()); M[0].identity();
    const R = new THREE.Matrix4(), T = new THREE.Matrix4();
    for (let i = 0; i < 6; i++) { M[i + 1].copy(M[i]).multiply(R.makeRotationZ(q[i])).multiply(T.makeTranslation(a[i], 0, d[i]).multiply(new THREE.Matrix4().makeRotationX(alpha[i]))); }
    // note: Rz(q) Tz(d) Tx(a) Rx(alpha): translation along z first then x. makeTranslation(a,0,d) composes the same offset (translations commute)
    return M;
  }
  fk(q = this.q) { return this.frameMatrices(q)[6]; }
  // ---- DLS pose IK (world frame of the arm base). target: Matrix4 of the flange. Returns the residual, honestly.
  // multi-start: if the first descent stalls (a local minimum or a limit), retry from the home pose and from perturbed starts; the best residual wins
  solve(target, o = {}) {
    let best = this._solve1(target, o); if (best.errMm < 0.05 && best.errDeg < 0.005) return best;
    const starts = [HOME, HOME.map((v, i) => v + (i % 2 ? 0.7 : -0.7)), HOME.map((v, i) => v + (i % 2 ? -0.9 : 0.5)), [1.0, -1.2, 1.6, -1.9, -1.4, 0.3], [-1.0, -1.9, -1.4, -0.9, 1.4, -0.3]];
    for (const q0 of starts) { const r = this._solve1(target, { ...o, q0, iters: o.iters || 60 }); if (r.errMm + r.errDeg < best.errMm + best.errDeg) best = r; if (best.errMm < 0.05 && best.errDeg < 0.005) break; }
    return best;
  }
  _solve1(target, { q0 = this.q, iters = 60, lambda = 0.05, wRot = 0.35, tol = 1e-5 } = {}) {
    const q = q0.slice(), tp = V().setFromMatrixPosition(target), tq = new THREE.Quaternion().setFromRotationMatrix(target);
    const err = (qq) => { const F = this.fk(qq), p = V().setFromMatrixPosition(F), fq = new THREE.Quaternion().setFromRotationMatrix(F);
      const dq = tq.clone().multiply(fq.clone().invert()); if (dq.w < 0) { dq.x *= -1; dq.y *= -1; dq.z *= -1; dq.w *= -1; }
      const ang = 2 * Math.acos(Math.min(1, dq.w)), s = Math.sqrt(Math.max(1e-12, 1 - dq.w * dq.w)), ax = V(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(ang);
      if (ang < 1e-6) ax.set(0, 0, 0); const e = tp.clone().sub(p); return [e.x, e.y, e.z, ax.x * wRot, ax.y * wRot, ax.z * wRot, e.length(), ang]; };
    let e = err(q), it = 0;
    for (; it < iters; it++) {
      if (e[6] < tol && e[7] < 1e-4) break;
      const J = Array.from({ length: 6 }, () => new Array(6).fill(0)), h = 1e-5;
      for (let j = 0; j < 6; j++) { const q2 = q.slice(); q2[j] += h; const e2 = err(q2); for (let i = 0; i < 6; i++) J[i][j] = -(e2[i] - e[i]) / h; }
      const A = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => { let s = 0; for (let k = 0; k < 6; k++) s += J[k][i] * J[k][j]; return s + (i === j ? lambda * lambda : 0); }));
      const g = Array.from({ length: 6 }, (_, i) => { let s = 0; for (let k = 0; k < 6; k++) s += J[k][i] * e[k]; return s; });
      const dq = solve6(A, g); let m = 0; for (const v of dq) m = Math.max(m, Math.abs(v)); const sc = m > 0.3 ? 0.3 / m : 1;
      for (let j = 0; j < 6; j++) q[j] = Math.max(-LIMIT, Math.min(LIMIT, q[j] + dq[j] * sc));
      e = err(q);
    }
    const margins = q.map(v => 1 - Math.abs(v) / LIMIT), s5 = Math.abs(Math.sin(q[4]));    // wrist singularity when joint 5 is near 0 or pi
    return { q, errMm: e[6] * 1000, errDeg: e[7] * 180 / Math.PI, iters: it, margins, minMargin: Math.min(...margins), singular: s5 < 0.08 };
  }
  setQ(q) {
    this.q = q.slice(); const M = this.frameMatrices(this.q, this._M ||= Array.from({ length: 7 }, () => new THREE.Matrix4()));
    for (let i = 0; i < 6; i++) this.joints[i].rotation.z = this.q[i];
    this.group.updateMatrixWorld(true);
  }
  get flange() { return this._flange; }
  // world <-> base frame helpers (the group carries the placement of the arm in the scene)
  toBase(Mw) { this.group.updateMatrixWorld(true); return this.group.matrixWorld.clone().invert().multiply(Mw); }
  toWorld(Mb) { this.group.updateMatrixWorld(true); return this.group.matrixWorld.clone().multiply(Mb); }
  solveWorld(Mw, o) { return this.solve(this.toBase(Mw), o); }
  followWorld(Mw, dt, o) { return this.follow(this.toBase(Mw), dt, o); }
  // hand guiding: a worker's hand leads, the arm follows with a lag and a speed cap (UR: 180 deg/s at most; hand guiding is slow), then settles
  follow(target, dt, { tau = 0.12, vmax = 1.4 } = {}) {
    const r = this.solve(target, { q0: this.q, iters: 30 }), k = 1 - Math.exp(-dt / tau), q = this.q.map((v, i) => { let d = (r.q[i] - v) * k; const m = vmax * dt; d = Math.max(-m, Math.min(m, d)); return v + d; });
    this.setQ(q); const F = this.fk(q), p = V().setFromMatrixPosition(F); this.lastErr = { mm: p.distanceTo(V().setFromMatrixPosition(target)) * 1000, ik: r };
    return this.lastErr;
  }
  // ---- the picture: drums on each joint axis, tubes along each link, a hand-guiding handle on the flange
  _build(paint, cap) {
    const P = this.P, g = this.group, mk = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.38, metalness: 0.25, ...o });
    const mp = mk(paint), mc = mk(cap, { roughness: 0.3, metalness: 0.5 }), md = mk(0x24262a, { roughness: 0.5, metalness: 0.4 }), mm = mk(0xb9bcc0, { roughness: 0.25, metalness: 0.9 });
    const cyl = (r, l, m, seg = 36) => { const x = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, seg), m); x.rotation.x = Math.PI / 2; const h = new THREE.Group(); h.add(x); x.castShadow = x.receiveShadow = true; return h; };   // along z, centred
    const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };
    const tube = (a, b, r, m) => { const dv = b.clone().sub(a), L = dv.length(), c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 28), m); c.castShadow = c.receiveShadow = true; const h = new THREE.Group(); h.add(c); h.position.copy(a).addScaledVector(dv, 0.5); h.quaternion.setFromUnitVectors(V(0, 1, 0), dv.normalize()); return h; };
    const base = cyl(P.radius[0] * 1.35, 0.03, md); base.position.z = 0.015; g.add(base);
    this.joints = []; let parent = g;
    for (let i = 0; i < 6; i++) {
      const J = new THREE.Group(); parent.add(J); this.joints.push(J);      // J rotates about its own z (the joint axis z_{i-1})
      const d = P.d[i], a = P.a[i], r = P.radius[i], al = P.alpha[i];
      // the drum on the axis (with a coloured cap ring at each end), sized to the joint
      const dl = i < 3 ? Math.max(0.1, Math.abs(d) || 0.14) * (i === 0 ? 1 : 0.9) : 0.09;
      const zc = i === 0 ? d / 2 : i === 3 ? 0.03 : 0.0;
      const drum = cyl(r * 0.96, i === 0 ? d : dl, mp); drum.position.z = i === 0 ? d / 2 : (i < 3 ? 0 : (d > 0 ? Math.min(d / 2, 0.04) : 0)); J.add(drum);
      for (const s of [-1, 1]) { const c = cyl(r * 1.02, 0.018, mc); c.position.z = (i === 0 ? (s > 0 ? d : 0.0) : drum.position.z + s * (dl / 2 + 0.004)); J.add(c); }
      // link tube from (0,0,d) to (a,0,d): the upper arm and forearm hang on the side of their drums
      if (Math.abs(a) > 1e-6) { const zoff = i === 1 ? -0.0 : 0; J.add(tube(V(0, 0, d + zoff), V(a, 0, d + zoff), r * 0.82, mp)); }
      if (i === 3 || i === 4) { const o = tube(V(0, 0, 0), V(0, 0, d), r * 0.85, mp); J.add(o); }
      // the next frame: Tz(d) Tx(a) Rx(alpha)
      const S = new THREE.Group(); S.position.set(a, 0, d); S.rotation.x = al; J.add(S); parent = S;
    }
    // the flange and the tool side: parent is the flange frame
    this._flange = parent;
    const fl = cyl(0.036, 0.012, mm); fl.position.z = 0.006; parent.add(fl);
    // hand-guiding handle (a real cobot practice, ISO 10218 / TS 15066): a bar on a bracket with enabling switches; we give it a plain, honest form
    const H = new THREE.Group(); parent.add(H); this.handleFrame = H;
    const bracket = tube(V(0, 0, 0.012), V(0.075, 0, 0.055), 0.012, md); H.add(bracket);
    const barA = V(0.075, -0.075, 0.055), barB = V(0.075, 0.075, 0.055);
    const bar = tube(barA, barB, 0.0165, mk(0x191a1c, { roughness: 0.75, metalness: 0.05 })); bar.children[0].castShadow = true; H.add(bar);
    for (const y of [-0.075, 0.075]) { const cp = new THREE.Mesh(new THREE.SphereGeometry(0.0165, 16, 12), md); cp.position.set(0.075, y, 0.055); H.add(cp); }
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.012), mk(0xd8a018, { roughness: 0.5 })); sw.position.set(0.062, 0.0, 0.066); H.add(sw);   // enabling switch
    const led = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.004, 6, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.75, 1).multiplyScalar(2.5) })); led.position.z = 0.014; parent.add(led);
    this.led = led; this.handleLocal = { a: barA, b: barB, r: 0.0165 };
  }
  // the handle bar as an SDF in the arm's base frame times the group's world matrix (moves with every solve)
  handleSDF() { this.group.updateMatrixWorld(true); const H = this.handleFrame; H.updateMatrixWorld(true); const M = H.matrixWorld.clone(); const c = cylinder(this.handleLocal.a, this.handleLocal.b, this.handleLocal.r); return moved(c, M); }
  handleFrameWorld() { this.handleFrame.updateMatrixWorld(true); return this.handleFrame.matrixWorld.clone(); }
}
