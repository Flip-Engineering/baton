// LIKENESS / skin: photoreal skin for a built hero.js person, applied from OUTSIDE (HUMAN c8, lane B). Opt-in: a hero nobody calls
// this on renders exactly as before.
//
//   import { applySkin } from '../lib/fx/likeness/skin.js';
//   const h = new Hero(data, opts);
//   const S = await applySkin(h, { preset: 'Ada' });          // or { skin: { Cm, beta, Ch, gamma, Cc } }, or nothing (fit from o.skin)
//   S.set({ tan: 0.6, homogeneity: 0.7 });                     // live: uniforms only (no recompile)
//   // then litPatchAll(scene) as usual (it chains after this)
//
// What it does to h.body (the material keeps hero.js's own SKIN_FRAG: brows, stubble, creases, nails' mask, dirt, sweat):
//  1. ALBEDO from biophysics (skin_lut.js; calibrated by scripts/skin_calib.py against NIST and published deep-skin colorimetry):
//     the person is (melanin, eu/pheo, blood, oxygenation, carotene); a per-person table maps regional MULTIPLIERS of melanin and
//     blood (and a cooler, deoxygenated slice) to linear RGB (Jimenez et al. 2010's two maps; Donner and Jensen 2006's layers).
//     Regional maps, per vertex in bind space (no UVs) or analytic in the shader: redder nose, cheeks, ears, lips, knuckles,
//     fingertips; darker, cooler periorbital skin; palms and soles with a fifth of the melanin (melanin index 42 vs 240 and L* 60 vs
//     39 on highly pigmented skin, Vasudevan et al. 2024); darker knees, elbows and knuckles; sun-exposed face, neck, forearms and
//     hands against covered skin (photoexposed melanin up to 2x, Alaluf et al. 2002); sparse freckles, moles and solar
//     lentigines; veins on the backs of the hands, the inner wrist and the temples; a beard shadow only where a beard grows.
//     hero.js's own flat tints (the c4 mottling, cheek, ear and lip multipliers) are divided out, so they do not stack.
//  2. MICROSTRUCTURE as normals in bind space, no textures: cellular pores (Worley 1996 F1 pits; larger and deeper on the nose
//     and cheeks), the cross-hatched relief of the skin's furrows (three warped families), and lines by age (forehead, glabella,
//     crow's feet, under the eye, lip fissures, neck rings, knuckle creases). The analytic bind-space gradient is carried to the
//     screen through dFdx/dFdy of the bind position and applied with Mikkelsen's surface-gradient bump (2010, "Bump mapping
//     unparametrized surfaces on the GPU"), so it follows skinning for free. Each feature fades by its size in pixels and the
//     slope variance it loses goes into roughness (Toksvig 2005; LEAN, Olano and Baker 2010): detail becomes sheen at distance.
//  3. SPECULAR: ior 1.4 (F0 0.028; Weyrich et al. 2006 measured ~1.38), a broad base lobe ~0.55 and a sharp oily lobe ~0.28 carried
//     by the clearcoat (sebum's index ~1.47 gives the clearcoat's F0 0.04), weighted by a regional oil map (T-zone, nose, chin,
//     lips; hero.js's c6 sweat keeps its wet film), no sheen. Specular occlusion from per-vertex cavity and the micro pits
//     (Lagarde and de Rousiers 2014's form; Jimenez et al. 2016).
//  4. SUBSURFACE: flesh.js's pre-integrated LUT (Penner and Borshukov 2011, d'Eon-Luebke profile) on per-vertex curvature, with the
//     diffuse taking a per-channel softened normal (red smoothest: light scatters under the pores) and transmission through ears
//     and fingers (no shadow test: a thin part the head shades must not be in the mask). Replaces hero.js's c7 per-channel wrap on this material only.
//  5. NAILS from the person's own skin: the nail bed's blood under a translucent plate, a paler free edge (the c1 fixed white
//     plate read as painted tips on deep skin).
// Controls (params, all optional; defaults are a typical person, never an extreme): tan, homogeneity (Fink et al. 2006),
// health (carotenoid + oxygenated redness, Stephen et al. 2009, 2011), weathering (lentigines, coarse relief), freckles, moles,
// pores (never below 0.5 at L0: the floor that keeps a face out of the uncanny, MacDorman et al. 2009), oil, beardShadow, sss, age,
// level (the style ladder L0..L4: detail matched to the simplification; see applySkin).
import * as THREE from 'three';
import { HERO_REGIONS as R } from '../hero.js';
import { skinLUT } from '../flesh.js';
import { loadSkinModel, personLUT, skinFromHex, skinFromHex6, LUT_AXES, lutAt, rgbToLab, LD_MAX_MM } from './skin_lut.js';
import { TISSUE_TILES, CORNEUM, cornK, cornCoord, VERMILION } from './tissue.js';
import { fields4, areolae } from './zones4.js';
import { skinOptics, fitFace, pigmentsFromHex, FACE_BLOOD, BODY_BLOOD } from './optics.js';
import { personSurface } from './surface.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const g2 = (dx, dy, sx, sy) => Math.exp(-(dx * dx) / (sx * sx) - (dy * dy) / (sy * sy));

export const SKIN_DEFAULTS = { level: 0, tan: 0.5, homogeneity: 0.5, health: 0, weathering: null, freckles: null, moles: 0.4, pores: 1, relief: 1, lines: 1,
  oil: 0.5, beardShadow: null, sss: 1.6, trans: 1, veins: 0.6, lipTone: null, age: null, nails: 1, microFade: 1, rev: 1 };

// ---------------------------------------------------------------- per-vertex fields (bind space)
// returns { A: Float32Array(n*4) (curvature 1/m, ao, thin, sun), B: Float32Array(n*4) (melanin x, blood x, oil, volar), land }
export function skinFields(h, f4 = null) {
  const g = h.body.geometry, P = g.attributes.position.array, N = h.nrm, AH = h.aHero, n = P.length / 3, I = g.index.array;
  // 1-ring adjacency
  const nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
  const adj = nb.map(s => Int32Array.from(s));
  const smooth = (src, it, k = 4) => { let a = src.slice(), b = new Float32Array(src.length);
    for (let s = 0; s < it; s++) { for (let v = 0; v < n; v++) { const l = adj[v]; if (!l.length) { for (let c = 0; c < k; c++) b[v * k + c] = a[v * k + c]; continue; }
      for (let c = 0; c < k; c++) { let m = 0; for (const u of l) m += a[u * k + c]; b[v * k + c] = 0.5 * a[v * k + c] + 0.5 * m / l.length; } } [a, b] = [b, a]; } return a; };
  // curvature: mean |normal change / position change| over the ring (the 1/r flesh.js and Penner key their LUT by)
  const curv = new Float32Array(n);
  for (let v = 0; v < n; v++) { let s = 0, w = 0; for (const u of adj[v]) { const dx = P[u * 3] - P[v * 3], dy = P[u * 3 + 1] - P[v * 3 + 1], dz = P[u * 3 + 2] - P[v * 3 + 2], d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 1e-12) continue; const dn = (N[u * 3] - N[v * 3]) * dx + (N[u * 3 + 1] - N[v * 3 + 1]) * dy + (N[u * 3 + 2] - N[v * 3 + 2]) * dz; s += Math.abs(dn) / d2; w++; } curv[v] = w ? s / w : 0; }
  const curvS = smooth(curv, 3, 1);
  // cavity / ambient occlusion: how far the vertex sits under a smoothed copy of the surface, at two scales (mm-scale folds and cm-scale hollows)
  const cav = new Float32Array(n);
  for (const [it, k] of [[6, 220], [24, 70]]) { const S = smooth(P, it, 3);
    for (let v = 0; v < n; v++) { const d = (P[v * 3] - S[v * 3]) * N[v * 3] + (P[v * 3 + 1] - S[v * 3 + 1]) * N[v * 3 + 1] + (P[v * 3 + 2] - S[v * 3 + 2]) * N[v * 3 + 2]; cav[v] += Math.min(0, d) * k; } }
  // landmarks
  const eL = h.eyeL, eR = h.eyeR, eyeY = (eL.y + eR.y) / 2, eyeX = Math.abs(eL.x), mo = h.mouth, eyeZ = (eL.z + eR.z) / 2;
  let nose = null; for (let v = 0; v < n; v++) { const r = AH[v * 4]; if (r !== R.head && r !== R.jaw) continue; const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    if (Math.abs(x) < 0.006 && y < eyeY - 0.015 && y > mo.y + 0.012 && (!nose || z > nose.z)) nose = new THREE.Vector3(0, y, z); }
  nose = nose || new THREE.Vector3(0, (eyeY + mo.y) / 2, eyeZ + 0.03);
  const land = { eyeY, eyeX, eyeZ, nose, mouth: mo.clone() };
  const A = new Float32Array(n * 4), B = new Float32Array(n * 4), SUN = new Float32Array(n), MEL = new Float32Array(n), BLD = new Float32Array(n), VOL = new Float32Array(n);
  // SKIN OPTICS iteration 10 (rev 7, f4.z7.corneum): the epidermis's corneum by cutaneous SITE (tissue.js CORNEUM: Ya-Xian, Suetake and Tagami 1999's cell layers), as log layers per vertex:
  // the face 9, the neck 10, the trunk 13, the limbs and the backs of the hands and feet 15 (the calibration's forearm), the palms and soles 47 by the volar weight (the heel's 86 sits at
  // the table's last level); smoothed like the other fields (a site's edge is soft over a centimetre or two) and returned as the table's corneum coordinate (D)
  const CRN = f4?.z7?.corneum ? new Float32Array(n) : null, CL = CORNEUM.layers, crnOf = r => r === R.head || r === R.jaw ? CL.face : r === R.neck ? CL.neck : r === R.torso || r === R.pelvis ? CL.trunk : CL.limb;
  // SKIN4 (rev 4, opt-in): the measured face zones and the body's extra zones (zones4.js) replace lane B's face multipliers and oil map
  const Z4 = f4 ? fields4(h, P, N, AH, n, f4) : null;
  const sunReg = { [R.head]: 1, [R.jaw]: 1, [R.neck]: 0.85, [R.torso]: 0.06, [R.uarm]: 0.3, [R.farm]: 0.85, [R.hand]: 1, [R.finger]: 1, [R.pelvis]: 0, [R.thigh]: 0.06, [R.shin]: 0.2, [R.foot]: 0.05 };
  for (let v = 0; v < n; v++) {
    const r = AH[v * 4], lc = AH[v * 4 + 1], dors = AH[v * 4 + 3], x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], ax = Math.abs(x), ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    const face = (r === R.head || r === R.jaw || y > eyeY - 0.15) && r !== R.uarm && r !== R.farm && r !== R.hand && r !== R.finger;
    let sun = sunReg[r] ?? 0.1, mel = 1, bld = 1, oil = 0.12, thin = 0, volar = 0;
    if (r === R.neck && nz < -0.3) sun = 0.95;                                           // the back of the neck (the farmer's tan line)
    if (r === R.hand || r === R.finger) { volar = 1 - sst(0.15, 0.55, dors); sun *= 1 - 0.7 * volar; }
    if (r === R.foot && ny < -0.45) volar = 1;
    // knees, elbows, knuckles: darker (thicker, rubbed skin), a little redder
    if ((r === R.uarm || r === R.farm) && nz < -0.2) { const k = g2(lc - 1, 0, 0.16, 1) * sst(-0.2, -0.7, nz); mel *= 1 + 0.35 * k; bld *= 1 + 0.15 * k; }
    if ((r === R.thigh || r === R.shin) && nz > 0.2) { const k = g2(lc - 1, 0, 0.12, 1) * sst(0.2, 0.7, nz); mel *= 1 + 0.3 * k; bld *= 1 + 0.12 * k; }
    if (r === R.finger) { const a = lc - 3, ph = Math.floor(a), f = a - ph, jn = (sst(0.2, 0, f) + (ph < 2 ? sst(0.8, 1, f) : 0)) * dors;
      mel *= 1 + 0.4 * jn; bld *= 1 + 0.3 * jn; if (ph === 2) bld *= 1 + 0.35 * (1 - dors) * sst(0.4, 0.9, f); thin = 0.55; }
    if (r === R.hand) { const k = sst(1.82, 1.98, lc) * dors; mel *= 1 + 0.35 * k; bld *= 1 + 0.25 * k; thin = 0.15 * sst(0.6, 0.95, 1 - Math.abs(N[v * 3 + 0])); }
    if (volar > 0) { mel *= 1 - 0.8 * volar; bld *= 1 + 0.25 * volar; }
    if (face) {
      const dy = y - eyeY, front = sst(eyeZ - 0.06, eyeZ - 0.02, z);
      // nose: tip and alae redder (dense superficial vessels); cheeks: the malar flush; chin a little; ears much (thin, vascular)
      const kn = g2(x, y - nose.y, 0.016, 0.018) * front;
      const kc = g2(ax - 0.042, dy + 0.032, 0.02, 0.018) * front;
      const kch = g2(x, y - (mo.y - 0.035), 0.022, 0.016) * front;
      const ear = sst(0.064, 0.072, ax) * sst(eyeZ - 0.02, eyeZ - 0.045, z) * g2(0, dy + 0.012, 1, 0.045) * (r === R.head || r === R.jaw ? 1 : 0);
      if (!Z4?.report.face) { bld *= 1 + 0.6 * kn + 0.4 * kc + 0.15 * kch + 0.45 * ear; mel *= 1 + 0.05 * kc; }
      // oil (sebaceous density): T-zone (forehead centre, nose, upper lip), chin; cheeks less
      const fh = g2(x, dy - 0.045, 0.035, 0.03) * front;
      oil = 0.18 + 0.55 * fh + 0.7 * kn + 0.35 * kch + 0.2 * kc;
      thin = Math.max(thin, 0.9 * ear);   // ears only on the face: the term has no shadow, and a nostril rim lit from behind the head glowed (dawn, 3 Oct)
    }
    if (Z4) { mel *= Z4.mel[v]; bld *= Z4.blood[v]; oil = Z4.oil[v]; }
    SUN[v] = sun; MEL[v] = mel; BLD[v] = bld; VOL[v] = volar;
    if (CRN) { const ly = Math.log(crnOf(r)); CRN[v] = ly + (Math.log(CL.volar) - ly) * volar; }
    A[v * 4] = curvS[v]; A[v * 4 + 1] = clamp(1 + cav[v], 0.25, 1); A[v * 4 + 2] = thin; B[v * 4 + 2] = Math.min(1, oil);
  }
  // smooth the region-based fields across region seams (a tan line is soft over a centimetre or two)
  const F = new Float32Array(n * 4); for (let v = 0; v < n; v++) { F[v * 4] = SUN[v]; F[v * 4 + 1] = MEL[v]; F[v * 4 + 2] = BLD[v]; F[v * 4 + 3] = VOL[v]; }
  const Fs = smooth(F, 4, 4);
  for (let v = 0; v < n; v++) { A[v * 4 + 3] = Fs[v * 4]; B[v * 4] = Fs[v * 4 + 1]; B[v * 4 + 1] = Fs[v * 4 + 2]; B[v * 4 + 3] = Fs[v * 4 + 3]; }
  let D = null; if (CRN) { const Cs = smooth(CRN, 4, 1); D = new Float32Array(n); for (let v = 0; v < n; v++) D[v] = cornCoord(Math.exp(Cs[v])); }
  if (!Z4) return { A, B, land, ...(D ? { D } : {}) };
  // rev 4: C = (the deoxygenated share, roughness offset, pore scale, 0), smoothed like the others
  const C = new Float32Array(n * 4); for (let v = 0; v < n; v++) { C[v * 4] = Z4.tc ? Z4.tc[v * 2] : Z4.oxy[v]; C[v * 4 + 1] = Z4.rough[v]; C[v * 4 + 2] = Z4.pore[v]; C[v * 4 + 3] = Z4.tc ? Z4.tc[v * 2 + 1] : 0; }   // rev 7: (x, w) = the vertex's tissue column (tissue.js)
  return { A, B, C: smooth(C, 2, 4), ...(D ? { D } : {}), land, z4: Z4.report };
}

// ---------------------------------------------------------------- shader
const PARS = /* glsl */`
attribute_placeholder
uniform sampler2D likeLUT, likeSSS; uniform vec3 likeBase, likeNose; uniform vec4 likeK0, likeK1, likeK2, likeK3; uniform vec2 likeAxes0, likeAxes1; uniform float likeScale, likeOn, likeDbg, likeLight;
varying vec4 vLikeA, vLikeB;
vec3 likeNs; float likeAO = 1.0, likeSO = 1.0, likeOil = 0.0, likeThin = 0.0, likeCurvY = 0.0; vec3 likeG = vec3(0.0);
float lkH(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
vec3 lkH3(vec3 p){ return fract(sin(vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)))) * 43758.5453); }
// Worley F1 in cells of size 1: returns (distance, cell id hash) and the offset to the nearest feature point
vec2 lkCell(vec3 x, out vec3 off){ vec3 i = floor(x), f = fract(x); float d = 9.0, id = 0.0; off = vec3(0.0);
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) for (int c = -1; c <= 1; c++) { vec3 o = vec3(float(a), float(b), float(c)), q = o + 0.15 + 0.7 * lkH3(i + o) - f; float e = dot(q, q);
    if (e < d) { d = e; off = q; id = lkH(i + o + 0.37); } }
  return vec2(sqrt(d), id); }
vec3 likeLut(float mm, float hm, float oxy){
  float u = clamp(log(mm / likeAxes0.x) / log(likeAxes0.y / likeAxes0.x), 0.0, 1.0), v = clamp(log(hm / likeAxes1.x) / log(likeAxes1.y / likeAxes1.x), 0.0, 1.0);
  float n = ${LUT_AXES.n}.0; vec2 t = vec2((0.5 + u * (n - 1.0)) / (2.0 * n), (0.5 + v * (n - 1.0)) / n);
  vec3 a = texture2D(likeLUT, t).rgb, b = texture2D(likeLUT, t + vec2(0.5, 0.0)).rgb; return max(mix(a, b, clamp(oxy, 0.0, 1.0)), vec3(0.0)); }
vec3 likePI(float nl){ return pow(texture2D(likeSSS, vec2(nl * 0.5 + 0.5, likeCurvY)).rgb, vec3(2.2)); }
`;
// after hero.js's SKIN_FRAG block (sees diffuseColor, roughnessFactor, vHero, vBind, hero's uniforms and its NOISE functions)
const FRAG = /* glsl */`
if (likeOn > 0.5) {
  vec3 b = vBind; float reg = vHero.x; if (b.y > hEyeL.y - 0.15 && reg > 1.5 && reg < 10.5) reg = 11.;
  float rg = floor(reg + 0.5), ax = abs(b.x), eyeY = (hEyeL.y + hEyeR.y) * 0.5, eyeZ = (hEyeL.z + hEyeR.z) * 0.5;
  bool head = reg < 1.5 || reg > 10.5;
  float tan_ = likeK0.x, homog = likeK0.y, health = likeK0.z, weather = likeK0.w;
  float freck = likeK1.x, moles = likeK1.y, pores = likeK1.z, relief = likeK1.w;
  float lines = likeK2.x, oilK = likeK2.y, beardSh = likeK2.z, age = likeK2.w;
  float veinsK = likeK3.x, lipTone = likeK3.y, nailsK = likeK3.z, microK = likeK3.w;
  // ---- undo hero.js's flat tints (c4 mottling, cheek / ear / lip multipliers), so the biophysical regions do not stack on them
  vec3 und = (0.93 + 0.12 * fbm3(b * 60.0 + hSeed)) * mix(vec3(1.0), vec3(1.05, 0.93, 0.9), vn3(b * 30.0 + 7.0));
  float lipH = exp(-dot(vec2(b.x / 0.026, (b.y - hMouth.y) / 0.011), vec2(b.x / 0.026, (b.y - hMouth.y) / 0.011))) * step(hMouth.z - 0.03, b.z);
  if (head) { vec3 u2 = mix(vec3(1.0), vec3(0.92, 0.62, 0.58), 0.6 * lipH);
    u2 *= mix(vec3(1.0), vec3(1.03, 0.84, 0.8), 0.35 * exp(-(pow((ax - 0.04) / 0.022, 2.0) + pow((b.y - eyeY + 0.03) / 0.02, 2.0))) * step(hEyeL.z - 0.02, b.z));
    u2 *= mix(vec3(1.0), vec3(1.04, 0.85, 0.8), 0.3 * smoothstep(0.065, 0.075, ax));
    // and hero.js's painted shading round the eyes and its age stripes (their z-steps and x-steps cut hard-edged blocks into the
    // lid and brow under a raking key and at 3x); replaced below by soft ones (the cavity AO carries the brow's real occlusion)
    { float u = clamp((ax - 0.008) / 0.05, 0.0, 1.0), d = b.y - (eyeY + 0.021 + 0.007 * sin(u * 2.6) - 0.004 * u * u) + 0.006;
      float m = 1.0 - 0.12 * smoothstep(0.012, 0.0, d) * smoothstep(-0.02, 0.0, d) * step(0.008, ax) * smoothstep(0.06, 0.045, ax) * step(hEyeL.z - 0.03, b.z);
      for (int s = 0; s < 2; s++) { vec3 e = s == 0 ? hEyeL : hEyeR; vec2 dd = vec2(b.x - e.x, b.y - e.y);
        m *= 1.0 - 0.18 * exp(-(dd.x * dd.x / 0.0004 + dd.y * dd.y / 0.00025)) * step(e.z - 0.03, b.z);
        m *= 1.0 - 0.25 * smoothstep(0.003, 0.0, abs(dd.y - 0.012 - 0.12 * dd.x * dd.x / 0.0004 * 0.01)) * step(abs(dd.x), 0.016) * step(e.z - 0.02, b.z); }
      m *= 1.0 - hAge * 0.12 * smoothstep(0.75, 0.95, sin(b.y * 520.0 + vn3(b * 40.0) * 5.0 + ax * 60.0) * 0.5 + 0.5) * smoothstep(0.3, 0.6, vn3(b * 25.0)) * smoothstep(eyeY + 0.03, eyeY + 0.045, b.y) * smoothstep(eyeY + 0.085, eyeY + 0.07, b.y) * step(hEyeL.z - 0.01, b.z);
      u2 *= m; }
    if (reg > 0.5 && reg < 1.5) u2 = mix(vec3(1.0), u2, smoothstep(hChin.y - 0.08, hChin.y - 0.02, b.y));
    und *= u2; }
  vec3 detail = diffuseColor.rgb / max(und * likeBase, vec3(1e-4));   // what SKIN_FRAG painted besides the tints: brows, stubble, sockets, lines, creases, dirt, sweat
  // ---- regional melanin (x), blood (x), oxygenation drop
  float sunT = (1.0 + tan_ * vLikeA.w) / (1.0 + tan_);                   // the person's preset is their FACE; covered skin is lighter
  float mm = vLikeB.x * sunT, hm = vLikeB.y * (1.0 + 0.25 * health), oxy = clamp(-0.4 * health, 0.0, 1.0) * 0.5;
  // blotchiness (low homogeneity): slow melanin and blood variation (Fink et al. 2006: evenness, not pores)
  float bl1 = fbm3(b * 22.0 + hSeed * 1.7) - 0.5, bl2 = fbm3(b * 55.0 + 3.1 + hSeed) - 0.5;
  float bl3 = vn3(b * 380.0 + hSeed) - 0.5, bl4 = vn3(b * 260.0 + 17.0 + hSeed) - 0.5;      // and at 2-4 mm: pigment and capillary grain
  mm *= 1.0 + (1.0 - homog) * (0.5 * bl1 + 0.25 * bl2 + 0.22 * bl3); hm *= 1.0 + (1.0 - homog) * (0.9 * bl2 + 0.45 * bl4);
  float lip = 0.0, nailM = 0.0, beard = 0.0, socketK = 1.0;
  if (head) {
    float dyE = b.y - eyeY, front = smoothstep(eyeZ - 0.05, eyeZ - 0.015, b.z);
    // periorbital: darker and cooler (thin skin over the orbicularis and its venous plexus; pigment), most under the eye and at the inner corner
    for (int s = 0; s < 2; s++) { vec3 e = s == 0 ? hEyeL : hEyeR; vec2 d = vec2((b.x - e.x) * (0.8 + 0.4 * step(0.0, (b.x - e.x) * sign(e.x))), b.y - e.y);
      float zf = smoothstep(e.z - 0.04, e.z - 0.018, b.z);
      float po = exp(-(d.x * d.x / 0.00042 + d.y * d.y / 0.00022)) * zf * (0.7 + 0.5 * smoothstep(0.004, -0.012, d.y));
      mm *= 1.0 + 0.32 * po; hm *= 1.0 + 0.25 * po; oxy = max(oxy, 0.7 * po);
      // the supratarsal (lid) crease and the socket's hollow, soft-ended (hero.js's own were cut by steps; undone above)
      vec2 dc = vec2(b.x - e.x, b.y - e.y); float cr = smoothstep(0.0028, 0.0, abs(dc.y - 0.0115 - 0.003 * dc.x * dc.x / 0.0002)) * smoothstep(0.019, 0.011, abs(dc.x)) * smoothstep(e.z - 0.03, e.z - 0.016, b.z);
      socketK *= (1.0 - 0.16 * cr) * (1.0 - 0.1 * exp(-(dc.x * dc.x / 0.0004 + dc.y * dc.y / 0.00025)) * zf); }
    // lips: the vermilion (cupid's bow above, fuller below); blood x3 under a thin corneum, melanin at the border on deeper skin
    { float x = b.x / 0.025, yu = (b.y - hMouth.y), top = 0.0085 * (1.0 - 0.55 * x * x) - 0.0016 * exp(-x * x * 30.0), bot = -0.0105 * (1.0 - 0.6 * x * x);
      float inL = smoothstep(1.05, 0.92, abs(x)) * smoothstep(top + 0.0011, top - 0.0006, yu) * smoothstep(bot - 0.0011, bot + 0.0006, yu) * step(hMouth.z - 0.02, b.z);
      float edge = 1.0 - smoothstep(0.25, 0.85, min(abs(yu - top), abs(yu - bot)) / 0.004);
      lip = inL; mm *= mix(1.0, mix(0.75, 1.0 + 0.6 * lipTone, edge * 0.8 + 0.2), lip); hm *= mix(1.0, 3.2, lip); }
    // beard shadow (men; set per person): shaved follicles under the skin, a grey-blue cast where a beard grows, not on the lips
    { float j = smoothstep(eyeY - 0.045, eyeY - 0.07, b.y) * (1.0 - lip) * step(-0.04, b.z - hChin.z + 0.08);
      j *= 1.0 - smoothstep(0.07, 0.085, ax) * smoothstep(eyeY - 0.06, eyeY - 0.03, b.y); j *= smoothstep(hChin.y - 0.07, hChin.y - 0.01, b.y);
      beard = j * beardSh; }
    // freckles: pheomelanin-rich spots on sun-exposed skin of the face (nose, cheeks), a few millimetres
    if (freck > 0.0) { vec3 o; vec2 c = lkCell(b / 0.0035, o); float fr = step(c.y, freck * 0.3 * smoothstep(0.3, 1.0, vLikeA.w)) * smoothstep(0.18 + 0.2 * fract(c.y * 37.0), 0.05, c.x) * front * (0.4 + 0.6 * fract(c.y * 91.0));
      fr *= 0.4 + 0.6 * exp(-pow((ax - 0.03) / 0.03, 2.0) - pow(dyE + 0.025, 2.0) / 0.0009); mm *= 1.0 + 0.8 * fr; }
  }
  // moles (sparse, everywhere), solar lentigines (weathering, sun-exposed), veins (backs of the hands, the inner wrist, temples)
  { vec3 o; vec2 c = lkCell(b / 0.06, o); float ml = step(c.y, 0.04 * moles) * smoothstep(0.022 + 0.014 * fract(c.y * 53.0), 0.008, c.x); mm *= 1.0 + 1.3 * ml; }   // moles: 1-4 mm, sparse
  if (weather > 0.0) { vec3 o; vec2 c = lkCell(b / 0.014 + 5.0, o); float le = step(c.y, 0.14 * weather * vLikeA.w * likeLight) * smoothstep(0.24, 0.08, c.x + 0.06 * (vn3(b * 900.0) - 0.5)) * (0.5 + 0.5 * fract(c.y * 71.0)); mm *= 1.0 + 0.5 * le; }   // solar lentigines: 2-6 mm, a few, mostly after 50
  if (veinsK > 0.0) { float vz = 0.0;
    if (rg == 5.0 || rg == 4.0) vz = (rg == 5.0 ? vHero.w : smoothstep(1.6, 1.95, vHero.y) * (1.0 - vHero.w * 0.5) + smoothstep(1.85, 2.0, vHero.y) * 0.5) * (rg == 4.0 ? 1.0 : 0.8);
    if (head) vz = smoothstep(0.055, 0.068, ax) * smoothstep(eyeY - 0.005, eyeY + 0.02, b.y) * smoothstep(eyeY + 0.07, eyeY + 0.04, b.y);
    float vn = 1.0 - abs(2.0 * fbm3(b * vec3(70.0, 22.0, 70.0) + 11.0) - 1.0); float vm = smoothstep(0.9, 0.97, vn) * vz * veinsK;
    hm *= 1.0 + 0.9 * vm; oxy = max(oxy, vm); mm *= 1.0 - 0.08 * vm; }
  vec3 alb = likeLut(max(mm, 0.02), max(hm, 0.05), oxy);
  alb *= mix(vec3(1.0), vec3(0.8, 0.83, 0.9), clamp(beard * (0.55 + 0.45 * smoothstep(0.3, 0.7, vn3(b * 900.0))), 0.0, 1.0) * 0.5);
  diffuseColor.rgb = alb * detail * socketK;
  // ---- nails (hero.js's mask): the bed's blood through a translucent plate, a paler free edge, a lunula; from this person's skin
  if (rg == 6.0) { float dors = vHero.w, fl = vHero.y - 3.0, ph = floor(fl), a = fract(fl);
    nailM = step(1.5, ph) * smoothstep(0.42, 0.52, a) * smoothstep(0.35, 0.6, dors);
    if (nailM > 0.0 && nailsK > 0.0) { vec3 bed = likeLut(0.18, 2.6, 0.15) * 1.1, edge = mix(bed, vec3(0.72, 0.66, 0.58), 0.75);
      vec3 nc = mix(bed, edge, smoothstep(0.86, 0.95, a)); nc = mix(nc, mix(bed, vec3(0.75, 0.68, 0.62), 0.45), smoothstep(0.58, 0.52, a) * 0.6);
      nc *= 0.92 + 0.12 * vn3(vec3(b.x * 3000.0, b.y * 300.0, b.z * 3000.0));             // fine longitudinal ridges
      vec3 under = diffuseColor.rgb; diffuseColor.rgb = mix(under, nc * (1.0 - 0.75 * smoothstep(0.9, 0.97, a) * hDirt), nailM * nailsK * 0.95); } }
  // ---- roughness: base lobe by region; hero.js's sweat (a film) and the lips' moisture kept; the oily lobe's weight
  float sweat = clamp((0.6 - roughnessFactor) / 0.4, 0.0, 1.0) * step(0.001, hSweat);
  float rBase = 0.55 + 0.08 * (vLikeB.x - 1.0) + 0.05 * vLikeB.w - 0.12 * lip;
  likeOil = clamp(oilK * (0.2 + 0.8 * vLikeB.z) * 0.6 * (1.0 + 0.8 * lip) + 0.3 * sweat, 0.0, 1.0) * (1.0 - nailM) + 0.85 * nailM;   // the sharp lobe is a minority of skin's specular (~15-30 %)
  float rough = mix(rBase, roughnessFactor, sweat);
  // ---- microstructure: height h (bind metres) and its gradient likeG; fade each feature by its pixel footprint, lost slope -> roughness
  float fw = max(length(dFdx(b)), length(dFdy(b))) * microK, var = 0.0, pitOcc = 0.0, poreDark = 0.0;
  { float faceK = head ? 1.0 : 0.0, noseK = head ? exp(-pow(b.x / 0.02, 2.0) - pow((b.y - likeNose.y) / 0.022, 2.0)) : 0.0;
    float cheekK = head ? exp(-pow((ax - 0.04) / 0.025, 2.0) - pow((b.y - eyeY + 0.035) / 0.025, 2.0)) : 0.0;
    float cs = mix(0.0019, mix(0.00125, 0.00095, max(noseK, cheekK * 0.7)), faceK) * (1.0 + 0.25 * vLikeB.w);           // pore spacing (m)
    float dp = pores * mix(0.000012, mix(0.000022, 0.00004, max(noseK, cheekK)), faceK) * (1.0 - lip) * (1.0 - nailM) * (1.0 - 0.6 * vLikeB.w);   // depth
    float rp = cs * mix(0.2, 0.3, noseK);
    vec3 o; vec2 c = lkCell(b / cs, o); float d = c.x * cs, sz = c.y * 0.6 + 0.7;
    float fade = smoothstep(0.6 * fw, 1.6 * fw, rp * sz);                                   // resolved from ~1 px (the K sub-frames supersample it)
    float pr = rp * sz, t = clamp(1.0 - d / pr, 0.0, 1.0), hp = -dp * t * t;
    vec3 gp = d > 1e-7 ? (dp * 2.0 * t / pr) * (-o * cs / d) : vec3(0.0);                     // d/dp of -dp (1 - d/pr)^2 ; o points from p to the feature
    likeG += gp * fade; var += (1.0 - fade) * 0.35 * pow(dp / pr, 2.0); pitOcc += t * t * fade;
    poreDark = t * t * smoothstep(0.3 * fw, 1.0 * fw, pr) * clamp(dp / 0.00003, 0.0, 1.5);           // the pit's shadowed interior, visible before it resolves
    // relief: three families of furrows, warped; sharp valleys between soft plateaus (~0.35 mm)
    float lr = mix(0.00045, 0.0003, faceK) * (1.0 + 0.3 * weather), ar = relief * mix(0.0000045, 0.0000035, faceK) * (1.0 + 0.8 * weather + 0.6 * age) * (1.0 - lip * 0.5) * (1.0 - nailM);
    float fr = smoothstep(1.5 * fw, 4.0 * fw, lr);
    vec3 D0 = normalize(vec3(0.8, 0.5, 0.33)), D1 = normalize(vec3(-0.6, 0.7, 0.4)), D2 = normalize(vec3(0.1, -0.45, 0.89));
    vec3 wp = b + (vec3(vn3(b * 1800.0), vn3(b * 1800.0 + 4.0), vn3(b * 1800.0 + 9.0)) - 0.5) * lr * 0.9;
    for (int k = 0; k < 3; k++) { vec3 Dk = k == 0 ? D0 : k == 1 ? D1 : D2; float ph = dot(wp, Dk) * 6.2832 / lr, s = sin(ph), cs2 = cos(ph);
      float v = 1.0 - abs(s); // valley where s = 0
      likeG += fr * 4.0 * ar * v * v * v * sign(s) * cs2 * Dk * 6.2832 / lr; }                // h = -ar (1 - |sin|)^4
    var += (1.0 - fr) * 3.0 * 0.3 * pow(ar * 6.2832 / lr, 2.0);
    // lines by age: forehead, glabella, crow's feet, under the eye, the lip fissures (all ages), neck rings, knuckle creases
    float L = lines * (0.15 + 0.85 * age);
    if (head) { float dyE = b.y - eyeY, front = smoothstep(eyeZ - 0.04, eyeZ - 0.01, b.z), w0 = 0.00045, wf = smoothstep(1.2 * fw, 3.0 * fw, w0);
      // forehead: 3-5 horizontal furrows ~7 mm apart, wavering, fading toward the temples
      { float y = dyE - 0.035 + 0.002 * sin(b.x * 90.0 + hSeed) + 0.0015 * (vn3(b * 60.0) - 0.5), sp = 0.0068, q = y / sp - floor(y / sp + 0.5);
        float m = smoothstep(0.0, 0.006, dyE - 0.03) * smoothstep(0.075, 0.06, dyE) * exp(-pow(b.x / 0.05, 2.0)) * front * smoothstep(0.25, 0.65, vn3(vec3(b.x * 40.0, floor(y / sp + 0.5), hSeed)));
        float pd = q * sp, dep = 0.00006 * L * m; likeG.y += wf * dep * 2.0 * pd / (w0 * w0) * exp(-pd * pd / (w0 * w0)); var += (1.0 - wf) * pow(dep / w0, 2.0) * 0.4; }
      // glabella: two short vertical lines between the brows
      { float x = ax - 0.006, m = exp(-pow((dyE - 0.022) / 0.009, 2.0)) * front, dep = 0.00007 * L * m; likeG.x += sign(b.x) * wf * dep * 2.0 * x / (w0 * w0) * exp(-x * x / (w0 * w0)); }
      // crow's feet: a fan of lines from the outer corner of each eye; under the eye: two soft arcs
      for (int s = 0; s < 2; s++) { vec3 e = s == 0 ? hEyeL : hEyeR; vec2 d = vec2((b.x - e.x) * sign(e.x), b.y - e.y);
        float rr = length(d - vec2(0.012, 0.0)), an = atan(d.y, d.x - 0.012), m = smoothstep(0.003, 0.007, rr) * smoothstep(0.02, 0.011, rr) * smoothstep(0.75, 0.45, abs(an + 0.12)) * front;
        float q = an / 0.2 - floor(an / 0.2 + 0.5), pd = q * 0.2 * rr, dep = 0.000035 * L * m;
        vec2 tg = vec2(-sin(an), cos(an)); vec2 gg = tg * (dep * 2.0 * pd / (w0 * w0) * exp(-pd * pd / (w0 * w0)));
        likeG.xy += wf * vec2(gg.x * sign(e.x), gg.y);
        float yu = d.y + 0.0105 + 0.06 * d.x * d.x / 0.0002 * 0.01, mu = exp(-d.x * d.x / 0.00022) * smoothstep(-0.02, -0.012, d.y) * front, du = 0.00005 * L * mu;
        likeG.y += wf * du * 2.0 * yu / (w0 * w0) * exp(-yu * yu / (w0 * w0)); }
      // lip fissures: fine vertical grooves across the vermilion (~1 mm apart), every age
      { float sp = 0.0011, x = b.x + 0.0003 * sin(b.y * 900.0), q = x / sp - floor(x / sp + 0.5), pd = q * sp, w1 = 0.00018, dep = 0.00003 * lip * (0.6 + 0.6 * age);
        float wl = smoothstep(1.2 * fw, 3.0 * fw, w1); likeG.x += wl * dep * 2.0 * pd / (w1 * w1) * exp(-pd * pd / (w1 * w1)); var += (1.0 - wl) * pow(dep / w1, 2.0) * 0.4 * lip; }
    }
    if (rg == 1.0 || (head && b.y < hChin.y - 0.02)) { float y = b.y + 0.002 * sin(b.x * 40.0), sp = 0.017, q = y / sp - floor(y / sp + 0.5), pd = q * sp, w1 = 0.0012, dep = 0.00006 * L;
      float wn = smoothstep(1.2 * fw, 3.0 * fw, w1); likeG.y += wn * dep * 2.0 * pd / (w1 * w1) * exp(-pd * pd / (w1 * w1)); }
    if (rg == 6.0) { float a = fract(vHero.y - 3.0), dd = min(a, 1.0 - a), m = vHero.w * (1.0 - nailM);        // knuckle skin: folded, drier
      var += m * 0.002 * (0.4 + age) * smoothstep(0.15, 0.0, dd); rough += 0.06 * m * smoothstep(0.12, 0.0, dd); }
  }
  diffuseColor.rgb *= 1.0 - 0.22 * clamp(poreDark, 0.0, 1.0);
  // Toksvig / LEAN: the slope variance the fade removed widens the lobe (alpha^2 += 2 var)
  float al2 = rough * rough; al2 = sqrt(al2 * al2 + 2.0 * var); roughnessFactor = clamp(sqrt(al2), 0.08, 1.0);
  likeAO = vLikeA.y; likeSO = 1.0 - 0.6 * clamp(max(pitOcc, poreDark), 0.0, 1.0);
  if (likeDbg > 0.5 && likeDbg < 1.5) diffuseColor.rgb = vec3(clamp(length(likeG) * 2.0, 0.0, 1.0));
  likeThin = vLikeA.z; likeCurvY = clamp(likeSSSk * 2.0 * vLikeA.x / likeScale / 1000.0, 0.004, 0.996);   // flesh.js's axis: y = 2 mm / r
}`;
const NORMAL = /* glsl */`
likeNs = normal;
if (likeOn > 0.5) { vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition), dbx = dFdx(vBind), dby = dFdy(vBind);
  vec2 dH = vec2(dot(likeG, dbx), dot(likeG, dby)) * likeScale;
  vec3 R1 = cross(dpy, normal), R2 = cross(normal, dpx); float det = dot(dpx, R1) * faceDirection;
  vec3 gr = sign(det) * (dH.x * R1 + dH.y * R2); vec3 np = normalize(abs(det) * normal - gr);
  if (!any(isnan(np))) normal = np;
  if (likeDbg > 1.5) diffuseColor.rgb = (likeDbg > 2.5 ? (normal - likeNs) * 4.0 : normal) * 0.5 + 0.5; }`;
// direct diffuse: pre-integrated scattering on curvature, per-channel softened normals (replaces hero.js's c7 wrap on this material)
const DIFFUSE = /* glsl */`{ vec3 Ld = directLight.direction; vec3 nS = likeOn > 0.5 ? likeNs : geometryNormal;
    vec3 dPI = vec3(likePI(dot(normalize(mix(nS, geometryNormal, 0.15)), Ld)).r, likePI(dot(normalize(mix(nS, geometryNormal, 0.45)), Ld)).g, likePI(dot(normalize(mix(nS, geometryNormal, 0.7)), Ld)).b);
    reflectedLight.directDiffuse += dPI * directLight.color * BRDF_Lambert( material.diffuseColor ); }`;
const AO = /* glsl */`
if (likeOn > 0.5) { float ndv = saturate(dot(geometryNormal, geometryViewDir)), a = mix(1.0, likeAO, 0.75);
  float so = saturate(pow(ndv + a, exp2(-16.0 * material.roughness - 1.0)) - 1.0 + a) * likeSO;     // Lagarde and de Rousiers 2014
  reflectedLight.indirectDiffuse *= mix(1.0, likeAO, 0.6); reflectedLight.indirectSpecular *= so; reflectedLight.directSpecular *= mix(1.0, likeSO, 0.6);
  #ifdef USE_CLEARCOAT
  clearcoatSpecularIndirect *= so; clearcoatSpecularDirect *= mix(1.0, likeSO, 0.4);
  #endif
}`;
const TRANS = /* glsl */`
#if NUM_DIR_LIGHTS > 0
if (likeOn > 0.5 && likeThin > 0.01) { vec3 V = geometryViewDir;
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) { vec3 L = directionalLights[i].direction;
    float t = pow(saturate(dot(V, -normalize(L + likeNs * 0.35))), 3.0) * smoothstep(0.1, -0.3, dot(likeNs, L));
    reflectedLight.directDiffuse += directionalLights[i].color * t * likeThin * likeTrans * 0.45 * pow(material.diffuseColor, vec3(1.1)) * vec3(1.25, 0.8, 0.65); } }   // unshadowed: kept to thin parts that stand clear of the head (ears, fingers)
#endif`;
const WRAP_RE = /\{ float nlW = dot\( geometryNormal, directLight\.direction \); vec3 wW = hSkinWrap;[\s\S]*?BRDF_Lambert\( material\.diffuseColor \); \}/;
const DL = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';

// ---------------------------------------------------------------- SKIN4 (round 4): the rev-4 shader, derived from lane B's text (rev < 4 is untouched)
// 1. the measured face zones and the body's (zones4.js) arrive in aLikeB (melanin x, blood x, oil) and a new aLikeC (the deoxygenated share,
//    a roughness offset, a pore scale); lane B's own periorbital melanin and blood go (the zones carry them), its oxygen drop stays;
// 2. MOTTLING at the measured amplitude: the scans' cheeks and forehead vary by SD 0.08-0.10 in log melanin and 0.13-0.17 in log blood
//    in the 2-6 mm and 6-15 mm bands (lane B's was ~0.04 / 0.06: the "one colour" read); 0.7 of it is used (scan noise), less on deep skin;
// 3. the lips' blood 3.8 (measured 3.6-6 against the neutral; lane B 3.2); the AREOLAE (crisp, from lane A's nipple landmarks);
// 4. SPECULAR by region: the base lobe's roughness from the zones (T-zone and nose shinier, cheeks drier, knees, elbows, shins rough),
//    the oily lobe from the zones' sebum map; PORES larger and deeper where the zones say (nose, cheeks, forehead), resolved from ~0.35 px
//    and occluding the specular more (the stippled highlight a photograph shows at 1:1), darkening the diffuse less;
// 5. LESS WAX: the diffuse's green and blue take part of the micro-relief normal (red stays smoothest: the per-channel normals of
//    Jimenez et al.'s separable SSS), and the scatter itself is shorter (sss 1.0, was 1.6).
const R4 = (src, pairs, what) => { let t = src; for (const [a, b] of pairs) { if (!t.includes(a)) { console.warn('likeness/skin rev 4: anchor not found in ' + what + ': ' + a.slice(0, 60)); continue; } t = t.replace(a, b); } return t; };
const PARS4 = PARS + '\nuniform vec4 likeMot, likeR4, likeAreo0, likeAreo1, likeFine; uniform vec2 likeAreoK; varying vec4 vLikeC; vec3 likeNm;\n';
const FRAG4 = R4(FRAG, [
  ['  mm *= 1.0 + (1.0 - homog) * (0.5 * bl1 + 0.25 * bl2 + 0.22 * bl3); hm *= 1.0 + (1.0 - homog) * (0.9 * bl2 + 0.45 * bl4);',
   `  { float m4a = (vn3(b * 250.0 + hSeed * 3.0) - 0.5) / 0.184, m10 = (vn3(b * 100.0 + 5.0 + hSeed) - 0.5) / 0.184, h4a = (vn3(b * 230.0 + 31.0 + hSeed) - 0.5) / 0.184, h10 = (vn3(b * 90.0 + 47.0 + hSeed) - 0.5) / 0.184;
    float bk = head ? 1.0 : likeFine.z, gk = head ? 1.0 : likeFine.w;   // the body: more even than the face (the measurement is the face's)
    mm *= (1.0 + (1.0 - homog) * 0.5 * bl1) * exp(bk * (likeMot.x * m4a + likeMot.y * m10)); hm *= (1.0 + (1.0 - homog) * 0.5 * bl2) * exp(bk * (likeMot.z * h4a + likeMot.w * h10));
    // the fine grain under 2 mm (pigment and capillary speckle, the pores' rims): SCAN c1's detail maps measured SD 0.085-0.19 of the
    // colour over its own 2 mm blur on the ten scans; faded by its size in pixels (no shimmer at distance)
    float fwb = max(length(dFdx(b)), length(dFdy(b))), a1 = smoothstep(0.7 * fwb, 1.8 * fwb, 0.0010), a2 = smoothstep(0.7 * fwb, 1.8 * fwb, 0.00055);
    float f1 = (vn3(b * 1000.0 + 13.0 + hSeed) - 0.5) / 0.184, f2 = (vn3(b * 1800.0 + 71.0 + hSeed) - 0.5) / 0.184, f3 = (vn3(b * 1250.0 + 29.0 + hSeed) - 0.5) / 0.184;
    mm *= exp(gk * likeFine.x * (a1 * f1 + 0.6 * a2 * f2)); hm *= exp(gk * likeFine.y * a1 * f3); }
  oxy = max(oxy, vLikeC.x);`],
  ['      mm *= 1.0 + 0.32 * po; hm *= 1.0 + 0.25 * po; oxy = max(oxy, 0.7 * po);', '      oxy = max(oxy, 0.35 * po);'],
  ['hm *= mix(1.0, 3.2, lip); }', 'hm *= mix(1.0, likeR4.x, lip); }'],
  ['  vec3 alb = likeLut(max(mm, 0.02), max(hm, 0.05), oxy);',
   `  if (likeAreo0.w > 0.0 && rg == ${R.torso}.0) { for (int s = 0; s < 2; s++) { vec4 A = s == 0 ? likeAreo0 : likeAreo1; float d = length(b - A.xyz) + A.w * 0.08 * (vn3(b * 420.0 + float(s)) - 0.5);
      float k = smoothstep(A.w, A.w * 0.82, d), kn = smoothstep(A.w * 0.3, A.w * 0.2, d);
      mm *= mix(1.0, likeAreoK.x, k) * (1.0 + 0.15 * kn); hm *= mix(1.0, likeAreoK.y, k); } }
  vec3 alb = likeLut(max(mm, 0.02), max(hm, 0.05), oxy);`],
  ['  float rBase = 0.55 + 0.08 * (vLikeB.x - 1.0) + 0.05 * vLikeB.w - 0.12 * lip;', '  float rBase = 0.5 + vLikeC.y + 0.04 * (vLikeB.x - 1.0) + 0.05 * vLikeB.w - 0.12 * lip;'],
  ['* (1.0 - lip) * (1.0 - nailM) * (1.0 - 0.6 * vLikeB.w);   // depth', '* (1.0 - lip) * (1.0 - nailM) * (1.0 - 0.6 * vLikeB.w) * likeR4.z * vLikeC.z;   // depth'],
  ['    float rp = cs * mix(0.2, 0.3, noseK);', '    float rp = cs * mix(0.2, 0.3, noseK) * likeR4.y;'],
  ['    float fade = smoothstep(0.6 * fw, 1.6 * fw, rp * sz);', '    float fade = smoothstep(0.35 * fw, 1.1 * fw, rp * sz);'],
  ['  diffuseColor.rgb *= 1.0 - 0.22 * clamp(poreDark, 0.0, 1.0);', '  diffuseColor.rgb *= 1.0 - 0.12 * clamp(poreDark, 0.0, 1.0);'],
  ['likeSO = 1.0 - 0.6 * clamp(max(pitOcc, poreDark), 0.0, 1.0);', 'likeSO = 1.0 - 0.8 * clamp(max(pitOcc, poreDark), 0.0, 1.0);'],
], 'FRAG');
const NORMAL4 = NORMAL + '\nlikeNm = normal;';
const DIFFUSE4 = R4(DIFFUSE, [['vec3 dPI = vec3(likePI(dot(normalize(mix(nS, geometryNormal, 0.15)), Ld)).r, likePI(dot(normalize(mix(nS, geometryNormal, 0.45)), Ld)).g, likePI(dot(normalize(mix(nS, geometryNormal, 0.7)), Ld)).b);',
  'vec3 nM = likeOn > 0.5 ? likeNm : geometryNormal; vec3 dPI = vec3(likePI(dot(normalize(mix(nS, geometryNormal, 0.15)), Ld)).r, likePI(dot(normalize(mix(nM, nS, 1.0 - 0.45 * likeR4.w)), Ld)).g, likePI(dot(normalize(mix(nM, nS, 1.0 - 0.75 * likeR4.w)), Ld)).b);']], 'DIFFUSE');
// the person's draw for rev 4: a little hue variety (blood, carotene, the melanin type: lane B's presets all shared NIST's medians)
function person4(p, seed, betaMax = 0.7) { let s = (seed * 2654435761) >>> 0 || 1; const r = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const g = () => { const u = Math.max(1e-9, r()), v = r(); return clamp(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v), -2, 2); };
  return { ...p, Ch: p.Ch * Math.exp(0.1 * g()), Cc: p.Cc * Math.exp(0.12 * g()), beta: clamp(p.beta + 0.02 * g(), 0.3, betaMax) }; }
// the measured mottling (zones_measured.json medians, 2-6 mm and 6-15 mm: log melanin, log blood), women / men
const MOT4 = { f: [0.1016, 0.0992, 0.1346, 0.1683], m: [0.0789, 0.0846, 0.1316, 0.1447] };

// ---------------------------------------------------------------- SKIN6 (round 6): the rev-6 shader, derived from rev 4's text (rev < 6 is untouched)
// 1. SUBSURFACE: with lib/fx/likeness/sss_pass.js installed on the renderer (installSkinSSS), the direct diffuse is plain Lambert on the
//    micro normal and the pass scatters the skin's diffuse in screen space (Jimenez et al. 2015's separable SSS with d'Eon and Luebke's
//    six-Gaussian skin profile); the pre-integrated LUT and the per-channel normals stay as the fallback when no pass runs (likeSSSOn 0).
//    The pass reads the skin's diffuse as (main pass) - (a pass with the skin's diffuse off: likeSSSMode 1, alpha = not-skin) and the
//    albedo from a body-only pass (likeSSSMode 2), so the blur sees irradiance x sqrt(albedo) (pre- and post-scatter texturing).
//    TRANSMISSION through thin parts from the key's shadow map as the thickness map (Jimenez et al. 2010): the distance light travels
//    inside the body from where it entered (the shadow map's depth) to the shaded point, through the same profile; a part the head
//    shades is thick along the light, so it does not glow (lane B's unshadowed term needed its ears-only mask for that).
// 2. SPECULAR: the oily lobe (the clearcoat) follows the micro normal (pores, relief: in rev 4 it saw the smooth surface, so the sharp
//    highlight slid over the form), its roughness by the sebum map (T-zone sharper) with the faded slope variance added (LEAN); a
//    mesoscale relief (1.5-2.5 mm domes between creases, deepest on the nose and cheeks) that breaks a highlight into patches at 1:1;
//    the base lobe's roughness from SKIN4's zones; vellus sheen at grazing (three's Charlie sheen, faint); the open pores' dark
//    dots kept through the scattering (poreDark) and SKIN4's sub-2 mm colour grain at 0.75 (it read as grain where pores belong).
// 3. COLOUR: skin_lut.js skinFromHex6 (the cast's hex fitted in a* and b* too, inside NIST's envelope at that lightness).
// rev-6 defaults over lane B's and rev 4's: baseRough (the base lobe's roughness before SKIN4's zone offset; rev 4 0.5), meso (x the mesoscale
// relief), poreDark (the open pores' darkening; rev 4 0.12 read as no pores at 1:1; with the pass it is applied after the scattering,
// so the dots stay sharp), grain (x SKIN4's sub-2 mm colour grain; 0.75: judge c10 read it as grain where pores belong), ccFollow (how far the oily lobe follows the micro normal), ccRoughT /
// ccRough (the oily lobe's roughness on sebum-rich / dry skin; rev 4 0.3 everywhere), ccVar (x the faded slope variance into that lobe),
// sheen / sheenRough (vellus sheen), transE (the transmission's wrap: Jimenez's 0.3), fit6 (false: lane B's lightness-only hex fit)
export const SKIN6_DEFAULTS = { trans: 1.0, baseRough: 0.5, meso: 1, poreDark: 0.25, grain: 0.75, ccFollow: 0.9, ccRoughT: 0.22, ccRough: 0.32, ccVar: 1, sheen: 0.04, sheenRough: 0.45, transE: 0.2 };
export const SSS6 = { likeSSSMode: { value: 0 }, likeSSSOn: { value: 0 }, likeKeyMat: { value: new THREE.Matrix4() }, likeKey: { value: new THREE.Vector4(0, 0.001, 0.25, 0.5) } };
// ---------------------------------------------------------------- SKIN7 (round 7) = SKIN OPTICS: rev 6's shader with the colour from ONE layered model
// (`skin: { rev: 7 }`; rev 1, 4 and 6 are untouched). SKIN7's photographic grade (iterations 1-6: the base rotated toward the photographs' chromaticity,
// the blood axis made a chroma axis, a solved cheek flush and a solved lip tint, the deep-end lightness lift) was superseded by SKIN OPTICS iteration 1
// (8 Oct; landed ~21:00, the orchestrator's read of its A/B 1008-172053 against 1008-172110: 'A is better than B on deep skin. Land it') and deleted
// (git history keeps it). What rev 7 is now (optics.js has the model and its sources):
//  - COLOUR: the cast hex inverted to pigments (optics.js pigmentsFromHex: the melanin TYPE from chemistry, Del Bino et al. 2015, the carotene at the
//    population's, the hex inverted for melanin amount, blood and oxygenation; SKIN OPTICS iteration 2 `chem`, landed 8 Oct ~22:10 on its critic's read of the
//    albedo: the switch is gone), the melanin re-solved so the FACE (blood x FACE_BLOOD)
//    holds the cast's lightness (fitFace), the person's table = the two-layer model at the face's blood, the covered body at the arm's (BODY_BLOOD /
//    FACE_BLOOD through the zones' body slot), SKIN4's scan-measured face zones and the mottle as melanin / blood / deoxygenation multipliers INTO that
//    table (per texel, in the tissue's order: the epidermis's melanin filters the dermis's blood). No grade, no flush or lip tint solved toward a hue.
//  - THE RADIUS (Cycles): person.optics.ld, the layered model's diffuse mean free path per channel (blender/person_scene.py skin_material).
//  - THE MOTTLE at the amplitude SKIN4 measured on the scans (mottle 1; it was the photographic grade's x1.8 until chem landed).
//  - SPECULAR, grain and the lip's gloss: SKIN7 c2's values (the numbers below are the effective options of the landed A/B, aim 'it4' with
//    mottleLaw 'lstar' and grainMelExp 0, folded in so that landing changed nothing it rendered).
//  - `surf` (default true since 15 Oct; SKIN OPTICS iteration 3, landed): THE SURFACE COUNTED ONCE. (1) the skin's own sub-millimetre relief is
//    drawn as normals only where the renderer's footprint holds it (microFade >= 1: one sample per texel in the Cycles bake, lab_bake.js; DETAIL7 i9's diagnosis:
//    at FACE c2's microFade 0.33 the bake point-sampled the furrows into a white noise of normals, p50 9 deg / p99 36 deg of random tilt per face texel, the
//    'frost' and 'chalk' on the deep skins and the 'dirt' specks on the bare torsos); what it cannot hold goes into the lobes' roughness (Toksvig, as the
//    engine always did); (2) ONE network on the face: DETAIL7's fine tier carries the head's pores, furrows, age lines and lip pleats, this shader's drop out
//    there (FRAG7, likeSurf7.x); (3) the sebum film's amount from physiology: the zones' sebum map (Pierard-Franchimont) x the person's gland activity by age
//    and sex (sebumActivity: Pochi, Strauss and Downing 1979), with no deep-skin gain (oilDeep was a grade-era knob: the sheen shows on a dark skin because its
//    diffuse is dark, the physics does that).
// Every value is a uniform or a table, so no new attribute or varying: the v5/v6 body keeps its 16 attributes.
//  mottleLaw 'lstar': the melanin mottle by the LIGHTNESS it makes (mottleRef = |dL*/dln melanin| of a mid skin's table, 9.5; a deep skin's moves 23-26 L* per ln unit), grainMelExp = the exponent
//  of that factor on the fine melanin grain (0: exempt), zoneBloodCap = [knee, cap] of a soft limit on the face's per-vertex blood (null: off), lipWetDeep / lipRoughDeep = the deep lip's moist band
//  x(1 - k deep) and its coat roughness + k deep, cycSpecDeep = the Cycles base lobe's Specular IOR Level x(1 - k deep), cycNmGraze = the Cycles normal map's strength falls by k x deep toward grazing,
//  fine7Defer = DETAIL7's fine tier carries the pores; lipMottle 1 = the vermilion takes no pore-scale mottle, lipStreak = a vertical streak in its blood (the fissures' direction);
//  cycCoatK / cycSpecK / cycNmK: the Cycles skin's own gains (blender/person_scene.py skin_material reads them from person.rev7; 1 = as built).
export const SKIN7_DEFAULTS = { baseSpec: 1.0, oil: 0.9, oilDeep: 0.5, ccRoughT: 0.2, ccRough: 0.28, mottle: 1, grain: 0.62, poreDark: 0.35, meso: 1.3,
  lipMottle: 1, lipStreak: 0.08, lipEdgeFade: 0.35, lipDry: 0.12, lipWet: 0.30, lipRoughDry: 0.40, lipRoughWet: 0.30, lipBaseRough: 0.10, homogMot: 0,
  mottleLaw: 'lstar', mottleRef: 9.5, mottleExp: 1.2, grainMelExp: 0, zoneBloodCap: null, lipWetDeep: 0, lipRoughDeep: 0, cycSpecDeep: 0, cycNmGraze: 0, fine7Defer: false,
  cycCoatK: 1, cycSpecK: 1, cycNmK: 1, surf: true, tissue: true, perfusion: true, corneum: true, surface: true };   // surface (iteration 11): the surface state from the skin's own tissue (surface.js: the sebum film by site x activity, its coverage of the corneum, the bare corneum by dryness, the vermilion's saliva; iteration 12: the film levels the plateau, GGX at the surface's own alpha and Fresnel), ON; `surface: false` the one A/B arm (the look block: baseSpec, oil, ccRough(T), the five lip constants, the cyc* gains)   // corneum (iteration 10): the epidermis's corneum by cutaneous site, head to toe (tissue.js CORNEUM; Ya-Xian et al. 1999), ON; `corneum: false` the one A/B arm (every vertex at the calibration's forearm corneum).   // perfusion (iteration 8): the dermal blood by the cutaneous site the anatomy reads (tissue.js siteOf; its blood the scans' medians, zones4.js SITE_ZONES) in place of the zones' blood blobs, ON; `perfusion: false` the one A/B arm.   // surf LANDED (15 Oct, SKIN7.json): the default; `surf: false` only as the opt-out for a person without fine7 (with surfFace: false). tissue (iteration 7): the skin's column from the person's head anatomy (tissue.js), ON; `tissue: false` the one A/B arm. (`thin`, iteration 5's slab, is superseded by the columns.)
// the sebaceous glands' output by age and sex, relative to the adult average (SKIN OPTICS it3, `surf`). Pochi, Strauss and Downing 1979 (J Invest Dermatol 73:108,
// 'Age-related changes in sebaceous gland activity'): it rises at puberty to a peak in the 20s-30s in both sexes, men's above women's at every adult age, the fall with
// age proportionately greater in women (a forehead study by the same method: women's flat 18-40, falling after 40, with the menopause's loss of ovarian androgen);
// men's falls slowly from ~50-60. The levels are an approximate reading of that shape (not fitted to a render or a photograph): men 1.1 to 50, 0.85 at 80; women
// 0.9 to 40, 0.5 at 65 and after.
export const sebumActivity = (years, sex) => sex === 'm' ? 1.1 - 0.25 * sst(50, 80, years) : 0.9 - 0.4 * sst(40, 65, years);
const PARS6 = PARS4 + `uniform float likeSSSMode, likeSSSOn, likeTransE; uniform mat4 likeKeyMat; uniform vec4 likeKey, likeS6, likeCC6; uniform vec3 likeSheen;
float likeVar = 0.0, likeOilM = 0.0, likePoreF = 1.0;
`;
const MESO6 = `    // SKIN6: the mesoscale relief, domes between creases (Worley F1: h = a (1 - |o|^2), o the offset to the cell's point, in cells)
    { float msz = mix(0.0024, mix(0.0019, 0.0015, noseK), faceK) * (1.0 + 0.3 * vLikeB.w);
      float am = likeS6.y * mix(0.000035, mix(0.00005, 0.00007, max(noseK, cheekK * 0.8)), faceK) * (1.0 - lip) * (1.0 - nailM);
      float fm = smoothstep(1.0 * fw, 2.5 * fw, msz * 0.35); vec3 om; vec2 cm6 = lkCell(b / msz + 23.0, om);
      likeG += fm * (2.0 * am / msz) * om; var += (1.0 - fm) * 0.5 * pow(0.9 * am / msz, 2.0); }
    // lines by age: forehead, glabella`;
const FRAG6 = R4(FRAG4, [
  ['    // lines by age: forehead, glabella', MESO6],
  ['  float rBase = 0.5 + vLikeC.y + 0.04 * (vLikeB.x - 1.0) + 0.05 * vLikeB.w - 0.12 * lip;', '  float rBase = likeS6.x + vLikeC.y + 0.04 * (vLikeB.x - 1.0) + 0.05 * vLikeB.w - 0.12 * lip;'],
  ['  diffuseColor.rgb *= 1.0 - 0.12 * clamp(poreDark, 0.0, 1.0);', '  likePoreF = 1.0 - likeS6.w * clamp(poreDark, 0.0, 1.0); diffuseColor.rgb *= likePoreF;'],
  ['roughnessFactor = clamp(sqrt(al2), 0.08, 1.0);', 'roughnessFactor = clamp(sqrt(al2), 0.08, 1.0); likeVar = var; likeOilM = vLikeB.z;'],
], 'FRAG6');
// SKIN7 iteration 2: the lip tint (rgb) and the lip's oily-lobe gain (w); the coat's extra roughness over the vermilion (x). Rev 7 only (its own hook key)
// likeLip7 = (tint rgb, the dry vermilion's coat weight), likeLip7b = (coat roughness dry, coat roughness at the wet band, the wet band's added weight, the tint's fade toward the border), likeLip7c = (the base lobe's roughness given back to the vermilion)
// SKIN OPTICS iteration 7: the table is a grid of tissue tiles (skin_lut.js personLUT tiles: TISSUE_TILES.nt columns of the dermis's thickness x .ns rows of
// its backing); a vertex's own column comes in vLikeC.xw (tissue.js tissueCoords, from the person's head anatomy); oxy (veins, the nails; the periorbital share
// when no anatomy was read) mixes it toward the thin column likeTis7.zw
const LUT7 = `uniform vec4 likeTis7; vec2 likeTC = vec2(0.0); float likeVermV = 0.0, likeCC = ${cornCoord(CORNEUM.ref).toFixed(6)};
vec3 likeTile(vec2 uv, float k, float j){ float n = ${LUT_AXES.n}.0, NT = ${TISSUE_TILES.nt}.0, NR = ${2 * CORNEUM.levels.length * TISSUE_TILES.ns}.0;   // (iteration 13: two planes, the albedo's over the transport's)
  return texture2D(likeLUT, vec2((k * n + 0.5 + uv.x * (n - 1.0)) / (NT * n), (j * n + 0.5 + uv.y * (n - 1.0)) / (NR * n))).rgb; }
vec3 likeSet(vec2 uv, float k0, float j0, float fx, float fy, float c, float pl){ float j = j0 + c * ${TISSUE_TILES.ns}.0 + pl * ${CORNEUM.levels.length * TISSUE_TILES.ns}.0;
  return mix(mix(likeTile(uv, k0, j), likeTile(uv, k0 + 1.0, j), fx), mix(likeTile(uv, k0, j + 1.0), likeTile(uv, k0 + 1.0, j + 1.0), fx), fy); }
vec3 likeLutP(float mm, float hm, float oxy, float pl){
  float u = clamp(log(mm / likeAxes0.x) / log(likeAxes0.y / likeAxes0.x), 0.0, 1.0), v = clamp(log(hm / likeAxes1.x) / log(likeAxes1.y / likeAxes1.x), 0.0, 1.0);
  float NT = ${TISSUE_TILES.nt}.0, NS = ${TISSUE_TILES.ns}.0, NC = ${CORNEUM.levels.length}.0; vec2 tc = clamp(mix(likeTC, likeTis7.zw, clamp(oxy, 0.0, 1.0)), 0.0, 1.0);
  float x = tc.x * (NT - 1.0), y = tc.y * (NS - 1.0), k0 = min(floor(x), NT - 2.0), j0 = min(floor(y), NS - 2.0), fx = x - k0, fy = y - j0; vec2 uv = vec2(u, v);
  // iteration 10: the tile SETS by the epidermis's corneum (tissue.js CORNEUM.levels): the vertex's site's (likeCC, from aLikeD), and across the lip mask's gradient the vermilion's
  // (iteration 9's vermilion set is the set at its own corneum)
  float cc = clamp(mix(likeCC, ${cornCoord(VERMILION.layers).toFixed(6)}, clamp(likeVermV, 0.0, 1.0)), 0.0, 1.0) * (NC - 1.0), c0 = min(floor(cc), NC - 2.0), fc = cc - c0;
  vec3 c = mix(likeSet(uv, k0, j0, fx, fy, c0, pl), likeSet(uv, k0, j0, fx, fy, c0 + 1.0, pl), fc);
  return max(c, vec3(0.0)); }
vec3 likeLut(float mm, float hm, float oxy){ return likeLutP(mm, hm, oxy, 0.0); }
// iteration 13: the column's TRANSPORT at this texel (skin_lut.js columnLdBands / channelLd: the diffuse mean free path per channel, mm), read with the albedo's
// own lookup from the table's second plane; lab_bake.js pass 4 writes it for Cycles' radius (sqrt(l_d / LD_MAX_MM))
#define LIKE_LD7 1
vec3 likeLdV = vec3(0.0);
`;
const swapLut = t => { const a = t.indexOf('vec3 likeLut(float mm, float hm, float oxy){'), b = t.indexOf('vec3 likePI('); if (a < 0 || b < a) { console.warn('likeness/skin rev 7: likeLut not found'); return t; } return t.slice(0, a) + LUT7 + t.slice(b); };
const PARS7 = swapLut(PARS6) + `uniform vec4 likeLip7, likeLip7b, likeLip7c, likeSurf7, likeSurfA, likeSurfB, likeSurfC; float likeLipV = 0.0, likeLipWetV = 0.5, likeLipEdgeV = 0.0, likeAB11 = 0.25; vec2 likeMotV = vec2(1.0); varying float vLikeD;
`;
// (the lip block's tail gains two assignments AFTER useLipLine's anchor, which ends at `hm *= mix(1.0, `; lipLineFrag(frag, true) then reads the moist band from the mouth lines instead of the 0.5 here)
const FRAG7 = R4(FRAG6, [
  // SKIN OPTICS iteration 7: the vertex's own tissue column (vLikeC.xw) indexes the table; the shader's painted periorbital share stays only where no anatomy was read
  ['  oxy = max(oxy, vLikeC.x);', '  likeTC = vLikeC.xw; likeCC = vLikeD;'],   // (iteration 10: the vertex's corneum coordinate, aLikeD)
  ['      oxy = max(oxy, 0.35 * po);', '      oxy = max(oxy, 0.35 * po * (1.0 - likeTis7.x));'],
  // SKIN7 c2: the mid-scale mottle and the pore-scale grain are the skin's; the vermilion has no follicles, no pores and no 4-10 mm pigment mottle: their (melanin, blood) factors are noted where they are
  // applied and divided out over the vermilion (lipMottle 1), and a vertical streak in blood (the fissures' direction, ~1 mm across, 20 mm along) is put back (lipStreak). The mask is `lip`, so the lip lines' mask is followed
  ['mm *= exp(gk * likeFine.x * (a1 * f1 + 0.6 * a2 * f2)); hm *= exp(gk * likeFine.y * a1 * f3); }', 'mm *= exp(gk * likeFine.x * (a1 * f1 + 0.6 * a2 * f2)); hm *= exp(gk * likeFine.y * a1 * f3);\n    likeMotV = vec2(exp(bk * (likeMot.x * m4a + likeMot.y * m10)) * exp(gk * likeFine.x * (a1 * f1 + 0.6 * a2 * f2)), exp(bk * (likeMot.z * h4a + likeMot.w * h10)) * exp(gk * likeFine.y * a1 * f3)); }'],
  ['hm *= mix(1.0, likeR4.x, lip); }', 'hm *= mix(1.0, likeR4.x, lip); { float lkm = lip * likeLip7c.y; mm /= mix(1.0, likeMotV.x, lkm); hm /= mix(1.0, likeMotV.y, lkm); hm *= exp(lip * likeLip7c.z * (vn3(vec3(b.x * 1100.0, b.y * 45.0, b.z * 45.0) + hSeed) - 0.5) / 0.184); } mm = mix(mm, 1.0, lip * likeTis7.y); likeVermV = lip * likeTis7.y; likeLipEdgeV = edge * lip; likeLipWetV = 0.5; }'],
  ['  vec3 alb = likeLut(max(mm, 0.02), max(hm, 0.05), oxy);', '  vec3 alb = likeLut(max(mm, 0.02), max(hm, 0.05), oxy); likeLdV = likeLutP(max(mm, 0.02), max(hm, 0.05), oxy, 1.0);\n  alb *= mix(vec3(1.0), likeLip7.rgb, lip * (1.0 - likeLip7b.w * likeLipEdgeV)); likeLipV = lip;'],   // (iteration 13: likeLdV, the column's transport at the same texel)
  ['  float rough = mix(rBase, roughnessFactor, sweat);', `  rBase += likeLip7c.x * lip;
  // SKIN OPTICS iteration 11 (surface.js, likeSurfA.w = 1): THE SURFACE STATE FROM THE SKIN'S OWN TISSUE. The sebum film's thickness (um) = the casual level by
  // site (the zones' gland map vLikeB.z x the person's activity; none on the palms' and soles' horn, vLikeB.w, none on the vermilion), its coverage of the
  // corneum's asperities (h_c x (1 + dryness)); the bare corneum's plateau rougher where dry (the site by its corneum, face 0 .. limb 1, x the limbs' dryness;
  // the volar horn; age); the vermilion's own film is saliva at the wet band (water's Fresnel over the coat's). likeOil = the film's share (the coat's
  // weight; the base lobe's is 1 - it, LIGHTS7); rBase = the bare plateau's drawn GGX roughness (alpha = its own m: iteration 12); likeAB11 = its alpha, which the film
  // levels in LIGHTS7 (alpha_film = (1 - f) x it: surface.js 3b). The relief adds its slopes to both after (LEAN, as before)
  if (likeSurfA.w > 0.5) {
    float sc11 = clamp((likeCC - likeSurfC.x) / max(likeSurfC.y - likeSurfC.x, 1e-3), 0.0, 1.0), vol11 = clamp(vLikeB.w, 0.0, 1.0);
    float dry11 = clamp(sc11 * likeSurfB.w + likeSurfB.z + vol11, 0.0, 1.0) * (1.0 - lip);
    float h11 = likeSurfA.x * clamp(vLikeB.z, 0.0, 1.0) * (1.0 - vol11) * (1.0 - lip);
    float f11 = 1.0 - exp(-h11 / (likeSurfA.y * (1.0 + dry11)));
    likeOil = clamp(f11 + lip * likeLipWetV * likeSurfA.z + 0.3 * sweat, 0.0, 1.0) * (1.0 - nailM) + 0.85 * nailM;
    likeAB11 = mix(likeSurfB.x, likeSurfB.y, dry11); rBase = sqrt(likeAB11); }
  float rough = mix(rBase, roughnessFactor, sweat);`],
  ['* (1.0 + 0.8 * lip) + 0.3 * sweat, 0.0, 1.0)', '* (1.0 - lip) + lip * (likeLip7.w + likeLip7b.z * likeLipWetV) + 0.3 * sweat, 0.0, 1.0)'],
  // SKIN OPTICS it3 (`surf`, likeSurf7.x = 1): ONE microrelief on the face. DETAIL7's fine tier (lib/fx/anatomy/fine: its pores, its furrow network, the age lines from
  // skin_age.js and the lip pleats, on the head chart; in Cycles its bump band, displacement and sub-texel slope variance) carries the head's sub-millimetre relief, so
  // this shader's own pores, three-family furrows, age lines and lip fissures drop out there (x(1 - likeSurf7.x faceK)); the mesoscale domes (1.5-2.5 mm, which the
  // fine tier does not carry), the neck rings and the whole body's relief stay. At 0 every product below is x1.0: the shader is unchanged.
  ['    float dp = pores * mix(', '    float dp = pores * (1.0 - likeSurf7.x * faceK) * mix('],
  ['ar = relief * mix(0.0000045, 0.0000035, faceK)', 'ar = relief * (1.0 - likeSurf7.x * faceK) * mix(0.0000045, 0.0000035, faceK)'],
  ['    float L = lines * (0.15 + 0.85 * age);', '    float L = lines * (0.15 + 0.85 * age) * (1.0 - likeSurf7.x * faceK), Lneck = lines * (0.15 + 0.85 * age);'],
  ['w1 = 0.0012, dep = 0.00006 * L;', 'w1 = 0.0012, dep = 0.00006 * Lneck;'],
  ['dep = 0.00003 * lip * (0.6 + 0.6 * age);', 'dep = 0.00003 * lip * (0.6 + 0.6 * age) * (1.0 - likeSurf7.x);'],
], 'FRAG7');
const DIFFUSE6 = `{ vec3 Ld = directLight.direction; vec3 nS = likeOn > 0.5 ? likeNs : geometryNormal; vec3 nM = likeOn > 0.5 ? likeNm : geometryNormal; vec3 dPI;
    if (likeSSSOn > 0.5) dPI = vec3(saturate(dot(nM, Ld)));   // the screen-space pass scatters it
    else dPI = vec3(likePI(dot(normalize(mix(nS, geometryNormal, 0.15)), Ld)).r, likePI(dot(normalize(mix(nM, nS, 1.0 - 0.45 * likeR4.w)), Ld)).g, likePI(dot(normalize(mix(nM, nS, 1.0 - 0.75 * likeR4.w)), Ld)).b);
    reflectedLight.directDiffuse += dPI * directLight.color * BRDF_Lambert( material.diffuseColor ); }`;
const LIGHTS6 = `#ifdef USE_CLEARCOAT
if (likeOn > 0.5) { material.clearcoat *= likeOil * (1.0 - hNotSkin);
  clearcoatNormal = normalize(mix(clearcoatNormal, likeNm, likeCC6.x));   // the oily film follows the pores and the relief
  float ccr = mix(likeCC6.z, likeCC6.y, clamp(likeOilM, 0.0, 1.0)), cca = ccr * ccr; cca = sqrt(cca * cca + 2.0 * likeVar * likeCC6.w);
  material.clearcoatRoughness = min(max(sqrt(cca), 0.0525) + geometryRoughness, 1.0); }
#endif
#ifdef USE_SHEEN
material.sheenColor *= likeOn > 0.5 ? likeSheen * (1.0 - hNotSkin) : vec3(0.0);   // (the material's sheen is rev 6's alone)
#endif`;
const LIGHTS7 = LIGHTS6.replace('float ccr = mix(likeCC6.z, likeCC6.y, clamp(likeOilM, 0.0, 1.0)),', 'float ccr = likeSurfA.w > 0.5 ? sqrt(max(1.0 - clamp(likeOil, 0.0, 1.0), 0.0) * likeAB11) : mix(mix(likeCC6.z, likeCC6.y, clamp(likeOilM, 0.0, 1.0)), mix(likeLip7b.x, likeLip7b.y, clamp(likeLipWetV, 0.0, 1.0)), clamp(likeLipV, 0.0, 1.0)),') + `
// SKIN OPTICS iteration 11 (surface.js): under the film the base lobe is gone (the corneum / sebum step reflects ~nothing): its weight is 1 - the film's share;
// iteration 12: both lobes at their materials' own Fresnel (the corneum's eta in mat.ior, the film's F0 in likeSurf7.y: no drawn gain), the film's roughness
// the plateau's levelled by the film (ccr above: alpha_film = (1 - f) x the bare plateau's alpha, then LEAN); not on the painted underwear (hNotSkin)
if (likeOn > 0.5 && likeSurfA.w > 0.5) { float sk11 = 1.0 - hNotSkin, bw11 = 1.0 - likeOil * sk11; material.specularColor *= bw11; material.specularF90 *= bw11;
#ifdef USE_CLEARCOAT
  material.clearcoatF0 = mix(material.clearcoatF0, vec3(likeSurf7.y), sk11);
#endif
}`;   // over the vermilion the coat has its OWN roughness: the forehead's sharp oily lobe does not reach the lips
if (LIGHTS7 === LIGHTS6) console.warn('likeness/skin rev 7: the clearcoat roughness anchor was not found');
const AO6 = AO + `
if (likeOn > 0.5 && likeSSSMode > 0.5 && likeSSSMode < 1.5) { reflectedLight.directDiffuse *= hNotSkin; reflectedLight.indirectDiffuse *= hNotSkin; }`;
const TRANS6 = `
#if NUM_DIR_LIGHTS > 0
if (likeOn > 0.5 && hNotSkin < 0.5) {
#if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
  if (likeSSSOn > 0.5 && likeKey.x > 0.0) {
    vec3 Lk = directionalLights[0].direction; vec4 sc = likeKeyMat * vec4(-vViewPosition - geometryNormal * likeKey.y, 1.0);
    if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) {
      float dmm = max(0.0, (sc.z - unpackRGBAToDepth(texture2D(directionalShadowMap[0], sc.xy))) * likeKey.x * 1000.0 - likeKey.z), s = dmm * likeKey.w, s2 = -s * s;
      vec3 T = vec3(0.233, 0.455, 0.649) * exp(s2 / 0.0064) + vec3(0.1, 0.336, 0.344) * exp(s2 / 0.0484) + vec3(0.118, 0.198, 0.0) * exp(s2 / 0.187)
             + vec3(0.113, 0.007, 0.007) * exp(s2 / 0.567) + vec3(0.358, 0.004, 0.0) * exp(s2 / 1.99) + vec3(0.078, 0.0, 0.0) * exp(s2 / 7.41);
      reflectedLight.directDiffuse += directionalLights[0].color * T * saturate(likeTransE + dot(-geometryNormal, Lk)) * likeTrans * BRDF_Lambert(material.diffuseColor);
      if (likeDbg > 3.5) reflectedLight.directDiffuse = vec3(clamp(dmm / 20.0, 0.0, 1.0), sc.z, unpackRGBAToDepth(texture2D(directionalShadowMap[0], sc.xy))) * 0.3; }
  } else
#endif
  { vec3 V = geometryViewDir;
    for (int i = 0; i < NUM_DIR_LIGHTS; i++) { vec3 L = directionalLights[i].direction;
      float t = pow(saturate(dot(V, -normalize(L + likeNs * 0.35))), 3.0) * smoothstep(0.1, -0.3, dot(likeNs, L));
      reflectedLight.directDiffuse += directionalLights[i].color * t * likeThin * likeTrans * 0.45 * pow(material.diffuseColor, vec3(1.1)) * vec3(1.25, 0.8, 0.65); } }
}
#endif`;
// the passes' outputs (chained after hero.js's patch, rev 6 only): mode 1 alpha = not-skin (the diffuse was zeroed in AO6); mode 2 the albedo
const OUT6 = `#include <opaque_fragment>
if (likeSSSMode > 0.5) { if (likeSSSMode < 1.5) gl_FragColor.a = likeOn > 0.5 ? hNotSkin : 1.0; else gl_FragColor = vec4(material.diffuseColor * likePoreF, 1.0); }`;   // the pores' dots twice in C: the pass divides one out before the blur, so the open pores stay sharp (a surface feature, not pigment)
// the key's shadow matrix (view -> shadow texture) and depth range for the transmission, set right before each rev-6 body draws
const _keyOf = new WeakMap();
function keyLightOf(scene) {
  let L = _keyOf.get(scene);
  if (!L || !L.parent || !L.castShadow) { L = null; scene.traverse(o => { if (!L && o.isDirectionalLight && o.castShadow) L = o; }); if (L) _keyOf.set(scene, L); }
  return L;
}
function sss6BeforeRender(renderer, scene, camera) {
  const L = keyLightOf(scene), k = SSS6.likeKey.value;
  if (!L || !L.visible || !L.shadow?.map || !renderer.shadowMap.enabled) { k.x = 0; return; }
  const c = L.shadow.camera; k.x = c.far - c.near; SSS6.likeKeyMat.value.multiplyMatrices(L.shadow.matrix, camera.matrixWorld);
}

export async function applySkin(h, params = {}, { model = null } = {}) {
  const M = model || await loadSkinModel();
  const rev4 = (params.rev ?? 0) >= 4;
  const rev6 = (params.rev ?? 0) >= 6 && typeof h.useSkinHook === 'function';   // SKIN6 (hero.js's H1 hook only; else rev 4)
  const rev7 = (params.rev ?? 0) >= 7 && rev6;   // SKIN7 = SKIN OPTICS: rev 6's shader, the colour from the layered model (optics.js)
  if ((params.rev ?? 0) >= 6 && !rev6) console.warn('likeness/skin rev 6 needs hero.js\'s skin hook; this hero gets rev 4');
  const o = { ...SKIN_DEFAULTS, ...(rev4 ? { sss: 1.0, trans: 0.8 } : {}), ...(rev6 ? SKIN6_DEFAULTS : {}), ...(rev7 ? SKIN7_DEFAULTS : {}), ...params }, sex = h.sex || 'm', ageK = o.age ?? h.o.age ?? 0.3;
  // the person's own draw (zones, flush, hue): the seed and the person's record (a lineup shares one seed across people)
  const seed4 = ((o.seed ?? h.o.seed ?? 1) * 7919 + Math.round((h.o.height || 1.7) * 1000) * 31 + Math.round((h.o.age ?? 0.3) * 1000) + [...String(h.o.name || h.o.skin || '')].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381)) >>> 0;
  if (o.weathering == null) o.weathering = clamp(0.1 + 1.2 * Math.max(0, ageK - 0.35));               // coarse relief and lentigines: from middle age (ageK 0.35 ~ 40)
  if (o.beardShadow == null) o.beardShadow = sex === 'm' ? clamp(0.35 + 0.5 * (h.o.stubble ?? 0.5)) : 0;
  // SKIN OPTICS (rev 7): the cast hex inverted to pigments (optics.js pigmentsFromHex: the melanin type from chemistry and the carotene at the population's, the hex
  // inverted for melanin amount, blood and oxygenation; iteration 2's `chem`, landed), and the pigments' spatial variation at the amplitude the scans MEASURED
  // (SKIN7_DEFAULTS.mottle 1: MOT4, SKIN4's 2-6 mm and 6-15 mm log-melanin / log-blood SDs on the HSRD-100 cheeks and foreheads, x0.65 for the scans' own noise)
  const chem = rev7;
  // SKIN OPTICS it3's A/B switch `surf` (see SKIN7_DEFAULTS' header): the surface counted once
  const surf = rev7 && !!o.surf, years = o.years ?? h.o.years ?? (20 + clamp((ageK - 0.1) / 0.85) * 50);   // (core.js: age = clamp((years - 20) / 50) x 0.85 + 0.1)
  const sebum = surf ? sebumActivity(years, sex) : null;
  let p = o.skin || (o.preset && M.presets[o.preset]) || (chem ? pigmentsFromHex(M, h.o.skin || '#b07a58', { sex }) : rev6 && o.fit6 !== false ? skinFromHex6(M, h.o.skin || '#b07a58', { sex, ...(o.fit6 && typeof o.fit6 === 'object' ? o.fit6 : {}) }) : skinFromHex(M, h.o.skin || '#b07a58', { sex }));
  const fit6 = p.fit || null;
  p = { Cm: p.Cm, beta: p.beta, Ch: p.Ch, gamma: p.gamma, Cc: p.Cc ?? 0.2 };
  if (rev4 && o.vary !== false) p = person4(p, seed4, chem ? 0.9 : 0.7);   // (chem: the draw on the melanin type round the chemistry's share, not clamped to rev 4's 0.7)
  let z7 = null;
  if (o.freckles == null) o.freckles = clamp(0.6 * (1 - p.beta) * sst(0.08, 0.02, p.Cm));   // light, pheomelanin-rich skin freckles; deep skin rarely shows them
  if (o.lipTone == null) o.lipTone = sst(0.1, 0.35, p.Cm);                                        // pigmented lip borders on deeper skin
  // the style ladder (research/PERSON_PIPELINE.md: L0 realistic .. L4 silhouette): small forms go first. L1 masses: pores and relief
  // fade into sheen (their slope variance stays in the roughness), lines and marks halve; L2 planes and above: no lines, marks,
  // freckles or veins, an even complexion, one soft lobe. The realism floor below applies at L0 only.
  const lv = Math.max(0, Math.min(4, Math.round(o.level ?? 0)));
  if (lv >= 1) { o.microFade *= lv >= 2 ? 64 : 8; o.lines *= lv >= 2 ? 0 : 0.5; o.moles *= lv >= 2 ? 0 : 0.5; o.weathering *= lv >= 2 ? 0 : 0.5; }
  if (lv >= 2) { o.freckles = 0; o.veins = 0; o.homogeneity = 0.95; o.oil *= 0.5; }
  if (lv === 0) { o.pores = Math.max(o.fine7Defer ? 0 : 0.5, o.pores); o.homogeneity = Math.min(0.85, o.homogeneity); }   // the floor: pores and some unevenness never go (at L0)
  // health: carotenoid yellowness and oxygenated redness (Stephen et al. 2009, 2011), a small move around the person's own values
  const kFace = rev7 ? (o.faceBlood ?? FACE_BLOOD) : 1;   // SKIN OPTICS: the table is the FACE's (its blood x kFace over the fitted arm); the covered body takes 1 / kFace below
  if (rev7 && !o.skin && !o.preset) p = fitFace(M, p, kFace, o.corneum !== false ? cornK(CORNEUM.layers.face) : 1);   // the cast hex's lightness is the FACE's (its melanin re-solved at the face's blood and, iteration 10, the face's own corneum)
  const pH = { ...p, Ch: p.Ch * kFace, Cc: p.Cc * (1 + 0.8 * o.health), gamma: clamp(p.gamma + 0.06 * o.health, 0.3, 0.95) };
  // SKIN7: what the Cycles skin material reads from the person (blender/person_scene.py skin_material: the manifest carries skin.person; a key the others ignore)
  if (rev7) p = { ...p, rev7: { baseSpec: o.baseSpec, oilGain: o.oil / 0.5, oilDeep: surf ? 0 : o.oilDeep, ...(surf ? { surf: { sebum: +sebum.toFixed(3), years: Math.round(years), microFade: Math.max(1, o.microFade), faceRelief: o.surfFace !== false ? 'fine7' : 'skin' } } : {}), deepK: sst(0.07, 0.3, p.Cm), cyclesChroma: o.cyclesChroma ?? 1, ccRoughT: o.ccRoughT, ccRough: o.ccRough, cycCoatK: o.cycCoatK ?? 1, cycSpecK: o.cycSpecK ?? 1, cycNmK: o.cycNmK ?? 1, cycSpecDeep: o.cycSpecDeep ?? 0, cycNmGraze: o.cycNmGraze ?? 0 } };
  // SKIN OPTICS iteration 11: the surface state from the skin's own tissue (surface.js); `surface: false` = the one A/B arm (the look block above)
  const S11 = rev7 && o.surface !== false ? personSurface({ years, activity: sebumActivity(years, sex) }) : null;
  if (rev7) p.rev7.surface = S11 ? { ...S11, activity: +sebumActivity(years, sex).toFixed(3), years: Math.round(years) } : false;
  // SKIN OPTICS iteration 7: the skin as a column of its own tissue (tissue.js): the person's head anatomy read per vertex (the dermis's thickness, the subcutis,
  // what lies under it) in node (the keyed cache in the page); the table holds one tile per column (skin_lut.js personLUT tiles). skin { tissue: false } = the
  // one A/B arm (no anatomy read: every vertex at the arm's column, the zones' thin share as before). Iteration 5's `thin` slab is superseded (the option is ignored).
  let tis = null;
  if (rev7 && o.tissue !== false) { try { const TI = await import('./tissue.js'), r = await TI.headTissue(h, { info: { sex, years, bmi: o.bmi ?? h.o.bmi ?? null, group: h.o.group ?? null, hex: h.o.skin ?? null, who: h.o.variant ?? null } });
      tis = { source: r.source, key: r.key, n0: r.n0, report: r.report };
      if (r.T) { const C0 = TI.tissueCoords(M, r.T, r.n0), A = new Float32Array(r.n0 * 4); for (let v = 0; v < r.n0; v++) { A[v * 4] = C0.tdI[v]; A[v * 4 + 1] = C0.s[v]; A[v * 4 + 2] = C0.cart[v]; A[v * 4 + 3] = r.T.has[v]; }
        const plan = h.body.geometry.userData?.plan, n = h.body.geometry.attributes.position.count;
        let Au = A; if (n !== r.n0) { if (!plan) throw new Error('tissue: the body is not level 0 and has no subdivision plan'); Au = (await import('../body/subdiv.js')).subdivideAttr(plan, A, 4, 'linear'); }
        tis.field = Au;
        // iteration 8: the cutaneous SITE (read with the column) -> the dermal blood by site (zones4.js); `perfusion: false` = the one A/B arm (the zones' blood blobs)
        if (o.perfusion !== false && r.T.site) { const g0 = h.body.userData?.geomL0 || h.body.geometry, W0 = TI.siteWeights(r.T, r.n0, g0.index?.array || null, 2), ns = TI.SITES.length;
          const Wu = n !== r.n0 ? (await import('../body/subdiv.js')).subdivideAttr(plan, W0, ns, 'linear') : W0;
          tis.sites = { w: Wu, names: TI.SITES }; } } }
    catch (e) { console.warn('likeness/skin rev 7: the tissue read failed (the arm column everywhere): ' + (e?.message || e)); tis = { source: 'error', error: String(e?.message || e) }; } }
  const L = personLUT(M, pH, { tiles: rev7 }); L.base = L.base.map(x => Math.max(x, 0.003));   // (a deep skin's body blue is ~0: keep the ratio below well defined)
  const half = new Uint16Array(L.data.length); for (let i = 0; i < L.data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.max(0, L.data[i]));
  const tex = new THREE.DataTexture(half, L.w, L.h, THREE.RGBAFormat, THREE.HalfFloatType); tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  // SKIN OPTICS: no solved flush (the cheek is SKIN4's scan-measured zone with its per-person draw); the covered body at the arm's blood (BODY_BLOOD / kFace); the lid margin's cap kept
  if (rev7) { z7 = { zones: {}, body: Object.fromEntries(Object.entries({ ...BODY_BLOOD, ...(o.bodyBloodOpt || {}) }).map(([k, v]) => [k, v / kFace])), ...(o.zoneBloodCap ? { bloodCap: o.zoneBloodCap } : {}),
      tiles: { ref: L.ref, thin: L.thin }, ...(tis?.field ? { tissue: { field: tis.field, ...(tis.sites ? { sites: tis.sites } : {}) } } : {}), corneum: o.corneum !== false };
    p.rev7.corneum = o.corneum !== false ? { source: 'Ya-Xian, Suetake and Tagami 1999 (cell layers by site) / the calibration\'s volar forearm 15', layers: CORNEUM.layers, levels: CORNEUM.levels, faceK: +cornK(CORNEUM.layers.face).toFixed(3) } : false;
    if (tis) p.rev7.tissue = { source: tis.source, key: tis.key || null, read: !!tis.field, perfusion: !!tis.sites, ...(tis.report ? { built: tis.report } : {}), ...(tis.error ? { error: tis.error } : {}) };
    p.rev7.vermilion = o.vermilion !== false ? { epithelium: 'tissue.js VERMILION (the vertex column with the vermilion corneum)', ...(await import('./tissue.js')).VERMILION } : false;
    const so = skinOptics(M, pH); p.optics = { version: 2, kFace, ld: so.ld.map(x => +x.toFixed(3)), albedo: so.albedo.map(x => +x.toFixed(4)), arm: skinOptics(M, { ...pH, Ch: p.Ch }).ld.map(x => +x.toFixed(3)) };
    // iteration 13: THE TRANSPORT FROM THE COLUMN: the table's second plane holds each column's l_d per channel (skin_lut.js columnLdBands), the shader reads it
    // per texel (likeLdV) and the Cycles bake writes it (lab_bake.js pass 4 -> bake_post.py skin_ld_a<k>.png); person_scene.py then takes the radius from the map
    // instead of the person's one ld above (which stays the fallback for an export without the map). `transport: false` = the one A/B arm (one radius per person).
    if (o.transport !== false && L.planes === 2) p.optics.ldMap = { version: 1, maxMm: LD_MAX_MM, enc: 'sqrt', pass: 4, map: 'skin_ld_a<k>.png', model: 'skin_lut.js columnLdBands (the column as an effective dermis; Jacques 2013 scattering)' }; }
  // SKIN7: the nipple-areola complex placed by anatomy on this person's own surface (BODY7's lib/fx/body/nipple.js nippleAt(h, { sex, scale }) -> { L: [x,y,z], R: [x,y,z], r?, source? } in the body geometry's bind space), or params.nipples (the same object); false = the fixed hm08 vertices
  let nip7 = null;
  if (rev7 && o.nipples !== false) { if (o.nipples && typeof o.nipples === 'object') nip7 = o.nipples;
    else { try { const mod = await import('../body/nipple.js'); if (typeof mod.nippleAt === 'function') nip7 = await mod.nippleAt(h, { sex, scale: 1 / (h.scale || 1) }); } catch (e) { /* BODY7's nippleAt has not landed: the fixed-vertex landmark stays (rev 6's) */ } } }
  // fields -> attributes
  const fl = skinFields(h, rev4 ? { sex, seed: seed4, age: ageK, scale: 1 / (h.scale || 1), ...(z7 ? { z7 } : {}) } : null), geo = h.body.geometry;
  geo.setAttribute('aLikeA', new THREE.BufferAttribute(fl.A, 4)); geo.setAttribute('aLikeB', new THREE.BufferAttribute(fl.B, 4));
  if (rev4) geo.setAttribute('aLikeC', new THREE.BufferAttribute(fl.C, 4));
  // rev 7 (iteration 10): the corneum coordinate per vertex (skinFields D; with corneum: false every vertex at the calibration's, the forearm's: the table as iteration 9 read it)
  if (rev7) { const nv = geo.attributes.position.count; let D = fl.D; if (!D || D.length !== nv) { D = new Float32Array(nv).fill(cornCoord(CORNEUM.ref)); } geo.setAttribute('aLikeD', new THREE.BufferAttribute(D, 1)); }
  const U = {
    likeOn: { value: 1 }, likeLUT: { value: tex }, likeSSS: { value: skinLUT() }, likeBase: { value: new THREE.Vector3(...L.base) }, likeNose: { value: fl.land.nose.clone() },
    likeAxes0: { value: new THREE.Vector2(...LUT_AXES.m) }, likeAxes1: { value: new THREE.Vector2(...LUT_AXES.h) }, likeScale: { value: h.scale },
    likeK0: { value: new THREE.Vector4() }, likeK1: { value: new THREE.Vector4() }, likeK2: { value: new THREE.Vector4() }, likeK3: { value: new THREE.Vector4() },
    likeSSSk: { value: 1 }, likeTrans: { value: 1 }, likeDbg: { value: o.debug || 0 }, likeLight: { value: sst(0.15, 0.04, p.Cm) },
  };
  // SKIN7 iteration 5: the melanin mottle by the lightness it makes (mottleLaw 'lstar'): the table's own |dL*/dln melanin| at the face's base against the reference's (a deep skin moves 23-26 L* per ln unit, a mid skin 9, the lightest 3)
  const mel7 = rev7 ? (d => Math.abs(rgbToLab(lutAt(L, Math.exp(d), 1, 0))[0] - rgbToLab(lutAt(L, Math.exp(-d), 1, 0))[0]) / (2 * d))(0.1) : 0;
  const melK = rev7 && o.mottleLaw !== 'dk' ? clamp(((o.mottleRef ?? 9.5) / Math.max(mel7, 1e-3)) ** (o.mottleExp ?? 1.2), 0.2, 1) : null;   // (exponent 1.2: the dark end is steeper than equal L*: the same absolute step reads larger on a dark face)
  let areo = null, mot4 = null;
  if (rev4) { const P0 = geo.attributes.position.array, mt = MOT4[sex === 'm' ? 'm' : 'f'], dk = 1 - 0.45 * sst(0.08, 0.3, p.Cm);
    areo = areolae(h, P0, h.nrm, P0.length / 3, { sex, seed: seed4, scale: 1 / (h.scale || 1), ...(nip7 ? { nipples: nip7 } : {}) });
    Object.assign(U, { likeMot: { value: new THREE.Vector4() }, likeR4: { value: new THREE.Vector4(3.8, 1.35, 2.0, 1.0) },
      likeAreo0: { value: new THREE.Vector4(...(areo ? areo.L : [0, 0, 0, 0])) }, likeAreo1: { value: new THREE.Vector4(...(areo ? areo.R : [0, 0, 0, 0])) },
      likeAreoK: { value: new THREE.Vector2(areo ? areo.mel : 1, areo ? areo.blood : 1) }, likeFine: { value: new THREE.Vector4() } });
    mot4 = mt.map((x, i) => 0.65 * x * (i < 2 ? (melK ?? dk) : 1) * (0.8 + 0.5 * clamp(ageK))); }   // 0.65 of the measured: the scans' bands carry some texture noise and baked light
  // vellus sheen by the skin's lightness: on deep skin the vellus hairs are pigmented and a white sheen read as ashy (L22 studio@5: C 20 -> 17)
  const sheenK = clamp((0.2126 * L.base[0] + 0.7152 * L.base[1] + 0.0722 * L.base[2] - 0.04) / 0.3);
  if (p.rev7) p.rev7.sheenK = +sheenK.toFixed(3);   // SKIN7 c2: the Cycles skin's sheen weight follows the engine's rule (blender/person_scene.py skin_material: Sheen Weight 0.04 x sheenK; the white veil on deep skins' neck and cheeks)
  const deepK = sst(0.07, 0.3, p.Cm);   // SKIN7: 1 on the deepest skins (the oily lobe's gain), 0 on light ones
  if (rev6) Object.assign(U, { ...SSS6, likeS6: { value: new THREE.Vector4() }, likeCC6: { value: new THREE.Vector4() }, likeSheen: { value: new THREE.Vector3() }, likeTransE: { value: 0.2 } });
  // the lip's uniforms (rev 7): likeLip7 = (tint rgb: 1, no tint since SKIN OPTICS; the dry vermilion's coat weight), likeLip7b / likeLip7c = the vermilion's gloss and its mottle and streak
  if (rev7) Object.assign(U, { likeTis7: { value: new THREE.Vector4(tis?.field ? 1 : 0, o.vermilion !== false ? 1 : 0, ...L.thin) } });   // (tissue read, the vermilion's own column (iteration 9; `vermilion: false` the A/B arm), the thin column's coordinates: veins and nails mix toward it)   // (tissue read, -, the thin column's coordinates: veins and nails mix toward it)
  if (rev7) Object.assign(U, { likeLip7: { value: new THREE.Vector4(1, 1, 1, 0.12) }, likeLip7b: { value: new THREE.Vector4(0.4, 0.3, 0.3, 0) }, likeLip7c: { value: new THREE.Vector4(0, 0, 0, 0) }, likeSurf7: { value: new THREE.Vector4(surf && o.surfFace !== false ? 1 : 0, S11 ? S11.f0Film : 0, 0, 0) },
      // iteration 11 (surface.js): A = (um of film per unit of the gland map x activity, h_c um, the vermilion's saliva share of the coat, on), B = (the bare plateau's GGX alpha hydrated, dry,
      // the age's dryness, the limbs' dryness against the face), C = (the face's and the limbs' corneum coordinates, -, -); likeSurf7.y = the film's F0 (sebum's own; iteration 12: no drawn gain,
      // the film's roughness is per fragment, the plateau's levelled by the film's share: LIGHTS7)
      likeSurfA: { value: new THREE.Vector4(S11 ? S11.umPerDensity : 0, S11 ? S11.hc : 1, S11 ? S11.wetK : 0, S11 ? 1 : 0) },
      likeSurfB: { value: new THREE.Vector4(S11 ? S11.alphaC : 0.25, S11 ? S11.alphaDry : 0.4, S11 ? S11.ageDry : 0, S11 ? S11.dry.limb : 0.5) },
      likeSurfC: { value: new THREE.Vector4(cornCoord(CORNEUM.layers.face), cornCoord(CORNEUM.layers.limb), 0, 0) } });   // (surfFace false: a person rendered WITHOUT DETAIL7's fine tier keeps this shader's face relief)
  const set = (q = {}) => { Object.assign(o, q);
    U.likeK0.value.set(o.tan, o.homogeneity, o.health, o.weathering); U.likeK1.value.set(o.freckles, o.moles, o.fine7Defer ? 0 : Math.max(0.5, o.pores), o.relief);   // (iteration 6, fine7Defer: DETAIL7's fine tier carries the pores: this procedural pore pit and its darkening drop out)
    // (surf: the sebum film's amount = the zones' map x the person's gland activity, no deep-skin gain; the relief's footprint never under one sample)
    U.likeK2.value.set(o.lines, rev7 ? o.oil * (surf ? sebum : 1 + (o.oilDeep || 0) * deepK) : o.oil, o.beardShadow, ageK); U.likeK3.value.set(o.veins, o.lipTone, o.nails, surf ? Math.max(1, o.microFade) : o.microFade); U.likeSSSk.value = o.sss; U.likeTrans.value = o.trans;
    if (rev7 && h.body?.material) h.body.material.specularIntensity = S11 ? 1 : o.baseSpec;   // (iteration 11-12: the bare lobe's Fresnel is the corneum's own eta, mat.ior)
    if (rev6) { U.likeS6.value.set(o.baseRough, lv >= 2 ? 0 : o.meso, 0, o.fine7Defer ? 0 : o.poreDark); U.likeCC6.value.set(o.ccFollow, o.ccRoughT, o.ccRough, o.ccVar); U.likeSheen.value.setScalar(o.sheen * sheenK); U.likeTransE.value = o.transE; }
    if (rev7) { U.likeLip7.value.set(1, 1, 1, o.lipDry); U.likeLip7b.value.set(o.lipRoughDry + (o.lipRoughDeep ?? 0) * deepK, o.lipRoughWet + (o.lipRoughDeep ?? 0) * deepK, o.lipWet * (1 - (o.lipWetDeep ?? 0) * deepK), o.lipEdgeFade * (1 - deepK)); U.likeLip7c.value.set(o.lipBaseRough, o.lipMottle ?? 0, o.lipStreak ?? 0, 0); }   // (the vermilion's gloss, its mottle and its streak)
    if (mot4) { const kh = rev7 ? 1 + (o.homogMot ?? 0) * (0.5 - clamp(o.homogeneity)) : 1.5 - clamp(o.homogeneity);   // rev 7: the mottle and the fine grain are texture, not blemish: homogeneity (the looks') no longer shrinks them (homogMot 1 = rev 6)
      const k = kh * (lv >= 2 ? 0 : lv === 1 ? 0.5 : 1) * (o.mottle ?? 1); U.likeMot.value.set(...mot4.map(x => x * k));
      U.likeFine.value.set(0.045 * k * (o.grain ?? 1) * Math.pow(melK ?? 1, o.grainMelExp ?? 1), 0.05 * k * (o.grain ?? 1), o.bodyMottle ?? (rev7 ? 0.4 / (o.mottle ?? 1) : 0.4), o.bodyGrain ?? (rev7 ? 0.6 / ((o.mottle ?? 1) * (o.grain ?? 1)) : 0.6)); } };   // (rev 7: the face's mottle and grain are raised, the body keeps rev 6's absolute level: BODY7 / ANAT7 own the body's surface)   // body x0.4 / x0.6: at x1 the Cycles torso read blotchy
  set();
  // material: ior 1.4, base lobe, oily lobe on the clearcoat, no sheen; colour = the person's base albedo (hero.js's SKIN_FRAG multiplies it)
  const mat = h.body.material;
  mat.color.setRGB(...L.base, THREE.LinearSRGBColorSpace); mat.ior = S11 ? S11.etaC : 1.4; mat.specularIntensity = rev7 && !S11 ? o.baseSpec : 1; mat.roughness = 0.55; mat.sheen = 0;
  mat.clearcoat = 1; mat.clearcoatRoughness = 0.3;
  // HUMAN c8 HOOKS: hero.js's H1 slots (h.useSkinHook) when it has them: the same GLSL, placed by hero.js instead of matched against its
  // text; the paint mask hNotSkin (declared by hero.js with a hook) lets painted underwear escape the pre-integrated diffuse, the pores,
  // the transmission and the oily coat (1 there; 0 everywhere else, where every term is exactly as before). Else the outside chain below.
  if (rev6) {
    mat.sheen = o.sheen > 0 ? 1 : 0; mat.sheenColor.setRGB(1, 1, 1); mat.sheenRoughness = o.sheenRough; mat.userData.likeSkin6 = true;
    // the key's shadow map must hold where light ENTERS the body (the thickness is the shaded point's depth minus it): three renders a
    // FrontSide material's BACK faces into shadow maps by default (acne), which put the exit surface there and read every part as thin
    // (the shadow side filled with light: farm job 1004-041017). Front faces here; the stages' normal bias (3 cm) keeps the acne away.
    mat.shadowSide = THREE.FrontSide;
    h.useSkinHook({ key: rev7 ? 'likeness-skin7' : 'likeness-skin6', uniforms: U, vertPars: 'attribute vec4 aLikeA, aLikeB; varying vec4 vLikeA, vLikeB; attribute vec4 aLikeC; varying vec4 vLikeC;' + (rev7 ? ' attribute float aLikeD; varying float vLikeD;' : ''), vert: 'vLikeA = aLikeA; vLikeB = aLikeB; vLikeC = aLikeC;' + (rev7 ? ' vLikeD = aLikeD;' : ''),
      fragPars: (rev7 ? PARS7 : PARS6).replace('attribute_placeholder', 'uniform float likeSSSk, likeTrans;'), frag: rev7 ? FRAG7 : FRAG6, normal: NORMAL4.replace('if (likeOn > 0.5) {', 'if (likeOn > 0.5 && hNotSkin < 0.5) {'),
      diffuse: DIFFUSE6.replace('    reflectedLight.directDiffuse += dPI', '    dPI = mix(dPI, vec3(saturate(dot(geometryNormal, Ld))), hNotSkin);\n    reflectedLight.directDiffuse += dPI'),
      lights: rev7 ? LIGHTS7 : LIGHTS6, ao: AO6, lightsEnd: TRANS6 });
    // the passes' output modes after every other patch's colour (chained like the lanes' patches; hero.js then emits its section markers)
    const prevOBC = mat.onBeforeCompile;
    mat.onBeforeCompile = function (sh, r) { prevOBC.call(this, sh, r); if (!sh.fragmentShader.includes('#include <opaque_fragment>')) console.warn('likeness/skin rev 6: opaque_fragment not found; the SSS pass will see no skin');
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', OUT6); };
    const prevOBR = h.body.onBeforeRender;
    h.body.onBeforeRender = function (renderer, scene, camera, ...a) { prevOBR?.call(this, renderer, scene, camera, ...a); sss6BeforeRender(renderer, scene, camera); };
    const nail = lutAt(L, 0.18, 2.6, 0.15);
    h.likeness = { ...(h.likeness || {}), skin: { U, params: o, person: p, lut: L, fields: fl, nail, hook: true, rev: rev7 ? 7 : 6, z4: fl.z4 || null, areolae: areo, fit6, optics: p.optics || null, ...(rev7 ? { nipples: nip7 ? (nip7.source || 'given') : null, surf: surf ? p.rev7.surf : false } : {}) } };
    return { U, set, params: o, person: p, lut: L, fields: fl, fit6, off: () => { U.likeOn.value = 0; }, on: () => { U.likeOn.value = 1; } };
  }
  if (typeof h.useSkinHook === 'function') {
    h.useSkinHook({ key: rev4 ? 'likeness-skin4' : 'likeness-skin1', uniforms: U, vertPars: 'attribute vec4 aLikeA, aLikeB; varying vec4 vLikeA, vLikeB;' + (rev4 ? ' attribute vec4 aLikeC; varying vec4 vLikeC;' : ''), vert: 'vLikeA = aLikeA; vLikeB = aLikeB;' + (rev4 ? ' vLikeC = aLikeC;' : ''),
      fragPars: (rev4 ? PARS4 : PARS).replace('attribute_placeholder', 'uniform float likeSSSk, likeTrans;'), frag: rev4 ? FRAG4 : FRAG, normal: (rev4 ? NORMAL4 : NORMAL).replace('if (likeOn > 0.5) {', 'if (likeOn > 0.5 && hNotSkin < 0.5) {'),
      diffuse: (rev4 ? DIFFUSE4 : DIFFUSE).replace('    reflectedLight.directDiffuse += dPI', '    dPI = mix(dPI, vec3(saturate(dot(geometryNormal, Ld))), hNotSkin);\n    reflectedLight.directDiffuse += dPI'),
      lights: '#ifdef USE_CLEARCOAT\nif (likeOn > 0.5) material.clearcoat *= likeOil * (1.0 - hNotSkin);\n#endif', ao: AO,
      lightsEnd: TRANS.replace('if (likeOn > 0.5 && likeThin > 0.01) {', 'if (likeOn > 0.5 && likeThin > 0.01 && hNotSkin < 0.5) {') });
    const nail = lutAt(L, 0.18, 2.6, 0.15);
    h.likeness = { ...(h.likeness || {}), skin: { U, params: o, person: p, lut: L, fields: fl, nail, hook: true, rev: rev4 ? 4 : 1, z4: fl.z4 || null, areolae: areo } };
    return { U, set, params: o, person: p, lut: L, fields: fl, off: () => { U.likeOn.value = 0; }, on: () => { U.likeOn.value = 1; } };
  }
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev?.(sh, r); Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aLikeA, aLikeB; varying vec4 vLikeA, vLikeB;' + (rev4 ? ' attribute vec4 aLikeC; varying vec4 vLikeC;' : '')).replace('#include <begin_vertex>', '#include <begin_vertex>\nvLikeA = aLikeA; vLikeB = aLikeB;' + (rev4 ? ' vLikeC = aLikeC;' : ''));
    let fs = sh.fragmentShader;
    const pars = (rev4 ? PARS4 : PARS).replace('attribute_placeholder', 'uniform float likeSSSk, likeTrans;');
    const FRAGx = rev4 ? FRAG4 : FRAG, NORMALx = rev4 ? NORMAL4 : NORMAL, DIFFUSEx = rev4 ? DIFFUSE4 : DIFFUSE;
    fs = fs.replace('#include <common>', '#include <common>\n' + pars);
    if (WRAP_RE.test(fs)) fs = fs.replace(WRAP_RE, DIFFUSEx);
    else if (fs.includes('#include <lights_physical_pars_fragment>')) fs = fs.replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(DL, DIFFUSEx));
    else fs = fs.replace(DL, DIFFUSEx);
    if (!fs.includes('roughnessFactor = pRough;\n}')) console.warn('likeness/skin: hero.js SKIN_FRAG anchor not found; skin left as hero.js made it');
    fs = fs.replace('roughnessFactor = pRough;\n}', 'roughnessFactor = pRough;\n}\n' + FRAGx)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + NORMALx)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nif (likeOn > 0.5) material.clearcoat *= likeOil;\n#endif')
      .replace('#include <aomap_fragment>', AO + '\n#include <aomap_fragment>')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + TRANS);
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + (rev4 ? '|likeness-skin4' : '|likeness-skin1');
  mat.needsUpdate = true;
  const nail = lutAt(L, 0.18, 2.6, 0.15);
  h.likeness = { ...(h.likeness || {}), skin: { U, params: o, person: p, lut: L, fields: fl, nail, rev: rev4 ? 4 : 1, z4: fl.z4 || null, areolae: areo } };
  return { U, set, params: o, person: p, lut: L, fields: fl, off: () => { U.likeOn.value = 0; }, on: () => { U.likeOn.value = 1; } };
}

// ---------------------------------------------------------------- MOUTH (round 4b): the vermilion from the face's geometry (opt-in)
// useLipLine(h, lines, paint): lane B's painted vermilion (an analytic lens round hMouth, which FACE c2 and FACE4 could only re-number
// and bend from outside) takes its outline from uniforms instead: the lips' meeting line and the upper and lower vermilion borders as
// polylines in bind space (face/mouth.js mouthLines: the same outline the lip shape was built on), so the colour sits on the lips the
// geometry has. Inside it, graded: redder, darker and wetter toward the meeting line, matte toward the border; a defined border (more
// melanin at the edge on deeper skin, lipTone), a fine lighter roll just outside the border on lighter skin. Melanin in the vermilion
// x1.08-1.22 (SKIN4's measured vermilion x1.08 men, x1.55 women, the border x1.05-1.26; lane B's 0.75 read lavender-pink on light skin). Applied after applySkin
// (rev 1 or 4): the hook entry is replaced IN PLACE (same run order) under a new key ('-lipg1'), so its program never collides with a
// person's without it. Without this call nothing here runs: rev 1 and rev 4 keep their text and keys byte for byte.
// lines: { N, rows: [[|x|, yMeet, yTop, yBot] x N] (bind m), half, z, center }; paint: { blood (x lane B's), edge (the border's melanin
// on deep skin), roll (the light roll on light skin), wet (roughness off at the inner line) }
const LIPG_N = 12;
const LIPG_PARS = `uniform vec4 likeLipG[${LIPG_N}]; uniform vec4 likeLipK; uniform vec4 likeLipP; float likeLipWet = 0.0, likeLipEdge = 0.0;
void likeLipGeo(vec3 b, out float inL, out float edge, out float wet, out float roll) {
  float ax = abs(b.x - likeLipK.w), f = clamp(ax / likeLipK.x, 0.0, 1.0) * ${LIPG_N - 1}.0, t = fract(f); vec4 A = likeLipG[0], B = likeLipG[1];
  for (int k = 0; k < ${LIPG_N - 1}; k++) if (float(k) == min(floor(f), ${LIPG_N - 2}.0)) { A = likeLipG[k]; B = likeLipG[k + 1]; }
  if (f >= ${LIPG_N - 1}.0) t = 1.0;
  vec3 L = mix(A.yzw, B.yzw, t); float y = b.y, ew = max(likeLipK.z, 0.7 * fwidth(y)), up = step(L.x, y), front = step(likeLipK.y - 0.02, b.z) * step(ax, likeLipK.x * 1.08);
  float dE = mix(y - L.z, L.y - y, up), hH = max(mix(L.x - L.z, L.y - L.x, up), 1e-4), dM = abs(y - L.x);
  inL = smoothstep(-ew, ew, dE) * front;
  edge = 1.0 - smoothstep(0.0, 0.0022, dE);
  wet = smoothstep(0.04, 0.18, dM / hH) * (1.0 - smoothstep(0.3, 0.7, dM / hH));   // a moist band just off the meeting line (at the line itself a highlight read as a pale seam)
  roll = exp(-pow((-dE - 0.00045) / 0.00045, 2.0)) * front * smoothstep(0.95, 0.6, ax / likeLipK.x) * mix(0.6, 1.0, up); }
`;
const LIPG_IN = `      float inL = smoothstep(1.05, 0.92, abs(x)) * smoothstep(top + 0.0011, top - 0.0006, yu) * smoothstep(bot - 0.0011, bot + 0.0006, yu) * step(hMouth.z - 0.02, b.z);
      float edge = 1.0 - smoothstep(0.25, 0.85, min(abs(yu - top), abs(yu - bot)) / 0.004);
      lip = inL; mm *= mix(1.0, mix(0.75, 1.0 + 0.6 * lipTone, edge * 0.8 + 0.2), lip); hm *= mix(1.0, `;
const LIPG_OUT = `      float inL, edge, wet, roll; likeLipGeo(b, inL, edge, wet, roll); likeLipWet = wet * inL; likeLipEdge = edge * inL;
      lip = inL; mm *= mix(1.0, mix(1.08 - 0.06 * wet, 1.22 + likeLipP.y * lipTone, edge), lip) * (1.0 - 0.15 * likeLipP.z * (1.0 - lipTone) * roll);
      hm *= (1.0 - 0.3 * likeLipP.z * (1.0 - lipTone) * roll) * mix(1.0, likeLipP.x * mix(0.8, 1.12, wet) * `;
const LIPG_R_IN = ' - 0.12 * lip;', LIPG_R_OUT = ' - 0.12 * lip - likeLipP.w * likeLipWet + 0.04 * likeLipEdge;';
export function lipLineFrag(frag, rev7 = false) {
  let ok = frag.includes(LIPG_IN) && frag.includes(LIPG_R_IN);
  if (ok && rev7) ok = frag.includes('likeLipWetV = 0.5;');
  return { ok, frag: ok ? (t => rev7 ? t.replace('likeLipWetV = 0.5;', 'likeLipWetV = wet * lip;') : t)(frag.replace(LIPG_IN, LIPG_OUT).replace(LIPG_R_IN, LIPG_R_OUT)) : frag };
}
export function useLipLine(h, lines, paint = {}) {
  const L = [].concat(h.o.skinHook || []), i = L.findIndex(x => x && (x.key === 'likeness-skin1' || x.key === 'likeness-skin4' || x.key === 'likeness-skin6' || x.key === 'likeness-skin7'));
  if (i < 0 || !lines?.rows?.length) { console.warn('likeness/skin useLipLine: no lane B skin hook on this hero (applySkin first); the vermilion stays lane B\'s'); return null; }
  const e = L[i], r = lipLineFrag(e.frag, e.key === 'likeness-skin7');
  if (!r.ok) { console.warn('likeness/skin useLipLine: lane B lip text not found; the vermilion stays lane B\'s'); return null; }
  const rows = lines.rows.slice(0, LIPG_N); while (rows.length < LIPG_N) rows.push(rows[rows.length - 1]);
  const U = { likeLipG: { value: rows.map(q => new THREE.Vector4(...q)) }, likeLipK: { value: new THREE.Vector4(lines.half, lines.z, paint.soft ?? 0.0003, lines.center ?? 0) },
    likeLipP: { value: new THREE.Vector4(paint.blood ?? 1, paint.edge ?? 0.35, e.key === 'likeness-skin7' ? 0 : paint.roll ?? 0.5, paint.wet ?? 0.1) } };   // (rev 7, iteration 9: no painted roll; the white roll is the border's form (NOSEMOUTH's), lit, and the vermilion's melanin is its own column's)
  L[i] = { ...e, key: e.key + '-lipg1', uniforms: { ...(e.uniforms || {}), ...U }, fragPars: (e.fragPars || '') + '\n' + LIPG_PARS, frag: r.frag };
  h.o.skinHook = L.length === 1 ? L[0] : L; Object.assign(h.skinU, U); h.body.material.needsUpdate = true;
  if (h.likeness?.skin) h.likeness.skin.lipLine = { U, lines };
  return { U, key: L[i].key };
}
