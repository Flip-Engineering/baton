// HAIR / wraps: the cloth women (and men) wore over working hair, as hair-styling accessories (HUMAN c8 lane D; garments proper are
// CLOTHING's). From the LoC war-industry photographs (videos/review/studio_human_c8/before/women/refs/): the kerchief knotted on top at
// the front with the rolled hair showing under its edge (Delano's Marcella Hart), the knit turban wrapped round to a twist at the
// forehead (Hollem's Vilter worker), the snood holding long hair in a net at the nape, and the head wrap.
//   kinds: 'bandana' | 'turban' | 'snood' | 'headwrap'; L: { wrap, color, color2, pattern: 'dots' | 'check' | 'plain' | 'knit' | 'net',
//          front, side, back (cm: the edge's height above the eye centre at the front, over the ear, at the nape), thick (cm), knot }
// A wrap is a shell over the skull built in direction space about the skull centre (field.js): for each azimuth the edge's elevation
// is found on the real scalp, and rows run from the edge to the crown (or, for the snood, from a band at the crown down past the nape
// into the bag). Its thickness is the cloth plus the hair it holds plus its folds: radiating from the knot (kerchief), crossing
// bands (turban). The same shell is a volume the hair is grown inside (index.js combines it with any hat), so the hair under a wrap
// is compressed and, where the cloth hides it, not built at all. Rigid on the head bone.
import * as THREE from 'three';
import { sstep, mulberry } from './field.js';
import { V, clamp } from './grow.js';
import { atlasTexture, tileU } from './atlas.js';

const cm = x => x / 100;
const dirOf = (ph, th) => V(Math.cos(th) * Math.sin(ph), Math.sin(th), Math.cos(th) * Math.cos(ph));
// the elevation at which the scalp in azimuth ph reaches height ys above the eye centre
function elevAt(F, ph, ys) { let lo = -1.3, hi = 1.55; for (let it = 0; it < 26; it++) { const th = (lo + hi) / 2, d = dirOf(ph, th), r = F.rAt(d.x, d.y, d.z) || 0.09; if (F.C.y + d.y * r - F.eyeY > ys) hi = th; else lo = th; } return (lo + hi) / 2; }

const PRESET = {
  bandana: { front: 7.4, side: 2.4, back: -5.2, thick: 0.9, knot: 'front', pattern: 'dots', color: '#a3201c', color2: '#efe8da', folds: 1 },
  turban: { front: 4.6, side: 1.4, back: -5.8, thick: 1.6, knot: 'twist', pattern: 'knit', color: '#2c3550', folds: 1.4 },
  headwrap: { front: 5.6, side: 1.8, back: -6.2, thick: 1.8, knot: 'top', pattern: 'plain', color: '#6a3a1e', folds: 1.2, crown: 2.6 },
  snood: { top: 8.5, side: 0.5, back: -11, thick: 0.6, bag: 3.2, knot: null, pattern: 'net', color: '#2a2622', folds: 0.3 },
};

export function buildWrap(F, Lin, o = {}) {
  const L = { ...PRESET[Lin.wrap || 'bandana'], ...Lin }, kind = Lin.wrap || 'bandana', rnd = mulberry((o.seed ?? 1) * 59 + 17), h = F.h;
  const NP = 72, NT = kind === 'snood' ? 26 : 22, snood = kind === 'snood';
  const earPh = (F.earF + F.earB) / 2;
  // the edge height (m above the eye) by azimuth: front -> over the ear -> nape
  const edgeY = ph => { const a = Math.abs(ph); if (a < earPh) { const t = sstep(0.35, earPh, a); return cm(L.front) + (cm(L.side) - cm(L.front)) * t; } return cm(L.side) + (cm(L.back) - cm(L.side)) * sstep(earPh, Math.PI, a); };
  const phs = snood ? Array.from({ length: NP + 1 }, (_, i) => -Math.PI + (i / NP) * 2 * Math.PI) : Array.from({ length: NP + 1 }, (_, i) => -Math.PI + i / NP * 2 * Math.PI);
  // the snood: a band from over the ears round the back of the crown (its top) down into a bag below the nape; it covers the back only
  const snTop = ph => cm(L.top) - cm(L.top - 3.5) * sstep(Math.PI, 1.2, Math.abs(ph)), snCover = ph => sstep(1.05, 1.35, Math.abs(ph));
  const thick = (ph, th, t) => {
    let k = cm(L.thick) * (0.85 + 0.3 * rnd.f(ph, th));
    if (snood) k += cm(L.bag) * sstep(0.35, 1, t) * snCover(ph);
    if (L.crown) k += cm(L.crown) * sstep(0.6, 1.3, th) * sstep(2.2, 0.6, Math.abs(ph));
    // folds: radiating from the knot (a kerchief tied at the front), crossing bands (a turban), soft gathers (a wrap)
    if (kind === 'bandana') { const a = Math.atan2(th - 1.05, ph); k += cm(0.35) * L.folds * Math.pow(Math.abs(Math.sin(a * 7 + 2 * Math.sin(ph * 3))), 3) * sstep(0.2, 0.9, Math.hypot(ph, th - 1.05)); }
    else if (kind === 'turban' || kind === 'headwrap') { const b1 = Math.sin((ph * 1.3 + th * 3.2) * 2.4), b2 = Math.sin((-ph * 1.3 + th * 3.2) * 2.4 + 1.3); k += cm(0.45) * L.folds * (Math.pow(Math.abs(b1), 4) + Math.pow(Math.abs(b2), 4)) * (1 - 0.5 * sstep(1.2, 1.5, th)); }
    else k += cm(0.15) * Math.sin(ph * 9 + th * 4);
    return k; };
  rnd.f = (a, b) => { const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); };
  // ---- the shell
  const P = [], N = [], UV = [], IX = [], rows = [];
  for (let i = 0; i <= NP; i++) { const ph = phs[i]; let th0, th1;
    if (snood) { th0 = elevAt(F, ph, snTop(ph)); th1 = elevAt(F, ph, cm(L.back) * snCover(ph) + cm(L.side) * (1 - snCover(ph))); } else { th0 = elevAt(F, ph, edgeY(ph)); th1 = Math.PI / 2 - 0.02; }
    const col = [];
    for (let j = 0; j <= NT; j++) { const t = j / NT, th = snood ? th0 + (th1 - th0) * t : th0 + (th1 - th0) * Math.pow(t, 0.8), d = dirOf(ph, th), r = F.rAt(d.x, d.y, d.z) || 0.09;
      let k = thick(ph, th, t); if (!snood && j === 0) k *= 0.7; if (snood && (j === 0 || i === 0 || i === NP)) k *= 0.5;
      const p = F.C.clone().addScaledVector(d, r + k);
      if (snood && t > 0.5) F.push(p, k);                                        // the bag rests on the neck, not in it
      col.push(p); P.push(p.x, p.y, p.z); UV.push(ph * 0.1, th * 0.1); }
    rows.push({ ph, th0, th1, col }); }
  for (let i = 0; i < NP; i++) for (let j = 0; j < NT; j++) { const a = i * (NT + 1) + j, b = a + NT + 1; if (snood && !(snCover(phs[i]) > 0.02 || snCover(phs[i + 1]) > 0.02)) continue; IX.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(IX); g.computeVertexNormals();
  const meshes = [mkMesh(h, g, wrapMaterial(L, kind), kind)];
  // ---- the knot
  if (L.knot) { const kg = knotGeometry(F, L, kind, edgeY, thick); if (kg) meshes.push(mkMesh(h, kg, wrapMaterial({ ...L, pattern: L.pattern === 'net' ? 'plain' : L.pattern }, kind + '-knot'), kind + '-knot')); }
  // ---- the volume the hair grows in
  const thAt = (ph) => { const i = Math.round((ph + Math.PI) / (2 * Math.PI) * NP); return rows[Math.max(0, Math.min(NP, i))]; };
  const volume = { kind: 'wrap-' + kind, topY: 1e9,
    clamp(p, m = 0.003) { const d = p.clone().sub(F.C), l = d.length(); d.divideScalar(l); const ph = Math.atan2(d.x, d.z), th = Math.asin(clamp(d.y, -1, 1)), R = thAt(ph);
      if (snood) { if (snCover(ph) < 0.5 || th > R.th0) return false; } else if (th < R.th0) return false;
      const t = snood ? clamp((th - R.th0) / (R.th1 - R.th0)) : clamp((th - R.th0) / (R.th1 - R.th0)), r = F.rAt(d.x, d.y, d.z) || l, lim = r + thick(ph, th, t) * 0.92 - cm(0.18) - m;
      if (l > lim) { p.copy(F.C).addScaledVector(d, Math.max(lim, r + 0.0008)); return true; } return false; },
    rimAt(ph) { return snood ? 1e9 : F.eyeY + edgeY(ph); } };
  return { meshes, volume, report: { kind, tris: IX.length / 3 + (meshes[1] ? meshes[1].geometry.index.count / 3 : 0) } };
}

function mkMesh(h, g, mat, part) {
  const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4); for (let i = 0; i < n; i++) { si[i * 4] = h.idx.head; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  const m = new THREE.SkinnedMesh(g, mat); m.frustumCulled = false; m.castShadow = m.receiveShadow = true; m.bind(h.skeleton, new THREE.Matrix4()); m.userData.subject = 1; m.userData.part = 'hair8'; m.userData.hairPart = 'wrap';
  if (mat.alphaMap) m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: mat.alphaMap, alphaTest: 0.5 });
  return m;
}

// the knots: a kerchief's two ears and its knot at the top of the forehead; a turban's twist; a wrap's top knot
function knotGeometry(F, L, kind, edgeY, thick) {
  const parts = [], ys = kind === 'bandana' ? cm(L.front) + 0.022 : kind === 'turban' ? cm(L.front) + 0.012 : cm(L.front) + 0.06;
  const th = elevAt(F, 0, ys), d = dirOf(0, th), r = (F.rAt(d.x, d.y, d.z) || 0.09) + thick(0, th, 0.5), at = F.C.clone().addScaledVector(d, r);
  const nrm = d.clone(), ex = V(1, 0, 0), ey = nrm.clone().cross(ex).normalize();
  const blob = (c, s, rot, n = 12) => { const gg = new THREE.SphereGeometry(1, n, Math.round(n * 0.7)); const p = gg.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), w = 1 + 0.12 * Math.sin(x * 9 + y * 5) ; p.setXYZ(i, x * s[0] * w, y * s[1], z * s[2] * w); }
    gg.rotateZ(rot); const M = new THREE.Matrix4().makeBasis(ex, ey, nrm).setPosition(c); gg.applyMatrix4(M); parts.push(gg); };
  if (kind === 'bandana') { blob(at.clone().addScaledVector(nrm, 0.006), [0.013, 0.011, 0.009], 0); blob(at.clone().addScaledVector(nrm, 0.008).addScaledVector(ex, 0.02).addScaledVector(ey, 0.008), [0.024, 0.011, 0.005], 0.5); blob(at.clone().addScaledVector(nrm, 0.008).addScaledVector(ex, -0.02).addScaledVector(ey, 0.01), [0.024, 0.011, 0.005], -0.6); }
  else if (kind === 'turban') { for (let k = -2; k <= 2; k++) blob(at.clone().addScaledVector(ey, k * 0.008).addScaledVector(nrm, 0.004), [0.02 - Math.abs(k) * 0.002, 0.006, 0.007], k * 0.35); }
  else blob(at.clone().addScaledVector(nrm, 0.01), [0.03, 0.022, 0.016], 0.2);
  // merge
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const P = new Float32Array(n * 3), N2 = new Float32Array(n * 3), U = new Float32Array(n * 2), IX = []; let o = 0;
  for (const p of parts) { P.set(p.attributes.position.array, o * 3); N2.set(p.attributes.normal.array, o * 3); U.set(p.attributes.uv.array, o * 2); for (const i of p.index.array) IX.push(i + o); o += p.attributes.position.count; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N2, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2)); g.setIndex(IX); g.computeVertexNormals();
  return g;
}

// cloth: a plain, a polka dot (the kerchief of the posters and the photographs), a gingham check, a knit rib, a net (the snood)
function wrapMaterial(L, key) {
  const net = L.pattern === 'net';
  const mat = new THREE.MeshPhysicalMaterial({ color: L.color, roughness: L.pattern === 'knit' ? 0.95 : 0.85, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(L.color).lerp(new THREE.Color('#ffffff'), 0.35), side: THREE.DoubleSide });
  if (net) { const tex = atlasTexture(); mat.alphaMap = tex; mat.alphaTest = 0.45; }
  const U = { wCol2: { value: new THREE.Color(L.color2 || '#efe8da') }, wPat: { value: { plain: 0, dots: 1, check: 2, knit: 3, net: 4 }[L.pattern] ?? 0 }, wNet: { value: new THREE.Vector2(...tileU('net')) } };
  mat.onBeforeCompile = sh => { Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWU;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWU = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vWU; uniform vec3 wCol2; uniform float wPat; uniform vec2 wNet;')
      .replace('#include <alphamap_fragment>', `#ifdef USE_ALPHAMAP
  { vec2 q = vec2(mix(wNet.x, wNet.y, fract(vWU.x * 9.0)), fract(vWU.y * 7.0)); diffuseColor.a *= texture2D(alphaMap, q).g; }
#endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
{ vec2 q = vWU * vec2(110.0, 110.0); int P = int(wPat + 0.5); vec3 c = diffuseColor.rgb;
  if (P == 1) { vec2 g = fract(q + vec2(0.5 * floor(q.y), 0.0)) - 0.5; float dot2 = smoothstep(0.24, 0.2, length(g)); c = mix(c, wCol2, dot2); }
  else if (P == 2) { float a = step(0.5, fract(q.x * 0.5)), b = step(0.5, fract(q.y * 0.5)); c = mix(c, wCol2, 0.5 * (a + b) * 0.6); }
  else if (P == 3) { float rib = smoothstep(0.1, 0.5, abs(fract(q.x * 1.6) - 0.5) * 2.0); c *= 0.78 + 0.25 * rib; roughnessFactor = 0.95; }
  c *= 0.92 + 0.08 * fract(sin(dot(floor(q * 3.0), vec2(12.9898, 78.233))) * 43758.5453);
  diffuseColor.rgb = c; }`); };
  mat.customProgramCacheKey = () => 'hair8-wrap' + (net ? '-net' : '');
  return mat;
}
