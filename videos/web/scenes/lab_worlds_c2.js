// LAB WORLDS c2: worlds as BEATS. Each shot is baked once as a relightable plate (relight.js) and plays one light event
// on its hit; only the near layer renders live. Every shot declares its shot card (piece, word, event, hit, value plan,
// looks, depth planes) in CARDS below; the reel driver (videos/scripts/worlds_c2.mjs) writes it next to the renders.
//   ?shot=storm | dusk | night | plant          &n=8 plate samples (1 for a draft)     &hit=1.5 (s, clip time of the event)
//   renderFrame(t, { look: 'raw' | 'STORM_MONO' | 'BROADSIDE' | 'SERIGRAPH' | 'SODIUM' | 'NOTAN', word: true })
import * as THREE from 'three';
import { World } from '../lib/fx/world3d.js';
import { LOOKS3, LightField, patchMaterial } from '../lib/fx/atmos3d.js';
import { CloudVolume } from '../lib/fx/clouds3d.js';
import * as AM from '../lib/fx/americana.js';
import * as C2 from '../lib/fx/americana_c2.js';
import { Relight, Channel, strikeEnvelope, channelEnvelope } from '../lib/fx/relight.js';
import { Looks } from '../lib/fx/looks.js';
import * as CD from '../lib/fx/cards.js';
import * as CT from '../lib/fx/americana_city.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const Q = new URLSearchParams(location.search);
const SHOT = Q.get('shot') || 'storm', NS = +(Q.get('n') || 8), HIT = +(Q.get('hit') ?? 1.5);
const INFO = { shot: SHOT, timings: [] };
window.shotInfo = () => INFO;
const deg = d => d * Math.PI / 180;
const LK = (name) => JSON.parse(JSON.stringify(LOOKS3[name]));
const V = (...a) => new THREE.Vector3(...a);

// ------------------------------------------------------------------ shot cards (brief C: judge the world as a beat)
export const CARDS = {
  storm: { piece: 'COMMON WEALTH', word: 'SMALL FARMERS.', event: 'the strike: a 3-branch channel behind the elevator, 4 return strokes, a hard cool key that throws the elevator\'s shadow toward camera; its beacon GOES RED on the next frame and holds',
    hit: 'song 3.00 s (b8: thunder + stomp + tom) = clip frame 45 (audio window 1.5-4.5 s)',
    values: 'ONE lit band: the sun slot under the shelf, across the mid-field to the elevator. Near wheat in cloud shadow (held 1-1.5 stops under, S <= .45, rimmed by the slot). The tower held as a dark mass (burned 1.5 stops) that carries the word. Horizon dissolved in a haze band.',
    looks: ['raw', 'STORM_MONO', 'BROADSIDE'], planes: 'near wheat 1-90 m (live) | lit band + elevator 300-520 m | rain land 1-6 km | shelf base 0.6-1.2 km up | tower' },
  dusk: { piece: 'COMMON WEALTH', word: 'SMALL FARMERS.', event: 'the pickup\'s headlights come on as the sun catches its dust', hit: 'clip 1.0 s',
    values: 'Land 1-2 stops under the horizon sky; the lit band is the horizon; the near subject is the pivot span on a diagonal at 40-120 m; five field albedos by quarter section.',
    looks: ['raw', 'SERIGRAPH'], planes: 'pivot span 40-120 m | quarter sections 0.2-3 km | town + elevator 5-9 km | 2 cloud layers' },
  night: { piece: 'COMMON WEALTH', word: 'THE NEXT TOWN.', event: 'the elevator floods come on in sequence and the deck brightens over the yard', hit: 'clip 0.5 s (flood 1), +4 frames per flood',
    values: 'Kuindzhi: ONE lit band (the yard and main street), everything else held within a stop of black but not at black; the deck a continuous ceiling lit from below over the yard.',
    looks: ['raw', 'SODIUM'], planes: 'yard + trucks + worker 250-420 m | town 0.6-2 km | deck 450-700 m up | far towns on the horizon' },
  plant: { piece: 'COMMON WEALTH / PRODUCTIVE', word: 'STEELWORKERS.', event: 'the tap flare lights the faces from the world side', hit: 'song 6.00 s',
    values: 'The crew fills the lower 2/3; the hero stack and the cooling-tower plume, lit from below, fill the top; water and yard cropped out.',
    looks: ['raw', 'NOTAN', 'THERMAL'], planes: 'crew 2-8 m | catwalk | stack + plume 300-700 m | Hades rows 1-7 km' },
};
INFO.card = CARDS[SHOT];

// ------------------------------------------------------------------ STORM: the flagship (COMMON WEALTH, SMALL FARMERS.)
function storm() {
  const look = LK('STORM_AD'); if (Q.get('sun')) look.sun.dir = Q.get('sun').split(',').map(Number);
  const W = new World({ shadows: 0, atmos: { look, samples: +(Q.get('msaa') ?? 4) }, far: 90000, near: 0.3 });
  const A = W.atmos;
  const lf = new LightField(A, { box: [-6000, -8000, 6000, 1000], res: 2048, haloPx: 16 });
  const f = V(0.62, 0, -0.78).normalize(), lat = V(-f.z, 0, f.x);                 // the view azimuth and its right
  const eD = +(Q.get('ed') || 430), eP = f.clone().multiplyScalar(eD);              // the elevator, in the slot, ~430 m out
  // the lit band: the sun gets through under the shelf across the mid-field to the elevator (z band around it)
  const sb = (Q.get('strip') || '28,520,40').split(',').map(Number), sz0 = f.z * sb[0], sz1 = f.z * sb[1];
  const strip = [(sz0 + sz1) / 2, Math.abs(sz1 - sz0) / 2, sb[2], 25];      // the lit band: z from the far wheat to past the elevator
  const plains = new AM.Plains(W, A, lf, { center: [0, -20000], size: 90000, seg: 420, towns: [], railZ: eP.z - 60, hwyZ: 40000, palette: 'summer', creek: AM.makeCreek({ x0: -9000 }), detail: 2 });
  plains.u.uStrip.value.set(...strip);
  const gy = plains.h(eP.x, eP.z);
  const EL = new C2.Elevator(W, lf, { at: [eP.x, gy, eP.z], yaw: -deg(18), silo: { d: 9.4, h: 36, rows: 2, per: 5 }, head: { w: 13, d: 13, h: 50 }, annex: 3 });
  new AM.Farmsteads(W, lf, plains, { rect: [-9000, -9000, 9000, -2500], share: 0.5, lightGain: 0.6 });
  new AM.WindFarm(W, lf, plains, { points: AM.ridgeSites(plains, [3000, -12000, 12000, -6000], { n: 10, seed: 5 }), lit: 0.5 });
  // the strike: behind the elevator and right of it, under the shelf base
  const gP = eP.clone().addScaledVector(f, +(Q.get('bd') || 1250)).addScaledVector(lat, +(Q.get('bl') || 60));
  const ch = new Channel(A, { top: [gP.x + 120, 760, gP.z - 180], ground: [gP.x, plains.h(gP.x, gP.z), gP.z], seed: +(Q.get('bseed') || 11), branches: 3, width: +(Q.get('bw') || 0.7), glow: +(Q.get('bgw') || 8) });
  lf.build();
  const shelf = new CloudVolume(A, { kind: 'shelf', edge: { z0: -1350, curve: 2.2e-5, h: 560, base: 1150 }, tower: { b0: 6000, top: 11500, halfW: 18000 }, rain: { dens: 0.05, z0: -3800, th: 0.5 },
    scale: 1 / 2200, detail: 1 / 520, erode: 0.28, sigma: 0.024, keyGain: 0.62, ms: 0.05, ambTop: ['#8a9cc0', 0.42], ambBot: ['#262c36', 0.07], albedo: ['#e8e4dc', 0.95],
    bake: true, res: +(Q.get('cres') || 0.5), far: 45000, key: 'sun' });
  const wheat = new C2.NearWheat(A, W, { n: +(Q.get('wn') || 16000), near: 1.0, far: 95, awnR: 20, spread: 0.72, yaw: Math.atan2(f.x, -f.z), strip: plains.u.uStrip, groundH: (x, z) => plains.h(x, z),
    gust: 1, alb: Q.get('walb') ? '#' + Q.get('walb') : '#8a7850', sat: 0.4, rim: { dir: [f.x, 0.04, f.z], color: '#ffcf8a', k: +(Q.get('rk') || 0.35) } });
  EL.occluders.forEach((o, i) => { wheat.U.uOccC.value[i].set(...o.c); wheat.U.uOccH.value[i].set(...o.h); }); wheat.U.uOccN.value = EL.occluders.length;
  const beacon = new C2.Beacon(A, EL.lampAt.toArray(), { size: 2.4, color: [1, 0.72, 0.4], i: 0.6 });
  // ---- the relight rig
  const R = new Relight(A, { clouds: [shelf] }); R.live(wheat.mesh);
  const Lp = V(...ch.at(+(Q.get('ku') || 0.9)));                                                     // the channel's lower third: the key's origin
  const fdir = Lp.clone().sub(EL.foot).normalize();                                // toward the light, from the subject
  const key = A.key, hemi = W._hemi, save = {};
  const rig = (on) => { if (on) { save.kp = key.position.clone(); save.kc = key.color.clone(); save.ki = key.intensity; save.hi = hemi ? hemi.intensity : 0; save.lg = lf.U.uLightGain.value;
      save.st = plains.u.uStrip.value.clone(); save.at = shelf.U.uAmbTop.value.clone(); save.ab = shelf.U.uAmbBot.value.clone(); save.kf = shelf.keyFrom; }
    else { key.position.copy(save.kp); key.color.copy(save.kc); key.intensity = save.ki; if (hemi) hemi.intensity = save.hi; lf.U.uLightGain.value = save.lg;
      plains.u.uStrip.value.copy(save.st); shelf.U.uAmbTop.value.copy(save.at); shelf.U.uAmbBot.value.copy(save.ab); shelf.keyFrom = save.kf; shelf.flash([0, 0, 0], 0); } };
  const FI = +(Q.get('fi') || 9), FC = +(Q.get('fc') || 1);
  R.layer('flash', { clouds: true, shadow: { dir: fdir.toArray(), max: 520, thick: 120 },
    set: k => { if (!save.on) { rig(true); save.on = true; }
      key.position.copy(fdir).multiplyScalar(1000); key.color.set('#d8e4ff'); key.intensity = k * FI; if (hemi) hemi.intensity = 0; lf.U.uLightGain.value = 0;
      plains.u.uStrip.value.set(0, 1e9, 1, 0); shelf.keyFrom = { dir: [0, 1, 0], color: '#000000', k: 0 }; shelf.U.uAmbTop.value.setRGB(0, 0, 0); shelf.U.uAmbBot.value.setRGB(0, 0, 0);
      shelf.flash([...ch.at(0.05)].map((v, i) => i === 1 ? v + 180 : v), k * FC, +(Q.get('fr') || 1100), +(Q.get('fd') || 700)); },
    done: () => { if (save.on) { rig(false); save.on = false; } } });
  const red = new THREE.PointLight('#ff2010', 0, +(Q.get('rd') || 38), 1.6); red.position.copy(EL.lampAt); W.scene.add(red);
  R.layer('red', { set: k => { if (!save.on2) { save.on2 = true; save.rk = key.intensity; save.rh = hemi ? hemi.intensity : 0; save.rl = lf.U.uLightGain.value; }
      key.intensity = 0; if (hemi) hemi.intensity = 0; lf.U.uLightGain.value = 0; red.intensity = k * +(Q.get('ri') || 9000); },
    done: () => { red.intensity = 0; if (save.on2) { key.intensity = save.rk; if (hemi) hemi.intensity = save.rh; lf.U.uLightGain.value = save.rl; save.on2 = false; } } });
  // the value plan (brief B): the tower burned to a dark mass that carries the word; the far rain land held down
  R.plan = [
    { kind: 'sky', y0: -0.2, y1: +(Q.get('burn') || 0.36), feather: 0.1, gain: +(Q.get('bg') || 0.32), sat: 0.55 },
    { kind: 'sky', y0: -0.2, y1: 0.16, feather: 0.08, gain: 0.55, sat: 0.4 },
    { kind: 'dist', d0: 1400, d1: 1e5, feather: 0.4, gain: 0.72, sat: 0.7 },
  ];
  // ---- the event on the hit
  A.on('lightning', (age) => { const k = age === Infinity ? 0 : strikeEnvelope(age, 0), c = age === Infinity ? 0 : channelEnvelope(age, 0);
    R.w.flash = k; ch.set(c * +(Q.get('bi') || 40)); wheat.U.uFlash.value = k * +(Q.get('wf') || 1.2); wheat.U.uFlashDir.value.copy(Lp).sub(A.camera.position).normalize();
    const redOn = age !== Infinity && age >= 1 / 30 - 1e-4; R.w.red = redOn ? 1 : 0; wheat.U.uRed.value = redOn ? 1 : 0;
    beacon.set(redOn ? 3.2 : 0.6, redOn ? [1, 0.1, 0.05] : [1, 0.72, 0.4]); });
  W.event('lightning', HIT);
  const cam0 = V(0, plains.h(0, 0) + 1.55, 0), push = +(Q.get('push') || 2.2), pitch = deg(+(Q.get('pitch') || 8.5));
  const cam = (t) => { const u = Math.min(1, Math.max(0, t / 3)), e = u * u * (3 - 2 * u) * 0.6 + u * 0.4;
    const p = cam0.clone().addScaledVector(f, push * e); p.y += 0.25 * e;
    const tg = p.clone().addScaledVector(f, 400); tg.y = p.y + 400 * Math.tan(pitch);
    return { pos: p.toArray(), target: tg.toArray(), fov: +(Q.get('fov') || 58) }; };
  INFO.subject = { elevator: { at: EL.foot.toArray().map(Math.round), dist: eD, headH: 57 }, bolt: { ground: gP.toArray().map(Math.round), key: Lp.toArray().map(Math.round) } };
  const classify = (s) => s === Infinity ? 'far' : s < 120 ? 'ground' : s < eD + 140 ? 'subject' : 'far';
  return { W, A, R, lf, cam, EL, wheat, ch, shelf, classify, planes: { near: [1, 95], subject: [eD - 60, eD + 90], far: [1400, 60000] }, word: { text: Q.get('word') || 'SMALL FARMERS.', y: 0.2, size: 118 } };
}


// ------------------------------------------------------------------ DUSK: Moore's windmill-height view, a road to the sun, a pickup's lit dust (LIT AS ONE.)
function dusk() {
  const look = LK('PLAINS_DUSK_AD');
  const W = new World({ shadows: 0, atmos: { look, samples: +(Q.get('msaa') ?? 4) }, far: 90000, near: 2 });
  const A = W.atmos;
  const railZ = -2600;
  const towns = AM.layoutTowns({ railZ, x0: -70000, x1: -3000, seed: 5, seatAt: -16000, first: -6500 });
  const lf = new LightField(A, { box: [-60000, -30000, 12000, 30000], res: 4096, haloPx: 22 });
  const plains = new AM.Plains(W, A, lf, { center: [-25000, 0], size: 90000, seg: 520, towns, railZ, hwyZ: -12000, creek: AM.makeCreek({ x0: -9500 }), detail: 2 });
  // five field albedos by quarter: the pivot wheat with its harvested sector and wet arc, dryland strips (stubble / fallow),
  // row corn, soy, and the fifth: the pivot's own wet sector
  const cam0 = V(+(Q.get('cx') || -150), 0, +(Q.get('cz') || -120)); cam0.y = plains.h(cam0.x, cam0.z) + +(Q.get('alt') || 60);
  const f = V(-0.97, 0, 0.24).normalize(), ahead = cam0.clone().addScaledVector(f, +(Q.get('span') || 105));
  const pq = plains.force(0, -400, -400, 0.2, +(Q.get('crop') || 0.7));
  const a = Math.atan2(ahead.z - pq.cz, ahead.x - pq.cx), hq = (((a - Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / 15;
  const piv = plains.force(0, -400, -400, hq, +(Q.get('crop') || 0.7));
  plains.force(1, -1200, -400, 0.55, 0.62); plains.force(2, -1200, 400, 0.8, 0.4); plains.force(3, -400, 400, 0.78, 0.2);
  const rig = new AM.PivotRig(W, lf, plains, { x: piv.cx, z: piv.cz, angle: piv.arm });
  const T = new AM.Towns(W, lf, towns, plains, { lightGain: 0.5, structured: true });
  new AM.Farmsteads(W, lf, plains, { rect: [-40000, -20000, 8000, 16000], avoid: towns, lightGain: 0.5 });
  new AM.WindFarm(W, lf, plains, { points: AM.ridgeSites(plains, [-40000, -16000, -12000, 12000], { n: 60, seed: 4 }), lightGain: 0.45 });
  lf.build(); lf.U.uLightGain.value = look.lightGain ?? 1; A.setTowns(T.glow(0.4));
  const key = { dir: [-1, -0.03, -0.18], color: '#ffa060', k: 1.1 };
  const lo = new CloudVolume(A, { kind: 'layer', profile: 'stratus', y0: 1500, y1: 2000, cover: +(Q.get('cov1') || 0.5), scale: 1 / 5200, detail: 1 / 600, erode: 0.4, sigma: 0.04,          // stratocumulus: big cells, lit edges
    ambTop: ['#6a70a8', 0.1], ambBot: ['#40303e', 0.04], keyGain: 0.9, ms: 0.08, bake: true, res: 0.5, far: 30000, key, wind: [4, 1] });
  const hi = new CloudVolume(A, { kind: 'layer', profile: 'stratus', y0: 5200, y1: 5500, cover: +(Q.get('cov2') || 0.12), scale: 1 / 2600, detail: 1 / 420, erode: 0.5, sigma: 0.025,          // altocumulus above: small cells, rosy
    ambTop: ['#8a84c0', 0.12], ambBot: ['#5a4058', 0.05], keyGain: 0.8, ms: 0.1, bake: true, res: 0.5, far: 40000, key, wind: [6, 2] });
  // the pickup on the E-W gravel road (the section line z = 0), heading into the sun
  const PU = new C2.Pickup(W, A, { road: { a: [-3000, 0], b: [500, 0] }, speed: 13, s0: +(Q.get('pu') || 2560), groundH: (x, z) => plains.h(x, z), dust: { len: 90, w: 10, h: 9, col: '#ffb070', k: 1.6 } });
  const R = new Relight(A, { clouds: [lo, hi] }); R.live(rig.mesh, PU.group);
  R.plan = [{ kind: 'ground', y0: 0, y1: 1.2, feather: 0.02, gain: +(Q.get('lg') || 0.6), sat: 0.78 }, { kind: 'sky', y0: -0.2, y1: 1, feather: 0.02, gain: 0.92, sat: 0.72 }];
  A.on('lights', age => { PU.lights = age === Infinity ? 0 : Math.min(1, age * 30 / 2); });
  W.event('lights', HIT);
  const pitch = deg(+(Q.get('pitch') || 11)), drift = +(Q.get('drift') || 4);
  const right = V(-f.z, 0, f.x);
  const cam = (t) => { const p = cam0.clone().addScaledVector(right, drift * t).addScaledVector(f, 1.5 * t); const tg = p.clone().addScaledVector(f, 1000); tg.y = p.y - 1000 * Math.tan(pitch);
    return { pos: p.toArray(), target: tg.toArray(), fov: +(Q.get('fov') || 56) }; };
  const classify = (s) => s === Infinity ? 'sky' : s < 400 ? 'ground' : s < 2500 ? 'mid' : 'far';
  INFO.subject = { pivot: { cx: Math.round(piv.cx), cz: Math.round(piv.cz), arm: +piv.arm.toFixed(3) }, cam0: cam0.toArray().map(Math.round) };
  return { W, A, R, cam, classify, bakeT: 1, over: 1.12, update: t => { PU.lights = t >= HIT ? Math.min(1, (t - HIT) * 15 + 0.3) : 0; PU.update(t); }, word: { text: 'LIT AS ONE.', y: 0.2, size: 120 }, tonal: { SERIGRAPH: ['ground', 'mid', 'far'] } };
}

// ------------------------------------------------------------------ NIGHT: Kuindzhi's one lit band + Crewdson's set: the elevator yard comes on (THE NEXT TOWN.)
function night() {
  const look = LK('PLAINS_NIGHT_AD'); look.exposure = +(Q.get('ex') || 1.9); look.deck.light = +(Q.get('gl') || 0.008); look.deck.dens = 0.0003;
  const W = new World({ shadows: 0, atmos: { look, samples: +(Q.get('msaa') ?? 2) }, far: 90000, near: 1 });
  const A = W.atmos;
  const railZ = -3900, yardZ = -+(Q.get('yz') || 460);
  const towns = [{ x: -300, z: -3600, pop: 1600, r: 520, seed: 3, seat: true }, { x: 3200, z: -3700, pop: 700, r: 380, seed: 5 }, { x: -5200, z: -3700, pop: 900, r: 420, seed: 7 }];
  const lf = new LightField(A, { box: [-8000, -12000, 8000, 800], res: 4096, haloPx: 20 });
  const plains = new AM.Plains(W, A, lf, { center: [0, -20000], size: 90000, seg: 460, towns, railZ, hwyZ: -30000, palette: 'night', creek: AM.makeCreek({ x0: 6000 }), detail: 2 });
  const H = (x, z) => plains.h(x, z);
  const T = new AM.Towns(W, lf, towns, plains, { lightGain: 0.8, structured: true });
  new AM.Farmsteads(W, lf, plains, { rect: [-20000, -30000, 20000, -1000], avoid: towns, share: 0.22, lightGain: 0.7 });
  const ex = 30, EL = new C2.Elevator(W, lf, { at: [ex, H(ex, yardZ), yardZ], yaw: 0, silo: { d: 9.4, h: 36, rows: 2, per: 5 }, head: { w: 13, d: 13, h: 50 }, annex: 3, letters: ['FARMERS', 'CO-OP'] });
  // the yard's floods: four masts, each a flood group (a light layer), switched on in sequence on the hit
  const floods = [[-40, yardZ + 55, 22], [60, yardZ + 60, 22], [120, yardZ + 20, 24], [0, yardZ + 20, 26]].map(([x, z, h], k) => {
    const i0 = lf.lights.length;
    lf.add({ pos: [x, H(x, z) + h, z], color: k % 2 ? AM.LED : AM.SODIUM, i: 10, core: 0.8, halo: 0.9, pool: { r: 30, i: +(Q.get('fi') || 2.5) } });
    lf.add({ pos: [x + 6, H(x, z) + h, z - 4], color: k % 2 ? AM.LED : AM.SODIUM, i: 7, core: 0.6, halo: 0.6, pool: { r: 22, i: +(Q.get('fi') || 2.5) * 0.6 } });
    return [i0, i0 + 1]; });
  // the queue: five grain trucks on the county road into the scale, tails to camera, their headlights pooling ahead
  const trucks = [0, 1, 2, 3, 4].map(k => { const z = yardZ + 95 + k * 24, x = 8 + k * 1.2; const tk = C2.grainTruck(W, lf, { x, z, y: H(x, z), yaw: Math.PI, color: ['#7a1a12', '#1e3a6a', '#6a6a6a', '#7a1a12', '#2a4a2a'][k] });
    for (const p of tk.tails) lf.add({ pos: p, color: '#ff2010', i: 2.2, core: 0.15, halo: 0.5, minPx: 1.4 });
    lf.add({ pos: [x, H(x, z - 18) + 1.3, z - 16], color: '#fff0d8', i: 0, core: 0, halo: 0, pool: { r: 6, i: 9 } }); return tk; });
  const man = C2.worker(W, lf, { x: 22, z: yardZ + 70, y: H(22, yardZ + 70), yaw: 0.6 });
  lf.build(); lf.U.uLightGain.value = look.lightGain ?? 1; lf.animated = false;
  const fIdx = floods.flat();
  // the dryer: a tower dryer venting steam, the plume lit from below by the yard (it brightens as the floods come on)
  const dx = 110, dz = yardZ - 10; const dry = new THREE.Mesh(new THREE.BoxGeometry(6, 28, 6).translate(0, 14, 0), patchMaterial(new THREE.MeshStandardMaterial({ color: '#8a8e92', roughness: 0.5, metalness: 0.5 }), lf, { wallFall: 20 }));
  dry.position.set(dx, H(dx, dz), dz); W.scene.add(dry);
  new CD.PlumeCards(A, lf, [{ x: dx, y: H(dx, dz) + 28, z: dz, w: 34, h: 90, bend: 0.75, seed: 9, heat: 40, gain: 1.1 }], { below: 2.2, keys: ['#ffcfa0', 0.05] });
  const deck = new CloudVolume(A, { kind: 'layer', profile: 'stratus', y0: 480, y1: 760, cover: +(Q.get('dc') || 0.9), scale: 1 / 3000, detail: 1 / 420, erode: 0.3, sigma: 0.022,
    ambTop: ['#202840', 0.01], ambBot: ['#4a3428', +(Q.get('da') || 0.3)], keyGain: 0, below: +(Q.get('db') || 0.06), lod: 7, march: false, bake: true, res: 0.5, far: 30000, wind: [2, 0.6] });
  A.setTowns(T.glow(0.5));
  const R = new Relight(A, { clouds: [deck] });
  const setF = (g, k) => C2.lfSwitch(lf, floods[g], k);
  for (let g = 0; g < 4; g++) setF(g, 0);
  // layers: floods 1+2, 3, 4 (the ground, the elevator, the trucks) and the deck over the yard (all four, the cloud re-marched)
  const groups = [[0, 1], [2], [3]];
  groups.forEach((gs, li) => R.layer('flood' + li, { set: k => { for (const g of gs) setF(g, k); }, done: () => { for (const g of gs) setF(g, 0); } }));
  R.layer('deck', { clouds: true, set: k => { for (let g = 0; g < 4; g++) setF(g, k); deck.U.uAmbTop.value.multiplyScalar(k ? 1 : 1); }, done: () => { for (let g = 0; g < 4; g++) setF(g, 0); } });
  R.plan = [{ kind: 'ground', y0: 0.62, y1: 1.2, feather: 0.06, gain: +(Q.get('fg') || 3), sat: 0.8 }];      // the near fields: within a stop of black, not at it
  const seq = [0, 4, 8]; A.on('floods', age => {                                                            // on the hit, 4 frames apart; sprites live, pools relit
    const f = age === Infinity ? -1 : Math.round(age * 30);
    groups.forEach((gs, li) => { const on = f >= seq[li] ? Math.min(1, 0.55 + 0.15 * (f - seq[li])) : 0; R.w['flood' + li] = on; for (const g of gs) setF(g, on); });
    R.w.deck = f < 0 ? 0 : Math.min(1, (f + 1) / 14); });
  W.event('floods', HIT);
  const cam0 = V(+(Q.get('cx') || -20), H(-20, 0) + +(Q.get('alt') || 42), 0), pitch = deg(+(Q.get('pitch') || 5.5));
  const cam = (t) => { const p = cam0.clone(); p.z -= 1.2 * t; p.x += 0.8 * t; const tg = p.clone().add(V(0.05 * 1000, 0, -1000)); tg.y = p.y - 1000 * Math.tan(pitch);
    return { pos: p.toArray(), target: tg.toArray(), fov: +(Q.get('fov') || 50) }; };
  const classify = (s, x, y) => s === Infinity ? 'sky' : s < -yardZ - 150 ? 'ground' : s < -yardZ + 160 ? 'subject' : 'far';
  INFO.subject = { elevator: EL.foot.toArray().map(Math.round), yardZ, trucks: trucks.length };
  return { W, A, R, cam, classify, over: 1.04, bakeT: 1, word: { text: 'THE NEXT TOWN.', y: 0.17, size: 112 }, tonal: { SODIUM: ['ground', 'far'] } };
}

// ------------------------------------------------------------------ PLANT PLATE: the world behind the crew, reframed (a hero stack and the cooling-tower plume lit from below,
// no river, no yard), with the flare event baked as a light layer. The crew (folk_worlds.js KITS.plant) composites over it.
function plantplate() {
  const W = new World({ shadows: 0, atmos: LK('PLANT_NIGHT_AD'), far: 30000, near: 1 });
  const A = W.atmos;
  const lf = new LightField(A, { box: [-3000, -7000, 3200, 400], res: 4096, haloPx: 26 });
  const g = new THREE.PlaneGeometry(14000, 16000, 8, 8); g.rotateX(-Math.PI / 2); g.translate(0, 0, -6000);
  const gm = new THREE.MeshStandardMaterial({ color: '#26241f', roughness: 0.95 }); patchMaterial(gm, lf); const ground = new THREE.Mesh(g, gm); ground.userData.temp = 6; W.scene.add(ground);
  const plant = new CT.Plant(W, lf, { origin: [60, 0, -1300], patch: patchMaterial });
  for (const m of plant.parts) if (m.name === 'stack' || m.name === 'stack band') m.userData.tempGrad = { y0: 0, y1: 150, t0: 30, t1: m.userData.temp };
  for (const m of plant.parts) if (m.name === 'furnace' || m.name === 'furnace B') m.userData.tempGrad = { y0: 0, y1: 90, t0: 240, t1: 70 };
  const rows = [
    { z: -1750, x0: -1600, x1: 1800, hMax: 95, seed: 5, lit: 1.0, temp: [18, 60] }, { z: -2200, x0: -2000, x1: 2300, hMax: 110, seed: 6, temp: [15, 55] },
    { z: -2800, x0: -2600, x1: 2600, hMax: 120, seed: 7, lit: 0.9, temp: [12, 45] }, { z: -3500, x0: -3200, x1: 3200, hMax: 130, seed: 8, lit: 0.8, cooling: false, temp: [10, 35] },
    { z: -4400, x0: -3800, x1: 4000, hMax: 140, seed: 9, lit: 0.7, temp: [8, 30] }, { z: -5600, x0: -4800, x1: 4800, hMax: 150, seed: 10, lit: 0.6, cooling: false, temp: [6, 20] } ];
  const H = new CD.SilhouetteRows(W, A, lf, rows, { kind: 'plant', ppm: 2.2, lightGain: 1.4, body: '#101216', edge: '#8a7058', edgeGain: 0.05 });
  const keys = [[-900, 30, -1150, 60, 60, -1300, '#ffd8a8', 9e4], [900, 25, -1180, 100, 50, -1350, '#ffc890', 7e4]];
  for (const [x, y, z, tx, ty, tz, c, i] of keys) { const L = new THREE.SpotLight(c, i, 0, 0.32, 0.8, 2); L.position.set(x, y, z); L.target.position.set(tx, ty, tz); W.scene.add(L, L.target); }
  const st = plant.stacks, ct = plant.cooling;
  // the flare: a derrick right of the stacks; its flame is a light layer (the plant, the steam and, in the kit, the men)
  const fx = 330, fz = -1150, fh = 95;
  const der = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, fh, 8).translate(0, fh / 2, 0), patchMaterial(new THREE.MeshStandardMaterial({ color: '#4a4640', roughness: 0.6, metalness: 0.6 }), lf)); der.position.set(fx, 0, fz); W.scene.add(der);
  const fl = new THREE.PointLight('#ff8a30', 0, 900, 1.4); fl.position.set(fx, fh + 8, fz); W.scene.add(fl);
  const fi0 = lf.lights.length; lf.add({ pos: [fx, fh + 8, fz], color: '#ff9a40', i: 60, core: 5, halo: 1, pool: { r: 200, i: +(Q.get('fp') || 2.5) } });
  const src = [
    { x: st[0].x, y: st[0].h, z: st[0].z, w: 46, h: 130, bend: 0.7, seed: 3, heat: 70 }, { x: st[1].x, y: st[1].h, z: st[1].z, w: 40, h: 110, bend: 0.75, seed: 5, heat: 60 },
    { x: st[2].x, y: st[2].h, z: st[2].z, w: 52, h: 140, bend: 0.6, seed: 8, heat: 90 },
    { x: ct.x, y: ct.h, z: ct.z, w: 220, h: 420, bend: 0.5, spread: 0.75, base: 0.2, seed: 11, heat: 35, gain: 1.3 },
    { x: fx, y: fh + 6, z: fz, w: 30, h: 70, bend: 0.8, seed: 21, heat: 300, gain: 0.6 } ];
  new CD.PlumeCards(A, lf, src, { gain: 1, below: 1.6, keys: ['#ffcfa0', 0.25] });
  A.setTowns([{ x: 200, z: -1300, r: 900, i: 0.35 }, { x: -3000, z: -5000, r: 2500, i: 0.25 }]);
  lf.build(); lf.animated = false;
  C2.lfSwitch(lf, [fi0], 0.12);                                                            // the flare idles low; the hit is the flare opening up
  const R = new Relight(A, { clouds: [] });
  R.layer('flare', { set: k => { fl.intensity = k * +(Q.get('fl') || 6e4); C2.lfSwitch(lf, [fi0], 0.12 + k); }, done: () => { fl.intensity = 0; C2.lfSwitch(lf, [fi0], 0.12); } });
  A.on('flare', age => { R.w.flare = age === Infinity ? 0 : 1; }); W.event('flare', HIT);
  const cp = (Q.get('pc') || '140,34,-420,-40,120,-1400,46').split(',').map(Number);
  const cam = () => ({ pos: cp.slice(0, 3), target: cp.slice(3, 6), fov: cp[6] });
  const S = { W, A, R, cam, classify: s => s === Infinity ? 'sky' : 'far' };
  if (Q.get('thermal')) { const TP = new CT.ThermalPass(A, { tMin: -30, tMax: 200, v2: true }); S.thermal = () => TP.render(cam(0), 0); }
  INFO.subject = { stacks: st.map(q => [Math.round(q.x), Math.round(q.z), q.h]), cooling: [ct.x, ct.z, ct.h], flare: [fx, fh, fz] };
  return S;
}

// ------------------------------------------------------------------ boot
const S = { storm, dusk, night, plantplate }[SHOT]();
const W = S.W;
const out = document.createElement('canvas'); out.width = 1080; out.height = 1920; out.id = 'out';
out.style.width = '1080px'; out.style.height = '1920px'; document.body.appendChild(out);
const ctx = out.getContext('2d');
try { const f = new FontFace('Ovp', 'url(../assets/fonts/overpass-latin-900-normal.woff2)'); document.fonts.add(await f.load()); } catch (e) { console.log('font', e.message); }

const tb = performance.now();
S.update?.(0); S.R.bake(S.cam(S.bakeT || 0), S.bakeT || 0, { n: NS, nLayer: Math.max(1, Math.round(NS / 2)), over: S.over || 1 });
INFO.bake = { ...S.R.stats, wallMs: Math.round(performance.now() - tb), n: NS };
console.log('bake', JSON.stringify(INFO.bake));

let lk = null;
const baseLook = { ...W.atmos.look };
function drawWord(g, t, { ink = '#efe7d6', shadow = true } = {}) {
  const w = S.word; if (!w || t < HIT - 1e-4) return;
  g.save(); g.font = `900 ${w.size}px Ovp`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.translate(540, w.y * 1920); g.scale(0.84, 1);
  if (shadow) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillText(w.text, 4, 5); }
  g.fillStyle = ink; g.fillText(w.text, 0, 0); g.restore();
}
window.renderFrame = (t, o = {}) => {
  const look = o.look || Q.get('look') || 'raw', t0 = performance.now();
  if (look === 'STORM_MONO') { if (W.atmos.look.sat !== 0) W.atmos.setLook(LK('STORM_MONO')); }
  else if (W.atmos.look.sat === 0 && SHOT === 'storm') W.atmos.setLook(LK('STORM_AD'));
  if (look === 'THERMALPLATE' && S.thermal) { S.thermal(); ctx.drawImage(W.canvas, 0, 0, 1080, 1920); return; }
  S.update?.(t); S.R.render(S.cam(t), t);
  if (look === 'raw' || look === 'STORM_MONO') { ctx.drawImage(W.canvas, 0, 0, 1080, 1920); if (o.word !== false) drawWord(ctx, t, look === 'STORM_MONO' ? { ink: '#f2efe8' } : {}); }
  else { lk ||= new Looks(); S.auxC ||= S.R.aux(S.classify, { near: 1, far: 20000 });
    lk.source({ color: W.canvas, aux: S.auxC, depth: [1, 20000], tonal: (S.tonal && S.tonal[look]) || ['ground', 'far'], rankCut: false }, { aux: 1 });
    if (S.levels?.[look]) lk.lv = S.levels[look]; else { (S.levels ||= {})[look] = lk._levels(); }   // levels held from the first frame: the flash must not auto-level away
    lk.apply(ctx, look, t, { imp: Looks.impactFrame(t, HIT, 3) });
    if (o.word !== false) { const imp = Looks.impactFrame(t, HIT, 3); drawWord(ctx, t, { ink: imp && look === 'BROADSIDE' ? '#efe6d2' : look === 'BROADSIDE' ? '#23160f' : '#15110e', shadow: false }); } }
  INFO.timings.push(Math.round(performance.now() - t0)); INFO.stats = { ...S.R.stats };
  INFO.cam = S.cam(t);
};
window.__lab = { W, S };
window.renderFrame(0);
ready = true;
