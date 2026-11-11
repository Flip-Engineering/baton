// CLOTH8 (round 7): THE TUCK. A tucked shirt (or tee) goes INTO the waistband: CLOTH4's ring (cloth4.js waistRing) holds the trousers'
// top cloth inside it and hides the shirt's cloth under it, but the shirt itself was left where the solver put it: blousing out over the
// band's top (its hidden part then a torn edge in front of the band) or dipping inside it with nothing between (a dark gap above the
// band at 1:1). Here the shirt's body panels (the panels most of whose cloth near the band lies within its reach: not a sleeve hanging
// at the hip) are mapped radially about the band's own axis (attach7.js frameOf: per sector its inner radius and span):
//   - at the band's top (from `snapLo` under it to `snapHi` over it) every layer is brought to the band's inner face less `gap` (inside
//     the trousers' cloth): cloth outside is compressed onto it (a soft monotonic limit: layers keep their order along every radius),
//     cloth that dipped inside is drawn out towards it (`pull`): the shirt meets the band's edge all round, as a tucked shirt does
//   - under that, down to `below` under the band's lower edge, cloth outside the inner face is compressed into it (the tail inside)
//   - over the top the mapping fades out over `blend` (the blousing above the band is kept, drawn in to the band's edge)
// The moved vertices are pinned for relax8. Plain data: ctx from rebuild8 (welded posed positions edited in place).
import { frameOf } from '../cloth7/attach7.js';
import { weldGarment } from '../cloth7/fold7.js';
import { holeTriangles } from './fill8.js';
export const TUCK8_VERSION = 1;
export const TUCK8 = { owners: ['shirt'], fill: true, drawFrom: 0.012, gap: 0.0017, w: 0.0007, snapLo: 0.02, snapHi: 0.0015, blend: 0.02, below: 0.03, pull: 0.85, reach: 0.02, flare: 0.04 };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function tuck8(ctx) {
  const { parts, P, W, Pws, gar } = ctx, O = { ...TUCK8, ...(ctx.O.tuck || {}) }, rep = {};
  const band = parts.find(q => q.group === 'construction' && q.name === 'waistband'); if (!band) return null; const Xb = P(band); if (Xb.length / 3 % 9) return { skipped: 'profile' };
  const F = frameOf(Xb, 9, 0, 3);
  for (const g of gar.filter(x => O.owners.includes(x.owner))) { const Wg = W.get(g), Pw = Pws.get(g), m = Wg.m, n = g.X.length / 3;
    // body panels: of a panel's cloth within the band's span (+ flare), most lies within its reach (a sleeve passing the hip does not)
    const np = g.panel ? Math.max(...g.panel) + 1 : 1, cs = new Int32Array(np), ci = new Int32Array(np);
    for (let i = 0; i < n; i++) { const k = g.panel ? g.panel[i] : 0, [u, r, th] = F.loc(Pw[Wg.wid[i] * 3], Pw[Wg.wid[i] * 3 + 1], Pw[Wg.wid[i] * 3 + 2]), s = F.at(th); if (u < s.u0 - O.flare || u > s.u1 + O.flare) continue; cs[k]++; if (r < s.rout + O.reach) ci[k]++; }
    const okP = Array.from(cs, (c, k) => c > 0 && ci[k] / c > 0.5), okW = new Uint8Array(m); for (let i = 0; i < n; i++) if (okP[g.panel ? g.panel[i] : 0]) okW[Wg.wid[i]] = 1;
    const pin = new Uint8Array(m); let moved = 0, maxMm = 0, pulled = 0;
    for (let w = 0; w < m; w++) { if (!okW[w]) continue; const x = Pw[w * 3], y = Pw[w * 3 + 1], z = Pw[w * 3 + 2], [u, r, th] = F.loc(x, y, z), s = F.at(th), du = u - s.u1;
      if (du > O.blend || u < s.u0 - O.below) continue; const Rt = s.rin - O.gap, L0 = Rt - O.w;
      const comp = r <= L0 ? r : L0 + O.w * (1 - Math.exp(-(r - L0) / O.w)), snap = r < L0 ? r + O.pull * (L0 - r) : comp;
      let r2;
      if (du >= O.snapHi) r2 = r + sstep(O.blend, O.snapHi, du) * (snap - r);
      else if (du >= -O.snapLo) r2 = snap;
      else { const f = u >= s.u0 ? 1 : sstep(s.u0 - O.below, s.u0, u); r2 = r + f * (comp - r); }
      if (Math.abs(r2 - r) < 1e-6) continue; if (r2 > r) pulled++;
      const d = [x - F.C[0], y - F.C[1], z - F.C[2]], ua = d[0] * F.a[0] + d[1] * F.a[1] + d[2] * F.a[2], ax = [F.C[0] + F.a[0] * ua, F.C[1] + F.a[1] * ua, F.C[2] + F.a[2] * ua], k = r2 / r;
      for (let c = 0; c < 3; c++) Pw[w * 3 + c] = ax[c] + ([x, y, z][c] - ax[c]) * k; pin[w] = 1; moved++; maxMm = Math.max(maxMm, Math.abs(r - r2) * 1000); }
    // the hidden cloth's triangles back (fill8.js), drawn where any corner now lies above `drawFrom` over the band's lower edge (the
    // tail's cut edge is then inside the band, behind it and the trousers' cloth); the rest stays hidden as CLOTH4 had it
    let filled = 0, holes = 0; if (O.fill) { const HT = holeTriangles(g), add = []; holes = HT.length / 3;
      for (let t = 0; t < HT.length; t += 3) { let up = false; for (let k = 0; k < 3; k++) { const w = Wg.wid[HT[t + k]], [u, , th] = F.loc(Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]), s = F.at(th); if (u > s.u0 + O.drawFrom) up = true; } if (up) add.push(HT[t], HT[t + 1], HT[t + 2]); }
      if (add.length) { const T2 = new Int32Array(g.T.length + add.length); T2.set(g.T); T2.set(add, g.T.length); g.T = T2; filled = add.length / 3; const W2 = weldGarment(g); if (W2.m !== m) throw new Error('tuck8: weld changed'); W.set(g, W2); } }
    (ctx.pin ||= new Map()).set(g, pin); rep[g.name] = { moved, pulled, holes, filled, maxMm: +maxMm.toFixed(1), panels: okP.filter(Boolean).length + '/' + np, bandR: +(F.rMean * 1000).toFixed(1) }; ctx.log('tuck8', g.name, JSON.stringify(rep[g.name])); }
  return rep;
}
