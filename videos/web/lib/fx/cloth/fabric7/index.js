// FABRIC7: the surface response of our cloth, the ONE current appearance module of the fabric program (round 7, 8 Oct; superseded revisions deleted 8 Oct 17:05, git history is their record).
// It rides on fabric6.js (the yarn, seam, hem, wear and wrinkle program: fabric6.js's hook hands every fabric material to the extension below) and on fabric_glsl.js (the c1 program):
//   useFabric7({ samples: 16 })   BEFORE makePerson: samples = the render tier's sub-frames K (film 16, motion 8, else 1); atlas: 1 = the Cycles garment BAKE (fabric7_texbake.html); age: scales every fabric's wear;
//                                 ON by default (15 Oct; v7lanes/FABRIC7.json carries the same): cascade 1 = the strain-driven wrinkle cascade of fabric6.js; fold 1 = fold7.js: the creases the mesh can carry as GEOMETRY (crease7.js
//                                 gives them a cause); motion 1 = wear7.js: wear from the body's motion (the person's own postures run on each garment: the fade where the cloth is dragged, the pale creased lines where it folds, and the relief of the set creases they are the crest of: setrelief 0 leaves the lines as colour only); fuzz 1 = fabric6.js fuzz6's fibre shells in the engine (3 layers at the film tier, 2 at motion's; none in a node export or the atlas bake, where Cycles carries the fuzz in its
//                                 sheen). An A/B turns ONE of them off ({ fold: 0 } in popts.fabric7: the person's build applies the lane file over a page-level call).
//   stopFabric7()                 off for materials made from now on.
// What it does, one layer each:
//   grain   AUDIT7 C14 at its source. c1's far-field `st` was value noise stretched 40:1 along the warp (brushed metal on jersey, wood grain on canvas). Here: what a camera sees of cloth it cannot resolve: one hash
//           per weave cell (isotropic in thread units) averaged by the cells a SAMPLE covers (1 / sqrt(n): grain at one thread a pixel, gone at 270 px), two isotropic mottles at 3 and 10 cells, and
//           residual lanes 2 threads wide and ~2 cm long (denim's striation). The yarn layer rev 6 draws runs to 1.4 threads a pixel (1.9 at the film tier) so the weave is still there at 1:1.
//   tone    a panel is never one flat tone (AUDIT7 C15 / C13): a cloud in the pattern's own metres (2, 6, 20 cm: dye lot, wash, hand soil), and on every fold crests lighten and desaturate, valleys deepen
//           and saturate. The tone block runs BEFORE rev 6's seam and hem construction, so stitch rows and needle holes keep their own colour.
//   light   thin cloth is not a hard diffuse: an energy-conserving wrapped Lambert (the soft terminator: the exponent p(w) keeps the lit half's integral equal to Lambert's), a fibre rim that lifts grazing
//           silhouettes (direct and indirect), and the sheen weighted up and tightened so it reads on crests.
//   lod     the yarn layer's MEAN. Rev 6's yarn layer adds the yarn's slope to the shading normal, so a resolved knit is darker than the unresolved flat colour by S = <1 / sqrt(1 + g^2)> (jersey 0.83, rib
//           0.79, denim 0.88, twill 0.93: SHADE7, from fabric7_shade_lod.mjs, a port of the shader's own height field). The yarn layer's colour is divided by S(aY): the cloth has the same level at every scale.
//   atlas   (atlas: 1, the Cycles bake only) a texel of the garment atlas (0.72-0.88 mm) is as coarse as a thread, so the atlas carries what a texel can and leaves to Cycles what Cycles does: no yarn where
//           Cycles lays its own tile, the knit's cell octave and mid / big grain x 0.6 / 0.35, the fold tint x 0.35 (Cycles lights the real folds), the tone cloud x 0.35 kept to the worn and sun-faded
//           zones, the heather's 4.5 cm octave x 0.25, stitch rows 1.2 mm wide in a thread 28 % darker than the cloth (a row of 0.84 mm does not survive the texel and Cycles' filter).
// The numbers in LOOKS7 are first-principles guidance from what a camera shows of each fabric at 0.5 mm a pixel and from AUDIT7's reads, not rules: judged by eye against the clothed photographs.
// Tests: labs/clothing2/fabric7_test.mjs (builds people, compiles every garment program with glslangValidator), fabric7_wrinkle_probe.mjs (the cloth's own strain per garment).
import * as THREE from 'three';
import { useFabric6, look6, setFabric7Ext, setFold7, setFuzz6, setWear7, cycles6 } from '../fabric6.js';
import { fold7 } from './fold7.js';
import { wear7, wearRiders7 } from './wear7.js';

export const FABRIC7_VERSION = 7;   // the integer is a flag: version7 in fabric6.json turns on the Cycles seams of blender/person_scene.py + fabric7_cycles.py
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// the Cycles garment bake's constants (atlas: 1): see the header's `atlas` line. (They were options until 8 Oct 17:05; there is one current setting.)
export const ATLAS7 = { cloudGain: 0.35, cloudMask: 1, exposure: 0.08, heatherCm: 0.25, atlasGrain: 0.35, atlasCell: 0.6, atlasFold: 0.35, stitchHalfMm: 0.6, threadGain: 0.88 };

// per fabric: grain [cell, mid, big] = std of the luminance fraction each scale contributes where the pixel is smaller than it (cell: a weave cell; mid: 3 cells;
//   big: 10 cells); lane = the residual lane share of c1's slub (0 = none, 1 = c1's own), cloud = tone std at 2-20 cm, crest = crest lightening / valley
//   deepening, sat = crest desaturation / valley saturation, wrap = the soft terminator, rim = the fibre rim, sheen = the sheen weight x, sheenR = its
//   roughness x (< 1: a tighter lobe)
const L7 = o => o;
export const LOOKS7 = {
  teeJersey:     L7({ grain: [0.045, 0.030, 0.020], lane: 0.08, cloud: 0.055, crest: 0.14, sat: 0.25, wrap: 0.30, rim: 0.50, sheen: 1.5, sheenR: 0.8 }),
  jersey:        L7({ grain: [0.045, 0.030, 0.020], lane: 0.08, cloud: 0.055, crest: 0.14, sat: 0.25, wrap: 0.30, rim: 0.50, sheen: 1.5, sheenR: 0.8 }),
  heatherJersey: L7({ grain: [0.055, 0.025, 0.019], lane: 0.08, cloud: 0.070, crest: 0.14, sat: 0.20, wrap: 0.30, rim: 0.55, sheen: 1.5, sheenR: 0.8 }),
  fleece:        L7({ grain: [0.050, 0.026, 0.0195], lane: 0.08, cloud: 0.060, crest: 0.12, sat: 0.20, wrap: 0.35, rim: 0.60, sheen: 1.3, sheenR: 0.85 }),
  rib:           L7({ grain: [0.050, 0.030, 0.020], lane: 0.08, cloud: 0.050, crest: 0.12, sat: 0.20, wrap: 0.30, rim: 0.50, sheen: 1.4, sheenR: 0.8 }),
  scrub:         L7({ grain: [0.030, 0.020, 0.015], lane: 0.15, cloud: 0.040, crest: 0.16, sat: 0.30, wrap: 0.22, rim: 0.20, sheen: 1.5, sheenR: 0.7 }),
  oxford:        L7({ grain: [0.030, 0.030, 0.020], lane: 0.20, cloud: 0.045, crest: 0.16, sat: 0.25, wrap: 0.22, rim: 0.25, sheen: 1.4, sheenR: 0.75 }),
  chambray:      L7({ grain: [0.050, 0.040, 0.030], lane: 0.25, cloud: 0.060, crest: 0.16, sat: 0.25, wrap: 0.22, rim: 0.25, sheen: 1.3, sheenR: 0.75 }),
  chino:         L7({ grain: [0.045, 0.035, 0.025], lane: 0.20, cloud: 0.060, crest: 0.14, sat: 0.22, wrap: 0.18, rim: 0.30, sheen: 1.3, sheenR: 0.8 }),
  twillPC:       L7({ grain: [0.045, 0.035, 0.025], lane: 0.20, cloud: 0.060, crest: 0.14, sat: 0.22, wrap: 0.18, rim: 0.30, sheen: 1.3, sheenR: 0.8 }),
  denim:         L7({ grain: [0.070, 0.060, 0.050], lane: 0.35, cloud: 0.085, crest: 0.16, sat: 0.20, wrap: 0.12, rim: 0.25, sheen: 1.2, sheenR: 0.85 }),
  stretchDenim:  L7({ grain: [0.065, 0.055, 0.045], lane: 0.35, cloud: 0.080, crest: 0.16, sat: 0.20, wrap: 0.12, rim: 0.25, sheen: 1.2, sheenR: 0.85 }),
  canvas:        L7({ grain: [0.060, 0.050, 0.040], lane: 0.25, cloud: 0.080, crest: 0.16, sat: 0.20, wrap: 0.12, rim: 0.30, sheen: 1.0, sheenR: 0.9 }),
  woolFlannel:   L7({ grain: [0.050, 0.050, 0.040], lane: 0.20, cloud: 0.070, crest: 0.12, sat: 0.20, wrap: 0.35, rim: 0.60, sheen: 1.3, sheenR: 0.85 }),
};
// 1 / S(aY) at aY .25 .5 .75 1 of each fabric's yarn layer (S = the mean over a cell of 1 / sqrt(1 + |f6G|^2): the shading-normal loss of the yarn slope at normal incidence, light-independent for a symmetric field);
// `node web/labs/clothing2/fabric7_shade_lod.mjs` prints it from the shader's own height functions (f6woven / f6knit). A fabric without an entry is not compensated.
export const SHADE7 = {"stretchDenim":[1.025,1.0629,1.0986,1.1335],"denim":[1.026,1.0648,1.1009,1.1361],"chino":[1.0117,1.0348,1.0614,1.0902],"twillPC":[1.0066,1.0231,1.0452,1.0708],"canvas":[1.0137,1.039,1.0663,1.0946],"oxford":[1.0151,1.0436,1.0743,1.1062],"chambray":[1.0262,1.0714,1.1162,1.1611],"scrub":[1.0103,1.0298,1.0527,1.0792],"teeJersey":[1.0361,1.0894,1.1467,1.2068],"heatherJersey":[1.0361,1.0894,1.1467,1.2068],"jersey":[1.0355,1.088,1.1445,1.2037],"fleece":[1.0305,1.0793,1.1338,1.1918],"rib":[1.0448,1.1163,1.1897,1.2618],"woolFlannel":[1.0065,1.0233,1.0467,1.0744]};
const DEFAULT7 = L7({ grain: [0.045, 0.035, 0.025], lane: 0.2, cloud: 0.060, crest: 0.14, sat: 0.22, wrap: 0.2, rim: 0.3, sheen: 1.3, sheenR: 0.8 });
// the fabrics whose yarn Cycles lays from a tile (web/assets/fabric6/tiles/<name>_yarn.png, blender/person_scene.py _f6_detail): the atlas draws none of theirs (useFabric7({ atlas: 1 }))
// the knits among them (jersey loops are 0.7-0.9 mm: one thread a texel, where the atlas cannot carry a 3-cell or 10-cell mottle without it reading as felt)
export const KNIT7 = new Set(['fleece', 'heatherJersey', 'jersey', 'rib', 'teeJersey']);
export const TILED7 = new Set(['canvas', 'chambray', 'chino', 'denim', 'fleece', 'heatherJersey', 'jersey', 'oxford', 'rib', 'scrub', 'stretchDenim', 'teeJersey', 'twillPC', 'woolFlannel']);
export const look7 = name => LOOKS7[name] || DEFAULT7;

let OPTS = { age: null, samples: 1, atlas: 0, cascade: 1, fold: 1, fuzz: 1, motion: 1, setrelief: 1 };   // everything ON (15 Oct): the person's own fabric; an A/B turns ONE of cascade / fold / fuzz off
let ON = false, FOLDO = {};
// turn rev 7 on for fabric materials made from now on (and rev 6, which it rides on). Options not named in the header are ignored.
export function useFabric7(o = {}) {
  OPTS = { ...OPTS, ...(o.age !== undefined ? { age: o.age } : {}), ...(o.samples ? { samples: +o.samples } : {}), ...(o.atlas !== undefined ? { atlas: o.atlas ? 1 : 0 } : {}), ...(o.cascade !== undefined ? { cascade: o.cascade ? 1 : 0 } : {}), ...(o.fold !== undefined ? { fold: o.fold ? 1 : 0 } : {}), ...(o.fuzz !== undefined ? { fuzz: o.fuzz ? 1 : 0 } : {}), ...(o.motion !== undefined ? { motion: o.motion ? 1 : 0 } : {}), ...(o.setrelief !== undefined ? { setrelief: o.setrelief ? 1 : 0 } : {}) };
  if (OPTS.fold) OPTS.cascade = 1;   // the geometry takes the top octaves of the cascade and the shader draws the rest: no cascade, no shares to take
  ON = true;
  setFuzz6(OPTS.fuzz && !OPTS.atlas ? (OPTS.samples >= 16 ? 3 : 2) : 0);   // the fibre shells of the engine (fabric6.js fuzz6): 3 layers at the film tier, 2 at motion's; none in the Cycles atlas bake
  useFabric6({ ...(OPTS.age != null ? { ageScale: OPTS.age } : {}), cascade: OPTS.cascade, setRelief: OPTS.setrelief });   // setrelief 0: the worn lines as colour only (the A/B of the set creases' relief)
  if (o.fold !== undefined) FOLDO = o.fold && typeof o.fold === 'object' ? o.fold : {};   // fold7's own options (sample, slope, allowance, refine, crease: { loc, slope, floorA, imperf, cell, maxCatch }, keep ...) stay until a page names others: the person's build calls useFabric7 again without them
  setFold7(OPTS.fold ? root => fold7(root, FOLDO) : null);
  setWear7(OPTS.motion ? wear7 : null, OPTS.motion ? wearRiders7 : null);   // wear from the body's motion (wear7.js): the postures of the person's own skeleton run on each garment; { motion: 0 } leaves the fold lines and abrasion out
  setFabric7Ext(hook7); return FABRIC7_VERSION;
}
export function stopFabric7() { ON = false; setFabric7Ext(null); setFold7(null); setFuzz6(0); setWear7(null); }
export const fabric7Options = () => ({ on: ON, ...OPTS });
// what a bake page really ran with (written into fabric6.json's atlas7)
export const fabric7Used = () => ({ atlas: !!OPTS.atlas, cascade: !!OPTS.cascade, fold: !!OPTS.fold, fuzz: !!OPTS.fuzz, motion: !!OPTS.motion, samples: OPTS.samples, ...ATLAS7 });

// the exponent p of the energy-conserving wrap f(c) = ((c + w) / (1 + w))^p, c = N.L: the lit-half integral of f equals Lambert's, int_0^1 f dc = 1/2:
//   (1 + w) / (p + 1) x (1 - (w / (1 + w))^(p + 1)) = 1/2, solved by bisection (monotone in p). w .12 -> 1.2, w .30 -> 1.53, w .35 -> 1.6.
export function wrapExp(w) {
  if (!(w > 0)) return 1;
  const I = p => (1 + w) / (p + 1) * (1 - Math.pow(w / (1 + w), p + 1));
  let lo = 1, hi = 4; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (I(m) > 0.5) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// the rev-7 uniforms of a fabric
export function uniforms7(name, O = OPTS) {
  const L = look7(name), K = Math.max(1, O.samples || 1), AT = O.atlas ? ATLAS7 : null;
  const ag = AT && KNIT7.has(name) ? AT.atlasGrain : 1, ac = AT && KNIT7.has(name) ? AT.atlasCell : 1, af = AT && TILED7.has(name) ? AT.atlasFold : 1;   // the atlas keeps what a texel can carry (header)
  const V = (...a) => ({ value: new THREE.Vector4(...a) });
  return {
    f7G: V(L.grain[0] * ac, L.grain[1] * ag, L.grain[2] * ag, L.lane),
    f7T: V(L.cloud * (AT ? AT.cloudGain : 1), L.crest * af, Math.min(0.9, L.sat * af), wrapExp(L.wrap)),   // .w: the wrap's exponent
    f7C: V(...((!AT && SHADE7[name]) || [1, 1, 1, 1])),   // lod: 1 / S at aY .25 .5 .75 1 (none in the atlas, where the yarn is Cycles' own)
    f7M: V(0.3, AT ? AT.exposure : 0, 0, 0),              // the cloud mask's floor share (x), the sun fade (y): read only by the atlas' cloudMask block
    f7L: V(L.wrap, L.rim, L.sheen, L.sheenR),
    f7Y: V(...(AT ? (TILED7.has(name) ? [0.12, 0.30] : [0.3, 0.75]) : K >= 8 ? [0.6, 1.9] : [0.45, 1.4]), 1 / Math.sqrt(K), 1),   // yarn fade lo, hi (threads an internal pixel), 1 / sqrt(K), 1
  };
}

// ---------------------------------------------------------------- GLSL (inserted into the rev-6 / fabric_glsl.js program by string anchors)
// ---------------------------------------------------------------- GLSL (inserted into the rev-6 / fabric_glsl.js program by string anchors)
export const F7_PARS = `
uniform vec4 f7G, f7T, f7L, f7Y;
float f7h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float f7vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(f7h(i), f7h(i + vec2(1.0, 0.0)), f.x), mix(f7h(i + vec2(0.0, 1.0)), f7h(i + vec2(1.0, 1.0)), f.x), f.y); }
// the grain a camera sees of cloth it cannot resolve: a hash per weave cell (isotropic in thread units), averaged by the cells a SAMPLE covers (n; the render tier then
// averages its K sub-frames, so the footprint is fq / sqrt(K): see the header), plus mottles at 3 and 10 cells (also isotropic). ay is the yarn layer's own weight (rev 6
// draws a resolved cell): the cell hash is the complement, so a cell is the yarn's or the grain's, never both. f7G = (cell, mid, big) as luminance fractions.
float f7Grain(vec2 qe, vec2 fq, float ay){
  vec2 fe = fq * f7Y.z;
  float n = max(fe.x * fe.y, 1e-4);
  float wc = inversesqrt(max(n, 1.0)) * (1.0 - ay);
  float wm = inversesqrt(max(n / 9.0, 1.0)), wb = inversesqrt(max(n / 100.0, 1.0));
  vec2 s = vec2(cSeed * 7.13, cSeed * 3.71);
  float c = (f7h(floor(qe) + s) - 0.5) * 3.46, m = (f7vn(qe / 3.0 + s * 1.7) - 0.5) * 5.0, b = (f7vn(qe / 10.0 + s * 2.3) - 0.5) * 5.0;
  return f7G.x * c * wc + f7G.y * m * wm + f7G.z * b * wb;
}
// tone cloud in the pattern's metres (2, 6 and 20 cm), each octave faded as the pixel nears its size: dye lot, wash and soil, not a stripe
float f7Cloud(vec2 q, float pxm){
  float a = (f7vn(q / 0.02 + vec2(cSeed * 1.9, 3.3)) - 0.5) * 5.0, b = (f7vn(q / 0.06 + vec2(5.1, cSeed * 2.7)) - 0.5) * 5.0, c = (f7vn(q / 0.2 + vec2(cSeed * 0.9, 9.7)) - 0.5) * 5.0;
  return 0.5 * a * (1.0 - smoothstep(0.3, 0.9, pxm / 0.02)) + 0.6 * b * (1.0 - smoothstep(0.3, 0.9, pxm / 0.06)) + 0.45 * c;
}
// crests lighten and wash toward the fibre's own white, valleys deepen and saturate (light that crossed the dye twice)
vec3 f7Fold(vec3 col, float crest){
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= 1.0 + f7T.y * crest;
  return max(mix(vec3(l), col, 1.0 - f7T.z * crest), vec3(0.0));
}
// thin cloth passes light round the terminator through the fibre mass: a wrapped Lambert whose exponent (f7T.w) keeps the lit half's energy (lit side where it was, mid-tones a few
// percent down, the toe and the band past the terminator up), the wrapped band tinted deeper by the dye.
vec3 f7Diffuse(const in vec3 L, const in vec3 N, const in vec3 lc, const in vec3 dc, const in float dotNL){
  float w = f7L.x, wl = pow(clamp((dot(N, L) + w) / (1.0 + w), 0.0, 1.0), f7T.w);
  float l = dot(dc, vec3(0.2126, 0.7152, 0.0722)); vec3 deep = min(mix(dc, dc * dc / max(l, 0.02), 0.6), dc * 1.6 + 0.004);
  deep *= l / max(dot(deep, vec3(0.2126, 0.7152, 0.0722)), 1e-4);          // a saturation shift of the wrapped band, not a brightening of it
  float s = clamp((wl - dotNL) / max(wl, 1e-3), 0.0, 1.0); return lc * wl * mix(dc, deep, s) * RECIPROCAL_PI;
}
// the fibre rim of the environment's diffuse light: grazing silhouettes lift (outside faces only)
float f7Rim(const in vec3 N, const in vec3 V){ return gIn > 0.5 ? 1.0 : 1.0 + f7L.y * 0.5 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0); }
`;
// the colour block: before c1's wet darkening (inside its outside-face branch's scope: q, pxm and crest are in scope)
// lod: the compensation of the yarn layer's colour: 1 / S at the layer's weight a (piecewise linear through f7C at .25 .5 .75 1; 1 at 0)
export const F7_LOD_PARS = `
uniform vec4 f7C;
float f7Lod(float a){ float x = clamp(a, 0.0, 1.0) * 4.0; int i = int(min(floor(x), 3.0));
  float k0 = i == 0 ? 1.0 : i == 1 ? f7C.x : i == 2 ? f7C.y : f7C.z, k1 = i == 0 ? f7C.x : i == 1 ? f7C.y : i == 2 ? f7C.z : f7C.w; return mix(k0, k1, x - float(i)); }
`;
export const F7_TONE = `
  if (gIn < 0.5) {
    col *= 1.0 + f7T.x * f7Cloud(q, pxm);
    col = f7Fold(col, crest);
  }
`;
// the atlas' tone (atlas: 1): the tone cloud only where cloth is worn, and the sun fade on what faces up. Uses what rev 6's own wear block uses (in scope here: arm, along, hemBand,
// cHem, vBN, crest): rubbed = the stitched hem band, the sleeve end, fold crests; sun = an up-facing normal (shoulders, yoke, the top of a sleeve). f7M.x is the share of the cloud that stays
// everywhere (dye lot); f7M.y the fade (lightens and desaturates, by up^2).
export const F7_TONE_MASK = `
  if (gIn < 0.5) {
    float f7up = clamp(vBN.y, 0.0, 1.0), f7cuff = arm ? smoothstep(cHem.x - 0.22, cHem.x - 0.01, along) : 0.0;
    float f7rub = clamp(0.9 * hemBand + 0.7 * f7cuff + 0.5 * smoothstep(0.3, 0.9, crest) + 0.45 * f7up * f7up, 0.0, 1.0);
    col *= 1.0 + f7T.x * f7Cloud(q, pxm) * (f7M.x + (1.0 - f7M.x) * f7rub);
    col = f7Fold(col, crest);
    { float f7l = dot(col, vec3(0.2126, 0.7152, 0.0722)); col = mix(col, vec3(f7l) * 1.05 + 0.004, f7M.y * f7up * f7up); }
  }
`;
const F7_RIM_DIRECT = `
    { float nv7 = clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0), rm7 = pow(1.0 - nv7, 4.0);
      reflectedLight.directDiffuse += directLight.color * f7L.y * rm7 * (0.1 + 0.9 * smoothstep(0.0, 0.6, dot(geometryNormal, directLight.direction))) * (material.diffuseColor * 0.55 + 0.02) * RECIPROCAL_PI * 0.8; }`;

const A = {
  pars: 'float fI(float x, float d){',                       // after c1's globals (gIn, gNap ...): f7Rim reads gIn
  st: /float st = \(vn3\(vec3\(qe\.x \* 0\.25[\s\S]*?fFade\(fq\.x \* 0\.07, 0\.3, 0\.7\);/,
  col: 'vec3 col = mix(warpC, weftC * (1.0 + 0.5 * fW1.w * yv), clamp(weftV, 0.0, 1.0)) * (1.0 - darkK);',
  yarn: 'aY = fFade(max(fq.x, fq.y), 0.3, 0.75) * (1.0 - 0.75 * f6Y2.y);',
  wet: 'col *= 1.0 - 0.3 * cWet;',
  diff: 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );\n  reflectedLight.directDiffuse += dotNL * gFluor',
  asp: '( material.diffuseColor * 0.6 + 0.03 * gNap ); }',
  ymix: 'col = mix(col, col * det / max(mean, vec3(1e-4)), aY);',   // lod: where rev 6's yarn layer sets the colour (aY in scope)
  ht: 'float ht = (vn3(b * 90.0 + cSeed * 3.0) - 0.5) * fFade(pxm * 90.0, 0.3, 0.7) + 0.6 * (vn3(b * 22.0 + cSeed) - 0.5);',
  seam6: '#if defined(F6_ON) && defined(F6_ATTR)\n  if (f6A.w < 0.5) col = mix(col, fSeam.rgb, sk * stitch * 0.8);',   // where rev 6's seam / hem construction block starts
  ibl: 'diffuse * cosineWeightedIrradiance * gOcc +',
  idl: 'irradiance * BRDF_Lambert( material.diffuseColor ) * gOcc +',
};
// the rev-7 program from the rev-6 one (sh: three's shader object after rev 6's own onBeforeCompile)

// the rev-7 program from the rev-6 one (sh: three's shader object after rev 6's own onBeforeCompile)
export function patch7(sh, O = OPTS) {
  let fs = sh.fragmentShader; const AT = O.atlas ? ATLAS7 : null;
  const need = (k, ok) => { if (!ok) throw new Error(`fabric7: anchor '${k}' not found (fabric_glsl.js or fabric6.js changed)`); };
  for (const k of Object.keys(A)) if (k !== 'seam6') need(k, A[k] instanceof RegExp ? A[k].test(fs) : fs.includes(A[k]));
  fs = fs.replace(A.pars, F7_PARS + (AT ? 'uniform vec4 f7M;\n' : '') + F7_LOD_PARS + A.pars);
  fs = fs.replace(A.ymix, A.ymix + '\n      col *= f7Lod(aY);   // lod: the yarn layer keeps the unresolved cloth\'s mean (the slope\'s shading loss, SHADE7)');
  fs = fs.replace(A.st, 'float st = f7G.w * (vn3(vec3(qe.x * 0.5, qe.y * 0.03, cSeed + 1.0)) - 0.5) * fFade(fq.x * 0.5, 0.3, 0.7);   // rev 7: the residual lanes (denim\'s striation: 2 threads wide, ~2 cm long)');
  // c1's heather mottle (4.5 cm and 1.1 cm value noise) sampled the pattern coordinate unrotated: on a sewn garment b = (u, v, panel), a PLANE, so the lattice's own axes drew a
  // plaid on every heather tee in Cycles (the atlas bake) and the engine: sample it through FROT (the rotation fabric_glsl.js already uses off the body's axes)
  fs = fs.replace(A.ht, 'float ht = (vn3(FROT * b * 90.0 + cSeed * 3.0) - 0.5) * fFade(pxm * 90.0, 0.3, 0.7) + 0.6 * (vn3(FROT * b * 22.0 + cSeed) - 0.5);   // rev 7: off the lattice\'s axes');
  if (AT && +AT.heatherCm !== 1) fs = fs.replace("0.6 * (vn3(FROT * b * 22.0 + cSeed) - 0.5);   // rev 7: off the lattice's axes", `${(0.6 * clamp(+AT.heatherCm, 0, 1)).toFixed(3)} * (vn3(FROT * b * 22.0 + cSeed) - 0.5);   // rev 7: off the lattice's axes; the atlas: the 4.5 cm octave x ${clamp(+AT.heatherCm, 0, 1).toFixed(2)}`);
  fs = fs.replace(A.col, A.col + '\n  col *= max(1.0 + f7Grain(qe, fq, fFade(max(fq.x, fq.y), f7Y.x, f7Y.y) * (1.0 - 0.75 * f6Y2.y)), 0.4);   // rev 7: the grain (isotropic, by the cells a sample covers; the yarn layer\'s weight is subtracted)');
  fs = fs.replace(A.yarn, 'aY = fFade(max(fq.x, fq.y), f7Y.x, f7Y.y) * (1.0 - 0.75 * f6Y2.y);');
  // the tone block goes BEFORE rev 6's seam / hem construction (stitch rows and needle holes keep their own colour); where that anchor is missing (no F6 attributes) it stays where it was
  const tone = AT && AT.cloudMask ? F7_TONE_MASK : F7_TONE;
  if (fs.includes(A.seam6)) fs = fs.replace(A.seam6, () => tone + A.seam6); else fs = fs.replace(A.wet, tone + '  ' + A.wet);
  if (AT && +AT.stitchHalfMm !== 0.42 && fs.includes('tw = 0.00042;')) fs = fs.replace('tw = 0.00042;', `tw = ${(clamp(+AT.stitchHalfMm, 0.2, 1.5) / 1000).toFixed(5)};   // the atlas: the stitch row's half-width ${(+AT.stitchHalfMm).toFixed(2)} mm (rev 6: 0.42)`);
  fs = fs.replace(A.diff, 'reflectedLight.directDiffuse += f7Diffuse( directLight.direction, geometryNormal, directLight.color, material.diffuseColor, dotNL );\n  reflectedLight.directDiffuse += dotNL * gFluor');
  fs = fs.replace(A.asp, A.asp + F7_RIM_DIRECT);
  fs = fs.replace(A.ibl, 'diffuse * cosineWeightedIrradiance * gOcc * f7Rim( geometryNormal, geometryViewDir ) +');
  fs = fs.replace(A.idl, 'irradiance * BRDF_Lambert( material.diffuseColor ) * gOcc * f7Rim( geometryNormal, geometryViewDir ) +');
  sh.fragmentShader = fs;
}

// ---------------------------------------------------------------- the extension (fabric6.js hook6 calls it after rev 6's own, for each rev-6 fabric material)
function hook7(mat, info) {
  if (!ON) return;
  const U = mat.uniforms_c6, O = { ...OPTS }, key0 = mat.customProgramCacheKey(), L = look7(info.fabric);
  Object.assign(U, uniforms7(info.fabric, O));
  if (O.atlas && U.f6T) U.f6T = { value: U.f6T.value.clone().multiplyScalar(clamp(ATLAS7.threadGain, 0.3, 1.5)) };   // in the atlas the stitch thread (rev 6: the dye x 0.82) is drawn darker, so a row of 1.2 mm survives Cycles' bilinear fetch and pixel filter
  U.fRgh.value.w *= L.sheen; mat.sheen = U.fRgh.value.w; mat.sheenRoughness = clamp(mat.sheenRoughness * L.sheenR, 0.2, 1);
  mat.defines = { ...(mat.defines || {}), F7_ON: 1 };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => { prev(sh, r); Object.assign(sh.uniforms, U); patch7(sh, O); };
  mat.customProgramCacheKey = () => key0 + '-f7' + (O.atlas ? 'A' : 'E');
  mat.userData.fabric7 = { fabric: info.fabric, version: FABRIC7_VERSION, atlas: !!O.atlas, cascade: !!O.cascade };
}

// The Cycles record of rev 7 (labs/clothing2/fabric7_texbake.mjs writes it as <export>/fabric6.json, the file blender/person_scene.py's fabric6_record reads): rev 6's record with the sheen weight and
// roughness taken to rev 7's (LOOKS7: the weight x sheen, the roughness x sheenR: Principled's sheen then reads on crests as the engine's does), plus the rev-7 look under f7. The tone cloud and grain are in the
// atlas the same texbake draws: the garment atlas carries rev 7's colour.
export async function cycles7(fabrics) {
  const r = await cycles6(fabrics); r.version7 = FABRIC7_VERSION; r.atlas7 = fabric7Used();
  for (const f of Object.keys(r.fabrics)) { const L = look7(f), o = r.fabrics[f]; o.sheen = [+(o.sheen[0] * L.sheen).toFixed(4), +clamp(o.sheen[1] * L.sheenR, 0.2, 1).toFixed(4), o.sheen[2]]; o.f7 = { grain: L.grain, cloud: L.cloud, crest: L.crest, wrap: L.wrap, rim: L.rim }; }
  return r;
}
