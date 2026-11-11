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
const ctx = out.getContext('2d');
await loadFonts();
let HITS = null;
try { HITS = await (await fetch('../../out/.machines.hits.json')).json(); } catch (e) { console.log('machines: no hits.json; 120 BPM stand-in'); }
const BPM = HITS ? HITS.bpm : 120, SPB = 60 / BPM;
const CLOSE = 87, LOCK = 1.4;
window.DURATION = CLOSE * SPB + LOCK;
const bt = b => b * SPB;
const eo = ease.outCubic, eio = ease.inOutCubic;

// ================================================================ the words (script words[], beat for beat)
// [beat, text, style, x, y, size, rot]  style: sky | slab | label | cold | quote | noun | huge
const CUES = [
  [0, 'WHO OWNS', 'sky', 90, 560, 230, 0], [3, 'THE MACHINES?', 'sky', 90, 560, 200, 0],
  [8, 'THE TRUCK.', 'slab', 540, 430, 220, -0.05],
  [12, 'THE FACTORY.', 'noun', 540, 1540, 210, 0],
  [15, 'THE POWER PLANT.', 'noun', 540, 1560, 170, 0],
  [17.5, 'THE STEEL MILL.', 'slab', 540, 1500, 190, 0.04],
  [20, 'THE AI.', 'noun', 540, 560, 260, 0],
  [24, 'WE BUILD IT.', 'slab', 540, 1520, 230, -0.04],
  [27, 'WHAT AI', 'quote', 90, 1320, 190, 0], [29, 'IS ACTUALLY FOR', 'quote', 90, 1320, 150, 0],
  [31, 'AND WHAT PURPOSE', 'quote', 90, 1320, 150, 0], [33, 'GOVERNS IT.', 'quote', 90, 1320, 200, 0],
  [36, null],
  [37, 'REPLACING ALL LABOR', 'label', 540, 1450, 150, -0.015], [39, 'WITH AI', 'label', 540, 1450, 190, -0.03],
  [40.5, 'WILL REQUIRE', 'label', 540, 1450, 170, -0.03], [42, 'COMMUNISM,', 'slab', 540, 1480, 210, -0.06],
  [44, 'AS THE SHORT-TERM COSTS', 'label', 540, 1450, 110, -0.03], [46, 'WILL BE TOO GREAT', 'label', 540, 1450, 135, -0.02],
  [47.5, 'TO BE JUSTIFIED', 'label', 540, 1450, 145, -0.01], [49, 'BY THE PROFIT MOTIVE.', 'cold', 540, 1470, 125, 0],
  [52, 'THE NATIONALIZATION', 'cold', 540, 1470, 130, 0], [53.5, 'OF ALL LARGE INDUSTRIES', 'cold', 540, 1470, 112, 0],
  [55, 'UNDER THE COMMAND', 'slab', 540, 1440, 150, -0.07], [56.5, "OF THE WORKERS' STATE.", 'slab', 540, 1440, 130, -0.07],
  [59, 'FULL', 'slab', 540, 1500, 300, -0.05], [60, 'REINDUSTRIALIZATION.', 'slab', 540, 1500, 140, -0.05],
  [62, 'CRANES.', 'noun', 540, 1560, 250, 0], [62.75, 'RAILS.', 'noun', 540, 1560, 250, 0],
  [63.5, 'SHIPS.', 'noun', 540, 1560, 250, 0], [64.25, 'FACTORIES.', 'noun', 540, 1560, 240, 0],
  [65, 'REDUCING', 'label', 540, 1500, 190, -0.02], [66, 'THE WORK WEEK', 'label', 540, 1500, 170, -0.02],
  [67.5, 'AND LABORING YEARS.', 'sky', 540, 400, 118, 0],
  [70, 'WHO OWNS', 'sky', 540, 380, 230, 0], [72, 'THE FUTURE?', 'sky', 540, 380, 220, 0],
  [76, 'THE FUTURE', 'slab', 540, 1500, 220, -0.05], [77.25, 'BELONGS TO', 'slab', 540, 1500, 220, -0.05],
  [78.5, 'THE WORKING CLASS.', 'slab', 540, 1500, 150, -0.05],
  [81, 'WE DEMAND', 'huge', 540, 460, 220, 0], [82, 'NOTHING LESS', 'huge', 540, 460, 190, 0],
  [83, 'THAN ALL', 'huge', 540, 460, 250, 0], [84, 'THAT EXISTS.', 'huge', 540, 460, 210, 0],
  [CLOSE, null],
];
// small picture text: the Party's truckers and the source tags. [b0, b1, lines, style]
const TAGS = [
  [8.25, 12, ['PORT NEWARK, N.J.', '100s OF TRUCKERS SIGNED UP TO UNIONIZE', '@ACPMain, 21 JUL 2026'], 'strip'],
  [27, 36, ['HAZ AL-DIN, ACP CHAIRMAN', '8 SEP 2026'], 'tagL'],
  [37, 49, ['HAZ AL-DIN', '8 SEP 2026'], 'tag'],
  [52, 59, ['ACP NEW YORK'], 'tag'],
  [59, 62, ['ACP NEW YORK'], 'tag'],
  [65, 70, ['ACP PROGRAM'], 'tag'],
  [76, 81, ["THE PARTY'S SLOGAN"], 'tag'],
];

// ================================================================ the pictures, by beat
// [beat, kind, opts]. 'foot' reads sources/machines_c6/<shot>/ (24 fps): f0 first frame, sp speed, z zoom from/to.
const PICS = [
  [0, 'otf', { from: [150, 0, 1.0], to: [215, 70, 1.11], head: 0.018 }],
  [8, 'truck', {}],
  [12, 'foot', { shot: 'factory', look: 'line', z: [1.0, 1.1], ang: 0.35, pitch: 6 }],
  [15, 'foot', { shot: 'power', look: 'line', z: [1.05, 1.12], ang: -0.5, pitch: 6 }],
  [16.25, 'foot', { shot: 'pylons', look: 'line', z: [1.0, 1.06], ang: 0.2, pitch: 5.5, lv: [0.1, 0.72], lc: 0.25 }],
  [17.5, 'foot', { shot: 'mill', look: 'heat', z: [1.0, 1.1], ang: 0.3, pitch: 6, cy: 0.55, lv: [0.02, 0.8] }],
  [20, 'rings', { mode: 'ai' }],
  [24, 'foot', { shot: 'face_tool', look: 'line', z: [1.05, 1.1], ang: -0.35, pitch: 5 }],
  [25.5, 'foot', { shot: 'face_hul', look: 'heat', z: [1.1, 1.18], ang: 0.4, pitch: 5, cy: 0.42 }],
  [27, 'foot', { shot: 'hands', look: 'line', z: [1.0, 1.08], ang: 0.5, pitch: 5.5, cy: 0.52 }],
  [31, 'foot', { shot: 'lever', look: 'line', z: [1.05, 1.12], ang: -0.3, pitch: 5.5, f0: 52, sp: 0.12, cy: 0.45 }],
  [36, 'dot', {}],
  [37, 'foot', { shot: 'interior', look: 'line', z: [1.0, 1.12], ang: 0.0, pitch: 6 }],
  [39, 'foot', { shot: 'overhead', look: 'line', z: [1.05, 1.1], ang: 0.6, pitch: 6 }],
  [40.5, 'foot', { shot: 'line', look: 'line', z: [1.0, 1.05], ang: -0.4, pitch: 6 }],
  [42, 'foot', { shot: 'tapper', look: 'heat', z: [1.0, 1.08], ang: 0.3, pitch: 6 }],
  [44, 'foot', { shot: 'line', look: 'line', z: [1.1, 1.14], ang: -0.4, pitch: 6, f0: 40, slow: [46, 49.2] }],
  [49, 'foot', { shot: 'stop', look: 'line', z: [1.05, 1.1], ang: 0.25, pitch: 6, f0: 8, sp: 0.9, freeze: 50.4 }],
  [52, 'foot', { shot: 'nat', look: 'line', z: [1.02, 1.02], ang: 0.0, pitch: 6, sp: 0 }],
  [53.5, 'foot', { shot: 'cranes_hold', look: 'heat', z: [1.0, 1.0], ang: 0.2, pitch: 6, sp: 0 }],
  [55, 'foot', { shot: 'lever', look: 'line', z: [1.12, 1.2], ang: -0.3, pitch: 6, f0: 62, sp: 1.0, thaw: 55.35 }],
  [56.5, 'foot', { shot: 'flywheel', look: 'line', z: [1.3, 1.36], ang: 0.45, pitch: 6, f0: 1, sp: 0.8, cy: 0.36 }],
  [57.75, 'foot', { shot: 'flywheel', look: 'line', z: [1.0, 1.12], ang: 0.45, pitch: 6, f0: 22, spin: [0.6, 1.6] }],
  [59, 'foot', { shot: 'tap', look: 'heat', z: [1.0, 1.15], ang: 0.25, pitch: 6.5, cy: 0.5 }],
  [62, 'foot', { shot: 'cranes', look: 'heat', z: [1.05, 1.1], ang: 0.3, pitch: 6 }],
  [62.75, 'foot', { shot: 'rails', look: 'line', z: [1.05, 1.1], ang: -0.3, pitch: 6 }],
  [63.5, 'foot', { shot: 'ships', look: 'heat', z: [1.0, 1.08], ang: 0.3, pitch: 6 }],
  [64.25, 'foot', { shot: 'factory', look: 'line', z: [1.08, 1.14], ang: -0.25, pitch: 6, f0: 30 }],
  [65, 'foot', { shot: 'reduce', look: 'heat', z: [1.0, 1.06], ang: 0.3, pitch: 6 }],
  [66, 'foot', { shot: 'week', look: 'line', z: [1.05, 1.1], ang: -0.4, pitch: 5.5, cy: 0.45 }],
  [67.5, 'join', {}],
  [76, 'foot', { shot: 'f_foundry', look: 'line', z: [1.1, 1.16], ang: 0.4, pitch: 5, cy: 0.42, lv: [0.02, 0.7] }],
  [77.25, 'foot', { shot: 'f_rail', look: 'line', z: [1.2, 1.26], ang: -0.4, pitch: 5, cy: 0.42, lv: [0.03, 0.55] }],
  [78.5, 'foot', { shot: 'f_phone', look: 'heat', z: [1.1, 1.16], ang: 0.3, pitch: 5, cy: 0.4 }],
  [79.75, 'foot', { shot: 'f_profile', look: 'line', z: [1.1, 1.14], ang: -0.35, pitch: 5, cy: 0.45 }],
  [81, 'rings', { mode: 'all' }],
  [CLOSE, 'lock', {}],
];
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
// a 3:4 source cropped to the 9:16 frame, zoom z about (cx, cy) in source uv
function xform(sw, sh, z, cx = 0.5, cy = 0.5) {
  const wu = (W / H) * (sh / sw) / z, hu = 1 / z;
  const x0 = clamp(cx - wu / 2, 0, 1 - wu), y0 = clamp(cy - hu / 2, 0, 1 - hu);
  return [x0, y0, wu, hu];
}

// ================================================================ type
function fit(text, size, maxW) { ctx.font = `${size}px "Anton"`; const w = ctx.measureText(text).width; return w > maxW ? size * maxW / w : size; }
function word(c, age) {
  const [, text, style, x, y, size0, rot] = c;
  if (!text) return;
  const pop = 1 + 0.06 * Math.exp(-age / 0.05);
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0); ctx.scale(pop, pop);
  ctx.textBaseline = 'alphabetic';
  if (style === 'sky') {
    const s = fit(text, size0, 900); ctx.font = `${s}px "Anton"`;
    ctx.textAlign = x < 300 ? 'left' : 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 30; ctx.fillStyle = CREAM; ctx.fillText(text, 0, 0);
  } else if (style === 'slab' || style === 'label' || style === 'cold') {
    const s = fit(text, size0, 920); ctx.font = `${s}px "Anton"`; ctx.textAlign = 'center';
    const w = ctx.measureText(text).width, cap = s * 0.74, px = 38, py = s * 0.2;
    ctx.fillStyle = style === 'slab' ? RED : style === 'cold' ? '#d9d6cf' : CREAM;
    ctx.beginPath(); ctx.moveTo(-w / 2 - px - 14, -cap - py); ctx.lineTo(w / 2 + px + 14, -cap - py); ctx.lineTo(w / 2 + px, py); ctx.lineTo(-w / 2 - px, py); ctx.fill();
    if (style !== 'cold') { ctx.fillStyle = style === 'slab' ? INK : RED; ctx.fillRect(-w / 2 - px, py, w + 2 * px, 10); }
    ctx.fillStyle = style === 'slab' ? CREAM : INK; ctx.fillText(text, 0, 0);
  } else if (style === 'quote') {
    const s = fit(text, size0, 900); ctx.font = `${s}px "Anton"`; ctx.textAlign = 'left';
    const w = ctx.measureText(text).width, cap = s * 0.74;
    ctx.fillStyle = CREAM; ctx.fillRect(-26, -cap - 26, w + 52, cap + 52);
    ctx.fillStyle = RED; ctx.fillRect(-26, -cap - 26, 12, cap + 52);
    ctx.fillStyle = INK; ctx.fillText(text, 0, 0);
  } else if (style === 'noun') {
    const s = fit(text, size0, 940); ctx.font = `${s}px "Anton"`; ctx.textAlign = 'center';
    ctx.lineJoin = 'round'; ctx.lineWidth = s * 0.07; ctx.strokeStyle = INK; ctx.strokeText(text, 0, 0);
    ctx.fillStyle = CREAM; ctx.fillText(text, 0, 0);
  } else if (style === 'huge') {
    const s = fit(text, size0, 960); ctx.font = `${s}px "Anton"`; ctx.textAlign = 'center';
    ctx.lineJoin = 'round'; ctx.lineWidth = s * 0.06; ctx.strokeStyle = INK; ctx.strokeText(text, 0, 0);
    ctx.fillStyle = CREAM; ctx.fillText(text, 0, 0);
  }
  ctx.restore();
}
function tag(T, beat) {
  const [b0, b1, lines, style] = T; if (beat < b0 || beat >= b1) return;
  ctx.save(); ctx.globalAlpha = clamp((beat - b0) / 0.5); ctx.textBaseline = 'alphabetic';
  if (style === 'strip') {
    ctx.translate(540, 1500); ctx.rotate(-0.03);
    ctx.fillStyle = CREAM; ctx.fillRect(-470, -150, 940, 250);
    ctx.fillStyle = RED; ctx.fillRect(-470, -150, 940, 16);
    ctx.fillStyle = INK; ctx.textAlign = 'left';
    ctx.font = '96px "Anton"'; ctx.fillText(lines[0], -430, -30);
    ctx.font = '44px "Anton"'; ctx.fillText(lines[1], -430, 40);
    ctx.font = '30px "Plex Mono"'; ctx.fillStyle = '#5a1a1a'; ctx.fillText(lines[2], -430, 84);
  } else {
    const x = style === 'tagL' ? 90 : 540, y = style === 'tagL' ? 1450 : style === 'tagTop' ? 690 : 1640;
    ctx.textAlign = style === 'tagL' ? 'left' : 'center'; ctx.font = '34px "Plex Mono"';
    const txt = lines.join('  ·  '), w = ctx.measureText(txt).width;
    const x0 = style === 'tagL' ? x - 14 : x - w / 2 - 14;
    ctx.fillStyle = 'rgba(18,7,8,0.82)'; ctx.fillRect(x0, y - 36, w + 28, 50);
    ctx.fillStyle = CREAM; ctx.fillText(txt, x, y);
  }
  ctx.restore();
}

// ================================================================ pictures
const NOISE = [0, 1, 2, 3].map(k => { const c = document.createElement('canvas'); c.width = 540; c.height = 960; const g = c.getContext('2d');
  const id = g.createImageData(540, 960); let x = 1234567 + k * 7919;
  for (let i = 0; i < id.data.length; i += 4) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; const v = 128 + ((x >>> 0) % 110) - 55; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  g.putImageData(id, 0, 0); return c; });
function grain(t, amt = 0.06) {
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
  const g = eio(clamp((beat - 67.5) / 8.5));
  const top = lerp(560, 0, g), bot = lerp(1330, H, g);
  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = RED; ctx.fillRect(0, bot - 4, W, H - bot + 4);
  const hgt = bot - top, k = Math.max(hgt / 724, W / 860) * lerp(1.0, 1.08, u);          // the banner's ACP badge (x < 240) stays out of frame
  const fx = clamp(lerp(650, JOIN_SUN[0] - 60, g), 240 + W / (2 * k), 1100 - W / (2 * k)), fy = clamp(lerp(380, JOIN_SUN[1] - 40, g), hgt / (2 * k), 724 - hgt / (2 * k));
  ctx.save(); ctx.beginPath(); ctx.rect(0, top, W, hgt); ctx.clip();
  const ox = W / 2 - fx * k, oy = (top + bot) / 2 - fy * k;
  ctx.drawImage(joinPlate, ox, oy, 1100 * k, 724 * k);
  const r = clamp((beat - 70) / 2);
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
  let cold = 0;
  if (beat >= 46 && beat < 49) cold = 0.55 * clamp((beat - 46) / 3);
  if (beat >= 49 && beat < 55.35) cold = beat < 50.4 ? lerp(0.55, 1, clamp((beat - 49) / 1.4)) : 1;
  if (o.thaw) cold = beat < o.thaw ? 1 : 0;
  const redStock = beat >= 55.35 && beat < 65 && o.look === 'line';
  const flash = [55.35, 59, 62, 76, 81].reduce((m, h) => Math.max(m, beat >= h ? Math.exp(-(beat - h) * SPB / 0.05) * 0.8 : 0), 0);
  press(img, { mode: o.look === 'heat' ? 1 : 0, xf: xform(img.width, img.height, z, 0.5, o.cy ?? 0.5), paper: redStock ? '#D42A3C' : CREAM,
    ink: o.red ? '#9E1426' : INK, pitch: Math.max(6.5, o.pitch), ang: o.ang, t, gam: redStock ? 0.72 : 1, cold, flash,
    lv: o.lv || (redStock ? [0.0, 0.78] : o.look === 'heat' ? [0.02, 0.72] : null), lc: o.lc ?? 0.5, redAmt: 1 });
  ctx.drawImage(glc, 0, 0);
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
window.renderFrame = async (t) => {
  const beat = t / SPB;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const P = at(PICS, beat), b0 = P[0], b1 = nextStart(PICS, beat), u = clamp((beat - b0) / (b1 - b0));
  const kind = P[1], o = P[2];
  if (kind === 'lock') { drawLockup(t - bt(CLOSE), t); return; }
  if (kind === 'otf') drawOTF(eio(clamp(beat / 8)), o, beat, t);
  else if (kind === 'truck') drawTruck(u, beat, t);
  else if (kind === 'foot') await drawFoot(o, beat, b0, b1, t);
  else if (kind === 'rings') drawRings(beat, t, o.mode);
  else if (kind === 'join') drawJoin(u, beat, t);
  else if (kind === 'dot') { ctx.fillStyle = '#0a0506'; ctx.fillRect(0, 0, W, H); dot(540, 900, 30, 0.6); }
  const c = at(CUES, beat);
  if (c[1]) word(c, (beat - c[0]) * SPB);
  for (const T of TAGS) tag(T, beat);
};
window.sceneInfo = { BPM, SPB, CLOSE, DUR: window.DURATION };
window.sceneReady = true;
