// RIG / BALANCE (HUMAN studio, cycle 5): centre of mass, support polygon, weight shift and counter-lean against a load.
// Segment masses are Dempster's fractions (as tabulated by Winter, Biomechanics and Motor Control of Human Movement).
//   com(P, mass)            centre of mass of a posed skeleton from segment endpoints
//   supportPolygon(pts)     convex hull (xz) of the contact points: the planted feet, plus hands on fixed supports
//   inside(poly, p)         signed distance of p to the hull (negative inside), in metres
//   leanAngle(loadKg, bodyKg)   tan(theta) = load / body: the angle a body leans back to hold a horizontal pull
// HUMAN c8 lane F (opt-in; every default is the Dempster table above, so existing callers do not move):
//   com(P, out, segs)           segs: any table in this format, e.g. DELEVA.f / DELEVA.m (de Leva 1996, sex-specific) or a person's own
//                               (rig/person_kin.js kinSegments(kin): lane A's voxel masses, with the trunk's off-axis COM as a 6th element)
//   segmentsOf(h, { sex })      the table a hero carries: its kin's, else de Leva by sex when asked, else Dempster
//   inertia(P, segs, mass, rg)  whole-body inertia tensor about the COM (kg m^2, world axes) from segment radii of gyration
// A body is balanced when the COM projects inside the support. The rig moves the pelvis (and tilts the pelvis and shoulders)
// to put it there, and leans against a load: counter-lean is not decoration, it is what makes a pull read as a pull.
import * as THREE from 'three';

// segments: [name, joint a, joint b, mass fraction, com along a->b]
export const SEGMENTS = [
  ['head', 'neck', 'headTop', 0.081, 0.5], ['trunk', 'hips', 'shoulderMid', 0.497, 0.5],
  ['uarmL', 'shL', 'elL', 0.028, 0.436], ['farmL', 'elL', 'wrL', 0.016, 0.43], ['handL', 'wrL', 'fiL', 0.006, 0.5],
  ['uarmR', 'shR', 'elR', 0.028, 0.436], ['farmR', 'elR', 'wrR', 0.016, 0.43], ['handR', 'wrR', 'fiR', 0.006, 0.5],
  ['thighL', 'hipL', 'knL', 0.1, 0.433], ['shinL', 'knL', 'anL', 0.0465, 0.433], ['footL', 'anL', 'toL', 0.0145, 0.5],
  ['thighR', 'hipR', 'knR', 0.1, 0.433], ['shinR', 'knR', 'anR', 0.0465, 0.433], ['footR', 'anR', 'toR', 0.0145, 0.5],
];
// de Leva 1996 (J Biomech 29:1223; Zatsiorsky-Seluyanov adjusted), women's and men's tables, mapped onto this file's endpoints: the head
// from the neck (C7) to the vertex (de Leva's VERT-CERV head, COM measured from the vertex, so 1 - cm here); the trunk from the hips'
// centre to the shoulders' (de Leva's SUPR-MIDH trunk, 1 - cm: the suprasternale sits within ~3 cm of the shoulders' centre height);
// the limbs on the same joint centres; the hand WJC-MET3; the foot from the ankle to the toe tip (de Leva measures it heel to toe:
// 0.42 is our mapping, the foot is 1.3 % of the mass). Fourth column the mass fraction, fifth the COM along a -> b.
export const DELEVA = {
  f: [['head', 'neck', 'headTop', 0.0668, 0.5159], ['trunk', 'hips', 'shoulderMid', 0.4257, 0.5849],
    ['uarmL', 'shL', 'elL', 0.0255, 0.5754], ['farmL', 'elL', 'wrL', 0.0138, 0.4559], ['handL', 'wrL', 'fiL', 0.0056, 0.7474],
    ['uarmR', 'shR', 'elR', 0.0255, 0.5754], ['farmR', 'elR', 'wrR', 0.0138, 0.4559], ['handR', 'wrR', 'fiR', 0.0056, 0.7474],
    ['thighL', 'hipL', 'knL', 0.1478, 0.3612], ['shinL', 'knL', 'anL', 0.0481, 0.4352], ['footL', 'anL', 'toL', 0.0129, 0.42],
    ['thighR', 'hipR', 'knR', 0.1478, 0.3612], ['shinR', 'knR', 'anR', 0.0481, 0.4352], ['footR', 'anR', 'toR', 0.0129, 0.42]],
  m: [['head', 'neck', 'headTop', 0.0694, 0.4998], ['trunk', 'hips', 'shoulderMid', 0.4346, 0.5514],
    ['uarmL', 'shL', 'elL', 0.0271, 0.5772], ['farmL', 'elL', 'wrL', 0.0162, 0.4574], ['handL', 'wrL', 'fiL', 0.0061, 0.79],
    ['uarmR', 'shR', 'elR', 0.0271, 0.5772], ['farmR', 'elR', 'wrR', 0.0162, 0.4574], ['handR', 'wrR', 'fiR', 0.0061, 0.79],
    ['thighL', 'hipL', 'knL', 0.1416, 0.4095], ['shinL', 'knL', 'anL', 0.0433, 0.4395], ['footL', 'anL', 'toL', 0.0137, 0.42],
    ['thighR', 'hipR', 'knR', 0.1416, 0.4095], ['shinR', 'knR', 'anR', 0.0433, 0.4395], ['footR', 'anR', 'toR', 0.0137, 0.42]],
};
// de Leva's radii of gyration [sagittal, transverse, longitudinal] / segment length, by segment kind (for inertia())
export const DELEVA_RG = {
  f: { head: [0.271, 0.295, 0.261], trunk: [0.357, 0.339, 0.171], uarm: [0.278, 0.26, 0.148], farm: [0.261, 0.257, 0.094], hand: [0.531, 0.454, 0.335], thigh: [0.369, 0.364, 0.162], shin: [0.267, 0.263, 0.092], foot: [0.299, 0.279, 0.139] },
  m: { head: [0.303, 0.315, 0.261], trunk: [0.372, 0.347, 0.191], uarm: [0.285, 0.269, 0.158], farm: [0.276, 0.265, 0.121], hand: [0.628, 0.513, 0.401], thigh: [0.329, 0.329, 0.149], shin: [0.251, 0.246, 0.102], foot: [0.257, 0.245, 0.124] },
};
// a segment's optional 6th element: an off-axis COM { lat, fwd, ref: [jointA, jointB] } as fractions of the segment's length, in the
// frame of the segment's axis and the line ref A -> B (the trunk's: hipR -> hipL, so lat + = her left, fwd + = forward): a belly, a bump
const _ax = new THREE.Vector3(), _l = new THREE.Vector3(), _f = new THREE.Vector3();
function offAxis(P, a, b, o, out) {
  const A = P[a], B = P[b], R0 = P[o.ref[0]], R1 = P[o.ref[1]]; if (!R0 || !R1) return out.set(0, 0, 0);
  _ax.subVectors(B, A); const L = _ax.length(); if (L < 1e-9) return out.set(0, 0, 0); _ax.multiplyScalar(1 / L);
  _l.subVectors(R1, R0); _l.addScaledVector(_ax, -_l.dot(_ax)); if (_l.lengthSq() < 1e-12) return out.set(0, 0, 0); _l.normalize();
  _f.crossVectors(_l, _ax);
  return out.copy(_l).multiplyScalar((o.lat || 0) * L).addScaledVector(_f, (o.fwd || 0) * L);
}
const _o = new THREE.Vector3();
export function com(P, out = new THREE.Vector3(), segs = SEGMENTS) {
  out.set(0, 0, 0); let m = 0;
  for (const s of segs) { const [, a, b, w, f] = s; if (!P[a] || !P[b]) continue; out.x += w * (P[a].x + (P[b].x - P[a].x) * f); out.y += w * (P[a].y + (P[b].y - P[a].y) * f); out.z += w * (P[a].z + (P[b].z - P[a].z) * f); m += w;
    if (s[5]) { offAxis(P, a, b, s[5], _o); out.addScaledVector(_o, w); } }
  return m ? out.multiplyScalar(1 / m) : out;
}
// the table a hero carries: a person's own (h.meta.kin, through rig/person_kin.js) when `kin` is passed or the hero has one and asks,
// de Leva by sex when { sex } is given, else Dempster (the default everywhere: nothing changes unless a caller asks)
export function segmentsOf(h, { sex = null, kin = null } = {}) {
  if (kin && kin.balanceSegments) return kin._segs || kin.balanceSegments;
  if (sex && DELEVA[sex]) return DELEVA[sex];
  return SEGMENTS;
}
// whole-body inertia about the COM (kg m^2, world axes): each segment a body of revolution about its axis with radii of gyration
// rg[kind] = [sagittal, transverse, longitudinal] x its length (the two transverse radii averaged: the frame's roll is unknown here),
// plus the parallel-axis term. mass: the body's kg (the table's fractions x mass).
export function inertia(P, segs, mass, rg, out = null) {
  const C = com(P, new THREE.Vector3(), segs), I = out || [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const r of I) r.fill(0);
  const c = new THREE.Vector3(), a = new THREE.Vector3(), o = new THREE.Vector3();
  for (const s of segs) { const [nm, A, B, w, f] = s; if (!P[A] || !P[B]) continue; const kind = nm.replace(/[LR]$/, ''), r = rg[kind]; if (!r) continue;
    a.subVectors(P[B], P[A]); const L = a.length(); if (L < 1e-9) continue; a.multiplyScalar(1 / L);
    c.copy(P[A]).addScaledVector(a, f * L); if (s[5]) c.add(offAxis(P, A, B, s[5], o));
    const m = w * mass, kt = m * (((r[0] + r[1]) / 2) * L) ** 2, kl = m * (r[2] * L) ** 2, d = c.clone().sub(C), d2 = d.lengthSq(), av = [a.x, a.y, a.z], dv = [d.x, d.y, d.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[i][j] += kt * ((i === j ? 1 : 0) - av[i] * av[j]) + kl * av[i] * av[j] + m * ((i === j ? d2 : 0) - dv[i] * dv[j]); }
  return I;
}
export function supportPolygon(pts) {           // Andrew's monotone chain on (x, z); returns [[x, z], ...] counter-clockwise
  const p = pts.map(v => [v.x, v.z]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
export function insideDist(poly, x, z) {        // < 0 inside, > 0 outside (metres to the nearest edge)
  const n = poly.length; if (n === 0) return 1;
  if (n === 1) return Math.hypot(x - poly[0][0], z - poly[0][1]);
  let inside = n >= 3, best = Infinity;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1e-9;
    const u = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / l2)), d = Math.hypot(x - a[0] - ex * u, z - a[1] - ez * u);
    best = Math.min(best, d); if (n >= 3 && (ex * (z - a[1]) - ez * (x - a[0])) < 0) inside = false;
  }
  return inside ? -best : best;
}
export function centroid(poly) { if (!poly.length) return [0, 0]; let x = 0, z = 0; for (const p of poly) { x += p[0]; z += p[1]; } return [x / poly.length, z / poly.length]; }
export const leanAngle = (loadKg, bodyKg = 75, max = 0.55) => Math.min(max, Math.atan2(loadKg, bodyKg));
