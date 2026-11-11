// ANAT8-HEAD (it3, 8 Oct): helpers for the layers above the bone. Units: mm in the craniometric frame (skull/frame.js: origin the porion
// midpoint, y up normal to the Frankfurt horizontal, x the person's left, z forward). The bone is a SAMPLED field (layer/grid.js
// sampleField of the skull's SDF, h ~1.5 mm, exact within its band): every layer above it reads the bone's distance there, once a point.
import * as D from '../layer/sdf.js';
export const { v3 } = D;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const LBL = { cranium: 1, face: 2, mandible: 3, teeth: 4, hyoid: 5, muscle: 6, deepFat: 7, supFat: 8, globe: 9, cartilage: 10, skin: 11, gland: 12 };
export const LBL_NAME = { 1: 'cranium', 2: 'facial skeleton', 3: 'mandible', 4: 'teeth', 5: 'hyoid', 6: 'muscle', 7: 'deep fat', 8: 'superficial fat', 9: 'globe', 10: 'cartilage', 11: 'skin', 12: 'gland' };
// the bone's normal at p (unit, outward) and p moved onto the bone's surface then lifted `lift` mm along that normal
export function boneNormal(G, p) { return G.grad(p[0], p[1], p[2], [0, 0, 0], 0.6); }
export function onBone(G, p, lift = 0, iters = 8) { let q = p.slice(); const g = [0, 0, 0];
  for (let i = 0; i < iters; i++) { const d = G.value(q[0], q[1], q[2]); if (Math.abs(d) < 0.02) break; G.grad(q[0], q[1], q[2], g, 0.6); q = [q[0] - d * g[0], q[1] - d * g[1], q[2] - d * g[2]]; }
  G.grad(q[0], q[1], q[2], g, 0.6); return [q[0] + lift * g[0], q[1] + lift * g[1], q[2] + lift * g[2]]; }
// the first bone surface met from p0 along dir (unit): the sampled field marched (null if none within maxT)
export function hitBone(G, p0, dir, maxT = 160) { let t = 0; for (let i = 0; i < 400 && t < maxT; i++) { const d = G.value(p0[0] + dir[0] * t, p0[1] + dir[1] * t, p0[2] + dir[2] * t); if (d < 0.03) return [p0[0] + dir[0] * t, p0[1] + dir[1] * t, p0[2] + dir[2] * t]; t += Math.max(d * 0.85, 0.05); } return null; }
// smooth compact falloff over an oriented ellipsoid: 1 inside 0.45 of its radii, 0 at its radii (a 'bump' weight)
export function blob(c, r, basis = null) { const [U, V, W] = basis || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return p => { const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], u = (d[0] * U[0] + d[1] * U[1] + d[2] * U[2]) / r[0], v = (d[0] * V[0] + d[1] * V[1] + d[2] * V[2]) / r[1], w = (d[0] * W[0] + d[1] * W[1] + d[2] * W[2]) / r[2];
    const e = Math.sqrt(u * u + v * v + w * w); return e >= 1 ? 0 : sstep(1, 0.45, e); }; }
// a capsule-shaped falloff between a and b of radius r (the same profile)
export function capw(a, b, r) { const ab = v3.sub(b, a), l2 = v3.dot(ab, ab) || 1; return p => { const t = clamp(v3.dot(v3.sub(p, a), ab) / l2, 0, 1), q = v3.add(a, v3.mul(ab, t)), e = v3.dist(p, q) / r; return e >= 1 ? 0 : sstep(1, 0.45, e); }; }
// distance from p to a polyline and the closest point
export function polyClosest(p, pts) { let best = { d: Infinity, c: pts[0], t: 0 }; for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1], ab = v3.sub(b, a), t = clamp(v3.dot(v3.sub(p, a), ab) / (v3.dot(ab, ab) || 1), 0, 1), c = v3.add(a, v3.mul(ab, t)), d = v3.dist(p, c); if (d < best.d) best = { d, c, t: (i + t) / (pts.length - 1) }; } return best; }
// a SHELL over the bone: the solid between gap and gap + T(p) mm from the bone (the bone's distance read from the sampled field G), cut to
// a region (mask(p) <= 0, a distance-like function; k the edge's rounding). The form of every muscle or fat layer that lies ON the bone
// (frontalis, temporalis, masseter, procerus, the deep fat pads): it follows the bone's own surface, and bridges a gap narrower than its
// thickness (the masseter across the sigmoid notch). bone: an optional other field to lie on (e.g. bone and globe)
export function shell(G, T, gap, mask, aabb, o = {}) { const k = o.k ?? 1.5, field = o.on || G, Tf = typeof T === 'number' ? () => T : T, gf = typeof gap === 'number' ? () => gap : gap;
  return D.custom((x, y, z) => { const p = [x, y, z], t = Tf(p), db = field.value(x, y, z); if (t <= 0.05) return Math.max(1, D.smax(db - gf(p), mask(p), k)); const c = gf(p) + t / 2; return D.smax(Math.abs(db - c) - t / 2, mask(p), k); },
    aabb, { ...o, kind: 'shell' }); }
// a prism mask from a 2-D polygon in two of the coordinates (axes 'xy', 'yz', 'xz'), optionally clipped by a half-space on the third
export function prism(poly, axes = 'xy', clip = null) { const R = D.regionPoly(poly), ia = 'xyz'.indexOf(axes[0]), ib = 'xyz'.indexOf(axes[1]);
  return p => { const r = R(p[ia], p[ib]); return clip ? D.smax(r, clip(p), 1) : r; }; }
// the box of points padded
export function boxOf(pts, pad) { const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (const p of pts) for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], p[a] - pad); b[a + 3] = Math.max(b[a + 3], p[a] + pad); } return b; }
export const mirrorBox = b => [-b[3], b[1], b[2], -b[0], b[4], b[5]];
export const f1 = x => +(+x).toFixed(1), f2 = x => +(+x).toFixed(2), r1 = p => p.map(f1);
