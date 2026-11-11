// EYES (round 7 studio, 8 Oct): ONE eye for every person, in Cycles and (later iterations) in the engine, from the same record and maps.
//   import { eye7Record } from '../lib/fx/face/eye/index.js';
//   const R = eye7Record(M, { age, sex, iris: 'brown', seed, skin: person });   // M: assets/likeness/skin_model.json (skin_lut.js loadSkinModel)
//   R.json  : the anatomy (mm), the pupil per stage, the mucosa colours (linear Rec.709), the iris class and grades: what eye7_cycles.py reads
//   R.maps  : per eye { side, iris: growIris(..), sclera: growSclera(..) } (Float32 maps; labs/eyes/eye7_maps.mjs writes them as PNG)
// The model and its sources: model.js. The structures: iris.js (the stroma grown as its vessel network: trabeculae, collarette, crypts, furrows,
// ruff; albedo from the tissue's optics, the melanin in its granules), sclera.js (grown conjunctival and ciliary vessels, melanosis, the limbal transition; albedo from the sclera's optics).
import { EYE7_VERSION, GAZE, eyeAnatomy, pupilWY, STAGE_LUM, irisPigDraw, irisPig, ablIndex, IRIS_TISSUE, mucosaRGB, rgbOf, ruffSpectrum } from './model.js';
import { growIris, irisGrades } from './iris.js';
import { growSclera } from './sclera.js';
import { skinSpectrum } from '../../likeness/skin_lut.js';

export { EYE7_VERSION };
// (v11) ONE SEED FOR ONE PERSON, in both renderers: the engine (engine.js buildEye7) and Cycles (labs/eyes/eye7_maps.mjs, from the export) draw the
// person's iris (melanin within the class, the network, the grades) from the same seed, made from what both have: the Hero's skin, height and
// age options and its sex (the export carries them as info.skin, height, eyes.age, sex). Until v10 the engine hashed these and the maps hashed the
// export's name, so a video frame and a Cycles still of one person showed two different irises.
export function eye7Seed({ skin, height, age, sex }) {
  const ageK = Math.max(0.1, Math.min(0.95, age ?? 0.3)); let h = 2166136261;
  for (const ch of `${skin}|${height}|${ageK}|${sex}|eye7`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h % 100000;
}
export function eye7Record(M, { age = 30, sex = 'f', iris = 'brown', seed = 1, skin = null, maps = true, irisRes = [1024, 256], scleraRes = [2048, 512], pig: pigIn = null } = {}) {
  // (integrator c6 seam, 16 Oct: pass-through only) `pig`: the PERSON's own pigment parameters (lib/fx/person/iris7.js irisPigment7: a continuous draw
  // by ancestry and age) in place of the draw within the class; absent = as before
  const A = eyeAnatomy({ age, sex }), G = irisGrades(seed), pig = pigIn ? { ...irisPig(iris), ...pigIn, cls: iris, draw: 'person' } : irisPigDraw(iris, seed);   // (v10) the person's own melanin within the class
  const pupil = Object.fromEntries(Object.entries(STAGE_LUM).map(([k, L]) => [k, +pupilWY({ L, age }).toFixed(3)]));
  const person = skin || { Cm: 0.05, beta: 0.5, Ch: 0.02, gamma: 0.7, Cc: 0.1 };
  const colours = {
    caruncle: mucosaRGB(M, skinSpectrum, person, { mel: 0.6, blood: 3.2, car: 0.3 }),   // modified skin: pink, moist; pigmented in deeply pigmented people
    plica: mucosaRGB(M, skinSpectrum, person, { mel: 0.25, blood: 2.2, car: 0.2 }),     // conjunctiva: thin, translucent
    margin: mucosaRGB(M, skinSpectrum, person, { mel: 0.35, blood: 2.6, car: 0.2 }),    // the posterior lid margin (mucocutaneous junction)
    ruff: rgbOf(M, ruffSpectrum(M)),
    skin: rgbOf(M, skinSpectrum(M, person, true)),                                       // the lid's own skin at the lash line (the gasket's anterior edge)
  };
  const json = { version: EYE7_VERSION, age, sex, seed, iris: { cls: iris, pig, grades: G }, anatomy: A, pupil, colours,
    gaze: { ...GAZE, rule: 'eyeHeadSplit: the eye holds up to eyeOnlyDeg off the head forward, the head the rest (model.js)' },
    skinCm: person.Cm, note: 'lib/fx/face/eye (EYES): mm, linear Rec.709; maps u = angle (0 temporal, 0.25 up, 0.5 nasal), v = s (iris) or theta/thetaMax (sclera)' };
  if (!maps) return { json };
  const out = [];
  for (const side of [1, -1]) {
    const I = growIris(M, { cls: iris, seed, side, NA: irisRes[0], NR: irisRes[1], grades: G, pig });
    const S = growSclera(M, { seed, side, age, skinCm: person.Cm, NU: scleraRes[0], NV: scleraRes[1], gr: A.globeR });
    out.push({ side, iris: I, sclera: S });
  }
  // (v10) the Cycles iris: the stroma's walk distance per channel (mm), the slab's thickness, the border layer's coat index over the aqueous
  if (out.length) json.iris.sss = { d: out[0].iris.sssD, thick: out[0].iris.thick, coatIOR: +(ablIndex() / IRIS_TISSUE.nAq).toFixed(4) };
  if (out.length) json.iris.blood = out[0].iris.netBlood;   // (v11) what the grown vessels give: the stroma's mean blood, the lumens' share of the face
  json.maps = out.map(e => ({ side: e.side, iris: { NA: e.iris.NA, NR: e.iris.NR, pupilRest: e.iris.pupilRest, rootR: e.iris.rootR, counts: e.iris.counts, ms: e.iris.ms },
    sclera: { NU: e.sclera.NU, NV: e.sclera.NV, thetaMax: e.sclera.thetaMax, counts: e.sclera.counts, ms: e.sclera.ms } }));
  return { json, maps: out };
}
