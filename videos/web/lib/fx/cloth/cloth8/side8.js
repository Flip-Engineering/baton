// CLOTH8 (round 7, 8 Oct, iteration 2): THE SLEEVE AND THE GARMENT'S OWN SIDE, IN ORDER BETWEEN THE ARM AND THE TORSO (stage 'side',
// after 'rib', before 'relax'). Found with a node probe (crossing pairs by panel and by where on the arm): most of what the rulers called
// "elbow" and "armpit" crossings are NOT a sleeve folded through itself but the SLEEVE'S INNER WALL THROUGH THE GARMENT'S OWN BODY PANEL
// where the arm hangs against the torso (L23's coat: ~380 of 556 crossing pairs are sleeve x front / back panel; L12's coat ~550 of
// 580; L05's shirt, L21's and L14's tops the same). Both sheets lie in the 2-4 cm gap between the arm's skin and the torso's and cross
// round its middle (the crossing vertices: distance to the torso minus distance to the arm, median +1 to +8 mm for the sleeve and -4 to
// +1 mm for the body panel). A real garment keeps them in order: torso | its body panel | its sleeve | the arm. Here, with
//   phi(p) = (distance to the torso's skin) - (distance to the arm's skin)      (the medial surface between them is phi = 0)
// every sleeve vertex in the gap is kept at phi >= +margin and every body-panel vertex at phi <= -margin, moved along the gradient of
// phi (towards its own skin, away from the other), never nearer its own skin than `gap`; the corrections are a displacement field
// smoothed over the cloth each round (no kinks; the folds keep their shape), zero at the armhole seam (where sleeve and body are sewn
// and the two skins meet) and faded in over `seamFade` from it, zero outside the gap. The skins are the body's VERTICES (the page's
// body is culled under the cloth, so its triangles are missing just where this looks), split by skin weight: each arm (upper arm to
// fingers) and the rest. Held: the free edges and `edgeRings` rings in (the turned hems ride there), and a vertex whose other sheet is not
// within `gate` (a tee's side by a bare forearm has nothing to be ordered against). GUARD: a garment keeps the result only if it crosses
// itself less than before (the tops and MOTION's bent-arm dress7 poses came out worse: reverted, as before this stage). relax8 then
// clears what still crosses. (The 'sheet' and 'local' modes measured worse and were deleted c3 it1; git history has them.)
//   side8(ctx) -> { '<garment>': { gap, before, after, moved, maxMm } }     (plain data; ctx from rebuild8; positions edited in place)
import { adjacency } from './relax8.js';
import { armCurve } from './sleeve8.js';
import { SurfaceMesh } from '../collide.js';
import { selfIntersections } from '../cloth5/measure5.js';
export const SIDE8_VERSION = 1;
export const SIDE8 = { owners: ['shirt', 'top', 'outer'], margin: 0.003, reach: 0.05, rounds: 40, smooth: 2, alpha: 0.5, maxMove: 0.03, gap: 0.003, seamFade: [0.01, 0.05], sleeveR: 0.11, sleeveFrac: 0.6, cell: 0.02, minGrad: 0.6, zoneRings: 3, gate: 0.04, edgeRings: 2, edgeFade: false, guard: true };   // (edgeFade: measured no effect on the four it was tried on)
const ARM = sd => new RegExp(`(upperarm|lowerarm|wrist|hand|finger|thumb|index|middle|ring|pinky|metacarpal)[^.]*\\.${sd}$`);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// nearest skin vertex of each label (0 torso and the rest, 1 left arm, 2 right arm): { d, dir } (dir: unit vector from p to it)
export function skinSets(body, cell = 0.02) {
  const X = body.X, n = X.length / 3, lab = new Int8Array(n), isL = body.bones.map(x => ARM('L').test(x)), isR = body.bones.map(x => ARM('R').test(x));
  for (let v = 0; v < n; v++) { let wl = 0, wr = 0; for (let k = 0; k < 4; k++) { const j = body.SI[v * 4 + k], w = body.SW[v * 4 + k]; if (isL[j]) wl += w; if (isR[j]) wr += w; } lab[v] = wl > 0.5 ? 1 : wr > 0.5 ? 2 : 0; }
  const ic = 1 / cell, key = (i, j, k) => ((i + 1024) * 2048 + (j + 1024)) * 2048 + (k + 1024), H = [new Map(), new Map(), new Map()];
  for (let v = 0; v < n; v++) { const kk = key(Math.floor(X[v * 3] * ic), Math.floor(X[v * 3 + 1] * ic), Math.floor(X[v * 3 + 2] * ic)), M = H[lab[v]]; (M.get(kk) || M.set(kk, []).get(kk)).push(v); }
  const near = (L, x, y, z, rmax) => { const M = H[L], ci = Math.floor(x * ic), cj = Math.floor(y * ic), ck = Math.floor(z * ic), R = Math.ceil(rmax * ic); let bd = rmax * rmax, bv = -1;
    for (let r = 0; r <= R; r++) { for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) { if (Math.max(Math.abs(a), Math.abs(b), Math.abs(c)) !== r) continue; const Lv = M.get(key(ci + a, cj + b, ck + c)); if (!Lv) continue;
        for (const v of Lv) { const d = (X[v * 3] - x) ** 2 + (X[v * 3 + 1] - y) ** 2 + (X[v * 3 + 2] - z) ** 2; if (d < bd) { bd = d; bv = v; } } }
      if (bv >= 0 && bd <= (r * cell) ** 2) break; }
    if (bv < 0) return null; const d = Math.sqrt(bd) || 1e-9; return { d, dir: [(X[bv * 3] - x) / d, (X[bv * 3 + 1] - y) / d, (X[bv * 3 + 2] - z) / d] }; };
  return { lab, near };
}

export function side8(ctx) {
  const { W, Pws, gar, J, body, bodySurf } = ctx, O = { ...SIDE8, ...(ctx.O.side || {}) }, rep = {}; if (!J?.shoulderL || !body?.SI || !body?.bones) return { skipped: 'no joints / body weights' };
  const S = skinSets(body, O.cell), curves = ['L', 'R'].map(sd => armCurve(J['shoulder' + sd], J['elbow' + sd], J['wrist' + sd]));
  for (const g of gar.filter(x => O.owners.includes(x.owner))) { const Wg = W.get(g), Pw = Pws.get(g), m = Wg.m, pin = ctx.pin?.get(g);
    // the sleeve panels (sleeve8's test: most of their cloth within sleeveR of an arm's curve)
    const np = g.panel ? Math.max(...g.panel) + 1 : 0; if (!np) continue; const cnt = new Float64Array(np), close = new Float64Array(np);
    for (let i = 0; i < g.X.length / 3; i++) { const w = Wg.wid[i], p = [Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]]; cnt[g.panel[i]]++; if (Math.min(curves[0].near(p).dist, curves[1].near(p).dist) < O.sleeveR) close[g.panel[i]]++; }
    const isSl = new Uint8Array(np); for (let k = 0; k < np; k++) isSl[k] = cnt[k] > 20 && close[k] / cnt[k] >= O.sleeveFrac ? 1 : 0; if (!isSl.some(Boolean) || isSl.every(Boolean)) { rep[g.name] = { skipped: 'no sleeve / body split' }; continue; }
    // each welded vertex: 1 sleeve, 2 body, 3 the armhole seam (sewn: both)
    const kind = new Uint8Array(m); for (let w = 0; w < m; w++) { let s = 0, b = 0; for (const i of Wg.dups[w]) { if (isSl[g.panel[i]]) s = 1; else b = 1; } kind[w] = s && b ? 3 : s ? 1 : 2; }
    const A = adjacency(Wg.T, m);
    // distance over the cloth from the armhole seam (Dijkstra on the welded edges, posed lengths; capped)
    const dS = new Float64Array(m).fill(Infinity), heap = []; const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === i) break; [heap[s], heap[i]] = [heap[i], heap[s]]; i = s; } } return top; };
    const dij = (seed, D0) => { for (let w = 0; w < m; w++) if (seed(w)) { D0[w] = 0; push(0, w); }
      while (heap.length) { const [d, v] = pop(); if (d > D0[v] || d > O.seamFade[1]) continue; for (const u of A.nb[v]) { const e = Math.hypot(Pw[u * 3] - Pw[v * 3], Pw[u * 3 + 1] - Pw[v * 3 + 1], Pw[u * 3 + 2] - Pw[v * 3 + 2]); if (d + e < D0[u]) { D0[u] = d + e; push(d + e, u); } } } };
    dij(w => kind[w] === 3, dS);
    // (and from the free edges, when `edgeFade`: the held hems are approached gradually, not against a step: L23's coat sleeve ends)
    if (O.edgeFade) { const dE = new Float64Array(m).fill(Infinity); dij(w => A.bnd[w], dE); for (let w = 0; w < m; w++) dS[w] = Math.min(dS[w], dE[w]); }
    // the zone: cloth in the gap (both skins within reach), and `zoneRings` rings round it; pinned (rib8, cuff8), the seam: fixed at 0
    const X0 = Float64Array.from(Pw), inGap = new Uint8Array(m), fixed = new Uint8Array(m);
    const probe = (w, x, y, z) => { const a = S.near(0, x, y, z, O.reach), aL = S.near(1, x, y, z, O.reach), aR = S.near(2, x, y, z, O.reach), arm = !aL ? aR : !aR ? aL : aL.d <= aR.d ? aL : aR; return a && arm ? { t: a, a: arm } : null; };
    for (let w = 0; w < m; w++) { if (kind[w] === 3 || (pin && pin[w])) { fixed[w] = 1; continue; } if (probe(w, X0[w * 3], X0[w * 3 + 1], X0[w * 3 + 2])) inGap[w] = 1; }
    const zone = Uint8Array.from(inGap); { let f = []; for (let w = 0; w < m; w++) if (inGap[w]) f.push(w); for (let k = 0; k < O.zoneRings; k++) { const nx = []; for (const v of f) for (const u of A.nb[v]) if (!zone[u]) { zone[u] = 1; nx.push(u); } f = nx; } }
    // the free edges and `edgeRings` rings in are held (CLOTH7's turned hems and facings ride there: carried, they crossed: tee.hem 31 -> 202)
    { let f = []; const ef = new Uint8Array(m); for (let w = 0; w < m; w++) if (A.bnd[w]) { ef[w] = 1; f.push(w); } for (let k = 0; k < O.edgeRings; k++) { const nx = []; for (const v of f) for (const u of A.nb[v]) if (!ef[u]) { ef[u] = 1; nx.push(u); } f = nx; } for (let w = 0; w < m; w++) if (ef[w]) fixed[w] = 1; }
    for (let w = 0; w < m; w++) if (fixed[w]) zone[w] = 0;
    // GATE: a vertex is ordered only where the other sheet is near (within `gate`): a tee's side by a BARE forearm has nothing to be ordered against
    const act = new Uint8Array(m); { const ic = 1 / O.gate, key = (i, j, k) => ((i + 1024) * 2048 + (j + 1024)) * 2048 + (k + 1024), H = [null, new Map(), new Map()];
      for (let w = 0; w < m; w++) { if (kind[w] !== 1 && kind[w] !== 2) continue; const kk = key(Math.floor(X0[w * 3] * ic), Math.floor(X0[w * 3 + 1] * ic), Math.floor(X0[w * 3 + 2] * ic)); (H[kind[w]].get(kk) || H[kind[w]].set(kk, []).get(kk)).push(w); }
      for (let w = 0; w < m; w++) { if (!zone[w] || (kind[w] !== 1 && kind[w] !== 2)) continue; const Ho = H[3 - kind[w]], x = X0[w * 3], y = X0[w * 3 + 1], z = X0[w * 3 + 2], ci = Math.floor(x * ic), cj = Math.floor(y * ic), ck = Math.floor(z * ic);
        search: for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const L = Ho.get(key(ci + a, cj + b, ck + c)); if (!L) continue; for (const u of L) if ((X0[u * 3] - x) ** 2 + (X0[u * 3 + 1] - y) ** 2 + (X0[u * 3 + 2] - z) ** 2 < O.gate * O.gate) { act[w] = 1; break search; } } } }
    const Z = []; for (let w = 0; w < m; w++) if (zone[w]) Z.push(w); if (!Z.length) { rep[g.name] = { gap: 0 }; continue; }
    const D = new Float64Array(m * 3), N = new Float64Array(m * 3);
    // one pass: each zone vertex's violation of its side of the medial surface (count, and the correction added to D)
    const pass = (apply) => passMedial(apply);
    const passMedial = (apply) => { let bad = 0;
      for (const w of Z) { if (O.gate > 0 && !act[w]) continue; const x = X0[w * 3] + D[w * 3], y = X0[w * 3 + 1] + D[w * 3 + 1], z = X0[w * 3 + 2] + D[w * 3 + 2], q = probe(w, x, y, z); if (!q) continue;
        const phi = q.t.d - q.a.d, mg = O.margin * sstep(O.seamFade[0], O.seamFade[1], dS[w]); if (mg <= 0) continue;
        // grad phi = (arm dir) - (torso dir): moving along it (towards the arm, away from the torso) raises phi at |grad| per metre
        const gx = q.a.dir[0] - q.t.dir[0], gy = q.a.dir[1] - q.t.dir[1], gz = q.a.dir[2] - q.t.dir[2], gl = Math.hypot(gx, gy, gz); if (gl < O.minGrad) continue;
        const sl = kind[w] === 1, need = sl ? mg - phi : phi + mg; if (need <= 0) continue; bad++; if (!apply) continue;
        // towards its own skin: keep `gap` from it (the move's component towards that skin)
        const own = sl ? q.a : q.t, sg = sl ? 1 : -1, ux = sg * gx / gl, uy = sg * gy / gl, uz = sg * gz / gl, toward = Math.max(0.1, ux * own.dir[0] + uy * own.dir[1] + uz * own.dir[2]);
        const dmax = Math.max(0, (own.d - O.gap) / toward), dd = Math.min(need / gl, dmax); if (dd <= 0) continue;
        D[w * 3] += ux * dd; D[w * 3 + 1] += uy * dd; D[w * 3 + 2] += uz * dd; }
      return bad; };
    const before = pass(false); let rounds = 0;
    for (let r = 0; r < O.rounds; r++) { const bad = pass(true); rounds++; if (!bad) break;
      for (let s = 0; s < O.smooth; s++) { N.set(D); for (const w of Z) { let sx = 0, sy = 0, sz = 0, c = 0; for (const u of A.nb[w]) { sx += D[u * 3]; sy += D[u * 3 + 1]; sz += D[u * 3 + 2]; c++; } if (!c) continue; N[w * 3] = (1 - O.alpha) * D[w * 3] + O.alpha * sx / c; N[w * 3 + 1] = (1 - O.alpha) * D[w * 3 + 1] + O.alpha * sy / c; N[w * 3 + 2] = (1 - O.alpha) * D[w * 3 + 2] + O.alpha * sz / c; } D.set(N); }
      for (const w of Z) { const l = Math.hypot(D[w * 3], D[w * 3 + 1], D[w * 3 + 2]); if (l > O.maxMove) for (let c = 0; c < 3; c++) D[w * 3 + c] *= O.maxMove / l; } }
    const after = pass(false); let moved = 0, mx = 0, pushed = 0;
    if (ctx.O.debugSide) { const hist = {}, why = { blocked: 0, sleeve: 0, body: 0, gradLow: 0 }; for (const w of Z) { const l = Math.hypot(D[w * 3], D[w * 3 + 1], D[w * 3 + 2]), k = l < 0.002 ? '<2' : l < 0.005 ? '<5' : l < 0.01 ? '<10' : l < 0.02 ? '<20' : '>=20'; hist[k] = (hist[k] || 0) + 1;
        const x = X0[w * 3] + D[w * 3], y = X0[w * 3 + 1] + D[w * 3 + 1], z = X0[w * 3 + 2] + D[w * 3 + 2], q = probe(w, x, y, z); if (!q) continue; const phi = q.t.d - q.a.d, mg = O.margin * sstep(O.seamFade[0], O.seamFade[1], dS[w]); if (mg <= 0) continue;
        const gl = Math.hypot(q.a.dir[0] - q.t.dir[0], q.a.dir[1] - q.t.dir[1], q.a.dir[2] - q.t.dir[2]), sl = kind[w] === 1, need = sl ? mg - phi : phi + mg; if (need <= 0) continue; if (gl < O.minGrad) { why.gradLow++; continue; } why[sl ? 'sleeve' : 'body']++; if ((sl ? q.a.d : q.t.d) < O.gap + 0.001) why.blocked++; }
      ctx.log('side8 debug', g.name, JSON.stringify({ hist, why })); }
    for (const w of Z) { const l = Math.hypot(D[w * 3], D[w * 3 + 1], D[w * 3 + 2]); if (l < 1e-6) continue; const p = [X0[w * 3] + D[w * 3], X0[w * 3 + 1] + D[w * 3 + 1], X0[w * 3 + 2] + D[w * 3 + 2]];
      if (bodySurf) { const qq = bodySurf.closestAny(p[0], p[1], p[2], 0.05); if (qq && !qq.edge && qq.d < O.gap) { const k = O.gap - qq.d; p[0] += qq.nx * k; p[1] += qq.ny * k; p[2] += qq.nz * k; pushed++; } }
      for (let c = 0; c < 3; c++) Pw[w * 3 + c] = p[c]; moved++; mx = Math.max(mx, l); }
    // GUARD: kept only if the garment crosses itself less than before (the dressed poses' bent arms: L05's and L14's dress7 got worse)
    let cross = null; if (O.guard) { const id = Int32Array.from({ length: m }, (_, i) => i), cnt = X => { const r = selfIntersections(X, Wg.T, { wid: id }); let c = 0; for (const h of r.hit) c += h; return c; }, c0 = cnt(X0), c1 = cnt(Pw);
      cross = [c0, c1]; if (c1 >= c0) { Pw.set(X0); moved = 0; cross.push('reverted'); } }
    rep[g.name] = { cross, sleevePanels: [...isSl].map((s, k) => s ? k : -1).filter(k => k >= 0), gap: inGap.reduce((a, b) => a + b, 0), zone: Z.length, before, after, rounds, moved, maxMm: +(mx * 1000).toFixed(1), pushed };
    ctx.log('side8', g.name, JSON.stringify(rep[g.name])); }
  return rep;
}
