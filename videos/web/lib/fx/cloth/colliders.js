// COLLIDERS (CLOTHINT, round 7, 8 Oct 2026): our people as colliders for a drape. `peopleColliders(P)` gives capsules and spheres fitted to
// a makePerson person's own body, in main's collider format (lib/fx/cloth.js: { s: 'capsule', a, b, r } | { s: 'sphere', c, r }), so
// main's Cloth and the studio's Drape (drape_sheet.js) both drape over OUR people's real bodies. Pure JS (no three import, no GL): the
// same in node and the browser. The person carries it: `await P.colliders(opts)` / `await P.clothMesh(opts)` (person/v7.js), or import it directly:
//
//   import { peopleColliders } from '../lib/fx/cloth/colliders.js';
//   const P = await makePerson('L14_f42_black', { studio, wear: 'bare' });           // or a Hero (P.h)
//   const C = [...peopleColliders(P), { s: 'box', min: [...], max: [...] }, { s: 'floor', y: 0 }];
//   cloth.settle(3, C);                                                               // any frame: call again after posing / moving P
//
// How the fit works (guidance, with the reasons):
//  * RADII COME FROM THE BODY'S OWN VERTICES, in the BIND pose, so the fit does not depend on how the person is posed when it is made:
//    for a limb, the distance of the region's vertices (upper arm, forearm, thigh, shin) to the bone axis, the `q`-quantile (default 0.88,
//    a cover that the skin rarely leaves; 1.0 would be the envelope, 0.5 the median and would let skin poke through) per sub-capsule of
//    about `step` (7 cm) along the bone, so a thigh that tapers is a chain of capsules that taper (main's format has one radius per capsule).
//  * THE TRUNK, NECK, HEAD, HANDS AND FEET ARE STADIUM SECTIONS, not circles: slices across the part, each the body's cross-section fitted by
//    its principal axes (a chest is 34 x 22 cm; one round capsule would float a sheet 6 cm above the sternum). A slice is a capsule whose
//    axis runs across the part (the major axis of the section) with the radius of half its depth; thin parts (a hand 2.5 cm thick, a foot)
//    come out flat, a head comes out long front to back. Slices are `slice` (4.5 cm) apart: consecutive stadiums leave scallops of ~0.3 mm.
//  * EVERY CAPSULE IS CARRIED BY ONE BONE: its end points are stored in that bone's bind frame, so the call after a pose is a matrix
//    multiply per end point (about 70 capsules, ~0.1 ms), and a moving or posed person is followed by the skeleton, not refit.
//  * `proud` (default 3 mm) is added to every radius: main's note, "set a little proud of the skin so no skin pokes through". The cloth then
//    sits `proud + thick` (main's thick, 12 mm) off the fitted surface; for a tight drape pass proud ~1.5 mm and thick ~4 mm.
// What it cannot do (honest): a capsule union is smooth where a body is not. Breasts, a belly's fold, the groin, the ribs and the nose are
// inside or between capsules; a stiff sheet bridges over hollows (as real cloth does), but a soft one hangs into them only as far as the
// capsules let it. The gap and poke-through of the fit against the body's own mesh are measured by `fitGap(P, list)` below.
const Q = (a, q) => { if (!a.length) return 0; const s = Float64Array.from(a).sort(); const f = Math.min(s.length - 1, Math.max(0, q * (s.length - 1))), i = Math.floor(f), u = f - i; return s[i] + (s[Math.min(s.length - 1, i + 1)] - s[i]) * u; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]), unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const COLLIDERS_VERSION = 1;
const RG = { head: 0, neck: 1, torso: 2, uarm: 3, farm: 4, hand: 5, finger: 6, pelvis: 7, thigh: 8, shin: 9, foot: 10, jaw: 11 };
const DEF = { proud: 0.003, q: 0.88, step: 0.07, slice: 0.045, trim: 0.02, limb: 'stadium', tips: false };   // tips (opt-in): hands and feet run on to the farthest vertex, not to the end joint (the longest toe passes `toe3-3`: iteration 1's sheet let four toe tips through)
const heroOf = P => (P && P.h && P.h.skeleton ? P.h : P && P.skeleton && P.body ? P : null);

// ---------------------------------------------------------------- the fit (bind pose, once per hero and option set)
const FITS = new WeakMap();
export function fitPerson(P, o = {}) {
  const h = heroOf(P); if (!h) throw new Error('peopleColliders: a makePerson person (P.h) or a Hero');
  const O = { ...DEF, ...o }, key = JSON.stringify([O.proud, O.q, O.step, O.slice, O.trim, O.limb, O.only || null, O.tips]);
  let m = FITS.get(h); if (!m) FITS.set(h, m = new Map()); if (m.has(key)) return m.get(key);
  const g = h.body.geometry, pos = g.attributes.position.array, AH = g.attributes.aHero.array, n = pos.length / 3;
  const J = k => { const v = h.head0[h.idx[k]]; return [v.x, v.y, v.z]; }, T = k => { const v = h.tail0[h.idx[k]]; return [v.x, v.y, v.z]; };
  const BI = h.skeleton.boneInverses, local = (bone, p) => { const e = BI[h.idx[bone]].elements; return [e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12], e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13], e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14]]; };
  const caps = [], want = k => !O.only || O.only.includes(k);
  const V = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const byRegion = (...rs) => { const out = []; for (let i = 0; i < n; i++) if (rs.includes(AH[i * 4])) out.push(i); return out; };
  const push = (tag, bone, a, b, r) => { if (!bone || h.idx[bone] == null) return; const sph = len(sub(a, b)) < 2e-4;
    caps.push({ tag, bone, a: local(bone, a), b: local(bone, b), r: r + O.proud, sphere: sph, bindA: a, bindB: b }); };
  // a chain of round capsules along A -> B from the vertices `ids` (those within the segment's axial range), radius = quantile of the axis distance
  const chain = (tag, bone, A, B, ids) => {
    const d = unit(sub(B, A)), L = len(sub(B, A)), ns = Math.max(1, Math.round(L / O.step)), us = new Float64Array(ids.length), ds = new Float64Array(ids.length);
    for (let k = 0; k < ids.length; k++) { const p = sub(V(ids[k]), A), u = dot(p, d); us[k] = u / L; const q = sub(p, mul(d, u)); ds[k] = len(q); }
    let last = null;
    for (let s = 0; s < ns; s++) { const u0 = s / ns, u1 = (s + 1) / ns, pad = 0.18 / ns, R = []; for (let k = 0; k < ids.length; k++) if (us[k] >= u0 - pad && us[k] <= u1 + pad) R.push(ds[k]);
      const r = R.length >= 6 ? Q(R, O.q) : last; if (r == null) continue; last = r; push(tag, bone, add(A, mul(d, L * u0)), add(A, mul(d, L * u1)), r); }
  };
  // stadium slices across an axis A -> B (bind): ids' vertices in each slab of thickness `slice`; e1 = a fixed major axis (trunk: x) or the section's principal axis
  const slices = (tag, boneAt, A, B, ids, { major = null, from = 0, to = 1, thick = O.slice } = {}) => {
    const d = unit(sub(B, A)), L = len(sub(B, A)), us = new Float64Array(ids.length); for (let k = 0; k < ids.length; k++) us[k] = dot(sub(V(ids[k]), A), d);
    const u0 = L * from, u1 = L * to, ns = Math.max(1, Math.round((u1 - u0) / thick)), th = (u1 - u0) / ns;
    for (let s = 0; s < ns; s++) { const c0 = u0 + th * s, c1 = c0 + th, mid = (c0 + c1) / 2, P2 = [];
      for (let k = 0; k < ids.length; k++) if (us[k] >= c0 - 0.15 * th && us[k] <= c1 + 0.15 * th) P2.push(ids[k]);
      if (P2.length < 8) continue;
      // outliers first (a few vertices of the region lie on the other leg / the crotch): drop points farther than 1.5 x the 75th percentile of the distance to the slab's median centre
      { const c0 = [Q(P2.map(i => pos[i * 3]), 0.5), Q(P2.map(i => pos[i * 3 + 1]), 0.5), Q(P2.map(i => pos[i * 3 + 2]), 0.5)], dd = P2.map(i => { const q = sub(V(i), c0); return len(sub(q, mul(d, dot(q, d)))); }), lim = 1.5 * Q(dd, 0.75);
        const keep = P2.filter((_, k) => dd[k] <= lim); if (keep.length >= 8) { P2.length = 0; P2.push(...keep); } }
      let ctr = [0, 0, 0]; for (const i of P2) ctr = add(ctr, V(i)); ctr = mul(ctr, 1 / P2.length); const plane = p => { const q = sub(p, ctr); return sub(q, mul(d, dot(q, d))); };
      let e1; if (major) e1 = unit(sub(major, mul(d, dot(major, d))));
      else { let sxx = 0, sxy = 0, syy = 0; const t1 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = unit(cross(d, t1)), w = cross(d, u);
        for (const i of P2) { const q = plane(V(i)), a = dot(q, u), b = dot(q, w); sxx += a * a; sxy += a * b; syy += b * b; }
        const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy); e1 = add(mul(u, Math.cos(ang)), mul(w, Math.sin(ang))); if (dot(e1, [1, 0, 0]) < 0) e1 = mul(e1, -1); }
      const e2 = unit(cross(d, e1)), S = [], Tt = [];
      for (const i of P2) { const q = plane(V(i)); S.push(dot(q, e1)); Tt.push(dot(q, e2)); }
      const s0 = Q(S, O.trim), s1 = Q(S, 1 - O.trim), t0 = Q(Tt, O.trim), t1 = Q(Tt, 1 - O.trim), r = Math.max(0.004, (t1 - t0) / 2), hl = Math.max(0, (s1 - s0) / 2 - r);
      const cc = add(add(ctr, mul(e1, (s0 + s1) / 2)), mul(e2, (t0 + t1) / 2));   // ctr is the slab's mean (its own axial position)
      const bone = boneAt(add(A, mul(d, mid)));
      push(tag, bone, sub(cc, mul(e1, hl)), add(cc, mul(e1, hl)), r);   // radius = the half depth (push adds `proud`)
    }
  };
  // ---- the trunk (bind y is up): torso, the top of the pelvis (the seat and hips) and the neck's base
  const hipY = J('upperleg01.L')[1], neckY = J('neck01')[1];
  const trunkIds = []; for (let i = 0; i < n; i++) { const r = AH[i * 4], y = pos[i * 3 + 1]; if (r === RG.torso || r === RG.neck && y < neckY + 0.01 || r === RG.pelvis && y > hipY - 0.12 || r === RG.thigh && y > hipY - 0.01) trunkIds.push(i); }
  if (want('trunk') && trunkIds.length) {
    const ys = trunkIds.map(i => pos[i * 3 + 1]), y0 = Q(ys, 0.004), y1 = Math.min(neckY + 0.015, Q(ys, 0.998));
    const spine = ['root', 'spine05', 'spine04', 'spine03', 'spine02', 'spine01', 'neck01'].filter(k => h.idx[k] != null), ySp = spine.map(k => J(k)[1]);
    const boneAtY = p => { let b = spine[0]; for (let k = 0; k < spine.length; k++) if (p[1] >= ySp[k] - 1e-6) b = spine[k]; return b; };
    slices('trunk', boneAtY, [0, y0, 0], [0, y1, 0], trunkIds, { major: [1, 0, 0] });
  }
  // ---- neck and head
  const neckIds = byRegion(RG.neck).filter(i => pos[i * 3 + 1] > neckY - 0.005);
  if (want('head') && neckIds.length) { const y0 = Math.min(...neckIds.map(i => pos[i * 3 + 1])), y1 = J('head')[1] + 0.02; slices('neck', p => p[1] < J('neck02')[1] ? 'neck01' : 'neck02', [0, y0, 0], [0, y1, 0], neckIds, { major: [1, 0, 0], thick: 0.04 }); }
  const headIds = byRegion(RG.head, RG.jaw);
  if (want('head') && headIds.length) { const ys = headIds.map(i => pos[i * 3 + 1]), y0 = J('head')[1] - 0.005, y1 = Q(ys, 0.9995); slices('head', () => 'head', [0, y0, 0], [0, y1, 0], headIds, { thick: 0.04 }); }
  // ---- limbs, both sides: each vertex goes to the nearer side's axis
  const nearest = (ids, axes) => {
    const out = axes.map(() => []);
    for (const i of ids) { const p = V(i); let best = 0, bd = Infinity;
      axes.forEach(([A, B], k) => { const d = unit(sub(B, A)), L = len(sub(B, A)), q = sub(p, A), u = Math.min(L, Math.max(0, dot(q, d))), dd = len(sub(q, mul(d, u))); if (dd < bd) { bd = dd; best = k; } });
      out[best].push(i); }
    return out; };
  const SIDES = ['L', 'R'];
  // a limb: round capsules (opt `limb: 'round'`) or stadium slices (default: a shin has a ridge in front and a calf behind, a forearm is wider than deep)
  const limb = (tag, regions, from, to, bone, ok, ext = [0, 1]) => {
    if (!want(ok)) return; const ids = byRegion(...regions), axes = SIDES.map(s => [J(from(s)), J(to(s))]), parts = nearest(ids, axes);
    SIDES.forEach((s, k) => O.limb === 'round' ? chain(tag, bone(s), axes[k][0], axes[k][1], parts[k]) : slices(tag, () => bone(s), axes[k][0], axes[k][1], parts[k], { from: ext[0], to: ext[1], thick: O.slice }));
  };
  limb('uarm', [RG.uarm], s => `upperarm01.${s}`, s => `lowerarm01.${s}`, s => `upperarm01.${s}`, 'arms', [-0.12, 1]);
  limb('farm', [RG.farm], s => `lowerarm01.${s}`, s => `wrist.${s}`, s => `lowerarm01.${s}`, 'arms');
  limb('thigh', [RG.thigh], s => `upperleg01.${s}`, s => `lowerleg01.${s}`, s => `upperleg01.${s}`, 'legs');
  limb('shin', [RG.shin], s => `lowerleg01.${s}`, s => `foot.${s}`, s => `lowerleg01.${s}`, 'legs');
  // ---- hands and feet: stadium slices along wrist -> middle fingertip, ankle -> toe tip
  const tipOf = (s, fin) => { const k = `${fin}.${s}`; return h.idx[k] != null ? T(k) : null; };
  // how far along A -> B (as a fraction of its length) the part's vertices reach: 1.0, or with `tips` the farthest one (+1 mm)
  const reach = ([A, B], ids) => { if (!O.tips || !ids.length) return 1.0; const d = unit(sub(B, A)), L = len(sub(B, A)); let m = 0; for (const i of ids) m = Math.max(m, dot(sub(V(i), A), d)); return Math.max(1.0, (m + 0.001) / L); };
  if (want('hands')) { const ids = byRegion(RG.hand, RG.finger), axes = SIDES.map(s => [J(`wrist.${s}`), tipOf(s, 'finger3-3') || T(`wrist.${s}`)]), parts = nearest(ids, axes);
    SIDES.forEach((s, k) => slices('hand', () => `wrist.${s}`, axes[k][0], axes[k][1], parts[k], { thick: 0.06, from: -0.1, to: reach(axes[k], parts[k]) })); }
  if (want('feet')) { const ids = byRegion(RG.foot), axes = SIDES.map(s => [J(`foot.${s}`), tipOf(s, 'toe3-3') || T(`foot.${s}`)]), parts = nearest(ids, axes);
    SIDES.forEach((s, k) => slices('foot', () => `foot.${s}`, axes[k][0], axes[k][1], parts[k], { thick: 0.05, from: -0.15, to: reach(axes[k], parts[k]) })); }
  const fit = { caps, opts: O, version: COLLIDERS_VERSION, n: caps.length }; m.set(key, fit); return fit;
}

// ---------------------------------------------------------------- the colliders for this pose, in main's format
export function peopleColliders(P, o = {}) {
  const h = heroOf(P), fit = fitPerson(P, o); h.group.updateMatrixWorld(true);
  const M = new Map(), out = [];
  for (const c of fit.caps) { let B = M.get(c.bone); if (!B) { const bn = h.bone(c.bone), e = bn.matrixWorld.elements; B = { e, s: Math.cbrt(Math.abs(e[0] * (e[5] * e[10] - e[9] * e[6]) - e[4] * (e[1] * e[10] - e[9] * e[2]) + e[8] * (e[1] * e[6] - e[5] * e[2]))) }; M.set(c.bone, B); }
    const e = B.e, w = p => [e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12], e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13], e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14]];
    if (c.sphere) out.push({ s: 'sphere', c: w(c.a), r: c.r * B.s, tag: c.tag }); else out.push({ s: 'capsule', a: w(c.a), b: w(c.b), r: c.r * B.s, tag: c.tag }); }
  return out;
}
peopleColliders.fit = fitPerson;

// ---------------------------------------------------------------- rulers: the fit against the body's own mesh
// signed distance from a point to the union of colliders (capsules / spheres): negative inside; `thick` is the cloth's standoff (main's thick)
export function distToColliders(list, x, y, z) {
  let best = Infinity;
  for (const c of list) { let d;
    if (c.s === 'sphere') d = Math.hypot(x - c.c[0], y - c.c[1], z - c.c[2]) - c.r;
    else if (c.s === 'capsule') { const ax = c.a[0], ay = c.a[1], az = c.a[2], bx = c.b[0] - ax, by = c.b[1] - ay, bz = c.b[2] - az, L2 = bx * bx + by * by + bz * bz || 1e-9; let u = ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
      d = Math.hypot(x - (ax + bx * u), y - (ay + by * u), z - (az + bz * u)) - c.r; } else continue;
    if (d < best) best = d; }
  return best;
}
// the body's posed vertices (world, metres) and their outward normals' vertical component: Float64Array(n*3), skinned on the CPU from the skeleton
export function posedBody(P) {
  const h = heroOf(P), g = h.body.geometry, pos = g.attributes.position.array, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, n = pos.length / 3;
  h.group.updateMatrixWorld(true); const nb = h.bones.length, M = new Float64Array(nb * 16), tmp = new Float64Array(16);
  for (let b = 0; b < nb; b++) { const A = h.bones[b].matrixWorld.elements, B = h.skeleton.boneInverses[b].elements;
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) tmp[c * 4 + r] = A[r] * B[c * 4] + A[4 + r] * B[c * 4 + 1] + A[8 + r] * B[c * 4 + 2] + A[12 + r] * B[c * 4 + 3]; M.set(tmp, b * 16); }
  const out = new Float64Array(n * 3);
  for (let v = 0; v < n; v++) { const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2]; let ox = 0, oy = 0, oz = 0, ws = 0;
    for (let k = 0; k < 4; k++) { const w = SW[v * 4 + k]; if (w === 0) continue; const m = SI[v * 4 + k] * 16; ws += w;
      ox += w * (M[m] * x + M[m + 4] * y + M[m + 8] * z + M[m + 12]); oy += w * (M[m + 1] * x + M[m + 5] * y + M[m + 9] * z + M[m + 13]); oz += w * (M[m + 2] * x + M[m + 6] * y + M[m + 10] * z + M[m + 14]); }
    if (ws > 0 && Math.abs(ws - 1) > 1e-6) { ox /= ws; oy /= ws; oz /= ws; } out[v * 3] = ox; out[v * 3 + 1] = oy; out[v * 3 + 2] = oz; }
  return out;
}
// fit quality on the body's UP-FACING skin (outward normal pointing up by more than `cos`; the side a sheet lies on): for each such vertex the
// gap from the skin to the collider surface (positive = the skin is outside the capsules: the cloth, `thick` off the capsules, can touch it).
// returns { n, gapMean (cm), gapP50/P90/P99 (cm), poke: share of the skin more than `thick` outside the capsules (cloth would sit inside it),
// pokeMax (mm), cover: mean standoff of a cloth resting on the capsules above the skin (mm) = thick - gap }
export function fitGap(P, list, { thick = 0.012, cos = 0.35, up = [0, 1, 0] } = {}) {
  const h = heroOf(P), g = h.body.geometry, X = posedBody(P), n = X.length / 3, idx = g.index.array, N = new Float64Array(n * 3);
  for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const i of [a, b, c]) { N[i * 3] += nx; N[i * 3 + 1] += ny; N[i * 3 + 2] += nz; } }
  // the body's winding may be inward: orient so the mean normal points away from the body centre
  let cx = 0, cy = 0, cz = 0; for (let i = 0; i < n; i++) { cx += X[i * 3]; cy += X[i * 3 + 1]; cz += X[i * 3 + 2]; } cx /= n; cy /= n; cz /= n;
  let s = 0; for (let i = 0; i < n; i += 7) s += N[i * 3] * (X[i * 3] - cx) + N[i * 3 + 1] * (X[i * 3 + 1] - cy) + N[i * 3 + 2] * (X[i * 3 + 2] - cz); const sg = s < 0 ? -1 : 1;
  const gaps = []; let poke = 0, pokeMax = 0;
  for (let i = 0; i < n; i++) { const nl = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; if (sg * (N[i * 3] * up[0] + N[i * 3 + 1] * up[1] + N[i * 3 + 2] * up[2]) / nl < cos) continue;
    const d = distToColliders(list, X[i * 3], X[i * 3 + 1], X[i * 3 + 2]); gaps.push(d); if (d > thick) { poke++; pokeMax = Math.max(pokeMax, d - thick); } }
  const m = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length), cm = x => +(x * 100).toFixed(2), mm = x => +(x * 1000).toFixed(1);
  return { n: gaps.length, gapMean: cm(-m), gapP50: cm(-Q(gaps, 0.5)), gapP90: cm(-Q(gaps, 0.1)), gapP99: cm(-Q(gaps, 0.01)), poke: +(poke / Math.max(1, gaps.length)).toFixed(4), pokeMax: mm(pokeMax), cover: mm(thick - m), note: 'gap* = skin below the capsule surface (cm; positive = skin inside the capsules); cover = mean standoff of the cloth over the skin (mm)' };
}

// ---------------------------------------------------------------- the body's own surface as a `mesh` collider (Drape only; main's Cloth has no mesh collider)
// A welded triangle surface of the person's posed body in WORLD coordinates (cloth/collide.js SurfaceMesh: closest point, signed distance), held `gap` off
// the skin by Drape's `mesh` collider ({ s: 'mesh', mesh, gap }): a sheet that reads the nose, the breasts, the knees and the toes, where the capsule union
// above is smooth. Call again (or col.follow(P)) after the person moves. Async: it loads cloth/collide.js and drape.js's weld lazily.
//
// THE WHOLE SKIN. makePerson culls from the body's INDEX every triangle K3's underwear (figure study) or the garments (dressed, before cover8) cover: the
// engine does not draw skin under cloth. A collider built from that index has HOLES where the body is covered: a sheet found no skin under a bra and settled on the
// rim of the hole (the 'cleavage limit cycle' of three iterations of contact-rule patches, which were all treating the symptom), and the garment, the only surface
// left there, stood out of the cloth. The collider is therefore always the UNCUT surface: the subdivision plan's own triangle list (g.userData.plan.tri, the
// drawn index is an ordered subset of it; CLOTH8's cover8 puts the same list back for a dressed person, which then has nothing culled). A person without a plan gets
// the index it has. `col.filled` = the culled triangles put back.
//
// `parts: true` (the RENDER's surface, not the sim's): the skin also LIFTED to K3's found parts (bra, briefs, waistbands, hem bands: dark shells 1-9 mm proud of the skin that the lab
// draws): each welded skin vertex gives way along its normal to the outermost garment surface standing on it (liftFromParts: a point splat of the garment's heights, `skirt` of the lift carried one ring beyond
// the garment's edge so the cloth rides up onto it). `col.lift` = { n, maxMm, meanMm, parts, points } says what was lifted, `col.points` (x y z nx ny nz per garment vertex standing on the skin,
// Float64Array) is what refineSheet's `points` keeps the refined sheet off. (Lifting inside the SIM leaves a particle patch moving at 0.08 m/s: not used there.)
export async function peopleMesh(P, { gap = 0.001, cell = 0.03, parts = false, reach = 0.012, skirt = 0.5 } = {}) {
  const h = heroOf(P), C = await import('./collide.js'), D = await import('./drape.js'), g = h.body.geometry, BP = g.attributes.position.array;
  const plan = g.userData && g.userData.plan, cut = g.index.array, wholeIdx = plan && plan.tri && plan.nOut === BP.length / 3 && plan.tri.length > cut.length ? plan.tri : null;
  const X = posedBody(P), { pid, rep, np } = D.weld(BP), tris = D.remapTris(wholeIdx || cut, pid), Xw = new Float64Array(np * 3);
  for (let p = 0; p < np; p++) for (let c = 0; c < 3; c++) Xw[p * 3 + c] = X[rep[p] * 3 + c];
  // winding outward (the body's may be inward): the mean normal against the direction from the centroid
  let N = C.vertexNormals(Xw, tris), cx = 0, cy = 0, cz = 0; for (let p = 0; p < np; p++) { cx += Xw[p * 3]; cy += Xw[p * 3 + 1]; cz += Xw[p * 3 + 2]; } cx /= np; cy /= np; cz /= np;
  let s = 0; for (let p = 0; p < np; p += 7) s += N[p * 3] * (Xw[p * 3] - cx) + N[p * 3 + 1] * (Xw[p * 3 + 1] - cy) + N[p * 3 + 2] * (Xw[p * 3 + 2] - cz);
  if (s < 0) for (let t = 0; t < tris.length; t += 3) { const b = tris[t + 1]; tris[t + 1] = tris[t + 2]; tris[t + 2] = b; }
  const Xskin = Float64Array.from(Xw); let lift = null, points = null, mesh = new C.SurfaceMesh(Xw, tris, { cell });
  const applyParts = () => { const bare = new C.SurfaceMesh(Xskin, tris, { cell }), L = liftFromParts(P, bare, tris, { reach, skirt }); Xw.set(Xskin); if (L.n) for (let p = 0; p < np; p++) { const d = L.lift[p]; if (d > 0) { Xw[p * 3] += bare.N[p * 3] * d; Xw[p * 3 + 1] += bare.N[p * 3 + 1] * d; Xw[p * 3 + 2] += bare.N[p * 3 + 2] * d; } } lift = { n: L.n, maxMm: L.maxMm, meanMm: L.meanMm, parts: L.parts, points: L.points.length / 6 }; points = L.points; };
  if (parts) { applyParts(); mesh = new C.SurfaceMesh(Xw, tris, { cell }); }
  // follow(P): the same collider after the person has moved (a posed or animated skeleton): the welded surface refitted to the posed body (positions and normals, the hash rebuilt,
  // ~10 ms), the winding kept. A pure function of the pose, so a run that calls it each step is a pure function of the poses (resume: snapshot / restore, then follow(P) again).
  // `rev` tells Drape the mesh moved (it recomputes the mesh's bounding box). With `parts` the lift is recomputed too (~0.1 s).
  const col = { s: 'mesh', mesh, gap, tag: 'body', n: np, rev: 0, lift, points, filled: wholeIdx ? (wholeIdx.length - cut.length) / 3 : 0,
    follow(P2 = P) { const X2 = posedBody(P2); for (let p = 0; p < np; p++) for (let c = 0; c < 3; c++) Xskin[p * 3 + c] = X2[rep[p] * 3 + c]; Xw.set(Xskin); if (parts) { applyParts(); col.lift = lift; col.points = points; } mesh.refit(Xw); col.rev++; return col; } };
  return col;
}

// ---------------------------------------------------------------- the person's found parts (K3 underwear) as a skin lift (run c4)
// posedParts(P, { groups }): the posed world vertices and triangles of the person's garment parts (default: K3's 'found' group, the underwear of the figure study). Skinned on the CPU through three's
// SkinnedMesh.getVertexPosition. [{ name, X: Float64Array(n*3), tris: Int32Array }]
export function posedParts(P, { groups = ['found'] } = {}) {
  const h = heroOf(P), out = []; if (h && h.group && h.group.updateMatrixWorld) h.group.updateMatrixWorld(true);
  for (const m of (P && P.parts) || []) { const k3 = m.userData && m.userData.k3; if (!k3 || !groups.includes(k3.group) || !m.geometry || !m.geometry.index) continue;
    m.updateMatrixWorld(true); if (m.skeleton) m.skeleton.update();
    const ga = m.geometry.attributes.position, n = ga.count, X = new Float64Array(n * 3), V = m.position.clone();   // V: a Vector3 of whatever three this is
    for (let i = 0; i < n; i++) { if (m.isSkinnedMesh) m.getVertexPosition(i, V); else V.fromBufferAttribute(ga, i); V.applyMatrix4(m.matrixWorld); X[i * 3] = V.x; X[i * 3 + 1] = V.y; X[i * 3 + 2] = V.z; }
    out.push({ name: (k3.name || m.name || 'part') + (k3.construction ? '/' + k3.construction : ''), X, tris: Int32Array.from(m.geometry.index.array) }); }
  return out;
}
// for each welded skin vertex, the height (m) of the outermost garment surface standing on it; 0 where there is none. `bare` = a SurfaceMesh of the bare skin (Xs, tris): every garment VERTEX is
// dropped onto it (its closest skin point and its height `h` above the skin there) and gives h to the skin vertices within `r` (6 mm, about one skin edge) of that point that face the same way, a
// max-filter of the garment's height field onto the skin's own vertices (a dilation of the garment's footprint by ~one cell: the lifted surface COVERS the garment's rim rather than missing it
// between two skin vertices). Garment that is further than `reach` from the skin (a gore bridging a cleavage, the crotch of a brief) is not a skin lift and is left to the sheet.
// `skirt` (0..1) of the largest lift among a vertex's neighbours is given to a vertex with none (one ring), so the lifted surface ramps down off the garment's edge.
export function liftFromParts(P, bare, tris, { reach = 0.012, skirt = 0.5, r = 0.006, pointReach = 0.04, groups = ['found'] } = {}) {
  const parts = posedParts(P, { groups }), Xs = bare.X, Ns = bare.N, np = Xs.length / 3, lift = new Float32Array(np), res = { lift, n: 0, maxMm: 0, meanMm: 0, parts: parts.map(q => q.name) };
  if (!parts.length) return res;
  const cell = 0.012, ic = 1 / cell, key = (i, j, k) => ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096), H = new Map();
  for (let v = 0; v < np; v++) { if (bare.fo[v + 1] === bare.fo[v]) continue; const kk = key(Math.floor(Xs[v * 3] * ic), Math.floor(Xs[v * 3 + 1] * ic), Math.floor(Xs[v * 3 + 2] * ic)), L = H.get(kk); if (L) L.push(v); else H.set(kk, [v]); }
  const rr = Math.ceil(r * ic), r2 = r * r, PT = [];
  for (const q of parts) for (let i = 0; i < q.X.length; i += 3) { const gx = q.X[i], gy = q.X[i + 1], gz = q.X[i + 2], c = bare.closestAny(gx, gy, gz, pointReach, -1); if (!c) continue;
    const h = (gx - c.px) * c.nx + (gy - c.py) * c.ny + (gz - c.pz) * c.nz; if (!(h > 0.0003 && h <= pointReach)) continue;
    if (h > reach) continue;   // a panel that bridges a hollow (a bra gore, a brief's pouch) is neither lifted nor held: pushing the sheet 20 mm over one makes a spike whose neighbours still pass under it
    PT.push(gx, gy, gz, c.nx, c.ny, c.nz);   // every garment vertex standing on the skin is a point obstacle for the render-time push-out
    const ci = Math.floor(c.px * ic), cj = Math.floor(c.py * ic), ck = Math.floor(c.pz * ic);
    for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) for (let d = -rr; d <= rr; d++) { const L = H.get(key(ci + a, cj + b, ck + d)); if (!L) continue;
      for (let k = 0; k < L.length; k++) { const v = L[k]; if (lift[v] >= h) continue; const dx = Xs[v * 3] - c.px, dy = Xs[v * 3 + 1] - c.py, dz = Xs[v * 3 + 2] - c.pz; if (dx * dx + dy * dy + dz * dz > r2) continue;
        if (Ns[v * 3] * c.nx + Ns[v * 3 + 1] * c.ny + Ns[v * 3 + 2] * c.nz < 0.5) continue; lift[v] = h; } } }
  if (skirt > 0) { const N0 = Float32Array.from(lift), sk = new Float32Array(np);   // ring: the neighbours of a lifted vertex
    for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) { const a = tris[t + k], c = tris[t + (k + 1) % 3]; if (N0[a] > 0 && N0[c] === 0) sk[c] = Math.max(sk[c], N0[a] * skirt); if (N0[c] > 0 && N0[a] === 0) sk[a] = Math.max(sk[a], N0[c] * skirt); }
    for (let v = 0; v < np; v++) if (lift[v] === 0 && sk[v] > 0) lift[v] = sk[v]; }
  let mx = 0, sm = 0; for (let v = 0; v < np; v++) if (lift[v] > 0) { res.n++; sm += lift[v]; if (lift[v] > mx) mx = lift[v]; }
  res.points = Float64Array.from(PT);   // x y z nx ny nz per garment vertex
  res.maxMm = +(mx * 1000).toFixed(2); res.meanMm = +(sm / Math.max(1, res.n) * 1000).toFixed(2); return res;
}
