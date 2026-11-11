// LIGHT / patch: make any three.js lit material part of the lighting pipeline (LIGHTING c1).
//
// The pipeline is "forward with a depth-normal prepass": one prepass writes view normals and 1/depth, the screen-space
// passes (ambient occlusion, contact shadows) read it, and the main forward pass reads THEIR result back:
//   - ambient occlusion multiplies only the INDIRECT light (sky, environment, bounce), never the sun or a lamp
//   - the sun's contact shadow multiplies only the sun; the key practical's contact shadow only that light
// so a foot, a tyre or a slab sits on the ground without the whole frame being darkened by an AO overlay.
// litPatch() chains onto a material's own onBeforeCompile (house wear materials, people.js skinning, surface.js layers)
// so skinned and instanced figures write the prepass through their own vertex code. Unpatched materials (sparks, sky,
// sprites) are simply hidden from the prepass.
import * as THREE from 'three';

export const LIT = {
  uLitPre: { value: 0 },                         // 1 during the prepass
  uLitSSO: { value: null },                      // R ambient occlusion, G sun contact, B key-light contact
  uLitOn: { value: 0 },
  uLitInvRes: { value: new THREE.Vector2(1 / 1080, 1 / 1920) },
  uLitAO: { value: new THREE.Vector2(1, 1) },    // AO strength on indirect diffuse, on indirect specular
  uLitKeyPt: { value: 0 },                       // the contact-shadow key is the first shadowed spot (0) or point (1) light
  // reflections (LIGHTING c2): a planar mirror of the scene about the ground (flat wet ground, puddles) and a screen-space
  // march against the prepass (everything else that is glossy: chrome, glass, oil, wet steel), both replacing the
  // environment's radiance in the material's own specular term (so the split sum, Fresnel and roughness stay the material's)
  uLitMirror: { value: null }, uLitMirrorMat: { value: new THREE.Matrix4() }, uLitMirrorOn: { value: 0 },
  uLitMirrorP: { value: new THREE.Vector4(0, 0.06, 1, 0) },   // plane y, tolerance (m), streak (vertical stretch), unused
  uLitPreT: { value: null }, uLitPrev: { value: null }, uLitSSROn: { value: 0 }, uLitProj: { value: new THREE.Matrix4() }, uLitViewInv: { value: new THREE.Matrix4() },
  uLitSSRP: { value: new THREE.Vector4(40, 0.6, 0, 0) },      // max distance (m), thickness (m), sub-frame, unused
  // (RENDER6) specular anti-aliasing: on (set by LitRenderer's 'preview' / 'motion' / 'film' tiers for their render only; 0 = the
  // shader result exactly as before), screen-space variance (Tokuyoshi-Kaplanyan's 1/2pi), kappa (the clamp on the added GGX alpha^2),
  // the normal map's Toksvig / vMF term on (1)
  uLitSAA: { value: new THREE.Vector4(0, 0.15915494, 0.18, 1) },
};

const COMMON = /* glsl */`
uniform float uLitPre, uLitOn, uLitKeyPt; uniform sampler2D uLitSSO; uniform vec2 uLitInvRes, uLitAO; uniform vec4 uLitSAA;
uniform sampler2D uLitMirror, uLitPreT, uLitPrev; uniform mat4 uLitMirrorMat, uLitProj, uLitViewInv; uniform float uLitMirrorOn, uLitSSROn; uniform vec4 uLitMirrorP, uLitSSRP;
vec4 litS(){ return uLitOn > 0.5 ? texture2D(uLitSSO, gl_FragCoord.xy * uLitInvRes) : vec4(1.0); }
float litSun(){ return litS().g; }
float litKey(){ return litS().b; }
`;

let LB = null;
function lightsBegin() {
  if (LB) return LB;
  let s = THREE.ShaderChunk.lights_fragment_begin;
  s = s.replace('getShadow( directionalShadowMap[ i ]', 'litSun() * getShadow( directionalShadowMap[ i ]');
  s = s.replace('getShadow( spotShadowMap[ i ]', '( UNROLLED_LOOP_INDEX == 0 && uLitKeyPt < 0.5 ? litKey() : 1.0 ) * getShadow( spotShadowMap[ i ]');
  s = s.replace('getPointShadow( pointShadowMap[ i ]', '( UNROLLED_LOOP_INDEX == 0 && uLitKeyPt > 0.5 ? litKey() : 1.0 ) * getPointShadow( pointShadowMap[ i ]');
  return (LB = s);
}

// (RENDER6) specular AA, right before the lights read the material (after every lane's roughness and normal code): GGX alpha^2
// += min(2 sigma^2, kappa), sigma^2 from the screen-space derivatives of the FINAL shading normal (Tokuyoshi and Kaplanyan 2019,
// "Improved Geometric Specular Antialiasing": pores, weave and silhouettes widen their own lobe where they fall under a pixel, so
// the average highlight stays and the sparkle goes) plus, with a three normal map, the vMF variance of its mipmapped average
// (Han et al. 2007; The Order: 1886 notes): sigma^2 = 1 / (4 kappa_vMF). Gated by a uniform: off, nothing below runs.
const SAA = /* glsl */`
if (uLitSAA.x > 0.5) {
  vec3 du_ = dFdx(normal), dv_ = dFdy(normal);
  float v_ = uLitSAA.y * (dot(du_, du_) + dot(dv_, dv_));
  #ifdef USE_NORMALMAP_TANGENTSPACE
  if (uLitSAA.w > 0.5) { float l_ = length(texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0);
    if (l_ < 0.995) { float l2_ = l_ * l_; v_ += 0.25 * (1.0 - l2_) / max(3.0 * l_ - l_ * l2_, 1e-4); } }
  #endif
  material.roughness = sqrt(sqrt(clamp(pow2(pow2(material.roughness)) + min(2.0 * v_, uLitSAA.z), 0.0, 1.0)));
  #ifdef USE_CLEARCOAT
  { vec3 cu_ = dFdx(clearcoatNormal), cv_ = dFdy(clearcoatNormal); float cw_ = uLitSAA.y * (dot(cu_, cu_) + dot(cv_, cv_));
    material.clearcoatRoughness = sqrt(sqrt(clamp(pow2(pow2(material.clearcoatRoughness)) + min(2.0 * cw_, uLitSAA.z), 0.0, 1.0))); }
  #endif
}
`;

// the reflection term: called after the lights, before AO. Planar where the fragment lies on the mirror plane facing up,
// screen-space elsewhere (and where the mirror has nothing), the environment where both miss.
const REFL = /* glsl */`
#if defined(LIT_PLANAR) || defined(LIT_SSR)
float litIgn(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 litEnvRad(vec3 n, vec3 v, float r){
  #ifdef USE_ENVMAP
    return getIBLRadiance(v, n, r);
  #else
    return vec3(0.0);
  #endif
}
#endif
#ifdef LIT_PLANAR
// the mirror is sampled where the fragment projects into the virtual camera; roughness spreads it into a VERTICAL streak
// (the long lamp reflections of a wet road: microfacets tilted toward and away from the eye stretch the lobe along the
// view plane); a ripple from the shading normal shakes it
vec4 litPlanar(vec3 wp, vec3 wn, vec3 n, float rough){
  if (uLitMirrorOn < 0.5 || abs(wp.y - uLitMirrorP.x) > uLitMirrorP.y || wn.y < 0.6) return vec4(0.0);
  vec4 c = uLitMirrorMat * vec4(wp, 1.0); vec2 uv = c.xy / c.w;
  uv += (n.xz - wn.xz) * 0.08;
  float sp = rough * (0.25 + rough) * 0.5, j = fract(litIgn(gl_FragCoord.xy) + 0.618034 * uLitSSRP.z);
  vec3 acc = vec3(0.0); float ws = 0.0;
  float j2 = fract(j * 7.31 + 0.5) - 0.5;
  for (int i = 0; i < 16; i++) { float f = (float(i) + j) / 16.0 - 0.5, w = exp(-f * f * 5.0);
    vec2 q = uv + vec2((j2 + 0.6 * fract(float(i) * 0.618) - 0.3) * sp * 0.12, f * sp * uLitMirrorP.z);
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) continue;
    acc += texture2D(uLitMirror, q).rgb * w; ws += w; }
  if (ws <= 0.0) return vec4(0.0);
  float edge = smoothstep(0.0, 0.1, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  return vec4(acc / ws, edge * (1.0 - smoothstep(0.45, 0.85, rough)));
}
#endif
#ifdef LIT_SSR
vec2 litUv(vec3 q){ vec4 c = uLitProj * vec4(q, 1.0); return c.xy / c.w * 0.5 + 0.5; }
// march the reflected ray in view space against the prepass depth; colour from the PREVIOUS sub-frame (pre-exposed, unlit by
// haze); glossy lobes come from a per-sub-frame jitter of the ray, which the accumulation averages
vec4 litSSR(vec3 vp, vec3 n, float rough){
  if (uLitSSROn < 0.5 || rough > 0.65) return vec4(0.0);
  vec3 V = normalize(vp); float j = litIgn(gl_FragCoord.xy + uLitSSRP.z * vec2(5.588, 8.137));
  float a1 = fract(j + 0.618 * uLitSSRP.z) * 6.2831, a2 = fract(j * 1.7 + 0.31 * uLitSSRP.z);
  vec3 t1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0))), t2 = cross(n, t1);
  float g = rough * rough * 0.9 * sqrt(a2);
  vec3 nn = normalize(n + (t1 * cos(a1) + t2 * sin(a1)) * g);
  vec3 r = reflect(V, nn); if (dot(r, n) <= 0.0) r = reflect(V, n);
  vec3 p = vp + n * (0.01 + 0.002 * -vp.z);
  float maxD = uLitSSRP.x, t = 0.0, dt = 0.04 + 0.006 * -vp.z, prev = 0.0;
  for (int i = 0; i < 36; i++) {
    prev = t; t += dt * (0.75 + 0.5 * j); dt *= 1.13; if (t > maxD) break;
    vec3 q = p + r * t; if (q.z > -0.05) break;
    vec2 uv = litUv(q); if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
    float iz = texture2D(uLitPreT, uv).a; if (iz <= 0.0) continue;
    float dz = -q.z - 1.0 / iz;
    if (dz > 0.0 && dz < uLitSSRP.y + 0.04 * t) {
      float lo = prev, hi = t;
      for (int k = 0; k < 5; k++) { float m = 0.5 * (lo + hi); vec3 qm = p + r * m; vec2 um = litUv(qm); float izm = texture2D(uLitPreT, um).a;
        if (izm > 0.0 && -qm.z - 1.0 / izm > 0.0) hi = m; else lo = m; }
      vec2 uh = litUv(p + r * hi);
      float edge = smoothstep(0.0, 0.08, min(min(uh.x, 1.0 - uh.x), min(uh.y, 1.0 - uh.y)));
      float fade = edge * (1.0 - smoothstep(0.7, 1.0, t / maxD)) * (1.0 - smoothstep(0.4, 0.65, rough)) * smoothstep(-0.2, 0.15, -dot(r, V) + 1.0);
      return vec4(texture2D(uLitPrev, uh).rgb, fade);
    }
  }
  return vec4(0.0);
}
#endif
`;
const REFL_APPLY = /* glsl */`
#if defined(LIT_PLANAR) || defined(LIT_SSR)
if (uLitPre < 0.5) {
  vec3 ss_ = vec3(0.0), ms_ = vec3(0.0);
  #ifdef USE_IRIDESCENCE
    computeMultiscatteringIridescence(geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, ss_, ms_);
  #else
    computeMultiscattering(geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, ss_, ms_);
  #endif
  vec3 wn_ = normalize(mat3(uLitViewInv) * geometryNormal), wp_ = (uLitViewInv * vec4(-vViewPosition, 1.0)).xyz;
  vec3 env_ = litEnvRad(geometryNormal, geometryViewDir, material.roughness), rad_ = env_; float w_ = 0.0;
  #ifdef LIT_PLANAR
  { vec4 pl = litPlanar(wp_, wn_, normalize(mat3(uLitViewInv) * normal), material.roughness); rad_ = mix(rad_, pl.rgb, pl.a); w_ = pl.a; }
  #endif
  #ifdef LIT_SSR
  if (w_ < 0.99) { vec4 sr = litSSR(-vViewPosition, normalize(normal), material.roughness); rad_ = mix(rad_, sr.rgb, sr.a * (1.0 - w_)); }
  #endif
  vec3 is_ = reflectedLight.indirectSpecular + ss_ * (rad_ - env_);
  if (!any(isnan(is_)) && !any(isinf(is_))) reflectedLight.indirectSpecular = max(is_, vec3(0.0));
}
#endif
`;

// opts: { planar: true } reads the ground mirror (flat wet ground, puddles); { ssr: true } marches the screen (anything glossy)
export function litPatch(m, opts = {}) {
  if (!m || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) return m;
  if (m.userData.lit) { if ((opts.planar && !m.userData.litPlanar) || (opts.ssr && !m.userData.litSSR)) { m.userData.litPlanar ||= !!opts.planar; m.userData.litSSR ||= !!opts.ssr; m.needsUpdate = true; } return m; }
  m.userData.litPlanar = !!opts.planar; m.userData.litSSR = !!opts.ssr;
  const prev = m.onBeforeCompile?.bind(m), prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, LIT);
    const defs = (m.userData.litPlanar ? '#define LIT_PLANAR\n' : '') + (m.userData.litSSR ? '#define LIT_SSR\n' : '');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', defs + '#include <common>\n' + COMMON)
      .replace('#include <clipping_planes_pars_fragment>', '#include <clipping_planes_pars_fragment>\n' + REFL)
      .replace('#include <emissivemap_fragment>', `if (uLitPre > 0.5) { gl_FragColor = vec4(normalize(normal), 1.0 / max(vViewPosition.z, 1e-3)); return; }\n#include <emissivemap_fragment>`)
      .replace('#include <lights_fragment_begin>', (m.userData.hairU || m.userData.noSAA ? '' : SAA) + lightsBegin())
      .replace('#include <aomap_fragment>', REFL_APPLY + `#include <aomap_fragment>
      { float a = litS().r; reflectedLight.indirectDiffuse *= mix(1.0, a, uLitAO.x);
        float sa = clamp(pow(max(dot(geometryNormal, geometryViewDir), 0.0) + a, exp2(-16.0 * material.roughness - 1.0)) - 1.0 + a, 0.0, 1.0);
        reflectedLight.indirectSpecular *= mix(1.0, sa, uLitAO.y); }`);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|lit1' + (m.userData.litPlanar ? 'P' : '') + (m.userData.litSSR ? 'S' : '') + (m.userData.hairU || m.userData.noSAA ? 'n' : '');
  m.userData.lit = true; m.needsUpdate = true;
  return m;
}

// patch every lit material under an object (call after building a set, and after adding new objects)
export function litPatchAll(root, opts = {}) {
  root.traverse(o => { if (!o.material) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) litPatch(m, opts); });
  return root;
}
const isLit = m => Array.isArray(m) ? m.every(x => x.userData?.lit) : !!m?.userData?.lit;
// hide what cannot write the prepass (additive sparks, sprites, glass) and return a restore function
export function prepassHide(scene) {
  const hid = [];
  scene.traverseVisible(o => {
    if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && (!isLit(o.material) || o.material.transparent || o.userData.noPrepass)) { hid.push(o); }
  });
  for (const o of hid) o.visible = false;
  return () => { for (const o of hid) o.visible = true; };
}
