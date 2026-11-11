// FINISH (CLOTHING c2, K3): construction that reads at 1:1 on K2's sewn garments as K1's stack solved them (posed, welded cloth), and
// the skin cull. Opt-in: nothing existing imports this file.
//   - a COLLAR with stand and fall: the fall (the turned-down leaf, two layers) rolled over the band collar's top edge and laid down
//     over it and the shoulders, deeper at the front (the points); kept outside the shirt
//   - a PLACKET: a raised 3.2 cm band (three layers) centred on the buttoned centre front, its folded edge rounded; the open fronts above
//     the top button faced (rolled edges); BUTTONS (11 mm, domed) every ~8.5 cm and one on the collar band
//   - CUFFS: the cuff's edge rolled, its overlap tab over the closure and a button
//   - a WAISTBAND panel (3.8 cm, interfaced) round the trousers' waist with a rolled top edge, BELT LOOPS (7), the fly's stitched J (men)
//     or the side placket (women's slacks), the waistband button
//   - DOUBLE-FOLDED HEMS on the trouser legs (a 3.5 cm turned layer inside, the fold rounded)
// Every part is a separate mesh (plain data: bind metres, skin weights of the cloth particle it rides on), named by `construction`,
// so an exporter (CYCLES) carries it as geometry, not as a texture. Built on the POSED cloth (the frames, the offsets and the outside
// tests are physical there), then taken to bind space through each source particle's inverse blend.
//   coverSkin(h, { foundCover, stack }): the body triangles under a foundation (from its fit) or under a garment's drawn cloth away
//   from its edges (the stack's cull test applied to the skin): culled from the body's index (works today), and as an aCover attribute
//   for hero.js's H3 hook when it lands. The fork under trousers and the armpit under a sleeve are where skin came through K2's cloth.
import { SurfaceMesh, vertexNormals, skinPose, blendInverse, boneMats } from './collide.js';
import { sweep, loopFrame, bindingProfile, boundaryLoops, heroScale, orientFrom } from './foundations.js';
import * as SEW from './sew.js';
export const FINISH_VERSION = 1;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const now = () => (globalThis.performance ? performance.now() : Date.now());

// ---------------------------------------------------------------- the solved garment, as pre-weld panels (the flat uv of each panel)
// rec: a stack record of a sewn garment (rec.pattern = the welded cloth, rec.L.pattern = K2's contract, rec.cov = not drawn)
export function garmentParts(h, rec, { id, color, fabric }) {
  const L = rec.L, S0 = SEW.prepare(L.pattern, typeof L.fabric === 'string' ? { body: L.fabric } : (L.fabric || { body: fabric })), W = rec.pattern, map = W.map;
  const m = rec.meshes[0], scale = heroScale(h), BPw = m.geometry.attributes.position.array, n = S0.n;
  const X = new Float64Array(n * 3), SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4), uv = new Float64Array(n * 2), panel = new Uint8Array(n);
  let o = 0; L.pattern.panels.forEach((pn, k) => { for (let i = 0; i < pn.uv.length / 2; i++) { uv[(o + i) * 2] = pn.uv[i * 2]; uv[(o + i) * 2 + 1] = pn.uv[i * 2 + 1]; panel[o + i] = k; } o += pn.uv.length / 2; });
  for (let i = 0; i < n; i++) { const j = map[i]; for (let c = 0; c < 3; c++) X[i * 3 + c] = BPw[j * 3 + c] * scale; SI.set(rec.G.SI.subarray(j * 4, j * 4 + 4), i * 4); SW.set(rec.G.SW.subarray(j * 4, j * 4 + 4), i * 4); }
  const cov = rec.cov, T = []; for (let t = 0; t < S0.tris.length; t += 3) { const a = S0.tris[t], b = S0.tris[t + 1], c = S0.tris[t + 2]; if (cov && cov[map[a]] && cov[map[b]] && cov[map[c]]) continue; T.push(a, b, c); }
  return [{ name: id, X, T: Int32Array.from(T), SI, SW, uv, panel, fabric: S0.fabNames[0] || fabric, color, part: id, construction: 'panels', flatUv: true, panels: L.pattern.panels.map(p => p.name) }];
}

// ---------------------------------------------------------------- helpers on a solved garment (posed)
export function solved(h, rec) {   // (CLOTH4: exported for cloth4.js)
  const W = rec.pattern, X = rec.X, n = W.n, N = vertexNormals(X, W.tris); if ((rec.Nn?.sign ?? 1) < 0) for (let i = 0; i < N.length; i++) N[i] = -N[i];
  // the panels each welded particle belongs to; its K2 global id(s)
  const S0n = W.map.length, panels = Array.from({ length: n }, () => new Set()), off = [], names = rec.L.pattern.panels.map(p => p.name); let o = 0;
  rec.L.pattern.panels.forEach((pn, k) => { off[k] = o; for (let i = 0; i < pn.uv.length / 2; i++) panels[W.map[o + i]].add(pn.name); o += pn.uv.length / 2; }); void S0n;
  const gid = (panel, v) => W.map[off[names.indexOf(panel)] + v];
  const surf = new SurfaceMesh(X, W.tris, { cell: 0.02, normals: N, boundary: true });
  return { W, X, N, n, panels, gid, surf, loops: boundaryLoops(W.tris, n) };
}
// new posed points -> bind metres, skinned like the cloth particle each came from
function toBind(h, rec, Xp, src, scale, M) {
  const m = Xp.length / 3, out = new Float64Array(m * 3), SI = new Uint16Array(m * 4), SW = new Float32Array(m * 4), tmp = [0, 0, 0];
  for (let v = 0; v < m; v++) { const p = src[v]; blendInverse(rec.G.SI, rec.G.SW, p, M, Xp[v * 3] / scale, Xp[v * 3 + 1] / scale, Xp[v * 3 + 2] / scale, tmp, 0); for (let c = 0; c < 3; c++) out[v * 3 + c] = tmp[c] * scale;
    SI.set(rec.G.SI.subarray(p * 4, p * 4 + 4), v * 4); SW.set(rec.G.SW.subarray(p * 4, p * 4 + 4), v * 4); }
  return { X: out, SI, SW };
}
// push points out of the garment's own surface (a fall lying over the shoulders, a loop below the band) to at least gap
function keepOut(Xp, surf, gap, mask = null) { for (let v = 0; v < Xp.length / 3; v++) { if (mask && !mask[v]) continue; const q = surf.closestAny(Xp[v * 3], Xp[v * 3 + 1], Xp[v * 3 + 2], 0.03); if (!q || q.edge) continue; if (q.d < gap) { const k = gap - q.d; Xp[v * 3] += q.nx * k; Xp[v * 3 + 1] += q.ny * k; Xp[v * 3 + 2] += q.nz * k; } } }
// a polyline of particles -> frame (points, normals, tangents, side = N x T)
function lineFrame(G, ids, smooth = 2) {
  let P = ids.map(v => [G.X[v * 3], G.X[v * 3 + 1], G.X[v * 3 + 2]]); const N = ids.map(v => [G.N[v * 3], G.N[v * 3 + 1], G.N[v * 3 + 2]]), m = P.length;
  for (let it = 0; it < smooth; it++) P = P.map((q, i) => (i === 0 || i === m - 1 ? q : q.map((c, j) => (P[i - 1][j] + 2 * c + P[i + 1][j]) / 4)));
  const T = P.map((q, i) => nrm(sub(P[Math.min(m - 1, i + 1)], P[Math.max(0, i - 1)]))), Sd = P.map((q, i) => nrm(cross(N[i], T[i])));
  return { P, N, T, S: Sd, m };
}
// CLOTH5: one ring of the collar fall as a SHELL about its centre arc. K3's ring offset the under layer 1.6 mm (to 0 at the edge) along the
// stand's normal and pushed every point out of the shirt on its own: where the leaf lies near the shirt the under layer was pushed past the
// upper (the leaf crossed itself: 28 % of the fall's triangles on L03, the dark polygons on every closed collar), and at the edge the two
// layers met in one point (their normals averaged to nothing). Here the centre arc is kept 3.4 mm off the shirt first, then each layer is
// offset along the arc's own normal (turned to the outside), 0.7-1.1 mm a side, so the two layers can never cross; the edge is a rolled fold.
function fall5Ring(P, Nn, A, Bm, E, q, Tr, NT, surf) {
  const C = [], th = tt => 0.0007 + 0.0004 * (1 - tt);
  for (let t2 = 0; t2 <= NT; t2++) { const tt = t2 / NT; C.push(A.map((x, j) => (1 - tt) ** 2 * x + 2 * tt * (1 - tt) * Bm[j] + tt * tt * E[j])); }
  const Cf = Float64Array.from(C.flat()); keepOut(Cf, surf, 0.0034); for (let t2 = 1; t2 <= NT; t2++) C[t2] = [Cf[t2 * 3], Cf[t2 * 3 + 1], Cf[t2 * 3 + 2]];
  const qn = q ? [q.nx, q.ny, q.nz] : Nn, up = [], dn = [];
  for (let t2 = 0; t2 <= NT; t2++) { const tt = t2 / NT, d = sub(C[Math.min(NT, t2 + 1)], C[Math.max(0, t2 - 1)]); let nl = nrm(cross(d, Tr)); const ref = nrm(Nn.map((c, j) => c * (1 - tt) + qn[j] * tt)); if (nl[0] * ref[0] + nl[1] * ref[1] + nl[2] * ref[2] < 0) nl = nl.map(x => -x);
    up.push(C[t2].map((c, j) => c + nl[j] * th(tt))); dn.push(C[t2].map((c, j) => c - nl[j] * th(tt))); }
  const tip = sub(C[NT], C[NT - 1]), tl = Math.hypot(...tip) || 1, edge = C[NT].map((c, j) => c + tip[j] / tl * 0.0009);
  const ring = [P.map((c, j) => c + Nn[j] * 0.0012 + (j === 1 ? 0.0006 : 0)), ...up, edge, ...dn.reverse(), P.map((c, j) => c + Nn[j] * 0.0024)];
  return { ring, cen: C[3] };
}
// a part from a sweep (posed) -> plain data in bind
export function partFrom(h, rec, S, srcIds, name, construction, color, fabric, scale, M, extra = {}) {   // (CLOTH4: exported)
  const src = Int32Array.from(S.src, i => srcIds[i]), B = toBind(h, rec, S.X, src, scale, M), m = S.X.length / 3, uv = new Float64Array(m * 2);
  for (let v = 0; v < m; v++) { uv[v * 2] = (S.uvU ? S.uvU[v] : 0); uv[v * 2 + 1] = (S.uvV ? S.uvV[v] : S.src[v] * 0.01); }
  return { name, X: B.X, T: S.T, SI: B.SI, SW: B.SW, uv, fabric, color, part: rec.L.id, construction, ...extra };
}
// a button: a domed disc (radius r, thickness t) at p, facing n
export function buttonGeom(p, n, r = 0.0055, t = 0.0022, seg = 14) {   // (CLOTH4: exported)
  const a = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = nrm(cross(n, a)), w = cross(n, u), X = [], T = [];
  const ring = (rr, h) => { const o = X.length / 3; for (let k = 0; k < seg; k++) { const an = k / seg * Math.PI * 2, cu = Math.cos(an) * rr, sw = Math.sin(an) * rr; X.push(p[0] + u[0] * cu + w[0] * sw + n[0] * h, p[1] + u[1] * cu + w[1] * sw + n[1] * h, p[2] + u[2] * cu + w[2] * sw + n[2] * h); } return o; };
  const r0 = ring(r * 0.96, 0), r1 = ring(r, t * 0.55), r2 = ring(r * 0.78, t * 0.85), r3 = ring(r * 0.55, t * 0.75), c = X.length / 3; X.push(p[0] + n[0] * t * 0.7, p[1] + n[1] * t * 0.7, p[2] + n[2] * t * 0.7);
  const band = (A, B2) => { for (let k = 0; k < seg; k++) { const k2 = (k + 1) % seg; T.push(A + k, A + k2, B2 + k, B2 + k, A + k2, B2 + k2); } };
  band(r0, r1); band(r1, r2); band(r2, r3); for (let k = 0; k < seg; k++) T.push(r3 + k, r3 + (k + 1) % seg, c);
  const Xa = Float64Array.from(X), Ta = Int32Array.from(T), mid = p.map((q, i) => q + n[i] * t * 0.3); orientFrom(Xa, Ta, () => mid); return { X: Xa, T: Ta };
}
function merge(list) { let n = 0; const X = [], T = [], src = []; for (const g of list) { for (const x of g.X) X.push(x); for (const t of g.T) T.push(t + n); for (let i = 0; i < g.X.length / 3; i++) src.push(g.src ?? 0); n += g.X.length / 3; } return { X: Float64Array.from(X), T: Int32Array.from(T), src: Int32Array.from(src) }; }
// order a set of boundary particles along a loop (the loop's own order), split into runs where the set breaks
function runsOf(loop, keep) { const ids = loop.ids, m = ids.length, inS = ids.map(v => keep(v)); if (inS.every(Boolean)) return [ids.slice()];
  let s = inS.findIndex(x => !x); const out = []; let cur = []; for (let k = 1; k <= m; k++) { const i = (s + k) % m; if (inS[i]) cur.push(ids[i]); else if (cur.length) { out.push(cur); cur = []; } } if (cur.length) out.push(cur); return out; }

// ---------------------------------------------------------------- the construction
// own (CLOTH3, opt-in): the construction in the garment's OWN fabric (its collar, placket, cuffs, waistband, fly and hems in the flannel or
// denim of the garment; default: chambray for a shirt's, poly-cotton twill for trousers', as K3 drew them: a pale chambray placket and
// collar on a flannel shirt)
export function construct(h, Sx, { shirt = null, trousers = null, own = false, fall5 = false } = {}) {   // fall5 (CLOTH5, opt-in): the collar fall built as a shell about one centre arc (fall5Ring)
  const t0 = now(), scale = heroScale(h); h.group.updateMatrixWorld(true); const M = boneMats(h.skeleton, h.body.matrixWorld), parts = [], rep = {};
  const tuckY = shirt?.rec?.L?.tuckTop ?? null;
  if (shirt?.rec) { const r = shirt.rec, G = solved(h, r), col = shirt.color, men = shirt.sex !== 'f', vis = r.solved.visCore; const drawn = v => !vis || vis[v];
    const fS = own ? r.fabric : 'chambray';
    const pat = r.L.pattern, cf = (pat.closures || []).find(c => c.name === 'cf');
    // the neck opening: its stand-only run gets the fall; its front-only runs the facing (rolled edges)
    const neck = G.loops.map(L => ({ L, k: L.ids.filter(v => G.panels[v].has('stand')).length })).sort((a, b) => b.k - a.k)[0]?.L;
    if (neck) { const standRun = runsOf(neck, v => G.panels[v].has('stand') && !G.panels[v].has('frontL') && !G.panels[v].has('frontR')).sort((a, b) => b.length - a.length)[0];
      if (standRun && standRun.length > 6) { const F = lineFrame(G, standRun, 3), m = F.m, hs = 0.032, prof = s => { const D = 0.045 + 0.01 * Math.max(sstep(0.88, 1, s), sstep(0.12, 0, s)), fl = 0.006 + 0.01 * (D - 0.044) / 0.03;
            return [[-0.0012, 0.0012], [-0.0026, 0.0035], [-0.0012, 0.0058], [0.004, 0.0068], [hs * 0.6, 0.0075], [hs, 0.0085 + fl * 0.3], [D, 0.0095 + fl], [D + 0.0012, 0.0085 + fl], [D, 0.0075 + fl], [hs, 0.0065 + fl * 0.3], [hs * 0.6, 0.0055], [0.004, 0.0046], [0, 0.0028]]; };
        // the fall: from a roll over the band's top edge, a two-layer leaf laid down onto the shirt where it lands (3 cm out and 1.3 cm under
        // the neckline seam; the points 2.5 cm further down the front), a quadratic arc kept 2.5 mm off the shirt and the band
        void prof; const C0 = F.P.reduce((a2, q) => a2.map((c, j) => c + q[j] / m), [0, 0, 0]), Xp = [], src = [], Tt = [], cen = [], NT = 6;
        for (let i = 0; i < m; i++) { const s2 = i / (m - 1), pt = Math.max(sstep(0.86, 1, s2), sstep(0.14, 0, s2)), P = F.P[i], Nn = F.N[i], oh = nrm([P[0] - C0[0], 0, P[2] - C0[2]]);
          const tgt = [P[0] + oh[0] * (0.03 + 0.01 * pt), P[1] - (hs + 0.013 + 0.03 * pt), P[2] + oh[2] * (0.03 + 0.01 * pt) + 0.012 * pt], q = G.surf.closestAny(tgt[0], tgt[1], tgt[2], 0.08), E = q ? [q.px + q.nx * 0.003, q.py + q.ny * 0.003, q.pz + q.nz * 0.003] : tgt;
          const A = P.map((c, j) => c + Nn[j] * 0.0035 + (j === 1 ? 0.0015 : 0)), Bm = P.map((c, j) => c + Nn[j] * 0.014 + (E[j] - c) * 0.45), up = [], dn = [];
          if (fall5) { const R5 = fall5Ring(P, Nn, A, Bm, E, q, F.T[i], NT, G.surf); for (const q2 of R5.ring) { Xp.push(...q2); src.push(standRun[i]); } cen.push(R5.cen); continue; }
          for (let t2 = 0; t2 <= NT; t2++) { const tt = t2 / NT, c = A.map((x, j) => (1 - tt) ** 2 * x + 2 * tt * (1 - tt) * Bm[j] + tt * tt * E[j]); up.push(c); dn.push(c.map((x, j) => x - Nn[j] * 0.0016 * (1 - tt) - (tt > 0.5 ? (E[j] - P[j]) * 0 : 0))); }
          const ring = [P.map((c, j) => c + Nn[j] * 0.0012 + (j === 1 ? 0.0006 : 0)), ...up, E.map((c, j) => c + (E[j] - A[j]) * 0.02), ...dn.reverse(), P.map((c, j) => c + Nn[j] * 0.0024)];
          for (const q2 of ring) { Xp.push(...q2); src.push(standRun[i]); } cen.push(up[3].map((c, j) => (c + dn[NT - 3][j]) / 2)); }
        const k = 2 * (NT + 1) + 3;
        for (let i = 0; i + 1 < m; i++) for (let j = 0; j < k; j++) { const j2 = (j + 1) % k, a = i * k + j, b = i * k + j2, c = (i + 1) * k + j, d = (i + 1) * k + j2; Tt.push(a, c, b, b, c, d); }
        for (const i of [0, m - 1]) { const c0 = i * k; for (let j = 1; j + 1 < k; j++) Tt.push(c0, c0 + j, c0 + j + 1); }
        const X = Float64Array.from(Xp), TT = Int32Array.from(Tt); if (!fall5) keepOut(X, G.surf, 0.0022); orientFrom(X, TT, t => cen[Math.floor(TT[t * 3] / k)]);
        parts.push(partFrom(h, r, { X, T: TT, src: Int32Array.from({ length: X.length / 3 }, (_, i) => i) }, src, 'collar.fall', 'collar', col, fS, scale, M));
        // the collar band's button (the top one, worn open): on the stand at the end that overlaps
        const e0 = men ? (F.P[0][0] < F.P[m - 1][0] ? 0 : m - 1) : (F.P[0][0] > F.P[m - 1][0] ? 0 : m - 1), I0 = nrm(cross(F.N[e0], F.T[e0]));
        const bp = F.P[e0].map((c, j) => c - (I0[1] > 0 ? -1 : 1) * I0[j] * 0.016 + F.N[e0][j] * 0.0012 - F.T[e0][j] * (e0 ? 0.012 : -0.012) * 0); const bt = buttonGeom(bp, F.N[e0]);
        parts.push(partFrom(h, r, { X: bt.X, T: bt.T, src: new Int32Array(bt.X.length / 3) }, [standRun[e0]], 'button.collar', 'button', '#e8e2d4', 'leather', scale, M, { solid: true })); }
      // the open fronts above the top button: faced edges (rolled, 1.6 cm in)
      for (const run of runsOf(neck, v => !G.panels[v].has('stand') && (G.panels[v].has('frontL') || G.panels[v].has('frontR')))) { if (run.length < 4) continue; const F = lineFrame(G, run, 2), prof = bindingProfile(0.016, 0.0006, 0.0012);
        const S = sweep(F.P, F.N, F.P.map((q, i) => { const s = nrm(cross(F.N[i], F.T[i])), c = [0, 0, 0]; void c; return s; }), prof, false);
        // the facing goes INTO the front: flip the side if it points out of the cloth (toward the opening's centre)
        const mid = F.P[Math.floor(F.m / 2)], sd = nrm(cross(F.N[Math.floor(F.m / 2)], F.T[Math.floor(F.m / 2)])); if (Math.abs(mid[0] + sd[0] * 0.02) < Math.abs(mid[0])) { const S2 = sweep(F.P, F.N, F.P.map((q, i) => nrm(cross(F.T[i], F.N[i]))), prof, false); S.X = S2.X; S.T = S2.T; S.src = S2.src; }
        parts.push(partFrom(h, r, S, run, 'placket.open', 'placket', col, fS, scale, M)); } }
    // the buttoned placket on the closed centre front, and its buttons
    if (cf) { const ids = Array.from(cf.a.verts, v => G.gid(cf.a.panel, v)), seen = new Set(), run = ids.filter(v => (seen.has(v) ? false : seen.add(v))).filter(v => drawn(v) || !vis);
      // order bottom to top (the closure lists cfHem -> topButton)
      if (run.length > 4) { const F = lineFrame(G, run, 3), w = 0.032, prof = men ? [[w / 2 + 0.001, 0.0002], [w / 2, 0.0016], [-w / 2 + 0.002, 0.0019], [-w / 2, 0.0012], [-w / 2 - 0.0005, 0.0002]] : [[-w / 2 - 0.001, 0.0002], [-w / 2, 0.0016], [w / 2 - 0.002, 0.0019], [w / 2, 0.0012], [w / 2 + 0.0005, 0.0002]];
        const keep = F.P.map(q => tuckY == null || q[1] > tuckY - 0.03), sel = run.filter((_, i) => keep[i]); if (sel.length > 3) { const F2 = lineFrame(G, sel, 3), S = sweep(F2.P, F2.N, F2.S, prof, false); keepOut(S.X, G.surf, 0.0003);
          parts.push(partFrom(h, r, S, sel, 'placket', 'placket', col, fS, scale, M));
          // buttons: from the top button down every 8.5 cm (arc length), above the tuck line
          const arc = [0]; for (let i = 1; i < F2.m; i++) arc.push(arc[i - 1] + len(sub(F2.P[i], F2.P[i - 1]))); const top = arc[F2.m - 1]; const bl = [];
          for (let s = top; s > 0.02; s -= 0.085) { let i = arc.findIndex(a => a >= s); if (i < 0) i = F2.m - 1; const bt = buttonGeom(F2.P[i].map((c, j) => c + F2.N[i][j] * 0.0021), F2.N[i]); bl.push({ ...bt, src: i }); }
          if (bl.length) { const mg = merge(bl); parts.push(partFrom(h, r, mg, sel, 'buttons.front', 'button', '#e8e2d4', 'leather', scale, M, { solid: true })); rep.buttons = bl.length; } } } }
    // cuffs: the wrist edge rolled; the overlap tab over the closure; a button
    for (const sd of ['L', 'R']) { const cp = 'cuff' + sd; if (!pat.panels.some(p => p.name === cp)) continue;
      const loop = G.loops.map(L => ({ L, k: L.ids.filter(v => G.panels[v].has(cp)).length })).sort((a, b) => b.k - a.k)[0]; if (!loop || loop.k < 6) continue;
      const fr = loopFrame(loop.L.ids, G.X, G.N, loop.L.closed, 2), S = sweep(fr.P, fr.N, fr.I, bindingProfile(0.01, 0.0008, 0.0011), loop.L.closed);
      parts.push(partFrom(h, r, S, loop.L.ids, 'cuff.edge.' + sd, 'cuff', col, fS, scale, M));
      const cl = (pat.closures || []).find(c => c.name === 'cuffClose' + sd); if (cl) { const ids = Array.from(cl.a.verts, v => G.gid(cl.a.panel, v)); if (ids.length > 2) { const F = lineFrame(G, ids, 1), w = 0.024, prof = [[-0.002, 0.0002], [-0.0005, 0.0016], [w, 0.0018], [w + 0.0012, 0.0006], [w + 0.0014, 0.0001]];
          const S2 = sweep(F.P, F.N, F.S, prof, false); parts.push(partFrom(h, r, S2, ids, 'cuff.tab.' + sd, 'cuff', col, fS, scale, M));
          const i = Math.floor(F.m / 2), bt = buttonGeom(F.P[i].map((c, j) => c + F.S[i][j] * 0.012 + F.N[i][j] * 0.0019), F.N[i], 0.005); parts.push(partFrom(h, r, { X: bt.X, T: bt.T, src: new Int32Array(bt.X.length / 3) }, [ids[i]], 'button.cuff.' + sd, 'button', '#e8e2d4', 'leather', scale, M, { solid: true })); } } }
    rep.shirt = { loops: G.loops.length, parts: parts.length }; }
  if (trousers?.rec) { const r = trousers.rec, G = solved(h, r), col = trousers.color, men = trousers.sex !== 'f', pat = r.L.pattern, n0 = parts.length;
    const fT = own ? r.fabric : 'twillPC';
    const holdIds = new Set(); for (const hd of pat.holds || []) for (const v of hd.verts) holdIds.add(G.gid(hd.panel, v));
    const waist = G.loops.map(L => ({ L, k: L.ids.filter(v => holdIds.has(v)).length })).sort((a, b) => b.k - a.k)[0];
    if (waist && waist.k > 10) { const L = waist.L, fr = loopFrame(L.ids, G.X, G.N, L.closed, 3), wb = 0.038, t = 0.0019;
      // inward = down the cloth from the top edge
      const I = fr.I.map(v => (v[1] > 0 ? v.map(c => -c) : v)), prof = [[wb + 0.001, 0.0003], [wb, t], [0.004, t + 0.0001], [0.0005, t * 0.7], [-0.0012, 0], [0.0005, -t * 0.7], [0.004, -t], [wb, -t], [wb + 0.001, -0.0003]];
      const S = sweep(fr.P, fr.N, I, prof, L.closed), outer = Uint8Array.from({ length: S.X.length / 3 }, (_, v) => (prof[v % prof.length][1] > 0 ? 1 : 0)); keepOut(S.X, G.surf, t, outer);   // the band's face stays over the crumpled waist cloth
      parts.push(partFrom(h, r, S, L.ids, 'waistband', 'waistband', col, fT, scale, M));
      // belt loops: 7, by arc length from the centre front
      const m = fr.P.length, arc = [0]; for (let i = 1; i <= m; i++) arc.push(arc[i - 1] + len(sub(fr.P[i % m], fr.P[i - 1]))); const tot = arc[m];
      let cfI = 0, best = -Infinity; for (let i = 0; i < m; i++) { const sc = fr.P[i][2] - Math.abs(fr.P[i][0]) * 3; if (sc > best) { best = sc; cfI = i; } }
      const loopsAt = [0.11, 0.24, 0.37, 0.5, 0.63, 0.76, 0.89], bl = [];
      for (const fq of loopsAt) { const s = (arc[cfI] + fq * tot) % tot; let i = arc.findIndex(a => a >= s); if (i < 0 || i >= m) i = m - 1; const P0 = fr.P[i], N0 = fr.N[i], D = I[i], Tg = nrm(sub(fr.P[(i + 1) % m], fr.P[(i - 1 + m) % m])), w = 0.011, X = [], Tt = [];
        const prof2 = [[-w / 2, t], [-w / 2, t + 0.0026], [-w / 2 + 0.0015, t + 0.0032], [w / 2 - 0.0015, t + 0.0032], [w / 2, t + 0.0026], [w / 2, t]], steps = [0.001, 0.004, 0.012, 0.025, 0.038, 0.046, 0.052];
        steps.forEach((u, a) => { const fall = u > wb ? -(u - wb) * 0.25 : 0; for (const [s2, v] of prof2) X.push(...P0.map((c, j) => c + D[j] * u + Tg[j] * s2 + N0[j] * (v + fall))); });
        const k = prof2.length; for (let a = 0; a + 1 < steps.length; a++) for (let j = 0; j + 1 < k; j++) { const p0 = a * k + j; Tt.push(p0, p0 + k, p0 + 1, p0 + 1, p0 + k, p0 + k + 1); }
        const Xa = Float64Array.from(X), Ta = Int32Array.from(Tt), mid = steps.map(u => P0.map((c, j) => c + D[j] * u + N0[j] * (t + 0.0016))); orientFrom(Xa, Ta, tt => mid[Math.floor(Ta[tt * 3] / k)]); keepOut(Xa, G.surf, t + 0.0008); bl.push({ X: Xa, T: Ta, src: i }); }
      const mg = merge(bl); parts.push(partFrom(h, r, mg, L.ids, 'beltloops', 'beltloop', col, fT, scale, M));
      // the waistband's button at the front closure (men: the centre front; women: the left side placket's top)
      let bi = cfI; if (!men) { let bx = -Infinity; for (let i = 0; i < m; i++) if (fr.P[i][0] > bx && fr.P[i][2] > (fr.P[cfI][2] - 0.12)) { bx = fr.P[i][0]; bi = i; } }
      const bt = buttonGeom(fr.P[bi].map((c, j) => c + I[bi][j] * wb * 0.45 + fr.N[bi][j] * (t + 0.0003)), fr.N[bi], 0.0075, 0.0026); parts.push(partFrom(h, r, { X: bt.X, T: bt.T, src: new Int32Array(bt.X.length / 3) }, [L.ids[bi]], 'button.waist', 'button', '#3a3430', 'leather', scale, M, { solid: true }));
      rep.waist = { loops: loopsAt.length, girthCm: +(tot * 100).toFixed(1) }; }
    // the fly (men: a stitched J beside the closed fly) or the side placket (women's slacks): a raised edge along the closure
    const cl = (pat.closures || []).find(c => c.name === (men ? 'fly' : 'placketL')); if (cl) { const ids = []; const seen = new Set(); for (const v of cl.a.verts) { const g = G.gid(cl.a.panel, v); if (!seen.has(g)) { seen.add(g); ids.push(g); } }
      if (ids.length > 3) { const F = lineFrame(G, ids, 3); let off = men ? 0.034 : 0.012; const pts = F.P.map((q, i) => { const tt = i / (F.m - 1), o2 = men ? off * (1 - sstep(0.78, 1.0, tt) * 0.85) : off; return q.map((c, j) => c + F.S[i][j] * o2 * (men ? 1 : 1)); });
        // the fly lies on the wearer's left: flip the side if it went to the right
        if (men && pts[Math.floor(F.m / 3)][0] < 0) for (let i = 0; i < F.m; i++) for (let j = 0; j < 3; j++) pts[i][j] = F.P[i][j] - (pts[i][j] - F.P[i][j]);
        const prof = [[-0.003, 0.0003], [-0.001, 0.0016], [0.008, 0.0014], [0.012, 0.0004]], S = sweep(pts, F.N, F.S.map(s => (men ? s.map(c => -c) : s)), prof, false); keepOut(S.X, G.surf, 0.0004);
        parts.push(partFrom(h, r, S, ids, men ? 'fly' : 'placket.side', men ? 'fly' : 'placket', col, fT, scale, M)); } }
    // hems: double-folded (a 3.5 cm turned layer inside, the fold rounded); the leg loops are the long ones with no waistband hold
    for (const L of G.loops) { if (waist && L === waist.L) continue; let ymin = Infinity; for (const v of L.ids) ymin = Math.min(ymin, G.X[v * 3 + 1]); if (L.ids.length < 12 || ymin > 0.3) continue;
      const fr = loopFrame(L.ids, G.X, G.N, L.closed, 2), I = fr.I.map(v => (v[1] < 0 ? v.map(c => -c) : v)), prof = [[0.006, 0.0005], [0.0012, 0.0009], [-0.0012, 0], [0.0012, -0.0011], [0.035, -0.0012], [0.036, -0.0004]];
      parts.push(partFrom(h, r, sweep(fr.P, fr.N, I, prof, L.closed), L.ids, 'hem', 'hem', col, fT, scale, M)); }
    rep.trousers = { loops: G.loops.length, parts: parts.length - n0 }; }
  rep.ms = Math.round(now() - t0); rep.parts = parts.map(p => p.name);
  return { parts, report: rep };
}

// ---------------------------------------------------------------- the skin cull
// base: body triangles under a foundation (2+ rings from its edges); full: also under a garment's drawn cloth 4+ rings from its edges
// whole (CLOTH3, opt-in): skin is covered under a garment's whole SIMULATED cloth too (a tucked tail's band, drawn or not, away from its
// own edge), not only under its drawn cloth 4+ rings from its edges: the band between a tucked shirt's drawn edge and the waistband let
// the (P1-detailed) belly through as a strip of skin at the tuck
export function coverSkin(h, { foundCover = null, stack = null, whole = false } = {}) {
  const g = h.body.geometry, idx = g.index.array, P = g.attributes.position.array, n = P.length / 3, scale = heroScale(h); h.group.updateMatrixWorld(true);
  const cov0 = new Uint8Array(n); if (foundCover) for (let v = 0; v < Math.min(n, foundCover.length); v++) cov0[v] = foundCover[v];
  const cov1 = Uint8Array.from(cov0); let under = 0;
  if (stack) { const M = boneMats(h.skeleton, h.body.matrixWorld), X = skinPose(Float64Array.from(P), g.attributes.skinIndex.array, g.attributes.skinWeight.array, M, new Float64Array(n * 3), scale);
    const recs = [...stack.recs.values()].filter(r => r.visSurf && r._deep);
    if (whole) { const all = [...stack.recs.values()].filter(r => r.surf && r.cl); for (let v = 0; v < n; v++) { if (cov1[v]) continue; for (const r of all) { const q = r.surf.closest(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], 0.045); if (q && !q.edge && q.d < 0.002) { cov1[v] = 1; under++; break; } } } }
    for (let v = 0; v < n; v++) { if (cov1[v]) continue; for (const r of recs) { const q = r.visSurf.closest(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], 0.045); if (q && !q.edge && r._deep(q.tri) && q.d < 0.002) { cov1[v] = 1; under++; break; } } } }
  // vertices past the fitted body (lane A's detail at the nipples and elsewhere: indices >= the foundation's body count) take the cover
  // of the nearest fitted vertex within 1.5 cm (the nipple's tip triangles were never culled and came through every cup)
  const nf = foundCover ? foundCover.length : n; if (nf < n) inheritCover(P, nf, n, [cov0, cov1]);
  const list = cov => { const out = []; for (let t = 0; t < idx.length; t += 3) if (cov[idx[t]] && cov[idx[t + 1]] && cov[idx[t + 2]]) out.push(t / 3); return Uint32Array.from(out); };
  const base = list(cov0), full = list(cov1);
  return { base, full, cov: cov1, report: { trisBase: base.length, trisFull: full.length, of: idx.length / 3, underGarments: under } };
}
// foundation parts under a garment's drawn cloth (2+ rings from its edges, within 1.2 cm) are not drawn: a strap or a waistband that
// stands 2 mm proud came through a shirt in patches. The same test applies AT an opening/edge: a foundation standing OUTSIDE the outer
// cloth by more than `outside` is a poke-through, not a hem reveal (the 2026-10-19 L22/S6 bust tags: k3_strap.0/1 and
// k3_binding.waist stood 3.2-9.4 mm outside k3_top at the shoulder/hem boundary, so the ring guard kept them). parts: plain data
// (bind); posed with the hero's current pose. Returns counts, including the outside/edge pokes culled.
export function cullUnderGarments(h, parts, stack, { rings = 2, reach = 0.012, outside = 0.0005 } = {}) {
  if (!stack) return []; const scale = heroScale(h); h.group.updateMatrixWorld(true); const M = boneMats(h.skeleton, h.body.matrixWorld), out = [];
  const outers = [...stack.recs.values()].filter(r => r.visSurf && r.visSurf.bnd).map(r => { const S = r.visSurf, ring = new Int32Array(S.n).fill(99), q0 = []; for (let v = 0; v < S.n; v++) if (S.bnd[v]) { ring[v] = 0; q0.push(v); }
    for (let k = 0, f = q0; k < rings && f.length; k++) { const nx = []; for (const v of f) for (let j = S.no[v]; j < S.no[v + 1]; j++) { const u = S.nbr[j]; if (ring[u] > k + 1) { ring[u] = k + 1; nx.push(u); } } f = nx; } return { S, ring }; });
  for (const p of parts) { const X = skinPose(Float64Array.from(p.X, x => x / scale), p.SI, p.SW, M, new Float64Array(p.X.length), scale), n = X.length / 3, cv = new Uint8Array(n), poke = new Uint8Array(n); let pokes = 0;
    for (let v = 0; v < n; v++) for (const o of outers) { const q = o.S.closest(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], reach); if (!q) continue;
      if (q.d > outside) { cv[v] = 1; poke[v] = 1; pokes++; break; }                // (a foundation outside the outer cloth, even at its boundary)
      if (q.edge) continue; const t = q.tri * 3;
      if (o.ring[o.S.tris[t]] >= rings && o.ring[o.S.tris[t + 1]] >= rings && o.ring[o.S.tris[t + 2]] >= rings) { cv[v] = 1; break; } }
    // a triangle with ANY outside vertex is a visible tab (the other two may still be under the outer cloth): cut it whole. The all-vertex
    // rule stays for the interior/ring cull, so an inner layer is not opened by one interior vertex.
    const T = []; let k = 0; for (let t = 0; t < p.T.length; t += 3) { const a = p.T[t], b = p.T[t + 1], c = p.T[t + 2];
      if (poke[a] || poke[b] || poke[c] || (cv[a] && cv[b] && cv[c])) { k++; continue; } T.push(a, b, c); }
    if (k) { p.Tfull = Int32Array.from(T); out.push({ part: p.name, owner: p.owner, tris: k, of: p.T.length / 3, pokes }); } }
  return out;
}
export function inheritCover(P, nf, n, covs) { const cell = 0.02, grid = new Map(), key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let v = 0; v < nf; v++) { const k = key(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(v); }
  for (let v = nf; v < n; v++) { const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell); let best = -1, bd = 0.015 * 0.015;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const u of grid.get(`${cx + a},${cy + b},${cz + c}`) || []) { const d = (P[u * 3] - x) ** 2 + (P[u * 3 + 1] - y) ** 2 + (P[u * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = u; } }
    if (best >= 0) for (const cv of covs) cv[v] = cv[best]; } }
// a cull list (triangles) -> per-vertex cover (a vertex of any culled triangle), the extra vertices inherited, back to triangles: patches
// a bake made before inheritCover (k3_scratch/recull.mjs)
export function extendCull(idx, P, tris, nf) { const n = P.length / 3, cov = new Uint8Array(n); for (const t of tris) for (let k = 0; k < 3; k++) cov[idx[t * 3 + k]] = 1; for (let v = nf; v < n; v++) cov[v] = 0;
  inheritCover(P, nf, n, [cov]); const out = []; for (let t = 0; t < idx.length; t += 3) if (cov[idx[t]] && cov[idx[t + 1]] && cov[idx[t + 2]]) out.push(t / 3); return Uint32Array.from(out); }
// apply a cull list to a hero's body (degenerate triangles; restore with the returned undo). aCover for H3 is set too (1 = covered)
export function applyCull(h, tris, { attr = true } = {}) {
  // the body's index is SHARED by every hero built on the same base mesh (lane A's people): the cull works on this hero's own copy
  // (six people in one frame first showed the union of all six culls on every body)
  const g = h.body.geometry; if (!g.userData.k3OwnIndex) { g.setIndex(new g.index.constructor(Uint32Array.from(g.index.array), 1)); g.userData.k3OwnIndex = true; }
  const idx = g.index.array, keep = Uint32Array.from(idx);
  for (const t of tris) { idx[t * 3 + 1] = idx[t * 3]; idx[t * 3 + 2] = idx[t * 3]; } g.index.needsUpdate = true;
  if (attr && g.attributes.position) { const n = g.attributes.position.count, a = new Float32Array(n); for (const t of tris) for (let k = 0; k < 3; k++) a[keep[t * 3 + k]] = 1; g.setAttribute('aCover', new g.attributes.position.constructor(a, 1)); }
  return () => { idx.set(keep); g.index.needsUpdate = true; };
}

// ---------------------------------------------------------------- the bake (node -> the lab)
// header JSON (parts: name, group, owner, construction, fabric, color, n, nt, flags; offsets), then per part: X Int16 (0.1 mm, metres),
// SI Uint8, SW Uint8 (x255), uv Float32, T Uint16|Uint32; then the body's bind positions (Float32, hero units) and the two cull lists
export function packBake(header, parts, { body, cullBase, cullFull }) {
  const chunks = [], H = { ...header, k3: FINISH_VERSION, parts: [] }; let off = 0; const add = a => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), pad = (4 - (u.length % 4)) % 4; chunks.push(u); if (pad) chunks.push(new Uint8Array(pad)); const o = off; off += u.length + pad; return o; };
  for (const p of parts) { const n = p.X.length / 3, nt = p.T.length / 3, big = n > 65535;
    const e = { name: p.name, group: p.group, owner: p.owner || p.part, construction: p.construction, fabric: p.fabric, color: p.color, n, nt, flatUv: !!p.flatUv, solid: !!p.solid }; if (p.sewn) e.sewn = p.sewn;   // CLOTH3 (opt-in: absent unless set)
    e.X = add(Int16Array.from(p.X, x => Math.round(x * 10000))); e.SI = add(Uint8Array.from(p.SI)); e.SW = add(Uint8Array.from(p.SW, w => Math.round(w * 255))); e.uv = add(Float32Array.from(p.uv || new Float64Array(n * 2))); e.T = add(big ? Uint32Array.from(p.T) : Uint16Array.from(p.T)); e.big = big;
    if (p.panel) e.panel = add(Uint8Array.from(p.panel)); if (p.Tfull) { e.ntFull = p.Tfull.length / 3; e.Tfull = add(big ? Uint32Array.from(p.Tfull) : Uint16Array.from(p.Tfull)); } H.parts.push(e); }
  H.body = { n: body.length / 3, off: add(Float32Array.from(body)) }; H.cullBase = { n: cullBase.length, off: add(Uint32Array.from(cullBase)) }; H.cullFull = { n: cullFull.length, off: add(Uint32Array.from(cullFull)) };
  const hj = new TextEncoder().encode(JSON.stringify(H)), pad = (4 - ((4 + hj.length) % 4)) % 4, out = new Uint8Array(4 + hj.length + pad + off); new DataView(out.buffer).setUint32(0, hj.length + pad, true); out.set(hj, 4); out.fill(32, 4 + hj.length, 4 + hj.length + pad);
  let o = 4 + hj.length + pad; for (const c of chunks) { out.set(c, o); o += c.length; } return out;
}
export function unpackBake(buf) {
  const u8 = new Uint8Array(buf), hl = new DataView(u8.buffer, u8.byteOffset).getUint32(0, true), H = JSON.parse(new TextDecoder().decode(u8.subarray(4, 4 + hl)).trim()), base = 4 + hl;
  const view = (C, o, n) => new C(u8.slice(base + o, base + o + n * C.BYTES_PER_ELEMENT).buffer);
  const parts = H.parts.map(e => ({ ...e, X: Float64Array.from(view(Int16Array, e.X, e.n * 3), x => x / 10000), SI: view(Uint8Array, e.SI, e.n * 4), SW: Float32Array.from(view(Uint8Array, e.SW, e.n * 4), w => w / 255), uv: view(Float32Array, e.uv, e.n * 2), T: e.big ? view(Uint32Array, e.T, e.nt * 3) : Uint32Array.from(view(Uint16Array, e.T, e.nt * 3)), panel: e.panel != null ? view(Uint8Array, e.panel, e.n) : null, Tfull: e.Tfull != null ? (e.big ? view(Uint32Array, e.Tfull, e.ntFull * 3) : Uint32Array.from(view(Uint16Array, e.Tfull, e.ntFull * 3))) : null }));
  return { header: H, parts, body: view(Float32Array, H.body.off, H.body.n * 3), cullBase: view(Uint32Array, H.cullBase.off, H.cullBase.n), cullFull: view(Uint32Array, H.cullFull.off, H.cullFull.n) };
}
// debug: every part and the body, POSED, as JSON for labs/clothing2/k3_scratch/raster.py
export function dumpPosed(h, parts, file, { hideTris = null } = {}) {
  const fs = globalThis.process ? null : null; void fs; const scale = heroScale(h); h.group.updateMatrixWorld(true); const M = boneMats(h.skeleton, h.body.matrixWorld), g = h.body.geometry;
  const pose = (X, SI, SW) => skinPose(Float64Array.from(X, x => x / scale), SI, SW, M, new Float64Array(X.length), scale);
  const r4 = a => Array.from(a, x => Math.round(x * 1e4) / 1e4), hide = new Set(hideTris || []), BT = []; for (let t = 0; t < g.index.count / 3; t++) if (!hide.has(t)) BT.push(g.index.array[t * 3], g.index.array[t * 3 + 1], g.index.array[t * 3 + 2]);
  const meshes = [{ P: r4(skinPose(Float64Array.from(g.attributes.position.array), g.attributes.skinIndex.array, g.attributes.skinWeight.array, M, new Float64Array(g.attributes.position.count * 3), scale)), T: BT, col: [190, 160, 140] }];
  const hex = c => { const v = parseInt(String(c || '#cccccc').slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(x => Math.min(255, x * 1.2 + 20)); };
  for (const p of parts) meshes.push({ P: r4(pose(p.X, p.SI, p.SW)), T: Array.from(p.T), col: hex(p.color) });
  return import('node:fs').then(m => m.writeFileSync(file, JSON.stringify({ meshes })));
}
// CLOTH3: per vertex of a sewn garment's pre-weld panels (garmentParts: flat uv in metres, panel ids, positions shared along seams), the
// distance in the flat pattern to the nearest SEWN edge of its own panel (a boundary vertex that sits where another panel's vertex sits:
// a seam; hems and openings are free edges and do not count). Drives the seam wear and topstitching of fabricMaterial({ seamD: true }).
// CLOTH3: per vertex, the flat-pattern distance to the nearest FREE edge of its panel (a boundary vertex that is not on a seam: a hem, a
// cuff's or the neckline's opening, a tucked tail's end): where the garment's inside can be seen (fabricMaterial openD)
export function openDistance(X, uv, panel, T, { tol = 2e-4, cap = 0.25 } = {}) {
  const n = X.length / 3, E = new Map(); for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) { const a = T[t + k], b = T[t + (k + 1) % 3], key = a < b ? a * n + b : b * n + a; E.set(key, (E.get(key) || 0) + 1); }
  const bnd = new Uint8Array(n); for (const [key, c] of E) if (c === 1) { bnd[Math.floor(key / n)] = 1; bnd[key % n] = 1; }
  const seam = seamFlags(X, panel, tol), free = Uint8Array.from(bnd, (b, i) => (b && !seam[i] ? 1 : 0));
  return distToFlagged(uv, panel, free, cap);
}
function seamFlags(X, panel, tol) { const n = X.length / 3, key = i => `${Math.round(X[i * 3] / tol)},${Math.round(X[i * 3 + 1] / tol)},${Math.round(X[i * 3 + 2] / tol)}`, grp = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); const L = grp.get(k); if (L) L.push(i); else grp.set(k, [i]); }
  const seam = new Uint8Array(n); for (const L of grp.values()) if (L.length > 1 && L.some(i => panel[i] !== panel[L[0]])) for (const i of L) seam[i] = 1; return seam; }
function distToFlagged(uv, panel, flag, cap) { const n = flag.length, out = new Float32Array(n).fill(cap), byP = new Map(); for (let i = 0; i < n; i++) if (flag[i]) { const L = byP.get(panel[i]); if (L) L.push(i); else byP.set(panel[i], [i]); }
  const cell = Math.max(0.02, cap / 4), grids = new Map(); for (const [pn, L] of byP) { const g = new Map(); for (const i of L) { const k = `${Math.floor(uv[i * 2] / cell)},${Math.floor(uv[i * 2 + 1] / cell)}`; const q = g.get(k); if (q) q.push(i); else g.set(k, [i]); } grids.set(pn, g); }
  const R = Math.ceil(cap / cell); for (let i = 0; i < n; i++) { const g = grids.get(panel[i]); if (!g) continue; const cx = Math.floor(uv[i * 2] / cell), cy = Math.floor(uv[i * 2 + 1] / cell); let b = cap * cap;
    for (let a = -R; a <= R; a++) for (let c = -R; c <= R; c++) { const q = g.get(`${cx + a},${cy + c}`); if (!q) continue; for (const j of q) { const d = (uv[i * 2] - uv[j * 2]) ** 2 + (uv[i * 2 + 1] - uv[j * 2 + 1]) ** 2; if (d < b) b = d; } }
    out[i] = Math.sqrt(b); }
  return out; }
export function seamDistance(X, uv, panel, { tol = 2e-4, cap = 0.05 } = {}) {
  const n = X.length / 3, key = i => `${Math.round(X[i * 3] / tol)},${Math.round(X[i * 3 + 1] / tol)},${Math.round(X[i * 3 + 2] / tol)}`, grp = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); const L = grp.get(k); if (L) L.push(i); else grp.set(k, [i]); }
  const seam = new Uint8Array(n); for (const L of grp.values()) if (L.length > 1 && L.some(i => panel[i] !== panel[L[0]])) for (const i of L) seam[i] = 1;
  const out = new Float32Array(n).fill(cap), byP = new Map(); for (let i = 0; i < n; i++) if (seam[i]) { const L = byP.get(panel[i]); if (L) L.push(i); else byP.set(panel[i], [i]); }
  const cell = cap, grids = new Map(); for (const [pn, L] of byP) { const g = new Map(); for (const i of L) { const k = `${Math.floor(uv[i * 2] / cell)},${Math.floor(uv[i * 2 + 1] / cell)}`; const q = g.get(k); if (q) q.push(i); else g.set(k, [i]); } grids.set(pn, g); }
  for (let i = 0; i < n; i++) { const g = grids.get(panel[i]); if (!g) continue; const cx = Math.floor(uv[i * 2] / cell), cy = Math.floor(uv[i * 2 + 1] / cell); let b = cap * cap;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) { const q = g.get(`${cx + a},${cy + c}`); if (!q) continue; for (const j of q) { const d = (uv[i * 2] - uv[j * 2]) ** 2 + (uv[i * 2 + 1] - uv[j * 2 + 1]) ** 2; if (d < b) b = d; } }
    out[i] = Math.sqrt(b); }
  return out;
}
