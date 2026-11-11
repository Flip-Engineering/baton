// mill_stand: a two-high rolling-mill stand, cast housings with roll windows, chocks, rolls, a screwdown with its handwheel,
// tie bars, sole plate, drive spindle and a couple of table rollers.
//
// Reference (why it is specific): HAER photographs pulled from loc.gov (public domain), not memory: Bethlehem Steel
// (pa3388.photos.359751p), Johnstown hand-operated 2- and 3-high stands (pa3037.photos.358244p), Phoenix Iron rolling mill
// (pa3841.photos.362499p). What they show and this builds: a housing is a cast frame with a window that takes the roll
// chocks (the window is CUT, not drawn), the top of the housing carries the screwdown (a screw and nut, gear case, hand-
// wheel), housings stand on a sole plate on heavy anchor bolts, and the roll necks pass out through coupling boxes to a
// spindle. That is why this uses manifold-3d: a casting with a bore is not a box and a cylinder.
// Axes: roll axes along X; housings at x = +-1.25; the mill's pass line runs along Z; Y up; origin on the sole plate centre.
import * as THREE from 'three';
import { mergeGeometries } from '../geo.js';
export const meta = {
  type: 'mill', title: 'Two-high rolling-mill stand',
  refs: [
    { what: 'HAER Bethlehem Steel rolling mill', url: 'https://www.loc.gov/item/pa3388/', id: 'pa3388.photos.359751p', licence: 'public domain (HAER, Library of Congress)', use: 'housing and window proportions, screwdown position' },
    { what: 'HAER Johnstown hand-operated 2- and 3-high stands', url: 'https://www.loc.gov/item/pa3037/', id: 'pa3037.photos.358244p', licence: 'public domain', use: 'handwheel screwdown, coupling boxes' },
    { what: 'HAER Phoenix Iron rolling mill', id: 'pa3841.photos.362499p', licence: 'public domain', use: 'roll table and guides' },
  ],
  licence: { geometry: 'original, built for this project (CC0)', references: 'HAER photographs public domain; used as measured reference, no pixels used' },
  changes: ['housing windows cut with manifold-3d (a casting with a bore)', 'screwdown, handwheel, tie bars, chocks, rolls, couplings, spindle', 'vertex AO / convex-edge / part-id bake (rust and oil run from the seams)'],
  bake: { maxEdge: 0.45, rays: 14, maxDist: 1.6 }, lod1: 0.35, lod1error: 0.02,
  used_by: ['modeling c1 event-light clip (Steel 1938 rod mill)'],
};
const bx = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const merge = a => mergeGeometries(a.map(g => (g.index ? g.toNonIndexed() : g)));
export async function build(k) {
  const parts = []; const P = (name, mat, geo, o = {}) => parts.push({ name, mat, geo, ...o });
  const hx = 1.25;
  // sole plate and anchor bolts
  P('sole_plate', 'mill.cast', k.geo(k.sub(k.rbox(3.7, 0.3, 2.1, 0.04, 0, 0.15, 0), k.box(0.3, 0.1, 1.4, 0, 0.3, 0))), { maxEdge: 0.6 });
  const anc = []; for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const dx of [-0.5, 0.5]) anc.push(k.cyl(0.05, 0.16, sx * (hx + dx * 1.2), 0.36, sz * 0.85, 8));
  P('anchor_bolts', 'mill.steel', k.geo(k.add(...anc)), { maxEdge: 0.08 });
  // housings: cast frame, window cut through the thickness, chamfers by rbox, ribs, top boss for the screwdown, bearing caps
  const housing = sx => {
    let h = k.rbox(0.62, 3.75, 1.35, 0.06, 0, 2.15, 0);
    h = k.sub(h, k.rbox(0.9, 1.75, 0.66, 0.05, 0, 1.95, 0));                                   // the roll window
    h = k.sub(h, k.rbox(0.9, 0.2, 0.42, 0.04, 0, 3.3, 0));                                       // screwdown bore area
    h = k.add(h, k.rbox(0.62, 0.2, 1.55, 0.05, 0, 0.36, 0), k.rbox(0.8, 0.28, 1.25, 0.05, 0, 4.15, 0));   // foot flange, top cap seat
    h = k.add(h, k.rbox(0.18, 3.0, 0.16, 0.03, 0.28, 2.1, 0.68), k.rbox(0.18, 3.0, 0.16, 0.03, 0.28, 2.1, -0.68));  // outer ribs
    return k.move(h, sx * hx, 0, 0);
  };
  P('housing_L', 'mill.cast', k.geo(housing(-1)), { maxEdge: 0.5 }); P('housing_R', 'mill.cast', k.geo(housing(1)), { maxEdge: 0.5 });
  // cap / crosshead beam and tie bars with nuts
  P('cross_beam', 'mill.cast', k.geo(k.rbox(2 * hx + 0.9, 0.4, 0.95, 0.05, 0, 4.42, 0)), { maxEdge: 0.3 });
  const ties = [], nuts = []; for (const sx of [-1, 1]) for (const sz of [-1, 1]) { ties.push(k.cyl(0.055, 4.3, sx * (hx + 0.18), 2.35, sz * 0.5, 12)); nuts.push(k.cyl(0.1, 0.12, sx * (hx + 0.18), 4.6, sz * 0.5, 6), k.cyl(0.1, 0.12, sx * (hx + 0.18), 0.5, sz * 0.5, 6)); }
  P('tie_bars', 'mill.steel', k.geo(k.add(...ties)), { maxEdge: 0.3 }); P('tie_nuts', 'mill.steel', k.geo(k.add(...nuts)), { maxEdge: 0.08 });
  // rolls: barrels and necks through the windows, chocks (bronze), coupling boxes outside
  const yTop = 2.32, yBot = 1.56, rr = 0.36, neck = 0.19, barrel = 1.5;
  const roll = y => k.add(k.cylX(rr, barrel, 0, y, 0, 36), k.cylX(neck, 4.7, 0, y, 0, 24));
  P('roll_top', 'mill.roll', k.geo(roll(yTop)), { maxEdge: 0.25 }); P('roll_bottom', 'mill.roll', k.geo(roll(yBot)), { maxEdge: 0.25 });
  const chocks = []; for (const sx of [-1, 1]) for (const y of [yTop, yBot]) chocks.push(k.rbox(0.42, 0.44, 0.6, 0.03, sx * hx, y + (y > 2 ? 0.05 : -0.05), 0));
  P('chocks', 'mill.bronze', k.geo(k.add(...chocks)), { maxEdge: 0.15 });
  const coup = []; for (const sx of [-1, 1]) for (const y of [yTop, yBot]) coup.push(k.rbox(0.4, 0.42, 0.42, 0.04, sx * (hx + 0.9), y, 0));
  P('coupling_boxes', 'mill.cast', k.geo(k.add(...coup)), { maxEdge: 0.15 });
  // drive spindles from the couplings (-X side) with universal joints
  P('spindles', 'mill.steel', merge([new THREE.CylinderGeometry(0.11, 0.11, 2.6, 16).rotateZ(Math.PI / 2).translate(-hx - 2.4, yTop, 0), new THREE.CylinderGeometry(0.11, 0.11, 2.6, 16).rotateZ(Math.PI / 2).translate(-hx - 2.4, yBot, 0), new THREE.SphereGeometry(0.2, 16, 12).translate(-hx - 1.3, yTop, 0), new THREE.SphereGeometry(0.2, 16, 12).translate(-hx - 1.3, yBot, 0)]), { maxEdge: 0.2 });
  // screwdown: gear case on each housing top, the screw into the window, and a handwheel on the +X housing (Johnstown)
  P('screw_cases', 'mill.paint', k.geo(k.add(k.rbox(0.55, 0.5, 0.7, 0.05, -hx, 4.65, 0), k.rbox(0.55, 0.5, 0.7, 0.05, hx, 4.65, 0))), { maxEdge: 0.15 });
  P('screws', 'mill.steel', k.geo(k.add(k.cyl(0.07, 1.2, -hx, 3.55, 0, 12), k.cyl(0.07, 1.2, hx, 3.55, 0, 12))), { maxEdge: 0.15 });
  // handwheel: a torus rim (revolved circle) with six spokes and a hub, on a shaft out of the +X gear case
  const rimProf = []; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; rimProf.push([0.36 + Math.cos(a) * 0.025, Math.sin(a) * 0.025]); }
  let hw = k.revolve(rimProf, 32); const spokes = []; for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI; spokes.push(k.rot(k.box(0.72, 0.03, 0.03, 0, 0, 0), 0, 0, a * 180 / Math.PI)); }
  hw = k.add(hw, ...spokes.map(s => k.rot(s, 90, 0, 0)), k.cyl(0.06, 0.1, 0, 0, 0, 12));
  hw = k.move(k.rot(hw, 0, 0, 90), hx + 0.45, 4.65, 0);   // wheel plane is YZ: axis along X
  P('handwheel', 'mill.steel', k.geo(hw), { maxEdge: 0.06 });
  P('handwheel_shaft', 'mill.steel', k.geo(k.cylX(0.04, 0.5, hx + 0.42, 4.65, 0, 10)), { maxEdge: 0.1 });
  // entry and delivery guides, and two table rollers each side along the pass line (Z)
  P('guides', 'mill.paint', k.geo(k.add(k.rbox(1.3, 0.16, 1.1, 0.03, 0, 1.95, 1.1), k.rbox(1.3, 0.16, 1.1, 0.03, 0, 1.95, -1.1))), { maxEdge: 0.2 });
  const tr = []; for (const z of [2.3, 2.9, 3.5, -2.3, -2.9, -3.5]) tr.push(k.cylX(0.12, 1.5, 0, 1.55, z, 20));
  P('table_rollers', 'mill.steel', k.geo(k.add(...tr)), { maxEdge: 0.2 });
  P('table_frame', 'mill.cast', merge([bx(0.2, 0.3, 8, -0.85, 1.3, 0), bx(0.2, 0.3, 8, 0.85, 1.3, 0)].map(g => g)), { maxEdge: 0.5, noUV: true });
  return { parts, anchors: { window: [0, 1.95, 0], roll_gap: [0, 1.94, 0], handwheel: [hx + 0.45, 4.65, 0], housing_R_face: [hx + 0.31, 2.1, 0], top: [0, 4.9, 0] } };
}
