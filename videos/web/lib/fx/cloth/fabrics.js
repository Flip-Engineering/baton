// FABRICS (CLOTHING c1): what each cloth IS, as data both the drape solver and the shaders read. One entry per fabric a working
// wardrobe is made of; garments name a fabric instead of a hero.js `cKind` number.
//
// Physical fields (the drape, lib/fx/cloth/xpbd.js + drape.js):
//   gsm          areal density, g/m^2. Trade weights: 12 oz/yd^2 firm duck = 407, 14 oz denim = 475, 5 oz shirting chambray = 150-170,
//                single jersey tee 160-200, 65/35 poly-cotton 2/1 twill coverall 240-270, hi-vis polyester birdseye knit ~120,
//                3.5 oz (1.4 mm) jacket leather ~1.1 kg/m^2, wool melton 18-24 oz/yd^2 = 610-815 (1 oz/yd^2 = 33.9 g/m^2)
//   mm           thickness: the collision offset and the visible edge (rims, hems)
//   bend         bending rigidity in KES-F units, gf.cm^2/cm (Kawabata B). Typical ranges, not a measurement of a particular bolt:
//                knit jersey 0.01-0.03, shirting 0.05-0.10, flannel ~0.1, poly-cotton twill 0.1-0.25, denim 0.4-1.0, duck 1-3,
//                leather several. 1 gf.cm^2/cm = 9.81e-5 N.m
//   stretch      [warp, weft] in-plane stiffness, N/m (force per width per unit strain) at small strain. Wovens are close to
//                inextensible (1e4 N/m: KES EM of a few % at 490 N/m); knits are soft (a few hundred N/m) and softer across
//   shear        in-plane shear stiffness, N/m (bias stretch); wovens shear easily long before they stretch along a thread
//   mu           cloth-on-cloth / cloth-on-skin friction coefficient
// Checks the solver can be held to: Peirce's cantilever bending length c = (B / (rho g))^(1/3) (a strip held flat over a ledge
// droops to 41.5 degrees at an overhang of 2c); a square hung from two corners (stretch under its own weight).
//
// Look fields (the fabric shader, lib/fx/cloth/fabric_glsl.js) live in LOOKS below and are attached as FABRICS[name].look; the
// physical block above each look is the shared contract with the drape and is not changed by the look.
//   weave        { kind, over, under, epc, ppc, dir, weftShow, weft, contrast, slub }: construction on the face. kind 'twill' |
//                'plain' | 'duck' (plain with doubled warp ends) | 'jersey' | 'rib' | 'mesh' (birdseye knit) | 'leather' | 'felt';
//                over/under = the twill (3/1 denim: 3 over 1 under); epc / ppc = warp ends and weft picks per cm; dir +1 a right-hand
//                twill (the wale rises to the right); weftShow = the share of the face that shows weft at a distance (3/1 denim
//                ~0.14: the warp floats cover and shade the weft); weft = the weft's own colour (null: the dye); contrast = yarn-to-
//                yarn variation; slub = thick-thin streaks along the warp (denim's vertical striation)
//   rough        [mean, sd] GGX roughness (perceptual, three's `roughness`); measured from the Poly Haven scans where one exists
//   sheen        [amount, sheenRoughness, tint]: three's Charlie sheen (Estevez and Kulla 2017) for the fibres standing off the
//                surface; tint mixes the sheen colour from the dye toward the fibre's own white
//   nap          the asperity scale (hero.js c7, Koenderink and Pont 2003): fuzz that lights up against the light
//   aniso        [strength, exponent, tilt]: a fibre lobe (Kajiya-Kay) with the tangent along the floats, tilted by the twill angle:
//                the directional highlight a twill throws; the scans fit an anisotropy of ~0.5 for denim, ~0.6 for shirting
//   fluor        { col, f, ex }: fluorescent cloth. col = the total (reflected + fluoresced) linear RGB under white light, f = the
//                fluoresced share, ex = the excitation weights (blue light makes it glow; sodium does not)
//   dye          [saturation, value] of the garment colour as this fibre takes it (1, 1 = as given)
//   wear         { fibre, abr, soil, oil, core, whisker, pill, fade }: how this fibre ages. fibre 'indigo' (ring-dyed: abrasion
//                exposes the white core), 'pc' (soils, barely fades), 'duck' (pales and softens, frays), 'leather' (darkens with
//                oil, lightens on creases), 'hivis' (soils grey-brown, the fluorescence fades in sun), 'knit' (pills, fades);
//                core = the abraded colour (hex, or null: a pale version of the dye)
//   inside       [mix toward the weft face, occlusion]: the back of the cloth as seen inside a sleeve or a hem
//   seam         { thread, k }: topstitch colour and strength (denim's gold thread)
//   spec         the base layer's specular as three's specularIntensity: a fibre surface is not one interface, most of its surface
//                reflection goes into the fibre lobe and the sheen (cotton ~0.5; polyester and nylon filament nearer 0.8; a finished
//                hide 1). Without it the GGX lobe of F0 0.04 over a bumped dark cloth read as wet plastic.
//   finish       [clearcoat, clearcoatRoughness]: a leather's finish coat
// Measured references (Poly Haven, CC0, scanned at 270-400 mm across; albedo is the mean linear albedo of the diffuse map,
// roughness the mean of the roughness map, periods from the displacement map's spectrum), fetched for CLOTHING c1:
//   denim_fabric_04  albedo (0.070, 0.142, 0.242), luminance sd 23 %, rough 0.79 (sd 0.065), twill wale 0.77 mm, anisotropy 0.52
//   cotton_jersey    rough 0.80 (sd 0.05), courses 0.69 mm (14.5 / cm), anisotropy 0.56
//   stretch_poplin   rough 0.81 (sd 0.03), threads 0.40 mm (25 / cm), anisotropy 0.67
//   rough_linen      rough 0.72 (sd 0.10), threads 0.73 / 0.87 mm, anisotropy 0.64
//   brown_leather    albedo (0.083, 0.027, 0.006) (as saturated as any brown dye), rough 0.66 with sd 0.15 (p10 0.45, p90 0.86)
//   https://polyhaven.com/a/<name>, licence CC0. Nothing from the scans is shipped: the shading is procedural.
export const G = 9.81;
export const KES_B = 9.81e-5;          // gf.cm^2/cm -> N.m

export const FABRICS = {
  jersey:    { label: 'single jersey (tee)',              construction: 'knit',   gsm: 180,  mm: 0.55, bend: 0.015, stretch: [600, 300],     shear: 120,  mu: 0.55 },
  rib:       { label: '1x1 rib knit (cuffs, beanie)',      construction: 'rib',    gsm: 280,  mm: 1.2,  bend: 0.05,  stretch: [300, 150],     shear: 80,   mu: 0.6 },
  chambray:  { label: 'chambray shirting, plain weave',     construction: 'plain',  gsm: 155,  mm: 0.3,  bend: 0.07,  stretch: [8000, 6000],   shear: 300,  mu: 0.45 },
  flannel:   { label: 'brushed cotton flannel, 2/2 twill',  construction: 'twill22', gsm: 220, mm: 0.75, bend: 0.10,  stretch: [6000, 4000],   shear: 250,  mu: 0.6 },
  twillPC:   { label: '65/35 poly-cotton 2/1 twill',        construction: 'twill21', gsm: 255, mm: 0.45, bend: 0.18,  stretch: [12000, 9000],  shear: 450,  mu: 0.45 },
  denim:     { label: '14 oz denim, 3/1 RH twill',          construction: 'twill31', gsm: 475, mm: 0.85, bend: 0.8,   stretch: [15000, 10000], shear: 700,  mu: 0.5 },
  duck:      { label: '12 oz firm cotton duck',             construction: 'duck',   gsm: 407,  mm: 0.9,  bend: 1.8,   stretch: [20000, 15000], shear: 1200, mu: 0.5 },
  hivisMesh: { label: 'hi-vis polyester birdseye knit',     construction: 'mesh',   gsm: 120,  mm: 0.5,  bend: 0.02,  stretch: [800, 400],     shear: 100,  mu: 0.4 },
  leather:   { label: 'jacket leather, 3.5 oz (1.4 mm)',     construction: 'leather', gsm: 1150, mm: 1.4, bend: 8,     stretch: [25000, 25000], shear: 4000, mu: 0.6 },
  melton:    { label: 'wool melton',                        construction: 'felt',   gsm: 650,  mm: 2.2,  bend: 1.2,   stretch: [8000, 8000],   shear: 900,  mu: 0.65 },
  cordura:   { label: '500D nylon (Cordura)',               construction: 'plain',  gsm: 300,  mm: 0.5,  bend: 0.25,  stretch: [18000, 18000], shear: 900,  mu: 0.35 },
  // CLOTHING c1 fabric pass: the dyes of the hi-vis knit (same cloth as hivisMesh, its own fluorescent look), and the leathers of
  // boots and gloves (boot upper: 2.2 mm full-grain, KES B is a guess in the "several" range scaled by thickness cubed; glove: split
  // cowhide, the flesh side out, about 1.2 mm)
  hivisYG:   { label: 'hi-vis knit, fluorescent yellow-green', construction: 'mesh', gsm: 120, mm: 0.5,  bend: 0.02,  stretch: [800, 400],     shear: 100,  mu: 0.4 },
  hivisOR:   { label: 'hi-vis knit, fluorescent orange-red',   construction: 'mesh', gsm: 120, mm: 0.5,  bend: 0.02,  stretch: [800, 400],     shear: 100,  mu: 0.4 },
  bootLeather: { label: 'boot upper, full-grain 2.2 mm',     construction: 'leather', gsm: 1700, mm: 2.2, bend: 30,   stretch: [30000, 30000], shear: 6000, mu: 0.6 },
  gloveLeather: { label: 'split cowhide work glove',         construction: 'suede', gsm: 950,  mm: 1.2,  bend: 3,     stretch: [15000, 15000], shear: 2500, mu: 0.7 },
};

// ---------------------------------------------------------------- the look of each fabric (fields: see the header)
const L = (o) => o;
export const LOOKS = {
  jersey: L({ weave: { kind: 'jersey', epc: 13, ppc: 14.5, weftShow: 0, contrast: 0.12, slub: 0.1 }, rough: [0.8, 0.05], sheen: [0.35, 0.55, 0.25], nap: 0.9,
    aniso: [0.12, 10, 0], dye: [1, 1], wear: { fibre: 'knit', abr: 0.35, soil: 0.45, pill: 0.7, fade: 0.5 }, inside: [0.3, 0.32], seam: { thread: null, k: 0.6 } }),
  rib: L({ weave: { kind: 'rib', epc: 7, ppc: 12, weftShow: 0, contrast: 0.2, slub: 0 }, rough: [0.85, 0.04], sheen: [0.35, 0.55, 0.25], nap: 0.9,
    aniso: [0.1, 10, 0], dye: [1, 1], wear: { fibre: 'knit', abr: 0.3, soil: 0.5, pill: 0.8, fade: 0.4 }, inside: [0.3, 0.32], seam: { thread: null, k: 0.4 } }),
  chambray: L({ weave: { kind: 'plain', epc: 30, ppc: 26, weftShow: 0.28, weft: '#bcb8ac', contrast: 0.22, slub: 0.3 }, rough: [0.8, 0.03], sheen: [0.22, 0.6, 0.3], nap: 0.5,
    aniso: [0.3, 18, 0], dye: [1, 1], wear: { fibre: 'indigo', abr: 0.7, soil: 0.6, whisker: 0, fade: 0.35 }, inside: [0.5, 0.32], seam: { thread: null, k: 0.7 } }),
  flannel: L({ weave: { kind: 'twill', over: 2, under: 2, epc: 18, ppc: 17, dir: 1, weftShow: 0.5, contrast: 0.15, slub: 0.15, plaid: 0.062 }, rough: [0.9, 0.04], sheen: [0.6, 0.5, 0.3], nap: 1.5,
    aniso: [0.06, 8, 0.6], dye: [1, 1], wear: { fibre: 'knit', abr: 0.45, soil: 0.5, pill: 0.6, fade: 0.45 }, inside: [0.4, 0.32], seam: { thread: null, k: 0.5 } }),
  twillPC: L({ weave: { kind: 'twill', over: 2, under: 1, epc: 40, ppc: 22, dir: 1, weftShow: 0.33, contrast: 0.1, slub: 0.08 }, rough: [0.8, 0.04], sheen: [0.18, 0.55, 0.2], nap: 0.45,
    aniso: [0.32, 24, 0.5], dye: [1, 1], wear: { fibre: 'pc', abr: 0.25, soil: 1.0, fade: 0.15 }, inside: [0.35, 0.3], seam: { thread: null, k: 0.8 } }),
  denim: L({ weave: { kind: 'twill', over: 3, under: 1, epc: 26, ppc: 18, dir: 1, weftShow: 0.09, weft: '#b0a894', contrast: 0.3, slub: 0.45 }, rough: [0.79, 0.065], sheen: [0.25, 0.65, 0.3], nap: 0.7,
    aniso: [0.45, 20, 0.45], dye: [1, 1], wear: { fibre: 'indigo', abr: 1.0, soil: 0.45, whisker: 1.0, core: '#c9d2dc', fade: 0.4 }, inside: [0.75, 0.32], seam: { thread: '#c08a32', k: 1 } }),
  duck: L({ weave: { kind: 'duck', epc: 18, ppc: 10, weftShow: 0.42, contrast: 0.16, slub: 0.25 }, rough: [0.86, 0.05], sheen: [0.2, 0.75, 0.2], nap: 0.6,
    aniso: [0.14, 10, 0], dye: [1, 1], wear: { fibre: 'duck', abr: 0.9, soil: 0.85, fray: 1.0, fade: 0.35 }, inside: [0.45, 0.3], seam: { thread: '#b8955a', k: 0.9 } }),
  hivisMesh: L({ weave: { kind: 'mesh', epc: 6, ppc: 6, weftShow: 0, contrast: 0.1, slub: 0 }, rough: [0.62, 0.05], sheen: [0.15, 0.4, 0.15], nap: 0.2,
    aniso: [0.2, 30, 0], dye: [1, 1], wear: { fibre: 'hivis', abr: 0.2, soil: 1.0, fade: 0.5 }, inside: [0.2, 0.3], seam: { thread: null, k: 0.5 } }),
  leather: L({ weave: { kind: 'leather', epc: 13, ppc: 13, weftShow: 0, contrast: 0.25, slub: 0 }, rough: [0.5, 0.14], sheen: [0, 0.5, 0], nap: 0.05,
    aniso: [0, 1, 0], finish: [0.35, 0.34], dye: [1.3, 0.8], wear: { fibre: 'leather', abr: 0.6, soil: 0.3, oil: 1.0, crease: 0.8 }, inside: [0, 0.3], lining: '#2e2620', seam: { thread: '#3a2a1c', k: 0.8 } }),
  melton: L({ weave: { kind: 'felt', epc: 10, ppc: 10, weftShow: 0, contrast: 0.12, slub: 0 }, rough: [0.92, 0.03], sheen: [0.5, 0.55, 0.25], nap: 1.5,
    aniso: [0, 1, 0], dye: [1, 1], wear: { fibre: 'knit', abr: 0.3, soil: 0.4, pill: 0.9, fade: 0.2 }, inside: [0.2, 0.3], seam: { thread: null, k: 0.4 } }),
  cordura: L({ weave: { kind: 'plain', epc: 16, ppc: 14, weftShow: 0.5, contrast: 0.08, slub: 0 }, rough: [0.55, 0.05], sheen: [0.15, 0.4, 0.4], nap: 0.2,
    aniso: [0.4, 40, 0], dye: [1, 1], wear: { fibre: 'pc', abr: 0.3, soil: 0.7, fade: 0.1 }, inside: [0.4, 0.3], lining: '#4a4a48', seam: { thread: null, k: 0.6 } }),
  bootLeather: L({ weave: { kind: 'leather', epc: 9, ppc: 9, weftShow: 0, contrast: 0.3, slub: 0 }, rough: [0.48, 0.15], sheen: [0, 0.5, 0], nap: 0.05,
    aniso: [0, 1, 0], finish: [0.3, 0.3], dye: [0.9, 1], wear: { fibre: 'leather', abr: 0.8, soil: 0.6, oil: 0.6, crease: 1.0 }, inside: [0, 0.3], seam: { thread: '#5a4a32', k: 0.8 } }),
  gloveLeather: L({ weave: { kind: 'felt', epc: 20, ppc: 20, weftShow: 0, contrast: 0.18, slub: 0 }, rough: [0.9, 0.04], sheen: [0.5, 0.6, 0.35], nap: 1.3,
    aniso: [0, 1, 0], dye: [0.9, 1], wear: { fibre: 'leather', abr: 0.5, soil: 0.9, oil: 0.8, crease: 0.4 }, inside: [0, 0.3], seam: { thread: null, k: 0.5 } }),
};
const SPEC = { jersey: 0.4, rib: 0.4, chambray: 0.45, flannel: 0.35, twillPC: 0.5, denim: 0.4, duck: 0.4, hivisMesh: 0.7, leather: 1, melton: 0.35, cordura: 0.8, bootLeather: 1, gloveLeather: 0.4 };
for (const [k, v] of Object.entries(SPEC)) LOOKS[k].spec = v;
// hi-vis dyes: ANSI/ISEA 107 background material: fluorescent yellow-green luminance factor >= 0.76, orange-red >= 0.40, red >= 0.25,
// at chromaticities outside what a non-fluorescent pigment reaches. The fluoresced share (~a third under daylight) is light absorbed
// in the blue and violet and re-emitted in the green-yellow (or orange): under a lamp with little blue (sodium) it reads as an ordinary
// yellow; under daylight or metal halide it returns more light in its band than a white diffuser does.
LOOKS.hivisYG = { ...LOOKS.hivisMesh, fluor: { col: [0.8, 1.0, 0.06], f: 0.38, ex: [0.0, 0.25, 1.0] } };
LOOKS.hivisOR = { ...LOOKS.hivisMesh, fluor: { col: [1.55, 0.12, 0.0], f: 0.45, ex: [0.0, 0.3, 1.0] } };   // x 0.61, y 0.36, Y 0.41: inside the ANSI orange-red zone (radiance factor > 1 in red: it fluoresces)
for (const [k, l] of Object.entries(LOOKS)) if (FABRICS[k]) FABRICS[k].look = l;
export const look = name => (FABRICS[name] || {}).look || LOOKS.twillPC;

// FABRIC7 (8 Oct, CLOTH9's hand-off): the Peirce bending lengths the drape and the fabric shader should HAVE. Rev 6 numbers come from pure-bending KES B ranges, whose cantilever
// bending length c = (B / (rho g))^(1/3) is LOW for the wovens (oxford 1.7 cm, chino 1.8, denim 2.6; CLOTH9's table): cloth that hangs limp is cloth that does not read heavy
// (AUDIT7: "cloth that does not read heavy"). The values below are the cantilever (BS 3356 / ASTM D1388, Peirce) bending lengths of the trade fabrics: single jersey 1.0-1.5 cm,
// poplin / shirting 2.0-2.5, chino / cotton twill 2.8-3.2, 14 oz denim 3.8-4.5 (10.5 oz stretch 3.2-3.6), 10-12 oz canvas / duck 3.6-4.6, wool flannel 2.8-3.4, melton 3.5-4.5,
// brushed fleece 1.8-2.2 (a thick knit: 1.4 mm bends like a light woven). Guidance, not a bolt's measurement; each is the middle of its range. Keys: fabrics.js (c1) and wardrobe4/fabrics4.js (K4);
// a fabric not listed (jersey, rib, leathers, hi-vis, gloves) keeps its rev-6 bend. OPT-IN: phys(name) is rev 6 as it always was; phys(name, 7) / setPhysRev(7) give the rev-7 B.
export const BEND_C7 = {   // Peirce bending length, cm
  chambray: 2.1, flannel: 2.4, twillPC: 3.0, denim: 4.0, duck: 4.2, melton: 3.8, cordura: 3.0,
  fleece: 2.0, chino: 3.0, canvas: 3.8, stretchDenim: 3.4, woolFlannel: 3.1, oxford: 2.3, scrub: 2.1,
};
let PHYS_REV = 6;
export function setPhysRev(n = 6) { PHYS_REV = n >= 7 ? 7 : 6; return PHYS_REV; }
export const physRev = () => PHYS_REV;
// SI view of a fabric: rho kg/m^2, B N.m, k [warp, weft] N/m, shear N/m, h m, Peirce bending length c m. rev 7 (opt-in): B from BEND_C7 where the fabric has an entry
export function phys(name, rev = PHYS_REV) {
  const f = typeof name === 'string' ? FABRICS[name] : name; if (!f) throw new Error(`unknown fabric ${name}`);
  const rho = f.gsm / 1000; let B = f.bend * KES_B;
  if (rev >= 7 && typeof name === 'string' && BEND_C7[name]) B = rho * G * Math.pow(BEND_C7[name] / 100, 3);
  return { rho, B, k: f.stretch, shear: f.shear, h: f.mm / 1000, mu: f.mu, c: Math.cbrt(B / (rho * G)) };
}
export const bendingLength = (name, rev) => phys(name, rev).c;
