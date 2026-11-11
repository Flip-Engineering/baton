// SEWMAP / TROUSERS (CLOTHING c2, lane K2): FreeSewing Titan (a unisex trouser block, MIT) as two garments:
//   'work'   men's (and women's) work trousers: Titan's legs, a fly at the centre front (a closure, closed), the waist held by its
//            waistband line (a 'waistband' hold: K1's ring; K2's stand-in pins it where it was sewn)
//   'slacks' women's slacks hanging from the hip, 1940s cut: Titan drafted with a natural-waist rise, more seat ease and full straight
//            legs (our options), the CENTRE FRONT sewn shut and the closure moved to a side placket on the wearer's left outseam
//            (the top 18 cm, closed): our own option, Titan has no placket
// Panels (seen from outside): frontR (Titan's front as drafted: its outseam at u ~ 0, the fork toward +u, which seen from the front is
// the wearer's RIGHT leg), frontL (mirrored), backR (Titan's back: outseam at u ~ 0, fork toward -u: seen from behind, the wearer's
// right), backL (mirrored).
export const design = ['titan'];
export const options = {};
export const variants = {
  work: { options: { waistHeight: 1, seatEase: 0.06, kneeEase: 0.15, lengthBonus: -0.03 }, fly: true, placket: false },
  slacks: { options: { waistHeight: 1, seatEase: 0.1, kneeEase: 0.3, lengthBonus: -0.03, waistEase: 0.03 }, fly: false, placket: true },
};
export const panels = [
  { name: 'frontR', part: 'titan.front', place: { wrap: 'leg', side: 'R', face: 'front', waist: 'styleWaistOut', out: 'styleWaistOut', fork: 'fork' } },
  { name: 'frontL', of: 'frontR', mirror: true, place: { wrap: 'leg', side: 'L', face: 'front', waist: 'styleWaistOut', out: 'styleWaistOut', fork: 'fork' } },
  { name: 'backR', part: 'titan.back', place: { wrap: 'leg', side: 'R', face: 'back', waist: 'styleWaistOut', out: 'styleWaistOut', fork: 'fork' } },
  { name: 'backL', of: 'backR', mirror: true, place: { wrap: 'leg', side: 'L', face: 'back', waist: 'styleWaistOut', out: 'styleWaistOut', fork: 'fork' } },
];
// o: the variant ({ fly, placket }); the placket / fly length is 18 cm from the waist (split points made by build.js's 'at' tags)
export function seams(P, o = variants.work) {
  const S = [];
  for (const sd of ['L', 'R']) {
    const f = 'front' + sd, b = 'back' + sd;
    if (o.placket && sd === 'L') { S.push({ name: 'placketL', kind: 'closure', a: [[f, 'styleWaistOut', 'placketEnd']], b: [[b, 'styleWaistOut', 'placketEnd']] });
      S.push({ name: 'outseamL', kind: 'seam', a: [[f, 'placketEnd', 'floorOut']], b: [[b, 'placketEnd', 'floorOut']] }); }
    else S.push({ name: 'outseam' + sd, kind: 'seam', a: [[f, 'styleWaistOut', 'floorOut']], b: [[b, 'styleWaistOut', 'floorOut']] });
    S.push({ name: 'inseam' + sd, kind: 'seam', a: [[f, 'fork', 'floorIn']], b: [[b, 'fork', 'floorIn']] });
  }
  if (o.fly) { S.push({ name: 'fly', kind: 'closure', a: [['frontR', 'styleWaistIn', 'flyEnd']], b: [['frontL', 'styleWaistIn', 'flyEnd']] });
    S.push({ name: 'crotchFront', kind: 'seam', a: [['frontR', 'flyEnd', 'fork']], b: [['frontL', 'flyEnd', 'fork']] }); }
  else S.push({ name: 'crotchFront', kind: 'seam', a: [['frontR', 'styleWaistIn', 'fork']], b: [['frontL', 'styleWaistIn', 'fork']] });
  S.push({ name: 'crotchBack', kind: 'seam', a: [['backR', 'styleWaistIn', 'fork']], b: [['backL', 'styleWaistIn', 'fork']] });
  return S;
}
// points made along a seam line (build.js inserts them as outline tags): the fly's and the placket's ends, 18 cm from the waist
export const at = [
  { panel: 'frontR', name: 'flyEnd', from: 'styleWaistIn', toward: 'fork', length: 0.18 }, { panel: 'frontL', name: 'flyEnd', from: 'styleWaistIn', toward: 'fork', length: 0.18 },
  { panel: 'frontL', name: 'placketEnd', from: 'styleWaistOut', toward: 'floorOut', length: 0.18 }, { panel: 'backL', name: 'placketEnd', from: 'styleWaistOut', toward: 'floorOut', length: 0.18 },
];
export const holds = [{ kind: 'waistband', runs: [['frontR', 'styleWaistOut', 'styleWaistIn'], ['frontL', 'styleWaistIn', 'styleWaistOut'], ['backR', 'styleWaistOut', 'styleWaistIn'], ['backL', 'styleWaistIn', 'styleWaistOut']] }];
export const edges = [{ panel: 'frontR', from: 'floorOut', to: 'floorIn', treatment: 'hem' }, { panel: 'frontL', from: 'floorIn', to: 'floorOut', treatment: 'hem' }, { panel: 'backR', from: 'floorIn', to: 'floorOut', treatment: 'hem' }, { panel: 'backL', from: 'floorOut', to: 'floorIn', treatment: 'hem' }];
export const crowd = { part: 'bottom', length: 'ankle', silhouette: 'trousers' };
