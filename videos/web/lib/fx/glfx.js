// GLFX: the small shared GL layer under atmos.js, paint.js and fields.js (the "shaders2" family).
// It runs full-screen GLSL3 passes on an existing three.js WebGLRenderer, so a three.js scene's own HDR target and
// depth feed the passes with no readback, and a 2D canvas can come in as a texture.
//
//   const fx = new Passes(world.renderer);
//   const rt = fx.target('glow', 270, 480);                            // cached by name; half-float, linear, clamp
//   fx.run('blur', FRAG, { tSrc: rt0.texture, uDir: [1, 0] }, rt);      // frag body: in vec2 vUv; out vec4 o;
//   fx.run('final', FRAG2, { ... }, null);                              // null = the canvas
//   fx.canvasTexture(ctx.canvas)                                        // a 2D canvas as an sRGB texture (refreshed per call)
//
// Also exports GLSL snippets shared by the family: NOISE (hash, value/gradient noise, fbm, Quilez domain warp,
// curl), TONE (ACES fitted, AgX-ish punch, sRGB encode, luma) and HG (Henyey-Greenstein phase).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
export { THREE };

const VERT = `in vec3 position; in vec2 uv; out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const NOISE = /* glsl */`
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 h22(vec2 p){ vec3 a = fract(p.xyx * vec3(123.34, 234.34, 345.65)); a += dot(a, a + 34.45); return fract(vec2(a.x * a.y, a.y * a.z)); }
float h31(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float vnoise3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
float gnoise(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  vec2 ga = h22(i) * 2.0 - 1.0, gb = h22(i + vec2(1, 0)) * 2.0 - 1.0, gc = h22(i + vec2(0, 1)) * 2.0 - 1.0, gd = h22(i + vec2(1, 1)) * 2.0 - 1.0;
  return 0.5 + 0.7 * mix(mix(dot(ga, f), dot(gb, f - vec2(1, 0)), u.x), mix(dot(gc, f - vec2(0, 1)), dot(gd, f - vec2(1, 1)), u.x), u.y); }
const mat2 ROT_FBM = mat2(0.8, 0.6, -0.6, 0.8);
float fbm(vec2 p, int oct){ float s = 0.0, a = 0.5; for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a * gnoise(p); p = ROT_FBM * p * 2.03 + 17.1; a *= 0.5; } return s; }
float ridged(vec2 p, int oct){ float s = 0.0, a = 0.5; for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a * (1.0 - abs(gnoise(p) * 2.0 - 1.0)); p = ROT_FBM * p * 2.07 + 5.3; a *= 0.5; } return s; }
// Quilez domain warp: f(p + k q(p + k r(p))); returns the value, writes q and r (useful as colour drivers)
float warp(vec2 p, float k, float t, out vec2 q, out vec2 r){
  q = vec2(fbm(p + vec2(0.0, 0.0) + 0.05 * t, 5), fbm(p + vec2(5.2, 1.3) - 0.04 * t, 5));
  r = vec2(fbm(p + k * q + vec2(1.7, 9.2) + 0.12 * t, 5), fbm(p + k * q + vec2(8.3, 2.8) + 0.1 * t, 5));
  return fbm(p + k * r, 6); }
vec2 curl(vec2 p){ float e = 0.01; float a = fbm(p + vec2(0, e), 4), b = fbm(p - vec2(0, e), 4), c = fbm(p + vec2(e, 0), 4), d = fbm(p - vec2(e, 0), 4);
  return vec2(a - b, -(c - d)) / (2.0 * e); }
`;

export const TONE = /* glsl */`
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 aces(vec3 x){ x *= 0.6; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 srgb(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 lin(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 sat(vec3 c, float s){ float l = luma(c); return max(vec3(0.0), mix(vec3(l), c, s)); }
`;
export const HG = /* glsl */`float hg(float c, float g){ float g2 = g * g; return (1.0 - g2) / (12.566 * pow(max(1e-4, 1.0 + g2 - 2.0 * g * c), 1.5)); }`;

// every pass reads its textures through _fin (5 Oct): on the farm's NVIDIA GPUs a NaN or an overflowed half-float (> 65504) in the scene
// buffer came out of the blurs and bloom as black blocks (GIANT's heads) and out of the grade as white flashes (LADDER's tower face);
// SwiftShader never made them. NaN -> 0, +-Inf -> +-6e4. (A function-like macro is not re-expanded inside its own expansion.)
export const FIN_GLSL = `vec4 _fin(vec4 c){ return clamp(vec4(isnan(c.x) ? 0. : c.x, isnan(c.y) ? 0. : c.y, isnan(c.z) ? 0. : c.z, isnan(c.w) ? 0. : c.w), -6e4, 6e4); }
#define texture(s, uv) _fin(texture(s, uv))`;
export class Passes {
  constructor(renderer) {
    this.r = renderer; this.quad = new FullScreenQuad(); this.mats = new Map(); this.rts = new Map(); this.tex = new Map();
    this.stats = {}; this.profile = false;
  }
  // a cached render target; opts: { type: 'half'|'byte'|'float', filter: 'linear'|'nearest', depth: bool, samples }
  target(name, w, h, { type = 'half', filter = 'linear', depth = false, samples = 0, wrap = 'clamp' } = {}) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    let rt = this.rts.get(name);
    if (rt && rt.width === w && rt.height === h) return rt;
    if (rt) rt.dispose();
    const f = filter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
    rt = new THREE.WebGLRenderTarget(w, h, { type: type === 'byte' ? THREE.UnsignedByteType : type === 'float' ? THREE.FloatType : THREE.HalfFloatType,
      minFilter: f, magFilter: f, depthBuffer: depth, samples, wrapS: wrap === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
      wrapT: wrap === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping });
    if (depth === 'texture') { rt.depthTexture = new THREE.DepthTexture(w, h); rt.depthTexture.type = THREE.UnsignedIntType; }
    this.rts.set(name, rt); return rt;
  }
  // run a pass. frag = GLSL3 body (declare your own uniforms; vUv and `out vec4 o` are provided). uniforms: plain
  // values (number, [x,y], [x,y,z], [x,y,z,w], THREE.Texture, THREE.Color, Matrix4, Vector*). target: RT or null.
  run(key, frag, uniforms = {}, target = null, { blending = 'none', clear = false } = {}) {
    const t0 = this.profile ? performance.now() : 0;
    let m = this.mats.get(key);
    if (!m) {
      const U = {}; for (const k in uniforms) U[k] = { value: null };
      m = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, uniforms: U, depthTest: false, depthWrite: false,
        fragmentShader: `precision highp float; precision highp int; precision highp sampler2D;\nin vec2 vUv; out vec4 o;\n${FIN_GLSL}\n${frag}` });
      this.mats.set(key, m);
    }
    m.blending = blending === 'add' ? THREE.AdditiveBlending : THREE.NoBlending; m.transparent = blending !== 'none';
    for (const k in uniforms) {
      let v = uniforms[k]; if (!m.uniforms[k]) m.uniforms[k] = { value: null };
      if (Array.isArray(v)) v = v.length === 2 ? new THREE.Vector2(...v) : v.length === 3 ? new THREE.Vector3(...v) : v.length === 4 ? new THREE.Vector4(...v) : v;
      m.uniforms[k].value = v;
    }
    this.quad.material = m;
    const r = this.r, prevT = r.getRenderTarget(), ac = r.autoClear;
    r.setRenderTarget(target); r.autoClear = clear; this.quad.render(r); r.autoClear = ac; r.setRenderTarget(prevT);
    if (this.profile) { this.sync(); this.stats[key] = (this.stats[key] || 0) + performance.now() - t0; }
    return target;
  }
  // separable gaussian-ish blur (9 taps, linear-sampled) of src into dst via a temp; radius in dst texels
  blur(name, src, dst, radius = 1) {
    const tmp = this.target(name + '_tmp', dst.width, dst.height);
    const F = `uniform sampler2D tSrc; uniform vec2 uStep;
      void main(){ vec4 s = texture(tSrc, vUv) * 0.2270270270;
        s += (texture(tSrc, vUv + uStep * 1.3846153846) + texture(tSrc, vUv - uStep * 1.3846153846)) * 0.3162162162;
        s += (texture(tSrc, vUv + uStep * 3.2307692308) + texture(tSrc, vUv - uStep * 3.2307692308)) * 0.0702702703; o = s; }`;
    this.run('glfx_blur', F, { tSrc: src.texture || src, uStep: [radius / dst.width, 0] }, tmp);
    this.run('glfx_blur', F, { tSrc: tmp.texture, uStep: [0, radius / dst.height] }, dst);
    return dst;
  }
  // the family's finishing pass for 2D fields and paint: glow (quarter + eighth res), exposure, ACES, warm floor,
  // highlight bleach, contrast, vignette, grain, dither, sRGB -> target (null = canvas). src: HDR RT or texture.
  finish(src, { exposure = 1, glow = 0.4, threshold = 1, warm = [0, 0, 0], floor = [0, 0, 0], bleach = 0.3, highlight = [1, 0.94, 0.86], contrast = 0.1,
    saturation = 1, vignette = 0.3, grain = 0.03, t = 0, tonemap = true } = {}, target = null) {
    const tex = src.texture || src, w = this.r.domElement.width, h = this.r.domElement.height;
    const a = this.target('fin_g4', w / 4, h / 4), b = this.target('fin_g4b', w / 4, h / 4), c = this.target('fin_g8', w / 8, h / 8);
    if (glow > 0) {
      this.run('fin_thr', `uniform sampler2D tS; uniform float uT; uniform vec2 uPx; void main(){ vec3 c = min(vec3(16.0), 0.25 * (texture(tS, vUv + uPx * vec2(-1.0, -1.0)).rgb + texture(tS, vUv + uPx * vec2(1.0, -1.0)).rgb + texture(tS, vUv + uPx * vec2(-1.0, 1.0)).rgb + texture(tS, vUv + uPx * vec2(1.0, 1.0)).rgb)); float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); o = vec4(c * max(l - uT, 0.0) / max(l, 1e-3), 1.0); }`, { tS: tex, uT: threshold, uPx: [1 / w, 1 / h] }, a);
      this.blur('fin_b1', a, b, 0.8); this.blur('fin_b1b', b, a, 1.0); this.blur('fin_b1c', a, b, 1.2); this.blur('fin_b2', b, c, 0.8); this.blur('fin_b2b', c, c, 1.1);
    }
    this.run('fin_out', `uniform sampler2D tS, tA, tB; uniform float uE, uG, uBl, uC, uS, uV, uGr, uTime, uTm; uniform vec3 uW, uF, uHi; ${TONE}
      float hu(uint x){ x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return float(x) / 4294967295.0; }
      void main(){ vec3 c = texture(tS, vUv).rgb + (texture(tA, vUv).rgb * 0.6 + texture(tB, vUv).rgb * 0.8) * uG;
        c *= uE; if (uTm > 0.5) c = aces(c); float l = luma(c);
        c += uW * pow(1.0 - smoothstep(0.0, 0.4, l), 2.0); c = max(c, uF);
        c = mix(c, uHi * l * 1.15, smoothstep(0.55, 1.0, l) * uBl); c = mix(c, c * c * (3.0 - 2.0 * c), uC); c = sat(c, uS);
        vec2 q = vUv - 0.5; c *= 1.0 - uV * smoothstep(0.25, 0.95, dot(q * vec2(1.0, 0.75), q * vec2(1.0, 0.75)) * 2.2);
        uvec2 ip = uvec2(gl_FragCoord.xy); uint fr = uint(uTime * 30.0 + 0.5);
        float g = hu(ip.x + 4096u * ip.y + fr * 16777259u) + hu(ip.x * 7u + 4096u * ip.y * 13u + fr * 2654435u + 99u) - 1.0;
        c += g * uGr * (0.35 + 0.65 * (1.0 - l)) * 0.5;
        o = vec4(srgb(c) + (hu(ip.x * 3u + 8192u * ip.y + 7u) - 0.5) / 255.0, 1.0); }`,
      { tS: tex, tA: glow > 0 ? b.texture : tex, tB: glow > 0 ? c.texture : tex, uG: glow, uE: exposure, uBl: bleach, uC: contrast, uS: saturation, uV: vignette, uGr: grain, uTime: t, uTm: tonemap ? 1 : 0,
        uW: warm, uF: floor, uHi: highlight }, target);
    return target;
  }
  canvasTexture(canvas, key = canvas) {
    let t = this.tex.get(key);
    if (!t) { t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.flipY = true; this.tex.set(key, t); }
    t.needsUpdate = true; return t;
  }
  sync() { const gl = this.r.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  dispose() { for (const m of this.mats.values()) m.dispose(); for (const rt of this.rts.values()) rt.dispose(); this.quad.dispose(); }
}

// project a world direction (a sun) to screen uv for a camera; returns [u, v, facing] (facing > 0: in front)
export function sunScreen(camera, dir) {
  const v = new THREE.Vector3(...dir).normalize().multiplyScalar(1e4).add(camera.position);
  const facing = new THREE.Vector3(...dir).normalize().dot(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion));
  v.project(camera); return [v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, facing];
}
