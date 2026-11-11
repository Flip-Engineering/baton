// STYLE c3: the GRAPHIC surface, one chained material patch (after lane E's surface patch and STYLE c2's draw patch, whose
// bind-space fields it reads: vDr0 cross-contour / along-the-form / fibre phases, vDr1 purity, face, hand; vDrP bind position).
// Inert unless GX_U.gxMode > 0: a hero that never asks for a graphic style renders exactly as before, and one that did renders
// exactly as before whenever gxMode is 0.
//
// Every mark is a function of the person's BIND position (or, on a sewn garment, of its PATTERN coordinates: the fabric's own
// uv in metres, so hatching and gouges ride the cloth's folds) and of a designed tone; the only screen quantities are the
// derivatives that anti-alias a mark and the figure's px per metre for the shot (gxCell.y: fixed through a walk).
//   kind 1 LINO     linocut / woodcut: gouged lines along the cross-contours (white cuts tapering into the blacks, black lines
//                   left standing in the lights), stroke ends, the knife's wobble; solid blacks; coarse spacing
//   kind 2 STENCIL  the cut spray stencil: the style pass writes each surface's tone in the light, its class and its shadow (smooth
//                   vertex normal); stage.js smooths the shadow over the form, cuts each surface into its two layers, adds the overspray
//   kind 3 RISO     risograph / screenprint, two spot inks: a log-density separation of the designed colour into the inks,
//                   each an AM halftone attached to the body (bind plane of the dominant axis; pattern plane on cloth);
//                   stage.js misregisters the plates
//   kind 4 FLAT     poster and cel: flat local colour (the person's skin, the garment's dye, the hair's colour, not the
//                   textured albedo), a designed shadow SHAPE (smooth normal, hard terminator), cel: a light shape too;
//                   poster: colours drawn toward a printer's palette
//   kind 5 CHALK    chalk on a blackboard: the lights drawn in white chalk strokes along the forms, local colour in a
//                   coloured chalk, the board's tooth stuck to the body (grain), the shadow left as board
import * as THREE from 'three';

export const GX_U = {
  gxMode: { value: 0 }, gxKind: { value: 1 },
  gxKey: { value: new THREE.Vector3(-0.6, 0.55, 0.55).normalize() },
  gxTone: { value: new THREE.Vector4(0.0, 0.08, 0.2, 0.25) },       // terminator, softness, ambient, reflected light
  gxLocal: { value: new THREE.Vector4(0.24, 0.62, 0.9, 0.7) },      // local-value floor, its white point, gamma, turn of the form in the light
  gxFace: { value: new THREE.Vector4(0.3, 0.25, 0.35, 0.0) },       // face lift, hand lift, face modelling, (w) unused
  gxCell: { value: new THREE.Vector4(7.0, 540.0, 0.002, 0.05) },    // mark spacing px, px per metre at the heroes (the shot's), wobble m, stroke length m
  gxP1: { value: new THREE.Vector4(0.15, 0.85, 0.5, 0.0) },          // per kind (see OUT)
  gxP2: { value: new THREE.Vector4(0.0, 0.0, 0.0, 0.0) },
  gxC0: { value: new THREE.Color('#141110') }, gxC1: { value: new THREE.Color('#c81e1e') },   // inks (display values)
  gxC2: { value: new THREE.Color('#efe6d2') }, gxC3: { value: new THREE.Color('#2a4b7c') },
  gxRes: { value: new THREE.Vector2(1080, 1920) },
  gxScreen: { value: 0 },                                             // 1: the marks fixed to the SCREEN (the motion test's control)
  // gxLn x flat2 (the shapes cut in the composite), y the fold contour's half-width px, z the hair's highlight band, w the fold contour's
  // weight on cloth; gxHair: the designed hair (x shadow terminator on the head's ball, y the highlight's threshold, z strands from the
  // groom, w the highlight's jitter per card); gxEx: x the stencil's skin inks from the person's own hue (on the flat kind: the four-ink
  // print's hue pull the short way round), z / w the watercolour's backruns and core glaze (wash), w the riso's extra red on light skin
  gxLn: { value: new THREE.Vector4(0, 0, 0, 0) }, gxHair: { value: new THREE.Vector4(0, 0, 0, 0) }, gxEx: { value: new THREE.Vector4(0, 0, 0, 0) },
  // gxLayer, THE LAYER RESOLVE (0 at rest): x the covered skin (and the underwear) pushed
  // back x m in DEPTH ONLY (not the face, not the hands), y each inner garment pushed back y m per rank below the outermost (gxRank: its
  // own uniform), z 1 = the key AOV carries the owner garment (gxGrp x 0.04 on the id: floor(id + 0.5) unchanged for every c5 reader),
  // w 1 = THE NOTAN'S VALUE PLAN (STYLE c6 it10): the flat pass writes (its local luma, the surface's class shift gxNv, 0) in place of the
  // colour (gxNv: per material, stage.js notanPlan; the notan reads only the luma, so nothing else changes)
  gxLayer: { value: new THREE.Vector4(0, 0, 0, 0) },
};

// no varyings of our own (a body shader already carries every lane's; SwiftShader's limit is 15 vectors): the bind normal is STYLE
// c2's vDrN, the pattern uv the fabric's own vFabUV (cloth/fabric_glsl.js, FAB_UVQ)

export const GX_COMMON = /* glsl */`
float gxH3(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float gxH2(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float gxH1(float x){ return gxH2(vec2(x, 17.31)); }
float gxN3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(gxH3(i), gxH3(i + vec3(1,0,0)), f.x), mix(gxH3(i + vec3(0,1,0)), gxH3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(gxH3(i + vec3(0,0,1)), gxH3(i + vec3(1,0,1)), f.x), mix(gxH3(i + vec3(0,1,1)), gxH3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float gxN2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gxH2(i), gxH2(i + vec2(1,0)), f.x), mix(gxH2(i + vec2(0,1)), gxH2(i + vec2(1,1)), f.x), f.y); }
float gxF2(vec2 p){ return gxN2(p) * 0.55 + gxN2(p * 2.03 + 7.1) * 0.3 + gxN2(p * 4.1 + 3.7) * 0.15; }
vec3 gxSRGB(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 gxLin(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
float gxLuma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 gxHSV(vec3 c){ vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x); }
vec3 gxRGB(vec3 c){ vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }`;

const FRAG_PARS = /* glsl */`
uniform float gxMode, gxKind, gxObj, gxCls, gxScreen; uniform vec4 gxTone, gxLocal, gxFace, gxCell, gxP1, gxP2, gxFlat; uniform vec3 gxKey, gxC0, gxC1, gxC2, gxC3; uniform vec2 gxRes;
uniform vec4 gxLn, gxHair, gxEx, gxHead, gxLayer; uniform float gxGrp, gxNv;
${GX_COMMON}
// one family of lines on a phase p (m), spacing s (m), ink fraction c in [0,1]; the line's half-width follows c; profile w (0..1)
// thins a line toward its ends (a gouge's taper). Returns ink coverage, anti-aliased by the phase's own screen derivative.
float gxLine(float p, float s, float c, float prof){
  float q = p / s, d = abs(fract(q) - 0.5), hw = 0.5 * c * prof, aa = max(fwidth(q), 1e-4) * 0.75;
  return 1.0 - smoothstep(hw - aa, hw + aa, d); }
// AM halftone: a spot function on a 2D cell (rotated by ang), threshold against coverage k; the cell is in metres on the body
float gxDot(vec2 uv, float cell, float ang, float k){
  float c = cos(ang), s = sin(ang); vec2 q = mat2(c, -s, s, c) * uv / cell;
  float spot = 0.5 - 0.25 * (cos(6.2831853 * q.x) + cos(6.2831853 * q.y));   // 0 at the dot's centre .. 1 at the cell corner
  float aa = max(fwidth(spot), 1e-4);
  k = clamp(k, 0.0, 1.0); return k < 0.003 ? 0.0 : k > 0.997 ? 1.0 : 1.0 - smoothstep(k - aa, k + aa, spot); }`;

// at the very end of main(), after lane E's and STYLE c2's OUT (inert while gxMode is 0)
const OUT = /* glsl */`
if (gxMode > 1.5) {
  // the KEY AOV for the GPU line pass: object id, view depth, the smooth view normal (x, y)
  vec3 gN = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  gl_FragColor = vec4(gxObj + 1.0 + (gxLayer.z > 0.5 ? gxGrp * 0.04 : 0.0), vViewPosition.z, gN.x, gN.y);   // STYLE c6: + the owner garment (rev 7 only)
}
else if (gxMode > 0.5) {
  vec3 gNs = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);            // the smooth (vertex) normal: designed shapes
  vec3 gNd = normalize(normal);                                             // the detailed normal: textured media
  vec3 Kd = normalize(gxKey);
  float face = vDr1.y, hand = vDr1.z, isEye = step(vDr1.w, -0.5);
  int K = int(gxKind + 0.5);
  vec3 N = (K == 2 || K == 4 || K == 11) ? gNs : normalize(mix(gNs, gNd, 0.6));   // the stencil, the flat looks and the mural model the form, not the knit
  float ndl = dot(N, Kd);
  // local colour: a FLAT colour where the person carries one (skin, hair, a garment's dye; gxFlat.w = 1), else the albedo
  vec3 lsA = gxSRGB(diffuseColor.rgb), ls = lsA;
  if (gxFlat.w > 0.5) { ls = gxFlat.rgb;
    if (gxCls < 0.5) { float d = gxLuma(lsA) / max(gxLuma(gxFlat.rgb), 1e-3); ls *= mix(1.0, clamp(d, 0.55, 1.2), 0.5 * face); } }   // skin: the face keeps its lips and brows a little
  float lv = gxLuma(ls);
  // STYLE c4 (gxFace.w > 0, opt-in per recipe): scalp hair, brows and stubble painted on the skin (the albedo far darker than the
  // person's flat skin colour) are kept as hair, not flattened into skin
  float hairy = gxCls < 0.5 && gxFlat.w > 0.5 ? gxFace.w * (1.0 - smoothstep(0.32, 0.5, gxLuma(lsA) / max(gxLuma(gxFlat.rgb), 1e-3))) : 0.0;
  float lit = smoothstep(gxTone.x - gxTone.y, gxTone.x + gxTone.y, ndl), grad = smoothstep(-0.05, 0.95, ndl);
  float refl = (1.0 - lit) * pow(1.0 - abs(N.z), 2.0) * gxTone.w;
  float light = lit * (1.0 - gxLocal.w + gxLocal.w * grad) + refl;
  float lf = gxLocal.x + (1.0 - gxLocal.x) * pow(clamp(lv / gxLocal.y, 0.0, 1.0), gxLocal.z);
  float v = lf * (gxTone.z + (1.0 - gxTone.z) * light);
  v = mix(v, 1.0 - (1.0 - v) * (1.0 - gxFace.x), face); v = mix(v, 1.0 - (1.0 - v) * (1.0 - gxFace.y), hand);
  float T = clamp(1.0 - v, 0.0, 1.0);
  T += gxFace.z * face * (1.0 - smoothstep(0.2, 0.92, ndl)) * (1.0 - T);   // a face is modelled, not a blank (STYLE c2)
  // the mark coordinates: bind phases on the body, pattern (uv, metres) on a sewn garment
  float ppm = gxCell.y, sp = gxCell.x / ppm;                           // spacing in metres for this shot
  vec3 P = vDrP; float pc = vDr0.x, pa = vDr0.y, pur = smoothstep(0.6, 0.92, vDr1.x);
  vec2 pat = vec2(0.0); bool cloth = false;
#ifdef FAB_UVQ
  pc = vFabUV.y; pa = vFabUV.x; pur = 1.0; pat = vFabUV; cloth = true;
#endif
  if (gxScreen > 0.5) { vec2 sc = gl_FragCoord.xy / ppm; P = vec3(sc, 0.0); pc = dot(sc, vec2(0.5, 0.866)); pa = dot(sc, vec2(0.866, -0.5)); pat = sc; pur = 1.0; }   // the control: a 30-degree family fixed to the screen
  float wob = (gxN3(P * 31.0) - 0.5) * gxCell.z + (gxN3(P * 7.0 + 3.1) - 0.5) * gxCell.z * 1.6;
  vec3 col = gxC2; float aOut = 1.0;
  if (K == 1) {
    // LINO: one family of gouged lines along the cross-contour (the diagonal where chains blend), ink fraction from the tone;
    // white cuts in the darks are strokes with tapered ends (the gouge's flick), black lines in the lights stay continuous
    float pd = dot(P, normalize(vec3(0.55, 1.0, 0.2)));
    float ph = mix(pd, pc, pur) + wob, ln = floor(ph / sp);
    float c = smoothstep(gxP1.x, gxP1.y, T);                                // ink fraction: 0 cleared, 1 solid
    float along = pa / max(gxCell.w, 1e-3) + gxH1(ln) * 7.0, s = fract(along), seg = floor(along);
    float flick = gxH2(vec2(ln, seg)), prof = smoothstep(0.0, 0.35 + 0.3 * flick, s) * (1.0 - smoothstep(0.62 + 0.3 * flick, 1.0, s));
    // white cut half-width: (1 - c), shortened into strokes where the ink is heavy
    float cut = (1.0 - c) * mix(1.0, prof, smoothstep(0.45, 0.8, c));
    float ink = 1.0 - gxLine(ph, sp, cut, 1.0);
    if (isEye > 0.5) ink = step(0.62, T);
    col = mix(gxC2, gxC0, ink);
  } else if (K == 2) {
    // STENCIL (the CUT stencil, stencil7): SKIN is cut by its FORM (the tone from the light alone, faces modelled) and its own value and
    // hue go to the INKS (stage.js: a skin light ink and a skin mid ink, never black from the light); r = the tone IN THE LIGHT (the
    // surface's own value class: skin always the light layer; eyes the mid; painted-on hair and dark local colour the dark) + 2 x the skin's
    // value (0..100, an integer); b = class (2 skin, 1 cloth, 0 the rest) + the SHADOW (0 lit .. 1); a = 1 + the skin's hue x 100 (shifted
    // a quarter turn: no skin wraps) + its saturation (gxEx.x). stage.js smooths the shadow over the form and cuts each surface into ITS
    // two layers
    float code = gxCls < 0.5 ? 2.0 : (gxCls > 0.5 && gxCls < 1.5 ? 1.0 : 0.0), kL = 0.0;
    if (hairy > 0.5) code = 0.0;
    else if (gxCls < 0.5) kL = floor(clamp(gxLuma(gxFlat.rgb), 0.0, 1.0) * 100.0 + 0.5);
    vec3 skH = gxHSV(gxFlat.rgb); float aS = gxEx.x > 0.5 && code > 1.5 ? 1.0 + floor(fract(skH.x + 0.25) * 100.0) + clamp(skH.y, 0.0, 1.0) * 0.99 : 1.0;
    float vl = gxLocal.x + (1.0 - gxLocal.x) * pow(clamp(lv / gxLocal.y, 0.0, 1.0), gxLocal.z);
    vl = mix(vl, 1.0 - (1.0 - vl) * (1.0 - gxFace.x), face); vl = mix(vl, 1.0 - (1.0 - vl) * (1.0 - gxFace.y), hand);
    float Tl = code > 1.5 ? 0.0 : 1.0 - vl; Tl = mix(Tl, max(Tl, 0.82), step(lv, 0.08) * step(code, 1.5));
    if (isEye > 0.5) Tl = max(Tl, 0.56);
    if (hairy > 0.5) Tl = max(Tl, 0.82);
    gl_FragColor = vec4(clamp(Tl, 0.0, 0.999) + 2.0 * kL, 0.0, code + clamp(1.0 - lit, 0.0, 1.0) * 0.98, aS);
    return;
  } else if (K == 3) {
    // RISO: two plates designed as a printer separates them by hand: the RED plate carries the colour (skin by its depth, warm
    // cloth by its redness, any cloth a little by its value), the BLACK plate the shadow masses and the dark local colours; the
    // light side of a light colour is the paper
    float warm = clamp((ls.r - ls.b) * 2.4 - 0.05, 0.0, 1.0), lit2 = gxTone.z + (1.0 - gxTone.z) * light;
    float ka = gxCls < 0.5 ? (0.24 + 0.58 * clamp(1.0 - lv / 0.72, 0.0, 1.0)) : gxCls < 1.5 ? warm * 0.85 + (1.0 - lv) * 0.12 : (1.0 - lv) * 0.2;
    ka = clamp(ka * gxP1.x * mix(0.72, 1.0, lit2) * (1.0 - 0.3 * face * (1.0 - T)), 0.0, 0.92);
    float kb = clamp(smoothstep(gxP1.w, 0.95, T) * gxP1.y, 0.0, 0.96);
    if (gxCls < 0.5) kb = max(kb, clamp(1.0 - lv / 0.55, 0.0, 1.0) * 0.42 * (1.0 - 0.4 * light));   // deep skin keeps its depth in the dark plate
    if (gxCls > 0.5 && gxCls < 1.5) kb = max(kb, (1.0 - warm) * (1.0 - lv) * 0.42 * (1.0 - 0.35 * light));   // cool cloth (blue, grey, green) prints as a black tint
    // the halftone plane: the bind plane across the dominant axis of the bind normal (body), the pattern plane (cloth)
    vec3 an = abs(normalize(vDrN)); vec2 uv = an.x > an.y && an.x > an.z ? P.yz : an.y > an.z ? P.xz : P.xy;
    if (cloth || gxScreen > 0.5) uv = pat;
    float cell = gxP1.z / ppm;
    {
      // THREE plates (red, blue, black). Skin: the red plate carries its warmth, the BLACK plate its value (deep skin
      // prints as red under black, a brown, not pink), the shadow on top; cloth: warm dyes on red, cool dyes (blue, green, grey)
      // on blue, their value and shadow on black; painted-on hair as black
      float cool = clamp((max(ls.g, ls.b) - ls.r) * 2.4 - 0.02, 0.0, 1.0);
      if (gxCls < 0.5) { ka = clamp((0.2 + 0.3 * clamp(1.0 - lv / 0.72, 0.0, 1.0)) * gxP1.x * mix(0.75, 1.0, lit2), 0.0, 0.6);
        kb = max(smoothstep(gxP1.w, 0.95, T) * gxP1.y * 0.85, clamp((0.62 - lv) / 0.5, 0.0, 1.0) * gxP2.y * (1.0 - 0.3 * light));
        kb = max(kb, hairy * 0.9); ka *= 1.0 - hairy; }
      float kc = 0.0;
      if (gxCls > 0.5 && gxCls < 1.5) { kc = clamp(cool * (0.62 + 0.4 * (1.0 - lv)) * mix(0.72, 1.0, lit2) * gxP2.z, 0.0, 0.95);
        kb = max(smoothstep(gxP1.w, 0.95, T) * gxP1.y, (1.0 - lv) * (1.0 - lv) * 0.55 * (1.0 - 0.35 * light)); }
      float da = gxDot(uv, cell, 0.2618, ka), db = gxDot(uv + 0.37 * cell, cell, 0.7854, kb), dc = gxDot(uv + 0.71 * cell, cell, 1.309, kc);
      if (!cloth && gxScreen < 0.5) {
        // the body's screen in all three bind planes, blended by the bind normal (the c4 dominant-axis switch cut a
        // seam round the neck and jaw); light cloth keeps its value in the black plate, light skin a little more red (less paper)
        vec3 bw = pow(an, vec3(6.0)); bw /= bw.x + bw.y + bw.z;
        kb = gxCls > 0.5 && gxCls < 1.5 ? max(kb, (1.0 - lv) * 0.3 * (1.0 - 0.4 * light)) : kb; ka = gxCls < 0.5 ? min(0.66, ka + gxEx.w) : ka;
        da = 0.0; db = 0.0; dc = 0.0;
        for (int ax = 0; ax < 3; ax++) { vec2 u2 = ax == 0 ? P.yz : ax == 1 ? P.xz : P.xy; float wgt = ax == 0 ? bw.x : ax == 1 ? bw.y : bw.z;
          da += wgt * gxDot(u2, cell, 0.2618, ka); db += wgt * gxDot(u2 + 0.37 * cell, cell, 0.7854, kb); dc += wgt * gxDot(u2 + 0.71 * cell, cell, 1.309, kc); } }
      if (isEye > 0.5) { da = 0.0; db = step(0.6, T); dc = 0.0; }
      gl_FragColor = vec4(da, db, dc, 1.0);
      return; }
  } else if (K == 4) {
    // FLAT (poster gxP1.w = 0, cel = 1): a light colour and a shadow SHAPE; cel adds a light shape. Poster colours drawn toward a
    // printer's palette (a few dyes), skin kept as the person's own hue
    vec3 c = ls;
    if (gxCls > 0.5 && gxCls < 1.5 && gxP1.w < 0.5) {                // poster: a garment's dye snapped toward the palette's hues
      vec3 h = gxHSV(c); vec3 pr = gxHSV(gxC1), pb = vec3(gxP2.w, 0.6, 0.5);
      float dr = abs(fract(h.x - pr.x + 0.5) - 0.5), db = abs(fract(h.x - pb.x + 0.5) - 0.5);
      vec3 tgt = h.y < 0.12 ? vec3(h.x, h.y * 0.5, h.z) : dr < db ? vec3(pr.x, max(h.y, 0.55), h.z) : vec3(pb.x, max(h.y, 0.5), h.z);
      vec3 hm = mix(h, tgt, gxP2.x);
      if (gxEx.x > 0.5) hm.x = fract(h.x + (fract(tgt.x - h.x + 0.5) - 0.5) * gxP2.x);   // the four-ink print: the hue turns the short way round (a plain mix sends a maroon, hue 0.97, through green to 0.37)
      c = gxRGB(hm); }
    c = mix(c, lsA * 0.85, hairy);
    float y = gxLuma(c); c = clamp(mix(vec3(y), c, gxP2.y), 0.0, 1.0);   // saturation
    float sh = 1.0 - smoothstep(gxTone.x - gxTone.y, gxTone.x + gxTone.y, ndl);
    vec3 shadow = c * gxC3 * gxP1.x;                // the shadow tint (cel: cool; poster: warm umber)
    vec3 lightC = mix(c, vec3(1.0), gxP1.y);
    vec3 hiC = mix(c, vec3(1.0), gxP1.z);
    float hi = gxP1.w * smoothstep(gxP2.z - gxTone.y, gxP2.z + gxTone.y, ndl) * (gxCls < 2.5 ? 1.0 : 0.0);
    col = mix(mix(lightC, hiC, hi), shadow, sh);
    if (isEye > 0.5) col = mix(vec3(0.92, 0.9, 0.86), gxC0, step(0.5, 1.0 - gxLuma(lsA)));
    {
      // FLAT2: the composite cuts the shapes (the shadow smoothed over the form, the hair one designed mass); written here:
      // the flat colour, the raw shadow and light shapes and the FOLD CONTOUR (the surface's own n.v = 0 line, its width in px from its
      // own derivative, so it rides the surface sub-pixel smooth), packed in alpha: 1 + shadow (0..127) + 0.5 light + 0.49 line
      float aaT = max(gxTone.y, fwidth(ndl) * 0.75), shv = 1.0 - smoothstep(gxTone.x - aaT, gxTone.x + aaT, ndl), hiv = hi * (1.0 - step(0.5, hairy)), band = 0.0;
      vec3 Vv = normalize(vViewPosition);
      if (gxCls < 1.5 && isEye < 0.5) { float ndv = dot(gNs, Vv), gd = max(fwidth(ndv), 1e-5);
        band = (1.0 - smoothstep(gxLn.y - 0.5, gxLn.y + 0.5, abs(ndv) / gd)) * (gxCls > 0.5 ? gxLn.w : 1.0 - 0.35 * face); }
#ifdef GX_HV
      if (gxHead.w > 0.5) {
        // DESIGNED HAIR: the masses lit as one ball (the head's, stretched down the length: long hair a column), not card by card;
        // a highlight band toward the key, its edge broken per card (the groom's locks); a few of the groom's own strands (its atlas
        // strand ids, one in eight) as lines, from bust size up
        vec3 hd = -vViewPosition - gxHead.xyz; hd.y = hd.y > -0.05 ? hd.y : -0.05 + (hd.y + 0.05) * 0.15; vec3 hn = normalize(hd);
        shv = 1.0 - smoothstep(gxHair.x - 0.04, gxHair.x + 0.04, dot(hn, Kd));
        vec3 Hh = normalize(Kd + vec3(0.0, 0.0, 1.0)); float jit = (fract(vHair.z * 13.71) - 0.5) * gxHair.w;
        float hdd = dot(hn, Hh) + jit; hiv = step(gxHair.y, hdd) * (gxLn.z > 0.0 ? 1.0 - step(gxHair.y + gxLn.z, hdd) : 1.0) * (1.0 - step(0.5, shv));   // gxLn.z: a band (a sheen across the head), not a cap
        vec4 gtx = texture(hAtlas, vHUV); float sid = floor(gtx.r * 255.0 + 0.5);
        band = gxHair.z * step(0.5, gtx.g * 2.0) * step(fract(sid * 0.6180339 + vHair.z * 7.31), 0.12) * smoothstep(0.08, 0.25, vHair.x) * (1.0 - smoothstep(0.75, 0.95, vHair.x)) * smoothstep(900.0, 1600.0, gxCell.y);
      }
#endif
      if (isEye > 0.5) { gl_FragColor = vec4(col, 129.0); return; }
      if (gxLayer.w > 0.5) c = vec3(gxLuma(c), (gxNv + 2.0) * 0.25, step(0.5, hairy));   // the notan's value plan (it10): the luma and the class shift, exact in the float target; it11: b a painted mark on the skin (brows, stubble), which the lit plane leaves alone
      gl_FragColor = vec4(c, 1.0 + floor(clamp(shv, 0.0, 1.0) * 127.0 + 0.5) + 0.5 * step(0.5, hiv) + 0.49 * clamp(band, 0.0, 1.0));
      return;
    }
  } else if (K == 5) {
    // CHALK: the lights in chalk strokes along the cross-contour (the turn of the form), a second chalk for local colour; the
    // board's tooth stuck to the body (grain), so a stroke skips the same places frame to frame
    float L = 1.0 - T;
    float pd = dot(P, normalize(vec3(0.62, 1.0, 0.22)));
    float ph = mix(pd, pc, pur) + wob * 2.0, ln = floor(ph / sp);
    float along = pa / max(gxCell.w, 1e-3) + gxH1(ln) * 3.0, s = fract(along);
    float prof = smoothstep(0.0, 0.18, s) * (1.0 - smoothstep(0.8, 1.0, s));
    float gr = gxN3(P * (ppm * 0.6)) * 0.6 + gxN3(P * (ppm * 0.21) + 9.0) * 0.4;
    float mass = smoothstep(gxP1.x, gxP1.y, L);                          // the light planes laid in with the side of the chalk
    // strokes only in the half-tones (gxP2.yz), the lights one solid mass
    float strokes = gxLine(ph, sp, smoothstep(gxP2.y, gxP2.z, L) * gxP2.w, mix(0.6, 1.0, prof)) * (1.0 - mass);
    float wht = clamp(max(mass * (0.55 + 0.45 * gr), strokes * 0.9) * smoothstep(0.25, 0.55, gr + 0.25 * L), 0.0, 1.0);
    float clr = smoothstep(0.05, 0.5, L) * (1.0 - wht) * gxP1.z * smoothstep(0.3, 0.6, gr) * (1.0 - smoothstep(0.85, 1.0, lv) * 0.7);
    vec3 cc = clamp(mix(vec3(gxLuma(ls)), ls, 1.4) * 1.25 + 0.08, 0.0, 1.0);
    vec2 bp = gl_FragCoord.xy; float tooth = gxN2(bp * 0.7) * 0.5 + gxN2(bp * 0.23) * 0.5;
    vec3 board = gxC0 * (0.94 + 0.12 * tooth);
    col = mix(mix(board, cc, clr * 0.75), gxC2, wht);
    if (isEye > 0.5) col = mix(board, gxC2, step(T, 0.45) * 0.8);
  } else if (K == 7) {
    // WASH (STYLE c4, GPU watercolour): the person's FLAT local colours laid as transparent washes (the paper through them), two cool
    // glazes for the shadow and its core with edges broken by a body-attached wobble (they ride the form; no screen noise), blooms
    // inside a wash, the lights of light colours left as paper; the composite adds edge darkening, granulation and the pencil line.
    // Writes TRANSMITTANCE (1 = paper), multiplied over the paper by the composite.
    float wb = (gxN3(P * 16.0) - 0.5) * gxP2.y + (gxN3(P * 47.0 + 2.0) - 0.5) * gxP2.y * 0.35, n2 = ndl + wb;
    float g1 = 1.0 - smoothstep(gxTone.x - gxTone.y, gxTone.x + gxTone.y, n2), g2 = 1.0 - smoothstep(gxP1.x - gxTone.y, gxP1.x + gxTone.y, n2);
    ls = mix(ls, lsA * 0.85, hairy);
    vec3 base = mix(vec3(1.0), clamp(mix(vec3(gxLuma(ls)), ls, 1.1), 0.0, 1.0), gxP1.y);
    base *= 1.0 + (gxN3(P * 5.0 + 9.0) - 0.5) * gxP2.z;                          // blooms (wet in wet), on the body
    vec3 glz = mix(vec3(1.0), gxC3, gxP1.z);
    col = base * mix(vec3(1.0), glz, g1) * mix(vec3(1.0), glz, g2 * 0.75);
    col = mix(col, vec3(1.0), smoothstep(0.72, 0.95, n2) * gxP1.w * smoothstep(0.4, 0.6, lv) * (1.0 - hairy));   // the lights left as paper
    {
      // WET: backruns (a blob where water ran back into a drying wash: the pigment pushed to its rim, the inside paler; the
      // composite's pooling darkens that rim), a darker second glaze in the core shadow, and the body's WET areas (alpha: 1 + wetness)
      // where the composite lets the washes bleed into each other; all on the body (they ride the form)
      float bn = gxN3(P * 9.0 + 11.0) * 0.7 + gxN3(P * 26.0 + 4.0) * 0.3, bloom = smoothstep(0.68, 0.71, bn) * step(gxCls, 1.5) * (1.0 - hairy) * (1.0 - face * 0.8);
      col = mix(col, mix(col, vec3(1.0), 0.42), bloom * gxEx.z);
      col *= mix(vec3(1.0), gxC3, g2 * 0.35 * gxEx.w);
      aOut = 1.0 + 0.99 * smoothstep(0.4, 0.62, gxN3(P * 2.6 + 7.0)) * (1.0 - face * 0.6);
    }
    if (isEye > 0.5) col = mix(vec3(0.95, 0.93, 0.9), gxC0, step(0.5, 1.0 - gxLuma(lsA)));
    if (gxCls > 1.5 && gxCls < 2.5) col += 2.0;                                   // hair marked (+2): one soft mass, no pooled edges at its cards
  } else if (K == 11) {
    // MURAL (STYLE c5, the GPU mural: Rivera, the WPA, the Mexican muralists): the person's local colour pulled toward an earth palette
    // (hue kept, saturation muted, warmed toward ochre); the volume modelled in THREE soft steps (shadow, half-tone, light) over a
    // wrapped light, so the forms round like a fresco's; warm lights, cool shadows; faces lifted and kept simple; a brush texture on the
    // body along the cross-contours (a painted field, never a mosaic: the texture moves the value a few per cent, never the step)
    vec3 hv = gxHSV(ls); hv.y = clamp(hv.y * gxP1.x, 0.0, 0.6); hv.x = mix(hv.x, 0.085, gxP1.y * (1.0 - smoothstep(0.25, 0.45, abs(hv.x - 0.085))));
    vec3 lc = gxRGB(hv);
    float wl = clamp((ndl + gxP1.z) / (1.0 + gxP1.z), 0.0, 1.0), sf = gxP1.w;
    float st = 0.4 * smoothstep(0.24 - sf, 0.24 + sf, wl) + 0.6 * smoothstep(0.62 - sf, 0.62 + sf, wl);
    st = max(st, refl * 0.5); st = mix(st, max(st, 0.5), face * 0.65 + hand * 0.4);
    vec3 m = lc * (gxTone.z + (1.0 - gxTone.z) * st) * mix(vec3(0.82, 0.86, 1.0), vec3(1.07, 1.0, 0.88), st);
    float ph = mix(dot(P, normalize(vec3(0.62, 1.0, 0.22))), pc, pur) + wob * 2.0, row = floor(ph / sp), fr = fract(ph / sp);
    float al = pa / (sp * 3.5) + gxH1(row) * 13.0, br = gxN2(vec2(fr * 5.0 + row * 3.1, al * 1.6)) - 0.5, side = 1.0 - smoothstep(0.0, 0.2, min(fr, 1.0 - fr));
    br = (gxN3(P * 38.0) - 0.5) * 0.6 + (gxN3(P * 11.0 + 5.0) - 0.5) * 0.8; br *= 1.0 - 0.6 * face; side = 0.0;   // a mottled, dragged paint, no rows (rows read as wood grain at 1:1)
    col = clamp(m * (1.0 + gxP2.x * br - gxP2.y * side), 0.0, 1.0);
    if (gxCls > 1.5 && gxCls < 2.5) col = clamp(lc * mix(0.55, 1.0, st) * (1.0 + gxP2.x * br), 0.0, 1.0);
    if (isEye > 0.5) col = mix(vec3(0.86, 0.82, 0.74), gxC0, step(0.5, 1.0 - gxLuma(lsA)));
  } else if (K == 9) { col = vec3(T, light, pur); } else if (K == 8) { col = ls; } else if (K == 10) { col = vec3(fract(pc / sp), fract(pa / sp), clamp(sp * 100.0, 0.0, 1.0)); }
  gl_FragColor = vec4(col, aOut);
}`;

// STYLE c6 (rev 7) THE LAYER RESOLVE, at the very end of the vertex main(): a skin or inner-garment shard poking a few mm through the cloth
// over it loses the depth test, in DEPTH ONLY (x, y and the key AOV's stored depth are the surface's own: lines and shapes do not move).
// Covered skin (and the underwear) back gxLayer.x m, not the face or the hands (STYLE c2's face / hand weights: a hand resting on a
// shirt stays over it); a garment back gxLayer.y m per rank below the outermost (gxRank; -1: the underwear, with the skin). Inert while
// gxLayer.x and .y are 0 (every c5 look, the lit render), and for an orthographic camera.
const VERT_LAYER = /* glsl */`
#ifndef USE_LOGDEPTHBUF
if ((gxLayer.x > 0.0 || gxLayer.y > 0.0) && projectionMatrix[2][3] < -0.5) {
  float gxB = 0.0;
  if (gxCls < 0.5) gxB = gxLayer.x * (1.0 - clamp(max(vDr1.y, vDr1.z) * 2.0, 0.0, 1.0));
  else if (gxCls < 1.5) gxB = gxRank < -0.5 ? gxLayer.x : gxLayer.y * gxRank;
  if (gxB > 0.0) { float gxZ = mvPosition.z - gxB; gl_Position.z = (projectionMatrix[2][2] * gxZ + projectionMatrix[3][2]) / (-gxZ) * gl_Position.w; }
}
#endif
`;
const toPatch = mt => mt && (mt.isMeshStandardMaterial || mt.isMeshPhysicalMaterial);
// install on one material, chained after whatever is there (lane E's and STYLE c2's draw patch first); own: per material
export function patchGraphic(mat, own) {
  if (!toPatch(mat) || mat.userData.graphic) return false;
  if (!mat.userData.draw) throw new Error('graphic: install STYLE c2 draw fields and patch first (installDraw)');
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.userData.graphic = { own };
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    Object.assign(sh.uniforms, GX_U, own);
    // after the draw patch's OUT (which follows #include <dithering_fragment>): ours is appended at the end of main
    // STYLE c5: a hair material (HAIR's card shading: vHair, vHUV, hAtlas) lets the designed hair read its groom (GX_HV); others never see it
    const hv = /varying vec4 vHair;/.test(sh.fragmentShader) && /uniform sampler2D hAtlas/.test(sh.fragmentShader);
    const fs = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + (hv ? '#define GX_HV\n' : '') + FRAG_PARS), k = fs.lastIndexOf('}');
    sh.fragmentShader = fs.slice(0, k) + OUT + '\n' + fs.slice(k);
    // STYLE c6 (rev 7): the layer resolve (inert at rest); gxRank, gxGrp: per material (own), 0 unless installGraphic gave them
    if (!('gxRank' in sh.uniforms)) sh.uniforms.gxRank = { value: 0 }; if (!('gxGrp' in sh.uniforms)) sh.uniforms.gxGrp = { value: 0 };
    if (!('gxNv' in sh.uniforms)) sh.uniforms.gxNv = { value: 0 };   // STYLE c6 it10: the notan's class shift (0 unless installGraphic gave one)
    const vs = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec4 gxLayer; uniform float gxCls, gxRank;'), kv = vs.lastIndexOf('}');
    sh.vertexShader = vs.slice(0, kv) + VERT_LAYER + vs.slice(kv);
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '|gx';
  mat.needsUpdate = true;
  return true;
}
