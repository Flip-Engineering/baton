// ANATOMY / FINE / BODY (DETAIL7 iteration 7, 8 Oct 2026): the fine tier on the TORSO: the navel and the nipple-areola complexes. Ours, CC0.
//
// WHY: the body's forms are a displacement of hm08's vertices, 5-7 mm apart on the chest and the abdomen once subdivided. The navel P1's
// detail tier draws there (body/detail.js 'navel': a 7 x 5.5 mm dent, 4 mm deep, at hm08's omphalion) cannot be held by that mesh: on the
// Cycles plates it reads as a pale raised leaf with a dark crescent (the defect hunt's L08-05 / L12-04), where every photograph shows a dark
// pit under a hood with a lit lower wall. And the areola is a smooth disc: the photographs show Montgomery's tubercles, a wrinkled areolar
// skin and a furrowed papilla with a crease at its base (BODY7's NAC7 lays the coarse mound and papilla at nippleAt and leaves these to this
// tier: lib/fx/body/nipple.js, its header).
//
// HOW (the same bake as the face, on LOCAL PATCH CHARTS made per person at bake time, so they follow BODY7's anatomy wherever it puts them):
//   bodyPatches(src, info)   a patch round each anatomical point (the navel at hm08's omphalion as the person's body carries it, each nipple at
//                            BODY7's nippleAt), its vertices flood-filled over the torso within R, projected onto the patch's tangent plane
//                            (true mm, orthographic; folded triangles left off the chart), packed in a band under the head chart
//                            (packBody) at the head chart's own density (0.091 mm a texel at 4096)
//   the NAVEL, SOLVED (c6 iteration 18, navel_soft.js): the umbilical scar tethers the skin to the ring on the linea alba; the fat grows
//     thick round it from childhood, the skin grows where the scar holds it stretched, gravity loads it standing: ANAT8-BODY's soft solver on
//     a block of the abdominal wall at the fine tier's scale gives the wall, the rim, the hood and the ramp. The patch carries the solved skin
//     as a relief; detail.js's under-resolved dent is REPLACED inside its own footprint (the relief minus the mesh's own departure from the
//     abdomen's envelope, a quadric fitted to the ring round it). Iterations 7-16 drew it (a K0 flare, a rolled wall): deleted.
//   the NIPPLE-AREOLA COMPLEX (at BODY7's nippleAt point and areola radius, the same function SKIN7 paints the areola from): Montgomery's
//     tubercles (the areolar glands: women 6-14, men 2-6, more in the outer half of the areola; domes 1-2 mm across, 0.2-0.45 mm proud in
//     women, smaller in men: the anatomy literature's ranges, as recalled), the areolar skin's fine wrinkling (its thin skin over the areolar
//     smooth muscle: a polygonal furrow network 0.75 mm across, 35 um deep, deeper with age), the crease at the papilla's base and the
//     papilla's furrowed surface (lobules ~0.9 mm). The coarse mound and the papilla's projection stay BODY7's.
// No pores or skin network on these patches: the rest of the body has none from this tier yet, and a textured disc would show.
// Everything here is a function of the person's anatomy (BODY7's points, the body's own surface, BMI, sex, age): no per-person numbers.
import { nippleAt } from '../../body/nipple.js';
import { hash32 } from './micro.js';
import { navelTissue, navelSolved, navelAt, prepareNavel, navelKey } from './navel_soft.js';
const navelKeyOf = info => navelKey(navelTissue(info));

export const BODY_FINE_VERSION = 5;   // 5 (c7 iteration 21): the navel reaches Cycles as GEOMETRY (navelGeometry below), not a height along the dent's normals; 4 (c6 iteration 19): the solve's wall (navel_soft v2), no tilt; 3 (c6 iteration 18): the navel SOLVED (navel_soft.js); 2 (c5 iteration 16): the navel's wall rolls over the ring
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const TORSO = 2, PELVIS = 7, OMPHALION = 4121;   // hero.js HERO_REGIONS; hm08's omphalion (assets/body/basis.json landmarks)

export const BODY_FINE = {
  mmPerU: 373,          // chart mm per u: the head chart's own density (head_chart.json: 0.091 mm a texel at 4096 wide)
  gapU: 0.014,          // the gap between islands and under the head chart (u)
  navel: { R: 24, envIn: 12, envOut: 24, replace: [10, 16],   // the patch (mm), the ring the abdomen's envelope is fitted on, the mesh's dent replaced inside
    // (c7 iteration 21) the geometry route (Cycles): the vertices inside fix (mm x k) and those of any triangle the tangent-plane projection
    // turns are FREE (re-embedded), the rest keep their true projection; the surface is the solved skin over [0, w0] and returns to the mesh
    // by w1 (mm, on the embedding's radius); the image over the patch's uv square is px texels a side
    geom: { fix: 16, w: [17, 22.5], px: 512, reweight: 6 } },
  nac: { margin: 5.5, papR: { m: 2.8, f: 5.5 }, crease: { m: 0.15, f: 0.25 }, papCell: { m: 0.6, f: 0.9 }, papD: { m: 0.06, f: 0.1 },
    net: { cell: 0.75, D: 0.035 }, tub: { n: { m: [2, 6], f: [6, 14] }, r: { m: [0.4, 0.65], f: [0.55, 0.95] }, h: { m: [0.12, 0.25], f: [0.22, 0.45] }, band: [0.45, 0.92], gap: 2.4 } },
};

// a 2-D furrow network (Voronoi cell edges): 0 on an edge, ~0.5 in a cell's middle (in units of the cell)
const u01 = x => (x >>> 8) / 16777216;
function cellEdge(x, y, c, seed) {
  const gx = x / c, gy = y / c, ix = Math.floor(gx), iy = Math.floor(gy); let d1 = 9, d2 = 9;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const h = hash32((ix + a) * 73856093 ^ (iy + b) * 19349663 ^ seed);
    const d = Math.hypot(ix + a + u01(h) - gx, iy + b + u01(hash32(h + 1)) - gy); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return d2 - d1;
}
const seedOf = s => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h || 1; };
function rndOf(tag) { let s = seedOf(tag); return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// --------------------------------------------------------------------------------------------------------- the anatomy of each patch
// (c6 iteration 18) THE NAVEL IS SOLVED (navel_soft.js): the umbilical scar tethering the skin to the ring on the linea alba, the fat growing
// thick round it, the skin growing where the scar holds it stretched, gravity: ANAT8-BODY's soft solver on a block of the abdominal wall at
// the fine tier's scale. Iterations 7-16's drawn profile (the K0 flare, the rolled wall, the floor, the knot, the hood term) is deleted (git
// history). navelParams reads the person's solve (prepareBody / prepareNavel first); without one there is no navel patch (never a drawn one).
export function navelParams(info) {
  const T = navelTissue(info), Nv = navelSolved(info);
  return Nv ? { k: T.k, T, Nv, key: Nv.key, rangeMm: Nv.report?.rangeMm, R: Nv.half * Nv.G } : null;
}
export function navelRelief(Q, x, y, d) {
  const N = BODY_FINE.navel, r = Math.hypot(x, y), wEnv = 1 - sst(N.replace[0] * Q.k, N.replace[1] * Q.k, r);   // the mesh's own dent replaced inside its footprint
  return navelAt(Q.Nv, x, y) - wEnv * d;
}
// (c7 iteration 21) THE NAVEL AS GEOMETRY (Cycles). Why: Cycles displaces along the surface's OWN normal. The relief above replaced the mesh's
// own dent (12-14 mm deep on L14 by the i20 log, its walls steep, 9-14 of its triangles overhanging in the tangent plane: projTurned) by a
// height on the patch's tangent plane, and the dent's walls carried that height along their own, nearly horizontal normals: the walls
// crossed, the sheet tore, and the path tracer saw through it into the body (i20 L14: a black hole with pale jagged flaps), while the same
// navel without the tier (the mesh's own) read as a smooth depression. A height field applied along a surface's normals is only a surface
// where that surface is nearly flat. Now, inside the navel, every point of the patch is carried onto the solved skin itself: an EMBEDDING
// phi maps the mesh there injectively to the patch's tangent plane (a Tutte embedding with positive weights: the vertices outside the dent
// keep their true projection and fix the ring, the dent's and every turned triangle's corners are free), and the point goes to
// (phi, Q(phi) + h(phi)): the abdomen's envelope Q (the quadric fitted on the ring round the dent, as before) plus the navel the soft solve
// made. Moved along the patch's ONE normal over an injective map, the result is a graph over the plane: one closed, outward-facing sheet,
// whatever the dent under it was; its floor is lit and shadowed by the path tracer itself. The weights are each edge's stretch onto that
// target (a few passes: Tutte's theorem holds for any positive weights), so the micro-polygons spread over the pit's walls instead of
// bunching on its floor. The engine (shading only, no displacement) keeps the relief above; Cycles takes this (bakeFine's navel band is 0,
// person_scene.py's vector displacement does the rest from navelGeometryMap's image).
export function navelEmbedding({ nv, lx, ly, ldRaw, nb, tris, vi, e, Q, bnd }) {
  const G = BODY_FINE.navel.geom, k = Q.k ?? 1, rFix = G.fix * k;
  const Ht = (x, y) => e[0] + e[1] * x + e[2] * y + e[3] * x * x + e[4] * x * y + e[5] * y * y + navelAt(Q.Nv, x, y);
  const T = tris.map(v => vi.get(v)), nt = T.length / 3, area = (X, Y, t) => { const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2]; return (X[b] - X[a]) * (Y[c] - Y[a]) - (X[c] - X[a]) * (Y[b] - Y[a]); };
  let pos = 0; for (let t = 0; t < nt; t++) if (area(lx, ly, t) > 0) pos++; const s0 = pos * 2 >= nt ? 1 : -1;
  const free = new Uint8Array(nv); let projTurned = 0;
  for (let i = 0; i < nv; i++) if (Math.hypot(lx[i], ly[i]) < rFix) free[i] = 1;
  for (let t = 0; t < nt; t++) if (area(lx, ly, t) * s0 <= 0) { projTurned++; for (let q = 0; q < 3; q++) { const v = T[t * 3 + q]; free[v] = 1; for (const j of nb[v]) free[j] = 1; } }
  for (let i = 0; i < nv; i++) if (bnd && bnd[i]) free[i] = 0;   // the patch's own border stays where the mesh is
  const fx = Float64Array.from(lx), fy = Float64Array.from(ly), Wt = nb.map(s => new Map([...s].map(j => [j, 1])));
  const tutte = its => { for (let it = 0; it < its; it++) for (let i = 0; i < nv; i++) { if (!free[i]) continue; let sx = 0, sy = 0, sw = 0;
    for (const [j, w] of Wt[i]) { sx += w * fx[j]; sy += w * fy[j]; sw += w; } if (sw > 0) { fx[i] = sx / sw; fy[i] = sy / sw; } } };
  const tgt = i => [fx[i], fy[i], Ht(fx[i], fy[i])], stretch = (i, j) => { const a = tgt(i), b = tgt(j), lp = Math.hypot(fx[j] - fx[i], fy[j] - fy[i]); return lp > 1e-6 ? Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / lp : 1; };
  tutte(800);
  for (let p = 0; p < (G.reweight ?? 0); p++) { for (let i = 0; i < nv; i++) for (const j of Wt[i].keys()) Wt[i].set(j, Math.min(10, Math.max(1, stretch(i, j)))); tutte(400); }
  let phiTurned = 0, maxStretch = 0, nFree = 0; for (let t = 0; t < nt; t++) if (area(fx, fy, t) * s0 <= 0) phiTurned++;
  for (let i = 0; i < nv; i++) { if (free[i]) nFree++; for (const j of nb[i]) if (free[i] || free[j]) maxStretch = Math.max(maxStretch, stretch(i, j)); }
  const phi = new Float32Array(nv * 2); for (let i = 0; i < nv; i++) { phi[i * 2] = fx[i]; phi[i * 2 + 1] = fy[i]; }
  let hMin = 0; for (let j = -80; j <= 80; j++) for (let i = -80; i <= 80; i++) hMin = Math.min(hMin, navelAt(Q.Nv, i * 0.3, j * 0.3));
  return { phi, Ht, free, s0, report: { free: nFree, projTurned, phiTurned, maxStretch: +maxStretch.toFixed(2), rFixMm: +rFix.toFixed(1), wMm: G.w.map(x => +(x * k).toFixed(1)), navelDepthMm: +hMin.toFixed(2), reweight: G.reweight ?? 0 } };
}
// the geometry route's image over the navel patch's uv square (packBody's p.uvBox: [u0, v0, su, sv] in the chart's uv), px x px texels:
// R, G the embedding phi (m, the patch's tangent plane), B the target height Q(phi) + h(phi) (m, along n0 from c). Texels outside the patch
// carry their own layout position (radius >= R: past the blend, so nothing moves there, and a face of another island never samples inside).
export function navelGeometryMap(p, px = BODY_FINE.navel.geom.px) {
  const g = p.geo, R = p.R, out = new Float32Array(px * px * 4), cov = new Uint8Array(px * px), vi = new Map(); p.verts.forEach((v, i) => vi.set(v, i));
  const sz = 2 * R / px, ul = p.ul;
  for (let t = 0; t < p.tris.length; t += 3) { const a = vi.get(p.tris[t]), b = vi.get(p.tris[t + 1]), c = vi.get(p.tris[t + 2]);
    const ax = (ul[a * 2] + R) / sz, ay = (ul[a * 2 + 1] + R) / sz, bx = (ul[b * 2] + R) / sz, by = (ul[b * 2 + 1] + R) / sz, cx = (ul[c * 2] + R) / sz, cy = (ul[c * 2 + 1] + R) / sz;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 0.5)), i1 = Math.min(px - 1, Math.ceil(Math.max(ax, bx, cx))), j0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 0.5)), j1 = Math.min(px - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = i + 0.5, y = j + 0.5, w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den, w2 = 1 - w0 - w1;
      if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue; const k = j * px + i; if (cov[k] && (w0 < 0 || w1 < 0 || w2 < 0)) continue;
      const fx = g.phi[a * 2] * w0 + g.phi[b * 2] * w1 + g.phi[c * 2] * w2, fy = g.phi[a * 2 + 1] * w0 + g.phi[b * 2 + 1] * w1 + g.phi[c * 2 + 1] * w2;
      out[k * 4] = fx / 1000; out[k * 4 + 1] = fy / 1000; out[k * 4 + 2] = g.Ht(fx, fy) / 1000; out[k * 4 + 3] = 1; cov[k] = 1; } }
  let n = 0; for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) { const k = j * px + i; if (cov[k]) { n++; continue; }
    const x = (i + 0.5) * sz - R, y = (j + 0.5) * sz - R, r = Math.hypot(x, y), s = r > 1e-6 ? Math.max(1, (R + 1) / r) : 0;
    out[k * 4] = x * s / 1000; out[k * 4 + 1] = (r > 1e-6 ? y * s : R + 1) / 1000; out[k * 4 + 2] = 0; out[k * 4 + 3] = 1; }
  return { px, data: out, covered: +(n / (px * px)).toFixed(4), box: p.uvBox, c: p.c, t1: p.t1, t2: p.t2, n0: p.n0, verts: p.verts, wMm: g.report.wMm, report: g.report };
}
// the person's navel solve (node: solved and cached when missing; the page: the cache). (c6 iteration 19) no tilt: gravity in the abdomen's plane
export async function prepareBody(src, info, o = {}) { if (!src) return null; return prepareNavel(info, o); }
export function nacParams(info, side, rArea) {
  const N = BODY_FINE.nac, sex = info.sex === 'm' ? 'm' : 'f', rnd = rndOf(`${info.name || 'x'}|nac|${side}`), age = info.age ?? 35;
  const ra = rArea, nT = Math.round(N.tub.n[sex][0] + (N.tub.n[sex][1] - N.tub.n[sex][0]) * rnd()), tubs = [];
  for (let i = 0, tries = 0; i < nT && tries < 400; tries++) {
    const b = N.tub.band, rr = ra * Math.sqrt(b[0] * b[0] + (b[1] * b[1] - b[0] * b[0]) * rnd()), a = 2 * Math.PI * rnd(), x = rr * Math.cos(a), y = rr * Math.sin(a);
    if (tubs.some(q => Math.hypot(q[0] - x, q[1] - y) < N.tub.gap)) continue;
    tubs.push([x, y, N.tub.r[sex][0] + (N.tub.r[sex][1] - N.tub.r[sex][0]) * rnd(), N.tub.h[sex][0] + (N.tub.h[sex][1] - N.tub.h[sex][0]) * rnd()]); i++;
  }
  return { sex, ra, rb: N.papR[sex], crease: N.crease[sex], papCell: N.papCell[sex], papD: N.papD[sex], netD: N.net.D * (1 + 0.012 * Math.max(0, age - 30)), netCell: N.net.cell, tubs, seed: seedOf(`${info.name}|nac|${side}`) };
}
export function nacRelief(Q, x, y) {
  const r = Math.hypot(x, y); let h = 0;
  h -= Q.crease * Math.exp(-(((r - Q.rb) / 0.45) ** 2));                                                 // the papilla's base
  if (r < Q.rb + 0.5) { const e = cellEdge(x, y, Q.papCell, Q.seed ^ 0x51); h -= Q.papD * Math.exp(-((e / 0.12) ** 2)) * sst(Q.rb + 0.5, Q.rb - 0.6, r); }   // its lobules
  const inA = sst(Q.rb + 0.2, Q.rb + 1.2, r) * (1 - sst(Q.ra - 1.5, Q.ra + 1.0, r));
  if (inA > 0) { const e = cellEdge(x, y, Q.netCell, Q.seed ^ 0x2c); h -= Q.netD * inA * Math.exp(-((e / 0.1) ** 2)); }               // the areolar skin's wrinkling
  for (const [tx, ty, rt, ht] of Q.tubs) { const dd = Math.hypot(x - tx, y - ty); if (dd < rt) { const q = 1 - (dd / rt) ** 2; h += ht * q * q; } }   // Montgomery's tubercles
  return h;
}

// the distance from p to the triangle abc (Ericson's closest point on a triangle)
function triDist(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2], len = u => Math.hypot(u[0], u[1], u[2]);
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return len(ap);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return len(bp);
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return len(sub(p, [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v])); }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return len(cp);
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return len(sub(p, [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w])); }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return len(sub(p, [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w])); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return len(sub(p, [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]));
}
// --------------------------------------------------------------------------------------------------------- the patches (per person, at bake time)
// src: { P (bind positions, metres, Float32), index (triangles), region (aHero array), rStride (its item size), height (m), sex };
// -> { patches: [{ id, kind, c (m), t1, t2, n0, R (mm), verts, lx, ly, ld, tris, Q }], report }
export function bodyPatches(src, info, o = {}) {
  const { P, index: I, region: RG, rStride = 4 } = src, n = P.length / 3, sex = info.sex === 'm' ? 'm' : 'f';
  const okV = new Uint8Array(n); for (let v = 0; v < n; v++) { const r = RG[v * rStride]; okV[v] = r === TORSO || r === PELVIS ? 1 : 0; }
  // vertex adjacency (CSR) over the triangles
  const deg = new Int32Array(n + 1); for (let i = 0; i < I.length; i += 3) for (let q = 0; q < 3; q++) { deg[I[i + q]] += 2; }
  const off = new Int32Array(n + 1); for (let v = 0; v < n; v++) off[v + 1] = off[v] + deg[v]; const fill = off.slice(0, n), adj = new Int32Array(off[n]);
  for (let i = 0; i < I.length; i += 3) for (let q = 0; q < 3; q++) { const a = I[i + q], b = I[i + (q + 1) % 3], c = I[i + (q + 2) % 3]; adj[fill[a]++] = b; adj[fill[a]++] = c; }
  const at = v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nrm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
  const taken = new Uint8Array(n), out = [], rep = { version: BODY_FINE_VERSION, patches: [] };
  // make(id, kind, c, Rneed (mm), nIn [r0, r1] (mm: the ring whose triangles give the tangent frame), Q): the patch = the torso's triangles
  // that reach within Rneed of the point, connected to it (on a coarse breast, 8-18 mm edges, a disc of whole triangles under-covers the
  // areola: the first try left its upper half off). Its LAYOUT is a Tutte embedding (the boundary on a circle, every inside vertex the mean
  // of its neighbours): no triangle can turn (the projection turned 18 inside L12's navel dent), and the relief is evaluated on the TRUE local
  // coordinates (the tangent-plane projection, lx / ly per vertex), interpolated per texel, never on the layout.
  const make = (id, kind, c, Rneed, nIn, Q) => {
    const R = Rneed / 1000; let v0 = -1, bd = 1e9;
    for (let v = 0; v < n; v++) if (okV[v] && deg[v]) { const d = Math.hypot(P[v * 3] - c[0], P[v * 3 + 1] - c[1], P[v * 3 + 2] - c[2]); if (d < bd) { bd = d; v0 = v; } }
    if (v0 < 0 || bd > 0.02) { rep.patches.push({ id, skipped: 'no torso vertex within 20 mm' }); return; }
    const dist = v => Math.hypot(P[v * 3] - c[0], P[v * 3 + 1] - c[1], P[v * 3 + 2] - c[2]);
    // the triangles touching the ball of radius R round the point (their closest point within R: on L12's breast the triangles are 9-18 mm
    // across and one with no corner within 24 mm covers the areola's upper half), all corners torso / pelvis and in no other patch, connected
    const triOk = new Uint8Array(I.length / 3); for (let t = 0; t < I.length / 3; t++) { const a = I[t * 3], b = I[t * 3 + 1], cc = I[t * 3 + 2];
      if (!okV[a] || !okV[b] || !okV[cc] || taken[a] || taken[b] || taken[cc]) continue;
      if (Math.min(dist(a), dist(b), dist(cc)) <= R || triDist(c, at(a), at(b), at(cc)) <= R) triOk[t] = 1; }
    const vt = new Map(); for (let t = 0; t < triOk.length; t++) if (triOk[t]) for (let q = 0; q < 3; q++) { const v = I[t * 3 + q]; (vt.get(v) || vt.set(v, []).get(v)).push(t); }
    const inT = new Uint8Array(triOk.length), stack = [...(vt.get(v0) || [])]; stack.forEach(t => { inT[t] = 1; });
    while (stack.length) { const t = stack.pop(); for (let q = 0; q < 3; q++) for (const u of vt.get(I[t * 3 + q]) || []) if (!inT[u]) { inT[u] = 1; stack.push(u); } }
    const tris = []; for (let t = 0; t < inT.length; t++) if (inT[t]) tris.push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2]);
    if (tris.length < 9) { rep.patches.push({ id, skipped: 'fewer than 3 triangles' }); return; }
    const used = new Set(tris), verts = Int32Array.from([...used].sort((p, q) => p - q)), vi = new Map(); verts.forEach((v, i) => vi.set(v, i));
    // the tangent frame: the area-weighted normal of the triangles with a corner in the ring nIn (outward = +z in the bind)
    let N0 = [0, 0, 0];
    for (let i = 0; i < tris.length; i += 3) { const a = tris[i], b = tris[i + 1], cc = tris[i + 2], r = Math.min(dist(a), dist(b), dist(cc)) * 1000; if (r > nIn[1] || Math.max(dist(a), dist(b), dist(cc)) * 1000 < nIn[0]) continue;
      const pa = at(a), cr = cross(sub(at(b), pa), sub(at(cc), pa)); N0 = [N0[0] + cr[0], N0[1] + cr[1], N0[2] + cr[2]]; }
    let n0 = nrm(N0); if (n0[2] < 0) n0 = n0.map(x => -x);
    const t1 = nrm(sub([1, 0, 0], n0.map(x => x * n0[0]))), t2 = cross(n0, t1);
    const nv = verts.length, lx = new Float32Array(nv), ly = new Float32Array(nv), ld = new Float32Array(nv);
    verts.forEach((v, i) => { const d = sub(at(v), c); lx[i] = dot(d, t1) * 1000; ly[i] = dot(d, t2) * 1000; ld[i] = dot(d, n0) * 1000; });
    // the layout (Tutte): the boundary loop on a circle of radius Rneed (by its projected angle, kept in order), the inside relaxed
    const ec = new Map(), ek = (a, b) => a < b ? a * 4194304 + b : b * 4194304 + a, nb = Array.from({ length: nv }, () => new Set());
    for (let i = 0; i < tris.length; i += 3) for (let q = 0; q < 3; q++) { const a = tris[i + q], b = tris[i + (q + 1) % 3]; ec.set(ek(a, b), (ec.get(ek(a, b)) || 0) + 1); nb[vi.get(a)].add(vi.get(b)); nb[vi.get(b)].add(vi.get(a)); }
    const bnb = new Map(); for (const [kk, m] of ec) if (m === 1) { const a = Math.floor(kk / 4194304), b = kk % 4194304; (bnb.get(a) || bnb.set(a, []).get(a)).push(b); (bnb.get(b) || bnb.set(b, []).get(b)).push(a); }
    const loops = [], seen = new Set(); for (const s0 of bnb.keys()) { if (seen.has(s0)) continue; const L = [s0]; seen.add(s0); let cur = s0;
      for (;;) { const nx = (bnb.get(cur) || []).find(x => !seen.has(x)); if (nx == null) break; seen.add(nx); L.push(nx); cur = nx; } loops.push(L); }
    loops.sort((p, q) => q.length - p.length); const outer = loops[0] || [], fixed = new Uint8Array(nv);
    const ux = new Float64Array(nv), uy = new Float64Array(nv);
    verts.forEach((v, i) => { ux[i] = lx[i]; uy[i] = ly[i]; });
    if (outer.length >= 3) {   // the loop's own order, by cumulative projected arc length, round the circle in the direction it turns
      const L = outer.map(v => vi.get(v)); let area = 0; for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; area += lx[a] * ly[b] - lx[b] * ly[a]; }
      const sg = area >= 0 ? 1 : -1, a0 = Math.atan2(ly[L[0]], lx[L[0]]); let acc = 0; const seg = L.map((a, i) => { const b = L[(i + 1) % L.length]; return Math.hypot(lx[b] - lx[a], ly[b] - ly[a]); }), tot = seg.reduce((p, q) => p + q, 0) || 1;
      L.forEach((a, i) => { const th = a0 + sg * 2 * Math.PI * acc / tot; ux[a] = Rneed * Math.cos(th); uy[a] = Rneed * Math.sin(th); fixed[a] = 1; acc += seg[i]; }); }
    for (let it = 0; it < 600; it++) for (let i = 0; i < nv; i++) { if (fixed[i] || !nb[i].size) continue; let sx = 0, sy = 0; for (const j of nb[i]) { sx += ux[j]; sy += uy[j]; } ux[i] = sx / nb[i].size; uy[i] = sy / nb[i].size; }
    let pos = 0, neg = 0, projTurned = 0; for (let i = 0; i < tris.length; i += 3) { const a = vi.get(tris[i]), b = vi.get(tris[i + 1]), cc = vi.get(tris[i + 2]);
      const a2 = (ux[b] - ux[a]) * (uy[cc] - uy[a]) - (ux[cc] - ux[a]) * (uy[b] - uy[a]), p2 = (lx[b] - lx[a]) * (ly[cc] - ly[a]) - (lx[cc] - lx[a]) * (ly[b] - ly[a]);
      if (a2 > 0) pos++; else neg++; if (p2 * (a2 || 1) < 0) projTurned++; }
    const turned = Math.min(pos, neg);   // the layout's turned triangles (0 when the embedding holds); projTurned: those the projection alone would turn
    // the navel: the mesh's own departure from the abdomen's envelope (a quadric fitted to the ring envIn..envOut), SMOOTHED onto a 0.5 mm grid
    // (Gaussian kernel regression, sigma 0.6 of the mesh's edge): the per-vertex values interpolated linearly gave a faceted normal (iteration 7's
    // first node relief: rays along the triangle edges), while the engine shades the mesh with smooth normals and Cycles renders its CC limit
    let env = null, dGrid = null, geo = null; const ldRaw = ld.slice();
    if (kind === 'navel') { const N = BODY_FINE.navel, M = Array.from({ length: 6 }, () => new Float64Array(7));
      for (let i = 0; i < nv; i++) { const r = Math.hypot(lx[i], ly[i]); if (r < N.envIn * Q.k || r > N.envOut * Q.k) continue; const x = lx[i], y = ly[i], f = [1, x, y, x * x, x * y, y * y];
        for (let p = 0; p < 6; p++) { for (let q = 0; q < 6; q++) M[p][q] += f[p] * f[q]; M[p][6] += f[p] * ld[i]; } }
      for (let p = 0; p < 6; p++) M[p][p] += 1e-6;
      for (let p = 0; p < 6; p++) { let m = p; for (let q = p + 1; q < 6; q++) if (Math.abs(M[q][p]) > Math.abs(M[m][p])) m = q; [M[p], M[m]] = [M[m], M[p]];
        for (let q = 0; q < 6; q++) if (q !== p) { const f = M[q][p] / M[p][p]; for (let w = p; w < 7; w++) M[q][w] -= f * M[p][w]; } }
      const e = M.map((row, p) => row[6] / row[p]); let dmin = 0, dmax = 0, el = [];
      for (let i = 0; i < nv; i++) { const x = lx[i], y = ly[i]; ld[i] -= e[0] + e[1] * x + e[2] * y + e[3] * x * x + e[4] * x * y + e[5] * y * y; dmin = Math.min(dmin, ld[i]); dmax = Math.max(dmax, ld[i]); }
      for (let i = 0; i < tris.length; i += 3) { const a = vi.get(tris[i]), b = vi.get(tris[i + 1]); el.push(Math.hypot(lx[b] - lx[a], ly[b] - ly[a])); } el.sort((p, q) => p - q);
      const sig = 0.6 * (el[el.length >> 1] || 4), G = 0.5, half = Math.ceil(Rneed / G) + 2, gw = 2 * half + 1, gd = new Float32Array(gw * gw);
      for (let j = 0; j < gw; j++) for (let i = 0; i < gw; i++) { const x = (i - half) * G, y = (j - half) * G; let sw = 0, sd = 0;
        for (let q = 0; q < nv; q++) { const dd = (lx[q] - x) ** 2 + (ly[q] - y) ** 2; if (dd > 9 * sig * sig) continue; const w = Math.exp(-dd / (2 * sig * sig)); sw += w; sd += w * ld[q]; }
        gd[j * gw + i] = sw > 1e-6 ? sd / sw : 0; }
      dGrid = { G, half, gw, gd }; env = { coef: e.map(x => +x.toFixed(5)), dMm: [+dmin.toFixed(2), +dmax.toFixed(2)], sigmaMm: +sig.toFixed(2) };
      const bnd = new Uint8Array(nv); for (const v of bnb.keys()) bnd[vi.get(v)] = 1;
      geo = navelEmbedding({ nv, lx, ly, ldRaw, nb, tris, vi, e, Q, bnd }); }
    else ld.fill(0);
    for (const v of verts) taken[v] = 1;
    const ul = new Float32Array(nv * 2); for (let i = 0; i < nv; i++) { ul[i * 2] = ux[i]; ul[i * 2 + 1] = uy[i]; }
    const p = { id, kind, c, t1, t2, n0, R: Rneed, verts, lx, ly, ld, ul, dGrid, geo, tris: Uint32Array.from(tris), Q };
    out.push(p); rep.patches.push({ id, kind, verts: nv, tris: tris.length / 3, turned, projTurned, loops: loops.length, R: Rneed, c: c.map(x => +x.toFixed(4)), n0: n0.map(x => +x.toFixed(3)), env, geo: geo ? geo.report : undefined, params: kind === 'navel' ? { key: Q.key, T: Q.T, rangeMm: Q.rangeMm } : { ...Q, tubs: Q.tubs ? Q.tubs.length : undefined, am: undefined, seed: undefined } });
  };
  if (o.navel !== false) { const Q = navelParams(info);
    if (Q) make('navel', 'navel', at(OMPHALION), Q.R, [BODY_FINE.navel.envIn * Q.k, BODY_FINE.navel.envOut * Q.k], Q);
    else rep.patches.push({ id: 'navel', skipped: `no solved navel for this person (key ${navelKeyOf(info)}): prepareBody() first (node solves it; the page reads assets/person/fine7/navel/)` }); }
  if (o.nac !== false) {
    const hh = { body: { geometry: { attributes: { position: { array: P, count: n }, aHero: { array: RG, itemSize: rStride } }, index: { array: I } } }, o: { height: src.height }, sex };
    const NA = nippleAt(hh, { sex, scale: 1, stature: src.height }); rep.nippleAt = { source: NA?.source, r: NA?.r, check: NA?.check };
    if (NA) for (const side of ['L', 'R']) { const Q = nacParams(info, side, NA.r * 1000); make('nac_' + side, 'nac', NA[side], Q.ra + BODY_FINE.nac.margin, [0, 12], Q); }
  }
  return { patches: out, report: rep };
}

// packBody(K, aspect, B): the patches appended to the head chart K (a new K: uv, on, tris, part per vertex), in a band under it, at the head
// chart's density. -> { K, aspect, BP } (BP for bakeFine: { t0, triPatch, PL (x, y, d per vertex, mm), relief(pid, x, y, d) })
// o.navelGeom (c7 iteration 21, Cycles): the navel goes to the render as geometry (navelGeometryMap), so its relief in the maps is 0
export function packBody(K, aspect, B, po = {}) {
  const F = BODY_FINE, n = K.n, gap = F.gapU, sideU = B.patches.map(p => 2 * p.R / F.mmPerU), band = Math.max(0, ...sideU);
  if (!B.patches.length) return { K, aspect, BP: null };
  const asp2 = aspect + gap + band + gap, v0 = aspect + gap, uv = new Float32Array(n * 2), on = new Uint8Array(n), part = new Uint8Array(n), PL = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) { uv[v * 2] = K.uv[v * 2]; uv[v * 2 + 1] = K.uv[v * 2 + 1] * aspect / asp2; on[v] = K.on[v]; }
  let u0 = gap; const tris = [K.tris], triPatch = []; let nt = 0;
  B.patches.forEach((p, pi) => {
    const s = 2 * p.R / F.mmPerU;
    p.verts.forEach((v, i) => { if (on[v]) return; uv[v * 2] = u0 + (p.ul[i * 2] + p.R) / F.mmPerU; uv[v * 2 + 1] = (v0 + (p.ul[i * 2 + 1] + p.R) / F.mmPerU) / asp2; on[v] = 1; part[v] = pi + 1; PL[v * 3] = p.lx[i]; PL[v * 3 + 1] = p.ly[i]; PL[v * 3 + 2] = p.ld[i]; });
    const T = []; for (let i = 0; i < p.tris.length; i += 3) { const a = p.tris[i], b = p.tris[i + 1], c = p.tris[i + 2]; if (part[a] === pi + 1 && part[b] === pi + 1 && part[c] === pi + 1) { T.push(a, b, c); triPatch.push(pi); } }
    p.uvBox = [u0, v0 / asp2, s, s / asp2];   // (c7 iteration 21) the patch's square in the chart's uv (navelGeometryMap's image covers it)
    tris.push(Uint32Array.from(T)); nt += T.length; u0 += s + gap; });
  if (u0 > 1) throw new Error(`fine7 body: the patches need ${u0.toFixed(3)} u of the band (> 1)`);
  const all = new Uint32Array(K.tris.length + nt); let o = 0; for (const t of tris) { all.set(t, o); o += t.length; }
  const K2 = { ...K, uv, on, tris: all, part, n };
  const BP = { t0: K.tris.length / 3, triPatch: Int32Array.from(triPatch), PL, patches: B.patches,
    navelGeom: !!po.navelGeom,
    relief: (pi, x, y) => { const p = B.patches[pi]; return p.kind === 'navel' ? (po.navelGeom && p.geo ? 0 : navelRelief(p.Q, x, y, gridAt(p.dGrid, x, y))) : nacRelief(p.Q, x, y); } };
  return { K: K2, aspect: asp2, BP };
}
function gridAt(D, x, y) {   // bilinear on the smoothed departure grid (mm); 0 outside
  if (!D) return 0; const fx = x / D.G + D.half, fy = y / D.G + D.half, i = Math.floor(fx), j = Math.floor(fy); if (i < 0 || j < 0 || i >= D.gw - 1 || j >= D.gw - 1) return 0;
  const tx = fx - i, ty = fy - j, g = D.gd, w = D.gw; return (g[j * w + i] * (1 - tx) + g[j * w + i + 1] * tx) * (1 - ty) + (g[(j + 1) * w + i] * (1 - tx) + g[(j + 1) * w + i + 1] * tx) * ty;
}
// the body source for bodyPatches from a hero (the engine, node tests)
export function bodySource(h) {
  const g = h.body.geometry, A = g.attributes.aHero;
  return { P: g.attributes.position.array, index: g.index.array, region: A.array, rStride: A.itemSize, height: h.o?.height ?? 1.7 };
}
