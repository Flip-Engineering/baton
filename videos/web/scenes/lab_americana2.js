// LAB AMERICANA 2 (WORLDS studio c1, pass 2): the c1 kit plus the art-direction layer: painted depth ramps, the horizon
// dissolve, lit ground-fog decks, Nubis-lite cloud volumes, Hades silhouette cards, baked plumes, surface grain at the
// camera's scale, structured light and events on the beat. Same shot names as lab_americana.js.
//   ?shot=1 plains aerial, dusk (120 m)     ?shot=2 plains at night (300 m, stratus deck)   ?shot=3 interstate gantry, rain
//   ?shot=4 plant at night                  ?shot=5 skyline                                 ?shot=6 storm front over wheat
//   ?shot=m1 gantry pass (&arrive=s)        ?shot=m2 plains crane 400 -> 150 m through the deck
//   &thermal=1 (4): FLIR   &bolt=1 (6): the lightning frame   &mono=1 (6): the Dobrowner mono plate
//   &grade=cw|otf|horde|prod|civ: the piece's own grade (the in-piece swap)
import * as THREE from 'three';
import { World } from '../lib/fx/world3d.js';
import { LOOKS3, LightField, patchMaterial } from '../lib/fx/atmos3d.js';
import { CloudVolume } from '../lib/fx/clouds3d.js';
import * as AM from '../lib/fx/americana.js';
import * as RD from '../lib/fx/americana_road.js';
import * as CT from '../lib/fx/americana_city.js';
import * as WX from '../lib/fx/weather.js';
import * as CD from '../lib/fx/cards.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const Q = new URLSearchParams(location.search);
const SHOT = Q.get('shot') || '1';
const INFO = { shot: SHOT, timings: [] };
window.shotInfo = () => INFO;
const SHOTS = {};
const deg = d => d * Math.PI / 180;
const LK = (name) => { const L = LOOKS3[name]; if (!L) throw new Error('look ' + name); return JSON.parse(JSON.stringify(L)); };

// ------------------------------------------------------------------ 1. plains aerial at dusk, 120 m, a pivot and an elevator in the foreground
SHOTS['1'] = () => {
  const look = LK('PLAINS_DUSK_AD');
  const W = new World({ shadows: 0, atmos: { look, samples: 4 }, far: 90000, near: 2 });
  const A = W.atmos;
  const railZ = -120;
  const towns = AM.layoutTowns({ railZ, x0: -70000, x1: 6000, seed: 5, seatAt: -21000, first: -1800 });
  const lf = new LightField(A, { box: [-60000, -30000, 12000, 30000], res: 4096, haloPx: 22 });
  const plains = new AM.Plains(W, A, lf, { center: [-25000, 0], size: 90000, seg: 520, towns, railZ, hwyZ: -9000, creek: AM.makeCreek({ x0: -6500 }), detail: 2 });
  const piv = plains.force(0, -700, 420, 0.2094, 0.3);                                 // arm across the view (north)                                  // the pivot under the camera's look
  plains.force(1, -1500, 1200, 0.2, 0.62); plains.force(2, -2400, 400, 0.55, 0.9); plains.force(3, -600, -300, 0.75, 0.4);
  new AM.PivotRig(W, lf, plains, { x: piv.cx, z: piv.cz, angle: piv.arm });
  const T = new AM.Towns(W, lf, towns, plains, { lightGain: 0.5, structured: true });
  new AM.Farmsteads(W, lf, plains, { rect: [-40000, -20000, 8000, 16000], avoid: towns, lightGain: 0.5 });
  const sites = AM.ridgeSites(plains, [-40000, -16000, -9000, 12000], { n: 70, seed: 4 });
  const WF = new AM.WindFarm(W, lf, plains, { points: sites, lightGain: 0.45 });
  const TR = new AM.Traffic(lf, [{ a: [-90000, 0, -9016], b: [20000, 0, -9016], n: 40, speed: 29, dir: 1 }, { a: [-90000, 0, -8984], b: [20000, 0, -8984], n: 40, speed: 29, dir: -1 },
    { a: [-3 * AM.SECTION, 0, -30000], b: [-3 * AM.SECTION, 0, 20000], n: 1, speed: 22, dir: 1 }], { heightFn: (x, z) => plains.h(x, z), truckShare: 0.6, headI: 0.9, tailI: 0.5 });
  lf.build(); lf.animated = true; lf.U.uLightGain.value = look.lightGain ?? 1;
  A.setTowns(T.glow(0.4));
  new CloudVolume(A, { kind: 'layer', profile: 'cumulus', y0: 2600, y1: 3400, cover: 0.44, scale: 1 / 1900, detail: 1 / 300, erode: 0.5, sigma: 0.045,   // an altocumulus field: many cells, lit bases, lavender bodies
    ambTop: ['#6a6ab0', 0.2], ambBot: ['#6a4058', 0.1], keyGain: 0.8, ms: 0.07, bake: true, res: 0.5, far: 16000, key: { dir: [-1, -0.03, -0.18], color: '#ffa060', k: 1.1 }, wind: [4, 1] });
  const cx = piv.cx + 298, cz = piv.cz + 31, y0 = plains.h(cx, cz) + 72;          // Dirt Meridian: 72 m up, the arm crossing 150-300 m out
  const cam = () => ({ pos: [cx, y0, cz], target: [cx - 3000 * 0.98, y0 - 3060 * Math.tan(deg(9.5)), cz - 3000 * 0.19], fov: 62 });
  return { W, A, lf, plains, T, WF, TR, cam, update(t) { WF.update(t); TR.update(t); } };
};

// ------------------------------------------------------------------ 2. plains at night, 300 m, under a stratus deck lit by the towns
function nightPlains({ camY = 300 } = {}) {
  const look = LK('PLAINS_NIGHT_AD');
  const W = new World({ shadows: 0, atmos: look, far: 90000, near: 2 });
  const A = W.atmos;
  const railZ = -1400, hwyZ = -6200;
  const towns = AM.layoutTowns({ railZ, x0: -70000, x1: 12000, seed: 8, seatAt: -1500, first: -1800 });
  const lf = new LightField(A, { box: Q.get('shot') === 'm2' ? [-26000, -22000, 14000, 14000] : [-14000, -10000, 5000, 6000], res: 4096, haloPx: 22 });   // ~4 m texels: pools at their real size
  const plains = new AM.Plains(W, A, lf, { center: [-25000, -5000], size: 100000, seg: 460, towns, railZ, hwyZ, creek: AM.makeCreek({ x0: -6500 }), detail: 2 });
  const T = new AM.Towns(W, lf, towns, plains, { lightGain: 1, structured: true });
  const F = new AM.Farmsteads(W, lf, plains, { rect: [-60000, -30000, 12000, 20000], avoid: towns, share: 0.22 });
  const WF = new AM.WindFarm(W, lf, plains, { points: AM.ridgeSites(plains, [-45000, -26000, -6000, 14000], { n: 90, seed: 9, minDist: 460 }), lit: 0.4 });
  // the interchange where the interstate meets the county seat's road: four 30 m high masts, six luminaires each
  const seat = towns.find(t => t.seat) || towns[0];
  for (const [dx, dz] of [[-160, -60], [160, -60], [-160, 60], [160, 60]]) { const x = seat.x + dx, z = hwyZ + dz;
    lf.add({ pos: [x, plains.h(x, z) + 30, z], color: AM.SODIUM, i: 26, core: 1.2, halo: 0.9, pool: { r: 70, i: 60 } }); }
  for (let z = railZ - 80; z > hwyZ + 80; z -= 90) lf.add({ pos: [seat.x + 12, plains.h(seat.x, z) + 9, z], color: AM.SODIUM, i: z > railZ - 900 ? 3 : 0, core: 0.4, halo: 0.5, pool: z > railZ - 900 ? { r: 9, i: 30 } : null });
  const TR = new AM.Traffic(lf, [
    { a: [-90000, 0, hwyZ - 16], b: [20000, 0, hwyZ - 16], n: 70, speed: 31, dir: 1 }, { a: [-90000, 0, hwyZ + 16], b: [20000, 0, hwyZ + 16], n: 70, speed: 31, dir: -1 },
    ...[-3, -9, -14].map(k => ({ a: [k * AM.SECTION, 0, -30000], b: [k * AM.SECTION, 0, 20000], n: 1, speed: 22, dir: k % 2 ? 1 : -1 })),
    { a: [seat.x + 8, 0, railZ - 40], b: [seat.x + 8, 0, hwyZ + 30], n: 2, speed: 20, dir: 1 }], { heightFn: (x, z) => plains.h(x, z), truckShare: 0.6, headI: 1.4, tailI: 0.7 });
  AM.flare(lf, -21000, plains.h(-21000, 9000), 9000, { i: 22 }); AM.flare(lf, -38000, plains.h(-38000, -18000), -18000, { i: 18 });
  lf.build(); lf.animated = true; lf.U.uLightGain.value = look.lightGain ?? 1;
  const deck = new CloudVolume(A, { kind: 'layer', profile: 'stratus', y0: 560, y1: 820, cover: 0.74, scale: 1 / 2600, detail: 1 / 380, erode: 0.35, sigma: 0.02,
    ambTop: ['#202840', 0.01], ambBot: ['#141820', 0.004], keyGain: 0, below: 0.12, lod: 7,  march: false, bake: Q.get('shot') === '2', res: Q.get('shot') === '2' ? 0.5 : 0.34, far: 40000, wind: [2, 0.6] });
  return { W, A, lf, plains, T, F, WF, TR, deck, update(t) { WF.update(t); TR.update(t); } };
}
SHOTS['2'] = () => {
  const P = nightPlains();
  const cam = () => ({ pos: [300, 280, 400], target: [-7892, -683, -5336], fov: 56 });
  return { ...P, cam };
};
// M2. plains crane: 2 s from 400 m to 150 m through the lit deck (560-820 m -> here lowered to 200-330 m), past a turbine
SHOTS['m2'] = () => {
  const P = nightPlains();
  const D = P.deck.U; D.uSlab.value.x = 215; D.uSlab.value.y = 345; D.uShape.value.z = 0.72; D.uBelow.value = 0.4; D.uAmbTop.value.multiplyScalar(3);   // the deck the camera descends through, lit by the county seat
  const k0 = [1200, 430, 600], k1 = [1080, 150, 520], dir = [-0.83, -0.55], right = [0.55, -0.83];
  // one turbine 200 m ahead and 90 m right of the descent: its rotor sweeps past as the camera drops through hub height
  const tx = 1140 + 200 * dir[0] + 90 * right[0], tz = 560 + 200 * dir[1] + 90 * right[1];
  const WF2 = new AM.WindFarm(P.W, P.lf, P.plains, { points: [[tx, tz]], lit: 1, windDir: 1.2, rpm: 15 });
  const cam = (t) => { const u = Math.min(1, Math.max(0, t / 2)), e = u * u * (3 - 2 * u);
    const p = k0.map((v, i) => v + (k1[i] - v) * e); return { pos: p, target: [p[0] + dir[0] * 6000, p[1] - 700 + 500 * e, p[2] + dir[1] * 6000], fov: 56 }; };
  return { ...P, cam, update(t) { P.update(t); WF2.update(t); } };
};

// ------------------------------------------------------------------ 3. interstate: a sign bridge with mass, a horizon (overpass, trees, far town), rain
function highwayWorld() {
  const W = new World({ shadows: 0, atmos: { look: LK('HIGHWAY_RAIN_AD'), samples: 4 }, far: 16000, near: 0.3 });
  const A = W.atmos; A.reflect({ scale: 0.4 });
  const lf = new LightField(A, { box: [-2200, -7000, 2200, 300], res: 4096, haloPx: 34 });
  const hl = new RD.Headlights(W);
  const lit = RD.patchLit(hl);
  const hw = new RD.Highway(W, A, lf, hl, { patch: lit, z0: 250, z1: -2600 });
  const L = RD.MUTCD.lane, xm = hw.xm, gz = -120;
  // &legend=otf | type: the piece's own words on the panel, at MUTCD scale (TYPE c2: type in the world, lit by the headlights)
  const LEG = { otf: [{ x: 1.5 * L + 0.2, w: 11.0, h: 4.3, shield: { num: '80', h: 1.55, x: 1.55, y: 1.2 }, lines: [{ text: 'WEST', cap: 0.46, y: 0.62, x: 2.7, align: 'left' }, { text: 'Millions', cap: 0.46, y: 2.55 }] },
      { x: 3.5 * L + 0.3, w: 6.4, h: 4.3, lines: [{ text: 'EXIT', cap: 0.46, y: 0.35 }, { text: '2036', cap: 0.9, y: 1.25 }, { text: 'NEXT RIGHT', cap: 0.3, y: 3.05 }] }],
    type: [{ x: 2.5 * L, w: 13.5, h: 4.9, lines: [{ text: 'WE OWN', cap: 1.1, y: 0.55 }, { text: 'TOMORROW', cap: 1.1, y: 2.75 }] }] };
  const G = new RD.Gantry(W, A, lf, hl, { z: gz, x0: xm - 4.6, x1: hw.W + RD.MUTCD.shoulderR + 7.3, patch: lit, mass: true, panels: LEG[Q.get('legend')] || [
    { x: 1.5 * L + 0.2, w: 11.0, h: 4.3, shield: { num: '80', h: 1.55, x: 1.55, y: 1.2 },
      lines: [{ text: 'WEST', cap: 0.46, y: 0.62, x: 2.7, align: 'left' }, { text: 'Des Moines', cap: 0.46, y: 2.55 }] },
    { x: 3.5 * L + 0.3, w: 6.4, h: 4.3, lines: [{ text: 'EXIT 2036', cap: 0.3, y: 0.3 }, { text: 'Tomorrow', cap: 0.46, y: 1.35 }, { text: '1/2 MILE', cap: 0.3, y: 2.75 }] },
  ] });
  for (const P of G.panels) P.material.uniforms.uSheet.value = 1;
  new RD.Roadside(W, A, lf, { hw, patch: lit, CD });
  const truck = new RD.Truck(W, A, lf, hl, { x: 1.5 * L, z: -58, patch: lit });
  const xo = xm - 0.45 - RD.MUTCD.shoulderL;
  const TR = new AM.Traffic(lf, [
    { a: [3.5 * L, 0, 200], b: [3.5 * L, 0, -2600], n: 3, speed: 31, dir: 1 }, { a: [0.5 * L, 0, 200], b: [0.5 * L, 0, -2600], n: 3, speed: 33, dir: 1 },
    ...[0, 1, 2, 3].map(k => ({ a: [xo - (k + 0.5) * L, 0, -2600], b: [xo - (k + 0.5) * L, 0, 260], n: 7, speed: 30, dir: 1 })),
  ], { seed: 21, headI: 5, tailI: 1.6, truckShare: 0.3, pool: true });
  new RD.Rain(A, lf, hl, { count: 9000 });
  A.setTowns([{ x: 380, z: -5200, r: 2600, i: 0.7 }, { x: -2500, z: -11000, r: 5000, i: 0.5 }]);   // the rain cloud takes the towns' sodium
  lf.build(); lf.animated = true;
  return { W, A, lf, hl, hw, G, truck, TR, gz, update(t) { TR.update(t); } };
}
SHOTS['3'] = () => {
  const S = highwayWorld(), L = RD.MUTCD.lane;
  const cam = () => ({ pos: [2.5 * L, 2.4, 0], target: [2.2 * L, 4.2, -120], fov: 42 });
  return { ...S, cam };
};
// M1. gantry pass: 2 s at 65 mph with the horizon locked (no tilt to follow the sign); the bridge leaves over the top of the
// frame in the last ~10 frames; camera motion blur (180 deg shutter)
SHOTS['m1'] = () => {
  const S = highwayWorld(), L = RD.MUTCD.lane, v = 65 * AM.MPH, ta = +(Q.get('arrive') || 1.97);
  S.A.motionBlur = 0.5;
  const cam = (t) => { const z = S.gz + 0.9 + v * (ta - t); const bob = 0.012 * Math.sin(t * 11) + 0.006 * Math.sin(t * 23);
    return { pos: [2.5 * L, 2.4 + bob, z], target: [2.35 * L, 2.4 + bob + 60 * Math.tan(deg(4)), z - 60], fov: 50 }; };
  return { ...S, cam };
};

// ------------------------------------------------------------------ shared: flat night ground + river
function nightGround(W, A, lf, { x0 = -3000, x1 = 3000, z0 = 400, z1 = -9000, river = null, color = '#26241f', wet = 0, streak = 2.2 } = {}) {
  const g = new THREE.PlaneGeometry(x1 - x0, z0 - z1, 8, 8); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  let m; if (wet) m = RD.wetMaterial(A, lf, null, { color, wet, puddles: 0.45, streak: 1.4 }); else { m = new THREE.MeshStandardMaterial({ color, roughness: 0.95 }); patchMaterial(m, lf); }
  const ground = new THREE.Mesh(g, m); ground.userData.noReflect = true; ground.userData.temp = 6; W.scene.add(ground);
  let water = null;
  if (river) { const wg = new THREE.PlaneGeometry(x1 - x0, river[0] - river[1]); wg.rotateX(-Math.PI / 2); wg.translate((x0 + x1) / 2, 0.05, (river[0] + river[1]) / 2);
    water = new THREE.Mesh(wg, RD.wetMaterial(A, lf, null, { color: '#05070a', wet: 1, puddles: 1, streak })); water.userData.noReflect = true; water.userData.temp = 9; W.scene.add(water); }
  return { ground, water };
}

// ------------------------------------------------------------------ 4. the plant at night: hero geometry + 9 Hades rows + Link keys + white plumes
SHOTS['4'] = () => {
  const W = new World({ shadows: 0, atmos: LK('PLANT_NIGHT_AD'), far: 30000, near: 1 });
  const A = W.atmos; A.reflect({ scale: 0.35 });
  const lf = new LightField(A, { box: [-3000, -7000, 3200, 400], res: 4096, haloPx: 26 });
  nightGround(W, A, lf, { river: [-420, -880], x0: -6000, x1: 6000, z1: -14000, streak: 3.2 });
  const plant = new CT.Plant(W, lf, { origin: [60, 0, -1300], patch: patchMaterial });
  for (const m of plant.parts) if (m.name === 'stack' || m.name === 'stack band') m.userData.tempGrad = { y0: 0, y1: 150, t0: 30, t1: m.userData.temp };
  for (const m of plant.parts) if (m.name === 'furnace' || m.name === 'furnace B') m.userData.tempGrad = { y0: 0, y1: 90, t0: 240, t1: 70 };
  new CT.RailYard(W, lf, { x0: -700, x1: 800, z: -170, tracks: 11, patch: patchMaterial });
  // Hades rows behind and beside the hero mass: drafted refinery silhouettes, hazed by the ramp at their own depth
  const rows = [
    { z: -980, x0: -1500, x1: -380, hMax: 70, seed: 3, lit: 1.1, temp: [20, 60] }, { z: -1050, x0: 820, x1: 1900, hMax: 80, seed: 4, lit: 1.1, temp: [20, 70] },
    { z: -1750, x0: -1600, x1: 1800, hMax: 95, seed: 5, lit: 1.0, temp: [18, 60] }, { z: -2200, x0: -2000, x1: 2300, hMax: 110, seed: 6, temp: [15, 55] },
    { z: -2800, x0: -2600, x1: 2600, hMax: 120, seed: 7, lit: 0.9, temp: [12, 45] }, { z: -3500, x0: -3200, x1: 3200, hMax: 130, seed: 8, lit: 0.8, cooling: false, temp: [10, 35] },
    { z: -4400, x0: -3800, x1: 4000, hMax: 140, seed: 9, lit: 0.7, temp: [8, 30] }, { z: -5600, x0: -4800, x1: 4800, hMax: 150, seed: 10, lit: 0.6, cooling: false, temp: [6, 20] },
    { z: -7200, x0: -6200, x1: 6200, hMax: 150, seed: 11, lit: 0.5, ppm: 1.2, cooling: false, temp: [5, 12] } ];
  const H = new CD.SilhouetteRows(W, A, lf, rows, { kind: 'plant', ppm: 2.2, lightGain: 1.4, body: '#101216', edge: '#8a7058', edgeGain: 0.05 });
  // Link: off-camera keys rake the structure (steel reads by its edges), one floods the steam from below
  const keys = [[-900, 30, -1150, 60, 60, -1300, '#ffd8a8', 9e4], [900, 25, -1180, 100, 50, -1350, '#ffc890', 7e4], [-160, 15, -1330, -190, 140, -1470, '#fff0d8', 2e4]];   // raking, low, from the sides
  for (const [x, y, z, tx, ty, tz, c, i] of keys) { const L = new THREE.SpotLight(c, i, 0, 0.32, 0.8, 2); L.position.set(x, y, z); L.target.position.set(tx, ty, tz); W.scene.add(L, L.target); }
  const st = plant.stacks, ct = plant.cooling;
  const src = [
    { x: st[0].x, y: st[0].h, z: st[0].z, w: 46, h: 130, bend: 0.7, seed: 3, heat: 70 }, { x: st[1].x, y: st[1].h, z: st[1].z, w: 40, h: 110, bend: 0.75, seed: 5, heat: 60 },
    { x: st[2].x, y: st[2].h, z: st[2].z, w: 52, h: 140, bend: 0.6, seed: 8, heat: 90 },
    { x: ct.x, y: ct.h, z: ct.z, w: 200, h: 360, bend: 0.5, spread: 0.75, base: 0.2, seed: 11, heat: 35, gain: 1.2 },           // the cooling tower: the big white column
    { x: 60 + 290, y: 44, z: -1360, w: 60, h: 160, bend: 0.8, seed: 13, heat: 80 },                                   // quench tower
    ...H.stacks.filter((s, i) => s.row < 5 && i % 2 === 0).map((s, i) => ({ x: s.x, y: s.y, z: s.z, w: 26, h: 80, bend: 0.8, seed: 20 + i, heat: 50, gain: 0.8 })),
    ...H.coolers.filter(c => c.row < 6).map((c, i) => ({ x: c.x, y: c.y, z: c.z, w: c.w * 1.6, h: c.w * 3, bend: 0.6, spread: 0.75, base: 0.2, seed: 40 + i, heat: 30 })) ];
  new CD.PlumeCards(A, lf, src, { gain: 1, below: 1.3, keys: ['#ffcfa0', 0.25] });
  A.setTowns([{ x: 200, z: -1300, r: 900, i: 0.35 }, { x: -3000, z: -5000, r: 2500, i: 0.25 }]);
  lf.build(); lf.animated = false;
  const cam = () => ({ pos: [60, 42, 0], target: [40, 150, -1300], fov: 40 });
  const S = { W, A, lf, plant, H, cam };
  if (Q.get('thermal')) { const TP = new CT.ThermalPass(A, { tMin: -30, tMax: 200, v2: true }); S.render = (c, t) => TP.render(c, t); }
  return S;
};

// ------------------------------------------------------------------ 5. skyline from an elevated interchange: 2 rows in geometry, 5 Hades rows, a landmark
SHOTS['5'] = () => {
  const W = new World({ shadows: 0, atmos: LK('CITY_NIGHT_AD'), far: 40000, near: 1 });
  const A = W.atmos; A.reflect({ scale: 0.35 });
  const lf = new LightField(A, { box: [-2500, -9000, 2500, 500], res: 4096, haloPx: 24 });
  nightGround(W, A, lf, { river: [-380, -1000], x0: -8000, x1: 8000, z1: -16000, wet: 0.6, color: '#3a3834', streak: 3.4 });
  new CT.Skyline(W, lf, [
    { z0: -1150, z1: -1500, x0: -260, x1: 260, n: 34, hMin: 18, hMax: 70, lit: 0.22, curtain: 0.2, gain: 0.7 },
    { z0: -1800, z1: -2300, x0: -340, x1: 340, n: 34, hMin: 45, hMax: 130, lit: 0.3, curtain: 0.4, gain: 0.8 } ], { seed: 12 });
  new CD.SilhouetteRows(W, A, lf, [
    { z: -2700, x0: -520, x1: 560, hMin: 70, hMax: 330, peakAt: 0.55, seed: 31, lit: 1.0, landmark: { x: 590, h: 360 } },
    { z: -3300, x0: -800, x1: 900, hMin: 60, hMax: 260, peakAt: 0.35, seed: 32, lit: 0.9 },
    { z: -4200, x0: -1200, x1: 1300, hMin: 40, hMax: 200, peakAt: 0.6, seed: 33, lit: 0.8, ppm: 1.8 },
    { z: -5600, x0: -1800, x1: 1900, hMin: 25, hMax: 150, seed: 34, lit: 0.7, ppm: 1.4 },
    { z: -7600, x0: -2600, x1: 2700, hMin: 15, hMax: 110, seed: 35, lit: 0.6, ppm: 1.0 } ],
    { kind: 'city', ppm: 2.4, body: '#121218', edge: '#b0a090', edgeGain: 0.06, lightGain: 1.1 });
  const pl = { color: '#ff9a3c', i: Q.get('pieri') != null ? +Q.get('pieri') : 2.4, fall: Q.get('pierf') != null ? +Q.get('pierf') : 1.3 };   // a pool at the head, black by the foot
  const rampA = new CT.Ramp(W, lf, [[-40, 25, -40], [-14, 22, -150], [14, 18, -270], [60, 14, -390], [220, 10, -480], [600, 8, -520]], { cars: 12, speed: 24, dir: 1, patch: patchMaterial, lampEvery: 40, lampI: 6, pierLight: pl });
  const rampB = new CT.Ramp(W, lf, [[520, 8, -200], [150, 9, -215], [-200, 9, -225], [-560, 8, -210]], { cars: 14, speed: 26, dir: 1, patch: patchMaterial, seed: 9, lampEvery: 40, lampI: 6, pierLight: pl });
  const r = AM.rng(31);
  for (let i = 0; i < 700; i++) { const z = -1050 - r() * 7000, x = (r() - 0.5) * (300 + Math.abs(z) * 0.3); if (r() < 0.3) continue;
    lf.add({ pos: [Math.round(x / 90) * 90 + (r() - 0.5) * 8, 8, Math.round(z / 90) * 90], color: r() < 0.7 ? AM.SODIUM : AM.LED, i: 1.8, core: 0.3, halo: 0.4, minPx: 1.1, pool: { r: 8, i: 12 } }); }
  for (const zz of [-70, -150, -300]) for (let x = -300; x <= 300; x += 38) lf.add({ pos: [x + (r() - 0.5) * 6, 9, zz + (r() - 0.5) * 4], color: AM.SODIUM, i: 2.2, core: 0.3, halo: 0.5, minPx: 1.2, pool: { r: 9, i: 26 } });
  A.setTowns([{ x: 0, z: -2900, r: 2600, i: 0.5 }, { x: -1500, z: -6000, r: 3500, i: 0.3 }, { x: 1800, z: -4500, r: 2500, i: 0.25 }]);
  lf.build(); lf.animated = true;
  const cam = () => ({ pos: [0, 34, 0], target: [10, -60, -3000], fov: 30 });
  return { W, A, lf, cam, update(t) { rampA.update(t); rampB.update(t); } };
};

// ------------------------------------------------------------------ 6. storm front over wheat: a volumetric shelf cloud, a sunlit stake, lightning that lights things
SHOTS['6'] = () => {
  const look = LK(Q.get('mono') ? 'STORM_MONO' : 'STORM_AD');
  const W = new World({ shadows: 0, atmos: { look, samples: 4 }, far: 90000, near: 0.2 });
  const A = W.atmos;
  const lf = new LightField(A, { box: [-6000, -8000, 6000, 1000], res: 2048, haloPx: 16 });
  const strip = [-1400, 900, 300, 200];
  const towns = [{ x: 620, z: -2600, pop: 700, r: 380, seed: 3 }];
  const plains = new AM.Plains(W, A, lf, { center: [0, -20000], size: 90000, seg: 420, towns, railZ: -2520, hwyZ: 40000, palette: 'summer', creek: AM.makeCreek({ x0: -9000 }), detail: 2 });
  plains.u.uStrip.value.set(...strip);
  const T = new AM.Towns(W, lf, towns, plains, { lightGain: 0.3, structured: true });
  new AM.Farmsteads(W, lf, plains, { rect: [-3000, -3000, 3000, -500], share: 0.9, lightGain: 0.6 });       // the stake: a farmstead in the sun slot
  new AM.WindFarm(W, lf, plains, { points: AM.ridgeSites(plains, [3000, -12000, 12000, -6000], { n: 14, seed: 5 }), lit: 0.5 });
  const wheat = new WX.Wheat(A, W, { n: 15000, strip, flashU: plains.u.uFlashG, groundH: (x, z) => plains.h(x, z), yawSlope: 0.25, spread: 0.9, heads: 2, gust: 1, sunNear: 90, far: 80 });
  const bolt = new WX.Bolt(A, { top: [1900, 800, -5600], ground: [1700, 0, -5400] });
  lf.build();
  const shelf = new CloudVolume(A, { kind: 'shelf', edge: { z0: -1350, curve: 2.2e-5, h: 560, base: 1150 }, tower: { b0: 6000, top: 11500, halfW: 18000 }, rain: { dens: 0.05, z0: -3800, th: 0.5 },
    scale: 1 / 2200, detail: 1 / 520, erode: 0.28, sigma: 0.024, keyGain: 0.62, ms: 0.05, ambTop: ['#8a9cc0', 0.42], ambBot: ['#262c36', 0.07], albedo: ['#e8e4dc', 0.95],
    bake: true, res: 0.5, far: 45000, key: 'sun' });
  // lightning: an event. The flash lights the cloud from inside (a point in the volume), the land and the wheat, for 2 frames
  A.on('lightning', (age) => { const k = age < 0.07 ? 1 : age < 0.14 ? 0.35 : 0; shelf.flash([1800, 1300, -5200], k * 7, 1100, 650); plains.u.uFlashG.value = k * 0.08; bolt.set(k * 60, 62); });
  if (Q.get('bolt')) W.event('lightning', 0);
  const y0 = plains.h(0, 0) + 1.5;
  const cam = () => ({ pos: [0, y0, 0], target: [80, y0 + 100 * Math.tan(deg(22.5)), -100], fov: 62 });
  return { W, A, lf, plains, wheat, bolt, shelf, cam };
};

// ------------------------------------------------------------------ boot
await RD.loadHighwayFont().catch(e => console.log('font', e.message));
const S = await SHOTS[SHOT]();
if (S.bake) { S.update?.(0); S.bake(); }
const W = S.W;
if (Q.get('prof')) W.atmos.prof = true;
if (Q.get('nodeck')) { const L2 = { ...W.atmos.look }; delete L2.deck; W.atmos.setLook(L2); }
if (Q.get('look')) W.atmos.setLook(LK(Q.get('look')));                  // a piece's own grade on this world (the in-piece swap)
if (Q.get('expo') != null) W.atmos.gradeU.uExpo.value = +Q.get('expo');
W.canvas.id = 'out'; document.body.appendChild(W.canvas);
W.canvas.style.width = '1080px'; W.canvas.style.height = '1920px';

// depth planes: mean display luma of near / mid / far thirds of the scene depth, and the sky
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
// the horizon row on screen (for the softness check): a point 60 km out along the view azimuth
function horizonRow() { const c = W.camera, f = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion); f.y = 0; f.normalize();
  const p = c.position.clone().addScaledVector(f, 60000); p.y = 0; p.project(c); return Math.round((1 - (p.y * 0.5 + 0.5)) * 1920); }

window.renderFrame = (t) => {
  const t0 = performance.now();
  S.update?.(t);
  if (S.render) S.render(S.cam(t), t); else W.render(S.cam(t), t);
  { const gl = W.renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  INFO.timings.push(+(performance.now() - t0).toFixed(0));
  INFO.cam = S.cam(t); INFO.horizonY = horizonRow();
  if (S.info) Object.assign(INFO, S.info(t));
  if (W.atmos.stats) INFO.stages = { ...W.atmos.stats };
};
window.renderFrame(0);
if (S.after) S.after();
window.__lab = { W, S };      // LOOKS c1: read-only handle for the looks source bake (videos/scripts/looks_bake.mjs)
ready = true;
