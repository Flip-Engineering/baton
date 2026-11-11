// CLOTH7 (round 6): a wardrobe person baked with CLOTH6's solver (cloth6/bake6.js) and CLOTH7's construction INSIDE the bake (the same
// passes cloth7_rebuild.mjs applies to a finished bake): bands attached (attach7.js: the garment cloth eased into the waistband ring, the cuff
// joins, rib cuffs and hem bands), turned hems, cuff facings and front facings as layers of the garment's own mesh (construct7.js). For the
// outfits it re-solves (the chore coats, the hard cases); assets/person/v7c/ holds v6c's solved cloth rebuilt for the others.
//   bakeCloth7(S, e, outfit, { log, attach, fold, coat, ...bakeCloth6's options })
//   coat (opt-in): the chore coat placed and sewn as CLOTH7 measured it best (COAT7 below)
import { bakeCloth6 } from '../cloth6/bake6.js';
import { attach7 } from './attach7.js';
import { rebuild7 } from './construct7.js';
import { boneMats, skinPose } from '../collide.js';
export const CLOTH7_VERSION = 1, V7C_DIR = 'v7c';
export const COAT7 = {};   // filled from the coat experiments (NOTES.md)
export async function bakeCloth7(S, e, outfit, { log = () => {}, attach = true, fold = true, coat = null, ...rest } = {}) {
  const t0 = Date.now(), rep7 = {};
  const post = async (h, Sx, parts, G, c) => { h.group.updateMatrixWorld(true); const M = boneMats(h.skeleton, h.body.matrixWorld), scale = c.scale, g = h.body.geometry, nb = g.attributes.position.count;
    const body = { X: skinPose(Float64Array.from(g.attributes.position.array), g.attributes.skinIndex.array, g.attributes.skinWeight.array, M, new Float64Array(nb * 3), scale), T: Int32Array.from(g.index.array) };
    if (attach) rep7.attach = attach7(parts, { M, scale, log: c.log }); if (fold) rep7.fold = rebuild7(parts, { M, scale, body, log: c.log }).report; return rep7; };
  const co = coat ? { ...COAT7, ...(typeof coat === 'object' ? coat : {}) } : {};
  const r = await bakeCloth6(S, e, outfit, { log, ...co, ...rest, fix: { ...(rest.fix || {}), post } });
  r.report.cloth7 = { version: CLOTH7_VERSION, attach: !!attach, fold: !!fold, coat: coat ? co : null, ...rep7, ms: Date.now() - t0 };
  return r;
}
