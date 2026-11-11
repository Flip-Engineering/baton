// CLOTH5 (round 5): K4's wardrobe baked with CLOTH5's fixes at the source, into assets/person/v5c/ (makePerson('v4:<name>', { bake: 'v5c' })
// with wardrobe4/fabrics4.js registerFabrics4() on the page, as K4's). What it changes over bakeWardrobe (each an opt-in of the file it is in):
//   SELF-COLLISION  sew.js (selfEE: edge-edge while sewing), stack.js (self5: point-triangle + edge-edge with side memory in the A-pose settle
//                   and the carry, projected again after the body contacts; carry.sub: the skin's jump in pieces; the joint settle's same-layer
//                   pairs), xpbd.js (selfTriSame, selfTriLast); untangle5.js between the stages (Baraff-Witkin-Kass islands)
//   COLLAR          finish.js fall5: the fall as a shell about one centre arc (its two layers crossed: the dark polygons on every collar)
//   HEMS            stack.js hemBand5: the trouser leg's lowest 3.5 cm (the turned hem) as a stiffer band (it crumpled into shards on the shoe)
//   FIT             boot4.js ownShin: the shaft from this side's shin (the other shin widened women's shafts to 41 cm, and the trouser leg
//                   opening over it); the sneaker's sole slimmer (outfit data)
// Nothing else differs from K4's bake: the same outfits (OUTFITS4), stance, foundations, drafting and construction.
import { bakeWardrobe } from '../wardrobe4/bake4.js';
import { CARRY3 } from '../dress3.js';
import { untangleCloth, flattenCloth } from './untangle5.js';
export const CLOTH5_VERSION = 1, V5C_DIR = 'v5c';
// E2 of the experiments (NOTES.md): self-collision with edge-edge in the sew, the settle, the carry (its skin jump in 4 pieces) and the joint
// settle, the island untangle between stages. The self projection after the contacts (self5.last) and the layer-order flatten were tried and
// are off (more stretch, no fewer crossings).
// self5.only ['top']: measured over the twelve, self-collision everywhere left the total crossings where they were (15945 -> 15760): the
// untucked knit tops gained (L21 sweatshirt 1378 -> 1030, L14 841 -> 567, L11 tee 703 -> 389, L08 237 -> 201) and the tucked tops, the
// chore coats and the men's trousers lost (L23's coat 2440 -> 2938, its elbows 693 -> 2299; L06's tucked tee 206 -> 445): on the untucked
// tops only (stack id 'top'), the rest solved as K4's
export const STACK5 = { sew: { T: 1.2, hz: 900, iters: 4, selfEE: true }, self5: { only: ['top'] }, carry: { ...CARRY3.carry, sub: 4 } };
// (hemBand, the turned hem as a stiffer band, is OFF: on L03 the leg kinked at the band's top and the hem's inner layer came through as a
// dark slit 3.5 cm over the shoe, worse than K4's shards; kept as an option: fix: { hemBand: { band: 0.035, bendX: 5, stretchX: 1.5, shearX: 2 } })
export const FIX5 = { boot: { ownShin: true, toe5: true }, fall5: true };
// CLOTH4's cuff-join band hugging the seam (it was a 2.2 cm tube at the largest radius of the cloth within it: a band round the wrist)
export const C4OVER5 = { cuffJoin: { up: 0.008, down: 0.004, lift: 0.0008 } };
export const SNEAKER5 = { heel: 0.026, fore: 0.017, foxing: 0.009, toe5: true };
// FIT: Titan (FreeSewing) sizes the knee from the SEAT unless fitKnee is set (back.mjs: kneeTotal = max(knee x (1 + kneeEase), seatFront)),
// and goes straight down from the knee: every leg was as wide as the front of the seat, and the women's (fuller seat, smaller knee) widest.
// fitKnee: the leg tapers from the seat to the knee (knee x (1 + kneeEase), the bake's boot rule still widens it to clear a boot) and hangs
// straight from the knee to the hem: a straight leg sized at the knee. Scrub trousers keep their loose cut. WOMEN only: on the men (legs
// already slimmer) it raised the trousers' crossings at the fork by 20-60 % (L03 338 -> 439, L21 208 -> 323) and was not asked for.
const FIT_KNEE = new Set(['jeans', 'chinos', 'work']);
// and over LOW SHOES only: over a boot the straight leg rests on the shaft and kinks at its top edge, and K3's turned hem (a straight 3.5 cm
// sweep inside the leg) came through the kink as a dark slit 3 cm over the hem (L14, L12); over boots the leg stays K4's
export function outfit5(o, sex = 'f') { const b = o.bottom && FIT_KNEE.has(o.bottom.kind) && sex === 'f' && o.shoes?.kind !== 'boot' ? { ...o.bottom, options: { fitKnee: true, ...(o.bottom.options || {}) } } : o.bottom;
  return { ...o, bottom: b, shoes: o.shoes?.kind === 'sneaker' ? { ...SNEAKER5, ...o.shoes } : o.shoes }; }
export async function bakeCloth5(S, e, outfit, { log = () => {}, untangle = true, flatten = false, stack = {}, fix = {}, probe = null, ...rest } = {}) {
  const ust = {}, fst = {}, t0 = Date.now();
  // between the solver's stages: islands back through (untangle), then what still crosses put in layer order along the body's normal (flatten)
  const only = (stack.self5 || STACK5.self5)?.only, un = untangle ? (cl, stage, id, ctx) => { if (only && !only.includes(id)) return; const key = stage.replace(/[0-9]+$/, '') + ':' + id; untangleCloth(cl, { stats: ust, key });
    if (flatten && ctx?.bodyPosed && stage !== 'welded') flattenCloth(cl, ctx.bodyPosed, { stats: fst, key }); } : null;
  const carry = { ...STACK5.carry, ...(stack.carry || {}), ...(probe ? { probe } : {}) };
  const r = await bakeWardrobe(S, e, outfit5(outfit, /_f\d/.test(e.name) ? 'f' : 'm'), { log, c4: C4OVER5, ...rest, stackOpts: { ...STACK5, ...stack, carry, ...(un ? { untangle: un } : {}) }, fix5: { ...FIX5, ...fix } });
  r.report.cloth5 = { version: CLOTH5_VERSION, stack: { ...STACK5, carry: { sub: carry.sub } }, fix: { ...FIX5, ...fix, post: undefined }, untangle: ust, flatten: fst, ms: Date.now() - t0 };
  return r;
}
