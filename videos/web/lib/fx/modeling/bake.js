// MODELING bake (MODELING studio, cycle 1): per-vertex ambient occlusion, edge convexity and part ids, baked once from
// the finished model so wear can be driven by where use really goes (edges the hands and chains hit, cavities where grime
// sits, one mask per part) instead of by world-space noise that vanishes at feed size.
//
//   const asset = { parts: [{ name: 'housing', mat: 'cast', geo }, ...] };
//   bakeAsset(asset, { maxEdge: 0.25, rays: 32, maxDist: 1.5 });     // sets geo.attributes.color = (ao, convex, partId/255)
//
// COLOR_0 layout (read by materials.js `wearMaterial`): r = AO (1 open .. 0 closed), g = convex edge (0..1, a chalking /
// chipping mask), b = part id / 255 (the part index in asset.parts, for per-part paint, rust and stencils).
// Pure JS: runs in Node (scripts/model_build.mjs) with no GPU. A small median-split BVH; any-hit rays.
import * as THREE from 'three';

// ---- tessellate so per-vertex values have somewhere to vary: split triangles until every edge <= maxEdge (metres)
export function subdivide(geo, maxEdge = 0.3, maxTris = 400000) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const P = g.attributes.position.array, N = g.attributes.normal ? g.attributes.normal.array : null, U = g.attributes.uv ? g.attributes.uv.array : null;
  let pos = [], nor = [], uv = [];
  const push = (a, b, c, na, nb, nc, ua, ub, uc, depth) => {
    const ab = dist(a, b), bc = dist(b, c), ca = dist(c, a), mx = Math.max(ab, bc, ca);
    if (mx <= maxEdge || depth > 7 || pos.length / 9 > maxTris) { pos.push(...a, ...b, ...c); if (N) nor.push(...na, ...nb, ...nc); if (U) uv.push(...ua, ...ub, ...uc); return; }
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
    const nmid = (p, q) => { const m = mid(p, q), l = Math.hypot(...m) || 1; return [m[0] / l, m[1] / l, m[2] / l]; };
    const umid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (mx === ab) { const m = mid(a, b), nm = N ? nmid(na, nb) : null, um = U ? umid(ua, ub) : null;
      push(a, m, c, na, nm, nc, ua, um, uc, depth + 1); push(m, b, c, nm, nb, nc, um, ub, uc, depth + 1); }
    else if (mx === bc) { const m = mid(b, c), nm = N ? nmid(nb, nc) : null, um = U ? umid(ub, uc) : null;
      push(a, b, m, na, nb, nm, ua, ub, um, depth + 1); push(a, m, c, na, nm, nc, ua, um, uc, depth + 1); }
    else { const m = mid(c, a), nm = N ? nmid(nc, na) : null, um = U ? umid(uc, ua) : null;
      push(a, b, m, na, nb, nm, ua, ub, um, depth + 1); push(m, b, c, nm, nb, nc, um, ub, uc, depth + 1); }
  };
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  for (let i = 0; i < P.length; i += 9) {
    const a = [P[i], P[i + 1], P[i + 2]], b = [P[i + 3], P[i + 4], P[i + 5]], c = [P[i + 6], P[i + 7], P[i + 8]];
    const j = i / 9 * 6, k = i;
    push(a, b, c, N ? [N[k], N[k + 1], N[k + 2]] : null, N ? [N[k + 3], N[k + 4], N[k + 5]] : null, N ? [N[k + 6], N[k + 7], N[k + 8]] : null,
      U ? [U[j], U[j + 1]] : null, U ? [U[j + 2], U[j + 3]] : null, U ? [U[j + 4], U[j + 5]] : null, 0);
  }
  const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (N) o.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); if (U) o.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return o;
}

// ---- BVH over all triangles of the asset
class BVH {
  constructor(tris /* Float32Array 9 per tri */) {
    this.t = tris; const n = tris.length / 9; this.n = n;
    const cen = new Float32Array(n * 3); for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) cen[i * 3 + k] = (tris[i * 9 + k] + tris[i * 9 + 3 + k] + tris[i * 9 + 6 + k]) / 3;
    this.idx = Uint32Array.from({ length: n }, (_, i) => i); this.nodes = [];
    this.build(0, n, cen);
  }
  build(lo, hi, cen) {
    const id = this.nodes.length, T = this.t; const nd = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], l: -1, r: -1, lo, hi }; this.nodes.push(nd);
    for (let i = lo; i < hi; i++) { const t = this.idx[i] * 9; for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) { const x = T[t + v * 3 + k]; if (x < nd.min[k]) nd.min[k] = x; if (x > nd.max[k]) nd.max[k] = x; } }
    if (hi - lo <= 6) return id;
    const ext = [0, 1, 2].map(k => nd.max[k] - nd.min[k]); const ax = ext[0] > ext[1] ? (ext[0] > ext[2] ? 0 : 2) : (ext[1] > ext[2] ? 1 : 2);
    const sub = Array.from(this.idx.subarray(lo, hi)).sort((a, b) => cen[a * 3 + ax] - cen[b * 3 + ax]); this.idx.set(sub, lo);
    const mid = (lo + hi) >> 1; nd.l = this.build(lo, mid, cen); nd.r = this.build(mid, hi, cen); return id;
  }
  // any hit within tmax along (o, d)
  anyHit(ox, oy, oz, dx, dy, dz, tmax) {
    const idx = this.idx, T = this.t, nodes = this.nodes, stack = [0], ix = 1 / (dx || 1e-12), iy = 1 / (dy || 1e-12), iz = 1 / (dz || 1e-12);
    let best = -1;
    while (stack.length) {
      const nd = nodes[stack.pop()];
      let t0 = 0, t1 = tmax;
      let a = (nd.min[0] - ox) * ix, b = (nd.max[0] - ox) * ix; if (a > b) { const c = a; a = b; b = c; } t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      a = (nd.min[1] - oy) * iy; b = (nd.max[1] - oy) * iy; if (a > b) { const c = a; a = b; b = c; } t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      a = (nd.min[2] - oz) * iz; b = (nd.max[2] - oz) * iz; if (a > b) { const c = a; a = b; b = c; } t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) continue;
      if (nd.l < 0) {
        for (let i = nd.lo; i < nd.hi; i++) {
          const t = idx[i] * 9;
          const ax = T[t], ay = T[t + 1], az = T[t + 2], e1x = T[t + 3] - ax, e1y = T[t + 4] - ay, e1z = T[t + 5] - az, e2x = T[t + 6] - ax, e2y = T[t + 7] - ay, e2z = T[t + 8] - az;
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-12) continue; const inv = 1 / det, sx = ox - ax, sy = oy - ay, sz = oz - az;
          const u = (sx * px + sy * py + sz * pz) * inv; if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * inv; if (tt > 1e-4 && tt < tmax) { if (best < 0 || tt < best) best = tt; return best; }
        }
      } else { stack.push(nd.l, nd.r); }
    }
    return best;
  }
}

const hammersley = (i, n) => { let b = i, r = 0, f = 0.5; while (b) { r += f * (b & 1); b >>= 1; f *= 0.5; } return [i / n, r]; };

// AO ray rotation seed (GRAPHICS 4.C, 8 Oct). 'index' (the default, unchanged): the vertex index, as the 29 Sep catalogue
// was baked; coincident vertices got different AO, could not weld, and LOD1 kept 61-91% of LOD0. 'position' (opt-in, the
// weld generation: model_build --gen weld): hashed from the vertex's quantised position (0.1 mm) and normal (the 1/127
// steps the glb stores), and one AO value per such key, so the coincident vertices of this non-indexed mesh bake the same
// COLOR_0, weld, and let meshoptimizer collapse them. The default stays 'index' so a plain rebuild reproduces the
// published files (EVERY DOLLAR v3 and MECHA load them) until the weld generation is promoted on its farm A/B.
const seedOf = (qx, qy, qz, nx, ny, nz) => {
  let h = 0x811c9dc5;
  for (const v of [qx, qy, qz, nx, ny, nz]) { h = Math.imul(h ^ (v & 0xffff), 0x01000193); h = Math.imul(h ^ ((v >>> 16) & 0xffff), 0x01000193); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return (h >>> 0) / 4294967296;
};

export function bakeAsset(asset, { maxEdge = 0.25, rays = 32, maxDist = 1.5, edgeAngle = 24, ao = true, aoSeed = 'index' } = {}) {
  // 1. tessellate every part; 2. collect world triangles; 3. AO per vertex; 4. convex edges; 5. part id -> color attribute
  asset.parts.forEach((p, i) => { p.geo = subdivide(p.geo, p.maxEdge ?? maxEdge); p.id = i; });
  let total = 0; for (const p of asset.parts) total += p.geo.attributes.position.count / 3;
  const tris = new Float32Array(total * 9); let o = 0;
  for (const p of asset.parts) { tris.set(p.geo.attributes.position.array, o); o += p.geo.attributes.position.array.length; }
  const bvh = ao ? new BVH(tris) : null;
  for (const p of asset.parts) {
    const g = p.geo, pa = g.attributes.position.array, na = g.attributes.normal.array, n = pa.length / 3, col = new Float32Array(n * 3);
    // welded adjacency for convexity: key each vertex by position
    const key = (i) => `${Math.round(pa[i * 3] * 1e4)},${Math.round(pa[i * 3 + 1] * 1e4)},${Math.round(pa[i * 3 + 2] * 1e4)}`;
    const edges = new Map(), fn = [];
    for (let t = 0; t < n / 3; t++) {
      const a = t * 3, b = a + 1, c = a + 2; const ux = pa[b * 3] - pa[a * 3], uy = pa[b * 3 + 1] - pa[a * 3 + 1], uz = pa[b * 3 + 2] - pa[a * 3 + 2];
      const vx = pa[c * 3] - pa[a * 3], vy = pa[c * 3 + 1] - pa[a * 3 + 1], vz = pa[c * 3 + 2] - pa[a * 3 + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; fn.push([nx / l, ny / l, nz / l]);
      const ks = [key(a), key(b), key(c)];
      for (const [i, j, opp] of [[0, 1, c], [1, 2, a], [2, 0, b]]) { const k = ks[i] < ks[j] ? ks[i] + '|' + ks[j] : ks[j] + '|' + ks[i]; (edges.get(k) || edges.set(k, []).get(k)).push([t, opp, i === 0 ? a : i === 1 ? b : c, j === 0 ? a : j === 1 ? b : c]); }
    }
    const conv = new Map();
    for (const [, fs] of edges) {
      if (fs.length !== 2) continue; const [f1, f2] = fs, n1 = fn[f1[0]], n2 = fn[f2[0]];
      const ang = Math.acos(Math.min(1, Math.max(-1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]))) * 180 / Math.PI; if (ang < edgeAngle) continue;
      const a = f1[2], oppv = f2[1]; const dx = pa[oppv * 3] - pa[a * 3], dy = pa[oppv * 3 + 1] - pa[a * 3 + 1], dz = pa[oppv * 3 + 2] - pa[a * 3 + 2];
      const convex = dx * n1[0] + dy * n1[1] + dz * n1[2] < 0; const val = convex ? Math.min(1, ang / 90) : 0;
      for (const v of [f1[2], f1[3]]) { const k = key(v); conv.set(k, Math.max(conv.get(k) || 0, val)); }
    }
    const byIndex = aoSeed === 'index', memo = new Map();
    for (let i = 0; i < n; i++) {
      let occ = 0;
      if (ao) {
        const nx = na[i * 3], ny = na[i * 3 + 1], nz = na[i * 3 + 2];
        let mk = null, rot;
        if (byIndex) rot = ((i * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
        else {
          const q8 = x => Math.round(Math.max(-1, Math.min(1, x)) * 127);
          const q = [Math.round(pa[i * 3] * 1e4), Math.round(pa[i * 3 + 1] * 1e4), Math.round(pa[i * 3 + 2] * 1e4), q8(nx), q8(ny), q8(nz)];
          mk = q.join(','); if (memo.has(mk)) occ = memo.get(mk); else rot = seedOf(...q) * Math.PI * 2;
        }
        if (rot !== undefined) {
          const ux = Math.abs(nx) > 0.9 ? 0 : 1, uy = Math.abs(nx) > 0.9 ? 1 : 0; // tangent frame
          let tx = uy * nz, ty = -ux * nz, tz = ux * ny - uy * nx; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
          const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
          for (let r = 0; r < rays; r++) {
            const [u, v] = hammersley(r, rays), phi = 2 * Math.PI * u + rot, cz = Math.sqrt(1 - v), sz = Math.sqrt(v);
            const dx = (Math.cos(phi) * sz) * tx + (Math.sin(phi) * sz) * bx + cz * nx, dy = (Math.cos(phi) * sz) * ty + (Math.sin(phi) * sz) * by + cz * ny, dz = (Math.cos(phi) * sz) * tz + (Math.sin(phi) * sz) * bz + cz * nz;
            const h = bvh.anyHit(pa[i * 3] + nx * 0.004, pa[i * 3 + 1] + ny * 0.004, pa[i * 3 + 2] + nz * 0.004, dx, dy, dz, maxDist);
            if (h > 0) occ += 1 - h / maxDist;
          }
          occ /= rays; if (mk !== null) memo.set(mk, occ);
        }
      }
      col[i * 3] = 1 - occ; col[i * 3 + 1] = conv.get(key(i)) || 0; col[i * 3 + 2] = p.id / 255;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return asset;
}
