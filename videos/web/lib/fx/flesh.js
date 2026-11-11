// FLESH: skin, hair, cloth and rim light for three.js standard materials, and for people.js crowds without editing
// people.js. The goal is not a beauty render: it makes the lit sliver of a rim-lit or back-lit worker read as a living
// body (red terminator, glowing ears and fingers against the sun, a hot sky-coloured rim, hair that catches light
// along the strand, cloth with a soft sheen at the silhouette) and it gives the hero a key light nobody else gets
// (the Chinese poster "three prominences": the central hero is the brightest thing on stage).
//
//   import { patchPeople, patchMaterial, skinLUT } from '../lib/fx/flesh.js';
//   const fl = patchPeople(folk, { sss: 8, rim: 1.4, rimPow: 3, trans: 1.2, sheen: 0.6, hair: 1, warm: '#2a0604',
//                                  sky: '#ff9a70', key: { dir: [0.4, 0.2, 1], color: '#ffd2b0', intensity: 1.5 }, hero: id });
//   fl.set({ rim: 2 });                                       // live uniform changes (per frame is fine)
//   patchMaterial(mat, { skin: 1, ... })                      // any MeshStandard/Physical material; skin: 0..1 or a GLSL float expression
//
// Call before the first render (it hooks onBeforeCompile). Techniques:
// - Pre-integrated skin scattering (Penner & Borshukov, GPU Pro 2, 2011): a 128x64 LUT of the d'Eon-Luebke six-Gaussian
//   skin profile integrated over a ring of radius r, keyed by N.L and 1/r, baked here in JS at load (about 60 ms). `sss`
//   scales the effective scattering radius (art-directable: 1 = physical, 6-10 = a painted, warm terminator).
// - Curvature from the part (head, ear, finger...) for people.js, so it never shimmers; from screen derivatives otherwise.
// - Translucency (Barré-Brisebois & Bouchard 2011 "fast SSS"): light from behind through thin parts, tinted blood-red.
// - Rim: Fresnel-weighted, gated to the sun side and boosted when the light is behind the subject, plus a sky rim.
// - Kajiya-Kay (1989) hair with two shifted lobes (Scheuermann 2004) and a strand-noise shift, on people.js hair/beards.
// - Cloth: an Ashikhmin-style asperity sheen at grazing angles on everything that is not skin or hair.
// - Hero key: an extra light only instance `hero` receives (people.js), or everything when hero = -1.
// - Warm floor: the unlit side goes to a warm dark instead of black (the "red, bright, shining" rule).
import * as THREE from 'three';

// ------------------------------------------------------------------ the pre-integrated skin LUT
const PROFILE = [      // d'Eon & Luebke 2007, variances in mm^2 and RGB weights
  [0.0064, 0.233, 0.455, 0.649], [0.0484, 0.100, 0.336, 0.344], [0.187, 0.118, 0.198, 0.0],
  [0.567, 0.113, 0.007, 0.007], [1.99, 0.358, 0.004, 0.0], [7.41, 0.078, 0.0, 0.0]];
let _lut = null;
export function skinLUT(w = 128, h = 64) {
  if (_lut) return _lut;
  const data = new Uint8Array(w * h * 4), N = 200;
  for (let j = 0; j < h; j++) {
    const y = (j + 0.5) / h, r = 2 / Math.max(y, 0.004);            // y = 2 mm / r  (so y = 1 is a 2 mm radius)
    for (let i = 0; i < w; i++) {
      const theta = Math.acos(((i + 0.5) / w) * 2 - 1);
      const tot = [0, 0, 0], wt = [0, 0, 0];
      for (let k = 0; k < N; k++) {
        const x = -Math.PI + (k + 0.5) / N * 2 * Math.PI, dist = Math.abs(2 * r * Math.sin(x / 2)), lit = Math.max(0, Math.cos(theta + x));
        for (const [v, R, G, B] of PROFILE) {
          const g = Math.exp(-dist * dist / (2 * v)) / (2 * Math.PI * v), c = [R, G, B];
          for (let ch = 0; ch < 3; ch++) { tot[ch] += c[ch] * g * lit; wt[ch] += c[ch] * g; }
        }
      }
      for (let ch = 0; ch < 3; ch++) { const v = wt[ch] > 0 ? tot[ch] / wt[ch] : Math.max(0, Math.cos(theta)); data[(j * w + i) * 4 + ch] = Math.round(Math.pow(Math.min(1, v), 1 / 2.2) * 255); }
      data[(j * w + i) * 4 + 3] = 255;
    }
  }
  _lut = new THREE.DataTexture(data, w, h, THREE.RGBAFormat); _lut.minFilter = _lut.magFilter = THREE.LinearFilter; _lut.needsUpdate = true;
  return _lut;
}

const DEF = { sss: 6, rim: 1.0, rimPow: 3.0, rimBack: 1.5, trans: 1.0, transColor: '#ff3a1c', sheen: 0.5, hair: 1.0, sky: '#000000', skyRim: 0.0,
  warm: '#000000', key: null, hero: -1, skin: 1, curv: 12, spec2: 0.35 };

const col = (c, k = 1) => { const v = new THREE.Color(c); return new THREE.Vector3(v.r * k, v.g * k, v.b * k); };

function makeUniforms(o) {
  const U = {
    flLUT: { value: skinLUT() }, flSSS: { value: 0 }, flRim: { value: 0 }, flRimPow: { value: 3 }, flRimBack: { value: 1 }, flTrans: { value: 0 },
    flTransCol: { value: new THREE.Vector3() }, flSheen: { value: 0 }, flHair: { value: 0 }, flSky: { value: new THREE.Vector3() }, flWarm: { value: new THREE.Vector3() },
    flKeyDir: { value: new THREE.Vector3(0, 0, 1) }, flKeyCol: { value: new THREE.Vector3() }, flHero: { value: -1 }, flCurv: { value: 12 }, flSpec2: { value: 0.35 },
  };
  const set = (p) => {
    o = { ...o, ...p };
    U.flSSS.value = o.sss; U.flRim.value = o.rim; U.flRimPow.value = o.rimPow; U.flRimBack.value = o.rimBack; U.flTrans.value = o.trans;
    U.flTransCol.value.copy(col(o.transColor)); U.flSheen.value = o.sheen; U.flHair.value = o.hair; U.flSky.value.copy(col(o.sky, o.skyRim));
    U.flWarm.value.copy(col(o.warm)); U.flHero.value = o.hero; U.flCurv.value = o.curv; U.flSpec2.value = o.spec2;
    if (o.key) { const d = new THREE.Vector3(...(o.key.dir || [0.3, 0.3, 1])).normalize(); U.flKeyDir.value.copy(d); U.flKeyCol.value.copy(col(o.key.color || '#ffffff', o.key.intensity ?? 1)); }
    else U.flKeyCol.value.set(0, 0, 0);
  };
  set(o);
  return { U, set, get o() { return o; } };
}

const PARS = /* glsl */`
uniform sampler2D flLUT; uniform float flSSS, flRim, flRimPow, flRimBack, flTrans, flSheen, flHair, flHero, flCurv, flSpec2;
uniform vec3 flTransCol, flSky, flWarm, flKeyDir, flKeyCol;
float flSk = 0.0, flHr = 0.0, flThin = 0.0, flCurvY = 0.0, flIsHero = 0.0; vec3 flTan = vec3(0.0); float flStrand = 0.5;
float flH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float flN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(flH(i), flH(i + vec2(1, 0)), f.x), mix(flH(i + vec2(0, 1)), flH(i + vec2(1, 1)), f.x), f.y); }
vec3 flSkinDiffuse(float nl){ return pow(texture(flLUT, vec2(nl * 0.5 + 0.5, flCurvY)).rgb, vec3(2.2)); }   // stored gamma-encoded
float flKK(vec3 T, vec3 H, float e){ float th = dot(T, H); return pow(sqrt(max(0.0, 1.0 - th * th)), e); }
void RE_Direct_Flesh(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir,
                     const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight){
  float nl = dot(geometryNormal, directLight.direction), dotNL = saturate(nl);
  vec3 irr = dotNL * directLight.color;
  vec3 dif = mix(vec3(dotNL), flSkinDiffuse(nl), flSk) * directLight.color;
  reflectedLight.directDiffuse += dif * BRDF_Lambert(material.diffuseColor);
  reflectedLight.directSpecular += irr * BRDF_GGX(directLight.direction, geometryViewDir, geometryNormal, material) * (1.0 - flHr * 0.8);
  if (flSk > 0.0) {                  // a second, tighter oily lobe (Weyrich et al. measured two lobes on faces)
    PhysicalMaterial m2 = material; m2.roughness = 0.32;
    reflectedLight.directSpecular += irr * BRDF_GGX(directLight.direction, geometryViewDir, geometryNormal, m2) * flSpec2 * flSk;
  }
  if (flHr > 0.0) {                  // Kajiya-Kay, two lobes shifted along the normal, the second tinted by the hair
    vec3 H = normalize(directLight.direction + geometryViewDir);
    vec3 T1 = normalize(flTan + geometryNormal * (flStrand - 0.35)), T2 = normalize(flTan + geometryNormal * (flStrand - 0.65));
    float gate = smoothstep(-0.1, 0.3, nl);
    vec3 tint = mix(vec3(0.8, 0.75, 0.7), material.diffuseColor * 4.0, 0.5);
    vec3 s = directLight.color * gate * (tint * flKK(T1, H, 60.0) * 0.12 + material.diffuseColor * 2.5 * flKK(T2, H, 12.0) * 0.3 * (0.6 + 0.8 * flStrand));
    reflectedLight.directSpecular += s * flHr * flHair;
  }
}
`;
const PRE_LIGHTS = /* glsl */`
{
  // masks and frames for the lighting below (FL_SKIN / FL_HAIR / FL_THIN / FL_CURV / FL_HERO are per-material macros)
  flSk = clamp(FL_SKIN, 0.0, 1.0); flHr = clamp(FL_HAIR, 0.0, 1.0); flThin = clamp(FL_THIN, 0.0, 1.0); flIsHero = FL_HERO;
  float cv = FL_CURV;                                             // 1/m
  flCurvY = clamp(flSSS * 2.0 / (1000.0 / max(cv, 0.5)), 0.004, 0.996);
  vec3 downV = normalize((viewMatrix * vec4(0.0, -1.0, 0.0, 0.0)).xyz);
  flTan = normalize(downV - normal * dot(downV, normal) + 1e-4);
  flStrand = FL_STRAND;
}
`;
const POST_LIGHTS = /* glsl */`
{
  vec3 N = normal, V = geometryViewDir; float nv = saturate(dot(N, V)), fres = pow(1.0 - nv, flRimPow);
  vec3 rim = vec3(0.0), trans = vec3(0.0), sheen = vec3(0.0);
#if NUM_DIR_LIGHTS > 0
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
    vec3 L = directionalLights[i].direction, Lc = directionalLights[i].color;
    float back = saturate(dot(L, -V)), side = smoothstep(-0.08, 0.3, dot(N, L));
    rim += Lc * fres * side * (0.3 + flRimBack * back * back);
    float t = pow(saturate(dot(V, -normalize(L + N * 0.5))), 3.0) * (flThin * (0.55 + 0.45 * pow(1.0 - nv, 1.5)) + (1.0 - flThin) * pow(1.0 - nv, 3.0) * 0.25);
    trans += Lc * t;
    sheen += Lc * pow(1.0 - nv, 5.0) * smoothstep(-0.25, 0.5, dot(N, L)) * (0.4 + 0.6 * back);
  }
#endif
  vec3 alb = diffuseColor.rgb;
  reflectedLight.directDiffuse += flRim * rim * mix(vec3(1.0), alb * 2.5, 0.35 + 0.3 * flSk) * (1.0 - 0.5 * flHr);
  reflectedLight.directDiffuse += flTrans * trans * flTransCol * alb * 1.5 * flSk;
  reflectedLight.directDiffuse += flSheen * sheen * mix(alb, vec3(0.6), 0.4) * (1.0 - flSk) * (1.0 - flHr);
  float up = dot(N, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)) * 0.5 + 0.5;
  reflectedLight.indirectDiffuse += flSky * fres * (0.4 + 0.6 * up) * mix(vec3(1.0), alb * 2.0, 0.4);
  if (flIsHero > 0.5) {                                           // the hero key: pre-integrated for skin, Lambert otherwise
    float kl = dot(N, flKeyDir);
    vec3 kd = mix(vec3(saturate(kl)), flSkinDiffuse(kl), flSk);
    reflectedLight.directDiffuse += flKeyCol * kd * BRDF_Lambert(alb);
    PhysicalMaterial mk = material;
    reflectedLight.directSpecular += flKeyCol * saturate(kl) * BRDF_GGX(flKeyDir, V, N, mk) * 0.5;
  }
  reflectedLight.indirectDiffuse += flWarm * alb * (1.0 + flSk);
}
`;

// patch one material. m: { skin, hair, thin, curv, strand, hero } are GLSL float expressions (defaults: whole
// material is skin=o.skin, no hair, thin 0, derivative curvature, hero = all)
export function patchMaterial(mat, opts = {}, glsl = {}) {
  const P = makeUniforms({ ...DEF, ...opts });
  const G = { skin: String(Number(opts.skin ?? 1).toFixed(3)), hair: '0.0', thin: '0.0', strand: 'flN(vViewPosition.xy * 400.0)',
    curv: 'clamp(length(fwidth(normal)) / max(length(fwidth(vViewPosition)), 1e-5), 0.5, 400.0)', hero: '1.0', vary: '', vset: '', fvary: '', ...glsl };
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, P.U);
    if (G.vary) sh.vertexShader = G.vary + sh.vertexShader.replace('#include <project_vertex>', G.vset + '\n#include <project_vertex>');
    sh.fragmentShader = (G.fvary || '') + sh.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + PARS + '\n#undef RE_Direct\n#define RE_Direct RE_Direct_Flesh\n')
      .replace('#include <lights_fragment_begin>', `#define FL_SKIN (${G.skin})\n#define FL_HAIR (${G.hair})\n#define FL_THIN (${G.thin})\n#define FL_CURV (${G.curv})\n#define FL_STRAND (${G.strand})\n#define FL_HERO (${G.hero})\n` + PRE_LIGHTS + '#include <lights_fragment_begin>')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + POST_LIGHTS);
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|flesh:' + JSON.stringify(G);
  mat.needsUpdate = true;
  return P;
}

// people.js: skin = head, neck, ears, and hands/fingers unless gloved, plus rolled-sleeve forearms (by colour match);
// hair = hair, beard, bun; thin = ears (1), fingers (0.8), hands (0.4); curvature by part.
const PEOPLE_GLSL = {
  skin: `(float(int(pPart + 0.5) == P_HEAD || int(pPart + 0.5) == P_NECK || int(pPart + 0.5) == P_EAR) +
          float((int(pPart + 0.5) == P_HAND || int(pPart + 0.5) == P_FING) && (int(pBot.a + 0.5) & 16) == 0) +
          float(int(pPart + 0.5) == P_ARM) * (1.0 - smoothstep(0.03, 0.09, length(diffuseColor.rgb - pSkin.rgb))))`,
  hair: `float(int(pPart + 0.5) == P_HAIR || int(pPart + 0.5) == P_BEARD || int(pPart + 0.5) == P_BUN)`,
  thin: `(int(pPart + 0.5) == P_EAR ? 0.7 : int(pPart + 0.5) == P_FING ? 0.85 : int(pPart + 0.5) == P_HAND ? 0.4 : 0.05)`,
  curv: `(int(pPart + 0.5) == P_EAR ? 70.0 : int(pPart + 0.5) == P_FING ? 90.0 : int(pPart + 0.5) == P_HAND ? 35.0 : int(pPart + 0.5) == P_NECK ? 16.0 : flCurv)`,
  strand: `flN(vec2(atan(pBind.x, pBind.z - 0.01) * 22.0, pBind.y * 3.0)) * 0.75 + flN(vec2(atan(pBind.x, pBind.z) * 70.0, pBind.y * 6.0)) * 0.25`,
  hero: `(flHero < 0.0 || abs(flRow - flHero) < 0.5 ? 1.0 : 0.0)`,
  vary: 'flat varying float flRow;\n', vset: 'flRow = aRow;', fvary: 'flat varying float flRow;\n',
};
for (const k of ['skin', 'hair', 'thin', 'curv', 'strand', 'hero']) PEOPLE_GLSL[k] = PEOPLE_GLSL[k].replace(/\s+/g, ' ');
export function patchPeople(folk, opts = {}) {
  const P = makeUniforms({ ...DEF, curv: 11, ...opts });
  const seen = new Set();
  for (const m of folk.meshes) {
    const mat = m.material; if (seen.has(mat)) continue; seen.add(mat);
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat), G = PEOPLE_GLSL;
    mat.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      Object.assign(sh.uniforms, P.U);
      sh.vertexShader = G.vary + sh.vertexShader.replace('#include <project_vertex>', G.vset + '\n#include <project_vertex>');
      sh.fragmentShader = G.fvary + sh.fragmentShader
        .replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + PARS + '\n#undef RE_Direct\n#define RE_Direct RE_Direct_Flesh\n')
        .replace('#include <lights_fragment_begin>', `#define FL_SKIN (${G.skin})\n#define FL_HAIR (${G.hair})\n#define FL_THIN (${G.thin})\n#define FL_CURV (${G.curv})\n#define FL_STRAND (${G.strand})\n#define FL_HERO (${G.hero})\n` + PRE_LIGHTS + '#include <lights_fragment_begin>')
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + POST_LIGHTS);
    };
    mat.customProgramCacheKey = () => prevKey() + '|flesh-ppl';
    mat.needsUpdate = true;
  }
  return P;
}
