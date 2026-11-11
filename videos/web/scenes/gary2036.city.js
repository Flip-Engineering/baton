// GARY 2036 c2 / the city: instanced buildings that rise as steel frames and are clad from the bottom up, streets that are cut, graded and
// paved by year, a viaduct for the high-speed line, a station, a fusion works with cooling towers, street lamps. All metres, y up.
// One shader (onBeforeCompile on a standard material) draws a building as it is: above the cladding line only the frame (columns,
// floor beams, braces in red lead), below it a curtain wall of windows, lit at night by a share that grows as people move in.
import * as THREE from 'three';
import { rng, clamp, lerp, sstep, vnoise, fbm, SITE } from './gary2036.land.js';
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ the building material
export function buildingMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide });
  const U = m.userData.U = { uNight: { value: 0 }, uLit: { value: 0.5 }, uGlow: { value: 1 }, uCold: { value: 0.35 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute float aClad; attribute vec4 aTint; varying vec3 vLP; varying vec3 vSz; varying float vClad; varying vec4 vTint; varying vec3 vObjN; varying vec2 vBid;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vLP = position; vObjN = normal; vClad = aClad; vTint = aTint;
vSz = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)); vBid = instanceMatrix[3].xz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vLP; varying vec3 vSz; varying float vClad; varying vec4 vTint; varying vec3 vObjN; varying vec2 vBid;
uniform float uNight, uLit, uGlow, uCold;
float bh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bh3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
`).replace('#include <color_fragment>', `#include <color_fragment>
vec3 lp = vLP * vSz; float yM = lp.y;
bool wall = abs(vObjN.y) < 0.5;
float uA = abs(vObjN.x) > 0.5 ? lp.z : lp.x;                     // along the face, metres
float wB = abs(vObjN.x) > 0.5 ? vSz.z : vSz.x;
float colP = max(3.0, floor(wB / 6.0 + 0.5) > 0.0 ? wB / floor(wB / 6.0 + 0.5) : 6.0);          // column pitch that fits the face
float uF = uA + wB * 0.5;                                          // 0 at a corner
float cx = abs(uF - colP * floor(uF / colP + 0.5));                // distance to the nearest column line
float fy = abs(yM - 3.6 * floor(yM / 3.6 + 0.5));                  // distance to the nearest floor line
bool inClad = yM < vClad;
float lit = 0.0; float glass = 0.0; vec3 emis = vec3(0.0);
float fwx = fwidth(uF) * 1.2, fwy = fwidth(yM) * 1.2;
if (!inClad) {
  // the frame: columns, floor beams, a brace in every other bay. Anything else is air.
  float colM = 1.0 - smoothstep(0.30, 0.30 + fwx + 0.1, cx);
  float flM = 1.0 - smoothstep(0.22, 0.22 + fwy + 0.1, fy);
  float bay = floor(uF / colP + 0.5), fl = floor(yM / 3.6 + 0.5);
  float dg = abs(fract((uF / colP) * 0.5 + (mod(fl, 2.0) < 0.5 ? yM : -yM) / 7.2) - 0.5) * 2.0;   // diagonals across 2 floors
  float dM = (1.0 - smoothstep(0.045, 0.045 + fwx * 0.1 + 0.02, dg)) * step(0.5, bh(vec2(bay, floor(yM / 7.2)) + vBid) );
  float roofM = wall ? 0.0 : 1.0;
  float k = wall ? max(max(colM, flM), dM * 0.8) : (1.0 - smoothstep(0.2, 0.2 + fwx + 0.1, min(abs(lp.x - 6.0 * floor(lp.x / 6.0 + 0.5)), abs(lp.z - 6.0 * floor(lp.z / 6.0 + 0.5)))));
  if (k < 0.5) discard;
  float prim = smoothstep(0.0, 1.0, bh(vec2(floor(yM / 14.0), vBid.x)) + 0.25);                // red lead, painted from below as the crew climbs
  diffuseColor.rgb = mix(vec3(0.55, 0.20, 0.11), vec3(0.17, 0.17, 0.18), step(0.55, prim));
} else {
  float body = vTint.w;                                              // 0 glass tower, 1 masonry, 2 shed/industrial
  vec3 base = vTint.rgb;
  float fh = fract(yM / 3.6 + 0.0), gw = body > 1.5 ? 0.0 : (body > 0.5 ? 0.46 : 0.70);
  float inFloor = smoothstep(0.10, 0.14, fh) * (1.0 - smoothstep(0.10 + gw, 0.14 + gw, fh));
  float mull = body > 0.5 ? (colP > 0.0 ? smoothstep(0.55, 0.9, abs(fract(uF / (colP * 0.5)) - 0.5) * 2.0) : 0.0) : smoothstep(0.80, 0.97, abs(fract(uF / (colP * 0.5)) - 0.5) * 2.0);
  float isWin = wall ? inFloor * (1.0 - mull) : 0.0;
  float agg = clamp(max(fwidth(uF) / 1.5, fwidth(yM) / 3.6) * 1.5 - 0.3, 0.0, 1.0);    // a window under a pixel: its floor's average, not dot noise (v5, after americana_city)
  isWin = mix(isWin, wall ? (body > 0.5 ? 0.38 : 0.62) : 0.0, agg);
  if (body > 1.5) isWin = wall ? step(0.74, fh) * step(0.5, fract(uF / 12.0 + 0.25)) * 0.8 * step(yM, 9.0) : 0.0;
  vec3 glassC = body < 0.5 ? mix(vec3(0.06, 0.09, 0.12), vec3(0.14, 0.22, 0.28), mix(bh(vec2(floor(uF / 3.0), floor(yM / 3.6)) + vBid), 0.5, agg)) : vec3(0.05, 0.06, 0.07);
  diffuseColor.rgb = mix(base * (0.85 + 0.3 * mix(bh(floor(vec2(uF, yM) / vec2(3.0, 3.6))), 0.5, agg)), glassC, isWin * step(0.5, float(wall)));   // v6: per-cell variation averaged under a pixel too
  glass = isWin;
  if (wall) { float flI = floor(yM / 3.6), hf = bh(vec2(flI, vBid.x * 0.37 + vBid.y * 0.11)), band = step(hf, uLit * (0.55 + 0.8 * bh(vBid * 0.1))) * (1.0 - step(mod(flI + floor(bh(vBid) * 7.0), 18.0), 0.5));
    float wl = bh3(vec3(floor(uF / 1.5) + vBid.x * 0.13, flI, vBid.y)), on = band * step(wl, 0.86) + (1.0 - band) * step(wl, 0.04);
    lit = isWin * mix(on, band * 0.8 + 0.03, agg) * uNight;
    vec3 wc = mix(vec3(1.0, 0.72, 0.42), vec3(0.62, 0.78, 1.0), step(0.8, bh(vec2(floor(uF / 6.0), floor(yM / 3.6)) + vBid.yx)) * uCold * 2.0);
    emis = wc * lit * (0.35 + 0.65 * mix(bh(vec2(floor(uF / 3.0), floor(yM / 3.6)) + 3.0), 0.5, agg)); }
  if (!wall && vObjN.y > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.20, 0.21), 0.6);
}
`).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if (inClad) roughnessFactor = mix(roughnessFactor, 0.12, glass * 0.9);
`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += emis * uGlow;`);
  };
  return m;
}

// ------------------------------------------------------------------ a city plan (deterministic): blocks, buildings with start year and duration
const BRICK = [[0.30, 0.17, 0.13], [0.26, 0.15, 0.11], [0.36, 0.30, 0.22], [0.33, 0.31, 0.29], [0.24, 0.20, 0.17], [0.38, 0.27, 0.17], [0.20, 0.17, 0.16]];
function pushTower(B, b, R) {      // v5: Ferriss / 1916-envelope setbacks (americana_city Skyline) inside the growth plan
  const nT = b.h > 150 ? 3 : b.h > 75 ? 2 : 1; let y = 0, w = b.w, d = b.d, ts = b.ts;
  for (let k = 0; k < nT; k++) { const th = k === nT - 1 ? b.h - y : b.h * (k === 0 ? 0.52 + 0.1 * R() : 0.26 + 0.08 * R()); const dur = b.dur * th / b.h;
    B.push({ ...b, y0: y, w, d, h: th, ts, dur }); y += th; ts += dur * 0.85; w *= 0.7 + 0.1 * R(); d *= 0.7 + 0.1 * R(); }
}
export function planCity({ seed = 7, pitch = 150, nB = 8, style = 'new', plaza = [0, 0, 78], rail = 100, fusion = [980, -420], old = null } = {}) {
  const R = rng(seed), B = [], blocks = [];
  for (let i = -nB; i < nB; i++) for (let j = -nB; j < nB; j++) {
    const cx = (i + 0.5) * pitch, cz = (j + 0.5) * pitch, r = Math.hypot(cx, cz), d = r / (nB * pitch);
    if (Math.hypot(cx, cz) < plaza[2] + 55 && style === 'new') continue;
    if (style === 'new' && Math.abs(cz - rail) < 62) continue;                          // the viaduct and the station corridor
    if (style === 'new' && Math.hypot(cx - fusion[0], cz - fusion[1]) < 330) continue;   // fusion works
    if (d > 1.0) continue;
    blocks.push([cx, cz, d]);
  }
  for (const [cx, cz, d] of blocks) {
    const tBase = (0.2 + 7.4 * Math.pow(d, 0.9) + R() * 1.0) * (style === 'new' ? 0.9 : 1);   // years after 2027.0: from the middle outward
    const core = d < 0.30, mid = d < 0.62;
    const inner = 52 + R() * 6;
    if (style === 'new') {
      if (core) {
        const h = 120 + R() * 150 * (1 - d * 2), w = 44 + R() * 16, dd = 44 + R() * 16;
        pushTower(B, { x: cx + (R() - 0.5) * 16, z: cz + (R() - 0.5) * 16, w, d: dd, h, ts: tBase, dur: 1.0 + h / 110, type: 0, tint: [0.34, 0.37, 0.42] }, R);
        B.push({ x: cx, z: cz, w: 112, d: 112, h: 20 + R() * 10, ts: tBase - 0.2, dur: 0.9, type: 1, tint: [0.44, 0.41, 0.37] });
        if (R() < 0.8) { const ex = cx + (R() < 0.5 ? -1 : 1) * 38, ez = cz + (R() < 0.5 ? -1 : 1) * 38; B.push({ x: ex, z: ez, w: 22 + R() * 8, d: 22 + R() * 8, h: 70 + R() * 110, ts: 4.2 + R() * 3.8, dur: 1.2 + R() * 1.3, type: 0, tint: [0.30, 0.34, 0.40], extra: true }); }
      } else if (mid) {
        const n = 4, off = 30;
        for (let k = 0; k < n; k++) { const sx = k % 2 ? 1 : -1, sz = k < 2 ? -1 : 1, h = 40 + R() * 70 * (1 - d * 0.6), w = 40 + R() * 10, dd = 28 + R() * 10;
          pushTower(B, { x: cx + sx * off, z: cz + sz * off, w, d: dd, h, ts: tBase + R() * 0.9, dur: 0.9 + h / 120, type: R() < 0.4 ? 0 : 1, tint: R() < 0.5 ? [0.40, 0.27, 0.20] : [0.36, 0.37, 0.40] }, R); }
      } else {
        const n = 6;
        for (let k = 0; k < n; k++) { const gx = (k % 3 - 1) * 38, gz = (k < 3 ? -1 : 1) * 32, h = 14 + R() * 34, w = 30 + R() * 6, dd = 24 + R() * 6;
          B.push({ x: cx + gx, z: cz + gz, w, d: dd, h, ts: tBase + R() * 1.4, dur: 0.6 + h / 140, type: 1, tint: [0.38 + R() * 0.12, 0.30 + R() * 0.06, 0.24] }); }
      }
    } else {                                                                          // Gary 1906-1930: brick, two to five floors; ts in years after 1906
      const n = d < 0.45 ? 5 : 3;
      for (let k = 0; k < n; k++) { const gx = (k % 3 - 1) * 34 + (R() - 0.5) * 6, gz = (k < 3 ? -1 : 1) * 30 + (R() - 0.5) * 6, h = 7 + R() * (d < 0.35 ? 19 : 10), w = 22 + R() * 8, dd = 20 + R() * 8;
        B.push({ x: cx + gx, z: cz + gz, w, d: dd, h, ts: 1.0 + 22 * Math.pow(d, 0.85) + R() * 5, dur: 1.2 + R() * 1.4, type: 1, tint: BRICK[(R() * BRICK.length) | 0] }); }
    }
  }
  return B;
  function h0(h) { return h > 150 ? 1.2 : 0.4; }
}

// the street map for the new city as a raw RGBA texture (R: street, G: plaza and paving, B: earthwork/footprints, A: pave year 0..1)
export function cityTexture({ size = 2048, span = 2800, pitch = 150, nB = 8, plaza = [0, 0, 78], rail = 100, seed = 3 } = {}) {
  const data = new Uint8Array(size * size * 4), k = size / span, R = rng(seed);
  const set = (x, y, r, g, b, a) => { if (x < 0 || y < 0 || x >= size || y >= size) return; const i = (y * size + x) * 4; if (r) data[i] = r; if (g) data[i + 1] = g; if (b) data[i + 2] = Math.max(data[i + 2], b); if (r || g) data[i + 3] = a; };
  const yearOf = d => Math.round(255 * clamp(0.02 + 0.80 * Math.pow(d, 0.9)));
  const half = (nB * pitch);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const x = (px + 0.5) / k - span / 2, z = (py + 0.5) / k - span / 2, d = Math.hypot(x, z) / half; if (d > 1.12) continue;
    const mx = ((x % pitch) + pitch) % pitch, mz = ((z % pitch) + pitch) % pitch, onX = Math.abs(mx - 0) < 15 || Math.abs(mx - pitch) < 15, onZ = Math.abs(mz) < 15 || Math.abs(mz - pitch) < 15;
    const avenue = Math.abs(x) < 26, railRoad = Math.abs(z - rail) < 16;
    if (onX || onZ || avenue || railRoad) { const side = (Math.min(Math.abs(mx), pitch - Math.abs(mx), 9999) > 11 && onZ) || (Math.min(Math.abs(mz), pitch - Math.abs(mz)) > 11 && onX) ? 0 : 0;
      set(px, py, 255, 0, 0, yearOf(d)); }
    else if (Math.hypot(x - 0, z - 0) < 76 + 6 * Math.sin(Math.atan2(z, x) * 5)) { /* plaza below */ }
    else set(px, py, 0, 0, 120 + (R() * 20 | 0), 0);
  }
  // the plaza: a paved disc round the benchmark, paved last of the centre, with the pattern of the street grid carried through
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) { const x = (px + 0.5) / k - span / 2, z = (py + 0.5) / k - span / 2, r = Math.hypot(x, z);
    if (r < 80) { const i = (py * size + px) * 4; data[i] = 0; data[i + 1] = 255; data[i + 2] = 0; data[i + 3] = Math.round(255 * 0.30); } }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------ the instanced city
export class City {
  constructor(scene, plan, opts = {}) {
    const { cx = 0, cz = 0, startYear = 0 } = opts;
    this.scene = scene; this.plan = plan; this.c = [cx, cz]; this.group = new THREE.Group(); this.group.position.set(cx, 0, cz); scene.add(this.group);
    const n = plan.length, geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    geo.deleteAttribute('uv');
    this.mat = buildingMaterial();
    this.aClad = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); this.aClad.setUsage(THREE.DynamicDrawUsage);
    const tint = new Float32Array(n * 4); plan.forEach((b, i) => { tint.set([b.tint[0], b.tint[1], b.tint[2], b.type], i * 4); });
    geo.setAttribute('aClad', this.aClad); geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 4));
    this.mesh = new THREE.InstancedMesh(geo, this.mat, n); this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.receiveShadow = true; this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // the shadow of what is already clad (an open frame throws almost none): a second, invisible instanced mesh scaled to the cladding line
    this.shadow = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), n);
    this.shadow.frustumCulled = false; this.shadow.castShadow = true; this.shadow.receiveShadow = false; this.shadow.userData.noPrepass = true; this.shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh, this.shadow);
    // hip roofs on the masonry blocks of the old town (triangular prisms, set on a building when it is complete)
    this.roofIdx = []; plan.forEach((b, i) => { if (opts.roofs && b.type === 1) this.roofIdx.push(i); });
    if (this.roofIdx.length) {
      const sh = new THREE.Shape(); sh.moveTo(-0.5, 0); sh.lineTo(0.5, 0); sh.lineTo(0.12, 1); sh.lineTo(-0.12, 1); sh.closePath();
      const rg = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
      const rm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0 });
      this.roofs = new THREE.InstancedMesh(rg, rm, this.roofIdx.length); this.roofs.frustumCulled = false; this.roofs.castShadow = true; this.roofs.receiveShadow = true;
      const col = new THREE.Color(), R = rng(99); this.roofIdx.forEach((bi, k) => { const pal = [[0.16, 0.13, 0.12], [0.28, 0.12, 0.08], [0.20, 0.22, 0.24], [0.30, 0.20, 0.12]][(R() * 4) | 0]; col.setRGB(pal[0], pal[1], pal[2]); this.roofs.setColorAt(k, col); });
      this.group.add(this.roofs); }
    this.M = new THREE.Matrix4(); this.Z = new THREE.Matrix4().makeScale(0, 0, 0); this.state = new Float32Array(n * 2);
    this.heights = new Float32Array(n);
    this.set(startYear);
  }
  // t: years since the clock started (plan.ts is in the same units)
  set(t) {
    const P = this.plan, M = this.M;
    for (let i = 0; i < P.length; i++) {
      const b = P[i], p = clamp((t - b.ts) / b.dur);
      if (p <= 0) { this.mesh.setMatrixAt(i, this.Z); this.shadow.setMatrixAt(i, this.Z); this.aClad.setX(i, 0); this.heights[i] = 0; continue; }
      const fh = Math.max(0.4, b.h * (1 - Math.pow(1 - p, 1.6))), lag = p >= 1 ? 0 : Math.min(36, Math.max(5, 0.32 * b.h)), clad = p >= 1 ? fh + 0.01 : Math.max(0, fh - lag);
      M.compose(V3(b.x, b.y0 || 0, b.z), new THREE.Quaternion(), V3(b.w, fh, b.d)); this.mesh.setMatrixAt(i, M);
      M.compose(V3(b.x, b.y0 || 0, b.z), new THREE.Quaternion(), V3(b.w * 0.98, Math.max(0.01, clad), b.d * 0.98)); this.shadow.setMatrixAt(i, M);
      this.aClad.setX(i, clad); this.heights[i] = fh; this.state[i * 2] = p; this.state[i * 2 + 1] = fh;
    }
    this.mesh.instanceMatrix.needsUpdate = true; this.shadow.instanceMatrix.needsUpdate = true; this.aClad.needsUpdate = true;
    if (this.roofs) { const Q0 = new THREE.Quaternion(); this.roofIdx.forEach((bi, k) => { const b = P[bi], p = clamp((t - b.ts) / b.dur), ry = (bi % 2) ? Math.PI / 2 : 0;
      if (p >= 1) { const rh = 2.5 + (bi % 5) * 0.8, ax = (bi % 2) ? b.d : b.w, az = (bi % 2) ? b.w : b.d; M.compose(V3(b.x, b.h, b.z), new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), ry), V3(ax * 1.04, rh, az * 1.02)); } else M.copy(this.Z);
      this.roofs.setMatrixAt(k, M); }); this.roofs.instanceMatrix.needsUpdate = true; }
  }
  // the tallest buildings still going up at year t: [{ i, x, z, h (frame height now), p }], for the cranes
  active(t, k = 12) {
    const out = []; this.plan.forEach((b, i) => { const p = clamp((t - b.ts) / b.dur); if (p > 0 && p < 1 && b.h + (b.y0 || 0) > 45) out.push({ i, x: b.x + this.c[0], z: b.z + this.c[1], w: b.w, d: b.d, h: this.heights[i] + (b.y0 || 0), H: b.h + (b.y0 || 0), p }); });
    return out.sort((a, b) => b.H - a.H).slice(0, k);
  }
}

// ------------------------------------------------------------------ the high-speed line: viaduct deck, piers, track, catenary masts; a train; a station hall
export function buildLine(scene, { cx, cz, rail = 100, half = 7000, deckY = 9.5, parts = {} } = {}) {
  const g = new THREE.Group(); g.position.set(cx, 0, cz + rail); scene.add(g);
  const conc = new THREE.MeshStandardMaterial({ color: 0xa9a49a, roughness: 0.9 }), steel = new THREE.MeshStandardMaterial({ color: 0x35383c, roughness: 0.45, metalness: 0.7 });
  const U = { uReach: { value: 0 }, uCx: { value: cx } };
  const clip = (m) => { m.onBeforeCompile = (sh) => { sh.uniforms.uReach = U.uReach; sh.uniforms.uCx = U.uCx;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vRx;').replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\nvRx = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).x;\n#else\nvRx = (modelMatrix * vec4(transformed, 1.0)).x;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRx; uniform float uReach, uCx;').replace('#include <color_fragment>', '#include <color_fragment>\nif (abs(vRx - uCx) > uReach) discard;'); }; return m; };
  const deckMat = clip(conc.clone()), trackMat = clip(new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.55, metalness: 0.5 })), railMat = clip(steel.clone());
  const deck = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 1.6, 13).translate(0, deckY - 0.8, 0), deckMat); deck.castShadow = true; deck.receiveShadow = true; g.add(deck);
  for (const s of [-1, 1]) { const par = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 1.0, 0.5).translate(0, deckY + 0.5, s * 6.3), deckMat); par.castShadow = true; g.add(par); }
  for (const s of [-1, 1]) for (const o of [-1.2, 1.2]) { const r = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.18, 0.14).translate(0, deckY + 0.28, s * 2.6 + o * 0.72), railMat); g.add(r); }
  const bed = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.14, 9).translate(0, deckY + 0.07, 0), trackMat); g.add(bed);
  // piers: instanced, spacing 36 m
  const np = Math.floor(half * 2 / 36), pgeo = new THREE.CylinderGeometry(1.5, 2.1, deckY - 1.6, 12).translate(0, (deckY - 1.6) / 2, 0), pm = new THREE.InstancedMesh(pgeo, clip(conc.clone()), np), Mx = new THREE.Matrix4();
  for (let i = 0; i < np; i++) { Mx.makeTranslation(-half + (i + 0.5) * 36, 0, 0); pm.setMatrixAt(i, Mx); } pm.castShadow = true; pm.receiveShadow = true; pm.frustumCulled = false; g.add(pm);
  // catenary masts every 60 m
  const nm = Math.floor(half * 2 / 60), mm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 9, 0.28).translate(0, deckY + 4.5, 0), clip(steel.clone()), nm * 2);
  for (let i = 0; i < nm; i++) for (let s = 0; s < 2; s++) { Mx.makeTranslation(-half + (i + 0.5) * 60, 0, s ? 6.4 : -6.4); mm.setMatrixAt(i * 2 + s, Mx); } mm.frustumCulled = false; g.add(mm);
  return { group: g, U, deckY, setReach: r => { U.uReach.value = r; } };
}

export function buildTrain(scene, { cars = 8, len = 25, deckY = 9.5 } = {}) {
  const grp = new THREE.Group(); scene.add(grp);
  const body = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.28, metalness: 0.35 }), band = new THREE.MeshStandardMaterial({ color: 0xc22a1c, roughness: 0.4 });
  const winM = new THREE.MeshStandardMaterial({ color: 0x15191d, roughness: 0.1, emissive: new THREE.Color(1, 0.86, 0.62), emissiveIntensity: 0 });
  const head = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 7.4, 6.2), toneMapped: false });
  for (let i = 0; i < cars; i++) {
    const car = new THREE.Group(), z0 = -i * (len + 0.6);
    const sh = new THREE.Shape(); const w = 3.1, hh = 3.5; sh.moveTo(-w / 2, 0.35); sh.lineTo(w / 2, 0.35); sh.lineTo(w / 2, hh * 0.72); sh.quadraticCurveTo(w / 2, hh, w * 0.28, hh); sh.lineTo(-w * 0.28, hh); sh.quadraticCurveTo(-w / 2, hh, -w / 2, hh * 0.72); sh.closePath();
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false }), body); mesh.position.z = -len / 2; mesh.castShadow = true; car.add(mesh);
    for (const s of [-1, 1]) { const win = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, len * 0.86).translate(s * 1.56, 2.35, 0), winM); car.add(win); const st = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, len).translate(s * 1.57, 1.35, 0), band); car.add(st); }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, len * 0.8).translate(0, 3.62, 0), new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.5 })); car.add(roof);
    car.position.set(0, 0, z0); grp.add(car);
  }
  // the nose: a rounded bullet on the first car, a dark windscreen, two headlights, a red stripe along it
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18).scale(1.58, 1.65, 8.5).translate(0, 1.95, len / 2 + 1.8), body); nose.castShadow = true; grp.add(nose);
  const wind = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.42).scale(1.5, 1.2, 5.6).translate(0, 2.55, len / 2 + 4.6), new THREE.MeshStandardMaterial({ color: 0x0b0e12, roughness: 0.08, metalness: 0.4 })); grp.add(wind);
  for (const s of [-1, 1]) { const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.12).translate(s * 0.68, 1.3, len / 2 + 10.2), head); grp.add(hl); }
  const lowStripe = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.16, 0.3).translate(0, 1.15, len / 2 + 10.0), band); grp.add(lowStripe);
  grp.userData = { winM, headM: head, len: cars * (len + 0.6) + 14, deckY };
  grp.visible = false; return grp;
}

// ------------------------------------------------------------------ props: a tower crane from plain boxes (cheap shaders), and a building site
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
function barGeo(a, b, w) { const d = b.clone().sub(a), L = d.length(); const g = new THREE.BoxGeometry(w, L, w); g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()), V3(1, 1, 1))); return g; }
export function makeCrane({ h = 100, jib = 60, back = 20, paint = 0xd9a21b } = {}) {
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.6, metalness: 0.25 }), dark = new THREE.MeshStandardMaterial({ color: 0x3a3b3d, roughness: 0.7, metalness: 0.2 });
  const G = [], hs = 1.2, n = Math.max(3, Math.round(h / 3.2)), C4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of C4) G.push(barGeo(V3(sx * hs, 0, sz * hs), V3(sx * hs, h, sz * hs), 0.34));
  for (let i = 0; i < n; i++) { const y0 = i * h / n, y1 = (i + 1) * h / n;
    for (let j = 0; j < 4; j++) { const a = C4[j], b = C4[(j + 1) % 4]; G.push(barGeo(V3(a[0] * hs, y0, a[1] * hs), V3(b[0] * hs, y0, b[1] * hs), 0.16)); G.push(barGeo(V3(a[0] * hs, i % 2 ? y1 : y0, a[1] * hs), V3(b[0] * hs, i % 2 ? y0 : y1, b[1] * hs), 0.14)); } }
  const mast = new THREE.Mesh(mergeGeometries(G), mat); mast.castShadow = true; g.add(mast);
  const slew = new THREE.Group(); slew.position.y = h; g.add(slew);
  const J = [], nj = Math.round(jib / 3), top = x => V3(x, 2.4 * (1 - x / jib * 0.45), 0);
  for (let i = 0; i < nj; i++) { const xa = i * jib / nj, xb = (i + 1) * jib / nj;
    for (const s of [-1, 1]) { J.push(barGeo(V3(xa, 0, s), V3(xb, 0, s), 0.2)); J.push(barGeo(V3(xa, 0, s), top(i % 2 ? xa : xb), 0.12)); }
    J.push(barGeo(top(xa), top(xb), 0.2)); J.push(barGeo(V3(xb, 0, -1), V3(xb, 0, 1), 0.12)); }
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) J.push(barGeo(V3(-i * back / 6, 0, 1.3 * s), V3(-(i + 1) * back / 6, 0, 1.3 * s), 0.2));
  J.push(barGeo(V3(0, 0, 0), V3(0, 11, 0), 0.5)); J.push(barGeo(V3(0, 11, 0), V3(jib * 0.62, top(jib * 0.62).y, 0), 0.07)); J.push(barGeo(V3(0, 11, 0), V3(-back, 0.4, 0), 0.07));
  const jibM = new THREE.Mesh(mergeGeometries(J), mat); jibM.castShadow = true; slew.add(jibM);
  const cw = new THREE.Mesh(new THREE.BoxGeometry(back * 0.5, 3, 2.6).translate(-back * 0.7, -1.4, 0), dark); cw.castShadow = true; slew.add(cw);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 2.6).translate(1.5, -1.8, 2.4), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 })); slew.add(cab);
  const trolley = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 2.2), dark); slew.add(trolley);
  const ropeM = new THREE.MeshBasicMaterial({ color: 0x111111 }), rope = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1).translate(0, -0.5, 0), ropeM), block = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 0.9), new THREE.MeshStandardMaterial({ color: 0xd8321e, roughness: 0.6 }));
  block.castShadow = true; g.add(rope, block);
  const cr = { g, slew, h, jib };
  cr.setHook = (target, swing) => {            // target: a world point; swing: jib heading (rad), defaults toward the target
    const loc = target.clone().sub(g.position), ang = swing ?? Math.atan2(-loc.z, loc.x); slew.rotation.y = ang;
    const r = Math.max(5, Math.min(jib - 2, Math.hypot(loc.x, loc.z))), tx = Math.cos(ang) * r, tz = -Math.sin(ang) * r, hookY = Math.min(target.y + 2, h - 6);
    trolley.position.set(r, -0.9, 0); rope.position.set(tx, h - 1.3, tz); rope.scale.set(1, Math.max(0.5, h - 1.3 - hookY), 1); block.position.set(tx, hookY - 0.9, tz); block.rotation.y = ang;
  };
  cr.setHook(V3(jib * 0.5, h * 0.5, 0)); return cr;
}

export function makeSite() {   // huts, trucks, stacks, a light tower, cones, drums, a gantry of formwork: the clutter that makes a plot a site
  const g = new THREE.Group(), R = rng(21), M = (c, r = 0.8, m = 0.1) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const box = (w, h, d, x, y, z, mat, ry = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  const hutM = [M(0xe9e6df, 0.7), M(0x2c5d86, 0.7), M(0xc9c3b3, 0.7)], dark = M(0x222428), glass = new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.1, emissive: new THREE.Color(1, 0.8, 0.5), emissiveIntensity: 0 });
  g.userData.glass = glass;
  [[-22, -14, 0.1], [-22, -5, 0.05], [-14, -24, 1.55], [26, -18, -0.2], [30, 2, 0.1]].forEach(([x, z, ry], i) => { box(9, 2.7, 3.2, x, 0, z, hutM[i % 3], ry); const w = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.05), glass); w.position.set(x + Math.cos(ry) * 1.2, 1.6, z - Math.sin(ry) * 1.7); w.rotation.y = ry; g.add(w); });
  const truck = (x, z, ry, bedC) => { const t = new THREE.Group(); const b = (w, h, d, px, py, pz, mm) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mm); m.position.set(px, py + h / 2, pz); m.castShadow = true; t.add(m); };
    b(2.5, 2.6, 2.2, 0, 0.9, 3.4, M(0xc23a1c, 0.6)); b(2.5, 0.35, 7, 0, 0.9, -1.0, dark); b(2.4, 1.1, 6.4, 0, 1.25, -1.0, M(bedC, 0.7)); for (const sx of [-1, 1]) for (const pz of [3.6, -0.6, -3.6]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 14).rotateZ(Math.PI / 2), dark); wh.position.set(sx * 1.2, 0.55, pz); t.add(wh); }
    t.position.set(x, 0, z); t.rotation.y = ry; g.add(t); };
  truck(12, -22, 0.4, 0x6e7378); truck(-8, 20, -0.3, 0xb8b2a2);
  for (let k = 0; k < 6; k++) box(0.5, 0.5, 12, 18 + k % 3 * 0.7, (k / 3 | 0) * 0.5, -6 + 0 * k, M(0x55565a, 0.5, 0.6), 0);        // beams stacked
  for (let k = 0; k < 14; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 8).translate(0, 0.35, 0), M(0xff6a13, 0.7)); c.position.set(-6 + k * 1.6, 0, 15 + (k % 2) * 0.4); g.add(c); }
  for (let k = 0; k < 8; k++) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.9, 12).translate(0, 0.45, 0), M(k % 2 ? 0x2a5a8a : 0xb8872a, 0.6, 0.3)); d.position.set(-27 + (k % 4) * 1.0, 0, 8 + (k / 4 | 0) * 1.0); d.castShadow = true; g.add(d); }
  const lt = new THREE.Group(); const mast = new THREE.Mesh(new THREE.BoxGeometry(0.3, 9, 0.3).translate(0, 4.5, 0), dark); lt.add(mast); const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 0.5).translate(0, 9.2, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 7, 5.5), toneMapped: false })); lt.add(head); lt.position.set(-10, 0, -8); g.add(lt);
  g.userData.lampHead = head;
  for (let k = 0; k < 9; k++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.1).translate(0, 0.7, 0), M(0xc8c0a0)); p.position.set(-30 + k * 7.5, 0, 14); g.add(p); }   // fence posts
  return g;
}
