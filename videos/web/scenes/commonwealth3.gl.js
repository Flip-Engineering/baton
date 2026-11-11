// COMMON WEALTH v8: shaders. The storm is a raymarched volume over the plain (quarter res, depth-aware),
// composited with height fog, the sky, god rays and a filmic tonemap. Wheat and terrain inject into three's
// lit materials so lightning, sun and shadows act on them.

export const NOISE = /* glsl */`
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise3(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float vnoise2(vec2 x){
  vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1,0)), f.x), mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), f.x), f.y);
}
float fbm2(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise2(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

// terrain height, identical in JS (world.js hgt)
export const HEIGHT = /* glsl */`
float hgt(vec2 p){
  return 3.0 * sin(p.x * 0.0021 + 1.3) * sin(p.y * 0.0017 + 0.4) + 1.2 * sin(p.x * 0.0063 - p.y * 0.0041) + 0.3 * sin(p.x * 0.021 + p.y * 0.017);
}
`;

export const FSQ_VS = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// ---------------------------------------------------------------- the storm volume (quarter res)
export const VOL_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform mat4 uInvProj, uCamWorld;
uniform vec3 uCam;
uniform float uTime, uFrame;
uniform float uBase, uTop, uCover, uDens, uRain, uHoleR, uEdge;
uniform vec2 uHoleC, uWind;
uniform vec3 uCloudLo, uCloudHi, uRainCol, uHorCol;
uniform vec3 uBoltPos, uBoltCol; uniform float uBoltI;
uniform vec3 uSunDir, uSunCol; uniform float uUnder, uNightGlow;       // uUnder: low sun lighting the cloud undersides (dawn)
uniform vec4 uShelf;                                         // shelf cloud: (x0, z0 of its front line, angle, strength)
${NOISE}
float cloudD(vec3 p, out float hf){
  float lump = vnoise2(p.xz * 0.0011 + uWind * 0.3) * 420.0 + vnoise2(p.xz * 0.004) * 120.0;
  float base = uBase + lump - 260.0;
  // the shelf: a low dark wedge along a front line, the leading edge of the storm
  vec2 fd = vec2(cos(uShelf.z), sin(uShelf.z));
  float along = dot(p.xz - uShelf.xy, fd);
  float shelf = uShelf.w * smoothstep(-2500.0, 0.0, along) * smoothstep(3500.0, 600.0, along);
  base -= shelf * 650.0;
  hf = (p.y - base) / (uTop - base);
  if (hf < 0.0 || hf > 1.0) return 0.0;
  vec3 q = p * 0.00042 + vec3(uWind.x, 0.0, uWind.y);
  float n = vnoise3(q) * 0.54 + vnoise3(q * 2.1 + 3.1) * 0.29 + vnoise3(q * 4.3 + 7.7) * 0.17;
  float r = length(p.xz - uHoleC);
  float cov = uCover + shelf * 0.35 - (1.0 - smoothstep(uHoleR * 0.55, uHoleR, r)) * 1.2;
  cov -= uEdge * smoothstep(-500.0, 5000.0, dot(p.xz - uHoleC, normalize(vec2(1.0, 0.25))));   // the storm moving off, clear toward the dawn
  float shape = smoothstep(0.0, 0.08, hf) * smoothstep(1.0, 0.45, hf);
  return clamp((n + cov - 1.0) * 3.2, 0.0, 1.0) * shape;
}
void main(){
  vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 vv = uInvProj * ndc; vv /= vv.w;
  vec3 dir = normalize((uCamWorld * vec4(vv.xyz, 0.0)).xyz);
  float d = texture2D(tDepth, vUv).x;
  float dist = 1e7;
  if (d < 1.0) { vec4 pv = uInvProj * vec4(ndc.xy, d * 2.0 - 1.0, 1.0); pv /= pv.w; dist = length(pv.xyz); }
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.618);
  vec3 S = vec3(0.0); float T = 1.0;
  // -- cloud slab
  float y0 = uBase - 1000.0, y1 = uTop;
  float ta, tb;
  if (abs(dir.y) < 1e-4) { ta = (uCam.y > y0 && uCam.y < y1) ? 0.0 : 1e9; tb = 60000.0; }
  else { float a = (y0 - uCam.y) / dir.y, b = (y1 - uCam.y) / dir.y; ta = max(0.0, min(a, b)); tb = max(a, b); }
  tb = min(min(tb, dist), ta + 42000.0);
  if (tb > ta && uDens > 0.0) {
    const int N = 30;
    float len = tb - ta, dt = len / float(N);
    for (int i = 0; i < N; i++) {
      float tt = ta + (float(i) + jit) * dt;
      vec3 p = uCam + dir * tt;
      float hf; float den = cloudD(p, hf);
      if (den > 0.001) {
        float sig = den * uDens * dt;
        float a = 1.0 - exp(-sig);
        float hf2; float occ = cloudD(p + vec3(120.0, 420.0, 60.0), hf2);
        vec3 lum = mix(uCloudLo, uCloudHi, clamp(hf * 1.4, 0.0, 1.0)) * exp(-occ * 2.2) * (1.15 - 0.4 * den);
        lum += uSunCol * uUnder * (1.0 - smoothstep(0.0, 0.45, hf)) * (0.6 + 0.8 * vnoise3(p * 0.0021));
        lum += vec3(1.0, 0.42, 0.14) * 0.09 * uNightGlow * (1.0 - smoothstep(0.0, 0.35, hf)) * (0.5 + vnoise3(p * 0.0017));   // the lit plain on the cloud bases
        float bd = length(p - uBoltPos);
        lum += uBoltCol * uBoltI * 1.2 * exp(-bd / 1400.0);
        float far = 1.0 - exp(-tt / 30000.0);
        lum = mix(lum, uHorCol, far * 0.75);
        S += T * a * lum; T *= 1.0 - a;
        if (T < 0.02) break;
      }
    }
  }
  // -- rain shafts under the base
  if (uRain > 0.0 && T > 0.02) {
    float tr1 = min(dist, 16000.0);
    const int M = 12;
    float dt = tr1 / float(M);
    for (int i = 0; i < M; i++) {
      float tt = (float(i) + jit) * dt;
      vec3 p = uCam + dir * tt;
      if (p.y > uBase) continue;
      vec2 rq = p.xz * vec2(0.00045, 0.0009) + vec2(uTime * 0.02, 0.0) + (p.y * 0.00012) * uWind;
      float col = smoothstep(0.48, 0.72, vnoise2(rq) * 0.7 + vnoise2(rq * 3.1) * 0.3);
      float den = col * uRain * 0.00028 * smoothstep(700.0, 2500.0, tt) * (0.35 + 0.65 * smoothstep(0.0, uBase, p.y + 300.0));
      float a = 1.0 - exp(-den * dt);
      vec3 lum = uRainCol + uBoltCol * uBoltI * 0.18 * exp(-length(p - uBoltPos) / 2000.0);
      S += T * a * lum; T *= 1.0 - a;
    }
  }
  gl_FragColor = vec4(S, T);
}
`;

// ---------------------------------------------------------------- composite: sky, fog, volume, god rays, tonemap
export const COMP_FS = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor, tDepth, tVol;
uniform vec2 uVolRes;
uniform mat4 uInvProj, uCamWorld, uViewProj;
uniform vec3 uCam;
uniform vec3 uZen, uHor, uGnd, uSunDir, uSunCol, uFogCol;
uniform float uSunDisc, uFogD, uFogH, uExpo, uRays, uFlash, uTime, uStars, uGlowHor;
uniform vec3 uFlashCol, uGlowCol;
uniform vec2 uSunUV;
${NOISE}
vec3 sky(vec3 dir){
  float el = dir.y;
  vec3 c = mix(uHor, uZen, pow(clamp(el, 0.0, 1.0), 0.45));
  c = mix(c, uGnd, smoothstep(0.0, -0.08, el));
  float s = max(dot(dir, uSunDir), 0.0);
  c += uSunCol * (pow(s, 6.0) * 0.55 + pow(s, 64.0) * 1.2) * (0.4 + 0.6 * smoothstep(-0.05, 0.2, el + 0.1));
  c += uSunCol * uSunDisc * smoothstep(0.9993, 0.99965, s) * 30.0;
  c += uGlowCol * uGlowHor * exp(-max(el, 0.0) * 18.0);
  if (uStars > 0.0 && el > 0.05) {
    vec2 sp = dir.xz / (dir.y + 0.4) * 900.0;
    float h = hash12(floor(sp));
    c += uStars * step(0.9975, h) * smoothstep(0.5, 0.0, length(fract(sp) - 0.5)) * vec3(0.8, 0.85, 1.0) * 1.5;
  }
  return c;
}
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float lin(float d){ vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return 0.0; }
void main(){
  vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 vv = uInvProj * ndc; vv /= vv.w;
  vec3 dir = normalize((uCamWorld * vec4(vv.xyz, 0.0)).xyz);
  float d = texture2D(tDepth, vUv).x;
  vec3 col;
  float dist = 1e7;
  if (d >= 1.0) col = sky(dir);
  else {
    vec4 pv = uInvProj * vec4(ndc.xy, d * 2.0 - 1.0, 1.0); pv /= pv.w; dist = length(pv.xyz);
    col = texture2D(tColor, vUv).rgb;
    // height fog: integrated exponential density along the ray
    float h0 = uCam.y, h1 = uCam.y + dir.y * dist;
    float k = 1.0 / uFogH;
    float od = abs(dir.y) > 1e-3 ? uFogD * (exp(-h0 * k) - exp(-h1 * k)) / (dir.y * k) * 1.0 : uFogD * exp(-h0 * k) * dist;
    od = max(od, 0.0);
    float f = 1.0 - exp(-od);
    vec3 fc = mix(uFogCol, sky(normalize(vec3(dir.x, 0.02, dir.z))), 0.5);
    col = mix(col, fc, f);
  }
  // depth-aware volume upsample
  vec2 tp = vUv * uVolRes - 0.5; vec2 b = floor(tp), fr = tp - b;
  vec4 acc = vec4(0.0); float wsum = 0.0;
  float ld = d >= 1.0 ? 1e7 : dist;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 uv = (b + vec2(float(i), float(j)) + 0.5) / uVolRes;
    float dd = texture2D(tDepth, uv).x;
    float od = 1e7;
    if (dd < 1.0) { vec4 pv = uInvProj * vec4(uv * 2.0 - 1.0, dd * 2.0 - 1.0, 1.0); pv /= pv.w; od = length(pv.xyz); }
    float wb = (i == 0 ? 1.0 - fr.x : fr.x) * (j == 0 ? 1.0 - fr.y : fr.y);
    float wd = 1.0 / (0.02 + abs(log(od + 1.0) - log(ld + 1.0)) * 6.0);
    float w = wb * wd + 1e-5;
    acc += texture2D(tVol, uv) * w; wsum += w;
  }
  vec4 vol = acc / wsum;
  col = col * vol.a + vol.rgb;
  // god rays: march toward the sun's screen position through the volume transmittance
  if (uRays > 0.0) {
    vec2 dlt = (uSunUV - vUv) / 20.0; vec2 uv = vUv; float acc2 = 0.0;
    float jit = hash12(gl_FragCoord.xy);
    uv += dlt * jit;
    for (int i = 0; i < 20; i++) {
      uv += dlt;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
      float dd = texture2D(tDepth, uv).x;
      acc2 += step(0.9999, dd) * texture2D(tVol, uv).a * (1.0 - float(i) / 22.0);
    }
    float sd = length((uSunUV - vUv) * vec2(1.0, 1.7777));
    col += uSunCol * uRays * acc2 / 20.0 * exp(-sd * 2.2);
  }
  col += uFlashCol * uFlash;
  col *= uExpo;
  col = aces(col);
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}
`;
