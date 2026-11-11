// FACE (HUMAN c8 P2): a face generator. Every person gets a face of their own, built from structure (ANSUR II and Farkas-style
// craniofacial measures by sex, age and group, fitted on MakeHuman CC0 levers), feature variation as data, real asymmetry, the soft
// tissue's change with age, and the small forms (nasolabial fold, philtrum, lids, alar crease ...). Opt-in: nothing imports this unless
// it asks; a person nobody passes through it renders exactly as before.
//   const F = await loadFaceStudio();                                  // ~1 MB once (assets/face/)
//   const src = sourceOf(p);                                           // a lane A person (castBody / loadCast) ...
//   const src = sourceOf(data, 'rosa');                                // ... or any hero data object + variant (CREW8: give sex / age / group)
//   const face = makeFace(F, src, { averageness: 0, symmetry: 0, dimorphism: 0, look: 'common' | 'pleasant' | 'attractive', seed });
//   const q = withFace(src, face);                                     // a hero data object: new Hero(q, { ...opts, variant: q.variant })
//   face.targets, face.after (faceMeasures), face.levers, face.features, face.asym, face.forms, face.homogeneity (for lane B's applySkin)
export { loadFaceStudio, makeFaceStudio } from './data.js';
export { makeFace, withFace, sourceOf, fitHeroFeatures, FIT, LOOKS, vnormals, spacing, drawAsym } from './face.js';
export { faceMeasures, MEASURES, pupils } from './measure.js';
export { drawTargets, drawFeatures, FEATURES, groupMix } from './sample.js';
export { formsField, evalForms, buildForms, faceFrame, formAt, faceDetail } from './forms.js';
// at P1's resolution: import { registerDetail } from '../body/detail.js'; registerDetail('face', faceDetail); then applyDetail(h, q, { level })
import { loadFaceStudio } from './data.js';
import { makeFace, withFace, sourceOf } from './face.js';
// one call: a person -> the same person with their own face (a hero data object)
export async function facePerson(person, spec = {}, { F = null, variant = null } = {}) {
  F ||= await loadFaceStudio(); const src = sourceOf(person, variant); const face = makeFace(F, src, spec); return withFace(src, face);
}
export { tps, warpAt, evalWarp, headZone, plan, buildWarp, applyWarp } from './warp.js';
// FACE c2 (rev 2, opt-in: makeFace(F, src, { rev: 2, look })): the cited jaw, soft tissue, lips, lids and resting expression; after
// applySkin, fitLipMask(h, face.c2.lipsMask) fits lane B's painted vermilion; face.c2.skin / face.c2.eyes carry the look's params
export { fitLipMask, LOOKS_C2, SKIN_C2, JAW, TISSUE_C2, LIPS, jawSites, lipColumns, lipMeasures, lidMeasure, mrd1Target, MESH_BMI_C2 } from './c2.js';
