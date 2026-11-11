// FABRIC7 fold7 (c5 it4, 8 Oct): the creases of the strain-driven wrinkle cascade as GEOMETRY, not as a normal map.
//
// The client's / the critic's complaint about the cascade of c5 it1-3: 'weight has to come from geometry, not a normal-only shader': a normal map casts no shadow, breaks no silhouette and reads at 1:1 only. The
// cascade's own mechanics say which of its creases a mesh can carry: a ridge A sech^2(u / w) has a width at half height of 1.76 w = 0.39 lambda_n, and a mesh whose edges are h samples it with 2 vertices in that
// width when 0.39 lambda_n >= 2 h. The octaves at or above that wavelength are built here, into the garment's own vertices (outward along the surface normal: cloth lying on a body buckles away from it, so a ridge
// never runs into the body); the finer ones stay with the shader (fabric6.js F6_WRINKLE draws octaves 0 .. nO - nG - 1: f6Wg = nG). Nothing is counted twice: the shader still shares the excess among ALL the octaves,
// the geometry takes the top nG shares and the strain attributes (aF6s) are the excess BEFORE the geometry took them.
//   fold7(root, opts)    one call on a built person (fabric6.js prepareFabric6 calls it when a page asked for `fold: 1` in useFabric7): every garment host (k3.group 'garment') whose fabric has octaves the mesh carries
//                        is displaced; every construction mesh (hems, pockets, stitches, plackets, rivets, buttons) rides on the host surface it sits on (the nearest host triangle: the displacement and the change of
//                        normal interpolated barycentrically), so no pocket floats and no hem sinks. Deterministic (hash seeds from the garment's name): the engine's page, the Cycles export and the atlas bake build the
//                        same mesh. Idempotent. It returns the report (per host: octaves carried, heights, clearance clamps, the excess before and after).
// WHERE THE CREASES STAND (crease7.js, the only placement since 15 Oct: it4's hash cells, which put creases where a hash said and gave rings of equal height down a sleeve, are deleted; the critic of 8 Oct 23:05: 'a fold has a cause').
// Each crease is nucleated where the cloth most needs one (the maximum of the REMAINING raw excess, made easier by a held edge the compression points into and by a material imperfection), grown along the strain
// field's crest trajectory until its catchment's excess is spent, and made tall by the cloth of that catchment (conservation of length, at the slope bound at most); a placed crease relieves the cloth round it, so
// spacings are irregular.
// What holds the cloth, as physics (not as gains): (1) a seam or hem is doubled, stitched cloth (a 10 mm allowance) and carries no fold; a ridge of half-width w rises over the next w; this is also what keeps the duplicated
// vertices of a seam from cracking apart. (2) A fold lies no steeper than a rounded ridge can (peak slope 0.7: 35 deg); steeper is a sharp crease. (3) Another layer is a limit: an inner layer is clamped to the clearance under
// the layer above it (a ray along the normal to every other garment's surface, less 0.7 mm). (4) Heights come from CONSERVATION OF THE EXCESS LENGTH: where the solved cloth is as long as its pattern, nothing moves.
// THE EXCESS IS THE RAW ONE (fabric6.js strainField's Rw: the shortfall of the smaller principal stretch against the flat pattern, less the solve's own 1.2 % slack, WITHOUT the fabric's fine-wrinkle slope cap that
// holds the shader's cascade): a sleeve 15 % shorter than its cut folds as deep as it must (a cuff pushed up the forearm: 1-2 cm rings), a hip a few percent: the folds are what the dressing's mesh lacks of the cloth the
// pattern cut. What it cannot do: the ridges are sparse (the model's spacing) and capped, so the stage takes 3-20 % of a garment's raw excess; the rest stays unexpressed; and where the dressing itself shortened the cloth
// (a squeeze, a re-laid sleeve) the excess is the dressing's artefact and the folds are its echo: say so beside the plates.
import * as THREE from 'three';
import { look6, cascade6, CASCADE_P, excess6, refreshCrest6, fabric6Attributes } from '../fabric6.js';
import { RIDGE } from './ridge7.js';
import { CREASE7, rasterPanel, placeCreases, heightsAt } from './crease7.js';

const FWHM = 1.763 * RIDGE.w;   // the width at half height of A sech^2(u / w), in the octave's wavelengths
export const FOLD7 = { sample: 1.5, refine: 1, slope: 0.7, allowance: 0.010, clear: 0.0007, reach: 0.06, rider: 0.012, weld: 2e-4, contact: 0.008, touch: 24, sheet: 1.0 };   // vertices across a ridge's half height; the steepest a ridge may lie (peak slope 0.7: 35 deg, a rounded fold; steeper is a sharp crease); a seam / hem allowance (m): the stitched, doubled cloth no fold crosses; clearance under another layer (m); ray reach (m); a rider's reach to its host (m); weld tolerance (m)
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 1000; };
const q = (a, f) => a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))] : 0;

function meanEdge(P, I) { let s = 0, c = 0; const step = Math.max(3, Math.floor(I.length / 3 / 4000) * 3);
  for (let t = 0; t < I.length; t += step) for (let k = 0; k < 3; k++) { const a = I[t + k], b = I[t + (k + 1) % 3]; s += Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]); c++; }
  return c ? s / c : 0.014; }
// vertices at one place (a seam's two sides, a split normal) are one group; the surface normal of a group is the area-weighted mean over every face that touches it
function weld(P, n, tol) { const grp = new Int32Array(n), map = new Map(); let ng = 0;
  for (let i = 0; i < n; i++) { const k = `${Math.round(P[i * 3] / tol)},${Math.round(P[i * 3 + 1] / tol)},${Math.round(P[i * 3 + 2] / tol)}`; let g = map.get(k); if (g === undefined) { g = ng++; map.set(k, g); } grp[i] = g; }
  return { grp, ng }; }
function groupNormals(P, I, grp, ng) { const A = new Float64Array(ng * 3);
  for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2], e1x = P[b * 3] - P[a * 3], e1y = P[b * 3 + 1] - P[a * 3 + 1], e1z = P[b * 3 + 2] - P[a * 3 + 2], e2x = P[c * 3] - P[a * 3], e2y = P[c * 3 + 1] - P[a * 3 + 1], e2z = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x; for (const v of [a, b, c]) { const g = grp[v]; A[g * 3] += nx; A[g * 3 + 1] += ny; A[g * 3 + 2] += nz; } }
  const out = new Float32Array(ng * 3); for (let g = 0; g < ng; g++) { const l = Math.hypot(A[g * 3], A[g * 3 + 1], A[g * 3 + 2]) || 1; out[g * 3] = A[g * 3] / l; out[g * 3 + 1] = A[g * 3 + 1] / l; out[g * 3 + 2] = A[g * 3 + 2] / l; }
  return out; }

// the neighbours of each welded place along the surface (the graph of the mesh's edges, seam duplicates one node), and the places within a distance ALONG the cloth of one place: its own sheet
function groupAdj(I, grp, ng) { const adj = Array.from({ length: ng }, () => new Set());
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = grp[I[t + k]], b = grp[I[t + (k + 1) % 3]]; if (a !== b) { adj[a].add(b); adj[b].add(a); } }
  return adj.map(s => Array.from(s)); }
function nearSheet(adj, pos, g, rho) {   // the places within `rho` metres ALONG THE SURFACE of place g (Dijkstra over the edges): its own sheet. Cloth further off along the cloth but within a contact distance in space is another layer.
  const dist = new Map([[g, 0]]); let open = [g];
  while (open.length) { let bi = 0; for (let i = 1; i < open.length; i++) if (dist.get(open[i]) < dist.get(open[bi])) bi = i; const a = open.splice(bi, 1)[0], da = dist.get(a);
    for (const b of adj[a]) { const nd = da + Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]); if (nd <= rho && (!dist.has(b) || nd < dist.get(b))) { if (!dist.has(b)) open.push(b); dist.set(b, nd); } } }
  return dist; }

// a triangle grid (cells of `cell` metres) over several hosts: each triangle is nine coordinates, its owner host and its three vertex ids
function triGrid(hosts, cell) {
  const tris = [], G = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  hosts.forEach((H, hi) => { const P = H.P, I = H.I;
    for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2], id = tris.length;
      tris.push({ h: hi, a, b, c, c9: [P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[b * 3], P[b * 3 + 1], P[b * 3 + 2], P[c * 3], P[c * 3 + 1], P[c * 3 + 2]] });
      const T = tris[id].c9, lo = [0, 1, 2].map(k => Math.min(T[k], T[3 + k], T[6 + k])), hi2 = [0, 1, 2].map(k => Math.max(T[k], T[3 + k], T[6 + k]));
      for (let x = Math.floor(lo[0] / cell); x <= Math.floor(hi2[0] / cell); x++) for (let y = Math.floor(lo[1] / cell); y <= Math.floor(hi2[1] / cell); y++) for (let z = Math.floor(lo[2] / cell); z <= Math.floor(hi2[2] / cell); z++) {
        const k = key(x, y, z); const L = G.get(k); if (L) L.push(id); else G.set(k, [id]); } } });
  return { tris, G, cell, key }; }
// Moller-Trumbore: distance t along d (unit) from o to the triangle, or Infinity
function rayTri(o, d, T, tmax) {
  const e1x = T[3] - T[0], e1y = T[4] - T[1], e1z = T[5] - T[2], e2x = T[6] - T[0], e2y = T[7] - T[1], e2z = T[8] - T[2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) return Infinity;
  const inv = 1 / det, tx = o[0] - T[0], ty = o[1] - T[1], tz = o[2] - T[2], u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) return Infinity;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) return Infinity;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv; return t > 0 && t <= tmax ? t : Infinity; }
// closest point of a triangle to p (Ericson): squared distance and the barycentric weights (a, b, c)
function closestTri(p, T) {
  const ax = T[0], ay = T[1], az = T[2], abx = T[3] - ax, aby = T[4] - ay, abz = T[5] - az, acx = T[6] - ax, acy = T[7] - ay, acz = T[8] - az, apx = p[0] - ax, apy = p[1] - ay, apz = p[2] - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz; if (d1 <= 0 && d2 <= 0) return [apx * apx + apy * apy + apz * apz, 1, 0, 0];
  const bpx = p[0] - T[3], bpy = p[1] - T[4], bpz = p[2] - T[5], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz; if (d3 >= 0 && d4 <= d3) return [bpx * bpx + bpy * bpy + bpz * bpz, 0, 1, 0];
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3), rx = apx - v * abx, ry = apy - v * aby, rz = apz - v * abz; return [rx * rx + ry * ry + rz * rz, 1 - v, v, 0]; }
  const cpx = p[0] - T[6], cpy = p[1] - T[7], cpz = p[2] - T[8], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz; if (d6 >= 0 && d5 <= d6) return [cpx * cpx + cpy * cpy + cpz * cpz, 0, 0, 1];
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6), rx = apx - w * acx, ry = apy - w * acy, rz = apz - w * acz; return [rx * rx + ry * ry + rz * rz, 1 - w, 0, w]; }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)), rx = bpx - w * (T[6] - T[3]), ry = bpy - w * (T[7] - T[4]), rz = bpz - w * (T[8] - T[5]); return [rx * rx + ry * ry + rz * rz, 0, 1 - w, w]; }
  const dn = 1 / (va + vb + vc), v = vb * dn, w = vc * dn, rx = apx - abx * v - acx * w, ry = apy - aby * v - acy * w, rz = apz - abz * v - acz * w; return [rx * rx + ry * ry + rz * rz, 1 - v - w, v, w]; }

// One 1 -> 4 split of an indexed triangle mesh (the midpoint of every edge becomes a vertex): every float attribute is interpolated linearly, the skin (up to 4 bones a vertex) as the union of the two ends' bones,
// weights halved, the four heaviest kept. The surface does not change (the new vertices lie on the old edges): it is the sampling that is finer, so a ridge narrower than the old edges has vertices to stand on.
// null for a mesh it will not split (morph targets).
function splitMesh(g) {
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return null;
  const n = g.attributes.position.count, I = g.index ? g.index.array : Uint32Array.from({ length: n }, (_, i) => i), mid = new Map(), ends = []; let nn = n;
  const edge = (a, b) => { const k = a < b ? a * n + b : b * n + a; let v = mid.get(k); if (v === undefined) { v = nn++; mid.set(k, v); ends.push(a, b); } return v; };
  const T = new Uint32Array(I.length * 4);
  for (let t = 0, o = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2], ab = edge(a, b), bc = edge(b, c), ca = edge(c, a);
    T.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], o); o += 12; }
  const out = new THREE.BufferGeometry(); out.userData = { ...(g.userData || {}) }; delete out.userData.f6raw;
  for (const [name, A] of Object.entries(g.attributes)) { const k = A.itemSize, src = A.array, dst = new src.constructor(nn * k); dst.set(src);
    if (name === 'skinIndex' && g.attributes.skinWeight) { const W = g.attributes.skinWeight.array, Wd = new Float32Array(nn * 4); Wd.set(W); g.attributes.skinWeight._split = Wd;
      for (let i = 0; i < ends.length; i += 2) { const v = n + i / 2, a = ends[i], b = ends[i + 1], acc = new Map();
        for (const [u, w] of [[a, 1], [b, 1]]) for (let j = 0; j < 4; j++) { const bone = src[u * 4 + j], wt = W[u * 4 + j] * 0.5 * w; if (wt > 0) acc.set(bone, (acc.get(bone) || 0) + wt); }
        const top = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4), sum = top.reduce((s2, e) => s2 + e[1], 0) || 1;
        for (let j = 0; j < 4; j++) { dst[v * 4 + j] = top[j] ? top[j][0] : 0; Wd[v * 4 + j] = top[j] ? top[j][1] / sum : 0; } } }
    else if (name === 'skinWeight') continue;
    else for (let i = 0; i < ends.length; i += 2) { const v = n + i / 2, a = ends[i], b = ends[i + 1]; for (let j = 0; j < k; j++) dst[v * k + j] = (src[a * k + j] + src[b * k + j]) * 0.5; }
    if (name === 'normal') for (let v = n; v < nn; v++) { const l = Math.hypot(dst[v * 3], dst[v * 3 + 1], dst[v * 3 + 2]) || 1; dst[v * 3] /= l; dst[v * 3 + 1] /= l; dst[v * 3 + 2] /= l; }
    out.setAttribute(name, new THREE.BufferAttribute(dst, k, A.normalized)); }
  if (g.attributes.skinWeight) out.setAttribute('skinWeight', new THREE.BufferAttribute(g.attributes.skinWeight._split, 4, g.attributes.skinWeight.normalized));
  out.setIndex(new THREE.BufferAttribute(T, 1)); out.computeBoundingBox(); out.computeBoundingSphere(); return out;
}

export function fold7(root, opts = {}) {
  const O = { ...FOLD7, ...opts }, t0 = (globalThis.performance || Date).now();
  root.updateMatrixWorld(true);
  const meshes = [], riders = [], report = { hosts: [], riders: 0, ms: 0 };
  root.traverse(m => { if (!m.isMesh || !m.geometry?.attributes?.position || m.userData?.fold7?.done) return;
    const k = m.userData?.k3, a = m.geometry.attributes;
    if (k?.group === 'garment' && m.material?.userData?.fabric6 && a.aF6s && a.aF6e && a.uv && a.normal) meshes.push(m); else if (k?.group === 'construction') riders.push(m); });
  if (!meshes.length) { report.ms = Math.round((globalThis.performance || Date).now() - t0); return report; }
  // ---- 1. per host: which octaves the mesh carries, the heights at its vertices
  const hosts = [];
  for (const m of meshes) {
    // the mesh must be fine enough to stand the TOP octave on (>= `sample` vertices across a ridge's half height): one split where it is not (the jerseys: a 30 mm fold on 14 mm edges)
    const fab0 = m.material.userData.fabric6.fabric, L0 = look6(fab0), c0 = cascade6(fab0, L0);
    if (O.refine && c0.n > 1 && m.geometry.userData?.f6raw) { const g0 = m.geometry, h0 = meanEdge(g0.attributes.position.array, g0.index ? g0.index.array : Uint32Array.from({ length: g0.attributes.position.count }, (_, i) => i)), top0 = FWHM * c0.lamF;
      if (top0 < O.sample * h0 && top0 >= O.sample * h0 / 2) { const ng = splitMesh(g0); if (ng) { m.geometry = ng; g0.dispose(); m.boundingSphere = null; m.boundingBox = null; fabric6Attributes(m, ng, fab0); m.userData.fold7split = 1; } } }
    const g = m.geometry, n = g.attributes.position.count, P = g.attributes.position.array, UV = g.attributes.uv.array, S = g.attributes.aF6s.array, E = g.attributes.aF6e.array;
    const R = g.userData?.f6raw, I = g.index ? g.index.array : Uint32Array.from({ length: n }, (_, i) => i), sc = new THREE.Vector3().setFromMatrixScale(m.isSkinnedMesh ? m.bindMatrix : m.matrixWorld).x || 1;
    const fabric = m.material.userData.fabric6.fabric, L = look6(fabric), c = cascade6(fabric, L), name = m.userData.k3.name || m.name || 'garment', h = meanEdge(P, I) * sc;
    const H = { m, g, n, P, UV, S, E, I, sc, fabric, name, color: m.userData.k3.color, edge: h, nO: c.n, R: c.R, lamF: c.lamF, nG: 0, D: null, rep: { name, fabric, verts: n, edgeMm: +(h * 1000).toFixed(2), octaves: c.n } };
    hosts.push(H);
    if (!(c.n > 1) || !R) { H.rep.skipped = 'no cascade (cascade 0, or a fabric with one octave)'; continue; }
    const lam0 = c.lam0, cap = L.wr[1]; let n0 = c.n; for (let k = 0; k < c.n; k++) if (FWHM * lam0 * Math.pow(c.R, k) >= O.sample * h) { n0 = k; break; }
    H.nG = c.n - n0; H.n0 = n0; H.rep.carried = H.nG; H.rep.lamMm = Array.from({ length: c.n }, (_, k) => +(lam0 * 1000 * Math.pow(c.R, k)).toFixed(1));
    if (!H.nG) { H.rep.skipped = `no octave reaches ${O.sample} vertices across a ridge (edge ${(h * 1000).toFixed(1)} mm, top octave ${(lam0 * 1000 * Math.pow(c.R, c.n - 1)).toFixed(0)} mm)`; continue; }
    let ssum = 0; for (let k = 0; k < c.n; k++) ssum += Math.pow(c.R, CASCADE_P * k);
    const seed = 3.7 + 0.37 * hashStr(name + fabric + n), lamTop = lam0 * Math.pow(c.R, c.n - 1), band = O.allowance + RIDGE.w * lamTop, hold = O.allowance, D = new Float32Array(n);
    // creases with a cause (crease7.js): panel by panel, octave by octave, nucleated at the places the cloth most needs a fold, grown along the strain field's crest trajectory, tall by the cloth of their catchment
    const AR = g.attributes.aRest?.array, pan = Int32Array.from({ length: n }, (_, i) => AR ? Math.round(AR[i * 3 + 2] * 100) : 0), Rv = Float32Array.from(R), CR = { ...CREASE7, ...(O.crease || {}) }, panels = [...new Set(pan)].sort((a, b) => a - b);
    const wMin = RIDGE.w * lam0 * Math.pow(c.R, n0), cell = Math.min(0.008, Math.max(CR.cell, wMin / 3)); H.rep.creases = []; H.rep.cellMm = +(cell * 1000).toFixed(1);
    for (const p of panels) { const Rg = rasterPanel(UV, I, Rv, E, pan, p, lam0, cell); if (!Rg) continue; const verts = []; for (let v = 0; v < n; v++) if (pan[v] === p) verts.push(v);
      for (let k = n0; k < c.n; k++) { const S = lam0 * Math.pow(c.R, k), w = CR.loc * S, share = Math.pow(c.R, CASCADE_P * k) / ssum;
        const cr = placeCreases(Rg, { S, w, share, seed: seed + 7 * k + 31 * p, hold, slope: O.slope }, CR), hv = heightsAt(cr, w, UV, verts);
        for (let i = 0; i < verts.length; i++) D[verts[i]] += hv[i];
        H.rep.creases.push({ panel: p, octave: k, n: cr.length, meanLenMm: cr.length ? +(1000 * cr.reduce((s2, q) => s2 + q.len, 0) / cr.length).toFixed(0) : 0, maxAmm: cr.length ? +(1000 * Math.max(...cr.map(q => q.maxA))).toFixed(1) : 0 }); } }
    for (let v = 0; v < n; v++) { let hv = D[v]; if (!(hv > 0)) continue; const sd = E[v * 4], fd = E[v * 4 + 2]; if (sd >= 0) hv *= smooth(hold, band, sd); if (fd >= 0) hv *= smooth(hold, band, fd); D[v] = hv / sc; }
    H.D = D; H.ex0 = excess6(P, UV, I, n, sc);
  }
  const active = hosts.filter(H => H.D);
  if (!active.length) { for (const H of hosts) { H.m.userData.fold7 = { done: true, nG: 0 }; delete H.g.userData.f6raw; report.hosts.push(H.rep); } report.ms = Math.round((globalThis.performance || Date).now() - t0); return report; }
  // ---- 2. welded normals; ONE DISPLACEMENT VECTOR per place; two layers of the same cloth that TOUCH fold together; every place clamped to the clearance under the layer above
  // (c6 it2, 15 Oct: the slit. Two sheets of one garment that touch (a sleeve against the torso, the flanks of a pinched cap, the two layers of a flattened sleeve) each rose outward along their own normal and the gap that opened
  // between them was a hole: 206 pairs of vertices of the L23 coat that were within 4 mm before the stage were 4-26 mm apart after it. Cloth that rests on cloth does not part under a crease: the layers fold as one.
  // So every place that touches another sheet (within `contact` in space, and further than `sheet` x contact along the cloth) is held to the point it rests on: the displacement VECTOR of the place equals that of the
  // surface point under it (a position-based projection over the contacts, `touch` passes): stacked layers rise together, a pinched pair (normals opposed) cancels, nothing is pulled apart. The clamp under the layer above then runs along the resulting vector.)
  const grid = triGrid(hosts.map(H => ({ P: H.P, I: H.I })), 0.025);
  for (const H of hosts) { const W = weld(H.P, H.n, O.weld); H.grp = W.grp; H.ng = W.ng; H.nb = groupNormals(H.P, H.I, W.grp, W.ng); }
  for (const H of active) {
    const hi = hosts.indexOf(H), ng = H.ng, Dg = new Float64Array(ng), cnt = new Int32Array(ng), V = new Float64Array(ng * 3), rep0 = new Int32Array(ng).fill(-1); let clamps = 0, touching = 0;
    for (let v = 0; v < H.n; v++) { Dg[H.grp[v]] += H.D[v]; cnt[H.grp[v]]++; if (rep0[H.grp[v]] < 0) rep0[H.grp[v]] = v; }
    for (let g = 0; g < ng; g++) { Dg[g] /= cnt[g]; for (let k = 0; k < 3; k++) V[g * 3 + k] = Dg[g] > 0 ? H.nb[g * 3 + k] * Dg[g] : 0; }
    // the contacts: for each place the nearest surface of this garment that is not its own sheet, within `contact`: the point of that surface (a triangle and its barycentric weights) the place rests on
    const part = Array.from({ length: ng }, () => null), con = [];
    if (O.contact > 0 && O.touch > 0) { const adj = groupAdj(H.I, H.grp, ng), c2 = O.contact * O.contact, stamp = new Int32Array(grid.tris.length).fill(-1), gpos = new Float64Array(ng * 3); for (let g = 0; g < ng; g++) { const v = rep0[g]; gpos[g * 3] = H.P[v * 3]; gpos[g * 3 + 1] = H.P[v * 3 + 1]; gpos[g * 3 + 2] = H.P[v * 3 + 2]; }
      for (let g = 0; g < ng; g++) { const v = rep0[g], p = [H.P[v * 3], H.P[v * 3 + 1], H.P[v * 3 + 2]]; let own = null, best = c2, bt = null, bw = null;
        const cx = Math.floor(p[0] / grid.cell), cy = Math.floor(p[1] / grid.cell), cz = Math.floor(p[2] / grid.cell);
        for (let a = -1; a <= 1; a++) for (let b2 = -1; b2 <= 1; b2++) for (let c = -1; c <= 1; c++) { const L = grid.G.get(grid.key(cx + a, cy + b2, cz + c)); if (!L) continue;
          for (const id of L) { if (stamp[id] === g) continue; stamp[id] = g; const T = grid.tris[id]; if (T.h !== hi) continue;
            if (!own) own = nearSheet(adj, gpos, g, O.sheet * O.contact); const ga = H.grp[T.a], gb = H.grp[T.b], gc = H.grp[T.c]; if (own.has(ga) || own.has(gb) || own.has(gc)) continue;
            const r = closestTri(p, T.c9); if (r[0] < best) { best = r[0]; bt = [ga, gb, gc]; bw = [r[1], r[2], r[3]]; } } }
        if (bt) { con.push({ g, q: bt, w: bw }); (part[g] ||= new Set()); for (const o of bt) { part[g].add(o); (part[o] ||= new Set()).add(g); } } }
      for (let g = 0; g < ng; g++) if (part[g]) touching++;
    }
    // the clearance under the layer above, along the place's outward normal: the most it may rise before it meets a layer that is NOT one it rests on (the sheets a place touches move with it)
    const cap = new Float64Array(ng).fill(Infinity), seen = new Set(), stamp2 = new Int32Array(grid.tris.length).fill(-1);
    for (let v = 0; v < H.n; v++) { const g = H.grp[v]; if (seen.has(g)) continue; seen.add(g);
      const d = [H.nb[g * 3], H.nb[g * 3 + 1], H.nb[g * 3 + 2]], o = [H.P[v * 3] + d[0] * 1e-5, H.P[v * 3 + 1] + d[1] * 1e-5, H.P[v * 3 + 2] + d[2] * 1e-5], reach = Math.min(O.reach, 0.035), q = part[g];
      let tmin = Infinity; const steps = Math.ceil(reach / grid.cell) + 1;
      for (let s = 0; s <= steps; s++) { const t = Math.min(reach, s * grid.cell * 0.9), cx = Math.floor((o[0] + d[0] * t) / grid.cell), cy = Math.floor((o[1] + d[1] * t) / grid.cell), cz = Math.floor((o[2] + d[2] * t) / grid.cell);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const L = grid.G.get(grid.key(cx + a, cy + b, cz + c)); if (!L) continue;
          for (const id of L) { if (stamp2[id] === g) continue; stamp2[id] = g; const T = grid.tris[id];
            if (T.h === hi) { const ga = H.grp[T.a], gb = H.grp[T.b], gc = H.grp[T.c]; if (ga === g || gb === g || gc === g || (q && (q.has(ga) || q.has(gb) || q.has(gc)))) continue; }
            const r = rayTri(o, d, T.c9, reach); if (r < tmin && r > 0.0005) tmin = r; } } }
      if (tmin < Infinity) cap[g] = Math.max(0, tmin - O.clear); }
    const clampAll = () => { let n = 0; for (let g = 0; g < ng; g++) { if (!(cap[g] < Infinity)) continue; const L0 = Math.hypot(V[g * 3], V[g * 3 + 1], V[g * 3 + 2]); if (L0 > cap[g] && L0 > 1e-12) { const f = cap[g] / L0; V[g * 3] *= f; V[g * 3 + 1] *= f; V[g * 3 + 2] *= f; n++; } } return n; };
    // the two limits, by alternating projection: what touches moves together (the contact constraint, position-based with unit masses: the vector of a place equals that of the surface point it rests on, so the gap between them
    // cannot open: layers that rise together keep the gap, a pinched pair (normals opposed) cancels, a held place holds what rests on it), a place never goes against its own outward normal, and nothing rises through the layer above. The last word is the clamp: no penetration.
    const outward = () => { for (let g = 0; g < ng; g++) { const c = V[g * 3] * H.nb[g * 3] + V[g * 3 + 1] * H.nb[g * 3 + 1] + V[g * 3 + 2] * H.nb[g * 3 + 2]; if (c < 0) { V[g * 3] -= c * H.nb[g * 3]; V[g * 3 + 1] -= c * H.nb[g * 3 + 1]; V[g * 3 + 2] -= c * H.nb[g * 3 + 2]; } } };   // cloth lying on a body buckles away from it: a place never goes against its own outward normal (a pinched pair, whose normals are opposed, can only stay flat)
    const rounds = Math.max(1, Math.ceil(O.touch / 3));
    for (let r = 0; r < rounds; r++) { if (con.length) for (let it = 0; it < 3; it++) for (const c of con) { const [a, b, d] = c.q, [wa, wb, wd] = c.w, den = 1 + wa * wa + wb * wb + wd * wd;
          for (let k = 0; k < 3; k++) { const e = V[c.g * 3 + k] - (wa * V[a * 3 + k] + wb * V[b * 3 + k] + wd * V[d * 3 + k]), dl = e / den; V[c.g * 3 + k] -= dl; V[a * 3 + k] += wa * dl; V[b * 3 + k] += wb * dl; V[d * 3 + k] += wd * dl; } }
      outward(); clamps = clampAll(); }
    H.Vg = V; H.rep.clamped = clamps; H.rep.touching = touching; H.part = part; H.con = con; H.rep0 = rep0;
  }
  // ---- 3. the displacement vectors and the change of normal at every host vertex (kept for the riders), then applied to the hosts
  for (const H of hosts) { H.dv = new Float32Array(H.n * 3); H.dn = new Float32Array(H.n * 3); }
  for (const H of active) {
    const P1 = Float32Array.from(H.P); let moved = 0;
    for (let v = 0; v < H.n; v++) { const g = H.grp[v], vx = H.Vg[g * 3], vy = H.Vg[g * 3 + 1], vz = H.Vg[g * 3 + 2]; if (!(Math.hypot(vx, vy, vz) > 1e-9)) continue; moved++;
      for (let k = 0; k < 3; k++) { const w = H.Vg[g * 3 + k]; H.dv[v * 3 + k] = w * H.sc; P1[v * 3 + k] = H.P[v * 3 + k] + w; } }
    const na = groupNormals(P1, H.I, H.grp, H.ng); H.P1 = P1; H.moved = moved;
    for (let v = 0; v < H.n; v++) { const g = H.grp[v]; for (let k = 0; k < 3; k++) H.dn[v * 3 + k] = na[g * 3 + k] - H.nb[g * 3 + k]; }
  }
  // ---- 4. riders: each vertex of a construction mesh takes the displacement of the host surface under it (the nearest triangle within reach)
  const near = grid, rr = O.rider; let ridersMoved = 0, ridersLost = 0;
  for (const m of riders) {
    // a construction mesh of a garment is cut from the garment's cloth (same dye): its host is the nearest surface among the hosts of that colour; thread, buttons and the like (no host of their colour) take the nearest of all
    const dye = hosts.map((H, i) => H.color && H.color === m.userData.k3.color ? i : -1).filter(i => i >= 0), ok = dye.length ? new Set(dye) : null;
    const g = m.geometry, n = g.attributes.position.count, P = g.attributes.position.array, N = g.attributes.normal?.array; let moved = 0;
    const dP = new Float32Array(n * 3), dN = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) { const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], cx = Math.floor(p[0] / near.cell), cy = Math.floor(p[1] / near.cell), cz = Math.floor(p[2] / near.cell); let best = rr * rr, bt = null, bw = null;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const L = near.G.get(near.key(cx + a, cy + b, cz + c)); if (!L) continue;
        for (const id of L) { const T = near.tris[id]; if (ok && !ok.has(T.h)) continue; const r = closestTri(p, T.c9); if (r[0] < best) { best = r[0]; bt = T; bw = r; } } }
      if (!bt) { ridersLost++; continue; }
      const H = hosts[bt.h]; if (!H.P1) continue;
      for (let k = 0; k < 3; k++) { dP[v * 3 + k] = (H.dv[bt.a * 3 + k] * bw[1] + H.dv[bt.b * 3 + k] * bw[2] + H.dv[bt.c * 3 + k] * bw[3]); dN[v * 3 + k] = H.dn[bt.a * 3 + k] * bw[1] + H.dn[bt.b * 3 + k] * bw[2] + H.dn[bt.c * 3 + k] * bw[3]; }
      if (dP[v * 3] || dP[v * 3 + 1] || dP[v * 3 + 2]) moved++; }
    if (!moved) continue;
    const sc = new THREE.Vector3().setFromMatrixScale(m.isSkinnedMesh ? m.bindMatrix : m.matrixWorld).x || 1;
    for (let v = 0; v < n; v++) { for (let k = 0; k < 3; k++) P[v * 3 + k] += dP[v * 3 + k] / sc;
      if (N) { const x = N[v * 3] + dN[v * 3], y = N[v * 3 + 1] + dN[v * 3 + 1], z = N[v * 3 + 2] + dN[v * 3 + 2], l = Math.hypot(x, y, z) || 1; N[v * 3] = x / l; N[v * 3 + 1] = y / l; N[v * 3 + 2] = z / l; } }
    g.attributes.position.needsUpdate = true; if (g.attributes.normal) g.attributes.normal.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere(); m.boundingSphere = null; m.boundingBox = null;   // a skinned mesh's own bounds are recomputed on demand
    m.userData.fold7 = { done: true, rider: true }; ridersMoved++;
  }
  report.riders = ridersMoved; report.ridersUnattached = ridersLost;
  // ---- 5. the hosts: positions, normals (the old normal plus the change the ridges make: any smoothing the dressing put in stays), the crest field of the new surface, the uniform's octave count
  for (const H of hosts) {
    if (!H.P1) { H.m.userData.fold7 = { done: true, nG: 0 }; report.hosts.push(H.rep); continue; }
    const N = H.g.attributes.normal.array, Pn = H.g.attributes.position.array;
    for (let v = 0; v < H.n; v++) { for (let k = 0; k < 3; k++) Pn[v * 3 + k] = H.P1[v * 3 + k];
      const x = N[v * 3] + H.dn[v * 3], y = N[v * 3 + 1] + H.dn[v * 3 + 1], z = N[v * 3 + 2] + H.dn[v * 3 + 2], l = Math.hypot(x, y, z) || 1; N[v * 3] = x / l; N[v * 3 + 1] = y / l; N[v * 3 + 2] = z / l; }
    H.g.attributes.position.needsUpdate = true; H.g.attributes.normal.needsUpdate = true; H.g.computeBoundingBox(); H.g.computeBoundingSphere(); H.m.boundingSphere = null; H.m.boundingBox = null; refreshCrest6(H.m);
    H.m.userData.fold7 = { done: true, nG: H.nG, octaves: H.nO, firstOctave: H.n0 };
    if (O.keep) { H.m.userData.fold7.part = H.part.map(q => q ? Array.from(q) : null); H.m.userData.fold7.grp = H.grp; H.m.userData.fold7.con = H.con.map(c => [c.g, ...c.q, ...c.w]); H.m.userData.fold7.rep0 = H.rep0; }
    if (O.keep) H.m.userData.fold7.heightsMm = Float32Array.from({ length: H.n }, (_, v) => Math.hypot(H.dv[v * 3], H.dv[v * 3 + 1], H.dv[v * 3 + 2]) * 1000);   // for the probe's maps (not kept by default)
    const hs = []; for (let v = 0; v < H.n; v++) { const d = Math.hypot(H.dv[v * 3], H.dv[v * 3 + 1], H.dv[v * 3 + 2]) * 1000; if (d > 0.01) hs.push(d); } hs.sort((a, b) => a - b);
    const ex1 = excess6(H.g.attributes.position.array, H.UV, H.I, H.n, H.sc); let s0 = 0, s1 = 0; for (let v = 0; v < H.n; v++) { s0 += H.ex0[v]; s1 += ex1[v]; }
    Object.assign(H.rep, { split: !!H.m.userData.fold7split, moved: +(H.moved / H.n).toFixed(3), heightMm: { p50: +q(hs, 0.5).toFixed(2), p90: +q(hs, 0.9).toFixed(2), max: +(hs[hs.length - 1] || 0).toFixed(2) },
      excess: { before: +(s0 / H.n).toExponential(3), after: +(s1 / H.n).toExponential(3), absorbed: s0 > 0 ? +(1 - s1 / s0).toFixed(3) : null },
      shareOfExcess: +((() => { let a = 0, b = 0; for (let k = 0; k < H.nO; k++) { const w = Math.pow(H.R, CASCADE_P * k); b += w; if (k >= H.n0) a += w; } return a / b; })()).toFixed(3) });
    report.hosts.push(H.rep);
  }
  for (const H of hosts) delete H.g.userData.f6raw;   // the uncapped strain vector was only for this stage
  report.ms = Math.round((globalThis.performance || Date).now() - t0); return report;
}
