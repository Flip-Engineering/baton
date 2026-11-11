// LAB / PEOPLE: old articulated person() (commonwealth3 v8) vs lib/fx/people.js, under the same dawn light.
//   ?who=new|old  &shot=close|crowd|walk|trades  &n=400 (crowd size)  &sc=1 (render scale vs 1080x1920)
// window.renderFrame(t) returns { ms, cpu } (wall ms for the frame incl. GPU sync, ms of People.update).
import * as THREE from 'three';
import { People, TRADES } from '../lib/fx/people.js';

const Q = new URLSearchParams(location.search);
const WHO = Q.get('who') || 'new', SHOT = Q.get('shot') || 'close', N = +(Q.get('n') || 400), SC = +(Q.get('sc') || 1);
const RW = Math.round(1080 * SC), RH = Math.round(1920 * SC);
const canvas = document.getElementById('out'); canvas.width = RW; canvas.height = RH;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(RW, RH, false);
renderer.shadowMap.enabled = !Q.get('noshadow'); renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e8a070'); scene.fog = new THREE.Fog('#e0a078', 60, 420);
const camera = new THREE.PerspectiveCamera(38, RW / RH, 0.1, 2000);
// sky: vertical gradient dome (dawn over the plain)
{ const g = new THREE.SphereGeometry(900, 32, 16), m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vp; void main(){ float h = normalize(vp).y; vec3 a = vec3(1.0,0.62,0.36), b = vec3(0.34,0.3,0.44); vec3 c = mix(a, b, smoothstep(0.0, 0.45, h)); c += vec3(1.0,0.5,0.2) * 0.6 * exp(-pow(atan(vp.x, -vp.z) - 0.9, 2.0) * 6.0) * exp(-max(h,0.0) * 14.0); gl_FragColor = vec4(c * 1.1, 1.0); }' });
  scene.add(new THREE.Mesh(g, m)); }
const hemi = new THREE.HemisphereLight('#9fa0c0', '#5a3a22', 0.9); scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffb070', 3.6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun); scene.add(sun.target);
const fill = new THREE.DirectionalLight('#7080b0', 0.5); fill.position.set(-5, 3, 6); scene.add(fill);
// ground: dirt road over wheat-coloured field
{ const g = new THREE.PlaneGeometry(2000, 2000, 1, 1); g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshStandardMaterial({ color: '#8a6a44', roughness: 0.95 });
  m.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 gW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\ngW = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 gW; float gh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }')
      .replace('#include <color_fragment>', '#include <color_fragment>\n float road = smoothstep(9.0, 7.0, abs(gW.x)); vec3 wheat = vec3(0.62,0.44,0.2) * (0.8 + 0.3 * gh(floor(gW.xz * 3.0))); diffuseColor.rgb = mix(wheat, vec3(0.36,0.27,0.19) * (0.85 + 0.2 * gh(floor(gW.xz * 8.0))), road);'); };
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; scene.add(mesh); }
// the hall at the end of the road (context for the crowd shot)
{ const m = new THREE.MeshStandardMaterial({ color: '#b8a894', roughness: 0.9 }); const hall = new THREE.Mesh(new THREE.BoxGeometry(24, 9, 16), m); hall.position.set(0, 4.5, -170); hall.castShadow = hall.receiveShadow = true; scene.add(hall);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 14, 7, 4, 1), new THREE.MeshStandardMaterial({ color: '#5a3a2a', roughness: 0.8 })); roof.rotation.y = Math.PI / 4; roof.scale.set(1.3, 1, 0.85); roof.position.set(0, 12.5, -170); scene.add(roof);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(5, 5.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.6) })); door.position.set(0, 2.75, -161.9); scene.add(door); }

// ---------------------------------------------------------------- the OLD person() from commonwealth3.js (v8), verbatim but for scene
const PM = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
const SKIN = [PM(0x8a5a40), PM(0xc89070), PM(0x5a3a28), PM(0xb07858)];
function limb(r0, r1, L, mat) { const g = new THREE.CylinderGeometry(r1, r0, L, 8); g.translate(0, -L / 2, 0); const m = new THREE.Mesh(g, mat); m.castShadow = true; return m; }
function person(o) {
  const root = new THREE.Group(), s = o.h / 1.78;
  const skin = SKIN[o.skin % 4], coat = PM(o.coat), pants = PM(o.pants), boot = PM(0x2a1c14);
  const pelvis = new THREE.Group(); pelvis.position.y = 0.95 * s; root.add(pelvis);
  const hipM = new THREE.Mesh(new THREE.BoxGeometry(0.34 * s, 0.2 * s, 0.2 * s), pants); hipM.castShadow = true; pelvis.add(hipM);
  const torso = new THREE.Group(); torso.position.y = 0.08 * s; pelvis.add(torso);
  const chestG = new THREE.CylinderGeometry(0.21 * s * o.bulk, 0.17 * s * o.bulk, 0.56 * s, 10); chestG.translate(0, 0.3 * s, 0); chestG.scale(1, 1, 0.62);
  const chest = new THREE.Mesh(chestG, coat); chest.castShadow = true; torso.add(chest);
  if (o.vest) { const vg = new THREE.CylinderGeometry(0.215 * s * o.bulk, 0.175 * s * o.bulk, 0.4 * s, 10, 1, true); vg.translate(0, 0.33 * s, 0); vg.scale(1, 1, 0.64); torso.add(new THREE.Mesh(vg, new THREE.MeshStandardMaterial({ color: 0xff6a10, emissive: 0x401000, roughness: 0.6 }))); }
  const neck = limb(0.05 * s, 0.05 * s, 0.1 * s, skin); neck.position.y = 0.66 * s; neck.rotation.x = Math.PI; torso.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105 * s, 12, 10), skin); head.scale.set(0.9, 1.1, 1); head.position.y = 0.8 * s; head.castShadow = true; torso.add(head);
  if (o.hat === 'hard') { const hh = new THREE.Mesh(new THREE.SphereGeometry(0.13 * s, 12, 6, 0, 6.283, 0, 1.6), PM(o.hatC)); hh.position.y = 0.84 * s; const br = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.16 * s, 0.015 * s, 14), PM(o.hatC)); br.position.y = 0.84 * s; torso.add(hh, br); hh.castShadow = true; }
  else if (o.hat === 'cap') { const cc = new THREE.Mesh(new THREE.SphereGeometry(0.115 * s, 12, 6, 0, 6.283, 0, 1.5), PM(o.hatC)); cc.position.y = 0.83 * s; const bill = new THREE.Mesh(new THREE.BoxGeometry(0.16 * s, 0.015 * s, 0.12 * s), PM(o.hatC)); bill.position.set(0, 0.84 * s, 0.13 * s); torso.add(cc, bill); cc.castShadow = true; }
  else { const hair = new THREE.Mesh(new THREE.SphereGeometry(0.112 * s, 12, 8, 0, 6.283, 0, 1.9), PM(0x1a120c)); hair.position.set(0, 0.81 * s, -0.01 * s); torso.add(hair); }
  const arms = [], legs = [];
  for (const sd of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(sd * 0.22 * s * o.bulk, 0.55 * s, 0); torso.add(sh);
    const up = limb(0.06 * s * o.bulk, 0.05 * s, 0.3 * s, coat); sh.add(up);
    const el = new THREE.Group(); el.position.y = -0.3 * s; sh.add(el);
    const fo = limb(0.048 * s, 0.04 * s, 0.27 * s, coat); el.add(fo);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045 * s, 8, 6), skin); hand.position.y = -0.3 * s; el.add(hand);
    arms.push({ sh, el, sd });
    const hp = new THREE.Group(); hp.position.set(sd * 0.1 * s, -0.02 * s, 0); pelvis.add(hp);
    const th = limb(0.085 * s, 0.065 * s, 0.45 * s, pants); hp.add(th);
    const kn = new THREE.Group(); kn.position.y = -0.45 * s; hp.add(kn);
    const sn = limb(0.06 * s, 0.05 * s, 0.43 * s, pants); kn.add(sn);
    const bt = new THREE.Mesh(new THREE.BoxGeometry(0.11 * s, 0.1 * s, 0.26 * s), boot); bt.position.set(0, -0.45 * s, 0.05 * s); bt.castShadow = true; kn.add(bt);
    legs.push({ hp, kn, sd });
  }
  root.userData = { pelvis, torso, arms, legs, o, s };
  scene.add(root); return root;
}
function walk(p, ph, amt = 1) {
  const { pelvis, torso, arms, legs, s } = p.userData, c = Math.sin(ph);
  pelvis.position.y = 0.95 * s + Math.abs(Math.cos(ph)) * 0.035 * s * amt; pelvis.rotation.y = c * 0.1 * amt;
  torso.rotation.y = -c * 0.18 * amt; torso.rotation.x = 0.06;
  for (const L of legs) { const q = Math.sin(ph + (L.sd > 0 ? 0 : Math.PI)); L.hp.rotation.x = -q * 0.45 * amt; L.kn.rotation.x = Math.max(0, Math.sin(ph + (L.sd > 0 ? 0 : Math.PI) + 1.3)) * 0.8 * amt; }
  for (const A of arms) { const q = Math.sin(ph + (A.sd > 0 ? Math.PI : 0)); A.sh.rotation.x = -q * 0.4 * amt; A.sh.rotation.z = A.sd * 0.08; A.el.rotation.x = -0.25 - Math.max(0, q) * 0.35 * amt; }
}
const OLD_KINDS = [
  { h: 1.82, coat: 0x7a5a30, pants: 0x2a2a30, hat: 'hard', hatC: 0xe8e0d0, skin: 0, bulk: 1.12 },
  { h: 1.8, coat: 0x6a4a2a, pants: 0x2a3a5a, hat: 'cap', hatC: 0x8a1c1c, skin: 0, bulk: 1.1 },
  { h: 1.78, coat: 0x2a3446, pants: 0x1e2430, hat: 'cap', hatC: 0xd8d0c0, skin: 2, bulk: 1.05 },
  { h: 1.72, coat: 0x5a4632, pants: 0x2a3a5a, hat: 'none', hatC: 0, skin: 1, bulk: 1.0, vest: true },
  { h: 1.76, coat: 0x3a3a3a, pants: 0x3a3226, hat: 'hard', hatC: 0xd8a018, skin: 3, bulk: 1.05, vest: true },
];

// ---------------------------------------------------------------- the cast
const rnd = (() => { let s = 99; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const cast = [];   // { x, z, heading, act, ph0, speed, id|obj, trade }
if (SHOT === 'close' || SHOT === 'trades') {
  const L = SHOT === 'close'
    ? [{ trade: 'farm', x: -0.95, z: 0.1, hd: 0.35, act: 'stand' }, { trade: 'steel', x: 0.05, z: -0.4, hd: 0.05, act: 'fist' }, { trade: 'rail', x: 0.95, z: 0.2, hd: -0.35, act: 'stand' },
       { trade: 'overalls', x: -0.55, z: -1.6, hd: 0.25, act: 'walk' }, { trade: 'weld', x: 0.75, z: -1.7, hd: -0.2, act: 'stand' }]
    : TRADES.map((t, i) => ({ trade: t, x: (i - 2) * 0.9, z: 0, hd: 0, act: Q.get('act') || 'stand' }));
  L.forEach((c, i) => cast.push({ ...c, heading: c.hd, ph0: i * 1.7, speed: 0, seed: [3, 8, 21, 5, 14][i] }));
} else if (SHOT === 'walk') {
  TRADES.forEach((t, i) => cast.push({ trade: t, x: (i - 2) * 1.1, z: -i * 0.5, heading: 0, act: i === 2 ? 'march' : 'walk', ph0: i * 1.3, speed: 1.35, seed: 30 + i }));
} else {
  for (let i = 0; i < N; i++) {
    const z = -6 - Math.pow(rnd(), 0.8) * 150, x = (rnd() - 0.5) * (8 + (-z) * 0.12);
    const trade = TRADES[Math.floor(rnd() * 5)], r = rnd();
    cast.push({ trade, x, z, heading: (rnd() - 0.5) * 0.25, act: r < 0.45 ? 'walk' : r < 0.75 ? 'march' : 'fist', ph0: rnd() * 6.28, speed: 1.2 + rnd() * 0.3, seed: 100 + i });
  }
}

let folk = null;
if (WHO === 'new') {
  folk = new People(scene, { max: Math.max(64, cast.length), viewH: RH, shadows: Q.get('shadows') || 'proxy', ...(Q.get('lodpx') ? { lodPx: Q.get('lodpx').split(',').map(Number) } : {}) });
  if (Q.get('cheap')) for (const m of folk.meshes) { m.material = new THREE.MeshBasicMaterial({ color: 'red' }); }
  for (const c of cast) {
    const o = People.random(c.trade, c.seed);
    if (c.act === 'work') o.prop = true;
    c.id = folk.add(o);
  }
} else {
  const hatFor = { steel: 0, farm: 1, rail: 2, overalls: 3, weld: 4 };
  for (const c of cast) c.obj = person(OLD_KINDS[hatFor[c.trade]]);
}

const T0 = { close: [0, 1.4, 5.2, 0, 1.0, -0.6], trades: [0, 1.2, 5.6, 0, 0.95, 0], walk: [0.5, 1.5, 6.5, 0, 0.9, -1], crowd: [2, 3.2, 14, 0, 0.5, -60] }[SHOT];
const CAM = Q.get('cam') ? Q.get('cam').split(',').map(Number) : T0;
camera.position.set(CAM[0], CAM[1], CAM[2]); camera.lookAt(CAM[3], CAM[4], CAM[5]); if (CAM[6]) camera.fov = CAM[6];
if (SHOT === 'crowd' && !CAM[6]) camera.fov = 34; camera.updateProjectionMatrix();

function place(t) {
  for (const c of cast) {
    let x = c.x, z = c.z;
    const moving = c.act === 'walk' || c.act === 'march';
    if (moving && SHOT === 'crowd') z += t * c.speed;
    const ph = c.act === 'work' ? t * 0.8 + c.ph0 * 0.1 : c.ph0 + t * c.speed * 4.2;
    if (folk) folk.set(c.id, { x, y: 0, z, heading: c.heading, act: c.act, ph, t: t + c.ph0, speed: c.speed, pump: c.act === 'stand' ? null : Math.pow(Math.max(0, Math.sin(t * 4.4 + c.ph0)), 3) });
    else { c.obj.position.set(x, 0, z); c.obj.rotation.y = c.heading; walk(c.obj, ph, moving ? 1 : 0.12);
      if (c.act === 'fist' || c.act === 'march') { const A0 = c.obj.userData.arms[0]; A0.sh.rotation.x = -2.8; A0.el.rotation.x = -0.4; } }
  }
}
// sun placement per shot: low, warm, from front-right (camera side) so faces read; shadows fall back-left
const sunDir = new THREE.Vector3(-0.55, 0.32, -0.5).normalize();
function frameSun() {
  const c = SHOT === 'crowd' ? new THREE.Vector3(0, 0, -50) : new THREE.Vector3(0, 1, -0.5), ext = SHOT === 'crowd' ? 90 : 4;
  sun.target.position.copy(c); sun.position.copy(c).addScaledVector(new THREE.Vector3(0.55, 0.42, 0.6).normalize(), 200);
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 50, far: 400 }); sun.shadow.camera.updateProjectionMatrix();
}
frameSun();

const gl = renderer.getContext(), px = new Uint8Array(4);
if (Q.get('hide')) window.__hide = true;
window.labInfo = { who: WHO, shot: SHOT, n: cast.length, verts: folk ? folk.stats.verts : null };
window.renderFrame = async (t) => {
  const t0 = performance.now();
  place(t);
  let cpu = 0; if (folk) { const a = performance.now(); folk.update(camera); cpu = performance.now() - a; }
  if (Q.get('nodraw') && folk) for (const m of folk.meshes) m.visible = false;
  renderer.render(scene, camera);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return { ms: performance.now() - t0, cpu, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, drawn: folk ? folk.stats.drawn.slice() : null };
};
window.setCam = (c) => { camera.position.set(c[0], c[1], c[2]); camera.lookAt(c[3], c[4], c[5]); camera.fov = c[6] || 38; camera.updateProjectionMatrix(); };
window.setAct = (a) => { for (const c of cast) c.act = a; };
window.sceneReady = true;
