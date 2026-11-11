// PLACE4 (CLOTHING K4, the wardrobe): start positions for the wardrobe's panels that K2's place.js does not wrap. place.js's wraps (torso,
// arm, neck, wrist, leg, suit) are used as they are (placeGarment); this adds:
//   skirt  a gore of a circle skirt (sewmaps/skirt.js) round the hips from the waist down: in polar coordinates about the gore's apex (where
//          its straight edges meet), the angle from the centre edge (0) to the side edge (1) is the fraction round the body's offset hull
//          from the centre line (front or back) to the side, and the distance from the waist arc is the drop down the cone; the hull is the
//          body's section at that height (the hip's below the hip: the widest), scaled out where the gore is wider than the hull (the flare)
// placeWardrobe(g, B, { clear, waistY }) = placeGarment for every other panel, then the skirt wrap over it. Bind frame, metres.
import { placeGarment } from '../pattern/place.js';
export const PLACE4_VERSION = 1;

export function placeWardrobe(g, B, { clear = 0.016, waistY = null, bentArm = true, clearLow = null } = {}) {
  const X = placeGarment(g, B, { clear, bentArm, ...(clearLow != null ? { clearLow } : {}), ...(g.panels.some(p => p.spec?.place?.wrap === 'leg') && waistY != null ? { waistY } : {}) });
  for (const pn of g.panels) if (pn.spec?.place?.wrap === 'skirt') placeSkirt(pn, pn.spec.place, B, X, clear, waistY);
  return X;
}

function placeSkirt(pn, pl, B, X, clear, waistY) {
  const V = pn.V, n = pn.n, o = pn.base, tg = pn.tags, O = pn.outline, P2 = k => [O[tg[k] * 2], O[tg[k] * 2 + 1]];
  const c0 = P2(pl.center[0]), c1 = P2(pl.center[1]), e0 = P2(pl.edge[0]), e1 = P2(pl.edge[1]);
  // the apex: where the centre edge and the side edge (extended up) meet
  const d1 = [c1[0] - c0[0], c1[1] - c0[1]], d2 = [e1[0] - e0[0], e1[1] - e0[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
  const s = Math.abs(den) > 1e-9 ? ((e0[0] - c0[0]) * d2[1] - (e0[1] - c0[1]) * d2[0]) / den : -10, A = [c0[0] + d1[0] * s, c0[1] + d1[1] * s];
  const ang = (q) => Math.atan2(q[1] - A[1], q[0] - A[0]), aC = ang(c0), aE = ang(e0); let span = aE - aC; while (span > Math.PI) span -= 2 * Math.PI; while (span < -Math.PI) span += 2 * Math.PI;
  const rhoW = Math.hypot(c0[0] - A[0], c0[1] - A[1]), front = pl.face !== 'back', sg = pl.side === 'L' ? 1 : -1;
  const yHip = B.levels?.hip ?? -Infinity, y0 = waistY ?? (B.levels?.naturalWaist ?? 1.0), walks = new Map();
  for (let i = 0; i < n; i++) {
    const q = [V[i * 2], V[i * 2 + 1]], rho = Math.hypot(q[0] - A[0], q[1] - A[1]); let da = ang(q) - aC; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    const f = Math.max(0, Math.min(1, da / span)), drop = Math.max(0, rho - rhoW), y = y0 - drop * 0.97, sec = B.at(Math.max(yHip, Math.min(y, y0)));
    const key = (front ? 'f' : 'b') + Math.round(sec.y * 100); let Wk = walks.get(key); if (!Wk) walks.set(key, Wk = hullWalk(sec.hull, clear, front));
    const h = Wk.at(f), zc = Wk.zc, k = Math.max(1, rho * Math.abs(span) / Wk.L);
    X[(o + i) * 3] = sg * h[0] * k; X[(o + i) * 3 + 1] = y; X[(o + i) * 3 + 2] = zc + (h[1] - zc) * k;
  }
}

// convex hull (x, z), counter-clockwise; the hull offset by `clear` and walked from the front (or back) midline to the side (place.js's,
// which it does not export): at(f) for f in [0, 1] -> [x >= 0, z]; L the walk's length; zc the section's centre in z
function hull2(pts) { const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1)); }
export function hullWalk(H0, clear, front) {
  const H = H0.length > 2 ? H0 : hull2(H0), n = H.length, O = H.map((p, i) => { const a = H[(i - 1 + n) % n], b = H[(i + 1) % n], t = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(t[0], t[1]) || 1; return [p[0] + t[1] / l * clear, p[1] - t[0] / l * clear]; });
  let zF = -Infinity, zB = Infinity; for (let i = 0; i < n; i++) { const a = O[i], b = O[(i + 1) % n]; if ((a[0] <= 0 && b[0] >= 0) || (a[0] >= 0 && b[0] <= 0)) { const t = Math.abs(b[0] - a[0]) > 1e-9 ? -a[0] / (b[0] - a[0]) : 0, z = a[1] + (b[1] - a[1]) * t; zF = Math.max(zF, z); zB = Math.min(zB, z); } }
  if (!isFinite(zF)) { zF = Math.max(...O.map(p => p[1])); zB = Math.min(...O.map(p => p[1])); }
  const zc = (zF + zB) / 2, ang = p => Math.atan2(p[0], p[1] - zc), side = O.reduce((m, p) => (p[0] > m[0] ? p : m), [-Infinity, 0]), aS = ang(side);
  const half = O.filter(p => p[0] > 1e-5).map(p => [p, ang(p)]).filter(([, a]) => (front ? a < aS : a > aS)).sort((x, y) => (front ? x[1] - y[1] : y[1] - x[1])).map(q => q[0]);
  const path = [[0, front ? zF : zB], ...half, side], cum = [0]; for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const L = cum[cum.length - 1] || 1e-6;
  return { L, zc, at: f => { const d = Math.max(0, Math.min(1, f)) * L; let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t]; } };
}
