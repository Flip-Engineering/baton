// CLOTH9 c5 it3 (15 Oct): THE TROUSERS SEATED ON THE BODY THEY ARE WORN ON (stage 'seat'), a post-pass on a finished bake like break9's legs.
// Why: a bake's trousers were draped on the body as it was when the bake was made. The body is a simulation of its own that keeps moving
// on (the pelvis solve's hips and thighs: ANAT8-PELVIS; the soft-tissue envelope; BODY7's membrane): the women's hips and thighs now
// stand 1.5-3.3 cm OUT through the trousers between the crotch and the hip (node, cloth9_scratch/c8/thigh_probe.mjs on v9m/v8c, L06: at
// mid-thigh 230 of 532 trouser vertices inside the current skin, p05 -33 mm), and the renderer, which drops the skin the bake calls
// covered, shows the skin that pokes out as ragged flaps standing off the hips (G0 / G1, both women). Nothing in the cloth9 chain ever
// solved the trousers between the waistband (waist9) and the knee (break9): they stood where the bake left them.
// What a real pair does: the cloth from the waistband to the knee lies on the seat, the hips and the thighs it is worn over, pulled taut
// where the body fills it (the hip, the seat), hanging in drag folds where it does not (the front of the thigh, below the seat).
// So: lib/fx/cloth/xpbd.js on the trousers' cloth from just under the waistband to just below the knee, against the CURRENT body's full
// skin (the person the render draws), with the PATTERN's lengths (the garment's uv, metres; the warp along the leg), the fabric's rev-7
// bending, compression at 0.3 of stretch, gravity, Coulomb friction, self-collision; the cloth just under the band and just below the
// zone held (sewn to the band; break9 takes the leg below). No shape is aimed at: where the pattern has the ease the cloth lies on the
// body, where it has not the cloth is taut (that is the garment's cut, CLOTH8 / K4's draft, not this pass's).
// The cloth starts partly INSIDE the body (by the probe above); contact projects it out along the skin's normal over the first
// `ramp` steps (the push given in fractions of the depth: gap ramped from -depth to the fabric's half thickness), so it is not thrown.
//   settleSeat9(ctx)  ctx as settleLegs9's -> report; edits Pws (posed, welded) in place (the driver's commit carries the parts sewn on it)
//
// rev 2 (CLOTH9 c6 it1, 15 Oct ~17:30): THE SEAT AT BUILD. The body is no longer finished when a bake is made: the person build goes on
// moving it after the garments are attached (person/build.js: BODY7's girdle and girdle layer, ANAT8-BODY's soft solve, ANAT8-PELVIS,
// and from the integrator's c5 run the figure study's body form under the clothes), and a bake made on the old body keeps the old body's
// shape: skin through the cloth where the body grew (the women's hip flaps), cloth standing off where it withdrew. So the same solve runs
// on the BUILT person, for EVERY garment, in whatever pose the person stands (the stance, MOTION's dressed poses; a clip starts from it):
//   seatPerson9(P, X0, o)   P = a built dressed person (its parts SkinnedMeshes over P.bake's records); X0 = the body's bind positions
//                           when the parts were attached (the same array build.js keeps for CLOTH8's refit8; null: only cloth now inside);
//                           run AFTER refit8 (the underwear on the final body: the garments lie on it) and BEFORE cover8 and fine7.
//                           Edits the parts' geometry in place (bind positions and normals) -> report.
// Where the cloth is re-seated (nothing is aimed at a shape; the zone is where the body under the cloth changed): a garment vertex whose
// closest skin is now more than `insideTol` inside it, or which lies inside the underwear (refit8 moved it out with the tissue), or (X0
// given) which rested on the skin (within `contact`) and the skin withdrew from under it by more than `withdraw`; `rings` rings round
// those are free, `hold` rings beyond them held, and the bands (waistband, cuffs: CLOTH8's BANDS8) held where they are. The garments go
// in the bake's stack order (inner first); each lies on the skin, the underwear and the garments under it (their surfaces turned to face
// away from the body). The cloth keeps its own lengths as it stands (`toPattern` 0: the build moves cloth with the body; it does not
// re-cut it; 1 = the pattern's, as the bake-time stage), with the fabric's bending, gravity, friction and self-collision. What is sewn on
// a garment follows its cloth (CLOTH8's carry8); a crossing between pieces that the seat made sends the moved cloth back (the driver's
// construction guard). Byte-identical where nothing is inside and the body did not move.
// What the build's seat does NOT re-solve (said plainly): gravity (the bake settled the drape under gravity with the supports a local solve
// lacks: the band's grip, the tuck, the rest of the garment; with gravity on, L22's scrub trousers' waist and L06's tucked tail slid 18-36 cm:
// so the build moves cloth by contact only and the drape stays the bake's); cloth an outer garment covers (held: xpbd's cloth-on-cloth
// contact has no friction to hold it); the bands (held with `bandNear` round them: a waistband in the solve, `holdBands: false`, is the next
// step: the bake's tangles pinned it); the bake's own self-tangles (held, `tangleHold` round them).
//
// c6 it3 (CLOTH9, 15 Oct 21:40-22:15): THE WAISTBAND, MEASURED; THE BAND ARM (off). Rev 2-3 hold the waistband where the bake left it and
// 4 cm of cloth along the garment's top edge (`supportHold`). The band is CLOTH4's ring (cloth4.js waistRing, at the bake), swept round the
// bake's waist loop and pushed out to clear the cloth in its height; on L03 it stands off the skin 2 / 18 / 35 mm (10th / 50th / 90th
// percentile; the orchestrator's and critic c6-1's 'rigid tube with a gap all round'). bandCut9 now MEASURES it in every seat (the report's
// garments.<name>.band; describes, decides nothing): its length round in its own plane, the tailor's tape of the final body in that plane
// (ring9 over the welded skin) x (1 + the draft's waist ease, tailor.js), and the seam it is sewn on (the garment's top loop, in the pattern
// and as it lies). L03 (node): band 94.1 cm, the tape at its line 83.6 cm (cut 85.2: s 0.906), the trousers' top edge 105.1 cm of pattern
// (105.5 as it lies): the trousers are cut 25 % over the body at the band's line and the bake gathered that into a ring that had to clear
// the bunch. THE BAND ARM ({ seat9: { band: true } }) puts the band in the joint solve cut by the tailor (its weft round the waist x s), its
// section kept (its own rest dihedrals), stitched to its garment's cloth and gripping every garment's cloth under it, the support hold off,
// the guard sending a band back as cloth. Tried on L03 (cloth9_scratch/c11/logs/b4*.log) it does NOT seat the band: the band cannot close
// over the bunched trousers' top and the tucked shirt (300-450 band x shirt crossings in the solve; the guard sends it back: 1-2 mm net);
// freeing the tucked shirt under the waist (tried: 'the waist taken in', a dart's taper to the band) let 426 shirt vertices slide 36 cm
// inside the leg (no cloth-on-cloth friction); with the support hold off the trousers lose the long-range tethers it gave them (xpbd
// tethers run from pinned cloth, not from stitches: 10 more vertices fell 10 cm). So the arm stays OFF, the defaults are rev 3's, and the
// three causes are handed on (NOTES: the cut's waist shaping, CLOTH8 / K2; cloth friction and tethers from stitches in xpbd, CLOTH8).
import { Cloth } from '../xpbd.js';
import { phys } from '../fabrics.js';
import { SurfaceMesh, Contacts, boneMats, skinPose, blendInverse, vertexNormals } from '../collide.js';
import { selfIntersections, weldIds } from '../cloth5/measure5.js';
import { weldGarment } from '../cloth7/fold7.js';
import { bind8, place8 } from '../cloth8/carry8.js';
import { BANDS8, nearSet } from '../cloth8/rebuild8.js';
import { adjacency } from '../cloth8/relax8.js';
import { gradeGarment9, edgeTris9, ring9 } from './grade9.js';
import { easeFor } from '../tailor.js';
export const SEAT9_VERSION = 3;   // (c6 it3: rev 3's behaviour + the band measured; the band arm off)
export const SEAT9 = { below: 0.06, under: 0.012, hold: 0.03, T: 2, hz: 480, every: 6, damping: 3, vmax: 0.6, gap: 0.002, mu: 0.4, compress: 0.3,
  selfTri: 0.0015, selfEvery: 8, restAngle: 0, physRev: 7, fallback: 'chino', ramp: 4, rampT: 0.6, maxMove: 0.08, foundGap: 0.001, top: 0.015 };
// the build's seat (rev 2): the zone rule and the run (the solver's own keys come from SEAT9)
export const SEATP9 = { reach: 0.05, insideTol: 0.002, foundTol: 0.001, contact: 0.008, withdraw: 0.003, zoneMin: 0.04, zoneK: 2.5, zoneMax: 0.2, holdW: 0.02, layerReach: 0.015,
  minSeeds: 6, bandFrac: 0.3, supportHold: 0.04, coverReach: 0.015, gravity: null, T: 1.2, rampB: 8, tangleHold: 0.012, toPattern: 0, holdBands: true, bandNear: 0.02, bandsSolve: /^(waistband|cuff\.join\.[LR]|sweat\.cuff\.[LR]|sweat\.hemband)$/, layerGap: 0.0012, guard: 6, guardRings: [1, 0.6, 0.3],
  // (rev 3) THE CUT FOR THE BODY IT IS WORN ON, HUNG: the cloth's weft graded by the tape of the skin under it (grade9.js) where it changed by
  // more than `gradeTol`, and gravity on (the bake's g); { hang: false } = rev 2 (the bake's own lengths, gravity off): the A/B of c6 it2
  hang: true, gradeTol: 0.015, grade: {},
  // (c6 it3) THE BAND ARM, `band: true` (OFF: node, 15 Oct 21:53-22:07, L03: the guard sends the band back, see the header): the band in the
  // solve, cut to the tape of the final body in its plane x (1 + the draft's waist ease), stitched to the cloth under it within `bandStitch`
  // (every garment's cloth within `bandUnder` gripped; compliance `bandAlpha`), its rest dihedrals its own (`bandRestAngle` 1)
  band: false, bandStitch: 0.02, bandUnder: 0.01, bandAlpha: 1e-7, bandRestAngle: 1, bandFit: 'regular', bandRings: 12 };

// ---------------------------------------------------------------- the solve (shared by the bake's stage and the build's seat)
// rest: the sub-mesh's posed positions (ns*3, metres); Ts its triangles; pin 1 = held; metric the pattern's corners per triangle (nt*6),
// grain (nt*2); surfaces(gap, mask): the colliders at a contact gap. The metric runs from the cloth's own lengths (each triangle laid flat
// in its pattern frame) to the pattern's x toPattern over the ramp, with the push out of the body ramped from minus the depth.
export function ownMetric(rest, Ts, metric, pin = null) {
  const nt = Ts.length / 3, metricB = new Float64Array(nt * 6); let lenB = 0, lenP = 0;
  for (let j = 0; j < nt; j++) { const a = Ts[j * 3], b = Ts[j * 3 + 1], c = Ts[j * 3 + 2], d3 = (p, q) => Math.hypot(rest[p * 3] - rest[q * 3], rest[p * 3 + 1] - rest[q * 3 + 1], rest[p * 3 + 2] - rest[q * 3 + 2]);
    const lab = d3(a, b), lac = d3(a, c), lbc = d3(b, c), al = Math.acos(Math.max(-1, Math.min(1, (lab * lab + lac * lac - lbc * lbc) / (2 * lab * lac || 1))));
    const M6 = metric.subarray(j * 6, j * 6 + 6), ph = Math.atan2(M6[3] - M6[1], M6[2] - M6[0]), sg = Math.sign((M6[2] - M6[0]) * (M6[5] - M6[1]) - (M6[4] - M6[0]) * (M6[3] - M6[1])) || 1;
    const B = [0, 0, lab * Math.cos(ph), lab * Math.sin(ph), lac * Math.cos(ph + sg * al), lac * Math.sin(ph + sg * al)], cx = (M6[0] + M6[2] + M6[4] - B[0] - B[2] - B[4]) / 3, cy = (M6[1] + M6[3] + M6[5] - B[1] - B[3] - B[5]) / 3;
    for (let k = 0; k < 3; k++) { metricB[j * 6 + k * 2] = B[k * 2] + cx; metricB[j * 6 + k * 2 + 1] = B[k * 2 + 1] + cy; }
    if (!(pin && pin[a]) && j % 5 === 0) { lenB += lab; lenP += Math.hypot(M6[2] - M6[0], M6[3] - M6[1]); } }
  return { metricB, bakeOverPattern: +(lenB / (lenP || 1)).toFixed(3) };
}
// (rev 2) extra: [{ mesh, fin (the contact gap it ends at: number or per particle), reach, garment }] with O.rampEach: EVERY contact (the skin's and
// these) starts each particle at the distance it stands now (inside: negative) and is ramped to its own end, so no particle is projected through
// the cloth beside it at the first step (rev 1: one depth for all from the 5th percentile, the found surface at full gap from the start: the
// deepest jumped up to 2.6 cm at once and the layers crossed)
export function solveSeat9({ rest, Ts, pin, metric, metricB, grain, fab, fabs = null, triFab = null, gapF = null, bodySurf, surfaces = null, extra = null, O, toPattern = 1, T = O.T, stitch = null, restAngle = null }) {
  const ns = rest.length / 3, Ti = Int32Array.from(Ts);
  const depth = X => { const a = []; for (let i = 0; i < ns; i++) { if (pin[i]) continue; const q = bodySurf.closestAny(X[i * 3], X[i * 3 + 1], X[i * 3 + 2], 0.06); if (q) a.push(q.d); } a.sort((x, y) => x - y);
    const k = a.length, pc = f => (k ? +(a[Math.floor(f * (k - 1))] * 1000).toFixed(1) : null); return { n: k, inside: a.filter(x => x < 0).length, p05: pc(0.05), p50: pc(0.5) }; };
  const d0 = depth(rest), deep = Math.max(0, -(d0.p05 ?? 0) / 1000);
  const mask = Uint8Array.from(pin, f => (f ? 0 : 1)), L0 = []; selfIntersections(rest, Ti, { list: L0 }); const was = new Set(); for (let i = 0; i < L0.length; i += 2) was.add(L0[i] * 1e6 + L0[i + 1]);
  // the contact gap each particle ends at (one number: the fabric's half thickness over O.gap; per particle: a joint settle's layers)
  const GF = gapF || O.gap + fab.h / 2; let gAt;
  if (O.rampEach) { const fin = typeof GF === 'number' ? new Float64Array(ns).fill(GF) : GF, starts = (mesh, fv, reach, gar) => { const st = Float64Array.from(fv);
      for (let i = 0; i < ns; i++) { if (pin[i]) continue; const q = mesh.closestAny(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2], reach); if (!q || (gar && q.edge)) continue; if (q.d < st[i]) st[i] = q.d; } return st; };
    const S0 = [{ mesh: bodySurf, fin, st: starts(bodySurf, fin, 0.05, false), reach: 0.05, garment: false }, ...(extra || []).map(e => { const fv = typeof e.fin === 'number' ? new Float64Array(ns).fill(e.fin) : e.fin; return { ...e, fin: fv, st: starts(e.mesh, fv, e.reach, e.garment) }; })];
    gAt = f => S0.map(e => ({ mesh: e.mesh, gap: Float64Array.from(e.fin, (g, i) => e.st[i] + (g - e.st[i]) * f), mu: O.mu, reach: e.reach, ...(e.garment ? { garment: true } : {}), mask })); }
  else gAt = f => { const g = typeof GF === 'number' ? -deep + (GF + deep) * f : Float64Array.from(GF, g => -deep + (g + deep) * f); return [{ mesh: bodySurf, gap: g, mu: O.mu, reach: 0.05, mask }, ...(surfaces ? surfaces(g, mask) : [])]; };
  const run = (S, X, Tr, f) => { const contacts = new Contacts(ns, S, { reach: 0.05, safe: true });
    const cl = new Cloth(rest, Ti, fab, { X0: X, pin, metric: metricB.map((m0, k) => m0 + (metric[k] - m0) * f), grain, fabs: fabs || [fab], ...(triFab ? { triFab } : {}), restAngle: restAngle || O.restAngle, compress: O.compress, damping: O.damping, vmax: O.vmax, tether: true, slack: 0.01, ...(O.gravity ? { gravity: O.gravity } : {}),
      ...(O.selfTri > 0 ? { selfTri: O.selfTri, selfTriEvery: O.selfEvery } : {}) });
    if (stitch?.pairs?.length) cl.stitch(stitch.pairs, { alpha: stitch.alpha, L: stitch.L });
    cl.run(Tr, { hz: O.hz, contacts, every: O.every }); return Float64Array.from(cl.X); };
  let Xc = rest;
  for (let k = 1; k <= O.ramp; k++) Xc = run(gAt(k / O.ramp), Xc, T * O.rampT / O.ramp, toPattern * k / O.ramp);
  Xc = run(gAt(1), Xc, T * (1 - O.rampT), toPattern);
  const d1 = depth(Xc), L1 = []; selfIntersections(Xc, Ti, { list: L1 }); let newX = 0; for (let i = 0; i < L1.length; i += 2) if (!was.has(L1[i] * 1e6 + L1[i + 1])) newX++;
  return { X: Xc, inside: { before: d0, after: d1 }, self: { before: L0.length / 2, after: L1.length / 2, new: newX } };
}
// a garment's pattern on a welded sub-mesh: the triangles among the zone's and held vertices, the pattern's corners, the warp along the
// height in each panel (break9's rule: the sign of dv against height)
function subPattern9(g, Wg, Pw, inSub) {
  const orig = []; for (let t = 0; t < g.T.length; t += 3) { const a = Wg.wid[g.T[t]], b = Wg.wid[g.T[t + 1]], c = Wg.wid[g.T[t + 2]]; if (a === b || b === c || a === c) continue; orig.push(t); }
  if (orig.length * 3 !== Wg.T.length) return null;
  const UV = g.uv, n0 = g.X.length / 3, np = Math.max(...g.panel) + 1, sv = new Float64Array(np).fill(1); { const a = new Float64Array(np), b = new Float64Array(np), c = new Float64Array(np), yb = new Float64Array(np);
    for (let i = 0; i < n0; i++) { const p = g.panel[i], y = Pw[Wg.wid[i] * 3 + 1]; a[p] += UV[i * 2 + 1] * y; b[p] += UV[i * 2 + 1]; c[p] += 1; yb[p] += y; }
    for (let p = 0; p < np; p++) if (c[p]) sv[p] = a[p] / c[p] - (b[p] / c[p]) * (yb[p] / c[p]) >= 0 ? 1 : -1; }
  const Ts = [], tOrig = []; for (let t = 0, j = 0; t < Wg.T.length; t += 3, j++) { const a = inSub[Wg.T[t]], b = inSub[Wg.T[t + 1]], c = inSub[Wg.T[t + 2]]; if (a < 0 || b < 0 || c < 0) continue; Ts.push(a, b, c); tOrig.push(orig[j]); }
  const nt = Ts.length / 3, metric = new Float64Array(nt * 6), grain = new Float64Array(nt * 2);
  for (let j = 0; j < nt; j++) { const t = tOrig[j]; for (let c = 0; c < 3; c++) { const i = g.T[t + c]; metric[j * 6 + c * 2] = UV[i * 2]; metric[j * 6 + c * 2 + 1] = UV[i * 2 + 1]; } grain[j * 2] = 0; grain[j * 2 + 1] = sv[g.panel[g.T[t]]]; }
  return { Ts, metric, grain };
}
function fabricOf(name, O) { try { return phys(name, O.physRev); } catch (e) { return phys(O.fallback, O.physRev); } }

// ---------------------------------------------------------------- the bake's stage (rev 1): the trousers, band to knee
export function settleSeat9(ctx) {
  const { gar, W, Pws, body, bodySurf, J, parts, P, nearBand, log = () => {} } = ctx, O = { ...SEAT9, ...(ctx.O?.seat || {}) };
  const g = gar.find(x => x.owner === 'trousers'); if (!g || !g.uv || !g.panel) return { skipped: 'no trousers with a pattern' };
  const t0 = Date.now(), Wg = W.get(g), Pw = Pws.get(g), m = Wg.m;
  // the band's bottom (after waist9): the zone's top; the knee: its bottom
  // the zone's top follows the waist ALL ROUND (a jeans' back rises 5-8 cm over its front: one height cut the front's top edge loose and
  // it fell 8 cm on L12): the ring the zone hangs from is the waistband's bottom edge (after waist9) or, with no band part, the garment's
  // own top loop; at each vertex its height is that ring's at the vertex's angle round the waist's centre, less `under` (`top` more
  // with no band: the waist facing / the band sewn in the garment's cloth)
  const band = parts.find(q => q.group === 'construction' && q.name === 'waistband'); let ring = [];
  if (band) { const Xb = P(band); for (let i = 0; i < Xb.length; i += 3) ring.push([Xb[i], Xb[i + 1], Xb[i + 2]]); }
  else { let best = null; for (const Lp of Wg.loops || []) { if (!Lp.closed || Lp.ids.length < 12) continue; let cy = 0; for (const w of Lp.ids) cy += Pw[w * 3 + 1]; cy /= Lp.ids.length; if (!best || cy > best.cy) best = { ids: Lp.ids, cy }; }
    if (!best) return { skipped: 'no waist loop' }; ring = best.ids.map(w => [Pw[w * 3], Pw[w * 3 + 1] - O.top, Pw[w * 3 + 2]]); }
  let cx = 0, cz = 0; for (const r of ring) { cx += r[0]; cz += r[2]; } cx /= ring.length; cz /= ring.length;
  const NB = 72, low = new Float64Array(NB).fill(Infinity), ang = (x, z) => ((Math.atan2(z - cz, x - cx) / (2 * Math.PI) + 1) % 1) * NB;
  for (const r of ring) { const b = Math.floor(ang(r[0], r[2])) % NB; low[b] = Math.min(low[b], r[1]); }
  for (let pass = 0; pass < NB; pass++) for (let b = 0; b < NB; b++) if (!Number.isFinite(low[b])) low[b] = Math.min(low[(b + 1) % NB], low[(b + NB - 1) % NB]);
  const topAt = (x, z) => { const a = ang(x, z), b0 = Math.floor(a) % NB, b1 = (b0 + 1) % NB, f = a - Math.floor(a); return low[b0] * (1 - f) + low[b1] * f - O.under; };
  const yLo = Math.max(J.kneeL[1], J.kneeR[1]) - O.below; let yHi = -Infinity, yHiLo = Infinity; for (let b = 0; b < NB; b++) { yHi = Math.max(yHi, low[b] - O.under); yHiLo = Math.min(yHiLo, low[b] - O.under); }
  const zone = new Uint8Array(m), held = new Uint8Array(m);
  for (let w = 0; w < m; w++) { const y = Pw[w * 3 + 1];
    const yT = topAt(Pw[w * 3], Pw[w * 3 + 2]);
    if (y >= yLo && y <= yT && !(nearBand && nearBand(Pw[w * 3], y, Pw[w * 3 + 2]))) zone[w] = 1; else if (y >= yLo - O.hold && y <= yT + O.hold) held[w] = 1; }
  // every triangle touching the zone takes its other corners as held
  for (let t = 0; t < Wg.T.length; t += 3) { const v = [Wg.T[t], Wg.T[t + 1], Wg.T[t + 2]]; if (v.some(x => zone[x])) for (const x of v) if (!zone[x]) held[x] = 1; }
  const inSub = new Int32Array(m).fill(-1), map = []; for (let w = 0; w < m; w++) if (zone[w] || held[w]) { inSub[w] = map.length; map.push(w); }
  const nZ = zone.reduce((a, b) => a + b, 0); if (!nZ) return { skipped: 'empty zone' };
  const SP = subPattern9(g, Wg, Pw, inSub); if (!SP) return { skipped: 'weld order' }; const { Ts, metric, grain } = SP, ns = map.length, nt = Ts.length / 3;
  if (O.grainU) for (let j = 0; j < nt; j++) { grain[j * 2] = 1; grain[j * 2 + 1] = 0; }
  const rest = new Float64Array(ns * 3), pin = new Uint8Array(ns); for (let i = 0; i < ns; i++) { const w = map[i]; for (let c = 0; c < 3; c++) rest[i * 3 + c] = Pw[w * 3 + c]; pin[i] = zone[w] ? 0 : 1; }
  // LET OUT, NOT SPRUNG (settle9 rev 6's lesson): the bake's cloth is squeezed or stretched in its plane against the pattern (CLOTH8's
  // stages); given the pattern's lengths at once it springs (the first build of this pass: L12's stretch denim thrown up to the 8 cm
  // move cap on 4 550 of 5 576 vertices, 970 new self-crossings). So the metric goes from the bake's own lengths (each triangle's 3D
  // shape laid flat in its pattern triangle's frame) to the pattern's over the ramp, with the contact's push.
  const { metricB, bakeOverPattern } = ownMetric(rest, Ts, metric, pin), fab = fabricOf(g.fabric, O);
  // the foundations under the trousers (the briefs: group 'found'): the trousers lie on them as on the skin (L03 on G1: waist9's field
  // carried the trousers' front under the band in through the briefs, which then showed through a torn hole below the band)
  const fq = parts.filter(q => q.group === 'found' && q.T?.length); let fsurf = null;
  if (fq.length) { let nv = 0; const Xs = [], Tf = []; for (const q of fq) { const X = P(q); Xs.push(X); for (let t = 0; t < q.T.length; t++) Tf.push(q.T[t] + nv); nv += X.length / 3; }
    const Xf = new Float64Array(nv * 3); let o = 0; for (const X of Xs) { Xf.set(X, o); o += X.length; } fsurf = new SurfaceMesh(Xf, Int32Array.from(Tf), { cell: 0.02, boundary: false }); }
  const surfaces = fsurf ? (gap, mask) => [{ mesh: fsurf, gap: Math.max(gap, 0) + O.foundGap, mu: O.mu, reach: 0.03, garment: true, mask }] : null;
  const S = solveSeat9({ rest, Ts, pin, metric, metricB, grain, fab, bodySurf, surfaces, O, toPattern: 1 }), Xc = S.X;
  let moved = 0, mx = 0, capped = 0; for (let i = 0; i < ns; i++) { if (pin[i]) continue; const w = map[i]; let d = [Xc[i * 3] - Pw[w * 3], Xc[i * 3 + 1] - Pw[w * 3 + 1], Xc[i * 3 + 2] - Pw[w * 3 + 2]], l = Math.hypot(...d);
    if (!Number.isFinite(l)) continue; if (l > O.maxMove) { d = d.map(x => x * O.maxMove / l); l = O.maxMove; capped++; } for (let c = 0; c < 3; c++) Pw[w * 3 + c] += d[c]; moved++; mx = Math.max(mx, l); }
  const rep = { version: SEAT9_VERSION, fabric: g.fabric, yLoMm: +(yLo * 1000).toFixed(0), yHiMm: [+(yHiLo * 1000).toFixed(0), +(yHi * 1000).toFixed(0)], ring: band ? 'waistband' : 'top loop', zone: nZ, sim: ns, bakeOverPattern, tris: nt, inside: S.inside, moved, maxMm: +(mx * 1000).toFixed(1), capped,
    self: S.self, bendCm: +(fab.c * 100).toFixed(2), ms: Date.now() - t0 };
  log('seat9', g.name, JSON.stringify(rep));
  return rep;
}

// ---------------------------------------------------------------- the build's seat (rev 2): every garment, where the body under it changed
// a surface of pieces (posed metres) whose normals face away from the body (a garment's winding is not an outside: each vertex normal is
// turned to the side its closest skin point lies away from)
function outwardSurface(Xs, Ts, bodySurf) {
  let nv = 0; for (const X of Xs) nv += X.length / 3; const X = new Float64Array(nv * 3), T = []; let o = 0;
  for (let k = 0; k < Xs.length; k++) { X.set(Xs[k], o * 3); for (let t = 0; t < Ts[k].length; t++) T.push(Ts[k][t] + o); o += Xs[k].length / 3; }
  const Ti = Int32Array.from(T), N = vertexNormals(X, Ti);
  for (let v = 0; v < nv; v++) { const q = bodySurf.closestAny(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], 0.12); if (!q) continue; const ox = X[v * 3] - q.px, oy = X[v * 3 + 1] - q.py, oz = X[v * 3 + 2] - q.pz;
    const s = ox * N[v * 3] + oy * N[v * 3 + 1] + oz * N[v * 3 + 2], s2 = q.nx * N[v * 3] + q.ny * N[v * 3 + 1] + q.nz * N[v * 3 + 2]; if ((Math.abs(s) > 1e-6 ? s : s2) < 0) for (let c = 0; c < 3; c++) N[v * 3 + c] = -N[v * 3 + c]; }
  return new SurfaceMesh(X, Ti, { cell: 0.02, normals: N, boundary: true });
}
const HEM9 = /(^|\.)hem($|\.)/;
// (rev 4) how far a band stands off the skin (mm: the 10th, 50th, 90th percentile of its vertices' distance to the skin)
function bandOff9(Pb, bodySurf) { const d = []; for (let v = 0; v < Pb.length / 3; v++) { const c = bodySurf.closestAny(Pb[v * 3], Pb[v * 3 + 1], Pb[v * 3 + 2], 0.08); if (c) d.push(c.d); } d.sort((a, b) => a - b);
  const pc = f => (d.length ? +(d[Math.floor(f * (d.length - 1))] * 1000).toFixed(1) : null); return { offMm: [pc(0.1), pc(0.5), pc(0.9)], n: d.length }; }
// (rev 4) a waistband's cut by the tailor's rule, on the body the person ends with (posed metres): the band's plane (its points' least
// spread), the tape of the ring of skin in that plane (ring9 from the skin nearest `bandRings` of its vertices round it: the median), x (1 +
// the draft's waist ease: tailor.js); its length now (its inner face in that plane, per 5 degrees round its centre); s = the cut / its length
// now. Described with it: the seam it is sewn on (the garment's top loop: its length in the pattern and as it lies, which the bake gathered
// into the band), the grade under it, how far it stands off the skin, the tape on X0
function bandCut9(Pb, G, Pw, gw, bodySurf, X1, X0, ET, O) {
  const nb = Pb.length / 3, TAU = 2 * Math.PI, C = [0, 0, 0]; let ylo = Infinity, yhi = -Infinity; for (let v = 0; v < nb; v++) { for (let c = 0; c < 3; c++) C[c] += Pb[v * 3 + c] / nb; ylo = Math.min(ylo, Pb[v * 3 + 1]); yhi = Math.max(yhi, Pb[v * 3 + 1]); }
  // the plane: the eigenvector of least spread (power iteration on trace x I - covariance)
  const Cv = [0, 0, 0, 0, 0, 0, 0, 0, 0]; for (let v = 0; v < nb; v++) { const d = [Pb[v * 3] - C[0], Pb[v * 3 + 1] - C[1], Pb[v * 3 + 2] - C[2]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Cv[i * 3 + j] += d[i] * d[j]; }
  const tr = Cv[0] + Cv[4] + Cv[8]; let nr = [0, 1, 0]; for (let it = 0; it < 60; it++) { const x = [0, 1, 2].map(i => tr * nr[i] - (Cv[i * 3] * nr[0] + Cv[i * 3 + 1] * nr[1] + Cv[i * 3 + 2] * nr[2])), l = Math.hypot(...x) || 1; nr = x.map(a => a / l); }
  if (nr[1] < 0) nr = nr.map(a => -a);
  const a0 = Math.abs(nr[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; let u = [nr[1] * a0[2] - nr[2] * a0[1], nr[2] * a0[0] - nr[0] * a0[2], nr[0] * a0[1] - nr[1] * a0[0]]; const ul = Math.hypot(...u) || 1; u = u.map(a => a / ul);
  const w3 = [nr[1] * u[2] - nr[2] * u[1], nr[2] * u[0] - nr[0] * u[2], nr[0] * u[1] - nr[1] * u[0]];
  // its length now: the inner face in its plane
  const NB = 72, rin = new Float64Array(NB).fill(Infinity), pin2 = new Array(NB);
  for (let v = 0; v < nb; v++) { const d = [Pb[v * 3] - C[0], Pb[v * 3 + 1] - C[1], Pb[v * 3 + 2] - C[2]], a = d[0] * u[0] + d[1] * u[1] + d[2] * u[2], b = d[0] * w3[0] + d[1] * w3[1] + d[2] * w3[2], r = Math.hypot(a, b), j = Math.floor(((Math.atan2(b, a) + TAU) % TAU) / TAU * NB) % NB; if (r < rin[j]) { rin[j] = r; pin2[j] = [a, b]; } }
  const pts = pin2.filter(Boolean); let Lband = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; Lband += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  // the tailor's tape in that plane, on the final body (and on X0, the same skin)
  const T1 = [], T0 = []; if (ET) for (let k = 0; k < O.bandRings; k++) { const v = Math.floor((k + 0.5) / O.bandRings * nb), c = bodySurf.closestAny(Pb[v * 3], Pb[v * 3 + 1], Pb[v * 3 + 2], 0.1); if (!c || c.tri < 0) continue;
    const r = ring9(X1, X0 || X1, ET.T, ET.n, ET.E, c.tri, [c.px, c.py, c.pz], nr); if (!r || r.tape1 < 0.3 || r.tape1 > 3) continue; T1.push(r.tape1); T0.push(r.tape0); }
  const med = A => { const B = A.slice().sort((a, b) => a - b); return B.length ? B[B.length >> 1] : null; }, tape1 = med(T1), tape0 = X0 ? med(T0) : null;
  const ease = easeFor('trousers', { mm: {} }, { fit: O.bandFit }).waistEase ?? 0.02, cut = tape1 ? tape1 * (1 + ease) : null, s = cut && Lband > 0 ? cut / Lband : 1;
  // described: the seam (the garment's highest closed loop: its edges' lengths in the pattern, and as it lies), the cloth under the band
  const q = G.q, Wg = G.Wg, m = Wg.m; let top = null; for (const Lp of Wg.loops || []) { if (!Lp.closed || Lp.ids.length < 8) continue; let cy = 0; for (const w of Lp.ids) cy += Pw[w * 3 + 1]; cy /= Lp.ids.length; if (!top || cy > top.cy) top = { ids: Lp.ids, cy }; }
  let Lseam = 0, L3 = 0, miss = 0; if (top && q.uv) { const eL = new Map(); for (let t = 0; t < q.T.length; t += 3) for (let k = 0; k < 3; k++) { const i = q.T[t + k], j = q.T[t + (k + 1) % 3], a = Wg.wid[i], b = Wg.wid[j]; if (a !== b) eL.set(a < b ? a * m + b : b * m + a, Math.hypot(q.uv[i * 2] - q.uv[j * 2], q.uv[i * 2 + 1] - q.uv[j * 2 + 1])); }
    const ids = top.ids; for (let k = 0; k < ids.length; k++) { const a = ids[k], b = ids[(k + 1) % ids.length], l = eL.get(a < b ? a * m + b : b * m + a); if (l == null) miss++; else Lseam += l; L3 += Math.hypot(Pw[b * 3] - Pw[a * 3], Pw[b * 3 + 1] - Pw[a * 3 + 1], Pw[b * 3 + 2] - Pw[a * 3 + 2]); } }
  const near = nearSet([Pb], O.bandStitch), under = []; let gs = 0; for (let w = 0; w < m; w++) if (near(Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2])) { under.push(w); gs += gw ? gw[w] : 1; } const gB = under.length ? gs / under.length : 1;
  const cm = x => (x == null ? null : +(x * 100).toFixed(1));
  return { s, Lband, under, cut, L3, top: top ? top.ids : [], rep: { lengthCm: cm(Lband), tapeCm: cm(tape1), tape0Cm: cm(tape0), rings: T1.length, ease, cutCm: cm(cut), s: +s.toFixed(3), tiltDeg: +(Math.acos(Math.min(1, Math.abs(nr[1]))) * 180 / Math.PI).toFixed(1),
    seamCm: cm(Lseam), seam3dCm: cm(L3), seamMiss: miss, grade: +gB.toFixed(3), heightCm: cm(yhi - ylo), ...bandOff9(Pb, bodySurf) } };
}
// S: { gar: [{ q, Wg }] (q: a garment record: X bind metres, T, SI, SW, uv, panel, owner, fabric, name), sewn: [{ q, g }] (construction on
// a garment), found: [q], M, scale, body: { X (posed metres), T }, body0: { X } | null (the body when the parts were attached, posed),
// order: [owner | name ...] inner -> outer, O, log } -> { rep, changed: Map(q -> Uint8Array of moved vertices) }
export function seatGarments9(S) {
  const O = { ...SEAT9, ...SEATP9, ...(S.O || {}) }, log = S.log || (() => {}), t0 = Date.now(), { M, scale } = S;
  const posed = new Map(), Pq = q => { if (!posed.has(q)) posed.set(q, skinPose(Float64Array.from(q.X, x => x / scale), q.SI, q.SW, M, new Float64Array(q.X.length), scale)); return posed.get(q); };
  const bodySurf = new SurfaceMesh(S.body.X, S.body.T, { cell: 0.02, boundary: false }), bodySurf0 = S.body0 ? new SurfaceMesh(S.body0.X, S.body.T, { cell: 0.02, boundary: false }) : null;
  const fq = (S.found || []).filter(q => q.T?.length), fsurf = fq.length ? outwardSurface(fq.map(Pq), fq.map(q => q.T), bodySurf) : null;
  // (rev 4) a garment with a waistband is carried by it when the seat moves it: its band, belt loops and waist button then ride its cloth, not held
  const WB9 = /^waistband$/, ONBAND9 = /^(waistband|beltloops|button\.waist)$/, wbOf = new Map(); if (O.band) for (const s of S.sewn) if (WB9.test(s.q.name) && s.q.T?.length) wbOf.set(s.g, s.q);
  // the bands' neighbourhoods held (rev 2-3): for every garment near every band; (rev 4) not near a waistband, its belt loops and its waist
  // button (the band is cloth in the solve: it grips what is under it, the garment it is sewn on and a shirt tucked under it alike)
  const bandsAll = S.sewn.filter(s => BANDS8.test(s.q.name)).map(s => s.q), nearBand = bandsAll.length ? nearSet(bandsAll.map(Pq), O.bandNear) : null;
  const bandsC = S.sewn.filter(s => BANDS8.test(s.q.name) && !(wbOf.has(s.g) && ONBAND9.test(s.q.name))).map(s => s.q), nearBandC = bandsC.length ? nearSet(bandsC.map(Pq), O.bandNear) : null;
  const hb = (G, x, y, z) => { if (!O.holdBands) return false; const f = wbOf.size ? nearBandC : nearBand; return !!(f && f(x, y, z)); };
  const rank = g => { const i = (S.order || []).findIndex(k => k === g.q.owner || k === g.q.name); return i < 0 ? 99 : i; };
  const gar = S.gar.filter(x => x.q.uv && x.q.panel).sort((a, b) => rank(a) - rank(b)), noPattern = S.gar.filter(x => !(x.q.uv && x.q.panel)).map(x => x.q.name);
  // the welded posed cloth (each garment), the state before, the sewn parts' binds
  const Pws = new Map(), pre = new Map(); for (const G of gar) { const Pp = Pq(G.q), Pw = new Float64Array(G.Wg.m * 3); for (let w = 0; w < G.Wg.m; w++) for (let c = 0; c < 3; c++) Pw[w * 3 + c] = Pp[G.Wg.rep[w] * 3 + c]; Pws.set(G, Pw); pre.set(G, Float64Array.from(Pw)); }
  const rep = { version: SEAT9_VERSION, garments: {}, found: fq.length, bands: bandsAll.length, x0: !!bodySurf0, ...(noPattern.length ? { noPattern } : {}) };
  // (1) the seeds, each garment: where the body under its cloth changed (the depth: how far, for the zone's reach)
  // the bands (waistband, cuffs): with holdBands their cloth stays where it is (the bake's stage: the band the trousers hang from); at build the
  // body under a band moves too (L06: 151 'trousers x waistband' crossings when the cloth below a held band went out with the hip), so by default
  // the band's cloth is cloth like any other and the band, sewn on it, follows it (carry8)
  const holdB = !!(O.holdBands && nearBand), seeds = new Map(); let deepest = 0;
  // COVERED CLOTH STAYS: an inner garment's cloth under an outer garment (within `coverReach` of its cloth: the tucked tee's tail inside the
  // trousers, the tee under the jacket) is not seen, and a local solve has nothing to grip it with (xpbd's cloth-on-cloth contact has no
  // friction: L06's tucked tail, freed, slid 18-20 cm down inside the leg); it is held, and the outer layer over it carries the seat
  const covered = new Map(); for (const G of gar) { const outer = gar.filter(H => rank(H) > rank(G)); const cv = new Uint8Array(G.Wg.m); covered.set(G, cv); if (!outer.length) continue;
    const near = nearSet(outer.map(H => Pws.get(H)), O.coverReach), Pw = Pws.get(G); for (let w = 0; w < G.Wg.m; w++) if (near(Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2])) cv[w] = 1; }
  for (const G of gar) { const Pw = Pws.get(G), m = G.Wg.m, sd = new Float64Array(m).fill(-1), cv = covered.get(G); let sIn = 0, sFound = 0, sOff = 0;
    for (let w = 0; w < m; w++) { const x = Pw[w * 3], y = Pw[w * 3 + 1], z = Pw[w * 3 + 2]; if (hb(G, x, y, z) || cv[w]) continue;
      const c1 = bodySurf.closestAny(x, y, z, O.reach); if (!c1) continue;
      if (c1.d < -O.insideTol) { sd[w] = -c1.d; sIn++; continue; }
      if (fsurf) { const cf = fsurf.closest(x, y, z, 0.02); if (cf && !cf.edge && cf.d < -O.foundTol) { sd[w] = -cf.d; sFound++; continue; } }
      if (bodySurf0) { const c0 = bodySurf0.closestAny(x, y, z, O.reach); if (c0 && c0.d < O.contact && c1.d - c0.d > O.withdraw) { sd[w] = c1.d - c0.d; sOff++; } } }
    for (let w = 0; w < m; w++) if (sd[w] > deepest) deepest = Math.min(sd[w], O.maxMove);
    seeds.set(G, sd); rep.garments[G.q.name] = { seeds: { insideSkin: sIn, insideFound: sFound, withdrawn: sOff } }; }
  // (1b, rev 3) THE CUT FOR THE BODY IT IS WORN ON (grade9.js): each garment's weft graded by the tape of the skin under it, X1 over X0;
  // where the grade moved more than `gradeTol` the cloth is a seed too (its cut no longer fits the body there, whether or not it is inside
  // the skin: L06's v9o chinos lie OUT of her skin, stretched over it); its reach is the radius the tape grew or shrank by
  const grades = new Map();
  let ET9 = null; const getET = () => ET9 || (ET9 = edgeTris9(S.body.T, S.body.X));
  if (O.hang && bodySurf0) { const tg = Date.now(), ET = getET(), B = { X1: S.body.X, X0: S.body0.X, surf: bodySurf, ET };
    for (const G of gar) { const Pw = Pws.get(G), r = gradeGarment9({ q: G.q, Wg: G.Wg, Pw, Pp: Pq(G.q), body: B, O: O.grade }), sd = seeds.get(G), cv = covered.get(G); let k = 0;
      for (let w = 0; w < G.Wg.m; w++) { const dg = Math.abs(r.g[w] - 1); if (sd[w] >= 0 || dg <= O.gradeTol || cv[w] || hb(G, Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2])) continue; sd[w] = Math.max(0.002, dg * r.P0[w] / (2 * Math.PI)); k++; }
      for (let w = 0; w < G.Wg.m; w++) if (sd[w] > deepest) deepest = Math.min(sd[w], O.maxMove);
      grades.set(G, r.g); rep.garments[G.q.name].seeds.graded = k; rep.garments[G.q.name].grade = r.stats; }
    rep.gradeMs = Date.now() - tg; }
  // (2) the layers move together, OUTWARD: an outer garment's cloth within `layerReach` of an inner garment's seed is a seed too (the trousers
  // over the tucked tee's tail the hip pushed out; the jacket over the tee). Not inward: the trousers going out leave the tail where it is (a
  // tail freed by the trousers' seeds slid 20 cm down inside the leg: nothing in a local solve grips it as the band and the tuck do)
  for (const G of gar) { const pts = []; for (const H of gar) { if (rank(H) >= rank(G)) continue; const Pw = Pws.get(H), sd = seeds.get(H); for (let w = 0; w < H.Wg.m; w++) if (sd[w] > 0) pts.push(Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]); }
    let k = 0; if (pts.length) { const near = nearSet([Float64Array.from(pts)], O.layerReach), Pw = Pws.get(G), sd = seeds.get(G);
      for (let w = 0; w < G.Wg.m; w++) if (sd[w] < 0 && !hb(G, Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]) && near(Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2])) { sd[w] = 0; k++; } }
    rep.garments[G.q.name].seeds.layer = k; }
  // (2b, c6 it3) THE BAND MEASURED (bandCut9, every waistband, every seat: describes): its length, the tailor's cut at its line, the seam it
  // is sewn on. With the band arm (`band: true`): a garment the seat moves is carried by its band; the cloth under the band is a seed, its
  // reach the radius by which the band's length changes; the band GRIPS what lies under it (every garment's cloth within `bandUnder`: a seed,
  // not held as covered: stitched to the band below)
  const carried = new Map();
  for (const s of S.sewn) { if (!WB9.test(s.q.name) || !s.q.T?.length) continue; const G = gar.find(x => x.q === s.g); if (!G) continue;
    let bc; try { bc = bandCut9(Pq(s.q), G, Pws.get(G), grades.get(G), bodySurf, S.body.X, S.body0?.X || null, getET(), O); } catch (e) { rep.garments[G.q.name].band = { error: String(e?.message || e) }; continue; } rep.garments[G.q.name].band = bc.rep;
    if (!wbOf.has(G.q)) continue; const sd = seeds.get(G), cv = covered.get(G); let nS = 0; for (let w = 0; w < G.Wg.m; w++) if (sd[w] >= 0) nS++; if (nS < O.minSeeds) continue;
    const dR = Math.max(0.002, Math.abs(bc.s - 1) * bc.Lband / (2 * Math.PI)); let k = 0;
    for (const w of bc.under) if (!cv[w] && sd[w] < dR) { sd[w] = dR; k++; }
    if (dR > deepest) deepest = Math.min(dR, O.maxMove); carried.set(G, { q: s.q, s: bc.s }); rep.garments[G.q.name].seeds.band = k;
    const nearU = nearSet([Pq(s.q)], O.bandUnder); for (const H of gar) { if (H === G) continue; const Pw = Pws.get(H), sh = seeds.get(H), ch = covered.get(H); let kg = 0;
      for (let w = 0; w < H.Wg.m; w++) if (nearU(Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2])) { ch[w] = 0; if (sh[w] < dR) sh[w] = dR; kg++; } if (kg) rep.garments[H.q.name].seeds.gripped = kg; } }
  // (3) each garment's zone: the cloth within R of a seed along the cloth (R grows with how far the body moved: the cloth must have room to
  // follow a 7 cm hip without shearing at the zone's edge), the next `holdW` held, the bands held; then ONE solve of every garment's zone
  const rOf = d => Math.min(O.zoneMax, Math.max(O.zoneMin, O.zoneK * d)); rep.zoneCm = +(rOf(deepest) * 100).toFixed(1); rep.deepestMm = +(deepest * 1000).toFixed(1);
  const subs = [];
  for (const G of gar) { const g = G.q, Wg = G.Wg, Pw = Pws.get(G), m = Wg.m, sd = seeds.get(G), gr = rep.garments[g.name]; let nSeed = 0; for (let w = 0; w < m; w++) if (sd[w] >= 0) nSeed++;
    if (nSeed < O.minSeeds) { gr.skipped = 'nothing to seat'; continue; }
    const A = adjacency(Wg.T, m), dist = new Float64Array(m).fill(Infinity), heap = []; const push = (w, d) => { if (d >= dist[w]) return; dist[w] = d; heap.push([d, w]); };
    // each seed reaches as far as its own depth asks (rOf): the distance runs from minus that reach, the zone is where it is <= 0
    for (let w = 0; w < m; w++) if (sd[w] >= 0) push(w, -rOf(sd[w]));
    while (heap.length) { let bi = 0; for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[bi][0]) bi = i; const [d, w] = heap[bi]; heap[bi] = heap[heap.length - 1]; heap.pop(); if (d > dist[w] || d > O.holdW) continue;
      for (const u of A.nb[w]) push(u, d + Math.hypot(Pw[u * 3] - Pw[w * 3], Pw[u * 3 + 1] - Pw[w * 3 + 1], Pw[u * 3 + 2] - Pw[w * 3 + 2])); }
    // THE EDGE IT HANGS FROM: a garment hangs from its highest closed edge (the trousers' waist, a top's neckline), held there by a band, a
    // drawstring, the shoulders; a local solve has none of those, so that edge and `supportHold` of cloth along it are held (L22's scrub
    // trousers, no band part: their top in the zone slid 29 cm down the hips)
    let top = null; for (const Lp of Wg.loops || []) { if (!Lp.closed || Lp.ids.length < 8) continue; let cy = 0; for (const w of Lp.ids) cy += Pw[w * 3 + 1]; cy /= Lp.ids.length; if (!top || cy > top.cy) top = { ids: Lp.ids, cy }; }
    const sup = new Float64Array(m).fill(Infinity); if (top && O.supportHold > 0 && !carried.has(G)) { const hq = []; for (const w of top.ids) { sup[w] = 0; hq.push(w); }
      while (hq.length) { const w = hq.shift(); for (const u of A.nb[w]) { const d = sup[w] + Math.hypot(Pw[u * 3] - Pw[w * 3], Pw[u * 3 + 1] - Pw[w * 3 + 1], Pw[u * 3 + 2] - Pw[w * 3 + 2]); if (d < sup[u] && d <= O.supportHold) { sup[u] = d; hq.push(u); } } } }
    const zone = new Uint8Array(m), held = new Uint8Array(m); let sHeld = 0;
    const cv = covered.get(G); let cHeld = 0;
    for (let w = 0; w < m; w++) { if (dist[w] > O.holdW) continue; const band = hb(G, Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]) || sup[w] <= O.supportHold || cv[w]; if (dist[w] <= 0 && !band) zone[w] = 1; else { held[w] = 1; if (dist[w] <= 0 && sup[w] <= O.supportHold) sHeld++; if (dist[w] <= 0 && cv[w]) cHeld++; } }
    gr.supportHeld = sHeld; gr.coveredHeld = cHeld;
    for (let t = 0; t < Wg.T.length; t += 3) { const v = [Wg.T[t], Wg.T[t + 1], Wg.T[t + 2]]; if (v.some(x => zone[x])) for (const x of v) if (!zone[x]) held[x] = 1; }
    const inSub = new Int32Array(m).fill(-1), map = []; for (let w = 0; w < m; w++) if (zone[w] || held[w]) { inSub[w] = map.length; map.push(w); }
    const SP = subPattern9(g, Wg, Pw, inSub); if (!SP) { gr.skipped = 'weld order'; continue; }
    const fab = fabricOf(g.fabric, O); gr.zone = zone.reduce((a, b) => a + b, 0); gr.sim = map.length; gr.fabric = g.fabric;
    subs.push({ G, map, zone, SP, fab, layer: rank(G) }); }
  if (!subs.length) { rep.ms = Date.now() - t0; return { rep, changed: new Map() }; }
  // THE BANDS IN THE SOLVE (not held: the body under a waistband moves too, and a band left where it was is cut by the cloth under it, the
  // tucked tee's tail and the trousers' top: L06's first runs, 151-313 'x waistband' crossings): a band (CLOTH8's BANDS8: waistband, cuffs,
  // hem bands) sewn on a garment whose zone reaches it is one more layer, whole, its own lengths (a closed interfaced band keeps its shape),
  // over the garment it is sewn on; self-contact with side memory keeps the layers under it under it
  const bandSubs = []; for (const b of S.sewn) { if (!b.q.T?.length) continue; const S0 = subs.find(x => x.G.q === b.g); if (!S0) continue; const cr = carried.get(S0.G);
    // (rev 4) the band that carries its garment: in the solve whatever the zone's reach (its cloth under it is seeded)
    if (cr && cr.q === b.q) { bandSubs.push({ q: b.q, P: Pq(b.q), fab: fabricOf(b.q.fabric || b.g.fabric, O), layer: S0.layer + 0.5, carry: S0, s: cr.s }); continue; }
    if (holdB || !O.bandsSolve.test(b.q.name)) continue;
    const Pw = Pws.get(S0.G), zp = []; for (let w = 0; w < S0.G.Wg.m; w++) if (S0.zone[w]) zp.push(Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]); const near = nearSet([Float64Array.from(zp)], O.layerReach), Pb = Pq(b.q), nb = Pb.length / 3; let k = 0;
    for (let v = 0; v < nb; v++) if (near(Pb[v * 3], Pb[v * 3 + 1], Pb[v * 3 + 2])) k++; if (k < O.bandFrac * nb) continue;
    bandSubs.push({ q: b.q, P: Pb, fab: fabricOf(b.q.fabric || b.g.fabric, O), layer: S0.layer + 0.5 }); }
  rep.bandsSolved = bandSubs.map(B => B.q.name);
  // the joint sub-mesh: every garment's particles and triangles, a fabric per triangle, a contact gap per particle (a layer over another
  // rests `layerGap` farther out: each garment's half thickness + the layers under it), the pattern's frames per triangle
  const layers = [...new Set([...subs.map(S => S.layer), ...bandSubs.map(B => B.layer)])].sort((a, b) => a - b), off = []; let ns = 0, nt = 0; for (const S of subs) { off.push(ns); ns += S.map.length; nt += S.SP.Ts.length / 3; }
  const offB = []; for (const B of bandSubs) { offB.push(ns); ns += B.P.length / 3; nt += B.q.T.length / 3; }
  const rest = new Float64Array(ns * 3), pin = new Uint8Array(ns), gapF = new Float64Array(ns), Ts = new Int32Array(nt * 3), metric = new Float64Array(nt * 6), grain = new Float64Array(nt * 2), triFab = new Uint8Array(nt), fabs = [...subs.map(S => S.fab), ...bandSubs.map(B => B.fab)];
  { let tt = 0; subs.forEach((S, k) => { const Pw = Pws.get(S.G), o0 = off[k], li = layers.indexOf(S.layer);
      for (let i = 0; i < S.map.length; i++) { const w = S.map[i]; for (let c = 0; c < 3; c++) rest[(o0 + i) * 3 + c] = Pw[w * 3 + c]; pin[o0 + i] = S.zone[w] ? 0 : 1; gapF[o0 + i] = O.gap + S.fab.h / 2 + li * O.layerGap; }
      const nT = S.SP.Ts.length / 3; for (let j = 0; j < nT; j++) { for (let c = 0; c < 3; c++) Ts[(tt + j) * 3 + c] = S.SP.Ts[j * 3 + c] + o0; triFab[tt + j] = k; }
      metric.set(S.SP.metric, tt * 6); grain.set(S.SP.grain, tt * 2); tt += nT; });
    // a band's triangles: its own shape laid flat is its metric (its own lengths), the grain along the first edge
    bandSubs.forEach((B, k) => { const o0 = offB[k], li = layers.indexOf(B.layer), nb = B.P.length / 3, T = B.q.T; for (let i = 0; i < nb; i++) { for (let c = 0; c < 3; c++) rest[(o0 + i) * 3 + c] = B.P[i * 3 + c]; pin[o0 + i] = 0; gapF[o0 + i] = O.gap + B.fab.h / 2 + li * O.layerGap; }
      // (rev 4) a carried band's triangles laid flat in the frame of the waist: x round the body (up x the radius from the band's centre,
      // in the triangle's plane), y across the band; its weft (grain x) runs round, and its cut (x s) is applied to x below
      let C0 = null; if (B.carry) { let cx = 0, cz = 0; for (let i = 0; i < nb; i++) { cx += B.P[i * 3]; cz += B.P[i * 3 + 2]; } C0 = [cx / nb, cz / nb]; }
      if (C0) { for (let j = 0; j < T.length / 3; j++) { const a = T[j * 3], b = T[j * 3 + 1], c = T[j * 3 + 2], e1 = [0, 1, 2].map(i => B.P[b * 3 + i] - B.P[a * 3 + i]), e2 = [0, 1, 2].map(i => B.P[c * 3 + i] - B.P[a * 3 + i]);
          let n3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const nl = Math.hypot(...n3) || 1; n3 = n3.map(x => x / nl);
          const rx = (B.P[a * 3] + B.P[b * 3] + B.P[c * 3]) / 3 - C0[0], rz = (B.P[a * 3 + 2] + B.P[b * 3 + 2] + B.P[c * 3 + 2]) / 3 - C0[1]; let t3 = [rz, 0, -rx]; const tn = t3[0] * n3[0] + t3[2] * n3[2]; t3 = t3.map((x, i) => x - tn * n3[i]);
          let tl = Math.hypot(...t3); if (tl < 1e-9) { t3 = e1.slice(); tl = Math.hypot(...t3) || 1; } t3 = t3.map(x => x / tl); const b3 = [n3[1] * t3[2] - n3[2] * t3[1], n3[2] * t3[0] - n3[0] * t3[2], n3[0] * t3[1] - n3[1] * t3[0]], dt = (e, f) => e[0] * f[0] + e[1] * f[1] + e[2] * f[2];
          Ts[(tt + j) * 3] = a + o0; Ts[(tt + j) * 3 + 1] = b + o0; Ts[(tt + j) * 3 + 2] = c + o0; triFab[tt + j] = subs.length + k; metric.set([0, 0, dt(e1, t3), dt(e1, b3), dt(e2, t3), dt(e2, b3)], (tt + j) * 6); grain[(tt + j) * 2] = 1; }
        tt += T.length / 3; return; }
      for (let j = 0; j < T.length / 3; j++) { const a = T[j * 3], b = T[j * 3 + 1], c = T[j * 3 + 2], d3 = (p, q) => Math.hypot(B.P[p * 3] - B.P[q * 3], B.P[p * 3 + 1] - B.P[q * 3 + 1], B.P[p * 3 + 2] - B.P[q * 3 + 2]);
        const lab = d3(a, b), lac = d3(a, c), lbc = d3(b, c), al = Math.acos(Math.max(-1, Math.min(1, (lab * lab + lac * lac - lbc * lbc) / (2 * lab * lac || 1))));
        Ts[(tt + j) * 3] = a + o0; Ts[(tt + j) * 3 + 1] = b + o0; Ts[(tt + j) * 3 + 2] = c + o0; triFab[tt + j] = subs.length + k; metric.set([0, 0, lab, 0, lac * Math.cos(al), lac * Math.sin(al)], (tt + j) * 6); grain[(tt + j) * 2] = 1; }
      tt += T.length / 3; }); }
  const { metricB, bakeOverPattern } = ownMetric(rest, Ts, metric, pin); rep.bakeOverPattern = bakeOverPattern; rep.sim = ns; rep.tris = nt; rep.layers = subs.map(S => S.G.q.name);
  // (rev 3) the cut the solve goes to: the cloth's own lengths (or toward the pattern's, `toPattern`), the weft (the pattern's u: the warp
  // runs along v, subPattern9) of each triangle x its grade (the mean of its corners'), about the triangle's centre; the bands keep their own
  const metricT = Float64Array.from(metricB, (m0, k) => m0 + (metric[k] - m0) * O.toPattern); let gradedTris = 0;
  if (grades.size) { let tt = 0; subs.forEach(S => { const gw = grades.get(S.G), nT = S.SP.Ts.length / 3;
      if (gw) for (let j = 0; j < nT; j++) { let gm = 0; for (let c = 0; c < 3; c++) gm += gw[S.map[S.SP.Ts[j * 3 + c]]]; gm /= 3; if (Math.abs(gm - 1) < 1e-4) continue;
        const o6 = (tt + j) * 6, cu = (metricT[o6] + metricT[o6 + 2] + metricT[o6 + 4]) / 3; for (let c = 0; c < 3; c++) metricT[o6 + c * 2] = cu + (metricT[o6 + c * 2] - cu) * gm; gradedTris++; }
      tt += nT; }); }
  rep.gradedTris = gradedTris;
  // (rev 4) a carried band's length round the body: the tailor's cut over its length now (bandCut9's s), about each triangle's centre, round the waist only
  { let tt = 0; for (const S of subs) tt += S.SP.Ts.length / 3; bandSubs.forEach(B => { const nT = B.q.T.length / 3; if (B.carry && Math.abs(B.s - 1) > 1e-4) for (let j = 0; j < nT; j++) { const o6 = (tt + j) * 6, cu = (metricT[o6] + metricT[o6 + 2] + metricT[o6 + 4]) / 3; for (let c = 0; c < 3; c++) metricT[o6 + c * 2] = cu + (metricT[o6 + c * 2] - cu) * B.s; } tt += nT; }); }
  // the bake's own tangles held (settle9 rev 6's rule, CLOTH8 resolve8's): cloth already crossing itself, and `tangleHold` round it, is not moved
  // (moving it spreads the tangle: L06's first build seat, 441 new self-crossings, the guard sent 1 187 vertices back)
  // (rev 4) THE BAND SEWN ON, GRIPPING: each band particle stitched to the nearest particle of its garment's cloth within `bandStitch`, at the
  // distance it stands (the band rides its seam allowance), and every garment's cloth within `bandUnder` of the band (the garment's top, a
  // tucked shirt) to the nearest band particle (sewn along, gripped: a band holding only the few cloth vertices nearest its own let the rest
  // of the top fall, node L03's first run); its rest dihedrals are its own (a rolled band keeps its section)
  const ntG = subs.reduce((a, S) => a + S.SP.Ts.length / 3, 0), nsG = offB.length ? offB[0] : ns, sewnP = new Uint8Array(ns);
  let stitch = null, RA = null;
  if (carried.size) { const pairs = [], Ls = [], key = (i, j, l) => `${i},${j},${l}`; RA = new Float64Array(ns).fill(O.restAngle);
    bandSubs.forEach((B, k) => { if (!B.carry) return; const o0 = offB[k], nb = B.P.length / 3, ks = subs.indexOf(B.carry), og = off[ks], ng = B.carry.map.length, r = O.bandStitch, H = new Map();
      for (let i = 0; i < nb; i++) { RA[o0 + i] = O.bandRestAngle; sewnP[o0 + i] = 1; }
      for (let i = 0; i < ng; i++) { const j = og + i, kk = key(Math.floor(rest[j * 3] / r), Math.floor(rest[j * 3 + 1] / r), Math.floor(rest[j * 3 + 2] / r)); (H.get(kk) || H.set(kk, []).get(kk)).push(j); }
      let got = 0, sumL = 0; for (let i = 0; i < nb; i++) { const a = o0 + i, x = rest[a * 3], y = rest[a * 3 + 1], z = rest[a * 3 + 2], ci = Math.floor(x / r), cj = Math.floor(y / r), ck = Math.floor(z / r); let best = -1, bd = r;
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) for (const j of H.get(key(ci + di, cj + dj, ck + dk)) || []) { const d = Math.hypot(rest[j * 3] - x, rest[j * 3 + 1] - y, rest[j * 3 + 2] - z); if (d < bd) { bd = d; best = j; } }
        if (best >= 0) { pairs.push(a, best); Ls.push(bd); got++; sumL += bd; sewnP[best] = 1; } }
      const ru = O.bandUnder, HB = new Map(); for (let i = 0; i < nb; i++) { const a = o0 + i, kk = key(Math.floor(rest[a * 3] / ru), Math.floor(rest[a * 3 + 1] / ru), Math.floor(rest[a * 3 + 2] / ru)); (HB.get(kk) || HB.set(kk, []).get(kk)).push(a); }
      const gripped = {}; subs.forEach((S2, k2) => { const o2 = off[k2]; let g2 = 0; for (let i = 0; i < S2.map.length; i++) { const j = o2 + i, x = rest[j * 3], y = rest[j * 3 + 1], z = rest[j * 3 + 2], ci = Math.floor(x / ru), cj = Math.floor(y / ru), ck = Math.floor(z / ru); let best = -1, bd = ru;
          for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) for (const a of HB.get(key(ci + di, cj + dj, ck + dk)) || []) { const d = Math.hypot(rest[a * 3] - x, rest[a * 3 + 1] - y, rest[a * 3 + 2] - z); if (d < bd) { bd = d; best = a; } }
          if (best >= 0) { pairs.push(best, j); Ls.push(bd); g2++; sewnP[j] = 1; } } if (g2) gripped[S2.G.q.name] = g2; });
      Object.assign(rep.garments[B.carry.G.q.name].band, { stitched: got, of: nb, stitchMm: got ? +(sumL / got * 1000).toFixed(1) : null, gripped }); });
    stitch = { pairs, L: Float64Array.from(Ls), alpha: O.bandAlpha }; }
  // (rev 4) a carried band and the cloth sewn to it are spared the tangle hold: their crossings (the band laid round crumpled cloth) are not
  // the cloth's own tangles, and a band pinned by them, or by the cloth it grips, cannot carry anything (c6-1 t5)
  const spare = t => carried.size > 0 && t >= ntG;
  { const L0 = []; selfIntersections(rest, Ts, { list: L0 }); const tv = new Set(); let spared = 0; for (let i = 0; i + 1 < L0.length; i += 2) { if (spare(L0[i]) || spare(L0[i + 1])) { spared++; continue; } for (const t of [L0[i], L0[i + 1]]) for (let c = 0; c < 3; c++) tv.add(Ts[t * 3 + c]); }
    let held = 0; if (tv.size && O.tangleHold > 0) { const near = nearSet([Float64Array.from([...tv].flatMap(v => [rest[v * 3], rest[v * 3 + 1], rest[v * 3 + 2]]))], O.tangleHold);
      for (let i = 0; i < ns; i++) if (!pin[i] && !sewnP[i] && near(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2])) { pin[i] = 1; held++; } } rep.tangles = { pairs: L0.length / 2, held, ...(spared ? { sparedBand: spared } : {}) }; }
  const extra = fsurf ? [{ mesh: fsurf, fin: Float64Array.from(gapF, g => g + O.foundGap), reach: 0.03, garment: true }] : null;
  const grav = O.gravity || (O.hang ? null : [0, 0, 0]); rep.gravity = grav ? grav : 'g';
  const RS = solveSeat9({ rest, Ts, pin, metric: metricT, metricB, grain, fab: fabs[0], fabs, triFab, gapF, bodySurf, extra, O: { ...O, gravity: grav, rampEach: true, ramp: O.rampB }, toPattern: 1, T: O.T, stitch, restAngle: RA }), Xc = RS.X;
  rep.inside = RS.inside; rep.self = RS.self; let anyMoved = false;
  subs.forEach((S, k) => { const Pw = Pws.get(S.G), o0 = off[k], gr = rep.garments[S.G.q.name]; let moved = 0, mx = 0, capped = 0;
    const far = { n: 0, y: [], dy: 0 };
    for (let i = 0; i < S.map.length; i++) { if (pin[o0 + i]) continue; const w = S.map[i], j = o0 + i; let d = [Xc[j * 3] - Pw[w * 3], Xc[j * 3 + 1] - Pw[w * 3 + 1], Xc[j * 3 + 2] - Pw[w * 3 + 2]], l = Math.hypot(...d);
      if (!Number.isFinite(l) || l < 1e-6) continue; if (l > 0.04) { far.n++; far.y.push(Pw[w * 3 + 1]); far.dy += d[1]; } if (l > O.maxMove) { d = d.map(x => x * O.maxMove / l); l = O.maxMove; capped++; } for (let c = 0; c < 3; c++) Pw[w * 3 + c] += d[c]; moved++; mx = Math.max(mx, l); }
    if (moved) anyMoved = true; far.y.sort((a, b) => a - b);
    Object.assign(gr, { moved, maxMm: +(mx * 1000).toFixed(1), capped, over4cm: far.n ? { n: far.n, yCm: [far.y[0], far.y[far.y.length >> 1], far.y[far.y.length - 1]].map(y => +(y * 100).toFixed(1)), meanDyMm: +(far.dy / far.n * 1000).toFixed(1) } : 0 }); });
  const bandP = new Map(), bandOwner = new Map(bandSubs.filter(B => B.carry).map(B => [B.q, B.carry.G.q])); bandSubs.forEach((B, k) => { const o0 = offB[k], nb = B.P.length / 3, Pn = Float64Array.from(B.P); let mx = 0;
    for (let i = 0; i < nb; i++) { const j = o0 + i; let d = [Xc[j * 3] - B.P[i * 3], Xc[j * 3 + 1] - B.P[i * 3 + 1], Xc[j * 3 + 2] - B.P[i * 3 + 2]], l = Math.hypot(...d); if (!Number.isFinite(l)) continue; if (l > O.maxMove) d = d.map(x => x * O.maxMove / l); for (let c = 0; c < 3; c++) Pn[i * 3 + c] += d[c]; mx = Math.max(mx, Math.min(l, O.maxMove)); }
    if (mx > 1e-6) { bandP.set(B.q, Pn); anyMoved = true; } });
  rep.msSolve = Date.now() - t0; log('seat9 build', JSON.stringify({ zoneCm: rep.zoneCm, deepestMm: rep.deepestMm, sim: ns, tris: nt, garments: rep.garments, inside: rep.inside, self: rep.self, ms: rep.msSolve }));
  if (!anyMoved) { rep.ms = Date.now() - t0; return { rep, changed: new Map() }; }
  // the garments back to bind (the vertices that moved), what is sewn on them carried (CLOTH8's carry8, bound before the seat)
  const binds = S.sewn.filter(s => !bandP.has(s.q)).map(s => ({ ...s, B: bind8(Pq(s.q), Pq(s.g), s.g.T) })), X0 = new Map([...gar.map(G => G.q), ...S.sewn.map(s => s.q)].map(q => [q, Float64Array.from(q.X)])), Q0 = new Map([...gar.map(G => G.q), ...S.sewn.map(s => s.q), ...fq].map(q => [q, Pq(q)]));
  const differs = (A, B, i) => Math.abs(A[i * 3] - B[i * 3]) + Math.abs(A[i * 3 + 1] - B[i * 3 + 1]) + Math.abs(A[i * 3 + 2] - B[i * 3 + 2]) > 2e-6;
  let changed = new Map();
  const commit = () => { changed = new Map();
    for (const [q, X] of X0) { q.X.set(X); posed.set(q, Q0.get(q)); }
    for (const G of gar) { const g = G.q, Wg = G.Wg, Pw = Pws.get(G), P0 = Q0.get(g), n = g.X.length / 3, mv = new Uint8Array(n), Pn = Float64Array.from(P0); let k = 0;
      for (let i = 0; i < n; i++) { const w = Wg.wid[i]; if (Math.abs(Pw[w * 3] - P0[i * 3]) + Math.abs(Pw[w * 3 + 1] - P0[i * 3 + 1]) + Math.abs(Pw[w * 3 + 2] - P0[i * 3 + 2]) > 2e-6) { mv[i] = 1; k++; for (let c = 0; c < 3; c++) Pn[i * 3 + c] = Pw[w * 3 + c]; } }
      if (!k) continue; toBindQ(g, Pn, M, scale, mv); posed.delete(g); changed.set(g, mv); }
    for (const [q, Pn] of bandP) { const mv = new Uint8Array(Pn.length / 3).fill(1); toBindQ(q, Pn, M, scale, mv); posed.delete(q); changed.set(q, mv); }
    for (const { q, g, B } of binds) { const mv = changed.get(g); if (!mv) continue; const old = Q0.get(q), Xq = Float64Array.from(old); place8(B, Pq(g), g.T, Xq, mv);
      const only = new Uint8Array(Xq.length / 3); let c2 = 0; for (let v = 0; v < only.length; v++) if (differs(Xq, old, v)) { only[v] = 1; c2++; }
      if (c2) { toBindQ(q, Xq, M, scale, only); posed.delete(q); changed.set(q, only); } } };
  commit();
  // THE GUARD (the driver's construction guard): every piece round the moved cloth, before vs now, as one mesh; a crossing the seat made
  // sends the moved garment cloth under it back toward where it was, in blended rings, then the commit again (a hem follows its cloth: no blame)
  const pieces = [...gar.map(G => G.q), ...S.sewn.map(s => s.q), ...fq].filter(q => q.T?.length), garOf = new Map(gar.map(G => [G.q, G])), bindOf = new Map(binds.map(b => [b.q, b]));
  const guard = { rounds: 0, reverted: 0, newPairs: [] };
  for (let round = 0; round <= O.guard && O.guard > 0; round++) {
    const ch = new Map(); let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const q of pieces) { const A0 = Q0.get(q), Bq = Pq(q), n = A0.length / 3, c = new Uint8Array(n); let k = 0; if (A0 !== Bq) for (let v = 0; v < n; v++) if (differs(A0, Bq, v)) { c[v] = 1; k++; for (const X of [A0, Bq]) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], X[v * 3 + d]); hi[d] = Math.max(hi[d], X[v * 3 + d]); } } if (k) ch.set(q, c); }
    if (!ch.size) break; lo = lo.map(x => x - 0.03); hi = hi.map(x => x + 0.03);
    const inBox = (X, v) => X[v * 3] >= lo[0] && X[v * 3] <= hi[0] && X[v * 3 + 1] >= lo[1] && X[v * 3 + 1] <= hi[1] && X[v * 3 + 2] >= lo[2] && X[v * 3 + 2] <= hi[2];
    let nv = 0; const offs = new Map(), tsel = [], owner = []; for (const q of pieces) { offs.set(q, nv); const A0 = Q0.get(q), Bq = Pq(q), T = q.T; for (let t = 0; t < T.length; t += 3) { let inb = false; for (let k = 0; k < 3 && !inb; k++) inb = inBox(A0, T[t + k]) || inBox(Bq, T[t + k]); if (inb) { tsel.push(T[t] + nv, T[t + 1] + nv, T[t + 2] + nv); owner.push([q, t / 3]); } } nv += A0.length / 3; }
    const Tc = Int32Array.from(tsel), XA = new Float64Array(nv * 3), XB = new Float64Array(nv * 3); for (const q of pieces) { XA.set(Q0.get(q), offs.get(q) * 3); XB.set(Pq(q), offs.get(q) * 3); }
    const LA = [], LB = [], wid = weldIds(XA); selfIntersections(XA, Tc, { list: LA, wid }); selfIntersections(XB, Tc, { list: LB, wid }); const was = new Set(); for (let i = 0; i < LA.length; i += 2) was.add(LA[i] * 1e7 + LA[i + 1]);
    const back = new Map(), backB = new Map(); let nNew = 0, nHem = 0; const kinds = {}; const addBack = (G, w) => (back.get(G) || back.set(G, new Set()).get(G)).add(w);
    const blame = (q, tq) => { const c = ch.get(q); if (!c) return; const T = q.T, vs = [T[tq * 3], T[tq * 3 + 1], T[tq * 3 + 2]].filter(v => c[v]); if (!vs.length) return;
      // (rev 4) a band the seat solved goes back as cloth does
      if (bandP.has(q)) { const st = backB.get(q) || backB.set(q, new Set()).get(q); for (const v of vs) st.add(v); return; }
      const G = garOf.get(q); if (G) { const Pw = Pws.get(G), p0 = pre.get(G); for (const v of vs) { const w = G.Wg.wid[v]; if (differs(Pw, p0, w)) addBack(G, w); } return; }
      const bd = bindOf.get(q); if (!bd) return; const Gb = garOf.get(bd.g), Pw = Pws.get(Gb), p0 = pre.get(Gb); for (const v of vs) { const tb = bd.B.tri[v]; if (tb < 0) continue; for (let k = 0; k < 3; k++) { const w = Gb.Wg.wid[bd.g.T[tb * 3 + k]]; if (differs(Pw, p0, w)) addBack(Gb, w); } } };
    const isHem = q => !garOf.has(q) && HEM9.test(q.name || ''), ownerOf = q => bindOf.get(q)?.g || bandOwner.get(q);
    let nSewn = 0;
    for (let i = 0; i < LB.length; i += 2) { if (was.has(LB[i] * 1e7 + LB[i + 1])) continue; const [qa, ta] = owner[LB[i]], [qb, tb] = owner[LB[i + 1]];
      if (isHem(qa) || isHem(qb)) { nHem++; continue; }
      // two parts sewn on the same garment (a pocket and its stitching, a coin pocket and its edge) ride the same cloth: their crossing is
      // the carry's offset, a fraction of a millimetre, not the cloth's; it sends nothing back (L08: 181 'pocket x its stitches' pairs
      // reverted the jeans into the hip)
      if (qa !== qb && ownerOf(qa) && ownerOf(qa) === ownerOf(qb)) { nSewn++; continue; }
      nNew++; const kk = qa === qb ? qa.name + ' self' : [qa.name, qb.name].sort().join(' x '); kinds[kk] = (kinds[kk] || 0) + 1; blame(qa, ta); blame(qb, tb); }
    if (nHem) kinds['hem (no blame)'] = nHem; if (nSewn) kinds['sewn on one garment (no blame)'] = nSewn;
    guard.newPairs.push({ round, n: nNew, kinds }); log('seat9 build guard round', round, 'new crossings', nNew, JSON.stringify(kinds));
    if (!nNew || round === O.guard) break; let any = 0;
    for (const [q, vs] of backB) { const Pn = bandP.get(q), P0 = Q0.get(q), A0 = adjacency(q.T, Pn.length / 3), ring = new Map(); let lvl = [...vs]; for (const v of lvl) ring.set(v, O.guardRings[0]);
      for (let li = 1; li < O.guardRings.length; li++) { const nx = []; for (const v of lvl) for (const u of A0.nb[v]) if (!ring.has(u) && differs(Pn, P0, u)) { ring.set(u, O.guardRings[li]); nx.push(u); } lvl = nx; }
      for (const [v, f] of ring) for (let c = 0; c < 3; c++) Pn[v * 3 + c] += (P0[v * 3 + c] - Pn[v * 3 + c]) * f; any += ring.size; }
    for (const [G, ws] of back) { const Pw = Pws.get(G), p0 = pre.get(G), A0 = adjacency(G.Wg.T, G.Wg.m), ring = new Map(); let lvl = [...ws]; for (const w of lvl) ring.set(w, O.guardRings[0]);
      for (let li = 1; li < O.guardRings.length; li++) { const nx = []; for (const w of lvl) for (const u of A0.nb[w]) if (!ring.has(u) && differs(Pw, p0, u)) { ring.set(u, O.guardRings[li]); nx.push(u); } lvl = nx; }
      for (const [w, f] of ring) for (let c = 0; c < 3; c++) Pw[w * 3 + c] += (p0[w * 3 + c] - Pw[w * 3 + c]) * f; any += ring.size; }
    if (!any) break; guard.rounds++; guard.reverted += any; commit(); }
  rep.guard = guard;
  // what is still inside the skin after the guard (describes)
  { let inside = 0, tot = 0; for (const G of gar) { const mv = changed.get(G.q); if (!mv) continue; const X = Pq(G.q); for (let i = 0; i < mv.length; i++) { if (!mv[i]) continue; tot++; const c = bodySurf.closestAny(X[i * 3], X[i * 3 + 1], X[i * 3 + 2], 0.05); if (c && c.d < 0) inside++; } } rep.movedVerts = tot; rep.movedInside = inside; }
  rep.bandsMoved = {}; for (const b of S.sewn) { if (!BANDS8.test(b.q.name)) continue; const A0 = Q0.get(b.q), B1 = Pq(b.q); let dy = 0, dr = 0, n = A0.length / 3; for (let v = 0; v < n; v++) { dy += B1[v * 3 + 1] - A0[v * 3 + 1]; dr += Math.hypot(B1[v * 3] - A0[v * 3], B1[v * 3 + 1] - A0[v * 3 + 1], B1[v * 3 + 2] - A0[v * 3 + 2]); }
    if (dr > 0) rep.bandsMoved[b.q.name] = { dyMm: +(dy / n * 1000).toFixed(1), meanMm: +(dr / n * 1000).toFixed(1) }; }
  for (const [G, cr] of carried) { const b = rep.garments[G.q.name].band; if (b) b.after = bandOff9(Pq(cr.q), bodySurf); }
  rep.posed = posed; rep.ms = Date.now() - t0;
  return { rep, changed };
}
// bind metres from posed (the inverse of each vertex's own blend; CLOTH8's toBind without its 0.1 mm rounding: a build's part keeps float precision)
function toBindQ(q, Pp, M, scale, only) { const tmp = [0, 0, 0]; for (let v = 0; v < q.X.length / 3; v++) { if (only && !only[v]) continue; blendInverse(q.SI, q.SW, v, M, Pp[v * 3] / scale, Pp[v * 3 + 1] / scale, Pp[v * 3 + 2] / scale, tmp, 0); for (let c = 0; c < 3; c++) q.X[v * 3 + c] = tmp[c] * scale; } }

// the built person: the parts as SkinnedMeshes (person/core.js partMesh2: position = bind metres / scale; userData.k3), P.bake's records
// (the bake the person was built from: uv, panel, owner, fabric, the weld) in the same order; X0 in the body's own position units
export function seatPerson9(P, X0 = null, o = {}) {
  const t0 = Date.now(), h = P?.h, g = h?.body?.geometry, K = P?.bake;
  if (!g || !P.parts?.length || !K?.parts?.length) return { skipped: 'no body, parts or bake records' };
  const meshes = P.parts, recs = K.parts.length === meshes.length ? K.parts : null;
  if (!recs || recs.some((r, i) => r.name !== meshes[i].userData?.k3?.name || r.group !== meshes[i].userData?.k3?.group)) return { skipped: 'the parts do not match the bake records (a figure study, or a bake filtered)' };
  if (!recs.some(r => r.group === 'garment')) return { skipped: 'no garments' };
  h.group.updateMatrixWorld(true); h.skeleton?.update?.();
  const scale = K.header?.scale || 1, M = boneMats(h.skeleton, h.body.matrixWorld), nb = g.attributes.position.count;
  const SIb = g.attributes.skinIndex.array, SWb = g.attributes.skinWeight.array, tri = g.userData.plan?.tri, Tb = Int32Array.from(tri?.array ?? tri ?? g.index.array);
  const X1 = skinPose(Float64Array.from(g.attributes.position.array), SIb, SWb, M, new Float64Array(nb * 3), scale);
  const body0 = X0 && X0.length === nb * 3 ? { X: skinPose(Float64Array.from(X0), SIb, SWb, M, new Float64Array(nb * 3), scale) } : null;
  // a record per mesh, from the DRAWN mesh (FABRIC7's fold7 splits a garment at build and lays its creases into it; despike, the detail ride and
  // refit8 have moved parts): its bind positions, index and weights; a garment's pattern from its aRest (u, v in metres, the panel x 0.01:
  // partMesh2, carried through fold7's split); name, owner and fabric from the bake's record
  const recOf = new Map(), rec = i => { if (recOf.has(i)) return recOf.get(i); const m = meshes[i], r = recs[i], ga = m.geometry, n = ga.attributes.position.count, AR = ga.attributes.aRest;
    const q = { name: r.name, group: r.group, owner: r.owner, fabric: r.fabric, X: Float64Array.from(ga.attributes.position.array, x => x * scale), T: ga.index.array, SI: ga.attributes.skinIndex.array, SW: ga.attributes.skinWeight.array, mesh: m };
    q.Xkey = Float64Array.from(q.X);
    if (r.group === 'garment' && AR && r.panel) { q.uv = new Float64Array(n * 2); q.panel = new Int32Array(n); for (let v = 0; v < n; v++) { q.uv[v * 2] = AR.getX(v); q.uv[v * 2 + 1] = AR.getY(v); q.panel[v] = Math.round(AR.getZ(v) * 100); } }
    recOf.set(i, q); return q; };
  const gar = [], sewn = [], found = [];
  for (let i = 0; i < recs.length; i++) { const r = recs[i]; if (r.group === 'garment') { const q = rec(i); gar.push({ q, Wg: weldGarment({ X: q.X, T: q.T }) }); } else if (r.group === 'found') found.push(rec(i)); }
  for (let i = 0; i < recs.length; i++) { const r = recs[i]; if (r.group !== 'construction') continue; const G = gar.find(x => x.q.owner === r.owner || x.q.name === r.owner); if (G) sewn.push({ q: rec(i), g: G.q }); }
  const dropped = gar.filter(G => !G.q.uv).map(G => G.q.name + ': no pattern (aRest)');
  const order = K.header?.stack?.order || null;
  const { rep, changed } = seatGarments9({ gar, sewn, found, M, scale, body: { X: X1, T: Tb }, body0, order, O: o, log: o.log });
  // the moved vertices into the meshes: bind positions and normals (the posed normal of the welded cloth, turned back through the vertex's blend)
  let verts = 0; for (const [q, mv] of changed) { const ga = q.mesh.geometry, pos = ga.attributes.position, NA = ga.attributes.normal, Pp = rep.posed.get(q) || skinPose(Float64Array.from(q.X, x => x / scale), q.SI, q.SW, M, new Float64Array(q.X.length), scale);
    for (let v = 0; v < mv.length; v++) if (mv[v]) { pos.setXYZ(v, q.X[v * 3] / scale, q.X[v * 3 + 1] / scale, q.X[v * 3 + 2] / scale); verts++; }
    if (NA) { const NP = vertexNormals(Pp, Int32Array.from(q.T)), key = v => `${Math.round(q.Xkey[v * 3] * 2e4)},${Math.round(q.Xkey[v * 3 + 1] * 2e4)},${Math.round(q.Xkey[v * 3 + 2] * 2e4)}`, sum = new Map();
      for (let v = 0; v < mv.length; v++) { if (!mv[v]) continue; const k = key(v), s = sum.get(k) || [0, 0, 0]; s[0] += NP[v * 3]; s[1] += NP[v * 3 + 1]; s[2] += NP[v * 3 + 2]; sum.set(k, s); }
      for (let v = 0; v < mv.length; v++) { if (!mv[v]) continue; const s = sum.get(key(v)), A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (let k = 0; k < 4; k++) { const w = q.SW[v * 4 + k]; if (!w) continue; const mo = q.SI[v * 4 + k] * 16; for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) A[c * 3 + r] += w * M[mo + c * 4 + r]; }
        const a = A[0], b = A[3], c = A[6], d = A[1], e = A[4], f = A[7], g2 = A[2], hh = A[5], ii = A[8], det = a * (e * ii - f * hh) - b * (d * ii - f * g2) + c * (d * hh - e * g2), px = s[0], py = s[1], pz = s[2];
        if (Math.abs(det) < 1e-9 || !(px || py || pz)) continue;
        const nx = ((e * ii - f * hh) * px + (c * hh - b * ii) * py + (b * f - c * e) * pz) / det, ny = ((f * g2 - d * ii) * px + (a * ii - c * g2) * py + (c * d - a * f) * pz) / det, nz = ((d * hh - e * g2) * px + (b * g2 - a * hh) * py + (a * e - b * d) * pz) / det, l = Math.hypot(nx, ny, nz) || 1;
        NA.setXYZ(v, nx / l, ny / l, nz / l); }
      NA.needsUpdate = true; }
    pos.needsUpdate = true; ga.computeBoundingSphere?.(); ga.computeBoundingBox?.(); }
  delete rep.posed; if (dropped.length) rep.dropped = dropped; rep.parts = changed.size; rep.verts = verts; rep.msTotal = Date.now() - t0;
  return rep;
}
