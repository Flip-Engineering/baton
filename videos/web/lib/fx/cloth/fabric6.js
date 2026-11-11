// FABRIC6 (round 6, 4 Oct): fabric rev 6, the look of OUR fabric pipeline taken toward the photograph. A refinement of CLOTHING c1's
// fabric path (fabric_glsl.js fabricMaterial, fabrics.js LOOKS) and K4's nine fabrics (wardrobe4/fabrics4.js); nothing replaced.
// OPT-IN: nothing changes until a page calls useFabric6() (fabric_glsl.js then hands every pattern-coordinate fabric material, the sewn
// garments of v3-v5 people and the fabric book, to hook6 below); stopFabric6() turns it off for materials made after. Without it every
// fabric, figure and scene renders byte for byte as before (fabric_glsl.js's hook is null).
//
// What rev 6 adds, all in the garment's own flat-pattern coordinate (metres; warp along v):
//   yarns       the weave or knit at its real thread count, yarn by yarn: twill floats (3/1 denim, 2/1 chino, 2/2 wool flannel), plain
//               (poplin), paired warp ends (duck / canvas, oxford's basket), jersey V loops, 1x1 rib with its purl columns set back.
//               Each yarn a round cross-section rising over and diving under its neighbours: a height, its slope into the normal (the
//               fold field's analytic route, not screen derivatives), the gaps between yarns in shadow. Per-yarn colour: denim's
//               indigo warp over an ecru weft, oxford's dyed warp over white, end-to-end tone and thick-thin slub, heather as fibre
//               lanes of undyed fibre inside each yarn. Drawn while a thread spans more than ~1.5 px; further away it is CLOTHING c1's
//               box-filtered average (unchanged), so a figure at 270 px keeps K4's colours.
//   fibre lobe  Kajiya-Kay per float: along the visible yarn's fibres (the yarn's twist tilts them), the warp's lobe and the weft's
//               lobe weighted by what shows; knit legs lean their own way.
//   sheen       Charlie sheen per fabric (wool and fleece raised, poplin low); fuzz shells (fuzz6) for the fibres that stand off fleece,
//               wool flannel and heather jersey: they break the silhouette.
//   wrinkles    fine wrinkles from the cloth's own strain: where the solved cloth is shorter than its pattern (the bake's bind shape
//               against the flat pattern, per vertex) the excess length buckles into ridges across the compression at the fabric's
//               fine-wrinkle wavelength (amplitude a = lambda / pi * sqrt(compression): the arc length of a sine), broken into short
//               wrinkles; where it is stretched the cloth goes smooth (c1's fine noise is dropped there).
//   seams       per vertex, the exact flat-pattern distance to the nearest sewn edge and the arc length along it: the seam well (the
//               dark line where two panels meet), the pressed allowance's ridge, puckering along the seam, topstitch rows as stitches
//               (thread colour, ply, the needle holes) along the seam, not across it.
//   hems        the same to the nearest free edge: the turned edge's roll, the raw edge's ridge under the cloth, the hem's stitch rows
//               (a knit's two coverstitch rows); stitch ribbons (K4's trim: yokes, pockets, the fly) drawn as stitches along their length.
//   wear        by garment age (useFabric6({ age }) or the fabric's own), at the places a body wears cloth (from the skeleton: knees,
//               the backs of the knees, the lap, the seat, elbows; from the pattern: seams, hems; from the shape: fold and wrinkle
//               crests): indigo bares its white core (whiskers, honeycombs, roping at seams and hems, high spots of slub yarn first),
//               cotton twill and canvas pale at edges, knits fade and pill, wool goes shiny.
//
//   import { useFabric6, prepareFabric6, fuzz6, LOOKS6 } from '/web/lib/fx/cloth/fabric6.js';
//   useFabric6({ age: 0.4 });                         // BEFORE makePerson / fabricMaterial
//   const P = await makePerson('v5:L08_f24_hispanic', { studio, stage: 'studio@5' });
//   prepareFabric6(P.h.group); fuzz6(P.h.group);      // optional: the per-vertex data now (else on first draw), fuzz shells
// Cost: three vec4 attributes and varyings on garment meshes (not the body: its 16 attribute slots are full), ~0.1-0.3 s of JS per
// person for the per-vertex data, a heavier fragment (three yarn evaluations a pixel where a thread spans > 1.5 px).
import * as THREE from 'three';
import { FABRICS, LOOKS, phys, BEND_C7, G } from './fabrics.js';
import { setFabricHook } from './fabric_glsl.js';
import { foundationWavelength } from './fabric7/crease7.js';

export const FABRIC6_VERSION = 1;
const K6 = { plain: 0, twill: 1, duck: 2, basket: 3, jersey: 4, rib: 5, none: 6 };
const F6 = { indigo: 1, cotton: 2, knit: 3, wool: 4, synth: 2 };

// ---------------------------------------------------------------- yarn records (rev 6), by fabric
// kind     the face construction as rev 6 draws it (above); yw [warp, weft] yarn width as a share of its spacing (oxford's weft is
//          the thicker); tw the fibres' tilt to the yarn axis on its surface (deg; ring-spun cotton 15-25, open-end denim ~20, combed
//          shirting ~15); tone [warp, weft] end-to-end shade spread; slub thick-thin strength along the warp; hair yarn hairiness;
//          heather [undyed fibre share, its colour]; nap how much a raised nap hides the weave (0..1)
// wr       [fine-wrinkle wavelength m, slope cap]: a fold of a fabric of bending length c sits at 2.8 c (c1); fine wrinkles at about
//          0.6-0.9 c, held to what a photo of each shows (tee 6-9 mm, shirting 7-10 mm, chino 10-14, denim 12-20, canvas 15-25)
// sheen6   [weight, roughness] of the Charlie sheen (engine) and Principled sheen (Cycles); fuzz [shell length mm, density] (0: none)
// seam     [row 1 m, row 2 m, stitch length m] topstitch rows from the seam (0 = none: knits are overlocked inside); hem [depth m,
//          rows: 1 single needle, 2 a coverstitch's twin rows]; age the default garment age (0 new .. 1 worn through); fibre the wear
const L6 = o => o;
export const LOOKS6 = {
  stretchDenim: L6({ kind: 'twill', yw: [0.94, 0.78], tw: 22, tone: [0.2, 0.08], slub: 0.5, hair: 0.25, heather: [0, null], nap: 0, wr: [0.014, 0.16], sheen6: [0.22, 0.6], fuzz: [0, 0], seam: [0.0065, 0, 0.0034], hem: [0.012, 1], age: 0.35, fibre: 'indigo' }),
  denim:        L6({ kind: 'twill', yw: [0.94, 0.78], tw: 22, tone: [0.22, 0.08], slub: 0.6, hair: 0.3, heather: [0, null], nap: 0, wr: [0.018, 0.16], sheen6: [0.24, 0.62], fuzz: [0, 0], seam: [0.0065, 0, 0.0036], hem: [0.012, 1], age: 0.4, fibre: 'indigo' }),
  chino:        L6({ kind: 'twill', yw: [0.9, 0.84], tw: 18, tone: [0.07, 0.05], slub: 0.08, hair: 0.18, heather: [0, null], nap: 0, wr: [0.012, 0.17], sheen6: [0.18, 0.55], fuzz: [0, 0], seam: [0, 0, 0.003], hem: [0.03, 1], age: 0.35, fibre: 'cotton' }),
  twillPC:      L6({ kind: 'twill', yw: [0.9, 0.84], tw: 16, tone: [0.06, 0.04], slub: 0.05, hair: 0.12, heather: [0, null], nap: 0, wr: [0.012, 0.16], sheen6: [0.18, 0.55], fuzz: [0, 0], seam: [0.006, 0, 0.0032], hem: [0.025, 1], age: 0.4, fibre: 'cotton' }),
  canvas:       L6({ kind: 'duck', yw: [0.9, 0.9], tw: 18, tone: [0.1, 0.08], slub: 0.25, hair: 0.3, heather: [0, null], nap: 0, wr: [0.02, 0.15], sheen6: [0.2, 0.7], fuzz: [0, 0], seam: [0.006, 0, 0.0035], hem: [0.025, 1], age: 0.45, fibre: 'cotton' }),
  oxford:       L6({ kind: 'basket', yw: [0.82, 0.96], tw: 14, tone: [0.1, 0.04], slub: 0.15, hair: 0.15, heather: [0, null], nap: 0, wr: [0.009, 0.18], sheen6: [0.2, 0.6], fuzz: [0, 0], seam: [0.006, 0, 0.0025], hem: [0.008, 1], age: 0.25, fibre: 'cotton' }),
  chambray:     L6({ kind: 'plain', yw: [0.86, 0.86], tw: 16, tone: [0.14, 0.06], slub: 0.3, hair: 0.2, heather: [0, null], nap: 0, wr: [0.009, 0.18], sheen6: [0.2, 0.6], fuzz: [0, 0], seam: [0.006, 0, 0.0028], hem: [0.008, 1], age: 0.35, fibre: 'indigo' }),
  scrub:        L6({ kind: 'plain', yw: [0.86, 0.86], tw: 10, tone: [0.03, 0.03], slub: 0.02, hair: 0.06, heather: [0, null], nap: 0, wr: [0.009, 0.16], sheen6: [0.14, 0.45], fuzz: [0, 0], seam: [0, 0, 0.003], hem: [0.025, 1], age: 0.3, fibre: 'synth' }),
  teeJersey:    L6({ kind: 'jersey', yw: [0.95, 0.95], tw: 18, tone: [0.015, 0.015], slub: 0.06, hair: 0.3, heather: [0, null], nap: 0, wr: [0.0075, 0.2], sheen6: [0.32, 0.55], fuzz: [0.35, 0.12], seam: [0, 0, 0.003], hem: [0.02, 2], age: 0.3, fibre: 'knit' }),
  heatherJersey: L6({ kind: 'jersey', yw: [0.95, 0.95], tw: 18, tone: [0.015, 0.015], slub: 0.08, hair: 0.35, heather: [0.32, '#e8e5df'], nap: 0, wr: [0.0075, 0.2], sheen6: [0.34, 0.55], fuzz: [0.4, 0.18], seam: [0, 0, 0.003], hem: [0.02, 2], age: 0.35, fibre: 'knit' }),
  jersey:       L6({ kind: 'jersey', yw: [0.95, 0.95], tw: 18, tone: [0.015, 0.015], slub: 0.08, hair: 0.3, heather: [0, null], nap: 0, wr: [0.0075, 0.2], sheen6: [0.32, 0.55], fuzz: [0.35, 0.12], seam: [0, 0, 0.003], hem: [0.02, 2], age: 0.35, fibre: 'knit' }),
  fleece:       L6({ kind: 'jersey', yw: [0.98, 0.98], tw: 20, tone: [0.015, 0.015], slub: 0.04, hair: 0.6, heather: [0.03, '#dedad2'], nap: 0.25, wr: [0.012, 0.17], sheen6: [0.46, 0.6], fuzz: [0.8, 0.35], seam: [0, 0, 0.003], hem: [0.02, 2], age: 0.4, fibre: 'knit' }),
  rib:          L6({ kind: 'rib', yw: [0.95, 0.95], tw: 18, tone: [0.015, 0.015], slub: 0.04, hair: 0.3, heather: [0, null], nap: 0, wr: [0.006, 0.1], sheen6: [0.32, 0.55], fuzz: [0.3, 0.1], seam: [0, 0, 0.003], hem: [0, 0], age: 0.35, fibre: 'knit' }),
  woolFlannel:  L6({ kind: 'twill', yw: [0.92, 0.9], tw: 12, tone: [0.06, 0.06], slub: 0.1, hair: 0.8, heather: [0.24, '#d9d5cc'], nap: 0.55, wr: [0.012, 0.15], sheen6: [0.56, 0.5], fuzz: [0.9, 0.4], seam: [0, 0, 0.003], hem: [0.035, 0], age: 0.25, fibre: 'wool' }),
};
// a fabric without a record: one from its c1 look (kind from the weave; no fuzz, no topstitch), or null (leather, felt, mesh: rev 5 as is)
export function look6(name) {
  if (LOOKS6[name]) return LOOKS6[name];
  const L = LOOKS[name]; if (!L) return null; const k = L.weave?.kind;
  if (!['plain', 'twill', 'duck', 'jersey', 'rib'].includes(k)) return null;
  return { kind: k, yw: [0.9, 0.85], tw: 16, tone: [0.08, 0.05], slub: L.weave.slub || 0.1, hair: 0.2, heather: [0, null], nap: 0, wr: [0.012, 0.16], sheen6: [L.sheen?.[0] ?? 0.2, L.sheen?.[1] ?? 0.6], fuzz: [0, 0], seam: [0, 0, 0.003], hem: [0.015, 1], age: 0.35, fibre: L.wear?.fibre === 'indigo' ? 'indigo' : (k === 'jersey' || k === 'rib') ? 'knit' : 'cotton' };
}

let OPTS = { age: null, ageScale: 1, wrinkles: 1, construction: 1, wear: 1, yarns: 1, cascade: 0, setRelief: 1 };   // cascade 1: the strain-driven wrinkle CASCADE (wrinkleCascade below); 0: one fine wavelength, as before
// turn rev 6 on for fabric materials made from now on. age: a number (every garment) or { fabric: age } (else each fabric's own);
// ageScale scales the fabric's own; wrinkles / construction / wear / yarns: 0 switches that layer off (for A/B boards)
export function useFabric6(o = {}) { OPTS = { ...OPTS, ...o }; setFabricHook(hook6); return FABRIC6_VERSION; }
export function stopFabric6() { setFabricHook(null); }
export const fabric6Options = () => ({ ...OPTS });

const lin = hex => new THREE.Color(hex);
function ageOf(name, L) { const a = OPTS.age; return Math.max(0, Math.min(1, (typeof a === 'number' ? a : a && typeof a === 'object' && a[name] != null ? a[name] : L.age) * (OPTS.ageScale ?? 1))); }
// the rev-6 uniforms of a fabric in a garment colour (the dye as fabric_glsl's pack took it)
// the yarn model's own numbers for a fabric: the weft's visible width set so the weft shows on the face as much as c1's far colour says
// (weftShow: denim ~0.1, chino 0.3, wool flannel 0.5), and the share it then really shows (sampled: the detail's mean, so the yarns keep
// the far colour's level and nothing pumps between near and far)
// the weft share each woven yarn model really shows, measured on its engine-rendered tile (fabric6_tiles.mjs: the mean of the tile's r);
// the JS estimate below is the fallback for a fabric without a measured tile
export const WS6 = {"canvas": 0.4026, "chambray": 0.375, "chino": 0.3097, "denim": 0.0625, "oxford": 0.5, "scrub": 0.5468, "stretchDenim": 0.125, "twillPC": 0.3913, "woolFlannel": 0.5386};
// the mean shadowing of the gaps (the shader's ao) on each tile: the yarn detail is divided by it, so it keeps the far colour's level
export const AO6 = {"canvas": 0.988, "chambray": 0.9248, "chino": 0.9931, "denim": 0.9845, "fleece": 0.9922, "heatherJersey": 0.9918, "jersey": 0.9918, "oxford": 0.9564, "rib": 0.8635, "scrub": 0.9891, "stretchDenim": 0.9878, "teeJersey": 0.9918, "twillPC": 0.9957, "woolFlannel": 0.9973};
const _ws = new Map();
export function yarn6(name, L = look6(name)) {
  if (_ws.has(name)) return _ws.get(name);
  const Lk = LOOKS[name] || LOOKS.twillPC, W = Lk.weave, k = K6[L.kind] ?? K6.none, over = W.over || 1, under = W.under || 1, dir = W.dir ?? 1;
  let r = { ywf: L.yw[1], ws: 0 };
  if (k <= 3) {
    const topShare = k === 1 ? under / (over + under) : 0.5, ywf = Math.max(0.3, Math.min(1.0, (W.weftShow ?? 0.3) / topShare));
    const top = (x, y) => { const m = (a, b) => ((a % b) + b) % b; if (k === 1) { const per = Math.max(over + under, 2); return m(x + dir * y, per) <= over - 0.5 ? 1 : 0; } if (k === 2 || k === 3) return m(Math.floor(x * 0.5) + y, 2) <= 0.5 ? 1 : 0; return m(x + y, 2) <= 0.5 ? 1 : 0; };
    const ss = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    let n = 0, wv = 0; const S = 24, P = 2 * (over + under);
    for (let cy = 0; cy < P; cy++) for (let cx = 0; cx < P; cx++) for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const fx = (i + 0.5) / S, fy = (j + 0.5) / S, t = top(cx, cy), tN = top(cx, cy + 1), tS = top(cx, cy - 1), tE = top(cx + 1, cy), tW = top(cx - 1, cy);
      const sy = ss(0, 1, Math.abs(fy - 0.5) * 2), sx = ss(0, 1, Math.abs(fx - 0.5) * 2), lw = t + (0.5 * (t + (fy > 0.5 ? tN : tS)) - t) * sy, lf = (1 - t) + ((1 - 0.5 * (t + (fx > 0.5 ? tE : tW))) - (1 - t)) * sx;
      const xw = (fx - 0.5) / (0.5 * L.yw[0]), xf = (fy - 0.5) / (0.5 * ywf);
      const hw = 0.32 * (lw - 0.5) + 0.25 * L.yw[0] * Math.sqrt(Math.max(0, 1 - xw * xw)) - (Math.abs(xw) >= 1 ? 1 : 0), hf = 0.32 * (lf - 0.5) + 0.25 * ywf * Math.sqrt(Math.max(0, 1 - xf * xf)) - (Math.abs(xf) >= 1 ? 1 : 0);
      wv += ss(-0.02, 0.02, hf - hw); n++; }
    r = { ywf, ws: WS6[name] ?? wv / n }; }
  _ws.set(name, r); return r;
}
// THE WRINKLE CASCADE (FABRIC7 c5 it1, ridge form c5 it2). strainField gives each vertex the compression the solved cloth carries against its flat pattern (the excess length), and rev 6 spent all of it at ONE fine
// wavelength (wr[0]: 0.6-0.9 bending lengths, 6-18 mm), where a compression of 1-3 % is a ripple of 0.2-0.9 mm that reads only at 1:1 (as wood-grain bands: AUDIT7 C14) and nothing makes the 3-10 cm folds that
// read at 270 px (AUDIT7 C11). Mechanics says where the excess goes. (1) WHICH SCALE: a wave of wavelength lambda absorbs an excess length eps = (pi A / lambda)^2 and costs bending energy 4 pi^2 B eps / lambda^2
// per area, so the cloth puts its excess into the LONGEST wavelength its supports allow and only the remainder into finer ones; the longest is the fold of a fabric of bending length c, lambda_F = 2.8 c
// (fabrics.js: the length at which bending balances the cloth's own weight). Octaves lambda_n = lambda_0 R^n from the fine wavelength to lambda_F (N = 1 + round(log2(lambda_F / lambda_0)), at most 4), the excess
// shared in proportion to lambda_n^2 (the bending-energy weight: the top octave carries ~3/4). (2) WHAT FORM: far above its buckling strain (a woven cloth buckles at ~1e-4; the solved garments carry 1e-3 to 3e-2)
// a compressed sheet does not undulate, it folds: creases across the compression, each a rounded ridge or furrow with flat panels between, as long as several wavelengths and ending in a taper (tension-field
// wrinkling; crumpled paper's ridges). Each octave is a sparse-kernel field of such creases (the shader's block: A sech^2(u / w) across, a Gaussian taper along, in the pixel's own compression direction), its amplitude
// fixed by conservation of the excess length (the creases' slope energy along the compression is 2 eps_n; labs/clothing2/fabric7_wrinkle_field.mjs --conserve checks it: 0.88-0.99). The first cascade (c5 it1)
// summed cell-wise sinusoids with random phases: by the same law it put the same excess into soft, short, blurred puddles, which no cloth shows. Nothing is fitted to a render; the crease width / length / spacing
// (0.22, 1.6, 1.0 wavelengths) are the model's three constants, the exponent 2 the energy's, and the slope cap of strainField bounds every crease.
export const CASCADE_P = 2;
// THE BOTTOM OF THE LADDER (c5 it5): with the cascade on, the finest wavelength is the sheet-on-a-foundation law (Allen 1969, Cerda and Mahadevan 2003), lambda_0 = 2 pi (4 B / E*)^(1/3): B the fabric's bending
// stiffness (rho g c^3, c the Peirce bending length: the same c that sets the fold wavelength 2.8 c at the top), E* the plane-strain modulus of the skin the cloth lies on (SUBSTRATE: the dermis the soft-tissue solver carries,
// 22.7 kPa, nu 0.49; the subcutis under it, 2.5 kPa, is the other number the solver has and gives wavelengths twice the table's). The table it replaces (LOOKS6 wr[0], 'held to what a photo of each shows') agrees with the law on
// the dermis to a geometric mean 1.05 over the twelve fabrics (labs/clothing2/fabric7_foundation.mjs): the law now says WHY, and moves with the fabric's B. wr[1] (the slope cap) stays the look's.
export const SUBSTRATE = { E: 22.7e3, nu: 0.49, src: 'dermis, in vivo, Mazier and Bordas 2024 (soft/breast.js TISSUE.vivo.Eskin); the cloth lies on skin' };
export const bendC = name => BEND_C7[name] ? BEND_C7[name] / 100 : phys(FABRICS[name] ? name : 'twillPC').c;
export function lam0Of(name, L = look6(name)) {
  if (!OPTS.cascade) return L.wr[0];
  const c = bendC(name), rho = (FABRICS[name] || FABRICS.twillPC).gsm / 1000, B = rho * G * c * c * c;
  return foundationWavelength(B, SUBSTRATE.E / (1 - SUBSTRATE.nu * SUBSTRATE.nu));
}
export function cascade6(name, L = look6(name)) {
  const c = bendC(name), lamF = 2.8 * c, lam0 = lam0Of(name, L);
  if (!OPTS.cascade || !(lamF > lam0 * 1.3)) return { n: 1, R: 1, lamF, lam0 };
  const n = Math.max(1, Math.min(4, 1 + Math.round(Math.log2(lamF / lam0))));
  return { n, R: n > 1 ? Math.pow(lamF / lam0, 1 / (n - 1)) : 1, lamF, lam0 };
}
export function uniforms6(name, dye, L = look6(name)) {
  const F = FABRICS[name] || FABRICS.twillPC, Lk = LOOKS[name] || LOOKS.twillPC, thread = Lk.seam?.thread ? lin(Lk.seam.thread) : dye.clone().multiplyScalar(0.82), Y6 = yarn6(name, L);
  const het = L.heather?.[1] ? lin(L.heather[1]) : new THREE.Color(0.8, 0.79, 0.76);
  return {
    f6Y0: { value: new THREE.Vector4(OPTS.yarns === 0 ? K6.none : K6[L.kind] ?? K6.none, L.yw[0], Y6.ywf, THREE.MathUtils.degToRad(L.tw)) }, f6M: { value: Y6.ws }, f6AO: { value: AO6[name] ?? 0.86 },
    f6Y1: { value: new THREE.Vector4(L.hair, L.slub, L.tone[0], L.tone[1]) },
    f6Y2: { value: new THREE.Vector4(L.heather?.[0] || 0, L.nap || 0, lam0Of(name, L), OPTS.wrinkles === 0 ? 0 : L.wr[1]) },
    f6Wc: { value: (() => { const c = cascade6(name, L); return new THREE.Vector4(c.n, c.R, CASCADE_P, c.lamF); })() },   // the wrinkle cascade: octaves, ratio, energy exponent, the fold wavelength (read when F6_CASCADE)
    f6Sk: { value: OPTS.setRelief === 0 ? 0 : 1 },                       // the relief of the worn lines' set creases (F6_WEAR; setRelief: 0 is the A/B: the lines as colour only)
    f6Wg: { value: 0 },                                                  // the top octaves the garment's GEOMETRY carries (fold7.js sets it per mesh before each draw): the shader draws only the finer ones
    f6S: { value: new THREE.Vector4(L.seam[0], L.seam[1], L.seam[2], L.hem[0]) },
    f6A: { value: new THREE.Vector4(OPTS.wear === 0 ? 0 : ageOf(name, L), F6[L.fibre] || 2, L.hem[1], OPTS.construction === 0 ? 0 : 1) },
    f6H: { value: het }, f6T: { value: thread }, f6Per: { value: 0 }, f6Thk: { value: F.mm / 1000 },
  };
}

// ---------------------------------------------------------------- GLSL (inserted into fabric_glsl.js's program by string anchors)
export const F6_PARS = `
#ifdef F6_ATTR
varying vec4 vF6s, vF6w, vF6e;
#endif
uniform vec4 f6Y0, f6Y1, f6Y2, f6S, f6A, f6Wc; uniform vec3 f6H, f6T; uniform float f6Per, f6Thk, f6M, f6AO, f6Wg, f6Sk;
vec3 gT2 = vec3(1.0, 0.0, 0.0); float gW2 = 0.0, f6High = 0.5, f6Crease = 0.0, f6Yarn = 0.0; vec2 f6G = vec2(0.0), f6Gs = vec2(0.0), f6Ga = vec2(0.0), f6Gh = vec2(0.0), f6Gha = vec2(0.0); vec4 f6Fw = vec4(1.0);
float f6hash(vec2 c, float s){ if (f6Per > 0.5) c = mod(c, f6Per); return hh(vec3(c + vec2(0.37, 0.71), s)); }
float f6vn(float i, float y, float s){ float y0 = floor(y), u = fract(y); u = u * u * (3.0 - 2.0 * u); return mix(f6hash(vec2(i, y0), s), f6hash(vec2(i, y0 + 1.0), s), u); }
// is the warp end over the pick at crossing cell c (x: end, y: pick)
float f6top(vec2 c){ int K = int(f6Y0.x + 0.5);
  if (K == 1) { float per = max(fW1.x + fW1.y, 2.0); return step(mod(c.x + fW0.w * c.y, per), fW1.x - 0.5); }
  if (K == 2 || K == 3) return step(mod(floor(c.x * 0.5) + c.y, 2.0), 0.5);
  return step(mod(c.x + c.y, 2.0), 0.5); }
// the woven face at qe (threads): height in warp spacings; wv 1 where the weft shows; c the cell; f its fraction
float f6woven(vec2 qe, out float wv, out vec2 c, out vec2 f){
  c = floor(qe); f = fract(qe);
  float t = f6top(c), tN = f6top(c + vec2(0.0, 1.0)), tS = f6top(c - vec2(0.0, 1.0)), tE = f6top(c + vec2(1.0, 0.0)), tW = f6top(c - vec2(1.0, 0.0));
  float sy = smoothstep(0.0, 1.0, abs(f.y - 0.5) * 2.0), sx = smoothstep(0.0, 1.0, abs(f.x - 0.5) * 2.0);
  float lw = mix(t, 0.5 * (t + (f.y > 0.5 ? tN : tS)), sy), lf = mix(1.0 - t, 1.0 - 0.5 * (t + (f.x > 0.5 ? tE : tW)), sx);
  float xw = (f.x - 0.5) / (0.5 * f6Y0.y), xf = (f.y - 0.5) / (0.5 * f6Y0.z);
  float hw = 0.32 * (lw - 0.5) + 0.25 * f6Y0.y * sqrt(max(0.0, 1.0 - xw * xw)) - step(1.0, abs(xw));
  float hf = 0.32 * (lf - 0.5) + 0.25 * f6Y0.z * sqrt(max(0.0, 1.0 - xf * xf)) - step(1.0, abs(xf));
  wv = smoothstep(-0.02, 0.02, hf - hw);
  return max(max(hw, hf), -0.32); }
float f6seg(vec2 p, vec2 a, vec2 b, out float s){ vec2 ab = b - a; s = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0); return length(p - a - ab * s); }
// THE FOLD WEAR (fabric7/wear7.js): the pale creased lines the body's own motion wears into the cloth, and the set creases they are the crests of. dd: the doubled angle of the compression the cloth takes (aF6w.zw: the postures' strain,
// vector-averaged over the day; its length R is the coherence), amount: how much work the cloth does there (aF6w.y). A line is the cascade's own kernel (a ridge A sech^2(u / w) across the compression, a Gaussian along the crease: the
// crease is a line of its own, so a field that turns bends the lines and no phase winds), a wavelength lamN apart (the cascade's finest, the sheet-on-a-foundation law's: 15 mm for a stretch denim); sparse, 6 a cell of 3 lambda, present
// with a probability that rises with the amount. TWO WIDTHS OF THE ONE CREASE (c6 it3): a worn line is the CREST of a crease the cloth has taken again and again and kept (cloth that is folded often does not come back all the way: the
// crease SET), so the same kernel gives (a) the pale cover, a few yarns wide (half-width 0.12 lamN: the ridge, where the dye is rubbed off) and (b) the crease's own relief, at the cascade's half-width (0.22 lamN), returned as a height
// GRADIENT gSet (peak slope = peakSlope): the line is lit on one flank and dark on the other like the creases the photographs show, and on a pale wash, where the colour barely moves, it reads by its shading. DIRECTION: the lines of a
// place lie across its mean compression; the postures that disagree (R < 1) spread the angle by the circular dispersion that R implies (a wrapped normal on the doubled angle: sigma = sqrt(-2 ln R), the line's half of it), but the offset
// is a smooth field (value noise, 5 lamN across), so neighbouring lines are near-parallel and the offset turns slowly: a FAN, not a brush; a per-line jitter of 0.05 rad only. At a distance (a pixel wider than the line) the lines give way to their mean cover and the relief to nothing.
float f6Lines(vec2 q, vec2 dd, float amount, float lamN, float seed, float pxm, float peakSlope, out vec2 gSet) {
  gSet = vec2(0.0);
  float coh = length(dd); if (amount < 0.03 || coh < 0.1 || lamN <= 0.0) return 0.0;
  float vis = 1.0 - smoothstep(0.3, 0.6, pxm * 3.0 / lamN), mean = 0.2 * amount * coh;
  if (vis <= 0.0) return mean;
  float th0 = 0.5 * atan(dd.y, dd.x), sgm = 0.5 * sqrt(-2.0 * log(min(coh, 0.999))), turn = (vn3(vec3(q / (5.0 * lamN), seed + 49.0)) - 0.5) * 3.4641 * sgm, th = th0 + clamp(turn, -1.0, 1.0);
  float w = 0.12 * lamN, wc = 0.22 * lamN, ell = 2.0 * lamN, Lc = 3.0 * lamN, pr = clamp(pow(amount, 0.8) * (0.4 + 0.6 * coh), 0.0, 1.0), s = 0.0; vec2 gs = vec2(0.0);
  vec2 i0 = floor(q / Lc);
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) {
    vec2 id = i0 + vec2(float(a), float(b));
    for (int k = 0; k < 6; k++) {
      float sd = seed + 41.0 + 1.7 * float(k);
      if (hh(vec3(id, sd)) > pr) continue;
      vec2 dq = q - (id + vec2(hh(vec3(id, sd + 2.0)), hh(vec3(id, sd + 4.0)))) * Lc;
      float ta = th + (hh(vec3(id, sd + 6.0)) - 0.5) * 0.1; vec2 e = vec2(cos(ta), sin(ta));
      float u = dot(dq, e), v = dot(dq, vec2(-e.y, e.x)), Su = u / w, Sc = u / wc;
      if (abs(Sc) > 5.0 || abs(v) > 2.2 * ell) continue;
      float r = 0.4 + 0.6 * hh(vec3(id, sd + 8.0)), G = exp(-(v * v) / (ell * ell));
      if (abs(Su) <= 5.0) { float eu = exp(-abs(Su)), eu2 = eu * eu; s += r * 4.0 * eu2 / ((1.0 + eu2) * (1.0 + eu2)) * G; }
      float ec = exp(-abs(Sc)), ec2 = ec * ec, hc = r * 4.0 * ec2 / ((1.0 + ec2) * (1.0 + ec2)) * G;                          // the set crease: unit-height sech^2 at the cascade's half-width
      gs += hc * (-2.0 * sign(Sc) * (1.0 - ec2) / (1.0 + ec2) / wc * e - 2.0 * v / (ell * ell) * vec2(-e.y, e.x)); } }
  gSet = gs * (peakSlope * wc / 0.77) * vis;                                                                                // the height 0.77 peak slope per unit amplitude: A = peakSlope wc / 0.77
  { float gm = 1.5 * max(peakSlope, 1e-4); gSet /= sqrt(1.0 + dot(gSet, gSet) / (gm * gm)); }                               // overlapping creases add their slopes: held below ~1.5 x one crease's peak, as the cascade's sum is
  return mix(mean, clamp(s, 0.0, 1.0), vis); }
// the knit face (jersey V loops; rib: odd wales are the purl columns, set back): height in wale spacings, the leg's direction
float f6knit(vec2 qe, out vec2 c, out vec2 tang, out float lane){
  c = floor(qe); vec2 f = fract(qe); float best = -0.36; tang = vec2(0.0, 1.0); lane = 0.0;
  bool back = int(f6Y0.x + 0.5) == 5 && mod(c.x, 2.0) > 0.5;
  for (int k = 0; k < 2; k++) { float dj = float(k); vec2 p = f + vec2(0.0, dj);
    for (int sd = 0; sd < 2; sd++) { vec2 a = vec2(0.5, 0.02), b = vec2(sd == 0 ? 0.08 : 0.92, 1.28); float s, d = f6seg(p, a, b, s);
      float w = 0.27 * f6Y0.y, x = d / w; if (x >= 1.0) continue;
      float h = 0.18 * sin(3.14159 * s) + 0.24 * sqrt(1.0 - x * x) - 0.14 * dj;
      if (back) h = h * 0.55 - 0.22;
      if (h > best) { best = h; tang = normalize(b - a); lane = (dot(p - a, vec2(-tang.y, tang.x)) / w) * 0.5 + 0.5 + float(sd) * 3.0 + dj * 7.0; } } }
  return best; }
`;
// the yarn layer: after c1's colour (col, the far-field average) and before its plaid; sets the colour, f6G (the yarn slope), the lobes
export const F6_YARN = `
#ifdef F6_ON
{ int K6 = int(f6Y0.x + 0.5); float aY = 0.0;
  bool stitchPart = false;
#ifdef F6_ATTR
  stitchPart = vF6e.x < -0.5 && vF6e.x > -1.5;
#endif
  if (K6 <= 5 && !stitchPart) {
    aY = fFade(max(fq.x, fq.y), 0.3, 0.75) * (1.0 - 0.75 * f6Y2.y);
    vec3 Nv = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0), Tw = vFabT; Tw = normalize(Tw - Nv * dot(Nv, Tw) + 1e-6); vec3 Tf = cross(Nv, Tw);
    float ctw = cos(f6Y0.w), stw = sin(f6Y0.w);
    vec3 TwF = normalize(Tw * ctw + Tf * stw), TfF = normalize(Tf * ctw - Tw * stw);
    gT2 = TfF; gW2 = fW1.z * (K6 >= 4 ? 0.0 : 1.0);
    if (aY > 0.001) {
      float e = 0.12, h0, hx, hy, wv = 0.0, lane = 0.0; vec2 c, f, tg = vec2(0.0, 1.0), c2, f2, tg2; float w2, l2;
      if (K6 <= 3) { h0 = f6woven(qe, wv, c, f); hx = f6woven(qe + vec2(e, 0.0), w2, c2, f2); hy = f6woven(qe + vec2(0.0, e), w2, c2, f2); }
      else { h0 = f6knit(qe, c, tg, lane); hx = f6knit(qe + vec2(e, 0.0), c2, tg2, l2); hy = f6knit(qe + vec2(0.0, e), c2, tg2, l2); }
      vec2 dh = vec2(hx - h0, hy - h0) / e;
      f6G = vec2(dh.x, dh.y * fW0.z / max(fW0.y, 1.0)) * aY * 0.75;
      f6Yarn = h0;
      // which yarn, its index, its colour: end-to-end tone, thick-thin slub along the warp, heather fibre lanes, twist striation
      bool weft = K6 <= 3 && wv > 0.5;
      float yi = K6 <= 3 ? (weft ? c.y : c.x) : c.y, along = K6 <= 3 ? (weft ? qe.x : qe.y) : qe.y, across = K6 <= 3 ? (weft ? f.y : f.x) : lane;
      float tone = 1.0 + (weft ? f6Y1.w : f6Y1.z) * 2.0 * (f6hash(vec2(yi, weft ? 3.0 : 1.0), cSeed) - 0.5);
      float sl = f6vn(yi, along * 0.06, cSeed + (weft ? 5.0 : 2.0)); f6High = sl;
      tone *= 1.0 + f6Y1.y * (0.5 - sl) * 0.9;                                       // a thick place is ring-dyed deeper: darker (indigo); it wears first
      vec3 yc = K6 <= 3 && weft ? (WK <= 2 ? fWeft : cA) : cA;
      yc *= tone;
      float fib = K6 >= 4 ? f6hash(vec2(floor(across * 7.0) + c.x * 13.0, yi * 5.0 + floor(across * 0.5)), cSeed + 9.0)   // a knit: a course is one yarn, its fibres change from loop to loop
                          : f6hash(vec2(floor(across * 7.0 + yi * 7.3), floor(along * 0.35 + across * 3.1)), cSeed + 9.0);
      yc = mix(yc, f6H, step(fib, f6Y2.x));                                            // heather: undyed fibre lanes in the yarn
      float tw = K6 >= 4 ? 0.0 : sin(6.2832 * (along * 2.2 + across * 2.2 * tan(f6Y0.w))) * fFade(max(fq.x, fq.y) * 3.0, 0.3, 0.7);
      float ao = mix(0.5, 1.0, smoothstep(-0.3, 0.22, h0));
      float hair = (hh(vec3(floor(qe * 9.0), cSeed + 2.0)) - 0.5) * f6Y1.x * 0.25;
      vec3 det = yc * ao * (1.0 + 0.06 * tw + hair) / f6AO;
      // the detail's own average equals c1's far colour only roughly: keep the far colour's level, take the detail's structure
      vec3 mean = mix(K6 <= 3 ? mix(cA, WK <= 2 ? fWeft : cA, f6M) : cA, f6H, f6Y2.x);
      col = mix(col, col * det / max(mean, vec3(1e-4)), aY);
      pRough = clamp(mix(pRough, pRough + 0.08 * (0.2 - h0) + 0.04 * hair, aY), 0.25, 1.0);
      // the lobes: the visible yarn's fibres near; the two thread systems by their face shares far
      vec3 Ty = K6 <= 3 ? (weft ? TfF : TwF) : normalize(tg.x / max(fW0.y, 1.0) * Tf + tg.y / max(fW0.z, 1.0) * Tw);
      gT = normalize(mix(gT, Ty, aY)); gW2 = mix(gW2, 0.0, aY);
      gRelief *= 1.0 - aY;
    }
  }
}
#endif
`;
// after fabFold (which scales the fold slope by cFoldK): the yarn slope, the strain wrinkles
export const F6_WRINKLE = `
#ifdef F6_ON
  gFoldG += f6G;
#ifdef F6_ATTR
  { vec2 wd = vF6s.xy * 0.001; float wa = length(wd), lam = max(f6Y2.z, 0.003), k = 6.2832 / lam, vis = fFade(pxm * 3.0 / lam, 0.3, 0.6);
#ifdef F6_CASCADE
    // THE RIDGE CASCADE (cascade6 in fabric6.js). The excess length the strain field found (eps, from the finest wrinkle's amplitude: A = lambda / pi sqrt(eps)) is shared among octaves lambda_n = lambda R^n up to the
    // fold wavelength 2.8 c, in proportion to lambda_n^p (the bending energy of an absorbed length falls as 1 / lambda^2). Each octave absorbs its share as a field of CREASES, not waves: a compressed sheet far above its
    // buckling strain does not undulate, it folds along lines across the compression (tension-field wrinkling), each crease a ridge or a furrow of profile A sech^2(u / w) (a rounded crest, exponential flanks, flat
    // panels between), as long as several wavelengths (a Gaussian taper: the crease ends), laid across the compression direction of the pixel, so a direction that turns bends the creases and no phase is wound
    // (sparse-kernel noise: a few creases from each of the 3 x 3 cells round the pixel, at random places, signs and strengths). The amplitude is fixed by CONSERVATION OF THE EXCESS LENGTH: the creases' slope energy
    // along the compression, summed over the area, is 2 eps_n (a sinusoid's is (A k)^2 / 2 = the same law); sparse tall creases and dense small ones take up the same length. Where eps falls (a taut zone) the creases
    // fade out with it. RW, RL, SP: the crease half-width, the crease length and the mean spacing, each in the octave's own wavelength (the model's three constants, no fabric has its own).
    if (wa > 1e-6 && f6Y2.w > 0.0) {
      const float RW = 0.22, RL = 1.6, SP = 1.0; const int KI = 3;
      float th = 0.5 * atan(wd.y, wd.x), eps = pow(3.14159265 * wa / lam, 2.0), ssum = 0.0, aTop = 0.0, hW = 0.0; int nO = int(f6Wc.x + 0.5); vec2 gW = vec2(0.0);
      for (int n = 0; n < 4; n++) if (n < nO) ssum += pow(f6Wc.y, f6Wc.z * float(n));
      int nD = nO - int(f6Wg + 0.5);                                                                                  // the octaves the mesh itself carries (fold7.js) are not drawn again
      for (int n = 0; n < 4; n++) {
        if (n >= nD) break;
        float fn = float(n), lamN = lam * pow(f6Wc.y, fn), visN = fFade(pxm * 3.0 / lamN, 0.3, 0.6);
        if (visN <= 0.0) continue;
        float epsN = eps * pow(f6Wc.y, f6Wc.z * fn) / ssum, w = RW * lamN, ell = RL * lamN, Lc = 2.0 * ell;
        float pr = min(1.0, Lc * Lc / (SP * lamN * 1.7725 * ell * float(KI))), dEff = float(KI) * pr / (Lc * Lc);        // the presence of a crease in a cell, and the creases a square metre then holds
        float A0 = min(sqrt(2.0 * epsN * w / (dEff * 1.0667 * ell * 1.2533)), 2.4 * f6Y2.w * w / 0.77);               // slope energy 2 eps_n; no crease steeper than the slope cap (peak slope 0.77 A / w)
        aTop = max(aTop, A0 * visN);
        vec2 i0 = floor(q / Lc);
        for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) {
          vec2 id = i0 + vec2(float(a), float(b));
          for (int k = 0; k < KI; k++) {
            float sd = cSeed + 21.0 + 7.0 * fn + 1.7 * float(k);
            if (hh(vec3(id, sd)) > pr) continue;
            vec2 dq = q - (id + vec2(hh(vec3(id, sd + 2.0)), hh(vec3(id, sd + 4.0)))) * Lc;
            float ta = th + (hh(vec3(id, sd + 6.0)) - 0.5) * 0.4; vec2 e = vec2(cos(ta), sin(ta));
            float u = dot(dq, e), v = dot(dq, vec2(-e.y, e.x)), Su = u / w;
            if (abs(Su) > 5.0 || abs(v) > 2.2 * ell) continue;
            float r5 = hh(vec3(id, sd + 8.0)), eu = exp(-abs(Su)), eu2 = eu * eu;
            float hk = A0 * visN * (0.3 + 1.7 * r5 * r5 * r5) * 1.1486 * (hh(vec3(id, sd + 10.0)) < 0.5 ? -1.0 : 1.0) * exp(-(v * v) / (ell * ell)) * 4.0 * eu2 / ((1.0 + eu2) * (1.0 + eu2));
            float du = -2.0 * hk * sign(Su) * (1.0 - eu2) / (1.0 + eu2) / w, dv = -2.0 * v / (ell * ell) * hk;
            hW += hk; gW += du * e + dv * vec2(-e.y, e.x); } } }
      float gl = length(gW), gmax = 2.4 * f6Y2.w + 0.05; gW *= 1.0 / sqrt(1.0 + gl * gl / (gmax * gmax));               // the summed slope held below ~25 deg
      gFoldG += gW; f6Crease = clamp(hW / max(aTop, 1e-6), -1.0, 1.0) * smoothstep(0.0002, 0.0012, aTop); }
#else
    if (wa > 1e-6 && vis > 0.0 && f6Y2.w > 0.0) {
      // short wrinkles across the compression, anchored cell by cell (cells 2.5 wavelengths across, each its own phase, strength and a
      // slight turn, blended bilinearly): the phase is taken from the cell's own centre, so a direction that turns over the garment
      // does not wind the phase into contour lines (a phase from the pattern origin, k * dot(q, e(q)), drew wood grain)
      float th = 0.5 * atan(wd.y, wd.x), Lc = 2.5 * lam, A0 = min(wa * 0.6, f6Y2.w * lam / 6.2832 * 1.2) * vis;
      vec2 gq = q / Lc - 0.5, i0 = floor(gq), fr = fract(gq), sw = fr * fr * (3.0 - 2.0 * fr); float hW = 0.0; vec2 gW = vec2(0.0);
      for (int a = 0; a < 2; a++) for (int b = 0; b < 2; b++) { vec2 id = i0 + vec2(float(a), float(b)), cc = (id + 0.5) * Lc;
        float w = (a == 1 ? sw.x : 1.0 - sw.x) * (b == 1 ? sw.y : 1.0 - sw.y), r1 = hh(vec3(id, cSeed + 21.0)), r2 = hh(vec3(id, cSeed + 23.0)), r3 = hh(vec3(id, cSeed + 25.0));
        float ta = th + (r3 - 0.5) * 0.5; vec2 e = vec2(cos(ta), sin(ta)); float ph = k * dot(q - cc, e) + 6.2832 * r1, Ai = A0 * (0.15 + 1.3 * r2 * r2) * w;   // patchy: most cells weak, a few strong
        hW += Ai * sin(ph); gW += Ai * cos(ph) * k * e; }
      gFoldG += gW; f6Crease = clamp(hW / max(A0, 1e-6), -1.0, 1.0) * smoothstep(0.0002, 0.0012, A0); }
#endif
    gFine *= 1.0 - smoothstep(0.0, 0.03, vF6s.z);
    // the construction's per-vertex fields as material-space gradients and per-pixel widths (here: uniform control flow)
    vec2 jx = dFdx(q), jy = dFdy(q); float jd = jx.x * jy.y - jx.y * jy.x;
    vec4 dX = dFdx(vF6e), dY = dFdy(vF6e);
    if (abs(jd) > 1e-14) { f6Gs = vec2(jy.y * dX.x - jx.y * dY.x, -jy.x * dX.x + jx.x * dY.x) / jd; f6Ga = vec2(jy.y * dX.y - jx.y * dY.y, -jy.x * dX.y + jx.x * dY.y) / jd;
      f6Gh = vec2(jy.y * dX.z - jx.y * dY.z, -jy.x * dX.z + jx.x * dY.z) / jd; f6Gha = vec2(jy.y * dX.w - jx.y * dY.w, -jy.x * dX.w + jx.x * dY.w) / jd; }
    if (dot(f6Gs, f6Gs) > 4.0) f6Gs = vec2(0.0); if (dot(f6Ga, f6Ga) > 4.0) f6Ga = vec2(0.0); if (dot(f6Gh, f6Gh) > 4.0) f6Gh = vec2(0.0); if (dot(f6Gha, f6Gha) > 4.0) f6Gha = vec2(0.0);
    f6Fw = abs(dX) + abs(dY); }
#endif
#endif
`;
export const F6_CREST = `
#if defined(F6_ON) && defined(F6_ATTR)
  crest = clamp(0.8 * vF6s.w + 0.3 * crest + 0.5 * f6Crease, -1.0, 1.0);
#endif
`;
// construction (replaces c1's seam stitch line in the wear block): seam well, ridge, pucker, topstitch rows, hems, stitch ribbons
export const F6_CONSTRUCT = `
#if defined(F6_ON) && defined(F6_ATTR)
  if (f6A.w > 0.5) {
    if (vF6e.x >= 0.0) {
      float sd = vF6e.x, sa = vF6e.y, hd = vF6e.z, ha = vF6e.w, fp = pxm;
      vec2 gs = f6Gs, ga = f6Ga, gh = f6Gh, gha = f6Gha;
      float thk = max(f6Thk, 0.0003), kn = int(f6Y0.x + 0.5) >= 4 ? 1.0 : 0.0;
      // the seam: a well where the panels meet, the allowance pressed under as a soft ridge, puckering along it
      float wellW = 0.0007 + thk * 0.6, well = exp(-sd * sd / (wellW * wellW));
      float hS = -thk * 0.9 * well + thk * 0.55 * smoothstep(0.0008, 0.003, sd) * (1.0 - smoothstep(0.006, 0.011, sd));
      float pkA = thk * (0.18 + 0.22 * kn) * smoothstep(0.25, 0.75, vn3(vec3(sa * 28.0, 3.0, cSeed + 7.0))), pkL = 0.011 + 0.006 * kn;
      float pk = sin(sa * 6.2832 / pkL + 5.0 * vn3(vec3(sa * 60.0, 0.0, cSeed))) * exp(-sd / (0.005 + 0.004 * kn)) * pkA;
      float dhd_s = -thk * 0.9 * well * (-2.0 * sd / (wellW * wellW)) + thk * 0.55 * (smoothstep(0.0008, 0.003, sd + 0.0002) - smoothstep(0.0008, 0.003, sd)) / 0.0002 * (1.0 - smoothstep(0.006, 0.011, sd));
      float dpk_a = cos(sa * 6.2832 / pkL + 5.0 * vn3(vec3(sa * 60.0, 0.0, cSeed))) * 6.2832 / pkL * exp(-sd / (0.005 + 0.004 * kn)) * pkA;
      vec2 gS = dhd_s * gs + dpk_a * ga;
      col *= 1.0 - 0.35 * well * fFade(fp / wellW, 0.6, 2.0);
      // the hem: the turned edge rolls over, the raw edge under makes a ridge at the hem's depth
      float R = thk * 2.2, dep = f6S.w;
      float roll = hd < R ? (1.0 - hd / R) : 0.0, hH = -R * roll * roll, dHr = hd < R ? 2.0 * R * roll / R : 0.0;
      float rdg = dep > 0.0 ? smoothstep(dep + 0.0012, dep - 0.0012, hd) : 0.0, dRg = dep > 0.0 ? (smoothstep(dep + 0.0012, dep - 0.0012, hd + 0.0002) - rdg) / 0.0002 : 0.0;
      vec2 gH = (dHr + thk * 0.6 * dRg) * gh;
      gFoldG += (gS + gH) * fFade(fp / 0.004, 0.5, 1.5);
      col *= 1.0 + 0.1 * roll * fFade(fp / R, 0.6, 2.0);
      // stitches: rows of thread along the seam (both sides of it) and along the hem, as dashes with the needle holes between
      float st = 0.0, sth = 0.0; vec2 gT3 = vec2(0.0);
      float L = max(f6S.z, 0.002), tw = 0.00042;
      for (int r = 0; r < 2; r++) { float off = r == 0 ? f6S.x : f6S.y; if (off <= 0.0) continue;
        float d = abs(sd - off), cov = 1.0 - smoothstep(tw - 0.5 * f6Fw.x, tw + 0.5 * f6Fw.x, d);
        float dash = fPulse(sa / L, 0.84, f6Fw.y / L); st = max(st, cov * dash); sth = max(sth, cov * (1.0 - dash)); gT3 = ga; }
      if (dep > 0.0 && f6A.z > 0.5) for (int r = 0; r < 2; r++) { if (r == 1 && f6A.z < 1.5) continue; float off = dep - 0.004 - float(r) * 0.0065;
        float d = abs(hd - off), cov = 1.0 - smoothstep(tw - 0.5 * f6Fw.z, tw + 0.5 * f6Fw.z, d);
        float dash = fPulse(ha / L, 0.84, f6Fw.w / L); if (cov * dash > st) gT3 = gha; st = max(st, cov * dash); sth = max(sth, cov * (1.0 - dash)); }
      float ply = 0.85 + 0.15 * sin(6.2832 * (sa + ha) / 0.0007) * fFade(fp / 0.0007, 0.5, 1.0);
      col = mix(col, f6T * ply, st * 0.92); col *= 1.0 - 0.45 * sth * fFade(fp / 0.0006, 0.6, 1.5);
      pRough = mix(pRough, 0.62, st * 0.6); gNap *= 1.0 - 0.6 * st;
    } else if (vF6e.x > -1.5) {                                        // a stitch ribbon (K4's trim): stitches along it
      float L = max(f6S.z, 0.002), sa = vF6e.y, dash = fPulse(sa / L, 0.84, f6Fw.y / L);
      float ply = 0.82 + 0.18 * sin(6.2832 * (sa / 0.0008 + vF6e.z * 0.7));
      float cap = 1.0 - 0.35 * pow(abs(fract(sa / L) * 2.0 - 1.0), 6.0);   // each stitch a capsule: darker where it dives
      col *= mix(0.42, ply * cap, dash); pRough = 0.62;
    }
  }
#endif
`;
// wear by age (after c1's per-fibre wear, before its soil): the masks from the body and the pattern
export const F6_WEAR = `
#if defined(F6_ON) && defined(F6_ATTR)
  if (f6A.x > 0.001 && abs(vF6e.x + 1.0) > 0.5) {
    float age = f6A.x; int FB6 = int(f6A.y + 0.5);
    float zT = vF6w.x, zF = vF6w.y; vec2 zD = vF6w.zw;                                                // wear7.js: the abrasion and the fold wear the body's own motion works into this cloth, and the direction the cloth folds
    bool gar = vF6e.x >= 0.0;
    float seamW = gar ? smoothstep(0.0, 0.002, vF6e.x) * (1.0 - smoothstep(0.004, 0.009, vF6e.x)) : 0.0;
    float hemW = gar && f6S.w > 0.0 ? exp(-vF6e.z / 0.0035) + 0.6 * exp(-pow((vF6e.z - f6S.w) / 0.0015, 2.0)) : 0.0;
    float crestW = smoothstep(0.3, 0.95, crest), gr6 = vn3(vec3(q * 700.0, cSeed + 3.0)), gr7 = vn3(vec3(q * 90.0, cSeed + 8.0));
    float hi = smoothstep(0.35, 0.8, f6High) * 0.8 + 0.4;              // the thick places of the yarn take the wear first
    float setK = FB6 == 3 ? 0.15 : FB6 == 4 ? 0.1 : 0.5;             // how much of a worked crease the cloth keeps once the load is off (crease recovery: a cotton or denim twill holds it, a knit mostly springs back, wool nearly all)
    vec2 gSet; float fl = f6Lines(q, zD, zF, f6Y2.z, cSeed, pxm, 2.4 * f6Y2.w * setK * zF * f6Sk, gSet);       // the creased lines: sparse ridges across the compression, a wavelength apart (the finest wrinkle's), and the relief of the creases they are the crest of
    gFoldG += gSet;
    float ab = clamp(1.1 * zT + 0.6 * fl + 0.9 * seamW + 0.9 * hemW + 0.55 * crestW, 0.0, 1.6) * age;
    vec3 c0 = col; float l0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
    if (FB6 == 1) {                                                     // indigo: the white core shows through
      // the creased lines (fl: wear7.js's postures, the cascade's kernels across the compression) wear pale on their ridges: whiskers fan from where the hip folds, honeycombs stack behind the knee because that is where the cloth is worked
      float rope = hemW * smoothstep(0.5, 0.85, sin((q.x + q.y) * 6.2832 / 0.016 + gr7 * 2.0) * 0.5 + 0.5);   // roping: the hem's twist worn on its high side
      float stk = 0.6 + 0.8 * (vn3(vec3(q.x * 900.0, q.y * 25.0, cSeed + 12.0)) - 0.2);                       // indigo wears in streaks along the warp
      float wa = clamp(0.45 * ab * hi * stk * (0.7 + 0.6 * gr6) + age * (0.9 * fl * (0.55 + 0.45 * gr6) + 0.4 * rope), 0.0, 0.6);
      // mixed in a perceptual (square-root) space: a dark indigo next to its near-white core would otherwise jump several times in
      // brightness at a few per cent of bared core; the cast colour stays the garment's colour, the wear is where it wears
      vec3 cs = sqrt(max(col, vec3(0.0))), ks = sqrt(fCore * (0.82 + 0.25 * gr6));
      cs = mix(cs, ks, wa); cs = mix(cs, ks, 0.05 * age); col = cs * cs;
      pRough = min(1.0, pRough + 0.05 * wa); gNap *= 1.0 + 0.6 * wa;
    } else if (FB6 == 3) {                                              // knits: fade with washing, pills where they rub
      col = mix(col, mix(vec3(l0), col, 0.82) * 1.1 + 0.006, age * 0.55);
      col = mix(col, col * 1.18 + 0.01, clamp(0.45 * ab, 0.0, 0.6));
      float pm = clamp((1.1 * zT + 0.3 * fl + 0.5 * seamW + 0.05) * age * 1.4, 0.0, 1.0);
      float pl = smoothstep(0.72, 0.9, vn3(vec3(q * 1400.0, cSeed + 6.0))) * pm * fFade(pxm / 0.0012, 0.6, 1.4);
      col = mix(col, col * 1.22 + 0.012, pl * 0.7); pRough = min(1.0, pRough + 0.12 * pl); gNap *= 1.0 + 1.2 * pm;
    } else if (FB6 == 4) {                                              // wool: rubbed smooth and shiny where it wears, a little pilling
      float sh = clamp((1.2 * zT) * age * 1.6, 0.0, 0.8);
      pRough = mix(pRough, 0.55, sh); gNap *= 1.0 - 0.6 * sh; col *= 1.0 - 0.06 * sh;
      float pl = smoothstep(0.76, 0.92, vn3(vec3(q * 1100.0, cSeed + 6.0))) * age * 0.6 * fFade(pxm / 0.0012, 0.6, 1.4);
      col = mix(col, col * 1.15 + 0.01, pl);
    } else {                                                            // cotton twill, canvas, poplin: pale at the edges and crests
      float wa = clamp(ab * (0.6 + 0.6 * gr6) * hi, 0.0, 0.9);
      col = mix(col, mix(vec3(l0), col, 0.7) * 1.45 + 0.02, wa * 0.55);
      col = mix(col, mix(vec3(l0), col, 0.85) * 1.08 + 0.004, age * 0.5);
      pRough = min(1.0, pRough + 0.06 * wa); gNap *= 1.0 + 0.8 * wa;
    }
  }
#endif
`;
// two fibre lobes (the warp's and the weft's), replacing c1's one
const LOBE5 = 'reflectedLight.directSpecular += directLight.color * gAniC * gAni * 0.12 * pow(kk, fShn.z) * smoothstep(0.0, 0.3, dotNL); }';
const LOBE6 = `reflectedLight.directSpecular += directLight.color * gAniC * gAni * 0.12 * pow(kk, fShn.z) * smoothstep(0.0, 0.3, dotNL) * (1.0 - gW2);
#ifdef F6_ON
    { vec3 T2 = normalize(gT2 - geometryNormal * dot(geometryNormal, gT2) + 1e-6); float t2l = dot(T2, directLight.direction), t2v = dot(T2, geometryViewDir);
      float k2 = max(0.0, sqrt(max(0.0, 1.0 - t2l * t2l) * max(0.0, 1.0 - t2v * t2v)) - t2l * t2v);
      reflectedLight.directSpecular += directLight.color * gAniC * gAni * 0.12 * pow(k2, fShn.z) * smoothstep(0.0, 0.3, dotNL) * gW2; }
#endif
  }`;
const ANCHOR = {
  pars: 'vec3 gDbg = vec3(0.0);',
  fold: 'crest = clamp(vFold + 0.4 * crest, -1.0, 1.0);\n#endif',
  wrinkle: '  float crest = fabFold(b, reg, along, vHero.z, vBN, q, pxm, PT);',
  seam: '    col = mix(col, fSeam.rgb, sk * stitch * 0.8);',
  soil: '    // soil: a layer with its own colour.',
};
// the rev-6 program from fabric_glsl's (sh: three's shader object after fabricMaterial's own onBeforeCompile)
export function patch6(sh) {
  let fs = sh.fragmentShader, vs = sh.vertexShader;
  for (const [k, a] of Object.entries(ANCHOR)) if (!fs.includes(a)) throw new Error(`fabric6: anchor '${k}' not found (fabric_glsl.js changed)`);
  if (!fs.includes(LOBE5)) throw new Error('fabric6: the fibre lobe line changed (fabric_glsl.js FAB_DIRECT)');
  fs = fs.replace(ANCHOR.pars, ANCHOR.pars + F6_PARS)
    .replace(ANCHOR.wrinkle, F6_YARN + ANCHOR.wrinkle + F6_WRINKLE)
    .replace(ANCHOR.fold, ANCHOR.fold + F6_CREST)
    .replace(ANCHOR.seam, `#if defined(F6_ON) && defined(F6_ATTR)\n  if (f6A.w < 0.5) ${ANCHOR.seam.trim()}\n#else\n${ANCHOR.seam}\n#endif\n` + F6_CONSTRUCT)
    .replace(ANCHOR.soil, F6_WEAR + ANCHOR.soil)
    .replace(LOBE5, LOBE6);
  vs = vs.replace('void main() {', '#ifdef F6_ATTR\nattribute vec4 aF6s, aF6w, aF6e; varying vec4 vF6s, vF6w, vF6e;\n#endif\nvoid main() {')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef F6_ATTR\nvF6s = aF6s; vF6w = aF6w; vF6e = aF6e;\n#endif\n');
  sh.fragmentShader = fs; sh.vertexShader = vs;
}

// ---------------------------------------------------------------- the hook (fabric_glsl.js fabricMaterial calls it when set)
function hook6(mat, info) {
  if (!info.defines?.FAB_UVQ) return;                                  // hero.js's c6 / c7 cloth (bind-space cuts): rev 5 as is
  const L = look6(info.fabric); if (!L) return;                        // leather, felt, mesh: rev 5
  const U = mat.uniforms_c6, dye = mat.color.clone();
  Object.assign(U, uniforms6(info.fabric, dye, L));
  U.fRgh.value.w = L.sheen6[0]; mat.sheen = L.sheen6[0]; mat.sheenRoughness = L.sheen6[1];
  const casc = U.f6Wc.value.x > 1.5;                                   // the wrinkle cascade, where this fabric has octaves to climb (cascade6)
  mat.defines = { ...(mat.defines || {}), F6_ON: 1, F6_ATTR: 1, ...(casc ? { F6_CASCADE: 1 } : {}) };
  const prev = mat.onBeforeCompile, key = mat.customProgramCacheKey();
  mat.onBeforeCompile = (sh, r) => { prev(sh, r); Object.assign(sh.uniforms, U); patch6(sh); };
  mat.customProgramCacheKey = () => key + '-f6' + (casc ? 'c' : '');
  mat.onBeforeRender = (renderer, scene, camera, geometry, object) => { if (!geometry.attributes.aF6e) fabric6Attributes(object, geometry, info.fabric); const g = object?.userData?.fold7?.nG || 0; if (U.f6Wg.value !== g) { U.f6Wg.value = g; mat.uniformsNeedUpdate = true; } };
  mat.userData.fabric6 = { fabric: info.fabric, kind: L.kind, age: U.f6A.value.x };
  if (EXT7) EXT7(mat, info, L);                                        // FABRIC7 (round 7, opt-in): rev 7 rides on this program (null by default: nothing runs)
}
// FABRIC7 (round 7): fabric7/index.js registers its extension here when a page calls useFabric7(); hook6 then hands it every rev-6 fabric material
// it has just made. Null (the default): hook6 is exactly as before.
let EXT7 = null;
export function setFabric7Ext(fn) { EXT7 = typeof fn === 'function' ? fn : null; }
// the per-vertex data now (else each mesh computes it on its first draw, which then draws without it once): call after makePerson
export function prepareFabric6(root) {
  const out = { meshes: 0, ms: 0 }, t0 = (globalThis.performance || Date).now();
  root.updateMatrixWorld(true);
  root.traverse(m => { if (m.isMesh && m.material?.userData?.fabric6 && !m.geometry.attributes.aF6e) { fabric6Attributes(m, m.geometry, m.material.userData.fabric6.fabric); out.meshes++; } });
  if (WEAR7R) { try { out.wearRiders = WEAR7R(root); } catch (e) { out.wearRiders = 'failed: ' + (e.message || e); } }   // pockets, plackets and rivets take the wear of the cloth they are cut from
  if (FOLD7) out.fold7 = FOLD7(root);   // FABRIC7 (opt-in): the creases the mesh can carry become geometry (fold7.js); the strain attributes above are the excess BEFORE it
  if (FUZZ6 > 0 && typeof document !== 'undefined') out.fuzz = fuzz6(root, { layers: FUZZ6 });   // FABRIC7: the engine's fibre shells (a WebGL device: a node export and the atlas bake build none; Cycles carries the fuzz in its sheen), on the final geometry
  out.ms = Math.round((globalThis.performance || Date).now() - t0); return out;
}
// FABRIC7's geometry stage: fabric7/index.js registers fold7 here when a page calls useFabric7({ fold: 1 }); null (the default): prepareFabric6 is exactly as before
let FOLD7 = null;
// FABRIC7's fuzz shells: the number of layers prepareFabric6 draws on every fuzzy fabric's mesh (fabric7/index.js sets it from the render tier; 0: none)
let FUZZ6 = 0;
export function setFuzz6(layers) { FUZZ6 = Math.max(0, layers | 0); }
export function setFold7(fn) { FOLD7 = typeof fn === 'function' ? fn : null; }
// FABRIC7's wear from the body's motion (fabric7/wear7.js): registered by useFabric7; null: no wear field (the shader then draws only the seams', hems' and crests' wear)
let WEAR7 = null, WEAR7R = null;
export function setWear7(fn, riders) { WEAR7 = typeof fn === 'function' ? fn : null; WEAR7R = typeof riders === 'function' ? riders : null; }
// the fold crest (aF6s.w: the umbrella-operator curvature x the bending length) again, after a mesh's positions and normals changed (fold7.js)
export function refreshCrest6(obj) {
  const g = obj.geometry, S = g.attributes.aF6s; if (!S) return false;
  const I = g.index ? g.index.array : Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i), sc = new THREE.Vector3().setFromMatrixScale(obj.isSkinnedMesh ? obj.bindMatrix : (obj.matrixWorld || new THREE.Matrix4())).x || 1;
  crestField(g.attributes.position.array, g.attributes.normal?.array, I, g.attributes.position.count, phys(FABRICS[obj.material.userData.fabric6.fabric] ? obj.material.userData.fabric6.fabric : 'twillPC').c / sc, S.array); S.needsUpdate = true; return true;
}

// ---------------------------------------------------------------- per-vertex data
// aF6s: (wrinkle amplitude mm x cos 2theta, x sin 2theta, stretch - 1, fold crest); aF6w: (knee front + seat, back of the knee,
// elbow, lap); aF6e: garment (seam distance m, seam arc m, free-edge distance m, free-edge arc m) | stitch ribbon (-1, arc, across, 0)
// | other construction (-2, 0, 0, 0)
export const F6_REPORT = [];
export function fabric6Attributes(obj, g, fabric) {
  const n = g.attributes.position.count, P = g.attributes.position.array, N = g.attributes.normal?.array, UV = g.attributes.uv?.array, R = g.attributes.aRest?.array;
  const I = g.index ? g.index.array : Uint32Array.from({ length: n }, (_, i) => i);
  const S = new Float32Array(n * 4), W = new Float32Array(n * 4), E = new Float32Array(n * 4);
  const k3 = obj?.userData?.k3 || {}, L = look6(fabric) || LOOKS6.chino, rep = { name: k3.name || obj?.name || '', fabric, n };
  const bm = obj?.isSkinnedMesh ? obj.bindMatrix : (obj?.matrixWorld || new THREE.Matrix4());
  const sc = new THREE.Vector3().setFromMatrixScale(bm).x || 1;
  const gar = k3.group ? k3.group === 'garment' : !!(UV && R);
  if (gar && UV && R) {
    const Rw = OPTS.cascade ? new Float32Array(n * 2) : null; strainField(P, UV, I, n, sc, L, S, rep, fabric, Rw); if (Rw) g.userData.f6raw = Rw; crestField(P, N, I, n, phys(FABRICS[fabric] ? fabric : 'twillPC').c / sc, S);
    edgeFrame(P, UV, R, I, n, sc, E, rep);
  } else if (k3.construction === 'stitch' && n % 4 === 0) {
    let arc = 0, pc = null; for (let i = 0; i < n / 4; i++) { const c = [0, 1, 2].map(k => (P[i * 12 + k] + P[i * 12 + 3 + k] + P[i * 12 + 6 + k] + P[i * 12 + 9 + k]) / 4 * sc);
      if (pc) arc += Math.hypot(c[0] - pc[0], c[1] - pc[1], c[2] - pc[2]); pc = c; for (let j = 0; j < 4; j++) E.set([-1, arc, (j - 1.5) / 1.5, 0], (i * 4 + j) * 4); }
    rep.stitch = +arc.toFixed(3);
  } else for (let i = 0; i < n; i++) E[i * 4] = -2;
  if (gar && UV && R && obj?.isSkinnedMesh && obj.skeleton && WEAR7) { try { WEAR7(obj, g, P, UV, I, n, sc, W, rep); } catch (e) { rep.wear7 = 'failed: ' + (e.message || e); } }   // the body's own motion, run on this garment (wear7.js); no hand-placed zones
  g.setAttribute('aF6s', new THREE.BufferAttribute(S, 4)); g.setAttribute('aF6w', new THREE.BufferAttribute(W, 4)); g.setAttribute('aF6e', new THREE.BufferAttribute(E, 4));
  F6_REPORT.push(rep); return rep;
}
// the deformation gradient of each triangle from the flat pattern (uv, m) to the bind shape (m), its right Cauchy-Green tensor averaged at the vertices (by pattern area): eig(v) = its eigen-decomposition
// (lo, hi: the squares of the principal stretches); norm the median stretch when the garment was cut or solved at another scale (> 8 % off 1), else 1; med the median stretch
export function tensorField(P, UV, I, n, sc) {
  const C = new Float64Array(n * 4), stretches = [];
  for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2];
    const du1 = UV[b * 2] - UV[a * 2], dv1 = UV[b * 2 + 1] - UV[a * 2 + 1], du2 = UV[c * 2] - UV[a * 2], dv2 = UV[c * 2 + 1] - UV[a * 2 + 1], det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-10) continue;
    const e1 = [0, 1, 2].map(k => (P[b * 3 + k] - P[a * 3 + k]) * sc), e2 = [0, 1, 2].map(k => (P[c * 3 + k] - P[a * 3 + k]) * sc);
    const Fu = e1.map((x, k) => (dv2 * x - dv1 * e2[k]) / det), Fv = e1.map((x, k) => (-du2 * x + du1 * e2[k]) / det);
    const c11 = Fu[0] ** 2 + Fu[1] ** 2 + Fu[2] ** 2, c12 = Fu[0] * Fv[0] + Fu[1] * Fv[1] + Fu[2] * Fv[2], c22 = Fv[0] ** 2 + Fv[1] ** 2 + Fv[2] ** 2, w = Math.abs(det);
    for (const v of [a, b, c]) { C[v * 4] += c11 * w; C[v * 4 + 1] += c12 * w; C[v * 4 + 2] += c22 * w; C[v * 4 + 3] += w; } }
  const eig = v => { const w = C[v * 4 + 3]; if (!w) return null; const a = C[v * 4] / w, b = C[v * 4 + 1] / w, d = C[v * 4 + 2] / w, tr = (a + d) / 2, q = Math.sqrt(((a - d) / 2) ** 2 + b * b); return { lo: tr - q, hi: tr + q, a, b, d }; };
  for (let v = 0; v < n; v++) { const e = eig(v); if (e) stretches.push(Math.sqrt(Math.max(0, (e.lo + e.hi) / 2))); }
  stretches.sort((x, y) => x - y); const med = stretches.length ? stretches[stretches.length >> 1] : 1, norm = Math.abs(med - 1) > 0.08 ? med : 1;
  return { eig, norm, med };
}
// the raw excess length of each vertex (the shortfall of the smaller principal stretch against the flat pattern, less the solve's own 1.2 % slack): what the garment's mesh says it carries as compression.
// The conservation check of fold7.js reads it before and after the geometry took its share.
export function excess6(P, UV, I, n, sc) {
  const { eig, norm } = tensorField(P, UV, I, n, sc), out = new Float32Array(n);
  for (let v = 0; v < n; v++) { const e = eig(v); if (e) out[v] = Math.max(0, 1 - Math.sqrt(Math.max(0, e.lo)) / norm - 0.012); }
  return out;
}
// strain: the deformation gradient of each triangle from the flat pattern (uv, m) to the bind shape (m), its right Cauchy-Green tensor
// averaged at the vertices (by pattern area), the principal stretches: the smaller one's shortfall is what buckles into wrinkles
// Rw (optional): the same compression vector WITHOUT the fabric's slope cap, in the same doubled-angle form and smoothed by the same passes: what the solved cloth really lacks of its pattern's length. The shader's cascade
// is held by the cap (fine wrinkles are shallow); the geometry of fold7.js is not (a sleeve 15 % shorter than its cut folds as deep as it must).
function strainField(P, UV, I, n, sc, L, S, rep, fabric, Rw) {
  const { eig, norm, med } = tensorField(P, UV, I, n, sc);
  rep.stretchMedian = +med.toFixed(4); rep.normalised = norm !== 1;
  const lam = lam0Of(fabric, L), cap = L.wr[1]; let nw = 0, amax = 0;
  for (let v = 0; v < n; v++) { const e = eig(v); if (!e) continue;
    const lo = Math.sqrt(Math.max(0, e.lo)) / norm, hi = Math.sqrt(Math.max(0, e.hi)) / norm, comp = Math.max(0, 1 - lo - 0.012);   // under ~1 % the solve's own in-plane slack, not buckling
    // the compressed direction (eigenvector of the smaller eigenvalue) in the pattern plane, as a doubled angle
    let ex = e.b, ey = e.lo - e.a; if (Math.hypot(ex, ey) < 1e-12) { ex = e.lo - e.d; ey = e.b; } if (Math.hypot(ex, ey) < 1e-12) { ex = 1; ey = 0; }
    const an = smooth(0.002, 0.012, hi - lo);   // a direction only where the compression is directional (isotropic: crumples, rare on a body)
    const th = Math.atan2(ey, ex), A = Math.min(lam / Math.PI * Math.sqrt(comp), cap * lam / Math.PI) * 1000 * (0.3 + 0.7 * an);
    S[v * 4] = A * Math.cos(2 * th); S[v * 4 + 1] = A * Math.sin(2 * th); S[v * 4 + 2] = Math.max(-0.2, Math.min(0.5, hi - 1));
    if (Rw) { const Ar = lam / Math.PI * Math.sqrt(comp) * 1000 * (0.3 + 0.7 * an); Rw[v * 2] = Ar * Math.cos(2 * th); Rw[v * 2 + 1] = Ar * Math.sin(2 * th); }
    if (A > 0.05) nw++; amax = Math.max(amax, A); }
  // a coherent direction field: the doubled-angle vectors averaged over the mesh's neighbours; where neighbours disagree the vector shrinks (no wrinkle drawn where the cloth has no one direction of
  // compression). HOW FAR is the crease's own scale (FABRIC7 c5 it3): a crease is a straight line of its own, several fold wavelengths long, and its direction is the compression direction AT ITS SCALE.
  // The cascade's shader reads the field per pixel, so a field that turns faster than the crease is long (the mesh's per-vertex noise: 3 passes smooth over ~1 edge, 10-15 mm, against creases
  // 100-350 mm long) makes the creases circle the turning points: the ring dimples of the L23 coat and the dot lattice on the L08 sleeve in c5 it2's pattern maps. So with the cascade on the field
  // is band-limited to half the fold wavelength (sigma = lambda_F / 2, the field's Nyquist for the fold): a neighbour pass spreads a vertex by 0.375 h^2 a side (self weight 2 of 2 + valence 6),
  // so passes = (sigma / h)^2 / 0.375, h the mean edge of the flat pattern. Cascade off: the 3 passes of rev 6, unchanged.
  const nb = Array.from({ length: n }, () => []); for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k], b = I[t + (k + 1) % 3]; nb[a].push(b); nb[b].push(a); }
  let passes = 3;
  if (OPTS.cascade) { let hs = 0, hn = 0; for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k], b = I[t + (k + 1) % 3], d = Math.hypot(UV[a * 2] - UV[b * 2], UV[a * 2 + 1] - UV[b * 2 + 1]); if (d > 1e-9) { hs += d; hn++; } }
    const h = hn ? hs / hn : 0.01, sigma = 0.5 * cascade6(fabric, L).lamF; passes = Math.max(3, Math.min(160, Math.round(Math.pow(sigma / h, 2) / 0.375))); rep.dirPasses = passes; rep.dirSigmaMm = +(sigma * 1000).toFixed(1); rep.edgeMm = +(h * 1000).toFixed(1); }
  let e0 = 0; for (let v = 0; v < n; v++) e0 += S[v * 4] * S[v * 4] + S[v * 4 + 1] * S[v * 4 + 1];
  for (let it = 0; it < passes; it++) { const X = new Float32Array(n), Y = new Float32Array(n), X2 = Rw ? new Float32Array(n) : null, Y2 = Rw ? new Float32Array(n) : null;
    for (let v = 0; v < n; v++) { let x = S[v * 4] * 2, y = S[v * 4 + 1] * 2, c = 2, x2 = Rw ? Rw[v * 2] * 2 : 0, y2 = Rw ? Rw[v * 2 + 1] * 2 : 0;
      for (const u of nb[v]) { x += S[u * 4]; y += S[u * 4 + 1]; c++; if (Rw) { x2 += Rw[u * 2]; y2 += Rw[u * 2 + 1]; } } X[v] = x / c; Y[v] = y / c; if (Rw) { X2[v] = x2 / c; Y2[v] = y2 / c; } }
    for (let v = 0; v < n; v++) { S[v * 4] = X[v]; S[v * 4 + 1] = Y[v]; if (Rw) { Rw[v * 2] = X2[v]; Rw[v * 2 + 1] = Y2[v]; } } }
  nw = 0; amax = 0; let e1 = 0; for (let v = 0; v < n; v++) { const A = Math.hypot(S[v * 4], S[v * 4 + 1]); e1 += A * A; if (A > 0.05) nw++; amax = Math.max(amax, A); }
  if (OPTS.cascade) rep.dirCoherence = +(e1 / Math.max(e0, 1e-12)).toFixed(3);   // the share of the excess the field still carries after the band-limit (the rest turns faster than a crease is long: the geometry's)
  rep.wrinkled = +(nw / n).toFixed(3); rep.ampMaxMm = +amax.toFixed(2);
}
// signed mean curvature x the bending length (the umbrella operator): > 0 on the crest of a fold
function crestField(P, N, I, n, cLocal, S) {
  if (!N) return; const sx = new Float64Array(n * 3), cnt = new Float64Array(n), e2 = new Float64Array(n);
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k], b = I[t + (k + 1) % 3];
    for (const [u, v] of [[a, b], [b, a]]) { for (let c = 0; c < 3; c++) sx[u * 3 + c] += P[v * 3 + c] - P[u * 3 + c]; cnt[u]++; e2[u] += (P[v * 3] - P[u * 3]) ** 2 + (P[v * 3 + 1] - P[u * 3 + 1]) ** 2 + (P[v * 3 + 2] - P[u * 3 + 2]) ** 2; } }
  for (let v = 0; v < n; v++) { if (!cnt[v]) continue; const d = (sx[v * 3] * N[v * 3] + sx[v * 3 + 1] * N[v * 3 + 1] + sx[v * 3 + 2] * N[v * 3 + 2]) / cnt[v], m2 = e2[v] / cnt[v];
    S[v * 4 + 3] = Math.max(-1, Math.min(1, -2 * d / Math.max(m2, 1e-12) * cLocal)); }
}
// the pattern's edges: per panel (aRest.z = panel x 0.01), the boundary loops; an edge between two seam vertices (a vertex shared in
// position with another panel's) is sewn, else free; per vertex the nearest point on a sewn and on a free edge: distance and arc
function edgeFrame(P, UV, R, I, n, sc, E, rep) {
  const pan = Int32Array.from({ length: n }, (_, i) => Math.round(R[i * 3 + 2] * 100)), tol = 2e-4 / sc, key = i => `${Math.round(P[i * 3] / tol)},${Math.round(P[i * 3 + 1] / tol)},${Math.round(P[i * 3 + 2] / tol)}`;
  const grp = new Map(); for (let i = 0; i < n; i++) { const k = key(i); const q = grp.get(k); if (q) q.push(i); else grp.set(k, [i]); }
  const seam = new Uint8Array(n); for (const q of grp.values()) if (q.length > 1 && q.some(i => pan[i] !== pan[q[0]])) for (const i of q) seam[i] = 1;
  const ec = new Map(); for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k], b = I[t + (k + 1) % 3], kk = a < b ? a * n + b : b * n + a; ec.set(kk, (ec.get(kk) || 0) + 1); }
  const adj = new Map(); const addA = (a, b) => { const q = adj.get(a); if (q) q.push(b); else adj.set(a, [b]); };
  for (const [kk, c] of ec) if (c === 1) { const a = Math.floor(kk / n), b = kk % n; addA(a, b); addA(b, a); }
  // walk the boundary into chains, the arc length along each (in the flat pattern)
  const arcOf = new Float64Array(n).fill(-1), segs = [], seen = new Set(); let nSeam = 0, nFree = 0;
  const d2 = (a, b) => Math.hypot(UV[a * 2] - UV[b * 2], UV[a * 2 + 1] - UV[b * 2 + 1]);
  for (const s0 of adj.keys()) { if (arcOf[s0] >= 0) continue; let prev = -1, cur = s0, arc = 0; arcOf[s0] = 0;
    for (let guard = 0; guard < n; guard++) { const nb = (adj.get(cur) || []).filter(v => v !== prev); let nxt = -1;
      for (const v of nb) { const kk = cur < v ? cur * n + v : v * n + cur; if (!seen.has(kk)) { nxt = v; seen.add(kk); break; } }
      if (nxt < 0) break; const len = d2(cur, nxt), type = seam[cur] && seam[nxt] ? 1 : 0;
      segs.push([cur, nxt, arc, arc + len, type, pan[cur]]); type ? nSeam++ : nFree++; arc += len; if (arcOf[nxt] < 0) arcOf[nxt] = arc; prev = cur; cur = nxt; if (cur === s0) break; } }
  rep.seamEdges = nSeam; rep.freeEdges = nFree;
  // grids of segments per panel and type
  const cell = 0.03, G = new Map(), gk = (p, t, x, y) => `${p}|${t}|${x}|${y}`;
  for (let s = 0; s < segs.length; s++) { const [a, b, , , t, p] = segs[s], x0 = Math.floor(Math.min(UV[a * 2], UV[b * 2]) / cell), x1 = Math.floor(Math.max(UV[a * 2], UV[b * 2]) / cell), y0 = Math.floor(Math.min(UV[a * 2 + 1], UV[b * 2 + 1]) / cell), y1 = Math.floor(Math.max(UV[a * 2 + 1], UV[b * 2 + 1]) / cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = gk(p, t, x, y); const q = G.get(k); if (q) q.push(s); else G.set(k, [s]); } }
  const near = (v, t, cap) => { const u = UV[v * 2], w = UV[v * 2 + 1], cx = Math.floor(u / cell), cy = Math.floor(w / cell), Rr = Math.ceil(cap / cell); let best = cap, arc = 0;
    for (let a = -Rr; a <= Rr; a++) for (let c = -Rr; c <= Rr; c++) { const q = G.get(gk(pan[v], t, cx + a, cy + c)); if (!q) continue;
      for (const s of q) { const [i, j, a0, a1] = segs[s], ax = UV[i * 2], ay = UV[i * 2 + 1], bx = UV[j * 2] - ax, by = UV[j * 2 + 1] - ay, l2 = bx * bx + by * by || 1e-12;
        const tt = Math.max(0, Math.min(1, ((u - ax) * bx + (w - ay) * by) / l2)), d = Math.hypot(u - ax - bx * tt, w - ay - by * tt); if (d < best) { best = d; arc = a0 + (a1 - a0) * tt; } } }
    return [best, arc]; };
  for (let v = 0; v < n; v++) { const [sd, sa] = near(v, 1, 0.05), [hd, ha] = near(v, 0, 0.06); E[v * 4] = sd; E[v * 4 + 1] = sa; E[v * 4 + 2] = hd; E[v * 4 + 3] = ha; }
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- fuzz shells: the fibres standing off fleece, wool and heather jersey
// Each garment mesh of a fuzzy fabric gets `layers` shells (the same skinned geometry pushed out along its normal, 0.25-1 x the fuzz
// length), drawn transparent: a fibre field whose coverage along the view grows toward grazing (optical depth / |n.v|), lit like the
// cloth. At a silhouette the haze stands past the cloth's edge. Engine only (Cycles: the Principled sheen carries the fuzz).
export function fuzz6(root, { layers = 3, gain = 1 } = {}) {
  const made = [];
  root.traverse(m => { const f6 = m.material?.userData?.fabric6; if (!m.isSkinnedMesh || !f6 || m.userData.f6Shell || m.userData.f6Fuzzed) return; const L = look6(f6.fabric); if (!L || !(L.fuzz?.[0] > 0)) return; m.userData.f6Fuzzed = true; made.push([m, L]); });   // once a mesh (prepareFabric6 and a page's own call both draw them)
  for (const [m, L] of made) for (let k = 0; k < layers; k++) {
    const hgt = (k + 1) / layers, len = L.fuzz[0] / 1000, dens = L.fuzz[1] * gain, U = m.material.uniforms_c6;
    const mat = new THREE.MeshStandardMaterial({ color: m.material.color.clone().lerp(new THREE.Color(1, 1, 1), 0.08), roughness: 1, metalness: 0, transparent: true, depthWrite: false, side: THREE.FrontSide });
    mat.onBeforeCompile = sh => { sh.uniforms.f6Off = { value: len * hgt }; sh.uniforms.f6Den = { value: dens }; sh.uniforms.f6H = { value: hgt }; sh.uniforms.f6Seed = { value: U?.cSeed?.value ?? 1 };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float f6Off; varying vec3 vF6P;').replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * f6Off; vF6P = position * 900.0;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float f6Den, f6H, f6Seed; varying vec3 vF6P;\nfloat f6h3(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }')
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
{ vec3 V = normalize(vViewPosition); float nv = abs(dot(normalize(vNormal), V));
  float fib = step(f6H * 0.85 + 0.1, f6h3(floor(vF6P) + f6Seed));                // fibres thin out with height
  float tau = f6Den * (1.0 - f6H * 0.6) * 0.35 / max(nv, 0.12);
  diffuseColor.a = clamp((1.0 - exp(-tau)) * (0.35 + 0.65 * fib), 0.0, 0.85); }`); };
    mat.customProgramCacheKey = () => 'f6-fuzz';
    const s = new THREE.SkinnedMesh(m.geometry, mat); s.bind(m.skeleton, m.bindMatrix); s.frustumCulled = false; s.castShadow = false; s.receiveShadow = true; s.renderOrder = 2 + k;
    s.userData.f6Shell = true; s.userData.part = 'f6-fuzz'; m.parent.add(s); s.position.copy(m.position); s.quaternion.copy(m.quaternion); s.scale.copy(m.scale);
  }
  return made.length * layers;
}

// pages that build people through code they do not own (CYCLES's lab_bake for the garment atlas, the export): the per-vertex data when a
// rev-6 garment mesh is added to the scene graph (it is then complete: geometry, skeleton, userData), before anything copies its geometry
// (lab_bake draws a non-indexed copy). Opt-in, once per page; patches THREE.Object3D.prototype.add.
let _auto = false;
export function autoFabric6() {
  if (_auto) return; _auto = true; const add0 = THREE.Object3D.prototype.add;
  THREE.Object3D.prototype.add = function (...objs) { const r = add0.apply(this, objs);
    for (const o of objs) if (o?.isMesh && o.material?.userData?.fabric6 && !o.geometry.attributes.aF6e && o.geometry.index) fabric6Attributes(o, o.geometry, o.material.userData.fabric6.fabric);
    return r; };
}
// the yarn tile of a fabric for Cycles (labs/clothing2/fabric6_lab.js mode=tile renders it; fabric6_tiles.mjs saves it): one period of
// `per` threads each way, rgba = (weft shows, height, end-to-end tone / 2, undyed fibre), the same functions as the garment shader
export const F6_TILE_FRAG = `
varying vec2 vUv;
void main() {
  vec2 qe = vUv * f6Per; int K6 = int(f6Y0.x + 0.5); float wv = 0.0, lane = 0.0, h; vec2 c, f, tg; bool weft = false; float yi, along, across;
  if (K6 <= 3) { h = f6woven(qe, wv, c, f); weft = wv > 0.5; yi = weft ? c.y : c.x; along = weft ? qe.x : qe.y; across = weft ? f.y : f.x; }
  else { h = f6knit(qe, c, tg, lane); yi = c.y; along = qe.y; across = lane; }
  float tone = 1.0 + (weft ? f6Y1.w : f6Y1.z) * 2.0 * (f6hash(vec2(yi, weft ? 3.0 : 1.0), cSeed) - 0.5);
  float fib = K6 >= 4 ? f6hash(vec2(floor(across * 7.0) + c.x * 13.0, yi * 5.0 + floor(across * 0.5)), cSeed + 9.0) : f6hash(vec2(floor(across * 7.0 + yi * 7.3), floor(along * 0.35 + across * 3.1)), cSeed + 9.0);
  gl_FragColor = vec4(wv, clamp((h + 0.35) / 0.8, 0.0, 1.0), clamp(tone * 0.5, 0.0, 1.0), step(fib, f6Y2.x));
}`;
// the Cycles record of rev 6 for the fabrics an export uses (fabric6_texbake.mjs writes it as <export>/fabric6.json; blender/person_scene.py
// fabric6_record reads it): thread counts and kind for the yarn tile, the far colour's weft share and weft colour (linear), heather,
// roughness, the sheen (weight, roughness, tint), specular, anisotropy
export async function cycles6(fabrics) {
  const F4 = await import('./wardrobe4/fabrics4.js'); F4.registerFabrics4();
  const out = { version: FABRIC6_VERSION, per: 32, tiles: 'web/assets/fabric6/tiles', fabrics: {} };
  for (const f of fabrics) { const L6 = look6(f), Lk = LOOKS[f]; if (!L6 || !Lk) continue; const W = Lk.weave, wc = W.weft ? lin(W.weft) : null, hc = L6.heather?.[1] ? lin(L6.heather[1]) : null;
    out.fabrics[f] = { kind: L6.kind, epc: W.epc, ppc: W.ppc, weftShow: (L6.kind === 'jersey' || L6.kind === 'rib') ? 0 : W.weftShow ?? 0, weftShowDetail: +yarn6(f, L6).ws.toFixed(4), aoMean: AO6[f] ?? 0.86, weft: wc ? [wc.r, wc.g, wc.b] : null,
      heather: [L6.heather?.[0] || 0, hc ? [hc.r, hc.g, hc.b] : null], rough: Lk.rough[0], sheen: [L6.sheen6[0], L6.sheen6[1], Lk.sheen?.[2] ?? 0.25], spec: Lk.spec ?? 0.4, aniso: Lk.aniso?.[0] ?? 0, nap: L6.nap || 0 }; }
  return out;
}
