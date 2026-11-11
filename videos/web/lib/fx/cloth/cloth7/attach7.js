// CLOTH7 (round 6): BANDS ATTACHED. The construction that is a band round an opening (CLOTH4's waistband ring and cuff joins, K4's rib cuffs
// and hem bands) stays a smooth band (that is what a waistband or a rib cuff is), but the garment cloth it is sewn to is EASED INTO IT, as
// a gathered seam eases cloth into a band: within the band's axial span (plus a flare beyond its ends) every vertex of the attached
// garments is drawn radially inside the band's inner face by a MONOTONIC compression of its radius about the band's axis (r -> a soft
// limit; the layers of a fold keep their order along every radius, so the easing cannot pass a fold through itself), faded out with the
// distance outside the band (cloth well clear of it, a hand at the hip, a pocket bag, is not moved). Before this the cloth that bulged
// past the band's low-passed radius came through it (the band's crossings: the waistband ring 1234 triangles over the twelve, the cuff
// joins 453, the rib bands 906). Positions are edited posed and written back to bind through each vertex's own skin weights.
//   attach7(parts, { M, scale, kinds, log })   parts: unpacked bake parts, edited in place; returns a report
import { skinPose, blendInverse } from '../collide.js';
import * as BM from '../collide.js';
export const ATTACH7_VERSION = 1;
// the swept bands: profile length (vertices per ring), the two rows that give the axis (lo -> hi), the garments eased in, the gap below the
// inner face (m), the flare's length beyond the band's ends (m) and its slope, the easing width (m), the reach outside the band (m)
export const BANDS7 = [
// hold: [below the lo end, beyond the hi end] (m): the cloth is held at the band's inner radius this far past each end before it may flare
// (the cloth leaves a band past its edge, not through it: a 13.5 mm triangle from inside the band to a flared vertex cut the band's edge);
// per owner a gap, or { gap, hold }. The tucked shirt is NOT eased into the waistband: tried, its cloth over the band (CLOTH4 hides what
// lies under the band) then showed the hidden edge as a torn line above the band at 1:1; what crosses the band of the shirt is mostly a
// hanging sleeve or cuff at the hip (it passes the band's whole section), which easing cannot reach
  { re: /^waistband$/, np: 9, lo: 0, hi: 3, owners: { trousers: 0.0003 }, hold: [0.006, 0.006], flare: 0.03, slope: 1.0, w: 0.003, reach: 0.008 },
  { re: /^cuff\.join\.[LR]$/, np: 4, lo: 0, hi: 3, owners: { shirt: 0.0005 }, hold: [0.004, 0.004], flare: 0.02, slope: 1.0, w: 0.0025, reach: 0.006 },
  { re: /^sweat\.cuff\.[LR]$/, np: 9, lo: 0, hi: 4, owners: { top: 0.0006 }, hold: [0.004, 0.004], flare: 0.02, slope: 1.0, w: 0.003, reach: 0.008 },
  { re: /^sweat\.hemband$/, np: 9, lo: 0, hi: 4, owners: { trousers: 0.0006, top: 0.0006 }, hold: [0.004, 0.006], flare: 0.025, slope: 1.0, w: 0.003, reach: 0.008 },
];
const TAU = Math.PI * 2;
export function frameOf(Xp, np, lo, hi) {
  const n = Xp.length / 3, rings = Math.floor(n / np), c = (k) => { const s = [0, 0, 0]; for (let j = 0; j < rings; j++) for (let q = 0; q < 3; q++) s[q] += Xp[(j * np + k) * 3 + q] / rings; return s; };
  const cl = c(lo), ch = c(hi); let a = [ch[0] - cl[0], ch[1] - cl[1], ch[2] - cl[2]]; const al = Math.hypot(...a) || 1; a = a.map(x => x / al);
  const C = [0, 0, 0]; for (let v = 0; v < n; v++) for (let q = 0; q < 3; q++) C[q] += Xp[v * 3 + q] / n;
  const ref = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], b1n = [a[1] * ref[2] - a[2] * ref[1], a[2] * ref[0] - a[0] * ref[2], a[0] * ref[1] - a[1] * ref[0]], bl = Math.hypot(...b1n), b1 = b1n.map(x => x / bl), b2 = [a[1] * b1[2] - a[2] * b1[1], a[2] * b1[0] - a[0] * b1[2], a[0] * b1[1] - a[1] * b1[0]];
  const loc = (x, y, z) => { const d = [x - C[0], y - C[1], z - C[2]], u = d[0] * a[0] + d[1] * a[1] + d[2] * a[2], p1 = d[0] * b1[0] + d[1] * b1[1] + d[2] * b1[2], p2 = d[0] * b2[0] + d[1] * b2[1] + d[2] * b2[2]; return [u, Math.hypot(p1, p2), Math.atan2(p2, p1)]; };
  // per ring (sector): its angle, inner and outer radius, axial span (the last ring repeats the first: left out)
  const R = []; for (let j = 0; j < rings - 1; j++) { let rin = Infinity, rout = 0, u0 = Infinity, u1 = -Infinity, sx = 0, sy = 0; for (let k = 0; k < np; k++) { const v = j * np + k, [u, r, th] = loc(Xp[v * 3], Xp[v * 3 + 1], Xp[v * 3 + 2]); rin = Math.min(rin, r); rout = Math.max(rout, r); u0 = Math.min(u0, u); u1 = Math.max(u1, u); sx += Math.cos(th); sy += Math.sin(th); }
    R.push({ th: Math.atan2(sy, sx), rin, rout, u0, u1 }); }
  R.sort((p, q) => p.th - q.th); const at = th => { const m = R.length; let i = R.findIndex(q => q.th > th); if (i < 0) i = m; const A = R[(i - 1 + m) % m], B = R[i % m]; let da = B.th - A.th; if (da <= 0) da += TAU; let t = th - A.th; if (t < 0) t += TAU; const f = Math.min(1, Math.max(0, t / da));
    return { rin: A.rin + (B.rin - A.rin) * f, rout: A.rout + (B.rout - A.rout) * f, u0: A.u0 + (B.u0 - A.u0) * f, u1: A.u1 + (B.u1 - A.u1) * f }; };
  const rMean = R.reduce((s, q) => s + q.rin, 0) / R.length, uLo = Math.min(...R.map(q => q.u0)), uHi = Math.max(...R.map(q => q.u1));
  return { C, a, b1, b2, loc, at, rMean, uLo, uHi };
}
export function attach7(parts, { M, scale, bands = BANDS7, log = () => {} } = {}) {
  const rep = { version: ATTACH7_VERSION, bands: [] }, posed = new Map(), pose = q => { if (!posed.has(q)) posed.set(q, skinPose(Float64Array.from(q.X, x => x / scale), q.SI, q.SW, M, new Float64Array(q.X.length), scale)); return posed.get(q); };
  const dirty = new Set();
  for (const b of parts.filter(q => q.group === 'construction')) { const B = bands.find(x => x.re.test(b.name)); if (!B) continue; const Xb = pose(b); if (Xb.length / 3 % B.np) { rep.bands.push({ name: b.name, skipped: 'profile' }); continue; }
    const F = frameOf(Xb, B.np, B.lo, B.hi), r0 = { name: b.name, rMeanMm: +(F.rMean * 1000).toFixed(1), spanMm: +((F.uHi - F.uLo) * 1000).toFixed(1), moved: {} };
    for (const [owner, ov] of Object.entries(B.owners)) { const gap = typeof ov === 'number' ? ov : ov.gap, hold = (typeof ov === 'object' && ov.hold) || B.hold || [0, 0]; const g = parts.find(q => q.group === 'garment' && q.owner === owner); if (!g) continue; const Xg = pose(g), n = Xg.length / 3;
      // panels attached to this band: of a panel's vertices within the band's axial span (+ flare, per sector), most lie within its reach
      // radially (the trousers and the tucked shirt at the waistband, the sleeve and cuff at a cuff); a sleeve passing the waistband or the
      // trunk beside a cuff has few of its span's vertices in reach: left alone
      const np = g.panel ? Math.max(...g.panel) + 1 : 1, cs = new Int32Array(np), ci = new Int32Array(np);
      for (let v = 0; v < n; v++) { const k = g.panel ? g.panel[v] : 0, [u, r, th] = F.loc(Xg[v * 3], Xg[v * 3 + 1], Xg[v * 3 + 2]), s = F.at(th); if (u < s.u0 - B.flare || u > s.u1 + B.flare) continue; cs[k]++; if (r < s.rout + B.reach) ci[k]++; }
      const okP = Array.from(cs, (c, k) => c > 0 && ci[k] / c > 0.5);
      let moved = 0, maxMm = 0; const tmp = [0, 0, 0];
      // seam duplicates (one position, several panels) move together: attached if any of their panels is
      const grp = new Map(), key = v => `${Math.round(g.X[v * 3] * 1e5)},${Math.round(g.X[v * 3 + 1] * 1e5)},${Math.round(g.X[v * 3 + 2] * 1e5)}`; for (let v = 0; v < n; v++) { const k = key(v); (grp.get(k) || grp.set(k, []).get(k)).push(v); }
      for (const vs of grp.values()) { const v = vs[0]; if (g.panel && !vs.some(i => okP[g.panel[i]])) continue; const x = Xg[v * 3], y = Xg[v * 3 + 1], z = Xg[v * 3 + 2], [u, r] = F.loc(x, y, z), [, , th] = F.loc(x, y, z), s = F.at(th);
        const below = s.u0 - u, above = u - s.u1, beyond = Math.max(0, below, above); const range = B.flare + Math.min(0.02, below > 0 ? hold[0] : hold[1]); if (beyond > range) continue; const fade = (r <= s.rout + B.reach ? 1 : r >= s.rout + 2 * B.reach ? 0 : 1 - (r - s.rout - B.reach) / B.reach) * Math.min(1, (range - beyond) / 0.01); if (!fade) continue;
        const L = s.rin - gap + B.slope * Math.max(0, beyond - (below > 0 ? hold[0] : above > 0 ? hold[1] : 0)), L0 = L - B.w; if (r <= L0) continue; const rc = L0 + B.w * (1 - Math.exp(-(r - L0) / B.w)), r2 = r + fade * (rc - r); if (r - r2 < 1e-6) continue;
        const k = r2 / r, d = [x - F.C[0], y - F.C[1], z - F.C[2]], ua = d[0] * F.a[0] + d[1] * F.a[1] + d[2] * F.a[2], ax = F.C.map((c, q) => c + F.a[q] * ua), nx = ax[0] + (x - ax[0]) * k, ny = ax[1] + (y - ax[1]) * k, nz = ax[2] + (z - ax[2]) * k;
        blendInverse(g.SI, g.SW, v, M, nx / scale, ny / scale, nz / scale, tmp, 0); for (const i of vs) { for (let q = 0; q < 3; q++) g.X[i * 3 + q] = Math.round(tmp[q] * scale * 1e4) / 1e4; Xg[i * 3] = nx; Xg[i * 3 + 1] = ny; Xg[i * 3 + 2] = nz; }
        moved++; maxMm = Math.max(maxMm, (r - r2) * 1000); dirty.add(g); }
      r0.moved[owner] = { verts: moved, maxMm: +maxMm.toFixed(1), panels: okP.filter(Boolean).length + '/' + np }; }
    rep.bands.push(r0); log('attach7', JSON.stringify(r0)); }
  rep.garmentsEdited = [...dirty].map(g => g.name); return rep;
}
// a test for points OUTSIDE a swept band (the waistband ring), posed with the hero's current pose: outside its outer face by `out` within
// its span, from `below` under its lower end to `above` over its upper end (bake4.js hideCovered's keep, opt-in fix5.coverKeep)
export function outsideBand(part, { h, scale, below = 0.03, above = 0.01, out = 0.0005, np = 9, lo = 0, hi = 3 } = {}) {
  h.group.updateMatrixWorld(true); const { boneMats } = BM; const M = boneMats(h.skeleton, h.body.matrixWorld), Xp = skinPose(Float64Array.from(part.X, x => x / scale), part.SI, part.SW, M, new Float64Array(part.X.length), scale), F = frameOf(Xp, np, lo, hi);
  return (x, y, z) => { const [u, r, th] = F.loc(x, y, z), s = F.at(th); return r > s.rout + out && u > s.u0 - below && u < s.u1 + above; };
}
