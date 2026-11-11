// ATMOS: the silhouette / rim / haze / shafts compositor for three.js worlds (the WHO OWNS THE MACHINES and GIANT b50
// look as a reusable stage), plus LightCone, a raymarched volumetric beam that lives inside a three.js scene.
//
//   import { Atmos, LightCone } from '../lib/fx/atmos.js';
//   const atm = new Atmos(world.renderer, { w: 1080, h: 1920 });          // world = world3d.js World (or any renderer)
//   figures.forEach(m => m.layers.enable(atm.maskLayer));                  // what counts as "the figure" (people meshes)
//   atm.render(world.scene, world.camera, {                                // replaces world.render(); pure in t
//     sun:   { dir: [0, 0.08, -1], color: '#ff5a2a', intensity: 1 },       // world direction TO the sun
//     haze:  { color: '#2a0d10', density: 0.006, falloff: 0.03, g: 0.78, sun: 1.2 },
//     rays:  { amount: 1.2, threshold: 0.6, length: 0.85, decay: 0.965, radius: 0.55, falloff: 2.5 },
//     wrap:  { amount: 0.8 },  edge: { amount: 1.5, width: 2 },           // light wrap + sun-side separation line
//     glow:  { amount: 0.35, threshold: 1.0 },
//     grade: { exposure: 1, warm: '#3a0806', contrast: 0.15, saturation: 1.05, vignette: 0.35, grain: 0.04, t } });
//
// Pipeline (all linear HDR until the last pass):
//   1. scene -> half-float MSAA target with a depth texture (full res); the figure layer alone -> an alpha mask (half res)
//   2. shafts (quarter res): sky-and-bright source near the sun, then two chained 24-tap radial blurs (576 effective taps)
//   3. light wrap (quarter res): the background with the figure cut out, blurred, bleeds over the figure's edge
//   4. glow (quarter + eighth res): threshold bloom
//   5. composite (full res): height-fog extinction + Henyey-Greenstein forward scatter from depth, shafts, wrap,
//      a sun-side separation line on the silhouette that takes the colour of the sky just behind it, glow, then the
//      grade: exposure, ACES, warm (never black) shadow floor, contrast, saturation, vignette, grain, dither, sRGB.
// A scene rendered through Atmos must NOT rely on renderer tone mapping (it is applied here); World's fog still works.
import * as THREE from 'three';
import { Passes, NOISE, TONE, HG, sunScreen } from './glfx.js';

const col3 = c => { const k = new THREE.Color(c); return [k.r, k.g, k.b]; };

const F_SRC = /* glsl */`uniform sampler2D tCol, tDep; uniform vec3 uSun; uniform float uThr, uRad, uAsp; ${TONE}
void main(){ float d = texture(tDep, vUv).r; vec3 c = texture(tCol, vUv).rgb;
  vec2 dv = (vUv - uSun.xy) * vec2(uAsp, 1.0); float near = exp(-dot(dv, dv) / (uRad * uRad));
  float sky = step(0.99999, d); o = vec4(max(c - uThr, 0.0) * sky * near * step(0.0, uSun.z), 1.0); }`;
const F_RADIAL = /* glsl */`uniform sampler2D tSrc; uniform vec2 uSun; uniform float uLen, uDecay, uGain, uHash, uFall, uAsp;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uHash) * 43758.5453); }
void main(){ vec2 d = (vUv - uSun) * uLen / 24.0, uv = vUv - d * h(gl_FragCoord.xy); vec3 s = vec3(0.0); float w = 1.0, ws = 0.0;
  for (int i = 0; i < 24; i++){ s += texture(tSrc, uv).rgb * w; ws += w; w *= uDecay; uv -= d; }
  vec2 dv = (vUv - uSun) * vec2(uAsp, 1.0); o = vec4(s / ws * uGain * exp(-length(dv) * uFall), 1.0); }`;
const F_CUT = /* glsl */`uniform sampler2D tCol, tMask; void main(){ float m = texture(tMask, vUv).a; o = vec4(texture(tCol, vUv).rgb * (1.0 - m), m); }`;
const F_THR = /* glsl */`uniform sampler2D tCol; uniform float uThr; uniform vec2 uPx; void main(){
  vec3 c = 0.25 * (texture(tCol, vUv + uPx * vec2(-1.0, -1.0)).rgb + texture(tCol, vUv + uPx * vec2(1.0, -1.0)).rgb + texture(tCol, vUv + uPx * vec2(-1.0, 1.0)).rgb + texture(tCol, vUv + uPx * vec2(1.0, 1.0)).rgb);
  c = min(c, vec3(16.0)); float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  o = vec4(c * max(l - uThr, 0.0) / max(l, 1e-3), 1.0); }`;

const F_COMP = /* glsl */`
uniform sampler2D tCol, tDep, tMask, tRays, tWrap, tGlowA, tGlowB;
uniform mat4 uInvProj, uCamWorld; uniform vec3 uCamPos, uSunDir, uSunCol, uSun;
uniform vec3 uHazeCol; uniform float uHazeDen, uHazeFall, uHazeG, uHazeSun, uHazeStart, uHazeMax;
uniform float uRays, uWrap, uEdge, uEdgeW, uGlow, uHasMask; uniform vec3 uRayTint, uEdgeTint;
uniform float uExpo, uContrast, uSat, uVig, uGrain, uTime, uToe; uniform vec3 uWarm, uLift, uHi; uniform float uHiAmt; uniform vec2 uRes;
float hashu(uint x){ x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return float(x) / 4294967295.0; }
${NOISE} ${TONE} ${HG}
void main(){
  vec3 c = texture(tCol, vUv).rgb; float d = texture(tDep, vUv).r;
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vp /= vp.w;
  vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz, rd = normalize(wp - uCamPos); float dist = length(vp.xyz);
  // ---- atmosphere: exponential height fog, analytic along the ray, with forward scatter toward the sun
  if (d < 0.99999 && uHazeDen > 0.0) {
    float s = max(dist - uHazeStart, 0.0), y0 = uCamPos.y, y1 = wp.y, dy = y1 - y0;
    float hf = abs(dy * uHazeFall) > 1e-3 ? (exp(-uHazeFall * y0) - exp(-uHazeFall * y1)) / (uHazeFall * dy) : exp(-uHazeFall * y0);
    float T = max(exp(-uHazeDen * s * hf), 1.0 - uHazeMax);
    vec3 Lin = uHazeCol + uSunCol * uHazeSun * hg(dot(rd, uSunDir), uHazeG) * 4.0;
    c = c * T + Lin * (1.0 - T);
  }
  float m = uHasMask > 0.5 ? texture(tMask, vUv).a : 0.0;
  // ---- light wrap: the blurred background bleeds over the figure's edge (the figure sits IN the light)
  if (uHasMask > 0.5) {
    vec4 wr = texture(tWrap, vUv); c += uWrap * wr.rgb * m * 1.6;
    // ---- separation line: figure pixels whose neighbour toward the sun is background get that background's light
    vec2 toSun = uSun.xy - vUv; toSun.x *= uRes.x / uRes.y; float ls = length(toSun); vec2 dir = ls > 1e-4 ? toSun / ls : vec2(0.0, 1.0);
    dir.x *= uRes.y / uRes.x; vec2 px = dir * uEdgeW / uRes.y;
    float mn = texture(tMask, vUv + px).a, mn2 = texture(tMask, vUv + px * 2.5).a;
    float e = m * (1.0 - mn * 0.6 - mn2 * 0.4);
    vec3 behind = texture(tCol, vUv + px * 4.0).rgb;
    c += uEdge * e * (behind * 1.4 + uSunCol * 0.25) * uEdgeTint;
  }
  c += texture(tRays, vUv).rgb * uRays * uRayTint;
  c += (texture(tGlowA, vUv).rgb * 0.6 + texture(tGlowB, vUv).rgb * 0.8) * uGlow;
  // ---- grade
  c *= uExpo;
  c = aces(c);
  float l = luma(c);
  c += uWarm * pow(1.0 - smoothstep(0.0, 0.4, l), 2.0);                 // shadows go warm, never grey-black
  c = max(c, uLift);                                                      // ink floor (a coloured black)
  c = mix(c, uHi * l * 1.15, smoothstep(0.55, 1.0, l) * uHiAmt);        // highlights bleach toward cream (film shoulder)
  c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  c = sat(c, uSat);
  vec2 q = vUv - 0.5; c *= 1.0 - uVig * smoothstep(0.25, 0.95, dot(q * vec2(1.0, 0.75), q * vec2(1.0, 0.75)) * 2.2);
  uvec2 ip = uvec2(gl_FragCoord.xy); uint fr = uint(uTime * 30.0 + 0.5);
  float g = hashu(ip.x + 4096u * ip.y + fr * 16777259u) + hashu(ip.x * 7u + 4096u * ip.y * 13u + fr * 2654435u + 99u) - 1.0;
  c += g * uGrain * (0.35 + 0.65 * (1.0 - l)) * 0.5;
  c = srgb(c) + (hashu(ip.x * 3u + 8192u * ip.y + 7u) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;

export class Atmos {
  constructor(renderer, { w = 1080, h = 1920, samples = 4, maskScale = 0.5, rayScale = 0.25, maskLayer = 7 } = {}) {
    this.r = renderer; this.w = w; this.h = h; this.maskLayer = maskLayer; this.maskScale = maskScale; this.rayScale = rayScale;
    this.fx = new Passes(renderer);
    this.hdr = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    this.hdr.depthTexture = new THREE.DepthTexture(w, h); this.hdr.depthTexture.type = THREE.UnsignedIntType;
    this.mask = new THREE.WebGLRenderTarget(Math.round(w * maskScale), Math.round(h * maskScale), { type: THREE.UnsignedByteType, samples: samples ? 2 : 0 });
    this.stats = {}; this.profile = false;
    this._black = new THREE.DataTexture(new Uint8Array(4), 1, 1); this._black.needsUpdate = true;
  }
  _t(k, t0) { if (this.profile) { this.fx.sync(); this.stats[k] = (this.stats[k] || 0) + performance.now() - t0; } return performance.now(); }
  // 1. scene capture (HDR + depth) and the figure mask. Call before composite(); render() does both.
  capture(scene, camera, { mask = true, before = null } = {}) {
    const r = this.r, tm = r.toneMapping; let t0 = performance.now();
    r.toneMapping = THREE.NoToneMapping;
    camera.updateMatrixWorld();
    if (before) before(camera);
    r.setRenderTarget(this.hdr); r.clear(); r.render(scene, camera);
    t0 = this._t('scene', t0);
    this._hasMask = false;
    if (mask) {
      const layers = camera.layers.mask, bg = scene.background, sm = r.shadowMap.autoUpdate, cc = new THREE.Color(), ca = r.getClearAlpha();
      r.getClearColor(cc); camera.layers.set(this.maskLayer); scene.background = null; r.shadowMap.autoUpdate = false;
      r.setClearColor(0x000000, 0); r.setRenderTarget(this.mask); r.clear(); r.render(scene, camera);
      camera.layers.mask = layers; scene.background = bg; r.shadowMap.autoUpdate = sm; r.setClearColor(cc, ca);
      this._hasMask = true; t0 = this._t('mask', t0);
    }
    r.setRenderTarget(null); r.toneMapping = tm;
    this._cam = camera;
    return this;
  }
  // 2..5. the compositing passes; target null = the canvas
  composite(o = {}, target = null) {
    const fx = this.fx, cam = this._cam, W = this.w, H = this.h; let t0 = performance.now();
    const sun = o.sun || {}, haze = o.haze || {}, rays = o.rays || {}, wrap = o.wrap || {}, edge = o.edge || {}, glow = o.glow || {}, gr = o.grade || {};
    const sdir = new THREE.Vector3(...(sun.dir || [0, 0.1, -1])).normalize();
    const ss = sunScreen(cam, sdir.toArray());
    const sunC = col3(sun.color || '#ff7a40').map(v => v * (sun.intensity ?? 1));
    const rs = this.rayScale, rw = W * rs, rh = H * rs;
    // shafts
    let raysTex = this._black;
    if ((rays.amount ?? 0) > 0 && ss[2] > -0.2) {
      const a = fx.target('atm_raysrc', rw, rh), b = fx.target('atm_rays1', rw, rh), c = fx.target('atm_rays2', rw, rh);
      fx.run('atm_src', F_SRC, { tCol: this.hdr.texture, tDep: this.hdr.depthTexture, uSun: [ss[0], ss[1], ss[2]], uThr: rays.threshold ?? 0.5, uRad: rays.radius ?? 0.5, uAsp: W / H }, a);
      fx.run('atm_radial', F_RADIAL, { tSrc: a.texture, uSun: [ss[0], ss[1]], uLen: rays.length ?? 0.85, uDecay: rays.decay ?? 0.965, uGain: 1, uHash: 0.37, uFall: rays.falloff ?? 2.5, uAsp: W / H }, b);
      fx.run('atm_radial', F_RADIAL, { tSrc: b.texture, uSun: [ss[0], ss[1]], uLen: (rays.length ?? 0.85) / 24, uDecay: 0.995, uGain: 1, uHash: 1.91, uFall: 0, uAsp: W / H }, c);
      raysTex = c.texture;
    }
    t0 = this._t('rays', t0);
    // light wrap
    let wrapTex = this._black;
    if (this._hasMask && ((wrap.amount ?? 0.6) > 0)) {
      const a = fx.target('atm_cut', rw, rh), b = fx.target('atm_wrap', rw, rh);
      fx.run('atm_cut', F_CUT, { tCol: this.hdr.texture, tMask: this.mask.texture }, a);
      fx.blur('atm_wrapb', a, b, (wrap.radius ?? 1.6)); fx.blur('atm_wrapb2', b, a, (wrap.radius ?? 1.6) * 2.2);
      wrapTex = a.texture;
    }
    t0 = this._t('wrap', t0);
    // glow
    let gA = this._black, gB = this._black;
    if ((glow.amount ?? 0) > 0) {
      const a = fx.target('atm_g4', W / 4, H / 4), b = fx.target('atm_g4b', W / 4, H / 4); let c = fx.target('atm_g8', W / 8, H / 8);
      fx.run('atm_thr', F_THR, { tCol: this.hdr.texture, uThr: glow.threshold ?? 1, uPx: [1 / W, 1 / H] }, a);
      fx.blur('atm_gb', a, b, 0.8); fx.blur('atm_gb2', b, a, 1.0); fx.blur('atm_gb3', a, b, 1.2); fx.blur('atm_gc', b, c, 0.8); fx.blur('atm_gc2', c, fx.target('atm_g8b', W / 8, H / 8), 1.1); c = fx.target('atm_g8b', W / 8, H / 8);
      gA = b.texture; gB = c.texture;
    }
    t0 = this._t('glow', t0);
    fx.run('atm_comp', F_COMP, {
      tCol: this.hdr.texture, tDep: this.hdr.depthTexture, tMask: this._hasMask ? this.mask.texture : this._black, tRays: raysTex, tWrap: wrapTex, tGlowA: gA, tGlowB: gB,
      uInvProj: cam.projectionMatrixInverse, uCamWorld: cam.matrixWorld, uCamPos: cam.position.clone(), uSunDir: sdir, uSunCol: sunC, uSun: ss,
      uHazeCol: col3(haze.color || '#000').map(v => v * (haze.ambient ?? 1)), uHazeDen: haze.density ?? 0, uHazeFall: haze.falloff ?? 0, uHazeG: haze.g ?? 0.75,
      uHazeSun: haze.sun ?? 1, uHazeStart: haze.start ?? 0, uHazeMax: haze.max ?? 1,
      uRays: rays.amount ?? 0, uRayTint: col3(rays.tint || '#ffffff'), uWrap: wrap.amount ?? 0.6, uEdge: edge.amount ?? 1, uEdgeW: edge.width ?? 2, uEdgeTint: col3(edge.tint || '#ffffff'),
      uGlow: glow.amount ?? 0, uHasMask: this._hasMask ? 1 : 0,
      uExpo: gr.exposure ?? 1, uContrast: gr.contrast ?? 0.1, uSat: gr.saturation ?? 1, uVig: gr.vignette ?? 0.3, uGrain: gr.grain ?? 0.03, uTime: gr.t ?? 0,
      uWarm: col3(gr.warm || '#000000'), uLift: col3(gr.floor || '#000000'), uHi: col3(gr.highlight || '#fff0dc'), uHiAmt: gr.bleach ?? 0.35, uToe: 0, uRes: [W, H],
    }, target);
    this._t('composite', t0);
    return target;
  }
  render(scene, camera, o = {}, target = null) { this.capture(scene, camera, { mask: o.mask !== false, before: o.before }); return this.composite(o, target); }
}

// ------------------------------------------------------------------ LightCone: a volumetric beam (stage light, a searchlight,
// a furnace door's cone, a window shaft). Apex at the object's origin pointing down -Y; raymarched in the fragment shader
// (16 steps) through the analytic cone, with inverse-square falloff, soft edges, drifting dust and a few sparkling motes.
//   const beam = new LightCone({ height: 30, radius: 7, color: '#ffd9b0', intensity: 2.5, dust: 0.6 });
//   beam.position.set(0, 30, 0); beam.rotation.x = 0.2; scene.add(beam); beam.update(t);
// Additive, depthWrite off, drawn on back faces so it works with the camera inside the beam.
export class LightCone extends THREE.Mesh {
  constructor({ height = 20, radius = 5, color = '#ffe2c0', intensity = 2, dust = 0.5, motes = 0.2, soft = 0.35, seed = 1, steps = 16 } = {}) {
    const geo = new THREE.ConeGeometry(radius * 1.04, height, 40, 1, false); geo.translate(0, -height / 2, 0);   // apex at the origin, base at y = -height
    const U = { uCol: { value: new THREE.Color(color) }, uI: { value: intensity }, uH: { value: height }, uK: { value: radius / height }, uDust: { value: dust },
      uMotes: { value: motes }, uSoft: { value: soft }, uT: { value: 0 }, uSeed: { value: seed }, uInvModel: { value: new THREE.Matrix4() }, uCamLocal: { value: new THREE.Vector3() } };
    const mat = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, fog: false,
      vertexShader: `varying vec3 vL; void main(){ vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uCol, uCamLocal; uniform float uI, uH, uK, uDust, uMotes, uSoft, uT, uSeed; varying vec3 vL;
        ${NOISE}
        void main(){
          vec3 ro = uCamLocal, rd = normalize(vL - ro); float tExit = length(vL - ro);
          // ray vs infinite cone x^2+z^2 = k^2 y^2 (y < 0)
          float k2 = uK * uK, A = rd.x*rd.x + rd.z*rd.z - k2*rd.y*rd.y, B = 2.0*(ro.x*rd.x + ro.z*rd.z - k2*ro.y*rd.y), C = ro.x*ro.x + ro.z*ro.z - k2*ro.y*ro.y;
          float disc = B*B - 4.0*A*C, tIn = 0.0;
          if (disc > 0.0) { float s = sqrt(disc), t0 = (-B - s) / (2.0*A), t1 = (-B + s) / (2.0*A); if (t0 > t1) { float x = t0; t0 = t1; t1 = x; }
            float ta = t0; if ((ro + rd*ta).y > 0.0) ta = t1; tIn = clamp(ta, 0.0, tExit); }
          if (C < 0.0 && ro.y < 0.0 && ro.y > -uH) tIn = 0.0;        // camera inside
          float tb = (-uH - ro.y) / rd.y; if (ro.y < -uH && tb > 0.0) tIn = max(tIn, tb);
          float seg = max(tExit - tIn, 0.0), dt = seg / 16.0, acc = 0.0, sp = 0.0;
          for (int i = 0; i < 16; i++){
            vec3 p = ro + rd * (tIn + dt * (float(i) + 0.5)); float y = -p.y; if (y <= 0.0 || y > uH) continue;
            float r = length(p.xz) / (uK * y), edge = 1.0 - smoothstep(1.0 - uSoft, 1.0, r);
            float fall = 1.0 / (1.0 + 0.12 * y * y / (uH * 0.08)) * (1.0 - smoothstep(0.75, 1.0, y / uH));
            float n = vnoise3(p * 0.28 + vec3(0.0, uT * 0.08, uT * 0.05) + uSeed) * 0.65 + vnoise3(p * 0.9 - vec3(uT * 0.1, 0.0, 0.0) + uSeed * 1.7) * 0.35;
            float dens = edge * fall * mix(1.0, smoothstep(0.2, 0.85, n) * 1.6, uDust) * (0.55 + 0.45 * (1.0 - r * r));
            float mo = smoothstep(0.965, 0.995, vnoise3(p * 9.0 + vec3(0.0, -uT * 0.3, 0.0) + uSeed * 3.0)) * 5.0 * uMotes * edge;
            acc += dens * dt; sp += mo * dt;
          }
          vec3 c = uCol * uI * (acc * 0.12 + sp * 0.02);
          gl_FragColor = vec4(c, 1.0);
        }` });
    super(geo, mat); this.frustumCulled = false; this.renderOrder = 10; this.U = U;
    this.onBeforeRender = (r, s, cam) => { this.updateMatrixWorld(); U.uInvModel.value.copy(this.matrixWorld).invert(); U.uCamLocal.value.copy(cam.position).applyMatrix4(U.uInvModel.value); };
  }
  update(t) { this.U.uT.value = t; return this; }
}
