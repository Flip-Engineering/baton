// CLOTH (8 Oct 2026): a position-based cloth for drapes: a sheet over a body (AUTOPSY), a shroud, a banner, a flag. A grid of particles
// with stretch, shear and bend constraints, gravity and air damping, pushed out of spheres, capsules, boxes and a floor with friction.
// Deterministic (fixed step, fixed order), so a frame is a pure function of the colliders' history; resumable (snapshot / restore), so a
// scene settles the drape once and then steps forward frame by frame, re-simulating only when a render starts mid-shot.
//
//   import { Cloth } from '../lib/fx/cloth.js';
//   const cl = new Cloth({ w: 1.4, l: 2.5, nx: 64, nz: 116, at: [0, 1.5, 0] });     // a horizontal sheet, w along x, l along z
//   const C = [{ s: 'capsule', a: [x,y,z], b: [x,y,z], r: 0.1 }, { s: 'box', min: [..], max: [..] }, { s: 'floor', y: 0 }];
//   cl.settle(2.5, C);            // drop it and let it come to rest (seconds of simulated time)
//   const S = cl.snapshot();      // ... later: cl.restore(S); cl.run(t0, t1, t => colliders(t))
//   scene.add(new THREE.Mesh(cl.geometry, material)); cl.sync();   // positions and normals into the geometry
// AUTOPSY 2 (opt-in): a height-field collider, the top surface of a body lying under the cloth, so a drape clears every fold of
// its clothes, not only the capsules (the capsules missed the trousers' thighs by 1 cm and the sheet showed two dark patches):
//   const F = heightField([{ pos, index, keep }], { x0, z0, x1, z1, g: 0.01 });   // pos: world xyz; keep(vertex) drops the moving parts
//   colliders.push({ s: 'height', ...F, depth: 0.04 });       // lifts a particle up to `depth` under the field onto it (+ thick); deeper ones
//                                                             // (the sheet hanging beside the body) are left to the other colliders
import * as THREE from 'three';

export class Cloth {
  constructor({ w = 1.4, l = 2.5, nx = 48, nz = 86, at = [0, 1.5, 0], stretch = 1, shear = 0.6, bend = 0.12, damping = 0.012, gravity = -9.8,
    thick = 0.012, friction = 0.35, dt = 1 / 120, iters = 8 } = {}) {
    Object.assign(this, { w, l, nx, nz, stretch, shear, bend, damping, gravity, thick, friction, dt, iters });
    const N = this.N = (nx + 1) * (nz + 1);
    this.p = new Float32Array(N * 3); this.q = new Float32Array(N * 3); this.inv = new Float32Array(N).fill(1);
    const id = (i, j) => j * (nx + 1) + i;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const k = id(i, j) * 3; this.p[k] = at[0] + (i / nx - 0.5) * w; this.p[k + 1] = at[1]; this.p[k + 2] = at[2] + (j / nz - 0.5) * l;
    }
    this.q.set(this.p); this.t = 0;
    // constraints: [a, b, rest, k] (structural, shear, bend), in a fixed order
    const C = [];
    const add = (a, b, k) => { const A = a * 3, B = b * 3; C.push(a, b, Math.hypot(this.p[A] - this.p[B], this.p[A + 1] - this.p[B + 1], this.p[A + 2] - this.p[B + 2]), k); };
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      if (i < nx) add(id(i, j), id(i + 1, j), stretch); if (j < nz) add(id(i, j), id(i, j + 1), stretch);
      if (i < nx && j < nz) { add(id(i, j), id(i + 1, j + 1), shear); add(id(i + 1, j), id(i, j + 1), shear); }
      if (i < nx - 1) add(id(i, j), id(i + 2, j), bend); if (j < nz - 1) add(id(i, j), id(i, j + 2), bend);
    }
    this.C = new Float32Array(C); this.nc = C.length / 4;
    // the mesh
    const g = this.geometry = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const uv = new Float32Array(N * 2); for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { uv[id(i, j) * 2] = i / nx; uv[id(i, j) * 2 + 1] = j / nz; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const ix = []; for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1); ix.push(a, c, b, b, c, d); }
    g.setIndex(ix); this.sync();
  }
  id(i, j) { return j * (this.nx + 1) + i; }
  pin(k, on = true) { this.inv[k] = on ? 0 : 1; return this; }
  snapshot() { return { p: this.p.slice(), q: this.q.slice(), t: this.t }; }
  restore(s) { this.p.set(s.p); this.q.set(s.q); this.t = s.t; return this; }

  step(colliders) {
    const { p, q, inv, N, dt } = this, damp = 1 - this.damping, g = this.gravity * dt * dt;
    for (let n = 0; n < N; n++) {
      if (!inv[n]) continue; const k = n * 3;
      for (let a = 0; a < 3; a++) { const v = (p[k + a] - q[k + a]) * damp; q[k + a] = p[k + a]; p[k + a] += v; }
      p[k + 1] += g;
    }
    const C = this.C, nc = this.nc;
    for (let it = 0; it < this.iters; it++) {
      for (let c = 0; c < nc; c++) {
        const a = C[c * 4], b = C[c * 4 + 1], rest = C[c * 4 + 2], kk = C[c * 4 + 3], wa = inv[a], wb = inv[b], ws = wa + wb; if (!ws) continue;
        const A = a * 3, B = b * 3, dx = p[B] - p[A], dy = p[B + 1] - p[A + 1], dz = p[B + 2] - p[A + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        if (kk < 1 && d < rest) continue;                                       // shear and bend resist stretching only (cloth buckles freely)
        const s = kk * (d - rest) / (d * ws);
        p[A] += dx * s * wa; p[A + 1] += dy * s * wa; p[A + 2] += dz * s * wa; p[B] -= dx * s * wb; p[B + 1] -= dy * s * wb; p[B + 2] -= dz * s * wb;
      }
      if (it === this.iters - 1 || it % 3 === 2) this._collide(colliders);
    }
    this.t += dt;
  }
  _collide(cols) {
    const { p, q, inv, N, thick } = this, fr = this.friction;
    for (const c of cols) {
      const r = (c.r || 0) + thick;
      for (let n = 0; n < N; n++) {
        if (!inv[n]) continue; const k = n * 3, x = p[k], y = p[k + 1], z = p[k + 2];
        let nx = 0, ny = 0, nz = 0, pen = 0;
        if (c.s === 'floor') { if (y < c.y + thick) { ny = 1; pen = c.y + thick - y; } }
        else if (c.s === 'sphere') { const dx = x - c.c[0], dy = y - c.c[1], dz = z - c.c[2], d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d < r && d > 1e-9) { nx = dx / d; ny = dy / d; nz = dz / d; pen = r - d; } }
        else if (c.s === 'capsule') {
          const ax = c.a[0], ay = c.a[1], az = c.a[2], bx = c.b[0] - ax, by = c.b[1] - ay, bz = c.b[2] - az, L2 = bx * bx + by * by + bz * bz || 1e-9;
          let u = ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
          const dx = x - (ax + bx * u), dy = y - (ay + by * u), dz = z - (az + bz * u), d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < r * r) { const d = Math.sqrt(d2) || 1e-9; nx = dx / d; ny = dy / d; nz = dz / d; pen = r - d; }
        } else if (c.s === 'height') {   // AUTOPSY 2: bilinear in a field dilated by a cell (so it never passes under a sample), inside its footprint
          const fx = (x - c.x0) / c.g - 0.5, fz = (z - c.z0) / c.g - 0.5, i = Math.floor(fx), j = Math.floor(fz);
          if (i >= 0 && j >= 0 && i < c.nx - 1 && j < c.nz - 1) {
            const H = c.h, q = j * c.nx + i, a = H[q], b = H[q + 1], d = H[q + c.nx], e = H[q + c.nx + 1];
            if (a > -1e9 && b > -1e9 && d > -1e9 && e > -1e9) {      // the footprint's rim (the body's sides) is left to the capsules
              const u = fx - i, v = fz - j, h = (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + e * u) * v;
              if (y < h + thick && y > h - (c.depth ?? 0.04)) {      // out along the field's normal, so a slope sheds the particle sideways
                const gx = ((b - a) * (1 - v) + (e - d) * v) / c.g, gz = ((d - a) * (1 - u) + (e - b) * u) / c.g, L = Math.sqrt(gx * gx + 1 + gz * gz);
                nx = -gx / L; ny = 1 / L; nz = -gz / L; pen = (h + thick - y) / L;
              }
            }
          }
        } else if (c.s === 'box') {   // pushed out through the nearest face (top or sides; a cloth never gets under a table top)
          const m0 = c.min, m1 = c.max;
          if (x > m0[0] - thick && x < m1[0] + thick && y > m0[1] - thick && y < m1[1] + thick && z > m0[2] - thick && z < m1[2] + thick) {
            const f = [[m1[1] + thick - y, 0, 1, 0], [x - (m0[0] - thick), -1, 0, 0], [m1[0] + thick - x, 1, 0, 0], [z - (m0[2] - thick), 0, 0, -1], [m1[2] + thick - z, 0, 0, 1]];
            let best = f[0]; for (const e of f) if (e[0] < best[0]) best = e; pen = best[0]; nx = best[1]; ny = best[2]; nz = best[3];
          }
        }
        if (pen > 0) {
          p[k] += nx * pen; p[k + 1] += ny * pen; p[k + 2] += nz * pen;
          q[k] += (p[k] - q[k]) * fr; q[k + 1] += (p[k + 1] - q[k + 1]) * fr; q[k + 2] += (p[k + 2] - q[k + 2]) * fr;   // friction: lose some of the step's motion
        }
      }
    }
  }
  settle(seconds, colliders) { const n = Math.round(seconds / this.dt); for (let i = 0; i < n; i++) this.step(colliders); return this; }
  // step from this.t to t1 with colliders(t) evaluated at each step's time
  run(t1, colliders) { while (this.t < t1 - this.dt * 0.5) this.step(colliders(this.t)); return this; }
  sync() {
    const P = this.geometry.attributes.position; P.array.set(this.p); P.needsUpdate = true; this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere(); return this;
  }
}

// AUTOPSY 2: the height field of a set of triangle meshes seen from above (max y per cell of g metres over [x0, x1] x [z0, z1]),
// dilated by one cell; parts: [{ pos: Float32Array world xyz, index: indices or null (a triangle soup), keep: vertex => bool }]
export function heightField(parts, { x0, z0, x1, z1, g = 0.01, dilate = 1 }) {
  const nx = Math.ceil((x1 - x0) / g) + 1, nz = Math.ceil((z1 - z0) / g) + 1, h0 = new Float32Array(nx * nz).fill(-Infinity);
  const put = (i, j, y) => { if (i >= 0 && j >= 0 && i < nx && j < nz) { const q = j * nx + i; if (y > h0[q]) h0[q] = y; } };
  for (const { pos, index, keep } of parts) {
    const n = pos.length / 3, I = index || Array.from({ length: n }, (_, k) => k);
    for (let v = 0; v < n; v++) if (!keep || keep(v)) put(Math.floor((pos[v * 3] - x0) / g), Math.floor((pos[v * 3 + 2] - z0) / g), pos[v * 3 + 1]);
    for (let t = 0; t + 2 < I.length; t += 3) {
      const A = I[t], B = I[t + 1], C = I[t + 2]; if (keep && !(keep(A) && keep(B) && keep(C))) continue;
      const ax = pos[A * 3], ay = pos[A * 3 + 1], az = pos[A * 3 + 2], bx = pos[B * 3], by = pos[B * 3 + 1], bz = pos[B * 3 + 2], cx = pos[C * 3], cy = pos[C * 3 + 1], cz = pos[C * 3 + 2];
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(den) < 1e-14) continue;
      const i0 = Math.floor((Math.min(ax, bx, cx) - x0) / g), i1 = Math.floor((Math.max(ax, bx, cx) - x0) / g), j0 = Math.floor((Math.min(az, bz, cz) - z0) / g), j1 = Math.floor((Math.max(az, bz, cz) - z0) / g);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * g, pz = z0 + (j + 0.5) * g, l0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, l1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den, l2 = 1 - l0 - l1;
        if (l0 >= -1e-6 && l1 >= -1e-6 && l2 >= -1e-6) put(i, j, l0 * ay + l1 * by + l2 * cy);
      }
    }
  }
  let h = h0;
  for (let r = 0; r < dilate; r++) { const o = new Float32Array(nx * nz).fill(-Infinity);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let m = -Infinity; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < nz && h[b * nx + a] > m) m = h[b * nx + a]; } o[j * nx + i] = m; }
    h = o; }
  return { x0, z0, g, nx, nz, h };
}
