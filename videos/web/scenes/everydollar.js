// EVERY DOLLAR (4 Oct 2026, new piece; timely for the December retail peak). Who actually earned the money.
// One daylight logistics world, one clause per shot: the yard (EVERY DOLLAR), the crane, the shift walking in (THE WORK OF THE
// PEOPLE), the shop floor, the trucks, the warehouse aisle, the counting (rows of workers, the camera rising until the rows fill
// the yard), the IWW preamble over the crowd at the docks (AN INJURY TO ONE / ALL: one fist, then every fist), the march, the close.
// Words verbatim: ACP, Statement in Support of Amazon Strike, 19 Dec 2024 (research/sources/texts/acp-d-statement-support-amazon-strike.txt);
// the I.W.W. Preamble as printed in Solidarity, 7 May 1910 (research/sources/texts/paper-iww-solidarity-1910-05-07.txt).
// Assets: MODELING's tractor_aero + van53, container_40hc (buildYard), sts_crane + trolley + spreader; People (instanced, by trade,
// workforce.js workerDesc bodies). Type: MECHA's makeType (Chakra Petch, cream with an ink keyline). Song: audio/songs2/everydollar.py.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { W, H, clamp, lerp, ease, rng, loadBeats, loadFonts, closer } from '../lib/kit.js';
import { RQ } from '../lib/rq.js';
import { makeType } from './mecha.type2.js';
import { loadAsset, loadPart } from '../lib/fx/modeling/asset.js';
import { buildYard, stackBlock } from '../lib/fx/modeling/yard.js';
import { People } from '../lib/fx/people.js';
import { workerDesc } from '../lib/fx/workforce.js';
import { loadAnsur } from '../lib/fx/rig/body.js';
THREE.ColorManagement.enabled = true;
const Q = new URLSearchParams(location.search);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ================================================================ the words, beat for beat (104 BPM; songs2/everydollar.py CUES)
// [beat, 'LINE|LINE', emphasis, until-beat, cap]
const CUES = [
  [0, 'EVERY|DOLLAR', 1, 5, 250],
  [5, 'LINING THE|BLOOD-DRENCHED|POCKETS', 0, 8.5, 150],
  [8.5, 'OF THIS|SOCIAL SCUM', 1, 11, 170],
  [11, 'WAS EARNED|NOT BY|HARD WORK', 0, 15, 160],
  [15, 'BUT FROM|THE WORK OF|THE PEOPLE', 1, 19, 160],
  [19, 'ON THE|SHOP FLOOR,', 1, 24, 190],
  [24, 'IN THE|TRUCKS,', 1, 29, 230],
  [29, 'AND IN THE|WAREHOUSES.', 1, 35, 170],
  [35, 'RAILWAY,|INDUSTRIAL,|COMMERCIAL,|AND SERVICE|WORKERS:', 0, 41, 150],
  [41, 'IN SUM,|THE OVERWHELMING|MAJORITY OF|ALL AMERICANS.', 1, 47, 150],
  [47, 'THE WORKING CLASS|AND THE|EMPLOYING CLASS|HAVE NOTHING|IN COMMON.', 0, 53, 140],
  [53, 'AN INJURY|TO ONE', 1, 55.5, 210],
  [55.5, 'AN INJURY|TO ALL.', 1, 58, 210],
  [58, 'THIS BATTLE|IS NOT|THE FIRST', 0, 61, 180],
  [61, 'AND IT WILL|NOT BE|THE LAST.', 1, 64, 180],
  [64, 'WE LOOK|TOWARDS VICTORY|AND A NEW AMERICA|FREE OF THE|PARASITES.', 1, 71, 140],
];
const CLOSE = 71;
const DATELINE = b => (b >= 47 && b < 58) ? 'I.W.W. PREAMBLE  ·  SOLIDARITY, 7 MAY 1910' : 'AMERICAN COMMUNIST PARTY  ·  19 DECEMBER 2024';

// ================================================================ boot
await loadFonts();
for (const [name, url, style] of [['Chakra Petch', '../assets/fonts/chakra-petch-latin-700-normal.woff2', 'normal'], ['Chakra Petch', '../assets/fonts/chakra-petch-latin-700-italic.woff2', 'italic'],
  ['Big Shoulders Stencil Display', '../node_modules/@fontsource/big-shoulders-stencil-display/files/big-shoulders-stencil-display-latin-700-normal.woff2', 'normal']]) {
  const f = new FontFace(name, `url(${url})`, { weight: '700', style }); document.fonts.add(await f.load());
}
const BEATS = await loadBeats('everydollar');
const SPB = BEATS.spb;
if (!(SPB > 0.5 && SPB < 0.65)) throw new Error(`everydollar: beat map says spb=${SPB}, the score is 104 BPM`);
const bt = b => b * SPB;
const out = document.getElementById('out'); out.width = W; out.height = H;
const ctx = out.getContext('2d');
const ADOPT = false;   // GRAPHICS 4.A (lib/rq.js): true = native resolution on the GPU and a fenced copy, once this piece's farm A/B says so
const SC = RQ.scale(0.75, ADOPT), RW = Math.round(W * SC), RH = Math.round(H * SC);
const glc = document.createElement('canvas');
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(RW, RH, false);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 5000);
const T = makeType(ctx, W, H);
const R0 = rng(1219);

// ================================================================ light
// v3 (7 Oct): the night shift. v2's clear December morning lit the whole world evenly and the people read as toys (the client's 'cartoon' note
// elsewhere). Now the December peak runs at night: a dark sky, a low cold moon for shape and shadow, and the yard under tall sodium light towers whose
// pools and glare carry the picture; the people are lit from above and behind, figures against light. NIGHT=0 (?night=0) gives v2's morning.
const NIGHT = (Q.get('night') ?? '1') !== '0';
const HAZE = new THREE.Color(NIGHT ? '#0d1119' : '#d9e1e6');
scene.fog = new THREE.Fog(HAZE, NIGHT ? 90 : 260, NIGHT ? 900 : 1900);
const sky = (() => {
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { zen: { value: new THREE.Color(NIGHT ? '#03050b' : '#5d8fc4') }, hor: { value: new THREE.Color(NIGHT ? '#1a1814' : '#dfe7ec') }, sun: { value: V3(-0.55, 0.42, 0.72).normalize() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `varying vec3 vD; uniform vec3 zen, hor, sun;
      void main(){ float h = clamp(vD.y, 0., 1.); vec3 c = mix(hor, zen, pow(h, 0.55)); float s = max(0., dot(normalize(vD), sun));
        c += vec3(1.0, 0.86, 0.66) * (pow(s, 24.) * 0.35 + pow(s, 4.) * 0.06) * ${NIGHT ? '0.0' : '1.0'}; if (vD.y < 0.) c = hor; gl_FragColor = vec4(c, 1.); }` });
  const s = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), m); s.renderOrder = -1; s.frustumCulled = false; scene.add(s); return s;
})();
const SUN_DIR = V3(-0.55, 0.62, 0.56).normalize();
const sun = new THREE.DirectionalLight(NIGHT ? '#9fb4d8' : '#fff0dc', NIGHT ? 0.55 : 3.1);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const hemi = NIGHT ? new THREE.HemisphereLight('#ffb27a', '#3a2a1c', 0.6) : new THREE.HemisphereLight('#cfe0f4', '#857a68', 1.15); scene.add(hemi);
// the yard's light towers: tall poles, a sodium head, a spot down on the concrete (no shadows: the moon has them); their glare is drawn in 2D
const TOWERS = NIGHT ? [[-85, 10], [85, 10], [125, -5], [155, -35], [-120, 45], [-95, -45], [95, -45], [-65, 95], [65, 95], [0, -60], [-140, -10]] : [];   // the perimeter (v3a's in-yard towers barred the shots)
// the sodium pools, laid on the concrete (additive, fogged): the yard's light is where people stand
const POOLS = NIGHT ? [[0, 20, 46], [-45, 30, 34], [45, 30, 34], [0, -15, 40], [-60, -20, 30], [60, -15, 30], [-30, 60, 32], [30, 62, 32], [-125, -48, 26], [-115, 40, 30],
  [120, 0, 34], [150, -30, 30], [0, 85, 36], [-40, 95, 26], [40, 95, 26]] : [];
{ const c = Object.assign(document.createElement('canvas'), { width: 256, height: 256 }), g = c.getContext('2d'); const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,170,90,0.85)'); gr.addColorStop(0.35, 'rgba(255,140,60,0.45)'); gr.addColorStop(0.7, 'rgba(200,100,40,0.14)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256); const T = new THREE.CanvasTexture(c); T.colorSpace = THREE.SRGBColorSpace;
  const M = new THREE.MeshBasicMaterial({ map: T, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  for (const [x, z, r] of POOLS) { const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * r, 2 * r).rotateX(-Math.PI / 2), M); m.position.set(x, 0.05, z); m.renderOrder = 1; scene.add(m); } }
const TOWER_H = 40;
// (v3a tried real SpotLights at the towers: they did not read through the ACES grade and cost a forward-lit pass per lamp over thousands of
// people, ~40 s a frame on CPU; the pools below carry the light. The towers' positions are kept for the glare.)
{ const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = NIGHT ? 0.06 : 0.35; }
function shadowBox(c, r) {
  sun.position.copy(c).addScaledVector(SUN_DIR, 400); sun.target.position.copy(c); sun.target.updateMatrixWorld();
  const sc = sun.shadow.camera; sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 10; sc.far = 900; sc.updateProjectionMatrix();
}

// ================================================================ materials and textures
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
const texOf = (c, rx = 1, ry = 1) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8; return t; };
const concreteTex = (() => {          // 12 m tile, saw-cut joints every 6 m, mottle and tyre grime
  const [c, g] = cv(1024, 1024), r = rng(5); g.fillStyle = '#a19d94'; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 9000; i++) { const v = 130 + r() * 50; g.fillStyle = `rgba(${v},${v - 3},${v - 9},${0.05 + r() * 0.08})`; const s = 4 + r() * 40; g.fillRect(r() * 1024, r() * 1024, s, s); }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(40,38,34,${0.03 + r() * 0.05})`; g.beginPath(); g.ellipse(r() * 1024, r() * 1024, 30 + r() * 160, 10 + r() * 50, r() * 3, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(55,52,48,0.55)'; for (const k of [0, 512]) { g.fillRect(k, 0, 3, 1024); g.fillRect(0, k, 1024, 3); }
  return c; })();
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1700, 2400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: texOf(concreteTex, 1700 / 12, 2400 / 12), roughness: 0.95 }));
ground.position.set(170 - 850, 0, 0); ground.receiveShadow = true; scene.add(ground);
const ribTex = (base, w = 256) => { const [c, g] = cv(w, 64); g.fillStyle = base; g.fillRect(0, 0, w, 64);
  for (let x = 0; x < w; x += 32) { const gr = g.createLinearGradient(x, 0, x + 32, 0); gr.addColorStop(0, 'rgba(0,0,0,0.16)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.10)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.04)'); gr.addColorStop(1, 'rgba(0,0,0,0.16)'); g.fillStyle = gr; g.fillRect(x, 0, 32, 64); }
  return c; };
const M = {
  wall: new THREE.MeshStandardMaterial({ map: texOf(ribTex('#cfccc3'), 120 / 3.2, 1), roughness: 0.6, metalness: 0.2 }),
  wallSide: new THREE.MeshStandardMaterial({ map: texOf(ribTex('#cfccc3'), 60 / 3.2, 1), roughness: 0.6, metalness: 0.2 }),
  band: new THREE.MeshStandardMaterial({ color: '#2d3a4c', roughness: 0.5, metalness: 0.3 }),
  roof: new THREE.MeshStandardMaterial({ color: '#8f9296', roughness: 0.7, metalness: 0.3 }),
  dock: new THREE.MeshStandardMaterial({ color: '#77736c', roughness: 0.9 }),
  rubber: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.85 }),
  door: new THREE.MeshStandardMaterial({ map: texOf((() => { const [c, g] = cv(64, 256); g.fillStyle = '#6a7684'; g.fillRect(0, 0, 64, 256); for (let y = 0; y < 256; y += 16) { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, y, 64, 2); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, y + 2, 64, 2); } return c; })(), 1, 1), roughness: 0.5, metalness: 0.4 }),
  yellow: new THREE.MeshStandardMaterial({ color: '#e0b21c', roughness: 0.6 }),
  white: new THREE.MeshStandardMaterial({ color: '#e8e6e0', roughness: 0.7 }),
  upright: new THREE.MeshStandardMaterial({ color: '#264f93', roughness: 0.45, metalness: 0.4 }),
  beam: new THREE.MeshStandardMaterial({ color: '#e0631c', roughness: 0.45, metalness: 0.3 }),
  steel: new THREE.MeshStandardMaterial({ color: '#3a3c3f', roughness: 0.45, metalness: 0.8 }),
  hot: new THREE.MeshStandardMaterial({ color: '#ff8a2a', emissive: '#ff5a10', emissiveIntensity: 3.2, roughness: 0.6 }),
  wood: new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 0.85 }),
  asphalt: new THREE.MeshStandardMaterial({ color: '#3f4042', roughness: 0.92 }),
  hull: new THREE.MeshStandardMaterial({ color: '#2a3038', roughness: 0.6, metalness: 0.3 }),
  hullRed: new THREE.MeshStandardMaterial({ color: '#7d2420', roughness: 0.7 }),
  water: new THREE.MeshStandardMaterial({ color: '#3f5b6c', roughness: 0.25, metalness: 0.2 }),
};
function box(w, h, d, mat, x, y, z, parent = scene, { cast = true, recv = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = recv; parent.add(m); return m;
}
function instBoxes(list, mat, { cast = true, color = null } = {}) {   // list: [x, y, z, w, h, d] (y = base)
  const g = new THREE.BoxGeometry(1, 1, 1), im = new THREE.InstancedMesh(g, mat, list.length), m4 = new THREE.Matrix4();
  list.forEach((b, i) => { m4.makeScale(b[3], b[4], b[5]); m4.setPosition(b[0], b[1] + b[4] / 2, b[2]); im.setMatrixAt(i, m4); if (color) im.setColorAt(i, color(i, b)); });
  im.castShadow = cast; im.receiveShadow = true; im.frustumCulled = false; scene.add(im); return im;
}

// ================================================================ the warehouse: 120 x 60 m, dock floor at 1.2 m, 25 dock doors on the yard face (z = -30)
const WH = { x0: -60, x1: 60, z0: -90, z1: -30, h: 13.2, floor: 1.2 };
const DOORS = Array.from({ length: 25 }, (_, i) => -50.4 + 4.2 * i);
const DOCKED = [1, 3, 4, 6, 8, 9, 11, 13, 14, 16, 18, 19, 21, 23];          // doors with a trailer backed in
box(120, WH.floor, 60, M.dock, 0, WH.floor / 2, -60);                                         // the dock slab
box(120, WH.h - 4.4, 0.3, M.wall, 0, 4.4 + (WH.h - 4.4) / 2, WH.z1);                            // the yard face above the doors
box(120, 1.0, 0.34, M.band, 0, WH.h - 0.5, WH.z1);                                              // the fascia band
box(120, WH.h, 0.3, M.wall, 0, WH.h / 2, WH.z0);
for (const x of [WH.x0, WH.x1]) box(0.3, WH.h, 60, M.wallSide, x, WH.h / 2, -60);
for (let i = 0; i <= DOORS.length; i++) { const xa = i === 0 ? WH.x0 : DOORS[i - 1] + 1.5, xb = i === DOORS.length ? WH.x1 : DOORS[i] - 1.5; box(xb - xa, 3.2, 0.3, M.wall, (xa + xb) / 2, WH.floor + 1.6, WH.z1); }
DOORS.forEach((x, i) => {
  const docked = DOCKED.includes(i);
  box(3.0, docked ? 0.6 : 3.2, 0.12, M.door, x, docked ? 4.1 : WH.floor + 1.6, WH.z1 + 0.05);    // the roll-up door (up when a trailer is in)
  for (const s of [-1, 1]) box(0.25, 0.45, 0.3, M.rubber, x + s * 1.1, 0.95, WH.z1 + 0.3);      // dock bumpers
  if (docked) { for (const s of [-1, 1]) box(0.35, 3.6, 0.5, M.rubber, x + s * 1.75, WH.floor + 1.8, WH.z1 + 0.35); box(3.8, 0.6, 0.5, M.rubber, x, 4.75, WH.z1 + 0.35); }
  box(0.12, 1.2, 0.12, M.yellow, x + 2.1, 0.6, WH.z1 + 0.6);                                     // bollard
});
// the roof: panels with skylight strips (the sun comes into the aisles in bars)
for (let x = WH.x0; x < WH.x1 - 0.1; x += 8) box(6.6, 0.3, 60, M.roof, x + 3.3, WH.h + 0.15, -60, scene, { cast: true, recv: true });
for (let x = WH.x0; x < WH.x1 - 0.1; x += 8) { const sk = box(1.4, 0.06, 60, new THREE.MeshStandardMaterial({ color: '#c8d6dc', roughness: 0.2, transparent: true, opacity: 0.35 }), x + 7.3, WH.h + 0.2, -60, scene, { cast: false, recv: false }); }
// racks: double-deep selective racking, aisles along z, blue uprights, orange beams, five levels of cartons
const RACK = { xs: Array.from({ length: 21 }, (_, k) => -55 + k * 5.5), z0: -86, z1: -40, bay: 2.7, levels: [0.15, 1.9, 3.65, 5.4, 7.15] };
const NBAY = Math.floor((RACK.z1 - RACK.z0) / RACK.bay);
{
  const ups = [], beams = [], cartons = [], R = rng(31);
  for (const cx of RACK.xs) for (const s of [-1, 1]) {
    const fx = cx + s * 1.1, bx = cx + s * 0.12;
    for (let b = 0; b <= NBAY; b++) { const z = RACK.z0 + b * RACK.bay; ups.push([fx, WH.floor, z, 0.09, 9.2, 0.09], [bx, WH.floor, z, 0.09, 9.2, 0.09]); }
    for (let b = 0; b < NBAY; b++) {
      const zc = RACK.z0 + (b + 0.5) * RACK.bay;
      for (const ly of RACK.levels) {
        const y = WH.floor + ly + 1.55; if (ly > 0.2) beams.push([fx, y - 0.13, zc, 0.06, 0.13, RACK.bay], [bx, y - 0.13, zc, 0.06, 0.13, RACK.bay]);
        for (let p = 0; p < 3; p++) { if (R() < 0.07) continue;
          const h = 0.7 + R() * 0.75, w = 0.78 + R() * 0.1, z = zc + (p - 1) * 0.88;
          cartons.push([cx + s * 0.62, WH.floor + ly + (ly > 0.2 ? 0 : 0), z, 1.0 - R() * 0.08, h, w]);
          if (R() < 0.45 && h < 1.1) cartons.push([cx + s * 0.62 + (R() - 0.5) * 0.1, WH.floor + ly + h, z + (R() - 0.5) * 0.1, 0.7 + R() * 0.2, 0.3 + R() * 0.3, 0.6 + R() * 0.2]);
        }
      }
    }
  }
  instBoxes(ups, M.upright); instBoxes(beams, M.beam);
  const [c, g] = cv(256, 256); g.fillStyle = '#c9a274'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '90,60,30' : '230,200,160'},${0.04 + R() * 0.05})`; g.fillRect(R() * 256, R() * 256, 1 + R() * 3, 1 + R() * 3); }
  g.fillStyle = 'rgba(205,180,140,.95)'; g.fillRect(112, 0, 32, 256);                          // the tape
  g.fillStyle = '#f2efe6'; g.fillRect(28, 150, 70, 46); g.fillStyle = '#1a1a1a'; for (let k = 0; k < 6; k++) g.fillRect(33 + k * 10, 156, 5, 22); g.fillRect(33, 184, 58, 4);
  const cm = new THREE.MeshStandardMaterial({ map: texOf(c), roughness: 0.85 });
  instBoxes(cartons, cm, { color: (i) => new THREE.Color().setHSL(0.085 + (R() - 0.5) * 0.02, 0.35 + R() * 0.15, 0.78 + R() * 0.18) });
  // aisle lines on the floor
  instBoxes(RACK.xs.flatMap(cx => [[cx - 1.45, WH.floor + 0.005, -63, 0.12, 0.01, 46], [cx + 1.45, WH.floor + 0.005, -63, 0.12, 0.01, 46]]), M.yellow, { cast: false });
}

// ================================================================ the shop floor: a 50 x 40 m shed west of the warehouse, the yard side open
const SH = { x0: -150, x1: -100, z0: -75, z1: -35, h: 10 };
box(50, SH.h, 0.3, M.wall, -125, SH.h / 2, SH.z0);
for (const x of [SH.x0, SH.x1]) box(0.3, SH.h, 40, M.wallSide, x, SH.h / 2, -55);
box(50, 3.5, 0.3, M.wall, -125, SH.h - 1.75, SH.z1);                                              // the header over the open face
for (let x = SH.x0; x < SH.x1 - 0.1; x += 6.25) box(5.0, 0.3, 40, M.roof, x + 2.5, SH.h + 0.15, -55);
for (let x = SH.x0 + 6.25; x < SH.x1 - 0.1; x += 12.5) box(0.4, SH.h, 0.4, M.steel, x, SH.h / 2, SH.z1);   // portal columns
const ANVILS = [];      // stations: [x, z, facing]; two rows of hammermen down the shed
for (let k = 0; k < 6; k++) for (const s of [-1, 1]) ANVILS.push({ x: -125 + s * 4.2, z: -40.5 - k * 5.2, f: s });
for (const a of ANVILS) {
  const g = new THREE.Group(); g.position.set(a.x, 0, a.z); scene.add(g);
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.55, 16), M.wood); stump.position.y = 0.275; stump.castShadow = stump.receiveShadow = true; g.add(stump);
  box(0.62, 0.18, 0.24, M.steel, 0, 0.64, 0, g); box(0.34, 0.1, 0.18, M.steel, 0, 0.5, 0, g); box(0.42, 0.08, 0.3, M.steel, 0, 0.42, 0, g);
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 12).rotateZ(Math.PI / 2), M.steel); horn.position.set(-0.45, 0.68, 0); g.add(horn);
  a.hot = box(0.3, 0.04, 0.05, M.hot, 0.05, 0.75, 0, g, { cast: false });
}
const MILL = await loadAsset('mill/mill_stand', { lod: 0 }); MILL.root.position.set(-125, 0, -70); MILL.root.rotation.y = 0.3; scene.add(MILL.root);
for (let k = 0; k < 6; k++) for (const s of [-1, 1]) { const l = await loadPart('hanging_industrial_lamp', { tint: 0xd8d8d8 }); l.root.position.set(-125 + s * 4.2, 6.2, -40.5 - k * 5.2); scene.add(l.root); }
for (let k = 0; k < 4; k++) { const b = await loadPart('barrel_03'); b.root.position.set(-146 + k * 0.8, 0, -72 + (k % 2) * 0.8); scene.add(b.root); }
{ const tc = await loadPart('metal_tool_chest'); tc.root.position.set(-104, 0, -60); tc.root.rotation.y = -Math.PI / 2; scene.add(tc.root); }
// GRAPHICS 4.C (8 Oct): ?kits=1 dresses the shop floor with the CC0 shop kit (assets/objects/parts/kits.json): a steel bench with
// the vice and the bench drill at the right-hand edge of the anvil-line shot (b19-24), the rest along the right-hand row to the
// mill stand, each a THREE.LOD of its hero/mid/far roles. A test, not a re-release: without kits=1 nothing here is built or
// loaded. A member not ingested yet is skipped.
if (Q.get('kits') === '1') {
  const BENCH = { x: -118.55, z: -61, top: 0.86 };
  box(0.72, 0.05, 1.9, M.steel, BENCH.x, BENCH.top - 0.025, BENCH.z);
  for (const dz of [-0.85, 0.85]) for (const dx of [-0.3, 0.3]) box(0.05, BENCH.top - 0.05, 0.05, M.steel, BENCH.x + dx, (BENCH.top - 0.05) / 2, BENCH.z + dz);
  const KIT = [   // [id, x, y, z, rotation y]: the vice's T-bar hangs over the bench's front edge
    ['bench_vice_01', BENCH.x - 0.19, BENCH.top, BENCH.z + 0.6, -Math.PI / 2], ['drill_press_01', BENCH.x + 0.02, BENCH.top, BENCH.z - 0.45, -Math.PI / 2],
    ['sledgehammer_01', BENCH.x - 0.42, 0, BENCH.z + 1.05, 0.4], ['tool_cart', -118.7, 0, -55.8, -Math.PI / 2], ['hand_truck', -118.9, 0, -51.5, -0.5],
    ['steel_frame_shelves_01', -118.0, 0, -66.2, -Math.PI / 2], ['portable_welding_cart', -119.6, 0, -68.8, -0.9], ['worn_metal_rack', -121.2, 0, -74.3, 0],
  ];
  for (const [id, x, y, z, ry] of KIT) {
    let p; try { p = await loadPart(id, { lod: 'auto', camera }); } catch (e) { console.warn(`everydollar kits=1: ${id} not ingested yet`); continue; }
    p.root.position.set(x, y, z); p.root.rotation.y = ry; scene.add(p.root);
  }
}
const shopLight = new THREE.PointLight('#ffd7a0', 0, 30, 1.6); shopLight.position.set(-125, 5, -48); scene.add(shopLight);

// ================================================================ the port: container stacks, the quay at x = 170, an STS crane over a ship
const STACKS = [...stackBlock({ x: 72, z0: -82, bays: 6, cols: 3, tiers: [2, 5], seed: 3 }), ...stackBlock({ x: 90, z0: -82, bays: 6, cols: 3, tiers: [2, 5], seed: 8 }),
  ...stackBlock({ x: 108, z0: -82, bays: 6, cols: 3, tiers: [3, 5], seed: 11 }), ...stackBlock({ x: 126, z0: -82, bays: 6, cols: 3, tiers: [2, 4], seed: 14 })];
const YARD = await buildYard({ boxes: STACKS, variants: 12, seed: 5 }); scene.add(YARD.group);
const SHIPBOX = stackBlock({ x: 187, z0: -120, bays: 15, cols: 12, tiers: [3, 6], seed: 21, missing: 0.02, gapZ: 0.4, gapX: 0.05 });
const SHIPYARD = await buildYard({ boxes: SHIPBOX, variants: 12, seed: 9 }); SHIPYARD.group.position.y = 9; scene.add(SHIPYARD.group);
box(40, 20, 270, M.hull, 203.5, -1, -48); box(40.2, 2.2, 270.2, M.hullRed, 203.5, -11 + 1.1 + 0.4, -48, scene, { cast: false });
box(30, 22, 14, M.white, 203.5, 9 + 11, 72);                                                      // the bridge house
const water = new THREE.Mesh(new THREE.PlaneGeometry(1400, 2400).rotateX(-Math.PI / 2), M.water); water.position.set(170 + 700, -2.5, 0); water.receiveShadow = true; scene.add(water);
box(2, 3, 2400, M.dock, 169, -1.5, 0, scene, { cast: false });                                    // the quay wall
const CRANE = await loadAsset('cranes/sts_crane', { lod: 0 }); CRANE.root.position.set(150, 0, -30); CRANE.root.rotation.y = Math.PI / 2; scene.add(CRANE.root);
const CRANE2 = await loadAsset('cranes/sts_crane', { lod: 1 }); CRANE2.root.position.set(150, 0, -95); CRANE2.root.rotation.y = Math.PI / 2; scene.add(CRANE2.root);
const TROL = await loadAsset('cranes/sts_trolley', { lod: 0 }), SPRD = await loadAsset('cranes/sts_spreader', { lod: 0 });
CRANE.root.add(TROL.root); CRANE.root.add(SPRD.root);
const HOOK = await buildYard({ boxes: [{ x: 0, y: 0, z: 0, ry: 0, variant: 4 }], variants: 12, seed: 33 }); SPRD.root.add(HOOK.group); HOOK.group.position.set(0, -1.5 - 2.896, 0);
const ROPES = Array.from({ length: 4 }, () => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6), M.steel); CRANE.root.add(m); return m; });
function setCraneLoad(zLocal, yHook) {   // trolley along the boom (local z), the spreader at height yHook (local y)
  const ry = CRANE.anchors.trolley_rail_y; TROL.root.position.set(0, ry, zLocal); SPRD.root.position.set(0, yHook, zLocal);
  TROL.anchors.rope_points.forEach((p, i) => { const a = V3(p[0], ry + p[1], zLocal + p[2]), q = SPRD.anchors.rope_tops[i], b = V3(q[0], yHook + q[1], zLocal + q[2]);
    const r = ROPES[i], d = b.clone().sub(a); r.position.copy(a).addScaledVector(d, 0.5); r.scale.set(1, d.length(), 1); r.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); });
}

// ================================================================ the trucks: tractor_aero + van53 rigs, docked at the doors and on the road
const PAINTS = ['#e9e6de', '#8f1d1d', '#1e3a6e', '#2f5a3a', '#d4a019', '#2b2d31', '#e9e6de', '#6a6f75', '#8f1d1d', '#e9e6de', '#1e3a6e', '#4a2a1a', '#e9e6de', '#2f5a3a'];
async function rig(paint, lod = 0) {
  const g = new THREE.Group(), tr = await loadAsset('trucks/tractor_aero', { lod, paints: { 'cab.paint': { color: new THREE.Color(paint).getHex() } } }), vn = await loadAsset('trucks/van53', { lod });
  vn.root.position.set(0, 0, -5.15); g.add(tr.root, vn.root); scene.add(g); return { g, tr, vn };
}
const DOCKRIGS = [];
for (let k = 0; k < DOCKED.length; k++) { const r = await rig(PAINTS[k % PAINTS.length], 1); r.g.position.set(DOORS[DOCKED[k]], 0, WH.z1 - 0.3 + 20.39); DOCKRIGS.push(r); }
const ROAD = { z: 80 };
box(1400, 0.02, 14, M.asphalt, -300, 0.01, ROAD.z, scene, { cast: false });
instBoxes(Array.from({ length: 140 }, (_, i) => [-1000 + i * 10, 0.021, ROAD.z, 4, 0.005, 0.15]), M.white, { cast: false });
instBoxes([[-300, 0.021, ROAD.z - 6.6, 1400, 0.005, 0.15], [-300, 0.021, ROAD.z + 6.6, 1400, 0.005, 0.15]], M.white, { cast: false });
const HERO = await rig('#8f1d1d', 0), HERO2 = await rig('#e9e6de', 0), HERO3 = await rig('#1e3a6e', 1);
for (const r of [HERO, HERO2, HERO3]) r.g.rotation.y = -Math.PI / 2;                              // heading -x along the road
try { HERO.tr.glow('lamp.head', 1.5); HERO2.tr.glow('lamp.head', 1.5); } catch (e) { console.log('everydollar: no lamp.head glow', e.message); }

// ================================================================ the people (instanced, by trade, measured bodies)
const ANSUR = await loadAnsur();
const folk = new People(scene, { max: 900, viewH: RH, budget: [40, 220] });
const PR = rng(77);
const mk = (o = {}, trade = null) => { const d = workerDesc(ANSUR, PR, { c7: true, trade }); return folk.add({ ...d, ...o }); };
// rows: the counting (and, re-laid, the crowd at the docks)
const ROWS = { nx: 30, nz: 24, dx: 1.55, dz: 1.75, z0: 3 };
const rows = []; for (let j = 0; j < ROWS.nz; j++) for (let i = 0; i < ROWS.nx; i++) rows.push({ id: mk(), i, j, x: (i - (ROWS.nx - 1) / 2) * ROWS.dx + (PR() - 0.5) * 0.12, z: ROWS.z0 + j * ROWS.dz + (PR() - 0.5) * 0.12, ph: PR() * 6.28 });
const crowdPos = People.crowdLayout(rows.length, { width: 46, depth: 34, z0: 30, seed: 5, minGap: 0.62 });
rows.forEach((p, k) => { p.cx = crowdPos[k].x; p.cz = crowdPos[k].z; });
// the ONE: front and centre of the crowd
const ONE = rows.reduce((a, p) => (Math.abs(p.cx) < 3 && p.cz > (a ? a.cz : -1e9)) ? p : a, null);
const walkers = Array.from({ length: 46 }, (_, k) => ({ id: mk(), x: (PR() - 0.5) * 22, z: -2 + PR() * 46, v: 1.15 + PR() * 0.35, ph: PR() * 6.28 }));
const smiths = ANVILS.map((a, k) => ({ id: mk({ prop: true, gloves: true }, k % 3 === 0 ? 'weld' : 'steel'), a, ph: PR() }));
const pickers = Array.from({ length: 24 }, (_, k) => ({ id: mk({}, 'steel'), aisle: k % 4, z: -42 - PR() * 40, v: (PR() < 0.5 ? -1 : 1) * (1.0 + PR() * 0.3), ph: PR() * 6.28, stand: PR() < 0.35 }));
const ALL = [...rows, ...walkers, ...smiths, ...pickers];
const hideAll = () => { for (const p of ALL) folk.set(p.id, { visible: false }); };
const show = (p, s) => folk.set(p.id, { visible: true, y: 0, look: 0, mix: null, pump: null, ...s });

// ================================================================ helpers
const eio = ease.inOutCubic, eo = ease.outCubic;
function setCam(pos, target, fov = 40, roll = 0) { camera.position.copy(pos); camera.up.set(Math.sin(roll), Math.cos(roll), 0); camera.lookAt(target); camera.fov = fov; camera.updateProjectionMatrix(); }
const AISLE_X = k => (RACK.xs[8 + k] + RACK.xs[9 + k]) / 2;
const walkPh = (v, t, ph0) => ph0 + 5.6 * (v / 1.35) * t;

// ================================================================ the shots: [b0, b1, fn(b, u, t) -> state]
const SHOTS = [];
const S = (b0, b1, fn) => SHOTS.push([b0, b1, fn]);
// b0-11 EVERY DOLLAR / LINING ... / OF THIS SOCIAL SCUM: the yard from above the dock line, trucks at every door, the crane over the ship
S(0, 11, (b, u, t) => {
  const k = eio(u);
  setCam(V3(lerp(-92, -80, k), lerp(46, 34, k), lerp(46, 40, k)), V3(lerp(30, 34, k), 0, lerp(-24, -22, k)), 42);
  rows.slice(0, 160).forEach((p, i) => { const dir = i % 2 ? 1 : -1, v = 1.2 + (i % 7) * 0.05, x = ((p.x * 3 + dir * v * t + 400) % 110) - 55;
    show(p, { x, z: -5 + (i % 23) * 1.3, heading: dir * Math.PI / 2, act: 'walk', ph: walkPh(v, t, p.ph) }); });
  return { shadowAt: V3(10, 0, -20), shadowR: 110, crane: [lerp(54, 46, u), lerp(16, 30, eio(u))] };
});
// b11-15 WAS EARNED NOT BY HARD WORK: under the crane, the box coming up out of the ship
S(11, 15, (b, u, t) => {
  setCam(V3(160, 1.8, -2), V3(185, lerp(26, 30, u), -30), 50);
  return { shadowAt: V3(165, 0, -30), shadowR: 70, crane: [50, lerp(28, 36, eio(u))] };
});
// b15-19 BUT FROM THE WORK OF THE PEOPLE: the shift walking out across the apron, toward the lens (long lens)
S(15, 19, (b, u, t) => {
  setCam(V3(2, 1.55, 78 - 2 * u), V3(0, 1.75, 30), 13);
  walkers.forEach(p => show(p, { x: p.x, z: p.z + p.v * (t - bt(15)) + 8, heading: 0, act: 'walk', ph: walkPh(p.v, t, p.ph) }));
  return { shadowAt: V3(0, 0, 30), shadowR: 50, crane: [46, 30] };
});
// b19-24 ON THE SHOP FLOOR,: down the line of anvils, every hammer on the beat
S(19, 24, (b, u, t) => {
  setCam(V3(-119.2 - 0.2 * u, 1.62, -36.6 - 0.6 * u), V3(-121.9, 1.05, -56), 40);
  smiths.forEach((p, i) => { const a = p.a; show(p, { x: a.x - a.f * 0.75, z: a.z, heading: a.f * Math.PI / 2, act: 'work', ph: ((b - 19) + p.ph * 0.25 + 0.4) % 1 }); });
  return { shadowAt: V3(-125, 0, -55), shadowR: 40, shop: 1 };
});
// b24-29 IN THE TRUCKS,: the rig rolling, the camera alongside at the steps
S(24, 29, (b, u, t) => {
  const tl = t - bt(24), x = 40 - 13.5 * tl;
  HERO.g.position.set(x, 0, ROAD.z + 3.2); HERO2.g.position.set(x + 34, 0, ROAD.z + 3.2); HERO3.g.position.set(-120 + 12 * tl, 0, ROAD.z - 3.2); HERO3.g.rotation.y = Math.PI / 2;
  setCam(V3(x - 13 + 3 * u, 1.45, ROAD.z + 11), V3(x + 5, 2.3, ROAD.z + 3), 40);
  return { shadowAt: V3(x, 0, ROAD.z), shadowR: 45 };
});
// b29-35 AND IN THE WAREHOUSES.: down an aisle, five levels of cartons, the pickers
S(29, 35, (b, u, t) => {
  const ax = AISLE_X(0);
  setCam(V3(ax + 0.2, WH.floor + 1.65, -33.5 - 7 * eio(u)), V3(ax - 0.1, WH.floor + 2.4, -80), 50);
  pickers.forEach((p, i) => { const x = AISLE_X(p.aisle - 1) + (i % 2 ? 0.7 : -0.7);
    if (p.stand) show(p, { x, y: WH.floor, z: p.z, heading: (i % 2 ? 1 : -1) * Math.PI / 2, act: 'stand', t: t + i });
    else { const z = -86 + (((p.z + 86) + p.v * (t - bt(29)) + 400) % 44); show(p, { x, y: WH.floor, z, heading: p.v > 0 ? 0 : Math.PI, act: 'walk', ph: walkPh(Math.abs(p.v), t, p.ph) }); } });
  return { shadowAt: V3(ax, 0, -60), shadowR: 40, inside: 1 };
});
// b35-47 the counting: from eye level on the front rank to the whole yard filled, rank after rank
S(35, 47, (b, u, t) => {
  const k = eio(clamp(u * 1.05));
  const pos = V3(lerp(1.0, 0, k), lerp(1.7, 92, k), lerp(ROWS.z0 + ROWS.dz * ROWS.nz + 2.8, 92, k));
  const tg = V3(0, lerp(1.65, 0, k), lerp(ROWS.z0 + ROWS.dz * ROWS.nz - 6, 12, k));
  setCam(pos, tg, lerp(46, 40, k));
  rows.forEach((p, i) => show(p, { x: p.x, z: p.z, heading: 0, act: 'stand', t: t + i * 0.37 }));
  return { shadowAt: V3(0, 0, 20), shadowR: 70 };
});
// b47-53 THE WORKING CLASS AND THE EMPLOYING CLASS HAVE NOTHING IN COMMON.: the crowd at the docks, from inside it, low
S(47, 53, (b, u, t) => {
  setCam(V3(3.5 - 1.5 * u, 1.15, 50), V3(-1, 4.6, -8), 40);
  rows.forEach((p, i) => show(p, { x: p.cx, z: p.cz + 6, heading: (2 - p.cx) * 0.01, act: 'stand', t: t + i * 0.37, look: 0 }));
  return { shadowAt: V3(0, 0, 0), shadowR: 60 };
});
// b53-55.5 AN INJURY TO ONE: one fist
S(53, 55.5, (b, u, t) => {
  const o = ONE, x = o.cx, z = o.cz + 6;
  setCam(V3(x + 1.3, 1.5, z + 3.6 - 0.4 * u), V3(x, 1.65, z - 1), 34);
  rows.forEach((p, i) => show(p, { x: p.cx, z: p.cz + 6, heading: p === o ? 0.25 : (2 - p.cx) * 0.01, act: p === o ? 'fist' : 'stand', t: t + i * 0.37, pump: p === o ? eo(clamp((b - 53.15) / 0.5)) * 0.6 + 0.4 : null }));
  return { shadowAt: V3(x, 0, z), shadowR: 30 };
});
// b55.5-58 AN INJURY TO ALL.: every fist, the whole crowd turned to the lens
S(55.5, 58, (b, u, t) => {
  setCam(V3(2, lerp(3.2, 5.0, u), 52 + 2 * u), V3(0, 1.5, 22), 36);
  rows.forEach((p, i) => { const up = eo(clamp((b - 55.5 - (i % 37) * 0.012) / 0.3)); show(p, { x: p.cx, z: p.cz + 6, heading: Math.atan2(2 - p.cx, 52 - (p.cz + 6)) * 0.6, act: 'fist', t: t + i * 0.37, pump: 0.25 + 0.75 * up }); });
  return { shadowAt: V3(0, 0, 10), shadowR: 50 };
});
// b58-64 THIS BATTLE IS NOT THE FIRST / AND IT WILL NOT BE THE LAST.: the crowd marches out of the yard toward the road
S(58, 64, (b, u, t) => {
  const tl = t - bt(58), dz = 1.25 * tl;
  setCam(V3(-5 + 1.5 * u, 1.4, 50 + dz), V3(2, 2.4, 24 + dz), 38);
  rows.forEach((p, i) => show(p, { x: p.cx, z: p.cz + 6 + dz, heading: 0, act: 'march', ph: walkPh(1.2, t, p.ph), pump: Math.pow(Math.max(0, Math.sin((b - 58) * Math.PI + i * 0.4)), 2) * 0.6 + 0.4, amt: 0.9 }));
  return { shadowAt: V3(0, 0, 18 + dz), shadowR: 55 };
});
// b64-71 WE LOOK TOWARDS VICTORY AND A NEW AMERICA FREE OF THE PARASITES.: up and over the crowd: the yard, the docks, the crane, the ship
S(64, 71, (b, u, t) => {
  const tl = t - bt(58), dz = 1.25 * tl, k = eio(u);
  setCam(V3(lerp(-4, -60, k), lerp(3, 70, k), lerp(50, 130, k) + dz * (1 - k)), V3(lerp(0, 40, k), lerp(2.5, 0, k), lerp(24, -20, k) + dz * (1 - k)), lerp(40, 44, k));
  rows.forEach((p, i) => show(p, { x: p.cx, z: p.cz + 6 + dz, heading: 0, act: 'march', ph: walkPh(1.2, t, p.ph), pump: Math.pow(Math.max(0, Math.sin((b - 58) * Math.PI + i * 0.4)), 2) * 0.6 + 0.4, amt: 0.9 }));
  return { shadowAt: V3(10, 0, 20), shadowR: 120, crane: [lerp(46, 40, u), 34] };
});

// ================================================================ the frame
const shotAt = b => SHOTS.find(s => b >= s[0] && b < s[1]) || SHOTS[SHOTS.length - 1];
async function drawWorld(t, b) {
  const sh = shotAt(b), u = clamp((b - sh[0]) / (sh[1] - sh[0]));
  hideAll();
  HERO.g.position.set(-600, 0, ROAD.z + 3.2); HERO2.g.position.set(-640, 0, ROAD.z + 3.2); HERO3.g.position.set(-700, 0, ROAD.z - 3.2);
  const st = sh[2](b, u, t) || {};
  const cl = st.crane || [50, 30]; setCraneLoad(cl[0], cl[1]);
  shadowBox(st.shadowAt || V3(0, 0, 0), st.shadowR || 80);
  shopLight.intensity = st.shop ? 60 : 0;
  for (const a of ANVILS) a.hot.material.emissiveIntensity = 3.2;
  sky.position.copy(camera.position);
  scene.updateMatrixWorld(true);
  folk.update(camera);
  renderer.render(scene, camera);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  RQ.present(ctx, glc, renderer.getContext(), { w: W, h: H });
  if (NIGHT) glare();
  if (st.shop) sparks(t, b);
  return st;
}
// the towers' glare: a soft sodium bloom and a hard core at each head in view (2D, additive)
function glare() {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [x, z] of TOWERS) {
    const p = V3(x, TOWER_H, z), v = p.clone().project(camera); if (v.z > 1 || v.z < -1) continue;
    const sx = (v.x * 0.5 + 0.5) * W, sy = (1 - (v.y * 0.5 + 0.5)) * H; if (sx < -300 || sx > W + 300 || sy < -300 || sy > H + 300) continue;
    const d = camera.position.distanceTo(p), r = clamp(2600 / d, 40, 420);
    const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, r); gr.addColorStop(0, 'rgba(255,190,120,0.55)'); gr.addColorStop(0.15, 'rgba(255,150,70,0.22)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = gr; ctx.fillRect(sx - r, sy - r, 2 * r, 2 * r);
    ctx.fillStyle = 'rgba(255,236,200,0.9)'; ctx.beginPath(); ctx.ellipse(sx, sy, clamp(r * 0.06, 2, 14), clamp(r * 0.03, 1.5, 7), 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
// hammer sparks at each anvil on the blow (2D, additive), projected from the anvil face
function sparks(t, b) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const p of smiths) {
    const a = p.a, c = ((b - 19) + p.ph * 0.25 + 0.4) % 1, age = (c - 0.62) * SPB; if (age < 0 || age > 0.35) continue;
    const v = V3(a.x + 0.05, 0.78, a.z).project(camera); if (v.z > 1) continue;
    const sx = (v.x * 0.5 + 0.5) * W, sy = (1 - (v.y * 0.5 + 0.5)) * H, d = camera.position.distanceTo(V3(a.x, 0.78, a.z)), sc = clamp(6 / d, 0.15, 2.5), r = rng(Math.floor(b) * 31 + a.x * 7 + a.z);
    for (let i = 0; i < 26; i++) { const ang = -Math.PI * (0.1 + 0.8 * r()), sp = (220 + 520 * r()) * sc, x = sx + Math.cos(ang) * sp * age, y = sy + Math.sin(ang) * sp * age + 900 * sc * age * age;
      ctx.strokeStyle = `rgba(255,${170 + r() * 70},${60 + r() * 60},${(1 - age / 0.35) * 0.95})`; ctx.lineWidth = 1.5 + 2 * sc; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(ang) * 14 * sc, y - Math.sin(ang) * 14 * sc); ctx.stroke(); }
  }
  ctx.restore();
}
const GRAIN = (() => { const [c, g] = cv(256, 256), d = g.createImageData(256, 256), r = rng(9); for (let i = 0; i < d.data.length; i += 4) { const v = 128 + (r() - .5) * 120; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); return c; })();
function grade(t) {
  ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.07; const s = Math.floor(t * 24) % 5; ctx.translate(s * 71, s * 43); ctx.fillStyle = ctx.createPattern(GRAIN, 'repeat'); ctx.fillRect(-s * 71, -s * 43, W, H); ctx.restore();
  const v = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.32, W / 2, H * 0.5, H * 0.66); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(8,8,10,0.32)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}
function scrim(yc, h) {                 // a soft dark band behind the words, so cream reads on sky and on concrete alike
  const g = ctx.createLinearGradient(0, yc - h, 0, yc + h); g.addColorStop(0, 'rgba(12,10,10,0)'); g.addColorStop(0.5, 'rgba(12,10,10,0.6)'); g.addColorStop(1, 'rgba(12,10,10,0)');
  ctx.fillStyle = g; ctx.fillRect(0, yc - h, W, 2 * h);
}
function dateline(b) {
  ctx.save(); ctx.font = '700 30px "Chakra Petch"'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
  const s = DATELINE(b); ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(18,10,10,0.85)'; ctx.strokeText(s, W / 2, H - 118); ctx.fillStyle = '#F4E6D0'; ctx.fillText(s, W / 2, H - 118);
  ctx.fillStyle = '#C91F37'; ctx.fillRect(W / 2 - 60, H - 100, 120, 6); ctx.restore();
}
const TYPE_Y = 470;
window.renderFrame = async (t) => {
  const frame = Math.round(t * 30), b = t / SPB + 1e-6;
  if (b >= CLOSE) {
    const age = t - bt(CLOSE);
    await drawWorld(bt(CLOSE) - 1 / 30, CLOSE - 1e-3);
    ctx.fillStyle = `rgba(7,1,1,${clamp(age * 4, 0, 0.94)})`; ctx.fillRect(0, 0, W, H);
    closer(ctx, age); return {};
  }
  await drawWorld(t, b);
  grade(t);
  const c = CUES.find(c => b >= c[0] && b < c[3]);
  if (c) {
    const nL = c[1].split('|').length, capH = c[4] * (nL === 1 ? 1 : nL === 2 ? 0.9 : 0.78);
    scrim(TYPE_Y, (nL * capH * 1.36) / 2 + 160);
    T.slamBlock(c[1], t - bt(c[0]), frame, { emph: c[2], y: TYPE_Y, cap: c[4] });
  }
  dateline(b);
  return {};
};
window.sceneInfo = { SPB, CLOSE };
window.sceneReady = true;
