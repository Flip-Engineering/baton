// ART kit / BUCKET TRUCK: a lineman's insulated aerial device on a utility truck, and the lineman in it (hero.js).
// Replaces the beige primitive bucket HUMAN c3 flagged, for COMMON WEALTH (UP SHE GOES., ALL POWER.).
//
//   import { buildTruck, bucketShot } from '../lib/fx/art/bucket.js';
//   const T = buildTruck({ boom: [0.9, 1.1], turn: 0.4 });  scene.add(T.group);  T.bucketWorld() -> Vector3 (floor centre)
//   const shot = await bucketShot(st, { cam: 'storm' });   shot.frame(t)
//
// Anatomy (after Altec / Terex insulated aerial devices on a 33,000 lb class chassis): a conventional cab (hood, grille,
// bumper, mirrors, amber beacon bar), dual rear wheels, a steel utility body with side compartments (hinged doors,
// latches, a rub rail), outriggers down on pads, a turntable pedestal, a steel LOWER boom, an articulating knuckle, the
// fibreglass UPPER boom (the dielectric section: white gel coat with a black band and hazard chevrons at the tip), a
// platform with a leveling link, and a one-man fibreglass BUCKET (yellow gel coat, scuffed, a black liner lip, the
// control handle). Every surface carries its own canvas wear (scuffs, dust, road grime, decals-as-panels).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
const RB = (w, h, d, r = 0.06) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.1, h / 2.1, d / 2.1));

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function grime(base, { w = 512, h = 512, seed = 3, scuff = 1, streak = 1 } = {}) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d'), R = mulberry(seed);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 400 * streak; i++) { const x = R() * w, y = R() * h * 0.6; const gr = g.createLinearGradient(0, y, 0, y + 40 + R() * 160); gr.addColorStop(0, `rgba(60,48,36,${0.08 + 0.12 * R()})`); gr.addColorStop(1, 'rgba(60,48,36,0)'); g.fillStyle = gr; g.fillRect(x, y, 1 + R() * 3, 200); }
  for (let i = 0; i < 160 * scuff; i++) { g.strokeStyle = `rgba(${R() < 0.5 ? '30,26,22' : '240,236,226'},${0.12 + 0.25 * R()})`; g.lineWidth = 0.6 + R() * 1.6; const x = R() * w, y = R() * h, a = R() * 3;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * (6 + R() * 40), y + Math.sin(a) * (3 + R() * 10)); g.stroke(); }
  const grd = g.createLinearGradient(0, h, 0, h * 0.55); grd.addColorStop(0, 'rgba(50,40,30,0.55)'); grd.addColorStop(1, 'rgba(50,40,30,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
const std = (map, o = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0.1, ...o });

export function buildTruck({ turn = 0.35, boom = [0.95, 1.25], seed = 5 } = {}) {
  const g = new THREE.Group(), R = mulberry(seed), meshes = [];
  const add = (geo, mat, p, rot = null, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); if (rot) m.rotation.set(...rot); m.castShadow = m.receiveShadow = true; parent.add(m); meshes.push(m); return m; };
  const white = std(grime('#e6e2d8', { seed: seed + 1, streak: 0.3 }), { roughness: 0.45 }), yellow = std(grime('#d8b01c', { seed: seed + 2, streak: 0.3 }), { roughness: 0.4 });
  const steel = std(grime('#5a5c5e', { seed: seed + 3 }), { roughness: 0.5, metalness: 0.6 }), black = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.7 });
  const tire = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.95 }), rim = new THREE.MeshStandardMaterial({ color: '#b8b8b0', roughness: 0.35, metalness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: '#0c1014', roughness: 0.1, metalness: 0.4 }), amber = new THREE.MeshStandardMaterial({ color: '#ff9a20', emissive: '#ff8a10', emissiveIntensity: 0 });
  // chassis rails and cab (x forward)
  add(new THREE.BoxGeometry(7.6, 0.3, 0.9), black, [0.4, 0.9, 0]);
  const cab = new THREE.Group(); cab.position.set(2.9, 0, 0); g.add(cab);
  add(RB(1.7, 1.55, 2.3, 0.14), white, [0, 2.05, 0], null, cab);                   // cab box
  add(RB(1.5, 1.0, 2.2, 0.16), white, [1.45, 1.55, 0], null, cab);                 // hood
  add(new THREE.BoxGeometry(0.08, 0.8, 1.6), steel, [2.21, 1.5, 0], null, cab);                 // grille
  for (let i = 0; i < 7; i++) add(new THREE.BoxGeometry(0.1, 0.05, 1.55), black, [2.24, 1.2 + i * 0.1, 0], null, cab);
  add(new THREE.BoxGeometry(0.25, 0.3, 2.45), steel, [2.3, 0.95, 0], null, cab);                // bumper
  add(new THREE.BoxGeometry(0.06, 0.65, 2.05), glass, [0.87, 2.38, 0], [0, 0, 0.12], cab);      // windscreen
  for (const s of [-1, 1]) { add(new THREE.BoxGeometry(1.1, 0.6, 0.04), glass, [0.05, 2.4, s * 1.16], null, cab);      // side windows
    add(new THREE.BoxGeometry(0.04, 0.4, 0.22), black, [0.7, 2.4, s * 1.42], null, cab);                              // mirrors
    add(new THREE.CylinderGeometry(0.01, 0.01, 0.4, 5), steel, [0.7, 2.4, s * 1.27], [Math.PI / 2, 0, 0], cab);
    add(new THREE.BoxGeometry(0.12, 0.1, 0.3), new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#fff0c8', emissiveIntensity: 1.2 }), [2.24, 1.55, s * 0.9], null, cab); }   // headlamps
  const beacon = add(new THREE.BoxGeometry(0.25, 0.12, 1.4), amber, [0.1, 2.9, 0], null, cab);
  // wheels: steer + dual rears
  const wheel = (x, z, dual) => { for (const dz of dual ? [-0.16, 0.16] : [0]) { const w = add(new THREE.CylinderGeometry(0.52, 0.52, 0.3, 28), tire, [x, 0.52, z + dz * Math.sign(z)], [Math.PI / 2, 0, 0]);
      const r = add(new THREE.CylinderGeometry(0.3, 0.3, 0.32, 16), rim, [x, 0.52, z + dz * Math.sign(z)], [Math.PI / 2, 0, 0]); } };
  for (const s of [-1, 1]) { wheel(4.1, s * 1.05, false); wheel(-1.4, s * 1.0, true); wheel(-2.7, s * 1.0, true); }
  // utility body: compartments with doors
  const body = new THREE.Group(); body.position.set(-0.75, 0, 0); g.add(body);
  add(RB(4.8, 1.3, 2.45, 0.05), white, [0, 1.8, 0], null, body);
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const x = -1.8 + i * 1.2;
    add(RB(1.1, 1.1, 0.05, 0.02), white, [x, 1.82, s * 1.24], null, body);
    add(new THREE.BoxGeometry(0.16, 0.05, 0.05), steel, [x + 0.35, 1.9, s * 1.27], null, body); }
  add(new THREE.BoxGeometry(4.9, 0.1, 2.6), steel, [0, 1.12, 0], null, body);                          // rub rail
  // outriggers down
  for (const [x, s] of [[-3.0, 1], [-3.0, -1], [1.4, 1], [1.4, -1]]) { add(new THREE.BoxGeometry(0.2, 0.2, 1.1), steel, [x, 1.1, s * 1.6]); add(new THREE.BoxGeometry(0.16, 1.1, 0.16), steel, [x, 0.6, s * 2.1]); add(new THREE.BoxGeometry(0.6, 0.06, 0.6), steel, [x, 0.03, s * 2.1]); }
  // turntable, pedestal, booms
  const ped = add(new THREE.CylinderGeometry(0.55, 0.65, 0.7, 24), steel, [-2.1, 2.8, 0]);
  const tt = new THREE.Group(); tt.position.set(-2.1, 3.15, 0); tt.rotation.y = turn; g.add(tt);
  add(RB(1.0, 0.5, 0.8, 0.08), yellow, [0, 0.25, 0], null, tt);
  const lower = new THREE.Group(); lower.position.set(0.2, 0.45, 0); lower.rotation.z = boom[0]; tt.add(lower);
  const L1 = 5.2; add(RB(L1, 0.42, 0.36, 0.07), yellow, [L1 / 2, 0, 0], null, lower);
  add(new THREE.CylinderGeometry(0.09, 0.09, L1 * 0.55, 10), steel, [L1 * 0.35, -0.3, 0], [0, 0, Math.PI / 2], lower);     // lift cylinder
  const knuckle = new THREE.Group(); knuckle.position.set(L1, 0, 0); lower.add(knuckle);
  add(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 18), yellow, [0, 0, 0], [Math.PI / 2, 0, 0], knuckle);
  const upper = new THREE.Group(); upper.rotation.z = boom[1] - boom[0] - Math.PI * 0.0; knuckle.add(upper);
  const L2 = 5.6; add(RB(L2, 0.34, 0.3, 0.1), white, [L2 / 2, 0, 0], null, upper);
  add(new THREE.BoxGeometry(0.6, 0.36, 0.32), black, [L2 * 0.35, 0, 0], null, upper);                   // the dielectric black band
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.12, 0.36, 0.32), i % 2 ? black : yellow, [L2 - 0.9 + i * 0.14, 0, 0], null, upper);   // hazard chevrons (as bands)
  const tip = new THREE.Group(); tip.position.set(L2, 0, 0); upper.add(tip);
  // the bucket stays level: counter-rotate by the boom angles
  const lev = new THREE.Group(); lev.rotation.z = -(boom[1]); tip.add(lev);
  const bucket = new THREE.Group(); bucket.position.set(0.55, -0.55, 0); lev.add(bucket);
  add(RB(0.8, 1.05, 0.8, 0.09), std(grime('#e2c238', { seed: seed + 9, scuff: 2, streak: 0.25 }), { roughness: 0.35 }), [0, 0, 0], null, bucket);
  add(RB(0.86, 0.07, 0.86, 0.03), black, [0, 0.54, 0], null, bucket);                  // liner lip
  add(new THREE.BoxGeometry(0.84, 0.05, 0.84), new THREE.MeshStandardMaterial({ color: '#b01810', roughness: 0.5 }), [0, 0.2, 0], null, bucket);   // reflective band
  add(new THREE.BoxGeometry(0.1, 0.25, 0.06), black, [-0.3, 0.68, 0.3], null, bucket);             // control handle
  const work = new THREE.SpotLight('#fff0d8', 30, 12, 0.7, 0.6, 1.4); work.position.set(0.3, 0.8, 0.3); bucket.add(work); const wt = new THREE.Object3D(); wt.position.set(0.8, 3, 0); bucket.add(wt); work.target = wt;
  return { group: g, meshes, beacon, amber, bucket, work,
    bucketWorld(out = new THREE.Vector3()) { g.updateMatrixWorld(true); return out.set(0, 0.52, 0).applyMatrix4(bucket.matrixWorld); } };
}

// rain: streak cards on a few planes (shader, stateless in t)
function rain(scene, { n = 5, area = 14, speed = 22 } = {}) {
  const cards = [], uni = { uT: { value: 0 } };
  for (let i = 0; i < n; i++) {
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { ...uni, uS: { value: i * 3.7 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uT, uS; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){ vec2 p = vec2(vUv.x * 700.0, vUv.y * 9.0 + uT * ${speed.toFixed(1)} * 0.35 + uS);
          vec2 c = floor(p); float r = h(c + uS); float y = fract(p.y + r * 7.0);
          float a = step(0.93, r) * smoothstep(0.0, 0.05, y) * smoothstep(0.35, 0.05, y) * smoothstep(0.5, 0.2, abs(fract(p.x) - 0.5));
          gl_FragColor = vec4(vec3(0.75, 0.78, 0.85), a * 0.2); }` });
    m.uniforms.uT = uni.uT;
    const card = new THREE.Mesh(new THREE.PlaneGeometry(area * 2, area * 1.6), m); card.position.set(0, area * 0.6, -2 - i * 5); card.rotation.z = 0.08; card.userData.gbuffer = false; scene.add(card); cards.push(card);
  }
  return { update(t, cam) { uni.uT.value = t; for (const c of cards) c.quaternion.copy(cam.quaternion); } };
}

export async function bucketShot(st, o = {}) {
  const { cam = 'storm', seed = 5, lightning = [1.2, 3.1] } = o;
  const S = st.scene, Rr = st.r;
  S.background = new THREE.Color('#12121a'); S.fog = new THREE.FogExp2('#1a1a24', 0.022);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#1c1a18', roughness: 0.35, metalness: 0.2 })); ground.receiveShadow = true; S.add(ground);
  const T = buildTruck({ seed }); S.add(T.group);
  // the lineman, in the bucket, a gloved hand at the conductor
  T.group.updateMatrixWorld(true); const bp = T.bucketWorld();
  const h = st.hero({ variant: 'plains', height: 1.8, kind: 'coat', shirt: '#2c3a52', trousers: '#262628', hat: 'hard', hatColor: '#b0a68e', beard: 0.2, stubble: 0.6, skin: '#a87450', hair: '#2a1c12', seed: 61, dirt: 0.3, gloves: 'gauntlet', gloveColor: '#141212' });
  st.stand(h, { x: bp.x, y: bp.y - 0.95, z: bp.z, turn: -Math.PI / 2 + 0.5, t: 'bind', nod: -0.25, chest: -0.08 });
  h.gesture('R', 'LINE_HI', { fist: false }); h.gesture('L', 'LINE_LO', { fist: false }); h.update();
  const wireD = V3(0.3, 0, -1).normalize(); const gR = st.gripAt(h, 'R', wireD, 0.013);
  { const hp = h.joint('head'); T.work.target = new THREE.Object3D(); T.work.target.position.copy(hp); S.add(T.work.target); T.work.intensity = 4; T.work.angle = 0.9;
    const under = new THREE.PointLight('#ffd8a0', 2.5, 3, 1.5); under.position.copy(bp).add(V3(0.25, 0.7, 0.35)); S.add(under); }
  const cu = new THREE.MeshStandardMaterial({ color: '#8a8e92', roughness: 0.35, metalness: 0.9 }), wood = new THREE.MeshStandardMaterial({ color: '#3a2a1c', roughness: 0.9 });
  const bar = (a, b, r, m) => { const d = b.clone().sub(a), me = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), m); me.position.copy(a).add(b).multiplyScalar(0.5); me.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); me.castShadow = true; S.add(me); return me; };
  // three conductors with catenary sag running past the hand to a pole with a crossarm and pin insulators
  const sag = x => 0.006 * x * x;
  [[0, 0], [-0.1, -1.1], [-0.1, 1.1]].forEach(([dy, dz]) => { let prev = null; for (let x = -40; x <= 40; x += 2) { const p = gR.p.clone().addScaledVector(wireD, x).add(V3(0, sag(x) + dy, dz)); if (prev) bar(prev, p, 0.012, cu); prev = p; } });
  const pp = gR.p.clone().addScaledVector(wireD, 3.2).add(V3(-0.9, 0, 0)); bar(V3(pp.x, 0, pp.z), V3(pp.x, pp.y + 1.2, pp.z), 0.16, wood);
  const ca = pp.clone().add(V3(0, -0.35, 0)); bar(ca.clone().add(V3(0, 0, -1.5)), ca.clone().add(V3(0, 0, 1.5)), 0.06, wood);
  for (const dz of [-1.1, 0, 1.1]) { const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.25, 12), new THREE.MeshStandardMaterial({ color: '#6a8a5a', roughness: 0.2, metalness: 0.1 })); ins.position.copy(ca).add(V3(0, 0.18, dz)); S.add(ins); }
  const hot = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.6, 8), new THREE.MeshStandardMaterial({ color: '#d8b820', roughness: 0.4 })); hot.position.copy(gR.p).add(V3(0.2, -0.6, 0.3)); hot.rotation.z = 0.3; S.add(hot);
  // light: storm fill, the lit cloud deck behind (rim), the bucket work light, the beacon strobe, lightning
  S.add(new THREE.HemisphereLight('#3a3a52', '#0a0a0c', 0.35));
  const deck = new THREE.DirectionalLight('#9aa0c0', 0.5); deck.position.set(-6, 10, -20); S.add(deck);
  const flash = new THREE.DirectionalLight('#dfe6ff', 0); flash.position.set(8, 30, -30); S.add(flash);
  const strobe = new THREE.PointLight('#ffa020', 0, 14, 1.6); strobe.position.set(3.0, 3.2, 0); S.add(strobe);
  const flood = new THREE.SpotLight('#ffe0b0', 18, 26, 0.45, 0.6, 1.3); flood.position.set(-2.6, 3.6, 1.2); flood.target.position.copy(bp); S.add(flood, flood.target);
  const rn = rain(S, {});
  // the storm sky: a dark deck with a lit break low on the horizon (never a disc)
  const skyM = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uF: { value: 0 } },
    vertexShader: 'varying vec3 vp; void main(){ vp = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform float uF; varying vec3 vp; float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      void main(){ vec3 d = normalize(vp); float y = d.y; vec2 p = d.xz / max(y + 0.1, 0.05);
        float c = n(p * 1.3) * 0.6 + n(p * 3.1) * 0.3 + n(p * 7.0) * 0.1;
        vec3 col = mix(vec3(0.3, 0.28, 0.34), vec3(0.1, 0.1, 0.14), smoothstep(0.0, 0.5, y)) * (0.7 + 0.6 * c);
        col += vec3(0.55, 0.42, 0.3) * smoothstep(0.08, 0.0, y) * smoothstep(-0.05, 0.02, y) * 0.6;
        col += vec3(0.8, 0.85, 1.0) * uF * (0.4 + 0.8 * c) * smoothstep(-0.05, 0.4, y);
        gl_FragColor = vec4(col, 1.0); }` });
  S.add(new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyM));
  const CAMS = { storm: { pos: [9.5, 1.2, 12.5], look: [0.5, 7.5, 0], fov: 50 }, close: { pos: [bp.x + 3.4, bp.y + 1.0, bp.z + 4.4], look: [bp.x - 0.6, bp.y + 0.2, bp.z], fov: 42 } };
  const C = CAMS[cam] || CAMS.storm; st.lookAt(V3(...C.pos), V3(...C.look), C.fov);
  Rr.toneMapping = THREE.ACESFilmicToneMapping; Rr.toneMappingExposure = 1.6;
  const out = document.createElement('canvas'); out.width = st.W; out.height = st.H; const g = out.getContext('2d');
  return { st, T, hero: h, frame(t) {
    const on = Math.floor(t * 4) % 2 === 0; strobe.intensity = on ? 18 : 1; T.amber.emissiveIntensity = on ? 2.5 : 0.2;
    // lightning: a flash envelope (3 strokes in 0.25 s) at each time in `lightning`
    let F = 0; for (const lt of lightning) { const a = t - lt; if (a >= 0 && a < 0.3) F = Math.max(F, [1, 0.3, 0.9, 0.2, 0.6, 0.1, 0.3, 0.05, 0.1][Math.floor(a * 30)] || 0); }
    flash.intensity = 2.2 * F; skyM.uniforms.uF.value = 0.45 * F;
    rn.update(t, st.camera);
    g.drawImage(st.renderLit(), 0, 0); return out; } };
}
