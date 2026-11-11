// LIKENESS / eyes: eyes built as the organs they are, for a built hero.js person, from OUTSIDE (HUMAN c8, lane B). Opt-in.
//
//   import { buildEyes, EYE_PRESETS } from '../lib/fx/likeness/eyes.js';
//   const E = buildEyes(h, { iris: 'brown', pupil: 1.8, age: 0.4 });   // hides h.eyes, adds h.likeness.eyes.mesh (one SkinnedMesh, both eyes)
//   E.set({ pupil: 2.4 });                                             // live (uniforms)
//
// After Jimenez's practice for real-time eyes ("Next-generation character rendering", GDC 2013; Jimenez, Danvoye and von der Pahlen,
// "Practical real-time eye rendering", 2012):
//  - the GLOBE fitted to the bind mesh: hero.js's eye is a ~31 x 30 x 25 mm shell whose c7 shader drew the iris from the vertex
//    CENTROID, which sits ~5 mm in front of the true centre, so the iris came out ~3.3 mm in radius instead of 5.85 (an 11.7 mm
//    iris; Rüfer et al. 2005 white-to-white 11.7 +- 0.5 mm): the white above and below every iris, the startled stare. Here a
//    sphere is fitted to the shell's front cap (12.7-13.9 mm for CREW8, where the lids were modelled round it) and the eye is
//    rebuilt on it, set back `inset` mm so the corneal bulge stays under the lids. Measured from the front, the CREW8 lids then
//    cover 2-3 mm of the iris top and 0.4-0.8 mm of its bottom (a relaxed adult eye: the upper lid over 1-2 mm of iris, the lower
//    at the limbus), so the fissure needs no change.
//  - a CORNEA in the geometry: a 7.8 mm radius cap (Gullstrand) meeting the globe at the limbus, so the profile shows its bulge.
//  - the IRIS seen THROUGH it: the view ray is refracted at the cornea (n 1.376) and intersected with the iris plane ~3 mm
//    behind the apex (anterior chamber depth), so the iris parallaxes and magnifies as a real one does; radial stroma fibres,
//    crypts, the collarette, contraction furrows, a pupillary ruff, the LIMBAL RING, an optional arcus with age; colours per
//    person (brown in all its depth is the world's common iris; hazel, green, grey and blue for some).
//  - the SCLERA: not white (0.55-0.6, a little warm), faint vessels thickest toward the canthi, age yellowing; WET: the clearcoat
//    is the tear film (roughness 0.03), so the key and the sky give a real catchlight on the cornea and a sheen on the sclera.
//  - the LIDS on the eye: their shadow and occlusion from the measured fissure (the edge of the skin in front of the globe, per
//    angle round the axis), deepest under the upper lid; the TEAR MENISCUS on the lower lid margin (a wet strip whose concave
//    surface tips its highlight upward); the CARUNCLE and plica at the inner corner, pink and moist.
// Lashes are lane D's (web/lib/fx/hair/); the upper-lid shadow here stands in for theirs until they land.
import * as THREE from 'three';
import { buildEye7 } from '../face/eye/engine.js';

export const IRIS = {   // linear RGB: stroma base, lighter fibres, the pupillary zone (collarette inward), limbal ring
  darkBrown: { base: [0.022, 0.011, 0.006], fibre: [0.05, 0.026, 0.012], center: [0.06, 0.03, 0.012], limbus: [0.008, 0.005, 0.004] },
  brown: { base: [0.045, 0.022, 0.009], fibre: [0.1, 0.052, 0.02], center: [0.12, 0.062, 0.02], limbus: [0.012, 0.008, 0.006] },
  hazel: { base: [0.06, 0.05, 0.02], fibre: [0.12, 0.1, 0.045], center: [0.16, 0.08, 0.025], limbus: [0.02, 0.02, 0.014] },
  green: { base: [0.05, 0.07, 0.04], fibre: [0.11, 0.14, 0.08], center: [0.14, 0.1, 0.04], limbus: [0.02, 0.026, 0.02] },
  grey: { base: [0.11, 0.12, 0.13], fibre: [0.24, 0.26, 0.27], center: [0.15, 0.12, 0.08], limbus: [0.03, 0.035, 0.04] },
  blue: { base: [0.07, 0.11, 0.17], fibre: [0.2, 0.27, 0.34], center: [0.12, 0.13, 0.12], limbus: [0.02, 0.03, 0.045] },
};
export const EYE_PRESETS = { Ada: 'darkBrown', Walt: 'grey', Rosa: 'brown', Otis: 'darkBrown', Kai: 'darkBrown', June: 'hazel', Ray: 'brown', Mei: 'darkBrown' };

// ---------------------------------------------------------------- fitting
function fitSphere(P) {
  const A = Array.from({ length: 4 }, () => new Float64Array(5));
  for (const p of P) { const a = [2 * p[0], 2 * p[1], 2 * p[2], 1], b = p[0] ** 2 + p[1] ** 2 + p[2] ** 2; for (let r = 0; r < 4; r++) { A[r][4] += a[r] * b; for (let c = 0; c < 4; c++) A[r][c] += a[r] * a[c]; } }
  for (let i = 0; i < 4; i++) { let p = i; for (let j = i + 1; j < 4; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j; [A[i], A[p]] = [A[p], A[i]];
    for (let j = 0; j < 4; j++) if (j !== i) { const f = A[j][i] / A[i][i]; for (let k = i; k < 5; k++) A[j][k] -= f * A[i][k]; } }
  const x = [0, 1, 2, 3].map(i => A[i][4] / A[i][i]); return { c: new THREE.Vector3(x[0], x[1], x[2]), r: Math.sqrt(x[3] + x[0] ** 2 + x[1] ** 2 + x[2] ** 2) };
}
// the globe of each eye from hero.js's eye shell (the outer component's front cap), and the fissure as seen from the front
// FACE7 it 4 (face rev 8, opt-in: o.globeR, metres): the globe resized to the anatomical eye with the corneal apex kept (the cornea, the iris and
// the lids' cover of them unchanged): hm08's shell fits a 13.6-14 mm front cap, a real globe's sclera ~12 mm (axial length 23-24 mm), and the
// oversized sphere's lateral and lower sclera stood in front of the lid skin round the canthi (L08's grey-green hooks in Cycles). The
// fissure is then read against the resized globe. Without o.globeR nothing changes.
export function fitEyes(h, o = {}) {
  const g = h.eyes.geometry, P = g.attributes.position.array, I = g.index.array, n = P.length / 3;
  const par = Int32Array.from({ length: n }, (_, i) => i), f = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  for (let t = 0; t < I.length; t += 3) { const a = f(I[t]), b = f(I[t + 1]), c = f(I[t + 2]); par[b] = a; par[f(c)] = a; }
  const comps = new Map(); for (let i = 0; i < n; i++) { const k = f(i); if (!comps.has(k)) comps.set(k, []); comps.get(k).push(i); }
  const out = [];
  for (const side of [1, -1]) {
    const cs = [...comps.values()].filter(vs => Math.sign(P[vs[0] * 3]) === side);
    const zmaxOf = vs => Math.max(...vs.map(i => P[i * 3 + 2])), outer = cs.sort((a, b) => zmaxOf(b) - zmaxOf(a))[0], zmax = zmaxOf(outer);
    const s = fitSphere(outer.filter(i => P[i * 3 + 2] > zmax - 0.006).map(i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]));
    if (o.globeR) { const rl = o.rl ?? 0.006, k = rr => rr * Math.cos(Math.asin(Math.min(0.99, rl / rr))), c = s.c.clone(); c.z += k(s.r) - k(o.globeR);
      out.push({ side, c, r: o.globeR, apex: zmax, rFit: s.r }); continue; }
    out.push({ side, c: s.c, r: s.r, apex: zmax });
  }
  // fissure: for 36 angles round the axis (0 temporal, 9 up, 18 nasal, 27 down), the radius at which skin first lies in front of the globe
  const B = h.body.geometry.attributes.position.array, BI = h.body.geometry.index.array, AH = h.aHero;
  for (const e of out) { const bins = new Float32Array(36).fill(0.016), { c, r } = e;
    for (let t = 0; t < BI.length; t += 3) { const a = BI[t], b = BI[t + 1], cc = BI[t + 2]; if (AH[a * 4] !== 0 && AH[a * 4] !== 11) continue;
      if (Math.hypot(B[a * 3] - c.x, B[a * 3 + 1] - c.y) > 0.022 || B[a * 3 + 2] < c.z) continue;
      for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5 - i; j++) { const u = i / 5, v = j / 5, w = 1 - u - v;
        const x = B[a * 3] * u + B[b * 3] * v + B[cc * 3] * w, y = B[a * 3 + 1] * u + B[b * 3 + 1] * v + B[cc * 3 + 1] * w, z = B[a * 3 + 2] * u + B[b * 3 + 2] * v + B[cc * 3 + 2] * w;
        const dx = x - c.x, dy = y - c.y, rho = Math.hypot(dx, dy); if (rho >= r) continue; if (z < c.z + Math.sqrt(r * r - rho * rho) - 0.0003) continue;
        const al = Math.atan2(dy, dx * e.side), k = ((Math.round(al / (Math.PI * 2) * 36) % 36) + 36) % 36; if (rho < bins[k]) bins[k] = rho; } }
    e.fissure = bins; }
  return out;
}

// ---------------------------------------------------------------- geometry: globe + corneal cap, both eyes in one mesh
function eyeGeometry(eyes, { rc = 0.0078, rl = 0.006, inset = 0.0004, nT = 56, nP = 72, head = 0 }) {
  const pos = [], loc = [], nrm = [], idx = [], si = [], sw = [];
  let base = 0;
  for (const e of eyes) {
    const r = e.r, thL = Math.asin(Math.min(0.99, rl / r)), zcc = r * Math.cos(thL) - Math.sqrt(rc * rc - rl * rl);
    e.thL = thL; e.zcc = zcc; e.zApex = zcc + rc; e.rc = rc; e.rl = rl; e.inset = inset;
    for (let i = 0; i <= nT; i++) { const th = (i / nT) ** 1.35 * 2.6;                                       // dense at the front, to ~150 degrees
      for (let j = 0; j <= nP; j++) { const ph = j / nP * Math.PI * 2, d = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
        // radius along d: the corneal sphere in front of the limbus, the globe behind, blended over ~1.2 degrees each side
        const tc = zcc * d[2] + Math.sqrt(Math.max(0, rc * rc - zcc * zcc * (1 - d[2] * d[2]))), k = THREE.MathUtils.smoothstep(th, thL - 0.02, thL + 0.02);
        const R = tc * (1 - k) + r * k, p = [d[0] * R, d[1] * R, d[2] * R - inset];
        const nc = [d[0] * R, d[1] * R, d[2] * R - zcc], ln = Math.hypot(...nc), nn = [0, 1, 2].map(q => nc[q] / ln * (1 - k) + d[q] * k), l2 = Math.hypot(...nn);
        pos.push(e.c.x + p[0], e.c.y + p[1], e.c.z + p[2]); loc.push(p[0], p[1], p[2], e.side); nrm.push(nn[0] / l2, nn[1] / l2, nn[2] / l2); si.push(head, 0, 0, 0); sw.push(1, 0, 0, 0); } }
    for (let i = 0; i < nT; i++) for (let j = 0; j < nP; j++) { const a = base + i * (nP + 1) + j, b = a + nP + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    base += (nT + 1) * (nP + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aEyeL', new THREE.Float32BufferAttribute(loc, 4));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx); return g;
}

const VERT_PARS = `attribute vec4 aEyeL; varying vec4 vEL; varying vec3 vAxV, vUpV;`;
const VERT_NRM = `
#ifdef USE_SKINNING
vAxV = normalize(normalMatrix * (skinMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz); vUpV = normalize(normalMatrix * (skinMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
#else
vAxV = normalize(normalMatrix * vec3(0.0, 0.0, 1.0)); vUpV = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
#endif
vEL = aEyeL;`;
const FRAG_PARS = `varying vec4 vEL; varying vec3 vAxV, vUpV;
uniform vec3 eCam0, eCam1; uniform vec4 eGeo0, eGeo1;      // camera in each eye's local frame; (rc, zcc, zIris, rIris)
uniform vec3 eBase, eFibre, eCenter, eLimbus; uniform vec4 eK;   // pupil (m), age, vessels, seed
uniform vec4 eK2;                                                    // occlusion strength, meniscus, caruncle, sclera tint
uniform float eFis0[36]; uniform float eFis1[36];
float eH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float eN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(eH(i), eH(i + vec2(1, 0)), f.x), mix(eH(i + vec2(0, 1)), eH(i + vec2(1, 1)), f.x), f.y); }
float eF(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * eN(p); p *= 2.07; a *= 0.5; } return s; }
float eFis(float side, float al){ float u = mod(al / 6.2831853 * 36.0 + 36.0, 36.0); int i0 = int(floor(u)); int i1 = i0 == 35 ? 0 : i0 + 1; float f = fract(u);
  float a = 0.0, b = 0.0; for (int k = 0; k < 36; k++) { float v = side > 0.0 ? eFis0[k] : eFis1[k]; if (k == i0) a = v; if (k == i1) b = v; } return mix(a, b, f); }
float eIrisZone = 0.0, eOcc = 1.0, eMen = 0.0; vec3 eIrisN = vec3(0.0);
`;
// albedo, roughness and zones (at roughnessmap_fragment): local frame, the refracted ray onto the iris plane
const FRAG = `
{ vec3 p = vEL.xyz; float side = vEL.w; bool L = side > 0.0; vec4 G = L ? eGeo0 : eGeo1; vec3 cam = L ? eCam0 : eCam1;
  float rc = G.x, zcc = G.y, zI = G.z, rI = G.w, rho = length(p.xy), al = atan(p.y, p.x * side);
  float age = eK.y, seed = eK.w;
  // sclera: warm off-white, darker and pinker toward the back, vessels toward the canthi, yellowing with age
  vec3 scl = vec3(0.6, 0.56, 0.52) * eK2.w; scl = mix(scl, vec3(0.62, 0.55, 0.38), 0.25 * age * smoothstep(0.5, 0.9, abs(cos(al))) * smoothstep(0.004, 0.009, rho));
  float th = atan(rho, p.z + 0.0004);
  scl = mix(scl, vec3(0.5, 0.3, 0.28), 0.5 * smoothstep(0.9, 1.6, th));
  { vec2 q = vec2(al * 9.0, th * 30.0); float v1 = 1.0 - abs(2.0 * eF(q + seed) - 1.0), v2 = 1.0 - abs(2.0 * eF(q * 2.3 + seed + 7.0) - 1.0);
    float vm = (smoothstep(0.93, 0.985, v1) + 0.6 * smoothstep(0.95, 0.99, v2)) * smoothstep(0.55, 0.85, th) * (0.35 + 0.65 * abs(cos(al))) * eK.z;
    scl = mix(scl, vec3(0.5, 0.12, 0.1), clamp(vm, 0.0, 1.0) * 0.7); }
  vec3 col = scl; float rough = 0.32; eIrisZone = 0.0;
  float thC = atan(rho, p.z);
  if (rho < rI + 0.0006 && p.z > 0.0) {
    // refract the view ray at the cornea and land it on the iris plane (anterior chamber depth ~3 mm behind the apex)
    vec3 Nc = normalize(p - vec3(0.0, 0.0, zcc)), d = normalize(p - cam), t = refract(d, Nc, 1.0 / 1.376);
    float s = (zI - p.z) / min(t.z, -1e-4); vec2 q = p.xy + t.xy * s; float r = length(q) / rI, a = atan(q.y, q.x * side);
    float pu = eK.x / rI;
    vec3 ir = eBase;
    float fib = eF(vec2(a * 24.0, r * 3.0) + seed) * 0.6 + eF(vec2(a * 70.0, r * 6.0) + seed * 2.0) * 0.4;
    ir = mix(ir, eFibre, smoothstep(0.35, 0.75, fib));
    float coll = 0.38 + 0.05 * sin(a * 11.0 + seed) + 0.03 * (eN(vec2(a * 30.0, seed)) - 0.5);
    ir = mix(eCenter * (0.8 + 0.4 * fib), ir, smoothstep(coll - 0.04, coll + 0.04, r));
    ir *= 1.0 - 0.35 * smoothstep(0.03, 0.0, abs(r - coll)) ;                                  // the collarette's ridge shadow
    { vec2 cq = vec2(a * 14.0, r * 9.0); float cr = smoothstep(0.62, 0.8, eN(cq + seed * 3.0)) * smoothstep(0.4, 0.5, r) * smoothstep(0.85, 0.7, r); ir *= 1.0 - 0.45 * cr; }   // crypts
    ir *= 1.0 - 0.18 * smoothstep(0.6, 1.0, sin(r * 70.0) * 0.5 + 0.5) * smoothstep(0.72, 0.85, r);   // contraction furrows
    ir = mix(ir, eLimbus, smoothstep(0.84, 0.99, r));                                          // the limbal ring
    ir = mix(ir, vec3(0.25, 0.25, 0.24), smoothstep(0.86, 0.92, r) * smoothstep(0.995, 0.96, r) * smoothstep(0.55, 0.85, age) * 0.6);   // arcus with age
    ir = mix(ir, eLimbus * 0.7, smoothstep(pu + 0.05, pu + 0.01, r));                          // pupillary ruff
    float pupil = smoothstep(pu + 0.008, pu - 0.008, r);
    ir = mix(ir, vec3(0.003, 0.0025, 0.0025), pupil);
    float inI = smoothstep(1.04, 0.99, r);                                                       // beyond the iris root the ray meets sclera
    col = mix(scl * 0.85, ir, inI); rough = mix(0.32, 0.6, inI);
    float lim = smoothstep(rI + 0.0006, rI - 0.0002, rho);                                     // the cornea fades into the limbus
    col = mix(scl, col, lim);
    eIrisZone = lim * inI * (1.0 - pupil);
  }
  // occlusion by the lids (measured fissure), deeper under the upper lid; the tear meniscus on the lower lid; the caruncle
  float edge = eFis(side, al), dist = edge - rho, up = smoothstep(-0.3, 0.6, sin(al));
  eOcc = mix(1.0 - 0.55 * eK2.x, 1.0, smoothstep(-0.0003, 0.0022 + 0.0012 * up, dist));
  eOcc *= 1.0 - eK2.x * 0.35 * up * exp(-max(dist, 0.0) / 0.0014);
  float low = smoothstep(0.2, -0.5, sin(al));
  eMen = eK2.y * low * smoothstep(0.0, 0.00015, dist) * smoothstep(0.0006, 0.0002, dist);
  col = mix(col, vec3(0.6, 0.42, 0.4), 0.5 * eMen);
  float nas = smoothstep(-0.75, -0.95, cos(al)) * smoothstep(0.0028, 0.0, dist) * smoothstep(0.006, 0.009, rho) * eK2.z;
  col = mix(col, vec3(0.55, 0.22, 0.2) * (0.8 + 0.3 * eN(p.xy * 3000.0)), nas); rough = mix(rough, 0.35, nas);
  diffuseColor.rgb = col; roughnessFactor = rough;
}`;

// FACE3 (round 3, opt-in `wet`): the globe's falloff toward the corners (the eye is a ball under the lids, not a flat white), a wider
// soft occlusion under the upper lid and its lashes, the caruncle's pink spreading onto the plica
const WET_SCL = `  scl *= mix(1.0, 0.7, smoothstep(0.32, 0.95, th)) * mix(1.0, 0.88, smoothstep(0.55, 0.95, abs(cos(al))) * smoothstep(0.4, 0.8, th));\n`;
const WET_OCC = `  eOcc *= 1.0 - eW.x * 0.3 * up * exp(-max(dist, 0.0) / 0.0028); eOcc *= 1.0 - eW.x * 0.12 * exp(-max(dist, 0.0) / 0.0012);\n`;
const NORMAL = `
{ vec3 ax = normalize(vAxV); eIrisN = normalize(mix(normal, ax, 0.75)); normal = normalize(mix(normal, eIrisN, eIrisZone)); }`;
const CC_NORMAL = `
#ifdef USE_CLEARCOAT
clearcoatNormal = normalize(clearcoatNormal + normalize(vUpV) * 0.6 * eMen);
#endif`;
const LIGHT_END = `
reflectedLight.directDiffuse *= mix(1.0, eOcc, 0.6); reflectedLight.indirectDiffuse *= eOcc; reflectedLight.indirectSpecular *= eOcc;
#ifdef USE_CLEARCOAT
clearcoatSpecularIndirect *= mix(1.0, eOcc, 0.85); clearcoatSpecularDirect *= mix(1.0, eOcc, 0.4);
#endif`;

// SKIN4 (round 4, opt-in `rev: 4`): the eye's whites as a photograph shows them. Measured (review/.../skin4/tools/eye_measure.py, the same
// MediaPipe read on the ten HSRD-100 front renders and on v3's 1:1 faces): the iris over the eye's width is the scans' (0.42-0.43 both),
// the visible sclera's share 0.40-0.54 on v3 (scanned heads the most) against the scans' 0.38 (FACE4's lid), and the sclera's lit value
// over the cheek's up to 2-4x the scans' on the deep-skinned v3 heads. So: the sclera's albedo ~0.41 linear (sRGB value ~0.7; lane B
// 0.6), warmer (R/B ~1.35; the scans' whites read R/B 1.87 against v3's 1.35), shading to pink at the nasal corner and to a yellowish grey at the temporal one and toward the back; the
// vessels a little denser toward the canthi; a soft dark LIMBAL ring straddling the limbus (the grey band a photograph shows round
// every iris); a larger, pinker caruncle; the upper lid's (and lashes') shadow deeper and wider. FACE3's `wet` path composes with it.
const REV4_FRAG = [
  ['  vec3 scl = vec3(0.6, 0.56, 0.52) * eK2.w;', '  vec3 scl = vec3(0.45, 0.40, 0.335) * eK2.w;'],
  ['  scl = mix(scl, vec3(0.5, 0.3, 0.28), 0.5 * smoothstep(0.9, 1.6, th));',
   `  scl = mix(scl, vec3(0.5, 0.3, 0.28), 0.5 * smoothstep(0.9, 1.6, th));
  { float cN = smoothstep(-0.3, -0.95, cos(al)), cT = smoothstep(0.3, 0.95, cos(al)), far = smoothstep(0.35, 0.9, th);
    scl = mix(scl, vec3(0.41, 0.28, 0.25), 0.55 * cN * far); scl = mix(scl, vec3(0.40, 0.34, 0.26), 0.45 * cT * far); scl *= 1.0 - 0.18 * far; }`],
  ['    scl = mix(scl, vec3(0.5, 0.12, 0.1), clamp(vm, 0.0, 1.0) * 0.7); }', '    scl = mix(scl, vec3(0.42, 0.11, 0.09), clamp(vm * 1.25, 0.0, 1.0) * 0.75); }'],
  ['    eIrisZone = lim * inI * (1.0 - pupil);\n  }', '    eIrisZone = lim * inI * (1.0 - pupil);\n  }\n  col *= 1.0 - 0.38 * exp(-pow((rho - rI) / 0.00065, 2.0)) * step(0.0, p.z);   // the limbal ring, soft, over both sides of the limbus'],
  ['  float nas = smoothstep(-0.75, -0.95, cos(al)) * smoothstep(0.0028, 0.0, dist) * smoothstep(0.006, 0.009, rho) * eK2.z;\n  col = mix(col, vec3(0.55, 0.22, 0.2) * (0.8 + 0.3 * eN(p.xy * 3000.0)), nas);',
   '  float nas = smoothstep(-0.7, -0.93, cos(al)) * smoothstep(0.0036, 0.0, dist) * smoothstep(0.0058, 0.0088, rho) * eK2.z;\n  col = mix(col, vec3(0.58, 0.27, 0.25) * (0.8 + 0.3 * eN(p.xy * 3000.0)), nas);'],
];
const REV4_OCC = `  eOcc *= 1.0 - 0.22 * up * exp(-max(dist, 0.0) / 0.0026);   // rev 4: the lashes' shadow, wider\n`;
// FACE7 (round 7, face rev 8; opt-in `f7`: buildEyes(h, { f7: { irisSpec, ccEnv, sclera, pink, caruncle } }), face/face7.js passes it). Measured
// against the c3 photographs (after/face7/tools/face7_measure.py, the same MediaPipe read on both): the sclera reads 15-35 L* brighter
// against the person's own cheek than the photos' whites (sclera - cheek L* -26 on them; ours -1 to +12) and less pink (a* 2-5 against
// 8-10); the iris is seen through the cornea, so it has no specular lobe of its own (the base layer's rough lobe laid a grey veil of the
// stage over the dark irises); the tear film's reflection of the stage (three's clearcoat F0 0.04 is ~2x a tear film's 0.022) halved,
// the key's catchlight (FACE5's analytic disc) kept. f7E = (sclera albedo x, pink 0..1, the iris' specular removed 0..1, the coat's
// environment share).
const F7_SCL = `  scl *= f7E.x; scl *= mix(vec3(1.0), vec3(1.07, 0.93, 0.91), f7E.y);\n`;
const F7_SPEC = `
material.specularColor *= 1.0 - f7E.z * eIrisZone; material.specularF90 *= 1.0 - f7E.z * eIrisZone;`;
const F7_CC = `
#ifdef USE_CLEARCOAT
clearcoatSpecularIndirect *= f7E.w;
#endif`;
// (FACE7 c7 it 19) once the eyes are drawn, the skin round them takes its visibility (face/cavity7.js, through face7Skin's h.face7.cavityRun)
export function buildEyes(h, o = {}) {
  const E = buildEyes1(h, o);
  if (h.face7?.cavityRun) { try { h.face7.report.cavity = h.face7.cavityRun(); } catch (e) { h.face7.report.cavity = 'cavity7: ' + (e.stack || e.message || e); } }
  return E;
}
function buildEyes1(h, o = {}) {
  if (o.eye7) return buildEye7(h, o, { fitEyes, wetParts, IRIS });   // EYES (EYE7_VERSION 3, opt-in): the engine eye from the eye7 record and maps
  const rev4 =(o.rev ?? 0) >= 4, f7 = o.f7 && typeof o.f7 === 'object' ? o.f7 : o.f7 ? {} : null;
  const opt = { iris: EYE_PRESETS[o.name] || 'brown', pupil: 1.8, age: h.o.age ?? 0.3, vessels: rev4 ? 0.75 : 0.6, occlusion: rev4 ? 1.2 : 1, meniscus: 1, caruncle: 1, sclera: 1, inset: 0.4, tearF0: 0.6, ...o };
  const eyes = o.globe7?.r ? fitEyes(h, { globeR: o.globe7.r / 1000 }) : fitEyes(h);   // (FACE7 it 4: the anatomical globe; face/face7.js face7Eyes)
  const head = h.idx.head;
  const g = eyeGeometry(eyes, { inset: opt.inset / 1000, head });
  const ic = typeof opt.iris === 'string' ? IRIS[opt.iris] : opt.iris;
  const U = {
    eCam0: { value: new THREE.Vector3() }, eCam1: { value: new THREE.Vector3() },
    eGeo0: { value: new THREE.Vector4() }, eGeo1: { value: new THREE.Vector4() },
    eBase: { value: new THREE.Vector3(...ic.base) }, eFibre: { value: new THREE.Vector3(...ic.fibre) }, eCenter: { value: new THREE.Vector3(...ic.center) }, eLimbus: { value: new THREE.Vector3(...ic.limbus) },
    eK: { value: new THREE.Vector4(opt.pupil / 1000, opt.age, opt.vessels, (h.o.seed || 7) * 0.37 % 10) }, eK2: { value: new THREE.Vector4(opt.occlusion, opt.meniscus, opt.caruncle, opt.sclera) },
    eFis0: { value: Array.from(eyes[0].fissure) }, eFis1: { value: Array.from(eyes[1].fissure) },
  };
  eyes.forEach((e, k) => U['eGeo' + k].value.set(e.rc, e.zcc - e.inset, e.zcc + e.rc - e.inset - 0.003, 0.00585));
  const W = opt.wet ? { occ: 1, tear: 1, meniscus: true, caruncle: true, ...(typeof opt.wet === 'object' ? opt.wet : {}) } : null;
  if (W) U.eW = { value: new THREE.Vector4(W.occ, 0, 0, 0) };
  if (f7) U.f7E = { value: new THREE.Vector4(f7.sclera ?? 0.78, f7.pink ?? 1, 1 - (f7.irisSpec ?? 0), f7.ccEnv ?? 0.45) };
  if (f7 && W && f7.caruncle) W.car7 = f7.caruncle;
  let frag = W ? FRAG.replace('  float th = atan(rho, p.z + 0.0004);\n', '  float th = atan(rho, p.z + 0.0004);\n' + WET_SCL).replace('  float low = smoothstep(0.2, -0.5, sin(al));\n', WET_OCC + '  float low = smoothstep(0.2, -0.5, sin(al));\n') : FRAG;
  if (rev4) { for (const [a, b] of REV4_FRAG) { if (!frag.includes(a)) console.warn('likeness/eyes rev 4: anchor not found: ' + a.slice(0, 60)); frag = frag.replace(a, b); }
    frag = frag.replace('  float low = smoothstep(0.2, -0.5, sin(al));\n', REV4_OCC + '  float low = smoothstep(0.2, -0.5, sin(al));\n'); }
  if (f7) frag = frag.replace('  float th = atan(rho, p.z + 0.0004);\n', '  float th = atan(rho, p.z + 0.0004);\n' + F7_SCL);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.35, ior: 1.376, specularIntensity: W ? 0.5 : 0.35, clearcoat: W ? Math.max(opt.tearF0, W.tear) : opt.tearF0, clearcoatRoughness: W ? 0.02 : 0.03 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <skinnormal_vertex>', '#include <skinnormal_vertex>\n' + VERT_NRM);
    if (f7) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + F7_SPEC);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS + (W ? 'uniform vec4 eW;\n' : '') + (f7 ? 'uniform vec4 f7E;\n' : ''))
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + frag)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + NORMAL)
      .replace('#include <clearcoat_normal_fragment_begin>', '#include <clearcoat_normal_fragment_begin>\n' + CC_NORMAL)
      .replace('#include <aomap_fragment>', LIGHT_END + (f7 ? F7_CC : '') + '\n#include <aomap_fragment>');
  };
  mat.customProgramCacheKey = () => 'likeness-eye1' + (W ? '-wet' : '') + (rev4 ? '-rev4' : '') + (f7 ? '-f7' : '');
  const mesh = new THREE.SkinnedMesh(g, mat); mesh.frustumCulled = false; mesh.bind(h.skeleton, new THREE.Matrix4());
  mesh.userData.subject = 1; mesh.userData.part = 'eye'; mesh.castShadow = false; mesh.receiveShadow = true;
  // the camera in each eye's local frame, every render (the LitRenderer moves the camera per sub-frame for the aperture)
  const Mh = new THREE.Matrix4(), Mi = new THREE.Matrix4(), cw = new THREE.Vector3();
  mesh.onBeforeRender = (r, s, cam) => {
    const B = h.skeleton.bones[head]; Mh.multiplyMatrices(B.matrixWorld, h.skeleton.boneInverses[head]); Mi.copy(Mh).invert();
    cw.setFromMatrixPosition(cam.matrixWorld).applyMatrix4(Mi);
    eyes.forEach((e, k) => U['eCam' + k].value.set(cw.x - e.c.x, cw.y - e.c.y, cw.z - e.c.z + e.inset));
  };
  // eGeo: rc, the corneal centre's z in the local frame (after the inset), the iris plane z (3 mm behind the apex), the iris radius
  if (h.eyes) h.eyes.visible = false;
  h.group.add(mesh); h.meshes.push(mesh);
  const set = (q = {}) => { Object.assign(opt, q); const c = typeof opt.iris === 'string' ? IRIS[opt.iris] : opt.iris;
    U.eBase.value.set(...c.base); U.eFibre.value.set(...c.fibre); U.eCenter.value.set(...c.center); U.eLimbus.value.set(...c.limbus);
    U.eK.value.set(opt.pupil / 1000, opt.age, opt.vessels, U.eK.value.w); U.eK2.value.set(opt.occlusion, opt.meniscus, opt.caruncle, opt.sclera); };
  const extra = W ? wetParts(h, eyes, W, head) : [];
  if (opt.f5) face5Eyes(mat, extra, U, opt.f5);   // FACE5 (face rev 6, opt-in): the catchlight, the tear line, the caruncle wetter
  const E = { mesh, U, eyes, set, opt, extra, rev: rev4 ? 4 : 1, ...(f7 ? { f7 } : {}), off: () => { mesh.visible = false; for (const m of extra) m.visible = false; if (h.eyes) h.eyes.visible = true; } };
  h.likeness = { ...(h.likeness || {}), eyes: E };
  return E;
}

// ---------------------------------------------------------------- FACE3 (round 3): the wet parts, opt-in (buildEyes(h, { wet: {...} }))
// W: { canthus: { L: [x,y,z], R }, lidsLower: { L: [[x,y,z]...nasal->temporal], R } (bind space; face/face3.js gives both from the
// landmarks' lid-margin loops), occ, tear, meniscus, caruncle }. Both meshes ride the head bone like the globe.
//  - the TEAR MENISCUS: the fillet of tear fluid where the lower lid margin meets the globe, 0.2-0.4 mm tall (tear meniscus height
//    in healthy adults ~0.2-0.3 mm by OCT); its concave surface faces up and out, so it shows as a thin bright line along the lid.
//  - the CARUNCLE: the small pink, moist mound at the inner corner (~3 x 4 mm), standing a little proud of the globe.
function wetParts(h, eyes, W, head) {
  const out = [], mk = (pos, nrm, idx, mat, part) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    const n = pos.length / 3; g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? head : 0)), 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4)); g.setIndex(idx);
    const m = new THREE.SkinnedMesh(g, mat); m.frustumCulled = false; m.bind(h.skeleton, new THREE.Matrix4()); m.userData.subject = 1; m.userData.part = part; m.castShadow = false; m.receiveShadow = true; h.group.add(m); h.meshes.push(m); out.push(m); return m; };
  const eyeOf = x => eyes.find(e => Math.sign(x) === e.side) || eyes[0];
  const onGlobe = (e, x, y) => { const dx = x - e.c.x, dy = y - e.c.y, r = e.r; return e.c.z + Math.sqrt(Math.max(0, r * r - dx * dx - dy * dy)) - (e.inset || 0); };
  if (W.meniscus && W.lidsLower) { const pos = [], nrm = [], idx = [];
    for (const s of ['L', 'R']) { const L = W.lidsLower[s]; if (!L || L.length < 3) continue; const base = pos.length / 3, e = eyeOf(L[0][0]), m = L.length;
      for (let i = 0; i < m; i++) { const q = L[i], t = i / (m - 1), taper = Math.sin(Math.PI * Math.min(1, 0.08 + 0.92 * t)) ** 0.5;
        const zg = onGlobe(e, q[0], q[1] + 0.0003), hgt = 0.00022 * taper;
        // two rows: on the lid margin (a hair in front of the globe), and up on the globe; the normal turns from up-and-out to out
        pos.push(q[0], q[1] - 0.0001, Math.max(zg + 0.00012, q[2] - 0.0006)); nrm.push(0, 0.5, 0.87);
        pos.push(q[0], q[1] + hgt, zg + 0.00006); nrm.push(0, 0.2, 0.98); }
      for (let i = 0; i < m - 1; i++) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }
    if (idx.length) { const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setRGB(0.26, 0.17, 0.16, THREE.LinearSRGBColorSpace), roughness: 0.3, ior: 1.336, specularIntensity: 0.6, clearcoat: 0.7, clearcoatRoughness: 0.1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      mk(pos, nrm, idx, mat, 'eye-meniscus'); } }
  if (W.caruncle && W.canthus) { const pos = [], nrm = [], idx = [], nU = 10, nV = 8;
    for (const s of ['L', 'R']) { const en = W.canthus[s]; if (!en) continue; const e = eyeOf(en[0]), toEye = Math.sign(e.c.x - en[0]) || -Math.sign(en[0]);
      const k7 = W.car7?.scale ?? 1, cx = en[0] + toEye * 0.0016 * (W.car7 ? 0.9 : 1), cy = en[1] + 0.0002, cz = Math.min(en[2] - 0.0003, onGlobe(e, cx, cy) + 0.0005), rx = 0.0014 * k7, ry = 0.0019 * k7, rz = 0.0011 * k7, base = pos.length / 3;
      for (let j = 0; j <= nV; j++) { const th = j / nV * Math.PI; for (let i = 0; i <= nU; i++) { const ph = i / nU * Math.PI * 2, d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        pos.push(cx + rx * d[0], cy + ry * d[1], cz + rz * d[2]); const nn = [d[0] / rx, d[1] / ry, d[2] / rz], l = Math.hypot(...nn); nrm.push(nn[0] / l, nn[1] / l, nn[2] / l); } }
      for (let j = 0; j < nV; j++) for (let i = 0; i < nU; i++) { const a = base + j * (nU + 1) + i, b = a + nU + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); } }
    if (idx.length) { const cc = W.car7?.col || [0.5, 0.2, 0.19], mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setRGB(cc[0], cc[1], cc[2], THREE.LinearSRGBColorSpace), roughness: 0.4, ior: 1.4, specularIntensity: 0.8, clearcoat: 1, clearcoatRoughness: 0.06 });
      mk(pos, nrm, idx, mat, 'eye-caruncle'); } }
  return out;
}

// ---------------------------------------------------------------- FACE5 (round 5, opt-in: buildEyes(h, { f5: { catch, keyDeg, tear, caruncle } }))
// The CATCHLIGHT. The stage's key is a directional light that STAGE jitters over its disc (sub-frames), and the tear film's clearcoat
// (roughness 0.02) turned it into a sub-pixel dot: no catchlight at 1:1 (judge c10). Here each directional light is an AREA source of
// the key's angular radius (keyDeg; the stage's key.size / 2), and its disc is reflected in the cornea analytically: radiance E / solid
// angle x the tear film's Fresnel (F0 0.025, Schlick), shadowed by the key's own shadow map (a brow that shades the eye takes the
// catchlight too) and the lids' occlusion. It follows the key: move the key and the catchlight moves. The clearcoat's own direct lobe is
// replaced (it was the dot). The TEAR LINE: the meniscus strip (FACE3's) gets a wet surface (roughness 0.12, clearcoat 1 at 0.03) and the
// same disc, so the key draws a thin bright line along the lower lid; the CARUNCLE the same. Not for Cycles (it renders the area light).
// HONEST: at catch 1 (the physical value) the disc did not read at 1:1 on our eyes: with a key 35 degrees up it lands at the upper lid's
// edge, where the lid hides most of it and the shadow map shades the rest (the brow and lid stand proud of the globe). FACE5 ships catch 2
// and the shadow test softened to 0.35..1 (the key is an area seen past the lid's edge in part); both are knobs.
const F5_CATCH = (occ) => `
#if defined( USE_CLEARCOAT ) && ( NUM_DIR_LIGHTS > 0 )
{ vec3 cRr = reflect(-geometryViewDir, geometryClearcoatNormal); float cFr = 0.025 + 0.975 * pow(1.0 - saturate(dot(geometryClearcoatNormal, geometryViewDir)), 5.0);
  float cOm = 6.2831853 * (1.0 - cos(eCatch.x)); clearcoatSpecularDirect *= 1.0 - eCatch.z;
  DirectionalLight cDL;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  DirectionalLightShadow cDS;
  #endif
  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
    cDL = directionalLights[ i ]; float cSh = 1.0;
    #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
    cDS = directionalLightShadows[ i ];
    cSh = receiveShadow ? getShadow( directionalShadowMap[ i ], cDS.shadowMapSize, cDS.shadowIntensity, cDS.shadowBias, cDS.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
    #endif
    float cDisc = smoothstep(cos(eCatch.x * 1.3), cos(eCatch.x * 0.75), dot(cRr, cDL.direction));
    clearcoatSpecularDirect += cDL.color * mix(0.35, 1.0, cSh) * cDisc * cFr / cOm * eCatch.y * ${occ};   // the shadow map's binary test softened: the key is an area, seen past the lid's edge in part
  }
  #pragma unroll_loop_end
}
#endif
`;
function face5Eyes(mat, extra, U, o = {}) {
  const half = Math.max(1.5, o.keyDeg ?? 11) * Math.PI / 180, cat = o.catch ?? 1;   // a sun's 0.27 deg drawn as 1.5 (energy kept: E / its solid angle)
  U.eCatch = { value: new THREE.Vector4(half, cat, cat > 0 ? 1 : 0, 0) };
  const wrap = (m, occ, key) => { const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
    m.onBeforeCompile = (sh, r) => { prev?.call(m, sh, r); sh.uniforms.eCatch = U.eCatch;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec4 eCatch;').replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + F5_CATCH(occ)); };
    m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + key; m.needsUpdate = true; };
  // the key's own shadow map is the catchlight's occlusion: the lids' ambient occlusion (eOcc, which LIGHT_END applies to the clearcoat's
  // direct term after this) is divided back out (it took the disc down to a few per cent where it sits, near the upper lid)
  if (cat > 0) wrap(mat, '(1.0 / max(mix(1.0, eOcc, 0.4), 0.3))', '-f5catch');
  for (const m of extra) { const p = m.userData.part, mm = m.material;
    if (p === 'eye-meniscus' && (o.tear ?? 1) > 0) { mm.roughness = 0.12; mm.clearcoat = 1; mm.clearcoatRoughness = 0.03; mm.specularIntensity = 0.8; wrap(mm, String((o.tear ?? 1).toFixed(3)), '-f5tear'); }
    if (p === 'eye-caruncle' && (o.caruncle ?? 1) > 0) { mm.clearcoatRoughness = 0.04; mm.roughness = 0.3; wrap(mm, '1.0', '-f5car'); } }
  return U.eCatch;
}
