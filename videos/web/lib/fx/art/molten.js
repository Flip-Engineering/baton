// ART kit / MOLTEN: poured metal that is matter, not a glowing tube. three.js, pure functions of t.
//
//   import { PourStream, MoltenPool, Fume, heatLight, noiseTexture } from '../lib/fx/art/molten.js';
//   const pour = new PourStream(scene, { lip, v0: [1.1, 0.2, 0], r0: 0.09, floorY: 0.9, lipW: 0.34 });
//   const pool = new MoltenPool(scene, { center, radius: 1.1, cool: 0.55 });     // crust plates over a crack network
//   const fume = new Fume(scene, { base, height: 7 });                             // lit by the pour from below
//   per frame: pour.update(t); pool.update(t); fume.update(t, camera, pour.light(t));
//
// What reference says a pour looks like (Charles Walker, "Steel: the diary of a furnace worker", 1922; foundry pour
// descriptions; the RealtimeVFX lava/blackbody threads; see research/capabilities/art.md):
//  - The stream leaves the lip as a SHEET the width of the spout and pulls into a rope as it falls: continuity
//    (area x speed = const) makes it NECK as gravity speeds it up; its surface ROPES (travelling varicose waves).
//  - The core is white-yellow (~1800 K); the silhouette carries a darker orange SKIN (grazing emission, slag) and
//    entrained slag shows as brighter flaring streaks travelling with the flow.
//  - Low in the fall the rope BREAKS UP into beads and droplets (Rayleigh-Plateau), and where it lands a CROWN of
//    splash and a shower of sparks leaves the mould, with brown iron-oxide FUME rising, lit orange from below.
//  - A ladle's open surface is dark CRUST plates riding on a glowing crack network, moving with the flow.
// Colour: the blackbody heat ramp in tokens.js (the only unscreened gradient in the house). The metal also LIGHTS
// the set: heatLight() returns a PointLight whose colour and power follow the pour.
import * as THREE from 'three';
import { HEAT_GLSL, heatRGB } from './tokens.js';

const G = 9.81;
// cycle 2 (change A): scene-referred emission. Wien's approximation per channel (R 610 nm, G 550, B 460 nm):
// radiance ~ exp(-C/T), so relative to the reference temperature Tr a channel scales by exp(C (1/Tr - 1/T)). That one law
// gives the film's look for free once exposed by exposure.js: the core clips white-yellow, 1400 K is orange mid-tone,
// 1200 K dull red, and a 200 K drop is a 4-8x drop in light (not the gentle ramp a clamp gives).
export const WIEN_GLSL = /* glsl */`
vec3 wien(float T, float Tr, float gain){ vec3 C = vec3(23590.0, 26160.0, 31280.0);
  return gain * vec3(1.0, 0.78, 0.42) * exp(C * (1.0 / Tr - 1.0 / max(T, 300.0))); }`;
export function wienRGB(T, Tr = 1820, gain = 1, out = [0, 0, 0]) { const C = [23590, 26160, 31280], wb = [1, 0.78, 0.42]; for (let i = 0; i < 3; i++) out[i] = gain * wb[i] * Math.exp(C[i] * (1 / Tr - 1 / Math.max(T, 300))); return out; }
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// tileable value-noise texture: R = fbm, G = ridged fbm, B = cellular-ish (F1), A = fine fbm. Baked once (~100 ms).
let _noise = null;
export function noiseTexture(n = 256, seed = 11) {
  if (_noise) return _noise;
  const d = new Uint8Array(n * n * 4), r = mulberry(seed);
  const lat = per => { const g = new Float32Array(per * per); for (let i = 0; i < g.length; i++) g[i] = r(); return g; };
  const octs = [4, 8, 16, 32, 64].map(p => ({ p, g: lat(p) }));
  const val = (o, x, y) => { const fx = x / n * o.p, fy = y / n * o.p, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, w = fy - j, P = o.p;
    const Gt = (a, b) => o.g[((b % P) + P) % P * P + ((a % P) + P) % P], su = u * u * (3 - 2 * u), sw = w * w * (3 - 2 * w);
    return (Gt(i, j) * (1 - su) + Gt(i + 1, j) * su) * (1 - sw) + (Gt(i, j + 1) * (1 - su) + Gt(i + 1, j + 1) * su) * sw; };
  const pts = []; const C = 12; for (let i = 0; i < C * C; i++) pts.push([((i % C) + r()) / C * n, (Math.floor(i / C) + r()) / C * n]);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let f = 0, rd = 0, fine = 0, s = 0.5;
    for (let k = 0; k < 5; k++) { const v = val(octs[k], x, y); f += v * s; rd += (1 - Math.abs(v * 2 - 1)) * s; if (k >= 2) fine += v * s * 2; s *= 0.5; }
    let m = 1e9; for (const [px, py] of pts) { let dx = Math.abs(px - x), dy = Math.abs(py - y); dx = Math.min(dx, n - dx); dy = Math.min(dy, n - dy); m = Math.min(m, dx * dx + dy * dy); }
    const o = (y * n + x) * 4; d[o] = f / 0.97 * 255; d[o + 1] = rd / 0.97 * 255; d[o + 2] = Math.min(255, Math.sqrt(m) / (n / C) * 255); d[o + 3] = Math.min(255, fine / 0.9 * 255);
  }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; _noise = t; return t;
}

// ---------------------------------------------------------------- the stream
export class PourStream {
  constructor(scene, o = {}) {
    const { lip = [0, 3, 0], v0 = [1.2, 0.1, 0], r0 = 0.08, lipW = 0.3, floorY = 0, nLen = 160, nRad = 28, seed = 3, T0 = 1820,
      t0 = -10, rate = 1, breakAt = 0.62, flow = 1, hdr = 0, flowAt = null } = o;
    // hdr (cycle 2): > 0 emits scene-referred light (the gain at T0) for FilmExposure; 0 keeps the c1 clamped look.
    // flowAt(t) -> 0..1.5 (cycle 2): the pour's flow over time. Low flow thins the stream (radius ~ sqrt(flow)) and moves the
    // break-up up toward the lip: the tip-back beat, where the film shows beads (Plateau-Rayleigh, ~9 radii apart).
    Object.assign(this, { lip: new THREE.Vector3(...lip), v0: new THREE.Vector3(...v0), r0, lipW, floorY, nLen, nRad, seed, T0, t0, rate, breakAt, flow, hdr, flowAt });
    const vy = this.v0.y, dy = this.lip.y - floorY;
    this.aEnd = (vy + Math.sqrt(vy * vy + 2 * G * dy)) / G;         // fall time to the floor
    const N = (nLen + 1) * (nRad + 1);
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 3); this.uvA = new Float32Array(N * 2); this.aux = new Float32Array(N * 2);
    const idx = []; for (let i = 0; i < nLen; i++) for (let j = 0; j < nRad; j++) { const a = i * (nRad + 1) + j, b = a + nRad + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    g.setIndex(idx); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(this.uvA, 2));
    g.setAttribute('aux', new THREE.BufferAttribute(this.aux, 2));
    this.geo = g;
    this.uni = { uT: { value: 0 }, uN: { value: noiseTexture() }, uT0: { value: T0 }, uGain: { value: 1 }, uTone: { value: new THREE.Vector3(1, 1, 1) }, uMono: { value: 0 }, uHDR: { value: hdr } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uni, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        attribute vec2 aux; varying vec2 vUv; varying vec2 vAux; varying vec3 vN; varying vec3 vV;
        void main(){ vUv = uv; vAux = aux; vec4 lp = vec4(position, 1.0); vec3 ln = normal;
          #ifdef USE_INSTANCING
          lp = instanceMatrix * lp; ln = mat3(instanceMatrix) * ln;          // cycle 2 fix: the beads were all drawn at the origin
          #endif
          vec4 wp = modelMatrix * lp;
          vN = normalize(mat3(modelMatrix) * ln); vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */`
        uniform float uT, uT0, uGain, uMono, uHDR; uniform sampler2D uN; uniform vec3 uTone; varying vec2 vUv; varying vec2 vAux; varying vec3 vN; varying vec3 vV;
        ${HEAT_GLSL}
        ${WIEN_GLSL}
        void main(){
          float fr = abs(dot(normalize(vN), normalize(vV)));                  // 1 facing us: the thick hot core
          float s = vUv.y, flow = vAux.x;                                      // flow: the arc coordinate advected with the metal
          vec4 nA = texture2D(uN, vec2(vUv.x * 1.0 + flow * 0.05, flow * 0.35));
          vec4 nB = texture2D(uN, vec2(vUv.x * 3.0, flow * 1.3));
          // streaks run with the flow: stretched noise; slag flares where the ridged channel peaks
          float streak = nB.a - 0.5, slag = smoothstep(0.72, 0.9, nA.g);
          float T = mix(uT0 - 420.0, uT0 + 180.0, pow(fr, 0.45)) + streak * 170.0 + slag * 160.0 - s * 90.0;
          T -= (1.0 - smoothstep(0.0, 0.25, fr)) * 180.0;                      // the skin at the silhouette
          T -= vAux.y * 380.0;                                                // beads cooling after breakup
          if (uHDR > 0.0) {                                                   // scene-referred: the metal is a light source
            vec3 e = wien(T, uT0, uHDR * uGain);
            if (uMono > 0.0) { float L = dot(e, vec3(0.3, 0.55, 0.15)); e = mix(e, uTone * L * 1.25, uMono); }
            gl_FragColor = vec4(e, 1.0); return; }
          vec3 c = heatRamp(T) * uGain;
          if (uMono > 0.0) { float L = dot(c, vec3(0.3, 0.55, 0.15)); c = mix(c, uTone * L * 1.25, uMono); }
          gl_FragColor = vec4(min(c, vec3(1.0)), 1.0);
        }` });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.userData.gbuffer = false; scene.add(this.mesh);
    // droplets that detached below the breakup: instanced spheres
    const R = mulberry(seed * 77 + 1); this.drops = [];
    for (let i = 0; i < 90; i++) this.drops.push({ ph: R(), off: [(R() - 0.5) * 0.9, (R() - 0.5) * 0.9], sz: 0.25 + 0.75 * R() * R(), vk: 0.85 + 0.3 * R() });
    this.dropMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), this.mat, this.drops.length);
    this.dropMesh.frustumCulled = false; this.dropMesh.userData.gbuffer = false; scene.add(this.dropMesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._lightC = new THREE.Color();
  }
  at(a, out = new THREE.Vector3()) { return out.set(this.lip.x + this.v0.x * a, this.lip.y + this.v0.y * a - 0.5 * G * a * a, this.lip.z + this.v0.z * a); }
  speed(a) { const vy = this.v0.y - G * a; return Math.hypot(this.v0.x, vy, this.v0.z); }
  update(t) {
    const { nLen, nRad, lipW, aEnd } = this, P = this.pos, UV = this.uvA, AX = this.aux, s0 = this.speed(0);
    const fl = this.flowAt ? Math.max(0, this.flowAt(t)) : 1; this.fl = fl;
    const r0 = this.r0 * Math.sqrt(Math.max(fl, 0.015)), breakAt = this.flowAt ? this.breakAt * Math.min(1, 0.12 + fl * 1.4) : this.breakAt;
    const on = Math.min(1, Math.max(0, (t - this.t0) * 3)) * this.rate;     // the pour starts: the front falls
    const front = on >= 1 ? aEnd : Math.min(aEnd, Math.max(0, (t - this.t0)));
    this.uni.uT.value = t;
    const p = new THREE.Vector3(), q = new THREE.Vector3(), tg = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
    const R = mulberry(this.seed);
    const ph1 = R() * 6.28, ph2 = R() * 6.28;
    let arc = 0; const L0 = []; let prev = this.at(0, new THREE.Vector3());
    for (let i = 0; i <= nLen; i++) { const a = aEnd * i / nLen; this.at(a, q); arc += q.distanceTo(prev); prev.copy(q); L0.push(arc); }
    const vel = s0 + 0.5 * G * aEnd;                   // mean surface speed for the advected texture
    for (let i = 0; i <= nLen; i++) {
      const u = i / nLen, a = aEnd * u; this.at(a, p); this.at(Math.min(aEnd, a + 0.004), q); tg.subVectors(q, p).normalize();
      side.set(-tg.z, 0, tg.x); if (side.lengthSq() < 1e-6) side.set(0, 0, 1); side.normalize(); up.crossVectors(side, tg).normalize();
      const arcS = L0[i], flow = arcS - t * vel * this.flow;
      // continuity necking + sheet at the lip + roping (varicose waves travelling with the metal)
      let r = r0 * Math.sqrt(s0 / this.speed(a));
      const sheet = Math.exp(-u / 0.12), rope = 1 + 0.16 * Math.sin(flow * 9 + ph1) * Math.min(1, u * 4) + 0.08 * Math.sin(flow * 23 + ph2);
      // breakup: below breakAt the rope pinches into beads that separate
      const bk = Math.max(0, (u - breakAt) / (1 - breakAt));
      const bead = 1 - bk * 0.92 * Math.pow(0.5 + 0.5 * Math.cos(flow * 5.2), 1.5);
      r *= rope * bead;
      const rx = r * (1 + (lipW * Math.sqrt(Math.min(1, fl)) / (2 * r0) - 1) * sheet), ry = r * (1 - 0.45 * sheet);
      const shown = (a <= front && fl > 0.004) ? 1 : 0;
      for (let j = 0; j <= nRad; j++) {
        const th = j / nRad * Math.PI * 2, k = (i * (nRad + 1) + j), wob = 1 + 0.05 * Math.sin(th * 3 + flow * 4);
        const cx = Math.cos(th) * rx * wob * shown, cy = Math.sin(th) * ry * wob * shown;
        P[k * 3] = p.x + side.x * cx + up.x * cy; P[k * 3 + 1] = p.y + side.y * cx + up.y * cy; P[k * 3 + 2] = p.z + side.z * cx + up.z * cy;
        UV[k * 2] = j / nRad; UV[k * 2 + 1] = u; AX[k * 2] = flow; AX[k * 2 + 1] = bk * (1 - bead) * 0.8;
      }
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true; this.geo.attributes.aux.needsUpdate = true;
    this.geo.computeVertexNormals(); this.geo.computeBoundingSphere();
    // droplets: born at the breakup, falling faster than the rope, spreading sideways
    const aB = aEnd * breakAt;
    this.drops.forEach((d, i) => {
      const life = (aEnd - aB) * d.vk, ph = ((t * 1.7 / life + d.ph) % 1 + 1) % 1, a = aB + ph * (aEnd - aB) * 1.02;
      this.at(a, this._p); const spread = ph * ph * 0.9;
      this._p.x += d.off[0] * spread * r0 * 3; this._p.z += d.off[1] * spread * r0 * 3;
      const sc = (front >= aEnd ? 1 : 0) * this.r0 * 0.55 * d.sz * (1 - 0.3 * ph) * (this.flowAt ? Math.min(1, 0.35 + fl) : 1);
      this._s.set(sc, sc * (1.6 + 0.8 * d.vk), sc);
      this._m.compose(this._p, this._q, this._s); this.dropMesh.setMatrixAt(i, this._m);
    });
    this.dropMesh.instanceMatrix.needsUpdate = true;
    this.front = front;
    return this;
  }
  bottom() { return this.at(this.aEnd); }
  // the key the metal throws on the set: centre of the lower stream, blackbody colour, flickering with the ropes
  light(t) { const a = this.aEnd * 0.7, p = this.at(a); heatRGB(this.T0 - 120, this._c3 || (this._c3 = [0, 0, 0]));
    this._lightC.setRGB(this._c3[0] / 255, this._c3[1] / 255, this._c3[2] / 255);
    const fl = 1 + 0.12 * Math.sin(t * 31) * Math.sin(t * 17.3 + 1) + 0.06 * Math.sin(t * 57);
    return { pos: p, color: this._lightC, power: (this.front >= this.aEnd ? 1 : this.front / this.aEnd) * fl * (this.fl ?? 1) }; }
  // cycle 2: the stream as n light samples (the key light IS the stream): positions along the fall, equal shares
  samples(t, n = 6) { const L = this.light(t), out = []; for (let i = 0; i < n; i++) { const a = this.aEnd * (i + 0.5) / n; out.push({ pos: this.at(a), color: L.color, power: L.power / n }); } return out; }
}

// ---------------------------------------------------------------- the open surface: crust plates over cracks
export class MoltenPool {
  constructor(scene, o = {}) {
    const { center = [0, 0, 0], radius = 1, cool = 0.5, T0 = 1760, scale = 5, flowDir = [1, 0], speed = 0.05, geometry = null, rotX = -Math.PI / 2,
      hdr = 0, aniso = 1, fold = 0 } = o;
    // cycle 2 (all default off = the c1 look): hdr > 0 emits scene-referred light (FilmExposure); aniso > 1 stretches the
    // plates ALONG the flow and shears them (runner crust in steel_0510_18-22 is elongated scum, never a honeycomb);
    // fold 0..1 wrinkles the crust into ROPES across the flow (the skin buckles where the flow slows).
    const fd = new THREE.Vector2(...flowDir); if (fd.lengthSq() < 1e-9) fd.set(1, 0); fd.normalize();
    this.uni = { uT: { value: 0 }, uN: { value: noiseTexture() }, uCool: { value: cool }, uT0: { value: T0 }, uScale: { value: scale }, uFlow: { value: new THREE.Vector2(...flowDir).multiplyScalar(speed) },
      uTone: { value: new THREE.Vector3(1, 1, 1) }, uMono: { value: 0 }, uHDR: { value: hdr }, uAniso: { value: aniso }, uFold: { value: fold }, uFd: { value: fd } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uni, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        uniform float uT, uCool, uT0, uScale, uMono, uHDR, uAniso, uFold; uniform vec2 uFlow, uFd; uniform sampler2D uN; uniform vec3 uTone; varying vec2 vUv;
        ${HEAT_GLSL}
        ${WIEN_GLSL}
        vec2 h2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
        void main(){
          // flow frame: a = along the flow, b = across; plates stretch along it (aniso) and shear with a slow wave
          vec2 fq = vec2(dot(vUv, uFd), dot(vUv, vec2(-uFd.y, uFd.x)));
          vec2 uvA = uAniso > 1.0 ? fq * vec2(1.0 / uAniso, 1.0) + vec2(0.35 * sin(fq.y * 7.0 + uT * 0.2) / uAniso, 0.0) : vUv;
          vec2 p = uvA * uScale + (uAniso > 1.0 ? vec2(length(uFlow) / uAniso, 0.0) : uFlow) * uT;
          // warp so plates are not a honeycomb
          vec4 w = texture2D(uN, vUv * 0.7 + uFlow * uT * 0.2);
          p += (w.rg - 0.5) * 0.9;
          vec2 ip = floor(p), fp = fract(p); float F1 = 8.0, F2 = 8.0; vec2 id = vec2(0.0);
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 g = vec2(float(i), float(j));
            vec2 o = h2(ip + g); o = 0.5 + 0.42 * sin(uT * 0.3 + 6.2831 * o);
            float d = length(g + o - fp); if (d < F1) { F2 = F1; F1 = d; id = ip + g; } else if (d < F2) F2 = d; }
          float edge = F2 - F1;                                     // 0 on a crack
          float cw = mix(0.55, 0.05, uCool) * (0.75 + 0.5 * h2(id).x);   // crack width shrinks as it cools
          float crack = 1.0 - smoothstep(0.0, cw, edge);
          float fine = texture2D(uN, vUv * 9.0 + id * 0.37).a;
          // crust: dark scale with a lighter rim where it curls; cracks: hot, hotter in their centre
          float T = mix(uT0 - 900.0 + fine * 120.0, uT0 + 40.0 * crack, crack);
          T = max(T, 760.0 + 300.0 * smoothstep(0.02, 0.0, edge));
          vec3 crust = vec3(0.075, 0.06, 0.055) * (0.6 + 0.8 * fine) + vec3(0.12, 0.05, 0.03) * smoothstep(0.25, 0.05, edge);
          if (uFold > 0.0) {   // ropes across the flow: a ridge wave advected with the metal, bent by noise; the ridge tops are cooler
            float ph = fq.x * uScale * 5.0 - uT * length(uFlow) * uScale * 5.0 + (w.b - 0.5) * 5.0 + (fine - 0.5) * 1.5;
            float rope = 0.5 + 0.5 * sin(ph * 3.14159);
            crust *= mix(1.0, 0.55 + 0.9 * rope, uFold);
            T += uFold * crack * (rope - 0.5) * 160.0;
          }
          if (uHDR > 0.0) {
            vec3 e = crust * 0.25 + wien(T, uT0 + 60.0, uHDR) * smoothstep(850.0, 1150.0, T);
            if (uMono > 0.0) { float L = dot(e, vec3(0.3, 0.55, 0.15)); e = mix(e, uTone * L * 1.25, uMono); }
            gl_FragColor = vec4(e, 1.0); return; }
          vec3 c = crust + heatRamp(T) * smoothstep(900.0, 1300.0, T);
          if (uMono > 0.0) { float L = dot(c, vec3(0.3, 0.55, 0.15)); c = mix(c, uTone * L * 1.25, uMono); }
          gl_FragColor = vec4(min(c, vec3(1.0)), 1.0);
        }` });
    const geo = geometry || new THREE.CircleGeometry(radius, 64);
    this.mesh = new THREE.Mesh(geo, this.mat); if (!geometry) this.mesh.rotation.x = rotX; this.mesh.position.set(...center); this.mesh.userData.gbuffer = false;
    scene.add(this.mesh);
  }
  update(t) { this.uni.uT.value = t; return this; }
}

// ---------------------------------------------------------------- fume: iron-oxide smoke lit from below
export class Fume {
  constructor(scene, o = {}) {
    const { base = [0, 0, 0], height = 6, width = 3, n = 7, seed = 5, color = '#3a2a22', rise = 0.45, alpha = 0.5, lit = 0, depth = 0.4 } = o;
    // lit > 0 (cycle 2): single scatter of the SOURCE's light. update(t, cam, light, samples) takes up to 8 light samples
    // (pour.samples(t)); each card fragment gathers them with inverse-square falloff at its world position, so the fume
    // is brightest hugging the stream and falls off with distance, as in steel_1120_13-27 (the largest bright area).
    const R = mulberry(seed); this.cards = []; this.base = new THREE.Vector3(...base);
    this.uniS = { uT: { value: 0 }, uN: { value: noiseTexture() }, uLight: { value: new THREE.Color('#ff8a1a') }, uLk: { value: 1 }, uCol: { value: new THREE.Color(color) }, uRise: { value: rise }, uA: { value: alpha },
      uLit: { value: lit }, uSP: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -999, 0, 0)) } };
    for (let i = 0; i < n; i++) {
      const uni = { ...this.uniS, uSeed: { value: R() * 10 }, uH: { value: height } };
      const m = new THREE.ShaderMaterial({ uniforms: uni, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: /* glsl */`
          uniform float uT, uSeed, uLk, uRise, uA, uLit; uniform vec4 uSP[8]; uniform sampler2D uN; uniform vec3 uLight, uCol; varying vec2 vUv; varying vec3 vW;
          void main(){
            vec2 p = vec2(vUv.x * 0.8 + uSeed, vUv.y * 0.9 - uT * uRise * 0.25);
            float n1 = texture2D(uN, p).r, n2 = texture2D(uN, p * 2.3 + vec2(0.0, -uT * uRise * 0.2)).g;
            float d = smoothstep(0.5, 0.95, n1 * 0.75 + n2 * 0.45);
            float col = smoothstep(0.42, 0.05, abs(vUv.x - 0.5 - (n1 - 0.5) * 0.3) - vUv.y * 0.18);   // a plume that widens as it rises
            float a = d * col * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.45, vUv.y) * uA;
            float lit = exp(-vUv.y * 3.5) * uLk;                   // lit from below by the metal
            vec3 c = uCol * (0.6 + 0.5 * n2) + uLight * lit * (0.55 + 0.6 * n2);
            if (uLit > 0.0) {                                      // scene-referred: the smoke scatters the source's light
              float E = 0.0; for (int i = 0; i < 8; i++) { vec3 d = vW - uSP[i].xyz; E += uSP[i].w / (0.12 + dot(d, d)); }
              c = uCol * 0.12 * (0.6 + 0.5 * n2) + uLight * E * uLit * (0.45 + 0.8 * n2);
              a = min(1.0, a * 1.25);
            }
            gl_FragColor = vec4(c, a);
          }` });
      const h = height * (0.7 + 0.5 * R()), w = width * (0.6 + 0.6 * R());
      const g = new THREE.PlaneGeometry(w, h); g.translate(0, h / 2, 0);
      const mesh = new THREE.Mesh(g, m); mesh.position.copy(this.base).add(new THREE.Vector3((R() - 0.5) * width * 0.5, 0, (R() - 0.5) * width * 0.4));
      mesh.userData.gbuffer = false; mesh.renderOrder = 5; scene.add(mesh); this.cards.push(mesh);
    }
  }
  update(t, camera, light = null, samples = null) {
    this.uniS.uT.value = t;
    if (light) { this.uniS.uLight.value.copy(light.color); this.uniS.uLk.value = light.power; }
    if (samples) this.uniS.uSP.value.forEach((v, i) => { const s = samples[i]; if (s) v.set(s.pos.x, s.pos.y, s.pos.z, s.power); else v.set(0, -999, 0, 0); });
    for (const c of this.cards) { c.quaternion.copy(camera.quaternion); }
    return this;
  }
}

// a PointLight driven by a source's light(t): { pos, color, power }
export function heatLight(scene, { intensity = 60, distance = 25, decay = 1.6, offset = [0, 0, 0] } = {}) {
  const L = new THREE.PointLight('#ff9a3a', 0, distance, decay); L.castShadow = false; scene.add(L);
  return { light: L, drive(src) { L.position.copy(src.pos).add(new THREE.Vector3(...offset)); L.color.copy(src.color); L.intensity = intensity * src.power; } };
}
