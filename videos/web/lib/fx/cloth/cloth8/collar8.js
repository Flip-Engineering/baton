// CLOTH8 c4 it1 (8 Oct): THE COLLAR FROM ITS OWN PATTERN, SEWN ON ITS STAND AND LAID BY THE CLOTH'S SOLVER (stage 'collar').
// What the bake had (finish.js construct, K3 / CLOTH5): the fall was a SHAPE TARGET: on every vertex of the neck opening's stand run, a
// leaf aimed 3-4 cm out and 4.5-7.5 cm down at the nearest shirt surface. The run is the stand's whole FREE edge, its top AND its two
// centre-front ENDS (L03: the first and last three columns rise 3.4 cm up the end edges), so at each front the leaf hung off a vertical
// edge, aimed forward at the chest: the 'wing' (the orchestrator's 18:30: one side standing up beside the jaw, the other lying flat; the
// fronts' leaf edges dropping 8-9 cm straight down the placket in the Cycles stills). A real shirt or chore-coat collar is a PATTERN PIECE
// (FreeSewing Simon's collar: its sewn edge = neck x (1 + ease - gap), bent at the ends; its outer edge flared; its points at an angle),
// sewn along the stand's TOP edge only (centred on the back, set back from the centre-front points by the gap), turned and folded down
// over the stand; where its points and its outer edge lie is decided by its LENGTHS (the outer edge is longer than the sewn one, so it
// has to spread to a larger girth: over the stand, onto the shoulders, the points out over the collarbones), its stiffness (interfaced,
// two layers), gravity and what is under it. This stage does exactly that, for every shirt's collar.fall (the chore coats' outer.collar.fall
// are cut on the same draft: see THE COATS below):
//   pattern   the collar leaf drafted as Simon's collar.mjs draws it (FreeSewing, MIT, (c) Joost De Cock and contributors; the options'
//             defaults), its sewn length from the stand's own sewn neckline (the bake's flat pattern: the stand's edge welded to the
//             fronts and yoke = neck x (1 + ease)), its width from the stand's flat width x collarWidth x (1 + collarRoll)
//   sewn      the leaf's sewn edge along the stand's TOP edge, centred on its centre back (the stand's u = 0), flat length for flat length
//   laid      first folded straight down over the stand (the roll at the seam), then SOLVED: xpbd.js Cloth with the leaf's flat pattern as
//             its metric (every edge's rest length its pattern length), the seam row pinned, the fabric's bending x `bendScale` (two layers
//             and an interfacing), rest dihedral x `restAngle` of the folded lay, gravity, the garment's own cloth (stand, yoke, fronts and
//             what is sewn on them) and the full skin as floors
//   drawn     the part's own topology kept (its 17-vertex rings: the two seam roots, the upper collar, the rolled edge, the under collar),
//             the two layers offset from the solved leaf along its own outward normal (0.7-1.1 mm a side, as fall5 drew them); the
//             part's weights from the garment's nearest cloth; back to bind through them
// THE COATS (outer.collar.fall, L12 L23; `re: /^(outer\.)?collar\.fall$/` takes them) do NOT come out right yet and are left out by
// default: their fall crossed itself and the coat as much as before (L12 232 -> 191 / 111 -> 83, L23 174 -> 171 / 140 -> 132) and 15-20
// of their columns stand up (none before), the leaf stretched to 1.14-1.21 at p90: the open chore coat's stand and fronts are themselves
// tangled (the coats' own crossings, NOTES); the coats wait for that.
// Nothing else changes (the stand, the shirt, every other part byte for byte). `rebuild8 ... --opt '{"stages":["collar"]}'` on a finished
// bake re-lays only the collars (how v8c and v8c/dress7 were re-laid on 15 Oct: L03 L05 L20 standing, L05 L20 dressed).
//   collar8(ctx) -> { <part>: { cols, Lsew, Lneck, W, outer, standTop, seamMm, strainP90, under, points: { L, R } , ms } }
import { Cloth } from '../xpbd.js';
import { phys } from '../fabrics.js';
import { Contacts, SurfaceMesh } from '../collide.js';
import { weldGarment } from '../cloth7/fold7.js';
export const COLLAR8_VERSION = 1;
export const COLLAR8 = { re: /^collar\.fall$/, ease: 0.02, gap: 0.025, width: 1.2, roll: 0.03, bend: 0.035, flare: 3.5, angle: 85,
  NT: 6, T: 0.9, hz: 600, every: 2, bendScale: 20, restAngle: 0.3, compress: 0.2, damping: 8, vmax: 0.6, mu: 0.4,
  gapCloth: 0.0036, gapBody: 0.0035, under: 0.0018, settle: 6, lift: 0.0026, roll0: 0.0016, rise: 0.0024, fabric: 'chambray', debug: 0 };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------------------------------------------------------------- the flat collar (Simon's collar.mjs; y up, metres)
function cubic(p0, p1, p2, p3, k = 24) { const o = []; for (let i = 0; i <= k; i++) { const t = i / k, u = 1 - t; o.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); } return o; }
const plen = P => { let s = 0; for (let i = 1; i < P.length; i++) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return s; };
// a point at arc fraction f along a 2D polyline
function at2(P, f) { const L = plen(P) * Math.min(1, Math.max(0, f)); let s = 0; for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); if (s + d >= L || i === P.length - 1) { const t = d > 0 ? Math.min(1, (L - s) / d) : 0; return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t]; } s += d; } return P[P.length - 1]; }
export function collarFlat(Lsew, Wstand, o = COLLAR8) {
  const W = Wstand * o.width * (1 + o.roll), fl = o.flare * Math.PI / 180, an = o.angle * Math.PI / 180;
  const make = L => { const bm = [0, -W], rbe = [L / 2, -W - L * o.bend], sewR = cubic(bm, [0.35 * L, -W], rbe, rbe), hinge = [L / 4, 0];
    // the point: the flare line from the hinge meets the end line from the sewn edge's end
    const d1 = [Math.cos(fl), Math.sin(fl)], d2 = [Math.cos(an), Math.sin(an)], det = d1[0] * -d2[1] - d1[1] * -d2[0], rx = rbe[0] - hinge[0], ry = rbe[1] - hinge[1], a = (rx * -d2[1] - ry * -d2[0]) / det, rte = [hinge[0] + d1[0] * a, hinge[1] + d1[1] * a];
    const outR = [[0, 0], ...cubic(hinge, [L / 4 + 0.1 * L, 0], rte, rte)]; return { sewR, outR, rbe, rte, L }; };
  let L = Lsew, F = make(L); for (let k = 0; k < 30; k++) { const len = 2 * plen(F.sewR); if (Math.abs(len - Lsew) < 1e-5) break; L *= Lsew / len; F = make(L); }
  const mir = P => P.map(p => [-p[0], p[1]]).reverse(), sew = [...mir(F.sewR), ...F.sewR.slice(1)], outer = [...mir(F.outR), ...F.outR.slice(1)];
  return { W, L: F.L, sew, outer, sewLen: plen(sew), outerLen: plen(outer), pointLen: Math.hypot(F.rte[0] - F.rbe[0], F.rte[1] - F.rbe[1]) };
}

// the stand under a collar part: the garment's panel nearest the part's seam roots
function standOf(g, Pg, roots) { const n = Pg.length / 3, votes = new Map();
  for (const r of roots) { let best = -1, bd = Infinity; for (let i = 0; i < n; i++) { const d = (Pg[i * 3] - r[0]) ** 2 + (Pg[i * 3 + 1] - r[1]) ** 2 + (Pg[i * 3 + 2] - r[2]) ** 2; if (d < bd) { bd = d; best = i; } } if (best >= 0) votes.set(g.panel[best], (votes.get(g.panel[best]) || 0) + 1); }
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1; }

export function collar8(ctx) {
  const { parts, P, posed, M, scale, gar, log = () => {} } = ctx, S = { ...COLLAR8, ...(ctx.O.collar || {}) }, out = {};
  const bodySurf = ctx.bodyFullSurf || (ctx.body?.Tfull ? new SurfaceMesh(ctx.body.X, Int32Array.from(ctx.body.Tfull), { cell: 0.02, boundary: false }) : ctx.bodySurf);
  for (const q of parts) { if (q.group !== 'construction' || !S.re.test(q.name)) continue; const t0 = Date.now();
    const g = gar.find(x => x.owner === q.owner || x.name === q.owner); if (!g?.panel || !g.uv) { out[q.name] = { skipped: 'no garment pattern' }; continue; }
    const K = 2 * (S.NT + 1) + 3, nq = q.X.length / 3, cols = nq / K; if (!Number.isInteger(cols) || cols < 8) { out[q.name] = { skipped: `not a ${K}-ring fall (${nq} verts)` }; continue; }
    const Xq = Float64Array.from(P(q)), Pg = P(g), n = Pg.length / 3, pt = (X, i) => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]];
    const roots = [...Array(cols).keys()].map(i => lerp3(pt(Xq, i * K), pt(Xq, i * K + K - 1), 0.5)), ps = standOf(g, Pg, roots); if (ps < 0) { out[q.name] = { skipped: 'no stand' }; continue; }
    // the stand in its flat pattern: its sewn edge (welded to another panel) and its free top edge
    const Wg = weldGarment(g), sv = []; for (let i = 0; i < n; i++) if (g.panel[i] === ps) sv.push(i);
    const sewn = i => Wg.dups[Wg.wid[i]].some(j => g.panel[j] !== ps), bndW = new Uint8Array(Wg.m); for (const L of Wg.loops) for (const w of L.ids) bndW[w] = 1;
    const uOf = i => g.uv[i * 2], vOf = i => g.uv[i * 2 + 1];
    const vTop = i => { let m = -Infinity; for (const j of sv) if (Math.abs(uOf(j) - uOf(i)) < 0.012) m = Math.max(m, vOf(j)); return m; }, vBot = i => { let m = Infinity; for (const j of sv) if (Math.abs(uOf(j) - uOf(i)) < 0.012) m = Math.min(m, vOf(j)); return m; };
    const bot = sv.filter(i => sewn(i)).sort((a, b) => uOf(a) - uOf(b)), top = sv.filter(i => !sewn(i) && bndW[Wg.wid[i]] && vOf(i) >= vTop(i) - 0.25 * (vTop(i) - vBot(i))).sort((a, b) => uOf(a) - uOf(b));
    const dedup = L => L.filter((i, k) => !k || Math.abs(uOf(i) - uOf(L[k - 1])) > 1e-6 || Math.abs(vOf(i) - vOf(L[k - 1])) > 1e-6);
    const B = dedup(bot), Tp = dedup(top); if (B.length < 6 || Tp.length < 6) { out[q.name] = { skipped: `stand edges ${B.length} / ${Tp.length}` }; continue; }
    const flen = L => { let s = 0; for (let k = 1; k < L.length; k++) s += Math.hypot(uOf(L[k]) - uOf(L[k - 1]), vOf(L[k]) - vOf(L[k - 1])); return s; };
    const Lneck = flen(B), Wst = (() => { let s = 0, c = 0; for (const i of Tp) { const w = vTop(i) - vBot(i); if (w > 0) { s += w; c++; } } return c ? s / c : 0.035; })();
    const C = collarFlat(Lneck * (1 + S.ease - S.gap) / (1 + S.ease), Wst, S);
    // the top edge's flat arc length from its centre back (u = 0) and its posed points; the bottom's posed points by u
    const sTop = [0]; for (let k = 1; k < Tp.length; k++) sTop.push(sTop[k - 1] + Math.hypot(uOf(Tp[k]) - uOf(Tp[k - 1]), vOf(Tp[k]) - vOf(Tp[k - 1])));
    let s0 = 0; for (let k = 1; k < Tp.length; k++) if (uOf(Tp[k - 1]) <= 0 && uOf(Tp[k]) >= 0) { const f = (0 - uOf(Tp[k - 1])) / (uOf(Tp[k]) - uOf(Tp[k - 1]) || 1); s0 = sTop[k - 1] + f * (sTop[k] - sTop[k - 1]); }
    const onTop = s => { const x = s0 + s; let k = 1; while (k < Tp.length - 1 && sTop[k] < x) k++; const f = Math.min(1.2, Math.max(-0.2, (x - sTop[k - 1]) / ((sTop[k] - sTop[k - 1]) || 1))); return { p: lerp3(pt(Pg, Tp[k - 1]), pt(Pg, Tp[k]), f), u: uOf(Tp[k - 1]) + (uOf(Tp[k]) - uOf(Tp[k - 1])) * f, tg: nrm(sub(pt(Pg, Tp[k]), pt(Pg, Tp[k - 1]))) }; };
    const onBot = u => { let k = 1; while (k < B.length - 1 && uOf(B[k]) < u) k++; const f = Math.min(1, Math.max(0, (u - uOf(B[k - 1])) / ((uOf(B[k]) - uOf(B[k - 1])) || 1))); return lerp3(pt(Pg, B[k - 1]), pt(Pg, B[k]), f); };
    // the neck's axis: the sewn neckline's plane, up; its centre
    const cen = [0, 0, 0]; for (const i of B) for (let c = 0; c < 3; c++) cen[c] += Pg[i * 3 + c] / B.length;
    let ax = [0, 0, 0]; for (let k = 1; k < B.length; k++) ax = add(ax, cross(sub(pt(Pg, B[k - 1]), cen), sub(pt(Pg, B[k]), cen))); ax = nrm(ax); if (ax[1] < 0) ax = mul(ax, -1);
    const radial = p => { const d = sub(p, cen), h = dot(d, ax); return nrm(sub(d, mul(ax, h))); };
    // the original column order (the part's triangles wind with it): its first root on the stand's -u or +u side
    const uNear = r => { let best = 0, bd = Infinity; for (const i of Tp.concat(B)) { const d = (Pg[i * 3] - r[0]) ** 2 + (Pg[i * 3 + 1] - r[1]) ** 2 + (Pg[i * 3 + 2] - r[2]) ** 2; if (d < bd) { bd = d; best = uOf(i); } } return best; };
    const dir = uNear(roots[0]) <= uNear(roots[cols - 1]) ? 1 : -1;
    // the leaf's flat grid: column i at the sewn edge's arc fraction, row j along the rung to the outer edge at the same fraction
    const NT = S.NT, R = NT + 1, fx = new Float64Array(cols * R * 2), Lc = C.sewLen;
    for (let i = 0; i < cols; i++) { const f = dir > 0 ? i / (cols - 1) : 1 - i / (cols - 1), a = at2(C.sew, f), b = at2(C.outer, f);
      for (let j = 0; j < R; j++) { fx[(i * R + j) * 2] = a[0] + (b[0] - a[0]) * j / NT; fx[(i * R + j) * 2 + 1] = a[1] + (b[1] - a[1]) * j / NT; } }
    // the seam on the stand (flat length for flat length from the centre back) and the fold: straight down over the stand
    const seam = [], Nn = [], Dn = [], X0 = new Float64Array(cols * R * 3), pin = new Uint8Array(cols * R);
    for (let i = 0; i < cols; i++) { const f = dir > 0 ? i / (cols - 1) : 1 - i / (cols - 1), s = (f - 0.5) * Lc, T0 = onTop(s), Bp = onBot(T0.u), D = nrm(sub(Bp, T0.p));
      let N = nrm(cross(D, T0.tg)); if (dot(N, radial(T0.p)) < 0) N = mul(N, -1); seam.push(T0.p); Nn.push(N); Dn.push(D);
      for (let j = 0; j < R; j++) { const w = Math.hypot(fx[(i * R + j) * 2] - fx[(i * R) * 2], fx[(i * R + j) * 2 + 1] - fx[(i * R) * 2 + 1]), p = add(add(T0.p, mul(N, j ? S.lift + 0.0004 * j : S.roll0)), mul(D, j ? w : -S.rise));
        X0[(i * R + j) * 3] = p[0]; X0[(i * R + j) * 3 + 1] = p[1]; X0[(i * R + j) * 3 + 2] = p[2]; if (!j) pin[i * R] = 1; } }
    // the floors: the garment's cloth (with what is sewn on it: the open fronts' facings, the placket) and the skin
    const ownC = parts.filter(x => x !== q && x.group === 'construction' && x.owner === q.owner && /placket/.test(x.name)), Pw = Float64Array.from({ length: Wg.m * 3 }, (_, k) => Pg[Wg.rep[Math.floor(k / 3)] * 3 + (k % 3)]);
    // (WELDED: the panels' seams are not edges; on the raw panels every seam vertex is an open edge and a contact there is skipped: the
    // leaf's edge sank under the yoke along the neckline seam)
    const XS = [Pw, ...ownC.map(x => P(x))], TS = [Wg.T, ...ownC.map(x => x.T)];
    let nn = 0; for (const X of XS) nn += X.length; const Xc = new Float64Array(nn), Tc = []; let o = 0; for (let k = 0; k < XS.length; k++) { Xc.set(XS[k], o * 3); for (const t of TS[k]) Tc.push(t + o); o += XS[k].length / 3; }
    const cloth = new SurfaceMesh(Xc, Int32Array.from(Tc), { cell: 0.02, boundary: true });
    // the garment's winding: outward where the stand is (its normals against the neck's radial)
    let sgn = 0; for (const i of sv) { const w = Wg.wid[i], nv = [cloth.N[w * 3], cloth.N[w * 3 + 1], cloth.N[w * 3 + 2]]; sgn += Math.sign(dot(nv, radial(pt(Pg, i)))); }
    const clothS = sgn >= 0 ? cloth : new SurfaceMesh(Xc, Int32Array.from(Tc, (t, k) => Tc[k - (k % 3) + [0, 2, 1][k % 3]]), { cell: 0.02, boundary: true });
    // lay the folded leaf out of the cloth it starts in (before the solve: a start inside a floor is pushed through it)
    for (let v = 0; v < cols * R; v++) { if (pin[v]) continue; for (const [sf, gp] of [[clothS, S.gapCloth], [bodySurf, S.gapBody]]) { if (!sf) continue; const c = sf.closestAny(X0[v * 3], X0[v * 3 + 1], X0[v * 3 + 2], 0.03); if (!c || c.edge || c.d >= gp) continue; const k = gp - c.d; X0[v * 3] += c.nx * k; X0[v * 3 + 1] += c.ny * k; X0[v * 3 + 2] += c.nz * k; } }
    const tris = [], met = []; for (let i = 0; i + 1 < cols; i++) for (let j = 0; j + 1 < R; j++) { const a = i * R + j, b = a + 1, c = a + R, d = c + 1; for (const [x, y, z] of [[a, c, b], [b, c, d]]) { tris.push(x, y, z); met.push(fx[x * 2], fx[x * 2 + 1], fx[y * 2], fx[y * 2 + 1], fx[z * 2], fx[z * 2 + 1]); } }
    let fab; try { fab = phys(q.fabric && q.fabric !== 'leather' ? q.fabric : S.fabric); } catch { fab = phys(S.fabric); }
    const cl = new Cloth(X0, Int32Array.from(tris), fab, { X0, pin, metric: Float64Array.from(met), tether: false, restAngle: S.restAngle, bendScale: S.bendScale, compress: S.compress, damping: S.damping, vmax: S.vmax });
    const free = Uint8Array.from(pin, p => (p ? 0 : 1)), surf = [{ mesh: clothS, gap: S.gapCloth, mu: S.mu, reach: 0.03, mask: free, garment: true }]; if (bodySurf) surf.push({ mesh: bodySurf, gap: S.gapBody, mu: S.mu, reach: 0.03, mask: free });
    cl.run(S.T, { hz: S.hz, contacts: new Contacts(cols * R, surf, { reach: 0.03, safe: true }), every: S.every });
    const X = cl.X;
    // the layers ride on what is under them: a leaf point whose under layer would lie closer than `under` to the cloth or the skin is
    // lifted (the solve's contacts hold the mid-surface at its gap between refreshes only; a few passes, the leaf's own normal)
    for (let pass = 0; pass < S.settle; pass++) { let moved = 0; for (let v = 0; v < cols * R; v++) { if (pin[v]) continue; const i = Math.floor(v / R), j = v % R;
        const ia = Math.max(0, i - 1), ib = Math.min(cols - 1, i + 1), ja = Math.max(0, j - 1), jb = Math.min(NT, j + 1), du = sub(pt(X, ib * R + j), pt(X, ia * R + j)), dv = sub(pt(X, i * R + jb), pt(X, i * R + ja));
        let nv = nrm(cross(du, dv)); if (dot(nv, radial(pt(X, v))) < 0) nv = mul(nv, -1); const h = 0.0007 + 0.0004 * (1 - j / NT), p = sub(pt(X, v), mul(nv, h));
        for (const [sf, gp] of [[clothS, S.under], [bodySurf, S.under + 0.0005]]) { if (!sf) continue; const c = sf.closestAny(p[0], p[1], p[2], 0.02); if (!c || c.edge || c.d >= gp) continue; const k = gp - c.d; X[v * 3] += c.nx * k; X[v * 3 + 1] += c.ny * k; X[v * 3 + 2] += c.nz * k; moved++; } }
      if (!moved) break; }
    // how true to its pattern the leaf lies (edge stretch, flat -> solved), and how much of it is under the cloth or the skin
    const st = []; for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) { const a = tris[t + k], b = tris[t + (k + 1) % 3], l0 = Math.hypot(fx[a * 2] - fx[b * 2], fx[a * 2 + 1] - fx[b * 2 + 1]); if (l0 > 1e-5) st.push(Math.hypot(X[a * 3] - X[b * 3], X[a * 3 + 1] - X[b * 3 + 1], X[a * 3 + 2] - X[b * 3 + 2]) / l0); }
    st.sort((a, b) => a - b); let under = 0; for (let v = 0; v < cols * R; v++) { if (pin[v]) continue; for (const sf of [clothS, bodySurf]) { if (!sf) continue; const c = sf.closestAny(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], 0.02); if (c && !c.edge && c.d < 0) { under++; break; } } }
    // the leaf's outward normal per grid point (central differences; away from the neck)
    const G = i => i * R, nAt = (i, j) => { const ia = Math.max(0, i - 1), ib = Math.min(cols - 1, i + 1), ja = Math.max(0, j - 1), jb = Math.min(NT, j + 1), du = sub(pt(X, G(ib) + j), pt(X, G(ia) + j)), dv = sub(pt(X, G(i) + jb), pt(X, G(i) + ja)); let nv = nrm(cross(du, dv)); if (dot(nv, radial(pt(X, G(i) + j))) < 0) nv = mul(nv, -1); return nv; };
    // the drawn rings: [root in, upper collar rows 0..NT, rolled edge, under collar rows NT..0, root out] (the part's own topology)
    const th = t => 0.0007 + 0.0004 * (1 - t);
    for (let i = 0; i < cols; i++) { const base = i * K, set = (k, p) => { Xq[(base + k) * 3] = p[0]; Xq[(base + k) * 3 + 1] = p[1]; Xq[(base + k) * 3 + 2] = p[2]; };
      // THE ROLL (the ring runs root -> upper collar -> rolled edge -> under collar -> root): the leaf rises from the seam on the stand's top
      // edge to the roll above it and falls outside; folded, the UPPER collar is the outside of the bend: on the neck's side where the leaf
      // rises, on top at the roll, outside where it falls. So the root by the upper collar lies IN (the neck's side of the seam), the one
      // by the under collar OUT, and at the roll the layers part along the stand's up (the bake's ring had them the other way round at the
      // seam: its cap crossed itself on every column, 46 triangles on L03)
      set(0, add(add(seam[i], mul(Nn[i], -0.0004)), mul(Dn[i], -0.0003))); set(K - 1, add(add(seam[i], mul(Nn[i], 0.0006)), mul(Dn[i], -0.0003)));
      for (let j = 0; j <= NT; j++) { const m = pt(X, G(i) + j), nv = j ? nAt(i, j) : mul(Dn[i], -1), h = th(j / NT); set(1 + j, add(m, mul(nv, h))); set(K - 2 - j, sub(m, mul(nv, h))); }
      const e = pt(X, G(i) + NT), e1 = pt(X, G(i) + NT - 1); set(NT + 2, add(e, mul(nrm(sub(e, e1)), 0.0009))); }
    // the part's weights from the garment's nearest cloth (posed), then back to bind through them
    const cg = 0.02, key = (a, b, c) => ((a + 1024) * 2048 + (b + 1024)) * 2048 + (c + 1024), Hg = new Map(); for (let i = 0; i < n; i++) { const kk = key(Math.floor(Pg[i * 3] / cg), Math.floor(Pg[i * 3 + 1] / cg), Math.floor(Pg[i * 3 + 2] / cg)); (Hg.get(kk) || Hg.set(kk, []).get(kk)).push(i); }
    const SI2 = new Uint8Array(nq * 4), SW2 = new Float32Array(nq * 4);
    for (let v = 0; v < nq; v++) { const x = Xq[v * 3], y = Xq[v * 3 + 1], z = Xq[v * 3 + 2], ci = Math.floor(x / cg), cj = Math.floor(y / cg), ck = Math.floor(z / cg); let best = -1, bd = Infinity;
      for (let r = 1; r <= 3 && best < 0; r++) for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) for (const i of Hg.get(key(ci + a, cj + b, ck + c)) || []) { const d = (Pg[i * 3] - x) ** 2 + (Pg[i * 3 + 1] - y) ** 2 + (Pg[i * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = i; } }
      for (let k = 0; k < 4; k++) { SI2[v * 4 + k] = best >= 0 ? g.SI[best * 4 + k] : q.SI[v * 4 + k]; SW2[v * 4 + k] = best >= 0 ? g.SW[best * 4 + k] : q.SW[v * 4 + k]; } }
    // the two end caps as ladders across the leaf (the bake's fans from the inner root crossed the curved leaf), same triangle count,
    // each cap keeping the winding the bake gave it
    { const T = q.T, capT = 2 * (K - 2), t0c = T.length / 3 - capT; if (t0c >= 0) for (let c = 0; c < 2; c++) { const c0 = (c ? cols - 1 : 0) * K, ft = t0c + c * (K - 2), flip = !(T[ft * 3] === c0 && T[ft * 3 + 1] === c0 + 1 && T[ft * 3 + 2] === c0 + 2);
        if (T[ft * 3] !== c0) continue; const L = []; L.push([0, 1, K - 2], [0, K - 2, K - 1]); for (let j = 1; j <= NT; j++) L.push([j, j + 1, K - 2 - j], [j, K - 2 - j, K - 1 - j]); L.push([NT + 1, NT + 2, NT + 3]);
        for (let k = 0; k < L.length && k < K - 2; k++) { const [a, b, d] = L[k]; T[(ft + k) * 3] = c0 + a; T[(ft + k) * 3 + 1] = c0 + (flip ? d : b); T[(ft + k) * 3 + 2] = c0 + (flip ? b : d); } } }
    q.SI = SI2; q.SW = SW2; ctx.toBind(q, Xq, M, scale, null); posed.set(q, ctx.poseOf(q, M, scale));
    // the collar's two points (the leaf's free corners): below the stand's top at the centre front and out from the centre-front line
    const pts = {}; for (const [lab, i] of [['first', 0], ['last', cols - 1]]) { const p = pt(X, G(i) + NT), sTop = seam[i], up = dot(sub(sTop, p), ax), r = radial(p), cf = radial(lerp3(seam[0], seam[cols - 1], 0.5));
      pts[lab] = { dropMm: +(up * 1000).toFixed(1), outFromNeckMm: +(Math.hypot(...sub(sub(p, cen), mul(ax, dot(sub(p, cen), ax)))) * 1000).toFixed(1), angFromCfDeg: +(Math.acos(Math.max(-1, Math.min(1, dot(r, cf)))) * 180 / Math.PI).toFixed(1) }; }
    out[q.name] = { cols, Lneck: +(Lneck * 1000).toFixed(1), Lsew: +(Lc * 1000).toFixed(1), W: +(C.W * 1000).toFixed(1), outer: +(C.outerLen * 1000).toFixed(1), pointLen: +(C.pointLen * 1000).toFixed(1), standW: +(Wst * 1000).toFixed(1),
      stand: ps, topVerts: Tp.length, botVerts: B.length, strainP10: +st[Math.floor(st.length * 0.1)].toFixed(3), strainP50: +st[Math.floor(st.length * 0.5)].toFixed(3), strainP90: +st[Math.floor(st.length * 0.9)].toFixed(3), under, points: pts, ms: Date.now() - t0 };
    log('collar8', q.name, JSON.stringify(out[q.name])); }
  return out;
}
