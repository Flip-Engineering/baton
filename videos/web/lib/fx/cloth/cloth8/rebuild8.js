// CLOTH8 (round 7): a baked person's cloth finished on its stance (the post-pass after CLOTH7's construction; plain data in place):
//   tuck8   the shirt's / tee's tail INTO the waistband: the cloth under and just above the band eased inside the band's inner face, the
//           hidden tail cut clean at a line inside the band (tuck8.js)
//   cuff8   the shirt CUFF as two layers of cloth: the cuff panel's own cloth laid on a stiff interfaced tube round the wrist, the sleeve
//           sewn to its top edge, the facing the same cloth turned in at the cuff's edge up to the join (cuff8.js)
//   relax8  the garment cloth that still crosses itself (elbows, armpits, the waist, knees) relaxed where it crosses (relax8.js)
//   band8   neckbands and collar falls as folded cloth from the garment's own edge (band8.js)
// What is sewn on a garment (pockets, plackets, buttons, the turned hems, the fall) follows its cloth (carry8.js); the bands the cloth is
// eased into (waistband ring, cuff joins, rib cuffs, hem bands) are the reference and stay; garment cloth within `pinNear` of them is held.
//   rebuild8(parts, { M, scale, body, opt, log }) -> report   (parts: unpacked bake parts, bind metres, edited in place)
import { skinPose, blendInverse, SurfaceMesh } from '../collide.js';
import { weldGarment } from '../cloth7/fold7.js';
import { relax8, adjacency } from './relax8.js';
import { bind8, place8 } from './carry8.js';
import { selfIntersections } from '../cloth5/measure5.js';
export const REBUILD8_VERSION = 1;
export const BANDS8 = /^(waistband|beltloops|button\.waist|cuff\.join\.[LR]|sweat\.cuff\.[LR]|sweat\.hemband)$/;
export const OPT8 = { relax: {}, pinNear: 0.008, pinEdgeRings: 0, pinFold: 0.006, guard: 3, garments: null, stages: ['tuck', 'cuff', 'sleeve', 'rib', 'side', 'relax', 'resolve', 'band', 'collar', 'weights'] };   // ('resolve': c8 it1, 15 Oct, ON: the squeezed cloth solved back to its pattern lengths; the review gate is abolished, its read on 1009-001511 (lumps at L03's elbow, L23's bust) is the bug list)   // ('collar': c4, collar8.js: landed 15 Oct on GPU 1008-220602)   // ('side': 8 Oct it2, side8.js: the sleeve and the garment's own side in order between arm and torso)   // ('rib': 8 Oct, rib8.js; without it band8's rev 2 lays a sweat cuff from its edge as before)   // (under8, layer8, elbow8: tried, worse: NOTES)

export const poseOf = (q, M, scale, X = q.X) => skinPose(Float64Array.from(X, x => x / scale), q.SI, q.SW, M, new Float64Array(X.length), scale);
// posed -> bind through each vertex's own weights, quantised as the bake stores it (0.1 mm); only the vertices flagged
export function toBind(q, Pp, M, scale, only = null) { const tmp = [0, 0, 0]; let k = 0;
  for (let v = 0; v < q.X.length / 3; v++) { if (only && !only[v]) continue; blendInverse(q.SI, q.SW, v, M, Pp[v * 3] / scale, Pp[v * 3 + 1] / scale, Pp[v * 3 + 2] / scale, tmp, 0); for (let c = 0; c < 3; c++) q.X[v * 3 + c] = Math.round(tmp[c] * scale * 1e4) / 1e4; k++; }
  return k; }
// a point set's hash for "near any of these points"
export function nearSet(Xs, r) { const H = new Map(), key = (i, j, k) => ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048); for (const X of Xs) for (let v = 0; v < X.length / 3; v++) { const kk = key(Math.floor(X[v * 3] / r), Math.floor(X[v * 3 + 1] / r), Math.floor(X[v * 3 + 2] / r)); (H.get(kk) || H.set(kk, []).get(kk)).push(X[v * 3], X[v * 3 + 1], X[v * 3 + 2]); }
  return (x, y, z) => { const ci = Math.floor(x / r), cj = Math.floor(y / r), ck = Math.floor(z / r); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const L = H.get(key(ci + a, cj + b, ck + c)); if (!L) continue; for (let i = 0; i < L.length; i += 3) if ((L[i] - x) ** 2 + (L[i + 1] - y) ** 2 + (L[i + 2] - z) ** 2 < r * r) return true; } return false; }; }

export async function rebuild8(parts, { M, scale, body, J = null, opt = {}, log = () => {} } = {}) {
  const O = { ...OPT8, ...opt }, t0 = Date.now(), rep = { version: REBUILD8_VERSION, stages: O.stages, garments: {}, carried: {} };
  const gar = parts.filter(q => q.group === 'garment' && (!O.garments || O.garments.includes(q.name))), posed = new Map(), P = q => { if (!posed.has(q)) posed.set(q, poseOf(q, M, scale)); return posed.get(q); };
  // (no boundary flags: the page's body has its skin under the garments culled, and every point near a cull's rim read as an open edge)
  const bodySurf = body ? new SurfaceMesh(body.X, Int32Array.from(body.T), { cell: 0.02, boundary: false }) : null;
  const bands = parts.filter(q => q.group === 'construction' && BANDS8.test(q.name)), nearBand = nearSet(bands.map(P), O.pinNear);
  // CLOTH7's turned layers (hems, cuff edges, facings) ride on their garment's cloth: that cloth is held (moved, a layer crosses it)
  const FOLD8 = /^(hem|tee\.hem|tee\.hem\.sleeve|skirt\.hem|jacket\.hem\.(sleeve|back)|cuff\.edge\.[LR]|placket\.open|outer\.placket\.open)$/;
  const nearFold = O.pinFold > 0 ? nearSet(parts.filter(q => q.group === 'construction' && FOLD8.test(q.name)).map(P), O.pinFold) : null;
  // what is sewn on each garment, bound to its cloth before any edit
  const binds = []; for (const q of parts) { if (q.group !== 'construction' || BANDS8.test(q.name)) continue; const g = gar.find(x => x.owner === q.owner || x.name === q.owner); if (!g) continue; binds.push({ q, g, B: bind8(P(q), P(g), g.T) }); }
  // the posed body WITH the skin the page culls under the clothes (body.Tfull, when the caller has it): resolve8's collider (the stages
  // before it keep the page's body, as v8c was built)
  const bodyFullSurf = body?.Tfull && O.stages.includes('resolve') ? new SurfaceMesh(body.X, Int32Array.from(body.Tfull), { cell: 0.02, boundary: false }) : null;
  const ctx = { parts, M, scale, body, bodySurf, bodyFullSurf, J, P, posed, log, O, rep, binds, nearBand, nearFold, T0: new Map(gar.map(g => [g, g.T.length])) };
  const stage = async (k, f) => { if (!O.stages.includes(k)) return; const t = Date.now(); try { const r = await f(); if (r) rep[k] = r; } catch (e) { rep[k] = { error: String(e.stack || e).slice(0, 400) }; log('cloth8', k, 'FAILED', e.stack || e); } (rep.ms ||= {})[k] = Date.now() - t; };
  // per garment: welded, edited posed, back to bind
  const W = new Map(), Pws = new Map(); for (const g of gar) { const Wg = weldGarment(g), Pp = P(g), Pw = new Float64Array(Wg.m * 3); for (let w = 0; w < Wg.m; w++) for (let c = 0; c < 3; c++) Pw[w * 3 + c] = Pp[Wg.rep[w] * 3 + c]; W.set(g, Wg); Pws.set(g, Pw); }
  ctx.W = W; ctx.Pws = Pws; ctx.gar = gar; ctx.toBind = toBind; ctx.poseOf = poseOf;
  await stage('tuck', async () => (await import('./tuck8.js')).tuck8(ctx));
  await stage('cuff', async () => (await import('./cuff8.js')).cuff8(ctx));
  await stage('sleeve', async () => (await import('./sleeve8.js')).sleeve8(ctx));   // (8 Oct: the sleeve as a height field over the arm: no S-fold, no slot)
  await stage('rib', async () => (await import('./rib8.js')).rib8(ctx));   // (8 Oct: the sweatshirt's pushed-up sleeve gathered into its rib cuff on the forearm)
  await stage('side', async () => (await import('./side8.js')).side8(ctx));   // (8 Oct it2: the sleeve's inner wall out of the garment's own side panel)
  const preRelax = new Map(gar.map(g => [g, Float64Array.from(Pws.get(g))]));
  await stage('relax', async () => { const out = {}; for (const g of gar) { const Wg = W.get(g), Pw = Pws.get(g), pin = new Uint8Array(Wg.m); for (let w = 0; w < Wg.m; w++) if (nearBand(Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2])) pin[w] = 1;
    if (ctx.pin?.get(g)) { const p2 = ctx.pin.get(g); for (let w = 0; w < Wg.m; w++) if (p2[w]) pin[w] = 1; }
    // the cloth within a few rings of a free edge is held (the turned hems and facings CLOTH7 laid in it ride on it: moved, they cross)
    if (O.pinEdgeRings > 0) { const A0 = adjacency(Wg.T, Wg.m), seen = new Uint8Array(Wg.m); let f = []; for (let w = 0; w < Wg.m; w++) if (A0.bnd[w]) { seen[w] = 1; f.push(w); }
      for (let k = 0; k < O.pinEdgeRings; k++) { const nx = []; for (const v of f) for (const u of A0.nb[v]) if (!seen[u]) { seen[u] = 1; nx.push(u); } f = nx; } for (let w = 0; w < Wg.m; w++) if (seen[w]) pin[w] = 1; }
    const r = relax8(Pw, Wg.T, { body: bodySurf, pin, adj: adjacency(Wg.T, Wg.m), ...O.relax }); out[g.name] = r; log('relax8', g.name, JSON.stringify(r)); } return out; });
  // (c3 it2; IN the default stages since 15 Oct c8 it1) the squeezed cloth SOLVED back to its pattern's lengths with the cloth's own
  // solver, the body (its culled skin too), the layers under it and itself as colliders: what the stages pushed together folds (resolve8.js)
  await stage('resolve', async () => (await import('./resolve8.js')).resolve8(ctx));
  // the edited garments back to bind (only the vertices that moved), then posed again as the bake draws them; what is sewn on them follows
  const GX00 = new Map(gar.map(g => [g, Float64Array.from(g.X)])), X00 = new Map(binds.map(b => [b.q, Float64Array.from(b.q.X)])), P00 = new Map(gar.map(g => [g, Float64Array.from(P(g))])), Pq00 = new Map(binds.map(b => [b.q, Float64Array.from(P(b.q))])), movedG = new Map();
  const commit = () => { for (const g of gar) { const Wg = W.get(g), Pw = Pws.get(g), P0 = P00.get(g), n = g.X.length / 3, mv = new Uint8Array(n), Pn = Float64Array.from(P0); let k = 0;
      for (let i = 0; i < n; i++) { const w = Wg.wid[i]; if (Math.abs(Pw[w * 3] - P0[i * 3]) + Math.abs(Pw[w * 3 + 1] - P0[i * 3 + 1]) + Math.abs(Pw[w * 3 + 2] - P0[i * 3 + 2]) > 2e-6) { mv[i] = 1; k++; for (let c = 0; c < 3; c++) Pn[i * 3 + c] = Pw[w * 3 + c]; } }
      if (!k && !movedG.has(g)) continue; g.X = Float64Array.from(GX00.get(g)); toBind(g, Pn, M, scale, mv); posed.set(g, poseOf(g, M, scale)); movedG.set(g, mv); rep.garments[g.name] = { moved: k }; }
    rep.carried = {}; for (const { q, g, B } of binds) { const mv = movedG.get(g); if (!mv) continue; const Xq = Float64Array.from(Pq00.get(q)), old = Pq00.get(q), k = place8(B, P(g), g.T, Xq, mv);
      const only = new Uint8Array(Xq.length / 3); let c2 = 0; for (let v = 0; v < only.length; v++) if (Math.abs(Xq[v * 3] - old[v * 3]) + Math.abs(Xq[v * 3 + 1] - old[v * 3 + 1]) + Math.abs(Xq[v * 3 + 2] - old[v * 3 + 2]) > 2e-6) { only[v] = 1; c2++; }
      // a part placed back exactly where it was: its bind as it was (no re-quantising)
      if (!c2) { q.X = Float64Array.from(X00.get(q)); posed.set(q, old); } else { toBind(q, Xq, M, scale, null); posed.set(q, poseOf(q, M, scale)); } if (k) rep.carried[q.name] = (rep.carried[q.name] || 0) + k; } };
  commit();
  // GUARD: relax8 must not push garment cloth through what is sewn on it (a turned sleeve hem, a pocket): garment triangles crossing a
  // construction part, where relax8 moved their corners, go back (with their 1-ring) to where they were before it; a few rounds
  if (O.guard > 0 && O.stages.includes('relax')) { const g0 = { reverted: 0, rounds: 0 };
    for (let round = 0; round < O.guard; round++) { let any = 0; const extra = new Map();
      for (const g of gar) { const Wg = W.get(g), Pw = Pws.get(g), pre = preRelax.get(g), Xg = P(g), Tg = g.T, nG = Xg.length / 3, ntG = Tg.length / 3, rv = new Set();
        for (const q of parts) { if (q.group !== 'construction') continue; const Xq = P(q), Tq = q.T; if (!Tq.length) continue;
          const X = new Float64Array(Xg.length + Xq.length); X.set(Xg); X.set(Xq, Xg.length); const T = new Int32Array(Tg.length + Tq.length); T.set(Tg); for (let i = 0; i < Tq.length; i++) T[Tg.length + i] = Tq[i] + nG;
          const L = []; selfIntersections(X, T, { list: L }); for (let i = 0; i < L.length; i += 2) { const a = L[i] < ntG, b = L[i + 1] < ntG; if (a === b) continue; const t = a ? L[i] : L[i + 1], tq = (a ? L[i + 1] : L[i]) - ntG; for (let k = 0; k < 3; k++) { const w = Wg.wid[Tg[t * 3 + k]]; if (Math.abs(Pw[w * 3] - pre[w * 3]) + Math.abs(Pw[w * 3 + 1] - pre[w * 3 + 1]) + Math.abs(Pw[w * 3 + 2] - pre[w * 3 + 2]) > 2e-6) rv.add(w); }
            // and the cloth the crossing part is sewn on, where relax8 moved it (the part rode it into the other cloth)
            const bd = binds.find(x => x.q === q); if (bd) { const Wo = W.get(bd.g), Po = Pws.get(bd.g), preO = preRelax.get(bd.g); for (let k = 0; k < 3; k++) { const vq = Tq[tq * 3 + k], tb = bd.B.tri[vq]; if (tb < 0) continue; for (let c = 0; c < 3; c++) { const w = Wo.wid[bd.g.T[tb * 3 + c]]; if (Math.abs(Po[w * 3] - preO[w * 3]) + Math.abs(Po[w * 3 + 1] - preO[w * 3 + 1]) + Math.abs(Po[w * 3 + 2] - preO[w * 3 + 2]) > 2e-6) (extra.get(bd.g) || extra.set(bd.g, new Set()).get(bd.g)).add(w); } } } } }
        if (rv.size) (extra.get(g) || extra.set(g, new Set()).get(g)); for (const w of rv) extra.get(g).add(w); }
      for (const [g, rv] of extra) { if (!rv.size) continue; const Wg = W.get(g), Pw = Pws.get(g), pre = preRelax.get(g), A0 = adjacency(Wg.T, Wg.m), ring = new Set(rv); for (const w of rv) for (const u of A0.nb[w]) ring.add(u);
        for (const w of ring) for (let c = 0; c < 3; c++) Pw[w * 3 + c] = pre[w * 3 + c]; any += ring.size; }
      if (!any) break; g0.reverted += any; g0.rounds++; commit(); }
    rep.guard = g0; log('guard8', JSON.stringify(g0)); }
  await stage('cuff', async () => { const r = (await import('./cuff8.js')).cuff8Facing(ctx); if (r) rep.cuffFacing = r; return rep.cuff; });
  await stage('band', async () => (await import('./band8.js')).band8(ctx));
  // (c4 it1; IN the default stages since 15 Oct: GPU 1008-220602 read better than latest on L03 and L20) the collar from its own pattern, sewn on the stand's top and laid by the
  // cloth's solver (collar8.js): the fall's position from its lengths, not a target
  await stage('collar', async () => (await import('./collar8.js')).collar8(ctx));
  // the arm cloth's skin weights smoothed and its bind solved again (the posed cloth unmoved): the skinned normals agree with the surface
  await stage('weights', async () => (await import('./weights8.js')).weights8(ctx, toBind, poseOf));
  rep.ms = { ...(rep.ms || {}), total: Date.now() - t0 }; return rep;
}
