// MECHA PROLETARIAT (8 Oct, the asset remake): the world. One yard, one giant, night to morning, built from the studio's systems:
//   the giant      ERECTOR (MODELING c4/c5, lib/fx/modeling/erect/erector.js, design 'c5': angle-iron lattice with riveted lacing,
//                  plate only on wear faces, pinned bearings, rams with hoses, hands that close on what they hold), its one steel
//                  through light/ (ERECT_PIPE.light). FRAME's dowels, brick-bond blocks and block mittens are gone.
//   the yard       ERECT's Yard (worked ground with ruts, puddles that hold the sky, spoil heaps, timber cribs, plate and girder
//                  stacks, huts, light towers, tube scaffold with planked lifts, tower cranes, a crawler crane, the works in the haze)
//   the trucks     OBJECTS' named tractors (lib/fx/objects/truck.js: long-hood, aero and cab-over cabs, real grilles and lamps), each
//                  in its owner's paint with its state plate at a plate's size
//   the crowd      HUMAN's people.js in ranks: a near rank, a packed mass, a far texture; fists that go up, sledges onto shoulders
//   her hammer     an ordinary sledge at her scale in ERECTOR's steel, lying on its timber cribs (mecha.props.js giantSledge)
import * as THREE from 'three';
import { rng } from '../lib/kit.js';
import { ERECT_PIPE, sharedUniforms } from '../lib/fx/modeling/erect/steel.js';
import { Erector } from '../lib/fx/modeling/erect/erector.js';
import { Yard } from '../lib/fx/modeling/erect/yard.js';
import { People } from '../lib/fx/people.js';
import { truck, TRUCK_PAINTS } from '../lib/fx/objects/truck.js';
import { coolingTower, utilityPole, wireSpan } from '../lib/fx/objects/power.js';
import { mat, fin, canvasTex } from '../lib/fx/objects/kit.js';
import { giantSledge, toolBoard, switchgear, crowdSledgeGeos, anvil } from './mecha.props.js';
import { GiantActs } from './mecha.giant.js';

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// the crews' own plates (real size: 12 x 6 in), state over number
export function plateTexture(state, num) {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#e9e3d0'; g.fillRect(0, 0, w, h); g.strokeStyle = '#1a2a5a'; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
    for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(60,50,30,${Math.random() * .08})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 12, 1 + Math.random() * 2); }
    g.fillStyle = '#1a2a5a'; g.textAlign = 'center'; g.font = '700 46px "Chakra Petch"'; g.fillText(state, w / 2, 70); g.font = '700 118px "Chakra Petch"'; g.fillText(num, w / 2, 196);
    const gr = g.createLinearGradient(0, h * .6, 0, h); gr.addColorStop(0, 'rgba(50,40,30,0)'); gr.addColorStop(1, 'rgba(50,40,30,.3)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

export class World {
  constructor(scene, { viewH = 1920, hammerL = 32 } = {}) {
    ERECT_PIPE.light = true;
    this.scene = scene; this.out = new THREE.Group(); this.out.name = 'outdoors'; scene.add(this.out);
    const U = this.U = sharedUniforms(); U.uSnow.value = 0;
    // ---------------- the giant (c5, no cylinder crew in her cab: the crew are people, placed by the scene)
    const E = this.E = new Erector(this.out, { U, design: 'c5', crew: false, snow: 0 });
    // ---------------- the yard
    const Y = this.Y = new Yard(this.out, { U, M: E.M, seed: 11 });
    this.ground = Y.ground({ snow: 0, slab: [64, 56] });
    this.puddles = [[22, 32, 6, 3, .3], [-30, 46, 9, 4, -.2], [10, 64, 5, 2.4, .8], [40, 52, 7, 3, .5], [-52, 22, 5, 3, 0], [-36, 86, 6, 2.2, .4], [18, 92, 8, 3, .2], [-12, 110, 6, 2.5, .6]].map(p => Y.puddle(...p));
    for (const [x, z, r, h, s] of [[-82, -34, 22, 9, 1], [74, -54, 30, 12, 2], [-98, 44, 16, 6, 3], [100, 24, 18, 7, 4], [-140, 120, 26, 8, 5]]) Y.spoil(x, z, r, h, s);
    Y.crib(13, -10, 4, 4, 2.1); Y.crib(-17, -14, 4, 4, 3.5); Y.crib(16, -16, 4.5, 4, 2.8);
    Y.plateStack(30, 18, 7, .3); Y.plateStack(33, 26, 5, .2); Y.plateStack(-38, 30, 6, -.4);
    Y.girderStack(-31, 6, 6, 18, .1); Y.girderStack(38, -8, 4, 14, 1.3);
    Y.hut(-46, 36, .5); Y.hut(-52, 27, .4, { lit: true }); Y.hut(56, 40, -.6, { lit: true }); Y.hut(-104, 44, .2, { lit: true });
    Y.drums(19, 35, 7); Y.drums(-40, 15, 5); Y.drums(-110, 52, 4);
    // floodlight towers round the giant (their lamps are the night rig's practicals, mecha.stage.js)
    this.towers = [[-40, 34], [44, 38], [-36, -40], [50, -6]].map(([x, z]) => { const yaw = Math.atan2(-x, -z); Y.lightTower(x, z, 24, yaw); return { x, z, h: 24, yaw, head: V3(x, 24.4, z) }; });
    // tube scaffold beside her (the sides and the back: she rises between them, nothing hides the rise from the front)
    this.scaf = [Y.scaffold(22.5, -2, 2.5, 14, 38, { bay: 2.4, lift: 2.0, planks: 2, sheet: .16, seed: 3 }), Y.scaffold(-22.5, -2, 2.5, 14, 38, { bay: 2.4, lift: 2.0, planks: 2, sheet: .12, seed: 4 }), Y.scaffold(0, -18.5, 17, 2.2, 36, { bay: 2.4, lift: 2.0, planks: 2, sheet: .1, seed: 5, faces: 'fb' })];
    this.scafDecks = []; for (const sx of [1, -1]) for (let j = 2; j <= 18; j += 2) this.scafDecks.push({ x: sx * 22.5, y: j * 2.0 + .06, z: -2, sx });
    // cranes behind her, a crawler on the apron's side
    this.cranes = [Y.towerCrane(-44, -24, { h: 84, jib: 64, back: 22, mat: 'craneY' }), Y.towerCrane(50, -32, { h: 74, jib: 58, back: 20, mat: 'crane' })];
    this.crawler = Y.crawler(46, 24, { boom: 58, luff: 64, rotY: -2.3 });
    // the works in the haze beyond, two cooling towers and a pole line along the haul road
    Y.works({ z: -340, smoke: false, n: 40 });
    for (const p of Y.plumes || []) p.P.g.visible = false;
    for (const [x, z, h, s] of [[-280, -560, 150, 3], [210, -640, 170, 4]]) { const ct = coolingTower({ seed: s, height: h }); ct.position.set(x, 0, z); this.out.add(ct); }
    { const poles = []; for (let i = 0; i < 9; i++) { const p = utilityPole({ seed: 20 + i, height: 12, transformer: i % 3 === 1 }); p.position.set(-160 + i * 40, 0, 150); p.rotation.y = Math.PI / 2; this.out.add(p); poles.push(p); }
      const wm = mat('wire', { color: 0x2a2a2a, rough: 0.5, metal: 0.6 }); for (let i = 0; i < poles.length - 1; i++) for (const ph of poles[i].userData.meta.anchors.phases || []) { const a = ph.clone().applyMatrix4(poles[i].matrix.compose(poles[i].position, poles[i].quaternion, poles[i].scale)), b = ph.clone().applyMatrix4(poles[i + 1].matrix.compose(poles[i + 1].position, poles[i + 1].quaternion, poles[i + 1].scale)); const w = new THREE.Mesh(wireSpan(a, b, .9, .012), wm); this.out.add(w); } }
    // HPS poles along the haul road and the apron's edge: the night's pools (their heads are the rig's practicals)
    this.hps = [[-46, 62], [-14, 66], [18, 66], [50, 62], [-66, 22]].map(([x, z]) => ({ pos: V3(x, 9, z), aim: V3(x * .9, 0, z - 2) }));
    { const pm = fin('galv'); for (const h of this.hps) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.09, .14, 9, 10), pm); p.position.set(h.pos.x, 4.5, h.pos.z + .45); p.castShadow = true; this.out.add(p); const arm = new THREE.Mesh(new THREE.BoxGeometry(.08, .08, .6), pm); arm.position.set(h.pos.x, 9.05, h.pos.z + .2); this.out.add(arm); } }
    // ---------------- her hammer on its cribs, the cribs under it
    this.ham = giantSledge(E.M, { L: hammerL }); this.out.add(this.ham);
    this.acts = new GiantActs(E, this.ham);
    { const lie = this.acts.K.lie.b, hy = this.ham.userData.headC.y, R = .82, hw = this.ham.userData.hw;
      this.hamCribs = [Y.crib(lie.x, lie.z + 3.2, 4.2, 4.2, lie.y - R, { size: .45 }), Y.crib(lie.x, lie.z + hy, 4.8, 4.4, lie.y - hw / 2, { size: .45 })]; }
    // ---------------- trucks: the crews' own, in a broken ring on the apron, noses to the giant; a hero tractor out at the edge
    const STATES = [['OHIO', '8TR-2210'], ['TEXAS', 'LK4 9920'], ['MICHIGAN', 'TRK 5541'], ['KENTUCKY', '771 JDX'], ['PENNSYLVANIA', 'AK-40212'], ['IOWA', 'MF 3378'], ['GEORGIA', 'TR 88021'], ['NEW JERSEY', 'X94 PLK'], ['OHIO', 'HVY-7001'], ['TEXAS', 'DRY 1188'], ['MICHIGAN', 'RIG 2025'], ['INDIANA', '402 KTX']];
    const PAINTS = [TRUCK_PAINTS.red, TRUCK_PAINTS.white, TRUCK_PAINTS.navy, TRUCK_PAINTS.black, TRUCK_PAINTS.green, TRUCK_PAINTS.orange, TRUCK_PAINTS.maroon, TRUCK_PAINTS.silver, TRUCK_PAINTS.blue, TRUCK_PAINTS.gold, TRUCK_PAINTS.red, TRUCK_PAINTS.white];
    const CABS = ['longhood', 'aero', 'longhood', 'cabover', 'longhood', 'aero', 'longhood', 'cabover', 'aero', 'longhood', 'longhood', 'aero'];
    const R = rng(33); this.trucks = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 1.55 + .15, d = 40 + (i % 3) * 7, x = Math.sin(a) * d * 1.08 + (R() - .5) * 3, z = Math.cos(a) * d * .82 + 26 + (R() - .5) * 3, yaw = a + Math.PI + (R() - .5) * .5;
      this.trucks.push(this.makeTruck({ seed: 100 + i, cab: CABS[i], paint: PAINTS[i], plate: STATES[i], x, z, yaw, trailer: i % 5 === 2 ? 'flatbed' : 'none' }));
    }
    this.hero = this.makeTruck({ seed: 7, cab: 'longhood', paint: TRUCK_PAINTS.red, plate: ['OHIO', 'OWN-1'], x: -54, z: 84, yaw: 2.4, trailer: 'none' });
    // ---------------- the tool board, the switchgear, Ray's anvil corner
    this.rack = toolBoard([['DALE', 'drill'], ['RUIZ', 'grinder'], ['BIG MIKE', 'hammer'], ['T.J.', 'wrench'], ['KOWALSKI', 'grinder'], ['DOT', 'tape'], ['LEON', 'drill'], ['LUPE', 'pliers'], ['H. WASHINGTON', 'hammer'], ['MARCUS', 'wrench'], ['RAY', 'drill'], ['SOL', 'hammer'], ['NGUYEN', 'grinder'], ['PAT', 'pliers'], ['BIG DAVE', 'wrench'], ['FRANK', 'tape'], ['OSCAR', 'drill'], ['CHEN', 'hammer']]);
    this.rack.position.set(26, 0, 40); this.rack.rotation.y = -.5; this.out.add(this.rack);
    this.sw = switchgear({ bays: 3 }); this.sw.position.set(13.5, 0, 27.0); this.out.add(this.sw);   // faces the apron: she throws it facing the giant beyond it
    this.SHOP = V3(-108, 0, 52);
    // ---------------- the crowd (people.js in ranks) and the five in her cab
    this.crowd = new PeopleCrowd(this.out, 460, { seed: 41, viewH }); this.layoutCrowd();
    this.sl = (() => { const { haft, head } = crowdSledgeGeos(); const n = this.crowd.n;
      const a = new THREE.InstancedMesh(haft, mat('crowdHaft', { color: 0xa8824e, rough: .62, wear: { grime: .3, grimeH: .5 } }), n), b = new THREE.InstancedMesh(head, fin('steel', { color: 0x303133, rough: .5, metal: .85 }), n);
      for (const m of [a, b]) { m.frustumCulled = false; m.count = 0; m.castShadow = true; this.out.add(m); } return [a, b]; })();
    this.out.traverse(o => { if (o.isMesh && o.castShadow == null) o.castShadow = true; });
  }
  makeTruck({ seed, cab, paint, plate, x, z, yaw, trailer = 'none' }) {
    const T = truck({ seed, cab, paint, day: true, trailer }), g = new THREE.Group(); g.add(T); g.position.set(x, 0, z); g.rotation.y = yaw - Math.PI / 2; this.out.add(g);
    // the lamps: this truck's own materials (headlamps come on one by one)
    const lamps = []; T.traverse(o => { if (o.isMesh && (o.name === 'lampWhite' || o.name === 'lampAmber')) { o.material = o.material.clone(); lamps.push(o.material); } });
    const meta = T.userData.meta, front = meta.bbox.max.x;
    // plates at a plate's size (0.30 x 0.15 m) on a bracket under the bumper, and on the back of the frame
    const pt = plateTexture(plate[0], plate[1]), pm = mat('plate:' + plate[1], { map: pt, rough: .45, metal: .3, wear: { grime: .35, grimeH: .6 } });
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(.305, .152), pm); p1.position.set(front + .02, .5, 0); p1.rotation.y = Math.PI / 2; T.add(p1);
    const br = new THREE.Mesh(new THREE.BoxGeometry(.03, .2, .34), fin('black')); br.position.set(front - .005, .5, 0); T.add(br);
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(.305, .152), pm); p2.position.set(meta.bbox.min.x - .02, .75, -.5); p2.rotation.y = -Math.PI / 2; T.add(p2);
    const nose = V3(Math.sin(yaw), 0, Math.cos(yaw));
    return { g, T, yaw, nose, pos: g.position, lamps, meta, plate, setLamps: k => lamps.forEach(m => { m.emissiveIntensity = (m.userData.ei0 ??= m.emissiveIntensity) * k; }),
      at: (fwd, side, y) => g.position.clone().addScaledVector(nose, fwd).addScaledVector(V3(nose.z, 0, -nose.x), side).add(V3(0, y, 0)) };
  }
  // ranks facing her: a near rank (backs to the lens at the end), a packed mass in clumps with gaps, a far texture; deck crews on
  // the scaffold lifts; five in her cab (placed per frame from her chest)
  layoutCrowd() {
    const R = rng(77), P = this.crowd.P; let i = 0;
    const put = (p, x, z, o = {}) => { Object.assign(p, { x, y: o.y || 0, z, yaw: o.yaw ?? Math.atan2(-x * .25, -(z - 10)) + (R() - .5) * .35, s: .94 + R() * .12, arm: 0, deck: !!o.deck, cab: o.cab ?? -1, rank: o.rank ?? 3, d0: o.d0 ?? 0 }); };
    // the five in her cab
    for (let k = 0; k < 5; k++) put(P[i++], 0, 0, { cab: k, rank: -1 });
    // deck crews on the scaffold lifts (night)
    for (let k = 0; k < 36; k++) { const d = this.scafDecks[(R() * this.scafDecks.length) | 0]; put(P[i++], d.x + (R() - .5) * 1.0 - d.sx * .3, d.z + (R() - .5) * 24, { y: d.y, deck: true, yaw: d.sx > 0 ? -Math.PI / 2 + (R() - .5) * 1.2 : Math.PI / 2 + (R() - .5) * 1.2, rank: 9 }); }
    // the near rank: a loose line at z ~ 66-70 across the front of the apron
    for (let k = 0; k < 44; k++) { const x = -34 + k * 1.55 + (R() - .5) * .6, z = 66 + (R() - .5) * 2.2 + Math.abs(x) * .04; put(P[i++], x, z, { rank: 0, d0: 0 }); }
    // the mass: clumps of 10-30, packed, with gaps of light between them
    const clumps = [[-26, 76, 7], [-10, 78, 9], [8, 77, 8], [24, 79, 7], [-38, 86, 6], [-18, 90, 9], [2, 88, 10], [20, 91, 8], [38, 88, 6], [-8, 100, 9], [14, 102, 8]];
    for (let k = 0; i < P.length - 90; k++) { const c = clumps[k % clumps.length], a = R() * 6.283, r = Math.sqrt(R()) * c[2]; put(P[i++], c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r * .6, { rank: 1, d0: (c[1] - 66) / 40 }); }
    // the far texture
    for (; i < P.length; i++) { const x = (R() - .5) * 150, z = 110 + R() * 50; put(P[i], x, z, { rank: 2, d0: 1.2 + R() * .3 }); }
    this.crowd.commit(0);
  }
  // per frame: who shows, the arms (fists rippling out from the front), the sledges, the five in her cab
  crowdUpdate(st, t, camera) {
    const P = this.crowd.P, decks = st.decks ?? (st.look === 'night'), apron = st.apron ?? true, cab = st.cabCrew ?? false;
    const ch = this.E.J.chest; ch.updateMatrixWorld(true);
    const cabY = this.E.cabFront.y - 1.9, cq = new THREE.Quaternion(); ch.getWorldQuaternion(cq); const cyaw = Math.atan2(V3(0, 0, 1).applyQuaternion(cq).x, V3(0, 0, 1).applyQuaternion(cq).z);
    P.forEach((p, i) => {
      if (p.cab >= 0) { const w = V3([-2.6, -1.3, 0, 1.3, 2.6][p.cab], cabY, 3.35).applyMatrix4(ch.matrixWorld); p.x = w.x; p.y = w.y; p.z = w.z; p.yaw = cyaw + (hash(i) - .5) * .4; p.vis = cab; p.arm = 0; return; }
      if (p.deck) { p.vis = decks; p.arm = 0; return; }
      // keep the lens clear: nobody stands within 2.6 m of a low camera
      const dx = p.x - camera.position.x, dz = p.z - camera.position.z, R = st.clear ?? 2.65; p.vis = apron && !(dx * dx + dz * dz < R * R && camera.position.y < 6);   // c20: st.clear widens it (the cast stands there)
      const wave = st.crowdArm ? clamp((st.crowdArm * 1.6 - p.d0) * 1.4) : 0;   // the fists go up from the front rank back
      p.arm = wave * (hash(i * 3.1) < .8 ? 1 : 0);
    });
    this.crowd.sledge = st.crowdSledge || 0; this.crowd.commit(t, st);
    this.crowd.update(camera);
    // the crowd's own sledges: at each shouldering person's right hand, the haft up over the shoulder
    const k = st.crowdSledge || 0; let n = 0; const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = V3(0, 1, 0), at = this.crowd.folk.att;
    if (k > 0) for (let i = 0; i < P.length; i++) { const p = P[i]; if (p.deck || p.cab >= 0 || !p.vis || hash(i * 5.7) > .88) continue;
      const a = at[p.id]; if (!a || !a.grip) continue;
      const hand = V3().setFromMatrixPosition(a.grip[1]), dl = V3(.12, 1, -.2).lerp(V3(.18, .62, -.76), k).normalize().applyAxisAngle(up, p.yaw);
      q.setFromUnitVectors(up, dl); m.compose(hand.addScaledVector(dl, -.12), q, V3(p.s, p.s, p.s)); this.sl[0].setMatrixAt(n, m); this.sl[1].setMatrixAt(n, m); n++; }
    this.sl[0].count = this.sl[1].count = n; for (const s of this.sl) s.instanceMatrix.needsUpdate = true;
  }
}
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

// people.js behind a small per-person record: P[i] = { x, y, z, yaw, s, arm, deck, cab, vis }; commit(t) each frame, update(camera)
export class PeopleCrowd {
  constructor(parent, n, { seed = 1, viewH = 1920 } = {}) {
    this.n = n; this.sledge = 0; this.folk = new People(parent, { max: n, viewH, budget: [40, 240] });
    const TR = ['steel', 'steel', 'weld', 'overalls', 'rail', 'farm'], R = rng(seed);
    this.P = []; for (let i = 0; i < n; i++) this.P.push({ x: 0, y: 0, z: 0, yaw: 0, s: 1, arm: 0, vis: true, id: this.folk.add(People.varied(TR[(R() * TR.length) | 0], seed * 1000 + i)) });
  }
  commit(t = 0) {
    this.P.forEach((p, i) => {
      const st = { x: p.x, y: p.y, z: p.z, heading: p.yaw, visible: p.vis !== false, gesture: null, pump: null, t: t + i * 1.73, act: 'stand' };
      if (p.arm > 0.05) { st.act = 'fist'; st.pump = Math.min(1, p.arm) * (.8 + .2 * Math.sin(t * 4.2 + i)); }
      if (p.deck) { st.act = (i % 3) ? 'work' : 'stand'; st.ph = (t * .6 + i * .37) % 1; }
      if (this.sledge > 0 && !p.deck && p.cab < 0) st.gesture = { name: 'SHOULDER_TOOL', side: -1, p: 0.5, w: this.sledge };
      this.folk.set(p.id, st);
    });
  }
  update(camera) { this.folk.update(camera); }
}
