// CLOTH8 c8 it3 (15 Oct): POSE THROUGH THE CLOTH. A dressed pose's garments are the person's finished STANDING garments (v8c: sewn in the
// A-pose, carried to the stance, finished by rebuild8 down to resolve8's drape) carried into the pose BY THE BODY under the cloth's own
// solver, not by the skin weights. Until now the dressed poses (folded arms, clasped hands, a hand on the hip: MOTION c2's motion6/dress7)
// were their own bakes, sewn in the A-pose and carried to the pose by the skin weights in 10 jumps of 0.06 s (stack.js carryRun): at the
// bent elbow linear blend skinning folds the inner sleeve into itself, and 20-30 % of a dressed shirt's free cloth came out ALREADY
// CROSSING ITSELF; rebuild8 and resolve8 can only hold that tangle (it takes no side), so no fold ever formed at the crook (the critic,
// c8 it1 / it2, beside the photographs: 'sleeves are inflated tubes with no hang and no folds at the elbow crook').
// Here the bones go from the standing pose to the dressed one (each bone's local rotation slerped, smoothstep in time, over `Tmove`
// seconds) and at every substep:
//   the BODY    the posed skin WITH the skin the page culls under the clothes, re-skinned and refitted every `every` substeps (a key), is the
//               collider: the arm moving inside a sleeve pushes it, the cloth's friction on the skin drags it
//   the SUPPORTS what holds a garment on the body follows the skin (lerped between keys, moved inside each substep before the
//               self-collision's continuous check, so they never jump past cloth unseen): the bands it is eased into
//               and `pinNear` round them (waistband, cuff joins, rib cuffs, the hem band), CLOTH7's turned layers, its finished free edges
//               and `edgeRings` rings (the buttoned cuff on the wrist, the neckline on the neck, a tucked tail's edge), and the cloth that
//               already crosses itself in the standing bake (it takes no side: Self6's tangled set)
//   the CLOTH   every other particle is free: its PATTERN lengths (ramped from where the standing bake left them over `ramp` of the run),
//               the fabric's own bending on flat panels (restAngle 0), gravity, CLOTH6's Self6 (locked sides and a continuous check: the
//               sleeve's inner wall at the crook cannot pass through its outer wall, so it buckles: the folds at the crook come from the bend)
//   the others  every other garment of the person near the cloth (at the start or the end) is a pinned obstacle carried by its skin
//               (an arm-only pose leaves the trousers where they were)
// then `settle` seconds in the pose. A garment the pose does not move (no point of it carried more than `still` by the skin) is left as it
// was. What is sewn on a garment follows its cloth (carry8: bound at the standing pose, placed on the posed cloth). The same numbers for
// every garment and every person; nothing is fitted to a picture or a person. Pure JS on typed arrays.
//   pose8(parts, { Mof, scale, body: { X (bind, hero units), SI, SW, T (the full skin) }, opt, log }) -> report (parts edited in place:
//   each moved garment's and its sewn parts' bind X re-solved through the END pose's matrices, Mof(1))
//   Mof(e): the bone matrices (collide.js boneMats layout) at pose fraction e in [0, 1] (0 = the standing bake's pose, 1 = the dressed pose)
import { Cloth } from '../xpbd.js';
import { phys } from '../fabrics.js';
import { Contacts, SurfaceMesh, skinPose, rigidSurface } from '../collide.js';
import { adjacency } from './relax8.js';
import { selfIntersections } from '../cloth5/measure5.js';
import { Self6 } from '../cloth6/self6.js';
import { weldGarment } from '../cloth7/fold7.js';
import { bind8, place8 } from './carry8.js';
import { BANDS8, nearSet, poseOf, toBind } from './rebuild8.js';
import { shoeGap, ground } from './shoe8.js';
export const POSE8_VERSION = 3;   // 2 (16 Oct, c9 it1): the boots are obstacles too (a laid trouser hem went through them at the stance: L05 xg 63 -> 233)
// 3 (16 Oct, c9 it3): A HEM THAT HANGS IS NOT A SUPPORT, AND THE SHOES ARE A COLLIDER. A free edge whose loop lies on the lower leg and the
// foot (its skin weights mostly on the bones below the knee: a trouser leg's hem, a long skirt's) hangs: it rests on what is under it (the
// shoe) and is carried by its cloth, not by the shin's skin weights (held there, the shin carried L03's laid hems into the shoe at the stance,
// 120 -> 204 triangles through the shoe; the foot turns under the shin between the A-pose and the stance). The cloth round it (`hangZone`:
// the turned hem and the edge rings) is free with it. The shoes' shells (upper and sole: closed, outward normals) are a rigid collider
// posed with the feet at every key, as lay8 dresses over them (Self6's obstacles alone do not stop free cloth on a moving shoe).
// Needs `bones` (the skeleton's bone names, the skin indices' order); without them no hem is told from a cuff and every free edge is held.
export const POSE8 = { hangZone: 0.06, hangW: 0.5, shoeGap: 0.0025, shoeEdge: 0.5, hangTangled: true, Tmove: 2.0, maxMove: 0.10, settle: 0.6, hz: 600, every: 6, ramp: 0.3, floorRamp: 0.3, still: 0.005, pinNear: 0.008, pinFold: 0.006, edgeRings: 2, holdTangled: true, reach: 0.03,
  gap: 0.0015, mu: 0.3, th: 0.0008, selfEvery: 4, maxPush6: 0.002, margin6: 0.004, compress: 0.2, restAngle: 0, bendScale: 1, foldMax: 2.4, slack: 0.02, damping: 6, vmax: 1.0, fallback: 'heatherJersey' };
const FOLD8 = /^(hem|tee\.hem|tee\.hem\.sleeve|skirt\.hem|jacket\.hem\.(sleeve|back)|cuff\.edge\.[LR]|placket\.open|outer\.placket\.open)$/;
const sm = f => f * f * (3 - 2 * f);
// a pinned obstacle triangle's own flat frame (its current lengths; nothing moves it but its skin)
function flat2(X, a, b, c) { const e1 = [X[b * 3] - X[a * 3], X[b * 3 + 1] - X[a * 3 + 1], X[b * 3 + 2] - X[a * 3 + 2]], e2 = [X[c * 3] - X[a * 3], X[c * 3 + 1] - X[a * 3 + 1], X[c * 3 + 2] - X[a * 3 + 2]], l1 = Math.hypot(...e1) || 1e-6;
  const u = e1.map(x => x / l1), px = e2[0] * u[0] + e2[1] * u[1] + e2[2] * u[2], py = Math.sqrt(Math.max(1e-14, e2[0] ** 2 + e2[1] ** 2 + e2[2] ** 2 - px * px)); return [0, 0, l1, 0, px, py]; }
function nearPts(P, r) { const H = new Map(), key = (i, j, k) => ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048);
  for (let i = 0; i < P.length; i += 3) { const k = key(Math.floor(P[i] / r), Math.floor(P[i + 1] / r), Math.floor(P[i + 2] / r)); (H.get(k) || H.set(k, []).get(k)).push(P[i], P[i + 1], P[i + 2]); }
  return (x, y, z) => { const ci = Math.floor(x / r), cj = Math.floor(y / r), ck = Math.floor(z / r); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const L = H.get(key(ci + a, cj + b, ck + c)); if (!L) continue;
    for (let i = 0; i < L.length; i += 3) if ((L[i] - x) ** 2 + (L[i + 1] - y) ** 2 + (L[i + 2] - z) ** 2 < r * r) return true; } return false; }; }
const welded = (Wg, P) => { const Pw = new Float64Array(Wg.m * 3); for (let w = 0; w < Wg.m; w++) for (let c = 0; c < 3; c++) Pw[w * 3 + c] = P[Wg.rep[w] * 3 + c]; return Pw; };
const count = h => { let c = 0; for (const x of h) c += x; return c; };

export function pose8(parts, { Mof, scale, body, bones = null, opt = {}, log = () => {} } = {}) {
  const S = { ...POSE8, ...opt }, t00 = Date.now(), M0 = Float64Array.from(Mof(0)), M1 = Float64Array.from(Mof(1)), rep = { version: POSE8_VERSION, opt: S, garments: {}, carried: {} };
  const gar = parts.filter(q => q.group === 'garment'), P0 = new Map(parts.map(q => [q, poseOf(q, M0, scale)])), P1 = new Map(parts.map(q => [q, poseOf(q, M1, scale)]));
  const nearBand = nearSet(parts.filter(q => q.group === 'construction' && BANDS8.test(q.name)).map(q => P0.get(q)), S.pinNear);
  const nearFold = S.pinFold > 0 ? nearSet(parts.filter(q => q.group === 'construction' && FOLD8.test(q.name)).map(q => P0.get(q)), S.pinFold) : null;
  // what is sewn on each garment, bound to its cloth at the standing pose
  const binds = []; for (const q of parts) { if (q.group !== 'construction' || BANDS8.test(q.name)) continue; const g = gar.find(x => x.owner === q.owner || x.name === q.owner); if (!g) continue; binds.push({ q, g, B: bind8(P0.get(q), P0.get(g), g.T) }); }
  // the body (bind, hero units) posed at a pose fraction
  // (body.X1: the body's bind in the end pose's person, when its layers shape it by the pose (the shoulder girdle): drawn in with the pose)
  const nb = body.X.length / 3, Xb = new Float64Array(nb * 3), XB = body.X1 ? new Float64Array(nb * 3) : body.X;
  const bodyAt = (M, e = 0) => { if (body.X1) for (let i = 0; i < XB.length; i++) XB[i] = body.X[i] + (body.X1[i] - body.X[i]) * e; return skinPose(XB, body.SI, body.SW, M, Xb, scale); };
  bodyAt(M0, 0); const surf = new SurfaceMesh(Xb, Int32Array.from(body.T), { cell: 0.02, boundary: false });
  // (the obstacles: every other garment AND the boots, carried by their skin: a trouser hem rests on the boot through the pose)
  const obsG = parts.filter(q => q.group === 'garment' || q.group === 'boot'), Wmap = new Map(obsG.map(g => [g, weldGarment(g)]));
  // (v3) the shoes' shells, posed with the feet (refit at every key) and laid back at the start pose for each garment
  const shoes = parts.filter(q => q.group === 'boot' && /upper|sole/.test(q.name)), shoeW = shoes.map(q => Wmap.get(q)); let shoeSurf = null, SX = null;
  const shoeAt = M => { let o = 0; for (let k = 0; k < shoes.length; k++) { const P = poseOf(shoes[k], M, scale), Wq = shoeW[k]; for (let w = 0; w < Wq.m; w++) for (let c = 0; c < 3; c++) SX[o + w * 3 + c] = P[Wq.rep[w] * 3 + c]; o += Wq.m * 3; } return SX; };
  if (shoes.length) { const BT = []; let o = 0; for (const Wq of shoeW) { for (const v of Wq.T) BT.push(v + o); o += Wq.m; } SX = new Float64Array(o * 3); shoeAt(M0); shoeSurf = rigidSurface(SX, Int32Array.from(BT), { cell: 0.03 }); }
  // (v3) the ground under the soles (or under the body's lowest point), as lay8 has it
  let floor; { let y0 = Infinity, cx = 0, cz = 0, c = 0; const F = SX || bodyAt(M0, 0); for (let i = 0; i < F.length; i += 3) { y0 = Math.min(y0, F[i + 1]); cx += F[i]; cz += F[i + 2]; c++; } floor = ground(y0, cx / c, cz / c); rep.groundY = +y0.toFixed(4); }
  // (v3) the bones below the knee: a free edge whose skin weight lies mostly on them is a hem that hangs
  const legLow = bones ? bones.map(nm => /^(lowerleg|foot|toe)/.test(nm)) : null;
  for (const g of gar) {
    const t0 = Date.now(), Wg = Wmap.get(g), m = Wg.m, Pa = P0.get(g), Pb = P1.get(g);
    let carry = 0; for (let i = 0; i < Pa.length; i += 3) carry = Math.max(carry, Math.hypot(Pb[i] - Pa[i], Pb[i + 1] - Pa[i + 1], Pb[i + 2] - Pa[i + 2]));
    if (!g.uv || carry < S.still || (S.only && !S.only.includes(g.name))) { rep.garments[g.name] = { moved: 0, skinMaxMm: +(carry * 1000).toFixed(1) }; continue; }   // (S.only: the garments to carry; the others ride their skin as obstacles)
    const Pw = welded(Wg, Pa), PwB = welded(Wg, Pb), A = adjacency(Wg.T, m), held = new Uint8Array(m);
    // (v3) THE HEMS THAT HANG (see the header): their loops and the cloth within `hangZone` of them are not supports
    const hang = new Uint8Array(m); let hems = 0; if (legLow) { const hv = []; for (const L of Wg.loops) { if (L.ids.length < 8) continue; let wl = 0, wt = 0; for (const w of L.ids) { const v = Wg.rep[w]; for (let k = 0; k < 4; k++) { const ww = g.SW[v * 4 + k]; wt += ww; if (legLow[g.SI[v * 4 + k]]) wl += ww; } }
        if (wl > S.hangW * wt) { hems++; for (const w of L.ids) hv.push(Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]); } }
      if (hv.length) { const nz = nearPts(hv, S.hangZone); for (let w = 0; w < m; w++) if (nz(Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2])) hang[w] = 1; } }
    // THE SUPPORTS: the bands and 8 mm round them, CLOTH7's turned layers, the finished free edges and `edgeRings` rings
    for (let w = 0; w < m; w++) { if (hang[w]) continue; const x = Pw[w * 3], y = Pw[w * 3 + 1], z = Pw[w * 3 + 2]; if (nearBand(x, y, z) || (nearFold && nearFold(x, y, z))) held[w] = 1; }
    if (S.edgeRings >= 0) { let f = []; const seen = new Uint8Array(m); for (let w = 0; w < m; w++) if (A.bnd[w] && !hang[w]) { seen[w] = 1; f.push(w); }
      for (let k = 0; k < S.edgeRings; k++) { const nx = []; for (const v of f) for (const u of A.nb[v]) if (!seen[u] && !hang[u]) { seen[u] = 1; nx.push(u); } f = nx; } for (let w = 0; w < m; w++) if (seen[w]) held[w] = 1; }
    // the drawn triangles (welded ids) and their PATTERN frames (uv, metres)
    const tri = [], met = []; for (let t = 0; t < g.T.length; t += 3) { const i = g.T[t], j = g.T[t + 1], k = g.T[t + 2], a = Wg.wid[i], b = Wg.wid[j], c = Wg.wid[k]; if (a === b || b === c || a === c) continue;
      const du1 = g.uv[j * 2] - g.uv[i * 2], dv1 = g.uv[j * 2 + 1] - g.uv[i * 2 + 1], du2 = g.uv[k * 2] - g.uv[i * 2], dv2 = g.uv[k * 2 + 1] - g.uv[i * 2 + 1]; if (Math.abs(du1 * dv2 - du2 * dv1) < 1e-12) continue;
      tri.push(a, b, c); met.push(g.uv[i * 2], g.uv[i * 2 + 1], g.uv[j * 2], g.uv[j * 2 + 1], g.uv[k * 2], g.uv[k * 2 + 1]); }
    if (!tri.length) continue;
    // a particle in no solved triangle (its pattern frame degenerate) has nothing to hang from: it is a support
    { const used = new Uint8Array(m); for (const v of tri) used[v] = 1; for (let w = 0; w < m; w++) if (!used[w]) held[w] = 1; }
    // the obstacles: every other garment's triangles near the free cloth at the start or at the end (carried by the skin)
    const fr = []; for (let w = 0; w < m; w++) if (!held[w]) fr.push(Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2], PwB[w * 3], PwB[w * 3 + 1], PwB[w * 3 + 2]); const near = nearPts(fr, S.reach);
    let fab; try { fab = phys(g.fabric); } catch (e) { fab = phys(S.fallback); }
    const Ts = Array.from(tri), Ms = Array.from(met), TH = new Array(m).fill(Math.max(S.th, fab.h / 2)), Xo = [], obs = [];   // obs: [garment, its unwelded vertex] per obstacle particle
    for (const u of obsG) { if (u === g) continue; const Wu = Wmap.get(u), Xa = welded(Wu, P0.get(u)), Xe = welded(Wu, P1.get(u)), Tu = Wu.T, lu = new Map(); let hu; try { hu = phys(u.fabric).h; } catch (e) { hu = fab.h; }
      const nr = v => near(Xa[v * 3], Xa[v * 3 + 1], Xa[v * 3 + 2]) || near(Xe[v * 3], Xe[v * 3 + 1], Xe[v * 3 + 2]);
      for (let t = 0; t < Tu.length; t += 3) { const a = Tu[t], b = Tu[t + 1], c = Tu[t + 2]; if (!nr(a) && !nr(b) && !nr(c)) continue;
        const ids = [a, b, c].map(v => { let k = lu.get(v); if (k == null) { k = m + Xo.length / 3; lu.set(v, k); Xo.push(Xa[v * 3], Xa[v * 3 + 1], Xa[v * 3 + 2]); TH.push(Math.max(S.th, hu / 2)); obs.push([u, Wu.rep[v]]); } return k; });
        Ts.push(...ids); Ms.push(...flat2(Xa, a, b, c)); } }
    const ns = m + Xo.length / 3, X0 = new Float64Array(ns * 3), pin = new Uint8Array(ns); X0.set(Pw); X0.set(Xo, m * 3); for (let i = 0; i < m; i++) if (held[i]) pin[i] = 1; for (let i = m; i < ns; i++) pin[i] = 1;
    const cl = new Cloth(X0, Int32Array.from(Ts), fab, { X0, pin, metric: Float64Array.from(Ms), foldMax: S.foldMax, tether: false, restAngle: S.restAngle, bendScale: S.bendScale, compress: S.compress, slack: S.slack, damping: S.damping, vmax: S.vmax });
    cl.c6 = new Self6(cl, { th: Float64Array.from(TH), every: S.selfEvery, maxPush: S.maxPush6, mu: S.mu, margin: S.margin6, tangleEvery: 0, tangleMove: 0 }); cl.c6.updateTangled(cl.X);
    let tangledHeld = 0, tangledHang = 0; if (S.holdTangled) for (let i = 0; i < m; i++) if (!pin[i] && cl.c6.tangled[i]) { if (hang[i] && S.hangTangled) { tangledHang++; continue; } pin[i] = 1; cl.W[i] = 0; tangledHeld++; }
    // every pinned particle (the supports, the held tangle, the obstacles) is carried by its skin: its bind (hero units), weights
    const pins = []; for (let i = 0; i < ns; i++) if (pin[i]) pins.push(i); const np = pins.length, HB = new Float64Array(np * 3), HSI = new Float64Array(np * 4), HSW = new Float64Array(np * 4);
    for (let k = 0; k < np; k++) { const i = pins[k], [q, v] = i < m ? [g, Wg.rep[i]] : obs[i - m]; for (let c = 0; c < 3; c++) HB[k * 3 + c] = q.X[v * 3 + c] / scale; for (let c = 0; c < 4; c++) { HSI[k * 4 + c] = q.SI[v * 4 + c]; HSW[k * 4 + c] = q.SW[v * 4 + c]; } }
    const Hcur = new Float64Array(np * 3), Hnext = new Float64Array(np * 3), pinAt = (M, out) => skinPose(HB, HSI, HSW, M, out, scale);
    // the body's floor, ramped (cloth the standing bake left inside the skin is drawn out over `floorRamp` of the run, not pushed at once)
    const gT = S.gap + fab.h / 2, gapB = new Float64Array(ns).fill(gT), gap0 = new Float64Array(ns).fill(gT); let under = 0;
    for (let i = 0; i < m; i++) { if (pin[i]) continue; const q = surf.closestAny(X0[i * 3], X0[i * 3 + 1], X0[i * 3 + 2], 0.04); if (q && !q.edge && q.d < gT) { gap0[i] = gapB[i] = q.d - 0.0002; under++; } }
    const mask = Uint8Array.from(pin, p => (p ? 0 : 1)), contacts = new Contacts(ns, [{ mesh: surf, gap: gapB, mu: S.mu, reach: 0.04, mask }, ...(shoeSurf ? [{ mesh: shoeSurf, gap: new Float64Array(ns).fill(shoeGap(g, fab.h, { min: S.shoeGap, edge: S.shoeEdge })), mu: S.mu, reach: 0.04, mask }] : []), { mesh: floor, gap: new Float64Array(ns).fill(gT), mu: S.mu, reach: 0.04, mask }], { reach: 0.04, safe: true });
    // the measures before (descriptive): the garment carried by the skin alone (what the old dressed bakes started from) at the end pose
    const ident = Int32Array.from({ length: m }, (_, i) => i), selfHits = X => selfIntersections(X, Wg.T, { wid: ident }).hit;
    const crossOthers = (X, end) => { const hit = new Uint8Array(Wg.T.length / 3); for (const u of obsG) { if (u === g) continue; const Wu = Wmap.get(u), Xu = welded(Wu, (end ? P1 : P0).get(u)), Tu = Wu.T, X2 = new Float64Array(X.length + Xu.length); X2.set(X); X2.set(Xu, X.length);
        const T2 = new Int32Array(Wg.T.length + Tu.length); T2.set(Wg.T); for (let i = 0; i < Tu.length; i++) T2[Wg.T.length + i] = Tu[i] + m; const L = []; selfIntersections(X2, T2, { list: L, wid: Int32Array.from({ length: m + Xu.length / 3 }, (_, i) => i) });
        const ntg = Wg.T.length / 3; for (let i = 0; i < L.length; i += 2) { const a = L[i] < ntg, b = L[i + 1] < ntg; if (a !== b) hit[a ? L[i] : L[i + 1]] = 1; } } return hit; };
    const cross0 = count(selfHits(Pw)), crossSkin = count(selfHits(PwB)), xg0 = count(crossOthers(Pw, false)), xgSkin = count(crossOthers(PwB, true));
    // THE RUN: the pose over Nmove substeps (keys every `every`), then the settle; the rest lengths ramped to the pattern's
    const N = Math.max(1, Math.round((S.Tmove + S.settle) * S.hz)), Nm = Math.max(S.every, Math.round(S.Tmove * S.hz)), NR = Math.max(1, Math.round(N * S.ramp)), NF = Math.max(1, Math.round(N * S.floorRamp));
    const L1 = Float64Array.from(cl.sL), Lc = Float64Array.from(cl.sL, (_, c) => { const a = cl.sA[c], b = cl.sB[c]; return Math.hypot(X0[b * 3] - X0[a * 3], X0[b * 3 + 1] - X0[a * 3 + 1], X0[b * 3 + 2] - X0[a * 3 + 2]); });
    const eAt = s => sm(Math.min(1, s / Nm)); let keys = 0;
    pinAt(M0, Hcur); pinAt(Mof(eAt(S.every)), Hnext);
    // the supports move INSIDE the substep, before Self6's continuous check (its pre-hook; P holds where they were), so free cloth they
    // sweep is seen crossing and held on its side (set after the step, a support jumped past the cloth unseen); the keys after the step
    const pre0 = cl.c6.pre.bind(cl.c6);
    cl.c6.pre = (step, X, P) => { const s = step + 1; if (s <= Nm + S.every) { const r = s % S.every, f = r === 0 ? 1 : r / S.every;
      for (let k = 0; k < np; k++) { const i = pins[k]; for (let c = 0; c < 3; c++) X[i * 3 + c] = Hcur[k * 3 + c] + (Hnext[k * 3 + c] - Hcur[k * 3 + c]) * f; } } return pre0(step, X, P); };
    const onStep = step => { const s = step + 1;
      { const e = sm(Math.min(1, s / NR)); for (let c = 0; c < L1.length; c++) cl.sL[c] = Lc[c] + (L1[c] - Lc[c]) * e; }
      if (s <= NF) { const ef = sm(s / NF); for (let i = 0; i < m; i++) if (gap0[i] < gT) gapB[i] = gap0[i] + (gT - gap0[i]) * ef; }
      if (s > Nm + S.every) return;
      if (s % S.every === 0) {   // a key: the body at this key, the pins' next key
        Hcur.set(Hnext); const Mk = Mof(eAt(s)); bodyAt(Mk, eAt(s)); surf.refit(Xb); if (shoeSurf) shoeSurf.refit(shoeAt(Mk)); keys++; pinAt(Mof(eAt(s + S.every)), Hnext); } };
    cl.run(S.Tmove + S.settle, { hz: S.hz, contacts, every: S.every, onStep });
    // the end pose exactly (the last key is the pose: Mof(1)); the body back at the start pose for the next garment
    pinAt(M1, Hcur); for (let k = 0; k < np; k++) { const i = pins[k]; for (let c = 0; c < 3; c++) cl.X[i * 3 + c] = Hcur[k * 3 + c]; }
    // (a particle that went past `maxMove` from where its skin carries it is a blow-up, not a fold: it takes the skin's place, as a NaN does)
    let nan = 0, blown = 0; const Pf = new Float64Array(m * 3); for (let i = 0; i < m; i++) { const x = cl.X[i * 3], y = cl.X[i * 3 + 1], z = cl.X[i * 3 + 2]; if (!Number.isFinite(x + y + z)) { nan++; for (let c = 0; c < 3; c++) Pf[i * 3 + c] = PwB[i * 3 + c]; continue; }
      if (Math.hypot(x - PwB[i * 3], y - PwB[i * 3 + 1], z - PwB[i * 3 + 2]) > S.maxMove) { blown++; for (let c = 0; c < 3; c++) Pf[i * 3 + c] = PwB[i * 3 + c]; continue; } Pf[i * 3] = x; Pf[i * 3 + 1] = y; Pf[i * 3 + 2] = z; }
    // what it did (descriptive): crossings (own / with the others carried by the skin), the free cloth's distance off the skin at the end
    bodyAt(M1, 1); surf.refit(Xb);
    const offOf = X => { const d = []; let inside = 0; for (let i = 0; i < m; i++) { if (pin[i]) continue; const q = surf.closestAny(X[i * 3], X[i * 3 + 1], X[i * 3 + 2], 0.04); if (q && !q.edge) { d.push(q.d); if (q.d < -0.004) inside++; } } d.sort((a, b) => a - b);
      const p = f => d.length ? +(d[Math.min(d.length - 1, Math.floor(f * d.length))] * 1000).toFixed(1) : null; return { p50: p(0.5), p90: p(0.9), inside4: inside }; };
    let dmax = 0; for (let i = 0; i < m; i++) dmax = Math.max(dmax, Math.hypot(Pf[i * 3] - PwB[i * 3], Pf[i * 3 + 1] - PwB[i * 3 + 1], Pf[i * 3 + 2] - PwB[i * 3 + 2]));
    const r = { moved: m - count(pin.subarray(0, m)), held: count(held), hems, hang: count(hang), tangledHang, tangledHeld, obstacles: ns - m, under, skinMaxMm: +(carry * 1000).toFixed(1), offSkinMaxMm: +(dmax * 1000).toFixed(1),
      cross: { standing: cross0, skin: crossSkin, pose8: count(selfHits(Pf)) }, xg: { standing: xg0, skin: xgSkin, pose8: count(crossOthers(Pf, true)) },
      off: { skin: offOf(PwB), pose8: offOf(Pf) }, keys, nan, blown, c6: cl.c6.stats, ms: Date.now() - t0 };
    bodyAt(M0, 0); surf.refit(Xb); if (shoeSurf) shoeSurf.refit(shoeAt(M0));
    // back to bind through the end pose; what is sewn on it follows
    const Pn = new Float64Array(g.X.length); for (let i = 0; i < g.X.length / 3; i++) { const w = Wg.wid[i]; for (let c = 0; c < 3; c++) Pn[i * 3 + c] = Pf[w * 3 + c]; }
    toBind(g, Pn, M1, scale, null); P1.set(g, poseOf(g, M1, scale));
    for (const { q, g: gg, B } of binds) { if (gg !== g) continue; const Xq = Float64Array.from(P1.get(q)), k = place8(B, P1.get(g), g.T, Xq, null); toBind(q, Xq, M1, scale, null); P1.set(q, poseOf(q, M1, scale)); rep.carried[q.name] = (rep.carried[q.name] || 0) + k; }
    rep.garments[g.name] = r; log('pose8', g.name, JSON.stringify({ ...r, c6: undefined }));
  }
  rep.ms = Date.now() - t00; return rep;
}
