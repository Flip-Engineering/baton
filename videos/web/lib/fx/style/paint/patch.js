// STYLE c2 / S2 PAINT: the shader side, chained from OUTSIDE onto every material of a built hero (after lane E's surface patch, so
// both live in one program; a hero without applyPaint renders exactly as before, and with it, exactly as before while PT_MODE is 0
// and ptMat is 0).
//
//   import { applyPaint, PT_MODE, paintPass } from '../lib/fx/style/paint/patch.js';
//   const pt = applyPaint(h, { unit });          // per-hero uniforms (pt.U): cell size, fine factor, material, seed
//   paintPass(renderer, scene, camera, 1, rt);   // one AOV pass into a float target (everything unpatched hidden)
//
// What a fragment knows (all in BIND space, so it rides the skinning): its bind position, the stroke direction (fields.js aPtD), the
// dominant muscle (flat id) and its weight (negative = subcutaneous bone), the cavity, and a brush-size level.
// DABS (Meier 1996, 'Painterly rendering for animation': strokes are particles ON the surface, so they move with it): seeds in a 3D
// lattice of the bind space (3 a cell, jittered), each an ellipse along the stroke direction (rotated a little, length and width
// jittered); a fragment belongs to the covering dab of highest priority (a random order: later strokes over earlier). The brush size
// steps (1, 0.7, ptFine) by region (fields.js: face and hands fine, hair medium), each step its own lattice: a painter changes brush,
// the strokes do not shrink continuously (a continuous scale zooms the lattice and tears it).
// Modes (PT_MODE.value):
//   1 STROKES  (stroke id, along -1..1, across -1..1, object class)      0 id = no dab here: the underpainting shows
//   2 MATTER   (albedo rgb, linear, view depth)
//   3 FIELDS   (wobble noise ~6 cm, granulation ~3 mm, muscle id + weight/2 | -1 - bone, mass id: lane E's 0..18 on the body,
//              20 + object class elsewhere: garment 22, hair 23, eyes 24, ground 110)
//   4 PLATE    the anatomy plate's designed colour (display-referred): muscles, fibre hatching in dabs along the fibres, bone, skin
//   5 TRACE    bind position (m) + person and class: exact surface correspondence between frames for the motion check
// ptMat (lit pass, per hero): 1 bronze, 2 plaster, 3 stainless steel: albedo, metalness, roughness from the cavity and the
// fields (patina in the creases and where rain runs, polish on the crowns; welded sheets for the steel), before the light reads them.
import * as THREE from 'three';

export const PT_MODE = { value: 0 };
export const OBJ = { body: 1, garment: 2, hair: 3, eyes: 4, other: 5, ground: 90, set: 91 };

// STYLE c4: a geometry with no room for two more vertex attributes (WebGL's 16, one spent by three's morph targets; the v4 body is
// full) reads aPtD / aPtM from a float texture by gl_VertexID instead (PT_TEX, two texels a vertex, exact); otherwise as before.
const VERT_PARS = /* glsl */`
#ifdef PT_TEX
uniform highp sampler2D ptFieldTex;
#else
attribute vec3 aPtD; attribute vec4 aPtM;
#endif
varying vec4 vPtA, vPtB; varying float vPtW; flat varying float vPtI;`;
const VERT = /* glsl */`
#ifdef PT_TEX
{ int i = gl_VertexID * 2, j = i + 1; vec3 aPtD = texelFetch(ptFieldTex, ivec2(i % 4096, i / 4096), 0).xyz; vec4 aPtM = texelFetch(ptFieldTex, ivec2(j % 4096, j / 4096), 0);
  vPtA = vec4(position, aPtM.z); vPtB = vec4(aPtD, aPtM.w); vPtW = aPtM.y; vPtI = aPtM.x; }
#else
vPtA = vec4(position, aPtM.z); vPtB = vec4(aPtD, aPtM.w); vPtW = aPtM.y; vPtI = aPtM.x;
#endif`;
// aPtD / aPtM as a float texture (two texels a vertex, 4096 a row)
function paintFieldTexture(g) {
  const D = g.attributes.aPtD?.array, M = g.attributes.aPtM?.array; if (!D || !M) return null;
  const n = g.attributes.position.count, w = 4096, h = Math.ceil(2 * n / w), d = new Float32Array(w * h * 4);
  for (let v = 0; v < n; v++) { d[v * 8] = D[v * 3]; d[v * 8 + 1] = D[v * 3 + 1]; d[v * 8 + 2] = D[v * 3 + 2]; d.set(M.subarray(v * 4, v * 4 + 4), v * 8 + 4); }
  const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t;
}
const ptAttrs = (h, m) => Object.keys(m.geometry.attributes).filter(k => k !== 'aPtD' && k !== 'aPtM').length + (m === h.body && !m.geometry.attributes.aStyle ? 2 : 0) + (Object.keys(m.geometry.morphAttributes || {}).length ? 1 : 0);
const FRAG_PARS = /* glsl */`
uniform float ptMode, ptMat, ptObj, ptSeed, ptCell, ptFine, ptUnit, ptLen, ptWid, ptHatch, ptScreen;
uniform vec3 ptKey; uniform vec4 ptMatA, ptMatB;
varying vec4 vPtA, vPtB; varying float vPtW; flat varying float vPtI;
float ptH(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
vec3 ptH3(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float ptVN(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ptH(i), ptH(i + vec3(1,0,0)), f.x), mix(ptH(i + vec3(0,1,0)), ptH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(ptH(i + vec3(0,0,1)), ptH(i + vec3(1,0,1)), f.x), mix(ptH(i + vec3(0,1,1)), ptH(i + vec3(1,1,1)), f.x), f.y), f.z); }
float ptFbm(vec3 p){ return 0.6 * ptVN(p) + 0.3 * ptVN(p * 2.03 + 7.1) + 0.1 * ptVN(p * 4.1 + 3.3); }
// the bind-space frame of this fragment: the face normal from the derivatives (no extra varying), the stroke direction made tangent
vec3 ptNF(){ vec3 n = cross(dFdx(vPtA.xyz), dFdy(vPtA.xyz)); float l = length(n); return l > 1e-12 ? n / l : vec3(0.0, 0.0, 1.0); }
// the winning dab: x id (0 none), y along, z across, w the lattice cell size used
vec4 ptDab(float cellM, float lenK, float widK, float salt){
  vec3 P = vPtA.xyz, nF = ptNF(), dir = vPtB.xyz;
  if (ptScreen > 0.0) { P = vec3(gl_FragCoord.xy * ptScreen, 0.0); nF = vec3(0.0, 0.0, 1.0); dir = vec3(dir.xy + 1e-4, 0.0); }   // the CONTROL: a lattice fixed to the screen (shower door)
  vec3 d0 = dir - nF * dot(dir, nF);
  d0 = length(d0) > 1e-5 ? normalize(d0) : normalize(cross(nF, vec3(0.31, 0.93, 0.17)));
  vec3 b0 = cross(nF, d0);
  float lv = vPtB.w < 0.33 ? 0.0 : vPtB.w < 0.67 ? 1.0 : 2.0, cs = cellM * ptUnit * (lv < 0.5 ? 1.0 : lv < 1.5 ? 0.7 : ptFine);
  vec3 g = P / cs, c0 = floor(g); float best = -1.0; vec3 o = vec3(0.0);
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) {
    vec3 c = c0 + vec3(float(i), float(j), float(k));
    for (int s = 0; s < 3; s++) {
      vec3 cs3 = c + vec3(float(s) * 57.13 + lv * 13.7, ptSeed + salt, ptObj * 3.17);
      vec3 q = g - (c + ptH3(cs3));
      if (abs(dot(q, nF)) > 0.6) continue;
      float an = (ptH(cs3 + 3.1) - 0.5) * 0.55, ca = cos(an), sa = sin(an);
      vec3 dd = d0 * ca + b0 * sa, bb = b0 * ca - d0 * sa;
      float L = lenK * (0.75 + 0.25 * ptH(cs3 + 5.7)), Wd = widK * (0.8 + 0.4 * ptH(cs3 + 9.2));
      float a = dot(q, dd) / L, w = dot(q, bb) / Wd;
      // a brush stroke, not an ellipse: full width over most of its length, a rounded start, a dragged (tapered, ragged) end
      float wa = a < 0.0 ? sqrt(max(0.0, 1.0 - a * a)) : 1.0 - pow(max(a, 0.0), 2.2) * (0.75 + 0.5 * ptH(cs3 + floor(w * 4.0 + 4.0)));
      if (abs(a) < 1.0 && abs(w) < wa) { float pr = ptH(cs3 + 1.3); if (pr > best) { best = pr; o = vec3(floor(ptH(cs3 + 7.7) * 8388000.0) + 1.0, a, w); } }
    }
  }
  return vec4(o, cs);
}`;
// right before lights_physical_fragment reads the material (after hero.js, lane B, lane D, CLOTHING and lane E have written their
// albedo): the monument materials (lit pass, ptMat > 0)
const MATTER = /* glsl */`
if (ptMat > 0.5) {
  vec3 P = vPtA.xyz / ptUnit; float cav = vPtA.w, wn = (vec4(normalize(normal), 0.0) * viewMatrix).y;   // world up-ness of the (view) normal
  float nz = ptFbm(P * 9.0), nf = ptVN(P * 140.0), drape = 0.0;
  #ifdef ST_BODY
  drape = 1.0 - smoothstep(0.0, 0.004, distance(diffuseColor.rgb, stUWc));      // lane E's painted underwear: a cast drapery
  #endif
  if (ptMat < 1.5) {          // BRONZE: polished where touched and on the crowns, brown patina, verdigris in creases and where rain runs
    float crease = smoothstep(0.015, 0.2, cav + 0.06 * (nz - 0.5)), crown = smoothstep(0.04, 0.25, -cav);   // cavity: body p90 ~0.02, p99 ~0.16
    float rain = smoothstep(0.35, 0.9, wn) * smoothstep(0.45, 0.75, ptFbm(vec3(P.x * 30.0, P.y * 2.5, P.z * 30.0)));
    if (ptObj > 1.5) crease = smoothstep(0.08, 0.3, cav + 0.06 * (nz - 0.5));          // garments: their folds are deeper than the body's creases
    float verd = clamp(crease * 0.8 + rain * 0.55 + drape * 0.25, 0.0, 1.0);
    vec3 bronze = mix(ptMatA.rgb, ptMatA.rgb * vec3(1.9, 1.62, 1.2), crown) * (0.84 + 0.32 * nz);
    diffuseColor.rgb = mix(bronze, ptMatB.rgb * (0.8 + 0.4 * nf), verd);
    metalnessFactor = mix(1.0, 0.0, verd); roughnessFactor = mix(mix(0.42, 0.24, crown) + 0.1 * nf, 0.85, verd);
  } else if (ptMat < 2.5) {   // PLASTER: chalk white, dust settled in the creases, a faint seam of the piece-mould
    float dust = smoothstep(0.02, 0.25, cav) * 0.5 + 0.08 * nf;
    diffuseColor.rgb = ptMatA.rgb * (1.0 - 0.18 * dust) * (0.97 + 0.06 * nz) * mix(vec3(1.0), vec3(0.95, 0.93, 0.9), drape);
    metalnessFactor = 0.0; roughnessFactor = 0.92;
  } else {                    // STAINLESS STEEL (Mukhina 1937): welded sheets, each its own sheen, brushed along the form, seams
    vec3 g = P / 0.22, c0 = floor(g); float f1 = 9.0, f2 = 9.0; vec3 id = vec3(0.0);
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) { vec3 c = c0 + vec3(float(i), float(j), float(k)), q = g - c - ptH3(c + ptSeed); float dd = dot(q, q);
      if (dd < f1) { f2 = f1; f1 = dd; id = c; } else if (dd < f2) f2 = dd; }
    float seam = (1.0 - smoothstep(0.0, 0.03, sqrt(f2) - sqrt(f1))) * (1.0 - smoothstep(0.5, 0.8, vPtB.w)), sheet = ptH(id + 4.0);
    vec3 nF = ptNF(), dd = normalize(vPtB.xyz - nF * dot(vPtB.xyz, nF) + 1e-5), bb = cross(nF, dd);
    float brush = ptVN(vec3(dot(P, bb) * 900.0, dot(P, dd) * 12.0, sheet * 50.0));
    diffuseColor.rgb = ptMatA.rgb * (0.93 + 0.1 * sheet) * (1.0 - 0.35 * seam) * mix(vec3(1.0), vec3(0.9, 0.88, 0.86), drape);
    metalnessFactor = 1.0 - 0.6 * seam; roughnessFactor = clamp(0.16 + 0.12 * sheet + 0.1 * brush + 0.3 * seam + 0.15 * drape, 0.05, 1.0);
  }
}`;
// the AOVs and the plate, at the end of the shader
const OUT = /* glsl */`
if (ptMode > 0.5) {
  if (ptMode < 1.5) { vec4 D = ptObj < 50.0 ? ptDab(ptCell, ptLen, ptWid, 0.0) : vec4(0.0); gl_FragColor = vec4(D.x, D.y, D.z, ptObj); }
  else if (ptMode < 2.5) gl_FragColor = vec4(diffuseColor.rgb, vViewPosition.z);
  else if (ptMode > 4.5) gl_FragColor = vec4(vPtA.xyz / ptUnit, ptSeed + ptObj * 1000.0);   // 5 TRACE: the bind position (m) and who: the motion check's correspondence
  else if (ptMode < 3.5) { vec3 P = vPtA.xyz / ptUnit; float mus = vPtW >= 0.0 ? vPtI + 0.5 * clamp(vPtW, 0.0, 0.999) : -1.0 + vPtW, reg = 20.0 + ptObj;
    #ifdef ST_BODY
    reg = vStM;
    #endif
    gl_FragColor = vec4(ptFbm(P * 16.0 + ptSeed), ptVN(P * 330.0), ptObj == 1.0 ? mus : -9.0, reg); }
  else if (ptObj > 50.0) gl_FragColor = vec4(0.0);
  else {   // PLATE: the anatomy plate (display-referred, on cream; muscles in Albinus red, fibre hatching along lane A's bellies)
    vec3 N = normalize(normal); float ndl = dot(N, normalize(ptKey)), lit = smoothstep(-0.35, 0.75, ndl);
    vec3 paper = vec3(0.937, 0.902, 0.824), sepia = vec3(0.24, 0.15, 0.1), skin = vec3(0.93, 0.84, 0.74);
    float tone = 0.86 + 0.28 * ptH(vec3(vPtI, 3.0, 7.0));
    vec3 muscle = mix(vec3(0.55, 0.2, 0.15), vec3(0.86, 0.52, 0.42), lit) * tone, tissue = mix(vec3(0.45, 0.2, 0.16), vec3(0.7, 0.42, 0.34), lit), bone = mix(vec3(0.78, 0.72, 0.6), vec3(0.96, 0.93, 0.84), lit);
    float w = vPtW, mw = smoothstep(0.08, 0.45, w), bw = smoothstep(0.25, 0.6, -w), skinK = smoothstep(0.55, 0.85, vPtB.w);   // face, hands: skin
    vec3 c = mix(mix(tissue, muscle, mw), skin * mix(0.78, 1.0, lit), ptObj == 1.0 ? skinK : 1.0);
    c = mix(c, bone, ptObj == 1.0 ? bw * (1.0 - skinK) : 0.0);
    // hatching: short parallel strokes in dabs along the fibres (the engraver's patches); more and heavier in shadow
    vec4 D = ptDab(ptHatch, 1.0, 0.95, 19.0);
    float dens = 1.0 - lit, k = 5.0, s = abs(fract(D.z * k * 0.5 + 0.5) - 0.5) * 2.0, th = 0.12 + 0.55 * dens * dens;
    float ln = (D.x > 0.0 ? 1.0 : 0.0) * (1.0 - smoothstep(th - 0.12, th + 0.12, s)) * smoothstep(1.0, 0.6, abs(D.y)) * smoothstep(0.08, 0.3, dens);
    vec3 ink = ptObj == 1.0 ? mix(sepia, vec3(0.33, 0.08, 0.05), 1.0 - skinK) : sepia;
    c = mix(c, ink, ln * (ptObj == 1.0 ? 0.75 : 0.55));
    if (ptObj > 1.5 && ptObj < 3.5) c = mix(paper, c, 0.5);       // garments and hair: ghosts over the anatomy
    #ifdef ST_BODY
    { float uw = 1.0 - smoothstep(0.0, 0.004, distance(diffuseColor.rgb, stUWc)); c = mix(c, mix(paper, vec3(0.66, 0.7, 0.76), 0.3 + 0.2 * ln), uw * 0.7); }   // lane E's plain underwear, as a ghost
    #endif
    gl_FragColor = vec4(c, 1.0);
  }
}`;

// install on one material (chained after whatever is there: hero.js, lane B, lane D, lane E, light/)
function patchMat(mat, U, own, geo = null) {
  if (!mat || mat.userData.paint || !(mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial)) return false;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  if (geo) { mat.defines = { ...(mat.defines || {}), PT_TEX: '' }; own = { ...own, ptFieldTex: { value: null } }; }
  mat.userData.paint = { U, own };
  mat.onBeforeCompile = (sh, r) => {
    if (geo && !own.ptFieldTex.value) own.ptFieldTex.value = geo.userData.ptTex ||= paintFieldTexture(geo);
    if (prev) prev.call(mat, sh, r);
    Object.assign(sh.uniforms, U, own);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <lights_physical_fragment>', MATTER + '\n#include <lights_physical_fragment>')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + OUT);
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '|pt1';
  mat.needsUpdate = true; return true;
}
const objOf = (h, m) => m === h.body ? OBJ.body : m.userData.part === 'hair8' || m.userData.hairPart ? OBJ.hair : (m === h.eyes || (h.likeness && h.likeness.eyes && h.likeness.eyes.mesh === m)) ? OBJ.eyes
  : m.userData.part === 'eyes' ? OBJ.eyes : OBJ.garment;
// unit: bind units per metre (1 / h.scale for a Hero); per-hero uniforms; materials made later (hair cards, eyes) get patched by
// calling applyPaint again (idempotent)
export function applyPaint(h, o = {}) {
  const pt = h.paint || { U: {
    ptMode: PT_MODE, ptMat: { value: 0 }, ptSeed: { value: o.seed ?? ((h.o && h.o.seed) || 1) * 1.37 }, ptCell: { value: o.cell ?? 0.022 }, ptFine: { value: o.fine ?? 0.42 },
    ptUnit: { value: o.unit ?? (h.scale ? 1 / h.scale : 1) }, ptLen: { value: 1.0 }, ptWid: { value: 0.36 }, ptHatch: { value: 0.03 }, ptScreen: { value: 0 },
    ptKey: { value: new THREE.Vector3(-0.6, 0.5, 0.62).normalize() }, ptMatA: { value: new THREE.Vector4(0.36, 0.2, 0.09, 0) }, ptMatB: { value: new THREE.Vector4(0.18, 0.36, 0.3, 0) } }, mats: 0 };
  const users = new Map(); h.group.traverse(m => { if (m.isMesh) for (const mt of [].concat(m.material)) users.set(mt, (users.get(mt) || 0) + 1); });
  h.group.traverse(m => { if (!m.isMesh) return; const id = objOf(h, m), full = o.tex !== false && ptAttrs(h, m) + 2 > 16;
    for (const mt of [].concat(m.material)) if (patchMat(mt, pt.U, { ptObj: { value: id } }, full && users.get(mt) === 1 ? m.geometry : null)) { pt.mats++; if (full) pt.tex = (pt.tex || 0) + 1; } });
  h.paint = pt; return pt;
}
// patch a set material (the ground: 90, a plinth: 91) so the AOV passes see it
export function paintOther(mat, U, obj = OBJ.ground) { return patchMat(mat, U, { ptObj: { value: obj } }); }
// one pass in mode `mode` into the current render target, everything unpatched hidden, no tone mapping, no fog, no background
export function paintPass(renderer, scene, camera, mode, { clear = [0, 0, 0, 0] } = {}) {
  const hid = []; scene.traverse(o => { if (!o.visible || !(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return; const ok = [].concat(o.material).every(m => m && m.userData && m.userData.paint); if (!ok) { o.visible = false; hid.push(o); } });
  const bg = scene.background, fog = scene.fog, tm = renderer.toneMapping, sm = renderer.shadowMap.autoUpdate; scene.background = null; scene.fog = null;
  renderer.toneMapping = THREE.NoToneMapping; renderer.shadowMap.autoUpdate = false;
  try { PT_MODE.value = mode; renderer.setClearColor(new THREE.Color(clear[0], clear[1], clear[2]), clear[3]); renderer.clear(); renderer.render(scene, camera); }
  finally { PT_MODE.value = 0; for (const o of hid) o.visible = true; scene.background = bg; scene.fog = fog; renderer.toneMapping = tm; renderer.shadowMap.autoUpdate = sm; }
}
let RT = null;
// read several modes at w x h (Float32, rows bottom-up as GL reads them)
export function paintAOV(renderer, scene, camera, w, h, modes = [1, 2, 3]) {
  if (!RT || RT.width !== w || RT.height !== h) { RT?.dispose(); RT = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true }); }
  const prev = renderer.getRenderTarget(), cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha(), out = { w, h };
  renderer.setRenderTarget(RT);
  for (const m of modes) { paintPass(renderer, scene, camera, m, { clear: [0, 0, 0, 0] }); const a = new Float32Array(w * h * 4); renderer.readRenderTargetPixels(RT, 0, 0, w, h, a); out['m' + m] = a; }
  renderer.setRenderTarget(prev); renderer.setClearColor(cc, ca);
  return out;
}
