// CLOTH8 (round 7): THE CUFF AS TWO LAYERS OF CLOTH. A shirt cuff is an interfaced tube: the outer layer and its facing, folded at the
// cuff's edge, both sewn to the sleeve at the join, the sleeve's fullness gathered into the cuff's top. The solver left the cuff panel as
// one sagging layer whose top folded in under the sleeve's gathered edge (CARRY's "cuff window": skin seen between the join and the
// cuff, a dark triangle at its side), and CLOTH4 covered the join with a swept band. Here:
//   - the cuff panel's own cloth (its vertices: flat-pattern u round the wrist, v up the arm) is laid on a stiff tube round the posed
//     forearm axis: per sector the wrist's skin radius over the cuff's span (low-passed) + an ease solved so the tube's girth is the
//     cuff's length less its button overlap; the overlap's top end lies `thick` outside the under end (buttoned)
//   - the sleeve's cloth is sewn to the cuff's top edge (its join vertices ARE the cuff's top row) and eased into it: above the join it
//     narrows monotonically onto the cuff's radius over `blend`; whatever of it hung below the join goes inside the cuff
//   - cuff8Facing (after the cloth is final): the FACING, the cuff panel's own mesh turned in at the cuff's edge (fold7 plan7 / realize7,
//     the layer the cuff's full height less 3 mm) in place of CLOTH7's 2 cm cuff-edge layer; CLOTH4's join band is not drawn (the join
//     is a sewn seam now)
// Plain data: ctx from rebuild8 (welded posed positions edited in place; the cuff's and the eased sleeve's vertices pinned for relax8).
import { plan7, realize7, outwardSign, TriGrid, weldGarment } from '../cloth7/fold7.js';
import { holeTriangles } from './fill8.js';
import { buttonGeom } from '../finish.js';
import { vertexNormals, blendInverse } from '../collide.js';
export const CUFF8_VERSION = 1;
export const CUFF8 = { pushUp: 0.12, funnel: 0.12, flare: 0.22, skinGap: 0.0035, refillUp: 0.2, rise: 0.8, overlap: 0.024, minEase: 0.0025, thick: 0.0016, blend: 0.05, inside: 0.0012, sectors: 36, harm: 4, hold: 0.004, facingInset: 0.003 };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const TAU = Math.PI * 2, sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function lowpass(a, H) { const K = a.length, out = new Float64Array(K); for (let k = 0; k <= H; k++) { let c = 0, s = 0; for (let j = 0; j < K; j++) { const th = TAU * k * j / K; c += a[j] * Math.cos(th); s += a[j] * Math.sin(th); } c *= (k === 0 ? 1 : 2) / K; s *= 2 / K; for (let j = 0; j < K; j++) { const th = TAU * k * j / K; out[j] += c * Math.cos(th) + (k === 0 ? 0 : s * Math.sin(th)); } } return out; }

// the cuff panels of a shirt: small panels (a band 3.5-8 cm tall, 18-30 cm long in the flat) whose cloth lies by a wrist
export function cuffPanels(g, Pp, J) { const n = g.X.length / 3, np = g.panel ? Math.max(...g.panel) + 1 : 0, out = [];
  for (let k = 0; k < np; k++) { let c = 0, u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9, cx = 0, cy = 0, cz = 0; for (let i = 0; i < n; i++) if (g.panel[i] === k) { c++; u0 = Math.min(u0, g.uv[i * 2]); u1 = Math.max(u1, g.uv[i * 2]); v0 = Math.min(v0, g.uv[i * 2 + 1]); v1 = Math.max(v1, g.uv[i * 2 + 1]); cx += Pp[i * 3]; cy += Pp[i * 3 + 1]; cz += Pp[i * 3 + 2]; }
    if (!c) continue; cx /= c; cy /= c; cz /= c; const L = Math.max(u1 - u0, v1 - v0), Hh = Math.min(u1 - u0, v1 - v0); if (L < 0.17 || L > 0.32 || Hh < 0.03 || Hh > 0.09) continue;
    for (const sd of ['L', 'R']) { const w = J['wrist' + sd]; if (Math.hypot(cx - w[0], cy - w[1], cz - w[2]) < 0.07) out.push({ panel: k, side: sd, along: (u1 - u0) >= (v1 - v0) ? 0 : 1, u0, u1, v0, v1 }); } }
  return out; }

export function cuff8(ctx) {
  const { W, Pws, gar, P, bodySurf, body, J } = ctx, O = { ...CUFF8, ...(ctx.O.cuff || {}) }, rep = {}; if (!J) return { skipped: 'no joints' };
  for (const g of gar.filter(x => x.owner === 'shirt')) { let Wg = W.get(g); const Pw = Pws.get(g), n = g.X.length / 3, Pp = new Float64Array(n * 3); for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) Pp[i * 3 + c] = Pw[Wg.wid[i] * 3 + c];
    const cps = cuffPanels(g, Pp, J); if (!cps.length) continue; const pin = ctx.pin?.get(g) || new Uint8Array(Wg.m); (ctx.pin ||= new Map()).set(g, pin);
    const panelsOf = w => new Set(Wg.dups[w].map(i => g.panel[i]));
    for (const cp of cps) { const sd = cp.side, wr = J['wrist' + sd], el = J['elbow' + sd], ax = nrm(sub(el, wr)), r0 = [];
      // the cuff's welded vertices, its flat (s round, h up the arm), the join row (shared with another panel: the sleeve)
      const cw = new Map(); for (let i = 0; i < n; i++) if (g.panel[i] === cp.panel) cw.set(Wg.wid[i], i);
      const fl = (i, k) => g.uv[i * 2 + ((cp.along + k) % 2)];   // k 0: along the cuff, 1: across
      const join = [...cw.keys()].filter(w => [...panelsOf(w)].some(p => p !== cp.panel)); if (join.length < 6) { rep[sd] = { skipped: 'no join', join: join.length }; continue; }
      // which flat side is the join (top): the mean across-coordinate of the join row
      const acr = []; for (let i = 0; i < n; i++) if (g.panel[i] === cp.panel) acr.push(fl(i, 1)); const aMin = Math.min(...acr), aMax = Math.max(...acr), jA = join.reduce((s, w) => s + fl(cw.get(w), 1), 0) / join.length, topIsMax = jA > (aMin + aMax) / 2, Hc = aMax - aMin;
      const hOf = i => (topIsMax ? fl(i, 1) - aMin : aMax - fl(i, 1));   // 0 at the cuff's edge, Hc at the join
      const cAll = []; for (let i = 0; i < n; i++) if (g.panel[i] === cp.panel) cAll.push(i); const along = cAll.map(i => fl(i, 0)), sMin = Math.min(...along), sMax = Math.max(...along), Lc = sMax - sMin;
      // a cuff sewn into a closed ring (its two ends one seam: the bake's cuffs are) maps its whole length once round; an open cuff overlaps
      let ring = false; for (let i = 0; i < n; i++) if (g.panel[i] === cp.panel && Math.abs(fl(i, 0) - sMin) < 1e-4) for (const j of Wg.dups[Wg.wid[i]]) if (j !== i && g.panel[j] === cp.panel && Math.abs(fl(j, 0) - sMax) < 1e-4) ring = true;
      // the frame: centre on the axis at the join's mean height; b1, b2 round it
      let jc = [0, 0, 0]; for (const w of join) for (let c = 0; c < 3; c++) jc[c] += Pw[w * 3 + c] / join.length;
      const tJ = dot(sub(jc, wr), ax), C0 = [wr[0] + ax[0] * tJ, wr[1] + ax[1] * tJ, wr[2] + ax[2] * tJ], ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], b1 = nrm(cross(ax, ref)), b2 = cross(ax, b1);
      const loc = p => { const d = sub(p, C0), t = dot(d, ax), x = dot(d, b1), y = dot(d, b2); return [t, Math.hypot(x, y), ((Math.atan2(y, x) % TAU) + TAU) % TAU]; };
      // the skin's radius per sector in two slices (at the join: the wrist; at the cuff's edge: the wrist or the hand's heel), low-passed;
      // each slice's ease solved so its girth is the cuff's length less the overlap (never under `minEase`: over the hand it stretches)
      const K = O.sectors, slice = (tA, tB) => { const Rs = new Float64Array(K), cnt = new Float64Array(K), pts = [];
          if (body) { const BX = body.X, arm = J['arm' + sd]; for (let v = 0; v < BX.length / 3; v++) { if (arm && !arm[v]) continue; const d = sub([BX[v * 3], BX[v * 3 + 1], BX[v * 3 + 2]], C0), t = dot(d, ax); if (t > tB || t < tA) continue; const x = dot(d, b1), y = dot(d, b2); if (Math.hypot(x, y) > 0.07) continue; pts.push(x, y); } }
          // the section's centre (the joints are not at the middle of the wrist): the mean of its skin points' bounding box
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let k = 0; k < pts.length; k += 2) { x0 = Math.min(x0, pts[k]); x1 = Math.max(x1, pts[k]); y0 = Math.min(y0, pts[k + 1]); y1 = Math.max(y1, pts[k + 1]); }
          const cx = pts.length ? (x0 + x1) / 2 : 0, cy = pts.length ? (y0 + y1) / 2 : 0;
          for (let k = 0; k < pts.length; k += 2) { const x = pts[k] - cx, y = pts[k + 1] - cy, r = Math.hypot(x, y), th = ((Math.atan2(y, x) % TAU) + TAU) % TAU, j = Math.floor(th / TAU * K) % K; if (r > Rs[j]) Rs[j] = r; cnt[j]++; }
          if (cnt.some(c => !c)) { const m = Rs.reduce((a, b) => Math.max(a, b), 0) || 0.028; for (let j = 0; j < K; j++) if (!cnt[j]) Rs[j] = m; }
          const Rl = lowpass(Rs, O.harm).map((r, j) => Math.max(r, Rs[j] - 0.001)), perim = e => { let q = 0; for (let j = 0; j < K; j++) { const a0_ = j / K * TAU, a1_ = (j + 1) / K * TAU, ra = Rl[j] + e, rb = Rl[(j + 1) % K] + e; q += Math.hypot(rb * Math.cos(a1_) - ra * Math.cos(a0_), rb * Math.sin(a1_) - ra * Math.sin(a0_)); } return q; };
          let e = O.minEase; if (perim(e) < Ceff) { let lo = e, hi = 0.05; for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (perim(mid) < Ceff) lo = mid; else hi = mid; } e = lo; }
          const R = th => { const f = th / TAU * K, j0 = Math.floor(f) % K, j1 = (j0 + 1) % K, u = f - Math.floor(f); return Rl[j0] * (1 - u) + Rl[j1] * u + e; };
          return { R, e, girth: perim(e), cx, cy }; };
      const Ceff = Lc - O.overlap, sTop = slice(-0.015, 0.004), sBot = slice(-Hc - 0.005, -Hc + 0.015), Rat = (th, h = Hc) => { const f = h / Hc; return sBot.R(th) * (1 - f) + sTop.R(th) * f; }, e = sTop.e;
      // where the cuff's ends are now (the overlap stays where the solver buttoned it) and which way s runs round the axis
      const angAt = sv => { let x = 0, y = 0, c = 0; for (const [w, i] of cw) if (Math.abs(fl(i, 0) - sv) < 0.012) { const [, , th] = loc([Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]]); x += Math.cos(th); y += Math.sin(th); c++; } return c ? Math.atan2(y, x) : 0; };
      const a0 = angAt(sMin + 0.006), a1 = angAt(sMin + 0.06), dirC = Math.sin(a1 - a0) >= 0 ? 1 : -1;
      // ... and which way the SLEEVE runs round (resume 7 Oct): its solved cloth 3-10 cm up from the join is clean and faces out, so its turn
      // against the cuff's s (through each sleeve vertex's nearest join point in the flat) is the reference. On the bake's shirts the cuff is
      // sewn to the sleeve MIRRORED (the cuff's own turn runs against the sleeve's): the solver could only crumple that join (CLOTH7's
      // "window"), and the funnel laid on the cuff's turn came out inside-out (dark at 270 px, bench cloth8_a). The cuff follows the sleeve
      // (`O.follow`): laid with the sleeve's turn, then its triangles turned over if its outside faces in (the cuff's outside stays out).
      const sTurn = (() => { const jn = [...cw.keys()].filter(w => [...panelsOf(w)].some(p => p !== cp.panel)), sp = new Set(); for (const w of jn) for (const pp of panelsOf(w)) if (pp !== cp.panel) sp.add(pp);
        const jr = []; for (const w of jn) for (const i of Wg.dups[w]) if (sp.has(g.panel[i])) jr.push([g.uv[i * 2], g.uv[i * 2 + 1], g.panel[i], fl(cw.get(w), 0)]);
        const bins = new Map(); for (let w = 0; w < Wg.m; w++) { if (cw.has(w)) continue; let bd = Infinity, sb = 0; for (const i of Wg.dups[w]) { if (!sp.has(g.panel[i])) continue; for (const [u, v, pn, sv] of jr) if (pn === g.panel[i]) { const d = Math.hypot(g.uv[i * 2] - u, g.uv[i * 2 + 1] - v); if (d < bd) { bd = d; sb = sv; } } }
          if (!(bd > 0.03 && bd < 0.1)) continue; const [, , th] = loc([Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]]), k = Math.floor((sb - sMin) / 0.01), B = bins.get(k) || bins.set(k, [0, 0, 0]).get(k); B[0] += Math.cos(th); B[1] += Math.sin(th); B[2]++; }
        const ks = [...bins.keys()].sort((a, b) => a - b); let turn = 0, pairs = 0; for (let k = 1; k < ks.length; k++) { if (ks[k] - ks[k - 1] > 2) continue; const A = bins.get(ks[k - 1]), B = bins.get(ks[k]); if (A[2] < 2 || B[2] < 2) continue; turn += Math.sin(Math.atan2(B[1], B[0]) - Math.atan2(A[1], A[0])); pairs++; }
        return { turn, pairs }; })();
      const dir = sTurn.pairs >= 4 && Math.abs(sTurn.turn) > 0.2 ? Math.sign(sTurn.turn) : dirC;
      // arc length round each slice -> angle: the cuff's s as a fraction of its buttoned girth (the overlap end runs past a full turn)
      const arcMap = S => { const arc = [0]; for (let j = 0; j < K * 2; j++) { const th0 = a0 + dir * j / K * TAU, th1 = a0 + dir * (j + 1) / K * TAU, ra = S.R(((th0 % TAU) + TAU) % TAU), rb = S.R(((th1 % TAU) + TAU) % TAU); arc.push(arc[j] + Math.hypot(rb * Math.cos(th1) - ra * Math.cos(th0), rb * Math.sin(th1) - ra * Math.sin(th0))); }
          return fr => { const s = fr * S.girth; let j = arc.findIndex(x => x >= s); if (j <= 0) j = 1; const f = (s - arc[j - 1]) / ((arc[j] - arc[j - 1]) || 1); return a0 + dir * (j - 1 + f) / K * TAU; }; };
      const angT = arcMap(sTop), angB = arcMap(sBot);
      // the cuff laid on the tube: s -> angle (the under end at a0), h -> t; the overlapping top end (s > Ceff) `thick` outside
      let moved = 0, maxMm = 0;
      for (const [w, i] of cw) { const s = fl(i, 0) - sMin, h = hOf(i), fr = ring ? s / Lc : s / Ceff, th = angB(fr) * (1 - h / Hc) + angT(fr) * (h / Hc), thn = ((th % TAU) + TAU) % TAU, t = -(Hc - h), over = !ring && s > Ceff ? O.thick * sstep(Ceff, Ceff + 0.006, s) : 0, r = Rat(thn, h) + over;
        const f = h / Hc, ox = sBot.cx * (1 - f) + sTop.cx * f, oy = sBot.cy * (1 - f) + sTop.cy * f, Cc = [C0[0] + b1[0] * ox + b2[0] * oy, C0[1] + b1[1] * ox + b2[1] * oy, C0[2] + b1[2] * ox + b2[2] * oy];
        const p = [Cc[0] + ax[0] * t + (b1[0] * Math.cos(thn) + b2[0] * Math.sin(thn)) * r, Cc[1] + ax[1] * t + (b1[1] * Math.cos(thn) + b2[1] * Math.sin(thn)) * r, Cc[2] + ax[2] * t + (b1[2] * Math.cos(thn) + b2[2] * Math.sin(thn)) * r];
        maxMm = Math.max(maxMm, Math.hypot(p[0] - Pw[w * 3], p[1] - Pw[w * 3 + 1], p[2] - Pw[w * 3 + 2]) * 1000); for (let c = 0; c < 3; c++) Pw[w * 3 + c] = p[c]; pin[w] = 1; moved++; }
      // the cuff's outside out: its triangles (laid on the sleeve's turn) turned over when most face the arm; the garment re-welded (same ids)
      let flipped = false; { let o = 0, k = 0; const T0 = g.T; for (let t = 0; t < T0.length; t += 3) { if (g.panel[T0[t]] !== cp.panel) continue; const pa = Wg.wid[T0[t]], pb = Wg.wid[T0[t + 1]], pc = Wg.wid[T0[t + 2]], A = [Pw[pa * 3], Pw[pa * 3 + 1], Pw[pa * 3 + 2]], B = [Pw[pb * 3], Pw[pb * 3 + 1], Pw[pb * 3 + 2]], Cq = [Pw[pc * 3], Pw[pc * 3 + 1], Pw[pc * 3 + 2]], ce = [(A[0] + B[0] + Cq[0]) / 3, (A[1] + B[1] + Cq[1]) / 3, (A[2] + B[2] + Cq[2]) / 3], d = sub(ce, C0), rr = sub(d, [ax[0] * dot(d, ax), ax[1] * dot(d, ax), ax[2] * dot(d, ax)]); o += dot(cross(sub(B, A), sub(Cq, A)), rr) > 0 ? 1 : -1; k++; }
        if (k && o < 0) { const T1 = Int32Array.from(g.T); for (let t = 0; t < T1.length; t += 3) if (g.panel[T1[t]] === cp.panel) { const x = T1[t + 1]; T1[t + 1] = T1[t + 2]; T1[t + 2] = x; } g.T = T1; Wg = weldGarment(g); W.set(g, Wg); flipped = true;
          // what is bound to the turned triangles (carry8): its barycentrics follow the swapped corners, its offset the turned normal
          for (const bd of ctx.binds || []) { if (bd.g !== g) continue; const B = bd.B; for (let v = 0; v < B.n; v++) { const t = B.tri[v]; if (t < 0 || g.panel[g.T[t * 3]] !== cp.panel) continue; const x = B.bc[v * 3 + 1]; B.bc[v * 3 + 1] = B.bc[v * 3 + 2]; B.bc[v * 3 + 2] = x; B.dn[v] = -B.dn[v]; } } } }
      // the sleeve eased into the cuff's top: above the join narrowing onto the cuff's radius over `blend`; below it, inside the cuff
      let eased = 0; const isCuff = w => cw.has(w), sleeveP = new Set(); for (const w of join) for (const pp of panelsOf(w)) if (pp !== cp.panel) sleeveP.add(pp);
      const Ct = [C0[0] + b1[0] * sTop.cx + b2[0] * sTop.cy, C0[1] + b1[1] * sTop.cx + b2[1] * sTop.cy, C0[2] + b1[2] * sTop.cx + b2[2] * sTop.cy];
      // the sleeve's flat distance from the join (its own panel's pattern): the cloth must RISE from the join (a sleeve folded down inside
      // the cuff showed the wrist between the two), at least `rise` x that distance up the arm
      const jUV = []; for (const w of join) for (const i of Wg.dups[w]) if (sleeveP.has(g.panel[i])) jUV.push(g.uv[i * 2], g.uv[i * 2 + 1], g.panel[i]);
      const flatD = w => { let b = Infinity; for (const i of Wg.dups[w]) { if (!sleeveP.has(g.panel[i])) continue; const x = g.uv[i * 2], y = g.uv[i * 2 + 1]; for (let k = 0; k < jUV.length; k += 3) if (jUV[k + 2] === g.panel[i]) b = Math.min(b, Math.hypot(x - jUV[k], y - jUV[k + 1])); } return b; };
      let lifted = 0;
      // the sleeve's last `funnel` of cloth (flat distance from the join) laid as a clean funnel rising from the cuff's top: each vertex at
      // the angle of its nearest join point (in the sleeve's own flat pattern), `rise` x its flat distance up the arm, the cuff's radius
      // + `flare` x that distance out; blended into the solved sleeve over the funnel's upper half (the solver's sleeve had folded down
      // into the cuff and opened a mouth over it that showed the wrist)
      const jw = join.map(w => { const p = [Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]], d = sub(p, Ct); return { w, th: Math.atan2(dot(d, b2), dot(d, b1)), uv: Wg.dups[w].filter(i => sleeveP.has(g.panel[i])).map(i => [g.uv[i * 2], g.uv[i * 2 + 1], g.panel[i]]) }; });
      const nearJ0 = w => { let best = null, bd = Infinity; for (const i of Wg.dups[w]) { if (!sleeveP.has(g.panel[i])) continue; const x = g.uv[i * 2], y = g.uv[i * 2 + 1]; for (const J of jw) for (const [u, v, pn] of J.uv) if (pn === g.panel[i]) { const d = Math.hypot(x - u, y - v); if (d < bd) { bd = d; best = J; } } } return best ? { th: best.th, d: bd } : null; };
      // the seed angle of each funnel vertex: its nearest join point's (the 'segment' map along the join's polyline measured no better and was
      // deleted c3 it1); the harmonic map below replaces it over the funnel's cloth
      const nearJ = nearJ0;
      // THE HARMONIC FUNNEL (third resume, 8 Oct): the angle round the arm of each funnel vertex is HARMONIC over the funnel's cloth,
      // between the cuff's laid top row (below) and the solved sleeve just outside the funnel (above), not its nearest join point's: the
      // shirts' sleeves are sewn into the cuff with PLEATS (the sleeve's edge runs forward, back and forward along the cuff), so every
      // map by the join point turned half the funnel's triangles inside out (L05: 'in' 12-26 of every 40 at 1-8 cm, the forearm's dark
      // triangles); a harmonic map of the funnel (an annulus) onto the circle is folded only next to the pleats at the join.
      const FN = new Map(); for (let w = 0; w < Wg.m; w++) { if (isCuff(w)) continue; const ps = panelsOf(w); if (![...ps].some(pp => sleeveP.has(pp))) continue; const nj = nearJ(w); if (!nj || nj.d > O.funnel) continue; FN.set(w, nj); }
      if (FN.size) { const nbs = new Map(); for (const w of FN.keys()) nbs.set(w, new Set());
        for (let t = 0; t < Wg.T.length; t += 3) for (let k = 0; k < 3; k++) { const a = Wg.T[t + k], b = Wg.T[t + (k + 1) % 3]; if (nbs.has(a)) nbs.get(a).add(b); if (nbs.has(b)) nbs.get(b).add(a); }
        const angOf = w => { const d = sub([Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]], Ct); return Math.atan2(dot(d, b2), dot(d, b1)); };
        const val = new Map(); for (const [w, L] of nbs) { const th0 = FN.get(w).th; val.set(w, [Math.cos(th0), Math.sin(th0)]); for (const u of L) if (!FN.has(u) && !val.has(u)) { const a = angOf(u); val.set(u, [Math.cos(a), Math.sin(a)]); } }
        const inner = [...FN.keys()]; for (let it = 0; it < (O.harmIter || 400); it++) { const nx = new Map(); for (const w of inner) { let x = 0, y = 0, c = 0; for (const u of nbs.get(w)) { const v = val.get(u); if (!v) continue; x += v[0]; y += v[1]; c++; } if (c) nx.set(w, [x / c, y / c]); } for (const [w, v] of nx) val.set(w, v); }
        for (const w of inner) { const v = val.get(w); if (Math.hypot(v[0], v[1]) > 1e-6) FN.get(w).th = Math.atan2(v[1], v[0]); } }
      for (const [w, nj] of FN) {
        const fd = nj.d, wgt = 1 - sstep(O.funnel * 0.7, O.funnel, fd), th = nj.th, thn = ((th % TAU) + TAU) % TAU, rr = sTop.R(thn) + O.flare * fd, tt = O.rise * fd;
        const q = [Ct[0] + ax[0] * tt + (b1[0] * Math.cos(th) + b2[0] * Math.sin(th)) * rr, Ct[1] + ax[1] * tt + (b1[1] * Math.cos(th) + b2[1] * Math.sin(th)) * rr, Ct[2] + ax[2] * tt + (b1[2] * Math.cos(th) + b2[2] * Math.sin(th)) * rr];
        for (let c = 0; c < 3; c++) Pw[w * 3 + c] = Pw[w * 3 + c] * (1 - wgt) + q[c] * wgt;
        if (bodySurf) { const qq = bodySurf.closestAny(Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2], 0.06); if (qq && !qq.edge && qq.d < O.skinGap) { const k = O.skinGap - qq.d; Pw[w * 3] += qq.nx * k; Pw[w * 3 + 1] += qq.ny * k; Pw[w * 3 + 2] += qq.nz * k; } }
        pin[w] = 1; eased++; if (wgt > 0.5) lifted++; }
      if (ctx.O.debugFunnel) { const hist = {}; for (let t = 0; t < g.T.length; t += 3) { const ws = [0, 1, 2].map(k => Wg.wid[g.T[t + k]]); if (ws.some(w => isCuff(w)) || !ws.every(w => pin[w])) continue; if (![...panelsOf(ws[0])].some(pp => sleeveP.has(pp))) continue;
          const [A, B, Cq] = ws.map(w => [Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]]), nf = cross(sub(B, A), sub(Cq, A)), ce = [(A[0] + B[0] + Cq[0]) / 3, (A[1] + B[1] + Cq[1]) / 3, (A[2] + B[2] + Cq[2]) / 3], d = sub(ce, Ct), rad = sub(d, [ax[0] * dot(d, ax), ax[1] * dot(d, ax), ax[2] * dot(d, ax)]);
          const nj = FN.get(ws[0]) || nearJ(ws[0]), k = nj ? Math.round(nj.d * 100) : -1, o = dot(nf, rad) >= 0 ? 'out' : 'in', H = hist[k] ||= { out: 0, in: 0 }; H[o]++; }
        ctx.log('cuff8 funnel faces by flat cm from the join', sd, JSON.stringify(hist)); }
      // the rest of this sleeve's cloth over the cuff (beyond the funnel in the flat: the solver's fold-down) out of the forearm's skin
      if (bodySurf) for (let w = 0; w < Wg.m; w++) { if (isCuff(w)) continue; const ps = panelsOf(w); if (![...ps].some(pp => sleeveP.has(pp))) continue; const d = sub([Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]], Ct), t = dot(d, ax); if (t < -Hc || t > O.pushUp) continue;
        const qq = bodySurf.closestAny(Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2], 0.06); if (qq && !qq.edge && qq.d < O.skinGap) { const k = O.skinGap - qq.d; Pw[w * 3] += qq.nx * k; Pw[w * 3 + 1] += qq.ny * k; Pw[w * 3 + 2] += qq.nz * k; pin[w] = 1; } }
      // (probe) the sleeve's clearance off the skin over the cuff, after the easing
      const clr = []; if (bodySurf) for (let w = 0; w < Wg.m; w++) { if (isCuff(w)) continue; const ps = panelsOf(w); if (![...ps].some(pp => sleeveP.has(pp))) continue; const d = sub([Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]], Ct), t = dot(d, ax); if (t < 0 || t > 0.05) continue; const q = bodySurf.closestAny(Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2], 0.05); clr.push(q ? +(q.d * 1000).toFixed(1) : null); }
      if (ctx.O.debugCuff) ctx.log('cuff8 dbg', sd, JSON.stringify((ctx.dbg || []).filter(x => x[7] != null && x[7] < 0).slice(0, 30))); ctx.dbg = [];
      rep[sd] = { clearMm: clr.sort((a, b) => a - b).slice(0, 4), ring, turn: { cuff: dirC, sleeve: +sTurn.turn.toFixed(2), pairs: sTurn.pairs, laid: dir, flipped }, panel: cp.panel, verts: moved, join: join.length, lengthCm: +(Lc * 100).toFixed(1), heightCm: +(Hc * 100).toFixed(1), easeMm: +(e * 1000).toFixed(1), girthCm: [+(sTop.girth * 100).toFixed(1), +(sBot.girth * 100).toFixed(1)], joinAboveWristCm: +(tJ * 100).toFixed(1), maxMm: +maxMm.toFixed(1), sleeveEased: eased, lifted };
      const Rpt = (t, th) => { const h = Math.min(Hc, Math.max(0, t + Hc)); return Rat(th, h); }, Cb = [C0[0] + b1[0] * sBot.cx + b2[0] * sBot.cy, C0[1] + b1[1] * sBot.cx + b2[1] * sBot.cy, C0[2] + b1[2] * sBot.cx + b2[2] * sBot.cy];
      // the sleeve's placket slit over the cuff (the sleeve's own free edge running up from the cuff's ends): its two sides, by height
      const loopsC = Wg.loops.filter(L => L.ids.some(w => cw.has(w))); ctx.log('cuff8', sd, 'loops with cuff', JSON.stringify(loopsC.map(L => [L.ids.length, L.ids.filter(w => cw.has(w)).length, L.closed])));
      const loop = loopsC.sort((a, b) => b.ids.filter(w => !cw.has(w)).length - a.ids.filter(w => !cw.has(w)).length)[0], slit = loop ? loop.ids.filter(w => !cw.has(w) && [...panelsOf(w)].some(pp => sleeveP.has(pp))) : [];
      (ctx.cuffs ||= []).push({ g, panel: cp.panel, side: sd, Hc, C0, Ct, Cb, ax, b1, b2, Rpt, slitLoop: loop ? loop.ids.filter(w => !cw.has(w)) : [], slit, cw: [...cw.keys()], bottom: [...cw.entries()].filter(([, i]) => hOf(i) < 0.0015).sort((a, b) => fl(a[1], 0) - fl(b[1], 0)).map(([w]) => w) });
      ctx.log('cuff8', g.name, sd, JSON.stringify(rep[sd])); } }
  return rep;
}

// the facing: the cuff panel's own cloth turned in at the cuff's edge, almost its full height (after the garments are final, posed)
export function cuff8Facing(ctx) {
  const { parts, P, W, M, scale, body } = ctx, O = { ...CUFF8, ...(ctx.O.cuff || {}) }, rep = {}; if (!ctx.cuffs?.length) return null;
  const gar = parts.filter(q => q.group === 'garment'), grid = new TriGrid(0.008); for (const g of gar) grid.add(P(g), g.T, 'g'); if (body) grid.add(body.X, body.T, 'body');
  let nX = 0, nT = 0; for (const g of gar) { nX += g.X.length; nT += g.T.length; } const check = { X: new Float64Array(nX), T: new Int32Array(nT) }; { let ox = 0, ot = 0; for (const g of gar) { check.X.set(P(g), ox); for (let i = 0; i < g.T.length; i++) check.T[ot + i] = g.T[i] + ox / 3; ox += g.X.length; ot += g.T.length; } }
  for (const cf of ctx.cuffs) { const g = cf.g, Wg = W.get(g), Pp = P(g), Pw = new Float64Array(Wg.m * 3); for (let w = 0; w < Wg.m; w++) for (let c = 0; c < 3; c++) Pw[w * 3 + c] = Pp[Wg.rep[w] * 3 + c];
    if (cf.bottom.length < 4) { rep[cf.side] = { skipped: 'no edge' }; continue; }
    // plan7 on the cuff's own bottom row (an open run), the layer the cuff's height less the inset (it stops short of the join seam)
    const sg = outwardSign(Pw, vertexNormals(Pw, Wg.T), body), pl = plan7(g, Wg, cf.bottom, { depth: cf.Hc - O.facingInset, closed: false, name: 'cuff.facing.' + cf.side });
    if (!pl) { rep[cf.side] = { skipped: 'empty plan' }; continue; }
    const z = realize7(g, Wg, pl, Pp, { M, scale, grid, check, off: 0.0012, minOff: 0.0004, bulge: 0.0009, sign: sg });
    const old = parts.findIndex(q => q.name === 'cuff.edge.' + cf.side && q.owner === g.owner), base = old >= 0 ? parts[old] : null;
    const np = { name: 'cuff.edge.' + cf.side, group: 'construction', owner: g.owner, part: base?.part ?? g.owner, construction: base?.construction ?? 'cuff', fabric: base?.fabric ?? g.fabric, color: base?.color ?? g.color, sewn: 1, X: z.X, T: z.T, SI: z.SI, SW: z.SW, uv: new Float64Array(z.X.length / 3 * 2), flatUv: false, solid: false, cloth8: 'facing' };
    if (old >= 0) parts[old] = np; else parts.push(np); ctx.posed.set(np, z.Xp); rep[cf.side] = { ...z.report, depthCm: +((cf.Hc - O.facingInset) * 100).toFixed(1) }; }
  // the cuff's BUTTON made again on the cuff's outside (where the old one was round the wrist, at the cuff's mid height, facing out);
  // the cuff's TAB (a strip that lay on the old folded cuff) is not drawn: the bake's cuff is a closed ring, with no opening to close
  for (const cf of ctx.cuffs) { const polar = (x, y, z) => { const d = [x - cf.Ct[0], y - cf.Ct[1], z - cf.Ct[2]], t = d[0] * cf.ax[0] + d[1] * cf.ax[1] + d[2] * cf.ax[2], px = d[0] * cf.b1[0] + d[1] * cf.b1[1] + d[2] * cf.b1[2], py = d[0] * cf.b2[0] + d[1] * cf.b2[1] + d[2] * cf.b2[2]; return [t, Math.hypot(px, py), ((Math.atan2(py, px) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)]; };
    const bi = parts.findIndex(x => x.owner === cf.g.owner && x.name === 'button.cuff.' + cf.side);
    if (bi >= 0) { const q = parts[bi], Xq = P(q); let sx = 0, sy = 0; for (let v = 0; v < Xq.length / 3; v++) { const [, , th] = polar(Xq[v * 3], Xq[v * 3 + 1], Xq[v * 3 + 2]); sx += Math.cos(th); sy += Math.sin(th); }
      const th = Math.atan2(sy, sx), t = -cf.Hc * 0.5, dir = [0, 1, 2].map(c => cf.b1[c] * Math.cos(th) + cf.b2[c] * Math.sin(th)), Cc = [0, 1, 2].map(c => cf.Ct[c] * 0.5 + cf.Cb[c] * 0.5), r = cf.Rpt(t, ((th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
      const p = [0, 1, 2].map(c => Cc[c] + cf.ax[c] * t + dir[c] * (r + 0.0016)), bt = buttonGeom(p, dir, 0.0055, 0.0022), nv = bt.X.length / 3;
      // its weights: the nearest cuff vertex's
      const Pg = P(cf.g), Wg = W.get(cf.g); let bv = -1, bd = Infinity; for (const w of cf.cw) { const i = Wg.rep[w], d = (Pg[i * 3] - p[0]) ** 2 + (Pg[i * 3 + 1] - p[1]) ** 2 + (Pg[i * 3 + 2] - p[2]) ** 2; if (d < bd) { bd = d; bv = i; } }
      const SI = new Uint16Array(nv * 4), SW = new Float32Array(nv * 4), Xb = new Float64Array(nv * 3), tmp = [0, 0, 0]; for (let v = 0; v < nv; v++) { for (let k = 0; k < 4; k++) { SI[v * 4 + k] = cf.g.SI[bv * 4 + k]; SW[v * 4 + k] = cf.g.SW[bv * 4 + k]; } blendInverse(SI, SW, v, M, bt.X[v * 3] / scale, bt.X[v * 3 + 1] / scale, bt.X[v * 3 + 2] / scale, tmp, 0); for (let c = 0; c < 3; c++) Xb[v * 3 + c] = Math.round(tmp[c] * scale * 1e4) / 1e4; }
      parts[bi] = { ...q, X: Xb, T: Int32Array.from(bt.T), SI, SW, uv: new Float64Array(nv * 2), cloth8: 'button' }; ctx.posed.set(parts[bi], Float64Array.from(bt.X)); (rep.button ||= {})[cf.side] = { thetaDeg: +(th * 180 / Math.PI).toFixed(0) }; }
    const ti = parts.findIndex(x => x.owner === cf.g.owner && x.name === 'cuff.tab.' + cf.side); if (ti >= 0) { parts.splice(ti, 1); (rep.tabDropped ||= []).push(cf.side); } }
  // the placket's UNDERLAP: the sleeve's slit over the cuff shows the wrist through it; a real sleeve has a strip of its cloth behind the
  // slit (the placket's underlap): a ribbon from one side of the slit to the other, 1.2 mm inside, from the cuff's top to the slit's head
  for (const cf of ctx.cuffs) { const r = underlap8(ctx, cf); if (r) (rep.underlap ||= {})[cf.side] = r.report; }
  ctx.log('cuff8', 'facing', JSON.stringify(rep).slice(0, 1500));
  // CLOTH4's join band: the join is a sewn seam now
  const drop = []; for (let k = 0; k < parts.length; k++) if (/^cuff\.join\.[LR]$/.test(parts[k].name) && ctx.cuffs.some(c => c.side === parts[k].name.slice(-1) && c.g.owner === parts[k].owner)) drop.push(k);
  for (const k of drop.reverse()) parts.splice(k, 1); rep.joinBandsDropped = drop.length;
  return rep;
}

// the underlap: the slit's two sides (the cuff loop's sleeve run split at its highest point), sampled at matched heights, bridged
export function underlap8(ctx, cf, { inset = 0.0012, rows = 8 } = {}) {
  const { parts, P, M, scale, W } = ctx, g = cf.g, Wg = W.get(g), Pp = P(g); if (!cf.slitLoop || cf.slitLoop.length < 4) return { report: { skipped: 'no slit loop', n: cf.slitLoop?.length } };
  // the loop's run outside the cuff, in loop order (the loop is closed: rotate so the run is contiguous)
  const L = Wg.loops.filter(L2 => L2.ids.some(w => cf.cw.includes(w))).sort((a, b) => b.ids.filter(w => !cf.cw.includes(w)).length - a.ids.filter(w => !cf.cw.includes(w)).length)[0]; if (!L) return { report: { skipped: 'no loop' } }; const cwS = new Set(cf.cw), ids = L.ids, nL = ids.length; let st = ids.findIndex((w, i) => cwS.has(w) && !cwS.has(ids[(i + 1) % nL])); if (st < 0) return { report: { skipped: 'no run start' } };
  const run = []; for (let k = 1; k < nL; k++) { const w = ids[(st + k) % nL]; if (cwS.has(w)) break; run.push(w); } if (run.length < 4) return { report: { skipped: 'short run', n: run.length } };
  const pos = w => { const i = Wg.rep[w]; return [Pp[i * 3], Pp[i * 3 + 1], Pp[i * 3 + 2]]; }, tOf = p => (p[0] - cf.Ct[0]) * cf.ax[0] + (p[1] - cf.Ct[1]) * cf.ax[1] + (p[2] - cf.Ct[2]) * cf.ax[2];
  let apex = 0, tb = -Infinity; run.forEach((w, k) => { const t = tOf(pos(w)); if (t > tb) { tb = t; apex = k; } }); if (tb < 0.01 || tb > 0.2 || apex < 1 || apex > run.length - 2) return { report: { skipped: 'apex', tb, apex, n: run.length, ts: run.map(w => +tOf(pos(w)).toFixed(3)) } };
  const A = run.slice(0, apex + 1), B = run.slice(apex).reverse(), at = (side, t) => { // the side's point (and nearest vertex) at height t
    let best = null; for (let k = 0; k + 1 < side.length; k++) { const p = pos(side[k]), q = pos(side[k + 1]), ta = tOf(p), tq = tOf(q); if ((t - ta) * (t - tq) > 0 && k + 2 < side.length) continue; const f = Math.abs(tq - ta) > 1e-9 ? Math.min(1, Math.max(0, (t - ta) / (tq - ta))) : 0; best = { p: [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f], w: f < 0.5 ? side[k] : side[k + 1] }; if ((t - ta) * (t - tq) <= 0) break; } return best; };
  const t0 = Math.max(tOf(pos(A[0])), tOf(pos(B[0]))) - 0.004, X = [], SI = [], SW = [], cols = 4;
  for (let j = 0; j <= rows; j++) { const t = t0 + (tb - t0) * j / rows, a = at(A, t), b = at(B, t); if (!a || !b) return null;
    for (let c = 0; c <= cols; c++) { const f = c / cols, p = [a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f, a.p[2] + (b.p[2] - a.p[2]) * f], d = [p[0] - cf.Ct[0], p[1] - cf.Ct[1], p[2] - cf.Ct[2]], tt = d[0] * cf.ax[0] + d[1] * cf.ax[1] + d[2] * cf.ax[2], rv = [d[0] - cf.ax[0] * tt, d[1] - cf.ax[1] * tt, d[2] - cf.ax[2] * tt], rl = Math.hypot(...rv) || 1;
      // bowed a little outward between the sides (it is cloth lying under the slit, not a chord through the wrist), `inset` inside them
      const bow = Math.sin(Math.PI * f) * 0.25 * Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]) * 0.15; for (let k = 0; k < 3; k++) X.push(p[k] + rv[k] / rl * (bow - inset));
      const i = Wg.rep[f < 0.5 ? a.w : b.w]; for (let k = 0; k < 4; k++) { SI.push(g.SI[i * 4 + k]); SW.push(g.SW[i * 4 + k]); } } }
  const T = []; for (let j = 0; j < rows; j++) for (let c = 0; c < cols; c++) { const a = j * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1; T.push(a, b, d, b, e, d); }
  // facing out of the arm
  { let s = 0; for (let k = 0; k < T.length; k += 3) { const a = T[k], b = T[k + 1], c = T[k + 2], u = [X[b * 3] - X[a * 3], X[b * 3 + 1] - X[a * 3 + 1], X[b * 3 + 2] - X[a * 3 + 2]], v = [X[c * 3] - X[a * 3], X[c * 3 + 1] - X[a * 3 + 1], X[c * 3 + 2] - X[a * 3 + 2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], d = [X[a * 3] - cf.Ct[0], X[a * 3 + 1] - cf.Ct[1], X[a * 3 + 2] - cf.Ct[2]]; s += n[0] * d[0] + n[1] * d[1] + n[2] * d[2]; }
    if (s < 0) for (let k = 0; k < T.length; k += 3) { const x = T[k + 1]; T[k + 1] = T[k + 2]; T[k + 2] = x; } }
  const nv = X.length / 3, Xb = new Float64Array(nv * 3), SIa = Uint16Array.from(SI), SWa = Float32Array.from(SW), tmp = [0, 0, 0];
  for (let v = 0; v < nv; v++) { blendInverse(SIa, SWa, v, M, X[v * 3] / scale, X[v * 3 + 1] / scale, X[v * 3 + 2] / scale, tmp, 0); for (let c = 0; c < 3; c++) Xb[v * 3 + c] = Math.round(tmp[c] * scale * 1e4) / 1e4; }
  const tab = parts.find(q => q.name === 'cuff.tab.' + cf.side && q.owner === g.owner);
  const np = { name: 'cuff.underlap.' + cf.side, group: 'construction', owner: g.owner, part: tab?.part ?? g.owner, construction: tab?.construction ?? 'cuff', fabric: tab?.fabric ?? g.fabric, color: tab?.color ?? g.color, sewn: 1, X: Xb, T: Int32Array.from(T), SI: SIa, SW: SWa, uv: new Float64Array(nv * 2), flatUv: false, solid: false, cloth8: 'underlap' };
  parts.push(np); ctx.posed.set(np, Float64Array.from(X)); return { part: np, report: { slitCm: +((tb - t0) * 100).toFixed(1), widthMm: +(Math.hypot(...[0, 1, 2].map(k => at(A, t0 + 0.004).p[k] - at(B, t0 + 0.004).p[k])) * 1000).toFixed(1) } };
}
