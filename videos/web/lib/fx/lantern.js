// LANTERN (8 Oct 2026; THE PLANT THAT WOULD NOT DIE, research/october/PLANT_brief.md): reveal by light. A hand-held or mounted light whose
// pool shows a second picture (another time, a reel plate, a thermal pass) wherever it falls and nowhere else, cut by the light's own
// shadows; plus the queries that let eyes, type and the score follow the light. One module: the light (Lantern) and the matte it casts
// (LightMatte). Notes and measures: research/capabilities/lantern.md. Checks (node, no GL): web/labs/lantern/lantern_test.mjs.
//
//   import { Lantern, LightMatte } from '../lib/fx/lantern.js';
//   const torch = new Lantern(scene, { profile: 'led' | 'incandescent' | 'searchlight' | 'lantern', lumens: 1000, half: 0.21, pen: 0.25,
//                                      shadow: 1024, cookie: null, ref: 3, knee: 0.15, body: true, beam: true });
//        // a THREE.SpotLight in candela (lumens over the profile's own solid angle), castShadow on; .map = the profile's reflector cookie
//        // (a hard disc, a hot ring just inside its rim, dim spill out to the cone), or `cookie` (a canvas: a gobo, e.g. a reel frame)
//   torch.hold(hero, 'R', { aimAt })  // the 24 cm body gripped with hero.grip at the palm, aimed at aimAt (or along hero's handle axis)
//   torch.place(pos).aim(target)      // or mounted: a work lamp on a bench, a searchlight on a roof
//   torch.drift(t, { seed, amp })     // hand tremor + breath + wander (band-limited noise, deterministic in t): turns the aim, returns {yaw, pitch}
//   torch.on(k)                       // 0..1: the thumb on the tail switch
//   torch.update(camera)              // after moving it: the light, the body, the beam (call once a frame, before rendering)
//   torch.beam                        // the visible shaft in haze: spectre.js's analytic gaussian beam, lifted and generalised (a mesh;
//                                     // its length stops at the first of torch.stops it meets on the axis; haze level torch.haze)
//   torch.gain                        // a photometric trim on the rendered light only (a scene's exposure units); the matte and lit() ignore it
//   torch.lit(p) -> 0..1              // CPU: profile x inverse-square (1 at torch.ref metres in the core, capped at torch.cap nearer: default 1,
//                                     // so the dim spill never reaches the knee however close the surface) x ray test against torch.occluders
//   torch.illum(p)                    // the same, unclamped (the hot ring reads > 1; cap > 1 lets the core grow nearer than ref)
//   torch.sweepTimes(points, t0, t1, fps, { path, knee }) -> [t]   // first time each point is lit >= knee as torch.path(t) moves it
//                                     // (spectre.js sweepTime generalised): eyes, cues, switches, a world-space persist
//   torch.asPractical()               // the same light as a light/practicals.js record ({ kind: 'torch', ... }) for LitRenderer scenes
//
//   const lm = new LightMatte(renderer, { w: 540, h: 960 });          // masks at half resolution
//   lm.light(depthTex, camera, torch, { knee: 0.15, edge: 0.04, ragged: 0.3, t }) -> mask
//        // per pixel: world position from the frame's own depth texture (so GPU-skinned people.js / hero.js are exact), the profile,
//        // inverse-square, and the torch's shadow map (light.shadow.map.texture + light.shadow.matrix, unpackRGBAToDepth, normal bias from
//        // the depth's own derivatives, 3x3 PCF, as three r170's getShadow), a soft knee, an fbm-ragged edge riding the light (not the
//        // screen). One fullscreen pass; no second scene render. mask: r = reveal 0..1, g = light level (lit), b = shadow visibility.
//   lm.layer(scene, camera, layer) -> mask    // a mesh set's own coverage, occluded by the rest (the exterior's window panes on layer 3)
//   lm.self(src, { key: 0.55, soft: 0.2 }) -> mask   // a picture's own highlights reveal it (the line running by its own light)
//   lm.persist(mask, { decay: 0 })   // max-accumulate: once lit, stays revealed (decay 0 = forever, per call); lm.reset() clears.
//                                     // Screen-space: for a locked-off shot; a moving camera wants a world persist (sweepTimes)
//   lm.reveal(base, over, mask, { tint, gain, edge, exposure, lightK, target }) -> texture
//        // base and over are render targets with depth textures: `over` is drawn on cards at the stations' depth (matte.js practice) and
//        // shows only where it is not behind the base, so camera drift parallaxes with the set and a figure in front stays in front.
//        // base is tone-mapped (three's ACES at `exposure`) and encoded; over is the plate as lit (x mask.g by lightK). Display-referred out.
//        // persistA: 1 = over's alpha carries a WORLD persist: a card writes a = 0.5 + 0.5 p (p 0..1: how much of it the light has already
//        //   found, e.g. an accumulator in the card's uv filled from torch.illum), and the reveal is max(mask, p): seekable, camera-proof.
//        //   A card is present wherever a >= 0.5 (an opaque card, a = 1, is p = 1). selfK: the plate x its own highlights (smoothstep of its
//        //   luma about key +- soft): with the light gone the picture keeps only what shines in it (lightK 0).
//   lm.max(a, b) -> mask              // the union of two masks (a light and a persist, a light and a self)
//   lm.display(tex)                   // the texture to the canvas, as is
//   lm.coverage(mask, rect) -> 0..1   // a 16x16 reduction on the GPU (4x4 taps a texel), read back: how much of a region is revealed
//
// Ground truth: the node checks compare the matte's shader math (mirrored line for line in JS: matteAt, the depth reconstruction, the
// shadow lookup on an RGBA-packed map built by ray casting, three r170's packing) with lit()'s ray test: mean abs 0.05 (the brief's
// tolerance for the lab against superposition). A GPU lab against relight.js's superposition is for the farm's bench.
// Not in scope: a ray-marched air pass, lens flare (use torch.beam and the grade).
import * as THREE from 'three';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const v3 = a => (Array.isArray(a) ? V3(...a) : a.clone());

// ------------------------------------------------------------------ the profiles (r = angle off the axis / half: 0 on the axis, 1 at the cone)
// ring: the hard disc's radius; edgeW: its edge's half-width (pen x 0.1); ringW / ringGain: the hot reflector ring just inside the rim;
// spill: the dim light outside the disc, falling to nothing at the cone. lamp: the practicals.js colour key.
export const PROFILES = {
  led:          { half: 0.21, lumens: 1000, color: '#f2f5ff', lamp: 'led', ring: 0.8, edgeW: 0.025, ringW: 0.07, ringGain: 1.55, spill: 0.11 },
  incandescent: { half: 0.3, lumens: 250, color: '#ffd7a0', lamp: 2700, ring: 0.62, edgeW: 0.1, ringW: 0.16, ringGain: 1.25, spill: 0.3 },
  searchlight:  { half: 0.085, lumens: 600000, color: '#eef3ff', lamp: 'metalHalide', ring: 0.88, edgeW: 0.04, ringW: 0.06, ringGain: 1.12, spill: 0.06 },
  lantern:      { half: 1.35, lumens: 160, color: '#ffc58a', lamp: 1900, ring: 0.86, edgeW: 0.12, ringW: 0, ringGain: 1, spill: 0 },
};
export function shapeOf(o = {}) {
  const P = { ...(PROFILES[o.profile || 'led'] || PROFILES.led), ...(o.shape || {}) };
  if (o.pen != null) P.edgeW = o.pen * 0.1;
  if (o.half != null) P.half = o.half;
  if (o.lumens != null) P.lumens = o.lumens;
  return P;
}
// the profile at r (JS; the GLSL below is the same expression)
export function profileAt(P, r) {
  if (!(r < 1)) return 0;
  const e = Math.max(1e-4, P.edgeW), core = 1 - sstep(P.ring - e, P.ring + e, r);
  const c = P.ring - 1.2 * e - 0.5 * P.ringW, bump = P.ringW > 0 ? (P.ringGain - 1) * Math.exp(-0.5 * ((r - c) / (0.5 * P.ringW)) ** 2) : 0;
  const spill = P.spill * (1 - sstep(P.ring, 1, r));
  return core * (1 + bump) + (1 - core) * spill;
}
export function profilePeak(P) { let m = 0; for (let i = 0; i <= 2000; i++) m = Math.max(m, profileAt(P, i / 2000)); return m; }
// luminous flux per candela of the core: the profile over its solid angle (sr)
export function fluxPerCandela(P, half = P.half, n = 4000) {
  let s = 0; const dt = half / n;
  for (let i = 0; i < n; i++) { const th = (i + 0.5) * dt; s += profileAt(P, th / half) * 2 * Math.PI * Math.sin(th) * dt; }
  return s;
}
export const candela = (lumens, P, half = P.half) => lumens / fluxPerCandela(P, half);
// the cookie three projects through the light's shadow frustum: uv = 0.5 + 0.5 tan(theta) / tan(angle) (camera space, focus 1), so the
// texel at radius rho holds the profile at theta = atan(rho tan(angle)); stored / peak (the peak goes into the intensity), linear
export function cookieData(P, half = P.half, N = 256) {
  const d = new Uint8Array(N * N * 4), pk = profilePeak(P), ta = Math.tan(half);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N * 2 - 1, y = (j + 0.5) / N * 2 - 1, rho = Math.hypot(x, y), th = Math.atan(rho * ta);
    const v = Math.round(255 * clamp(profileAt(P, th / half) / pk)), k = (j * N + i) * 4;
    d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255;
  }
  return { data: d, N, peak: pk };
}
export function cookieTexture(P, half = P.half, N = 256) {
  const c = cookieData(P, half, N), t = new THREE.DataTexture(c.data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; t.userData.peak = c.peak;
  return t;
}

// ------------------------------------------------------------------ the hand: tremor (8-11 Hz, tiny), breath (0.2-0.35 Hz), wander (0.4-1.6 Hz)
// a sum of sines, frequencies and phases drawn from the seed inside each band: band-limited, deterministic in t, no state. amp = rms (rad).
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const _bands = new Map();
export const DRIFT_BANDS = [[0.2, 0.35, 0.55], [0.4, 1.6, 0.8], [8, 11, 0.12]];          // [lo Hz, hi Hz, share of the rms]
function bandsOf(seed) {
  if (_bands.has(seed)) return _bands.get(seed);
  const R = mulberry(seed * 7919 + 13), out = [];
  for (const [lo, hi, w] of DRIFT_BANDS) for (let k = 0; k < 4; k++) out.push({ f: lo + (hi - lo) * R(), py: 6.283 * R(), pp: 6.283 * R(), w: w / 2 });
  const tot = Math.sqrt(DRIFT_BANDS.reduce((a, b) => a + b[2] * b[2], 0));                 // normalised so the rms of each axis is amp
  for (const o of out) o.w /= tot;
  _bands.set(seed, out); return out;
}
export function driftAt(t, { seed = 1, amp = 0.012 } = {}) {
  let yaw = 0, pitch = 0;
  for (const o of bandsOf(seed)) { yaw += o.w * Math.sin(6.283185 * o.f * t + o.py); pitch += o.w * Math.sin(6.283185 * o.f * t + o.pp); }
  return { yaw: yaw * amp * Math.SQRT2, pitch: pitch * amp * Math.SQRT2 };
}

// ------------------------------------------------------------------ three r170's depth packing (packing.glsl.js), mirrored for the checks
export function packDepthRGBA(v) {
  if (v <= 0) return [0, 0, 0, 0]; if (v >= 1) return [255, 255, 255, 255];
  let vuf = v * 16777216; const af = vuf - Math.floor(vuf); vuf = Math.floor(vuf);
  let x = vuf / 256; const bf = x - Math.floor(x); vuf = Math.floor(x);
  x = vuf / 256; const gf = x - Math.floor(x); vuf = Math.floor(x);
  const q = c => Math.round(clamp(c) * 255);                                             // an RGBA8 target stores each channel to /255
  return [q(vuf / 255), q(gf * 256 / 255), q(bf * 256 / 255), q(af)];
}
export const unpackRGBADepth = b => (b[0] / 255) * (255 / 256) + (b[1] / 255) * (255 / 256 / 256) + (b[2] / 255) * (255 / 256 / 65536) + (b[3] / 255) / 16777216;

// ------------------------------------------------------------------ noise (uint hashing: the GPU and JS agree bit for bit on the lattice)
function hashu(x, y) { let h = (Math.imul(x >>> 0, 1664525) + Math.imul(y >>> 0, 1013904223)) >>> 0; h ^= h >>> 16; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489917) >>> 0; h ^= h >>> 16; return h >>> 0; }
const h21 = (x, y) => hashu((Math.floor(x) + 32768) >>> 0, (Math.floor(y) + 32768) >>> 0) / 4294967295;
function vn(x, y) { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = h21(ix, iy), b = h21(ix + 1, iy), c = h21(ix, iy + 1), d = h21(ix + 1, iy + 1); return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy; }
export const fbm2 = (x, y) => vn(x, y) * 0.5 + vn(x * 2.03 + 7.1, y * 2.03 + 7.1) * 0.3 + vn(x * 4.1 + 3.3, y * 4.1 + 3.3) * 0.2;
const GLSL_NOISE = `
uint hashu(uvec2 p){ uint h = p.x * 1664525u + p.y * 1013904223u; h ^= h >> 16; h *= 2246822519u; h ^= h >> 13; h *= 3266489917u; h ^= h >> 16; return h; }
float h21(vec2 p){ ivec2 i = ivec2(floor(p)) + 32768; return float(hashu(uvec2(i))) / 4294967295.0; }
float vn(vec2 p){ vec2 i = floor(p), f = p - i, u = f * f * (3.0 - 2.0 * f);
  float a = h21(i), b = h21(i + vec2(1, 0)), c = h21(i + vec2(0, 1)), d = h21(i + vec2(1, 1)); return mix(mix(a, b, u.x), mix(c, d, u.x), u.y); }
float fbm2(vec2 p){ return vn(p) * 0.5 + vn(p * 2.03 + 7.1) * 0.3 + vn(p * 4.1 + 3.3) * 0.2; }
`;
const GLSL_PROFILE = `
uniform vec4 uProf; uniform float uEdgeW;      // ring, ringW, ringGain, spill; edge half-width
float profileAt(float r){
  if (!(r < 1.0)) return 0.0;
  float e = max(1e-4, uEdgeW), core = 1.0 - smoothstep(uProf.x - e, uProf.x + e, r);
  float c = uProf.x - 1.2 * e - 0.5 * uProf.y, x = (r - c) / max(0.5 * uProf.y, 1e-4), bump = uProf.y > 0.0 ? (uProf.z - 1.0) * exp(-0.5 * x * x) : 0.0;
  float spill = uProf.w * (1.0 - smoothstep(uProf.x, 1.0, r));
  return core * (1.0 + bump) + (1.0 - core) * spill;
}`;
const GLSL_PACK = `float unpackRGBAToDepthL(vec4 v){ return dot(v, vec4(255.0 / 256.0, 255.0 / 256.0 / 256.0, 255.0 / 256.0 / 65536.0, 1.0 / 16777216.0)); }`;

// ------------------------------------------------------------------ the matte's per-pixel math, JS (the shader LIGHT_FS mirrors it)
// L: { pos, dir, half, P, on, ref, U, V } (U, V: the light's own basis across the axis); vis: shadow visibility 0..1 (shadowVisAt)
export function matteAt(Pw, L, vis, { knee = 0.15, edge = 0.04, ragged = 0, t = 0 } = {}) {
  const lx = Pw.x - L.pos.x, ly = Pw.y - L.pos.y, lz = Pw.z - L.pos.z, dist = Math.max(1e-4, Math.hypot(lx, ly, lz));
  const cs = clamp((lx * L.dir.x + ly * L.dir.y + lz * L.dir.z) / dist, -1, 1), r = Math.acos(cs) / L.half, prof = profileAt(L.P, r);
  const lit = L.on * prof * Math.min(L.cap ?? 1, (L.ref * L.ref) / Math.max(dist * dist, 1e-4)) * vis;
  let kn = knee;
  if (ragged) { const ta = Math.tan(L.half), qx = (lx * L.U.x + ly * L.U.y + lz * L.U.z) / dist / ta, qy = (lx * L.V.x + ly * L.V.y + lz * L.V.z) / dist / ta;
    kn = knee * (1 + ragged * (fbm2(qx * 7 + t * 0.35, qy * 7 - t * 0.27) - 0.5)); }
  const ed = Math.max(edge, 1e-4); return { m: sstep(kn - ed, kn + ed, lit), lit, vis };
}
// the shadow lookup, JS: map = { size, bytes (Uint8Array size*size*4, row 0 at v = 0) }, M = light.shadow.matrix, N toward the light
export function shadowVisAt(Pw, N, map, M, { bias = -0.0004, normalBias = 0.02 } = {}) {
  const p = V3(Pw.x + N.x * normalBias, Pw.y + N.y * normalBias, Pw.z + N.z * normalBias).applyMatrix4(M);   // applyMatrix4 divides by w
  const z = p.z + bias;
  if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || z > 1) return 1;
  let s = 0; const S = map.size;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const u = p.x + i / S, v = p.y + j / S, ti = clamp(Math.floor(u * S), 0, S - 1), tj = clamp(Math.floor(v * S), 0, S - 1), k = (tj * S + ti) * 4;
    s += z <= unpackRGBADepth([map.bytes[k], map.bytes[k + 1], map.bytes[k + 2], map.bytes[k + 3]]) ? 1 : 0;
  }
  return s / 9;
}
// world position from a window depth (the shader's worldAt): uv 0..1 (v up), d = gl depth 0..1
export function worldFromDepth(u, v, d, camera, out = V3()) {
  out.set(u * 2 - 1, v * 2 - 1, d * 2 - 1).applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld); return out;
}
export function depthOf(Pw, camera) { const p = Pw.clone().applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix); return p.z * 0.5 + 0.5; }

// ------------------------------------------------------------------ the beam (spectre.js's, generalised): sigma = sigA + sigK s along the axis
const BEAM_VS = `uniform float uLen, uSigA, uSigK; varying vec3 vW;
void main(){ float s = -position.y * uLen, R = 3.4 * (uSigA + uSigK * s); vec4 w = modelMatrix * vec4(position.x * R, -s, position.z * R, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const BEAM_FS = `uniform float uI, uLen, uIn, uSigA, uSigK, uGround; uniform vec3 uSrc, uDir, uCol; varying vec3 vW;
float erfA(float x){ float t = 1.0 / (1.0 + 0.3275911 * abs(x));
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x); return sign(x) * y; }
void main(){
  if ((uIn > 0.5) == gl_FrontFacing) discard;
  vec3 rd = normalize(vW - cameraPosition), w0 = cameraPosition - uSrc;
  float b = dot(rd, uDir), d = dot(rd, w0), e = dot(uDir, w0), den = max(1e-4, 1.0 - b * b);
  float tr = max(0.0, (b * e - d) / den), s = clamp(dot(cameraPosition + rd * tr - uSrc, uDir), 0.0, uLen);
  float sig = uSigA + uSigK * s, r = length(cameraPosition + rd * tr - (uSrc + uDir * s)), sd = max(sqrt(den), 0.15);
  float tau = 1.35 * max(0.0, exp(-0.5 * r * r / (sig * sig)) - 0.0030887) / (sig * sd);
  if (uGround > -1e8 && rd.y < 0.0) { float tg = (cameraPosition.y - uGround) / -rd.y, fl = 1.0 / max(-rd.y, 0.02), sa = sig / sd;
    tau *= 0.5 + 0.5 * erfA((tg - 0.5 * fl - tr) / (1.41421356 * sqrt(sa * sa + 0.09 * fl * fl))); }
  float a = uI * (1.0 - exp(-tau)) * (0.82 - 0.22 * s / uLen) * (1.0 - smoothstep(uLen * 0.9, uLen, s));
  gl_FragColor = vec4(uCol * a * 0.48, 1.0);
}`;

// a haze shaft on its own (moonlight through a broken pane): the same beam, set by hand. shaft.set(from, dir, len, I, sigA, sigK)
export function hazeShaft(scene, { color = '#dfe6ff', ground = 0 } = {}) {
  const U = { uI: { value: 0 }, uLen: { value: 1 }, uIn: { value: 0 }, uSigA: { value: 0.2 }, uSigK: { value: 0.02 }, uGround: { value: ground }, uSrc: { value: V3() }, uDir: { value: V3(0, -1, 0) }, uCol: { value: new THREE.Color(color) } };
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 32, 16, false).translate(0, -0.5, 0),
    new THREE.ShaderMaterial({ vertexShader: BEAM_VS, fragmentShader: BEAM_FS, uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  mesh.frustumCulled = false; mesh.renderOrder = 4; if (scene) scene.add(mesh);
  return { mesh, U, set(from, dir, len, I, sigA = U.uSigA.value, sigK = U.uSigK.value, camera = null) {
    const f = v3(from), d = v3(dir).normalize(); U.uSrc.value.copy(f); U.uDir.value.copy(d); U.uLen.value = len; U.uI.value = I; U.uSigA.value = sigA; U.uSigK.value = sigK;
    mesh.position.copy(f); mesh.quaternion.setFromUnitVectors(V3(0, -1, 0), d); mesh.visible = I > 1e-4;
    if (camera) { const c = camera.position, s0 = clamp(c.clone().sub(f).dot(d), 0, len), rr = c.clone().sub(f.clone().addScaledVector(d, s0)).length(); U.uIn.value = rr < 3.4 * (sigA + sigK * s0) * 0.98 ? 1 : 0; }
    return this; } };
}

// ------------------------------------------------------------------ Lantern
export class Lantern {
  constructor(scene, o = {}) {
    const P = this.P = shapeOf(o);
    this.half = P.half; this.lumens = P.lumens; this.ref = o.ref ?? 3; this.cap = o.cap ?? 1; this.knee = o.knee ?? 0.15; this.gain = o.gain ?? 1; this.haze = o.haze ?? 0.6;
    this.I0 = candela(this.lumens, P, this.half); this.peak = profilePeak(P); this.k = 1; this.occluders = []; this.stops = null; this.path = null;
    this.pos = V3(0, 1.5, 0); this.dir = V3(0, 0, -1); this._aim0 = null;
    const L = this.light = new THREE.SpotLight(o.color || P.color, 0, 0, Math.min(this.half, 1.5), 0.02, 2);
    L.castShadow = o.shadow !== 0; const sz = o.shadow || 1024; L.shadow.mapSize.set(sz, sz);
    L.shadow.bias = o.bias ?? -0.0004; L.shadow.normalBias = o.normalBias ?? 0.02; L.shadow.camera.near = o.near ?? 0.08; L.shadow.camera.far = o.far ?? 60;
    L.map = o.cookie ? Object.assign(new THREE.CanvasTexture(o.cookie), { colorSpace: THREE.SRGBColorSpace }) : cookieTexture(P, this.half);
    this.cookiePeak = o.cookie ? 1 : L.map.userData.peak;
    if (scene) scene.add(L, L.target);
    // the body: 24 cm, anodised black, the head a little wider, the lens lit when it is on
    const B = this.body = new THREE.Group(), dark = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.42, metalness: 0.7 });
    this.lensMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0165, 0.0165, 0.19, 18), dark); barrel.position.y = -0.035;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.018, 0.05, 20), dark); head.position.y = 0.085;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.021, 20).rotateX(-Math.PI / 2), this.lensMat); lens.position.y = 0.1105;
    B.add(barrel, head, lens); for (const m of [barrel, head]) { m.castShadow = false; m.receiveShadow = true; }
    if (scene && o.body !== false) scene.add(B);
    this._lensOff = 0.11;                                                    // grip point (the barrel's middle, 8 cm from the tail) to the lens
    // the beam
    this.beamU = { uI: { value: 0 }, uLen: { value: 1 }, uIn: { value: 0 }, uSigA: { value: 0.012 }, uSigK: { value: Math.tan(this.half) * 0.42 }, uGround: { value: o.ground ?? 0 },
      uSrc: { value: V3() }, uDir: { value: V3(0, -1, 0) }, uCol: { value: new THREE.Color(o.beamColor || '#eaf0ff') } };
    const beam = this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48, 24, false).translate(0, -0.5, 0),
      new THREE.ShaderMaterial({ vertexShader: BEAM_VS, fragmentShader: BEAM_FS, uniforms: this.beamU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.frustumCulled = false; beam.renderOrder = 5;
    if (scene && o.beam !== false) scene.add(beam);
    this._ray = new THREE.Raycaster(); this.range = o.range ?? 30;
  }
  place(p) { this.pos.copy(v3(p)); return this; }
  aim(target) { this.dir.copy(v3(target)).sub(this.pos).normalize(); this._aim0 = null; return this; }
  aimDir(d) { this.dir.copy(v3(d)).normalize(); this._aim0 = null; return this; }
  on(k) { this.k = clamp(k, 0, 1); return this; }
  // turn the current aim by the hand's drift (yaw about world up, pitch about the aim's own right); returns the angles
  drift(t, o = {}) {
    const a = driftAt(t, o), up = V3(0, 1, 0), right = V3().crossVectors(this.dir, up);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0); right.normalize();
    this.dir.applyAxisAngle(up, a.yaw).applyAxisAngle(right, a.pitch).normalize(); return a;
  }
  // a hero's grip: the barrel through the palm, along the aim
  hold(hero, side = 'R', { aimAt = null, r = 0.0165 } = {}) {
    hero.update(); const h = hero.handle(side, r);
    const d = aimAt ? v3(aimAt).sub(h.p).normalize() : h.d.clone().normalize();
    hero.grip(side, { p: h.p, d, r }); hero.update();
    this.body.position.copy(h.p); this.body.quaternion.setFromUnitVectors(V3(0, 1, 0), d);
    this.pos.copy(h.p).addScaledVector(d, this._lensOff + 0.002); this.dir.copy(d); this._held = true;
    return this;
  }
  // world basis across the axis (for the ragged edge and the CPU mirror)
  basis() { const U = V3().crossVectors(this.dir, Math.abs(this.dir.y) < 0.95 ? V3(0, 1, 0) : V3(1, 0, 0)).normalize(), Vv = V3().crossVectors(U, this.dir).normalize(); return { U, V: Vv }; }
  state() { const { U, V } = this.basis(); return { pos: this.pos.clone(), dir: this.dir.clone(), half: this.half, P: this.P, on: this.k, ref: this.ref, cap: this.cap, U, V }; }
  illum(p, { test = true } = {}) {
    const q = v3(p), d = q.clone().sub(this.pos), dist = d.length(); if (dist < 1e-4 || this.k <= 0) return 0;
    d.divideScalar(dist); const r = Math.acos(clamp(d.dot(this.dir), -1, 1)) / this.half, prof = profileAt(this.P, r); if (prof <= 0) return 0;
    let vis = 1;
    if (test && this.occluders.length) { this._ray.set(this.pos, d); this._ray.near = 0; this._ray.far = dist - 0.02; if (this._ray.intersectObjects(this.occluders, true).length) vis = 0; }
    return this.k * prof * Math.min(this.cap, (this.ref * this.ref) / (dist * dist)) * vis;
  }
  lit(p, o) { return clamp(this.illum(p, o)); }
  // first time each point is lit >= knee as this.path(t) (-> { pos, target | dir, on }) moves the light; Infinity if never
  sweepTimes(points, t0, t1, fps = 30, { path = this.path, knee = this.knee } = {}) {
    const save = { pos: this.pos.clone(), dir: this.dir.clone(), k: this.k }, out = points.map(() => Infinity);
    const n = Math.max(1, Math.round((t1 - t0) * fps));
    for (let i = 0; i <= n; i++) { const t = t0 + (t1 - t0) * i / n; if (path) this._apply(path(t));
      for (let j = 0; j < points.length; j++) if (out[j] === Infinity && this.illum(points[j]) >= knee) out[j] = t; }
    this.pos.copy(save.pos); this.dir.copy(save.dir); this.k = save.k; return out;
  }
  _apply(s) { if (!s) return; if (s.pos) this.place(s.pos); if (s.target) this.aim(s.target); else if (s.dir) this.aimDir(s.dir); if (s.on != null) this.on(s.on); }
  // the light, the body and the beam, from pos / dir / k (once a frame, before rendering)
  update(camera = null) {
    const L = this.light; L.position.copy(this.pos); L.target.position.copy(this.pos).addScaledVector(this.dir, 4); L.target.updateMatrixWorld(); L.updateMatrixWorld();
    L.intensity = this.I0 * this.cookiePeak * this.k * this.gain; L.visible = this.k > 0;
    if (!this._held) { this.body.position.copy(this.pos).addScaledVector(this.dir, -this._lensOff); this.body.quaternion.setFromUnitVectors(V3(0, 1, 0), this.dir); }
    this._held = false;
    this.lensMat.color.setScalar(clamp(this.k * 3));
    // the beam stops at the first surface on its axis
    let len = this.range;
    if (this.stops && this.stops.length) { this._ray.set(this.pos, this.dir); this._ray.near = 0.05; this._ray.far = this.range; const h = this._ray.intersectObjects(this.stops, true)[0]; if (h) len = h.distance; }
    const U = this.beamU; U.uLen.value = len; U.uSrc.value.copy(this.pos); U.uDir.value.copy(this.dir); U.uI.value = this.haze * this.k;
    this.beam.position.copy(this.pos); this.beam.quaternion.setFromUnitVectors(V3(0, -1, 0), this.dir); this.beam.visible = this.k > 0.001 && this.haze > 0;
    if (camera) { const c = camera.position, s0 = clamp(c.clone().sub(this.pos).dot(this.dir), 0, len), rr = c.clone().sub(this.pos.clone().addScaledVector(this.dir, s0)).length();
      U.uIn.value = rr < 3.4 * (U.uSigA.value + U.uSigK.value * s0) * 0.98 ? 1 : 0; }
    return this;
  }
  asPractical() {
    const P = this.P, a = this.pos.clone().addScaledVector(this.dir, 4);
    return { kind: 'torch', pos: this.pos.toArray(), aim: a.toArray(), cd: this.I0 * this.peak, lumens: this.lumens, color: P.lamp, half: this.half, pen: P.edgeW * 10,
      size: 0.035, shadow: true, volume: true, flicker: 'none', head: 'none', on: this.k, gain: this.gain };
  }
}

// ------------------------------------------------------------------ LightMatte: the passes
const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const LIGHT_FS = `precision highp float; precision highp int;
uniform sampler2D tDepth, tShadow; uniform mat4 uInvProj, uCamWorld, uShadowM;
uniform vec3 uLPos, uLDir, uU, uV; uniform float uHalf, uOn, uRef, uCap, uSBias, uSNBias, uUseShadow, uKnee, uEdge, uRagged, uTime; uniform vec2 uSSize;
varying vec2 vUv;
${GLSL_NOISE}${GLSL_PROFILE}${GLSL_PACK}
vec3 worldAt(vec2 uv){ float d = texture2D(tDepth, uv).x; vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); v /= v.w; return (uCamWorld * v).xyz; }
float shadowVis(vec3 P, vec3 N){
  vec4 sc = uShadowM * vec4(P + N * uSNBias, 1.0); sc.xyz /= sc.w; float z = sc.z + uSBias;
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || z > 1.0) return 1.0;
  float s = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 uv = sc.xy + vec2(float(i), float(j)) / uSSize, ti = clamp(floor(uv * uSSize), vec2(0.0), uSSize - 1.0);
    s += step(z, unpackRGBAToDepthL(texture2D(tShadow, (ti + 0.5) / uSSize))); }
  return s / 9.0;
}
void main(){
  float d = texture2D(tDepth, vUv).x;
  if (d >= 0.999999) { gl_FragColor = vec4(0.0); return; }
  vec3 P = worldAt(vUv), Lv = P - uLPos; float dist = max(length(Lv), 1e-4); vec3 ld = Lv / dist;
  vec3 N = cross(dFdx(P), dFdy(P)); N = length(N) > 1e-12 ? normalize(N) : -ld; N *= sign(dot(N, -ld) + 1e-6);
  float r = acos(clamp(dot(ld, uLDir), -1.0, 1.0)) / uHalf, prof = profileAt(r);
  float vis = (uUseShadow > 0.5 && prof > 0.0) ? shadowVis(P, N) : 1.0;
  float lit = uOn * prof * min(uCap, (uRef * uRef) / max(dist * dist, 1e-4)) * vis, kn = uKnee;
  if (uRagged > 0.0) { float ta = tan(uHalf); vec2 q = vec2(dot(Lv, uU), dot(Lv, uV)) / dist / ta;
    kn = uKnee * (1.0 + uRagged * (fbm2(vec2(q.x * 7.0 + uTime * 0.35, q.y * 7.0 - uTime * 0.27)) - 0.5)); }
  float ed = max(uEdge, 1e-4); gl_FragColor = vec4(smoothstep(kn - ed, kn + ed, lit), lit, vis, 1.0);
}`;
const SELF_FS = `uniform sampler2D tSrc; uniform float uKey, uSoft; varying vec2 vUv;
void main(){ vec4 c = texture2D(tSrc, vUv); float l = pow(max(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0), 1.0 / 2.2) * step(0.5, c.a);
  float sf = max(uSoft, 1e-4), m = smoothstep(uKey - sf, uKey + sf, l); gl_FragColor = vec4(m, m, 1.0, 1.0); }`;
const PERSIST_FS = `uniform sampler2D tPrev, tMask; uniform float uDecay; varying vec2 vUv;
void main(){ vec4 p = texture2D(tPrev, vUv) * (1.0 - uDecay), m = texture2D(tMask, vUv); gl_FragColor = vec4(max(p.r, m.r), max(p.g, m.g), m.b, 1.0); }`;
const MAX_FS = `uniform sampler2D tA, tB; varying vec2 vUv; void main(){ vec4 a = texture2D(tA, vUv), b = texture2D(tB, vUv); gl_FragColor = vec4(max(a.r, b.r), max(a.g, b.g), max(a.b, b.b), 1.0); }`;
const REVEAL_FS = `uniform sampler2D tBase, tBaseD, tOver, tOverD, tMask; uniform float uHasOver, uGain, uEdge, uExposure, uLightK, uTone, uPersistA, uSelfK, uKey, uSoft; uniform vec3 uTint, uEdgeCol; varying vec2 vUv;
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c){ const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= uExposure / 0.6; c = I * c; c = RRTAndODTFit(c); c = O * c; return clamp(c, 0.0, 1.0); }
vec3 srgb(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
void main(){
  vec3 base = texture2D(tBase, vUv).rgb, outc = uTone > 0.5 ? srgb(aces(base)) : srgb(base * uExposure);
  if (uHasOver > 0.5) {
    vec4 mk = texture2D(tMask, vUv), ov = texture2D(tOver, vUv);
    float show = step(0.49, ov.a) * step(texture2D(tOverD, vUv).x, texture2D(tBaseD, vUv).x + 2e-6);
    float m = max(clamp(mk.r, 0.0, 1.0), uPersistA * clamp((ov.a - 0.5) * 2.0, 0.0, 1.0)) * show;
    float sl = pow(max(dot(ov.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0), 1.0 / 2.2), sk = smoothstep(uKey - max(uSoft, 1e-4), uKey + max(uSoft, 1e-4), sl);
    vec3 o = srgb(ov.rgb * uTint * uGain * mix(1.0, mk.g, uLightK) * mix(1.0, sk, uSelfK));
    outc = mix(outc, o, m) + uEdgeCol * (uEdge * 4.0 * m * (1.0 - m));
  }
  gl_FragColor = vec4(outc, 1.0);
}`;
const COPY_FS = `uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }`;
const COVER_FS = `uniform sampler2D tMask; uniform vec4 uRect; uniform vec2 uOut; varying vec2 vUv;
void main(){ vec2 cell = floor(vUv * uOut); float s = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) { vec2 f = (cell + (vec2(float(i), float(j)) + 0.5) / 4.0) / uOut;
    s += clamp(texture2D(tMask, vec2(mix(uRect.x, uRect.z, f.x), mix(uRect.y, uRect.w, f.y))).r, 0.0, 1.0); }
  gl_FragColor = vec4(vec3(s / 16.0), 1.0); }`;

export class LightMatte {
  constructor(renderer, { w = 540, h = 960 } = {}) {
    this.r = renderer; this.w = w; this.h = h;
    const mk = () => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.rtLight = mk(); this.rtSelf = mk(); this.rtMax = mk(); this.rtP = [mk(), mk()]; this.pi = 0;
    this.rtLayer = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
    this.rtCover = new THREE.WebGLRenderTarget(16, 16, { depthBuffer: false });
    this.rtOut = null;
    this.qScene = new THREE.Scene(); this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); this.quad.frustumCulled = false; this.qScene.add(this.quad);
    const sm = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
    this.mLight = sm(LIGHT_FS, { tDepth: { value: null }, tShadow: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uShadowM: { value: new THREE.Matrix4() },
      uLPos: { value: V3() }, uLDir: { value: V3() }, uU: { value: V3() }, uV: { value: V3() }, uHalf: { value: 0.2 }, uOn: { value: 1 }, uRef: { value: 3 }, uCap: { value: 1 }, uSBias: { value: 0 }, uSNBias: { value: 0 },
      uUseShadow: { value: 0 }, uKnee: { value: 0.15 }, uEdge: { value: 0.04 }, uRagged: { value: 0 }, uTime: { value: 0 }, uSSize: { value: new THREE.Vector2(1024, 1024) },
      uProf: { value: new THREE.Vector4() }, uEdgeW: { value: 0.025 } });
    this.mSelf = sm(SELF_FS, { tSrc: { value: null }, uKey: { value: 0.55 }, uSoft: { value: 0.2 } });
    this.mPersist = sm(PERSIST_FS, { tPrev: { value: null }, tMask: { value: null }, uDecay: { value: 0 } });
    this.mMax = sm(MAX_FS, { tA: { value: null }, tB: { value: null } });
    this.mReveal = sm(REVEAL_FS, { tBase: { value: null }, tBaseD: { value: null }, tOver: { value: null }, tOverD: { value: null }, tMask: { value: null }, uHasOver: { value: 0 }, uGain: { value: 1 },
      uEdge: { value: 0 }, uExposure: { value: 1 }, uLightK: { value: 1 }, uTone: { value: 1 }, uPersistA: { value: 0 }, uSelfK: { value: 0 }, uKey: { value: 0.55 }, uSoft: { value: 0.2 },
      uTint: { value: new THREE.Color(1, 1, 1) }, uEdgeCol: { value: new THREE.Color(1, 1, 1) } });
    this.mCopy = sm(COPY_FS, { tSrc: { value: null } });
    this.mCover = sm(COVER_FS, { tMask: { value: null }, uRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uOut: { value: new THREE.Vector2(16, 16) } });
    this.mBlack = new THREE.MeshBasicMaterial({ color: 0x000000 }); this.mWhite = new THREE.MeshBasicMaterial({ color: 0xffffff, depthFunc: THREE.LessEqualDepth });
    this._cover = new Uint8Array(16 * 16 * 4);
  }
  _pass(mat, target) { const r = this.r, prev = r.getRenderTarget(), ac = r.autoClear; this.quad.material = mat; r.autoClear = true; r.setRenderTarget(target); r.render(this.qScene, this.qCam); r.setRenderTarget(prev); r.autoClear = ac; return target ? target.texture : null; }
  light(depthTex, camera, torch, { knee = torch.knee ?? 0.15, edge = 0.04, ragged = 0.3, t = 0 } = {}) {
    const U = this.mLight.uniforms, L = torch.light, P = torch.P, { U: bu, V: bv } = torch.basis();
    camera.updateMatrixWorld();
    U.tDepth.value = depthTex; U.uInvProj.value.copy(camera.projectionMatrixInverse); U.uCamWorld.value.copy(camera.matrixWorld);
    U.uLPos.value.copy(torch.pos); U.uLDir.value.copy(torch.dir); U.uU.value.copy(bu); U.uV.value.copy(bv);
    U.uHalf.value = torch.half; U.uOn.value = torch.k; U.uRef.value = torch.ref; U.uCap.value = torch.cap; U.uProf.value.set(P.ring, P.ringW, P.ringGain, P.spill); U.uEdgeW.value = P.edgeW;
    const map = L.castShadow && L.shadow && L.shadow.map ? L.shadow.map.texture : null;
    U.uUseShadow.value = map ? 1 : 0; U.tShadow.value = map; U.uShadowM.value.copy(L.shadow.matrix); U.uSBias.value = L.shadow.bias; U.uSNBias.value = L.shadow.normalBias;
    U.uSSize.value.set(L.shadow.mapSize.x, L.shadow.mapSize.y);
    U.uKnee.value = knee; U.uEdge.value = edge; U.uRagged.value = ragged; U.uTime.value = t;
    return this._pass(this.mLight, this.rtLight);
  }
  layer(scene, camera, layer) {
    const r = this.r, prev = r.getRenderTarget(), ac = r.autoClear, om = scene.overrideMaterial, mask = camera.layers.mask, bg = scene.background, sh = r.shadowMap.autoUpdate;
    const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
    r.shadowMap.autoUpdate = false; scene.background = null; r.setRenderTarget(this.rtLayer); r.autoClear = false; r.setClearColor(0x000000, 1); r.clear();
    camera.layers.enableAll(); scene.overrideMaterial = this.mBlack; r.render(scene, camera);
    camera.layers.set(layer); scene.overrideMaterial = this.mWhite; r.render(scene, camera);
    camera.layers.mask = mask; scene.overrideMaterial = om; scene.background = bg; r.shadowMap.autoUpdate = sh; r.autoClear = ac; r.setClearColor(cc, ca); r.setRenderTarget(prev);
    return this.rtLayer.texture;
  }
  self(src, { key = 0.55, soft = 0.2 } = {}) { const U = this.mSelf.uniforms; U.tSrc.value = src.isTexture ? src : src.texture; U.uKey.value = key; U.uSoft.value = soft; return this._pass(this.mSelf, this.rtSelf); }
  persist(mask, { decay = 0 } = {}) { const U = this.mPersist.uniforms, a = this.rtP[this.pi], b = this.rtP[1 - this.pi]; U.tPrev.value = a.texture; U.tMask.value = mask; U.uDecay.value = decay; this._pass(this.mPersist, b); this.pi = 1 - this.pi; return b.texture; }
  reset() { const r = this.r, prev = r.getRenderTarget(), cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha(); r.setClearColor(0x000000, 1); for (const t of this.rtP) { r.setRenderTarget(t); r.clear(); } r.setClearColor(cc, ca); r.setRenderTarget(prev); return this; }
  max(a, b) { const U = this.mMax.uniforms; U.tA.value = a; U.tB.value = b; return this._pass(this.mMax, this.rtMax); }
  reveal(base, over, mask, { tint = [1, 1, 1], gain = 1, edge = 0, edgeColor = [1, 0.97, 0.9], exposure = 1, lightK = 1, tone = true, persistA = 0, selfK = 0, key = 0.55, soft = 0.2, target } = {}) {
    const U = this.mReveal.uniforms, W = base.width, H = base.height;
    if (target === undefined) { if (!this.rtOut || this.rtOut.width !== W || this.rtOut.height !== H) this.rtOut = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false }); target = this.rtOut; }
    U.tBase.value = base.texture; U.tBaseD.value = base.depthTexture; U.uExposure.value = exposure; U.uTone.value = tone ? 1 : 0;
    U.uHasOver.value = over && mask ? 1 : 0; U.tOver.value = over ? over.texture : null; U.tOverD.value = over ? over.depthTexture : null; U.tMask.value = mask;
    U.uGain.value = gain; U.uEdge.value = edge; U.uLightK.value = lightK; U.uPersistA.value = persistA; U.uSelfK.value = selfK; U.uKey.value = key; U.uSoft.value = soft; U.uTint.value.setRGB(...tint); U.uEdgeCol.value.setRGB(...edgeColor);
    return this._pass(this.mReveal, target);
  }
  display(tex) { this.mCopy.uniforms.tSrc.value = tex; return this._pass(this.mCopy, null); }
  // rect: [x0, y0, x1, y1] in uv (0..1, v up)
  coverage(mask, rect = [0, 0, 1, 1]) {
    const U = this.mCover.uniforms; U.tMask.value = mask; U.uRect.value.set(...rect); this._pass(this.mCover, this.rtCover);
    this.r.readRenderTargetPixels(this.rtCover, 0, 0, 16, 16, this._cover); let s = 0; for (let i = 0; i < 256; i++) s += this._cover[i * 4]; return s / (256 * 255);
  }
}
// the coverage reduction, JS (a mask as a function of uv): the same 16x16 cells of 4x4 taps
export function coverageOf(maskAt, rect = [0, 0, 1, 1]) {
  let s = 0;
  for (let cy = 0; cy < 16; cy++) for (let cx = 0; cx < 16; cx++) { let c = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const fx = (cx + (i + 0.5) / 4) / 16, fy = (cy + (j + 0.5) / 4) / 16; c += clamp(maskAt(rect[0] + (rect[2] - rect[0]) * fx, rect[1] + (rect[3] - rect[1]) * fy)); }
    s += Math.round(c / 16 * 255); }
  return s / (256 * 255);
}
// the shader sources, for compile checks (web/labs/lantern/glsl_check.mjs)
export const LANTERN_GLSL = { vertex: { BEAM_VS, QUAD_VS }, fragment: { BEAM_FS, LIGHT_FS, SELF_FS, PERSIST_FS, MAX_FS, REVEAL_FS, COPY_FS, COVER_FS } };
