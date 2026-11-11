// SEWMAP / SKIRT (CLOTHING K4, the wardrobe): an A-line skirt on FreeSewing Sandy (a circle skirt, MIT) as a FOUR-GORE skirt: Sandy
// drafts one gore of a `circleRatio` circle (a quarter circle: a modest A-line) cut on fold; we take each half-gore as a panel (frontL,
// frontR mirrored, backL, backR mirrored), sewn at the centre front and back (on the grain: Sandy's fold line) and at the sides (the
// bias edges). Sandy's waistband is construction (cloth4.js's waistband ring over the skirt's top edge, no belt loops); the closure (a
// side zip under the band) is sewn shut. The waist edge is the waistband HOLD (as the trousers').
// Sandy's points: in1 / in2 the waist arc's middle / end, ex1 / ex2 the hem's, in2Flipped / ex2Flipped the fold edge. Placement is
// (a back gore seen from behind is the front gore's mirror: backL is the mirrored copy, backR the drafted one) wardrobe4/place4.js's 'skirt' wrap (a cone round the hips from the waist, each gore from the centre line to the side).
export const design = ['sandy'];
export const options = { circleRatio: 0.25, panels: 2, waistbandPosition: 0.25, waistbandShape: 'straight', gathering: 0, seamlessFullCircle: false };
const G = ['frontL', 'frontR', 'backL', 'backR'];
export const panels = [
  { name: 'frontL', part: 'sandy.skirt', place: { wrap: 'skirt', face: 'front', side: 'L', center: ['in2Flipped', 'ex2Flipped'], edge: ['in2', 'ex2'] } },
  { name: 'frontR', of: 'frontL', mirror: true, place: { wrap: 'skirt', face: 'front', side: 'R', center: ['in2Flipped', 'ex2Flipped'], edge: ['in2', 'ex2'] } },
  { name: 'backL', of: 'frontL', mirror: true, place: { wrap: 'skirt', face: 'back', side: 'L', center: ['in2Flipped', 'ex2Flipped'], edge: ['in2', 'ex2'] } },
  { name: 'backR', of: 'frontL', mirror: false, place: { wrap: 'skirt', face: 'back', side: 'R', center: ['in2Flipped', 'ex2Flipped'], edge: ['in2', 'ex2'] } },
];
export function seams() {
  return [
    { name: 'cf', kind: 'seam', a: [['frontL', 'in2Flipped', 'ex2Flipped']], b: [['frontR', 'in2Flipped', 'ex2Flipped']] },
    { name: 'cb', kind: 'seam', a: [['backL', 'in2Flipped', 'ex2Flipped']], b: [['backR', 'in2Flipped', 'ex2Flipped']] },
    { name: 'sideL', kind: 'seam', a: [['frontL', 'in2', 'ex2']], b: [['backL', 'in2', 'ex2']] },
    { name: 'sideR', kind: 'seam', a: [['frontR', 'in2', 'ex2']], b: [['backR', 'in2', 'ex2']] },
  ];
}
export const holds = [{ kind: 'waistband', runs: G.map(p => [p, 'in2Flipped', 'in2']) }];
export const edges = G.map(p => ({ panel: p, from: 'ex2Flipped', to: 'ex2', treatment: 'hem' }));
export const crowd = { part: 'bottom', length: 'knee', silhouette: 'skirt' };
