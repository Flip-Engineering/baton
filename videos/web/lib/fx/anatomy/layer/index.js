// ANAT8 LAYER CORE (ANAT8-HEAD wrote it first, 8 Oct; ANAT8-BODY shares it): anatomy built from the inside out as LAYERS of solids,
// and the skin as a membrane over them, fitted onto an existing mesh (hm08) so its topology, UVs, rig weights and every downstream
// system keep working. Pure JS, node or browser, no three.js. Units: millimetres in the anatomy's own frame (the caller converts).
//
// THE MODEL. A layer is a set of SOLIDS (sdf.js primitives and scenes: bone, cartilage, teeth, globes, muscles, fat pads), each with a
// label (the tissue or part it is). The tissue under the skin is the union of the layers; its signed distance phi_sub is sampled on a
// grid (grid.js) for speed. The skin is the level set phi_sub = s (s = skin thickness), solved as a MEMBRANE (envelope.js): contact (the
// skin never passes into the tissue), attraction (held to it by the subcutaneous retinacula), tension (it bridges what is narrower than
// its stiffness: the loose fat fills under it), tethers (the retaining ligaments tie it to bone). Then the existing mesh is FITTED
// (fit.js): a thin-plate warp by landmarks, its FORM (a low-pass) solved onto the membrane, its DETAIL (the remainder, in local frames)
// put back on: the anatomy decides the form, the mesh keeps its small features and its identity as a mesh.
//
// API (see each file's header):
//   sdf.js       sphere, ellipsoid, roundCone, capsule, tube, box, torus, halfSpace, sheet (a lofted plate with a thickness per point),
//                triSlab, quadSlab, mirrorX, offset; scene() with add / smooth / sub / inter (scenes nest: a bone is a scene, a skull a
//                scene of bones; a blend radius may be a function of position, k(x, y, z) with k.max); labelAt, gradient, rayHit, project;
//                smin / smax; v3 vector helpers; basis()
//                REV 2 (it2): sweep (a section along a spine: an asymmetric superellipse per control point, Catmull-Rom refined; the
//                body of a bone with a section, a muscle belly, a ribbon), smoothSheet (a sheet refined by Catmull-Rom in both directions:
//                no corrugation), heightSlab (a plate whose front is an analytic function z = f(x, y), thickness along its normal, inside a
//                2-D region: regionBox, regionPoly), custom, squeeze (shorten a solid on one side of a plane), catmull, bvh (a bounding-
//                volume tree whose bound stays valid inside solids). Sheets and sweeps use the bvh; the scene culls a subtraction that
//                cannot change the distance (exact: tested).
//   grid.js      sampleField(S, box, h, { band }) -> { value, grad, F, dims, origin, h }; makeField; mapField (union / offset of grids);
//                surfaceNets(G, { labels: S }) -> { pos, idx, label, part } (closed meshes for display and measurement); meshStats;
//                meshComponents(M), dropSmall(M, minVerts) (rev 2: stray shards from features thinner than the net)
//                REV 3 (it4): redistance(G, { keep }) (a sampled field made a TRUE Euclidean distance to its zero level by closest-point
//                propagation: an SDF of slabs, sweeps and smooth unions under-reads away from its surface, and every layer that reads
//                'distance from the bone' needs the real one; tested 0.3 mm max to 26 mm), blurField(G, sigma) (rounds what is narrower
//                than ~2 sigma), keepComponents(G, seed) (drops the inside islands that hold no seed)
//   envelope.js  solveEnvelope({ P, adj, set, level, grad, w, contact, alpha, detail, tethers, iters, maxStep }) -> { P, report };
//                skinLevel(subField, thickness)
//   fit.js       adjacencyOf, tpsFit / tpsApply / solveLin, umbrella, lowpass (Taubin), vertexNormals, encodeDetail / decodeDetail
//
// THE SKIN ON hm08 (it4, head/membrane.js; for ANAT8-BODY to reuse or move here): sample the skin's level once over the part's box,
// keepComponents (islands), blurField (1.5-2 mm), redistance -> E; then a smooth DISPLACEMENT of hm08's vertices solved by Gauss-Seidel
// on (W + lambda L) U = W T, T the step onto E along each vertex's own normal, re-linearised; weight 0 where hm08's own feature must stay
// (the membrane carries it), U = 0 on locked vertices (a seam, the lids), contact with the bone as a strong spring then a hard push.
// FOR A BODY PART (ANAT8-BODY): build the bones and muscles as solids in the part's frame (mm), the fat as solids or as an offset of the
// muscle layer (sdf.offset with a thickness function), sample phi_sub over the part's box (h 1.5-2.5 mm on the body), give solveEnvelope
// hm08's body vertices of that part (set), their weights (w: 0 where the skin must keep its input, e.g. at a seam with another part),
// the tethers where bone is subcutaneous (clavicle, sternum, iliac crest, tibia: f = phi_bone - depth) and at the folds; keep hm08's
// detail with encodeDetail / decodeDetail. Ask ANAT8-HEAD (its NOTES.md) for changes here.
export * from './sdf.js';
export * from './grid.js';
export * from './envelope.js';
export * from './fit.js';
export const LAYER_VERSION = 3;
// THE LAYER CONTRACT (the orchestrator, 8 Oct, both ANAT8 lanes): a Layer = { d(x, y, z): signed distance in METRES in the person's BIND
// space (negative inside), aabb: [x0, y0, z0, x1, y1, z1] metres bind, labelAt(x, y, z) -> { part, kind } }. A lane may build in its own
// frame and units (the head: millimetres in the craniometric frame) and expose a Layer through its frame transform: layerFromFrame.
//   toMm(p_bind) -> q (frame mm), toBind(q) -> p (bind m); S an sdf.js scene in that frame; kinds: label -> kind name
export function layerFromFrame(S, toMm, toBind, kinds = {}, name = S.name || 'layer') {
  const a = S.aabb, corners = []; for (const x of [a[0], a[3]]) for (const y of [a[1], a[4]]) for (const z of [a[2], a[5]]) corners.push(toBind([x, y, z]));
  const aabb = [0, 1, 2].map(k => Math.min(...corners.map(c => c[k]))).concat([0, 1, 2].map(k => Math.max(...corners.map(c => c[k]))));
  return { name, aabb, d: (x, y, z) => { const q = toMm([x, y, z]); return S.d(q[0], q[1], q[2]) / 1000; },
    labelAt: (x, y, z) => { const q = toMm([x, y, z]); S.d(q[0], q[1], q[2]); const lab = S.kind === 'scene' ? S.label_ : S.label; return { part: S.kind === 'scene' ? S.part : S.name, kind: kinds[lab] ?? String(lab) }; } };
}
