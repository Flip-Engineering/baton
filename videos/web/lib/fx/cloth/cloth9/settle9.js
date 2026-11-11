// CLOTH9 (round 7): THE SLEEVE FALL, by simulation (stage 'sleeve'), a post-pass on a finished bake (CLOTH8's v8c), the same physics as
// break9's trouser leg. The bakes solve each garment round the bind (A-pose) arm and carry it into the stance by skinning: nothing lets
// a sleeve fall under its own weight on the posed person, so a short sleeve stands off the deltoid like a fin and a long one stays a
// tube (AUDIT7 C2; hang9.js reads it: on v7c the hem ring stood 7-27 mm off the TOP of the arm and lay on the arm UNDERNEATH).
// What a real sleeve does on a hanging arm: it is a tube of flat cloth sewn to the armhole at its cap; it hangs from the cap, rests on
// the top of the arm where the arm holds it up, and the length and girth the arm does not fill have nowhere to go but out of the
// cloth's plane: they fall to the underside and buckle into folds at the fabric's own scale (its bending length): a few soft folds
// down a shirt sleeve, a stack above the cuff, diagonal creases in the crook of a bent elbow.
// rev 6 (c3 it5, 8 Oct): the sleeve is SIMULATED, no longer laid. Rev 2-4 (v9d-v9k: in git history) laid each ring of the sleeve round
// its arm by a formula (the ring at its pattern girth, a (1 - cos) ease profile hanging underneath), held that shape with soft
// attachments, let the cloth compress in its plane at 2 % of its stiffness (so nothing could buckle), held a 2 cm strip at the elbow
// between an upper-arm and a forearm zone, and guarded against any new crease sharper than 120 degrees. The critic beside the
// photographs (c3 it4, B = rev 4 on v8c): 'a smooth sausage with a ball at the elbow and a swollen forearm, no creases'; L12's jacket
// 'inflated, a knuckle-like shelf at the elbow' (worse than the bake); the photographs show 'crisp diagonal creases in the elbow crook'.
// The ball was the held strip between two laid zones; the sausage the laid ring; the missing creases the soft compression and the
// crease guard. Now, per garment (the outer one when there is one; else the shirt or top):
//   the cut   refineSleeves9 (the driver, before anything is welded or bound): the sleeve panels cut 1 -> 4 (refine9: ~13.7 -> ~6.9 mm),
//             so a fold the fabric's bending length asks for is drawn by several edges, not buckled at the lattice's scale
//   the zone  each arm's sleeve cloth (sleeve8's panel test) from the armpit row of its pattern (above it the CAP, sewn to the armhole:
//             held as baked) to the cuff: less the cloth near a band (cuff joins, rib cuffs: held), less the cuff at the wrist (`cuffHold`
//             above the wrist joint: CLOTH8's cuff stays), less a pushed-up sleeve's roll; ONE zone from the cap to the cuff (no elbow strip)
//   the sim   lib/fx/cloth/xpbd.js: rest lengths and areas from the sleeve's own PATTERN (its uv, metres: the ease is in the cloth, not in
//             the bake's squeezed shape), the warp along the sleeve, flat panels (restAngle 0), the fabric's rev-7 bending (FABRIC7's
//             literature bending lengths), compression at `compress` of the stretch stiffness (break9's: the cloth buckles rather than
//             shrinks), gravity, Coulomb friction, the body's full skin, the garments under it as layers, the cloth against itself
//   nothing   is laid by hand: no ring, no ease profile, no target, no crease guard; where the cloth ends up is the solver's. The
//             cross-garment construction guard (the driver) still sends back cloth that newly crosses another piece.
//   settle9(ctx)  ctx: { parts, gar, W (garment -> weldGarment), Pws (garment -> welded posed Float64Array, edited in place), bodySurf,
//                        body, J, nearBand (x,y,z -> bool), P (part -> posed), O (options: { sleeve: {...} }), log }  -> report
//   refineSleeves9({ parts, poseOf, J, O })  the sleeve panels of each top cut finer, in place (T / Tfull / uv / panel / weights)
import { Cloth } from '../xpbd.js';
import { phys } from '../fabrics.js';
import { SurfaceMesh, Contacts, vertexNormals } from '../collide.js';
import { armCurve } from '../cloth8/sleeve8.js';
import { selfIntersections } from '../cloth5/measure5.js';
import { refine9 } from './refine9.js';
import { bind8, place8 } from '../cloth8/carry8.js';
export const SETTLE9_VERSION = 7;
export const SETTLE9 = { owners: ['shirt', 'top', 'outer'], sleeveFrac: 0.6, sleeveR: 0.11, fillet: 0.07, minZone: 40, near: 0.04,
  rolled: 0.03, rollGap: 0.04, rowBin: 0.006, rowFrac: 0.95, cuffHold: 0.01, refine: true, tangleR: 0.015,
  T: 3, ramp: 5, rampT: 0.67, cuffSpan: 0.4, hz: 480, every: 6, damping: 2, vmax: 0.8, restAngle: 0, compress: 0.3, slack: 0.01, foldMax: 3.1, physRev: 7,
  gap: 0.0025, layerGap: 0.0015, mu: 0.3, hemTh: 0.0003, tackAlpha: 1e-7, hemQ: 0.95, selfTri: 0.0012, selfEvery: 8, maxMove: 0.10, fallback: 'heatherJersey' };

// the arm's coordinates of each welded vertex (nearest of the two arm curves) and the garment's sleeve panels (sleeve8's test)
export function sleevePanels(g, Wg, Pw, J, O = SETTLE9) {
  const curves = ['L', 'R'].map(sd => armCurve(J['shoulder' + sd], J['elbow' + sd], J['wrist' + sd], O.fillet)), m = Wg.m;
  const side = new Int8Array(m).fill(-1), t0 = new Float64Array(m), r0 = new Float64Array(m);
  for (let v = 0; v < m; v++) { const p = [Pw[v * 3], Pw[v * 3 + 1], Pw[v * 3 + 2]]; let bd = Infinity; for (let si = 0; si < 2; si++) { const q = curves[si].near(p); if (q.dist < bd) { bd = q.dist; side[v] = si; t0[v] = q.s; r0[v] = q.dist; } } }
  const np = g.panel ? Math.max(...g.panel) + 1 : 0, cnt = new Float64Array(np), close = new Float64Array(np);
  for (let i = 0; i < g.X.length / 3; i++) { const w = Wg.wid[i], pn = g.panel[i]; cnt[pn]++; if (r0[w] < O.sleeveR) close[pn]++; }
  const isSl = new Uint8Array(np); for (let k = 0; k < np; k++) isSl[k] = cnt[k] > 20 && close[k] / cnt[k] >= O.sleeveFrac ? 1 : 0;
  const onSleeve = new Uint8Array(m); for (let v = 0; v < m; v++) onSleeve[v] = Wg.dups[v].every(i => isSl[g.panel[i]]) ? 1 : 0;
  return { curves, side, t0, r0, isSl, onSleeve };
}
// the drawn triangles of the sleeves (all three corners on sleeve panels): the ruler's cloth
export function sleeveTris(Wg, SP) { const out = []; for (let t = 0; t < Wg.T.length; t += 3) if (SP.onSleeve[Wg.T[t]] && SP.onSleeve[Wg.T[t + 1]] && SP.onSleeve[Wg.T[t + 2]]) out.push(Wg.T[t], Wg.T[t + 1], Wg.T[t + 2]); return Int32Array.from(out); }

// the garment that falls: the outer one when there is one (a coat's sleeve over the shirt's), else each shirt / top
const fallers = (gar, O) => { const hasOuter = gar.some(x => x.owner === 'outer'); return gar.filter(g => O.owners.includes(g.owner) && (!hasOuter || g.owner === 'outer')); };

// THE CUT: each falling garment's sleeve panels (sleeve8's test on the unwelded posed cloth) split 1 -> 4 before the driver welds or binds
export function refineSleeves9({ parts, poseOf, J, O: o = {} }) {
  const O = { ...SETTLE9, ...o }; if (!O.refine || !J?.shoulderL) return null; const rep = {};
  const curves = ['L', 'R'].map(sd => armCurve(J['shoulder' + sd], J['elbow' + sd], J['wrist' + sd], O.fillet));
  for (const g of fallers(parts.filter(q => q.group === 'garment'), O)) { if (!g.panel) continue; const Pg = poseOf(g), n = g.X.length / 3, np = Math.max(...g.panel) + 1, cnt = new Float64Array(np), close = new Float64Array(np);
    for (let i = 0; i < n; i++) { const p = [Pg[i * 3], Pg[i * 3 + 1], Pg[i * 3 + 2]], d = Math.min(curves[0].near(p).dist, curves[1].near(p).dist); cnt[g.panel[i]]++; if (d < O.sleeveR) close[g.panel[i]]++; }
    const isSl = new Uint8Array(np); for (let k = 0; k < np; k++) isSl[k] = cnt[k] > 20 && close[k] / cnt[k] >= O.sleeveFrac ? 1 : 0;
    if (!isSl.some(Boolean)) { rep[g.name] = { skipped: 'no sleeve panels' }; continue; }
    // a short panel along the arm (a cuff, a gusset: held by the fall) is not cut: its span along its arm against the longest sleeve panel's
    const ext = new Map(); for (let i = 0; i < n; i++) { const pn = g.panel[i]; if (!isSl[pn]) continue; const p = [Pg[i * 3], Pg[i * 3 + 1], Pg[i * 3 + 2]], q0 = curves[0].near(p), q1 = curves[1].near(p), q = q0.dist <= q1.dist ? q0 : q1;
      const e = ext.get(pn) || ext.set(pn, [Infinity, -Infinity]).get(pn); e[0] = Math.min(e[0], q.s); e[1] = Math.max(e[1], q.s); }
    let longest = 0; for (const [, e] of ext) longest = Math.max(longest, e[1] - e[0]); const cut = new Uint8Array(np); for (const [pn, e] of ext) cut[pn] = e[1] - e[0] >= O.cuffSpan * longest ? 1 : 0;
    rep[g.name] = { panels: [...cut].map((s, k) => s ? k : -1).filter(k => k >= 0), short: [...isSl].map((s, k) => s && !cut[k] ? k : -1).filter(k => k >= 0), ...refine9(g, i => cut[g.panel[i]] === 1) }; }
  return rep; }

// a collider from another garment's drawn cloth with its normals turned away from the body (the winding is not trusted)
function layerSurface(Pw, T, bodySurf) { const N = vertexNormals(Pw, T), n = Pw.length / 3; let s = 0, k = 0;
  for (let v = 0; v < n; v += 7) { const q = bodySurf.closestAny(Pw[v * 3], Pw[v * 3 + 1], Pw[v * 3 + 2], 0.06); if (!q) continue; s += N[v * 3] * q.nx + N[v * 3 + 1] * q.ny + N[v * 3 + 2] * q.nz; k++; }
  if (k && s < 0) for (let i = 0; i < N.length; i++) N[i] = -N[i];
  return new SurfaceMesh(Pw, T, { cell: 0.02, normals: N, boundary: true }); }
// a point hash over a set of positions: near(x, y, z) -> true within r of any
function hashNear(X, idx, r) { const H = new Map(), key = (i, j, k) => ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048);
  for (const v of idx) { const kk = key(Math.floor(X[v * 3] / r), Math.floor(X[v * 3 + 1] / r), Math.floor(X[v * 3 + 2] / r)); (H.get(kk) || H.set(kk, []).get(kk)).push(v); }
  return (x, y, z) => { const ci = Math.floor(x / r), cj = Math.floor(y / r), ck = Math.floor(z / r); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const L = H.get(key(ci + a, cj + b, ck + c)); if (!L) continue; for (const v of L) if ((X[v * 3] - x) ** 2 + (X[v * 3 + 1] - y) ** 2 + (X[v * 3 + 2] - z) ** 2 < r * r) return true; } return false; }; }

export function settle9(ctx) {
  const { gar, W, Pws, bodySurf, J, log = () => {} } = ctx, O = { ...SETTLE9, ...(ctx.O?.sleeve || {}) }, rep = {};
  if (!J?.shoulderL || !bodySurf) return null;
  for (const g of gar) if (O.owners.includes(g.owner) && !fallers(gar, O).includes(g)) rep[g.name] = { skipped: 'under the outer garment' };
  for (const g of fallers(gar, O)) {
    const t0ms = Date.now(), Wg = W.get(g), Pw = Pws.get(g), m = Wg.m, SP = sleevePanels(g, Wg, Pw, J, O);
    if (!g.uv || !g.panel) { rep[g.name] = { skipped: 'no pattern' }; continue; }
    const drawn = new Uint8Array(m); for (let i = 0; i < Wg.T.length; i++) drawn[Wg.T[i]] = 1;
    // a rolled / pushed-up sleeve: the zone stops above its roll (sleeve8's test)
    const tLim = [Infinity, Infinity], rolled = [];
    for (const L of Wg.loops) { if (!L.closed || L.ids.length < 8) continue; const sl = L.ids.filter(w => SP.side[w] >= 0 && SP.onSleeve[w]); if (sl.length < 0.8 * L.ids.length) continue;
      const si = SP.side[sl[0]]; let te = 0; for (const w of sl) te += SP.t0[w] / sl.length; let tm = 0; for (let v = 0; v < m; v++) if (SP.side[v] === si && SP.onSleeve[v]) tm = Math.max(tm, SP.t0[v]);
      if (tm - te > O.rolled) { tLim[si] = Math.min(tLim[si], te - O.rollGap); rolled.push({ side: si, edgeCm: +(te * 100).toFixed(1), lowestCm: +(tm * 100).toFixed(1) }); } }
    const tW = [0, 1].map(si => SP.curves[si].near(J[si ? 'wristR' : 'wristL']).s);
    // the candidates: the sleeve's drawn cloth, not near a band, above the cuff and the roll
    const cand = new Uint8Array(m);
    for (let v = 0; v < m; v++) { const si = SP.side[v]; if (!drawn[v] || !SP.onSleeve[v] || si < 0 || SP.t0[v] > tLim[si] || SP.t0[v] > tW[si] - O.cuffHold) continue;
      if (ctx.nearBand && ctx.nearBand(Pw[v * 3], Pw[v * 3 + 1], Pw[v * 3 + 2])) continue; cand[v] = 1; }
    // THE CAP (sewn to the armhole: it sits on the deltoid, it is not a ring round the arm): per arm, the panel holding most of its cloth;
    // its pattern rows binned along v, the armpit row = the top of the full-width rows (>= rowFrac of the widest); above it held as baked.
    // Any other panel of a two-piece sleeve: held above the armpit row's place along the arm.
    const zone = new Uint8Array(m), sides = [];
    for (let si = 0; si < 2; si++) { const Zs = []; for (let v = 0; v < m; v++) if (cand[v] && SP.side[v] === si) Zs.push(v); if (Zs.length < O.minZone) { sides.push({ side: si ? 'R' : 'L', skipped: 'zone', n: Zs.length }); continue; }
      const pc = new Map(); for (const v of Zs) { const pv = g.panel[Wg.rep[v]]; pc.set(pv, (pc.get(pv) || 0) + 1); } const pn = [...pc.entries()].sort((a, b) => b[1] - a[1])[0][0];
      // a panel of this arm much shorter along the arm than the sleeve's own (a cuff, a gusset) is held: CLOTH8's cuff stays
      const ext = new Map(); for (const v of Zs) for (const i of Wg.dups[v]) { const pv = g.panel[i], e = ext.get(pv) || ext.set(pv, [Infinity, -Infinity]).get(pv); e[0] = Math.min(e[0], SP.t0[v]); e[1] = Math.max(e[1], SP.t0[v]); }
      const span = p => { const e = ext.get(p); return e ? e[1] - e[0] : 0; }, heldP = new Set([...ext.keys()].filter(p => p !== pn && span(p) < O.cuffSpan * span(pn)));
      const vb = O.rowBin, rows = new Map(); for (let i = 0; i < g.X.length / 3; i++) { if (g.panel[i] !== pn) continue; const k = Math.floor(g.uv[i * 2 + 1] / vb), r = rows.get(k) || rows.set(k, [Infinity, -Infinity]).get(k); r[0] = Math.min(r[0], g.uv[i * 2]); r[1] = Math.max(r[1], g.uv[i * 2]); }
      let wMax = 0; for (const [, r] of rows) wMax = Math.max(wMax, r[1] - r[0]);
      const onPn = Zs.filter(v => Wg.dups[v].every(i => g.panel[i] === pn)); let a = 0, b = 0, mt = 0; for (const v of onPn) { const vv = g.uv[Wg.rep[v] * 2 + 1]; a += vv * SP.t0[v]; b += vv; mt += SP.t0[v]; }
      const k0 = onPn.length || 1, vSense = a / k0 - (b / k0) * (mt / k0) < 0 ? 1 : -1;   // +1: v rises toward the cap (t falls)
      let vArm = vSense > 0 ? -Infinity : Infinity; for (const [k, r] of rows) if (r[1] - r[0] >= O.rowFrac * wMax) vArm = vSense > 0 ? Math.max(vArm, (k + 1) * vb) : Math.min(vArm, k * vb);
      const tA = []; for (const v of onPn) if (Math.abs(g.uv[Wg.rep[v] * 2 + 1] - vArm) < vb) tA.push(SP.t0[v]); tA.sort((p, q) => p - q); const tArm = tA.length ? tA[tA.length >> 1] : 0;
      let nz = 0, cap = 0, cuff = 0;
      for (const v of Zs) { if (Wg.dups[v].some(i => heldP.has(g.panel[i]))) { cuff++; continue; } const main = Wg.dups[v].every(i => g.panel[i] === pn), above = main ? (vArm - g.uv[Wg.rep[v] * 2 + 1]) * vSense < 0 : SP.t0[v] < tArm; if (above) { cap++; continue; } zone[v] = 1; nz++; }
      sides.push({ side: si ? 'R' : 'L', panel: pn, panels: pc.size, zone: nz, capHeld: cap, cuffHeld: cuff, heldPanels: [...heldP], armpitCm: +(tArm * 100).toFixed(1), wristCm: +(tW[si] * 100).toFixed(1) }); }
    // THE BAKE'S TANGLES HELD (CLOTH8 resolve8's rule): cloth the bake already has crossing itself (L03's shirt: 222 of its 332 crossing
    // pairs where the sleeve's underside meets the body panel at the armpit) is held with the cloth within `tangleR` of it: the solver's
    // self-collision keeps a crossed pair on the side it found it, so falling cloth drags the tangle along and spreads it (the first
    // try: 1 017 new crossing pairs, 666 of them within 2 cm of a bake crossing, which the driver's guard then sent back in patches)
    const L0 = []; selfIntersections(Pw, Wg.T, { list: L0 }); const before = new Set(); for (let i = 0; i < L0.length; i += 2) before.add(L0[i] * 1e6 + L0[i + 1]);
    let tangled = 0; if (O.tangleR > 0 && L0.length) { const tv = new Set(); for (const t of L0) for (let k = 0; k < 3; k++) tv.add(Wg.T[t * 3 + k]); const nearT = hashNear(Pw, [...tv], O.tangleR);
      for (let v = 0; v < m; v++) if (zone[v] && nearT(Pw[v * 3], Pw[v * 3 + 1], Pw[v * 3 + 2])) { zone[v] = 0; tangled++; } }
    const nZ = zone.reduce((p, q) => p + q, 0); if (nZ < O.minZone) { rep[g.name] = { zone: nZ, sides, tangled }; continue; }
    // the sim's cloth: the zone and the garment's drawn cloth within `near` of it (held)
    const Z = []; for (let v = 0; v < m; v++) if (zone[v]) Z.push(v);
    const nearZ = hashNear(Pw, Z, O.near), inSub = new Int32Array(m).fill(-1), map = [];
    for (let v = 0; v < m; v++) if (drawn[v] && (zone[v] || nearZ(Pw[v * 3], Pw[v * 3 + 1], Pw[v * 3 + 2]))) { inSub[v] = map.length; map.push(v); }
    // the welded triangles back to the pattern's own (weldGarment drops the degenerate ones and keeps the order): each one's flat corners
    const orig = []; for (let t = 0; t < g.T.length; t += 3) { const a = Wg.wid[g.T[t]], b = Wg.wid[g.T[t + 1]], c = Wg.wid[g.T[t + 2]]; if (a === b || b === c || a === c) continue; orig.push(t); }
    if (orig.length * 3 !== Wg.T.length) { rep[g.name] = { skipped: 'weld order' }; continue; }
    const Ts = [], tOrig = []; for (let t = 0, j = 0; t < Wg.T.length; t += 3, j++) { const a = inSub[Wg.T[t]], b = inSub[Wg.T[t + 1]], c = inSub[Wg.T[t + 2]]; if (a < 0 || b < 0 || c < 0) continue; Ts.push(a, b, c); tOrig.push(orig[j]); }
    const ns = map.length, nt = Ts.length / 3, rest = new Float64Array(ns * 3), pin = new Uint8Array(ns);
    for (let i = 0; i < ns; i++) { const v = map[i]; for (let c = 0; c < 3; c++) rest[i * 3 + c] = Pw[v * 3 + c]; pin[i] = zone[v] ? 0 : 1; }
    // the pattern's metric (uv, metres) and the warp along the sleeve (the pattern's v)
    const metric = new Float64Array(nt * 6), grain = new Float64Array(nt * 2); let lenB = 0, lenP = 0;
    for (let j = 0; j < nt; j++) { const t = tOrig[j]; for (let c = 0; c < 3; c++) { const i = g.T[t + c]; metric[j * 6 + c * 2] = g.uv[i * 2]; metric[j * 6 + c * 2 + 1] = g.uv[i * 2 + 1]; } grain[j * 2 + 1] = 1;
      if (!pin[Ts[j * 3]] && j % 5 === 0) { const a = Ts[j * 3], b = Ts[j * 3 + 1]; lenB += Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2]); lenP += Math.hypot(metric[j * 6 + 2] - metric[j * 6], metric[j * 6 + 3] - metric[j * 6 + 1]); } }
    // THE SLEEVE LET OUT, NOT SPRUNG (break9 rev 2's lesson): the bake's sleeve is squeezed in its plane (CLOTH8's stages: its edges
    // `bakeOverPattern` of the pattern's); given the pattern's lengths at once it springs out into a balloon (the first try of this rev:
    // L03's sleeves one smooth swollen tube). So the metric goes from the bake's own lengths (each triangle's 3D shape laid flat in its
    // pattern triangle's frame) to the pattern's in `ramp` steps, each a fresh solve from where the last left the cloth, then a settle.
    const metricB = new Float64Array(nt * 6);
    for (let j = 0; j < nt; j++) { const a = Ts[j * 3], b = Ts[j * 3 + 1], c = Ts[j * 3 + 2], d3 = (p, q) => Math.hypot(rest[p * 3] - rest[q * 3], rest[p * 3 + 1] - rest[q * 3 + 1], rest[p * 3 + 2] - rest[q * 3 + 2]);
      const lab = d3(a, b), lac = d3(a, c), lbc = d3(b, c), cosA = Math.max(-1, Math.min(1, (lab * lab + lac * lac - lbc * lbc) / (2 * lab * lac || 1))), al = Math.acos(cosA);
      const M6 = metric.subarray(j * 6, j * 6 + 6), ph = Math.atan2(M6[3] - M6[1], M6[2] - M6[0]), sg = Math.sign((M6[2] - M6[0]) * (M6[5] - M6[1]) - (M6[4] - M6[0]) * (M6[3] - M6[1])) || 1;
      const B = [0, 0, lab * Math.cos(ph), lab * Math.sin(ph), lac * Math.cos(ph + sg * al), lac * Math.sin(ph + sg * al)], cx = (M6[0] + M6[2] + M6[4] - B[0] - B[2] - B[4]) / 3, cy = (M6[1] + M6[3] + M6[5] - B[1] - B[3] - B[5]) / 3;
      for (let k = 0; k < 3; k++) { metricB[j * 6 + k * 2] = B[k * 2] + cx; metricB[j * 6 + k * 2 + 1] = B[k * 2 + 1] + cy; } }
    let fab; try { fab = phys(g.fabric, O.physRev); } catch (e) { fab = phys(O.fallback, O.physRev); }
    // c7 (rev 7): THE SEWN SLEEVE HEM IN THE SOLVE (break9 rev 3's turned trouser hem, for the sleeve): the hem layer is built from the
    // sleeve's own cloth and solved with it; the garment's sewn hem part (trim4's turned hem: its RENDER) is then carried on the solved layer
    const HL = O.hem !== false ? sleeveHemLayer({ g, Wg, Pw, SP, map, inSub, zone, Ts, tOrig, rest, pin, metric, metricB, grain, parts: ctx.parts, P: ctx.P, O }) : null;
    const nsT = HL ? HL.nsT : ns, restT = HL ? HL.rest : rest, pinT = HL ? HL.pin : pin, metT = HL ? HL.metric : metric, metBT = HL ? HL.metricB : metricB;
    const Ti = Int32Array.from(HL ? HL.Ti : Ts), mk = (f, X) => { const c = new Cloth(restT, Ti, fab, { X0: X, pin: pinT, metric: metBT.map((m0, k) => m0 + (metT[k] - m0) * f), grain: HL ? HL.grain : grain, fabs: [fab], restAngle: O.restAngle, compress: O.compress, foldMax: O.foldMax, damping: O.damping, vmax: O.vmax, tether: true, slack: O.slack,
      ...(O.selfTri > 0 ? { selfTri: HL ? HL.TH : O.selfTri, selfTriEvery: O.selfEvery } : {}) }); if (HL?.tacks.length) c.stitch(HL.tacks, { alpha: O.tackAlpha, L: HL.tackL }); return c; };
    // colliders: the body (all its skin), the drawn cloth of the garments under this one (under a coat its tee / shirt; the trousers, a skirt)
    const mask = new Uint8Array(nsT); for (let i = 0; i < nsT; i++) mask[i] = pinT[i] ? 0 : 1;
    const surfaces = [{ mesh: bodySurf, gap: O.gap + fab.h / 2, mu: O.mu, reach: 0.04, mask }];
    for (const u of gar) { if (u === g) continue; const under = g.owner === 'outer' && ['top', 'shirt'].includes(u.owner), other = !O.owners.includes(u.owner); if (!under && !other) continue; let fu; try { fu = phys(u.fabric, O.physRev); } catch (e) { fu = fab; }
      surfaces.push({ mesh: layerSurface(Pws.get(u), W.get(u).T, bodySurf), gap: O.layerGap + (fab.h + fu.h) / 2, mu: O.mu, reach: 0.03, garment: true, mask }); }
    const contacts = new Contacts(nsT, surfaces, { reach: 0.04, safe: true });
    let cl = null, Xc = restT; for (let k = 1; k <= O.ramp; k++) { cl = mk(k / O.ramp, Xc); cl.run(O.T * O.rampT / O.ramp, { hz: O.hz, contacts, every: O.every }); Xc = Float64Array.from(cl.X); }
    cl = mk(1, Xc); cl.run(O.T * (1 - O.rampT), { hz: O.hz, contacts, every: O.every });
    let moved = 0, mx = 0, capped = 0, sumDy = 0;
    for (let i = 0; i < ns; i++) { if (pin[i]) continue; const v = map[i]; let d = [cl.X[i * 3] - Pw[v * 3], cl.X[i * 3 + 1] - Pw[v * 3 + 1], cl.X[i * 3 + 2] - Pw[v * 3 + 2]], l = Math.hypot(d[0], d[1], d[2]);
      if (!Number.isFinite(l)) continue; if (l > O.maxMove) { d = d.map(x => x * O.maxMove / l); l = O.maxMove; capped++; }
      for (let c = 0; c < 3; c++) Pw[v * 3 + c] += d[c]; if (l > 1e-5) moved++; mx = Math.max(mx, l); sumDy += d[1]; }
    const L2 = []; selfIntersections(Pw, Wg.T, { list: L2 }); let newX = 0; for (let i = 0; i < L2.length; i += 2) if (!before.has(L2[i] * 1e6 + L2[i + 1])) newX++;
    if (HL) carrySleeveHem(HL, cl.X, g, Wg, Pw, ctx);
    rep[g.name] = { fabric: g.fabric, bendCm: +(fab.c * 100).toFixed(2), sides, rolled, tangled, zone: nZ, sim: ns, tris: nt, bakeOverPattern: lenP ? +(lenB / lenP).toFixed(3) : null,
      ...(HL ? { hem: HL.rep } : {}), moved, maxMm: +(mx * 1000).toFixed(1), meanDyMm: +(sumDy / Math.max(1, nZ) * 1000).toFixed(1), capped, self: { before: L0.length / 2, after: L2.length / 2, new: newX }, foldsHeld: cl.folds, ms: Date.now() - t0ms };
    log('settle9 sleeve', g.name, JSON.stringify(rep[g.name])); }
  return rep;
}

// c7 (rev 7): THE SEWN SLEEVE HEM, SOLVED WITH THE SLEEVE. A sleeve's hem is its own cloth turned up inside it and stitched (trim4's
// turnedHem: 1.8 cm on a tee, 3 cm on a jacket). Rev 6 solved the sleeve's single layer and carried the sewn hem part onto it afterwards by
// its bind (barycentric + offset): where the fall folded the sleeve near its edge, the carried hem cut through the sleeve (L12's jacket:
// 32 'jacket.hem.sleeve x outer' new crossings), the construction guard sent the sleeve's cloth back toward the bake round each one, which
// made more (295 in its next round), and the patches it left read as a ragged shelf across the forearm and torn wrist hems (the c3-5 read).
// Now, as break9 does for the trouser hem: the sleeve's cloth within the hem's depth of its edge (the depth read off the garment's own sewn
// hem part: how far up the pattern it lies, never a number per person) is DUPLICATED as an inner layer: the same pattern triangles, the
// winding turned over, its edge row the sleeve's own edge particles (the fold), every other vertex a particle `selfTri + hemTh` inside,
// its top row tacked to the vertex it duplicates (the stitch line). It falls with the sleeve, meets the arm and the sleeve (self-collision),
// and the sewn hem part is placed on it as solved, then bound to the solved sleeve for the driver (ctx.hemBind), whose guard lets such a
// hem follow and never moves the sleeve for it (the trouser hem's rule).
function sleeveHemLayer({ g, Wg, Pw, SP, map, inSub, zone, Ts, tOrig, rest, pin, metric, metricB, grain, parts, P, O }) {
  const hems = (parts || []).filter(q => q.group === 'construction' && q.owner === g.owner && /hem\.sleeve$/.test(q.name)); if (!hems.length || !P) return null;
  const ns = map.length, nt = Ts.length / 3, m = Wg.m;
  // the pattern height above the sleeve's cuff edge (uv metres), per panel: the panel's cuff end is its extreme v toward the wrist
  const stat = new Map(); for (let i = 0; i < ns; i++) { const w = map[i]; if (!SP.onSleeve[w] || SP.side[w] < 0) continue; const r = Wg.rep[w], pn = g.panel[r], v = g.uv[r * 2 + 1], t = SP.t0[w];
    const s = stat.get(pn) || stat.set(pn, { n: 0, v: 0, t: 0, vt: 0, lo: Infinity, hi: -Infinity }).get(pn); s.n++; s.v += v; s.t += t; s.vt += v * t; s.lo = Math.min(s.lo, v); s.hi = Math.max(s.hi, v); }
  const aW = new Float64Array(m).fill(Infinity);
  for (let i = 0; i < ns; i++) { const w = map[i], r = Wg.rep[w], s = stat.get(g.panel[r]); if (!s || !SP.onSleeve[w]) continue; const cov = s.vt / s.n - (s.v / s.n) * (s.t / s.n), v = g.uv[r * 2 + 1]; aW[w] = cov > 0 ? s.hi - v : v - s.lo; }
  // the hem's depth from the sewn part itself: each part vertex bound to the sleeve's welded cloth, the pattern height there (hemQ quantile)
  const surf = new SurfaceMesh(Pw, Int32Array.from(Wg.T), { cell: 0.015 }), depth = [[], []];
  for (const q of hems) { const B = bind8(P(q), Pw, Wg.T, { surf }); for (let v = 0; v < B.n; v++) { const t = B.tri[v]; if (t < 0) continue; let a = 0, si = -1, ok = true;
    for (let k = 0; k < 3; k++) { const w = Wg.T[t * 3 + k]; if (!Number.isFinite(aW[w])) { ok = false; break; } a += aW[w] * B.bc[v * 3 + k]; si = SP.side[w]; } if (ok && si >= 0) depth[si].push(a); } }
  const dep = depth.map(d => { if (d.length < 8) return 0; d.sort((x, y) => x - y); return d[Math.min(d.length - 1, Math.floor(O.hemQ * d.length))]; });
  if (!dep[0] && !dep[1]) return null;
  const inBand = w => SP.side[w] >= 0 && dep[SP.side[w]] > 0 && aW[w] <= dep[SP.side[w]];
  // the fold: the sleeve's closed edge loops (on the cuff end: pattern height ~0) whose particles are in the sim
  const edgeW = new Set(); for (const Lp of Wg.loops) { if (!Lp.closed || Lp.ids.length < 8 || Lp.ids.some(w => inSub[w] < 0)) continue; const a = Lp.ids.map(w => aW[w]).sort((x, y) => x - y); if (a[a.length >> 1] < 0.005) for (const w of Lp.ids) edgeW.add(w); }
  if (!edgeW.size) return null;
  const inTri = []; for (let j = 0; j < nt; j++) if (inBand(map[Ts[j * 3]]) && inBand(map[Ts[j * 3 + 1]]) && inBand(map[Ts[j * 3 + 2]])) inTri.push(j);
  if (!inTri.length) return null;
  // inward: toward the arm's axis, by the majority of the band's vertices (the winding is not trusted)
  const NL = vertexNormals(Pw, Wg.T); let sgV = 0;
  for (const j of inTri) for (let c = 0; c < 3; c++) { const w = map[Ts[j * 3 + c]], p = [Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]], f = SP.curves[SP.side[w]].near(p).foot; if (!f) continue;
    sgV += Math.sign((p[0] - f[0]) * NL[w * 3] + (p[1] - f[1]) * NL[w * 3 + 1] + (p[2] - f[2]) * NL[w * 3 + 2]); }
  const sgN = sgV < 0 ? -1 : 1, sep = O.selfTri + O.hemTh, dup = new Int32Array(ns).fill(-1), xs = [], Th = [], thOf = [], tacks = [], tackL = []; let nsT = ns;
  for (const j of inTri) { const tri = []; for (let c = 0; c < 3; c++) { const i = Ts[j * 3 + c], w = map[i]; if (edgeW.has(w)) { tri.push(i); continue; }
      if (dup[i] < 0) { dup[i] = nsT++; for (let d = 0; d < 3; d++) xs.push(Pw[w * 3 + d] - sgN * NL[w * 3 + d] * sep); } tri.push(dup[i]); }
    Th.push(tri[0], tri[2], tri[1]); thOf.push(j); }
  { const ec = new Map(); for (let k = 0; k < Th.length; k += 3) for (let c = 0; c < 3; c++) { const a = Th[k + c], b = Th[k + (c + 1) % 3], kk = Math.min(a, b) * nsT + Math.max(a, b); ec.set(kk, (ec.get(kk) || 0) + 1); }
    const top = new Set(); for (const [kk, c] of ec) if (c === 1) for (const v of [Math.floor(kk / nsT), kk % nsT]) if (v >= ns) top.add(v);
    for (let i = 0; i < ns; i++) if (dup[i] >= 0 && top.has(dup[i])) { tacks.push(dup[i], i); tackL.push(sep); } }
  const restT = new Float64Array(nsT * 3), pinT = new Uint8Array(nsT), TH = new Float64Array(nsT).fill(O.selfTri);
  restT.set(rest); restT.set(xs, ns * 3); pinT.set(pin); for (let i = 0; i < ns; i++) if (dup[i] >= 0) { pinT[dup[i]] = pin[i]; TH[dup[i]] = O.hemTh; }
  const nth = Th.length / 3, ntT = nt + nth, metT = new Float64Array(ntT * 6), metBT = new Float64Array(ntT * 6), grT = new Float64Array(ntT * 2);
  metT.set(metric); metBT.set(metricB); grT.set(grain);
  for (let k = 0; k < nth; k++) { const j = thOf[k], o = (nt + k) * 6; for (const [c, s] of [[0, 0], [1, 2], [2, 1]]) { metT[o + c * 2] = metric[j * 6 + s * 2]; metT[o + c * 2 + 1] = metric[j * 6 + s * 2 + 1]; metBT[o + c * 2] = metricB[j * 6 + s * 2]; metBT[o + c * 2 + 1] = metricB[j * 6 + s * 2 + 1]; }
    grT[(nt + k) * 2] = grain[j * 2]; grT[(nt + k) * 2 + 1] = grain[j * 2 + 1]; }
  return { nsT, ns, rest: restT, pin: pinT, TH, metric: metT, metricB: metBT, grain: grT, Ti: [...Ts, ...Th], Th: Int32Array.from(Th), tacks, tackL, hems,
    rep: { depthCm: dep.map(d => +(d * 100).toFixed(2)), sepMm: +(sep * 1000).toFixed(2), tris: nth, particles: nsT - ns, fold: edgeW.size, tacks: tacks.length / 2 } };
}
// the sewn hem part placed on the solved layer (bound to it as the solve started), then bound to the solved sleeve for the driver
function carrySleeveHem(HL, Xs, g, Wg, Pw, ctx) {
  const n0 = g.X.length / 3, Pn = new Float64Array(n0 * 3); for (let i = 0; i < n0; i++) { const w = Wg.wid[i]; for (let c = 0; c < 3; c++) Pn[i * 3 + c] = Pw[w * 3 + c]; }
  const S0 = new SurfaceMesh(HL.rest, HL.Th, { cell: 0.015 }); ctx.hemBind ||= new Map(); HL.rep.carried = {};
  for (const q of HL.hems) { const Xq = ctx.P(q), B = bind8(Xq, HL.rest, HL.Th, { surf: S0 }), X2 = Float64Array.from(Xq); const k = place8(B, Xs, HL.Th, X2);
    ctx.hemBind.set(q, bind8(X2, Pn, g.T)); HL.rep.carried[q.name + '#' + ctx.parts.indexOf(q)] = k; } }
