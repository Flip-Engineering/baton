// FOLK WORLDS: people placed IN the WORLDS kit's places, lit by those places' own lights (HUMAN studio, cycle 3).
//
// Why: every WORLDS plate was empty (a plant with no worker, a gantry with no driver, a pivot with no farmer), and every
// person on the slate stood in a studio light. Here each place gets people DESIGNED FOR ITS LIGHT: the key is the
// place's practical (the sodium fixture over a catwalk, a bucket truck's work light from below, the dusk sky), the rim
// is the place's glow (the plant, the lit cloud deck, the sun), so faces fall into the shadow of a hard-hat brim and
// only the nose, the cheekbone and the hands catch light (the house rule for free). The WORLDS render is the plate
// (web/assets/worlds_plates/, rendered by lab_americana2); the people and their near set are 3D (hero.js) composited
// over it like a matte painting.
//
//   import { Stage, KITS } from '../lib/fx/folk_worlds.js';
//   const st = new Stage(); await st.init();
//   const shot = await KITS.plant(st, { thermal: false });   // -> { frame(t) -> { color, aux, info } }
// Kits: plant (workers on a catwalk under sodium, the plant beyond; &thermal: FLIR with faces and hands hot, clothes
// cool and flat, collar and cuff gaps hot, breath), profile (the hero close, lost profile under the brim), lineman
// (a bucket at 12 m, gauntlets on the conductor, work light from below, amber strobe rim), farmer (a small figure at the
// pivot tower against the dusk), driver (gloved hands at ten and two, the gantry legend sweeping over them).
import * as THREE from 'three';
import { loadHeroData, Hero } from './hero.js';
import { loadTake, heroMap } from './bvh.js';
import { fpPatchScene, FigurePass } from './figure_pass.js';
import { GESTURES } from './gesture.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const MOCAP = new URL('../../../sources/mocap/cmu/', import.meta.url).href;
const PLATES = new URL('../../assets/worlds_plates/', import.meta.url).href;
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// target-mode arm glyphs for the kits (body frame: x out to the arm's side, y up from the feet, z forward); all hands
// low or on a prop, none raised, so the salute measure never applies
Object.assign(GESTURES, {
  RAIL: { target: [0.2, 1.08, 0.42], pole: [1, -0.6, -0.4], prop: true },          // forearms toward a rail at 1.07 m
  LINE_HI: { target: [0.2, 1.64, 0.26], pole: [1, -0.6, -0.3], prop: true },     // elbow well bent: never a straight forward arm      // a gloved hand on a conductor at the brow
  LINE_LO: { target: [0.16, 1.2, 0.34], pole: [1, -0.8, -0.2], prop: true },
  WHEEL10: { target: [0.2, 1.1, 0.46], pole: [1, -0.9, -0.2], prop: true },         // a seated driver's hands (seat height 0.45 m)
  SPAN: { target: [0.18, 1.45, 0.34], pole: [1, -0.7, -0.4], prop: true },         // a hand up on the pivot span's pipe
  SIDE: { target: [0.2, 0.86, 0.03], pole: [0.3, 0, -1], prop: true },            // an arm hanging at the side, elbow a little back
  HIP: { target: [0.17, 1.0, -0.02], pole: [1, 0, -0.3], prop: true },             // a hand at the hip, elbow out
});

export class Stage {
  constructor({ W = 1080, H = 1920 } = {}) {
    this.W = W; this.H = H;
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    const r = this.r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1); r.setSize(W, H, false); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1; r.outputColorSpace = THREE.SRGBColorSpace; r.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, W / H, 0.02, 4000);
    this.heroes = []; this.fp = new FigurePass(r, W / 2, H / 2);
  }
  async init() { this.data = await loadHeroData(); this.take = await loadTake(MOCAP + '56_02.bvh'); this.takes = { '56_02': this.take }; return this; }
  async useTake(h, name) { const tk = this.takes[name] || (this.takes[name] = await loadTake(MOCAP + name + '.bvh')); h.clip = tk.retarget(heroMap(h.names), h.rig); return h; }
  hero(o) { const h = new Hero(this.data, o); this.scene.add(h.group); h.clip = this.take.retarget(heroMap(h.names), h.rig); h.o2 = o; this.heroes.push(h); return h; }
  // a standing frame of 56_02, the root put at (x, y, z), turned to `turn` (0 faces +z); head tipped/turned
  stand(h, { x = 0, y = 0, z = 0, turn = 0, t = 0.35, head = 0, nod = 0, chest = 0 } = {}) {
    if (t === 'bind') { h.resetPose(); h.update(); } else { h.applyClip(h.clip.sample(t)); h.root.position.x = 0; h.root.position.z = 0; h.cancelYaw(); }
    h.group.position.set(x, y, z); h.group.rotation.y = turn; h.update();
    if (t === 'bind') { h.gesture('L', 'SIDE', { fist: false }); h.gesture('R', 'SIDE', { fist: false }); h.relaxHand('L'); h.relaxHand('R'); }
    const lat = V3(1, 0, 0).applyAxisAngle(V3(0, 1, 0), turn);
    if (chest) h.rotateWorld('spine02', lat, chest);
    if (nod) h.rotateWorld('head', lat, nod);
    if (head) h.rotateWorld('neck01', V3(0, 1, 0), head);
    h.update(); return h;
  }
  // place a cylinder (a rail, a conductor, a wheel rim segment) where a hand is and grip it
  gripAt(h, side, d, r = 0.018) { h.update(); const P = h.palm(side), p = P.palm.clone().addScaledVector(P.n, r); const g = h.grip(side, { p, d: d.clone().normalize(), r }); h.update(); return { p, g }; }
  lookAt(pos, target, fov) { const c = this.camera; if (fov) c.fov = fov; c.position.copy(pos); c.up.set(0, 1, 0); c.lookAt(target); c.updateProjectionMatrix(); c.updateMatrixWorld(); }
  project(p) { const v = p.clone().project(this.camera); return [(v.x * 0.5 + 0.5) * this.W, (-v.y * 0.5 + 0.5) * this.H, v.z]; }
  pxPerM(p) { const z = -p.clone().applyMatrix4(this.camera.matrixWorldInverse).z; return this.H / (2 * z * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))); }
  renderLit() { fpPatchScene(this.scene); this.r.setClearColor(0, 0); this.r.render(this.scene, this.camera); return this.canvas; }
  renderRim(light, o = {}) { fpPatchScene(this.scene); this.fp.rim(this.scene, this.camera, { light, rim: '#ffc79a', rim2: '#ff3a14', body: '#0b0304', bump: 0.6, wrapK: 0.1, bounce: 0.02, ...o }); return this.canvas; }
  gbuf() { fpPatchScene(this.scene); return this.fp.read(this.scene, this.camera); }
  // the aux the looks read: figures (subject) and the near set (mid) from the G-buffer; the plate: sky above the
  // plate's horizon (sky, depth 65535), far below it
  aux(gb, { horizonY = 960, setCls = 128 } = {}) {
    const w = 540, h = 960, c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d'), im = g.createImageData(w, h), D = im.data;
    const [zn, zf] = gb.range, LN = Math.log(Math.max(zf, zn + 1e-3) * 3 / Math.max(zn, 1e-3));
    const hy = horizonY * h / this.H;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (h - 1 - y) * w + x, o = (y * w + x) * 4; D[o + 3] = 255;
      const z = gb.nd[i * 4 + 3], sub = gb.uvm[i * 4 + 2];
      if (z > 0) { const d = clamp(Math.log(z / zn) / LN, 0, 0.98), l = Math.round(65534 * d); D[o] = l >> 8; D[o + 1] = l & 255; D[o + 2] = sub > 0.5 ? 255 : setCls; }
      else if (y < hy) { D[o] = 255; D[o + 1] = 255; D[o + 2] = 0; }
      else { const l = 64000; D[o] = l >> 8; D[o + 1] = l & 255; D[o + 2] = 64; } }
    g.putImageData(im, 0, 0); return c;
  }
  // THERMAL (LWIR): what a FLIR sees of a clothed person. Exposed skin (face, neck, hands) is the beacon (~34 C); outer
  // clothing reads cooler and FLAT (24-27 C); the gaps at the collar and the cuffs are hot rims; a hard hat is cold; the
  // steel of the set is colder still. Emissivity falls at grazing angles, so the form reads as a gradient at the edge.
  // Needs st.parts(h) tags (mesh.userData.therm = C). Returns a canvas in the WORLDS ironbow (thermalLUT).
  thermal(temps, { amb = 9, span = [4, 38], lut = thermalLUT } = {}) {
    fpPatchScene(this.scene);
    const set = []; this.scene.traverse(o => { if (!o.isMesh || !o.material?.userData?.fp) return; const T = o.userData.therm ?? temps.default ?? amb; o.material.userData.fp.fpSubj.value = (T - span[0]) / (span[1] - span[0]); set.push(o); });
    const gb = this.fp.read(this.scene, this.camera), w = this.fp.w, h = this.fp.h;
    for (const o of set) o.material.userData.fp.fpSubj.value = o.userData.subject ?? 0;
    const T = new Float32Array(w * h).fill(-99), skin = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (h - 1 - y) * w + x; if (gb.nd[i * 4 + 3] <= 0) continue;
      const t0 = span[0] + gb.uvm[i * 4 + 2] * (span[1] - span[0]), nz = Math.abs(gb.nd[i * 4 + 2]);
      T[y * w + x] = amb + (t0 - amb) * (0.62 + 0.38 * Math.pow(nz, 0.7)); if (t0 > 31) skin[y * w + x] = 1; }
    // the collar / cuff gap: cloth within 3 px of exposed skin is warmed toward it
    const T2 = T.slice();
    for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) { const k = y * w + x; if (T[k] < 18 || skin[k]) continue; let near = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (skin[k + dy * w + dx]) near = Math.max(near, 1 - Math.hypot(dx, dy) / 4.3);
      if (near > 0) T2[k] = T[k] + (31 - T[k]) * near * 0.8; }
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d'), im = g.createImageData(w, h);
    for (let k = 0; k < w * h; k++) { if (T2[k] < -50) continue; const [r, gg, b] = lut(clamp((T2[k] - span[0]) / (span[1] - span[0])));
      im.data[k * 4] = r; im.data[k * 4 + 1] = gg; im.data[k * 4 + 2] = b; im.data[k * 4 + 3] = 255; }
    g.putImageData(im, 0, 0); return c;
  }
}
// the WORLDS thermal plate's palette (shot4t): navy - violet - magenta - orange - yellow - white
export function thermalLUT(u) {
  const S = [[0, [10, 4, 40]], [0.28, [70, 20, 130]], [0.5, [150, 30, 160]], [0.66, [220, 60, 110]], [0.78, [250, 130, 40]], [0.9, [255, 215, 70]], [1, [255, 252, 225]]];
  for (let i = 1; i < S.length; i++) if (u <= S[i][0]) { const [a, A] = S[i - 1], [b, B] = S[i], f = (u - a) / (b - a); return A.map((v, j) => Math.round(v + (B[j] - v) * f)); }
  return S[S.length - 1][1];
}
// tag a hero's meshes with temperatures (C)
export function heatHero(h, { skin = 34, top = 26, bottom = 25, boots = 17, hat = 15, hair = 29, gloves = 22 } = {}) {
  h.body.userData.therm = skin;
  for (const [k, m] of Object.entries(h.cloth || {})) if (m && m.isMesh) m.userData.therm = { top, bottom, boots, gloves }[k] ?? top;
  if (h.cloth?.boots?.traverse) h.cloth.boots.traverse(o => { if (o.isMesh) o.userData.therm = boots; });
  if (h.hairMesh) h.hairMesh.userData.therm = hair;
  if (h.hatGroup) h.hatGroup.traverse(o => { if (o.isMesh) o.userData.therm = hat; });
  if (h.eyes) h.eyes.userData.therm = skin - 1;
}
// Asaro planes of the head (C1 of the brief): the head's normals flattened onto ~k planes (k-means on position +
// normal over the head and jaw vertices), so a print reads where the value CHANGES (plane to plane) instead of hatching
// a smooth plaster bust. Returns a function that restores the smooth normals.
export function planeHead(h, k = 41, { iters = 8, wN = 0.06 } = {}) {
  const g = h.body.geometry, P = g.attributes.position.array, N = g.attributes.normal, n0 = N.array.slice(), AH = g.attributes.aHero.array, R = { head: 0, jaw: 11, neck: 1 };
  const vs = []; for (let v = 0; v < P.length / 3; v++) { const r = AH[v * 4]; if (r === R.head || r === R.jaw) vs.push(v); }
  if (!vs.length) return () => {};
  const f = v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2], n0[v * 3] * wN, n0[v * 3 + 1] * wN, n0[v * 3 + 2] * wN];
  let C = []; for (let j = 0; j < k; j++) C.push(f(vs[Math.floor((j + 0.5) / k * vs.length)]));
  const lab = new Int32Array(vs.length);
  for (let it = 0; it < iters; it++) {
    vs.forEach((v, i) => { const x = f(v); let best = 0, bd = 1e9; for (let j = 0; j < k; j++) { const c = C[j]; let d = 0; for (let q = 0; q < 6; q++) d += (x[q] - c[q]) ** 2; if (d < bd) { bd = d; best = j; } } lab[i] = best; });
    const S = Array.from({ length: k }, () => [0, 0, 0, 0, 0, 0, 0]);
    vs.forEach((v, i) => { const x = f(v), s = S[lab[i]]; for (let q = 0; q < 6; q++) s[q] += x[q]; s[6]++; });
    C = S.map((s, j) => s[6] ? s.slice(0, 6).map(u => u / s[6]) : C[j]);
  }
  const NA = N.array;
  vs.forEach((v, i) => { const c = C[lab[i]], l = Math.hypot(c[3], c[4], c[5]) || 1; NA[v * 3] = c[3] / l; NA[v * 3 + 1] = c[4] / l; NA[v * 3 + 2] = c[5] / l; });
  N.needsUpdate = true;
  h.planeIds = { vs, lab };
  return () => { NA.set(n0); N.needsUpdate = true; };
}

// ---------------------------------------------------------------- helpers for the near set
const mat = (color, rough = 0.7, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
function bar(scene, a, b, r, m, sub = 0) { const d = b.clone().sub(a), L = d.length(); const me = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 12), m);
  me.position.copy(a).add(b).multiplyScalar(0.5); me.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); me.castShadow = me.receiveShadow = true; me.userData.subject = sub; scene.add(me); return me; }
function box(scene, c, s, m, sub = 0) { const me = new THREE.Mesh(new THREE.BoxGeometry(...s), m); me.position.copy(c); me.castShadow = me.receiveShadow = true; me.userData.subject = sub; scene.add(me); return me; }
// draw a plate cover-fitted into (0,0,W,H) with an offset (plates are 1080x1920), optional scale about the top
function plate(g, img, { W = 1080, H = 1920, s = 1, dx = 0, dy = 0 } = {}) { g.drawImage(img, dx - (s - 1) * W / 2, dy, W * s, H * s); }

export const KITS = {};

// ---------------------------------------------------------------- 1. workers on a catwalk under the plant's lights
// The camera stands on a high catwalk of the plant (the WORLDS plant plate is shot from 42 m). Three to four men at the
// rail looking out at the plant: the hero three-quarter back at ~22% of frame height, both forearms on the top rail and
// a gloved grip on it; a sodium fixture in a cage over them (the key: top light, the brim throws the face into shadow);
// the plant's glow is the rim on their backs and hats. The far men are silhouettes in the plume light.
// WORLDS c2 (opt-in, backward compatible): plate / plateT / plateFlare name other WORLDS plates (plant_c2*: the reframed hero stack and
// plume, no river), PL places them, and kit.flare (0..1, set per frame) cross-fades the flare plate in and keys the men from the world side.
KITS.plant = async (st, { thermal = false, close = false, plate: plateName = null, plateT = null, plateFlare = null, PL: PLo = null, flareColor = '#ffa050', flareK = 9 } = {}) => {
  const S = st.scene, img = await loadImg(PLATES + (thermal ? (plateT || 'shot4t.jpg') : (plateName || 'shot4.jpg')));
  const imgF = plateFlare && !thermal ? await loadImg(PLATES + plateFlare) : null;
  // the catwalk rail recedes to the left, away from the camera; the men stand along it, looking out over it
  const u = V3(-0.78, 0, -0.62).normalize(), n = V3(-u.z, 0, u.x);           // n: the rail's normal toward the plant (away from camera)
  const cast = [
    { variant: 'forge', height: 1.82, kind: 'coat', shirt: '#4a3a28', trousers: '#2a2a2c', hat: 'hard', hatColor: '#d8d2c4', beard: 0, stubble: 0.7, skin: '#a06a48', hair: '#1a120c', seed: 51, dirt: 0.5, gloves: true, gloveColor: '#6a5238', s: 0, arms: 'rail', yaw: 0.25 },
    { variant: 'heavy', height: 1.78, kind: 'work', shirt: '#2e3844', shirt2: '#2a2a2a', trousers: '#3a3226', hat: 'hard', hatColor: '#e0b820', beard: 0, stubble: 0.6, skin: '#6e4a32', seed: 52, dirt: 0.4, s: 2.3, arms: 'rail', yaw: -0.1 },
    { variant: 'plains', height: 1.86, kind: 'leather', shirt: '#3a2a20', trousers: '#2c3444', hat: 'hard', hatColor: '#c85a14', beard: 0.6, skin: '#b88a6a', hair: '#3a2a1a', seed: 53, dirt: 0.5, s: 4.1, arms: 'hip', yaw: 0.5, back: 0.35 },
    { variant: 'forge', height: 1.76, kind: 'flannel', shirt: '#6a1418', shirt2: '#141010', trousers: '#2c3e5e', hat: 'hard', hatColor: '#e8e4dc', beard: 0.2, skin: '#8a5a3c', seed: 54, dirt: 0.3, s: 6.6, arms: 'rail', yaw: -0.3 },
  ];
  const heroes = cast.map(o => st.hero(o));
  const railPt = sv => u.clone().multiplyScalar(sv);                          // the rail line at y = its height, through the origin's foot of the normal
  const face = Math.atan2(n.x, n.z);                                          // heading that looks along n
  heroes.forEach((h, i) => { const o = cast[i], p = railPt(o.s).addScaledVector(n, -(0.44 + (o.back || 0)));
    st.stand(h, { x: p.x, z: p.z, turn: face + o.yaw, t: 'bind', nod: -0.04, head: o.head || 0 });
    if (o.arms === 'rail') { h.gesture('L', 'RAIL', { fist: false }); h.gesture('R', 'RAIL', { fist: false }); }
    else if (o.arms === 'hip') { h.gesture('L', 'HIP', { fist: false }); h.relaxHand('L', 0.6); }
    heatHero(h, { gloves: o.gloves ? 24 : 26 }); });
  // the rail at the hero's grip height, through his right palm
  const h0 = heroes[0]; h0.update();
  const gp0 = h0.palm('R').palm.clone().addScaledVector(h0.palm('R').n, 0.021);
  const off = gp0.clone().sub(railPt(0)); off.y = 0; const along = off.dot(u);
  const base = gp0.clone().addScaledVector(u, -along);                        // the rail passes through the grip
  const RL = sv => base.clone().addScaledVector(u, sv);
  heroes.forEach((h, i) => { if (cast[i].arms !== 'rail') return; for (const s of ['L', 'R']) st.gripAt(h, s, u, 0.021); });
  const steel = mat('#3a3c40', 0.45, 0.7), yellow = mat('#b89a20', 0.55, 0.3);
  bar(S, RL(-10), RL(20), 0.021, yellow); bar(S, RL(-10).add(V3(0, -0.52, 0)), RL(20).add(V3(0, -0.52, 0)), 0.018, yellow);
  for (let sv = -10; sv <= 20; sv += 1.9) { const p = RL(sv); bar(S, V3(p.x, 0, p.z), p.clone().add(V3(0, 0.02, 0)), 0.024, yellow); }
  bar(S, RL(-10).setY(0.06), RL(20).setY(0.06), 0.06, steel);                 // toe board
  // bar grating: a canvas texture of bearing bars with the dark below between them (the sodium pool shows it)
  const gc = document.createElement('canvas'); gc.width = 256; gc.height = 256; const gg = gc.getContext('2d');
  gg.fillStyle = '#050505'; gg.fillRect(0, 0, 256, 256); gg.fillStyle = '#3e3a34'; for (let x = 0; x < 256; x += 16) gg.fillRect(x, 0, 5, 256); gg.fillStyle = '#2e2a26'; for (let y = 0; y < 256; y += 64) gg.fillRect(0, y, 256, 4);
  const gt = new THREE.CanvasTexture(gc); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(24, 24); gt.anisotropy = 8; gt.colorSpace = THREE.SRGBColorSpace;
  // a catwalk 1.5 m wide: the grating strip from the rail inward, an inner rail, and the dark below
  const CWID = 1.5; gt.repeat.set(30 / 4, CWID / 4 * 4);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(30, CWID), new THREE.MeshStandardMaterial({ map: gt, roughness: 0.6, metalness: 0.6 })); fl.rotation.x = -Math.PI / 2; fl.rotation.z = -Math.atan2(u.z, u.x);
  fl.position.copy(RL(5)).setY(0).addScaledVector(n, -CWID / 2 + 0.05); fl.receiveShadow = true; fl.userData.subject = 0; fl.userData.therm = 11; S.add(fl);
  { const RI = sv => RL(sv).addScaledVector(n, -CWID); bar(S, RI(-10), RI(20), 0.021, yellow); bar(S, RI(-10).add(V3(0, -0.52, 0)), RI(20).add(V3(0, -0.52, 0)), 0.018, yellow);
    for (let sv = -10; sv <= 20; sv += 1.9) { const p = RI(sv); bar(S, V3(p.x, 0, p.z), p.clone().add(V3(0, 0.02, 0)), 0.024, yellow); }
    bar(S, RI(-10).setY(-0.12), RI(20).setY(-0.12), 0.1, steel); bar(S, RL(-10).setY(-0.12), RL(20).setY(-0.12), 0.1, steel); }
  // the lamp: a caged sodium head on a stanchion off the rail, over the hero, a little toward the plant
  const lampP = h0.joint('head').clone().add(V3(0, 1.9, 0)).addScaledVector(n, 0.35).addScaledVector(u, -0.2), post = close ? RL(2.6).addScaledVector(n, 0.12) : RL(0.9).addScaledVector(n, 0.12);
  bar(S, V3(post.x, 0, post.z), V3(post.x, lampP.y + 0.25, post.z), 0.045, steel); bar(S, V3(post.x, lampP.y + 0.25, post.z), lampP.clone().add(V3(0, 0.25, 0)), 0.03, steel);
  box(S, lampP.clone().add(V3(0, 0.12, 0)), [0.34, 0.14, 0.26], steel);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffc070' })); glass.position.copy(lampP); glass.userData.subject = 0; S.add(glass);
  const sod = new THREE.SpotLight('#ff9a3c', 260, 12, 0.95, 0.55, 2.0); sod.position.copy(lampP).add(V3(0, -0.05, 0)); sod.target.position.copy(lampP).setY(0); sod.castShadow = true; sod.shadow.mapSize.set(2048, 2048); sod.shadow.bias = -0.0004; sod.shadow.normalBias = 0.01; sod.shadow.camera.near = 0.2; S.add(sod, sod.target);
  const lamp2P = RL(6.5).add(V3(0, 2.4, 0)).addScaledVector(n, 0.3); const sod2 = new THREE.SpotLight('#ff9a3c', 220, 12, 0.9, 0.55, 2.0); sod2.position.copy(lamp2P); sod2.target.position.copy(lamp2P).setY(0); S.add(sod2, sod2.target);
  { const g2 = glass.clone(); g2.position.copy(lamp2P); S.add(g2); box(S, lamp2P.clone().add(V3(0, 0.12, 0)), [0.34, 0.14, 0.26], steel); const p2 = RL(7.6); bar(S, V3(p2.x, 0, p2.z), V3(p2.x, lamp2P.y + 0.25, p2.z), 0.045, steel); bar(S, V3(p2.x, lamp2P.y + 0.25, p2.z), lamp2P.clone().add(V3(0, 0.25, 0)), 0.03, steel); }
  const glow = new THREE.DirectionalLight('#ff8a40', 1.3); glow.position.copy(n.clone().multiplyScalar(20)).add(V3(0, 3, 0)); S.add(glow);    // the plant's glow beyond the rail: the rim
  const flareL = new THREE.DirectionalLight(flareColor, 0); flareL.position.copy(n.clone().multiplyScalar(20)).addScaledVector(u, 9).add(V3(0, 6, 0)); S.add(flareL);   // c2: the flare, a key from the world side
  S.add(new THREE.HemisphereLight('#1a2238', '#0a0604', 0.18));
  S.traverse(o => { if (o.isMesh && o.userData.therm == null && !heroes.some(h => { let f = false; h.group.traverse(q => { if (q === o) f = true; }); return f; })) o.userData.therm = 8; });
  glass.userData.therm = 70;
  if (new URLSearchParams(location.search).get('hide')) for (const k of new URLSearchParams(location.search).get('hide').split(',')) { const m = k === 'hair' ? h0.hairMesh : k === 'body' ? h0.body : h0.cloth[k]; if (m) m.visible = false; }
  const hp = h0.joint('head');
  if (close) { const Q = new URLSearchParams(location.search), cv = (Q.get('pcam') || '-0.3,-1.65,0.1,0.2,0.42,-0.12,32').split(',').map(Number);
    st.lookAt(hp.clone().addScaledVector(n, cv[0]).addScaledVector(u, cv[1]).add(V3(0, cv[2], 0)), hp.clone().addScaledVector(n, cv[3]).addScaledVector(u, cv[4]).add(V3(0, cv[5], 0)), cv[6]); }
  else { const Q = new URLSearchParams(location.search), cv = (Q.get('cam') || '-4.5,-1.0,1.75,6,0.3,1.2,42').split(',').map(Number);
    st.lookAt(RL(cv[0]).addScaledVector(n, cv[1]).setY(cv[2]), RL(cv[3]).addScaledVector(n, cv[4]).setY(cv[5]), cv[6]); }
  const PL = PLo || { s: 1.12, dy: close ? -40 : -150 }, horizonY = (PLo?.horizon ?? 1181) * PL.s + PL.dy;
  const kit = { heroes, img, horizonY, flare: 0, flareLight: flareL, frame: t => {
    flareL.intensity = kit.flare * flareK;
    const c = Object.assign(document.createElement('canvas'), { width: st.W, height: st.H }), g = c.getContext('2d');
    if (thermal) { plate(g, img, PL); const th = st.thermal({}); g.imageSmoothingEnabled = true; g.drawImage(th, 0, 0, st.W, st.H);
      // breath: a warm puff in front of each face on the exhale, fading into the cold air
      heroes.forEach((h, i) => { const hp2 = h.joint('head').add(V3(0, -0.06, 0)), fw = V3(Math.sin(h.group.rotation.y), 0, Math.cos(h.group.rotation.y)), m = hp2.clone().addScaledVector(fw, 0.2), p = st.project(m), k = st.pxPerM(m) * 0.14;
        const ph = (t * 0.25 + i * 0.37) % 1, a = Math.sin(Math.PI * clamp(ph / 0.6)) * 0.5; if (a <= 0.01) return;
        const rg = g.createRadialGradient(p[0], p[1], 1, p[0], p[1], k * (0.6 + ph)); const [r1, g1, b1] = thermalLUT(0.6); rg.addColorStop(0, `rgba(${r1},${g1},${b1},${a})`); rg.addColorStop(1, `rgba(${r1},${g1},${b1},0)`); g.fillStyle = rg; g.fillRect(p[0] - k * 2, p[1] - k * 2, k * 4, k * 4); });
      return { color: c, aux: null, info: { kit: 'plant', thermal: true } };
    }
    plate(g, img, PL); if (imgF && kit.flare > 0) { g.save(); g.globalAlpha = Math.min(1, kit.flare); plate(g, imgF, PL); g.restore(); }
    g.drawImage(st.renderLit(), 0, 0);
    const gb = st.gbuf(), aux = st.aux(gb, { horizonY });
    const top = st.project(h0.joint('head').add(V3(0, 0.2, 0)))[1], foot = st.project(h0.group.position)[1];
    return { color: c, aux, info: { kit: 'plant', faces: heroes.map(h => h.faceTier(st.camera, st.H)), hero_frac: +((foot - top) / st.H).toFixed(2) } };
  } };
  return kit;
};

// ---------------------------------------------------------------- 2. the lineman: a bucket at 12 m at night
// Profile against the lit stratus deck (the WORLDS night-plains plate). The bucket's work light keys him from below;
// an amber strobe on the boom tip rims him at 2 Hz. The shape is the gauntlets, the sleeves and the hard hat's peak.
KITS.lineman = async (st, {} = {}) => {
  const S = st.scene, img = await loadImg(PLATES + 'shot2.jpg'), Q = new URLSearchParams(location.search);
  const h = st.hero({ variant: 'plains', height: 1.8, kind: 'coat', shirt: '#34405a', trousers: '#2a2a2c', hat: 'hard', hatColor: '#e8e4dc', beard: 0, stubble: 0.45, skin: '#b07a58', hair: '#2a1c12', seed: 61, dirt: 0.3, gloves: 'gauntlet', gloveColor: '#141212' });
  const BY = 12;                       // bucket floor height
  st.stand(h, { x: 0, y: BY, z: 0, turn: Math.PI / 2, t: 'bind', nod: -0.22, chest: -0.06 });   // facing +x: profile to a camera at +z, looking up at the line
  h.gesture('R', 'LINE_HI', { fist: false }); h.gesture('L', 'LINE_LO', { fist: false }); h.update();
  const wireD = V3(0.45, 0, -1).normalize();       // the conductors recede past his hand (never across his face)
  const gR = st.gripAt(h, 'R', wireD, 0.013);
  h.update(); const PL = h.palm('L'); const stickD = V3(0.55, 1, -0.1).normalize(); const gL = st.gripAt(h, 'L', stickD, 0.016);
  const cu = mat('#9a9ea4', 0.3, 0.9), fib = mat('#e6dcc0', 0.45), ins = mat('#7a6a5a', 0.4), pole = mat('#3a2a1c', 0.9), boom = mat('#e8e2c8', 0.5), stickM = mat('#d8b820', 0.4);
  const sag = x => 0.004 * x * x;
  [[0, 0], [-0.55, -1.2], [-0.55, 1.2]].forEach(([dy, dz], k) => { let prev = null;
    for (let x = -30; x <= 30; x += 1.5) { const p = gR.p.clone().addScaledVector(wireD, x).add(V3(0, sag(x) + dy, 0)).add(V3(0, 0, dz)); if (prev) bar(S, prev, p, 0.011, cu); prev = p; } });
  // the hot stick in his left hand, rising to the line
  const sb = gL.p.clone().addScaledVector(stickD, -0.5), stp = gL.p.clone().addScaledVector(stickD, 1.35); bar(S, sb, stp, 0.018, stickM);
  // the pole top and crossarm beyond him, insulators under the conductors
  const pp = gR.p.clone().addScaledVector(wireD, 2.6).add(V3(0, 0, -1.9)); bar(S, V3(pp.x, 0, pp.z), V3(pp.x, pp.y + 1.4, pp.z), 0.15, pole);
  const ca = pp.clone().add(V3(0, -0.72, 0)); bar(S, ca.clone().add(V3(0, 0, -1.6)), ca.clone().add(V3(0, 0, 1.6)), 0.055, pole);
  // the bucket: fibreglass, its rim at his hip, a dark rim band, the boom from below
  const bP = V3(h.group.position.x + 0.05, BY + 0.5, h.group.position.z);
  for (const [dx, dz, sx, sz] of [[0.3, 0, 0.03, 0.62], [-0.3, 0, 0.03, 0.62], [0, 0.3, 0.62, 0.03], [0, -0.3, 0.62, 0.03]]) {     // an open fibreglass bucket: four walls and a dark lip
    box(S, bP.clone().add(V3(dx, 0, dz)), [sx, 1.0, sz], fib, 0.2); box(S, bP.clone().add(V3(dx, 0.5, dz)), [sx + 0.03, 0.05, sz + 0.03], mat('#1e1c1a', 0.8), 0.2); }
  box(S, bP.clone().add(V3(0, -0.2, 0.312)), [0.64, 0.05, 0.01], mat('#b01810', 0.6), 0.2);          // the red reflective band
  bar(S, bP.clone().add(V3(-0.3, -0.45, 0)), bP.clone().add(V3(-4.5, -9, 3.5)), 0.17, boom);
  const work = new THREE.SpotLight('#fff2dc', 4, 5, 0.8, 0.6, 1.6); work.position.copy(bP.clone().add(V3(0.45, 0.5, 0.25))); work.target.position.copy(h.joint('head')); work.castShadow = true; S.add(work, work.target);
  const strobe = new THREE.PointLight('#ffa020', 0, 10, 1.6); strobe.position.copy(bP.clone().add(V3(-0.8, 1.2, -0.7))); S.add(strobe);
  const flood = new THREE.SpotLight('#ffd8a8', 30, 14, 0.5, 0.7, 1.4); flood.position.copy(bP).add(V3(-2.5, -5, 4)); flood.target.position.copy(bP); S.add(flood, flood.target);   // the truck's boom flood from below
  const deck = new THREE.DirectionalLight('#ffb070', 1.1); deck.position.set(-2, 3, -10); S.add(deck);       // the lit cloud deck behind: the rim
  S.add(new THREE.HemisphereLight('#2a2838', '#05060a', 0.2));
  const hp = h.joint('head'), cv = (Q.get('cam') || '-1.2,1.1,7.5,0.3,-0.75,22').split(',').map(Number);
  st.lookAt(hp.clone().add(V3(cv[0], cv[1], cv[2])), hp.clone().add(V3(cv[3], cv[4], 0)), cv[5]);
  const PLc = { s: 1.35, dy: -30 };
  return { heroes: [h], img, horizonY: 795 * PLc.s + PLc.dy, frame: t => {
    strobe.intensity = (Math.floor(t * 4) % 2 === 0 ? 1 : 0.15) * 22;        // 2 Hz amber strobe
    const c = Object.assign(document.createElement('canvas'), { width: st.W, height: st.H }), g = c.getContext('2d');
    plate(g, img, PLc);
    g.drawImage(st.renderLit(), 0, 0);
    const gb = st.gbuf(), aux = st.aux(gb, { horizonY: 795 * PLc.s + PLc.dy });
    return { color: c, aux, info: { kit: 'lineman', gestures: h.gestures(st.camera, st.W, st.H).map(q => ({ side: q.side, interior: q.interior, elev: q.elev, flags: q.flags })), face: h.faceTier(st.camera, st.H), strobe: strobe.intensity > 5, grip_gap_px: +Math.max(...Object.values(gR.g).map(v => Math.max(0, v.gap) * st.pxPerM(gR.p))).toFixed(1) } };
  } };
};

// ---------------------------------------------------------------- 3. the farmer at the pivot (Deineka: a lone figure against a huge plane)
KITS.farmer = async (st, {} = {}) => {
  const S = st.scene, img = await loadImg(PLATES + 'shot1.jpg');
  const h = st.hero({ variant: 'heavy', height: 1.8, kind: 'work', shirt: '#6e5a3a', trousers: '#2c3e5e', trouserKind: 2, hat: 'cap', hatColor: '#6a1414', beard: 0.2, skin: '#a06a48', seed: 71, dirt: 0.5 });
  st.stand(h, { x: 0, z: 0, turn: Math.PI / 2, t: 0.45, nod: -0.05 });
  h.gesture('R', 'SPAN', { fist: false }); h.relaxHand('L');
  const steel = mat('#8a8a88', 0.4, 0.8), rub = mat('#1a1a1a', 0.9);
  h.update(); const g0 = st.gripAt(h, 'R', V3(0, 0, 1), 0.02);
  // the pivot: the pipe span at 3.6 m, a tower A-frame beside him with its wheels, truss rods under the span, drops
  const sp = g0.p.clone(); const top = 3.6;
  const a = V3(sp.x + 0.35, top, -30), b = V3(sp.x + 0.35, top, 30);
  bar(S, a, b, 0.085, steel);
  for (let z = -30; z < 30; z += 3) { bar(S, V3(sp.x + 0.35, top, z), V3(sp.x + 0.35, top - 1.1 * Math.sin(Math.PI * ((z + 30) % 12) / 12) - 0.2, z + 1.5), 0.012, steel); bar(S, V3(sp.x + 0.35, top, z + 1.5), V3(sp.x + 0.35, 0.9, z + 1.5), 0.008, rub); }
  for (const s of [-1, 1]) { bar(S, V3(sp.x + 0.35, top, 0), V3(sp.x + 0.35 + s * 1.8, 0.6, 0.4), 0.05, steel); const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 24), rub); wh.rotation.z = Math.PI / 2; wh.position.set(sp.x + 0.35 + s * 1.9, 0.55, 0.4); S.add(wh); }
  bar(S, V3(sp.x + 0.35, top, 0), g0.p, 0.03, steel);        // a riser pipe down to where his hand is (he holds the tower's pipe)
  const sun = new THREE.DirectionalLight('#ffb070', 3); sun.position.set(-6, 1.2, -30); S.add(sun);
  S.add(new THREE.HemisphereLight('#6a4a70', '#1a1008', 0.5));
  const gnd = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat('#3a2a1a', 1)); gnd.rotation.x = -Math.PI / 2; gnd.userData.subject = 0; S.add(gnd);
  st.lookAt(V3(9, 0.6, 26), V3(0.4, 2.4, 0), 34);
  return { heroes: [h], img, horizonY: 1500, frame: t => {
    const c = Object.assign(document.createElement('canvas'), { width: st.W, height: st.H }), g = c.getContext('2d');
    { const gr = g.createLinearGradient(0, 0, 0, st.H * 0.78); gr.addColorStop(0, '#2a1830'); gr.addColorStop(0.45, '#8a3a3a'); gr.addColorStop(0.8, '#e27a3a'); gr.addColorStop(1, '#f4b060'); g.fillStyle = gr; g.fillRect(0, 0, st.W, st.H * 0.8);   // one huge flat dusk (Deineka): no cloud clutter
      g.globalAlpha = 0.5; g.drawImage(img, 0, 330, 1080, 60, 0, st.H * 0.74, st.W, 36); g.globalAlpha = 1; }                // a sliver of the plate's far town on the horizon
    const gr = g.createLinearGradient(0, st.H * 0.74, 0, st.H); gr.addColorStop(0, 'rgba(60,30,20,0)'); gr.addColorStop(0.2, '#2a1a10'); gr.addColorStop(1, '#0e0806'); g.fillStyle = gr; g.fillRect(0, st.H * 0.74, st.W, st.H * 0.26);
    g.drawImage(st.renderLit(), 0, 0);
    const gb = st.gbuf(), aux = st.aux(gb, { horizonY: 1480 });
    return { color: c, aux, info: { kit: 'farmer', figure_frac: +(h.faceTier(st.camera, st.H).px * 7.5 / st.H).toFixed(3) } };
  } };
};

// ---------------------------------------------------------------- 4. the driver's hands (no face): ten and two, the gantry passing over
KITS.driver = async (st, { f = 30 } = {}) => {
  const S = st.scene, img = await loadImg(PLATES + `M1_gantry_pass_f${f}.jpg`);
  const h = st.hero({ variant: 'forge', height: 1.8, kind: 'coat', shirt: '#3a3026', trousers: '#2a2a2c', hat: 'none', beard: 0.2, skin: '#8a5a3c', seed: 81, dirt: 0.4, gloves: true, gloveColor: '#6a5a44' });
  st.stand(h, { x: 0, z: 0, turn: Math.PI, t: 0.35 });          // facing -z (the road); the camera behind his right shoulder
  h.gesture('L', 'WHEEL10', { fist: false }); h.gesture('R', 'WHEEL10', { fist: false }); h.update();
  const pL = h.palm('L').palm, pR = h.palm('R').palm, cen = pL.clone().add(pR).multiplyScalar(0.5).add(V3(0, -0.1, -0.06)), rad = pL.distanceTo(pR) / 2 + 0.02;
  const rimM = mat('#141414', 0.5), dash = mat('#050506', 0.95);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(Math.max(0.19, rad), 0.017, 12, 64), rimM); wheel.position.copy(cen); wheel.lookAt(cen.clone().add(V3(0, 0.35, 1))); wheel.userData.subject = 0.2; S.add(wheel);
  for (const s of ['L', 'R']) { const P = h.palm(s).palm; const tang = P.clone().sub(cen).cross(V3(0, 0.35, 1).normalize()).normalize(); st.gripAt(h, s, tang, 0.017); }
  box(S, cen.clone().add(V3(0, -0.28, -0.45)), [1.8, 0.35, 0.6], dash);                    // dash
  bar(S, cen.clone().add(V3(-0.85, -0.2, -0.6)), cen.clone().add(V3(-0.55, 0.9, -1.1)), 0.05, dash);   // A-pillars
  bar(S, cen.clone().add(V3(0.85, -0.2, -0.6)), cen.clone().add(V3(0.55, 0.9, -1.1)), 0.05, dash);
  const sweep = new THREE.DirectionalLight('#d8f0e0', 0); sweep.position.set(0, 3, -2); S.add(sweep);
  const amb = new THREE.DirectionalLight('#ffb070', 0.6); amb.position.set(0, 1, -6); S.add(amb);
  S.add(new THREE.HemisphereLight('#3a3040', '#05060a', 0.2));
  const sh = h.joint('upperarm01.R');
  { const Q = new URLSearchParams(location.search), dv = (Q.get('dcam') || '0.32,0.3,0.25,0,-0.05,-0.6,52').split(',').map(Number); st.lookAt(sh.clone().add(V3(dv[0], dv[1], dv[2])), cen.clone().add(V3(dv[3], dv[4], dv[5])), dv[6]); }
  h.body.visible = true;
  return { heroes: [h], img, horizonY: 900, frame: t => {
    // the gantry's legend light sweeps down the hands (lands at t = 0.5 s)
    const u = clamp((t % 1.2) / 1.0); sweep.intensity = 2.2 * Math.exp(-Math.pow((u - 0.5) / 0.12, 2)); sweep.position.set(0, 3 - 4 * u, -2 + 2 * u);
    const c = Object.assign(document.createElement('canvas'), { width: st.W, height: st.H }), g = c.getContext('2d');
    plate(g, img, { s: 1.0, dy: -120 });
    g.drawImage(st.renderLit(), 0, 0);
    const gb = st.gbuf(), aux = st.aux(gb, { horizonY: 780 });
    return { color: c, aux, info: { kit: 'driver' } };
  } };
};

// a side-view line-up of standing frames (to choose upright stances; the lab's posetest subject)
KITS.posetest = async (st) => {
  const Q = new URLSearchParams(location.search), list = (Q.get('frames') || '56_02@0.35,56_02@3,17_08@1,02_01@1.2,20_06@1,12_01@1').split(',');
  const hs = [];
  for (let i = 0; i < list.length; i++) { const [tk, t0] = list[i].split('@'), t = tk === 'bind' ? 'bind' : +t0; const h = st.hero({ variant: ['forge', 'heavy', 'plains'][i % 3], kind: ['work', 'coat', 'flannel'][i % 3], hat: 'hard', seed: 90 + i });
    if (tk !== 'bind') await st.useTake(h, tk); st.stand(h, { x: (i - (list.length - 1) / 2) * 0.75, z: 0, turn: Math.PI / 2, t }); hs.push(h); }
  st.scene.add(new THREE.HemisphereLight('#ffffff', '#555555', 1.2)); const d = new THREE.DirectionalLight('#fff', 1.5); d.position.set(2, 3, 5); st.scene.add(d);
  st.lookAt(V3(0, 1.0, 13), V3(0, 1.0, 0), 30);
  return { heroes: hs, frame: t => { const c = Object.assign(document.createElement('canvas'), { width: st.W, height: st.H }), g = c.getContext('2d'); g.fillStyle = '#9a9488'; g.fillRect(0, 0, st.W, st.H); g.drawImage(st.renderLit(), 0, 0); return { color: c, aux: null, info: { list } }; } };
};

// ---------------------------------------------------------------- 5. hero backs: rank 0 of a ranked crowd (ranks.js), rendered in 3D
// Two or three men from behind at hero scale, cropped by the frame (Klutsis: a hero element over the mass, never a
// middle scale), rim-lit by a sun whose 2D position matches the crowd's sky. o.strike = { onset } raises the centre
// man's fist ON the hit: 3 frames cocked (anticipation), the strike landing on the onset frame with a smear, a 1-frame
// overshoot, then a settle that pumps on twos (gesture.js PUMP: bent elbow, forearm vertical, fist beside the head).
Object.assign(GESTURES, { COCK: { target: [0.2, 1.3, 0.08], pole: [0.4, -1, -0.3], prop: true } });
KITS.backs = async (st, { sun2d = [540, 760], cast = null, cam = null, strike = null, fps = 30 } = {}) => {
  const S = st.scene;
  const C = cast || [
    { variant: 'heavy', height: 1.8, kind: 'coat', shirt: '#3a3026', trousers: '#2a2a2c', hat: 'hard', hatColor: '#d8d2c4', beard: 0, stubble: 0.6, seed: 91, x: -0.62, z: 0.2, turn: Math.PI + 0.2, arm: null },
    { variant: 'forge', height: 1.84, kind: 'work', shirt: '#28323e', trousers: '#2c3e5e', hat: 'cap', hatColor: '#2a2a2a', beard: 0, stubble: 0.7, seed: 92, x: 0.12, z: -0.35, turn: Math.PI - 0.1, arm: 'R' },
    { variant: 'plains', height: 1.78, kind: 'leather', shirt: '#3a2a20', trousers: '#2c3444', hat: 'knit', hatColor: '#5a1010', beard: 0.2, seed: 93, x: 0.88, z: 0.05, turn: Math.PI - 0.35, arm: null },
  ];
  const hs = C.map(o => st.hero(o));
  const pose = (t) => hs.forEach((h, i) => { const o = C[i]; st.stand(h, { x: o.x, z: o.z, turn: o.turn, t: 'bind', nod: -0.05, head: o.head || 0 });
    const sd = o.arm, other = sd === 'R' ? 'L' : 'R';
    if (!sd) { for (const s2 of ['L', 'R']) { h.gesture(s2, 'SIDE', { fist: false }); h.relaxHand(s2); } return; }
    h.gesture(other, 'SIDE', { fist: false }); h.relaxHand(other);
    if (!strike) { h.gesture(sd, 'PUMP', { p: 0.9, fistScale: 1.18 }); return; }
    const k = Math.round((t - strike.onset) * fps);
    if (k < -3) { h.gesture(sd, 'SIDE', { fist: false }); h.relaxHand(sd); }
    else if (k < 0) h.gesture(sd, 'COCK', { fist: true });                                   // anticipation: cocked at the shoulder
    else { const p = k === 0 ? 0.55 : k === 1 ? 1 : k < 10 ? 0.92 : (Math.floor((k - 10) / 8) % 2 ? 0.55 : 0.95); h.gesture(sd, 'PUMP', { p, fistScale: k === 1 ? 1.28 : 1.18 }); } });
  pose(0);
  S.add(new THREE.HemisphereLight('#3a2a30', '#120806', 0.3));
  if (cam === 'fist') { const h = hs.find((q, i) => C[i].arm) || hs[0], sd = C[hs.indexOf(h)].arm || 'R'; h.update(); const f = h.palm(sd).palm;
    const Q = new URLSearchParams(location.search), fv = (Q.get('fcam') || '0.5,-0.45,0.5,-0.1,0.18,0,44').split(',').map(Number);
    st.lookAt(f.clone().add(V3(fv[0], fv[1], fv[2])), f.clone().add(V3(fv[3], fv[4], fv[5])), fv[6]); }
  else { const cv = cam || [0.15, 1.52, 3.1, 0.05, 1.62, -6, 40]; st.lookAt(V3(cv[0], cv[1], cv[2]), V3(cv[3], cv[4], cv[5]), cv[6]); }
  // the sun: a far point along the ray through the 2D sun pixel
  const ray = new THREE.Vector3((sun2d[0] / st.W) * 2 - 1, -(sun2d[1] / st.H) * 2 + 1, 0.5).unproject(st.camera).sub(st.camera.position).normalize();
  // the rim sun sits a little above and to the side of the disc as drawn: a sun dead behind a figure gives no crescent at all
  const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3().crossVectors(ray, up).normalize();
  const sunW = st.camera.position.clone().addScaledVector(ray, 500).addScaledVector(up, 260).addScaledVector(side, (sun2d[0] < st.W / 2 ? 1 : -1) * 220);
  let prev = null;
  return { heroes: hs, draw: (t, { rim = '#ffb46a', rim2 = '#b0401c', body = '#0b0706' } = {}) => {
    pose(t);
    const c = Object.assign(document.createElement('canvas'), { width: st.W, height: st.H }), g = c.getContext('2d');
    st.renderRim(sunW, { rim, rim2, body, bump: 0.5, wrapK: 0.12, bounce: 0.0, rimW: 0.4 });
    const k = strike ? Math.round((t - strike.onset) * fps) : 99;
    if (k === 0 && prev) { g.globalAlpha = 0.45; g.drawImage(prev, 0, 0); g.globalAlpha = 1; }   // the smear: last frame's cocked arm under the strike
    g.drawImage(st.canvas, 0, 0);
    prev = Object.assign(document.createElement('canvas'), { width: st.W, height: st.H }); prev.getContext('2d').drawImage(st.canvas, 0, 0);
    return c;
  }, gestures: () => hs.flatMap(h => h.gestures(st.camera, st.W, st.H)) };
};
