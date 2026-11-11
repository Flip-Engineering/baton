// GARMENTS4 (CLOTHING K4, the wardrobe): what each garment of the working wardrobe IS, as data the wardrobe's bake reads: the sewmap
// (K2's contract: FreeSewing drafts made to the person's measures by tailor.js), the design for women and men, the ease (the fit), the
// default fabric, the layer it is worn at and its tuck, and the construction that finishes it (finish.js K3's collar / placket / waistband /
// fly / hems, CLOTH4's waistband ring, trim4.js's knit bands, pockets, rivets and topstitching).
//   tee         Teagan (knit), crew neck, short sleeves; women: the waist fitted (Teagan's fitWaist), a little shorter
//   sweat       Sven (fleece-backed knit), crew neck, rib cuffs / hem band / neckband
//   shirt       K2's woven work shirt (Simon / Simone), as today's default (CARRY's sleeve length), oxford / chambray / flannel
//   jacket      a chore coat on Simon / Simone with jacket ease (chest +16 %, hip length), open, no cuffs, canvas
//   jeans       Titan, five-pocket jeans cut (mid rise, slim straight leg), denim (stretch denim for women)
//   chinos      Titan, chino cut (mid rise, straight leg), cotton chino twill
//   work        K2's Titan work trousers (men) / slacks (women) as today, poly-cotton twill
//   skirt       Sandy as a four-gore A-line skirt to the knee (women), wool flannel
//   scrubTop    Teagan in poly-cotton poplin, relaxed, a chest pocket (nursing scrubs)
//   scrubPants  Titan pull-on scrub pants, relaxed leg
import { easeFor } from '../tailor.js';
export const GARMENTS4_VERSION = 1;

const F = s => s === 'f';
export const GARMENTS = {
  tee: { map: 'tee', design: () => 'teagan', part: 'top', fabric: 'teeJersey', trim: 'tee', tuck: 'out',
    options: (T, sex, o) => ({ chestEase: F(sex) ? 0.07 : 0.1, hipsEase: F(sex) ? 0.1 : 0.12, fitWaist: F(sex), waistEase: 0.14, lengthBonus: F(sex) ? (o.tuck === 'in' ? 0.14 : 0.12) : (o.tuck === 'in' ? 0.2 : 0.2),
      sleeveLength: F(sex) ? 0.26 : 0.32, necklineDepth: F(sex) ? 0.26 : 0.22, necklineWidth: F(sex) ? 0.32 : 0.26, backNeckCutout: 0.06 }) },
  sweat: { map: 'sweat', design: () => 'sven', part: 'top', fabric: 'fleece', trim: 'sweat', tuck: 'out',
    options: (T, sex) => ({ ribbing: true, chestEase: F(sex) ? 0.12 : 0.14, hipsEase: F(sex) ? 0.08 : 0.06, lengthBonus: F(sex) ? 0.08 : 0.12, sleeveLengthBonus: 0.1, ribbingHeight: 0.09, collarEase: 0.14 }) },
  shirt: { map: 'shirt', design: sex => (F(sex) ? 'simone' : 'simon'), part: 'top', fabric: 'oxford', construct: 'shirt', tuck: 'in', carryShirt: true,
    options: (T, sex, o) => ({ ...easeFor('shirt', T, { fit: o.fit || 'regular' }), sleeveLengthBonus: 0.10 }) },
  jacket: { map: 'jacket', design: sex => (F(sex) ? 'simone' : 'simon'), part: 'top', layer: 'outer', fabric: 'canvas', construct: 'shirt', trim: 'jacket', tuck: 'out', open: true,
    options: (T, sex) => { const e = easeFor('shirt', T, { fit: 'relaxed' }); return { ...e, chestEase: (e.chestEase ?? 0.12) + 0.16, waistEase: (e.waistEase ?? 0.15) + 0.2, hipsEase: (e.hipsEase ?? 0.15) + 0.14, bicepsEase: (e.bicepsEase ?? 0.15) + 0.1, lengthBonus: 0.32, sleeveLengthBonus: 0.16, collarEase: 0.12 }; } },
  jeans: { map: 'jeans', variant: 'jeans', design: () => 'titan', part: 'bottom', fabric: sex => (F(sex) ? 'stretchDenim' : 'denim'), construct: 'trousers', trim: 'jeans', ring: { loops: 5 } },
  chinos: { map: 'jeans', variant: 'chinos', design: () => 'titan', part: 'bottom', fabric: 'chino', construct: 'trousers', trim: 'chinos', ring: { loops: 7 } },
  work: { map: 'trousers', variant: sex => (F(sex) ? 'slacks' : 'work'), design: () => 'titan', part: 'bottom', fabric: 'twillPC', construct: 'trousers', ring: {} },
  skirt: { map: 'skirt', design: () => 'sandy', part: 'bottom', fabric: 'woolFlannel', trim: 'skirt', skirt: true, ring: { loops: 0 },
    options: () => ({ circleRatio: 0.25, panels: 2, waistbandPosition: 0.25, lengthBonus: 0.56 }) },
  scrubTop: { map: 'tee', design: () => 'teagan', part: 'top', fabric: 'scrub', trim: 'scrubTop', tuck: 'out',
    options: (T, sex) => ({ chestEase: 0.24, hipsEase: 0.24, bicepsEase: 0.12, fitWaist: false, lengthBonus: 0.14, sleeveLength: 0.28, necklineDepth: 0.3, necklineWidth: 0.28, backNeckCutout: 0.06 }) },   // a woven poplin on the knit block: more ease (0.16 left it 7.5 % stretched)
  scrubPants: { map: 'jeans', variant: 'scrubs', design: () => 'titan', part: 'bottom', fabric: 'scrub', construct: 'trousers', trim: 'scrubPants', ring: { loops: 0 } },
};
export const garmentOf = kind => { const G = GARMENTS[kind]; if (!G) throw new Error('wardrobe4: no garment ' + kind); return G; };
export const fabricFor = (G, sex, over) => over || (typeof G.fabric === 'function' ? G.fabric(sex) : G.fabric);
export const variantFor = (G, sex) => (typeof G.variant === 'function' ? G.variant(sex) : G.variant);
