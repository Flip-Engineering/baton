// CLOTH8 c9 it1 (16 Oct): LAY. A person's standing garments are laid from their FLAT PATTERN at rest on the body that renders, sewn,
// and settled under gravity; then pose8 carries them from the rest pose (the bind's A-pose) to the stance. Until now every standing bake
// began as the previous bake (v7c <- cloth6 <- ... <- dress3: sewn in round 3 on another body, carried to the stance by the skin weights in
// jumps, edited by every lane since): 20-30 % of a top came out ALREADY CROSSING ITSELF and the solvers after it (resolve8, pose8) could
// only hold that tangle (the root finding of three lanes, 16 Oct ~00:00; the critic, c8 it1-it3: 'dress from the flat pattern at rest').
// Here only the PATTERN of the bake is kept: each garment's panels (uv: the flat pattern in metres with its ease; panel ids; the seams,
// where two panels' vertices share a place), its triangles, its skin weights and what is sewn on it. Its 3D shape is made again:
//   CHARTS   the body's five segments (trunk, two arms, two legs), each an axis through the person's own joints at rest with a frame round
//            it; a body vertex belongs to a segment by its skin weights (the arm's bones, the leg's bones, the rest the trunk). A leg's
//            axis runs up to the waist (that half of the pelvis, cut at the midline); the trunk's runs down past the knees (a skirt or a
//            coat hangs round both legs).
//   ENVELOPE per chart, at each height and angle round the axis, the outermost of the body (and of the garments already laid: inner
//            garments first) plus the cloth's clearance: a star-shaped surface that nothing of the body passes.
//   PLACE    each panel goes on the chart that holds most of its weight (a sleeve on its arm, a trouser panel on its leg, a skirt or a
//            bodice on the trunk). Where the bake has its vertices (height, angle) says WHERE on the chart the panel lies; the panel's
//            SHAPE is its flat pattern: the flat panel fitted onto those places as rigidly as it goes (2D as-rigid-as-possible, Sorkine and
//            Alexa 2007, with the bake's places as weak targets), so a panel that the bake crumpled is laid flat again, and a 2D layout
//            that keeps every triangle's orientation cannot fold over itself.
//   GIRTH    the envelope is widened at each height until its round equals the panels' own width there (their ease): the garment is laid
//            at its cut's girth, not squeezed onto the body.
//   SEW      a seam's vertices take one place (their mean); the cloth is then the welded garment.
//   SETTLE   the cloth's own solver at rest: every triangle at its PATTERN lengths, the fabric's bending on flat panels (restAngle 0),
//            gravity, the body (its culled skin too) as the floor, the garments already laid as obstacles, CLOTH6's Self6 with its
//            untangling. Held: only where the garment is held (the bands it is eased into, the waistband, cuff joins, rib cuffs, hem band,
//            and `pinNear` round them: the band's reference place, as pose8 and resolve8 hold it).
// What is sewn on a garment (plackets, pockets, turned hems, the collar's fall, buttons) follows its cloth (carry8). The same numbers for
// every garment and every person; nothing is fitted to a picture. Pure JS on typed arrays.
//   lay8(parts, { M (bone matrices at rest), scale, body: { X (bind, hero units), SI, SW, T (the full skin) }, joints: { name: [x,y,z] metres
//   at rest }, bones: [names], opt (opt.order: the outfit's dressing order, inner first), log }) -> report (each laid garment's bind X and
//   its sewn parts' bind X written in place)
// REV 2 (c9 it2, 16 Oct): THE WAIST DRAFTED TO THE BODY AND SEATED ON IT. A garment hung from the trunk (trousers, a skirt: its top
// opening rings the trunk, its other openings lie below the crotch) is no longer pinned where the bake had its waist, nor held by its band
// at the band's old place. (1) DRAFT: its top edge is cut to the tape girth of what it closes round at that level (the body and the
// garments already laid: a horizontal slice's convex hull, the arms left out, as a tailor's tape bridges hollows; tailor.js's rule) plus
// the cloth's own thickness, with the cut's waist ease (`waistEase`, negative: a waistband grips); the suppression is taken out of the
// FLAT PATTERN as a tailor takes it out with darts: each panel narrowed about its own middle, fully at the top edge and tapering to nothing
// at the seat (the level of the body's greatest posterior protrusion below the waist: where a dart ends). The cut (uv) itself changes:
// every later solve (pose8, resolve8, contact8, CLOTH9's settle, MOTION's relaxation) relaxes toward the drafted cut. (2) DRAW IN: laid
// and sewn, the waist is drawn to its cut with gravity off (its edges ramped from their laid lengths), so it comes to rest ON the body.
// (3) SEAT: where the body below the waist is wider than the drafted band somewhere (the hips' flare, the seat: the largest tape between
// the crotch and the waist), the band is CARRIED by the body: nothing of the garment is held, it hangs under gravity from a waist the body
// holds up. Where it is not (a trunk that does not widen below the waist: a belly), a real band stays up by its grip (a snug band's
// friction and the soft tissue it presses into), which this rigid body and positional friction do not make (L05's drafted waist, free, slid
// 55 cm): the band zone is then held where it was drawn in on today's body. The band, the belt loops and the waist button are carried by
// the cloth (carry8) instead of holding it. Same rule for every person; nothing fitted to a picture. (Rev 1's `waistHeld` hold at the
// bake's ring stays only for { waist: false }.)
// REV 3 (c9 it3, 16 Oct): THE LEGS DRAFTED TO THE BODY AND THE HEM RESTING ON THE SHOE. Trousers whose waist is drafted have their leg
// LENGTH cut to the body as well. The hem's REST is the first height, from the shoe's top down, where the tape round the shoe and the ankle
// in it (plus the shoe's contact distance) reaches the hem's own girth. The body's OUTSEAM is a tape from the side seam's top down the
// outside of the hip, the leg and the shoe to that rest, bridging hollows; its INSEAM a tape from the crotch down the inside of the leg and
// the shoe. Each, plus the style's BREAK (`brk`, a design allowance like ease: what the cut leaves over the shoe, which folds there), is set
// against the cut's own seam in the flat. The seam that BEARS the leg sets the alteration: where the pattern's rise is shorter than the
// body's, the crotch seam bears on the body's crotch and the leg hangs from it (the inseam); where it is longer, from the waist (the
// outseam): the smaller of the two alterations. It is made in the FLAT PATTERN below the knee line (a tailor's lengthen/shorten line), the
// same for a leg's front and back; the hem's girth is the style's, the rise is not drafted yet (`rise` records how short it is). The lower
// leg is laid from the waist by its own cut, hitched up the shin where it would reach past its rest on the shoe and LET DOWN by its own
// length in the settle (its edges' rest lengths grown from the hitch to the cut, under gravity). The SHOES are a collider at a contact
// distance of half the cloth's own edge (shoe8.js: a corner of the shoe, its collar or heel counter, never passes between two particles),
// and the GROUND is under them. pose8 v3 then carries the hem from rest to the stance as free cloth on the shoes (a hem that hangs is not a
// support). Same rule for every person; nothing fitted to a picture.
// REV 4 (c10 it2, 16 Oct): ONE CHAIN FOR EVERY DRESSED PERSON: THE BOTTOMS UNDER AN UNTUCKED TOP ARE LAID TOO, AND THE TOP HANGS OVER THEM.
// Rev 1-3 kept any garment under a top joined at the armhole as the bake had it (laid anew under the kept top it came through it), so
// lay8 reached only the four people whose shirt is tucked (L03 L05 L06 L20); the eight with an untucked top or a coat kept the old
// bottoms (hems in the shoes: the CHECK's F4). Now the bottoms are laid first under any top, as they are put on, and the top (still kept
// where the bake has it until the armhole is laid) HANGS OVER them below the top of what it now covers: its cloth there settled at its
// pattern lengths under gravity, the garments under it a one-sided floor and obstacles, the cloth eased into a band held to the band's
// girth, what is sewn on it carried (hangOver). A coat over a top hangs over both. { over: false } is rev 3 (the bottoms kept).
// Laying eight more people's bottoms showed three faults of the rev 2-3 drafts, fixed in the same rule for everyone: (a) the WAIST is the
// opening's edges that run across the grain in the flat (a fly's or a vent's edges run with it: L23's 'waist' measured 1.45 m against a
// 0.99 m tape and the draft mirrored the panels' tops; the four laid before have no such edge and draft as before); (b) the LEGS ARE CUT AS
// A PAIR, to one inseam (the shorter leg's tape: on the other side the tape detoured round the soft parts at the fork; one leg came out 5 cm
// longer); (c) a waist that is not one open ring round the trunk (L21's jeans: a turned facing, broken by the pocket mouths) is not drafted
// yet, and a garment under a top whose waist is not drafted stays as the bake has it (laid undrafted, L21's hems went through the boots).
import { Cloth } from '../xpbd.js';
import { phys } from '../fabrics.js';
import { Contacts, SurfaceMesh, skinPose, rigidSurface } from '../collide.js';
import { selfIntersections } from '../cloth5/measure5.js';
import { Self6 } from '../cloth6/self6.js';
import { weldGarment } from '../cloth7/fold7.js';
import { bind8, place8 } from './carry8.js';
import { BANDS8, nearSet, poseOf, toBind } from './rebuild8.js';
import { shoeGap, ground } from './shoe8.js';
export const LAY8_VERSION = 4;
export const LAY8 = { clear: 0.005, layer: 0.003, girth: true, lambda: 0.02, arapIters: 30, cgIters: 120, binT: 0.01, binA: 72, legUp: 0.32, trunkDown: 0.75, fillet: 0.09, armRoot: 0.08, armRootR: 0.12, armRootIn: 0.05, 
  align: true, alignReg: 0.02, misfit: 0.04, panelStep: 0.002, weldNear: 0.012, waistRings: 1, sew: 0.6, sewRamp: [1e-3, 1e-5, 1e-7, 1e-9], sewDamping: 12,
  settle: 1.2, hz: 600, every: 6, gap: 0.0015, mu: 0.3, th: 0.0008, selfEvery: 4, maxPush6: 0.002, margin6: 0.004, tangleEvery: 30, tangleMove: 0.002,
  compress: 0.2, restAngle: 0, bendScale: 1, foldMax: 2.4, slack: 0.02, damping: 6, vmax: 1.0, pinNear: 0.008, maxMove: 0.25, fallback: 'heatherJersey',
  waist: true, waistEase: 0, drawIn: 0.4, grip: true, trace: false, waistBands: /^(waistband|beltloops|button\.waist)$/,
  length: true, brk: 0.02, hemClear: 0.01, letDown: 0.6, shoeGap: 0.0025, shoeEdge: 0.5,
  over: true, overReach: 0.08, overPush: 0.2, diverge: 0.01 };
const TAU = Math.PI * 2, wrapA = a => a - TAU * Math.floor((a + Math.PI) / TAU);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const count = h => { let c = 0; for (const x of h) c += x; return c; };
// a tailor's tape round a horizontal slice: the perimeter of the convex hull of the slice's points [x, z]
function hullLen(P) { if (P.length < 3) return 0; P.sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); } for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const H = lo.slice(0, -1).concat(up.slice(0, -1)); let s = 0; for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length]; s += Math.hypot(a[0] - b[0], a[1] - b[1]); } return s; }
// the points [x, z] where a triangle mesh (positions X, triangles T; a vertex filter) crosses the height y
function sliceY(X, T, y, keep, out = []) { for (let t = 0; t < T.length; t += 3) { const v = [T[t], T[t + 1], T[t + 2]]; if (keep && !(keep(v[0]) && keep(v[1]) && keep(v[2]))) continue;
    for (let k = 0; k < 3; k++) { const i = v[k], j = v[(k + 1) % 3], yi = X[i * 3 + 1], yj = X[j * 3 + 1]; if ((yi - y) * (yj - y) < 0) { const f = (y - yi) / (yj - yi); out.push([X[i * 3] + f * (X[j * 3] - X[i * 3]), X[i * 3 + 2] + f * (X[j * 3 + 2] - X[i * 3 + 2])]); } } } return out; }
// the length of a welded loop in the FLAT pattern (each edge's own panel's uv)
function flatLoopLen(Wg, uv, ids, keep = null) { const m = Wg.m; let s = 0; for (let k = 0; k < ids.length; k++) { const a = ids[k], b = ids[(k + 1) % ids.length], e = Wg.pe.get(a < b ? a * m + b : b * m + a); if (!e || (keep && !keep(e))) continue; const [i, j] = e; s += Math.hypot(uv[i * 2] - uv[j * 2], uv[i * 2 + 1] - uv[j * 2 + 1]); } return s; }
// THE HEM'S REST ON THE SHOE: a closed hem of flat girth `Gh` passes any horizontal slice of the shoe (and the ankle in it) whose tape (convex
// hull: the hem is a loop of fixed length, free to take any shape) is shorter than it; scanning down from the shoe's top, the first height
// where the tape reaches it is where the hem comes to rest (`y0` when it never does: a hem wider than the foot falls to the floor)
function hemRest(Xb, T, keepB, shoes, Gh, yTop, y0, th) { for (let y = yTop; y > y0; y -= 0.0025) { const Q = sliceY(Xb, T, y, keepB); for (const L of shoes) sliceY(L.Pw, L.Wg.T, y, null, Q); if (hullLen(Q) + th >= Gh) return y; } return y0; }
// THE OUTSEAM TAPE: from the side seam's top down to `yBot`, a tape laid down the outside of the hip, the leg and the shoe, bridging the
// hollows (the outer convex hull of the lateral silhouette: x outward, `sg` the side), as a tailor measures the outseam
function outseamTape(pts, yTop, yBot) { const bins = new Map(), b = 0.005; for (const [x, y] of pts) { if (y > yTop + 1e-9 || y < yBot - 1e-9) continue; const k = Math.round(y / b); if (!(bins.get(k) >= x)) bins.set(k, x); }
  const P = [...bins].map(([k, x]) => [x, k * b]).sort((a, c) => c[1] - a[1]), H = [], cr = (o, a, c) => (a[0] - o[0]) * (c[1] - o[1]) - (a[1] - o[1]) * (c[0] - o[0]);
  for (const q of P) { while (H.length >= 2 && cr(H[H.length - 2], H[H.length - 1], q) >= 0) H.pop(); H.push(q); }
  let s = 0; for (let i = 1; i < H.length; i++) s += Math.hypot(H[i][0] - H[i - 1][0], H[i][1] - H[i - 1][1]); return s; }
// DRAFT THE LENGTH: a leg panel lengthened (or shortened) by `d` between its knee line and its hem, as a tailor alters a trouser leg at
// its lengthen/shorten line below the knee: the flat height `Dk` above the hem becomes `Dk + d`; above the knee line the cut is unchanged
function draftLength(g, ids, vHem, Dk, d) { const vK = vHem + Dk, sc = (Dk + d) / Dk; for (const i of ids) { const v = g.uv[i * 2 + 1]; if (v < vK) g.uv[i * 2 + 1] = vK - (vK - v) * sc; } }
// DRAFT THE WAIST: the flat pattern narrowed by k at the top edge, tapering linearly to nothing `depth` below it (a dart's suppression
// spread over the panel about its own middle); k solved so the top edge's flat length is `L` (the tailor cuts the waist to the measure)
// (rev 4) THE WAIST IS THE OPENING'S EDGES ACROSS THE GRAIN: a top opening also runs down a fly, a placket or a vent, whose edges lie WITH the
// grain in the flat (v: the panel's length); measured with them the cut is long by twice the slit (L23's jeans: 1.45 m of 'waist' against a
// 0.99 m tape, k 1.34: the panels' tops mirrored). Only the edges whose flat run is across the grain (|du| > |dv|) are the waist, and only
// their vertices set each panel's top
function draftWaist(g, Wg, top0, L, depth) { const n = g.X.length / 3, uv0 = Float32Array.from(g.uv), np = Math.max(...g.panel) + 1, m0 = Wg.m;
  const across = e => { const [i, j] = e; return Math.abs(uv0[i * 2] - uv0[j * 2]) > Math.abs(uv0[i * 2 + 1] - uv0[j * 2 + 1]); }, topSet = new Set();
  for (let k = 0; k < top0.length; k++) { const a = top0[k], b = top0[(k + 1) % top0.length], e = Wg.pe.get(a < b ? a * m0 + b : b * m0 + a); if (e && across(e)) { topSet.add(a); topSet.add(b); } }
  const top = top0;
  const uc = new Float64Array(np), vt = new Float64Array(np), has = new Uint8Array(np); { const u0 = new Float64Array(np).fill(Infinity), u1 = new Float64Array(np).fill(-Infinity), vs = new Float64Array(np), c = new Float64Array(np);
    for (let i = 0; i < n; i++) { const p = g.panel[i]; if (!(p >= 0) || !topSet.has(Wg.wid[i])) continue; u0[p] = Math.min(u0[p], uv0[i * 2]); u1[p] = Math.max(u1[p], uv0[i * 2]); vs[p] += uv0[i * 2 + 1]; c[p]++; }
    for (let p = 0; p < np; p++) if (c[p]) { has[p] = 1; uc[p] = (u0[p] + u1[p]) / 2; vt[p] = vs[p] / c[p]; } }
  const apply = k => { const uv = Float32Array.from(uv0); for (let i = 0; i < n; i++) { const p = g.panel[i]; if (!(p >= 0) || !has[p]) continue; const d = vt[p] - uv0[i * 2 + 1], w = Math.min(1, Math.max(0, 1 - d / depth)); uv[i * 2] = uc[p] + (uv0[i * 2] - uc[p]) * (1 - k * w); } return uv; };
  const L0 = flatLoopLen(Wg, uv0, top, across); let k = 1 - L / L0, Lk = L0;
  for (let it = 0; it < 4; it++) { Lk = flatLoopLen(Wg, apply(k), top, across); if (Math.abs(Lk - L) < 5e-4 || Math.abs(L0 - Lk) < 1e-9) break; k *= (L0 - L) / (L0 - Lk); }
  const uv = apply(k); Lk = flatLoopLen(Wg, uv, top, across); g.uv.set(uv); return { k: +k.toFixed(4), flatTop0: +L0.toFixed(4), flatTop: +Lk.toFixed(4), panels: [...has].filter(Boolean).length, waistVerts: topSet.size, openingVerts: top.length }; }
// the bone groups: 0 trunk, 1 arm L, 2 arm R, 3 leg L, 4 leg R
export function boneGroup(name) { const s = /\.L$/.test(name) ? 0 : /\.R$/.test(name) ? 1 : -1; if (s < 0) return 0;
  if (/^(upperarm|lowerarm|elbow|wrist|hand|finger|thumb|metacarpal|palm)/i.test(name)) return 1 + s;
  if (/^(upperleg|lowerleg|knee|foot|toe|ankle)/i.test(name)) return 3 + s; return 0; }
const groupOf = (SI, SW, v, G) => { const w = [0, 0, 0, 0, 0]; for (let k = 0; k < 4; k++) w[G[SI[v * 4 + k]] || 0] += SW[v * 4 + k]; let b = 0; for (let k = 1; k < 5; k++) if (w[k] > w[b]) b = k; return b; };

// ---------------------------------------------------------------- a chart: an axis polyline with a frame
function chart(pts, fwd) { const seg = []; let cum = 0; for (let k = 0; k < pts.length - 1; k++) { const d0 = sub(pts[k + 1], pts[k]), L = Math.hypot(...d0), d = nrm(d0); let e1 = sub(fwd, d.map(x => x * dot(fwd, d))); e1 = nrm(e1); const e2 = crs(d, e1);
    seg.push({ a: pts[k], d, L, e1, e2, t0: cum }); cum += L; } return { seg, len: cum }; }
// an axis polyline with each corner rounded by a circular arc of radius R (cut back at most 0.45 of either segment): the frames of a
// sharp corner's two segments overlap on its inside beyond r tan(phi/2), so cloth laid there crosses itself; an arc keeps the chart
// one-to-one inside radius R (an elbow bent 50 degrees at rest, the hip's turn from the trunk into the leg)
function fillet(pts, R, k = 8) { if (pts.length < 3 || !(R > 0)) return pts; const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) { const A = out[out.length - 1], B = pts[i], C = pts[i + 1], u = nrm(sub(B, A)), v = nrm(sub(C, B)), cphi = Math.max(-1, Math.min(1, dot(u, v))), phi = Math.acos(cphi);
    if (phi < 0.05) { out.push(B); continue; } const c = Math.min(R * Math.tan(phi / 2), 0.45 * Math.hypot(...sub(B, A)), 0.45 * Math.hypot(...sub(C, B))), r = c / Math.tan(phi / 2);
    const n1 = nrm(sub(v, u.map(x => x * cphi))), O = [0, 1, 2].map(q => B[q] - u[q] * c + n1[q] * r);
    for (let j = 0; j <= k; j++) { const a = phi * j / k, ca = Math.cos(a), sa = Math.sin(a); out.push([0, 1, 2].map(q => O[q] - n1[q] * r * ca + u[q] * r * sa)); } }
  out.push(pts[pts.length - 1]); return out; }
// a point -> [t, theta, rho] (the closest point on the polyline; the end segments extend)
function coords(C, x) { let best = null; const n = C.seg.length;
  for (let k = 0; k < n; k++) { const S = C.seg[k], r = sub(x, S.a); let f = dot(r, S.d) / S.L; if (k > 0) f = Math.max(0, f); if (k < n - 1) f = Math.min(1, f);
    const p = [S.a[0] + S.d[0] * f * S.L, S.a[1] + S.d[1] * f * S.L, S.a[2] + S.d[2] * f * S.L], q = sub(x, p), d2 = dot(q, q); if (!best || d2 < best.d2) best = { k, f, q, d2 }; }
  const S = C.seg[best.k]; return [S.t0 + best.f * S.L, Math.atan2(dot(best.q, S.e2), dot(best.q, S.e1)), Math.sqrt(best.d2)]; }
// [t, theta, r] -> a point (the segment holding t; the frame of that segment)
function point(C, t, th, r, out, o = 0) { const n = C.seg.length; let k = 0; while (k < n - 1 && t > C.seg[k].t0 + C.seg[k].L) k++; const S = C.seg[k], f = t - S.t0, c = Math.cos(th) * r, s = Math.sin(th) * r;
  for (let q = 0; q < 3; q++) out[o + q] = S.a[q] + S.d[q] * f + S.e1[q] * c + S.e2[q] * s; }

// ---------------------------------------------------------------- the envelope of a chart: r(t, theta), outermost of its points + clearance
function envelope(C, pts, { binT, binA, clear }) { let t0 = Infinity, t1 = -Infinity; const Q = []; for (const x of pts) { const c = coords(C, x); Q.push(c); t0 = Math.min(t0, c[0]); t1 = Math.max(t1, c[0]); }
  t0 -= 0.05; t1 += 0.05; const nt = Math.max(2, Math.ceil((t1 - t0) / binT) + 1), na = binA, R = new Float64Array(nt * na), has = new Uint8Array(nt * na);
  for (const [t, th, r] of Q) { const i = Math.min(nt - 1, Math.max(0, Math.round((t - t0) / binT))), j = ((Math.floor((th + Math.PI) / TAU * na) % na) + na) % na, k = i * na + j; if (!has[k] || r > R[k]) { R[k] = r; has[k] = 1; } }
  // fill round each ring (circular interpolation between the filled bins), then along t (nearest filled ring)
  const ringOk = new Uint8Array(nt); for (let i = 0; i < nt; i++) { const F = []; for (let j = 0; j < na; j++) if (has[i * na + j]) F.push(j); if (!F.length) continue; ringOk[i] = 1;
    for (let j = 0; j < na; j++) { if (has[i * na + j]) continue; let a = F[F.length - 1], b = F[0]; for (let q = 0; q < F.length; q++) { if (F[q] < j) a = F[q]; if (F[q] > j) { b = F[q]; break; } }
      const da = ((j - a) % na + na) % na, db = ((b - j) % na + na) % na, w = da + db ? db / (da + db) : 0.5; R[i * na + j] = R[i * na + a] * w + R[i * na + b] * (1 - w); } }
  for (let i = 0; i < nt; i++) { if (ringOk[i]) continue; let b = -1; for (let d = 1; d < nt && b < 0; d++) { if (i - d >= 0 && ringOk[i - d]) b = i - d; else if (i + d < nt && ringOk[i + d]) b = i + d; } if (b >= 0) for (let j = 0; j < na; j++) R[i * na + j] = R[b * na + j]; }
  // a max over the 3x3 neighbourhood (the body between bin centres stays inside), then the clearance
  const D = new Float64Array(nt * na); for (let i = 0; i < nt; i++) for (let j = 0; j < na; j++) { let m = 0; for (let a = -1; a <= 1; a++) { const ii = Math.min(nt - 1, Math.max(0, i + a)); for (let b = -1; b <= 1; b++) m = Math.max(m, R[ii * na + ((j + b + na) % na)]); } D[i * na + j] = m + clear; }
  return { t0, nt, na, binT, R: D, k: new Float64Array(nt).fill(1) }; }
// the envelope's radius at (t, theta), bilinear, times its girth factor
function envR(E, t, th) { const ft = Math.min(E.nt - 1, Math.max(0, (t - E.t0) / E.binT)), i = Math.min(E.nt - 2, Math.floor(ft)), wt = Math.min(1, ft - i), fa = ((th + Math.PI) / TAU * E.na - 0.5 + E.na) % E.na, j = Math.floor(fa), wa = fa - j, j1 = (j + 1) % E.na;
  const r0 = E.R[i * E.na + j] * (1 - wa) + E.R[i * E.na + j1] * wa, r1 = E.R[(i + 1) * E.na + j] * (1 - wa) + E.R[(i + 1) * E.na + j1] * wa, k = E.k[i] * (1 - wt) + E.k[i + 1] * wt; return (r0 * (1 - wt) + r1 * wt) * k; }
// a laid panel's (arc, t) -> each vertex's (t, theta) on its chart
function solveTT(A) { const { L, Z } = A, n = L.ids.length; A.Tq = new Float64Array(n); A.Th = new Float64Array(n);
  for (let q = 0; q < n; q++) { A.Tq[q] = Z[q * 2 + 1]; A.Th[q] = angleAt(L.E, Z[q * 2 + 1], L.thm, Z[q * 2]); } return A; }
// the arc length round the envelope at t from theta a to theta b (b - a in (-2pi, 2pi)), by 2-degree steps
function arc(E, t, a, b) { const n = Math.max(1, Math.ceil(Math.abs(b - a) / 0.035)), h = (b - a) / n; let s = 0, rp = envR(E, t, a); for (let q = 1; q <= n; q++) { const r = envR(E, t, a + h * q); s += Math.sqrt(((r + rp) / 2 * h) ** 2 + (r - rp) ** 2); rp = r; } return Math.sign(b - a) * s; }
function circ(E, t) { return arc(E, t, -Math.PI, Math.PI); }
// the angle at arc s from theta a (the inverse of arc, by steps)
function angleAt(E, t, a, s) { const dir = s >= 0 ? 1 : -1, h = 0.01 * dir; let th = a, acc = 0, rp = envR(E, t, a), it = 0; const goal = Math.abs(s);
  while (acc < goal && it < 2000) { const r = envR(E, t, th + h), ds = Math.sqrt(((r + rp) / 2 * h) ** 2 + (r - rp) ** 2); if (acc + ds >= goal) return th + h * (goal - acc) / ds; acc += ds; th += h; rp = r; it++; } return th; }

// ---------------------------------------------------------------- 2D as-rigid-as-possible: the flat panel U fitted to targets Y
function arap2(U, T, Y, { lambda: lam0, iters, cg }) { const n = U.length / 2, nt = T.length / 3, lam = typeof lam0 === 'number' ? new Float64Array(n).fill(lam0) : lam0;
  // mirror: the panel's flat orientation against the targets' (a panel cut the other side up is laid face out)
  let sg = 0; for (let t = 0; t < nt; t++) { const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2], au = (U[b * 2] - U[a * 2]) * (U[c * 2 + 1] - U[a * 2 + 1]) - (U[c * 2] - U[a * 2]) * (U[b * 2 + 1] - U[a * 2 + 1]), ay = (Y[b * 2] - Y[a * 2]) * (Y[c * 2 + 1] - Y[a * 2 + 1]) - (Y[c * 2] - Y[a * 2]) * (Y[b * 2 + 1] - Y[a * 2 + 1]); sg += Math.sign(au) * Math.sign(ay); }
  const mir = sg < 0, Uf = Float64Array.from(U, (x, i) => (mir && i % 2 === 0 ? -x : x));
  // Procrustes start (rotation + translation)
  let cu = [0, 0], cy = [0, 0]; for (let i = 0; i < n; i++) { cu[0] += Uf[i * 2]; cu[1] += Uf[i * 2 + 1]; cy[0] += Y[i * 2]; cy[1] += Y[i * 2 + 1]; } cu = cu.map(x => x / n); cy = cy.map(x => x / n);
  let sc = 0, ss = 0; for (let i = 0; i < n; i++) { const ux = Uf[i * 2] - cu[0], uy = Uf[i * 2 + 1] - cu[1], yx = Y[i * 2] - cy[0], yy = Y[i * 2 + 1] - cy[1]; sc += ux * yx + uy * yy; ss += ux * yy - uy * yx; }
  const ph = Math.atan2(ss, sc), c0 = Math.cos(ph), s0 = Math.sin(ph), Z = new Float64Array(n * 2); for (let i = 0; i < n; i++) { const ux = Uf[i * 2] - cu[0], uy = Uf[i * 2 + 1] - cu[1]; Z[i * 2] = cy[0] + c0 * ux - s0 * uy; Z[i * 2 + 1] = cy[1] + s0 * ux + c0 * uy; }
  // the Laplacian (uniform weights per triangle edge) as CSR
  const nb = Array.from({ length: n }, () => new Map()); for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const a = T[t * 3 + k], b = T[t * 3 + (k + 1) % 3]; nb[a].set(b, (nb[a].get(b) || 0) + 1); nb[b].set(a, (nb[b].get(a) || 0) + 1); }
  const deg = new Float64Array(n), off = new Int32Array(n + 1); for (let i = 0; i < n; i++) { off[i + 1] = off[i] + nb[i].size; for (const w of nb[i].values()) deg[i] += w; }
  const col = new Int32Array(off[n]), wv = new Float64Array(off[n]); for (let i = 0; i < n; i++) { let q = off[i]; for (const [j, w] of nb[i]) { col[q] = j; wv[q] = w; q++; } }
  const Ax = (x, out) => { for (let i = 0; i < n; i++) { let s = (deg[i] + lam[i]) * x[i]; for (let q = off[i]; q < off[i + 1]; q++) s -= wv[q] * x[col[q]]; out[i] = s; } };
  const solve = (b, x) => { const r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n); Ax(x, Ap); let rz = 0; for (let i = 0; i < n; i++) { r[i] = b[i] - Ap[i]; z[i] = r[i] / (deg[i] + lam[i]); p[i] = z[i]; rz += r[i] * z[i]; }
    for (let it = 0; it < cg && rz > 1e-18; it++) { Ax(p, Ap); let pAp = 0; for (let i = 0; i < n; i++) pAp += p[i] * Ap[i]; const al = rz / pAp; let rz2 = 0; for (let i = 0; i < n; i++) { x[i] += al * p[i]; r[i] -= al * Ap[i]; z[i] = r[i] / (deg[i] + lam[i]); rz2 += r[i] * z[i]; } const be = rz2 / rz; rz = rz2; for (let i = 0; i < n; i++) p[i] = z[i] + be * p[i]; } };
  const Rc = new Float64Array(nt), Rs = new Float64Array(nt), bx = new Float64Array(n), by = new Float64Array(n), zx = new Float64Array(n), zy = new Float64Array(n); for (let i = 0; i < n; i++) { zx[i] = Z[i * 2]; zy[i] = Z[i * 2 + 1]; }
  for (let it = 0; it < iters; it++) {
    for (let t = 0; t < nt; t++) { let a1 = 0, a2 = 0; for (let k = 0; k < 3; k++) { const i = T[t * 3 + k], j = T[t * 3 + (k + 1) % 3], ux = Uf[j * 2] - Uf[i * 2], uy = Uf[j * 2 + 1] - Uf[i * 2 + 1], qx = zx[j] - zx[i], qy = zy[j] - zy[i]; a1 += qx * ux + qy * uy; a2 += qy * ux - qx * uy; } const p = Math.atan2(a2, a1); Rc[t] = Math.cos(p); Rs[t] = Math.sin(p); }
    for (let i = 0; i < n; i++) { bx[i] = lam[i] * Y[i * 2]; by[i] = lam[i] * Y[i * 2 + 1]; }
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const i = T[t * 3 + k], j = T[t * 3 + (k + 1) % 3], ux = Uf[i * 2] - Uf[j * 2], uy = Uf[i * 2 + 1] - Uf[j * 2 + 1], rx = Rc[t] * ux - Rs[t] * uy, ry = Rs[t] * ux + Rc[t] * uy; bx[i] += rx; by[i] += ry; bx[j] -= rx; by[j] -= ry; }
    solve(bx, zx); solve(by, zy); }
  // what it did: flipped triangles (none, if the layout folds nowhere), the stretch of the layout against the flat
  let flip = 0, st = []; for (let t = 0; t < nt; t++) { const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2], au = (Uf[b * 2] - Uf[a * 2]) * (Uf[c * 2 + 1] - Uf[a * 2 + 1]) - (Uf[c * 2] - Uf[a * 2]) * (Uf[b * 2 + 1] - Uf[a * 2 + 1]), az = (zx[b] - zx[a]) * (zy[c] - zy[a]) - (zx[c] - zx[a]) * (zy[b] - zy[a]); if (Math.sign(au) !== Math.sign(az)) flip++; if (Math.abs(au) > 1e-12) st.push(az / au); }
  st.sort((a, b) => a - b); for (let i = 0; i < n; i++) { Z[i * 2] = zx[i]; Z[i * 2 + 1] = zy[i]; }
  let mf = 0, wsum = 0; for (let i = 0; i < n; i++) { mf += lam[i] * ((Z[i * 2] - Y[i * 2]) ** 2 + (Z[i * 2 + 1] - Y[i * 2 + 1]) ** 2); wsum += lam[i]; } mf = Math.sqrt(mf / (wsum || 1));   // (over the vertices that have a target)
  return { Z, mir, flip, misfit: mf, areaP10: st.length ? +st[Math.floor(st.length * 0.1)].toFixed(3) : null, areaP90: st.length ? +st[Math.floor(st.length * 0.9)].toFixed(3) : null }; }

// ---------------------------------------------------------------- the panels of one chart turned and slid so their seams meet
// Each panel was laid where the bake had it (its mean angle round the axis, its height); two panels sewn together on the same chart (a
// front and a back at the side seams, a sleeve's own underarm seam, a cuff on its sleeve) then meet only as well as the bake's places
// agree with the cut. Here every panel on a chart gets a slide round the ring (sigma, metres of arc), a slide along the axis (tau) and a
// small turn (omega), the least-squares solution that brings each seam pair to one place (Tikhonov-regularised: the bake's placement
// kept where the seams do not decide). The cut is not changed; the panels move rigidly in the chart's unrolled plane.
function alignChart(lays, pairs, reg) { const k = lays.length; if (!k || !pairs.length) return { pairs: 0 };
  const N = 3 * k, A = new Float64Array(N * N), b = new Float64Array(N), cen = lays.map(L => { let s = 0, t = 0; const n = L.Z.length / 2; for (let q = 0; q < n; q++) { s += L.Z[q * 2]; t += L.Z[q * 2 + 1]; } return [s / n, t / n]; });
  const row = (co, d) => { for (const [i, a] of co) { b[i] -= a * d; for (const [j, c] of co) A[i * N + j] += a * c; } };
  let r0 = 0; for (const [pa, qa, sa, ta, pb, qb, sb, tb, ds] of pairs) { const ca = cen[pa], cb = cen[pb];
    const cs = new Map(), add = (m, i, v) => m.set(i, (m.get(i) || 0) + v); add(cs, pa * 3, 1); add(cs, pb * 3, -1); add(cs, pa * 3 + 2, -(ta - ca[1])); add(cs, pb * 3 + 2, (tb - cb[1]));
    const ct = new Map(); add(ct, pa * 3 + 1, 1); add(ct, pb * 3 + 1, -1); add(ct, pa * 3 + 2, (sa - ca[0])); add(ct, pb * 3 + 2, -(sb - cb[0]));
    row([...cs].filter(x => x[1] !== 0), ds); row([...ct].filter(x => x[1] !== 0), ta - tb); r0 += ds * ds + (ta - tb) ** 2; }
  const w = reg * pairs.length / k; for (let p = 0; p < k; p++) { const n = lays[p].Z.length / 2; let L2 = 0; for (let q = 0; q < n; q++) L2 += (lays[p].Z[q * 2] - cen[p][0]) ** 2 + (lays[p].Z[q * 2 + 1] - cen[p][1]) ** 2; L2 /= n; A[(p * 3) * N + p * 3] += w; A[(p * 3 + 1) * N + p * 3 + 1] += w; A[(p * 3 + 2) * N + p * 3 + 2] += w * L2; }
  // Gaussian elimination with partial pivoting
  const M = Array.from({ length: N }, (_, i) => [...A.subarray(i * N, i * N + N), b[i]]);
  for (let c = 0; c < N; c++) { let piv = c; for (let r = c + 1; r < N; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; [M[c], M[piv]] = [M[piv], M[c]]; const d = M[c][c]; if (Math.abs(d) < 1e-15) continue;
    for (let r = 0; r < N; r++) { if (r === c) continue; const f = M[r][c] / d; if (f) for (let j = c; j <= N; j++) M[r][j] -= f * M[c][j]; } }
  const x = M.map((r, i) => (Math.abs(r[i]) > 1e-15 ? r[N] / r[i] : 0));
  lays.forEach((L, p) => { const sg = x[p * 3], ta = x[p * 3 + 1], om = x[p * 3 + 2], n = L.Z.length / 2; for (let q = 0; q < n; q++) { const s = L.Z[q * 2], t = L.Z[q * 2 + 1]; L.Z[q * 2] = s + sg - om * (t - cen[p][1]); L.Z[q * 2 + 1] = t + ta + om * (s - cen[p][0]); } });
  let r1 = 0; for (const [pa, qa, , , pb, qb, , , ds0] of pairs) { void ds0; const La = lays[pa], Lb = lays[pb]; r1 += (La.Z[qa * 2 + 1] - Lb.Z[qb * 2 + 1]) ** 2; }
  return { pairs: pairs.length, rmsBeforeMm: +(Math.sqrt(r0 / pairs.length / 2) * 1000).toFixed(1), shifts: lays.map((L, p) => `${L.L.p}:${(x[p * 3] * 1000).toFixed(0)}/${(x[p * 3 + 1] * 1000).toFixed(0)}/${(x[p * 3 + 2] * 57.3).toFixed(1)}`).join(' ') };
}

// ---------------------------------------------------------------- lay8
export function lay8(parts, { M, scale, body, joints, bones, opt = {}, log = () => {} } = {}) {
  const S = { ...LAY8, ...opt }, t00 = Date.now(), rep = { version: LAY8_VERSION, opt: S, garments: {}, carried: {} };
  const G = bones.map(boneGroup), J = k => { const v = joints[k]; if (!v) throw new Error('lay8: no joint ' + k); return v; };
  const gar = parts.filter(q => q.group === 'garment' && q.uv && q.panel), P0 = new Map(parts.map(q => [q, poseOf(q, M, scale)]));
  // the body at rest (metres) with the skin the page culls; each vertex's segment
  const nb = body.X.length / 3, Xb = skinPose(body.X, body.SI, body.SW, M, new Float64Array(nb * 3), scale), surf = new SurfaceMesh(Xb, Int32Array.from(body.T), { cell: 0.02, boundary: false });
  const bg = new Uint8Array(nb); for (let v = 0; v < nb; v++) bg[v] = groupOf(body.SI, body.SW, v, G);
  // only the skin's own surface (a vertex some triangle uses: the base mesh carries unused helper vertices, e.g. between the knees)
  const usedB = new Uint8Array(nb); for (const v of body.T) usedB[v] = 1;
  // THE CHARTS (the person's own joints at rest; forward = +z, the bind's facing)
  // the trunk's axis is ONE straight line (hip midpoint to the neck's base: the spine's own kinks would fold a 15 cm radius over itself);
  // an arm's and a leg's run through their joints with each corner rounded (fillet)
  const fwd = [0, 0, 1], mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], hipM = mid(J('upperleg01.L'), J('upperleg01.R')), nk = J('neck01'), up = nrm(sub(nk, hipM));
  const trunkPts = [[hipM[0] - up[0] * S.trunkDown, hipM[1] - up[1] * S.trunkDown, hipM[2] - up[2] * S.trunkDown], [nk[0] + up[0] * 0.08, nk[1] + up[1] * 0.08, nk[2] + up[2] * 0.08]];
  const arm = s => { const a = J('upperarm01.' + s), e = J('lowerarm01.' + s), w = J('wrist.' + s), d = nrm(sub(a, e)), f = nrm(sub(w, e)); return fillet([[a[0] + d[0] * S.armRoot, a[1] + d[1] * S.armRoot, a[2] + d[2] * S.armRoot], a, e, w, [w[0] + f[0] * 0.12, w[1] + f[1] * 0.12, w[2] + f[2] * 0.12]], S.fillet); };
  const leg = s => { const hp = J('upperleg01.' + s), kn = J('lowerleg01.' + s), ft = J('foot.' + s); return fillet([[hp[0], hp[1] + S.legUp, hp[2]], hp, kn, ft], S.fillet); };
  const CH = [chart(trunkPts, fwd), chart(arm('L'), fwd), chart(arm('R'), fwd), chart(leg('L'), fwd), chart(leg('R'), fwd)];
  // each chart's body points: the trunk: every vertex not an arm's; an arm: its own and the shoulder above its joint; a leg: its own and
  // its half of the trunk from the hip up (the midline cut)
  const hipY = hipM[1], bodyPts = CH.map(() => []);
  // the crotch: the lowest body point on the midline between the hips and the knees (the legs part below it)
  let crotchY = hipY; for (let v = 0; v < nb; v++) { if (!usedB[v]) continue; const x = Xb[v * 3], y = Xb[v * 3 + 1]; if (Math.abs(x) < 0.006 && y < hipY + 0.05 && y > hipY - 0.25 && y < crotchY) crotchY = y; } rep.crotchY = +crotchY.toFixed(4);
  for (let v = 0; v < nb; v++) { if (!usedB[v]) continue; const x = [Xb[v * 3], Xb[v * 3 + 1], Xb[v * 3 + 2]], g = bg[v];
    if (g === 0 || g >= 3) bodyPts[0].push(x);
    if (g === 1 || g === 2) { bodyPts[g].push(x); if (coords(CH[g], x)[0] < S.armRoot + S.armRootIn) bodyPts[0].push(x); }   // the arm's root is the trunk's too: the armhole rings it
    else if (g === 0) for (const s of [1, 2]) { const c = coords(CH[s], x); if (c[0] < S.armRoot && c[2] < S.armRootR) bodyPts[s].push(x); }
    if (g === 3 || g === 4) bodyPts[g].push(x);
    else if (g === 0 && x[1] > hipY - 0.02) bodyPts[x[0] > 0 ? 3 : 4].push(x); }
  // garments inner first: by the median distance of the bake's cloth off the body (the outfit's layer order, as the cloth lies)
  const off = g => { const P = P0.get(g), d = []; for (let i = 0; i < P.length; i += 21) { const q = surf.closestAny(P[i], P[i + 1], P[i + 2], 0.2); if (q) d.push(q.d); } d.sort((a, b) => a - b); return d.length ? d[d.length >> 1] : 0; };
  // (the outfit's own dressing order when the bake carries it (its stack: an untucked top goes on after the trousers it hangs over)
  const so = S.order || null, rank = g => { const i = so ? so.indexOf(g.name) : -1; return i < 0 ? 1e3 : i; };
  const order = gar.map(g => [g, off(g)]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]); rep.order = order.map(g => g.name);
  const nearBand = nearSet(parts.filter(q => q.group === 'construction' && BANDS8.test(q.name)).map(q => P0.get(q)), S.pinNear);
  // what is sewn on a garment follows its cloth; a waist band (the waistband, its belt loops, its button) too when the garment's waist is
  // drafted and seated (rev 2): the band no longer holds the cloth, the cloth carries the band
  const binds = []; for (const q of parts) { if (q.group !== 'construction') continue; const band = BANDS8.test(q.name); if (band && !(S.waist && S.waistBands.test(q.name))) continue; const g = gar.find(x => x.owner === q.owner || x.name === q.owner); if (!g) continue; binds.push({ q, g, band, B: bind8(P0.get(q), P0.get(g), g.T) }); }
  // a garment sewn from trunk panels to arm panels (its panels' skin weights on both): the armhole join
  const armJoin = g => { const np = Math.max(...g.panel) + 1, cnt = Array.from({ length: np }, () => [0, 0, 0, 0, 0]); for (let i = 0; i < g.X.length / 3; i++) if (g.panel[i] >= 0) cnt[g.panel[i]][groupOf(g.SI, g.SW, i, G)]++;
    const dom = cnt.map(w => w.indexOf(Math.max(...w))); return dom.some(b => b === 1 || b === 2) && dom.some(b => b === 0); };
  const laid = [];   // [{ g, Wg, Pw }] the garments laid so far (inner first): the next garment's envelope and obstacles
  // the boots (rigid, at rest): in the legs' envelopes and obstacles to every garment (a trouser hem rests on the boot, not in it)
  for (const q of parts) { if (q.group !== 'boot') continue; const Wq = weldGarment(q), Pq = P0.get(q), Pw = new Float64Array(Wq.m * 3); for (let w = 0; w < Wq.m; w++) for (let c = 0; c < 3; c++) Pw[w * 3 + c] = Pq[Wq.rep[w] * 3 + c];
    laid.push({ g: q, Wg: Wq, Pw, rigid: true }); }
  // and the boots' shells (upper and sole: closed, outward normals) as a collider, as the stack dressed over them: Self6 alone let a
  // settling hem into the boot (L05: 20-30 -> ~90 triangles a side through boot.upper)
  let bootSurf = null; { const BX = [], BT = []; for (const L of laid) { if (!L.rigid || !/upper|sole/.test(L.g.name)) continue; const o = BX.length / 3; BX.push(...L.Pw); for (const v of L.Wg.T) BT.push(v + o); }
    if (BT.length) bootSurf = rigidSurface(Float64Array.from(BX), Int32Array.from(BT), { cell: 0.03 }); }
  // (rev 3) the shoes' contact distance from the cloth's own edge (shoe8.js: a corner of the shoe never passes between two particles), and
  // the GROUND under the soles (a hem that reaches the floor rests on it)
  let floor = null; { let y0 = Infinity, cx = 0, cz = 0, c = 0; for (const L of laid) { if (!L.rigid) continue; for (let w = 0; w < L.Wg.m; w++) { y0 = Math.min(y0, L.Pw[w * 3 + 1]); cx += L.Pw[w * 3]; cz += L.Pw[w * 3 + 2]; c++; } }
    if (!c) for (let v = 0; v < nb; v++) if (usedB[v]) { y0 = Math.min(y0, Xb[v * 3 + 1]); cx += Xb[v * 3]; cz += Xb[v * 3 + 2]; c++; } floor = ground(y0, cx / c, cz / c); rep.groundY = +y0.toFixed(4); }
  const bootC = (ns, fab, mask, g) => [...(bootSurf ? [{ mesh: bootSurf, gap: new Float64Array(ns).fill(shoeGap(g, fab.h, { min: S.shoeGap, edge: S.shoeEdge })), mu: S.mu, reach: 0.04, mask }] : []),
    { mesh: floor, gap: new Float64Array(ns).fill(S.gap + fab.h / 2), mu: S.mu, reach: 0.04, mask }];
  // THE HANG OVER (rev 4): a top joined at the armhole (kept as the bake has it until the armhole is laid) put on OVER garments laid anew
  // (the trousers under an untucked shirt, sweatshirt or tee; a coat over both). Above the garments under it the top lies as the bake has
  // it; below the top of what it now covers (+ `overReach`, where its cloth turns from lying on the body to hanging over the garments) it
  // HANGS: its own cloth at its PATTERN lengths (the cut, as every lay8 settle), the fabric's bending, gravity, the body and the garments
  // under it as colliders: each one's outside a one-sided floor (as the tuck's floor: a top comes to rest on the jeans' waist, never in
  // it) and, with everything else laid, Self6's obstacles. Where a band gathers it (a rib hem band, the cuff joins) the cloth keeps the
  // band's own girth: the cloth eased into a band is held to the band's length (the band grips; the band itself is carried by the cloth).
  // What is sewn on the top (bands, plackets, pockets, turned hems) follows its cloth (carry8). Nothing is fitted to a picture; the same
  // rule for every top and every person. Returns the welded settled places (Pf) and a report; the top's bind X written in place.
  const hangOver = (g, Wg, Pw0, under, fab) => { const m = Wg.m, n = g.X.length / 3, ro = {};
    // the top of what it covers: a drafted garment's waist (its top opening as settled), a hung top's own (the waist it hangs over: a coat
    // over a hung shirt took the shirt's shoulders, and its whole body hung from the sleeves, L23 p95 44 mm); else its highest cloth (L23's
    // jeans reach 15 cm above their waist somewhere: the zone reached the chest and 59 particles of the shirt fell past maxMove)
    let yU = -Infinity; for (const L of under) { if (L.topY != null) { yU = Math.max(yU, L.topY); continue; } for (let w = 0; w < L.Wg.m; w++) { const q = groupOf(L.g.SI, L.g.SW, L.Wg.rep[w], G); if (q !== 1 && q !== 2) yU = Math.max(yU, L.Pw[w * 3 + 1]); } }
    const yZ = yU + S.overReach, zone = new Uint8Array(m); let nz = 0;
    for (let w = 0; w < m; w++) { const q = groupOf(g.SI, g.SW, Wg.rep[w], G); if (q !== 1 && q !== 2 && Pw0[w * 3 + 1] < yZ) { zone[w] = 1; nz++; } }
    { const usedW = new Uint8Array(m); for (const v of Wg.T) usedW[v] = 1; for (let w = 0; w < m; w++) if (!usedW[w] && zone[w]) { zone[w] = 0; nz--; } }
    ro.underTopY = +yU.toFixed(4); ro.zoneTopY = +yZ.toFixed(4); ro.zone = nz; if (nz < 20) { ro.skipped = 'nothing of it below ' + yZ.toFixed(3); ro.Pf = Pw0; return ro; }
    // the top's own sewn parts (bands too: carried by the cloth here, not holding it)
    const own = parts.filter(q => q.group === 'construction' && (q.owner === g.owner || q.owner === g.name) && q.T?.length), B8 = own.map(q => ({ q, B: bind8(P0.get(q), P0.get(g), g.T) }));
    const bandP = own.filter(q => BANDS8.test(q.name)).map(q => P0.get(q)), nearB = bandP.length ? nearSet(bandP, S.pinNear) : () => false;
    const gath = new Uint8Array(m); for (let w = 0; w < m; w++) if (zone[w] && nearB(Pw0[w * 3], Pw0[w * 3 + 1], Pw0[w * 3 + 2])) gath[w] = 1; ro.gathered = count(gath);
    // the triangles: the pattern's frame (the cut), the bake's own where the cloth is gathered into a band (its girth)
    const tri = [], met = []; for (let t = 0; t < g.T.length; t += 3) { const i = g.T[t], j = g.T[t + 1], k = g.T[t + 2], a = Wg.wid[i], b = Wg.wid[j], c = Wg.wid[k]; if (a === b || b === c || a === c) continue;
      if (gath[a] || gath[b] || gath[c]) { const A = [Pw0[a * 3], Pw0[a * 3 + 1], Pw0[a * 3 + 2]], e1 = sub([Pw0[b * 3], Pw0[b * 3 + 1], Pw0[b * 3 + 2]], A), e2 = sub([Pw0[c * 3], Pw0[c * 3 + 1], Pw0[c * 3 + 2]], A), l1 = Math.hypot(...e1); if (l1 < 1e-7) continue;
        const u = e1.map(x => x / l1), px = dot(e2, u), py = Math.sqrt(Math.max(0, dot(e2, e2) - px * px)); if (py < 1e-7) continue; tri.push(a, b, c); met.push(0, 0, l1, 0, px, py); continue; }
      const du1 = g.uv[j * 2] - g.uv[i * 2], dv1 = g.uv[j * 2 + 1] - g.uv[i * 2 + 1], du2 = g.uv[k * 2] - g.uv[i * 2], dv2 = g.uv[k * 2 + 1] - g.uv[i * 2 + 1]; if (Math.abs(du1 * dv2 - du2 * dv1) < 1e-12) continue;
      tri.push(a, b, c); met.push(g.uv[i * 2], g.uv[i * 2 + 1], g.uv[j * 2], g.uv[j * 2 + 1], g.uv[k * 2], g.uv[k * 2 + 1]); }
    // the obstacles: everything laid so far (Self6), pinned
    const Xo = [], To = [], Mo = [], Ho = []; for (const L of laid) { let hu; try { hu = phys(L.g.fabric).h; } catch (e) { hu = fab.h; } const base = m + Xo.length / 3; for (let w = 0; w < L.Wg.m; w++) { Xo.push(L.Pw[w * 3], L.Pw[w * 3 + 1], L.Pw[w * 3 + 2]); Ho.push(Math.max(S.th, hu / 2)); }
      for (let t = 0; t < L.Wg.T.length; t += 3) { const a = L.Wg.T[t], b = L.Wg.T[t + 1], c = L.Wg.T[t + 2]; To.push(base + a, base + b, base + c); const e1 = sub([L.Pw[b * 3], L.Pw[b * 3 + 1], L.Pw[b * 3 + 2]], [L.Pw[a * 3], L.Pw[a * 3 + 1], L.Pw[a * 3 + 2]]), e2 = sub([L.Pw[c * 3], L.Pw[c * 3 + 1], L.Pw[c * 3 + 2]], [L.Pw[a * 3], L.Pw[a * 3 + 1], L.Pw[a * 3 + 2]]), l1 = Math.hypot(...e1) || 1e-6, u = e1.map(x => x / l1), px = dot(e2, u), py = Math.sqrt(Math.max(1e-14, dot(e2, e2) - px * px)); Mo.push(0, 0, l1, 0, px, py); } }
    const ns = m + Xo.length / 3, X0 = new Float64Array(ns * 3), pin = new Uint8Array(ns); X0.set(Pw0); X0.set(Xo, m * 3); for (let i = 0; i < m; i++) if (!zone[i]) pin[i] = 1; for (let i = m; i < ns; i++) pin[i] = 1;
    const cl = new Cloth(X0, Int32Array.from([...tri, ...To]), fab, { X0, pin, metric: Float64Array.from([...met, ...Mo]), foldMax: S.foldMax, tether: false, restAngle: S.restAngle, bendScale: S.bendScale, compress: S.compress, slack: S.slack, damping: S.damping, vmax: S.vmax });
    cl.c6 = new Self6(cl, { th: Float64Array.from([...new Array(m).fill(Math.max(S.th, fab.h / 2)), ...Ho]), every: S.selfEvery, maxPush: S.maxPush6, mu: S.mu, margin: S.margin6, tangleEvery: S.tangleEvery, tangleMove: S.tangleMove }); cl.c6.updateTangled(cl.X);
    ro.tangledAtStart = count(cl.c6.tangled.subarray(0, m));
    // the floors: each garment under it, its outside (its arms left out), at the two cloths' half thicknesses apart
    const mask = Uint8Array.from(pin, p => (p ? 0 : 1)), floors = []; for (const L of under) { const ga = new Uint8Array(L.Wg.m); for (let w = 0; w < L.Wg.m; w++) { const q = groupOf(L.g.SI, L.g.SW, L.Wg.rep[w], G); ga[w] = q === 1 || q === 2 ? 1 : 0; }
      const T2 = []; for (let t = 0; t < L.Wg.T.length; t += 3) { const a = L.Wg.T[t], b = L.Wg.T[t + 1], c = L.Wg.T[t + 2]; if (!ga[a] && !ga[b] && !ga[c]) T2.push(a, b, c); } if (T2.length < 90) continue;
      let hu; try { hu = phys(L.g.fabric).h; } catch (e) { hu = fab.h; } floors.push({ mesh: new SurfaceMesh(L.Pw, Int32Array.from(T2), { cell: 0.02, boundary: true }), gap: new Float64Array(ns).fill(fab.h / 2 + hu / 2 + S.gap), mu: S.mu, reach: 0.04, mask, garment: true }); }
    const ct = new Contacts(ns, [{ mesh: surf, gap: new Float64Array(ns).fill(S.gap + fab.h / 2), mu: S.mu, reach: 0.04, mask }, ...bootC(ns, fab, mask, g), ...floors], { reach: 0.04, safe: true });
    // how much of it the garments under it now cover (a particle inside a floor's gap), before
    const inF = X => { let k = 0; for (let i = 0; i < m; i++) { if (pin[i]) continue; for (const F of floors) { const q = F.mesh.closestAny(X[i * 3], X[i * 3 + 1], X[i * 3 + 2], 0.04); if (q && !q.edge && q.d < F.gap[0] - 0.0005) { k++; break; } } } return k; };
    ro.inUnderBefore = inF(X0);
    // first the floors push it out with gravity off (where the garments under it now stand further out than the bake's), then it hangs
    const gS = cl.gravity; cl.gravity = [0, 0, 0]; cl.run(S.overPush, { hz: S.hz, contacts: ct, every: S.every }); cl.gravity = gS; cl.V.fill(0);
    cl.run(S.settle, { hz: S.hz, contacts: ct, every: S.every });
    let nan = 0, blown = 0; const Pf = new Float64Array(m * 3), mv = new Uint8Array(n), mvW = new Uint8Array(m), dd = [];
    for (let i = 0; i < m; i++) { const x = cl.X[i * 3], y = cl.X[i * 3 + 1], z = cl.X[i * 3 + 2]; if (pin[i]) { Pf.set(Pw0.subarray(i * 3, i * 3 + 3), i * 3); continue; }
      if (!Number.isFinite(x + y + z)) { nan++; Pf.set(Pw0.subarray(i * 3, i * 3 + 3), i * 3); continue; } const d = Math.hypot(x - Pw0[i * 3], y - Pw0[i * 3 + 1], z - Pw0[i * 3 + 2]);
      if (d > S.maxMove) { blown++; Pf.set(Pw0.subarray(i * 3, i * 3 + 3), i * 3); continue; } Pf[i * 3] = x; Pf[i * 3 + 1] = y; Pf[i * 3 + 2] = z; if (d > 2e-5) { mvW[i] = 1; dd.push(d); } }
    dd.sort((a, b) => a - b); const pc = f => dd.length ? +(dd[Math.min(dd.length - 1, Math.floor(f * dd.length))] * 1000).toFixed(1) : 0;
    if (blown > S.diverge * m) { ro.diverged = { blown, nan }; ro.Pf = Pw0; return ro; }   // (a hang that blew up is not written: the bake)
    ro.inUnderAfter = inF(Pf); ro.moved = dd.length; ro.movedMm = { p50: pc(0.5), p95: pc(0.95), max: pc(1) }; ro.nan = nan; ro.blown = blown; ro.tangledAfter = count(cl.c6.tangled.subarray(0, m)); ro.floors = floors.length;
    { const ident = Int32Array.from({ length: m }, (_, i) => i); ro.cross = { bake: count(selfIntersections(Pw0, Wg.T, { wid: ident }).hit), hung: count(selfIntersections(Pf, Wg.T, { wid: ident }).hit) }; }
    // back to bind (the rest pose's matrices), the moved vertices only; what is sewn on it follows
    const Pn = new Float64Array(n * 3); for (let i = 0; i < n; i++) { const w = Wg.wid[i]; mv[i] = mvW[w]; for (let c = 0; c < 3; c++) Pn[i * 3 + c] = Pf[w * 3 + c]; }
    toBind(g, Pn, M, scale, mv); P0.set(g, poseOf(g, M, scale));
    for (const { q, B } of B8) { const Xq = Float64Array.from(P0.get(q)), k = place8(B, P0.get(g), g.T, Xq, mv); if (!k) continue; toBind(q, Xq, M, scale, null); P0.set(q, poseOf(q, M, scale)); rep.carried[q.name] = (rep.carried[q.name] || 0) + k; }
    ro.Pf = Pf; return ro; };
  for (const g of order) {
    const t0 = Date.now(), Wg = weldGarment(g), m = Wg.m, n = g.X.length / 3, Pb = P0.get(g), np = Math.max(...g.panel) + 1, r = { panels: [] }, uvBake = Float32Array.from(g.uv);
    // the garment's own clearance: the envelope round the body and every garment already laid, plus this cloth's layer
    let fab; try { fab = phys(g.fabric); } catch (e) { fab = phys(S.fallback); }
    const clear = S.clear + fab.h / 2 + (laid.some(L => !L.rigid) ? S.layer : 0), pts = bodyPts.map(L => L.slice());
    for (const L of laid) for (let w = 0; w < L.Wg.m; w++) { const x = [L.Pw[w * 3], L.Pw[w * 3 + 1], L.Pw[w * 3 + 2]]; for (let c = 0; c < 5; c++) { if (c === 0) { pts[0].push(x); continue; } const k = coords(CH[c], x); if (c <= 2 ? k[0] > -0.02 && k[2] < 0.15 : k[2] < 0.25 && (c === 3 ? x[0] > -0.005 : x[0] < 0.005)) pts[c].push(x); } }
    // each panel's chart: the segment its vertices' skin weights hold most (a trouser panel's leg; a skirt's or a bodice's trunk: a panel
    // that spans both legs (its vertices on both sides) is the trunk's)
    // a skirt (or a coat's skirt) hangs round both legs: below the crotch it ends in ONE opening (its hem); trousers end in two (a leg
    // each). Counted on the garment's own free edges, not on where the bake's cloth happens to lie
    let low = 0; for (const L of Wg.loops) { if (L.ids.length < 20) continue; let y = 0; for (const w of L.ids) y += Pb[Wg.rep[w] * 3 + 1]; if (y / L.ids.length < crotchY) low++; }
    const skirt = low === 1; r.skirtLike = skirt; r.openingsBelowCrotch = low;
    // THE WAIST (rev 2): a garment hung from the trunk (an opening below the crotch, its top opening ringing the trunk above it) has its
    // waist DRAFTED to the body here, before it is laid (see the header)
    let top = null; { let by = -Infinity; for (const L of Wg.loops) { if (L.ids.length < 20) continue; let y = 0, x0 = Infinity, x1 = -Infinity; for (const w of L.ids) { const i = Wg.rep[w]; y += Pb[i * 3 + 1]; x0 = Math.min(x0, Pb[i * 3]); x1 = Math.max(x1, Pb[i * 3]); } y /= L.ids.length; if (y > by) { by = y; top = { ids: L.ids, y, x0, x1 }; } } }
    if (S.waist && low >= 1 && top && top.y > crotchY + 0.05 && top.x0 < -0.05 && top.x1 > 0.05) {
      const P2 = sliceY(Xb, body.T, top.y, v => usedB[v] && bg[v] !== 1 && bg[v] !== 2), gB = hullLen(P2.slice()); for (const L of laid) { if (L.rigid) continue; const ga = new Uint8Array(L.Wg.m); for (let w = 0; w < L.Wg.m; w++) { const q = groupOf(L.g.SI, L.g.SW, L.Wg.rep[w], G); ga[w] = q === 1 || q === 2 ? 1 : 0; } sliceY(L.Pw, L.Wg.T, top.y, w => !ga[w], P2); }   // (a sleeve hanging at the waist is not under the waist)
      const g0 = hullLen(P2), Lw = (g0 + TAU * (S.gap + fab.h / 2)) * (1 + S.waistEase);
      // where the dart ends: the seat (the body's greatest posterior protrusion between the crotch and the waist)
      let zmin = Infinity, yHip = (crotchY + top.y) / 2; for (let v = 0; v < nb; v++) { if (!usedB[v] || bg[v] === 1 || bg[v] === 2) continue; const y = Xb[v * 3 + 1]; if (y > crotchY && y < top.y - 0.03 && Xb[v * 3 + 2] < zmin) { zmin = Xb[v * 3 + 2]; yHip = y; } }
      const depth = Math.max(0.06, top.y - yHip), dw = draftWaist(g, Wg, top.ids, Lw, depth);
      // IS IT CARRIED? a closed band rests on the body only where the body below it is wider than the band (the hips' flare, the seat):
      // the largest tape (body and the garments under it) between the crotch and the waist, against the cut. Where it is not (a trunk
      // that does not widen below the waist), the band stays up by its grip alone (below)
      let below = 0, belowY = null; for (let y = crotchY + 0.02; y < top.y - 0.015; y += 0.01) { const Q = sliceY(Xb, body.T, y, v => usedB[v] && bg[v] !== 1 && bg[v] !== 2); for (const L of laid) { if (L.rigid) continue; sliceY(L.Pw, L.Wg.T, y, w => { const q = groupOf(L.g.SI, L.g.SW, L.Wg.rep[w], G); return q !== 1 && q !== 2; }, Q); } const t = hullLen(Q) + TAU * (S.gap + fab.h / 2); if (t > below) { below = t; belowY = y; } }
      r.waist = { y: +top.y.toFixed(4), tapeBody: +gB.toFixed(4), tapeOver: +g0.toFixed(4), cut: +Lw.toFixed(4), seatY: +yHip.toFixed(4), dartDepth: +depth.toFixed(3), ...dw, widestBelow: +below.toFixed(4), widestBelowY: belowY == null ? null : +belowY.toFixed(3), carried: below > Lw };
      log('lay8', g.name, 'waist drafted', JSON.stringify(r.waist)); }
    const pc = new Int32Array(np); for (let p = 0; p < np; p++) { const w = [0, 0, 0, 0, 0]; let xl = 0, xr = 0; for (let i = 0; i < n; i++) { if (g.panel[i] !== p) continue; w[groupOf(g.SI, g.SW, i, G)]++; if (Pb[i * 3] > 0.03) xl++; else if (Pb[i * 3] < -0.03) xr++; }
      let b = 0; for (let k = 1; k < 5; k++) if (w[k] > w[b]) b = k; if (b >= 3 && (skirt || Math.min(xl, xr) > 0.2 * (xl + xr))) b = 0; pc[p] = b; }
    // THE ARMHOLE is not laid yet: a garment sewn from trunk panels to arm panels (a shirt, a sweatshirt, a coat) keeps the bake's
    // arrangement at rest this iteration (laid on separate charts, the sleeve cap and the bodice start across one another and the sewing
    // drags that crossing through the cloth: L05's shirt 104 -> ~290 crossings, L21's sweatshirt 20 -> ~660). It is the next obstacle,
    // and an obstacle to the garments laid after it, as it lies
    // (rev 1-3) A garment UNDER a kept one was kept too (the kept garment's bands rest on it as the bake has it; laid anew under it, it came
    // through it: L14's top 51 -> 179 crossings with the trousers), so the bottoms under an untucked top were never laid. REV 4 (c10 it2): the
    // bottoms are laid anew under any top (`over`), as they are put on first, and THE HANG OVER below settles the kept top on them. Only a
    // garment whose waist is drafted (r.waist: its top opening one ring round the trunk) is laid under a top: a waist that is a FOLD (L21's
    // jeans: a turned facing whose raw edge, broken by the pocket mouths, is the only open edge) is not drafted yet, and laid without its
    // draft its legs are not drafted either (L21: 77 triangles through the left boot vs the bake's 4): it stays as the bake has it
    const underTop = order.slice(order.indexOf(g) + 1).some(armJoin), kept = armJoin(g) || (underTop && !(S.over && r.waist));
    if (kept) { const Pw = new Float64Array(m * 3); for (let w = 0; w < m; w++) for (let c = 0; c < 3; c++) Pw[w * 3 + c] = Pb[Wg.rep[w] * 3 + c];
      const under = S.over && armJoin(g) ? laid.filter(L => L.anew) : [];
      if (under.length) { const ro = hangOver(g, Wg, Pw, under, fab); laid.push({ g, Wg, Pw: ro.Pf, anew: true, topY: ro.underTopY ?? null }); delete ro.Pf; ro.ms = Date.now() - t0;
        rep.garments[g.name] = { kept: 'armhole join: the bake at rest above; below, hung over the garments laid under it', over: ro }; log('lay8', g.name, 'hung over', under.map(L => L.g.name).join('+'), JSON.stringify(ro)); continue; }
      laid.push({ g, Wg, Pw }); rep.garments[g.name] = { kept: armJoin(g) ? 'armhole join: the bake at rest' : S.over ? 'under a kept garment, its waist not drafted (not one ring round the trunk): the bake at rest' : 'under a kept garment: the bake at rest' }; log('lay8', g.name, 'kept:', rep.garments[g.name].kept); continue; }
    // THE LENGTH (rev 3): trousers (two openings below the crotch) whose waist is drafted have their LEGS drafted to the body too: the cut's
    // outseam is the body's own (the tape from the side seam's top down the outside of the hip, the leg and the shoe, bridging hollows) to
    // where the hem comes to rest on the shoe (the first height, from the shoe's top down, where the tape round the shoe and the ankle in
    // it reaches the hem's own girth), plus the style's BREAK (`brk`: the length a cut leaves over the shoe, which folds there: a design
    // allowance like ease: none 0, quarter ~0.01, half ~0.02, full ~0.035 m). The alteration is made in the FLAT PATTERN between the knee
    // line and the hem (the lengthen/shorten line), the same for a leg's front and back so its seams still meet; the hem's girth is the
    // style's and is not changed. The lower leg is then LAID from its waist by its own cut (its places below the knee are not the bake's),
    // hitched up the shin where it would reach past its rest on the shoe (laid concertinaed above it), and let down by the settle:
    // gravity lowers it onto the shoe (the shoe a rigid collider), and what the cut has over the shoe folds into the break
    const lenL = new Map(); r.length = null;
    if (S.length && r.waist && low === 2) { const loopsLow = Wg.loops.filter(L => L.ids.length >= 20).map(L => { let y = 0, x = 0; for (const w of L.ids) { y += Pb[Wg.rep[w] * 3 + 1]; x += Pb[Wg.rep[w] * 3]; } return { ids: L.ids, y: y / L.ids.length, x: x / L.ids.length }; }).filter(L => L.y < crotchY);
      const topSet = new Set(top.ids), th = TAU * shoeGap(g, fab.h, { min: S.shoeGap, edge: S.shoeEdge }); r.length = { brk: S.brk };   // (the hem stands off the shoe by its contact distance)
      const pend = []; for (const sg of [1, -1]) { const c = sg > 0 ? 3 : 4, side = sg > 0 ? 'L' : 'R', hem = loopsLow.find(L => Math.sign(L.x) === sg), panels = []; for (let p = 0; p < np; p++) if (pc[p] === c) panels.push(p); if (!hem || !panels.length) continue;
        const shoes = laid.filter(L => L.rigid && (() => { let x = 0; for (let w = 0; w < L.Wg.m; w++) x += L.Pw[w * 3]; return Math.sign(x) === sg; })()); let shoeTop = 0; for (const L of shoes) for (let w = 0; w < L.Wg.m; w++) shoeTop = Math.max(shoeTop, L.Pw[w * 3 + 1]);
        const Gh = flatLoopLen(Wg, g.uv, hem.ids), ankle = J('foot.' + side)[1], kneeY = J('lowerleg01.' + side)[1];
        // the hem's rest (the shoe and the ankle in it; with no shoe, the floor under the foot)
        const yRest = shoes.length ? hemRest(Xb, body.T, v => usedB[v] && bg[v] === c, shoes, Gh, shoeTop, 0, th) : Math.max(0, ankle - 0.06);
        // the lateral silhouette (x outward): the body's own side of the trunk and that leg (the arms left out), and the shoe
        const sil = []; for (let v = 0; v < nb; v++) { if (!usedB[v] || !(bg[v] === c || (bg[v] === 0 && Xb[v * 3] * sg > 0))) continue; sil.push([Xb[v * 3] * sg, Xb[v * 3 + 1]]); }
        for (const L of shoes) for (let w = 0; w < L.Wg.m; w++) sil.push([L.Pw[w * 3] * sg, L.Pw[w * 3 + 1]]);
        // and the medial one (x inward): that leg's inside from the crotch down, and the shoe's inside: the INSEAM's tape
        // (rev 4: the leg's own side of the midline only: skin weighted to one thigh across the midline (the perineum, the scrotum) took the
        // tape over to the other side: L23's inseams 77 / 84 cm, L14's 64 / 59 cm, so one leg was cut 5 cm longer than the other)
        const silIn = []; for (let v = 0; v < nb; v++) { if (!usedB[v] || bg[v] !== c || Xb[v * 3] * sg <= 0) continue; silIn.push([-Xb[v * 3] * sg, Xb[v * 3 + 1]]); }
        for (const L of shoes) for (let w = 0; w < L.Wg.m; w++) silIn.push([-L.Pw[w * 3] * sg, L.Pw[w * 3 + 1]]);
        const inBody = outseamTape(silIn, crotchY, yRest);
        // per panel: its flat outseam (the side seam's top, the top edge's most lateral vertex, down the grain to the hem) against the body's
        // from the drafted waist's level (one level for both legs: the band rings the body level, wherever the bake's ring tilted)
        const per = []; for (const p of panels) { let iS = -1, xs = -Infinity, vh = 0, nh = 0; const hs = new Set(hem.ids), ids = [];
          for (let i = 0; i < n; i++) { if (g.panel[i] !== p) continue; ids.push(i); if (topSet.has(Wg.wid[i]) && Pb[i * 3] * sg > xs) { xs = Pb[i * 3] * sg; iS = i; } if (hs.has(Wg.wid[i])) { vh += g.uv[i * 2 + 1]; nh++; } }
          if (iS < 0 || !nh) continue; vh /= nh; const ySide = top.y, flatOut = g.uv[iS * 2 + 1] - vh, bodyOut = outseamTape(sil, ySide, yRest);
          // the panel's FORK (the inseam's top: its lowest vertex on the crotch seam, sewn to the other leg's panel) and its flat inseam
          let iF = -1, yF = Infinity; for (const i of ids) { const D = Wg.dups[Wg.wid[i]]; if (D.length > 1 && D.some(j => g.panel[j] >= 0 && pc[g.panel[j]] !== c && pc[g.panel[j]] >= 3) && Pb[i * 3 + 1] < yF) { yF = Pb[i * 3 + 1]; iF = i; } }
          const flatIn = iF >= 0 ? g.uv[iF * 2 + 1] - vh : null; per.push({ p, ids, vh, flatOut, bodyOut, ySide, flatIn, vF: iF >= 0 ? g.uv[iF * 2 + 1] : null, vTop: g.uv[iS * 2 + 1] }); }
        // WHICH SEAM BEARS THE LEG: the hem must reach its rest along the outseam from the waist AND along the INSEAM from the crotch. Where
        // the pattern's RISE (fork to waist) is shorter than the body's (its outseam less its inseam), the crotch seam bears on the body's
        // crotch and the leg hangs from it: its length is the inseam's; where the rise is longer, the crotch hangs free and the leg hangs
        // from the waist: the outseam's. So the leg is altered by the smaller of the two (L05's rise is 5.6-7.8 cm short of his: altered by
        // the outseam alone, +6-8 cm, his legs hung from the crotch that much too long and piled on his boots; the rise itself is not drafted
        // yet: `rise` records by how much it is short)
        if (!per.length) continue; const dOut = per.reduce((a, q) => a + q.bodyOut + S.brk - q.flatOut, 0) / per.length, pf = per.filter(q => q.flatIn != null && q.vTop - q.vF > 0.05);
        pend.push({ c, side, per, pf, dOut, inBody, kneeY, yRest, Gh, shoeTop }); }
      // (rev 4) THE LEGS ARE CUT AS A PAIR: one inseam for both, the shorter of the two legs' tapes. Each leg's inside tape runs from the
      // crotch level down its medial contour, and on one side it detours round the soft parts at the fork that hang there (skin weighted to
      // that thigh: L23's 77 / 84 cm, L14's 64 / 59 cm), which no tailor's inseam follows; cut by its own tape one trouser leg came out
      // 5 cm longer than the other
      const inPair = pend.length ? Math.min(...pend.map(q => q.inBody)) : 0;
      for (const { c, side, per, pf, dOut, inBody, kneeY, yRest, Gh, shoeTop } of pend) {
        const dIn = pf.length ? pf.reduce((a, q) => a + inPair + S.brk - q.flatIn, 0) / pf.length : null, dRise = dIn == null ? 0 : pf.reduce((a, q) => a + (q.bodyOut - inPair) - (q.flatOut - q.flatIn), 0) / pf.length;
        const d = dIn == null ? dOut : Math.min(dOut, dIn), Dk = kneeY - yRest;
        if (!(Dk > 0.1) || !Number.isFinite(d)) continue; for (const q of per) draftLength(g, q.ids, q.vh, Dk, d);
        lenL.set(c, { kneeY, yLay: yRest + S.hemClear, panels: new Map(per.map(q => [q.p, q.vh + Dk])) });   // (the knee line stays where it was in the flat; the leg is laid down to where its hem stops on the shoe: above it the hem's girth passes the shoe and the ankle in it, as a boot's shaft)
        r.length[side] = { hemGirth: +Gh.toFixed(4), shoeTop: +shoeTop.toFixed(4), yRest: +yRest.toFixed(4), kneeY: +kneeY.toFixed(4), outseamBody: per.map(q => +q.bodyOut.toFixed(4)).join('/'), outseamCut: per.map(q => +q.flatOut.toFixed(4)).join('/'), inseamBody: +inBody.toFixed(4), inseamPair: +inPair.toFixed(4), inseamCut: per.map(q => q.flatIn == null ? null : +q.flatIn.toFixed(4)).join('/'), sideTopY: per.map(q => +q.ySide.toFixed(3)).join('/'), dOut: +dOut.toFixed(4), dIn: dIn == null ? null : +dIn.toFixed(4), rise: +dRise.toFixed(4), altered: +d.toFixed(4) }; }
      log('lay8', g.name, 'length drafted', JSON.stringify(r.length)); }
    // LAY IN TWO PASSES: the trunk and the legs first; then the arms, whose envelope at the root carries the cloth just laid there (a sleeve
    // cap starts outside the bodice it is sewn to, not through it)
    const X = new Float64Array(n * 3), out = [0, 0, 0], placed = [], layPanels = new Set(), hitchW = new Set(); r.align = {};
    for (const pass of [[0, 3, 4], [1, 2]]) {
      const charts = [...new Set(pc)].filter(c => pass.includes(c)); if (!charts.length) continue;
      const EN = new Map(); for (const c of charts) { const P2 = pts[c].slice(); if (c === 1 || c === 2) for (const x of placed) { const k = coords(CH[c], x); if (k[0] < S.armRoot + S.armRootIn && k[2] < S.armRootR) P2.push(x); } EN.set(c, envelope(CH[c], P2, { binT: S.binT, binA: S.binA, clear })); }
      // per panel: the bake's places in its chart, the panel's mean angle, the targets (arc on the envelope from the mean angle, t)
      const PL = []; for (let p = 0; p < np; p++) { if (!pass.includes(pc[p])) continue; const ids = []; for (let i = 0; i < n; i++) if (g.panel[i] === p) ids.push(i); if (ids.length < 3) continue; const c = pc[p], C = CH[c], E = EN.get(c), loc = new Map(ids.map((i, k) => [i, k]));
        const Tl = []; for (let t = 0; t < g.T.length; t += 3) { const a = loc.get(g.T[t]), b = loc.get(g.T[t + 1]), cc = loc.get(g.T[t + 2]); if (a != null && b != null && cc != null) Tl.push(a, b, cc); }
        const K = ids.map(i => coords(C, [Pb[i * 3], Pb[i * 3 + 1], Pb[i * 3 + 2]])); let sx = 0, sy = 0; for (const k of K) { sx += Math.cos(k[1]); sy += Math.sin(k[1]); } let thm = Math.atan2(sy, sx);
        // a panel sewn to itself (a sleeve's underarm seam: two of its own vertices share a place) goes round its chart: its middle is
        // opposite that seam
        let qx = 0, qy = 0; for (let q = 0; q < ids.length; q++) { const d = Wg.dups[Wg.wid[ids[q]]]; if (d.length > 1 && d.some(j => j !== ids[q] && g.panel[j] === p)) { qx += Math.cos(K[q][1]); qy += Math.sin(K[q][1]); } }
        const round = Math.hypot(qx, qy) > 3; if (round) thm = Math.atan2(qy, qx) + Math.PI;
        // a round panel's two edges meet behind its middle, where the angle round the axis wraps: each vertex takes the branch of its own
        // side of the cut (u against the angle's sense round the axis, from the panel's middle half)
        let uc = 0; for (const i of ids) uc += g.uv[i * 2]; uc /= ids.length; let orient = 1;
        if (round) { let sc = 0; for (let q = 0; q < ids.length; q++) { const d = wrapA(K[q][1] - thm); if (Math.abs(d) < Math.PI / 2) sc += d * (g.uv[ids[q] * 2] - uc); } orient = sc < 0 ? -1 : 1; }
        // (rev 3: a drafted leg hangs from its waist by its own cut: below its knee line it has no target)
        let lam = S.lambda; const LL = lenL.get(c), vK = LL && LL.panels.get(p); if (vK != null) { lam = new Float64Array(ids.length); for (let q = 0; q < ids.length; q++) lam[q] = g.uv[ids[q] * 2 + 1] < vK ? 0 : S.lambda; }
        PL.push({ p, ids, c, C, E, T: Int32Array.from(Tl), K, thm, round, orient, uc, lam }); }
      // SEAMS MEET: per chart, the panels slid and turned so the pairs sewn on that chart come together (alignChart)
      const where = new Map(); const absArc = (E, t, thm, s) => { const th = wrapA(angleAt(E, t, thm, s)); return arc(E, t, -Math.PI, th); };
      const doAlign = lays => { const out = {}; where.clear(); lays.forEach((A, li) => A.L.ids.forEach((i, q) => where.set(i, [li, q])));
        for (const c of EN.keys()) { const li = lays.map((A, i) => (A.L.c === c && !A.bake ? i : -1)).filter(i => i >= 0), loc = new Map(li.map((i, k) => [i, k])), E = EN.get(c), P = [];
          for (let w = 0; w < m; w++) { const D = Wg.dups[w]; if (D.length < 2) continue; const a = where.get(D[0]); if (!a || !loc.has(a[0])) continue;
            for (let kk = 1; kk < D.length; kk++) { const bq = where.get(D[kk]); if (!bq || !loc.has(bq[0])) continue; const La = lays[a[0]], Lb = lays[bq[0]], sa = La.Z[a[1] * 2], ta = La.Z[a[1] * 2 + 1], sb = Lb.Z[bq[1] * 2], tb = Lb.Z[bq[1] * 2 + 1], Ta = La.Tq[a[1]], Tb = Lb.Tq[bq[1]];
              const Aa = absArc(E, Ta, La.L.thm, sa), Ab = absArc(E, Tb, Lb.L.thm, sb), C = circ(E, (Ta + Tb) / 2); let d = Aa - Ab; d -= C * Math.round(d / C);
              P.push([loc.get(a[0]), a[1], sa, ta, loc.get(bq[0]), bq[1], sb, tb, d]); } }
          out[c] = alignChart(li.map(i => lays[i]), P, S.alignReg); }
        return out; };
      // GIRTH (two rounds): lay, bring the seams together, measure each chart ring's panels' width, widen the envelope where the cut is
      // wider than its round; lay again
      let lays = null;
      for (let round = 0; round < (S.girth ? 2 : 1); round++) {
        lays = PL.map(L => { const k = L.ids.length, U = new Float64Array(k * 2), Y = new Float64Array(k * 2); for (let q = 0; q < k; q++) { const i = L.ids[q]; U[q * 2] = g.uv[i * 2]; U[q * 2 + 1] = g.uv[i * 2 + 1]; const [t, th] = L.K[q];
            let d = wrapA(th - L.thm); if (L.round && Math.abs(d) > Math.PI / 2 && Math.sign(d) !== L.orient * Math.sign(g.uv[i * 2] - L.uc)) d -= Math.sign(d) * TAU;
            Y[q * 2] = arc(L.E, t, L.thm, L.thm + d); Y[q * 2 + 1] = t; }
          const A = solveTT({ L, ...arap2(U, L.T, Y, { lambda: L.lam, iters: S.arapIters, cg: S.cgIters }) }); A.bake = A.misfit > S.misfit; return A; });
        if (S.align) { Object.assign(r.align, doAlign(lays)); lays.forEach(solveTT); }
        if (!S.girth || round > 0) break;
        for (const [c, E] of EN) { const W = new Float64Array(E.nt); for (const A of lays) { if (A.L.c !== c || A.bake) continue; const lo = new Float64Array(E.nt).fill(Infinity), hi = new Float64Array(E.nt).fill(-Infinity);
            // (a panel counts round a ring only inside its own height: where a sleeve meets its cuff, or a back its yoke, the two are one
            // above the other, not side by side)
            let i0 = E.nt, i1 = -1; for (let q = 0; q < A.L.ids.length; q++) { const i = Math.round((A.Tq[q] - E.t0) / E.binT); i0 = Math.min(i0, i); i1 = Math.max(i1, i); }
            for (let q = 0; q < A.L.ids.length; q++) { const s = A.Z[q * 2], t = A.Tq[q], i = Math.round((t - E.t0) / E.binT); if (i < 0 || i >= E.nt || i <= i0 || i >= i1) continue; lo[i] = Math.min(lo[i], s); hi[i] = Math.max(hi[i], s); }
            for (let i = 0; i < E.nt; i++) if (hi[i] > lo[i]) W[i] += hi[i] - lo[i]; }
          // a ring whose panels are wider than its round (the cut's ease round the arm, the trunk, a leg) is widened to their width; where
          // they do not reach round (a leg chart's half pelvis, an open front) it is left
          for (let i = 0; i < E.nt; i++) { const t = E.t0 + i * E.binT, Cn = circ(E, t); if (W[i] > Cn) E.k[i] = W[i] / Cn; }
          for (let pass = 0; pass < 3; pass++) for (let i = 1; i < E.nt - 1; i++) E.k[i] = Math.max(E.k[i], (E.k[i - 1] + E.k[i + 1]) / 2 * 0.999); }
      }
      // THE HITCH (rev 3): a drafted leg whose cut reaches below the shoe's top is laid concertinaed up the shin (its places below the knee
      // drawn up toward the knee in proportion) so the hem starts above the shoe; the settle lets it down onto it
      for (const [c, LL] of lenL) { if (!EN.has(c)) continue; const C = CH[c], tK = coords(C, J(c === 3 ? 'lowerleg01.L' : 'lowerleg01.R'))[0], o3 = [0, 0, 0]; let tLay = C.len;
        for (let t = tK; t < C.len; t += 0.002) { point(C, t, 0, 0, o3); if (o3[1] <= LL.yLay) { tLay = t; break; } }
        const li = lays.filter(A => A.L.c === c && !A.bake); let tHem = -Infinity; for (const A of li) for (let q = 0; q < A.L.ids.length; q++) tHem = Math.max(tHem, A.Z[q * 2 + 1]);
        if (!(tHem > tLay) || !(tLay > tK)) { LL.hitchMm = 0; continue; } const f = (tLay - tK) / (tHem - tK);
        for (const A of li) { for (let q = 0; q < A.L.ids.length; q++) { const t = A.Z[q * 2 + 1]; if (t > tK) { A.Z[q * 2 + 1] = tK + (t - tK) * f; hitchW.add(Wg.wid[A.L.ids[q]]); } } solveTT(A); }
        LL.hitchMm = +((tHem - tLay) * 1000).toFixed(0); if (r.length) r.length[c === 3 ? 'L' : 'R'].hitchMm = LL.hitchMm; }
      // LAYERS: panels of one chart that overlap round a ring (one front over the other at the placket; a front and the back past a side
      // seam before the sewing meets them) are laid at distinct depths, the one the bake had further out outermost: coplanar cloth would
      // start out crossing itself
      const depth = new Float64Array(lays.length);
      if (S.panelStep > 0) { const bakeOff = lays.map(A => { const d = []; for (let q = 0; q < A.L.ids.length; q += 3) { const [t, th, rr] = A.L.K[q]; d.push(rr - envR(A.L.E, t, th)); } d.sort((a, b) => a - b); return d.length ? d[d.length >> 1] : 0; });
        for (const c of EN.keys()) { const E = EN.get(c), li = lays.map((A, i) => (A.L.c === c && !A.bake ? i : -1)).filter(i => i >= 0), iv = new Map();
          for (const i of li) { const A = lays[i], lo = new Map(), hi = new Map(); for (let q = 0; q < A.L.ids.length; q++) { const sv = A.Z[q * 2], t = A.Tq[q], b = Math.round((t - E.t0) / E.binT); if (!lo.has(b) || sv < lo.get(b)[0]) lo.set(b, [sv, t]); if (!hi.has(b) || sv > hi.get(b)[0]) hi.set(b, [sv, t]); }
            const R = new Map(); for (const [b, [s0, t0]] of lo) { const s1 = hi.get(b)[0]; if (s1 - s0 < 0.01) continue; R.set(b, [absArc(E, t0, A.L.thm, s0), s1 - s0]); } iv.set(i, R); }
          const overlap = (i, j) => { let ov = 0; for (const [b, [a0, w0]] of iv.get(i)) { const o = iv.get(j).get(b); if (!o) continue; const C = circ(E, E.t0 + b * E.binT), [a1, w1] = o, d = ((a1 - a0) % C + C) % C;
              if (Math.max(0, Math.min(w0, d + w1) - d) + Math.max(0, Math.min(w0, d + w1 - C)) > 0.01) ov++; } return ov > 2; };
          // innermost (by the bake) first; each panel one step outside the deepest panel under it that it overlaps
          const ord = li.slice().sort((a, b) => bakeOff[a] - bakeOff[b]); for (let x = 0; x < ord.length; x++) for (let y = 0; y < x; y++) if (overlap(ord[x], ord[y])) depth[ord[x]] = Math.max(depth[ord[x]], depth[ord[y]] + S.panelStep); }
        r.depthMm = (r.depthMm ? r.depthMm + ' ' : '') + lays.map((A, i) => `${A.L.p}:${(depth[i] * 1000).toFixed(0)}`).join(' '); }
      // the laid places (posed at rest, metres) per unwelded vertex, then one place per welded particle (the seam's mean)
      for (const [li, A] of lays.entries()) { const { L, Z } = A; for (let q = 0; q < L.ids.length; q++) { if (A.bake) { X.set(Pb.subarray(L.ids[q] * 3, L.ids[q] * 3 + 3), L.ids[q] * 3); continue; } const t = A.Tq[q], th = A.Th[q]; void Z; point(L.C, t, th, envR(L.E, t, th) + depth[li], out); X.set(out, L.ids[q] * 3); if (pass.includes(0)) placed.push([out[0], out[1], out[2]]); } layPanels.add(L.p); r.panels.push({ p: L.p, chart: L.c, verts: L.ids.length, mirrored: A.mir, flipped: A.flip, misfitMm: +(A.misfit * 1000).toFixed(0), bake: A.bake, areaP10: A.areaP10, areaP90: A.areaP90 }); }
    }
    for (let i = 0; i < n; i++) if (!(g.panel[i] >= 0) || !layPanels.has(g.panel[i])) X.set(Pb.subarray(i * 3, i * 3 + 3), i * 3);
    // THE TUCK (rev 2): what a drafted waist closes over below it (a tucked shirt's tail: the garments laid before it, below its waist,
    // the arms left out) is a floor to it as the body is (one-sided, the tail's outside; Self6 alone let the draw-in pull the waist
    // through the tail: L03's ring came to rest inside the tuck, 124 -> 241 triangles through other garments)
    const tuckC = (ns, mask) => { if (!r.waist) return []; const out = []; for (const L of laid) { if (L.rigid) continue; const ga = new Uint8Array(L.Wg.m); for (let w = 0; w < L.Wg.m; w++) { const q = groupOf(L.g.SI, L.g.SW, L.Wg.rep[w], G); ga[w] = q === 1 || q === 2 || L.Pw[w * 3 + 1] >= top.y ? 1 : 0; }
        const T2 = []; for (let t = 0; t < L.Wg.T.length; t += 3) { const a = L.Wg.T[t], b = L.Wg.T[t + 1], c = L.Wg.T[t + 2]; if (!ga[a] && !ga[b] && !ga[c]) T2.push(a, b, c); } if (T2.length < 90) continue;
        let hu; try { hu = phys(L.g.fabric).h; } catch (e) { hu = fab.h; } out.push({ mesh: new SurfaceMesh(L.Pw, Int32Array.from(T2), { cell: 0.02, boundary: true }), gap: new Float64Array(ns).fill(fab.h / 2 + hu / 2 + 0.001), mu: S.mu, reach: 0.03, mask, garment: true }); }
      if (out.length) r.waist.tuckFloor = out.length; return out; };
    // THE SUPPORTS: the bands it is eased into and `pinNear` round them, at their places (the band is the reference, as in pose8)
    const PwB = new Float64Array(m * 3); for (let w = 0; w < m; w++) for (let c = 0; c < 3; c++) PwB[w * 3 + c] = Pb[Wg.rep[w] * 3 + c];
    const held = new Uint8Array(m); if (!r.waist) for (let w = 0; w < m; w++) if (nearBand(PwB[w * 3], PwB[w * 3 + 1], PwB[w * 3 + 2])) held[w] = 1;
    // THE WAIST: a garment hung from the trunk (trousers, a skirt) that no band holds is held at its top opening (the loop of its free
    // edge highest on the body) and `waistRings` rings, where the bake has it: the cut waist sits on the hips (cut at the pattern's waist,
    // which is not yet drafted to the body: without the hold it slides off, L23's jeans fell 50 cm)
    // (rev 1's hold, kept only for a trunk-hung garment whose waist is not drafted: { waist: false } or no top opening round the trunk)
    if (!r.waist) { let best = null, by = -Infinity; for (const L of Wg.loops) { if (L.ids.length < 20) continue; let y = 0; for (const w of L.ids) y += PwB[w * 3 + 1]; y /= L.ids.length; if (y > by) { by = y; best = L; } }
      if (best && !best.ids.some(w => held[w])) { const ring = new Set(best.ids); for (let k = 0; k < S.waistRings; k++) { const add = []; for (let t = 0; t < Wg.T.length; t += 3) { const a = Wg.T[t], b = Wg.T[t + 1], c = Wg.T[t + 2]; if (ring.has(a) || ring.has(b) || ring.has(c)) add.push(a, b, c); } for (const v of add) ring.add(v); }
        for (const w of ring) held[w] = 1; r.waistHeld = ring.size; } }
    if (S.keep) { const hy = new Map(); for (let w = 0; w < m; w++) if (held[w]) { const b = Math.round(PwB[w * 3 + 1] * 20) / 20; hy.set(b, (hy.get(b) || 0) + 1); } r.heldY = JSON.stringify([...hy].sort((a, b) => a[0] - b[0])); }
    { const usedW = new Uint8Array(m); for (const v of Wg.T) usedW[v] = 1; for (let w = 0; w < m; w++) if (!usedW[w]) held[w] = 1; }
    // the obstacles: the garments laid so far (pinned at their settled places), as flat-framed triangles
    const obst = (base0) => { const Xo = [], To = [], Mo = [], Ho = []; for (const L of laid) { let hu; try { hu = phys(L.g.fabric).h; } catch (e) { hu = fab.h; } const base = base0 + Xo.length / 3; for (let w = 0; w < L.Wg.m; w++) { Xo.push(L.Pw[w * 3], L.Pw[w * 3 + 1], L.Pw[w * 3 + 2]); Ho.push(Math.max(S.th, hu / 2)); }
        for (let t = 0; t < L.Wg.T.length; t += 3) { const a = L.Wg.T[t], b = L.Wg.T[t + 1], c = L.Wg.T[t + 2]; To.push(base + a, base + b, base + c); const e1 = sub([L.Pw[b * 3], L.Pw[b * 3 + 1], L.Pw[b * 3 + 2]], [L.Pw[a * 3], L.Pw[a * 3 + 1], L.Pw[a * 3 + 2]]), e2 = sub([L.Pw[c * 3], L.Pw[c * 3 + 1], L.Pw[c * 3 + 2]], [L.Pw[a * 3], L.Pw[a * 3 + 1], L.Pw[a * 3 + 2]]), l1 = Math.hypot(...e1) || 1e-6, u = e1.map(x => x / l1), px = dot(e2, u), py = Math.sqrt(Math.max(1e-14, dot(e2, e2) - px * px)); Mo.push(0, 0, l1, 0, px, py); } }
      return { Xo, To, Mo, Ho }; };
    // SEW: the panels as laid, each its own cloth (the garment unwelded), zero-length stitches between a seam's vertices tightened in
    // steps (soft first, so the panels slide round the body to meet, as sew.js's box-mesh sewing: GarmentCodeData, Korosteleva and
    // Sorkine-Hornung 2023), gravity off, the body and the garments already laid as colliders, Self6 holding the panels' sides: a seam is
    // closed by the cloth's own motion, not by averaging two places that may lie 10 cm apart across the body
    const triU = [], metU = []; for (let t = 0; t < g.T.length; t += 3) { const i = g.T[t], j = g.T[t + 1], k = g.T[t + 2];
      const du1 = g.uv[j * 2] - g.uv[i * 2], dv1 = g.uv[j * 2 + 1] - g.uv[i * 2 + 1], du2 = g.uv[k * 2] - g.uv[i * 2], dv2 = g.uv[k * 2 + 1] - g.uv[i * 2 + 1]; if (Math.abs(du1 * dv2 - du2 * dv1) < 1e-12) continue;
      triU.push(i, j, k); metU.push(g.uv[i * 2], g.uv[i * 2 + 1], g.uv[j * 2], g.uv[j * 2 + 1], g.uv[k * 2], g.uv[k * 2 + 1]); }
    const pairs = []; for (let w = 0; w < m; w++) { const D = Wg.dups[w]; if (D.length > 1) for (let k = 1; k < D.length; k++) pairs.push(D[0], D[k]); }
    const seamGap = Xs => { const d = []; for (let k = 0; k < pairs.length; k += 2) { const a = pairs[k], b = pairs[k + 1]; d.push(Math.hypot(Xs[a * 3] - Xs[b * 3], Xs[a * 3 + 1] - Xs[b * 3 + 1], Xs[a * 3 + 2] - Xs[b * 3 + 2])); } d.sort((a, b) => a - b);
      return { p50Mm: d.length ? +(d[d.length >> 1] * 1000).toFixed(1) : 0, p95Mm: d.length ? +(d[Math.floor(d.length * 0.95)] * 1000).toFixed(1) : 0, maxMm: d.length ? +(d[d.length - 1] * 1000).toFixed(1) : 0 }; };
    r.seam = { laid: seamGap(X) }; if (S.keep) r._lay0 = Float64Array.from(X);
    // what is already sewn at the lay (a seam whose vertices lie within `weldNear` of their mean) is one particle from the start: two
    // panels' edges laid on one another would read as cloth crossing itself, and Self6 lets cloth it finds crossing pass through
    // anything. Only the seams still open are stitched
    const pid = new Int32Array(n), Xp = [], open = []; let npid = 0;
    for (let w = 0; w < m; w++) { const D = Wg.dups[w]; let cx = 0, cy = 0, cz = 0; for (const i of D) { cx += X[i * 3]; cy += X[i * 3 + 1]; cz += X[i * 3 + 2]; } cx /= D.length; cy /= D.length; cz /= D.length;
      let dev = 0; for (const i of D) dev = Math.max(dev, Math.hypot(X[i * 3] - cx, X[i * 3 + 1] - cy, X[i * 3 + 2] - cz));
      if (dev <= S.weldNear) { for (const i of D) pid[i] = npid; Xp.push(cx, cy, cz); npid++; } else { for (const i of D) { pid[i] = npid++; Xp.push(X[i * 3], X[i * 3 + 1], X[i * 3 + 2]); } for (let k = 1; k < D.length; k++) open.push(D[0], D[k]); } }
    const triP = [], metP = []; for (let t = 0; t < triU.length; t += 3) { const a = pid[triU[t]], b = pid[triU[t + 1]], c = pid[triU[t + 2]]; if (a === b || b === c || a === c) continue; triP.push(a, b, c); metP.push(...metU.slice(t * 2, t * 2 + 6)); }
    { const identP = Int32Array.from({ length: npid }, (_, i) => i); r.cross0 = count(selfIntersections(Float64Array.from(Xp), Int32Array.from(triP), { wid: identP }).hit); r.seam.open = open.length / 2; }
    if (S.keep) { const B = new Map(); for (let k = 0; k < pairs.length; k += 2) { const a = pairs[k], b = pairs[k + 1], key = Math.min(g.panel[a], g.panel[b]) + '-' + Math.max(g.panel[a], g.panel[b]), d = Math.hypot(X[a * 3] - X[b * 3], X[a * 3 + 1] - X[b * 3 + 1], X[a * 3 + 2] - X[b * 3 + 2]);
        const e = B.get(key) || { n: 0, sum: 0, max: 0, yAtMax: 0, ys: [1e9, -1e9] }; e.n++; e.sum += d; if (d > e.max) { e.max = d; e.yAtMax = Pb[a * 3 + 1]; } e.ys[0] = Math.min(e.ys[0], Pb[a * 3 + 1]); e.ys[1] = Math.max(e.ys[1], Pb[a * 3 + 1]); B.set(key, e); }
      r.seamPairs = Object.fromEntries([...B].map(([k, e]) => [k, { n: e.n, meanMm: +(e.sum / e.n * 1000).toFixed(0), maxMm: +(e.max * 1000).toFixed(0), yAtMax: +e.yAtMax.toFixed(2), y: e.ys.map(y => +y.toFixed(2)) }])); }
    if (S.sew > 0 && open.length) { const O = obst(npid), ns = npid + O.Xo.length / 3, X0 = new Float64Array(ns * 3), pin = new Uint8Array(ns); X0.set(Xp); X0.set(O.Xo, npid * 3); for (let i = npid; i < ns; i++) pin[i] = 1;
      const TH = [...new Array(npid).fill(Math.max(S.th, fab.h / 2)), ...O.Ho];
      const cs = new Cloth(X0, Int32Array.from([...triP, ...O.To]), fab, { X0, pin, metric: Float64Array.from([...metP, ...O.Mo]), foldMax: S.foldMax, tether: false, restAngle: 0, bendScale: S.bendScale, compress: S.compress, slack: S.slack, damping: S.sewDamping, vmax: S.vmax, gravity: [0, 0, 0] });
      cs.c6 = new Self6(cs, { th: Float64Array.from(TH), every: S.selfEvery, maxPush: S.maxPush6, mu: S.mu, margin: S.margin6, tangleEvery: S.tangleEvery, tangleMove: S.tangleMove }); cs.c6.updateTangled(cs.X);
      const mk = Uint8Array.from(pin, p => (p ? 0 : 1)), ctS = new Contacts(ns, [{ mesh: surf, gap: new Float64Array(ns).fill(S.gap + fab.h / 2), mu: S.mu, reach: 0.04, mask: mk }, ...bootC(ns, fab, mk, g), ...tuckC(ns, mk)], { reach: 0.04, safe: true });
      // what the bands hold is drawn to its place with the seams, by the same ramp (a soft pin, not a jump: the tuck gathers under the
      // waistband as the cloth arrives there)
      const hold = new Map(); for (let i = 0; i < n; i++) if (held[Wg.wid[i]]) hold.set(pid[i], Wg.wid[i]); const openP = open.map(i => pid[i]);
      const st0 = Date.now(); for (const al of S.sewRamp) { cs.stitch(openP, { alpha: al }); if (hold.size) cs.attach([...hold].map(([i, w]) => ({ i, x: [PwB[w * 3], PwB[w * 3 + 1], PwB[w * 3 + 2]], alpha: al }))); cs.run(S.sew / S.sewRamp.length, { hz: S.hz, contacts: ctS, every: S.every }); }
      let bad = 0; for (let i = 0; i < n; i++) { const x = cs.X[pid[i] * 3], y = cs.X[pid[i] * 3 + 1], z = cs.X[pid[i] * 3 + 2]; if (!Number.isFinite(x + y + z) || Math.hypot(x - X[i * 3], y - X[i * 3 + 1], z - X[i * 3 + 2]) > S.maxMove) { bad++; continue; } X[i * 3] = x; X[i * 3 + 1] = y; X[i * 3 + 2] = z; }
      r.seam.sewn = seamGap(X); r.seam.sewBad = bad; r.seam.sewMs = Date.now() - st0; r.seam.tangledSew = count(cs.c6.tangled.subarray(0, npid)); }
    else for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) X[i * 3 + c] = Xp[pid[i] * 3 + c];
    // WELD: one place per welded particle (the seam's mean)
    const Pw = new Float64Array(m * 3), cnt = new Float64Array(m);
    for (let i = 0; i < n; i++) { const w = Wg.wid[i]; for (let c = 0; c < 3; c++) Pw[w * 3 + c] += X[i * 3 + c]; cnt[w]++; } for (let w = 0; w < m; w++) for (let c = 0; c < 3; c++) Pw[w * 3 + c] /= cnt[w];
    // the welded triangles and their pattern frames
    const tri = [], met = []; for (let t = 0; t < g.T.length; t += 3) { const i = g.T[t], j = g.T[t + 1], k = g.T[t + 2], a = Wg.wid[i], b = Wg.wid[j], c = Wg.wid[k]; if (a === b || b === c || a === c) continue;
      const du1 = g.uv[j * 2] - g.uv[i * 2], dv1 = g.uv[j * 2 + 1] - g.uv[i * 2 + 1], du2 = g.uv[k * 2] - g.uv[i * 2], dv2 = g.uv[k * 2 + 1] - g.uv[i * 2 + 1]; if (Math.abs(du1 * dv2 - du2 * dv1) < 1e-12) continue;
      tri.push(a, b, c); met.push(g.uv[i * 2], g.uv[i * 2 + 1], g.uv[j * 2], g.uv[j * 2 + 1], g.uv[k * 2], g.uv[k * 2 + 1]); }
    const ident = Int32Array.from({ length: m }, (_, i) => i), selfHits = Xs => selfIntersections(Xs, Wg.T, { wid: ident }).hit;
    r.cross = { bake: count(selfHits(PwB)), laid: count(selfHits(Pw)) }; if (S.keep) { r._laid = Float64Array.from(Pw); r._bake = PwB; r._Wg = Wg; r._held = held; }
    // the obstacles: the garments laid so far (pinned at their settled places)
    const O = obst(m), Ts = [...tri, ...O.To], Ms = [...met, ...O.Mo], TH = [...new Array(m).fill(Math.max(S.th, fab.h / 2)), ...O.Ho], Xo = O.Xo;
    const ns = m + Xo.length / 3, X0 = new Float64Array(ns * 3), pin = new Uint8Array(ns); X0.set(Pw); X0.set(Xo, m * 3); for (let i = 0; i < m; i++) if (held[i]) pin[i] = 1; for (let i = m; i < ns; i++) pin[i] = 1;
    const cl = new Cloth(X0, Int32Array.from(Ts), fab, { X0, pin, metric: Float64Array.from(Ms), foldMax: S.foldMax, tether: false, restAngle: S.restAngle, bendScale: S.bendScale, compress: S.compress, slack: S.slack, damping: S.damping, vmax: S.vmax });
    cl.c6 = new Self6(cl, { th: Float64Array.from(TH), every: S.selfEvery, maxPush: S.maxPush6, mu: S.mu, margin: S.margin6, tangleEvery: S.tangleEvery, tangleMove: S.tangleMove }); cl.c6.updateTangled(cl.X);
    r.tangledAtLay = count(cl.c6.tangled.subarray(0, m));
    const gT = S.gap + fab.h / 2, mask = Uint8Array.from(pin, p => (p ? 0 : 1)), contacts = new Contacts(ns, [{ mesh: surf, gap: new Float64Array(ns).fill(gT), mu: S.mu, reach: 0.04, mask }, ...bootC(ns, fab, mask, g), ...tuckC(ns, mask)], { reach: 0.04, safe: true });
    let under = 0; for (let i = 0; i < m; i++) { if (pin[i]) continue; const q = surf.closestAny(X0[i * 3], X0[i * 3 + 1], X0[i * 3 + 2], 0.04); if (q && !q.edge && q.d < 0) under++; } r.underAtLay = under;
    // THE DRAW-IN (rev 2): a drafted waist is laid at the envelope's round (longer than its cut) and sewn there; it is drawn to its cut
    // with gravity off, every edge ramped from the length it was laid at to its pattern length (as resolve8 ramps: XPBD on cloth released
    // at once jumps centimetres in a substep and passes through what it should rest on), so it comes to rest ON the body before it hangs
    const ring = () => { if (!top) return null; let y = 0, l = 0, d = 0, dn = 0; for (let k = 0; k < top.ids.length; k++) { const a = top.ids[k], b = top.ids[(k + 1) % top.ids.length]; y += cl.X[a * 3 + 1]; l += Math.hypot(cl.X[a * 3] - cl.X[b * 3], cl.X[a * 3 + 1] - cl.X[b * 3 + 1], cl.X[a * 3 + 2] - cl.X[b * 3 + 2]); const q = surf.closestAny(cl.X[a * 3], cl.X[a * 3 + 1], cl.X[a * 3 + 2], 0.1); if (q) { d += q.d; dn++; } }
      const H = top.ids.map(w => [cl.X[w * 3], cl.X[w * 3 + 2]]); return { y: +(y / top.ids.length).toFixed(4), len: +l.toFixed(4), hullXZ: +hullLen(H).toFixed(4), offBodyMm: dn ? +(d / dn * 1000).toFixed(1) : null }; };
    if (r.waist) r.waist.sewn = ring();
    if (r.waist && S.drawIn > 0) { const gS = cl.gravity, L1 = Float64Array.from(cl.sL), X = cl.X, Lc = Float64Array.from(L1, (l, c) => Math.max(l, Math.hypot(X[cl.sB[c] * 3] - X[cl.sA[c] * 3], X[cl.sB[c] * 3 + 1] - X[cl.sA[c] * 3 + 1], X[cl.sB[c] * 3 + 2] - X[cl.sA[c] * 3 + 2])));
      const NR = Math.max(1, Math.round(S.drawIn * S.hz * 0.75)), sm = f => f * f * (3 - 2 * f), ramp = step => { const e = sm(Math.min(1, (step + 1) / NR)); for (let c = 0; c < L1.length; c++) cl.sL[c] = Lc[c] + (L1[c] - Lc[c]) * e; };
      cl.gravity = [0, 0, 0]; ramp(-1); cl.run(S.drawIn, { hz: S.hz, contacts, every: S.every, onStep: ramp }); cl.sL.set(L1); cl.gravity = gS; cl.V.fill(0); r.waist.drawn = ring();
      // THE GRIP, only where the body cannot carry the band (above): the drawn-in band holds where it came to rest on the body (the top
      // opening and `waistRings` rings: the band's height).
      // A real waistband stays up by its grip: the friction of a snug band and the soft tissue it presses into. This solver's body is
      // rigid and its friction is positional (a band in tension slips: L05's drafted waist, left free, slid 55 cm down a trunk that does
      // not widen below his waist; L20's, on hips wider than her waist, held by itself to 1.5 mm), so the grip is a hold, at the place the
      // DRAFTED band reached on today's body, not at the bake's ring
      // (rev 4) CARRIED IS DECIDED ON THE BAND AS DRAWN, not on the cut: where the draw-in stops short of the cut (the band's ring as it
      // lies, its tape, still as wide as the widest of the body below it: L23 1.031 vs 1.015 m, L12 0.968 vs 0.972) nothing holds it up
      // and the trousers slid down the legs in the settle (more than 3000 particles past maxMove)
      if (r.waist.drawn && r.waist.drawn.hullXZ >= r.waist.widestBelow) { r.waist.carried = false; r.waist.carriedDrawn = false; }
      if (S.grip && !r.waist.carried) { const zone = new Set(top.ids); for (let k = 0; k < S.waistRings; k++) { const add = []; for (let t = 0; t < Wg.T.length; t += 3) { const a = Wg.T[t], b = Wg.T[t + 1], c = Wg.T[t + 2]; if (zone.has(a) || zone.has(b) || zone.has(c)) add.push(a, b, c); } for (const v of add) zone.add(v); }
        for (const w of zone) { cl.W[w] = 0; pin[w] = 1; } r.waist.grip = zone.size; } }
    if (S.trace && r.waist) { r.waist.trace = []; const k = 6; for (let q = 0; q < k; q++) { cl.run(S.settle / k, { hz: S.hz, contacts, every: S.every }); r.waist.trace.push(ring()); } }
    else { // THE LET-DOWN (rev 3): a hitched leg (laid concertinaed up the shin) is let down onto the shoe by its own length: the rest lengths
      // of its edges grow from their laid (concertina) lengths to the cut's over the first `letDown` of the settle, under gravity (released at
      // once, L05's 16 cm of hitched cloth over his boots buckled into ~700 crossings)
      let letOn; if (hitchW.size && S.letDown > 0) { const L1 = Float64Array.from(cl.sL), Xc = cl.X, idx = [], Lc = [], sm = f => f * f * (3 - 2 * f);
        for (let c = 0; c < L1.length; c++) { const a = cl.sA[c], b = cl.sB[c]; if (a < m && b < m && hitchW.has(a) && hitchW.has(b)) { const l = Math.hypot(Xc[b * 3] - Xc[a * 3], Xc[b * 3 + 1] - Xc[a * 3 + 1], Xc[b * 3 + 2] - Xc[a * 3 + 2]); if (l < L1[c]) { idx.push(c); Lc.push(l); } } }
        const NR = Math.max(1, Math.round(S.letDown * S.settle * S.hz)); letOn = step => { const e = sm(Math.min(1, (step + 1) / NR)); for (let k = 0; k < idx.length; k++) cl.sL[idx[k]] = Lc[k] + (L1[idx[k]] - Lc[k]) * e; };
        letOn(-1); if (r.length) r.length.letDownEdges = idx.length; }
      cl.run(S.settle, { hz: S.hz, contacts, every: S.every, ...(letOn ? { onStep: letOn } : {}) }); }
    // a particle past `maxMove` from where it was laid, or not finite: a blow-up, laid back
    let nan = 0, blown = 0; const Pf = new Float64Array(m * 3); for (let i = 0; i < m; i++) { const x = cl.X[i * 3], y = cl.X[i * 3 + 1], z = cl.X[i * 3 + 2]; if (!Number.isFinite(x + y + z)) { nan++; Pf.set(Pw.subarray(i * 3, i * 3 + 3), i * 3); continue; }
      if (Math.hypot(x - Pw[i * 3], y - Pw[i * 3 + 1], z - Pw[i * 3 + 2]) > S.maxMove) { if (S.keep && blown < 6) (r.blownEx ||= []).push([...Pw.subarray(i * 3, i * 3 + 3)].map(v => +v.toFixed(3)).join(',') + ' -> ' + [x, y, z].map(v => +v.toFixed(3)).join(',')); blown++; Pf.set(Pw.subarray(i * 3, i * 3 + 3), i * 3); continue; } Pf[i * 3] = x; Pf[i * 3 + 1] = y; Pf[i * 3 + 2] = z; }
    if (r.waist) { let y0 = 0, y1 = 0; for (const w of top.ids) { y0 += Pw[w * 3 + 1]; y1 += Pf[w * 3 + 1]; } r.waist.laidY = +(y0 / top.ids.length).toFixed(4); r.waist.settledY = +(y1 / top.ids.length).toFixed(4); r.waist.dropMm = +((y0 - y1) / top.ids.length * 1000).toFixed(1);
      let l3 = 0; for (let k = 0; k < top.ids.length; k++) { const a = top.ids[k], b = top.ids[(k + 1) % top.ids.length]; l3 += Math.hypot(Pf[a * 3] - Pf[b * 3], Pf[a * 3 + 1] - Pf[b * 3 + 1], Pf[a * 3 + 2] - Pf[b * 3 + 2]); } r.waist.settledLen = +l3.toFixed(4); }
    if (r.length) for (const L of Wg.loops) { if (L.ids.length < 20) continue; let y = 0, x = 0, y0 = Infinity; for (const w of L.ids) { y += Pf[w * 3 + 1]; x += Pf[w * 3]; y0 = Math.min(y0, Pf[w * 3 + 1]); } y /= L.ids.length; if (y > crotchY) continue;
      const e = r.length[x > 0 ? 'L' : 'R']; if (e) { e.hemSettledY = +y.toFixed(4); e.hemSettledMin = +y0.toFixed(4); } }
    r.cross.settled = count(selfHits(Pf)); r.tangledAfter = count(cl.c6.tangled.subarray(0, m)); r.nan = nan; r.blown = blown; r.held = count(held); r.obstacles = ns - m;
    { const d = []; let inside = 0; for (let i = 0; i < m; i++) { if (pin[i]) continue; const q = surf.closestAny(Pf[i * 3], Pf[i * 3 + 1], Pf[i * 3 + 2], 0.06); if (q && !q.edge) { d.push(q.d); if (q.d < -0.004) inside++; } } d.sort((a, b) => a - b);
      const p = f => d.length ? +(d[Math.min(d.length - 1, Math.floor(f * d.length))] * 1000).toFixed(1) : null; r.off = { p50: p(0.5), p90: p(0.9), inside4: inside }; }
    // (rev 4) A SETTLE THAT DIVERGED (more than `diverge` of its particles past `maxMove`: the solve blew up, they are not cloth any more)
    // is not written: the garment stays as the bake has it (its cut too), and what goes on over it is not hung on it (L14 and L23's
    // trousers under their tops, c10 it2: 3224 and 4139 particles past 25 cm, 2471 and 2391 crossings; the cause is not found yet)
    if (blown > S.diverge * m) { g.uv.set(uvBake); laid.push({ g, Wg, Pw: PwB }); rep.garments[g.name] = { kept: `the settle diverged (${blown} of ${m} particles past maxMove): the bake at rest`, diverged: { blown, nan, cross: r.cross, tangledAfter: r.tangledAfter, waist: r.waist && { k: r.waist.k, cut: r.waist.cut }, length: r.length && { L: r.length.L?.altered, R: r.length.R?.altered } } };
      log('lay8', g.name, 'DIVERGED, kept:', JSON.stringify(rep.garments[g.name].diverged)); continue; }
    // back to bind (the rest pose's matrices); what is sewn on it follows
    const Pn = new Float64Array(n * 3); for (let i = 0; i < n; i++) { const w = Wg.wid[i]; for (let c = 0; c < 3; c++) Pn[i * 3 + c] = Pf[w * 3 + c]; }
    toBind(g, Pn, M, scale, null); P0.set(g, poseOf(g, M, scale));
    for (const { q, g: gg, B, band } of binds) { if (gg !== g || (band && !r.waist)) continue; const Xq = Float64Array.from(P0.get(q)), k = place8(B, P0.get(g), g.T, Xq, null); toBind(q, Xq, M, scale, null); P0.set(q, poseOf(q, M, scale)); rep.carried[q.name] = (rep.carried[q.name] || 0) + k; }
    if (S.keep) r._settled = Pf; laid.push({ g, Wg, Pw: Pf, anew: true, topY: r.waist ? r.waist.settledY : null }); r.ms = Date.now() - t0; r.c6 = cl.c6.stats; rep.garments[g.name] = r; log('lay8', g.name, JSON.stringify({ ...Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_') && k !== 'seamPairs' && k !== 'rings')), c6: undefined, panels: r.panels.map(x => `${x.p}:${x.bake ? 'bake' : x.chart}${x.mirrored ? 'm' : ''}/f${x.flipped}/${x.misfitMm}mm`).join(' ') }));
  }
  rep.ms = Date.now() - t00; return rep;
}
