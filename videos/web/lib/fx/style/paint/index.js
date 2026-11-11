// STYLE c2 / S2: PAINTED AND SCULPTED. Seven recipes on lane E's style layer (shape -> surface -> line -> medium), each derived from the
// person's anatomy and attached to the body so it holds in motion. Opt-in: nothing imports this folder unless it asks for a style; a
// hero never given applyPaint renders exactly as before, and lane E's STYLES render through PaintStage unchanged.
//
//   import { PAINT_STYLES, PaintStage } from '../lib/fx/style/paint/index.js';
//   const stage = await new PaintStage({ width: 1920, height: 1080, recipes: PAINT_STYLES }).load();
//   const P = styledPerson(base, PAINT_STYLES.mural);              // lane E's shape (or makePerson(who, { style: PAINT_STYLES.mural }))
//   await stage.render(ctx, 'mural', { scene, camera, rig, heroes: [h], sunDir, extras: [[ground, 90]] });
//
// A recipe here carries lane E's keys (label, shape, surface, line, medium) and three of ours:
//   people  makePerson stages the medium wants (a statue takes hero.js's sculpted hair shells and eyes, not lane D's cards or lane B's
//           globes: a bronze has no strands)        view   the view it reads best in (the cut-out: profile)
//   set     what the stage needs around the person ('plinth': a granite plinth and a low camera into the sky)
//   cost    ms a frame at 1080p on the farm (V100), measured; fit: where it belongs (hero close-up, mid, crowd; still, motion)
export { PaintStage, PAINT_KINDS } from './stage.js';
export { loadAnatomy, paintFields, MUSCLES, MUSCLE_ID } from './fields.js';
export { applyPaint, paintAOV, paintPass, PT_MODE, OBJ } from './patch.js';
export { mural, watercolour, shadowPlay, plate, muralColour } from './media.js';

const ALL = ['body', 'kin', 'skin', 'eyes', 'hair', 'cloth', 'drape', 'style'];
const STATUE = ['body', 'kin', 'cloth', 'drape', 'style'];
export const PAINT_STYLES = {
  // (1) oil / WPA mural: strokes along the muscle fibres and the limb axes, one colour each, a limited palette, umber contours
  mural: { label: 'mural (oil, WPA)', shape: { level: { default: 1.3, head: 0.6, hands: 0.4 } }, surface: { surface: 'skin', fade: 1 },
    line: { weight: 0.9, planes: 0, landmarks: 0.2, faceK: 0.4, ink: '#4a2a1a', crease: false, hem: false },
    medium: { kind: 'mural', meter: 'face', stroke: { k: 0.0095, min: 2.4, max: 12, fine: 0.32 }, palette: { values: [0.5, 0.74, 0.93, 1.04], soft: 0.14, warm: 0.035, lift: 0.3 }, drag: 0, bristle: 0.03, impasto: 0.04, lost: { r: 4, contrast: 38 }, imprimatura: '#9a5a34', groundPx: 16, ground: ['#a8844f', '#e6cf9c', '#4a3021', '#a77c52'] },
    people: ALL, fit: 'hero mid shot to full figure, still and motion (strokes ride the body); at crowd size it reads as the lit render' },
  // the CONTROL for the motion check only (not a style): the mural with its stroke lattice fixed to the SCREEN instead of the body
  muralScreen: { label: 'control: mural strokes fixed to the screen', shape: { level: { default: 1.3, head: 0.6, hands: 0.4 } }, surface: { surface: 'skin', fade: 1 },
    line: { weight: 0.9, planes: 0, landmarks: 0.2, faceK: 0.4, ink: '#4a2a1a', crease: false, hem: false },
    medium: { kind: 'mural', meter: 'face', screen: true, stroke: { k: 0.0095, min: 2.4, max: 12, fine: 0.32 }, palette: { values: [0.5, 0.74, 0.93, 1.04], soft: 0.14, warm: 0.035, lift: 0.3 }, drag: 0, bristle: 0.03, impasto: 0.04, imprimatura: '#9a5a34', groundPx: 16 },
    people: ALL, control: true },
  // (2) watercolour: washes over a pencil line
  watercolour: { label: 'watercolour', shape: { level: { default: 1, head: 0.5, hands: 0.3 } }, surface: { surface: 'skin', fade: 1 },
    line: { weight: 1.05, planes: 0, landmarks: 0, faceK: 0.7, ink: '#5a4434', alpha: 0.72, crease: false },
    medium: { kind: 'watercolour', meter: 'face', bleed: 5, wobble: 0.2, t1: 0.6, t2: 0.3, t3: 1.04, granulation: 0.35, liftWash: 0.34 },
    people: ALL, fit: 'illustration, mid to full figure; motion holds (washes and granulation are attached to the body; the paper is the sheet)' },
  // (3) monument materials on lane E's monumental canon
  bronze: { label: 'bronze (monument)', shape: { level: { default: 1, hands: 0.6 }, canon: 'monumental' }, surface: { surface: 'clay', clay: '#7a6a58' },
    medium: { kind: 'monument', material: 'bronze' }, set: 'plinth', people: STATUE, fit: 'hero, still or slow camera (a statue); full figure to bust' },
  plaster: { label: 'plaster cast (academic)', shape: { level: { default: 1, hands: 0.5 } }, surface: { surface: 'clay', clay: '#d8d2c6' },
    medium: { kind: 'monument', material: 'plaster' }, set: 'plinth', people: STATUE, fit: 'the studio\'s own figure study; any distance' },
  steel: { label: 'stainless steel (Mukhina)', shape: { level: { default: 1.2, hands: 0.6 }, canon: 'monumental' }, surface: { surface: 'clay', clay: '#9a9ca0' },
    medium: { kind: 'monument', material: 'steel' }, set: 'plinth', people: STATUE, fit: 'hero pair, low camera into the sky; still or slow orbit' },
  // (4) cut paper / shadow play (Reiniger)
  // lace: false by default (the first boards: holes from a dab lattice read as tears, not ornament; lace: true keeps them); the hair is
  // hero.js's sculpted shell, not lane D's cards (cards cut a scribbled edge into a silhouette)
  shadow: { label: 'cut paper (Reiniger)', shape: { level: 0.5 }, surface: { surface: 'skin', fade: 1 }, medium: { kind: 'shadow', glow: '#f7e6b8', edge: '#b0602a', lace: false, stroke: { k: 0.026, min: 7, max: 34 } },
    view: 2, people: ['body', 'kin', 'cloth', 'drape', 'style'], fit: 'motion first (silhouettes act through pose); profile; any size, lace from mid shot up' },
  // (5) the anatomy plate (the studio's own figure work)
  ecorche: { label: 'anatomy plate (ecorche)', shape: { level: 0 }, surface: { surface: 'skin', fade: 1 }, medium: { kind: 'plate', labels: false, ghosts: true, hatch: { k: 0.0036, min: 2.2, max: 4.2 } },
    people: ALL, fit: 'study and teaching, full figure still; labelled as a plate on one or two figures (labels=1), outlines only in a row' },
};
