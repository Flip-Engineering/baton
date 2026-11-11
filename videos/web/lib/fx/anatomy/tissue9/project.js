// ANATOMY / TISSUE9 / PROJECT (TISSUE9-LIMB, round 8, 16 Oct 2026; DESIGN: review/studio_human_c8/after/tissue9_limb/DESIGN.md (2) (6)): THE RENDER MESH
// PROJECTED ONTO THE SOLVED SKIN. hm08 carries the UVs, the rig and the lids: its topology is kept, its FORM is the skin's. Each vertex of the region goes
// to the closest point of the solved skin (on its own side of the body: a left-thigh vertex never lands on the right thigh), the displacement field
// smoothed over the mesh between projections (a shrink-wrap with a smoothness term, for correspondence only). No data weights; the only blend is the
// band at the region's own cuts, where the region meets the body it does not own.
//   const H = skinHash(skin)                              skin = { pos: Float32Array, idx: Uint32Array } (grow.js groupField -> surfaceNets)
//   const D = projectPoints(H, X, adj, { w, side, iters, smooth, maxD })   X Float64Array(n * 3); adj [[j...]]; w(i) in [0, 1]; side(i) -1 | 0 | 1
//   -> { D: Float64Array(n * 3) (the displacement), far: count beyond maxD, meanMm, maxMm }

export function skinHash(skin, cell = 0.01) {
  const P = skin.pos, I = skin.idx, nT = I.length / 3, map = new Map(), key = (a, b, c) => a + ',' + b + ',' + c, side = new Int8Array(nT);
  for (let t = 0; t < nT; t++) { const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2]; let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const v of [a, b, c]) { x0 = Math.min(x0, P[v * 3]); x1 = Math.max(x1, P[v * 3]); y0 = Math.min(y0, P[v * 3 + 1]); y1 = Math.max(y1, P[v * 3 + 1]); z0 = Math.min(z0, P[v * 3 + 2]); z1 = Math.max(z1, P[v * 3 + 2]); }
    const xc = (P[a * 3] + P[b * 3] + P[c * 3]) / 3; side[t] = xc > 0.012 ? 1 : xc < -0.012 ? -1 : 0;
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(y0 / cell); j <= Math.floor(y1 / cell); j++) for (let k = Math.floor(z0 / cell); k <= Math.floor(z1 / cell); k++) { const kk = key(i, j, k); let e = map.get(kk); if (!e) map.set(kk, e = []); e.push(t); } }
  return { P, I, map, cell, side, key };
}
// the closest point of the skin to p (within maxD), on triangles of side s (0 = any side; a side-s point may land on a midline triangle)
const Q = [0, 0, 0];
export function closest(H, px, py, pz, s = 0, maxD = 0.08) {
  const { P, I, map, cell } = H; let best = Infinity, bx = 0, by = 0, bz = 0, bt = -1; const ci = Math.floor(px / cell), cj = Math.floor(py / cell), ck = Math.floor(pz / cell), R = Math.ceil(maxD / cell);
  const seen = new Set();
  for (let r = 0; r <= R; r++) {
    if (best < (r - 1) * cell) break;   // nothing in a farther shell can beat the best
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let k = ck - r; k <= ck + r; k++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck)) !== r) continue; const e = map.get(H.key(i, j, k)); if (!e) continue;
      for (const t of e) { if (seen.has(t)) continue; seen.add(t); if (s && H.side[t] && H.side[t] !== s) continue;
        const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2]; triClosest(px, py, pz, P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[b * 3], P[b * 3 + 1], P[b * 3 + 2], P[c * 3], P[c * 3 + 1], P[c * 3 + 2], Q);
        const d = (Q[0] - px) ** 2 + (Q[1] - py) ** 2 + (Q[2] - pz) ** 2; if (d < best) { best = d; bx = Q[0]; by = Q[1]; bz = Q[2]; bt = t; } } } }
  return bt < 0 || Math.sqrt(best) > maxD ? null : [bx, by, bz, Math.sqrt(best)];
}
// the closest point of triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5)
function triClosest(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz; if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz; if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); out[0] = ax + v * abx; out[1] = ay + v * aby; out[2] = az + v * abz; return; }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz; if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); out[0] = ax + w * acx; out[1] = ay + w * acy; out[2] = az + w * acz; return; }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); out[0] = bx + w * (cx - bx); out[1] = by + w * (cy - by); out[2] = bz + w * (cz - bz); return; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
}
// the shrink-wrap: project, smooth the displacement over the graph, re-project from the smoothed positions; the last projection exact
export function projectPoints(H, X, adj, o = {}) {
  const n = X.length / 3, w = o.w || (() => 1), side = o.side || (() => 0), iters = o.iters ?? 5, sm = o.smooth ?? 3, maxD = o.maxD ?? 0.08;
  const D = new Float64Array(n * 3), act = new Uint8Array(n); for (let i = 0; i < n; i++) act[i] = w(i) > 0 ? 1 : 0;
  const proj = (fromD) => { let far = 0; const T = new Float64Array(n * 3); for (let i = 0; i < n; i++) { if (!act[i]) continue; const x = X[i * 3] + fromD[i * 3], y = X[i * 3 + 1] + fromD[i * 3 + 1], z = X[i * 3 + 2] + fromD[i * 3 + 2];
      const q = closest(H, x, y, z, side(i), maxD); if (!q) { far++; T[i * 3] = fromD[i * 3]; T[i * 3 + 1] = fromD[i * 3 + 1]; T[i * 3 + 2] = fromD[i * 3 + 2]; continue; }
      T[i * 3] = q[0] - X[i * 3]; T[i * 3 + 1] = q[1] - X[i * 3 + 1]; T[i * 3 + 2] = q[2] - X[i * 3 + 2]; } return { T, far }; };
  const smooth = (A, k) => { let B = A; for (let s = 0; s < k; s++) { const C = Float64Array.from(B); for (let i = 0; i < n; i++) { if (!act[i]) continue; const a = adj[i]; if (!a || !a.length) continue; let sx = 0, sy = 0, sz = 0, m = 0;
        for (const j of a) { sx += B[j * 3]; sy += B[j * 3 + 1]; sz += B[j * 3 + 2]; m++; } C[i * 3] = 0.5 * B[i * 3] + 0.5 * sx / m; C[i * 3 + 1] = 0.5 * B[i * 3 + 1] + 0.5 * sy / m; C[i * 3 + 2] = 0.5 * B[i * 3 + 2] + 0.5 * sz / m; } B = C; } return B; };
  let cur = D, far = 0;
  for (let it = 0; it < iters; it++) { const r = proj(cur); far = r.far; cur = smooth(r.T, sm); }
  const fin = proj(cur); far = fin.far; let s = 0, mx = 0, c = 0;
  const out = new Float64Array(n * 3); for (let i = 0; i < n; i++) { if (!act[i]) continue; const wi = w(i); for (let q = 0; q < 3; q++) out[i * 3 + q] = fin.T[i * 3 + q] * wi; const l = Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]); s += l; mx = Math.max(mx, l); c++; }
  return { D: out, far, meanMm: +(s / Math.max(1, c) * 1000).toFixed(1), maxMm: +(mx * 1000).toFixed(1), n: c };
}
