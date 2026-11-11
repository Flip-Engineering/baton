// THE GRAPHIC LOOKS (the PERSON_PIPELINE ladder's top rung), made from the realistic person by one chained material pass and GPU passes only
// (stage.js; glsl.js). ONE CURRENT RECIPE PER LOOK (8 Oct, the client: 'stop retaining duplicate copies of superseded work'): every earlier
// revision of a look (STYLE c3-c5's keys, rev 7b / 7c / 7e controls) is deleted; git history is the only record (the last tree that had them:
// review/studio_human_c8/after/style6/NOTES.md, Log 8 Oct ~17:30). Recipes in lane E's form (shape, surface, line, medium); medium.kind
// 'graphic' (medium.gx the approach), 'montage' or 'newsreel':
//   stencil7            spray stencil, CUT: each surface its two flat layers (its light layer by its own value; inside the shadow, smoothed over
//                       the form, one darker; skin its own light and mid inks), clean edges, the key line on the dark layer, overspray only at
//                       the cut, a plain wall (the WPA's silkscreens and stencils)
//   sovietPoster7       Soviet poster AS A FOUR-INK LITHOGRAPH (the Stenbergs, Lebedev, Deineka; it8's measurer: it replaced the flat-colour
//                       poster, 8 Oct 18:48): paper, red, blue, black and each person's own skin inks; cloth planes cut once over the owner
//                       garment; dark and brown hair one black mass with a lit crescent (blue / red), light hair paper; one weight of line;
//                       the black overprinting 3 px off the colour plates; the ink on its paper (WEAR_FS: the paper's tooth, a fine grain,
//                       salt in the open middle of a shape, clean edges; rev 7e.2, under measurement: NOTES 'Iteration 9')
//   celShadow7          cel animation: flat local colour, a cool shadow shape and a light shape, a thin line, a painted sky and floor
//   ligneClaire7        ligne claire: the person's flat colours, one pale shadow on the far side, a uniform black line, a pale sky over sand
//   notan7Red           Dow's notan in three values (paper, a warm mid, ink) on a red disc: one class darker in the smoothed shadow,
//                       separation lines where two shapes of one value meet (the woodcut's and the Stenbergs' white line); THE VALUE PLAN (it10,
//                       under measurement): each person's hair and garments given the classes that keep the shapes that meet apart (the
//                       face and hands off the collar and the cloth, a jacket off its jeans), each as near its own value as that allows; the
//                       skin never moved (stage.js notanPlan); THE SKIN'S LIT PLANE (it11, under measurement): where the skin's form faces
//                       the key (within ~45 degrees) it steps up one class (deep skin mid to paper), the ink shadow only where it turns away
//   montage7            constructivist photomontage, the lit person cut out (the seams left in), printed through a clean 6 px screen (a finer
//                       2.5 px AM print on skin and hair), the printer's dodge on each face (Klutsis, Rodchenko, Heartfield)
//   montage7Gravure     the same cut-out in continuous tone (the gravure prints), the dodge
//   lino, riso5, chalk, mural5, washWet, newsreel, pressPhoto5: the other looks (each its only current revision; not yet worked against
//                       a master sheet in round 7)
// Every look that reads a sewn wardrobe (K4 / CLOTH bakes: userData.k3) gets the LAYER RESOLVE (medium.layers [skin m, per rank m]: covered
// skin pushed back 6 mm in depth only, each inner garment 3 mm a rank, so a shard a few mm through the cloth loses the depth test; lines
// and shapes do not move). The cloth-hole fill (rev 7c) is deleted: its it3 measurement found it cleared specks and bit belts, throats and
// hair edges, and never reached the holes that showed (CLOTH's to close at the source).
//
//   import { GRAPHIC_STYLES, GRAPHIC_CONTROLS, GraphicStage } from '../lib/fx/style/graphic/index.js';
//   const stage = new GraphicStage({ width, height, recipes: { ...GRAPHIC_STYLES, ...GRAPHIC_CONTROLS } });
//   const P = await makePerson('L08_f24_hispanic', { studio });                          // the current person
//   await stage.render(ctx, 'stencil7', { scene, camera, rig, heroes: [P.h], people: [P], sunDir });
//   faceMarks(ctx, heroes, camera, { color })   // faces.js: designer marks on faces under ~90 px, after ANY stage (GraphicStage does it)
//   clothPhases(h)                              // cloth.js: the hatch follows the fabric (its pattern uv), opt-in per hero
// medium: { gx, c0..c3 (inks, display hex), bg, bg2, tone [terminator, softness, ambient, reflected], local [floor, white, gamma, turn],
// face [face lift, hand lift, face modelling, painted-on hair kept], spacing (px at a 1080-tall full figure), wobble (m), stroke (m),
// p1, p2 (per kind: glsl.js), k0..k2, x0..x2 (per kind: stage.js composite), band (ground line, x H), disc (the poster's / riso's disc,
// x figure), ss (supersampling), flat2 [shadow smoothing m, fold half-width x the line, fold weight on cloth, light shape smoothed],
// hairMass, hairR (the designed hair mass's radius m), hair5 / hairBand / hairHi (the designed hair's light), layers (the resolve) };
// line: { weight px at 1080 tall, hem k, crease k, ink, faceK, faceNose, uniform, print }. surface.key: the designed key in VIEW space.
export { GraphicStage, installGraphic, ownerOf, hairFlatOf, notanPlan } from './stage.js';
export { GX_U, patchGraphic } from './glsl.js';
export { faceMarks } from './faces.js';
export { clothPhases } from './cloth.js';

const LAYERS = [0.006, 0.003];   // the layer resolve: skin 6 mm, 3 mm a rank (a hand in a pocket lies ~3-5 mm behind the cloth)
const HAIR = { ss: 2, hairMass: 8, hairR: 0.007, face: [0.3, 0.25, 0.35, 1] };   // ss 2, the designed hair mass; face.w: hair painted on the scalp kept as hair
const MONTAGE = { kind: 'montage', meter: 'face', mode: 0, c0: '#151312', c1: '#c4261d', c2: '#ece3cf', c3: '#f7f4ec', m1: [0.38, 0.11, 0.1, 0.85], m2: [0, 0, 0, 0.35],
  ortho: [0.2, 0.6, 0.2, 0.2], hairR: 0.008, hairMass: 8, layers: LAYERS };
const MONTAGE_FIT = 'calls to action, title cards, the organiser\'s poster: Klutsis, Rodchenko, Heartfield; the red band and the foot block take type; still and motion (the cut-out rides the person)';
// x1 [on, plane radius m, the planes' terminator, registration px at 1080]; x2 [on, the cut's radius m, the hair's lit crescent m, the ground's
// paper margin px]; wear [the paper's tooth, the ink's grain, its salt, the reach of a shape's edge px at 1080] (stage.js PLANE_FS, CUT_FS, WEAR_FS)
const POSTER = { label: 'Soviet poster (four-ink print)', surface: { key: [-0.72, 0.5, 0.45] },
  medium: { kind: 'graphic', gx: 'flat', c0: '#151211', c1: '#c4261d', c2: '#efe4cc', c3: '#b9837a', bg: '#22437c', bg2: '#c4261d', tone: [0.08, 0.02, 0, 0], p1: [0.8, 0.03, 0, 0], p2: [0.62, 1.12, 0, 0.6],
    k0: [0, 0, 0.32, 0], k2: [0, 0, 0, 0], ...HAIR, flat2: [0.03, 0.42, 0.75, 1], hair5: [0.1, 0.9, 0, 0.04], hairBand: 0.045, hairHi: ['#d8c6a6', 0.2], layers: LAYERS,
    ex: [1, 0, 0, 0], x1: [1, 0.07, 0.08, 3.0], x2: [1, 0.012, 0.025, 5], wear: [0.05, 0.06, 0.45, 2.5] },
  line: { weight: 4.0, hem: 0.7, crease: 0, faceK: 1.0, faceNose: 1, print: 0.004 },
  fit: 'title cards, calls to action, heroic single figures, pairs and crowds: four flat inks that read at feed size (the Stenbergs, Lebedev, Deineka)' };

export const GRAPHIC_STYLES = {
  // ---- the looks worked against the named masters (STYLE c6, round 7)
  stencil7: { label: 'spray stencil', surface: { key: [-0.72, 0.5, 0.48] },
    medium: { kind: 'graphic', gx: 'stencil', c0: '#151414', c1: '#b81d1d', c2: '#efe9dc', c3: '#8a7a6c', bg: '#cbc5b8', tone: [0.04, 0.05, 0.2, 0.18], local: [0.1, 0.62, 1.35, 0.35],
      face: [0.06, 0.1, 0.5, 1], k1: [0.5, 0.74, 1, 0], k2: [1, 0.18, 0.66, 0.12], faceInk: '#151414', ex: [1, 0, 0, 0], x0: [1, 1.05, 0.75, 0],
      layers: LAYERS, ss: 2, hairMass: 8, hairR: 0.007, flat2: [0.04, 0, 0, 0], x1: [1, 5, 0.35, 0] },
    line: { weight: 1.3, hem: 0, crease: 0, faceNose: 1 },
    fit: 'street and strike graphics: full figure and crowd at any size (two flat layers a surface read at 270 px); titles and transitions on a wall' },
  sovietPoster7: POSTER,
  celShadow7: { label: 'cel animation', surface: { key: [-0.55, 0.58, 0.6] },
    medium: { kind: 'graphic', gx: 'flat', c0: '#2b201c', c3: '#8e90b5', bg: '#cdd6d8', bg2: '#bbb09a', tone: [0.1, 0.015, 0, 0], p1: [0.82, 0.0, 0.32, 1], p2: [0, 1.08, 0.8, 0.6],
      k0: [0, 0, 0, 1], ...HAIR, flat2: [0.025, 0.4, 0.75, 1], hair5: [0.05, 0.88, 0, 0.05], hairBand: 0.05, hairHi: ['#ffffff', 0.26], layers: LAYERS },
    line: { weight: 1.7, hem: 0.6, crease: 0, ink: '#2b201c', faceNose: 1 },
    fit: 'narrative and explainer animation, every size, motion first (the shadow shapes ride the form); the friendliest register' },
  ligneClaire7: { label: 'ligne claire', surface: { key: [-0.5, 0.6, 0.62] },
    medium: { kind: 'graphic', gx: 'flat', c0: '#1a1614', c3: '#c9c6d8', bg: '#d6e2e2', bg2: '#d7cbb0', tone: [-0.3, 0.015, 0, 0], p1: [0.9, 0.04, 0, 0], p2: [0, 1.15, 0, 0.6],
      k0: [0, 0, 0, 1], ...HAIR, flat2: [0.03, 0.4, 0.8, 1], hair5: [-0.25, 0.9, 0, 0.04], hairBand: 0.045, hairHi: ['#ffffff', 0.18], layers: LAYERS },
    line: { weight: 1.7, hem: 0.85, crease: 0, ink: '#1a1614', uniform: true, faceK: 1.0, faceNose: 1 },
    fit: 'explainers and narrative animation (Herge\'s clarity): every size, motion first; clean flat colour that takes titles and maps beside it' },
  // medium.comp 'notan': the composite kind over the flat pass; x1 [light-skin value, dark-cloth value, light-cloth value, separation reach x the line]
  // plan: 1 the value plan (stage.js notanPlan; it10: the A/B control without it is GRAPHIC_CONTROLS.notan7RedP0, deleted when the measurer rules)
  // lit: 1 the skin's lit plane (it11; needs the plan): the style pass's light shape (p1.w 1) where N.key > p2.z (0.707: within 45 degrees of the
  // key, on the smooth normal), smoothed over the surface like the shadow; the A/B control without it is GRAPHIC_CONTROLS.notan7RedL0
  notan7Red: { label: 'notan, three values', surface: { key: [-0.72, 0.5, 0.42] },
    medium: { kind: 'graphic', gx: 'flat', comp: 'notan', c0: '#151110', c2: '#f1e7d2', c3: '#9c8670', bg2: '#c4261d', tone: [0.05, 0.02, 0, 0],
      p1: [0.8, 0, 0, 1], p2: [0, 1, 0.707, 0.6], ss: 2, hairMass: 8, hairR: 0.009, face: [0.3, 0.25, 0.35, 1], flat2: [0.05, 0, 0, 0], hair5: [0.12, 2, 0, 0],
      x1: [0.45, 0.25, 0.56, 0.7], disc: 1, k2: [0, 0, 0, 1], layers: LAYERS, plan: 1, lit: 1 },
    line: { weight: 2.4, hem: 0, crease: 0, faceK: 1.0, faceNose: 1 },
    fit: 'title cards, feed thumbnails and crowds: the figure as three values that read at 120 px (Dow\'s notan; the Stenbergs\' and Catlett\'s cut shapes)' },
  // m0 [paper margin px, its shadow px, screen cell px at 1080, the screen rides the cut-out]; m3 [1 clean screen | 2 gravure, the screen's floor px,
  // the paper's tooth, the skin-and-hair print's floor px]; m4 [the dodge's target log-mean ortho luma, its largest gain, its share on the other
  // skin, the skin-and-hair print's cell x the body's]
  montage7: { label: 'photomontage, screen', medium: { ...MONTAGE, m0: [9, 7, 6, 1], m3: [1, 3.5, 0.5, 2.5], m4: [0.12, 4, 1, 0.45] }, fit: MONTAGE_FIT },
  montage7Gravure: { label: 'photomontage, gravure', medium: { ...MONTAGE, m0: [9, 7, 3.6, 1], m3: [2, 0, 0.5, 0], m4: [0.12, 4, 1, 0] }, fit: MONTAGE_FIT },
  // ---- the other looks (each its only current revision)
  lino: { label: 'linocut', surface: { key: [-0.78, 0.48, 0.4] },
    medium: { kind: 'graphic', gx: 'lino', c0: '#121010', c2: '#ede4cf', tone: [0.0, 0.07, 0.14, 0.22], local: [0.18, 0.6, 1.1, 0.75], face: [0.3, 0.2, 0.32, 0], p1: [0.26, 0.64, 0, 0],
      spacing: 13, wobble: 0.0018, stroke: 0.06, band: 0.012 },
    line: { weight: 2.6, hem: 0.55, crease: 0.4, faceK: 0.9 },
    fit: 'protest and labour films: mid shot to full figure, still and walking; the hand-cut print (Masereel, Catlett, the Taller de Grafica Popular)' },
  riso5: { label: 'risograph (red, blue, black)', surface: { key: [-0.7, 0.52, 0.48] },
    medium: { kind: 'graphic', gx: 'riso', c0: '#26211f', c1: '#e8483e', c2: '#f5f0e6', c3: '#3f6fb5', tone: [0.0, 0.1, 0.24, 0.25], local: [0.24, 0.62, 0.9, 0.7], face: [0.2, 0.15, 0.25, 1],
      p1: [1.0, 1.0, 6.0, 0.4], p2: [1, 0.8, 1, 0], k0: [2.6, -1.4, -0.8, 1.2], k1: [6.0, 0, -1.7, 2.1], k2: [0, 0, 0, 1], disc: 1, ex: [0, 0, 1, 0.08] },
    line: { weight: 1.8, hem: 0.5, crease: 0.35 },
    fit: 'zines, explainers, event and campaign graphics; mid shot to full figure; the dots read from bust size up, the misregistration at any size' },
  chalk: { label: 'chalk on blackboard', surface: { key: [-0.62, 0.58, 0.45] },
    medium: { kind: 'graphic', gx: 'chalk', c0: '#29332e', c2: '#f1efe6', tone: [0.0, 0.12, 0.12, 0.3], local: [0.12, 0.62, 1.3, 0.8], face: [0.22, 0.2, 0.3, 0],
      p1: [0.48, 0.72, 0.95, 0], p2: [1, 0.22, 0.5, 0.45], spacing: 8.0, stroke: 0.07, wobble: 0.002, faceInk: '#29332e' },
    line: { weight: 2.3, ink: '#e4e1d6', hem: 0.45, crease: 0.3 },
    fit: 'political education: the lecture, the study circle, the explainer; mid shot to full figure; the board can carry diagrams and words' },
  mural5: { label: 'mural', surface: { key: [-0.66, 0.56, 0.48] },
    medium: { kind: 'graphic', gx: 'mural', c0: '#3b2719', bg: '#e0b874', bg2: '#8a5a36', tone: [0.0, 0.06, 0.34, 0.3], local: [0.24, 0.62, 0.9, 0.7], face: [0.15, 0.1, 0.2, 1],
      p1: [0.85, 0.22, 0.35, 0.07], p2: [0.12, 0, 0, 0], spacing: 10, wobble: 0.002, ss: 2, hairMass: 8, hairR: 0.006, x0: [380, 0, 0, 0] },
    line: { weight: 4.0, hem: 0.6, crease: 0, ink: '#3b2719', faceK: 0.9, faceNose: 1 },
    fit: 'the mural and the painted banner: labour as monument, history panels, title walls; mid shot to full figure and groups, still and motion' },
  washWet: { label: 'watercolour', surface: { key: [-0.62, 0.55, 0.55] },
    medium: { kind: 'graphic', gx: 'wash', c0: '#3a2f28', c2: '#f4efe4', c3: '#8f8db3', bg: '#c9d9e4', tone: [0.12, 0.03, 0, 0], face: [0.25, 0.2, 0.3, 1],
      p1: [-0.3, 0.72, 0.55, 0.7], p2: [0, 0.28, 0.16, 0], k0: [0.55, 0.5, 1.6, 0.16], k1: [0.2, 0.32, 0, 0], faceInk: '#4a3a30', hairMass: 8, hairR: 0.006, ex: [0, 1, 1, 1], x0: [0, 1, 7, 1] },
    line: { weight: 1.0, hem: 0.35, crease: 0.25, ink: '#5a4636', faceK: 0.8 },
    fit: 'illustration and gentle narrative: community, care, memory, the kitchen table and the clinic; mid shot to full figure; still and slow motion' },
  newsreel: { label: 'newsreel (B&W film)', medium: { kind: 'newsreel', meter: 'face', ortho: [0.2, 0.6, 0.2, 1.15], film: [0.8, 0.5, 0.06, 0.07], print: [0.32, 0, 0.6, 0], tint: [1, 0.985, 0.95] },
    fit: 'archive and history registers, "the camera was there": strikes, meetings, marches; the lit people at any size, motion first (the grain and weave live in time)' },
  pressPhoto5: { label: 'press photograph, retouched', medium: { kind: 'montage', meter: 'face', mode: 1, c0: '#1a1817', c2: '#e9e3d4', m0: [6, 0, 3.4, 0], m1: [0, 0, 0, 0.95], m2: [0, 0.95, 1, 0.3], ortho: [0.2, 0.6, 0.2, 0.2], hairR: 0.008, hairMass: 8 },
    fit: 'the newspaper clipping, the leaflet photo, the wanted poster: the background airbrushed out as the papers did; stills and slow pushes' },
};
// instruments, not looks: the style pass's channels shown directly (on the linocut's recipe)
export const GRAPHIC_CONTROLS = {
  // the notan's A/B switches (each removed when its measurer rules): it10's, the notan without the value plan (each surface's class from its own
  // value alone; and so without the lit plane, which reads the plan's channel), and it11's, the value plan without the skin's lit plane
  notan7RedP0: { ...GRAPHIC_STYLES.notan7Red, label: 'notan, three values (no value plan: the it10 control)', medium: { ...GRAPHIC_STYLES.notan7Red.medium, plan: 0, lit: 0 } },
  notan7RedL0: { ...GRAPHIC_STYLES.notan7Red, label: 'notan, three values (the plan, no lit plane: the it11 control)', medium: { ...GRAPHIC_STYLES.notan7Red.medium, lit: 0 } },
  debug: { ...GRAPHIC_STYLES.lino, label: 'debug: R tone, G light, B purity', medium: { ...GRAPHIC_STYLES.lino.medium, gx: 'debug' } },
  debugLocal: { ...GRAPHIC_STYLES.lino, label: 'debug: flat local colour', medium: { ...GRAPHIC_STYLES.lino.medium, gx: 'local' } },
  debugPhase: { ...GRAPHIC_STYLES.lino, label: 'debug: phases (R cross-contour, G along) / spacing', medium: { ...GRAPHIC_STYLES.lino.medium, gx: 'phase' } },
};
