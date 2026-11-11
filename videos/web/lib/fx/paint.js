// PAINT: a painted medium for any frame (a three.js render, an Atmos composite, a 2D canvas): anisotropic Kuwahara
// filtering (the colour is laid in strokes that follow the image's own structure), bristle streaks along the stroke
// direction, impasto relief relit by a raking light, and a primed-canvas weave. It turns a CG frame into an oil
// sketch without any per-pixel CG surface surviving: the eye reads paint, not polygons (VISUAL_BIBLE: a medium over the
// surface). Stateless and pure per frame; strokes follow image structure, so motion boils only where the image changes.
//
//   import { Paint } from '../lib/fx/paint.js';
//   const paint = new Paint(renderer, { scale: 0.5 });
//   paint.apply(srcTexture, { radius: 7, sharp: 8, hard: 8, streak: 0.6, impasto: 0.7, light: [-0.6, 0.7], canvas: 0.35,
//                             stroke: 14, keep: atmos.mask /* alpha = keep the source drawing */, t }, target /* null = canvas */);
//
// References: Kyprianidis, Kang & Döllner, "Image and Video Abstraction by Anisotropic Kuwahara Filtering" (Pacific
// Graphics 2009) and the polynomial-weight sector variant (Kyprianidis 2011, GPU Pro 2); Brox/Weickert structure
// tensor; Cabral & Leedom, "Imaging Vector Fields Using Line Integral Convolution" (SIGGRAPH 1993) for the bristle streaks;
// Hertzmann's painterly rendering (1998) for the layered-stroke idea the streak scale approximates.
import * as THREE from 'three';
import { Passes, NOISE, TONE } from './glfx.js';

const F_TENSOR = /* glsl */`uniform sampler2D tSrc; uniform vec2 uPx;
void main(){
  vec3 a = texture(tSrc, vUv + vec2(-uPx.x, -uPx.y)).rgb, b = texture(tSrc, vUv + vec2(0.0, -uPx.y)).rgb, c = texture(tSrc, vUv + vec2(uPx.x, -uPx.y)).rgb;
  vec3 d = texture(tSrc, vUv + vec2(-uPx.x, 0.0)).rgb, f = texture(tSrc, vUv + vec2(uPx.x, 0.0)).rgb;
  vec3 g = texture(tSrc, vUv + vec2(-uPx.x, uPx.y)).rgb, h = texture(tSrc, vUv + vec2(0.0, uPx.y)).rgb, i = texture(tSrc, vUv + vec2(uPx.x, uPx.y)).rgb;
  vec3 gx = (-a - 2.0 * d - g + c + 2.0 * f + i) / 4.0, gy = (-a - 2.0 * b - c + g + 2.0 * h + i) / 4.0;
  o = vec4(dot(gx, gx), dot(gy, gy), dot(gx, gy), 1.0); }`;

// orientation (phi) and anisotropy (A) from a smoothed structure tensor
const EIGEN = /* glsl */`
void eig(vec3 g, out vec2 t, out float A){
  float E = g.x, G = g.y, F = g.z, D = sqrt(max((E - G) * (E - G) + 4.0 * F * F, 0.0));
  float l1 = (E + G + D) * 0.5, l2 = (E + G - D) * 0.5;
  vec2 v = vec2(l1 - E, -F); t = length(v) > 1e-6 ? normalize(v) : vec2(0.0, 1.0);
  A = (l1 + l2 > 1e-8) ? (l1 - l2) / (l1 + l2) : 0.0; }`;

const F_AKF = /* glsl */`uniform sampler2D tSrc, tTen; uniform vec2 uPx; uniform float uRadius, uAlpha, uHard, uSharp, uZeta, uEta;
${EIGEN}
void main(){
  vec2 t; float A; eig(texture(tTen, vUv).xyz, t, A);
  float phi = -atan(t.y, t.x);
  float a = uRadius * clamp((uAlpha + A) / uAlpha, 0.1, 2.0), b = uRadius * clamp(uAlpha / (uAlpha + A), 0.1, 2.0);
  float cp = cos(phi), sp = sin(phi);
  mat2 SR = mat2(0.5 / a, 0.0, 0.0, 0.5 / b) * mat2(cp, -sp, sp, cp);
  int mx = int(sqrt(a * a * cp * cp + b * b * sp * sp)), my = int(sqrt(a * a * sp * sp + b * b * cp * cp));
  vec4 m[8]; vec3 s[8];
  for (int k = 0; k < 8; k++){ m[k] = vec4(0.0); s[k] = vec3(0.0); }
  mx = min(mx, 12); my = min(my, 12);
  for (int j = -my; j <= my; j++){
    for (int i = -mx; i <= mx; i++){
      vec2 v = SR * vec2(float(i), float(j)); if (dot(v, v) > 0.25) continue;
      vec3 c = texture(tSrc, vUv + vec2(float(i), float(j)) * uPx).rgb, cc = c * c;
      float w[8]; float sum = 0.0, z, vxx, vyy;
      vxx = uZeta - uEta * v.x * v.x; vyy = uZeta - uEta * v.y * v.y;
      z = max(0.0, v.y + vxx); w[0] = z * z; z = max(0.0, -v.x + vyy); w[2] = z * z;
      z = max(0.0, -v.y + vxx); w[4] = z * z; z = max(0.0, v.x + vyy); w[6] = z * z;
      vec2 u = 0.70710678 * vec2(v.x - v.y, v.x + v.y);
      vxx = uZeta - uEta * u.x * u.x; vyy = uZeta - uEta * u.y * u.y;
      z = max(0.0, u.y + vxx); w[1] = z * z; z = max(0.0, -u.x + vyy); w[3] = z * z;
      z = max(0.0, -u.y + vxx); w[5] = z * z; z = max(0.0, u.x + vyy); w[7] = z * z;
      for (int k = 0; k < 8; k++) sum += w[k];
      float g = exp(-3.125 * dot(v, v)) / max(sum, 1e-6);
      for (int k = 0; k < 8; k++){ float wk = w[k] * g; m[k] += vec4(c * wk, wk); s[k] += cc * wk; }
    }
  }
  vec4 outc = vec4(0.0);
  vec3 fb = texture(tSrc, vUv).rgb;
  for (int k = 0; k < 8; k++){ if (m[k].w < 1e-6) continue; vec3 mu = clamp(m[k].rgb / m[k].w, 0.0, 1.0); vec3 sg = abs(s[k] / m[k].w - mu * mu);
    float sig2 = sg.r + sg.g + sg.b, wk = 1.0 / (1.0 + pow(min(uHard * 1000.0 * sig2, 1e3), 0.5 * uSharp)) + 1e-9; outc += vec4(mu * wk, wk); }
  vec3 r = outc.w > 1e-12 ? outc.rgb / outc.w : fb; if (any(isnan(r))) r = fb; o = vec4(r, 1.0); }`;

// paint height: the laid colour's value plus bristle streaks (LIC of noise along the stroke) and ridges at stroke ends
const F_HEIGHT = /* glsl */`uniform sampler2D tPaint, tTen; uniform vec2 uRes; uniform float uStroke, uStreak, uSeed;
${NOISE} ${EIGEN}
void main(){
  vec2 t; float A; eig(texture(tTen, vUv).xyz, t, A);
  vec2 dir = vec2(-t.y, t.x);                          // along the edges (the stroke direction)
  vec2 px = 1.0 / uRes; float acc = 0.0, wsum = 0.0;
  for (int i = -7; i <= 7; i++){ float w = 1.0 - abs(float(i)) / 8.0; vec2 p = vUv + dir * float(i) * uStroke * px * 0.5;
    acc += w * (vnoise(p * uRes * 0.45 + uSeed) * 0.6 + vnoise(p * uRes * 1.3 - uSeed) * 0.4); wsum += w; }
  float streak = acc / wsum;
  float v = dot(texture(tPaint, vUv).rgb, vec3(0.3, 0.5, 0.2));
  // strokes are loaded thicker in the lights (impasto highlights), thin in the darks
  float h = v * 0.55 + (streak - 0.5) * uStreak * (0.4 + 0.8 * v) + A * 0.05;
  o = vec4(h, streak, A, 1.0); }`;

const F_FINAL = /* glsl */`uniform sampler2D tPaint, tH, tSrc, tKeep; uniform vec2 uRes, uL; uniform float uImp, uCanvas, uStreakC, uSat, uSrcMix, uT, uKeep;
${NOISE} ${TONE}
float hu(uint x){ x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return float(x) / 4294967295.0; }
void main(){
  vec2 px = 1.0 / uRes;
  vec3 c = texture(tPaint, vUv).rgb;
  // keep: where the mask says so (a figure's silhouette), the source's drawing survives under the paint texture
  float kp = uKeep > 0.0 ? texture(tKeep, vUv).a * uKeep : 0.0;
  c = mix(c, texture(tSrc, vUv).rgb, max(uSrcMix, kp));
  vec4 H = texture(tH, vUv);
  float hx = texture(tH, vUv + vec2(px.x * 2.0, 0.0)).r - texture(tH, vUv - vec2(px.x * 2.0, 0.0)).r;
  float hy = texture(tH, vUv + vec2(0.0, px.y * 2.0)).r - texture(tH, vUv - vec2(0.0, px.y * 2.0)).r;
  // canvas: a plain weave, visible where paint is thin (the darks)
  vec2 q = vUv * uRes / 3.2; float weave = (sin(q.x * 3.1416) * sin(q.y * 3.1416)) * 0.5 + 0.5;
  weave = mix(weave, vnoise(q * 0.9), 0.35);
  float thin = 1.0 - smoothstep(0.1, 0.5, H.r);
  vec3 N = normalize(vec3(-hx * 10.0 * uImp, -hy * 10.0 * uImp, 1.0) + vec3((weave - 0.5) * uCanvas * thin * 0.35, 0.0, 0.0));
  vec3 L = normalize(vec3(uL, 0.8));
  float dif = clamp(dot(N, L), 0.0, 1.0), base = clamp(dot(vec3(0, 0, 1), L), 0.0, 1.0);
  float shade = clamp(mix(1.0, dif / max(base, 1e-3), 0.55 * uImp), 0.7, 1.35);
  float spec = pow(max(dot(reflect(-L, N), vec3(0, 0, 1)), 0.0), 24.0) * 0.18 * uImp * smoothstep(0.3, 0.8, H.r);
  c = c * shade + spec;
  c *= 1.0 + (H.g - 0.5) * uStreakC;                     // bristle value variation along the stroke
  c *= 1.0 - uCanvas * thin * (1.0 - weave) * 0.25;
  c = sat(c, uSat);
  uvec2 ip = uvec2(gl_FragCoord.xy);
  c += (hu(ip.x * 3u + 8192u * ip.y + uint(uT * 30.0) * 7919u) - 0.5) / 255.0;
  o = vec4(clamp(c, 0.0, 1.0), 1.0); }`;

export class Paint {
  constructor(renderer, { scale = 0.5 } = {}) { this.fx = renderer instanceof Passes ? renderer : new Passes(renderer); this.scale = scale; this.stats = {}; }
  // src: a texture (or RT) holding a display-referred (sRGB) frame
  apply(src, { radius = 6, alpha = 1, hard = 8, sharp = 8, zeta = null, eta = 0.8, tensorBlur = 2.2, stroke = 14, streak = 0.6, streakColor = 0.12,
    impasto = 0.7, light = [-0.6, 0.7], canvas = 0.35, saturation = 1.05, srcMix = 0, keep = null, keepAmount = 0.85, t = 0, seed = 1 } = {}, target = null) {
    const fx = this.fx, dom = fx.r.domElement, W = dom.width, H = dom.height, w = Math.round(W * this.scale), h = Math.round(H * this.scale);
    const tex = src.texture || src, prof = fx.profile;
    const ten = fx.target('pnt_ten', w, h), tenB = fx.target('pnt_tenB', w, h), akf = fx.target('pnt_akf', w, h, { type: 'byte' }), hgt = fx.target('pnt_h', w, h);
    fx.run('pnt_tensor', F_TENSOR, { tSrc: tex, uPx: [1 / w, 1 / h] }, ten);
    fx.blur('pnt_tb', ten, tenB, tensorBlur);
    fx.run('pnt_akf', F_AKF, { tSrc: tex, tTen: tenB.texture, uPx: [1 / w, 1 / h], uRadius: radius, uAlpha: alpha, uHard: hard, uSharp: sharp, uZeta: zeta ?? 2 / radius, uEta: eta }, akf);
    fx.run('pnt_height', F_HEIGHT, { tPaint: akf.texture, tTen: tenB.texture, uRes: [w, h], uStroke: stroke * this.scale, uStreak: streak, uSeed: seed * 17.3 }, hgt);
    fx.run('pnt_final', F_FINAL, { tPaint: akf.texture, tH: hgt.texture, tSrc: tex, uRes: [W, H], uL: light, uImp: impasto, uCanvas: canvas, uStreakC: streakColor, uSat: saturation, uSrcMix: srcMix, uT: t, tKeep: keep ? (keep.texture || keep) : tex, uKeep: keep ? keepAmount : 0 }, target);
    return target;
  }
}
