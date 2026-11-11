// SEWMAP / JEANS, CHINOS, SCRUB PANTS (CLOTHING K4, the wardrobe): K2's Titan trousers (FreeSewing Titan, MIT; sewmaps/trousers.js) with
// the wardrobe's variants: the panels, seams, fly and holds are trousers.js's; what makes jeans or chinos is the cut (ease, rise, leg) and
// the construction (wardrobe4/trim4.js: five pockets, rivets, the back yoke and double topstitching for jeans; slant pockets and back welts
// for chinos; the waistband ring, belt loops and fly from CLOTH4 / K3). The pocket bags, coin pocket and yoke are not separate panels this
// round (construction on the solved cloth), so the cloth drapes as one leg per side.
export * from './trousers.js';
import { variants as V0 } from './trousers.js';
export const variants = {
  ...V0,
  // five-pocket jeans: a fly front for women and men, mid rise, a slim straight leg
  jeans: { options: { waistHeight: 0.62, seatEase: 0.02, kneeEase: 0.06, waistEase: 0.01, lengthBonus: -0.03 }, fly: true, placket: false },
  // chinos: a fly, a mid rise, a straight leg with a little more room
  chinos: { options: { waistHeight: 0.65, seatEase: 0.04, kneeEase: 0.1, waistEase: 0.02, lengthBonus: -0.03 }, fly: true, placket: false },
  // scrub pants: pull-on (no fly; the waist a drawstring band), a relaxed leg
  scrubs: { options: { waistHeight: 0.6, seatEase: 0.1, kneeEase: 0.25, waistEase: 0.06, lengthBonus: -0.03 }, fly: false, placket: false },
};
