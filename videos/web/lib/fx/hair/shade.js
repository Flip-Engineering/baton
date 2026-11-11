// HAIR / shade: hair cards lit as hair, colour from melanin, and the skin under the hair (HUMAN c8 lane D).
//
// The hair material is three's MeshPhysicalMaterial (so light/'s litPatch, prepass, shadows and environment all work) with its
// direct BRDF replaced in RE_Direct_Physical:
//   - two shifted specular lobes on the strand tangent (Kajiya and Kay 1989 "Rendering fur with three dimensional textures" for the
//     tangent lobe; Scheuermann 2004 "Practical real-time hair rendering and shading" for shifting the tangent along the normal so
//     the primary (R) lobe sits toward the root and the secondary (TRT) lobe toward the tip, coloured by the hair). Shifts and widths
//     are Marschner, Jensen, Cammarano, Worley and Hanrahan 2003's measured cuticle tilt and lobe widths ("Light scattering from
//     human hair fibers"): alpha_R ~ -3 deg x2, alpha_TRT ~ +4.5 deg; beta_R ~ 7 deg, beta_TRT ~ 14 deg; a KK power p ~ 1 / beta^2.
//   - TT, the forward lobe through the fibre (why backlit hair glows; the hair's version of hero.js's asperity rim, Koenderink and
//     Pont 2003), tinted by one fibre's transmittance and riding the shadow map;
//   - a Kajiya-Kay diffuse (sin T.L) shaped by the volume's bent normal: the far side of a head of hair is dim, not black.
// Colour: an absorption sigma_a from eumelanin and pheomelanin with the spectral shapes of d'Eon, Francois, Hill, Letteri and Aubry
// 2011 / Chiang, Bitterli, Tappan and Burley 2016 ("A practical and controllable hair and fur model for production path tracing"),
// mapped to a multiple-scattering albedo by Chiang et al.'s form c = exp(-5.9 sqrt(sigma_a)), with the concentration scale
// calibrated here to the lightness range of real hair (black L* ~18 to blonde L* ~60, white ~75; see NOTES). Greying is per strand:
// the atlas gives each strand an id, and a fraction of strands (by age, more at the temples) is unpigmented, so grey is salt and
// pepper at 1080 px and a mixed grey at 270. Root darkening and depth in the volume stand in for the self-shadowing the shadow map
// is too coarse to see (deep opacity maps, Kim and Neumann 2001, are the real thing; a later round).
// Alpha is STOCHASTIC: a fragment survives where coverage > a threshold that is interleaved gradient noise shifted by the light/
// pipeline's sub-frame index (LIT.uLitSSRP.z), so LitRenderer's K accumulated sub-frames average coverage into soft hair, with no
// sorting and no blending; the shadow pass alpha-tests the same atlas.
import * as THREE from 'three';
import { LIT } from '../light/patch.js';
import { atlasTexture, atlas4Textures } from './atlas.js';

// ---------------------------------------------------------------- melanin -> colour
const S_EU = [0.419, 0.697, 1.37], S_PH = [0.187, 0.4, 1.05];
export function sigmaA(eu, ph = 0) { return S_EU.map((e, i) => eu * e + ph * S_PH[i]); }
// the diffuse (multiple-scattering) albedo of a head of hair; desaturated by 0.75 toward its luminance (measured swatches are less
// saturated than a single-scatter model: the white R lobe and inter-fibre bounce mix in neutral light)
export function hairAlbedo(eu, ph = 0) {
  const s = sigmaA(eu, ph), c = s.map(x => Math.exp(-5.9 * Math.sqrt(Math.max(0, x)))), y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return c.map(x => Math.max(0, y + 0.75 * (x - y)));
}
// one fibre's transmittance (TT, TRT colour)
export function fibreT(eu, ph = 0, k = 1.6) { return sigmaA(eu, ph).map(x => Math.exp(-k * x)); }
// a hex colour (CREW8 specs) -> the melanins whose albedo matches it best (Lab-ish distance in linear RGB, log space)
export function melaninFromHex(hex) {
  const c = new THREE.Color(hex), t = [c.r, c.g, c.b].map(x => Math.log(Math.max(x, 1e-4)));
  let best = null;
  for (let i = 0; i <= 60; i++) for (let j = 0; j <= 20; j++) { const eu = 0.02 * Math.pow(1.09, i) - 0.02, ph = j * 0.04, a = hairAlbedo(eu, ph).map(x => Math.log(Math.max(x, 1e-4)));
    const e = (a[0] - t[0]) ** 2 + (a[1] - t[1]) ** 2 * 1.5 + (a[2] - t[2]) ** 2 * 0.6; if (!best || e < best.e) best = { e, eu, ph }; }
  return { eu: +best.eu.toFixed(3), ph: +best.ph.toFixed(3) };
}
// named colours as melanins (approximate; see NOTES for the lightness targets)
export const MELANIN = { black: { eu: 1.6, ph: 0.02 }, darkBrown: { eu: 0.55, ph: 0.05 }, brown: { eu: 0.3, ph: 0.06 }, lightBrown: { eu: 0.17, ph: 0.06 },
  darkBlonde: { eu: 0.1, ph: 0.06 }, blonde: { eu: 0.05, ph: 0.05 }, auburn: { eu: 0.2, ph: 0.3 }, red: { eu: 0.06, ph: 0.42 } };
// HAIR5 (round 5, opt-in: hairMaterial({ rev5 }) / ({ col5 })): ONE melanin model for the engine and Cycles. Judge c10: black hair
// (eu 3.0) read reddish-brown on the studio stage, L11 (eu 1.1) ginger, L08 auburn where Cycles renders her near-black. Two causes:
//   - the TRT lobe: rev 1-4 weight it 0.55 x TT^2 with TT = exp(-1.6 sigma); for dark hair that is 10-30x the diffuse albedo and
//     strongly red, so dark hair took the colour of its TRT. A fibre's TRT is (1 - f)^2 f T^2 (Marschner et al. 2003; Chiang et al.
//     2016's A_p): about 0.04 of the light times the absorption of two passes through the fibre, which for dark hair is nothing;
//   - the units: rev 1-4 use d'Eon et al. 2011's absorption shapes scaled to a calibrated lightness; Cycles' Principled Hair (Chiang)
//     takes the same eu / ph (person_hair.py: melanin = 1 - exp(-(eu + ph)), redness = ph / (eu + ph)) through ITS coefficients
//     (eumelanin 0.506, 0.841, 1.653; pheomelanin 0.343, 0.733, 1.924: Cycles' kernel), 1.21x d'Eon's shape for eumelanin.
// hairColour5: sigma in Cycles' units; the volume's albedo by Chiang et al.'s own colour mapping (c = exp(-sqrt(sigma) f(beta_n)),
// beta_n Cycles' radial roughness 0.35, the inverse of what Cycles uses to turn a colour into sigma); A_TT and A_TRT averaged over the
// fibre's offset h with the dielectric Fresnel term (eta 1.55) and the path 2 cos(gamma_t) through a unit fibre.
export const EU5 = [0.506, 0.841, 1.653], PH5 = [0.343, 0.733, 1.924];
export const sigma5 = (eu, ph = 0) => EU5.map((e, i) => eu * e + ph * PH5[i]);
const fresnelD = (ci, eta) => { const s2 = Math.max(0, 1 - ci * ci) / (eta * eta); if (s2 >= 1) return 1; const ct = Math.sqrt(1 - s2), rs = (ci - eta * ct) / (ci + eta * ct), rp = (eta * ci - ct) / (eta * ci + ct); return 0.5 * (rs * rs + rp * rp); };
export const chiangK = (b = 0.35) => (((((0.245 * b) + 5.574) * b - 10.73) * b + 2.532) * b - 0.215) * b + 5.969;
export function hairColour5(eu, ph = 0, { radial = 0.35, eta = 1.55, sig = null } = {}) {
  const s = sig || sigma5(eu, ph), k = chiangK(radial), albedo = s.map(x => Math.exp(-k * Math.sqrt(Math.max(0, x))));
  const tt = [0, 0, 0], trt = [0, 0, 0], N = 48;
  for (let j = 0; j < N; j++) { const hh = -1 + (j + 0.5) * 2 / N, ci = Math.sqrt(1 - hh * hh), f = fresnelD(ci, eta), gt = Math.asin(hh / eta), path = 2 * Math.cos(gt);
    for (let c = 0; c < 3; c++) { const T = Math.exp(-s[c] * path); tt[c] += (1 - f) * (1 - f) * T / N; trt[c] += (1 - f) * (1 - f) * f * T * T / N; } }
  return { sigma: s, albedo, tt, trt, k };
}
// the grey (unpigmented) strand in the same units: melanin 0.012 (person_hair.py rev 5 uses the same for its grey strands)
export const GREY5 = 0.012;
// grey fraction by age (Panhard, Lozano and Loussouarn 2012, Br J Dermatol 167:865: grey onset and intensity vary by ancestry; the
// '50% grey by 50' rule is too strong for most people): onset ~30-35 (earlier in European, later in Asian and African samples),
// then roughly linear; a per-person offset is expected and the option `grey` overrides it
export function greyByAge(age, { onset = 34, rate = 0.016 } = {}) { return Math.max(0, Math.min(0.95, (age - onset) * rate)); }

// ---------------------------------------------------------------- the hair material
const VERT_PARS = `attribute vec3 aHairT; attribute vec4 aHair; varying vec3 vHairT; varying vec4 vHair; varying vec2 vHUV;`;
const VERT_T = `{ vec3 hT0 = aHairT;
#ifdef USE_SKINNING
  hT0 = ( skinMatrix * vec4( hT0, 0.0 ) ).xyz;
#endif
  vHairT = normalize( ( modelViewMatrix * vec4( hT0, 0.0 ) ).xyz ); vHair = aHair; vHUV = uv; }`;
const FRAG_PARS = `varying vec3 vHairT; varying vec4 vHair; varying vec2 vHUV;
uniform sampler2D hAtlas; uniform vec3 hSig, hSigG, hTc, hTcG; uniform vec4 hSpec, hMisc, hSub; uniform vec2 hExp; uniform float hGrey;
vec3 hT; float hAO; vec3 hAlbS; vec3 hTRTc; vec3 hTTc;
float hIgn(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`;
// hSpec: (R strength, TRT strength, R shift, TRT shift); hExp: KK powers; hMisc: (alpha gain, root darkening, TT strength, wrap)
const FRAG = `
{ vec2 uvH = vec2(vHUV.x, fract(vHUV.y));
  vec4 tx = textureGrad(hAtlas, uvH, dFdx(vHUV), dFdy(vHUV));
  float cov = clamp(tx.g * hMisc.x, 0.0, 1.0);
  // the threshold's spread follows the texel footprint: magnified (a close-up) a near-hard 0.5 cut, the sub-frames' pixel jitter
  // anti-aliasing it; minified (strands under a pixel) the full 0..1 range, so the K sub-frames average the true coverage
  vec2 fp = vec2(length(dFdx(vHUV) * vec2(2048.0, 512.0)), length(dFdy(vHUV) * vec2(2048.0, 512.0)));
  float spread = clamp(log2(max(max(fp.x, fp.y), 1.0)) / 2.5, 0.25, 1.0);
  float thr = 0.5 + (fract(hIgn(gl_FragCoord.xy) + 0.6180339 * hSub.z + vHair.z * 7.31) - 0.5) * spread;
  if (cov < max(thr, 0.04)) discard;
  // per strand (grey or pigmented, a little variation in melanin) where a strand is resolved; where strands are under a pixel the
  // mean of the mixture (a grey head at 270 px is a grey, not salt-and-pepper noise that the sub-frames cannot average away)
  float sid = tx.r * 255.0, sr = fract(sin(sid * 12.9898 + vHair.z * 78.233) * 43758.5453);
  float gF = clamp(hGrey * (1.0 + vHair.w), 0.0, 1.0), res = 1.0 - smoothstep(1.0, 3.0, max(fp.x, fp.y));
  float gk = mix(gF, sr < gF ? 1.0 : 0.0, res);
  vec3 sig = hSig * (1.0 + 0.24 * res * (fract(sr * 7.13) - 0.5));
  vec3 alb = exp(-5.9 * sqrt(max(sig, vec3(0.0)))), albG = exp(-5.9 * sqrt(hSigG)) * 0.75;
  float yA = dot(alb, vec3(0.2126, 0.7152, 0.0722)); alb = vec3(yA) + 0.75 * (alb - yA);
  alb = mix(alb, albG, gk);
  alb *= 0.85 + 0.25 * mix(0.6, tx.b, res);
  hTTc = mix(hTc, hTcG, gk); hTRTc = hTTc * hTTc;
  float along = vHair.x, depth = vHair.y;
  hAO = mix(1.0, 1.0 - hMisc.y, pow(1.0 - along, 2.0) * (0.35 + 0.65 * depth)) * (1.0 - 0.35 * depth);
  diffuseColor.rgb = alb;
  hAlbS = alb;
  hT = normalize(vHairT);
  roughnessFactor = 0.5;
}`;
// the lobes, replacing three's GGX + Lambert in RE_Direct_Physical
const DIRECT = `{ vec3 L = directLight.direction, Vv = geometryViewDir, Nn = geometryNormal;
    float nl = dot(Nn, L), TL = dot(hT, L), sTL = sqrt(max(0.0, 1.0 - TL * TL));
    float vol = clamp((nl + hMisc.w) / (1.0 + hMisc.w), 0.0, 1.0);
    reflectedLight.directDiffuse += directLight.color * material.diffuseColor * RECIPROCAL_PI * (0.55 + 0.45 * sTL) * vol * sqrt(hAO);
    vec3 Hh = normalize(L + Vv);
    vec3 T1 = normalize(hT + hSpec.z * Nn), T2 = normalize(hT + hSpec.w * Nn);
    float c1 = dot(T1, Hh), c2 = dot(T2, Hh);
    float s1 = pow(max(0.0, 1.0 - c1 * c1), 0.5 * hExp.x), s2 = pow(max(0.0, 1.0 - c2 * c2), 0.5 * hExp.y);
    float vis = smoothstep(-0.15, 0.3, nl), fr = 0.0465 + 0.9535 * pow(1.0 - max(dot(Vv, Hh), 0.0), 5.0);
    reflectedLight.directSpecular += directLight.color * vis * (hSpec.x * fr * s1 + hSpec.y * s2 * hTRTc * (0.6 + 0.4 * hAO));
    float fw = max(0.0, dot(-Vv, L)); fw = fw * fw * fw * fw;
    float pA = 1.0 / max(abs(dot(Nn, Vv)), 0.3), gA = smoothstep(-0.45, 0.25, nl);
    reflectedLight.directDiffuse += directLight.color * hTTc * hMisc.z * fw * pA * gA * (0.4 + 0.6 * sTL);
  }`;

// HUMAN c8 integration v2 (opt-in, o.rNorm): the R lobe as Marschner et al. 2003 write it for a smooth fibre, R = F * M_R(theta_h) *
// N_R(phi): the longitudinal lobe is the KK power normalised to unit area (x sqrt(p / 2 pi): the KK peak of 1 is a lobe ~0.3 rad wide
// with no normalisation) and the azimuthal term N_R = cos(phi / 2) / 4 (phi between the light and the view about the strand: a fibre
// reflects R back toward the light, not round a full cone). Front-lit the highlight keeps ~0.84 of its peak, side-lit ~0.6, against
// the light it fades: the broad silver sheen on the sunlit top of a dark head (integration seams 3 and 18) loses its side and back
// parts. Without o.rNorm the shader source is exactly as before.
const RN_PARS = `
float hRNorm(vec3 T, vec3 L, vec3 V) { vec3 lp = L - T * dot(T, L), vp = V - T * dot(T, V); float ll = length(lp), lv = length(vp);
  float cphi = (ll > 1e-4 && lv > 1e-4) ? dot(lp, vp) / (ll * lv) : 1.0; return sqrt(hExp.x / 6.2832) * 0.25 * sqrt(max(0.0, 0.5 + 0.5 * cphi)); }
`;
// HAIR3 (round 3): what made light hair read as a helmet is a smooth,
// evenly lit, evenly coloured shell. Real blonde (and any) hair shows its structure: strands of different pigment side by side (a
// blonde head mixes pale and darker strands), clumps a little lighter or darker than each other, tips lighter than roots (weathering:
// light hair bleaches toward the tip), and the inside of the volume much darker than the outside (self-shadowing: the deep layers of a
// head of light hair are golden brown, which is what gives it depth). hLook = (card variance, strand variance, tip lightening for
// light hair, depth darkening): FRAG4 and after read it (the v3 shader that introduced it is in git history).
const FRAG_PARS3 = FRAG_PARS + '\nuniform vec4 hLook;';
// HAIR4 (round 4, the scalp hair): the strand tiles baked in Cycles (atlas.js
// atlas4Textures) carry the curl, so the shading reads three things from them the procedural atlas did not have:
//   - the strand's own DIRECTION in the card (the flow map): the Kajiya-Kay tangent turns with the ringlet or the coil, so the
//     highlight breaks along each loop instead of running straight down a card (the card's +u in view space from the position and uv
//     derivatives, taken before any branch);
//   - the occlusion among the strands (Cycles' AO) and the depth through the patch: the inside of a ringlet and of a coil mass dark;
//   - where each strand ENDS: a repeating tile has no ends of its own, so a strand (its id) ends somewhere in the last h4T.x of the card
//     (resolved), or the coverage falls as the share of strands still there (unresolved).
// White and grey strands (unpigmented: almost no absorption, Marschner et al. 2003's TT and the multiple scattering of a fibre with no
// melanin dominate) are drawn translucent instead of as a lit plate: a little less coverage (the scalp and the light behind show
// through), the strand-to-strand occlusion and the card variance mostly lifted (low contrast), a stronger forward-scatter lobe and a
// wide wrap (light carried round into the shadow side). h4T = (tip trim, coverage gain, occlusion strength, flow strength);
// h4G = (grey coverage cut, grey TT boost, grey wrap, grey albedo). 
const FRAG4 = `
{ vec2 uvH = vec2(vHUV.x, fract(vHUV.y)), gx = dFdx(vHUV), gy = dFdy(vHUV);
  vec4 tx = textureGrad(hAtlas, uvH, gx, gy), tf = textureGrad(hFlow, uvH, gx, gy), tn = textureGrad(hNrm, uvH, gx, gy);
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition), Ng = cross(dpx, dpy);
  vec3 Su = cross(dpy, Ng) * gx.x + cross(Ng, dpx) * gy.x;
  vec2 fp = vec2(length(gx * vec2(2048.0, 512.0)), length(gy * vec2(2048.0, 512.0)));
  float spread = clamp(log2(max(max(fp.x, fp.y), 1.0)) / 2.5, 0.25, 1.0), res = 1.0 - smoothstep(1.0, 3.0, max(fp.x, fp.y));
  float sid = tx.r * 255.0, sr = fract(sin(sid * 12.9898 + vHair.z * 78.233) * 43758.5453);
  float gF = clamp(hGrey * (1.0 + vHair.w), 0.0, 1.0), gk = mix(gF, sr < gF ? 1.0 : 0.0, res);
  float endS = 1.0 - h4T.x * fract(sr * 3.71);
  float alive = mix(clamp((1.0 - vHair.x) / max(h4T.x, 1e-3), 0.0, 1.0), 1.0 - smoothstep(endS - 0.02, endS + 0.02, vHair.x), res);
  float cov = clamp(tx.g * h4T.y, 0.0, 1.0) * alive * (1.0 - h4G.x * gk);
  float thr = 0.5 + (fract(hIgn(gl_FragCoord.xy) + 0.6180339 * hSub.z + vHair.z * 7.31) - 0.5) * spread;
  if (cov < max(thr, 0.04)) discard;
  float lightK = 1.0 - smoothstep(0.08, 0.6, hSig.x), lowC = 1.0 - 0.6 * gF;
  vec3 sig = hSig * (1.0 + lowC * hLook.x * (fract(vHair.z * 13.71) - 0.5) * 2.0) * (1.0 + hLook.y * mix(0.35, 1.0, res) * (fract(sr * 7.13) - 0.5) * 2.0) * (1.0 - hLook.z * lightK * smoothstep(0.25, 1.0, vHair.x));
  vec3 alb = exp(-5.9 * sqrt(max(sig, vec3(0.0)))), albG = exp(-5.9 * sqrt(hSigG)) * h4G.w;
  float yA = dot(alb, vec3(0.2126, 0.7152, 0.0722)); alb = vec3(yA) + 0.75 * (alb - yA);
  alb = mix(alb, albG, gk);
  hTTc = mix(hTc, hTcG, gk); hTRTc = hTTc * hTTc; hTTc *= 1.0 + h4G.y * gk;
  float along = vHair.x, depth = vHair.y, occ = mix(1.0, 0.2 + 0.8 * tx.b, h4T.z);
  occ = mix(occ, 1.0, 0.65 * gk);
  hAO = mix(1.0, 1.0 - hMisc.y * mix(1.0, 0.4, gF), pow(1.0 - along, 1.6) * (0.35 + 0.65 * depth)) * (1.0 - hLook.w * lowC * depth) * occ;
  diffuseColor.rgb = alb;
  hAlbS = alb;
  hT = normalize(vHairT);
  vec3 S = Su - hT * dot(Su, hT); float sl = length(S); S = S / max(sl, 1e-12);
  vec2 f2 = tf.rg * 2.0 - 1.0; float fm = length(f2), a2 = 0.5 * atan(f2.y, f2.x + 1e-6);
  hT = normalize(mix(hT, cos(a2) * hT + sin(a2) * S, h4T.w * smoothstep(0.08, 0.35, fm) * step(1e-9, sl)));
  hWrap = mix(hMisc.w, 0.95, h4G.z * gk);
  // the clump's own roundness: a ringlet or a coil is a column, lit on one side and dark on the other (tf.b: its normal across the
  // card, 0.5 = flat); applied to the shading normal after three's normal block (FRAG4N)
  h4N = (tn.rgb * 2.0 - 1.0) * vec3(h4T.w, h4T.w, 1.0); h4S = S; h4T2 = normalize(vHairT);
  roughnessFactor = 0.5;
}`;
// the clump's normal (atlas4_n, card space: x = the card's +u, y = along the hair, z = out of the card) carried into view space on the
// card's frame (the shading normal stays the volume's bent normal where the tile is flat)
const FRAG4N = `\n{ vec3 n4 = h4S * h4N.x + h4T2 * h4N.y + normal * h4N.z; float l4 = length(n4); if (l4 > 1e-4) normal = n4 / l4; }\n`;
const FRAG_PARS4 = FRAG_PARS3 + '\nuniform sampler2D hFlow, hNrm; uniform vec4 h4T, h4G; float hWrap; vec3 h4N, h4S, h4T2;';
const DIRECT4 = DIRECT.replace('float vol = clamp((nl + hMisc.w) / (1.0 + hMisc.w), 0.0, 1.0);', 'float vol = clamp((nl + hWrap) / (1.0 + hWrap), 0.0, 1.0);');
const DIRECT4_RN = DIRECT4.replace('hSpec.x * fr * s1', 'hSpec.x * fr * s1 * hRNorm(hT, L, Vv)');
// HAIR5 (round 5, the scalp hair): FRAG4 with (a) the colour in Cycles' units (hairColour5: the albedo exp(-h5C.x sqrt(sigma)) with no
// desaturation (h5C.y = 1), TT and TRT the fibre's own A_TT / A_TRT from uniforms, the TRT lobe normalised as the R lobe is), (b) each
// strand starting at its own height in the first h5R.x metres of a card (the distance from the root rides in the strand tangent's
// length, grow CardBuilder5: no new varying), (c) strands near a card's long edges dropped at random (h5R.y: the edge band as a share
// of the half width, h5R.z its jitter), so no square card end and no straight card edge shows at 1:1. 
const VERT_T5 = VERT_T.replace('vHairT = normalize( ( modelViewMatrix * vec4( hT0, 0.0 ) ).xyz );', 'vHairT = normalize( ( modelViewMatrix * vec4( hT0, 0.0 ) ).xyz ) * length( aHairT );');
const FRAG5 = FRAG4
  .replace('float cov = clamp(tx.g * h4T.y, 0.0, 1.0) * alive * (1.0 - h4G.x * gk);',
    `float lT5 = length(vHairT), sR5 = lT5 > 1.5 ? (lT5 - 2.0) * 0.01 : 1.0, bS5 = h5R.x * fract(sr * 5.17 + 0.37);
  float born5 = mix(clamp(sR5 / max(h5R.x, 1e-4), 0.0, 1.0), smoothstep(bS5 - 0.0005, bS5 + 0.0005, sR5), res);
  float uL5 = fract(vHUV.x * 16.0), eU5 = min(uL5, 1.0 - uL5) * 2.0, edge5 = smoothstep(0.0, h5R.y, eU5 + h5R.z * (fract(sr * 13.7 + 0.11) - 0.5));
  float cov = clamp(tx.g * h4T.y, 0.0, 1.0) * alive * (1.0 - h4G.x * gk) * born5 * mix(1.0, edge5, step(1.5, lT5));`)
  .replace('vec3 alb = exp(-5.9 * sqrt(max(sig, vec3(0.0)))), albG = exp(-5.9 * sqrt(hSigG)) * h4G.w;', 'vec3 alb = h5R.w * exp(-h5C.x * sqrt(max(sig, vec3(0.0)))), albG = h5R.w * exp(-h5C.x * sqrt(hSigG)) * h4G.w;')
  .replace('float yA = dot(alb, vec3(0.2126, 0.7152, 0.0722)); alb = vec3(yA) + 0.75 * (alb - yA);', 'float yA = dot(alb, vec3(0.2126, 0.7152, 0.0722)); alb = vec3(yA) + h5C.y * (alb - yA);')
  .replace('hTTc = mix(hTc, hTcG, gk); hTRTc = hTTc * hTTc; hTTc *= 1.0 + h4G.y * gk;', 'hTTc = mix(hTc, hTcG, gk); hTRTc = mix(h5Trt, h5TrtG, gk); hTTc *= 1.0 + h4G.y * gk;');
const FRAG_PARS5 = FRAG_PARS4 + '\nuniform vec4 h5R, h5C, h5S; uniform vec3 h5Trt, h5TrtG;';
// the TRT lobe at its physical weight (A_TRT, normalised like the R lobe: x sqrt(p / 2 pi) x h5C.z), TT x h5C.w
const DIRECT5 = DIRECT4_RN.replace('hSpec.x * fr * s1 * hRNorm(hT, L, Vv)', 'hSpec.x * h5S.x * fr * s1 * hRNorm(hT, L, Vv)').replace('hSpec.y * s2 * hTRTc * (0.6 + 0.4 * hAO)', 'hSpec.y * s2 * hTRTc * sqrt(hExp.y / 6.2832) * h5C.z * (0.6 + 0.4 * hAO)')
  .replace('reflectedLight.directDiffuse += directLight.color * hTTc * hMisc.z * fw * pA * gA * (0.4 + 0.6 * sTL);', 'reflectedLight.directDiffuse += directLight.color * hTTc * hMisc.z * h5C.w * fw * pA * gA * (0.4 + 0.6 * sTL);');
// brows, lashes, beards under rev 5 (o.col5): the v1 shading with the same colour model (their albedo, TT and TRT in Cycles' units)
const FRAG_C5 = FRAG
  .replace('vec3 alb = exp(-5.9 * sqrt(max(sig, vec3(0.0)))), albG = exp(-5.9 * sqrt(hSigG)) * 0.75;', 'vec3 alb = h5R.w * exp(-h5C.x * sqrt(max(sig, vec3(0.0)))), albG = h5R.w * exp(-h5C.x * sqrt(hSigG)) * 0.75;')
  .replace('float yA = dot(alb, vec3(0.2126, 0.7152, 0.0722)); alb = vec3(yA) + 0.75 * (alb - yA);', 'float yA = dot(alb, vec3(0.2126, 0.7152, 0.0722)); alb = vec3(yA) + h5C.y * (alb - yA);')
  .replace('hTTc = mix(hTc, hTcG, gk); hTRTc = hTTc * hTTc;', 'hTTc = mix(hTc, hTcG, gk); hTRTc = mix(h5Trt, h5TrtG, gk);');
const FRAG_PARS_C5 = FRAG_PARS + '\nuniform vec4 h5C, h5R, h5S; uniform vec3 h5Trt, h5TrtG;';
const DIRECT_C5 = DIRECT.replace('hSpec.y * s2 * hTRTc * (0.6 + 0.4 * hAO)', 'hSpec.y * s2 * hTRTc * sqrt(hExp.y / 6.2832) * h5C.z * (0.6 + 0.4 * hAO)')
  .replace('reflectedLight.directDiffuse += directLight.color * hTTc * hMisc.z * fw * pA * gA * (0.4 + 0.6 * sTL);', 'reflectedLight.directDiffuse += directLight.color * hTTc * hMisc.z * h5C.w * fw * pA * gA * (0.4 + 0.6 * sTL);');
const DIRECT_C5_RN = DIRECT_C5.replace('hSpec.x * fr * s1', 'hSpec.x * h5S.x * fr * s1 * hRNorm(hT, L, Vv)');
const DIRECT_C5_ = DIRECT_C5.replace('hSpec.x * fr * s1', 'hSpec.x * h5S.x * fr * s1');
// HAIR6 (round 6, the scalp hair): one hair BSDF matched to Cycles' Principled Hair
// (Chiang et al. 2016; person_hair.py: roughness 0.32 (+0.08 curly / coily), radial 0.35, offset 2.5 deg, IOR 1.55) on WHOLE people, not
// only the swatches. HAIR5's colour model is kept; what made the engine draw a whole head darker than Cycles (L08: near-black where Cycles
// draws dark-brown frizz) is the transport, so rev 6 changes that:
//   - LOBE WIDTHS from Cycles' own roughness: Chiang's longitudinal variance v = (0.726 b + 0.812 b^2 + 3.7 b^20)^2 gives a standard
//     deviation of ~18 deg for b 0.32 and ~24 deg for 0.40, where rev 1-5's Kajiya-Kay powers (70, 30) were 7-10 deg wide: the engine's
//     sheen was a thin line where Cycles' is a broad glow. The powers are now 1 / v (normalised lobes, so the energy is the same), the
//     TT lobe half and the TRT lobe twice the R width (Chiang's v_TT = v / 4, v_TRT = 4 v), the shifts -2a, a, 4a (a = 2.5 deg);
//   - DEEP OPACITY self-shadowing from the key's ordinary shadow map (no new pass): the depth behind the first occluder along the light
//     (the shadow map's depth, linear for the stages' orthographic key) becomes a transmittance through the hair volume, exp(-k d),
//     with a share of the blocked light given back forward through the fibres in their TT colour (multiple scattering is forward in
//     hair: Zinke, Yuksel, Weber and Keyser 2008, "Dual scattering approximation for fast multiple scattering in hair"): the inner cards
//     under the outer ones are no longer in a binary shadow (black), and blonde hair glows warm inside while black hair stays dark;
//     the single-scatter lobes (R, TRT, TT) see the plain extinction, the volume's diffuse (the multiple-scatter albedo) the forward-
//     lifted one. Behind the head (decimetres of occluder) the transmittance is nil, as it should be;
//   - the ENVIRONMENT's R sheen at the fibre's own reflectance (~0.07 of the incident radiance averaged over the broad lobe, not scaled
//     by the form's direct-lobe strength: a curl spreads its highlight, it does not lose it), and the indirect diffuse's depth / root
//     darkening relaxed (it stood in for the self-shadowing the deep opacity now does);
//   - h6D = (key shadow depth span m: set per draw from the scene's shadowed key, extinction k per m, forward share, on), h6E = (env
//     sheen gain, indirect darkening kept (0 none .. 1 rev 5's), volume-diffuse wrap for the lifted light, -).
const FRAG_PARS6 = FRAG_PARS5 + `
uniform vec4 h6D, h6E; float h6Dk = 1.0; vec3 h6Tc = vec3(1.0);`;
const SHADOW6 = `
#if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_SPOT_LIGHT_SHADOWS > 0 )
float getShadowH6( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
  float s = getShadow( shadowMap, shadowMapSize, shadowIntensity, shadowBias, shadowRadius, shadowCoord );
  h6Dk = 1.0; h6Tc = vec3(1.0);
  if (h6D.w <= 0.0 || s > 0.999) return s;
  vec3 c = shadowCoord.xyz / shadowCoord.w; c.z += shadowBias;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return s;
  vec2 ts = 1.0 / shadowMapSize; float dO = 1.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) dO = min(dO, unpackRGBAToDepth(texture2D(shadowMap, c.xy + vec2(float(i), float(j)) * ts)));
  float dm = max(0.0, c.z - dO) * h6D.x;
  float Td = exp(-h6D.y * dm);
  vec3 Tm = exp(-h6D.y * dm * (1.0 - h6D.z * clamp(hTTc, 0.0, 1.0)));
  float tm = dot(Tm, vec3(0.2126, 0.7152, 0.0722)), sM = mix(s, 1.0, tm), sD = mix(s, 1.0, Td);
  h6Dk = sD / max(sM, 1e-4); h6Tc = mix(vec3(1.0), Tm / max(tm, 1e-4), (sM - s) / max(sM, 1e-4));
  return sM;
}
#define getShadow( a, b, c, d, e, f ) getShadowH6( a, b, c, d, e, f )
#endif
`;
const DIRECT6 = DIRECT5
  .replace('reflectedLight.directDiffuse += directLight.color * material.diffuseColor * RECIPROCAL_PI * (0.55 + 0.45 * sTL) * vol * sqrt(hAO);',
    'reflectedLight.directDiffuse += directLight.color * h6Tc * material.diffuseColor * RECIPROCAL_PI * (0.55 + 0.45 * sTL) * mix(vol, mix(1.0, vol, h6Dk), h6E.z) * sqrt(hAO);')
  .replace('reflectedLight.directSpecular += directLight.color * vis * (', 'reflectedLight.directSpecular += directLight.color * h6Dk * vis * (')
  .replace('reflectedLight.directDiffuse += directLight.color * hTTc * hMisc.z * h5C.w * fw * pA * gA * (0.4 + 0.6 * sTL);', 'reflectedLight.directDiffuse += directLight.color * h6Dk * hTTc * hMisc.z * h5C.w * fw * pA * gA * (0.4 + 0.6 * sTL);\n    h6Dk = 1.0; h6Tc = vec3(1.0);');
// the stochastic coverage threshold decorrelated per FRAME by h6E.w (a frame seed the motion player sets: MOTION's lab renders every frame
// with the same sub-frame indices, so the hair's screen-door pattern stood still while the hair moved through it: RENDER6's finding)
const FRAG6 = FRAG5.replace('float thr = 0.5 + (fract(hIgn(gl_FragCoord.xy) + 0.6180339 * hSub.z + vHair.z * 7.31) - 0.5) * spread;', 'float thr = 0.5 + (fract(hIgn(gl_FragCoord.xy) + 0.6180339 * hSub.z + vHair.z * 7.31 + h6E.w) - 0.5) * spread;');
// Chiang's longitudinal variance from Cycles' roughness b, as a Kajiya-Kay power (1 / v; the lobes are normalised by sqrt(p / 2 pi))
export const chiangV = b => (0.726 * b + 0.812 * b * b + 3.7 * Math.pow(b, 20)) ** 2;
// gain / sat: the body colour's albedo gain and saturation ON THE PERSON (HAIR5's 0.40 / 0.8 were fitted on opaque swatch tresses and
// do not carry to a head of hair: Cycles renders L12's eu 0.08 blonde, the engine ash brown at 0.40; at 1.0 / 1.0 the engine's crown
// reads Y 0.217 against Cycles' 0.216, r/g 1.28 / 1.22: HAIR6 NOTES); aoKeep: how much of rev 5's indirect darkening stays
export const H6C = { k: 110, fwd: 0.85, eGain: 1.0, aoKeep: 0.2, wrap: 0.6, rGain: 1.0, trtGain: 1.0, shiftR: -2 * 2.5, shiftTT: 2.5, shiftTRT: 4 * 2.5, rough: 0.32, roughCurl: 0.08, gain: 1.0, sat: 1.0 };
// the rev-5 constants (calibrated against Cycles on the swatch plates: review/studio_human_c8/after/hair5/NOTES.md, colour table)
// k: Chiang's exponent (null: f(beta_n 0.35) = 5.83); sat; trt, tt: lobe gains; gain: the body colour's albedo gain; rGain: the R lobe's.
// gain and rGain from the swatch plates (studio): Cycles' tress reads 0.40x the engine's body colour and 2.3x its neutral sheen.
export const H5C = { k: null, sat: 0.8, trt: 0.45, tt: 0.35, gain: 0.40, rGain: 1.54, eGain: 1.76 };
export function hairMaterial(o = {}) {
  // ONE current version (8 Oct): o.scalp = the scalp hair (HAIR6's BSDF matched to Cycles over HAIR5's colour model and HAIR4's baked
  // strand tiles); otherwise the face cards (brows, lashes, beard: the v1 card shading with HAIR5's colour model)
  const R6 = !!o.scalp, R5 = R6, C5 = !R6;
  const T4 = R5 ? atlas4Textures() : null, tex = T4 ? T4.atlas : atlasTexture(o.atlasSeed ?? 8, 1);
  const mel = o.melanin || MELANIN.brown, sig = sigmaA(mel.eu, mel.ph), sigG = [0.004, 0.006, 0.011];
  const U = {
    hAtlas: { value: tex }, hSig: { value: new THREE.Vector3(...sig) }, hSigG: { value: new THREE.Vector3(...sigG) },
    hTc: { value: new THREE.Vector3(...fibreT(mel.eu, mel.ph)) }, hTcG: { value: new THREE.Vector3(...sigG.map(x => Math.exp(-1.6 * x))) },
    hSpec: { value: new THREE.Vector4(o.specR ?? 1.0, o.specTRT ?? 0.55, -0.1, 0.12) }, hExp: { value: new THREE.Vector2(o.expR ?? 70, o.expTRT ?? 16) },
    hMisc: { value: new THREE.Vector4(o.alphaGain ?? 1.6, o.rootDark ?? 0.55, o.tt ?? 0.5, 0.35) }, hGrey: { value: o.grey ?? 0 },
    hSub: LIT.uLitSSRP,
  };
  if (R5) U.hLook = { value: new THREE.Vector4(...(o.hLook || [0.16, 0.45, 0.35, 0.55])) };
  if (T4) { U.hFlow = { value: T4.flow }; U.hNrm = { value: T4.nrm }; U.h4T = { value: new THREE.Vector4(...(o.h4T || [0.32, 1.35, 0.85, 1.0])) }; U.h4G = { value: new THREE.Vector4(...(o.h4G || [0.3, 1.6, 0.8, 0.85])) }; }
  // (HAIR5) the colour in Cycles' units: sigma, the TT / TRT of one fibre, the grey strand's; h5C = (albedo exponent, saturation, TRT gain,
  // TT gain), h5R = (root start length m, edge band, edge jitter, -)
  if (R5 || C5) { const c = hairColour5(mel.eu, mel.ph), g = hairColour5(0, 0, { sig: sigma5(GREY5, 0) });
    U.hSig.value.set(...c.sigma); U.hSigG.value.set(...g.sigma); U.hTc.value.set(...c.tt); U.hTcG.value.set(...g.tt);
    U.h5Trt = { value: new THREE.Vector3(...c.trt) }; U.h5TrtG = { value: new THREE.Vector3(...g.trt) };
    U.h5C = { value: new THREE.Vector4(o.h5k ?? H5C.k ?? c.k, o.h5sat ?? H5C.sat, o.h5trt ?? H5C.trt, o.h5tt ?? H5C.tt) };
    U.hSpec.value.y = o.specTRT5 ?? 1.0; U.h5S = { value: new THREE.Vector4(o.h5rgain ?? H5C.rGain, o.h5egain ?? H5C.eGain, 0, 0) };   // (the direct R lobe's gain, the environment sheen's)
    U.h5R = { value: new THREE.Vector4(...(o.h5R || [0.006, 0.35, 0.45, o.h5gain ?? H5C.gain])) }; }
  // (HAIR6) the lobes from Cycles' roughness, the deep opacity and the environment sheen (H6C; h6D.x is set per draw: hair6KeyDepth)
  if (R6) { const b = (o.h6rough ?? H6C.rough) + (o.form6 === 'curly' || o.form6 === 'coily' ? H6C.roughCurl : 0), v = chiangV(b), d2r = Math.PI / 180;
    U.hExp.value.set(o.expR6 ?? 1 / v, o.expTRT6 ?? 1 / (4 * v)); U.hSpec.value.z = Math.tan((o.h6shiftR ?? H6C.shiftR) * d2r); U.hSpec.value.w = Math.tan((o.h6shiftTRT ?? H6C.shiftTRT) * d2r);
    U.hSpec.value.x = o.specR6 ?? 1.0; U.h5S.value.x = o.h6rgain ?? H6C.rGain; U.h5C.value.z = (o.h6trt ?? H6C.trtGain) * (o.h5trt ?? H5C.trt);
    U.h6D = { value: new THREE.Vector4(20, o.h6k ?? H6C.k, o.h6fwd ?? H6C.fwd, o.h6deep === false ? 0 : 1) };
    U.h6E = { value: new THREE.Vector4(o.h6egain ?? H6C.eGain, o.h6ao ?? H6C.aoKeep, o.h6wrap ?? H6C.wrap, 0) };
    U.h5R.value.w = o.h5gain ?? H6C.gain; U.h5C.value.y = o.h5sat ?? H6C.sat; }
  const mat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0, specularIntensity: 0, side: THREE.DoubleSide, envMapIntensity: 1 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <skinnormal_vertex>', '#include <skinnormal_vertex>\n' + (R5 ? VERT_T5 : VERT_T));
    const LP = THREE.ShaderChunk.lights_physical_pars_fragment
      .replace('reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );', '')
      .replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );', R6 ? DIRECT6 : o.rNorm ? DIRECT_C5_RN : DIRECT_C5_)
      .replace('reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;', R6 ? 'reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance * mix(1.0, hAO, h6E.y);\n\treflectedLight.indirectSpecular += mix(cosineWeightedIrradiance, radiance, 0.3) * (0.07 * h6E.x + 0.05 * hSpec.y * hTRTc) * mix(1.0, hAO, h6E.y);' : 'reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance * hAO;\n\t' + (R5 || C5 ? 'reflectedLight.indirectSpecular += mix(vec3(dot(radiance, vec3(0.2126, 0.7152, 0.0722))), radiance, 0.5) * (0.03 * hSpec.x * h5S.y + 0.05 * hSpec.y * hTRTc) * hAO;' : 'reflectedLight.indirectSpecular += radiance * (0.03 * hSpec.x + 0.05 * hSpec.y * hTRTc) * hAO;'));
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + (R6 ? FRAG_PARS6 : FRAG_PARS_C5) + (o.rNorm || R5 ? RN_PARS : ''))
      .replace('#include <lights_physical_pars_fragment>', LP)
      .replace('#include <shadowmap_pars_fragment>', R6 ? '#include <shadowmap_pars_fragment>\n' + SHADOW6 : '#include <shadowmap_pars_fragment>')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + (R6 ? FRAG6 : FRAG_C5))
      // two-sided cards keep the volume's bent normal on both faces (three flips it for back faces)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n#ifdef DOUBLE_SIDED\n normal *= faceDirection;\n#endif\n' + (T4 ? FRAG4N : ''));
  };
  mat.customProgramCacheKey = () => R6 ? 'hair8-rn-v6' : o.rNorm ? 'hair8-rn-c5' : 'hair8-c5';
  mat.userData.hairU = U; mat.userData.shade = R6 ? { rev: 6 } : { rev: 5, col5: true };   // (export.js carries it to Blender; its rev >= 4 marks the scalp's ropes and baked-tile cards for person_hair.py)
  mat.userData.setMelanin = (m, grey) => { const c = hairColour5(m.eu, m.ph); U.hSig.value.set(...c.sigma); U.hTc.value.set(...c.tt); U.h5Trt.value.set(...c.trt); if (grey != null) U.hGrey.value = grey; };
  return mat;
}
// the shadow pass: the same atlas, alpha-tested (three's depth material reads alphaMap's G channel)
export function hairDepthMaterials(ver = 1) {
  const tex = ver === 4 ? atlas4Textures().atlas : atlasTexture(8, ver);   // (4: HAIR4's baked atlas; its v repeats)
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: tex, alphaTest: 0.35, side: THREE.DoubleSide });
  const p = new THREE.MeshDistanceMaterial({ alphaMap: tex, alphaTest: 0.35, side: THREE.DoubleSide });
  return { depth: d, distance: p };
}

// ---------------------------------------------------------------- the skin under the hair (chained onto h.body.material)
// Works on a built hero from outside, as the c8 critic's lab does: hero.js's own patch runs first, then this one inserts after the
// skin block (it ends 'roughnessFactor = pRough;\n}'). Per-vertex aHairD (added to h.body.geometry) carries x the scalp's hair density
// (the base under the cards, and the stubble of a buzz or a shaved horseshoe), y the beard zone, z the brow zone.
//   - scalp base: under hair the scalp takes a dark root colour, so a gap between cards reads as hair in shadow, not bare skin;
//   - follicles: a cellular field (~1.1 mm cells on the scalp, ~1.4 mm in the beard: 50-80 follicles per cm2), each a short dash along
//     the hair's direction plus a slight raised normal; under the skin the shafts give stubble its blue-grey cast; when a cell is
//     under ~2 px the dashes fade into their mean tint (no aliasing at 270 px);
//   - the painted brow (hero.js SKIN_FRAG's inBrow strokes and lid shadow) is multiplied by hzBrow where the source is found (the H2
//     hook skinU.hBrow will make this robust); card brows then replace it.
const SKIN_V_PARS = 'attribute vec4 aHairD; varying vec4 vHairD;', SKIN_V = 'vHairD = aHairD;';
const SKIN_F_PARS = `varying vec4 vHairD; uniform vec3 hzBase, hzStubC; uniform vec4 hzK, hzC; uniform float hzBrow, hzSoft; uniform vec3 hzKn[12]; uniform vec3 hzBr[9], hzBrC, hzBdC; uniform vec4 hzBrK, hzBz0, hzBz1, hzBz2;
float hzS(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
// the beard zone (face.js beardZone) per pixel: the cheek line, the neckline, the lips clear, the moustache band (the per-vertex zone
// drew the cheek line as a staircase: hm08's face vertices are ~1 cm apart there)
float hzBeard(vec3 p){ if (hzBz2.y + hzBz2.z + hzBz2.w <= 0.0 || hzK.y <= 0.001) return 0.0;
  float mY = hzBz0.x, mZ = hzBz0.y, hcz = hzBz0.z, fr = hzBz0.w, chinY = hzBz1.x, cheekHi = hzBz1.y, neckD = hzBz1.z, sf = hzBz1.w, eyeY = hzC.w;
  float ax = abs(p.x), ys = p.y - eyeY, fz = (p.z - hcz) / (fr - hcz), ph = abs(atan(p.x - hzC.x, p.z - hzC.z));
  float d = hzS(hzBz2.x - 0.03, hzBz2.x - 0.09, ph) * hzS(-0.14, -0.08, fz);
  float cl0 = mY - eyeY + 0.015, cl = cl0 + (cheekHi - cl0) * hzS(0.028, 0.068, ax);
  d *= hzS(cl + sf, cl - sf, ys);
  float nl = (chinY - neckD) + 0.03 * hzS(0.2, -0.3, fz); d *= hzS(nl - sf, nl + sf, p.y);
  vec2 lq = vec2(p.x / 0.027, (p.y - mY) / 0.0095); if (p.z > mZ - 0.025) d *= hzS(0.8, 1.15, dot(lq, lq));
  float inM = step(mY - eyeY + 0.004, ys) * step(ys, mY - eyeY + 0.02) * step(ax, 0.03) * step(mZ - 0.03, p.z);
  float inC = (1.0 - inM) * step(ax, 0.03) * step(p.y, mY) * step(chinY - 0.03, p.y) * step(mZ - 0.04, p.z);
  return d * (inM * hzBz2.y + inC * hzBz2.z + (1.0 - inM - inC) * hzBz2.w); }
// the style's hairline (grow.js hairlineFn's knots: azimuth from the front, height above the eye centre), evaluated per pixel: the
// skin's vertices are ~1 cm apart on hm08's scalp, so a per-vertex mask would draw the hairline as a staircase
// (a C1 cubic Hermite with the knots' monotone slopes in z)
float hzLine(float aph){ float v = hzKn[11].y; for (int k = 1; k < 12; k++) { if (aph <= hzKn[k].x) { vec3 a = hzKn[k - 1], b = hzKn[k]; float dx = b.x - a.x + 1e-6, t = clamp((aph - a.x) / dx, 0.0, 1.0), t2 = t * t, t3 = t2 * t;
  v = (2.0 * t3 - 3.0 * t2 + 1.0) * a.y + (t3 - 2.0 * t2 + t) * dx * a.z + (-2.0 * t3 + 3.0 * t2) * b.y + (t3 - t2) * dx * b.z; break; } } return v; }
// the card brows' own base on the skin: the brow's centre line and thickness (face.js browShape, knots in |x|) as a soft tone under
// the cards, so the cards read as hair over a brow rather than strokes on bare skin (the painted brow is switched off under it)
float hzBrowBase(vec3 b){ float ax = abs(b.x); if (hzBrK.x <= 0.0 || b.z < hzBrK.y || ax < hzBr[0].x - 0.004 || ax > hzBr[8].x + 0.004) return 0.0;
  vec3 q = hzBr[8]; float u = 1.0; for (int k = 1; k < 9; k++) { if (ax <= hzBr[k].x) { vec3 a = hzBr[k - 1], c = hzBr[k]; float t = clamp((ax - a.x) / (c.x - a.x + 1e-6), 0.0, 1.0); q = mix(a, c, t); u = (float(k - 1) + t) / 8.0; break; } }
  if (ax < hzBr[0].x) { q = hzBr[0]; u = 0.0; }
  float d = abs(b.y - hzC.w - q.y) / (0.5 * q.z), ends = smoothstep(-0.06, 0.1, u - (hzBr[0].x - ax) * 40.0) * smoothstep(1.06, 0.86, u + max(0.0, ax - hzBr[8].x) * 40.0);
  return smoothstep(1.2, 0.35, d) * ends; }
vec2 hzH2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
// a dash per cell: distance to a short segment along dir, in cell units; returns coverage 0..1
float hzDash(vec2 q, vec2 dir, float len, float wid){ vec2 c = floor(q), f = fract(q); float m = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 g = vec2(float(i), float(j)), r = hzH2(c + g), o = g + 0.2 + 0.6 * r - f;
    float t = clamp(dot(-o, dir), 0.0, len * (0.6 + 0.8 * r.x)); vec2 d = -o - dir * t; m = max(m, smoothstep(wid, wid * 0.3, length(d)) * step(0.15, r.y)); }
  return m; }
float hzFol(vec3 b, float cellM, vec2 dir, float len){ vec2 q = vec2(b.x + 0.37 * b.z, b.y + 0.21 * b.z) / cellM; float px = length(fwidth(q));
  float d = hzDash(q, dir, len, 0.09 + 0.25 * min(px, 1.0)); float mean = 0.11 + 0.25 * len; return mix(d, mean, smoothstep(0.25, 0.6, px)); }`;
const SKIN_F = `
{ vec3 bz = vBind; vec3 c = diffuseColor.rgb; float bd = hzBeard(bz);
  float aph = abs(atan(bz.x - hzC.x, bz.z - hzC.z)), jag = (vn3(bz * 900.0) - 0.5) * 0.0025 + (vn3(bz * 140.0) - 0.5) * 0.003;
  float e = bz.y - hzC.w + jag - hzLine(aph), sc = vHairD.x * smoothstep(-hzSoft, hzSoft, e) * (0.12 + 0.88 * smoothstep(0.001, 0.02, e + (vn3(bz * 700.0) - 0.5) * 0.006));
  { float bb = hzBrowBase(bz); if (bb > 0.0) { float nz = vn3(vec3(bz.x * 1800.0, bz.y * 500.0, 3.1)); c = mix(c, hzBrC, clamp(hzBrK.x * bb * (0.7 + 0.45 * nz), 0.0, 1.0)); } }
  // integration v3: the follicle dashes (hzFol takes fwidth) evaluated BEFORE their branches: derivatives in non-uniform flow are
  // undefined on a GPU quad straddling the condition (1-px lines at the hairline and the beard zone's edge on the V100s; FACE3's finding)
  float fSc = hzFol(bz, 0.0011, normalize(vec2(0.15, -1.0)), hzK.z), fBd = 0.0; if (hzK.y > 0.001) fBd = hzFol(bz, 0.0014, normalize(vec2(-0.25 * sign(bz.x), -1.0)), 0.3 + 0.75 * min(hzK.y, 1.0));   // (hzK: uniforms)
  if (sc > 0.003) { float f = fSc;
    c = mix(c, hzBase, clamp(sc * hzK.x * (0.85 + 0.15 * f), 0.0, 1.0));
    c = mix(c, hzBase * 0.6, clamp(sc * hzK.w * f, 0.0, 1.0)); }
  if (bd > 0.003 && hzK.y > 0.001) { float f = fBd;   // heavier stubble: longer dashes, a darker far mean
    c = mix(c, c * hzStubC, clamp(bd * hzK.y * 0.6, 0.0, 1.0));
    c = mix(c, hzBdC, clamp(bd * hzK.y * f * 1.1, 0.0, 1.0)); roughnessFactor = mix(roughnessFactor, 0.6, bd * hzK.y * 0.5); }
  diffuseColor.rgb = c; }`;
const SKIN_N = `
{ vec3 bz = vBind; float aph = abs(atan(bz.x - hzC.x, bz.z - hzC.z)); float bdN = hzBeard(bz), a = vHairD.x * smoothstep(hzLine(aph) - hzSoft, hzLine(aph) + hzSoft, bz.y - hzC.w) * hzK.w + bdN * hzK.y;
  float hgt = hzFol(bz, bdN > vHairD.x ? 0.0014 : 0.0011, normalize(vec2(0.1, -1.0)), 0.5) * a * 0.00012;   // integration v3: the bump's derivatives in uniform flow (above)
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition), r1 = cross(dy, normal), r2 = cross(normal, dx); float gx = dFdx(hgt), gy = dFdy(hgt), det = dot(dx, r1);
  if (a > 0.01) {
    float gm = max(abs(gx), abs(gy)), cap = 0.00008; if (gm > cap) { gx *= cap / gm; gy *= cap / gm; }
    vec3 grad = sign(det) * (gx * r1 + gy * r2); normal = normalize(abs(det) * normal - grad); } }`;
// HAIR5 (rev 5, opt-in: skinUniforms' hzPart / hzPart2 set by groomHero rev 5): the part a line of skin: the scalp's dark root base
// (hzBase) opens along the style's part plane over the top of the head (hzPart = (m.x, m.z, half width m, strength; 0 = no part);
// hzPart2 = (ry, rz) of the skull, the root base's ramp inside the hairline (m: 0.8 cm, rev 1-4 2 cm: the skin showed between the card
// roots right behind the line), -), with a little jag. Without hzPart the source is exactly as before.
const SKIN_F_PARS5 = SKIN_F_PARS + `
uniform vec4 hzPart, hzPart2, hzPart3;
// (HAIR7 c3 iteration 2) hzPart3 = the roots' jag along the part (v7.js part7: amplitude, wavelengths l0 l1, phase 0; phase 1 in hzPart2.w):
// the painted line follows the same zig-zag as the roots and the hair (amplitude 0: the straight line, as before)
float hzJag(vec3 q){ if (hzPart3.x <= 0.0) return 0.0; return hzPart3.x * (0.65 * sin(q.z / hzPart3.y * 6.2831853 + hzPart3.w) + 0.35 * sin(q.z / hzPart3.z * 6.2831853 + hzPart2.w)); }
float hzPartK(vec3 b, float nz){ if (hzPart.w <= 0.0) return 0.0; vec3 q = b - hzC.xyz; float d = abs(q.x * hzPart.x + q.z * hzPart.y - hzJag(q)) + (nz - 0.5) * 0.0011;
  return hzPart.w * smoothstep(hzPart.z * 1.25, hzPart.z * 0.35, d) * smoothstep(0.22, 0.5, q.y / hzPart2.x) * smoothstep(-0.6, -0.25, q.z / hzPart2.y); }`;
const SKIN_F5 = SKIN_F.replace('(0.12 + 0.88 * smoothstep(0.001, 0.02, e + (vn3(bz * 700.0) - 0.5) * 0.006))', '(0.12 + 0.88 * smoothstep(0.0005, hzPart2.z, e + (vn3(bz * 700.0) - 0.5) * 0.004))')
  .replace('  { float bb = hzBrowBase(bz);', '  sc *= 1.0 - hzPartK(bz, vn3(bz * 650.0));\n  { float bb = hzBrowBase(bz);');
const BROW_SRC = 'col = mix(col, hHair * 0.45, inBrow * (0.35 + 0.65 * strokes));';
const BROW_SH = 'col *= 1.0 - 0.12 * smoothstep(0.012, 0.0, d + 0.006)';
const BROW_SH_FULL = 'col *= 1.0 - 0.12 * smoothstep(0.012, 0.0, d + 0.006) * smoothstep(-0.02, 0.0, d + 0.006) * step(0.008, ax) * smoothstep(0.06, 0.045, ax) * step(eL.z - 0.03, b.z);';
const BROW_SH_SOFT = 'col *= 1.0 - 0.12 * smoothstep(0.012, 0.0, d + 0.006) * smoothstep(-0.024, 0.0, d + 0.006) * smoothstep(0.0, 0.018, ax) * smoothstep(0.066, 0.036, ax) * smoothstep(eL.z - 0.045, eL.z - 0.02, b.z);';
export function patchSkin(h, U) {
  const mat = h.body.material; if (mat.userData.hair8) { Object.assign(mat.userData.hair8, U); return mat.userData.hair8; }
  const prev = mat.onBeforeCompile, key0 = mat.customProgramCacheKey;
  const report = { brow: 'pending' };
  mat.onBeforeCompile = (sh, r) => { prev.call(mat, sh, r); Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + SKIN_V_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SKIN_V);
    let fs = sh.fragmentShader;
    // HUMAN c8 HOOKS: with hero.js's H2 (skinU.hBrow, set by index.js) hero.js weights and softens its own brow: no string patch here
    const hook = !!h.skinU.hBrow, hasB = !hook && fs.includes(BROW_SRC), hasS = fs.includes(BROW_SH);
    if (hasB) fs = fs.replace(BROW_SRC, 'col = mix(col, hHair * 0.45, hzBrow * inBrow * (0.35 + 0.65 * strokes));');
    // (the brow ridge's shadow on the lid is modelling, not pigment: it stays, with its box ends softened when card brows are on)
    if (!hook && U.hzBrow.value < 0.5 && fs.includes(BROW_SH_FULL)) fs = fs.replace(BROW_SH_FULL, BROW_SH_SOFT);
    report.brow = hook ? (h.skinU.hBrow.value < 0.5 ? 'painted brow off through the H2 hook skinU.hBrow' : 'painted brow kept (H2 hook skinU.hBrow = 1)') : hasB ? 'painted brow off from outside (hzBrow string patch; H2 hook skinU.hBrow not present)' : 'painted brow NOT found: it overlaps the card brows (needs H2 skinU.hBrow)';
    void hasS;
    // the skin's 'paint' section (hero.js's //@skin-paint marker: after lane B's albedo, before lane E's style), else the old anchor
    const P5 = !!U.hzPart;   // (HAIR5: the part line)
    fs = fs.replace('#include <common>', '#include <common>\n' + (P5 ? SKIN_F_PARS5 : SKIN_F_PARS));
    fs = fs.includes('//@skin-paint') ? fs.replace('//@skin-paint', (P5 ? SKIN_F5 : SKIN_F) + '\n//@skin-paint') : fs.replace('roughnessFactor = pRough;\n}', 'roughnessFactor = pRough;\n}\n' + (P5 ? SKIN_F5 : SKIN_F));
    fs = fs.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + SKIN_N);
    sh.fragmentShader = fs; };
  mat.customProgramCacheKey = () => key0() + (U.hzPart ? '-hair8p' : '-hair8');
  mat.needsUpdate = true;
  mat.userData.hair8 = U; mat.userData.hair8report = report;
  return U;
}
export function skinUniforms(o = {}) {
  return { hzC: { value: new THREE.Vector4() }, hzSoft: { value: 0.004 }, hzKn: { value: Array.from({ length: 12 }, () => new THREE.Vector3(0, 9, 0)) }, hzBase: { value: new THREE.Color(o.base || '#1a120c') }, hzStubC: { value: new THREE.Color(o.stubTint || '#9aa0a8') }, hzK: { value: new THREE.Vector4(o.baseK ?? 0.85, o.stub ?? 0, o.dash ?? 0.6, o.shave ?? 0) }, hzBrow: { value: o.brow ?? 1 },
    hzBr: { value: Array.from({ length: 9 }, () => new THREE.Vector3()) }, hzBrC: { value: new THREE.Color('#2a1c14') }, hzBrK: { value: new THREE.Vector4(0, 9, 0, 0) },
    hzBdC: { value: new THREE.Color('#2a1c14') }, hzBz0: { value: new THREE.Vector4() }, hzBz1: { value: new THREE.Vector4() }, hzBz2: { value: new THREE.Vector4(0, 0, 0, 0) } };
}
