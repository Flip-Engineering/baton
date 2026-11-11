// LAB AMERICANA (WORLDS studio c1): six real-scale American places + two camera moves, no type overlays.
//   ?shot=1 plains aerial, dusk (600 m)     ?shot=2 plains at night (900 m)      ?shot=3 interstate gantry, rain (cab 2.4 m)
//   ?shot=4 plant at night (1.2 km)          ?shot=5 skyline from an interchange  ?shot=6 storm front over wheat
//   ?shot=m1 gantry pass 65 mph (&arrive=s)  ?shot=m2 night crane 900 -> 450 m     &thermal=1 (shot 4): PRODUCTIVE's FLIR read
// window.renderFrame(t) draws; window.shotInfo() returns camera, scale checks (measured on screen vs camera maths) and timings.
import * as THREE from 'three';
import { World } from '../lib/fx/world3d.js';
import { LOOKS3, LightField, patchMaterial } from '../lib/fx/atmos3d.js';
import * as AM from '../lib/fx/americana.js';
import * as RD from '../lib/fx/americana_road.js';
import { bakeLayer } from '../lib/fx/matte.js';
import * as CT from '../lib/fx/americana_city.js';
import * as WX from '../lib/fx/weather.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const Q = new URLSearchParams(location.search);
const SHOT = Q.get('shot') || '1';
const INFO = { shot: SHOT, timings: [] };
window.shotInfo = () => INFO;

const SHOTS = {};
const deg = d => d * Math.PI / 180;

// ------------------------------------------------------------------ shared: a plains world
function plainsWorld(look, { far = 110000, near = 4, towns: tOpt = {}, farms = true, turbineRows, lightGain = 1, traffic = true, flares = [], creek = AM.makeCreek({ x0: -6500 }) } = {}) {
  const W = new World({ shadows: 0, atmos: look, far, near });
  const A = W.atmos;
  const railZ = 2400, hwyZ = -7200;
  const towns = AM.layoutTowns({ railZ, x0: -70000, x1: 12000, seed: 5, seatAt: -21000, ...tOpt });
  const lf = new LightField(A, { box: [-80000, -40000, 20000, 40000], res: 4096, haloPx: 22 });
  const plains = new AM.Plains(W, A, lf, { center: [-30000, 0], size: 100000, seg: 460, towns, railZ, hwyZ, creek });
  const T = new AM.Towns(W, lf, towns, plains, { lightGain });
  const F = farms ? new AM.Farmsteads(W, lf, plains, { rect: [-60000, -26000, 12000, 20000], avoid: towns, lightGain }) : null;
  const rows = turbineRows || [];
  const WF = new AM.WindFarm(W, lf, plains, { rows, lightGain });
  let TR = null;
  if (traffic) {
    const h = (x, z) => plains.h(x, z);
    TR = new AM.Traffic(lf, [
      { a: [-90000, 0, hwyZ - 16], b: [20000, 0, hwyZ - 16], n: 60, speed: 29, dir: 1 },
      { a: [-90000, 0, hwyZ + 16], b: [20000, 0, hwyZ + 16], n: 60, speed: 29, dir: -1 },
      // a few pickups on section roads
      ...[-3, -9, -14].map(k => ({ a: [k * AM.SECTION, 0, -30000], b: [k * AM.SECTION, 0, 20000], n: 1, speed: 22, dir: k % 2 ? 1 : -1 })),
    ], { heightFn: h, truckShare: 0.65, headI: 0.9, tailI: 0.5 });
  }
  for (const f of flares) AM.flare(lf, f[0], plains.h(f[0], f[1]), f[1], { i: f[2] || 60 });
  lf.build(); lf.animated = !!traffic; lf.U.uLightGain.value = look.lightGain ?? 1;
  A.setTowns(T.glow(look === LOOKS3.PLAINS_DUSK ? 0.4 : 1));
  return { W, A, lf, plains, towns, T, F, WF, TR, railZ, hwyZ,
    update(t) { WF.update(t); if (TR) TR.update(t); } };
}
const turbineRowsA = () => {
  const rows = [];
  for (let k = 0; k < 9; k++) { const x = -9000 - k * 1100; rows.push({ x0: x, z0: -16000, x1: x - 2500, z1: -2500 }); }   // on the ridge north-west
  for (let k = 0; k < 5; k++) { const x = -26000 - k * 1000; rows.push({ x0: x, z0: 6000, x1: x - 1500, z1: 16000 }); }
  return rows;
};

// ------------------------------------------------------------------ 1. plains aerial at dusk, 600 m, toward the afterglow
SHOTS['1'] = () => {
  const rows = [{ x0: -5400, z0: -1400, x1: -5700, z1: 1000 }, { x0: -6800, z0: -4200, x1: -7600, z1: -800 }]; for (let k = 0; k < 6; k++) { const x = -11000 - k * 2300; rows.push({ x0: x, z0: -5200 - k * 600, x1: x - 700, z1: 900 + k * 300 }); }
  const P = plainsWorld(LOOKS3.PLAINS_DUSK, { turbineRows: rows, lightGain: 0.45, flares: [[-15000, 9000, 40]], towns: { first: -3700 } });
  const cam = () => ({ pos: [0, 600, 1900], target: [-5700, 0, 1350], fov: 54 });
  return { ...P, cam };
};
// ------------------------------------------------------------------ 2. plains at night, 900 m
SHOTS['2'] = () => {
  const rows = []; for (let k = 0; k < 10; k++) { const x = -14000 - k * 1300; rows.push({ x0: x, z0: -7000, x1: x - 600, z1: 1300 }); rows.push({ x0: x - 600, z0: 3700, x1: x - 900, z1: 10000 }); }
  const P = plainsWorld(LOOKS3.PLAINS_NIGHT, { turbineRows: rows, flares: [[-9000, 11000, 70], [-38000, -14000, 50]], towns: { first: -1500, seed: 8, seatAt: -16000 } });
  const cam = () => ({ pos: [6000, 900, 3700], target: [-6000, 0, 2500], fov: 54 });
  return { ...P, cam };
};
// ------------------------------------------------------------------ M2. night crane: 900 -> 450 m with a 15 deg yaw
SHOTS['m2'] = () => {
  const P = SHOTS['2']();
  const k0 = { pos: [6000, 900, 3700], target: [-6000, 0, 2500] };
  const cam = (t) => { const u = Math.min(1, Math.max(0, t / 2)), e = u * u * (3 - 2 * u), y = 900 - 450 * e, yaw = deg(15) * e;
    const dx = k0.target[0] - k0.pos[0], dz = k0.target[2] - k0.pos[2], c = Math.cos(yaw), s = Math.sin(yaw);
    const fwd = [dx * c - dz * s, dz * c + dx * s];
    return { pos: [k0.pos[0] - 900 * e, y, k0.pos[2] - 500 * e], target: [k0.pos[0] - 900 * e + fwd[0], 60 * e, k0.pos[2] - 500 * e + fwd[1]], fov: 54 }; };
  return { ...P, cam };
};

// ------------------------------------------------------------------ 3. interstate, sign bridge at MUTCD scale, rain, cab height, 120 m out
function highwayWorld({ camZ = 0 } = {}) {
  const W = new World({ shadows: 0, atmos: LOOKS3.HIGHWAY_RAIN, far: 9000, near: 0.3 });
  const A = W.atmos; A.reflect({ scale: 0.4 });
  const lf = new LightField(A, { box: [-70, -2600, 70, 260], res: 2048, haloPx: 34 });
  const hl = new RD.Headlights(W);
  const lit = RD.patchLit(hl);
  const hw = new RD.Highway(W, A, lf, hl, { patch: lit, z0: 250, z1: -2600 });
  const L = RD.MUTCD.lane, xm = hw.xm;
  const gz = -120;
  const G = new RD.Gantry(W, A, lf, hl, { z: gz, x0: xm - 4.6, x1: hw.W + RD.MUTCD.shoulderR + 7.3, patch: lit, panels: [
    { x: 1.5 * L + 0.2, w: 11.0, h: 4.3, shield: { num: '80', h: 1.55, x: 1.55, y: 1.2 },
      lines: [{ text: 'WEST', cap: 0.46, y: 0.62, x: 2.7, align: 'left' }, { text: 'Des Moines', cap: 0.46, y: 2.55 }] },
    { x: 3.5 * L + 0.3, w: 6.4, h: 4.3, lines: [{ text: 'EXIT 2036', cap: 0.3, y: 0.3 }, { text: 'Tomorrow', cap: 0.46, y: 1.35 }, { text: '1/2 MILE', cap: 0.3, y: 2.75 }] },
  ] });
  const truck = new RD.Truck(W, A, lf, hl, { x: 1.5 * L, z: -58, patch: lit });
  // traffic: two cars ahead in our carriageway, oncoming on the far side of the barrier
  const xo = xm - 0.45 - RD.MUTCD.shoulderL;
  const TR = new AM.Traffic(lf, [
    { a: [3.5 * L, 0, 200], b: [3.5 * L, 0, -2600], n: 3, speed: 31, dir: 1 },
    { a: [0.5 * L, 0, 200], b: [0.5 * L, 0, -2600], n: 3, speed: 33, dir: 1 },
    ...[0, 1, 2, 3].map(k => ({ a: [xo - (k + 0.5) * L, 0, -2600], b: [xo - (k + 0.5) * L, 0, 260], n: 7, speed: 30, dir: 1 })),
  ], { seed: 21, headI: 5, tailI: 1.6, truckShare: 0.3, pool: true });
  new RD.Rain(A, lf, hl, { count: 9000 });
  lf.build(); lf.animated = true;
  return { W, A, lf, hl, hw, G, truck, TR, gz, update(t) { TR.update(t); } };
}
SHOTS['3'] = () => {
  const S = highwayWorld(), L = RD.MUTCD.lane;
  const cam = () => ({ pos: [2.5 * L, 2.4, 0], target: [2.2 * L, 4.2, -120], fov: 42 });
  S.info = () => ({ scale: S.scaleNote });
  S.after = () => { const P = S.G.panels[0]; S.scaleNote = [measure(P, { realH: 4.3, dist: 120 - 0.03, label: 'guide panel 4.3 m at 120 m' })]; };
  return { ...S, cam };
};
// M1. gantry pass at 65 mph: 58 m in 2 s, arriving under the sign bridge at &arrive= s (a downbeat)
SHOTS['m1'] = () => {
  const S = highwayWorld(), L = RD.MUTCD.lane, v = 65 * AM.MPH, ta = +(Q.get('arrive') || 1.8);
  const cam = (t) => { const z = S.gz + 0.75 + v * (ta - t); const bob = 0.012 * Math.sin(t * 11) + 0.006 * Math.sin(t * 23);
    return { pos: [2.5 * L, 2.4 + bob, z], target: [2.35 * L, 2.4 + bob + 0.9 + Math.max(0, 40 - (z - S.gz)) * 0.04, z - 60], fov: 50 }; };
  return { ...S, cam };
};

// ------------------------------------------------------------------ shared: flat night ground + river
function nightGround(W, A, lf, { x0 = -3000, x1 = 3000, z0 = 400, z1 = -9000, river = null, color = '#26241f', patch = patchMaterial, wet = 0 } = {}) {
  const g = new THREE.PlaneGeometry(x1 - x0, z0 - z1, 8, 8); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  let m; if (wet) m = RD.wetMaterial(A, lf, null, { color, wet, puddles: 0.45, streak: 1.4 }); else { m = new THREE.MeshStandardMaterial({ color, roughness: 0.95 }); patch(m, lf); }
  const ground = new THREE.Mesh(g, m); ground.userData.noReflect = true; ground.userData.temp = 6; W.scene.add(ground);
  let water = null;
  if (river) { const wg = new THREE.PlaneGeometry(x1 - x0, river[0] - river[1]); wg.rotateX(-Math.PI / 2); wg.translate((x0 + x1) / 2, 0.05, (river[0] + river[1]) / 2);
    water = new THREE.Mesh(wg, RD.wetMaterial(A, lf, null, { color: '#06090c', wet: 1, puddles: 1, streak: 2.2 })); water.userData.noReflect = true; water.userData.temp = 9; W.scene.add(water); }
  return { ground, water };
}

// ------------------------------------------------------------------ 4. the plant at night, 1.2-1.3 km across a rail yard and a river
SHOTS['4'] = () => {
  const W = new World({ shadows: 0, atmos: LOOKS3.PLANT_NIGHT, far: 30000, near: 1 });
  const A = W.atmos; A.reflect({ scale: 0.35 });
  const lf = new LightField(A, { box: [-1400, -2200, 1600, 300], res: 2048, haloPx: 26 });
  nightGround(W, A, lf, { river: [-440, -860] });
  const plant = new CT.Plant(W, lf, { origin: [60, 0, -1300], patch: patchMaterial });
  new CT.RailYard(W, lf, { x0: -600, x1: 700, z: -170, tracks: 11, patch: patchMaterial });
  const st = plant.stacks, bf = { x: 20, z: -1320 };
  new CT.Plumes(A, lf, [
    { x: st[2].x, y: st[2].h, z: st[2].z, size: 8, rise: 240 }, { x: st[0].x, y: st[0].h, z: st[0].z, size: 6, rise: 180 },
    { x: 60 + 290, y: 44, z: -1360, size: 14, rise: 300 },                                   // quench tower
    { x: 60 - 250, y: 125, z: -1470, size: 30, rise: 520 },                                   // the cooling tower: the big white column
    { x: bf.x, y: 90, z: bf.z, size: 7, rise: 140 },
  ], { n: 320, gain: 1 });
  // a far town and the city beyond for skyglow
  A.setTowns([{ x: 200, z: -1300, r: 900, i: 0.35 }, { x: -3000, z: -5000, r: 2500, i: 0.2 }]);
  lf.build(); lf.animated = false;
  const cam = () => ({ pos: [60, 48, 0], target: [60, 190, -1300], fov: 40 });
  const S = { W, A, lf, plant, cam };
  if (Q.get('thermal')) { const TP = new CT.ThermalPass(A, { tMin: -10, tMax: 170 }); S.render = (c, t) => TP.render(c, t); }
  return S;
};

// ------------------------------------------------------------------ 5. skyline from an elevated interchange: five depth rows
SHOTS['5'] = () => {
  const W = new World({ shadows: 0, atmos: LOOKS3.CITY_NIGHT, far: 40000, near: 1 });
  const A = W.atmos; A.reflect({ scale: 0.35 });
  const lf = new LightField(A, { box: [-2500, -8000, 2500, 500], res: 2048, haloPx: 24 });
  nightGround(W, A, lf, { river: [-380, -1000], x0: -6000, x1: 6000, z1: -12000, wet: 0.6, color: '#3a3834' });
  const rows = [
    { z0: -1150, z1: -1500, x0: -260, x1: 260, n: 34, hMin: 18, hMax: 70, lit: 0.22, curtain: 0.2, gain: 0.7 },
    { z0: -1800, z1: -2300, x0: -340, x1: 340, n: 34, hMin: 45, hMax: 130, lit: 0.3, curtain: 0.4, gain: 0.8 },
    { z0: -2600, z1: -3300, x0: -420, x1: 420, n: 46, hMin: 80, hMax: 320, lit: 0.34, curtain: 0.6, peak: { x: 40, w: 260 } },
    { z0: -3900, z1: -5000, x0: -700, x1: 700, n: 60, hMin: 40, hMax: 190, lit: 0.3, curtain: 0.5, peak: { x: -200, w: 400 } },
    { z0: -6000, z1: -8500, x0: -1100, x1: 1100, n: 90, hMin: 25, hMax: 120, lit: 0.28, curtain: 0.4 },
  ];
  const sky = new CT.Skyline(W, lf, rows, { seed: 12 });
  const rampA = new CT.Ramp(W, lf, [[-40, 25, -40], [-14, 22, -150], [14, 18, -270], [60, 14, -390], [220, 10, -480], [600, 8, -520]], { cars: 12, speed: 24, dir: 1, patch: patchMaterial, lampEvery: 40, lampI: 6 });
  const rampB = new CT.Ramp(W, lf, [[520, 8, -200], [150, 9, -215], [-200, 9, -225], [-560, 8, -210]], { cars: 14, speed: 26, dir: 1, patch: patchMaterial, seed: 9, lampEvery: 40, lampI: 6 });
  // street grid lights on the far bank (sodium), clustered, not a lattice
  const r = AM.rng(31);
  for (let i = 0; i < 700; i++) { const z = -1050 - r() * 7000, x = (r() - 0.5) * (300 + Math.abs(z) * 0.3); if (r() < 0.3) continue;
    lf.add({ pos: [Math.round(x / 90) * 90 + (r() - 0.5) * 8, 8, Math.round(z / 90) * 90], color: r() < 0.7 ? AM.SODIUM : AM.LED, i: 1.8, core: 0.3, halo: 0.4, minPx: 1.1, pool: { r: 8, i: 12 } }); }
  // the frontage roads and lots under the interchange: sodium cobra heads, pools on the wet ground
  for (const zz of [-70, -150, -300]) for (let x = -300; x <= 300; x += 38) lf.add({ pos: [x + (r() - 0.5) * 6, 9, zz + (r() - 0.5) * 4], color: AM.SODIUM, i: 2.2, core: 0.3, halo: 0.5, minPx: 1.2, pool: { r: 9, i: 26 } });
  for (let z = -40; z > -360; z -= 36) lf.add({ pos: [-26, 9, z], color: AM.SODIUM, i: 2.2, core: 0.3, halo: 0.5, minPx: 1.2, pool: { r: 9, i: 26 } });
  A.setTowns([{ x: 0, z: -2900, r: 2600, i: 0.5 }, { x: -1500, z: -6000, r: 3500, i: 0.3 }, { x: 1800, z: -4500, r: 2500, i: 0.25 }]);
  lf.build(); lf.animated = true;
  const cam = () => ({ pos: [0, 34, 0], target: [10, -60, -3000], fov: 30 });
  // matte: rows 4 and 5 baked once to a 2x plate at 5 km, projected on a card (Barron's method)
  const S = { W, A, lf, sky, cam, update(t) { rampA.update(t); rampB.update(t); } };
  if (Q.get('matte') !== '0') S.bake = () => { const card = bakeLayer(A, [...sky.meshesOf(3), ...sky.meshesOf(4)], cam(0), { depth: 5200, res: 1.5 }); INFO.plate = card.userData.plate; };
  return S;
};

// ------------------------------------------------------------------ 6. storm front over wheat, from the ground
SHOTS['6'] = () => {
  const strip = [-1500, 700, 250, 200];                                    // the strip the low sun gets through to (0.8-2.2 km)
  const hook = WX.stormHook({});
  const W = new World({ shadows: 0, atmos: { look: LOOKS3.STORM, hook }, far: 90000, near: 0.2 });
  const A = W.atmos;
  const lf = new LightField(A, { box: [-40000, -40000, 40000, 20000], res: 1024, haloPx: 16 });
  const towns = [{ x: 420, z: -1650, pop: 700, r: 380, seed: 3 }];
  const plains = new AM.Plains(W, A, lf, { center: [0, -20000], size: 90000, seg: 420, towns, railZ: -1560, hwyZ: 40000, palette: 'summer', creek: AM.makeCreek({ x0: -9000 }) });
  plains.u.uStrip.value.set(...strip);
  const T = new AM.Towns(W, lf, towns, plains, { lightGain: 0.3 });
  new AM.WindFarm(W, lf, plains, { rows: [{ x0: 5200, z0: -8500, x1: 9800, z1: -11000 }], lit: 0.5 });
  const wheat = new WX.Wheat(A, W, { n: 24000, strip, flashU: plains.u.uFlashG, groundH: (x, z) => plains.h(x, z), yawSlope: 0.6, spread: 0.75 });
  const bolt = new WX.Bolt(A, {});
  lf.build();
  const F = Q.get('bolt') ? +Q.get('bolt') : 0;
  const y0 = plains.h(0, 0) + 1.5;
  const cam = () => ({ pos: [0, y0, 0], target: [60, y0 + 100 * Math.tan(deg(13)), -100], fov: 62 });
  return { W, A, lf, plains, T, wheat, bolt, cam, update(t) {
    const f = F * (t < 0.5 ? 1 : 0);                                       // the lightning frame
    hook.uniforms.uBolt.value.w = f * 0.9; plains.u.uFlashG.value = f * 0.05; bolt.set(f * 60, 62); } };
};

// ------------------------------------------------------------------ boot
await RD.loadHighwayFont().catch(e => console.log('font', e.message));
const S = await SHOTS[SHOT]();
if (S.bake) { S.update?.(0); S.bake(); }
const W = S.W;
if (Q.get('prof')) W.atmos.prof = true;
if (Q.get('fogd') != null) W.atmos.U.uFogD.value = +Q.get('fogd');
if (Q.get('expo') != null) W.atmos.gradeU.uExpo.value = +Q.get('expo');
if (Q.get('haze') != null) W.atmos.U.uHazeGain.value = +Q.get('haze');
W.canvas.id = 'out'; document.body.appendChild(W.canvas);
W.canvas.style.width = '1080px'; W.canvas.style.height = '1920px';

// scale check: render a single object mask and measure its on-screen extent, against the pinhole maths
function measure(obj, { realH, dist, label }) {
  const r = W.renderer, cam = W.camera, sc = W.scene, rt = new THREE.WebGLRenderTarget(W.atmos.w, W.atmos.h);
  const vis = []; sc.traverse(o => { if ((o.isMesh || o.isPoints) && o !== obj) { vis.push([o, o.visible]); o.visible = false; } });
  const mm = obj.material; obj.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  r.setRenderTarget(rt); r.setClearColor(0, 1); r.clear(); r.render(sc, cam); r.setRenderTarget(null);
  const px = new Uint8Array(rt.width * rt.height * 4); r.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, px);
  obj.material = mm; for (const [o, v] of vis) o.visible = v; rt.dispose();
  let y0 = 1e9, y1 = -1, x0 = 1e9, x1 = -1;
  for (let y = 0; y < rt.height; y++) for (let x = 0; x < rt.width; x++) if (px[(y * rt.width + x) * 4] > 127) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  const expect = realH / (2 * Math.tan(cam.fov * Math.PI / 360) * dist) * rt.height;
  return { label, measuredPx: y1 >= 0 ? y1 - y0 + 1 : 0, widthPx: x1 >= 0 ? x1 - x0 + 1 : 0, expectPx: +expect.toFixed(1), realH, dist: +dist.toFixed(1) };
}
window.measure = measure;
// one instance of an InstancedMesh, measured on its own
function measureInstance(im, idx, o) { const m = new THREE.InstancedMesh(im.geometry, im.material, 1); const M = new THREE.Matrix4(); im.getMatrixAt(idx, M); m.setMatrixAt(0, M); m.frustumCulled = false;
  W.scene.add(m); m.updateMatrixWorld(); const r = measure(m, o); W.scene.remove(m); return r; }
function nearestInstance(im, pred = () => true) { const M = new THREE.Matrix4(), p = new THREE.Vector3(), c = W.camera.position; let best = -1, bd = 1e12;
  for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, M); p.setFromMatrixPosition(M); const v = p.clone().sub(c), d = v.length();
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(W.camera.quaternion); if (v.dot(f) / d < Math.cos(W.camera.fov * Math.PI / 360 * 0.5)) continue;
    if (pred(p) && d < bd) { bd = d; best = i; } } M.identity(); if (best >= 0) im.getMatrixAt(best, M); return { idx: best, pos: new THREE.Vector3().setFromMatrixPosition(M), scale: new THREE.Vector3().setFromMatrixScale(M), dist: bd }; }
// the scale checks per shot: measured on screen against the pinhole maths (object height / distance / fov)
window.scaleChecks = () => {
  const out = [];
  const horiz = (p) => { const c = W.camera.position; const f = new THREE.Vector3(0, 0, -1).applyQuaternion(W.camera.quaternion); return p.clone().sub(c).dot(f); };   // depth along the view axis
  try {
    if (S.WF) { const n = nearestInstance(S.WF.towers, p => p.distanceTo(W.camera.position) < 12000);   /* beyond ~12 km a 3 m tower is under a pixel wide */ if (n.idx >= 0) out.push(measureInstance(S.WF.towers, n.idx, { realH: S.WF.hub + 3.5, dist: horiz(n.pos.clone().setY(n.pos.y + S.WF.hub / 2)), label: `wind turbine tower+nacelle ${S.WF.hub + 3.5} m` })); }
    if (S.T) { const n = nearestInstance(S.T.heads); if (n.idx >= 0) out.push(measureInstance(S.T.heads, n.idx, { realH: n.scale.y, dist: horiz(n.pos.clone().setY(n.pos.y + n.scale.y / 2)), label: `elevator headhouse ${n.scale.y.toFixed(1)} m` })); }
    if (S.G) { const P = S.G.panels[0]; out.push(measure(P, { realH: 4.3, dist: horiz(P.position), label: 'guide panel 4.3 m' })); }
    if (S.sky) { const im = S.sky.meshesOf(2)[0]; const n = nearestInstance(im, p => true); if (n.idx >= 0) out.push(measureInstance(im, n.idx, { realH: n.scale.y, dist: horiz(n.pos.clone().setY(n.pos.y + n.scale.y / 2)), label: `row-3 tower tier ${n.scale.y.toFixed(0)} m` })); }
  } catch (e) { out.push({ error: e.message }); }
  for (const o of out) if (o.expectPx) o.errPct = +((o.measuredPx / o.expectPx - 1) * 100).toFixed(1);
  return out;
};
// depth planes: mean display luma of the final frame in near / mid / far thirds of the scene depth, and the sky
window.depthPlanes = () => {
  const A = W.atmos, r = W.renderer, w = A.w, h = A.h;
  const rt = new THREE.WebGLRenderTarget(w, h);
  const mat = new THREE.ShaderMaterial({ uniforms: { tDepth: A.frameU.tDepth, uN: { value: W.camera.near }, uF: { value: W.camera.far } }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: 'uniform sampler2D tDepth; uniform float uN, uF; varying vec2 vUv; void main(){ float d = texture2D(tDepth, vUv).r; if (d >= 1.) { gl_FragColor = vec4(1.); return; } float z = uN*uF / (uF - d*(uF - uN)); float l = log(z/uN) / log(uF/uN); gl_FragColor = vec4(l, fract(l*255.), 0., 0.); }' });
  A.quad.material = mat; r.setRenderTarget(rt); r.render(A.qscene, A.qcam); r.setRenderTarget(null);
  const D = new Uint8Array(w * h * 4); r.readRenderTargetPixels(rt, 0, 0, w, h, D); rt.dispose();
  const gl = r.getContext(), C = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, C);
  const ds = []; for (let i = 0; i < w * h; i++) if (D[i * 4 + 3] < 255) ds.push(D[i * 4] + D[i * 4 + 1] / 255);
  ds.sort((a, b) => a - b); const q1 = ds[Math.floor(ds.length / 3)], q2 = ds[Math.floor(ds.length * 2 / 3)];
  const acc = { near: [0, 0], mid: [0, 0], far: [0, 0], sky: [0, 0] };
  for (let i = 0; i < w * h; i++) { const L = 0.2126 * C[i * 4] + 0.7152 * C[i * 4 + 1] + 0.0722 * C[i * 4 + 2]; let k;
    if (D[i * 4 + 3] === 255) k = 'sky'; else { const v = D[i * 4] + D[i * 4 + 1] / 255; k = v < q1 ? 'near' : v < q2 ? 'mid' : 'far'; } acc[k][0] += L; acc[k][1]++; }
  const res = {}; for (const k in acc) res[k] = acc[k][1] ? { mean: +(acc[k][0] / acc[k][1]).toFixed(1), share: +(acc[k][1] / (w * h)).toFixed(3) } : null;
  return res;
};

window.renderFrame = (t) => {
  const t0 = performance.now();
  S.update?.(t);
  if (S.render) S.render(S.cam(t), t); else W.render(S.cam(t), t);
  { const gl = W.renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  INFO.timings.push(+(performance.now() - t0).toFixed(0));
  INFO.cam = S.cam(t);
  if (S.info) Object.assign(INFO, S.info(t));
  if (W.atmos.stats) INFO.stages = { ...W.atmos.stats };
};
window.renderFrame(0);
if (S.after) S.after();
if (Q.get('lmdbg') && S.lf) { const rt = S.lf.rtL, n = 256, buf = new Uint16Array(n * n * 4);
  const x0 = Math.floor(rt.width / 2 - n / 2); W.renderer.readRenderTargetPixels(rt, x0, x0, n, n, buf);
  let mx = 0, nz = 0; for (let i = 0; i < buf.length; i += 4) { const v = THREE.DataUtils.fromHalfFloat(buf[i]); if (v > mx) mx = v; if (v > 0) nz++; }
  console.log('lightmap centre max', mx, 'nonzero', nz, 'pools', S.lf.poolIdx.length); }
ready = true;
