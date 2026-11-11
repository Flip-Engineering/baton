// ATMOS3D (WORLDS studio c1): light and atmosphere that carry the frame. Opt-in; nothing here changes world3d.js defaults.
//
//   const A = new Atmos(world, LOOKS3.PLAINS_NIGHT)      or   new World({ atmos: LOOKS3.PLAINS_NIGHT })
//   A.render(cam)                                          (World.render(cam) delegates when the world has .atmos)
//
// Pipeline (all linear HDR until the last pass):
//   1. scene -> rtC (half float colour + float depth texture), no tonemapping, no three fog
//   2. sky + clouds on sky pixels; aerial perspective on geometry: exponential height haze integrated along the ray,
//      its in-scatter = the horizon sky in that direction (+ sun/moon forward scatter), so land dissolves into sky
//      (Luminism) instead of greying toward a fog colour after tonemap (the old lift that killed the blacks)
//   3. emissive overlay (LightField points, plumes, rain, bolts) -> rtE, occluded by the scene depth in-shader, fogged in-shader
//   4. dual-Kawase bloom over (2 + 3): the haze halo; strength follows haze density
//   5. exposure keyed to the practicals, ACES, the night value rule (black floor, white point, cool shadow fill), grain
// LightField: every practical is one record -> a sprite (core + halo) in the overlay AND a pool in a top-down lightmap
// that ground and standard materials sample (patchMaterial), so a thousand lamps light the ground in one draw.
// Clouds carry town skyglow (sodium under-lighting on the cloud base above each town) and lightning.
import * as THREE from 'three';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const col3 = (c) => (c instanceof THREE.Color ? c : new THREE.Color(...(Array.isArray(c) ? c : [c])));
const lin = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);   // sRGB hex -> linear, scaled (HDR)

// ------------------------------------------------------------------ shared uniforms (sky, haze, clouds): one object, many shaders
export function makeAtmosUniforms() {
  const V = () => ({ value: new THREE.Vector3() }), Cc = () => ({ value: new THREE.Color() });
  return {
    uSZen: Cc(), uSHorSun: Cc(), uSHorAnti: Cc(), uSBelt: Cc(), uSSunDir: V(), uSSunCol: Cc(), uSMoonDir: V(), uSMoonCol: Cc(),
    uSGlowCol: Cc(), uSGlow: { value: new THREE.Vector4(0, -1, 4, 6) }, uSSunDisk: { value: 0 }, uSStars: { value: 0 }, uSHorExp: { value: 0.45 },
    uHazeAmb: Cc(), uHazeFar: { value: 20000 },
    uFogD: { value: 0.0001 }, uFogH: { value: 600 }, uFogY0: { value: 0 }, uHazeGain: { value: 1 }, uHazeSun: { value: 0.5 },
    uCamPos: V(), uTime: { value: 0 },
    uCloudOn: { value: 0 }, uCloudH: { value: 1500 }, uCloudScale: { value: 1 / 2400 }, uCover: { value: 0.5 }, uSoft: { value: 0.15 },
    uCloudAmb: Cc(), uCloudSun: { value: 0 }, uCloudFade: { value: 1 / 30000 }, uWind: { value: new THREE.Vector2(0.002, 0.001) },
    uTowns: { value: Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, 1, 0)) }, uTownCol: Cc(), uNTowns: { value: 0 },
    uFlash: { value: new THREE.Vector4(0, 0, 0, 0) }, uFlashCol: { value: new THREE.Color(0.75, 0.82, 1) }, uFlashR: { value: 3000 },
    // c1 pass 2 (opt-in by look): the painted depth ramp (Firewatch), the horizon dissolve
    tRamp: { value: null }, uRampOn: { value: 0 }, uRampN: { value: 60 }, uRampF: { value: 30000 }, uRampMix: { value: 1 }, uRampH: { value: 900 },
    uHorBand: { value: 0.03 }, uHorAmt: { value: 0 },
  };
}

// GLSL shared by the post pass, ground shaders (water reflects the sky), clouds and sprites.
export const ATMOS_GLSL = /* glsl */`
uniform vec3 uSZen, uSHorSun, uSHorAnti, uSBelt, uSSunDir, uSSunCol, uSMoonDir, uSMoonCol, uSGlowCol;
uniform vec4 uSGlow; uniform float uSSunDisk, uSStars, uSHorExp;
uniform float uFogD, uFogH, uFogY0, uHazeGain, uHazeSun; uniform vec3 uCamPos; uniform float uTime;
float a_hg(float c, float g){ float g2 = g*g; return (1.-g2) / (12.566 * pow(max(1.+g2-2.*g*c, 1e-4), 1.5)); }
float a_h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float a_n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(a_h21(i), a_h21(i+vec2(1,0)), f.x), mix(a_h21(i+vec2(0,1)), a_h21(i+vec2(1,1)), f.x), f.y); }
float a_fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a*a_n2(p); p = mat2(1.6,1.2,-1.2,1.6)*p + 3.1; a *= .5; } return s; }
vec3 skyBase(vec3 d){
  float h = d.y; vec2 dx = normalize(d.xz + 1e-5), sx = normalize(uSSunDir.xz + 1e-5);
  float az = dot(dx, sx)*.5 + .5;
  vec3 hor = mix(uSHorAnti, uSHorSun, az*az*az);
  float hh = clamp(h, 0., 1.);
  vec3 c = mix(hor, uSZen, pow(smoothstep(-.01, uSHorExp, hh), .8));   // uSHorExp: sine of the elevation where the zenith colour is reached
  c += uSBelt * pow(1.-az, 2.) * exp(-pow((h-.07)/.07, 2.));           // belt of Venus opposite the sun
  float ga = max(dot(dx, normalize(uSGlow.xy + 1e-5)), 0.);
  c += uSGlowCol * pow(ga, uSGlow.z) * exp(-max(h, 0.)*uSGlow.w);      // city dome on the horizon
  if (h < 0.) c = mix(c, hor*.35, clamp(-h*6., 0., 1.));
  return c;
}
vec3 sunScatter(vec3 d){ float c = dot(d, normalize(uSSunDir)); float m = dot(d, normalize(uSMoonDir));
  return uSSunCol*(a_hg(c, .76)*.55 + a_hg(c, .25)*.2) + uSMoonCol*(a_hg(m, .8)*.5); }
vec3 skyCol(vec3 d){
  vec3 c = skyBase(d) + sunScatter(d);
  c += uSSunCol * uSSunDisk * smoothstep(.99988, .99992, dot(d, normalize(uSSunDir)));
  c += uSMoonCol * 60. * smoothstep(.99993, .99996, dot(d, normalize(uSMoonDir)));
  if (uSStars > 0. && d.y > 0.) { vec3 sp = d * 700.; vec3 ci = floor(sp); float r = fract(sin(dot(ci, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    vec3 jit = vec3(fract(r*13.1), fract(r*71.7), fract(r*37.3)) * .6 + .2;
    float s = step(.985, r) * smoothstep(.35, .05, length(fract(sp) - jit)) * pow(fract(r*91.3), 3.) * 3.;
    c += vec3(.8,.85,1.)*s*uSStars*smoothstep(0., .15, d.y); }
  return c;
}
uniform vec3 uHazeAmb; uniform float uHazeFar;
vec3 hazeCol(vec3 d){ vec3 dh = normalize(vec3(d.x, max(d.y, 0.)*.25 + .015, d.z)); return (skyBase(dh) + sunScatter(d)*uHazeSun) * uHazeGain; }
// in-scatter over a path of length s: near air is lit by the dome (uHazeAmb, + the sun's forward lobe when it is up);
// only long paths reach the horizon sky's radiance, so the land dissolves into the sky at distance, not at the feet
vec3 hazeAt(vec3 d, float s){ return mix(uHazeAmb + sunScatter(d)*uHazeSun*step(0., uSSunDir.y), hazeCol(d), smoothstep(0., uHazeFar, s)); }
// optical depth of the height haze from the camera along unit dir d over distance s
float hazeTau(vec3 d, float s){
  float k = uFogD * exp(-(uCamPos.y - uFogY0) / uFogH);
  float dy = d.y * s / uFogH;
  return abs(dy) < 1e-3 ? k*s : k*s*(1.-exp(-dy))/dy;
}
// the painted depth ramp (look.ramp): colour by depth (anti-sun row v=.25, sun-side row v=.75), alpha = the authored
// minimum haze at that depth. The amount stays physical (hazeTau) but never falls under the painted value plan.
uniform sampler2D tRamp; uniform float uRampOn, uRampN, uRampF, uRampMix, uHorBand, uHorAmt;
float rampU(float s){ return clamp(log(max(s, 1.) / uRampN) / log(uRampF / uRampN), 0., 1.); }
vec4 rampAt(vec3 d, float s){ vec2 dx = normalize(d.xz + 1e-5), sx = normalize(uSSunDir.xz + 1e-5); float az = dot(dx, sx)*.5 + .5;
  float u = rampU(s); return mix(texture2D(tRamp, vec2(u, .25)), texture2D(tRamp, vec2(u, .75)), az*az*az); }
uniform float uRampH;
// the painted minimum belongs to the land: it thins with the height of the point (clouds and tower tops keep their own air)
float fogTr(vec3 d, float s){ float tr = exp(-hazeTau(d, s)); if (uRampOn > .5) { float hk = exp(-max(uCamPos.y + d.y*s - uFogY0, 0.) / uRampH); tr = min(tr, 1. - rampAt(d, s).a * hk); } return tr; }
vec3 skyHor(vec3 d){ vec3 h = normalize(vec3(d.x, .004, d.z)); return skyBase(h) + sunScatter(h); }   // the sky's own colour at the horizon
// the painted ramp holds the near and middle planes; its last fifth melts into the sky's own horizon colour (no ruled line)
vec3 fogCol(vec3 d, float s){ vec3 h = hazeAt(d, s); if (uRampOn > .5) { float u = rampU(s); h = mix(h, rampAt(d, s).rgb, uRampMix); h = mix(h, skyHor(d), smoothstep(.8, 1., u) * uHorAmt); } return h; }
vec3 horizonCol(vec3 d){ return uRampOn > .5 ? skyHor(d) : hazeCol(d); }
`;

// clouds + skyglow + lightning for a sky direction, composited over c (used by the post pass on sky pixels)
const CLOUD_GLSL = /* glsl */`
uniform float uCloudOn, uCloudH, uCloudScale, uCover, uSoft, uCloudSun, uCloudFade, uNTowns, uFlashR;
uniform vec3 uCloudAmb, uTownCol, uFlashCol; uniform vec2 uWind; uniform vec4 uTowns[16]; uniform vec4 uFlash;
vec3 cloudLight(vec2 p, float dens){
  vec3 l = uCloudAmb;
  for (int i = 0; i < 16; i++){ if (float(i) >= uNTowns) break; vec4 T = uTowns[i]; vec2 q = p - T.xz;
    l += uTownCol * T.w / (1. + dot(q, q) / (T.y*T.y)); }                // sodium on the cloud base above each town
  vec2 f = p - uFlash.xy; l += uFlashCol * uFlash.w / (1. + dot(f, f) / (uFlashR*uFlashR));
  return l;
}
vec3 clouds(vec3 d, vec3 c){
  if (uCloudOn < .5 || d.y < .003 || uCamPos.y > uCloudH) return c;
  float t = (uCloudH - uCamPos.y) / d.y; vec2 p = uCamPos.xz + d.xz*t;
  vec2 q = p*uCloudScale + uWind*uTime;
  float n = a_fbm(q + .6*vec2(a_fbm(q*.5+7.), a_fbm(q*.5+3.)));
  float a = smoothstep(uCover, uCover + uSoft, n);
  if (a <= 0.) return c;
  float th = smoothstep(uCover + uSoft, uCover + uSoft + .3, n);
  vec3 cl = cloudLight(p, th) * mix(1., .6, th);
  float sc = dot(d, normalize(uSSunDir));
  cl += uSSunCol * uCloudSun * (.35 + 2.5*a_hg(sc, .55)) * mix(1., .35, th);   // low sun under-lights the cloud base
  cl += uSMoonCol * .15 * (1. - th*.6);
  vec3 cc = mix(cl, hazeCol(d), 1. - exp(-t*uCloudFade));
  return mix(c, cc, a * smoothstep(.003, .05, d.y));
}
`;

const FS_QUAD_V = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';

// ------------------------------------------------------------------ looks: sky, haze, clouds, grade, value rule
// colours are sRGB hex scaled into linear HDR; exposure keys the practicals. floor/white: display-space levels.
export const LOOKS3 = {
  PLAINS_DUSK: {
    sky: { zen: ['#1a2c78', 0.4], horSun: ['#ff5418', 1.3], horAnti: ['#6a5a90', 0.3], belt: ['#a0587a', 0.12], horExp: 0.34 },
    sun: { dir: [-1, -0.03, -0.18], color: ['#ff7028', 0.5], disk: 0, light: 0 },
    key: { dir: [-1, 0.12, -0.15], color: ['#ff9a56'], light: 0.32 },      // the afterglow: a huge soft source low in the west
    moon: { dir: [0.6, 0.35, 0.3], color: ['#9fb4ff', 0.02] },
    hemi: { sky: ['#6878b8', 0.5], ground: ['#3a2818', 0.12] },
    fog: { d: 0.00009, h: 1000, gain: 1, sun: 0.35, amb: ['#4a4868', 0.16], far: 32000 },
    clouds: { on: 1, h: 3200, scale: 1 / 5200, cover: 0.6, soft: 0.16, amb: ['#2a2a4a', 0.1], sun: 1.0, fade: 1 / 60000 },
    exposure: 1.05, bloom: 0.08, floor: 0.06, white: 0.9, sat: 1.05, contrast: 1.15, shadowTint: [0.0, 0.004, 0.018], grain: 0.018,
  },
  PLAINS_NIGHT: {
    sky: { zen: ['#050814', 0.05], horSun: ['#1a1c30', 0.05], horAnti: ['#141828', 0.05], belt: ['#000000', 0], horExp: 0.4, stars: 0.3,
      glow: { color: ['#ff8a40', 0.03], dir: [-1, 0], pow: 0.5, fall: 30 } },          // the horizon's collective sodium: towns past the edge of the world
    sun: { dir: [-1, -0.4, 0.1], color: ['#000000', 0], disk: 0, light: 0 },
    moon: { dir: [0.5, 0.32, -0.6], color: ['#8fa8ff', 0.05], light: 0.06 },
    hemi: { sky: ['#30406a', 0.02], ground: ['#0a0806', 0.0] },
    fog: { d: 0.00008, h: 700, gain: 1, sun: 0.2 },
    clouds: { on: 1, h: 1600, scale: 1 / 4200, cover: 0.44, soft: 0.2, amb: ['#101428', 0.012], sun: 0, fade: 1 / 60000 },
    towns: { color: ['#ff9a48', 1] }, lightGain: 3,
    exposure: 2.8, bloom: 0.14, floor: 0.03, white: 0.86, sat: 1.1, contrast: 1.15, shadowTint: [0.0, 0.004, 0.016], grain: 0.02,
  },
  HIGHWAY_RAIN: {
    sky: { zen: ['#0a0a10', 0.02], horSun: ['#3a2418', 0.035], horAnti: ['#241c16', 0.03], belt: ['#000000', 0], horExp: 0.5,
      glow: { color: ['#c8764a', 0.05], dir: [0, -1], pow: 2, fall: 7 } },                 // the city ahead, lighting the rain cloud
    sun: { dir: [0, -0.5, 1], color: ['#000000', 0], disk: 0, light: 0 },
    moon: { dir: [0.3, 0.5, 0.4], color: ['#7f98c0', 0.0], light: 0.0 },
    hemi: { sky: ['#3a3a48', 0.035], ground: ['#100c0a', 0.0] },
    fog: { d: 0.0032, h: 120, gain: 1, sun: 0, amb: ['#30281f', 0.012], far: 2500 },
    clouds: { on: 1, h: 600, scale: 1 / 1500, cover: 0.25, soft: 0.5, amb: ['#2a2018', 0.012], sun: 0, fade: 1 / 4000 },
    towns: { color: ['#c87a48', 1] },
    exposure: 2.0, bloom: 0.2, floor: 0.04, white: 0.86, sat: 1.05, contrast: 1.12, shadowTint: [0.0, 0.006, 0.012], grain: 0.022,
  },
  PLANT_NIGHT: {
    sky: { zen: ['#060812', 0.05], horSun: ['#1e1820', 0.08], horAnti: ['#161a2a', 0.07], belt: ['#000000', 0], horExp: 0.45, stars: 0.15 },
    sun: { dir: [0, -0.5, 1], color: ['#000000', 0], disk: 0, light: 0 },
    moon: { dir: [-0.5, 0.35, -0.7], color: ['#8ea6e0', 0.05], light: 0.06 },
    hemi: { sky: ['#2a3450', 0.02], ground: ['#0c0806', 0.0] },
    fog: { d: 0.00075, h: 160, gain: 1, sun: 0.3 },
    clouds: { on: 1, h: 1300, scale: 1 / 2600, cover: 0.45, soft: 0.3, amb: ['#141828', 0.015], sun: 0, fade: 1 / 25000 },
    towns: { color: ['#ff9448', 1] },
    exposure: 2.3, bloom: 0.16, floor: 0.035, white: 0.86, sat: 1.1, contrast: 1.12, shadowTint: [0.0, 0.004, 0.016], grain: 0.02,
  },
  CITY_NIGHT: {
    sky: { zen: ['#070a18', 0.06], horSun: ['#40243a', 0.14], horAnti: ['#221c34', 0.1], belt: ['#000000', 0], horExp: 0.5 },
    sun: { dir: [0, -0.5, 1], color: ['#000000', 0], disk: 0, light: 0 },
    moon: { dir: [0.4, 0.3, -0.7], color: ['#90a8e8', 0.03], light: 0.04 },
    hemi: { sky: ['#283050', 0.03], ground: ['#0c0806', 0.0] },
    fog: { d: 0.00032, h: 380, gain: 1, sun: 0, amb: ['#3a3a5e', 0.05], far: 9000 },           // lit city haze: rows go lighter and bluer (Mead)
    clouds: { on: 1, h: 900, scale: 1 / 2200, cover: 0.4, soft: 0.35, amb: ['#141428', 0.02], sun: 0, fade: 1 / 20000 },
    towns: { color: ['#ff8a48', 1] },
    exposure: 2.1, bloom: 0.16, floor: 0.04, white: 0.86, sat: 1.12, contrast: 1.12, shadowTint: [0.0, 0.004, 0.018], grain: 0.02,
  },
  STORM: {                                                                  // low sun behind the camera (south-west), storm to the north
    sky: { zen: ['#3a4c66', 0.5], horSun: ['#ffc070', 2.0], horAnti: ['#b89080', 0.55], belt: ['#d08a90', 0.25], horExp: 0.3 },
    sun: { dir: [-0.45, 0.16, 0.88], color: ['#ffb060', 1.2], disk: 0, light: 2.4 },
    moon: { dir: [0, 1, 0], color: ['#000000', 0] },
    hemi: { sky: ['#5a6878', 0.45], ground: ['#3a2c14', 0.12] },
    fog: { d: 0.00005, h: 900, gain: 1, sun: 0.3, amb: ['#6a7078', 0.12], far: 30000 },
    clouds: { on: 0 },
    exposure: 1.1, bloom: 0.06, floor: 0.05, white: 0.88, sat: 1.08, contrast: 1.2, shadowTint: [0.0, 0.004, 0.012], grain: 0.018,
  },
};

// ------------------------------------------------------------------ pass 2: art-directed looks (painted ramp, horizon dissolve, decks)
// The c1 looks above are unchanged. Each _AD look = physics for the amount, a painted value plan for the colour (Firewatch),
// the land lit by the sky (Days of Heaven), the horizon dissolved (Church).
const AD = (base, over) => ({ ...base, ...over });
LOOKS3.PLAINS_DUSK_AD = AD(LOOKS3.PLAINS_DUSK, {
  sky: { zen: ['#1a2c78', 0.4], horSun: ['#ff5418', 0.8], horAnti: ['#6a5a90', 0.3], belt: ['#a0587a', 0.12], horExp: 0.3 },
  sun: { dir: [-1, -0.03, -0.18], color: ['#ff7028', 0.3], disk: 0, light: 0 },
  key: { dir: [-1, 0.12, -0.15], color: ['#ff9a56'], light: 0.9 },
  hemi: { sky: ['#b898b8', 1.3], ground: ['#4a3020', 0.3] },                               // the land takes the dome (Days of Heaven)
  fog: { d: 0.00009, h: 1000, gain: 1, sun: 0.35, amb: ['#5a5078', 0.25], far: 32000 },
  clouds: { on: 0 },
  ramp: { near: 80, far: 32000, mix: 0.85, stops: [
    { d: 0, c: '#6a5470', k: 0.25, a: 0.04, sun: '#8a5a58', ks: 0.3 }, { d: 0.3, c: '#6a5480', k: 0.3, a: 0.08, sun: '#b06a58', ks: 0.4 },
    { d: 0.55, c: '#7a6090', k: 0.35, a: 0.2, sun: '#e0784a', ks: 0.55 }, { d: 0.8, c: '#8a6a90', k: 0.4, a: 0.5, sun: '#ff7a40', ks: 0.75 },
    { d: 0.93, c: '#9a7090', k: 0.4, a: 0.9, sun: '#ff6a28', ks: 0.85 }, { d: 1, c: '#9a7090', k: 0.4, a: 1, sun: '#ff6a28', ks: 0.85 } ] },
  horizon: { amt: 0.9, band: 0.025 },
  exposure: 1.05, floor: 0.04,
});

LOOKS3.PLAINS_NIGHT_AD = AD(LOOKS3.PLAINS_NIGHT, {
  sky: { zen: ['#050814', 0.05], horSun: ['#1a1c30', 0.05], horAnti: ['#141828', 0.05], belt: ['#000000', 0], horExp: 0.4, stars: 0.25,
    glow: { color: ['#ff8a40', 0.05], dir: [-1, 0], pow: 0.6, fall: 26 } },
  moon: { dir: [0.5, 0.32, -0.6], color: ['#8fa8ff', 0.05], light: 0.04 },
  hemi: { sky: ['#30406a', 0.025], ground: ['#0a0806', 0.0] },                            // moon + skyglow: black land that still has form
  clouds: { on: 0 },
  ramp: { near: 150, far: 40000, mix: 0.9, height: 700, stops: [
    { d: 0, c: '#0a0c14', k: 0.02, a: 0 }, { d: 0.45, c: '#141620', k: 0.03, a: 0.04 },
    { d: 0.75, c: '#2a2020', k: 0.04, a: 0.18, sun: '#302018', ks: 0.05 }, { d: 1, c: '#4a3024', k: 0.05, a: 0.7, sun: '#5a3420', ks: 0.06 } ] },
  horizon: { amt: 0.8, band: 0.03 },
  deck: { top: 40, dens: 0.0005, light: 0.06, amb: 1, color: ['#1a2030', 0.004], lod: 4 },   // radiation fog in the low ground: the towns glow inside it
  exposure: 2.8, bloom: 0.16, floor: 0.03,
});

LOOKS3.PLANT_NIGHT_AD = AD(LOOKS3.PLANT_NIGHT, {
  sky: { zen: ['#060812', 0.05], horSun: ['#1e1820', 0.08], horAnti: ['#161a2a', 0.07], belt: ['#000000', 0], horExp: 0.45, stars: 0.12,
    glow: { color: ['#ff9a50', 0.1], dir: [0, -1], pow: 2.5, fall: 9 } },                   // the plant's own sodium dome in the haze behind it
  moon: { dir: [-0.5, 0.35, -0.7], color: ['#8ea6e0', 0.06], light: 0.05 },
  clouds: { on: 1, h: 1300, scale: 1 / 2600, cover: 0.5, soft: 0.3, amb: ['#141828', 0.015], sun: 0, fade: 1 / 25000 },
  ramp: { near: 200, far: 12000, mix: 0.9, height: 450, stops: [                             // Hades: each row lighter and warmer into the sodium haze
    { d: 0, c: '#0a0a10', k: 0.02, a: 0 }, { d: 0.35, c: '#2a1c14', k: 0.06, a: 0.04 }, { d: 0.52, c: '#5a3a24', k: 0.14, a: 0.14 },
    { d: 0.68, c: '#6a4a3a', k: 0.2, a: 0.3 }, { d: 0.84, c: '#5a4a50', k: 0.2, a: 0.5 }, { d: 1, c: '#4a4a60', k: 0.18, a: 0.7 } ] },
  horizon: { amt: 0.8, band: 0.03 },
  deck: { top: 30, dens: 0.0009, light: 0.12, amb: 1, color: ['#161a26', 0.004], lod: 3 },
  exposure: 2.4, bloom: 0.16,
});

LOOKS3.HIGHWAY_RAIN_AD = AD(LOOKS3.HIGHWAY_RAIN, {
  sky: { zen: ['#0a0a10', 0.02], horSun: ['#3a2418', 0.04], horAnti: ['#241c16', 0.035], belt: ['#000000', 0], horExp: 0.5,
    glow: { color: ['#c8764a', 0.06], dir: [0, -1], pow: 2, fall: 7 } },
  ramp: { near: 25, far: 7000, mix: 0.85, height: 250, stops: [                              // wet black near, sodium spray at the overpass, the town's brown glow at the end
    { d: 0, c: '#0a0908', k: 0.01, a: 0 }, { d: 0.35, c: '#1c1612', k: 0.02, a: 0.06 }, { d: 0.6, c: '#3a2a1e', k: 0.035, a: 0.25 },
    { d: 0.82, c: '#4a3424', k: 0.04, a: 0.55 }, { d: 1, c: '#4a3426', k: 0.04, a: 0.9 } ] },
  horizon: { amt: 0.85, band: 0.03 },
  deck: { top: 6, dens: 0.004, light: 0.25, amb: 1, color: ['#201a14', 0.002], lod: 2 },     // rain mist hanging on the fields, lit by the lamps
});

LOOKS3.CITY_NIGHT_AD = AD(LOOKS3.CITY_NIGHT, {
  clouds: { on: 1, h: 900, scale: 1 / 2600, cover: 0.42, soft: 0.3, amb: ['#141428', 0.02], sun: 0, fade: 1 / 20000 },
  ramp: { near: 300, far: 14000, mix: 0.9, height: 700, stops: [                             // Mead: every row lighter and bluer with distance
    { d: 0, c: '#0c0a10', k: 0.02, a: 0 }, { d: 0.3, c: '#2a1c24', k: 0.05, a: 0.06 }, { d: 0.5, c: '#3a2a3a', k: 0.1, a: 0.2 },
    { d: 0.6, c: '#3a3456', k: 0.13, a: 0.34 }, { d: 0.75, c: '#34406a', k: 0.15, a: 0.55 }, { d: 0.88, c: '#2e3a60', k: 0.15, a: 0.72 }, { d: 1, c: '#2e3a60', k: 0.14, a: 0.85 } ] },
  horizon: { amt: 0.85, band: 0.03 },
  deck: { top: 25, dens: 0.0012, light: 0.045, amb: 1, color: ['#141824', 0.003], lod: 3 },
});
LOOKS3.STORM_AD = AD(LOOKS3.STORM, {
  sat: 0.92,
  sky: { zen: ['#2a3a52', 0.35], horSun: ['#ffc070', 1.6], horAnti: ['#9a8a8a', 0.45], belt: ['#d08a90', 0.2], horExp: 0.3 },
  sun: { dir: [-0.45, 0.14, 0.88], color: ['#ffb060', 1.4], disk: 0, light: 1.7 },
  hemi: { sky: ['#4a5868', 0.45], ground: ['#3a2c14', 0.12] },
  ramp: { near: 60, far: 30000, mix: 0.8, height: 1500, stops: [                             // the land strip: gold near, blue-grey rain air far
    { d: 0, c: '#3a3024', k: 0.1, a: 0 }, { d: 0.5, c: '#4a4a4c', k: 0.2, a: 0.1 }, { d: 0.75, c: '#4a5260', k: 0.28, a: 0.35 }, { d: 1, c: '#56606e', k: 0.32, a: 0.8 } ] },
  horizon: { amt: 0.8, band: 0.02 },
  exposure: 1.15, contrast: 1.25,
});
LOOKS3.STORM_MONO = AD(LOOKS3.STORM_AD, { sat: 0, contrast: 1.45, tint: [1.0, 0.985, 0.95], exposure: 1.1 });     // Dobrowner: silver gelatin

// HORDE: the plains in three red bands (Soviet poster painters), no photoreal: mono red print, banded value planes, dust deck
LOOKS3.HORDE_RED = AD(LOOKS3.PLAINS_DUSK_AD, {
  ramp: { near: 80, far: 32000, mix: 1, stops: [
    { d: 0, c: '#401010', k: 0.2, a: 0 }, { d: 0.36, c: '#401010', k: 0.2, a: 0.02 }, { d: 0.37, c: '#a02418', k: 0.35, a: 0.4 }, { d: 0.62, c: '#a02418', k: 0.35, a: 0.45 },
    { d: 0.63, c: '#ff5a30', k: 0.6, a: 0.75 }, { d: 1, c: '#ff5a30', k: 0.7, a: 1 } ] },
  deck: { top: 12, dens: 0.0015, light: 0, amb: 1, color: ['#ff6a3a', 0.05] },
  sat: 0, tint: [1.0, 0.2, 0.13], contrast: 1.4, floor: 0.05, white: 0.92, grain: 0.03,
});

function setLook(U, look, A) {
  const c = (v, k = 1) => lin(v[0], v[1] * k);
  const S = look.sky;
  U.uSZen.value.copy(c(S.zen)); U.uSHorSun.value.copy(c(S.horSun)); U.uSHorAnti.value.copy(c(S.horAnti)); U.uSBelt.value.copy(c(S.belt || ['#000', 0]));
  U.uSHorExp.value = S.horExp ?? 0.45; U.uSStars.value = S.stars ?? 0;
  if (S.glow) { U.uSGlowCol.value.copy(c(S.glow.color)); U.uSGlow.value.set(S.glow.dir[0], S.glow.dir[1], S.glow.pow ?? 4, S.glow.fall ?? 6); } else U.uSGlowCol.value.setRGB(0, 0, 0);
  U.uSSunDir.value.set(...look.sun.dir).normalize(); U.uSSunCol.value.copy(c(look.sun.color)); U.uSSunDisk.value = look.sun.disk ?? 0;
  U.uSMoonDir.value.set(...look.moon.dir).normalize(); U.uSMoonCol.value.copy(c(look.moon.color));
  U.uHazeAmb.value.copy(look.fog.amb ? c(look.fog.amb) : new THREE.Color(0, 0, 0)); U.uHazeFar.value = look.fog.far ?? 20000;
  U.uFogD.value = look.fog.d; U.uFogH.value = look.fog.h; U.uFogY0.value = look.fog.y0 ?? 0; U.uHazeGain.value = look.fog.gain ?? 1; U.uHazeSun.value = look.fog.sun ?? 0.5;
  const K = look.clouds || { on: 0 };
  U.uCloudOn.value = K.on ? 1 : 0;
  if (K.on) { U.uCloudH.value = K.h; U.uCloudScale.value = K.scale; U.uCover.value = K.cover; U.uSoft.value = K.soft; U.uCloudAmb.value.copy(c(K.amb)); U.uCloudSun.value = K.sun ?? 0; U.uCloudFade.value = K.fade ?? 1 / 30000; }
  if (look.towns) U.uTownCol.value.copy(c(look.towns.color));
  // pass 2: painted depth ramp + horizon dissolve (absent: off, the c1 behaviour)
  const R = look.ramp;
  if (R) { U.tRamp.value = makeRamp(R.stops); U.uRampOn.value = 1; U.uRampN.value = R.near ?? 60; U.uRampF.value = R.far ?? 30000; U.uRampMix.value = R.mix ?? 1; U.uRampH.value = R.height ?? 900; }
  else U.uRampOn.value = 0;
  U.uHorAmt.value = look.horizon?.amt ?? 0; U.uHorBand.value = look.horizon?.band ?? 0.03;
}

// ------------------------------------------------------------------ painted ramp texture (256 x 2: anti-sun row, sun-side row)
// stops: [{ d: 0..1 (log depth near->far), c: '#hex', k: linear gain, a: minimum haze 0..1, sun: '#hex' (opt), ks }]
export function makeRamp(stops, n = 256) {
  const S = [...stops].sort((a, b) => a.d - b.d), data = new Float32Array(n * 2 * 4);
  const at = (u, row) => { let i = 0; while (i < S.length - 2 && S[i + 1].d < u) i++;
    const A = S[i], B = S[Math.min(i + 1, S.length - 1)], f = B.d > A.d ? clamp((u - A.d) / (B.d - A.d)) : 0, e = f * f * (3 - 2 * f);
    const ca = lin(row && A.sun ? A.sun : A.c, row && A.ks != null ? A.ks : A.k ?? 1), cb = lin(row && B.sun ? B.sun : B.c, row && B.ks != null ? B.ks : B.k ?? 1);
    return [ca.r + (cb.r - ca.r) * e, ca.g + (cb.g - ca.g) * e, ca.b + (cb.b - ca.b) * e, (A.a ?? 0) + ((B.a ?? 0) - (A.a ?? 0)) * e]; };
  for (let row = 0; row < 2; row++) for (let i = 0; i < n; i++) data.set(at(i / (n - 1), row), (row * n + i) * 4);
  const t = new THREE.DataTexture(data, n, 2, THREE.RGBAFormat, THREE.FloatType); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ Atmos
export class Atmos {
  // hook: { glsl, uniforms } adds `vec3 atmosHook(vec3 dir, float dist, vec3 c, float isSky)` to the sky/haze pass
  // (weather.js: the storm's shelf cloud, rain shafts and lightning are drawn there, at their true distances)
  constructor(world, look = LOOKS3.PLAINS_DUSK, { samples = 0, bloomLevels = 5, hook = null } = {}) {
    this.hook = hook;
    this.world = world; this.renderer = world.renderer; this.scene = world.scene; this.camera = world.camera;
    this.overlay = new THREE.Scene();                    // emissive layer (sprites, plumes, rain, bolts)
    this.U = makeAtmosUniforms();
    const w = Math.round(world.w * world.scale), h = Math.round(world.h * world.scale); this.w = w; this.h = h;
    const dt = new THREE.DepthTexture(w, h); dt.type = THREE.FloatType;
    this.rtC = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: dt, samples });
    this.rtF = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtE = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.depth = dt;
    // per-frame uniforms any overlay material can share (depth occlusion, resolution)
    this.frameU = { tDepth: { value: dt }, uRes: { value: new THREE.Vector2(w, h) }, uOcc: { value: 1 }, uNear: { value: 1 }, uFar: { value: 1000 } };
    this.bloom = []; let bw = w, bh = h;
    for (let i = 0; i < bloomLevels; i++) { bw = Math.max(1, Math.round(bw / 2)); bh = Math.max(1, Math.round(bh / 2)); if (i === 0) { bw = Math.round(w / 4); bh = Math.round(h / 4); }
      this.bloom.push(new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false })); }
    this.bloomUp = this.bloom.map(r => new THREE.WebGLRenderTarget(r.width, r.height, { type: THREE.HalfFloatType, depthBuffer: false }));
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); this.quad.frustumCulled = false;
    this.qscene = new THREE.Scene(); this.qscene.add(this.quad); this.qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.pre = [];                                        // callbacks (atmos, camera) before the main pass (lightmaps, reflections)
    this.post = null;                                     // optional (tex) => void, e.g. thermal override
    this.skyOnly = false;
    this.grade = {};
    this.mid = [];                                        // pass 2: callbacks (atmos, camera, t) after the haze pass, drawing into rtF (cloud volumes)
    this.handlers = {}; this.fired = [];                  // pass 2: events
    this.motionBlur = 0;                                  // pass 2: camera shutter fraction (0 = off); per-pixel reprojection blur in the grade
    this._mkPasses(); this.setLook(look);
    world.scene.fog = null;
  }
  setLook(look) { this.look = look; setLook(this.U, look, this);
    const W = this.world, T = look;
    if (T.hemi) W.hemi(new THREE.Color(T.hemi.sky[0]), new THREE.Color(T.hemi.ground[0]), 1).intensity = T.hemi.sky[1];
    if (W._hemi && T.hemi) { W._hemi.color.copy(lin(T.hemi.sky[0], 1)); W._hemi.groundColor.copy(lin(T.hemi.ground[0], T.hemi.ground[1] / Math.max(1e-4, T.hemi.sky[1]))); }
    // moon (or sun) as the one cool directional fill
    const key = T.key || ((T.sun.light ?? 0) > 0 ? T.sun : T.moon);        // look.key: e.g. the afterglow as a soft low source
    if (!this._key) { this._key = new THREE.DirectionalLight(); this.scene.add(this._key); this.scene.add(this._key.target); }
    this._key.color.copy(lin(key.color[0], 1)); this._key.intensity = key.light ?? 0; this._key.position.set(...key.dir).normalize().multiplyScalar(1000);
    const G = this.gradeU; G.uExpo.value = T.exposure; G.uBloom.value = T.bloom; G.uFloor.value = T.floor; G.uWhite.value = T.white;
    G.uSat.value = T.sat ?? 1; G.uCon.value = T.contrast ?? 1; G.uShadow.value.set(...(T.shadowTint || [0, 0, 0])); G.uGrain.value = T.grain ?? 0;
    G.uTint.value.set(...(T.tint || [1, 1, 1])); G.uVig.value = T.vignette ?? 0.25;
    // pass 2: the lit ground-fog deck (look.deck: { top, dens, light, amb, color, lod })
    const D = T.deck, FM = this.fogMat;
    if (D) { FM.uniforms.uDeck.value.set(D.top ?? 30, D.dens ?? 0.002, D.light ?? 1, D.amb ?? 1); FM.uniforms.uDeckCol.value.copy(lin(...(D.color || ['#000000', 0])));
      FM.uniforms.uDeckLod.value = D.lod ?? 4; FM.uniforms.uDeckY0.value = D.y0 ?? 0; }
    if (!!D !== !!FM.defines.DECK) { if (D) FM.defines.DECK = 1; else delete FM.defines.DECK; FM.needsUpdate = true; }
    return this;
  }
  // events on the beat (pass 2): a piece fires world.event('lightning', t) at its hit; handlers registered with on()
  // get (age seconds since the latest firing <= t, opts) every frame, or (Infinity) when none has fired yet.
  on(name, fn) { (this.handlers[name] ||= []).push(fn); return this; }
  event(name, t, opts = {}) { this.fired.push({ name, t, opts }); return this; }
  _events(t) { for (const name in this.handlers) { let e = null; for (const f of this.fired) if (f.name === name && f.t <= t + 1e-6 && (!e || f.t > e.t)) e = f;
    for (const fn of this.handlers[name]) fn(e ? t - e.t : Infinity, e ? e.opts : {}); } }
  get key() { return this._key; }
  // towns for cloud skyglow: [{ x, z, r, i }]
  setTowns(list) { const U = this.U; U.uNTowns.value = Math.min(16, list.length); list.slice(0, 16).forEach((t, i) => U.uTowns.value[i].set(t.x, t.r, t.z, t.i)); return this; }
  flash(x, z, i, r = 3000) { this.U.uFlash.value.set(x, z, 0, i); this.U.uFlashR.value = r; }
  _mkPasses() {
    const U = this.U, F = this.frameU;
    this.fogMat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false,
      uniforms: { ...U, ...(this.hook?.uniforms || {}), tColor: { value: this.rtC.texture }, tDepth: F.tDepth, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uSkyOnly: { value: 0 },
        tLight: { value: null }, uLightBox: { value: new THREE.Vector4(0, 0, 1, 1) }, uLightGain: { value: 1 },
        uDeck: { value: new THREE.Vector4(0, 0, 0, 0) }, uDeckCol: { value: new THREE.Color() }, uDeckLod: { value: 4 }, uDeckY0: { value: 0 } },
      defines: this.hook ? { HOOK: 1 } : {},
      vertexShader: FS_QUAD_V,
      fragmentShader: ATMOS_GLSL + CLOUD_GLSL + (this.hook?.glsl || '') + /* glsl */`
        uniform sampler2D tColor, tDepth; uniform mat4 uInvProj, uCamWorld; uniform float uSkyOnly; varying vec2 vUv;
        vec3 fin3(vec3 c){ return clamp(vec3(isnan(c.x) ? 0. : c.x, isnan(c.y) ? 0. : c.y, isnan(c.z) ? 0. : c.z), 0., 6e4); }   // NaN/Inf guard (5 Oct, glfx.js FIN_GLSL)
        #ifdef DECK
        ${LF_GLSL}
        uniform vec4 uDeck; uniform vec3 uDeckCol; uniform float uDeckLod, uDeckY0;
        // a ground-fog deck (uDeck: top m, density 1/m, lightmap gain, ambient gain) lit from below by the LightField
        // (the lightmap at a coarse mip): towns, plants and yards glow INSIDE a layer; 6 jittered samples along the ray
        vec3 deckScatter(vec3 d, float s, inout float T){
          float top = uDeck.x + uDeckY0, y0 = uCamPos.y, t0 = 0., t1 = min(s, 40000.);
          if (y0 > top) { if (d.y >= -1e-4) return vec3(0.); t0 = (top - y0) / d.y; }
          else if (d.y > 1e-4) t1 = min(t1, (top - y0) / d.y);
          if (t1 <= t0) return vec3(0.);
          float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715)))), dt = (t1 - t0) / 8.; vec3 S = vec3(0.);   // interleaved gradient noise
          for (int i = 0; i < 8; i++) { vec3 p = uCamPos + d * (t0 + (float(i) + j) * dt);
            float h = max(p.y - uDeckY0, 0.), dens = uDeck.y * exp(-h / max(uDeck.x * .45, 1.));
            vec2 u = (p.xz - uLightBox.xy) / (uLightBox.zw - uLightBox.xy);
            vec3 L = uDeckCol * uDeck.w;
            if (u.x > 0. && u.y > 0. && u.x < 1. && u.y < 1.) L += textureLod(tLight, u, uDeckLod).rgb * uLightGain * uDeck.z * exp(-h / max(uDeck.x * .7, 1.));
            float a = 1. - exp(-dens * dt); S += T * a * L; T *= 1. - a; }
          return S;
        }
        #endif
        void main(){
          float d = texture2D(tDepth, vUv).r;
          vec4 vp = uInvProj * vec4(vUv*2.-1., d*2.-1., 1.); vp /= vp.w;
          vec3 wp = (uCamWorld * vp).xyz; vec3 dir = normalize(wp - uCamPos);
          vec3 c;
          float s = 1e7;
          if (d >= 1.) { c = clouds(dir, skyCol(dir));
            if (uHorAmt > 0.) c = mix(c, horizonCol(dir), uHorAmt * (dir.y < 0. ? 1. : exp(-dir.y / uHorBand))); }   // the horizon dissolve
          else { c = fin3(texture2D(tColor, vUv).rgb); s = length(wp - uCamPos); float tr = fogTr(dir, s);
            c = c*tr + fogCol(dir, s)*(1.-tr); }
          #ifdef HOOK
          c = atmosHook(dir, s, c, d >= 1. ? 1. : 0.);
          #endif
          #ifdef DECK
          { float T = 1.; vec3 S = deckScatter(dir, s, T); c = c*T + S; }
          #endif
          gl_FragColor = vec4(fin3(c), 1.);
        }` });
    const kaw = (up) => new THREE.ShaderMaterial({ depthTest: false, depthWrite: false,
      uniforms: { tA: { value: null }, tB: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uAdd: { value: 0 } },
      vertexShader: FS_QUAD_V,
      fragmentShader: up ? `uniform sampler2D tA, tB; uniform vec2 uTexel; uniform float uAdd; varying vec2 vUv;
        void main(){ vec2 o = uTexel; vec3 s = texture2D(tA, vUv + vec2(-o.x*2., 0.)).rgb + texture2D(tA, vUv + vec2(o.x*2., 0.)).rgb
          + texture2D(tA, vUv + vec2(0., -o.y*2.)).rgb + texture2D(tA, vUv + vec2(0., o.y*2.)).rgb
          + 2.*(texture2D(tA, vUv + vec2(-o.x, o.y)).rgb + texture2D(tA, vUv + vec2(o.x, o.y)).rgb + texture2D(tA, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tA, vUv + vec2(o.x, -o.y)).rgb);
          gl_FragColor = vec4(s/12. + uAdd*texture2D(tB, vUv).rgb, 1.); }`
        : `uniform sampler2D tA, tB; uniform vec2 uTexel; uniform float uFirst; varying vec2 vUv;
        vec3 fin3(vec3 c){ return clamp(vec3(isnan(c.x) ? 0. : c.x, isnan(c.y) ? 0. : c.y, isnan(c.z) ? 0. : c.z), 0., 6e4); }   // NaN/Inf guard (5 Oct, glfx.js FIN_GLSL)
        vec3 S(vec2 u){ vec3 c = texture2D(tA, u).rgb; if (uFirst > .5) c += texture2D(tB, u).rgb; return min(fin3(c), vec3(60.)); }
        void main(){ vec2 o = uTexel; vec3 s = S(vUv)*4. + S(vUv + o) + S(vUv - o) + S(vUv + vec2(o.x, -o.y)) + S(vUv + vec2(-o.x, o.y));
          gl_FragColor = vec4(s/8., 1.); }` });
    this.downMat = kaw(false); this.upMat = kaw(true);
    this.gradeU = { tF: { value: this.rtF.texture }, tE: { value: this.rtE.texture }, tB: { value: null }, uExpo: { value: 1 }, uBloom: { value: 0.1 },
      uFloor: { value: 0.03 }, uWhite: { value: 0.95 }, uSat: { value: 1 }, uCon: { value: 1 }, uShadow: { value: new THREE.Vector3() }, uGrain: { value: 0.02 }, uSeed: { value: 0 }, uVig: { value: 0.25 },
      uTint: { value: new THREE.Vector3(1, 1, 1) }, uMB: { value: 0 }, tDepth: F.tDepth, uGInvProj: { value: new THREE.Matrix4() }, uGCamWorld: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() } };
    this.gradeMat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, uniforms: this.gradeU, vertexShader: FS_QUAD_V,
      fragmentShader: /* glsl */`
        uniform sampler2D tF, tE, tB, tDepth; uniform float uExpo, uBloom, uFloor, uWhite, uSat, uCon, uGrain, uSeed, uVig, uMB; uniform vec3 uShadow, uTint;
        uniform mat4 uGInvProj, uGCamWorld, uPrevVP; varying vec2 vUv;
        vec3 fin3(vec3 c){ return clamp(vec3(isnan(c.x) ? 0. : c.x, isnan(c.y) ? 0. : c.y, isnan(c.z) ? 0. : c.z), 0., 6e4); }   // NaN/Inf guard (5 Oct, glfx.js FIN_GLSL)
        vec3 aces(vec3 x){ return clamp((x*(2.51*x + .03)) / (x*(2.43*x + .59) + .14), 0., 1.); }
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }
        void main(){
          vec3 c = fin3(texture2D(tF, vUv).rgb + texture2D(tE, vUv).rgb);
          if (uMB > 0.) {                                                 // camera motion blur: reproject this pixel with last frame's camera
            float d = texture2D(tDepth, vUv).r; vec4 vp = uGInvProj * vec4(vUv*2.-1., min(d, .999999)*2.-1., 1.); vp /= vp.w;
            vec3 wp = (uGCamWorld * vp).xyz; if (d >= 1.) wp = uGCamWorld[3].xyz + normalize(wp - uGCamWorld[3].xyz) * 1e6;
            vec4 pp = uPrevVP * vec4(wp, 1.); vec2 pu = pp.xy / pp.w * .5 + .5; vec2 v = (vUv - pu) * uMB;
            float L = length(v); if (L > .06) v *= .06 / L;
            if (L > .0004) { vec3 a = vec3(0.); float j = h(vUv*731.) - .5;
              for (int i = 0; i < 9; i++) { vec2 u = vUv - v * ((float(i) + j) / 8. - .5); a += texture2D(tF, u).rgb + texture2D(tE, u).rgb; } c = a / 9.; } }
          c = mix(c, texture2D(tB, vUv).rgb, uBloom);
          c *= uExpo;
          vec3 m = aces(c);
          m = pow(m, vec3(1./2.2));                                     // display
          float l = dot(m, vec3(.2126, .7152, .0722));
          m = mix(vec3(l), m, uSat);
          m = clamp((m - uFloor) / (uWhite - uFloor), 0., 1.);          // night value rule: black floor, white point
          m = mix(m, m*m*(3.-2.*m), uCon - 1.);                         // S contrast
          m += uShadow * (1. - smoothstep(0., .35, l));                 // the one cool fill in the shadows
          m *= uTint;                                                   // pass 2: a print tint (mono looks)
          vec2 q = vUv - .5; m *= 1. - uVig * dot(q, q) * 1.6;
          m += (h(vUv*1000.) - .5) * uGrain;
          gl_FragColor = vec4(clamp(m, 0., 1.), 1.);
        }` });
  }
  // planar reflection of the plane y = `y` (wet roads, rivers): scene + overlay (lamps, sprites) from the mirrored camera
  // into rtR at `scale`; materials read reflU { tRefl, uReflMat }. Objects with userData.noReflect are hidden in that pass.
  reflect({ scale = 0.35, y = 0 } = {}) {
    this.rtR = new THREE.WebGLRenderTarget(Math.round(this.w * scale), Math.round(this.h * scale), { type: THREE.HalfFloatType });
    this.reflU = { tRefl: { value: this.rtR.texture }, uReflMat: { value: new THREE.Matrix4() }, uReflY: { value: y } };
    this.rcam = new THREE.PerspectiveCamera();
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: this.U,
      vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position * 50000., 1.); gl_Position = p.xyww; }',
      fragmentShader: ATMOS_GLSL + CLOUD_GLSL + 'varying vec3 vD; void main(){ vec3 d = normalize(vD); gl_FragColor = vec4(clouds(d, skyCol(d)), 1.); }' }));
    this.skyMesh.frustumCulled = false; this.skyMesh.renderOrder = -10; this.skyMesh.visible = false; this.scene.add(this.skyMesh);
    this.pre.push((a, cam) => this._reflect(cam));
    return this;
  }
  _reflect(cam) {
    const r = this.renderer, v = this.rcam, y = this.reflU.uReflY.value, p = cam.position;
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).add(p);
    v.position.set(p.x, 2 * y - p.y, p.z); v.up.set(0, 1, 0).applyQuaternion(cam.quaternion); v.up.y *= -1;
    v.lookAt(look.x, 2 * y - look.y, look.z); v.fov = cam.fov; v.aspect = cam.aspect; v.near = cam.near; v.far = cam.far; v.updateProjectionMatrix(); v.updateMatrixWorld();
    this.reflU.uReflMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(v.projectionMatrix).multiply(v.matrixWorldInverse);
    const hidden = []; this.scene.traverse(o => { if (o.userData.noReflect && o.visible) { o.visible = false; hidden.push(o); } });
    this.skyMesh.visible = true; this.skyMesh.position.copy(v.position);
    const tm = r.toneMapping; r.toneMapping = THREE.NoToneMapping; r.setClearColor(0, 1);
    r.setRenderTarget(this.rtR); r.clear(); r.render(this.scene, v);
    const dt = [], ohid = []; this.overlay.traverse(o => { if (o.userData.noReflect && o.visible) { o.visible = false; ohid.push(o); } else if (o.material) { dt.push([o.material, o.material.depthTest]); o.material.depthTest = true; } });
    this.frameU.uOcc.value = 0; r.autoClear = false; r.render(this.overlay, v); r.autoClear = true; this.frameU.uOcc.value = 1;
    for (const [m, d] of dt) m.depthTest = d; for (const o of ohid) o.visible = true;
    r.setRenderTarget(null); r.toneMapping = tm;
    this.skyMesh.visible = false; for (const o of hidden) o.visible = true;
  }
  _pass(mat, target) { this.quad.material = mat; this.renderer.setRenderTarget(target); this.renderer.render(this.qscene, this.qcam); }
  render(cam, t = 0) {
    const W = this.world, r = this.renderer, camera = this.camera;
    if (cam) { camera.position.set(...cam.pos); camera.up.set(Math.sin(cam.roll || 0), Math.cos(cam.roll || 0), 0); camera.lookAt(...cam.target);
      if (cam.fov && camera.fov !== cam.fov) { camera.fov = cam.fov; camera.updateProjectionMatrix(); } }
    camera.updateMatrixWorld();
    const U = this.U; U.uCamPos.value.copy(camera.position); U.uTime.value = t;
    this._events(t);
    this.frameU.uNear.value = camera.near; this.frameU.uFar.value = camera.far;
    for (const f of W.onBefore) f(camera);
    for (const f of this.pre) f(this, camera, t);
    if (this.prof) { const gl = r.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    if (W._fit) W._fitShadow();
    const tm = r.toneMapping; r.toneMapping = THREE.NoToneMapping;
    r.setClearColor(0x000000, 1);
    const P = this.prof ? (k) => { const gl = r.getContext(), px = new Uint8Array(4), cur = r.getRenderTarget(); r.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const n = performance.now(); this.stats[k] = +(n - this._pt).toFixed(0); this._pt = n; r.setRenderTarget(cur); } : () => {};
    if (this.prof) { this.stats = {}; this._pt = performance.now(); }
    r.setRenderTarget(this.rtC); r.clear(); r.render(this.scene, camera); P('scene');
    const FM = this.fogMat.uniforms; FM.uInvProj.value.copy(camera.projectionMatrixInverse); FM.uCamWorld.value.copy(camera.matrixWorld);
    this._pass(this.fogMat, this.rtF); P('fog');
    for (const f of this.mid) f(this, camera, t); if (this.mid.length) P('mid');
    this.frameU.uOcc.value = 1;
    r.setRenderTarget(this.rtE); r.clear(); r.render(this.overlay, camera); P('overlay');
    // bloom
    const B = this.bloom, D = this.downMat.uniforms, Up = this.upMat.uniforms;
    for (let i = 0; i < B.length; i++) {
      const src = i === 0 ? this.rtF : B[i - 1];
      D.tA.value = src.texture; D.tB.value = this.rtE.texture; D.uFirst.value = i === 0 ? 1 : 0; D.uTexel.value.set(1 / src.width, 1 / src.height);
      this._pass(this.downMat, B[i]);
    }
    let prev = B[B.length - 1];
    for (let i = B.length - 2; i >= 0; i--) {
      Up.tA.value = prev.texture; Up.tB.value = B[i].texture; Up.uAdd.value = 1; Up.uTexel.value.set(0.5 / prev.width, 0.5 / prev.height);
      this._pass(this.upMat, this.bloomUp[i]); prev = this.bloomUp[i];
    }
    P('bloom'); this.gradeU.tB.value = prev.texture; this.gradeU.uSeed.value = (t * 7.31) % 17;
    if (this.post) this.post(this);
    const GU = this.gradeU, vpNow = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    GU.uMB.value = this._prevVP ? this.motionBlur : 0; GU.uGInvProj.value.copy(camera.projectionMatrixInverse); GU.uGCamWorld.value.copy(camera.matrixWorld);
    if (this._prevVP) GU.uPrevVP.value.copy(this._prevVP);
    this._pass(this.gradeMat, null); P('grade');
    this._prevVP = vpNow;
    r.toneMapping = tm;
    return W.canvas;
  }
}

// ------------------------------------------------------------------ LightField: practicals that light things
// add({ pos:[x,y,z], color:'#ffae5a' | [r,g,b], i: intensity (HDR), core: metres, halo: 0..1, pool: { r, i } | null,
//        blink: { period, duty, phase } | null, kind })
// Sprites: overlay points, depth-occluded in the shader, fogged by the same haze integral, blink in sync by period/phase.
// Pools: a top-down lightmap over `box` [x0, z0, x1, z1] at `res`; patchMaterial()/ground shaders sample it.
export const LF_GLSL = /* glsl */`
uniform sampler2D tLight; uniform vec4 uLightBox; uniform float uLightGain;
vec3 lightAt(vec3 p){ vec2 u = (p.xz - uLightBox.xy) / (uLightBox.zw - uLightBox.xy);
  if (u.x < 0. || u.y < 0. || u.x > 1. || u.y > 1.) return vec3(0.); return textureLod(tLight, u, 0.).rgb * uLightGain; }   // lod 0: the mips are for the fog deck
`;
// 4.B (8 Oct, opt-in): occTaps 8 = fractional sprite occlusion: 8 depth taps over the core's footprint; occ is the occluded fraction and
// dims the sprite, which goes only at full cover (a rung crossing a lamp dims it instead of popping it). occTaps 1 (the default) = one tap.
// light(i, ...) promotes record i to a real three.js light as well (see there).
const OCC1 = [`if (uOcc > .5 && abs(ndc.x) < 1. && abs(ndc.y) < 1.) { float sd = texture2D(tDepth, ndc.xy*.5+.5).r; if (sd < ndc.z*.5+.5 - 2e-6) occ = 1.; }`,
  `float corePx = max(lsz.x * pxPerM * 2., lsz.z) * uPxScale;`, `vC = lcol * bl * mix(tr, 1., .15) * uGain;`, `if (occ > .5 || bl`];
const OCC8 = ['', OCC1[1] + `
          if (uOcc > .5 && abs(ndc.x) < 1. && abs(ndc.y) < 1.) { float zl = ndc.z*.5+.5 - 2e-6; vec2 c0 = ndc.xy*.5+.5, rp = vec2(.5 * min(corePx, 250.)) / uRes;
            for (int k = 0; k < 8; k++) { float fk = float(k), rr = sqrt((fk + .5) / 8.), an = fk * 2.39996; vec2 q = c0 + rp * rr * vec2(cos(an), sin(an));
              if (q.x > 0. && q.y > 0. && q.x < 1. && q.y < 1. && texture2D(tDepth, q).r < zl) occ += .125; } }`,
  `vC = lcol * bl * mix(tr, 1., .15) * uGain * (1. - occ);`, `if (occ > .999 || bl`];
export class LightField {
  constructor(atmos, { box = [-1000, -1000, 1000, 1000], res = 1024, max = 20000, pixelScale = 1, haloPx = 26, minPx = 2.2, occTaps = 1 } = {}) {
    this.occTaps = occTaps;
    this.A = atmos; this.box = box; this.max = max; this.lights = []; this.movers = [];
    this.rtL = new THREE.WebGLRenderTarget(res, res, { type: THREE.HalfFloatType, depthBuffer: false });
    this.U = { tLight: { value: this.rtL.texture }, uLightBox: { value: new THREE.Vector4(...box) }, uLightGain: { value: 1 } };
    // pass 2: the first LightField of a world also lights the ground-fog deck (look.deck), read at a coarse mip
    if (!atmos.lf) { atmos.lf = this; this.rtL.texture.generateMipmaps = true; this.rtL.texture.minFilter = THREE.LinearMipmapLinearFilter;
      const FU = atmos.fogMat.uniforms; FU.tLight = this.U.tLight; FU.uLightBox = this.U.uLightBox; FU.uLightGain = this.U.uLightGain; }
    this.pixelScale = pixelScale; this.haloPx = haloPx; this.minPx = minPx; this.dirty = true;
  }
  add(L) { this.lights.push(L); this.dirty = true; return L; }
  // build GPU buffers (call once after adding; movers update positions each frame via setPos)
  build() {
    const n = this.lights.length, P = new Float32Array(n * 3), Cc = new Float32Array(n * 3), S = new Float32Array(n * 4), K = new Float32Array(n * 3);
    this.lights.forEach((L, i) => {
      P.set(L.pos, i * 3); const c = Array.isArray(L.color) ? new THREE.Color(...L.color) : new THREE.Color(L.color); c.multiplyScalar(L.i ?? 1);
      Cc.set([c.r, c.g, c.b], i * 3);
      S.set([L.core ?? 0.5, L.halo ?? 1, L.minPx ?? this.minPx, L.dir ? 1 : 0], i * 4);
      const b = L.blink; K.set(b ? [b.period, b.duty, b.phase || 0] : [0, 1, 0], i * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('lcol', new THREE.BufferAttribute(Cc, 3));
    g.setAttribute('lsz', new THREE.BufferAttribute(S, 4)); g.setAttribute('lbl', new THREE.BufferAttribute(K, 3));
    const A = this.A, F = A.frameU;
    this.spriteU = { ...A.U, tDepth: F.tDepth, uRes: F.uRes, uOcc: F.uOcc, uNear: F.uNear, uFar: F.uFar, uPxScale: { value: this.pixelScale },
      uFovY: { value: 1 }, uHalo: { value: this.haloPx }, uGain: { value: 1 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.spriteU, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: this._occ(ATMOS_GLSL + /* glsl */`
        attribute vec3 lcol; attribute vec4 lsz; attribute vec3 lbl; uniform sampler2D tDepth; uniform vec2 uRes; uniform float uOcc, uPxScale, uFovY, uHalo, uGain;
        varying vec3 vC; varying float vCore, vHaloF;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.); vec4 cp = projectionMatrix * mv; gl_Position = cp;
          float dist = length(mv.xyz); vec3 wd = normalize(position - uCamPos);
          float bl = 1.; if (lbl.x > 0.) { float ph = fract((uTime + lbl.z) / lbl.x); bl = smoothstep(0., .04, ph) * (1. - smoothstep(lbl.y - .06, lbl.y, ph)); }
          float tr = fogTr(wd, dist);
          vec3 ndc = cp.xyz / cp.w; float occ = 0.;
          if (uOcc > .5 && abs(ndc.x) < 1. && abs(ndc.y) < 1.) { float sd = texture2D(tDepth, ndc.xy*.5+.5).r; if (sd < ndc.z*.5+.5 - 2e-6) occ = 1.; }
          float pxPerM = uRes.y / (2. * tan(uFovY*.5) * dist);
          float corePx = max(lsz.x * pxPerM * 2., lsz.z) * uPxScale;
          float haze = 1. - tr;
          float haloPx = uHalo * lsz.y * (.4 + .9*haze) * uPxScale;
          vCore = corePx; vHaloF = haloPx;
          float size = max(corePx * 2.2, haloPx);
          vC = lcol * bl * mix(tr, 1., .15) * uGain;
          if (occ > .5 || bl <= 0.001 || dot(vC, vec3(1.)) < 1e-5) size = 0.;
          gl_PointSize = min(size, 250.);
        }`),
      fragmentShader: `varying vec3 vC; varying float vCore, vHaloF;
        void main(){ float sz = max(vCore*2.2, vHaloF); float r = length(gl_PointCoord - .5) * sz;       // pixels from centre
          float core = exp(-r*r / max(vCore*vCore*.45, .35));
          float halo = vHaloF > 0. ? exp(-r / max(vHaloF*.16, .5)) * .09 : 0.;
          vec3 c = vC * (core * 1.0 + halo) * (1. - smoothstep(.36, .5, length(gl_PointCoord - .5)));
          gl_FragColor = vec4(c, 1.); }` }));
    this.points.frustumCulled = false;
    A.overlay.add(this.points);
    // pools: one instanced quad per light with a pool, drawn top-down into the lightmap
    const pl = this.lights.map((L, i) => [L, i]).filter(([L]) => L.pool);
    this.poolIdx = pl.map(([, i]) => i);
    this.poolMap = new Map(this.poolIdx.map((i, k) => [i, k]));
    const q = new THREE.PlaneGeometry(2, 2); q.rotateX(-Math.PI / 2);
    const ig = new THREE.InstancedBufferGeometry(); ig.index = q.index; ig.setAttribute('position', q.getAttribute('position')); ig.setAttribute('uv', q.getAttribute('uv'));
    const PP = new Float32Array(pl.length * 4), PC = new Float32Array(pl.length * 3);
    pl.forEach(([L], k) => { PP.set([L.pos[0], L.pos[2], L.pool.r, L.pos[1] - (L.ground ?? 0)], k * 4);
      const c = Array.isArray(L.color) ? new THREE.Color(...L.color) : new THREE.Color(L.color); c.multiplyScalar(L.pool.i); PC.set([c.r, c.g, c.b], k * 3); });
    ig.setAttribute('pp', new THREE.InstancedBufferAttribute(PP, 4)); ig.setAttribute('pc', new THREE.InstancedBufferAttribute(PC, 3));
    ig.setAttribute('pbl', new THREE.InstancedBufferAttribute(new Float32Array(pl.flatMap(([L]) => L.blink ? [L.blink.period, L.blink.duty, L.blink.phase || 0] : [0, 1, 0])), 3));
    ig.instanceCount = pl.length;
    this.poolU = { uTime: A.U.uTime, uLightBox: this.U.uLightBox, uTexel: { value: Math.max(this.box[2] - this.box[0], this.box[3] - this.box[1]) / this.rtL.width } };
    this.pools = new THREE.Mesh(ig, new THREE.ShaderMaterial({ uniforms: this.poolU, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `attribute vec4 pp; attribute vec3 pc; attribute vec3 pbl; uniform float uTime, uTexel; uniform vec4 uLightBox; varying vec3 vC; varying vec2 vQ; varying float vH;
        void main(){ vQ = position.xz * 4.; float R = max(pp.z, uTexel * 1.3); float kE = pp.z*pp.z / (R*R);
          float bl = 1.; if (pbl.x > 0.) { float ph = fract((uTime + pbl.z) / pbl.x); bl = step(ph, pbl.y); }
          vC = pc * bl * kE; vec3 p = vec3(pp.x + position.x * R * 4., 0., pp.y + position.z * R * 4.);   // quad spans +-4 pool radii
          vec2 u = (p.xz - uLightBox.xy) / (uLightBox.zw - uLightBox.xy); gl_Position = vec4(u*2.-1., 0., 1.); }`,
      fragmentShader: `varying vec3 vC; varying vec2 vQ; varying float vH;
        void main(){ float r2 = dot(vQ, vQ); float e = pow(1. + r2, -1.5) * (1. - smoothstep(3., 16., r2));
          gl_FragColor = vec4(vC * e, 1.); }` }));
    this.pools.frustumCulled = false;
    this.lscene = new THREE.Scene(); this.lscene.add(this.pools);
    const [x0, z0, x1, z1] = this.box;
    this.lcam = new THREE.OrthographicCamera(x0, x1, -z0, -z1, -10, 10); this.lcam.position.set(0, 5, 0); this.lcam.up.set(0, 0, -1); this.lcam.lookAt(0, 0, 0);
    // ortho top-down: world x -> u, world z -> v (u,v = (p.xz - box.xy)/(size)); camera looking down -y with up = -z
    this.lcam.left = x0; this.lcam.right = x1; this.lcam.top = -z0; this.lcam.bottom = -z1; this.lcam.updateProjectionMatrix();
    A.pre.push((a, cam, t) => this._update(cam, t));
    this.dirty = true; this._stamp = -1;
    return this;
  }
  setPos(i, x, y, z) { const a = this.points.geometry.getAttribute('position'); a.setXYZ(i, x, y, z); a.needsUpdate = true;
    const k = this.poolMap.has(i) ? this.poolMap.get(i) : -1; if (k >= 0) { const p = this.pools.geometry.getAttribute('pp'); p.setX(k, x); p.setY(k, z); p.needsUpdate = true; }
    const R = this.real?.get(i); if (R) R.light.position.set(x, y, z); this.dirty = true; }
  // 4.B (8 Oct, opt-in): record i as a real three.js light too, added to the world's scene: a PointLight, or with kind 'spot' a SpotLight aimed
  // at `aim` (default straight down; angle, penumbra), at the record's position and colour, decay 2, no shadow (Atmos worlds keep shadows: 0).
  // Its intensity matches the record's pool: a pool is the ground irradiance of a lamp pool.r above the ground (E0 = pool.i at its foot), so
  // I = pool.i * pool.r^2 candela, times gain (`intensity` overrides it, e.g. for a record with no pool). three r170 lights MeshStandardMaterial
  // in its forward pass, so it adds direct diffuse and specular to what is near it (facades, 0.6-metalness steel, patched people).
  // pool: the share of the record's lightmap pool kept. Default 0: the light takes the ground over (from pool.r up it lights the ground exactly
  // as the pool did; keeping both doubles it). The record stays a sprite, and the light keeps its blink.
  // Choose the records per shot, or from cam(t) alone, so every farm range draws the same frame.
  light(i, { kind = 'point', aim = null, gain = 1, intensity = null, angle = 1.2, penumbra = 0.4, pool = 0 } = {}) {
    if (this.real?.has(i)) return this.real.get(i).light;
    const L = this.lights[i], c = Array.isArray(L.color) ? new THREE.Color(...L.color) : new THREE.Color(L.color);
    const I = (intensity ?? (L.pool ? L.pool.i * L.pool.r * L.pool.r * this.U.uLightGain.value : 0)) * gain;
    const lt = kind === 'spot' ? new THREE.SpotLight(c, I, 0, angle, penumbra, 2) : new THREE.PointLight(c, I, 0, 2), S = this.A.scene;
    lt.position.set(...L.pos); lt.castShadow = false; lt.userData.lfRecord = i; S.add(lt);
    if (lt.isSpotLight) { lt.target.position.set(...(aim || [L.pos[0], L.pos[1] - 1, L.pos[2]])); S.add(lt.target); }
    if (L.pool && pool !== 1) {
      const k = this.poolMap ? this.poolMap.get(i) : undefined;
      if (k === undefined) L.pool = { ...L.pool, i: L.pool.i * pool };      // before build(): the pool is stamped at the kept share
      else { const a = this.pools.geometry.getAttribute('pc'); a.setXYZ(k, a.getX(k) * pool, a.getY(k) * pool, a.getZ(k) * pool); a.needsUpdate = true; this.dirty = true; }
    }
    (this.real ||= new Map()).set(i, { light: lt, I, blink: L.blink || null });
    return lt;
  }
  _occ(vs) { return this.occTaps > 1 ? OCC1.reduce((s, a, k) => s.replace(a, OCC8[k]), vs) : vs; }
  _update(cam, t) {
    this.spriteU.uFovY.value = cam.fov * Math.PI / 180;
    if (this.real) for (const R of this.real.values()) if (R.blink) {      // the pool's own blink: on while the phase is under the duty
      const b = R.blink, ph = (((t + (b.phase || 0)) / b.period) % 1 + 1) % 1; R.light.intensity = ph <= b.duty ? R.I : 0; }
    if (!this.dirty && !this.animated) return;
    const r = this.A.renderer; r.setRenderTarget(this.rtL); r.setClearColor(0, 1); r.clear(); r.render(this.lscene, this.lcam); this.dirty = false;
  }
}

// Standard-material patch: + lightmap irradiance (pools) on the albedo, + optional emissive map multiplier. Shaders read
// the LightField uniforms by reference. walls get the pool light fading with height above the ground.
// 4.B (8 Oct): it CHAINS, as light/patch.js litPatch does: the material's own onBeforeCompile (people.js skinning and zone shading,
// hero.js skin) runs first, and its cache key prefixes ours. A material with neither compiles and keys exactly as before ('lf' + wallFall).
// A second patchMaterial on the same material replaces the first (as before), still on top of the material's own hook.
const LF_OWN = new WeakMap();      // material -> { prev, prevKey }: its own hook and key from before its first patchMaterial
export function patchMaterial(mat, lf, { wallFall = 14, gain = 1 } = {}) {
  if (!LF_OWN.has(mat)) { const own = k => Object.prototype.hasOwnProperty.call(mat, k), prev = own('onBeforeCompile') ? mat.onBeforeCompile : null;
    const src = prev ? String(prev) : '';   // a hook with no key of its own is keyed by its source, captured now (three's default reads the CURRENT hook)
    LF_OWN.set(mat, { prev, prevKey: own('customProgramCacheKey') ? mat.customProgramCacheKey.bind(mat) : prev ? () => src : null }); }
  const { prev, prevKey } = LF_OWN.get(mat);
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    Object.assign(sh.uniforms, lf.U, { uLFGain: { value: gain }, uWallFall: { value: wallFall } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLFp; varying float vLFup;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 lp = vec4(transformed, 1.);
          #ifdef USE_INSTANCING
          lp = instanceMatrix * lp;
          #endif
          vLFp = (modelMatrix * lp).xyz; vLFup = normalize((vec4(transformedNormal, 0.) * viewMatrix).xyz).y; }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLFp; varying float vLFup; uniform float uLFGain, uWallFall;\n' + LF_GLSL)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        { float up = clamp(vLFup, 0., 1.); float hf = exp(-max(vLFp.y, 0.) / uWallFall);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * lightAt(vLFp) * uLFGain * mix(.45 * hf, 1., up) / 3.14159; }`);
  };
  mat.customProgramCacheKey = prevKey ? () => prevKey() + '|lf' + wallFall : () => 'lf' + wallFall;
  return mat;
}

export { lin };
