// LIGHT / pipeline: the shared renderer for 3D work (LIGHTING c1).
//
//   const lr = new LitRenderer({ canvas, width: 1080, height: 1920, quality: 'final' });
//   lr.render({ scene, camera, rig, t, medium, heat, update: (tk, k) => {...} })
//
// Per accumulated sub-frame k of K (Cook et al. 1984 distribution ray tracing / Haeberli and Akeley 1990 accumulation
// buffer: ONE mechanism gives anti-aliasing, soft area shadows, depth of field and motion blur on a CPU box):
//   update(tk)      the scene at a time inside the shutter (motion blur), camera shake
//   jitter          pixel (Halton), lens aperture (depth of field, focus plane kept by a frustum shear), light positions
//   prepass         view normal + 1/depth for every patched material (light/patch.js), skinned figures included
//   sso             screen-space ambient occlusion (SAO-style, two radii) + contact shadows toward the sun and the key
//                   practical (Bend Studio's screen-space shadows): R ao, G sun, B key, at half resolution
//   main            the forward pass in physical, pre-exposed units; AO only on indirect light; contact shadows per light
//   volume          a quarter-resolution march through height haze + the local Medium, lit by the sun (its shadow map),
//                   the sky, and every shadowed practical (its own shadow map), so beams are cut by what is in them
//   composite       depth-aware upsample of the volume, heat shimmer (refraction behind heat boxes), into the accumulator
// Then once per frame: bloom (energy-conserving mip chain, mixed, never thresholded), halation, natural vignette, the ONE
// display transform (light/display.js), grain. Type and brand marks go on after this.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { LIT, prepassHide } from './patch.js';
import { DISPLAY_GLSL, lottesParams } from './display.js';
import { DISPLAY7_GLSL, resolve7 } from './camera7.js';   // CAMERA7 (opt-in: the photographic display, a lens, a sensor)
import { halton } from './rig.js';
import { QUALITY6, SS_BUDGET, subPixel, resolveTaps, RESOLVE_GLSL, applyAniso } from './quality.js';
import { GpuTimerProfiler } from './gpu-timer.js';

export const QUALITY = {
  draft: { K: 1, vol: 0.25, sso: 0.5, volSteps: 28, msaa: 4 },
  final: { K: 6, vol: 0.25, sso: 0.5, volSteps: 36, msaa: 0 },
  clip: { K: 3, vol: 0.25, sso: 0.5, volSteps: 28, msaa: 0 },
  // (RENDER6, opt-in) preview | motion | film: light/quality.js (supersampling, Cycles' pixel filter, a K floor, specular AA, anisotropy)
  ...QUALITY6,
};

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const COMMONF = /* glsl */`
#include <packing>
varying vec2 vUv;
uniform sampler2D tPre; uniform mat4 uInvProj, uProj, uCamWorld; uniform vec3 uCamPos; uniform vec2 uRes; uniform float uFrame;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 viewRay(vec2 uv){ vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0); return v.xyz / v.w; }
vec3 viewPos(vec2 uv, float iz){ vec3 r = viewRay(uv); return r * ((1.0 / iz) / -r.z); }
vec2 projUv(vec3 p){ vec4 c = uProj * vec4(p, 1.0); return c.xy / c.w * 0.5 + 0.5; }
`;

// ---------------------------------------------------------------- SSO: ao + contact shadows
const SSO_FRAG = COMMONF + /* glsl */`
uniform vec3 uSunV; uniform vec4 uKeyV; uniform float uSunOn, uAOR, uAOI, uCLen, uThick;
float contact(vec3 p, vec3 n, vec3 d, float len, float j){
  if (dot(n, d) < 0.02) return 1.0;
  vec3 q0 = p + n * (0.012 + 0.002 * -p.z);
  float occ = 0.0; const int N = 14;
  for (int i = 0; i < N; i++) {
    float t = len * (float(i) + j) / float(N); t *= t / len;
    vec3 q = q0 + d * t; vec2 u = projUv(q);
    if (u.x < 0.0 || u.y < 0.0 || u.x > 1.0 || u.y > 1.0) break;
    float iz = texture2D(tPre, u).a; if (iz <= 0.0) continue;
    float dz = -q.z - 1.0 / iz;
    if (dz > 0.004 * -q.z && dz < uThick) { occ = 1.0 - smoothstep(0.6, 1.0, t / len); break; }
  }
  // (HUMAN c7) a light straight BEHIND the point as the camera sees it (the sun behind a figure, the camera looking into it): the march
  // runs away from the eye along the point's own pixel and finds the point's own surface in front of it, so every silhouette that
  // the light rakes was shadowed by itself and backlit figures lost their rim. Screen space cannot see behind the depth buffer there:
  // leave that case to the shadow map.
  occ *= 1.0 - smoothstep(0.55, 0.85, dot(d, normalize(p)));
  return 1.0 - occ;
}
void main(){
  vec4 pre = texture2D(tPre, vUv); if (pre.a <= 0.0) { gl_FragColor = vec4(1.0); return; }
  vec3 n = normalize(pre.xyz), p = viewPos(vUv, pre.a); float z = -p.z;
  float j = fract(ign(gl_FragCoord.xy) + 0.6180339 * uFrame), ang = j * 6.2831;
  // ambient occlusion: two radii (contact scale and the room scale), SAO-style spiral
  float ao = 1.0;
  for (int r = 0; r < 2; r++) {
    float R = r == 0 ? uAOR * 0.25 : uAOR, sum = 0.0; const int N = 10;
    vec2 rs = vec2(uProj[0][0], uProj[1][1]) * 0.5 * R / z;
    for (int i = 0; i < N; i++) {
      float f = (float(i) + 0.5 + 0.5 * j) / float(N), a = ang + float(i) * 2.39996;
      vec2 u = vUv + vec2(cos(a), sin(a)) * rs * f;
      float iz = texture2D(tPre, u).a; if (iz <= 0.0) continue;
      vec3 v = viewPos(u, iz) - p; float vv = dot(v, v), vn = dot(v, n);
      sum += max(0.0, vn - (0.002 * z + 0.004) * R) / (vv + 0.01 * R * R) * max(0.0, 1.0 - vv / (R * R));
    }
    ao *= clamp(1.0 - uAOI * (r == 0 ? 0.8 : 1.0) * sum * R / float(N), 0.0, 1.0);
  }
  float cs = uSunOn > 0.5 ? contact(p, n, uSunV, uCLen, j) : 1.0;
  float ck = 1.0;
  if (uKeyV.w > 0.5) { vec3 L = uKeyV.xyz - p; float d = length(L); ck = contact(p, n, L / d, min(uCLen, d * 0.5), j); }
  gl_FragColor = vec4(ao, cs, ck, 1.0);
}`;
const BLUR_FRAG = COMMONF + /* glsl */`
uniform sampler2D tIn; uniform vec2 uTexel;
void main(){
  vec4 pre = texture2D(tPre, vUv); float z = pre.a > 0.0 ? 1.0 / pre.a : 1e5;
  vec4 s = vec4(0.0); float w = 0.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    vec2 u = vUv + vec2(x, y) * uTexel; vec4 p2 = texture2D(tPre, u); float z2 = p2.a > 0.0 ? 1.0 / p2.a : 1e5;
    float k = exp(-abs(z2 - z) / (0.03 * z)) * max(0.0, dot(p2.xyz, pre.xyz)) + 1e-4;
    s += texture2D(tIn, u) * k; w += k; }
  gl_FragColor = s / w;
}`;

// ---------------------------------------------------------------- volume
function volumeFrag(nL, shadowed, steps) {
  let decl = '', body = '';
  for (let i = 0; i < nL; i++) {
    decl += `uniform vec3 uLP${i}, uLC${i}, uLD${i}; uniform vec2 uLK${i};\n`;
    if (shadowed[i]) decl += `uniform sampler2D tLS${i}; uniform mat4 uLM${i};\n`;
    body += `{ vec3 L = uLP${i} - p; float d2 = max(dot(L, L), 0.04); vec3 l = L * inversesqrt(d2);
      float sp = smoothstep(uLK${i}.x, uLK${i}.y, dot(-l, uLD${i}));
      if (sp > 0.0) { float vis = 1.0;
        ${shadowed[i] ? `vec4 sc = uLM${i} * vec4(p, 1.0); sc.xyz /= sc.w; if (sc.w > 0.0 && sc.x > 0.0 && sc.y > 0.0 && sc.x < 1.0 && sc.y < 1.0 && sc.z < 1.0) vis = step(sc.z - 0.0015, unpackRGBAToDepth(texture2D(tLS${i}, sc.xy)));` : ''}
        if (md > 0.0) vis *= medTau(p, l, sqrt(d2));
        lit += uLC${i} * (sp * vis / d2) * phase(dot(rd, l)) * (md > 0.0 ? 1.0 : 1.0); } }\n`;
  }
  return COMMONF + `
#define STEPS ${steps}
uniform vec3 uSunDir, uSunE, uAmb, uFogC; uniform float uDen, uH, uBase, uAlb, uG, uMaxD, uSunOn, uT;
uniform sampler2D tSunSh; uniform mat4 uSunMat;
uniform sampler3D tMed; uniform vec3 uMedMin, uMedSize, uDustTint; uniform float uMedK, uMedOn;
uniform vec4 uMedD;   // detail: scale (1/m), erosion (0..1), multiple-scattering gain, light self-shadow on (1/0)
${decl}
float hg(float c, float g){ float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
float phase(float c){ return mix(hg(c, uG), hg(c, -0.15), 0.2); }
float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
// detail noise for the medium (3 octaves of value noise; the grid holds the shape, this holds the billows and the torn edges)
float medFbm(vec3 q){ return 0.55 * vn3(q) + 0.3 * vn3(q * 2.17 + 3.1) + 0.15 * vn3(q * 4.63 + 7.7); }
// density at p: the grid's coarse field ERODED by detail noise (Schneider 2015, the Horizon clouds): thin parts tear into
// wisps and holes, thick cores stay solid, so a plume is a volume with an outline instead of a soft ribbon
float medDensity(vec3 p, out vec4 m){
  vec3 u = (p - uMedMin) / uMedSize; m = vec4(0.0);
  if (any(lessThan(u, vec3(0.0))) || any(greaterThan(u, vec3(1.0)))) return 0.0;
  m = texture(tMed, u); if (m.r <= 0.002) return 0.0;
  vec3 q = p * uMedD.x + vec3(0.0, -uT * 0.55, uT * 0.12);
  float n = medFbm(q + 1.3 * vec3(vn3(q * 0.37 + 9.1), vn3(q * 0.37 + 3.7), vn3(q * 0.37 + 5.3)));
  float c = m.r, e = uMedD.y * (1.0 - c * 0.85);
  float d = clamp((c - e * n) / max(1.0 - e * n, 0.05), 0.0, 1.0);
  return d * (0.35 + 1.3 * n) * uMedK;
}
// optical depth toward a light inside the medium: two taps along the way (cheap, but enough to give lamp-lit steam a dark core)
float medTau(vec3 p, vec3 l, float dist){
  if (uMedD.w < 0.5) return 1.0;
  vec4 m1; float a = medDensity(p + l * min(0.5, dist * 0.3), m1), b = medDensity(p + l * min(1.6, dist * 0.6), m1);
  return exp(-(a * 0.5 + b * 1.1));
}
void main(){
  float iz = texture2D(tPre, vUv).a;
  vec3 vr = viewRay(vUv); float vlen = length(vr);
  vec3 rd = normalize(mat3(uCamWorld) * (vr / vlen));
  float dist = iz > 0.0 ? length(viewPos(vUv, iz)) : 1e9; dist = min(dist, uMaxD);
  // per-pixel IGN, shifted and decorrelated across sub-frames (golden ratio), so averaged sub-frames leave no lattice
  float j = fract(ign(gl_FragCoord.xy + vec2(5.588, 8.137) * mod(uFrame, 64.0)) + 0.6180339 * uFrame);
  vec3 scat = vec3(0.0); float T = 1.0, tPrev = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float f = (float(i) + j) / float(STEPS), t = dist * f * f, ds = t - tPrev; tPrev = t;
    float tm = t - 0.5 * ds; vec3 p = uCamPos + rd * tm;
    float fog = uDen * exp(-max(p.y - uBase, 0.0) / uH);
    float md = 0.0, alb = uAlb, mT = 1.0; vec3 tint = vec3(1.0);
    if (uMedOn > 0.5) { vec4 m; md = medDensity(p, m);
      if (md > 0.0) { mT = m.g; alb = m.b; tint = mix(uDustTint, vec3(1.0), smoothstep(0.75, 0.95, m.b)); } }
    float st = fog + md; if (st < 1e-6) continue;
    vec3 ss = vec3(fog * uAlb) * uFogC + md * alb * tint;
    vec3 lit = uAmb * (md > 0.0 ? 0.35 + 0.65 * mT : 1.0);
    if (uSunOn > 0.5) {
      vec4 sc = uSunMat * vec4(p, 1.0); float vis = 1.0;
      if (sc.x > 0.0 && sc.y > 0.0 && sc.x < 1.0 && sc.y < 1.0 && sc.z < 1.0) vis = step(sc.z - 0.001, unpackRGBAToDepth(texture2D(tSunSh, sc.xy)));
      float c = dot(rd, uSunDir);
      lit += uSunE * vis * mT * phase(c);
      // multiple scattering inside the medium (Wrenninge 2013 octaves: each order sees less extinction and a wider lobe),
      // which lifts the lit side's interior so dense steam reads white and solid rather than grey and thin
      if (md > 0.0) lit += uSunE * vis * uMedD.z * (0.5 * pow(mT, 0.25) * hg(c, uG * 0.5) + 0.25 * pow(mT, 0.06) * hg(c, uG * 0.25));
    }
    ${body}
    vec3 S = ss * lit; float e = exp(-st * ds);
    scat += T * S * (1.0 - e) / st; T *= e;
    if (T < 0.01) break;
  }
  gl_FragColor = vec4(scat, T);
}`;
}

const VBLUR_FRAG = COMMONF + /* glsl */`
uniform sampler2D tIn; uniform vec2 uTexel, uDir;
void main(){
  float iz = texture2D(tPre, vUv).a, z = iz > 0.0 ? 1.0 / iz : 1e5;
  vec4 s = vec4(0.0); float w = 0.0;
  for (int i = -3; i <= 3; i++) { vec2 u = vUv + uDir * uTexel * float(i); float i2 = texture2D(tPre, u).a, z2 = i2 > 0.0 ? 1.0 / i2 : 1e5;
    float k = exp(-float(i * i) / 6.0) * exp(-abs(z2 - z) / (0.05 * z + 0.05)); s += texture2D(tIn, u) * k; w += k; }
  gl_FragColor = s / max(w, 1e-5);
}`;
const COPY_FRAG = `varying vec2 vUv; uniform sampler2D tIn; void main(){ gl_FragColor = texture2D(tIn, vUv); }`;

// ---------------------------------------------------------------- composite into the accumulator
const COMP_FRAG = COMMONF + /* glsl */`
uniform sampler2D tMain, tVol; uniform vec2 uVolRes; uniform float uW, uVolOn, uT, uHeatPx;
uniform vec4 uHeatA, uHeatB; uniform vec4 uHeatSA, uHeatSB;   // centre.xyz + strength, half size.xyz
// (WHITEOUT, the opt-in fog; off = this pass as before) an analytic medium per sub-frame: uFogA = sigma beyond near (1/m), near (m),
// sigma from the lens (1/m), on; uFogB = an exponential layer's k (1/m at its base), H (m), base y (m), far (m, the sky's depth); uFogL its radiance
uniform vec4 uFogA, uFogB; uniform vec3 uFogL;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 x){ vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float slab(vec3 ro, vec3 rd, vec3 c, vec3 h, float tmax){
  vec3 inv = 1.0 / rd, t0 = (c - h - ro) * inv, t1 = (c + h - ro) * inv, a = min(t0, t1), b = max(t0, t1);
  float tn = max(max(a.x, a.y), max(a.z, 0.0)), tf = min(min(b.x, b.y), min(b.z, tmax)); return max(0.0, tf - tn); }
void main(){
  vec4 pre = texture2D(tPre, vUv);
  vec2 uv = vUv;
  if (uHeatA.w + uHeatB.w > 0.0) {
    vec3 vr = viewRay(vUv); vec3 rd = normalize(mat3(uCamWorld) * normalize(vr));
    float dist = pre.a > 0.0 ? length(viewPos(vUv, pre.a)) : 1e4;
    float path = uHeatA.w * slab(uCamPos, rd, uHeatA.xyz, uHeatSA.xyz, dist) + uHeatB.w * slab(uCamPos, rd, uHeatB.xyz, uHeatSB.xyz, dist);
    // refraction through rising convection cells: the gradient of two octaves of noise advected UP the screen, in pixels
    // per metre of hot path (uHeatPx), strongest low in the column; a few pixels of shimmer, as a long lens sees over a ladle
    if (path > 0.0) { vec2 a = vUv * vec2(uRes.x / uRes.y, 1.0);
      vec2 q1 = a * 38.0 + vec2(0.3 * sin(uT * 1.7), -uT * 5.5), q2 = a * 95.0 + vec2(0.0, -uT * 13.0);
      vec2 g = vec2(n2(q1 + vec2(0.6, 0.0)) - n2(q1 - vec2(0.6, 0.0)), n2(q1 + vec2(0.0, 0.6)) - n2(q1 - vec2(0.0, 0.6)))
             + 0.6 * vec2(n2(q2 + vec2(0.6, 0.0)) - n2(q2 - vec2(0.6, 0.0)), n2(q2 + vec2(0.0, 0.6)) - n2(q2 - vec2(0.0, 0.6)));
      uv += g * min(path, 4.0) * uHeatPx / uRes; }
  }
  vec3 c = texture2D(tMain, uv).rgb;
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);   // one bad pixel must not spread through the bloom chain
  if (uFogA.w > 0.5) {
    // (WHITEOUT) L = L_inf (1 - T) + C T: T from the homogeneous terms and the layer integrated along the ray in closed form
    vec3 fr = normalize(mat3(uCamWorld) * normalize(viewRay(vUv)));
    float fd = pre.a > 0.0 ? length(viewPos(vUv, pre.a)) : uFogB.w;
    float tau = uFogA.x * max(fd - uFogA.y, 0.0) + uFogA.z * fd;
    float fH = max(uFogB.y, 1e-3), fk = fr.y * fd / fH;
    float lay = abs(fk) < 1e-3 ? fd : fH / fr.y * (1.0 - exp(clamp(-fk, -80.0, 80.0)));
    tau += uFogB.x * exp(clamp(-(uCamPos.y - uFogB.z) / fH, -80.0, 80.0)) * lay;
    float fT = exp(-tau); c = c * fT + uFogL * (1.0 - fT);
  }
  if (uVolOn > 0.5) {
    // depth-aware upsample of the quarter-res volume
    float z = pre.a > 0.0 ? 1.0 / pre.a : 1e5;
    // depth-aware 4x4 tent over the quarter-res volume (it also hides the per-pixel march jitter)
    vec2 f = vUv * uVolRes - 0.5, i0 = floor(f), w = f - i0; vec4 acc = vec4(0.0); float ws = 0.0;
    for (int y = -1; y <= 2; y++) for (int x = -1; x <= 2; x++) {
      vec2 tc = (i0 + vec2(x, y) + 0.5) / uVolRes; vec4 pv = texture2D(tPre, tc); float zz = pv.a > 0.0 ? 1.0 / pv.a : 1e5;
      vec2 d = vec2(x, y) - w; float bw = max(0.0, 1.0 - abs(d.x) * 0.5) * max(0.0, 1.0 - abs(d.y) * 0.5);
      float k = bw / (1e-3 + abs(zz - z) / max(z, 1e-3));
      acc += texture2D(tVol, tc) * k; ws += k; }
    vec4 v = acc / max(ws, 1e-6); if (any(isnan(v))) v = vec4(0.0, 0.0, 0.0, 1.0);
    c = c * v.a + v.rgb;
  }
  gl_FragColor = vec4(c * uW, uW);
}`;

// ---------------------------------------------------------------- bloom + final
const DOWN_FRAG = `varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uTexel; uniform float uClamp, uKaris;
// Jimenez 2014 (Call of Duty: AW) 13-tap downsample; on the first level each 2x2 group is weighted by 1/(1+luma) (Karis), so a
// single burning pixel (the sun disc, an arc) spreads as a soft glow instead of a flat disc with a hard rim
// a SOFT ceiling (c / (1 + Y / uClamp)): the sun's 6e4 cannot flood the frame, and there is no flat-topped disc with a rim
vec3 T(vec2 o){ vec3 c = texture2D(tIn, vUv + uTexel * o).rgb; if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0); float y = dot(c, vec3(0.2126, 0.7152, 0.0722)); return c / (1.0 + y / uClamp); }
float kw(vec3 c){ return uKaris > 0.5 ? 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)) * 0.25) : 1.0; }
void main(){
  vec3 a = T(vec2(-2, -2)), b = T(vec2(0, -2)), c = T(vec2(2, -2)), d = T(vec2(-1, -1)), e = T(vec2(1, -1)), f = T(vec2(-2, 0)), g = T(vec2(0, 0)),
       h = T(vec2(2, 0)), i = T(vec2(-1, 1)), j = T(vec2(1, 1)), k = T(vec2(-2, 2)), l = T(vec2(0, 2)), m = T(vec2(2, 2));
  vec3 g0 = (d + e + i + j) * 0.25, g1 = (a + b + f + g) * 0.25, g2 = (b + c + g + h) * 0.25, g3 = (f + g + k + l) * 0.25, g4 = (g + h + l + m) * 0.25;
  float w0 = 0.5 * kw(g0), w1 = 0.125 * kw(g1), w2 = 0.125 * kw(g2), w3 = 0.125 * kw(g3), w4 = 0.125 * kw(g4);
  vec3 s = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  gl_FragColor = vec4(s, 1.0); }`;
const UP_FRAG = `varying vec2 vUv; uniform sampler2D tIn, tAdd; uniform vec2 uTexel; uniform float uK;
void main(){ vec3 s = vec3(0.0);
  s += texture2D(tIn, vUv + uTexel * vec2(-1, -1)).rgb + texture2D(tIn, vUv + uTexel * vec2(1, -1)).rgb + texture2D(tIn, vUv + uTexel * vec2(-1, 1)).rgb + texture2D(tIn, vUv + uTexel * vec2(1, 1)).rgb;
  s += 2.0 * (texture2D(tIn, vUv + uTexel * vec2(0, -1)).rgb + texture2D(tIn, vUv + uTexel * vec2(0, 1)).rgb + texture2D(tIn, vUv + uTexel * vec2(-1, 0)).rgb + texture2D(tIn, vUv + uTexel * vec2(1, 0)).rgb);
  s += 4.0 * texture2D(tIn, vUv).rgb;
  gl_FragColor = vec4(s / 16.0 * uK + texture2D(tAdd, vUv).rgb, 1.0); }`;
const FINAL_FRAG = `varying vec2 vUv; uniform sampler2D tAcc, tBloom, tWide, tNarrow; uniform float uBloom, uHal, uHalT, uVig, uGrain, uFrame, uLevels, uAspect, uBlack, uVigPhys; uniform vec2 uVigTan;
${DISPLAY_GLSL}
${DISPLAY7_GLSL}
uniform float uC7On; uniform vec2 uC7e;   // CAMERA7: 0 = off (display.js's chain, byte for byte); uC7e = sensor noise (shot, read)
float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec4 a = texture2D(tAcc, vUv); vec3 c = a.rgb / max(a.a, 1e-6);
  if (uBloom != 0.0 || uHal != 0.0) {
    vec3 b = texture2D(tBloom, vUv).rgb / uLevels, w = texture2D(tWide, vUv).rgb / max(uLevels * 0.25, 0.3);
    c = mix(c, b, uBloom);
    // halation: the red-orange bleed round what burns the film (light through the base, back off the pressure plate)
    // bounded: a thin warm fringe that grows with the overexposure, never a ball of light
    // (LIGHTING c2) only energy ABOVE what the film can hold scatters back (hot = max(0, E - uHalT)); the halo is the narrow
    // blur of that minus the pixel's own, so it sits as a ring OUTSIDE the highlight (the red layer is the deepest: red ring)
    { vec3 nb = texture2D(tNarrow, vUv).rgb; float hb = max(0.0, max(nb.r, max(nb.g, nb.b)) - uHalT), hc = max(0.0, max(c.r, max(c.g, c.b)) - uHalT);
      float ring = max(0.0, hb - hc);
      c += uHal * vec3(1.0, 0.22, 0.05) * ring * 0.9;
      float hw = 1.0 - exp(-max(0.0, max(w.r, max(w.g, w.b)) - 1.0) * 0.6);
      c += uHal * hw * vec3(1.0, 0.3, 0.09) * 0.02; }
  }
  // natural vignette (cos^4 of the field angle) at a set strength
  if (uVigPhys > 0.5) { vec2 q = (vUv - 0.5) * 2.0 * uVigTan; c *= pow(1.0 / (1.0 + dot(q, q)), 2.0); }   // CAMERA7: cos^4 of the real field angle (tan theta = |ndc| tan(fov/2) per axis), strength 1, from the camera's own projection
  else { vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0); float r2 = dot(q, q) * 1.1; float cf = 1.0 / (1.0 + r2); c *= mix(1.0, cf * cf, uVig); }
  c = max(c - uBlack, vec3(0.0));
  // CAMERA7 sensor: signal-dependent noise (sigma^2 = shot * Y + read^2) in the exposed linear light, before the curve
  if (uC7On > 0.5 && uC7e.x + uC7e.y > 0.0) { vec2 sp = gl_FragCoord.xy + uFrame * vec2(13.0, 7.0); vec3 nz = (vec3(h21(sp), h21(sp + 4.1), h21(sp + 9.3)) - 0.5) * 3.4641016;
    c += nz * sqrt(max(uC7e.x * dot(c, vec3(0.2126, 0.7152, 0.0722)) + uC7e.y * uC7e.y, 0.0)); }
  vec3 d = uC7On > 0.5 ? acpDisplay7(c) : acpDisplay(c);
  // grain: strongest in the mid tones, slightly chromatic
  float l = dot(d, vec3(0.299, 0.587, 0.114)), gm = 4.0 * l * (1.0 - l);
  vec2 gp = gl_FragCoord.xy + uFrame * vec2(17.0, 31.0);
  d += uGrain * gm * (vec3(h21(gp), h21(gp + 3.1), h21(gp + 7.7)) * 0.4 + h21(gp * 1.3 + 11.0) * 0.6 - 0.5);
  d += (h21(gl_FragCoord.xy * 0.731 + uFrame) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(d, 0.0, 1.0), 1.0);
}`;

// (RENDER6) the same final pass reading the supersampled accumulator through the pixel filter (light/quality.js)
const FINAL_SS = FINAL_FRAG.replace('vec4 a = texture2D(tAcc, vUv);', 'vec4 a = acpResolve();').replace('void main(){', RESOLVE_GLSL + '\nvoid main(){');
if (FINAL_SS === FINAL_FRAG || !FINAL_SS.includes('acpResolve();')) throw new Error('pipeline: FINAL_SS anchor');

// CAMERA7 rev 2: the output sharpening. 5 x 5 taps spaced uSh.x px (a Gaussian of that sigma), amount uSh.y, threshold uSh.z (display units; 0 = the classic mask)
const SHARP_FRAG = `varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uTexel; uniform vec3 uSh;
void main(){
  vec3 d = texture2D(tIn, vUv).rgb, s = vec3(0.0); float ws = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) { float w = exp(-0.5 * float(i * i + j * j)); s += w * texture2D(tIn, vUv + uTexel * uSh.x * vec2(float(i), float(j))).rgb; ws += w; }
  vec3 df = d - s / ws; float m = max(abs(df.r), max(abs(df.g), abs(df.b)));
  float w = uSh.z > 0.0 ? 1.0 - smoothstep(0.5 * uSh.z, uSh.z, m) : 1.0;
  gl_FragColor = vec4(clamp(d + uSh.y * w * df, 0.0, 1.0), 1.0);
}`;

const rt = (w, h, o = {}) => new THREE.WebGLRenderTarget(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, ...o });
const mat3 = m => new THREE.Matrix3().set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);

export class LitRenderer {
  constructor({ canvas, width = 1080, height = 1920, quality = 'draft', scale = 1, profileGpu = false, onGpuProfile = null } = {}) {
    this.W = Math.round(width * scale); this.H = Math.round(height * scale);
    this.q = { ...(typeof quality === 'string' ? QUALITY[quality] : quality) };
    // (RENDER6) internal supersampling: W x H are the INTERNAL buffers, OW x OH the canvas (equal unless the tier asks for ss 2)
    this.OW = this.W; this.OH = this.H; this.ss = 1;
    if ((this.q.ss ?? 1) > 1) { if (this.W * this.H * 4 <= (this.q.ssBudget ?? SS_BUDGET)) { this.ss = 2; this.W *= 2; this.H *= 2; } else if (this.q.Kfloor) this.q.K *= 2; }
    // (RENDER6) canvasAA: a multisampled canvas. The lit path's last pass is one full-screen triangle (unchanged by it); what it
    // anti-aliases is geometry drawn STRAIGHT to the canvas by other passes on this renderer (STYLE's designed looks: notan, poster)
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !!this.q.canvasAA, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.gpuProfiler = profileGpu ? new GpuTimerProfiler(r.getContext(), { onSample: onGpuProfile || (() => {}) }) : null;
    r.setPixelRatio(1); r.setSize(this.OW, this.OH, false);
    r.toneMapping = THREE.NoToneMapping; r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.shadowMap.autoUpdate = false;
    r.autoClear = false;   // the accumulator must not be cleared by each composite draw; every pass that needs a clear clears explicitly
    const W = this.W, H = this.H;
    this.pre = rt(W, H, { type: THREE.FloatType, depthBuffer: true, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
    this.main = rt(W, H, { depthBuffer: true, samples: this.q.K === 1 ? (this.q.msaa ?? 4) : 0 });
    this.sso = rt(W * this.q.sso, H * this.q.sso); this.sso2 = rt(W * this.q.sso, H * this.q.sso);
    this.vol = rt(W * this.q.vol, H * this.q.vol, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
    this.vol2 = rt(W * this.q.vol, H * this.q.vol, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
    this.acc = rt(W, H, { type: THREE.FloatType });
    this.mips = []; let w = W / 2, h = H / 2; for (let i = 0; i < 6; i++) { this.mips.push([rt(w, h), rt(w, h)]); w /= 2; h /= 2; }
    const U = this.U = {
      tPre: { value: this.pre.texture }, uInvProj: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() }, uRes: { value: new THREE.Vector2(W, H) }, uFrame: { value: 0 },
    };
    this.ssoQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SSO_FRAG, uniforms: { ...U, uSunV: { value: new THREE.Vector3() }, uKeyV: { value: new THREE.Vector4() }, uSunOn: { value: 0 }, uAOR: { value: 1.6 }, uAOI: { value: 1.0 }, uCLen: { value: 0.6 }, uThick: { value: 0.35 } } }));
    this.blurQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BLUR_FRAG, uniforms: { ...U, tIn: { value: null }, uTexel: { value: new THREE.Vector2() } } }));
    this.vblurQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: VBLUR_FRAG, uniforms: { ...U, tIn: { value: null }, uTexel: { value: new THREE.Vector2(1 / this.vol.width, 1 / this.vol.height) }, uDir: { value: new THREE.Vector2(1, 0) } } }));
    this.copyQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: COPY_FRAG, uniforms: { tIn: { value: null } }, depthTest: false, depthWrite: false }));
    this.compQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: COMP_FRAG, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true, depthTest: false, depthWrite: false,
      uniforms: { ...U, tMain: { value: this.main.texture }, tVol: { value: this.vol.texture }, uVolRes: { value: new THREE.Vector2(this.vol.width, this.vol.height) }, uW: { value: 1 }, uVolOn: { value: 1 }, uT: { value: 0 }, uHeatPx: { value: 3.5 },
        uHeatA: { value: new THREE.Vector4() }, uHeatB: { value: new THREE.Vector4() }, uHeatSA: { value: new THREE.Vector4(1, 1, 1, 0) }, uHeatSB: { value: new THREE.Vector4(1, 1, 1, 0) },
        uFogA: { value: new THREE.Vector4() }, uFogB: { value: new THREE.Vector4(0, 3, 0, 5000) }, uFogL: { value: new THREE.Vector3() } } }));
    this.downQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DOWN_FRAG, uniforms: { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uClamp: { value: 4000 }, uKaris: { value: 0 } } }));
    this.upQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: UP_FRAG, uniforms: { tIn: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() }, uK: { value: 0.55 } } }));
    const P = lottesParams();
    this.finalQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FINAL_FRAG, uniforms: {
      tAcc: { value: this.acc.texture }, tBloom: { value: null }, tWide: { value: null }, tNarrow: { value: null }, uBloom: { value: 0.04 }, uHal: { value: 0.25 }, uHalT: { value: 6 }, uBlack: { value: 0 }, uVig: { value: 0.3 }, uGrain: { value: 0.03 }, uFrame: { value: 0 }, uLevels: { value: 6 }, uAspect: { value: W / H }, uVigPhys: { value: 0 }, uVigTan: { value: new THREE.Vector2(0.2, 0.2) },
      uWB: { value: new THREE.Matrix3() }, uCurve: { value: new THREE.Vector4(P.a, P.d, P.b, P.c) }, uPath: { value: new THREE.Vector4(P.mid, P.ps, P.pr, P.wd) }, uSatLook: { value: P.sat },
      uC7On: { value: 0 }, uC7e: { value: new THREE.Vector2() }, uC7a: { value: new THREE.Vector4() }, uC7b: { value: new THREE.Vector4() }, uC7c: { value: new THREE.Vector4() }, uC7d: { value: new THREE.Vector4() } } }));
    // CAMERA7 rev 2: output sharpening (a threshold unsharp mask on the display-referred frame: pores and lashes boosted, strong edges left alone); only when camera7 names `sharpen`
    this.sharpQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SHARP_FRAG, uniforms: { tIn: { value: null }, uTexel: { value: new THREE.Vector2(1 / W, 1 / H) }, uSh: { value: new THREE.Vector3(1.5, 0, 0.04) } }, depthTest: false, depthWrite: false }));
    this.sharpRT = null;
    if (this.ss > 1) { const T = resolveTaps(this.ss, this.q.filter ?? 1.5);   // the same uniform objects as finalQ: post() sets both
      this.finalSSQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FINAL_SS, uniforms: { ...this.finalQ.material.uniforms,
        uAccRes: { value: new THREE.Vector2(W, H) }, uRW: { value: T.w }, uRX: { value: T.x.map(v => v * this.ss) } } })); }
    this._volKey = null; this.stats = {};
    LIT.uLitSSO.value = this.sso.texture; LIT.uLitInvRes.value.set(1 / W, 1 / H);
  }
  _volMat(rig) {
    const L = rig.volumeLights().slice(0, 6), sh = L.map(l => l.shadow), key = L.length + ':' + sh.join(',') + ':' + this.q.volSteps;
    if (key !== this._volKey) {
      this._volKey = key;
      const u = { ...this.U, uSunDir: { value: new THREE.Vector3() }, uSunE: { value: new THREE.Vector3() }, uAmb: { value: new THREE.Vector3() }, uFogC: { value: new THREE.Vector3(1, 1, 1) },
        uDen: { value: 0 }, uH: { value: 40 }, uBase: { value: 0 }, uAlb: { value: 0.9 }, uG: { value: 0.55 }, uMaxD: { value: 400 }, uSunOn: { value: 0 }, uT: { value: 0 },
        tSunSh: { value: null }, uSunMat: { value: new THREE.Matrix4() }, tMed: { value: this._dummy3D() }, uMedMin: { value: new THREE.Vector3() }, uMedSize: { value: new THREE.Vector3(1, 1, 1) }, uDustTint: { value: new THREE.Vector3(1, 0.86, 0.7) }, uMedK: { value: 0 }, uMedOn: { value: 0 },
        uMedD: { value: new THREE.Vector4(1.6, 0.0, 0.0, 0.0) } };
      L.forEach((l, i) => { u['uLP' + i] = { value: new THREE.Vector3() }; u['uLC' + i] = { value: new THREE.Vector3() }; u['uLD' + i] = { value: new THREE.Vector3() }; u['uLK' + i] = { value: new THREE.Vector2() }; if (l.shadow) { u['tLS' + i] = { value: null }; u['uLM' + i] = { value: new THREE.Matrix4() }; } });
      this.volQ?.material.dispose();
      this.volQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: volumeFrag(L.length, sh, this.q.volSteps), uniforms: u }));
    }
    return { mat: this.volQ.material, L };
  }
  _dummy3D() { if (!this.__d3) { const t = new THREE.Data3DTexture(new Uint8Array([0, 255, 255, 255]), 1, 1, 1); t.needsUpdate = true; this.__d3 = t; } return this.__d3; }
  _gpuPass(name, fn) { return this.gpuProfiler ? this.gpuProfiler.measure(name, this.__gpuFrame, fn) : fn(); }
  // the ground mirror (LIGHTING c2): the scene seen from the camera reflected in the plane y = m.y, with an oblique near plane
  // on the mirror (Lengyel 2005, as three's Reflector does) so nothing below the ground leaks in. Rendered at m.res of the
  // frame, once per frame (sub-frame 0); the screen-space passes are off in it (their buffers belong to the real camera).
  _mirror(scene, camera, m, rig) {
    const r = this.renderer, res = m.res ?? 0.5;
    if (!this.mirrorRT || this._mirRes !== res) { this.mirrorRT?.dispose(); this.mirrorRT = rt(this.W * res, this.H * res, { depthBuffer: true }); this._mirRes = res; this.vcam = new THREE.PerspectiveCamera(); }
    const vc = this.vcam, y = m.y ?? 0, n = new THREE.Vector3(0, 1, 0);
    const cp = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld), rot = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(cp);
    const refl = v => v.set(v.x, 2 * y - v.y, v.z);
    vc.position.copy(refl(cp.clone())); vc.up.set(0, 1, 0).applyMatrix4(rot).reflect(n); vc.lookAt(refl(look.clone()));
    vc.far = camera.far; vc.near = camera.near; vc.updateMatrixWorld(); vc.projectionMatrix.copy(camera.projectionMatrix);
    { const e = vc.projectionMatrix.elements, k = 1 / (m.cover ?? 1.3); e[0] *= k; e[5] *= k; }   // a wider mirror: ground near the lens reflects rays beyond the frame's own
    const tm = LIT.uLitMirrorMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(0, y, 0)).applyMatrix4(vc.matrixWorldInverse);
    const cl = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant), P = vc.projectionMatrix.elements, q = new THREE.Vector4();
    q.x = (Math.sign(cl.x) + P[8]) / P[0]; q.y = (Math.sign(cl.y) + P[9]) / P[5]; q.z = -1; q.w = (1 + P[10]) / P[14];
    cl.multiplyScalar(2 / cl.dot(q)); P[2] = cl.x; P[6] = cl.y; P[10] = cl.z + 1 - 0.003; P[14] = cl.w;
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();
    const lon = LIT.uLitOn.value, mon = LIT.uLitMirrorOn.value, son = LIT.uLitSSROn.value, vi = LIT.uLitViewInv.value.clone();
    LIT.uLitOn.value = 0; LIT.uLitMirrorOn.value = 0; LIT.uLitSSROn.value = 0; LIT.uLitViewInv.value.copy(vc.matrixWorld);
    const hide = []; if (m.hide) for (const o of m.hide) if (o.visible) { o.visible = false; hide.push(o); }
    if (rig?.disc) { rig.disc.visible = true; }
    const preT = LIT.uLitPreT.value; LIT.uLitMirror.value = null; LIT.uLitPreT.value = null;
    this._gpuPass('mirror_shadow_and_scene', () => { r.setRenderTarget(this.mirrorRT); r.setClearColor(0x000000, 1); r.clear(); r.render(scene, vc); });
    LIT.uLitPreT.value = preT;
    for (const o of hide) o.visible = true;
    LIT.uLitOn.value = lon; LIT.uLitMirrorOn.value = mon; LIT.uLitSSROn.value = son; LIT.uLitViewInv.value.copy(vi);
    LIT.uLitMirror.value = this.mirrorRT.texture; LIT.uLitMirrorP.value.set(y, m.tolerance ?? 0.06, m.streak ?? 1.0, 0);
    void tm;
  }

  // o: { scene, camera, rig, t, update(tk, k), medium, heat: [{ c:[x,y,z], h:[x,y,z], s }], lens: { focus, fstop, focal(mm) }, K, shutter,
  //      mirror: { y, res, streak, tolerance, hide: [objects] }   ground reflections for materials patched with { planar: true }
  //      ssr: true | { maxDist, thickness }                       screen-space reflections for materials patched with { ssr: true }
  //      heatPx (px of shimmer per metre of hot path, default 3.5),
  //      fog: { sigma, near, cut, blowK, blowH, base, far, L } (opt-in: an analytic medium in the composite, lib/fx/whiteout.js),
  //      overlay(r, lr) (opt-in: draw into lr.acc after the sub-frames: whiteout.js's flakes) }
  render(o) {
    const { scene, camera, rig } = o, r = this.renderer, K = this.q.Kfloor ? Math.max(o.K ?? 0, this.q.K) : (o.K ?? this.q.K), W = this.W, H = this.H;
    this.__gpuFrame = Math.floor((o.t ?? 0) * 30 + 0.5);
    this.gpuProfiler?.poll();
    const c7 = resolve7(o.camera7 ?? rig.camera7);   // CAMERA7 (opt-in): its lens (focal, f-stop) is laid over the caller's, which keeps the focus distance
    const shutter = o.shutter ?? 1 / 60, t = o.t ?? 0, lens = c7?.lens ? { ...(o.lens || {}), ...c7.lens } : (o.lens || {}), t0 = performance.now();
    // (RENDER6) the new tiers set their own page-wide LIT state for this render and put it back after (other renderers in the page
    // keep theirs): the internal resolution, specular AA; anisotropic filtering on the scene's textures
    const q6 = this.q.tier ? { inv: LIT.uLitInvRes.value.clone(), saa: LIT.uLitSAA.value.clone() } : null;
    // the screen-space kernel is the footprint of ONE sample: K sub-frames jittered over a pixel each cover 1/K of it (the jitter
    // already integrates the rest), so its variance is the pixel's / K (at K 1 the full Tokuyoshi-Kaplanyan kernel; at K 16 a
    // sixteenth: the pores keep their texture, only what is finer than the sample spacing is widened)
    if (q6) { LIT.uLitInvRes.value.set(1 / W, 1 / H); LIT.uLitSAA.value.x = this.q.specAA ? 1 : 0; LIT.uLitSAA.value.y = (this.q.saaSigma2 ?? 0.15915494) / Math.max(1, K); if (this.q.aniso) this.stats6 = { aniso: applyAniso(r, scene, this.q.aniso) };
      // shadowSize: a finer sun shadow map (the stages use 4096 over the people's box: ~1.5 mm a texel round one person); kept after
      const ss6 = Math.min(this.q.shadowSize || 0, r.capabilities.maxTextureSize);
      if (ss6 && rig.sun?.castShadow && rig.sun.shadow.mapSize.x < ss6) { rig.sun.shadow.mapSize.set(ss6, ss6); rig.sun.shadow.map?.dispose(); rig.sun.shadow.map = null; } }
    const fr = Math.floor(t * 30 + 0.5); this.U.uFrame.value = fr;
    if (o.medium) o.medium.update(t, rig.sunOn ? rig.sunDir : null);
    r.setRenderTarget(this.acc); r.setClearColor(0x000000, 0); r.clear();
    rig.followCamera?.(camera);   // CAMERA7: lamps placed for the lens (spec.follow 'camera': the stage's background light) follow the camera's wall point
    const at = rig.atmos, ssr = o.ssr ? (o.ssr === true ? {} : o.ssr) : null;
    { const fg = o.fog, cu = this.compQ.material.uniforms;   // (WHITEOUT) the opt-in medium: { sigma, near, cut, blowK, blowH, base, far, L } or nothing (off)
      cu.uFogA.value.set(fg ? fg.sigma ?? 0 : 0, fg ? fg.near ?? 0 : 0, fg ? fg.cut ?? 0 : 0, fg ? 1 : 0);
      if (fg) { cu.uFogB.value.set(fg.blowK ?? 0, fg.blowH ?? 3, fg.base ?? 0, fg.far ?? 5000); cu.uFogL.value.set(fg.L[0], fg.L[1], fg.L[2]); } }
    if (ssr && !this.prevRT) this.prevRT = rt(W, H);
    LIT.uLitPreT.value = this.pre.texture; LIT.uLitPrev.value = this.prevRT ? this.prevRT.texture : null;
    LIT.uLitSSRP.value.set(ssr?.maxDist ?? 40, ssr?.thickness ?? 0.6, 0, 0);
    // with SSR and no previous frame to reflect, one extra sub-frame first (not accumulated) fills it
    const k0 = ssr && !this._prevOk ? -1 : 0;
    for (let k = k0; k < K; k++) {
      const kk = Math.max(k, 0), tk = K > 1 ? t - shutter * (1 - (kk + 0.5) / K) : t;
      o.update?.(tk, kk);
      rig.update(tk, o.drive?.(tk) || {}); rig.jitter(kk, K);
      this.U.uFrame.value = fr * 8 + kk;
      // camera: pixel jitter + thin-lens aperture sample with the focus plane held (frustum shear)
      camera.updateMatrixWorld(); camera.updateProjectionMatrix();
      const P = camera.projectionMatrix.elements, savePos = camera.position.clone();
      if (K > 1) {
        const [hx, hy] = this.q.tier ? subPixel(kk, this.q, this.ss) : [halton(kk + 1, 2) - 0.5, halton(kk + 1, 3) - 0.5]; P[8] += 2 * hx / W; P[9] += 2 * hy / H;
        if (lens.fstop && lens.focus) {
          const f = (lens.focal ?? 35) / 1000, ap = f / (2 * lens.fstop) * (lens.apertureScale ?? 1);
          const a = 2 * Math.PI * halton(kk + 1, 5), rr = Math.sqrt(halton(kk + 1, 7)) * ap, ax = Math.cos(a) * rr, ay = Math.sin(a) * rr;
          const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
          camera.position.addScaledVector(right, ax).addScaledVector(up, ay); camera.updateMatrixWorld();
          P[8] -= P[0] * ax / lens.focus; P[9] -= P[5] * ay / lens.focus;
        }
      }
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      this.U.uProj.value.copy(camera.projectionMatrix); this.U.uInvProj.value.copy(camera.projectionMatrixInverse);
      this.U.uCamWorld.value.copy(camera.matrixWorld); this.U.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
      LIT.uLitProj.value.copy(camera.projectionMatrix); LIT.uLitViewInv.value.copy(camera.matrixWorld); LIT.uLitSSRP.value.z = kk + fr * 8;
      // the ground mirror, once per frame (it renders the shadow maps for this sub-frame; the main pass reuses them)
      let shDone = false;
      if (o.mirror && (k === k0 || o.mirror.every)) { r.shadowMap.needsUpdate = true; this._mirror(scene, camera, o.mirror, rig); LIT.uLitMirrorOn.value = 1; shDone = true; }
      else if (!o.mirror) LIT.uLitMirrorOn.value = 0;
      // prepass
      LIT.uLitPre.value = 1; LIT.uLitOn.value = 0; LIT.uLitPreT.value = null;   // no texture may be bound that the pass writes (feedback loop)
      const restore = prepassHide(scene), bg = scene.background; scene.background = null;
      this._gpuPass('prepass', () => { r.setRenderTarget(this.pre); r.setClearColor(0x000000, 0); r.clear(); r.render(scene, camera); });
      restore(); scene.background = bg; LIT.uLitPre.value = 0; LIT.uLitPreT.value = this.pre.texture;
      // SSO is still built when its debug view is requested, even when the main shading option disables it.
      const runSSO = !o.noSSO || o.debug === 'sso' || !!o.overlay;
      const key = rig.keyLight();
      if (runSSO) {
        const sm = this.ssoQ.material.uniforms, view = camera.matrixWorldInverse;
        sm.uSunOn.value = rig.sunOn ? 1 : 0; sm.uSunV.value.copy(rig.sunDir).transformDirection(view);
        if (key && key.light.visible) { const p = key.light.position.clone().applyMatrix4(view); sm.uKeyV.value.set(p.x, p.y, p.z, 1); } else sm.uKeyV.value.w = 0;
        sm.uAOR.value = o.ao?.radius ?? 1.6; sm.uAOI.value = o.ao?.intensity ?? 1.8; sm.uCLen.value = o.contactLen ?? 0.6;
        this._gpuPass('sso', () => { r.setRenderTarget(this.sso); this.ssoQ.render(r); });
        this.blurQ.material.uniforms.tIn.value = this.sso.texture; this.blurQ.material.uniforms.uTexel.value.set(1 / this.sso.width, 1 / this.sso.height);
        this._gpuPass('sso_blur', () => { r.setRenderTarget(this.sso2); this.blurQ.render(r); });
      }
      LIT.uLitKeyPt.value = key && key.light.isPointLight ? 1 : 0;
      LIT.uLitSSO.value = this.sso2.texture; LIT.uLitOn.value = o.noSSO ? 0 : 1;
      LIT.uLitSSROn.value = ssr && (this._prevOk || k >= 0) && k !== k0 ? 1 : 0;
      // main
      r.shadowMap.needsUpdate = !shDone;
      this._gpuPass('main_shadow_and_scene', () => { r.setRenderTarget(this.main); r.setClearColor(0x000000, 1); r.clear(); r.render(scene, camera); });
      LIT.uLitOn.value = 0; LIT.uLitSSROn.value = 0;
      if (ssr) { this.copyQ.material.uniforms.tIn.value = this.main.texture; this._gpuPass('ssr_copy', () => { r.setRenderTarget(this.prevRT); this.copyQ.render(r); }); this._prevOk = true; }
      if (k < 0) { camera.position.copy(savePos); camera.updateMatrixWorld(); camera.updateProjectionMatrix(); continue; }
      // volume
      const volOn = (at.density > 0 || (o.medium && o.medium.active) || rig.volumeLights().length > 0) && at.enabled !== false;
      if (volOn) {
        const { mat, L } = this._volMat(rig), u = mat.uniforms;
        u.uSunDir.value.copy(rig.sunDir); u.uSunE.value.copy(rig.sunE()); u.uAmb.value.copy(rig.ambientL()); u.uSunOn.value = rig.sunOn ? 1 : 0;
        u.uDen.value = at.density; u.uH.value = at.height; u.uBase.value = at.base; u.uAlb.value = at.albedo; u.uG.value = at.g; u.uMaxD.value = at.maxDist; u.uT.value = tk;
        if (at.color) u.uFogC.value.set(...at.color);
        if (rig.sunOn && rig.sun.shadow.map) { u.tSunSh.value = rig.sun.shadow.map.texture; u.uSunMat.value.copy(rig.sun.shadow.matrix); } else u.uSunOn.value = 0;
        if (o.medium && o.medium.active) { const m = o.medium, d = m.detail || {}; u.tMed.value = m.texture; u.uMedMin.value.copy(m.min); u.uMedSize.value.copy(m.size); u.uMedK.value = m.maxDensity; u.uMedOn.value = 1; if (m.tint) u.uDustTint.value.set(...m.tint);
          u.uMedD.value.set(d.scale ?? 1.6, d.erode ?? 0, d.multi ?? 0, d.lightShadow ? 1 : 0); } else u.uMedOn.value = 0;
        L.forEach((l, i) => { u['uLP' + i].value.copy(l.pos); u['uLC' + i].value.copy(l.col).multiplyScalar(l.gain); u['uLD' + i].value.copy(l.dir); u['uLK' + i].value.set(l.cosO, l.cosI);
          if (l.shadow && l.light.shadow.map) { u['tLS' + i].value = l.light.shadow.map.texture; u['uLM' + i].value.copy(l.light.shadow.matrix); } });
        this._gpuPass('volume', () => { r.setRenderTarget(this.vol); this.volQ.render(r); });
        if ((o.volBlur ?? 1) > 0) { const b = this.vblurQ.material.uniforms;
          b.tIn.value = this.vol.texture; b.uDir.value.set(1, 0); this._gpuPass('volume_blur_h', () => { r.setRenderTarget(this.vol2); this.vblurQ.render(r); });
          b.tIn.value = this.vol2.texture; b.uDir.value.set(0, 1); this._gpuPass('volume_blur_v', () => { r.setRenderTarget(this.vol); this.vblurQ.render(r); }); }
      }
      // composite (+ heat shimmer) into the accumulator
      const cu = this.compQ.material.uniforms; cu.uW.value = 1 / K; cu.uVolOn.value = volOn ? 1 : 0; cu.uT.value = tk; cu.uHeatPx.value = o.heatPx ?? 3.5;
      const hz = o.heat || [];
      [['uHeatA', 'uHeatSA'], ['uHeatB', 'uHeatSB']].forEach(([a, b], i) => { const h = hz[i]; if (h) { cu[a].value.set(h.c[0], h.c[1], h.c[2], h.s ?? 1); cu[b].value.set(h.h[0], h.h[1], h.h[2], 0); } else cu[a].value.w = 0; });
      this._gpuPass('composite', () => { r.setRenderTarget(this.acc); this.compQ.render(r); });
      // restore the camera
      camera.position.copy(savePos); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    }
    if (o.overlay) this._gpuPass('overlay', () => o.overlay(r, this));   // (WHITEOUT, opt-in) draws into the accumulator after the sub-frames, before bloom and the display transform
    if (o.probe) { const fa = new Float32Array(4); r.readRenderTargetPixels(this.acc, Math.floor(W * 0.5), Math.floor(H * 0.8), 1, 1, fa); console.log('acc', JSON.stringify([...fa])); }
    { const Pm = camera.projectionMatrix.elements; this._vigTan = [1 / Pm[0], 1 / Pm[5]]; }   // the lens' field: tan(half fov) across and up (the vignette is cos^4 of the field angle)
    if (o.debug) this.debugView(o.debug, o.debugGain ?? 1); else this.post(rig, o, fr);
    if (q6) { LIT.uLitInvRes.value.copy(q6.inv); LIT.uLitSAA.value.copy(q6.saa); }
    // timings are only real after the GPU has finished (c2: the lab used to report page time before the fence, ~20x low)
    if (o.sync !== false) this.sync();
    this.stats = { ms: performance.now() - t0, K };
    if (q6) Object.assign(this.stats, { ss: this.ss, tier: this.q.tier, internal: [W, H] }, this.stats6 || {});
    return this.stats;
  }
  post(rig, o = {}, fr = 0) {
    const r = this.renderer, lens = { ...rig.lens, ...(o.post || {}) };
    const runBloom = lens.bloom !== 0 || lens.halation !== 0;
    if (runBloom) {
      let src = this.acc.texture;
      for (let i = 0; i < this.mips.length; i++) {
        const [d] = this.mips[i]; const dq = this.downQ.material.uniforms; dq.tIn.value = src; dq.uTexel.value.set(0.5 / d.width, 0.5 / d.height); dq.uClamp.value = i === 0 ? (lens.bloomCeiling ?? 400) : 1e9; dq.uKaris.value = i === 0 ? 1 : 0;
        this._gpuPass('bloom_down_' + i, () => { r.setRenderTarget(d); this.downQ.render(r); }); src = d.texture;
      }
      for (let i = this.mips.length - 2; i >= 0; i--) {
        const [d, u] = this.mips[i], lower = i === this.mips.length - 2 ? this.mips[i + 1][0] : this.mips[i + 1][1];
        const uq = this.upQ.material.uniforms; uq.uK.value = lens.bloomFalloff ?? 0.5; uq.tIn.value = lower.texture; uq.tAdd.value = d.texture; uq.uTexel.value.set(1 / lower.width, 1 / lower.height);
        this._gpuPass('bloom_up_' + i, () => { r.setRenderTarget(u); this.upQ.render(r); });
      }
    }
    const f = this.finalQ.material.uniforms;
    if (runBloom) {
      f.tBloom.value = this.mips[0][1].texture; f.tWide.value = this.mips[2][1].texture; f.tNarrow.value = this.mips[1][0].texture;
    }
    { const k = lens.bloomFalloff ?? 0.5; let w = 0; for (let i = 0; i < this.mips.length; i++) w += k ** i; f.uLevels.value = w; }
    f.uBloom.value = lens.bloom; f.uHal.value = lens.halation; f.uHalT.value = lens.halationThreshold ?? 4; f.uBlack.value = lens.black ?? 0;
    f.uVig.value = lens.vignette; f.uGrain.value = lens.grain; f.uFrame.value = fr;
    const wb = rig.wb; f.uWB.value.copy(mat3(wb));
    const P = lottesParams(rig.look || {}); f.uCurve.value.set(P.a, P.d, P.b, P.c); f.uPath.value.set(P.mid, P.ps, P.pr, P.wd); f.uSatLook.value = P.sat;
    const c7 = resolve7(o.camera7 ?? rig.camera7); f.uC7On.value = c7 ? 1 : 0;   // CAMERA7: the photographic display (camera7.js), else display.js's
    f.uVigPhys.value = c7 && this._vigTan ? 1 : 0; if (this._vigTan) f.uVigTan.value.set(this._vigTan[0], this._vigTan[1]);
    if (c7) { f.uC7a.value.set(...c7.U.a); f.uC7b.value.set(...c7.U.b); f.uC7c.value.set(...c7.U.c); f.uC7d.value.set(...c7.U.d); f.uC7e.value.set(c7.sensor.shot, c7.sensor.read); }
    if (c7?.sharpen && c7.sharpen.amount > 0) {   // CAMERA7 rev 2: the final pass into a frame, then the unsharp mask onto the canvas
      if (!this.sharpRT) this.sharpRT = rt(this.W, this.H, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
      this._gpuPass('display', () => { r.setRenderTarget(this.sharpRT); (this.finalSSQ || this.finalQ).render(r); });
      const u = this.sharpQ.material.uniforms; u.tIn.value = this.sharpRT.texture; u.uSh.value.set(c7.sharpen.sigma * this.H / 1350, c7.sharpen.amount, c7.sharpen.thr ?? 0);
      this._gpuPass('sharpen', () => { r.setRenderTarget(null); this.sharpQ.render(r); }); return;
    }
    this._gpuPass('display', () => { r.setRenderTarget(null); (this.finalSSQ || this.finalQ).render(r); });
  }
  // show one buffer raw (pre: normals / depth, sso: ao/contact, vol: in-scatter, main: the forward pass, acc, mirror)
  debugView(which, gain = 1) {
    if (!this.dbgQ) this.dbgQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, uniforms: { tIn: { value: null }, uMode: { value: 0 }, uGain: { value: 1 } },
      fragmentShader: `varying vec2 vUv; uniform sampler2D tIn; uniform float uMode, uGain; void main(){ vec4 c = texture2D(tIn, vUv);
        vec3 o = uMode < 0.5 ? c.rgb * 0.5 + 0.5 : uMode < 1.5 ? vec3(c.a * 10.0) : uMode < 2.5 ? c.rgb : uMode < 3.5 ? vec3(c.a) : c.rgb * uGain;
        gl_FragColor = vec4(pow(clamp(o * (uMode > 3.5 ? 1.0 : uGain), 0.0, 1.0), vec3(1.0 / 2.2)), 1.0); }` }));
    const m = { pre: [this.pre, 0], depth: [this.pre, 1], sso: [this.sso2, 2], volT: [this.vol, 3], vol: [this.vol, 4], main: [this.main, 4], acc: [this.acc, 4], mirror: [this.mirrorRT || this.main, 4] }[which];
    this.dbgQ.material.uniforms.tIn.value = m[0].texture; this.dbgQ.material.uniforms.uMode.value = m[1]; this.dbgQ.material.uniforms.uGain.value = gain;
    this._gpuPass('debug_view', () => { this.renderer.setRenderTarget(null); this.dbgQ.render(this.renderer); });
  }
  // wait for the GPU before reading a timer (the critique's W8: the Stage's 61-90 ms "second frames" were not real)
  sync() { const gl = this.renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
}

// CAMERA7: the final pass sources, for the offline GLSL compile check (labs/human8/camera7_test.mjs; no GL needed)
export const _GLSL7 = { FINAL_FRAG, FINAL_SS, SHARP_FRAG };
