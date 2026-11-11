// WORLD3D: three.js helpers for lit 3D worlds rendered frame-by-frame in headless Chromium (SwiftShader).
//   World       renderer + scene + camera, ACES tonemapping, exp/height fog, sun with a fitted shadow map, hemi fill
//   City        instanced procedural blocks from 5 archetypes + rooftop clutter, per-building facade palettes; windows light
//               up in a wave (shader-side, per window); wet asphalt with planar puddle reflections, sodium grid, lamps, traffic
//   SDFLayer    an sdf.js hero structure composited into the three.js scene with a real depth test (handoff)
//   applyLook   sdf.js LOOKS.* applied to a World (sun, hemi, fog, sky, exposure)
//   Terrain     displaced height-noise ground with slope/height vertex colours
//   Figures     crowds: GPU-skinned people.js workers with LOD (default), or the old instanced capsules
//   rig.*       camera rigs as pure functions of time: dolly, crane, orbit, path, plus handheld() beat shake
//   glow()      cheap 2D bloom (threshold + two blurred mips at 1/4 and 1/8 res, added back)
// Everything is a pure function of t: no clocks, no accumulated state.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { People } from './people.js';
import { Atmos } from './atmos3d.js';
export { THREE };

// ------------------------------------------------------------------ noise (JS, deterministic)
export function hash2(x, y) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm2(x, y, oct = 5) { let s = 0, a = 0.5; for (let i = 0; i < oct; i++) { s += a * noise2(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; a *= 0.5; } return s; }
const smooth = x => x * x * (3 - 2 * x);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, x) => a + (b - a) * x;
const L3 = (a, b, x) => [lerp(a[0], b[0], x), lerp(a[1], b[1], x), lerp(a[2], b[2], x)];

// ------------------------------------------------------------------ camera rigs
// A rig value is a plain { pos:[x,y,z], target:[x,y,z], fov, roll } object; the same value drives
// a three.js camera (applyCam) and the SDF raymarcher (sdf.render(t, { cam })).
const eio = x => (x = clamp(x), x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const rig = {
  // straight move from a to b (positions and targets), eased; u in 0..1
  dolly(u, a, b, { fov = 40, fov1 = null, ease = eio } = {}) {
    const k = ease(u); return { pos: L3(a.pos, b.pos, k), target: L3(a.target, b.target, k), fov: fov1 == null ? fov : lerp(fov, fov1, k), roll: lerp(a.roll || 0, b.roll || 0, k) };
  },
  // crane: rise from y0 to y1 while pulling from dist0 to dist1 (along the heading ang) and tilting toward target
  crane(u, { center = [0, 0, 0], ang = 0, dist0 = 100, dist1 = 150, y0 = 2, y1 = 80, look0 = 20, look1 = 0, fov = 40, ease = eio } = {}) {
    const k = ease(u), d = lerp(dist0, dist1, k);
    return { pos: [center[0] + Math.sin(ang) * d, lerp(y0, y1, k), center[2] + Math.cos(ang) * d], target: [center[0], center[1] + lerp(look0, look1, k), center[2]], fov };
  },
  // orbit around center at radius r, height h; a0 + speed * t (radians)
  orbit(t, { center = [0, 0, 0], r = 100, h = 20, a0 = 0, speed = 0.1, look = 0, fov = 40 } = {}) {
    const a = a0 + speed * t; return { pos: [center[0] + Math.sin(a) * r, center[1] + h, center[2] + Math.cos(a) * r], target: [center[0], center[1] + look, center[2]], fov };
  },
  // Catmull-Rom through a list of { pos, target } keys; u in 0..1 across all keys
  path(u, keys, { fov = 40 } = {}) {
    const n = keys.length - 1, x = clamp(u) * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
    const cr = (k) => { const p0 = keys[Math.max(0, i - 1)][k], p1 = keys[i][k], p2 = keys[i + 1][k], p3 = keys[Math.min(n, i + 2)][k];
      return p1.map((_, j) => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * f + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * f * f + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * f * f * f)); };
    return { pos: cr('pos'), target: cr('target'), fov: keys[i].fov != null ? lerp(keys[i].fov, keys[i + 1].fov ?? keys[i].fov, f) : fov, roll: lerp(keys[i].roll || 0, keys[i + 1].roll || 0, f) };
  },
};
// Handheld: deterministic multi-octave wobble plus a kick punch (kick = 0..1 envelope, e.g. B.env('kick', t, 9)).
// amp in metres at the camera, rot in radians of roll; scale both with shot size.
export function handheld(c, t, { amp = 0.15, rot = 0.004, kick = 0, punch = 0.6, seed = 1 } = {}) {
  const n = (k) => (noise2(t * 1.3 + seed * 7.1, k * 3.7) - 0.5) + 0.5 * (noise2(t * 3.1 + seed * 2.3, k * 5.1 + 9) - 0.5);
  const d = Math.hypot(c.target[0] - c.pos[0], c.target[1] - c.pos[1], c.target[2] - c.pos[2]);
  const kx = kick * punch * (noise2(t * 40, 11) - 0.5) * 2, ky = kick * punch * (noise2(t * 40, 23) - 0.5) * 2;
  return { ...c,
    pos: [c.pos[0] + n(1) * amp, c.pos[1] + n(2) * amp * 0.7 + ky * amp, c.pos[2] + n(3) * amp],
    target: [c.target[0] + (n(4) * amp * 2 + kx * amp * 3) * d / 60, c.target[1] + (n(5) * amp * 2 + ky * amp * 3) * d / 60, c.target[2]],
    roll: (c.roll || 0) + n(6) * rot + kx * rot * 2, fov: (c.fov || 40) * (1 - kick * 0.02) };
}
export function applyCam(camera, c) {
  camera.position.set(...c.pos); camera.up.set(Math.sin(c.roll || 0), Math.cos(c.roll || 0), 0);
  camera.lookAt(...c.target); if (c.fov && camera.fov !== c.fov) { camera.fov = c.fov; camera.updateProjectionMatrix(); }
}

// ------------------------------------------------------------------ height fog (patches three's fog chunks once, globally)
// Standard FogExp2 becomes exp2 distance fog * exp(-falloff * height) of the average ray height. Uniform fogFalloff via scene.userData.
let heightFogPatched = false;
export const fogUniforms = { fogFalloff: { value: 0 } };
function patchHeightFog() {
  if (heightFogPatched) return; heightFogPatched = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = C.fog_pars_vertex.replace('varying float vFogDepth;', 'varying float vFogDepth; varying float vFogY;');
  C.fog_vertex = C.fog_vertex.replace('vFogDepth = - mvPosition.z;', 'vFogDepth = - mvPosition.z; vFogY = (inverse(viewMatrix) * mvPosition).y;');
  C.fog_pars_fragment = C.fog_pars_fragment.replace('varying float vFogDepth;', 'varying float vFogDepth; varying float vFogY; uniform float fogFalloff;');
  C.fog_fragment = C.fog_fragment.replace('float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );',
    'float hY = max(0.5 * (vFogY + cameraPosition.y), 0.0); float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth * exp(-fogFalloff * hY) );');
}

// ------------------------------------------------------------------ World
export class World {
  // scale: render resolution vs 1080x1920 (upscaled on draw); shadows: shadow map size or 0 (1024 + fitShadow() is the cheap default)
  // atmos: opt-in (WORLDS c1) HDR sky + aerial perspective + lightfield + value rule from atmos3d.js; a LOOKS3 look or
  // true (PLAINS_DUSK). With it, render(cam, t) goes through world.atmos; without it nothing changes.
  constructor({ w = 1080, h = 1920, scale = 1, shadows = 1024, antialias = true, fog = null, background = '#000', exposure = 1, heightFog = false, atmos = null, far = 6000, near = 0.5 } = {}) {
    if (heightFog) patchHeightFog();
    const r = this.renderer = new THREE.WebGLRenderer({ antialias, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(1); r.setSize(Math.round(w * scale), Math.round(h * scale), false);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = exposure; r.outputColorSpace = THREE.SRGBColorSpace;
    if (shadows) { r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; }
    this.canvas = r.domElement; this.w = w; this.h = h; this.scale = scale;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(background);
    if (fog) this.fog(fog);
    this.camera = new THREE.PerspectiveCamera(40, w / h, near, far);
    this.shadowSize = shadows;
    this.onBefore = [];          // callbacks (camera) run before each render (skinned crowds, SDF layers)
    this._fit = null;            // shadow fit to the camera frustum (fitShadow)
    this._refl = null;           // planar reflection of the ground (reflect)
    if (atmos) { this.scene.background = null; this.atmos = atmos === true ? new Atmos(this) : atmos.look ? new Atmos(this, atmos.look, atmos) : new Atmos(this, atmos); }
  }
  fog({ color = '#000', density = 0.002, falloff = 0 } = {}) {
    this.scene.fog = new THREE.FogExp2(new THREE.Color(color), density); fogUniforms.fogFalloff.value = falloff;
    return this.scene.fog;
  }
  // sun: directional light with a shadow frustum fitted to a box of half-size `area` around `focus`
  sun({ dir = [-0.5, 0.6, 0.4], color = '#fff2e0', intensity = 3, area = 200, focus = [0, 0, 0], bias = -0.0004, normalBias = 0.6 } = {}) {
    const L = this._sun || (this._sun = new THREE.DirectionalLight());
    L.color.set(color); L.intensity = intensity; this._sunDir = new THREE.Vector3(...dir).normalize();
    const d = this._sunDir;
    L.position.set(focus[0] + d.x * area * 2, focus[1] + d.y * area * 2, focus[2] + d.z * area * 2); L.target.position.set(...focus);
    if (this.shadowSize) { L.castShadow = true; const s = L.shadow; s.mapSize.set(this.shadowSize, this.shadowSize);
      Object.assign(s.camera, { left: -area, right: area, top: area, bottom: -area, near: 1, far: area * 5 }); s.camera.updateProjectionMatrix();
      s.bias = bias; s.normalBias = normalBias; s.radius = 2; }
    if (!L.parent) { this.scene.add(L); this.scene.add(L.target); }
    return L;
  }
  // fit the sun's shadow frustum to the camera frustum slice [0, far] every render (bounding sphere, texel-snapped, so it
  // does not swim): a 1024 map then covers what the camera sees instead of the whole city. casters = extra metres toward the sun.
  fitShadow({ far = 420, casters = 400 } = {}) { this._fit = { far, casters }; return this; }
  _fitShadow() {
    const L = this._sun; if (!L || !this.shadowSize) return;
    const cam = this.camera, f = Math.min(this._fit.far, cam.far), tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), tanX = tanY * cam.aspect;
    const pts = []; for (const z of [cam.near, f]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) pts.push(new THREE.Vector3(sx * tanX * z, sy * tanY * z, -z).applyMatrix4(cam.matrixWorld));
    const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / 8); let r = 0; for (const p of pts) r = Math.max(r, p.distanceTo(c));
    r = Math.ceil(r / 8) * 8;
    const d = this._sunDir, texel = 2 * r / this.shadowSize;
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), d.clone().negate(), new THREE.Vector3(0, 1, 0)), mi = m.clone().invert();
    const lc = c.clone().applyMatrix4(mi); lc.x = Math.round(lc.x / texel) * texel; lc.y = Math.round(lc.y / texel) * texel; c.copy(lc.applyMatrix4(m));
    const D = r + this._fit.casters;
    L.position.copy(c).addScaledVector(d, D); L.target.position.copy(c); L.target.updateMatrixWorld();
    Object.assign(L.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: D + r + 50 }); L.shadow.camera.updateProjectionMatrix();
  }
  hemi(sky = '#8fb0ff', ground = '#3a2a20', intensity = 0.6) {
    const h = this._hemi || (this._hemi = new THREE.HemisphereLight()); h.color.set(sky); h.groundColor.set(ground); h.intensity = intensity;
    if (!h.parent) this.scene.add(h); return h;
  }
  // gradient sky dome with a sun glow (unfogged; output-space like three's fog, which is mixed after tonemapping, so a horizon equal to the fog colour hides the ground edge)
  skyDome({ top = '#0b0a14', horizon = '#3a1e28', sun = [-0.8, 0.1, -0.4], sunColor = '#ff8a4a', glow = 1, radius = 5000 } = {}) {
    if (!this._sky) {
      this._skyU = { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3() }, uSunC: { value: new THREE.Color() }, uGlow: { value: 1 } };
      this._sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this._skyU,
        vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }',
        fragmentShader: `uniform vec3 uTop, uHor, uSun, uSunC; uniform float uGlow; varying vec3 vD;
          void main(){ vec3 c = mix(uHor, uTop, smoothstep(-.02, .45, abs(vD.y))); float s = max(dot(normalize(vD), normalize(uSun)), 0.);
            c += uSunC * (pow(s, 6.) * .5 + pow(s, 60.) * 1.5 + smoothstep(.9994, .9997, s) * 4.) * uGlow;
            gl_FragColor = vec4(c, 1.);
            #include <colorspace_fragment>
          }` }));
      this._sky.frustumCulled = false; this._sky.renderOrder = -1; this.scene.add(this._sky);
    }
    const U = this._skyU; U.uTop.value.set(top); U.uHor.value.set(horizon); U.uSun.value.set(...sun); U.uSunC.value.set(sunColor); U.uGlow.value = glow;
    return this._sky;
  }
  // planar reflection of the y = 0 plane (wet streets): the scene is rendered once more from the mirrored camera at `scale`
  // into a half-float target; materials read uniforms reflUniforms { tRefl, uReflMat, uReflOn }. Objects with
  // userData.noReflect (the ground itself, SDF layers) are hidden in that pass. The sun's shadow map is computed in the
  // reflection pass and reused by the main pass (one shadow render per frame).
  reflect({ scale = 0.33 } = {}) {
    const rt = new THREE.WebGLRenderTarget(Math.round(this.w * this.scale * scale), Math.round(this.h * this.scale * scale), { type: THREE.HalfFloatType });
    this._refl = { rt, cam: new THREE.PerspectiveCamera(), u: this.reflUniforms };
    this.reflUniforms.tRefl.value = rt.texture; this.reflUniforms.uReflOn.value = 1;
    return this;
  }
  get reflUniforms() { return this._reflU || (this._reflU = { tRefl: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uReflOn: { value: 0 } }); }
  _renderReflection() {
    const R = this._refl, cam = this.camera, v = R.cam, r = this.renderer;
    const p = cam.position, look = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).add(p);
    v.position.set(p.x, -p.y, p.z); v.up.set(0, 1, 0).applyQuaternion(cam.quaternion); v.up.y *= -1;
    v.lookAt(look.x, -look.y, look.z); v.fov = cam.fov; v.aspect = cam.aspect; v.near = cam.near; v.far = cam.far; v.updateProjectionMatrix(); v.updateMatrixWorld();
    R.u.uReflMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(v.projectionMatrix).multiply(v.matrixWorldInverse);
    const hidden = []; this.scene.traverse(o => { if (o.userData.noReflect && o.visible) { o.visible = false; hidden.push(o); } });
    if (this._sky) this._sky.position.copy(v.position);
    R.u.uReflOn.value = 0;
    r.setRenderTarget(R.rt); r.render(this.scene, v); r.setRenderTarget(null);
    R.u.uReflOn.value = 1;
    for (const o of hidden) o.visible = true;
  }
  // events on the beat (WORLDS c1 pass 2, atmos worlds only): world.event('lightning', 12.4) -> handlers set with world.atmos.on()
  event(name, t, opts) { if (this.atmos) this.atmos.event(name, t, opts); return this; }
  render(cam, t = 0) {
    if (this.atmos) return this.atmos.render(cam, t);
    if (cam) applyCam(this.camera, cam); this.camera.updateMatrixWorld();
    for (const f of this.onBefore) f(this.camera);
    if (this._fit) this._fitShadow();
    const r = this.renderer;
    if (this._refl) { r.shadowMap.autoUpdate = true; this._renderReflection(); r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = false; }
    if (this._sky) this._sky.position.copy(this.camera.position);
    r.render(this.scene, this.camera);
    r.shadowMap.autoUpdate = true;
    return this.canvas;
  }
  draw(ctx, x = 0, y = 0, w = ctx.canvas.width, h = ctx.canvas.height) { ctx.drawImage(this.canvas, x, y, w, h); }
  // readPixels fence: profiling (?prof=1) and warm-up only
  sync() { const gl = this.renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
}

// A shared look (sdf.js LOOKS.*) applied to a three.js World: sun colour/intensity, hemi fill, fog, sky dome and exposure,
// so SDF shots and three.js shots cut together. Returns the resolved values.
export function applyLook(world, look, { sunDir = null, area = 700, glow = 1 } = {}) {
  const T = look.three || {}, dir = sunDir || look.sun?.dir || [0.5, 0.3, 0.5];
  world.sun({ dir, color: T.sun || '#fff0e0', intensity: T.sunI ?? 3, area });
  world.hemi(T.hemiSky || '#8090b0', T.hemiGround || '#302018', T.hemiI ?? 0.6);
  if (world.scene.fog) { world.scene.fog.color.set(T.fog || '#202020'); world.scene.fog.density = T.fogD ?? world.scene.fog.density; }
  world.skyDome({ top: T.skyTop || '#101020', horizon: T.fog || '#402820', sun: dir, sunColor: T.sun || '#ff8040', glow });
  world.renderer.toneMappingExposure = T.exposure ?? 1;
  return T;
}

// ------------------------------------------------------------------ City
// Instanced city blocks from a few archetypes (slab, octagon, crowned, stepped, podium tower), one draw call each, with
// rooftop clutter (plant boxes, water tanks, masts). Facades are computed per fragment from world position (no textures):
// per-instance palette (concrete, dark glass, brick, sandstone, charcoal), ribbon or punched windows, fins, spandrel bands,
// grime streaks, darker street level and lit shopfronts. Lighting-up is shader-side: each building has an order value
// (distance from `origin` + noise); update({ wave }) lights every building whose order < wave, window by window over
// `spread`. The ground is wet asphalt with puddles that mirror the city (World.reflect()), kerbs, sodium pools and lamps.
const ARCH = (() => {
  const box = (sx, y0, y1, sz) => { const g = new THREE.BoxGeometry(sx, y1 - y0, sz); g.translate(0, (y0 + y1) / 2, 0); g.deleteAttribute('uv'); return g; };
  const oct = new THREE.CylinderGeometry(0.5 / Math.cos(Math.PI / 8), 0.5 / Math.cos(Math.PI / 8), 1, 8); oct.rotateY(Math.PI / 8); oct.deleteAttribute('uv');
  const fr = new THREE.CylinderGeometry(0.25 * Math.SQRT2, 0.5 * Math.SQRT2, 0.2, 4); fr.rotateY(Math.PI / 4); fr.translate(0, 0.4, 0); fr.deleteAttribute('uv');
  const merge = (gs) => mergeGeometries(gs.map(g => g.index ? g.toNonIndexed() : g));
  return [
    box(1, -0.5, 0.5, 1),                                                                   // slab
    oct.toNonIndexed(),                                                                     // octagon
    merge([box(1, -0.5, 0.3, 1), fr]),                                                      // crowned (square frustum top)
    merge([box(1, -0.5, 0.1, 1), box(0.76, 0.1, 0.34, 0.76), box(0.5, 0.34, 0.5, 0.5)]),    // stepped (setbacks)
    merge([box(1, -0.5, -0.36, 1), box(0.62, -0.36, 0.5, 0.36)]),                           // podium + slab
  ].map(g => g.index ? g.toNonIndexed() : g);
})();
export class City {
  constructor(world, { nx = 40, nz = 40, block = 26, street = 12, seed = 7, origin = [0, 0], maxH = 160, minH = 8,
    heightFn = null, clear = null, facade = '#ffffff', warm = '#ffb35c', cool = '#dfe8ff', red = '#ff2a2a', redShare = 0.08,
    floorH = 3.6, winW = 3.2, beacons = true, traffic = 900, groundColor = '#1a1918', groundSpan = 4, wet = 0.6, clutter = true, lamps = true, lampR = 520 } = {}) {
    this.world = world; const S = world.scene;
    const pitch = block + street, R = mulberry(seed);
    const inst = ARCH.map(() => ({ mats: [], orders: [], tints: [] }));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const tops = [], clut = [[], [], []];
    const add = (a, x, y0, h, z, w, d, order, tint, rotY = 0) => {
      q.setFromEuler(new THREE.Euler(0, rotY, 0)); p.set(x, y0 + h / 2, z); s.set(w, h, d); m4.compose(p, q, s);
      inst[a].mats.push(m4.clone()); inst[a].orders.push(order); inst[a].tints.push(tint); };
    const roofTop = (a, h) => a === 2 ? 0.8 : a === 3 ? 1 : 1;   // fraction of h that is flat roof (for clutter)
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const cx = (i - nx / 2 + 0.5) * pitch, cz = (j - nz / 2 + 0.5) * pitch;
      if (clear && clear(cx, cz)) continue;
      const split = R() < 0.35 ? 1 : R() < 0.6 ? 2 : 4;
      for (let k = 0; k < split; k++) {
        const sx = split === 1 ? block : block / 2 - 1, sz = split === 4 ? block / 2 - 1 : block;
        const ox = split === 1 ? 0 : (k % 2 ? 1 : -1) * (block / 4 + 0.5), oz = split === 4 ? (k < 2 ? -1 : 1) * (block / 4 + 0.5) : 0;
        const x = cx + ox, z = cz + oz, r = Math.hypot(x - origin[0], z - origin[1]);
        let h = heightFn ? heightFn(x, z, R) : minH + (maxH - minH) * Math.pow(R(), 3) * Math.exp(-r / 500);
        h = Math.max(minH, h);
        const w = sx * lerp(0.72, 1, R()), d = sz * lerp(0.72, 1, R()), tint = R(), order = r + R() * 120;
        // archetype by height and chance: low blocks are slabs/podiums, towers pick among all five
        const u = R(); const a = h < 24 ? (u < 0.8 ? 0 : 4) : h < 60 ? (u < 0.4 ? 0 : u < 0.6 ? 3 : u < 0.8 ? 4 : 2) : (u < 0.25 ? 0 : u < 0.45 ? 1 : u < 0.65 ? 2 : u < 0.85 ? 3 : 4);
        add(a, x, 0, h, z, w, d, order, tint);
        let topH = h * roofTop(a), tw = a === 3 ? w * 0.5 : a === 4 ? w * 0.62 : a === 2 ? w * 0.5 : w, td = a === 3 ? d * 0.5 : a === 4 ? d * 0.36 : a === 2 ? d * 0.5 : d;
        if (h > 50 && a === 0 && R() < 0.5) {                    // setback tower on some tall slabs
          const h2 = h * lerp(0.25, 0.6, R()); add(R() < 0.3 ? 1 : 0, x, h, h2, z, w * 0.6, d * 0.6, order + 10, R()); topH = h + h2; tw = w * 0.6; td = d * 0.6; }
        if (topH > 70) tops.push([x, topH + (a === 2 ? h * 0.2 : 0), z, R()]);
        if (clutter && a !== 1 && a !== 2) {                   // rooftop clutter: plant boxes, a water tank, a mast
          const n = 1 + Math.floor(R() * 3);
          for (let c = 0; c < n; c++) { const kx = (R() - 0.5) * tw * 0.7, kz = (R() - 0.5) * td * 0.7, t = R();
            if (t < 0.55) clut[0].push([x + kx, topH, z + kz, lerp(2, 5, R()), lerp(1.2, 3, R()), lerp(2, 4, R())]);
            else if (t < 0.85) clut[1].push([x + kx, topH, z + kz, lerp(1.4, 2.6, R()), lerp(3, 5, R()), 0]);
            else clut[2].push([x + kx, topH, z + kz, 0.35, lerp(6, 22, R()), 0.35]); }
        }
      }
    }
    this.count = inst.reduce((a, b) => a + b.mats.length, 0);
    const mat = this.material = new THREE.MeshStandardMaterial({ color: facade, roughness: 0.78, metalness: 0.1 });
    const U = this.uniforms = { uWave: { value: -1 }, uSpread: { value: 140 }, uFloor: { value: floorH }, uWinW: { value: winW }, uDay: { value: 0 },
      uWarm: { value: new THREE.Color(warm) }, uCool: { value: new THREE.Color(cool) }, uRed: { value: new THREE.Color(red) }, uRedShare: { value: redShare },
      uGain: { value: 3 }, uT: { value: 0 }, uRedPulse: { value: 0 }, uLamps: { value: 0 }, uWet: { value: wet } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, fogUniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aOrder; attribute float aTint; varying vec3 vWP; varying vec3 vWN; varying float vOrder; varying float vTint; varying vec3 vScale; varying float vLocalY;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          mat4 imx = instanceMatrix; vWP = (modelMatrix * imx * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix * imx) * objectNormal);
          vOrder = aOrder; vTint = aTint; vScale = vec3(length(imx[0].xyz), length(imx[1].xyz), length(imx[2].xyz)); vLocalY = (transformed.y + 0.5) * vScale.y;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uWave, uSpread, uFloor, uWinW, uDay, uRedShare, uGain, uT, uRedPulse, uLamps; uniform vec3 uWarm, uCool, uRed;
        varying vec3 vWP; varying vec3 vWN; varying float vOrder; varying float vTint; varying vec3 vScale; varying float vLocalY;
        float wh(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 wn = normalize(vWN); float isSide = step(abs(wn.y), 0.5);
          vec2 fu = abs(wn.x) > abs(wn.z) ? vec2(vWP.z, vWP.y) : vec2(vWP.x, vWP.y);
          float pal = floor(fract(vTint * 7.31) * 5.0);                        // facade palette per building
          vec3 base = pal < 1. ? vec3(.5,.48,.45) : pal < 2. ? vec3(.06,.07,.09) : pal < 3. ? vec3(.3,.13,.08) : pal < 4. ? vec3(.52,.42,.3) : vec3(.16,.16,.17);
          float glass = step(1., pal) * step(pal, 1.5);
          diffuseColor.rgb *= base * (0.85 + 0.3 * wh(vec2(floor(vTint * 97.), 3.)));
          vec2 cell = fu / vec2(uWinW, uFloor); vec2 wid = floor(cell); vec2 wf = fract(cell);
          float style = floor(vTint * 4.0);
          float wx = (style < 1.0 || glass > .5) ? step(.06, wf.x) * step(wf.x, .94) : style < 3.0 ? step(.3, wf.x) * step(wf.x, .7) : step(.18, wf.x) * step(wf.x, .82);
          float win = wx * step(glass > .5 ? .12 : .28, wf.y) * step(wf.y, glass > .5 ? .95 : .82) * isSide * step(4.4, vWP.y);
          float band = step(.93, fract(vWP.y / (uFloor * 6.0)));
          float fin = style > 1.5 && style < 2.5 ? step(.9, fract(fu.x / (uWinW * 2.))) : 0.;          // vertical fins
          win *= (1.0 - band) * (1.0 - fin);
          float streak = step(.72, wh(vec2(floor(fu.x * 1.1), floor(vWP.y / 11.) + vTint * 7.))) * isSide;   // grime streaks
          float street = 1. - smoothstep(0., 7., vWP.y);                                                   // street-level grime
          diffuseColor.rgb *= mix(1.0, glass > .5 ? .6 : 0.3, win) * (0.85 + 0.3 * wh(wid * .37 + vTint * 13.0)) * (1.0 - band * 0.35) * (1. - fin * .5) * (1. - .22 * streak) * (1. - .4 * street);
          if (isSide < .5) diffuseColor.rgb *= .55 + .3 * wh(floor(vWP.xz * .5));                         // roofs: gravel, darker
          float r = wh(wid + vec2(vTint * 91.7, wn.x * 3.0 + wn.z * 7.0));
          float lit = clamp((uWave - vOrder) / uSpread, 0.0, 1.0);
          float on = win * step(r, lit * 0.92) * (1.0 - 0.9 * step(.82, wh(vec2(wid.y, vTint * 50.))));
          float flick = 0.85 + 0.15 * sin(uT * 3.0 + r * 60.0);
          vec3 wc = mix(uWarm, uCool, step(0.72, fract(r * 7.13))) * (0.55 + 0.9 * fract(r * 13.7));
          float isRed = step(1.0 - uRedShare, vTint) * step(fract(vWP.y / (uFloor * 3.0)), 0.34);
          wc = mix(wc, uRed * (1.6 + 2.0 * uRedPulse), isRed);
          vec3 winEmi = wc * on * flick * uGain * (1.0 - uDay * 0.8);
          float shop = isSide * step(.5, vWP.y) * step(vWP.y, 4.0) * step(.35, wh(vec2(floor(fu.x / 5.), vTint * 31.))) * step(.12, fract(fu.x / 5.)) * step(fract(fu.x / 5.), .88);
          vec3 shopEmi = uWarm * shop * max(uLamps, lit * (1. - uDay)) * 1.6 * (0.6 + 0.8 * wh(vec2(floor(fu.x / 5.), 2.)));
          float crown = isSide * smoothstep(vScale.y - 2.0, vScale.y - 0.6, vLocalY) * step(30.0, vScale.y) * step(.5, lit) * (1.0 - uDay);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, .3, glass) * (1. - win * .6);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += winEmi + shopEmi + crown * mix(uWarm, uRed, step(.5, vTint)) * 1.5;`);
    };
    this.meshes = inst.map((I, a) => {
      if (!I.mats.length) return null;
      const g = ARCH[a].clone();
      g.setAttribute('aOrder', new THREE.InstancedBufferAttribute(new Float32Array(I.orders), 1));
      g.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(I.tints), 1));
      const mesh = new THREE.InstancedMesh(g, mat, I.mats.length);
      I.mats.forEach((m, i) => mesh.setMatrixAt(i, m)); mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
      S.add(mesh); return mesh;
    }).filter(Boolean);
    this.mesh = this.meshes[0];
    // rooftop clutter (plain dark metal): boxes, tanks, masts
    const cmat = new THREE.MeshStandardMaterial({ color: '#4a4744', roughness: 0.7, metalness: 0.3 });
    const cg = [new THREE.BoxGeometry(1, 1, 1), new THREE.CylinderGeometry(0.5, 0.5, 1, 10), new THREE.BoxGeometry(1, 1, 1)];
    cg.forEach(g => g.translate(0, 0.5, 0));
    this.clutter = clut.map((L, k) => { if (!L.length) return null;
      const m = new THREE.InstancedMesh(cg[k], cmat, L.length);
      L.forEach(([x, y, z, sx, sy, sz], i) => { p.set(x, y, z); s.set(k === 1 ? sx * 2 : sx, sy, k === 1 ? sx * 2 : sz); q.identity(); m4.compose(p, q, s); m.setMatrixAt(i, m4); });
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; S.add(m); return m; }).filter(Boolean);
    // ground: wet asphalt, puddles mirroring the city (World.reflect), kerbs and pavements, sodium street grid lit by the wave
    const span = Math.max(nx, nz) * pitch * groundSpan;
    const gmat = new THREE.MeshStandardMaterial({ color: groundColor, roughness: 0.9 });
    const RU = world.reflUniforms;
    gmat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, fogUniforms, RU, { uPitch: { value: pitch }, uStreet: { value: street }, uOrigin: { value: new THREE.Vector2(...origin) } });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWP; uniform float uWave, uSpread, uPitch, uStreet, uDay, uGain, uT, uLamps, uWet, uReflOn; uniform vec2 uOrigin; uniform vec3 uWarm;
        uniform sampler2D tRefl; uniform mat4 uReflMat;
        float gh(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
        float gn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(gh(i),gh(i+vec2(1,0)),f.x),mix(gh(i+vec2(0,1)),gh(i+vec2(1,1)),f.x),f.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 g = abs(mod(vWP.xz, uPitch) - uPitch * 0.5);
          float gx = uPitch * 0.5 - g.x, gz = uPitch * 0.5 - g.y;
          float across = min(gx, gz), along = gx < gz ? vWP.z : vWP.x;
          float st = step(across, uStreet * 0.5);
          float pave = 1. - st;
          float grain = gn(vWP.xz * 1.7) * .5 + gn(vWP.xz * 7.) * .5;
          diffuseColor.rgb *= mix(.8 + .4 * grain, 1.9 * (.85 + .15 * step(.06, min(fract(vWP.x / 1.5), fract(vWP.z / 1.5)))), pave);
          float pud = smoothstep(.52, .6, gn(vWP.xz * .09) * .6 + gn(vWP.xz * .31) * .4 + uWet * .3 - .15) * st;
          float damp = uWet * (.4 + .6 * gn(vWP.xz * .05 + 3.));
          float wetK = max(pud, damp * .6);
          diffuseColor.rgb *= 1. - .55 * wetK;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, .08, wetK);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float pool = st * exp(-pow((fract(along / 18.0) - 0.5) * 18.0, 2.0) / 30.0) * exp(-pow(across - uStreet * 0.42, 2.0) / 6.0);
          float kerb = st * smoothstep(0.35, 0.0, abs(across - uStreet * 0.5));
          float dash = st * step(across, 0.12) * step(0.5, fract(along / 6.0));
          float lit = clamp((uWave - length(vWP.xz - uOrigin)) / uSpread, 0.0, 1.0);
          float on = max(lit * (1.0 - uDay), uLamps);
          totalEmissiveRadiance += (uWarm * (pool * 1.4 + kerb * 0.25) + vec3(1.0, 0.9, 0.7) * dash * 0.3) * on * uGain * 0.4;
          if (uReflOn > .5) {
            vec3 V = normalize(cameraPosition - vWP); float fr = .04 + .96 * pow(1. - abs(V.y), 5.);
            vec2 wob = (vec2(gn(vWP.xz * 2.1), gn(vWP.xz * 2.1 + 7.)) - .5) * .006 * (1. - pud);
            vec4 rc = uReflMat * vec4(vWP, 1.); vec2 ruv = rc.xy / rc.w + wob;
            vec3 rf = (texture2D(tRefl, ruv).rgb * .45 + texture2D(tRefl, ruv + vec2(0., .006)).rgb * .35 + texture2D(tRefl, ruv + vec2(0., .016)).rgb * .2);
            totalEmissiveRadiance += rf * (pud * mix(.35, 1., fr) + damp * .35 * fr) * .95;
          }`);
    };
    const ground = this.ground = new THREE.Mesh(new THREE.PlaneGeometry(span, span), gmat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.userData.noReflect = true; S.add(ground);
    // rooftop beacons (additive points), lit by the wave; blink on uBlink
    this.tops = tops;
    if (beacons && tops.length) {
      const g = new THREE.BufferGeometry(), pos = new Float32Array(tops.length * 3);
      tops.forEach((b, i) => pos.set([b[0], b[1] + 1.5, b[2]], i * 3)); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aOrder', new THREE.BufferAttribute(new Float32Array(tops.map(b => Math.hypot(b[0] - origin[0], b[2] - origin[1]))), 1));
      g.setAttribute('aPh', new THREE.BufferAttribute(new Float32Array(tops.map(b => b[3])), 1));
      this.beaconMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { ...U, uSize: { value: 26 }, uBlink: { value: 0 } },
        vertexShader: `attribute float aOrder; attribute float aPh; uniform float uWave, uT, uSize, uBlink; varying float vA;
          void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mv;
            float on = step(aOrder, uWave); float bl = step(.5, fract(uT * 0.8 + aPh)) * (1. - uBlink) + uBlink;
            vA = on * bl; gl_PointSize = uSize * 300. / -mv.z * (0.6 + 0.4 * uBlink); }`,
        fragmentShader: `varying float vA; void main(){ vec2 d = gl_PointCoord - .5; float r = length(d); float a = exp(-r * r * 40.) + exp(-r * r * 6.) * .25;
          gl_FragColor = vec4(vec3(1., .12, .1) * a * vA * 3., 1.); }` });
      this.beacons = new THREE.Points(g, this.beaconMat); this.beacons.frustumCulled = false; S.add(this.beacons);
    }
    // street lamps: a sodium head every 18 m along both kerbs of every street within lampR of the origin
    if (lamps) {
      const L = [];
      const nL = Math.max(nx, nz);
      for (let i = -nL / 2; i <= nL / 2; i++) { const c = i * pitch;
        for (let s2 = -lampR; s2 <= lampR; s2 += 18) for (const side of [-1, 1]) {
          const off = side * street * 0.42;
          if (Math.hypot(c - origin[0], s2 - origin[1]) < lampR) L.push(c + off, 7, s2 + 9);
          if (Math.hypot(s2 - origin[0], c - origin[1]) < lampR) L.push(s2 + 9, 7, c + off);
        } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(L), 3));
      this.lampMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { ...U, uOrigin: { value: new THREE.Vector2(...origin) } },
        vertexShader: `uniform float uWave, uSpread, uDay, uLamps; uniform vec2 uOrigin; varying float vA;
          void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mv;
            vA = max(clamp((uWave - length(position.xz - uOrigin)) / uSpread, 0., 1.) * (1. - uDay), uLamps); gl_PointSize = 260. / -mv.z; }`,
        fragmentShader: `varying float vA; uniform vec3 uWarm; void main(){ vec2 d = gl_PointCoord - .5; float r = dot(d, d); float a = exp(-r * 60.) + exp(-r * 10.) * .2;
          gl_FragColor = vec4(uWarm * a * vA * 2.2, 1.); }` });
      this.lamps = new THREE.Points(g, this.lampMat); this.lamps.frustumCulled = false; S.add(this.lamps);
    }
    // traffic: light streams along the streets (heads cream, tails red), each a short additive streak
    if (traffic) {
      const g = new THREE.BufferGeometry(), N = traffic, pos = new Float32Array(N * 3), a = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) {
        const alongX = R() < 0.5, lane = Math.floor((R() - 0.5) * Math.max(nx, nz));
        a.set([alongX ? 1 : 0, lane * pitch + (R() < 0.5 ? -1 : 1) * street * 0.22, R() * 2000, R() < 0.5 ? 1 : -1], i * 4);
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCar', new THREE.BufferAttribute(a, 4));
      this.trafficMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { ...U, uSpan: { value: Math.max(nx, nz) * pitch }, uPitch: { value: pitch }, uSpeed: { value: 14 }, uOrigin: { value: new THREE.Vector2(...origin) } },
        vertexShader: `attribute vec4 aCar; uniform float uT, uSpan, uPitch, uSpeed, uWave, uSpread, uLamps; uniform vec2 uOrigin; varying float vA; varying float vDir;
          void main(){ float s = mod(aCar.z + uT * uSpeed * aCar.w, uSpan) - uSpan * .5; float l = aCar.y + uPitch * .5;
            vec3 p = aCar.x > .5 ? vec3(s, .8, l) : vec3(l, .8, s);
            vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
            vA = max(clamp((uWave - length(p.xz - uOrigin)) / uSpread, 0., 1.), uLamps * .8); vDir = aCar.w; gl_PointSize = 900. / -mv.z; }`,
        fragmentShader: `varying float vA; varying float vDir; void main(){ vec2 d = gl_PointCoord - .5; float a = exp(-dot(d, d) * 30.);
          vec3 c = vDir > 0. ? vec3(1., .9, .75) : vec3(1., .1, .06); gl_FragColor = vec4(c * a * vA * 1.4, 1.); }` });
      this.traffic = new THREE.Points(g, this.trafficMat); this.traffic.frustumCulled = false; S.add(this.traffic);
    }
  }
  // wave: radius (m) from origin inside which windows are lit; day: 0 night .. 1 day (windows fade); redPulse: flash red floors;
  // blink: 1 = all beacons on; lamps: street lamps + shopfronts on everywhere 0..1 (dusk); wet: puddle amount 0..1
  update(t, { wave = 1e5, spread = 140, day = 0, gain = 3, redPulse = 0, blink = 0, lamps = 0, wet = null } = {}) {
    const U = this.uniforms; U.uWave.value = wave; U.uSpread.value = spread; U.uDay.value = day; U.uGain.value = gain; U.uT.value = t; U.uRedPulse.value = redPulse; U.uLamps.value = lamps;
    if (wet != null) U.uWet.value = wet;
    if (this.beaconMat) { this.beaconMat.uniforms.uBlink.value = blink; }
  }
}

// ------------------------------------------------------------------ SDF layer: an sdf.js structure inside a three.js world
// new SDF({ world, handoff: true, ... }) writes colour over packed log depth; SDFLayer draws it as a full-screen pass that
// writes gl_FragDepth from the SDF's ray distance, so three.js geometry and the raymarched hero occlude each other.
// Render the SDF with the same rig value first (sdf.render(t, { cam, ... })), then layer.update(); world.render(cam).
// The SDF has no GROUND (the three.js ground shows), is not reflected in puddles and casts no three.js shadows.
export class SDFLayer {
  constructor(world, sdf) {
    this.sdf = sdf;
    const tex = this.tex = new THREE.CanvasTexture(sdf.canvas); tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mat = new THREE.ShaderMaterial({ depthTest: true, depthWrite: true, fog: false, toneMapped: false,
      uniforms: { map: { value: tex }, res: { value: new THREE.Vector2(1, 1) }, sz: { value: new THREE.Vector2(sdf.w, sdf.h) }, lnK: { value: Math.log(sdf.far * 20) }, proj: { value: new THREE.Matrix4() } },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: `uniform sampler2D map; uniform vec2 res, sz; uniform float lnK; uniform mat4 proj;
        void main(){ vec2 uv = gl_FragCoord.xy / res; vec4 k = texelFetch(map, ivec2(uv * sz), 0);
          float l = k.r + k.g / 255.; if (l > .995) discard;
          float t = .1 * exp(l * lnK);
          vec2 ndc = uv * 2. - 1.; vec3 vd = normalize(vec3(ndc.x / proj[0][0], ndc.y / proj[1][1], -1.));
          vec4 c = proj * vec4(vd * t, 1.); gl_FragDepth = clamp(c.z / c.w * .5 + .5, 0., 1.);
          gl_FragColor = vec4(texture(map, vec2(uv.x, .5 + uv.y * .5)).rgb, 1.); }` });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.userData.noReflect = true; this.mesh.renderOrder = 1;
    world.scene.add(this.mesh); this.world = world;
    world.onBefore.push((cam) => { const r = world.renderer.getDrawingBufferSize(new THREE.Vector2()); this.mat.uniforms.res.value.copy(r); this.mat.uniforms.proj.value.copy(cam.projectionMatrix); });
  }
  update() { this.tex.needsUpdate = true; }
  set visible(v) { this.mesh.visible = v; }
}

// ------------------------------------------------------------------ Terrain
export class Terrain {
  constructor(world, { size = 3000, seg = 256, amp = 120, scale = 0.0015, seed = 3, flat = 0, flatR = 0, colors = ['#2a2420', '#5a4a3c', '#9a8c7c'], flatShading = true, center = [0, 0] } = {}) {
    const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
    const P = g.attributes.position, col = new Float32Array(P.count * 3), cs = colors.map(c => new THREE.Color(c));
    this.h = (x, z) => { const r = Math.hypot(x - center[0], z - center[1]); const k = flatR ? smooth(clamp((r - flatR) / (flatR * 1.5))) : 1;
      const v = fbm2(x * scale + seed * 13.1, z * scale - seed * 7.7, 5); const ridge = 1 - Math.abs(noise2(x * scale * 2.1, z * scale * 2.1) * 2 - 1);
      return (Math.pow(v, 1.6) * amp * 1.6 + ridge * amp * 0.25) * k + flat; };
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i), y = this.h(x, z); P.setY(i, y);
      const u = clamp(y / (amp * 1.2)); const c = u < 0.5 ? cs[0].clone().lerp(cs[1], u * 2) : cs[1].clone().lerp(cs[2], (u - 0.5) * 2);
      const n = 0.85 + 0.3 * noise2(x * 0.05, z * 0.05); col.set([c.r * n, c.g * n, c.b * n], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
    this.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading }));
    this.mesh.receiveShadow = true; this.mesh.castShadow = true; world.scene.add(this.mesh);
  }
}

// ------------------------------------------------------------------ Figures
// Crowds. Default (skinned: true): lib/fx/people.js GPU-skinned workers (5 trades, 3 LODs chosen by projected height, walk /
// stand / work / fist / march acts), posed on the CPU before every World.render. skinned: false keeps the old instanced
// capsule people (cheapest, reads only as specks). place(i, x, y, z, heading, phase, s, act): heading in radians about +y
// (0 faces +z), phase = stride phase (rad; ~5.6 rad/s at walking pace) or seconds for 'stand' / 'fist'.
export class Figures {
  constructor(world, n = 200, { skinned = true, trades = ['steel', 'rail', 'overalls', 'weld', 'farm'], seed = 1, budget = [10, 80], lodPx = [260, 90],
    suit = '#f2c418', helmet = '#e8e2d0', pack = '#6a6a60', scale = 1, dark = 0 } = {}) {
    this.n = n; this.world = world;
    if (skinned) {
      const viewH = Math.round(world.h * world.scale);
      this.people = new People(world.scene, { max: n, viewH, budget, lodPx });
      for (let i = 0; i < n; i++) { const d = People.random(trades[i % trades.length], seed * 1009 + i);
        if (dark) { const c = new THREE.Color(); for (const k of ['top', 'bottom', 'hatColor']) d[k] = '#' + c.set(d[k]).multiplyScalar(1 - dark).getHexString(); }
        this.people.add(d); }
      world.onBefore.push(cam => this.people.update(cam));
      return;
    }
    const parts = [];
    const add = (g, c, tx, ty, tz) => { g.translate(tx, ty, tz); const col = new THREE.Color(c), a = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < a.length; i += 3) a.set([col.r, col.g, col.b], i); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.index) g = g.toNonIndexed(); g.deleteAttribute('uv'); parts.push(g); };
    add(new THREE.CapsuleGeometry(0.27, 0.5, 3, 8), suit, 0, 1.22, 0);
    add(new THREE.SphereGeometry(0.19, 10, 8), helmet, 0.02, 1.7, 0);
    add(new THREE.BoxGeometry(0.22, 0.5, 0.42), pack, -0.3, 1.25, 0);
    add(new THREE.CapsuleGeometry(0.11, 0.7, 2, 6), suit, 0, 0.45, 0.13);
    add(new THREE.CapsuleGeometry(0.11, 0.7, 2, 6), suit, 0, 0.45, -0.13);
    add(new THREE.CapsuleGeometry(0.08, 0.5, 2, 6), suit, 0.05, 1.1, 0.34);
    add(new THREE.CapsuleGeometry(0.08, 0.5, 2, 6), suit, 0.05, 1.1, -0.34);
    const geo = mergeGeometries(parts); geo.scale(scale, scale, scale);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), n);
    this.mesh.castShadow = this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; world.scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
  }
  place(i, x, y, z, heading = 0, phase = 0, s = 1, act = 'walk', extra = null) {
    if (this.people) { this.people.set(i, { x, y, z, heading, act, ph: phase, t: phase, visible: s > 0, ...(extra || {}) }); return; }
    this._e.set(0, heading - Math.PI / 2, Math.sin(phase) * 0.06); this._q.setFromEuler(this._e);
    this._m.compose(new THREE.Vector3(x, y + Math.abs(Math.sin(phase)) * 0.05, z), this._q, new THREE.Vector3(s, s, s)); this.mesh.setMatrixAt(i, this._m);
  }
  commit() { if (this.mesh) this.mesh.instanceMatrix.needsUpdate = true; }
}

// ------------------------------------------------------------------ cheap 2D bloom
// Thresholds the frame at 1/4 res (contrast/brightness filter), blurs two mips, adds them back ('lighter').
const _g = {};
export function glow(ctx, src = ctx.canvas, { amount = 0.8, threshold = 0.55, radius = 1, tint = null, w = ctx.canvas.width, h = ctx.canvas.height } = {}) {
  const mk = (k, cw, ch) => { if (!_g[k] || _g[k].width !== cw) { const c = document.createElement('canvas'); c.width = cw; c.height = ch; _g[k] = c; } return _g[k]; };
  const a = mk('a', w >> 2, h >> 2), b = mk('b', w >> 3, h >> 3), ag = a.getContext('2d'), bg = b.getContext('2d');
  const c = 1 / Math.max(0.05, 1 - threshold);
  ag.filter = `brightness(${(1 / c).toFixed(3)}) contrast(${(c * 1.2).toFixed(2)}) saturate(1.3) blur(${(3 * radius).toFixed(1)}px)`;
  ag.globalCompositeOperation = 'copy'; ag.drawImage(src, 0, 0, a.width, a.height); ag.filter = 'none';
  bg.filter = `blur(${(4 * radius).toFixed(1)}px)`; bg.globalCompositeOperation = 'copy'; bg.drawImage(a, 0, 0, b.width, b.height); bg.filter = 'none';
  if (tint) { for (const [g2, cv] of [[ag, a], [bg, b]]) { g2.globalCompositeOperation = 'multiply'; g2.fillStyle = tint; g2.fillRect(0, 0, cv.width, cv.height); g2.globalCompositeOperation = 'source-over'; } }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = amount * 0.6; ctx.drawImage(a, 0, 0, w, h);
  ctx.globalAlpha = amount; ctx.drawImage(b, 0, 0, w, h);
  ctx.restore();
}

function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
