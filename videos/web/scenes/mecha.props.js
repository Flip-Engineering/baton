// MECHA PROLETARIAT (8 Oct, the asset remake): the piece's own objects, built as named things with the OBJECTS kit's parts,
// finishes and world-space wear (lib/fx/objects/kit.js) or, at the giant's scale, with ERECTOR's members and its one steel
// (lib/fx/modeling/erect/members.js). Each is made from what a worker would call it, not from boxes:
//   valveBank     the operator's console: a sectional directional valve bank (cast sections side by side, a rubber boot at every
//                 lever root, the levers, a pressure gauge per pair, a stamped placard per lever) on a steel console with a kick plate
//   controlCab    the factory's controller: a steel enclosure, its door open on DIN rails, terminal strips and relays; a row of pilot
//                 lamps in bezels over a solenoid valve manifold with the hoses running out of it; a small stamped nameplate
//   switchgear    a short lineup of metal-clad switchgear: louvred cabinets, nameplates, meters, the big operating handle
//   anvil         a London-pattern anvil (horn, face, heel, hardy hole, waist, feet) strapped to its stump
//   crowdSledge   a 10 lb sledge (36" hickory, forged octagonal head with bright faces) as geometry for instancing
//   giantSledge   her hammer: an ordinary sledge at her scale, a forged double-faced head with chamfered cheeks and crowned faces
//                 polished by use, the eye and its wedge, and a fabricated steel haft with welded bands and a wrapped grip
//   toolBoard     the crews' shadow board: plywood and pegboard, each tool's outline painted round its own shape, the names in
//                 paint marker on tape, the tools themselves turned and extruded from their real profiles
import * as THREE from 'three';
import { G, Parts, V3, TAU, rng, mat, fin, paint, canvasTex, boltCircle, rivetRow, finish } from '../lib/fx/objects/kit.js';
import { Batch, cbox, cyl, cylX, cylZ, along, plateAt, flatBar, rng as rngE } from '../lib/fx/modeling/erect/members.js';

const STAMP = (lines, w = 256, h = 96, { bg = '#b9bcbc', fg = '#2a2b2c', font = 'Chakra Petch', border = true } = {}) => canvasTex(w, h, (g) => {
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},${Math.random() * .06})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 6, 1); }
  if (border) { g.strokeStyle = 'rgba(40,40,40,.55)'; g.lineWidth = 3; g.strokeRect(5, 5, w - 10, h - 10); }
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach(([t, sz], i) => { g.font = `700 ${sz}px "${font}"`; g.fillText(t, w / 2, h * (i + 1) / (lines.length + 1) + 2); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillText(t, w / 2 + 1, h * (i + 1) / (lines.length + 1) + 3); g.fillStyle = fg; });
});
const dialTex = (label = 'BAR', max = 400) => canvasTex(256, 256, (g, w) => {
  g.fillStyle = '#eceae2'; g.beginPath(); g.arc(128, 128, 124, 0, TAU); g.fill();
  g.strokeStyle = '#111'; g.lineWidth = 3; g.beginPath(); g.arc(128, 128, 120, 0, TAU); g.stroke();
  // the red sector (over-pressure), ticks, numbers
  g.strokeStyle = '#b3261e'; g.lineWidth = 12; g.beginPath(); g.arc(128, 128, 100, -Math.PI * 0.25 - 0.55, -Math.PI * 0.25); g.stroke();
  for (let i = 0; i <= 40; i++) { const a = Math.PI * 0.75 + i / 40 * Math.PI * 1.5, r0 = i % 5 ? 98 : 88; g.strokeStyle = '#151515'; g.lineWidth = i % 5 ? 2 : 4; g.beginPath(); g.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0); g.lineTo(128 + Math.cos(a) * 108, 128 + Math.sin(a) * 108); g.stroke(); }
  g.fillStyle = '#151515'; g.font = '700 22px "Chakra Petch"'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) { const a = Math.PI * 0.75 + i / 4 * Math.PI * 1.5; g.fillText(String(i * max / 4), 128 + Math.cos(a) * 70, 128 + Math.sin(a) * 70); }
  g.font = '700 26px "Chakra Petch"'; g.fillText(label, 128, 178);
}, { srgb: true });

// ------------------------------------------------------------------ the console: a sectional valve bank and its operator station
// Origin: the floor under the bank's centre line; the crew stand at z ~ +0.42 and face +z; the levers pivot at (x, 0.54, 0.82) and
// throw about +x (positive angle = pushed away from the operator). Grip sleeve 0.50-0.76 m up the lever (HandRig's bar is 0.52-0.74).
export const LEVER_X = [-2.4, -2.0, -1.45, -1.05, -0.5, -0.1, 0.45, 0.85, 1.4, 1.8, -3.2, 3.0];
export const LEVER_NAMES = ['HIP L', 'HIP R', 'KNEE L', 'KNEE R', 'ANKLE L', 'ANKLE R', 'SHLDR L', 'SHLDR R', 'ELBOW L', 'ELBOW R', 'WAIST', 'HANDS'];
export function valveBank({ seed = 1, names = null, tape = null, worn = 0.6 } = {}) {
  const r = rng(seed), grp = new THREE.Group(), P = new Parts(), x0 = -3.75, x1 = 3.55, W = x1 - x0, xc = (x0 + x1) / 2;
  const PIV_Y = 0.54, PIV_Z = 0.82, DECK = 0.33;
  // the console: a steel cabinet, a recessed kick plate, the deck the valve bank bolts to, the sloped gauge panel behind it
  P.add('console', G.box(W, DECK - 0.08, 0.86, xc, (DECK - 0.08) / 2 + 0.08, 1.06), G.box(W - 0.04, 0.03, 0.9, xc, DECK - 0.01, 1.06));
  P.add('kick', G.box(W - 0.1, 0.09, 0.78, xc, 0.045, 1.1));
  P.add('console', G.box(W, 0.06, 0.06, xc, DECK, 0.63));                                                  // the front lip where hands rest
  { const back = G.box(W, 0.62, 0.05, 0, 0, 0).rotateX(-0.42).translate(xc, DECK + 0.32, 1.42); P.add('console', back);
    P.add('console', G.box(W, 0.05, 0.28, xc, DECK + 0.6, 1.58), G.box(0.05, 0.62, 0.36, x0 + 0.03, DECK + 0.3, 1.38), G.box(0.05, 0.62, 0.36, x1 - 0.03, DECK + 0.3, 1.38)); }
  // the valve bank: cast sections with an inlet and an outlet end plate, tie rods, the work ports and hoses down into the floor
  const X = LEVER_X.slice(0, 12), sx = X.slice().sort((a, b) => a - b), bx0 = sx[0] - 0.24, bx1 = sx[sx.length - 1] + 0.24;
  for (const x of X) {
    P.add('cast', G.rbox(0.32, 0.2, 0.3, 0.035, x, DECK + 0.1, PIV_Z));
    P.add('cast', G.rbox(0.22, 0.06, 0.14, 0.02, x, PIV_Y - 0.01, PIV_Z));                              // the spool cap the lever pivots in
    for (const s of [-1, 1]) P.add('steel', G.cylZ(0.022, 0.05, x + s * 0.07, DECK + 0.14, PIV_Z + 0.17, 10));   // A and B work ports
    for (const s of [-1, 1]) P.add('hose', G.tube([V3(x + s * 0.07, DECK + 0.14, PIV_Z + 0.19), V3(x + s * 0.07, DECK + 0.1, PIV_Z + 0.32), V3(x + s * 0.09, DECK - 0.02, PIV_Z + 0.36), V3(x + s * 0.1, 0.05, PIV_Z + 0.38)], 0.017, 16, 6));
  }
  for (const xe of [bx0, bx1]) P.add('cast', G.rbox(0.12, 0.26, 0.34, 0.03, xe, DECK + 0.13, PIV_Z));
  for (const y of [DECK + 0.05, DECK + 0.17]) P.add('steel', G.cylX(0.012, bx1 - bx0 + 0.1, (bx0 + bx1) / 2, y, PIV_Z - 0.13, 8), G.cylX(0.012, bx1 - bx0 + 0.1, (bx0 + bx1) / 2, y, PIV_Z + 0.13, 8));
  // pressure gauges on the sloped panel, one per pair, with their brass fittings
  const gauges = [];
  const gm = mat('gaugeFace', { map: dialTex(), rough: 0.5 });
  for (let i = 0; i < 6; i++) { const x = i < 5 ? [-2.2, -1.25, -0.3, 0.65, 1.6][i] : -3.2; const c = V3(x, DECK + 0.38, 1.33);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.42, 0, 0));
    P.add('chrome', G.cyl(0.075, 0.075, 0.03, 0, 0, 0, 24).rotateX(Math.PI / 2).applyQuaternion(q).translate(c.x, c.y, c.z));
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.064, 32), gm); face.position.copy(c).add(V3(0, 0, -0.016).applyQuaternion(q)); face.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), Math.PI)); grp.add(face);
    const needle = new THREE.Mesh(G.box(0.004, 0.05, 0.002, 0, 0.022, 0), mat('needle', { color: 0x111111, rough: 0.4 })); needle.name = 'needle' + i; needle.position.copy(c).add(V3(0, 0, -0.02).applyQuaternion(q)); needle.quaternion.copy(face.quaternion); grp.add(needle); gauges.push(needle); }
  // the levers: a rubber boot at the root, the rod, the grip sleeve and an end cap
  const levers = [];
  const bootM = fin('rubber'), rodM = fin('steel', { color: 0x8a8e92, rough: 0.35, metal: 0.9 }), gripM = mat('leverGrip', { color: 0x161616, rough: 0.85, wear: { edge: 0.5, edgeColor: [0.32, 0.3, 0.27] } });
  X.forEach((x, i) => {
    const piv = new THREE.Group(); piv.name = 'lever' + i; piv.position.set(x, PIV_Y, PIV_Z); grp.add(piv);
    const add = (geo, m) => { const o = new THREE.Mesh(geo, m); o.castShadow = o.receiveShadow = true; piv.add(o); return o; };
    add(G.lathe([[0.055, 0], [0.05, 0.02], [0.038, 0.03], [0.042, 0.045], [0.03, 0.055], [0.034, 0.07], [0.02, 0.085], [0.016, 0.09]], 20), bootM);
    add(G.cyl(0.0145, 0.016, 0.7, 0, 0.44, 0, 12), rodM);
    add(G.lathe([[0.016, 0.495], [0.027, 0.5], [0.029, 0.56], [0.028, 0.66], [0.03, 0.72], [0.027, 0.76], [0.016, 0.765]], 18), gripM);
    add(G.cyl(0.022, 0.026, 0.02, 0, 0.775, 0, 16), rodM);
    levers.push({ piv, x, angle: 0 });
  });
  // a stamped placard per lever on the section's operator face, and the crew's tape strip with their names
  const nm = names || LEVER_NAMES;
  X.forEach((x, i) => { const t = STAMP([[nm[i] || '', 46]], 192, 64, { bg: '#a9aca9' }); const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.047), mat('plac' + i, { map: t, rough: 0.45, metal: 0.6 }));
    pl.position.set(x, DECK + 0.1, PIV_Z - 0.153); pl.rotation.y = Math.PI; grp.add(pl); });
  if (tape) tape.forEach(([who, x]) => { const t = canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#d8d0b4'; g.fillRect(0, 0, w, h); for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(90,80,60,${Math.random() * .08})`; g.fillRect(Math.random() * w, Math.random() * h, 8, 1); }
      g.fillStyle = '#1a1a1c'; g.font = '700 40px "Archivo Black"'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.save(); g.translate(w / 2, h / 2 + 2); g.rotate((Math.random() - .5) * .05); g.fillText(who, 0, 0); g.restore(); });
    const tp = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.06), mat('tape' + who, { map: t, rough: 0.7 })); tp.position.set(x, DECK + 0.002, 0.7); tp.rotation.x = -Math.PI / 2; tp.rotation.z = Math.PI; grp.add(tp); });
  const mats = {
    console: paint(0x3d4246, { grime: 0.5 * worn, grimeH: 0.25, edge: 0.55 * worn, speck: 0.12, rough: 0.55, metal: 0.35 }),
    kick: paint(0x1e1f20, { grime: 0.7, grimeH: 0.2, edge: 0.6, speck: 0.2 }),
    cast: mat('valveCast', { color: 0x4a2a22, rough: 0.62, metal: 0.4, wear: { grime: 0.35, grimeH: 0.6, edge: 0.45, edgeColor: [0.55, 0.53, 0.5], speck: 0.15, speckScale: 18 } }),
    steel: fin('steel'), chrome: fin('chrome'), hose: mat('hydHose', { color: 0x141414, rough: 0.8, wear: { grime: 0.3, grimeH: 0.5 } }),
  };
  grp.add(P.build(mats));
  finish(grp, { type: 'valveBank', ref: 'sectional directional control valve bank (mobile hydraulics) on an operator console', anchors: { deck: V3(0, DECK, 0.7) } });
  grp.userData.levers = levers; grp.userData.gauges = gauges;
  grp.userData.setLevers = k => levers.forEach((L, i) => { L.piv.rotation.x = k[i] ?? 0; L.angle = k[i] ?? 0; });
  grp.userData.setGauges = k => gauges.forEach((n, i) => { n.rotation.z = -(0.6 + 1.6 * Math.max(0, Math.min(1, k[i] ?? 0))) + Math.PI * 0.25; });
  return grp;
}

// ------------------------------------------------------------------ the factory's controller: an enclosure with its door open
// Origin on the floor at the enclosure's front centre; it faces +z. userData.lamps: emissive materials (0..1 via setLamps)
export function controlCab({ seed = 2 } = {}) {
  const grp = new THREE.Group(), P = new Parts(), w = 1.2, h = 2.0, d = 0.5, y0 = 0.3;
  P.add('box', G.box(w, 0.04, d, 0, y0, 0), G.box(w, 0.04, d, 0, y0 + h, 0), G.box(0.04, h, d, -w / 2, y0 + h / 2, 0), G.box(0.04, h, d, w / 2, y0 + h / 2, 0), G.box(w, h, 0.03, 0, y0 + h / 2, -d / 2));
  P.add('box', G.box(w * 0.3, y0, d * 0.8, -w * 0.3, y0 / 2, 0), G.box(w * 0.3, y0, d * 0.8, w * 0.3, y0 / 2, 0));   // the plinth
  // the door, swung open 110 degrees on its left hinge, its gasket and the wiring diagram pocket
  { const dg = G.box(w, h, 0.025, w / 2, 0, 0).translate(0, 0, 0).rotateY(-1.9).translate(-w / 2, y0 + h / 2, d / 2); P.add('box', dg);
    P.add('gasket', G.box(w - 0.04, h - 0.04, 0.012, w / 2, 0, -0.018).rotateY(-1.9).translate(-w / 2, y0 + h / 2, d / 2)); }
  // the backplate: DIN rails with relays and terminal strips, the wiring duct
  P.add('plate', G.box(w - 0.12, h - 0.16, 0.012, 0, y0 + h / 2, -d / 2 + 0.03));
  for (let r = 0; r < 5; r++) { const y = y0 + 0.28 + r * 0.34; P.add('steel', G.box(w - 0.24, 0.035, 0.012, 0, y, -d / 2 + 0.045)); P.add('duct', G.box(w - 0.24, 0.06, 0.06, 0, y + 0.13, -d / 2 + 0.07));
    for (let k = 0; k < 9; k++) { const x = -w / 2 + 0.18 + k * 0.105; if (r < 3) P.add(k % 3 ? 'relay' : 'relayB', G.box(0.07, 0.11, 0.08, x, y, -d / 2 + 0.09)); else P.add('term', G.box(0.012, 0.07, 0.05, x - 0.03, y, -d / 2 + 0.08), G.box(0.012, 0.07, 0.05, x, y, -d / 2 + 0.08), G.box(0.012, 0.07, 0.05, x + 0.03, y, -d / 2 + 0.08)); } }
  // the pilot lamps: a row of bezels across the top of the open enclosure, and under it the solenoid valve manifold
  const lampMats = [], lampGeo = [];
  for (let k = 0; k < 10; k++) { const x = -w / 2 + 0.12 + k * 0.106; P.add('chrome', G.cylZ(0.03, 0.03, x, y0 + h + 0.1, 0.02, 16)); const m = new THREE.MeshStandardMaterial({ color: 0x302018, emissive: new THREE.Color(k % 3 === 2 ? 0xff3010 : 0xffa020), emissiveIntensity: 0, roughness: 0.3 }); lampMats.push(m);
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.022, 14, 8, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2), m); l.position.set(x, y0 + h + 0.1, 0.045); grp.add(l); }
  P.add('box', G.box(w + 0.1, 0.2, 0.12, 0, y0 + h + 0.1, 0));
  P.add('cast', G.box(w * 0.9, 0.12, 0.16, 0, y0 - 0.12, d / 2 + 0.2));
  for (let k = 0; k < 8; k++) { const x = -w * 0.4 + k * w * 0.8 / 7; P.add('coil', G.box(0.06, 0.1, 0.07, x, y0 - 0.0, d / 2 + 0.2)); P.add('hose', G.tube([V3(x, y0 - 0.18, d / 2 + 0.2), V3(x, y0 - 0.32, d / 2 + 0.28), V3(x * 1.4, 0.03, d / 2 + 0.9 + k * 0.05)], 0.014, 12, 6)); }
  const np = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.07), mat('ctlPlate', { map: STAMP([['CONTROL 40 V', 34], ['PANEL 3', 30]], 256, 96, { bg: '#b0b2ae' }), rough: 0.4, metal: 0.6 }));
  np.position.set(0, y0 + h + 0.1, 0.064); grp.add(np);
  const mats = { box: paint(0x8a8f86, { grime: 0.35, grimeH: 0.6, edge: 0.35, speck: 0.06, rough: 0.5 }), gasket: fin('rubber'), plate: mat('backplate', { color: 0xc8c6bc, rough: 0.6 }), steel: fin('galv'),
    duct: mat('duct', { color: 0x8a8c8c, rough: 0.7 }), relay: mat('relay', { color: 0x2b2d30, rough: 0.5 }), relayB: mat('relayB', { color: 0x37506a, rough: 0.5 }), term: mat('term', { color: 0x7a8a9a, rough: 0.6 }),
    chrome: fin('chrome'), cast: mat('manifold', { color: 0x585a5c, rough: 0.5, metal: 0.6 }), coil: mat('coil', { color: 0x1a1a1a, rough: 0.5 }), hose: mat('hydHose', { color: 0x141414, rough: 0.8, wear: { grime: 0.3, grimeH: 0.5 } }) };
  grp.add(P.build(mats));
  finish(grp, { type: 'controlCab', ref: 'PLC / relay control enclosure over a solenoid valve manifold' });
  grp.userData.lamps = lampMats; grp.userData.setLamps = f => lampMats.forEach((m, k) => { m.emissiveIntensity = 6 * f(k); });
  return grp;
}

// ------------------------------------------------------------------ metal-clad switchgear: three bays, the main breaker's handle
// Origin on the floor at the lineup's front centre, facing +z. userData.handle: the pivot (rotation.x: +0.5 off, pulled down toward
// the operator .. -0.1 on, pushed up and away), userData.bar: [p0, p1] of the handle's grip bar in the pivot's local frame (for HandRig).
export function switchgear({ bays = 3, seed = 3 } = {}) {
  const grp = new THREE.Group(), P = new Parts(), bw = 0.92, h = 2.3, d = 1.4, W = bays * bw;
  for (let i = 0; i < bays; i++) { const x = -W / 2 + bw / 2 + i * bw;
    P.add('cab', G.box(bw - 0.02, h, d, x, h / 2 + 0.08, -d / 2));
    P.add('door', G.box(bw - 0.12, h - 0.22, 0.03, x, h / 2 + 0.1, 0.015));
    for (let k = 0; k < 6; k++) P.add('louvre', G.box(bw - 0.36, 0.022, 0.03, x, 0.3 + k * 0.05, 0.035).rotateX(0));          // louvres low
    for (let k = 0; k < 4; k++) P.add('louvre', G.box(bw - 0.36, 0.022, 0.03, x, h - 0.2 - k * 0.05, 0.035));
    P.add('chrome', G.box(0.04, 0.14, 0.04, x + bw / 2 - 0.12, h / 2 + 0.15, 0.05));                                    // door handle
    // meters: two round ammeters and a voltmeter over each door
    for (const mx of [-0.2, 0.2]) { P.add('bezel', G.cylZ(0.075, 0.04, x + mx, h - 0.45, 0.04, 22)); }
  }
  // the plinth, the bus duct across the top
  P.add('plinth', G.box(W + 0.1, 0.08, d + 0.1, 0, 0.04, -d / 2));
  P.add('cab', G.box(W, 0.3, 0.5, 0, h + 0.23, -0.4));
  // the main breaker's operating mechanism on the middle bay: a cast housing, the handle's hub, a padlock hasp
  const xm = 0, hubY = 1.05, hub = V3(xm, hubY, 0.1);
  P.add('mech', G.box(0.42, 0.62, 0.14, xm, hubY, 0.09), G.cylZ(0.11, 0.1, xm, hubY, 0.17, 24));
  P.add('hasp', G.box(0.05, 0.12, 0.02, xm + 0.16, hubY - 0.22, 0.18), new THREE.TorusGeometry(0.035, 0.008, 6, 14, Math.PI).translate(xm + 0.16, hubY - 0.3, 0.19));
  const handle = new THREE.Group(); handle.position.copy(hub).add(V3(0, 0, 0.2)); grp.add(handle);
  { const hm = new Parts(); hm.add('arm', G.box(0.07, 0.52, 0.045, 0, 0.26, 0)); hm.add('grip', G.cylX(0.024, 0.36, 0, 0.52, 0.0, 16)); hm.add('arm', G.cylZ(0.05, 0.08, 0, 0, 0, 18)); hm.add('arm', G.cylZ(0.032, 0.12, 0, 0, -0.06, 14));
    handle.add(hm.build({ arm: paint(0xc9a227, { grime: 0.4, grimeH: 1.6, edge: 0.6, speck: 0.05, rough: 0.45 }), grip: mat('swGrip', { color: 0x161616, rough: 0.8, wear: { edge: 0.4 } }) })); }
  // nameplates and the warning labels
  const tag = (txt, x, y, w = 0.36, hh = 0.1, bg = '#e9e4d4', fg = '#1a1a1a') => { const t = STAMP(txt, 256, Math.round(256 * hh / w), { bg, fg }); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), mat('sgTag' + txt[0][0] + x, { map: t, rough: 0.5 })); m.position.set(x, y, 0.035); grp.add(m); };
  for (let i = 0; i < bays; i++) tag([[['FEEDER 1', 'MAIN BUS', 'FEEDER 2', 'FEEDER 3'][i] || 'FEEDER', 34], ['13.8 kV', 28]], -W / 2 + bw / 2 + i * bw, h - 0.18);
  tag([['DANGER', 40], ['HIGH VOLTAGE', 30]], xm, 0.52, 0.3, 0.16, '#e2b21c', '#111');
  const mats = { cab: paint(0x6f7672, { grime: 0.4, grimeH: 0.9, edge: 0.3, speck: 0.05, rough: 0.5 }), door: paint(0x777e79, { grime: 0.35, grimeH: 0.9, edge: 0.35, speck: 0.05, rough: 0.45 }),
    louvre: paint(0x5a605c, { grime: 0.6, grimeH: 0.9, edge: 0.2 }), chrome: fin('chrome'), bezel: mat('meterBezel', { color: 0x1a1a1a, rough: 0.4 }), plinth: fin('black'),
    mech: paint(0x2e3236, { grime: 0.5, edge: 0.5, speck: 0.1 }), hasp: fin('steel') };
  grp.add(P.build(mats));
  // meter faces
  const dm = mat('swDial', { map: dialTex('A', 1200), rough: 0.5 });
  for (let i = 0; i < bays; i++) for (const mx of [-0.2, 0.2]) { const f = new THREE.Mesh(new THREE.CircleGeometry(0.06, 24), dm); f.position.set(-W / 2 + bw / 2 + i * bw + mx, h - 0.45, 0.062); grp.add(f); }
  finish(grp, { type: 'switchgear', ref: 'metal-clad medium-voltage switchgear lineup, 13.8 kV main breaker' });
  grp.userData.handle = handle; grp.userData.bar = [V3(-0.15, 0.52, 0), V3(0.15, 0.52, 0)]; grp.userData.throw = { off: 0.5, on: -0.1 };
  return grp;
}

// ------------------------------------------------------------------ a London-pattern anvil on its stump, strapped down
// Origin on the ground at the stump's centre; the face at faceY; the horn toward +z. userData.face: the face's centre (local)
export function anvil({ faceY = 0.8, seed = 4 } = {}) {
  const grp = new THREE.Group(), P = new Parts(), L = 0.62, fw = 0.115, top = faceY, waistY = top - 0.17, footY = top - 0.33;
  const stH = footY;   // the stump up to the anvil's feet
  P.add('wood', G.cyl(0.25, 0.28, stH, 0, stH / 2, 0, 24));
  P.add('wood2', G.cyl(0.255, 0.255, 0.012, 0, stH - 0.01, 0, 24));
  // the body (c20: v11's three stacked extrusions read as stepped boxes): ONE forged solid. Its side silhouette (heel, face, the
  // table step, the throat under the horn, the waist's curves, the feet) is extruded across the width, and the width then follows
  // the height: the face's width at the top, drawn in at the waist, spread at the feet, so the waist is concave on all four sides.
  const curve = (pts, a, c, b, n = 8) => { for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); } };
  const prof = [[-0.31, top - 0.085]];
  prof.push([-0.31, top], [0.19, top], [0.19, top - 0.018], [0.27, top - 0.018], [0.27, top - 0.06]);           // heel, face, the table step
  curve(prof, [0.27, top - 0.06], [0.2, top - 0.08], [0.13, waistY]);                                        // the throat under the horn
  curve(prof, [0.13, waistY], [0.11, footY + 0.06], [0.24, footY + 0.025]);                                  // the front of the waist to the front foot
  prof.push([0.25, footY], [-0.29, footY], [-0.28, footY + 0.025]);
  curve(prof, [-0.28, footY + 0.025], [-0.15, footY + 0.06], [-0.18, waistY]);                              // the back foot to the waist
  curve(prof, [-0.18, waistY], [-0.2, top - 0.1], [-0.31, top - 0.085]);                                     // under the heel
  const body = G.extrude(prof.slice(0, -1).map(([z, y]) => [z, y]), 1, 0).rotateY(-Math.PI / 2);
  { const pa = body.attributes.position, wAt = y => { const k = (y - footY) / (top - footY); return k > .78 ? fw : k > .45 ? fw * (0.62 + 0.38 * (k - .45) / .33) : fw * (0.62 + 0.88 * Math.pow((.45 - k) / .45, 1.6)); };
    for (let i = 0; i < pa.count; i++) pa.setX(i, Math.sign(pa.getX(i)) * wAt(pa.getY(i))); pa.needsUpdate = true; body.computeVertexNormals(); }
  P.add('iron', body);
  // the horn: a cone off the table, drawn round and down to its tip
  P.add('iron', G.lathe([[0, 0], [0.01, 0.012], [0.026, 0.05], [0.042, 0.11], [0.054, 0.17], [0.06, 0.2], [0.062, 0.215]], 24).rotateX(-Math.PI / 2 - 0.1).translate(0, top - 0.05, 0.48));
  P.add('iron', G.cyl(0.058, 0.066, 0.05, 0, top - 0.05, 0.27, 24).rotateX(0));
  // the face: a hardened steel plate welded on, polished bright by use; the hardy and pritchel holes in the heel
  P.add('face', G.box(fw * 2 - 0.01, 0.006, 0.49, 0, top + 0.002, -0.06));
  P.add('hole', G.box(0.026, 0.008, 0.026, 0, top + 0.004, -0.27), G.cyl(0.008, 0.008, 0.008, 0.04, top + 0.004, -0.24, 10));
  // the straps and chain holding it down to the stump
  for (const s of [-1, 1]) P.add('strap', G.box(0.03, 0.22, 0.012, s * fw * 1.06, footY - 0.08, 0), G.box(0.03, 0.012, 0.13, s * fw * 1.06, footY + 0.03, 0));
  const mats = { wood: mat('stump', { color: 0x5a4632, rough: 0.92, wear: { grime: 0.6, grimeH: 0.4, speck: 0.15, speckColor: [0.2, 0.15, 0.1] } }), wood2: mat('stumpTop', { color: 0x7a6248, rough: 0.9 }),
    iron: mat('anvilIron', { color: 0x2c2d2f, rough: 0.45, metal: 0.85, wear: { edge: 0.6, edgeColor: [0.55, 0.55, 0.53], speck: 0.25, speckScale: 22 } }),
    face: mat('anvilFace', { color: 0x9a9b98, rough: 0.16, metal: 1, env: 1.3 }), hole: fin('black'), strap: fin('steel') };
  grp.add(P.build(mats));
  finish(grp, { type: 'anvil', ref: 'London-pattern anvil (~150 lb) on a hardwood stump', anchors: { face: V3(0, top, -0.04) } });
  return grp;
}

// ------------------------------------------------------------------ the crowd's sledges (instancing): haft along +y from the hands
export function crowdSledgeGeos() {
  const haft = G.merge([G.cyl(0.016, 0.019, 0.88, 0, 0.44, 0, 8), G.cyl(0.021, 0.021, 0.02, 0, 0.01, 0, 8)]);
  const L = 0.17, r = 0.034, prof = [[0, -L / 2], [r * 0.72, -L / 2], [r, -L / 2 + 0.011], [r, L / 2 - 0.011], [r * 0.72, L / 2], [0, L / 2]];
  const head = G.lathe(prof, 8).rotateZ(Math.PI / 2).translate(0, 0.86, 0);
  return { haft, head };
}

// ------------------------------------------------------------------ her hammer, at her scale, in ERECTOR's steel
// Origin at the butt of the haft, +y up the haft toward the head; the head's long axis along x. M: ERECTOR's material set (G.M).
// userData: L (haft length), headC (head centre, local), grip(s) -> local point s metres up the haft, faces: the two striking faces.
export function giantSledge(M, { L = 28, head = [11, 5.2, 5.2], seed = 7 } = {}) {
  const B = new Batch({ seed, rivets: null }), [hl, hw, hd] = head, hy = L - hw / 2 + 0.6;
  // the haft: a fabricated tube (dark paint), welded bands every few metres, a wrapped grip near the butt, the butt knob
  for (let k = 0; k < 6; k++) { const y0 = k * (L - 3) / 6, y1 = (k + 1) * (L - 3) / 6, r0 = 0.82 - 0.12 * (k / 6), r1 = 0.82 - 0.12 * ((k + 1) / 6);
    B.push('plate', cyl(r1, y1 - y0, 20, r0), new THREE.Matrix4().makeTranslation(0, (y0 + y1) / 2, 0), { wear: 0.8, aoConst: 1, noLift: true, paint: -1 });
    B.push('mill', cyl(Math.max(r0, r1) + 0.07, 0.32, 20), new THREE.Matrix4().makeTranslation(0, y1, 0), { wear: 1.2, noLift: true }); }
  B.push('rubber', cyl(0.9, 5.2, 20, 0.92), new THREE.Matrix4().makeTranslation(0, 3.6, 0), { noLift: true, edge: false });
  for (let k = 0; k < 7; k++) B.push('rubber', cyl(0.95, 0.12, 20), new THREE.Matrix4().makeTranslation(0, 1.3 + k * 0.72, 0), { noLift: true, edge: false });
  B.push('mill', cyl(1.15, 0.9, 20, 1.0), new THREE.Matrix4().makeTranslation(0, 0.45, 0), { wear: 1.4, noLift: true });
  // the head (c20): a forged double-faced sledge as a smith makes one: a square bar with broad chamfers on its long edges, the cheeks
  // swelling a little at the eye, each end drawn down to a slightly smaller striking face that is ground flat and scuffed bright (steel,
  // never mirror chrome), the haft's end and its wedge proud of the top. v11's octagon with chrome domes read as a boiler.
  { B.push('mill', cbox(hl - 1.8, hw, hd, hw * 0.16), new THREE.Matrix4().makeTranslation(0, hy, 0), { wear: 1.0, noLift: true, paint: -1 });
    B.push('mill', cbox(hl * 0.34, hw * 1.06, hd * 1.08, hw * 0.2), new THREE.Matrix4().makeTranslation(0, hy, 0), { wear: 1.1, noLift: true, paint: -1 });   // the cheeks at the eye
    for (const s of [-1, 1]) {
      B.push('mill', cbox(0.9, hw * 0.9, hd * 0.9, hw * 0.12), new THREE.Matrix4().makeTranslation(s * (hl / 2 - 0.9 + 0.45 - 0.05), hy, 0), { wear: 1.6, noLift: true, paint: -1 });   // the drawn-down end
      B.push('frame', cbox(0.3, hw * 0.82, hd * 0.82, 0.08), new THREE.Matrix4().makeTranslation(s * (hl / 2 + 0.05), hy, 0), { wear: 3, noLift: true, edge: 1 });               // the ground face
    }
  }
  // the eye's wedge on the top, the haft's end proud of the head
  B.push('mill', cbox(1.5, 0.9, 1.5, 0.2), new THREE.Matrix4().makeTranslation(0, hy + hw / 2 + 0.3, 0), { wear: 1.5, noLift: true });
  B.push('mill', cbox(1.7, 0.3, 0.4, 0.06), new THREE.Matrix4().makeTranslation(0, hy + hw / 2 + 0.85, 0), { wear: 2, noLift: true });
  // chalked crew marks on the haft (the crews' own work)
  const g = B.build(M, { name: 'giantSledge' });
  const wrap = new THREE.Group(); wrap.add(g);
  wrap.userData = { L, headC: V3(0, hy, 0), hl, hw, grip: s => V3(0, s, 0), mass: 1900, faces: [V3(-hl / 2 - 0.2, hy, 0), V3(hl / 2 + 0.2, hy, 0)] };
  wrap.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  return wrap;
}

// ------------------------------------------------------------------ the crews' shadow board: plywood, pegboard, outlines, names
// Origin on the ground at the board's foot, facing +z. 18 tools in a 3 x 6 grid. Every tool is a real tool's profile.
const TOOLS = {
  hammer: P => { P.add('wood', G.lathe([[0.012, -0.16], [0.016, -0.12], [0.014, 0.0], [0.013, 0.12], [0.012, 0.15]], 10).translate(0, -0.02, 0));
    P.add('head', G.extrude([[-0.02, 0.0], [0.035, 0.0], [0.045, 0.012], [0.04, 0.025], [-0.02, 0.025], [-0.06, 0.03], [-0.1, 0.015], [-0.085, 0.006], [-0.05, 0.012]], 0.026, 0.002).translate(0.0, 0.135, 0)); },
  wrench: P => { P.add('steel', G.extrude([[-0.012, -0.17], [0.012, -0.17], [0.014, 0.08], [0.03, 0.1], [0.032, 0.15], [0.012, 0.15], [0.012, 0.11], [-0.012, 0.11], [-0.012, 0.15], [-0.032, 0.15], [-0.03, 0.1], [-0.014, 0.08]], 0.009, 0.002));
    P.add('steel', G.cylZ(0.009, 0.012, 0, 0.08, 0.003, 12)); },
  pliers: P => { for (const s of [-1, 1]) { P.add('red', G.extrude([[s * 0.006, -0.17], [s * 0.024, -0.17], [s * 0.018, 0.02], [s * 0.008, 0.04]], 0.012, 0.003)); P.add('steel', G.extrude([[s * 0.002, 0.03], [s * 0.016, 0.03], [s * 0.012, 0.11], [s * 0.002, 0.11]], 0.01, 0.001)); }
    P.add('steel', G.cylZ(0.008, 0.016, 0, 0.035, 0, 10)); },
  tape: P => { P.add('yellow', G.rbox(0.07, 0.07, 0.035, 0.012, 0, 0, 0)); P.add('black', G.cylZ(0.022, 0.037, 0, 0.0, 0, 16)); P.add('steel', G.box(0.03, 0.006, 0.02, 0.045, -0.03, 0)); P.add('black', G.box(0.012, 0.03, 0.04, -0.03, -0.045, 0)); },
  drill: P => { P.add('yellow', G.extrude([[-0.03, 0.0], [0.06, 0.0], [0.07, 0.02], [0.07, 0.06], [-0.04, 0.06], [-0.05, 0.03]], 0.05, 0.006).translate(0, 0.06, 0));
    P.add('black', G.extrude([[-0.02, -0.11], [0.015, -0.11], [0.02, 0.06], [-0.02, 0.06]], 0.04, 0.004).translate(0, 0, 0)); P.add('black', G.rbox(0.07, 0.045, 0.06, 0.01, -0.005, -0.13, 0));
    P.add('steel', G.cylX(0.012, 0.03, 0.085, 0.09, 0, 12)); P.add('steel', G.cylX(0.004, 0.06, 0.125, 0.09, 0, 8)); },
  grinder: P => { P.add('red', G.cylX(0.03, 0.2, -0.02, 0, 0, 16)); P.add('red', G.rbox(0.06, 0.06, 0.06, 0.01, 0.1, 0, 0)); P.add('steel', G.cyl(0.058, 0.058, 0.006, 0.13, 0.045, 0, 28)); P.add('black', G.cyl(0.062, 0.062, 0.012, 0.13, 0.055, 0, 28, true)); P.add('black', G.cylZ(0.01, 0.08, 0.07, 0.0, 0.05, 8)); },
};
export function toolBoard(names, { seed = 5 } = {}) {
  const grp = new THREE.Group(), R = rng(seed), BW = 2.1, BH = 2.7, cols = 3;
  // the board texture: plywood under pegboard; every slot's outline is painted round its own tool, the used ones dirtier
  const slots = names.map(([nm, kind], i) => ({ nm, kind, x: -0.66 + (i % cols) * 0.66, y: 3.02 - Math.floor(i / cols) * 0.43, used: R() }));
  const S = 1024, sx = x => (x / BW + 0.5) * S, sy = y => (1 - (y - 0.6) / BH) * S;
  const OUT = { hammer: [[-0.012, -0.18], [0.012, -0.18], [0.016, 0.12], [0.045, 0.135], [0.048, 0.165], [-0.1, 0.17], [-0.105, 0.14], [-0.016, 0.12]],
    wrench: [[-0.014, -0.17], [0.014, -0.17], [0.016, 0.08], [0.034, 0.1], [0.036, 0.155], [-0.036, 0.155], [-0.034, 0.1], [-0.016, 0.08]],
    pliers: [[-0.026, -0.17], [0.026, -0.17], [0.02, 0.02], [0.016, 0.11], [-0.016, 0.11], [-0.02, 0.02]], tape: [[-0.04, -0.06], [0.06, -0.06], [0.06, 0.04], [-0.04, 0.04]],
    drill: [[-0.03, -0.155], [0.04, -0.155], [0.025, 0.06], [0.13, 0.07], [0.13, 0.12], [-0.06, 0.12], [-0.06, 0.06], [-0.025, 0.06]], grinder: [[-0.13, -0.035], [0.13, -0.035], [0.2, 0.0], [0.2, 0.08], [0.06, 0.08], [0.06, 0.035], [-0.13, 0.035]] };
  const boardTex = canvasTex(S, S, g => {
    g.fillStyle = '#9c8466'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(${90 + Math.random() * 40 | 0},${70 + Math.random() * 30 | 0},${45 + Math.random() * 20 | 0},.18)`; g.lineWidth = 1 + Math.random() * 3; g.beginPath(); const y = Math.random() * S; g.moveTo(0, y); g.bezierCurveTo(S * .3, y + (Math.random() - .5) * 30, S * .6, y + (Math.random() - .5) * 30, S, y + (Math.random() - .5) * 20); g.stroke(); }
    g.fillStyle = '#3b3328'; for (let y = 10; y < S; y += 19) for (let x = 10; x < S; x += 19) { g.beginPath(); g.arc(x, y, 3.2, 0, TAU); g.fill(); }
    for (const s of slots) { const pts = OUT[s.kind] || OUT.wrench, k = 0.68 * S / BW, cx = sx(s.x), cy = sy(s.y);
      g.save(); g.translate(cx, cy); g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x * k * 1.06, -y * k * 1.06) : g.moveTo(x * k * 1.06, -y * k * 1.06)); g.closePath();
      g.fillStyle = 'rgba(28,24,20,.9)'; g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(230,226,214,.5)'; g.stroke(); g.restore();
      const gr = g.createRadialGradient(cx, cy, 10, cx, cy, 90 + 60 * s.used); gr.addColorStop(0, `rgba(30,24,18,${.12 + .2 * s.used})`); gr.addColorStop(1, 'rgba(30,24,18,0)'); g.fillStyle = gr; g.fillRect(cx - 160, cy - 160, 320, 320); }
    const gg = g.createLinearGradient(0, S * .75, 0, S); gg.addColorStop(0, 'rgba(40,30,20,0)'); gg.addColorStop(1, 'rgba(40,30,20,.35)'); g.fillStyle = gg; g.fillRect(0, 0, S, S);
  });
  const P0 = new Parts();
  P0.add('board', G.box(BW, BH, 0.02, 0, 0.6 + BH / 2, 0));
  for (const x of [-1.0, 1.0]) { P0.add('post', G.box(0.09, 3.4, 0.09, x, 1.7, -0.06)); P0.add('post', G.box(0.1, 0.06, 0.9, x, 0.03, -0.05)); }
  P0.add('post', G.box(BW + 0.1, 0.06, 0.06, 0, 0.6, -0.04), G.box(BW + 0.1, 0.06, 0.06, 0, 0.6 + BH, -0.04));
  const board = P0.build({ board: mat('pegboard', { map: boardTex, rough: 0.85 }), post: paint(0x2e3236, { grime: 0.5, grimeH: 1, edge: 0.5, speck: 0.15 }) });
  // planar uv for the board's face
  board.traverse(o => { if (o.isMesh && o.name === 'board') { const p = o.geometry.attributes.position, uv = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / BW + 0.5; uv[i * 2 + 1] = (p.getY(i) - 0.6) / BH; } o.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); } });
  grp.add(board);
  const tmats = { wood: mat('hickory', { color: 0x9c7a4c, rough: 0.6, wear: { grime: 0.4, grimeH: 0.2, edge: 0.3 } }), head: fin('steel', { color: 0x3a3c3e }), steel: fin('steel', { color: 0x8c9094, rough: 0.35, metal: 0.95 }),
    red: mat('toolRed', { color: 0xa8201c, rough: 0.5, wear: { edge: 0.6, grime: 0.3, grimeH: 0.3 } }), yellow: mat('toolYel', { color: 0xd9a514, rough: 0.5, wear: { edge: 0.5, grime: 0.35, grimeH: 0.3 } }), black: fin('black') };
  for (const s of slots) {
    const P = new Parts(); (TOOLS[s.kind] || TOOLS.wrench)(P); const t = P.build(tmats); t.position.set(s.x, s.y, 0.035); grp.add(t);
    // the hook it hangs on
    const hk = new THREE.Mesh(G.cylZ(0.004, 0.05, 0, 0, 0, 6), tmats.steel); hk.position.set(s.x, s.y + 0.16, 0.035); grp.add(hk);
    // the name: paint marker on a strip of tape under the slot
    const tx = canvasTex(256, 72, (g, w, h) => { g.fillStyle = '#d6cfb3'; g.fillRect(0, 0, w, h); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(80,70,50,${Math.random() * .1})`; g.fillRect(Math.random() * w, Math.random() * h, 10, 1); }
      g.fillStyle = '#16161a'; g.font = `700 ${s.nm.length > 9 ? 30 : 42}px "Archivo Black"`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.save(); g.translate(w / 2, h / 2 + 2); g.rotate((R() - .5) * .06); g.fillText(s.nm, 0, 0); g.restore(); });
    const tp = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.075), mat('tape:' + s.nm, { map: tx, rough: 0.75 })); tp.position.set(s.x + (R() - .5) * 0.03, s.y - 0.235, 0.014); tp.rotation.z = (R() - .5) * 0.04; grp.add(tp);
  }
  grp.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  finish(grp, { type: 'toolBoard', ref: 'a shop shadow board: pegboard over plywood, painted outlines, names on tape' });
  return grp;
}
