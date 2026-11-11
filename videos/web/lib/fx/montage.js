// MONTAGE: constructivist photomontage and poster composition (Klutsis, Kulagina, Lissitzky, Rodchenko; the
// Heartfield cut; WPA flat-ink posters). WebGL2, one draw per element, blending in the default framebuffer, so a
// frame costs a paper pass + one quad per element + one finish pass.
//
//   import { Montage, twos } from '../lib/fx/montage.js';
//   const m = new Montage(1080, 1920);
//   m.begin(t, { paper: 'cream' });                                   // stock: 'cream' 'newsprint' 'kraft' 'white' 'black' or '#hex'
//   m.shape('band', { x: 540, y: 900, angle: -32, w: 420, ink: '#BD1818' });            // the red 32° band
//   m.cutout(plate.cut, { x: 540, y: 1100, h: 1400, rot: -0.05, treat: 'halftone', cell: 9, angle: 45,
//                        border: 14, edge: 'scissor', shadow: [10, 14, 10, 0.45], rim: { dir: [-1, -0.4], amt: 0.6, w: 22 } });
//   m.ink(typeCanvas, { ink: '#141414', misreg: [2, -1] });           // any canvas's alpha, printed as ink
//   m.end(ctx);                                                        // finish pass (tooth, mottle, creases) + draw into ctx
//
// Elements (all positions in output px; every option has a default):
//   cutout(src, o)  a photo (or any image/canvas) as a cut paper piece. src with alpha -> cut along the alpha; without
//                   -> a rectangle. Placement: x, y (centre), h (on-screen height) or w, rot (rad), anchor [0.5, 0.5],
//                   crop [x0, y0, x1, y1] (uv) for a sub-region, flip.
//                   treat: 'photo' (silver print: levels -> ink..paper gradient + grain), 'halftone' (AM screen in the
//                   piece's own space, so the dots travel with it), 'duotone' (black key + ink2 at angle2, misregistered),
//                   'gravure' (rotogravure cells: constant cells, variable depth, sawtooth edges), 'flat' (solid ink
//                   silhouette), 'line' (engraved horizontal line screen, swell by tone).
//                   levels [lo, hi, gamma], contrast, ink, ink2, paper (the piece's own photo paper), cell, angle,
//                   angle2, grain. edge: 'scissor' (low wobble), 'torn' (fibrous white rim), 'none' (hard cut on the
//                   alpha, no paper margin). border (px of paper margin), shadow [dx, dy, blur, opacity].
//                   rim { dir [x, y] screen, amt, w px, col } lights the silhouette's edge from dir (from the SDF gradient).
//                   blend: 'normal' | 'multiply' (overprint). opacity.
//   image(src, o)   = cutout with edge 'none', border 0, no shadow; o.fill = 'cover' fills the frame.
//   shape(kind, o)  flat ink with ink texture: 'band' {x, y, angle (deg), w, len}, 'disc' {x, y, r}, 'ring' {x, y, r, w},
//                   'poly' {pts: [[x, y], ...] up to 8}, 'rect' {x, y, w, h, angle}. rough (px edge ragging), ink,
//                   blend, opacity, density (0.8-1 uneven solid).
//   ink(canvas, o)  the canvas's alpha as ink: ink, misreg [dx, dy], blend, opacity, spread (px of squash).
//   end(ctx, o)     finish: tooth, mottle, crease lines (o.creases: [[x0, y0, x1, y1], ...]), age (edge browning),
//                   and draws to ctx (or leave ctx null and use m.canvas).
//
// Stateless: every element is a function of its options and (for grain/boil) begin()'s t. twos(t, 12) steps time for
// stop-motion paper (VISUAL_BIBLE art move 2); boil(o, t, seed, px) jitters a cutout by a pixel or two per step.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const twos = (t, fps = 12) => Math.floor(t * fps + 1e-6) / fps;
export function boil(o, t, seed = 1, px = 1.5, fps = 12) {
  const k = Math.floor(t * fps + 1e-6), h = n => { let x = Math.imul((k * 73856093) ^ (seed * 19349663) ^ (n * 83492791), 2654435761); x ^= x >>> 15; return ((x >>> 0) % 10000) / 5000 - 1; };
  return { ...o, x: o.x + h(1) * px, y: o.y + h(2) * px, rot: (o.rot || 0) + h(3) * px * 0.0012 };
}
const hex = h => { if (Array.isArray(h)) return h; h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); };
export const STOCK = {
  cream: { base: '#ece0c8', fib: 0.05, mot: 0.06, fleck: 0.25, tooth: 0.5 },
  newsprint: { base: '#dcd6c6', fib: 0.07, mot: 0.07, fleck: 0.5, tooth: 0.6 },
  kraft: { base: '#b9936a', fib: 0.1, mot: 0.08, fleck: 0.6, tooth: 0.7 },
  white: { base: '#f3f0e9', fib: 0.03, mot: 0.03, fleck: 0.15, tooth: 0.35 },
  black: { base: '#161312', fib: 0.04, mot: 0.05, fleck: 0.1, tooth: 0.4 },
  red: { base: '#b4171b', fib: 0.04, mot: 0.07, fleck: 0.1, tooth: 0.5 },
};
export const INK = { black: '#17130f', red: '#c3161c', acp: '#BD1818', cream: '#f4e6d0', sepia: '#3a2418', blue: '#1b2f5a', gold: '#b88a2c' };
const ink = c => hex(INK[c] || c);

const VS = `#version 300 es
uniform vec2 uO, uAx, uAy, uM, uRes;
out vec2 vUv; out vec2 vPx;
void main(){ vec2 c = vec2(gl_VertexID & 1, gl_VertexID >> 1); vec2 a = mix(-uM, 1. + uM, c);
  vec2 p = uO + a.x * uAx + a.y * uAy; vUv = a; vPx = p; gl_Position = vec4(p.x / uRes.x * 2. - 1., 1. - p.y / uRes.y * 2., 0., 1.); }`;

const COMMON = `#version 300 es
precision highp float;
in vec2 vUv; in vec2 vPx; out vec4 o;
uniform sampler2D uN; uniform float uT, uSeed, uMul, uOpacity;
float N(vec2 p, int ch){ vec4 v = texture(uN, p / 512.); return ch == 0 ? v.r : ch == 1 ? v.g : ch == 2 ? v.b : v.a; }
float fbm(vec2 p){ return N(p, 0) * .55 + N(p * 2.13 + 17.3, 0) * .3 + N(p * 4.7 + 5.1, 1) * .15; }
vec3 toneOut(vec3 c, float a){ return c; }
void emit(vec3 c, float a){ a *= uOpacity; if (uMul > .5) o = vec4(mix(vec3(1), c, a), 1.); else o = vec4(c * a, a); }
`;

const FS_PAPER = COMMON + `
uniform vec3 uBase; uniform vec4 uP; // fib, mot, fleck, tooth
void main(){
  vec2 p = vPx;
  float mot = fbm(p * .35) - .5, mot2 = fbm(p * 0.06 + 40.) - .5;
  float fib = N(vec2(p.x * .9, p.y * .08) + 3., 1) - .5;             // long fibres (machine direction = vertical)
  float fib2 = N(vec2(p.x * .07, p.y * .6) + 9., 1) - .5;
  float tooth = N(p * 1.7, 3) - .5;
  float fl = smoothstep(.985, 1., N(p * .8 + 71., 3)) * uP.z;         // flecks
  vec3 c = uBase * (1. + mot * uP.y + mot2 * uP.y * 1.4 + (fib * .6 + fib2 * .4) * uP.x + tooth * uP.w * .06);
  c = mix(c, c * .55, fl);
  o = vec4(c, 1.);
}`;

const FS_CUT = (TREAT, EDGE, RIM, SHADOW, HASA) => COMMON.replace('#version 300 es', `#version 300 es
#define TREAT ${TREAT}
#define EDGE ${EDGE}
#define RIM ${RIM}
#define SHADOW ${SHADOW}
#define HASA ${HASA}`) + `
uniform sampler2D uImg, uSdf;

uniform vec2 uPx, uSdfRes; uniform vec4 uCrop;
uniform float uBorder, uCell, uAng, uAng2, uGrain, uContrast, uRimW, uRimA, uBoilT, uRimInk;
uniform vec3 uInk, uInk2, uPaper, uLev, uRimC; uniform vec2 uRimD, uMis, uVig; uniform vec4 uShadow;
const vec3 LW = vec3(.2126, .7152, .0722);
vec2 cropUv(vec2 uv){ return mix(uCrop.xy, uCrop.zw, uv); }
float sdPx(vec2 uv){                          // signed distance to the piece's alpha edge in screen px (+ outside)
#if HASA == 0
  vec2 q = (abs(uv - .5) - .5) * uPx; return length(max(q, 0.)) + min(max(q.x, q.y), 0.);
#else
  vec2 c = clamp(uv, 0., 1.);
  float d = texture(uSdf, cropUv(c)).r * uPx.y / (uCrop.w - uCrop.y);
  vec2 q = (abs(uv - .5) - .5) * uPx; float rect = length(max(q, 0.)) + min(max(q.x, q.y), 0.);
  return max(d, rect);                        // the photo's own edge is a cut too
#endif
}
float lumC(vec3 c){
  float l = dot(c, LW);
  float dl = uLev.y - uLev.x; l = clamp((l - uLev.x) / (abs(dl) < 1e-3 ? 1e-3 : dl), 0., 1.); l = pow(l, uLev.z);   // hi < lo inverts
  float s = l * l * (3. - 2. * l); return mix(l, s, uContrast);
}
float lum(vec2 uv){ return lumC(texture(uImg, cropUv(uv)).rgb); }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float screen(vec2 px, float cov, float ang, float cell){     // AM round dot, cov 0..1 -> ink 0..1 (AA)
  vec2 q = rot(ang) * px / cell;
  float s = .5 - .25 * (cos(6.2831853 * q.x) + cos(6.2831853 * q.y));
  float w = fwidth(s) * .8 + 1e-4;
  return smoothstep(s - w, s + w, cov);
}
void main(){
  vec2 uv = vUv;
  float d = sdPx(uv);
  // the paper piece: margin border px around the alpha, its edge cut by scissors or torn
  vec2 along = uv * uPx;                                          // piece-space px (the edge noise travels with it)
  float wob = 0.;
  float aa = max(fwidth(d), .6);
#if EDGE == 1
  if (abs(d - uBorder) < uBorder + 24.) wob = (fbm(along * .015 + uSeed) - .5) * uBorder * .9 + (N(along * .3, 1) - .5) * .8;
#elif EDGE == 2
  if (abs(d - uBorder) < uBorder + 30.) wob = (fbm(along * .06 + uSeed) - .5) * max(uBorder, 6.) * 1.3 + (N(along * .9 + uSeed, 1) - .5) * 5.;
#endif
  float edgeD = d - uBorder - wob;
#if EDGE == 0
  float piece = smoothstep(aa, -aa, d);
#else
  float piece = smoothstep(aa, -aa, edgeD);
#endif
  // torn: a white fibrous core shows along the tear (the paper split through its thickness)
  float fibre = 0.;
#if EDGE == 2
  if (edgeD > -8.) fibre = smoothstep(-7., -1., edgeD) * (.6 + .4 * N(along * 1.3, 3));
#endif
  // shadow of the piece on what is under it
  float sh = 0.;
#if SHADOW == 1
  if (edgeD > -2.) {
    vec2 so = uShadow.xy / uPx;
    float ds = sdPx(uv - so) - (EDGE == 0 ? 0. : uBorder);
    sh = (1. - smoothstep(-uShadow.z, uShadow.z, ds)) * uShadow.w;
  }
#endif
  // the photograph inside
  if (d > uBorder + 40. && sh <= 0.) discard;
  vec4 px = texture(uImg, cropUv(clamp(uv, 0., 1.)));
  float a = (HASA == 1 ? px.a : 1.) * step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
  if (uVig.x > 0.) { vec2 q = (uv - .5) * 2. * vec2(uPx.x / uPx.y, 1.); a *= 1. - smoothstep(uVig.x - uVig.y, uVig.x, length(q)); }
  float L = lumC(px.rgb); float rimK = 0.;
  // rim light from the SDF gradient: the silhouette's outward normal, lit from uRimD
#if RIM > 0
  {
    float e = 3. / uPx.y;                                         // 2-tap forward difference (smooth, unlike 2x2-quad dFdx)
    vec2 g = vec2(sdPx(uv + vec2(e * uPx.y / uPx.x, 0.)) - d, sdPx(uv + vec2(0., e)) - d);
    float facing = smoothstep(.05, .75, dot(normalize(g + 1e-5), normalize(uRimD)));
    float rim = facing * (1. - smoothstep(uRimW * .35, uRimW, -d)) * step(d, 3.);
    rimK = rim * uRimA;
#if RIM == 1
    L = mix(L, 1., rimK);
#endif
  }
#endif
  vec2 sp = uv * uPx;                                            // screen-scaled piece space for screens and grain
  float tooth = N(vPx * 1.7, 3);
  vec3 c;
#if TREAT == 0
  {                                              // silver print
    float grain = (N(vPx + vec2(uBoilT * 131.7, uBoilT * 57.3), 3) - .5) + (N(vPx * .5 + uBoilT * 33.1, 3) - .5) * .6;
    float l = clamp(L + grain * uGrain, 0., 1.);
    c = mix(uInk, uPaper, l);
  }
#elif TREAT == 1
  {                                       // halftone
    float k = screen(sp, (1. - L) * (.92 + .16 * tooth), uAng, uCell);
    c = mix(uPaper, uInk, k * (.9 + .1 * tooth));
  }
#elif TREAT == 2
  {                                       // duotone: key + colour, misregistered
    float k1 = screen(sp, pow(1. - L, 1.35), uAng, uCell);
    float L2 = lum(clamp(uv - uMis / uPx, 0., 1.));
    float k2 = screen(sp - uMis, clamp((1. - L2) * 1.15 - .05, 0., 1.), uAng2, uCell * 1.05);
    c = uPaper * mix(vec3(1), uInk2, k2 * .95) * mix(vec3(1), uInk, k1 * .96);
  }
#elif TREAT == 3
  {                                       // flat silhouette
    c = uInk * (.93 + .1 * fbm(sp * .2));
  }
#elif TREAT == 4
  {                                       // rotogravure: fixed cells, depth = tone
    mat2 R = rot(.785398); vec2 q = R * sp / uCell; vec2 id = floor(q), f = fract(q);
    vec2 cuv = (transpose(R) * ((id + .5) * uCell)) / uPx;
    float dens = 1. - lum(clamp(cuv, 0., 1.));
    float wall = .1 + .06 * (1. - dens);
    vec2 bw = smoothstep(vec2(0.), vec2(wall), f) * smoothstep(vec2(0.), vec2(wall), 1. - f);
    float cellm = bw.x * bw.y;
    float inkv = dens * mix(.3, 1., cellm) * (.93 + .12 * (N(q * 7., 3) - .5));
    c = uPaper * mix(vec3(1), uInk, clamp(inkv * 1.06, 0., 1.));
  }
#else
  {                                                               // engraved line screen: swelling rules
    vec2 q = rot(uAng) * sp / uCell; float f = abs(fract(q.y) - .5) * 2.;
    float wdt = clamp((1. - L) * 1.05, 0., 1.);
    float k = smoothstep(wdt + fwidth(f), wdt - fwidth(f), f);
    c = mix(uPaper, uInk, k);
  }
#endif
  // rim as a spot ink (e.g. the red of the sun on the face's edge), printed solid over the screen

  // ink sits in the paper's tooth
  c = mix(c, c * (.9 + .2 * tooth), .5);
  vec3 paperC = a > .99 ? uPaper : uPaper * (.96 + .08 * fbm(sp * .3));
  vec3 piecec = mix(paperC, vec3(1.), fibre * .7);
  // over: photo over the paper piece over the shadow
  vec3 col = mix(piecec, c, a);
#if RIM == 2
  col = mix(col, uRimC, smoothstep(.04, .22, rimK) * smoothstep(3., 0., d));   // spot ink straddles the cut edge
#endif
  float alpha = EDGE == 0 ? a * piece : piece;
  if (uMul > .5) { emit(col, alpha); return; }
  vec4 top = vec4(col * alpha, alpha);
  vec4 shd = vec4(0., 0., 0., sh * (1. - alpha));
  o = (top + shd) * uOpacity;
}`;

const FS_SHAPE = COMMON + `
uniform int uKind; uniform vec4 uA; uniform vec4 uB; uniform vec2 uPts[8]; uniform int uNp;
uniform vec3 uInk; uniform float uRough, uDens;
float sdPoly(vec2 p){
  float d = dot(p - uPts[0], p - uPts[0]); float s = 1.;
  for (int i = 0; i < 8; i++) {
    if (i >= uNp) break; int jj = i == 0 ? uNp - 1 : i - 1;
    vec2 e = uPts[jj] - uPts[i], w = p - uPts[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0., 1.); d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= uPts[i].y, p.y < uPts[jj].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s *= -1.;
  }
  return s * sqrt(d);
}
void main(){
  vec2 p = vPx; float d;
  if (uKind == 0) {            // band: centre uA.xy, angle uA.z (rad), width uA.w, half length uB.x
    vec2 dir = vec2(cos(uA.z), sin(uA.z)), n = vec2(-dir.y, dir.x); vec2 q = p - uA.xy;
    d = max(abs(dot(q, n)) - uA.w * .5, abs(dot(q, dir)) - uB.x);
  } else if (uKind == 1) d = length(p - uA.xy) - uA.z;
  else if (uKind == 2) d = abs(length(p - uA.xy) - uA.z) - uA.w * .5;
  else if (uKind == 3) d = sdPoly(p);
  else {                       // rect: centre uA.xy, size uA.zw, angle uB.x
    float c = cos(uB.x), s = sin(uB.x); vec2 q = mat2(c, s, -s, c) * (p - uA.xy); vec2 e = abs(q) - uA.zw * .5;
    d = length(max(e, 0.)) + min(max(e.x, e.y), 0.);
  }
  if (d > uRough + 3.) discard;
  if (d > -uRough - 3.) d += (fbm(p * .05 + uSeed) - .5) * uRough + (N(p * .7 + uSeed, 1) - .5) * uRough * .35;
  float cov = smoothstep(.8, -.8, d);
  float tooth = N(p * 1.7, 3);
  float dens = mix(1., .82 + .3 * N(p * .02 + uSeed * 3., 0), 1. - uDens) * (.93 + .1 * tooth);
  // squeegee / roller: a faint lighter streak along the ink's travel
  dens *= .97 + .05 * N(vec2(p.x * .01, p.y * .6) + uSeed, 1);
  vec3 c = uInk * mix(1.08, .95, clamp(dens, 0., 1.));
  // ink rim: slight build-up at the edge of flat ink
  c *= 1. - .08 * smoothstep(-3., 0., d);
  emit(c, cov * clamp(dens * 1.05, 0., 1.));
}`;

const FS_INK = COMMON + `
uniform sampler2D uImg; uniform vec3 uInk; uniform vec2 uMis, uRes2; uniform float uSpread;
void main(){
  vec2 uv = (vPx - uMis) / uRes2;
  float a = texture(uImg, uv).a;
  if (uSpread > 0.) { float b = textureLod(uImg, uv, 1.5).a; a = max(a, smoothstep(.2, .6, b) * .9); }
  float tooth = N(vPx * 1.7, 3);
  a *= .9 + .12 * tooth;
  // a squashed ink edge: slightly darker rim where the ink pooled
  vec3 c = uInk * (1. - .1 * smoothstep(.95, .5, a) * step(.05, a));
  emit(c, clamp(a, 0., 1.));
}`;

const FS_FIN = COMMON + `
uniform float uAge, uTooth; uniform vec4 uCr[4]; uniform int uNcr; uniform vec2 uRes2;
void main(){
  vec2 p = vPx, q = p / uRes2;
  float tooth = N(p * 1.7, 3) - .5, mot = fbm(p * .12 + 90.) - .5;
  float m = 1. + tooth * .05 * uTooth + mot * .04;
  // age: edges of the sheet brown and darken a little
  float e = min(min(q.x, 1. - q.x), min(q.y, 1. - q.y));
  m *= 1. - uAge * (.22 * (1. - smoothstep(0., .06, e)) + .05 * (1. - smoothstep(0., .3, e)));
  // creases: a fold is a lit ridge next to a shadowed valley, plus lost ink (white) along its line
  for (int i = 0; i < 4; i++) { if (i >= uNcr) break;
    vec2 a = uCr[i].xy, b = uCr[i].zw, ab = b - a; float h = clamp(dot(p - a, ab) / dot(ab, ab), 0., 1.);
    vec2 n = normalize(vec2(-ab.y, ab.x)); float sd = dot(p - a, n) + (N(p * .2, 0) - .5) * 3.;
    m *= 1. + .1 * exp(-sd * sd / 8.) * sign(sd) - .07 * exp(-sd * sd / 30.);
  }
  o = vec4(vec3(m), 1.);
}`;

const FS_TEX = COMMON + `
uniform sampler2D uImg; uniform vec2 uRes2;
void main(){ vec3 c = texture(uImg, vec2(vPx.x / uRes2.x, 1. - vPx.y / uRes2.y)).rgb; if (uMul > .5) o = vec4(c, 1.); else o = vec4(c, 1.); }`;

// a surface (tiled photo texture, e.g. a quilt.py output) under raking light, with an optional poster pasted onto it
const FS_WALL = COMMON + `
uniform sampler2D uWall, uPoster; uniform vec3 uTint; uniform vec2 uLight, uRes2; uniform float uTile, uBump, uGrime, uHasP, uConform, uTear, uWet, uOnlyP;
uniform vec2 uPO, uPAx, uPAy;               // poster placement: screen px = uPO + u * uPAx + v * uPAy
float H(vec2 p){ return dot(texture(uWall, p / uTile).rgb, vec3(.333)); }
void main(){
  vec2 p = vPx;
  float h = H(p), hx = H(p + vec2(1.5, 0)), hy = H(p + vec2(0, 1.5));
  vec3 n = normalize(vec3((h - hx) * uBump, (h - hy) * uBump, 1.));
  vec3 L = normalize(vec3(uLight, .55));
  float lam = clamp(dot(n, L), 0., 1.);
  float shade = .35 + .8 * lam;
  float grime = uGrime * smoothstep(.45, .9, N(vec2(p.x * .9, p.y * .05) + uSeed, 0)) * .5;   // rain streaks
  vec3 wall = uTint * mix(.75, 1.15, h) * shade * (1. - grime * .5);
  vec3 col = wall;
  if (uHasP > .5) {
    mat2 A = mat2(uPAx, uPAy); vec2 uv = inverse(A) * (p - uPO);
    float inside = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
    vec2 e = min(uv, 1. - uv) * vec2(length(uPAx), length(uPAy));
    float edge = min(e.x, e.y) + (fbm(p * .05 + 3.) - .5) * 14. + (N(p * .6, 1) - .5) * 5.;
    // torn-off patches: where the tear field is high the paper is gone, a white fibrous rim around each hole
    float tear = fbm(p * .16 + 11.) + (N(p * 2.5, 0) - .5) * .1, th = .72 - uTear * .6;
    float gone = smoothstep(th, th + .015, tear) * step(.001, uTear);
    float rim = smoothstep(th - .03, th, tear) * (1. - gone) * step(.001, uTear);
    float on = inside * smoothstep(0., 1.5, edge) * (1. - gone);
    vec3 pc = texture(uPoster, uv).rgb;
    // the paper conforms to the wall (takes its shading), with wrinkles and glue-wet dark edges
    float wr = (N(vec2(uv.x * 120., uv.y * 1400.) + 5., 1) - .5) * .1 + (N(uv * vec2(1800., 160.), 1) - .5) * .05;
    // paper bridges the small stones: it takes the low-passed relief, plus a little of the fine one
    float big = fbm(p * .25 + 40.) - .5;                                   // the paper's own slow undulation (bubbles, glue lumps)
    float conform = (1. + ((shade - .95) * .22 + big * .18) * uConform) * (1. + wr);
    float wet = uWet * (1. - smoothstep(0., 40., edge)) * .25 + uWet * .14 * smoothstep(.55, .8, N(p * .3 + 2., 0));
    col = mix(col, pc * conform * (1. - wet), on);
    col = mix(col, vec3(.93, .9, .84) * shade, rim * inside * .9);
    if (uOnlyP > .5 && on + rim * inside < .01) discard;
  }
  o = vec4(col, 1.);
}`;

function sh(gl, type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n')); return s; }
function prog(gl, fs) {
  const p = gl.createProgram(); gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i), nm = a.name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}

// tileable value-noise atlas: r fbm-ready smooth, g ridged, b streak, a white (per-pixel) noise
function noiseData(n = 512, seed = 11) {
  const d = new Uint8Array(n * n * 4);
  let s = seed >>> 0; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const lat = P => { const g = new Float32Array(P * P); for (let i = 0; i < g.length; i++) g[i] = rnd(); return g; };
  const val = (g, P, x, y) => { const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const G = (a, b) => g[((b % P) + P) % P * P + ((a % P) + P) % P];
    return (G(i, j) * (1 - su) + G(i + 1, j) * su) * (1 - sv) + (G(i, j + 1) * (1 - su) + G(i + 1, j + 1) * su) * sv; };
  const oct = [16, 32, 64, 128].map(P => ({ P, g: lat(P) })), rid = [32, 64, 128].map(P => ({ P, g: lat(P) }));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let a = 0, w = 0, amp = 1; for (const o of oct) { a += val(o.g, o.P, x / n * o.P, y / n * o.P) * amp; w += amp; amp *= 0.5; }
    let r = 0, wr = 0; amp = 1; for (const o of rid) { r += (1 - Math.abs(val(o.g, o.P, x / n * o.P, y / n * o.P) * 2 - 1)) * amp; wr += amp; amp *= 0.5; }
    const i = (y * n + x) * 4;
    d[i] = a / w * 255; d[i + 1] = r / wr * 255; d[i + 2] = val(oct[2].g, 64, x / n * 64, y / n * 64) * 255; d[i + 3] = rnd() * 255;
  }
  return d;
}

// Felzenszwalb-Huttenlocher squared EDT, 1D pass
function edt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edt(mask, w, h) {             // mask: 1 = feature; returns distance (px) to the nearest feature pixel
  const INF = 1e20, g = new Float32Array(w * h), n = Math.max(w, h), f = new Float32Array(n), d = new Float32Array(n), v = new Int32Array(n), z = new Float32Array(n + 1);
  for (let i = 0; i < w * h; i++) g[i] = mask[i] ? 0 : INF;
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x]); }
  return g;
}
// signed distance of an image's alpha (in units of the image height; + outside), at <= maxSide px
export function alphaSDF(src, maxSide = 900) {
  const sw = src.naturalWidth || src.width, shh = src.naturalHeight || src.height, s = Math.min(1, maxSide / Math.max(sw, shh));
  const w = Math.max(4, Math.round(sw * s)), h = Math.max(4, Math.round(shh * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, w, h); const px = x.getImageData(0, 0, w, h).data;
  const inside = new Uint8Array(w * h), outside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { const a = px[i * 4 + 3] > 127; inside[i] = a; outside[i] = !a; }
  const dOut = edt(inside, w, h), dIn = edt(outside, w, h), out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = (dOut[i] - dIn[i] + (inside[i] ? 0.5 : -0.5)) / h;
  return { data: out, w, h };
}

// bounding box (output px) of a canvas's ink, from a 1/8 scan; [0, 0, 0, 0] when empty
export function alphaBox(src, k = 8) {
  const w = Math.ceil(src.width / k), h = Math.ceil(src.height / k), c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, w, h); const p = x.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (p[(j * w + i) * 4 + 3] > 0) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  if (x1 < 0) return [0, 0, 0, 0];
  const sx = src.width / w, sy = src.height / h; return [(x0 - 1) * sx, (y0 - 1) * sy, (x1 + 2) * sx, (y1 + 2) * sy];
}
// luma percentiles of an image (inside its alpha), for levels: 'auto'
export function lumaStats(src, hasA = true, n = 128) {
  const sw = src.naturalWidth || src.width, shh = src.naturalHeight || src.height, s = n / Math.max(sw, shh);
  const w = Math.max(2, Math.round(sw * s)), h = Math.max(2, Math.round(shh * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, w, h); const p = x.getImageData(0, 0, w, h).data, v = [];
  for (let i = 0; i < w * h; i++) if (!hasA || p[i * 4 + 3] > 200) v.push((0.2126 * p[i * 4] + 0.7152 * p[i * 4 + 1] + 0.0722 * p[i * 4 + 2]) / 255);
  v.sort((a, b) => a - b); const q = f => v.length ? v[Math.min(v.length - 1, Math.floor(f * v.length))] : f;
  return { p01: q(0.01), p50: q(0.5), p99: q(0.99) };
}
// [lo, hi, gamma] that stretch 1..99 % and put the median on mid
export function autoLevels(st, mid = 0.42) {
  const lo = st.p01, hi = Math.max(st.p99, lo + 0.05), m = Math.min(0.95, Math.max(0.05, (st.p50 - lo) / (hi - lo)));
  return [lo, hi, Math.log(mid) / Math.log(m)];
}

export class Montage {
  constructor(W = 1080, H = 1920, { canvas = null } = {}) {
    this.W = W; this.H = H;
    this.canvas = canvas || Object.assign(document.createElement('canvas'), { width: W, height: H });
    const gl = this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, alpha: false });
    if (!gl) throw new Error('montage: no webgl2');
    gl.getExtension('EXT_color_buffer_float'); gl.getExtension('OES_texture_float_linear');
    this.vao = gl.createVertexArray();
    this.P = { paper: prog(gl, FS_PAPER), cutv: new Map(), shape: prog(gl, FS_SHAPE), ink: prog(gl, FS_INK), fin: prog(gl, FS_FIN), tex: prog(gl, FS_TEX), wall: prog(gl, FS_WALL) };
    this.baked = new Map();
    this.noise = this._tex(noiseData(), 512, 512, { repeat: true });
    this.cache = new WeakMap(); this.t = 0; this.seed = 1; this.stats = { draws: 0 };
  }
  _tex(data, w, h, { repeat = false, float = false, mip = false } = {}) {
    const gl = this.gl, t = gl.createTexture(); gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, t);   // unit 7: uploads never disturb bound samplers
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.FLOAT, data);
    else if (data instanceof Uint8Array) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    return t;
  }
  // image/canvas -> { tex, sdf, w, h, alpha }. Images are cached; canvases re-upload every call unless dynamic: false.
  source(src, { dynamic = null, alpha = null } = {}) {
    if (dynamic === null) dynamic = src instanceof HTMLCanvasElement;   // canvases re-upload each call (their SDF stays from the first)
    let e = this.cache.get(src);
    if (e && !dynamic) return e;
    const gl = this.gl, w = src.naturalWidth || src.videoWidth || src.width, h = src.naturalHeight || src.videoHeight || src.height;
    if (!e) {
      const hasA = alpha ?? (/\.png(\?|$)/i.test(src.src || '') || src instanceof HTMLCanvasElement);
      e = { w, h, alpha: hasA, tex: this._tex(src, w, h, { mip: true }), sdf: null };
      if (hasA) { const s = alphaSDF(src); e.sdf = this._tex(s.data, s.w, s.h, { float: true }); e.sdfRes = [s.w, s.h]; }
      e.stats = lumaStats(src, hasA);
      this.cache.set(src, e);
    } else {
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, e.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src); gl.generateMipmap(gl.TEXTURE_2D);
    }
    return e;
  }
  _use(P, { ox = 0, oy = 0, ax = [this.W, 0], ay = [0, this.H], m = [0, 0], blend = 'normal', opacity = 1 } = {}) {
    const gl = this.gl; gl.useProgram(P.p); const u = P.u;
    gl.uniform2f(u.uO, ox, oy); gl.uniform2f(u.uAx, ax[0], ax[1]); gl.uniform2f(u.uAy, ay[0], ay[1]); gl.uniform2f(u.uM, m[0], m[1]);
    gl.uniform2f(u.uRes, this.W, this.H);
    if (u.uT) gl.uniform1f(u.uT, this.t); if (u.uSeed) gl.uniform1f(u.uSeed, this.seed);
    if (u.uMul) gl.uniform1f(u.uMul, blend === 'multiply' ? 1 : 0); if (u.uOpacity) gl.uniform1f(u.uOpacity, opacity);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.noise); if (u.uN) gl.uniform1i(u.uN, 0);
    gl.enable(gl.BLEND);
    if (blend === 'multiply') gl.blendFunc(gl.DST_COLOR, gl.ZERO); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return u;
  }
  // render a static full-frame pass once into a texture (paper stock, finish overlay), keyed by its options
  _bake(key, drawFn) {
    let b = this.baked.get(key); const gl = this.gl;
    if (!b) {
      const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.W, this.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.viewport(0, 0, this.W, this.H); drawFn(); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      b = { tex, fb }; this.baked.set(key, b);
    }
    return b.tex;
  }
  _blitTex(tex, blend) {
    const u = this._use(this.P.tex, { blend }), gl = this.gl; if (!blend) gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.uImg, 1); gl.uniform2f(u.uRes2, this.W, this.H);
    this._draw();
  }
  _draw() { const gl = this.gl; gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); this.stats.draws++;
    if (this.profile) { const t = performance.now(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this._px ||= new Uint8Array(4)); (this.stats.per ||= []).push(Math.round(performance.now() - t)); } }

  begin(t = 0, { paper = 'cream', seed = 1 } = {}) {
    const gl = this.gl; this.t = t; this.seed = seed; this.stats = { draws: 0 }; this.t0 = performance.now();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.W, this.H);
    const st = typeof paper === 'string' && STOCK[paper] ? STOCK[paper] : { ...STOCK.cream, ...(typeof paper === 'object' ? paper : { base: paper }) };
    const tex = this._bake('paper' + JSON.stringify(st) + seed, () => {
      const u = this._use(this.P.paper); gl.disable(gl.BLEND);
      gl.uniform3fv(u.uBase, hex(st.base)); gl.uniform4f(u.uP, st.fib, st.mot, st.fleck, st.tooth);
      this._draw();
    });
    this._blitTex(tex, null);
    return this;
  }

  cutout(src, o = {}) {
    const S = this.source(src, o);
    const crop = o.crop || [0, 0, 1, 1], cw = (crop[2] - crop[0]) * S.w, ch = (crop[3] - crop[1]) * S.h;
    let h = o.h ?? (o.w ? o.w * ch / cw : ch), w = h * cw / ch;
    if (o.fill === 'cover') { const s = Math.max(this.W / cw, this.H / ch) * (o.zoom || 1); w = cw * s; h = ch * s; }
    const rot = o.rot || 0, c = Math.cos(rot), s = Math.sin(rot), fl = o.flip ? -1 : 1;
    const ax = [c * w * fl, s * w * fl], ay = [-s * h, c * h];
    const an = o.anchor || [0.5, 0.5], x = o.x ?? this.W / 2, y = o.y ?? this.H / 2;
    const ox = x - an[0] * ax[0] - an[1] * ay[0], oy = y - an[0] * ax[1] - an[1] * ay[1];
    const edge = { none: 0, scissor: 1, torn: 2 }[o.edge ?? 'scissor'];
    const border = edge === 0 ? 0 : (o.border ?? 12), shd = o.shadow === false ? [0, 0, 1, 0] : (o.shadow || [8, 12, 10, 0.4]);
    const pad = border + Math.max(Math.abs(shd[0]), Math.abs(shd[1])) + shd[2] * 2 + 16;
    const TR = { photo: 0, halftone: 1, duotone: 2, flat: 3, gravure: 4, line: 5 }[o.treat || 'photo'], r = o.rim || null;
    const hasA = S.alpha && S.sdf ? 1 : 0, RIM = r ? (r.ink ? 2 : 1) : 0, SH = shd[3] > 0 ? 1 : 0, key = [TR, edge, RIM, SH, hasA].join();
    if (!this.P.cutv.has(key)) this.P.cutv.set(key, prog(this.gl, FS_CUT(TR, edge, RIM, SH, hasA)));
    const u = this._use(this.P.cutv.get(key), { ox, oy, ax, ay, m: [pad / w, pad / h], blend: o.blend, opacity: o.opacity ?? 1 });
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, S.tex); gl.uniform1i(u.uImg, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, S.sdf || this.noise); gl.uniform1i(u.uSdf, 2);
    gl.uniform2f(u.uPx, w, h); gl.uniform4f(u.uCrop, crop[0], crop[1], crop[2], crop[3]);
    gl.uniform1f(u.uBorder, border);
    gl.uniform4f(u.uShadow, shd[0], shd[1], shd[2], shd[3]);
    const lv = o.levels === 'auto' || !o.levels ? autoLevels(S.stats, o.mid ?? 0.42) : o.levels;
    gl.uniform3f(u.uLev, lv[0], lv[1], lv[2]); gl.uniform1f(u.uContrast, o.contrast ?? 0.4);
    gl.uniform3fv(u.uInk, ink(o.ink || 'black')); gl.uniform3fv(u.uInk2, ink(o.ink2 || 'red')); gl.uniform3fv(u.uPaper, hex(o.paper || '#f1ebdd'));
    gl.uniform1f(u.uCell, o.cell ?? 9); gl.uniform1f(u.uAng, (o.angle ?? 45) * Math.PI / 180); gl.uniform1f(u.uAng2, (o.angle2 ?? 15) * Math.PI / 180);
    gl.uniform1f(u.uGrain, o.grain ?? 0.08); gl.uniform2f(u.uMis, ...(o.misreg || [3, -2]));
    gl.uniform1f(u.uRimA, r ? (r.amt ?? 0.7) : 0); gl.uniform1f(u.uRimW, r ? (r.w ?? 10) : 1); gl.uniform2f(u.uRimD, ...(r ? r.dir || [-1, -0.3] : [1, 0]));
    gl.uniform3fv(u.uRimC, ink(r && r.ink || 'red'));
    gl.uniform2f(u.uVig, ...(o.vignette || [0, 0]));
    gl.uniform1f(u.uBoilT, Math.floor(this.t * (o.boilFps ?? 12)) * 0.123 % 7);
    this._draw();
    return this;
  }
  image(src, o = {}) { return this.cutout(src, { edge: 'none', shadow: false, border: 0, alpha: false, ...o }); }

  shape(kind, o = {}) {
    const K = { band: 0, disc: 1, ring: 2, poly: 3, rect: 4 }[kind];
    const x = o.x ?? this.W / 2, y = o.y ?? this.H / 2, pad = (o.rough ?? 2.5) * 2 + 4;
    let bb;                                             // screen bbox: the quad covers only the shape
    if (K === 1 || K === 2) { const r = (o.r ?? 300) + (K === 2 ? (o.w ?? 40) / 2 : 0) + pad; bb = [x - r, y - r, x + r, y + r]; }
    else if (K === 3) { const xs = o.pts.map(p => p[0]), ys = o.pts.map(p => p[1]); bb = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]; }
    else {
      const a = (o.angle ?? (K === 0 ? -32 : 0)) * Math.PI / 180, hl = K === 0 ? (o.len ?? 4000) / 2 : (o.w ?? 400) / 2, hw = K === 0 ? (o.w ?? 300) / 2 : (o.h ?? 200) / 2;
      const c = Math.cos(a), s2 = Math.sin(a), pts = [[hl, hw], [-hl, hw], [hl, -hw], [-hl, -hw]].map(([p, q]) => [x + c * p - s2 * q, y + s2 * p + c * q]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); bb = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
    }
    bb = [Math.max(0, bb[0]), Math.max(0, bb[1]), Math.min(this.W, bb[2]), Math.min(this.H, bb[3])];
    if (bb[2] <= bb[0] || bb[3] <= bb[1]) return this;
    const u = this._use(this.P.shape, { ox: bb[0], oy: bb[1], ax: [bb[2] - bb[0], 0], ay: [0, bb[3] - bb[1]], blend: o.blend, opacity: o.opacity ?? 1 }), gl = this.gl;
    gl.uniform1i(u.uKind, K); gl.uniform3fv(u.uInk, ink(o.ink || 'red'));
    gl.uniform1f(u.uRough, o.rough ?? 2.5); gl.uniform1f(u.uDens, o.density ?? 0.85);
    if (K === 0) { gl.uniform4f(u.uA, x, y, (o.angle ?? -32) * Math.PI / 180, o.w ?? 300); gl.uniform4f(u.uB, (o.len ?? 4000) / 2, 0, 0, 0); }
    else if (K === 1) gl.uniform4f(u.uA, x, y, o.r ?? 300, 0);
    else if (K === 2) gl.uniform4f(u.uA, x, y, o.r ?? 300, o.w ?? 40);
    else if (K === 3) { const p = new Float32Array(16); o.pts.slice(0, 8).forEach((q, i) => { p[i * 2] = q[0]; p[i * 2 + 1] = q[1]; }); gl.uniform2fv(u.uPts, p); gl.uniform1i(u.uNp, Math.min(8, o.pts.length)); }
    else { gl.uniform4f(u.uA, x, y, o.w ?? 400, o.h ?? 200); gl.uniform4f(u.uB, (o.angle ?? 0) * Math.PI / 180, 0, 0, 0); }
    this._draw();
    return this;
  }

  // wall(img, o): a full-frame surface from a tileable photo texture under raking light; o.poster pastes a canvas
  // (e.g. another Montage's canvas) onto it: {poster, x, y, h, rot, conform 0-1, tear 0-0.4, wet}. tile: texture px.
  wall(img, o = {}) {
    if (Array.isArray(o.posters)) {                 // several posters: the wall once, then each poster only where it is
      this.wall(img, { ...o, posters: null, poster: null });
      o.posters.forEach(p => this.wall(img, { ...o, ...p, posters: null, onlyPoster: true }));
      return this;
    }
    const S = this.source(img, { alpha: false }), gl = this.gl;
    const u = this._use(this.P.wall); gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, S.tex); gl.uniform1i(u.uWall, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.uniform3fv(u.uTint, hex(o.tint || '#b9aea0')); gl.uniform2f(u.uLight, ...(o.light || [-0.8, -0.5])); gl.uniform1f(u.uTile, o.tile ?? 1024);
    gl.uniform1f(u.uBump, o.bump ?? 6); gl.uniform1f(u.uGrime, o.grime ?? 0.6); gl.uniform2f(u.uRes2, this.W, this.H);
    if (o.poster) {
      const P = this.source(o.poster, { alpha: false, dynamic: o.dynamic ?? null });
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, P.tex); gl.uniform1i(u.uPoster, 2);
      const h = o.h ?? this.H * 0.7, w = h * P.w / P.h, r = o.rot || 0, c = Math.cos(r), s2 = Math.sin(r);
      const ax = [c * w, s2 * w], ay = [-s2 * h, c * h], x = o.x ?? this.W / 2, y = o.y ?? this.H / 2;
      gl.uniform2f(u.uPO, x - ax[0] / 2 - ay[0] / 2, y - ax[1] / 2 - ay[1] / 2); gl.uniform2f(u.uPAx, ...ax); gl.uniform2f(u.uPAy, ...ay);
      gl.uniform1f(u.uHasP, 1); gl.uniform1f(u.uOnlyP, o.onlyPoster ? 1 : 0); gl.uniform1f(u.uConform, o.conform ?? 0.8); gl.uniform1f(u.uTear, o.tear ?? 0.12); gl.uniform1f(u.uWet, o.wet ?? 0.6);
    } else gl.uniform1f(u.uHasP, 0);
    this._draw();
    return this;
  }

  ink(canvas, o = {}) {
    const S = this.source(canvas, { dynamic: o.dynamic ?? true, alpha: true });
    if (!S.bb) S.bb = o.rect || alphaBox(canvas);
    const bb = o.dynamic === false ? S.bb : (o.rect || [0, 0, this.W, this.H]), m = o.misreg || [0, 0];
    const b = [Math.max(0, bb[0] + m[0] - 4), Math.max(0, bb[1] + m[1] - 4), Math.min(this.W, bb[2] + m[0] + 4), Math.min(this.H, bb[3] + m[1] + 4)];
    if (b[2] <= b[0] || b[3] <= b[1]) return this;
    const u = this._use(this.P.ink, { ox: b[0], oy: b[1], ax: [b[2] - b[0], 0], ay: [0, b[3] - b[1]], blend: o.blend, opacity: o.opacity ?? 1 }), gl = this.gl;
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, S.tex); gl.uniform1i(u.uImg, 1);
    gl.uniform3fv(u.uInk, ink(o.ink || 'black')); gl.uniform2f(u.uMis, ...(o.misreg || [0, 0])); gl.uniform2f(u.uRes2, this.W, this.H);
    gl.uniform1f(u.uSpread, o.spread ?? 0);
    this._draw();
    return this;
  }

  end(ctx = null, { age = 0.4, tooth = 1, creases = [] } = {}) {
    const gl = this.gl;
    const tex = this._bake('fin' + JSON.stringify([age, tooth, creases]), () => {
      const u = this._use(this.P.fin); gl.disable(gl.BLEND);
      gl.uniform1f(u.uAge, age); gl.uniform1f(u.uTooth, tooth); gl.uniform2f(u.uRes2, this.W, this.H);
      const cr = new Float32Array(16); creases.slice(0, 4).forEach((c, i) => cr.set(c, i * 4)); gl.uniform4fv(u.uCr, cr); gl.uniform1i(u.uNcr, Math.min(4, creases.length));
      this._draw();
    });
    gl.viewport(0, 0, this.W, this.H);
    this._blitTex(tex, 'multiply');
    if (this.profile) { gl.finish(); this.stats.gpu = performance.now() - this.t0; }
    const t1 = performance.now();
    if (ctx) ctx.drawImage(this.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
    if (this.profile) { ctx && ctx.getImageData(0, 0, 1, 1); this.stats.blit = performance.now() - t1; }
    this.stats.ms = performance.now() - this.t0;
    return this;
  }
}
