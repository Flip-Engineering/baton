// SEW (CLOTHING c2, K1): 2D panels sewn into one garment cloth. Takes K2's pattern (the contract in
// review/studio_clothing_c2/after/stack/NOTES.md s0): flat panels (uv, triangulated, a grain), placed round the body (X), and seams as
// pairwise vertex lists. Pure JS on typed arrays; no three.js.
//
//   prepare(pattern, fabrics)   the panels concatenated into one particle system: a per-triangle flat METRIC (each triangle's corners
//                               in its panel, metres) and GRAIN (the panel's warp), a fabric per triangle (the panel's role mapped to a
//                               fabrics.js name), the seam pairs as global particle ids, and a union-find of what gets welded.
//   sewPhase(S, X0, opts)        the "box mesh" sewing of GarmentCodeData (Korosteleva and Sorkine-Hornung 2023) done in XPBD: gravity
//                               OFF, the panels kept at their flat metric, zero-length stitches between seam pairs whose compliance is
//                               ramped down in steps (soft first, so panels slide round the body instead of snapping through it), the
//                               body (and the layers under the garment) as colliders. Returns the sewn positions and the worst seam gap.
//   weldSewn(S, X)              each stitched pair (and chain) merged to one particle at its mean: a garment with no seam cracks, whose
//                               bending runs across the seams; seam particles get restAngle 1 (a seam keeps the dihedral it was sewn to:
//                               the seam allowance pressed together), the rest 0 (flat panels). The metric stays per triangle, so the
//                               garment keeps each panel's flat lengths (darts close because they are sewn, not because the start shape
//                               was curved).
// The stack (stack.js) then settles the welded cloth with gravity like any other garment. Closures that are closed are seams too;
// open ones are left out by the caller. Holds (waistband, shoulders, straps) are the stack's business: sew.js maps their vertex ids.
import { Cloth } from './xpbd.js';
import { Contacts } from './collide.js';
import { phys } from './fabrics.js';
export const SEW_VERSION = 1;

// pattern -> { n, X (bind n*3), tris, metric (m*6), grain (m*2), triFab (m), fabs: [phys], fabNames, pairs (Int32Array 2k), panelOf (n),
//              off: { panel: offset }, find (union-find root per particle), holds: [{ kind, ids, girth }], closures }
export function prepare(pattern, fabrics = { body: 'chambray' }) {
  const P = pattern.panels, off = {}, names = []; let n = 0, m = 0;
  for (const p of P) { off[p.name] = n; n += p.uv.length / 2; m += p.tris.length / 3; }
  const X = new Float64Array(n * 3), tris = new Int32Array(m * 3), metric = new Float64Array(m * 6), grain = new Float64Array(m * 2), triFab = new Uint8Array(m), panelOf = new Int32Array(n), fabIdx = new Map(), fabs = [];
  const roleFab = role => { const name = (typeof fabrics === 'string' ? fabrics : fabrics[role] || fabrics.body) || 'chambray'; if (!fabIdx.has(name)) { fabIdx.set(name, fabs.length); fabs.push(phys(name)); names.push(name); } return fabIdx.get(name); };
  let t0 = 0;
  P.forEach((p, pi) => { const o = off[p.name], k = p.uv.length / 2; X.set(p.X, o * 3); for (let i = 0; i < k; i++) panelOf[o + i] = pi;
    const g = p.grain || [0, 1], gl = Math.hypot(g[0], g[1]) || 1, f = roleFab(p.fabric || 'body');
    for (let t = 0; t < p.tris.length / 3; t++) { const tt = t0 + t; for (let c = 0; c < 3; c++) { const v = p.tris[t * 3 + c]; tris[tt * 3 + c] = v + o; metric[tt * 6 + c * 2] = p.uv[v * 2]; metric[tt * 6 + c * 2 + 1] = p.uv[v * 2 + 1]; }
      grain[tt * 2] = g[0] / gl; grain[tt * 2 + 1] = g[1] / gl; triFab[tt] = f; }
    t0 += p.tris.length / 3; });
  const pairs = [], gid = (side) => { const o = off[side.panel]; if (o == null) throw new Error(`sew: no panel ${side.panel}`); return Array.from(side.verts, v => v + o); };
  for (const s of pattern.seams || []) { const a = gid(s.a), b = gid(s.b); if (a.length !== b.length) throw new Error(`sew: seam ${s.a.panel}/${s.b.panel} counts ${a.length} != ${b.length}`); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) pairs.push(a[i], b[i]); }
  for (const c of pattern.closures || []) if (c.state === 'closed' || c.state == null) { const a = gid(c.a), b = gid(c.b); for (let i = 0; i < Math.min(a.length, b.length); i++) pairs.push(a[i], b[i]); }
  // union-find over the pairs (a corner where three panels meet is one particle)
  const par = Int32Array.from({ length: n }, (_, i) => i), find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let k = 0; k < pairs.length; k += 2) { const a = find(pairs[k]), b = find(pairs[k + 1]); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); }
  const root = new Int32Array(n); for (let i = 0; i < n; i++) root[i] = find(i);
  const holds = (pattern.holds || []).map(h => ({ kind: h.kind, girth: h.girth ?? null, ids: Int32Array.from(h.verts, v => v + off[h.panel]) }));
  return { n, X, tris, metric, grain, triFab, fabs, fabNames: names, pairs: Int32Array.from(pairs), panelOf, off, root, holds, design: pattern.design, zones: pattern.zones, crowd: pattern.crowd };
}

// the sewing phase. S from prepare, X0 the start positions in the solver's frame (posed), colliders: collide.js Contacts surfaces.
// opts: { T (s, total), hz, ramp: [compliances], gravity, thickness (self-collision half-thickness, m) }
export function sewPhase(S, X0, colliders = [], { T = 0.5, hz = 600, ramp = [1e-3, 1e-5, 1e-7, 1e-9], self = true, iters = 2, hold = null, selfEE = false, untangle = null, c6 = null } = {}) {   // CLOTH6 (opt-in): c6(cloth, S) attaches cloth6/self6.js while sewing   // CLOTH5 (opt-in): selfEE edge-edge self-collision while sewing; untangle(cloth) called after each ramp stage   // hold (CARRY, opt-in): soft pins [{ i, x, alpha }] kept while sewing   // iters (K3): stretch iterations (a 1.35 cm mesh needs 3-4)
  const t0 = (globalThis.performance ? performance.now() : Date.now());
  const cl = new Cloth(X0, S.tris, S.fabs[0], { X0, metric: S.metric, grain: S.grain, fabs: S.fabs, triFab: S.triFab, restAngle: 0, gravity: [0, 0, 0], damping: 12, vmax: 1.2, tether: false, stretchIters: iters,
    selfTri: self ? S.fabs.map(f => f.h / 2 + 0.0008)[0] : 0, selfTriEvery: 8, selfTriEE: !!selfEE });
  const ct = colliders.length ? new Contacts(S.n, colliders, { safe: true }) : null;
  if (c6) c6(cl, S);
  if (hold && hold.length) { if (hold[0].n) cl.attachPlane(hold); else cl.attach(hold); }
  const pairs = S.pairs; for (const al of ramp) { cl.stitch(pairs, { alpha: al }); cl.run(T / ramp.length, { hz, contacts: ct, every: 8 }); if (untangle) untangle(cl); }
  let gap = 0; for (let k = 0; k < pairs.length; k += 2) { const a = pairs[k], b = pairs[k + 1]; gap = Math.max(gap, Math.hypot(cl.X[a * 3] - cl.X[b * 3], cl.X[a * 3 + 1] - cl.X[b * 3 + 1], cl.X[a * 3 + 2] - cl.X[b * 3 + 2])); }
  return { X: cl.X, seamGapMm: gap * 1000, ms: Math.round((globalThis.performance ? performance.now() : Date.now()) - t0), stitches: pairs.length / 2, cloth: cl };
}

// merge the stitched particles. Returns { n, X (merged positions), tris (remapped, degenerate ones dropped), metric, grain, triFab (of the kept
// triangles), map (old -> new particle), restAngle (Float64Array n: 1 on seams), seam (Uint8Array n), holds (ids remapped) }
export function weldSewn(S, X) {
  const map = new Int32Array(S.n).fill(-1), cnt = []; let n = 0;
  for (let i = 0; i < S.n; i++) { const r = S.root[i]; if (map[r] < 0) { map[r] = n++; cnt.push(0); } map[i] = map[r]; }
  const Xn = new Float64Array(n * 3); for (let i = 0; i < S.n; i++) { const j = map[i]; Xn[j * 3] += X[i * 3]; Xn[j * 3 + 1] += X[i * 3 + 1]; Xn[j * 3 + 2] += X[i * 3 + 2]; cnt[j]++; }
  for (let j = 0; j < n; j++) { Xn[j * 3] /= cnt[j]; Xn[j * 3 + 1] /= cnt[j]; Xn[j * 3 + 2] /= cnt[j]; }
  const keep = []; for (let t = 0; t < S.tris.length / 3; t++) { const a = map[S.tris[t * 3]], b = map[S.tris[t * 3 + 1]], c = map[S.tris[t * 3 + 2]]; if (a !== b && b !== c && a !== c) keep.push(t); }
  const tris = new Int32Array(keep.length * 3), metric = new Float64Array(keep.length * 6), grain = new Float64Array(keep.length * 2), triFab = new Uint8Array(keep.length);
  keep.forEach((t, k) => { for (let c = 0; c < 3; c++) tris[k * 3 + c] = map[S.tris[t * 3 + c]]; metric.set(S.metric.subarray(t * 6, t * 6 + 6), k * 6); grain.set(S.grain.subarray(t * 2, t * 2 + 2), k * 2); triFab[k] = S.triFab[t]; });
  const seam = new Uint8Array(n); for (let j = 0; j < n; j++) if (cnt[j] > 1) seam[j] = 1;
  const restAngle = Float64Array.from(seam);
  return { n, X: Xn, tris, metric, grain, triFab, fabs: S.fabs, fabNames: S.fabNames, map, seam, restAngle, holds: S.holds.map(h => ({ ...h, ids: Int32Array.from(new Set(Array.from(h.ids, i => map[i]))) })) };
}

// ---------------------------------------------------------------- test patterns (until K2's land; also the unit tests)
// a rectangle panel w x h (m) triangulated at edge ~e, uv origin at its lower left; returns { uv, tris, left, right, top, bottom } (vertex ids
// along each side, bottom-to-top / left-to-right)
export function rectPanel(w, h, e = 0.02) {
  const nx = Math.max(1, Math.round(w / e)), ny = Math.max(1, Math.round(h / e)), uv = [], tris = [], id = (i, j) => j * (nx + 1) + i;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) uv.push(i * w / nx, j * h / ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1); if ((i + j) % 2) tris.push(a, b, d, a, d, c); else tris.push(a, b, c, b, d, c); }
  const col = i => Array.from({ length: ny + 1 }, (_, j) => id(i, j)), row = j => Array.from({ length: nx + 1 }, (_, i) => id(i, j));
  return { uv: Float64Array.from(uv), tris: Int32Array.from(tris), left: col(0), right: col(nx), bottom: row(0), top: row(ny), nx, ny };
}
// a tube of two panels (front, back) of girth 2w and height h round the y axis at radius r0 (placed as two half-cylinders, a gap
// between them at the sides), sewn at both side seams. A test of the contract: a skirt or a sleeve is this with shaped panels.
export function tubePattern({ w = 0.25, h = 0.4, r0 = 0.11, y0 = 0.6, e = 0.02, gapDeg = 18 } = {}) {
  const g = gapDeg * Math.PI / 180, span = Math.PI - g;
  const mk = (name, a0) => { const R = rectPanel(w, h, e), n = R.uv.length / 2, X = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) { const a = a0 + R.uv[i * 2] / w * span; X[i * 3] = Math.cos(a) * r0; X[i * 3 + 1] = y0 + R.uv[i * 2 + 1]; X[i * 3 + 2] = Math.sin(a) * r0; }
    const t = R.tris; for (let k = 0; k < t.length; k += 3) { const b = t[k + 1]; t[k + 1] = t[k + 2]; t[k + 2] = b; }   // right side out: uv's CCW maps to an inward normal here
    return { name, fabric: 'body', uv: R.uv, tris: t, X, grain: [0, 1], R }; };
  const F = mk('front', g / 2), B = mk('back', Math.PI + g / 2);   // front: z > 0; its u = 0 edge at x > 0 (the wearer's left)
  return { design: 'test.tube', version: 1, panels: [F, B].map(({ R, ...p }) => p),
    seams: [{ a: { panel: 'front', verts: Int32Array.from(F.R.right) }, b: { panel: 'back', verts: Int32Array.from(B.R.left) }, kind: 'seam' },
            { a: { panel: 'front', verts: Int32Array.from(F.R.left) }, b: { panel: 'back', verts: Int32Array.from(B.R.right) }, kind: 'seam' }],
    holds: [{ kind: 'waistband', panel: 'front', verts: Int32Array.from(F.R.top) }, { kind: 'waistband', panel: 'back', verts: Int32Array.from(B.R.top) }], zones: ['hips', 'legs'] };
}

// CLOTH4 (round 4, opt-in: a layer's `interfacing`): fused interlining as STIFFER CLOTH in K1's solver. spec { panels: [names] (whole panels,
// e.g. the collar stand and the cuffs), band (m: triangles whose corners all lie within this flat-pattern distance of a HOLD's vertices
// of their own panel, e.g. the trousers' top band under the waistband), bendX, stretchX (multipliers on the panel fabric's bending
// rigidity and in-plane stiffness: a fused woven interlining roughly multiplies a shirting's bending by 5-15 and makes it near
// inextensible), shearX }. Each interfaced triangle takes a derived fabric record '<fabric>+fused' (S.fabs / fabNames grow; S.triFab
// reassigned). Returns { tris: count, fabs: [names] }. Absent: nothing runs.
export function interfacing(S, pattern, spec = {}) {
  const { panels = [], band = 0, bendX = 10, stretchX = 2, shearX = 3, hemY = null } = spec, P = pattern.panels, names = P.map(p => p.name), m = S.tris.length / 3, near = new Uint8Array(S.n);
  // CLOTH5 (opt-in hemY, m): every triangle placed wholly below hemY (a trouser leg's turned hem: two layers and a stitch line, stiffer than the leg)
  if (hemY != null) for (let i = 0; i < S.n; i++) if (S.X[i * 3 + 1] < hemY) near[i] = 1;
  if (band > 0) for (const hd of pattern.holds || []) { const pi = names.indexOf(hd.panel), o = S.off[hd.panel], p = P[pi]; if (pi < 0) continue; const k = p.uv.length / 2, hv = Array.from(hd.verts);
    for (let i = 0; i < k; i++) { let b = Infinity; for (const v of hv) b = Math.min(b, (p.uv[i * 2] - p.uv[v * 2]) ** 2 + (p.uv[i * 2 + 1] - p.uv[v * 2 + 1]) ** 2); if (b <= band * band) near[o + i] = 1; } }
  const want = new Set(panels), derived = new Map(); let count = 0;
  const fusedOf = f => { if (!derived.has(f)) { const F = S.fabs[f], nm = S.fabNames[f] + '+fused'; S.fabs.push({ ...F, B: F.B * bendX, k: F.k.map(x => x * stretchX), shear: F.shear * shearX, fused: true }); S.fabNames.push(nm); derived.set(f, S.fabs.length - 1); } return derived.get(f); };
  for (let t = 0; t < m; t++) { const a = S.tris[t * 3], b = S.tris[t * 3 + 1], c = S.tris[t * 3 + 2], pn = names[S.panelOf[a]];
    if (want.has(pn) || ((band > 0 || hemY != null) && near[a] && near[b] && near[c])) { S.triFab[t] = fusedOf(S.triFab[t]); count++; } }
  return { tris: count, of: m, fabs: [...derived.values()].map(i => S.fabNames[i]) };
}
