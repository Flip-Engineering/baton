// PERSON / THE IRIS'S OWN PIGMENT (integrator c6, 16 Oct; the orchestrator's 00:55 order from EYES' it14 critic): the person's iris is a set of
// PARAMETERS of EYES' model (lib/fx/face/eye/model.js, EYE7_VERSION 11: the iris's melanin column eu and pheo (mg/ml over the iris's own
// thickness, Prota et al. 1998 as compiled by Lam and Baranoski 2006) and the share of it in the anterior border layer, abl; the stroma's
// scattering law fRay), drawn per person from a CONTINUOUS population distribution by ancestry and age, seeded by the person. It replaces
// build.js's class lookup by group (white: one of five classes at random; hispanic: brown / brown / hazel; everyone else: darkBrown), which
// made amber, hazel-brown, green and grey unreachable for most people and every Black and Asian iris the same column.
// EYES owns the model (the optics, the anchors IRIS_PIG, the iris's growth from the pigment); this file is only the person's draw. No class
// name is written here: the anchors are EYES' IRIS_PIG, read as data.
//
//   import { irisPigment7 } from './iris7.js';
//   const I = irisPigment7({ name, group, age, sex, seed });   // -> { pig: { eu, pheo, abl, fRay? }, cls, z, from }
//   buildEyes(h, { iris: I.cls, pig: I.pig, ... })             // eye7 grows the iris from `pig` (eye7Record's pig); `cls` is EYES' nearest anchor,
//                                                               // kept only for what EYES still keys by class (the engine's fallback colour)
//
// THE DISTRIBUTION (stated plainly: the shape is ours, the anchors are EYES' measured / interpolated columns, the frequencies recalled from
// the literature, to verify):
//   - the melanin column: ln(eu) a MIXTURE of normals by ancestry, centred on EYES' light (blue / grey), intermediate (green / hazel),
//     moderate (brown) and high (dark brown) columns, each with sd 0.3 in ln (EYES' own within-class spread, irisPigDraw), so the mixture is
//     one continuum from the lightest blue to the darkest brown with no class boundaries. The weights by NHANES group (iris colour
//     frequencies, recalled: Sturm and Larsson 2009, Pigment Cell Melanoma Res 22:544; Mackey 2011, Ophthalmic Genet 32:171; Seddon et al.
//     1990 for US adults: in US adults of European ancestry roughly a third light, a fifth intermediate, the rest brown; Hispanic US adults
//     mostly brown with some intermediate and few light; African and East / South Asian ancestry almost all brown to dark brown):
//       white     light 0.33  intermediate 0.22  moderate 0.30  high 0.15
//       hispanic  light 0.04  intermediate 0.14  moderate 0.42  high 0.40
//       black     light 0.00  intermediate 0.02  moderate 0.18  high 0.80
//       asian     light 0.00  intermediate 0.02  moderate 0.30  high 0.68
//     a mixed or unknown group: the four averaged.
//   - age: adult iris colour is mostly stable; light irides darken a little in early adulthood and pale a little late (Bito et al. 1997, Arch
//     Ophthalmol 115:659: a visible change in ~10-20 % of light-eyed adults). Modelled as ln(eu) + 0.006 / yr from 18 to 40 and - 0.004 / yr
//     past 60, on the light and intermediate components only (our values, small by design).
//   - pheo / eu: the ratio of EYES' anchors interpolated in ln(eu) (blue 0.16, grey 0.17, green 0.60, hazel 0.42, brown 0.25, dark brown 0.27:
//     green and hazel carry more pheomelanin, Prota et al. 1998), times the person's own log-normal factor (sd 0.3 in ln): a moderate column
//     with a high ratio is an amber or hazel-brown iris, a light column with a high ratio a green one.
//   - abl (the border layer's share of the melanin): EYES' anchors interpolated in ln(eu) (0.1 .. 0.9), +- 0.1 (uniform) by person.
//   - fRay (the stroma's Rayleigh share; EYES' grey anchor 0.6 = a denser, coarser stroma, the default 0.9): for light columns a draw in
//     0.6 .. 0.9 (grey to blue), blended back to the default by the intermediate columns.
import { IRIS_PIG, IRIS_TISSUE } from '../face/eye/model.js';

export const IRIS7_VERSION = 2;   // (orchestrator 16 Oct) draws reflected inside EYES' measured range (was 1: the integrator c6's continuous draw)
const MIX = { white: [0.33, 0.22, 0.30, 0.15], hispanic: [0.04, 0.14, 0.42, 0.40], black: [0.0, 0.02, 0.18, 0.80], asian: [0.0, 0.02, 0.30, 0.68] };
const SD = 0.3;   // ln units: EYES' within-class spread (model.js irisPigDraw)
// the component centres in ln(eu) from EYES' anchors: light = blue and grey, intermediate = green and hazel, moderate = brown, high = dark brown
const lnMid = ks => ks.reduce((a, k) => a + Math.log(IRIS_PIG[k].eu), 0) / ks.length;
const COMP = () => [lnMid(['blue', 'grey']), lnMid(['green', 'hazel']), lnMid(['brown']), lnMid(['darkBrown'])];
// a string hash -> 32-bit seed (FNV-1a)
const fnv = s => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h >>> 0; };
const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const gauss = r => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());
// EYES' anchors sorted by ln(eu): the interpolants for pheo / eu and abl run through every anchor
function anchors() { return Object.entries(IRIS_PIG).map(([k, p]) => ({ k, x: Math.log(p.eu), ratio: p.pheo / p.eu, abl: p.abl })).sort((a, b) => a.x - b.x); }
function interp(A, x, f) { if (x <= A[0].x) return A[0][f]; if (x >= A[A.length - 1].x) return A[A.length - 1][f];
  for (let i = 1; i < A.length; i++) if (x <= A[i].x) { const t = (x - A[i - 1].x) / Math.max(1e-9, A[i].x - A[i - 1].x); return A[i - 1][f] + t * (A[i][f] - A[i - 1][f]); } return A[A.length - 1][f]; }
const sst = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// the person's iris pigment. name + seed seed the draw (the same person always has the same iris; another seed is another person's draw)
export function irisPigment7({ name = '', group = null, age = 35, sex = 'f', seed = 1 } = {}) {
  const r = rng(fnv(`iris7|${name}|${seed}`)), C = COMP(), A = anchors();
  const w = MIX[group] || [0, 1, 2, 3].map(i => (MIX.white[i] + MIX.hispanic[i] + MIX.black[i] + MIX.asian[i]) / 4);
  // the component (by its weight), then the person's place in it
  let u = r(), c = 0; for (; c < 3; c++) { if (u < w[c]) break; u -= w[c]; }
  const yrs = age ?? 35, ageLn = c <= 1 ? 0.006 * (Math.min(40, Math.max(18, yrs)) - 18) - 0.004 * Math.max(0, yrs - 60) : 0;
  // (IRIS7_VERSION 2, orchestrator 16 Oct, from the EYES-FIX agent's read) INSIDE THE MEASURED RANGE: the high component is centred ON the
  // darkest measured column (EYES' darkBrown, eu 1.008: Prota et al. 1998's dark-brown class as compiled by Lam and Baranoski 2006) with a
  // symmetric spread, so half its draws fell darker than any measured iris (L08 eu 1.84: a stroma of 1.5 % albedo that the tear film's
  // 2-4 % reflection drowns, a black disc in Cycles), and the light component's tail fell lighter than the lightest (blue, 0.1201). A draw
  // beyond either measured end is REFLECTED back inside it (continuous, no pile-up at the bound). Said plainly: the class means are the
  // only measured columns we hold, so the darkest iris drawn is the dark-brown class's mean; a within-class range from the source would
  // widen the bounds.
  const xLo = Math.log(IRIS_PIG.blue.eu), xHi = Math.log(IRIS_PIG.darkBrown.eu);
  let x = C[c] + SD * Math.max(-2.5, Math.min(2.5, gauss(r))) + ageLn;
  if (x > xHi) x = Math.max(xLo, 2 * xHi - x); else if (x < xLo) x = Math.min(xHi, 2 * xLo - x);
  const eu = Math.exp(x), ratio = interp(A, x, 'ratio') * Math.exp(SD * Math.max(-2.5, Math.min(2.5, gauss(r))));
  const abl = Math.max(0.05, Math.min(0.95, interp(A, x, 'abl') + 0.2 * (r() - 0.5)));
  // the stroma's law: light columns between grey (0.6) and the default (0.9); intermediate and darker columns the default
  const light = 1 - sst(C[0] + 0.5 * SD, C[1], x), fRay = IRIS_TISSUE.fRay - light * 0.3 * r();
  const pig = { eu: +eu.toFixed(4), pheo: +(eu * ratio).toFixed(4), abl: +abl.toFixed(3), fRay: +fRay.toFixed(3) };
  // EYES' nearest anchor (in ln eu and the ratio), for what EYES still keys by class; not a class the person was drawn from
  let cls = A[0].k, best = Infinity; for (const a of A) { const d = ((a.x - x) / 0.5) ** 2 + ((a.ratio - ratio) / 0.15) ** 2; if (d < best) { best = d; cls = a.k; } }
  return { version: IRIS7_VERSION, pig, cls, ratio: +ratio.toFixed(3), comp: c, from: `iris7 v${IRIS7_VERSION}: ${group || 'mixed'} age ${Math.round(yrs)} (ln eu ${x.toFixed(2)})` };
}
