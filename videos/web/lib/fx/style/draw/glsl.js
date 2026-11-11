// STYLE c2 / S1: the drawn surface, one chained material patch (after lane E's surface.js patch, so its plane normals, clay,
// LIFT and painted underwear are already in `normal` and `diffuseColor`). Inert unless DRAW_U.drMode > 0: a hero that never
// asks for a drawn style renders exactly as before, and one that did renders exactly as before whenever drMode is 0.
//
// Every mark is a function of the person's BIND position (fields.js) and of the tone; the only screen quantities used are
// the screen-space derivatives that pick a line spacing (an octave) and the paper's own tooth (the sheet does not move).
//   kind 1 HATCH    engraving / anatomical plate: cross-contour lines, fibre lines along the muscles in the shadow side,
//                   a diagonal third set in the darks; spacing octave-blended (lines keep their place at any size)
//   kind 2 CONTE    charcoal or red chalk on toned paper: tonal masses (soft terminator, smudge), grain in bind space, a few
//                   fibre strokes in the shadow, white chalk on the lit planes riding the paper's tooth
//   kind 3 LITHO    crayon lithograph (Kollwitz): heavy dark masses, stone grain in bind space, faces and hands lifted
//   kind 4 DITHER   1-bit: a blue-noise tile projected in bind space (dominant axis), octave-blended with the exact CDF so
//                   the tone does not drift as the figure grows or shrinks
//   kind 5 FLAT     ligne claire: flat local colour, cleaned; the line does the work (line.js)
import * as THREE from 'three';

export const DRAW_U = {
  drMode: { value: 0 }, drKind: { value: 1 }, drScreen: { value: 0 }, drScale: { value: 1 },   // drScale: the figure's px per metre / 540 (a 1080-tall full figure = 1)
  drKey: { value: new THREE.Vector3(-0.6, 0.55, 0.55).normalize() },
  drTone: { value: new THREE.Vector4(0.0, 0.08, 0.22, 0.25) },     // terminator, softness, ambient, reflected light
  drLocal: { value: new THREE.Vector4(0.35, 0.65, 0.8, 0) },        // local-value floor, its white point, gamma; (w) unused
  drHatch: { value: new THREE.Vector4(5.0, 1.0, 1.0, 0.0015) },     // spacing px (at 1080 tall), density, cross-contour k, wobble m
  drLevels: { value: new THREE.Vector4(0.1, 0.42, 0.68, 0.0) },     // where the 1st / 2nd / 3rd family start (tone)
  drFace: { value: new THREE.Vector4(0.35, 0.7, 0.25, 0.0) },       // face lift, face spacing k, hand lift, (w) unused
  drInk: { value: new THREE.Color('#15110f') }, drInk2: { value: new THREE.Color('#15110f') },
  drPaper: { value: new THREE.Color('#efe6d2') }, drChalk: { value: new THREE.Color('#f6f1e4') },
  drGrain: { value: new THREE.Vector4(1.4, 0.3, 0.5, 0.6) },        // grain cell px, grain k, smudge k, chalk k
  drPaperK: { value: new THREE.Vector4(0.06, 0.05, 1.6, 0.0) },     // tooth k, mottle k, tooth px, (w) unused
  drRes: { value: new THREE.Vector2(1080, 1920) },
  drBN: { value: null },
};

// STYLE c4: a geometry that already carries most of WebGL's 16 vertex ATTRIBUTES (a v4 body: 13 of its own + lane E's 2) takes the
// fields as ONE attribute, aDrQ (DR_PACK): xyz the three phases exactly, w an integer (exact in a float below 2^24) holding the
// fibre weight (8 bits), the chain purity (8 bits), face - hand (7 bits: the two never overlap) and the eye flag (1 bit), decoded
// here per vertex (before interpolation, so nothing bleeds). DR_TEX: no attribute at all, aDr0 / aDr1 exactly, as two texels a
// vertex of a float texture read by gl_VertexID (three's morph targets already spend gl_VertexID's slot; a v4 body has none to
// spare). Neither (any geometry with room): exactly as before.
const VERT_PARS = /* glsl */`
#if defined(DR_TEX)
uniform highp sampler2D drFieldTex;
#elif defined(DR_PACK)
attribute vec4 aDrQ;
#else
attribute vec4 aDr0, aDr1;
#endif
varying vec4 vDr0, vDr1; varying vec3 vDrP, vDrN;`;
const VERT = /* glsl */`
#if defined(DR_TEX)
{ int i = gl_VertexID * 2, j = i + 1; vDr0 = texelFetch(drFieldTex, ivec2(i % 4096, i / 4096), 0); vDr1 = texelFetch(drFieldTex, ivec2(j % 4096, j / 4096), 0); }
#elif defined(DR_PACK)
{ float q = aDrQ.w, e = mod(q, 2.0); q = floor(q * 0.5); float fh = (mod(q, 128.0) - 63.0) / 63.0; q = floor(q / 128.0);
  vDr0 = vec4(aDrQ.xyz, floor(q / 256.0) / 255.0); vDr1 = vec4(mod(q, 256.0) / 255.0, max(fh, 0.0), max(-fh, 0.0), e > 0.5 ? -1.0 : 0.0); }
#else
vDr0 = aDr0; vDr1 = aDr1;
#endif
vDrN = normal;
#ifdef CLOTH_REST
vDrP = aRest;
#else
vDrP = position;
#endif`;

// shared: hashes, value noise, the paper (screen space: the sheet itself)
export const DR_COMMON = /* glsl */`
float drH3(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float drH2(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float drN3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(drH3(i), drH3(i + vec3(1,0,0)), f.x), mix(drH3(i + vec3(0,1,0)), drH3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(drH3(i + vec3(0,0,1)), drH3(i + vec3(1,0,1)), f.x), mix(drH3(i + vec3(0,1,1)), drH3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float drN2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(drH2(i), drH2(i + vec2(1,0)), f.x), mix(drH2(i + vec2(0,1)), drH2(i + vec2(1,1)), f.x), f.y); }
// the sheet: tooth (fine, anisotropic laid lines faintly) and mottle; returns (colour multiplier, tooth 0..1)
vec2 drSheet(vec2 px, float S){ float t = drN2(px / (drPaperK.z * S)) * 0.65 + drN2(px / (drPaperK.z * S * 2.7) + 17.0) * 0.35;
  float m = drN2(px / (180.0 * S)) * 0.6 + drN2(px / (60.0 * S) + 3.0) * 0.4;
  return vec2(1.0 - drPaperK.x * (t - 0.5) * 2.0 - drPaperK.y * (m - 0.5) * 2.0, t); }`;

const FRAG_PARS = /* glsl */`
uniform float drMode, drKind, drScreen, drObj, drScale; uniform vec3 drKey, drInk, drInk2, drPaper, drChalk; uniform vec4 drTone, drLocal, drHatch, drLevels, drFace, drGrain, drPaperK; uniform vec2 drRes; uniform sampler2D drBN;
varying vec4 vDr0, vDr1; varying vec3 vDrP, vDrN;
${DR_COMMON}
vec3 drSRGB(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
// ink coverage of one family of lines: phase p (m in the bind), its screen gradient g (m / px), target spacing S (px), coverage
// c (the fraction of the area the family inks). The spacing is the octave of 1/1024 m nearest below g S, blended to the next:
// the odd lines thin to nothing and the even ones widen, so the mean coverage stays c (Praun et al. 2001's tonal art maps, in
// closed form). A line keeps its place on the body; only its width and its octave follow the screen.
float drLines(float p, float g, float S, float c){
  if (c < 0.004) return 0.0;
  float want = max(g * S, 1e-7), L = log2(want * 1024.0), k = floor(L), f = L - k;
  float s = exp2(k) / 1024.0, spx = s / max(g, 1e-9);
  float qe = p / (2.0 * s), de = abs(qe - floor(qe + 0.5)) * 2.0 * spx;
  float qo = (p - s) / (2.0 * s), dd = abs(qo - floor(qo + 0.5)) * 2.0 * spx;
  float h1 = 0.5 * c * spx, he = mix(h1, 2.0 * h1, f), ho = h1 * (1.0 - f);
  float ae = clamp(he + 0.5 - de, 0.0, min(1.0, 2.0 * he)), ao = clamp(ho + 0.5 - dd, 0.0, min(1.0, 2.0 * ho));
  // below ~3 px a hatch cannot be printed as lines: it becomes the tone it stands for (the plate seen from across the room)
  return mix(c, max(ae, ao), smoothstep(2.8, 4.0, S)); }
// the screen gradient of a phase, robust to a seam (an atan2 jump) or a border triangle: never far from the metric scale
float drGrad(float p, float m){ return clamp(length(vec2(dFdx(p), dFdy(p))), 0.2 * m, 4.0 * m); }
// value noise on the bind position, octave-blended to a cell of ~cpx pixels (grain that sticks to the skin at any size)
float drGrainN(vec3 P, float m, float cpx){ float L = log2(max(m * cpx, 1e-7) * 2048.0), k = floor(L), f = L - k, s = exp2(k) / 2048.0;
  return mix(drN3(P / s), drN3(P / (2.0 * s) + 31.0), f); }
// blue noise projected on the dominant bind axis, octave-blended; the mix of two uniform thresholds mapped back to uniform
float drBlue(vec3 P, vec3 Nb, float m, float cpx){ vec3 a = abs(Nb); vec2 uv = a.x > a.y && a.x > a.z ? P.yz : a.y > a.z ? P.xz : P.xy;
  float L = log2(max(m * cpx, 1e-7) * 4096.0), k = floor(L), f = L - k, s = exp2(k) / 4096.0;
  float t1 = texture2D(drBN, uv / (s * 64.0)).r, t2 = texture2D(drBN, uv / (s * 128.0) + 0.37).r;
  float A = min(1.0 - f, f), B = max(1.0 - f, f), x = (1.0 - f) * t1 + f * t2;
  if (A < 1e-3) return x;
  return x < A ? x * x / (2.0 * A * B) : x <= B ? (x - 0.5 * A) / B : 1.0 - (1.0 - x) * (1.0 - x) / (2.0 * A * B); }`;

// at the very end of main(), before lane E's OUT (inert while its mode is 0)
const OUT = /* glsl */`
if (drMode > 1.5) { gl_FragColor = vec4(vDrP, drObj + 1.0); }      // the bind-position AOV (motion coherence test)
else if (drMode > 0.5) {
  vec3 N = normalize(normal); vec3 Kd = normalize(drKey);
  float ndl = dot(N, Kd), S = drRes.y / 1080.0, face = vDr1.y, hand = vDr1.z;
  vec3 ls = drSRGB(diffuseColor.rgb); float lv = dot(ls, vec3(0.2126, 0.7152, 0.0722));
  // light: a designed terminator, a gradient in the light, reflected light at the edge of the shadow (Loomis's five tones)
  // (drLocal.w: how much of the turn of the form shows inside the light; a drawing models the light side too)
  float lit = smoothstep(drTone.x - drTone.y, drTone.x + drTone.y, ndl), grad = smoothstep(-0.05, 0.95, ndl);
  float refl = (1.0 - lit) * pow(1.0 - abs(N.z), 2.0) * drTone.w;
  float light = lit * (1.0 - drLocal.w + drLocal.w * grad) + refl;
  // local value: every skin tone keeps its form (deep skin is drawn darker, never a solid)
  float lf = drLocal.x + (1.0 - drLocal.x) * pow(clamp(lv / drLocal.y, 0.0, 1.0), drLocal.z);
  float v = lf * (drTone.z + (1.0 - drTone.z) * light);
  v = mix(v, 1.0 - (1.0 - v) * (1.0 - drFace.x), face); v = mix(v, 1.0 - (1.0 - v) * (1.0 - drFace.z), hand);   // faces and hands kept
  float T = clamp(1.0 - v, 0.0, 1.0);
  // the face is MODELLED, not lifted blank: its turning planes (the side of the nose, under the brow, the cheek's turn) take a
  // half-tone even in the light (the first farm board: light faces printed as white masks with dark eye holes); the eyes are
  // drawn light (the iris is a mid-tone in a drawing, the lids are line.js's)
  T += drFace.w * face * (1.0 - smoothstep(0.2, 0.92, ndl)) * (1.0 - T);
  T = mix(T, T * 0.45, step(vDr1.w, -0.5));
  vec2 sheet = drSheet(gl_FragCoord.xy, S);
  vec3 paper = drPaper * sheet.x;
  float m = max(length(dFdx(vDrP)), length(dFdy(vDrP)));
  vec3 P = vDrP;
  if (drScreen > 0.5) { P = vec3(gl_FragCoord.xy * 0.0012 / S, 0.0); m = 0.0012 / S; }     // the control: the same marks fixed to the screen
  float wob = (drN3(P * 28.0) - 0.5) * drHatch.w;
  float pc = vDr0.x + wob, pl = vDr0.y + wob, pf = vDr0.z + wob, pd = dot(P, normalize(vec3(0.62, 1.0, 0.22))) + wob;
  if (drScreen > 0.5) { pc = P.y; pl = P.x; pf = P.x; pd = dot(P.xy, normalize(vec2(0.62, 1.0))); }
  float gc = drGrad(pc, m), gL = drGrad(pl, m), gf = drGrad(pf, m), gd = drGrad(pd, m);
  float Sp = drHatch.x * sqrt(drScale) * mix(1.0, drFace.y, face);
  float pur = smoothstep(0.62, 0.92, vDr1.x), fw = drScreen > 0.5 ? 0.0 : vDr0.w;
  int drK = int(drKind + 0.5);
  vec3 col = paper;
  if (drK == 1) {
    // HATCH: 1st family follows the cross-contour, 2nd the fibres (or the form) in the shadow, 3rd a diagonal in the darks
    float r1 = clamp((T - drLevels.x) / (1.0 - drLevels.x), 0.0, 1.0), r2 = clamp((T - drLevels.y) / (1.0 - drLevels.y), 0.0, 1.0), r3 = clamp((T - drLevels.z) / (1.0 - drLevels.z), 0.0, 1.0);
    float cA = r1 * 0.62 * drHatch.y, cB = r2 * 0.5 * drHatch.y, cC = r3 * 0.42 * drHatch.y;
    float a = drLines(pc, gc, Sp, cA * pur * drHatch.z);
    float b = max(drLines(pf, gf, Sp, cB * fw), drLines(pl, gL, Sp, cB * (1.0 - fw) * pur * (1.0 - 0.6 * face)));
    float c = drLines(pd, gd, Sp * 1.06, max(cC, cA * (1.0 - pur)));
    float ink = 1.0 - (1.0 - a) * (1.0 - b) * (1.0 - c);
    col = mix(paper, drInk, ink);
  } else if (drK == 2) {
    // CONTE: the shadow as one smudged mass (Loomis), grain stuck to the body (the charcoal's own drag, in bind space), a veil
    // in the half-tones, a few fibre strokes in the shadow and sparse cross-contours in the turn, white chalk in the lights
    float gr = drGrainN(P, m, drGrain.x), g2 = drGrainN(P + 13.1, m, drGrain.x * 2.6), sm = drN3(P * 7.0);
    float dark = smoothstep(0.5, 0.72, T + (gr - 0.5) * drGrain.y + (sm - 0.5) * drGrain.z);
    float veil = smoothstep(0.24, 0.62, T) * 0.36 * (0.65 + 0.35 * mix(gr, g2, 0.5));
    float strokes = smoothstep(0.45, 0.9, drScale) * drLines(pf, gf, Sp * 1.7, smoothstep(0.45, 0.85, T) * 0.4 * fw) + smoothstep(0.45, 0.9, drScale) * drLines(pc, gc, Sp * 2.2, smoothstep(0.36, 0.5, T) * (1.0 - smoothstep(0.55, 0.68, T)) * 0.14 * pur * (1.0 - face));
    float ch = smoothstep(0.6, 0.88, light) * drGrain.w * (0.72 + 0.28 * g2) * mix(0.55, 1.0, lf);
    float ink = clamp(max(dark * (0.84 + 0.16 * gr), veil) + strokes * 0.6, 0.0, 0.95);
    col = mix(mix(paper, drChalk, ch * (1.0 - ink)), drInk, ink);
  } else if (drK == 3) {
    // LITHO: heavy masses, the stone's grain (a stochastic screen on the body), crayon strokes along the diagonal
    float gr = drGrainN(P, m, drGrain.x), g2 = drGrainN(P + 7.3, m, drGrain.x * 2.3);
    float stroke = drLines(pd, gd, Sp * 1.5, 0.5);
    float t = smoothstep(drLevels.x, drLevels.y, T) * 0.6 + smoothstep(drLevels.y, drLevels.z, T) * 0.4;
    float th = mix(gr, g2, 0.35) * 0.85 + (1.0 - stroke) * 0.15;
    float ink = smoothstep(th - 0.06, th + 0.06, t);
    col = mix(paper, drInk, ink * 0.95);
  } else if (drK == 4) {
    // DITHER: one bit, blue noise on the body
    float th = drBlue(P, normalize(vDrN), m, drGrain.x);
    float t = smoothstep(drLevels.x, drLevels.y, T);
    col = th < t ? drInk : drPaper;
  } else if (drK == 9) {
    col = vec3(T, light, fw);                                        // debug: tone, light, fibre weight
  } else {
    // FLAT (ligne claire): the local colour, cleaned and lifted; one optional flat shadow (drLevels.w)
    vec3 c = mix(ls, vec3(1.0), 0.08); float y = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = clamp(mix(vec3(y), c, 1.12), 0.0, 1.0);
    col = c * (1.0 - drLevels.w * (1.0 - lit));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const toPatch = mt => mt && (mt.isMeshStandardMaterial || mt.isMeshPhysicalMaterial);
// the packed field (DR_PACK) of a geometry from its aDr0 / aDr1 (kept on the geometry for JS readers; the program reads aDrQ only)
export function packDrawFields(g) {
  const a0 = g.attributes.aDr0.array, a1 = g.attributes.aDr1.array, n = g.attributes.position.count, q = new Float32Array(n * 4);
  const u8 = x => Math.max(0, Math.min(255, Math.round(x * 255)));
  for (let v = 0; v < n; v++) { const fh = Math.max(-1, Math.min(1, a1[v * 4 + 1] - a1[v * 4 + 2]));
    q[v * 4] = a0[v * 4]; q[v * 4 + 1] = a0[v * 4 + 1]; q[v * 4 + 2] = a0[v * 4 + 2];
    q[v * 4 + 3] = ((u8(a0[v * 4 + 3]) * 256 + u8(a1[v * 4])) * 128 + Math.round(fh * 63 + 63)) * 2 + (a1[v * 4 + 3] < -0.5 ? 1 : 0); }
  g.setAttribute('aDrQ', new THREE.BufferAttribute(q, 4)); return g.attributes.aDrQ;
}
// aDr0 / aDr1 as a float texture, two texels a vertex (4096 texels a row), read by gl_VertexID (DR_TEX): exact
export function drawFieldTexture(g) {
  if (g.userData.drTex) return g.userData.drTex;
  const a0 = g.attributes.aDr0.array, a1 = g.attributes.aDr1.array, n = g.attributes.position.count, w = 4096, h = Math.ceil(2 * n / w), d = new Float32Array(w * h * 4);
  for (let v = 0; v < n; v++) { d.set(a0.subarray(v * 4, v * 4 + 4), v * 8); d.set(a1.subarray(v * 4, v * 4 + 4), v * 8 + 4); }
  const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return (g.userData.drTex = t);
}
// install on one material, chained after whatever is there (lane E's patch first: recipes' prepare() does that)
export function patchDraw(mat, obj = 0, { pack = false, tex = null } = {}) {
  if (!toPatch(mat) || mat.userData.draw) return false;
  if (pack || tex) mat.defines = { ...(mat.defines || {}), ...(tex ? { DR_TEX: '' } : { DR_PACK: '' }) };
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey, own = { drObj: { value: obj }, ...(tex ? { drFieldTex: { value: tex } } : {}) };
  mat.userData.draw = { own };
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    Object.assign(sh.uniforms, DRAW_U, own);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS).replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + OUT);
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '|draw';
  mat.needsUpdate = true;
  return true;
}

// the paper behind the figures: a full-screen triangle drawn first (only during the drawn pass)
export function paperQuad() {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const m = new THREE.ShaderMaterial({ uniforms: DRAW_U, depthTest: false, depthWrite: false,
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform vec3 drPaper, drInk; uniform vec4 drPaperK; uniform vec2 drRes; uniform float drKind, drScreen;\n${DR_COMMON}\nvoid main(){ vec2 sh = drSheet(gl_FragCoord.xy, drRes.y / 1080.0); gl_FragColor = vec4(drPaper * (int(drKind + 0.5) == 4 ? 1.0 : sh.x), 1.0); }` });
  m.userData.style = { paper: true };    // lane E's stylePass keeps meshes whose materials carry userData.style
  const q = new THREE.Mesh(g, m); q.frustumCulled = false; q.renderOrder = -1e6; q.userData.drawPaper = true;
  return q;
}

// a 64 x 64 blue-noise tile (void and cluster, Ulichney 1993; toroidal gaussian energy, sigma 1.5), generated once
let _bn = null;
export function blueNoise(N = 64, sigma = 1.5) {
  if (_bn) return _bn;
  const n = N * N, K = new Float32Array(n);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const dx = Math.min(x, N - x), dy = Math.min(y, N - y); K[y * N + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)); }
  const E = new Float32Array(n), on = new Uint8Array(n), rank = new Int32Array(n);
  const splat = (i, s) => { const ix = i % N, iy = (i / N) | 0; for (let y = 0; y < N; y++) { const ry = ((y - iy + N) % N) * N; for (let x = 0; x < N; x++) E[y * N + x] += s * K[ry + ((x - ix + N) % N)]; } };
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const m0 = Math.round(n * 0.1); let ones = 0; while (ones < m0) { const i = (rnd() * n) | 0; if (!on[i]) { on[i] = 1; splat(i, 1); ones++; } }
  const tight = () => { let b = -1, bv = -Infinity; for (let i = 0; i < n; i++) if (on[i] && E[i] > bv) { bv = E[i]; b = i; } return b; };
  const voidf = () => { let b = -1, bv = Infinity; for (let i = 0; i < n; i++) if (!on[i] && E[i] < bv) { bv = E[i]; b = i; } return b; };
  for (let it = 0; it < n; it++) { const t = tight(); on[t] = 0; splat(t, -1); const v = voidf(); if (v === t) { on[t] = 1; splat(t, 1); break; } on[v] = 1; splat(v, 1); }
  const proto = on.slice(), Ep = E.slice();
  for (let r = ones - 1; r >= 0; r--) { const t = tight(); on[t] = 0; splat(t, -1); rank[t] = r; }
  on.set(proto); E.set(Ep);
  for (let r = ones; r < n; r++) { const v = voidf(); on[v] = 1; splat(v, 1); rank[v] = r; }
  const data = new Uint8Array(n); for (let i = 0; i < n; i++) data[i] = Math.min(255, Math.floor((rank[i] + 0.5) / n * 256));
  return (_bn = { N, data });
}
export function blueNoiseTexture() {
  if (DRAW_U.drBN.value) return DRAW_U.drBN.value;
  const { N, data } = blueNoise(); const t = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return (DRAW_U.drBN.value = t);
}
