// PATTERN / BUILD (CLOTHING c2, lane K2): a sewmap + a person's measures -> a garment ready to sew: panels drafted by FreeSewing
// (freesewing.js), their outlines resampled so that both sides of every seam carry the same number of vertices (the ease or gather
// spread evenly between the seam's named points: notches meet notches), each panel triangulated (mesh2d.js), and the stitches listed.
// Placement on a body is place.js; the sewing phase and the drape are K1's (sew.js / stack.js; labs/clothing2/k2_sew.mjs is K2's
// stand-in until then).
//
//   const g = await buildGarment(SHIRT, measuresMm, { design: 'simone', options, h: 0.015 })
//   g = { design, version, measures, options, h, panels: [{ name, outline, tags, grain, V (2 x n local), T, nb, base (first global
//         vertex), boundary: { tags: { tag: global vertex } }, quality }],
//         n, V2 (Float64Array n x 2, panel-local), rest (Float64Array n x 3: panels laid side by side, z = 0: the XPBD rest metric),
//         warp (Float64Array n x 3, in the rest frame: the grain), panelOf (Uint8Array n), T (Int32Array, global, counter-clockwise from outside),
//         seams: [{ name, kind, La, Lb, ratio, n (stitches) }], stitches (Int32Array 2 x s: a, b), stitchSeam (Uint16Array s),
//         free (Uint8Array n: 1 on an unsewn edge, 2 on a hem), edges, quality, ms: { draft, sample, mesh } }
import { loadDesign, draft, panelFrom, mirrorPanel, K2_VERSION } from './freesewing.js';
import { triangulate, quality as meshQuality } from './mesh2d.js';
const now = () => (globalThis.performance?.now ? performance.now() : Date.now());
const dist = (O, i, j) => Math.hypot(O[j * 2] - O[i * 2], O[j * 2 + 1] - O[i * 2 + 1]);

// a run: [panel, fromTag, toTag, dir?] -> { panel, idx (outline indices in walking order), dir, L }
function resolveRun(P, r) {
  const [pn, a, b, dir0] = r, p = P[pn]; if (!p) throw new Error('no panel ' + pn);
  const O = p.outline, n = O.length / 2, ia = p.tags[a], ib = p.tags[b]; if (ia == null || ib == null) throw new Error(`${pn}: no tag ${ia == null ? a : b}`);
  const walk = d => { const idx = [ia]; let L = 0; for (let i = ia; i !== ib; ) { const j = (i + d + n) % n; L += dist(O, i, j); idx.push(j); i = j; } return { idx, L }; };
  if (ia === ib) return { panel: pn, idx: [ia], dir: 1, L: 0 };
  let dir = dir0; if (!dir) { const f = walk(1), g = walk(-1); dir = f.L <= g.L ? 1 : -1; }
  const w = walk(dir); return { panel: pn, idx: w.idx, dir, L: w.L };
}
// a point at arc length s along a run (outline polyline)
function along(O, run, s) {
  const I = run.idx; for (let k = 0; k + 1 < I.length; k++) { const l = dist(O, I[k], I[k + 1]); if (s <= l || k + 2 === I.length) { const t = l > 0 ? Math.max(0, Math.min(1, s / l)) : 0; return [O[I[k] * 2] + (O[I[k + 1] * 2] - O[I[k] * 2]) * t, O[I[k] * 2 + 1] + (O[I[k + 1] * 2 + 1] - O[I[k] * 2 + 1]) * t]; } s -= l; }
  return [O[I[I.length - 1] * 2], O[I[I.length - 1] * 2 + 1]];
}

// insert a vertex at arc length a.length from tag a.from toward tag a.toward (the shorter way), tagged a.name
function insertAt(p, a) {
  const O = p.outline, n = O.length / 2, ia = p.tags[a.from], ib = p.tags[a.toward];
  const walk = d => { let L = 0; for (let i = ia; i !== ib; i = (i + d + n) % n) L += dist(O, i, (i + d + n) % n); return L; }, dir = walk(1) <= walk(-1) ? 1 : -1;
  let L = 0; for (let i = ia; i !== ib; i = (i + dir + n) % n) { const j = (i + dir + n) % n, l = dist(O, i, j); if (L + l >= a.length) { const t = (a.length - L) / l, x = O[i * 2] + (O[j * 2] - O[i * 2]) * t, y = O[i * 2 + 1] + (O[j * 2 + 1] - O[i * 2 + 1]) * t;
      const at = dir > 0 ? j : i, out = new Float64Array(O.length + 2); out.set(O.subarray(0, at * 2)); out[at * 2] = x; out[at * 2 + 1] = y; out.set(O.subarray(at * 2), at * 2 + 2);
      for (const k of Object.keys(p.tags)) if (p.tags[k] >= at) p.tags[k]++; p.tags[a.name] = at; p.outline = out; return; } L += l; }
}
// K1's contract (review/studio_clothing_c2/after/stack/NOTES.md s0): per-panel arrays and pairwise seams, from a K2 garment and its
// placed positions X (n x 3). A side of one of our seams that runs over several panels becomes one K1 seam per panel pair; a vertex
// stitched to two (the ends at a dart's mouth or a panel corner) is repeated so both lists keep equal counts.
export function toSewPattern(g, X, { person = null, fabric = 'body' } = {}) {
  const panels = g.panels.map(p => { const uv = new Float64Array(p.n * 2), Xp = new Float64Array(p.n * 3); for (let i = 0; i < p.n; i++) { uv[i * 2] = g.V2[(p.base + i) * 2]; uv[i * 2 + 1] = g.V2[(p.base + i) * 2 + 1]; for (let c = 0; c < 3; c++) Xp[i * 3 + c] = X ? X[(p.base + i) * 3 + c] : 0; }
    return { name: p.name, fabric, uv, tris: Int32Array.from(p.T), X: Xp, grain: p.grain, boundary: Int32Array.from({ length: p.nb }, (_, i) => i), restAngle: null }; });
  const local = v => { const p = g.panels[g.panelOf[v]]; return [p.name, v - p.base]; }, groups = new Map(), closures = [];
  for (let k = 0; k < g.stitchSeam.length; k++) { const s = g.seams[g.stitchSeam[k]], [pa, va] = local(g.stitches[k * 2]), [pb, vb] = local(g.stitches[k * 2 + 1]), key = `${s.name}|${pa}|${pb}`;
    if (!groups.has(key)) groups.set(key, { s, a: { panel: pa, verts: [] }, b: { panel: pb, verts: [] } }); const G = groups.get(key); G.a.verts.push(va); G.b.verts.push(vb); }
  const seams = [];
  for (const { s, a, b } of groups.values()) { const A = { panel: a.panel, verts: Int32Array.from(a.verts) }, B = { panel: b.panel, verts: Int32Array.from(b.verts) };
    if (s.kind === 'closure' || s.kind === 'point') closures.push({ kind: s.kind === 'point' ? 'button' : (s.name.startsWith('fly') ? 'zip' : 'button'), name: s.name, a: A, b: B, state: 'closed' });
    else seams.push({ name: s.name, kind: s.kind === 'dart' ? 'dart' : s.name === 'cf' ? 'cf' : 'seam', a: A, b: B }); }
  const holds = (g.holds || []).map(h => { const byP = new Map(); for (const v of h.ids) { const [pn, lv] = local(v); if (!byP.has(pn)) byP.set(pn, []); byP.get(pn).push(lv); } return [...byP].map(([panel, vs]) => ({ kind: h.kind, panel, verts: Int32Array.from(vs), girth: h.girth })); }).flat();
  return { design: g.design, version: g.version, person, panels, seams, closures, holds, crowd: g.crowd || null, measures: g.measures, options: g.options };
}
export async function buildGarment(map, measures, o = {}) {
  const T0 = now(), h = o.h ?? 0.02, D = await loadDesign(o.design || map.design[0]);
  const V = o.variant && map.variants ? map.variants[o.variant] : null;
  // a draft FreeSewing cannot finish (a degenerate intersection: Simone's FBA at some sizes) is retried with the sewmap's nudges
  let options = { ...(map.options || {}), ...(V?.options || {}), ...(o.options || {}) }, d = draft(D, measures, options), retry = null;
  for (const r of map.retry || []) { if (!d.log.error.length) break; const o2 = { ...options, ...r }; const d2 = draft(D, measures, o2); if (!d2.log.error.length) { d = d2; options = o2; retry = r; } }
  const tDraft = now() - T0;
  if (d.log.error.length) throw new Error(`FreeSewing ${o.design || map.design[0]}: ${d.log.error.join('; ')}`);
  const T1 = now(), P = {};
  for (const sp of map.panels) {
    if (sp.of) { if (P[sp.of]) P[sp.name] = { ...(sp.mirror ? mirrorPanel(P[sp.of], sp.name) : { ...P[sp.of], name: sp.name }), spec: sp }; continue; }
    const part = d.parts[sp.part]; if (!part) { if (sp.optional) continue; throw new Error('no FreeSewing part ' + sp.part); }
    P[sp.name] = { ...panelFrom(part, sp), spec: sp };
  }
  // points made along a seam line ('at': the fly's end 18 cm down the crotch seam), inserted as outline vertices with a tag
  for (const a of map.at || []) { const p = P[a.panel]; if (!p || p.tags[a.from] == null || p.tags[a.toward] == null) continue; insertAt(p, a); }
  const seams = map.seams(P, V || undefined).filter(s => [...s.a, ...s.b].every(r => P[r[0]]));
  // runs and the fixed vertices per panel
  const fixed = Object.fromEntries(Object.keys(P).map(k => [k, new Set()]));
  const SR = seams.map(s => ({ ...s, A: s.a.map(r => resolveRun(P, r)), B: s.b.map(r => resolveRun(P, r)) }));
  for (const s of SR) for (const r of [...s.A, ...s.B]) { fixed[r.panel].add(r.idx[0]); fixed[r.panel].add(r.idx[r.idx.length - 1]); }
  // per seam: N segments; every run boundary on either side lands on an integer k; samples placed evenly between them
  const pieces = Object.fromEntries(Object.keys(P).map(k => [k, new Map()]));   // panel -> Map(startFixed -> { end, pts, refs })
  const seamInfo = [];
  SR.forEach((s, si) => {
    const La = s.A.reduce((x, r) => x + r.L, 0), Lb = s.B.reduce((x, r) => x + r.L, 0), Lm = Math.max(La, Lb), point = Lm === 0;
    const nbk = Math.max(s.A.length, s.B.length); let N = point ? 0 : Math.max(nbk, Math.round(Lm / h));
    const brk = side => { const L = side.reduce((x, r) => x + r.L, 0), out = [[0, 0]]; let c = 0; for (let i = 0; i < side.length - 1; i++) { c += side[i].L; out.push([null, L > 0 ? c / L : 0]); } out.push([N, 1]); return out; };
    const ba = brk(s.A), bb = brk(s.B);
    for (const B of [ba, bb]) { for (let i = 1; i < B.length - 1; i++) { let k = Math.round(B[i][1] * N); k = Math.max(B[i - 1][0] + 1, Math.min(N - (B.length - 1 - i), k)); B[i][0] = k; } }
    const place = (side, B, sideKey) => {
      let c0 = 0; side.forEach((r, ri) => { const O = P[r.panel].outline, k0 = B[ri][0], k1 = B[ri + 1][0], pts = [], refs = [];
        for (let k = k0; k <= k1; k++) { const t = k1 > k0 ? (k - k0) / (k1 - k0) : 0; pts.push(k === k0 ? [O[r.idx[0] * 2], O[r.idx[0] * 2 + 1]] : k === k1 ? [O[r.idx[r.idx.length - 1] * 2], O[r.idx[r.idx.length - 1] * 2 + 1]] : along(O, r, t * r.L)); refs.push([si, sideKey, k]); }
        // interior fixed vertices are not allowed inside a run (two seams overlapping on one edge)
        for (let q = 1; q < r.idx.length - 1; q++) if (fixed[r.panel].has(r.idx[q])) throw new Error(`seam ${s.name}: run on ${r.panel} passes a fixed vertex (another seam's end) at outline ${r.idx[q]}`);
        let a = r.idx[0], b = r.idx[r.idx.length - 1], P2 = pts, R2 = refs; if (r.dir < 0) { [a, b] = [b, a]; P2 = pts.slice().reverse(); R2 = refs.slice().reverse(); }
        if (a === b) { pieces[r.panel].set('pt' + si + sideKey, { start: a, end: a, pts: P2, refs: R2, point: true }); return; }
        if (pieces[r.panel].has(a)) throw new Error(`seam ${s.name}: ${r.panel} edge from outline ${a} sewn twice`);
        pieces[r.panel].set(a, { end: b, pts: P2, refs: R2 }); c0 += r.L; });
    };
    place(s.A, ba, 0); place(s.B, bb, 1);
    seamInfo.push({ name: s.name, kind: s.kind, La, Lb, ratio: Lb > 0 ? La / Lb : 1, N });
  });
  // assemble each panel's boundary (counter-clockwise), free pieces sampled by h
  // ref: 'seam:side:k' -> the boundary vertices there (two where a side jumps between runs: a dart's mouth, one panel to the next)
  const ref = new Map(), addRef = (k, v) => { const L = ref.get(k); if (L) L.push(v); else ref.set(k, [v]); }, panels = [], tSample = now() - T1, T2 = now();
  let base = 0, layoutX = 0; const Vs = [], Ts = [], warp = [], pOf = [], free = [], rest = [];
  for (const [pn, p] of Object.entries(P)) {
    const O = p.outline, n = O.length / 2, F = [...fixed[pn]].sort((x, y) => x - y); if (!F.length) F.push(0);
    const bnd = [], isFree = [], pointRefs = [];
    for (const pc of pieces[pn].values()) if (pc.point) pointRefs.push(pc);
    for (let fi = 0; fi < F.length; fi++) {
      const a = F[fi], pc = pieces[pn].get(a);
      if (pc) { const b0 = bnd.length; pc.pts.forEach((q, j) => { if (j === pc.pts.length - 1) return; bnd.push(q); isFree.push(0); }); pc.refs.forEach((rf, j) => addRef(rf.join(':'), { pn, j: j === pc.refs.length - 1 ? 'next' : b0 + j, after: pc.end })); continue; }
      // free: from a to the next fixed vertex, forward
      const b = F[(fi + 1) % F.length], idx = [a]; for (let i = a; i !== b || idx.length === 1; ) { i = (i + 1) % n; idx.push(i); if (i === b) break; }
      let L = 0; for (let k = 0; k + 1 < idx.length; k++) L += dist(O, idx[k], idx[k + 1]); const m = Math.max(1, Math.round(L / h));
      for (let k = 0; k < m; k++) { bnd.push(along(O, { idx }, L * k / m)); isFree.push(k === 0 ? 0 : 1); }
    }
    // a piece's last point is the next fixed vertex: resolve 'next' refs; point refs sit on a fixed vertex
    const fixedAt = new Map(); { let pos = 0; for (let fi = 0; fi < F.length; fi++) { fixedAt.set(F[fi], pos); const pc = pieces[pn].get(F[fi]);
      if (pc) pos += pc.pts.length - 1; else { const b = F[(fi + 1) % F.length], idx = [F[fi]]; for (let i = F[fi]; ; ) { i = (i + 1) % n; idx.push(i); if (i === b) break; } let L = 0; for (let k = 0; k + 1 < idx.length; k++) L += dist(O, idx[k], idx[k + 1]); pos += Math.max(1, Math.round(L / h)); } } }
    for (const [, L] of ref) for (const v of L) if (v.pn === pn && v.j === 'next') v.j = fixedAt.get(v.after);
    for (const pc of pointRefs) pc.refs.forEach(rf => addRef(rf.join(':'), { pn, j: fixedAt.get(pc.start) }));
    // the free flag: a boundary vertex both of whose boundary edges are unsewn
    const nb = bnd.length, B = new Float64Array(nb * 2); bnd.forEach((q, i) => { B[i * 2] = q[0]; B[i * 2 + 1] = q[1]; });
    const sewnEdge = new Uint8Array(nb); for (let fi = 0; fi < F.length; fi++) { const pc = pieces[pn].get(F[fi]); if (!pc) continue; const s0 = fixedAt.get(F[fi]); for (let j = 0; j < pc.pts.length - 1; j++) sewnEdge[(s0 + j) % nb] = 1; }
    const mesh = triangulate(B, h, { grain: p.grain });
    const tags = {}; for (const [k, v] of Object.entries(p.tags)) { const pos = fixedAt.get(v); if (pos != null) tags[k] = base + pos; }
    let u0 = Infinity, u1 = -Infinity; for (let i = 0; i < mesh.n; i++) { u0 = Math.min(u0, mesh.V[i * 2]); u1 = Math.max(u1, mesh.V[i * 2]); }
    for (let i = 0; i < mesh.n; i++) { Vs.push(mesh.V[i * 2], mesh.V[i * 2 + 1]); rest.push(mesh.V[i * 2] - u0 + layoutX, mesh.V[i * 2 + 1], 0); warp.push(p.grain[0], p.grain[1], 0); pOf.push(panels.length);
      free.push(i < nb ? (!sewnEdge[i] && !sewnEdge[(i - 1 + nb) % nb] ? 1 : 0) : 0); }
    for (let t = 0; t < mesh.T.length; t++) Ts.push(mesh.T[t] + base);
    panels.push({ name: pn, part: p.part, outline: p.outline, tags: p.tags, grain: p.grain, fold: p.fold, mirrored: !!p.mirrored, area: p.area, perimeter: p.perimeter, spec: p.spec,
      V: mesh.V, T: mesh.T, nb, n: mesh.n, base, boundary: { tags }, quality: mesh.quality, lost: mesh.lost, layoutX: layoutX - u0 });
    base += mesh.n; layoutX += (u1 - u0) + 0.08;
  }
  for (const [, L] of ref) for (const v of L) { const p = panels.find(q => q.name === v.pn); v.g = p.base + v.j; }
  // stitches: the vertices at k on side a with those at k on side b (a vertex shared by both sides, a dart's tip, is no stitch)
  const st = [], sts = [], stk = []; seamInfo.forEach((s, si) => { for (let k = 0; k <= s.N; k++) { const A = ref.get(`${si}:0:${k}`), B = ref.get(`${si}:1:${k}`); if (!A || !B) throw new Error(`seam ${s.name}: no sample ${k}`);
    const seen = new Set(); for (const a of A) for (const b of B) { if (a.g === b.g || seen.has(a.g + ',' + b.g)) continue; seen.add(a.g + ',' + b.g); st.push(a.g, b.g); sts.push(si); stk.push(k); } } s.n = sts.filter(x => x === si).length; });
  // hem flags from the sewmap's edges
  const freeA = Uint8Array.from(free);
  for (const e of map.edges || []) { const p = panels.find(q => q.name === e.panel); if (!p || e.treatment !== 'hem') continue; const a = p.boundary.tags[e.from], b = p.boundary.tags[e.to]; if (a == null || b == null) continue;
    for (let i = a; ; i = p.base + ((i - p.base + 1) % p.nb)) { if (freeA[i] || i === a || i === b) freeA[i] = 2; if (i === b) break; } }
  // holds (a waistband line, the shoulders): the boundary vertices of each run, global ids
  const holds = (map.holds || []).map(hd => { const ids = []; for (const [pn, a, b] of hd.runs) { const p = panels.find(q => q.name === pn); if (!p) continue; const ia = p.boundary.tags[a] - p.base, ib = p.boundary.tags[b] - p.base; if (!(ia >= 0) || !(ib >= 0)) continue;
      const f = (ib - ia + p.nb) % p.nb, bk = (ia - ib + p.nb) % p.nb, dir = f <= bk ? 1 : -1; for (let i = ia; ; i = (i + dir + p.nb) % p.nb) { ids.push(p.base + i); if (i === ib) break; } }
    return { kind: hd.kind, ids: Int32Array.from(new Set(ids)), girth: hd.girth ?? null }; });
  const V2 = Float64Array.from(Vs), Tg = Int32Array.from(Ts);
  return { design: o.design || map.design[0], version: K2_VERSION, measures, options, h, panels, n: base, V2, rest: Float64Array.from(rest), warp: Float64Array.from(warp), panelOf: Uint8Array.from(pOf), T: Tg,
    holds, variant: o.variant || null, retry, seams: seamInfo, stitches: Int32Array.from(st), stitchSeam: Uint16Array.from(sts), stitchK: Uint16Array.from(stk), free: freeA, edges: map.edges || [], crowd: map.crowd || null,
    quality: meshQuality(V2, Tg), ms: { draft: +tDraft.toFixed(1), sample: +tSample.toFixed(1), mesh: +(now() - T2).toFixed(1) } };
}
// the seam-length check: per seam, the sum of the a-side and b-side sampled edge lengths (2D) and their ratio (ease / gather)
export function seamCheck(g) {
  const out = []; const st = g.stitches, ss = g.stitchSeam, V = g.V2;
  g.seams.forEach((s, si) => { const pr = []; for (let k = 0; k < ss.length; k++) if (ss[k] === si) pr.push([st[k * 2], st[k * 2 + 1], g.stitchK[k]]);
    // consecutive samples of one side are summed only when they are neighbours on one panel's boundary (a side made of several runs
    // jumps across a dart's mouth or from one panel to the next)
    const adj = (i, j) => { if (g.panelOf[i] !== g.panelOf[j]) return false; const p = g.panels[g.panelOf[i]], a = i - p.base, b = j - p.base; return a < p.nb && b < p.nb && (Math.abs(a - b) === 1 || Math.abs(a - b) === p.nb - 1); };
    const seg = (i, j) => adj(i, j) ? Math.hypot(V[j * 2] - V[i * 2], V[j * 2 + 1] - V[i * 2 + 1]) : 0;
    const side = c => { const S = new Map(); for (const q of pr) S.set(q[c], q[2]); let L = 0; const vs = [...S.keys()]; for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) if (Math.abs(S.get(vs[i]) - S.get(vs[j])) === 1) L += seg(vs[i], vs[j]); return L; };
    const la = side(0), lb = side(1);
    out.push({ name: s.name, kind: s.kind, draftA: +(s.La * 1000).toFixed(1), draftB: +(s.Lb * 1000).toFixed(1), meshA: +(la * 1000).toFixed(1), meshB: +(lb * 1000).toFixed(1), ratio: +s.ratio.toFixed(4), stitches: pr.length }); });
  return out;
}
