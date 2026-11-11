// ANATOMY / FINE / ENGINE (DETAIL7, 8 Oct 2026): the fine tier on the engine's photoreal body material, TEXTURES ONLY (the v5/v6 body uses
// all 16 vertex attributes): the chart's per-vertex uv comes from a data texture read by gl_VertexID in the vertex shader (one varying, vec3),
// the baked relief from two chart textures, the pores from the GLSL twin of micro.js on the bind position (hero.js's vBind). Installed
// through hero.js's skinHook (H1; review/studio_human_c8/after/hooks/NOTES.md), key 'fine7': a hero without it compiles exactly as before.
// Ours, CC0.
//
// Textures: fineVT (RGBA32F, 1024 wide: per vertex u, v, on), fineGT (RGBA16F chart: dh/du, dh/dv in metres per uv unit, cavity, h in m),
// fineMT (RGBA8 chart: pore size class, pore depth / 0.12 mm, vermilion mask, lid mask: also the region masks SKIN7 may read).
// Uniforms: fineK = (on, form gain, pore gain, cavity gain), fineO (the anchor origin, bind m: the pores' frame, as the bake's), (c5 iteration
// 17: fineL, iteration 11's lobe switch, deleted: what the lobes see of the pores (MICRO_GLSL fineLobeV / fineHide) is the only path).
// Iteration 11 (the engine twin of the Cycles mixture, iterations 9-10): LIGHTS slot: both lobes widen by the unhidden pits' sub-pixel slope
// variance (r -> (r^4 + kp^2 v)^(1/4), three's GGX alpha = r^2); AO slot: the specular (both lobes, direct and indirect) x (1 - kp f), the
// pits' steep walls' hidden share, in place of the pore opening's occlusion on the specular (the opening still darkens the diffuse).
// Iteration 2: the cavity channel is the relief's own horizon occlusion in context (bake.js; up to 1.08 on a ridge: it may brighten the
// diffuse a little, never the specular), the pores are pre-filtered to the pixel (micro.js) and their pits occlude.
// Normal slot (after lane B's micro-relief): the surface-gradient perturbation (Mikkelsen 2010, the form lane B's NORMAL uses) of the
// form's gradient + the pores'; the form also goes into lane B's smooth normal (likeNs: its pre-integrated diffuse) and its micro normal
// (likeNm: rev 4+ diffuse, and SKIN6's pass), so creases shade the diffuse as well as the specular. AO slot: the cavity on the indirect
// light (full) and the direct (half), the specular occlusion with it.
import * as THREE from 'three';
import { MICRO_GLSL } from './micro.js';

export const ENGINE_KEY = 'fine7';
// float32 -> IEEE half (round to nearest; flush tiny to zero)
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
export function toHalf(x) { _f[0] = x; const b = _u[0], s = (b >>> 16) & 0x8000, e = ((b >>> 23) & 0xff) - 127 + 15, m = b & 0x7fffff;
  if (e <= 0) return s; if (e >= 31) return s | 0x7c00; return s | Math.min(0x7bff, (e << 10) + ((m + 0x1000) >>> 13)); }   // the rounding may carry into the exponent

export function makeTextures(K, B) {
  const n = K.n, vw = 1024, vh = Math.ceil(n / vw), vd = new Float32Array(vw * vh * 4);
  for (let v = 0; v < n; v++) { vd[v * 4] = K.uv[v * 2]; vd[v * 4 + 1] = K.uv[v * 2 + 1]; vd[v * 4 + 2] = K.on[v]; }
  const VT = new THREE.DataTexture(vd, vw, vh, THREE.RGBAFormat, THREE.FloatType); VT.minFilter = VT.magFilter = THREE.NearestFilter; VT.needsUpdate = true;
  const WH = B.W * B.H, gd = new Uint16Array(WH * 4);
  for (let k = 0; k < WH; k++) { gd[k * 4] = toHalf(B.grad[k * 2]); gd[k * 4 + 1] = toHalf(B.grad[k * 2 + 1]); gd[k * 4 + 2] = toHalf(B.cav[k]); gd[k * 4 + 3] = toHalf(B.h[k] * 0.001); }
  const GT = new THREE.DataTexture(gd, B.W, B.H, THREE.RGBAFormat, THREE.HalfFloatType); GT.minFilter = THREE.LinearFilter; GT.magFilter = THREE.LinearFilter; GT.generateMipmaps = false;
  GT.wrapS = GT.wrapT = THREE.ClampToEdgeWrapping; GT.needsUpdate = true;
  const MT = new THREE.DataTexture(B.mask, B.W, B.H, THREE.RGBAFormat, THREE.UnsignedByteType); MT.minFilter = THREE.LinearFilter; MT.magFilter = THREE.LinearFilter; MT.generateMipmaps = false; MT.needsUpdate = true;
  return { VT, GT, MT, bytes: vd.byteLength + gd.byteLength + B.mask.byteLength };
}

// the hook's GLSL; laneB: lane B's skin hook is on this hero (likeNs declared); laneB4: rev 4+ (likeNm declared)
export function fineHook(T, U, { laneB = true, laneB4 = true } = {}) {
  const uniforms = { fineVT: { value: T.VT }, fineGT: { value: T.GT }, fineMT: { value: T.MT }, fineK: { value: new THREE.Vector4(...U.K) }, fineO: { value: new THREE.Vector3(...U.O) }, fineDbg: { value: U.dbg || 0 } };
  const vertPars = 'uniform highp sampler2D fineVT; varying vec3 vFine;';
  const vert = '{ int fw7 = textureSize(fineVT, 0).x; vFine = texelFetch(fineVT, ivec2(gl_VertexID % fw7, gl_VertexID / fw7), 0).xyz; }';
  const fragPars = 'uniform sampler2D fineGT, fineMT; uniform vec4 fineK; uniform vec3 fineO; uniform float fineDbg; varying vec3 vFine; float fineCav = 1.0, finePoreCav = 1.0, fineSpecK = 1.0, fineVar = 0.0;\n' + MICRO_GLSL;
  const frag = 'if (fineDbg > 0.5 && vFine.z > 0.999) diffuseColor.rgb = vec3(0.42, 0.36, 0.32);';   // the relief alone (a clay albedo on the chart)
  const normal = `
{ vec2 fuv7 = vFine.xy; vec2 dux7 = dFdx(fuv7), duy7 = dFdy(fuv7);
  vec3 dpx7 = dFdx(-vViewPosition), dpy7 = dFdy(-vViewPosition), dbx7 = dFdx(vBind), dby7 = dFdy(vBind);
  if (fineK.x > 0.5 && vFine.z > 0.999 && hNotSkin < 0.5) {
    vec4 G7 = texture2D(fineGT, fuv7), M7 = texture2D(fineMT, fuv7);
    vec2 dF7 = vec2(dot(G7.xy, dux7), dot(G7.xy, duy7)) * fineK.y;                 // the form: metres of height per pixel
    float dia7 = 0.08 + 0.19 * M7.x, dep7 = 0.12 * M7.y, den7 = 1.4 + 2.8 * clamp((dia7 - 0.08) / 0.17, 0.0, 1.0);
    float sig7 = 0.35 * 500.0 * (length(dbx7) + length(dby7));                     // the pixel's footprint as a Gaussian sigma (mm)
    vec4 pr7 = finePores((vBind - fineO) * 1000.0, vec3(dia7, dep7, den7), 7u, sig7); // pre-filtered to it (micro.js)
    vec2 dP7 = vec2(dot(pr7.xyz, dbx7), dot(pr7.xyz, dby7)) * fineK.z;
    vec3 R17 = cross(dpy7, normal), R27 = cross(normal, dpx7); float det7 = dot(dpx7, R17) * faceDirection;
    vec3 np7 = normalize(abs(det7) * normal - sign(det7) * ((dF7.x + dP7.x) * R17 + (dF7.y + dP7.y) * R27));
    if (!any(isnan(np7))) normal = np7;
${laneB ? `    vec3 S17 = cross(dpy7, likeNs), S27 = cross(likeNs, dpx7); float ds7 = dot(dpx7, S17) * faceDirection;
    vec3 ns7 = normalize(abs(ds7) * likeNs - sign(ds7) * (dF7.x * S17 + dF7.y * S27)); if (!any(isnan(ns7))) likeNs = ns7;` : ''}
${laneB4 ? '    likeNm = normal;' : ''}
    fineCav = mix(1.0, G7.z, fineK.w);                                              // the relief's occlusion (and the lip fissures', baked)
    finePoreCav = 1.0 - fineK.z * clamp(finePoreOcc, 0.0, 0.8);                      // iteration 4: the pores' openings (funnels), filtered
    fineVar = fineK.z * fineK.z * fineLobeV;                                         // iteration 11: what the lobes see of the pores
    fineSpecK = 1.0 - min(fineK.z, 1.0) * clamp(fineHide, 0.0, 0.9);
  } }`;
  const ao = `
if (fineCav != 1.0 || finePoreCav != 1.0) { float fc7 = min(fineCav, 1.0), pc7 = finePoreCav;
  // a pore's opening hides its sky AND the key light (it is a funnel deeper than wide): 0.8 of its occlusion on the direct light too
  reflectedLight.indirectDiffuse *= fineCav * pc7; reflectedLight.directDiffuse *= mix(1.0, fineCav, 0.5) * mix(1.0, pc7, 0.8);
  // iteration 11: on the specular the pits' hidden share (fineSpecK) replaces the opening's occlusion (c5 i17: the only path; the old pc7 switch deleted)
  float si7 = fineSpecK, sd7 = fineSpecK;
  reflectedLight.indirectSpecular *= mix(1.0, fc7, 0.85) * si7; reflectedLight.directSpecular *= mix(1.0, fc7, 0.5) * sd7;
  #ifdef USE_CLEARCOAT
  clearcoatSpecularIndirect *= mix(1.0, fc7, 0.85) * si7; clearcoatSpecularDirect *= mix(1.0, fc7, 0.5) * sd7;
  #endif
}`;
  // iteration 11: after lights_physical_fragment, before the light loop: both lobes widen by the unhidden sub-pixel variance
  const lights = `
if (fineVar > 0.0) { material.roughness = min(1.0, pow(pow(material.roughness, 4.0) + fineVar, 0.25));
  #ifdef USE_CLEARCOAT
  material.clearcoatRoughness = min(1.0, pow(pow(material.clearcoatRoughness, 4.0) + fineVar, 0.25));
  #endif
}`;
  return { key: ENGINE_KEY, uniforms, vertPars, vert, fragPars, frag, normal, lights, ao };
}
