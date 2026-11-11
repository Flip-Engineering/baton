// AT REST: the works town (8 Oct 2026; OBJECTIVE ep.1, research/series/instrument/ep1_brief.md "The world"). One present-day American works,
// unnamed: a rail line, a road, a fenced gate with a gatehouse, a lit canopy and badge turnstiles, the works' stacks and sheds beyond. LED
// yard lights, today's trucks; nothing period. Metres, x east, y up, z south (light/sky.js: azimuth 90 is +x). The road runs east through
// the gate and on between the sheds to the horizon, so the sun rising at the end of it lights the people walking in from behind.
// The SAME world feeds the drop's refraction (an environment cube rendered from the bench at the window, pre-dawn, filtered to the band in
// the polariscope) and the one wide shot at sunrise (LitRenderer, PRESETS.dawnContre).
//   const Wd = buildWorld(THREE);   scene.add(Wd.group)   Wd.bench (the window: position, axis pitch)   Wd.lamps (the practicals' specs)
//   Wd.setExposure(e)  emissive faces (windows, the canopy, obstruction lights) at their own luminance for the active rig's exposure
import * as THREE from 'three';
import { mat, fin, paint, G, Parts, canvasTex, rng } from '../lib/fx/objects/kit.js';
import { makeObject } from '../lib/fx/objects/index.js';
import { litPatchAll } from '../lib/fx/light/patch.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const GATE_X = 0, ROAD_W = 7.5, RAIL_X = -22;   // c20: the line 18 m from the wide's lens (was 10 m: it crossed the nearest walker at his waist)
// the bench: a window over the works, 260 m west of the gate and 20 m up, its optical axis pitched up 8 degrees toward the sky
export const BENCH = { pos: [-260, 20, -20], pitch: 8 * Math.PI / 180, yaw: 0 };
// drop frame (x right, y up, z toward the camera = west) -> world, for the bench looking east and pitched up
export function dropToWorld(THREE_, pitch = BENCH.pitch) {
  const c = Math.cos(pitch), s = Math.sin(pitch);
  return new THREE_.Matrix3().set(0, -s, -c, 0, c, -s, 1, 0, 0);
}

// emissive panels: luminance in cd/m2, set against the rig's exposure
function glow(color, L, key) { const m = mat('glow:' + key, { color: 0x080808, rough: 0.6, emissive: color, emissiveIntensity: 1 }); m.userData.L = L; return m; }

export function buildWorld({ seed = 11 } = {}) {
  const R = rng(seed), group = new THREE.Group(); group.name = 'works';
  const emissive = [];
  const M = {
    ground: mat('ground', { color: 0x3b3a33, rough: 0.97, wear: { speck: 0.35, speckColor: [0.22, 0.2, 0.15], speckScale: 0.6, wobble: 0.3 } }),
    asphalt: mat('asphalt', { color: 0x2b2b2c, rough: 0.9, wear: { speck: 0.25, speckColor: [0.18, 0.18, 0.18], speckScale: 3, wobble: 0.2 } }),
    concrete: fin('concrete', { wear: { grime: 0.5, grimeH: 2.5, speck: 0.15 } }),
    paintLine: mat('paintLine', { color: 0xc9c2a8, rough: 0.7, wear: { speck: 0.5, speckScale: 9 } }),
    yellowLine: mat('yellowLine', { color: 0xb08a2a, rough: 0.7, wear: { speck: 0.5, speckScale: 9 } }),
    ballast: mat('ballast', { color: 0x575249, rough: 1, wear: { speck: 0.6, speckColor: [0.3, 0.27, 0.22], speckScale: 14, wobble: 0.3 } }),
    tie: mat('tie', { color: 0x2e2620, rough: 0.95, wear: { speck: 0.3, speckScale: 5 } }),
    rail: fin('steel', { color: 0x6a625a, rough: 0.35, metal: 0.9 }),
    clad: paint(0x5a636b, { grime: 0.55, grimeH: 6, edge: 0.15, speck: 0.12, rough: 0.6, metal: 0.4 }),
    clad2: paint(0x6d6a62, { grime: 0.6, grimeH: 5, edge: 0.15, speck: 0.15, rough: 0.65, metal: 0.35 }),
    roof: paint(0x2f3236, { grime: 0.3, edge: 0.1, speck: 0.1, rough: 0.6, metal: 0.5 }),
    stack: mat('stack', { color: 0x8b877e, rough: 0.9, wear: { grime: 0.5, grimeH: 30, speck: 0.15, wobble: 0.2 } }),
    stackTop: mat('stackTop', { color: 0x1d1b19, rough: 0.9 }),
    steel: fin('steel', { color: 0x4a4d50 }),
    galv: fin('galv'),
    gatehouse: paint(0x9a958a, { grime: 0.4, grimeH: 1.0, edge: 0.2, speck: 0.08, rough: 0.7, metal: 0.1 }),
    trim: paint(0x23415a, { grime: 0.2, edge: 0.3, speck: 0.05, rough: 0.5, metal: 0.3 }),
    glassDark: fin('glass'),
    stripeRed: mat('stripeRed', { color: 0xa8231b, rough: 0.5 }), stripeWhite: mat('stripeWhite', { color: 0xd8d4c8, rough: 0.5 }),
    tank: paint(0x8e979b, { grime: 0.35, grimeH: 8, edge: 0.1, speck: 0.1, rough: 0.5, metal: 0.5 }),
    trees: mat('trees', { color: 0x1c1f17, rough: 1 }),
  };
  const winWarm = glow(0xffc27a, 180, 'winWarm'), canopy = glow(0xf3efe6, 900, 'canopy'), obst = glow(0xff2010, 1500, 'obst'), led = glow(0xfff2de, 4000, 'led');
  emissive.push(winWarm, canopy, obst, led);
  const P = new Parts();
  // ---------------------------------------------------------------- ground, road, path, rail
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000, 1, 1).rotateX(-Math.PI / 2), M.ground); ground.receiveShadow = true; group.add(ground);
  P.add('asphalt', G.box(1400, 0.04, ROAD_W, 300, 0.02, 0));                                      // the road, west to east through the gate
  P.add('concrete', G.box(80, 0.12, 2.2, -20, 0.06, 6.4));                                         // the footpath to the turnstiles
  for (let x = -400; x < 700; x += 12) P.add('yellowLine', G.box(4, 0.012, 0.12, x, 0.046, 0));   // centre dashes
  P.add('paintLine', G.box(1100, 0.012, 0.12, 150, 0.046, -ROAD_W / 2 + 0.25), G.box(1100, 0.012, 0.12, 150, 0.046, ROAD_W / 2 - 0.25));
  P.add('paintLine', G.box(0.45, 0.012, ROAD_W, GATE_X - 6, 0.046, 0));                           // the stop line before the barrier
  // the rail line north-south, crossing the road: ballast, ties, rails (the level crossing planked)
  P.add('ballast', G.extrude([[-2.2, 0], [2.2, 0], [1.4, 0.45], [-1.4, 0.45]], 600).rotateY(Math.PI / 2).translate(RAIL_X, 0, 0));
  const tieG = new THREE.BoxGeometry(2.6, 0.18, 0.24), ties = new THREE.InstancedMesh(tieG, M.tie, 1000); let ni = 0; const m4 = new THREE.Matrix4();
  for (let z = -299; z < 300 && ni < 1000; z += 0.6) { m4.makeTranslation(RAIL_X, 0.52, z); ties.setMatrixAt(ni++, m4); }
  ties.count = ni; ties.castShadow = ties.receiveShadow = true; group.add(ties);
  for (const s of [-0.72, 0.72]) P.add('rail', G.box(0.07, 0.15, 600, RAIL_X + s, 0.68, 0), G.box(0.14, 0.03, 600, RAIL_X + s, 0.62, 0));
  P.add('asphalt', G.box(5.5, 0.62, ROAD_W, RAIL_X, 0.31, 0));                                      // the crossing's planking at rail height
  // crossbucks both sides of the road (c20: the near one stands past the footpath, out of the wide's frame: in v1 it stood in the sky
  // beside the mark and the payoff read as two crossed signs)
  for (const [x, z] of [[RAIL_X - 4, ROAD_W / 2 + 9.0], [RAIL_X + 4, -ROAD_W / 2 - 1.5]]) {
    P.add('galv', G.cyl(0.05, 0.05, 3.6, x, 1.8, z));
    for (const a of [Math.PI / 4, -Math.PI / 4]) { const g = new THREE.BoxGeometry(1.25, 0.22, 0.02); g.rotateZ(a); g.rotateY(Math.PI / 2); P.add('stripeWhite', g.translate(x, 3.25, z)); }
  }
  // ---------------------------------------------------------------- the gate: fence, canopy, gatehouse, barrier, turnstiles, lights
  const fenceTex = canvasTex(128, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(200,205,210,1)'; g.lineWidth = 3;
    for (let i = -h; i < w + h; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke(); } }, { repeat: [1, 1], srgb: true });
  fenceTex.wrapS = fenceTex.wrapT = THREE.RepeatWrapping;
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8a9096, map: fenceTex, alphaTest: 0.35, transparent: false, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.7 });
  for (const [z0, z1] of [[-160, -12.5], [10.5, 160]]) {
    const L = z1 - z0, tex = fenceTex.clone(); tex.needsUpdate = true; tex.repeat.set(L / 0.9, 2.4 / 0.9);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(L, 2.4).rotateY(Math.PI / 2).translate(GATE_X, 1.2, (z0 + z1) / 2), fenceMat.clone()); m.material.map = tex; m.castShadow = true; group.add(m);
    for (let z = z0; z <= z1 + 0.01; z += 3) P.add('galv', G.cyl(0.04, 0.04, 2.7, GATE_X, 1.35, z));
    P.add('galv', G.box(0.05, 0.05, L, GATE_X, 2.4, (z0 + z1) / 2));
    for (const dy of [0.12, 0.24, 0.36]) P.add('steel', G.box(0.012, 0.012, L, GATE_X + 0.18, 2.5 + dy, (z0 + z1) / 2));   // barbed strands on the outriggers
  }
  // the canopy over the lanes: a flat roof on columns, its soffit lit by LED panels (the gate's night light)
  P.add('trim', G.box(11, 0.9, 24, GATE_X + 1.5, 6.2, -1));
  for (const [x, z] of [[-3.5, -12], [6.5, -12], [-3.5, 10], [6.5, 10]]) P.add('steel', G.box(0.4, 5.8, 0.4, GATE_X + x, 2.9, z));
  for (let i = 0; i < 6; i++) P.add('canopy', G.box(1.2, 0.04, 0.6, GATE_X + (i % 2 ? 3.5 : -0.5), 5.73, -9 + Math.floor(i / 2) * 7.5));
  // the gatehouse on the north island: glazing all round, lit inside
  P.add('gatehouse', G.box(6, 0.8, 4.4, GATE_X + 1, 0.4, -9.8), G.box(6.2, 0.35, 4.6, GATE_X + 1, 3.25, -9.8));
  P.add('glassDark', G.box(5.8, 2.1, 4.2, GATE_X + 1, 1.85, -9.8));
  P.add('winWarm', G.box(5.6, 1.6, 0.05, GATE_X + 1, 1.9, -7.55), G.box(0.05, 1.6, 3.9, GATE_X - 1.95, 1.9, -9.8));
  P.add('concrete', G.box(8, 0.2, 6.5, GATE_X + 1, 0.1, -9.8));
  // the barrier arm across the inbound lane (down), red and white
  P.add('trim', G.box(0.5, 1.1, 0.5, GATE_X + 4.5, 0.55, -4.3));
  for (let i = 0; i < 9; i++) P.add(i % 2 ? 'stripeWhite' : 'stripeRed', G.box(0.42, 0.1, 0.1, GATE_X + 4.5, 1.0, -3.85 + i * 0.42 + 0.21));
  // the badge turnstiles on the south side: two full-height cages, a reader post each
  for (const z of [6.0, 8.2]) {
    P.add('galv', G.cyl(0.95, 0.95, 0.06, GATE_X, 2.3, z, 24), G.cyl(0.06, 0.06, 2.3, GATE_X, 1.15, z));
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; for (let j = 0; j < 9; j++) { const y = 0.2 + j * 0.23; P.add('galv', G.box(0.7, 0.03, 0.03, GATE_X + Math.cos(a) * 0.36, y, z + Math.sin(a) * 0.36).rotateY(-a)); } }
    P.add('trim', G.box(0.14, 1.2, 0.1, GATE_X - 1.1, 0.6, z - 0.9), G.box(0.12, 0.16, 0.06, GATE_X - 1.1, 1.24, z - 0.9));
  }
  // ---------------------------------------------------------------- the works (beyond the fence): sheds either side of the road, a melt shop,
  // stacks flanking the corridor, a conveyor gallery, silos, a water tower, a pipe bridge over the road, high-mast lights
  const shed = (x0, x1, z0, z1, eave, ridge, mk = 'clad', windows = true) => {
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    P.add(mk, G.box(w, eave, d, cx, eave / 2, cz));
    const g = G.extrude([[-d / 2 - 0.4, 0], [d / 2 + 0.4, 0], [0, ridge - eave]], w + 0.8).rotateY(Math.PI / 2).translate(cx, eave, cz); P.add('roof', g);
    // a monitor along the ridge
    P.add('roof', G.box(w * 0.9, 2.2, d * 0.18, cx, ridge - 0.4, cz));
    if (windows) for (let x = x0 + 6; x < x1 - 6; x += 9) { P.add('winWarm', G.box(5.5, 1.1, 0.06, x, eave - 2.2, z0 - 0.04), G.box(5.5, 1.1, 0.06, x, eave - 2.2, z1 + 0.04)); }
    for (let x = x0; x <= x1 + 0.01; x += 7.5) P.add('steel', G.box(0.35, eave, 0.35, x, eave / 2, z0 - 0.2), G.box(0.35, eave, 0.35, x, eave / 2, z1 + 0.2));
  };
  shed(40, 220, -112, -30, 18, 25, 'clad'); shed(52, 262, 30, 102, 21, 28, 'clad2');
  shed(120, 190, -160, -118, 40, 46, 'clad', true);                                                  // the melt shop, tall, behind
  P.add('clad2', G.box(24, 30, 40, 238, 15, -95));                                                   // a baghouse block
  const stack = (x, z, r, h) => { P.add('stack', G.cyl(r * 0.82, r, h, x, h / 2, z, 32)); P.add('stackTop', G.cyl(r * 0.84, r * 0.84, 1.5, x, h + 0.2, z, 32));
    for (const f of [0.62, 0.88]) { P.add('steel', G.cyl(r + 1.1, r + 1.1, 0.25, x, h * f, z, 32)); P.add('steel', G.cyl(r + 1.1, r + 1.1, 1.1, x, h * f + 0.55, z, 32, true)); }
    P.add('steel', G.box(0.5, h * 0.88, 0.5, x + r * 0.95, h * 0.44, z));                            // the ladder's cage
    P.add('obst', G.cyl(0.35, 0.35, 0.5, x + r * 0.6, h + 1.2, z, 12), G.cyl(0.35, 0.35, 0.5, x - r * 0.6, h + 1.2, z, 12), G.cyl(0.3, 0.3, 0.45, x, h * 0.62 + 1.4, z + r + 1.1, 12)); };
  stack(232, -46, 3.4, 86); stack(262, 46, 3.0, 74); stack(312, -72, 3.8, 96);
  // the conveyor gallery, rising from the north shed to the melt shop's top, on trestles
  { const a = V(150, 6, -100), c = V(205, 40, -132), n = 10;
    for (let i = 0; i <= n; i++) { const p = a.clone().lerp(c, i / n); if (i < n) P.add('steel', G.box(0.6, p.y, 0.6, p.x, p.y / 2, p.z)); }
    const d = c.clone().sub(a), L = d.length(), g = new THREE.BoxGeometry(L, 3.2, 3.6); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), d.normalize())); P.add('clad2', g.translate((a.x + c.x) / 2, (a.y + c.y) / 2 + 1.6, (a.z + c.z) / 2)); }
  // the pipe bridge over the road (its underside ~7 m up, high enough that the low sun passes beneath it down the road)
  for (const z of [-6.5, 6.5]) P.add('steel', G.box(0.6, 9, 0.6, 96, 4.5, z));
  P.add('steel', G.box(1.2, 0.6, 15, 96, 9.2, 0)); for (const [dy, r] of [[9.9, 0.35], [10.2, 0.5], [9.8, 0.25]]) P.add('galv', G.cylZ(r, 260, 96 + (r - 0.35) * 3, dy, 0, 16));
  for (const x of [96]) for (const z of [-60, 60]) { /* the rack continues either side into the sheds */ P.add('steel', G.box(0.6, 9, 0.6, x, 4.5, z)); }
  P.add('galv', G.cylZ(0.5, 120, 96.2, 10.2, -60, 16), G.cylZ(0.5, 120, 96.2, 10.2, 60, 16));
  // silos and a water tower
  for (let i = 0; i < 3; i++) { const x = 300 + i * 15, z = 70 + (i % 2) * 6; P.add('tank', G.cyl(6, 6, 30, x, 15, z, 32), G.cyl(0.6, 6, 4, x, 32, z, 32)); }
  { const x = 392, z = 34; for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) P.add('steel', G.box(0.5, 36, 0.5, x + dx, 18, z + dz));
    P.add('tank', G.cyl(7.5, 7.5, 9, x, 40, z, 32), G.cyl(0.5, 7.5, 3.5, x, 46.2, z, 32), G.cyl(7.5, 1.5, 3, x, 34, z, 32)); }
  // a far tree line and a low ridge (the sun clears it at the end of the road)
  for (let i = 0; i < 60; i++) { const x = 1100 + R() * 500, z = -900 + i * 30 + R() * 10, h = 8 + R() * 10; P.add('trees', G.cyl(4 + R() * 4, 5 + R() * 4, h, x, h / 2, z, 8)); }
  const works = P.build({ ...M, winWarm, canopy, obst, led });
  works.traverse(o => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = !(o.material.userData.L); } });
  group.add(works);
  // parked trucks inside the gate, and one waiting outside on the shoulder (today's)
  const trucks = [];
  try {
    for (const [x, z, yaw, s] of [[30, 12, Math.PI, 3], [44, -16, 0, 5], [-62, -5.8, 0, 7]]) { const T = makeObject('truck', { seed: s }); T.position.set(x, 0, z); T.rotation.y = yaw; group.add(T); trucks.push(T); }
  } catch (e) { console.log('atrest: trucks not built (' + (e.message || e) + ')'); }
  // the yard's lights: LED pole heads along the fence (inside) and high masts in the works, as practicals (their specs; the rig adds them)
  const lamps = [];
  for (let z = -140; z <= 140; z += 35) if (Math.abs(z) > 12) lamps.push({ kind: 'flood', name: 'pole' + z, pos: [GATE_X + 6, 11, z], aim: [GATE_X + 14, 0, z], lumens: 24000, half: 0.9, shadow: false, volume: false, bounce: false, head: 'flood', color: 'led' });
  for (const [x, z] of [[70, -18], [70, 18], [150, -20], [150, 20], [230, -10]]) lamps.push({ kind: 'metalHalide', name: 'mast' + x + z, pos: [x, 26, z], aim: [x + 4, 0, z * 1.3], lumens: 60000, half: 0.75, shadow: false, volume: false, bounce: false, head: 'flood', color: 'led' });
  for (const [x, z] of [[-2, -6], [4, -6], [-2, 6], [4, 6]]) lamps.push({ kind: 'point', name: 'canopy' + x + z, pos: [GATE_X + x, 5.6, z], lumens: 6000, half: 1.2, shadow: false, volume: false, bounce: false, head: 'none', color: 'led' });
  for (let z = -60; z <= 60; z += 40) lamps.push({ kind: 'flood', name: 'road' + z, pos: [-120 + z, 9, -ROAD_W / 2 - 1.5], aim: [-120 + z, 0, 0], lumens: 14000, half: 1.0, shadow: false, volume: false, bounce: false, head: 'cobra', color: 'led' });
  litPatchAll(group);
  const setExposure = e => { for (const m of emissive) m.emissiveIntensity = m.userData.L * e; };
  setExposure(1e-3);
  return { group, lamps, trucks, setExposure, emissive, M };
}
