// REJUVENATION v3 (cycle R1, 28 Sep). Age is a medium: the old world is foxed sepia halftone newsprint with rust tide
// stains, the young world is hard noon in clean ink colours (cobalt, concrete white, safety yellow, ACP red), and the
// reverse wave is the boundary between them, a burning yellow seam that runs through every shot. Time runs young:
// frame 0 is Lumière's Démolition d'un mur cranked backwards (a felled brick stack swinging up out of its own dust),
// the rust recedes off the steel, a dead cooling tower's plume comes back, and a welder in lost profile under a lifted
// hood steps younger on every arc flash (beard grey to dark, shoulders square) until the hood snaps down. One black
// beat. Noon: THE HUMAN RACE / GROWS YOUNG. as the wave climbs a ranked crowd; MASTER over the welder at the left
// third; OF STEEL. / OF AI. / OF TIME. on the bare beam, the arc, the punch clock running backwards. The RE- litany
// (REBUILD. REINDUSTRIALIZE.) on a mill rising from rubble, the grid re-energised, the fortress pouring level by level;
// a Becher typology of nine cooling towers whose plumes return one per supersaw stab; COAST TO COAST.; RISE x4 cut
// between two worlds (noon at the fortress foot, the red light room), the fists landing on each hit; CLOCK IN.; the day
// of shadows; REJUVENATION. carved into the concrete as the wave sweeps the town; THROUGH AMERICA. on the plains; the
// red room revealed as the furnace mouth: FOUNTAIN OF YOUTH. / A STEEL MILL. on Cranach's left-to-right track (the old
// on the left, the pour in the centre, the young on the right, on to the next shift); UNRELENTING. / HUMAN
// FLOURISHING.; MASTER / OF ALL THINGS. carved and painted red under the whole four-stripe mark, the fists on the
// song's RISE x4, one camera step per hit. c16 (v6): the length follows the material: 19 bars / 30.4 s. MASTER gets one bar on one
// shot (the young welder, hood down, arc steady; on b59 the arc dies and the hood lifts), OF ALL THINGS. lands on the b60
// downbeat as a raking noon sun sweeps the carved words, holds 3.2 s while the camera pulls back in four steps from the crowd to
// the dam's crest, and the last blow at b68 brings the lockup, held 3.2 s on the same wall while the struck steel rings out.
// Frame 0 is the felled stack lying in its dust. Nothing ages or falls at the end. The welder is a hero.js person (baked
// sprites, web/labs/rejuv), the fortress is a poured concrete dam (paint2.js), the town a low oblique mill-town street, the red
// room builds on every return. Song: web/audio/songs2/rejuvenation.py (150 BPM, 19 bars, ends before it loops).
// (the 'standing' and 'closer' painters below are dead code from the old coda).
// the pour); the mark only whole (kit acpEmblem, four stripes). Words: research/scripts_final/rejuvenation.json.
// Song: web/audio/songs2/rejuvenation.py (150 BPM, 17 bars, loop).
import { W, H, C, loadFonts, loadBeats, clamp, lerp, ease, smooth, rng, sigil, acpEmblem, BRAND } from '../lib/kit.js';
import { Ranks, RANK_STYLES } from '../lib/fx/ranks.js';
import { signedDistance, relight } from '../lib/fx/type_press.js';
import { P, sky, poly, rect, plume, coolingTower, chimney, steelBeam, punchClock, pylon, plains,
  backFigure, arcLight, lerpCol, redRoom } from './rejuvenation3.paint.js';
import { dam, townOblique, redRoom2, banner, loadWelderSprites, welderSprite } from './rejuvenation3.paint2.js';

const QS = new URLSearchParams(location.search);
await loadFonts();
await loadWelderSprites();
const B = await loadBeats('rejuvenation3');
const SPB = B.spb, FR = 1 / 30, bt = b => b * SPB;
const out = document.getElementById('out').getContext('2d');

// ================================================================ words (scripts_final/rejuvenation.json v3, exactly)
// every line is one complete shout; hit, don't hold: each runs to its clear. y = baseline of the (last) line.
const CUES = [
  { b: 0, e: 1.5, text: ['YOUNG', 'AGAIN.'], col: 'red', y: 760 },
  { b: 8, e: 9, text: ['THE HUMAN', 'RACE'], col: 'ink', y: 700, em: 1 },
  { b: 9, e: 10, text: ['GROWS', 'YOUNG.'], col: 'ink', y: 700 },
  { b: 10, e: 11, text: ['MASTER'], col: 'cream', y: 470, cap: 230 },
  { b: 12, e: 13, text: ['OF STEEL.'], col: 'cream', y: 560 },
  { b: 13, e: 14, text: ['OF AI.'], col: 'cream', y: 560, cap: 250 },
  { b: 14, e: 15.25, text: ['OF TIME.'], col: 'cream', y: 1230 },
  { b: 16, e: 17.25, text: ['REBUILD.'], col: 'ink', y: 560, em: 1, cap: 240 },
  { b: 18, e: 19.25, text: ['RE-ELECTRIFY.'], col: 'ink', y: 560 },
  { b: 20, e: 21.5, text: ['REINDUSTRIALIZE.'], col: 'ink', y: 470 },
  { b: 28, e: 29.5, text: ['COAST TO', 'COAST.'], col: 'ink', y: 720 },
  { b: 32, e: 32.6, text: ['RISE.'], col: 'ink', y: 700, cap: 330, em: 1 },
  { b: 33, e: 33.6, text: ['RISE.'], col: 'cream', y: 820, cap: 330 },
  { b: 34, e: 34.6, text: ['RISE.'], col: 'ink', y: 640, cap: 330 },
  { b: 35, e: 35.75, text: ['RISE.'], col: 'cream', y: 880, cap: 330 },
  { b: 36, e: 37.25, text: ['CLOCK IN.'], col: 'cream', y: 1230 },
  { b: 40, e: 42, text: ['REJUVENATION.'], carve: 'wall', y: 820 },
  { b: 44, e: 45.5, text: ['THROUGH', 'AMERICA.'], col: 'ink', y: 640 },
  { b: 48, e: 50.5, text: ['FOUNTAIN', 'OF YOUTH.'], col: 'ink', y: 470 },
  // c20: A STEEL MILL. removed (the client: 'sometimes no text is fine'); the pour itself reveals the furnace as the fountain
  { b: 52, e: 53.25, text: ['UNRELENTING.'], col: 'ink', y: 600, em: 1 },
  { b: 54, e: 55.5, text: ['HUMAN', 'FLOURISHING.'], col: 'ink', y: 640 },
  { b: 56, e: 60, text: ['MASTER'], col: 'cream', y: 1240, cap: 200 },
  { b: 60, e: 68, text: ['OF ALL', 'THINGS.'], carve: 'pay', y: 1290, em: 1 },
];

// ================================================================ shots (start beat, painter): gate.py reads SHOTS
const SHOTS = [
  [0, 'hook'], [2, 'rust'], [3, 'tower'], [4, 'welder'], [7, 'black'], [8, 'noon'], [10, 'master'],
  [12, 'steel'], [13, 'arc'], [14, 'clock'], [15, 'roll'], [15.25, 'roll'], [15.5, 'roll'], [15.75, 'roll'],
  [16, 'rebuild'], [18, 'electrify'], [20, 'pour'], [22, 'becher'], [28, 'coast'], [31, 'redCrowd'],
  [32, 'riseDay'], [33, 'riseRed'], [34, 'riseDay'], [35, 'riseRed'], [36, 'card'], [37, 'shadows'], [39, 'redCrowd'],
  [40, 'carve'], [42, 'town'], [44, 'plains'], [46, 'redCrowd'], [47, 'plains'], [48, 'cranach'],
  [52, 'noon'], [54, 'flourish'], [56, 'master'],     // c20 (client): the molten steel is the fountain, developing over b48-52, no cut back to the red room
  // c21: [56, 'master'] had been swallowed by the comment above in c20, so v8 set MASTER over the plains instead of over the welder
  [60, 'payoff'], [62, 'payoff'], [63, 'payoff'], [64, 'payoff'], [65, 'payoff'], [68, 'payoff'],
];
const shotAt = b => { let k = 0; for (let i = 0; i < SHOTS.length; i++) if (b >= SHOTS[i][0] - 1e-6) k = i; return k; };

// ================================================================ the AGE pass (WebGL): young picture -> newsprint by a wave
const Y = Object.assign(document.createElement('canvas'), { width: W, height: H }), yg = Y.getContext('2d');
const GLC = Object.assign(document.createElement('canvas'), { width: W, height: H });
const gl = GLC.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
const VS = `attribute vec2 p; varying vec2 vUv; void main(){ vUv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;
const FS = `precision highp float;
uniform sampler2D uY; uniform vec2 uRes; uniform float uT, uF, uW, uA0, uA1, uAmp, uEdge, uGrain, uSeed; uniform vec2 uDir;
varying vec2 vUv;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1., 0.)), f.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++) { s += a * vn(p); p *= 2.03; a *= .5; } return s; }
void main(){
  vec2 px = vec2(vUv.x, 1. - vUv.y) * uRes;
  vec3 c = texture2D(uY, vUv).rgb;
  float s = dot(px, uDir) + (fbm(px * .006 + uSeed) - .5) * uAmp;
  float k = smoothstep(uF - uW, uF + uW, s);
  float age = mix(uA0, uA1, k);
  // ---- old: newsprint. tone compressed and lifted, one brown ink screened at 45 degrees, foxed paper, rust tides
  float L = dot(c, vec3(.299, .587, .114));
  L = clamp(mix(.08, .98, smoothstep(.06, .9, L)), 0., 1.);
  float ang = .785; mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  float cell = 7.; vec2 q = R * px / cell; vec2 f = fract(q) - .5; float d = length(f);
  float rr = sqrt(1. - L) * .64; float ink = smoothstep(rr + .07, rr - .07, d);
  float st = fbm(px * .0035 + uSeed * 3.);
  vec3 paper = vec3(.92, .86, .72) - vec3(.09, .11, .13) * smoothstep(.5, .78, st);
  vec2 gc = floor(px / 42.); float hh = h21(gc + 7.1);
  vec2 cc = (gc + .5 + (vec2(h21(gc + 1.7), h21(gc + 3.1)) - .5) * .7) * 42.;
  float fox = hh > .9 ? smoothstep(5. + (hh - .9) * 120., 1.5, length(px - cc)) : 0.;
  paper = mix(paper, vec3(.66, .45, .25), fox * .6);
  float rs = fbm(px * vec2(.0022, .0016) + 11.3);
  float tide = smoothstep(.6, .63, rs) * (1. - smoothstep(.63, .72, rs) * .55);
  paper = mix(paper, vec3(.58, .33, .15), tide * .5);
  float drip = smoothstep(.72, .75, fbm(vec2(px.x * .02, px.y * .002) + 4.));
  paper = mix(paper, vec3(.5, .27, .12), drip * .35);
  vec3 inkc = vec3(.2, .12, .075);
  vec3 old = mix(paper, inkc, ink * .96);
  // ---- young: the painted ink colours, a fine paper tooth
  vec3 yng = c;
  vec3 col = mix(yng, old, age);
  // ---- the seam: a thin burning yellow line where the wave passes, a scorched brown shoulder on the old side
  float dd = s - uF;
  float e = uEdge * (1. - step(abs(uA0 - uA1), .001));
  col = mix(col, vec3(.35, .2, .1), e * smoothstep(40., 8., abs(dd - 14.) ) * .45 * step(0., dd * sign(uA1 - uA0)));
  col = mix(col, vec3(1., .82, .2), e * exp(-abs(dd) / 5.));
  col += (h21(px + fract(uT) * 91.) - .5) * uGrain;
  gl_FragColor = vec4(col, 1.);
}`;
const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const ap = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
const U = n => gl.getUniformLocation(prog, n);
gl.viewport(0, 0, W, H);
// age: { a0, a1, F, dir: [x, y], w, amp, edge } ; a number = the whole frame at that age
function agePass(t, age, grain = 0.035) {
  const A = typeof age === 'number' ? { a0: age, a1: age, F: 0, dir: [0, 1], w: 1, amp: 0, edge: 0 } : { w: 10, amp: 160, edge: 1, dir: [0, -1], ...age };
  gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, Y);
  gl.uniform1i(U('uY'), 0); gl.uniform2f(U('uRes'), W, H); gl.uniform1f(U('uT'), t);
  gl.uniform1f(U('uF'), A.F); gl.uniform1f(U('uW'), A.w); gl.uniform1f(U('uA0'), A.a0); gl.uniform1f(U('uA1'), A.a1);
  gl.uniform1f(U('uAmp'), A.amp); gl.uniform1f(U('uEdge'), A.edge); gl.uniform1f(U('uGrain'), grain); gl.uniform1f(U('uSeed'), 3.7);
  const dl = Math.hypot(...A.dir); gl.uniform2f(U('uDir'), A.dir[0] / dl, A.dir[1] / dl);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  out.drawImage(GLC, 0, 0);
}
// a wave sweeping the frame bottom -> top over [b0, b1] (young rising from below)
const riseWave = (b, b0, b1, o = {}) => ({ a0: 0, a1: 1, dir: [0, -1], F: lerp(-H - 200, 260, ease.inOutCubic(clamp((b - b0) / (b1 - b0)))), ...o });

// ================================================================ crowds (ranks.js SIL, designed as registers)
const RK = await Ranks.create({ W, H });
const PW = 1500, PH = 2200, PX = 210;       // the payoff crowd is wider than the frame, so the camera can pull back from it
const RK2 = await Ranks.create({ W: PW, H: PH });
const payCv = Object.assign(document.createElement('canvas'), { width: PW, height: PH }), payG = payCv.getContext('2d');
const RED = { ink: ['#0a0203', '#220405', '#420709', '#630b0e', '#841014'], rim: '#ff6a48', rimAmt: [1, 0.85, 0.6, 0.4, 0.2], key: '#ff3a2a', keyAmt: [0.12, 0.1, 0.06, 0.03, 0],
  acc: '#040101', accAmt: [0.6, 0.5, 0.3, 0.1, 0], shadow: '#1a0203', shadowA: 0.7, ground: ['#6a080b', '#240203'], dust: '#ff5a3a', flag: '#ff3d1f', flagDark: '#8a0f0a', emblem: '#ffd27a' };
const NOON = { ...RANK_STYLES.day, ink: ['#1c1a1c', '#35323a', '#5a5660', '#7f7a82', '#a29da2'], rim: '#fff6dc', ground: ['#d9d0bc', '#b9ae98'], dust: '#f4ecd8', flag: '#c91f37', flagDark: '#7a0c0a' };
const crowds = {
  noon: RK.design({ seed: 11, ranks: [{ foot: 1990, h: 330, raise: 0.0, rows: 1, pack: 1.2 }, { foot: 1640, h: 170, raise: 0.1, flags: 1 }, { foot: 1470, h: 86, raise: 0.05 }, { foot: 1395, h: 44 }] }),
  rise: RK.design({ seed: 23, ranks: [{ foot: 1990, h: 320, raise: 0.5, rows: 1, pack: 1.2 }, { foot: 1650, h: 175, raise: 0.45, flags: 1 }, { foot: 1480, h: 90, raise: 0.35 }, { foot: 1400, h: 46, raise: 0.25 }] }),
  red: RK.design({ seed: 31, ranks: [{ foot: 2060, h: 400, raise: 0.5, rows: 1, pack: 1.25, flags: 1 }, { foot: 1700, h: 190, raise: 0.4, flags: 1 }, { foot: 1520, h: 96, raise: 0.3 }] }),
  crew: RK.design({ seed: 41, ranks: [{ foot: 1560, h: 150, raise: 0, x0: 380, x1: 1120, kinds: ['hard'], rows: 1 }, { foot: 1440, h: 80, raise: 0, x0: 300, x1: 1120, rows: 2 }] }),
  shift: RK.design({ seed: 57, ranks: [{ foot: 1930, h: 300, walk: true, x0: -300, x1: 1400, rows: 1, gaps: 0.25, pack: 0.9 }] }),
  walk: RK.design({ seed: 53, ranks: [{ foot: 1700, h: 180, walk: true, x0: -200, x1: 1300, rows: 1, gaps: 0.2 }] }),
  pay: RK2.design({ seed: 61, ranks: [{ foot: 2160, h: 540, raise: 0.6, rows: 1, pack: 1.2 }, { foot: 1770, h: 290, raise: 0.55, flags: 2 }, { foot: 1570, h: 150, raise: 0.45, flags: 2 }, { foot: 1460, h: 80, raise: 0.4 }, { foot: 1400, h: 46, raise: 0.3 }] }),
};
const RED_VISITS = [31, 33, 35, 39, 46];
const lastHit = (b, list) => { let h = null; for (const x of list) if (b >= x - 0.02) h = x; return h; };

// ================================================================ type: printed ink, heavy condensed sans, no shadow
const INK = { ink: '#121012', cream: '#f6efe0', red: '#c91f37' };
const SAFE = { x1: 60, x2: 960, y1: 270, y2: 1250, cx: 510 };
let capK = null;
function capRatio() { if (capK) return capK; out.font = '200px Anton'; const m = out.measureText('H'); capK = m.actualBoundingBoxAscent / 200; return capK; }
// fit: cap height `cap` (px), compress horizontally to 0.74 before shrinking; returns [size, sx, width]
function fitLine(g, s, cap) {
  let size = cap / capRatio(); g.font = `${size}px Anton`; let w = g.measureText(s).width, sx = 1; const maxW = SAFE.x2 - SAFE.x1;
  if (w > maxW) { sx = Math.max(0.74, maxW / w); if (w * sx > maxW) { size *= maxW / (w * sx); g.font = `${size}px Anton`; w = g.measureText(s).width; } }
  return [size, sx, w * sx];
}
function drawCue(g, c, b) {
  const age = (b - c.b) * SPB, lines = c.text, n = lines.length;
  const cap = c.cap || (n > 1 ? 210 : 220);
  const fits = lines.map(s => fitLine(g, s, cap));
  const minSize = Math.min(...fits.map(f => f[0]));            // one size per block
  const lh = minSize * capRatio() * 1.16;
  const slam = age < 2 * FR ? 1.06 : 1;                         // the press: 2 frames of overpressure, then set
  g.save(); g.fillStyle = INK[c.col] || INK.ink; g.textBaseline = 'alphabetic'; g.textAlign = 'center';
  lines.forEach((s, i) => {
    g.font = `${minSize}px Anton`; const w = g.measureText(s).width, sx = Math.min(1, (SAFE.x2 - SAFE.x1) / w);
    const y = c.y - (n - 1 - i) * lh;
    g.save(); g.translate(SAFE.cx, y); g.scale(sx * slam, slam); g.fillText(s, 0, 0); g.restore();
  });
  g.restore();
}

// carved type: the word cut into board-formed concrete and relit by the scene's sun (type_press relight); the payoff
// has ACP red wiped into the cut. Baked once per block.
const carveCache = new Map();
function carved(lines, { cap = 250, paint = null, conc = [226, 221, 210], L = [-0.55, -0.62, 0.55], amb = 0.38, spec = 0.25 } = {}) {
  const key = lines.join('|') + cap + paint + L.join(',') + amb + conc.join(','); if (carveCache.has(key)) return carveCache.get(key);
  const cv = document.createElement('canvas'); cv.width = 1000; const g = cv.getContext('2d');
  const fits = lines.map(s => fitLine(g, s, cap)), size = Math.min(...fits.map(f => f[0])), lh = size * capRatio() * 1.14;
  cv.height = Math.ceil(lh * lines.length + 80); const h = cv.height, w = cv.width;
  const m = document.createElement('canvas'); m.width = w; m.height = h; const mg = m.getContext('2d');
  mg.fillStyle = '#fff'; mg.textAlign = 'center'; mg.textBaseline = 'alphabetic'; mg.font = `${size}px Anton`;
  lines.forEach((s, i) => { const tw = mg.measureText(s).width, sx = Math.min(1, (SAFE.x2 - SAFE.x1) / tw); mg.save(); mg.translate(w / 2, 40 + lh * (i + 1) - lh * 0.14); mg.scale(sx, 1); mg.fillText(s, 0, 0); mg.restore(); });
  const md = mg.getImageData(0, 0, w, h).data, mask = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) mask[i] = md[i * 4 + 3] > 127 ? 1 : 0;
  const sd = signedDistance(mask, w, h), hf = new Float32Array(w * h), alb = new Uint8ClampedArray(w * h * 4), alpha = new Float32Array(w * h);
  const pr = paint ? [parseInt(paint.slice(1, 3), 16), parseInt(paint.slice(3, 5), 16), parseInt(paint.slice(5, 7), 16)] : [118, 112, 104];
  for (let i = 0; i < w * h; i++) {
    const d = sd[i]; hf[i] = d < 0 ? -Math.min(-d, 9) * 2.6 : 0;
    const inside = d < 0; const c3 = inside ? pr : conc;
    alb[i * 4] = c3[0]; alb[i * 4 + 1] = c3[1]; alb[i * 4 + 2] = c3[2]; alb[i * 4 + 3] = 255;
    alpha[i] = clamp(1 - (d - 2) / 3);
  }
  const id = relight(hf, w, h, alb, { L, amb, kd: 0.9, spec, shin: 20, shadow: true, alpha });
  g.putImageData(id, 0, 0);
  const r = { cv, w, h }; carveCache.set(key, r); return r;
}
function drawCarved(g, c, yShift = 0, sun = 1) {
  const pay = c.carve === 'pay';
  if (!pay) { const k = carved(c.text, { cap: 215, paint: '#3a3632' }); g.drawImage(k.cv, SAFE.cx - k.w / 2, c.y - k.h + 40 + yShift); return; }
  // the payoff: the same cut under two lights. In shade (flat cool light) at first; the raking noon sun sweeps across and gives the letters their depth.
  const kS = carved(c.text, { cap: 285, paint: '#9a2a3a', conc: [186, 189, 198], L: [0, -0.2, 0.98], amb: 0.6, spec: 0.05 });
  const kN = carved(c.text, { cap: 285, paint: '#c01a30', conc: [240, 228, 204], L: [-0.88, -0.42, 0.22], amb: 0.3, spec: 0.3 });
  const x = SAFE.cx - kS.w / 2, y = c.y - kS.h + 40 + yShift;
  g.drawImage(kS.cv, x, y);
  if (sun > 0) { g.save(); if (sun < 1) { const ex = lerp(-300, W + 400, sun); g.beginPath(); g.moveTo(-10, -50); g.lineTo(ex + 160, -50); g.lineTo(ex - 160, 2200); g.lineTo(-10, 2200); g.closePath(); g.clip(); } g.drawImage(kN.cv, x, y); g.restore(); }
}

// board-formed concrete (the fortress face at close range)
function concreteWall(g, { y0 = 0, y1 = H, shift = 0, stains = 0 } = {}) {
  rect(g, 0, y0, W, y1 - y0, '#e2ddd2');
  const r = rng(5);
  for (let y = y0 - ((shift % 64) + 64) % 64; y < y1; y += 64) {         // form boards
    rect(g, 0, y, W, 2, 'rgba(120,112,100,0.35)');
    g.fillStyle = 'rgba(255,255,255,0.22)'; for (let x = 0; x < W; x += 180) g.fillRect(x + r() * 40, y + 4, 120 + r() * 80, 18);
  }
  for (let y = y0 + 32 - ((shift % 256) + 256) % 256; y < y1; y += 256) for (let x = 90; x < W; x += 300) { g.fillStyle = '#9a948a'; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
  for (let x = 0; x < W; x += 540) rect(g, x, y0, 4, y1 - y0, 'rgba(120,112,100,0.4)');
}

// ================================================================ the painters, one per shot id
const SUN = '#fff2c8';
// the welding shop: a steel plate on the bench, lit only by the arc (in front of his face, lower right)
function shop(g, t, fl, hood, k0 = 1) {
  rect(g, 0, 0, W, H, '#06070b');
  const ax = 905, ay = 1235;
  const rg = g.createRadialGradient(ax, ay, 20, ax, ay, 1300); rg.addColorStop(0, 'rgba(70,100,170,0.55)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, H);
  poly(g, [[640, 1270], [W, 1225], [W, 1500], [700, 1480]], '#141922'); poly(g, [[640, 1270], [W, 1225], [W, 1240], [660, 1284]], '#9db3e0');
  const k = (0.6 + 0.4 * fl + 0.08 * Math.sin(t * 80)) * k0;
  arcLight(g, ax, ay, k, t, { sparks: 80 });
}
function noonGround(g, hor) { const gr = g.createLinearGradient(0, hor, 0, H); gr.addColorStop(0, '#dcd4c2'); gr.addColorStop(1, '#bfb49c'); g.fillStyle = gr; g.fillRect(0, hor, W, H - hor); }
function fortressNoon(g, { hor = 1380, s = 0.72, cx = 560, levels = 99, plumeP = 1, t = 0, towers = true } = {}) {
  sky(g, 0, hor, P.skyTop, P.skyHor);
  if (towers) { const tt = coolingTower(g, 150, hor, 230, { rBase: 0.4 }); plume(g, tt.top[0], tt.top[1], plumeP, { scale: 0.5, t, maxH: 700, seed: 2 }); }
  noonGround(g, hor);
  const f = dam(g, cx, hor + 10, s * 0.95, { levels, t });
  return f;
}

// ---- the payoff wall: the dam's own face, board-formed, seen under a flat cool shade and then the raking sun; the camera pulls back
// in four steps to show the crest, the cableway and the crowd at its foot (camera anchored on the crowd's feet).
const CAM_STEPS = [[62, 0.93], [63, 0.87], [64, 0.82], [65, 0.77]];
const camK = b => { let k = 1; for (const [sb, kv] of CAM_STEPS) { const u = ease.outCubic(clamp((b - sb) / 0.3)); k = lerp(k, kv, u); } return k; };
const sunK = b => ease.outCubic(clamp((b - 60) / 0.7));
const applyCam = (g, k) => { g.translate(540, 1990); g.scale(k, k); g.translate(-540, -1990); };
function wallLayer(g, sun, y0, y1) {
  const base = sun ? '#efe3c8' : '#b4b8c2';
  rect(g, -800, y0, W + 1600, y1 - y0, base);
  const gr = g.createLinearGradient(-400, 0, W + 400, 0); gr.addColorStop(0, sun ? 'rgba(255,244,214,0.55)' : 'rgba(210,216,230,0.3)'); gr.addColorStop(0.55, 'rgba(0,0,0,0)'); gr.addColorStop(1, sun ? 'rgba(90,64,40,0.35)' : 'rgba(40,46,70,0.25)');
  g.fillStyle = gr; g.fillRect(-800, y0, W + 1600, y1 - y0);
  const r = rng(5);
  const dk = sun ? 'rgba(74,54,36,0.62)' : 'rgba(60,66,84,0.28)', lt = sun ? 'rgba(255,252,240,0.8)' : 'rgba(255,255,255,0.25)';
  for (let y = y0 - (((y0 % 80) + 80) % 80); y < y1; y += 80) {                     // form boards: a shadow under each lip, a lit edge above
    rect(g, -800, y, W + 1600, sun ? 6 : 3, dk); rect(g, -800, y - 3, W + 1600, 3, lt);
    g.fillStyle = sun ? 'rgba(120,96,66,0.12)' : 'rgba(80,86,110,0.1)'; for (let x = -800; x < W + 800; x += 210) g.fillRect(x + r() * 60, y + 8, 110 + r() * 90, 22);
  }
  for (let x = -810; x < W + 800; x += 540) { rect(g, x, y0, sun ? 9 : 4, y1 - y0, dk); rect(g, x - 4, y0, 4, y1 - y0, lt); }       // the monolith joints
  for (let y = y0 + 40 - ((((y0 + 40) % 320) + 320) % 320); y < y1; y += 320) for (let x = -170; x < W + 400; x += 270) {          // tie-bolt holes with their cast shadow
    g.fillStyle = dk; g.beginPath(); g.arc(x + 5, y + 5, 9, 0, 6.3); g.fill(); g.fillStyle = sun ? '#8a7a64' : '#8a8d98'; g.beginPath(); g.arc(x, y, 8, 0, 6.3); g.fill(); }
}
function payWall(g, t, sun) {
  // sky and the crest of the dam above the wall (visible once the camera has pulled back)
  { const gg = g.createLinearGradient(0, -1400, 0, -150); gg.addColorStop(0, P.skyTop); gg.addColorStop(1, P.skyHor); g.fillStyle = gg; g.fillRect(-800, -1400, W + 1600, 1250); }
  const cy = -260;
  for (const [tx, sg] of [[110, 1], [970, -1]]) {      // cableway towers
    g.strokeStyle = '#26262c'; g.lineWidth = 8; g.beginPath(); g.moveTo(tx - 60, cy); g.lineTo(tx, cy - 880); g.lineTo(tx + 60, cy); g.stroke();
    g.lineWidth = 3; for (let k = 1; k < 9; k++) { const y = lerp(cy, cy - 880, k / 9), hw = lerp(60, 4, k / 9); g.beginPath(); g.moveTo(tx - hw, y); g.lineTo(tx + hw, y + 30); g.moveTo(tx + hw, y); g.lineTo(tx - hw, y + 30); g.stroke(); }
  }
  g.strokeStyle = '#26262c'; g.lineWidth = 4; g.beginPath(); g.moveTo(110, cy - 880); g.quadraticCurveTo(540, cy - 700, 970, cy - 880); g.stroke();
  const bx = 540 + 220 * Math.sin(t * 0.7); g.lineWidth = 2; g.beginPath(); g.moveTo(bx, cy - 760); g.lineTo(bx, cy - 560); g.stroke(); poly(g, [[bx - 30, cy - 560], [bx + 30, cy - 560], [bx + 18, cy - 510], [bx - 18, cy - 510]], '#2a2f38'); rect(g, bx - 30, cy - 566, 60, 8, P.yellow);
  rect(g, -800, cy - 40, W + 1600, 40, '#3a3836'); rect(g, -800, cy - 52, W + 1600, 12, P.yellow);          // the crest walkway and its rail
  wallLayer(g, false, cy, 2300);
  if (sun > 0) { g.save(); if (sun < 1) { const ex = lerp(-300, W + 400, sun); g.beginPath(); g.moveTo(-400, -1400); g.lineTo(ex + 160, -1400); g.lineTo(ex - 160, 2400); g.lineTo(-400, 2400); g.closePath(); g.clip(); } wallLayer(g, true, cy, 2300);
    g.restore(); }
  if (sun > 0 && sun < 1) { const ex = lerp(-300, W + 400, sun); g.save(); g.globalAlpha = 0.55 * (1 - sun); const lg = g.createLinearGradient(ex - 90, 0, ex + 200, 0); lg.addColorStop(0, 'rgba(255,236,170,0)'); lg.addColorStop(0.5, 'rgba(255,236,170,1)'); lg.addColorStop(1, 'rgba(255,236,170,0)'); g.fillStyle = lg; g.fillRect(ex - 90, -1400, 290, 3800); g.restore(); }
}

const PAINT = {
  // b0-2: the stack swings up out of its own dust (c 0.55 -> 0); the wave starts at b1.25
  hook(g, t, b) {
    sky(g, 0, H, '#8fb0d8', '#e6eef0'); noonGround(g, 1560);
    rect(g, 0, 1440, W, 120, '#b9b0a0');
    for (let k = 0; k < 7; k++) { const x = 30 + k * 160; poly(g, [[x, 1560], [x, 1470], [x + 130, 1440], [x + 130, 1560]], '#a59c8c'); }     // sawtooth shed roofline
    const c = lerp(0.6, 0, ease.inOutCubic(clamp(b / 1.9)));     // c16: frame 0 is the felled stack lying in its dust; the rise has a beginning
    chimney(g, c, {});
    return riseWave(b, 1.25, 2.05, { amp: 200 });
  },
  rust(g, t, b) { const u = clamp((b - 2) / 1); steelBeam(g, lerp(1, 0.05, ease.inOutCubic(u)), { t }); return riseWave(b, 2, 3.1, { dir: [0.5, -1] }); },
  tower(g, t, b) {
    const u = clamp((b - 3) / 1);
    sky(g, 0, 1500, P.skyTop, P.skyHor); noonGround(g, 1500);
    const tt = coolingTower(g, 520, 1520, 1000, { rBase: 0.42, rTop: 0.3 });
    plume(g, tt.top[0], tt.top[1], ease.outCubic(u) * 0.95, { scale: 1.05, t, maxH: 520, seed: 5, wind: 0.4 });
    return riseWave(b, 3, 4.05, { amp: 240 });
  },
  welder(g, t, b) {
    const flashes = [4, 5, 5.5, 6, 6.25], n = flashes.filter(x => b >= x).length, lf = lastHit(b, flashes);
    const fl = lf == null ? 0 : Math.exp(-(b - lf) * SPB * 9);
    const age = clamp(1 - n * 0.25 + 0.25);
    shop(g, t, fl, 0);
    // a real man in a leather jacket, steps younger on each flash: walt (63), ray (39), kai (21); the hood snaps down on b6.5
    const who = n <= 1 ? 'walt_up' : n <= 3 ? 'ray_up' : 'kai_up';
    const sprite = b >= 6.6 ? 'kai_dn' : b >= 6.5 ? 'kai_h5' : who;
    welderSprite(g, sprite, { sc: 1.3, hx: 500, hy: 900, bright: 0.45 + 0.75 * fl + 0.06 * Math.sin(t * 80) });
    return clamp(age * 0.9);          // the medium steps younger with him
  },
  black(g) { rect(g, 0, 0, W, H, '#000'); return 0; },
  noon(g, t, b, s0) {
    const lb = b - s0;
    fortressNoon(g, { hor: 1400, s: 0.74, cx: 600, t });
    RK.compose(g, crowds.noon, t, { style: NOON, sun: [300, 700], ground: false, gapAmt: 0.18 });
    return s0 === 8 ? riseWave(b, 8, 10, { amp: 260 }) : 0;
  },
  master(g, t, b, s0) {
    const lb = b - s0;
    if (s0 === 10) {                  // MASTER over a man: young, the hood up, his face in the arc
      const fl = Math.exp(-lb * SPB * 7);
      shop(g, t, fl, 0);
      welderSprite(g, 'kai_up', { sc: 1.3, hx: 500, hy: 900, bright: 0.55 + 0.7 * fl });
      return 0;
    }
    // b56-60, one bar on one shot: he is young, the hood down, the arc held steady and building; on b59 the arc dies, the hood
    // lifts and he turns to look at what has been made. Then daylight.
    const arcOn = b < 59.0, k = arcOn ? 0.55 + 0.35 * clamp((b - 56) / 3) : 0.0;
    const fl = arcOn ? 0.55 + 0.35 * clamp((b - 56) / 3) : Math.exp(-(b - 59) * SPB * 6) * 0.5;
    shop(g, t, fl, 0, arcOn ? 1 : 0.05 + 0.3 * Math.exp(-(b - 59) * SPB * 5));
    const sprite = b < 59.0 ? 'kai_dn' : b < 59.25 ? 'kai_h5' : b < 59.6 ? 'kai_mid' : 'kai_look';
    const dim = arcOn ? 0.6 + 0.5 * k : 0.28 + 0.2 * Math.exp(-(b - 59) * SPB * 5);
    welderSprite(g, sprite, { sc: 1.3, hx: 500 + (b >= 59.6 ? 20 : 0), hy: 900, bright: dim });
    return 0;
  },
  steel(g, t, b) { steelBeam(g, 0, { t }); arcLight(g, 760, 820, 0.35, t, { sparks: 30, big: 0.7 }); return 0; },
  arc(g, t, b) { rect(g, 0, 0, W, H, '#05060a'); arcLight(g, 540, 1060, 1, t, { sparks: 140, big: 1.9 }); return 0; },
  clock(g, t, b) {
    const u = (b - 14) * SPB;              // hands run backwards, accelerating
    punchClock(g, -0.9 - u * u * 2.2, -0.2 - u * u * 26);
    return riseWave(b, 14, 15.1, { dir: [0, -1] });
  },
  roll(g, t, b, s0) {
    const i = Math.round((s0 - 15) * 4);
    if (i === 0) { sky(g, 0, H, '#8fb0d8', '#e6eef0'); noonGround(g, 1560); chimney(g, 0, {}); }
    else if (i === 1) { sky(g, 0, 1500, P.skyTop, P.skyHor); noonGround(g, 1500); const tt = coolingTower(g, 520, 1520, 1000); plume(g, tt.top[0], tt.top[1], 1, { scale: 1.05, t, maxH: 520, seed: 5, wind: 0.4 }); }
    else if (i === 2) steelBeam(g, 0, { t });
    else { const u = (b - 14) * SPB; punchClock(g, -0.9 - u * u * 2.2, -0.2 - u * u * 26); }
    return 0;
  },
  // REBUILD.: a long brick mill rises out of its rubble (the hook's move at the scale of a works)
  rebuild(g, t, b) {
    const u = ease.outCubic(clamp((b - 15.9) / 1.4));
    sky(g, 0, 1450, P.skyTop, P.skyHor); noonGround(g, 1450);
    const top = lerp(1450, 760, u);
    g.save(); g.beginPath(); g.rect(0, 0, W, 1452); g.clip();
    const bx0 = -40, bx1 = W + 40, hh = 1450 - 760;
    const y0 = top;                         // the facade is drawn whole and slides up out of the ground
    rect(g, bx0, y0, bx1 - bx0, hh, P.brick);
    for (let k = 0; k < 7; k++) { const x = 20 + k * 160; rect(g, x, y0 + 150, 96, 330, '#23324a'); g.fillStyle = '#23324a'; g.beginPath(); g.arc(x + 48, y0 + 150, 48, Math.PI, 0); g.fill(); rect(g, x + 44, y0 + 110, 8, 370, P.brick); rect(g, x, y0 + 300, 96, 8, P.brick); rect(g, x + 96, y0 + 110, 20, 380, P.brickSh); }
    rect(g, bx0, y0, bx1 - bx0, 40, P.brickSh); rect(g, bx0, y0 + 520, bx1 - bx0, 26, '#e7ddc8');
    for (let k = 0; k < 6; k++) poly(g, [[k * 200 - 40, y0], [k * 200 + 60, y0 - 90], [k * 200 + 60, y0], [k * 200 + 160, y0]], k % 2 ? '#8e97a2' : '#b9c0c7');     // sawtooth roof
    g.restore();
    // the dust sucking back into the foot of the wall, the rubble line shrinking
    const d = 1 - u; g.fillStyle = 'rgba(210,192,160,0.8)';
    for (let i = 0; i < 40; i++) { const r = rng(i + 3); const x = r() * W, y = 1450 - r() * 260 * d, rad = (40 + 90 * r()) * d; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); }
    rect(g, 0, 1440, W, 80 * d + 6, P.brickSh);
    return riseWave(b, 15.9, 16.55, { amp: 220 });
  },
  electrify(g, t, b) {
    const u = clamp((b - 18) / 1.2);
    const hor = plains(g, { hor: 980, river: false, rail: false });
    const tt = coolingTower(g, 900, hor + 4, 170, { rBase: 0.4 }); plume(g, tt.top[0], tt.top[1], 0.3 + 0.7 * u, { scale: 0.4, t, maxH: 900, seed: 8 });
    // pylons marching toward the horizon, the four conductors lighting pylon to pylon from the camera outward
    const ps = []; for (let k = 0; k < 7; k++) { const z = Math.pow(1.72, k), x = 540 - 250 / z * 1.4 - k * 6, base = hor + 950 / z; ps.push(pylon(g, x + 20, base, 1300 / z)); }
    const lit = u * 7;
    for (let c = 0; c < 4; c++) { for (let k = 0; k < ps.length - 1; k++) {
      const a = ps[k][c], bb = ps[k + 1][c]; const on = clamp(lit - k);
      g.strokeStyle = on > 0 ? lerpCol('#141112', '#fff6d0', on) : '#141112'; g.lineWidth = Math.max(1.2, 4 / Math.pow(1.72, k));
      g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo((a[0] + bb[0]) / 2, (a[1] + bb[1]) / 2 + 60 / Math.pow(1.5, k), bb[0], bb[1]); g.stroke(); } }
    return riseWave(b, 17.9, 18.6, { dir: [-0.3, -1] });
  },
  pour(g, t, b) {
    const lv = 1 + (b - 20) * 2.2;   // a level on every kick
    // c21: pulled back so the canyon frames the pour (at 1.02 the blocks filled the frame edge to edge and read as a bar chart),
    // with the river below the works
    sky(g, 0, 1480, P.skyTop, P.skyHor); noonGround(g, 1480);
    { const wg = g.createLinearGradient(0, 1500, 0, H); wg.addColorStop(0, '#5f8fa8'); wg.addColorStop(1, '#2f5a73'); g.fillStyle = wg;
      g.beginPath(); g.moveTo(330, 1500); g.lineTo(760, 1500); g.lineTo(1180, H); g.lineTo(-100, H); g.closePath(); g.fill();
      g.fillStyle = 'rgba(230,240,245,0.35)'; for (let k = 0; k < 14; k++) { const y = 1520 + k * k * 2.2, w = 40 + k * 12; g.fillRect(540 - w / 2 + 40 * Math.sin(t + k), y, w, 2 + k * 0.3); } }
    dam(g, 545, 1500, 0.7, { levels: lv, t });
    return 0;
  },
  becher(g, t, b) {
    const push = lerp(1, 3.0, ease.inOutCubic(clamp((b - 22) / 5.6)));      // the grid pushes in to one tower over its 2.4 s
    rect(g, 0, 0, W, H, '#f1eee6'); g.save(); g.translate(540, 969); g.scale(push, push); g.translate(-540, -969);
    const BE = [22, 22.75, 23.5, 24, 24.75, 25.5, 26, 26.75, 27.5], order = [4, 0, 8, 2, 6, 1, 7, 3, 5];
    const cw = 304, chh = 430, gx = 24, x0 = 60, y0 = 300;
    for (let i = 0; i < 9; i++) {
      const r = rng(i * 17 + 3), col = i % 3, row = Math.floor(i / 3), x = x0 + col * (cw + gx), y = y0 + row * (chh + gx);
      const idx = order.indexOf(i), on = b >= BE[idx], age = on ? Math.min(1, (b - BE[idx]) * SPB / 0.12) : 0;
      g.save(); g.beginPath(); g.rect(x, y, cw, chh); g.clip(); g.translate(x, y);
      const hor = chh * (0.84 + 0.06 * r());
      const sg = g.createLinearGradient(0, 0, 0, hor); sg.addColorStop(0, P.skyTop); sg.addColorStop(1, P.skyHor); g.fillStyle = sg; g.fillRect(0, 0, cw, hor);
      rect(g, 0, hor, cw, chh - hor, '#cfc6b2');
      const tt = coolingTower(g, cw * (0.45 + 0.1 * r()), hor + 2, chh * (0.55 + 0.25 * r()), { waist: 0.55 + 0.15 * r(), rBase: 0.36 + 0.1 * r(), rTop: 0.24 + 0.08 * r(), struts: r() < 0.6 });
      plume(g, tt.top[0], tt.top[1], on ? ease.outCubic(clamp(age * 0.4 + (b - BE[idx]) * 0.35)) : 0, { scale: 0.35, t, maxH: 900, seed: i, wind: 0.35 });
      if (!on) { g.globalCompositeOperation = 'saturation'; rect(g, 0, 0, cw, chh, '#808080'); g.globalCompositeOperation = 'multiply'; rect(g, 0, 0, cw, chh, '#b8b4ac'); g.globalCompositeOperation = 'source-over'; }
      g.restore();
    }
    g.restore();
    return 0;
  },
  coast(g, t, b) {
    const hor = 1240; sky(g, 0, hor, P.skyTop, P.skyHor); rect(g, 0, hor - 10, W, 14, '#9aa8a0');
    const r = rng(9);
    for (let k = 0; k < 13; k++) { const x = 20 + k * 84 + r() * 30, hh = 60 + r() * 60;
      if (k % 3 === 1) { poly(g, [[x - 7, hor], [x + 7, hor], [x + 5, hor - hh * 1.6], [x - 5, hor - hh * 1.6]], '#8c8680'); plume(g, x, hor - hh * 1.6, 0.6 + 0.4 * Math.sin(t + k), { scale: 0.2, t, maxH: 1600, seed: k, wind: 0.6 }); }
      else { const tt = coolingTower(g, x, hor, hh, { struts: false }); plume(g, tt.top[0], tt.top[1], 0.5 + 0.5 * clamp((b - 28) - k * 0.12), { scale: 0.22, t, maxH: 1400, seed: k, wind: 0.5 }); } }
    const gr = g.createLinearGradient(0, hor, 0, H); gr.addColorStop(0, P.wheatSh); gr.addColorStop(1, P.wheat); g.fillStyle = gr; g.fillRect(0, hor, W, H - hor);
    g.strokeStyle = 'rgba(90,60,20,0.25)'; g.lineWidth = 2; for (let k = -40; k <= 40; k++) { g.beginPath(); g.moveTo(540 + k * 5, hor); g.lineTo(540 + k * 120, H); g.stroke(); }
    return 0;
  },
  redCrowd(g, t, b, s0) {
    // the red room returns six times and builds: each visit a step closer, hotter (deep red, orange, a white-yellow core), the banner
    // bigger with its gold emblem; the last one, after FOUNTAIN OF YOUTH., shows the furnace: the pour in the aperture
    const k = Math.max(0, RED_VISITS.indexOf(Math.floor(s0))) / (RED_VISITS.length - 1);
    redRoom2(g, { k, t, furnace: k >= 0.99, aperture: [310, 360, 460, 820] });
    const cr = crowds.red; RK.hit(cr, bt(Math.floor(s0)), { from: [540, 1900], speed: 110, jitter: 3 });
    RK.compose(g, cr, t, { style: RED, sun: [540, 700], ground: false, gapAmt: 0.2 });
    banner(g, t, k);
    return 0;
  },
  riseDay(g, t, b, s0) {
    const step = s0 === 32 ? 0 : 1, lift = step * 300;       // the camera steps up the fortress face
    sky(g, 0, H, P.skyTop, P.skyHor);
    g.save(); g.translate(0, lift); dam(g, 540, 1560, 1.55, { shadow: false, t }); g.restore();
    noonGround(g, 1560 + lift * 0 + 0);
    const cr = crowds.rise; RK.hit(cr, bt(s0), { from: [540, 1990], speed: 120, jitter: 3 });
    RK.compose(g, cr, t, { style: NOON, sun: [260, 500], ground: false, gapAmt: 0.16 });
    return 0;
  },
  riseRed(g, t, b, s0) { return PAINT.redCrowd(g, t, b, s0); },
  card(g, t, b) {
    // c21: no stamp (the client: the stamp graphic is out). The card goes in on b36 and the day starts: the clock's hands, which ran
    // backwards through OF TIME., now run forward
    const u = clamp((b - 35.8) / 0.2), run = b >= 36 ? (b - 36) * SPB : 0;
    punchClock(g, -0.9 + run * 0.35, -0.2 + run * 4.2, { card: u, stamp: 0 });
    return 0;
  },
  shadows(g, t, b) {            // the day of shadows: the fortress's shadow swings across the plaza in 2 beats
    const u = clamp((b - 37) / 2), a = lerp(-1.3, 1.3, u);
    const top = lerpCol('#e38a4a', P.skyTop, Math.sin(u * Math.PI)), hor = lerpCol('#f5c89a', P.skyHor, Math.sin(u * Math.PI));
    sky(g, 0, 1200, top, hor); noonGround(g, 1200);
    const f = dam(g, 540, 1210, 0.62, { shadow: false, t });
    g.save(); g.globalAlpha = 0.55; const len = 700 / Math.max(0.35, Math.cos(a));
    poly(g, [[540 - 280, 1210], [540 + 330, 1210], [540 + 330 - Math.sin(a) * len, 1210 + 260 + Math.cos(a) * 200], [540 - 280 - Math.sin(a) * len, 1210 + 260 + Math.cos(a) * 200]], '#3e3a3a'); g.restore();
    const cr = crowds.walk; cr.surge = (f2, tt) => ({ dx: ((tt * 60 + f2.x) % 1500) - f2.x - 200, dy: 0, k: 1 });
    RK.compose(g, cr, t, { style: NOON, sun: [540 + Math.sin(a) * 600, 700], ground: false, gapAmt: 0 });
    return 0;
  },
  carve(g, t, b) {
    concreteWall(g, { shift: (b - 40) * 20 });
    // a band of the town below the wall's foot
    g.save(); g.beginPath(); g.rect(0, 1330, W, H - 1330); g.clip(); townOblique(g, { t, p: 0.6, hor: 1380, f: 520, camH: 1.7 }); g.restore();
    rect(g, 0, 1318, W, 16, '#8f8a82');
    return { a0: 0, a1: 1, dir: [0.35, -1], F: lerp(-H - 300, 400, ease.inOutCubic(clamp((b - 39.55) / 0.5))), amp: 220 };
  },
  town(g, t, b) {
    townOblique(g, { t, p: ease.inOutCubic(clamp((b - 42) / 1.6)), hor: 760 });
    return { a0: 0, a1: 1, dir: [0.7, -1], F: lerp(-2200, 800, ease.inOutCubic(clamp((b - 41.9) / 1.3))), amp: 300 };
  },
  plains(g, t, b) {
    const hor = plains(g, { hor: 1020, t });
    const f = dam(g, 820, hor + 6, 0.2, { shadow: false, t });
    const tt = coolingTower(g, 980, hor + 2, 70, { struts: false }); plume(g, tt.top[0], tt.top[1], 1, { scale: 0.18, t, maxH: 1600, seed: 4, wind: 0.8 });
    for (let k = 0; k < 6; k++) { const z = Math.pow(1.6, k); pylon(g, 170 + 240 / z, hor + 900 / z, 1100 / z, { col: '#1e1a1a' }); }
    return 0;
  },
  furnace(g, t, b) {             // the red room, pulled back: it is the mouth of the furnace
    const u = ease.inOutCubic(clamp((b - 48.5) / 1.3)), s = lerp(3.4, 1, u);
    g.save(); g.translate(540, 760); g.scale(s, s); g.translate(-540, -760);
    rect(g, -2000, -2000, 5000, 6000, '#120a08');
    for (let k = 0; k < 18; k++) rect(g, -400 + k * 110, -600, 8, 3000, '#1d1310');              // corrugated shed wall
    rect(g, 380, 560, 320, 400, '#2a0404');
    g.save(); g.beginPath(); g.rect(400, 580, 280, 360); g.clip(); g.translate(400, 580); g.scale(280 / W, 360 / H * 1.1); redRoom(g, { aperture: [310, 360, 460, 820] }); g.restore();
    rect(g, 340, 520, 400, 40, '#3a2a22'); rect(g, 330, 960, 420, 30, '#1a100c');
    rect(g, -2000, 1420, 5000, 3000, '#1c0d09');
    backFigure(g, 560, 1470, 330, { hat: 'hard', rimSide: 1, rim: '#ff7a4a', ink: '#070303' });
    g.restore();
    const gl2 = g.createRadialGradient(540, 1500, 40, 540, 1500, 900); gl2.addColorStop(0, `rgba(255,70,30,${0.5 * u})`); gl2.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gl2; g.fillRect(0, 900, W, H - 900);
    return 0;
  },
  // Cranach's track: old on the left, the pour as the fountain in the centre, the young on the right
  cranach(g, t, b) {
    const smoothstep01 = x => x * x * (3 - 2 * x);
    // c20 (client): the molten steel is the fountain of youth, and it develops: close on the lip, pulling back to the bay; the
    // stream thickens, the mould fills with light, and youth spreads out of the stream until the whole frame is young (b52)
    const u = clamp((b - 48) / 4), cam = -u * 240, ue = ease.inOutCubic(u), z = lerp(1.75, 1, ue);
    // a daylit casting bay: roof lights, steel columns, the crane girder; the pour is the fountain in the centre
    { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#c9d0d8'); gr.addColorStop(0.4, '#9aa3b0'); gr.addColorStop(1, '#4e5664'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
    g.save(); g.translate(815, 1000); g.scale(z, z); g.translate(-815, -1000); g.translate(cam, 0);
    for (let k = -3; k < 16; k++) { rect(g, k * 150 - 20, 90, 110, 70, '#d9e4ee'); }                       // roof lights
    rect(g, -600, 160, 2600, 40, '#3c4350');
    rect(g, -600, 200, 2600, 440, '#dfe5ea');                                                                    // the lit clerestory wall
    for (let k = -3; k < 16; k++) { rect(g, k * 180, 640, 36, 860, '#4a5261'); rect(g, k * 180 + 36, 640, 12, 860, '#8e98a8'); }
    rect(g, -600, 640, 2600, 60, '#2e3440'); rect(g, -600, 700, 2600, 10, P.yellow);                         // crane girder
    rect(g, -600, 1480, 2600, 600, '#3a3430'); rect(g, -600, 1480, 2600, 14, '#8c8278');
    const lx = 600, ly = 900;
    g.strokeStyle = '#1e2229'; g.lineWidth = 12; g.beginPath(); g.moveTo(lx - 90, 700); g.lineTo(lx - 120, 760); g.moveTo(lx + 90, 700); g.lineTo(lx + 160, 780); g.stroke();
    g.save(); g.translate(lx, ly); g.rotate(0.62);
    poly(g, [[-190, -200], [190, -200], [150, 210], [-150, 210]], '#26282d'); poly(g, [[-190, -200], [-120, -200], [-90, 210], [-150, 210]], '#3d4048');
    rect(g, -200, -225, 400, 36, '#1a1b1f'); poly(g, [[-190, -190], [190, -190], [180, -160], [-180, -160]], '#ffb040'); g.restore();
    const sx = lx + 215, sy = ly - 30;
    for (let w = 5; w >= 1; w--) { g.strokeStyle = ['#ff5a14', '#ff8a1e', '#ffc040', '#ffe79a', '#fffbe8'][5 - w]; g.lineWidth = w * 16 * (1 + 0.5 * ue); g.beginPath(); g.moveTo(sx, sy); g.bezierCurveTo(sx + 170, sy - 80, sx + 190, sy + 360, sx + 170, 1420); g.stroke(); }
    rect(g, sx + 40, 1400, 280, 100, '#141212'); { const fh = 22 + 70 * ue; rect(g, sx + 60, 1422 - fh, 240, fh, '#ffb040'); rect(g, sx + 80, 1422 - fh, 200, Math.max(4, fh * 0.35), '#fff1c0'); }   // the mould filling
    arcLight(g, sx + 170, 1420, 0.55, t, { sparks: 140, seed: 9, big: 1.2 });
    const gl2 = g.createRadialGradient(sx + 170, 1300, 40, sx + 170, 1300, 1000); gl2.addColorStop(0, 'rgba(255,140,40,0.4)'); gl2.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gl2; g.fillRect(-600, 0, 2600, H);
    g.restore();
    const cr = crowds.shift; cr.surge = (f, tt) => ({ dx: ((tt * 150 + f.x + 3000) % 1500) - f.x - 200, dy: 0, k: 1 });
    RK.compose(g, cr, t, { style: { ...RANK_STYLES.day, ink: ['#161416', '#2a262a', '#3c383c', '#4e4a4e', '#605c60'], rim: '#ffb46a' }, sun: [sx + 170 + cam, 1300], ground: false, gapAmt: 0 });
    const F0 = 815 + (sx + 120 + cam - 815) * z, F = lerp(F0, -260, smoothstep01(clamp((u - 0.3) / 0.7)));   // youth spreads out of the stream to the whole frame
    return { a0: 1, a1: 0, dir: [1, 0], F, amp: 90, w: 12 };
  },
  flourish(g, t, b) {
    const hor = plains(g, { hor: 1240, t, river: true, rail: false });
    dam(g, 760, hor + 8, 0.3, { shadow: false, t });
    const tt = coolingTower(g, 180, hor + 4, 110, {}); plume(g, tt.top[0], tt.top[1], 1, { scale: 0.26, t, maxH: 1600, seed: 6 });
    RK.compose(g, crowds.noon, t, { style: NOON, sun: [300, 700], ground: false, gapAmt: 0.12 });
    return 0;
  },
  pourClose(g, t, b) {
    rect(g, 0, 0, W, H, '#140f0d');
    for (let w = 5; w >= 1; w--) { g.strokeStyle = ['#ff5a14', '#ff8a1e', '#ffc040', '#ffe79a', '#fffbe8'][5 - w]; g.lineWidth = w * 34; g.beginPath(); g.moveTo(-100, 300); g.bezierCurveTo(500, 200, 640, 900, 620, 2000); g.stroke(); }
    arcLight(g, 620, 1500, 0.9, t, { sparks: 160, seed: 12, big: 2 });
    return 0;
  },
  payoff(g, t, b, s0) {
    const k = camK(b), sun = sunK(b);
    g.save(); applyCam(g, k);
    payWall(g, t, sun);
    // the mark, cut into the face at twice the size, the red wiped into it
    if (b < 68) {
      const my = 395, ms = 270; const lit = sun > 0.5;
      g.save(); g.globalAlpha = 0.85; acpEmblem(g, 520 - 6, my - 4, ms, { color: '#3a2a22' }); g.restore();
      g.save(); g.globalAlpha = 0.5; acpEmblem(g, 520 + 4, my + 4, ms, { color: lit ? '#fff6dc' : '#d5d8e0' }); g.restore();
      acpEmblem(g, 520, my, ms, { color: null });
    }
    const cr = crowds.pay; const hh = lastHit(b, [60, 62, 63, 64, 65, 68]); RK2.hit(cr, bt(hh), { from: [540 + PX, 2100], speed: 130, jitter: 2 });
    payG.clearRect(0, 0, PW, PH); RK2.compose(payG, cr, t, { style: NOON, sun: [300 + PX, 600], ground: false, gapAmt: 0.1 });
    g.drawImage(payCv, -PX, 0);
    g.restore();
    return 0;
  },
  standing(g, t, b) { sky(g, 0, H, '#8fb0d8', '#e6eef0'); noonGround(g, 1560); rect(g, 0, 1440, W, 120, '#b9b0a0');
    for (let k = 0; k < 7; k++) { const x = 30 + k * 160; poly(g, [[x, 1560], [x, 1470], [x + 130, 1440], [x + 130, 1560]], '#a59c8c'); }
    chimney(g, 0, {}); return 1; },
  closer(g, t, b) {             // time runs forward: the stack falls toward frame 0's state (c 0 -> 0.55)
    sky(g, 0, H, '#8fb0d8', '#e6eef0'); noonGround(g, 1560); rect(g, 0, 1440, W, 120, '#b9b0a0');
    for (let k = 0; k < 7; k++) { const x = 30 + k * 160; poly(g, [[x, 1560], [x, 1470], [x + 130, 1440], [x + 130, 1560]], '#a59c8c'); }
    const u = clamp((b - 64) / 4); chimney(g, lerp(0, 0.4, ease.inCubic(u)), {});
    return 1;
  },
};

// ================================================================ frame
window.renderFrame = async (t) => {
  const b = t / SPB + 1e-6;
  const si = shotAt(b), [s0, id] = SHOTS[si];
  yg.save(); yg.clearRect(0, 0, W, H);
  // 3-32 s: one continuous rising camera carried across the cuts (the content slides down and grows a little, so the frame climbs)
  const rise = (b >= 3 && b < 32 && id !== 'black' && id !== 'becher') ? 190 * clamp((b - 3) / 29) : 0;
  if (rise > 0) { yg.translate(0, rise); yg.translate(540, H); yg.scale(1.1, 1.1); yg.translate(-540, -H); }
  const age = PAINT[id](yg, t, b, s0);
  yg.restore();
  agePass(t, age, id === 'black' ? 0 : 0.035);
  // words
  for (const c of CUES) if (b >= c.b && b < c.e) {
    if (c.carve === 'pay') { out.save(); applyCam(out, camK(b)); drawCarved(out, c, 0, sunK(b)); out.restore(); }
    else if (c.carve) drawCarved(out, c);
    else drawCue(out, c, b);
  }
  // the last blow (b68): the lockup lands on it, bigger, and holds 3.2 s on the pulled-back wall; the sound rings out under it
  if (b >= 68) {
    const a = (b - 68) * SPB, k = 1 + 0.08 * Math.exp(-a * 16);
    const fl = Math.exp(-a * 22) * 0.35; if (fl > 0.01) { out.save(); out.globalAlpha = fl; out.fillStyle = '#fff6dc'; out.fillRect(0, 0, W, H); out.restore(); }
    out.save(); out.globalAlpha = 0.9; out.fillStyle = 'rgba(239,227,200,0.0)'; out.restore();
    sigil(out, 540, 860, 215 * k, { color: '#1b120c', accent: C.red2 });
    out.save(); out.fillStyle = '#1b120c'; out.font = '70px "Archivo Black"'; out.textAlign = 'center'; out.fillText('ACP.US', 540, 1080); out.restore();
  }
};
window.typeInfo = () => CUES;
window.sceneReady = true;
