// LAB / SHADERS2: the shaders2 family (atmos.js, flesh.js, engrave.js, paint.js, fields.js) shown in the slate's own
// worlds and palette. One still per shot; window.renderFrame(t) returns { ms, stages }.
//   ?shot=giant     THE GIANT: Rodchenko camera under a steel worker on a beam, huge red sun, crane lattice, shafts, rim
//   ?shot=profile   the compelling human: back-lit 3/4 rear profile, pre-integrated skin, glowing ear, hair, rim (&flesh=0: before)
//   ?shot=cones     THE MAJORITY: night crowd under volumetric beams in haze, one hero in front in red
//   ?shot=engrave   BANK: a worker bust as a banknote intaglio engraving (lines wrap the form; &turn=a for a head turn)
//   ?shot=molten    THE IRON IS HOT: domain-warped molten iron with a reaction-diffusion crust, blackbody colour
//   ?shot=rust      REJUVENATION: rust grown by reaction-diffusion from scratches on a steel plate, receding in time
//   ?shot=paint     painted medium: the foundry (molten channel + silhouettes) under anisotropic Kuwahara + impasto
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { People } from '../lib/fx/people.js';
import { Atmos, LightCone } from '../lib/fx/atmos.js';
import { patchPeople } from '../lib/fx/flesh.js';
import { engravePeople, plateBackground } from '../lib/fx/engrave.js';
import { Passes } from '../lib/fx/glfx.js';
import { Fields, bakeRD, bakeGrowth, RD_PRESETS } from '../lib/fx/fields.js';
import { Paint } from '../lib/fx/paint.js';

const Q = new URLSearchParams(location.search);
const SHOT = Q.get('shot') || 'giant';
const W = 1080, H = 1920;
let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });

const canvas = document.getElementById('out');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, W / H, 0.05, 8000);
const SHOTS = {};
const FLO = Q.get('fl') ? JSON.parse(Q.get('fl')) : {};
const PNO = Q.get('pnt') ? JSON.parse(Q.get('pnt')) : {};
const ATO = Q.get('atm') ? JSON.parse(Q.get('atm')) : {};      // atmos overrides, e.g. &atm={"haze":{"density":0}}
const ao = o => { for (const k in ATO) o[k] = { ...(o[k] || {}), ...ATO[k] }; return o; };   // flesh overrides for A/B, e.g. &fl={"rim":0}
const hx = (c, k = 1) => { const v = new THREE.Color(c); return new THREE.Vector3(v.r * k, v.g * k, v.b * k); };

// ------------------------------------------------------------------ shared set pieces
// sky dome with a big sun disc (HDR), limb-darkened, a halo and a horizon band; everything is emissive
function sky({ top = '#12040a', mid = '#6a1414', horizon = '#e0502a', sunDir = [0, 0.2, -1], sunColor = '#ff5a24', disc = 6, discI = 6, halo = 1.2, band = 0.18 } = {}) {
  const U = { uTop: { value: hx(top) }, uMid: { value: hx(mid) }, uHor: { value: hx(horizon) }, uSun: { value: new THREE.Vector3(...sunDir).normalize() },
    uSunC: { value: hx(sunColor) }, uDisc: { value: Math.cos(disc * Math.PI / 180) }, uDiscI: { value: discI }, uHalo: { value: halo }, uBand: { value: band } };
  const m = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: U,
    vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 uTop, uMid, uHor, uSun, uSunC; uniform float uDisc, uDiscI, uHalo, uBand; varying vec3 vD;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){ vec3 d = normalize(vD); float y = d.y;
        vec3 c = mix(uHor, uMid, smoothstep(-0.02, uBand, y)); c = mix(c, uTop, smoothstep(uBand, 0.75, y));
        float s = dot(d, uSun), a = acos(clamp(s, -1.0, 1.0)), R = acos(uDisc);
        c += uSunC * uHalo * (0.35 * exp(-a * 3.0) + 0.9 * exp(-a * 9.0) + 0.6 * exp(-a / R * 1.1));
        float disc = smoothstep(R * 1.004, R * 0.996, a), limb = sqrt(max(0.0, 1.0 - pow(a / R, 2.0)));
        c = mix(c, uSunC * uDiscI * (0.55 + 0.45 * limb), disc);
        // faint horizontal striation in the disc (atmospheric refraction), and a warmer lower limb
        c *= 1.0 - disc * 0.12 * smoothstep(0.4, 0.9, sin(d.y * 900.0) * 0.5 + 0.5) * smoothstep(0.0, -R, (d.y - uSun.y));
        gl_FragColor = vec4(c, 1.0); }` }));
  m.frustumCulled = false; m.renderOrder = -1; scene.add(m); return m;
}
// a lattice (truss) along +Y: 4 chords, horizontal battens and zigzag diagonals, as one merged geometry
function trussGeo(len, w, { bay = w, chord = 0.12, lace = 0.06 } = {}) {
  const parts = [], n = Math.max(1, Math.round(len / bay)), b = len / n, h = w / 2;
  const bar = (a, c, t) => { const A = new THREE.Vector3(...a), C = new THREE.Vector3(...c), L = A.distanceTo(C), g = new THREE.BoxGeometry(t, L, t);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), C.clone().sub(A).normalize()); g.applyQuaternion(q);
    const m = A.clone().add(C).multiplyScalar(0.5); g.translate(m.x, m.y, m.z); parts.push(g); };
  for (const [x, z] of [[-h, -h], [h, -h], [h, h], [-h, h]]) bar([x, 0, z], [x, len, z], chord);
  const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
  for (let i = 0; i <= n; i++) for (let k = 0; k < 4; k++) { const [x0, z0] = corners[k], [x1, z1] = corners[(k + 1) % 4]; bar([x0, i * b, z0], [x1, i * b, z1], lace); }
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { const [x0, z0] = corners[k], [x1, z1] = corners[(k + 1) % 4], up = (i + k) % 2;
    bar([x0, (i + up) * b, z0], [x1, (i + 1 - up) * b, z1], lace); }
  return mergeGeometries(parts);
}
function crane(mat, { x = -30, z = -70, mastH = 70, jib = 70, cjib = 22, rotY = 0.5 } = {}) {
  const g = new THREE.Group();
  const mast = new THREE.Mesh(trussGeo(mastH, 2.2, { chord: 0.22, lace: 0.1 }), mat); g.add(mast);
  const j = new THREE.Mesh(trussGeo(jib, 1.6, { chord: 0.16, lace: 0.08, bay: 2.2 }), mat); j.rotation.z = -Math.PI / 2; j.position.set(0, mastH + 1, 0); g.add(j);
  const cj = new THREE.Mesh(trussGeo(cjib, 1.6, { chord: 0.16, lace: 0.08, bay: 2.2 }), mat); cj.rotation.z = Math.PI / 2; cj.position.set(0, mastH + 1, 0); g.add(cj);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 2.6), mat); cab.position.set(1.8, mastH - 0.6, 0); g.add(cab);
  const cw = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 2.2), mat); cw.position.set(-cjib + 2, mastH - 1, 0); g.add(cw);
  const apex = new THREE.Mesh(trussGeo(9, 1.2, { chord: 0.14, lace: 0.07, bay: 1.5 }), mat); apex.position.set(0, mastH + 1, 0); g.add(apex);
  for (const [x1, y1] of [[jib * 0.62, mastH + 1.8], [-cjib, mastH + 1.8]]) {           // pendant ties
    const A = new THREE.Vector3(0, mastH + 10, 0), B = new THREE.Vector3(x1, y1, 0), L = A.distanceTo(B), c = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, L, 4), mat);
    c.position.copy(A.clone().add(B).multiplyScalar(0.5)); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); g.add(c); }
  const hookX = jib * 0.55, cable = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 26, 4), mat); cable.position.set(hookX, mastH - 12, 0); g.add(cable);
  const blk = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.6), mat); blk.position.set(hookX, mastH - 25.5, 0); g.add(blk);
  g.position.set(x, 0, z); g.rotation.y = rotY; g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  scene.add(g); return g;
}

// ------------------------------------------------------------------ THE GIANT
SHOTS.giant = async () => {
  const sunDir = [-0.24, 0.66, -0.71];
  sky({ top: '#050103', mid: '#1c0406', horizon: '#5a1210', sunDir, sunColor: '#ff3a12', disc: 9, discI: 3.2, halo: 0.55, band: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: '#0e0a0a', roughness: 0.7, metalness: 0.2 });
  crane(steel, { x: -26, z: -52, mastH: 92, jib: 78, cjib: 24, rotY: 0.75 });
  crane(steel, { x: 55, z: -150, mastH: 150, jib: 85, cjib: 26, rotY: 2.5 });
  // the beam he stands on (an I-section cantilevered toward the sun) and the column below it
  const beamM = new THREE.MeshStandardMaterial({ color: '#3a2c2a', roughness: 0.5, metalness: 0.55 });
  const I = new THREE.Group();
  for (const [w, h, y] of [[0.34, 0.03, 0], [0.34, 0.03, -0.42], [0.025, 0.42, -0.21]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 16), beamM); m.position.set(0, y - 0.015, 0); m.castShadow = m.receiveShadow = true; I.add(m); }
  for (let i = 0; i < 30; i++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 6), beamM); r.position.set((i % 2 ? 0.11 : -0.11), 0.005, 7 - i * 0.5); I.add(r); }
  I.rotation.y = Math.PI / 2 + 0.25; scene.add(I);
  // the worker
  const folk = new People(scene, { max: 4, viewH: H, budget: [4, 4], lodPx: [100, 40] });
  const hero = folk.add(People.random('steel', 11, { h: 1.84, heavy: 0.5, fem: 0, hat: true, hatColor: '#d8d2c4', top: '#2a3038', bottom: '#3a3026', accent: '#b84a1c', gloves: true, stubble: true }));
  folk.set(hero, { x: 0, y: 0, z: 0, heading: Math.PI + 0.35, act: 'fist', pump: 1, t: 1.3, look: -0.25 });
  folk.meshes.forEach(m => { m.castShadow = true; });
  let fl = null; if (Q.get('flesh') !== '0') fl = patchPeople(folk, { sss: 7, rim: 2.6, rimPow: 2.4, rimBack: 2.2, trans: 1.6, sheen: 0.9, hair: 1, warm: '#140202', sky: '#ff6a40', skyRim: 0.25, key: { dir: [0.2, -0.2, 1], color: '#ff9a70', intensity: 0.25 }, hero });
  const sun = new THREE.DirectionalLight('#ff7040', 5.5); sun.position.set(...sunDir.map(v => v * 30)); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 80 }); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02; scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight('#6a1a18', '#0a0304', 0.55));
  const atm = new Atmos(renderer, { w: W, h: H }); folk.meshes.forEach(m => m.layers.enable(atm.maskLayer));
  const painted = Q.get('paint') === '1' || Q.get('paint') === '2', pin = painted ? atm.fx.target('giant_pin', W, H, { type: 'byte' }) : null, paint = painted ? new Paint(atm.fx, { scale: 0.45 }) : null;
  return (t) => {
    // the Rodchenko camera: 0.35 m under the beam, pitched ~50 degrees up, rolled 16 degrees, wide
    camera.position.set(0.7 + 0.03 * Math.sin(t * 0.4), -0.42, 2.2); camera.up.set(Math.sin(-0.28), Math.cos(-0.28), 0); camera.lookAt(-0.1, 1.45, -0.2);
    camera.fov = 70; camera.updateProjectionMatrix();
    folk.set(hero, { t: 1.3 + t * 0.2 }); folk.update(camera);
    atm.render(scene, camera, ao({ sun: { dir: sunDir, color: '#ff5a24', intensity: 1.6 },
      haze: { color: '#140305', density: 0.0018, falloff: 0.012, g: 0.85, sun: 0.1, start: 6 },
      rays: { amount: 1.6, threshold: 1.1, length: 0.75, decay: 0.97, radius: 0.35, falloff: 4.0, tint: '#ffa070' },
      wrap: { amount: 0.35, radius: 0.8 }, edge: { amount: 1.6, width: 2.2, tint: '#ffd0a0' },
      glow: { amount: 0.4, threshold: 2.0 },
      grade: { exposure: 0.95, warm: '#220404', floor: '#0a0204', contrast: 0.2, saturation: 0.95, bleach: 0.5, vignette: 0.45, grain: painted ? 0 : 0.03, t } }), pin);
    if (painted) { const tp = performance.now(); if (Q.get('paint') === '2') paint.apply(pin, { srcMix: 1, impasto: 0, canvas: 0, streakColor: 0 }); else paint.apply(pin, { radius: 4, hard: 8, sharp: 6, keep: atm.mask, keepAmount: 1.0, stroke: 16, streak: 0.8, impasto: 0.85, light: [-0.5, 0.8], canvas: 0.45, saturation: 1.05, t });
      if (atm.profile) { atm.fx.sync(); atm.stats.paint = (atm.stats.paint || 0) + performance.now() - tp; } }
    return atm;
  };
};

// ------------------------------------------------------------------ the compelling human: back-lit profile
SHOTS.profile = async () => {
  const sunDir = [0.62, 0.2, -0.76];
  sky({ top: '#05060a', mid: '#140a0e', horizon: '#5a1c14', sunDir, sunColor: '#ff5a24', disc: 2.6, discI: 4.5, halo: 1.1, band: 0.25 });
  const folk = new People(scene, { max: 2, viewH: H, budget: [2, 2] });
  const hero = folk.add(People.random('weld', 5, { fem: 0, age: 0.4, h: 1.8, heavy: 0.45, skin: '#b07a58', hair: '#2a1c12', hat: true, hatColor: '#1c1a1a', hairStyle: 1, stubble: true, beard: false, top: '#4a3020', accent: '#3a2618', gloves: false }));
  folk.set(hero, { x: 0, y: 0, z: 0, heading: Math.PI / 2 - 0.2, act: 'stand', t: 2.0, look: -0.1 });
  let fl = null; if (Q.get('flesh') !== '0') fl = patchPeople(folk, { sss: 4, rim: 1.6, rimPow: 3.5, rimBack: 2.4, trans: 0.5, transColor: '#d0200a', sheen: 0.6, hair: 1.0, warm: '#1a0605', sky: '#5a6a9a', skyRim: 0.35, hero: -1, ...FLO });
  const sun = new THREE.DirectionalLight('#ff8a4a', 6); sun.position.set(...sunDir.map(v => v * 10)); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -1.2, right: 1.2, top: 1.2, bottom: -1.2, near: 1, far: 30 }); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.01; scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#4a5a8a', 0.35); fill.position.set(-2, 1, 3); scene.add(fill);
  scene.add(new THREE.HemisphereLight('#2a3048', '#120a08', 0.35));
  // out-of-focus foundry lights far behind (emissive spheres the glow turns into bokeh)
  const bm = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff9a40').multiplyScalar(4) });
  for (let i = 0; i < 14; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.5 + (i % 3) * 0.3, 12, 8), bm); s.position.set(-30 + i * 7 + Math.sin(i * 3.1) * 4, 2 + (i * 7 % 5), -60 - (i * 13 % 30)); scene.add(s); }
  const atm = new Atmos(renderer, { w: W, h: H }); folk.meshes.forEach(m => m.layers.enable(atm.maskLayer));
  return (t) => {
    camera.position.set(-1.25, 1.45, 1.55); camera.up.set(Math.sin(0.05), Math.cos(0.05), 0); camera.lookAt(0.05, 1.36, 0.0); camera.fov = 34; camera.updateProjectionMatrix();
    folk.set(hero, { t: 2.0 + t * 0.15 }); folk.update(camera);
    atm.render(scene, camera, ao({ sun: { dir: sunDir, color: '#ff7a38', intensity: 1.2 },
      haze: { color: '#0c0608', density: 0.02, falloff: 0.0, g: 0.7, sun: 0.35, start: 2 },
      rays: { amount: 0.6, threshold: 2, length: 0.6, radius: 0.35, tint: '#ffb080' },
      wrap: { amount: 0.7, radius: 1.2 }, edge: { amount: 0.8, width: 1.6, tint: '#ffc090' },
      glow: { amount: 0.55, threshold: 1.4 },
      grade: { exposure: 1.15, warm: '#1e0605', floor: '#07040a', contrast: 0.12, saturation: 1.05, bleach: 0.12, vignette: 0.5, grain: 0.05, t } }));
    return atm;
  };
};

// ------------------------------------------------------------------ BANK: the worker as a banknote engraving
SHOTS.engrave = async () => {
  const folk = new People(scene, { max: 2, viewH: H, budget: [2, 2] });
  const hero = folk.add(People.random('rail', 21, { fem: 0, age: 0.45, h: 1.8, heavy: 0.4, hat: true, stubble: true, beard: false, hairStyle: 1 }));
  const turn = +(Q.get('turn') || 0);
  const eng = engravePeople(folk, { lpm: 250, paper: '#efe6cf', ink: '#1b1a16', accent: '#a8141a', exposure: 2.2, gamma: 1.25, outline: 0.9, plate: 0.02, ...FLO });
  const key = new THREE.DirectionalLight('#ffffff', 4.0); key.position.set(-1.4, 2.4, 3.2); scene.add(key);
  const rim = new THREE.DirectionalLight('#ffffff', 1.1); rim.position.set(3, 1.5, -2); scene.add(rim);
  scene.add(new THREE.HemisphereLight('#ffffff', '#443322', 0.25));
  const fx = new Passes(renderer);
  return (t) => {
    const hd = Math.PI * 0.18 + (turn ? Math.sin(t * 1.2) * 0.55 : 0);
    folk.set(hero, { x: 0, y: 0, z: 0, heading: hd, act: 'stand', t: 3.0, look: turn ? -Math.sin(t * 1.2) * 0.2 : -0.08 });
    camera.position.set(0.15, 1.6, 2.0); camera.up.set(0, 1, 0); camera.lookAt(0.0, 1.43, 0.0); camera.fov = 30; camera.updateProjectionMatrix();
    folk.update(camera);
    renderer.setRenderTarget(null); renderer.toneMapping = THREE.NoToneMapping;
    plateBackground(fx, { center: [540, 1010], radius: [440, 600], lines: 6.5 });
    const ac = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth(); renderer.render(scene, camera); renderer.autoClear = ac;
    return null;
  };
};

// ------------------------------------------------------------------ THE IRON IS HOT: the pour, from above
SHOTS.molten = async () => {
  const t0 = performance.now();
  const rd = bakeRD({ size: 192, steps: 3000, ...RD_PRESETS.maze, seed: (x, y) => 0.004, rngSeed: 3 });
  window.labInfo = { rd_ms: Math.round(performance.now() - t0), cover: rd.v.reduce((a, v) => a + (v > 0.2), 0) / rd.v.length }; console.log('rd', JSON.stringify(window.labInfo));
  const F = new Fields(renderer), rt = F.fx.target('molten', W, H);
  return (t) => {
    F.fx.profile = !!window.__prof; F.fx.stats = {};
    F.molten(t, { rd, flow: 0.06, heat: 0.95, crust: 1, scale: 2.4, width: 0.21 }, rt);
    F.finish(rt, { exposure: 0.9, glow: 0.7, threshold: 1.0, warm: [0.05, 0.008, 0.004], floor: [0.02, 0.01, 0.01], bleach: 0.45, highlight: [1, 0.93, 0.8], contrast: 0.12, saturation: 1.05, vignette: 0.4, grain: 0.035, t });
    return null;
  };
};

// ------------------------------------------------------------------ REJUVENATION: rust grown from scratches, run backward
SHOTS.rust = async () => {
  // seeds: a few long scratches and pits, plus the stencil's edges (paint fails first at its edges)
  const cv = document.createElement('canvas'); cv.width = cv.height = 512; const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512); g.fillStyle = '#fff';
  for (let i = 0; i < 3; i++) g.fillRect(118, 150 + i * 80, 276, 44);          // the three bars
  const mask = g.getImageData(0, 0, 512, 512).data;
  const scratch = (x, y) => { const d1 = Math.abs((y - 0.2) - (x - 0.1) * 0.35), d2 = Math.abs((y - 0.75) + (x - 0.5) * 0.6), d3 = Math.abs(x - 0.83 - 0.05 * Math.sin(y * 9));
    return Math.min(d1, d2, d3) < 0.004 ? 0.12 : 0; };
  const edge = (x, y) => { const X = Math.floor(x * 511), Y = Math.floor(y * 511), m = mask[(Y * 512 + X) * 4];
    const n = mask[(Y * 512 + Math.min(511, X + 3)) * 4] + mask[(Math.min(511, Y + 3) * 512 + X) * 4] + mask[(Y * 512 + Math.max(0, X - 3)) * 4] + mask[(Math.max(0, Y - 3) * 512 + X) * 4];
    return (m > 0) !== (n / 4 > 127) ? 0.05 : 0; };
  const t0 = performance.now();
  const pits = (x, y) => { const h = Math.sin(x * 12.9898 * 512 + y * 78.233 * 512) * 43758.5453; return h - Math.floor(h) < 0.00025 ? 1 : 0; };
  // corrosion spreads from scratches, pits and the stencil's edges; faster along the brushing (x) and in a damp band low on the plate
  const rd = bakeGrowth({ size: 384, seed: (x, y) => Math.max(scratch(x, y) * 3, edge(x, 1 - y) * 4, pits(x, y)), speed: (x, y) => 0.6 + 0.8 * Math.exp(-Math.pow((y - 0.8) * 4, 2)), rough: 1.4, rngSeed: 11 });
  window.labInfo = { rd_ms: Math.round(performance.now() - t0) }; console.log('rd', JSON.stringify(window.labInfo));
  const F = new Fields(renderer), rt = F.fx.target('rust', W, H);
  const mtex = F.fx.canvasTexture(cv);
  const grow = +(Q.get('grow') || 0.5);
  return (t) => {
    F.rust(t, { rd, grow, light: [-0.8, 0.5, 0.3], mask: mtex }, rt);
    F.finish(rt, { exposure: 1.25, glow: 0.2, threshold: 1.2, warm: [0.03, 0.01, 0.006], floor: [0.012, 0.01, 0.01], bleach: 0.2, contrast: 0.15, saturation: 1.0, vignette: 0.45, grain: 0.04, t });
    return null;
  };
};

// ------------------------------------------------------------------ THE MAJORITY: the crowd as a wall, beams in smoke, one in front
SHOTS.cones = async () => {
  const sunDir = [0.1, 0.35, -1];            // the beams' key, behind the crowd, toward camera
  sky({ top: '#020204', mid: '#08040a', horizon: '#1a0608', sunDir, sunColor: '#ff3018', disc: 0.1, discI: 0, halo: 0.25, band: 0.2 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#0e0b0c', roughness: 0.92, metalness: 0.0 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const N = 150, folk = new People(scene, { max: N + 1, viewH: H, budget: [3, 60], lodPx: [300, 70], shadows: 'none' });
  for (let i = 0; i < N; i++) {
    const r = (k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
    const row = Math.floor(i / 25), x = (i % 25 - 12) * 1.05 + (r(1) - 0.5) * 0.7 + (row % 2) * 0.5, z = -14 - row * 1.6 - r(2) * 0.9;
    const id = folk.add(People.random(['steel', 'rail', 'overalls', 'weld', 'farm'][i % 5], 300 + i));
    folk.set(id, { x, y: 0, z, heading: (r(3) - 0.5) * 0.4, act: r(4) < 0.45 ? 'fist' : 'stand', t: r(5) * 10, pump: r(6) });
  }
  const hero = folk.add(People.random('steel', 7, { h: 1.85, hat: true, hatColor: '#c8201c', top: '#1c1c20', bottom: '#2a2622', gloves: true }));
  folk.set(hero, { x: 0.35, y: 0, z: -6.5, heading: 0.1, act: 'fist', pump: 1, t: 1 });
  const fl = patchPeople(folk, { sss: 5, rim: 2.2, rimPow: 2.5, rimBack: 2.5, trans: 0.6, sheen: 0.9, warm: '#120202', key: { dir: [0.3, 0.1, 1], color: '#ff6040', intensity: 0.5 }, hero });
  const key = new THREE.DirectionalLight('#ffd6b0', 3.5); key.position.set(...sunDir.map(v => v * 50)); scene.add(key, key.target);
  scene.add(new THREE.HemisphereLight('#20121a', '#050304', 0.4));
  // three stage beams from behind the crowd, raked toward the camera, and red flares burning in the crowd
  const beams = [];
  for (const [x, ang, c] of [[-9, 0.32, '#ffe2c0'], [2, -0.12, '#fff0dc'], [11, -0.36, '#ffd8b0']]) {
    const b = new LightCone({ height: 46, radius: 5.5, color: c, intensity: 4.0, dust: 0.8, motes: 0.3, seed: x });
    b.position.set(x, 30, -52); b.rotation.set(-0.55, 0, ang); scene.add(b); beams.push(b);
    // a real spot along each beam: pools on the ground and hard rims on the crowd (the volume alone lights nothing)
    const sp = new THREE.SpotLight(c, 6000, 90, Math.atan(5.5 / 46), 0.5, 1.6); sp.position.copy(b.position);
    const dir = new THREE.Vector3(0, -1, 0).applyEuler(b.rotation); sp.target.position.copy(b.position).addScaledVector(dir, 40); scene.add(sp, sp.target);
  }
  const flareM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a10').multiplyScalar(30) });
  for (const [x, y, z] of [[-6, 2.3, -17], [4.5, 2.5, -20], [9, 2.2, -16.5], [-2, 2.6, -24]]) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), flareM); f.position.set(x, y, z); scene.add(f);
    const pl = new THREE.PointLight('#ff3010', 14, 12, 1.6); pl.position.set(x, y, z); scene.add(pl);
  }
  const atm = new Atmos(renderer, { w: W, h: H }); folk.meshes.forEach(m => m.layers.enable(atm.maskLayer));
  return (t) => {
    camera.position.set(0.8, 0.75, 1.5); camera.up.set(Math.sin(0.03), Math.cos(0.03), 0); camera.lookAt(0.1, 3.4, -20); camera.fov = 30; camera.updateProjectionMatrix();
    for (const b of beams) b.update(t);
    folk.set(hero, { t: 1 + t * 0.3 }); folk.update(camera);
    atm.render(scene, camera, ao({ sun: { dir: sunDir, color: '#ffc8a0', intensity: 1 },
      haze: { color: '#0e0207', density: 0.03, falloff: 0.12, g: 0.7, sun: 0.02, start: 6, max: 0.88 },
      rays: { amount: 0 }, wrap: { amount: 0.3, radius: 1.0 }, edge: { amount: 0.45, width: 1.4, tint: '#ffd8b8' },
      glow: { amount: 0.6, threshold: 1.1 },
      grade: { exposure: 1.1, warm: '#1e0303', floor: '#060204', contrast: 0.16, saturation: 1.05, bleach: 0.45, vignette: 0.5, grain: 0.045, t } }));
    return atm;
  };
};

// ------------------------------------------------------------------ the painted foundry: pour, channel, silhouettes, shafts; then paint
SHOTS.paint = async () => {
  const F = new Fields(renderer);
  const rd = bakeRD({ size: 160, steps: 2200, ...RD_PRESETS.maze, seed: () => 0.006, rngSeed: 9 });
  const moltenRT = F.fx.target('pnt_molten', 512, 1024, { wrap: 'repeat' });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: '#171210', roughness: 0.8 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const chan = new THREE.Mesh(new THREE.PlaneGeometry(5, 36), new THREE.MeshBasicMaterial({ map: moltenRT.texture, color: new THREE.Color(0.26, 0.26, 0.26) }));
  chan.rotation.x = -Math.PI / 2; chan.position.set(0, 0.02, -6); scene.add(chan);
  // hall: dark columns and a high wall with windows (the shafts come through them)
  const dark = new THREE.MeshStandardMaterial({ color: '#0e0b0a', roughness: 0.9 });
  for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.9, 18, 0.9), dark); c.position.set(sx * 9, 9, -4 - i * 7); c.castShadow = true; scene.add(c); }
  const wall = new THREE.Mesh(new THREE.BoxGeometry(60, 30, 1), dark); wall.position.set(0, 15, -46); scene.add(wall);
  // the ladle, tipped, and its stream
  const prof = [[0, -1.6], [1.4, -1.6], [1.6, -1.3], [1.9, 1.2], [2.25, 1.45], [2.25, 1.62], [1.95, 1.62], [1.7, 1.3], [1.4, -1.35], [0, -1.35]].map(([x, y]) => new THREE.Vector2(x, y));
  const ladle = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), new THREE.MeshStandardMaterial({ color: '#1c1512', roughness: 0.55, metalness: 0.6, side: THREE.DoubleSide }));
  ladle.position.set(-1.6, 7.2, -24); ladle.rotation.z = -0.9; ladle.castShadow = true; scene.add(ladle);
  for (const sz of [-1, 1]) { const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 12), ladle.material); pin.rotation.x = Math.PI / 2; pin.position.set(-1.6, 7.3, -24 + sz * 2.4); scene.add(pin);
    const hang = new THREE.Mesh(new THREE.BoxGeometry(0.3, 12, 0.3), ladle.material); hang.position.set(-1.6, 13.4, -24 + sz * 2.6); scene.add(hang); }
  const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb040').multiplyScalar(9) });
  const lip = new THREE.Mesh(new THREE.CircleGeometry(1.9, 24), glowM); lip.position.copy(ladle.position); lip.rotation.set(0, 0, -0.9); lip.translateY(1.55); lip.rotateX(-Math.PI / 2); scene.add(lip);
  // the stream: a tapering, twisting rope of melt, textured by the same molten field scrolling down it
  const sg = new THREE.CylinderGeometry(0.2, 0.36, 6.6, 20, 40, true); { const P = sg.attributes.position;
    for (let i = 0; i < P.count; i++) { const y = P.getY(i), a = Math.atan2(P.getZ(i), P.getX(i)), r = Math.hypot(P.getX(i), P.getZ(i)) * (1 + 0.18 * Math.sin(y * 5.1 + a * 3) + 0.1 * Math.sin(y * 13 - a * 2));
      P.setXYZ(i, Math.cos(a) * r + 0.06 * Math.sin(y * 2.3), y, Math.sin(a) * r); } sg.computeVertexNormals(); }
  const streamM = new THREE.MeshBasicMaterial({ map: moltenRT.texture, color: new THREE.Color(2.4, 2.1, 1.8) });
  const stream = new THREE.Mesh(sg, streamM); stream.position.set(0.1, 3.4, -23.2); stream.rotation.z = 0.12; scene.add(stream);
  const splash = new THREE.PointLight('#ff8a30', 45, 22, 1.6); splash.position.set(0.3, 0.8, -22.5); scene.add(splash);
  for (const [x, z, i] of [[0, -22, 30], [0, -12, 14], [0, -3, 9]]) { const pl = new THREE.PointLight('#ff6a20', i, 18, 2); pl.position.set(x, 1.2, z); scene.add(pl); }
  scene.add(new THREE.HemisphereLight('#28303c', '#0a0605', 0.35));
  // the workers along the channel, at work, one close
  const folk = new People(scene, { max: 8, viewH: H, budget: [6, 8] });
  const spots = [[-3.3, -6, 1.2], [3.1, -10, -1.7], [-3.4, -14, 1.4], [3.5, -18, -1.4], [-2.9, -21, 1.1], [2.2, -1.2, -1.1]];
  spots.push([2.9, -16.5, -1.75]);
  spots.forEach(([x, z, hd], i) => { const id = folk.add(People.random(['steel', 'weld', 'overalls'][i % 3], 40 + i, { hat: true, h: i === 6 ? 1.86 : undefined })); folk.set(id, { x, y: 0, z, heading: hd, act: 'work', ph: (i * 0.37) % 1 }); });
  patchPeople(folk, { sss: 5, rim: 2.2, rimPow: 2.4, rimBack: 2, trans: 0.6, sheen: 0.8, warm: '#140403' });
  for (const x of [-9, -3, 3]) { const b = new LightCone({ height: 40, radius: 2.4, color: '#a8b8ff', intensity: 3.0, dust: 0.9, motes: 0.3, seed: x });
    b.position.set(x, 28, -40); b.rotation.set(-0.42, 0, 0.42); scene.add(b); }
  const atm = new Atmos(renderer, { w: W, h: H }); folk.meshes.forEach(m => m.layers.enable(atm.maskLayer));
  const painted = F.fx.target('pnt_in', W, H, { type: 'byte' });
  const paint = new Paint(F.fx, { scale: 0.45 });
  const raw = Q.get('raw') === '1';
  return (t) => {
    F.molten(t, { rd, flow: 0.08, heat: 0.93, crust: 1.4, scale: 2.0, width: 0.5, bank: 0 }, moltenRT); streamM.map.offset.set(0, -t * 0.8);
    camera.position.set(3.2, 1.3, -5.5); camera.up.set(Math.sin(-0.06), Math.cos(-0.06), 0); camera.lookAt(-0.6, 4.2, -24); camera.fov = 50; camera.updateProjectionMatrix();
    folk.update(camera);
    atm.render(scene, camera, ao({ sun: { dir: [0.1, 0.4, -1], color: '#ff9040', intensity: 1 },
      haze: { color: '#0c0506', density: 0.02, falloff: 0.05, g: 0.6, sun: 0.05, start: 3, max: 0.85 },
      rays: { amount: 0 }, wrap: { amount: 0.7, radius: 1.3 }, edge: { amount: 1.0, width: 1.8, tint: '#ffcc99' },
      glow: { amount: 0.7, threshold: 1.0 },
      grade: { exposure: 1.3, warm: '#1c0703', floor: '#070405', contrast: 0.14, saturation: 1.05, bleach: 0.35, vignette: 0.45, grain: raw ? 0.03 : 0.0, t } }), raw ? null : painted);
    if (!raw) { F.fx.profile = !!window.__prof; const tp = performance.now(); paint.apply(painted, { radius: 6, hard: 8, sharp: 8, stroke: 20, streak: 0.8, impasto: 0.9, light: [-0.55, 0.75], canvas: 0.4, saturation: 1.08, t, ...PNO }); if (F.fx.profile) { F.fx.sync(); atm.stats.paint = (atm.stats.paint || 0) + performance.now() - tp; } }
    return atm;
  };
};

// ------------------------------------------------------------------ run
const draw = await SHOTS[SHOT]();
window.labStats = {};
window.renderFrame = async (t) => {
  const t0 = performance.now();
  const a = await draw(t);
  const gl = renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return { ms: performance.now() - t0, stages: a && a.stats ? { ...a.stats } : {} };
};
window.profileFrame = async (t) => {     // per-stage ms (GPU synced after each stage)
  const a = await draw(t); if (!a || !('profile' in a)) return {};
  a.profile = true; a.stats = {}; if (a.fx) { a.fx.profile = false; } window.__prof = true;
  await draw(t); a.profile = false; window.__prof = false; return { ...a.stats };
};
ready = true;
