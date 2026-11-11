// container_40hc: an ISO 1496-1 40 ft high-cube dry container, built from the standard's dimensions.
//
// Reference (why it is specific): ISO 668 / 1496-1 external 12 192 x 2 438 x 2 896 mm; ISO 1161 corner fittings 178 x 162 x
// 118 mm with an oval aperture 124 x 63 mm; corrugation depth about 36 mm on a pitch of about 250 mm; door end with four
// cam-and-keeper locking rods (25-35 mm) and door seals; roof and bottom side rails; fork pockets omitted. The Port
// Newark-Elizabeth photograph (Wikimedia Commons, VynedJ, CC BY 4.0) shows the mix this is built to sit in: five-high stacks of
// 40 ft boxes in a dozen liveries. Owner codes are INVENTED (decals.js writes an ISO 6346 code with a correct check digit
// on a made-up owner prefix); no real line's livery or logo is copied.
// Axes: length along Z, width X, height Y, origin at the floor centre. +X side is the "right" side.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export const L = 12.192, Wd = 2.438, Ht = 2.896;
export const meta = {
  type: 'containers', title: 'ISO 40 ft high-cube container',
  refs: [
    { what: 'ISO 668 external dimensions, ISO 1161 corner fittings, ISO 1496-1 door gear', url: 'https://www.iso.org/standard/76913.html', use: 'every dimension' },
    { what: 'Port Newark-Elizabeth from I-95', url: 'https://commons.wikimedia.org/wiki/File:Port_Newark-Elizabeth_Marine_Terminal.jpg', licence: 'CC BY 4.0, VynedJ', use: 'the mix and the stack height (five-high); reference only, no pixels used' },
  ],
  licence: { geometry: 'original, built for this project (CC0)', references: 'dimensions and function only' },
  changes: ['true corrugation (36 mm deep, 250 mm pitch) so a raking light finds it', 'corner castings with their oval apertures cut with manifold-3d', 'door end: four locking rods with cams and keepers, hinges, seal', 'side UVs mapped to the panel (decals.js draws owner, code, weights, rust runs on it)'],
  bake: { maxEdge: 0.35, rays: 16, maxDist: 0.9 },
  decals: ['owner name', 'ISO 6346 code with check digit', 'size/type code 45G1', 'weights block', 'rust runs from the rails', 'touch-up patches'],
  lod1: 0.2, lod1error: 0.06,
  used_by: ['modeling c1 PORT NEWARK. demo'],
};

// a corrugated sheet along Z at x = +-(Wd/2), y in [y0, y1]. The outside normal is +x for the right side. uv: u along the box
// as seen from OUTSIDE (left to right), v up.
function corrugated({ side = 1, y0, y1, z0, z1, pitch = 0.25, depth = 0.036 }) {
  const n = Math.round((z1 - z0) / pitch), pts = [];   // (z, x-offset) profile, crest = 0 (outermost), valley = -depth
  const crest = 0.30 * pitch, slope = 0.20 * pitch;
  for (let i = 0; i < n; i++) {
    const a = z0 + i * (z1 - z0) / n, w = (z1 - z0) / n, s = w / pitch;
    pts.push([a, 0], [a + crest * s, 0], [a + (crest + slope) * s, -depth], [a + (crest + slope + 0.20 * pitch) * s, -depth], [a + (crest + 2 * slope + 0.20 * pitch) * s, 0]);
  }
  pts.push([z1, 0]);
  const pos = [], nor = [], uv = [], x0 = side * Wd / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [za, da] = pts[i], [zb, db] = pts[i + 1]; if (Math.abs(zb - za) < 1e-6 && Math.abs(db - da) < 1e-6) continue;
    const xa = x0 + side * da, xb = x0 + side * db;
    let nx = (zb - za), nz = -(xb - xa); if (nx * side < 0) { nx = -nx; nz = -nz; } if (Math.abs(nx) < 1e-9 && Math.abs(nz) < 1e-9) continue; const l = Math.hypot(nx, nz); nx /= l; nz /= l;
    const U = z => side > 0 ? (z1 - z) / (z1 - z0) : (z - z0) / (z1 - z0), V = y => (y - y0) / (y1 - y0);
    const q = [[xa, y0, za, U(za), 0], [xb, y0, zb, U(zb), 0], [xb, y1, zb, U(zb), 1], [xa, y1, za, U(za), 1]];
    // winding: the geometric normal of (0,1,2) must agree with the outward normal
    const e1 = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]], e2 = [q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cz = e1[0] * e2[1] - e1[1] * e2[0], cxx = cx, dotn = cxx * nx + cz * nz;
    const idx = dotn >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const k of idx) { pos.push(q[k][0], q[k][1], q[k][2]); nor.push(nx, 0, nz); uv.push(q[k][3], q[k][4]); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); return g;
}
// front / roof panels: corrugation running across the width (roof) or up (front) at a lower depth: a flat quad with ribs as boxes is enough
export const variants = { far: { flat: true } };   // a far LOD: flat sides (the corrugation is invisible past ~60 m), a quarter of the triangles
export async function build(k, opt = {}) {
  const parts = []; const P = (name, mat, geo, o = {}) => parts.push({ name, mat, geo, ...o });
  const rb = opt.flat ? (w, h, d, r, x, y, z) => k.box(w, h, d, x, y, z) : (...a) => k.rbox(...a);
  const rail = 0.15, hL = L / 2, hW = Wd / 2;
  // side panels (true corrugation)
  const cor = opt.flat ? { pitch: 12, depth: 0.0 } : {};
  const sideR = corrugated({ side: 1, y0: 0.16, y1: Ht - 0.15, z0: -hL + 0.16, z1: hL - 0.16, ...cor }), sideL = corrugated({ side: -1, y0: 0.16, y1: Ht - 0.15, z0: -hL + 0.16, z1: hL - 0.16, ...cor });
  P('side_R', 'cont.side', sideR, { maxEdge: 0.9 }); P('side_L', 'cont.side', sideL, { maxEdge: 0.9 });
  // rails: bottom and top, both sides and both ends, rounded
  const railGeos = [];
  for (const s of [-1, 1]) {
    railGeos.push(k.geo(rb(0.15, 0.16, L, 0.012, s * (hW - 0.075), 0.08, 0)));                 // bottom side rail
    railGeos.push(k.geo(rb(0.14, 0.15, L, 0.012, s * (hW - 0.07), Ht - 0.075, 0)));            // top side rail
  }
  for (const s of [-1, 1]) {
    railGeos.push(k.geo(rb(Wd - 0.3, 0.16, 0.15, 0.012, 0, 0.08, s * (hL - 0.075))));           // bottom end rail
    railGeos.push(k.geo(rb(Wd - 0.3, 0.14, 0.15, 0.012, 0, Ht - 0.07, s * (hL - 0.075))));      // top end rail (door header / front header)
  }
  railGeos.forEach((g, i) => P('rail' + i, 'cont.frame', g, { maxEdge: 1.6, noUV: true }));
  // corner posts (four), slightly proud of the panel
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(`post_${sx}_${sz}`, 'cont.frame', k.geo(rb(0.14, Ht - 0.3, 0.14, 0.01, sx * (hW - 0.07), Ht / 2, sz * (hL - 0.07))), { maxEdge: 0.7, noUV: true });
  // corner castings: 178 x 162 x 118 with an oval aperture on three faces
  const cast = (x, y, z) => {
    let c = rb(0.162, 0.118, 0.178, 0.014, 0, 0, 0);
    const slot = (w, h, d, ax) => ax === 'y' ? rb(w, d, h, 0.02, 0, 0, 0) : ax === 'x' ? rb(d, h, w, 0.02, 0, 0, 0) : rb(w, h, d, 0.02, 0, 0, 0);
    c = k.sub(c, slot(0.124, 0.063, 0.07, 'y')); c = k.sub(c, k.move(slot(0.124, 0.063, 0.07, 'x'), 0, 0, 0));
    return k.geo(k.move(c, x, y, z));
  };
  const castGeos = []; if (!opt.flat) for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const yy of [0.059, Ht - 0.059]) castGeos.push(cast(sx * (hW - 0.081), yy, sz * (hL - 0.089)));
  castGeos.forEach((g, i) => P('casting' + i, 'cont.casting', g, { maxEdge: 0.1, noUV: true }));
  // front end wall (z = -hL): a recessed panel with vertical ribs
  const ribs = []; if (!opt.flat) for (let i = -5; i <= 5; i++) ribs.push(rb(0.09, Ht - 0.35, 0.03, 0.006, i * 0.19, Ht / 2, -hL + 0.055));
  P('front_panel', 'cont.front', k.geo(rb(Wd - 0.32, Ht - 0.36, 0.03, 0.004, 0, Ht / 2, -hL + 0.07)), { maxEdge: 1.2, noUV: true });
  if (ribs.length) P('front_ribs', 'cont.front', k.geo(k.add(...ribs)), { maxEdge: 1.2, noUV: true });
  // door end (z = +hL): two leaves, four locking rods with cams and keepers, hinges, seal
  const dz = hL - 0.055;
  P('door_L', 'cont.doors', k.geo(rb(hW - 0.16, Ht - 0.34, 0.05, 0.006, -(hW - 0.16) / 2 - 0.005, Ht / 2, dz)), { maxEdge: 1.2, noUV: true });
  P('door_R', 'cont.doors', k.geo(rb(hW - 0.16, Ht - 0.34, 0.05, 0.006, (hW - 0.16) / 2 + 0.005, Ht / 2, dz)), { maxEdge: 1.2, noUV: true });
  const dribs = []; if (!opt.flat) for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) dribs.push(rb(0.1, Ht - 0.42, 0.02, 0.005, sx * (0.13 + i * 0.26), Ht / 2, dz + 0.035));
  if (dribs.length) P('door_ribs', 'cont.doors', k.geo(k.add(...dribs)), { maxEdge: 1.2, noUV: true });
  const rods = [], cams = [], keeps = [];
  if (!opt.flat) for (const sx of [-1, 1]) for (const off of [0.16, 0.86]) {
    const x = sx * off; rods.push(k.cyl(0.0175, Ht - 0.24, x, Ht / 2, dz + 0.085, 10));
    for (const yy of [0.32, Ht - 0.32]) { cams.push(rb(0.07, 0.04, 0.035, 0.008, x, yy, dz + 0.1)); keeps.push(rb(0.06, 0.06, 0.02, 0.006, x, yy + (yy > Ht / 2 ? 0.05 : -0.05), dz + 0.07)); }
  }
  if (rods.length) { P('door_rods', 'cont.rods', k.geo(k.add(...rods)), { maxEdge: 0.8, noUV: true }); P('door_cams', 'cont.rods', k.geo(k.add(...cams, ...keeps)), { maxEdge: 0.15, noUV: true }); }
  const hinges = []; if (!opt.flat) for (const sx of [-1, 1]) for (const yy of [0.35, 0.95, 1.5, 2.05, 2.55]) hinges.push(k.cyl(0.018, 0.14, sx * (hW - 0.16), yy, dz + 0.02, 10));
  if (hinges.length) P('door_hinges', 'cont.rods', k.geo(k.add(...hinges)), { maxEdge: 0.2, noUV: true });
  const handles = []; if (!opt.flat) for (const sx of [-1, 1]) handles.push(rb(0.09, 0.28, 0.03, 0.01, sx * 0.86, 1.15, dz + 0.12));
  if (handles.length) P('door_handles', 'cont.rods', k.geo(k.add(...handles)), { maxEdge: 0.3, noUV: true });
  // roof: a plate with five shallow ribs across
  P('roof', 'cont.roof', k.geo(rb(Wd - 0.3, 0.04, L - 0.3, 0.005, 0, Ht - 0.05, 0)), { maxEdge: 3, noUV: true });
  // floor / crossmembers under (seen only when stacked over an aisle at low camera): a plate
  P('floor', 'cont.frame', k.geo(rb(Wd - 0.34, 0.06, L - 0.34, 0.005, 0, 0.1, 0)), { maxEdge: 4, noUV: true });
  return { parts, anchors: { top_corners: [[hW, Ht, hL], [-hW, Ht, hL], [hW, Ht, -hL], [-hW, Ht, -hL]], door_face: [0, Ht / 2, hL], side_R_center: [hW, Ht / 2, 0] } };
}
