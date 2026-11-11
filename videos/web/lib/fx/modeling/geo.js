// MODELING geo (MODELING studio, cycle 1): solid modelling for the parts three.js primitives cannot make.
//
// Why: the OBJECTS kit built every object from capsules, cylinders and stacked boxes, which shows the tool: a cast
// housing with a bore, a fillet, a boss and a rib is not any of those. manifold-3d (WASM, guaranteed-manifold CSG)
// gives union / difference / intersection / hull / extrude / revolve, so a mill housing can have its windows cut out of
// the casting, a cobot's J6 can be a shell with a real bore and a bolt circle, and a container's corner casting can have
// its oval hole. It runs in Node (tools building the catalogued .glb) and in a page.
//
//   import { Kit, toGeo, boxUV, lofted, truss } from './geo.js';
//   const k = await Kit.create();                       // manifold instance, scoped: k.done() frees every solid it made
//   const housing = k.sub(k.rbox(1.2, 3.4, .8, .04), k.box(.5, 1.6, 2, 0, .3, 0));   // a casting with a window
//   const geo = toGeo(housing, { crease: 30 });          // BufferGeometry with creased normals (hard edges stay hard)
//
// Conventions: Y up, metres, boxes centred unless told. Solids are Manifold objects; every helper returns a new solid
// and the kit remembers it, so nothing leaks (Manifold objects live in WASM memory and are not garbage collected).
import * as THREE from 'three';
import { toCreasedNormals, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

let _wasm = null;
export async function loadManifold() {
  if (_wasm) return _wasm;
  const Module = (await import('manifold-3d')).default;
  _wasm = await Module(); _wasm.setup(); return _wasm;
}

export class Kit {
  static async create() { const w = await loadManifold(); return new Kit(w); }
  constructor(w) { this.w = w; this.M = w.Manifold; this.X = w.CrossSection; this._keep = []; }
  k(m) { this._keep.push(m); return m; }
  geo(m, o) { return toGeo(m, o); }
  done() { for (const m of this._keep) { try { m.delete(); } catch (e) { /* already freed */ } } this._keep.length = 0; }
  // ---- primitives (centred; Y up)
  box(w, h, d, x = 0, y = 0, z = 0) { return this.k(this.k(this.M.cube([w, h, d], true)).translate([x, y, z])); }
  // cylinder along Y (r radius, h height), segments n
  cyl(r, h, x = 0, y = 0, z = 0, n = 24, r2 = null) {
    const c = this.k(this.M.cylinder(h, r, r2 ?? r, n, true)); return this.k(this.k(c.rotate([-90, 0, 0])).translate([x, y, z]));
  }
  cylX(r, h, x = 0, y = 0, z = 0, n = 24, r2 = null) { const c = this.k(this.M.cylinder(h, r, r2 ?? r, n, true)); return this.k(this.k(c.rotate([0, 90, 0])).translate([x, y, z])); }
  cylZ(r, h, x = 0, y = 0, z = 0, n = 24, r2 = null) { const c = this.k(this.M.cylinder(h, r, r2 ?? r, n, true)); return this.k(c.translate([x, y, z])); }
  sphere(r, x = 0, y = 0, z = 0, n = 16) { return this.k(this.k(this.M.sphere(r, n)).translate([x, y, z])); }
  // rounded box: hull of eight spheres (a fillet on every edge; r <= half the smallest side)
  rbox(w, h, d, r = 0.02, x = 0, y = 0, z = 0, n = 8) {
    r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
    const s = this.sphere(r, 0, 0, 0, n), pts = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(this.k(s.translate([sx * (w / 2 - r), sy * (h / 2 - r), sz * (d / 2 - r)])));
    return this.k(this.k(this.M.hull(pts)).translate([x, y, z]));
  }
  // a rounded cylinder along Y: hull of two tori-ish rings would be heavy; a capped cylinder with a chamfer via revolve
  rcyl(r, h, c = 0.01, x = 0, y = 0, z = 0, n = 28) {
    const pr = [[0, -h / 2], [r - c, -h / 2], [r, -h / 2 + c], [r, h / 2 - c], [r - c, h / 2], [0, h / 2]];
    return this.k(this.k(this.revolve(pr, n)).translate([x, y, z]));
  }
  // revolve a profile [[radius, y], ...] (closed by the axis) about Y
  revolve(profile, n = 32) {
    const cs = this.k(this.X.ofPolygons([profile.map(p => [p[0], p[1]])]));
    // CrossSection revolves about its Y axis into the manifold's Z axis: rotate so the axis is Y
    return this.k(this.k(cs.revolve(n, 360)).rotate([-90, 0, 0]));
  }
  // polygon in the XY plane [[x, y], ...] extruded along Z (depth d, centred), optional scale-top
  extrude(pts, d, x = 0, y = 0, z = 0) {
    const cs = this.k(this.X.ofPolygons([pts])); const m = this.k(cs.extrude(d)); return this.k(this.k(m.translate([0, 0, -d / 2])).translate([x, y, z]));
  }
  // polygon in the ZY plane (side profile: [[z, y], ...]) extruded across X (width w, centred)
  extrudeSide(pts, w, x = 0, y = 0, z = 0) {
    const m = this.extrude(pts.map(p => [p[0], p[1]]), w);   // XY polygon along Z -> we want polygon axes (z,y) and extrusion along x
    const r = this.k(m.rotate([0, 90, 0]));                  // maps polygon x -> -z... fix below by mirroring
    return this.k(this.k(r.mirror([0, 0, 1])).translate([x, y, z]));
  }
  hull(list) { return this.k(this.M.hull(list)); }
  // ---- booleans
  add(...a) { return this.k(this.M.union(a)); }
  sub(a, ...b) { let r = a; for (const x of b) r = this.k(r.subtract(x)); return r; }
  and(a, b) { return this.k(a.intersect(b)); }
  move(m, x = 0, y = 0, z = 0) { return this.k(m.translate([x, y, z])); }
  rot(m, ax = 0, ay = 0, az = 0) { return this.k(m.rotate([ax, ay, az])); }
  scale(m, sx = 1, sy = sx, sz = sx) { return this.k(m.scale([sx, sy, sz])); }
  // a bore: a cylinder cut through along an axis at a place
  bore(m, axis, r, len, x = 0, y = 0, z = 0) { const c = axis === 'x' ? this.cylX(r, len, x, y, z) : axis === 'z' ? this.cylZ(r, len, x, y, z) : this.cyl(r, len, x, y, z); return this.sub(m, c); }
  // a bolt circle of n bolts (short cylinders standing on +Y at y) around a centre
  boltRing(R, n, r, h, y = 0, x = 0, z = 0) {
    const bs = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; bs.push(this.cyl(r, h, x + Math.cos(a) * R, y, z + Math.sin(a) * R, 6)); }
    return this.add(...bs);
  }
}

// ---- Manifold -> THREE.BufferGeometry
export function toGeo(m, { crease = 30, uvScale = 1, uv = true } = {}) {
  const me = m.getMesh(), np = me.numProp, vp = me.vertProperties, tv = me.triVerts, nv = vp.length / np;
  const pos = new Float32Array(nv * 3); for (let i = 0; i < nv; i++) { pos[i * 3] = vp[i * np]; pos[i * 3 + 1] = vp[i * np + 1]; pos[i * 3 + 2] = vp[i * np + 2]; }
  let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(tv), 1));
  g = toCreasedNormals(g.toNonIndexed(), crease * Math.PI / 180);
  if (uv) boxUV(g, uvScale);
  return g;
}
// world-box UVs: each triangle projects on its dominant axis (metres * scale), so textures and decals need no unwrap
export function boxUV(g, s = 1) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 3) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k);
      let u, v; if (nx >= ny && nx >= nz) { u = z; v = y; } else if (ny >= nz) { u = x; v = z; } else { u = x; v = y; }
      uv[(i + k) * 2] = u * s; uv[(i + k) * 2 + 1] = v * s;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
}

// ---- lofted sheet-metal shapes: a closed ring per station, joined. The way a cab is really shaped (aero, not boxes).
// stations: [{ z, w, h0, h1, r, y0? , dx? }] -> a rounded-rect ring (width w, from bottom y0 = h0 to top y1 = h1, corner
// radius r, sideways offset dx). segs per ring; caps closed with fans. Returns a BufferGeometry (smooth normals).
export function ringPts(st, n = 40) {
  const { w, h0, h1, r, dx = 0, topSag = 0, bulge = 0 } = st, hw = w / 2, out = [];
  const rr = Math.min(r, hw - 1e-3, (h1 - h0) / 2 - 1e-3), per = Math.max(2, Math.floor(n / 8));
  const corners = [[hw - rr, h1 - rr, 0], [-hw + rr, h1 - rr, Math.PI / 2], [-hw + rr, h0 + rr, Math.PI], [hw - rr, h0 + rr, Math.PI * 1.5]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= per; i++) {
    const a = a0 + (i / per) * Math.PI / 2; let y = cy + Math.sin(a) * rr, x = cx + Math.cos(a) * rr;
    if (y > (h0 + h1) / 2) y -= topSag * (1 - (2 * x / w) ** 2);  // a crowned roof
    x *= 1 + bulge * (1 - ((y - h0) / (h1 - h0) * 2 - 1) ** 2);
    out.push([x + dx, y]);
  }
  return out;
}
export function lofted(stations, { n = 40, closeEnds = true, flip = false } = {}) {
  const rings = stations.map(s => ringPts(s, n).map(([x, y]) => new THREE.Vector3(x, y, s.z)));
  const m = rings[0].length, pos = [], idx = [];
  rings.forEach(r => r.forEach(v => pos.push(v.x, v.y, v.z)));
  for (let s = 0; s < rings.length - 1; s++) for (let i = 0; i < m; i++) {
    const a = s * m + i, b = s * m + (i + 1) % m, c = (s + 1) * m + i, d = (s + 1) * m + (i + 1) % m;
    flip ? idx.push(a, b, c, b, d, c) : idx.push(a, c, b, b, c, d);
  }
  if (closeEnds) for (const [s, f2] of [[0, false], [rings.length - 1, true]]) {
    const cx = rings[s].reduce((a, v) => a + v.x, 0) / m, cy = rings[s].reduce((a, v) => a + v.y, 0) / m, cz = stations[s].z, ci = pos.length / 3;
    pos.push(cx, cy, cz);
    for (let i = 0; i < m; i++) { const a = s * m + i, b = s * m + (i + 1) % m; (flip !== !!f2) ? idx.push(ci, a, b) : idx.push(ci, b, a); }
  }
  let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g = toCreasedNormals(g.toNonIndexed(), 40 * Math.PI / 180); boxUV(g, 1); return g;
}

// ---- lattice girders: four chords and zig-zag diagonals as slim boxes (a truss reads as a truss at 270 px only if the
// diagonals are there and the bay length is right). Returns merged geometry. axis: the long direction 'x'|'y'|'z'.
export function beam(a, b, t = 0.06, t2 = t) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
  const g = new THREE.BoxGeometry(t, t2, L); g.translate(0, 0, L / 2);
  const m = new THREE.Matrix4().lookAt(B, A, Math.abs(d.y / L) > 0.98 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
  m.setPosition(A); g.applyMatrix4(m); return g;
}
export function truss({ p0, p1, w = 1, h = 1, bays = 8, chord = 0.08, diag = 0.05, up = [0, 1, 0], cross = true, panels = 'x' }) {
  // p0 -> p1 the axis; the section is w (across) x h (up), centred on the axis. panels: 'x' both side faces braced (+ top and
  // bottom if cross), returns BufferGeometry.
  const A = new THREE.Vector3(...p0), B = new THREE.Vector3(...p1), L = B.clone().sub(A), len = L.length(), ax = L.clone().normalize();
  const U = new THREE.Vector3(...up), S = new THREE.Vector3().crossVectors(ax, U).normalize(), Uu = new THREE.Vector3().crossVectors(S, ax).normalize();
  const P = (t, sx, sy) => A.clone().addScaledVector(ax, t * len).addScaledVector(S, sx * w / 2).addScaledVector(Uu, sy * h / 2).toArray();
  const gs = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) gs.push(beam(P(0, sx, sy), P(1, sx, sy), chord));
  for (let i = 0; i <= bays; i++) { const t = i / bays; // rings
    gs.push(beam(P(t, -1, -1), P(t, 1, -1), diag), beam(P(t, -1, 1), P(t, 1, 1), diag), beam(P(t, -1, -1), P(t, -1, 1), diag), beam(P(t, 1, -1), P(t, 1, 1), diag)); }
  for (let i = 0; i < bays; i++) { const t0 = i / bays, t1 = (i + 1) / bays, f = i % 2;
    for (const sx of [-1, 1]) gs.push(f ? beam(P(t0, sx, -1), P(t1, sx, 1), diag) : beam(P(t0, sx, 1), P(t1, sx, -1), diag));
    if (cross) for (const sy of [-1, 1]) gs.push(f ? beam(P(t0, -1, sy), P(t1, 1, sy), diag) : beam(P(t0, 1, sy), P(t1, -1, sy), diag)); }
  return mergeGeometries(gs.map(g => g.index ? g.toNonIndexed() : g));
}

// a tube along a polyline (cable, hose, mirror arm): radius r, rounded joints by CatmullRom
export function tubeAlong(points, r = 0.02, seg = 24, radial = 8) {
  const c = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'catmullrom', 0.3);
  const g = new THREE.TubeGeometry(c, seg, r, radial, false); return g.toNonIndexed();
}
export { mergeGeometries };
