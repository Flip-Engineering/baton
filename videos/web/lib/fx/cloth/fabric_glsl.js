// FABRIC GLSL (CLOTHING c1): the surface of every garment from what it is made of (lib/fx/cloth/fabrics.js LOOKS), for hero.js
// (o.cloth) and the fabric book (swatch.js), one path for both. hero.js keeps its cuts and construction (hems, collars, pockets,
// tape, boots); everything a fabric decides comes from here. Opt-in: a material built without it renders as before.
//
// What reads at each distance (a figure ~400 px tall in a row is ~4.4 mm a pixel; a bust ~0.7 mm; a face close-up ~0.3 mm):
//   weave       the construction on the face (twill floats, plain crossings, knit loops, birdseye holes, leather grain) as BOX-
//               FILTERED pulse trains over the pixel's footprint in thread units (the exact integral of a pulse, so a twill's float
//               pattern turns into its warp/weft average instead of aliasing: clamping by bandwidth, Norton, Rockwood and Skolmoski,
//               "Clamping: a method of antialiasing textured surfaces by bandwidth limiting in object space", SIGGRAPH 1982).
//               What survives the filter is what a person sees at a distance: the mean of warp and weft (denim's lighter blue,
//               chambray's heather), the warp streaks (slub, ring-dye) at a few mm, a plaid at cm.
//   fibre lobe  Kajiya and Kay (1989) about the float direction: the directional highlight a twill throws. The direction is the
//               surface gradient of the material coordinate along the warp, from screen derivatives (so it follows a drape),
//               tilted by the twill angle. Measured anisotropy from the Poly Haven scans (fabrics.js header) sets the strength.
//   sheen       three's Charlie sheen (Estevez and Kulla 2017) per fabric, coloured by the surface it sits on, raised where abrasion
//               raises the nap; asperity (Koenderink and Pont 2003) scaled by the fabric's nap (velvety flannel rims, none on hide).
//   fluorescence hi-vis returns more light in its band than a white diffuser: the fluoresced share is excited by the light's
//               blue-green (fEx), so a sodium lamp shows an ordinary yellow and daylight or metal halide makes it glow.
//   leather     saturated albedo (the scan's brown, not the dye pushed to pink by a white specular), a finish coat (clearcoat),
//               grain and its roughness spread (scan sd 0.15), creases that lighten, oil that darkens and glosses.
//   wear        by fibre and construction, in material coordinates: indigo abrades to its white core at fold crests, seams, the
//               hem stack and the knee, whiskers at the lap, honeycombs behind the knee; duck pales and frays at pocket mouths
//               and cuffs; poly-cotton soils at knees and cuffs; leather oils where hands go; hi-vis soils grey-brown and its
//               fluorescence fades on the shoulders. Soil is a dust or grime LAYER with its own albedo and a grainy coverage
//               (light on dark cloth, dark on light), not a dark multiply (the c6 blotches read as bruises).
//   inside      a back face (!gl_FrontFacing) is the inside of the garment: the back of the weave (denim's weft side) or a lining,
//               no sheen, specular or asperity, lit only through the cloth (its transmission, by weight) and a little through
//               the opening near a hem, its ambient occluded. Into a low sun a sleeve end stops glowing.
//   folds       the painted fold field at the wavelength the fabric's Peirce bending length gives (lambda = 2.8 c: jersey
//               ~2.6 cm, denim ~7 cm, duck ~10 cm), centred on the joints (no region switch inside a triangle: the c6 elbow
//               zig-zag), the slope capped per pixel footprint, sub-pixel wrinkles dropped. Under CLOTH_FOLD (the drape's
//               aFold, signed curvature x bending length) the real folds carry the shape and the crests drive wear.
//   drape       CLOTH_REST: aRest (the undraped bind position) is the material coordinate, so weave, seams and wear stay on the cloth.
//
//   import { fabricPack, fabricMaterial } from './fabric_glsl.js';
//   fabricPack('denim', '#34486a') -> { uniforms, params, numbers }           // the look as uniform values + material params
//   fabricMaterial({ fabric, color, color2, uniforms, glsl, key })            // a MeshPhysicalMaterial with the fabric path
import * as THREE from 'three';
import { FABRICS, LOOKS, phys } from './fabrics.js';

const WEAVE = { plain: 0, twill: 1, duck: 2, jersey: 3, rib: 4, mesh: 5, leather: 6, felt: 7 };
const FIBRE = { pc: 0, indigo: 1, duck: 2, leather: 3, hivis: 4, knit: 5 };
const lin = hex => new THREE.Color(hex);                     // THREE.Color from a hex is linear (ColorManagement on)
const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

// the look of `name` in garment colour `hex` (the warp's dye), as shader numbers. The weft, core and lining are the fabric's own.
export function fabricPack(name, hex = '#808080', o = {}) {
  const F = FABRICS[name] || FABRICS.twillPC, L = LOOKS[name] || LOOKS.twillPC, P = phys(F), W = L.weave, Wr = L.wear || {};
  let dye = lin(hex);
  { const l = lum(dye), [s, v] = L.dye || [1, 1]; dye = new THREE.Color(l + (dye.r - l) * s, l + (dye.g - l) * s, l + (dye.b - l) * s).multiplyScalar(v);
    dye.r = Math.max(0, dye.r); dye.g = Math.max(0, dye.g); dye.b = Math.max(0, dye.b); }
  let flu = new THREE.Color(0, 0, 0), ex = new THREE.Vector3(1 / 3, 1 / 3, 1 / 3);
  if (L.fluor) { const [r, g, b] = L.fluor.col, f = L.fluor.f; dye = new THREE.Color(r * (1 - f), g * (1 - f), b * (1 - f)); flu = new THREE.Color(r * f, g * f, b * f);
    const e = L.fluor.ex, s = e[0] + e[1] + e[2]; ex = new THREE.Vector3(e[0] / s, e[1] / s, e[2] / s); }
  const weft = W.weft ? lin(W.weft) : dye.clone();
  const core = Wr.core ? lin(Wr.core) : dye.clone().lerp(new THREE.Color(0.62, 0.6, 0.56), 0.55);
  const [inMix, inOcc] = L.inside || [0.4, 0.3];
  const back = L.lining ? lin(L.lining) : dye.clone().lerp(weft, inMix).multiplyScalar(0.85);
  // light through the cloth to its inside: by weight (a 120 g knit lets through ~10x what 14 oz denim does), more through mesh
  const trans = (F.construction === 'leather' || F.construction === 'suede') ? 0 : 0.3 * Math.exp(-F.gsm / 110) + (W.kind === 'mesh' ? 0.08 : 0);
  const thread = L.seam?.thread ? lin(L.seam.thread) : dye.clone().multiplyScalar(0.8);
  const [shA, shR, shT] = L.sheen || [0.2, 0.6, 0.2], [anA, anE, anT] = L.aniso || [0, 1, 0];
  const lobeTint = L.fluor ? 0.25 : Math.min(1, shT + 0.25);
  const U = {
    fW0: new THREE.Vector4(WEAVE[W.kind] ?? 0, W.epc || 20, W.ppc || 20, W.dir ?? 1),
    fW1: new THREE.Vector4(W.over || 1, W.under || 1, W.weftShow ?? 0, W.contrast ?? 0.1),
    fW2: new THREE.Vector4(W.slub || 0, W.plaid || 0, W.heather ?? (W.contrast || 0) * 0.5, anT || 0),
    fPh: new THREE.Vector4(P.c, P.h, F.gsm, trans),
    fRgh: new THREE.Vector4(L.rough[0], L.rough[1], L.nap ?? 0.5, shA),
    fShn: new THREE.Vector4(shT, anA, Math.max(1, anE), lobeTint),
    fFlu: flu, fEx: ex, fWeft: weft,
    fWr: new THREE.Vector4(FIBRE[Wr.fibre] ?? 0, Wr.abr ?? 0.5, Wr.soil ?? 0.5, Wr.oil ?? 0),
    fWr2: new THREE.Vector4(Wr.whisker ?? 0, Wr.pill ?? Wr.fray ?? 0, Wr.crease ?? 0, Wr.fade ?? 0.2),
    fCore: core, fLin: back, fIn: new THREE.Vector4(inMix, 0.35, trans, inOcc),
    fSeam: new THREE.Vector4(thread.r, thread.g, thread.b, L.seam?.k ?? 0.5),
  };
  const sheenColor = dye.clone().lerp(new THREE.Color(1, 1, 1), shT);
  const params = { spec: L.spec ?? 1, color: dye, roughness: L.rough[0], sheen: shA, sheenRoughness: shR, sheenColor, clearcoat: L.finish ? L.finish[0] : 0, clearcoatRoughness: L.finish ? L.finish[1] : 0.3 };
  const albedo = dye.clone().lerp(weft, W.weftShow ?? 0);
  const numbers = { fabric: name, c_cm: +(P.c * 100).toFixed(2), lambda_cm: +(P.c * 280).toFixed(1), gsm: F.gsm, albedo: [albedo.r, albedo.g, albedo.b].map(x => +x.toFixed(3)), Y: +lum(albedo).toFixed(3),
    rough: L.rough[0], sheen: shA, lobe: anA, nap: L.nap, fluorY: +lum(flu).toFixed(3), trans: +trans.toFixed(3), clearcoat: params.clearcoat };
  return { uniforms: Object.fromEntries(Object.entries(U).map(([k, v]) => [k, { value: v }])), params, numbers };
}

// ---------------------------------------------------------------- GLSL
// vertex: the drape's attributes (only when it wrote them)
export const FAB_VERT_PARS = `
#ifdef CLOTH_REST
attribute vec3 aRest; varying vec3 vRest;
#endif
#ifdef CLOTH_FOLD
attribute float aFold; varying float vFold;
#endif
#ifdef FAB_UVQ
varying vec2 vFabUV;
#endif
#ifdef FAB_WARP
attribute vec3 aWarp;
#endif
uniform vec3 fLimbD[4]; varying vec3 vFabT;`;
export const FAB_VERT = `
#ifdef CLOTH_REST
vRest = aRest;
#endif
#ifdef CLOTH_FOLD
vFold = aFold;
#endif
#ifdef FAB_UVQ
vFabUV = uv;
#endif
{ // the warp's direction in bind space (torso: up; limbs: along the limb's bind axis), skinned, in view space: smooth per vertex
#ifdef FAB_WARP
  vec3 fW = aWarp;
#else
  bool ar = aHero.x > 2.5 && aHero.x < 6.5, lg = aHero.x > 7.5 && aHero.x < 10.5;
  vec3 fW = ar ? fLimbD[aHero.z > 0.0 ? 0 : 1] : lg ? fLimbD[aHero.z > 0.0 ? 2 : 3] : vec3(0.0, 1.0, 0.0);
  if (ar || lg) fW = normalize(mix(vec3(0.0, 1.0, 0.0), fW * sign(fW.y + 1e-3), smoothstep(0.02, 0.3, aHero.y)));   // one sense (the lobe is symmetric): opposite senses interpolated through zero   // turns from the body's vertical into the limb's axis past the armhole / hip (the region boundary is jagged)
#endif
#ifdef USE_SKINNING
  fW = (skinMatrix * vec4(fW, 0.0)).xyz;
#endif
  vFabT = normalize((modelViewMatrix * vec4(fW, 0.0)).xyz); }`;
// fragment declarations (after the hero cloth pars: vHero, vBind, vBN, the c6 uniforms, NOISE)
export const FAB_PARS = `
uniform vec4 fW0, fW1, fW2, fPh, fRgh, fShn, fWr, fWr2, fIn, fSeam, fRad; uniform vec3 fFlu, fEx, fCore, fLin, fWeft; uniform vec2 fLen; uniform float cOpen;
uniform vec3 fLimbO[4], fLimbD[4], fLimbE[4]; varying vec3 vFabT;
#ifdef CLOTH_REST
varying vec3 vRest;
#endif
#ifdef CLOTH_FOLD
varying float vFold;
#endif
#ifdef FAB_UVQ
varying vec2 vFabUV;
#endif
vec3 gT = vec3(0.0, 1.0, 0.0), gAniC = vec3(1.0), gSheenC = vec3(0.0);
vec3 gDbg = vec3(0.0);
float gIn = 0.0, gOpen = 0.0, gNap = 1.0, gAni = 0.0, gFluor = 1.0, gFoldH = 0.0, gRelief = 0.0, gOcc = 1.0, gCC = 1.0, gAng = 0.0;
float fI(float x, float d){ return floor(x) * d + max(fract(x) - 1.0 + d, 0.0); }                             // integral of a pulse train (duty d)
float fPulse(float x, float d, float w){ w = max(w, 1e-4); return (fI(x + 0.5 * w, d) - fI(x - 0.5 * w, d)) / w; } // its exact box filter over w
float fFade(float w, float a, float b){ return 1.0 - smoothstep(a, b, w); }
vec3 fabP(){
#ifdef CLOTH_REST
  return vRest;
#else
  return vBind;
#endif
}
// the material coordinate in metres: x round the body or the limb (the warp ends), y along it (the warp). Torso: round the body's
// axis (the wrap is the centre back seam); limbs: round the limb's bind axis (the wrap is the underarm / inseam)
vec2 fabQ(vec3 p, float reg, float sd){
#ifdef FAB_UVQ
  gAng = vFabUV.x / 0.15; return vFabUV;
#else
  bool ar = reg > 2.5 && reg < 6.5, lg = reg > 7.5 && reg < 10.5;
  if (ar || lg) { int i = (ar ? 0 : 2) + (sd > 0.0 ? 0 : 1); vec3 d = fLimbD[i], e1 = fLimbE[i], q = p - fLimbO[i]; float u = dot(q, d); q -= d * u;
    gAng = atan(dot(q, cross(d, e1)), dot(q, e1)); return vec2(gAng * (ar ? fRad.x : fRad.y), -u); }
  gAng = atan(p.x, p.z - fRad.w); return vec2(gAng * fRad.z, p.y);
#endif
}
vec3 fabWarp(float reg, float sd){ bool ar = reg > 2.5 && reg < 6.5, lg = reg > 7.5 && reg < 10.5; return ar ? fLimbD[sd > 0.0 ? 0 : 1] : lg ? fLimbD[sd > 0.0 ? 2 : 3] : vec3(0.0, 1.0, 0.0); }
mat3 FROT = mat3(0.788, -0.394, 0.473, 0.577, 0.788, -0.212, -0.21, 0.473, 0.856);   // a rotation: value noise's lattice off the body's axes
// the painted fold field: h in metres and its analytic gradient in the material coordinate (gFoldG, m per m). Each fold is a train
// of sines in (q.x round, q.y along); its slope is taken from the formula and carried to view space by the coordinate's own (smooth)
// screen derivatives in FAB_NORMAL. The c6 bump differentiated h itself in screen space: constant over each 2x2 pixel quad, so a steep
// fold drew stair-stepped stripes (the elbow zig-zag). Returns the crest signal (-1 valley .. 1 crest).
vec2 gFoldG = vec2(0.0); vec2 gQ = vec2(0.0); float gFine = 0.0;
void fTrain(inout float h, float w, float k, float a, float c, vec2 q, float p){ float ph = k * (a * q.x + c * q.y) + p; h += w * sin(ph); gFoldG += w * cos(ph) * k * vec2(a, c); }
float fabFold(vec3 b, float reg, float along, float sd, vec3 bn, vec2 q, float pxm, int PT){
  float lam = 2.8 * fPh.x, k0 = 6.2832 / lam, A = 0.06 * lam;
  float armW = smoothstep(2.5, 2.95, reg) * (1.0 - smoothstep(4.05, 4.5, reg)), legW = smoothstep(7.5, 7.95, reg) * (1.0 - smoothstep(9.05, 9.5, reg));
  float torW = (1.0 - armW) * (1.0 - legW);
  float eF = sd > 0.0 ? cFlex.x : cFlex.y, kF = sd > 0.0 ? cFlex.z : cFlex.w, hF = sd > 0.0 ? cFlex2.x : cFlex2.y;
  float nz = vn3(b * (2.5 / lam) + 4.0) - 0.5, h = 0.0;
  // elbow and knee: centred on the joint (along = 1) on both sides of the region seam; the inside of the bend stacks rings across
  // the limb, the outside stretches into long diagonals
  float dA = (along - 1.0) * fLen.x, inA = clamp(bn.z * 0.8 + 0.4, 0.0, 1.0), eE = armW * exp(-dA * dA / 0.008) * (0.1 + 1.2 * eF);
  fTrain(h, eE * inA, k0 * 1.5, 0.0, 1.0, q, nz * 4.0); fTrain(h, eE * (1.0 - inA) * 0.6, k0 * 0.7, 0.6, 1.0, q, nz * 5.0);
  float dK = (along - 1.0) * fLen.y, bk = clamp(-bn.z * 0.8 + 0.4, 0.0, 1.0), kE = legW * exp(-dK * dK / 0.01) * (0.1 + 1.2 * kF);
  fTrain(h, kE * bk, k0 * 1.5, 0.0, 1.0, q, nz * 4.0); fTrain(h, kE * (1.0 - bk) * 0.6, k0 * 0.7, 0.5, 1.0, q, nz * 5.0);
  // the hip crease when the thigh comes up
  fTrain(h, legW * hF * 1.2 * exp(-pow(along * fLen.y, 2.0) / 0.006) * clamp(bn.z, 0.0, 1.0), k0, 0.8 * sign(q.x), 1.4, q, nz * 5.0);
  // the trouser break over the boot and the sleeve bunched at the cuff: rings stacking toward the hem
  float hb = legW * smoothstep(cHem.y - 0.35, cHem.y - 0.04, along), cb = armW * smoothstep(cHem.x - 0.3, cHem.x - 0.03, along);
  fTrain(h, 0.7 * hb + 0.6 * cb, k0 * 1.3, 0.2, 1.0, q, nz * 5.0);
  // a tucked top blouses into the waistband: soft vertical folds gathered round the body
  if (PT == 0 && cVest.x < 0.5 && cHem2.z > 0.5) fTrain(h, 0.8 * torW * smoothstep(cHem2.y - 0.01, cHem2.y + 0.03, b.y) * (1.0 - smoothstep(cHem2.y + 0.05, cHem2.y + 0.13, b.y)), k0 * 1.2, 1.0, 0.0, q, nz * 4.0);
  // gravity: long shallow vertical folds where cloth hangs (trouser legs below the knee, the body of a top below the chest)
  fTrain(h, 0.3 * (legW * smoothstep(1.0, 1.4, along) + torW * (cVest.x > 0.5 ? smoothstep(cVest.z, cVest.z - 0.1, b.y) : smoothstep(0.15, 0.45, -bn.y))), k0 * 0.8, 1.0, 0.0, q, nz * 6.0 + b.y * 2.0);
  float sc = A * cFoldK * (1.0 + 0.5 * cWear);
#ifdef CLOTH_FOLD
  sc *= 0.35;                                                        // the drape made the real folds; the painted ones only add what the mesh is too coarse for
#endif
  gFoldH = h * sc; gFoldG *= sc; gQ = q;
  // fine wrinkles (lambda / 4) everywhere, shallow, dropped as they near the pixel
  gFine = ((vn3(FROT * b * (9.0 / lam) + cSeed) - 0.5) * 0.04 + (vn3(FROT * b * (4.0 / lam) + 2.0) - 0.5) * 0.06) * A * fFade(pxm * 9.0 / lam, 0.25, 0.5);
  return clamp(h / 0.8, -1.0, 1.0);
}`;

// the surface: replaces hero.js's per-kind block. In scope from hero.js's cut section: b, reg, along, K, PT, arm, leg, hemBand,
// belt, btn, pocket, nz. Defines what hero.js's construction section reads: n1, n2, col, pRough.
export const FAB_SURFACE = `
  if (PT == 2 && reg > 4.5 && reg < 6.5) belt = 0.0;                // gloves: hero.js's boot-sole flag (aHero.w) read the hands' dorsal value and striped them black
  float pxm = max(length(dFdx(vViewPosition)), length(dFdy(vViewPosition)));      // the pixel's footprint on the surface, m
  vec2 q = fabQ(b, reg, vHero.z);
  vec2 qe = q * vec2(fW0.y, fW0.z) * 100.0, fq = fwidth(qe);                      // in threads (x = warp ends across, y = picks along) and per pixel
  float n1 = vn3(b * 400.0), n2 = fbm3(b * 25.0 + cSeed);
  int WK = int(fW0.x + 0.5);
  float per = max(fW1.x + fW1.y, 1.0), att = fFade(max(fq.x, fq.y), 0.35, 0.8), attx = fFade(fq.x, 0.35, 0.8);
  float weftV = fW1.z, relief = 0.0, darkK = 0.0;
  if (WK == 1) {                                                     // twill: the floats step one pick per end; box-filtered, it is its own average far away
    float s = (qe.x + fW0.w * qe.y) / per, f = fPulse(s, fW1.x / per, fwidth(s));
    weftV = (1.0 - f) * fW1.z / (fW1.y / per);
    relief = (f - fW1.x / per) * att + 0.3 * sin(6.2832 * qe.x) * fFade(fq.x, 0.25, 0.5);
  } else if (WK == 0 || WK == 2) {                                   // plain (duck: paired warp ends)
    float ex = WK == 2 ? qe.x * 0.5 : qe.x, ck = cos(3.14159 * ex) * cos(3.14159 * qe.y) * fFade(max(fq.x * (WK == 2 ? 0.5 : 1.0), fq.y), 0.3, 0.7);
    weftV = fW1.z * (1.0 - ck); relief = ck * 0.5 + 0.25 * sin(6.2832 * qe.x) * fFade(fq.x, 0.25, 0.5);
  } else if (WK == 3) {                                              // jersey: wales of V-shaped loops
    float lg = abs(fract(qe.y) - 0.5) - 0.25; relief = 0.6 * sin(6.2832 * (qe.x * 2.0 + lg * 1.2 * sign(fract(qe.x) - 0.5))) * fFade(fq.x * 2.0, 0.3, 0.6) + 0.3 * sin(6.2832 * qe.y) * fFade(fq.y, 0.3, 0.6);
  } else if (WK == 4) {                                              // 1x1 rib: the purl columns sit back in shadow
    float rb = fPulse(qe.x * 0.5, 0.5, fq.x * 0.5); darkK = 0.2 * (1.0 - rb); relief = (rb - 0.5) * 1.6;
  } else if (WK == 5) {                                              // birdseye mesh: holes on a grid (the shirt shows dark through them)
    float ho = fPulse(qe.x + 0.5, 0.32, fq.x) * fPulse(qe.y + 0.5, 0.32, fq.y); darkK = 0.6 * ho; relief = -ho;
  } else if (WK == 6) {                                              // leather: grain (pores and pebbles), the hide's own variation
    float g1 = vn3(b * fW0.y * 100.0), g2 = vn3(b * fW0.y * 28.0 + 3.0);
    float gr = mix(0.5, g1, fFade(pxm * fW0.y * 100.0, 0.3, 0.7)) * 0.5 + mix(0.5, g2, fFade(pxm * fW0.y * 28.0, 0.3, 0.7)) * 0.5;
    relief = (gr - 0.5) * 2.0; darkK = 0.12 * smoothstep(0.55, 0.3, gr) * fFade(pxm * fW0.y * 28.0, 0.3, 0.7);
  } else {                                                           // felt / suede: fibres, no structure
    relief = (vn3(b * 1800.0) - 0.5) * fFade(pxm * 1800.0, 0.3, 0.7) * 2.0;
  }
  // yarn to yarn and the streaks of the warp (slub, ring-dye) at three widths, each faded by its own footprint; heather at ~1 cm
  float yv = (vn3(vec3(floor(qe.x) * 0.37, qe.y * 0.02, cSeed)) - 0.5) * attx;
  float st = (vn3(vec3(qe.x * 0.25, qe.y * 0.006, cSeed + 1.0)) - 0.5) * fFade(fq.x * 0.25, 0.3, 0.7)
           + 0.8 * (vn3(vec3(qe.x * 0.07, qe.y * 0.0025, cSeed + 2.0)) - 0.5) * fFade(fq.x * 0.07, 0.3, 0.7);
  float ht = (vn3(b * 90.0 + cSeed * 3.0) - 0.5) * fFade(pxm * 90.0, 0.3, 0.7) + 0.6 * (vn3(b * 22.0 + cSeed) - 0.5);
  vec3 warpC = cA * (1.0 + fW1.w * 1.6 * yv + fW2.x * 1.4 * st + fW2.z * ht);
  vec3 weftC = WK <= 2 ? fWeft : cA;
  vec3 col = mix(warpC, weftC * (1.0 + 0.5 * fW1.w * yv), clamp(weftV, 0.0, 1.0)) * (1.0 - darkK);
  if (fW2.y > 0.0) {                                                 // a plaid (flannel): dark bands and accent lines, box-filtered at their own period
    vec2 g = q / fW2.y + cSeed, gw = fwidth(g);
    float sx = fPulse(g.x, 0.45, gw.x), sy = fPulse(g.y, 0.45, gw.y), lx = fPulse(g.x + 0.2, 0.06, gw.x), ly = fPulse(g.y + 0.2, 0.06, gw.y);
    col *= 1.0 - 0.45 * sx - 0.45 * sy + 0.25 * sx * sy; col = mix(col, cB, 0.55 * max(lx, ly)); }
  float pRough = clamp(fRgh.x + fRgh.y * (2.0 * yv + 0.6 * relief * att + (WK == 6 ? 0.6 * relief : 0.0)), 0.25, 1.0);
  gRelief = relief * fPh.y * 0.2;
  // the float direction: the warp's skinned bind direction (vertex shader, smooth), laid into the shading tangent plane and turned by the
  // twill angle. (From screen derivatives of the material coordinate it was constant per triangle: the highlight drew the mesh's facets.)
  { vec3 Nv = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0), T = vFabT;
    if (dot(T, T) < 1e-24) T = cross(Nv, vec3(1.0, 0.0, 0.0));
    T = normalize(T - Nv * dot(Nv, T) + 1e-6); vec3 Bt = cross(Nv, T); float tl = fW2.w * fW0.w; gT = normalize(T * cos(tl) + Bt * sin(tl)); }
  float crest = fabFold(b, reg, along, vHero.z, vBN, q, pxm, PT);
  // distance to the nearest seam (limbs: the outseam at 0 and the inseam at pi; the body: the side seams), and the stitch's footprint
  float sx = arm || leg ? min(abs(gAng), 3.14159 - abs(gAng)) * (arm ? fRad.x : fRad.y) : abs(abs(gAng) - 1.5708) * fRad.z;
  float sxw = fwidth(sx / 0.009), syw = fwidth(q.y / 0.003);
#ifdef CLOTH_FOLD
  crest = clamp(vFold + 0.4 * crest, -1.0, 1.0);
#endif
  gNap = fRgh.z; gAni = fShn.y; gAniC = mix(col, vec3(dot(col, vec3(0.333))) + 0.5, fShn.w);
  if (PT == 3) {                                                     // the vest's retroreflective tape (construction, from hero.js c6)
    float ax = abs(b.x), y0 = cVest.w;
    float tape = max(smoothstep(0.027, 0.023, abs(b.y - y0 - 0.07)), smoothstep(0.027, 0.023, abs(b.y - y0 - 0.19)));
    tape = max(tape, smoothstep(0.027, 0.023, abs(ax - 0.095)) * step(y0 + 0.19, b.y));
    float glass = smoothstep(0.35, 0.65, vn3(vec3(b.xy * 2400.0, 3.0)));
    col = mix(col, vec3(0.2, 0.21, 0.21) * (0.85 + 0.15 * glass), tape); pRough = mix(pRough, 0.5, tape);
    cRetroMask = tape * (0.8 + 0.2 * glass) * (1.0 - 0.6 * cWear * smoothstep(0.4, 0.8, n2)); gFluor *= 1.0 - tape; gAni *= 1.0 - tape; }
  // how far this point is from an opening (sleeve end, trouser hem, neckline, hems): light reaches the inside only near one
  { float dep = 1.0;
    if (arm) dep = (cHem.x - along) * fLen.x; else if (leg) dep = (cHem.y - along) * fLen.y;
    if (PT == 0 && !arm) dep = min(cHem.w - b.y, b.y - (cVest.x > 0.5 ? cVest.y : cHem2.y));
    if (PT == 1 && !leg) dep = cHem2.x - b.y;
    if (PT == 3) dep = b.y - cVest.w;
    gOpen = max(exp(-max(dep, 0.0) / 0.035), cOpen); }
  if (!gl_FrontFacing && PT != 5) {                                 // the inside: the back of the weave or the lining (a rim is a closed tube: no inside to see)
    gIn = 1.0; col = fLin * (0.9 + 0.2 * (n1 - 0.5)); pRough = 0.9; gOcc = mix(fIn.w, 1.0, max(0.5 * gOpen, cOpen)); }
`;

// wear, soil, sweat, wet and the output: replaces hero.js's dirt + wear + sweat block (closes hero.js's block with the final brace)
export const FAB_WEAR = `
  if (gIn < 0.5) {
    int FB = int(fWr.x + 0.5); float w = cWear;
    float fr = clamp(vBN.z, 0.0, 1.0), bkF = clamp(-vBN.z, 0.0, 1.0), upF = clamp(vBN.y, 0.0, 1.0);
    float dA = (along - 1.0) * fLen.x, dK = (along - 1.0) * fLen.y;
    float gr = vn3(b * 230.0 + cSeed), gr2 = vn3(b * 55.0 + cSeed * 2.0), grain = mix(0.5, gr, fFade(pxm * 230.0, 0.3, 0.7));
    // where a garment is rubbed, by construction (material coordinates)
    float knee = leg ? exp(-dK * dK / 0.0036) * fr : 0.0, bknee = leg ? exp(-dK * dK / 0.003) * bkF : 0.0;
    float lap = leg ? smoothstep(0.0, 0.06, along) * (1.0 - smoothstep(0.22, 0.4, along)) * fr : 0.0;
    float thighW = leg ? smoothstep(0.22, 0.35, along) * (1.0 - smoothstep(0.62, 0.8, along)) * smoothstep(0.3, 0.8, fr) : 0.0;
    float cuff = arm ? smoothstep(cHem.x - 0.22, cHem.x - 0.01, along) : 0.0, hemS = leg ? smoothstep(cHem.y - 0.25, cHem.y - 0.01, along) : 0.0;
    float elbow = arm ? exp(-dA * dA / 0.003) * clamp(-vBN.z * 0.8 + 0.3, 0.0, 1.0) : 0.0;
    float seat = (!arm && !leg && PT == 1) || (leg && along < 0.25) ? bkF * smoothstep(cHem2.x - 0.12, cHem2.x - 0.3, b.y) : 0.0;
    float seamK = exp(-sx * sx / 0.000036) * (arm || leg || PT == 0 || PT == 1 ? 1.0 : 0.0);                       // the side seams, the inseam and outseam
    float edge = max(hemBand, PT == 5 ? 1.0 : 0.0);
    float mouth = PT == 6 ? exp(-pow((b.y - cVest.z + 0.045) / 0.012, 2.0)) : 0.0;                                // patch pocket mouths (coat)
    if (PT == 1 && !leg) { float px = abs(b.x) - 0.07, py = cHem2.x - 0.04 - b.y; mouth = max(mouth, exp(-pow((py - px * 1.4) / 0.008, 2.0)) * step(0.0, px) * step(px, 0.085) * fr); }
    float zoneK = 1.0;                                                                 // c1's zones on bones (the knee, the seat, the elbow, the lap, behind the knee) and their painted stripes (whiskers, honeycombs): rev 6 has none
#ifdef F6_ON
    zoneK = 0.0;                                                                       // where the body works the cloth is fabric7/wear7.js's (the person's own postures on the garment's own strain), and the creased lines are f6Lines' set creases
#endif
    float crestP = smoothstep(0.3, 0.9, crest), valley = smoothstep(0.3, 0.9, -crest);   // the high points of folds, not half of every fold
    float abr = clamp(zoneK * (0.9 * knee + 0.5 * seat + 0.6 * elbow) + 0.7 * cuff * (0.4 + 0.6 * edge) + 0.8 * hemS * (0.3 + 0.7 * crestP) + 0.6 * seamK + 0.7 * crestP + 0.9 * mouth + 0.6 * edge, 0.0, 1.5) * w * fWr.y;
    float wipe = smoothstep(0.55, 0.8, vn3(vec3(q.x * 45.0, along * fLen.y * 6.0, cSeed + 5.0)));                    // hands wiped down the front of the thigh: streaks along the leg
    float soilM = clamp(0.7 * knee + 0.6 * thighW * wipe + 0.7 * cuff + 0.5 * seat + 0.15 * mouth, 0.0, 1.0);
    float dustM = leg ? smoothstep(cHem.y - 0.5, cHem.y + 0.02, along) : PT == 2 ? 0.45 * (1.0 - smoothstep(0.03, 0.12, b.y)) * smoothstep(0.4, 0.7, gr2) : 0.0;   // boots: dust in the welt and on the toe, not a grey coat
    vec3 dust = vec3(0.30, 0.27, 0.22), grime = vec3(0.07, 0.062, 0.052);
    vec3 c0 = col;
    if (FB == 1) {                                                   // indigo: ring-dyed, so abrasion bares the white core, streaky along the warp
      float stw = 0.5 + 1.2 * (vn3(vec3(qe.x * 0.08, qe.y * 0.003, cSeed + 7.0)) - 0.5);
      float whisk = zoneK * lap * fWr2.x * smoothstep(0.9, 0.995, sin((along * fLen.y + abs(q.x) * 0.35) * 6.2832 / 0.04 + gr2 * 1.2) * 0.5 + 0.5) * smoothstep(0.3, 0.6, vn3(vec3(q.x * 12.0, along * 3.0, cSeed))) * 0.35;
      float comb = zoneK * bknee * fWr2.x * smoothstep(0.75, 0.97, sin(dK * 6.2832 / 0.03 + gr2 * 2.0) * 0.5 + 0.5) * smoothstep(0.45, 0.8, vn3(vec3(q.x * 60.0, dK * 20.0, cSeed))) * 0.6;
      float wa = clamp((0.32 * abr * (0.3 + 1.4 * stw) + 0.7 * w * (whisk + comb)) * (0.8 + 0.4 * grain), 0.0, 0.7);   // streaky along the warp, not blotchy
      col = mix(col, fCore * (0.9 + 0.2 * stw), wa);
      col = mix(col, col * 1.25 + 0.01, fWr2.w * w * 0.4 * upF);                                                  // sun fade on what faces up
      pRough = min(1.0, pRough + 0.06 * wa); gNap *= 1.0 + 0.8 * wa;
    } else if (FB == 2) {                                            // duck: pales and goes soft where it is rubbed; frays at pocket mouths and cuffs
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float wa = clamp(abr * (0.7 + 0.6 * grain), 0.0, 0.8);
      col = mix(col, mix(vec3(l), col, 0.6) * 1.6 + 0.02, wa);
      float fray = (mouth + cuff * edge) * fWr2.y * w * smoothstep(0.62, 0.8, vn3(vec3(q.x * 900.0, b.y * 140.0, cSeed))) * fFade(pxm * 900.0, 0.4, 0.9);
      col = mix(col, col * 0.5 + vec3(0.25, 0.23, 0.2), fray * 0.6); pRough = min(1.0, pRough + 0.08 * wa); gNap *= 1.0 + 1.2 * wa;
    } else if (FB == 3) {                                            // leather: oils dark and glossy where hands go; the finish cracks pale on the creases
      float hands = (PT == 6 ? 1.0 : 0.0) + (PT == 0 && !arm ? exp(-pow(b.x / 0.05, 2.0)) * fr * 0.8 : 0.0) + cuff + (PT == 0 && !arm ? smoothstep(cVest.z + 0.05, cVest.z - 0.1, b.y) * fr * 0.6 : 0.0);
      float oil = clamp(hands * fWr.w * w * (0.6 + 0.8 * gr2), 0.0, 1.0);
      col *= 1.0 - 0.38 * oil; pRough = mix(pRough, pRough * 0.7, oil); gCC = 1.0 + 0.8 * oil;
      float cr = clamp(fWr2.z * (0.6 * valley + 0.4 * crestP) * (0.4 + w), 0.0, 1.0) * smoothstep(0.35, 0.7, gr);
      col = mix(col, col * 1.45 + 0.012, cr * 0.7); pRough = mix(pRough, 0.85, cr * 0.6); gCC *= 1.0 - 0.6 * cr;
      col = mix(col, col * 1.3 + 0.01, abr * 0.5 * grain);                                                         // scuffs on the high points
    } else if (FB == 4) {                                            // hi-vis: soils grey-brown; the fluorescence fades in the sun
      gFluor *= 1.0 - fWr2.w * w * (0.35 * upF + 0.15);
      float sm = clamp(0.35 * w * fWr.z * (0.5 + smoothstep(cVest.w + 0.25, cVest.w, b.y)) * smoothstep(0.35, 0.75, gr2 * 0.7 + grain * 0.5), 0.0, 0.7);
      col = mix(col, vec3(0.16, 0.14, 0.11), sm); gFluor *= 1.0 - sm;
    } else if (FB == 5) {                                            // knits and brushed cloth: pills and fuzz where rubbed, fades with washing
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, mix(vec3(l), col, 0.75) * 1.15 + 0.008, fWr2.w * w * 0.6);
      float pill = clamp(abr * fWr2.y * (0.5 + grain), 0.0, 1.0);
      col = mix(col, col * 1.25 + 0.015, pill * 0.5); pRough = min(1.0, pRough + 0.1 * pill); gNap *= 1.0 + 1.5 * pill;
    } else {                                                         // poly-cotton: barely fades, the cotton fuzzes a little; it takes soil
      col = mix(col, col * 1.15 + 0.01, abr * 0.35 * grain); gNap *= 1.0 + 0.5 * abr;
    }
    // soil: a layer with its own colour. Dust climbs the trouser legs and settles on boots; knees, cuffs, the thigh wipe and the
    // seat take ground-in grime. Grainy coverage, so it reads as dirt in the cloth, not a bruise on it.
    float sc = cDirt * fWr.z, cov = clamp(dustM * sc * 1.3 * (0.6 + 0.6 * grain), 0.0, 0.8);
    col = mix(col, dust, cov); pRough = mix(pRough, 0.95, cov * 0.5);
    float gm = clamp(soilM * (sc + 0.4 * w * fWr.z) * smoothstep(0.3, 0.8, grain * 0.7 + gr2 * 0.4), 0.0, 0.6);
    col = mix(col, grime, gm * 0.8); pRough = mix(pRough, 0.7, gm * 0.3);
    // seams: the seam allowance raises a ridge the wear finds first; topstitching in the fabric's thread
    float sk = fSeam.w * seamK * fFade(pxm / 0.004, 0.5, 1.5);
    float stitch = fPulse(sx / 0.009 + 0.25, 0.12, sxw) * fPulse(q.y / 0.003, 0.6, syw);
    col = mix(col, fSeam.rgb, sk * stitch * 0.8);
    if (cSweat > 0.001 && PT == 0 && !arm && FB != 3 && FB != 4) {   // sweat through absorbent cloth: the sternum, between the shoulder blades, the armpits
      float ax = abs(b.x), ch = b.y / max(cHem.w, 0.5);
      float m = exp(-(pow(ax / 0.05, 2.0) + pow((ch - 0.84) / 0.06, 2.0))) * step(0.0, b.z) + exp(-(pow(ax / 0.07, 2.0) + pow((ch - 0.83) / 0.07, 2.0))) * step(b.z, 0.0) + exp(-pow((ax - 0.15) / 0.035, 2.0) - pow((ch - 0.8) / 0.05, 2.0));
      m = clamp(m * smoothstep(0.3, 0.6, fbm3(b * 14.0 + cSeed) + 0.3) * cSweat, 0.0, 1.0);
      col *= 1.0 - 0.22 * m; pRough = mix(pRough, 0.62, m); gNap *= 1.0 - 0.5 * m;
    }
    gSheenC = mix(col, vec3(dot(col, vec3(0.333))) * 0.5 + 0.5, fShn.x) * fRgh.w * clamp(gNap / max(fRgh.z, 0.05), 0.5, 2.5);
  }
  col *= 1.0 - 0.3 * cWet; pRough = mix(pRough, 0.45, cWet);
  diffuseColor.rgb = col; roughnessFactor = pRough;
#ifdef FAB_DEBUG
  gDbg = FAB_DEBUG == 1 ? vec3(0.5 + 0.5 * crest, 0.5 + gFoldH * 100.0, 0.5 + gFine * 1000.0) : FAB_DEBUG == 2 ? abs(gT) : FAB_DEBUG == 4 ? vec3(gIn, gOpen, gOcc) : vec3(fract(q * 10.0), 0.0);
#endif
}`;

// the bump: the fold field + the weave's relief, from screen derivatives, the slope capped per pixel footprint
export const FAB_NORMAL = `
{ vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition), r1 = cross(dy, normal), r2 = cross(normal, dx);
  float det = dot(dx, r1), sdt = sign(det) / max(abs(det), 1e-14);
  vec2 qdx = dFdx(gQ), qdy = dFdy(gQ); float hf = gFine + gRelief;
  vec3 gqx = (qdx.x * r1 + qdy.x * r2) * sdt, gqy = (qdx.y * r1 + qdy.y * r2) * sdt;    // surface gradients of the material coordinate
  if (dot(gqx, gqx) > 16.0) gqx = vec3(0.0); if (dot(gqy, gqy) > 16.0) gqy = vec3(0.0);   // the wrap seam and a region switch: no spike
  vec3 g = gFoldG.x * gqx + gFoldG.y * gqy + (dFdx(hf) * r1 + dFdy(hf) * r2) * sdt; g -= normal * dot(normal, g);   // in the smooth tangent plane (the derivatives lie in each flat triangle's)
  float gl = length(g); if (gl > 0.6) g *= 0.6 / gl;
  normal = normalize(normal - g);
#ifdef FAB_DEBUG
  if (FAB_DEBUG == 3) gDbg = normal * 0.5 + 0.5;
#endif
}`;
// after three builds the material: inside faces have no sheen, specular or finish; elsewhere the sheen follows the surface and wear
export const FAB_MATERIAL = `
#ifdef FAB_DEBUG
material.diffuseColor = vec3(0.0); material.specularColor = vec3(0.0); material.specularF90 = 0.0; totalEmissiveRadiance = gDbg * 0.6;
#endif
if (gIn > 0.5) { material.specularColor = vec3(0.0); material.specularF90 = 0.0;
#ifdef USE_SHEEN
  material.sheenColor = vec3(0.0);
#endif
#ifdef USE_CLEARCOAT
  material.clearcoat = 0.0;
#endif
} else {
#ifdef USE_SHEEN
  material.sheenColor = gSheenC;
#endif
#ifdef USE_CLEARCOAT
  material.clearcoat = clamp(material.clearcoat * gCC, 0.0, 1.0);
#endif
}`;
// RE_Direct: the outside gets Lambert + fluorescence + the fibre lobe + asperity; the inside only what passes through the cloth
// or the opening. (In three's RE_Direct_Physical: dotNL, irradiance, directLight, geometry*, material are in scope.)
const FAB_DIRECT = `
if (gIn > 0.5) {
  float tIn = fIn.z * max(0.0, -dot(geometryNormal, directLight.direction)) + mix(fIn.y, 1.0, cOpen) * gOpen * dotNL;   // cOpen: a back face in the open (the fabric book's turned edge)
  reflectedLight.directDiffuse += tIn * directLight.color * BRDF_Lambert( material.diffuseColor );
} else {
  reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
  reflectedLight.directDiffuse += dotNL * gFluor * dot( directLight.color, fEx ) * BRDF_Lambert( fFlu );
  { vec3 Tl = gT - geometryNormal * dot(geometryNormal, gT); Tl = normalize(Tl + 1e-6); float tl = dot(Tl, directLight.direction), tv = dot(Tl, geometryViewDir);
    float kk = max(0.0, sqrt(max(0.0, 1.0 - tl * tl) * max(0.0, 1.0 - tv * tv)) - tl * tv);
    reflectedLight.directSpecular += directLight.color * gAniC * gAni * 0.12 * pow(kk, fShn.z) * smoothstep(0.0, 0.3, dotNL); }   // peak = strength x 0.12: about the diffuse of a mid-dark cloth at its crest
  { vec3 vA = normalize( geometryViewDir ); float fA = max( 0.0, dot( -vA, directLight.direction ) ); fA = fA * fA * fA * fA * fA * fA;
    float pA = 1.0 / max( abs( dot( geometryNormal, vA ) ), 0.22 ), gA = smoothstep( -0.3, 0.3, dot( geometryNormal, directLight.direction ) );
    reflectedLight.directDiffuse += directLight.color * cAsp * gNap * 0.9 * fA * pA * gA * ( material.diffuseColor * 0.6 + 0.03 * gNap ); }
}`;
const DL = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
const IDL = 'reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
const IBL = 'reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;';
let _lp = null;
function lightsChunk() {
  if (_lp) return _lp;
  const s = THREE.ShaderChunk.lights_physical_pars_fragment;
  if (!s.includes(DL) || !s.includes(IDL) || !s.includes(IBL)) throw new Error('fabric_glsl: three\'s lights_physical_pars_fragment changed');
  return (_lp = s.replace(DL, FAB_DIRECT)
    .replace(IDL, 'reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor ) * gOcc + gFluor * ( 1.0 - gIn ) * fFlu * dot( irradiance, fEx ) * RECIPROCAL_PI;')
    .replace(IBL, 'reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance * gOcc + gFluor * ( 1.0 - gIn ) * fFlu * dot( cosineWeightedIrradiance, fEx );'));
}

// the fabric material. glsl: hero.js's cloth pieces { vertPars, vert, fragPars, head, detail, emissive } (HERO_CLOTH_GLSL); the head's
// `vec3 b = vBind;` becomes the material coordinate (aRest under CLOTH_REST). uniforms: hero.js's per-garment c6 uniforms + hero-level
// fabric uniforms (limb axes); the fabric's own are added here. defines: e.g. { FAB_UVQ: 1 } for a flat swatch with metric uvs.
// CLOTH3 (round 3, opt-in; absent = the source above, byte for byte): sewn (a K2 pattern sewn by K1 and built by K3's finish.js) takes
// hero.js's sewnHead (no bind-space cuts, no painted construction) and no c6 detail; seamD (with sewn): the panel's real seams, from the
// attribute aSeamD (m to the nearest sewn edge in the flat pattern), drive the seam wear and topstitching (the default places a side seam
// at a fixed angle round a hero torso, which on a flat panel's uv drew a stitched line through the middle of every panel); solid (a
// construction part: a closed thin solid, a collar fall, a placket, a binding): a back face is the solid's other side, never the
// garment's inside (its lining colour drew the collar and the open placket pale wherever the sweep's winding came out inward).
const SEWN_SX = '  float sx = arm || leg ? min(abs(gAng), 3.14159 - abs(gAng)) * (arm ? fRad.x : fRad.y) : abs(abs(gAng) - 1.5708) * fRad.z;';
const SEWN_IN = '  if (!gl_FrontFacing && PT != 5) {';
const SEWN_OPEN = '    gOpen = max(exp(-max(dep, 0.0) / 0.035), cOpen); }';
export function fabricMaterial({ fabric, color, color2 = null, uniforms = {}, glsl, key = 'hero-fabric', side = THREE.DoubleSide, defines = null, sewn = false, seamD = false, openD = false, solid = false }) {
  if (sewn) { if (!glsl.sewnHead || !FAB_SURFACE.includes(SEWN_SX) || !FAB_SURFACE.includes(SEWN_IN)) throw new Error('fabric_glsl: no sewn head (hero.js) or the surface changed');
    // openD (with sewn): the attribute aOpenD (m to the nearest FREE edge of the panel: hem, cuff, neckline) sets how open a point is, and
    // the garment's inside (its lining colour) is drawn only within ~10 cm of an opening; a back face deeper in is cloth crossing itself
    // (a fold through its neighbour), drawn as the outside instead of a pale patch of lining (honest: it hides the crossing, not mends it)
    if (!FAB_SURFACE.includes(SEWN_OPEN)) throw new Error('fabric_glsl: the surface changed (open)');
    const surf = FAB_SURFACE.replace(SEWN_SX, seamD ? '  float sx = vSeamD;' : '  float sx = 1.0;').replace(SEWN_IN, solid ? '  if (false) {' : openD ? '  if (!gl_FrontFacing && PT != 5 && gOpen > 0.06) {' : SEWN_IN)
      .replace(SEWN_OPEN, openD ? '    gOpen = exp(-max(vOpenD, 0.0) / 0.035); }' : SEWN_OPEN);
    return fabricMaterial({ fabric, color, color2, uniforms, key: key + '-sewn' + (seamD ? '-seam' : '') + (openD ? '-open' : '') + (solid ? '-solid' : ''), side, defines,
      glsl: { ...glsl, head: glsl.sewnHead, detail: '', vertPars: glsl.vertPars + (seamD ? '\nattribute float aSeamD; varying float vSeamD;' : '') + (openD ? '\nattribute float aOpenD; varying float vOpenD;' : ''),
        vert: glsl.vert + (seamD ? '\nvSeamD = aSeamD;' : '') + (openD ? '\nvOpenD = aOpenD;' : ''),
        fragPars: glsl.fragPars + (seamD ? '\nvarying float vSeamD;' : '') + (openD ? '\nvarying float vOpenD;' : ''), _surface: surf } }); }
  const pk = fabricPack(fabric, color), p = pk.params;
  const mat = new THREE.MeshPhysicalMaterial({ color: p.color, roughness: p.roughness, sheen: p.sheen, sheenRoughness: p.sheenRoughness, sheenColor: p.sheenColor,
    clearcoat: p.clearcoat, clearcoatRoughness: p.clearcoatRoughness, specularIntensity: p.spec, side });
  const U = { ...uniforms, ...pk.uniforms };
  if (U.cA) U.cA = { value: p.color.clone() };                              // the dye as this fibre takes it (the vest's colour is the fabric's own)
  if (U.cB && color2) U.cB = { value: fabricPack(fabric, color2).params.color };
  if (!U.cOpen) U.cOpen = { value: 0 };
  if (defines) mat.defines = { ...(mat.defines || {}), ...defines };
  const head = glsl.head.replace('{ vec3 b = vBind;', '{ vec3 b = fabP();');
  if (head === glsl.head) throw new Error('fabric_glsl: hero.js cloth head changed');
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + glsl.vertPars + FAB_VERT_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + glsl.vert + FAB_VERT);
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', lightsChunk())
      .replace('#include <common>', '#include <common>\n' + glsl.fragPars + '\nuniform float cAsp;\n' + FAB_PARS)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + head + (glsl._surface || FAB_SURFACE) + glsl.detail + FAB_WEAR)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FAB_NORMAL)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + FAB_MATERIAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + (glsl.emissive || ''));
  };
  mat.customProgramCacheKey = () => key;
  mat.uniforms_c6 = U; mat.userData.fabric = fabric; mat.userData.fabricNumbers = pk.numbers;
  if (FAB_HOOK) FAB_HOOK(mat, { fabric, color, color2, glsl, key, defines: mat.defines || null });   // FABRIC6 (rev 6): only when a page set it
  return mat;
}
// FABRIC6 (round 6, opt-in): a page that calls fabric6.js useFabric6() sets this hook; it then refines each fabric material made after
// (fabric rev 6). Null (the default): fabricMaterial is exactly as before.
let FAB_HOOK = null;
export function setFabricHook(fn) { FAB_HOOK = typeof fn === 'function' ? fn : null; }
// the shadow of a garment shell. hero.js shells are supersets of the garment cut in the colour shader, so they never cast (an uncut
// shell would shadow a face with a beard that is not there); the body under them cast instead, which left the skin INSIDE a sleeve end
// lit by a low sun through the gap (the glowing cuffs) and no garment shadowing another. This depth material runs hero.js's own cuts
// (the same head as the colour pass, on the same uniforms and the same defines object, so a drape's CLOTH_REST reaches it), so the
// garment casts exactly what is drawn.
export function fabricDepth(mat, glsl) {
  const U = mat.uniforms_c6, d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  d.defines = mat.defines;                                           // shared object: the drape's CLOTH_REST define lands here too
  const head = glsl.head.replace('{ vec3 b = vBind;', '{ vec3 b = fabP();');
  d.onBeforeCompile = sh => { Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + glsl.vertPars + '\n#ifdef CLOTH_REST\nattribute vec3 aRest; varying vec3 vRest;\n#endif\n')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + glsl.vert + '\n#ifdef CLOTH_REST\nvRest = aRest;\n#endif\n');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + glsl.fragPars + '\n#ifdef CLOTH_REST\nvarying vec3 vRest;\n#endif\nvec3 fabP(){\n#ifdef CLOTH_REST\n  return vRest;\n#else\n  return vBind;\n#endif\n}\n')
      .replace('void main() {', 'void main() {\n' + head + '\n}\n'); };
  d.customProgramCacheKey = () => 'hero-fabric-depth';
  return d;
}
export { FABRICS, LOOKS };
