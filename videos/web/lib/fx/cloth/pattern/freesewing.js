// PATTERN / FREESEWING (CLOTHING c2, lane K2): a FreeSewing design drafted for one person's measures, and its parts turned into 2D
// PANELS for the sewing phase. FreeSewing (freesewing.org; @freesewing/* v4.10.2) is MIT, (c) 2022 Joost De Cock and contributors: we
// take it as the drafting engine (npm dependency, its licence notice kept in node_modules; credited in review/studio_clothing_c2/
// after/patterns/NOTES.md). We do NOT take its sizes (@freesewing/models): every measure comes from lane A's person (tailor.js).
//
// What a FreeSewing part gives: named points and Bezier paths in mm (x right, y DOWN), the 'seam' path (the stitching line; seam
// allowances are a separate 'sa' path, which we never draft: sa = 0), a grainline or cut-on-fold macro, dart paths, notches as
// snippets on named points. What it does not give: which edge sews to which (sewmaps/ do), the placement on a body (place.js), a mesh
// (mesh2d.js).
//
// A PANEL (the contract K1's sewing reads; review/studio_clothing_c2/after/patterns/NOTES.md "contract"):
//   { name, part, outline: Float64Array (2 x k, metres, u right, v UP, closed, counter-clockwise = seen from the fabric's right side,
//     i.e. from outside the garment), tags: { pointName: outline vertex index }, grain: [gu, gv] (unit, the warp), fold: bool (was cut
//     on fold and mirrored), area (m^2), perimeter (m), from: { design, part } }
// The outline is flattened from the Beziers to within `tol` (0.25 mm default) and carries every named FreeSewing point that lies on it
// (within 0.3 mm) as a tag; mirrored copies of a cut-on-fold part get tags with the suffix '~m'.
//
//   const D = await loadDesign('simone');
//   const d = draft(D, measuresMm, options)               // { parts: { 'simon.frontLeft': part, ... }, ms, log }
//   const P = panelFrom(d.parts['simon.frontLeft'], { name: 'frontL', insert: [{ from: 'dartBottom', to: 'dartTop', path: 'dart' }], clip: { u: '>=', at: 0 } })
export const K2_VERSION = 1;
const DESIGNS = {};
// the designs c2 uses (installed in videos/web/node_modules; package.json lists them)
export const KNOWN = ['simone', 'simon', 'titan', 'charlie', 'opal', 'onyx', 'sarah', 'sandy', 'bruce', 'aaron', 'teagan', 'sophie'];
export async function loadDesign(name) {
  if (DESIGNS[name]) return DESIGNS[name];
  const mod = await import(/* @vite-ignore */ '@freesewing/' + name);
  const D = Object.values(mod).find(v => typeof v === 'function' && v.designConfig);
  if (!D) throw new Error('no FreeSewing design in @freesewing/' + name);
  return (DESIGNS[name] = D);
}
// draft: measures in mm (FreeSewing's unit), options as FreeSewing option values (fractions for pct options, degrees for deg)
export function draft(D, measurements, options = {}, { sa = 0 } = {}) {
  const t0 = now(), pat = new D({ measurements, options, sa, complete: true, paperless: false }).draft(), ms = now() - t0;
  const set = pat.parts?.[0] || {}, store = pat.setStores?.[0] || pat.stores?.[0] || pat.store, logs = store?.logs || {};
  const parts = {}; for (const [k, p] of Object.entries(set)) if (!p.hidden) parts[k] = p;
  return { parts, ms, log: { error: [...(logs.error || [])], warn: [...(logs.warn || [])] }, pattern: pat };
}
const now = () => (globalThis.performance?.now ? performance.now() : Date.now());

// ---------------------------------------------------------------- Bezier flattening (adaptive, chord tolerance in mm)
function cubic(p0, p1, p2, p3, out, tol, depth = 0) {
  // flat enough when both control points are within tol of the chord
  const dx = p3[0] - p0[0], dy = p3[1] - p0[1], L = Math.hypot(dx, dy) || 1e-9;
  const d1 = Math.abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx) / L, d2 = Math.abs((p2[0] - p0[0]) * dy - (p2[1] - p0[1]) * dx) / L;
  if ((d1 + d2 <= tol && Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]) <= L * 1.5) || depth > 14) { out.push(p3); return; }
  const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], a = m(p0, p1), b = m(p1, p2), c = m(p2, p3), ab = m(a, b), bc = m(b, c), mid = m(ab, bc);
  cubic(p0, a, ab, mid, out, tol, depth + 1); cubic(mid, bc, c, p3, out, tol, depth + 1);
}
const xy = p => [p.x, p.y];
// a FreeSewing Path -> polyline [[x, y] ...] (mm, y down); one subpath (the first 'move' starts it; 'close' returns to it)
export function flatten(path, tol = 0.25) {
  const out = []; let start = null, cur = null;
  for (const op of path.ops) {
    if (op.type === 'move') { cur = xy(op.to); start = cur; out.push(cur); }
    else if (op.type === 'line') { cur = xy(op.to); out.push(cur); }
    else if (op.type === 'curve') { const q = []; cubic(cur, xy(op.cp1), xy(op.cp2), xy(op.to), q, tol); for (const p of q) out.push(p); cur = xy(op.to); }
    else if (op.type === 'close') { if (start && (Math.abs(cur[0] - start[0]) > 1e-6 || Math.abs(cur[1] - start[1]) > 1e-6)) out.push(start); cur = start; }
  }
  // drop repeats
  const r = [out[0]]; for (let i = 1; i < out.length; i++) { const p = out[i], q = r[r.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) r.push(p); }
  return r;
}
const isClosed = P => P.length > 2 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1e-3;

// named points of a part that are worth tagging (not control points, not macro internals, not temporaries)
function namedPoints(part) {
  const out = [];
  for (const [k, p] of Object.entries(part.points)) { if (k.startsWith('_') || k.includes('macro') || /Cp\d?$|Cp\d?[A-Z]|Cp$|_rot\d|^title|^logo|^scalebox|^gridAnchor|^anchor$|^mirrored|Direction$/.test(k)) continue; out.push([k, p.x, p.y]); }
  return out;
}
// insert named points lying on the polyline (closed, mm) as vertices; returns { pts, tags }
function tagPoints(P, named, eps = 0.3) {
  const n = P.length, tags = {}, ins = [];   // [segment index, t, name, x, y]
  for (const [k, x, y] of named) {
    let best = null;
    for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; if (L2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)), d = Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y);
      if (d < eps && (!best || d < best[2])) best = [i, t, d]; }
    if (best) ins.push([best[0], best[1], k, x, y]);
  }
  // merge: a point at t ~ 0 or 1 is an existing vertex
  const add = new Map();
  for (const [i, t, k, x, y] of ins) { const L = Math.hypot(P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]);
    if (t * L < 0.05) { (tags[k] ??= []).push({ v: i }); continue; } if ((1 - t) * L < 0.05) { (tags[k] ??= []).push({ v: (i + 1) % n }); continue; }
    if (!add.has(i)) add.set(i, []); add.get(i).push([t, k, x, y]); }
  const out = [], map = new Int32Array(n);
  for (let i = 0; i < n; i++) { map[i] = out.length; out.push(P[i]); const L = add.get(i); if (!L) continue; L.sort((a, b) => a[0] - b[0]);
    for (const [t, k] of L) { const a = P[i], b = P[(i + 1) % n]; const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; (tags[k] ??= []).push({ v: out.length, fresh: true }); out.push(q); } }
  const T = {}; for (const [k, L] of Object.entries(tags)) { const e = L[0]; T[k] = e.fresh ? e.v : map[e.v]; }
  return { pts: out, tags: T };
}
// signed area (y up positive = counter-clockwise)
const area = P => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
const invTags = tags => { const m = new Map(); for (const [k, v] of Object.entries(tags)) { if (!m.has(v)) m.set(v, []); m.get(v).push(k); } return m; };
// clip a closed polygon by a half-plane u >= at (or <=), Sutherland-Hodgman; keeps tags of surviving vertices, names the cut corners
function clipU(P, tags, sense, at) {
  const inside = p => (sense === '>=' ? p[0] >= at - 1e-6 : p[0] <= at + 1e-6), out = [], newTags = {}, inv = invTags(tags);
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], ia = inside(a), ib = inside(b);
    if (ia) { for (const k of inv.get(i) || []) newTags[k] = out.length; out.push(a); }
    if (ia !== ib) { const t = (at - a[0]) / (b[0] - a[0]); if (t > 1e-6 && t < 1 - 1e-6) { newTags[(ia ? 'clipOut' : 'clipIn') + (newTags.clipOut != null && ia ? '2' : '')] = out.length; out.push([at, a[1] + (b[1] - a[1]) * t]); } } }
  return { pts: out, tags: newTags };
}

// ---------------------------------------------------------------- part -> panel
// spec: { name, path: 'seam', insert: [{ from, to, path }] (replace the outline between two tags by another path's points, e.g. a dart's
//   legs where the seam line jumps across the dart's mouth), clip: { u: '>=' | '<=', at (mm) }, mirror: 'fold' (cut on fold: mirror
//   about x = 0 and join), grain: [gx, gy] override (FreeSewing frame), tol }
export function panelFrom(part, spec = {}) {
  const path = part.paths[spec.path || 'seam']; if (!path) throw new Error(`${part.name}: no path ${spec.path || 'seam'}`);
  let P = flatten(path, spec.tol ?? 0.25); if (isClosed(P)) P.pop();
  const named = namedPoints(part);
  let { pts, tags } = tagPoints(P, named);
  // inserts (darts): the outline from tag A to tag B (next to each other along the seam) is replaced by the path's polyline
  for (const ins of spec.insert || []) {
    const ia = tags[ins.from], ib = tags[ins.to]; if ((ia == null || ib == null || !part.paths[ins.path]) && ins.optional) continue;
    if (ia == null || ib == null) throw new Error(`${part.name}: insert needs tags ${ins.from}, ${ins.to}`);
    let Q = flatten(part.paths[ins.path], spec.tol ?? 0.25); const d0 = Math.hypot(Q[0][0] - pts[ia][0], Q[0][1] - pts[ia][1]), d1 = Math.hypot(Q[Q.length - 1][0] - pts[ia][0], Q[Q.length - 1][1] - pts[ia][1]);
    if (d1 < d0) Q = Q.reverse();
    // the two tags must be close along the outline (a straight jump across a dart's mouth, maybe with a notch point on it)
    const n = pts.length, df = (ib - ia + n) % n, db = (ia - ib + n) % n, fwd = df <= db, gap = Math.min(df, db); if (gap > 4) throw new Error(`${part.name}: ${ins.from} and ${ins.to} are not adjacent on the outline`);
    const mid = Q.slice(1, -1); if (!fwd) mid.reverse();
    const at = fwd ? ia : ib, keep = []; for (let i = 0; i < n; i++) { const off = (i - at + n) % n; if (off > 0 && off < gap) continue; keep.push(i); }
    const out = []; for (const i of keep) { out.push(pts[i]); if (i === at) out.push(...mid); }
    const r = tagPoints(out, named); pts = r.pts; tags = r.tags;
  }
  // a part drafted whole but symmetric (a yoke): name the mirror image of every tagged point '<name>~m'
  if (spec.symTags) for (const [k, v] of Object.entries({ ...tags })) { const x = pts[v][0], y = pts[v][1]; if (Math.abs(x) < 0.05) continue;
    let best = -1, bd = 0.3; for (let i = 0; i < pts.length; i++) { const d = Math.hypot(pts[i][0] + x, pts[i][1] - y); if (d < bd) { bd = d; best = i; } } if (best >= 0) tags[k + '~m'] = best; }
  // mm, y down -> metres, v up
  let U = pts.map(p => [p[0] / 1000, -p[1] / 1000]);
  if (spec.clip) { const r = clipU(U, tags, spec.clip.u, spec.clip.at / 1000); U = r.pts; tags = r.tags; }
  let fold = false;
  if (spec.mirror === 'fold') {   // the fold is the outline's run on u = 0: drop it, append the mirror image (reversed) of the rest
    fold = true; const n = U.length, on = U.map(p => Math.abs(p[0]) < 1e-5);
    let s = -1; for (let i = 0; i < n; i++) if (on[i] && !on[(i + 1) % n]) { s = i; break; }   // last fold vertex before the free run
    if (s < 0) throw new Error(`${part.name}: no fold run on u = 0`);
    const run = []; for (let k = 0; k < n; k++) { const i = (s + k) % n; run.push(i); if (k > 0 && on[i]) break; }   // fold vertex .. free run .. fold vertex
    const inv = invTags(tags), out = [], T = {};
    for (const i of run) { for (const k of inv.get(i) || []) T[k] = out.length; out.push(U[i]); }
    for (let k = run.length - 2; k >= 1; k--) { const i = run[k]; for (const nm of inv.get(i) || []) T[nm + '~m'] = out.length; out.push([-U[i][0], U[i][1]]); }
    U = out; tags = T;
  }
  // marks: tags made from the outline itself ({ name, at: 'maxV' | 'minV' | 'maxU' | 'minU' }): the cap's top where FreeSewing's
  // sleeveTop is not on the curve for every draft
  for (const mk of spec.mark || []) { let best = 0; const val = i => mk.at === 'maxV' ? U[i][1] : mk.at === 'minV' ? -U[i][1] : mk.at === 'maxU' ? U[i][0] : -U[i][0];
    for (let i = 1; i < U.length; i++) if (val(i) > val(best)) best = i; tags[mk.name] = best; }
  // counter-clockwise seen from the right side (FreeSewing draws parts right side up; a mirrored fold keeps that)
  let rev = false; if (area(U) < 0) { rev = true; const n = U.length; U = U.slice().reverse(); for (const k of Object.keys(tags)) tags[k] = n - 1 - tags[k]; }
  // grain: the grainline macro's two points, else along a cut-on-fold, else straight down the part (warp along v)
  let g = spec.grain || null; const gl = part.paths.__macro_grainline_grainline_line;
  if (!g && gl) { const Q = flatten(gl); g = [Q[Q.length - 1][0] - Q[0][0], Q[Q.length - 1][1] - Q[0][1]]; }
  g ||= [0, 1]; let gu = g[0], gv = -g[1]; const gl2 = Math.hypot(gu, gv) || 1; gu /= gl2; gv /= gl2; if (gv < 0 || (Math.abs(gv) < 1e-6 && gu < 0)) { gu = -gu; gv = -gv; }
  const outline = new Float64Array(U.length * 2); U.forEach((p, i) => { outline[i * 2] = p[0]; outline[i * 2 + 1] = p[1]; });
  let per = 0; for (let i = 0; i < U.length; i++) { const a = U[i], b = U[(i + 1) % U.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return { name: spec.name || part.name, part: part.name, outline, tags, grain: [gu, gv], fold, reversed: rev, area: Math.abs(area(U)), perimeter: per, from: { part: part.name } };
}
// arc length of the outline from tag a to tag b going forward (counter-clockwise); with dir -1 backwards
export function runLength(panel, a, b, dir = 1) {
  const O = panel.outline, n = O.length / 2, ia = typeof a === 'number' ? a : panel.tags[a], ib = typeof b === 'number' ? b : panel.tags[b];
  if (ia == null || ib == null) throw new Error(`${panel.name}: no tag ${ia == null ? a : b}`);
  let L = 0; for (let i = ia; i !== ib; i = (i + dir + n) % n) { const j = (i + dir + n) % n; L += Math.hypot(O[j * 2] - O[i * 2], O[j * 2 + 1] - O[i * 2 + 1]); }
  return L;
}
// the outline vertices from tag a to tag b inclusive (dir 1 forward, -1 backward)
export function runIdx(panel, a, b, dir = 1) {
  const n = panel.outline.length / 2, ia = typeof a === 'number' ? a : panel.tags[a], ib = typeof b === 'number' ? b : panel.tags[b];
  if (ia == null || ib == null) throw new Error(`${panel.name}: no tag ${ia == null ? a : b}`);
  const out = [ia]; for (let i = ia; i !== ib; ) { i = (i + dir + n) % n; out.push(i); if (out.length > n + 1) throw new Error('runIdx loop'); } return out;
}
// mirror a panel left-right (the other sleeve, the other front): u -> -u, then re-wound counter-clockwise
export function mirrorPanel(P, name) {
  const n = P.outline.length / 2, O = new Float64Array(n * 2), tags = {};
  for (let i = 0; i < n; i++) { const j = n - 1 - i; O[i * 2] = -P.outline[j * 2]; O[i * 2 + 1] = P.outline[j * 2 + 1]; }
  for (const [k, v] of Object.entries(P.tags)) tags[k] = n - 1 - v;
  return { ...P, name, outline: O, tags, grain: [-P.grain[0], P.grain[1]], mirrored: !P.mirrored };
}
// a point of the part (FreeSewing frame) in panel coordinates
export const toPanel = (p, mirror = false) => [(mirror ? -1 : 1) * p.x / 1000, -p.y / 1000];
