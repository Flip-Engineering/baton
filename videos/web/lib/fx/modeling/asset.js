// MODELING asset loader: a catalogued .glb (web/assets/objects/<type>/<name>.glb, built by scripts/model_build.mjs) into a
// three.js group whose parts wear the house materials (materials.js) by the name each part carries.
//
//   const a = await loadAsset('cobot/cobot_wrist', { paints: { 'paint.cobot': { color: 0x222 } } });
//   scene.add(a.root); a.part('ring_a')            // a mesh by part name
//   a.anchors.flange                               // [x, y, z] named points the builder recorded
//   a.setEmissive('emit.ring', color, intensity)   // drive an event light on every mesh of a material
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { matFor } from './materials.js';

const BASE = new URL('../../../assets/objects/', import.meta.url).href;
const cache = new Map();

// gen: a generation built beside the published files (model_build.mjs --gen <tag>: <name>.<tag>.glb, .<tag>.lod1.glb, ...),
// e.g. { gen: 'weld' } for the 8 Oct rebuild whose LOD1s reduce. Unset: the published files, as before.
export async function loadAsset(name, { paints = {}, lod = 0, shadows = true, base = BASE, gen = null } = {}) {
  const url = base + name + (gen ? '.' + gen : '') + (typeof lod === 'string' ? '.' + lod : lod ? '.lod1' : '') + '.glb';
  if (!cache.has(url)) cache.set(url, new GLTFLoader().loadAsync(url));
  const gltf = await cache.get(url);
  const root = gltf.scene.clone(true);
  const parts = {}, mats = {};
  root.traverse(o => {
    if (o.isMesh) {
      const key = o.material?.name || o.userData?.mat || 'default';
      o.material = matFor(key, paints); o.castShadow = shadows; o.receiveShadow = shadows;
      const pn = o.userData?.part || o.name; parts[pn] = o; (mats[key] ||= []).push(o);
    }
  });
  let anchors = {}; root.traverse(o => { if (o.userData?.anchors && Object.keys(o.userData.anchors).length) anchors = o.userData.anchors; });
  const box = new THREE.Box3().setFromObject(root);
  return {
    root, anchors, parts, mats, box, url,
    part: n => parts[n],
    setEmissive(matName, color, intensity) { for (const m of mats[matName] || []) { m.material = m.material.clone(); m.material.emissive.set(color); m.material.emissiveIntensity = intensity; } },
    // per-frame: intensity for an emissive material (materials are shared per name, so this is one write)
    glow(matName, intensity, color) { const m = matFor(matName, paints); m.emissiveIntensity = intensity; if (color !== undefined) m.emissive.set(color); },
    anchor(n, into = new THREE.Vector3()) { const a = anchors[n]; return a ? into.set(...a).applyMatrix4(root.matrixWorld) : into; },
  };
}

// A kitbash part (CC0, Poly Haven) with its own PBR textures: web/assets/objects/parts/<name>.glb, catalogued by
// scripts/model_ingest.mjs. Unlike loadAsset it keeps the part's materials; `tint` multiplies the base colour (to sit it in a
// piece's light) and `wear` darkens it (grime) so a clean photographed prop belongs to a worked-in scene.
//
// GRAPHICS 4.C (8 Oct), all opt-in (the defaults load parts/<name>.glb exactly as before):
//   lod: 0 the hero role (<name>.glb), 1 the mid role (<name>.lod1.glb), 'far' (<name>.far.glb), written by
//        model_ingest.mjs --roles; or 'auto': a THREE.LOD of the roles that exist, switched by the projected height of the
//        prop's longest side on a 1920 px high frame: hero above px[0], mid above px[1], far below. `camera` (a
//        PerspectiveCamera) is required for 'auto'; the camera each render passes is used after that, so a lens change or a
//        scaled root keeps the switch at the same pixel size. No hysteresis: a frame's level depends on that frame only.
//   lit: true (or litPatch options) chains light/patch.js litPatch onto every material, for scenes on the light/ pipeline.
const ROLE_SUFFIX = { 0: '', 1: '.lod1', far: '.far' };
async function partRoot(url, tint, rough, shadows) {
  if (!cache.has(url)) cache.set(url, new GLTFLoader().loadAsync(url));
  const gltf = await cache.get(url), root = gltf.scene.clone(true);
  root.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(tint)); if (rough != null) o.material.roughness = rough; o.castShadow = shadows; o.receiveShadow = shadows; } });
  return root;
}
export async function loadPart(name, { tint = 0xffffff, rough = null, shadows = true, base = BASE, lod = 0, camera = null, lit = false, px = [360, 96] } = {}) {
  const urlOf = l => base + 'parts/' + name + (ROLE_SUFFIX[l] ?? '.' + l) + '.glb';
  let root, url;
  if (lod !== 'auto') { url = urlOf(lod); root = await partRoot(url, tint, rough, shadows); }
  else {
    if (!camera?.isPerspectiveCamera) throw new Error(`loadPart ${name}: lod 'auto' needs { camera } (a PerspectiveCamera)`);
    const levels = [];   // [px below which this role shows, object]; a missing mid or far role is skipped
    for (const [l, below] of [[0, Infinity], [1, px[0]], ['far', px[1]]]) { try { levels.push([below, await partRoot(urlOf(l), tint, rough, shadows)]); } catch (e) { if (l === 0) throw e; } }
    const s = new THREE.Box3().setFromObject(levels[0][1]).getSize(new THREE.Vector3()), size = Math.max(s.x, s.y, s.z);
    root = new THREE.LOD(); root.name = name; url = urlOf(0);
    levels.forEach(([, o], i) => root.addLevel(o, i, 0));
    const fpx = cam => 960 / Math.tan(THREE.MathUtils.degToRad((cam?.isPerspectiveCamera ? cam : camera).fov) / 2);   // focal length in px of a 1920 px high frame
    const update = root.update.bind(root);
    root.update = cam => {   // a role starts at the distance where the prop's projected size drops below its px
      const k = size * fpx(cam) * root.matrixWorld.getMaxScaleOnAxis();
      root.levels.forEach((L, i) => { L.distance = i === 0 ? 0 : k / levels[i][0]; L.hysteresis = 0; });
      update(cam);
    };
    root.updateMatrixWorld(true); root.update(camera);
  }
  if (lit) { const { litPatchAll } = await import('../light/patch.js'); litPatchAll(root, lit === true ? {} : lit); }
  const parts = {}; for (const c of (root.isLOD ? root.levels[0].object : root).children) parts[c.name] = c;   // --pieces: the kit's named top-level parts
  return { root, box: new THREE.Box3().setFromObject(root.isLOD ? root.levels[0].object : root), url, parts, part: n => parts[n] };
}
