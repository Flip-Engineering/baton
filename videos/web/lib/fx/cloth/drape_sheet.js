// DRAPE (CLOTHINT, round 7, 8 Oct 2026): main's grid cloth (lib/fx/cloth.js: a sheet over a body, a shroud, a banner, a flag) on the studio's
// garment solver. SAME API, so a scene switches by one import line:
//
//   import { Cloth } from '../lib/fx/cloth.js';               ->   import { Cloth } from '../lib/fx/cloth/drape_sheet.js';     // (or { Drape })
//
// The name: lib/fx/cloth/drape.js is CLOTHING c1's drapeHero (hero.js and person/index.js import it), so this file is drape_sheet.js.
//
// What is the same as main's Cloth (constructor options and defaults, methods, fields): new Drape({ w, l, nx, nz, stretch, shear, bend, damping,
// gravity, thick, friction, dt, iters, at }), id(i, j), pin(k, on), snapshot(), restore(s), step(colliders), settle(seconds, colliders),
// run(t1, t => colliders), sync(), geometry (BufferGeometry: position, uv in [0,1], the same index winding), p / q (Float32Array positions now / one
// step ago), inv (1 free, 0 pinned), N, t. Colliders: { s: 'sphere', c, r } | { s: 'capsule', a, b, r } | { s: 'box', min, max } | { s: 'floor', y },
// pushed out at r + thick, with friction, as main's; plus, for Drape only, { s: 'mesh', mesh, gap } (below).
//
// What is different underneath (the reasons are in review/studio_clothing_c2/after/clothint/NOTES.md):
//   * the solver is xpbd.js: XPBD with small steps, `sub` (6) substeps per dt (720 Hz), each with `stretchIters` (2) stretch iterations; a long chain of stiff
//     edges converges slowly, the stretch error falls about with the square of the substep (drape_test: 3 -> 6 substeps cut the 99th percentile edge strain 12 % -> 4.6 %). Edge stretch from the
//     fabric's warp / weft / bias moduli (warp along the sheet's length l; compression softer so it buckles), dihedral bending from the fabric's KES B
//     (Bridson et al. 2003): the fabric's bending length c sets the fold scale, not the grid and an iteration count. `iters` is accepted and ignored.
//   * stretch / shear / bend are scales on the fabric's own stiffness, relative to main's defaults (1 / 0.6 / 0.12 = the fabric as measured): bend: 0.24
//     is a fabric twice as stiff in bending, as in main's 0..1 factors but with units behind it. `fabric:` picks the fabric (default 'cotton'; 'linen',
//     'canvas', 'wool', or a fabrics.js name or record: drape_fabrics.js). `damping` is main's per-step fraction, kept (as a rate: -ln(1-d)/dt).
//   * self-collision: CLOTH6's Self6 (vertex-face and edge-edge proximity with locked sides and a continuous check), so a fold that doubles over
//     keeps its layers in order. `self: false` switches it off. Cloth thickness sets the layer gap (th = 1.5 x the fabric's thickness, at least 1.2 mm). The pair list is refreshed when a particle has moved 0.4 x `selfMargin` (8 mm) since the last refresh: a settled cloth costs the solver alone.
//   * colliders act EVERY substep with Coulomb friction (mu = `friction`) on the substep's tangential travel; main's act every 3rd iteration of 8 and
//     lose a fraction of the step's motion. A particle inside a collider is moved out, never through.
//   * a `mesh` collider (opt-in, new): { s: 'mesh', mesh: SurfaceMesh (cloth/collide.js), gap } holds the cloth `gap` (plus `thick`) off a triangle
//     surface, e.g. a person's posed body (peopleMesh in colliders.js builds one): a sheet that reads the nose, the breasts and the knees.
// Beyond main's options (all optional; null / 0 = main's behaviour): `shear` (scale on the fabric's woven shear relative to main's 0.6; 0.06 = KES-like, so the cloth follows a knee instead of
//   bridging it), `lay: { seed, amp, wave, gather }` (a hand-laid start: the sheet starts gathered by `gather` (a fraction of its width and length) and rippled `amp` m high at `wave` m, a seeded
//   integer-hash value noise (`layStart` is exported; pure function), so it lands with slack and folds instead of a taut plane; validated: a bad dial throws RangeError), `quality` / `sub`.
// The mesh collider holds `gap` + `thick` off the surface; its contact is a plane through the closest point (closestAny: a vertex with no triangle never loses the contact), applied every substep with
// Coulomb friction, with an optional second plane (`pinch: true`) for a particle held between two surfaces (a sheet between an arm and the flank). The surface must be WHOLE: a body with holes (makePerson's
// cut index under a bra) makes the sheet settle on the holes' rims (colliders.js peopleMesh always collides with the uncut skin).
// CREASE MEMORY (CLOTHINT run c4, iteration 2; opt-in `crease`, null = the elastic cloth above): a cloth bent past its elastic limit keeps the bend. Each hinge (the dihedral constraint of an
//   interior edge) carries a REST ANGLE theta0 (xpbd.js's `bT`) that is the sheet's own state, not a constant: after every step, a hinge whose angle has left theta0 by more than its YIELD
//   angle has its rest angle dragged along to the yield boundary (perfect plasticity: |theta - theta0| never rests above the yield), so a fold, a ruck or a landing crease made while the cloth is
//   loaded stays when the load is gone, and the cloth lies in it the way a bed sheet that has been slept in does (cf. the rest-angle updates for wrinkle persistence in Bridson, Marino and
//   Fedkiw 2003). The yield is the fabric's, in physics: a plate of thickness h bent to curvature k strains its outer fibre by k h / 2, so the yarn's elastic limit `yieldStrain` (drape_fabrics.js:
//   linen 1 %, cotton 1.6 %, wool 4 %) gives a yield curvature k_y = 2 yieldStrain / h (linen 40 /m, i.e. a crease 2.5 cm wide), and a hinge of the mesh yields at k_y x d, d = 2 (A1 + A2) / (3 |e|) the
//   distance between its two triangles' centroids across the edge (a 2.3 cm cell: 35 deg on a grid edge, 25 deg on a diagonal for linen). No number is fitted: change the fabric, the thickness or the grid and the
//   yield follows. `crease: true` | { yieldStrain, set } (set: the fraction of the excess followed per step, 1 = perfectly plastic). snapshot() / restore() carry the rest angles, so a resumed run is bit-identical.
// DETERMINISTIC (fixed dt, fixed substeps, fixed constraint and collider order, no clock, no randomness): a frame is a pure function of the colliders'
// history, in node and in a browser. RESUMABLE: snapshot() / restore(s) carry exactly the state that matters (X, V, t, the pins, Self6's pair and lock
// arrays, the substep counter) so restore(s) then run(...) is bit-identical to the uninterrupted run (labs/clothing2/drape_test.mjs checks it).
// A snapshot carries STATE, not options: construct the restoring object with the same constructor options (fabric, quality / sub, shear, stretch, bend, damping, friction ...) except `lay`, which is only a starting
// state; an object built without `shear` that restores a `shear: 0.06` snapshot diverges.
// Cost (this box): drape_test.mjs prints ms a step at main's 60 x 104 sheet. Units: metres, kilograms, seconds.
import * as THREE from 'three';
import { Cloth as XCloth, dihedral } from './xpbd.js';
import { Self6 } from './cloth6/self6.js';
import { piercings } from './cloth6/untangle6.js';
import { phys } from './fabrics.js';
import { fabricRecord } from './drape_fabrics.js';
export const DRAPE_VERSION_SHEET = 1;
// xpbd.js's dihedral bending is calibrated for an equilateral lattice; on this grid (right triangles, one diagonal a cell) a Peirce cantilever on a 1 cm strip droops
// at c_sim / c = 0.80-0.88 (B too low by ~2: c goes as the cube root), measured in labs/clothing2/drape_test.mjs; x BEND_CAL brings the fabric's bending length back
// (1.0 +- 0.1 at 1 cm cells). A 2.35 cm mesh cannot resolve a bending length of 1.8-3.5 cm (an overhang of 2 c is two cells): see NOTES.
export const BEND_CAL = 1.95;
// substeps a step by name. The stretch constraint and a contact fight inside a step (the contact moves a particle out along the normal, which stretches the edges that cross a ridge):
// at 6 substeps (720 Hz) a sheet on a foot or hand keeps a row of edges 26 % stretched for seconds; at 12 none is over 10 % (9 %), and the cost goes up by the solver's share (see NOTES)
export const QUALITY = { fast: 3, normal: 6, still: 12 };
const now = () => (globalThis.performance ? performance.now() : Date.now());

// the nearest surface point on a part of the mesh that faces away from (nx, ny, nz): the nearest vertex (with triangles) whose normal has cos < maxCos to it, then the
// closest point walked from there. Deterministic: scans the hash cells in a fixed order, ties go to the first vertex.
function secondPlane(S, x, y, z, r, nx, ny, nz, maxCos) {
  const ic = 1 / S.cell, rr = Math.max(1, Math.ceil(r * ic)), ci = Math.floor(x * ic), cj = Math.floor(y * ic), ck = Math.floor(z * ic), V = S.X, N = S.N; let best = -1, bd = r * r;
  for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) for (let c = -rr; c <= rr; c++) { const L = S.hash.get(S._key(ci + a, cj + b, ck + c)); if (!L) continue;
    for (let k = 0; k < L.length; k++) { const v = L[k]; if (S.fo[v + 1] === S.fo[v] || N[v * 3] * nx + N[v * 3 + 1] * ny + N[v * 3 + 2] * nz > maxCos) continue;
      const dx = V[v * 3] - x, dy = V[v * 3 + 1] - y, dz = V[v * 3 + 2] - z, d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = v; } } }
  return best < 0 ? null : S.closest(x, y, z, r, best);
}
// ---------------------------------------------------------------- the colliders, every substep (typed arrays, fixed order)
class ColliderContacts {
  constructor(n) { this.n = n; this.items = []; this.mu = 0.35; this.thick = 0.012; this.stats = { tests: 0 }; }
  set(list, thick, mu) {
    this.thick = thick; this.mu = mu; this._fresh = false; const it = [];
    for (const c of list || []) {
      const r = (c.r || 0) + thick, n0 = it.length;   // c.mu: optional per-collider Coulomb friction (skin on cotton is not steel on cotton); main's colliders carry none
      if (c.s === 'sphere') it.push({ k: 1, r, x: c.c[0], y: c.c[1], z: c.c[2], bb: [c.c[0] - r, c.c[0] + r, c.c[1] - r, c.c[1] + r, c.c[2] - r, c.c[2] + r] });
      else if (c.s === 'capsule') { const ax = c.a[0], ay = c.a[1], az = c.a[2], bx = c.b[0] - ax, by = c.b[1] - ay, bz = c.b[2] - az;
        it.push({ k: 2, r, ax, ay, az, bx, by, bz, L2: bx * bx + by * by + bz * bz || 1e-9, bb: [Math.min(c.a[0], c.b[0]) - r, Math.max(c.a[0], c.b[0]) + r, Math.min(c.a[1], c.b[1]) - r, Math.max(c.a[1], c.b[1]) + r, Math.min(c.a[2], c.b[2]) - r, Math.max(c.a[2], c.b[2]) + r] }); }
      else if (c.s === 'floor') it.push({ k: 0, y: c.y + thick, bb: [-1e9, 1e9, -1e9, c.y + thick, -1e9, 1e9] });
      else if (c.s === 'box') it.push({ k: 3, m0: c.min, m1: c.max, er: thick + Math.min(c.round ?? this.edgeRound ?? 0, 0.5 * Math.min(c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2])), bb: [c.min[0] - thick, c.max[0] + thick, c.min[1] - thick, c.max[1] + thick, c.min[2] - thick, c.max[2] + thick] });
      else if (c.s === 'mesh') { const cb = c._cb && c._cb.n === this.n ? c._cb : (c._cb = { n: this.n, P: new Float64Array(this.n * 3), on: new Uint8Array(this.n), N: new Float64Array(this.n * 3), P2: new Float64Array(this.n * 3), on2: new Uint8Array(this.n), N2: new Float64Array(this.n * 3), bb: null });
        const reach = 0.03; if (!cb.bb || cb.mesh !== c.mesh || cb.rev !== c.rev) { cb.rev = c.rev; const X = c.mesh.X; let b = [1e9, -1e9, 1e9, -1e9, 1e9, -1e9]; for (let v = 0; v < X.length; v += 3) { b[0] = Math.min(b[0], X[v]); b[1] = Math.max(b[1], X[v]); b[2] = Math.min(b[2], X[v + 1]); b[3] = Math.max(b[3], X[v + 1]); b[4] = Math.min(b[4], X[v + 2]); b[5] = Math.max(b[5], X[v + 2]); } cb.bb = b; cb.mesh = c.mesh; }
        const mi = { k: 4, mesh: c.mesh, gap: (c.gap ?? 0) + thick, reach, pinch: !!c.pinch, cb, P: cb.P, on: cb.on, N: cb.N, mb: cb.bb, bb: [-1e9, 1e9, -1e9, 1e9, -1e9, 1e9] };
        it.push(mi); if (mi.pinch) it.push({ ...mi, pinch: false, second: true, P: cb.P2, on: cb.on2, N: cb.N2 }); }   // pinch (opt-in): a second plane, applied after the first, for a particle held between two surfaces
      if (c.mu != null) for (let q = n0; q < it.length; q++) it[q].mu = c.mu;
    }
    this.items = it;
  }
  refresh(X) {   // analytic colliders need nothing; a mesh finds each particle's closest point and normal ONCE per step (a fresh hash search, no walk hint: the result is
    // a pure function of X, so a restored run finds what the uninterrupted one found); xpbd calls refresh again in substep 0, which is skipped
    if (this._fresh) return; this._fresh = true;
    for (const m of this.items) if (m.k === 4 && !m.second) { const n = this.n, S = m.mesh, r = m.reach, b = m.mb, cb = m.cb, pinch = m.pinch;
      for (let i = 0; i < n; i++) { const x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2]; if (pinch) cb.on2[i] = 0;
        if (x < b[0] - r || x > b[1] + r || y < b[2] - r || y > b[3] + r || z < b[4] - r || z > b[5] + r) { m.on[i] = 0; continue; }
        const q = S.closestAny(x, y, z, r, -1); if (!q) { m.on[i] = 0; continue; } m.on[i] = 1; m.P[i * 3] = q.px; m.P[i * 3 + 1] = q.py; m.P[i * 3 + 2] = q.pz; m.N[i * 3] = q.nx; m.N[i * 3 + 1] = q.ny; m.N[i * 3 + 2] = q.nz;
        // pinch: a particle at the first surface may also be at a second one that faces away from it (a sheet between an arm and the flank): the nearest vertex
        // whose normal turns away (cos < 0.3) gives the second plane, used only while the particle is in FRONT of it (d > -1 mm: behind it is the far side of a thin part, the underside of a hand). One closest point alone flips between the two every step (a period-2 chatter, 1-4 mm).
        if (pinch && q.d < m.gap + 0.004) { const d1 = q.d, n1x = q.nx, n1y = q.ny, n1z = q.nz; const q2 = secondPlane(S, x, y, z, r, n1x, n1y, n1z, 0.3);
          if (q2 && q2.d > -0.001 && q2.d < m.gap + 0.004 && q2.nx * n1x + q2.ny * n1y + q2.nz * n1z < 0.3) { cb.on2[i] = 1; cb.P2[i * 3] = q2.px; cb.P2[i * 3 + 1] = q2.py; cb.P2[i * 3 + 2] = q2.pz; cb.N2[i * 3] = q2.nx; cb.N2[i * 3 + 1] = q2.ny; cb.N2[i * 3 + 2] = q2.nz; } } } }
  }
  project(X, P, W, h) {
    const n = this.n, mu0 = this.mu, thick = this.thick;
    for (let ci = 0; ci < this.items.length; ci++) {
      const c = this.items[ci], bb = c.bb, k = c.k, mu = c.mu ?? mu0;
      for (let i = 0; i < n; i++) {
        if (W[i] === 0) continue; const i3 = i * 3, x = X[i3], y = X[i3 + 1], z = X[i3 + 2];
        let nx = 0, ny = 0, nz = 0, pen = 0;
        if (k === 4) { if (!c.on[i]) continue; const nxx = c.N[i3], nyy = c.N[i3 + 1], nzz = c.N[i3 + 2], rx = x - c.P[i3], ry = y - c.P[i3 + 1], rz = z - c.P[i3 + 2], d = rx * nxx + ry * nyy + rz * nzz;
          if (d >= c.gap) continue;
          nx = nxx; ny = nyy; nz = nzz; pen = c.gap - d; }
        else {
          if (x < bb[0] || x > bb[1] || y < bb[2] || y > bb[3] || z < bb[4] || z > bb[5]) continue;
          if (k === 0) { if (y < c.y) { ny = 1; pen = c.y - y; } }
          else if (k === 1) { const dx = x - c.x, dy = y - c.y, dz = z - c.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d < c.r && d > 1e-9) { nx = dx / d; ny = dy / d; nz = dz / d; pen = c.r - d; } }
          else if (k === 2) { let u = ((x - c.ax) * c.bx + (y - c.ay) * c.by + (z - c.az) * c.bz) / c.L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
            const dx = x - (c.ax + c.bx * u), dy = y - (c.ay + c.by * u), dz = z - (c.az + c.bz * u), d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < c.r * c.r) { const d = Math.sqrt(d2) || 1e-9; nx = dx / d; ny = dy / d; nz = dz / d; pen = c.r - d; } }
          else if (k === 3) {   // main's box: pushed out through the nearest face (top or sides; a cloth never gets under a table top); convex edges rounded to c.er (see Drape: edgeRound)
            const m0 = c.m0, m1 = c.m1, R = c.er;
            const ex0 = m0[0] - thick + R, ex1 = m1[0] + thick - R, ey0 = m0[1] - thick + R, ey1 = m1[1] + thick - R, ez0 = m0[2] - thick + R, ez1 = m1[2] + thick - R;
            if (R > thick && (x < ex0 || x > ex1 || y < ey0 || y > ey1 || z < ez0 || z > ez1)) {   // outside the inner box: the push is along the true normal of the rounded offset surface
              const cx = x < ex0 ? ex0 : x > ex1 ? ex1 : x, cy = y < ey0 ? ey0 : y > ey1 ? ey1 : y, cz = z < ez0 ? ez0 : z > ez1 ? ez1 : z;
              const dx = x - cx, dy = y - cy, dz = z - cz, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (d < R && d > 1e-12) { nx = dx / d; ny = dy / d; nz = dz / d; pen = R - d; } }
            else {   // inside the inner box (or sharp edges): out through the nearest top or side face
            let bp = m1[1] + thick - y, bnx = 0, bny = 1, bnz = 0, t;
            t = x - (m0[0] - thick); if (t < bp) { bp = t; bnx = -1; bny = 0; bnz = 0; } t = m1[0] + thick - x; if (t < bp) { bp = t; bnx = 1; bny = 0; bnz = 0; }
            t = z - (m0[2] - thick); if (t < bp) { bp = t; bnx = 0; bny = 0; bnz = -1; } t = m1[2] + thick - z; if (t < bp) { bp = t; bnx = 0; bny = 0; bnz = 1; }
            pen = bp; nx = bnx; ny = bny; nz = bnz; } }
        }
        if (pen > 0) {
          X[i3] += nx * pen; X[i3 + 1] += ny * pen; X[i3 + 2] += nz * pen;
          if (h > 0 && mu > 0) {   // Coulomb friction on the substep's tangential travel, bounded by mu x the normal push (static below it)
            let tx = X[i3] - P[i3], ty = X[i3 + 1] - P[i3 + 1], tz = X[i3 + 2] - P[i3 + 2]; const dn = tx * nx + ty * ny + tz * nz; tx -= nx * dn; ty -= ny * dn; tz -= nz * dn;
            const tl = Math.sqrt(tx * tx + ty * ty + tz * tz), lim = mu * pen; if (tl < 1e-12) continue; const f = tl <= lim ? 1 : lim / tl;
            X[i3] -= tx * f; X[i3 + 1] -= ty * f; X[i3 + 2] -= tz * f; }
        }
      }
    }
  }
}

// ---------------------------------------------------------------- the grid mesh (main's: same ids, uv in [0,1], same winding)
export function gridGeometry(nx, nz) {
  const N = (nx + 1) * (nz + 1), id = (i, j) => j * (nx + 1) + i, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const uv = new Float32Array(N * 2); for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { uv[id(i, j) * 2] = i / nx; uv[id(i, j) * 2 + 1] = j / nz; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const ix = []; for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1); ix.push(a, c, b, b, c, d); }
  g.setIndex(ix); return g;
}

// smooth value noise in [-1, 1] from an integer hash (Math.imul only: bit-identical in node and in every browser)
function vnoise(x, z, seed) {
  const h = (i, j) => { let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed | 0, 1103515245)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16; return (n >>> 0) / 2147483648 - 1; };
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}
export function layStart(X0, nx, nz, at, lay = {}) {
  const { seed = 1, amp = 0.04, wave = 0.3, gather = 0.1 } = lay === true ? {} : lay;   // `lay: true` = the defaults
  // validated (run c3; the check found `wave: 0` turned 441 coordinates NaN with no error and `gather: 1` a point column): a bad dial throws at construction, valid ones are untouched (the golden holds)
  if (!(Number.isFinite(wave) && wave > 0)) throw new RangeError(`lay.wave must be a number > 0 (metres), got ${wave}`);
  if (!(Number.isFinite(gather) && gather >= 0 && gather < 0.5)) throw new RangeError(`lay.gather must be a number in [0, 0.5) (a fraction of the sheet's width and length), got ${gather}`);
  if (!Number.isFinite(amp)) throw new RangeError(`lay.amp must be a finite number (metres), got ${amp}`);
  if (!Number.isInteger(seed)) throw new RangeError(`lay.seed must be an integer, got ${seed}`);
  const XS = new Float64Array(X0), s = 1 - gather, N = (nx + 1) * (nz + 1);
  for (let k = 0; k < N; k++) { const x = X0[k * 3] - at[0], z = X0[k * 3 + 2] - at[2];
    XS[k * 3] = at[0] + x * s; XS[k * 3 + 2] = at[2] + z * s;
    XS[k * 3 + 1] = at[1] + amp * (vnoise(x / wave + 17.3, z / wave + 5.1, seed) + 0.5 * vnoise(x / (wave * 0.5) + 3.7, z / (wave * 0.5) + 11.9, seed + 7)) / 1.5; }
  return XS;
}

// the yield angle of every hinge of the solver (xpbd.js bI = w1 w2 a b: the wings, then the shared edge), from the PATTERN's geometry (rest: the flat sheet)
function plasticHinges(xp, rest, h, { yieldStrain, set }) {
  const bI = xp.bI, nb = xp.bT.length, bY = new Float64Array(nb), ky = 2 * yieldStrain / h, area = (a, b, c) => { const ux = rest[b * 3] - rest[a * 3], uy = rest[b * 3 + 1] - rest[a * 3 + 1], uz = rest[b * 3 + 2] - rest[a * 3 + 2], vx = rest[c * 3] - rest[a * 3], vy = rest[c * 3 + 1] - rest[a * 3 + 1], vz = rest[c * 3 + 2] - rest[a * 3 + 2];
    return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); };
  if (!(yieldStrain > 0) || !(set > 0 && set <= 1)) throw new RangeError(`crease: yieldStrain must be > 0 and set in (0, 1], got ${yieldStrain}, ${set}`);
  for (let c = 0; c < nb; c++) { const w1 = bI[c * 4], w2 = bI[c * 4 + 1], a = bI[c * 4 + 2], b = bI[c * 4 + 3], el = Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2]);
    bY[c] = ky * 2 * (area(w1, a, b) + area(w2, a, b)) / (3 * el); }
  return { xp, bY, set, ky, yieldStrain, last: 0 };
}

export class Drape {
  constructor({ w = 1.4, l = 2.5, nx = 48, nz = 86, at = [0, 1.5, 0], stretch = 1, shear = 0.6, bend = 0.12, damping = 0.012, gravity = -9.8,
    thick = 0.012, friction = 0.35, dt = 1 / 120, iters = 8,
    fabric = 'cotton', sub = null, quality = 'normal', stretchIters = 2, compress = 0.2, vmax = 1.5, self = true, selfTh = null, selfMargin = 0.008, selfMu = 0.3, lay = null, crease = null, edgeRound = null } = {}) {
    sub = sub ?? QUALITY[quality] ?? 6;   // quality: 'fast' 3 | 'normal' 6 | 'still' 12 substeps a step (`sub` wins). 'still' for a sheet over a body with features narrower than a cell (toes, fingers): see QUALITY
    Object.assign(this, { w, l, nx, nz, stretch, shear, bend, damping, gravity, thick, friction, dt, iters, sub }); this._refreshes = 0;
    const N = this.N = (nx + 1) * (nz + 1), id = (i, j) => j * (nx + 1) + i;
    this.p = new Float32Array(N * 3); this.q = new Float32Array(N * 3); this.inv = new Float32Array(N).fill(1); this.t = 0; this._sub0 = 0; this._onSync = [];
    this.__hooksNative = true;
    // the pattern: a flat sheet (w along x, l along z) at `at`; the pattern IS the start, so the rest dihedral is flat
    const X0 = new Float64Array(N * 3);
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const k = id(i, j) * 3; X0[k] = at[0] + (i / nx - 0.5) * w; X0[k + 1] = at[1]; X0[k + 2] = at[2] + (j / nz - 0.5) * l; }
    // A HAND-LAID START (opt-in, new; `lay: { seed, amp, wave, gather }`, null = main's flat start): a sheet someone shook out and let go is not flat and not at its full width: it is gathered
    // (x and z drawn in about its middle by `gather`, a fraction) and rippled (a smooth deterministic value noise of wavelength `wave` m, `amp` m high, seeded), so the cloth lands with slack that
    // friction holds as folds. The pattern (rest lengths, rest dihedral) stays flat: only where the particles START changes. No clock, no Math.random: the same sheet every run.
    const XS = lay ? layStart(X0, nx, nz, at, lay) : X0;
    this.p.set(XS); this.q.set(this.p);
    const tris = []; for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1); tris.push(a, c, b, b, c, d); }
    const F = fabricRecord(fabric), Pf = phys(F); this.fabric = typeof fabric === 'string' ? fabric : (F.label || 'custom'); this.phys = Pf;
    const fab = { ...Pf, shear: Pf.shear * (shear / 0.6) };
    const warp = new Float64Array(N * 3); for (let k = 0; k < N; k++) warp[k * 3 + 2] = 1;      // the warp runs along the sheet's length
    this.xp = new XCloth(X0, Int32Array.from(tris), fab, { X0: XS, warp, compress, restAngle: 1, bendScale: bend / 0.12 * BEND_CAL, stretchScale: stretch, tether: false,
      gravity: [0, gravity, 0], damping: -Math.log(1 - damping) / dt, vmax, stretchIters, self: 0 });
    this.M = this.xp.M;
    this._pl = crease ? plasticHinges(this.xp, X0, Pf.h, { yieldStrain: F.yieldStrain ?? 0.015, set: 1, ...(crease === true ? {} : crease) }) : null;
    this.cont = new ColliderContacts(N);
    // ROUNDED CONVEX EDGES (run c5 it2): a real slab has rounded edges, and a mesh of cell h cannot turn a sharp 90 degree edge: two particles that straddle one are sqrt(2) h apart, so the stretch constraint fights the friction there (the table's foot-end corners: edges 42-67 % stretched on the fine sheets). A `box` collider takes `round` (m): the solid's own edge radius, so the offset surface at `thick` has radius round + thick; Drape's `edgeRound` is the default for boxes that carry none (0 = sharp, as before).
    this.edgeRound = edgeRound ?? 0;
    // CLOTH6's self-collision. Its pair list is refreshed ADAPTIVELY: when any particle has moved more than 0.4 x `selfMargin` since the last refresh (the list
    // holds every pair within 2 th + margin, so a pair that comes within the layer gap while neither end has moved more than half the margin was in it). The decision
    // depends only on X and the positions at the last refresh, both carried by the snapshot, so a restored run refreshes on the same substeps.
    this._c6 = null; this._ref = null; let s6 = null;
    if (self) {
      const th = selfTh ?? Math.max(0.0012, 1.5 * Pf.h);
      s6 = this._c6 = new Self6(this.xp, { th, every: 1, maxPush: 0.004, mu: selfMu, margin: selfMargin, ee: true, ccd: true });
    }
    // the hook xpbd.js calls each substep: pre (before the contacts) = Self6 with the adaptive refresh; post (after them) = Self6's last pass
    const lim2 = (0.4 * selfMargin) ** 2;
    this.xp.c6 = { pre: (step, X, P) => { if (!s6) return; let go = !this._ref; if (!go) { const R = this._ref; for (let i = 0; i < X.length; i += 3) { const dx = X[i] - R[i], dy = X[i + 1] - R[i + 1], dz = X[i + 2] - R[i + 2]; if (dx * dx + dy * dy + dz * dz > lim2) { go = true; break; } } }
        if (go) { s6.refresh(X); (this._ref ||= new Float64Array(X.length)).set(X); this._refreshes++; }
        s6.project(X, P); },
      post: (X, P) => { if (s6) s6.post(X, P); } };
    // the mesh
    this.geometry = gridGeometry(nx, nz); this.sync();
  }
  id(i, j) { return j * (this.nx + 1) + i; }
  pin(k, on = true) { this.inv[k] = on ? 0 : 1; return this; }
  snapshot() {
    const xp = this.xp, c = this._c6;
    return { v: 1, t: this.t, sub0: this._sub0, bT: this._pl ? xp.bT.slice() : null, X: xp.X.slice(), V: xp.V.slice(), inv: this.inv.slice(), q: this.q.slice(), ref: this._ref ? this._ref.slice() : null,
      c6: c ? { vfP: c.vfP.slice(), vfL: c.vfL.slice(), eeP: c.eeP.slice(), eeL: c.eeL.slice() } : null };
  }
  restore(s) {
    const xp = this.xp, c = this._c6; xp.X.set(s.X); xp.V.set(s.V); xp.P.set(s.X); if (this._pl && s.bT) xp.bT.set(s.bT); this.inv.set(s.inv); this.t = s.t; this._sub0 = s.sub0; this.q.set(s.q); this._ref = s.ref ? s.ref.slice() : null;
    for (let i = 0; i < this.N * 3; i++) this.p[i] = xp.X[i];
    if (c) { if (s.c6) { c.vfP = s.c6.vfP.slice(); c.vfL = s.c6.vfL.slice(); c.eeP = s.c6.eeP.slice(); c.eeL = s.c6.eeL.slice(); } else { c.vfP = new Int32Array(0); c.vfL = new Int8Array(0); c.eeP = new Int32Array(0); c.eeL = new Int8Array(0); } c.locks = new Map(); }
    return this;
  }
  step(colliders = []) {
    const t0 = now(), xp = this.xp, N = this.N, X = xp.X, W = xp.W, M = this.M, inv = this.inv, p = this.p;
    for (let i = 0; i < N; i++) {
      if (inv[i]) { W[i] = 1 / M[i]; continue; } W[i] = 0;
      // a pinned particle follows p when the scene moved it (a waving flag's pole); untouched, X stays exact
      const i3 = i * 3; for (let a = 0; a < 3; a++) if (Math.fround(X[i3 + a]) !== p[i3 + a]) X[i3 + a] = p[i3 + a]; }
    this.q.set(p);
    this.cont.set(colliders, this.thick, this.friction);
    xp.run(this.dt, { hz: this.sub / this.dt, contacts: this.cont, every: this.sub });
    if (this._pl) this._plastic();
    for (let i = 0; i < N * 3; i++) p[i] = X[i];
    this._sub0 += this.sub; this.t += this.dt;
    const s = this.stats ||= { steps: 0, ms: 0, last: 0 }; s.steps++; s.last = now() - t0; s.ms += s.last;
  }
  // CREASE MEMORY: the rest angle follows the dihedral past the yield (see the header)
  _plastic() {
    const xp = this._pl.xp, X = xp.X, bI = xp.bI, bT = xp.bT, bY = this._pl.bY, set = this._pl.set, nb = bT.length, TWO_PI = 2 * Math.PI; let n = 0;
    for (let c = 0; c < nb; c++) {
      const th = dihedral(X, bI[c * 4], bI[c * 4 + 1], bI[c * 4 + 2], bI[c * 4 + 3], null); if (th !== th) continue;
      let d = th - bT[c]; if (d > Math.PI) d -= TWO_PI; else if (d < -Math.PI) d += TWO_PI;
      const ex = (d < 0 ? -d : d) - bY[c]; if (ex <= 0) continue;
      let t0 = bT[c] + (d < 0 ? -1 : 1) * set * ex; if (t0 > Math.PI) t0 -= TWO_PI; else if (t0 < -Math.PI) t0 += TWO_PI; bT[c] = t0; n++; }
    this._pl.last = n;
  }
  // the hinges' rest angles away from the pattern's (flat: 0): count and the largest, degrees; null without `crease`
  creaseStats(minDeg = 5) { if (!this._pl) return null; const bT = this.xp.bT, lim = minDeg * Math.PI / 180; let m = 0, k = 0; for (let c = 0; c < bT.length; c++) { const a = Math.abs(bT[c]); if (a > lim) k++; if (a > m) m = a; }
    return { hinges: bT.length, set: k, maxDeg: +(m * 180 / Math.PI).toFixed(1), yieldedLast: this._pl.last | 0 }; }
  settle(seconds, colliders) { const n = Math.round(seconds / this.dt); for (let i = 0; i < n; i++) this.step(colliders); return this; }
  // step from this.t to t1 with colliders(t) at each step's time. Also accepts main's header-comment form run(t0, t1, f) (t0 is ignored: the cloth runs from its own time)
  run(a, b, c) { const t1 = typeof b === 'function' ? a : b, f = typeof b === 'function' ? b : c; while (this.t < t1 - this.dt * 0.5) this.step(f(this.t)); return this; }
  sync() {
    const P = this.geometry.attributes.position; P.array.set(this.p); P.needsUpdate = true; this.geometry.computeVertexNormals(); this.geometry.computeBoundingSphere();
    for (const f of this._onSync) f(); return this;
  }
  // CLOTH6's ruler: triangles of the cloth in self-intersecting pairs (cloth through its own cloth)
  crossings() { const r = piercings(this.xp.X, this.xp.tris, this.N); return { hitTris: r.hitTris, pairs: r.pairs, piercings: r.P.length / 3 }; }
  cost() { const s = this.stats || { steps: 0, ms: 0, last: 0 }; return { steps: s.steps, msPerStep: s.steps ? s.ms / s.steps : 0, lastMs: s.last, particles: this.N, substeps: this.sub, self: this._c6 ? { ...this._c6.stats, refreshes: this._refreshes } : null, crease: this.creaseStats() }; }
}
// A snapshot as BYTES (a farm segment saves where it stopped; the next segment, on any machine, restores it and goes on): a JSON header line (the shape: scalars and the typed arrays' names, types and lengths), then the
// arrays back to back. pure JS (no fs): unpackSnapshot(packSnapshot(s)) is deep-equal to s, and restore() of it is bit-identical to restore() of s. Used by labs/clothing2/drape_bake.mjs --segment.
const TYPES = { Float64Array, Float32Array, Int32Array, Int8Array, Uint8Array };
export function packSnapshot(s) {
  const shape = {}, parts = []; let off = 0;
  const walk = (o, into) => { for (const k of Object.keys(o)) { const v = o[k];
    if (v === null || v === undefined) into[k] = null;
    else if (typeof v === 'number') into[k] = v;
    else if (ArrayBuffer.isView(v)) { const T = v.constructor.name; if (!TYPES[T]) throw new Error('packSnapshot: ' + T); const pad = (8 - off % 8) % 8; off += pad; parts.push({ pad, v }); into[k] = { $: T, n: v.length, at: off }; off += v.byteLength; }
    else if (typeof v === 'object') walk(v, into[k] = {}); else throw new Error('packSnapshot: ' + k); } };
  walk(s, shape);
  const head = new TextEncoder().encode(JSON.stringify(shape) + '\n'), base = Math.ceil(head.length / 8) * 8, out = new Uint8Array(base + off); out.set(head, 0); let at = base;
  for (const { pad, v } of parts) { at += pad; out.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), at); at += v.byteLength; }
  return out;
}
export function unpackSnapshot(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf), k = u.indexOf(10), shape = JSON.parse(new TextDecoder().decode(u.subarray(0, k))), base = Math.ceil((k + 1) / 8) * 8;
  const copy = new Uint8Array(u.length - base); copy.set(u.subarray(base));
  const walk = o => { const r = {}; for (const key of Object.keys(o)) { const v = o[key];
    if (v === null || typeof v === 'number') r[key] = v;
    else if (v.$) { const T = TYPES[v.$]; r[key] = new T(copy.buffer.slice(v.at, v.at + v.n * T.BYTES_PER_ELEMENT)); }
    else r[key] = walk(v); } return r; };
  return walk(shape);
}
export { Drape as Cloth };
