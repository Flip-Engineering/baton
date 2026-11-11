// HAIRMAT (round 7, iteration 2, 8 Oct): the hair FIBRE in the ENGINE. The same fibre the Cycles render uses (fibre.js fibreModel: keratin
// eta 1.55, cuticle tilt 3 deg, the person's eumelanin / pheomelanin, longitudinal width 6 deg at the root -> 9 deg at weathered ends,
// azimuthal roughness 0.30, the unpigmented fraction of fibres, the sun oxidation of the lengths), shaded on the scalp's hair as a
// far-field fibre BSDF instead of the card shader's tuned lobes (shade.js rev 6: lobe widths from Cycles' old roughness 0.32-0.40,
// per-form strength factors, an albedo gain and a desaturation fitted on swatches).
//
//   import { applyFibreEngine, castFromName } from '/web/lib/fx/hair/material/engine.js';
//   applyFibreEngine(P.h.group, { ...castFromName('L08_f24_hispanic') })   // after makePerson, before the first render
//
// THE BSDF (per light, per pixel of hair; a pixel holds many fibres at every offset h, so the azimuthal terms are the far field):
//   S(theta_i, theta_o, phi) = sum_p M_p(theta_h) N_p(phi) / cos^2(theta_d)                       (Marschner et al. 2003, eq. for S)
//   M_p   Gaussians in theta_h = (theta_i + theta_o) / 2 at the cuticle shifts alpha_R = -2 alpha, alpha_TT = alpha, alpha_TRT = 3 alpha,
//         widths beta, beta / 2, 2 beta (Marschner 2003; Chiang et al. 2016's v_TT = v / 4, v_TRT = 4 v)
//   N_R   1/4 cos(phi / 2) F(cos theta_d cos(phi / 2))            (Marschner 2003: the smooth fibre's R, exact in the far field)
//   N_TT, N_TRT  1/2 int A_p(h) D_p(phi - Phi(p, h)) dh           (Chiang et al. 2016: Phi = 2 p gamma_t - 2 gamma_o + p pi, a trimmed logistic
//         of scale s(beta_n), A_1 = (1 - f)^2 T, A_2 = (1 - f)^2 f T^2, T = exp(-sigma_a 2 cos gamma_t)): tabulated in fibre.js engineLobes for
//         the person's pigment and for the unpigmented fibre, per colour channel, on phi in [0, pi]
//   Lo = E cos(theta_i) S x the deep-opacity visibility of single scattering (shade.js's getShadowH6: h6Dk)
// MULTIPLE SCATTERING (the light that has crossed many fibres; Zinke, Yuksel, Weber, Keyser 2008, dual scattering): the colour of a dense
// volume of these fibres, c = exp(-sqrt(sigma_a) K(beta_n)) (Chiang et al. 2016 sec. 4.4), lit through the volume's forward-scattered
// transmittance (h6Tc) with an isotropic medium's response (1 + n.l) / 2 on the volume's normal.
// THE ROOM (environment, ambient): an isotropic room lights every azimuth, so each lobe returns its share rho_p = int Psi_p dphi of the
// irradiance: R (white, ~0.075) as the sheen, TRT and the multiple scattering as the colour, occluded by the hair's own occlusion (hAO: the
// strand tiles' baked occlusion and the depth in the volume). TT is forward: in a dense mass the light it carries IS the multiple scattering.
// PER STRAND (where a strand is resolved; the mean where strands are under a pixel): the pigment x a lognormal (sd 0.15), the longitudinal
// width x (1 + 0.08 z), grey strands unpigmented (the same strands shade.js picks, by the same hash); ALONG THE LENGTH: the pigment x
// (1 - B w(s)) and the width beta(s) from the weathering law w(s) = 1 - exp(-(s / growth) / tau), s from the root in metres (the card's
// strand tangent carries it: shade.js HAIR5's encoding, |aHairT| = 2 + 100 s).
// Coverage, the strand tiles, the flow-map tangent, the deep opacity and the scalp under the hair stay shade.js's (HAIR7's). The coverage
// cut shade.js gives grey strands (h4G.x: a stand-in for their translucency) is set to 0: an unpigmented fibre is translucent through TT.
// Nothing here is fitted to a render or a photograph. Uniforms only change between people; the program is one per page.
import * as THREE from 'three';
import { fibreModel, EU, PH } from './fibre.js';

export const ENGINE_REV = 1;

// the cast from one of the twelve's names (L08_f24_hispanic -> f, 24, hispanic); melanin and grey come from the built material
export function castFromName(name) {
  const m = String(name || '').replace(/^((?:v\d+|latest|lineup|current):)+/, '').match(/^L\d+_([fm])(\d+)_([a-z_]+)/i);
  return m ? { sex: m[1].toLowerCase(), age: +m[2], group: m[3].toLowerCase() } : {};
}
// eu, ph from shade.js's sigma (hairColour5: sigma = eu EU + ph PH in Cycles' units, the same coefficients as fibre.js): least squares
export function melaninOfSigma(s) {
  let a = 0, b = 0, c = 0, d = 0, e = 0; for (let i = 0; i < 3; i++) { a += EU[i] * EU[i]; b += EU[i] * PH[i]; c += PH[i] * PH[i]; d += EU[i] * s[i]; e += PH[i] * s[i]; }
  const det = a * c - b * b, eu = (c * d - b * e) / det, ph = (a * e - b * d) / det;
  return { eu: Math.max(0, +eu.toFixed(4)), ph: Math.max(0, +ph.toFixed(4)) };
}

// the lobe tables as a 32 x 4 float texture: rows TT, TRT (the person's pigment), TT, TRT (the unpigmented fibre)
function tableTexture(E) {
  const n = E.tab.n, rows = [E.tab.TT, E.tab.TRT, E.tab.TTw, E.tab.TRTw], data = new Float32Array(n * rows.length * 4);
  rows.forEach((r, j) => r.forEach((v, k) => { data.set([v[0], v[1], v[2], 1], (j * n + k) * 4); }));
  const t = new THREE.DataTexture(data, n, rows.length, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t;
}
export function fibreUniforms(F) {
  const E = F.engine;
  return {
    hmTab: { value: tableTexture(E) },
    hmShift: { value: new THREE.Vector4(E.shiftRad.R, E.shiftRad.TT, E.shiftRad.TRT, 0) },
    hmBeta: { value: new THREE.Vector4(E.betaRad.root, E.betaRad.tip, 0, E.spread.rough) },
    hmSig: { value: new THREE.Vector3(...E.sigma) }, hmSigW: { value: new THREE.Vector3(...E.sigmaWhite) },
    hmMisc: { value: new THREE.Vector4(E.K, E.chord, E.spread.mel, E.grey) },
    hmWeather: { value: new THREE.Vector4(E.weather.bleach, E.weather.tauMonths, E.weather.growthCmPerMonth, 0) },
    hmRho: { value: new THREE.Vector4(E.rho.R, 0, 0, 0) },
    hmRhoTRT: { value: new THREE.Vector3(...E.rho.TRT) }, hmRhoTRTw: { value: new THREE.Vector3(...E.rho.TRTw) },
  };
}

const N_TAB = 32;
const PARS = `
uniform sampler2D hmTab; uniform vec4 hmShift, hmBeta, hmMisc, hmWeather, hmRho; uniform vec3 hmSig, hmSigW, hmRhoTRT, hmRhoTRTw;
vec3 hmK1 = vec3(1.0), hmRhoT = vec3(0.0); float hmGk = 0.0, hmB = 0.1;
float hmG(float x, float b) { return exp(-0.5 * x * x / (b * b)) / (2.5066283 * b); }
float hmFr(float ci) { ci = clamp(ci, 0.0, 1.0); float s2 = (1.0 - ci * ci) / (1.55 * 1.55); if (s2 >= 1.0) return 1.0; float ct = sqrt(1.0 - s2);
  float rs = (ci - 1.55 * ct) / (ci + 1.55 * ct), rp = (1.55 * ci - ct) / (1.55 * ci + ct); return 0.5 * (rs * rs + rp * rp); }
vec3 hmTabAt(int row, float phi) { float x = clamp(phi / 3.14159265, 0.0, 1.0) * ${N_TAB - 1}.0; int i = int(floor(x)); int j = min(i + 1, ${N_TAB - 1}); float t = x - float(i);
  return mix(texelFetch(hmTab, ivec2(i, row), 0).rgb, texelFetch(hmTab, ivec2(j, row), 0).rgb, t); }
`;
// after shade.js's FRAG6 (coverage, flow tangent hT, occlusion hAO) and the normal: this strand's pigment, width and grey
const FRAG = `
{ vec2 uvM = vec2(vHUV.x, fract(vHUV.y)), gxM = dFdx(vHUV), gyM = dFdy(vHUV);
  vec4 txM = textureGrad(hAtlas, uvM, gxM, gyM);
  vec2 fpM = vec2(length(gxM * vec2(2048.0, 512.0)), length(gyM * vec2(2048.0, 512.0)));
  float resM = 1.0 - smoothstep(1.0, 3.0, max(fpM.x, fpM.y));
  float srM = fract(sin(txM.r * 255.0 * 12.9898 + vHair.z * 78.233) * 43758.5453);
  float gFM = clamp(hGrey * (1.0 + vHair.w), 0.0, 1.0); hmGk = mix(gFM, srM < gFM ? 1.0 : 0.0, resM);
  float lTM = length(vHairT), sM = lTM > 1.5 ? (lTM - 2.0) * 0.01 : 0.0;
  float wM = 1.0 - exp(-(sM * 100.0 / hmWeather.z) / hmWeather.y);
  float u1 = clamp(fract(srM * 7.13 + 0.31), 0.001, 0.999), u2 = clamp(fract(srM * 3.97 + 0.67), 0.001, 0.999);
  float z1 = 0.5513 * log(u1 / (1.0 - u1)), z2 = 0.5513 * log(u2 / (1.0 - u2));
  vec3 sigM = hmSig * mix(1.0, exp(hmMisc.z * z1), resM) * (1.0 - hmWeather.x * wM);
  diffuseColor.rgb = mix(exp(-sqrt(max(sigM, vec3(0.0))) * hmMisc.x), exp(-sqrt(hmSigW) * hmMisc.x), hmGk);
  hmK1 = exp(-(sigM - hmSig) * hmMisc.y);
  hmRhoT = mix(hmRhoTRT * hmK1 * hmK1, hmRhoTRTw, hmGk);
  hmB = (hmBeta.x + (hmBeta.y - hmBeta.x) * wM) * max(0.5, 1.0 + hmBeta.w * z2 * resM);
}
`;
const SIG = 'const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight';
const DIRECT = `void RE_Direct_Physical( ${SIG} ) {
  vec3 L = directLight.direction, V = geometryViewDir, T = hT;
  float sI = clamp(dot(T, L), -0.9999, 0.9999), sO = clamp(dot(T, V), -0.9999, 0.9999);
  float tI = asin(sI), tO = asin(sO), tH = 0.5 * (tI + tO), cD = max(cos(0.5 * (tO - tI)), 0.25), cI = sqrt(1.0 - sI * sI);
  vec3 lp = L - T * sI, vp = V - T * sO; float ll = length(lp), lv = length(vp);
  float cphi = (ll > 1e-4 && lv > 1e-4) ? clamp(dot(lp, vp) / (ll * lv), -1.0, 1.0) : 1.0, phi = acos(cphi), c2 = cos(0.5 * phi);
  float MR = hmG(tH - hmShift.x, hmB), MTT = hmG(tH - hmShift.y, 0.5 * hmB), MTRT = hmG(tH - hmShift.z, 2.0 * hmB);
  float NR = 0.25 * c2 * hmFr(cD * c2);
  vec3 NTT = mix(hmTabAt(0, phi) * hmK1, hmTabAt(2, phi), hmGk), NTRT = mix(hmTabAt(1, phi) * hmK1 * hmK1, hmTabAt(3, phi), hmGk);
  vec3 S = (MR * NR + MTT * NTT + MTRT * NTRT) / (cD * cD);
  reflectedLight.directSpecular += directLight.color * h6Dk * cI * S;
  reflectedLight.directDiffuse += directLight.color * h6Tc * material.diffuseColor * RECIPROCAL_PI * (0.5 + 0.5 * dot(geometryNormal, L));
  h6Dk = 1.0; h6Tc = vec3(1.0);
}`;
const IND_D = `void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  reflectedLight.indirectDiffuse += irradiance * RECIPROCAL_PI * (material.diffuseColor + hmRhoT) * hAO;
  reflectedLight.indirectSpecular += irradiance * RECIPROCAL_PI * hmRho.x * hAO;
}`;
const IND_S = `void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  reflectedLight.indirectDiffuse += irradiance * RECIPROCAL_PI * (material.diffuseColor + hmRhoT) * hAO;
  reflectedLight.indirectSpecular += irradiance * RECIPROCAL_PI * hmRho.x * hAO;
}`;
// replace a whole GLSL function (its signature to its matching brace)
function replaceFn(src, name, body) {
  const i = src.indexOf('void ' + name + '(');
  if (i < 0) throw new Error('hairmat engine: ' + name + ' not found in the hair program');
  let j = src.indexOf('{', i), depth = 0, k = j;
  for (; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) break; }
  return src.slice(0, i) + body + src.slice(k + 1);
}
export function patchFragment(fs) {
  if (!fs.includes('getShadowH6') && !fs.includes('h6Dk')) throw new Error('hairmat engine: not shade.js rev 6 hair (no h6Dk)');
  if (!fs.includes('#include <lights_physical_fragment>')) throw new Error('hairmat engine: no lights_physical_fragment anchor');
  let out = fs.replace('#include <common>', '#include <common>\n' + PARS).replace('#include <lights_physical_fragment>', FRAG + '#include <lights_physical_fragment>');
  out = replaceFn(out, 'RE_Direct_Physical', DIRECT);
  out = replaceFn(out, 'RE_IndirectDiffuse_Physical', IND_D);
  out = replaceFn(out, 'RE_IndirectSpecular_Physical', IND_S);
  return out;
}

// the scalp's hair materials under a built person (shade.js rev 6: userData.shade.rev 6, the scalp and fringe share one): patch each once
export function applyFibreEngine(root, cast = {}) {
  const mats = new Set(); root.traverse(o => { if (o.isMesh && (o.userData.hairPart === 'scalp' || o.userData.hairPart === 'fringe') && o.material?.userData?.hairU && o.material.userData.shade?.rev === 6) mats.add(o.material); });
  const out = [];
  for (const mat of mats) {
    if (mat.userData.hairmatE) { out.push(mat.userData.hairmatE); continue; }
    const U = mat.userData.hairU, mel = cast.melanin || melaninOfSigma(U.hSig.value.toArray()), grey = cast.grey ?? U.hGrey.value;
    const F = fibreModel({ ...cast, melanin: mel, grey }), HU = fibreUniforms(F);
    if (U.h4G) U.h4G.value.x = 0;   // no coverage cut for grey strands: their translucency is TT's
    const prev = mat.onBeforeCompile, key0 = mat.customProgramCacheKey;
    mat.onBeforeCompile = (sh, r) => { prev.call(mat, sh, r); Object.assign(sh.uniforms, HU); sh.fragmentShader = patchFragment(sh.fragmentShader); };
    mat.customProgramCacheKey = () => (key0 ? key0.call(mat) : '') + '|hairmat-e' + ENGINE_REV;
    mat.needsUpdate = true;
    const rep = { rev: ENGINE_REV, cast: F.cast, melanin: mel, grey, rhoR: +F.engine.rho.R.toFixed(4), rhoTT: F.engine.rho.TT.map(x => +x.toFixed(4)), rhoTRT: F.engine.rho.TRT.map(x => +x.toFixed(5)),
      mass: F.engine.mass.map(x => +x.toPrecision(3)), massWhite: F.engine.massWhite.map(x => +x.toFixed(3)), betaDeg: [F.optics.betaRootDeg, F.optics.betaTipDeg], bleach: F.weather.bleach };
    mat.userData.hairmatE = rep; mat.userData.hairmatU = HU; out.push(rep);
  }
  return { materials: out.length, each: out };
}
