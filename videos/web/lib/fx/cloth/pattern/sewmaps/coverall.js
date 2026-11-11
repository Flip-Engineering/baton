// SEWMAP / COVERALL (CLOTHING c2, lane K2): a woven work coverall on FreeSewing Onyx (a one-piece with raglan sleeves, MIT) as
// the base, with our options: full legs and sleeves, woven ease (Onyx is drafted for knits), a front zip from the neck to the crotch
// (a closure, closed), Onyx's low "crotch drop" kept (its crotch sits well under the body's: room to squat and climb), no hood, no
// ribbing, and this round no crotch gusset (the four crotch points meet at one: the gusset is a later panel) and no neckband (the
// neckline is a bound edge).
// Panels (seen from outside): frontL (Onyx's front as drafted: the outseam at +u, the CF at u = 0: seen from the front, the wearer's
// LEFT), frontR (mirrored), back (cut on fold, mirrored: its +u side is the wearer's right seen from behind), sleeveL (Onyx's raglan
// sleeve as drafted: its front edge at -u, which seen from outside is a LEFT sleeve), sleeveR (mirrored).
export const design = ['onyx'];
export const options = { neckStyle: 'neckband', zipperPosition: 'front', skirt: false, sleeveRibbing: false, legRibbing: false, legLength: 0.92, sleeveLength: 0.82,
  chestEase: 0.2, waistEase: 0.25, hipsEase: 0.2, seatEase: 0.2, upperLegEase: 0.25, legHemEase: 0.2, sleeveEase: 0.25, wristEase: 0.3, neckEase: 0.15 };
export const panels = [
  { name: 'frontL', part: 'onyx.front', place: { wrap: 'suit', face: 'front', side: 'L', out: 'outseamHem', fork: 'crotchEnd', top: 'neckShoulderCorner' } },
  { name: 'frontR', of: 'frontL', mirror: true, place: { wrap: 'suit', face: 'front', side: 'R', out: 'outseamHem', fork: 'crotchEnd', top: 'neckShoulderCorner' } },
  { name: 'back', part: 'onyx.back', mirror: 'fold', place: { wrap: 'suit', face: 'back', out: 'outseamHem', fork: 'crotchEnd', top: 'neckShoulderCorner' } },
  { name: 'sleeveL', part: 'onyx.raglanSleeve', mark: [{ name: 'capTop', at: 'maxV' }], place: { wrap: 'arm', side: 'L', top: 'capTop', front: 'frontNeck', biceps: 'frontArmholeScooped' } },
  { name: 'sleeveR', of: 'sleeveL', mirror: true, place: { wrap: 'arm', side: 'R', top: 'capTop', front: 'frontNeck', biceps: 'frontArmholeScooped' } },
];
export function seams(P) {
  const S = [];
  for (const [sd, m] of [['L', '~m'], ['R', '']]) {
    const fr = 'front' + sd, sl = 'sleeve' + sd;
    S.push({ name: 'outseam' + sd, kind: 'seam', a: [[fr, 'outseamHem', 'armpitCornerScooped']], b: [['back', 'outseamHem' + m, 'armpitCornerScooped' + m]] });
    S.push({ name: 'inseam' + sd, kind: 'seam', a: [[fr, 'crotchEnd', 'inseamHem']], b: [['back', 'crotchEnd' + m, 'inseamHem' + m]] });
    S.push({ name: 'raglanFront' + sd, kind: 'seam', a: [[fr, 'armpitCornerScooped', 'neckShoulderCorner']], b: [[sl, 'frontArmholeScooped', 'frontNeck']] });
    S.push({ name: 'raglanBack' + sd, kind: 'seam', a: [['back', 'armpitCornerScooped' + m, 'neckShoulderCorner' + m]], b: [[sl, 'backArmholeScooped', 'backNeck']] });
    S.push({ name: 'underarm' + sd, kind: 'seam', a: [[sl, 'frontArmholeScooped', 'frontSleeve']], b: [[sl, 'backArmholeScooped', 'backSleeve']] });
  }
  S.push({ name: 'crotchFront', kind: 'seam', a: [['frontL', 'cfCrotch', 'crotchEnd']], b: [['frontR', 'cfCrotch', 'crotchEnd']] });
  S.push({ name: 'zip', kind: 'closure', a: [['frontL', 'cfNeck', 'cfCrotch']], b: [['frontR', 'cfNeck', 'cfCrotch']] });
  return S;
}
export const edges = [{ panel: 'frontL', from: 'inseamHem', to: 'outseamHem', treatment: 'hem' }, { panel: 'frontR', from: 'outseamHem', to: 'inseamHem', treatment: 'hem' },
  { panel: 'back', from: 'outseamHem', to: 'inseamHem', treatment: 'hem' }, { panel: 'back', from: 'inseamHem~m', to: 'outseamHem~m', treatment: 'hem' }];
export const crowd = { part: 'coverall', length: 'ankle', silhouette: 'coverall' };
