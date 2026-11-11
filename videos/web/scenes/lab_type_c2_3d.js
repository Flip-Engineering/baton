// LAB TYPE C2 3D (TYPE studio, cycle 2): light makes the letter. t is SONG time (scripts/type_c2.mjs page=lab_type_c2_3d).
//   ?demo=otf    OWN THE FUTURE: a sign bridge on the rain interstate at night; the event panel's legend WE OWN / TOMORROW
//                is BUTTON COPY (lib/fx/type_light.js). Dark at 70 m under the low beams; as the rig crests the approach
//                the overhead-sign zone of the low beam climbs the lower rows; on the hit the driver flashes the high
//                beams and every button fires; the camera arrives 30 m out, looking up (vfov 30).
//   ?demo=giant  THE GIANT: a tower under construction over a night skyline; its work lights lift off as drones and
//                fly to an ANAMORPHIC formation (A RED / SUN.) that reads only from the design camera. The camera cranes
//                in from off-axis and arrives at the design point on the hit; the formation locks; 10 frames later it
//                re-forms into a red disc: the sun made of the workers' lights.
// &hit=s overrides the onset. window.typeC2(t) returns the state card (legend cap px on screen, lock share, etc.).
import * as THREE from 'three';
import { World } from '../lib/fx/world3d.js';
import { LOOKS3, LightField, patchMaterial } from '../lib/fx/atmos3d.js';
import * as AM from '../lib/fx/americana.js';
import * as RD from '../lib/fx/americana_road.js';
import * as CT from '../lib/fx/americana_city.js';
import * as CD from '../lib/fx/cards.js';
import { loadFace } from '../lib/fx/type.js';
import { setBlock } from '../lib/fx/type_world.js';
import { buttonCopy, buttonMaterial, SkySwarm } from '../lib/fx/type_light.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const Q = new URLSearchParams(location.search), DEMO = Q.get('demo') || 'otf';
const deg = d => d * Math.PI / 180, clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), lerp = (a, b, u) => a + (b - a) * u;
const ss = u => { u = clamp(u); return u * u * (3 - 2 * u); };
const LK = (name, o = {}) => ({ ...JSON.parse(JSON.stringify(LOOKS3[name])), ...o });
const HIT = { otf: 21.083, giant: 26.233 };
const hit = Q.get('hit') ? +Q.get('hit') : HIT[DEMO];
const fr = a => Math.floor(a * 30 + 1e-6);
let S;

// ================================================================ OWN THE FUTURE: button copy on the gantry
if (DEMO === 'otf') {
  await RD.loadHighwayFont().catch(e => console.log('font', e.message));
  const face = await loadFace('overpass');
  const W = new World({ shadows: 0, atmos: { look: LK('HIGHWAY_RAIN_AD', { bloom: 0.025 }), samples: 4 }, far: 16000, near: 0.3 });
  const A = W.atmos; A.reflect({ scale: 0.4 });
  const lf = new LightField(A, { box: [-2200, -7000, 2200, 300], res: 4096, haloPx: 34 });
  const hl = new RD.Headlights(W);
  const lit = RD.patchLit(hl);
  const hw = new RD.Highway(W, A, lf, hl, { patch: lit, z0: 250, z1: -2600 });
  const L = RD.MUTCD.lane, xm = hw.xm, gz = -120, camX = 2.5 * L;
  // the event sign: 8.4 x 4.6 m over the camera's lane (the one oversize panel), a real-scale guide sign beside it
  const EV = { x: camX, w: 8.4, h: 4.6, lines: [] }, REAL = { x: camX - 9.6, w: 9.0, h: 4.3, shield: { num: '80', h: 1.55, x: 1.55, y: 1.2 },
    lines: [{ text: 'WEST', cap: 0.46, y: 0.62, x: 2.7, align: 'left' }, { text: 'Millions', cap: 0.46, y: 2.55 }] };
  const G = new RD.Gantry(W, A, lf, hl, { z: gz, x0: xm - 4.6, x1: hw.W + RD.MUTCD.shoulderR + 7.3, patch: lit, mass: true, panels: [REAL, EV] });
  const legend = buttonCopy(face, [{ text: 'WE OWN', fill: true, max: 2.0 }, { text: 'TOMORROW', fill: true, max: 1.6 }], { wM: EV.w, hM: EV.h, pxPerM: 300, sx: 0.82 });
  const evMesh = G.panels[1], mat = buttonMaterial(A, lf, hl, legend); evMesh.material = mat;
  G.panels[0].material.uniforms.uSheet.value = 1;
  // the exit tab on top of the event panel, button copy too
  const tab = buttonCopy(face, [{ text: 'EXIT 2036', cap: 0.5 }], { wM: 3.4, hM: 0.95, pxPerM: 300, sx: 0.9, border: 0.07 });
  const tabMat = buttonMaterial(A, lf, hl, tab), tabMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.95), tabMat);
  tabMesh.position.set(EV.x + EV.w / 2 - 1.9, evMesh.position.y + EV.h / 2 + 0.5, evMesh.position.z + 0.12); W.scene.add(tabMesh);
  const tabBack = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.95, 0.06), new THREE.MeshStandardMaterial({ color: '#6c7074', roughness: 0.6, metalness: 0.6 })); tabBack.position.copy(tabMesh.position).add(new THREE.Vector3(0, 0, -0.05)); W.scene.add(tabBack);
  new RD.Roadside(W, A, lf, { hw, patch: lit, CD });
  const xo = xm - 0.45 - RD.MUTCD.shoulderL;
  const TR = new AM.Traffic(lf, [
    { a: [3.5 * L, 0, 200], b: [3.5 * L, 0, -2600], n: 3, speed: 31, dir: 1 }, { a: [0.5 * L, 0, 200], b: [0.5 * L, 0, -2600], n: 3, speed: 33, dir: 1 },
    ...[0, 1, 2, 3].map(k => ({ a: [xo - (k + 0.5) * L, 0, -2600], b: [xo - (k + 0.5) * L, 0, 260], n: 7, speed: 30, dir: 1 })),
  ], { seed: 21, headI: 5, tailI: 1.6, truckShare: 0.3, pool: true });
  new RD.Rain(A, lf, hl, { count: 9000 });
  A.setTowns([{ x: 380, z: -5200, r: 2600, i: 0.7 }, { x: -2500, z: -11000, r: 5000, i: 0.5 }]);
  lf.build(); lf.animated = true;
  A.motionBlur = 0.12;
  // the drive: 65 mph, arriving 30 m from the panel face ON the hit; the rig rides up the approach slab in the last 10
  // frames (pitch 0 -> 5.5 deg lifts the low beam's sign zone up the rows), the high beams flash on the hit
  const v = 65 * AM.MPH, D0 = 28, zF = evMesh.position.z, cy = evMesh.position.y;
  const pitchAt = t => 7.5 * ss((t - (hit - 10 / 30)) / (10 / 30));
  const highAt = t => { const f = fr(t - hit); return f < 0 ? 0 : f < 9 ? 1 : Math.max(0, 1 - (f - 9) / 6); };
  const cam = t => { const d = D0 + v * (hit - t), z = zF + d, p = pitchAt(t), bob = 0.012 * Math.sin(t * 11) + 0.006 * Math.sin(t * 23);
    const y = 2.4 + bob + 0.3 * p / 7.5, look = clamp((70 - d) / 40);                    // the eye leaves the road for the sign as it nears
    const ty = lerp(y + 60 * Math.tan(deg(2)), cy - 0.2, ss(look)), tz = lerp(z - 60, zF, ss(look)), tx = lerp(camX, EV.x, ss(look));
    return { pos: [camX, y, z], target: [tx, ty + p * 0.05, tz], fov: 30 }; };
  S = { W, update(t) { TR.update(t); for (const m of [mat, tabMat]) { m.uniforms.uPitch.value = pitchAt(t); m.uniforms.uCut.value = 2.5; m.uniforms.uHigh.value = highAt(t); } },
    cam, info(t) { const c = cam(t), d = c.pos[2] - zF, pxm = 1920 / (2 * d * Math.tan(deg(15)));
      return { dist: +d.toFixed(1), capsPx: legend.capsM.map(m => Math.round(m * pxm)), lineWpx: legend.lineWidthsM.map(m => Math.round(m * pxm)), high: highAt(t), pitch: +pitchAt(t).toFixed(2), buttons: legend.buttons, capsM: legend.capsM.map(x => +x.toFixed(2)) }; } };
}

// ================================================================ THE GIANT: the anamorphic swarm over the skyline
if (DEMO === 'giant') {
  const anton = await loadFace('anton');
  const W = new World({ shadows: 0, atmos: (() => { const L = LK('CITY_NIGHT_AD', { bloom: 0.02 }); if (L.clouds) L.clouds.on = 0; return L; })(), far: 40000, near: 1 });
  const A = W.atmos; A.reflect({ scale: 0.35 });
  const lf = new LightField(A, { box: [-2500, -9000, 2500, 500], res: 4096, haloPx: 24 });
  // ground + river, the skyline rows (WORLDS c1 shot 5)
  { const g = new THREE.PlaneGeometry(16000, 16400, 8, 8); g.rotateX(-Math.PI / 2); g.translate(0, 0, -8000); const m = new THREE.MeshStandardMaterial({ color: '#3a3834', roughness: 0.95 }); patchMaterial(m, lf); W.scene.add(new THREE.Mesh(g, m)); }
  new CT.Skyline(W, lf, [
    { z0: -1150, z1: -1500, x0: -260, x1: 260, n: 34, hMin: 18, hMax: 70, lit: 0.22, curtain: 0.2, gain: 0.7 },
    { z0: -1800, z1: -2300, x0: -340, x1: 340, n: 34, hMin: 45, hMax: 130, lit: 0.3, curtain: 0.4, gain: 0.8 } ], { seed: 12 });
  new CD.SilhouetteRows(W, A, lf, [
    { z: -2700, x0: -520, x1: 560, hMin: 70, hMax: 330, peakAt: 0.55, seed: 31, lit: 1.0 },
    { z: -3300, x0: -800, x1: 900, hMin: 60, hMax: 260, peakAt: 0.35, seed: 32, lit: 0.9 },
    { z: -4200, x0: -1200, x1: 1300, hMin: 40, hMax: 200, peakAt: 0.6, seed: 33, lit: 0.8, ppm: 1.8 },
    { z: -5600, x0: -1800, x1: 1900, hMin: 25, hMax: 150, seed: 34, lit: 0.7, ppm: 1.4 } ],
    { kind: 'city', ppm: 2.4, body: '#121218', edge: '#b0a090', edgeGain: 0.06, lightGain: 1.1 });
  const r = AM.rng(31);
  for (let i = 0; i < 500; i++) { const z = -1050 - r() * 6000, x = (r() - 0.5) * (300 + Math.abs(z) * 0.3); if (r() < 0.3) continue;
    lf.add({ pos: [Math.round(x / 90) * 90 + (r() - 0.5) * 8, 8, Math.round(z / 90) * 90], color: r() < 0.7 ? AM.SODIUM : AM.LED, i: 1.8, core: 0.3, halo: 0.4, minPx: 1.1, pool: { r: 8, i: 12 } }); }
  // the tower going up: a steel frame 60 x 60 m, 52 floors (208 m) topped out, decks lit by work lights, a tower crane
  const TX = 40, TZ = -760, FL = 4, NF = 52, TW = 60;
  { const parts = [], beam = (a, b, t) => { const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length(), g = new THREE.BoxGeometry(t, L, t);
      g.translate(0, L / 2, 0); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.applyQuaternion(q); g.translate(...a); return g.toNonIndexed(); };
    for (const dx of [-TW / 2, -TW / 6, TW / 6, TW / 2]) for (const dz of [-TW / 2, -TW / 6, TW / 6, TW / 2]) parts.push(beam([TX + dx, 0, TZ + dz], [TX + dx, NF * FL, TZ + dz], 0.9));
    for (let f = 1; f <= NF; f++) for (const s of [-1, 1]) { parts.push(beam([TX - TW / 2, f * FL, TZ + s * TW / 2], [TX + TW / 2, f * FL, TZ + s * TW / 2], 0.6)); parts.push(beam([TX + s * TW / 2, f * FL, TZ - TW / 2], [TX + s * TW / 2, f * FL, TZ + TW / 2], 0.6)); }
    const crane = [beam([TX + 10, NF * FL, TZ], [TX + 10, NF * FL + 60, TZ], 2.2), beam([TX - 60, NF * FL + 58, TZ], [TX + 40, NF * FL + 58, TZ], 1.6)];
    const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
    const m = new THREE.MeshStandardMaterial({ color: '#4a4440', roughness: 0.7, metalness: 0.4 }); patchMaterial(m, lf);
    W.scene.add(new THREE.Mesh(mergeGeometries([...parts, ...crane].map(g => { g.deleteAttribute('uv'); return g; })), m)); }
  // work lights on every deck edge (these are the drones' pads)
  const pads = []; for (let f = 2; f <= NF; f++) for (let k = 0; k < 14; k++) { const s = k % 4, u = (k / 14 + f * 0.13) % 1; const e = (u - 0.5) * TW;
    const p = s === 0 ? [TX + e, f * FL + 0.5, TZ + TW / 2] : s === 1 ? [TX + TW / 2, f * FL + 0.5, TZ + e] : s === 2 ? [TX + e, f * FL + 0.5, TZ - TW / 2] : [TX - TW / 2, f * FL + 0.5, TZ + e]; pads.push(p);
    if (k % 3 === 0) lf.add({ pos: p, color: AM.LED, i: 0.9, core: 0.25, halo: 0.3, minPx: 1, pool: { r: 5, i: 6 } }); }
  A.setTowns([{ x: 0, z: -2900, r: 2600, i: 0.16 }, { x: -1500, z: -6000, r: 3500, i: 0.1 }, { x: 1800, z: -4500, r: 2500, i: 0.08 }]);   // a dark deck: the drones must out-shine the sky
  lf.build(); lf.animated = false;
  // the design camera: on the elevated deck 1 km out, looking up past the tower top into the sky
  const design = { pos: [-60, 40, 520], target: [30, 330, -900], fov: 44 };
  const block = setBlock(anton, [{ text: 'A RED', fill: true, max: 330 }, { text: 'SUN.', fill: true, max: 400 }], { role: 'payoff', x: 510, y: 665, gap: 0.08, maxW: 880 });
  // the sun disc: centred on the design ray through frame point (540, 620) at 900 m, 150 m radius, facing the camera
  const dc = new THREE.PerspectiveCamera(design.fov, 1080 / 1920, 1, 10000); dc.position.set(...design.pos); dc.lookAt(...design.target); dc.updateMatrixWorld(); dc.updateProjectionMatrix();
  const dray = new THREE.Vector3(0, 1 - 620 / 1920 * 2, 0.5).unproject(dc).sub(dc.position).normalize(), dcen = dc.position.clone().addScaledVector(dray, 900);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(dc.quaternion), upv = new THREE.Vector3(0, 1, 0).applyQuaternion(dc.quaternion);
  const SW = new SkySwarm(A.overlay, { block, design, depth: [520, 1150], spacing: 10, red: 0.22, size: 2.6, extinction: 1 / 6000,
    sources: (i, rnd) => { const p = pads[Math.floor(rnd() * pads.length)]; return [p[0] + (rnd() - 0.5) * 2, p[1], p[2] + (rnd() - 0.5) * 2]; },
    disc: { centre: dcen.toArray(), radius: 72, u: right.toArray(), v: upv.toArray(), thick: 3 } });
  // the crane: from off-axis (left, lower, nearer the river) to the design point, arriving on the hit
  const craneT = 1.5, off = [-230, -18, 420];
  const cam = t => { const u = ss((t - (hit - craneT)) / craneT), e = 1 - Math.pow(1 - clamp((t - (hit - craneT)) / craneT), 3);
    const k = t < hit - craneT ? 0 : t >= hit ? 1 : Math.pow(clamp((t - (hit - craneT)) / craneT), 2.4);   // accelerating into the lock: the word is broken until the last frames
    return { pos: design.pos.map((v, i) => v + off[i] * (1 - k)), target: design.target.map((v, i) => v + [60, -40, 0][i] * (1 - k)), fov: design.fov }; };
  const keys = { launch: hit - 2.3, lock: hit, disc: hit + 10 / 30, discDur: 0.35 };
  // the show's LEDs are cued to the music: every light jumps to full ON the lock (the hit) and settles to a held level
  const ledGain = t => { const f = fr(t - hit); return f < 0 ? 1.8 : 3.4 + 2.0 * Math.exp(-f / 3); };
  S = { W, cam, update(t) { S.home = SW.update(t, { ...keys, gain: ledGain(t) }); },
    info(t) { return { drones: SW.N, home: +(S.home || 0).toFixed(3), wordW: Math.round(block.bbox.x2 - block.bbox.x1), wordWshare: +((block.bbox.x2 - block.bbox.x1) / 1080).toFixed(2), caps: block.caps.map(Math.round), locked: t >= hit, disc: t >= keys.disc }; } };
}

// ================================================================ boot
const W = S.W;
W.canvas.id = 'out'; document.getElementById('out')?.remove(); document.body.appendChild(W.canvas);
W.canvas.style.width = '1080px'; W.canvas.style.height = '1920px';
window.renderFrame = (t) => { S.update(t); W.render(S.cam(t), t); const gl = W.renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
window.typeC2 = t => ({ demo: DEMO, hit, ...S.info(t) });
window.renderFrame(hit);
ready = true;
