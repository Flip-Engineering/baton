// FABRICS4 (CLOTHING K4, the wardrobe, 3 Oct): the cloths of an everyday working wardrobe that CLOTHING c1's fabric book (fabrics.js) did not
// carry yet, as the same two blocks (the physical record K1's solver reads through phys(), and the LOOK the fabric shader and the Cycles
// material read). Opt-in: nothing is added to fabrics.js until registerFabrics4() is called (the wardrobe's bake, its lab, its export); a
// name already in fabrics.js is never overwritten, so every existing garment, figure and scene keeps its numbers.
//
// Physical fields: fabrics.js's header (gsm, mm, bend in KES B gf.cm^2/cm, stretch [warp, weft] N/m, shear N/m, mu). Look fields: the same.
// Trade weights and constructions (typical ranges, not a measurement of a particular bolt; 1 oz/yd^2 = 33.9 g/m^2):
//   teeJersey     5.3 oz single jersey (a basic cotton tee), 1x1 rib at the neck: 160-180 g/m^2, KES B ~0.01-0.02 (a knit hangs in fine
//                 folds), stretchy across (weft) more than along
//   heatherJersey the same knit in a heather (a melange of dyed and undyed fibre): the grey / heather tee
//   fleece        fleece-backed sweatshirt knit (a jersey face over a brushed loop back), 9-10 oz = 300-340 g/m^2, 1.2-1.6 mm; bends like a
//                 light woven (KES B ~0.06-0.1) but stretches like a knit; the inside is the brushed back (paler, matte)
//   chino         cotton 2/1 drill / chino twill, 7-8 oz = 240-270 g/m^2: a finer, softer twill than work poly-cotton, fades as cotton does
//   canvas        washed 10 oz cotton canvas (a chore coat, a work jacket): 340 g/m^2; stiffer than chino, softer than 12 oz firm duck
//   stretchDenim  10-11 oz denim with 1-2 % elastane in the weft: 350-375 g/m^2; the weft stretches (women's jeans hug), the warp does not
//   woolFlannel   worsted / woollen flannel (a skirt, a pair of slacks): 270-300 g/m^2, 2/2 twill under a raised nap, heathered
//   oxford        cotton oxford shirting (an office shirt): a basket weave of a dyed warp and a white weft, 130-150 g/m^2
//   scrub         65/35 poly-cotton poplin (nursing scrubs): 150-160 g/m^2, smooth, a little sheen, takes industrial laundering
// The physical numbers are from the same tables as fabrics.js (Kawabata ranges by construction); the knit stretch is the solver's soft knit
// is taken at the KES EMT secant (a 5.3 oz jersey extends ~30-50 % across at 490 N/m: ~1-1.5 kN/m across, 2-3x along the wales); c1's
// jersey (600 / 300 N/m) let a sewn tee stretch 7 % mean on the body (first bake), these 2-3 %. Nothing measured on a bolt: guidance, to be checked against a cantilever (Peirce) on the bench.
import { FABRICS, LOOKS } from '../fabrics.js';
export const FABRICS4_VERSION = 1;

export const FABRICS4 = {
  teeJersey:     { label: '5.3 oz cotton single jersey (tee)',      construction: 'knit',    gsm: 170, mm: 0.55, bend: 0.02,  stretch: [3000, 1400],  shear: 280, mu: 0.55 },
  heatherJersey: { label: 'heather cotton/poly jersey (tee)',       construction: 'knit',    gsm: 165, mm: 0.55, bend: 0.02,  stretch: [3000, 1400],  shear: 280, mu: 0.5 },
  fleece:        { label: '9.5 oz fleece-backed sweatshirt knit',   construction: 'knit',    gsm: 320, mm: 1.4,  bend: 0.08,  stretch: [4500, 2200],  shear: 400, mu: 0.6 },
  chino:         { label: '7.5 oz cotton chino twill (2/1)',        construction: 'twill21', gsm: 255, mm: 0.5,  bend: 0.16,  stretch: [11000, 8000], shear: 380, mu: 0.45 },
  canvas:        { label: '10 oz washed cotton canvas',             construction: 'duck',    gsm: 340, mm: 0.75, bend: 1.0,   stretch: [17000, 12000], shear: 900, mu: 0.5 },
  stretchDenim:  { label: '10.5 oz stretch denim (2 % elastane)',   construction: 'twill31', gsm: 355, mm: 0.7,  bend: 0.45,  stretch: [13000, 2200], shear: 450, mu: 0.5 },
  woolFlannel:   { label: 'wool flannel, 2/2 twill, napped',        construction: 'twill22', gsm: 285, mm: 0.8,  bend: 0.22,  stretch: [7000, 6000],  shear: 280, mu: 0.6 },
  oxford:        { label: 'cotton oxford shirting',                 construction: 'plain',   gsm: 140, mm: 0.32, bend: 0.07,  stretch: [8000, 6000],  shear: 300, mu: 0.45 },
  scrub:         { label: '65/35 poly-cotton poplin (scrubs)',      construction: 'plain',   gsm: 155, mm: 0.3,  bend: 0.06,  stretch: [9000, 6000],  shear: 320, mu: 0.4 },
};
const L = o => o;
export const LOOKS4 = {
  teeJersey: L({ weave: { kind: 'jersey', epc: 14, ppc: 16, weftShow: 0, contrast: 0.1, slub: 0.08 }, rough: [0.82, 0.05], sheen: [0.32, 0.55, 0.25], nap: 0.8,
    aniso: [0.1, 10, 0], dye: [1, 1], wear: { fibre: 'knit', abr: 0.3, soil: 0.4, pill: 0.5, fade: 0.55 }, inside: [0.3, 0.32], seam: { thread: null, k: 0.55 }, spec: 0.4 }),
  heatherJersey: L({ weave: { kind: 'jersey', epc: 14, ppc: 16, weftShow: 0, contrast: 0.16, slub: 0.1, heather: 0.2 }, rough: [0.84, 0.05], sheen: [0.34, 0.55, 0.3], nap: 0.9,
    aniso: [0.1, 10, 0], dye: [0.75, 1], wear: { fibre: 'knit', abr: 0.3, soil: 0.4, pill: 0.6, fade: 0.4 }, inside: [0.3, 0.32], seam: { thread: null, k: 0.55 }, spec: 0.4 }),
  // the face is a jersey; the back a brushed loop (the inside: paler, matte, lit only through the opening)
  fleece: L({ weave: { kind: 'jersey', epc: 11, ppc: 13, weftShow: 0, contrast: 0.1, slub: 0.05, heather: 0.06 }, rough: [0.88, 0.04], sheen: [0.42, 0.6, 0.3], nap: 1.2,
    aniso: [0.06, 8, 0], dye: [1, 1], wear: { fibre: 'knit', abr: 0.3, soil: 0.4, pill: 0.9, fade: 0.45 }, inside: [0.55, 0.38], seam: { thread: null, k: 0.5 }, spec: 0.35 }),
  chino: L({ weave: { kind: 'twill', over: 2, under: 1, epc: 44, ppc: 24, dir: 1, weftShow: 0.3, contrast: 0.08, slub: 0.05 }, rough: [0.8, 0.04], sheen: [0.16, 0.55, 0.22], nap: 0.4,
    aniso: [0.28, 22, 0.5], dye: [1, 1], wear: { fibre: 'pc', abr: 0.35, soil: 0.6, fade: 0.3 }, inside: [0.35, 0.3], seam: { thread: null, k: 0.75 }, spec: 0.45 }),
  canvas: L({ weave: { kind: 'duck', epc: 20, ppc: 12, weftShow: 0.4, contrast: 0.14, slub: 0.22 }, rough: [0.86, 0.05], sheen: [0.2, 0.72, 0.2], nap: 0.6,
    aniso: [0.12, 10, 0], dye: [0.95, 1], wear: { fibre: 'duck', abr: 0.8, soil: 0.7, fray: 0.8, fade: 0.4 }, inside: [0.45, 0.3], seam: { thread: '#a8875a', k: 0.85 }, spec: 0.4 }),
  stretchDenim: L({ weave: { kind: 'twill', over: 3, under: 1, epc: 28, ppc: 20, dir: 1, weftShow: 0.1, weft: '#b4ad9c', contrast: 0.26, slub: 0.3 }, rough: [0.77, 0.06], sheen: [0.22, 0.65, 0.3], nap: 0.6,
    aniso: [0.42, 20, 0.45], dye: [1, 1], wear: { fibre: 'indigo', abr: 0.9, soil: 0.4, whisker: 0.8, core: '#c9d2dc', fade: 0.45 }, inside: [0.75, 0.32], seam: { thread: '#c08a32', k: 1 }, spec: 0.4 }),
  woolFlannel: L({ weave: { kind: 'twill', over: 2, under: 2, epc: 22, ppc: 20, dir: 1, weftShow: 0.5, contrast: 0.12, slub: 0.1, heather: 0.22 }, rough: [0.9, 0.04], sheen: [0.55, 0.5, 0.25], nap: 1.4,
    aniso: [0.05, 8, 0.6], dye: [0.85, 1], wear: { fibre: 'knit', abr: 0.25, soil: 0.35, pill: 0.4, fade: 0.15 }, inside: [0.4, 0.32], seam: { thread: null, k: 0.45 }, spec: 0.35 }),
  oxford: L({ weave: { kind: 'plain', epc: 30, ppc: 20, weftShow: 0.42, weft: '#ebe8e1', contrast: 0.2, slub: 0.18 }, rough: [0.8, 0.03], sheen: [0.2, 0.6, 0.3], nap: 0.45,
    aniso: [0.3, 18, 0], dye: [1, 1], wear: { fibre: 'pc', abr: 0.4, soil: 0.5, fade: 0.25 }, inside: [0.5, 0.32], seam: { thread: null, k: 0.7 }, spec: 0.45 }),
  scrub: L({ weave: { kind: 'plain', epc: 42, ppc: 32, weftShow: 0.45, contrast: 0.05, slub: 0.02 }, rough: [0.66, 0.04], sheen: [0.14, 0.45, 0.25], nap: 0.25,
    aniso: [0.25, 26, 0], dye: [1, 1], wear: { fibre: 'pc', abr: 0.15, soil: 0.5, fade: 0.2 }, inside: [0.45, 0.3], seam: { thread: null, k: 0.6 }, spec: 0.6 }),
};
// the same looks as the Cycles script's LOOKS table reads them (blender/person_scene.py: rough, sheen, epc, ppc, kind, spec): the export
// writes these beside each garment record (wardrobe4/export4.js), so a fabric not in that table still renders as its own cloth
export const CYCLES4 = Object.fromEntries(Object.entries(LOOKS4).map(([k, l]) => [k, { rough: l.rough[0], sheen: l.sheen, epc: l.weave.epc, ppc: l.weave.ppc, kind: l.weave.kind === 'duck' ? 'plain' : l.weave.kind, spec: l.spec }]));

let _done = false;
// add the wardrobe's fabrics to fabrics.js's tables (idempotent; never overwrites a name fabrics.js already has)
export function registerFabrics4() {
  if (_done) return Object.keys(FABRICS4);
  for (const [k, f] of Object.entries(FABRICS4)) { if (FABRICS[k]) continue; FABRICS[k] = { ...f }; LOOKS[k] = LOOKS4[k]; FABRICS[k].look = LOOKS4[k]; }
  _done = true; return Object.keys(FABRICS4);
}
// a fabric's cantilever bending length (Peirce) and the painted fold wavelength, for the notes' table
export function fabricTable(phys) { return Object.keys(FABRICS4).map(k => { const P = phys(k); return { fabric: k, gsm: FABRICS4[k].gsm, mm: FABRICS4[k].mm, bend: FABRICS4[k].bend, c_cm: +(P.c * 100).toFixed(2), lambda_cm: +(P.c * 280).toFixed(1), stretch: FABRICS4[k].stretch }; }); }
