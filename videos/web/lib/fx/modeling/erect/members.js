// ERECT members (MODELING c4): structural steel as it is really made, batched for the GPU.
//
// Why: c3's FRAME was round tubes meeting at plate-textured cubes, which reads as scaffold or a toy construction set. What makes
// Eiffel's armature inside Liberty (and every riveted bridge, crane and blast-furnace frame) read as CONSTRUCTION is the member:
// four angle-iron chords, flat lacing bars riveted across them in a zigzag or an X, gusset plates where the lacing meets the chord,
// batten (tie) plates at the ends, plate girders with stiffeners and flange angles. This file makes those members and the plates
// hung on them, and puts every piece of one segment into one merged mesh per paint system, so a 50 m giant is ~60 draw calls.
//
// Every vertex carries what the material stack (steel.js) and the build need:
//   aStage (thr, paint, wear)   thr: build progress at which the piece is hung; paint: progress at which its primer gets the top
//                               coat (> 1 = left in red lead on the finished giant); wear: how much use this piece gets (0..1)
//   aPlate (u, v, w, h)         plate-local metres and the plate's size: the shader draws rivet rows inset from its edges
//   aEdge                       1 on the chamfered (flame-cut) edges: where paint wears off first
//   aAO                         designed occlusion: deep inside a column, facing inward, close to a joint = darker
//   aRand                       one random number per piece (tone, rust amount)
//
//   const B = new Batch();  latticeColumn(B, {...});  B.push('plate', geo, { thr, paint, wear });  const g = B.build(MATS);
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t, clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- primitives (centred, local frame)
// a box with 45-degree chamfers on its edges (flame-cut plate, not filleted plastic)
export function cbox(w, h, d, c = .06) {
  c = Math.max(.004, Math.min(c, w * .3, h * .3, d * .3)); const x = w / 2 - c, y = h / 2 - c, s = new THREE.Shape();
  s.moveTo(-x, -y); s.lineTo(x, -y); s.lineTo(x, y); s.lineTo(-x, y); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(.002, d - 2 * c), bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -(d - 2 * c) / 2); g.clearGroups(); g.deleteAttribute('uv'); return g;
}
export function cyl(r, len, seg = 20, r2 = null) { const g = new THREE.CylinderGeometry(r2 ?? r, r, len, seg, 1); g.deleteAttribute('uv'); return g.toNonIndexed(); }
export function cylX(r, len, seg = 20) { const g = cyl(r, len, seg); g.rotateZ(Math.PI / 2); return g; }
export function cylZ(r, len, seg = 20) { const g = cyl(r, len, seg); g.rotateX(Math.PI / 2); return g; }
// an extruded section (points in x/z) along y from 0 to len
export function prismY(pts, len, bevel = 0) {
  const s = new THREE.Shape(); pts.forEach(([x, z], i) => i ? s.lineTo(x, -z) : s.moveTo(x, -z)); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); g.clearGroups(); g.deleteAttribute('uv'); return g;
}
// matrix that takes a member built along local +y (centred, length |B-A|) to the segment A..B, local z toward `face`
export function along(A, B, face = V3(0, 0, 1)) {
  const y = B.clone().sub(A), L = y.length(); y.normalize();
  let z = face.clone().addScaledVector(y, -face.dot(y)); if (z.lengthSq() < 1e-6) z = Math.abs(y.x) < .9 ? V3(1, 0, 0) : V3(0, 0, 1); z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize(); z.crossVectors(x, y).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z); m.setPosition(A.clone().add(B).multiplyScalar(.5)); return { m, L };
}

// ---------------------------------------------------------------- the batch
const SYS_DEFAULT = 'frame';
export class Batch {
  // rivets (c5): { r, p, sys } puts real snap-head domes (geometry) on every plate pushed with plateAt, so they cast a pip and a
  // shadow under a raking sun (a shader bump has no silhouette); null keeps c4's bump-only rivets
  constructor({ seed = 1, tile = 4, quant = 0, side = 0, rivets = null } = {}) { this.lists = {}; this.R = rng(seed); this.tile = tile; this.count = 0; this.quant = quant; this.side = side; this.pieces = []; this.rivets = rivets; this.nRivets = 0; }
  q(thr) { return this.quant && thr > 0 && thr <= 1 ? (Math.floor(Math.min(thr, .9999) * this.quant) + .5) / this.quant : thr; }
  // geo: built in its own local frame; m: Matrix4 into the batch's (segment's) frame
  // o: { thr, paint, wear, plate: [w, h] (plate size for rivet rows; the local x/y of the geo are the plate's), edge: true, ao: fn(p, n) -> 0..1, rand }
  push(sys, geo, m = null, o = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone(); if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count, P = g.attributes.position, N = g.attributes.normal;
    const edge = new Float32Array(n), plate = new Float32Array(n * 4);
    const pw = o.plate ? o.plate[0] : 0, ph = o.plate ? o.plate[1] : 0, px = o.plateAxes || 'xy';
    for (let i = 0; i < n; i++) {
      const nx = Math.abs(N.getX(i)), ny = Math.abs(N.getY(i)), nz = Math.abs(N.getZ(i)), mx = Math.max(nx, ny, nz);
      edge[i] = o.edge === false ? 0 : (o.edge === 1 ? 1 : clamp((1 - mx - .06) / .14));
      if (pw > 0) { const u = px === 'xy' ? P.getX(i) : px === 'zy' ? P.getZ(i) : P.getX(i), v = px === 'xz' ? P.getZ(i) : P.getY(i); plate[i * 4] = u + pw / 2; plate[i * 4 + 1] = v + ph / 2; plate[i * 4 + 2] = pw; plate[i * 4 + 3] = ph; }
    }
    if (m) g.applyMatrix4(m);
    const thrQ = this.q(o.thr ?? 0); o = { ...o, thr: thrQ };
    g.computeBoundingBox(); const diag = g.boundingBox.getSize(new THREE.Vector3()).length(), drop = o.noLift ? 0 : (o.drop ?? (diag > 3.6 ? 1 : 0));
    if (drop) { const c = g.boundingBox.getCenter(new THREE.Vector3()); this.pieces.push({ thr: thrQ, c, sys, diag }); }
    const stage = new Float32Array(n * 4), ao = new Float32Array(n), rnd = new Float32Array(n), rest = new Float32Array(n), r = o.rand ?? this.R();
    const p = new THREE.Vector3(), nn = new THREE.Vector3();
    // c5: a batch-wide default paint for frame and plate pieces that did not say (the red-lead upper body)
    const paintV = o.paint ?? ((sys === 'frame' || sys === 'plate') && this.defPaint != null ? this.defPaint : -1);
    for (let i = 0; i < n; i++) {
      stage[i * 4] = o.thr ?? 0; stage[i * 4 + 1] = paintV; stage[i * 4 + 2] = o.wear ?? .3; stage[i * 4 + 3] = drop; rnd[i] = r; rest[i] = o.rest ?? g.attributes.position.getY(i);
      if (o.ao) { p.fromBufferAttribute(g.attributes.position, i); nn.fromBufferAttribute(g.attributes.normal, i); ao[i] = clamp(o.ao(p, nn)); } else ao[i] = o.aoConst ?? 1;
    }
    g.setAttribute('aStage', new THREE.BufferAttribute(stage, 4)); g.setAttribute('aPlate', new THREE.BufferAttribute(plate, 4));
    g.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1)); g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1)); g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1)); g.setAttribute('aRest', new THREE.BufferAttribute(rest, 1));
    if (o.uv) g.setAttribute('uv', o.uv(g)); else boxUV(g, this.tile);
    (this.lists[sys || SYS_DEFAULT] = this.lists[sys || SYS_DEFAULT] || []).push(g); this.count++;
    return g;
  }
  // merge everything per system into meshes under a group; mats: { sys: material } (material may be a function sys -> material)
  build(mats, { shadow = true, name = 'batch' } = {}) {
    const g = new THREE.Group(); g.name = name; this.meshes = {};
    for (const [sys, list] of Object.entries(this.lists)) {
      if (!list.length) continue; const geo = mergeGeometries(list, false); if (!geo) { console.warn('merge failed', sys); continue; }
      geo.computeBoundingSphere(); const mat = typeof mats === 'function' ? mats(sys) : mats[sys] || mats.frame;
      const m = new THREE.Mesh(geo, mat); m.castShadow = shadow && sys !== 'glass' && sys !== 'lamp' && sys !== 'decal'; m.receiveShadow = true; m.name = name + ':' + sys; m.userData.sys = sys;
      if (mat.userData?.depth) m.customDepthMaterial = mat.userData.depth;
      g.add(m); this.meshes[sys] = m; list.forEach(q => q.dispose());
    }
    this.lists = {}; return g;
  }
}
export function boxUV(g, tile = 4) {
  const p = g.attributes.position, nm = g.attributes.normal, uv = new Float32Array(p.count * 2), us = 1 / tile;
  for (let i = 0; i < p.count; i += 3) {
    let nx = 0, ny = 0, nz = 0; for (let q = 0; q < 3 && i + q < p.count; q++) { nx += nm.getX(i + q); ny += nm.getY(i + q); nz += nm.getZ(i + q); }
    nx = Math.abs(nx); ny = Math.abs(ny); nz = Math.abs(nz);
    for (let q = 0; q < 3 && i + q < p.count; q++) { const x = p.getX(i + q), y = p.getY(i + q), z = p.getZ(i + q); let u, v; if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z; v = y; } else { u = x; v = y; } uv[(i + q) * 2] = u * us + .37; uv[(i + q) * 2 + 1] = v * us + .21; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
}

// ---------------------------------------------------------------- members
// an angle (L section) between A and B: heel on the line A..B, legs running toward `inX` and `inZ` (unit vectors, perpendicular-ish)
export function angleMember(Bt, A, B, inX, inZ, { a = .8, t = .09, sys = 'frame', ...o } = {}) {
  const dir = B.clone().sub(A), L = dir.length(); dir.normalize();
  const x = inX.clone().addScaledVector(dir, -inX.dot(dir)).normalize(), z = new THREE.Vector3().crossVectors(x, dir).normalize();
  if (z.dot(inZ) < 0) z.negate();
  const basis = new THREE.Matrix4().makeBasis(x, dir, z); basis.setPosition(A.clone().add(B).multiplyScalar(.5));
  // leg 1 lies in the x direction (thin in z); leg 2 lies in z (thin in x)
  Bt.push(sys, cbox(a, L, t, .02).translate(a / 2, 0, t / 2), basis, { ...o, plate: [a, L], plateAxes: 'xy' });
  Bt.push(sys, cbox(t, L, a, .02).translate(t / 2, 0, a / 2), basis, { ...o, plate: [a, L], plateAxes: 'zy' });
}
// a flat bar (lacing, strap) from A to B lying in the plane whose normal is `face`
export function flatBar(Bt, A, B, face, { w = .42, t = .06, sys = 'frame', ext = 0, ...o } = {}) {
  const d = B.clone().sub(A).normalize(), A2 = A.clone().addScaledVector(d, -ext), B2 = B.clone().addScaledVector(d, ext);
  const { m, L } = along(A2, B2, face); Bt.push(sys, cbox(w, L, t, .015), m, { ...o, plate: [w, L] });
}
// a plate (w across, h along `up`) centred at C, normal `face`, thickness t, `lap` tilts its bottom edge out (shingled courses)
export function plateAt(Bt, C, face, up, w, h, { t = .14, c = .05, lap = 0, sys = 'plate', rivets = true, rows = null, ...o } = {}) {
  const z = face.clone().normalize(), y = up.clone().addScaledVector(z, -up.dot(z)).normalize(), x = new THREE.Vector3().crossVectors(y, z);
  const m = new THREE.Matrix4().makeBasis(x, y, z); if (lap) m.multiply(new THREE.Matrix4().makeRotationX(-lap)); m.setPosition(C);
  Bt.push(sys, cbox(w, h, t, c), m, { ...o, plate: [w, h] });
  if (Bt.rivets && rivets && sys !== 'decal') rivetRows(Bt, m, w, h, t, { sys, rows, ...o, diag: Math.hypot(w, h) });
}
// snap-head rivet domes along a plate's edges (plate frame m: x across, y up, z out; the dome sits on the +z face).
// rows: 'edges' (default: all four), 'tb' (top and bottom), 'lr', or an array of [x0, y0, x1, y1] lines in plate metres
// from the centre. Pitch and head size come from the batch (Bt.rivets = { r, p }). A small plate (a gusset) gets a 2x2..3x3 field.
const _dome = (() => { const g = new THREE.SphereGeometry(1, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2); g.rotateX(Math.PI / 2); g.scale(1, 1, .62); const ng = g.toNonIndexed(); ng.deleteAttribute('uv'); return ng; })();
export function rivetRows(Bt, m, w, h, t, { sys = 'plate', rows = null, diag = 0, thr = 0, paint = -1, wear = .3, rest, ...o } = {}) {
  const { r = .075, p = .42 } = Bt.rivets, ins = Math.max(r * 2.2, Math.min(.16, Math.min(w, h) * .2)), pts = [];
  const line = (x0, y0, x1, y1) => { const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(L / p)); for (let i = 0; i <= n; i++) pts.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]); };
  const X = w / 2 - ins, Y = h / 2 - ins;
  if (Array.isArray(rows)) rows.forEach(l => line(...l));
  else if (w < 1.0 && h < 1.0) { line(-X, -Y, -X, Y); line(X, -Y, X, Y); }
  else if (w < 1.6 && h < 1.8) { for (const yy of [-Y, 0, Y]) line(-X, yy, X, yy); }
  else { if (rows !== 'lr') { line(-X, Y, X, Y); line(-X, -Y, X, -Y); } if (rows !== 'tb') { line(-X, -Y + p, -X, Y - p); line(X, -Y + p, X, Y - p); } }
  if (!pts.length) return;
  const n = _dome.attributes.position.count, P = new Float32Array(pts.length * n * 3), N = new Float32Array(pts.length * n * 3), dp = _dome.attributes.position.array, dn = _dome.attributes.normal.array;
  const v = new THREE.Vector3(), nn = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
  pts.forEach(([px, py], k) => { for (let i = 0; i < n; i++) { v.set(dp[i * 3] * r + px, dp[i * 3 + 1] * r + py, dp[i * 3 + 2] * r + t / 2 - .004).applyMatrix4(m); nn.set(dn[i * 3], dn[i * 3 + 1], dn[i * 3 + 2]).applyMatrix3(nm).normalize(); P.set([v.x, v.y, v.z], (k * n + i) * 3); N.set([nn.x, nn.y, nn.z], (k * n + i) * 3); } });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  // the domes ride the plate's lift (same threshold, same drop from the hook) and take its paint; they are what wears first
  Bt.push(Bt.rivets.sys || sys, g, null, { thr, paint, wear: Math.min(2, wear * 1.6 + .3), edge: false, aoConst: .97, drop: diag > 3.6 ? 1 : 0, rest, rand: o.rand });
  Bt.nRivets += pts.length;
}
// an I (H) section girder from A to B, web plane containing `up`
export function iBeam(Bt, A, B, up, { h = 1.2, b = .7, tf = .1, tw = .06, sys = 'frame', ...o } = {}) {
  const dir = B.clone().sub(A), L = dir.length(); dir.normalize();
  const yv = up.clone().addScaledVector(dir, -up.dot(dir)).normalize(), xv = dir, zv = new THREE.Vector3().crossVectors(xv, yv);
  const m = new THREE.Matrix4().makeBasis(xv, yv, zv); m.setPosition(A.clone().add(B).multiplyScalar(.5));
  Bt.push(sys, cbox(L, h - 2 * tf, tw, .01), m, { ...o, plate: [L, h - 2 * tf] });
  for (const s of [1, -1]) Bt.push(sys, cbox(L, tf, b, .02).translate(0, s * (h / 2 - tf / 2), 0), m, { ...o, plate: [L, b], plateAxes: 'xz' });
}
// a riveted lattice column (built-up member): four angle chords, lacing on each face (X or zigzag), gussets at panel points,
// batten plates at the ends and every `battenEvery` panels, plan diaphragms inside. Runs from y0 down to y0 - h in the
// batch's frame; section at the top `top` [w, d], at the bottom `bot` [w, d]; centred on (cx, cz).
// Returns { corner(sx, sz, t), face(f, t), panels, ao } for plating.
export function latticeColumn(Bt, { y0 = 0, h = 12, top = [5, 5], bot = top, cx = 0, cz = 0, a = .78, t = .09, panel = 3.0, lace = .44, laceT = .06,
  pattern = 'X', battenEvery = 2, gusset = [1.3, 1.5], thr = [0, .1], wear = .25, sys = 'frame', diaph = true, faces = 'fblr', endBattens = [true, true], paint = -1 } = {}) {
  const n = Math.max(2, Math.round(h / panel)), ph = h / n;
  // c5: paint per member (the paint gang's front climbing the column): a number, or a function of t_ (0 top .. 1 bottom)
  const PT = t_ => typeof paint === 'function' ? paint(t_) : paint;
  const dim = t_ => [lerp(top[0], bot[0], t_), lerp(top[1], bot[1], t_)];
  const corner = (sx, sz, t_) => { const [w, d] = dim(t_); return V3(cx + sx * w / 2, y0 - h * t_, cz + sz * d / 2); };
  const axis = V3(cx, 0, cz), half = Math.max(top[0], top[1], bot[0], bot[1]) / 2;
  // designed occlusion: inward-facing and deep inside the section are darker; the ends (near the joints) darker too
  const ao = (p, nrm) => {
    const rx = p.x - cx, rz = p.z - cz, rl = Math.hypot(rx, rz) || 1, inward = -(nrm.x * rx + nrm.z * rz) / rl, depth = 1 - clamp(rl / half);
    const tt = clamp((y0 - p.y) / h), endk = Math.max(1 - clamp(tt / .08), 1 - clamp((1 - tt) / .08));
    return 1 - .5 * clamp(inward) * (.4 + .6 * clamp(depth * 2)) - .25 * clamp(depth * 1.4) - .22 * endk - (nrm.y < -.5 ? .15 : 0);
  };
  const thrAt = t_ => lerp(thr[0], thr[1], t_);   // erected bottom-up: t_ is measured from the top, so invert
  const up = t_ => thrAt(1 - t_);
  const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  // chords: one angle per corner, legs running inward along the two faces, one piece per two panels (field splices)
  const spl = Math.max(1, Math.round(n / 2));
  for (const [sx, sz] of C) for (let k = 0; k < spl; k++) {
    const t0 = k / spl, t1 = (k + 1) / spl, A = corner(sx, sz, t0), B = corner(sx, sz, t1);
    angleMember(Bt, A, B, V3(-sx, 0, 0), V3(0, 0, -sz), { a, t, sys, thr: up(t1) - .001, wear, ao, paint: PT((t0 + t1) / 2) });
  }
  // faces: f (z+), b (z-), r (x-? ) use the four sides
  const FACES = { f: { n: V3(0, 0, 1), c: [[-1, 1], [1, 1]] }, b: { n: V3(0, 0, -1), c: [[1, -1], [-1, -1]] }, l: { n: V3(1, 0, 0), c: [[1, 1], [1, -1]] }, r: { n: V3(-1, 0, 0), c: [[-1, -1], [-1, 1]] } };
  const gaugeIn = a * .55;
  const gauge = (sx, sz, t_, fn) => { const p = corner(sx, sz, t_); const inward = fn.z !== 0 ? V3(-sx, 0, 0) : V3(0, 0, -sz); return p.addScaledVector(inward, gaugeIn).addScaledVector(fn, t + .01); };
  for (const f of faces) {
    const F = FACES[f]; if (!F) continue; const fn = F.n, [c0, c1] = F.c;
    for (let i = 0; i < n; i++) {
      const ta = i / n, tb = (i + 1) / n, th = up(tb);
      const pA0 = gauge(c0[0], c0[1], ta, fn), pA1 = gauge(c1[0], c1[1], ta, fn), pB0 = gauge(c0[0], c0[1], tb, fn), pB1 = gauge(c1[0], c1[1], tb, fn);
      const lift = fn.clone().multiplyScalar(laceT * .5 + .045);
      const pm = PT((ta + tb) / 2);
      if (pattern === 'X' || i % 2 === 0) flatBar(Bt, pA0.clone().add(lift), pB1.clone().add(lift), fn, { w: lace, t: laceT, sys, thr: th, wear, ao, ext: .2, paint: pm });
      if (pattern === 'X' || i % 2 === 1) flatBar(Bt, pA1.clone().add(lift).addScaledVector(fn, pattern === 'X' ? laceT : 0), pB0.clone().add(lift).addScaledVector(fn, pattern === 'X' ? laceT : 0), fn, { w: lace, t: laceT, sys, thr: th, wear, ao, ext: .2, paint: pm });
      // gussets at the panel points on both chords
      for (const tt of [ta, tb]) for (const cc of [c0, c1]) {
        if (tt === 0 && !endBattens[0]) continue;
        const p = gauge(cc[0], cc[1], tt, fn).addScaledVector(fn, .02); const across = (fn.z !== 0 ? V3(-cc[0], 0, 0) : V3(0, 0, -cc[1]));
        p.addScaledVector(across, gusset[0] * .3);
        plateAt(Bt, p, fn, V3(0, 1, 0), gusset[0], gusset[1] * (tt === 0 || tt === 1 ? .7 : 1), { t: .05, c: .02, sys, thr: up(Math.max(tt, tb)) , wear, ao, paint: PT(tt) });
      }
    }
    // battens: solid tie plates across the face at the ends and every battenEvery panels
    for (let i = 0; i <= n; i++) {
      if (!((i === 0 && endBattens[0]) || (i === n && endBattens[1]) || (battenEvery && i % battenEvery === 0 && i > 0 && i < n))) continue;
      const tt = i / n, p0 = gauge(c0[0], c0[1], tt, fn), p1 = gauge(c1[0], c1[1], tt, fn), C0 = p0.clone().add(p1).multiplyScalar(.5).addScaledVector(fn, .03);
      const w = p0.distanceTo(p1) + a * .9, hb = (i === 0 || i === n) ? 1.2 : .9;
      plateAt(Bt, C0.add(V3(0, i === 0 ? -hb * .35 : i === n ? hb * .35 : 0, 0)), fn, V3(0, 1, 0), w, hb, { t: .06, c: .02, sys, thr: up(tt), wear, ao, paint: PT(tt), rows: 'lr' });
    }
  }
  // plan diaphragms: crossed angles inside at batten levels (seen through the lacing)
  if (diaph) for (let i = 0; i <= n; i += Math.max(1, battenEvery)) { if (diaph === 'ends' && i !== 0 && i !== n) continue;
    const tt = i / n; for (const [p, q] of [[[-1, -1], [1, 1]], [[1, -1], [-1, 1]]]) { const A = corner(p[0], p[1], tt).lerp(V3(cx, y0 - h * tt, cz), .12), B = corner(q[0], q[1], tt).lerp(V3(cx, y0 - h * tt, cz), .12); flatBar(Bt, A, B, V3(0, 1, 0), { w: .5, t: .08, sys, thr: up(tt), wear: .1, ao: () => .45, paint: PT(tt) }); }
  }
  return { corner, n, ph, ao, gauge, FACES, faceOut: (f) => (t + laceT * 2 + .14), dim };
}

// plating plan on a lattice column face: rows (top to bottom) of strings; 'P' painted plate, 'R' hung in red lead (stays primer),
// 'r' hung, painted late in the build, '.' not hung (the lattice shows through). Plates are lapped (each course's foot steps out).
// overlap (c5): a real lap instead of c4's tilt: each course runs `overlap` m down over the course below and stands out from it by
// its own thickness (the upper course outside, so water sheds), with a rivet row through the lap; the shadow under the overhang
// is the thin dark line that says "shingled" at distance.
export function plateFace(Bt, col, f, plan, { t0 = 0, t1 = 1, out = null, gap = .1, thr = [0, 1], paintAt = [0, 1], tPl = .14, wear = .3, lap = .025, overlap = 0, sys = 'plate', R = Math.random } = {}) {
  const F = col.FACES[f], fn = F.n, [c0, c1] = F.c, rows = plan.length; if (!rows) return;
  const off = out ?? col.faceOut(f);
  for (let r = 0; r < rows; r++) {
    const row = plan[r], cols = row.length, ta = lerp(t0, t1, r / rows), tb = lerp(t0, t1, (r + 1) / rows), tm = (ta + tb) / 2;
    const P0 = col.corner(c0[0], c0[1], tm), P1 = col.corner(c1[0], c1[1], tm), top = col.corner(c0[0], c0[1], ta).lerp(col.corner(c1[0], c1[1], ta), .5), bot = col.corner(c0[0], c0[1], tb).lerp(col.corner(c1[0], c1[1], tb), .5);
    const upv = top.clone().sub(bot), hh = upv.length() - (overlap ? -overlap : gap); upv.normalize();
    const nrm = fn.clone(); // the face normal tilted by the taper
    const across = P1.clone().sub(P0), ww = across.length(); across.normalize();
    nrm.copy(new THREE.Vector3().crossVectors(across, upv).normalize()); if (nrm.dot(fn) < 0) nrm.negate();
    for (let c = 0; c < cols; c++) {
      const k = row[c]; if (k === '.' || k === ' ') continue;
      const cw = (ww + .4) / cols, C = P0.clone().addScaledVector(across, -.2 + (c + .5) * cw).addScaledVector(nrm, off);
      if (overlap) C.addScaledVector(upv, -overlap / 2).addScaledVector(nrm, (rows - 1 - r) * (tPl + .02));
      const rowFrac = 1 - (r + .5) / rows; // bottom rows first
      const th = lerp(thr[0], thr[1], clamp(rowFrac * .85 + R() * .15));
      const paint = k === 'P' ? lerp(paintAt[0], paintAt[1], clamp(rowFrac * .8 + R() * .2)) : k === 'r' ? lerp(paintAt[1], 1, .5 + R() * .4) : 9;
      const ins = overlap ? overlap / 2 : 0;
      plateAt(Bt, C, nrm, upv, cw - gap, hh, { t: tPl, c: .05, lap: overlap ? 0 : lap, sys, thr: th, paint, wear, ao: (p, n) => n.dot(nrm) < -.3 ? .35 : .95,
        rows: overlap ? [[-(cw - gap) / 2 + .2, -hh / 2 + ins, (cw - gap) / 2 - .2, -hh / 2 + ins], [-(cw - gap) / 2 + .2, hh / 2 - .18, (cw - gap) / 2 - .2, hh / 2 - .18], [-(cw - gap) / 2 + .18, -hh / 2 + ins + .42, -(cw - gap) / 2 + .18, hh / 2 - .6], [(cw - gap) / 2 - .18, -hh / 2 + ins + .42, (cw - gap) / 2 - .18, hh / 2 - .6]] : null });
    }
  }
}
// a pinned bearing: hub, flange rings, the pin and its keeper plate, along local x (left/right) or z
export function bearing(Bt, C, r, len, { axis = 'x', thr = 0, wear = .5, sysHub = 'mill', sysPin = 'chrome', bolts = 12, R = Math.random } = {}) {
  const rot = axis === 'x' ? new THREE.Matrix4().makeRotationZ(Math.PI / 2) : axis === 'z' ? new THREE.Matrix4().makeRotationX(Math.PI / 2) : new THREE.Matrix4();
  const at = (y) => new THREE.Matrix4().makeTranslation(C.x, C.y, C.z).multiply(rot).multiply(new THREE.Matrix4().makeTranslation(0, y, 0));
  const aoHub = (p, n) => .8;
  Bt.push(sysHub, cyl(r, len, 28), at(0), { thr, wear, edge: false, ao: aoHub });
  for (const s of [1, -1]) {
    Bt.push(sysHub, cyl(r * 1.16, .35, 28), at(s * (len / 2 - .1)), { thr, wear: wear * 1.4, edge: false, aoConst: .9 });
    Bt.push(sysPin, cyl(r * .38, .5, 18), at(s * (len / 2 + .3)), { thr, wear, edge: false, aoConst: 1 });
    Bt.push(sysHub, cyl(r * .55, .12, 6), at(s * (len / 2 + .12)), { thr, wear, edge: false, aoConst: .95 }); // hex keeper
    for (let k = 0; k < bolts; k++) { const a = k / bolts * Math.PI * 2, m = at(s * (len / 2 + .06)).multiply(new THREE.Matrix4().makeTranslation(Math.cos(a) * r * .95, 0, Math.sin(a) * r * .95)); Bt.push(sysPin, cyl(.09, .16, 6), m, { thr, wear: .2, edge: false, aoConst: .9 }); }
  }
}
// a caged fixed ladder from y0 to y1 at (x, z), facing `face` (unit x or z), rungs every 0.3 m, hoops every 1.2 m above 2.4 m
export function ladder(Bt, x, z, y0, y1, face = V3(0, 0, 1), { w = .5, thr = 0, sys = 'rail' } = {}) {
  const side = new THREE.Vector3().crossVectors(V3(0, 1, 0), face).normalize(), base = V3(x, 0, z);
  const P = (s, y, o = 0) => base.clone().addScaledVector(side, s * w / 2).add(V3(0, y, 0)).addScaledVector(face, o);
  const bar = (A, B, r) => { const { m, L } = along(A, B, face); Bt.push(sys, cyl(r, L, 6), m, { thr, wear: .6, edge: false, aoConst: .95 }); };
  for (const s of [-1, 1]) bar(P(s, y0), P(s, y1), .04);
  for (let y = y0 + .3; y < y1; y += .3) bar(P(-1, y), P(1, y), .025);
  for (let y = y0 + 2.4; y < y1 - .4; y += 1.2) { const n = 7; for (let k = 0; k < n; k++) { const a0 = Math.PI * k / n, a1 = Math.PI * (k + 1) / n, ring = a => base.clone().addScaledVector(side, Math.cos(a) * .42).addScaledVector(face, .45 + Math.sin(a) * .42).add(V3(0, y, 0)); bar(ring(a0), ring(a1), .02); } }
  for (let y = y0 + 3; y < y1 - 1; y += 6) for (let k = 0; k < 4; k++) bar(base.clone().addScaledVector(side, (k - 1.5) * .28).addScaledVector(face, .45 + .42).add(V3(0, y, 0)), base.clone().addScaledVector(side, (k - 1.5) * .28).addScaledVector(face, .45 + .42).add(V3(0, y + 6, 0)), .018);
}
// a walkway: grating deck with toe boards and a two-rail handrail along A..B (horizontal), deck width w, rail on the `out` side
export function walkway(Bt, A, B, out, { w = 1.2, thr = 0, rails = 'out' } = {}) {
  const d = B.clone().sub(A), L = d.length(); d.normalize(); const o = out.clone().normalize(), mid = A.clone().add(B).multiplyScalar(.5).addScaledVector(o, w / 2);
  const m = new THREE.Matrix4().makeBasis(d, V3(0, 1, 0), new THREE.Vector3().crossVectors(d, V3(0, 1, 0))); m.setPosition(mid);
  Bt.push('grating', cbox(L, .08, w, .01), m, { thr, wear: .7, aoConst: .9 });
  const sides = rails === 'both' ? [0, w] : [w];
  for (const s of sides) {
    const a0 = A.clone().addScaledVector(o, s), b0 = B.clone().addScaledVector(o, s), n = Math.max(1, Math.round(L / 1.8));
    for (let i = 0; i <= n; i++) { const p = a0.clone().lerp(b0, i / n); const { m: mm, L: ll } = along(p, p.clone().add(V3(0, 1.1, 0)), o); Bt.push('rail', cyl(.035, ll, 6), mm, { thr, wear: .5, edge: false }); }
    for (const y of [1.1, .55]) { const { m: mm, L: ll } = along(a0.clone().add(V3(0, y, 0)), b0.clone().add(V3(0, y, 0)), V3(0, 1, 0)); Bt.push('rail', cyl(.03, ll, 6), mm, { thr, wear: .5, edge: false }); }
    const { m: tb } = along(a0.clone().add(V3(0, .1, 0)), b0.clone().add(V3(0, .1, 0)), o); Bt.push('rail', cbox(.03, L, .15, .005).rotateZ(0), tb, { thr, wear: .5 });
  }
}
