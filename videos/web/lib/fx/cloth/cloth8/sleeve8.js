// CLOTH8 (second resume, 8 Oct): THE SLEEVE AS A HEIGHT FIELD OVER THE ARM. A sleeve solved round a bent arm telescopes: the cloth
// runs down the arm, turns back UP under itself and down again (an S-fold along the arm); the fold's mouth draws as a black slot at 1:1
// and a dark shard at 270 px (the chore coats L23 and L12, the shirts L05 L03 L20 at the elbow and the upper arm). elbow8 (the gaps
// shrunk in order) kept the S, so the lip still overhung its slot. Here each sleeve vertex is written in the arm's own coordinates
// (t: arc length along a filleted shoulder - elbow - wrist curve; its direction round the curve; r: its distance from the curve) and
//   t   is relaxed over the cloth (Jacobi, the rim of the zone fixed): along the sleeve's own cloth t then rises monotonically, so no
//       cloth lies under the cloth above it along the arm (no overhang, no slot); the fold's spare length is taken up in place
//   dir is relaxed a little (the circumference evened: no sideways pleat turned under)
//   r   keeps `keep` of its own detail over a smoothed r (r' = rs + keep (r - rs)): the folds stay as soft radial ripples (weight,
//       not slots); never under the skin + `gap`
// The zone: the sleeve panels' cloth from `top` below the shoulder joint to the sleeve's end; what cuff8 laid (its pins), the free
// edges and `edgeRings` rings in from them (CLOTH7's turned hems ride there) and everything outside the zone are fixed; the zone's top
// `fade` blends in. Nothing outside the sleeves moves. relax8 then clears what still crosses.
//   sleeve8(ctx) (rebuild8 stage 'sleeve', after cuff8, before relax8)
import { adjacency } from './relax8.js';
import { holeTriangles } from './fill8.js';
import { weldGarment } from '../cloth7/fold7.js';
export const SLEEVE8_VERSION = 1;
export const SLEEVE8 = { owners: ['shirt', 'top', 'outer'], top: 0.07, fade: 0.04, iterT: 220, iterDir: 40, iterR: 24, keep: 0.35, tFree: 0.015, gap: 0.003, edgeRings: 2,
  fillet: 0.07, sleeveFrac: 0.6, sleeveR: 0.11, minZone: 40, maxMove: 0.06, fill: true, fillTop: 0.05, rolled: 0.03, rollGap: 0.04 };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// the arm's curve: shoulder -> elbow -> wrist (and on past the wrist), the elbow's corner filleted (a quadratic arc over `fillet` each
// side, shorter on a short bone) so the frame turns smoothly; samples with arc length and unit tangent
export function armCurve(S, E, Wr, fillet = 0.07, past = 0.08) {
  const u1 = nrm([E[0] - S[0], E[1] - S[1], E[2] - S[2]]), u2 = nrm([Wr[0] - E[0], Wr[1] - E[1], Wr[2] - E[2]]);
  const L1 = Math.hypot(E[0] - S[0], E[1] - S[1], E[2] - S[2]), L2 = Math.hypot(Wr[0] - E[0], Wr[1] - E[1], Wr[2] - E[2]), d = Math.min(fillet, 0.4 * L1, 0.4 * L2);
  const A = [E[0] - u1[0] * d, E[1] - u1[1] * d, E[2] - u1[2] * d], B = [E[0] + u2[0] * d, E[1] + u2[1] * d, E[2] + u2[2] * d], pts = [];
  const lerp = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
  for (let i = 0; i <= 30; i++) pts.push(lerp(S, A, i / 30));
  for (let i = 1; i <= 24; i++) { const f = i / 24, a = lerp(A, E, f), b = lerp(E, B, f); pts.push(lerp(a, b, f)); }
  const Wp = [Wr[0] + u2[0] * past, Wr[1] + u2[1] * past, Wr[2] + u2[2] * past]; for (let i = 1; i <= 30; i++) pts.push(lerp(B, Wp, i / 30));
  const n = pts.length, P = new Float64Array(n * 3), s = new Float64Array(n), T = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) { P.set(pts[i], i * 3); if (i) s[i] = s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]); }
  for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], t = nrm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]); T.set(t, i * 3); }
  // nearest point on the polyline: { s, foot, dist }
  const near = p => { let bd = Infinity, bs = 0, bf = null; for (let i = 0; i < n - 1; i++) { const ax = P[i * 3], ay = P[i * 3 + 1], az = P[i * 3 + 2], ex = P[i * 3 + 3] - ax, ey = P[i * 3 + 4] - ay, ez = P[i * 3 + 5] - az, l2 = ex * ex + ey * ey + ez * ez || 1e-12;
      const f = Math.max(0, Math.min(1, ((p[0] - ax) * ex + (p[1] - ay) * ey + (p[2] - az) * ez) / l2)), fx = ax + ex * f, fy = ay + ey * f, fz = az + ez * f, dd = (p[0] - fx) ** 2 + (p[1] - fy) ** 2 + (p[2] - fz) ** 2;
      if (dd < bd) { bd = dd; bs = s[i] + (s[i + 1] - s[i]) * f; bf = [fx, fy, fz]; } } return { s: bs, foot: bf, dist: Math.sqrt(bd) }; };
  // the point and tangent at arc length t
  const at = t => { t = Math.max(0, Math.min(s[n - 1], t)); let i = 0, j = n - 1; while (j - i > 1) { const k = (i + j) >> 1; if (s[k] <= t) i = k; else j = k; } const f = (t - s[i]) / ((s[j] - s[i]) || 1);
    const p = [P[i * 3] + (P[j * 3] - P[i * 3]) * f, P[i * 3 + 1] + (P[j * 3 + 1] - P[i * 3 + 1]) * f, P[i * 3 + 2] + (P[j * 3 + 2] - P[i * 3 + 2]) * f], tg = nrm([T[i * 3] + (T[j * 3] - T[i * 3]) * f, T[i * 3 + 1] + (T[j * 3 + 1] - T[i * 3 + 1]) * f, T[i * 3 + 2] + (T[j * 3 + 2] - T[i * 3 + 2]) * f]); return { p, tg }; };
  return { near, at, length: s[n - 1], sElbow: L1 - d + (s[30 + 24] - s[30]) / 2, sWrist: s[30 + 24] + (L2 - d) };
}

export function sleeve8(ctx) {
  const { W, Pws, gar, J, bodySurf } = ctx, O = { ...SLEEVE8, ...(ctx.O.sleeve || {}) }, rep = {}; if (!J?.shoulderL) return null;
  const curves = ['L', 'R'].map(sd => armCurve(J['shoulder' + sd], J['elbow' + sd], J['wrist' + sd], O.fillet));
  for (const g of gar.filter(x => O.owners.includes(x.owner))) { let Wg = W.get(g); const Pw = Pws.get(g), m = Wg.m, pin = ctx.pin?.get(g);
    // each welded vertex in the arm's coordinates (nearest arm curve)
    const side = new Int8Array(m).fill(-1), t0 = new Float64Array(m), r0 = new Float64Array(m), D0 = new Float64Array(m * 3);
    for (let v = 0; v < m; v++) { const p = [Pw[v * 3], Pw[v * 3 + 1], Pw[v * 3 + 2]]; let bd = Infinity;
      for (let si = 0; si < 2; si++) { const q = curves[si].near(p); if (q.dist < bd) { bd = q.dist; side[v] = si; t0[v] = q.s; r0[v] = q.dist; const d = nrm([p[0] - q.foot[0], p[1] - q.foot[1], p[2] - q.foot[2]]); D0[v * 3] = d[0]; D0[v * 3 + 1] = d[1]; D0[v * 3 + 2] = d[2]; } } }
    // the sleeve panels: most of their cloth within `sleeveR` of an arm curve
    const np = g.panel ? Math.max(...g.panel) + 1 : 0, cnt = new Float64Array(np), close = new Float64Array(np);
    for (let i = 0; i < g.X.length / 3; i++) { const w = Wg.wid[i], pn = g.panel[i]; cnt[pn]++; if (r0[w] < O.sleeveR) close[pn]++; }
    const isSl = new Uint8Array(np); for (let k = 0; k < np; k++) isSl[k] = cnt[k] > 20 && close[k] / cnt[k] >= O.sleeveFrac ? 1 : 0;
    // THE WINDOWS: the bake hid the sleeve's cloth where the solver left it inside the arm (its triangles dropped; the skin under the
    // sleeve is culled), so at the elbow the page looked through the sleeve and the arm at the shadowed side of the shirt: the black
    // band / slot. The hidden cloth of the sleeve panels gets its triangles back (fill8.js, from the panel's own flat pattern) and is
    // laid with the rest below.
    let filled = 0; if (O.fill && !(g.owner !== 'outer' && gar.some(x => x.owner === 'outer'))) {   // (not under a coat: hidden there for a reason)
      const HT = holeTriangles(g), add = []; for (let t = 0; t < HT.length; t += 3) { let ok = true; for (let k = 0; k < 3; k++) { const i = HT[t + k], w = Wg.wid[i]; if (!isSl[g.panel[i]] || t0[w] < O.fillTop || (pin && pin[w])) ok = false; } if (ok) add.push(HT[t], HT[t + 1], HT[t + 2]); }
      if (add.length) { const T2 = new Int32Array(g.T.length + add.length); T2.set(g.T); T2.set(add, g.T.length); g.T = T2; filled = add.length / 3; const W2 = weldGarment(g); if (W2.m !== m) throw new Error('sleeve8: weld changed'); W.set(g, W2); Wg = W2; } }
    const A = adjacency(Wg.T, m), fixed = new Uint8Array(m);
    // free edges and `edgeRings` rings in: fixed (the turned hems ride on them)
    { let f = []; for (let v = 0; v < m; v++) if (A.bnd[v]) { fixed[v] = 1; f.push(v); } for (let k = 0; k < O.edgeRings; k++) { const nx = []; for (const v of f) for (const u of A.nb[v]) if (!fixed[u]) { fixed[u] = 1; nx.push(u); } f = nx; } }
    // a ROLLED or pushed-up sleeve (its free edge well above the lowest of its cloth: the cloth runs down past the edge and turns back
    // up to it, L21's and L14's sweatshirts): the roll is the garment's look, not a fault; the zone stops `rollGap` above the edge
    const tLim = [Infinity, Infinity], rolled = [];
    if (ctx.O.debugSleeve) ctx.log('sleeve8 loops', g.name, JSON.stringify(Wg.loops.map(L => [L.ids.length, L.closed, L.ids.filter(w => side[w] >= 0 && Wg.dups[w].every(i => isSl[g.panel[i]])).length])));
    for (const L of Wg.loops) { if (!L.closed || L.ids.length < 8) continue; const sl = L.ids.filter(w => side[w] >= 0 && Wg.dups[w].every(i => isSl[g.panel[i]])); if (sl.length < 0.8 * L.ids.length) continue;
      const si = side[sl[0]]; let te = 0; for (const w of sl) te += t0[w] / sl.length; let tm = 0; for (let v = 0; v < m; v++) if (side[v] === si && Wg.dups[v].every(i => isSl[g.panel[i]])) tm = Math.max(tm, t0[v]);
      if (ctx.O.debugSleeve) ctx.log('sleeve8 loop', g.name, JSON.stringify({ side: si, n: L.ids.length, edgeCm: +(te * 100).toFixed(1), lowestCm: +(tm * 100).toFixed(1) }));
      if (tm - te > O.rolled) { tLim[si] = Math.min(tLim[si], te - O.rollGap); rolled.push({ side: si, edgeCm: +(te * 100).toFixed(1), lowestCm: +(tm * 100).toFixed(1) }); } }
    const zone = new Uint8Array(m), wgt = new Float64Array(m); let nz = 0;
    for (let v = 0; v < m; v++) { if (fixed[v] || (pin && pin[v]) || side[v] < 0) continue; if (!Wg.dups[v].every(i => isSl[g.panel[i]])) continue; if (t0[v] < O.top || t0[v] > tLim[side[v]]) continue; zone[v] = 1; wgt[v] = sstep(O.top, O.top + O.fade, t0[v]); nz++; }
    if (nz < O.minZone) { rep[g.name] = { zone: nz, sleeves: [...isSl].reduce((a, b) => a + b, 0) }; continue; }
    // a zone vertex with a neighbour on the other arm's curve (none on a sleeve) is fixed too: the fields are per arm
    for (let v = 0; v < m; v++) if (zone[v]) for (const u of A.nb[v]) if (side[u] !== side[v]) { zone[v] = 0; break; }
    const Z = []; for (let v = 0; v < m; v++) if (zone[v]) Z.push(v);
    // the fields relaxed (Jacobi; zone vertices take their neighbours' mean, the rest hold)
    const relax = (F, k, it) => { const N = new Float64Array(F.length); for (let r = 0; r < it; r++) { N.set(F); for (const v of Z) { const nb = A.nb[v]; if (!nb.length) continue; for (let c = 0; c < k; c++) { let s = 0; for (const u of nb) s += F[u * k + c]; N[v * k + c] = s / nb.length; } } F.set(N); } return F; };
    const t1 = relax(Float64Array.from(t0), 1, O.iterT), D1 = relax(Float64Array.from(D0), 3, O.iterDir), rs = relax(Float64Array.from(r0), 1, O.iterR);
    // inverted: zone triangles whose winding normal faces the arm (radially in): the cloth's inside turned to the camera (FAB's gIn: drawn dark)
    const inverted = (Pz, tag) => { let c = 0; const hist = {}; for (let t = 0; t < Wg.T.length; t += 3) { const a = Wg.T[t], b = Wg.T[t + 1], cc = Wg.T[t + 2]; if (!zone[a] && !zone[b] && !zone[cc]) continue;
        const e1 = [Pz[b * 3] - Pz[a * 3], Pz[b * 3 + 1] - Pz[a * 3 + 1], Pz[b * 3 + 2] - Pz[a * 3 + 2]], e2 = [Pz[cc * 3] - Pz[a * 3], Pz[cc * 3 + 1] - Pz[a * 3 + 1], Pz[cc * 3 + 2] - Pz[a * 3 + 2]], n = nrm([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]);
        const d = [D0[a * 3] + D0[b * 3] + D0[cc * 3], D0[a * 3 + 1] + D0[b * 3 + 1] + D0[cc * 3 + 1], D0[a * 3 + 2] + D0[b * 3 + 2] + D0[cc * 3 + 2]]; if (dot(n, nrm(d)) < -0.3) { c++; const k = Math.round(t0[a] * 50) / 50; hist[k] = (hist[k] || 0) + 1; } } if (ctx.O.debugSleeve) ctx.log('sleeve8 inv', g.name, tag, c, JSON.stringify(hist)); return c; };
    const inv0 = inverted(Pw, 'before');
    let moved = 0, mx = 0, pushed = 0, overhang0 = 0, overhang1 = 0;
    // (probe) overhang: zone edges whose t runs against the sleeve's general run (t goes down the arm as the cloth goes down the sleeve);
    // counted as the sum of |dt| over edges where t falls while the material coordinate (flat v of the pattern) rises... measured instead
    // as t's local extrema count (a vertex whose t is above or below every neighbour): an S-fold shows two rings of them
    const extrema = F => { let c = 0; for (const v of Z) { let hi = true, lo = true; for (const u of A.nb[v]) { if (F[u] >= F[v]) hi = false; if (F[u] <= F[v]) lo = false; } if (hi || lo) c++; } return c; };
    overhang0 = extrema(t0); overhang1 = extrema(t1);
    for (const v of Z) { const cv = curves[side[v]], { p: foot, tg } = cv.at(t1[v]); let d = [D1[v * 3], D1[v * 3 + 1], D1[v * 3 + 2]]; const dd = dot(d, tg); d = nrm([d[0] - tg[0] * dd, d[1] - tg[1] * dd, d[2] - tg[2] * dd]);
      // the radial detail kept only where the cloth stayed in place along the arm: where t moved (the fold's turned layers laid out) the
      // old r is the fold's lip and trench side by side, a sharp crease (shadow and AO draw it black): there the smoothed r
      const kv = O.keep * Math.max(0, 1 - Math.abs(t1[v] - t0[v]) / O.tFree), r = rs[v] + kv * (r0[v] - rs[v]); let p = [foot[0] + d[0] * r, foot[1] + d[1] * r, foot[2] + d[2] * r];
      const w = wgt[v]; p = [Pw[v * 3] + (p[0] - Pw[v * 3]) * w, Pw[v * 3 + 1] + (p[1] - Pw[v * 3 + 1]) * w, Pw[v * 3 + 2] + (p[2] - Pw[v * 3 + 2]) * w];
      let mv = Math.hypot(p[0] - Pw[v * 3], p[1] - Pw[v * 3 + 1], p[2] - Pw[v * 3 + 2]); if (mv > O.maxMove) { const k = O.maxMove / mv; p = [Pw[v * 3] + (p[0] - Pw[v * 3]) * k, Pw[v * 3 + 1] + (p[1] - Pw[v * 3 + 1]) * k, Pw[v * 3 + 2] + (p[2] - Pw[v * 3 + 2]) * k]; mv = O.maxMove; }
      if (bodySurf) { const q = bodySurf.closestAny(p[0], p[1], p[2], 0.05); if (q && !q.edge && q.d < O.gap) { const kk = O.gap - q.d; p[0] += q.nx * kk; p[1] += q.ny * kk; p[2] += q.nz * kk; pushed++; } }
      if (mv > 1e-5) moved++; mx = Math.max(mx, mv); Pw[v * 3] = p[0]; Pw[v * 3 + 1] = p[1]; Pw[v * 3 + 2] = p[2]; }
    const inv1 = inverted(Pw, 'after');
    rep[g.name] = { filled, rolled, inverted: [inv0, inv1], zone: Z.length, moved, maxMm: +(mx * 1000).toFixed(1), pushed, tExtrema: [overhang0, overhang1], sleeves: [...isSl].reduce((a, b) => a + b, 0) };
    ctx.log('sleeve8', g.name, JSON.stringify(rep[g.name])); }
  return rep;
}
