// LAB / WORLDS3D: 3D worlds for the ACP shorts, cut to the productive() track (140 BPM, 70 beats).
//   b0-8    MONUMENT AT DAWN   sdf 'monument', LOOKS.DAWN: stele, ring gate, terraces of figures, avenue of obelisks, fog + shafts
//   b8-20   THE FORTRESS       sdf 'fortress', LOOKS.NOON: board-formed keep, the mark, wet plaza, workers in dark coats, a hero at 18 m
//   b20-24  THE FRONTIER       sdf compose(kit.*): terrain, a keep on a ridge pad, obelisks, a red tower crane, a marching column; rig.path
//   b24-32  THE HALL           sdf 'hall': nave, wet floor mirroring the doorway, volumetric shafts, workers on the aisle
//   b32-48  THE CITY           three.js City (archetypes, wet streets, reflections) + an SDF stele and ring (depth handoff); dusk -> night wave
//   b48-56  MONUMENT, RED SUN  same world, LOOKS.RED_SUN: black silhouettes, cream rims, the ring ignites
//   b56-60  THE MARCH          three.js Terrain + skinned Figures (people.js) column over a ridge, rig.crane
//   b60-64  FORTRESS, SODIUM   same world, LOOKS.SODIUM_NIGHT, the mark lit red
//   b64-70  closer
import { W, H, C, loadFonts, loadBeats, loadImage, clamp, lerp, ease, line, closer, outCanvas, Finish } from '../lib/kit.js';
import { SDF, LOOKS, kit, compose } from '../lib/fx/sdf.js';
import { World, City, Terrain, Figures, SDFLayer, applyLook, rig, handheld, glow } from '../lib/fx/world3d.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('lab_worlds3d');
const logo = await loadImage('../assets/acp_logo.png');
const Q = new URLSearchParams(location.search);
const SC = +(Q.get('s') || 0.4);
const PROF = !!Q.get('prof');
const AA = Q.get('aa') !== '0';                                   // ?aa=0: no edge supersampling (about -30% per SDF frame)
const DBG = Q.get('dbg') ? (m) => console.log(`${m} ${Math.round(performance.now())}ms`) : () => {};

// every SDF world compiles on first use (SwiftShader compiles are slow on a shared box; a stills run only pays for what it shows)
const SDFS = [];
const lazy = (make) => { let v = null; return () => v || (v = (SDFS.push(v = make()), PROF && (v.profile = true), v.render(0, {}), v.sync(), DBG('compiled'), v)); };
const fort = lazy(() => new SDF({ world: 'fortress', scale: SC, decal: logo , aa: AA }));
const hall = lazy(() => new SDF({ world: 'hall', scale: SC * 0.9 , aa: AA }));      // volumetrics: the priciest march
const mon = lazy(() => new SDF({ world: 'monument', scale: SC , aa: AA }));
// THE FRONTIER: composed from parts, not a hand-written world
const FW = compose([
  kit.terrain({ amp: 70, scale: 0.0036, pads: [[0, 0, 100, 24]], seed: 5, flat: [0.3, 0.27, 0.2], rock: [0.4, 0.35, 0.3] }),
  kit.keep({ pos: [0, 24, -20], size: [30, 26, 26], mark: true }),
  kit.obelisks({ pos: [0, 24, 0], n: 4, x: 22, z0: 50, spacing: 28, h: 24 }),
  kit.silos({ pos: [-62, 24, -34], list: [[0, 0, 7, 40], [14, -10, 6, 48], [-4, -18, 5, 30]] }),
  kit.crane({ pos: [48, 24, -34], h: 74, jib: 46, rotY: 2.3 }),
  kit.wall({ pos: [0, 24, -70], size: [110, 18, 5] }),
  kit.crowd({ rect: [-9, 44, 9, 150], y: 24, cell: [3, 3.4], heading: 0, speed: 1.3 }),
], { wet: 0, clouds: 1 });
const front = lazy(() => new SDF({ world: FW, scale: SC, decal: logo , aa: AA }));
// the plaza monument for the city, handed to three.js with its depth
const PW = compose([
  kit.plinth({ r0: 12, step: 4, rise: 2.2, n: 4 }),
  kit.stele({ pos: [0, 11, 0], w: 8, h: 150, d: 3.6, mark: true }),
  kit.ring({ pos: [0, 104, -10], r: 42, teeth: 20, width: 7, thick: 2.6 }),
], { ground: false, defines: { FAR: 2400, STEPS: 72, SHSTEPS: 14 } });
const plaza = new SDF({ world: PW, scale: SC * 0.85, decal: logo, handoff: true , aa: AA });   // eager: the SDFLayer needs its canvas
SDFS.push(plaza); if (PROF) plaza.profile = true;   // ?prof=1: sync after each pass, per-pass ms in window.labStats.sdf
const finish = new Finish(33);

// ------------------------------------------------------------------ the city (three.js) with the SDF monument in its plaza
const WD = new World({ scale: 1, shadows: 1024, fog: { color: '#2a1a22', density: 0.0011, falloff: 0.006 }, heightFog: true, background: '#0a0810', exposure: 1 });
WD.fitShadow({ far: 460, casters: 420 }).reflect({ scale: 0.25 });
const PITCH = 38;
const city = new City(WD, { nx: 44, nz: 44, block: 26, street: 12, seed: 11, origin: [0, 0], maxH: 150, redShare: 0.1, traffic: 1400, wet: 0.7,
  clear: (x, z) => Math.hypot(x, z) < 34 });
const layer = new SDFLayer(WD, plaza);
const SUNDIR = [0.8, 0.16, 0.6];
applyLook(WD, LOOKS.DUSK, { sunDir: SUNDIR });

// ------------------------------------------------------------------ the march (three.js Terrain + skinned people)
const WM = new World({ scale: 1, shadows: 1024, fog: { color: '#b07058', density: 0.0016, falloff: 0.01 }, heightFog: true, background: '#1a1014', exposure: 1.2 });
WM.fitShadow({ far: 160, casters: 120 });
const terr = new Terrain(WM, { size: 2400, seg: 200, amp: 60, scale: 0.0022, seed: 4, flatShading: false, colors: ['#3a2c22', '#6a5640', '#a08c70'] });
const NM = 150;
const folk = new Figures(WM, NM, { skinned: true, seed: 3, budget: [12, 90] });
const MSUN = [-0.35, 0.2, -1];
applyLook(WM, LOOKS.DAWN, { sunDir: MSUN, area: 200 });
const roadX = z => 40 * Math.sin(z * 0.006);                     // the road the column follows over the ridge
function placeMarch(t) {
  for (let i = 0; i < NM; i++) {
    const row = Math.floor(i / 5), col = i % 5, z = 60 - row * 1.6 - t * 1.3 + (col % 2) * 0.4;
    const x = roadX(z) + (col - 2) * 1.05 + Math.sin(i * 7.1) * 0.15, y = terr.h(x, z);
    folk.place(i, x, y, z, Math.PI + Math.atan(40 * 0.006 * Math.cos(z * 0.006)), t * 5.6 + i * 0.37, 1, 'march', { pump: Math.pow(Math.max(0, Math.sin(t * 4 + row * 0.5)), 2) });
  }
}

// ------------------------------------------------------------------ helpers
const kickAt = t => Math.max(B.env('kick', t, 9), 0.8 * B.env('impact', t, 5));
const bt = b => b * B.spb;
const u01 = (beat, a, b) => clamp((beat - a) / (b - a));
function tag(name, desc, a = 1) {
  const x = 40, y = 70;
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(7,2,3,0.8)'; ctx.fillRect(x, y, 600, 88);
  ctx.fillStyle = C.red2; ctx.fillRect(x, y, 10, 88);
  line(ctx, name, x + 30, y + 44, { family: 'Michroma', size: 30, align: 'left', color: C.cream, maxW: 560 });
  line(ctx, desc, x + 30, y + 74, { family: 'Plex Mono', size: 19, align: 'left', color: 'rgba(244,230,208,0.75)', maxW: 560 });
  ctx.restore();
}
const blit = (cv) => { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(cv, 0, 0, W, H); };
window.labStats = {};
const above = (cam, h, m = 3) => ({ ...cam, pos: [cam.pos[0], Math.max(cam.pos[1], h(cam.pos[0], cam.pos[2]) + m), cam.pos[2]] });

// ------------------------------------------------------------------ shots
function monument(t, beat, kick, red) {
  let cam, o;
  if (!red) {                                                        // dawn: crane up the avenue toward the gate
    const u = u01(beat, 0, 8);
    cam = rig.dolly(u, { pos: [14, 2.5, 470], target: [0, 70, 0] }, { pos: [6, 34, 300], target: [0, 120, 0] }, { fov: 46, ease: ease.inOutCubic });
    cam = handheld(cam, t, { amp: 0.4, rot: 0.003, kick: 0 });
    o = { look: LOOKS.DAWN, crowd: 0.45 + 0.1 * u, sway: t * 0.8, lamps: 0.2, wet: 0.35 };
  } else {                                                           // red sun: silhouettes, cream rims, the ring ignites
    const k = beat - 48, ig = ease.outExpo(u01(beat, 48, 49.5)), brass = B.env('brass', t, 4);
    if (k < 4) cam = rig.dolly(k / 4, { pos: [-8, 4, 330], target: [0, 120, 0] }, { pos: [-4, 6, 240], target: [0, 130, 0] }, { fov: 44 });
    else cam = rig.orbit(t - bt(52), { center: [0, 0, 0], r: 300, h: 60, a0: 0.55, speed: 0.1, look: 120, fov: 44 });
    cam = handheld(cam, t, { amp: 0.5, rot: 0.004, kick, punch: 0.9 });
    o = { look: LOOKS.RED_SUN, ignite: ig * (0.8 + 0.4 * brass), sway: t * 0.8, crowd: 0.95, lamps: 0.4 + 0.8 * kick, wet: 0.5, kick };
  }
  mon().render(t, { cam, ...o, flash: 0.5 * B.env('impact', t, 10) });
  blit(mon().canvas);
  tag(red ? 'SDF · MONUMENT, RED SUN' : 'SDF · MONUMENT IN FOG', red ? 'LOOKS.RED_SUN · black silhouettes · cream rim · ring' : 'board-formed stele · ring · terraces · shafts');
}

function fortress(t, beat, kick, night) {
  let cam, o, hero = { x: 0, z: 0, heading: 0, phase: -1 };
  if (!night) {
    const k = beat - 8;
    if (k < 4) cam = rig.dolly(k / 4, { pos: [-34, 1.7, 168], target: [0, 42, 0] }, { pos: [-24, 1.7, 146], target: [0, 44, 0] }, { fov: 44 });
    else if (k < 8) cam = rig.dolly((k - 4) / 4, { pos: [14, 9, 84], target: [4, 30, 24] }, { pos: [8, 16, 74], target: [2, 40, 24] }, { fov: 40 });
    else {                                                           // the hero: 17-19 m away, low, a dark read against the gate slit
      const u = (k - 8) / 4;
      hero = { x: 2.5 - u * 0.4, z: 70 - u * 1.6, heading: -Math.PI / 2 + 0.08, phase: t * 6 };
      cam = rig.dolly(u, { pos: [-7, 1.3, 87], target: [1, 11, 40] }, { pos: [-6, 1.5, 85], target: [1, 13, 38] }, { fov: 40 });
    }
    cam = handheld(cam, t, { amp: 0.12, rot: 0.003, kick, punch: 0.8 });
    o = { look: LOOKS.NOON, mark: 1, cloud: 0.05, gateGlow: 0.25 + 0.5 * kick, walk: t, hero, wet: 0.55 };
  } else {
    const u = u01(beat, 60, 64);
    cam = rig.dolly(u, { pos: [-70, 3, 196], target: [0, 44, 0] }, { pos: [-52, 5, 170], target: [0, 50, 0] }, { fov: 42 });
    cam = handheld(cam, t, { amp: 0.15, rot: 0.003, kick, punch: 0.8 });
    o = { look: LOOKS.SODIUM_NIGHT, mark: 1, gateGlow: 1, walk: t, markRed: 1 + 1.5 * kick, wet: 0.8 };
  }
  fort().render(t, { cam, ...o, flash: 0.55 * B.env('impact', t, 10) });
  blit(fort().canvas);
  tag(night ? 'SDF · FORTRESS, SODIUM' : 'SDF · THE FORTRESS', night ? 'LOOKS.SODIUM_NIGHT · emissive mark · wet plaza' : 'board-formed concrete · pour lines · figures · puddles');
}

function frontier(t, beat, kick) {
  const u = u01(beat, 20, 24);
  let cam = rig.path(ease.inOutCubic(u), [
    { pos: [260, 120, 520], target: [0, 40, -40], fov: 38 },
    { pos: [150, 80, 330], target: [0, 44, -30], fov: 40 },
    { pos: [50, 46, 230], target: [0, 44, -24], fov: 42 },
    { pos: [3, 32, 186], target: [0, 42, -24], fov: 44 },
  ]);
  cam = above(handheld(cam, t, { amp: 0.25, rot: 0.003, kick, punch: 0.6 }), FW.h, 4);
  const look = { ...LOOKS.DAWN, sun: { dir: [-0.9, 0.24, 0.15], color: [2.6, 1.7, 1.05] }, fog: { ...LOOKS.DAWN.fog, color: [0.36, 0.3, 0.32], density: 0.0012 }, post: { ...LOOKS.DAWN.post, rays: 0 } };
  front().render(t, { cam, look, walk: t, fill: 0.85, gateGlow: 0.3 + 0.5 * kick, mark: 1, lamps: 0.2, wet: 0, flash: 0.5 * B.env('impact', t, 10) });
  blit(front().canvas);
  tag('SDF · THE FRONTIER', 'compose(kit.*) · terrain · crane · column · rig.path');
}

function hallShot(t, beat, kick) {
  const k = beat - 24;
  let cam = k < 4 ? rig.dolly(k / 4, { pos: [0.5, 2.2, 36], target: [0, 5, -10] }, { pos: [0, 2.6, 6], target: [0, 6, -40] }, { fov: 52 })
    : rig.dolly((k - 4) / 4, { pos: [2.5, 1.0, -52], target: [-4, 15, -84] }, { pos: [1.5, 1.4, -60], target: [-5, 17, -92] }, { fov: 60 });
  cam = handheld(cam, t, { amp: 0.06, rot: 0.004, kick, punch: 1 });
  hall().render(t, { cam, sun: { dir: [0.55, 0.75, -0.25], color: [4.2, 3.3, 2.3] }, sky: { top: [0.3, 0.4, 0.7], horizon: [0.9, 0.85, 0.8], ground: [0.25, 0.2, 0.17] },
    fog: { color: [0.03, 0.025, 0.022], density: 0.0065, falloff: 0.02 }, amb: 0.45, exposure: 1.1, vol: 10, kick, rim: [1, 0.85, 0.7, 0.1],
    sway: t * 1.4, glow: 0.4 + 1.6 * kick, dust: 0.3, walk: t, wet: 0.85, flash: 0.5 * B.env('impact', t, 10),
    post: { bloom: 0.8, threshold: 0.55, contrast: 0.14, vignette: 0.55, cream: 0.15 } });
  blit(hall().canvas);
  tag('SDF · THE HALL', 'wet floor reflections · shafts · workers on the aisle');
}

function cityShot(t, beat, kick) {
  const k = beat - 32;
  const day = 1 - ease.inOutCubic(u01(beat, 36, 41));
  const kicks = beat >= 44 ? B.count('kick', t) - B.count('kick', bt(44) - 1e-3) : 0;
  const wave = beat < 40 ? -200 : lerp(0, 260, ease.outCubic(u01(beat, 40, 44))) + Math.max(0, kicks - 1) * 70 + (kicks > 0 ? 70 * ease.outExpo((t - B.last('kick', t)) / 0.25) : 0);
  city.update(t, { wave, spread: 160, day, gain: 3.2, redPulse: B.env('brass', t, 4), blink: kick > 0.5 ? 1 : 0, lamps: clamp(1.2 - day * 0.9) * (beat < 40 ? 1 : 0.6), wet: 0.75 });
  applyLook(WD, LOOKS.DUSK, { sunDir: SUNDIR, glow: day });
  WD._sun.intensity = lerp(0.12, 3.0, day); WD._sun.color.set(day > 0.5 ? '#ffa060' : '#ff5a30');
  WD._hemi.intensity = lerp(0.35, 0.9, day); WD.renderer.toneMappingExposure = lerp(1.1, 1.45, day);
  const hor = `rgb(${Math.round(lerp(58, 196, day))},${Math.round(lerp(30, 104, day))},${Math.round(lerp(44, 70, day))})`;
  WD.skyDome({ top: day > 0.5 ? '#1c2040' : '#07060c', horizon: hor, sun: SUNDIR, sunColor: '#ff7a3a', glow: day });
  WD.scene.fog.color.set(hor); WD.scene.fog.density = lerp(0.0016, 0.0011, day);
  let cam;
  if (k < 8) cam = rig.path(ease.inOutCubic(k / 8), [               // down the street canyon to the plaza, then up the stele
    { pos: [PITCH * 2 - 3, 2.0, 560], target: [PITCH * 2 - 6, 30, 0], fov: 46 },   // stays in the x = 76 street: never inside a block
    { pos: [PITCH * 2 - 3, 2.4, 380], target: [PITCH * 1.2, 50, 0], fov: 46 },
    { pos: [PITCH * 2 - 2, 7, 210], target: [0, 90, 0], fov: 48 },
    { pos: [PITCH * 2 - 2, 34, 100], target: [0, 105, 0], fov: 50 },
  ]);
  else if (k < 12) cam = rig.crane((k - 8) / 4, { center: [0, 0, 0], ang: 0, dist0: 150, dist1: 420, y0: 30, y1: 220, look0: 110, look1: 60, fov: 50 });
  else cam = rig.orbit(t - bt(44), { center: [0, 0, 0], r: 460, h: 230, a0: 0.52, speed: 0.1, look: 60, fov: 52 });
  cam = handheld(cam, t, { amp: k < 8 ? 0.1 : 0.6, rot: 0.003, kick, punch: 0.7 });
  // the SDF monument with the same camera, then three.js with it as a depth-tested layer
  const look = day > 0.5 ? LOOKS.DUSK : LOOKS.SODIUM_NIGHT;
  const T0 = performance.now();
  plaza.render(t, { cam, look, sun: { dir: SUNDIR, color: day > 0.5 ? [2.6, 1.3, 0.7] : [0.5, 0.25, 0.2] }, fog: { color: [lerp(0.04, 0.55, day), lerp(0.02, 0.26, day), lerp(0.03, 0.17, day)], density: lerp(0.0013, 0.0009, day) },
    amb: lerp(0.35, 0.55, day), exposure: lerp(1.2, 0.9, day), ignite: beat >= 44 ? 0.8 + 0.6 * kick : 0, mark: 1, markRed: beat >= 40 ? 1 + kick : 0, rim: [1, 0.85, 0.7, lerp(0.4, 0.1, day)] });
  const T1 = performance.now();
  layer.update();
  WD.render(cam); if (PROF) WD.sync();
  window.labStats.three = Math.round(performance.now() - T1); window.labStats.plaza = Math.round(T1 - T0);
  blit(WD.canvas);
  glow(ctx, ctx.canvas, { amount: lerp(0.9, 0.35, day), threshold: 0.6, radius: 1.2 });
  tag('THREE · THE CITY', day > 0.5 ? 'archetypes · wet streets · SDF stele in three (depth)' : 'windows light in waves · puddle reflections · ring ignites');
  finish.apply(ctx, Math.round(t * 30), { grain: 0.06, vignette: 0.5 });
}

function march(t, beat, kick) {
  const u = u01(beat, 56, 60);
  placeMarch(t);
  const hz = 40 - t * 1.3, head = [roadX(hz), terr.h(roadX(hz), hz), hz];
  let cam = rig.crane(u, { center: head, ang: 0.55, dist0: 16, dist1: 40, y0: 1.2, y1: 12, look0: 4, look1: 7, fov: 46 });
  cam = handheld(cam, t, { amp: 0.15, rot: 0.004, kick, punch: 0.7 });
  cam.pos[1] = Math.max(cam.pos[1] + head[1], terr.h(cam.pos[0], cam.pos[2]) + 1.8);
  const T0 = performance.now();
  WM.render(cam); if (PROF) WM.sync();
  window.labStats.three = Math.round(performance.now() - T0);
  blit(WM.canvas);
  glow(ctx, ctx.canvas, { amount: 0.5, threshold: 0.62, radius: 1.2 });
  tag('THREE · THE MARCH', 'Terrain · skinned Figures (people.js) · rig.crane');
  finish.apply(ctx, Math.round(t * 30), { grain: 0.05, vignette: 0.45 });
}

window.renderFrame = async (t) => {
  const beat = B.beat(t), kick = kickAt(t), T0 = performance.now();
  window.labStats = {};
  if (beat >= 64) closer(ctx, t - bt(64));
  else if (beat < 8) monument(t, beat, kick, false);
  else if (beat < 20) fortress(t, beat, kick, false);
  else if (beat < 24) frontier(t, beat, kick);
  else if (beat < 32) hallShot(t, beat, kick);
  else if (beat < 48) cityShot(t, beat, kick);
  else if (beat < 56) monument(t, beat, kick, true);
  else if (beat < 60) march(t, beat, kick);
  else fortress(t, beat, kick, true);
  window.labStats.frame = Math.round(performance.now() - T0);
  if (PROF) window.labStats.sdf = SDFS.map(s => s.stats || null);
};

// warm every program (SwiftShader compiles on first draw) so frame 0 is not charged for it
plaza.render(0, {}); plaza.sync(); DBG('warm plaza');
city.update(0, {}); layer.update(); WD.render(rig.orbit(0, {})); WD.sync(); DBG('warm city');
placeMarch(0); WM.render(rig.orbit(0, { r: 50, h: 30 })); WM.sync();
window.__wd = WD;
ready = true;
