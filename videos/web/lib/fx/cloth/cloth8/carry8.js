// CLOTH8 (round 7): what is sewn ON a garment follows the garment when CLOTH8 moves its cloth (relax8, tuck8, cuff8): every vertex of a
// construction part (a pocket, a placket, a button, a turned hem's layer, a collar's fall) is bound to its nearest triangle of the
// garment's drawn cloth (posed, before the edit): barycentric point + the distance along that triangle's normal + the residual off its
// plane; after the edit it is put back on the same triangle's new place. Where the garment did not move the part is byte-identical.
//   const B = bind8(partPosed, garmentPosed, T, { reach }); place8(B, garmentPosedNew, T, out) -> moved count
import { SurfaceMesh } from '../collide.js';
export const CARRY8_VERSION = 1;
const triN = (X, T, t) => { const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2], ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l]; };
export function bind8(Xq, Xg, T, { reach = 0.03, surf = null } = {}) {
  const S = surf || new SurfaceMesh(Xg, Int32Array.from(T), { cell: 0.015 }), n = Xq.length / 3, tri = new Int32Array(n).fill(-1), bc = new Float64Array(n * 3), dn = new Float64Array(n), res = new Float64Array(n * 3);
  for (let v = 0; v < n; v++) { const x = Xq[v * 3], y = Xq[v * 3 + 1], z = Xq[v * 3 + 2], q = S.closestAny(x, y, z, reach); if (!q) continue; const t = q.tri, a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
    // barycentrics of the closest point
    const P = [q.px, q.py, q.pz], A = [Xg[a * 3], Xg[a * 3 + 1], Xg[a * 3 + 2]], B = [Xg[b * 3], Xg[b * 3 + 1], Xg[b * 3 + 2]], C = [Xg[c * 3], Xg[c * 3 + 1], Xg[c * 3 + 2]];
    const v0 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v1 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]], v2 = [P[0] - A[0], P[1] - A[1], P[2] - A[2]], d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1), den = d00 * d11 - d01 * d01 || 1e-18;
    const bv = (d11 * d20 - d01 * d21) / den, bw = (d00 * d21 - d01 * d20) / den, bu = 1 - bv - bw, N = triN(Xg, T, t), d = (x - P[0]) * N[0] + (y - P[1]) * N[1] + (z - P[2]) * N[2];
    tri[v] = t; bc[v * 3] = bu; bc[v * 3 + 1] = bv; bc[v * 3 + 2] = bw; dn[v] = d; res[v * 3] = x - P[0] - N[0] * d; res[v * 3 + 1] = y - P[1] - N[1] * d; res[v * 3 + 2] = z - P[2] - N[2] * d; }
  return { tri, bc, dn, res, n };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// moved: per garment vertex 1 when the edit moved it (a part vertex is placed again only when its triangle moved)
export function place8(B, Xg, T, Xq, moved = null) {
  let k = 0; for (let v = 0; v < B.n; v++) { const t = B.tri[v]; if (t < 0) continue; const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2]; if (moved && !moved[a] && !moved[b] && !moved[c]) continue;
    const N = triN(Xg, T, t), u = B.bc[v * 3], w1 = B.bc[v * 3 + 1], w2 = B.bc[v * 3 + 2];
    for (let q = 0; q < 3; q++) Xq[v * 3 + q] = Xg[a * 3 + q] * u + Xg[b * 3 + q] * w1 + Xg[c * 3 + q] * w2 + N[q] * B.dn[v] + B.res[v * 3 + q];
    k++; }
  return k;
}
