// STYLE / surface: how a styled person's surface reads, applied from OUTSIDE a built hero by chaining onBeforeCompile on
// h.body.material and every garment, hair, hat and eye material (lane E; stage 7's style side in PERSON_PIPELINE.md).
// Nothing in hero.js, garment.js or cloth/ changes; a hero without applySurface() renders exactly as before.
//
//   import { applySurface, STYLE_MODE, setKey } from '../lib/fx/style/surface.js';
//   const st = applySurface(h, { surface: 'clay' | 'skin' | 'flat' | 'notan' | 'poster', underwear: true, palette });
//   setKey(st, camera, sunDirWorld);           // the designed key, in view space, for the flat surfaces
//   STYLE_MODE.value = 1; renderer.render(scene, camera); STYLE_MODE.value = 0;   // a display-referred designed pass
//
// Surface follows the ladder (the person's per-vertex level, shape.js aStyle.w):
// - SKIN (photoreal, lit through light/): the hero's own skin; the albedo mottle (hero's fbm at 60/m) and the pore
//   roughness noise (900/m) are divided back out as the level rises above L0 ("pores and microrelief fade above L0").
// - CLAY (lit through light/): one neutral albedo, no sheen, no clearcoat, roughness 0.62: form without skin colour,
//   the sculptor's and the anatomy bench's read.
// - L1-L2 PLANES in every surface: a fragment takes the normal of its plane (shape.js planeTable: the clustering's own
//   rule, argmin |x - c|^2 + wN^2 |n - n_j|^2 over its mass's planes, on its bind position and the smoothed bind normal),
//   carried to view space by the fragment's own skinning, so light reads the planes and the breaks are smooth curves
//   that ride the pose. Between L1 and L2 the plane normal is mixed in; above L2 it fades back to the primitives' own.
// - FLAT, a designed terminator (mode 1, display-referred, no physical light): N.L against a DESIGNED key (setKey) cut at
//   a terminator with a chosen softness into two or three values of the local colour (Loomis's light, halftone, shadow;
//   the cel and poster read). POSTER maps the values onto a three-ink palette (paper, ACP red, ink) by local value and
//   light, NOTAN onto two (Dow, Composition 1899: dark where the form turns from the key OR the local colour is dark).
// - AOVs for line.js (mode 2: mass or object id, plane id, anchor weight, coverage; mode 3: view normal, view depth).
// Plain underwear for the garments-off register is painted in bind space (after the critic's lab_body.js): low trunks
// for everyone, a bandeau for women; it hugs the body and hides no landmark.
import * as THREE from 'three';

export const STYLE_MODE = { value: 0 };     // 0 inert (lit), 1 designed surface, 2 AOV ids, 3 AOV normal + depth
export const PALETTES = {
  acp: { paper: '#efe2c6', ink: '#16130f', red: '#bd1818', mid: '#8a3a2a' },
  notan: { paper: '#f4ead6', ink: '#141010', red: '#bd1818', mid: '#141010' },
  cel: { paper: '#efe2c6', ink: '#1a1412', red: '#bd1818', mid: '#6a5a50' },
};
const MAXP = 192, NMASS = 19;

// STYLE c4: a body with no room for aStyle / aStyleN (WebGL's 16 vertex attributes, one spent by three's morph targets) reads them
// from a float texture by gl_VertexID (ST_TEX, two texels a vertex, exact). The v4 body is exactly full WITH them today (13 + 2 +
// gl_VertexID), so nothing changes now; the guard keeps notan drawing if a later lane adds an attribute to the body.
const VERT_PARS = /* glsl */`
#ifdef ST_BODY
#ifdef ST_TEX
uniform highp sampler2D stFieldTex;
#else
attribute vec4 aStyle; attribute vec3 aStyleN;
#endif
flat varying float vStM; varying vec4 vSt; varying vec3 vStN, vStP;
#endif
varying vec3 vStB0, vStB1, vStB2;`;
const VERT = /* glsl */`
#ifdef ST_BODY
#ifdef ST_TEX
{ int i = gl_VertexID * 2, j = i + 1; vec4 aStyle = texelFetch(stFieldTex, ivec2(i % 4096, i / 4096), 0); vec3 aStyleN = texelFetch(stFieldTex, ivec2(j % 4096, j / 4096), 0).xyz;
  vStM = aStyle.x; vSt = aStyle; vStN = aStyleN; vStP = position; }
#else
vStM = aStyle.x; vSt = aStyle; vStN = aStyleN; vStP = position;
#endif
#endif
{ mat3 stSk = mat3(1.0);
  #ifdef USE_SKINNING
  stSk = mat3(skinMatrix);
  #endif
  vStB0 = normalMatrix * (stSk * vec3(1.0, 0.0, 0.0)); vStB1 = normalMatrix * (stSk * vec3(0.0, 1.0, 0.0)); vStB2 = normalMatrix * (stSk * vec3(0.0, 0.0, 1.0)); }`;
const FRAG_PARS = /* glsl */`
uniform float stMode, stObj, stSurf, stClayK, stFade, stHasPlanes, stTint, stLift;
uniform vec3 stKey, stClay, stInk, stPaper, stRed, stMid, stUWc; uniform vec4 stTone, stUW, stPal;
varying vec3 vStB0, vStB1, vStB2;
#ifdef ST_BODY
flat varying float vStM; varying vec4 vSt; varying vec3 vStN, vStP;
uniform vec4 stPC[${MAXP}]; uniform vec4 stPN[${MAXP}]; uniform vec2 stPR[${NMASS}]; uniform float stWN;
#endif
float stPlane = -1.0;
vec3 stSRGB(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float stLuma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }`;
// after the hero's skin code (it ends at 'roughnessFactor = pRough;\n}'): clay, mottle fade, underwear
const SKIN_AFTER = /* glsl */`
#ifdef ST_BODY
{ float lv = vSt.w;
  if (stFade > 0.0 && lv > 0.0) { float k = clamp(lv * 2.0, 0.0, 1.0) * stFade; vec3 b = vBind;
    float m2 = (0.93 + 0.12 * fbm3(b * 60.0 + hSeed)) * 1.0; vec3 tint = mix(vec3(1.0), vec3(1.05, 0.93, 0.9), vn3(b * 30.0 + 7.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb / (m2 * tint), k); roughnessFactor = mix(roughnessFactor, 0.56, k); }
  if (stClayK > 0.0) { diffuseColor.rgb = mix(diffuseColor.rgb, stClay, stClayK); roughnessFactor = mix(roughnessFactor, 0.62, stClayK); }
  // LIFT (the printmaker's choice of values, for media that read the lit render's value: engraving, woodcut, halftone):
  // deep skin's albedo raised toward a floor (x (max(l, 0.2) / l)^lift), light skin unchanged, so a print cuts its form
  // instead of a solid black (first style board: Otis engraved as a silhouette). A surface property, not a grade.
  if (stLift > 0.0) { float l0 = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)); diffuseColor.rgb *= pow(max(l0, 0.2) / max(l0, 1e-4), stLift); }
  if (stUW.w > -0.5) { vec3 bq = vStP; float ax = abs(bq.x);
    float top = stUW.y - 0.035 - 0.02 * smoothstep(0.0, 0.14, ax);
    float leg = stUW.x - 0.085 + 0.075 * smoothstep(0.03, 0.15, ax) * step(0.0, bq.z) + 0.03 * smoothstep(0.03, 0.15, ax) * step(bq.z, 0.0);
    float rg = vHero.x, seam = step(0.02, abs(rg - floor(rg + 0.5)));   // a triangle across a region seam interpolates the id (figure_lab's fix)
    float inR = max(max(step(1.5, rg) * step(rg, 2.5), step(6.5, rg) * step(rg, 8.5)), seam * step(1.5, rg) * step(rg, 8.5));
    float tr = step(leg, bq.y) * step(bq.y, top) * inR * step(ax, 0.32);
    float bd = stUW.w * step(abs(bq.y - stUW.z - 0.004), 0.055) * step(1.5, vHero.x) * step(vHero.x, 2.5);
    float m = max(tr, bd); diffuseColor.rgb = mix(diffuseColor.rgb, stUWc, m); roughnessFactor = mix(roughnessFactor, 0.8, m); }
}
#endif`;
const CLAY_OTHER = /* glsl */`
#ifndef ST_BODY
if (stClayK > 0.0) { diffuseColor.rgb = mix(diffuseColor.rgb, stClay * 0.82, stClayK); roughnessFactor = mix(roughnessFactor, 0.66, stClayK); }
#endif`;
// after normal_fragment_maps: the plane normal (view space through the fragment's skinning)
const NORMAL = /* glsl */`
#ifdef ST_BODY
if (stHasPlanes > 0.5 && vSt.w > 1.0) {
  int m = int(vStM + 0.5); vec2 rg = stPR[m]; vec3 p = vStP, nb = normalize(vStN); float bd = 1e9; int best = -1;
  for (int k = 0; k < ${MAXP}; k++) { if (float(k) < rg.x) continue; if (float(k) >= rg.x + rg.y) break;
    vec3 dc = p - stPC[k].xyz, dn = nb - stPN[k].xyz; float q = dot(dc, dc) + stWN * stWN * dot(dn, dn); if (q < bd) { bd = q; best = k; } }
  if (best >= 0) { vec3 pn = stPN[best].xyz, nv = normalize(pn.x * vStB0 + pn.y * vStB1 + pn.z * vStB2);
    float lv = vSt.w, w = clamp(lv - 1.0, 0.0, 1.0) * (lv <= 2.0 ? 1.0 : clamp(3.35 - lv, 0.0, 1.0));
    normal = normalize(mix(normal, nv, w)); stPlane = float(best); }
}
#endif`;
// the end of the shader: the designed surfaces and the AOVs
const OUT = /* glsl */`
if (stMode > 0.5) {
  vec3 N = normalize(normal);
  if (stMode < 1.5) {
    float ndl = dot(N, normalize(stKey)), sft = stTone.y;
    float lit = smoothstep(stTone.x - sft, stTone.x + sft, ndl);                 // the terminator
    float hi = stTone.z > -1.5 ? smoothstep(stTone.z - sft, stTone.z + sft, ndl) : 1.0;   // the halftone / light boundary
    vec3 loc = diffuseColor.rgb, ls = stSRGB(loc); float lv = stLuma(ls);
    vec3 c;
    if (stSurf < 1.5) {                                   // FLAT: local colour in two or three values (display-referred)
      vec3 L = stSRGB(loc * stPal.x), S = stSRGB(loc * stPal.y) * mix(vec3(1.0), stMid, stTint), M = mix(S, L, stPal.z);
      c = mix(S, mix(M, L, hi), lit);
    } else {
      // POSTER / NOTAN: one value model for every person and garment: v = local value (display) x light, cut into inks.
      // Light skin lit prints paper; dark skin keeps its lit planes as small light shapes (a Catlett linocut, not a
      // blank); dark cloth prints ink. stPal: x = ink/next threshold, y = next/paper threshold, z = ambient.
      float lvv = lv;
      #ifdef ST_BODY
      // a person's skin carries its form in every tone: the local value is remapped (0.12 + 0.88 (value/0.6)^1.3) so deep skin
      // keeps only its planes turned well to the key as light shapes and is otherwise ink (Catlett's linocuts), light skin
      // cuts at a low light. Under the notan key the light needed for paper is then about 0.6 for Otis, 0.4 for Ray, 0.1 for
      // June. Plain value x light printed a dark-skinned man as a solid silhouette (03 Oct, Otis L4); 0.3 + 0.7 v/0.45 and
      // 0.12 + 0.88 v/0.5 printed every tone too alike (a deep-skinned figure half paper).
      lvv = 0.12 + 0.88 * pow(clamp(lv / 0.6, 0.0, 1.0), 1.3);
      #endif
      #ifdef ST_CLOTH_LIFT
      // HUMAN c8 integration v2 (seam 17, opt-in: a material with the define ST_CLOTH_LIFT): dark cloth keeps its lit planes as light
      // shapes (as deep skin does above) instead of printing solid ink: navy, denim and black work clothes read as folds, not a cut-out
      lvv = 0.2 + 0.8 * pow(clamp(lv / 0.5, 0.0, 1.0), 0.8);
      #endif
      float li = clamp((ndl - stTone.x) / max(1e-3, 1.0 - stTone.x), 0.0, 1.0), v = lvv * (stPal.z + (1.0 - stPal.z) * li), aa = max(fwidth(v) * 0.7, 1e-3);
      float a1 = smoothstep(stPal.x - aa, stPal.x + aa, v), a2 = smoothstep(stPal.y - aa, stPal.y + aa, v);
      c = stSurf < 2.5 ? mix(stInk, mix(stRed, stPaper, a2), a1) : mix(stInk, stPaper, a1);
    }
    gl_FragColor = vec4(c, 1.0);
  } else if (stMode < 2.5) {
    float id = stObj;
    #ifdef ST_BODY
    id = vStM;
    gl_FragColor = vec4(id, stPlane, vSt.z, 1.0);
    #else
    gl_FragColor = vec4(id, -1.0, 0.0, 1.0);
    #endif
  } else gl_FragColor = vec4(N, vViewPosition.z);
}`;

const UW_MIX = 'diffuseColor.rgb = mix(diffuseColor.rgb, stUWc, m); roughnessFactor = mix(roughnessFactor, 0.8, m);';   // the underwear's paint (HOOKS: + the paint mask)
const toV = c => new THREE.Color(c);
// install on one material (chained); U shared by the hero's materials of one kind, per-material stObj
function patchMat(mat, U, { body = false, obj = 0, skinHook = false, tex = null } = {}) {
  if (!mat || mat.userData.style || !(mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial)) return;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey, own = { stObj: { value: obj }, ...(tex ? { stFieldTex: { value: tex } } : {}) };
  mat.userData.style = { U, own };
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    Object.assign(sh.uniforms, U, own);
    const def = body ? '#define ST_BODY\n' + (tex ? '#define ST_TEX\n' : '') : '';
    sh.vertexShader = def + sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <skinnormal_vertex>', '#include <skinnormal_vertex>\n' + VERT);
    let fs = def + sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS).replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + NORMAL).replace('#include <normal_fragment_begin>', CLAY_OTHER + '\n#include <normal_fragment_begin>')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + OUT);
    // HUMAN c8 HOOKS: the skin's 'style' section (hero.js's //@skin-style marker: after lane B's albedo and lane D's paint), else the old
    // anchor; painted underwear sets hero.js's paint mask hNotSkin where it is declared (lane B's skin light transport then skips it)
    if (skinHook) { const after = fs.includes('float hNotSkin') ? SKIN_AFTER.replace(UW_MIX, UW_MIX + ' hNotSkin = max(hNotSkin, m);') : SKIN_AFTER;
      if (fs.includes('//@skin-style')) fs = fs.replace('//@skin-style', after + '\n//@skin-style');
      else if (fs.includes('roughnessFactor = pRough;\n}')) fs = fs.replace('roughnessFactor = pRough;\n}', 'roughnessFactor = pRough;\n}\n' + after); }
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + (body ? (tex ? '|stBT' : '|stB') : '|st');
  mat.needsUpdate = true;
}

// opts: surface 'skin' | 'clay' | 'flat' | 'poster' | 'notan'; clay colour; palette (PALETTES key or object); tone
// [terminator, softness, light boundary (-2 = none)]; pal: flat [light k, shadow k, mid mix] | poster/notan [ink cut, paper cut,
// ambient] on v = local value x light; underwear
export function applySurface(h, o = {}) {
  const S = h.style?.person, surf = o.surface || 'skin', pal = typeof o.palette === 'string' ? PALETTES[o.palette] : (o.palette || PALETTES.acp);
  const U = {
    stMode: STYLE_MODE, stSurf: { value: { flat: 1, poster: 2, notan: 3 }[surf] || 1 }, stClayK: { value: surf === 'clay' ? 1 : 0 }, stClay: { value: toV(o.clay || '#9c948a').convertSRGBToLinear() },
    stFade: { value: o.fade ?? 1 }, stLift: { value: o.lift ?? 0 }, stHasPlanes: { value: S && S.planeTable ? 1 : 0 }, stTint: { value: o.tint ?? 0.35 },
    stKey: { value: new THREE.Vector3(-0.5, 0.55, 0.65).normalize() }, stTone: { value: new THREE.Vector4(...(o.tone || [0.05, 0.03, 0.55, 0])) },
    stPal: { value: new THREE.Vector4(...(o.pal || (surf === 'flat' ? [1.0, 0.38, 0.55, 0] : surf === 'notan' ? [0.24, 0.24, 0.12, 0] : [0.16, 0.44, 0.12, 0]))) },
    stInk: { value: toV(pal.ink) }, stPaper: { value: toV(pal.paper) }, stRed: { value: toV(pal.red) }, stMid: { value: toV(pal.mid || pal.ink) },
    stUW: { value: new THREE.Vector4(0, 0, 0, -1) }, stUWc: { value: toV(o.uwColor || (surf === 'clay' ? '#6a645c' : '#d8d2c6')).convertSRGBToLinear() },
  };
  if (S && S.planeTable) { const PT = S.planeTable, np = Math.min(PT.count, MAXP);
    U.stPC = { value: Array.from({ length: MAXP }, (_, k) => k < np ? new THREE.Vector4(PT.c[k * 3], PT.c[k * 3 + 1], PT.c[k * 3 + 2], PT.d[k]) : new THREE.Vector4()) };
    U.stPN = { value: Array.from({ length: MAXP }, (_, k) => k < np ? new THREE.Vector4(PT.n[k * 3], PT.n[k * 3 + 1], PT.n[k * 3 + 2], 0) : new THREE.Vector4()) };
    U.stPR = { value: Array.from({ length: NMASS }, (_, m) => new THREE.Vector2(...(PT.range[m] || [0, 0]))) }; U.stWN = { value: PT.wN }; }
  else { U.stPC = { value: Array.from({ length: MAXP }, () => new THREE.Vector4()) }; U.stPN = { value: Array.from({ length: MAXP }, () => new THREE.Vector4()) }; U.stPR = { value: Array.from({ length: NMASS }, () => new THREE.Vector2()) }; U.stWN = { value: 0.2 }; }
  // the smoothed bind normal the plane rule reads (the clustering's normal), and the style attribute
  const g = h.body.geometry;
  if (!g.attributes.aStyle) { const n = g.attributes.position.count, a = new Float32Array(n * 4); for (let v = 0; v < n; v++) a[v * 4 + 3] = 0; g.setAttribute('aStyle', new THREE.BufferAttribute(a, 4)); }
  if (!g.attributes.aStyleN) g.setAttribute('aStyleN', new THREE.BufferAttribute(S && S.planeNormals ? S.planeNormals : g.attributes.normal.array.slice(), 3));
  if (o.underwear) { const I = h.idx, hipY = h.head0[I['upperleg01.L']].y, waistY = h.hems.waistY, P = g.attributes.position.array, AH = h.aHero; let apex = null;
    for (let v = 0; v < P.length / 3; v++) { if (AH[v * 4] !== 2) continue; const x = Math.abs(P[v * 3]), y = P[v * 3 + 1], z = P[v * 3 + 2];
      if (x > 0.04 && x < 0.13 && y > waistY + 0.08 && y < h.head0[I['upperarm01.L']].y - 0.04 && (!apex || z > apex.z)) apex = { y, z }; }
    U.stUW.value.set(hipY, waistY, apex ? apex.y : 0, h.sex === 'f' ? 1 : 0); }
  if (surf === 'clay') { h.body.material.sheen = 0; h.body.material.clearcoat = 0; if (h.skinU.hStubble) h.skinU.hStubble.value = 0; if (h.skinU.hDirt) h.skinU.hDirt.value = 0;
    h.group.traverse(m => { if (m.isMesh && m !== h.body) for (const mt of [].concat(m.material)) if (mt) { if ('sheen' in mt) mt.sheen = 0; if ('clearcoat' in mt && m !== h.eyes) mt.clearcoat = 0; } }); }
  const nA = Object.keys(g.attributes).filter(k => k !== 'aStyle' && k !== 'aStyleN' && !/^aDr|^aPt/.test(k)).length + (Object.keys(g.morphAttributes || {}).length ? 1 : 0);
  let stTex = null;
  if (o.tex !== false && nA + 2 > 16 && !h.body.material.userData.style) { const A = g.attributes.aStyle.array, N = g.attributes.aStyleN.array, n = g.attributes.position.count, w = 4096, d = new Float32Array(w * Math.ceil(2 * n / w) * 4);
    for (let v = 0; v < n; v++) { d.set(A.subarray(v * 4, v * 4 + 4), v * 8); d[v * 8 + 4] = N[v * 3]; d[v * 8 + 5] = N[v * 3 + 1]; d[v * 8 + 6] = N[v * 3 + 2]; }
    stTex = new THREE.DataTexture(d, w, d.length / 4 / w, THREE.RGBAFormat, THREE.FloatType); stTex.minFilter = stTex.magFilter = THREE.NearestFilter; stTex.generateMipmaps = false; stTex.needsUpdate = true; }
  patchMat(h.body.material, U, { body: true, skinHook: true, tex: stTex });
  let k = 0; const ids = {};
  h.group.traverse(m => { if (!m.isMesh || m === h.body) return; const part = m.userData.part || (m === h.eyes ? 'eyes' : 'other'); ids[part] ??= 40 + (k++);
    for (const mt of [].concat(m.material)) patchMat(mt, U, { obj: ids[part] }); });
  const st = { U, h, surface: surf, ids };
  h.styleSurface = st;
  return st;
}
// the designed key in view space, from a world direction (toward the light)
export function setKey(st, camera, dirWorld) { const v = new THREE.Vector3().copy(dirWorld).normalize().transformDirection(camera.matrixWorldInverse); st.U.stKey.value.copy(v); return st; }
// patch any other material (a ground, a prop) so the AOV and designed passes see it (obj: 0 ground, 1 prop ...)
export function patchOther(mat, st, obj = 1) { patchMat(mat, st.U, { obj }); }
// render one designed or AOV pass into the current target with everything unpatched hidden
export function stylePass(renderer, scene, camera, mode, { clear = [0, 0, 0, 0] } = {}) {
  const hid = []; scene.traverse(o => { if (!o.visible || !(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return; const ok = [].concat(o.material).every(m => m && m.userData && m.userData.style); if (!ok) { o.visible = false; hid.push(o); } });
  const bg = scene.background, fog = scene.fog, tm = renderer.toneMapping, ac = renderer.autoClear, sm = renderer.shadowMap.autoUpdate; scene.background = null; scene.fog = null;
  renderer.toneMapping = THREE.NoToneMapping; renderer.shadowMap.autoUpdate = false;
  try { STYLE_MODE.value = mode; renderer.setClearColor(new THREE.Color(clear[0], clear[1], clear[2]), clear[3]); renderer.clear(); renderer.render(scene, camera); }
  finally { STYLE_MODE.value = 0; for (const o of hid) o.visible = true; scene.background = bg; scene.fog = fog; renderer.toneMapping = tm; renderer.autoClear = ac; renderer.shadowMap.autoUpdate = sm; }
}
