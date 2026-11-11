// STAGE / grounds: the ground and the set round it. Materials read the texture sets in assets/stage/ (videos/blender/stage_textures.py:
// albedo, roughness, tangent normal, a 16 m macro multiplier), the SAME files Cycles reads; UVs are world metres / tile (u = x / T,
// v = -z / T on the floor), so a floor tile lands in the same place in both renderers. The floor material also takes the stage's
// CONTACT map (contact.js): ground occlusion under and round each person's feet, on the indirect light only (a lamp or the sun
// is shadowed by its shadow map and the pipeline's contact shadows).
import * as THREE from 'three';
import { wallRatio } from './window.js';   // (CAMERA7 c3 i2) the light a window gives the wall behind the sitter, as a factor on the directional key's
import { roomGeometry } from './room.js';   // (CAMERA7 c4) the furniture: real geometry, the same triangles Cycles reads (assets/stage/<set.room.file>)

export const ASSETS = new URL('../../../assets/stage/', import.meta.url).href;
const texCache = new Map();
async function tex(name, srgb) {
  const url = ASSETS + name; if (texCache.has(url)) return texCache.get(url);
  const p = new THREE.TextureLoader().loadAsync(url).then(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; return t; });
  texCache.set(url, p); return p;
}

// a stage material: albedo x macro, roughness, normal; contact (a ContactMap) optional. opts: { tint [r,g,b], rough (multiplier),
// normalScale, macro (true), envGain }
export async function stageMaterial(name, { contact = null, tint = null, rough = 1, normalScale = 1, macro = true, macroScale = 16 } = {}) {
  const [map, rmap, nmap, mmap] = await Promise.all([tex(`${name}_albedo.jpg`, true), tex(`${name}_rough.jpg`, false), tex(`${name}_normal.jpg`, false), tex(`${name}_macro.jpg`, false)]);
  const m = new THREE.MeshStandardMaterial({ map, roughnessMap: rmap, normalMap: nmap, roughness: rough, metalness: 0, normalScale: new THREE.Vector2(normalScale, normalScale) });
  if (tint) m.color.setRGB(...tint);
  const U = m.userData.stageU = {
    uStageMacro: { value: mmap }, uStageMacroOn: { value: macro ? 1 : 0 }, uStageMacroS: { value: macroScale },
    uStageContact: { value: contact ? contact.texture : null }, uStageContactOn: { value: contact ? 1 : 0 }, uStageContactBox: { value: contact ? contact.box : new THREE.Vector4(0, 0, 1, 1) } };
  m.userData.stageContact = contact;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vStageW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvStageW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vStageW; uniform sampler2D uStageMacro, uStageContact; uniform float uStageMacroOn, uStageMacroS, uStageContactOn; uniform vec4 uStageContactBox;
float stageContact(){ if (uStageContactOn < 0.5) return 1.0;
  vec2 uv = vec2((vStageW.x - uStageContactBox.x) / uStageContactBox.z, (uStageContactBox.y - vStageW.z) / uStageContactBox.w);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0; return texture2D(uStageContact, uv).r; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
if (uStageMacroOn > 0.5) diffuseColor.rgb *= 2.0 * texture2D(uStageMacro, vec2(vStageW.x, -vStageW.z) / uStageMacroS).r;`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
{ float c_ = stageContact(); reflectedLight.indirectDiffuse *= c_; reflectedLight.indirectSpecular *= c_; }`);
  };
  m.customProgramCacheKey = () => 'stage3';
  return m;
}
export function setContact(m, contact) {
  const U = m.userData.stageU; if (!U) return;
  U.uStageContact.value = contact ? contact.texture : null; U.uStageContactOn.value = contact ? 1 : 0; if (contact) U.uStageContactBox.value = contact.box;
}

// world-metre UVs on a mesh: f(position) -> [u, v]
function worldUV(g, f) { const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { const [u, v] = f(p.getX(i), p.getY(i), p.getZ(i), i); uv[i * 2] = u; uv[i * 2 + 1] = v; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g; }

// the floor: a plane (size m), UV = (x, -z) / tile
export function floorGeometry(size = 120, tile = 2) {
  return worldUV(new THREE.PlaneGeometry(size, size, 1, 1).rotateX(-Math.PI / 2), (x, y, z) => [x / tile, -z / tile]);
}
// the paper sweep's profile: floor from z = front back to z = -back, a quarter-circle cove of radius R, then the wall up to height.
// Returns [{ y, z, s, ny, nz }] (s: arc length from the front, the paper's v); shared with Cycles (stage_scene.py sweep_profile).
export function sweepProfile({ back = 3.4, cove = 1.6, height = 7, front = 16, n = 24 } = {}) {
  const P = [], R = cove; let s = 0;
  P.push({ y: 0, z: front, s: 0, ny: 1, nz: 0 }); s = front + back; P.push({ y: 0, z: -back, s, ny: 1, nz: 0 });
  for (let i = 1; i <= n; i++) { const th = i / n * Math.PI / 2; P.push({ y: R - R * Math.cos(th), z: -back - R * Math.sin(th), s: s + R * th, ny: Math.cos(th), nz: Math.sin(th) }); }
  s += R * Math.PI / 2; P.push({ y: height, z: -back - R, s: s + height - R, ny: 0, nz: 1 });
  return P;
}
export function sweepGeometry(o = {}, tile = 2) {
  const P = sweepProfile(o), w = (o.width ?? 30) / 2, pos = [], nrm = [], uv = [], idx = [];
  for (const p of P) for (const x of [-w, w]) { pos.push(x, p.y, p.z); nrm.push(0, p.ny, p.nz); uv.push(x / tile, (p.s - (o.front ?? 16)) / tile); }
  for (let i = 0; i < P.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); return g;
}
// a vertical wall facing +z at z = -back (width, height), UV = (x, y) / tile
export function wallGeometry({ back, width = 30, height = 4, y0 = 0, field = null }, tile = 2) {
  if (!field) { const g = new THREE.PlaneGeometry(width, height, 1, 1); g.translate(0, y0 + height / 2, -back); return worldUV(g, (x, y) => [x / tile, y / tile]); }
  // (CAMERA7 c3 i2) a wall the key's directional light does not light as the room does: a grid (0.25 m over the central 16 m, the rest coarse) whose vertex colour is the factor
  // field(x, y) -> rgb (window.js wallRatio: the window's irradiance over the directional key's), so the wall receives what the finite window gives it (a fall-off with distance and tilt)
  const xs = [-width / 2]; for (let x = -8; x <= 8.0001; x += 0.25) if (x > -width / 2 + 0.01 && x < width / 2 - 0.01) xs.push(+x.toFixed(3)); xs.push(width / 2);
  const ys = []; for (let y = 0; y < height - 0.01; y += 0.35) ys.push(+y.toFixed(3)); ys.push(height);
  const pos = [], nrm = [], uv = [], col = [], idx = [];
  for (const y of ys) for (const x of xs) { pos.push(x, y0 + y, -back); nrm.push(0, 0, 1); uv.push(x / tile, y / tile); col.push(...field(x, y0 + y)); }
  for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) { const a = j * xs.length + i, b = a + 1, c = a + xs.length, d = c + 1; idx.push(a, b, d, a, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); return g;
}

// (CAMERA7 c4) the furniture as meshes: room.js's triangles (the flat-shaded boxes, the smooth cloth, leaves and pot), vertex colour = linear albedo x `ratio(x, y)` (the window's irradiance on the wall at that
// place over the directional key's: the engine's one key lights the room as a window would). They cast and receive the key's shadow and the pipeline's ambient occlusion like any solid.
const _roomMat = new Map();
export function roomMeshes(set, ratio = null) {
  const R = set.room, room = roomGeometry(R.seed, { x0: R.x0, w: R.w, h: R.h, back: set.back, seat: R.seat }), out = [];
  for (const k of ['flat', 'smooth']) {
    const G = room[k]; if (!G.i.length) continue;
    const col = new Float32Array(G.c.length); for (let v = 0; v < G.p.length / 3; v++) { const r = ratio ? ratio(G.p[v * 3], G.p[v * 3 + 1]) : [1, 1, 1]; col[v * 3] = G.c[v * 3] * r[0]; col[v * 3 + 1] = G.c[v * 3 + 1] * r[1]; col[v * 3 + 2] = G.c[v * 3 + 2] * r[2]; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(G.p, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(G.i, 1)); g.computeVertexNormals();
    if (!_roomMat.has(k)) _roomMat.set(k, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, side: k === 'smooth' ? THREE.DoubleSide : THREE.FrontSide }));
    const m = new THREE.Mesh(g, _roomMat.get(k)); m.castShadow = true; m.receiveShadow = true; m.userData.stage = 'room_' + k; out.push(m);
  }
  return { meshes: out, room };
}

// the set: { objects (meshes to add), floor (the mesh that takes the contact map) }
export async function buildSet(S, contact) {
  const set = S.set || { kind: 'plane' }, T = S.tile ?? 2, objects = [];
  const floorMat = await stageMaterial(S.ground, { contact, tint: set.tint || null });   // (CAMERA7: a coloured seamless; no set has one before '@7')
  let floor;
  if (set.kind === 'sweep') {
    floor = new THREE.Mesh(sweepGeometry(set, T), floorMat);
  } else {
    floor = new THREE.Mesh(floorGeometry(set.kind === 'yard' ? 400 : 120, T), floorMat);
  }
  floor.receiveShadow = true; floor.userData.ground = true; floor.userData.stage = 'floor'; objects.push(floor);
  if (set.kind === 'room') {
    const wm = await stageMaterial(set.wall || 'plaster', { macro: true, tint: set.wallTint || null });
    const field = S.key && S.key.emitter ? wallRatio(S.key, set.back) : null;   // (CAMERA7 c3 i2) the window as one emitter lights the wall: no lamp
    if (field) wm.vertexColors = true;
    const wall = new THREE.Mesh(wallGeometry({ back: set.back, width: set.width, height: set.height, field }, T), wm); wall.receiveShadow = true; wall.userData.stage = 'wall'; objects.push(wall);
    if (set.room) objects.push(...roomMeshes(set, field).meshes);   // (CAMERA7 c4) the furniture: real geometry
    if (set.skirting) { const sk = new THREE.Mesh(new THREE.BoxGeometry(set.width, set.skirting, 0.02), new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.07, 0.065, 0.06), roughness: 0.45 }));
      sk.position.set(0, set.skirting / 2, -set.back + 0.01); sk.receiveShadow = true; sk.castShadow = true; sk.userData.stage = 'skirting'; objects.push(sk); }
  }
  if (set.kind === 'yard') {
    const wm = await stageMaterial(set.wall || 'concrete', { macro: true, tint: set.wallTint || null });
    const wall = new THREE.Mesh(wallGeometry({ back: set.back, width: set.width, height: set.height }, T), wm); wall.receiveShadow = true; wall.castShadow = true; wall.userData.stage = 'wall'; objects.push(wall);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(set.width, 0.08, 0.32), new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.2, 0.195, 0.185), roughness: 0.85 }));
    cap.position.set(0, set.height + 0.04, -set.back + 0.08); cap.castShadow = true; cap.receiveShadow = true; cap.userData.stage = 'cap'; objects.push(cap);
  }
  return { objects, floor };
}
