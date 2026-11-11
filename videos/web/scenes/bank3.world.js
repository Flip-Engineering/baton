// PEOPLE'S NATIONAL BANK v5: the worlds behind the note, built in three.js and cut by the burin as they render
// (bank3.engrave.js), so every vignette is line engraving on the note's stock: the mill, the railroad, the grain
// elevator, the fab, the vault. Each world is live: its camera dollies and its machines move every frame.
// v7: no modelled people. Every worker is a FIGURE ANCHOR here (where he stands, which way he faces, what he is doing)
// and bank3.js prints him in 2D as a backlit or stamped silhouette (GRAPHICS_ROADMAP: no front-lit faces at mid
// distance or closer; human geometry hidden by silhouette, print and crowd scale).
import * as E from './bank3.engrave.js';
import { W, H, rng, clamp, lerp } from '../lib/kit.js';
const THREE = E.THREE;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- albedo maps the burin reads as courses and panels
const tex = (w, h, draw, rep = [1, 1]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; return t;
};
const TX = {
  fins: () => tex(256, 64, (g, w, h) => { for (let x = 0; x < w; x++) { const v = x % 32 < 5 ? 120 : x % 32 < 7 ? 235 : 205; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, h); } }),
  brick: () => tex(256, 256, (g, w, h) => { g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, w, h); g.fillStyle = '#7a7a7a';
    for (let y = 0; y < h; y += 32) { g.fillRect(0, y, w, 4); for (let x = (y / 32) % 2 ? 0 : 32; x < w; x += 64) g.fillRect(x, y, 4, 32); } }),
  block: () => tex(256, 256, (g, w, h) => { g.fillStyle = '#c4c4c4'; g.fillRect(0, 0, w, h); g.fillStyle = '#6e6e6e';
    for (let y = 0; y < h; y += 64) { g.fillRect(0, y, w, 6); for (let x = (y / 64) % 2 ? 0 : 64; x < w; x += 128) g.fillRect(x, y, 6, 64); } }),
  plate: () => tex(256, 256, (g, w, h) => { g.fillStyle = '#b4b4b4'; g.fillRect(0, 0, w, h); g.fillStyle = '#6a6a6a'; for (let y = 0; y < h; y += 128) g.fillRect(0, y, w, 3); for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 3, h);
    g.fillStyle = '#8a8a8a'; for (let y = 16; y < h; y += 32) for (let x = 16; x < w; x += 32) g.fillRect(x, y, 6, 2); }),
  windows: () => tex(256, 256, (g, w, h) => { g.fillStyle = '#bdbdbd'; g.fillRect(0, 0, w, h);
    for (let y = 16; y < h; y += 64) for (let x = 12; x < w; x += 42) { g.fillStyle = '#2a2a2a'; g.fillRect(x, y, 24, 36); g.fillStyle = '#9a9a9a'; g.fillRect(x + 11, y, 2, 36); g.fillRect(x, y + 17, 24, 2); } }),
  rib: () => tex(256, 64, (g, w, h) => { for (let x = 0; x < w; x++) { const v = x % 21 < 4 ? 110 : 190; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, h); } }),
  furrow: () => tex(64, 256, (g, w, h) => { for (let x = 0; x < w; x++) { const v = 150 + 70 * Math.sin(x / w * TAU * 3); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, h); } }),
  ballast: () => tex(128, 128, (g, w, h) => { const r = rng(9); g.fillStyle = '#909090'; g.fillRect(0, 0, w, h); for (let i = 0; i < 500; i++) { const v = 70 + r() * 120; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * w, r() * h, 3 + r() * 4, 3 + r() * 3); } }),
};

// ---------------------------------------------------------------- materials
const m = E.mat;
const MAT = {
  iron: () => m('#8a8a8a', { obj: 1 }), dark: () => m('#5e5e5e', { obj: 1 }), steel: () => m('#a8a8a8', { obj: 1 }), light: () => m('#d0d0d0', {}),
  hot: () => m('#ffffff', { hot: 1, emissive: '#ffffff' }), lamp: () => { const x = m('#ffffff', { emissive: '#ffffff' }); return x; },
};
// figure anchors: add(spec) -> id; set(id, state); the shot's camera is kept for projection
class Folk {
  constructor() { this.list = []; this.cam = null; }
  add(spec) { this.list.push({ spec, st: { visible: true, x: 0, y: 0, z: 0, ph: 0, t: 0 } }); return this.list.length - 1; }
  set(id, o) { Object.assign(this.list[id].st, o); }
  update(cam) { this.cam = cam; }
}
function folk() { return new Folk(); }


// ---------------------------------------------------------------- scaffolding
function stage({ fog = [60, 420], key = [-0.6, 0.55, 0.45], keyI = 2.4, fill = 0.6, sky = true, ground = true, groundMat = null, box = 60, center = [0, 0, 0] } = {}) {
  const s = new THREE.Scene();
  s.fog = new THREE.Fog(0xffffff, fog[0], fog[1]);
  s.add(new THREE.HemisphereLight(0xffffff, 0x3a3a3a, fill));
  const k = new THREE.DirectionalLight(0xffffff, keyI); k.position.set(center[0] + key[0] * 200, center[1] + key[1] * 200, center[2] + key[2] * 200); k.target.position.set(...center);
  k.castShadow = true; k.shadow.mapSize.set(2048, 2048); const c = k.shadow.camera; c.left = c.bottom = -box; c.right = c.top = box; c.near = 1; c.far = 600;
  k.shadow.bias = -0.0006; k.shadow.normalBias = 0.03; s.add(k); s.add(k.target); s.key = k;
  if (ground) { const g = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), groundMat || m('#c6c6c6', {})); g.rotation.x = -Math.PI / 2; g.receiveShadow = true; s.add(g); }
  if (sky) { const sk = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 16), E.skyMat(sky === true ? {} : sky)); s.add(sk); }
  return s;
}
function put(s, o, x = 0, y = 0, z = 0, { cast = true, recv = true, ry = 0 } = {}) { o.position.set(x, y, z); o.rotation.y = ry; o.traverse(q => { if (q.isMesh) { q.castShadow = q.castShadow !== false && cast; q.receiveShadow = recv; } }); s.add(o); return o; }
const bx = (w, h, d, mt) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mt);
const cy = (r0, r1, h, mt, seg = 24) => new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mt);
const at = (o, x, y, z, rx = 0, ry = 0, rz = 0) => { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o; };
function group(...ch) { const g = new THREE.Group(); for (const c of ch) g.add(c); return g; }
// I-beam column
function ibeam(h, w, mt) { return group(at(bx(w, h, 0.08, mt), 0, h / 2, w * 0.45), at(bx(w, h, 0.08, mt), 0, h / 2, -w * 0.45), at(bx(0.06, h, w * 0.9, mt), 0, h / 2, 0)); }
// Warren truss along x
function truss(len, h, mt, n = 12, t = 0.2, depth = 1.2) {
  const g = new THREE.Group();
  for (const y of [0, h]) for (const z of [-1, 1]) g.add(at(bx(len, t * 1.4, t * 1.4, mt), 0, y, z * depth));
  for (let i = 0; i < n; i++) for (const z of [-1, 1]) {
    const x0 = -len / 2 + i * len / n, x1 = x0 + len / n, d = Math.hypot(len / n, h);
    g.add(at(bx(d, t, t, mt), (x0 + x1) / 2, h / 2, z * depth, 0, 0, (i % 2 ? 1 : -1) * Math.atan2(h, len / n)));
    g.add(at(bx(t, h, t, mt), x0, h / 2, z * depth));
  }
  for (let i = 0; i <= n; i += 2) g.add(at(bx(t, t, depth * 2, mt), -len / 2 + i * len / n, h, 0));
  return g;
}
function banded(r, h, mt, bands = 6) {
  const g = new THREE.Group(); g.add(at(cy(r * 0.88, r, h, mt), 0, h / 2, 0));
  for (let i = 1; i <= bands; i++) g.add(at(new THREE.Mesh(new THREE.TorusGeometry(r * (1 - 0.12 * i / bands) + 0.05, 0.08, 6, 24), mt), 0, h * i / (bands + 1), 0, Math.PI / 2));
  g.add(at(new THREE.Mesh(new THREE.TorusGeometry(r * 0.9, 0.18, 6, 24), mt), 0, h, 0, Math.PI / 2));
  return g;
}
// a hoist chain from a to b: alternating links, instanced
function chain(a, b, mt, r = 0.1) {
  const d = b.clone().sub(a), L = d.length(), n = Math.floor(L / (r * 2.6)), geo = new THREE.TorusGeometry(r, r * 0.3, 6, 12); geo.scale(1, 1.7, 1);
  const im = new THREE.InstancedMesh(geo, mt, n), q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize()), q2 = new THREE.Quaternion(), M4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) { q2.setFromAxisAngle(V3(0, 1, 0), i % 2 ? Math.PI / 2 : 0); const qq = q.clone().multiply(q2); M4.compose(a.clone().addScaledVector(d, (i + 0.5) / n), qq, V3(1, 1, 1)); im.setMatrixAt(i, M4); }
  im.castShadow = true; return im;
}
function camera(fov = 50) { return new THREE.PerspectiveCamera(fov, W / H, 0.1, 3000); }
const lk = (c, p, t) => { c.position.set(...p); c.lookAt(...t); };
const mixv = (a, b, u) => a.map((v, i) => lerp(v, b[i], u));

// ================================================================ THE MILL: the casting floor, the pour, the tapper
// Layout (metres): the lens stands on the floor plates at the origin looking up the bay (-z). The tapper works in the
// left foreground; the ladle hangs overhead right, pouring into the ingot moulds on their bogie; the shop recedes
// to the bright end bay with the furnace beyond.
function mill() {
  const s = stage({ fog: [18, 120], key: [-0.3, 0.85, 0.3], keyI: 1.25, fill: 0.32, sky: false, groundMat: m('#a8a8a8', {}), box: 30, center: [0, 0, -10] });
  const IRON = MAT.iron(), DARK = MAT.dark(), HOT = MAT.hot(), LAMP = MAT.lamp(), WALL = m('#8e8e8e', {});
  s.children.find(o => o.isMesh && o.geometry.type === 'PlaneGeometry').material.map = TX.plate(); s.children.find(o => o.isMesh && o.geometry.type === 'PlaneGeometry').material.map.repeat.set(400, 400);
  for (let z = 4; z > -80; z -= 9) for (const x of [-8.5, 10.5]) put(s, ibeam(20, 0.9, DARK), x, 0, z);
  for (const x of [-8.5, 10.5]) put(s, bx(1.2, 1.6, 100, DARK), x, 18.5, -36);
  for (let z = 4; z > -80; z -= 9) put(s, truss(19, 3.2, IRON, 8, 0.18, 0.25), 1, 22, z);
  put(s, bx(24, 0.4, 100, m('#6a6a6a', {})), 1, 25.4, -36);
  for (const x of [-9.1, 11.1]) put(s, bx(0.3, 3, 96, LAMP), x, 23.5, -36, { cast: false });
  const back = put(s, bx(24, 26, 1, WALL), 1, 13, -70); back.material.map = TX.block(); back.material.map.repeat.set(5, 5);
  put(s, bx(9, 13, 1.2, LAMP), -1, 6.5, -69.4, { cast: false });
  const bf = new THREE.Group(); bf.add(at(cy(3.4, 5, 30, IRON, 28), 0, 15, 0)); bf.add(at(cy(2, 3.4, 8, DARK, 20), 0, 34, 0));
  bf.add(at(new THREE.Mesh(new THREE.TorusGeometry(6, 0.6, 8, 32), DARK), 0, 10, 0, Math.PI / 2));
  for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.4; bf.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(0, 38, 0), V3(Math.cos(a) * 3, 44, Math.sin(a) * 3), V3(Math.cos(a) * 5, 38, Math.sin(a) * 5), V3(Math.cos(a) * 9, 18, Math.sin(a) * 7)]), 20, 0.5, 8), DARK)); }
  put(s, bf, -2, 0, -95);
  // the overhead crane over the pour: girders, end trucks, trolley and drum; twin chains to the hook block
  const LX = 3.0, LZ = -7.2, hookY = 9.4;
  const crane = new THREE.Group();
  for (const z of [-1.4, 1.4]) crane.add(at(bx(20, 1.6, 0.8, IRON), 0, 0, z));
  for (const x of [-9.6, 9.6]) crane.add(at(bx(1.6, 1.2, 4.4, DARK), x, 0.4, 0));
  crane.add(at(bx(4, 1.6, 3.6, DARK), LX - 1, 1.5, 0)); crane.add(at(cy(0.7, 0.7, 3.4, IRON, 20), LX - 1, 2.6, 0, Math.PI / 2));
  put(s, crane, 1, 17.4, LZ);
  for (const dz of [-0.55, 0.55]) s.add(chain(V3(LX, 17.2, LZ + dz), V3(LX, hookY + 1.4, LZ + dz * 0.6), DARK, 0.12));
  put(s, bx(1.4, 1.2, 1.8, DARK), LX, hookY + 0.8, LZ);
  put(s, at(new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.2, 10, 20, Math.PI * 1.5), IRON), LX, hookY - 0.5, LZ, 0, Math.PI / 2, Math.PI * 0.75));
  const ladle = new THREE.Group();
  ladle.add(at(cy(2.1, 1.65, 3.3, DARK, 32), 0, 0, 0));
  ladle.add(at(new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.24, 8, 32), IRON), 0, 1.65, 0, Math.PI / 2));
  for (const b of [-0.7, 0.2, 1.0]) ladle.add(at(new THREE.Mesh(new THREE.TorusGeometry(1.98 - (b + 0.7) * 0.06, 0.11, 6, 32), IRON), 0, b, 0, Math.PI / 2));
  for (const sz of [-1, 1]) ladle.add(at(cy(0.32, 0.32, 0.8, IRON), 0, 0.55, sz * 2.2, Math.PI / 2));
  ladle.add(at(new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.17, 8, 24, Math.PI), IRON), 0, 0.55, 0, 0, Math.PI / 2, 0));
  ladle.add(at(bx(0.9, 0.3, 0.8, IRON), -2.2, 1.55, 0));
  ladle.add(at(cy(1.9, 1.9, 0.2, HOT, 32), 0, 1.4, 0));
  const lg = new THREE.Group(); lg.add(at(ladle, 0, -3.1, 0)); lg.rotation.z = 0.5; put(s, lg, LX, hookY - 0.5, LZ);
  // the stream from the lip into a mould; the moulds on the bogie running up the bay; the splash
  const SX = LX - 2.35;
  const stream = put(s, new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(SX + 0.45, 7.55, LZ), V3(SX + 0.05, 7.2, LZ), V3(SX - 0.12, 5.6, LZ), V3(SX - 0.14, 3.0, LZ)]), 24, 0.16, 10), HOT), 0, 0, 0, { cast: false });
  put(s, new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 8, 0, TAU, 0, Math.PI / 2), HOT), SX - 0.14, 2.95, LZ, { cast: false });
  const moulds = new THREE.Group();
  for (let i = 0; i < 7; i++) { moulds.add(at(bx(1.5, 2.3, 1.5, m('#4a4a4a', { obj: 1 })), 0, 1.75, -i * 2.1)); moulds.add(at(bx(1.1, 0.1, 1.1, i === 0 ? HOT : IRON), 0, 2.91, -i * 2.1)); }
  moulds.add(at(bx(2.4, 0.6, 15, IRON), 0, 0.45, -6.3));
  for (const z of [0.3, -12.9]) for (const x of [-1.1, 1.1]) moulds.add(at(cy(0.4, 0.4, 0.3, DARK, 16), x, 0.4, z, 0, 0, Math.PI / 2));
  put(s, moulds, SX, 0, LZ);
  for (const x of [-0.7, 0.7]) put(s, bx(0.14, 0.14, 90, IRON), SX + x, 0.07, -40);
  // scrap and ingot stacks on the far side
  for (let i = 0; i < 9; i++) put(s, bx(2.2, 0.8, 0.9, DARK), 5 + (i % 3) * 2.4, 0.4 + Math.floor(i / 3) * 0.8, -16 - (i % 2) * 0.3);
  // the heat: a point light at the stream
  const glow = new THREE.PointLight(0xffffff, 60, 22, 1.6); glow.position.set(SX + 0.6, 5.2, LZ + 1.8); s.add(glow);
  const glow2 = new THREE.PointLight(0xffffff, 26, 9, 1.4); glow2.position.set(0.6, 0.9, -1.6); s.add(glow2);
  // the crew: the tapper and his bar, foreground left, turned three-quarter to the lens; one at the bogie; one walking up
  const F = folk(s, 8);
  // the tapper with his bar, a black shape against the pour; the man at the bogie; one walking up the bay
  const hero = F.add({ view: 'lost', pose: 'bar', dir: -1, h: 1.84, seed: 4 });
  F.set(hero, { x: -0.5, y: 0, z: -1.3 });
  const m2 = F.add({ view: 'profile', pose: 'reach', dir: 1, h: 1.8, seed: 9 });
  F.set(m2, { x: SX - 2.2, y: 0, z: LZ - 5 });
  const m3 = F.add({ view: 'profile', pose: 'walk', dir: -1, h: 1.8, seed: 17 });
  const cam = camera(54);
  return { s, cam, hero, F, glow, glow2, stream, lg,
    shot(name, u, t) {
      lg.rotation.z = 0.5 + Math.sin(t * 1.3) * 0.015; stream.scale.x = 1 + 0.03 * Math.sin(t * 23);
      glow.intensity = 55 + 12 * Math.sin(t * 17) + 8 * Math.sin(t * 31); glow2.intensity = (name === 'b' ? 7 + 2.5 * Math.sin(t * 13) : 26 + 6 * Math.sin(t * 13));
      F.set(hero, { t }); F.set(m2, { t }); F.set(m3, { x: 4.5, y: 0, z: -18 + ((t * 1.2) % 6), ph: 1.2 + t * 5.6 });
      if (name === 'a') { cam.fov = 60; lk(cam, mixv([-0.05, 0.5, 2.05], [-0.15, 0.62, 1.55], u), mixv([-0.1, 3.4, -8.2], [-0.15, 3.7, -8.4], u)); }
      glow2.position.set(0.6, 0.9, -1.6); if (name === 'b') glow2.position.set(0.55, 1.35, -0.55);
      if (name === 'b') { cam.fov = 40; lk(cam, mixv([0.95, 1.5, 0.35], [0.75, 1.56, -0.02], u), mixv([-0.55, 1.55, -1.3], [-0.52, 1.6, -1.3], u)); }
      else { cam.fov = lerp(40, 56, u); lk(cam, mixv([0.75, 1.56, -0.02], [0.2, 1.4, 5.5], u), mixv([-0.52, 1.6, -1.3], [0.2, 4.6, -8], u)); }
      cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      F.update(cam);
    }, hotPts: () => [V3(SX, 7.5, LZ), V3(SX, 3.1, LZ)] };
}

// ================================================================ RAIL: the engine on the main line, the gandy dancers, the gantry
function rail() {
  const s = stage({ fog: [40, 520], key: [-0.7, 0.45, 0.55], keyI: 2.3, fill: 0.65, groundMat: m('#c8c8c8', {}), box: 60, center: [0, 0, -25] });
  const IRON = MAT.iron(), DARK = MAT.dark(), STEEL = MAT.steel(), LAMP = MAT.lamp(), HOT = MAT.hot(), BAL = m('#a4a4a4', {}); BAL.map = TX.ballast(); BAL.map.repeat.set(4, 400);
  // two tracks: ballast beds, instanced ties, rails converging to the horizon
  const tieG = new THREE.BoxGeometry(2.6, 0.18, 0.24);
  for (const x0 of [0, 4.6]) {
    put(s, bx(4.2, 0.35, 900, BAL), x0, 0.17, -440, { cast: false });
    const n = 700, ties = new THREE.InstancedMesh(tieG, DARK, n), M4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { M4.makeTranslation(x0, 0.44, 6 - i * 0.62); ties.setMatrixAt(i, M4); } ties.receiveShadow = true; ties.castShadow = true; s.add(ties);
    for (const x of [-0.72, 0.72]) { put(s, bx(0.08, 0.16, 900, STEEL), x0 + x, 0.6, -440); put(s, bx(0.16, 0.04, 900, STEEL), x0 + x, 0.54, -440); }
  }
  // telegraph poles with crossarms and insulators
  for (let i = 0; i < 16; i++) { const z = 4 - i * 38; const p = group(at(cy(0.14, 0.18, 11, DARK, 8), 0, 5.5, 0), at(bx(3.2, 0.2, 0.2, DARK), 0, 10.2, 0), at(bx(2.4, 0.18, 0.18, DARK), 0, 9.4, 0));
    for (const x of [-1.4, -0.7, 0.7, 1.4]) p.add(at(cy(0.07, 0.07, 0.25, IRON, 6), x, 10.45, 0)); put(s, p, -4.2, 0, z); }
  for (const y of [10.5, 9.7]) for (const x of [-5.6, -2.8]) put(s, bx(0.03, 0.03, 620, DARK), x, y, -300, { cast: false });
  // the signal gantry over both tracks
  const gan = group(truss(11, 1.2, IRON, 8, 0.12, 0.35)); gan.position.y = 7.5;
  const gg = group(gan, at(bx(0.35, 8.7, 0.35, IRON), -5.5, 4.35, 0), at(bx(0.35, 8.7, 0.35, IRON), 5.5, 4.35, 0));
  for (const x of [0, 4.6]) { const hd = group(at(bx(0.8, 2.2, 0.5, DARK), 0, 0, 0)); for (let k = 0; k < 3; k++) { hd.add(at(cy(0.24, 0.24, 0.1, k === 2 ? LAMP : IRON, 16), 0, 0.65 - k * 0.65, 0.3, Math.PI / 2)); hd.add(at(cy(0.28, 0.3, 0.35, DARK, 16, true), 0, 0.72 - k * 0.65, 0.42, Math.PI / 2 - 0.3)); } gg.add(at(hd, x - 2.3, 6.1, 0.6)); }
  put(s, gg, 2.3, 0, -52);
  // hills and a far grain town on the horizon for depth
  for (let i = 0; i < 9; i++) put(s, new THREE.Mesh(new THREE.SphereGeometry(80, 16, 8, 0, TAU, 0, Math.PI / 2), m('#cfcfcf', {})), -420 + i * 110, -30, -700 - (i % 3) * 60, { cast: false });
  // THE ENGINE, facing the lens: smokebox door, number plate, headlight, pilot, cylinders, drivers with side and main rods
  const L = new THREE.Group();
  const boiler = at(cy(1.15, 1.15, 8.6, IRON, 36), 0, 3.0, -4.3, Math.PI / 2); L.add(boiler);
  for (let i = 0; i < 6; i++) L.add(at(new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.05, 6, 36), DARK), 0, 3.0, -0.8 - i * 1.3));
  L.add(at(cy(1.26, 1.26, 1.8, DARK, 36), 0, 3.0, 0.9, Math.PI / 2));                                    // smokebox
  L.add(at(cy(1.1, 1.1, 0.16, STEEL, 36), 0, 3.0, 1.86, Math.PI / 2));                                     // door
  L.add(at(cy(0.36, 0.36, 0.08, LAMP, 24), 0, 3.35, 1.97, Math.PI / 2));                                   // number plate (bright)
  for (const a of [0.9, -0.9]) L.add(at(bx(0.9, 0.08, 0.06, DARK), Math.sin(a) * 0.3, 3.0 + Math.cos(a) * 0.55, 1.96, 0, 0, a));  // dogs
  L.add(at(bx(0.12, 0.12, 0.1, STEEL), 0.55, 3.0, 1.98));
  const hl = group(at(bx(0.8, 0.8, 0.9, DARK), 0, 0, 0), at(cy(0.3, 0.3, 0.06, LAMP, 20), 0, 0, 0.47, Math.PI / 2), at(bx(0.9, 0.08, 1.0, IRON), 0, 0.45, 0));
  L.add(at(hl, 0, 4.55, 1.3));
  L.add(at(cy(0.34, 0.46, 1.5, DARK, 20), 0, 4.8, 0.6)); L.add(at(cy(0.5, 0.5, 0.14, IRON, 20), 0, 5.55, 0.6));    // stack, lip
  L.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10, 0, TAU, 0, Math.PI / 2), IRON), 0, 4.1, -2.4));   // sand dome
  L.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10, 0, TAU, 0, Math.PI / 2), IRON), 0, 4.1, -4.8));   // steam dome
  L.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), STEEL), 0, 4.45, -3.6));                        // bell
  for (const x of [-1.3, 1.3]) { L.add(at(bx(0.5, 0.06, 9.5, IRON), x * 1.12, 2.0, -3.8)); L.add(at(cy(0.03, 0.03, 8, STEEL, 6), x * 1.02, 3.6, -4.2, Math.PI / 2)); }   // running boards, handrails
  L.add(at(bx(2.4, 0.5, 11.5, DARK), 0, 1.5, -4.4));                                                        // frame
  L.add(at(bx(2.8, 0.35, 0.4, IRON), 0, 1.4, 2.0));                                                         // buffer beam
  for (let i = -5; i <= 5; i++) L.add(at(bx(0.08, 1.35, 0.08, IRON), i * 0.22, 0.85, 2.6 - Math.abs(i) * 0.05, -0.62, 0, 0));   // pilot bars
  L.add(at(bx(0.3, 0.3, 0.4, DARK), 0, 1.25, 2.2));                                                         // coupler
  const wheels = [], rods = [];
  for (const sx of [-1, 1]) {
    L.add(at(cy(0.48, 0.48, 1.9, DARK, 24), sx * 1.1, 1.95, 0.4, Math.PI / 2));                              // cylinders
    L.add(at(bx(0.4, 0.7, 1.6, IRON), sx * 1.1, 2.6, 0.4));                                                   // steam chest
    L.add(at(bx(0.1, 0.12, 1.6, STEEL), sx * 1.15, 1.95, -1.2));                                              // crosshead guide
    for (let i = 0; i < 4; i++) {
      const wh = new THREE.Group(); wh.add(new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.09, 8, 36), STEEL));
      for (let k = 0; k < 14; k++) wh.add(at(bx(0.06, 1.55, 0.06, IRON), 0, 0, 0, 0, 0, k * Math.PI / 14));
      wh.add(at(cy(0.2, 0.2, 0.22, DARK, 16), 0, 0, 0, Math.PI / 2));
      const cw = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.14, 20, 1, false, 0, Math.PI * 0.7), DARK); wh.add(at(cw, 0, 0, 0, Math.PI / 2, 0, 0));
      wh.rotation.y = Math.PI / 2; const hold = group(wh); hold.position.set(sx * 1.25, 0.9, -1.9 - i * 1.75); L.add(hold); wheels.push(wh);
    }
    const side = bx(0.08, 0.14, 5.25, STEEL); L.add(side); const main = bx(0.08, 0.16, 2.6, STEEL); L.add(main); rods.push({ sx, side, main });
  }
  // the cab with its windows, the engineer leaning out; the tender
  L.add(at(bx(2.9, 2.8, 2.4, DARK), 0, 3.7, -9.6)); L.add(at(bx(3.3, 0.2, 3.0, IRON), 0, 5.2, -9.6));
  for (const sx of [-1, 1]) L.add(at(bx(0.06, 1.0, 1.1, m('#ffffff', {})), sx * 1.47, 4.2, -9.2));
  L.add(at(bx(3.0, 2.6, 5.6, m('#8e8e8e', {})), 0, 2.7, -13.8));
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) L.add(at(cy(0.45, 0.45, 0.2, DARK, 16), sx * 1.25, 0.6, -12 - i * 1.3, 0, 0, Math.PI / 2));
  const loco = put(s, L, 0, 0.45, -24);
  const F = folk(s, 8);
  const eng = F.add({ view: 'profile', pose: 'lean', dir: -1, h: 1.8, seed: 3 });
  const gd = F.add({ view: 'lost', pose: 'maul', dir: -1, h: 1.83, seed: 12 });
  F.set(gd, { x: 4.1, y: 0.5, z: -6.5 });
  const gd2 = F.add({ view: 'profile', pose: 'maul', dir: 1, h: 1.78, seed: 21 });
  F.set(gd2, { x: 5.3, y: 0.5, z: -8.5 });
  const cam = camera(50);
  return { s, cam, F, loco, wheels, rods,
    shot(name, u, t) {
      loco.position.z = -28 + u * 10;
      const ang = t * 6.5;
      for (const w of wheels) w.rotation.x = ang;
      for (const r of rods) { const cx = Math.cos(ang) * 0.36, cz = Math.sin(ang) * 0.36;
        r.side.position.set(r.sx * 1.42, 0.9 + cx, -4.55 + cz); r.main.position.set(r.sx * 1.36, 1.4 + cx * 0.5, -0.6 + cz * 0.5); r.main.rotation.x = -0.18 + cx * 0.1; }
      F.set(gd, { t }); F.set(gd2, { t: t + 0.4 });
      F.set(eng, { x: 1.25, y: 0.45 + 2.3, z: loco.position.z - 9.0, t });
      lk(cam, mixv([2.85, 1.3, 2.6], [2.75, 1.2, 2.0], u), mixv([2.1, 2.2, -30], [2.0, 2.4, -30], u)); cam.updateMatrixWorld();
      F.update(cam);
    }, stackPt: () => { const p = V3(0, 5.6, 0.6); return p.add(V3(0, 0.45, loco.position.z)); }, cylPts: () => [V3(-1.1, 1.95, 1.4 + loco.position.z), V3(1.1, 1.95, 1.4 + loco.position.z)] };
}

// ================================================================ GRAIN: the elevator, the spout, the hopper cars, the harvest
function grain() {
  const s = stage({ fog: [60, 700], key: [-0.75, 0.5, 0.45], keyI: 2.4, fill: 0.62, groundMat: (() => { const x = m('#c4c4c4', {}); x.map = TX.furrow(); x.map.repeat.set(200, 1); return x; })(), box: 90, center: [0, 0, -40] });
  const CON = m('#cdcdcd', { obj: 1 }), DARK = MAT.dark(), IRON = MAT.iron(), WIN = m('#c0c0c0', {}), RIB = m('#9e9e9e', {}), HOT = MAT.hot();
  WIN.map = TX.windows(); WIN.map.repeat.set(2, 10); RIB.map = TX.rib(); RIB.map.repeat.set(6, 1);
  // the elevator: two rows of slip-formed silos with ring courses, the tall headhouse and its penthouse, the leg,
  // distributor spouts, the gallery conveyor on its truss to the second tank group
  const el = new THREE.Group();
  for (let r = 0; r < 2; r++) for (let i = 0; i < 7; i++) { const x = -21 + i * 7.4, z = r * 7.4;
    el.add(at(cy(3.6, 3.6, 38, CON, 36), x, 19, z)); el.add(at(cy(3.75, 3.75, 0.7, DARK, 36), x, 38.3, z));
    for (let k = 1; k < 9; k++) el.add(at(new THREE.Mesh(new THREE.TorusGeometry(3.62, 0.05, 4, 36), DARK), x, k * 4.2, z, Math.PI / 2)); }
  el.add(at(bx(52, 3.6, 4.4, WIN), 1, 40.6, 3.7));                                                     // gallery on the silo tops
  el.add(at(bx(13, 60, 13, WIN), -32, 30, 3.7)); el.add(at(bx(9, 8, 9, WIN), -32, 64, 3.7)); el.add(at(new THREE.Mesh(new THREE.ConeGeometry(7.4, 4, 4), DARK), -32, 70, 3.7, 0, Math.PI / 4, 0));
  el.add(at(bx(2.4, 74, 2.4, IRON), -24.5, 37, 11.8));                                                 // the leg
  for (let i = 0; i < 5; i++) el.add(at(cy(0.4, 0.4, 16, IRON, 10), -22 + i * 3.4, 49, 8, 0, 0, -0.95));   // distributor spouts
  const gt = truss(40, 3, IRON, 10, 0.2, 1.4); el.add(at(gt, 44, 46, 3.7)); el.add(at(bx(40, 3, 3, RIB), 44, 47.5, 3.7));
  for (let i = 0; i < 4; i++) el.add(at(cy(3.2, 3.2, 30, CON, 32), 68 + i * 6.6, 15, 3.7));
  el.add(at(bx(20, 7, 8, RIB), -32, 3.5, 17));                                                         // the loading shed
  put(s, el, -46, 0, -100);
  // the loading track and a string of covered hoppers: ribbed sides, sloped bays, trucks, roof walk, ladders
  for (const z of [-0.72, 0.72]) put(s, bx(300, 0.16, 0.08, IRON), 0, 0.5, -30 + z);
  const car = () => { const g = new THREE.Group(); g.add(at(bx(15, 3.6, 3.1, RIB), 0, 3.2, 0)); g.add(at(bx(15.2, 0.3, 1.2, IRON), 0, 5.15, 0));
    for (let b = 0; b < 3; b++) g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 1.7, 1.6, 4, 1), DARK), -5 + b * 5, 0.9, 0, 0, Math.PI / 4, Math.PI));
    for (let k = 0; k < 4; k++) g.add(at(cy(0.45, 0.45, 0.3, DARK, 16), (k < 2 ? -6 : 6) + (k % 2) * 1.6 - 0.8, 0.55, 0, Math.PI / 2));
    for (let k = 0; k < 4; k++) g.add(at(cy(0.36, 0.36, 0.25, IRON, 16), -5.5 + k * 3.7, 5.35, 0));   // hatches
    for (const x of [-7.6, 7.6]) for (let k = 0; k < 6; k++) g.add(at(bx(0.05, 0.05, 0.7, IRON), x, 1.6 + k * 0.6, 1.4));
    return g; };
  for (let c = 0; c < 8; c++) put(s, car(), -6.8 + c * 15.8, 0.45, -30);
  // a steel loading tower beside the track, the spout from its head down into the hatch, the grain stream
  const tw = new THREE.Group();
  for (const x of [-1.5, 1.5]) for (const z of [-1.5, 1.5]) tw.add(at(bx(0.3, 18, 0.3, IRON), x, 9, z));
  for (let k = 1; k < 7; k++) for (const z of [-1.5, 1.5]) { tw.add(at(bx(3, 0.18, 0.18, IRON), 0, k * 2.8, z)); tw.add(at(bx(3.9, 0.12, 0.12, IRON), 0, k * 2.8 - 1.4, z, 0, 0, (k % 2 ? 1 : -1) * 0.75)); }
  tw.add(at(bx(4.4, 3.4, 4.4, RIB), 0, 19.6, 0)); tw.add(at(new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.6, 4), DARK), 0, 22.1, 0, 0, Math.PI / 4, 0));
  put(s, tw, -15.6, 0, -49);
  const spTop = V3(-15.2, 17.4, -47.2), spBot = V3(-12.3, 6.1, -30.3);
  const spd = spBot.clone().sub(spTop), sp = cy(0.2, 0.2, spd.length(), IRON, 16), spm = spTop.clone().addScaledVector(spd, 0.5), spq = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), spd.clone().normalize()); put(s, sp, spm.x, spm.y, spm.z).quaternion.copy(spq);
  const stream = put(s, cy(0.3, 0.42, 0.9, m('#ececec', { obj: 1, a1: [0, 1, 0] }), 10), -12.3, 5.6, -30.3, { cast: false });
  // the worker on the car roof guiding the spout, a second on the ground at the car mover
  const F = folk(s, 6);
  const hero = F.add({ view: 'profile', pose: 'reach', dir: 1, h: 1.8, seed: 5 });
  F.set(hero, { x: -13.2, y: 5.3, z: -30.0 });
  const m2 = F.add({ view: 'back', pose: 'stand', dir: 1, h: 1.78, seed: 8 });
  F.set(m2, { x: -2, y: 0, z: -27.5 });
  // the harvest beyond: the wheat, a combine cutting, its unloading auger over a grain cart
  const stalk = new THREE.CylinderGeometry(0.04, 0.05, 1.2, 4), N = 5000, R = rng(52), wm = m('#d0d0d0', {}), wheat = new THREE.InstancedMesh(stalk, wm, N), M4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < N; i++) { const x = -10 + R() * 90, z = -46 - R() * 150; e.set((R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.3); q.setFromEuler(e); M4.compose(V3(x, 0.6, z), q, V3(1, 0.8 + R() * 0.4, 1)); wheat.setMatrixAt(i, M4); }
  wheat.receiveShadow = true; s.add(wheat);
  const comb = new THREE.Group(); comb.add(at(bx(7, 4, 4, RIB), 0, 3.4, 0)); comb.add(at(bx(2.6, 2.6, 2.8, DARK), 2, 6.6, 0)); comb.add(at(bx(0.1, 1.6, 2.4, m('#ffffff', {})), 3.32, 6.8, 0));
  comb.add(at(bx(2, 1, 10, IRON), 5, 1.2, 0)); comb.add(at(cy(1, 1, 9.6, IRON, 8), 5.6, 2.2, 0, Math.PI / 2)); comb.add(at(cy(0.3, 0.3, 8, DARK), -1.5, 7.5, 3.6, 0.9));
  for (const x of [-2.4, 1.8]) for (const z of [-2.1, 2.1]) comb.add(at(cy(x > 0 ? 1.5 : 1, x > 0 ? 1.5 : 1, 0.9, DARK, 20), x, x > 0 ? 1.5 : 1, z, Math.PI / 2));
  const cb = put(s, comb, 6, 0, -104, { ry: 0.6 });
  const cart = group(at(bx(5, 2.4, 3, RIB), 0, 2, 0), at(cy(0.9, 0.9, 0.5, DARK, 16), -1, 0.9, 1.6, Math.PI / 2), at(cy(0.9, 0.9, 0.5, DARK, 16), -1, 0.9, -1.6, Math.PI / 2)); put(s, cart, 9, 0, -94, { ry: 0.6 });
  const cam = camera(54);
  return { s, cam, F, hero, stream,
    shot(name, u, t) {
      stream.scale.x = stream.scale.z = 1 + 0.1 * Math.sin(t * 29);
      F.set(hero, { t }); F.set(m2, { t });
      cb.position.x = 6 + u * 2;
      lk(cam, mixv([-11.8, 6.9, -25.2], [-12.2, 6.8, -26.0], u), mixv([-14.2, 7.6, -45], [-14.4, 7.9, -45], u)); cam.updateMatrixWorld();
      F.update(cam);
    }, streamPt: () => V3(-12.4, 5.6, -30.3) };
}

// ================================================================ FAB: the long plant, the air handlers, the lit door, the shift
function fab() {
  const s = stage({ fog: [45, 520], key: [0.35, 0.5, 0.8], keyI: 2.2, fill: 0.7, groundMat: (() => { const x = m('#c2c2c2', {}); x.map = TX.plate(); x.map.repeat.set(160, 160); return x; })(), box: 70, center: [0, 0, -30] });
  const FIN = m('#d2d2d2', {}), DARK = MAT.dark(), IRON = MAT.iron(), LAMP = MAT.lamp(), GLASS = m('#9a9a9a', {}), RIB = m('#b4b4b4', {});
  FIN.map = TX.fins(); FIN.map.repeat.set(40, 1); GLASS.map = TX.windows(); GLASS.map.repeat.set(6, 2); RIB.map = TX.rib(); RIB.map.repeat.set(3, 1);
  const f = new THREE.Group();
  f.add(at(bx(170, 22, 60, FIN), 0, 11, 0)); f.add(at(bx(172, 1.2, 62, DARK), 0, 22.4, 0)); f.add(at(bx(174, 1.6, 64, DARK), 0, 0.8, 0));
  for (let i = 0; i < 15; i++) { const x = -75 + i * 10.7; f.add(at(bx(8, 4.2, 14, RIB), x, 25.1, -8)); for (const z of [-11.5, -4.5]) { f.add(at(cy(2, 2, 1, DARK, 20), x, 27.6, z)); f.add(at(new THREE.Mesh(new THREE.TorusGeometry(2, 0.12, 6, 24), IRON), x, 28.1, z, Math.PI / 2)); } }
  for (const x of [-55, 30, 70]) f.add(at(banded(2.4, 50, IRON, 6), x, 0, 12));
  for (let i = 0; i < 7; i++) f.add(at(cy(0.7, 0.7, 170, IRON, 12), 0, 3 + i * 1.7, 31.5, 0, 0, Math.PI / 2));   // pipe rack
  for (let i = 0; i < 12; i++) f.add(at(bx(0.4, 15, 0.4, DARK), -80 + i * 14.5, 7.5, 31.5));
  f.add(at(bx(30, 16, 10, GLASS), -18, 8, 34)); f.add(at(bx(36, 0.8, 12, DARK), -18, 16.4, 36));
  f.add(at(bx(10, 8, 0.4, LAMP), -18, 4, 39.2));                                                        // the lit loading door
  for (let i = 0; i < 4; i++) f.add(at(bx(0.3, 8, 0.6, DARK), -22.8 + i * 3.2, 4, 39.4)); f.add(at(bx(10.2, 0.4, 0.6, DARK), -18, 8.1, 39.4));
  put(s, f, 10, 0, -70, { ry: -0.28 });
  // lamp posts along the walk
  for (let i = 0; i < 6; i++) put(s, group(at(cy(0.12, 0.16, 7, DARK, 8), 0, 3.5, 0), at(bx(1.2, 0.3, 0.4, DARK), 0.5, 7, 0), at(bx(0.8, 0.1, 0.3, LAMP), 0.6, 6.84, 0)), -12 + (i % 2) * 14, 0, -6 - Math.floor(i / 2) * 14);
  // far: a substation and a second hall
  for (let i = 0; i < 7; i++) { const tw = new THREE.Group(); for (const sx of [-1, 1]) tw.add(at(bx(0.5, 30, 0.5, IRON), sx * 3, 15, 0, 0, 0, -sx * 0.08)); for (let k = 0; k < 5; k++) tw.add(at(bx(7 - k, 0.4, 0.4, IRON), 0, 5 + k * 6, 0)); put(s, tw, -200 + i * 40, 0, -300); }
  put(s, bx(140, 26, 40, FIN), 160, 13, -330);
  // the shift through the door: a dozen walking out toward the lens, faces lit; the hero in front
  const F = folk(s, 16), crew = [], TR = ['steel', 'overalls', 'weld', 'farm', 'rail'];
  for (let i = 0; i < 40; i++) { const id = F.add({ view: 'back', pose: 'walk', dir: 1, h: 1.72 + (i * 37 % 11) / 60, seed: 30 + i * 7 });
    const row = Math.floor(i / 6), x = -6.4 + (i % 6) * 1.75 + (row % 2) * 0.8 + ((i * 53) % 7 - 3) * 0.08, z = -0.2 - row * 1.5;
    crew.push({ id, x, z0: z, ph: i * 1.7 }); }
  const cam = camera(50);
  return { s, cam, F, crew,
    shot(name, u, t) {
      for (const c of crew) F.set(c.id, { x: c.x, y: 0, z: c.z0 - u * 1.6, ph: c.ph + t * 5.6 });
      if (name === 'stamp') lk(cam, [-0.9, 1.6, 6.8], [-2.2, 4.2, -20]);
      else lk(cam, mixv([-0.5, 1.3, 5.4], [-0.75, 1.36, 4.95], u), mixv([-1.9, 2.2, -20], [-1.8, 2.5, -20], u));
      cam.updateMatrixWorld(); F.update(cam);
    } };
}

// ================================================================ THE VAULT: boltwork, handwheel, hinge; racks of the new notes; the crowd
function vault() {
  const s = stage({ fog: [20, 140], key: [-0.5, 0.45, 0.8], keyI: 2.3, fill: 0.6, sky: false, ground: true, groundMat: (() => { const x = m('#c8c8c8', {}); x.map = TX.plate(); x.map.repeat.set(60, 60); return x; })(), box: 30, center: [0, 3, 0] });
  const STEEL = MAT.steel(), DARK = MAT.dark(), IRON = MAT.iron(), LAMP = MAT.lamp(), WALL = m('#bdbdbd', {});
  WALL.map = TX.block(); WALL.map.repeat.set(6, 4);
  const R0 = 3.4, CY = 3.9;
  const wall = new THREE.Group();
  const shape = new THREE.Shape(); shape.moveTo(-20, 0); shape.lineTo(20, 0); shape.lineTo(20, 16); shape.lineTo(-20, 16); shape.lineTo(-20, 0);
  const hole = new THREE.Path(); hole.absarc(0, CY, R0 + 0.15, 0, TAU, true); shape.holes.push(hole);
  const wg = new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false, curveSegments: 64 }); wall.add(at(new THREE.Mesh(wg, WALL), 0, 0, -1.6));
  wall.add(at(new THREE.Mesh(new THREE.TorusGeometry(R0 + 0.45, 0.4, 16, 72), IRON), 0, CY, 0.1));
  wall.add(at(new THREE.Mesh(new THREE.TorusGeometry(R0 + 1.05, 0.12, 8, 72), DARK), 0, CY, 0.05));
  for (let i = 0; i < 36; i++) { const a = i / 36 * TAU; wall.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), STEEL), Math.cos(a) * (R0 + 0.8), CY + Math.sin(a) * (R0 + 0.8), 0.25)); }
  wall.add(at(bx(40, 0.6, 0.6, DARK), 0, 12, 0.2)); for (const x of [-18, -12, -7.5, 7.5, 12, 18]) wall.add(at(bx(0.5, 12, 0.5, DARK), x, 6, 0.2));
  put(s, wall, 0, 0, 0);
  // inside: a vaulted room, racks and racks of strapped bricks of the new notes, lit
  const room = new THREE.Group();
  room.add(at(bx(16, 0.2, 30, m('#dedede', {})), 0, 0.02, -16)); room.add(at(bx(16, 10, 0.3, m('#d4d4d4', {})), 0, 5, -31));
  // shelving both sides of the aisle: seven shelves, each stacked with strapped bundles of the new notes
  const bG = new THREE.BoxGeometry(0.42, 0.13, 0.22), sG = new THREE.BoxGeometry(0.06, 0.135, 0.225), NB = 2 * 7 * 18 * 3;
  const bundles = new THREE.InstancedMesh(bG, m('#e8e8e8', { obj: 1 }), NB), straps = new THREE.InstancedMesh(sG, m('#3c3c3c', { obj: 1 }), NB), M4 = new THREE.Matrix4(); let n = 0;
  for (const side of [-1, 1]) for (let r = 0; r < 7; r++) for (let k = 0; k < 18; k++) for (let h = 0; h < 3; h++) {
    M4.makeTranslation(side * 3.05, 0.44 + r * 0.9 + h * 0.135, -2.6 - k * 0.66); bundles.setMatrixAt(n, M4); straps.setMatrixAt(n, M4); n++; }
  bundles.castShadow = bundles.receiveShadow = straps.receiveShadow = true; room.add(bundles); room.add(straps);
  for (const side of [-1, 1]) for (let r = 0; r < 8; r++) room.add(at(bx(0.7, 0.06, 12.4, DARK), side * 3.1, 0.35 + r * 0.9, -8.4));
  for (const side of [-1, 1]) for (let k = 0; k < 4; k++) room.add(at(bx(0.08, 6.4, 0.08, DARK), side * 3.65, 3.2, -3 - k * 3.6));
  for (let k = 0; k < 4; k++) room.add(at(bx(1.6, 0.1, 0.4, LAMP), 0, 7.4, -3 - k * 5));
  put(s, room, 0, 0, -1.4);
  const inL = new THREE.PointLight(0xffffff, 80, 30, 1.2); inL.position.set(0, 5, -6); s.add(inL);
  // the door: a stepped slab, the ring of locking bolts, the spoked handwheel, the time lock, the hinge arm and barrel
  const hinge = new THREE.Group(); hinge.position.set(R0 + 0.9, CY, 0.9); s.add(hinge);
  const door = new THREE.Group(); door.position.set(-(R0 + 0.9), 0, 0); hinge.add(door);
  for (let k = 0; k < 4; k++) door.add(at(cy(R0 - k * 0.25, R0 - k * 0.25, 0.5, STEEL, 96), 0, 0, 0.25 + k * 0.4 - 0.9, Math.PI / 2));
  for (let k = 0; k < 5; k++) door.add(at(new THREE.Mesh(new THREE.TorusGeometry(R0 * (0.82 - k * 0.13), 0.06, 8, 96), DARK), 0, 0, 0.72));
  const bolts = [];
  for (let i = 0; i < 20; i++) { const a = i / 20 * TAU; const b = at(cy(0.2, 0.2, 1.4, STEEL, 16), Math.cos(a) * (R0 + 0.3), Math.sin(a) * (R0 + 0.3), -0.3, 0, 0, a + Math.PI / 2); door.add(b); bolts.push([b, a]); }
  const wheel = new THREE.Group(); wheel.position.z = 1.3; door.add(wheel);
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.1, 12, 64), STEEL)); wheel.add(at(cy(0.34, 0.4, 0.4, DARK, 32), 0, 0, -0.1, Math.PI / 2));
  for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; wheel.add(at(cy(0.06, 0.06, 1.25, STEEL, 8), Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0, 0, 0, a - Math.PI / 2)); wheel.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), STEEL), Math.cos(a) * 1.38, Math.sin(a) * 1.38, 0)); }
  door.add(at(bx(1.3, 0.8, 0.3, DARK), 0, 2.15, 0.85)); for (let i = 0; i < 3; i++) door.add(at(cy(0.13, 0.13, 0.08, LAMP, 16), -0.4 + i * 0.4, 2.15, 1.02, Math.PI / 2));
  hinge.add(at(cy(0.5, 0.5, 5.4, IRON, 24), 0, 0, 0)); for (const y of [-2.2, 2.2]) hinge.add(at(bx(2.4, 0.7, 0.8, DARK), -1.0, y, 0.2));
  // the crowd coming through
  const F = folk(s, 10), crew = [], TR = ['steel', 'farm', 'overalls', 'rail', 'weld'];
  for (let i = 0; i < 8; i++) crew.push({ id: F.add({ view: 'front', pose: 'walk', dir: 1, h: 1.76, seed: 60 + i * 5 }), ph: i * 2.1, x: (i % 3 - 1) * 1.1 + (i > 2 ? 0.5 : 0), z0: -4 - i * 1.5 });
  const cam = camera(48);
  return { s, cam, F, hinge, wheel, bolts, crew,
    shot(name, u, t, o) {                                   // o: door opening 0..1, w: wheel turns, walk: crowd progress
      hinge.rotation.y = -o.open * 1.9; wheel.rotation.z = -o.spin;
      for (const [b, a] of bolts) { const r = R0 + 0.3 - o.retract * 0.9; b.position.set(Math.cos(a) * r, Math.sin(a) * r, -0.3); }
      for (const c of crew) F.set(c.id, { x: c.x, y: 0, z: c.z0 + o.walk * 9, ph: c.ph + t * 5.6, visible: o.walk > 0 });
      lk(cam, mixv([-1.6, 2.4, 17], [-0.5, 3.0, 9.5], u), mixv([0.4, 4.4, 0], [0, 4.0, -2], u)); cam.updateMatrixWorld(); F.update(cam);
    } };
}

// ================================================================ build and draw
export const WORLDS = {};
export function build(names = ['mill', 'rail', 'grain', 'fab', 'vault']) {
  const F = { mill, rail, grain, fab, vault };
  for (const n of names) WORLDS[n] = F[n]();
  return WORLDS;
}
// render a world's shot into a 2D context (the ink layer); returns the world for overlay projection
export function drawWorld(g, name, shot, u, t, o = {}, { pitch = 7, x = 0, y = 0, w = W, h = H, expo = 1, gamma = 1 } = {}) {
  const Wd = WORLDS[name]; Wd.shot(shot, u, t, o);
  E.U.uT.value = t;
  E.draw(g, Wd.s, Wd.cam, { pitch, expo, gamma, x, y, w, h });
  return Wd;
}
// project a world point to output pixels (for sparks, steam, heat haze drawn in 2D over the engraving)
// the figure anchors of a world's current shot, projected: feet and head in output pixels (x, y, h), nearest last
export function figures(Wd) {
  const F = Wd.F; if (!F || !F.cam) return [];
  const out = [];
  for (const f of F.list) { const st = f.st; if (!st.visible) continue;
    const a = V3(st.x, st.y, st.z).project(F.cam), b = V3(st.x, st.y + (f.spec.h || 1.8), st.z).project(F.cam);
    if (a.z > 1 || b.z > 1) continue;
    const fx = (a.x * 0.5 + 0.5) * W, fy = (0.5 - a.y * 0.5) * H, hy = (0.5 - b.y * 0.5) * H;
    out.push({ ...f.spec, x: fx, y: fy, h: fy - hy, depth: a.z, t: st.t || 0, ph: st.ph || 0 }); }
  return out.sort((p, q) => q.depth - p.depth);
}
export function project(Wd, p) { const v = p.clone().project(Wd.cam); return [(v.x * 0.5 + 0.5) * W, (0.5 - v.y * 0.5) * H, v.z]; }
export { THREE };
export const renderer = E.renderer;
