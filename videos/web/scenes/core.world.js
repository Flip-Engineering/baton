// THE CORE (TRUE SCALE ep. 1): the worlds. Every dimension is real (metres). Two places:
//   THE HALL   one transformer works seen from straight above: sealed warm-grey concrete, safety-yellow walkway lines, the flat core on
//              its stacking table (A), a second table under a gantry stacker (B), the active part standing on its base with platform
//              gratings either side (C), a winding machine (D), a finished tank (E), and the overhead cranes' bridges parked at the
//              hall's ends. LED high-bays (5000 K) and one low work light raking the object's edges.
//   OUTSIDE    drone nadirs (plan as well): transformer pads in their basins of crushed stone, a solar farm's collector pad, a switchyard
//              by a turbine hall's roof, a town substation by a street, an empty basin; two construction sites (a plant extension under
//              a crawler crane's boom, a foundation pour). Overcast noon. Procedural, seeded; built, shot once, disposed.
// No brand anywhere; no data halls; nothing red (the only red in the piece is the ACP mark).
import * as THREE from 'three';
import { steelMaterial, concreteMaterial, boxGeometry, mergeBoxes, litPatch, litPatchAll } from '../lib/fx/light/index.js';
import { CoreStack, pressboardMaterial, copperMaterial, goSteelMaterial, mulberry } from '../lib/fx/truescale/corestack.js';
import { ST, DECK, HALF } from './core.plan.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mesh = (g, m, o = {}) => { const me = new THREE.Mesh(g, m); me.castShadow = o.cast ?? true; me.receiveShadow = true; if (o.name) me.name = o.name; return me; };
const std = (color, rough = 0.6, metal = 0) => litPatch(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
export const MAT = {};
function mats() {
  if (MAT.floor) return MAT;
  Object.assign(MAT, {
    floor: concreteMaterial({ base: 0x8b867e, joint: 6, cracks: 0.25, oil: 0.22, dirt: 0.18, aggregate: 0.5, rough: 0.5 }),
    deck: steelMaterial({ top: 0x55595b, primer: 0x55595b, bare: 0x8c8f92, chip: 0.015, wear: 0.45, rust: 0.08, grime: 0.25, dust: 0.1, rough: 0.48, age: 0.4, box: true }),
    frame: steelMaterial({ top: 0x6f716e, primer: 0x6f716e, chip: 0.02, wear: 0.5, rust: 0.2, grime: 0.3, dust: 0.25, rough: 0.6, age: 0.4, box: true }),
    machine: steelMaterial({ top: 0xc3c5c1, primer: 0x8d908c, chip: 0.012, wear: 0.3, rust: 0.05, grime: 0.25, dust: 0.1, rough: 0.42, age: 0.3, box: true }),
    crane: steelMaterial({ top: 0xd0a019, primer: 0x6f716e, chip: 0.03, wear: 0.55, rust: 0.2, grime: 0.35, dust: 0.3, rough: 0.45, age: 0.5, box: true }),
    tank: steelMaterial({ top: 0x7d858a, primer: 0x7d858a, chip: 0.012, wear: 0.2, rust: 0.04, grime: 0.15, dust: 0.15, rough: 0.4, age: 0.2, box: true }),
    rail: steelMaterial({ top: 0x2b2d30, primer: 0x2b2d30, coverage: 0, wear: 0.4, rust: 0.4, grime: 0.4, rough: 0.5, box: true }),
    yellow: std('#dcae1e', 0.55), black: std('#1c1c1c', 0.6), rubber: std('#1e1e1e', 0.85), alu: std('#b9bcbe', 0.35, 0.8),
    grating: gratingMaterial(), pressboard: pressboardMaterial(), copper: copperMaterial(), coil: std('#7a5a3a', 0.6), insulator: std('#8e9396', 0.35),
    steelX: goSteelMaterial({ roll: 'x' }), steelZ: goSteelMaterial({ roll: 'z' }), duct: pressboardMaterial({ tone: -0.08 }),
    gravel: concreteMaterial({ base: 0x8e8c87, joint: 4000, cracks: 0, oil: 0.05, dirt: 0.25, aggregate: 1, rough: 0.95 }),
    pad: concreteMaterial({ base: 0x9a968e, joint: 3, cracks: 0.35, oil: 0.25, dirt: 0.3, aggregate: 0.7, rough: 0.8 }),
    asphalt: concreteMaterial({ base: 0x3d3c3a, joint: 4000, cracks: 0.5, oil: 0.4, dirt: 0.2, aggregate: 1, rough: 0.9 }),
    grass: std('#6c7458', 0.95), soil: std('#6e6253', 0.95), wet: concreteMaterial({ base: 0x6e6c68, joint: 4000, cracks: 0, oil: 0, dirt: 0.05, aggregate: 0.2, rough: 0.18, wet: 0.8 }),
    rebar: steelMaterial({ top: 0x5a3f30, primer: 0x5a3f30, coverage: 0, bare: 0x6a4a36, rust: 0.9, wear: 0.2, rough: 0.7, box: true }),
    roof: steelMaterial({ top: 0x9da3a6, primer: 0x9da3a6, chip: 0.01, wear: 0.2, rust: 0.15, grime: 0.3, dust: 0.3, rough: 0.45, age: 0.5, box: true }),
    panel: std('#2a3038', 0.25, 0.3), panelFrame: std('#b8bbbd', 0.4, 0.7), white: std('#d9d9d4', 0.55), fence: std('#8f9497', 0.5, 0.6),
  });
  return MAT;
}
function gratingMaterial() {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null; let tex = null;
  if (c) { c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#20211f'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#7b7e7d'; for (let i = 0; i < 64; i += 8) { g.fillRect(i, 0, 2, 64); } for (let j = 0; j < 64; j += 32) g.fillRect(0, j, 64, 2);
    tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 1); tex.anisotropy = 8; tex.colorSpace = THREE.SRGBColorSpace; }
  const m = new THREE.MeshStandardMaterial({ color: tex ? '#ffffff' : '#555757', map: tex, roughness: 0.55, metalness: 0.6 });
  return litPatch(m);
}
const B = (w, h, d, x, y, z, rot) => boxGeometry(w, h, d, x, y, z, rot);
const merged = (list, m, name) => mesh(mergeBoxes(list), m, { name });

// ================================================================ THE HALL
export function buildHall(scene) {
  const M = mats(), H = { groups: {} };
  const floor = mesh(new THREE.PlaneGeometry(240, 240).rotateX(-Math.PI / 2), M.floor, { cast: false, name: 'floor' }); scene.add(floor);
  // walkway lines: 100 mm, safety yellow; the aisles between the stations, and the line across frame 0's top
  const L = [], line = (x0, z0, x1, z1) => { const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(z1 - z0, x1 - x0); L.push(B(len, 0.002, 0.1, (x0 + x1) / 2, 0.001, (z0 + z1) / 2, [0, -a, 0])); };
  const [ax, az] = ST.A, [bx, bz] = ST.B, [cx, cz] = ST.C, [dx, dz] = ST.D, [ex, ez] = ST.E;
  line(-24, az - 3.5, 24, az - 3.5);                                  // frame 0's walkway line (y ~ 150 px)
  for (const x of [-4.6, -3.0, 3.0, 4.6]) line(x, -32, x, 32);        // the long aisle down the middle of the hall, both edges
  for (const z of [-7.6, -6.0, 6.4, 8.0]) line(-24, z, 24, z);        // the cross aisle
  for (const [sx, sz, w, d] of [[ax, az, 8.6, 7.2], [bx, bz, 10.4, 9.6], [cx, cz, 9.0, 7.0], [dx, dz, 8.2, 5.0], [ex, ez, 10.0, 7.0]]) {   // station boxes
    line(sx - w / 2, sz - d / 2, sx + w / 2, sz - d / 2); line(sx - w / 2, sz + d / 2, sx + w / 2, sz + d / 2); line(sx - w / 2, sz - d / 2, sx - w / 2, sz + d / 2); line(sx + w / 2, sz - d / 2, sx + w / 2, sz + d / 2); }
  scene.add(mesh(mergeBoxes(L), M.yellow, { cast: false, name: 'lines' }));

  // ---------------------------------------------------------------- A: the flat core on its stacking table
  const core = H.core = new CoreStack({ deck: DECK });
  const A = H.groups.A = new THREE.Group(); A.position.set(ax, 0, az); A.name = 'stationA'; scene.add(A);
  A.add(stackingTable(core, M));
  H.coreMats = { x: M.steelX, z: M.steelZ, duct: M.duct };
  H.coreA = { upto: -1, mesh: null };
  H.setCoreA = (upto, detail = 14) => { upto = Math.round(upto); if (H.coreA.upto === upto) return; if (H.coreA.mesh) { A.remove(H.coreA.mesh); H.coreA.mesh.traverse(m => m.geometry?.dispose()); }
    H.coreA.mesh = core.mesh(upto, { detail, mats: H.coreMats }); A.add(H.coreA.mesh); H.coreA.upto = upto; };
  H.setCoreA(HALF);
  // the tape measure: a 5 m blade lying open along the table's edge (y ~ 470 px at frame 0), its case at the end
  A.add(tapeMeasure(M, -2.62, DECK + 0.001, -core.Zy - core.o.D / 2 - 0.1));
  // the sheet the eight lay (built when needed)
  H.sheetA = null;
  // ---------------------------------------------------------------- B: the gantry stacker over the second table
  const core2 = H.core2 = new CoreStack({ deck: DECK });
  const Bg = H.groups.B = new THREE.Group(); Bg.position.set(bx, 0, bz); Bg.name = 'stationB'; scene.add(Bg);
  Bg.add(stackingTable(core2, M));
  H.core2Mesh = core2.mesh(724, { detail: 14, mats: H.coreMats }); Bg.add(H.core2Mesh);
  H.gantry = gantry(M, core2); Bg.add(H.gantry.group);
  const fs = feedStacks(M, core2); Bg.add(fs); H.feed = fs.userData.feed;
  // ---------------------------------------------------------------- C: the active part standing; platform gratings both sides
  const Cg = H.groups.C = new THREE.Group(); Cg.position.set(cx, 0, cz); Cg.name = 'stationC'; scene.add(Cg);
  const ap = H.active = core.upright({ done: 0, base: 0.3, mats: H.coreMats }); Cg.add(ap);
  Cg.add(activeBase(M, core)); Cg.add(platforms(M, core));
  H.yoke = { done: -1, mesh: null, handful: null };
  H.setYoke = (done) => { const n = Math.round(core.N * done); if (H.yoke.n === n) return; const holder = ap.userData.core;
    if (H.yoke.mesh) { holder.remove(H.yoke.mesh); H.yoke.mesh.traverse(m => m.geometry?.dispose()); }
    H.yoke.mesh = core.mesh(n, { detail: 0, parts: ['yokeT'], mats: H.coreMats }); holder.add(H.yoke.mesh); H.yoke.n = n; };
  H.setHandful = (b0, b1, lift, dz = 0) => { const holder = ap.userData.core, key = `${b0}:${b1}`;
    if (H.yoke.hkey !== key) { if (H.yoke.handful) { holder.remove(H.yoke.handful); H.yoke.handful.traverse(m => m.geometry?.dispose()); }
      H.yoke.handful = b1 > b0 ? core.mesh(b1, { from: b0, detail: 0, parts: ['yokeT'], mats: H.coreMats }) : null; if (H.yoke.handful) { H.yoke.handful.matrixAutoUpdate = true; holder.add(H.yoke.handful); } H.yoke.hkey = key; }
    // the handful is built in the flat core's frame: its lift (world up) is -z there (the upright frame turns flat -z into +y)
    if (H.yoke.handful) H.yoke.handful.position.set(0, dz, -lift);   // (flat +y is world +z: the carry across from the crew's side)
  };
  // ---------------------------------------------------------------- D: the winding machine; E: a finished tank; the cranes' bridges
  const Dg = H.groups.D = windingMachine(M); Dg.position.set(dx, 0, dz); scene.add(Dg);
  const Eg = H.groups.E = finishedTank(M); Eg.position.set(ex, 0, ez); scene.add(Eg);
  for (const z of [-31, 31]) scene.add(craneBridge(M, z));
  // c20: the floor between the stations is a works, not a car park: the slit coils waiting by the gantry table, wound coils ready for the
  // next active part, pressboard on its pallets, the kit carts (what the pull-out shows as the plan made visible)
  scene.add(hallStock(M));
  return H;
}

function hallStock(M) {
  const g = new THREE.Group(); g.name = 'stock';
  const coilM = goSteelMaterial({ roll: 'x' }), wood = std('#9a7b55', 0.8), cart = std('#3d5a75', 0.5, 0.3);
  for (let i = 0; i < 6; i++) { const x = 15.2 + (i % 2) * 1.6, z = -9.5 + Math.floor(i / 2) * 2.2, w = [1.075, 0.92, 0.775][i % 3];   // slit coils on cradles
    const c = mesh(new THREE.CylinderGeometry(0.62, 0.62, w, 48).rotateZ(Math.PI / 2), coilM); c.position.set(x, 0.72, z); g.add(c);
    const eye = mesh(new THREE.CylinderGeometry(0.255, 0.255, w + 0.01, 24).rotateZ(Math.PI / 2), std('#2a2a28', 0.8)); eye.position.copy(c.position); g.add(eye);
    g.add(mesh(boxGeometry(w + 0.2, 0.12, 1.2, x, 0.06, z), wood)); }
  const board = pressboardMaterial();
  for (let i = 0; i < 3; i++) { const x = -16.5 + i * 2.6, z = 3.2; const w = new THREE.Group();                                // wound coils, ready
    w.add(mesh(new THREE.CylinderGeometry(1.15, 1.15, 2.2, 64), board)); const top = mesh(new THREE.RingGeometry(0.57, 1.15, 64).rotateX(-Math.PI / 2), pressboardMaterial({ tone: 0.1 })); top.position.y = 1.101; w.add(top);
    w.position.set(x, 1.1 + 0.12, z); g.add(w); g.add(mesh(boxGeometry(2.5, 0.12, 2.5, x, 0.06, z), wood)); }
  for (let i = 0; i < 3; i++) g.add(mesh(boxGeometry(2.0, 0.08 + 0.05 * i, 4.0, 5.5 + i * 2.4, 0.2 + 0.025 * i, 5.5), board));          // pressboard sheets on pallets
  for (let i = 0; i < 3; i++) g.add(mesh(boxGeometry(2.1, 0.12, 4.1, 5.5 + i * 2.4, 0.06, 5.5), wood));
  for (const [x, z] of [[-4.0, -11.5], [4.2, -12.5], [-6.2, 6.0]]) { g.add(mesh(boxGeometry(0.8, 0.9, 1.4, x, 0.45, z), cart)); g.add(mesh(boxGeometry(0.75, 0.04, 1.35, x, 0.92, z), std('#8a8d8f', 0.4, 0.7))); }
  return g;
}
// the stacking table: a steel deck under the core's outline (plus 0.15 m), the windows open to the floor, on box-section legs
function stackingTable(core, M) {
  const g = new THREE.Group(), P = core.P, Zy = core.Zy, h = core.o.D / 2 + 0.15, top = DECK, th = 0.04, list = [], legs = [];
  const plate = (x0, x1, z0, z1) => list.push(B(x1 - x0, th, z1 - z0, (x0 + x1) / 2, top - th / 2, (z0 + z1) / 2));
  plate(-P - h, P + h, -Zy - h, -Zy + h); plate(-P - h, P + h, Zy - h, Zy + h);                         // under the yokes
  for (const x of [-P, 0, P]) plate(x - h, x + h, -Zy + h, Zy - h);                                     // under the limbs
  g.add(merged(list, M.deck, 'deck'));
  for (const x of [-P, 0, P]) for (const z of [-Zy, 0, Zy]) legs.push(B(0.2, top - th, 0.2, x, (top - th) / 2, z));
  for (const z of [-Zy, Zy]) legs.push(B(2 * P + 0.4, 0.2, 0.25, 0, top - th - 0.1, z));
  g.add(merged(legs, M.frame, 'legs'));
  return g;
}
// a 5 m tape: the yellow blade (25 mm) with its graduations, lying open; the case at its end
function tapeMeasure(M, x0, y, z) {
  const g = new THREE.Group(), len = 5.0;
  let tex = null;
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = 4096; c.height = 32; const q = c.getContext('2d'); q.fillStyle = '#e5c21a'; q.fillRect(0, 0, 4096, 32);
    q.fillStyle = '#141414'; for (let mm = 0; mm <= 5000; mm += 10) { const x = mm / 5000 * 4096, big = mm % 100 === 0, mid = mm % 50 === 0; q.fillRect(x, 0, mm % 1000 === 0 ? 3 : 1.2, big ? 16 : mid ? 11 : 7); if (big) { q.font = '12px sans-serif'; q.fillText(String((mm / 10) % 100), x + 2, 29); } }
    tex = new THREE.CanvasTexture(c); tex.anisotropy = 8; tex.colorSpace = THREE.SRGBColorSpace; }
  const blade = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.025).rotateX(-Math.PI / 2), litPatch(new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex, roughness: 0.45, metalness: 0.2 })));
  blade.position.set(x0 + len / 2, y, z); blade.receiveShadow = true; g.add(blade);
  const kase = mesh(boxGeometry(0.075, 0.035, 0.075, x0 + len + 0.04, y + 0.0175, z), M.yellow); g.add(kase);
  g.add(mesh(boxGeometry(0.03, 0.036, 0.077, x0 + len + 0.075, y + 0.018, z), M.black));
  return g;
}
// the gantry stacker: two rails on posts either side of the table, a bridge across, a carriage, a vacuum gripper bar (eight cups)
function gantry(M, core) {
  const g = new THREE.Group(), xr = core.P + core.o.D / 2 + 1.2, z0 = -core.Zy - 1.4, z1 = core.Zy + 4.2, yr = 2.4, posts = [];
  for (const x of [-xr, xr]) { posts.push(B(0.3, 0.28, z1 - z0, x, yr, (z0 + z1) / 2)); for (let z = z0; z <= z1 + 1e-6; z += (z1 - z0) / 4) posts.push(B(0.25, yr - 0.14, 0.25, x, (yr - 0.14) / 2, z)); }
  g.add(merged(posts, M.machine, 'rails'));
  const bridge = new THREE.Group(); bridge.add(merged([B(2 * xr + 0.6, 0.55, 0.62, 0, yr + 0.42, 0), B(0.5, 0.4, 0.8, -xr, yr + 0.28, 0), B(0.5, 0.4, 0.8, xr, yr + 0.28, 0)], M.machine, 'bridge'));
  const carriage = new THREE.Group(); carriage.add(merged([B(0.9, 0.55, 0.95, 0, yr + 0.95, 0)], M.machine, 'carriage'));
  const mast = mesh(boxGeometry(0.18, 1, 0.18, 0, 0, 0), M.alu); carriage.add(mast);
  const bar = new THREE.Group(); bar.add(merged([B(0.14, 0.12, 3.0, 0, 0.06, 0)], M.machine, 'gripper'));
  const cups = []; for (let i = 0; i < 8; i++) cups.push(B(0.1, 0.03, 0.1, 0, -0.015, -1.35 + i * 2.7 / 7)); bar.add(merged(cups, M.rubber, 'cups'));
  carriage.add(bar); bridge.add(carriage); g.add(bridge);
  return { group: g, bridge, carriage, mast, bar, xr, yr,
    // place the bridge at z, the carriage at x, the gripper's underside at height y (world, station frame)
    set(x, z, y) { bridge.position.z = z; carriage.position.x = x; bar.position.y = y; const top = yr + 0.7, len = Math.max(0.05, top - (y + 0.12)); mast.scale.y = len; mast.position.y = y + 0.12 + len / 2; } };
}
function feedStacks(M, core) {
  // cut-to-length stacks of limb sheets on a waist-high rack at the table's end, one stack a packet width
  const g = new THREE.Group(), z = core.Zy + core.o.D / 2 + 1.25, top = 0.72, list = [], rack = [B(6.0, 0.06, 2.8, 0, top - 0.03, z)];
  for (const x of [-2.9, 2.9]) for (const dz of [-1.3, 1.3]) rack.push(B(0.08, top - 0.06, 0.08, x, (top - 0.06) / 2, z + dz));
  g.add(merged(rack, M.frame, 'rack'));
  const stacks = [[-2.1, 1.035, 0.10], [-0.75, 0.92, 0.07], [0.55, 0.775, 0.05], [1.8, 0.59, 0.035]];
  for (const [x, w, hh] of stacks) list.push(B(w, hh, 2.45, x, top + hh / 2, z));
  g.add(mesh(mergeBoxes(list), MAT.steelZ, { name: 'feed' }));
  g.userData.feed = { x: 0.55, z, y: top + 0.05 };
  return g;
}
// the active part's base frame (under the bottom yoke) and the platforms
function activeBase(M, core) {
  const L = core.L, list = [B(L + 0.4, 0.3, 0.5, 0, 0.15, -0.6), B(L + 0.4, 0.3, 0.5, 0, 0.15, 0.6)];
  for (const x of [-core.P, 0, core.P]) list.push(B(0.4, 0.3, 1.7, x, 0.15, 0));
  return merged(list, M.frame, 'base');
}
function platforms(M, core) {
  const g = new THREE.Group(), y = 3.87, x0 = -core.L / 2 - 0.6, x1 = core.L / 2 + 0.6, gr = [], fr = [];
  for (const [za, zb] of [[1.2, 2.6], [-2.6, -1.2]]) {
    const pl = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.04, zb - za), M.grating); pl.position.set((x0 + x1) / 2, y - 0.02, (za + zb) / 2);
    pl.material.map && (pl.material.map.repeat.set((x1 - x0) / 0.24, (zb - za) / 0.24)); pl.receiveShadow = pl.castShadow = true; g.add(pl);
    const zr = za > 0 ? zb - 0.05 : za + 0.05;
    for (let x = x0; x <= x1 + 1e-6; x += (x1 - x0) / 6) { fr.push(B(0.05, 1.07, 0.05, x, y + 0.535, zr)); fr.push(B(0.12, y - 0.04, 0.12, x, (y - 0.04) / 2, (za + zb) / 2)); }
    fr.push(B(x1 - x0, 0.05, 0.05, (x0 + x1) / 2, y + 1.07, zr), B(x1 - x0, 0.05, 0.05, (x0 + x1) / 2, y + 0.55, zr), B(x1 - x0, 0.12, 0.08, (x0 + x1) / 2, y - 0.1, za + (za > 0 ? 0.03 : -0.03)));
  }
  g.add(merged(fr, M.crane, 'rails')); g.userData.y = y;
  // the lacing boards: planks laid across the windings' tops on the open (+z) side, clear of the spacer blocks, under the crew's feet
  const wood = std('#9a7b55', 0.8), pl = [];
  for (const zc of [0.72, 1.02]) pl.push(B(core.L + 0.8, 0.04, 0.29, 0, y - 0.02, zc));
  for (const x of [-core.P, 0, core.P]) pl.push(B(0.1, 0.05, 0.62, x - 0.5, y - 0.065, 0.87), B(0.1, 0.05, 0.62, x + 0.5, y - 0.065, 0.87));
  g.add(merged(pl, wood, 'boards'));
  return g;
}
// a horizontal winding machine with a coil half wound, its conductor drum
function windingMachine(M) {
  const g = new THREE.Group(); g.name = 'stationD';
  g.add(merged([B(6.2, 0.4, 1.6, 0, 0.2, 0), B(1.0, 1.6, 1.3, -2.6, 1.2, 0), B(0.8, 1.5, 1.1, 2.7, 1.15, 0)], M.machine, 'bed'));
  const coil = mesh(new THREE.CylinderGeometry(0.95, 0.95, 2.2, 64).rotateZ(Math.PI / 2), M.coil); coil.position.set(0, 1.45, 0); g.add(coil);
  const ends = mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.06, 64).rotateZ(Math.PI / 2), M.pressboard); ends.position.set(-1.13, 1.45, 0); g.add(ends);
  const ends2 = ends.clone(); ends2.position.x = 1.13; g.add(ends2);
  const shaft = mesh(new THREE.CylinderGeometry(0.12, 0.12, 5.2, 24).rotateZ(Math.PI / 2), M.alu); shaft.position.set(0, 1.45, 0); g.add(shaft);
  const drum = mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.0, 48).rotateZ(Math.PI / 2), M.copper); drum.position.set(-0.4, 0.8, 3.1); g.add(drum);
  g.add(merged([B(1.4, 0.9, 0.2, -0.4, 0.45, 2.55), B(1.4, 0.9, 0.2, -0.4, 0.45, 3.65)], M.frame, 'drumstand'));
  const strand = mesh(boxGeometry(0.012, 0.012, 2.3, -0.4, 1.35, 1.95, [0.25, 0, 0]), M.copper); g.add(strand);
  return g;
}
// a finished tank: radiators along both sides, a conservator, bushings on the cover
function finishedTank(M) {
  const g = new THREE.Group(); g.name = 'stationE'; const list = [B(6.6, 3.7, 2.7, 0, 1.85, 0), B(6.8, 0.12, 2.9, 0, 3.76, 0)];
  for (const s of [-1, 1]) for (let i = 0; i < 18; i++) list.push(B(0.03, 2.9, 0.9, -2.9 + i * 0.34, 1.75, s * (1.35 + 0.55)));
  g.add(merged(list, M.tank, 'tank'));
  const cons = mesh(new THREE.CylinderGeometry(0.4, 0.4, 3.2, 32).rotateZ(Math.PI / 2), M.tank); cons.position.set(-1.2, 4.6, -1.0); g.add(cons);
  for (let i = 0; i < 3; i++) { const b = mesh(new THREE.CylinderGeometry(0.11, 0.17, 2.6, 16), M.insulator); b.position.set(-1.6 + i * 1.6, 5.0, 0.5); g.add(b); }
  for (let i = 0; i < 3; i++) { const b = mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.1, 16), M.insulator); b.position.set(-1.2 + i * 1.2, 4.3, -0.6); g.add(b); }
  return g;
}
function craneBridge(M, z) {
  const g = new THREE.Group(); g.name = 'crane';
  g.add(merged([B(48, 1.6, 0.7, 0, 11.6, z - 1.3), B(48, 1.6, 0.7, 0, 11.6, z + 1.3), B(1.2, 1.0, 4.2, -23.4, 11.9, z), B(1.2, 1.0, 4.2, 23.4, 11.9, z), B(2.6, 1.4, 3.0, 6.0, 12.6, z)], M.crane, 'bridge'));
  return g;
}

// ================================================================ THE LIGHT (records for light/'s LightRig)
// The hall: LED high-bays at 5000 K, 24,000 lm, half-angle 1.0 rad, on a 12 m grid at 11 m (no fixtures drawn: the view looks down
// past them), the floor bounce on; a skylight's soft overcast as the even base; one low work light raking the object's edges (the
// contact-shadow key, moved per station). EV 7.4 at WB 5000 K.
export function hallRecord(PRESETS) {
  const bays = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) bays.push({ kind: 'flood', name: `bay${i}_${j}`, color: 5000, lumens: 24000, half: 1.0, pen: 0.85,
    pos: [-18 + 12 * i, 11, -18 + 12 * j], aim: [-18 + 12 * i, 0, -18 + 12 * j], head: 'none', shadow: (i === 0 && j === 0) || (i === 2 && j === 1), shadowSize: 2048, near: 2, far: 30,
    volume: false, bounce: true });
  const rake = { kind: 'work', name: 'rake', color: 5000, lumens: 9000, pos: [0, 1.5, 0], aim: [0, 1.35, 3], half: 0.75, shadow: true, contact: true, shadowSize: 2048, near: 0.2, far: 14, volume: false, bounce: false };
  return PRESETS.overcastNoon({ camera: { ev100: 7.4, wb: 5000 }, sky: { kind: 'overcast', illuminance: 260, kelvin: 5200, elevation: 70, azimuth: 160, groundAlbedo: 0.3, backgroundGain: 0.0 },
    atmosphere: { density: 0, height: 4, maxDist: 200 }, practicals: [rake, ...bays], bounce: { albedo: 0.3, n5: false },
    lens: { bloom: 0.012, halation: 0.05, vignette: 0, grain: 0 } });               // the grain and vignette are kit's Finish, over the cards too
}
// outdoors: high overcast noon (light/presets overcastNoon): shadowless except where things meet
export function outRecord(PRESETS) {
  return PRESETS.overcastNoon({ atmosphere: { density: 0.00004, height: 60, maxDist: 2000 }, lens: { bloom: 0.012, halation: 0.05, vignette: 0, grain: 0 } });
}

// ================================================================ OUTSIDE: the pads, the basin, the sites (a drone's nadir)
// c20: WASTE AND WAITING. v1 framed every pad at 18 m, inside the gravel, so every tile was the same pale square. Now each tile is framed
// 22-46 m wide (its own w, set in the plan) so the yard, its fence and what is round it are seen, and each is its own place: the ground
// (green, dry, straw, red clay, sand, snow), the stone (grey, basalt, limestone), the season. Every one says a transformer belongs here
// and is not here: the empty basin with its anchor bolts and embedded rails, rust run from the bolts, rain standing in the pit and weeds
// in the stone (years of it), the HV cable tails coiled and capped on the pad, conduit stubs capped, bus supports with their insulators
// ending in air, the take-off's conductors hanging to nothing; and what was delivered instead waits: cable drums, pallets, a container,
// a site trailer. kind: 'substation' | 'collector' | 'switchyard' | 'town' | 'datahall' | 'stone'.
const _tm = new Map();
const tileStd = (c, rough = 0.9, metal = 0) => { const k = c + rough + metal; if (!_tm.has(k)) _tm.set(k, std(c, rough, metal)); return _tm.get(k); };
const tileConc = (base, o = {}) => { const k = 'c' + base + JSON.stringify(o); if (!_tm.has(k)) _tm.set(k, concreteMaterial({ base, joint: 4000, cracks: 0, oil: 0.05, dirt: 0.25, aggregate: 1, rough: 0.95, ...o })); return _tm.get(k); };
const GROUNDS = { green: ['#5f6d48', '#68764f'], dry: ['#8a8457', '#958e60'], straw: ['#a3925f', '#ad9c68'], clay: ['#7d5a40', '#866348'], sand: ['#a8936f', '#b19c78'], snow: ['#dde1e4', '#e6e9eb'] };
const STONES = { grey: 0x8e8c87, basalt: 0x5f5e5b, lime: 0xb0a690, warm: 0x9c9284 };
export function buildTile(kind, seed) {
  const M = mats(), r = mulberry(seed * 977 + 13), g = new THREE.Group(); g.name = 'tile:' + kind;
  const pick = a => a[Math.floor(r() * a.length)];
  const plane = (m, w, d, x = 0, y = 0, z = 0, ry = 0) => { const p = mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), m, { cast: false }); p.position.set(x, y, z); p.rotation.y = ry; return p; };
  // the place
  const snowy = (kind === 'town' || kind === 'substation') && r() < 0.28;
  const gk = snowy ? 'snow' : kind === 'collector' ? pick(['clay', 'sand', 'dry']) : kind === 'town' ? pick(['green', 'dry']) : kind === 'switchyard' ? pick(['dry', 'green', 'straw']) : pick(['green', 'dry', 'straw', 'clay']);
  const [g0, g1] = GROUNDS[gk], stoneBase = snowy ? 0xc9ccce : STONES[pick(Object.keys(STONES))];
  g.add(plane(tileStd(g0, 0.95), 160, 200));
  if (gk !== 'snow' && gk !== 'sand') for (let i = -80; i < 80; i += 6) g.add(plane(tileStd(g1, 0.95), 3, 200, i + 1.5, 0.004));   // mowing (or tillage) stripes
  const jx = (r() - 0.5) * 3, jz = (r() - 0.5) * 4, rot = (r() - 0.5) * 0.14;
  const gravel = tileConc(stoneBase, snowy ? { dirt: 0.05 } : {}), pitStone = tileConc(stoneBase - 0x0b0b0b > 0 ? stoneBase - 0x0b0b0b : stoneBase, { dirt: 0.4, oil: 0.1 });
  const padM = tileConc(0x9a968e + Math.floor(r() * 3) * 0x050505, { joint: 3, cracks: 0.45, oil: 0.08, dirt: 0.35, aggregate: 0.7, rough: 0.8 });
  const rust = tileStd('#7a4a2c', 0.85), weed = tileStd(gk === 'snow' ? '#b9bdb5' : '#4e5e36', 0.95), black = tileStd('#141414', 0.55), capC = tileStd('#d39a1c', 0.5);
  if (kind === 'stone') {                                              // a hole: a whole frame of stone, a curb, weeds, nothing on it
    g.add(plane(gravel, 160, 200, 0, 0.006)); const curb = [], w = 26 + r() * 10, d = 36 + r() * 8;
    for (const s of [-1, 1]) curb.push(B(w, 0.3, 0.3, 0, 0.15, s * d / 2), B(0.3, 0.3, d, s * w / 2, 0.15, 0));
    const cg = new THREE.Group(); cg.add(merged(curb, M.pad, 'curb')); cg.rotation.y = rot; cg.position.set(jx * 2, 0, jz * 2); g.add(cg);
    const wd = []; for (let i = 0; i < 260; i++) { const x = (r() - 0.5) * 60, z = (r() - 0.5) * 90, sz = 0.15 + r() * 0.5; wd.push(B(sz, 0.05, sz, x, 0.03, z, [0, r() * 3, 0])); } g.add(merged(wd, weed, 'weeds'));
    const pud = []; for (let i = 0; i < 3; i++) pud.push(B(2 + r() * 5, 0.004, 1 + r() * 3, (r() - 0.5) * 20, 0.012, (r() - 0.5) * 30, [0, r(), 0])); g.add(merged(pud, M.wet, 'puddles'));
    litPatchAll(g); return g;
  }
  const yard = new THREE.Group(); yard.rotation.y = rot; yard.position.set(jx, 0, jz); g.add(yard);
  const yw = 22 + r() * 8, yd = 32 + r() * 10;
  yard.add(plane(gravel, yw, yd, 0, 0.01));
  // the basin: a curb round a pit of darker stone, the pad in it with its anchor bolts and two embedded rails; rain in the pit, weeds
  const bw = 10 + r() * 2, bd = 13 + r() * 2, pw = 4.6 + r() * 0.8, pd = 7.0 + r() * 1.2, curb = [], pad = [], steel = [], bolts = [], stains = [];
  for (const s of [-1, 1]) curb.push(B(bw, 0.35, 0.3, 0, 0.17, s * bd / 2), B(0.3, 0.35, bd, s * bw / 2, 0.17, 0));
  yard.add(plane(pitStone, bw - 0.3, bd - 0.3, 0, 0.02));
  pad.push(B(pw, 0.45, pd, 0, 0.22, 0));
  for (const s of [-1, 1]) steel.push(B(0.12, 0.02, pd - 0.4, s * pw * 0.28, 0.455, 0));
  for (let i = 0; i < 8; i++) { const x = (i % 2 ? 1 : -1) * (pw / 2 - 0.35), z = -pd / 2 + 0.6 + Math.floor(i / 2) * (pd - 1.2) / 3; bolts.push(B(0.05, 0.12, 0.05, x, 0.51, z));
    stains.push(B(0.12 + r() * 0.1, 0.002, 0.5 + r() * 0.9, x, 0.452, z + 0.35, [0, (r() - 0.5) * 0.3, 0])); }
  yard.add(merged(curb, M.pad, 'curb')); yard.add(merged(pad, padM, 'pad')); yard.add(merged(steel, M.rail, 'rails')); yard.add(merged(bolts, M.rail, 'bolts')); yard.add(merged(stains, rust, 'rust'));
  if (!snowy) { const pud = []; for (let i = 0; i < 2 + Math.floor(r() * 3); i++) { const x = (r() - 0.5) * (bw - 2), z = (r() < 0.5 ? -1 : 1) * (pd / 2 + 0.6 + r() * (bd / 2 - pd / 2 - 1.2)); pud.push(B(1 + r() * 3, 0.004, 0.6 + r() * 1.4, x, 0.03, z, [0, r(), 0])); } yard.add(merged(pud, M.wet, 'rain')); }
  { const wd = []; for (let i = 0; i < 140; i++) { const x = (r() - 0.5) * (bw - 0.6), z = (r() - 0.5) * (bd - 0.6); if (Math.abs(x) < pw / 2 + 0.1 && Math.abs(z) < pd / 2 + 0.1) continue; const sz = 0.12 + r() * 0.4; wd.push(B(sz, 0.06, sz, x, 0.05, z, [0, r() * 3, 0])); } yard.add(merged(wd, weed, 'weeds')); }
  // the HV cable tails: up out of the ground at the pad's end, coiled, their ends capped; conduit stubs capped
  const tails = new THREE.Group();
  for (let i = 0; i < 3; i++) { const tor = new THREE.Mesh(new THREE.TorusGeometry(0.55 + 0.08 * r(), 0.055, 8, 40).rotateX(Math.PI / 2), black); tor.position.set(-pw / 2 + 0.9 + i * (pw - 1.8) / 2, 0.5, -pd / 2 - 0.9 - 0.15 * r()); tor.castShadow = true; tails.add(tor);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.25, 12).rotateZ(Math.PI / 2), capC); cap.position.set(tor.position.x + 0.6, 0.52, tor.position.z + 0.15); tails.add(cap); }
  const stubs = []; for (let i = 0; i < 6; i++) stubs.push(B(0.14, 0.3, 0.14, pw / 2 + 0.6, 0.15, -pd / 2 + 0.8 + i * 0.5)); yard.add(merged(stubs, capC, 'conduit caps'));
  yard.add(tails);
  // bus supports ending in nothing: steel H-frames with post insulators; the take-off's conductors run from the gantry and stop in air;
  // the cable trench's covers
  const sup = [], ins = [], tr = [], cond = [], zS = -bd / 2 - 3.5, zG = -yd / 2 + 2.2;
  for (let i = 0; i < 3; i++) { const x = -3 + i * 3; sup.push(B(0.3, 4.5, 0.3, x - 0.9, 2.25, zS), B(0.3, 4.5, 0.3, x + 0.9, 2.25, zS), B(2.1, 0.3, 0.3, x, 4.5, zS)); ins.push(B(0.25, 1.1, 0.25, x, 5.2, zS));
    cond.push(B(0.04, 0.04, Math.abs(zG - zS) * (0.55 + 0.3 * r()), x, 7.2, zG + Math.abs(zG - zS) * 0.3)); }
  sup.push(B(10, 0.4, 0.4, 0, 9.0, zG), B(0.45, 9, 0.45, -5, 4.5, zG), B(0.45, 9, 0.45, 5, 4.5, zG));
  for (let i = 0; i < 12; i++) tr.push(B(0.95, 0.08, 0.6, bw / 2 + 1.6, 0.04, -bd / 2 + 0.4 + i * 0.62));
  yard.add(merged(sup, M.frame, 'supports')); yard.add(merged(ins, M.insulator, 'insulators')); yard.add(merged(tr, M.pad, 'trench')); yard.add(merged(cond, M.alu, 'conductors'));
  // the fence
  const fence = []; const fw = yw - 1, fd = yd - 1; for (const s of [-1, 1]) { fence.push(B(fw, 0.04, 0.04, 0, 2.1, s * fd / 2), B(0.04, 0.04, fd, s * fw / 2, 2.1, 0)); for (let x = -fw / 2; x <= fw / 2; x += 3) fence.push(B(0.08, 2.2, 0.08, x, 1.1, s * fd / 2)); for (let z = -fd / 2; z <= fd / 2; z += 3) fence.push(B(0.08, 2.2, 0.08, s * fw / 2, 1.1, z)); }
  yard.add(merged(fence, M.fence, 'fence'));
  // what was delivered instead, waiting: cable drums, pallets, a container, a site trailer (seeded: one to four of them)
  const wx = s => s * (bw / 2 + 2.5 + r() * 2), wz = () => (r() - 0.2) * (yd / 2 - 4);
  const wood = tileStd(pick(['#8b6a45', '#9a7a52', '#7a5c3b']), 0.85), cont = tileStd(pick(['#3e5b6b', '#6f7442', '#80878b', '#56606e']), 0.55, 0.4), whiteM = tileStd('#d8d8d2', 0.6);
  const nDrums = 1 + Math.floor(r() * 4);
  for (let i = 0; i < nDrums; i++) { const dr = new THREE.Group(), D = 2.0 + r() * 0.8, Wd = 1.2 + r() * 0.4;
    dr.add(mesh(new THREE.CylinderGeometry(D / 2, D / 2, 0.08, 32).rotateZ(Math.PI / 2).translate(-Wd / 2, D / 2, 0), wood)); dr.add(mesh(new THREE.CylinderGeometry(D / 2, D / 2, 0.08, 32).rotateZ(Math.PI / 2).translate(Wd / 2, D / 2, 0), wood));
    dr.add(mesh(new THREE.CylinderGeometry(D * 0.36, D * 0.36, Wd, 24).rotateZ(Math.PI / 2).translate(0, D / 2, 0), black));
    dr.position.set(wx(i % 2 ? 1 : -1) * 0.9, 0.01, wz()); dr.rotation.y = r() * Math.PI; yard.add(dr); }
  if (r() < 0.6) { const pal = []; const x0 = wx(1), z0 = wz(); for (let i = 0; i < 4 + Math.floor(r() * 6); i++) pal.push(B(1.2, 0.15 * (1 + Math.floor(r() * 4)), 1.0, x0 + (i % 3) * 1.3, 0.3, z0 + Math.floor(i / 3) * 1.1, [0, (r() - 0.5) * 0.2, 0])); yard.add(merged(pal, wood, 'pallets')); }
  if (r() < 0.45) { const c = mesh(boxGeometry(2.44, 2.6, 6.06, 0, 1.3, 0), cont); c.position.set(wx(-1) - 1, 0, wz()); c.rotation.y = (r() - 0.5) * 0.3; yard.add(c);
    const ribs = []; for (let z = -2.9; z <= 2.9; z += 0.3) ribs.push(B(2.46, 0.03, 0.06, 0, 2.61, z)); const rb = merged(ribs, cont, 'ribs'); rb.position.copy(c.position); rb.rotation.copy(c.rotation); yard.add(rb); }
  if (r() < 0.35) { const tr2 = mesh(boxGeometry(3.0, 2.8, 9.0, 0, 1.4, 0), whiteM); tr2.position.set(-yw / 2 - 6, 0, wz()); g.add(tr2); }
  if (kind === 'collector') {                                          // panel rows filling the frame either side of the yard
    const rows = [], frames = []; for (const sx of [-1, 1]) for (let i = 0; i < 9; i++) { const x = sx * (yw / 2 + 4 + i * 5.5); for (let z = -60; z < 60; z += 4.2) { rows.push(B(2.3, 0.05, 4.0, x, 1.6, z, [0, 0, sx * 0.35])); frames.push(B(0.08, 1.5, 0.08, x, 0.75, z)); } }
    g.add(merged(rows, M.panel, 'panels')); g.add(merged(frames, M.panelFrame, 'piles'));
  } else if (kind === 'switchyard') {                                 // the turbine hall's roof along one side; on the next pad, a working unit
    const roof = [], X = yw / 2 + 5; for (let i = 0; i < 80; i++) roof.push(B(0.04, 0.06, 90, X + i * 0.5, 22.03, 0)); roof.push(B(40, 0.05, 90, X + 20, 22, 0));
    g.add(merged(roof, M.roof, 'roof'));
    const nb = new THREE.Group(), tankM = tileStd('#7f8b80', 0.5, 0.5), list = [B(3.4, 3.4, 5.6, 0, 1.7, 0)]; for (const s of [-1, 1]) for (let i = 0; i < 12; i++) list.push(B(0.9, 2.6, 0.03, s * 2.2, 1.6, -2.4 + i * 0.44));
    nb.add(merged(list, tankM, 'unit')); for (let i = 0; i < 3; i++) { const b = mesh(new THREE.CylinderGeometry(0.1, 0.16, 2.2, 12), M.insulator); b.position.set(-1 + i, 4.5, -1.6); nb.add(b); }
    nb.position.set(0, 0.45, -bd - 4); yard.add(nb); yard.add(merged([B(bw, 0.35, 0.3, 0, 0.17, -bd - 4 - bd / 2), B(bw, 0.35, 0.3, 0, 0.17, -bd - 4 + bd / 2)], M.pad, 'curb2'));
  } else if (kind === 'datahall') {                                   // v4: the buildout next door. A hyperscale hall's membrane roof, its rooftop chillers in rows,
    // the diesel gensets in a line along its wall, contractors' trucks and a crane's mat; the transformer pad stays empty
    const X = yw / 2 + 7, roofM = tileStd('#b9bab5', 0.75), parM = tileStd('#6e706d', 0.7), unitM = tileStd('#c9ccca', 0.45, 0.5), genM = tileStd('#e2e0d6', 0.5, 0.3), dkM = tileStd('#2b2d2f', 0.6, 0.2), truckM = tileStd('#d6d3c8', 0.5, 0.3);
    const roof = [B(60, 0.5, 120, X + 30, 14, 0), B(60, 1.0, 0.8, X + 30, 14.6, -60), B(60, 1.0, 0.8, X + 30, 14.6, 60), B(0.8, 1.0, 120, X + 0.4, 14.6, 0)];
    g.add(merged([roof[0]], roofM, 'hallroof')); g.add(merged(roof.slice(1), parM, 'parapet'));
    const chill = [], fans = []; for (let i = 0; i < 6; i++) for (let j = 0; j < 14; j++) { const x = X + 6 + i * 8.5, z = -52 + j * 8; chill.push(B(5.2, 2.2, 3.4, x, 15.5, z)); fans.push(B(1.6, 0.05, 1.6, x - 1.3, 16.65, z), B(1.6, 0.05, 1.6, x + 1.3, 16.65, z)); }
    g.add(merged(chill, unitM, 'chillers')); g.add(merged(fans, dkM, 'fans'));
    const gens = [], stacks = []; for (let j = 0; j < 22; j++) { const z = -52 + j * 4.8 + r() * 0.2; gens.push(B(2.6, 2.9, 12, X - 7, 1.45, z, [0, Math.PI / 2, 0])); stacks.push(B(0.3, 3.4, 0.3, X - 3.2, 4.3, z)); }
    g.add(merged(gens, genM, 'gensets')); g.add(merged(stacks, dkM, 'stacks'));
    const trk = []; for (let i = 0; i < 6; i++) trk.push(B(2.3, 1.9, 6.0, yw / 2 + 2.4 + (i % 2) * 3, 0.95, -48 + i * 7 + r() * 2, [0, (r() - 0.5) * 0.15, 0])); g.add(merged(trk, truckM, 'trucks'));
    g.add(plane(tileConc(stoneBase, { dirt: 0.4 }), 5, 120, yw / 2 + 9, 0.008, 0, 0));
  } else if (kind === 'town') {                                       // a street, its lines, cars; the houses' roofs across it
    const X = -yw / 2 - 7; g.add(plane(M.asphalt, 9, 200, X, 0.015)); g.add(plane(tileStd(snowy ? '#cfd3d5' : '#a9a69e', 0.8), 2, 200, X + 5.5, 0.02));
    const ln = []; for (let z = -90; z < 90; z += 6) ln.push(B(0.12, 0.003, 3, X, 0.02, z)); g.add(merged(ln, M.white, 'lane'));
    const colors = ['#3b3f44', '#9aa0a4', '#e1e1dc', '#24324a', '#5a5e52', '#6b5a3e']; for (let i = 0; i < 7; i++) { const z = -40 + i * 13 + r() * 4, x = X - 2.2 + (i % 2) * 4.3, c = colors[Math.floor(r() * colors.length)];
      const car = new THREE.Group(); car.add(mesh(boxGeometry(1.85, 1.2, 4.6, 0, 0.75, 0), tileStd(c, 0.35, 0.6))); car.add(mesh(boxGeometry(1.6, 0.06, 1.8, 0, 1.36, -0.2), M.black)); car.position.set(x, 0, z); car.rotation.y = r() * 0.06; g.add(car); }
    const roofC = ['#4a4644', '#5b4d42', '#3f4347', '#6a625a']; for (let i = 0; i < 7; i++) { const z = -45 + i * 14 + r() * 3, c = tileStd(pick(roofC), 0.85), w = 9 + r() * 3, d = 8 + r() * 3, x = X - 14 - w / 2;
      g.add(mesh(boxGeometry(w / 2 + 0.2, 0.6, d, x - w / 4, 6.3, z, [0, 0, 0.32]), c)); g.add(mesh(boxGeometry(w / 2 + 0.2, 0.6, d, x + w / 4, 6.3, z, [0, 0, -0.32]), c)); }
  } else {                                                            // a field road in to the empty yard
    const road = plane(tileConc(stoneBase, { dirt: 0.5 }), 5, 120, yw / 2 + 9, 0.008, 0, 0); g.add(road);
  }
  litPatchAll(g); return g;
}
// the two late sites (bars 30-33): a plant extension under a crawler crane's boom; a foundation pour (rebar mats, a pump's boom, the
// screeding crew's place). frame: which of the two framings (0..3) shows it
export function buildSite(kind, seed, frame = 0) {
  const M = mats(), r = mulberry(seed * 131 + 7), g = new THREE.Group(); g.name = 'site:' + kind;
  const ground = mesh(new THREE.PlaneGeometry(80, 100).rotateX(-Math.PI / 2), M.soil, { cast: false }); g.add(ground);
  const shift = frame >= 2 ? [5, -7] : [0, 0];
  if (kind === 'extension') {
    const slab = mesh(new THREE.PlaneGeometry(36, 30).rotateX(-Math.PI / 2), M.pad, { cast: false }); slab.position.set(shift[0], 0.02, shift[1]); g.add(slab);
    const col = [], truss = [];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) { const x = -15 + i * 6 + shift[0], z = -12 + j * 6 + shift[1]; col.push(B(0.35, 9, 0.35, x, 4.5, z)); }
    for (let i = 0; i < 6; i++) { const x = -15 + i * 6 + shift[0]; if (i > 3) continue; truss.push(B(0.25, 0.25, 24, x, 9.0, shift[1]), B(0.18, 0.18, 24, x, 7.8, shift[1])); for (let z = -12; z <= 12; z += 1.5) truss.push(B(0.08, 1.2, 0.08, x, 8.4, z + shift[1])); }
    for (let j = 0; j < 5; j++) truss.push(B(30, 0.2, 0.15, shift[0], 9.1, -12 + j * 6 + shift[1]));
    g.add(merged(col, M.frame, 'columns')); g.add(merged(truss, M.frame, 'trusses'));
    // the crawler crane: tracks, body, and a 42 m lattice boom across the frame
    const cr = new THREE.Group(); cr.add(merged([B(1.0, 1.1, 7.0, -2.2, 0.55, 0), B(1.0, 1.1, 7.0, 2.2, 0.55, 0)], M.black, 'tracks'));
    cr.add(merged([B(4.2, 2.6, 5.5, 0, 2.4, -0.5), B(3.6, 1.6, 2.2, 0, 2.2, -3.6)], M.crane, 'body'));
    const boom = [], L = 42; for (const s of [-1, 1]) { boom.push(B(0.18, 0.18, L, s * 0.9, 0, -L / 2)); boom.push(B(0.18, 0.18, L, s * 0.9, 1.4, -L / 2)); }
    for (let z = 0; z < L; z += 1.6) boom.push(B(1.9, 0.08, 0.08, 0, 0.7, -z), B(0.08, 1.5, 0.08, 0.9, 0.7, -z), B(0.08, 1.5, 0.08, -0.9, 0.7, -z));
    const bm = merged(boom, M.crane, 'boom'); const bg = new THREE.Group(); bg.add(bm); bg.position.set(0, 3.2, 1.0); bg.rotation.x = 0.32; cr.add(bg);
    cr.position.set(14 - shift[0] * 0.5, 0, 16 + shift[1]); cr.rotation.y = 0.55 + (r() - 0.5) * 0.1; g.add(cr);
  } else {
    // the pour: formwork, a rebar mat (bars 200 mm both ways), the poured part wet and screeded toward the mat, the pump's boom over it
    const W = 22, D = 30, form = [], rb = [];
    for (const s of [-1, 1]) form.push(B(W + 0.4, 0.5, 0.2, shift[0], 0.25, s * D / 2 + shift[1]), B(0.2, 0.5, D, s * W / 2 + shift[0], 0.25, shift[1]));
    g.add(merged(form, M.white, 'formwork'));
    const front = -D / 2 + D * (0.42 + 0.06 * frame) + shift[1];                            // the poured edge advancing frame to frame
    for (let x = -W / 2 + 0.2; x < W / 2; x += 0.2) rb.push(B(0.02, 0.02, (D / 2 + shift[1]) - front, x + shift[0], 0.32, (front + D / 2 + shift[1]) / 2));
    for (let z = front; z < D / 2 + shift[1]; z += 0.2) rb.push(B(W - 0.2, 0.02, 0.02, shift[0], 0.34, z));
    g.add(merged(rb, M.rebar, 'rebar'));
    const wet = mesh(new THREE.PlaneGeometry(W - 0.2, front - (-D / 2 + shift[1])).rotateX(-Math.PI / 2), M.wet, { cast: false }); wet.position.set(shift[0], 0.4, (front + (-D / 2 + shift[1])) / 2); g.add(wet);
    const pump = new THREE.Group(); pump.add(merged([B(2.5, 2.8, 10, 0, 1.4, 0)], M.white, 'pumptruck'));
    const seg = []; let p = V3(0, 3.6, -3), a = -0.5; for (const L of [9, 9, 8, 6]) { const q = p.clone().add(V3(Math.sin(a) * L, 0.6, -Math.cos(a) * L)); const mid = p.clone().lerp(q, 0.5); seg.push(B(0.35, 0.35, L, mid.x, mid.y, mid.z, [0, -a, 0])); p = q; a += 0.35; }
    pump.add(merged(seg, M.crane, 'boom')); pump.position.set(W / 2 + 6 + shift[0], 0, -8 + shift[1]); pump.rotation.y = 0.15; g.add(pump);
    g.userData.pour = { front, W, D, shift, y: 0.4 };
  }
  litPatchAll(g); return g;
}
