// van53: a 53 ft dry van trailer, sheet-and-post, tandem slider axles: the second half of the client's truck.
//
// Reference (why it is specific): the poster shows the van as a huge dark wall with a bright vertical steel post at its front
// corner and the roll of a top rail; the rest of the slate drew it as a grey box. Real vans: aluminium sheet on vertical
// posts every ~610 mm, top and bottom rails, DOT reflective tape (alternating red and white 50 mm strips) along the lower rail
// and the rear, ICC rear impact guard, swing doors with four lock rods, landing gear behind the nose, tandem axles on slider rails,
// mud flaps, marker and tail lamps. 53 ft = 16.15 m, 2.6 m wide, 4.1 m high.
// Origin: the kingpin. Front wall at z = +0.91, rear at z = -15.24. Up +Y; the floor rail at y = 1.25.
import * as THREE from 'three';
import { mergeGeometries } from '../geo.js';
export const meta = {
  type: 'trucks', title: '53 ft dry van trailer',
  refs: [{ what: 'US 53 ft van: dimensions, sheet-and-post construction, DOT-C2 reflective tape (49 CFR 393.11), ICC bar', use: 'every dimension and the tape pattern' }],
  licence: { geometry: 'original, built for this project (CC0)', references: 'dimensions and regulation only' },
  changes: ['posts and rails as real members so a raking headlamp finds them', 'DOT tape strips as separate parts (red/white)', 'landing gear, slider rails, tandem axles with duals'],
  bake: { maxEdge: 0.6, rays: 12, maxDist: 2.2 }, lod1: 0.4, lod1error: 0.04,
  used_by: ['modeling c1 truck demo'],
};
const bx = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const merge = a => mergeGeometries(a.map(g => (g.index ? g.toNonIndexed() : g)));
export async function build(k) {
  const parts = []; const P = (name, mat, geo, o = {}) => parts.push({ name, mat, geo, noUV: true, ...o });
  const zf = 0.91, zr = -15.24, L = zf - zr, zc = (zf + zr) / 2, W = 2.6, y0 = 1.25, y1 = 4.1, H = y1 - y0, yc = (y0 + y1) / 2;
  // sides: sheet + posts (every 0.61 m), top rail, bottom rail
  P('side_sheets', 'van.sheet', merge([bx(0.02, H - 0.25, L - 0.1, W / 2 - 0.02, yc, zc), bx(0.02, H - 0.25, L - 0.1, -W / 2 + 0.02, yc, zc)]), { maxEdge: 2 });
  const posts = []; for (let z = zr + 0.4; z < zf - 0.2; z += 0.61) posts.push(bx(0.06, H - 0.3, 0.05, W / 2, yc, z), bx(0.06, H - 0.3, 0.05, -W / 2, yc, z));
  P('side_posts', 'van.post', merge(posts), { maxEdge: 1.2 });
  P('rails', 'van.post', merge([bx(0.1, 0.16, L, W / 2, y1 - 0.08, zc), bx(0.1, 0.16, L, -W / 2, y1 - 0.08, zc), bx(0.11, 0.2, L, W / 2, y0 + 0.1, zc), bx(0.11, 0.2, L, -W / 2, y0 + 0.1, zc), bx(W, 0.1, L, 0, y1 + 0.02, zc)]), { maxEdge: 3 });
  // front wall: ribbed, with the corner posts that the poster's bright vertical strip is (steel, polished at the edge)
  const rib = []; for (let x = -1.1; x <= 1.11; x += 0.37) rib.push(bx(0.09, H - 0.3, 0.04, x, yc, zf + 0.01));
  P('front_wall', 'van.sheet', merge([bx(W - 0.1, H - 0.1, 0.03, 0, yc, zf - 0.005)]), { maxEdge: 2 }); P('front_ribs', 'van.post', merge(rib), { maxEdge: 1.2 });
  P('corner_posts', 'van.steel', merge([bx(0.11, H, 0.11, W / 2 - 0.03, yc, zf), bx(0.11, H, 0.11, -W / 2 + 0.03, yc, zf), bx(0.11, H, 0.11, W / 2 - 0.03, yc, zr), bx(0.11, H, 0.11, -W / 2 + 0.03, yc, zr)]), { maxEdge: 2 });
  // rear doors, lock rods with cams, hinges, ICC bumper, mud flaps
  const rods = [], cams = [], hinges = []; for (const x of [-0.95, -0.35, 0.35, 0.95]) { rods.push(new THREE.CylinderGeometry(0.018, 0.018, H - 0.3, 8).translate(x, yc, zr - 0.05)); for (const y of [y0 + 0.25, y1 - 0.25]) cams.push(bx(0.07, 0.05, 0.05, x, y, zr - 0.06)); }
  for (const x of [-1.22, 1.22]) for (let i = 0; i < 4; i++) hinges.push(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8).translate(x, y0 + 0.4 + i * 0.72, zr - 0.03));
  P('rear_door_frame', 'van.sheet', merge([bx(W - 0.22, H - 0.18, 0.05, 0, yc, zr - 0.02), bx(0.03, H - 0.2, 0.07, 0, yc, zr - 0.05)]), { maxEdge: 1.5 });
  P('door_rods', 'van.steel', merge([...rods, ...cams, ...hinges]), { maxEdge: 0.5 });
  P('icc_bumper', 'van.steel', merge([bx(W - 0.3, 0.22, 0.14, 0, 0.62, zr - 0.35), bx(0.12, 0.6, 0.12, W / 2 - 0.35, 0.9, zr - 0.3), bx(0.12, 0.6, 0.12, -W / 2 + 0.35, 0.9, zr - 0.3)]), { maxEdge: 0.6 });
  // landing gear (two legs behind the nose, with cross brace and foot pads), slider rails, subframe
  P('landing_gear', 'chassis', merge([bx(0.14, 1.15, 0.14, W / 2 - 0.35, 0.65, zf - 1.7), bx(0.14, 1.15, 0.14, -W / 2 + 0.35, 0.65, zf - 1.7), bx(W - 0.4, 0.09, 0.09, 0, 0.95, zf - 1.7), bx(0.3, 0.05, 0.3, W / 2 - 0.35, 0.07, zf - 1.7), bx(0.3, 0.05, 0.3, -W / 2 + 0.35, 0.07, zf - 1.7)]), { maxEdge: 0.6 });
  P('subframe', 'chassis', merge([bx(0.16, 0.22, 11, 0.55, y0 - 0.12, -8.5), bx(0.16, 0.22, 11, -0.55, y0 - 0.12, -8.5), bx(W - 0.3, 0.16, 0.16, 0, y0 - 0.1, zf - 1.0), bx(W - 0.4, 0.14, 0.14, 0, y0 - 0.1, -4.0), bx(W - 0.4, 0.14, 0.14, 0, y0 - 0.1, -9.0), bx(0.2, 0.3, 4.0, 0.55, 0.85, -12.7), bx(0.2, 0.3, 4.0, -0.55, 0.85, -12.7)]), { maxEdge: 1 });
  const tyres = [], rims = []; for (const zA of [-12.2, -13.5]) for (const s of [1, -1]) for (const dx of [0.0, 0.34]) { const x = s * (0.98 + dx); tyres.push(new THREE.CylinderGeometry(0.53, 0.53, 0.29, 32).rotateZ(Math.PI / 2).translate(x, 0.53, zA)); rims.push(new THREE.CylinderGeometry(0.33, 0.33, 0.03, 24).rotateZ(Math.PI / 2).translate(x + s * 0.155, 0.53, zA)); }
  P('tyres', 'rubber.tyre', merge(tyres), { maxEdge: 0.25 }); P('rims', 'van.steel', merge(rims), { maxEdge: 0.25 });
  P('mud_flaps', 'rubber.tyre', merge([bx(0.6, 0.6, 0.02, 1.1, 0.6, -14.3), bx(0.6, 0.6, 0.02, -1.1, 0.6, -14.3)]), { maxEdge: 0.4 });
  // DOT-C2 tape: alternating red / white 0.15 m strips along the lower rail (both sides) and across the rear
  const red = [], white = []; let i = 0; for (let z = zf - 0.4; z > zr + 0.4; z -= 0.15, i++) for (const s of [1, -1]) (i % 2 ? red : white).push(bx(0.012, 0.05, 0.14, s * (W / 2 + 0.06), y0 + 0.35, z));
  i = 0; for (let x = -1.15; x < 1.16; x += 0.15, i++) (i % 2 ? red : white).push(bx(0.14, 0.05, 0.012, x, y0 + 0.35, zr - 0.06));
  P('dot_tape_red', 'tape.red', merge(red), { maxEdge: 0.3 }); P('dot_tape_white', 'tape.white', merge(white), { maxEdge: 0.3 });
  // lamps: amber side markers (front and rear third), red rear markers, tail lamps
  P('lamps_amber', 'lamp.amber', merge([bx(0.05, 0.08, 0.14, W / 2 + 0.05, y0 + 0.55, zf - 0.3), bx(0.05, 0.08, 0.14, -W / 2 - 0.05, y0 + 0.55, zf - 0.3), bx(0.05, 0.08, 0.14, W / 2 + 0.05, y0 + 0.55, -5.3), bx(0.05, 0.08, 0.14, -W / 2 - 0.05, y0 + 0.55, -5.3)]), { maxEdge: 0.1 });
  P('lamps_red', 'lamp.red', merge([bx(0.16, 0.34, 0.06, 1.05, y0 + 0.4, zr - 0.08), bx(0.16, 0.34, 0.06, -1.05, y0 + 0.4, zr - 0.08), bx(0.05, 0.08, 0.14, W / 2 + 0.05, y0 + 0.55, zr + 0.3), bx(0.05, 0.08, 0.14, -W / 2 - 0.05, y0 + 0.55, zr + 0.3)]), { maxEdge: 0.1 });
  return { parts, anchors: { kingpin: [0, 0, 0], front_wall: [0, yc, zf], rear_center: [0, yc, zr], tail_lamps: [[1.05, y0 + 0.4, zr - 0.1], [-1.05, y0 + 0.4, zr - 0.1]], side_z: [zf, zr], height: [y0, y1], width: W } };
}
