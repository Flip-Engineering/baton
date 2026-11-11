// WARDROBE (CLOTHING c1): who wears what, in named fabrics (lib/fx/cloth/fabrics.js), so a person is dressed the same at every distance.
// A garment names its fabric; the fabric decides the look (fabric_glsl.js) and the drape (drape.js reads h.fabrics).
//
//   import { dress, dyes, heroFabrics, crowdCloth } from './cloth/wardrobe.js';
//   dress(CREW8[3])          -> { top: 'chambray', bottom: 'duck', vest: 'hivisYG', collar: 'chambray', rims: 'auto', boots: 'bootLeather', ... }
//   dyes(CREW8[3])           -> colour overrides the fabric asks for (a chambray's indigo warp), merged into the hero options by castHero
//   heroFabrics(o, map)      -> the full part -> fabric map for hero options o (what hero.js uses under o.cloth; map overrides)
//   crowdCloth(d, rng)       -> a people.js descriptor dressed from the same fabric families (colours by family; d.fabric)
// Part keys are hero.js's h.cloth keys: top, skirt (a coat's or worn-out shirt's skirt), pockets, bottom, vest, collar, rims, boots,
// gloves. h.fabrics[key] is a fabric name, or for an array part (boots, rims) an array aligned with h.cloth[key].
// Defaults by garment kind (hero.js o.kind / o.trouserKind) are the trade's usual cloth: a work shirt is chambray, a chore coat
// 12 oz duck, a coverall 65/35 poly-cotton twill, a tee single jersey, trousers by trouserKind (0 poly-cotton twill, 1 flannel,
// 2 denim, 3 duck, 4 leather, 5 knit).
export const TOP_FABRIC = { work: 'chambray', flannel: 'flannel', tee: 'jersey', coat: 'duck', leather: 'leather', coverall: 'twillPC' };
export const TROUSER_FABRIC = ['twillPC', 'flannel', 'denim', 'duck', 'leather', 'jersey'];
export const VEST_FABRIC = { hivis: 'hivisYG', orange: 'hivisOR' };

export function heroFabrics(o = {}, map = null) {
  const top = TOP_FABRIC[o.kind] || 'chambray';
  const bottom = o.kind === 'coverall' ? top : (TROUSER_FABRIC[o.trouserKind ?? 2] || 'denim');
  const F = { top, skirt: top, pockets: top, bottom, collar: o.kind === 'tee' ? 'rib' : top, vest: o.vest ? (VEST_FABRIC[o.vest] || 'hivisMesh') : null,
    boots: 'bootLeather', gloves: 'gloveLeather' };
  return { ...F, ...(map && typeof map === 'object' ? map : {}) };
}

// CREW8 (workforce.js): plausible working clothes, one fabric per garment. The brief's line-up with my adjustments: Walt's chore coat
// over old denim (a chore coat is worn over jeans more often than over duck), June's leather jacket over poly-cotton work trousers.
const CREW = {
  Ada:  { top: 'twillPC' },                                            // navy poly-cotton coverall
  Walt: { top: 'duck', bottom: 'denim' },                              // brown duck chore coat, old faded denim
  Rosa: { top: 'flannel', vest: 'hivisOR', bottom: 'denim' },          // red flannel, orange hi-vis, denim
  Otis: { top: 'chambray', vest: 'hivisYG', bottom: 'duck' },          // chambray work shirt, yellow-green hi-vis, brown duck trousers
  Kai:  { top: 'jersey', collar: 'rib', bottom: 'denim' },             // charcoal tee, denim
  June: { top: 'leather', bottom: 'twillPC' },                         // brown leather jacket, charcoal work trousers
  Ray:  { top: 'twillPC' },                                            // orange poly-cotton coverall
  Mei:  { top: 'chambray', vest: 'hivisYG', bottom: 'twillPC' },       // chambray, hi-vis, navy twill trousers
};
// the dyes a fabric wants (the warp's colour, not the overall look: chambray's indigo warp under a white weft reads pale blue)
const CREW_DYES = {
  Walt: { shirt: '#5a4228', trousers: '#283a5c' },                    // brown duck; indigo
  Otis: { shirt: '#1a3058' },                                          // indigo warp
  Mei:  { shirt: '#2e4a72' },                                          // a lighter, greyer warp
  June: { shirt: '#5a3420' },
};
export function dress(spec = {}) {
  const base = heroFabrics({ kind: spec.kind, trouserKind: spec.trouserKind ?? 2, vest: spec.vest });
  const m = { ...base, ...(CREW[spec.name] || {}) };
  if (m.top && !CREW[spec.name]?.skirt) m.skirt = m.pockets = m.top;
  if (spec.kind === 'coverall') m.bottom = m.top;
  if (!m.collar || (CREW[spec.name] && !CREW[spec.name].collar)) m.collar = spec.kind === 'tee' ? 'rib' : m.top;
  if (!spec.vest) delete m.vest;
  if (!spec.gloves) delete m.gloves;
  m.rims = 'auto';                                                     // the binding of the garment each rim edges (hero.js resolves)
  return m;
}
export const dyes = spec => ({ ...(CREW_DYES[spec.name] || {}) });

// ---------------------------------------------------------------- the crowd (people.js descriptors)
// The same families at mid distance: colours drawn from what each fabric is dyed in the trade (people.js has no fabric shading yet;
// d.fabric records the choice for when it does).
const FAMILY = {
  denim:   ['#2a3a5a', '#34486a', '#3e5478', '#283450', '#4a5e80'],
  duck:    ['#7a5e3a', '#8a6e48', '#5a4630', '#6e6248', '#3e3a30'],
  twillPC: ['#2c3a52', '#d8641c', '#4a5a3e', '#3a3a40', '#1e2a3a', '#6a6a62'],
  chambray:['#6a7e9a', '#7a8ca6', '#5a6e8a'],
  flannel: ['#6a1c1c', '#3a4a2a', '#2a3a5a', '#5a3a1c'],
  jersey:  ['#2a2c30', '#4a4a4c', '#6a6a60', '#2a3a4a'],
  hivisYG: ['#c8f028'], hivisOR: ['#ff6a10'],
};
const TROUSER_PC = ['#2c3a52', '#3a3a40', '#4a5a3e', '#6a6250', '#1e2a3a'];   // work trousers: navy, charcoal, olive, khaki
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
export function crowdCloth(d, rng) {
  const coverall = !!d.coverall, top = coverall ? 'twillPC' : pick(rng, ['chambray', 'chambray', 'twillPC', 'flannel', 'jersey', 'duck']);
  const bottom = coverall ? 'twillPC' : pick(rng, ['denim', 'denim', 'duck', 'twillPC']);
  d.top = pick(rng, FAMILY[top]); d.bottom = coverall ? d.top : pick(rng, bottom === 'twillPC' ? TROUSER_PC : FAMILY[bottom]);
  if (coverall) d.accent = d.top;
  const vest = d.noVest || coverall ? null : rng() < 0.6 ? 'hivisYG' : 'hivisOR';
  if (vest && d.vest !== undefined) d.vest = FAMILY[vest][0];
  d.fabric = { top, bottom, ...(vest ? { vest } : {}) };
  return d;
}
