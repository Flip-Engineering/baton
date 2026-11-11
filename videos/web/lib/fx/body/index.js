// BODY (HUMAN c8 lane A): an anatomy-first body generator calibrated to measured populations (NHANES, ANSUR II, NHANES DXA), and the
// source of each person's kinematic model. Opt-in: nothing in the existing studio imports this; CREW8 and every scene render as before.
//   const S = await loadBodyStudio();                      // basis + population + the base hero bundle (own loader, own cache)
//   const p = castBody(S, { sex: 'f', age: 45, group: 'black', bmiPct: 0.5, seed: 3 });
//   const h = new Hero(p, { variant: p.name, height: p.height, skin: p.skin, ... });    // a person IS a hero data object
//   p.measures, p.targets, p.errPct, p.kin (kin.js header; schema in review/studio_human_c8/after/body/NOTES.md), p.landmarks, p.supported(type)
//   const cast = await loadCast(S); cast.find('f45_black_p50')
export { loadBodyStudio, makeStudio } from './basis.js';
export { castBody, person, record, loadCast, supportedPositions, SUPPORTS, breastVolumes, skinHint } from './person.js';
export { sampleTargets, GROUPS, bandOf, OCCUPATION, FAT_PATTERN, MUSCLE_BASE } from './sampler.js';
export { build, uterusAt, macroMix, breastMix } from './mix.js';
export { measure, ffit, breastVolume, tapeAt } from './measure.js';
export { fitPerson } from './fit.js';
export { kinematics, scaleKin, JOINT_BONES, KIN_VERSION } from './kin.js';
