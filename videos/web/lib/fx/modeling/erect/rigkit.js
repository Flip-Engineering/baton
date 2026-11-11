// ERECT rigkit (MODELING c4): weight for a building-sized machine. IK on its own joints, feet that stay where they are put,
// the centre of gravity kept over what holds it up, and keyed timelines that move at the pace of something 50 m tall.
//
// Why: the c3 giant had no idea where its weight was. Its carry pose put the hands at chest height holding nothing with the whole
// mass ahead of the feet, and its 7 s step was a human step slowed down. Here:
//   - a limb is solved by two-bone IK to a target, the knee (or elbow) toward a pole: legs follow FEET, not angles;
//   - a foot is { p: toe-pad ground point [x, z], phi: heel lift (deg), lift: m off the ground, yaw }: the same four numbers say
//     flat-footed, up on the toes (the trailing foot of a kneel), and swinging through a step;
//   - balance() moves the root until the centre of mass (segment masses + any load) projects onto a target point: over the planted
//     foot, between the feet, or ahead of them only while something else (a knee, a hand) is on the ground;
//   - Keyed: poses at times, eased in and out, interpolated field by field (arrays included); a contact key can be held.
// Pace: a pendulum's period goes as sqrt(length). A 50 m body's leg is ~16x a person's, so its natural movements take ~4x as long
// (a 0.9 s human step is ~3.5 s; standing up from a kneel, ~1.4 s for a person, is ~5.5 s).
import * as THREE from 'three';
import { DIM } from './erector.js';

const d2r = Math.PI / 180, V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
export function worldQ(o, out = new THREE.Quaternion()) { o.updateWorldMatrix(true, false); return o.getWorldQuaternion(out); }
export function setWorldQ(o, q) { const pq = o.parent ? worldQ(o.parent, new THREE.Quaternion()) : new THREE.Quaternion(); o.quaternion.copy(pq.invert().multiply(q)); o.updateMatrixWorld(true); }
export function eulerQ(deg, order = 'YXZ') { return new THREE.Quaternion().setFromEuler(new THREE.Euler(deg[0] * d2r, (deg[1] || 0) * d2r, (deg[2] || 0) * d2r, order)); }

// two-bone IK: upper's child `mid` sits at its local -y, `end` at mid's local -y; the hinge at mid is about its local x.
// pole: world direction the joint should point (knee: forward; elbow: back). Returns the miss (m).
export function solveLimb(upper, mid, end, target, pole) {
  upper.updateWorldMatrix(true, true);
  const a = upper.getWorldPosition(V3()), l1 = mid.position.length(), l2 = end.position.length();
  const toT = target.clone().sub(a), dRaw = toT.length(), d = clamp(dRaw, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3), u = toT.normalize();
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  let v = pole.clone().addScaledVector(u, -pole.dot(u)); if (v.lengthSq() < 1e-8) v = V3(0, 0, 1).addScaledVector(u, -u.z); v.normalize();
  const b = a.clone().addScaledVector(u, l1 * cosA).addScaledVector(v, l1 * sinA);
  // upper: local -y along a->b, local z toward the pole side
  const y = a.clone().sub(b).normalize(); let z = v.clone().addScaledVector(y, -v.dot(y)); if (z.lengthSq() < 1e-8) z = pole.clone().addScaledVector(y, -pole.dot(y)); z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize(); z.crossVectors(x, y);
  setWorldQ(upper, new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(x, y, z)));
  // mid: hinge about local x so its -y points at the target
  const c = a.clone().addScaledVector(u, d), s = c.clone().sub(b).normalize();
  const sl = s.applyQuaternion(worldQ(upper, _q).invert());
  mid.quaternion.setFromAxisAngle(V3(1, 0, 0), Math.atan2(-sl.z, -sl.y)); mid.updateMatrixWorld(true);
  return Math.max(0, dRaw - d);
}
// a pose: { root: { p: [x, y, z], r: [pitch, yaw, roll] }, waist: [pitch, yaw, roll], chest: [...], beam?: no,
//           legs: { L: foot, R: foot }, kneePole: [x, y, z] (base frame),
//           arms: { L: { fk: { sh: [..], el: [..], wr: [..] } } | { ik: [x, y, z] (wrist, base frame), pole: [..], hand: [pitch, yaw, roll] (world) } },
//           curl: { L, R } | { L: { c, thumb } } }
export function applyPose(E, P) {
  const J = E.J, base = E.g;
  base.updateMatrixWorld(true); const B = base.matrixWorld, BQ = worldQ(base);
  for (const k in J) if (E.restQ?.[k]) J[k].quaternion.copy(E.restQ[k]);
  const r = P.root || {}; J.root.position.set(r.p?.[0] ?? 0, r.p?.[1] ?? E.rootY, r.p?.[2] ?? 0); J.root.quaternion.copy(eulerQ(r.r || [0, 0, 0]));
  if (P.waist) J.waist.quaternion.copy(eulerQ(P.waist)); if (P.chest) J.chest.quaternion.copy(eulerQ(P.chest));
  base.updateMatrixWorld(true);
  const rep = { miss: {} };
  for (const L of ['L', 'R']) {
    const f = P.legs?.[L]; if (!f) continue;
    const ft = footTargetW(E, f), pole = P.kneePole ? V3(...P.kneePole).applyQuaternion(BQ) : V3(0, 0, 1).applyQuaternion(BQ).applyQuaternion(J.root.quaternion);
    if (f.kneeOut) pole.add(V3((L === 'L' ? 1 : -1) * f.kneeOut, 0, 0).applyQuaternion(BQ)).normalize();
    rep.miss['leg' + L] = solveLimb(J['hp' + L], J['kn' + L], J['an' + L], ft.ankle, pole);
    setWorldQ(J['an' + L], ft.q); J['to' + L].quaternion.copy(ft.toeQ); J['to' + L].updateMatrixWorld(true);
  }
  for (const L of ['L', 'R']) {
    const a = P.arms?.[L]; if (!a) continue; const s = L === 'L' ? 1 : -1;
    if (a.fk) { for (const k of ['sh', 'el', 'wr']) if (a.fk[k]) J[k + L].quaternion.copy(eulerQ(a.fk[k])); J['sh' + L].updateMatrixWorld(true); }
    else if (a.ik) {
      const tgt = V3(...a.ik).applyMatrix4(B), pole = V3(...(a.pole || [s * .5, 0, -1])).applyQuaternion(BQ).normalize();
      rep.miss['arm' + L] = solveLimb(J['sh' + L], J['el' + L], J['wr' + L], tgt, pole);
    }
    if (a.hand) setWorldQ(J['wr' + L], BQ.clone().multiply(a.handQ || eulerQ(a.hand)));
    else if (a.wr) J['wr' + L].quaternion.copy(eulerQ(a.wr));
  }
  if (P.curl) for (const L of ['L', 'R']) { const c = P.curl[L]; if (c == null) continue; if (typeof c === 'number') E.curl(L, c); else E.curl(L, c.c, { thumb: c.thumb, spread: c.spread || 0 }); }
  base.updateMatrixWorld(true); E.update(); E.lastPose = P; E.rep = rep;
  return rep;
}
export function footTargetW(E, f) {
  const base = E.g; base.updateMatrixWorld(true);
  const yaw = (f.yaw || 0) * d2r, phi = (f.phi || 0) * d2r, lift = f.lift || 0, toeH = DIM.ankleH + DIM.toe[1];
  const q = new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), yaw).multiply(new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), phi + (f.roll ? 0 : 0)));
  if (f.pitchExtra) q.multiply(new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), f.pitchExtra * d2r));
  const H = V3(f.p[0], toeH + lift, f.p[1]);
  const ankle = H.clone().add(V3(-DIM.toe[0], -DIM.toe[1], -DIM.toe[2]).applyQuaternion(q)).applyMatrix4(base.matrixWorld);
  const toeBend = f.toe != null ? f.toe : -(f.phi || 0) * (1 - clamp(lift / 2.5));
  return { ankle, q: worldQ(base).multiply(q), toeQ: new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), toeBend * d2r) };
}
// the soles' corner points on the ground for a foot (for the support polygon), in the base frame; only if it is down
export function soleCorners(f, { tol = .25 } = {}) {
  if ((f.lift || 0) > tol) return [];
  const yaw = (f.yaw || 0) * d2r, cs = Math.cos(yaw), sn = Math.sin(yaw), W = DIM.footW / 2, pts = [];
  const at = (x, z) => [f.p[0] + x * cs + z * sn, f.p[1] - x * sn + z * cs];
  if ((f.phi || 0) > 4) { for (const x of [-W, W]) for (const z of [-.4, 4.0]) pts.push(at(x, z)); }          // up on the toe: only the toe pad
  else { for (const x of [-W, W]) for (const z of [-9.0, 4.0]) pts.push(at(x, z)); }                         // flat: heel to toe
  return pts;
}
// convex hull (x, z) and the signed distance of a point to it (positive inside)
export function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
export function insideDist(H, x, z) {
  if (H.length < 3) return -1e9; let best = 1e9;
  for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1; const d = ((x - a[0]) * ez - (z - a[1]) * ex) / L; best = Math.min(best, -d); }
  return best;
}
// balance: move the root (x, z) until the COM projects onto `target` ([x, z] in the base frame, or 'feet' for the support centre)
export function balance(E, P, { target = 'feet', load = null, iters = 5, gain = 1, extra = [] } = {}) {
  const pts = []; for (const L of ['L', 'R']) if (P.legs?.[L]) pts.push(...soleCorners(P.legs[L])); pts.push(...extra);
  const H = hull(pts); let tx, tz;
  if (target === 'feet') { tx = H.reduce((a, p) => a + p[0], 0) / H.length; tz = H.reduce((a, p) => a + p[1], 0) / H.length; } else [tx, tz] = target;
  const inv = new THREE.Matrix4();
  let c = null;
  for (let i = 0; i < iters; i++) {
    applyPose(E, P); c = E.com(load ? { p: load.p(), t: load.t } : null); inv.copy(E.g.matrixWorld).invert(); const cl = c.clone().applyMatrix4(inv);
    const dx = tx - cl.x, dz = tz - cl.z; if (Math.hypot(dx, dz) < .02) break;
    P.root = P.root || {}; P.root.p = [(P.root.p?.[0] ?? 0) + dx * gain, P.root.p?.[1] ?? E.rootY, (P.root.p?.[2] ?? 0) + dz * gain];
  }
  applyPose(E, P); c = E.com(load ? { p: load.p(), t: load.t } : null); const cl = c.clone().applyMatrix4(inv.copy(E.g.matrixWorld).invert());
  return { com: cl, hull: H, margin: insideDist(H, cl.x, cl.z), target: [tx, tz] };
}
// ------------------------------------------------------------------------------------------------ keyed timelines
const ease = { inout: t => t * t * (3 - 2 * t), in: t => t * t, out: t => 1 - (1 - t) * (1 - t), lin: t => t, hold: t => 0, heavy: t => { const e = t * t * t * (t * (6 * t - 15) + 10); return e; } };
function mix(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => mix(v, b[i], t));
  if (a && b && typeof a === 'object' && typeof b === 'object') { const o = {}; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) o[k] = k in a && k in b ? mix(a[k], b[k], t) : (t < .5 ? a[k] ?? b[k] : b[k] ?? a[k]); return o; }
  return t < .5 ? a : b;
}
export class Keyed {
  // keys: [{ t, pose, ease: 'inout' }] (the ease belongs to the segment that ENDS at the key)
  constructor(keys) { this.keys = keys.slice().sort((a, b) => a.t - b.t); }
  at(t) {
    const K = this.keys; if (t <= K[0].t) return structuredClone(K[0].pose); if (t >= K[K.length - 1].t) return structuredClone(K[K.length - 1].pose);
    let i = 0; while (K[i + 1].t < t) i++; const a = K[i], b = K[i + 1], u = (t - a.t) / (b.t - a.t), e = (ease[b.ease || 'inout'] || ease.inout)(u);
    return mix(structuredClone(a.pose), structuredClone(b.pose), e);
  }
}
export { mix as mixPose };
