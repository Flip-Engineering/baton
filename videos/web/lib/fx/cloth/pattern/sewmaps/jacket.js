// SEWMAP / JACKET (CLOTHING K4, the wardrobe): a chore coat / canvas work jacket cut on K2's shirt (FreeSewing Simon / Simone, MIT): a
// chore coat IS a boxy shirt-cut jacket (a turned-down collar on a band, set-in sleeves, patch pockets), drafted here with jacket ease
// (wardrobe4/garments4.js), worn OPEN over a tee: the centre-front closure is not sewn (the fronts hang free; the buttons and the faced
// front edges are construction), and no cuffs (the sleeve's wrist edge is a turned hem, the sleeve lengthened by the cuff's height).
import * as SHIRT from './shirt.js';
export const design = SHIRT.design;
export const options = { ...SHIRT.options };
export const retry = SHIRT.retry;
export const panels = SHIRT.panels.filter(p => !/^cuff/.test(p.name));
export function seams(P) { return SHIRT.seams(P).filter(s => s.name !== 'cf'); }
export const at = [];
export const edges = [
  { panel: 'frontL', from: 'cfHem', to: 'hem', treatment: 'hem' }, { panel: 'frontR', from: 'hem', to: 'cfHem', treatment: 'hem' },
  { panel: 'back', from: 'hem~m', to: 'hem', treatment: 'hem' },
  { panel: 'sleeveR', from: 'wristLeft', to: 'wristRight', treatment: 'hem' }, { panel: 'sleeveL', from: 'wristLeft', to: 'wristRight', treatment: 'hem' },
  { panel: 'stand', from: 'leftBottomCf', to: 'rightBottomCf', treatment: 'fold' },
];
export const crowd = { part: 'top', length: 'hip', silhouette: 'jacket' };
