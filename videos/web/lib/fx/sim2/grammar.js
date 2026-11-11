// GRAMMAR (sim2): procedural machinery and cities by shape grammar, merged per material, occlusion baked.
//
//   import { machine, city, buildMeshes, MATS } from '../lib/fx/sim2/grammar.js';
//   const m = machine({ seed: 3, kind: 'press', size: [8, 11, 5], detail: 1 });     // kinds: press | turbine | housing
//   const grp = buildMeshes(m, { mats: MATS.mill() });  scene.add(grp);             // THREE.Group, one mesh per material
//   const c = city({ seed: 7, blocks: [9, 9], block: 60, street: 16, style: 'deco' });  // styles: deco | brutal
//   const cg = buildMeshes(c, { mats: MATS.city({ night: 1 }) });
//
// How it works (after CGA shape grammar, Müller et al. 2006, and greebling practice in film miniatures):
//   A shape is an oriented box scope (origin, size, frame). Rules are small JS functions that split / repeat /
//   decompose a scope into faces and sub-scopes and emit terminals (chamfered boxes, cylinders, tori, hex bolts).
//   Stochastic choices come from a seeded PRNG keyed by the scope, so the same seed rebuilds the same object.
//   Recursion stops when a scope is smaller than `minSize` (the "8 px on screen" rule: pass the size one pixel
//   covers at the intended camera distance x 8). Machinery rules: plinth with anchor bolts and hazard edge; press
//   (uprights with rib stacks, crown with tie rods, nuts, hydraulic cylinders, ram, bed), turbine (flanged casing
//   segments with bolt rings, pedestals, hood), housing (panelised skin: inset access plates, rivet rows, louvres,
//   gauges, valves, junction boxes); pipes routed Manhattan-style with elbows and bolted flanges; walkways with
//   railings and ladders. City rules: blocks -> lots (recursive splits) -> massing by district (towers with setbacks,
//   slabs, sheds with sawtooth roofs) -> cornices, fins, pilasters, balconies, rooftop plant (tanks, units, masts);
//   windows are left to the facade shader (per-building floor height, bay width and a lit seed in vertex attributes).
// Every terminal carries a flat-shaded chamfer (edges catch the light: edge wear and rim highlights come from them).
// Ambient occlusion is baked per vertex by casting 14 hemisphere rays through a voxelisation of the whole model.
import * as THREE from 'three';

function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const lerp = (a, b, x) => a + (b - a) * x;

// ---------------------------------------------------------------- the builder: terminals by material
class Builder {
  constructor(seed = 1) { this.parts = {}; this.r = mulberry(seed); this.boxes = []; this.count = 0; }
  _push(mat, pos, nrm, extra) {
    const P = this.parts[mat] || (this.parts[mat] = { pos: [], nrm: [], ext: [] });
    for (let i = 0; i < pos.length; i++) { P.pos.push(pos[i]); P.nrm.push(nrm[i]); }
    for (let i = 0; i < pos.length / 3; i++) P.ext.push(extra[0], extra[1], extra[2], extra[3]);
    this.count++;
  }
  // chamfered box: centre c, half sizes h, chamfer ch, optional rotation about Y (ry) or a 3x3 basis M (columns)
  box(mat, c, h, { ch = null, ry = 0, M = null, ext = [0, 0, 0, 0], occ = true } = {}) {
    const k = ch ?? Math.min(0.02, Math.min(h[0], h[1], h[2]) * 0.18);
    const pos = [], nrm = [];
    const pt = (sx, sy, sz, ax) => [sx * (h[0] - (ax === 0 ? 0 : k)), sy * (h[1] - (ax === 1 ? 0 : k)), sz * (h[2] - (ax === 2 ? 0 : k))];
    const tri = (a, b, c2) => { const n = cross(sub(b, a), sub(c2, a)); const m = add(add(a, b), c2); if (dot(n, m) < 0) { pos.push(...a, ...c2, ...b); } else pos.push(...a, ...b, ...c2);
      const nn = norm(dot(n, m) < 0 ? scale(n, -1) : n); nrm.push(...nn, ...nn, ...nn); };
    const quad = (a, b, c2, d) => { tri(a, b, c2); tri(a, c2, d); };
    const S = [-1, 1];
    for (let ax = 0; ax < 3; ax++) for (const s of S) {        // 6 faces
      const q = []; for (const u of S) for (const v of S) { const sg = [0, 0, 0]; sg[ax] = s; sg[(ax + 1) % 3] = u; sg[(ax + 2) % 3] = v; q.push(pt(sg[0], sg[1], sg[2], ax)); }
      quad(q[0], q[1], q[3], q[2]);
    }
    if (k > 0) {
      for (let ax = 0; ax < 3; ax++) for (const s1 of S) for (const s2 of S) {    // 12 edges along axis ax
        const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3, e = [];
        for (const s0 of S) { const sg = [0, 0, 0]; sg[ax] = s0; sg[a1] = s1; sg[a2] = s2; e.push(pt(sg[0], sg[1], sg[2], a1), pt(sg[0], sg[1], sg[2], a2)); }
        quad(e[0], e[1], e[3], e[2]);
      }
      for (const sx of S) for (const sy of S) for (const sz of S) tri(pt(sx, sy, sz, 0), pt(sx, sy, sz, 1), pt(sx, sy, sz, 2));
    }
    this._emit(mat, pos, nrm, c, ry, M, ext);
    if (occ) this.boxes.push(aabbOf(c, h, ry, M));
  }
  // cylinder along the basis Y axis (default up); caps optional
  cyl(mat, c, r, hh, { seg = null, ry = 0, M = null, caps = true, r2 = null, ext = [0, 0, 0, 0], occ = true, ch = null } = {}) {
    const n = seg || Math.max(8, Math.min(40, Math.round(r * 90))), pos = [], nrm = [], rt = r2 ?? r, k = ch ?? Math.min(r * 0.12, 0.012);
    const ring = (y, rr) => { const o = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; o.push([Math.cos(a) * rr, y, Math.sin(a) * rr]); } return o; };
    const A = ring(-hh + k, r), Bt = ring(hh - k, rt), A2 = ring(-hh, r - k), B2 = ring(hh, rt - k);
    for (let i = 0; i < n; i++) {
      const sideN = (a) => norm([Math.cos(a), (r - rt) / (2 * hh), Math.sin(a)]), a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      const n0 = sideN(a0), n1 = sideN(a1);
      pos.push(...A[i], ...Bt[i], ...Bt[i + 1], ...A[i], ...Bt[i + 1], ...A[i + 1]); nrm.push(...n0, ...n0, ...n1, ...n0, ...n1, ...n1);
      if (k > 0) {     // chamfer rings
        const cu = norm([Math.cos((a0 + a1) / 2), 1, Math.sin((a0 + a1) / 2)]), cd = norm([Math.cos((a0 + a1) / 2), -1, Math.sin((a0 + a1) / 2)]);
        pos.push(...Bt[i], ...B2[i], ...B2[i + 1], ...Bt[i], ...B2[i + 1], ...Bt[i + 1]); for (let q = 0; q < 6; q++) nrm.push(...cu);
        pos.push(...A2[i], ...A[i], ...A[i + 1], ...A2[i], ...A[i + 1], ...A2[i + 1]); for (let q = 0; q < 6; q++) nrm.push(...cd);
      }
      if (caps) { pos.push(0, hh, 0, ...B2[i + 1], ...B2[i]); nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0); pos.push(0, -hh, 0, ...A2[i], ...A2[i + 1]); nrm.push(0, -1, 0, 0, -1, 0, 0, -1, 0); }
    }
    this._emit(mat, pos, nrm, c, ry, M, ext);
    if (occ) this.boxes.push(aabbOf(c, [Math.max(r, rt), hh, Math.max(r, rt)], ry, M));
  }
  // torus segment (pipe elbow / handwheel): major R, minor r, arc
  torus(mat, c, R, r, { arc = Math.PI * 2, M = null, ry = 0, seg = null, ext = [0, 0, 0, 0] } = {}) {
    const nu = seg || Math.max(8, Math.round(arc * R * 40)), nv = Math.max(6, Math.round(r * 120)), pos = [], nrm = [];
    const P = (u, v) => { const a = u / nu * arc, b = v / nv * Math.PI * 2; const cx = Math.cos(a), cz = Math.sin(a); return [[(R + r * Math.cos(b)) * cx, r * Math.sin(b), (R + r * Math.cos(b)) * cz], [Math.cos(b) * cx, Math.sin(b), Math.cos(b) * cz]]; };
    for (let u = 0; u < nu; u++) for (let v = 0; v < nv; v++) { const a = P(u, v), b = P(u + 1, v), c2 = P(u + 1, v + 1), d = P(u, v + 1);
      pos.push(...a[0], ...c2[0], ...b[0], ...a[0], ...d[0], ...c2[0]); nrm.push(...a[1], ...c2[1], ...b[1], ...a[1], ...d[1], ...c2[1]); }
    this._emit(mat, pos, nrm, c, ry, M, ext);
  }
  hexBolt(mat, c, r, { M = null, ry = 0, len = null } = {}) { this.cyl(mat, c, r, (len ?? r * 0.7) / 2, { seg: 6, M, ry, occ: false, ch: r * 0.15 }); }
  _emit(mat, pos, nrm, c, ry, M, ext) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    for (let i = 0; i < pos.length; i += 3) {
      let x = pos[i], y = pos[i + 1], z = pos[i + 2], nx = nrm[i], ny = nrm[i + 1], nz = nrm[i + 2];
      if (M) { const X = M[0], Y = M[1], Z = M[2];
        [x, y, z] = [X[0] * x + Y[0] * y + Z[0] * z, X[1] * x + Y[1] * y + Z[1] * z, X[2] * x + Y[2] * y + Z[2] * z];
        [nx, ny, nz] = [X[0] * nx + Y[0] * ny + Z[0] * nz, X[1] * nx + Y[1] * ny + Z[1] * nz, X[2] * nx + Y[2] * ny + Z[2] * nz]; }
      else if (ry) { [x, z] = [cs * x + sn * z, -sn * x + cs * z]; [nx, nz] = [cs * nx + sn * nz, -sn * nx + cs * nz]; }
      pos[i] = x + c[0]; pos[i + 1] = y + c[1]; pos[i + 2] = z + c[2]; nrm[i] = nx; nrm[i + 1] = ny; nrm[i + 2] = nz;
    }
    this._push(mat, pos, nrm, ext);
  }
  // a Manhattan pipe from a to b (world points), radius r, via an intermediate height; elbows + flanges with bolts
  pipe(mat, a, b, r, { via = null, flangeMat = null, boltMat = null, flanges = 3 } = {}) {
    const mid = via || [a[0], b[1], a[2]];
    const pts = [a, [a[0], mid[1], a[2]], [b[0], mid[1], a[2]], [b[0], mid[1], b[2]], b].filter((p, i, A) => i === 0 || dist(p, A[i - 1]) > 1e-3);
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1], d = sub(q, p), L = len(d); if (L < 1e-3) continue;
      const shorten = (i > 0 ? r * 2 : 0), shortenE = (i < pts.length - 2 ? r * 2 : 0); if (L - shorten - shortenE < 0.01) continue;
      const u = scale(d, 1 / L), M = basisY(u), c = add(p, scale(u, shorten + (L - shorten - shortenE) / 2));
      this.cyl(mat, c, r, (L - shorten - shortenE) / 2, { M, caps: false, occ: true, ch: 0 });
      // flanges along the run
      const nf = Math.max(0, Math.floor(L / 3.2)) + (i === 0 ? 1 : 0);
      for (let f = 0; f < Math.min(nf, flanges); f++) {
        const fp = add(p, scale(u, shorten + 0.15 + (f + (i === 0 ? 0 : 0.5)) * Math.min(3.2, L - shorten - shortenE - 0.3)));
        if (dist(fp, p) > L - shortenE) continue;
        this.cyl(flangeMat || mat, fp, r * 1.55, r * 0.22, { M, occ: false });
        if (boltMat && r > 0.05) { const nb = r > 0.15 ? 12 : 8; for (let k = 0; k < nb; k++) { const a2 = k / nb * Math.PI * 2, off = add(scale(M[0], Math.cos(a2) * r * 1.3), scale(M[2], Math.sin(a2) * r * 1.3));
          this.hexBolt(boltMat, add(fp, off), r * 0.1, { M, len: r * 0.62 }); } }
      }
      // elbow at q
      if (i < pts.length - 2) {
        const d2 = sub(pts[i + 2], q), u2 = norm(d2), cen = add(q, add(scale(u, -r * 2), scale(u2, r * 2)));
        // torus in the plane of u and u2, centred at cen, radius 2r, arc 90deg from -u2 to -u (local)
        const X = scale(u2, -1), Z = scale(u, 1), Y = cross(Z, X);
        this.torus(mat, cen, r * 2, r, { arc: Math.PI / 2, M: [X, Y, Z] });
      }
    }
  }
}
function aabbOf(c, h, ry, M) {
  if (M) { const e = [0, 1, 2].map(i => Math.abs(M[0][i]) * h[0] + Math.abs(M[1][i]) * h[1] + Math.abs(M[2][i]) * h[2]); return [c[0] - e[0], c[1] - e[1], c[2] - e[2], c[0] + e[0], c[1] + e[1], c[2] + e[2]]; }
  const cs = Math.abs(Math.cos(ry)), sn = Math.abs(Math.sin(ry)), ex = cs * h[0] + sn * h[2], ez = sn * h[0] + cs * h[2];
  return [c[0] - ex, c[1] - h[1], c[2] - ez, c[0] + ex, c[1] + h[1], c[2] + ez];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]), norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, dist = (a, b) => len(sub(a, b));
function basisY(u) { const a = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; const X = norm(cross(a, u)), Z = cross(X, u); return [X, u, Z]; }

// ---------------------------------------------------------------- machinery rules
// materials used: body, paint2 (accent), steel (bright machined), dark (rubber / cast), bolt, hazard (yellow), black, glass, copper
export function machine({ seed = 1, kind = 'press', size = [8, 11, 5], detail = 1, minSize = 0.12, pos = [0, 0, 0] } = {}) {
  const B = new Builder(seed), r = B.r, [W, Hh, D] = size, [ox, oy, oz] = pos;
  const P = (x, y, z) => [ox + x, oy + y, oz + z];
  // plinth: a stepped concrete base, anchor bolts, hazard-striped edge
  const ph = 0.45;
  B.box('concrete', P(0, ph / 2, 0), [W / 2 + 0.6, ph / 2, D / 2 + 0.6], { ch: 0.03 });
  B.box('concrete', P(0, ph + 0.12, 0), [W / 2 + 0.2, 0.12, D / 2 + 0.2], { ch: 0.02 });
  const stripe = (x0, x1, z, rot) => { const n = Math.floor(Math.abs(x1 - x0) / 0.3); for (let i = 0; i < n; i++) { const x = lerp(x0, x1, (i + 0.5) / n);
    B.box(i % 2 ? 'black' : 'hazard', rot ? P(z, ph + 0.245, x) : P(x, ph + 0.245, z), rot ? [0.07, 0.006, Math.abs(x1 - x0) / n / 2] : [Math.abs(x1 - x0) / n / 2, 0.006, 0.07], { ch: 0.002, occ: false }); } };
  stripe(-W / 2 - 0.1, W / 2 + 0.1, D / 2 + 0.12, false); stripe(-D / 2 - 0.1, D / 2 + 0.1, W / 2 + 0.12, true); stripe(-D / 2 - 0.1, D / 2 + 0.1, -W / 2 - 0.12, true);
  const base = ph + 0.24;
  if (kind === 'press') press(B, r, P, W, Hh, D, base, detail, minSize);
  else if (kind === 'turbine') turbine(B, r, P, W, Hh, D, base, detail, minSize);
  else housing(B, r, P, [0, base + (Hh - base) / 2, 0], [W / 2, (Hh - base) / 2, D / 2], detail, minSize, 0);
  return B;
}
function ribStack(B, r, P, x, y0, y1, z, w, d, n) {    // horizontal stiffening ribs on a column face
  for (let i = 0; i < n; i++) { const y = lerp(y0, y1, (i + 0.5) / n); B.box('body', P(x, y, z), [w, 0.035, d], { ch: 0.008 }); }
}
function press(B, r, P, W, Hh, D, base, detail, minSize) {
  const uw = W * 0.16, ud = D * 0.46, bedH = 1.1, crownH = Hh * 0.2, top = Hh;
  // bed
  B.box('body', P(0, base + bedH / 2, 0), [W / 2, bedH / 2, D * 0.45], { ch: 0.05 });
  B.box('steel', P(0, base + bedH + 0.06, 0), [W / 2 - uw - 0.05, 0.06, D * 0.36], { ch: 0.01 });
  // T-slots in the bolster
  for (let i = -3; i <= 3; i++) B.box('dark', P(i * (W / 2 - uw) / 3.6, base + bedH + 0.121, 0), [0.03, 0.004, D * 0.35], { ch: 0.001, occ: false });
  // uprights (two box columns) with rib stacks and access doors
  for (const s of [-1, 1]) {
    const cx = s * (W / 2 - uw / 2), y0 = base + bedH, y1 = top - crownH;
    B.box('body', P(cx, (y0 + y1) / 2, 0), [uw / 2, (y1 - y0) / 2, ud], { ch: 0.05 });
    ribStack(B, r, P, cx + s * (uw / 2 + 0.03), y0 + 0.4, y1 - 0.3, 0, 0.03, ud * 0.92, Math.max(3, Math.floor((y1 - y0) / 0.9)));
    // gib guides (bright machined ways) on the inner faces
    B.box('steel', P(cx - s * (uw / 2 + 0.02), (y0 + y1) / 2, ud * 0.5), [0.02, (y1 - y0) / 2 - 0.1, 0.08], { ch: 0.005 });
    B.box('steel', P(cx - s * (uw / 2 + 0.02), (y0 + y1) / 2, -ud * 0.5), [0.02, (y1 - y0) / 2 - 0.1, 0.08], { ch: 0.005 });
    // front face panelised
    housingFace(B, r, P, [cx, (y0 + y1) / 2, ud], [uw / 2 - 0.08, (y1 - y0) / 2 - 0.25], 'z', detail, minSize, 0);
    // tie rods through the column: exposed at the crown top and under the bed, with big nuts
    for (const tz of [-ud * 0.7, ud * 0.7]) {
      B.cyl('steel', P(cx, top + 0.25, tz), 0.09, 0.25); B.cyl('dark', P(cx, top + 0.09, tz), 0.17, 0.09, { seg: 6 });
      B.cyl('dark', P(cx, base + 0.35, tz + 0.0), 0.17, 0.09, { seg: 6 });
    }
  }
  // crown: a deep box beam with bolt rows, a walkway and railings
  const cy = top - crownH / 2;
  B.box('body', P(0, cy, 0), [W / 2 + 0.15, crownH / 2, ud + 0.1], { ch: 0.06 });
  for (const s of [-1, 1]) for (let i = 0; i < 18; i++) B.hexBolt('bolt', P(-W / 2 + 0.3 + i * (W - 0.6) / 17, cy + s * (crownH / 2 - 0.12), ud + 0.1 + 0.03), 0.035, { M: [[1, 0, 0], [0, 0, 1], [0, -1, 0]], len: 0.05 });
  housingFace(B, r, P, [0, cy, ud + 0.1], [W / 2 - 0.2, crownH / 2 - 0.3], 'z', detail, minSize, 1);
  // hydraulic cylinders on top
  const nC = W > 7 ? 3 : 2;
  for (let i = 0; i < nC; i++) {
    const x = lerp(-W * 0.28, W * 0.28, nC === 1 ? 0.5 : i / (nC - 1)), R = Math.min(0.55, W * 0.07), hC = Hh * 0.18;
    B.cyl('paint2', P(x, top + hC / 2, 0), R, hC / 2);
    for (const fy of [top + 0.1, top + hC - 0.1]) { B.cyl('paint2', P(x, fy, 0), R * 1.18, 0.07); for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; B.hexBolt('bolt', P(x + Math.cos(a) * R * 1.1, fy + 0.08, Math.sin(a) * R * 1.1), 0.028); } }
    B.cyl('steel', P(x, top + hC + 0.15, 0), R * 0.35, 0.15);
    // hoses down to the manifold
    B.pipe('dark', P(x + R * 0.9, top + hC * 0.7, 0), P(W / 2 + 0.5, base + 1.6, ud * 0.4 + i * 0.25), 0.045, { via: P(0, top + hC * 0.7, 0) });
  }
  // ram (slide) between the uprights, with a die set
  const ramY = base + bedH + (top - crownH - base - bedH) * 0.55, ramH = 1.2;
  B.box('paint2', P(0, ramY, 0), [W / 2 - uw - 0.06, ramH / 2, D * 0.33], { ch: 0.04 });
  housingFace(B, r, P, [0, ramY, D * 0.33], [W / 2 - uw - 0.3, ramH / 2 - 0.2], 'z', detail, minSize, 2);
  B.box('steel', P(0, ramY - ramH / 2 - 0.25, 0), [W / 2 - uw - 0.4, 0.25, D * 0.28], { ch: 0.02 });
  B.box('steel', P(0, base + bedH + 0.35, 0), [W / 2 - uw - 0.4, 0.23, D * 0.28], { ch: 0.02 });
  for (const s of [-1, 1]) for (const t of [-1, 1]) B.cyl('steel', P(s * (W / 2 - uw - 0.7), base + bedH + 0.9, t * D * 0.2), 0.06, 0.4);   // guide pins
  // walkway on the crown with railings and a ladder down the side
  walkway(B, P, [-W / 2 - 0.1, top + 0.02, ud + 0.12], W + 0.2, 0.9);
  ladder(B, P, [W / 2 + 0.35, base, ud * 0.4], top - base);
  // side manifold: a valve block, gauges and conduits
  B.box('paint2', P(W / 2 + 0.55, base + 1.4, ud * 0.55), [0.28, 0.5, 0.35], { ch: 0.03 });
  for (let i = 0; i < 3; i++) gauge(B, P(W / 2 + 0.84, base + 1.2 + i * 0.28, ud * 0.55 - 0.18 + i * 0.12), 0.07, [1, 0, 0]);
  for (let i = 0; i < 4; i++) B.pipe('copper', P(W / 2 + 0.3, base + 0.9, ud * 0.3 - i * 0.12), P(W / 2 - uw * 0.2, top - crownH - 0.3, ud * 0.2 - i * 0.12), 0.018, { via: P(0, base + 0.5 + i * 0.1, 0) });
}
function turbine(B, r, P, W, Hh, D, base, detail, minSize) {
  const R = Math.min(Hh, D) * 0.38, cy = base + R + 0.9, L = W * 0.8, nSeg = 5, M = [[0, 1, 0], [1, 0, 0], [0, 0, 1]];
  for (let i = 0; i < nSeg; i++) {
    const x = -L / 2 + (i + 0.5) * L / nSeg, rr = R * (0.85 + 0.15 * Math.sin(i / (nSeg - 1) * Math.PI));
    B.cyl(i % 2 ? 'body' : 'paint2', P(x, cy, 0), rr, L / nSeg / 2 - 0.05, { M, seg: 48 });
    B.cyl('body', P(x + L / nSeg / 2, cy, 0), rr * 1.07, 0.06, { M, seg: 48 });
    for (let k = 0; k < 28; k++) { const a = k / 28 * Math.PI * 2; B.hexBolt('bolt', P(x + L / nSeg / 2 + 0.07, cy + Math.cos(a) * rr * 1.03, Math.sin(a) * rr * 1.03), 0.03, { M }); }
  }
  // horizontal split flange along the casing
  B.box('body', P(0, cy, R * 1.0), [L / 2, 0.07, 0.12], { ch: 0.02 });
  for (let i = 0; i < 40; i++) B.hexBolt('bolt', P(-L / 2 + (i + 0.5) * L / 40, cy + 0.09, R * 1.0 + 0.06), 0.03);
  // pedestals
  for (const x of [-L / 2 - 0.5, L / 2 + 0.5]) { B.box('body', P(x, (base + cy) / 2, 0), [0.45, (cy - base) / 2, R * 0.8], { ch: 0.04 }); B.cyl('steel', P(x, cy, 0), R * 0.3, 0.55, { M }); }
  // exhaust hood and steam pipes
  B.box('paint2', P(L / 2 - 0.8, cy + R + 0.8, 0), [0.9, 0.8, R * 0.7], { ch: 0.05 });
  B.pipe('body', P(-L / 4, cy + R * 0.9, 0), P(-L / 4, Hh + 2, -D / 2), 0.35, { flangeMat: 'body', boltMat: 'bolt' });
  B.pipe('body', P(L / 4, cy + R * 0.9, 0), P(L / 4 + 1, Hh + 2, -D / 2), 0.3, { flangeMat: 'body', boltMat: 'bolt' });
  walkway(B, P, [-L / 2, cy + R + 0.1, R + 0.4], L, 1.0);
}
function walkway(B, P, o, L, w) {
  B.box('steel', P(o[0] + L / 2, o[1], o[2] + w / 2), [L / 2, 0.02, w / 2], { ch: 0.004 });
  const n = Math.max(2, Math.round(L / 1.5));
  for (let i = 0; i <= n; i++) { const x = o[0] + i * L / n; B.box('hazard', P(x, o[1] + 0.55, o[2] + w), [0.025, 0.55, 0.025], { ch: 0.004, occ: false }); }
  for (const hy of [0.55, 1.08]) B.box('hazard', P(o[0] + L / 2, o[1] + hy, o[2] + w), [L / 2, 0.022, 0.022], { ch: 0.004, occ: false });
  B.box('hazard', P(o[0] + L / 2, o[1] + 0.08, o[2] + w), [L / 2, 0.06, 0.006], { ch: 0.002, occ: false });   // toe board
}
function ladder(B, P, o, H) {
  for (const s of [-0.22, 0.22]) B.box('hazard', P(o[0], o[1] + H / 2, o[2] + s), [0.025, H / 2, 0.025], { ch: 0.004, occ: false });
  for (let y = 0.3; y < H; y += 0.3) B.cyl('steel', P(o[0], o[1] + y, o[2]), 0.014, 0.22, { M: [[1, 0, 0], [0, 0, 1], [0, -1, 0]], occ: false, seg: 6 });
  for (let y = 2.2; y < H - 0.5; y += 0.9) B.torus('hazard', P(o[0] + 0.35, o[1] + y, o[2]), 0.36, 0.014, { arc: Math.PI, M: [[0, 0, 1], [1, 0, 0], [0, 1, 0]] });   // cage hoops
}
function gauge(B, c, rad, n) {
  const M = basisY(n);
  B.cyl('black', c, rad, 0.025, { M, occ: false }); B.cyl('glass', add(c, scale(n, 0.027)), rad * 0.86, 0.004, { M, occ: false, caps: true });
  B.cyl('steel', add(c, scale(n, 0.02)), rad * 1.08, 0.012, { M, occ: false });
}
// A face of a scope, panelised: split into plates (inset), rivet rows on the big ones, louvres / gauges / boxes / valves.
function housingFace(B, r, P, c, h, axis, detail, minSize, depth) {
  const n = axis === 'z' ? [0, 0, 1] : axis === '-z' ? [0, 0, -1] : axis === 'x' ? [1, 0, 0] : [-1, 0, 0];
  const U = axis.includes('z') ? [1, 0, 0] : [0, 0, 1];
  const place = (u, v, off) => [c[0] + U[0] * u + n[0] * off, c[1] + v, c[2] + U[2] * u + n[2] * off];
  const hU = h[0], hV = h[1];
  if (hU < minSize || hV < minSize || depth > 4) return;
  // split along the longer side into 2-4 panels with a seam
  const alongU = hU >= hV, k = 2 + Math.floor(r() * (alongU ? 3 : 2)), gap = 0.025;
  for (let i = 0; i < k; i++) {
    const a = -1 + (2 * i + 1) / k, pu = alongU ? a * hU : 0, pv = alongU ? 0 : a * hV, qu = alongU ? hU / k - gap : hU - gap, qv = alongU ? hV - gap : hV / k - gap;
    if (qu < minSize * 0.5 || qv < minSize * 0.5) continue;
    const roll = r();
    const halfN = (hn) => axis.includes('z') ? [qu, qv, hn] : [hn, qv, qu];
    // the plate: an inset (or raised) panel
    const raised = roll < 0.55; const t = 0.018;
    B.box(depth % 2 ? 'paint2' : 'body', place(pu, pv, raised ? t : -t * 0.4), halfN(t), { ch: 0.008, occ: false });
    // rivet or bolt rows along the edges of big panels
    if (qu > 0.35 && qv > 0.35 && detail > 0.5) {
      const nr = Math.floor(qu * 2 / 0.14), nv = Math.floor(qv * 2 / 0.14);
      for (let j = 0; j <= nr; j++) for (const sv of [-1, 1]) B.hexBolt('bolt', place(pu - qu + 0.05 + j * (qu * 2 - 0.1) / nr, pv + sv * (qv - 0.05), (raised ? 2 * t : 0) + 0.008), 0.014, { M: basisY(n), len: 0.016 });
      for (let j = 1; j < nv; j++) for (const su of [-1, 1]) B.hexBolt('bolt', place(pu + su * (qu - 0.05), pv - qv + 0.05 + j * (qv * 2 - 0.1) / nv, (raised ? 2 * t : 0) + 0.008), 0.014, { M: basisY(n), len: 0.016 });
    }
    const off0 = (raised ? 2 * t : 0);
    if (roll < 0.22 && qv > 0.3 && qu > 0.3) {                // louvres
      const nl = Math.floor(qv * 2 / 0.07); for (let j = 0; j < nl; j++) { const v = pv - qv * 0.8 + j * qv * 1.6 / nl;
        B.box('dark', place(pu, v, off0 + 0.012), halfN(0.012).map((x, ii) => (axis.includes('z') ? [qu * 0.8, 0.012, 0.014][ii] : [0.014, 0.012, qu * 0.8][ii])), { ch: 0.003, occ: false }); }
    } else if (roll < 0.34 && qu > 0.2) {                      // a gauge cluster
      const ng = 1 + Math.floor(r() * 3); for (let j = 0; j < ng; j++) gauge(B, place(pu - qu * 0.5 + j * qu * 0.5, pv + qv * 0.3, off0 + 0.02), Math.min(0.09, qu * 0.2), n);
    } else if (roll < 0.46 && qu > 0.25 && qv > 0.25) {       // a junction box with a conduit
      const jb = [Math.min(0.2, qu * 0.4), Math.min(0.25, qv * 0.5)];
      B.box('paint2', place(pu, pv, off0 + 0.06), axis.includes('z') ? [jb[0], jb[1], 0.06] : [0.06, jb[1], jb[0]], { ch: 0.012, occ: false });
      B.cyl('dark', place(pu, pv - jb[1] - 0.2, off0 + 0.06), 0.022, 0.2, { occ: false });
    } else if (roll < 0.55 && qu > 0.3) {                     // a valve with a handwheel
      const vc = place(pu, pv, off0 + 0.14); B.cyl('dark', place(pu, pv, off0 + 0.07), 0.04, 0.07, { M: basisY(n), occ: false });
      B.torus('paint2', vc, Math.min(0.14, qu * 0.35), 0.012, { M: [U, n, cross(U, n)] });
      for (let s2 = 0; s2 < 3; s2++) { const a2 = s2 / 3 * Math.PI * 2; B.cyl('paint2', add(vc, scale(add(scale(U, Math.cos(a2)), [0, Math.sin(a2), 0]), Math.min(0.14, qu * 0.35) / 2)), 0.008, Math.min(0.14, qu * 0.35) / 2, { M: basisY(norm(add(scale(U, Math.cos(a2)), [0, Math.sin(a2), 0]))), occ: false, seg: 6 }); }
    } else if (qu > minSize * 2 && qv > minSize * 2) {       // recurse
      housingFace(B, r, P, place(pu, pv, off0), [qu - 0.06, qv - 0.06], axis, detail, minSize, depth + 1);
    }
  }
}
function housing(B, r, P, c, h, detail, minSize, depth) {
  B.box('body', P(c[0], c[1], c[2]), h, { ch: 0.05 });
  housingFace(B, r, P, [c[0], c[1], c[2] + h[2]], [h[0] - 0.08, h[1] - 0.08], 'z', detail, minSize, 0);
  housingFace(B, r, P, [c[0] + h[0], c[1], c[2]], [h[2] - 0.08, h[1] - 0.08], 'x', detail, minSize, 0);
  housingFace(B, r, P, [c[0] - h[0], c[1], c[2]], [h[2] - 0.08, h[1] - 0.08], '-x', detail, minSize, 0);
}

// ---------------------------------------------------------------- city rules
// ext attribute per vertex: [floorH, bayW, litSeed, kind] (kind: 0 facade, 1 roof/plant, 2 street)
export function city({ seed = 7, blocks = [8, 8], block = 60, street = 16, style = 'deco', centre = [0, 0], hMax = 180, minLot = 14 } = {}) {
  const B = new Builder(seed), r = B.r;
  const nx = blocks[0], nz = blocks[1], pitch = block + street;
  const x0 = centre[0] - nx * pitch / 2, z0 = centre[1] - nz * pitch / 2;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const bx = x0 + i * pitch + street / 2, bz = z0 + j * pitch + street / 2;
    const dC = Math.hypot(bx + block / 2 - centre[0], bz + block / 2 - centre[1]) / (Math.max(nx, nz) * pitch / 2);
    // sidewalk slab
    B.box('pavement', [bx + block / 2, 0.08, bz + block / 2], [block / 2 + 2, 0.08, block / 2 + 2], { ch: 0.05, occ: false, ext: [0, 0, 0, 2] });
    // lots by recursive split
    const lots = []; const split = (x, z, w, d, dep) => {
      if ((w < minLot * 2 && d < minLot * 2) || dep > 4 || (dep > 1 && r() < 0.25)) { lots.push([x, z, w, d]); return; }
      if (w >= d) { const f = lerp(0.35, 0.65, r()); split(x, z, w * f, d, dep + 1); split(x + w * f, z, w * (1 - f), d, dep + 1); }
      else { const f = lerp(0.35, 0.65, r()); split(x, z, w, d * f, dep + 1); split(x, z + d * f, w, d * (1 - f), dep + 1); }
    };
    split(bx, bz, block, block, 0);
    for (const [lx, lz, lw, ld] of lots) {
      const setback = 1.2, w = lw - setback * 2, d = ld - setback * 2; if (w < 6 || d < 6) continue;
      const cx = lx + lw / 2, cz = lz + ld / 2;
      const tall = Math.pow(Math.max(0, 1 - dC), 1.6) * hMax * lerp(0.45, 1.1, r()) + lerp(8, 22, r());
      building(B, r, [cx, 0.16, cz], [w / 2, d / 2], tall, style, dC);
    }
  }
  // streets
  const S = nx * pitch + 400;
  B.box('street', [centre[0], -0.05, centre[1]], [S / 2, 0.05, S / 2], { ch: 0, occ: false, ext: [0, 0, 0, 2] });
  return B;
}
function building(B, r, base, half, H, style, dC) {
  const floorH = style === 'brutal' ? 3.4 : lerp(3.3, 4.2, r()), bay = lerp(1.6, 3.2, r()), seed = r();
  const ext = [floorH, bay, seed, 0], extR = [floorH, bay, seed, 1];
  let [hx, hz] = half, y = base[1], h = H;
  const tiers = H > 70 ? 2 + Math.floor(r() * 3) : H > 35 ? 1 + Math.floor(r() * 2) : 1;
  for (let t = 0; t < tiers; t++) {
    const th = t === tiers - 1 ? h : h * lerp(0.45, 0.65, r()); const hh = Math.max(floorH, Math.round(th / floorH) * floorH);
    B.box('facade', [base[0], y + hh / 2, base[2]], [hx, hh / 2, hz], { ch: 0.15, ext });
    // base course / podium band and cornice at the top of the tier
    B.box('trim', [base[0], y + hh - 0.4, base[2]], [hx + 0.35, 0.4, hz + 0.35], { ch: 0.08, ext: extR, occ: false });
    if (t === 0) B.box('trim', [base[0], y + Math.min(hh, 4.5) / 2, base[2]], [hx + 0.2, Math.min(hh, 4.5) / 2, hz + 0.2], { ch: 0.06, ext: [floorH, bay, seed, 3], occ: false });
    // vertical fins or pilasters (deco: stepped piers; brutal: deep precast fins)
    if (style === 'deco' || style === 'brutal') {
      const fin = style === 'brutal' ? 0.55 : 0.28, spacing = bay * (style === 'brutal' ? 1 : 2);
      for (const [ax, L, sgn] of [[0, hx, 1], [0, hx, -1], [1, hz, 1], [1, hz, -1]]) {
        const n = Math.floor(L * 2 / spacing); if (n < 2 || n > 40) continue;
        for (let k = 1; k < n; k++) { const u = -L + k * L * 2 / n;
          const c = ax === 0 ? [base[0] + u, y + hh / 2, base[2] + sgn * (hz + fin / 2)] : [base[0] + sgn * (hx + fin / 2), y + hh / 2, base[2] + u];
          B.box('trim', c, ax === 0 ? [0.12, hh / 2 - 0.4, fin / 2] : [fin / 2, hh / 2 - 0.4, 0.12], { ch: 0.03, ext: extR, occ: false }); }
      }
    }
    y += hh;
    if (t < tiers - 1) { hx *= lerp(0.62, 0.82, r()); hz *= lerp(0.62, 0.82, r()); h -= hh; }
  }
  // roof plant: water tank, units, stair housing, masts
  const nPlant = 1 + Math.floor(r() * 4);
  for (let k = 0; k < nPlant; k++) {
    const px = base[0] + (r() - 0.5) * hx, pz = base[2] + (r() - 0.5) * hz, kind = r();
    if (kind < 0.3 && H < 60) { B.cyl('dark', [px, y + 3.2, pz], 1.6, 1.2, { ext: extR }); for (let l = 0; l < 4; l++) B.box('dark', [px + (l < 2 ? -1 : 1) * 1.1, y + 1, pz + (l % 2 ? -1 : 1) * 1.1], [0.08, 1, 0.08], { occ: false, ext: extR }); B.cyl('dark', [px, y + 4.6, pz], 1.7, 0.2, { r2: 0.2, ext: extR }); }
    else if (kind < 0.7) B.box('plant', [px, y + 0.9, pz], [lerp(0.8, 2.2, r()), 0.9, lerp(0.8, 2.2, r())], { ch: 0.05, ext: extR });
    else B.box('plant', [px, y + 1.6, pz], [1.4, 1.6, 2.0], { ch: 0.05, ext: extR });
  }
  if (H > 90 && r() < 0.6) { B.cyl('dark', [base[0], y + 12, base[2]], 0.25, 12, { r2: 0.05, ext: [floorH, bay, seed, 4] }); }
}

// ---------------------------------------------------------------- bake occlusion + build meshes
export function bakeAO(B, { res = 160, rays = 14, maxDist = null } = {}) {
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const b of B.boxes) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], b[i]); mx[i] = Math.max(mx[i], b[i + 3]); }
  const ext = sub(mx, mn), cell = Math.max(ext[0], ext[1], ext[2]) / res, n = ext.map(e => Math.max(1, Math.ceil(e / cell)));
  const G = new Uint8Array(n[0] * n[1] * n[2]), gi = (i, j, k) => (k * n[1] + j) * n[0] + i;
  for (const b of B.boxes) {
    const i0 = Math.max(0, Math.floor((b[0] - mn[0]) / cell)), i1 = Math.min(n[0] - 1, Math.floor((b[3] - mn[0]) / cell - 1e-6));
    const j0 = Math.max(0, Math.floor((b[1] - mn[1]) / cell)), j1 = Math.min(n[1] - 1, Math.floor((b[4] - mn[1]) / cell - 1e-6));
    const k0 = Math.max(0, Math.floor((b[2] - mn[2]) / cell)), k1 = Math.min(n[2] - 1, Math.floor((b[5] - mn[2]) / cell - 1e-6));
    if (b[3] - b[0] < cell * 0.5 || b[4] - b[1] < cell * 0.5 || b[5] - b[2] < cell * 0.5) continue;     // thin parts do not occlude
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) G[gi(i, j, k)] = 1;
  }
  const occ = (x, y, z) => { const i = Math.floor((x - mn[0]) / cell), j = Math.floor((y - mn[1]) / cell), k = Math.floor((z - mn[2]) / cell);
    if (i < 0 || j < 0 || k < 0 || i >= n[0] || j >= n[1] || k >= n[2]) return j < 0 ? 1 : 0; return G[gi(i, j, k)]; };
  const dirs = []; const rr = mulberry(99); for (let i = 0; i < rays; i++) { const u = rr(), v = rr(), th = Math.acos(Math.sqrt(1 - u)), ph = v * Math.PI * 2; dirs.push([Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]); }
  const steps = 12, md = maxDist || cell * 24;
  for (const mat in B.parts) {
    const P = B.parts[mat], nv = P.pos.length / 3, ao = new Float32Array(nv);
    for (let v = 0; v < nv; v++) {
      const p = [P.pos[v * 3], P.pos[v * 3 + 1], P.pos[v * 3 + 2]], nn = [P.nrm[v * 3], P.nrm[v * 3 + 1], P.nrm[v * 3 + 2]];
      const [T, , Bt] = basisY(nn); let hit = 0;
      for (const d of dirs) { const w = add(add(scale(T, d[0]), scale(nn, d[1])), scale(Bt, d[2]));
        for (let s = 1; s <= steps; s++) { const t = cell * 0.9 + (s / steps) ** 1.6 * md; if (occ(p[0] + nn[0] * cell * 0.75 + w[0] * t, p[1] + nn[1] * cell * 0.75 + w[1] * t, p[2] + nn[2] * cell * 0.75 + w[2] * t)) { hit += 1 - 0.5 * s / steps; break; } } }
      ao[v] = 1 - hit / dirs.length;
    }
    P.ao = ao;
  }
  return B;
}

// materials: a set of MeshStandardMaterials patched for baked AO, edge wear on the chamfers, grime by height, and
// (city) a window grid in the facade shader. MATS.mill(), MATS.city({ night }), or your own map of name -> material.
function patch(m, { wear = 0.5, grime = 0.4, windows = false, night = 0, streets = 0, pitch = 76, street = 16, lit = new THREE.Color(1, 0.72, 0.4), glass = new THREE.Color(0.1, 0.12, 0.16) } = {}) {
  m.onBeforeCompile = sh => {
    sh.uniforms.uWear = { value: wear }; sh.uniforms.uGrime = { value: grime }; sh.uniforms.uNight = { value: night }; sh.uniforms.uLit = { value: lit }; sh.uniforms.uGlass = { value: glass }; sh.uniforms.uStreets = { value: streets }; sh.uniforms.uPitch = { value: new THREE.Vector2(pitch, street) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aAO; attribute vec4 aExt; varying float vAO; varying vec4 vExt; varying vec3 vWp; varying vec3 vWn;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = aAO; vExt = aExt; vWp = (modelMatrix * vec4(position, 1.0)).xyz; vWn = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uWear, uGrime, uNight, uStreets; uniform vec2 uPitch; uniform vec3 uLit, uGlass; varying float vAO; varying vec4 vExt; varying vec3 vWp; varying vec3 vWn;
      float gh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float gn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(mix(gh(i), gh(i+vec3(1,0,0)), f.x), mix(gh(i+vec3(0,1,0)), gh(i+vec3(1,1,0)), f.x), f.y), mix(mix(gh(i+vec3(0,0,1)), gh(i+vec3(1,0,1)), f.x), mix(gh(i+vec3(0,1,1)), gh(i+vec3(1,1,1)), f.x), f.y), f.z); }
      float winMask = 0.0; float winLit = 0.0; vec3 winTint = vec3(1.0);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 an = abs(vWn); float edge = 1.0 - max(an.x, max(an.y, an.z));                     // chamfer faces
        float n1 = gn(vWp * 7.0), n2 = gn(vWp * 1.3 + 4.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.54, 0.52), uWear * smoothstep(0.12, 0.3, edge) * smoothstep(0.35, 0.7, n1));
        diffuseColor.rgb *= 1.0 - uGrime * (0.55 * (1.0 - vAO) + 0.25 * smoothstep(0.4, 0.9, n2) * (1.0 - an.y));
        diffuseColor.rgb *= 0.92 + 0.16 * n2;
        ${windows ? `
        if (vExt.w < 0.5 && an.y < 0.5) {
          vec2 fp = vec2(dot(vWp.xz, an.x > an.z ? vec2(0.0, 1.0) : vec2(1.0, 0.0)), vWp.y);
          vec2 cellId = floor(vec2(fp.x / vExt.y, fp.y / vExt.x)); vec2 f = fract(vec2(fp.x / vExt.y, fp.y / vExt.x));
          float win = step(0.14, f.x) * step(f.x, 0.86) * step(0.28, f.y) * step(f.y, 0.9) * step(4.6, vWp.y);
          float mull = step(abs(f.x - 0.5), 0.02);
          winMask = win * (1.0 - mull);
          float s = gh(vec3(cellId, floor(vExt.z * 97.0)));
          float lit = step(1.0 - 0.34 * uNight, s) * (0.35 + 0.65 * gh(vec3(cellId + 3.1, 1.0)));
          // blinds / curtains: some lit windows are half covered
          lit *= mix(1.0, step(f.y, 0.62), step(0.7, gh(vec3(cellId + 7.7, 2.0))));
          winLit = winMask * lit;
          float tone = gh(vec3(cellId + 1.3, 5.0));
          winTint = tone < 0.6 ? vec3(1.0, 0.68, 0.36) : tone < 0.85 ? vec3(0.85, 0.9, 1.0) : vec3(1.0, 0.45, 0.25);
          // unlit glass reflects the sky: lighter toward the top of the building, a little noise per pane
          vec3 refl = uGlass * (0.7 + 0.6 * gh(vec3(cellId, 9.0))) * (0.8 + 0.004 * vWp.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, refl, winMask * 0.92);
          // spandrel and sill shading between floors
          diffuseColor.rgb *= 1.0 - 0.18 * smoothstep(0.06, 0.0, abs(f.y - 0.22));
        }` : ''}
      }`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= vAO; reflectedLight.indirectSpecular *= vAO;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${windows ? 'totalEmissiveRadiance += uLit * winTint * winLit * uNight * 2.6;' : ''}
        if (uStreets > 0.0) { vec2 q = mod(vWp.xz + uPitch.y * 0.5, uPitch.x); vec2 dd = min(q, uPitch.x - q);
          float lane = max(smoothstep(uPitch.y * 0.5, 0.0, dd.x), smoothstep(uPitch.y * 0.5, 0.0, dd.y));
          float lamps = max(smoothstep(0.35, 0.0, abs(mod(vWp.x, 18.0) - 9.0) / 9.0) * smoothstep(3.0, 0.0, abs(dd.y - uPitch.y * 0.42)), smoothstep(0.35, 0.0, abs(mod(vWp.z, 18.0) - 9.0) / 9.0) * smoothstep(3.0, 0.0, abs(dd.x - uPitch.y * 0.42)));
          totalEmissiveRadiance += vec3(1.0, 0.55, 0.2) * uStreets * (lane * 0.18 + lamps * 1.6); }`);
  };
  return m;
}
export const MATS = {
  mill: ({ body = '#2e3a44', paint2 = '#8a2a1e', wear = 0.6, grime = 0.5 } = {}) => ({
    body: patch(new THREE.MeshStandardMaterial({ color: body, metalness: 0.35, roughness: 0.55 }), { wear, grime }),
    paint2: patch(new THREE.MeshStandardMaterial({ color: paint2, metalness: 0.3, roughness: 0.5 }), { wear, grime }),
    steel: patch(new THREE.MeshStandardMaterial({ color: '#b8bcc0', metalness: 1, roughness: 0.22 }), { wear: 0, grime: 0.2 }),
    dark: patch(new THREE.MeshStandardMaterial({ color: '#1a1a1c', metalness: 0.2, roughness: 0.7 }), { wear: 0.2, grime: 0.2 }),
    bolt: patch(new THREE.MeshStandardMaterial({ color: '#5a5c60', metalness: 0.9, roughness: 0.35 }), { wear: 0.8, grime: 0.3 }),
    hazard: patch(new THREE.MeshStandardMaterial({ color: '#e8b40c', metalness: 0.1, roughness: 0.5 }), { wear: 0.7, grime: 0.5 }),
    black: patch(new THREE.MeshStandardMaterial({ color: '#121212', roughness: 0.6 }), { wear: 0.5, grime: 0.2 }),
    glass: new THREE.MeshStandardMaterial({ color: '#d8e0e0', metalness: 0, roughness: 0.05 }),
    copper: patch(new THREE.MeshStandardMaterial({ color: '#c07040', metalness: 1, roughness: 0.3 }), { wear: 0, grime: 0.3 }),
    concrete: patch(new THREE.MeshStandardMaterial({ color: '#8a8680', roughness: 0.95 }), { wear: 0.3, grime: 0.6 }),
  }),
  city: ({ night = 0, facade = '#b8b0a4', trim = '#cfc8bc', grime = 0.35, glass = '#1a2230' } = {}) => ({
    facade: patch(new THREE.MeshStandardMaterial({ color: facade, roughness: 0.85 }), { wear: 0.2, grime, windows: true, night, glass: new THREE.Color(glass) }),
    trim: patch(new THREE.MeshStandardMaterial({ color: trim, roughness: 0.8 }), { wear: 0.3, grime }),
    plant: patch(new THREE.MeshStandardMaterial({ color: '#8a8a88', metalness: 0.4, roughness: 0.6 }), { wear: 0.3, grime }),
    dark: patch(new THREE.MeshStandardMaterial({ color: '#3a3430', metalness: 0.3, roughness: 0.7 }), { wear: 0.2, grime }),
    pavement: patch(new THREE.MeshStandardMaterial({ color: '#7a7670', roughness: 0.95 }), { wear: 0, grime: 0.3 }),
    street: patch(new THREE.MeshStandardMaterial({ color: '#2a2a2c', roughness: 0.9 }), { wear: 0, grime: 0.2, streets: night }),
  }),
};
export function buildMeshes(B, { mats, ao = true, aoRes = 160, shadows = true } = {}) {
  if (ao && !Object.values(B.parts).some(p => p.ao)) bakeAO(B, { res: aoRes });
  const g = new THREE.Group(); g.userData.stats = { terminals: B.count, verts: 0 };
  for (const name in B.parts) {
    const P = B.parts[name], geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P.pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(P.nrm, 3));
    geo.setAttribute('aAO', new THREE.BufferAttribute(P.ao || new Float32Array(P.pos.length / 3).fill(1), 1)); geo.setAttribute('aExt', new THREE.Float32BufferAttribute(P.ext, 4));
    const m = new THREE.Mesh(geo, (mats && mats[name]) || new THREE.MeshStandardMaterial({ color: '#888' }));
    m.castShadow = shadows; m.receiveShadow = shadows; m.name = name; g.add(m); g.userData.stats.verts += P.pos.length / 3;
  }
  return g;
}
export { Builder };
