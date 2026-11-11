// GARY 2036 c2 / the land: terrain (dunes, beach, the lake, prairie), scrub, water, and a field map for the new city's ground.
// Everything is metres, y up, the stake at the origin, north (the lake) toward -z. Deterministic: same seed, same land.
import * as THREE from 'three';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hash = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 1274126177) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export function vnoise(x, y, s = 0) { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash(ix, iy, s), hash(ix + 1, iy, s), ux), lerp(hash(ix, iy + 1, s), hash(ix + 1, iy + 1, s), ux), uy); }
export function fbm(x, y, s = 0, o = 4) { let a = 0.5, f = 1, t = 0; for (let i = 0; i < o; i++) { t += a * vnoise(x * f, y * f, s + i * 17); f *= 2.03; a *= 0.5; } return t; }

// ------------------------------------------------------------------ the world's places
export const SITE = { stake: [0, 0], lake: -2300, newCity: [2600, 1900], newR: 1500 };   // new city: flat prairie to the south-east
export const LAKE_Y = -0.9;

// ground height. Gary: dunes and swales grading to a beach and the lake to the north (-z). The new city site: flat prairie.
export function heightAt(x, z) {
  const toLake = clamp((-z - 200) / 1500);                     // dunes grow toward the lake
  const ridge = 1 - Math.abs(fbm(x / 260 + 5, z / 190 + 9, 3, 3) * 2 - 1);              // ridged noise: crests
  let h = 11 * Math.pow(ridge, 2.2) * (0.25 + 0.75 * toLake) * sstep(-500, 150, -z * 0.35 + 150 - Math.abs(z) * 0.0);
  h += 1.5 * (fbm(x / 34, z / 34, 11, 3) - 0.5) + 0.25 * (fbm(x / 6, z / 6, 21, 2) - 0.5);
  // the beach and the lake bed
  const d = z - SITE.lake; if (d < 150) h = lerp(h, 0.9 + d * 0.012, sstep(150, -60, d)); if (d < 0) h = Math.min(h, 0.6 + d * 0.02);
  // flat where we build: a level circle at the stake, and the prairie of the new city
  const ds = Math.hypot(x, z); h *= sstep(26, 90, ds);
  const dn = Math.hypot(x - SITE.newCity[0], z - SITE.newCity[1]), flat = 1 - sstep(SITE.newR * 0.8, SITE.newR * 1.6, dn);
  h = lerp(h, 0.2 * (fbm(x / 120, z / 120, 5, 2) - 0.5), flat);
  return h;
}

// ground colour: sand and dune scrub, the beach, prairie fields in a section grid for the new city (a mile square = 1609 m)
export function groundColor(x, z, h, out = new THREE.Color()) {
  const sand = [0.62, 0.55, 0.42], grass = [0.30, 0.31, 0.18], dune = [0.55, 0.49, 0.36], wet = [0.42, 0.37, 0.29], tilth = [0.30, 0.22, 0.15], crop = [0.38, 0.40, 0.20], fall = [0.45, 0.41, 0.26];
  const patch = fbm(x / 70, z / 70, 31, 3), fine = fbm(x / 7, z / 7, 7, 2);
  let c = sand.map((v, i) => lerp(dune[i], grass[i], sstep(0.45, 0.65, patch)) * 0.55 + v * 0.45);
  const dn = Math.hypot(x - SITE.newCity[0], z - SITE.newCity[1]), farm = 1 - sstep(SITE.newR * 1.2, SITE.newR * 2.4, dn) * 0 ;
  const fieldId = hash(Math.floor((x + 40) / 402), Math.floor((z + 40) / 402), 4), fcol = fieldId < 0.3 ? tilth : fieldId < 0.7 ? crop : fall;
  const inFarm = sstep(-400, 600, x) * sstep(-300, 500, z);                  // fields toward the south-east
  c = c.map((v, i) => lerp(v, fcol[i], inFarm * 0.9 * farm));
  const beach = sstep(SITE.lake + 330, SITE.lake + 120, z); c = c.map((v, i) => lerp(v, wet[i] * 1.25 + 0.1, beach * 0.8));
  const k = 0.82 + 0.35 * fine; out.setRGB(c[0] * k, c[1] * k, c[2] * k, THREE.SRGBColorSpace); return out;
}

// terrain mesh over [x0,x1]x[z0,z1] at step s, with a hole (inner rect) so a coarse outer ring and a fine centre don't overlap
function terrainGeo(x0, x1, z0, z1, s, hole = null) {
  const nx = Math.round((x1 - x0) / s), nz = Math.round((z1 - z0) / s), pos = [], col = [], idx = [], c = new THREE.Color();
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = x0 + i * s, z = z0 + j * s, y = heightAt(x, z); pos.push(x, y, z); groundColor(x, z, y, c); col.push(c.r, c.g, c.b); }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (hole) { const cx = x0 + (i + 0.5) * s, cz = z0 + (j + 0.5) * s; if (cx > hole[0] && cx < hole[1] && cz > hole[2] && cz < hole[3]) continue; }
    const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

// the ground material: sand grain and ripples from world position; for the new city a built-ground map (R: asphalt/paving, G: plaza, B: earthwork,
// A: the year it is paved, 0..1 across 2027..2036) so streets are cut, graded and paved as the clock runs
export function groundMaterial({ cityTex = null, planar = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  m.userData.U = { uYear: { value: 0 }, uWet: { value: 0 }, uCity: { value: cityTex }, uCityC: { value: new THREE.Vector2(SITE.newCity[0], SITE.newCity[1]) }, uCityS: { value: 2800 }, uLamp: { value: 0 } };
  
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 gW;').replace('#include <begin_vertex>', '#include <begin_vertex>\ngW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 gW; uniform float uYear, uWet, uCityS, uLamp; uniform vec2 uCityC; uniform sampler2D uCity;
float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(gh(i), gh(i+vec2(1,0)), f.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), f.x), f.y); }
`).replace('#include <color_fragment>', `#include <color_fragment>
{ float g1 = gn(gW.xz * 9.0), g2 = gn(gW.xz * 41.0), rip = gn(vec2(gW.x * 3.0 + gW.z * 0.4, gW.z * 22.0));
  diffuseColor.rgb *= 0.86 + 0.16 * g1 + 0.10 * g2 + 0.06 * rip; }
float cityA = 0.0, plaza = 0.0, earth = 0.0, paved = 0.0;
vec2 cuv = (gW.xz - uCityC) / uCityS + 0.5;
if (cuv.x > 0.0 && cuv.x < 1.0 && cuv.y > 0.0 && cuv.y < 1.0) { vec4 ct = texture2D(uCity, cuv);
  paved = step(ct.a, uYear + 0.0001) * step(0.001, ct.r + ct.g); earth = ct.b; plaza = ct.g; cityA = ct.r;
  float gradeT = step(ct.a - 0.18, uYear);                                                        // graded a little before it is paved
  vec3 dirt = vec3(0.30, 0.22, 0.15) * (0.8 + 0.4 * gn(gW.xz * 0.7));
  diffuseColor.rgb = mix(diffuseColor.rgb, dirt, (ct.r + ct.g) * gradeT * (1.0 - paved));
  vec3 asph = vec3(0.075, 0.078, 0.085) * (0.8 + 0.4 * gn(gW.xz * 2.3));
  vec3 pave = vec3(0.34, 0.33, 0.31) * (0.85 + 0.3 * gn(gW.xz * 4.1));
  { vec2 pr = gW.xz - uCityC; float rr = length(pr), an = atan(pr.y, pr.x);
    float ring = 1.0 - smoothstep(0.0, 0.05, abs(fract(rr / 6.0 + 0.5) - 0.5)), spoke = (1.0 - smoothstep(0.0, 0.010, abs(fract(an * 12.0 / 6.2832 + 0.5) - 0.5))) * step(9.0, rr);
    float tile = 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.03, abs(fract(gW.x / 3.0) - 0.5) * 0.0 + min(abs(fract(gW.x / 3.0 + 0.5) - 0.5), abs(fract(gW.z / 3.0 + 0.5) - 0.5)))) * 0.25;
    pave *= (1.0 - 0.17 * max(ring, spoke)) * tile; pave = mix(pave, vec3(0.50, 0.46, 0.40), (1.0 - smoothstep(4.0, 4.6, rr)) * 0.85); }
  diffuseColor.rgb = mix(diffuseColor.rgb, asph, ct.r * paved); diffuseColor.rgb = mix(diffuseColor.rgb, pave, ct.g * paved);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.19, 0.17), ct.b * 0.6 * step(ct.a - 0.3, uYear) * (1.0 - paved)); }
`).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
{ float wetK = uWet * (cityA * paved * 0.95 + plaza * paved * 0.6);
  roughnessFactor = mix(roughnessFactor, 0.07 + 0.18 * gn(gW.xz * 0.35), wetK); }
`);
  };
  return m;
}

// ------------------------------------------------------------------ the land as meshes
export function buildLand(scene, { cityTex = null } = {}) {
  const g = new THREE.Group(); scene.add(g);
  const mat = groundMaterial({ cityTex }), C = SITE.newCity;
  // fine centre at the stake (4 m), fine at the new city (12 m), a coarse world (60 m) with holes where the fine ones are
  const parts = [
    [terrainGeo(-1400, 1400, -2600, 700, 7), 'gary'],
    [terrainGeo(C[0] - 1900, C[0] + 1900, C[1] - 1900, C[1] + 1900, 19), 'new'],
  ];
  const holes = [[-1400, 1400, -2600, 700], [C[0] - 1900, C[0] + 1900, C[1] - 1900, C[1] + 1900]];
  const outer = (() => { const x0 = -14000, x1 = 14000, z0 = -4000, z1 = 14000, s = 125, nx = (x1 - x0) / s, nz = (z1 - z0) / s, pos = [], col = [], idx = [], c = new THREE.Color();
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = x0 + i * s, z = z0 + j * s, y = heightAt(x, z); pos.push(x, y, z); groundColor(x, z, y, c); col.push(c.r, c.g, c.b); }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const cx = x0 + (i + 0.5) * s, cz = z0 + (j + 0.5) * s; if (holes.some(h => cx > h[0] - 60 && cx < h[1] + 60 && cz > h[2] - 60 && cz < h[3] + 60)) continue;
      const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); gg.setIndex(idx); gg.computeVertexNormals(); return gg; })();
  const meshes = [];
  for (const [geo] of parts) { const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; g.add(m); meshes.push(m); }
  const om = new THREE.Mesh(outer, mat); om.receiveShadow = true; g.add(om); meshes.push(om);
  // the lake: a wide, glossy plane that takes the sky; the horizon is where it meets haze
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(40000, 14000).rotateX(-Math.PI / 2).translate(0, LAKE_Y, SITE.lake - 7000 + 600),
    new THREE.MeshStandardMaterial({ color: 0x1f3e52, roughness: 0.06, metalness: 0 })); g.add(lake);
  return { group: g, mat, meshes, lake };
}

// dune scrub and grass tufts around the stake: thousands of clumps of thin curved blades give the near ground its scale and its wind
function clumpGeometry(seed = 1, blades = 9) {
  const R = rng(seed), pos = [], nor = [], idx = [], SEG = 3;
  for (let b = 0; b < blades; b++) {
    const a = R() * 6.2832, lean = 0.15 + R() * 0.55, hgt = 0.22 + R() * 0.3, w = 0.016 + R() * 0.012, ox = (R() - 0.5) * 0.12, oz = (R() - 0.5) * 0.12, base = pos.length / 3;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    for (let k = 0; k <= SEG; k++) { const u = k / SEG, y = u * hgt, off = lean * u * u * hgt, ww = w * (1 - u * 0.92), cx = ox + dx * off, cz = oz + dz * off;
      pos.push(cx - px * ww, y, cz - pz * ww, cx + px * ww, y, cz + pz * ww); nor.push(dz, 0.35, -dx, dz, 0.35, -dx); }
    for (let k = 0; k < SEG; k++) { const i = base + k * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx); return g;
}
export function buildScrub(scene, { n = 5200, r0 = 3, r1 = 520, seed = 5 } = {}) {
  const R = rng(seed), geo = clumpGeometry(seed);
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide }); m.userData.U = { uWind: { value: 0 } };
  m.onBeforeCompile = (sh) => { sh.uniforms.uWind = m.userData.U.uWind;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;').replace('#include <begin_vertex>', `#include <begin_vertex>
{ vec3 ip = vec3(instanceMatrix[3].x, 0., instanceMatrix[3].z); float sw = sin(uWind * 1.7 + ip.x * 0.31 + ip.z * 0.23) * 0.5 + sin(uWind * 2.9 + ip.x * 0.7) * 0.2; transformed.x += position.y * position.y * sw * 0.18; transformed.z += position.y * position.y * sw * 0.08; }`); };
  const mesh = new THREE.InstancedMesh(geo, m, n), M = new THREE.Matrix4(), c = new THREE.Color(), q = new THREE.Quaternion(), e = new THREE.Euler();
  let k = 0, guard = 0;
  while (k < n && guard++ < n * 40) { const a = R() * 6.2832, r = r0 + Math.pow(R(), 1.7) * (r1 - r0), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - 0.4, z - 0.2) < 2.6) continue;
    if (fbm(x / 70, z / 70, 31, 3) < 0.42 && R() < 0.85) continue;       // scrub grows in patches
    const y = heightAt(x, z), sc = 0.7 + R() * 0.8 + (r > 60 ? R() * 1.3 : 0), sx = sc * (0.8 + R() * 0.6);
    e.set((R() - 0.5) * 0.25, R() * 6.28, (R() - 0.5) * 0.25); q.setFromEuler(e); M.compose(V3(x, y - 0.02, z), q, V3(sx, sc, sx)); mesh.setMatrixAt(k, M);
    const t = R(); c.setRGB(lerp(0.34, 0.60, t), lerp(0.30, 0.50, t), lerp(0.14, 0.22, t)); mesh.setColorAt(k, c); k++; }
  mesh.count = k; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; scene.add(mesh); return mesh;
}
