// STYLE c2 / S1: DRAWN AND PRINTED FROM THE ANATOMY. Recipes in lane E's form (shape, surface, line, medium) whose medium is
// 'draw': the marks are made from the person's anatomy (fields.js: cross-contour from the joint centres and limb axes, fibre
// lines from lane A's muscle fields, origin to insertion) in BIND space, so they ride the skinning and hold in motion.
//
//   import { DRAW_STYLES, DrawStage } from '../lib/fx/style/draw/index.js';
//   import { STYLES, styledPerson } from '../lib/fx/style/recipes.js';
//   const P = styledPerson(base, DRAW_STYLES.hatch);                          // the shape level the recipe asks for
//   const h = new Hero(P, { ...opts, variant: P.name, height }); P.finish(h);
//   const stage = new DrawStage({ width, height, recipes: DRAW_STYLES });      // lane E's StyleStage + the 'draw' medium
//   await stage.render(ctx, 'hatch', { scene, camera, rig, heroes: [h], sunDir });   // any DRAW_STYLES or lane E STYLES key
//
// medium: { kind: 'draw', draw: 1 hatch | 2 conte | 3 litho | 4 dither | 5 flat, ink, paper, chalk, tone [terminator, softness,
// ambient, reflected], local [floor, white point, gamma] (skin and cloth value), hatch [spacing px at 1080 tall, density,
// cross-contour k, wobble m], levels [tone where families start / grain range], face [face lift, face spacing k, hand lift],
// grain [cell px, grain k, smudge k, chalk k], paperK [tooth, mottle, tooth px], ground (false: no drawn cast shadow) }.
// surface.key: the designed key in VIEW space (as lane E's recipes) (a light the drawing is lit by; it moves with the camera, not the person).
// cost: ms a frame at 1080 x 1920 on the farm (V100), filled from the lab's own timing; fit: where the style is at home.
export { DrawStage, installDraw, setDrawMedium, coherence } from './stage.js';
export { loadDrawAnatomy, drawFields } from './fields.js';
export { DRAW_U, patchDraw, blueNoise } from './glsl.js';

// the landmark lines a drawing states (lane E's anchor paths): clavicles, iliac crests, spine, scapulae, tibiae; the rib arch and the
// inguinal path drew as straight-sided polygons on the first board, so they are left to the tone
const LMSET = ['clavicle_L', 'clavicle_R', 'crest_L', 'crest_R', 'spine', 'tibia_L', 'tibia_R', 'scapula_L', 'scapula_R'];
const SHAPE1 = { level: { default: 1, head: 0.5, hands: 0.5 } };
export const DRAW_STYLES = {
  // (1) the anatomical plate / engraving: Vesalius, Albinus, Bridgman's cross-contours; the burin follows the form
  hatch: { label: 'anatomical engraving', shape: SHAPE1, surface: { surface: 'skin', fade: 1, key: [-0.78, 0.45, 0.42] },
    medium: { kind: 'draw', draw: 1, ink: '#15110f', paper: '#efe6d2', tone: [0.02, 0.1, 0.16, 0.3], local: [0.2, 0.62, 0.9, 0.85], hatch: [5.2, 1, 1, 0.0012], levels: [0.16, 0.48, 0.74, 0], face: [0.1, 0.72, 0.15, 0.4], paperK: [0.04, 0.04, 1.6] },
    line: { weight: 1.45, planes: 0, landmarks: 0.35, faceK: 0.6, landmarkSet: LMSET },
    fit: 'hero close-up and mid shot, still or motion; at crowd size the lines merge to a grey and the contour carries it' },
  // (2) conte / charcoal life drawing on toned paper: the shadow as one mass, white chalk on the lit planes (Prud'hon, Loomis)
  conte: { label: 'conte on toned paper', shape: { level: { default: 1.3, head: 0.6, hands: 0.6 } }, surface: { surface: 'skin', fade: 1, key: [-0.8, 0.48, 0.36] },
    medium: { kind: 'draw', draw: 2, ink: '#1d1916', paper: '#b7aa92', chalk: '#f6f1e3', tone: [0.04, 0.14, 0.2, 0.32], local: [0.24, 0.62, 0.9, 0.6], hatch: [6, 1, 1, 0.002], levels: [0.1, 0.42, 0.7, 0], face: [0.1, 0.75, 0.1, 0.35], grain: [1.3, 0.22, 0.35, 0.95], paperK: [0.08, 0.07, 1.4] },
    line: { weight: 1.8, planes: 0, landmarks: 0.5, faceK: 0.6, ink: '#221c18', landmarkSet: LMSET },
    fit: 'hero and mid, still or slow motion (a life-room study, a portrait); Kentridge for motion: the sheet stays, the marks move' },
  // (2b) red chalk (sanguine) on cream: the Renaissance study and the ecorche
  sanguine: { label: 'red chalk', shape: { level: { default: 1.3, head: 0.6, hands: 0.6 } }, surface: { surface: 'skin', fade: 1, key: [-0.8, 0.48, 0.36] },
    medium: { kind: 'draw', draw: 2, ink: '#8c3a22', paper: '#ece0c8', chalk: '#fbf7ee', tone: [0.04, 0.14, 0.2, 0.32], local: [0.24, 0.62, 0.9, 0.6], hatch: [6, 1, 1, 0.002], face: [0.1, 0.75, 0.1, 0.35], grain: [1.3, 0.22, 0.35, 0.3], paperK: [0.06, 0.06, 1.4] },
    line: { weight: 1.7, planes: 0, landmarks: 0.5, faceK: 0.6, ink: '#7a2f1b', landmarkSet: LMSET },
    fit: 'hero and mid, still; the warm study register' },
  // (3) the crayon lithograph (Kollwitz): heavy dark masses, the stone's grain, faces and hands kept
  litho: { label: 'crayon lithograph', shape: { level: { default: 1.5, head: 0.7, hands: 0.6 } }, surface: { surface: 'skin', fade: 1, key: [-0.55, 0.62, 0.35] },
    medium: { kind: 'draw', draw: 3, ink: '#1a1613', paper: '#ece5d4', tone: [0.15, 0.08, 0.1, 0.18], local: [0.2, 0.62, 0.9, 0.5], hatch: [6, 1, 1, 0.002], levels: [0.16, 0.6, 0.95, 0], face: [0.2, 0.8, 0.3, 0.3], grain: [1.25, 0.3, 0.4, 0], paperK: [0.04, 0.05, 1.4] },
    line: { weight: 2.5, planes: 0, landmarks: 0.25, faceK: 1.0, landmarkSet: LMSET },
    fit: 'mid and crowd, still and motion: masses read at any size; the protest-poster register' },
  // (5) one bit: blue-noise dither on the body + contour (a deliberate graphic look; Obra Dinn without the swimming)
  dither: { label: '1-bit dither', shape: { level: { default: 1.2, head: 0.6, hands: 0.5 } }, surface: { surface: 'skin', fade: 1, key: [-0.75, 0.48, 0.45] },
    medium: { kind: 'draw', draw: 4, ink: '#141110', paper: '#efe8d6', tone: [0.05, 0.1, 0.16, 0.28], local: [0.2, 0.62, 0.9, 0.8], levels: [0.06, 0.92, 0, 0], face: [0.12, 0.8, 0.12, 0.35], grain: [1.0, 0, 0, 0] },
    line: { weight: 1.5, planes: 0, landmarks: 0.25, faceK: 0.9, landmarkSet: LMSET },
    fit: 'mid shot and feed (270 px): a strong key reads small; close-ups show the dot' },
  // (4) ligne claire: uniform contour, flat clean colour, interior lines only at the landmarks (Herge's clarity)
  ligne: { label: 'ligne claire', shape: SHAPE1, surface: { surface: 'skin', fade: 1, key: [-0.6, 0.55, 0.5] },
    medium: { kind: 'draw', draw: 5, ink: '#17130f', paper: '#f2ecdc', levels: [0, 0, 0, 0], ground: false },
    line: { weight: 1.6, uniform: true, planes: 0, landmarks: 0.3, faceK: 0.95, landmarkSet: LMSET },
    fit: 'every size, still and motion; the cheapest; reads at 270 px' },
};
// the control for the motion test: the hatch with its marks fixed to the SCREEN (what swimming looks like, measured)
export const DRAW_CONTROLS = {
  debug: { ...DRAW_STYLES.hatch, label: 'debug: R tone, G light, B fibre', medium: { ...DRAW_STYLES.hatch.medium, draw: 9, ground: false }, line: null }, hatchScreen: { ...DRAW_STYLES.hatch, label: 'hatch, screen-space (control)', screen: true } };
