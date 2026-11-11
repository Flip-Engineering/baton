// ARC-WELDING ROBOT (OBJECTS c1): a named type, not "a robot arm".
//
// Reference: 6-axis arc-welding robots of the 1.4-1.8 m reach class (FANUC ARC Mate 100iD / Yaskawa AR1440 / ABB IRB 1520
// class; product spec sheets and plant photographs) and collaborative arms (UR10e / FANUC CRX class):
//   kind 'industrial'  cast J1 turret on a bolted riser, J2 motor on the shoulder cheek, a tapered lower arm, the J3
//                      casting carrying the wire feeder, a hollow forearm (the torch cable runs through it) ending in the
//                      three wrist motors, J5 fork, J6 flange with a collision sensor, a 45-degree gooseneck torch with a
//                      copper nozzle; the power cable dressed up the arm on guides; a wire drum on the base
//   kind 'collab'      smooth white links, round joint drums with grey caps and a status ring, the same welding torch
//
// Compatible with commonwealth3.world.js cobot(): returns { root, reach(target), tip, grip, paint } (plus .group, the
// finished THREE.Group with userData.meta). reach() puts the torch tip at a world point with the torch pointing down.
//   const bot = cobotArm({ seed, kind, paint })   ;  bot.reach(new THREE.Vector3(0.9, 0.95, 0.2))
import * as THREE from 'three';
import { G, Parts, V3, TAU, rng, pick, range, mat, fin, paint, boltCircle, finish } from './kit.js';

export const ROBOT_PAINTS = { yellow: 0xe8b416, white: 0xe6e4de, blue: 0x2f5d9a, orange: 0xd8621a, red: 0xb3261c, grey: 0x9a9c98 };

export function cobotArm(o = {}) {
  const r = rng(o.seed ?? 1);
  const kind = o.kind ?? pick(r, ['industrial', 'industrial', 'collab']);
  const col = o.paint ?? (kind === 'collab' ? ROBOT_PAINTS.white : ROBOT_PAINTS[pick(r, ['yellow', 'yellow', 'blue', 'orange', 'red', 'white'])]);
  const wearK = o.wear ?? range(r, 0.15, 0.55);
  const riser = o.riser ?? 0.55;
  const M = {
    paint: paint(col, { grime: wearK * 0.5, grimeH: riser + 0.6, edge: 0.35 * wearK, speck: 0.04, gloss: kind === 'collab', rough: 0.4, metal: 0.1 }),
    dark: mat('robotDark', { color: 0x2a2b2e, rough: 0.45, metal: 0.4, wear: { grime: 0.2 } }),
    grey: mat('robotGrey', { color: 0x6d7074, rough: 0.35, metal: 0.6 }),
    steel: fin('steel'), black: fin('black'), rubber: fin('rubber'), chrome: fin('chrome'),
    copper: mat('nozzle', { color: 0xc47a3a, rough: 0.28, metal: 1, wear: { speck: 0.3, speckColor: [0.12, 0.08, 0.05], speckScale: 30, edge: 0.3 } }),
    riser: paint(0x3a3c3a, { grime: 0.6, grimeH: 0.4, speck: 0.3, edge: 0.4 }),
    cable: mat('cable', { color: 0x1a1a1c, rough: 0.7 }), cableO: mat('cableO', { color: 0xc85a14, rough: 0.6 }),
    ring: mat('ring', { color: 0x4aa8ff, emissive: 0x2a88ff, emissiveIntensity: 2.2 }),
    wire: mat('wire', { color: 0xb88a4a, rough: 0.3, metal: 1 }),
  };
  const mesh = (geo, m) => { const x = new THREE.Mesh(geo, m); x.castShadow = x.receiveShadow = true; return x; };
  const bag = (p, grp) => { grp.add(p.build(M)); return grp; };
  const root = new THREE.Group();
  const ind = kind === 'industrial';
  const L1 = ind ? 0.79 : 0.61, L2 = ind ? 0.84 : 0.57, dJ2 = ind ? 0.15 : 0, hJ2 = ind ? 0.45 : 0.18;
  // riser: a steel column with gussets on a floor plate with anchor bolts; the base flange bolted on top
  {
    const P = new Parts();
    P.add('riser', G.box(0.9, 0.04, 0.9, 0, 0.02, 0), G.box(0.36, riser - 0.08, 0.36, 0, riser / 2, 0), G.box(0.62, 0.04, 0.62, 0, riser - 0.02, 0));
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; P.add('riser', G.extrude([[0, 0], [0.22, 0], [0, 0.3]], 0.02).rotateY(a).translate(Math.cos(a) * 0.18, 0.04, -Math.sin(a) * 0.18)); }
    P.add('steel', boltCircle(8, 0.4, 0.022, 0.05, { y: 0.06, phase: Math.PI / 8 }), boltCircle(8, 0.26, 0.018, 0.04, { y: riser + 0.02 }));
    // base: the cast J1 housing
    P.add('paint', G.lathe(ind ? [[0, 0], [0.27, 0], [0.27, 0.05], [0.24, 0.08], [0.22, 0.2], [0, 0.2]] : [[0, 0], [0.11, 0], [0.11, 0.12], [0, 0.12]], 40).translate(0, riser, 0));
    if (ind) { P.add('dark', G.cylX(0.075, 0.2, -0.22, riser + 0.1, -0.12, 20)); P.add('black', G.box(0.12, 0.12, 0.08, -0.2, riser + 0.1, 0.2)); }
    // the wire drum beside the base (a 250 kg drum of MIG wire), and its conduit up to the feeder
    if (ind && o.drum !== false) { P.add('dark', G.cyl(0.3, 0.3, 0.8, 0.75, 0.4, -0.55, 28)); P.add('grey', G.cyl(0.18, 0.18, 0.12, 0.75, 0.86, -0.55, 18)); }
    bag(P, root);
  }
  const yaw = new THREE.Group(); yaw.position.y = riser + (ind ? 0.2 : 0.12); root.add(yaw);
  {
    const P = new Parts();
    if (ind) {
      P.add('paint', G.rbox(0.42, 0.3, 0.36, 0.08, 0.05, 0.15, 0));
      P.add('paint', G.cylX(0.17, 0.46, 0, hJ2, dJ2, 32));
      P.add('dark', G.cylX(0.1, 0.18, -0.3, hJ2, dJ2, 24), G.cylX(0.105, 0.02, -0.39, hJ2, dJ2, 24));   // J2 motor on the left cheek
      P.add('grey', G.cylX(0.12, 0.02, 0.235, hJ2, dJ2, 32));
    } else {
      P.add('paint', G.cyl(0.075, 0.075, hJ2, 0, hJ2 / 2, 0, 28), G.cylX(0.078, 0.2, 0.06, hJ2, 0, 28));
      P.add('grey', G.cylX(0.07, 0.02, 0.165, hJ2, 0, 28)); P.add('ring', new THREE.TorusGeometry(0.072, 0.006, 6, 32).rotateY(Math.PI / 2).translate(0.176, hJ2, 0));
    }
    bag(P, yaw);
  }
  const sh = new THREE.Group(); sh.position.set(0, hJ2, dJ2); yaw.add(sh);
  {
    const P = new Parts();
    if (ind) {
      // the lower arm: a tapered, rounded casting, wider at the shoulder, with a cover plate and the cable guides
      const arm = G.rbox(0.2, L1 + 0.12, 0.2, 0.07, 0, L1 / 2, 0); const pa = arm.attributes.position;
      for (let i = 0; i < pa.count; i++) { const y = pa.getY(i) / L1, f = 1.15 - 0.3 * y; pa.setX(i, pa.getX(i) * f); pa.setZ(i, pa.getZ(i) * f); }
      arm.computeVertexNormals(); P.add('paint', arm);
      P.add('grey', G.box(0.012, L1 * 0.6, 0.12, 0.125, L1 * 0.45, 0));
      for (const y of [0.25, 0.55]) P.add('black', new THREE.TorusGeometry(0.05, 0.012, 6, 16).rotateX(Math.PI / 2).translate(-0.15, L1 * y, -0.1));
    } else {
      P.add('paint', G.cyl(0.058, 0.058, L1, 0.12, L1 / 2, 0, 28)); P.add('paint', G.cylX(0.07, 0.18, 0.12, L1, 0, 28));
      P.add('grey', G.cylX(0.065, 0.02, 0.22, L1, 0, 28)); P.add('ring', new THREE.TorusGeometry(0.066, 0.005, 6, 32).rotateY(Math.PI / 2).translate(0.232, L1, 0));
    }
    bag(P, sh);
  }
  const el = new THREE.Group(); el.position.set(ind ? 0 : 0.12, L1, 0); sh.add(el);
  {
    const P = new Parts();
    if (ind) {
      P.add('paint', G.rbox(0.3, 0.26, 0.3, 0.08, -0.03, 0.05, 0));
      P.add('dark', G.cylX(0.08, 0.16, -0.23, 0.05, -0.03, 20));                 // J3 motor
      // the wire feeder on top of the J3 casting (a grey box, the drive rolls' door, the conduit elbow)
      P.add('grey', G.rbox(0.26, 0.2, 0.18, 0.03, -0.1, 0.27, -0.02)); P.add('dark', G.box(0.12, 0.1, 0.01, -0.12, 0.28, 0.075));
      // the hollow forearm: a round tube running forward (+y in the elbow frame is the forearm), 3 wrist motors at its back
      P.add('paint', G.cyl(0.095, 0.1, L2 - 0.12, 0, L2 / 2 + 0.02, 0.0, 28));
      for (let k = 0; k < 3; k++) P.add('dark', G.cyl(0.035, 0.035, 0.14, (k - 1) * 0.075, -0.12, 0.05, 14));
    } else {
      P.add('paint', G.cylX(0.07, 0.16, 0, 0, 0, 28), G.cyl(0.05, 0.05, L2, -0.04, L2 / 2, 0, 28), G.cylX(0.058, 0.15, -0.04, L2, 0, 28));
      P.add('grey', G.cylX(0.055, 0.02, -0.12, L2, 0, 28), G.cylX(0.066, 0.02, -0.09, 0, 0, 28)); P.add('ring', new THREE.TorusGeometry(0.056, 0.005, 6, 32).rotateY(Math.PI / 2).translate(-0.132, L2, 0));
    }
    bag(P, el);
  }
  const wr = new THREE.Group(); wr.position.set(ind ? 0 : -0.04, L2, 0); el.add(wr);
  const tip = new THREE.Object3D(), grip = new THREE.Object3D();
  {
    const P = new Parts();
    // J5 fork (two cheeks) and the J6 flange: disc, bolt circle, collision sensor, the torch mount
    if (ind) {
      for (const s of [-1, 1]) P.add('paint', G.rbox(0.03, 0.14, 0.12, 0.012, s * 0.07, 0, 0));
      P.add('paint', G.cylX(0.055, 0.12, 0, 0, 0, 20));
    } else P.add('paint', G.cyl(0.045, 0.045, 0.1, 0, 0.05, 0, 24));
    P.add('grey', G.cyl(0.045, 0.045, 0.03, 0, 0.09, 0, 24)); P.add('steel', boltCircle(6, 0.032, 0.005, 0.01, { y: 0.108 }));
    P.add('black', G.cyl(0.042, 0.042, 0.06, 0, 0.135, 0, 20));                                    // collision sensor
    P.add('steel', G.box(0.06, 0.04, 0.08, 0, 0.18, 0.02));                                        // torch clamp
    // the gooseneck torch: a 45-degree bent neck with an insulated sleeve, copper nozzle and contact tip
    const neckPts = [V3(0, 0.18, 0.02), V3(0, 0.26, 0.05), V3(0, 0.33, 0.1), V3(0, 0.37, 0.17)];
    P.add('black', G.tube(neckPts, 0.02, 20, 10));
    P.add('copper', G.lathe([[0.021, 0], [0.024, 0.02], [0.02, 0.07], [0.012, 0.085], [0.0, 0.085]], 18).rotateX(0.95).translate(0, 0.37, 0.17));
    tip.position.set(0, 0.425, 0.232); grip.position.set(0.12, 0.1, 0);
    bag(P, wr);
  }
  wr.add(tip, grip);
  // torch cable: from the feeder through / along the forearm to the torch; a service loop to the base on 'industrial'
  const cableM = mesh(new THREE.BufferGeometry(), M.cable); root.add(cableM);
  const loopM = mesh(new THREE.BufferGeometry(), ind ? M.cableO : M.cable); root.add(loopM);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
  function recable() {
    root.updateMatrixWorld(true);
    const w = p => root.worldToLocal(p);
    if (ind) {
      el.localToWorld(_a.set(-0.1, 0.35, -0.02)); el.localToWorld(_b.set(0.25, L2 * 0.5, 0.05)); wr.localToWorld(_c.set(0, 0.1, -0.08)); wr.localToWorld(_d.set(0, 0.2, 0.0));
      cableM.geometry.dispose(); cableM.geometry = G.tube([w(_a.clone()), w(_b.clone()), w(_c.clone()), w(_d.clone())], 0.022, 32, 8);
      const a2 = V3(-0.25, riser + 0.1, 0.1), b2 = sh.localToWorld(V3(-0.18, L1 * 0.25, 0.08)), c2 = sh.localToWorld(V3(-0.18, L1 * 0.8, 0.08)), d2 = el.localToWorld(V3(-0.15, 0.3, -0.05));
      loopM.geometry.dispose(); loopM.geometry = G.tube([a2, V3(-0.4, riser + 0.3, 0.2), w(b2), w(c2), w(d2)], 0.028, 40, 8);
    } else {
      wr.localToWorld(_a.set(0, 0.2, 0)); el.localToWorld(_b.set(0.08, L2 * 0.4, 0.05)); sh.localToWorld(_c.set(0.09, L1 * 0.4, 0.12));
      cableM.geometry.dispose(); cableM.geometry = G.tube([w(_a.clone()), w(_b.clone()), w(_c.clone()), V3(0.1, riser + 0.1, 0.2)], 0.014, 40, 8);
    }
  }
  // IK: J1 yaws toward the target, J2/J3 solve the planar two-link reach, J5 keeps the torch pointing down
  const _t = new THREE.Vector3();
  function reach(target, { tilt = 0 } = {}) {
    root.updateMatrixWorld(true);
    const lt = root.worldToLocal(_t.copy(target));
    yaw.rotation.y = Math.atan2(lt.x, lt.z);
    const baseY = yaw.position.y + hJ2;
    const rr = Math.hypot(lt.x, lt.z) - dJ2, y = lt.y - baseY + 0.43;
    const d = Math.min(Math.hypot(rr, y), L1 + L2 - 1e-3);
    const a2 = Math.acos(THREE.MathUtils.clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));
    const a1 = Math.atan2(rr, y) - Math.atan2(L2 * Math.sin(a2), L1 + L2 * Math.cos(a2));
    // rotate about x in the yawed frame: the arm leans toward +z (the target direction after the yaw)
    sh.rotation.x = a1; el.rotation.x = a2; wr.rotation.x = Math.PI - a1 - a2 + tilt;
    recable();
  }
  // default pose: reaching forward and down to a work point
  reach(o.target ?? V3(0, riser + 0.35, 1.05));
  const grp = new THREE.Group(); grp.add(root);
  finish(grp, { type: 'cobot', variant: { kind, paint: col, wear: wearK }, ref: ind ? 'arc-welding 6-axis robot, 1.4 m reach class (ARC Mate 100iD / AR1440 class)' : 'collaborative 6-axis arm (UR10e / CRX class) with MIG torch',
    anchors: { tip, grip }, lights: [{ kind: 'arc', obj: tip, color: 0xbfd8ff }] });
  return { root: grp, group: grp, reach, tip, grip, paint: M.paint, joints: { yaw, sh, el, wr } };
}
