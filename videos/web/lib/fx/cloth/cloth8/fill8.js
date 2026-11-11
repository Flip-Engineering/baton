// CLOTH8 (round 7): a garment's hidden cloth given back its triangles. CLOTH4's waistband ring hid the tucked shirt's cloth under the band
// by dropping its triangles from the bake (the vertices stay: positions, weights, the flat pattern); where the shirt sat higher than the
// ring's own rule thought, the hidden region reached above the band and its edge showed as a torn line. The panel's own flat pattern
// (uv per panel) is re-triangulated (Bowyer-Watson Delaunay, as pattern/mesh2d.js) and the triangles that fill the holes (no overlap with
// a drawn triangle in the flat, no edge longer than `maxEdge` x the panel's median edge, every corner within `near` of a hidden vertex)
// are returned; the caller decides which to draw.
//   holeTriangles(g, { maxEdge, near }) -> Int32Array (pre-weld vertex ids, wound as the panel's drawn triangles)
export const FILL8_VERSION = 1;
const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
function circum(P, a, b, c) { const ax = P[a * 2], ay = P[a * 2 + 1], bx = P[b * 2], by = P[b * 2 + 1], cx = P[c * 2], cy = P[c * 2 + 1], d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-20) return [0, 0, Infinity]; const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy, ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d, uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d; return [ux, uy, (ax - ux) ** 2 + (ay - uy) ** 2]; }
export function delaunay2(P, n) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < n; i++) { x0 = Math.min(x0, P[i * 2]); y0 = Math.min(y0, P[i * 2 + 1]); x1 = Math.max(x1, P[i * 2]); y1 = Math.max(y1, P[i * 2 + 1]); }
  const d = Math.max(x1 - x0, y1 - y0) * 20, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; P[n * 2] = cx - d; P[n * 2 + 1] = cy - d; P[n * 2 + 2] = cx + d; P[n * 2 + 3] = cy - d; P[n * 2 + 4] = cx; P[n * 2 + 5] = cy + d;
  let T = [[n, n + 1, n + 2]], C = [circum(P, n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) { const x = P[i * 2], y = P[i * 2 + 1], bad = []; for (let t = 0; t < T.length; t++) { const c = C[t]; if ((x - c[0]) ** 2 + (y - c[1]) ** 2 < c[2] * (1 - 1e-12)) bad.push(t); }
    const cnt = new Map(); for (const t of bad) { const [a, b, c] = T[t]; for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u < v ? u * 1e6 + v : v * 1e6 + u; const e = cnt.get(k); if (e) e.n++; else cnt.set(k, { n: 1, u, v }); } }
    const keep = new Uint8Array(T.length).fill(1); for (const t of bad) keep[t] = 0; const T2 = [], C2 = []; for (let t = 0; t < T.length; t++) if (keep[t]) { T2.push(T[t]); C2.push(C[t]); }
    for (const e of cnt.values()) if (e.n === 1) { let a = e.u, b = e.v; if (orient(P[a * 2], P[a * 2 + 1], P[b * 2], P[b * 2 + 1], x, y) < 0) [a, b] = [b, a]; T2.push([a, b, i]); C2.push(circum(P, a, b, i)); }
    T = T2; C = C2; }
  return T.filter(t => t[0] < n && t[1] < n && t[2] < n);
}
const segX = (ax, ay, bx, by, cx, cy, dx, dy) => { const d1 = orient(cx, cy, dx, dy, ax, ay), d2 = orient(cx, cy, dx, dy, bx, by), d3 = orient(ax, ay, bx, by, cx, cy), d4 = orient(ax, ay, bx, by, dx, dy); return ((d1 > 1e-14 && d2 < -1e-14) || (d1 < -1e-14 && d2 > 1e-14)) && ((d3 > 1e-14 && d4 < -1e-14) || (d3 < -1e-14 && d4 > 1e-14)); };
export function holeTriangles(g, { maxEdge = 1.8, near = 0.03 } = {}) {
  const n = g.X.length / 3, used = new Uint8Array(n); for (const v of g.T) used[v] = 1; const out = [], uv = g.uv, panel = g.panel || new Uint8Array(n), np = Math.max(...panel) + 1;
  for (let k = 0; k < np; k++) { const ids = []; for (let i = 0; i < n; i++) if (panel[i] === k) ids.push(i); const hid = ids.filter(i => !used[i]); if (!hid.length) continue;
    const loc = new Map(ids.map((i, j) => [i, j])), P = new Float64Array((ids.length + 3) * 2); ids.forEach((i, j) => { P[j * 2] = uv[i * 2]; P[j * 2 + 1] = uv[i * 2 + 1]; });
    // the panel's drawn triangles (local ids), their winding in the flat, the median edge
    const dr = []; for (let t = 0; t < g.T.length; t += 3) { const a = loc.get(g.T[t]), b = loc.get(g.T[t + 1]), c = loc.get(g.T[t + 2]); if (a != null && b != null && c != null) dr.push([a, b, c]); }
    let sgn = 0; const L = []; for (const [a, b, c] of dr) { sgn += Math.sign(orient(P[a * 2], P[a * 2 + 1], P[b * 2], P[b * 2 + 1], P[c * 2], P[c * 2 + 1])); for (const [u, v] of [[a, b], [b, c], [c, a]]) L.push(Math.hypot(P[u * 2] - P[v * 2], P[u * 2 + 1] - P[v * 2 + 1])); }
    L.sort((a, b) => a - b); const med = L.length ? L[L.length >> 1] : 0.0135, emax = med * maxEdge, have = new Set(dr.map(t => [...t].sort((a, b) => a - b).join(',')));
    const hidL = hid.map(i => loc.get(i)), nearH = j => hidL.some(h => (P[h * 2] - P[j * 2]) ** 2 + (P[h * 2 + 1] - P[j * 2 + 1]) ** 2 < near * near);
    // drawn edges in a grid (crossing test) and the drawn triangles (centroid test)
    const cell = med * 2, G = new Map(), key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`; for (const t of dr) { const cx = (P[t[0] * 2] + P[t[1] * 2] + P[t[2] * 2]) / 3, cy = (P[t[0] * 2 + 1] + P[t[1] * 2 + 1] + P[t[2] * 2 + 1]) / 3, kk = key(cx, cy); (G.get(kk) || G.set(kk, []).get(kk)).push(t); }
    const around = (x, y) => { const i = Math.floor(x / cell), j = Math.floor(y / cell), r = []; for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const L2 = G.get(`${i + a},${j + b}`); if (L2) r.push(...L2); } return r; };
    const inTri = (x, y, t) => { const [a, b, c] = t, s1 = orient(P[a * 2], P[a * 2 + 1], P[b * 2], P[b * 2 + 1], x, y), s2 = orient(P[b * 2], P[b * 2 + 1], P[c * 2], P[c * 2 + 1], x, y), s3 = orient(P[c * 2], P[c * 2 + 1], P[a * 2], P[a * 2 + 1], x, y); return (s1 > 0 && s2 > 0 && s3 > 0) || (s1 < 0 && s2 < 0 && s3 < 0); };
    for (const t of delaunay2(P, ids.length)) { if (have.has([...t].sort((a, b) => a - b).join(','))) continue; let long = false; for (let q = 0; q < 3; q++) { const u = t[q], v = t[(q + 1) % 3]; if (Math.hypot(P[u * 2] - P[v * 2], P[u * 2 + 1] - P[v * 2 + 1]) > emax) long = true; } if (long) continue;
      if (!t.every(nearH)) continue; const cx = (P[t[0] * 2] + P[t[1] * 2] + P[t[2] * 2]) / 3, cy = (P[t[0] * 2 + 1] + P[t[1] * 2 + 1] + P[t[2] * 2 + 1]) / 3, A = around(cx, cy);
      if (A.some(d => inTri(cx, cy, d))) continue; let x = false;
      for (const d of A) { for (let q = 0; q < 3 && !x; q++) for (let r = 0; r < 3 && !x; r++) { const a = t[q], b = t[(q + 1) % 3], c = d[r], e = d[(r + 1) % 3]; if (segX(P[a * 2], P[a * 2 + 1], P[b * 2], P[b * 2 + 1], P[c * 2], P[c * 2 + 1], P[e * 2], P[e * 2 + 1])) x = true; } if (x) break; }
      if (x) continue; const o = orient(P[t[0] * 2], P[t[0] * 2 + 1], P[t[1] * 2], P[t[1] * 2 + 1], P[t[2] * 2], P[t[2] * 2 + 1]); const [a, b, c] = (o > 0) === (sgn >= 0) ? t : [t[0], t[2], t[1]]; out.push(ids[a], ids[b], ids[c]); } }
  return Int32Array.from(out);
}
