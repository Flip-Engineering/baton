// WHO OWNS THE MACHINES? (machines_c11 = v4). Cycle 11: re-timed (opening 2.5 s, one stop, the turn on THE NATIONALIZATION, longer slogan and demand), the demand lands
// on people, posters printed through the same line screen, credits legible and consistent. Song: songs2/machines_c11.py (beats are the song's own). Below: the c6 notes.
// v5 (8 Oct, archive audit item 3): the same picture on the electronic score songs2/machines_e.py (same 120 BPM, same beats, lock b87.5); SCANSION c3 is now
// the default for the full piece (the cutdown, MACH_CUT, keeps v4's words; `?scan=v4` shows them here); the Chairman credit keeps v4's approved name form;
// in c3 the slogan's credit, the demand's flash and its rings start on WE DEMAND (b80), and v4's b79 cut is dropped (DEMAND, MOVE_C3).
// WHO OWNS THE MACHINES? (machines), cycle 6. Script: research/scripts_final/machines.json (42 frames, 120 BPM,
// lockup b87). Song: web/audio/songs2/machines.py. Footage: machines.bake.py -> sources/machines_c6/ (public-domain films,
// videos/sources/footage/CATALOG.md). Brief: videos/review/machines_c6/NOTES.md.
//
// The argument, each step in its source's words: the client's question (G2) over his own OWN THE FUTURE poster; the
// litany of machines (06's, with the Party's Port Newark truckers as picture text), AI one machine in the row; WE BUILD
// IT. (CL181) on real faces; Haz's purpose line; the one silence; Haz's profit-motive line, during which the line slows
// and on STOP the plant freezes grey; the Party's command line, on which the lever is thrown and the plant restarts in
// red; FULL REINDUSTRIALIZATION and the build-out; the Program's work week and laboring years on the client's JOIN
// banner; the question again; the Party's slogan on real faces; the client's demand whole on his red_ripples field;
// the rings close on the dot and it becomes the lockup.
//
// Looks (after Rivera's Detroit Industry, Klutsis's photomontage and Vertov's Enthusiasm):
//   poster  the client's two posters as photographic plates (2.5D push on the OWN THE FUTURE head, relit toward the dot)
//   line    B&W film printed as a burin line screen (black on cream, crosshatch in the darks); red: printed on red stock
//   heat    Technicolor steel printed in two plates: a black key line and an ACP-red dot plate from the hot metal
//   rings   red_ripples.png itself, with stipple ring systems born on the beats (the rebuilt AM stipple, anchored)
//   cold    the freeze: grey stock, grey ink, no red
// No scanlines, no RGB split. Type is Anton, sized by role, set into the composition (slabs, paper labels, sky).
import { W, H, loadFonts, loadImage, clamp, lerp, ease } from '../lib/kit.js';

const out = document.getElementById('out'); out.width = W; out.height = H;
const realCtx = out.getContext('2d'); let ctx = realCtx;
await loadFonts();
let HITS = null;
try { HITS = await (await fetch(`../../out/.${window.MACH_KEY || 'machines_c11'}.hits.json`)).json(); } catch (e) { console.log('machines: no hits.json; 120 BPM stand-in'); }
const BPM = HITS ? HITS.bpm : 120, SPB = 60 / BPM;
const CLOSE = 87.5, LOCK = 1.4;
window.DURATION = (window.MACH_CUT ? window.MACH_CUT.reduce((a, [b0, b1]) => a + b1 - b0, 0) : CLOSE) * SPB + LOCK;
const bt = b => b * SPB;
const eo = ease.outCubic, eio = ease.inOutCubic;

// ================================================================ the words (script words[], beat for beat)
// [beat, text, style, x, y, size, rot]  style: sky | slab | label | cold | quote | noun | huge
const CUES = [
  [0, 'WHO OWNS', 'sky', 90, 560, 230, 0], [2, 'THE MACHINES?', 'sky', 90, 560, 200, 0],
  [5, 'THE TRUCK.', 'slab', 540, 430, 220, -0.05],
  [9, 'THE FACTORY.', 'noun', 540, 1540, 210, 0],
  [12, 'THE POWER PLANT.', 'noun', 540, 1560, 170, 0],
  [14.5, 'THE STEEL MILL.', 'slab', 540, 1500, 190, 0.04],
  [17, 'THE AI.', 'noun', 540, 1560, 260, 0],
  [21, 'WE BUILD IT.', 'slab', 540, 1520, 230, -0.04],
  [24, 'WHAT AI', 'quote', 90, 1320, 190, 0], [26, 'IS ACTUALLY FOR', 'quote', 90, 1320, 150, 0],
  [28, 'AND WHAT PURPOSE', 'quote', 90, 1320, 150, 0], [30, 'GOVERNS IT.', 'quote', 90, 1320, 200, 0],
  [33, 'REPLACING ALL LABOR', 'label', 540, 1450, 150, -0.015], [35, 'WITH AI', 'label', 540, 1450, 190, -0.03],
  [36.5, 'WILL REQUIRE', 'label', 540, 1450, 170, -0.03], [38, 'COMMUNISM,', 'slab', 540, 1480, 210, -0.06],
  [40, 'AS THE SHORT-TERM COSTS', 'label', 540, 1450, 110, -0.03], [42, 'WILL BE TOO GREAT', 'label', 540, 1450, 135, -0.02],
  [43.5, 'TO BE JUSTIFIED', 'label', 540, 1450, 145, -0.01], [45, 'BY THE PROFIT MOTIVE.', 'cold', 540, 1470, 125, 0],
  [48, 'THE NATIONALIZATION', 'slab', 540, 1440, 130, -0.04], [49.5, 'OF ALL LARGE INDUSTRIES', 'slab', 540, 1440, 112, -0.04],
  [51, 'UNDER THE COMMAND', 'slab', 540, 1440, 150, -0.07], [52.5, "OF THE WORKERS' STATE.", 'slab', 540, 1440, 130, -0.07],
  [55, 'FULL', 'slab', 540, 1500, 300, -0.05], [56, 'REINDUSTRIALIZATION.', 'slab', 540, 1500, 140, -0.05],
  [58, 'CRANES.', 'noun', 540, 1560, 250, 0], [59, 'RAILS.', 'noun', 540, 1560, 250, 0],
  [60, 'SHIPS.', 'noun', 540, 1560, 250, 0], [61, 'FACTORIES.', 'noun', 540, 1560, 240, 0],
  [62, 'REDUCING', 'label', 540, 1500, 190, -0.02], [63, 'THE WORK WEEK', 'label', 540, 1500, 170, -0.02],
  [64.5, 'AND LABORING YEARS.', 'sky', 540, 400, 118, 0],
  [67, 'WHO OWNS', 'sky', 540, 380, 230, 0], [69, 'THE FUTURE?', 'sky', 540, 380, 220, 0],
  [72, 'THE FUTURE', 'slab', 540, 1500, 220, -0.05], [74, 'BELONGS TO', 'slab', 540, 1500, 220, -0.05],
  [76, 'THE WORKING CLASS.', 'slab', 540, 1500, 150, -0.05],
  [79, 'WE DEMAND', 'huge', 540, 460, 220, 0], [80.5, 'NOTHING LESS', 'huge', 540, 460, 190, 0],
  [82, 'THAN ALL', 'huge', 540, 460, 250, 0], [83.5, 'THAT EXISTS.', 'huge', 540, 460, 210, 0],
  [CLOSE, null],
];
// SCANSION c3 (1 Oct; the default from v5, 8 Oct; `?scan=v4` gives the v4 cues above, `?scan=c3` forces c3): the same words grouped by the song's phrases
// (engine/score/phrase.py on songs2/machines_c12.py: blocks at b24 Gm, b32 Bb (the surge), b36 Gm, b40 Asus, b45 the stop, b48 D) and
// timed by reading need (engine/score/split.py proposed; chosen by hand). A board is [beat, rows, 'board']: each row is a word cue
// with its own beat, all rows stay up until the next cue. Lower-case words are set in half-height type on the same baseline
// (Lissitzky's small function words; c2's flaps): they ride into the stressed word. Four meeting points with the music: COMMUNISM
// on the b36 turn, PROFIT MOTIVE on the stop (b45), THE NATIONALIZATION on the turn (b48), ALL THAT EXISTS. on b84. v5's score
// (songs2/machines_e.py) meets them on the same beats: b36 the harmony turns to C under the falling surge bass, b45 the pulse and the
// band cut dead to a cold low A, b48 the pulse restarts on B-flat with the kick four to the floor, b84 the arrival on an open D (no
// third) with the motif's answer; at b87.5 the band stops and the echo dissolves under the lockup. Elided from Haz's verbatim
// sentence: AND (WHAT PURPOSE GOVERNS IT.), the leading conjunction at a frame split (the client, 1 Oct), kept in the script JSON.
// Everything else floats over the groove.
const SCAN = new URLSearchParams(location.search).get('scan') || (window.MACH_CUT ? '' : 'c3');
const DEMAND = SCAN === 'c3' ? 80 : 79;              // WE DEMAND: the slogan's credit ends there, the demand's flash and rings begin there
const CUES_C3 = [
  ...CUES.filter(c => c[0] < 24),
  [24, [[24, 'WHAT AI', 'quote', 90, 1240, 190, 0], [24.5, 'IS ACTUALLY FOR', 'quote', 90, 1440, 150, 0]], 'board'],
  [28, [[28, 'WHAT PURPOSE', 'quote', 90, 1240, 170, 0], [28.5, 'GOVERNS IT.', 'quote', 90, 1440, 200, 0]], 'board'],
  [32, [[32, 'REPLACING ALL LABOR', 'label', 540, 1270, 150, -0.015], [33, 'with AI', 'label', 540, 1480, 190, -0.03]], 'board'],
  [35, [[35, 'WILL REQUIRE', 'label', 540, 1240, 120, -0.02], [36, 'COMMUNISM,', 'slab', 540, 1490, 230, -0.06]], 'board'],
  [40, [[40, 'as the SHORT-TERM COSTS', 'label', 540, 1150, 125, -0.03], [42, 'WILL BE TOO GREAT', 'label', 540, 1330, 135, -0.02],
        [43.5, 'to be JUSTIFIED', 'label', 540, 1530, 160, -0.01]], 'board'],
  [45, 'by the PROFIT MOTIVE.', 'cold', 540, 1470, 140, 0],
  [48, [[48, 'THE NATIONALIZATION', 'slab', 540, 1300, 130, -0.04], [49.5, 'of all LARGE INDUSTRIES', 'slab', 540, 1490, 125, -0.04]], 'board'],
  [51, [[51, 'UNDER THE COMMAND', 'slab', 540, 1300, 150, -0.07], [52.5, "of the WORKERS' STATE.", 'slab', 540, 1490, 140, -0.07]], 'board'],
  ...CUES.filter(c => c[0] >= 55 && c[0] < 62),
  [62, [[62, 'REDUCING', 'label', 540, 1280, 190, -0.02], [63, 'THE WORK WEEK', 'label', 540, 1470, 170, -0.02]], 'board'],
  [64.5, 'and LABORING YEARS.', 'sky', 540, 400, 124, 0],
  ...CUES.filter(c => c[0] >= 67 && c[0] < 79),
  [80, 'WE DEMAND', 'huge', 540, 460, 220, 0], [82, 'NOTHING LESS than', 'huge', 540, 460, 200, 0],
  [84, 'ALL THAT EXISTS.', 'huge', 540, 460, 210, 0],
  [CLOSE, null],
];
// small picture text: the Party's truckers and the source tags. [b0, b1, lines, style]
const CHAIR = ['HAZ AL-DIN', 'EXECUTIVE CHAIRMAN,', 'AMERICAN COMMUNIST PARTY'];     // the approved credit (the client, 1 Oct), kept in v5: tag() sets lines[0] as the name row, the card has the room, and the quote is his own @InfraHaz post, so the name helps people find him (HANDBOOK, Credit with care); the date stays in the script JSON
const TAGS = [
  [5.25, 9, ['PORT NEWARK, N.J.', '100s OF TRUCKERS SIGNED UP TO UNIONIZE', '@ACPMain, 21 JUL 2026'], 'strip'],
  ...(SCAN === 'c3' ? [[24, 32, CHAIR, 'cred'], [32, 40, CHAIR, 'cred']] : [[24, 33, CHAIR, 'cred'], [33, 38, CHAIR, 'cred']]),
  [62, 67, ['ACP PROGRAM'], 'cred'],
  [72, DEMAND, ["THE PARTY'S SLOGAN"], 'cred'],        // up as long as the slogan is
];

// ================================================================ the pictures, by beat
// [beat, kind, opts]. 'foot' reads sources/machines_c6/<shot>/ (24 fps): f0 first frame, sp speed, z zoom from/to.
const PICS = [
  [0, 'otf', { from: [150, 0, 1.0], to: [215, 70, 1.11], head: 0.018 }],
  [5, 'truck', {}],
  [9, 'foot', { shot: 'factory', look: 'line', z: [1.0, 1.1], ang: 0.35, pitch: 6 }],
  [12, 'foot', { shot: 'power', look: 'line', z: [1.05, 1.12], ang: -0.5, pitch: 6 }],
  [13.25, 'foot', { shot: 'pylons', look: 'line', z: [1.0, 1.06], ang: 0.2, pitch: 5.5, lv: [0.1, 0.72], lc: 0.25 }],
  [14.5, 'foot', { shot: 'mill', look: 'heat', z: [1.0, 1.1], ang: 0.3, pitch: 6, cy: 0.55, lv: [0.02, 0.8] }],
  [17, 'foot', { shot: 'dial', look: 'line', z: [1.0, 1.08], ang: 0.3, pitch: 5.5, sp: 0.85 }],
  [19, 'foot', { shot: 'wheel', look: 'line', z: [1.0, 1.1], ang: -0.35, pitch: 5.5, sp: 0.9 }],
  [21, 'foot', { shot: 'face_tool', look: 'line', z: [1.05, 1.1], ang: -0.35, pitch: 5 }],
  [22.5, 'foot', { shot: 'face_hul', look: 'heat', z: [1.1, 1.18], ang: 0.4, pitch: 5, cy: 0.42 }],
  [24, 'foot', { shot: 'hands', look: 'line', z: [1.0, 1.08], ang: 0.5, pitch: 5.5, cy: 0.52 }],
  [28, 'foot', { shot: 'lever', look: 'line', z: [1.05, 1.12], ang: -0.3, pitch: 5.5, f0: 52, sp: 0.12, cy: 0.45 }],
  [33, 'foot', { shot: 'interior', look: 'line', z: [1.0, 1.12], ang: 0.0, pitch: 6 }],
  [35, 'foot', { shot: 'overhead', look: 'line', z: [1.05, 1.1], ang: 0.6, pitch: 6 }],
  [36.5, 'foot', { shot: 'line', look: 'line', z: [1.0, 1.05], ang: -0.4, pitch: 6 }],
  [38, 'foot', { shot: 'tapper', look: 'heat', z: [1.0, 1.08], ang: 0.3, pitch: 6 }],
  [40, 'foot', { shot: 'line', look: 'line', z: [1.1, 1.14], ang: -0.4, pitch: 6, f0: 40, slow: [42, 45] }],
  [45, 'foot', { shot: 'stop', look: 'line', z: [1.05, 1.1], ang: 0.25, pitch: 6, f0: 8, sp: 0.9, freeze: 46.4 }],
  [48, 'foot', { shot: 'lever', look: 'line', z: [1.12, 1.2], ang: -0.3, pitch: 6, f0: 62, sp: 1.0, thaw: 48.35 }],
  [49.5, 'foot', { shot: 'flywheel', look: 'line', z: [1.3, 1.36], ang: 0.45, pitch: 6, f0: 1, sp: 0.8, cy: 0.36 }],
  [51, 'foot', { shot: 'flywheel', look: 'line', z: [1.0, 1.12], ang: 0.45, pitch: 6, f0: 22, spin: [0.6, 1.6] }],
  [55, 'foot', { shot: 'tap', look: 'heat', z: [1.0, 1.15], ang: 0.25, pitch: 6.5, cy: 0.5 }],
  [58, 'foot', { shot: 'cranes', look: 'heat', z: [1.05, 1.1], ang: 0.3, pitch: 6 }],
  [59, 'foot', { shot: 'rails', look: 'line', z: [1.05, 1.1], ang: -0.3, pitch: 6 }],
  [60, 'foot', { shot: 'ships', look: 'heat', z: [1.0, 1.08], ang: 0.3, pitch: 6 }],
  [61, 'foot', { shot: 'factory', look: 'line', z: [1.08, 1.14], ang: -0.25, pitch: 6, f0: 30 }],
  [62, 'foot', { shot: 'reduce', look: 'heat', z: [1.0, 1.06], ang: 0.3, pitch: 6.5 }],
  [63, 'foot', { shot: 'week', look: 'line', z: [1.05, 1.1], ang: -0.4, pitch: 5.5, cy: 0.45 }],
  [64.5, 'join', {}],
  [72, 'foot', { shot: 'f_foundry', look: 'line', z: [1.1, 1.16], ang: 0.4, pitch: 5, cy: 0.42, lv: [0.02, 0.7], sp: 0.5 }],
  [74, 'foot', { shot: 'f_rail', look: 'line', z: [1.1, 1.16], ang: -0.4, pitch: 5, cy: 0.34, lv: [0.03, 0.55], sp: 0.5 }],
  [76, 'foot', { shot: 'f_phone', look: 'heat', z: [1.1, 1.16], ang: 0.3, pitch: 5, cy: 0.4, sp: 0.5 }],
  [79, 'foot', { shot: 'glow1', look: 'line', z: [1.05, 1.12], ang: 0.3, pitch: 5, cy: 0.45, sp: 0.8 }],
  [80.5, 'foot', { shot: 'glow3', look: 'line', z: [1.05, 1.12], ang: -0.3, pitch: 5, cy: 0.45, sp: 0.8 }],
  [82, 'foot', { shot: 'f_profile', look: 'line', z: [1.1, 1.16], ang: 0.35, pitch: 5, cy: 0.45, sp: 0.6 }],
  [83.5, 'foot', { shot: 'line', look: 'line', z: [1.0, 1.1], ang: -0.4, pitch: 6, f0: 90, sp: 0.5, demand: true }],
  [CLOSE, 'lock', {}],
];
// in c3 the thesis's and the demand's cuts follow their frames: COMMUNISM lands on the hot metal (tapper), the demand on b80/82/84
// (glow3, f_profile, the line); v4's b79 cut to glow1 is dropped there, so THE WORKING CLASS. keeps f_phone until WE DEMAND (b80)
const MOVE_C3 = { 33: 32, 35: 34, 36.5: 35, 38: 36, 80.5: 80, 83.5: 84 };
if (SCAN === 'c3') {
  PICS.splice(PICS.findIndex(P => P[0] === 79 && P[2].shot === 'glow1'), 1);
  for (const P of PICS) if (MOVE_C3[P[0]] !== undefined) P[0] = MOVE_C3[P[0]];
}
const CUESX = SCAN === 'c3' ? CUES_C3 : CUES;
const at = (list, b) => { let r = list[0]; for (const x of list) if (b >= x[0]) r = x; return r; };
const nextStart = (list, b) => { for (const x of list) if (x[0] > b + 1e-6) return x[0]; return CLOSE + 4; };

// ================================================================ assets
const SRC = '../../sources/';
const [otfPlate, otfCut, joinPlate, ripples] = await Promise.all([
  loadImage(SRC + 'library/derived/client_own_future.plate.jpg'), loadImage(SRC + 'library/derived/client_own_future.cut.png'),
  loadImage(SRC + 'library/derived/client_join_banner.plate.jpg'), loadImage(SRC + 'red_ripples.png')]);
const OTF_CUT_BOX = [0, 1063];                      // imagelib manifest: where the cut sits on the plate
const OTF_DOT = [1003, 217];                        // the red dot on the OTF plate (px)
const JOIN_SUN = [796, 414];                        // the sun on the JOIN plate (px)
const RING_C = [[1216, 662, 120, 1], [1011, 803, 105, 1], [650, 1092, 190, 0], [903, 1296, 180, 0], [987, 1644, 150, 0],
  [620, 1689, 170, 0], [824, 1883, 130, 0], [841, 2063, 150, 0]];    // ring systems on red_ripples.png [x, y, R, solid]
const IDX = await (await fetch('../../sources/machines_c6/index.json')).json();
const parts = await Promise.all(['part_mark', 'part_eq', 'part_slash', 'part_acc'].map(k => loadImage(`../assets/${k}.png`)));
const tint = (img, col) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d');
  g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height); return c; };
const CREAM = '#F4E6D0', RED = '#C91F37', INK = '#120708', DOTRED = '#E53239';
const LOCKP = parts.map(p => tint(p, CREAM));

// film frames, fetched on demand into a small cache
const FC = new Map();
async function frame(shot, i) {
  const n = IDX[shot].n; i = clamp(Math.round(i), 0, n - 1);
  const k = shot + ':' + i;
  if (!FC.has(k)) {
    const blob = await (await fetch(`../../sources/machines_c6/${shot}/${String(i + 1).padStart(4, '0')}.jpg`)).blob();
    FC.set(k, await createImageBitmap(blob));
    if (FC.size > 10) { const [k0, v0] = FC.entries().next().value; if (v0.close) v0.close(); FC.delete(k0); }
  }
  return FC.get(k);
}

// ================================================================ the press (WebGL2): line / heat / rings / cold
const glc = document.createElement('canvas'); glc.width = W; glc.height = H;
const gl = glc.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
const VS = `#version 300 es
in vec2 p; out vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0., 1.); }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D tex; uniform vec2 res; uniform vec4 xf; uniform int mode;
uniform vec3 paper, ink, red; uniform float cold, pitch, ang, t, gam, redAmt, flash, lo, hi, lc;
uniform vec4 discs[24]; uniform vec2 dage[24]; uniform int nd; uniform float ringAmt;
in vec2 uv; out vec4 o;
float h21(vec2 p){ p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float luma(vec3 c){ return dot(c, vec3(.299, .587, .114)); }
// AM dot screen, anchored to the page (never re-seeded): coverage cv, cell s px, angle a
float dots(vec2 px, float cv, float s, float a){
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a)); vec2 q = R * px / s; vec2 f = fract(q) - 0.5;
  float r = sqrt(clamp(cv, 0., 1.)) * 0.72; float d = length(f);
  return smoothstep(r + 0.9 / s, r - 0.9 / s, d) * step(0.004, cv);
}
float ringDensity(float x, float rings, float solid, float age){
  float core = pow(clamp(1. - x, 0., 1.), .45);
  float rr = .5 + .5 * cos(x * rings * 6.2832 - 4. * age); rr = rr * rr * (3. - 2. * rr);
  float ringv = .25 + .75 * rr; if (solid > .5) ringv = x < .8 ? .97 : ringv;
  float halo = .18 * clamp((2.1 - x) / 1.1, 0., 1.) * clamp((x - .95) / .07, 0., 1.) * (.5 + .5 * rr);
  return clamp(core * ringv + halo, 0., 1.);
}
void main(){
  vec2 px = vec2(uv.x, 1. - uv.y) * res;
  vec2 suv = xf.xy + vec2(uv.x, 1. - uv.y) * xf.zw;
  vec3 c = mode == 2 ? texture(tex, suv).rgb : textureLod(tex, suv, 0.8).rgb;
  float fib = vnoise(px * vec2(0.08, 0.5)) * 0.5 + vnoise(px * 0.02) * 0.5;
  float boil = h21(px + floor(t * 12.) * 17.);
  vec3 pap = paper * (0.955 + 0.06 * fib) - 0.025 * boil;
  vec3 col;
  if (mode == 2) {
    col = c;
    float F = 0.;
    for (int i = 0; i < 24; i++) { if (i >= nd) break;
      vec4 D = discs[i]; float r = D.z * (1. - .7 * exp(-dage[i].x / .12));
      float x = length(px - D.xy) / max(r, 1.);
      F = max(F, ringDensity(x, D.w, dage[i].y, dage[i].x) * clamp(dage[i].x * 8., 0., 1.)); }
    float d = dots(px, F * ringAmt, 4.2, 0.3);
    col = mix(col, vec3(0.965, 0.91, 0.83), d);
  } else {
    vec3 cb = textureLod(tex, suv, 4.5).rgb;
    float L = luma(c), Lb = luma(cb);
    L = L + lc * (L - Lb);
    L = clamp((L - lo) / max(hi - lo, 0.05), 0., 1.);
    L = pow(L, gam);
    float cov = 1. - L;
    vec2 d = vec2(cos(ang), sin(ang));
    float s = dot(px, d) / pitch + 0.35 * Lb + 0.3 * sin(dot(px, vec2(-d.y, d.x)) * 0.004);
    float f = abs(fract(s) - 0.5) * 2.;
    float aa = 1.6 / pitch;
    float line = smoothstep(cov + aa, cov - aa, f);
    float s2 = dot(px, vec2(-d.y, d.x)) / (pitch * 0.9);
    float f2 = abs(fract(s2) - 0.5) * 2.;
    float hc = clamp((cov - 0.6) * 2.2, 0., 1.);
    float hatch = smoothstep(hc + aa, hc - aa, f2) * step(0.6, cov);
    float k = max(line, hatch);
    col = mix(pap, ink, k);
    if (mode == 1) {
      float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
      float hot = clamp((c.r - c.b) * 1.6 - 0.12, 0., 1.) * clamp(c.r * 1.3, 0., 1.);
      float rp = clamp(max(hot, sat * 0.6) * redAmt, 0., 1.);
      float rd = dots(px, rp, pitch * 1.15, 0.26);
      col = mix(col, col * red, rd * 0.95);
      float core = smoothstep(0.6, 0.9, luma(c)) * redAmt;
      col = mix(col, mix(pap, vec3(1.0, 0.86, 0.62), 0.5), core * 0.7);
    }
    vec3 grey = vec3(luma(col)) * vec3(0.93, 0.95, 0.98);
    col = mix(col, grey * 0.9 + 0.04, cold);
  }
  col = mix(col, vec3(0.965, 0.92, 0.84), flash);
  o = vec4(col, 1.);
}`;
function shd(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
const prog = gl.createProgram(); gl.attachShader(prog, shd(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shd(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
const pl = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
const U = {}; for (const n of ['tex', 'res', 'xf', 'mode', 'paper', 'ink', 'red', 'cold', 'pitch', 'ang', 't', 'gam', 'redAmt', 'flash', 'lo', 'hi', 'lc', 'discs', 'dage', 'nd', 'ringAmt']) U[n] = gl.getUniformLocation(prog, n);
const texo = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texo);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.viewport(0, 0, W, H);
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
let lastTex = null;
function press(img, o) {
  gl.bindTexture(gl.TEXTURE_2D, texo);
  if (lastTex !== img) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D); lastTex = img; }
  gl.uniform1i(U.tex, 0); gl.uniform2f(U.res, W, H); gl.uniform4f(U.xf, ...o.xf); gl.uniform1i(U.mode, o.mode);
  gl.uniform3f(U.paper, ...hex(o.paper || CREAM)); gl.uniform3f(U.ink, ...hex(o.ink || INK)); gl.uniform3f(U.red, ...hex(o.redInk || '#D02030'));
  gl.uniform1f(U.cold, o.cold || 0); gl.uniform1f(U.pitch, o.pitch || 6); gl.uniform1f(U.ang, o.ang || 0); gl.uniform1f(U.t, o.t || 0);
  gl.uniform1f(U.gam, o.gam || 1); gl.uniform1f(U.redAmt, o.redAmt ?? 1); gl.uniform1f(U.flash, o.flash || 0);
  gl.uniform1f(U.lc, o.lc ?? 0.85); gl.uniform1f(U.lo, o.lv ? o.lv[0] : 0.04); gl.uniform1f(U.hi, o.lv ? o.lv[1] : 0.92);
  const D = new Float32Array(96), A = new Float32Array(48);
  (o.discs || []).slice(0, 24).forEach((d, i) => { D.set(d.slice(0, 4), i * 4); A.set([d[4], d[5]], i * 2); });
  gl.uniform4fv(U.discs, D); gl.uniform2fv(U.dage, A); gl.uniform1i(U.nd, Math.min(24, (o.discs || []).length)); gl.uniform1f(U.ringAmt, o.ringAmt ?? 1);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return glc;
}
// a poster drawn on a scratch canvas, then printed through the same screen as the film (the opener, the truck, the sunset were smooth photographs among prints)
const sc = document.createElement('canvas'); sc.width = W; sc.height = H; const sctx = sc.getContext('2d');
let noGrain = false;
function printed(fn, o = {}) {
  const real = ctx; ctx = sctx; noGrain = true;
  try { fn(); } finally { ctx = real; noGrain = false; }
  lastTex = null;
  press(sc, { mode: 1, xf: [0, 0, 1, 1], pitch: 6.5, ang: 0.35, t: o.t || 0, lv: o.lv, lc: o.lc ?? 0.6, gam: o.gam || 1, redAmt: o.redAmt ?? 1, paper: o.paper, flash: o.flash || 0 });
  ctx.drawImage(glc, 0, 0);
}
// a 3:4 source cropped to the 9:16 frame, zoom z about (cx, cy) in source uv
function xform(sw, sh, z, cx = 0.5, cy = 0.5) {
  const wu = (W / H) * (sh / sw) / z, hu = 1 / z;
  const x0 = clamp(cx - wu / 2, 0, 1 - wu), y0 = clamp(cy - hu / 2, 0, 1 - hu);
  return [x0, y0, wu, hu];
}

// ================================================================ type
// c3: a lower-case word is set at SMALL of the line's size on its baseline (all-caps text draws exactly as before)
const SMALL = 0.56;
const segs = text => text.split(' ').map(w => ({ w: w.toUpperCase(), small: w !== w.toUpperCase() }));
const spaceW = size => { ctx.font = `${size}px "Anton"`; return ctx.measureText(' ').width; };
function mixW(text, size) {
  const sp = spaceW(size), ss = segs(text); let w = 0;
  ss.forEach((g, i) => { ctx.font = `${g.small ? size * SMALL : size}px "Anton"`; w += ctx.measureText(g.w).width + (i ? sp * (g.small || ss[i - 1].small ? 0.8 : 1) : 0); });
  return w;
}
function mixFill(text, size, x0, y0, stroke) {
  const sp = spaceW(size), ss = segs(text), align = ctx.textAlign;
  ctx.textAlign = 'left';
  let x = align === 'center' ? x0 - mixW(text, size) / 2 : x0;
  ss.forEach((g, i) => { if (i) x += sp * (g.small || ss[i - 1].small ? 0.8 : 1); ctx.font = `${g.small ? size * SMALL : size}px "Anton"`;
    if (stroke) ctx.strokeText(g.w, x, y0); else ctx.fillText(g.w, x, y0); x += ctx.measureText(g.w).width; });
  ctx.textAlign = align; ctx.font = `${size}px "Anton"`;
}
const mixed = text => text !== text.toUpperCase();
function fit(text, size, maxW) { if (mixed(text)) { const w = mixW(text, size); return w > maxW ? size * maxW / w : size; }
  ctx.font = `${size}px "Anton"`; const w = ctx.measureText(text).width; return w > maxW ? size * maxW / w : size; }
const fillT = (text, x, y, s) => (mixed(text) ? mixFill(text, s, x, y) : ctx.fillText(text, x, y));
const strokeT = (text, x, y, s) => (mixed(text) ? mixFill(text, s, x, y, true) : ctx.strokeText(text, x, y));
const widthT = (text, s) => (mixed(text) ? mixW(text, s) : ctx.measureText(text).width);
function word(c, age) {
  const [, text, style, x, y, size0, rot] = c;
  if (!text) return;
  const pop = 1 + 0.06 * Math.exp(-age / 0.05);
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0); ctx.scale(pop, pop);
  ctx.textBaseline = 'alphabetic';
  if (style === 'sky') {
    const s = fit(text, size0, 900); ctx.font = `${s}px "Anton"`;
    ctx.textAlign = x < 300 ? 'left' : 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 30; ctx.fillStyle = CREAM; fillT(text, 0, 0, s);
  } else if (style === 'slab' || style === 'label' || style === 'cold') {
    const s = fit(text, size0, 920); ctx.font = `${s}px "Anton"`; ctx.textAlign = 'center';
    const w = widthT(text, s), cap = s * 0.74, px = 38, py = s * 0.2;
    ctx.fillStyle = style === 'slab' ? RED : style === 'cold' ? '#d9d6cf' : CREAM;
    ctx.beginPath(); ctx.moveTo(-w / 2 - px - 14, -cap - py); ctx.lineTo(w / 2 + px + 14, -cap - py); ctx.lineTo(w / 2 + px, py); ctx.lineTo(-w / 2 - px, py); ctx.fill();
    if (style !== 'cold') { ctx.fillStyle = style === 'slab' ? INK : RED; ctx.fillRect(-w / 2 - px, py, w + 2 * px, 10); }
    ctx.fillStyle = style === 'slab' ? CREAM : INK; fillT(text, 0, 0, s);
  } else if (style === 'quote') {
    const s = fit(text, size0, 900); ctx.font = `${s}px "Anton"`; ctx.textAlign = 'left';
    const w = widthT(text, s), cap = s * 0.74;
    ctx.fillStyle = CREAM; ctx.fillRect(-26, -cap - 26, w + 52, cap + 52);
    ctx.fillStyle = RED; ctx.fillRect(-26, -cap - 26, 12, cap + 52);
    ctx.fillStyle = INK; fillT(text, 0, 0, s);
  } else if (style === 'noun') {
    const s = fit(text, size0, 940); ctx.font = `${s}px "Anton"`; ctx.textAlign = 'center';
    ctx.lineJoin = 'round'; ctx.lineWidth = s * 0.07; ctx.strokeStyle = INK; ctx.strokeText(text, 0, 0);
    ctx.fillStyle = CREAM; ctx.fillText(text, 0, 0);
  } else if (style === 'huge') {
    const s = fit(text, size0, 960); ctx.font = `${s}px "Anton"`; ctx.textAlign = 'center';
    ctx.lineJoin = 'round'; ctx.lineWidth = s * 0.06; ctx.strokeStyle = INK; strokeT(text, 0, 0, s);
    ctx.fillStyle = CREAM; fillT(text, 0, 0, s);
  }
  ctx.restore();
}
function tag(T, beat) {
  const [b0, b1, lines, style] = T; if (beat < b0 || beat >= b1) return;
  ctx.save(); ctx.globalAlpha = clamp((beat - b0) / 0.4) * clamp((b1 - beat) / 0.3); ctx.textBaseline = 'alphabetic';
  if (style === 'strip') {
    ctx.translate(540, 1480); ctx.rotate(-0.03);
    ctx.fillStyle = CREAM; ctx.fillRect(-470, -150, 940, 300);
    ctx.fillStyle = RED; ctx.fillRect(-470, -150, 940, 16);
    ctx.fillStyle = INK; ctx.textAlign = 'left';
    ctx.font = '96px "Anton"'; ctx.fillText(lines[0], -430, -30);
    ctx.font = '47px "Anton"'; ctx.fillText(lines[1], -430, 38);
    ctx.font = 'bold 42px "Plex Mono"'; ctx.fillStyle = '#7a1620'; ctx.fillText(lines[2], -430, 100);
  } else {
    // the credit: a title card at the foot, set to be read at phone width (the name in Anton, the title in mono at 40 px)
    const name = lines[0], sub = lines.slice(1);
    ctx.translate(64, 1630);
    ctx.font = '64px "Anton"'; let w = ctx.measureText(name).width;
    ctx.font = 'bold 40px "Plex Mono"'; for (const l of sub) w = Math.max(w, ctx.measureText(l).width);
    const h = 64 + 18 + sub.length * 50 + 14;
    ctx.fillStyle = INK; ctx.fillRect(-18, -66, w + 36, h + 18);
    ctx.fillStyle = RED; ctx.fillRect(-18, -66, 10, h + 18);
    ctx.textAlign = 'left'; ctx.fillStyle = CREAM; ctx.font = '64px "Anton"'; ctx.fillText(name, 0, 0);
    ctx.font = 'bold 40px "Plex Mono"'; ctx.fillStyle = '#F4E6D0';
    sub.forEach((l, k) => ctx.fillText(l, 0, 52 + k * 50));
  }
  ctx.restore();
}

// ================================================================ pictures
const NOISE = [0, 1, 2, 3].map(k => { const c = document.createElement('canvas'); c.width = 540; c.height = 960; const g = c.getContext('2d');
  const id = g.createImageData(540, 960); let x = 1234567 + k * 7919;
  for (let i = 0; i < id.data.length; i += 4) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; const v = 128 + ((x >>> 0) % 110) - 55; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  g.putImageData(id, 0, 0); return c; });
function grain(t, amt = 0.06) {
  if (noGrain) return;
  ctx.save(); ctx.globalAlpha = amt; ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(NOISE[Math.floor(t * 12) % NOISE.length], 0, 0, W, H); ctx.restore();
}
// the rim on the OTF head, lit from the dot (upper right): alpha minus alpha shifted away from the light
const RIM = (() => { const c = document.createElement('canvas'); c.width = otfCut.width; c.height = otfCut.height; const g = c.getContext('2d');
  g.drawImage(otfCut, 0, 0); g.globalCompositeOperation = 'destination-out'; g.drawImage(otfCut, -5, 6);
  g.globalCompositeOperation = 'source-in'; g.fillStyle = '#ff5a4a'; g.fillRect(0, 0, c.width, c.height); return c; })();
function dot(x, y, r, halo = 0.5) {
  const g = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 4);
  g.addColorStop(0, `rgba(229,50,57,${halo})`); g.addColorStop(1, 'rgba(229,50,57,0)');
  ctx.fillStyle = g; ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
  ctx.fillStyle = DOTRED; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
function drawOTF(u, o, beat, t) {
  const z = lerp(o.from[2], o.to[2], u), wx = lerp(o.from[0], o.to[0], u), wy = lerp(o.from[1], o.to[1], u);
  const k = H / 1700 * z;
  ctx.fillStyle = '#1a1c1b'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(otfPlate, -wx * k, -wy * k, otfPlate.width * k, otfPlate.height * k);
  const hk = k * (1 + o.head * u);                        // the head a touch nearer (2.5D), scaled about the collar
  const ax = OTF_CUT_BOX[0] + 620, ay = OTF_CUT_BOX[1] + 637;
  const sx = (ax - wx) * k, sy = (ay - wy) * k;
  const hx = sx - (ax - OTF_CUT_BOX[0]) * hk, hy = sy - (ay - OTF_CUT_BOX[1]) * hk;
  ctx.drawImage(otfCut, hx, hy, otfCut.width * hk, otfCut.height * hk);
  ctx.save(); ctx.globalAlpha = 0.45 + 0.2 * Math.sin(t * 3); ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(RIM, hx, hy, otfCut.width * hk, otfCut.height * hk); ctx.restore();
  const pulse = 1 + 0.1 * Math.exp(-(((beat >= 3 ? beat - 3 : beat)) * SPB) / 0.25);
  dot((OTF_DOT[0] - wx) * k, (OTF_DOT[1] - wy) * k, 13 * k * pulse, 0.6);
  grain(t, 0.07);
}
function drawTruck(u, beat, t) {
  const z = lerp(1.25, 1.42, eio(u)), k = H / 1700 * z;
  const wx = lerp(1010, 1060, u), wy = lerp(260, 430, u);
  ctx.fillStyle = '#1a1c1b'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(otfPlate, -wx * k, -wy * k, otfPlate.width * k, otfPlate.height * k);
  const on = clamp((beat - 8) / 0.3) * (0.8 + 0.2 * Math.sin(t * 20));
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (const [px, py, r] of [[1185, 1000, 70], [1330, 780, 40]]) {
    const x = (px - wx) * k, y = (py - wy) * k, g = ctx.createRadialGradient(x, y, 0, x, y, r * k);
    g.addColorStop(0, `rgba(255,190,120,${0.55 * on})`); g.addColorStop(1, 'rgba(255,120,60,0)'); ctx.fillStyle = g; ctx.fillRect(x - r * k, y - r * k, 2 * r * k, 2 * r * k);
  }
  ctx.restore();
  dot((OTF_DOT[0] - wx) * k, (OTF_DOT[1] - wy) * k, 13 * k, 0.5);
  grain(t, 0.07);
}
function drawJoin(u, beat, t) {
  // the JOIN ACP banner as a plate: it opens from a band to the full frame; from b70 the sun is relit into the dot
  const g = eio(clamp((beat - 64.5) / 7.5));
  const top = lerp(560, 0, g), bot = lerp(1330, H, g);
  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = RED; ctx.fillRect(0, bot - 4, W, H - bot + 4);
  const hgt = bot - top, k = Math.max(hgt / 724, W / 860) * lerp(1.0, 1.08, u);          // the banner's ACP badge (x < 240) stays out of frame
  const fx = clamp(lerp(650, JOIN_SUN[0] - 60, g), 240 + W / (2 * k), 1100 - W / (2 * k)), fy = clamp(lerp(380, JOIN_SUN[1] - 40, g), hgt / (2 * k), 724 - hgt / (2 * k));
  ctx.save(); ctx.beginPath(); ctx.rect(0, top, W, hgt); ctx.clip();
  const ox = W / 2 - fx * k, oy = (top + bot) / 2 - fy * k;
  ctx.drawImage(joinPlate, ox, oy, 1100 * k, 724 * k);
  const r = clamp((beat - 67) / 2);
  if (r > 0) { ctx.globalAlpha = r; dot(ox + JOIN_SUN[0] * k, oy + JOIN_SUN[1] * k, 21 * k, 0.8); ctx.globalAlpha = 1; }
  grain(t, 0.08);
  ctx.restore();
}
function ringDiscs(beat, mode) {
  const k = Math.max(W / ripples.width, H / ripples.height) * (mode === 'ai' ? lerp(1.0, 1.12, clamp((beat - 20) / 4)) : lerp(1.05, 1.3, clamp((beat - 81) / 6)));
  const ox = W / 2 - ripples.width * k * 0.47, oy = H / 2 - ripples.height * k * 0.55;
  const b0 = mode === 'ai' ? 20 : 81, D = [];
  RING_C.forEach(([x, y, R, s], i) => { const born = b0 + i * (mode === 'ai' ? 0.5 : 0.25); if (beat >= born) D.push([ox + x * k, oy + y * k, R * k * 1.05, s ? 7 : 9, (beat - born) * SPB, s]); });
  if (mode === 'all') {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 14; i++) { const x = 80 + rnd() * 920, y = 120 + rnd() * 1700, R = 70 + rnd() * 150, born = 81.5 + i * 0.36, rg = 6 + Math.floor(rnd() * 5), so = rnd() < 0.25 ? 1 : 0;
      if (beat >= born) D.push([x, y, R * lerp(1, 1.5, clamp((beat - born) / 4)), rg, (beat - born) * SPB, so]); }
  }
  return { k, ox, oy, D };
}
function drawRings(beat, t, mode) {
  const { k, ox, oy, D } = ringDiscs(beat, mode);
  const xf = [-ox / (ripples.width * k), -oy / (ripples.height * k), W / (ripples.width * k), H / (ripples.height * k)];
  press(ripples, { mode: 2, xf, discs: D, t, ringAmt: 1 });
  ctx.drawImage(glc, 0, 0);
  if (mode === 'all') dot(540, 1180, lerp(16, 60, eio(clamp((beat - 84) / 3))), 0.6);
}
async function drawFoot(o, beat, b0, b1, t) {
  const I = IDX[o.shot], lt = (beat - b0) * SPB, u = clamp((beat - b0) / (b1 - b0));
  const sp = o.sp ?? 1;
  let fi;
  if (o.slow) {
    const a = bt(o.slow[0] - b0), e = bt(o.slow[1] - b0);
    fi = (o.f0 || 0) + 24 * (lt < a ? lt : a + (e - a) * (1 - Math.pow(1 - clamp((lt - a) / (e - a)), 2)) / 2);
  } else if (o.spin) {
    const T = bt(b1 - b0); fi = (o.f0 || 0) + 24 * (o.spin[0] * lt + (o.spin[1] - o.spin[0]) * lt * lt / (2 * T));
  } else fi = (o.f0 || 0) + 24 * sp * lt;
  if (o.freeze && beat >= o.freeze) fi = (o.f0 || 0) + 24 * sp * bt(o.freeze - b0);
  if (o.spin) fi = fi % I.n;
  const img = await frame(o.shot, fi);
  const z = lerp(o.z[0], o.z[1], u);
  let cold = 0;                                                  // the one stop: the line goes grey as it slows (b42), the freeze is grey stock, grey ink; the lever (b48) throws it back to red
  if (beat >= 42 && beat < 48.35) cold = beat < 45 ? 0.55 * clamp((beat - 42) / 3) : beat < 46.4 ? lerp(0.55, 1, clamp((beat - 45) / 1.4)) : 1;
  if (o.thaw) cold = beat < o.thaw ? 1 : 0;
  const redStock = (beat >= 48.35 && beat < 62 && o.look === 'line') || !!o.demand;
  const flash = [48.35, 55, 58, 72, DEMAND].reduce((m, h) => Math.max(m, beat >= h ? Math.exp(-(beat - h) * SPB / 0.05) * 0.8 : 0), 0);
  press(img, { mode: o.look === 'heat' ? 1 : 0, xf: xform(img.width, img.height, z, 0.5, o.cy ?? 0.5), paper: redStock ? '#D42A3C' : CREAM,
    ink: o.red ? '#9E1426' : INK, pitch: Math.max(6.5, o.pitch), ang: o.ang, t, gam: redStock ? 0.72 : 1, cold, flash,
    lv: o.lv || (redStock ? [0.0, 0.78] : o.look === 'heat' ? [0.02, 0.72] : null), lc: o.lc ?? 0.5, redAmt: 1 });
  ctx.drawImage(glc, 0, 0);
}
// the demand lands on people: stipple rings (the client's red_ripples idea) born over the faces on each beat, then the plant, then the field goes to the lockup's red
function ringsOver(beat, t) {
  if (beat < DEMAND) return;
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  ctx.save(); ctx.lineCap = 'round';
  const cs = [[300, 1180, 150], [760, 900, 130], [200, 700, 110], [880, 1420, 120], [520, 1020, 160], [140, 1500, 100], [900, 560, 100], [600, 1560, 130]];
  cs.forEach(([x, y, R], i) => {
    const born = DEMAND + i * 0.55, age = (beat - born) * SPB; if (age < 0) return;
    const grow = 1 - Math.exp(-age / 0.5);
    for (let k = 0; k < 6; k++) {
      const r = R * (0.25 + k * 0.17) * (0.35 + 0.65 * grow), a = clamp(1 - k * 0.12) * clamp(age * 5) * (0.8 - 0.4 * clamp((age - 1.2) / 2));
      ctx.strokeStyle = `rgba(246,232,212,${a})`; ctx.lineWidth = 6; ctx.setLineDash([1, 12]);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    }
  });
  ctx.restore();
  const f = clamp((beat - 86.2) / 1.3);                             // the picture goes to the lockup's red, the dot rises at the lockup's own place
  if (f > 0) { ctx.save(); ctx.globalAlpha = eio(f); ctx.fillStyle = '#B81C30'; ctx.fillRect(0, 0, W, H); ctx.restore();
    dot(540, 1180, lerp(10, 60, eio(f)), 0.6); }
}

// ================================================================ the lockup: the rings close on the dot, the dot is the hub
function drawLockup(a, t) {
  ctx.fillStyle = '#B81C30'; ctx.fillRect(0, 0, W, H);
  const hL = 230, sc = hL / 291;
  const wM = 300 * sc, wE = 220 * sc, wS = 119 * sc, wA = 517 * sc, total = wM + wE + wS + wA;
  const x0 = W / 2 - total / 2, cy = 880;
  const hub = [x0 + 150 * sc, cy - hL / 2 + 148 * sc, 62 * sc];
  ctx.save();
  for (let i = 0; i < 9; i++) {
    const r = (1 - eio(clamp(a / 0.45))) * (900 - i * 70) + hub[2] * (1.2 + i * 0.15);
    ctx.strokeStyle = `rgba(246,232,212,${0.55 - i * 0.05})`; ctx.lineWidth = 5; ctx.setLineDash([2, 8]);
    ctx.beginPath(); ctx.arc(hub[0], hub[1], r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
  const u = eio(clamp(a / 0.3));
  { const x = lerp(540, hub[0], u), y = lerp(1180, hub[1], u), r = lerp(60, hub[2], u);
    const g = ctx.createRadialGradient(x, y, r, x, y, r * 2.6); g.addColorStop(0, 'rgba(60,4,10,0.85)'); g.addColorStop(1, 'rgba(60,4,10,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6); ctx.fillStyle = DOTRED; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  const mu = eo(clamp((a - 0.12) / 0.22));
  if (mu > 0) {
    ctx.save(); ctx.globalAlpha = mu; ctx.translate(hub[0], hub[1]); ctx.rotate((1 - mu) * -0.6); const ms = lerp(1.3, 1, mu); ctx.scale(ms, ms);
    ctx.drawImage(LOCKP[0], -150 * sc, -148 * sc, wM, hL); ctx.restore();
  }
  const P = [[LOCKP[1], x0 + wM, wE, 0.24], [LOCKP[2], x0 + wM + wE, wS, 0.3], [LOCKP[3], x0 + wM + wE + wS, wA, 0.36]];
  for (const [img, x, w, s0] of P) { const p = eo(clamp((a - s0) / 0.22)); if (p <= 0) continue;
    ctx.save(); ctx.globalAlpha = p; ctx.drawImage(img, x + (1 - p) * 160, cy - hL / 2, w, hL); ctx.restore(); }
  const pu = eo(clamp((a - 0.5) / 0.2));
  if (pu > 0) { ctx.save(); ctx.globalAlpha = pu; ctx.fillStyle = CREAM; ctx.font = '76px "Archivo Black"'; ctx.textAlign = 'center'; ctx.fillText('ACP.US', W / 2, 1190 + (1 - pu) * 20); ctx.restore(); }
  grain(t, 0.05);
}

// ================================================================ frame
// a cutdown (4 Oct: the couplet, WHO OWNS THE MACHINES? / WHO OWNS THE FUTURE?; scenes/machines_who.html sets window.MACH_CUT and MACH_KEY):
// output beats play these source-beat spans in turn; songs2/machines_cut.py splices the score the same way
const MCUT = window.MACH_CUT || null;
const cutBeat = ob => { let o = 0; for (const [b0, b1] of MCUT) { if (ob < o + (b1 - b0) || b1 === MCUT[MCUT.length - 1][1]) return b0 + (ob - o); o += b1 - b0; } return ob; };
window.renderFrame = async (tOut) => {
  const t = MCUT ? bt(cutBeat(tOut / SPB)) : tOut, beat = t / SPB;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const P = at(PICS, beat), b0 = P[0], b1 = nextStart(PICS, beat), u = clamp((beat - b0) / (b1 - b0));
  const kind = P[1], o = P[2];
  if (kind === 'lock') { drawLockup(t - bt(CLOSE), t); return; }
  if (kind === 'otf') printed(() => drawOTF(eio(clamp(beat / 6)), o, beat, t), { t, lv: [0.05, 0.8] });
  else if (kind === 'truck') printed(() => drawTruck(u, beat, t), { t, lv: [0.05, 0.8] });
  else if (kind === 'foot') await drawFoot(o, beat, b0, b1, t);
  else if (kind === 'join') printed(() => drawJoin(u, beat, t), { t, lv: [0.04, 0.85], gam: 0.9 });
  ringsOver(beat, t);
  const c = at(CUESX, beat);
  if (c[2] === 'board') { for (const r of c[1]) if (beat >= r[0]) word(r, (beat - r[0]) * SPB); }
  else if (c[1]) word(c, (beat - c[0]) * SPB);
  for (const T of TAGS) tag(T, beat);
};
window.sceneInfo = { BPM, SPB, CLOSE, DUR: window.DURATION };
window.sceneReady = true;
