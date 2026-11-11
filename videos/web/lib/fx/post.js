// POST: a WebGL2 post-processing chain that wraps any 2D canvas (or a three.js canvas).
//
//   import { Post, preset, mixPresets } from '../lib/fx/post.js';
//   const post = new Post(1080, 1920, { direct: true });          // direct: post.canvas becomes #out (no blit)
//   post.apply({ world, type }, t, preset('mythic', { kick }));    // type: a clean canvas composited after the damage
//   post.sync();                                                  // settle inside renderFrame
//
// Stages (each off unless its option is present and non-zero):
//   upload -> [pixel sort] -> [glitch / datamosh feedback] -> bright prefilter (glowScale res) -> dual-kawase bloom,
//   halation, anamorphic streaks -> composite (lens + chromatic aberration, glows, exposure, ONE baked 3D grade LUT
//   holding tonemap / shoulder / grade / split tone / user LUT / fade, vignette) -> finish (grain, dust, ordered
//   dither / halftone / riso / line screen, CRT) -> type layer (shadow, glow, fringe, grain; never torn) -> output.
//   With no dither and no CRT, finish is fused into the composite (one full-res pass fewer).
//   Cost knobs: glowScale (glows at 1/4 by default), compScale (0.5 = world composite at half res, type + grain
//   stay full res; about -35% on light looks), and the type variant of the last pass is scissored to the type.
//
// Determinism: everything is a pure function of (source, t, opts) except the datamosh feedback (glitch.mosh /
// glitch.smear), which reads the previous frame of the same `slot`. Use post.applyStateful() for those: it
// anchors I-frames and pre-rolls, so stills and out-of-order frames match a sequential render exactly.

// Textures are uploaded top-down (no UNPACK_FLIP_Y, premultiplied: the 1 ms fast path for a 2D canvas instead of
// 80-250 ms), so every pass works in top-down space (v.y = 0 is the top) and only the pass that writes the canvas
// flips, with VS_OUT.
const VS = `#version 300 es
out vec2 v;
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); v = p; gl_Position = vec4(p * 2. - 1., 0., 1.); }`;
const VS_OUT = `#version 300 es
out vec2 v;
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); v = p; gl_Position = vec4(p.x * 2. - 1., 1. - p.y * 2., 0., 1.); }`;

const HEAD = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 v; out vec4 o;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
float luma(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
`;

// shared by every pass that can be the last one: grain / dust and the protected type layer
const FINAL = `uniform vec2 res; uniform float frame, aspect, unit, gframe;
uniform float grain, grainSize, grainChroma, dust, scratch; uniform sampler2D NZ;
float fk;
// gframe: the grain's own clock (frame / grain.hold, see _render), so grain can boil on twos while dust and the
// rest run on every frame
// grain = one bilinear tap of a 256^2 random texture (value noise); a texture tap is the unit of cost on SwiftShader
vec3 grainy(vec3 c, vec2 px){
#ifdef GRAIN
  { vec2 g = px / grainSize + gframe * vec2(37.1, 91.7);
    vec4 na = texture(NZ, g * (1. / 256.));
    float m = (na.r - .5) * 1.25;
    vec3 n = vec3(m);
#ifdef CHROMA
    n = mix(n, (na.gra - .5) * 1.25, grainChroma);
#endif
    float l = luma(c);
    c += n * grain * (.35 + 1.3 * l * (1. - l)) * 1.6; }
#endif
#ifdef DUST
  { vec2 cell = floor(px / (60. * unit)); vec2 f = px / (60. * unit) - cell;
    float r = h12(cell + fk * 13.1);
    if (r < dust * .06) { vec2 pp = h22(cell + fk); float d = length((f - pp) * vec2(1., .6 + r * 3.)); c = mix(c, vec3(r < dust * .02 ? .95 : .02), smoothstep(.09 * (.4 + r * 8.), .02, d)); }
    for (int k = 0; k < 3; k++) {
      float x = h12(vec2(fk * .37 + float(k) * 3.1, 11.)) * res.x;
      if (h12(vec2(fk, float(k) + 5.)) < scratch) {
        float w = (1. + 2. * h12(vec2(k, fk))) * unit; float d = abs(px.x - x - sin(px.y * .003 / unit + fk) * 6. * unit);
        c = mix(c, vec3(.9, .88, .8), .5 * smoothstep(w, 0., d) * vn(vec2(px.y * .01 / unit, fk)));
      }
    } }
#endif
  return c;
}
#ifdef TYPE
// type layer (premultiplied): shadow + glow from one tap of its blur texture (r = 1/16 blur, g = 1/32 blur),
// fringe, grain. No tear, sort or mosh. Pixels with no type within ~40 px skip the full-res fetch.
uniform sampler2D OV, OVB; uniform float tyGrain, tyGlow, tyShadow, tyCa; uniform vec3 tyTint, tyFringe;
vec4 tyAt(vec2 uv){ return texelFetch(OV, clamp(ivec2(uv * res), ivec2(0), ivec2(res) - 1), 0); }
vec3 typeOver(vec3 c, vec2 uv){
  vec2 bl = texture(OVB, uv).rg;
  if (bl.g <= 0.) return c;
  if (tyShadow > 0.) c *= 1. - tyShadow * min(bl.r * 1.7, 1.);
  if (tyGlow > 0.) { float g = bl.g * .65 + bl.r * .35;
    c = 1. - (1. - c) * (1. - clamp(tyTint * g * tyGlow, 0., 1.)); }
  vec4 ty = tyAt(uv);
  if (ty.a <= 0. && tyCa <= 0.) return c;
  if (tyCa > 0.) { vec2 d = vec2(tyCa / res.x, tyCa * .35 / res.y);
    float ar = tyAt(uv + d).a, ab = tyAt(uv - d).a;
    c = mix(c, tyFringe, clamp(ar - ty.a, 0., 1.) * .9);
    c = mix(c, vec3(.02, .01, .015), clamp(ab - ty.a, 0., 1.) * .7); }
  vec3 tc = ty.rgb;
  if (tyGrain > 0.) { vec2 g = gl_FragCoord.xy / (2. * unit) + gframe * vec2(37.1, 91.7);
    tc += (texture(NZ, g * (1. / 256.)).r - .5) * 1.25 * tyGrain * .16 * ty.a; }
  return c * (1. - ty.a) + tc;
}
#endif
`;

// ------------------------------------------------------------------ shaders
const FS_COPY = HEAD + `uniform sampler2D S; void main(){ o = texture(S, v); }`;

// odd-even transposition step of a masked pixel sort (key = luma); spans = runs of pixels inside [lo, hi]
const FS_SORT = HEAD + `uniform sampler2D S; uniform float parity, lo, hi, dir, bands, bandW, seed; uniform int axis;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy), sz = textureSize(S, 0);
  vec4 a = texelFetch(S, p, 0);
  float band = floor(float(axis == 0 ? p.x : p.y) / bandW);
  if (h12(vec2(band, seed)) > bands) { o = a; return; }
  int i = axis == 0 ? p.y : p.x;
  bool first = ((i + int(parity)) & 1) == 0;
  ivec2 q = p + (axis == 0 ? ivec2(0, first ? 1 : -1) : ivec2(first ? 1 : -1, 0));
  if (q.x < 0 || q.y < 0 || q.x >= sz.x || q.y >= sz.y) { o = a; return; }
  vec4 b = texelFetch(S, q, 0);
  float la = luma(a.rgb), lb = luma(b.rgb);
  if (la < lo || la > hi || lb < lo || lb > hi) { o = a; return; }
  bool sw = first ? (la * dir > lb * dir) : (lb * dir > la * dir);
  o = sw ? b : a;
}`;

// glitch stage: row tears, block displacement / channel split / posterize, datamosh feedback, and the pixel sort
// (pre-merged at sort res: rgb = sorted, a = where the sort moved anything). Cost is counted in full-res taps:
// src() is 2 taps with a sort (1 without), each block takes at most ONE extra src() (displacement or the red
// channel of the split, whichever the block is), and the feedback path adds P + 2 gradient taps + 1 noise tap.
const FS_STAGE = HEAD + `uniform sampler2D S, P, SORTM, NZ;
uniform float seed, amount, tear, mosh, smear, flow, rgb; uniform vec2 res, grid;
vec3 src(vec2 uv){
  vec3 c = texture(S, uv).rgb;
#ifdef USESORT
  { vec4 m = texture(SORTM, uv); c = mix(c, m.rgb, m.a); }
#endif
  return c; }
void main(){
  vec2 uv = v;
  float row = floor(uv.y * 90.), rr = h12(vec2(row, seed));
  if (rr < tear) uv.x += (h12(vec2(row, seed + 7.)) - .5) * .18 * (.4 + tear);
  vec3 c = src(uv);
  bool moshed = false; vec2 mv = vec2(0);
  int mode = 0; vec2 off = vec2(0); bool post3 = false;         // the later (finer) grid wins the block type
  for (int k = 0; k < 2; k++) {
    vec2 g = grid * (k == 0 ? 1. : 3.1);
    vec2 id = floor(uv * g);
    float r = h12(id + seed * 1.37 + float(k) * 17.);
    if (r < amount * (k == 0 ? .5 : .9)) {
      float ty = h12(id + seed + 3.3);
      vec2 j = h22(id + seed * .71) - .5;
      if (ty < .35) { mode = 1; off = j * vec2(.22, .03); }
      else if (ty < .55) { mode = 2; off = vec2(rgb * 1.6, 0); }
      else if (ty < .7) post3 = true;
      else { moshed = true; mv = j * vec2(.05, .09); }
    }
  }
  if (mode != 0) { vec3 d = src(uv + off);
    c = mode == 1 ? d : vec3(d.r, c.g, c.b * .85 + c.g * .15) * vec3(1.15, .9, 1.1); }
  if (post3) c = floor(c * 3.99) / 3. * vec3(1.1, .85, .85);
#ifdef USEP
  {
    // fake motion vectors from the current frame's luma gradient (forward differences, 2 taps) + low-frequency
    // noise (one tap of the noise texture) drag the previous frame
    vec2 e = 3. / res; float l0 = luma(c);
    float gx = luma(texture(S, uv + vec2(e.x, 0)).rgb) - l0;
    float gy = luma(texture(S, uv + vec2(0, e.y)).rgb) - l0;
    vec2 f = vec2(gx, gy) * 2. * flow + (texture(NZ, uv * (6. / 256.) + fract(seed * .013)).rg - .5) * flow * .08;
    float m = smear;
    vec3 prev = texture(P, uv - f - (moshed ? mv * .25 : vec2(0))).rgb;
    if (moshed) m = max(m, mosh);
    float bright = smoothstep(.1, .6, length(c - prev)) * (1. - m) ;
    c = mix(c, prev, clamp(m - bright * .3, 0., 1.));
  }
#endif
  o = vec4(c, 1);
}`;

// sort merge at sort res: the sorted colour and where it differs from the unsorted copy
const FS_SORTMIX = HEAD + `uniform sampler2D SORT, DOWN;
void main(){ vec3 s = texture(SORT, v).rgb, d = texture(DOWN, v).rgb; o = vec4(s, smoothstep(.015, .06, length(s - d))); }`;

// prefilter: 4 bilinear taps spread over the full-res -> glowScale footprint, soft-knee threshold
const FS_PREFILTER = HEAD + `uniform sampler2D S; uniform vec2 ts; uniform float thr, knee;
vec3 L(vec2 uv){ vec3 c = texture(S, uv).rgb; return c * c; }
void main(){
  vec3 c = (L(v + ts * vec2(-1, -1)) + L(v + ts * vec2(1, -1)) + L(v + ts * vec2(-1, 1)) + L(v + ts * vec2(1, 1))) * .25;
  float br = max(c.r, max(c.g, c.b));
  float s = clamp(br - thr + knee, 0., 2. * knee); s = s * s / (4. * knee + 1e-4);
  o = vec4(c * max(s, br - thr) / max(br, 1e-4), 1);
}`;

// 8x8 box of the type layer into 1/8 res (16 bilinear taps, each a 2x2 average)
const FS_BOX8 = HEAD + `uniform sampler2D S; uniform vec2 ts;
void main(){ vec4 a = vec4(0); for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) a += texture(S, v + ts * vec2(float(i) * 2. - 3., float(j) * 2. - 3.)); o = a / 16.; }`;

const FS_TYPACK = HEAD + `uniform sampler2D A, B; void main(){ o = vec4(texture(A, v).a, texture(B, v).a, 0, 1); }`;

const FS_KDOWN = HEAD + `uniform sampler2D S; uniform vec2 ts;
void main(){ o = (texture(S, v) * 4. + texture(S, v - ts) + texture(S, v + ts) + texture(S, v + vec2(ts.x, -ts.y)) + texture(S, v - vec2(ts.x, -ts.y))) / 8.; }`;

const FS_KUP = HEAD + `uniform sampler2D S, A; uniform vec2 ts; uniform float wA;
void main(){
  vec4 s = texture(S, v + vec2(-ts.x * 2., 0)) + texture(S, v + vec2(ts.x * 2., 0)) + texture(S, v + vec2(0, ts.y * 2.)) + texture(S, v + vec2(0, -ts.y * 2.))
    + (texture(S, v + vec2(-ts.x, ts.y)) + texture(S, v + ts) + texture(S, v + vec2(ts.x, -ts.y)) + texture(S, v - ts)) * 2.;
  o = s / 12. + texture(A, v) * wA;
}`;

const FS_SDOWN = HEAD + `uniform sampler2D S; uniform vec2 ts; uniform float vt;
void main(){
  vec4 a = vec4(0);
  for (int j = -1; j <= 1; j++) { vec2 u = v + vec2(0, float(j) * ts.y * vt);
    a += texture(S, u + vec2(-1.5 * ts.x, 0)) + texture(S, u + vec2(-.5 * ts.x, 0)) * 3. + texture(S, u + vec2(.5 * ts.x, 0)) * 3. + texture(S, u + vec2(1.5 * ts.x, 0)); }
  o = a / 24.;
}`;
const FS_SUP = HEAD + `uniform sampler2D S, A; uniform vec2 ts; uniform float stretch;
void main(){
  vec4 lo = (texture(S, v - vec2(ts.x, 0)) + texture(S, v) * 2. + texture(S, v + vec2(ts.x, 0))) * .25;
  o = mix(texture(A, v), lo, stretch);
}`;

// all glows folded into one glowScale texture (rgb = bloom + streaks, a = halation energy) so the
// full-res composite pays one tap for them
const FS_GLOW = HEAD + `uniform sampler2D BL, ST, HL; uniform float bloomAmt, streakAmt, halAmt; uniform vec3 bloomTint, streakTint;
void main(){
  vec3 g = vec3(0); float h = 0.;
#ifdef BLOOM
  g += texture(BL, v).rgb * bloomAmt * bloomTint;
#endif
#ifdef STREAK
  g += texture(ST, v).rgb * streakAmt * streakTint;
#endif
#ifdef HAL
  h = luma(texture(HL, v).rgb) * halAmt;
#endif
  o = vec4(g, h);
}`;

// The grade LUT's input encoding (STUDIO FINISH c1, 1 Oct). Display-linear on [0, 1] (e = 0.75 * sqrt(c), and
// c = display^2 in this chain), so white lands EXACTLY on lattice point 24 of 33 and an identity grade is exact
// (trilinear interpolation of a linear function); overbright glow / exposure (c > 1) is folded into the top 8
// cells for the tonemap and the shoulder. The old encoding, sqrt(c / (1 + c)), used ~23 points for SDR and put
// white between two of them, so any grade at all turned 255 into 250 and compressed the near-whites.
const ENC = `const float EW = .75;
vec3 encG(vec3 c){ return mix(EW * sqrt(c), EW + (1. - EW) * (1. - 1. / max(c, vec3(1))), step(vec3(1), c)); }
vec3 decG(vec3 e){ vec3 l = e / EW; return mix(l * l, 1. / max(1. - (e - EW) / (1. - EW), vec3(1e-3)), step(vec3(EW), e)); }
`;

// The whole per-pixel colour pipeline after exposure, baked into one 33^3 LUT (layer by layer) whenever the
// grade options change (encoding above; RGBA8, or half float with { lutHalf: true }).
// Tonemap (Narkowicz's ACES fit) is OFF unless a scene asks for it (film.tonemap): it is a curve for scene-linear
// HDR renders, and on our finished, display-referred pictures it only greyed white to 229, lifted mid-grey 128 to
// 157 and crushed the shadows (critic, studio_finish_c1/before). Before 1 Oct any film key switched it on.
const FS_BAKE = HEAD + ENC + `uniform sampler3D LUT; uniform float N, layer;
uniform float tonemap, shoulder, contrast, fade, crush, sat, temp, mono;
uniform vec3 toneS, toneH, monoTint; uniform float toneAmt, toneBal, lutAmt, lutN;
vec3 aces(vec3 x){ return clamp(x * (2.51 * x + .03) / (x * (2.43 * x + .59) + .14), 0., 1.); }
vec3 soft(vec3 a, vec3 b){ return mix(2. * a * b + a * a * (1. - 2. * b), 2. * a * (1. - b) + sqrt(a) * (2. * b - 1.), step(.5, b)); }
void main(){
  vec3 e = min(vec3(floor(gl_FragCoord.xy), layer) / (N - 1.), vec3(.995));
  vec3 c = decG(e);
  c = sqrt(max(mix(c, aces(c), tonemap), 0.));
  // highlight rolloff. It reads the unclipped value, so overbright glow rolls toward the knee's ceiling instead of
  // clipping first (values <= 1 are exactly as before)
  if (shoulder > 0.) { float k = 1. - shoulder * .5; vec3 x = max(c - k, 0.) / (1. - k);
    c = min(c, vec3(k)) + (1. - k) * .92 * (1. - exp(-x * 1.15)); }
  else c = min(c, vec3(1));
  float l = luma(c);
  c = mix(c, monoTint * l / max(luma(monoTint), 1e-3), mono);
  c = c * vec3(1. + temp * .08, 1., 1. - temp * .08);
  c = clamp(c + contrast * (c * c * (3. - 2. * c) - c), 0., 1.);
  c = max(c - crush, 0.) / (1. - crush);
  l = luma(c);
  c = mix(vec3(l), c, sat);
  c = clamp(c, 0., 1.);
  if (toneAmt > 0.) { float l2 = luma(c);
    c = mix(c, soft(c, toneS), toneAmt * (1. - smoothstep(0., toneBal, l2)));
    c = mix(c, soft(c, toneH), toneAmt * smoothstep(toneBal, 1., l2)); }
  if (lutAmt > 0.) c = mix(c, texture(LUT, clamp(c, 0., 1.) * (lutN - 1.) / lutN + .5 / lutN).rgb, lutAmt);
  c = fade + c * (1. - fade);
  o = vec4(clamp(c, 0., 1.), 1);
}`;

const FS_COMP = HEAD + FINAL + ENC + `uniform sampler2D S, GL; uniform sampler3D GR;
uniform vec2 weave; uniform float distort, distort2, fitZoom, ca;
uniform vec3 halTint; uniform float expo, flicker, grN;
uniform float vigAmt, vigR0, vigR1; uniform vec3 vigCol;
vec3 lin(vec3 c){ return c * c; }
vec2 lens(vec2 uv){ vec2 p = uv * 2. - 1.; p.x *= aspect; float r2 = dot(p, p);
  p *= (1. + distort * r2 + distort2 * r2 * r2) / fitZoom; p.x /= aspect; return p * .5 + .5; }
vec3 spec(float t){ return clamp(vec3(t * 2. - .5, 1. - abs(t - .5) * 2.5, 1.5 - t * 2.), 0., 1.); }
#ifdef SHARP
// A warped (lens) or weaving frame is resampled with Catmull-Rom (5 bilinear taps, corners dropped) instead of one
// bilinear tap: bilinear at a fractional offset is a blur, and READY's standing lens (distort 0.02) lost about
// half the fine detail of a test chart to it (critic, studio_finish_c1/before, sheet B).
vec3 tapS(vec2 uv){ vec2 ts = vec2(textureSize(S, 0)), sp = uv * ts, t1 = floor(sp - .5) + .5, f = sp - t1;
  vec2 w0 = f * (-.5 + f * (1. - .5 * f)), w1 = 1. + f * f * (-2.5 + 1.5 * f), w2 = f * (.5 + f * (2. - 1.5 * f)), w3 = f * f * (-.5 + .5 * f);
  vec2 w12 = w1 + w2, t0 = (t1 - 1.) / ts, t3 = (t1 + 2.) / ts, t12 = (t1 + w2 / w12) / ts;
  float a = w12.x * w0.y, b = w0.x * w12.y, m = w12.x * w12.y, d = w3.x * w12.y, e = w12.x * w3.y;
  vec3 r = texture(S, vec2(t12.x, t0.y)).rgb * a + texture(S, vec2(t0.x, t12.y)).rgb * b + texture(S, t12).rgb * m
    + texture(S, vec2(t3.x, t12.y)).rgb * d + texture(S, vec2(t12.x, t3.y)).rgb * e;
  return clamp(r / (a + b + m + d + e), 0., 1.); }
#else
vec3 tapS(vec2 uv){ return texture(S, uv).rgb; }
#endif
void main(){
  fk = mod(frame, 997.);
#ifdef LENS
  vec2 uv = lens(v) + weave;
#else
  vec2 uv = v + weave;
#endif
#if CA == 2
  vec3 acc = vec3(0), ws = vec3(0);
  for (int i = 0; i < 5; i++) { float t = (float(i) + .5) / 5.; vec3 w = spec(t);
    acc += w * lin(texture(S, .5 + (uv - .5) * (1. + ca * (t - .5) * 2.)).rgb); ws += w; }
  vec3 c = acc / ws;
#elif CA == 1
  // the red record split from green + blue (the house red / cyan fringe), the same split as before 1 Oct. Green and
  // blue (most of the luma) are read in place and red moves by WHOLE pixels: no resampling blur on any channel,
  // and wherever the split is under half a pixel (the middle of the frame for a standing ca) nothing moves.
  // Before, both taps sat at fractional positions, so a standing ca 0.002 blurred the whole frame.
  vec3 cc = tapS(uv);
  vec3 c = lin(vec3(texture(S, uv + floor((uv - .5) * ca * 1.5 * res + .5) / res).r, cc.g, cc.b));
#else
  vec3 c = lin(tapS(uv));
#endif
#ifdef GLOW
  { vec4 g = texture(GL, uv); c += g.rgb + halTint * g.a * (1. - .75 * smoothstep(.05, .8, luma(c))); }
#endif
  c *= exp2(expo) * flicker;
#ifdef GRADE
  c = max(c, 0.);
  c = texture(GR, encG(c) * ((grN - 1.) / grN) + .5 / grN).rgb;
#else
  c = sqrt(clamp(c, 0., 1.));
#endif
#ifdef VIG
  vec2 q = (v - .5) * vec2(aspect, 1.);
  c = mix(c, vigCol, vigAmt * smoothstep(vigR0, vigR1, length(q)));
#endif
  c = clamp(c, 0., 1.);
#ifdef FUSED
  c = grainy(c, v * res);
#endif
#ifdef TYPE
  c = typeOver(clamp(c, 0., 1.), v);
#endif
  o = vec4(clamp(c, 0., 1.), 1);
}`;

const FS_FINISH = HEAD + FINAL + `uniform sampler2D S;
uniform float dscale, dangle, dlevels, dmis, dspread, damt; uniform vec3 pal[6]; uniform int npal; uniform vec3 paper, inkA, inkB;
uniform float crtCurve, scan, mask, roll, tracking;
float bayer(vec2 p){ ivec2 i = ivec2(mod(p, 8.)); int x = i.x, xy = i.x ^ i.y;
  int b = ((xy & 1) << 5) | ((x & 1) << 4) | ((xy & 2) << 2) | ((x & 2) << 1) | ((xy & 4) >> 1) | ((x & 4) >> 2);
  return (float(b) + .5) / 64.; }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec3 tap(vec2 px){ return texture(S, clamp(px / res, 0., 1.)).rgb; }
float dot1(vec2 px, float ang, float cov, float s){
  vec2 q = rot(ang) * px / s; vec2 f = fract(q) - .5;
  float rad = sqrt(clamp(cov, 0., 1.)) * .7071, d = length(f), aa = .75 / s;
  return 1. - smoothstep(rad - aa, rad + aa, d); }
vec3 cell(vec2 px, float ang, float s){ vec2 q = rot(ang) * px / s; return tap(rot(-ang) * ((floor(q) + .5) * s)); }
float cmyk(vec3 c, int ch){ float k = 1. - max(c.r, max(c.g, c.b)); if (ch == 3) return k;
  return (1. - (ch == 0 ? c.r : ch == 1 ? c.g : c.b) - k) / max(1. - k, 1e-3); }
float redness(vec3 c){ return clamp((c.r - max(c.g, c.b)) * 1.5, 0., 1.); }
vec3 inkmul(vec3 base, vec3 ink, float a){ return base * mix(vec3(1), ink, a); }
void main(){
  vec2 uv = v; float edge = 1.;
  fk = mod(frame, 997.);
#ifdef CRT
  { vec2 p = uv * 2. - 1.; p *= 1. + crtCurve * vec2(p.y * p.y, p.x * p.x) * vec2(1., aspect * .5);
    p /= 1. + crtCurve * .3; uv = p * .5 + .5;
    vec2 e = smoothstep(vec2(0), vec2(.012, .007), uv) * smoothstep(vec2(0), vec2(.012, .007), 1. - uv); edge = mix(1., e.x * e.y, min(crtCurve * 8., 1.));
    float ln = floor(uv.y * res.y / (3. * unit));
    uv.x += (h12(vec2(ln, fk)) - .5) * tracking / res.x * 8. * unit * step(.93, h12(vec2(floor(ln / 20.), floor(fk / 3.)))); }
#endif
  vec2 px = uv * res;
  vec3 c;
#if DMODE == 1
  { vec2 ce = floor(px / dscale); vec3 s = grainy(tap((ce + .5) * dscale), ce * dscale);
    vec3 q = s + (bayer(ce) - .5) * dspread;            // ordered offset, then nearest palette colour (keeps hue)
    float best = 1e9; c = pal[0];
    for (int k = 0; k < 6; k++) { if (k >= npal) break; vec3 d = q - pal[k]; float e = dot(d * d, vec3(.35, .45, .2));
      if (e < best) { best = e; c = pal[k]; } } }
#elif DMODE == 2
  { vec2 ce = floor(px / dscale); vec3 s = grainy(tap((ce + .5) * dscale), ce * dscale);
    c = floor(s * (dlevels - 1.) + bayer(ce)) / (dlevels - 1.); }
#elif DMODE == 3
  { vec3 base = paper;
    vec3 c0 = cell(px, .2618, dscale), c1 = cell(px + vec2(dmis, 0), 1.309, dscale), c2 = cell(px, 0., dscale), c3 = cell(px, .7854, dscale);
    base = inkmul(base, vec3(0., .62, .88), dot1(px, .2618, cmyk(c0, 0), dscale));
    base = inkmul(base, vec3(.9, .05, .45), dot1(px + vec2(dmis, 0), 1.309, cmyk(c1, 1), dscale));
    base = inkmul(base, vec3(1., .92, .05), dot1(px, 0., cmyk(c2, 2), dscale));
    c = grainy(inkmul(base, vec3(.08), dot1(px, .7854, cmyk(c3, 3), dscale)), px); }
#elif DMODE == 4
  { vec3 base = paper * (.93 + .07 * vn(px * .02 / unit)) * (.97 + .03 * vn(px * .6 / unit));
    vec2 pa = px + vec2(dmis, dmis * .6);
    vec3 ca = cell(pa, dangle, dscale), cb = cell(px, dangle + .5236, dscale);
    float ra = redness(ca), la = luma(ca);
    float covA = clamp(ra * .95 + smoothstep(.15, .7, 1. - la) * .25 * (1. - ra), 0., 1.);
    float lb = luma(cb), rb = redness(cb);
    float covB = smoothstep(.4, .95, 1. - lb) * (1. - rb * .7);
    base = inkmul(base, inkA, dot1(pa, dangle, covA, dscale) * (.9 + .1 * vn(px * .05 / unit)));
    c = grainy(inkmul(base, inkB, dot1(px, dangle + .5236, covB, dscale) * .95), px); }
#elif DMODE == 5
  { vec2 q = rot(dangle) * px / dscale; vec3 s = tap(px); float cov = clamp(1. - luma(grainy(s, px)), 0., 1.);
    float d = abs(fract(q.y + vn(px * .01 / unit) * .3) - .5) * 2.;
    float aa = 1.5 / dscale; float ink = 1. - smoothstep(cov - aa, cov + aa, d);
    c = mix(paper, mix(inkB, inkA, clamp((s.r - max(s.g, s.b)) * 2., 0., 1.)), ink); }
#else
  c = grainy(tap(px), px);
#endif
#ifdef DMIX
  c = mix(grainy(tap(px), px), c, damt);                  // dither.amount < 1: the print dissolves in / out
#endif
#ifdef CRT
  { float sl = .5 + .5 * cos(uv.y * res.y / (4. * unit) * 6.2832);
    c *= mix(1., .55 + .45 * sl, scan);
    float m = mod(gl_FragCoord.x / max(unit, .34), 3.);
    vec3 msk = m < 1. ? vec3(1., .7, .7) : m < 2. ? vec3(.7, 1., .7) : vec3(.7, .7, 1.);
    c *= mix(vec3(1), msk * 1.25, mask);
    c *= 1. + roll * .18 * smoothstep(.12, 0., abs(fract(uv.y - frame * .004) - .5));
    c *= edge; }
#endif
#ifdef TYPE
  c = typeOver(clamp(c, 0., 1.), v);
#endif
  o = vec4(clamp(c, 0., 1.), 1);
}`;

// Transitions between two finished looks: mix | knife | bars | iris | burn | mask. d = signed distance to the
// edge (B side positive); the seam is measured in pixels through fwidth, so it has the same width in every mode.
const WMODES = { mix: 0, knife: 1, bars: 2, iris: 3, burn: 4, mask: 5 };
const FS_WIPE = HEAD + FINAL + `uniform sampler2D A, B, MASK; uniform float u, angle, soft, seam, glow, seed, bars, maskLuma, maxR;
uniform vec2 center; uniform vec3 seamCol, glowCol;
void main(){
  fk = mod(frame, 997.);
  vec3 a = texture(A, v).rgb, b = texture(B, v).rgb;
  vec2 p = (v - .5) * vec2(aspect, 1.);
  float d;
#if WMODE == 0
  float k = u;
#else
#if WMODE == 1
  { vec2 n = vec2(cos(angle), sin(angle)); float ext = abs(n.x) * aspect * .5 + abs(n.y) * .5 + soft + .02;
    d = dot(p, n) - mix(ext, -ext, u); }
#elif WMODE == 2
  { vec2 n = vec2(cos(angle), sin(angle)), m = vec2(-n.y, n.x);
    float y = dot(p, m), i = floor((y + 1.) * bars), r = h12(vec2(i, seed + 3.));
    float lu = clamp((u - r * .45) / .55, 0., 1.);
    float ext = abs(n.x) * aspect * .5 + abs(n.y) * .5 + soft + .02;
    float x = dot(p, n) * (mod(i, 2.) < 1. ? 1. : -1.);
    d = x - mix(ext, -ext, lu * lu * (3. - 2. * lu)); }
#elif WMODE == 3
  { vec2 c0 = (center - .5) * vec2(aspect, 1.); d = mix(-soft - .01, maxR + soft, u) - length(p - c0); }
#elif WMODE == 4
  { float nz = vn(p * 3.1 + seed) * .55 + vn(p * 9.7 - seed) * .3 + vn(p * 31.) * .15;
    d = (mix(-.08, 1.08, u) - nz) * .25; }
#elif WMODE == 5
  { vec4 mk = texture(MASK, v); float m = mix(mk.a, luma(mk.rgb) * mk.a, maskLuma);
    d = (m - mix(1. + soft, -soft, u)) * .25; }
#endif
  float k = smoothstep(-soft, soft, d);
#endif
  vec3 c = mix(a, b, k);
#if WMODE != 0
  float dp = abs(d) / max(fwidth(d), 1e-6);
  if (seam > 0.) c = mix(c, seamCol, 1. - smoothstep(seam * .5, seam * .5 + 1.5, dp));
  if (glow > 0.) c = 1. - (1. - c) * (1. - clamp(glowCol * glow * exp(-dp / (22. * unit)), 0., 1.));
#endif
  c = clamp(c, 0., 1.);
#ifdef TYPE
  c = typeOver(c, v);
#endif
  o = vec4(c, 1);
}`;

// ------------------------------------------------------------------ LUTs
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const mixv = (a, b, x) => a.map((v, i) => v + (b[i] - v) * x);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const cl = x => Math.min(1, Math.max(0, x));
function gradientMap(stops) {                         // [[pos, '#hex'], ...] on luma
  const s = stops.map(([p, h]) => [p, hex(h)]);
  return (r, g, b) => { const l = lum(r, g, b); let i = 0; while (i < s.length - 2 && l > s[i + 1][0]) i++;
    return mixv(s[i][1], s[i + 1][1], cl((l - s[i][0]) / (s[i + 1][0] - s[i][0]))); };
}
const RED_ = hex('#c91f37'), CREAM_ = hex('#f4e6d0');
export const LUTS = {
  identity: (r, g, b) => [r, g, b],
  // ACP gradient map: black -> blood -> poster red -> ember -> cream
  redcream: gradientMap([[0, '#050203'], [0.22, '#3a0509'], [0.45, '#bd1818'], [0.7, '#e2553c'], [1, '#f4e6d0']]),
  // selective colour: keep the reds, everything else to cold steel
  redkeep: (r, g, b) => { const l = lum(r, g, b), red = cl((r - Math.max(g, b)) * 2.2);
    const steel = [l * 0.92, l * 0.98, l * 1.06]; return mixv(steel, [cl(r * 1.1), g * 0.85, b * 0.85], red); },
  // bleach bypass: silver retained, desaturated, hard
  bleach: (r, g, b) => { const l = lum(r, g, b); const ov = x => l < 0.5 ? 2 * x * l : 1 - 2 * (1 - x) * (1 - l);
    return mixv([r, g, b], [ov(r), ov(g), ov(b)], 0.7).map(x => cl(l + (x - l) * 0.45)); },
  // ACP false-colour infrared: the green record prints as poster red, hot red/yellow light as cream, blue as ink
  // black. Foliage / ice -> crimson, fire -> cream-hot, sky -> night. No purple anywhere.
  aerochrome: (r, g, b) => {
    const ir = cl(0.75 * g + 0.45 * r - 0.25 * b), hot = cl((r - 0.35) * 1.5) * cl(r + g - 0.6);
    const base = mixv([0.02, 0.01, 0.015], RED_, cl(ir * 1.35));
    return mixv(base, CREAM_, cl(hot * 0.9 + Math.max(0, ir - 0.8) * 2)).map(cl); },
  // warm print stock: teal shadows, amber highlights, reds pushed
  tealamber: (r, g, b) => { const l = lum(r, g, b); const sh = [-0.06, 0.02, 0.06], hi = [0.08, 0.03, -0.07];
    const w = l; return [cl(r * 1.05 + sh[0] * (1 - w) + hi[0] * w), cl(g + sh[1] * (1 - w) + hi[1] * w), cl(b * 0.95 + sh[2] * (1 - w) + hi[2] * w)]; },
  // gold: molten, not beige. Oxblood shadows, ember mids, gold highs that stop short of white.
  gold: gradientMap([[0, '#050202'], [0.18, '#2a0805'], [0.4, '#7a2a0a'], [0.62, '#c46a14'], [0.82, '#eab04a'], [1, '#f8dc96']]),
  // red phosphor: the state's screen in ACP red. Near-black -> poster red -> hot cream core
  phosphor: gradientMap([[0, '#030102'], [0.25, '#2c0408'], [0.5, '#9a1222'], [0.72, '#d8303f'], [0.9, '#f6a58c'], [1, '#f8ecd8']]),
};

// ------------------------------------------------------------------ the chain
const U = { F: 0x1406, V2: 0x8B50, V3: 0x8B51, V4: 0x8B52, I: 0x1404, B: 0x8B56, S2: 0x8B5E, S3: 0x8B5F };
const q3 = x => typeof x === 'number' ? Math.round(x * 1000) / 1000 : Array.isArray(x) ? x.map(q3) : x;

export class Post {
  // W, H: working size. Options:
  //   direct:    true -> post.canvas replaces the page's #out element, so render.mjs screenshots it directly
  //              (no ~200 ms blit back into a 2D canvas). Draw your 2D frame into any other canvas.
  //   glowScale: resolution of prefilter / bloom / halation / streaks: 0.5 (the old default), 0.25 (default), 0.125.
  //   hdr:       half-float glow buffers (about 2x the cost on SwiftShader). outSize: [w, h] atlas canvas.
  //   compScale: 1 (default) | 0.5: the world composite (lens, CA, glows, grade, vignette) runs at this scale and a
  //              full-res finish adds grain, print and type on top. ~35-45% off a light look; the world goes slightly
  //              softer, the type and grain stay at full res. Also per call as opts.compScale.
  constructor(W, H, { canvas = null, hdr = false, outSize = null, direct = false, glowScale = 0.25, compScale = 1, lutHalf = false } = {}) {
    this.W = W; this.H = H; this.lutHalf = lutHalf;
    this.canvas = canvas || document.createElement('canvas');
    this.canvas.width = outSize ? outSize[0] : W; this.canvas.height = outSize ? outSize[1] : H;
    if (direct) {                                                   // take over the render target
      const old = document.getElementById(typeof direct === 'string' ? direct : 'out');
      this.canvas.id = old.id; this.canvas.style.cssText = old.style.cssText; this.canvas.style.display = 'block';
      old.replaceWith(this.canvas);
    }
    const gl = this.gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('Post: no WebGL2');
    this.cbf = !!gl.getExtension('EXT_color_buffer_float');         // also lets the grade LUT bake in half float (lutHalf)
    this.f16 = hdr && this.cbf;
    gl.getExtension('OES_texture_float_linear');
    this.vao = gl.createVertexArray();
    this.FS = { copy: FS_COPY, sort: FS_SORT, stage: FS_STAGE, pre: FS_PREFILTER, kdown: FS_KDOWN, kup: FS_KUP,
      sdown: FS_SDOWN, sortmix: FS_SORTMIX, box8: FS_BOX8, typack: FS_TYPACK, sup: FS_SUP, glow: FS_GLOW, bake: FS_BAKE, comp: FS_COMP, finish: FS_FINISH, wipe: FS_WIPE };
    this.P = {};
    this.src = this._tex(W, H, false, false);
    this.stageT = this._tex(W, H, false);
    this.compT = null;                                              // allocated when finish is a separate pass
    this.glowScale = glowScale; this.compScale = compScale; this.chains = new Map();
    this.sortT = null; this.hist = new Map(); this.state = new Map();
    this.dummy2 = this._tex(1, 1, false);
    { const n = new Uint8Array(256 * 256 * 4); let x = 0x9e3779b9;                // deterministic grain noise
      for (let i = 0; i < n.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; n[i] = (x >>> 0) & 255; }
      this.noise = this._tex(256, 256, false, false);
      gl.bindTexture(gl.TEXTURE_2D, this.noise.t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, n);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT); }
    this.ov = null; this.maskT = null; this.wipeT = null; this._typeLive = false;
    this.luts = new Map(); this.grades = new Map();
    this.lut('identity');
    this.stats = {}; this.profile = false;
    this.unit = W / 1080;
  }

  // ---------------------------------------------------------------- GL plumbing
  _sh(type, src, name) {
    const gl = this.gl, s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Post shader ${name}: ${gl.getShaderInfoLog(s)}`);
    return s;
  }
  _prog(fs, name, vs = VS) {
    const gl = this.gl, p = gl.createProgram();
    gl.attachShader(p, this._sh(gl.VERTEX_SHADER, vs, name)); gl.attachShader(p, this._sh(gl.FRAGMENT_SHADER, fs, name));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Post link ${name}: ${gl.getProgramInfoLog(p)}`);
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); const k = a.name.replace(/\[0\]$/, ''); u[k] = { loc: gl.getUniformLocation(p, a.name), type: a.type, size: a.size }; }
    return { p, u };
  }
  _tex(w, h, float = true, fb = true, mips = 1) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, mips, float && this.f16 ? gl.RGBA16F : gl.RGBA8, w, h);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, mips > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    let f = null;
    if (fb) { f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); }
    return { t, fb: f, w, h };
  }
  // Each shader is specialised with #defines for the effects that are on, so disabled effects cost nothing
  // (SwiftShader pays for untaken uniform branches).
  // out: null / { vp } = the canvas (flipped to screen orientation), or a texture target { fb, w, h } (top-down).
  _run(name, out, uni, defs = []) {
    const toCanvas = !out || !out.fb;
    const key = name + '|' + defs.join(',') + (toCanvas ? '|out' : '');
    if (!this.P[key]) this.P[key] = this._prog(this.FS[name].replace('#version 300 es\n', '#version 300 es\n' + defs.map(d => `#define ${d.includes(' ') ? d : d + ' 1'}\n`).join('')), key, toCanvas ? VS_OUT : VS);
    const gl = this.gl, P = this.P[key];
    gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fb : null);
    if (out && out.vp) gl.viewport(...out.vp); else gl.viewport(0, 0, out ? out.w : this.W, out ? out.h : this.H);
    gl.useProgram(P.p); gl.bindVertexArray(this.vao);
    let unit = 0;
    for (const [k, u] of Object.entries(P.u)) {
      let val = uni[k];
      if (u.type === U.S2 || u.type === U.S3) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        if (u.type === U.S3) gl.bindTexture(gl.TEXTURE_3D, (val && val.t) || val || this.luts.get('identity').t);
        else gl.bindTexture(gl.TEXTURE_2D, (val && val.t) || val || (k === 'NZ' ? this.noise.t : this.dummy2.t));
        gl.uniform1i(u.loc, unit++); continue;
      }
      if (val === undefined) continue;
      if (typeof val === 'boolean') val = +val;
      switch (u.type) {
        case U.F: gl.uniform1f(u.loc, val); break;
        case U.V2: gl.uniform2fv(u.loc, val); break;
        case U.V3: gl.uniform3fv(u.loc, val.flat ? val.flat() : val); break;
        case U.V4: gl.uniform4fv(u.loc, val); break;
        case U.I: case U.B: gl.uniform1i(u.loc, val); break;
      }
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  sync() { const gl = this.gl, b = new Uint8Array(4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); }
  _tick(k) { if (!this.profile) return; this.sync(); const n = performance.now(); this.stats[k] = (this.stats[k] || 0) + (n - this._t); this._t = n; }

  // glow chain for one glowScale: prefilter at s, kawase down to ~1/64 of full res and back up, streak chain
  _chain(s) {
    if (this.chains.has(s)) return this.chains.get(s);
    const { W, H } = this, gw = Math.max(1, Math.round(W * s)), gh = Math.max(1, Math.round(H * s));
    const L = Math.max(2, Math.round(Math.log2(64 * s)));          // bloom levels below the prefilter
    const c = { s, pre: this._tex(gw, gh, true), glowT: this._tex(gw, gh, true), down: [], up: [], sd: [], su: [], L };
    for (let i = 0; i < L; i++) c.down.push(this._tex(Math.max(1, gw >> (i + 1)), Math.max(1, gh >> (i + 1)), true));
    for (let i = 0; i < L; i++) c.up.push(this._tex(i === 0 ? gw : c.down[i - 1].w, i === 0 ? gh : c.down[i - 1].h, true));
    c.hal = Math.min(L - 1, Math.max(0, Math.round(Math.log2(8 * s)) - 1));   // the down level nearest 1/8 res (halation)
    const S = Math.max(3, Math.round(Math.log2(64 * s)) + 1), sh = Math.min(gh, Math.max(1, H >> 3));
    for (let i = 0; i < S; i++) { c.sd.push(this._tex(Math.max(1, gw >> i), sh, true)); c.su.push(this._tex(Math.max(1, gw >> i), sh, true)); }
    this.chains.set(s, c);
    return c;
  }

  // ---------------------------------------------------------------- LUTs
  // lut('redcream') | lut(fn(r,g,b)->[r,g,b], 'key') | lut(cubeFileText, 'key'). Returns the key; pass { lut: { name: key } }.
  lut(src, key = null, n = 33) {
    let size = n, data;
    if (typeof src === 'string' && LUTS[src]) { key = key || src; src = LUTS[src]; }
    if (key && this.luts.has(key)) return key;
    if (typeof src === 'string') {                         // .cube text
      const lines = src.split(/\r?\n/); const vals = [];
      for (const ln of lines) { const s = ln.trim(); if (!s || s[0] === '#') continue;
        if (/^LUT_3D_SIZE/i.test(s)) size = parseInt(s.split(/\s+/)[1]); else if (/^[-\d.]/.test(s)) vals.push(...s.split(/\s+/).slice(0, 3).map(Number)); }
      data = new Uint8Array(size * size * size * 4);
      for (let i = 0; i < size ** 3; i++) { for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(cl(vals[i * 3 + c]) * 255); data[i * 4 + 3] = 255; }
      key = key || 'cube' + this.luts.size;
    } else {
      data = new Uint8Array(size * size * size * 4);
      let i = 0;
      for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
        const o = src(r / (size - 1), g / (size - 1), b / (size - 1));
        data[i++] = Math.round(cl(o[0]) * 255); data[i++] = Math.round(cl(o[1]) * 255); data[i++] = Math.round(cl(o[2]) * 255); data[i++] = 255;
      }
      key = key || 'fn' + this.luts.size;
    }
    this.luts.set(key, { t: this._tex3(size, data), n: size });
    return key;
  }
  _tex3(n, data = null, half = false) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (half) gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, n, n, n, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, n, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
    return t;
  }
  // tonemap + shoulder + grade + split + user LUT + fade -> one 33^3 texture, cached by value (LRU of 24).
  // A per-frame change (a mixPresets morph) re-bakes: 33 tiny draws, a few ms.
  _grade(fo, lu) {
    const lutE = lu ? this.luts.get(this.lut(lu.name || lu)) : null;
    const tone = fo.split || null, N = 33;
    const u = { tonemap: fo.tonemap ?? 0, shoulder: fo.shoulder || 0, contrast: fo.contrast || 0, fade: fo.fade || 0,
      crush: fo.crush || 0, sat: fo.sat ?? 1, temp: fo.temp || 0, mono: fo.mono || 0, monoTint: fo.monoTint || [1, 1, 1],
      toneS: tone?.shadows || [0.5, 0.5, 0.5], toneH: tone?.highlights || [0.5, 0.5, 0.5], toneAmt: tone ? tone.amount ?? 0.6 : 0, toneBal: tone?.balance ?? 0.5,
      lutAmt: lutE ? (lu.amount ?? 1) : 0, lutN: lutE ? lutE.n : 2 };
    const key = JSON.stringify(q3(u)) + (lutE ? '|' + (lu.name || lu) : '');
    let g = this.grades.get(key);
    if (g) { this.grades.delete(key); this.grades.set(key, g); return g; }
    const gl = this.gl;
    if (this.grades.size >= 24) { const [k0, g0] = this.grades.entries().next().value; this.grades.delete(k0); gl.deleteTexture(g0.t); }
    // RGBA8: with white on a lattice point the identity grade is within 1 level on 0.0003% of pixels. A half-float
    // LUT is exact but cost ~200 ms a frame on SwiftShader (measured 1 Oct), so it is opt-in: new Post(W, H, { lutHalf: true })
    g = { t: this._tex3(N, null, this.lutHalf && this.cbf), n: N };
    if (!this._bakeFb) this._bakeFb = gl.createFramebuffer();
    const out = { fb: this._bakeFb, w: N, h: N };
    for (let z = 0; z < N; z++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._bakeFb);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, g.t, 0, z);
      this._run('bake', out, { ...u, LUT: lutE ? lutE.t : null, N, layer: z });
    }
    this.grades.set(key, g);
    return g;
  }

  // ---------------------------------------------------------------- inputs
  _upload(tex, src) {
    const gl = this.gl, { W, H } = this;
    if ((src.width ?? src.videoWidth) !== W || (src.height ?? src.videoHeight) !== H) {      // fit anything else by scaling
      if (!this._fits) this._fits = new Map();
      let f = this._fits.get(tex); if (!f) { f = document.createElement('canvas'); f.width = W; f.height = H; this._fits.set(tex, f); }
      const g = f.getContext('2d'); g.clearRect(0, 0, W, H); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, W, H); src = f;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, tex.t);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }
  _uploadType(src) {
    const { W, H } = this;
    if (!this.ov) {
      this.ov = this._tex(W, H, false, false);
      const w8 = Math.max(1, Math.round(W / 8)), h8 = Math.max(1, Math.round(H / 8));
      this.ovb = [this._tex(w8, h8, false), this._tex(Math.max(1, w8 >> 1), Math.max(1, h8 >> 1), false), this._tex(Math.max(1, w8 >> 2), Math.max(1, h8 >> 2), false),
        this._tex(Math.max(1, w8 >> 1), Math.max(1, h8 >> 1), false)];
    }
    this._upload(this.ov, src);
    this._run('box8', this.ovb[0], { S: this.ov, ts: [1 / W, 1 / H] });
    this._run('kdown', this.ovb[1], { S: this.ovb[0], ts: [1 / this.ovb[0].w, 1 / this.ovb[0].h] });
    this._run('kdown', this.ovb[2], { S: this.ovb[1], ts: [1 / this.ovb[1].w, 1 / this.ovb[1].h] });
    this._run('typack', this.ovb[3], { A: this.ovb[1], B: this.ovb[2] });
    // Where is there type? Read back the 1/32 blur (~34x60 px) and keep the row bands that hold any, each with its
    // x extent plus a 2-texel (~64 px) margin for the glow / shadow / fringe reach. The TYPE variant of the last
    // pass then runs only inside these rects (scissor); the rest of the frame runs the variant without type.
    const T = this.ovb[2], gl = this.gl, px = this._tyPx || (this._tyPx = new Uint8Array(T.w * T.h * 4));
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb); gl.readPixels(0, 0, T.w, T.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const sx = W / T.w, sy = H / T.h, M = 2, rows = [];
    for (let y = 0; y < T.h; y++) { let x0 = T.w, x1 = -1;
      for (let x = 0; x < T.w; x++) if (px[(y * T.w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; x1 = x; }
      rows.push(x1 >= 0 ? [x0, x1] : null); }
    const rects = []; let area = 0;
    for (let y = 0; y < T.h; y++) {
      if (!rows[y]) continue;
      let y1 = y, x0 = rows[y][0], x1 = rows[y][1];
      while (y1 + 1 < T.h && rows[y1 + 1]) { y1++; x0 = Math.min(x0, rows[y1][0]); x1 = Math.max(x1, rows[y1][1]); }
      const X0 = Math.max(0, Math.floor((x0 - M) * sx)), X1 = Math.min(W, Math.ceil((x1 + 1 + M) * sx));
      const Y0 = Math.max(0, Math.floor((y - M) * sy)), Y1 = Math.min(H, Math.ceil((y1 + 1 + M) * sy));
      const last = rects[rects.length - 1];
      if (last && Y0 <= last[1] + last[3]) {                         // margins overlap: merge with the band above
        const nx = Math.min(last[0], X0), nx1 = Math.max(last[0] + last[2], X1), ny1 = Math.max(last[1] + last[3], Y1);
        area -= last[2] * last[3]; last[0] = nx; last[2] = nx1 - nx; last[3] = ny1 - last[1]; area += last[2] * last[3];
      } else { rects.push([X0, Y0, X1 - X0, Y1 - Y0]); area += (X1 - X0) * (Y1 - Y0); }
      y = y1;
    }
    rects.area = area / (W * H);
    this._tyRects = rects;
  }
  // Run a pass that can carry the type layer. The type variant is scissored to the rects that hold type, the
  // plain variant covers the frame (both are deterministic, so the seam is invisible). Saves ~80% of the type cost
  // for a slogan-sized layer; falls back to one full pass when type covers most of the frame or for atlas output.
  _runT(name, out, uni, defs, typeOn) {
    const R = this._tyRects;
    if (!typeOn) return this._run(name, out, uni, defs);
    if (R && !R.length) return this._run(name, out, uni, defs);           // empty type canvas
    if (!R || this.noScissor || (out && out.vp) || R.area > 0.55) return this._run(name, out, uni, [...defs, 'TYPE']);
    this._run(name, out, uni, defs);
    const gl = this.gl, toCanvas = !out || !out.fb;
    gl.enable(gl.SCISSOR_TEST);
    const kx = out && out.fb ? out.w / this.W : 1, ky = out && out.fb ? out.h / this.H : 1;   // a compScale target
    for (const [x, y, w, h] of R) {
      const X = Math.floor(x * kx), Y = Math.floor(y * ky), Wd = Math.ceil(w * kx) + 1, Hd = Math.ceil(h * ky) + 1;
      gl.scissor(X, toCanvas ? this.H - Y - Hd : Y, Wd, Hd); this._run(name, out, uni, [...defs, 'TYPE']); }
    gl.disable(gl.SCISSOR_TEST);
    this.stats.typeArea = R.area;
  }
  // type-layer uniforms from opts.type (defaults: light shadow + red glow + grain, no fringe)
  _typeUni(ty = {}) {
    const col = c => typeof c === 'string' ? hex(c) : c;
    return { OV: this.ov, OVB: this.ovb[3], tyGrain: ty.grain ?? 0.3, tyGlow: ty.glow ?? 0.35, tyShadow: ty.shadow ?? 0.35, tyCa: (ty.ca ?? 0) * this.unit,
      tyTint: col(ty.tint || [0.79, 0.12, 0.2]), tyFringe: col(ty.fringe || '#c91f37') };
  }

  // ---------------------------------------------------------------- apply
  // src: a canvas / image / video / ImageBitmap, or { world, type } where `type` is a transparent canvas of words
  //      composited AFTER tear / sort / mosh / bloom / CA / grade / dither, with its own amounts in opts.type.
  //      src = null reuses the last upload (several looks on one source).
  // t: seconds (frame = round(t * fps)). o: effect options (see research/capabilities/post.md).
  // draw: null (result stays in post.canvas; with { direct: true } that IS the screenshot) | { ctx, x, y, w, h }
  //       (blit into a 2D context, ~200 ms at 1080x1920 on SwiftShader) | { viewport: [x, yFromBottom, w, h] } (atlas).
  apply(src, t, o = {}, draw = null) {
    const vp = draw && draw.viewport ? { fb: null, vp: draw.viewport } : null;
    this._render(src, t, o, vp);
    if (draw && draw.ctx) {
      const { ctx, x = 0, y = 0, w = this.W, h = this.H } = draw;
      ctx.drawImage(this.canvas, x, y, w, h);
      this._tick('blit');
    }
    return this.canvas;
  }

  _render(src, t, o, target, { stageOnly = false, noType = false } = {}) {
    const gl = this.gl, W = this.W, H = this.H, fps = o.fps || 30;
    const frame = Math.round(t * fps);
    const num = (x, k = 'amount') => x == null ? 0 : typeof x === 'number' ? x : (x[k] ?? 1);
    this._t = performance.now();
    if (src && !(src.width || src.videoWidth) && ('world' in src || 'type' in src)) {
      const ty = src.type || null; src = src.world || null;
      this._typeLive = !!ty;
      if (ty && !stageOnly) this._uploadType(ty);
    } else if (src) this._typeLive = false;
    if (src) this._upload(this.src, src);
    this._tick('upload');
    let cur = this.src;

    // ---- pixel sort (at sort.scale; passes scale with sort.amount so mixPresets can fade it)
    const so = o.sort, sortOn = num(so) > 0;
    let sortOut = null;
    if (sortOn) {
      const sc = so.scale ?? 0.25, sw = Math.max(1, Math.round(W * sc)), shh = Math.max(1, Math.round(H * sc));
      if (!this.sortT || this.sortT[0].w !== sw || this.sortT[0].h !== shh) {
        this.sortT = [this._tex(sw, shh, false), this._tex(sw, shh, false), this._tex(sw, shh, false), this._tex(sw, shh, false)];
        for (const x of this.sortT) { gl.bindTexture(gl.TEXTURE_2D, x.t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); }
      }
      this._run('copy', this.sortT[0], { S: this.src });
      const passes = Math.round((so.passes ?? 24) * Math.min(1, num(so)));
      const axis = so.dir === 'h' ? 1 : 0, sseed = so.seed ?? Math.floor(frame / (so.hold || 4));
      let a = 0, b = 1;                                              // pass 0 reads the reference copy directly
      for (let i = 0; i < passes; i++) {
        this._run('sort', this.sortT[b], { S: this.sortT[a], parity: i & 1, lo: so.lo ?? 0.25, hi: so.hi ?? 0.92, dir: so.reverse ? -1 : 1,
          axis, bands: so.bands ?? 1, bandW: so.bandW ?? 6, seed: sseed });
        [a, b] = i === 0 ? [1, 2] : [b, a];
      }
      this._run('sortmix', this.sortT[3], { SORT: this.sortT[a], DOWN: this.sortT[0] });
      sortOut = this.sortT[3];
      this._tick('sort');
    }

    // ---- glitch / datamosh
    const go = o.glitch || {};
    const gOn = !!o.glitch && (num(go) > 0 || (go.mosh || 0) > 0 || (go.smear || 0) > 0 || (go.tear || 0) > 0);
    if (gOn || sortOn) {
      const fb = (go.mosh || 0) > 0 || (go.smear || 0) > 0;
      let out = this.stageT, prev = null;
      if (fb) {
        const key = o.slot || 'main';
        let h = this.hist.get(key);
        if (!h) { h = { tex: [this._tex(W, H, false), this._tex(W, H, false)], i: 0, primed: false, frame: null }; this.hist.set(key, h); }
        if (h.primed && !go.reset && h.frame !== frame - 1 && !this._warned) {
          this._warned = true;
          console.warn(`Post: slot '${key}' got frame ${frame} after ${h.frame}: datamosh/smear history is out of order and the result is not a function of t. Use post.applyStateful().`);
        }
        prev = h.primed && !go.reset ? h.tex[h.i] : null;
        h.i ^= 1; out = h.tex[h.i]; h.primed = true; h.frame = frame;
      }
      const gseed = go.seed ?? Math.floor(frame / (go.hold || 2));
      this._run('stage', out, { S: cur, P: prev || cur, SORTM: sortOut || this.dummy2,
        seed: (gseed % 1000) + 0.5, amount: gOn ? num(go) : 0, tear: go.tear || 0,
        mosh: go.mosh || 0, smear: go.smear || 0, flow: go.flow ?? 0.04, rgb: go.rgb ?? 0.012, res: [W, H], grid: go.grid || [7, 16] },
        [prev && 'USEP', sortOn && 'USESORT'].filter(Boolean));
      cur = out;
      this._tick('glitch');
    }
    if (stageOnly) return;

    // ---- glows (at glowScale)
    const bo = o.bloom, ho = o.halation, st = o.streaks;
    const bA = num(bo), hA = num(ho), sA = num(st);
    const ch = (bA || hA || sA) ? this._chain(o.glowScale || this.glowScale) : null;
    if (ch) {
      const thr = Math.min(bA ? bo.threshold ?? 0.6 : 1, hA ? ho.threshold ?? 0.5 : 1, sA ? st.threshold ?? 0.75 : 1);
      const dec = W / ch.pre.w;
      this._run('pre', ch.pre, { S: cur, ts: [dec * 0.25 / W, dec * 0.25 / H], thr, knee: (bo?.knee ?? 0.25) });
      this._tick('prefilter');
      if (bA || hA) {
        let s = ch.pre;
        for (const d of ch.down) { this._run('kdown', d, { S: s, ts: [1 / s.w, 1 / s.h] }); s = d; }
        if (bA) {
          const spread = bo?.radius ?? 1;
          for (let i = ch.L - 1; i >= 0; i--) {
            const lower = i === ch.L - 1 ? ch.down[ch.L - 1] : ch.up[i + 1];
            this._run('kup', ch.up[i], { S: lower, A: i === 0 ? ch.pre : ch.down[i - 1], ts: [spread / lower.w, spread / lower.h], wA: 1 });
          }
        }
        this._tick('bloom');
      }
      if (sA) {
        let s = ch.pre;
        const n = ch.sd.length;
        for (let i = 0; i < n; i++) { this._run('sdown', ch.sd[i], { S: s, ts: [1 / s.w, 1 / s.h], vt: i === 0 ? 1.3 : 0 }); s = ch.sd[i]; }
        const stretch = st.stretch ?? 0.88;
        for (let i = n - 2; i >= 0; i--) { const lower = i === n - 2 ? ch.sd[n - 1] : ch.su[i + 1];
          this._run('sup', ch.su[i], { S: lower, A: ch.sd[i], ts: [1 / lower.w, 0], stretch }); }
        this._tick('streaks');
      }
      this._run('glow', ch.glowT, { BL: ch.up[0], ST: ch.su[0], HL: ch.down[ch.hal], bloomAmt: bA * 0.22 * 6 / (ch.L + 1), bloomTint: bo?.tint || [1, 1, 1],
        streakAmt: sA, streakTint: st?.tint || [1, 0.45, 0.4], halAmt: hA }, [bA && 'BLOOM', sA && 'STREAK', hA && 'HAL'].filter(Boolean));
    }

    // ---- composite (+ fused finish when there is no dither and no CRT)
    const lo = o.lens || {}, fo = o.film || {}, vo = o.vignette, lu = o.lut;
    const aspect = W / H, k1 = lo.distort || 0, k2 = lo.distort2 || 0, r2c = aspect * aspect + 1;
    const wv = o.weave ? num(o.weave) : 0;
    const weave = wv ? [(Math.sin(frame * 1.7) * 0.6 + Math.sin(frame * 0.37) * 0.4) * wv / 1080, (Math.sin(frame * 2.3 + 1) * 0.5 + (((frame * 7919) % 13) / 13 - 0.5) * 0.5) * wv / 1920] : [0, 0];
    const flick = o.flicker ? 1 + num(o.flicker) * (((frame * 2654435761) >>> 0) % 1000 / 1000 - 0.5) : 1;
    const lutOn = lu && num(lu) > 0;
    const grade = Object.keys(fo).length || lutOn ? this._grade(fo, lutOn ? lu : null) : null;
    this._tick('grade');

    const gr = o.grain, di = o.dither || {}, cr = o.crt, un = o.unit ?? this.unit;
    const modes = { bayer: 1, levels: 2, cmyk: 3, riso: 4, lines: 5 };
    const dmode = o.dither && num(o.dither) > 0 ? modes[di.mode] || 0 : 0, crA = Math.min(1, num(cr));
    const cs = Math.min(1, o.compScale ?? this.compScale);          // < 1: composite the world at cs, finish at full res
    const fused = !dmode && !crA && cs >= 1;
    const ty = o.type || {}, typeOn = this._typeLive && !noType && !!this.ov;
    // Grain as delivered (STUDIO FINISH c1): a fresh pattern every frame at 1.3-1.6 px multiplied a piece's crf-19
    // bitrate 4-5x, and at share / platform bitrates the encoder turned it into soft mottle. So grain boils on twos
    // (grain.hold, default 2 frames; hand-drawn boil runs on twos) and is never finer than 2 px at 1080
    // (grain.minSize). Both keep the builder's amount and character; they are what survives the encode.
    const gHold = Math.max(1, Math.round(gr?.hold ?? 2)), fr0 = frame + (o.seed || 0) * 131;
    const finalUni = { res: [W, H], frame: fr0, gframe: Math.floor(fr0 / gHold) % 997, aspect, unit: un,
      grain: num(gr) * 0.1, grainSize: Math.max(gr?.size ?? 1.6, gr?.minSize ?? 2) * un, grainChroma: gr?.chroma ?? 0.25, dust: o.dust ? num(o.dust) : 0, scratch: o.dust?.scratch ?? 0,
      ...(typeOn ? this._typeUni(ty) : {}) };
    const finalDefs = [num(gr) && 'GRAIN', num(gr) && (gr.chroma ?? 0.25) > 0 && 'CHROMA', o.dust && num(o.dust) && 'DUST'];
    let compT = null;
    if (!fused) { const cw = Math.max(1, Math.round(W * cs)), chh = Math.max(1, Math.round(H * cs));
      if (!this.compT || this.compT.w !== cw || this.compT.h !== chh) { if (this.compT) { gl.deleteTexture(this.compT.t); gl.deleteFramebuffer(this.compT.fb); } this.compT = this._tex(cw, chh, false); }
      compT = this.compT; }
    this._runT('comp', fused ? target : compT, {
      S: cur, GL: ch ? ch.glowT : null, GR: grade ? grade.t : null, grN: grade ? grade.n : 2,
      weave, distort: k1, distort2: k2, fitZoom: k1 > 0 || k2 > 0 ? 1 + k1 * r2c + k2 * r2c * r2c : 1, ca: lo.ca || 0,
      halTint: ho?.tint || [1, 0.28, 0.08], expo: fo.exposure || 0, flicker: flick,
      vigAmt: num(vo), vigR0: vo?.inner ?? 0.25, vigR1: vo?.outer ?? 0.95, vigCol: vo?.color || [0, 0, 0],
      ...finalUni,
    }, [(k1 || k2) && 'LENS', (k1 || k2 || wv) && 'SHARP', `CA ${lo.ca ? (lo.spectral ? 2 : 1) : 0}`, ch && 'GLOW', grade && 'GRADE', num(vo) && 'VIG',
      ...(fused ? ['FUSED', ...finalDefs] : [])].filter(Boolean), typeOn && (fused || !!ty.medium));
    this._tick('composite');
    if (fused) return;

    // ---- finish (print / dither / CRT), then the type layer unless type.medium sent it through the print
    const pal = (di.palette || ['#0b0b0b', '#5a0a10', '#bd1818', '#f4e6d0']).slice(0, 6).map(c => typeof c === 'string' ? hex(c) : c);
    while (pal.length < 6) pal.push(pal[pal.length - 1]);
    const col = c => typeof c === 'string' ? hex(c) : c;
    const damt = Math.min(1, num(o.dither));
    this._runT('finish', target, {
      S: compT, ...finalUni,
      dscale: Math.max(1, (di.scale ?? (di.mode === 'cmyk' || di.mode === 'riso' ? 9 : di.mode === 'lines' ? 7 : 3)) * un), dangle: di.angle ?? 0.3,
      dlevels: di.levels ?? 3, dspread: di.spread ?? 0.4, dmis: (di.misregister ?? 0) * un, pal, npal: Math.min(6, (di.palette || [0, 0, 0, 0]).length),
      paper: col(di.paper || '#f4e6d0'), inkA: col(di.inkA || '#c91f37'), inkB: col(di.inkB || '#141012'), damt,
      crtCurve: (cr?.curve ?? 0.12) * crA, scan: (cr?.scan ?? 0.6) * crA, mask: (cr?.mask ?? 0.5) * crA, roll: (cr?.roll ?? 1) * crA, tracking: (cr?.tracking ?? 1) * crA,
    }, [...finalDefs, crA && 'CRT', `DMODE ${dmode}`, dmode && damt < 1 && 'DMIX'].filter(Boolean), typeOn && !ty.medium);
    this._tick('finish');
  }

  // ---------------------------------------------------------------- transitions
  // Two complete looks over one source, joined by a wipe; costs two chains + one full-res pass.
  //   w = { mode, u, angle, soft, seam, seamColor, glow, glowColor, bars, center, maxR, seed, mask, maskLuma }
  //   mode: 'mix' | 'knife' | 'bars' | 'iris' | 'burn' | 'mask'. u: 0 = all A, 1 = all B.
  //   'mask' = per-region looks: B where the mask canvas is (alpha, or luma * alpha with maskLuma: 1); u sweeps a
  //   threshold through it, so a gradient mask is also a custom wipe shape (u = 1 shows the whole mask region).
  //   The type layer is composited once, over the seam, with amounts interpolated optsA.type -> optsB.type.
  transition(src, t, optsA, optsB, w = {}, draw = null) {
    const u = Math.min(1, Math.max(0, w.u ?? 0.5));
    if (u <= 0 && w.mode !== 'mask') return this.apply(src, t, optsA, draw);
    if (u >= 1 && w.mode !== 'mask') return this.apply(src, t, optsB, draw);
    if (!this.wipeT) this.wipeT = [this._tex(this.W, this.H, false), this._tex(this.W, this.H, false)];
    this._render(src, t, optsA, this.wipeT[0], { noType: true });
    this._render(null, t, optsB, this.wipeT[1], { noType: true });
    const mode = WMODES[w.mode || 'knife'] ?? 1;
    if (mode === 5 && w.mask) { if (!this.maskT) this.maskT = this._tex(this.W, this.H, false, false); this._upload(this.maskT, w.mask); }
    const col = c => typeof c === 'string' ? hex(c) : c;
    const tyO = mixPresets({ type: optsA.type || {} }, { type: optsB.type || {} }, u).type;
    const typeOn = this._typeLive && !!this.ov;
    const vp = draw && draw.viewport ? { fb: null, vp: draw.viewport } : null;
    const frame = Math.round(t * (optsB.fps || 30));
    this._runT('wipe', vp, { A: this.wipeT[0], B: this.wipeT[1], MASK: this.maskT, u, angle: w.angle ?? 1.2,
      soft: w.soft ?? (mode === 4 ? 0.012 : 0.002),
      seam: (w.seam ?? (mode === 1 || mode === 2 ? 5 : mode === 3 ? 4 : 0)) * this.unit,
      glow: w.glow ?? (mode === 4 ? 1 : mode === 0 || mode === 5 ? 0 : 0.6),
      seamCol: col(w.seamColor || '#f4e6d0'), glowCol: col(w.glowColor || (mode === 4 ? [1, 0.42, 0.12] : '#c91f37')),
      bars: w.bars ?? 7, center: w.center || [0.5, 0.5], maxR: w.maxR ?? 1.2, seed: w.seed ?? 1, maskLuma: w.maskLuma ?? 0,
      res: [this.W, this.H], frame, gframe: Math.floor(frame / Math.max(1, Math.round(optsB.grain?.hold ?? 2))) % 997, aspect: this.W / this.H, unit: this.unit, grain: 0, ...(typeOn ? this._typeUni(tyO) : {}) },
      [`WMODE ${mode}`], typeOn);
    this._tick('wipe');
    if (draw && draw.ctx) draw.ctx.drawImage(this.canvas, draw.x || 0, draw.y || 0, draw.w || this.W, draw.h || this.H);
    return this.canvas;
  }

  // ---------------------------------------------------------------- stateful effects, made pure
  // Datamosh feedback (glitch.mosh / glitch.smear) reads the previous frame of its slot, so a bare apply() is
  // only correct when frames arrive in order: a still, a --from render or a skipped frame silently breaks the
  // smear. applyStateful makes the result a pure function of t. It puts an I-frame (history reset) on `anchor`
  // (seconds, or t => seconds, e.g. the last downbeat) and again every `maxPreroll` frames after it; when a frame
  // is not the successor of the last one on this slot, it pre-rolls from that I-frame. Pre-roll frames run only
  // upload + sort + glitch (no glows, composite or output) but DO call srcFn, so a still costs at most
  // maxPreroll - 1 extra source renders; a sequential render costs nothing extra.
  //   srcFn(t) -> canvas | { world, type } (may be async). optsFn(t) -> opts (may be async).
  //   cfg: { anchor = 0, slot = 'main', maxPreroll = 16, fps = 30, final = null }
  //   final(src, t, opts): replaces the last apply (e.g. post.transition with the moshed look as one side).
  // History lives per Post instance and slot: never share a slot between two scenes or two moshed layers.
  async applyStateful(srcFn, t, optsFn, cfg = {}, draw = null) {
    const { anchor = 0, slot = 'main', maxPreroll = 16, fps = 30, final = null } = cfg;
    const frame = Math.round(t * fps);
    let a = Math.round((typeof anchor === 'function' ? anchor(t) : anchor) * fps);
    if (a > frame) a = frame;
    a += Math.floor((frame - a) / maxPreroll) * maxPreroll;
    const s = this.state.get(slot);
    const f0 = s && s.frame === frame - 1 && s.anchor === a && frame > a ? frame : a;
    for (let f = f0; f <= frame; f++) {
      const tt = f / fps, o = await optsFn(tt), src = await srcFn(tt);
      const oo = { ...o, fps, slot, glitch: { ...(o.glitch || {}), reset: f === a } };
      if (f < frame) this._render(src, tt, oo, null, { stageOnly: true });
      else if (final) await final(src, tt, oo);
      else this.apply(src, tt, oo, draw);
    }
    this.state.set(slot, { frame, anchor: a });
    this.stats.preroll = frame - f0;
    return this.canvas;
  }
}

// ------------------------------------------------------------------ preset interpolation
// mixPresets(a, b, u): a continuous morph between two option sets. Numbers and arrays lerp, objects recurse,
// strings / booleans / LUT names switch at u = 0.5. A stage present on one side only fades by its amount
// (dither.amount dissolves the print in, crt.amount relaxes the glass, lut.amount fades the LUT, sort.amount
// scales the passes). Two different dither modes dip through un-dithered film at u = 0.5. Two different LUTs
// cannot blend by value: use post.transition(..., { mode: 'mix' }) for that.
const NEUTRAL = {
  film: { exposure: 0, tonemap: 0, shoulder: 0, contrast: 0, crush: 0, fade: 0, sat: 1, temp: 0, mono: 0 },
  split: { amount: 0 }, lens: { distort: 0, distort2: 0, ca: 0 }, glitch: { amount: 0, tear: 0, mosh: 0, smear: 0 },
  type: { grain: 0.3, glow: 0.35, shadow: 0.35, ca: 0 },
};
function neutralOf(x, key) {
  if (typeof x === 'number') return key === 'sat' ? 1 : 0;
  if (!x || typeof x !== 'object' || Array.isArray(x)) return x;
  const out = {};
  for (const [k, v] of Object.entries(x))
    out[k] = NEUTRAL[key] && k in NEUTRAL[key] ? NEUTRAL[key][k] : k === 'amount' ? 0 : v && typeof v === 'object' && !Array.isArray(v) ? neutralOf(v, k) : v;
  if (NEUTRAL[key]) for (const [k, v] of Object.entries(NEUTRAL[key])) if (!(k in out)) out[k] = v;
  if (!NEUTRAL[key] || key === 'split') out.amount = 0;
  return out;
}
function mixVal(a, b, u, key) {
  if (a === undefined && b === undefined) return undefined;
  if (key === 'amount') { a = a ?? 1; b = b ?? 1; }
  if (a === undefined) a = neutralOf(b, key);
  if (b === undefined) b = neutralOf(a, key);
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * u;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && typeof a[0] === 'number') return a.map((x, i) => x + (b[i] - x) * u);
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = mixVal(a[k], b[k], u, k);
    return out;
  }
  return u < 0.5 ? a : b;
}
export function mixPresets(a, b, u) {
  u = Math.min(1, Math.max(0, u));
  const out = mixVal(a, b, u, '');
  for (const k of ['slot', 'seed', 'fps', 'unit', 'glowScale', 'compScale']) if (a[k] !== undefined || b[k] !== undefined) out[k] = u < 0.5 ? a[k] ?? b[k] : b[k] ?? a[k];
  if (a.dither && b.dither && a.dither.mode !== b.dither.mode) out.dither.amount *= Math.abs(u - 0.5) * 2;
  return out;
}

// ------------------------------------------------------------------ presets
// preset(name, k) -> options; k = { kick, imp, beat } drives the beat-reactive parts (all optional).
// `type` is how that medium treats the protected type layer. Measured ms per preset: research/capabilities/post.md.
export const PRESETS = {
  // cinematic mythic: bloom + red halation + red-cream anamorphic streaks, print stock grade, fine grain
  mythic: k => ({
    bloom: { amount: 0.9 + 1.0 * k.kick, threshold: 0.62, radius: 1.2 }, halation: { amount: 0.6, tint: [1, 0.22, 0.06] },
    streaks: { amount: 1.8 + 2.2 * k.kick, threshold: 0.6, tint: [1, 0.55, 0.45], stretch: 0.94 },
    lens: { distort: 0.035, ca: 0.006 + 0.012 * k.kick },
    film: { exposure: 0, contrast: 0.35, sat: 1.12, shoulder: 0.25, split: { shadows: [0.3, 0.42, 0.5], highlights: [0.72, 0.52, 0.36], amount: 0.55 }, fade: 0.02 },
    vignette: { amount: 0.55 }, grain: { amount: 0.55, size: 1.4 },
    type: { glow: 0.55 + 0.4 * k.kick, shadow: 0.4, grain: 0.3, tint: [0.95, 0.2, 0.12] },
  }),
  // 1936 newsreel: mono silver, flicker, weave, dust and scratches, heavy grain, bleach
  newsreel: k => ({
    lut: { name: 'bleach', amount: 0.6 }, halation: { amount: 0.35, tint: [0.9, 0.85, 0.75], threshold: 0.6 },
    film: { mono: 1, monoTint: [1, 0.93, 0.8], contrast: 0.55, crush: 0.04, fade: 0.05, exposure: 0.1 },
    vignette: { amount: 0.75, inner: 0.15, outer: 0.85 }, grain: { amount: 1.5, size: 2.2, chroma: 0 },
    weave: 3, flicker: 0.12, dust: { amount: 0.8, scratch: 0.5 }, lens: { distort: 0.02 },
    type: { glow: 0.15, tint: [0.9, 0.85, 0.75], shadow: 0.45, grain: 0.9 },
  }),
  // two-ink risograph poster: ACP red + black on cream, misregistered
  riso: k => ({
    film: { contrast: 0.3, exposure: 0.2 },
    dither: { mode: 'riso', scale: 8.5, angle: 0.26, misregister: 3 + 5 * k.kick, paper: '#f4e6d0', inkA: '#c91f37', inkB: '#151012' },
    type: { glow: 0, shadow: 0.2, grain: 0.5, ca: 3 + 5 * k.kick },
  }),
  // broadcast: the state's screen in ACP red phosphor. Curved glass, scanlines, aperture mask, rolling bar, tracking
  broadcast: k => ({
    lut: { name: 'phosphor', amount: 0.92 },
    bloom: { amount: 0.6 + 0.6 * k.kick, threshold: 0.55, radius: 1 }, lens: { ca: 0.008 + 0.02 * k.kick },
    film: { contrast: 0.3, exposure: 0.1, shoulder: 0.3 },
    crt: { amount: 1, curve: 0.14, scan: 0.6, mask: 0.45, roll: 1, tracking: 1 + 4 * k.kick },
    glitch: { amount: 0.02 + 0.2 * k.kick, tear: 0.05 + 0.3 * k.kick, rgb: 0.01 },
    grain: { amount: 0.4, chroma: 0.3 }, vignette: { amount: 0.45 },
    type: { glow: 0.5, shadow: 0.35, grain: 0.35, ca: 2 + 6 * k.kick, tint: [1, 0.25, 0.25] },
  }),
  // datamosh: block glitch + feedback smear + pixel sort, beat-driven, on the ACP red-cream map. Stateful:
  // drive it through post.applyStateful().
  mosh: k => ({
    sort: { amount: 1, passes: 20, lo: 0.3, hi: 0.95, bands: 0.55, bandW: 3, reverse: false, scale: 0.25 },
    glitch: { amount: 0.08 + 0.5 * k.kick, tear: 0.08 + 0.4 * k.kick, mosh: 0.92, smear: 0.35 + 0.35 * (1 - k.kick), flow: 0.06, rgb: 0.02, hold: 3 },
    lut: { name: 'redcream', amount: 0.85 },
    bloom: { amount: 0.7, threshold: 0.62 }, lens: { ca: 0.008 },
    film: { contrast: 0.35, sat: 1.1, shoulder: 0.3 }, grain: { amount: 0.4 },
    type: { glow: 0.3, shadow: 0.55, grain: 0.3, ca: 3 + 8 * k.kick },
  }),
  // 1-bit+: ordered Bayer dither into the ACP palette, chunky pixels
  onebit: k => ({
    film: { contrast: 0.45, exposure: 0.05 + 0.3 * k.kick },
    bloom: { amount: 0.6, threshold: 0.6 },
    dither: { mode: 'bayer', scale: 5, palette: ['#070203', '#5c0a12', '#c91f37', '#f4e6d0'] },
    type: { glow: 0, shadow: 0.5, grain: 0 },
  }),
  // extras
  aerochrome: k => ({ lut: { name: 'aerochrome' }, bloom: { amount: 0.8 + 0.6 * k.kick, threshold: 0.62 }, halation: { amount: 0.45 },
    film: { contrast: 0.35, sat: 1.1, exposure: 0.05, shoulder: 0.35 }, grain: { amount: 0.6 }, vignette: { amount: 0.5 },
    type: { glow: 0.5, shadow: 0.35 } }),
  redkeep: k => ({ lut: { name: 'redkeep' }, bloom: { amount: 0.8 + k.kick, threshold: 0.6 }, halation: { amount: 0.6 },
    film: { contrast: 0.5, exposure: 0.05, shoulder: 0.2 }, grain: { amount: 0.8, size: 1.8 }, vignette: { amount: 0.6 },
    type: { glow: 0.45, shadow: 0.4, grain: 0.5 } }),
  // gold: molten, held under white. Lower exposure, a highlight shoulder before the gradient map, crushed blacks
  gold: k => ({ lut: { name: 'gold' }, bloom: { amount: 0.55 + 0.6 * k.kick, threshold: 0.72, radius: 1.3 }, streaks: { amount: 0.6 + 0.8 * k.kick, threshold: 0.75, tint: [1, 0.6, 0.3] },
    halation: { amount: 0.45, tint: [1, 0.35, 0.08] }, film: { contrast: 0.45, exposure: -0.35, shoulder: 0.7, crush: 0.03 }, grain: { amount: 0.5 }, vignette: { amount: 0.65 },
    type: { glow: 0.5, shadow: 0.45, tint: [1, 0.45, 0.1] } }),
  engraving: k => ({ film: { contrast: 0.4 }, dither: { mode: 'lines', scale: 7, angle: 0.5, paper: '#efe2c8', inkA: '#9c1420', inkB: '#1a1411' },
    type: { glow: 0, shadow: 0.25, grain: 0.4 } }),
  cmyk: k => ({ film: { contrast: 0.2, sat: 1.3 }, dither: { mode: 'cmyk', scale: 10, misregister: 2 }, type: { glow: 0, shadow: 0.2, ca: 2 } }),
  redcream: k => ({ lut: { name: 'redcream' }, bloom: { amount: 1.0 + k.kick, threshold: 0.6 }, halation: { amount: 0.5 },
    film: { contrast: 0.25, shoulder: 0.55, exposure: -0.1 }, grain: { amount: 0.6 }, vignette: { amount: 0.5 }, type: { glow: 0.4, shadow: 0.4 } }),
};
export function preset(name, k = {}) { return PRESETS[name]({ kick: 0, imp: 0, beat: 0, ...k }); }
