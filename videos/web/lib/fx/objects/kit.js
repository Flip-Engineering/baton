// OBJECTS KIT (OBJECTS studio c1): the shared parts, materials and wear every named-type generator builds from.
//
// Why: every piece used to re-draw its machines inside its scene file ("a truck", "a press", "a robot"), so no object
// ever got better than one deadline allowed, and none was reusable. A generator here builds ONE NAMED TYPE from a real
// reference (a spec sheet, a HAER drawing, a photograph), with the parts a worker would name, real materials, wear
// where wear really goes, seeded variants, and metadata a shot can use (bbox, anchors, practical lights, scale cue).
//
//   import { makeObject, OBJECT_TYPES } from '../lib/fx/objects/index.js';
//   const truck = makeObject('truck', { seed: 3, cab: 'longhood', trailer: 'van53' });   // a THREE.Group, metres
//   scene.add(truck); truck.userData.meta  // { type, variant, ref, bbox, anchors: {...}, lights: [...] }
//
// Materials (mat()): MeshStandardMaterial plus a small onBeforeCompile patch that adds WORLD-SPACE wear without UVs:
//   grime  road dirt / soot rising from the ground (height band), streaked by a vertical noise
//   edge   chalked / worn paint on convex edges (approximated from the normal's change across the pixel, fwidth)
//   speck  rust or chip speckle from 3D value noise, and a large-scale value wobble so a flat panel is never one colour
// Every value is a pure function of world position: deterministic, identical in a still and in the movie.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const TAU = Math.PI * 2;
export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ seeded randomness
export function rng(seed = 1) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
export const range = (r, a, b) => a + (b - a) * r();

// ------------------------------------------------------------------ materials with world-space wear
const WEAR_DEFAULT = { grime: 0, grimeH: 1.0, grimeColor: [0.16, 0.13, 0.1], edge: 0, edgeColor: [0.75, 0.72, 0.66], speck: 0,
  speckColor: [0.32, 0.17, 0.08], speckScale: 6, wobble: 0.12, streak: 0.5, ground: 0,
  joints: null /* { h: course height, l: unit length, w: joint width (m), k: strength, color: [r,g,b] } ashlar or brick bond in world space */ };
const cache = new Map();
export function mat(key, o = {}) {
  const k = key + JSON.stringify(o);
  if (cache.has(k)) return cache.get(k);
  const m = new THREE.MeshStandardMaterial({ color: o.color ?? 0x888888, roughness: o.rough ?? 0.6, metalness: o.metal ?? 0,
    map: o.map || null, normalMap: o.normalMap || null, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1,
    side: o.side ?? THREE.FrontSide, transparent: !!o.transparent, opacity: o.opacity ?? 1, envMapIntensity: o.env ?? 1 });
  if (o.normalMap && o.normalScale) m.normalScale.set(o.normalScale, o.normalScale);
  const w = { ...WEAR_DEFAULT, ...(o.wear || {}) };
  const J = w.joints ? { h: 0.6, l: 1.2, w: 0.012, k: 0.6, color: [0.3, 0.27, 0.22], ...w.joints } : null;
  if (w.grime || w.edge || w.speck || w.wobble || J) {
    m.onBeforeCompile = sh => {
      sh.uniforms.uWear = { value: new THREE.Vector4(w.grime, w.edge, w.speck, w.wobble) };
      sh.uniforms.uWear2 = { value: new THREE.Vector4(w.grimeH, w.speckScale, w.streak, w.ground) };
      sh.uniforms.uGrimeC = { value: new THREE.Color(...w.grimeColor) };
      sh.uniforms.uEdgeC = { value: new THREE.Color(...w.edgeColor) };
      sh.uniforms.uSpeckC = { value: new THREE.Color(...w.speckColor) };
      sh.uniforms.uJoint = { value: new THREE.Vector4(J ? J.h : 0, J ? J.l : 1, J ? J.w : 0, J ? J.k : 0) };
      sh.uniforms.uJointC = { value: new THREE.Color(...(J ? J.color : [0, 0, 0])) };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWPos; varying vec3 vWNrm; uniform vec4 uWear; uniform vec4 uWear2; uniform vec3 uGrimeC; uniform vec3 uEdgeC; uniform vec3 uSpeckC; uniform vec4 uJoint; uniform vec3 uJointC;
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 P = vWPos;
  float wob = fbm3(P * 0.35) - 0.5;
  // masonry: running-bond joints on vertical faces, in world space (no UVs), each unit its own tone
  if (uJoint.w > 0.0 && abs(vWNrm.y) < 0.6) {
    float hc = (abs(vWNrm.z) > abs(vWNrm.x)) ? P.x : P.z;
    float row = floor(P.y / uJoint.x);
    float u = hc / uJoint.y + 0.5 * mod(row, 2.0);
    float fy = fract(P.y / uJoint.x) * uJoint.x, fx = fract(u) * uJoint.y;
    float jw = uJoint.z;
    float j = 1.0 - min(smoothstep(0.0, jw, min(fy, uJoint.x - fy)), smoothstep(0.0, jw, min(fx, uJoint.y - fx)));
    float unitTone = h3(vec3(floor(u), row, 3.0)) - 0.5;
    diffuseColor.rgb *= 1.0 + unitTone * 0.14;
    diffuseColor.rgb = mix(diffuseColor.rgb, uJointC, j * uJoint.w);
  }
  diffuseColor.rgb *= 1.0 + uWear.w * wob * 1.6;
  // grime: rises from the ground (y = uWear2.w), streaked vertically, heavier on upward faces near the ground
  float st = fbm3(vec3(P.x * 3.0, P.y * 0.25, P.z * 3.0));
  float gh = clamp(1.0 - (P.y - uWear2.w) / max(uWear2.x, 1e-3) + (st - 0.5) * uWear2.z * 1.4, 0.0, 1.0);
  float gr = uWear.x * gh * gh * (0.55 + 0.45 * fbm3(P * 2.1));
  diffuseColor.rgb = mix(diffuseColor.rgb, uGrimeC, clamp(gr, 0.0, 0.92));
  // rust / chip speckle
  float sp = smoothstep(0.62, 0.8, fbm3(P * uWear2.y)) * uWear.z;
  diffuseColor.rgb = mix(diffuseColor.rgb, uSpeckC, clamp(sp, 0.0, 1.0));
  // worn convex edges: the world normal changes fast across the pixel on a bevel / rounded edge
  vec3 dn = fwidth(vWNrm); float ed = clamp(length(dn) * 3.0, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uEdgeC, uWear.y * ed * smoothstep(0.35, 0.7, vn(P * 9.0)));
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + uWear.x * 0.35 * clamp(1.0 - (vWPos.y - uWear2.w) / max(uWear2.x, 1e-3), 0.0, 1.0) + uWear.z * 0.3 * smoothstep(0.62, 0.8, fbm3(vWPos * uWear2.y)), 0.02, 1.0);`);
    };
    m.customProgramCacheKey = () => 'wear' + JSON.stringify(w);
  }
  cache.set(k, m);
  return m;
}

// house palette of real finishes (named, so a generator says what it is made of)
export const FINISH = {
  chrome:   { color: 0xdfe3e6, rough: 0.12, metal: 1.0, env: 1.4 },
  alu:      { color: 0xc4c8cc, rough: 0.28, metal: 1.0, env: 1.1 },
  galv:     { color: 0x9aa1a3, rough: 0.55, metal: 0.8, wear: { speck: 0.25, speckColor: [0.55, 0.56, 0.54], speckScale: 11 } },
  steel:    { color: 0x505458, rough: 0.5, metal: 0.7, wear: { speck: 0.35, speckScale: 8 } },
  black:    { color: 0x151517, rough: 0.55, metal: 0.3 },
  rubber:   { color: 0x141414, rough: 0.9, metal: 0.0 },
  glass:    { color: 0x2a3440, rough: 0.04, metal: 0.75, env: 2.4 },   // reflects the sky band: never a black hole
  concrete: { color: 0x9c9a92, rough: 0.92, metal: 0 },
  lampAmber:{ color: 0xffa640, rough: 0.3, emissive: 0xff8a20, emissiveIntensity: 2.5 },
  lampRed:  { color: 0xff3020, rough: 0.3, emissive: 0xff2010, emissiveIntensity: 2.5 },
  lampWhite:{ color: 0xfff4dc, rough: 0.2, emissive: 0xfff0d0, emissiveIntensity: 3.5 },
};
export const fin = (name, extra = {}) => mat(name, { ...FINISH[name], ...extra, wear: { ...(FINISH[name]?.wear || {}), ...(extra.wear || {}) } });
// paint: a colour plus how hard the object has worked
export const paint = (color, { grime = 0.4, grimeH = 1.2, edge = 0.3, speck = 0.08, rough = 0.45, metal = 0.2, gloss = false } = {}) =>
  mat('paint', { color, rough: gloss ? 0.22 : rough, metal, env: gloss ? 1.2 : 0.8, wear: { grime, grimeH, edge, speck } });

// ------------------------------------------------------------------ procedural textures (normal maps from height)
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
export function heightToNormal(hc, strength = 2, repeat = [1, 1]) {
  const { width: w, height: h } = hc; const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, g] = canvas(w, h); const out = g.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const n = new THREE.Vector3(-dx, dy, 1).normalize(), i = (y * w + x) * 4;
    out.data[i] = (n.x * 0.5 + 0.5) * 255; out.data[i + 1] = (n.y * 0.5 + 0.5) * 255; out.data[i + 2] = (n.z * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 4; return t;
}
const texCache = new Map();
export function corrugation({ period = 16, size = 256, shape = 'sine', strength = 3, repeat = [1, 1], axis = 'x' } = {}) {
  const k = [period, size, shape, strength, repeat, axis].join();
  if (texCache.has(k)) return texCache.get(k);
  const [c, g] = canvas(size, size);
  for (let i = 0; i < size; i++) {
    const u = (i % period) / period;
    const v = shape === 'sine' ? 0.5 + 0.5 * Math.sin(u * TAU) : shape === 'box' ? (u < 0.18 ? 1 : u < 0.5 ? 0.6 : u < 0.68 ? 1 : 0.25) : (u < 0.5 ? u * 2 : 2 - u * 2);
    g.fillStyle = `rgb(${v * 255 | 0},0,0)`; axis === 'x' ? g.fillRect(i, 0, 1, size) : g.fillRect(0, i, size, 1);
  }
  const t = heightToNormal(c, strength, repeat); texCache.set(k, t); return t;
}
export function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const [c, g] = canvas(w, h); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

// ------------------------------------------------------------------ geometry helpers (all return BufferGeometry)
export const G = {
  box: (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z),
  rbox: (w, h, d, r, x = 0, y = 0, z = 0, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999).translate(x, y, z),
  cyl: (rt, rb, h, x = 0, y = 0, z = 0, seg = 20, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open).translate(x, y, z),
  // a cylinder whose axis runs along X (wheels, tanks lying down) or Z
  cylX: (r, len, x = 0, y = 0, z = 0, seg = 24) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2).translate(x, y, z),
  cylZ: (r, len, x = 0, y = 0, z = 0, seg = 24) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2).translate(x, y, z),
  // a rod between two points
  rod(a, b, r, seg = 8) {
    const d = new THREE.Vector3().subVectors(b, a), L = d.length();
    const g = new THREE.CylinderGeometry(r, r, L, seg, 1);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  },
  // a tube along points (hoses, cables, conduit); sag adds a catenary-ish droop between the ends
  tube(points, r, seg = 40, radial = 8) { return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), seg, r, radial, false); },
  lathe(profile, seg = 32) { return new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), seg); },
  // an extruded 2D outline (x, y) given depth along z, centred on z
  extrude(pts, depth, bevel = 0) {
    const s = new THREE.Shape(); pts.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 16 });
    return g.translate(0, 0, -depth / 2);
  },
  merge(list) { const l = list.filter(Boolean).map(g => (g.index ? g.toNonIndexed() : g)); l.forEach(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); }); return mergeGeometries(l, false); },
};

// ------------------------------------------------------------------ parts library (each returns geometry lists, keyed by finish)
// A Parts bag collects geometry per material key and bakes it to one mesh per key: few draw calls, any number of parts.
export class Parts {
  constructor() { this.bins = new Map(); }
  add(key, ...geos) { if (!this.bins.has(key)) this.bins.set(key, []); this.bins.get(key).push(...geos.flat().filter(Boolean)); return this; }
  build(mats, { shadows = true } = {}) {
    const g = new THREE.Group();
    for (const [k, list] of this.bins) {
      if (!list.length) continue;
      const m = mats[k]; if (!m) throw new Error('objects/kit: no material for part key ' + k);
      const mesh = new THREE.Mesh(G.merge(list), m); mesh.name = k; mesh.castShadow = shadows; mesh.receiveShadow = shadows;
      if (m.emissive && m.emissive.getHex() && m.emissiveIntensity > 1) mesh.castShadow = false;
      g.add(mesh);
    }
    return g;
  }
}

// bolts round a circle (flanges, wheel lugs, pedestal feet), facing +axis
export function boltCircle(n, R, r, h, { axis = 'y', x = 0, y = 0, z = 0, phase = 0, hex = true } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = phase + i / n * TAU, c = Math.cos(a) * R, s = Math.sin(a) * R;
    let g = new THREE.CylinderGeometry(r, r, h, hex ? 6 : 10);
    if (axis === 'x') { g.rotateZ(Math.PI / 2); g.translate(x, y + c, z + s); }
    else if (axis === 'z') { g.rotateX(Math.PI / 2); g.translate(x + c, y + s, z); }
    else g.translate(x + c, y, z + s);
    out.push(g);
  }
  return out;
}
// a row of rivet / bolt heads between two points
export function rivetRow(a, b, n, r = 0.012, normal = 'z') {
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = a.clone().lerp(b, n === 1 ? 0.5 : i / (n - 1));
    const g = new THREE.SphereGeometry(r, 6, 4, 0, TAU, 0, Math.PI / 2);
    if (normal === 'z') g.rotateX(Math.PI / 2); else if (normal === '-z') g.rotateX(-Math.PI / 2); else if (normal === 'x') g.rotateZ(-Math.PI / 2); else if (normal === '-x') g.rotateZ(Math.PI / 2);
    out.push(g.translate(p.x, p.y, p.z));
  }
  return out;
}
// a caged or plain ladder from y0 to y1 at (x, z), rungs along X, facing +z
export function ladder(x, z, y0, y1, { w = 0.45, rail = 0.025, rung = 0.3, cage = false, facing = 'z' } = {}) {
  const out = [], rot = facing === 'x' ? g => g.rotateY(Math.PI / 2) : g => g;
  const L = [], place = g => rot(g).translate(x, 0, z);
  L.push(G.box(rail, y1 - y0, rail, -w / 2, (y0 + y1) / 2, 0), G.box(rail, y1 - y0, rail, w / 2, (y0 + y1) / 2, 0));
  for (let y = y0 + rung; y < y1; y += rung) L.push(G.cylX(0.012, w, 0, y, 0, 6));
  if (cage) for (let y = y0 + 2.2; y < y1; y += 0.9) { const t = new THREE.TorusGeometry(0.36, 0.012, 4, 14, Math.PI).rotateX(Math.PI / 2).translate(0, y, 0.02); L.push(t); }
  for (const g of L) out.push(place(g));
  return out;
}
// a handrail along a polyline at height h (top rail, knee rail, posts every ~1.5 m), toe board optional
export function handrail(pts, h = 1.07, { r = 0.02, post = 1.5, toe = true } = {}) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], L = a.distanceTo(b);
    out.push(G.rod(a.clone().setY(a.y + h), b.clone().setY(b.y + h), r), G.rod(a.clone().setY(a.y + h * 0.5), b.clone().setY(b.y + h * 0.5), r * 0.8));
    const n = Math.max(1, Math.round(L / post));
    for (let k = 0; k <= n; k++) { const p = a.clone().lerp(b, k / n); out.push(G.rod(p, p.clone().setY(p.y + h), r)); }
    if (toe) { const d = b.clone().sub(a), m = a.clone().lerp(b, 0.5); const t = G.box(L, 0.1, 0.008).rotateY(-Math.atan2(d.z, d.x)).translate(m.x, m.y + 0.05, m.z); out.push(t); }
  }
  return out;
}
// yellow/black hazard stripe texture (guards, slide faces, bollards)
export const hazardTex = (n = 8) => canvasTex(256, 64, (g, w, h) => {
  g.fillStyle = '#e8b31c'; g.fillRect(0, 0, w, h); g.fillStyle = '#111';
  for (let i = -2; i < n + 2; i++) { g.beginPath(); const x = i * w / n; g.moveTo(x, h); g.lineTo(x + w / n / 2, h); g.lineTo(x + w / n / 2 + h, 0); g.lineTo(x + h, 0); g.fill(); }
});

// ------------------------------------------------------------------ scale cue: a worker, a door, a ladder
// A plain standing worker (1.78 m) in coveralls and a hard hat, built from lathed volumes so it lights like a body,
// not a mannequin of capsules: it is a SCALE CUE at three-quarter distance (20-60 px tall on the feed), not a hero.
// For a hero person use the HUMAN studio (people.js / hero.js / figure_ref.js).
export function scaleFigure({ seed = 1, coverall = 0x2c3a4a, hat = 0xe8e2d0, pose = 'stand', vest = false } = {}) {
  const r = rng(seed), P = new Parts();
  const legSpread = pose === 'walk' ? 0.16 : 0.07;
  for (const s of [-1, 1]) {
    const lx = s * 0.1, fz = pose === 'walk' ? s * 0.14 : 0;
    P.add('cloth', G.lathe([[0, 0], [0.075, 0.02], [0.07, 0.45], [0.085, 0.5], [0.095, 0.85], [0.0, 0.9]], 10).translate(lx + s * (legSpread - 0.07), 0.06, fz));
    P.add('boot', G.rbox(0.12, 0.1, 0.27, 0.03, lx + s * (legSpread - 0.07), 0.05, fz + 0.04));
  }
  P.add('cloth', G.lathe([[0, 0], [0.17, 0.02], [0.16, 0.25], [0.2, 0.52], [0.21, 0.58], [0.1, 0.66], [0, 0.66]], 14).scale(1, 1, 0.62).translate(0, 0.9, 0));
  for (const s of [-1, 1]) {
    const sh = V3(s * 0.21, 1.46, 0), el = V3(s * 0.25, 1.17, pose === 'work' ? 0.12 : 0.03), wr = V3(s * 0.24, 0.93, pose === 'work' ? 0.3 : 0.06);
    P.add('cloth', G.tube([sh, el], 0.055, 4, 8), G.tube([el, wr], 0.047, 4, 8));
    P.add('skin', new THREE.SphereGeometry(0.05, 8, 6).scale(1, 1.3, 0.8).translate(wr.x, wr.y - 0.04, wr.z));
  }
  P.add('skin', G.cyl(0.05, 0.055, 0.09, 0, 1.58, 0, 10), new THREE.SphereGeometry(0.1, 14, 10).scale(0.92, 1.18, 1).translate(0, 1.71, 0.01));
  P.add('hat', new THREE.SphereGeometry(0.125, 16, 8, 0, TAU, 0, Math.PI / 2).scale(1, 0.85, 1.12).translate(0, 1.77, 0), G.cyl(0.14, 0.15, 0.015, 0, 1.765, 0.02, 16).scale(1, 1, 1.2));
  if (vest) P.add('vest', G.lathe([[0.215, 0], [0.22, 0.4], [0.18, 0.5], [0, 0.5]], 12).scale(1, 1, 0.66).translate(0, 1.0, 0));
  const skinTones = [0x8d5a3b, 0xc49070, 0x6b4128, 0xd0a283, 0xa8744f];
  const g = P.build({
    cloth: paint(coverall, { grime: 0.5, grimeH: 0.9, rough: 0.9, metal: 0, edge: 0 }), boot: fin('rubber'),
    skin: mat('skin' + seed, { color: pick(r, skinTones), rough: 0.6 }), hat: mat('hat', { color: hat, rough: 0.35 }),
    vest: mat('vest', { color: 0xd8ff30, rough: 0.6, emissive: 0x405000, emissiveIntensity: 0.3 }),
  });
  g.userData.meta = { type: 'scale_figure', height: 1.78 };
  return g;
}

// ------------------------------------------------------------------ object metadata
// finish(group, meta): computes the bbox, sets shadows, and attaches meta: { type, variant, ref, bbox, size, anchors, lights }.
// anchors are named Vector3s in object space (e.g. 'stackTop', 'headlightL', 'torchTip'); lights are practicals
// { pos, color, kind } a shot may light or a relight pass may add as an emitter.
export function finish(group, meta) {
  group.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  group.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(group);
  group.userData.meta = { anchors: {}, lights: [], ...meta, bbox, size: bbox.getSize(new THREE.Vector3()) };
  return group;
}

// ------------------------------------------------------------------ the hero camera: three-quarter hero distance
// Frames an object whole at `fill` of the frame width, from a three-quarter azimuth, eye-ish height: so the object
// reads at 270 px and its parts read at 1:1 (the scale ladder the critique found broken).
export function heroCamera(obj, { aspect = 1080 / 1920, fov = 30, az = -0.62, el = 0.08, fill = 0.42, lookY = 0.45, shiftY = 0, eye = null } = {}) {
  const m = obj.userData.meta, c = m.bbox.getCenter(new THREE.Vector3()), s = m.size;
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 4000);
  const hfov = 2 * Math.atan(Math.tan(fov * Math.PI / 360) * aspect);
  const extent = Math.abs(Math.cos(az)) * s.x + Math.abs(Math.sin(az)) * s.z;
  const dist = extent / 2 / Math.tan(hfov * fill / 2) + Math.max(s.x, s.z) * 0.3;
  const target = V3(c.x, m.bbox.min.y + s.y * lookY, c.z);
  cam.position.set(c.x + Math.sin(az) * dist, eye ?? (target.y + Math.tan(el) * dist), c.z + Math.cos(az) * dist);
  cam.lookAt(target);
  if (shiftY) cam.setViewOffset(1080, 1920, 0, -shiftY * 1920, 1080, 1920);
  return cam;
}
