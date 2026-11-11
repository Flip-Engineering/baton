// ANAT8 layer core: the SKIN ENVELOPE as a MEMBRANE (ANAT8-HEAD, 8 Oct; shared with ANAT8-BODY).
// The skin is the surface { x : f(x) = 0 } with f = phi_sub(x) - s(x) (phi_sub: the signed distance of everything under the skin; s: the
// skin's own thickness there). A real skin is a membrane: it does not pass into the tissue under it (CONTACT), it is held to it everywhere
// by the subcutaneous retinacula (a weak ATTRACTION), tied to the bone along the retaining ligaments (TETHERS), and its tension BRIDGES
// concavities narrower than its own stiffness (the space filled by loose fat). So the solve is: minimise
//     sum_v [ f(x_v) < 0 ? contact : w_v ] f(x_v)^2  +  alpha_v |L x_v - delta_v|^2  +  sum_tethers k (tether residual)^2
// by a local / global Jacobi scheme (membrane step, then each vertex projected along grad f by its weighted residual, then the tethers),
// with delta (the reference Laplacian, e.g. hm08's high-frequency detail) kept so small features ride on the solved form.
//   const r = solveEnvelope({ P, adj, set, level, grad?, w, contact, alpha, detail?, tethers?, iters, maxStep })
//   r.P (Float64Array, the solved positions; vertices outside `set` untouched), r.report { iters, mean, p95, max, inside, ms }
// level(x, y, z) -> f (mm; > 0 outside the target surface); grad(x, y, z, out) -> unit gradient (default: central differences of level).
// tethers: [{ v, k, f(x, y, z), g(x, y, z, out) }]: a second level the vertex is pulled onto (e.g. phi_bone - depth at the ligament), or
//          [{ v, k, p: [x, y, z] }]: a spring to a point.
import { umbrella } from './fit.js';
const abs = Math.abs, sqrt = Math.sqrt;
export function solveEnvelope(o) {
  const t0 = Date.now(), P = Float64Array.from(o.P), adj = o.adj, set = Int32Array.from(o.set), n = P.length / 3, it = o.iters ?? 120, maxStep = o.maxStep ?? 1.5;
  const level = o.level, grad = o.grad || ((x, y, z, g) => { const e = 0.25, gx = level(x + e, y, z) - level(x - e, y, z), gy = level(x, y + e, z) - level(x, y - e, z), gz = level(x, y, z + e) - level(x, y, z - e), l = sqrt(gx * gx + gy * gy + gz * gz) || 1; g[0] = gx / l; g[1] = gy / l; g[2] = gz / l; return g; });
  const W = typeof o.w === 'number' || o.w == null ? null : o.w, w0 = typeof o.w === 'number' ? o.w : 0.5, contact = o.contact ?? 0.9;
  const AL = typeof o.alpha === 'number' || o.alpha == null ? null : o.alpha, a0 = typeof o.alpha === 'number' ? o.alpha : 0.35, Dl = o.detail || null, T = o.tethers || [];
  const U = new Float64Array(n * 3), u = [0, 0, 0], g = [0, 0, 0], free = new Uint8Array(n); for (const v of set) free[v] = 1;
  for (let i = 0; i < it; i++) {
    // membrane: x += alpha (L x - delta), Jacobi
    for (const v of set) { umbrella(P, adj, v, u); const a = AL ? AL[v] : a0; U[v * 3] = a * (u[0] - (Dl ? Dl[v * 3] : 0)); U[v * 3 + 1] = a * (u[1] - (Dl ? Dl[v * 3 + 1] : 0)); U[v * 3 + 2] = a * (u[2] - (Dl ? Dl[v * 3 + 2] : 0)); }
    for (const v of set) { P[v * 3] += U[v * 3]; P[v * 3 + 1] += U[v * 3 + 1]; P[v * 3 + 2] += U[v * 3 + 2]; }
    // data: contact (never inside) and attraction (held to the layer below)
    for (const v of set) { const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], f = level(x, y, z); if (!Number.isFinite(f)) continue; const k = f < 0 ? contact : (W ? W[v] : w0); if (k <= 0) continue;
      let s = k * f; if (s > maxStep) s = maxStep; else if (s < -maxStep) s = -maxStep; grad(x, y, z, g); P[v * 3] -= s * g[0]; P[v * 3 + 1] -= s * g[1]; P[v * 3 + 2] -= s * g[2]; }
    // tethers
    for (const t of T) { const v = t.v; if (!free[v]) continue;
      if (t.p) { P[v * 3] += t.k * (t.p[0] - P[v * 3]); P[v * 3 + 1] += t.k * (t.p[1] - P[v * 3 + 1]); P[v * 3 + 2] += t.k * (t.p[2] - P[v * 3 + 2]); continue; }
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], f = t.f(x, y, z); let s = t.k * f; if (s > maxStep) s = maxStep; else if (s < -maxStep) s = -maxStep; (t.g || grad)(x, y, z, g); P[v * 3] -= s * g[0]; P[v * 3 + 1] -= s * g[1]; P[v * 3 + 2] -= s * g[2]; }
  }
  // residuals over the vertices that are meant to sit on the surface (weight > 0.5, or all when no weights)
  const R = []; let inside = 0; for (const v of set) { if (W && W[v] < 0.5) continue; const f = level(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); R.push(abs(f)); if (f < -0.3) inside++; }
  R.sort((a, b) => a - b); const q = p => R.length ? +R[Math.min(R.length - 1, Math.floor(p * R.length))].toFixed(3) : null;
  return { P, report: { iters: it, n: R.length, mean: R.length ? +(R.reduce((a, b) => a + b, 0) / R.length).toFixed(3) : null, p50: q(0.5), p95: q(0.95), max: q(1), inside, ms: Date.now() - t0 } };
}
// the skin's level function from a sampled sub-dermal field and a thickness function: f = phi_sub - s
export function skinLevel(sub, s) { return typeof s === 'number' ? (x, y, z) => sub.value(x, y, z) - s : (x, y, z) => sub.value(x, y, z) - s(x, y, z); }
