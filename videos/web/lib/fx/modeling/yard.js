// MODELING yard (MODELING studio, cycle 1): container stacks as instanced catalogued assets, in a dozen invented liveries,
// five-high the way Port Newark-Elizabeth stacks them. The stack is the place; the eye reads it by height, colour breaks,
// corrugation under a raking light and the big lettering, so those are what varies.
//
//   const yard = await buildYard({ blocks: [{ x: 6, z0: -20, bays: 14, cols: 3, tiers: [3, 5] }], seed: 4 });
//   scene.add(yard.group); yard.boxes   // every box: { x, y, z, ry, variant, tier }
import * as THREE from 'three';
import { loadAsset } from './asset.js';
import { wearMaterial } from './materials.js';
import { containerSide, OWNERS, LIVERIES, rngOf } from './decals.js';
import { L, Wd, Ht } from './assets/container_40hc.js';

export { L as BOX_L, Wd as BOX_W, Ht as BOX_H };

// a block: long axis along Z, `cols` columns across X, `bays` boxes along Z, tiers [min, max] (biased high)
export function stackBlock({ x = 0, z0 = 0, bays = 10, cols = 3, tiers = [3, 5], gapZ = 0.35, gapX = 0.3, seed = 1, variants = 12, missing = 0.04, flipDoors = true }) {
  const R = rngOf(seed), boxes = []; let runV = Math.floor(R() * variants), run = 0;
  for (let b = 0; b < bays; b++) for (let c = 0; c < cols; c++) {
    const h = Math.round(tiers[0] + (tiers[1] - tiers[0]) * Math.pow(R(), 0.6));
    for (let t = 0; t < h; t++) {
      if (R() < missing && t > 0) break;
      if (run <= 0) { runV = Math.floor(R() * variants); run = 1 + Math.floor(R() * 4); } run--;
      boxes.push({ x: x + c * (Wd + gapX), y: t * Ht, z: z0 + b * (L + gapZ) + L / 2, ry: flipDoors && R() < 0.5 ? Math.PI : 0, variant: runV, tier: t, bay: b, col: c });
    }
  }
  return boxes;
}

export async function buildYard({ boxes, variants = 12, seed = 1, lod = 0, texW = 1024, texH = 256, paints = {} } = {}) {
  const R = rngOf(seed), group = new THREE.Group(); group.name = 'yard';
  const base = await loadAsset('containers/container_40hc', { lod });
  const perVariant = Array.from({ length: variants }, () => []); boxes.forEach(b => perVariant[b.variant % variants].push(b));
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const meshes = [];
  base.root.updateMatrixWorld(true);
  const parts = []; base.root.traverse(o => { if (o.isMesh) parts.push(o); });
  for (let v = 0; v < variants; v++) {
    const list = perVariant[v]; if (!list.length) continue;
    const col = LIVERIES[v % LIVERIES.length], own = OWNERS[(v * 3 + Math.floor(R() * 3)) % OWNERS.length];
    const tex = containerSide({ base: col, owner: own, seed: seed * 100 + v, rust: 0.35 + R() * 0.5, fade: R() * 0.5, w: texW, h: texH, tare: 3500 + Math.floor(R() * 500) });
    const c = new THREE.Color(col);
    const mats = {
      'cont.side': wearMaterial({ color: 0xffffff, map: tex, rough: 0.55, metal: 0.25, wear: { edge: 0.25, grime: 0.35, rust: 0.55, rustC: 0x5a2a12, edgeC: 0xb0a690, ao: 1 } }),
      'cont.frame': wearMaterial({ color: c.clone().multiplyScalar(0.8), rough: 0.6, metal: 0.25, wear: { edge: 0.4, grime: 0.4, rust: 0.7, edgeC: 0xb0a690 } }),
      'cont.front': wearMaterial({ color: c, rough: 0.6, metal: 0.25, wear: { edge: 0.3, grime: 0.35, rust: 0.5 } }),
      'cont.doors': wearMaterial({ color: c.clone().multiplyScalar(0.92), rough: 0.6, metal: 0.25, wear: { edge: 0.3, grime: 0.4, rust: 0.5 } }),
      'cont.roof': wearMaterial({ color: c.clone().multiplyScalar(0.7), rough: 0.7, metal: 0.2, wear: { grime: 0.5, rust: 0.6 } }),
      'cont.casting': wearMaterial({ color: 0x6b6a64, rough: 0.7, metal: 0.6, wear: { rust: 0.6, grime: 0.5, edge: 0.3 } }),
      'cont.rods': wearMaterial({ color: 0x9aa0a3, rough: 0.5, metal: 0.9, wear: { rust: 0.5, grime: 0.4 } }),
      ...paints,
    };
    for (const p of parts) {
      const im = new THREE.InstancedMesh(p.geometry, mats[p.material?.name] || mats['cont.frame'], list.length);
      list.forEach((b, i) => { Q.setFromAxisAngle(Y, b.ry); P.set(b.x, b.y, b.z); M.compose(P, Q, S); im.setMatrixAt(i, M); });
      im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; group.add(im); meshes.push(im);
    }
  }
  return { group, boxes, meshes, dispose() { for (const m of meshes) m.dispose(); } };
}
