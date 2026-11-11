// sts_crane: a ship-to-shore container crane, Port Newark class (post-Panamax): the structure, boom lowered.
//
// Reference (why it is specific): the Port Newark-Elizabeth photograph (Wikimedia Commons, CC BY 4.0, VynedJ) shows red
// lattice-and-box STS cranes with white bands over five-high stacks. Dimensions after a typical post-Panamax gantry
// (ZPMC / Liebherr class): rail gauge 30.5 m, base 27 m between leg rows, outreach 60 m, backreach 20 m, lift 40 m above
// rail, portal clearance 15 m, A-frame apex about 80 m, twin box girders with stiffeners, forestay and backstay ropes,
// machinery house on the landside girders, sill beams with wheel bogies on rail, ladders, walkway rails, flood lamps and red
// aviation lights. The trolley, operator cab and the spreader are separate catalogued assets (they move).
// Axes: the quay runs along X, rails at z = +-15.24; the boom points to +Z (seaward); Y up; origin at rail level, crane centre.
import * as THREE from 'three';
import { beam, truss, mergeGeometries } from '../geo.js';

export const meta = {
  type: 'cranes', title: 'STS container crane (post-Panamax, boom lowered)',
  refs: [
    { what: 'Port Newark-Elizabeth Marine Terminal from I-95', url: 'https://commons.wikimedia.org/wiki/File:Port_Newark-Elizabeth_Marine_Terminal.jpg', licence: 'CC BY 4.0, VynedJ', use: 'the red-and-white banding, box booms, lattice A-frame; reference only, no pixels used' },
    { what: 'STS crane general arrangement (post-Panamax class)', use: 'gauge 30.5 m, base 27 m, outreach 60 m, backreach 20 m, lift 40 m' },
  ],
  licence: { geometry: 'original, built for this project (CC0)', references: 'proportions and arrangement only' },
  changes: ['boxes, box girders with stiffeners, lattice A-frame, ropes, ladders and walkway rails as real members', 'red and white leg and boom banding as separate materials so a piece can repaint', 'flood lamps and aviation lights as their own emissive parts'],
  bake: { maxEdge: 3, rays: 10, maxDist: 12 },
  lod1: 0.3, lod1error: 0.2,
  used_by: ['modeling c1 PORT NEWARK. demo'],
};

const bx = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const merge = a => mergeGeometries(a.map(g => (g.index ? g.toNonIndexed() : g)));

export async function build(k) {
  const parts = []; const P = (name, mat, geo, o = {}) => parts.push({ name, mat, geo, noUV: true, ...o });
  const G = 15.24, B = 13.5, LEG_TOP = 43.5, GIRD_Y = 46.2;
  // rails and sills
  P('rails', 'crane.steel', merge([-1, 1].map(s => bx(70, 0.25, 0.5, 0, 0.12, s * G))), { maxEdge: 6 });
  P('sills', 'crane.red', merge([-1, 1].map(s => bx(2 * B + 2.4, 1.5, 1.7, 0, 1.0, s * G))), { maxEdge: 3 });
  const wheels = [], eq = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let i = 0; i < 4; i++) {
    const wx = sx * B + (i - 1.5) * 1.1, g = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 20).rotateX(Math.PI / 2).translate(wx, 0.5, sz * G); wheels.push(g);
    eq.push(bx(0.5, 0.35, 0.5, wx, 0.5, sz * G));
  }
  P('wheels', 'crane.black', merge(wheels), { maxEdge: 0.6 }); P('bogie_beams', 'crane.black', merge([...eq, ...[-1, 1].flatMap(sx => [-1, 1].map(sz => bx(5.2, 0.4, 0.9, sx * B, 0.95, sz * G)))]), { maxEdge: 1.5 });
  // legs: red with white bands (a lower band, a wide upper band)
  const legs = { red: [], white: [] };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * B, z = sz * G;
    legs.red.push(bx(2.4, 16.5, 2.4, x, 1.8 + 8.25, z), bx(2.4, 20.0, 2.4, x, 23.3 + 10, z));
    legs.white.push(bx(2.44, 3.2, 2.44, x, 18.3 + 1.6, z), bx(2.44, 4.0, 2.44, x, LEG_TOP - 2.0, z));
    legs.red.push(bx(3.0, 1.0, 3.0, x, 1.7, z));
  }
  P('legs_red', 'crane.red', merge(legs.red), { maxEdge: 3 }); P('legs_white', 'crane.white', merge(legs.white), { maxEdge: 3 });
  // portal beams (along Z at x = +-B), top cross beams (along X at z = +-G)
  const beams = [];
  for (const sx of [-1, 1]) for (const y of [18.5, 40.5]) beams.push(bx(2.0, 2.4, 2 * G, sx * B, y, 0));
  for (const sz of [-1, 1]) for (const y of [41.6]) beams.push(bx(2 * B, 2.6, 2.2, 0, y, sz * G));
  P('portal_beams', 'crane.red', merge(beams), { maxEdge: 3 });
  // bracing: X in the planes z = +-G between leg rows, K in the portal planes
  const br = [];
  for (const sz of [-1, 1]) { br.push(beam([-B, 3, sz * G], [B, 41, sz * G], 0.8, 0.8), beam([B, 3, sz * G], [-B, 41, sz * G], 0.8, 0.8)); }
  for (const sx of [-1, 1]) { br.push(beam([sx * B, 2, -G], [sx * B, 18.5, 0], 0.8, 0.8), beam([sx * B, 2, G], [sx * B, 18.5, 0], 0.8, 0.8), beam([sx * B, 18.5, -G], [sx * B, 40.5, 0], 0.7, 0.7), beam([sx * B, 18.5, G], [sx * B, 40.5, 0], 0.7, 0.7)); }
  P('bracing', 'crane.red', merge(br.map(g => g.index ? g.toNonIndexed() : g)), { maxEdge: 4 });
  // twin box girders along Z with stiffener ribs, hinge collar, white boom-tip band
  const gx = 3.4, z0 = -24, z1 = 61.5, gl = z1 - z0, gc = (z0 + z1) / 2, gy = GIRD_Y + 1.2;
  const gird = [], ribs = [], tips = [];
  for (const sx of [-1, 1]) {
    gird.push(bx(2.0, 3.0, gl - 7, sx * gx, gy, gc - 3.5));
    tips.push(bx(2.04, 3.04, 7, sx * gx, gy, z1 - 3.5));
    for (let z = z0 + 2; z < z1 - 2; z += 3) ribs.push(bx(0.16, 3.1, 0.14, sx * gx - 1.03, gy, z), bx(0.16, 3.1, 0.14, sx * gx + 1.03, gy, z));
    // lower walkway + rail posts
    ribs.push(bx(1.0, 0.1, gl, sx * (gx + 1.5), gy - 1.2, gc));
  }
  P('girders', 'crane.red', merge(gird), { maxEdge: 5 }); P('boom_tips', 'crane.white', merge(tips), { maxEdge: 4 }); P('girder_ribs', 'crane.red', merge(ribs), { maxEdge: 4, noUV: true });
  const ties = []; for (let z = z0 + 6; z < z1 - 4; z += 14) ties.push(bx(2 * gx + 2.0, 1.0, 1.0, 0, gy + 1.9, z));
  P('cross_ties', 'crane.red', merge(ties), { maxEdge: 4 });
  // A-frame: lattice legs in the YZ plane at each girder, apex at (z = 8, y = 80)
  const af = [], apex = [8, 80.5];
  for (const sx of [-1, 1]) {
    af.push(truss({ p0: [sx * gx, GIRD_Y + 2.7, 1], p1: [sx * gx, apex[1], apex[0] - 0.4], w: 1.3, h: 1.3, bays: 14, chord: 0.22, diag: 0.13, up: [1, 0, 0] }));
    af.push(truss({ p0: [sx * gx, GIRD_Y + 2.7, 16.5], p1: [sx * gx, apex[1], apex[0] + 0.4], w: 1.3, h: 1.3, bays: 14, chord: 0.22, diag: 0.13, up: [1, 0, 0] }));
    for (const y of [56, 68]) af.push(beam([sx * gx, y, 4.6 + (y - 47) * 0.02], [sx * gx, y, 12.4 - (y - 47) * 0.02], 0.3, 0.3));
  }
  af.push(beam([-gx, 76, 8], [gx, 76, 8], 0.6, 0.6));
  P('a_frame', 'crane.red', merge(af.map(g => g.index ? g.toNonIndexed() : g)), { maxEdge: 3 });
  P('apex_cap', 'crane.white', merge([bx(2 * gx + 1.6, 1.4, 1.8, 0, apex[1] + 0.9, apex[0])]), { maxEdge: 3 });
  // ropes: forestay (apex to boom tip), backstay (apex to backreach end), boom hoist lines
  const ropes = [];
  for (const sx of [-1, 1]) for (const dx of [-0.35, 0.35]) {
    ropes.push(beam([sx * gx + dx, apex[1], apex[0]], [sx * gx + dx, GIRD_Y + 2.6, z1 - 1.0], 0.16, 0.16), beam([sx * gx + dx, apex[1], apex[0]], [sx * gx + dx, GIRD_Y + 2.6, z0 + 1.5], 0.16, 0.16));
    ropes.push(beam([sx * gx + dx, apex[1] - 3, apex[0] + 1], [sx * gx + dx, GIRD_Y + 2.6, 34], 0.1, 0.1));
  }
  P('stays', 'crane.steel', merge(ropes.map(g => g.index ? g.toNonIndexed() : g)), { maxEdge: 8 });
  // machinery house + counterweight on the landside girders; electrical house; vents
  P('machinery_house', 'crane.house', merge([bx(9.0, 5.6, 15.5, 0, GIRD_Y + 5.2, -13.5), bx(9.4, 0.4, 16, 0, GIRD_Y + 8.15, -13.5), bx(3.2, 3.0, 4.5, 0, GIRD_Y + 9.6, -18), bx(8.6, 1.6, 3, 0, GIRD_Y + 3.0, -25.5)]), { maxEdge: 3 });
  const vents = []; for (let i = 0; i < 8; i++) for (const s of [-1, 1]) vents.push(bx(0.15, 1.6, 1.0, s * 4.55, GIRD_Y + 5.4, -19 + i * 1.7));
  P('house_vents', 'crane.black', merge(vents), { maxEdge: 2 });
  P('house_windows', 'crane.glass', merge([bx(0.1, 1.2, 5.5, 4.53, GIRD_Y + 5.6, -6.5), bx(0.1, 1.2, 5.5, -4.53, GIRD_Y + 5.6, -6.5)]), { maxEdge: 2 });
  // ladders on the legs (rails + rungs) and walkway rail posts along the girders
  const lad = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const x = sx * B + sx * 1.25, z = sz * G; lad.push(bx(0.06, 40, 0.06, x, 22, z - 0.2), bx(0.06, 40, 0.06, x, 22, z + 0.2)); for (let y = 3; y < 41.5; y += 0.32) lad.push(bx(0.05, 0.05, 0.4, x, y, z)); }
  P('ladders', 'crane.steel', merge(lad), { maxEdge: 8 });
  const rail = []; for (const sx of [-1, 1]) { const x = sx * (gx + 2.0); rail.push(bx(0.06, 0.06, gl, x, gy - 0.1, gc)); for (let z = z0 + 1; z < z1; z += 2.5) rail.push(bx(0.06, 1.1, 0.06, x, gy - 0.65, z)); }
  P('walkway_rails', 'crane.steel', merge(rail), { maxEdge: 8 });
  // lamps: flood banks on the legs and under the boom; red aviation lights at the boom tips, apex, and the backreach end
  const fl = []; for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [16.5, 38]) fl.push(bx(0.9, 0.5, 0.35, sx * B, y, sz * (G + 1.35)));
  for (let z = -18; z < 60; z += 9) for (const sx of [-1, 1]) fl.push(bx(1.0, 0.4, 0.4, sx * (gx + 0.0), gy - 1.6, z));
  P('floods', 'lamp.flood', merge(fl), { maxEdge: 1 });
  const av = [bx(0.5, 0.5, 0.5, -gx, gy + 1.7, z1), bx(0.5, 0.5, 0.5, gx, gy + 1.7, z1), bx(0.6, 0.6, 0.6, 0, apex[1] + 1.9, apex[0]), bx(0.5, 0.5, 0.5, -gx, gy + 1.7, z0), bx(0.5, 0.5, 0.5, gx, gy + 1.7, z0)];
  P('aviation_lights', 'lamp.red', merge(av), { maxEdge: 1 });
  // crane number plate on the seaward leg (a quad with UV, textured at runtime from decals.stencil)
  const pl = new THREE.PlaneGeometry(4.2, 1.1).rotateY(0).translate(B, 30, G + 1.23);
  P('number_plate', 'crane.number', pl, { noUV: false, maxEdge: 2 });
  return { parts, anchors: { rail_z: [G, -G], boom_tip: [0, gy, z1], apex: [0, apex[1], apex[0]], girder_y: gy, girder_x: gx, trolley_rail_y: gy + 1.55, quay_z: z1, legs: [[B, 0, G], [-B, 0, G], [B, 0, -G], [-B, 0, -G]], floods_y: [16.5, 38], number_plate: [B, 30, G + 1.3] } };
}
