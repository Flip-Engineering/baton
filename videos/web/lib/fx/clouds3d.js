// CLOUDS3D (WORLDS studio c1, pass 2): Nubis-lite raymarched cloud volumes on atmos3d.js (Schneider, Guerrilla, SIGGRAPH 2015).
//
//   const V = new CloudVolume(atmos, { kind: 'layer', y0: 2400, y1: 3600, cover: 0.5, scale: 1 / 3000, bake: true })
//   const S = new CloudVolume(atmos, { kind: 'shelf', edge: { z0: -1300, curve: 3e-5, h: 520, base: 1150 }, bake: true })
//
// A density field (coverage x height profile x Perlin-Worley, eroded by Worley detail) is marched per pixel into a
// reduced-resolution HDR target after the haze pass and composited over it (premultiplied), stopping at the scene depth,
// so ground, towers and turbines occlude correctly and a camera can fly through a deck.
//   light   sun/moon: a 5-step light march toward the key (Beer's law + the "powder" darkening of crevices + two HG lobes)
//           sky: ambient from the dome, darker at the base          below: the LightField lightmap at a coarse mip (towns
//           and plants light a deck's underside, falling off with the depth into the cloud)
//           flash: a point light INSIDE the volume (lightning), diffused by the medium; fire it with atmos events
//   haze    aerial perspective on the cloud at its mean depth (the same fogTr / fogCol as the land: the painted ramp)
//   cost    a still bakes once (bake: true -> re-marched only when the camera, flash or time changes); a move marches
//           every frame at res 0.3-0.4.
// kinds:  'layer'  a stratus or cumulus deck between y0 and y1 (profile: 'stratus' | 'cumulus')
//         'shelf'  a plains shelf cloud: a laminar, tiered base lowest at the leading edge, a wedge face leaning back ~40
//                  deg, striations along the edge, scud under it, rain shafts and the storm tower (with anvil) behind.
import * as THREE from 'three';
import { ATMOS_GLSL, LF_GLSL } from './atmos3d.js';

// ------------------------------------------------------------------ tileable Perlin-Worley noise (64^3, RGBA8), made once
let NOISE = null;
export function noise3D(N = 64) {
  if (NOISE) return NOISE;
  const t0 = performance.now();
  let s = 1234567; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const pts = {};
  const cellPts = (g) => { if (pts[g]) return pts[g]; const a = new Float32Array(g * g * g * 3); for (let i = 0; i < a.length; i++) a[i] = rnd(); return (pts[g] = a); };
  const worley = (x, y, z, g) => { const P = cellPts(g), fx = x * g, fy = y * g, fz = z * g, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz); let md = 9;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz, wx = ((cx % g) + g) % g, wy = ((cy % g) + g) % g, wz = ((cz % g) + g) % g, k = ((wx * g + wy) * g + wz) * 3;
      const ex = cx + P[k] - fx, ey = cy + P[k + 1] - fy, ez = cz + P[k + 2] - fz, d = ex * ex + ey * ey + ez * ez; if (d < md) md = d; }
    return 1 - Math.min(1, Math.sqrt(md)); };
  const grads = {};
  const grad = (g) => { if (grads[g]) return grads[g]; const a = new Float32Array(g * g * g * 3); for (let i = 0; i < g * g * g; i++) { let x, y, z, l; do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 0.01); l = Math.sqrt(l); a.set([x / l, y / l, z / l], i * 3); } return (grads[g] = a); };
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const perlin = (x, y, z, g) => { const G = grad(g), fx = x * g, fy = y * g, fz = z * g, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz), ux = fx - ix, uy = fy - iy, uz = fz - iz;
    const d = (a, b, c) => { const k = ((((ix + a) % g + g) % g * g + ((iy + b) % g + g) % g) * g + ((iz + c) % g + g) % g) * 3; return G[k] * (ux - a) + G[k + 1] * (uy - b) + G[k + 2] * (uz - c); };
    const sx = fade(ux), sy = fade(uy), sz = fade(uz), L = (a, b, t) => a + (b - a) * t;
    return L(L(L(d(0, 0, 0), d(1, 0, 0), sx), L(d(0, 1, 0), d(1, 1, 0), sx), sy), L(L(d(0, 0, 1), d(1, 0, 1), sx), L(d(0, 1, 1), d(1, 1, 1), sx), sy), sz); };
  const F = new Float32Array(N * N * N * 4);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, w = z / N;
    const p = perlin(u, v, w, 4) * 0.5 + perlin(u, v, w, 8) * 0.25 + perlin(u, v, w, 16) * 0.125;          // ~[-0.5, 0.5]
    const w1 = worley(u, v, w, 4) * 0.625 + worley(u, v, w, 8) * 0.25 + worley(u, v, w, 16) * 0.125;
    const w2 = worley(u, v, w, 8) * 0.625 + worley(u, v, w, 16) * 0.25 + worley(u, v, w, 32) * 0.125;
    const w3 = worley(u, v, w, 16) * 0.75 + worley(u, v, w, 32) * 0.25;
    const pn = Math.min(1, Math.max(0, p + 0.5));
    const pw = (pn - (w1 - 1)) / (1 - (w1 - 1));                                             // Perlin-Worley: remap(perlin, worley - 1, 1)
    const i = ((z * N + y) * N + x) * 4;
    F[i] = pw; F[i + 1] = w1; F[i + 2] = w2; F[i + 3] = w3;
  }
  // stretch each channel to the full 0..1 range (1st-99th percentile), so coverage thresholds mean what they say
  const data = new Uint8Array(N * N * N * 4);
  for (let c = 0; c < 4; c++) { const v = []; for (let i = c; i < F.length; i += 4 * 7) v.push(F[i]); v.sort((a, b) => a - b);
    const lo = v[Math.floor(v.length * 0.01)], hi = v[Math.floor(v.length * 0.99)];
    for (let i = c; i < F.length; i += 4) data[i] = Math.max(0, Math.min(255, (F[i] - lo) / (hi - lo) * 255)); }
  const tex = new THREE.Data3DTexture(data, N, N, N); tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
  NOISE = tex; NOISE.userData = { ms: Math.round(performance.now() - t0) };
  return tex;
}

const V_GLSL = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';

const DENS_LAYER = /* glsl */`
float cloudDens(vec3 p, bool fine){
  float hf = (p.y - uSlab.x) / (uSlab.y - uSlab.x); if (hf <= 0. || hf >= 1.) return 0.;
  vec3 wind = vec3(uWind2.x, 0., uWind2.y) * uTime;
  float wea = textureLod(tNoise, vec3((p.xz + wind.xz) * uShape.x * .18, .31), uNLod).g;                // weather map: where the deck is thick
  #if PROFILE == 1
  float prof = smoothstep(0., .22, hf) * smoothstep(1., .62, hf);                             // stratus: flat base, flat top
  #else
  float prof = smoothstep(0., .06, hf) * smoothstep(1., .25 + .55*wea, hf);                   // cumulus: flat base, domed tops
  #endif
  vec4 n = textureLod(tNoise, (p + wind) * uShape.x, uNLod);
  float base = n.r * .6 + n.g * .4;
  float cov = clamp(uShape.z * (.55 + .9*wea), 0., 1.);
  float d = rmp(base * prof, 1. - cov, 1., 0., 1.);
  if (fine && d > 0.) { vec4 m = textureLod(tNoise, (p + wind*1.6) * uShape.y, uNLod); float det = m.g*.5 + m.b*.35 + m.a*.15;
    det = mix(det, 1. - det, clamp(hf*3., 0., 1.));                                             // wispy at the base, billowy above
    d = rmp(d, det * uShape.w, 1., 0., 1.); }
  return max(d, 0.) * uLite.w;
}`;

const DENS_SHELF = /* glsl */`
uniform vec4 uEdge;    // z0, curve, edge height, base height
uniform vec4 uTower;   // behind-distance where the tower starts, top m, anvil spread, x extent half-width
uniform vec4 uRain;    // density, z0 (shafts only north of this), threshold, on
float edgeZ(float x){ return uEdge.x - uEdge.y*x*x + 180.*sin(x*.0011) + 90.*sin(x*.0031 + 1.); }
float shelfBase(vec2 p, float b){
  float k = b / 190., st = floor(k) + smoothstep(.7, 1., fract(k));                          // laminar tiers stepping up from the edge
  float h = uEdge.z + min(st, 4.) * 62. + max(b - 900., 0.) * .045;
  h += (textureLod(tNoise, vec3(p.x*.00012, b*.0009, .5), uNLod).r - .5) * 90.;
  return min(h, uEdge.w);
}
float cloudDens(vec3 p, bool fine){
  float b = edgeZ(p.x) - p.z;
  if (b < -500.) return 0.;
  float base = shelfBase(p.xz, b);
  // the wedge: face leaning back from the rim, flattening into the deck, then the storm tower behind (with anvil)
  float top = uEdge.z + 180. + max(b, 0.) * .78;
  top = min(top, 2400. + 600. * textureLod(tNoise, vec3(p.x*.00008, .2, b*.00008), uNLod).g);
  float tw = smoothstep(uTower.x, uTower.x + 5000., b) * smoothstep(uTower.w, uTower.w*.55, abs(p.x - 2500.));
  float towerTop = mix(top, uTower.y, tw);
  top = max(top, towerTop);
  float anvil = tw * smoothstep(uTower.y - 2600., uTower.y - 900., p.y);                     // the anvil spreads at the tropopause
  float d = 0.;
  if (p.y > base - 20. && p.y < top + 300.) {
    // striations: noise stretched along the edge (x) and squeezed in height -> horizontal bands on the face
    vec3 q = vec3(p.x * uShape.x * .22, p.y * uShape.x * 2.6, b * uShape.x * .9);
    vec4 n = textureLod(tNoise, q + vec3(uTime*.002, 0., 0.), uNLod);
    float band = n.r * .55 + n.g * .45;
    float inside = smoothstep(base - 20., base + 30., p.y) * smoothstep(top + 260., top - 140., p.y) * smoothstep(-500., 150., b);
    d = rmp(band * inside, .28 - .1*anvil, 1., 0., 1.) * (1. + 1.4*tw);
    if (fine && d > 0.) { vec4 m = textureLod(tNoise, p * uShape.y, uNLod); float det = m.g*.5 + m.b*.35 + m.a*.15;
      d = rmp(d, det * uShape.w * (1. - .6*tw), 1., 0., 1.); }                                  // cauliflower erosion on the face
  }
  // scud and lowerings just under the base near the edge
  if (p.y < base && p.y > base - 260. && b > -100. && b < 2500.) {
    float s = textureLod(tNoise, vec3(p.x*.0011, p.y*.004, p.z*.0011), uNLod).r;
    d += rmp(s, .62, 1., 0., .5) * smoothstep(base - 260., base - 40., p.y) * smoothstep(-100., 150., b) * smoothstep(2500., 1900., b);   // c2: no hard cut (a lit box edge on the flash)
  }
  // rain shafts under the base: tall, soft, grey, curtains leaning with the outflow
  if (uRain.w > .5 && p.y < base && p.z < uRain.y) {
    float r = textureLod(tNoise, vec3(p.x*.00022 + p.y*.00003, .7, p.z*.00016), uNLod).r;
    d += rmp(r, uRain.z, 1., 0., 1.) * uRain.x * smoothstep(uRain.y, uRain.y - 2500., p.z) * smoothstep(base, base - 200., p.y + 60.);
  }
  return max(d, 0.) * uLite.w;
}`;

const FRAG = (kind, profile) => ATMOS_GLSL + LF_GLSL + /* glsl */`
precision highp sampler3D;
uniform highp sampler3D tNoise; uniform float uNLod; uniform sampler2D tDepth; uniform mat4 uInvProj, uCamWorld;
uniform vec4 uSlab;    // y0, y1, max distance, steps scale
uniform vec4 uShape;   // base scale (1/m), detail scale, coverage, erosion
uniform vec4 uLite;    // extinction per metre at density 1, ambient gain, key gain, density gain
uniform vec3 uAmbTop, uAmbBot, uKeyCol, uKeyDir, uAlb; uniform float uBelow, uLod, uPowder, uJit, uMS;
uniform vec4 uFlashP; uniform vec3 uFlashC; uniform vec2 uFlashR; uniform vec2 uWind2;
varying vec2 vUv;
#define PROFILE ${profile}
float rmp(float v, float lo, float hi, float a, float b){ return a + (v - lo) / max(hi - lo, 1e-4) * (b - a); }
${kind === 'shelf' ? DENS_SHELF : DENS_LAYER}
float lightMarch(vec3 p){
  #ifdef NOLM
  return (uSlab.y - p.y) * .004 * uLite.x / .012;                                          // night decks: optical depth to the top, no march
  #endif
  float od = 0., st = ${kind === 'shelf' ? '90.' : '60.'};
  for (int i = 0; i < 5; i++) { p += uKeyDir * st; od += cloudDens(p, false) * st; st *= 1.8; }
  return od * uLite.x;
}
void main(){
  float d = texture2D(tDepth, vUv).r;
  vec4 vp = uInvProj * vec4(vUv*2.-1., min(d, .9999999)*2.-1., 1.); vp /= vp.w;
  vec3 wp = (uCamWorld * vp).xyz; vec3 rd = normalize(wp - uCamPos);
  float sMax = d >= 1. ? uSlab.z : min(length(wp - uCamPos), uSlab.z);
  // the ray's span inside the slab [y0, y1]
  float y0 = uSlab.x, y1 = uSlab.y, t0 = 0., t1 = sMax;
  if (abs(rd.y) > 1e-5) { float ta = (y0 - uCamPos.y) / rd.y, tb = (y1 - uCamPos.y) / rd.y; t0 = max(min(ta, tb), 0.); t1 = min(max(ta, tb), sMax); }
  else if (uCamPos.y < y0 || uCamPos.y > y1) { gl_FragColor = vec4(0.); return; }
  if (t1 <= t0) { gl_FragColor = vec4(0.); return; }
  float j = fract(sin(dot(gl_FragCoord.xy + uJit, vec2(12.9898, 78.233))) * 43758.5453);
  const int N = ${kind === 'shelf' ? 110 : 80};
  vec3 S = vec3(0.); float T = 1., tw = 0., ww = 0.;
  float cK = dot(rd, uKeyDir), ph = mix(a_hg(cK, .6), a_hg(cK, -.2), .4) * 12.566;                // dual-lobe HG, normalised to ~1 at iso
  float span = t1 - t0, tPrev = t0;
  for (int i = 1; i <= N; i++) {
    float u = (float(i) - 1. + j) / float(N);
    float t = t0 + span * (u * u * .65 + u * .35);                                          // denser near the camera
    float dt = t - tPrev; tPrev = t;
    vec3 p = uCamPos + rd * t;
    float den = cloudDens(p, t < 16000.) * smoothstep(uSlab.z, uSlab.z * .6, t);            // thin out toward the far limit (no grazing strata)
    if (den > .002) {
      float hf = clamp((p.y - uSlab.x) / (uSlab.y - uSlab.x), 0., 1.);
      float od = lightMarch(p);
      float beer = exp(-od), powder = 1. - exp(-od * 2. * uPowder - .05);
      // powder darkens the sun-facing crevices seen from the side, not the rims seen against the sun (Schneider)
      vec3 L = uKeyCol * uLite.z * ph * max(beer, uMS*exp(-od*.25)) * mix(1., powder, .8 * (.5 - .5*cK));       // multiple-scatter floor (Wrenninge)
      L += mix(uAmbBot, uAmbTop, hf) * uLite.y;
      if (uBelow > 0.) { vec2 lu = (p.xz - uLightBox.xy) / (uLightBox.zw - uLightBox.xy);
        if (lu.x > 0. && lu.y > 0. && lu.x < 1. && lu.y < 1.) L += textureLod(tLight, lu, uLod).rgb * uLightGain * uBelow * exp(-hf * 2.2); }
      if (uFlashP.w > 0.) { float fd = length(p - uFlashP.xyz); L += uFlashC * uFlashP.w * exp(-fd / uFlashR.y) / (1. + fd*fd / (uFlashR.x*uFlashR.x)); }
      float ext = den * uLite.x, a = 1. - exp(-ext * dt);
      S += T * a * L * uAlb; tw += T * a * t; ww += T * a; T *= 1. - a;
      if (T < .01) break;
    }
  }
  float alpha = 1. - T;
  if (alpha < .001) { gl_FragColor = vec4(0.); return; }
  float tm = tw / max(ww, 1e-4), tr = fogTr(rd, tm);
  S = S * tr + fogCol(rd, tm) * alpha * (1. - tr);
  gl_FragColor = vec4(S, alpha);
}`;

export class CloudVolume {
  constructor(atmos, o = {}) {
    const A = atmos, kind = o.kind || 'layer';
    this.A = A; this.kind = kind; this.bake = !!o.bake; this.res = o.res ?? 0.5; this.on = true;
    const w = Math.round(A.w * this.res), h = Math.round(A.h * this.res);
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    const lf = A.lf ? A.lf.U : { tLight: { value: null }, uLightBox: { value: new THREE.Vector4(0, 0, 1, 1) }, uLightGain: { value: 1 } };
    const c = (v, k = 1) => new THREE.Color(v).multiplyScalar(k);
    this.U = { ...A.U, ...lf, tNoise: { value: noise3D() }, uNLod: { value: 0 }, tDepth: A.frameU.tDepth, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uSlab: { value: new THREE.Vector4(o.y0 ?? (kind === 'shelf' ? 150 : 1500), o.y1 ?? (kind === 'shelf' ? (o.tower?.top ?? 11000) + 600 : 2500), o.far ?? 40000, 1) },
      uShape: { value: new THREE.Vector4(o.scale ?? 1 / 2500, o.detail ?? 1 / 420, o.cover ?? 0.5, o.erode ?? 0.35) },
      uLite: { value: new THREE.Vector4(o.sigma ?? 0.012, o.amb ?? 1, o.keyGain ?? 1, o.density ?? 1) },
      uAmbTop: { value: c(...(o.ambTop || ['#8894b0', 0.2])) }, uAmbBot: { value: c(...(o.ambBot || ['#3a3a48', 0.08])) },
      uKeyCol: { value: new THREE.Color() }, uKeyDir: { value: new THREE.Vector3(0, 1, 0) }, uAlb: { value: c(...(o.albedo || ['#ffffff', 0.95])) },
      uBelow: { value: o.below ?? 0 }, uLod: { value: o.lod ?? 5 }, uPowder: { value: o.powder ?? 1 }, uJit: { value: 0 }, uMS: { value: o.ms ?? 0.12 },
      uFlashP: { value: new THREE.Vector4(0, 0, 0, 0) }, uFlashC: { value: new THREE.Color(0.78, 0.84, 1) }, uFlashR: { value: new THREE.Vector2(900, 700) },
      uWind2: { value: new THREE.Vector2(...(o.wind || [3, 1])) },
      uEdge: { value: new THREE.Vector4(o.edge?.z0 ?? -1300, o.edge?.curve ?? 3e-5, o.edge?.h ?? 520, o.edge?.base ?? 1150) },
      uTower: { value: new THREE.Vector4(o.tower?.b0 ?? 7000, o.tower?.top ?? 11000, 0, o.tower?.halfW ?? 16000) },
      uRain: { value: new THREE.Vector4(o.rain?.dens ?? 0.08, o.rain?.z0 ?? -4000, o.rain?.th ?? 0.5, o.rain ? 1 : 0) } };
    this.keyFrom = o.key || 'auto';                       // 'sun' | 'moon' | 'auto' | { dir, color, k }
    this.mat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: V_GLSL, fragmentShader: FRAG(kind, o.profile === 'stratus' ? 1 : 0), depthTest: false, depthWrite: false, defines: o.march === false ? { NOLM: 1 } : {} });
    // composite: a 9-tap tent over the reduced-resolution march (the per-pixel march jitter becomes grain-free softness)
    this.comp = new THREE.ShaderMaterial({ uniforms: { tV: { value: this.rt.texture }, uTx: { value: new THREE.Vector2(1 / w, 1 / h) }, uSoft: { value: o.soften ?? 1 } }, vertexShader: V_GLSL, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      fragmentShader: `uniform sampler2D tV; uniform vec2 uTx; uniform float uSoft; varying vec2 vUv; void main(){ vec2 o = uTx * uSoft;
        vec4 c = texture2D(tV, vUv) * 4. + (texture2D(tV, vUv + vec2(o.x, 0.)) + texture2D(tV, vUv - vec2(o.x, 0.)) + texture2D(tV, vUv + vec2(0., o.y)) + texture2D(tV, vUv - vec2(0., o.y))) * 2.
          + texture2D(tV, vUv + o) + texture2D(tV, vUv - o) + texture2D(tV, vUv + vec2(o.x, -o.y)) + texture2D(tV, vUv + vec2(-o.x, o.y));
        gl_FragColor = c / 16.; }` });
    this._key = null; this.stats = {};
    A.mid.push((a, cam, t) => this._render(cam, t));
  }
  flash(p, i, r = 900, diff = 700) { this.U.uFlashP.value.set(p[0], p[1], p[2], i); this.U.uFlashR.value.set(r, diff); }
  _render(cam, t) {
    if (!this.on) return;
    const A = this.A, r = A.renderer, U = this.U;
    // key: the sun while it is above -6 deg (clouds stay lit after sunset), else the moon
    let dir, col;
    if (typeof this.keyFrom === 'object') { dir = new THREE.Vector3(...this.keyFrom.dir).normalize(); col = new THREE.Color(this.keyFrom.color).multiplyScalar(this.keyFrom.k ?? 1); }
    else { const sun = A.U.uSSunDir.value, useSun = this.keyFrom === 'sun' || (this.keyFrom === 'auto' && sun.y > -0.1);
      dir = (useSun ? sun : A.U.uSMoonDir.value).clone().normalize(); col = (useSun ? A.U.uSSunCol.value : A.U.uSMoonCol.value).clone(); }
    U.uKeyDir.value.copy(dir); U.uKeyCol.value.copy(col);
    U.uInvProj.value.copy(cam.projectionMatrixInverse); U.uCamWorld.value.copy(cam.matrixWorld);
    const key = [...cam.matrixWorld.elements, ...cam.projectionMatrix.elements, ...U.uFlashP.value.toArray(), this.bake ? 0 : t].map(v => v.toFixed(4)).join(',');
    if (!(this.bake && key === this._key)) {
      const t0 = performance.now();
      A.quad.material = this.mat; r.setRenderTarget(this.rt); r.setClearColor(0, 0); r.clear(); r.render(A.qscene, A.qcam); r.setClearColor(0, 1);
      this._key = key; this.stats.marchMs = Math.round(performance.now() - t0);
    }
    A.quad.material = this.comp; r.setRenderTarget(A.rtF); const ac = r.autoClear; r.autoClear = false; r.render(A.qscene, A.qcam); r.autoClear = ac;
  }
}
