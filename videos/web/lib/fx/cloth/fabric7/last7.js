// LAST7 (FABRIC7, 8 Oct): the material coordinate and the caps of the shoe upper, fixed where they are made.
//
// What K4's shoe4.js and CLOTH4's boot4.js build (the same code in both): the foot part of the upper is 27 sections (rings) of 36 vertices on the last, then two single-vertex caps (the heel's and the
// toe's apex, vertices 972 and 973). Every ring vertex carries the material coordinate uv = (theta W, z): theta the section's parametric angle, W the foot's half width, ONE number for the whole last,
// and z the foot axis. Everything the fabric program lays in uv (FAB_UVQ: q = uv: the weave and the leather's tone columns, the painted folds, the seam distances, the Cycles 'cloth' map's yarn tile)
// is then laid at the scale of the WIDEST section: where the upper narrows to the toe (the section's half width falls to 0.12 W at the tip) a metre of uv is a fraction of a metre of shoe (measured:
// shoes7_uv_probe.mjs: sigma 0.16 at rings 25-26, anisotropy median 15, p90 90-114), the constant-u lines (warp columns, the fold trains) CONVERGE on the tip, and the two apex vertices have uv (0, 0): the
// cap's triangles interpolate from the ring's coordinates (0.28 m of u) to the origin: anisotropy 8-9, 18x compression. That is the BOOT TOE'S RADIAL FAN (the orchestrator's 'true cause' item): fine
// hairlines running into the tip, in v6 and every rev since, unmoved by anisotropy 0.
// The sneaker's apex has a second fault: it stands 1.0 mm ahead of the sole's front wall (apex z + 3 mm, wall at ring z + 2 mm) and the cone's tip comes through the wall as a ~4 mm disc, dirtied and
// scuffed by the construction shader as the upper's lowest, toe-most point (atlas texel (82,79,76) on a cream sole): THE GREY DISC. (The boot's cap stands ABOVE its sole, it is the boot's nose: its
// position is left as built.)
//
// lastUV7 rebuilds the coordinate by ARC LENGTH, the flat pattern of a lasted upper: u = the distance round the section from the top-centre line (signed, +uvTop so the shader's seam distances stay away from
// 0 and pi), w = the distance along the meridian from the heel ring (starting at the heel ring's own z), so a metre of uv is a metre of shoe along both axes wherever the surface is not doubly curved; the
// apexes get the mean of their ring and a cap-sized step beyond it; a sneaker's apexes are moved to 0.5 mm outside their ring's plane (inside the sole's walls, 1.5 mm behind them) and the normals of the
// vertices they touch are redone. Pure function on array-likes (typed arrays at run time, plain arrays at build time); nothing is returned that was not changed in place. Idempotent (an apex whose uv is
// not (0, 0) is left alone). shoe4.js and boot4.js call it as they build the upper; shoes7.js calls it as a baked person's shoe part is added (the bake data predates it).
export const LAST7_VERSION = 1;
export const LAST7_NT = 26, LAST7_SEG = 36;
export function lastUV7(pos, uv, index, normal, { boot = false, NT = LAST7_NT, seg = LAST7_SEG, uvTop = 0.15 * Math.PI / 2, cap = null, lift = 0.0005, alpha = 0, kA = 20 } = {}) {
  const rows = (NT + 1) * seg, n = pos.length / 3, out = { applied: false };
  if (n < rows + 2) return Object.assign(out, { why: 'too few vertices' });
  if (uv[rows * 2] !== 0 || uv[rows * 2 + 1] !== 0 || uv[(rows + 1) * 2] !== 0 || uv[(rows + 1) * 2 + 1] !== 0) return Object.assign(out, { why: 'apex uv already set' });
  for (let k = 0; k <= NT; k++) { const z0 = pos[(k * seg) * 3 + 2]; for (let i = 1; i < seg; i++) if (Math.abs(pos[(k * seg + i) * 3 + 2] - z0) > 1e-6) return Object.assign(out, { why: `ring ${k} is not planar: not the builder's layout` }); }
  const P = (k, i) => (k * seg + i) * 3, dist = (a, b) => Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]), iT = seg / 4;
  const wOld = k => uv[(k * seg) * 2 + 1], W = new Float64Array(rows), U = new Float64Array(rows);
  const perims = [];
  for (let k = 0; k <= NT; k++) { let q = dist(P(k, 0), P(k, seg - 1)); for (let i = 1; i < seg; i++) q += dist(P(k, i), P(k, i - 1)); perims.push(q); }
  for (let k = 0; k <= NT; k++) {
    const s = new Float64Array(seg); for (let i = 1; i < seg; i++) s[i] = s[i - 1] + dist(P(k, i), P(k, i - 1));
    const perim = perims[k], u0 = s[iT], f = alpha && k > kA ? Math.pow(perim / perims[kA], alpha) : 1;   // alpha: toward the section's fraction (theta W: 1) from its arc length (0) over the nose rings: the shear / compression trade of a doubly curved tip
    for (let i = 0; i < seg; i++) { let d = s[i] - u0; if (d > perim / 2) d -= perim; else if (d < -perim / 2) d += perim; U[k * seg + i] = uvTop + d * f;
      W[k * seg + i] = k === 0 ? wOld(0) : W[(k - 1) * seg + i] + dist(P(k, i), P(k - 1, i)); } }
  for (let v = 0; v < rows; v++) { uv[v * 2] = U[v]; uv[v * 2 + 1] = W[v]; }
  const ringMean = k => { let w = 0; for (let i = 0; i < seg; i++) w += W[k * seg + i]; return w / seg; };
  // the apex's step beyond its ring: the mean slant distance from the ring to the apex (the cap's radial direction is then metric; the ring's own spread of u makes the rest a shear)
  const slant = (a, k) => { let q = 0; for (let i = 0; i < seg; i++) q += Math.hypot(pos[a * 3] - pos[P(k, i)], pos[a * 3 + 1] - pos[P(k, i) + 1], pos[a * 3 + 2] - pos[P(k, i) + 2]); return q / seg; };
  uv[rows * 2] = uvTop; uv[rows * 2 + 1] = ringMean(0) - (cap ?? slant(rows, 0));                  // the heel's apex: a slant length behind the first ring
  uv[(rows + 1) * 2] = uvTop; uv[(rows + 1) * 2 + 1] = ringMean(NT) + (cap ?? slant(rows + 1, NT));     // the toe's apex: ahead of the last (measured at the apex's BUILT position: a sneaker's is then moved in, the uv stays)
  const moved = [];
  if (!boot) {                                                                  // a sneaker: the apexes inside the sole's walls (ring plane +- 0.5 mm: the wall is 2 mm outside it)
    for (const [a, k, dir] of [[rows, 0, -1], [rows + 1, NT, 1]]) {
      let cx = 0, cy = 0; for (let i = 0; i < seg; i++) { cx += pos[P(k, i)]; cy += pos[P(k, i) + 1]; }
      const z1 = pos[P(k, 0) + 2] + dir * lift, z0 = pos[a * 3 + 2]; pos[a * 3] = cx / seg; pos[a * 3 + 1] = cy / seg; pos[a * 3 + 2] = z1; moved.push(+((z0 - z1) * 1000 * dir).toFixed(2)); }
    if (normal && index) {                                                      // the normals of what the caps touch: the two apexes and their rings, from their triangles (bind space, area-weighted)
      const touch = new Set([rows, rows + 1]); for (const k of [0, NT]) for (let i = 0; i < seg; i++) touch.add(k * seg + i);
      const acc = new Map(); for (const v of touch) acc.set(v, [0, 0, 0]);
      for (let t = 0; t < index.length; t += 3) { const a = index[t], b = index[t + 1], c = index[t + 2]; if (!(touch.has(a) || touch.has(b) || touch.has(c))) continue;
        const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2], vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const v of [a, b, c]) if (acc.has(v)) { const q = acc.get(v); q[0] += nx; q[1] += ny; q[2] += nz; } }
      for (const [v, q] of acc) { const l = Math.hypot(q[0], q[1], q[2]) || 1; normal[v * 3] = q[0] / l; normal[v * 3 + 1] = q[1] / l; normal[v * 3 + 2] = q[2] / l; } }
  }
  return Object.assign(out, { applied: true, apexMovedMm: moved, uRange: [+Math.min(...U).toFixed(4), +Math.max(...U).toFixed(4)], wRange: [+Math.min(...W).toFixed(4), +Math.max(...W).toFixed(4)] });
}
