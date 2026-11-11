// sts_trolley: the trolley that runs on the STS crane's girders, with its hanging operator cab.
// Origin: the trolley's centre on the girder rail line (y = 0 is the rail top); the cab hangs below on the seaward side.
// The cab is where the crane driver sits looking straight down through a glass floor, the picture Sekula's dockers photographs
// keep returning to: a person, alone, at the top of the logistics.
import * as THREE from 'three';
import { mergeGeometries } from '../geo.js';
export const meta = {
  type: 'cranes', title: 'STS trolley with operator cab',
  refs: [{ what: 'STS trolley arrangement: four-wheel bogies on the girder rails, hoist sheaves, hanging operator cab', use: 'layout and scale' }],
  licence: { geometry: 'original, built for this project (CC0)' },
  changes: ['cab glazing as its own material so a piece can light the driver'],
  bake: { maxEdge: 0.6, rays: 12, maxDist: 3 }, lod1: 0.4, lod1error: 0.05,
  used_by: ['modeling c1 PORT NEWARK. demo'],
};
const bx = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const merge = a => mergeGeometries(a.map(g => (g.index ? g.toNonIndexed() : g)));
export async function build(k) {
  const parts = []; const P = (name, mat, geo, o = {}) => parts.push({ name, mat, geo, noUV: true, ...o });
  const gx = 3.4;
  P('trolley_frame', 'crane.house', merge([bx(2 * gx + 2.6, 0.9, 5.4, 0, 0.9, 0), bx(1.4, 1.6, 5.4, -gx, 1.5, 0), bx(1.4, 1.6, 5.4, gx, 1.5, 0), bx(6.2, 0.5, 1.6, 0, 1.9, 1.7)]), { maxEdge: 1.2 });
  const wh = []; for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const dz of [-1.7, 1.7]) wh.push(new THREE.CylinderGeometry(0.4, 0.4, 0.5, 18).rotateZ(Math.PI / 2).translate(sx * gx, 0.4, dz));
  P('wheels', 'crane.black', merge(wh), { maxEdge: 0.4 });
  const sh = []; for (const sx of [-1, 1]) for (const z of [-1.2, 1.2]) sh.push(new THREE.CylinderGeometry(0.5, 0.5, 0.25, 20).rotateZ(Math.PI / 2).translate(sx * 1.05, 0.3, z));
  P('hoist_sheaves', 'crane.steel', merge(sh), { maxEdge: 0.5 });
  // operator cab hanging on the seaward side: a box with a front window, a glass floor panel, and a red stripe
  P('cab', 'crane.house', merge([bx(3.0, 2.3, 2.6, 0, -1.9, 3.6), bx(0.2, 1.6, 0.2, -1.2, -0.5, 3.0), bx(0.2, 1.6, 0.2, 1.2, -0.5, 3.0), bx(3.2, 0.25, 2.8, 0, -0.7, 3.6)]), { maxEdge: 0.6 });
  P('cab_glass', 'crane.cabglass', merge([bx(2.7, 1.1, 0.08, 0, -1.65, 4.95), bx(0.08, 1.1, 1.8, 1.53, -1.65, 3.9), bx(0.08, 1.1, 1.8, -1.53, -1.65, 3.9), bx(2.0, 0.08, 1.8, 0, -3.02, 3.7)]), { maxEdge: 0.5 });
  return { parts, anchors: { rope_points: [[-1.05, 0.3, -1.2], [1.05, 0.3, -1.2], [-1.05, 0.3, 1.2], [1.05, 0.3, 1.2]], cab_front: [0, -1.65, 4.98], cab_floor: [0, -3.0, 3.7], rail_y: 0 } };
}
