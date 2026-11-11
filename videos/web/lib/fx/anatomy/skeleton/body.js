// ANATOMY / SKELETON / BODY (ANAT8-BODY, 8 Oct 2026): what the skeleton reads from a person, and the skin queries its fits and tests use.
//   const B = bodyOf(S, built, rec)    S = loadBodyStudio(); built = mix.build() output (or priorPerson(...).built); rec = the person record
//   B = { sex, age, stature, bmi, pf, J: { <rig bone>: { h, t } }, lm: { <landmark>: [x, y, z] }, pos (skin, nb verts), nb, region, measures, params }
// Frame: metres, x lateral (L = +x), y up (ground 0), z forward; the bind pose (MakeHuman's A-pose, elbows bent ~55 deg, forearms forward).
// Joints are taken where the frame fit took them, BEFORE soft tissue (mix.js: 'fat and muscle never move a joint').
export function bodyOf(S, built, rec = {}) {
  const J = {}; S.basis.bones.forEach((b, i) => { J[b.name] = { h: built.heads[i].slice(), t: built.tails[i].slice() }; });
  const nb = S.nb, pos = built.pos.subarray(0, nb * 3), lm = {};
  for (const [k, v] of Object.entries(S.landmarks)) lm[k] = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  const m = rec.measures || {};
  // field(k): the body studio's named vertex fields on hm08 ({ ix, f }; e.g. 'breastFoot', BODY7's footprint of the as-built breast), read only
  return { sex: rec.sex || (rec.params?.sex) || 'm', age: rec.age ?? rec.params?.age ?? 35, stature: built.stature, bmi: m.bmi ?? 23, pf: rec.params?.pf ?? (rec.sex === 'f' ? 0.3 : 0.2),
    J, lm, lmIdx: S.landmarks, pos, nb, tri: S.tri, region: S.region, measures: m, params: rec.params || {}, name: rec.name || '', field: k => (typeof S.field === 'function' ? S.field(k) : null) };
}
// the skin's midline (back, front) and the trunk's lateral extent by height (1 cm bins), cached on B. The trunk at a height is the run of
// vertices from the midline outward with no gap over 2.5 cm (the A-pose arms stand off the trunk below the axilla; the hero regions are skin-weight
// labels, not anatomy: the hips are 'thigh' and the lateral chest wall partly 'upper arm', so they cannot select the trunk)
export function profile(B) {
  if (B._prof) return B._prof;
  const ny = Math.ceil(B.stature * 100) + 2, back = new Float32Array(ny).fill(NaN), front = new Float32Array(ny).fill(NaN), xs = [[], []].map(() => Array.from({ length: ny }, () => []));
  const P = B.pos, HEAD = new Set([0, 11]);
  for (let v = 0; v < B.nb; v++) { if (B.region && HEAD.has(B.region[v])) continue;
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], k = Math.round(y * 100); if (k < 0 || k >= ny) continue;
    if (Math.abs(x) < 0.012) { back[k] = isNaN(back[k]) ? z : Math.min(back[k], z); front[k] = isNaN(front[k]) ? z : Math.max(front[k], z); }
    xs[x >= 0 ? 0 : 1][k].push(Math.abs(x)); }
  const lat = [0, 1].map(s => xs[s].map(a => { if (!a.length) return NaN; a.sort((p, q) => p - q); if (a[0] > 0.03) return NaN; let m = a[0]; for (let i = 1; i < a.length; i++) { if (a[i] - m > 0.025) break; m = a[i]; } return m; }));
  const at = (A, y) => { const k = Math.round(y * 100); for (let d = 0; d < 4; d++) { if (A[k - d] === A[k - d]) return A[k - d]; if (A[k + d] === A[k + d]) return A[k + d]; } return NaN; };
  const secC = new Map(), sec = y => { const k = Math.round(y * 200); if (!secC.has(k)) secC.set(k, trunkSection(B, k / 200)); return secC.get(k); };
  return (B._prof = { back: y => at(back, y), front: y => at(front, y), latBin: (y, s = 1) => at(lat[s > 0 ? 0 : 1], y), lat: (y, s = 1) => { const c = sec(y); return c ? (s > 0 ? c.x1 : -c.x0) : NaN; }, section: sec });
}
// the skin's nearest vertex distance from a point (brute force; for tests and a few fits only)
export function nearestSkin(B, p) {
  let best = Infinity, bi = -1; const P = B.pos;
  for (let v = 0; v < B.nb; v++) { const d = (P[v * 3] - p[0]) ** 2 + (P[v * 3 + 1] - p[1]) ** 2 + (P[v * 3 + 2] - p[2]) ** 2; if (d < best) { best = d; bi = v; } }
  return { d: Math.sqrt(best), v: bi };
}
// vertex normals of the skin (area-weighted), cached
export function skinNormals(B) {
  if (B._N) return B._N; const P = B.pos, T = B.tri, nb = B.nb, N = new Float32Array(nb * 3);
  for (let i = 0; i < T.length; i += 3) { const a = T[i], b = T[i + 1], c = T[i + 2]; if (a >= nb || b >= nb || c >= nb) continue;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const q of [a, b, c]) { N[q * 3] += nx; N[q * 3 + 1] += ny; N[q * 3 + 2] += nz; } }
  for (let v = 0; v < nb; v++) { const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1; N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l; }
  return (B._N = N);
}
// the skin's cross-section at height y: the closed loops of the body mesh cut by the plane, grouped into components; the trunk's lateral extent is the
// component that reaches the midline (robust where vertex bins are sparse)
export function crossSection(B, y) {
  const P = B.pos, T = B.tri, nb = B.nb, pts = new Map(), segs = [], key = (a, b) => a < b ? a * 65536 + b : b * 65536 + a;
  const cut = (a, b) => { const k = key(a, b); if (!pts.has(k)) { const ya = P[a * 3 + 1], yb = P[b * 3 + 1], t = (y - ya) / (yb - ya); pts.set(k, [P[a * 3] + t * (P[b * 3] - P[a * 3]), P[a * 3 + 2] + t * (P[b * 3 + 2] - P[a * 3 + 2])]); } return k; };
  for (let i = 0; i < T.length; i += 3) { const v = [T[i], T[i + 1], T[i + 2]]; if (v[0] >= nb || v[1] >= nb || v[2] >= nb) continue; const e = [];
    for (let q = 0; q < 3; q++) { const a = v[q], b = v[(q + 1) % 3], ya = P[a * 3 + 1] - y, yb = P[b * 3 + 1] - y; if ((ya < 0) !== (yb < 0)) e.push(cut(a, b)); }
    if (e.length === 2) segs.push(e); }
  const par = new Map(), find = k => { while (par.get(k) !== k) { par.set(k, par.get(par.get(k))); k = par.get(k); } return k; };
  for (const k of pts.keys()) par.set(k, k); for (const [a, b] of segs) { const ra = find(a), rb = find(b); if (ra !== rb) par.set(ra, rb); }
  const comp = new Map(); for (const [k, p] of pts) { const r = find(k); if (!comp.has(r)) comp.set(r, []); comp.get(r).push(p); }
  return [...comp.values()].map(ps => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of ps) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { pts: ps, x0, x1, z0, z1 }; });
}
export function trunkSection(B, y) { const C = crossSection(B, y).filter(c => c.x0 < 0.01 && c.x1 > -0.01 && c.pts.length > 8); if (!C.length) return null; C.sort((a, b) => b.pts.length - a.pts.length); return C[0]; }
// the distance from a point inside the body to the skin along a direction (Moller-Trumbore over the body triangles); Infinity if no hit
export function rayToSkin(B, o, d) {
  const P = B.pos, T = B.tri, nb = B.nb; let best = Infinity;
  for (let i = 0; i < T.length; i += 3) { const a = T[i], b = T[i + 1], c = T[i + 2]; if (a >= nb || b >= nb || c >= nb) continue;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const e1x = P[b * 3] - ax, e1y = P[b * 3 + 1] - ay, e1z = P[b * 3 + 2] - az, e2x = P[c * 3] - ax, e2y = P[c * 3 + 1] - ay, e2z = P[c * 3 + 2] - az;
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det, tx = o[0] - ax, ty = o[1] - ay, tz = o[2] - az, u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv; if (t > 0 && t < best) best = t; }
  return best;
}
// the ORAL LINING: hm08's body mesh carries the mouth's inside (vertices 694-710 ... at the pharynx wall, z 2-5 cm), which is not skin over a
// bone: the clearance and the tests skip it. A head vertex near the midline, behind the face, is interior when rays along +z, -z, +x and -x
// all meet the body again within the head (the cheeks, the lips, the back of the neck); the skin outside always escapes on one of them.
export function oralLining(B, ids = null) {
  if (B._oral) return B._oral; const P = B.pos, out = new Set(); if (!B.region) return (B._oral = out);
  const t = ids ? [ids.t_L, ids.t_R].map(v => P[v * 3 + 2]) : null, zT = t ? (t[0] + t[1]) / 2 : 0, mY = B.lm.menton ? B.lm.menton[1] - 0.01 : -1;
  // only the cavity's back (the pharynx and the soft palate, within ~4 cm of the tragions' plane) meets the column; the ray test runs on the head's triangles
  const T = B.tri, nb = B.nb, sub = []; for (let i = 0; i < T.length; i += 3) { const a = T[i], b = T[i + 1], c = T[i + 2]; if (a >= nb || b >= nb || c >= nb) continue; if (Math.max(P[a * 3 + 1], P[b * 3 + 1], P[c * 3 + 1]) > mY - 0.08) sub.push(a, b, c); }
  const BH = { pos: P, tri: sub, nb };
  for (let v = 0; v < nb; v++) { if (B.region[v] !== 0 && B.region[v] !== 11) continue; const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    if (Math.abs(x) > 0.035 || z < zT - 0.025 || z > zT + 0.045 || y < mY) continue;
    const hit = (d, lim) => rayToSkin(BH, [x + d[0] * 0.001, y + d[1] * 0.001, z + d[2] * 0.001], d) < lim;
    if (hit([0, 0, 1], 0.12) && hit([0, 0, -1], 0.15) && (hit([1, 0, 0], 0.07) || hit([-1, 0, 0], 0.07))) out.add(v); }
  // grown 6 rings over the mesh inside the same box (a ray can slip out through the mouth's opening; the lining only meets the outer skin at the
  // lips, far in front of the box)
  const inBox = v => (B.region[v] === 0 || B.region[v] === 11) && Math.abs(P[v * 3]) <= 0.035 && P[v * 3 + 2] >= zT - 0.025 && P[v * 3 + 2] <= zT + 0.045 && P[v * 3 + 1] >= mY - 0.03;
  for (let ring = 0; ring < 6; ring++) { const add = []; for (let i = 0; i < T.length; i += 3) { const tr = [T[i], T[i + 1], T[i + 2]]; if (tr.some(q => q >= nb)) continue;
      if (tr.some(q => out.has(q))) for (const q of tr) if (!out.has(q) && inBox(q)) add.push(q); } if (!add.length) break; for (const q of add) out.add(q); }
  return (B._oral = out);
}
// the skin's midline (x = 0) depth at height y from the triangles cut by the plane: { back: min z, front: max z } (NaN where none)
export function midline(B, y) {
  const P = B.pos, T = B.tri, nb = B.nb; let back = NaN, front = NaN;
  for (let i = 0; i < T.length; i += 3) { const v = [T[i], T[i + 1], T[i + 2]]; if (v[0] >= nb || v[1] >= nb || v[2] >= nb) continue; const q = [];
    for (let k = 0; k < 3; k++) { const a = v[k], b = v[(k + 1) % 3], ya = P[a * 3 + 1] - y, yb = P[b * 3 + 1] - y; if ((ya < 0) !== (yb < 0)) { const t = ya / (ya - yb); q.push([P[a * 3] + t * (P[b * 3] - P[a * 3]), P[a * 3 + 2] + t * (P[b * 3 + 2] - P[a * 3 + 2])]); } }
    if (q.length !== 2 || (q[0][0] < 0) === (q[1][0] < 0)) continue; const t = q[0][0] / (q[0][0] - q[1][0]), z = q[0][1] + t * (q[1][1] - q[0][1]);
    if (Math.abs(z) > 0.4) continue; back = back === back ? Math.min(back, z) : z; front = front === front ? Math.max(front, z) : z; }
  return { back, front };
}
