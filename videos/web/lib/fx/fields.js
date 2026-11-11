// FIELDS: procedural material fields for the slate, as GLSL passes (glfx Passes) plus a deterministic reaction-diffusion
// bake. Everything is a pure function of t: the RD pattern is baked once (CPU, Gray-Scott) into an "arrival age" map,
// and animation is thresholding that age (growth, decay, reversal) or advecting it through a domain-warped flow.
//
//   import { Fields, bakeRD, RD_PRESETS } from '../lib/fx/fields.js';
//   const rd = bakeRD({ size: 384, steps: 5000, ...RD_PRESETS.coral, seed: (x, y) => scratchMask(x, y) });   // ~2-6 s once
//   const F = new Fields(renderer);                        // or new Fields(passes)
//   F.molten(t, { rd, flow: 0.12, heat: 1.0 }, rt);        // HDR out: blackbody iron pour, crust from RD, glowing cracks
//   F.rust(t, { rd, grow: u, light: [..] }, rt);           // HDR out: brushed steel under rust that grows (u 0..1) / recedes
//   F.finish(rt, { exposure, glow, ... })                  // glfx finish to canvas
//   Fields.GLSL                                            // the noise / warp / blackbody snippets for your own shaders
//
// Techniques: Gray-Scott reaction-diffusion (Pearson 1993; Sims' parameter map) with the arrival time of the front
// recorded per texel (the "age" idiom: one bake, any number of growth animations); Quilez domain warping
// f(p + 4q(p + 4r(p))) for flow and marbling; a Planckian-locus colour (Tanner Helland's fit) with a steep radiance ramp for
// incandescent metal; brushed steel by line-integral-convolved noise along one axis; height-to-normal relighting.
import * as THREE from 'three';
import { Passes, NOISE, TONE } from './glfx.js';

export const RD_PRESETS = {
  coral: { F: 0.0545, k: 0.062 }, spots: { F: 0.035, k: 0.065 }, worms: { F: 0.03, k: 0.057 }, maze: { F: 0.029, k: 0.057 },
  cells: { F: 0.026, k: 0.051 }, holes: { F: 0.039, k: 0.058 },
};
// Gray-Scott on a size^2 torus. seed(x, y) in 0..1 coordinates returns 0..1 (where v starts). Returns
// { size, age: Float32Array (0..1 = arrival step / steps; 1 = never), v: final v, texture: RG float DataTexture }.
export function bakeRD({ size = 384, steps = 5000, F = 0.0545, k = 0.062, Du = 1.0, Dv = 0.5, dt = 1.0, seed = null, feed = null, thr = 0.22, rngSeed = 7, blob = 3, equalize = true } = {}) {
  const N = size, NN = N * N;
  let u = new Float32Array(NN).fill(1), v = new Float32Array(NN), u2 = new Float32Array(NN), v2 = new Float32Array(NN);
  const age = new Float32Array(NN).fill(1), Fm = feed ? new Float32Array(NN) : null;
  let s = rngSeed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // seeds are stamped as small discs (radius `blob` texels): a single texel of v dies before it can react
  const R = Math.max(1, Math.round(blob));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const sd = seed ? seed((x + 0.5) / N, (y + 0.5) / N) : (Math.hypot(x - N / 2, y - N / 2) < 1 ? 1 : 0);
    if (sd > 0 && rnd() < sd) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R) continue; const j = ((y + dy + N) % N) * N + ((x + dx + N) % N);
      u[j] = 0.5 + rnd() * 0.02; v[j] = 0.25 + rnd() * 0.02; age[j] = 0; }
    if (Fm) Fm[y * N + x] = feed((x + 0.5) / N, (y + 0.5) / N);
  }
  for (let it = 1; it <= steps; it++) {
    for (let y = 0; y < N; y++) {
      const ym = ((y - 1 + N) % N) * N, y0 = y * N, yp = ((y + 1) % N) * N;
      for (let x = 0; x < N; x++) {
        const xm = (x - 1 + N) % N, xp = (x + 1) % N, i = y0 + x;
        const lu = 0.2 * (u[y0 + xm] + u[y0 + xp] + u[ym + x] + u[yp + x]) + 0.05 * (u[ym + xm] + u[ym + xp] + u[yp + xm] + u[yp + xp]) - u[i];
        const lv = 0.2 * (v[y0 + xm] + v[y0 + xp] + v[ym + x] + v[yp + x]) + 0.05 * (v[ym + xm] + v[ym + xp] + v[yp + xm] + v[yp + xp]) - v[i];
        const uu = u[i], vv = v[i], r = uu * vv * vv, f = Fm ? F * Fm[i] : F;
        u2[i] = uu + dt * (Du * lu - r + f * (1 - uu)); v2[i] = vv + dt * (Dv * lv + r - (f + k) * vv);
        if (age[i] === 1 && v2[i] > thr) age[i] = it / steps;
      }
    }
    let tt = u; u = u2; u2 = tt; tt = v; v = v2; v2 = tt;
  }
  if (equalize) {       // histogram-equalise arrival times so growth is even over 0..1 (fronts slow down as they spread)
    const idx = []; for (let i = 0; i < NN; i++) if (age[i] < 1) idx.push(i);
    idx.sort((a, b) => age[a] - age[b]); const n = idx.length;
    for (let r = 0; r < n; r++) age[idx[r]] = (r + 0.5) / n * 0.98;
  }
  const data = new Float32Array(NN * 4);
  for (let i = 0; i < NN; i++) { data[i * 4] = age[i]; data[i * 4 + 1] = v[i]; data[i * 4 + 2] = u[i]; data[i * 4 + 3] = 1; }
  const texture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.FloatType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return { size: N, age, v, texture };
}

// First-passage growth (Eden / Dijkstra on random costs): arrival time from the seed set through a grid whose cell
// costs are heavy-tailed random, modulated by speed(x, y). The fronts are rough and fractal, like corrosion, burns,
// frost or mould spreading from scratches. Same output as bakeRD (R = equalised age, G = cell grain, B = 1 - grain).
export function bakeGrowth({ size = 512, seed = null, speed = null, rough = 1.0, rngSeed = 5, equalize = true } = {}) {
  const N = size, NN = N * N, age = new Float32Array(NN).fill(Infinity), cost = new Float32Array(NN);
  let s = rngSeed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < NN; i++) { const x = (i % N + 0.5) / N, y = (Math.floor(i / N) + 0.5) / N, r = rnd();
    cost[i] = (0.35 + rough * (-Math.log(1 - r * 0.999)) ) / Math.max(0.02, speed ? speed(x, y) : 1); }
  // binary heap of [time, index]
  const hk = new Float64Array(NN * 4), hi = new Int32Array(NN * 4); let hn = 0;
  const push = (k, i) => { let c = hn++; hk[c] = k; hi[c] = i; while (c > 0) { const p = (c - 1) >> 1; if (hk[p] <= hk[c]) break; [hk[p], hk[c]] = [hk[c], hk[p]]; [hi[p], hi[c]] = [hi[c], hi[p]]; c = p; } };
  const pop = () => { const k = hk[0], i = hi[0]; hn--; hk[0] = hk[hn]; hi[0] = hi[hn]; let c = 0;
    for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < hn && hk[l] < hk[m]) m = l; if (r < hn && hk[r] < hk[m]) m = r; if (m === c) break;
      [hk[m], hk[c]] = [hk[c], hk[m]]; [hi[m], hi[c]] = [hi[c], hi[m]]; c = m; } return [k, i]; };
  for (let i = 0; i < NN; i++) { const x = (i % N + 0.5) / N, y = (Math.floor(i / N) + 0.5) / N; if (seed && seed(x, y) > 0 && rnd() < seed(x, y)) { age[i] = 0; push(0, i); } }
  if (!hn) { const c = (N >> 1) * N + (N >> 1); age[c] = 0; push(0, c); }
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]];
  while (hn > 0 && hn < NN * 4 - 8) {
    const [k, i] = pop(); if (k > age[i]) continue; const x = i % N, y = (i / N) | 0;
    for (const [dx, dy, w] of D) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= N || Y >= N) continue; const j = Y * N + X, t = k + w * 0.5 * (cost[i] + cost[j]);
      if (t < age[j]) { age[j] = t; push(t, j); } }
  }
  let mx = 0; for (let i = 0; i < NN; i++) if (isFinite(age[i])) mx = Math.max(mx, age[i]);
  if (equalize) { const idx = Array.from({ length: NN }, (_, i) => i).filter(i => isFinite(age[i])).sort((a, b) => age[a] - age[b]);
    for (let r = 0; r < idx.length; r++) age[idx[r]] = (r + 0.5) / idx.length * 0.98; }
  else for (let i = 0; i < NN; i++) age[i] = isFinite(age[i]) ? age[i] / mx * 0.98 : 1;
  for (let i = 0; i < NN; i++) if (!isFinite(age[i])) age[i] = 1;
  const data = new Float32Array(NN * 4);
  for (let i = 0; i < NN; i++) { const g = 1 - Math.exp(-cost[i] * 0.6); data[i * 4] = age[i]; data[i * 4 + 1] = g; data[i * 4 + 2] = 1 - g; data[i * 4 + 3] = 1; }
  const texture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.FloatType);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return { size: N, age, texture };
}

const BLACKBODY = /* glsl */`
// incandescence: T in kelvin -> linear RGB radiance. Chromaticity: Tanner Helland's fit of the Planckian locus
// (sRGB, linearised); intensity: a steep art-scaled ramp (visible from ~750 K, blinding by 1900 K).
vec3 blackbody(float T){
  float x = max(T, 500.0) / 100.0;
  float r = 1.0, g = clamp((99.4708025861 * log(x) - 161.1195681661) / 255.0, 0.0, 1.0);
  float b = x <= 19.0 ? 0.0 : clamp((138.5177312231 * log(x - 10.0) - 305.0447927307) / 255.0, 0.0, 1.0);
  vec3 c = pow(vec3(r, g, b), vec3(2.2));
  float t = T / 1000.0, I = pow(max(t - 0.72, 0.0), 2.6) * 7.0;
  return c * I;
}`;

const F_MOLTEN = /* glsl */`
uniform sampler2D tRD; uniform float uT, uFlow, uHeat, uCrust, uScale, uAsp, uBank, uWidth; uniform vec2 uRes;
${NOISE} ${TONE} ${BLACKBODY}
// worley F1/F2 on a jittered grid (crust plates and the cracks between them)
vec3 worley(vec2 p){ vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 g = vec2(x, y), o = h22(i + g); vec2 r = g + o - f; float d = dot(r, r);
    if (d < d1){ d2 = d1; d1 = d; id = h21(i + g + 0.37); } else if (d < d2) d2 = d; }
  return vec3(sqrt(d1), sqrt(d2), id); }
void main(){
  vec2 p = vec2((vUv.x - 0.5) * uAsp, vUv.y) * uScale;
  // the channel: a trough meandering down the frame; outside it, cold sand and black slag
  float cx = 0.14 * sin(vUv.y * 3.1 + 0.6) + 0.05 * sin(vUv.y * 7.3);
  float dx = (vUv.x - 0.5 - cx) * uAsp, halfw = uWidth * (1.0 + 0.14 * sin(vUv.y * 5.0 + 1.0));
  float inCh = smoothstep(halfw, halfw - 0.012, abs(dx)), across = clamp(abs(dx) / halfw, 0.0, 1.0);
  // flow down the channel, fastest in the middle (Poiseuille), warped
  float vel = uFlow * (1.0 - across * across * 0.8);
  vec2 q, r; vec2 fp = p + vec2(0.0, uT * vel * uScale);
  float w = warp(fp * 0.9, 3.2, uT * 0.6, q, r);
  // temperature (K): a hot core, cooling toward the banks
  float T = mix(1300.0, 1780.0, w) * uHeat - 520.0 * smoothstep(0.2, 1.0, across);
  // crust: warped, sheared worley plates carried by the flow. Coverage grows where the melt is cooler; the cracks
  // between plates stay open and hot; the RD bake adds the wrinkled skin on each plate.
  vec2 cp = (fp + (r - 0.5) * 0.9) * vec2(3.0, 2.2) + vec2(across * 1.3 * sign(dx), 0.0);
  vec3 wy = worley(cp); float crack = wy.y - wy.x;
  float cool = smoothstep(1500.0, 1150.0, T);
  float cover = smoothstep(0.0, 0.5, cool * uCrust + 0.35 * (wy.z - 0.5));
  float plate = smoothstep(0.03, 0.09, crack) * cover;
  vec4 rd = texture(tRD, cp * 0.35);
  float skin = smoothstep(0.1, 0.35, rd.g);
  T -= 560.0 * plate; T += 120.0 * (1.0 - smoothstep(0.0, 0.05, crack)) * cover;       // the seams glow
  T += 70.0 * (fbm(fp * 7.0 + uT * 0.9, 3) - 0.5);
  vec3 hot = blackbody(T);
  vec3 crustC = vec3(0.05, 0.04, 0.036) * (0.55 + 0.9 * fbm(cp * 5.0, 4)) * (0.7 + 0.5 * skin) + blackbody(T + 260.0 * (1.0 - skin)) * 0.25;
  vec3 melt = mix(hot, crustC, plate * 0.92);
  // banks: packed black sand and slag lit by the melt's glow, which dies within a hand's width
  float gl = exp(-max(abs(dx) - halfw, 0.0) * 26.0);
  float sand = fbm(p * 7.0, 5), grit = h21(floor(gl_FragCoord.xy * 0.7));
  vec3 bank = mix(vec3(0.018, 0.014, 0.012), vec3(0.06, 0.042, 0.03), sand) * (0.7 + 0.6 * grit);
  bank += vec3(1.0, 0.22, 0.04) * gl * 0.22 * uBank * (0.6 + 0.4 * sand);
  vec3 c = mix(bank, melt, inCh);
  float lip = smoothstep(0.012, 0.0, abs(abs(dx) - halfw));
  c += vec3(1.0, 0.36, 0.1) * lip * 0.35;
  o = vec4(c, 1.0);
}`;

const F_RUST = /* glsl */`
uniform sampler2D tRD, tMask; uniform float uT, uGrow, uAsp, uHasMask, uTile; uniform vec3 uL; uniform vec2 uRes;
${NOISE} ${TONE}
float heightAt(vec2 uv, out float rust, out float pit){
  vec4 rd = texture(tRD, uv * vec2(uAsp, 1.0) * uTile);
  // rust exists where the front arrived before uGrow; a soft margin makes the leading edge bloom
  float a = mix(rd.r, fbm(uv * vec2(uAsp, 1.0) * 7.0, 6), 0.3);
  // a corrosion front is not an edge: ahead of the solid rust, pitting speckles thin out over a band
  float amt = clamp((uGrow - a) / 0.22 + 0.5, 0.0, 1.0), n = fbm(uv * 110.0, 4) * 0.7 + vnoise(uv * 700.0) * 0.3;
  rust = smoothstep(n - 0.08, n + 0.08, amt);
  float lace = smoothstep(0.1, 0.3, rd.g);
  pit = rust * smoothstep(0.35, 0.05, rd.b) * lace;
  // relief of the rust itself only (no step at the front, so patches do not read as stickers)
  return fbm(uv * 90.0, 4) * 0.25 + lace * 0.08 - smoothstep(0.35, 0.05, rd.b) * lace * 0.2;
}
void main(){
  vec2 uv = vUv;
  float rust, pit; float h = heightAt(uv, rust, pit);
  vec2 e = vec2(1.0 / uRes.x, 1.0 / uRes.y) * 1.5; float r1, p1;
  float hx = heightAt(uv + vec2(e.x, 0.0), r1, p1) - heightAt(uv - vec2(e.x, 0.0), r1, p1);
  float hy = heightAt(uv + vec2(0.0, e.y), r1, p1) - heightAt(uv - vec2(0.0, e.y), r1, p1);
  // brushed steel: noise smeared along x (a line integral along the brushing direction)
  float br = 0.0; for (int i = -6; i <= 6; i++) br += vnoise(vec2(uv.x * 40.0 + float(i) * 0.9, uv.y * 2600.0));
  br /= 13.0;
  vec3 N = normalize(mix(vec3(0.0, (br - 0.5) * 0.04, 1.0), vec3(-hx * 3.0, -hy * 3.0, 1.0), rust));
  vec3 L = normalize(uL), V = vec3(0.0, 0.0, 1.0), Hh = normalize(L + V);
  float dif = max(dot(N, L), 0.0);
  // steel: anisotropic sheen stretched across the brushing
  float aniso = pow(max(0.0, 1.0 - pow(dot(normalize(vec3(0.0, 1.0, 0.0) - N * N.y), Hh), 2.0)), 40.0);
  float band = exp(-pow((uv.x * 0.8 + uv.y * 0.45 - 0.62) * 5.0, 2.0));      // a broad raking reflection across the plate
  vec3 steel = vec3(0.16, 0.165, 0.175) * (0.7 + 0.6 * br) * dif + vec3(0.85, 0.88, 0.92) * (aniso * 0.35 + band * (0.25 + 0.5 * br)) + vec3(0.015);
  // stencil (optional): the mark is painted in cream enamel on the steel, rust undercuts its edges
  float m = uHasMask > 0.5 ? texture(tMask, uv).r : 0.0;
  steel = mix(steel, vec3(0.82, 0.74, 0.6) * (0.3 + 0.8 * dif) + pow(max(dot(N, Hh), 0.0), 60.0) * 0.4, m);
  // rust: layered oxides; dark brown body, orange where fresh, near-black in pits, powdery grain
  float ox = fbm(uv * 55.0, 5), gr = h21(floor(gl_FragCoord.xy));
  float big = fbm(uv * 6.0 + 11.0, 4);
  float fine = fbm(uv * 240.0, 3);
  vec3 rc = mix(vec3(0.07, 0.03, 0.016), vec3(0.3, 0.1, 0.03), clamp(ox * 0.6 + big * 0.4 + (fine - 0.5) * 0.8, 0.0, 1.0)); rc = mix(rc, vec3(0.035, 0.018, 0.012), max(pit, smoothstep(0.55, 0.8, big) * 0.6));
  rc = mix(rc, vec3(0.62, 0.28, 0.07), smoothstep(0.75, 0.97, ox) * 0.6);
  rc *= 0.8 + 0.4 * gr;
  vec3 rust3 = rc * (0.35 + 0.85 * dif);
  // oxide stain bleeding ahead of the front darkens the steel
  float stain = smoothstep(uGrow + 0.14, uGrow, texture(tRD, uv * vec2(uAsp, 1.0) * uTile).r);
  steel *= mix(vec3(1.0), vec3(0.62, 0.5, 0.42), stain * 0.7);
  // paint over rust blisters and flakes: islands of enamel survive on the rust
  float flake = smoothstep(0.5, 0.56, fbm(uv * 38.0 + 3.0, 4));
  vec3 c = mix(steel, rust3, rust * (1.0 - m * flake));
  c = mix(c, c * vec3(0.8, 0.62, 0.5), m * rust * flake * 0.5);
  // the leading edge glows faintly red when the rust is receding (REJUVENATION: time runs backward)
  o = vec4(c, 1.0);
}`;

export class Fields {
  constructor(rOrPasses) { this.fx = rOrPasses instanceof Passes ? rOrPasses : new Passes(rOrPasses); }
  static get GLSL() { return NOISE + TONE + BLACKBODY; }
  molten(t, { rd, flow = 0.1, heat = 1, crust = 1, scale = 2.2, bank = 1, width = 0.2 } = {}, target = null) {
    const r = this.fx.r.domElement;
    return this.fx.run('fld_molten', F_MOLTEN, { tRD: rd.texture, uT: t, uFlow: flow, uHeat: heat, uCrust: crust, uScale: scale, uAsp: r.width / r.height, uBank: bank, uWidth: width, uRes: [r.width, r.height] }, target);
  }
  rust(t, { rd, grow = 0.6, light = [-0.5, 0.6, 0.7], mask = null, tile = 1.0 } = {}, target = null) {
    const r = this.fx.r.domElement;
    return this.fx.run('fld_rust', F_RUST, { tRD: rd.texture, tMask: mask || rd.texture, uHasMask: mask ? 1 : 0, uTile: tile, uT: t, uGrow: grow, uAsp: r.width / r.height, uL: light, uRes: [r.width, r.height] }, target);
  }
  finish(src, o, target = null) { return this.fx.finish(src, o, target); }
}
