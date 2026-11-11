// ANATOMY / SKELETON (ANAT8-BODY, 8 Oct 2026): the person's bones as signed distance fields, placed by the rig's joints (NOTES:
// review/studio_human_c8/after/anat8_body/NOTES.md). Opt-in: nothing imports this unless it asks.
//   import { bodyOf, buildSkeleton, tissueReport, meshPart } from '.../lib/fx/anatomy/skeleton/index.js';
//   const B = bodyOf(S, built, rec), K = buildSkeleton(B), R = tissueReport(B, K), m = meshPart(K.parts[0], 0.003);
export { bodyOf, profile, nearestSkin, skinNormals, oralLining } from './body.js';
export { buildSkeleton, tissueReport, DIMS, TISSUE, SKELETON_VERSION, FACE_IDS } from './build.js';
export { part, sdPart, sdParts, gradPart, meshPart, mergeMeshes, cone, sphere, ell, box, tri, tube, sheet, ribbon, smin, accelPart } from './sdf.js';
export { ribBands, chestLevels } from './chest.js';
// the shared Layer interface (the orchestrator's coordination note, 8 Oct 05:02): { d(x, y, z) metres in the person's bind space (negative inside),
// aabb [x0, y0, z0, x1, y1, z1], labelAt(x, y, z) -> { part, kind, group } }. An adapter over the parts (a hard min between bones), until layer/ absorbs it.
import { sdParts as _sdParts } from './sdf.js';
export function skeletonLayer(K, { maxD = 0.25 } = {}) {
  const bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; for (const p of K.parts) for (let a = 0; a < 3; a++) { bb[a] = Math.min(bb[a], p.bb[a]); bb[a + 3] = Math.max(bb[a + 3], p.bb[a + 3]); }
  return { name: 'skeleton', kind: 'bone', aabb: bb, d: (x, y, z) => _sdParts(K.parts, x, y, z, maxD).d,
    labelAt: (x, y, z) => { const r = _sdParts(K.parts, x, y, z, maxD); const p = r.i >= 0 ? K.parts[r.i] : null; return p ? { part: p.name, kind: p.kind, group: p.group, d: r.d } : null; } };
}
