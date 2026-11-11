// ANAT8 layer core: FITTING an existing mesh (hm08) to an anatomy (ANAT8-HEAD, 8 Oct; shared with ANAT8-BODY).
//   adjacencyOf(tri, n, keep?)            -> Array<Int32Array|null>: each vertex's neighbours (triangles with all three vertices kept)
//   const T = tpsFit(src, dst, { lambda }) ; tpsApply(T, p) -> p'   thin-plate spline in 3-D (kernel r), landmark pairs src -> dst
//   lowpass(P, adj, set, { iters, lambda, mu })                  Taubin smoothing of the vertices in `set` (others fixed): the FORM
//   const D = encodeDetail(P, B, adj, set) ; decodeDetail(D, B2, adj, set) -> P2: the DETAIL (P - B) in B's local frames, re-applied on B2
// Units: whatever the caller uses (the anatomy works in mm).
const sqrt = Math.sqrt;
export function adjacencyOf(tri, n, keep = null) {
  const S = Array.from({ length: n }, () => null);
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a >= n || b >= n || c >= n) continue; if (keep && !(keep[a] && keep[b] && keep[c])) continue;
    for (const [u, v, w] of [[a, b, c], [b, c, a], [c, a, b]]) { (S[u] ||= new Set()).add(v).add(w); } }
  return S.map(s => (s ? Int32Array.from(s) : null));
}
// ---------------------------------------------------------------- thin-plate spline (3-D, U(r) = r), with an affine part
export function tpsFit(src, dst, o = {}) {
  const m = src.length, lam = o.lambda ?? 0, N = m + 4, A = Array.from({ length: N }, () => new Float64Array(N)), B = Array.from({ length: N }, () => new Float64Array(3));
  for (let i = 0; i < m; i++) { for (let j = 0; j < m; j++) A[i][j] = i === j ? lam : sqrt((src[i][0] - src[j][0]) ** 2 + (src[i][1] - src[j][1]) ** 2 + (src[i][2] - src[j][2]) ** 2);
    A[i][m] = 1; A[i][m + 1] = src[i][0]; A[i][m + 2] = src[i][1]; A[i][m + 3] = src[i][2]; A[m][i] = 1; A[m + 1][i] = src[i][0]; A[m + 2][i] = src[i][1]; A[m + 3][i] = src[i][2];
    for (let a = 0; a < 3; a++) B[i][a] = dst[i][a]; }
  const X = solveLin(A, B); return { src, w: X.slice(0, m), a: X.slice(m) };
}
export function tpsApply(T, p) { const out = [0, 0, 0], { src, w, a } = T;
  for (let k = 0; k < 3; k++) out[k] = a[0][k] + a[1][k] * p[0] + a[2][k] * p[1] + a[3][k] * p[2];
  for (let i = 0; i < src.length; i++) { const r = sqrt((p[0] - src[i][0]) ** 2 + (p[1] - src[i][1]) ** 2 + (p[2] - src[i][2]) ** 2); out[0] += w[i][0] * r; out[1] += w[i][1] * r; out[2] += w[i][2] * r; }
  return out; }
// Gaussian elimination with partial pivoting: A (N x N) X = B (N x c)
export function solveLin(A0, B0) { const N = A0.length, c = B0[0].length, A = A0.map(r => Float64Array.from(r)), B = B0.map(r => Float64Array.from(r));
  for (let i = 0; i < N; i++) { let p = i; for (let j = i + 1; j < N; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j; [A[i], A[p]] = [A[p], A[i]]; [B[i], B[p]] = [B[p], B[i]];
    const d = A[i][i] || 1e-30; for (let j = i + 1; j < N; j++) { const f = A[j][i] / d; if (!f) continue; for (let k = i; k < N; k++) A[j][k] -= f * A[i][k]; for (let k = 0; k < c; k++) B[j][k] -= f * B[i][k]; } }
  const X = Array.from({ length: N }, () => new Float64Array(c)); for (let i = N - 1; i >= 0; i--) for (let k = 0; k < c; k++) { let s = B[i][k]; for (let j = i + 1; j < N; j++) s -= A[i][j] * X[j][k]; X[i][k] = s / (A[i][i] || 1e-30); }
  return X; }
// ---------------------------------------------------------------- Laplacian tools
// the umbrella vector (neighbour mean - p) at v
export function umbrella(P, adj, v, out = [0, 0, 0]) { const a = adj[v]; out[0] = out[1] = out[2] = 0; if (!a || !a.length) return out; for (const u of a) { out[0] += P[u * 3]; out[1] += P[u * 3 + 1]; out[2] += P[u * 3 + 2]; }
  out[0] = out[0] / a.length - P[v * 3]; out[1] = out[1] / a.length - P[v * 3 + 1]; out[2] = out[2] / a.length - P[v * 3 + 2]; return out; }
// Taubin smoothing (lambda > 0 shrink, mu < 0 inflate: low-pass without the volume loss) of the vertices in `set`; w (0..1) per vertex
export function lowpass(P0, adj, set, o = {}) { const P = Float64Array.from(P0), it = o.iters ?? 10, lam = o.lambda ?? 0.5, mu = o.mu ?? -0.53, w = o.w || null, u = [0, 0, 0], D = new Float64Array(P.length);
  for (let i = 0; i < it * 2; i++) { const f = i % 2 ? mu : lam; for (const v of set) { umbrella(P, adj, v, u); const k = f * (w ? w[v] : 1); D[v * 3] = k * u[0]; D[v * 3 + 1] = k * u[1]; D[v * 3 + 2] = k * u[2]; }
    for (const v of set) { P[v * 3] += D[v * 3]; P[v * 3 + 1] += D[v * 3 + 1]; P[v * 3 + 2] += D[v * 3 + 2]; } }
  return P; }
// vertex normals of a triangle mesh (area-weighted), for the vertices < n
export function vertexNormals(P, tri, n) { const N = new Float64Array(n * 3);
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a >= n || b >= n || c >= n) continue;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const v of [a, b, c]) { N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz; } }
  for (let v = 0; v < n; v++) { const l = sqrt(N[v * 3] ** 2 + N[v * 3 + 1] ** 2 + N[v * 3 + 2] ** 2) || 1; N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l; } return N; }
// a local frame at v on surface B: n (the normal), t1 (toward the first neighbour, in the tangent plane), t2 = n x t1
function frameAt(B, N, adj, v) { const n = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]], a = adj[v]; let t = a && a.length ? [B[a[0] * 3] - B[v * 3], B[a[0] * 3 + 1] - B[v * 3 + 1], B[a[0] * 3 + 2] - B[v * 3 + 2]] : [1, 0, 0];
  const d = t[0] * n[0] + t[1] * n[1] + t[2] * n[2]; t = [t[0] - d * n[0], t[1] - d * n[1], t[2] - d * n[2]]; const l = sqrt(t[0] ** 2 + t[1] ** 2 + t[2] ** 2) || 1; t = [t[0] / l, t[1] / l, t[2] / l];
  return [t, [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]], n]; }
// the detail P - B of each vertex in `set` as (t1, t2, n) coordinates of B's frame
export function encodeDetail(P, B, tri, adj, set, n) { const N = vertexNormals(B, tri, n), D = new Float64Array(n * 3);
  for (const v of set) { const [t1, t2, nn] = frameAt(B, N, adj, v), d = [P[v * 3] - B[v * 3], P[v * 3 + 1] - B[v * 3 + 1], P[v * 3 + 2] - B[v * 3 + 2]];
    D[v * 3] = d[0] * t1[0] + d[1] * t1[1] + d[2] * t1[2]; D[v * 3 + 1] = d[0] * t2[0] + d[1] * t2[1] + d[2] * t2[2]; D[v * 3 + 2] = d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2]; }
  return D; }
// re-apply the detail on a new base B2 (scale: the detail's gain per vertex, default 1)
export function decodeDetail(D, B2, tri, adj, set, n, gain = null) { const N = vertexNormals(B2, tri, n), P = Float64Array.from(B2);
  for (const v of set) { const [t1, t2, nn] = frameAt(B2, N, adj, v), g = gain ? gain[v] : 1, a = D[v * 3] * g, b = D[v * 3 + 1] * g, c = D[v * 3 + 2] * g;
    P[v * 3] += a * t1[0] + b * t2[0] + c * nn[0]; P[v * 3 + 1] += a * t1[1] + b * t2[1] + c * nn[1]; P[v * 3 + 2] += a * t1[2] + b * t2[2] + c * nn[2]; }
  return P; }
