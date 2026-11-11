// tractor_aero: a Class 8 aero sleeper tractor, the client's truck. The cab is LOFTED (rings joined along its length, the way
// sheet metal is really shaped) instead of stacked boxes, with a raised-roof sleeper, roof visor, cab extenders, a
// West Coast mirror on two arms (the picture the poster is built around), roof marker lamps, steps, grab handle, chrome fuel
// tanks, frame rails, tandem drive axles with dual tyres and a fifth wheel.
//
// Reference (why it is specific): the client's own poster (sources/acp_own_the_future.jpg, 'OWN THE FUTURE'): a tall
// cream sleeper cab lit by the dusk band, a rectangular chrome-frame mirror on two long arms at the door, a small sleeper
// window, an amber marker lamp standing out from the roof edge, a bright vertical chrome strip at the cab/trailer gap, the van's
// dark front corner behind. Dimensions after a Freightliner Cascadia / Volvo VNL class: 2.6 m over mirrors excluded, day cab 2.3 m
// long, sleeper 1.9 m, raised roof 3.9 m, wheelbase 4.7 m, tyres 11R22.5 (1.05 m). Not a copy of a make: an invented, specific
// aero sleeper of that class.
// Axes: forward +Z, left side +X (the poster's side), up +Y; origin on the ground under the steer axle centre.
import * as THREE from 'three';
import { lofted, tubeAlong, mergeGeometries, boxUV } from '../geo.js';

export const meta = {
  type: 'trucks', title: 'Class 8 aero sleeper tractor',
  refs: [
    { what: "the client's poster 'OWN THE FUTURE' (cab, mirror, marker lamp, chrome strip)", url: 'videos/sources/acp_own_the_future.jpg', licence: "client's own art, supplied for ACP use", use: 'cab type, mirror, roof lamp; the camera match test lays the model over it' },
    { what: 'Class 8 aero sleeper dimensions (Cascadia / VNL class)', use: 'wheelbase 4.7 m, sleeper 1.9 m, 11R22.5 tyres, 2.6 m width' },
  ],
  licence: { geometry: 'original, built for this project (CC0)', references: 'proportions only; no make copied' },
  changes: ['lofted cab shell', 'West Coast mirror assembly on two arms', 'roof markers and clearance lamps as emissive parts', 'chrome tanks, stacks, steps and rails'],
  bake: { maxEdge: 0.3, rays: 16, maxDist: 1.4 }, lod1: 0.35, lod1error: 0.02,
  used_by: ['modeling c1 truck demo', 'modeling c1 PORT NEWARK. demo'],
};

export const CAB = { z0: -3.35, z1: 1.3, y0: 1.0, y1: 4.2 };
const bx = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const merge = a => mergeGeometries(a.map(g => (g.index ? g.toNonIndexed() : g)));
// cab-side uv: the decal texture (cab side, front at u = 0) is painted in these metres
function cabUV(g) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)); let u = 0.015, v = 0.015;
    if (nx > 0.5) { u = (CAB.z1 - p.getZ(i)) / (CAB.z1 - CAB.z0); v = (p.getY(i) - CAB.y0) / (CAB.y1 - CAB.y0); }
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
}

export async function build(k) {
  const parts = []; const P = (name, mat, geo, o = {}) => parts.push({ name, mat, geo, ...o });
  // ---- cab shell: stations from the nose to the back of the sleeper
  const S = [
    { z: 1.30, w: 2.02, h0: 1.22, h1: 2.55, r: 0.42, topSag: 0.02 },
    { z: 1.22, w: 2.20, h0: 1.10, h1: 2.85, r: 0.44, topSag: 0.03 },
    { z: 0.95, w: 2.42, h0: 1.00, h1: 3.15, r: 0.36, topSag: 0.04 },
    { z: 0.50, w: 2.52, h0: 1.00, h1: 3.40, r: 0.30, topSag: 0.05 },
    { z: -0.20, w: 2.55, h0: 1.00, h1: 3.50, r: 0.26, topSag: 0.05 },
    { z: -1.05, w: 2.55, h0: 1.00, h1: 3.56, r: 0.24, topSag: 0.05 },
    { z: -1.35, w: 2.56, h0: 1.00, h1: 3.70, r: 0.26, topSag: 0.05 },    // the raised roof starts
    { z: -1.85, w: 2.58, h0: 1.00, h1: 3.98, r: 0.28, topSag: 0.05 },
    { z: -2.90, w: 2.58, h0: 1.00, h1: 4.02, r: 0.30, topSag: 0.05 },
    { z: -3.25, w: 2.50, h0: 1.05, h1: 3.94, r: 0.42, topSag: 0.04 },
    { z: -3.35, w: 2.28, h0: 1.12, h1: 3.80, r: 0.55, topSag: 0.03 },
  ].sort((a, b) => b.z - a.z);
  const cab = lofted(S.slice().reverse(), { n: 56, flip: true }); cabUV(cab);
  P('cab_shell', 'cab.paint', cab, { maxEdge: 0.3 });
  // ---- glass: windshield (raked), door glass sits in the side decal; the sleeper side window is drawn in the decal too
  const ws = new THREE.BoxGeometry(2.05, 1.05, 0.05); ws.rotateX(-0.42); ws.translate(0, 2.98, 0.86); P('windshield', 'cab.glass', ws, { noUV: true, maxEdge: 0.4 });
  // ---- roof visor and deflector, cab extenders (the bright vertical chrome strips of the poster) and the gap filler
  const vis = new THREE.BoxGeometry(2.3, 0.08, 0.5); vis.rotateX(-0.12); vis.translate(0, 3.42, 0.62); P('visor', 'cab.paint', vis, { noUV: true, maxEdge: 0.4 });
    P('extenders', 'cab.paint', merge([bx(0.06, 2.6, 0.55, 1.36, 2.55, -3.62), bx(0.06, 2.6, 0.55, -1.36, 2.55, -3.62)]), { noUV: true, maxEdge: 0.5 });
  P('extender_chrome', 'chrome', merge([bx(0.05, 2.6, 0.05, 1.39, 2.55, -3.3), bx(0.05, 2.6, 0.05, -1.39, 2.55, -3.3), bx(0.05, 2.6, 0.05, 1.39, 2.55, -3.9), bx(0.05, 2.6, 0.05, -1.39, 2.55, -3.9)]), { noUV: true, maxEdge: 0.5 });
  // ---- front: grille, bumper, headlamps, fog lamps, tow hooks
  const grille = []; for (let i = -6; i <= 6; i++) grille.push(bx(0.06, 0.55, 0.05, i * 0.135, 1.72, 1.36));
  P('grille', 'chrome', merge(grille), { noUV: true, maxEdge: 0.2 }); P('grille_frame', 'cab.trim', merge([bx(1.85, 0.72, 0.06, 0, 1.72, 1.33)]), { noUV: true, maxEdge: 0.3 });
  P('bumper', 'chrome', merge([bx(2.55, 0.34, 0.32, 0, 0.72, 1.45), bx(0.3, 0.5, 0.3, 1.2, 0.85, 1.4), bx(0.3, 0.5, 0.3, -1.2, 0.85, 1.4)]), { noUV: true, maxEdge: 0.3 });
  P('headlamps', 'lamp.head', merge([bx(0.42, 0.24, 0.1, 0.9, 1.95, 1.3), bx(0.42, 0.24, 0.1, -0.9, 1.95, 1.3)]), { noUV: true, maxEdge: 0.2 });
  P('fog_lamps', 'lamp.head', merge([bx(0.18, 0.14, 0.08, 0.86, 1.02, 1.42), bx(0.18, 0.14, 0.08, -0.86, 1.02, 1.42)]), { noUV: true, maxEdge: 0.2 });
  P('marker_stalks', 'chrome', merge([bx(0.03, 0.03, 0.14, 1.32, 3.9, -1.9), bx(0.03, 0.03, 0.14, -1.32, 3.9, -1.9)]), { noUV: true, maxEdge: 0.1 });
  // ---- roof markers: five amber on the visor and the side markers at the sleeper roof edge (the lamp the poster shows)
  const mk = []; for (let i = -2; i <= 2; i++) mk.push(bx(0.085, 0.05, 0.05, i * 0.24, 3.46, 0.9));
  mk.push(new THREE.SphereGeometry(0.04, 10, 8).translate(1.33, 3.94, -1.9), new THREE.SphereGeometry(0.04, 10, 8).translate(-1.33, 3.94, -1.9), bx(0.05, 0.05, 0.09, 1.3, 3.5, 0.9), bx(0.05, 0.05, 0.09, -1.3, 3.5, 0.9));   // the poster's lamp: a small amber bulb on a stalk at the sleeper roof edge
  P('markers', 'lamp.amber', merge(mk), { noUV: true, maxEdge: 0.1 });
  // ---- West Coast mirrors on two arms (left +X and right -X): tube frame, black glass, two arms to the A-pillar, a convex spot mirror
  const mirrors = { arm: [], glass: [], spot: [] };
  for (const s of [1, -1]) {
    const x0 = s * 1.2, xa = s * 1.58, xm = s * 1.72;
    mirrors.arm.push(tubeAlong([[x0, 2.72, 0.58], [x0 + s * 0.15, 2.74, 0.5], [xa, 2.76, 0.46], [xm, 2.78, 0.44]], 0.018), tubeAlong([[x0, 1.98, 0.62], [x0 + s * 0.2, 1.97, 0.54], [xa, 1.94, 0.48], [xm, 1.92, 0.46]], 0.018));
    // rectangular tube frame (a rounded loop) around a 0.24 x 0.5 mirror
    const fw = 0.13, fh = 0.27, cx = xm + s * 0.02, cy = 2.36, cz = 0.44, pts = [];
    for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), e = 6; const px = fw * Math.sign(c) * Math.pow(Math.abs(c), 2 / e), py = fh * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / e); pts.push([cx, cy + py, cz + px * s * -1 * 1]); }
    mirrors.arm.push(tubeAlong(pts, 0.014, 48, 6));
    mirrors.glass.push(bx(0.03, 2 * fh - 0.04, 2 * fw - 0.04, cx + s * 0.005, cy, cz));
    mirrors.spot.push(bx(0.02, 0.13, 0.13, xm + s * 0.01, cy + fh + 0.11, cz));
  }
  P('mirror_arms', 'chrome', merge(mirrors.arm), { noUV: true, maxEdge: 0.2 }); P('mirror_glass', 'mirror', merge(mirrors.glass), { noUV: true, maxEdge: 0.2 }); P('mirror_spot', 'mirror', merge(mirrors.spot), { noUV: true, maxEdge: 0.2 });
  // ---- steps (two under each door) and the vertical grab handle
  const steps = [], grab = []; for (const s of [1, -1]) { steps.push(bx(0.12, 0.05, 0.5, s * 1.33, 0.62, 0.35), bx(0.12, 0.05, 0.5, s * 1.33, 0.98, 0.35), bx(0.06, 0.4, 0.05, s * 1.3, 0.8, 0.6)); grab.push(bx(0.03, 1.1, 0.03, s * 1.28, 2.15, 0.58)); }
  P('steps', 'chrome', merge(steps), { noUV: true, maxEdge: 0.2 }); P('grab_handles', 'chrome', merge(grab), { noUV: true, maxEdge: 0.3 });
  // ---- chassis: frame rails, crossmembers, chrome fuel tanks between the axles, air tanks, driveshaft, fifth wheel
  P('frame_rails', 'chassis', merge([bx(0.11, 0.3, 8.2, 0.42, 0.95, -3.3), bx(0.11, 0.3, 8.2, -0.42, 0.95, -3.3), bx(0.86, 0.12, 0.2, 0, 0.95, -1.0), bx(0.86, 0.12, 0.2, 0, 0.95, -3.0), bx(0.86, 0.12, 0.2, 0, 0.95, -5.6), bx(0.86, 0.12, 0.2, 0, 0.95, -7.0)]), { noUV: true, maxEdge: 0.6 });
  const tank = k => new THREE.CylinderGeometry(0.34, 0.34, 2.4, 20).rotateX(Math.PI / 2);
  P('fuel_tanks', 'chrome', merge([tank().translate(1.2, 0.72, -2.15), tank().translate(-1.2, 0.72, -2.15)]), { noUV: true, maxEdge: 0.3 });
  P('tank_straps', 'chassis', merge([0.5, 1.5, 2.55, 3.5].flatMap(d => [bx(0.02, 0.76, 0.12, 1.2, 0.72, -1.0 - d + 0.35), bx(0.02, 0.76, 0.12, -1.2, 0.72, -1.0 - d + 0.35)])), { noUV: true, maxEdge: 0.3 });
  P('fifth_wheel', 'chassis', merge([bx(1.15, 0.12, 1.1, 0, 1.28, -5.15), new THREE.CylinderGeometry(0.62, 0.62, 0.1, 24).translate(0, 1.36, -5.15), bx(1.1, 0.3, 0.9, 0, 1.15, -5.1)]), { noUV: true, maxEdge: 0.4 });
  P('driveshaft_diff', 'chassis', merge([new THREE.CylinderGeometry(0.06, 0.06, 2.9, 10).rotateX(Math.PI / 2).translate(0, 0.62, -2.0), new THREE.SphereGeometry(0.34, 16, 12).translate(0, 0.5, -5.2), new THREE.SphereGeometry(0.34, 16, 12).translate(0, 0.5, -6.5)]), { noUV: true, maxEdge: 0.3 });
  P('exhaust', 'chrome', merge([new THREE.CylinderGeometry(0.07, 0.07, 3.0, 12).translate(-1.15, 2.85, -3.3), new THREE.CylinderGeometry(0.1, 0.1, 0.3, 12).translate(-1.15, 4.4, -3.3)]), { noUV: true, maxEdge: 0.4 });
  // ---- wheels: steer axle singles at z = 0, tandem drive axles duals at z = -5.2 and -6.5. Tyre with tread ring, painted rim, hub
  const tyres = [], rims = [], hubs = [];
  const wheel = (x, z, w = 0.29) => {
    const t = new THREE.CylinderGeometry(0.53, 0.53, w, 32).rotateZ(Math.PI / 2).translate(x, 0.53, z);
    tyres.push(t); const side = Math.sign(x) || 1, out = x + side * (w / 2 + 0.005);
    rims.push(new THREE.CylinderGeometry(0.33, 0.33, 0.03, 24).rotateZ(Math.PI / 2).translate(out, 0.53, z), new THREE.CylinderGeometry(0.16, 0.16, 0.06, 20).rotateZ(Math.PI / 2).translate(out + side * 0.03, 0.53, z));
    hubs.push(new THREE.CylinderGeometry(0.075, 0.075, 0.1, 12).rotateZ(Math.PI / 2).translate(out + side * 0.06, 0.53, z));
  };
  for (const s of [1, -1]) { wheel(s * 1.0, 0, 0.32); for (const z of [-5.2, -6.5]) { wheel(s * 0.92, z); wheel(s * 1.28, z); } }
  P('tyres', 'rubber.tyre', merge(tyres), { noUV: true, maxEdge: 0.25 }); P('rims', 'chrome', merge(rims), { noUV: true, maxEdge: 0.25 }); P('hubs', 'chassis', merge(hubs), { noUV: true, maxEdge: 0.2 });
  // mud flaps and quarter fenders behind the drive axles
  P('fenders', 'cab.trim', merge([bx(0.5, 0.05, 1.4, 1.1, 1.18, -5.9), bx(0.5, 0.05, 1.4, -1.1, 1.18, -5.9), bx(0.05, 0.55, 0.45, 1.3, 0.3, -7.2), bx(0.05, 0.55, 0.45, -1.3, 0.3, -7.2)]), { noUV: true, maxEdge: 0.3 });
  // air lines to the trailer
  P('air_lines', 'cable', merge([tubeAlong([[0.25, 1.4, -4.6], [0.4, 1.7, -4.9], [0.3, 1.9, -5.4]], 0.02), tubeAlong([[-0.25, 1.4, -4.6], [-0.4, 1.7, -4.9], [-0.3, 1.9, -5.4]], 0.02)]), { noUV: true, maxEdge: 0.2 });
  return { parts, anchors: { mirror_left: [1.72, 2.36, 0.44], mirror_right: [-1.72, 2.36, 0.44], roof_marker_left: [1.31, 3.93, -1.9], headlamps: [[0.9, 1.95, 1.36], [-0.9, 1.95, 1.36]], markers: [[0, 3.47, 0.9]], fifth_wheel: [0, 1.4, -5.15], cab_side_uv: [CAB.z0, CAB.z1, CAB.y0, CAB.y1], door_center: [1.3, 2.2, 0.15], stack_top: [-1.15, 4.55, -3.3] } };
}
