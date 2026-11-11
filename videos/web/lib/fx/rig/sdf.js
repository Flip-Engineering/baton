// RIG c1 / SDF: what a hand closes on. Small signed-distance primitives in world metres (negative = inside).
// Every object answers d(p) (signed distance to its surface) and n(p) (outward normal), so a grip can be measured
// per finger: gap = the smallest d over a finger's skin, penetration = the most negative.
//   cylinder(a, b, r)   a finite handle / rail / sledge shaft (capsule ends)      torus(c, axis, R, r)  a wheel rim
//   box(matrix, half, round)   a slab, a bar, a lever plate                       sphere(c, r)          a ball, a knob
//   union(...objs)      the nearest of several (a wheel = rim + spokes)           inflate(obj, t)        a glove's thickness
import * as THREE from 'three';
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _a = V(), _b = V(), _c = V();

function withNormal(o) {
  const e = 1e-4; o.n = (p, out = V()) => out.set(o.d(_a.copy(p).setX(p.x + e)) - o.d(_b.copy(p).setX(p.x - e)), o.d(_a.copy(p).setY(p.y + e)) - o.d(_b.copy(p).setY(p.y - e)), o.d(_a.copy(p).setZ(p.z + e)) - o.d(_b.copy(p).setZ(p.z - e))).normalize();
  return o;
}
export function cylinder(a, b, r) {
  const A = a.clone(), B = b.clone(), ab = B.clone().sub(A), L2 = ab.lengthSq();
  const o = { kind: 'cylinder', a: A, b: B, r, axis: ab.clone().normalize(), length: Math.sqrt(L2), centre: A.clone().lerp(B, 0.5),
    d(p) { const t = Math.max(0, Math.min(1, _c.copy(p).sub(A).dot(ab) / L2)); return _c.copy(A).addScaledVector(ab, t).sub(p).length() - r; },
    closest(p, out = V()) { const t = Math.max(0, Math.min(1, _c.copy(p).sub(A).dot(ab) / L2)); return out.copy(A).addScaledVector(ab, t); } };
  return withNormal(o);
}
// the torus lies in the plane through c with normal `axis`; R = the ring radius, r = the tube radius
export function torus(c, axis, R, r) {
  const C = c.clone(), N = axis.clone().normalize();
  const o = { kind: 'torus', c: C, axis: N, R, r, centre: C,
    d(p) { const q = _c.copy(p).sub(C), h = q.dot(N); const rad = q.addScaledVector(N, -h).length(); return Math.hypot(rad - R, h) - r; },
    closest(p, out = V()) { const q = _c.copy(p).sub(C); q.addScaledVector(N, -q.dot(N)); if (q.lengthSq() < 1e-12) q.set(1, 0, 0); return out.copy(C).addScaledVector(q.normalize(), R); } };
  return withNormal(o);
}
export function sphere(c, r) { const C = c.clone(); return withNormal({ kind: 'sphere', c: C, r, centre: C, d: p => p.distanceTo(C) - r, closest: (p, out = V()) => out.copy(C) }); }
// a rounded box; matrix = the box's world matrix (unit scale), half = half extents, round = edge radius
export function box(matrix, half, round = 0.0) {
  const M = matrix.clone(), inv = M.clone().invert(), h = half.clone(), q = V();
  return withNormal({ kind: 'box', M, half: h, centre: V().setFromMatrixPosition(M),
    d(p) { q.copy(p).applyMatrix4(inv); const x = Math.abs(q.x) - h.x + round, y = Math.abs(q.y) - h.y + round, z = Math.abs(q.z) - h.z + round;
      return Math.hypot(Math.max(x, 0), Math.max(y, 0), Math.max(z, 0)) + Math.min(Math.max(x, y, z), 0) - round; } });
}
export function union(...objs) {
  const o = { kind: 'union', parts: objs, centre: objs[0].centre, d(p) { let m = Infinity; for (const s of objs) m = Math.min(m, s.d(p)); return m; } };
  o.closest = (p, out = V()) => { let m = Infinity, k = objs[0]; for (const s of objs) { const d = s.d(p); if (d < m) { m = d; k = s; } } return k.closest ? k.closest(p, out) : out.copy(k.centre); };
  return withNormal(o);
}
export function inflate(obj, t) { const o = { ...obj, d: p => obj.d(p) - t, kind: obj.kind + '+' + (t * 1000).toFixed(1) + 'mm' }; return withNormal(o); }
// move a solid rigidly: d(p) = obj.d(inverse(M) p)  (a wheel that turns, a handle that the arm carries)
export function moved(obj, M) {
  const inv = M.clone().invert(), q = V(); const o = { ...obj, kind: obj.kind, d: p => obj.d(q.copy(p).applyMatrix4(inv)) };
  o.closest = (p, out = V()) => obj.closest ? obj.closest(q.copy(p).applyMatrix4(inv), out).applyMatrix4(M) : out.copy(obj.centre).applyMatrix4(M);
  o.centre = obj.centre.clone().applyMatrix4(M); return withNormal(o);
}
