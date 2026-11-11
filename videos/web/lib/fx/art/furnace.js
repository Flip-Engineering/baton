// ART kit / FURNACE (cycle 2): the teeming shot rebuilt so the WORK IS THE LIGHT, exposed like 1938 Technicolor.
// foundry.js (c1) stays as it was for anything that already uses it; this is the new path.
//
//   import { Stage } from '../lib/fx/folk_worlds.js';  import { furnaceShot, furnaceCrowd } from '../lib/fx/art/furnace.js';
//   const st = new Stage(); await st.init();
//   const s = await furnaceShot(st, { cam: 'lip' | 'tapper' | 'hook' | 'row', flowAt: t => 1, events: {...} });
//   const canvas = s.frame(t);           // exposed through exposure.js (technicolor38, or ortho36 with mono: 1)
//   const c = await furnaceCrowd(st, { ... }); c.frame(t);
//
// What changed against foundry.js, and the reference for each (review/studio_art_c2/before/ref):
//  - FALL: the lip sits 0.9-1.2 m over the mould (mh2_pour_33-45, steel_1120_05-12): a short, fat column, not a hairline.
//  - LIGHT: the stream is scene-referred emission (molten.js hdr, Wien per channel) and it is the key: 6 point lights
//    along the fall + the splash light (the only shadow caster) + the open ladle. The studio/sky fill is 0.06.
//  - FUME: lit by single scatter of the stream samples (inverse square), so it is the largest bright area near the pour.
//  - CRUST: plates stretched along the flow with ropes across it (no Voronoi honeycomb).
//  - NO LIP FLAME. MOULD GAS instead: pale flames lick up round the sprue for 1-3 s after the metal enters (mh2_pour_38-47).
//  - SPLASH: a crown of beads thrown from the mould mouth (>= 40 px tall at 1080) that cool orange -> red.
//  - SPARKS: sim2 sparks at HDR gain (heads clip white, tails orange; their own speed x shutter trails; floor beads).
//  - TAPPER: posed and dressed from steel_1250_09-21 and mh3_forge: flat cap, round glasses, neckerchief, leather apron,
//    gauntlets; leaning back from the heat, bar low in both hands, head turned off the metal.
import * as THREE from 'three';
import { buildLadle, buildBail, buildHook, buildMoulds, buildTruss } from './ladle.js';
import { PourStream, MoltenPool, Fume, noiseTexture, WIEN_GLSL, wienRGB } from './molten.js';
import { Sparks } from '../sim2/sparks.js';
import { FilmExposure } from './exposure.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
// the colour smoke scatters from the stream: the Wien law at ~1550 K (orange, where the film's lit fume sits), not the core white
const SCAT = (() => { const w = wienRGB(1560, 1820, 1); const m = Math.max(...w); return new THREE.Color(w[0] / m, w[1] / m, w[2] / m); })();
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// ---------------------------------------------------------------- mould gas: flames off the sand round the sprue
export class MouldGas {
  constructor(scene, { pos = [0, 0, 0], radius = 0.3, n = 7, height = 0.5, gain = 3.2, seed = 4 } = {}) {
    const R = mulberry(seed); this.cards = []; this.on = 0;
    this.uni = { uT: { value: 0 }, uN: { value: noiseTexture() }, uOn: { value: 0 }, uGain: { value: gain } };
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + R() * 0.5, h = height * (0.6 + 0.8 * R()), w = h * (0.45 + 0.3 * R());
      const g = new THREE.PlaneGeometry(w, h); g.translate(0, h / 2, 0);
      const m = new THREE.ShaderMaterial({ uniforms: { ...this.uni, uS: { value: R() * 10 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */`uniform float uT, uOn, uGain, uS; uniform sampler2D uN; varying vec2 vUv;
          void main(){ float y = vUv.y; vec2 p = vec2(vUv.x * 0.6 + uS, y * 0.5 - uT * 1.7);
            float n = texture2D(uN, p).r * 0.65 + texture2D(uN, p * 2.9 + vec2(uS, -uT * 1.3)).g * 0.55;
            float bend = (n - 0.55) * 0.9 * y;                                           // tongues lick sideways as they rise
            float x = abs((vUv.x - 0.5) * 2.0 + bend);
            float wdt = pow(max(0.0, 1.0 - y), 0.8) * (0.55 + 0.5 * n);                  // widest at the root, a point at the tip
            float shape = smoothstep(wdt, wdt * 0.35, x);
            float cut = smoothstep(0.42, 0.62, n + 0.45 * (1.0 - y) - 0.25 * y);            // the tip breaks into separate tongues
            float a = shape * cut * smoothstep(0.0, 0.1, y) * uOn;
            vec3 c = mix(vec3(1.0, 0.62, 0.22), vec3(1.0, 0.86, 0.55), smoothstep(0.5, 0.0, y)) * uGain * (0.5 + 0.7 * n);
            gl_FragColor = vec4(c * a, a); }` });
      const mesh = new THREE.Mesh(g, m); mesh.position.set(pos[0] + Math.cos(a) * radius, pos[1], pos[2] + Math.sin(a) * radius);
      mesh.userData.gbuffer = false; mesh.renderOrder = 6; scene.add(mesh); this.cards.push(mesh);
    }
  }
  update(t, camera, on) { this.uni.uT.value = t; this.uni.uOn.value = on; for (const c of this.cards) { c.quaternion.copy(camera.quaternion); c.visible = on > 0.01; } }
}

// ---------------------------------------------------------------- the splash crown: beads thrown from the mouth
export class SplashCrown {
  constructor(scene, { pos = [0, 0, 0], n = 70, r = 0.16, v = 2.6, gain = 12, seed = 9, period = 0.55 } = {}) {
    const R = mulberry(seed); this.d = []; this.pos = V3(...pos); this.gain = gain; this.period = period;
    for (let i = 0; i < n; i++) { const a = R() * Math.PI * 2, up = 0.55 + 0.4 * R(); this.d.push({ a, ph: R(), sp: v * (0.5 + 0.7 * R()), up, r0: r * (0.8 + 0.4 * R()), sz: 0.008 + 0.02 * R() * R(), T0: 1650 + 200 * R() }); }
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), n);
    this.mesh.frustumCulled = false; this.mesh.userData.gbuffer = false; scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = V3(1, 1, 1); this._p = V3(0, 0, 0); this._c = new THREE.Color(); this._w = [0, 0, 0];
  }
  update(t, k = 1) {
    this.d.forEach((d, i) => {
      const life = this.period * (0.7 + 0.6 * d.ph), a = ((t / life + d.ph) % 1 + 1) % 1 * life;
      const hs = Math.cos(d.a), hz = Math.sin(d.a), vh = d.sp * Math.sqrt(1 - d.up * d.up), vy = d.sp * d.up;
      this._p.set(this.pos.x + hs * (d.r0 + vh * a), this.pos.y + vy * a - 4.9 * a * a, this.pos.z + hz * (d.r0 + vh * a));
      const s = this._p.y < this.pos.y - 0.05 || k <= 0.01 ? 0 : d.sz * Math.min(1, k * 1.3);
      this._s.set(s, s * (1 + 2.2 * Math.abs(vy - 9.8 * a) / d.sp), s);
      this._m.compose(this._p, this._q, this._s); this.mesh.setMatrixAt(i, this._m);
      wienRGB(d.T0 - 520 * a / life, 1820, this.gain, this._w); this._c.setRGB(...this._w); this.mesh.setColorAt(i, this._c);
    });
    this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- dress a HUMAN hero from the film (mh3_forge, steel_1250)
// glasses (round steel frames), a neckerchief, a leather apron. Props follow the posed skeleton (call after posing).
export function dressWorker(scene, h, { glasses = true, kerchief = '#7a2a1c', apron = '#3a2a1e', seed = 1 } = {}) {
  const grp = new THREE.Group(); scene.add(grp); h.update();
  const steel = new THREE.MeshStandardMaterial({ color: '#8a8580', metalness: 0.9, roughness: 0.35 });
  const lens = new THREE.MeshPhysicalMaterial({ color: '#223', metalness: 0, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.35, clearcoat: 1 });
  const head = h.bone('head'); head.updateMatrixWorld(true);
  const hq = new THREE.Quaternion(); head.getWorldQuaternion(hq);
  if (glasses) {
    const eL = h.joint('eye.L'), eR = h.joint('eye.R'), mid = eL.clone().add(eR).multiplyScalar(0.5), across = eR.clone().sub(eL), sep = across.length();
    // the face's forward: perpendicular to the eye line, away from the skull centre
    const hc = h.joint('head'), fwd = mid.clone().sub(hc); fwd.addScaledVector(across.clone().normalize(), -fwd.dot(across.clone().normalize())); fwd.y *= 0.3; fwd.normalize();
    const rim = new THREE.TorusGeometry(sep * 0.36, 0.0022, 6, 20);
    for (const e of [eL, eR]) { const m = new THREE.Mesh(rim, steel), l = new THREE.Mesh(new THREE.CircleGeometry(sep * 0.35, 18), lens);
      const p = e.clone().addScaledVector(fwd, 0.018); m.position.copy(p); l.position.copy(p); m.lookAt(p.clone().add(fwd)); l.lookAt(p.clone().add(fwd)); grp.add(m, l); }
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, sep * 0.3, 5), steel); br.position.copy(mid.clone().addScaledVector(fwd, 0.02)); br.quaternion.setFromUnitVectors(V3(0, 1, 0), across.clone().normalize()); grp.add(br);
    for (const [e, s] of [[eL, -1], [eR, 1]]) { const a = e.clone().addScaledVector(fwd, 0.018).addScaledVector(across.clone().normalize(), s * sep * 0.36), b = a.clone().addScaledVector(fwd, -0.09);
      const tm = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, a.distanceTo(b), 4), steel); tm.position.copy(a).add(b).multiplyScalar(0.5); tm.quaternion.setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize()); grp.add(tm); }
  }
  if (kerchief) {
    const n2 = h.joint('neck01'), n3 = h.joint('neck03'), c = n2.clone().lerp(n3, 0.25), ax = n3.clone().sub(n2).normalize();
    const cloth = new THREE.MeshStandardMaterial({ color: kerchief, roughness: 0.9 });
    const k = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.017, 8, 20), cloth); k.position.copy(c); k.quaternion.setFromUnitVectors(V3(0, 0, 1), ax); k.scale.set(1.05, 0.9, 1); grp.add(k);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.09, 4), cloth); const fw = new THREE.Vector3(0, 0, 1).applyQuaternion(h.group.quaternion);
    knot.position.copy(c).addScaledVector(fw, 0.065).add(V3(0, -0.05, 0)); knot.rotation.set(Math.PI, h.group.rotation.y + Math.PI / 4, 0); grp.add(knot);
  }
  if (apron) {
    const ch = h.joint('spine01'), hip = h.joint('spine05'), kL = h.joint('lowerleg01.L'), kR = h.joint('lowerleg01.R');
    const fw = new THREE.Vector3(0, 0, 1).applyQuaternion(h.group.quaternion), top = ch.clone().addScaledVector(fw, 0.13), bot = kL.clone().add(kR).multiplyScalar(0.5).addScaledVector(fw, 0.16).add(V3(0, -0.12, 0));
    const len = top.distanceTo(bot), g = new THREE.PlaneGeometry(0.44, len, 6, 12), P = g.attributes.position;
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i); P.setZ(i, -Math.pow(Math.abs(x) / 0.22, 2) * 0.07 + 0.01 * Math.sin(y * 20 + x * 7)); }   // wraps the body, stiff leather ripples
    g.computeVertexNormals();
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c2 = cv.getContext('2d'); c2.fillStyle = apron; c2.fillRect(0, 0, 256, 256); const R = mulberry(seed);
    for (let i = 0; i < 700; i++) { c2.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '120,90,60'},${0.05 + 0.12 * R()})`; c2.fillRect(R() * 256, R() * 256, 1 + R() * 6, 1 + R() * 3); }
    for (let i = 0; i < 18; i++) { c2.strokeStyle = `rgba(20,12,8,${0.2 + 0.3 * R()})`; c2.lineWidth = 1 + R() * 2; c2.beginPath(); const x = R() * 256, y = R() * 256; c2.moveTo(x, y); c2.lineTo(x + (R() - 0.5) * 60, y + R() * 30); c2.stroke(); }   // scorches and creases
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const ap = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.0, side: THREE.DoubleSide }));
    ap.position.copy(top).add(bot).multiplyScalar(0.5); const up = top.clone().sub(bot).normalize(), z = fw.clone().addScaledVector(up, -fw.dot(up)).normalize(), x = new THREE.Vector3().crossVectors(up, z);
    ap.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z)); ap.castShadow = true; grp.add(ap);
  }
  grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return grp;
}

// lean a posed hero back from the heat: torso tipped away about the lateral axis, the head turned off the metal
// stance (c2, default 0 = c1 behaviour): the tapper's braced split stance from steel_1250_09-21: front (L) thigh
// forward and knee bent, back (R) leg straight and back, the pelvis dropped so both feet stay on the floor
export function leanFromHeat(h, { lean = 0.2, head = 0.5, nod = 0.1, knee = 0.25, stance = 0 } = {}) {
  const turn = h.group.rotation.y, lat = V3(1, 0, 0).applyAxisAngle(V3(0, 1, 0), turn);
  if (stance) { h.rotateWorld('upperleg01.L', lat, stance * 1.1); h.rotateWorld('lowerleg01.L', lat, -stance * 1.5); h.rotateWorld('foot.L', lat, stance * 0.4);
    h.rotateWorld('upperleg01.R', lat, -stance * 0.9); h.rotateWorld('foot.R', lat, stance * 0.6); h.group.position.y -= 0.16 * stance; h.update(); }
  h.rotateWorld('spine04', lat, -lean * 0.6); h.rotateWorld('spine02', lat, -lean * 0.4);
  if (knee) { h.rotateWorld('upperleg01.L', lat, knee); h.rotateWorld('lowerleg01.L', lat, -knee * 1.6); }
  if (head) h.rotateWorld('neck01', V3(0, 1, 0), head);
  if (nod) h.rotateWorld('head', lat, nod);
  h.update(); return h;
}

// ---------------------------------------------------------------- the teeming shot, exposed
const CAMS = {
  lip: { pos: [0.6, 2.3, 7.2], look: [-0.75, 1.05, 0], fov: 36 },            // lip and mould together, fume above
  hook: { pos: [-0.9, 1.4, 9.5], look: [-0.9, 2.3, 0], fov: 40 },             // the ladle cut by the top edge, crew beside
  tapper: { pos: [0.05, 0.85, 5.0], look: [0.85, 0.5, 0.7], fov: 40 },       // steel_1250_12: 3/4 front, keyed from the metal side
  row: { pos: [6.2, 0.55, 1.9], look: [0.3, 0.2, 0], fov: 38 },               // low, down the row of filled moulds to the pour
  wide: { pos: [-3, 2.6, 15], look: [-0.8, 2.6, 0], fov: 44 },
  close: { pos: [0.3, 1.25, 4.3], look: [-0.45, 0.95, 0], fov: 34 },          // stream, splash and lit fume fill the frame (mh2_pour_41)
};
export async function furnaceShot(st, o = {}) {
  const { cam = 'lip', tilt = 0.55, tapper = true, mono = 0, sparks = true, t0 = -10, seed = 3, camOverride = null, lipH = 1.05, hdr = 38,
    flowAt = null, gasAt = null, crew = 1, exposure = 1.0, fx: fxO = {}, bursts = [] } = o;
  const S = st.scene, R = st.r;
  S.background = new THREE.Color('#000000'); S.fog = new THREE.FogExp2(mono ? '#0e0c0a' : '#0c0806', 0.035);
  const truss = buildTruss({ span: 24, bays: 10, bay: 5, height: 15 }); truss.position.set(0, 0, 8); S.add(truss);
  const floorC = document.createElement('canvas'); floorC.width = floorC.height = 512; { const g = floorC.getContext('2d'), Rn = mulberry(seed + 40); g.fillStyle = '#2a2420'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4000; i++) { const v = Rn(); g.fillStyle = v < 0.5 ? `rgba(10,8,6,${0.2 * Rn()})` : `rgba(90,80,70,${0.15 * Rn()})`; g.fillRect(Rn() * 512, Rn() * 512, 1 + Rn() * 5, 1 + Rn() * 5); } }
  const floorT = new THREE.CanvasTexture(floorC); floorT.wrapS = floorT.wrapT = THREE.RepeatWrapping; floorT.repeat.set(16, 16); floorT.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ map: floorT, roughness: 0.85, metalness: 0.15 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshStandardMaterial({ color: '#1a1614', roughness: 1 })); wall.position.set(0, 12, -18); S.add(wall);
  // ladle: placed so its lip is lipH over the mould top
  const holder = new THREE.Group(); holder.position.set(-1.6, 6.0, 0); holder.rotation.y = Math.PI / 2; S.add(holder);
  const L = buildLadle({ seed }); holder.add(L.group); L.tilt(tilt);
  const bail = buildBail(L); holder.add(bail); const hook = buildHook(); hook.position.set(0, 2.6 + 0.35, 0); holder.add(hook);
  holder.updateMatrixWorld(true);
  const mouldTop = 2.05; { const lip0 = L.lipWorld(); holder.position.y += mouldTop + lipH - lip0.y; holder.updateMatrixWorld(true); }
  const pool = new MoltenPool(S, { geometry: L.surf.geometry, cool: 0.62, scale: 3.2, speed: 0.12, hdr: hdr * 0.5, aniso: 2.6, fold: 0.8, flowDir: [0, 1] });
  L.body.remove(L.surf); pool.mesh.position.copy(L.surf.position); pool.mesh.rotation.copy(L.surf.rotation); S.remove(pool.mesh); L.body.add(pool.mesh);
  const trough = new MoltenPool(S, { geometry: L.trough.geometry, cool: 0.1, T0: 1800, scale: 2.5, speed: 0.9, flowDir: [0, 1], hdr: hdr * 0.7, aniso: 3.5, fold: 0.4 });
  L.body.remove(L.trough); S.remove(trough.mesh); trough.mesh.position.copy(L.trough.position); trough.mesh.rotation.copy(L.trough.rotation); trough.mesh.material.side = THREE.DoubleSide; L.body.add(trough.mesh);
  holder.updateMatrixWorld(true);
  const lip = L.lipWorld(), dir = L.lipDir();
  const v0 = dir.clone().multiplyScalar(0.9); v0.y = Math.min(v0.y, 0.05);
  const pour = new PourStream(S, { lip: lip.toArray(), v0: v0.toArray(), r0: 0.085, lipW: 0.3, floorY: mouldTop, t0, seed, breakAt: 0.9, hdr, flowAt, nLen: 90 });
  const bottom = pour.bottom();
  const moulds = buildMoulds({ n: 4, spacing: 1.55 }); moulds.group.position.set(bottom.x, 0.05, bottom.z); S.add(moulds.group);
  // filled moulds down the row: crusting tops (hot cracks), cooling left to right
  const filled = [1, 2, 3].map(i => new MoltenPool(S, { center: [bottom.x + i * 1.55, mouldTop + 0.01, bottom.z], radius: 0.27, cool: 0.55 + 0.12 * i, T0: 1650 - 70 * i, scale: 4, speed: 0.02, hdr: hdr * 0.35, aniso: 1.6, fold: 0.5 }));
  const splash = new MoltenPool(S, { center: [bottom.x, mouldTop + 0.02, bottom.z], radius: 0.21, cool: -0.9, T0: 1820, scale: 5, speed: 0.6, hdr: hdr * 0.8, aniso: 1.4 });
  const crown = new SplashCrown(S, { pos: [bottom.x, mouldTop + 0.03, bottom.z], gain: 14, seed: seed + 5 });
  const gas = new MouldGas(S, { pos: [bottom.x, mouldTop, bottom.z], radius: 0.3, gain: 3.2, seed: seed + 6 });
  const gasOld = new MouldGas(S, { pos: [bottom.x + 1.55, mouldTop, bottom.z], radius: 0.3, gain: 2.0, height: 0.35, seed: seed + 7 });
  // fume: lit by the stream (single scatter)
  const fume = new Fume(S, { base: [bottom.x + 0.1, mouldTop, bottom.z - 0.5], height: 4.5, width: 2.0, n: 7, alpha: 0.5, color: '#2a221c', lit: 7, rise: 0.5 });
  const fume2 = new Fume(S, { base: [lip.x - 0.2, lip.y - 0.2, lip.z - 0.5], height: 4, width: 1.8, n: 4, alpha: 0.4, seed: 9, color: '#2a221c', lit: 5, rise: 0.35 });
  let sp = null;
  if (sparks) {
    sp = new Sparks(S, { max: 6000, ground: 0.06, viewH: st.H, widthPx: 2.2, gain: 7 });
    const P = bottom.toArray(); P[1] = mouldTop + 0.05;
    sp.stream({ t0: t0 + 0.4, t1: t0 + 60, rate: 300, pos: P, dir: [0.2, 1, 0.15], spread: 0.9, kind: 'pour', seed: seed + 1, speedK: 0.75 });
    sp.stream({ t0: t0 + 0.4, t1: t0 + 60, rate: 420, pos: P, dir: [0, 1, 0], spread: 1.3, kind: 'grind', seed: seed + 2, speedK: 0.3, lifeK: 0.9 });
    sp.embers({ t0: t0, t1: t0 + 60, rate: 18, box: [[bottom.x - 2, 2.2, bottom.z - 1.5], [bottom.x + 2, 7, bottom.z + 1.5]], seed: seed + 4, rise: 0.8 });
    // eruptions on the song's accents: a burst out of the mould mouth toward the camera side (bursts: [t...])
    bursts.forEach((bt, i) => { sp.burst({ t0: bt, pos: P, dir: [0.35, 1, 0.55], spread: 1.1, n: 1400, kind: 'pour', seed: seed + 20 + i, speedK: 1.3 }); sp.burst({ t0: bt, pos: P, dir: [0, 1, 0.2], spread: 0.6, n: 700, kind: 'grind', seed: seed + 40 + i, speedK: 1.6 }); });
  }
  // LIGHT: the stream (6 samples), the splash (shadows), the open ladle; a faint cold fill so the black has a floor
  const streamL = Array.from({ length: 6 }, () => { const l = new THREE.PointLight('#ffb060', 0, 22, 2); S.add(l); return l; });
  const splashL = new THREE.SpotLight('#ffb060', 0, 24, 1.3, 0.9, 2); splashL.castShadow = true; splashL.shadow.mapSize.set(1024, 1024); splashL.shadow.bias = -0.002;
  splashL.position.copy(bottom).add(V3(-0.15, 0.35, 0.25)); splashL.target.position.copy(bottom).add(V3(2.5, -1.5, 3)); S.add(splashL, splashL.target);
  const ladleL = new THREE.PointLight('#ffa040', 0, 10, 2); ladleL.position.copy(lip).add(V3(-1.2, 0.8, 0)); S.add(ladleL);
  const fill = new THREE.HemisphereLight(mono ? '#8a8680' : '#50607a', '#080504', 0.06); S.add(fill);
  const clere = new THREE.DirectionalLight(mono ? '#c0bab0' : '#7a90b0', 0.12); clere.position.set(-6, 20, -10); S.add(clere);
  // the pouring platform along the moulds (the men work at the mould mouths, 0.5 m under their hands)
  const PY = 1.55, platC = document.createElement('canvas'); platC.width = platC.height = 256; { const g2 = platC.getContext('2d'), Rn = mulberry(seed + 41); g2.fillStyle = '#2c2622'; g2.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 16; i++) { g2.fillStyle = '#1a1512'; g2.fillRect(0, i * 16, 256, 1); } for (let i = 0; i < 900; i++) { g2.fillStyle = `rgba(${Rn() < 0.5 ? '8,6,5' : '110,90,70'},${0.12 * Rn()})`; g2.fillRect(Rn() * 256, Rn() * 256, 1 + Rn() * 4, 1 + Rn() * 2); } }
  const platT = new THREE.CanvasTexture(platC); platT.wrapS = platT.wrapT = THREE.RepeatWrapping; platT.repeat.set(6, 3); platT.colorSpace = THREE.SRGBColorSpace;
  const plat = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 5), new THREE.MeshStandardMaterial({ map: platT, color: '#241f1c', roughness: 0.92, metalness: 0.1 }));
  plat.position.set(bottom.x + 4.6, PY - 0.1, bottom.z + 2.6); plat.receiveShadow = plat.castShadow = true; if (tapper || crew) S.add(plat);
  // the tapper
  let hero = null, bar = null;
  if (tapper) {
    hero = st.hero({ variant: 'forge', height: 1.8, kind: 'work', shirt: '#b8ae9c', trousers: '#4a4640', hat: 'cap', hatColor: '#5a5650', beard: 0.1, stubble: 0.9, skin: '#b07a58', hair: '#1c140e', seed: 17, dirt: 0.6, gloves: 'gauntlet', gloveColor: '#3a2e24' });
    const hx = bottom.x + 1.3, hz = bottom.z + 0.9;
    st.stand(hero, { x: hx, y: PY, z: hz, turn: -Math.PI / 2 - 0.55, t: 'bind' });
    hero.gesture('R', 'LINE_LO', { fist: false }); hero.gesture('L', 'RAIL', { fist: false });
    leanFromHeat(hero, { lean: 0.34, head: -0.35, nod: 0.6, knee: 0.1, stance: 0.38 });
    const target = bottom.clone().add(V3(0.15, 0.05, 0.1));
    const gR = st.gripAt(hero, 'R', target.clone().sub(hero.palm('R').palm), 0.017);
    const barD = target.clone().sub(gR.p).normalize(); st.gripAt(hero, 'L', barD, 0.017);
    const a = gR.p.clone().addScaledVector(barD, -0.55), b = target;
    const d = b.clone().sub(a); bar = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, d.length(), 8), new THREE.MeshStandardMaterial({ color: '#3a302a', roughness: 0.45, metalness: 0.85 }));
    bar.position.copy(a).add(b).multiplyScalar(0.5); bar.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); bar.castShadow = true; S.add(bar);
    dressWorker(S, hero, { kerchief: '#6a2418', seed: 3 });
  }
  // the crew behind (shallow rank, lit on the metal side): different hats, heights, stances
  const crewH = [];
  if (crew) {
    const specs = [
      { x: 2.9, z: 2.9, turn: -2.3, hat: 'hard', hatColor: '#6a6258', shirt: '#4a4a52', h: 1.76, seed: 23, beard: 0.6 },
      { x: 4.3, z: 1.6, turn: -1.9, hat: 'knit', hatColor: '#3a2a22', shirt: '#6a5a48', h: 1.84, seed: 31, beard: 0 },
      { x: 1.9, z: 3.9, turn: -2.8, hat: 'none', shirt: '#2e2a26', h: 1.7, seed: 37, beard: 0.3 },
    ];
    for (const c of specs) { const w = st.hero({ variant: 'forge', height: c.h, kind: 'work', shirt: c.shirt, trousers: '#2e2a26', hat: c.hat, hatColor: c.hatColor || '#333', beard: c.beard, stubble: 0.8, skin: '#a8704e', seed: c.seed, dirt: 0.5, gloves: 'gauntlet', gloveColor: '#2a2018' });
      st.stand(w, { x: bottom.x + c.x, y: PY, z: bottom.z + c.z, turn: c.turn, t: 0.2 + (c.seed % 7) * 0.13, nod: 0.1 }); crewH.push(w); }
  }
  const C = camOverride || CAMS[cam];
  st.lookAt(bottom.clone().add(V3(...C.pos)), bottom.clone().add(V3(...C.look)), C.fov);
  const fx = new FilmExposure(R, { W: st.W, H: st.H, curve: mono ? 'ortho36' : 'technicolor38', exposure, weave: mono ? 1.5 : 0, flicker: mono ? 0.03 : 0, ...fxO });
  const out = document.createElement('canvas'); out.width = st.W; out.height = st.H; const g = out.getContext('2d');
  const shot = { st, fx, pour, pool, fume, sparks: sp, L, holder, bottom, lip, hero, crew: crewH, gas, crown,
    exposureAt: null,
    frame(t) {
      pour.update(t); pool.update(t); splash.update(t); trough.update(t); filled.forEach(f => f.update(t));
      const fl = pour.fl ?? 1, Ls = pour.light(t), smp = pour.samples(t, 6);
      smp.forEach((s, i) => { streamL[i].position.copy(s.pos).add(V3(0.2, 0, 0.25)); streamL[i].color.copy(s.color); streamL[i].intensity = 55 * s.power; });
      const flick = 0.85 + 0.25 * Math.sin(t * 23) * Math.sin(t * 7.7);
      splashL.color.copy(Ls.color); splashL.intensity = 70 * Ls.power * flick; ladleL.intensity = 30 * (0.4 + 0.6 * Math.min(1, fl));
      splash.uni.uHDR.value = hdr * 0.8 * Math.min(1.2, 0.25 + fl);
      fume.update(t, st.camera, { color: SCAT, power: Ls.power }, smp); fume2.update(t, st.camera, { color: SCAT, power: 0.8 }, smp);
      const gOn = gasAt ? gasAt(t) : clamp((t - t0 - 0.6) * 2);
      gas.update(t, st.camera, gOn); gasOld.update(t, st.camera, 0.6);
      crown.update(t, Math.min(1.3, fl));
      if (sp) sp.update(t, st.camera, R);
      const c = fx.render(S, st.camera, t, { exposure: shot.exposureAt ? shot.exposureAt(t) : exposure });
      g.drawImage(c, 0, 0); return out;
    } };
  return shot;
}

// ---------------------------------------------------------------- the crowd, keyed by a pour behind the camera
// Three ranks of HUMAN heroes (not cut-outs): the front rank lit hard on the metal side, the second rank half in the
// light, the third a rim against the lit fume of a second pour deep in the shop. No two neighbours share hat, height or
// stance; a few fists up (bent elbow, gesture.js ROTFRONT through SAFETY).
export async function furnaceCrowd(st, { seed = 5, exposure = 1.0, t0 = -10, fists = [1, 4], camOverride = null } = {}) {
  const S = st.scene, R = st.r, Rn = mulberry(seed);
  S.background = new THREE.Color('#000'); S.fog = new THREE.FogExp2('#0c0806', 0.05);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: '#241e1a', roughness: 0.9 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
  const truss = buildTruss({ span: 24, bays: 8, bay: 5, height: 14 }); truss.position.set(0, 0, -6); S.add(truss);
  const hats = ['cap', 'hard', 'knit', 'none', 'cap', 'hard', 'knit', 'cap', 'none'], shirts = ['#b8ae9c', '#3e4450', '#6a5a48', '#2e2a26', '#8a7a64', '#4a3a30', '#5a5a5a', '#9a8a70', '#34302c'];
  const layout = [   // [x, z, height, rank]
    [-0.75, 0.0, 1.78, 0], [0.55, 0.25, 1.84, 0],
    [-1.55, -1.3, 1.72, 1], [-0.1, -1.5, 1.8, 1], [1.35, -1.2, 1.69, 1],
    [-2.3, -2.9, 1.82, 2], [-0.9, -3.1, 1.75, 2], [0.6, -3.0, 1.86, 2], [2.0, -2.8, 1.7, 2],
  ];
  const men = [];
  layout.forEach(([x, z, hgt, rank], i) => {
    const w = st.hero({ variant: i % 3 === 1 ? 'plains' : 'forge', height: hgt, kind: i % 2 ? 'coat' : 'work', shirt: shirts[i], trousers: '#2a2622', hat: hats[i], hatColor: ['#5a5650', '#7a7266', '#3a2a22', '#333', '#4a4640', '#6a6258', '#2a2a30', '#5a5046', '#333'][i],
      beard: Rn() < 0.4 ? 0.5 : 0, stubble: 0.5 + 0.5 * Rn(), skin: ['#b07a58', '#a8704e', '#8a5a40', '#c08a68', '#9a6448'][i % 5], hair: '#1c140e', seed: 50 + i * 7, dirt: 0.5, gloves: i % 3 ? 'gauntlet' : 'none', gloveColor: '#2a2018' });
    st.stand(w, { x, y: 0, z, turn: (Rn() - 0.5) * 0.7, t: 0.15 + Rn() * 1.2, nod: (Rn() - 0.3) * 0.12, head: (Rn() - 0.5) * 0.5 });
    if (fists.includes(i)) { w.gesture('R', 'ROTFRONT', { fist: true, fistScale: 1.1 }); w.update(); }
    if (i === 0) dressWorker(S, w, { kerchief: '#6a2418', apron: '#3a2a1e', seed: 5 });
    if (i === 3) dressWorker(S, w, { kerchief: '#2a3a5a', apron: null, glasses: true, seed: 6 });
    men.push({ w, rank });
  });
  // key: the pour behind camera-left (a warm area of point lights low and near), and a second pour deep behind them
  const keys = [[-3.2, 1.6, 5.0], [-2.6, 2.3, 4.2], [-3.8, 1.2, 3.6]].map(p => { const l = new THREE.PointLight('#ffb060', 0, 30, 2); l.position.set(...p); S.add(l); return l; });
  const keyS = new THREE.SpotLight('#ffb060', 0, 30, 0.9, 0.8, 2); keyS.position.set(-3.4, 1.8, 4.8); keyS.target.position.set(0, 1.4, -1.5); keyS.castShadow = true; keyS.shadow.mapSize.set(1024, 1024); S.add(keyS, keyS.target);
  const far = new PourStream(S, { lip: [1.2, 5.2, -14], v0: [0.6, 0.05, 0], r0: 0.12, lipW: 0.35, floorY: 1.6, t0, seed: seed + 3, hdr: 30, breakAt: 0.9, nLen: 50 });
  const farL = new THREE.PointLight('#ffb060', 0, 30, 1.6); farL.position.set(1.6, 2.6, -13); S.add(farL);
  const fumeF = new Fume(S, { base: [1.5, 1.6, -14.5], height: 9, width: 5, n: 8, alpha: 0.55, color: '#2a221c', lit: 9, rise: 0.4, seed: 21 });
  const sp = new Sparks(S, { max: 3000, ground: 0.02, viewH: st.H, widthPx: 2, gain: 6 });
  sp.stream({ t0: t0 + 0.4, t1: t0 + 60, rate: 260, pos: [1.6, 1.65, -14], dir: [0, 1, 0.2], spread: 1.2, kind: 'pour', seed: seed + 9, speedK: 0.8 });
  S.add(new THREE.HemisphereLight('#40506a', '#060403', 0.05));
  const C = camOverride || { pos: [0.15, 1.5, 3.3], look: [-0.1, 1.5, -1.5], fov: 44 };
  st.lookAt(V3(...C.pos), V3(...C.look), C.fov);
  const fx = new FilmExposure(R, { W: st.W, H: st.H, curve: 'technicolor38', exposure });
  const out = document.createElement('canvas'); out.width = st.W; out.height = st.H; const g = out.getContext('2d');
  const shot = { st, fx, men, far, keyAt: null, exposureAt: null,
    frame(t) {
      far.update(t);
      const k = (shot.keyAt ? shot.keyAt(t) : 1) * (0.88 + 0.2 * Math.sin(t * 19) * Math.sin(t * 6.1));
      keys.forEach(l => l.intensity = 120 * k); keyS.intensity = 480 * k;   // c2b: the front rank must carry the source (mean 0.18 -> brighter)
      const Lf = far.light(t); farL.color.copy(Lf.color); farL.intensity = 260 * Lf.power;
      fumeF.update(t, st.camera, { color: SCAT, power: Lf.power }, far.samples(t, 6).map(s => ({ ...s, power: s.power * 3 })));
      sp.update(t, st.camera, R);
      const c = fx.render(S, st.camera, t, { exposure: shot.exposureAt ? shot.exposureAt(t) : exposure }); g.drawImage(c, 0, 0); return out;
    } };
  return shot;
}
