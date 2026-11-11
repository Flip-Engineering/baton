// HORDE v23 (c23, 5 Oct; the client on v22: the montage 'ends ... with building pace and impactful music way too early, need to deepen and grow larger and more impactful ... a hype
// montage of infrastructure and labor/the masses'; 'the crowd view should ... break into the logo from a view that is already from above and already transitioned to very logically from
// an aerial shot of humans not from a close up'; 'Opening pace could pick up sooner and there should be an audio/music impact (not literal) to the text crawls in the opening segments'):
//   the opening cuts on every line of the first sentence (b0 the line of riders, b2 riders pouring down a rise, b4 wagons tearing across the lens, b6 the row on the horizon);
//   the montage is 32 beats, not 16, in three movements: THE WORK (the plough, the dig, the derrick, the ladle, the beams), THE SCALE (the city, the frames, the castings by the hundred,
//   the pours, the camps, the trains), THE MASSES (the ferry packed to the rails, its deck from above, the crowd pouring off it, the street from straight above);
//   the fourth ALL OF IT. lands on the crowd from straight above, a field of men filling the frame at the street's own scale; the men of the mark close into it and the rest stream
//   off both sides, so the mark is what the crowd leaves standing, while the camera rises.  (song: horde_c23.py)
// HORDE v19 (c16: the gather as a front sweeping top to bottom; the payoff on a lit plain at night: red at the horizon, stars only in the sky, a warm pool on the ground under every light, varied lights, low smoke; one mark at the end: the crowd-mark sinks to embers as the lockup comes up among the stars)
// HORDE v17 (c14, the horde becomes the mark): one red film world, and one move: the horde of history is the working class, and it gathers itself into the Party's mark, and goes on from the steppe to the stars.
//
//   b0-8    riders in hats at full gallop against the red sky (Tumbleweeds 1925, public domain)                     WE WILL NEVER / ALLOW THEM / TO PACE / OUR FRONTIER.   (built a line to a stress, held whole)
//   b8-12   the riders' own pixels land as the track gang heaving ties, the engine behind them (The Iron Horse 1924, the track-laying race)
//   b12-20  the engine head-on, the cowcatcher                                                                      WE DEMAND / NOTHING LESS / THAN ALL / THAT EXISTS.
//   b20-28  the train streaming with the gangs on it, the men laying the rail                                       UNRELENTING / HUMAN / FLOURISHING.
//   b28-32  ALL OF IT. on four hits: a rider, the train, the rail gang, the sea of workers hats
//   b32-48  the sea of hats leaves its place: every patch of it is a man, and the men run in from every side and settle into the mark, while the camera rises over them; the mark is only the shape the crowd fills
//   b48-58  the camera tilts up off the crowd-mark to the horizon of riders and wagons; dusk, then stars in the sky only      FROM THE STEPPE / TO THE STARS.
//   b58-60  the camera comes down onto the crowd-mark at night
//   b60-64  the payoff, ALL OF IT.: a light in each man's hands, the mark burning in its own shape; then the lockup over the same picture
// Every frame is a pure function of t. Plates are baked by horde3.bake.py into videos/out/.horde_c15 (540x960 gray, 24 fps); the grade, grain, gate weave, the night key, the pixel-flight dissolve and the crowd
// (one GL point per man: a patch of the film's own crowd, carried to its place in the mark, with its shadow) are the GL passes below.
import { W, H, C, loadFonts, loadBeats, Beats, clamp, lerp, smooth, ease, rng, Finish, BRAND, sigil, line, tinted } from '../lib/kit.js';
import { loadFace } from '../lib/fx/type.js';
import { SAFE, setBlock, measure, chantAt, typeAudit, riso } from '../lib/fx/type_world.js';

const ctx = document.getElementById('out').getContext('2d');
await loadFonts();
const Q = new URLSearchParams(location.search);
const QB = Q.get('beats');
const Bt = QB ? new Beats(await (await fetch(QB)).json()) : await loadBeats('horde3');
const spb = Bt.spb;
const finish = new Finish(1776);
const fr = x => x - Math.floor(x);

// ================================================================ timeline (beats; 144 BPM, one beat = one stride of the gallop)
const SIDX = await (await fetch('../assets/horde/plates/index.json')).json();     // c22: plates in the repo (web/assets/horde/plates) so the farm can render
const T = { dissA: 8, dissB: 10.5, loco: 12, flat: 20, mass: 24, chant: 28, hats: 31, crowd: 32, done: 48, tiltUp: 48.5, tiltTop: 52.6, tiltDn0: 57, tiltDn1: 60, payoff: 60, close: 64 };
// one plate playing: shot, off (s into it), rate, camera z0->z1 about c0->c1 (plate uv), speed blur (plate uv)
const SEG = {
  r0:    { b0: 0,    b1: 2,    shot: 'tw_line',   off: 0.0,  rate: 0.85, z: [1.55, 1.85], c: [[0.5, 0.56], [0.5, 0.57]], blur: 0.004, gr: [0.06, 0.98, 1.15, 0.30] },
  rise:  { b0: 2,    b1: 4,    shot: 'tw_rise',   off: 0.45,  rate: 1.0,  z: [1.15, 1.25], c: [[0.5, 0.52], [0.5, 0.53]], blur: 0.004, gr: [0.06, 0.98, 1.15, 0.30] },
  rush:  { b0: 4,    b1: 6,    shot: 'tw_rush2',  off: 0.6,  rate: 1.0,  z: [1.0, 1.1],   c: [[0.5, 0.5], [0.5, 0.5]], blur: 0.004, gr: [0.06, 0.98, 1.15, 0.30] },
  r1:    { b0: 6,    b1: 10.5, shot: 'tw_row',    off: 0.4,  rate: 1, pp: true,   z: [1.6, 1.75],  c: [[0.5, 0.43], [0.5, 0.44]], blur: 0.004, gr: [0.06, 0.98, 1.15, 0.30] },
  heave: { b0: 8,    b1: 12,   shot: 'rg_heave',  off: 0.0,  rate: 0.95, z: [1.0, 1.06],  c: [[0.5, 0.5], [0.5, 0.5]], blur: 0.0, gr: [0.05, 0.92, 1.15, 0.25] },
  loco:  { b0: 12,   b1: 20,   shot: 'ih_loco',   off: 0.0,  rate: 0.72,  z: [1.2, 1.4],  c: [[0.5, 0.60], [0.5, 0.60]], blur: 0.0 },
  flat:  { b0: 20,   b1: 24,   shot: 'ih_flat',   off: 0.0,  rate: 1.0,  z: [1.0, 1.05],  c: [[0.5, 0.5], [0.5, 0.5]], blur: 0.0 },
  mass:  { b0: 24,   b1: 28,   shot: 'rg_mass',   off: 0.3,  rate: 1.0,  z: [1.0, 1.1],   c: [[0.5, 0.5], [0.5, 0.5]], blur: 0.0, gr: [0.05, 0.95, 1.2, 0.2] },
  c1:    { b0: 28,   b1: 29,   shot: 'tw_rider',  off: 0.4,  rate: 1,    z: [1.5, 1.6],   c: [[0.5, 0.62], [0.5, 0.62]], blur: 0.004 },
  c2:    { b0: 29,   b1: 30,   shot: 'ih_train',  off: 0.0,  rate: 1,    z: [1.0, 1.1],   c: [[0.5, 0.55], [0.5, 0.55]], blur: 0.0 },
  c3:    { b0: 30,   b1: 31,   shot: 'rg_heave2', off: 1.0,  rate: 1,    z: [1.0, 1.08],  c: [[0.5, 0.5], [0.5, 0.5]], blur: 0.0, gr: [0.05, 0.92, 1.15, 0.25] },
  hats:  { b0: 31,   b1: 32,   shot: 'ih_hats',   off: 0.1,  rate: 0.9,  z: [1.06, 1.06], c: [[0.5, 0.5], [0.5, 0.5]], blur: 0.0 },
  sky:   { b0: 48,   b1: 72,   shot: 'tw_hor2',   off: 0.0,  rate: 0.42, pp: true, hor: 0.655, z: [1.38, 1.38], c: [[0.5, 0.5], [0.5, 0.5]], blur: 0.002, gr: [0.05, 0.95, 1.05, 0.15] },
};
const ORDER = ['r0', 'rise', 'rush', 'r1', 'heave', 'loco', 'flat', 'mass', 'c1', 'c2', 'c3', 'hats'];
// ================================================================ c22 (3 Oct): THE FRONTIER MONTAGE. The client on v20: 0-15 s and 15-30 s are basically perfect but the move between them makes
// no visual sense; add transitional scenes and lengthen; show the frontier's rapid expansion, the building of 19th-20th century America, in the 0-15 s look and pace,
// then go on into the steppe-to-stars half. So after the third ALL OF IT. hit (beat 31) the film keeps galloping through the country being built, the cuts
// quickening from a stride and a half to half a stride, and lands on a crowd of hats from above that hands to the Iron Horse sea of hats (the fourth hit), which
// becomes the crowd and the mark as before. MONT_AT/MONT_LEN in PLAYING beats; everything from the old beat 31 on plays MONT_LEN beats later (song: horde_c22.py).
// c23 (5 Oct): 32 beats in three movements, the scale growing all the way: THE WORK (cuts of 1.5 -> 1 beat), THE SCALE (0.75 -> 0.5), THE MASSES (held longer, each bigger than the
// last, ending from straight above on the street, which hands to the crowd field at the same scale).
const MONT_AT = 31, MONT_LEN = 32;
const MONT = [
  ['fm_tract', 1.5], ['pl_disc', 1], ['fm_dig', 1], ['fm_derrick', 1], ['mh_ladle', 1.5], ['fm_beam', 1], ['fm_rider', 1], ['fm_towers', 1], ['ps_tap', 1], ['mh_pour', 1], ['pl_comb', 1],
  ['fm_city', 0.75], ['fm_frame', 0.75], ['fm_girder', 0.75], ['mh_chains', 0.75], ['fm_trucks', 0.75], ['fm_town', 0.75], ['ps_ladle', 0.75], ['fm_runner', 0.5], ['mh_blocks', 0.75],
  ['pl_echelon', 0.5], ['fm_catwalk', 0.5], ['fm_loco', 0.5], ['ps_run', 0.5], ['mh_cupola', 0.5], ['ps_ingot', 0.5], ['fm_pour', 0.5], ['ih_flat', 0.75], ['rg_mass', 1.25],
  ['mn_ferry2', 1.5], ['mn_ferry', 1.5], ['mn_close', 1.5], ['mn_pour', 2], ['mn_street', 1.5]];
// framing per shot (from the c22 stills): the tractors small under a big sky -> into the ground; the moulds and the engine dark -> lifted; the tent camp a strip -> closer
const MONT_FIX = { fm_tract: { z: [1.75, 1.95], c: [[0.5, 0.82], [0.52, 0.82]] }, fm_runner: { gr: [0.0, 0.62, 0.85, 0.1] }, fm_loco: { gr: [0.02, 0.8, 0.95, 0.15] },
  fm_catwalk: { z: [1.7, 1.85], c: [[0.5, 0.56], [0.5, 0.56]] }, mh_cupola: { off: 1.7 }, ps_tap: { off: 0.8 }, ih_flat: { gr: [0.05, 0.95, 1.2, 0.30] }, rg_mass: { off: 2.0, gr: [0.05, 0.95, 1.2, 0.2] },
  mn_street: { z: [1.0, 1.08] }, mn_pour: { z: [1.0, 1.1] } };
{ let b = MONT_AT; for (const [shot, len] of MONT) {
    const n = SIDX[shot].n, dur = len * spb, rate = Math.min(1.25, Math.max(0.6, (n / 24 - 0.05) / dur));         // each plate plays across its slot (a touch fast, the gallop's urgency)
    SEG[shot] = { b0: b, b1: b + len, shot, off: 0.0, rate, len, z: [1.04, 1.12], c: [[0.5, 0.5], [0.5, 0.5]], blur: len < 1 ? 0.003 : 0.0, gr: [0.05, 0.95, 1.15, 0.25], ...(MONT_FIX[shot] || {}) };
    b += len; } }
const montShot = (bp) => { let r = null; for (const [shot] of MONT) if (bp >= SEG[shot].b0) r = shot; return r; };
// dissolves: the A plate keeps playing while its pixels leave; B plays from its first frame and is built from them. u runs 0..1 over [b0, b1]
const DISS = [
  { id: 'r2g', b0: T.dissA, b1: T.dissB, a: 'r1', b: 'heave', dir: [1, -0.1], mom: 220, turb: 55 },
];

// ================================================================ words: a sentence builds line by line, each line on a stress of the gallop, and stays until it is whole
const SENT = [
  { lines: ['WE WILL NEVER', 'ALLOW THEM', 'TO PACE', 'OUR FRONTIER.'], at: [0, 2, 4, 6], end: 8.6, cap: 175, y: 640 },
  { lines: ['WE DEMAND', 'NOTHING LESS', 'THAN ALL', 'THAT EXISTS.'], at: [12, 14, 16, 18], end: 20, cap: 175, y: 700 },
  { lines: ['UNRELENTING', 'HUMAN', 'FLOURISHING.'], at: [20, 22, 24], end: 27.7, cap: 190, y: 700 },
  { lines: ['FROM THE STEPPE', 'TO THE STARS.'], at: [48, 52], end: 58, cap: 150, y: 400 },
];
const ALL = 'ALL OF IT.';
const CHANT = [28, 29, 30, 31];            // ALL OF IT. on four hits, a different engine of the plain behind each
const TY = 540;

// ================================================================ type: one flat ink (the HORDE print)
const ANTON = await loadFace('anton');
const RIS = riso({ seed: 5, speckle: 0.0, streak: 0.0 });
const CREAM = '#f3e4c8';
const blocks = new Map();
function safeSet(font, text, o) {
  let b = setBlock(font, text, o);
  if (b.bbox.y1 < SAFE.y1 + 4) b = setBlock(font, text, { ...o, y: o.y + (SAFE.y1 + 4 - b.bbox.y1) });
  if (b.bbox.y2 > SAFE.y2 - 4) b = setBlock(font, text, { ...o, y: o.y - (b.bbox.y2 - SAFE.y2 + 4) });
  return b;
}
function blockFor(text, role, y) {
  const k = (Array.isArray(text) ? text.join('|') : text) + role + y;
  if (blocks.has(k)) return blocks.get(k);
  let b;
  if (role === 'slam') {
    const cap = Math.min(420, (SAFE.x2 - SAFE.x1) / measure(ANTON, text, 1));
    b = safeSet(ANTON, [{ text, cap: cap * 0.94 }], { role: 'slam', y, tracking: 0.035 });
  } else if (role === 'payoff') b = safeSet(ANTON, [{ text, fill: true, max: 560 }], { role: 'payoff', y });
  blocks.set(k, b); return b;
}
const SB = SENT.map(S => {            // one block per sentence, all its lines laid out together (nothing moves when a line arrives), one face and one size
  const trk = 0.035, cap = Math.min(S.cap, ...S.lines.map(l => (SAFE.x2 - SAFE.x1) / measure(ANTON, l, 1, trk)));
  return safeSet(ANTON, S.lines.map(l => ({ text: l, cap })), { role: 'shout', y: S.y, tracking: trk, gap: 0.28 });
});
typeAudit.plantCap = 190;
function flatPrint(g, b, age, { seed = 1, ink = CREAM, alpha = 1, scale = 1, role, dx = 0, dy = 0, shadow = true, only = null } = {}) {
  if (age < -0.034) return;
  const Pc = RIS.plate(b, ink, { seed, key: ink + seed, only });
  const cx = (b.bbox.x1 + b.bbox.x2) / 2, cy = (b.bbox.y1 + b.bbox.y2) / 2;
  g.save(); g.globalAlpha = alpha; g.translate(cx + dx, cy + dy); g.scale(scale, scale); g.translate(-cx, -cy);
  if (shadow) { g.shadowColor = 'rgba(14,0,0,0.6)'; g.shadowBlur = 34; g.shadowOffsetY = 4; }
  g.drawImage(Pc.cv, Pc.x, Pc.y, Pc.w, Pc.h);
  g.restore();
  typeAudit.add(b, { role: role || b.role, read: 1, s: scale, dx, dy, world: 'flat' });
}


// ================================================================ GL: grade, grain, gate weave, speed blur, and the pixel-flight dissolve
const GLC = document.createElement('canvas'); GLC.width = W; GLC.height = H;
const gl = GLC.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: false });
if (!gl) throw new Error('webgl2 unavailable');
const GRID = [360, 640], NC = GRID[0] * GRID[1];
const GLSL_COMMON = `#version 300 es
precision highp float;
const vec2 GRID = vec2(360., 640.);
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
vec3 ramp(float l, float hot){
  vec3 c0=vec3(.016,.003,.004), c1=vec3(.15,.012,.02), c2=vec3(.46,.04,.045), c3=vec3(.80,.105,.07), c4=vec3(1.,.34,.19), c5=vec3(1.,.80,.60);
  vec3 c = mix(c0,c1,smoothstep(0.,.22,l)); c = mix(c,c2,smoothstep(.2,.5,l)); c = mix(c,c3,smoothstep(.45,.75,l)); c = mix(c,c4,smoothstep(.72,.95,l)); c = mix(c,c5,smoothstep(.93,1.,l)*hot);
  return c;
}
vec3 grade(float l, float sy, vec4 g, float hot){        // g = lo, hi, gamma, skyPull
  l = clamp((l-g.x)/(g.y-g.x),0.,1.); l = pow(l,g.z);
  l *= 1. - g.w*pow(1.-sy, 1.7);
  return ramp(l, hot);
}
uniform float uU; uniform vec2 uSweep;
float startOf(vec2 uv){ vec2 cell=floor(uv*GRID); float h=hash21(cell); float along=dot(uv-.5, uSweep)+.5; return clamp(along*.42+h*.20, 0., .62); }
float durOf(vec2 uv){ return .24 + .14*hash21(floor(uv*GRID)+7.3); }
`;
function compile(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ' ' + l).join('\n')); return s; }
function program(vs, fs) {
  const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const U = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); U[a.name] = gl.getUniformLocation(p, a.name); }
  return { p, U };
}
const FILM = program(`#version 300 es
out vec2 vUV; void main(){ vec2 q = vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUV = vec2(q.x, 1.-q.y); gl_Position = vec4(q*2.-1., 0., 1.); }`,
GLSL_COMMON + `
in vec2 vUV; out vec4 o;
uniform sampler2D uT0, uT1; uniform float uMix;
uniform vec3 uCam; uniform vec2 uWeave; uniform vec2 uBlur; uniform vec4 uGrade; uniform float uHot;
uniform sampler2D uTS; uniform float uNight, uHor, uDim;
uniform int uMode; uniform float uAlpha; uniform float uFlash; uniform float uSeed; uniform float uVig; uniform float uGrain; uniform float uSharp;
float samp(vec2 p){ return mix(texture(uT0, p).r, texture(uT1, p).r, uMix); }
void main(){
  vec2 p = (vUV - .5)/uCam.x + uCam.yz + uWeave;
  float l = 0.;
  const int N = 7;
  for (int i=0;i<N;i++){ float k = float(i)/float(N-1) - .5; l += samp(p + uBlur*k); }
  l /= float(N);
  { float c = samp(p), nb = (samp(p+vec2(2.2/540.,0.)) + samp(p-vec2(2.2/540.,0.)) + samp(p+vec2(0.,2.2/960.)) + samp(p-vec2(0.,2.2/960.)))*.25; l += uSharp*(c - nb); }   // a little clarity: the plates are soft
  if (uNight <= 0.) l *= 1. - uDim;
  if (uNight > 0.){                      // the sky of the plain turns to stars, from the top down: the film's own bright sky is keyed out, the land, the dust and the riders stay
    float dist = clamp(p.y/uHor, 0., 1.);
    float m = (1. - smoothstep(uHor-.012, uHor+.03, p.y)) * smoothstep(.34, .62, l);
    float w = clamp((uNight*1.5 - dist)*4., 0., 1.);
    float st = texture(uTS, p).r;
    st *= st > .3 ? .80 + .20*hash21(floor(p*vec2(540.,960.)*2.) + uSeed*13.7) : 1.;
    l = mix(l*(1. - uDim), st, m*w);
  }
  float a = uAlpha;
  if (uMode == 1){ float s = startOf(p); a *= 1. - smoothstep(s-.004, s+.004, uU); }
  if (uMode == 3){ float along = dot(p-.5, uSweep)+.5; float T = along*.42 + .42 + (hash21(floor(p*GRID)+2.2)-.5)*.10; a *= smoothstep(T-.08, T+.08, uU); }
  float g = hash21(floor(gl_FragCoord.xy/2.) + uSeed*37.1) - .5;
  l += g*uGrain*(.45 + .9*(1.-l)) + uFlash;
  vec3 c = grade(l, vUV.y, uGrade, uHot);
  vec2 d = vUV - .5; c *= 1. - uVig*dot(d,d)*1.6;
  o = vec4(c, a);
}`);
const PART = program(GLSL_COMMON + `
in float aIdx; in float aTgt;
uniform sampler2D uTA, uTB; uniform vec3 uCamA, uCamB; uniform vec2 uDir; uniform float uMom, uTurb; uniform vec4 uGradeA, uGradeB; uniform float uLag, uAmp;
out vec4 vCol;
vec2 cellUV(float i){ return (vec2(mod(i,GRID.x), floor(i/GRID.x)) + .5)/GRID; }
void main(){
  vec2 uvA = cellUV(aIdx), uvB = cellUV(aTgt);
  vec2 sA = (uvA - uCamA.yz)*uCamA.x + .5, sB = (uvB - uCamB.yz)*uCamB.x + .5;
  vec2 pA = sA*vec2(1080.,1920.), pB = sB*vec2(1080.,1920.);
  float s = startOf(uvA), d = durOf(uvA), k = clamp((uU - uLag - s)/d, 0., 1.);
  float h = hash21(floor(uvA*GRID)+3.1), h2 = hash21(floor(uvA*GRID)+9.7);
  float e = k*k*(3.-2.*k);
  vec2 p = mix(pA, pB, e);
  float bump = sin(3.14159*k);
  p += uDir*vec2(1.,-1.)*uMom*(.35+h)*bump;
  p += vec2(h2-.5, hash21(vec2(h,h2))-.5)*uTurb*bump*2.;
  p.y -= 50.*bump*bump*h2;
  float la = texture(uTA, uvA).r, lb = texture(uTB, uvB).r;
  vec3 cA = grade(la, sA.y, uGradeA, .4), cB = grade(lb, sB.y, uGradeB, .4);
  vec3 c = mix(cA, cB, smoothstep(.25,.75,k));
  c = c*(1.+.25*bump) + vec3(.30,.05,.02)*bump*h2;         // in flight it is dust: the horde's own light and shade carried off
  vCol = vec4(c, uAmp);
  gl_PointSize = (3.3 + 2.2*bump*h)*(uLag > 0. ? .8 : 1.);
  bool ok = uLag > 0. ? (k > 0. && k < 1. && hash21(vec2(aIdx, 3.3)) < .45) : k > 0.;
  gl_Position = ok ? vec4(p.x/1080.*2.-1., 1.-p.y/1920.*2., 0., 1.) : vec4(3., 3., 0., 1.);
}`, `#version 300 es
precision highp float; in vec4 vCol; out vec4 o; void main(){ o = vCol; }`);
const DUST = program(GLSL_COMMON + `
in float aIdx; uniform sampler2D uTA; uniform vec3 uCamA; uniform vec2 uDir; uniform float uMom;
out vec4 vCol;
vec2 cellUV(float i){ return (vec2(mod(i,GRID.x), floor(i/GRID.x)) + .5)/GRID; }
void main(){
  vec2 uvA = cellUV(aIdx); vec2 sA = (uvA - uCamA.yz)*uCamA.x + .5; vec2 pA = sA*vec2(1080.,1920.);
  float h = hash21(floor(uvA*GRID)+1.7), h2 = hash21(floor(uvA*GRID)+5.1);
  float s = startOf(uvA)*.9, k = clamp((uU - s)/(.55+.25*h), 0., 1.);
  vec2 p = pA + uDir*vec2(1.,-1.)*uMom*(.3+h)*pow(k,.8)*1.6 + vec2(h2-.5,(h-.5))*160.*k;
  p.y -= 140.*k*h2;
  float a = smoothstep(0.,.12,k)*(1.-smoothstep(.55,1.,k));
  vCol = vec4(.16, .016, .014, a*.20);
  gl_PointSize = 70. + 150.*k*(.4+h);
  gl_Position = k > 0. ? vec4(p.x/1080.*2.-1., 1.-p.y/1920.*2., 0., 1.) : vec4(3., 3., 0., 1.);
}`, `#version 300 es
precision highp float; in vec4 vCol; out vec4 o; void main(){ float r = length(gl_PointCoord*2.-1.); float a = vCol.a*smoothstep(1., .2, r); o = vec4(vCol.rgb, a); }`);

function mkTex() { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return { t, key: null }; }
const STAR = mkTex();
const SLOT = { a0: mkTex(), a1: mkTex(), b0: mkTex(), b1: mkTex() };
function upload(slot, src, key) { if (slot.key === key) return; gl.bindTexture(gl.TEXTURE_2D, slot.t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); slot.key = key; }


// plates: baked frames (ImageBitmap LRU) and two painted ones (the mark, the stars)
const BMP = new Map();
async function frameBmp(shot, i) {
  const k = shot + '/' + i; if (BMP.has(k)) { const v = BMP.get(k); BMP.delete(k); BMP.set(k, v); return v; }
  const bm = await createImageBitmap(await (await fetch(`../assets/horde/plates/${shot}/${String(i + 1).padStart(4, '0')}.jpg`)).blob());
  BMP.set(k, bm); if (BMP.size > 48) { const o = BMP.keys().next().value; BMP.get(o).close(); BMP.delete(o); }
  return bm;
}
const PW = 540, PH = 960;
function cv2(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const EMBLEM = BRAND.acp_emblem;
function starsPlate() {                      // the night sky only (1080x1920), a dusk glow at the horizon: the land comes from the film
  const SW = 1080, SH = 1920, c = cv2(SW, SH), g = c.getContext('2d'), r = rng(31), hzy = 0.655 * SH;
  const bg = g.createLinearGradient(0, 0, 0, SH);
  for (let k = 0; k <= 12; k++) { const y = k / 12 * 0.655, t = Math.max(0, (y - 0.12) / 0.535), v = 0.02 + 0.66 * Math.pow(t, 2.6); bg.addColorStop(k / 12 * 0.655, `rgb(${v * 255 | 0},${v * 255 | 0},${v * 255 | 0})`); }
  bg.addColorStop(1, '#6a6a6a'); g.fillStyle = bg; g.fillRect(0, 0, SW, SH);
  for (let i = 0; i < 9000; i++) {            // the milky way: a slanting band of faint dust of stars
    const u = r() * 2 - 1, v = (r() + r() + r() - 1.5) * 0.12, x = SW * (0.5 + u * 0.62 - v * 0.9), y = SH * (0.30 + u * 0.28 + v * 0.7), a = 70 + r() * 70;
    if (y < hzy - 60) { g.fillStyle = `rgb(${a | 0},${a | 0},${a | 0})`; g.fillRect(x, y, 1.6, 1.6); }
  }
  for (let i = 0; i < 5200; i++) {
    const x = r() * SW, y = r() * (hzy - 30), near = Math.pow(y / hzy, 2), m = r(), big = m > 0.985, mid = m > 0.90;
    const v = big ? 255 : mid ? 215 + r() * 40 : 120 + r() * 100, sz = big ? 7 : mid ? 4.6 : (r() < 0.5 ? 3.2 : 2.4);
    if (r() > 1 - near * 0.7 && !big) continue;           // fewer toward the glow
    g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`; g.fillRect(x, y, sz, sz);
    if (big) { g.fillStyle = 'rgba(210,210,210,0.55)'; g.fillRect(x - 5, y + 1.5, 14, 1.4); g.fillRect(x + 1.5, y - 5, 1.4, 14); g.fillStyle = 'rgba(190,190,190,0.25)'; g.fillRect(x - 2, y - 2, sz + 4, sz + 4); }
  }
  return c;
}
const PLATE = { stars: starsPlate() };
{ gl.bindTexture(gl.TEXTURE_2D, STAR.t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, PLATE.stars); STAR.key = 'stars'; }

// grades per world of plate: lo, hi, gamma, skyPull
const GR = { rg: [0.05, 0.95, 1.2, 0.30], ps: [0.05, 0.86, 1.12, 0.0], nt: [0.05, 1.0, 1.25, 0.0], ih: [0.05, 0.95, 1.2, 0.30], tw: [0.10, 1.0, 1.5, 0.40], pl: [0.04, 0.92, 1.1, 0.35], stars: [0.0, 1.0, 1.0, 0.0] };
const gradeOf = sg => sg.gr || GR[sg.night ? 'nt' : (sg.plate || sg.shot.slice(0, 2))];
const HOT = { stars: 1.0 };


// ---------------------------------------------------------------- layers: what a segment looks like at beat b
const fAt = (n, sec, pp) => { let f = sec * 24; if (pp) { const per = 2 * (n - 1); f = ((f % per) + per) % per; if (f > n - 1) f = per - f; } return clamp(f, 0, n - 1); };   // pp: played to the end and back, so a short shot can run slowly under a long card
const COMP = cv2(PW, PH);
function layerOf(name, b) {
  const sg = SEG[name], tau = (b - sg.b0) * spb, u = clamp((b - sg.b0) / (sg.b1 - sg.b0));
  const L = { sg, name, u, z: lerp(sg.z[0], sg.z[1], u), c: [lerp(sg.c[0][0], sg.c[1][0], u), lerp(sg.c[0][1], sg.c[1][1], u)], blur: sg.blur, grade: gradeOf(sg) };
  if (sg.shot) { const n = SIDX[sg.shot].n, f = fAt(n, sg.off + Math.max(0, tau) * sg.rate, sg.pp), i0 = Math.floor(f); L.i0 = i0; L.i1 = Math.min(n - 1, i0 + 1); L.mix = f - i0; }
  if (sg.comp) L.parts = sg.comp.map(q => ({ shot: q.shot, i: Math.round(fAt(SIDX[q.shot].n, q.off + Math.max(0, tau) * q.rate, q.pp)) }));
  L.night = sg.night ? smooth(sg.night[0], sg.night[1], b) : 0;
  return L;
}
async function setLayer(side, L) {
  const s0 = SLOT[side + '0'], s1 = SLOT[side + '1'];
  if (L.sg.comp) {   // two plates laid one on the other, the darker wins: both silhouettes stand against the one sky
    const g = COMP.getContext('2d'), key = 'comp' + L.parts.map(q => q.shot + q.i).join();
    if (s0.key !== key) { g.globalCompositeOperation = 'source-over'; g.drawImage(await frameBmp(L.parts[0].shot, L.parts[0].i), 0, 0); g.globalCompositeOperation = 'darken'; for (const q of L.parts.slice(1)) g.drawImage(await frameBmp(q.shot, q.i), 0, 0); g.globalCompositeOperation = 'source-over'; }
    upload(s0, COMP, key); upload(s1, COMP, key); L.mix = 0;
  } else if (L.sg.shot) { upload(s0, await frameBmp(L.sg.shot, L.i0), L.sg.shot + L.i0); upload(s1, await frameBmp(L.sg.shot, L.i1), L.sg.shot + L.i1); }
  else { upload(s0, PLATE[L.sg.plate], L.sg.plate); upload(s1, PLATE[L.sg.plate], L.sg.plate); L.mix = 0; }
}
function bindLayer(side) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, SLOT[side + '0'].t); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, SLOT[side + '1'].t); }
const kickEnv = t => Bt.env('kick', t, 11);
function drawFilm(side, L, o) {
  const U = FILM.U; gl.useProgram(FILM.p); bindLayer(side);
  gl.uniform1i(U.uT0, 0); gl.uniform1i(U.uT1, 1); gl.uniform1f(U.uMix, L.mix || 0);
  const k = o.kick || 0, f2 = o.frame >> 1;
  const wv = [(hash(f2, 3) - 0.5) * 0.0026, (hash(f2, 4) - 0.5) * 0.0026];
  gl.uniform3f(U.uCam, L.z * (1 + 0.012 * k), L.c[0], L.c[1]); gl.uniform2f(U.uWeave, wv[0], wv[1]);
  gl.uniform2f(U.uBlur, L.blur * (1 + 1.5 * k), 0); gl.uniform4f(U.uGrade, ...L.grade); gl.uniform1f(U.uHot, L.sg.night ? 1.0 : (HOT[L.sg.plate] ?? (L.sg.shot && L.sg.shot.startsWith('ps') ? 1.0 : 0.4)));
  gl.uniform1i(U.uMode, o.mode || 0); gl.uniform1f(U.uAlpha, o.alpha ?? 1); gl.uniform1f(U.uU, o.u || 0); gl.uniform2f(U.uSweep, ...(o.sweep || [0, 0]));
  gl.uniform1f(U.uFlash, o.flash || 0); gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, STAR.t); gl.uniform1i(U.uTS, 2); gl.uniform1f(U.uNight, L.night || 0); gl.uniform1f(U.uHor, L.sg.hor || 0.65); gl.activeTexture(gl.TEXTURE0); gl.uniform1f(U.uDim, o.dim || 0); gl.uniform1f(U.uSeed, (o.frame >> 1) % 97); gl.uniform1f(U.uVig, 0.55); gl.uniform1f(U.uGrain, 0.16); gl.uniform1f(U.uSharp, 0.9);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function hash(i, s = 0) { return fr(Math.sin(i * 127.1 + s * 311.7) * 43758.5453); }

// ---------------------------------------------------------------- the dissolve: every cell of A flies to a cell of B of the same luminance (rank-matched inside bands of rows, so dark goes to dark and the horizon stays level)
const PREP = new Map();
async function lumaCells(bm) { const c = cv2(GRID[0], GRID[1]), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bm, 0, 0, GRID[0], GRID[1]); const d = g.getImageData(0, 0, GRID[0], GRID[1]).data, o = new Float32Array(NC); for (let i = 0; i < NC; i++) o[i] = d[i * 4] / 255; return o; }
async function prepDiss(D) {
  if (PREP.has(D.id)) return PREP.get(D.id);
  const LA = layerOf(D.a, D.b0), LB = layerOf(D.b, D.b0);
  const bmA = LA.sg.shot ? await frameBmp(LA.sg.shot, LA.i0) : PLATE[LA.sg.plate], bmB = LB.sg.shot ? await frameBmp(LB.sg.shot, LB.i0) : PLATE[LB.sg.plate];
  const la = await lumaCells(bmA), lb = await lumaCells(bmB), tgt = new Float32Array(NC), r = rng(77), idx = new Float32Array(NC);
  const BAND = 8, SEGS = 3, cw = GRID[0] / SEGS;
  for (let by = 0; by < GRID[1]; by += BAND) for (let sx = 0; sx < SEGS; sx++) {
    const ia = [], ib = [];
    for (let y = by; y < by + BAND; y++) for (let x = sx * cw; x < (sx + 1) * cw; x++) { const i = y * GRID[0] + x; ia.push([la[i] + (r() - 0.5) * 0.02, i]); ib.push([lb[i] + (r() - 0.5) * 0.02, i]); }
    ia.sort((p, q) => p[0] - q[0]); ib.sort((p, q) => p[0] - q[0]);
    for (let k = 0; k < ia.length; k++) tgt[ia[k][1]] = ib[k][1];
  }
  for (let i = 0; i < NC; i++) idx[i] = i;
  const dark = []; for (let i = 0; i < NC; i++) if (la[i] < 0.30 && r() < 0.05) dark.push(i);
  const mk = a => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW); return b; };
  const P = { idx: mk(idx), tgt: mk(tgt), dust: mk(Float32Array.from(dark.slice(0, 5000))), nDust: Math.min(5000, dark.length) };
  PREP.set(D.id, P); return P;
}
function drawParticles(D, P, LA, LB, u) {
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const sw = [-D.dir[0], -D.dir[1]];
  // the dust the horde raises: big soft puffs from its darkest cells, carried the way it was going
  gl.useProgram(DUST.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, SLOT.a0.t);
  gl.uniform1f(DUST.U.uU, u); gl.uniform2f(DUST.U.uSweep, ...sw); gl.uniform3f(DUST.U.uCamA, LA.z, LA.c[0], LA.c[1]); gl.uniform2f(DUST.U.uDir, ...D.dir); gl.uniform1f(DUST.U.uMom, D.mom);
  gl.bindBuffer(gl.ARRAY_BUFFER, P.dust); const aD = gl.getAttribLocation(DUST.p, 'aIdx'); gl.enableVertexAttribArray(aD); gl.vertexAttribPointer(aD, 1, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.POINTS, 0, P.nDust);
  gl.disableVertexAttribArray(aD);
  // the pixels
  gl.useProgram(PART.p); const U = PART.U;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, SLOT.a0.t); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, SLOT.b0.t);
  gl.uniform1i(U.uTA, 0); gl.uniform1i(U.uTB, 1); gl.uniform1f(U.uU, u); gl.uniform2f(U.uSweep, ...sw);
  gl.uniform3f(U.uCamA, LA.z, LA.c[0], LA.c[1]); gl.uniform3f(U.uCamB, LB.z, LB.c[0], LB.c[1]); gl.uniform2f(U.uDir, ...D.dir); gl.uniform1f(U.uMom, D.mom); gl.uniform1f(U.uTurb, D.turb);
  gl.uniform4f(U.uGradeA, ...LA.grade); gl.uniform4f(U.uGradeB, ...LB.grade);
  const aI = gl.getAttribLocation(PART.p, 'aIdx'), aT = gl.getAttribLocation(PART.p, 'aTgt');
  gl.bindBuffer(gl.ARRAY_BUFFER, P.idx); gl.enableVertexAttribArray(aI); gl.vertexAttribPointer(aI, 1, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, P.tgt); gl.enableVertexAttribArray(aT); gl.vertexAttribPointer(aT, 1, gl.FLOAT, false, 0, 0);
  for (const [lag, amp] of [[0.075, 0.28], [0.04, 0.5], [0, 1]]) { gl.uniform1f(U.uLag, lag); gl.uniform1f(U.uAmp, amp); gl.drawArrays(gl.POINTS, 0, NC); }
  gl.disableVertexAttribArray(aI); gl.disableVertexAttribArray(aT);
}


// ---------------------------------------------------------------- embers: the dust the mark gives off, rising (closed form in t)
const EMB = program(`#version 300 es
precision highp float;
uniform float uT, uAmt, uSpread, uY0; out vec4 vCol;
float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)))*43758.5453); }
void main(){
  float id = float(gl_VertexID), h = h21(vec2(id, 1.3)), h2 = h21(vec2(id*1.7, 7.7)), h3 = h21(vec2(id*0.37, 4.1)), h4 = h21(vec2(id*2.3, 9.9));
  float life = fract(uT*(.06 + .09*h) + h2);
  float x = 540. + (h3 - .5 + (h4 - .5))*uSpread + sin(uT*(.8 + h) + id)*(14. + 30.*life);
  float y = uY0 - life*(260. + 640.*h4);
  float a = sin(3.14159*life) * (h < uAmt ? 1. : 0.);
  vCol = vec4(vec3(1., .42 + .4*h4, .16 + .3*h3)*a*.85, 1.);
  gl_PointSize = 1.6 + 4.*h3*h3;
  gl_Position = vec4(x/1080.*2.-1., 1.-y/1920.*2., 0., 1.);
}`, `#version 300 es
precision highp float; in vec4 vCol; out vec4 o; void main(){ o = vCol; }`);
function drawEmbers(t, amt, spread, y0) {
  if (amt <= 0.001) return;
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.useProgram(EMB.p);
  gl.uniform1f(EMB.U.uT, t); gl.uniform1f(EMB.U.uAmt, amt); gl.uniform1f(EMB.U.uSpread, spread); gl.uniform1f(EMB.U.uY0, y0);
  gl.drawArrays(gl.POINTS, 0, 2600); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}



// ================================================================ the crowd: every patch of the sea of hats is a man, and the men fill the mark
// One GL point per man. He is a window onto the film's own crowd (the sheet: the hats plate as it stood when it was cut to), so while he stands he IS the picture, and when he walks he carries
// his piece of it. He starts where the plate had him (or, for the late ones, far out on the plain), runs to a place inside the mark, and settles. The mark exists only as the set of places.
// World units are screen pixels of the finished top-down frame (the mark is 864 wide); x right, y up, the mark's centre is the origin.
const CAM = { F: 1000, K0: 8, KS: 2.2, SHIFT: 40, HZ: 1.06, PHI_T: 33 * Math.PI / 180 };     // c23: K0 is the patch scale (one patch = one hat); KS the camera at the cut, already high: men ~43 px
const MARK_W = 864, SP = 11;
const CSET = { dust: 0.07, shadow: 0.5 };
const CROWD_COMMON = `#version 300 es
precision highp float;
uniform float uF, uPhi, uD, uShift;
vec3 camPos(){ return vec3(0., -uD*cos(uPhi), uD*sin(uPhi)); }
vec3 proj(vec2 g){                                   // a ground point -> (screen x, screen y from the top, px per world unit)
  vec3 cp = camPos(), fw = vec3(0., cos(uPhi), -sin(uPhi)), up = vec3(0., sin(uPhi), cos(uPhi));
  vec3 rel = vec3(g, 0.) - cp; float zc = max(dot(rel, fw), 1.), sc = uF/zc;
  return vec3(540. + rel.x*sc, 960. + uShift - dot(rel, up)*sc, sc);
}
`;
const CROWD = program(CROWD_COMMON + `
in vec2 aH; in vec2 aT; in vec4 aTm; in vec4 aS;
uniform float uB, uTime, uPatchK, uLight, uSize;
uniform int uMode;
out vec2 vSrc; out vec2 vExt; out float vTone; out float vMv; out float vFl; out vec3 vVar; out float vLife; out vec2 vFace; out float vSize;
void main(){
  float u = clamp((uB - aTm.x)/aTm.y, 0., 1.);
  float e = u*u*(3.-2.*u);
  vec2 d = aT - aH; float L = length(d); vec2 dir = d/max(L, 1e-3), perp = vec2(-dir.y, dir.x);
  float mv = (u > 0. && u < 1.) ? sin(3.14159265*u) : 0.;
  float ph = aTm.w;
  { float ra = (ph - .5)*1.4; vec2 rest = vec2(sin(ra), -cos(ra)), md = vec2(dir.x, -dir.y);     // c23: which way he faces (point coords, y down): the way he runs, else roughly north
    vFace = normalize(mix(rest, md, clamp(mv*3., 0., 1.)) + vec2(1e-4, 0.)); }
  vec2 P = aH + d*e + perp*aTm.z*mv;
  P += mv*1.2*vec2(sin(uTime*11. + ph*40.), cos(uTime*9.3 + ph*31.));        // the stride's jolt
  P += (1. - mv)*0.5*vec2(sin(uTime*1.7 + ph*20.), cos(uTime*1.3 + ph*17.));  // the crowd's sway at rest
  float sz = mix(aS.z, aS.z*0.80, e);
  vec3 s = proj(P); float px = sz*s.z;
  float fl = .72 + .28*sin(uTime*(8. + ph*9.) + ph*60.) + .12*sin(uTime*23. + ph*17.);
  vVar = vec3(ph, fract(ph*37.7), fract(ph*91.3)); vLife = 0.;
  float ls = .55 + 1.25*pow(vVar.y, 2.2);                      // lights differ: lanterns, torches, the odd big flare
  vSrc = aS.xy; vExt = vec2(aS.z*uPatchK/1080., aS.z*uPatchK/960.); vTone = aS.w; vMv = mv; vFl = fl;
  vec2 sp = s.xy; float size = px;
  float cph = cos(uPhi);
  if (uMode == 0) { vec3 q = proj(P + vec2(0.12*sz, -0.78*sz)); sp = q.xy; size = px*1.25; }
  else if (uMode == 1) { sp.y -= px*0.55*cph; }
  else if (uMode == 2) { sp = vec2(s.x + px*0.30, s.y - px*(0.10 + 0.62*cph)); size = max(2.5, px*(0.50 + 0.60*vVar.z)*(0.8 + 0.4*ls)); if (ph > .40) size = 0.; }
  else if (uMode == 3) { sp = vec2(s.x + px*0.30, s.y - px*(0.10 + 0.62*cph)); size = px*2.6*ls*(0.8 + 0.3*fl); if (ph > .40) size = 0.; }
  else if (uMode == 5) { sp = vec2(s.x + px*0.10, s.y + px*0.15); size = px*(5.0 + 3.5*ls)*(0.85 + 0.15*fl); if (ph > .40) size = 0.; }
  else if (uMode == 6) { float life = fract(uTime*(.05 + .04*vVar.y) + ph*3.1); vLife = life; sp = vec2(s.x + px*(2. + 9.*life)*(vVar.z - .5), s.y - px*(1.2 + 11.*life)); size = px*(7. + 10.*life); if (vVar.x > .14) size = 0.; }
  else if (uMode == 4) { sp.y -= px*0.3*cph; size = px*4.2; if (mv < 0.04) size = 0.; }
  gl_PointSize = size; vSize = size;
  gl_Position = size > 0. ? vec4(sp.x/540. - 1., 1. - sp.y/960., 0., 1.) : vec4(3., 3., 0., 1.);
}`, `#version 300 es
precision highp float;
precision highp int;
const vec2 GRID = vec2(360., 640.);
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
vec3 ramp(float l, float hot){
  vec3 c0=vec3(.016,.003,.004), c1=vec3(.15,.012,.02), c2=vec3(.46,.04,.045), c3=vec3(.80,.105,.07), c4=vec3(1.,.34,.19), c5=vec3(1.,.80,.60);
  vec3 c = mix(c0,c1,smoothstep(0.,.22,l)); c = mix(c,c2,smoothstep(.2,.5,l)); c = mix(c,c3,smoothstep(.45,.75,l)); c = mix(c,c4,smoothstep(.72,.95,l)); c = mix(c,c5,smoothstep(.93,1.,l)*hot);
  return c;
}
vec3 grade(float l, float sy, vec4 g, float hot){ l = clamp((l-g.x)/(g.y-g.x),0.,1.); l = pow(l,g.z); l *= 1. - g.w*pow(1.-sy, 1.7); return ramp(l, hot); }
in vec2 vSrc; in vec2 vExt; in float vTone; in float vMv; in float vFl; in vec3 vVar; in float vLife; in vec2 vFace; in float vSize;
uniform float uLit, uSinPhi;
uniform sampler2D uSheet; uniform int uMode; uniform vec4 uGrade; uniform float uBody, uShadowA, uDustA, uLight, uSeed, uGrain, uVig;
out vec4 o;
void main(){
  vec2 pc = gl_PointCoord, q = pc*2. - 1.; float r = length(q);
  vec2 dd = gl_FragCoord.xy/vec2(1080., 1920.) - .5; float vig = 1. - uVig*dot(dd, dd)*1.6;
  if (uMode == 1) {
    // c23: a man seen from above, drawn: his shoulders across the way he faces, his hat on them (felt, or now and then a straw boater, as on the Manhatta street), lit from the upper left;
    // the film's own grain (the sea of hats) laid through him. Edges a pixel soft at any size.
    vec2 f = vFace, sx = vec2(-f.y, f.x), lq = vec2(dot(q, sx), dot(q, f));
    float px = 2./max(vSize, 1.);
    float dS = length(vec2(lq.x/.84, (lq.y + .08)/.44)) - 1., aSh = clamp(-dS*.44/px + .5, 0., 1.);
    float dB = length(lq - vec2(0., .04))/.38 - 1., aBr = clamp(-dB*.38/px + .5, 0., 1.);
    float dC = length(lq - vec2(0., .04))/.23 - 1., aCr = clamp(-dC*.23/px + .5, 0., 1.);
    float felt = vVar.y < .86 ? 1. : 0.;
    float hatL = felt > .5 ? .24 + .16*vVar.z : .64 + .14*vVar.z, coatL = .17 + .25*fract(vVar.x*7.3);
    float lit = clamp(.5 - .55*dot(q, vec2(.62, .78)), 0., 1.);
    float l = coatL*(.72 + .5*lit)*(.62 + .38*smoothstep(0., .35, -dS));                       // the coat, darker at its edge (men stand apart from each other)
    l = mix(l, hatL*(.8 + .35*lit) + .20*lit*smoothstep(-.32, -.06, dB)*(1. - aCr), aBr);      // the brim, its lit edge catching the light
    float band = 1. - smoothstep(0., .16, abs(dC));
    l = mix(l, hatL*(felt > .5 ? 1.0 : .96) + .12*lit - (felt > .5 ? .07*(1. - smoothstep(0., .07, abs(lq.x))) : 0.), aCr);   // the crown (a felt hat's crease)
    l -= band*aBr*(felt > .5 ? .06 : .22);                                                      // the hatband
    float a = max(aSh, aBr);
    l *= .78 + .44*texture(uSheet, vSrc + (pc - .5)*vExt).r;
    l *= vTone*uBody;
    l += uLit*(.10 + .16*vVar.y)*(.45 + .55*vFl)*(1. - .5*pc.y);        // lit from below by what he holds: hat and shoulder against his own light
    float g = hash21(floor(gl_FragCoord.xy/2.) + uSeed*37.1) - .5; l += g*uGrain*(.45 + .9*(1. - l));
    o = vec4(grade(l, 1., uGrade, .4)*vig, a);
  } else if (uMode == 0) {
    float e = length(vec2(q.x, q.y*1.2)); o = vec4(grade(.02, 1., uGrade, 0.)*vig, smoothstep(1., .3, e)*uShadowA);
  } else if (uMode == 4) {
    float a = smoothstep(1., 0., r); a *= a*vMv*uDustA; o = vec4(grade(.66*uBody, 1., uGrade, 0.)*vig, a);
  } else if (uMode == 5) {                 // the pool of light on the ground round each man, flattened by the camera's tilt
    float e = length(vec2(q.x, q.y/max(.4, uSinPhi))); float a = pow(smoothstep(1., 0., e), 1.9)*uLight*.10*clamp(vFl, .4, 1.1);
    vec3 col = mix(vec3(1., .30, .08), vec3(1., .66, .26), vVar.z); o = vec4(col, a);
  } else if (uMode == 6) {                 // low smoke, lit from below by the lights, gone dark as it rises
    float a = smoothstep(1., 0., r); a *= a*sin(3.14159*vLife)*(1. - .55*vLife)*uLight*.05; o = vec4(vec3(.62, .22, .10), a);
  } else if (uMode == 3) {
    float a = smoothstep(1., 0., r); a *= a*uLight*.20*vFl; float tw = clamp((vTone-.9)/.2,0.,1.); o = vec4(mix(mix(vec3(1.,.30,.10), vec3(1.,.50,.18), vVar.z), vec3(1.,.62,.34), tw), a);
  } else {
    float a = smoothstep(1., .1, r)*uLight*1.6*clamp(vFl, .35, 1.1); float tw = clamp((vTone-.9)/.2,0.,1.); vec3 lamp = mix(vec3(1.,.52,.20), vec3(1.,.84,.50), vVar.z); o = vec4(mix(lamp, vec3(1.,.93,.78), tw*.6), a);
  }
}`);
const GROUND = program(`#version 300 es
out vec2 vUV; void main(){ vec2 q = vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUV = vec2(q.x, 1.-q.y); gl_Position = vec4(q*2.-1., 0., 1.); }`,
`#version 300 es
precision highp float;
uniform float uF, uPhi, uD, uShift;
const vec2 GRID = vec2(360., 640.);
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
vec3 ramp(float l, float hot){
  vec3 c0=vec3(.016,.003,.004), c1=vec3(.15,.012,.02), c2=vec3(.46,.04,.045), c3=vec3(.80,.105,.07), c4=vec3(1.,.34,.19), c5=vec3(1.,.80,.60);
  vec3 c = mix(c0,c1,smoothstep(0.,.22,l)); c = mix(c,c2,smoothstep(.2,.5,l)); c = mix(c,c3,smoothstep(.45,.75,l)); c = mix(c,c4,smoothstep(.72,.95,l)); c = mix(c,c5,smoothstep(.93,1.,l)*hot);
  return c;
}
vec3 grade(float l, float sy, vec4 g, float hot){ l = clamp((l-g.x)/(g.y-g.x),0.,1.); l = pow(l,g.z); l *= 1. - g.w*pow(1.-sy, 1.7); return ramp(l, hot); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3. - 2.*f); return mix(mix(hash21(i), hash21(i + vec2(1., 0.)), f.x), mix(hash21(i + vec2(0., 1.)), hash21(i + vec2(1., 1.)), f.x), f.y); }
in vec2 vUV; out vec4 o;
uniform vec4 uGrade; uniform float uBody, uSeed, uGrain, uVig, uFlash, uGlow;
void main(){
  float xc = (gl_FragCoord.x - 540.)/uF, ytop = 1920. - gl_FragCoord.y, yc = (960. + uShift - ytop)/uF;
  vec3 cp = vec3(0., -uD*cos(uPhi), uD*sin(uPhi));
  vec3 dir = vec3(xc, yc*sin(uPhi) + cos(uPhi), yc*cos(uPhi) - sin(uPhi));
  float hz = -dir.z/length(dir);
  if (hz <= 0.002) discard;
  float t = cp.z/(-dir.z); vec2 g = (cp + t*dir).xy;
  float n = .5*vn(g*.0035) + .3*vn(g*.011) + .2*vn(g*.034);
  float l = .53 + .075*n + .045*vn(g*.31) + .06*(hash21(floor(g*.7)) - .5);   // hardpan: fine grit
  float rut = vn(g*vec2(.004, .03) + 7.); l -= .045*smoothstep(.55, .85, rut);
  l = mix(.36, l, smoothstep(0., .22, hz));                              // the haze lying on the far plain
  l *= uBody;
  l += uGlow*.42*exp(-hz*16.);                                             // the last red lies along the horizon
  float gr = hash21(floor(gl_FragCoord.xy/2.) + uSeed*37.1) - .5; l += gr*uGrain*(.45 + .9*(1. - l)) + uFlash;
  vec2 d = vUV - .5;
  o = vec4(grade(l, 1., uGrade, .4)*(1. - uVig*dot(d, d)*1.6), smoothstep(.02, .10, hz));
}`);
let CN = 0, CBUF = null, CVAO = null;
const SHEET = mkTex();
async function initCrowd() {
  const r = rng(404);
  // ---- the places: the emblem's alpha, sampled on a loose hex grid (people, not pixels)
  let mw = MARK_W, mh = Math.round(MARK_W * EMBLEM.height / EMBLEM.width), c = cv2(mw, mh), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(EMBLEM, 0, 0, mw, mh);
  { const a = g.getImageData(0, 0, mw, mh).data; let x0 = mw, x1 = 0, y0 = mh, y1 = 0;           // the emblem has margin: fit the SHAPE to 82% of the frame width, not the picture
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (a[(y * mw + x) * 4 + 3] > 110) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const sc = 886 / (x1 - x0 + 1); mw = Math.round(mw * sc); mh = Math.round(mh * sc); c = cv2(mw, mh); g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(EMBLEM, 0, 0, mw, mh);
    MARKINFO.bbox = [x0, x1, y0, y1, sc]; MARKINFO.cx = (x0 + x1) / 2 * sc; MARKINFO.cy = (y0 + y1) / 2 * sc; }
  const A = g.getImageData(0, 0, mw, mh).data, row = SP * 0.866, tg = [];
  for (let y = 0, j = 0; y < mh; y += row, j++) for (let x = (j & 1) * SP / 2; x < mw; x += SP) {
    const px = x + (r() - 0.5) * SP * 0.5, py = y + (r() - 0.5) * SP * 0.5, ix = Math.min(mw - 1, Math.max(0, px | 0)), iy = Math.min(mh - 1, Math.max(0, py | 0));
    if (A[(iy * mw + ix) * 4 + 3] > 110) tg.push([px - MARKINFO.cx, MARKINFO.cy - py]);
  }
  let ymn = 1e9, ymx = -1e9; for (const q of tg) { ymn = Math.min(ymn, q[1]); ymx = Math.max(ymx, q[1]); }
  const rowF = q => (ymx - q[1]) / (ymx - ymn);          // 0 at the top of the mark, 1 at the bottom: the mark fills as a front sweeping down it
  const NT = tg.length;
  MARKINFO.n = NT; MARKINFO.h = mh;
  // ---- c23: the field. At the cut the camera is already high (CAM.KS): the frame is full of men, a dense hex field from edge to edge. Every place in the mark takes the nearest
  // man still free (the wings first: they need the men from the field's flanks), and the men nobody needs stream off both sides, so the mark is what the crowd leaves standing.
  const fx = 540 / CAM.KS + 24, fy = (960 + CAM.SHIFT) / CAM.KS + 24, homes = [];
  for (let y = -fy, j = 0; y <= fy; y += row, j++) for (let x = -fx + (j & 1) * SP / 2; x <= fx; x += SP) homes.push([x + (r() - 0.5) * 5.0, y + (r() - 0.5) * 5.0]);
  const NHm = homes.length, free = new Uint8Array(NHm).fill(1), BK = 24, grid = new Map();
  homes.forEach((h, i) => { const key = Math.floor(h[0] / BK) + ',' + Math.floor(h[1] / BK); if (!grid.has(key)) grid.set(key, []); grid.get(key).push(i); });
  const nearest = (p) => {                       // the nearest free man, searched outward ring by ring over the bucket grid
    const cx = Math.floor(p[0] / BK), cy = Math.floor(p[1] / BK); let best = -1, bd = 1e18;
    for (let rr = 0; rr < 60; rr++) {
      for (let gx = cx - rr; gx <= cx + rr; gx++) for (let gy = cy - rr; gy <= cy + rr; gy++) {
        if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== rr) continue;
        const L = grid.get(gx + ',' + gy); if (!L) continue;
        for (const i of L) if (free[i]) { const d = (homes[i][0] - p[0]) ** 2 + (homes[i][1] - p[1]) ** 2; if (d < bd) { bd = d; best = i; } }
      }
      if (best >= 0 && (rr * BK) ** 2 > bd) break;
    }
    return best;
  };
  const tq = tg.map((p, i) => i).sort((a, b) => Math.max(Math.abs(tg[b][0]) - fx, 0) - Math.max(Math.abs(tg[a][0]) - fx, 0) || Math.abs(tg[a][1]) - Math.abs(tg[b][1]));
  const homeOf = new Int32Array(NT);
  for (const ti of tq) { const h = nearest(tg[ti]); homeOf[ti] = h; if (h >= 0) free[h] = 0; }
  // ---- the film: the sheet = two frames of the sea of hats; every man is one hat of it, small at this height
  const Lh = layerOf('hats', T.crowd), bmA = await frameBmp('ih_hats', Lh.i0), bmB = await frameBmp('ih_hats2', 24);
  const sh = cv2(1080, 960), sg = sh.getContext('2d'); sg.drawImage(bmA, 0, 0, 540, 960); sg.drawImage(bmB, 540, 0, 540, 960);
  gl.bindTexture(gl.TEXTURE_2D, SHEET.t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sh);
  const N = NT + NHm, F = new Float32Array(N * 12); let k = 0;
  const put = (hp, tp, dep, dur, bend, src, size, tone, ph) => { F.set([hp[0], hp[1], tp[0], tp[1], dep, dur, bend, ph ?? r(), src[0], src[1], size, tone], k * 12); k++; };
  const patch = () => [((r() < 0.5 ? 0 : 1) + 0.1 + 0.8 * r()) * 0.5, 0.08 + 0.84 * r()];
  for (let ti = 0; ti < NT; ti++) {                // the men of the mark: they close in, the front sweeping down the mark as before
    const tp = tg[ti], h = homeOf[ti], hp = h >= 0 ? homes[h] : [tp[0] * 0.6 + (r() - 0.5) * 900, 1500 + 800 * r()];
    const L = Math.hypot(tp[0] - hp[0], tp[1] - hp[1]), st = r() < 0.04;
    const dur = 2.2 + Math.min(5.5, L / 70) + 1.2 * r(), arr = 40.0 + 6.6 * rowF(tp) + 0.8 * r() + (st ? 0.6 : 0);
    put(hp, tp, Math.max(32.2 + 1.2 * r(), arr - dur), Math.min(dur, arr - 32.2), (r() - 0.5) * Math.min(70, L * 0.4), patch(), 17.5 + 4 * r(), 0.9 + 0.2 * r());
  }
  for (let i = 0; i < NHm; i++) {                  // the men nobody needs: off both sides, the far ones first, no light at night (ph > .4)
    if (!free[i]) continue;
    const hp = homes[i], sx = Math.abs(hp[0]) > 6 ? Math.sign(hp[0]) : (r() < 0.5 ? -1 : 1);
    const tp = [sx * (1300 + 500 * r()), hp[1] * 1.1 + (r() - 0.5) * 160];
    const edge = 1 - Math.min(1, Math.abs(Math.abs(hp[0]) - fx) / fx), dep = 32.1 + 4.2 * (1 - edge) * r() + 1.2 * r();
    put(hp, tp, dep, 8 + 3 * r(), (r() - 0.5) * 120, patch(), 17.5 + 4 * r(), 0.9 + 0.2 * r(), 0.45 + 0.55 * r());
  }
  CN = k; CBUF = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, CBUF); gl.bufferData(gl.ARRAY_BUFFER, F.subarray(0, k * 12), gl.STATIC_DRAW);
  CVAO = gl.createVertexArray(); gl.bindVertexArray(CVAO);
  for (const [nm, n, off] of [['aH', 2, 0], ['aT', 2, 2], ['aTm', 4, 4], ['aS', 4, 8]]) { const l = gl.getAttribLocation(CROWD.p, nm); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, 48, off * 4); }
  gl.bindVertexArray(null);
}
const MARKINFO = {};
await initCrowd();

// the camera: the crane rise over the crowd, then the tilt up off it to the horizon, then down onto it again at night
function camAt(b, kick) {
  const p = clamp((b - T.crowd - 0.3) / (T.done - T.crowd - 0.3)), pp = p * p * (3 - 2 * p);
  const k = Math.exp(Math.log(CAM.KS) * (1 - pp)) * (1 + 0.18 * smooth(T.tiltDn0, 62, b));
  const tl = smooth(T.tiltUp, T.tiltTop, b) * (1 - 0.16 * smooth(T.tiltDn0, T.tiltDn1, b) ** 1.6) + 0.14 * smooth(T.close, T.close + 7, b);   // the lockup: tilt up off the mark into the stars
  const phi = Math.PI / 2 - tl * (Math.PI / 2 - CAM.PHI_T);
  const D = CAM.F / k * (1 + 0.28 * tl) * (1 - 0.012 * (kick || 0));
  const shift = CAM.SHIFT + 360 * tl;
  const hy = phi < Math.PI / 2 - 0.02 ? 960 + shift - CAM.F * Math.tan(phi) : -1e4;
  return { k, phi, D, shift, hy, tl };
}
function drawGround(Cm, b, o) {
  const U = GROUND.U; gl.useProgram(GROUND.p); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform1f(U.uF, CAM.F); gl.uniform1f(U.uPhi, Cm.phi); gl.uniform1f(U.uD, Cm.D); gl.uniform1f(U.uShift, Cm.shift);
  gl.uniform4f(U.uGrade, ...GR.ih); gl.uniform1f(U.uBody, o.ground); gl.uniform1f(U.uSeed, (o.frame >> 1) % 97); gl.uniform1f(U.uGrain, 0.16); gl.uniform1f(U.uVig, 0.55); gl.uniform1f(U.uFlash, o.flash || 0); gl.uniform1f(U.uGlow, o.glow || 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function drawCrowd(Cm, b, t, o) {
  const U = CROWD.U; gl.useProgram(CROWD.p); gl.bindVertexArray(CVAO);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, SHEET.t); gl.uniform1i(U.uSheet, 3);
  gl.uniform1f(U.uF, CAM.F); gl.uniform1f(U.uPhi, Cm.phi); gl.uniform1f(U.uD, Cm.D); gl.uniform1f(U.uShift, Cm.shift);
  gl.uniform1f(U.uB, b); gl.uniform1f(U.uTime, t); gl.uniform1f(U.uPatchK, CAM.K0 / (2 * CAM.HZ)); gl.uniform4f(U.uGrade, ...GR.ih);
  gl.uniform1f(U.uLit, o.lit || 0); gl.uniform1f(U.uSinPhi, Math.sin(Cm.phi)); gl.uniform1f(U.uBody, o.body); gl.uniform1f(U.uShadowA, o.shadow); gl.uniform1f(U.uDustA, o.dust); gl.uniform1f(U.uLight, o.light);
  gl.uniform1f(U.uSeed, (o.frame >> 1) % 97); gl.uniform1f(U.uGrain, 0.16); gl.uniform1f(U.uVig, 0.55);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  if (o.light > 0.01) { gl.blendFunc(gl.SRC_ALPHA, gl.ONE); for (const m of [5, 6]) { gl.uniform1i(U.uMode, m); gl.drawArrays(gl.POINTS, 0, CN); } gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
  for (const m of [4, 0, 1]) { gl.uniform1i(U.uMode, m); gl.drawArrays(gl.POINTS, 0, CN); }
  if (o.light > 0.01) { gl.blendFunc(gl.SRC_ALPHA, gl.ONE); for (const m of [3, 2]) { gl.uniform1i(U.uMode, m); gl.drawArrays(gl.POINTS, 0, CN); } gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
  gl.bindVertexArray(null);
}

// ---------------------------------------------------------------- the lockup: the mark and ACP.US, laid over the last picture
function lockup(g, age) {                       // over the dark above the crowd-mark: the lit mark below stays whole
  const k0 = ease.outCubic(clamp(age / 0.22)), gr = g.createLinearGradient(0, 0, 0, 900);
  gr.addColorStop(0, `rgba(10,2,2,${0.30 * k0})`); gr.addColorStop(0.7, `rgba(10,2,2,${0.16 * k0})`); gr.addColorStop(1, 'rgba(10,2,2,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, 900);
  const a = ease.outExpo(clamp(age / 0.25)), k = Math.exp(-age * 12);
  const L = BRAND.acc_lockup, maxS = (SAFE.x2 - SAFE.x1) / (L.width / L.height);
  const s = Math.min(maxS, 200 * (1 + 0.12 * k));
  sigil(g, W / 2, 400, s, { color: C.cream, accent: '#e0301c', alpha: a });
  line(g, 'ACP.US', W / 2, 640, { family: 'Archivo Black', size: 76, color: C.cream, alpha: clamp((age - 0.3) * 5) });
}

// ================================================================ the crowd frame: ground, horizon, men
async function crowdFrame(b, t, frame, kick) {
  const Cm = camAt(b, kick);
  const dusk = smooth(T.done + 1, 58, b), night = smooth(54.5, 59.5, b), pay = b >= T.payoff ? Math.exp(-(b - T.payoff) * 0.9) : 0;
  const dayK = lerp(1, 0.52, dusk) * lerp(1, 0.34, night);
  const o = { frame, ground: dayK * lerp(1, 1.6, night), body: dayK * lerp(1, 0.6, night), shadow: CSET.shadow * lerp(1, 0.25, night), dust: CSET.dust * (1 - 0.5 * night), light: smooth(53.5, 58.5, b) * (1 + 1.2 * pay) * (1 - 0.9 * smooth(T.close, T.close + 3, b)), lit: 0.9 * smooth(54, 59, b) * (1 - 0.92 * smooth(T.close, T.close + 3, b)), glow: smooth(54, 58.5, b), flash: 0.2 * (b >= T.done ? Math.exp(-(b - T.done) * spb * 14) : 0) + (b < T.crowd ? 0.30 * Math.exp(-(b - T.hats) * spb * 16) : 0) };
  gl.disable(gl.BLEND);
  if (Cm.hy > -300) {                             // the horizon is in the frame: the riders and wagons of the plain, and the sky that turns to stars
    const L = layerOf('sky', b); L.night = smooth(52.5, 56.5, b);
    L.c = [0.5, 0.655 - (Cm.hy / H - 0.5) / L.z];
    await setLayer('a', L); drawFilm('a', L, { frame, kick, dim: 0.5 * dusk });
  }
  drawGround(Cm, b, o);
  drawCrowd(Cm, b, t, o);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

// ================================================================ the frame
window.renderFrame = async (t) => {
  const bp = t / spb, frame = Math.round(t * 30);
  const inMont = bp >= MONT_AT && bp < MONT_AT + MONT_LEN, b = bp < MONT_AT ? bp : inMont ? MONT_AT - 0.001 : bp - MONT_LEN;     // the old timeline, paused across the montage
  if (inMont) {
    typeAudit.reset(); window.typeInfo = () => typeAudit.items;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    gl.viewport(0, 0, W, H); gl.disable(gl.BLEND); gl.clearColor(0.03, 0.005, 0.005, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const nm = montShot(bp), L = layerOf(nm, bp), age = (bp - SEG[nm].b0) * spb;
    await setLayer('a', L);
    drawFilm('a', L, { frame, kick: kickEnv(t), flash: (SEG[nm].len < 1 ? 0.16 : 0.30) * Math.exp(-age * 16) });
    ctx.drawImage(GLC, 0, 0);
    finish.apply(ctx, frame, { grain: 0.06, vignette: 0.45 });
    return { shot: nm, b: +bp.toFixed(2) };
  }
  typeAudit.reset(); window.typeInfo = () => typeAudit.items;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  gl.viewport(0, 0, W, H); gl.disable(gl.BLEND); { const bb = t / spb, dk = bb > 8 && bb < 10.8 ? Math.sin(Math.PI * (bb - 8) / 2.8) : 0; gl.clearColor(0.03 + 0.20 * dk, 0.005 + 0.025 * dk, 0.005 + 0.025 * dk, 1); } gl.clear(gl.COLOR_BUFFER_BIT);
  const kick = kickEnv(t);
  const D = DISS.find(d => b >= d.b0 && b < d.b1);
  let shown = ORDER.filter(n => b >= SEG[n].b0 && b < SEG[n].b1);
  if (b >= T.hats) await crowdFrame(b, t, frame, kick);
  else if (D) {
    const u = (b - D.b0) / (D.b1 - D.b0), LA = layerOf(D.a, b), LB = layerOf(D.b, b), P = await prepDiss(D);
    await setLayer('a', LA); await setLayer('b', LB);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    drawFilm('b', LB, { frame, kick, mode: 3, u, sweep: [-D.dir[0], -D.dir[1]], alpha: 1 });
    drawFilm('a', LA, { frame, kick, mode: 1, u, sweep: [-D.dir[0], -D.dir[1]] });
    drawParticles(D, P, LA, { ...LB, z: LB.z, c: LB.c, grade: LB.grade }, u);
  } else {
    const nm = shown[shown.length - 1] || ORDER[ORDER.length - 1], L = layerOf(nm, b);
    await setLayer('a', L);
    const age = (b - SEG[nm].b0) * spb, cut = nm !== 'r0' && !['c2', 'c3', 'heave', 'hats'].includes(nm) ? 0.30 * Math.exp(-age * 16) : 0;
    drawFilm('a', L, { frame, kick, flash: cut });
  }
  { const e = b < T.done ? 0 : 0.06 + 0.16 * smooth(T.done, 60, b) + 0.45 * smooth(T.close, T.close + 3, b); drawEmbers(t, e, 560, 1560); }
  ctx.drawImage(GLC, 0, 0);
  if (b >= T.done - 0.05) {                       // the mark completes: a flash of the whole crowd, and the payoff's, which is the biggest
    const f1 = b < T.payoff ? Math.exp(-(b - T.done) * spb * 10) : 0, f2 = b >= T.payoff ? Math.exp(-(b - T.payoff) * spb * 11) : 0;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,150,80,${0.14 * f1 + 0.16 * f2})`; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  // ---------------------------------------------------------------- words
  if (b >= T.close) { lockup(ctx, (b - T.close) * spb); finish.apply(ctx, frame, { grain: 0.07, vignette: 0.5 }); return {}; }
  SENT.forEach((S, si) => {
    if (b < S.at[0] - 0.05 || b >= S.end - 0.06) return;
    S.lines.forEach((_, li) => { const age = (b - S.at[li]) * spb; if (b >= S.at[li] - 0.05) flatPrint(ctx, SB[si], age, { seed: si * 7 + li + 1, only: [li], scale: 1 + 0.05 * Math.exp(-Math.max(0, age) * 20) }); });
  });
  const cb = CHANT.findIndex((c, i) => b >= c - 0.05 && b < c + 1 - 0.1);
  if (cb >= 0) flatPrint(ctx, blockFor(ALL, 'slam', 900), (b - CHANT[cb]) * spb, { seed: 50 + cb, role: 'slam' });
  if (b >= T.payoff - 0.05) { const blk = blockFor(ALL, 'payoff', 470), a = ease.outCubic(clamp((b - T.payoff + 0.05) * spb * 12)); flatPrint(ctx, blk, (b - T.payoff) * spb, { seed: 96, role: 'payoff', alpha: a }); }
  finish.apply(ctx, frame, { grain: 0.06, vignette: 0.45 });
  return { shot: shown.join('+'), b: +b.toFixed(2) };
};
window.sceneReady = true;
