// sts_spreader: the head block and telescopic spreader that hangs under an STS crane's trolley (40 ft setting), with its
// own flood lamps. The lamps are what rake the stack faces in the PORT NEWARK. shot: a spreader is the one light source in a
// container yard that MOVES DOWN a stack face, so its lamps are separate emissive parts a piece can drive.
// Origin at the top-centre of the frame (where the head block's ropes meet); the frame's underside is at y = -1.0; +Z is the
// spreader's long axis.
import * as THREE from 'three';
import { mergeGeometries } from '../geo.js';
export const meta = {
  type: 'cranes', title: 'STS spreader (40 ft) with head block',
  refs: [{ what: 'ISO 3874 twist-lock geometry; telescopic container spreader arrangement', use: 'frame 12.2 x 2.4 m, four corner twistlocks, flippers, head block' }],
  licence: { geometry: 'original, built for this project (CC0)' },
  changes: ['flood lamps as separate emissive parts', 'guide flippers at the four corners'],
  bake: { maxEdge: 0.6, rays: 12, maxDist: 2.5 }, lod1: 0.4, lod1error: 0.05,
  used_by: ['modeling c1 PORT NEWARK. demo'],
};
const bx = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const merge = a => mergeGeometries(a.map(g => (g.index ? g.toNonIndexed() : g)));
export async function build(k) {
  const parts = []; const P = (name, mat, geo, o = {}) => parts.push({ name, mat, geo, noUV: true, ...o });
  const L = 12.19, Wd = 2.44;
  // frame: two side beams, two end beams (telescoping ends), mid cross members
  P('frame', 'crane.house', merge([bx(0.55, 0.7, L, -Wd / 2 + 0.28, -0.65, 0), bx(0.55, 0.7, L, Wd / 2 - 0.28, -0.65, 0), bx(Wd, 0.6, 0.7, 0, -0.62, L / 2 - 0.35), bx(Wd, 0.6, 0.7, 0, -0.62, -L / 2 + 0.35), bx(Wd, 0.4, 0.5, 0, -0.55, 0), bx(Wd - 1.0, 0.5, 1.6, 0, -0.4, 0)]), { maxEdge: 1.2 });
  P('frame_stripe', 'crane.red', merge([bx(0.58, 0.2, L * 0.98, -Wd / 2 + 0.28, -0.4, 0), bx(0.58, 0.2, L * 0.98, Wd / 2 - 0.28, -0.4, 0)]), { maxEdge: 1.5 });
  // head block on top: a heavy box with two sheave pairs and a cable guard
  P('head_block', 'crane.black', merge([bx(3.4, 1.0, 2.4, 0, 0.3, 0), bx(3.0, 0.6, 2.0, 0, 1.05, 0)]), { maxEdge: 0.8 });
  const sh = []; for (const sx of [-1, 1]) for (const sz of [-1, 1]) sh.push(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 20).rotateZ(Math.PI / 2).translate(sx * 1.05, 1.5, sz * 0.75));
  P('sheaves', 'crane.steel', merge(sh), { maxEdge: 0.5 });
  // bridle: the four wire-rope lugs meeting the frame (fixed to head block)
  P('bridle', 'crane.steel', merge([bx(0.3, 1.0, 0.3, -1.4, -0.05, 0.8), bx(0.3, 1.0, 0.3, 1.4, -0.05, 0.8), bx(0.3, 1.0, 0.3, -1.4, -0.05, -0.8), bx(0.3, 1.0, 0.3, 1.4, -0.05, -0.8)]), { maxEdge: 0.5 });
  // twistlock housings at the four corners with guide flippers
  const tl = [], fl = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    tl.push(bx(0.45, 0.5, 0.5, sx * 1.0, -1.2, sz * (L / 2 - 0.3)), new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10).translate(sx * 1.0, -1.65, sz * (L / 2 - 0.3)));
    fl.push(bx(0.06, 0.75, 0.6, sx * 1.35, -1.2, sz * (L / 2 - 0.3)), bx(0.06, 0.75, 0.6, sx * 0.65, -1.2, sz * (L / 2 - 0.3)));
  }
  P('twistlocks', 'crane.steel', merge(tl), { maxEdge: 0.3 }); P('flippers', 'crane.red', merge(fl), { maxEdge: 0.4 });
  // flood lamps: a bank on each end of the frame, aimed down and along (the emissive part; a piece drives a real light at the same place)
  const lamps = []; for (const sz of [-1, 1]) for (const sx of [-0.7, 0, 0.7]) lamps.push(bx(0.5, 0.22, 0.3, sx, -0.95, sz * (L / 2 - 0.05)));
  P('flood_lamps', 'lamp.flood', merge(lamps), { maxEdge: 0.3 });
  return { parts, anchors: { rope_tops: [[-1.05, 1.5, 0.75], [1.05, 1.5, 0.75], [-1.05, 1.5, -0.75], [1.05, 1.5, -0.75]], frame_bottom: -1.0, corner_locks: [[1, -1.4, L / 2 - 0.3], [-1, -1.4, L / 2 - 0.3], [1, -1.4, -L / 2 + 0.3], [-1, -1.4, -L / 2 + 0.3]], lamps: [[0, -0.95, L / 2 - 0.1], [0, -0.95, -L / 2 + 0.1]] } };
}
