// CLOTH8 c3 it2 (8 Oct): THE CLOTH KEEPS ITS LENGTH, SOLVED. Woven and knit cloth barely changes length in its own plane: pushed together it
// BUCKLES (a fold, a ripple, gathers); it never shrinks. rebuild8's geometric passes (sleeve8 straightening the S-fold along the arm, rib8
// laying the pushed-up sleeve as a smooth tube, side8's displacement field, relax8's Taubin steps through a crossing fold) move the cloth
// without its lengths, and the cloth that was in a fold came out SQUEEZED in its plane (weave_probe, posed: L03's shirt triangles squashed to
// under 0.6 of their pattern width 250 in v7c -> 879 in v8c, L21's top 332 -> 1561, L23's coat 501 -> 2462). The fabric draws its weave in
// the pattern's coordinates, so a squeezed patch renders as a block of denser, turned weave (the it2 measurer's 'weave blocks'), and the
// sleeve that should gather in soft folds reads as a smooth tube. strain8 (c3 it1: a Jacobi strain limit with a revert where it crossed;
// deleted c3 it2) could not move cloth that sits between two layers of the same garment. This stage SOLVES the region instead: the cloth's
// own solver (xpbd.js Cloth) on (rev 1) the squeezed and stretched cloth and 3 rings round it, (rev 2, below) the whole garment, with
//   rest      the garment's FLAT PATTERN (its uv, metres: Cloth's `metric`): every edge's rest length is its pattern length, RAMPED from the
//             length the stages left over `ramp` of the run (given back at once, cloth squeezed to 0.3 jumped centimetres in one substep
//             and passed through everything); compression 5x softer than tension: it buckles first; no tethers (they snapped stretched
//             cloth in one substep)
//   bending   the fabric's own (fabrics.js phys), rest dihedral = the shape the stages left x `restAngle` (rev 1: 1; rev 2: 0, flat panels)
//   gravity   the stance's (the folds fall the way cloth falls)
//   the body  the posed skin WITH the skin the page culls under the clothes (a collider on the culled body finds no arm under a sleeve),
//             as a FLOOR: out to the fabric's half thickness + `gap`, or as deep as the stages left it if deeper (pushed out at once, the
//             cloth inside the full skin went through the cloth over it)
//   itself    CLOTH6's Self6 (locked sides, continuous check) over the solved cloth AND the obstacles: the garment's own cloth and every
//             other garment's within `reach` of the free cloth, pinned (a sleeve's wall given back its length must fold, not pass through
//             the body panel beside it)
//   held      (rev 1: the cloth 2 rings round the region, hard pins at the stages' result); the free edges and `edgeRings` rings (hems, cuffs,
//             the sleeve's edge in its rib cuff: what is sewn on them stays on them); the cloth ALREADY crossing itself (Self6's tangled
//             set, `holdTangled`: it takes no side, and moved it carried its crossing into the cloth round it: 85 -> 304 new crossing
//             triangles on L03); what the earlier stages laid on purpose (rebuild8's pins: the tuck, the cuff and its funnel, the band
//             reaches, CLOTH7's turned layers) but NOT rib8's laid forearm sleeve (`freeRib`: a pushed-up sleeve is cloth gathered on the
//             forearm, which is what the solve gives back)
// then the guards (rev 1: a vertex moved at most 30 mm; rev 2: see below): triangles that now cross the garment's own cloth or another garment where they did
// not before go back with a ring (a few rounds). Only the posed welded cloth changes (rebuild8 then takes it back to bind).
// MEASURED (c3 it2, node, measures/c3it2_resolve.txt): about a third of the squeeze goes (posed squashed L03 shirt 879 -> 598, L21 top
// 1560 -> 928, L23 coat 2469 -> 1613; v7c 250 / 332 / 501); the rest is in cloth that already crosses itself (held) and in the cuff
// funnels and the tuck (held): untangling it in the solve (Self6 tangleMove) made more crossings (180 -> 591 on L03).
//   resolve8(ctx) -> { <garment>: { tris, out0, out1, squashed0, squashed1, region, free, held, moved, maxMm, cross0, cross1, xg0, xg1, reverted, under, tangledHeld, ms } }
//   (`debug: 1` logs where the squeeze that is left sits: free / tangled / pinned by a stage / band)
// rev 2 (CLOTH8 c8 it2, 15 Oct): THE WHOLE GARMENT, HELD ONLY WHERE IT IS HELD. Rev 1 solved only the squeezed cloth and 3 rings round it,
// with every other vertex a hard pin at the stages' result and each move capped at 30 mm; the critic beside the photographs (c8 it1,
// measures/it1.md): sleeves and torsos 'inflated smooth tubes with no gravity hang and no compression folds', a 'rounded blister' at L23's
// elbow where the cap held a ramp, 'resolve8's local region is the limit' (a patch with its neighbours pinned cannot hang a sleeve from its
// shoulder). Rev 2: every vertex of the garment is free except its SUPPORTS (the bands it is eased into and 8 mm round them: waistband,
// cuff joins, rib cuffs, hem band; what the earlier stages laid on purpose: the tuck, the cuff and its funnel; its finished free edges
// (neckline, cuffs, hems) and `edgeRings` rings, where what is sewn on it hangs; CLOTH7's turned layers; the cloth already crossing itself);
// the shoulders, the back, the front and the sleeves rest on the body by contact and friction under gravity; every edge drawn from where
// the stages left it to its PATTERN length over `ramp` of the run; flat panels (`restAngle` 0: cloth keeps no memory of the bake's tube,
// only the fabric's bending); the body's floor RAMPED from where each particle starts to the fabric's half thickness + gap (the cloth the
// bake left inside today's body is seated out of it with its layers in order, not pushed through what lies over it); then the GUARD as
// part of the solve: cloth that newly crosses itself or another garment, or travelled past `maxMove` (a blow-up, not a fold), is pinned
// back where it was and the rest SETTLES round it for `settleT` (rev 1 snapped it back beside moved neighbours: a step, a facet).
import { Cloth } from '../xpbd.js';
import { phys } from '../fabrics.js';
import { Contacts } from '../collide.js';
import { adjacency } from './relax8.js';
import { selfIntersections } from '../cloth5/measure5.js';
import { Self6 } from '../cloth6/self6.js';
export const RESOLVE8_VERSION = 2;
// smin / smax: the woven range of a stretch (cloth per pattern length; a triangle is out when below smin of what the source bake had, or
// above smax); squash: what the report counts as squeezed (weave_probe's mark)
export const RESOLVE8 = { owners: null, smin: 0.9, smax: 1.15, squash: 0.6, freeRib: true, reach: 0.03, holdTangled: true, edgeRings: 2, tangleEvery: 0, tangleMove: 0,
  T: 1.2, ramp: 0.5, hz: 600, every: 6, compress: 0.2, restAngle: 0, bendScale: 1, foldMax: 2.4, tether: false, slack: 0.02, damping: 6, vmax: 0.5,
  gap: 0.0015, mu: 0.3, th: 0.0008, selfEvery: 4, maxPush6: 0.002, margin6: 0.004, floorRamp: 0.6, maxMove: 0.10, revertRounds: 6, settleT: 0.15, fallback: 'heatherJersey' };

// "within r of any of these points" (a hash of the free cloth)
function nearPts(P, r) { const H = new Map(), key = (i, j, k) => ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048);
  for (let i = 0; i < P.length; i += 3) { const k = key(Math.floor(P[i] / r), Math.floor(P[i + 1] / r), Math.floor(P[i + 2] / r)); (H.get(k) || H.set(k, []).get(k)).push(P[i], P[i + 1], P[i + 2]); }
  return (x, y, z) => { const ci = Math.floor(x / r), cj = Math.floor(y / r), ck = Math.floor(z / r); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const L = H.get(key(ci + a, cj + b, ck + c)); if (!L) continue;
    for (let i = 0; i < L.length; i += 3) if ((L[i] - x) ** 2 + (L[i + 1] - y) ** 2 + (L[i + 2] - z) ** 2 < r * r) return true; } return false; }; }
// a pinned obstacle triangle's own flat frame (its current lengths: the solver needs a metric for it, nothing moves it)
function flat2(X, a, b, c) { const e1 = [X[b * 3] - X[a * 3], X[b * 3 + 1] - X[a * 3 + 1], X[b * 3 + 2] - X[a * 3 + 2]], e2 = [X[c * 3] - X[a * 3], X[c * 3 + 1] - X[a * 3 + 1], X[c * 3 + 2] - X[a * 3 + 2]], l1 = Math.hypot(...e1) || 1e-6;
  const u = e1.map(x => x / l1), px = e2[0] * u[0] + e2[1] * u[1] + e2[2] * u[2], py = Math.sqrt(Math.max(1e-14, e2[0] ** 2 + e2[1] ** 2 + e2[2] ** 2 - px * px)); return [0, 0, l1, 0, px, py]; }

// the two stretches of a triangle's map from its pattern (uv) to the cloth: s1 >= s2
function stretch2(P, a, b, c, uv, i, j, k) {
  const du1 = uv[j * 2] - uv[i * 2], dv1 = uv[j * 2 + 1] - uv[i * 2 + 1], du2 = uv[k * 2] - uv[i * 2], dv2 = uv[k * 2 + 1] - uv[i * 2 + 1], det = du1 * dv2 - du2 * dv1; if (Math.abs(det) < 1e-12) return null;
  const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]], e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
  const Ju = e1.map((x, q) => (x * dv2 - e2[q] * dv1) / det), Jv = e1.map((x, q) => (-x * du2 + e2[q] * du1) / det);
  const E = Ju[0] ** 2 + Ju[1] ** 2 + Ju[2] ** 2, F = Ju[0] * Jv[0] + Ju[1] * Jv[1] + Ju[2] * Jv[2], G = Jv[0] ** 2 + Jv[1] ** 2 + Jv[2] ** 2, tr = E + G, dd = Math.sqrt(Math.max(0, (E - G) ** 2 + 4 * F * F));
  return [Math.sqrt((tr + dd) / 2), Math.sqrt(Math.max(0, (tr - dd) / 2))]; }

export function resolve8(ctx) {
  const { gar, W, Pws, O, log = () => {} } = ctx, S = { ...RESOLVE8, ...(O.resolve || {}) }, out = {};
  const bodySurf = ctx.bodyFullSurf || ctx.bodySurf; if (!bodySurf) return null;
  for (const g of gar) {
    if (!g.uv || (S.owners && !S.owners.includes(g.owner))) continue; const t0 = Date.now(), Wg = W.get(g), Pw = Pws.get(g), m = Wg.m, wid = Wg.wid;
    // the drawn triangles (welded ids) with their corners' pattern coordinates (the report's ruler: each one's range widened to what the
    // SOLVER left it, the source bake's own stretches; cloth given back by fill8 / sleeve8 takes the woven range)
    const Ps = ctx.P ? ctx.P(g) : null, T0 = ctx.T0?.get(g) ?? g.T.length, tri = [], met = [], lo = [], hi = [];
    for (let t = 0; t < g.T.length; t += 3) { const i = g.T[t], j = g.T[t + 1], k = g.T[t + 2], a = wid[i], b = wid[j], c = wid[k]; if (a === b || b === c || a === c) continue;
      const du1 = g.uv[j * 2] - g.uv[i * 2], dv1 = g.uv[j * 2 + 1] - g.uv[i * 2 + 1], du2 = g.uv[k * 2] - g.uv[i * 2], dv2 = g.uv[k * 2 + 1] - g.uv[i * 2 + 1]; if (Math.abs(du1 * dv2 - du2 * dv1) < 1e-12) continue;
      let l = S.smin, h = S.smax; if (Ps && t < T0) { const s0 = stretch2(Ps, i, j, k, g.uv, i, j, k); if (s0) { l = Math.min(l, s0[1]); h = Math.max(h, s0[0]); } }
      tri.push(a, b, c, i, j, k); met.push(g.uv[i * 2], g.uv[i * 2 + 1], g.uv[j * 2], g.uv[j * 2 + 1], g.uv[k * 2], g.uv[k * 2 + 1]); lo.push(l); hi.push(h); }
    const nt = tri.length / 6; if (!nt) continue;
    const outOf = X => { const f = new Uint8Array(nt); let n = 0, sq = 0; for (let t = 0; t < nt; t++) { const s = stretch2(X, tri[t * 6], tri[t * 6 + 1], tri[t * 6 + 2], g.uv, tri[t * 6 + 3], tri[t * 6 + 4], tri[t * 6 + 5]); if (!s) continue;
      if (s[1] < S.squash) sq++; if (s[1] < lo[t] - 1e-3 || s[0] > hi[t] + 1e-3) { f[t] = 1; n++; } } return { f, n, sq }; };
    // THE SUPPORTS (held): the earlier stages' laid cloth (rib8's laid sleeve only when !freeRib), the bands and CLOTH7's turned layers
    const A = adjacency(Wg.T, m), held = new Uint8Array(m), p2 = ctx.pin?.get(g), ribbed = ctx.rib8Laid?.get(g);
    if (p2) for (let w = 0; w < m; w++) if (p2[w] && !(S.freeRib && ribbed && ribbed[w])) held[w] = 1;
    for (let w = 0; w < m; w++) { const x = Pw[w * 3], y = Pw[w * 3 + 1], z = Pw[w * 3 + 2]; if ((ctx.nearBand && ctx.nearBand(x, y, z)) || (ctx.nearFold && ctx.nearFold(x, y, z))) held[w] = 1; }
    // the finished free edges (hems, cuffs, the sleeve's edge in its rib cuff, necklines: where what is sewn on the cloth hangs) and
    // `edgeRings` rings
    if (S.edgeRings >= 0) { let f = []; const seen = new Uint8Array(m); for (let w = 0; w < m; w++) if (A.bnd[w]) { seen[w] = 1; f.push(w); }
      for (let k = 0; k < S.edgeRings; k++) { const nx = []; for (const v of f) for (const u of A.nb[v]) if (!seen[u]) { seen[u] = 1; nx.push(u); } f = nx; } for (let w = 0; w < m; w++) if (seen[w]) held[w] = 1; }
    const r0 = outOf(Pw), rep = { tris: nt, out0: r0.n, squashed0: r0.sq };
    // THE REGION: the whole garment; every vertex not held is free
    const free = new Uint8Array(m); let nFree = 0; for (let v = 0; v < m; v++) if (!held[v]) { free[v] = 1; nFree++; }
    if (!nFree) { out[g.name] = { ...rep, out1: r0.n, squashed1: r0.sq, moved: 0 }; continue; }
    // the solver's particles: the garment's own cloth (held: hard pins where the stages left them) and the OBSTACLES: every other garment's
    // cloth within `reach` of the free cloth (pinned; CLOTH6's Self6 keeps the free cloth on its side of them)
    const fr = []; for (let v = 0; v < m; v++) if (free[v]) fr.push(Pw[v * 3], Pw[v * 3 + 1], Pw[v * 3 + 2]); const near = nearPts(fr, S.reach);
    const loc = new Int32Array(m).fill(-1), map = [], Ts = [], Ms = [], TH = [], nearT = (X, a, b, c) => near(X[a * 3], X[a * 3 + 1], X[a * 3 + 2]) || near(X[b * 3], X[b * 3 + 1], X[b * 3 + 2]) || near(X[c * 3], X[c * 3 + 1], X[c * 3 + 2]);
    for (let t = 0; t < nt; t++) { const a = tri[t * 6], b = tri[t * 6 + 1], c = tri[t * 6 + 2];
      for (const v of [a, b, c]) if (loc[v] < 0) { loc[v] = map.length; map.push(v); } Ts.push(loc[a], loc[b], loc[c]); for (let q = 0; q < 6; q++) Ms.push(met[t * 6 + q]); }
    const nOwn = map.length, Xo = [];
    let fab; try { fab = phys(g.fabric); } catch (e) { fab = phys(S.fallback); }
    for (let i = 0; i < nOwn; i++) TH.push(Math.max(S.th, fab.h / 2));
    for (const u of gar) { if (u === g) continue; const Xu = Pws.get(u), Tu = W.get(u).T, lu = new Map(); let hu; try { hu = phys(u.fabric).h; } catch (e) { hu = fab.h; }
      for (let t = 0; t < Tu.length; t += 3) { const a = Tu[t], b = Tu[t + 1], c = Tu[t + 2]; if (!nearT(Xu, a, b, c)) continue; const ids = [a, b, c].map(v => { let k = lu.get(v); if (k == null) { k = nOwn + Xo.length / 3; lu.set(v, k); Xo.push(Xu[v * 3], Xu[v * 3 + 1], Xu[v * 3 + 2]); TH.push(Math.max(S.th, hu / 2)); } return k; });
        Ts.push(...ids); Ms.push(...flat2(Xu, a, b, c)); } }
    const ns = nOwn + Xo.length / 3, X0 = new Float64Array(ns * 3), pin = new Uint8Array(ns); let nHeld = 0;
    for (let i = 0; i < nOwn; i++) { const v = map[i]; for (let c = 0; c < 3; c++) X0[i * 3 + c] = Pw[v * 3 + c]; if (!free[v]) { pin[i] = 1; nHeld++; } }
    X0.set(Xo, nOwn * 3); for (let i = nOwn; i < ns; i++) pin[i] = 1;
    const cl = new Cloth(X0, Int32Array.from(Ts), fab, { X0, pin, metric: Float64Array.from(Ms), foldMax: S.foldMax, tether: S.tether, restAngle: S.restAngle, bendScale: S.bendScale, compress: S.compress, slack: S.slack, damping: S.damping, vmax: S.vmax });
    cl.c6 = new Self6(cl, { th: Float64Array.from(TH), every: S.selfEvery, maxPush: S.maxPush6, mu: S.mu, margin: S.margin6, tangleEvery: S.tangleEvery, tangleMove: S.tangleMove }); cl.c6.updateTangled(cl.X);
    // the cloth already crossing (CLOTH6's tangled set: a crossing and its ring) takes no side in the self-collision: moved, it carries its
    // crossing into the cloth round it; it is held where the stages (relax8) left it
    let tangledHeld = 0; if (S.holdTangled) for (let i = 0; i < nOwn; i++) if (!pin[i] && cl.c6.tangled[i]) { pin[i] = 1; cl.W[i] = 0; free[map[i]] = 0; tangledHeld++; }
    // the body's FLOOR, ramped: a particle starts held as deep as the stages left it (where that is under the fabric's half thickness +
    // gap) and is drawn out to that clearance over `floorRamp` of the run (at once, cloth inside the full skin went through the cloth over it)
    const gTarget = S.gap + fab.h / 2, gapB = new Float64Array(ns).fill(gTarget), gap0 = new Float64Array(ns).fill(gTarget), dB = new Float64Array(nOwn).fill(NaN); let under = 0;
    for (let i = 0; i < nOwn; i++) { const q = bodySurf.closestAny(X0[i * 3], X0[i * 3 + 1], X0[i * 3 + 2], 0.04); if (q && !q.edge) { dB[i] = q.d; if (!pin[i] && q.d < gTarget) { gap0[i] = gapB[i] = q.d - 0.0002; under++; } } }
    const mask = Uint8Array.from(pin, p => (p ? 0 : 1)), contacts = new Contacts(ns, [{ mesh: bodySurf, gap: gapB, mu: S.mu, reach: 0.04, mask }], { reach: 0.04, safe: true });
    // the crossings before: the garment's own (by triangle) and with every other garment (the guard's reference)
    const ident = Int32Array.from({ length: m }, (_, i) => i), selfHits = X => selfIntersections(X, Wg.T, { wid: ident }).hit;
    const others = gar.filter(u => u !== g), crossOthers = X => { const hit = new Uint8Array(Wg.T.length / 3); for (const u of others) { const Xu = Pws.get(u), Tu = W.get(u).T, X2 = new Float64Array(X.length + Xu.length); X2.set(X); X2.set(Xu, X.length);
        const T2 = new Int32Array(Wg.T.length + Tu.length); T2.set(Wg.T); for (let i = 0; i < Tu.length; i++) T2[Wg.T.length + i] = Tu[i] + m; const L = []; selfIntersections(X2, T2, { list: L, wid: Int32Array.from({ length: m + Xu.length / 3 }, (_, i) => i) });
        const ntg = Wg.T.length / 3; for (let i = 0; i < L.length; i += 2) { const a = L[i] < ntg, b = L[i + 1] < ntg; if (a !== b) hit[a ? L[i] : L[i + 1]] = 1; } } return hit; };
    const P0 = Float64Array.from(Pw), H0 = selfHits(Pw), G0 = crossOthers(Pw), count = h => { let c = 0; for (const x of h) c += x; return c; };
    // THE RAMP: every edge starts at the length the stages left it and is drawn to its pattern length over `ramp` of the run (XPBD on cloth
    // squeezed to 0.3 of its width jumps centimetres in one substep and passes through everything; given back slowly it buckles, and the
    // self-collision's continuous check holds at that pace); the floor over `floorRamp`; then the cloth hangs and settles at the pattern's lengths
    const L1 = Float64Array.from(cl.sL), Lc = Float64Array.from(cl.sL, (_, c) => { const a = cl.sA[c], b = cl.sB[c]; return Math.hypot(X0[b * 3] - X0[a * 3], X0[b * 3 + 1] - X0[a * 3 + 1], X0[b * 3 + 2] - X0[a * 3 + 2]); });
    const N = Math.max(1, Math.round(S.T * S.hz)), NR = Math.max(1, Math.round(N * S.ramp)), NF = Math.max(1, Math.round(N * S.floorRamp)), sm = f => f * f * (3 - 2 * f);
    const ramp = step => { const e = sm(Math.min(1, (step + 1) / NR)); for (let c = 0; c < L1.length; c++) cl.sL[c] = Lc[c] + (L1[c] - Lc[c]) * e;
      if (step < NF) { const ef = sm(Math.min(1, (step + 1) / NF)); for (let i = 0; i < nOwn; i++) if (gap0[i] < gTarget) gapB[i] = gap0[i] + (gTarget - gap0[i]) * ef; } };
    ramp(-1); cl.run(S.T, { hz: S.hz, contacts: S.body === false ? null : contacts, every: S.every, onStep: ramp });
    for (let i = 0; i < nOwn; i++) if (gap0[i] < gTarget) gapB[i] = gTarget;
    const take = () => { let nan = 0; for (let i = 0; i < nOwn; i++) { const v = map[i]; if (!free[v]) continue; const x = cl.X[i * 3], y = cl.X[i * 3 + 1], z = cl.X[i * 3 + 2];
      if (!Number.isFinite(x + y + z)) { nan++; continue; } Pw[v * 3] = x; Pw[v * 3 + 1] = y; Pw[v * 3 + 2] = z; } return nan; };
    let nan = take();
    // THE GUARD, inside the solve: cloth that newly crosses its own garment or another, or went past maxMove (a blow-up), and its ring,
    // pinned back where it was; the free cloth round it settles onto it for settleT (no step left beside a moved neighbour); a few rounds
    let reverted = 0, blown = 0, rounds = 0; for (let round = 0; round < S.revertRounds; round++) { const H1 = selfHits(Pw), G1 = crossOthers(Pw), back = new Uint8Array(m); let k = 0;
      const mark = v => { if (free[v] && !back[v]) { back[v] = 1; k++; } };
      for (let t = 0; t < H1.length; t++) if ((H1[t] && !H0[t]) || (G1[t] && !G0[t])) for (let q = 0; q < 3; q++) { const v = Wg.T[t * 3 + q]; mark(v); for (const u of A.nb[v]) mark(u); }
      for (let v = 0; v < m; v++) if (free[v] && !back[v]) { const d = Math.hypot(Pw[v * 3] - P0[v * 3], Pw[v * 3 + 1] - P0[v * 3 + 1], Pw[v * 3 + 2] - P0[v * 3 + 2]); if (!(d <= S.maxMove)) { mark(v); for (const u of A.nb[v]) mark(u); blown++; } }
      if (!k) break; rounds++;
      for (let v = 0; v < m; v++) if (back[v]) { Pw[v * 3] = P0[v * 3]; Pw[v * 3 + 1] = P0[v * 3 + 1]; Pw[v * 3 + 2] = P0[v * 3 + 2]; free[v] = 0; const i = loc[v]; if (i >= 0) { cl.W[i] = 0; mask[i] = 0; for (let c = 0; c < 3; c++) { cl.X[i * 3 + c] = P0[v * 3 + c]; cl.V[i * 3 + c] = 0; } } }
      reverted += k; if (S.settleT > 0) { cl.run(S.settleT, { hz: S.hz, contacts: S.body === false ? null : contacts, every: S.every }); nan += take(); } }
    let moved = 0, mx = 0; for (let v = 0; v < m; v++) { const d = Math.hypot(Pw[v * 3] - P0[v * 3], Pw[v * 3 + 1] - P0[v * 3 + 1], Pw[v * 3 + 2] - P0[v * 3 + 2]); if (d > 1e-6) { moved++; mx = Math.max(mx, d); } }
    // what the hang did (descriptive): the free cloth's distance off the skin (p50 / p90 mm, where the skin is within 4 cm) and its mean drop
    const offOf = X => { const d = []; for (let i = 0; i < nOwn; i++) { const v = map[i]; if (!free[v]) continue; const q = bodySurf.closestAny(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], 0.04); if (q && !q.edge) d.push(q.d); } d.sort((a, b) => a - b);
      const p = f => d.length ? +(d[Math.min(d.length - 1, Math.floor(f * d.length))] * 1000).toFixed(1) : null; return [p(0.5), p(0.9)]; };
    let dy = 0, nf = 0; for (let v = 0; v < m; v++) if (free[v]) { dy += Pw[v * 3 + 1] - P0[v * 3 + 1]; nf++; }
    const r1 = outOf(Pw);
    if (S.debug) { const H1 = selfHits(Pw), tg = cl.c6.tangled; let nNew = 0, nTg = 0, nFr = 0, inside = 0; for (let t = 0; t < H1.length; t++) if (H1[t] && !H0[t]) { nNew++; let a = 0, f = 0; for (let q = 0; q < 3; q++) { const v = Wg.T[t * 3 + q], i = loc[v]; if (i >= 0 && tg[i]) a = 1; if (free[v]) f = 1; } nTg += a; nFr += f; }
      for (let i = 0; i < nOwn; i++) { if (pin[i]) continue; const v = map[i], q = bodySurf.closestAny(Pw[v * 3], Pw[v * 3 + 1], Pw[v * 3 + 2], 0.04); if (q && !q.edge && q.d < 0) inside++; }
      log('resolve8 debug', g.name, JSON.stringify({ nNew, nTg, nFr, tangled: tg.reduce((a, x) => a + x, 0), inside, c6: cl.c6.stats })); }
    out[g.name] = { ...rep, out1: r1.n, squashed1: r1.sq, region: ns, free: nFree, held: nHeld, moved, maxMm: +(mx * 1000).toFixed(1), meanDyMm: nf ? +(dy / nf * 1000).toFixed(1) : 0,
      off0: offOf(P0), off1: offOf(Pw), cross0: count(H0), cross1: count(selfHits(Pw)), xg0: count(G0), xg1: count(crossOthers(Pw)), reverted, blown, rounds, nan, under, tangledHeld, ms: Date.now() - t0 };
    log('resolve8', g.name, JSON.stringify(out[g.name]));
  }
  return out;
}
