// CLOTH8 (round 7): NECKBANDS AS FOLDED CLOTH. K4's rib neckband (trim4.js band) was a profile swept round a smoothed frame of the neck
// loop, reaching `over` 5 mm back onto the tee's cloth on both faces: wherever the cloth at the neckline wrinkled, the band's lower part
// and the cloth passed through each other (tee neckbands 302 -> 246 crossing triangles after CLOTH7, untouched there). Here the band is
// cloth continuing from the garment's OWN neck edge: a strip of rib folded lengthwise, its outer layer starting AT the edge (the edge's
// own vertices are its first row: no seam to open), rising `H` beyond it along the cloth's outward tangent (smoothed along the edge,
// drawn in by `taper` towards the neck, held `gap` off the skin), folded round at its top and coming back down inside to `t2` under the
// edge (sewn there). It never reaches back over the cloth, so it cannot cross it at the join. Same name, tag, fabric and colour as K4's.
// Every vertex carries the skin weights of the edge vertex it rises from. Plain data; ctx from rebuild8 (posed, after the garments are
// final).   band8(ctx) -> { name: report }
import { blendInverse, vertexNormals } from '../collide.js';
import { outwardSign } from '../cloth7/fold7.js';
export const BAND8_VERSION = 2;   // (8 Oct: rev 2, the band as one smooth folded strip; rev 1's path deleted c3 it1)
export const NECK8 = [
  { re: /^tee\.neckband$/, H: 0.016, taper: 0.06, t: 0.0011, rows: 5 },
  { re: /^sweat\.neckband$/, H: 0.022, taper: 0.08, t: 0.0014, rows: 6 },
  // (8 Oct) the sweatshirt's RIB CUFFS and HEM BAND the same way from the sleeve's and the body's own free edge: K4's were swept tubes
  // that hung off the forearm (L21, L14: the tabs at the wrists at 270 px) and tore at the hips (sweat.hemband through itself 511)
  // (a rib cuff whose sleeve ends well above it, pushed up or rolled to the elbow (L21, L14): K4's cuff hung off the forearm as a loose
  // tube, the tab at the wrist at 270 px; a cuff from that edge drawn in to the forearm made a flat washer: it is DROPPED from the bake,
  // the cuff read as gathered inside the roll)
  { re: /^sweat\.cuff\.[LR]$/, H: 0.055, taper: 0.2, t: 0.0016, rows: 7, maxD: 0.16, hug: null, dropFar: 0.06 },
  // (c3 it3) the sweatshirt's RIB HEM BAND from the body's own hem edge, IN TENSION ROUND WHAT IS UNDER IT (`hem`: hemTube8 below). K4's
  // band was a profile swept round a smoothed frame of the hem, 6.8 cm tall, reaching 16 mm back over the cloth: it crossed itself
  // (L21 276, L14 253 of its 1152 triangles), stood off the hips 2-4 cm over a third of the way round (L14), and the jeans' pocket bags
  // came through it (L21): the critic's 'stiff flat belt' with 'a denim shard through it'. (Laid from the edge along the cloth's own
  // tangent, as the neckband is, the hem's puckers made a sawtooth band at 1:1: rev 1, tried and dropped.)
  { re: /^sweat\.hemband$/, H: 0.062, taper: 0, t: 0.0016, rows: 8, hem: true, gather: 0.035 },
];
// (c3 it3) A RIB BAND IN TENSION lies on the CONVEX HULL of what is under it at each height (an elastic ring bridges every hollow, as a
// string round a section does) plus its clearance: the band's own axis (the hem loop's plane normal, down from the cloth), each column
// at its edge point's angle round that axis, its height along the axis from the edge's (low-passed) height; under it the skin (the full
// body's vertices, the forearms and hands left out) and the trousers with what is sewn on them and the underwear (never the garment
// itself or a layer over it). Slabs `slab` (1 cm) apart, each the hull of the points within a slab of it (5 mm slabs, tried: the
// band no closer to what is under it, and more columns folded against the cloth: L14 band through the top 2 -> 46), read at the column's angle (a ray from
// the axis to the hull's edge) and interpolated between slabs. -> { at(i, u, r), R(i, u), out(i, u) } (u down the band from the edge)
export function hemTube8(ctx, { g, P0, PS, ids, H, ease = 0.001, slab = 0.01 }) {
  const n = P0.length, C = [0, 0, 0]; for (const p of PS) for (let k = 0; k < 3; k++) C[k] += p[k] / n;
  // the loop's plane normal: the direction of least spread of the low-passed loop (inverse power iteration), turned away from the cloth
  const Cv = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const p of PS) { const d = [p[0] - C[0], p[1] - C[1], p[2] - C[2]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Cv[i][j] += d[i] * d[j] + (i === j ? 1e-9 : 0); }
  const inv3 = m => { const [a, b, c] = m[0], [d, e, f] = m[1], [gg, hh, ii] = m[2], A = e * ii - f * hh, B = -(d * ii - f * gg), Cc = d * hh - e * gg, det = a * A + b * B + c * Cc; return [[A / det, -(b * ii - c * hh) / det, (b * f - c * e) / det], [B / det, (a * ii - c * gg) / det, -(a * f - c * d) / det], [Cc / det, -(a * hh - b * gg) / det, (a * e - b * d) / det]]; };
  const Ci = inv3(Cv); let ax = [0, -1, 0]; for (let it = 0; it < 40; it++) { const y = Ci.map(r => r[0] * ax[0] + r[1] * ax[1] + r[2] * ax[2]), l = Math.hypot(...y) || 1; ax = y.map(x => x / l); }
  // away from the cloth: the garment's own cloth lies above its hem edge (the mean of the cloth's vertices near the edge, not on it)
  { const Pg = ctx.P(g), on = new Set(ids.map(w => ctx.W.get(g).rep[w])); let s = 0; const nv = Pg.length / 3; for (let v = 0; v < nv; v++) { if (on.has(v)) continue; const d = (Pg[v * 3] - C[0]) * ax[0] + (Pg[v * 3 + 1] - C[1]) * ax[1] + (Pg[v * 3 + 2] - C[2]) * ax[2]; if (Math.abs(d) < 0.12) s += d; } if (s > 0) ax = ax.map(x => -x); }
  const e1 = Math.abs(ax[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1], d1 = e1[0] * ax[0] + e1[1] * ax[1] + e1[2] * ax[2], U0 = [e1[0] - d1 * ax[0], e1[1] - d1 * ax[1], e1[2] - d1 * ax[2]], lu = Math.hypot(...U0), U = U0.map(x => x / lu), V = [ax[1] * U[2] - ax[2] * U[1], ax[2] * U[0] - ax[0] * U[2], ax[0] * U[1] - ax[1] * U[0]];
  const loc = p => { const d = [p[0] - C[0], p[1] - C[1], p[2] - C[2]]; return [d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2], d[0] * U[0] + d[1] * U[1] + d[2] * U[2], d[0] * V[0] + d[1] * V[1] + d[2] * V[2]]; };
  const s0 = PS.map(p => loc(p)[0]), th = P0.map(p => { const l = loc(p); return Math.atan2(l[2], l[1]); }), rEdge = P0.map(p => { const l = loc(p); return Math.hypot(l[1], l[2]); });
  const sLo = Math.min(...s0) - 0.015, sHi = Math.max(...s0) + H + 0.015, rCap = 1.6 * Math.max(...rEdge);
  // what is under the band: the skin (forearms and hands out), the trousers and their sewn parts, the underwear
  const pts = []; const add = (X, keep = null) => { for (let v = 0; v < X.length / 3; v++) { if (keep && !keep(v)) continue; const l = loc([X[v * 3], X[v * 3 + 1], X[v * 3 + 2]]); if (l[0] < sLo || l[0] > sHi) continue; const r = Math.hypot(l[1], l[2]); if (r > rCap) continue; pts.push(l[0], l[1], l[2]); } };
  if (ctx.body?.X) { const aL = ctx.J?.armL, aR = ctx.J?.armR; add(ctx.body.X, aL && aR ? v => !aL[v] && !aR[v] : null); }
  const under = ctx.parts.filter(q => q !== g && q.T?.length && (q.group === 'found' || (q.group === 'garment' && q.name === 'trousers') || (q.group === 'construction' && q.owner === 'trousers')));
  for (const q of under) add(ctx.P(q));
  // the slabs' hulls (monotone chain), `slab` apart, each from the points within a slab of it
  const SL = [], dz = slab; for (let s = sLo; s <= sHi + 1e-9; s += dz) { const P2 = []; for (let i = 0; i < pts.length; i += 3) if (Math.abs(pts[i] - s) <= dz) P2.push([pts[i + 1], pts[i + 2]]);
    if (P2.length < 3) { SL.push(null); continue; } P2.sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], hi = [];
    for (const p of P2) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); } for (let i = P2.length - 1; i >= 0; i--) { const p = P2[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    SL.push(lo.slice(0, -1).concat(hi.slice(0, -1))); }
  // the hull's radius along the ray at angle a (the axis inside the hull; else the farthest hull point within 20 deg of it)
  const ray = (Hl, a) => { const dx = Math.cos(a), dy = Math.sin(a); let best = 0; for (let k = 0; k < Hl.length; k++) { const p = Hl[k], q = Hl[(k + 1) % Hl.length], ex = q[0] - p[0], ey = q[1] - p[1], den = dx * ey - dy * ex; if (Math.abs(den) < 1e-12) continue; const tt = (p[0] * ey - p[1] * ex) / den, ss = (p[0] * dy - p[1] * dx) / den; if (tt > 0 && ss >= -1e-9 && ss <= 1 + 1e-9) best = Math.max(best, tt); }
    if (best > 0) return best; for (const p of Hl) { const r = Math.hypot(p[0], p[1]); if (Math.abs(Math.atan2(Math.sin(Math.atan2(p[1], p[0]) - a), Math.cos(Math.atan2(p[1], p[0]) - a))) < 0.35) best = Math.max(best, r); } return best || null; };
  const slabR = (k, a) => { for (let d = 0; d < SL.length; d++) for (const kk of [k - d, k + d]) if (kk >= 0 && kk < SL.length && SL[kk]) { const r = ray(SL[kk], a); if (r) return r; } return null; };
  const cache = new Map(), Rat = (i, s) => { const f = (s - sLo) / dz, k = Math.max(0, Math.min(SL.length - 2, Math.floor(f))), w = Math.max(0, Math.min(1, f - k)), key = i * 4096 + k; let rr = cache.get(key); if (!rr) cache.set(key, rr = [slabR(k, th[i]), slabR(k + 1, th[i])]); const a = rr[0] ?? rr[1] ?? rEdge[i], b = rr[1] ?? rr[0] ?? rEdge[i]; return a + (b - a) * w; };
  // the hull read round the band is low-passed a little (never inside the raw hull: an elastic ring does not dip between columns)
  const Rsm = (i, s) => { const r0 = Rat(i, s), rp = Rat((i - 1 + n) % n, s), rn = Rat((i + 1) % n, s); return Math.max(r0, (2 * r0 + rp + rn) / 4) + ease; };
  const at = (i, u, r) => { const s = s0[i] + u, c = Math.cos(th[i]), sn = Math.sin(th[i]); return [C[0] + ax[0] * s + (U[0] * c + V[0] * sn) * r, C[1] + ax[1] * s + (U[1] * c + V[1] * sn) * r, C[2] + ax[2] * s + (U[2] * c + V[2] * sn) * r]; };
  // the hull's radius at any angle and height (the body cloth gathered onto the band reads it)
  const Rth = (a, s) => { const f = (s - sLo) / dz, k = Math.max(0, Math.min(SL.length - 2, Math.floor(f))), w = Math.max(0, Math.min(1, f - k)), r0 = slabR(k, a), r1 = slabR(k + 1, a); if (r0 == null && r1 == null) return null; const a0 = r0 ?? r1, b0 = r1 ?? r0; return a0 + (b0 - a0) * w + ease; };
  return { at, R: (i, u) => Rsm(i, s0[i] + u), Rth, loc, out: i => { const c = Math.cos(th[i]), sn = Math.sin(th[i]); return [U[0] * c + V[0] * sn, U[1] * c + V[1] * sn, U[2] * c + V[2] * sn]; }, ax, C, under: under.map(q => q.name), pts: pts.length / 3, slabs: SL.filter(Boolean).length + '/' + SL.length };
}
export const BAND8 = { gap: 0.0018, smooth: 4, kFold: 4, loopSmooth: 8, flat: 0.4, ribEase: 0.0045 };   // (c8 it1, 15 Oct: the rib HEM BAND is ON for every sweatshirt: c3 it3's A/B switch `hem` and its candidate bakes are deleted (the review gate is abolished); its read on 1009-001511 (the gather a hard zigzag on L21, a dark gap on L14) is the bug list)
export function band8(ctx) {
  const { parts, P, W, M, scale, bodySurf, body } = ctx, O = { ...BAND8, ...(ctx.O.band || {}) }, rep = {};
  for (let pi = 0; pi < parts.length; pi++) { const q = parts[pi], spec = NECK8.find(s => s.re.test(q.name)); if (!spec || q.group !== 'construction') continue;
    const g = parts.find(x => x.group === 'garment' && (x.owner === q.owner || x.name === q.owner)); if (!g) continue;
    const Wg = W.get(g) || null; if (!Wg) continue; const Pp = P(g), m = Wg.m, Pw = new Float64Array(m * 3); for (let w = 0; w < m; w++) for (let c = 0; c < 3; c++) Pw[w * 3 + c] = Pp[Wg.rep[w] * 3 + c];
    // the neck loop: the drawn boundary loop nearest the old band (its vertices' mean distance to the band's)
    const Pq = P(q); let cq = [0, 0, 0]; for (let v = 0; v < Pq.length / 3; v++) for (let c = 0; c < 3; c++) cq[c] += Pq[v * 3 + c] / (Pq.length / 3);
    let best = null, bd = Infinity; for (const L of Wg.loops) { if (L.ids.length < 10 || !L.closed) continue; let c = [0, 0, 0]; for (const w of L.ids) for (let k = 0; k < 3; k++) c[k] += Pw[w * 3 + k] / L.ids.length; const d = Math.hypot(c[0] - cq[0], c[1] - cq[1], c[2] - cq[2]); if (d < bd) { bd = d; best = L; } }
    // (rev 2) a rib cuff whose sleeve rib8 gathered onto the forearm: its loop is rib8's (the same edge, now a ring on the arm)
    const RB = ctx.rib8?.get(q) || null; if (RB) { best = { ids: RB.ids, closed: true }; bd = 0; }
    if (!best || bd > (spec.maxD ?? 0.05)) { rep[q.name] = { skipped: 'no edge loop', d: bd }; continue; }
    if (!RB && spec.dropFar != null && bd > spec.dropFar) { (ctx.drop8 ||= new Set()).add(q); rep[q.name] = { dropped: 'its sleeve ends ' + (bd * 100).toFixed(1) + ' cm away (pushed up / rolled)' }; ctx.log('band8', q.name, JSON.stringify(rep[q.name])); continue; }
    const ids = best.ids, n = ids.length, Nw = vertexNormals(Pw, Wg.T), sg = outwardSign(Pw, Nw, body); if (sg < 0) for (let i = 0; i < Nw.length; i++) Nw[i] = -Nw[i];
    // per edge vertex: the cloth's normal, its outward tangent (away from the cloth's own interior), the loop's centre
    const on = new Set(ids), acc = new Map(ids.map(w => [w, [0, 0, 0, 0]])); for (let t = 0; t < Wg.T.length; t += 3) for (let k = 0; k < 3; k++) { const a = Wg.T[t + k]; if (!acc.has(a)) continue; for (const b of [Wg.T[t + (k + 1) % 3], Wg.T[t + (k + 2) % 3]]) { if (on.has(b)) continue; const s = acc.get(a); s[0] += Pw[b * 3]; s[1] += Pw[b * 3 + 1]; s[2] += Pw[b * 3 + 2]; s[3]++; } }
    let C = [0, 0, 0]; for (const w of ids) for (let k = 0; k < 3; k++) C[k] += Pw[w * 3 + k] / n;
    let N = ids.map(w => [Nw[w * 3], Nw[w * 3 + 1], Nw[w * 3 + 2]]), D = ids.map((w, i) => { const s = acc.get(w), p = [Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]]; let d = s[3] ? [p[0] - s[0] / s[3], p[1] - s[1] / s[3], p[2] - s[2] / s[3]] : [0, 1, 0]; const nn = N[i], dn = d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2]; d = [d[0] - dn * nn[0], d[1] - dn * nn[1], d[2] - dn * nn[2]]; const l = Math.hypot(...d) || 1; return d.map(x => x / l); });
    // smoothed along the loop (a rib band does not follow every pucker of the edge)
    const sm = A => { for (let it = 0; it < O.smooth; it++) A = A.map((a, i) => { const p = A[(i - 1 + n) % n], q2 = A[(i + 1) % n], s = [a[0] * 2 + p[0] + q2[0], a[1] * 2 + p[1] + q2[1], a[2] * 2 + p[2] + q2[2]], l = Math.hypot(...s) || 1; return s.map(x => x / l); }); return A; };
    D = sm(D); N = sm(N);
    const H = spec.H, t = spec.t, R = spec.rows, kF = O.kFold, X = [], SI = [], SW = [], rowN = 2 * R + kF + 1;
    // rows: outer layer 0..R (0 = the edge itself), the fold (kF - 1 points round), inner layer R..0 (ending 2t under the edge)
    const prof = []; for (let j = 0; j <= R; j++) prof.push([H * j / R - (j === R ? t : 0), j === 0 ? 0 : t]); for (let f = 1; f < kF; f++) { const a = Math.PI * f / kF; prof.push([H - t + Math.sin(a) * t, Math.cos(a) * t]); } for (let j = R; j >= 0; j--) prof.push([H * j / R - (j === R ? t : 0), j === 0 ? -2 * t : -t]);
    // (8 Oct, rev 2: `mid`) the band as ONE smooth folded strip: a MID-SURFACE S(i, u) rising from the edge, whose columns leave the edge's
    // puckers behind within `flat` of its height (the edge loop low-passed: a rib band does not follow the cloth's wrinkles), its two
    // layers offset by the cloth's thickness along the mid-surface's OWN normal (the edge cloth's normal, smoothed apart from the
    // strip, had tilted against it wherever the edge puckered more than the band is thick: each column's inner layer came out through
    // the next one's outer layer: sweat.neckband 470, tee.neckband 103 crossing triangles in v8c's 03:55 build)
    { const P0 = ids.map(w => [Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]]), dir = P0.map((p, i) => { const r = [C[0] - p[0], C[1] - p[1], C[2] - p[2]], rl = Math.hypot(...r) || 1, dd = [D[i][0] + r[0] / rl * spec.taper, D[i][1] + r[1] / rl * spec.taper, D[i][2] + r[2] / rl * spec.taper], dl = Math.hypot(...dd) || 1; return dd.map(x => x / dl); });
      let PS = P0.map(p => p.slice()); for (let it = 0; it < O.loopSmooth; it++) for (const lam of [0.5, -0.53]) PS = PS.map((a, i) => { const p = PS[(i - 1 + n) % n], q2 = PS[(i + 1) % n]; return [a[0] + lam * ((p[0] + q2[0]) / 2 - a[0]), a[1] + lam * ((p[1] + q2[1]) / 2 - a[1]), a[2] + lam * ((p[2] + q2[2]) / 2 - a[2])]; });
      const fU = u => { const x = Math.min(1, Math.max(0, u / (O.flat * H))); return x * x * (3 - 2 * x); };
      // (a rib cuff from rib8: the strip runs down the forearm on its skin: the section's radius + `ribEase`, the edge's own point blended out)
      // (c3 it3, a hem band: the strip runs down the hips in tension round what is under it, at its clearance + the inner layer's offset)
      const HB = spec.hem ? hemTube8(ctx, { g, P0, PS, ids, H }) : null; if (HB) rep[q.name + ':hull'] = { under: HB.under, pts: HB.pts, slabs: HB.slabs };
      // THE SEAM ON THE BAND (hem): the body cloth's last `gather` (distance over the cloth from the hem edge) drawn round the band's axis
      // to the band's girth at its height (the edge exactly onto the band's top: the seam), never left inside what is under it; the cloth
      // above it keeps its blouse. Only radially (heights and angles kept: the band's columns are unchanged); the moved cloth to bind.
      if (HB && spec.gather > 0) { const nb2 = new Map(), Tw = Wg.T; for (let k = 0; k < Tw.length; k += 3) for (let e = 0; e < 3; e++) { const a = Tw[k + e], b2 = Tw[k + (e + 1) % 3]; (nb2.get(a) || nb2.set(a, new Set()).get(a)).add(b2); (nb2.get(b2) || nb2.set(b2, new Set()).get(b2)).add(a); }
        const dist = new Map(ids.map(w => [w, 0])); let fr = [...ids]; while (fr.length) { const nx = new Set(); for (const a of fr) { const da = dist.get(a); for (const b2 of nb2.get(a) || []) { const d = da + Math.hypot(Pw[a * 3] - Pw[b2 * 3], Pw[a * 3 + 1] - Pw[b2 * 3 + 1], Pw[a * 3 + 2] - Pw[b2 * 3 + 2]); if (d < spec.gather && d < (dist.get(b2) ?? Infinity)) { dist.set(b2, d); nx.add(b2); } } } fr = [...nx]; }
        let moved = 0, maxMv = 0, sumIn = 0; const C2 = HB.C, ax2 = HB.ax;
        for (const [w, d] of dist) { const p = [Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]], l = HB.loc(p), r = Math.hypot(l[1], l[2]); if (r < 1e-6) continue; const a = Math.atan2(l[2], l[1]), rh = HB.Rth(a, l[0]); if (rh == null) continue;
          const x = 1 - d / spec.gather, wt = x * x * (3 - 2 * x), rt = rh + O.gap + t; let rn = r + (rt - r) * wt; if (r < rt) rn = Math.max(rn, r + (rt - r) * Math.min(1, 2 * wt)); if (Math.abs(rn - r) < 1e-6) continue; if (r < rt) sumIn++;
          const radial = [p[0] - C2[0] - ax2[0] * l[0], p[1] - C2[1] - ax2[1] * l[0], p[2] - C2[2] - ax2[2] * l[0]]; for (let c = 0; c < 3; c++) Pw[w * 3 + c] = p[c] + radial[c] / r * (rn - r); moved++; maxMv = Math.max(maxMv, Math.abs(rn - r)); (rep._mv ||= []).push(Math.abs(rn - r)); }
        // the garment's own vertices (welded copies too) posed and back to bind through their own weights
        const Pg = Float64Array.from(P(g)), nv = Pg.length / 3, tmp = [0, 0, 0]; let nb3 = 0; for (let v = 0; v < nv; v++) { const w = Wg.wid[v]; if (!dist.has(w)) continue; for (let c = 0; c < 3; c++) Pg[v * 3 + c] = Pw[w * 3 + c]; blendInverse(g.SI, g.SW, v, M, Pg[v * 3] / scale, Pg[v * 3 + 1] / scale, Pg[v * 3 + 2] / scale, tmp, 0); for (let c = 0; c < 3; c++) g.X[v * 3 + c] = Math.round(tmp[c] * scale * 1e4) / 1e4; nb3++; }
        ctx.posed.set(g, Pg); ctx.Pws?.set(g, Pw); for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) P0[i][c] = Pw[ids[i] * 3 + c];
        const mvs = (rep._mv || []).sort((a, b) => a - b); delete rep._mv; rep[q.name + ':gather'] = { welded: moved, verts: nb3, wasInside: sumIn, p50Mm: +((mvs[Math.floor(mvs.length * 0.5)] || 0) * 1000).toFixed(1), p90Mm: +((mvs[Math.floor(mvs.length * 0.9)] || 0) * 1000).toFixed(1), maxMm: +(maxMv * 1000).toFixed(1), gatherMm: spec.gather * 1000 }; ctx.log('band8', q.name, 'gather', JSON.stringify(rep[q.name + ':gather'])); }
      const tube = RB ? (i, u) => RB.F.at(RB.tTop + u, RB.th[i], RB.F.R(RB.tTop + u, RB.th[i]) + O.ribEase) : HB ? (i, u) => HB.at(i, u, HB.R(i, u) + O.gap + t) : null, T0 = tube ? P0.map((_, i) => tube(i, 0)) : null;
      const S = tube ? (i, u) => { const a = tube(i, u), f = 1 - fU(u); return [a[0] + (P0[i][0] - T0[i][0]) * f, a[1] + (P0[i][1] - T0[i][1]) * f, a[2] + (P0[i][2] - T0[i][2]) * f]; }
        : (i, u) => { const p = P0[i], f = fU(u), d = dir[i]; return [p[0] + (PS[i][0] - p[0]) * f + d[0] * u, p[1] + (PS[i][1] - p[1]) * f + d[1] * u, p[2] + (PS[i][2] - p[2]) * f + d[2] * u]; };
      // (on the forearm the outside is away from the arm's line)
      const outAt = RB ? (i, u) => { const a = tube(i, u), c = RB.F.at(RB.tTop + u, RB.th[i], 0); return [a[0] - c[0], a[1] - c[1], a[2] - c[2]]; } : HB ? (i) => HB.out(i) : (i) => N[i];
      // the mid-surface's normal at each (column, profile row): across the columns x up the strip, turned to the cloth's outside; smoothed round
      let NS = prof.map(([u]) => { const du = 2e-4, A2 = []; for (let i = 0; i < n; i++) { const a = S(i, Math.max(0, u - du)), b = S(i, u + du), e0 = S((i - 1 + n) % n, u), e1 = S((i + 1) % n, u), tu = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ti = [e1[0] - e0[0], e1[1] - e0[1], e1[2] - e0[2]];
          let c = [tu[1] * ti[2] - tu[2] * ti[1], tu[2] * ti[0] - tu[0] * ti[2], tu[0] * ti[1] - tu[1] * ti[0]]; const l = Math.hypot(...c) || 1; c = c.map(x => x / l); const oa = outAt(i, u); if (c[0] * oa[0] + c[1] * oa[1] + c[2] * oa[2] < 0) c = c.map(x => -x); A2.push(c); } return sm(A2); });
      // per column and profile row: the point (mid-surface + its normal x the layer's offset); the skin kept `gap` off the INNER layer by
      // moving both layers of that height together (pushing one layer alone had put it through the other)
      const XY = []; for (let i = 0; i < n; i++) { const row = []; for (let j = 0; j < prof.length; j++) { const [u, v] = prof[j], s0 = S(i, u), nn = NS[j][i]; row.push([s0[0] + nn[0] * v, s0[1] + nn[1] * v, s0[2] + nn[2] * v]); } XY.push(row); }
      if (bodySurf) { const key = u => Math.round(u * 1e6); for (let i = 0; i < n; i++) { const grp = new Map(); prof.forEach(([u], j) => { const k = key(u); (grp.get(k) || grp.set(k, []).get(k)).push(j); });
          for (const js of grp.values()) { let best = null; for (const j of js) { const x = XY[i][j], qq = bodySurf.closestAny(x[0], x[1], x[2], 0.03); if (!qq || qq.edge || qq.d >= O.gap) continue; const k = O.gap - qq.d; if (!best || k > best[0]) best = [k, qq.nx, qq.ny, qq.nz]; }
            if (best) for (const j of js) for (let c = 0; c < 3; c++) XY[i][j][c] += best[c + 1] * best[0]; } } }
      // (a rib cuff on the forearm skins with the forearm: each vertex the weights of its nearest skin of that arm; else the edge's)
      const armW = RB && body?.SI && ctx.J?.['arm' + RB.side] ? (() => { const BX = body.X, am = ctx.J['arm' + RB.side], vs = []; for (let v = 0; v < BX.length / 3; v++) if (am[v]) vs.push(v); return x => { let bv = -1, bd2 = Infinity; for (const v of vs) { const d = (BX[v * 3] - x[0]) ** 2 + (BX[v * 3 + 1] - x[1]) ** 2 + (BX[v * 3 + 2] - x[2]) ** 2; if (d < bd2) { bd2 = d; bv = v; } } return bv; }; })() : null;
      for (let i = 0; i < n; i++) { const rep0 = Wg.rep[ids[i]]; for (let j = 0; j < prof.length; j++) { X.push(...XY[i][j]); const bv = armW ? armW(XY[i][j]) : -1; for (let k = 0; k < 4; k++) { if (bv >= 0) { SI.push(body.SI[bv * 4 + k]); SW.push(body.SW[bv * 4 + k]); } else { SI.push(g.SI[rep0 * 4 + k]); SW.push(g.SW[rep0 * 4 + k]); } } } } }
    // a rib CUFF grips the forearm: below the sleeve's (loose, pushed-up) edge each row is drawn in towards the skin, to `hug` over it by
    // 40 % of the band's height (the skin's radius there read as the point's distance to the arm's bone line less its distance to the skin)
    if (spec.hug != null && bodySurf && ctx.J?.elbowL) { const sd = /\.R$/.test(q.name) ? 'R' : 'L', E = ctx.J['elbow' + sd], Wr = ctx.J['wrist' + sd], ab = [Wr[0] - E[0], Wr[1] - E[1], Wr[2] - E[2]], l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
      // (the side by the band's own loop: nearer the elbow - wrist line of L or R)
      const dLine = (p, S) => { const e = ctx.J['elbow' + S], w = ctx.J['wrist' + S], v = [w[0] - e[0], w[1] - e[1], w[2] - e[2]], ll = v[0] ** 2 + v[1] ** 2 + v[2] ** 2 || 1, f = Math.max(0, Math.min(1, ((p[0] - e[0]) * v[0] + (p[1] - e[1]) * v[1] + (p[2] - e[2]) * v[2]) / ll)); return Math.hypot(p[0] - e[0] - v[0] * f, p[1] - e[1] - v[1] * f, p[2] - e[2] - v[2] * f); };
      const p0 = [X[0], X[1], X[2]], S2 = dLine(p0, 'L') <= dLine(p0, 'R') ? 'L' : 'R', E2 = ctx.J['elbow' + S2], W2 = ctx.J['wrist' + S2], a2 = [W2[0] - E2[0], W2[1] - E2[1], W2[2] - E2[2]], m2 = a2[0] ** 2 + a2[1] ** 2 + a2[2] ** 2 || 1; void sd; void ab; void l2;
      for (let i = 0; i < n; i++) for (let j = 1; j < rowN; j++) { const v = i * rowN + j, [u, vv] = prof[j], f = Math.min(1, u / (0.4 * H)), ff = f * f * (3 - 2 * f); if (ff <= 0) continue;
        const p = [X[v * 3], X[v * 3 + 1], X[v * 3 + 2]], fr = Math.max(0, Math.min(1, ((p[0] - E2[0]) * a2[0] + (p[1] - E2[1]) * a2[1] + (p[2] - E2[2]) * a2[2]) / m2)), ft = [E2[0] + a2[0] * fr, E2[1] + a2[1] * fr, E2[2] + a2[2] * fr], rv = [p[0] - ft[0], p[1] - ft[1], p[2] - ft[2]], r = Math.hypot(...rv) || 1;
        const qq = bodySurf.closestAny(p[0], p[1], p[2], 0.08); if (!qq || qq.edge) continue; const rSkin = r - qq.d, want = rSkin + spec.hug + (vv > 0 ? t : 0), r2 = r + (Math.min(r, want) - r) * ff;
        for (let c = 0; c < 3; c++) X[v * 3 + c] = ft[c] + rv[c] / r * r2; } }
    const T = []; for (let i = 0; i < n; i++) { const i2 = (i + 1) % n; for (let j = 0; j + 1 < rowN; j++) { const a = i * rowN + j, b = i2 * rowN + j, c = i * rowN + j + 1, e = i2 * rowN + j + 1; T.push(a, b, c, b, e, c); } }
    // wound outward: the outer layer's first strip faces along the cloth's normal
    { const a = 0, b = rowN, c = 1, ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2], cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * N[0][0] + cy * N[0][1] + cz * N[0][2] < 0) for (let k = 0; k < T.length; k += 3) { const x = T[k + 1]; T[k + 1] = T[k + 2]; T[k + 2] = x; } }
    // to bind through each vertex's own weights (quantised as the bake stores it)
    const nv = X.length / 3, Xb = new Float64Array(nv * 3), SIa = Uint16Array.from(SI), SWa = Float32Array.from(SW), tmp = [0, 0, 0];
    for (let v = 0; v < nv; v++) { blendInverse(SIa, SWa, v, M, X[v * 3] / scale, X[v * 3 + 1] / scale, X[v * 3 + 2] / scale, tmp, 0); for (let c = 0; c < 3; c++) Xb[v * 3 + c] = Math.round(tmp[c] * scale * 1e4) / 1e4; }
    const np = { name: q.name, group: 'construction', owner: q.owner, part: q.part, construction: q.construction, fabric: q.fabric, color: q.color, sewn: q.sewn || 1, X: Xb, T: Int32Array.from(T), SI: SIa, SW: SWa, uv: new Float64Array(nv * 2), flatUv: false, solid: false, cloth8: 'band' };
    parts[pi] = np; ctx.posed.set(np, Float64Array.from(X)); rep[q.name] = { loop: n, verts: nv, tris: T.length / 3, oldTris: q.T.length / 3, HMm: H * 1000 }; ctx.log('band8', q.name, JSON.stringify(rep[q.name])); }
  if (ctx.drop8?.size) for (let i = parts.length - 1; i >= 0; i--) if (ctx.drop8.has(parts[i])) parts.splice(i, 1);
  return rep;
}
