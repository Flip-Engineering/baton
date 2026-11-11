// THE PLANT THAT WOULD NOT DIE: the people. No toy people: every figure the frame looks at is hero.js at the house's best settings (workforce
// castHero, c7 garments and skin, cloth fabrics), and people.js (ANSUR bodies, c7 backs, cloth colours) only where a figure is small.
//   the watchman  hero.js, about 60, cap, navy work shirt. A silhouette holding the torch (its barrel gripped with hero.grip at his palm,
//                 lantern.js hold) in the sheets and the line; his face only at the turn (28.8), lit by the running line's own light
//   the double    the watchman in the wide shot of banishing 3: people.js (rail cap and coat in navy) who runs to the main disconnect and
//                 hauls the handle down (labour.js Lever re-pivoted onto the column: pivot [0, 1.55, 0.45], len 0.45, its first
//                 downstroke only, then held); the torch in his right hand
//   the hands     hero.js at the fixture (the insert): a ratchet on the bolt in his right hand, the left steadying the rail
//   the crew      people.js at the stations where the ghosts were: 'work' (blows) and labour.js Stoop at the dies; caps; each glances up
//                 to the lens when his eyes open, then goes back to the work
import * as THREE from 'three';
import { Hero } from '../lib/fx/hero.js';
import { People } from '../lib/fx/people.js';
import { castHero, idleStance, workerDesc, twoBoneHero, restArm, CREW8 } from '../lib/fx/workforce.js';
import { mulberry32 } from '../lib/fx/rig/body.js';
import { Cast } from '../lib/fx/motion/cast.js';
import { Lever, Stoop } from '../lib/fx/motion/labour.js';
import { TL, GUARD, RUN, CREW, guardHand, h01, STAND_AT, runnerAt } from './plant.plan.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const BEST = { c7: true, cloth: true };

export const WATCHMAN = { name: 'watchman', variant: 'walt', sex: 'm', age: [58, 64], build: 'average', kind: 'work', shirt: '#1e2a42', shirt2: '#141b2a', trousers: '#23262c',
  trouserKind: 2, hat: 'cap', hatColor: '#1b1e25', hair: '#8f8a82', skin: '#c49478', beard: 0, stubble: 0.85, wear: 0.35, sweat: 0.05, stance: 'rest', weight: 0.5, look: 0, seed: 1936 };
export const HANDS = { ...CREW8[3], name: 'hands', vest: null, hat: 'cap', hatColor: '#2a2a2a', gloves: false, seed: 1937, weight: 0.3, look: 0 };
// the disconnect: where the double stands (facing the column, -z), so the Lever's own pivot is on the column's aisle face
export const STAND = V3(STAND_AT()[0], 0, STAND_AT()[1]);

export async function buildCrew({ scene, ansur, heroData }) {
  const R = mulberry32(1936), out = {};
  // ---------------------------------------------------------------- the watchman (hero.js)
  { const { opts, apply } = castHero(WATCHMAN, ansur, BEST); const h = new Hero(heroData, { ...opts, softBrows: true }); apply(h);
    scene.add(h.group); for (const m of h.meshes || []) { m.castShadow = true; m.receiveShadow = true; } h.group.visible = false; out.guard = h; }
  { const { opts, apply } = castHero(HANDS, ansur, BEST); const h = new Hero(heroData, opts); apply(h);
    scene.add(h.group); for (const m of h.meshes || []) { m.castShadow = true; m.receiveShadow = true; } h.group.visible = false; out.hands = h; }
  // the ratchet in his hand: a handle and a head on the bolt
  { const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: '#5a5d60', roughness: 0.35, metalness: 0.85 });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.27, 12).rotateZ(Math.PI / 2).translate(0.155, 0, 0), m), head = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 16), m);
    g.add(handle, head); for (const o of [handle, head]) o.castShadow = true; g.visible = false; scene.add(g); out.ratchet = g; }
  // ---------------------------------------------------------------- people.js: the double and the crew
  const folk = new People(scene, { max: CREW.length + 4, viewH: 1920, budget: [24, 120], lodPx: [240, 80] }), C = new Cast(folk); out.folk = folk; out.cast = C;
  { const d = workerDesc(ansur, R, { trade: 'rail', sex: 'm', age: [52, 64], ...BEST }); Object.assign(d, { top: '#1e2a42', bottom: '#23262c', hat: true, hatColor: '#1b1e25', beard: false, stubble: true });
    const id = folk.add(d); folk.set(id, { visible: false }); out.double = id;
    out.lever = () => new Lever({ seed: 1912, dims: C.dims(id), sc: C.sc(id), bodyKg: C.bodyKg(id), base: STAND.clone(), heading: Math.PI, pivot: V3(0, 1.55, 0.45), len: 0.45, period: RUN.period, st: folk.get(id) }); }
  out.crew = CREW.map(c => { const d = workerDesc(ansur, R, { trade: c.trade, ...BEST }); d.hat = true; const id = folk.add(d); folk.set(id, { visible: false });
    const p = { ...c, id, heading: c.heading };
    if (c.act === 'stoop') p.make = () => new Stoop({ seed: 300 + c.n, dims: C.dims(id), sc: C.sc(id), bodyKg: C.bodyKg(id), base: V3(c.x, 0, c.z), heading: p.heading, work: V3(0, 0.66, 0.42), st: folk.get(id) });
    return p; });
  out.acts = new Map(); out.lastT = -1;
  return out;
}

// the watchman standing, his right arm out with the torch (a two-bone reach to the hand point, the barrel through his palm, aimed)
export function poseGuard(K, shot, torch, aimAt) {
  const h = K.guard, G = GUARD[shot]; h.group.visible = true;
  h.group.position.set(...G.pos); h.group.rotation.set(0, Math.atan2(G.face[0], G.face[1]), 0); h.group.updateMatrixWorld(true);
  idleStance(h, WATCHMAN);
  const hand = guardHand(shot), f = V3(G.face[0], 0, G.face[1]).normalize(), r = V3(-f.z, 0, f.x);
  twoBoneHero(h, 'upperarm01.R', 'lowerarm01.R', 'wrist.R', hand, r.clone().multiplyScalar(0.8).add(V3(0, -1, 0)));
  restArm(h, 'L');
  torch.hold(h, 'R', { aimAt });
  h.update();
}
// the watchman's face at the turn: standing, arms down, looking toward the lens
export function poseWatch(K, pos, lookYaw) {
  const h = K.guard; h.group.visible = true; h.group.position.copy(pos); h.group.rotation.set(0, 0, 0); h.group.updateMatrixWorld(true);
  idleStance(h, { ...WATCHMAN, look: lookYaw, weight: 0.35 }); h.update();
}
// the hands at the fixture: the ratchet swings on the bolt (a pull and a return), the right hand on its handle, the left on the rail
export function poseHands(K, t, bolt) {
  const h = K.hands, g = K.ratchet; h.group.visible = true; g.visible = true;
  h.group.position.set(bolt.x + 0.06, 0, bolt.z - 0.5); h.group.rotation.set(0, 0, 0); h.group.updateMatrixWorld(true);
  idleStance(h, HANDS);
  const T = 0.95, u = ((t % T) + T) % T / T, a = -0.55 + (u < 0.62 ? 0.62 * sstep(0, 0.62, u) : 0.62 * (1 - sstep(0.62, 1, u)));      // the pull, then the return
  g.position.copy(bolt).add(V3(0, 0.035, 0)); g.rotation.set(0, -a, 0); g.updateMatrixWorld(true);
  const d = V3(Math.cos(a), 0, Math.sin(a)), grip = bolt.clone().add(V3(0, 0.035, 0)).addScaledVector(d, 0.235);
  twoBoneHero(h, 'upperarm01.R', 'lowerarm01.R', 'wrist.R', grip.clone().add(V3(0, 0.035, -0.045)), V3(-0.4, -1, -0.6));
  h.grip('R', { p: grip, d, r: 0.012 });
  twoBoneHero(h, 'upperarm01.L', 'lowerarm01.L', 'wrist.L', V3(bolt.x - 0.26, bolt.y + 0.03, bolt.z - 0.06), V3(0.4, -1, -0.6));
  h.relaxHand('L', 0.45, { cascade: true });
  h.update();
}
// the stateful acts (springs) are warmed over the second before t when a render starts or jumps, so a --seg start matches a straight run
function actAt(K, key, make, t0, t, dt = 1 / 30) {
  let A = K.acts.get(key);
  if (!A || !(t > A.t - 1e-6) || t - A.t > 1.5 * dt) { A = { act: make(), t: Math.max(t0, t - 1.0) - dt }; K.acts.set(key, A);
    for (let s = A.t + dt; s < t - 1e-6; s += dt) { A.act.sample(Math.max(0, s - t0), dt); A.t = s; } }
  const o = A.act.sample(Math.max(0, t - t0), dt); A.t = t; return o;
}
// banishing 3: the double runs from the aisle to the disconnect, then the Lever's first downstroke (held at its bottom)
export function poseDouble(K, t) {
  const id = K.double, folk = K.folk, r = runnerAt(t);
  if (r.running) {
    folk.set(id, { visible: true, shadowOnly: false, x: r.x, y: 0, z: r.z, heading: r.heading, act: 'walk', ph: (t - RUN.t0) * 13.5, look: 0, plant: true, pose: null, rig: null, mix: null, gesture: null, lift: 0 });
    return { lever: null, running: true };
  }
  const tl = Math.min(t, RUN.t1 + 0.42 * RUN.period), o = actAt(K, 'lever', K.lever, RUN.t1, tl);
  K.cast.apply(id, o.frame, o.spec, t); folk.set(id, { visible: true, shadowOnly: false });
  return { lever: o.props.lever, running: false };
}
// the crew at 32.4: eyes open one by one (nearest the lens first), each glance up to the lens, then back to the work
export function poseCrew(K, t, camPos) {
  const folk = K.folk, out = [];
  const order = K.crew.map(c => [c, Math.hypot(c.x - camPos.x, c.z - camPos.z)]).sort((a, b) => a[1] - b[1]);
  order.forEach(([c], k) => { c.open = TL.crew + 0.18 + k * 0.1 + 0.05 * h01(c.n * 3.3); });
  for (const c of K.crew) {
    const toCam = wrap(Math.atan2(camPos.x - c.x, camPos.z - c.z) - c.heading), g = sstep(c.open, c.open + 0.22, t) * (1 - sstep(c.open + 0.65, c.open + 1.05, t)), look = clamp(toCam, -1.15, 1.15) * g;
    if (c.make) { const o = actAt(K, 'crew' + c.n, c.make, TL.crew - 1.2, t); o.spec.head.yaw = (o.spec.head.yaw || 0) + look; o.spec.head.pitch = (o.spec.head.pitch || 0) - 0.35 * g;
      K.cast.apply(c.id, o.frame, o.spec, t); folk.set(c.id, { visible: true, shadowOnly: false }); }
    else folk.set(c.id, { visible: true, shadowOnly: false, x: c.x, y: 0, z: c.z, heading: c.heading, act: 'work', ph: ((t * 0.62 + c.ph) % 1 + 1) % 1, t, look, plant: true, pose: null, rig: null, mix: null, gesture: null, lift: 0 });
    out.push({ c, open: sstep(c.open, c.open + 0.25, t) });
  }
  return out;
}
export function hideFolk(K) { for (let id = 0; id < K.folk.n; id++) K.folk.set(id, { visible: false }); }
