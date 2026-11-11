// OBJECTS studio entry point: one registry of named-type generators (see kit.js for the why, and
// research/capabilities/objects.md for which pieces can adopt what).
//   import { makeObject, OBJECT_TYPES } from '../lib/fx/objects/index.js';
//   makeObject('truck', { seed: 4, cab: 'longhood', trailer: 'van53' })
export * from './kit.js';
export { truck, TRUCK_PAINTS } from './truck.js';
export { press, pressLine, PRESS_PAINTS } from './press.js';
export { cobotArm, ROBOT_PAINTS } from './cobot.js';
export { civic } from './civic.js';
export { coolingTower, utilityPole, wireSpan } from './power.js';
import { truck } from './truck.js';
import { press, pressLine } from './press.js';
import { cobotArm } from './cobot.js';
import { civic } from './civic.js';
import { coolingTower, utilityPole } from './power.js';
// every entry returns a THREE.Group with userData.meta (the cobot's rig object is on userData.rig)
const REG = { truck, press, pressLine, civic, coolingTower, utilityPole, cobot: o => { const c = cobotArm(o); c.group.userData.rig = c; return c.group; } };
export function registerObject(name, fn) { REG[name] = fn; }
export const OBJECT_TYPES = () => Object.keys(REG);
export function makeObject(type, o = {}) { const f = REG[type]; if (!f) throw new Error('objects: unknown type ' + type + ' (have ' + Object.keys(REG).join(', ') + ')'); return f(o); }

// MODELING studio (cycle 1): catalogued, baked assets (.glb with per-vertex AO / convex edge / part id, see lib/fx/modeling/ and
// research/capabilities/modeling.md). They load asynchronously and keep the generators above working unchanged.
//   const crane = await loadObject('sts_crane');   crane.root, crane.part('girders'), crane.anchors
import { loadAsset } from '../modeling/asset.js';
export { loadAsset, loadPart } from '../modeling/asset.js';
const MODEL_ASSETS = { cobot_wrist: 'cobot/cobot_wrist', container_40hc: 'containers/container_40hc', sts_crane: 'cranes/sts_crane', sts_trolley: 'cranes/sts_trolley', sts_spreader: 'cranes/sts_spreader',
  tractor_aero: 'trucks/tractor_aero', van53: 'trucks/van53', mill_stand: 'mill/mill_stand' };
export const MODEL_TYPES = () => Object.keys(MODEL_ASSETS);
export function loadObject(type, o = {}) { const a = MODEL_ASSETS[type]; if (!a) throw new Error('objects: unknown modelled type ' + type + ' (have ' + Object.keys(MODEL_ASSETS).join(', ') + ')'); return loadAsset(a, o); }
