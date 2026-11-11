// ART kit / EXPOSURE (cycle 2, change A): the hot thing is the light, and the frame is EXPOSED like film.
//
// In every reference frame (Steel: Man's Servant 1938 Technicolor; Master Hands 1936) the pour over-exposes the film:
// its core clips to a chrome-yellow white, only thin/cooling metal stays orange, and the smoke over it is the largest
// bright area. A clamp at 1.0 (what the c1 kit did) cannot do that: it paints the stream as an orange emissive tube.
// So the 3D renders SCENE-REFERRED (half-float target, metal core at 20-80, skin and beads 3-10, arc ~200) and a film
// response maps it to display values. Halation and veiling glare are made from the real over-range energy only.
//
//   import { FilmExposure, CURVES, filmCurve, gradePlate } from '../lib/fx/art/exposure.js';
//   const fx = new FilmExposure(st.r, { W: 1080, H: 1920, curve: 'technicolor38' });
//   const canvas = fx.render(st.scene, st.camera, t);      // the renderer's canvas, exposed and graded
//   gradePlate(dstCanvas, footageCanvas, { curve: 'technicolor38' });   // a found-footage insert matched to the 3D
//
// The curves were fitted to the reference frames in review/studio_art_c2/before/ref (luma percentiles and the colour of
// the clipped and mid areas, measured on steel_1120/1250/0510 and mh2_pour, every 4th frame):
//   technicolor38: black floor 0.022-0.034 (not 0), clipped highs (0.84, 0.89, 0.60-0.76) = a chrome-yellow white,
//                  mids (0.60, 0.51, 0.18) = saturated amber; p50 0.10-0.30. Per-channel shoulders make an orange
//                  scene value turn yellow then white as it rises (R clips first, then G, then B): the film's hue shift.
//   ortho36:       orthochromatic B&W (red-blind: weights on green and blue), black 0.0-0.07, white 0.92-0.94 neutral.
import * as THREE from 'three';
import { fpPatchScene } from '../figure_pass.js';

export const CURVES = {
  // shoulder: Hable white point (scene value that maps to the film's white); lift/white per channel (display);
  // sat: saturation applied in scene space before the curve; toe: power on the display value (contrast in the darks)
  technicolor38: { W: 14, lift: [0.034, 0.026, 0.018], white: [0.90, 0.905, 0.74], sat: 1.28, toe: 1.12, mix: [1, 1, 1], halo: [1.0, 0.52, 0.2] },
  ortho36: { W: 10, lift: [0.035, 0.034, 0.03], white: [0.93, 0.925, 0.9], sat: 0, toe: 1.05, mix: [0.12, 0.5, 0.38], halo: [1, 0.95, 0.88] },
  // the storm: cold, a longer toe (night is the point), whites stay neutral-cool
  night: { W: 18, lift: [0.018, 0.02, 0.026], white: [0.9, 0.93, 0.96], sat: 0.9, toe: 1.2, mix: [1, 1, 1], halo: [0.9, 0.95, 1.0] },
};

const hable = x => ((x * (0.15 * x + 0.05) + 0.004) / (x * (0.15 * x + 0.5) + 0.06)) - 0.0667;
// JS mirror of the shader curve (for 2D plates and for tests): scene-linear rgb -> display rgb in 0..1
export function filmCurve(rgb, name = 'technicolor38', out = [0, 0, 0]) {
  const C = CURVES[name]; let [r, g, b] = rgb;
  if (C.sat === 0) { const L = r * C.mix[0] + g * C.mix[1] + b * C.mix[2]; r = g = b = L; }
  else { const L = 0.2126 * r + 0.7152 * g + 0.0722 * b; r = L + (r - L) * C.sat; g = L + (g - L) * C.sat; b = L + (b - L) * C.sat; }
  const wn = 1 / hable(C.W);
  [r, g, b].forEach((v, i) => { const f = Math.min(1, Math.max(0, hable(Math.max(0, v) * 2) * wn)); out[i] = C.lift[i] + (C.white[i] - C.lift[i]) * Math.pow(f, C.toe); });
  return out;
}

const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const quad = mat => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2)); const m = new THREE.Mesh(g, mat); m.frustumCulled = false; return m; };

export class FilmExposure {
  constructor(renderer, { W = 1080, H = 1920, curve = 'technicolor38', exposure = 1, halation = 0.55, veil = 0.06, grain = 0.35, samples = 4, weave = 0, flicker = 0 } = {}) {
    Object.assign(this, { R: renderer, W, H, curve, exposure, halation, veil, grain, weave, flicker });
    const rt = (w, h, s = 0) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples: s, depthBuffer: s > 0 || w === W, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.hdr = rt(W, H, samples);
    const q = [Math.round(W / 4), Math.round(H / 4)], s16 = [Math.round(W / 16), Math.round(H / 16)];
    this.a = rt(...q); this.b = rt(...q); this.c = rt(...s16); this.d = rt(...s16);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); this.sc = new THREE.Scene();
    this.mThr = new THREE.ShaderMaterial({ uniforms: { src: { value: null }, uTh: { value: 1.0 }, uPx: { value: new THREE.Vector2(1 / W, 1 / H) } }, vertexShader: FS_VERT, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D src; uniform float uTh; uniform vec2 uPx; varying vec2 vUv;
        void main(){ vec3 s = vec3(0.0); for (int j = -1; j <= 2; j++) for (int i = -1; i <= 2; i++) s += texture2D(src, vUv + vec2(float(i) - 0.5, float(j) - 0.5) * uPx).rgb;
          s /= 16.0; float L = dot(s, vec3(0.2126, 0.7152, 0.0722)); gl_FragColor = vec4(s * max(0.0, L - uTh) / max(L, 1e-4), 1.0); }` });
    this.mBlur = new THREE.ShaderMaterial({ uniforms: { src: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: FS_VERT, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D src; uniform vec2 uDir; varying vec2 vUv;
        void main(){ vec3 s = vec3(0.0); float w = 0.0; for (int i = -12; i <= 12; i++) { float k = exp(-float(i * i) / 50.0); s += texture2D(src, vUv + uDir * float(i)).rgb * k; w += k; } gl_FragColor = vec4(s / w, 1.0); }` });
    const C = CURVES[curve];
    this.uni = { src: { value: null }, hal: { value: null }, veilT: { value: null }, uExp: { value: exposure }, uHal: { value: halation }, uVeil: { value: veil }, uGrain: { value: grain },
      uSeed: { value: 0 }, uW: { value: C.W }, uLift: { value: new THREE.Vector3(...C.lift) }, uWhite: { value: new THREE.Vector3(...C.white) }, uSat: { value: C.sat }, uToe: { value: C.toe },
      uMix: { value: new THREE.Vector3(...C.mix) }, uHaloC: { value: new THREE.Vector3(...C.halo) }, uFlick: { value: 1 }, uWeave: { value: new THREE.Vector2() }, uAspect: { value: W / H } };
    this.mOut = new THREE.ShaderMaterial({ uniforms: this.uni, vertexShader: FS_VERT, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */`
        uniform sampler2D src, hal, veilT; uniform float uExp, uHal, uVeil, uGrain, uSeed, uW, uSat, uToe, uFlick, uAspect; uniform vec3 uLift, uWhite, uMix, uHaloC; uniform vec2 uWeave; varying vec2 vUv;
        vec3 hable(vec3 x){ return ((x * (0.15 * x + 0.05) + 0.004) / (x * (0.15 * x + 0.5) + 0.06)) - 0.0667; }
        float hh(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
        void main(){
          vec2 uv = vUv + uWeave;
          vec3 c = texture2D(src, uv).rgb;
          vec3 h1 = texture2D(hal, uv).rgb, h2 = texture2D(veilT, uv).rgb;
          // halation: light scattered back through the emulsion from the film base: red-orange, tight; veil: wide, neutral
          c += h1 * uHaloC * uHal + h2 * uVeil;
          c *= uExp * uFlick;
          if (uSat == 0.0) { float L = dot(c, uMix); c = vec3(L); }
          else { float L = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = max(vec3(0.0), L + (c - L) * uSat); }
          vec3 f = clamp(hable(c * 2.0) / hable(vec3(uW)), 0.0, 1.0);
          f = pow(f, vec3(uToe));
          vec3 d = uLift + (uWhite - uLift) * f;
          // grain: strongest in the mids, on twos (seed changes every other frame), 1-2 px clumps
          vec2 gp = floor(vUv * vec2(540.0, 540.0 / uAspect) * 1.0);
          float n = hh(gp + uSeed * 17.0) + hh(gp * 1.7 + uSeed * 5.0) - 1.0;
          float Ld = dot(d, vec3(0.2126, 0.7152, 0.0722));
          d += n * uGrain * 0.09 * (0.25 + Ld * (1.0 - Ld) * 3.0);
          gl_FragColor = vec4(clamp(d, 0.0, 1.0), 1.0);
        }` });
    this.q = quad(this.mThr); this.sc.add(this.q);
    this.stats = { ms: 0 };
  }
  pass(mat, target) { this.q.material = mat; this.R.setRenderTarget(target); this.R.render(this.sc, this.cam); }
  // render a scene exposed: returns the renderer's canvas
  render(scene, camera, t = 0, { exposure = null } = {}) {
    const R = this.R, t0 = performance.now(), tm = R.toneMapping, ac = R.autoClear;
    fpPatchScene(scene);
    R.setClearColor(0x000000, 1); R.setRenderTarget(this.hdr); R.clear(); R.render(scene, camera);
    // over-range energy only (scene > 1): halation (1/4 res) and the veil (1/16 res)
    this.mThr.uniforms.src.value = this.hdr.texture; this.mThr.uniforms.uPx.value.set(1 / this.W, 1 / this.H); this.pass(this.mThr, this.a);
    const blur = (s, d, dx, dy) => { this.mBlur.uniforms.src.value = s.texture; this.mBlur.uniforms.uDir.value.set(dx / s.width, dy / s.height); this.pass(this.mBlur, d); };
    blur(this.a, this.b, 1, 0); blur(this.b, this.a, 0, 1);
    this.mThr.uniforms.src.value = this.a.texture; this.mThr.uniforms.uPx.value.set(1 / this.a.width, 1 / this.a.height); this.mThr.uniforms.uTh.value = 0.0; this.pass(this.mThr, this.c); this.mThr.uniforms.uTh.value = 1.0;
    blur(this.c, this.d, 2, 0); blur(this.d, this.c, 0, 2);
    const U = this.uni; U.src.value = this.hdr.texture; U.hal.value = this.a.texture; U.veilT.value = this.c.texture;
    U.uExp.value = exposure ?? this.exposure; U.uSeed.value = Math.floor(t * 15 + 1e-6) % 997;
    U.uFlick.value = this.flicker ? 1 + this.flicker * (Math.sin(t * 15 * 2.1) * 0.5 + Math.sin(t * 15 * 0.77) * 0.5) : 1;
    U.uWeave.value.set(this.weave * Math.sin(Math.floor(t * 15) * 1.7) / this.W, this.weave * Math.cos(Math.floor(t * 15) * 2.3) / this.H);
    this.pass(this.mOut, null);
    R.toneMapping = tm; R.autoClear = ac;
    this.stats.ms = performance.now() - t0;
    return R.domElement;
  }
  setCurve(name) { const C = CURVES[name], U = this.uni; this.curve = name; U.uW.value = C.W; U.uLift.value.set(...C.lift); U.uWhite.value.set(...C.white); U.uSat.value = C.sat; U.uToe.value = C.toe; U.uMix.value.set(...C.mix); U.uHaloC.value.set(...C.halo); }
}

// a found-footage plate graded to cut with the 3D: the frame is decoded to an approximate scene value (inverse of a
// generic video gamma plus a mild shoulder inverse), then printed through the same film curve. Canvas in, canvas out.
// crop: [x, y, w, h] in the source (a 9:16 window of a 4:3 frame), fit to dst. gain: exposure in stops.
export function gradePlate(dst, src, { curve = 'technicolor38', crop = null, gain = 0, sat = 1, t = 0, grain = 0.35 } = {}) {
  const w = dst.width, h = dst.height, g = dst.getContext('2d', { willReadFrequently: true });
  const [sx, sy, sw, sh] = crop || [0, 0, src.width, src.height];
  g.imageSmoothingQuality = 'high'; g.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  const im = g.getImageData(0, 0, w, h), D = im.data, lut = new Float32Array(256), k = Math.pow(2, gain);
  for (let i = 0; i < 256; i++) { const v = i / 255, lin = Math.pow(v, 2.2); lin; lut[i] = (lin / Math.max(0.05, 1.04 - lin)) * 1.4 * k; }   // undo the shoulder: highs open up
  const o3 = [0, 0, 0], rgb = [0, 0, 0], cache = new Map();
  let seed = Math.floor(t * 15) * 7919 + 13;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let p = 0; p < D.length; p += 4) {
    // 6-bit cache key with a 2x2 ordered dither (PRINTLAB c1): the cache stays small, and the 64-level steps that
    // banded smooth ramps (256 -> 104 levels on the critic's chart) become a sub-grain dither instead
    const px = (p >> 2) % w, py = ((p >> 2) / w) | 0, dth = [0, 2, 3, 1][(px & 1) | ((py & 1) << 1)];
    const q0 = Math.min(255, D[p] + dth) >> 2, q1 = Math.min(255, D[p + 1] + dth) >> 2, q2 = Math.min(255, D[p + 2] + dth) >> 2;
    const key = q0 << 12 | q1 << 6 | q2;
    let v = cache.get(key);
    if (!v) { rgb[0] = lut[q0 << 2]; rgb[1] = lut[q1 << 2]; rgb[2] = lut[q2 << 2];
      if (sat !== 1) { const L = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]; for (let c = 0; c < 3; c++) rgb[c] = Math.max(0, L + (rgb[c] - L) * sat); }
      filmCurve(rgb, curve, o3); v = [o3[0] * 255, o3[1] * 255, o3[2] * 255]; cache.set(key, v); }
    const L = (v[0] + v[1] + v[2]) / 765, n = (rnd() + rnd() - 1) * grain * 22 * (0.25 + L * (1 - L) * 3);
    D[p] = v[0] + n; D[p + 1] = v[1] + n; D[p + 2] = v[2] + n;
  }
  g.putImageData(im, 0, 0); return dst;
}
