// CLOTH9 c3 (8 Oct): THE TROUSER BREAK, by simulation (stage 'legs'), a post-pass on a finished bake like settle9's sleeves.
// What a real trouser leg does at the shoe: it is a tube of flat panels hanging from the hips, hemmed by the tailor to the shoes worn
// (a 'slight break': the BACK of the hem a finger's width above the heel's sole); the hem opening (38-45 cm) is wider than the ankle,
// so the leg falls until the shoe stops it: the front rests on the instep and laces, the back drops behind the heel, and the length the
// instep holds up has nowhere to go but out of plane: it buckles into one or two soft folds above the shoe (the break). The bakes
// cannot do any of this: K4's trousers are cut ankle length (the hem 6-8 cm above the floor on low shoes, 12-15 cm on boots, round the
// boot shaft), every edge of the lower leg is exactly its pattern length (no slack anywhere), and the hem ring is shrink-wrapped round
// the shoe 2.7 mm off it (CLOTH9 c2's probe: measures/c2it1/legs_v7c.txt). So, per leg:
//   the hem   the tailoring rule (the person's own shoes, no per-person number): the hem's back to `over` above the top of the shoe's
//             sole at the heel. The leg's PATTERN is let down by the difference (Delta, at most `maxLet` 4 cm: a trouser's turned-up hem
//             allowance, all a tailor can let down; a longer leg is a longer pattern: CLOTH8 / K2's cut) over the `band`
//             of pattern above the hem (each panel's v along the leg stretched uniformly in the band: the panels stay matched at the
//             seams, the weave keeps its true scale because the bake's uv are rewritten with it: the cloth IS longer, not stretched)
//   the sim   lib/fx/cloth/xpbd.js on the band's cloth (+ `near` of held cloth above it): rest lengths and areas from the let-down
//             pattern (metric), the warp along the leg (grain), the fabric's rev-7 bending (FABRIC7's literature bending lengths:
//             one fabric identity), flat panels (restAngle 0: a trouser is sewn from flat cloth), gravity, Coulomb friction, the
//             posed body (its full skin), the SHOES (each part of the boot group), the floor, the cloth against itself (selfTri)
//   nothing   is laid by hand: no fold count, no fold shape, no target position; where the cloth ends up is the solver's
// rev 2 (c3 it2, 8 Oct): THE FALL AT THE CLOTH'S OWN SCALE, ONTO A SOLID SHOE, AT THE TAILOR'S LENGTH. (1) refineLegs9 (the driver calls
// it before anything is bound): the trousers below the knee and their turned hems cut 1 -> 4 (refine9.js: 13.7 -> ~6.9 mm), so a fold
// the fabric's bending length asks for is drawn by several edges instead of buckling at the lattice's scale (it1's faceted diamond);
// (2) the shoe is ONE CLOSED SOLID per foot (shoe9.js: the convex outline of its parts at every height, the mouth capped to the rim,
// a signed distance field) instead of its open parts, so the hem cannot slip between lace tubes, under the tongue or into the boot's mouth (it1's
// shards at L12's boot); (3) the let-down is the tailor's rule itself (`maxLet` 4 -> 10 cm: the 4 cm hem allowance was a stand-in for
// a pattern cut ankle length; a pattern with the inseam to the heel is CLOTH8 / K2's, and then the let-down here is ~0); (4) the let-down
// reaches the solver in `ramp` steps (the leg lowered onto the shoe, not sprung out of a squeezed band).
// rev 3 (c3 it4, 8 Oct): THE TURNED HEM SEWN INTO THE LEG, SOLVED AS ONE PIECE. A trouser's hem is the leg's own cloth turned up inside
// through a fold and stitched round the leg: the edge the eye sees is that FOLD, and the band is two layers of the fabric held at the
// fold and at the stitch line, heavier and stiffer than the leg because it IS two layers. Rev 1-2 drew it as two things: a band of the
// leg given 2 x the mass and 4 x the bending in every direction (a stand-in: a stiff hoop round the leg, the 'ring' folds of c3 it3's
// plots, and a back that would not drop behind the heel on L03's and L06's right legs), with its free CUT edge as the hem, and CLOTH7's
// turned layer (fold7) laid inside it afterwards along the normal (crossing the stacked folds 1 000-1 600 times; slivers along the
// edge). Now the leg's cloth within `hemDepth` (3.5 cm, K4 / CLOTH7's turn-up) of its edge is DUPLICATED as the inner layer of the
// solve: the same triangles and pattern lengths (let down with the leg), turned over; its bottom row the leg's own edge particles (the
// fold: the leg's last triangle and the layer's first meet at nearly pi, which the solver holds by a wing-to-wing distance, its rule for
// a turned hem past `foldMax`); every other vertex a new particle laid `sep` (selfTri + hemTh) inside its leg vertex; its top row tacked
// to the leg vertex it duplicates (the stitch line). The layer meets the leg (selfTri, its half-thickness `hemTh`) and the skin; it
// meets the shoe THROUGH the leg (the shoe's solid is fatter than the shoe between its collar and the ankle). The fabric is the leg's
// fabric: no hem multiplier. The solve's rest dihedrals are the bake's (rev 2 re-took them from the cloth at every lowering step, so a
// fold the fall had made past `foldMax` was frozen as a strut in the next step). fold7's part (the trousers' 'hem': the RENDER of the
// turned layer, with its rounded fold) is carried on the solved layer and bound to the solved leg for the driver (carry8's bind: a
// guard round that sends leg cloth back takes the hem with it). (Tried first and dropped: fold7's own part in the solve: its clipped
// stitch line and sub-millimetre fold rows are 0.3 mm slivers, 30 x lighter and softer than the lattice; they were thrown 80 mm in six
// substeps: 12 614 crossing pairs.)
//   settleLegs9(ctx)  ctx as settle9's (gar, W, Pws, body, bodySurf, J, parts, P, O: { legs: {...} }, log) -> report; edits Pws (posed,
//                     welded) and the garment's uv in place (the driver packs both into the bake)
import { Cloth } from '../xpbd.js';
import { phys } from '../fabrics.js';
import { SurfaceMesh, Contacts, vertexNormals } from '../collide.js';
import { selfIntersections } from '../cloth5/measure5.js';
import { refine9 } from './refine9.js';
import { closedShoe9 } from './shoe9.js';
import { bind8, place8 } from '../cloth8/carry8.js';
export const BREAK9_VERSION = 3;
export const BREAK9 = { band: 0.30, over: 0.010, near: 0.04, minLet: 0.005, maxLet: 0.10, T: 3, hz: 480, every: 6, damping: 2, vmax: 0.8,
  gap: 0.002, mu: 0.25, muShoe: 0.2, restAngle: 0, hemDepth: 0.035, hemTh: 0.0003, tackAlpha: 1e-7, compress: 0.3, selfTri: 0.0015, selfEvery: 8, maxMove: 0.15, fallback: 'chino', soleHeel: 0.03, physRev: 7,
  refineAbove: 0.03, shoeH: 0.002, shoeMargin: 0.03, ramp: 5, rampT: 0.67 };

// rev 2: the legs below the knee (and every part sewn on the trousers there: the turned hems) cut finer BEFORE anything is welded,
// posed or bound by the driver (bind poses in place; T / Tfull / uv / panel / weights carried): -> report
export function refineLegs9({ parts, poseOf, J, O: o = {} }) {
  const O = { ...BREAK9, ...o }, g = parts.find(q => q.group === 'garment' && q.owner === 'trousers'); if (!g) return { skipped: 'no trousers' };
  const yTop = Math.max(J.kneeL[1], J.kneeR[1]) + O.refineAbove, rep = {}, Pg = poseOf(g);
  rep[g.name] = refine9(g, i => Pg[i * 3 + 1] < yTop);
  for (const q of parts) { if (q.group !== 'construction' || q.owner !== 'trousers') continue; const Pq = poseOf(q); let top = -Infinity; for (let i = 1; i < Pq.length; i += 3) top = Math.max(top, Pq[i]); if (top > yTop) continue; rep[q.name + '#' + parts.indexOf(q)] = refine9(q, () => true); }
  return rep; }

export function settleLegs9(ctx) {
  const { gar, W, Pws, body, bodySurf, J, parts, P, log = () => {} } = ctx, O = { ...BREAK9, ...(ctx.O?.legs || {}) };
  const g = gar.find(x => x.owner === 'trousers'); if (!g || !g.uv || !g.panel) return { skipped: 'no trousers with a pattern' };
  const t0ms = Date.now(), Wg = W.get(g), Pw = Pws.get(g), m = Wg.m, n0 = g.X.length / 3, UV = g.uv;
  const shoes = parts.filter(q => q.group === 'boot'); if (!shoes.length) return { skipped: 'no shoes' };
  const SX = new Map(shoes.map(q => [q, P(q)])); let floorY = Infinity; for (const X of SX.values()) for (let i = 1; i < X.length; i += 3) floorY = Math.min(floorY, X[i]);
  // which leg a point belongs to: the nearer of the two shins (knee -> foot lines)
  const segD = (p, a, b) => { const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], t = Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2))); return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t); };
  const sideOfW = w => { const p = [Pw[w * 3], Pw[w * 3 + 1], Pw[w * 3 + 2]]; return segD(p, J.kneeL, J.footL) <= segD(p, J.kneeR, J.footR) ? 0 : 1; };
  // the welded triangles back to the pattern's own (weldGarment drops the degenerate ones and keeps the order)
  const orig = []; for (let t = 0; t < g.T.length; t += 3) { const a = Wg.wid[g.T[t]], b = Wg.wid[g.T[t + 1]], c = Wg.wid[g.T[t + 2]]; if (a === b || b === c || a === c) continue; orig.push(t); }
  if (orig.length * 3 !== Wg.T.length) return { skipped: 'weld order' };
  // the leg's direction in each panel's pattern: the sign of dv along the leg (v up the leg: dy/dv > 0)
  const np = Math.max(...g.panel) + 1, sv = new Float64Array(np).fill(1); { const a = new Float64Array(np), b = new Float64Array(np), c = new Float64Array(np);
    for (let i = 0; i < n0; i++) { const p = g.panel[i], w = Wg.wid[i], y = Pw[w * 3 + 1]; a[p] += UV[i * 2 + 1] * y; b[p] += UV[i * 2 + 1]; c[p] += 1; }
    const yb = new Float64Array(np); for (let i = 0; i < n0; i++) yb[g.panel[i]] += Pw[Wg.wid[i] * 3 + 1]; for (let p = 0; p < np; p++) if (c[p]) sv[p] = a[p] / c[p] - (b[p] / c[p]) * (yb[p] / c[p]) >= 0 ? 1 : -1; }
  const rep = { fabric: g.fabric, floorMm: +(floorY * 1000).toFixed(1), sides: [] }, uvNew = Float64Array.from(UV), aHem = new Float64Array(n0).fill(Infinity), a0v = new Float64Array(n0).fill(Infinity);   // aHem: pattern height above the let-down hem
  const zone = new Uint8Array(m), held = new Uint8Array(m), legOf = new Int8Array(m).fill(-1), kSide = [0, 0];
  for (let si = 0; si < 2; si++) { const sd = si ? 'R' : 'L', foot = J['foot' + sd], knee = J['knee' + sd];
    // the hem: the lowest closed loop round this leg
    let hem = null; for (const Lp of Wg.loops) { if (!Lp.closed || Lp.ids.length < 8) continue; let cx = 0, cy = 0, cz = 0; for (const w of Lp.ids) { cx += Pw[w * 3]; cy += Pw[w * 3 + 1]; cz += Pw[w * 3 + 2]; } cx /= Lp.ids.length; cy /= Lp.ids.length; cz /= Lp.ids.length;
      if (Math.hypot(cx - foot[0], cz - foot[2]) > 0.12 || cy > knee[1]) continue; if (!hem || cy < hem.cy) hem = { ids: Lp.ids, cy }; }
    if (!hem) { rep.sides.push({ side: sd, skipped: 'no hem loop' }); continue; }
    let hemMin = Infinity, hemFront = null, hemBack = null; for (const w of hem.ids) { const y = Pw[w * 3 + 1], z = Pw[w * 3 + 2]; hemMin = Math.min(hemMin, y); if (!hemFront || z > hemFront.z) hemFront = { z, y }; if (!hemBack || z < hemBack.z) hemBack = { z, y }; }
    // the shoe's sole top at the heel (the tailor's mark): the sole part of this foot behind the ankle; else soleHeel above the floor
    const soles = shoes.filter(q => /sole/.test(q.name) && q.name.endsWith('.' + sd)); let soleTop = -Infinity;
    for (const q of soles) { const X = SX.get(q); for (let i = 0; i < X.length; i += 3) if (X[i + 2] < foot[2] - 0.03) soleTop = Math.max(soleTop, X[i + 1]); }
    if (!Number.isFinite(soleTop)) soleTop = floorY + O.soleHeel;
    const target = soleTop + O.over, D = Math.min(O.maxLet, hemMin - target), side = { side: sd, hemMinMm: +((hemMin - floorY) * 1000).toFixed(1), hemFrontMm: +((hemFront.y - floorY) * 1000).toFixed(1), hemBackMm: +((hemBack.y - floorY) * 1000).toFixed(1), soleTopMm: +((soleTop - floorY) * 1000).toFixed(1), letMm: +(Math.max(0, D) * 1000).toFixed(1) };
    rep.sides.push(side); if (!(D >= O.minLet)) { side.skipped = 'already long enough'; continue; }
    // this leg's cloth below the knee and the panels it is cut from: each panel's hem line (its lowest v along the leg, below the knee)
    const vHem = new Map(); for (let i = 0; i < n0; i++) { const w = Wg.wid[i]; if (Pw[w * 3 + 1] > knee[1] || sideOfW(w) !== si) continue; const p = g.panel[i], a = UV[i * 2 + 1] * sv[p]; if (!vHem.has(p) || a < vHem.get(p)) vHem.set(p, a); }
    // the let-down: a (pattern height above the hem) in [0, band] -> a (1 + D / band) - D (the hem D lower, the band's top where it was)
    const k = D / O.band; let nz = 0; kSide[si] = k;
    for (let i = 0; i < n0; i++) { const w = Wg.wid[i], p = g.panel[i]; if (!vHem.has(p) || sideOfW(w) !== si || Pw[w * 3 + 1] > knee[1] + 0.05) continue; const a = UV[i * 2 + 1] * sv[p] - vHem.get(p);
      if (a < O.band) { const a2 = a * (1 + k) - D; uvNew[i * 2 + 1] = (vHem.get(p) + a2) * sv[p]; aHem[i] = a2 + D; a0v[i] = a; if (!zone[w]) { zone[w] = 1; nz++; } legOf[w] = si; }
      else if (a < O.band + O.near && !zone[w]) { held[w] = 1; legOf[w] = si; } }
    side.zone = nz; side.panels = [...vHem.keys()]; }
  for (let w = 0; w < m; w++) if (zone[w]) held[w] = 0;
  const nZ = zone.reduce((a, b) => a + b, 0); if (!nZ) { rep.ms = Date.now() - t0ms; return rep; }
  // the sim's cloth: the zone and the held ring
  const inSub = new Int32Array(m).fill(-1), map = []; for (let w = 0; w < m; w++) if (zone[w] || held[w]) { inSub[w] = map.length; map.push(w); }
  const Ts = [], tOrig = []; for (let t = 0, j = 0; t < Wg.T.length; t += 3, j++) { const a = inSub[Wg.T[t]], b = inSub[Wg.T[t + 1]], c = inSub[Wg.T[t + 2]]; if (a < 0 || b < 0 || c < 0) continue; Ts.push(a, b, c); tOrig.push(orig[j]); }
  const ns = map.length, nt = Ts.length / 3;
  // rev 3: THE TURNED HEM IN THE SOLVE. The leg's cloth within `hemDepth` of its edge (the bake's pattern: the 3.5 cm that K4 / CLOTH7 turn
  // up, fold7's layer) is DUPLICATED as the inner layer: the same triangles and pattern lengths (let down with the leg), the winding turned
  // over, its bottom row the leg's own edge particles (the fold: the leg's last triangle and the layer's first meet at nearly pi, which
  // the solver holds as a turned hem by a wing-to-wing distance, its `foldMax` rule), every other vertex a new particle laid `sep`
  // inside its leg vertex, the top row tacked to it at `sep` (the stitch line). (A first build put fold7's own part in the solve: its
  // clipped stitch line and sub-millimetre fold rows are slivers of 0.3 mm, 30 x lighter and softer than the lattice; they were thrown
  // 80 mm in six substeps. fold7's part is the RENDER of the hem: it is carried on this layer after the solve, below.)
  const sep = O.selfTri + O.hemTh, edgeW = new Set(); for (const Lp of Wg.loops) if (Lp.closed) for (const w of Lp.ids) if (zone[w]) edgeW.add(w);
  const NL = vertexNormals(Pw, Wg.T), inTri = [], dup = new Int32Array(ns).fill(-1), xs = [], Th = [], thOf = [], tacks = [], tackL = [];
  for (let j = 0; j < nt; j++) { const t = tOrig[j]; if (a0v[g.T[t]] <= O.hemDepth && a0v[g.T[t + 1]] <= O.hemDepth && a0v[g.T[t + 2]] <= O.hemDepth) inTri.push(j); }
  // outward: away from each shin's axis (the knee -> foot line), by the majority of the band's vertices
  let sgV = 0; for (const j of inTri) for (let c = 0; c < 3; c++) { const w = map[Ts[j * 3 + c]], sd = legOf[w] === 1 ? 'R' : 'L', A0 = J['knee' + sd], A1 = J['foot' + sd];
    const ad = [A1[0] - A0[0], A1[1] - A0[1], A1[2] - A0[2]], al = Math.hypot(...ad), r = [Pw[w * 3] - A0[0], Pw[w * 3 + 1] - A0[1], Pw[w * 3 + 2] - A0[2]], ra = (r[0] * ad[0] + r[1] * ad[1] + r[2] * ad[2]) / (al * al);
    sgV += Math.sign((r[0] - ad[0] * ra) * NL[w * 3] + (r[1] - ad[1] * ra) * NL[w * 3 + 1] + (r[2] - ad[2] * ra) * NL[w * 3 + 2]); }
  const sgN = sgV < 0 ? -1 : 1; let nsT = ns;
  for (const j of inTri) { const tri = []; for (let c = 0; c < 3; c++) { const i = Ts[j * 3 + c], w = map[i]; if (edgeW.has(w)) { tri.push(i); continue; }
      if (dup[i] < 0) { dup[i] = nsT++; for (let d = 0; d < 3; d++) xs.push(Pw[w * 3 + d] - sgN * NL[w * 3 + d] * sep); } tri.push(dup[i]); }
    Th.push(tri[0], tri[2], tri[1]); thOf.push(j); }
  // the stitch line: the layer's boundary vertices off the fold, each tacked to the leg vertex it duplicates
  { const ec = new Map(); for (let k = 0; k < Th.length; k += 3) for (let c = 0; c < 3; c++) { const a = Th[k + c], b = Th[k + (c + 1) % 3], kk = Math.min(a, b) * nsT + Math.max(a, b); ec.set(kk, (ec.get(kk) || 0) + 1); }
    const top = new Set(); for (const [kk, c] of ec) if (c === 1) for (const v of [Math.floor(kk / nsT), kk % nsT]) if (v >= ns) top.add(v);
    for (let i = 0; i < ns; i++) if (dup[i] >= 0 && top.has(dup[i])) { tacks.push(dup[i], i); tackL.push(sep); } }
  rep.hem = { depthCm: O.hemDepth * 100, sepMm: +(sep * 1000).toFixed(2), tris: Th.length / 3, particles: nsT - ns, fold: [...edgeW].length, tacks: tacks.length / 2 };
  const rest = new Float64Array(nsT * 3), pin = new Uint8Array(nsT), TH = new Float64Array(nsT).fill(O.selfTri);
  for (let i = 0; i < ns; i++) { const w = map[i]; for (let c = 0; c < 3; c++) rest[i * 3 + c] = Pw[w * 3 + c]; pin[i] = zone[w] ? 0 : 1; }
  rest.set(xs, ns * 3); for (let i = ns; i < nsT; i++) TH[i] = O.hemTh;
  const nth = Th.length / 3, ntT = nt + nth, metric = new Float64Array(ntT * 6), metric0 = new Float64Array(ntT * 6), grain = new Float64Array(ntT * 2);
  for (let j = 0; j < ntT; j++) { const jl = j < nt ? j : thOf[j - nt], t = tOrig[jl], ord = j < nt ? [0, 1, 2] : [0, 2, 1];
    for (let c = 0; c < 3; c++) { const i = g.T[t + ord[c]]; metric[j * 6 + c * 2] = uvNew[i * 2]; metric[j * 6 + c * 2 + 1] = uvNew[i * 2 + 1]; metric0[j * 6 + c * 2] = UV[i * 2]; metric0[j * 6 + c * 2 + 1] = UV[i * 2 + 1]; }
    grain[j * 2] = 0; grain[j * 2 + 1] = sv[g.panel[g.T[t]]]; }
  let fab; try { fab = phys(g.fabric, O.physRev); } catch (e) { fab = phys(O.fallback, O.physRev); }
  // rev 2: THE LEG LOWERED, NOT SPRUNG: the let-down reaches the cloth in `ramp` steps (each a fresh solve from where the last one left
  // the cloth, the pattern's metric a fraction further let down), then a settle at the full length. Given all at once, the band starts
  // squeezed to 1 / (1 + D / band) of its new rest length and springs out (L12's 9 cm: a balloon of denim, the hem thrown up the shin);
  // lowered, gravity and the shoe place each centimetre as it comes: the leg is let down onto the shoe as a tailor's client stands in it.
  // rev 3: every step's rest dihedrals are the bake's (`rest`), not the cloth's at that step.
  const Ti = Int32Array.from([...Ts, ...Th]), mk = (f, X) => { const cl = new Cloth(rest, Ti, fab, { X0: X, pin, metric: metric0.map((m0, k) => m0 + (metric[k] - m0) * f), grain, fabs: [fab], restAngle: O.restAngle, compress: O.compress, damping: O.damping, vmax: O.vmax, tether: true, slack: 0.01,
    ...(O.selfTri > 0 ? { selfTri: TH, selfTriEvery: O.selfEvery } : {}) }); if (tacks.length) cl.stitch(tacks, { alpha: O.tackAlpha, L: tackL }); return cl; };
  // colliders: the body's full skin, each foot's shoe (rev 2: closed, below), the floor
  const mask = new Uint8Array(nsT); for (let i = 0; i < nsT; i++) mask[i] = pin[i] ? 0 : 1;
  // rev 3: the turned hem meets the shoe THROUGH the leg (the outer layer, selfTri keeps it inside): the shoe's solid is the convex outline
  // of its parts, fatter than the shoe between its collar and the ankle, and half the turned layer starts inside it (L03: 549 / 1078
  // vertices within its gap, to 10.8 mm deep): projected out of it, the layer went through the leg (12 614 crossing pairs in 6 substeps)
  const maskShoe = Uint8Array.from(mask, (f, i) => (i < ns ? f : 0));
  const surfaces = [{ mesh: bodySurf, gap: O.gap + fab.h / 2, mu: O.mu, reach: 0.04, mask }];
  // rev 2: each foot's shoe as ONE closed solid (the convex outline of its parts at every height: shoe9.js)
  rep.shoe = {}; for (const sd of ['L', 'R']) { const qs = shoes.filter(q => q.name.endsWith('.' + sd)); if (!qs.length) continue; const t1 = Date.now();
    const S = closedShoe9(qs.map(q => ({ X: SX.get(q), T: q.T })), { h: O.shoeH, margin: O.shoeMargin });
    surfaces.push({ mesh: S, gap: O.gap + fab.h / 2, mu: O.muShoe, reach: 0.04, mask: maskShoe }); rep.shoe[sd] = { grid: [S.nx, S.ny, S.nz], solid: S.solid, ms: Date.now() - t1 }; }
  { const y = floorY, R = 2; surfaces.push({ mesh: new SurfaceMesh(Float64Array.from([-R, y, -R, R, y, -R, R, y, R, -R, y, R]), Int32Array.from([0, 2, 1, 0, 3, 2]), { cell: 1, normals: Float64Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]) }), gap: fab.h / 2, mu: O.muShoe, reach: 0.05, mask }); }
  const contacts = new Contacts(nsT, surfaces, { reach: 0.04, safe: true });
  const L0 = []; selfIntersections(Pw, Wg.T, { list: L0 }); const before = new Set(); for (let i = 0; i < L0.length; i += 2) before.add(L0[i] * 1e6 + L0[i + 1]);
  const H0 = []; if (nth) selfIntersections(rest, Ti, { list: H0 });   // the leg and its turned hems as one mesh: crossings before
  let cl = null, Xc = rest; for (let k = 1; k <= O.ramp; k++) { cl = mk(k / O.ramp, Xc); cl.run(O.T * O.rampT / O.ramp, { hz: O.hz, contacts, every: O.every }); Xc = Float64Array.from(cl.X); }
  cl = mk(1, Xc); cl.run(O.T * (1 - O.rampT), { hz: O.hz, contacts, every: O.every });
  const H1 = []; if (nth) selfIntersections(cl.X, Ti, { list: H1 });
  if (O.onSolve) O.onSolve({ cl, rest, Ti, ns, nsT, nt, map, H1 });   // scratch diagnostics only (a function: never from the command line)
  // back into the garment (welded posed), and the let-down pattern into its uv
  let moved = 0, mx = 0, capped = 0; for (let i = 0; i < ns; i++) { if (pin[i]) continue; const w = map[i]; let d = [cl.X[i * 3] - Pw[w * 3], cl.X[i * 3 + 1] - Pw[w * 3 + 1], cl.X[i * 3 + 2] - Pw[w * 3 + 2]], l = Math.hypot(...d);
    if (!Number.isFinite(l)) continue; if (l > O.maxMove) { d = d.map(x => x * O.maxMove / l); l = O.maxMove; capped++; } for (let c = 0; c < 3; c++) Pw[w * 3 + c] += d[c]; moved++; mx = Math.max(mx, l); }
  g.uv.set(uvNew);
  // rev 3: fold7's turned hem (the RENDER of the hem: the trousers' 'hem' parts) carried on the solved layer (bound to the layer as the
  // solve started, placed on it as it ended), then bound to the solved leg for the driver (carry8's place8: a guard round that sends leg
  // cloth back takes the hem with it)
  if (nth) { const Tin = Int32Array.from(Th), Pn = new Float64Array(n0 * 3); for (let i = 0; i < n0; i++) { const w = Wg.wid[i]; for (let c = 0; c < 3; c++) Pn[i * 3 + c] = Pw[w * 3 + c]; }
    const S0 = new SurfaceMesh(rest, Tin, { cell: 0.015 }); ctx.hemBind ||= new Map(); rep.hem.carried = {};
    for (const q of parts.filter(q => q.group === 'construction' && q.owner === 'trousers' && q.name === 'hem')) { const Xq = P(q), B = bind8(Xq, rest, Tin, { surf: S0 }), Xs = Float64Array.from(Xq);
      const k = place8(B, cl.X, Tin, Xs); ctx.hemBind.set(q, bind8(Xs, Pn, g.T)); rep.hem.carried[q.name + '#' + parts.indexOf(q)] = k; } }
  // the hem after: its lowest, front and back above the floor
  for (const sdr of rep.sides) { if (sdr.skipped) continue; const si = sdr.side === 'R' ? 1 : 0; let hem = null; const foot = J['foot' + sdr.side];
    for (const Lp of Wg.loops) { if (!Lp.closed || Lp.ids.length < 8) continue; let cx = 0, cy = 0, cz = 0; for (const w of Lp.ids) { cx += Pw[w * 3]; cy += Pw[w * 3 + 1]; cz += Pw[w * 3 + 2]; } cx /= Lp.ids.length; cy /= Lp.ids.length; cz /= Lp.ids.length; if (Math.hypot(cx - foot[0], cz - foot[2]) > 0.14 || legOf[Lp.ids[0]] !== si) continue; if (!hem || cy < hem.cy) hem = { ids: Lp.ids, cy }; }
    if (!hem) continue; let mn = Infinity, f = null, b = null; for (const w of hem.ids) { const y = Pw[w * 3 + 1], z = Pw[w * 3 + 2]; mn = Math.min(mn, y); if (!f || z > f.z) f = { z, y }; if (!b || z < b.z) b = { z, y }; }
    sdr.after = { hemMinMm: +((mn - floorY) * 1000).toFixed(1), hemFrontMm: +((f.y - floorY) * 1000).toFixed(1), hemBackMm: +((b.y - floorY) * 1000).toFixed(1) }; }
  const L2 = []; selfIntersections(Pw, Wg.T, { list: L2 }); let newX = 0; for (let i = 0; i < L2.length; i += 2) if (!before.has(L2[i] * 1e6 + L2[i + 1])) newX++;
  Object.assign(rep, { sim: ns, simHem: nsT - ns, zone: nZ, tris: nt, hemTris: nth, tacks: tacks.length / 2, moved, maxMm: +(mx * 1000).toFixed(1), capped, self: { before: L0.length / 2, after: L2.length / 2, new: newX },
    withHem: { before: H0.length / 2, after: H1.length / 2 }, foldsHeld: cl.folds, bendCm: +(fab.c * 100).toFixed(2), ms: Date.now() - t0ms });
  log('break9 legs', g.name, JSON.stringify(rep));
  return rep;
}
