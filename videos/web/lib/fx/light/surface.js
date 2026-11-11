// LIGHT / surface: layered industrial materials with wear scaled in METRES (LIGHTING c1, critique W5 / L5).
//
// The look of weathered industry is a stack, not a colour plus noise. Bottom to top:
//   steel (bare, bright where worn) -> mill scale -> primer (red oxide or grey) -> topcoat (chalks and fades with age on the
//   faces the sun sees) -> WEAR through the topcoat to primer, and through the primer to metal (chips 1-5 cm clustered on
//   convex edges and at hand height, hard-edged) -> RUST on bare metal, blooming under the paint as blisters, running DOWN
//   from lips, seams and fasteners, ageing orange -> brown -> umber -> GRIME in cavities and rising from the ground, OIL as
//   dark low-roughness films -> DUST on up-facing faces -> WET (Lagarde 2013: porous layers darken, roughness falls).
// Every layer sets its own roughness: photographic metal is read through roughness breakup, not albedo.
// Edge and cavity come from (a) the MODELING bake in vertex colour (r = AO, g = convex edge) for catalogued assets, or
// (b) analytic box edges (boxGeometry() carries each box's local position and half size), or (c) nothing (noise only).
// Detail finer than a pixel fades to its mean (footprint from fwidth), so a chip does not alias into sparkle at 270 px.
// The same functions drive concrete (pour lifts, aggregate, cracks, oil stains, puddles by height) and glass (Fresnel to
// the physical sky; grime at the sill). All of it is a pure function of world position: a still and the movie agree.
import * as THREE from 'three';
import { litPatch } from './patch.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const NOISE = /* glsl */`
float sh31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float svn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sh31(i), sh31(i + vec3(1,0,0)), f.x), mix(sh31(i + vec3(0,1,0)), sh31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(sh31(i + vec3(0,0,1)), sh31(i + vec3(1,0,1)), f.x), mix(sh31(i + vec3(0,1,1)), sh31(i + vec3(1,1,1)), f.x), f.y), f.z); }
float sfbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * svn(p); p = p * 2.03 + 1.7; a *= 0.5; } return s / 0.9375; }
// noise at a scale (m), faded to its mean once a pixel covers more than ~a cell
float snoise(vec3 P, float scale, float fw){ return mix(svn(P / scale), 0.5, smoothstep(0.35, 1.2, fw / scale)); }
float sfbmA(vec3 P, float scale, float fw){ return mix(sfbm(P / scale), 0.5, smoothstep(0.5, 2.0, fw / scale)); }
// an anti-aliased step: hard edge when the footprint is small, soft when it is large
float sstepA(float e, float x, float w){ return smoothstep(e - w, e + w, x); }
float slum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

const VERT_DECL = `varying vec3 vSP; varying vec3 vSN; varying vec3 vOP; varying vec3 vON;
#ifdef S_BOX
attribute vec3 aLP; attribute vec3 aHS; attribute vec3 aLN; varying vec3 vLP; varying vec3 vHS; varying vec3 vLN;
#endif
#ifdef S_ERECT
attribute vec4 aStage; attribute vec4 aPlate; attribute float aEdge; attribute float aAO; attribute float aRand; attribute float aRest;
varying vec4 vStage; varying vec4 vPlate; varying float vEdge; varying float vAOx; varying float vRand; varying float vRestY;
uniform float uBuild; uniform float uDropW; uniform float uDropH;
#endif`;
// the ERECTOR build (MODELING c4): a piece appears at its threshold and drops the last metres in from the hook
const ERECT_BUILD = `#ifdef S_ERECT
  vStage = aStage; vPlate = aPlate; vEdge = aEdge; vAOx = aAO; vRand = aRand; vRestY = aRest;
  { float bAge_ = uBuild - aStage.x;
    if (bAge_ < 0.0) transformed = vec3(0.0, -1.0e4, 0.0);
    else { float k_ = clamp(bAge_ / uDropW, 0.0, 1.0); transformed.y += (1.0 - k_ * k_ * (3.0 - 2.0 * k_)) * uDropH * aStage.w; } }
#endif`;
const VERT_BODY = `{ vec4 wp = vec4(transformed, 1.0); vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp; wn = mat3(instanceMatrix) * wn;
  #endif
  vOP = wp.xyz; vON = wn;
  vSP = (modelMatrix * wp).xyz; vSN = normalize(mat3(modelMatrix) * wn);
  #ifdef S_BOX
    vLP = aLP; vHS = aHS; vLN = aLN;
  #endif
}`;

// ---------------------------------------------------------------- weathered paint over primer over steel (ONE steel: c1 + MODELING c4)
// LIGHTING c2 merged MODELING c4's ERECTOR stack (modeling/erect/steel.js) into this one. What came from where:
//   c1   the layer order, metre-scaled wear, rust ageing, grime rising from the ground, oil films, dust, Lagarde wet, footprint
//        fade, box edges from geometry
//   c4   wear placed by CAUSE: per-piece use (aStage.z), rust runs that start at plate laps and rivet rows and run down,
//        cavity grime from the designed occlusion, mud thrown up to a rest height, oil weeping round the bearings (a world
//        list updated per frame), snow on what faces up in the rest pose, rivets, the build dissolve and the red-lead front
//   c2   chips are FLAKES: cells of a domain-warped Worley field on the face's own plane, three sizes, each cell on or off by
//        how much use that spot gets (so they come in clusters, with ragged rounded outlines, big and small), instead of a
//        threshold on grid noise (square, the same everywhere). Edge wear is broken into knocked STRETCHES, never a uniform
//        outline. Use comes from named causes: edges, hand height, the kick band (boots, forks, chains), foot traffic on
//        decks, cavities that hold water, and up to six use points (where a hook bangs, a ladder rubs).
//        Noise runs in OBJECT space when the define S_OBJ is set (anything that moves: the giant, a truck) so wear never swims.
const STEEL_FRAG = /* glsl */`
varying vec3 vSP; varying vec3 vSN; varying vec3 vOP; varying vec3 vON;
#ifdef S_BOX
varying vec3 vLP; varying vec3 vHS; varying vec3 vLN;
#endif
#ifdef S_ERECT
varying vec4 vStage; varying vec4 vPlate; varying float vEdge; varying float vAOx; varying float vRand; varying float vRestY;
uniform float uBuild; uniform vec4 uOil[16]; uniform float uSnow, uMudH;
#endif
uniform vec3 sTop, sPrimer, sBare, sScale, sRustA, sRustB, sRustC, sGrime, sDust, sMud, sSnowC;
uniform vec4 sP1;  // chip size (m), wear, rust, streak length (m)
uniform vec4 sP2;  // grime, grime height (m), ground y, dust
uniform vec4 sP3;  // topcoat roughness, primer roughness, wet, age
uniform vec4 sP4;  // oil, blisters, handling (hand-height scuffs), bump
uniform vec4 sP5;  // edge width (m) for analytic box edges, paint coverage (1 painted .. 0 bare), foot traffic, kick band
uniform vec4 sP6;  // tone (panel variation), rivets, rivet radius (m), rivet pitch (m)
uniform vec4 sP7;  // topcoat metalness, bare metalness, snow, ao strength (indirect)
uniform vec4 sUse[6];
float sRough = 0.5, sMetal = 0.0, sH = 0.0, sAOi = 1.0, sBareK = 0.0;
vec2 sh22(vec2 p){ vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
// distance to the cell border (F2 - F1, the polygon outline) and the cell's id on a 2D Worley field
vec3 sworley(vec2 x){ vec2 i = floor(x), f = fract(x); float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int xx = -1; xx <= 1; xx++) { vec2 g = vec2(float(xx), float(y)), r = g + sh22(i + g) - f; float dd = dot(r, r);
    if (dd < d1) { d2 = d1; d1 = dd; id = i + g; } else if (dd < d2) d2 = dd; }
  return vec3(sqrt(d2) - sqrt(d1), id); }
// flakes of one size: x = through the topcoat, y = through the primer too. A flake is a whole Worley CELL shrunk from its
// border (a polygon: paint lets go along the crack network, not in round dots), its outline torn by a domain warp; the
// deeper hole is the cell's middle, on half the flakes. Cells switch on by use and by a cluster field (flaking spreads from
// a first failure), so it comes in patches of many flakes of mixed size, and the next panel can be clean.
vec2 sChips(vec2 q, float size, float dens, float fw, float seed){
  vec2 x = q / size;
  x += 0.6 * vec2(svn(vec3(x * 0.5, seed)), svn(vec3(x * 0.5 + 5.2, seed))) - 0.3;
  x += 0.22 * vec2(svn(vec3(x * 3.3, seed + 2.0)), svn(vec3(x * 3.3 + 1.7, seed + 2.0))) - 0.11;
  vec3 w = sworley(x); vec2 r = sh22(w.yz + seed * 7.31);
  float clus = smoothstep(0.32, 0.72, svn(vec3(w.yz * 0.23, seed * 3.0)));
  float on = step(r.x, dens * (0.35 + 1.1 * clus)), gap = 0.05 + 0.3 * r.y * r.y, aa = clamp(fw / size * 1.2, 0.01, 0.4);
  float c = on * smoothstep(gap - aa, gap + aa, w.x);
  float deep = on * step(0.72, r.y) * smoothstep(gap * 2.2 + 0.12 - aa, gap * 2.2 + 0.12 + aa, w.x);
  float far = smoothstep(0.3, 0.9, fw / size);
  return mix(vec2(c, deep), vec2(dens * 0.35, dens * 0.05), far);
}
float sDome(vec2 q, float r){ return sqrt(max(0.0, r * r - dot(q, q))) / r; }
float sRivets(vec4 P, float r, float p){
  if (P.z <= 0.0) return 0.0;
  float ins = max(r * 2.2, min(.14, P.z * .3)), h = 0.0, a = P.x, cx = (floor(a / p) + .5) * p;
  if (P.w > .5 || P.z < .7) { h = max(h, sDome(vec2(a - cx, P.y - ins), r)); h = max(h, sDome(vec2(a - cx, P.y - (P.w - ins)), r)); }
  if (P.z >= .7) { float b = P.y, cy = (floor(b / p) + .5) * p; h = max(h, sDome(vec2(P.x - ins, b - cy), r)); h = max(h, sDome(vec2(P.x - (P.z - ins), b - cy), r)); }
  return h;
}
void steelLayers(inout vec3 col){
  #ifdef S_OBJ
    vec3 P = vOP, NO = normalize(vON);
  #else
    vec3 P = vSP, NO = normalize(vSN);
  #endif
  vec3 N = normalize(vSN); float fw = max(length(fwidth(P)), 1e-5);
  float hgt = vSP.y - sP2.z;
  float ao = 1.0, edge = 0.0, pieceUse = 1.0, painted = 1.0;
  #ifdef S_BAKED
    ao = vColor.r; edge = vColor.g;
  #endif
  #ifdef S_ERECT
    ao = vAOx; edge = vEdge; pieceUse = 0.35 + 1.3 * vStage.z; painted = vStage.y < 0.0 ? 1.0 : step(vStage.y, uBuild); hgt = vRestY;
    if (vPlate.z > 0.0) { float de = min(min(vPlate.x, vPlate.z - vPlate.x), min(vPlate.y, vPlate.w - vPlate.y)); edge = max(edge, 1.0 - smoothstep(0.0, 0.09, de)); }
  #endif
  #ifdef S_BOX
    { vec3 d = vHS - abs(vLP); vec3 an = abs(vLN);
      float e = an.x > 0.5 ? min(d.y, d.z) : an.y > 0.5 ? min(d.x, d.z) : min(d.x, d.y);
      edge = max(edge, (1.0 - smoothstep(0.0, sP5.x, e)) * clamp(sP5.x * 1.5 / fw, 0.0, 1.0)); }
  #endif
  float chip = sP1.x, wear = sP1.y, rustA = sP1.z, sLen = sP1.w, age = sP3.w;
  float big = sfbm(P * 0.45), mid = sfbmA(P, 0.35, fw);
  // ---- USE: where paint gets knocked, rubbed and walked off
  float knocks = smoothstep(0.42, 0.62, sfbm(P * 0.7 + 2.3) + 0.2 * (mid - 0.5));       // stretches of edge that got hit, others intact
  float uEdge = edge * mix(0.15, 1.0, knocks);
  float uHand = sP4.z * smoothstep(0.7, 0.95, hgt) * (1.0 - smoothstep(1.65, 1.95, hgt));
  float uKick = sP5.w * (1.0 - smoothstep(0.2, 0.55, hgt)) * (1.0 - smoothstep(0.6, 0.95, abs(N.y)));
  float uWalk = sP5.z * smoothstep(0.85, 0.97, N.y) * smoothstep(0.35, 0.75, sfbm(vec3(P.x * 0.9, 0.0, P.z * 0.35) + 4.0));
  float uPts = 0.0; for (int i = 0; i < 6; i++) { float r = sUse[i].w; if (r > 0.0) uPts = max(uPts, 1.0 - smoothstep(r * 0.3, r, distance(P, sUse[i].xyz))); }
  float uCav = (1.0 - ao) * 0.35;
  float field = clamp(uEdge * 1.15 + uHand * 0.6 + uKick * 0.8 + uWalk * 0.5 + uPts * 1.2 + uCav + (big - 0.5) * 0.25, 0.0, 1.6) * wear * pieceUse;
  float dens = clamp(field * 0.5, 0.0, 0.85);
  // ---- FLAKES on the face's own plane, three sizes
  vec3 an = abs(NO); vec2 q = an.x > an.y && an.x > an.z ? P.zy : an.y > an.z ? P.xz : P.xy;
  vec2 c1 = sChips(q, chip, dens, fw, 1.0), c2 = sChips(q + 17.0, chip * 2.8, dens * 0.55, fw, 7.0), c3 = sChips(q + 41.0, chip * 0.42, dens * 0.8, fw, 3.0);
  float w1 = max(max(c1.x, c2.x), c3.x * 0.9), w2 = max(max(c1.y, c2.y), c3.y * 0.6);
  #ifdef S_OLDCHIPS
  { float cn = sfbmA(P + 3.1, chip, fw), cw = max(fwidth(cn) * 1.5, 0.02), pr = clamp(field, 0.0, 1.6);   // LIGHTING c1's chips, kept for A/B
    w1 = sstepA(0.98 - 0.36 * pr, cn, cw); w2 = sstepA(1.06 - 0.3 * pr, cn, cw); }
  #endif
  // walked decks wear through in a lane, not in flakes; the kick band takes horizontal scuffs
  float lane = smoothstep(0.55, 0.85, uWalk * wear + (mid - 0.5) * 0.4); w1 = max(w1, lane); w2 = max(w2, lane * smoothstep(0.75, 1.0, uWalk * wear + (mid - 0.5) * 0.3));
  float scuff = uKick * wear * smoothstep(0.55, 0.72, snoise(vec3(P.x * 0.6, P.y * 30.0, P.z * 0.6) + 3.0, 1.0, fw * 8.0));
  w1 *= sP5.y; w2 = max(w2 * sP5.y, sstepA(sP5.y, sfbmA(P + 8.0, 0.3, fw) * 0.6 + 0.2, 0.05));
  // ---- RUST: bare metal, blisters under the film, runs DOWN from edges, cavities, laps and rivet rows
  float streak = sfbm(vec3(P.x * 6.0, P.y * 6.0 / max(sLen, 0.2), P.z * 6.0));
  float source = clamp((1.0 - ao) * 1.6 + uEdge * 0.8 + w2 * 0.6, 0.0, 1.0);
  float runs = rustA * smoothstep(0.52, 0.75, streak) * source;
  #ifdef S_ERECT
  if (vPlate.z > 0.0) {
    float dn = vPlate.w - .12 - vPlate.y, sc = snoise(vec3(vPlate.x * 2.7 + vRand * 31.0, 0.0, 1.3), 1.0, 0.0), sc2 = snoise(vec3(vPlate.x * 9.0 + vRand * 7.0, 3.0, 0.0), 1.0, 0.0);
    float len = .4 + 2.6 * sc2, run = smoothstep(.55, .75, sc) * step(0.0, dn) * exp(-dn / len) * (.4 + 1.2 * vRand);
    float cx = (floor(vPlate.x / sP6.w) + .5) * sP6.w, dx = abs(vPlate.x - cx);
    float rr = step(0.0, dn) * (1.0 - smoothstep(.015, .05, dx)) * exp(-dn / (.3 + 1.4 * sc2)) * step(.5, fract(cx * 7.13 + vRand * 3.7)) * .8;
    runs = max(runs, rustA * clamp(run + rr, 0.0, 1.0) * 0.8);
  }
  #endif
  float bl = sP4.y * smoothstep(0.7, 0.78, snoise(P + 11.0, chip * 1.4, fw)) * (1.0 - w2) * smoothstep(0.3, 0.7, big + rustA * 0.3);
  float rustM = clamp(w2 * (0.35 + 0.9 * rustA) * (0.6 + 0.8 * snoise(P + 5.0, chip * 0.6, fw)) + runs * 0.75 + bl * 0.85, 0.0, 1.0);
  float ra = snoise(P + 21.0, 0.18, fw), rb = sfbmA(P + 9.0, 0.6, fw);
  vec3 rustC = mix(mix(sRustA, sRustB, smoothstep(0.3, 0.7, ra)), sRustC, smoothstep(0.45, 0.8, rb) * (0.4 + 0.6 * age));
  // ---- TOPCOAT: panel tone, chalking and fading on the faces the weather sees; red lead where not yet painted (the build front)
  float tone = sP6.x;
  #ifdef S_ERECT
    vec3 top = mix(sPrimer, sTop, painted) * ((1.0 - tone * .5) + tone * (big * 0.6 + mid * 0.4) + tone * .3 * (vRand - .5));
  #else
    vec3 top = sTop * (1.0 - tone * 0.5 + tone * big);
  #endif
  float chalk = age * (0.25 + 0.35 * max(N.y, 0.0)) * (0.6 + 0.4 * mid);
  top = mix(top, vec3(slum(top)) * 1.08 + 0.03, chalk * 0.55);
  col = top; float r = mix(sP3.y, sP3.x, painted) + chalk * 0.3 + (mid - 0.5) * 0.08; float m = sP7.x;
  vec3 bare = mix(sScale, sBare, smoothstep(0.4, 0.8, snoise(P, 0.25, fw)) * 0.6 + edge * 0.4);
  col = mix(col, sPrimer * (0.92 + 0.16 * mid), w1 * painted); r = mix(r, sP3.y, w1 * painted);
  col = mix(col, bare, w2); r = mix(r, 0.32 + 0.25 * mid, w2); m = mix(m, sP7.y, w2); sBareK = w2;
  col *= 1.0 - 0.22 * scuff; r = mix(r, r * 0.7, scuff);
  // rivets: a dark ring and a lit crown, faded before they alias
  #ifdef S_ERECT
  { float rv = sP6.y * sRivets(vPlate, sP6.z, sP6.w) * (1.0 - smoothstep(sP6.z * .45, sP6.z * 1.3, fw));
    col *= 1.0 - .18 * smoothstep(.0, .35, rv) * (1.0 - smoothstep(.35, .8, rv)); col *= 1.0 + .18 * smoothstep(.75, 1.0, rv); sH += rv * .004; }
  #endif
  col = mix(col, rustC, rustM); r = mix(r, 0.82 + 0.12 * ra, rustM); m *= 1.0 - rustM;
  // ---- GRIME in cavities and rising from the ground; MUD thrown up to a height; OIL films and weeping bearings
  float gh = clamp(1.0 - hgt / max(sP2.y, 1e-3), 0.0, 1.0);
  float gr = sP2.x * clamp((1.0 - ao) * 1.4 + gh * gh * (0.55 + 0.45 * sfbm(vec3(P.x * 3.0, P.y * 0.5, P.z * 3.0))) + runs * 0.4, 0.0, 1.0);
  col = mix(col, sGrime, gr * 0.85); r = mix(r, mix(0.85, 0.28, sP4.x), gr); m *= 1.0 - gr * 0.7;
  #ifdef S_ERECT
  { float mud = (1.0 - smoothstep(0.0, uMudH, hgt + (big - .5) * 3.0)) * smoothstep(.35, .55, mid + .25);
    col = mix(col, sMud * (.8 + .4 * big), clamp(mud, 0.0, 1.0) * sP2.x * .9); r = mix(r, .95, mud * sP2.x);
    float oil = 0.0;
    for (int i = 0; i < 16; i++) { vec3 d = vSP - uOil[i].xyz; d.y *= d.y > 0.0 ? 2.2 : .42; float qq = length(d) / uOil[i].w; oil = max(oil, 1.0 - smoothstep(.45, 1.0, qq + (mid - .5) * .5)); }
    oil *= sP4.x; col *= mix(1.0, .42, oil); r = mix(r, .2, oil); }
  #else
  { float oil = sP4.x * smoothstep(0.55, 0.75, sfbmA(P * vec3(1.0, 0.4, 1.0) + 2.0, 0.5, fw)) * (0.4 + 0.6 * gh);
    col = mix(col, col * 0.35, oil); r = mix(r, 0.12, oil); }
  #endif
  // ---- DUST and SNOW on what faces up
  float du = sP2.w * smoothstep(0.5, 0.9, N.y) * (0.55 + 0.45 * sfbmA(P, 0.4, fw));
  col = mix(col, sDust, du); r = mix(r, 0.95, du); m *= 1.0 - du;
  float snowA = sP7.z;
  #ifdef S_ERECT
    snowA *= uSnow;
  #endif
  if (snowA > 0.0) { float sn = smoothstep(.55, .9, NO.y) * smoothstep(.42, .62, big * .7 + mid * .3 + snowA * .45 - .05) * snowA;
    col = mix(col, sSnowC * (.92 + .1 * mid), sn); r = mix(r, .92, sn); m *= 1.0 - sn; sH += sn * 0.002; }
  // ---- WET (Lagarde): porous layers darken; every layer's roughness falls; up faces hold a film
  float wet = sP3.z, por = clamp(rustM + gr + du + w1 * 0.4, 0.0, 1.0);
  col *= mix(1.0, 0.5, wet * por);
  r = mix(r, mix(0.25, 0.06, smoothstep(0.4, 0.95, N.y)), wet * 0.85);
  // height (metres) for the bump: paint film steps at flake edges, blisters, rust pitting
  sH += sP4.w * ((1.0 - w1) * 0.00035 + (1.0 - w2) * 0.0002 + bl * 0.0012 + rustM * 0.0005 * snoise(P, 0.004, fw));
  sRough = clamp(r, 0.04, 1.0); sMetal = m; sAOi = ao;
}
vec3 sBump(vec3 n){
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx); float det = dot(sx, r1);
  vec3 g = sign(det) * (dFdx(sH) * r1 + dFdy(sH) * r2), b = abs(det) * n - g;
  return dot(b, b) > 1e-24 && !any(isnan(b)) ? normalize(b) : n;
}
`;

// ---------------------------------------------------------------- concrete (and asphalt, compacted ground)
const CONCRETE_FRAG = /* glsl */`
varying vec3 vSP; varying vec3 vSN;
uniform vec3 sBase, sStain, sDirt;
uniform vec4 sC1;  // joint spacing (m), crack amount, oil stains, dirt
uniform vec4 sC2;  // wet (0..1), puddles (0..1: share of ground under water), aggregate, tyre-marks
uniform vec4 sC3;  // roughness, ripple, puddle level bias, unused
float sRough = 0.8, sMetal = 0.0, sH = 0.0, sWater = 0.0;
void concreteLayers(inout vec3 col){
  vec3 P = vSP; float fw = max(length(fwidth(P)), 1e-5);
  float big = sfbm(P * 0.12), pour = sfbm(P * 0.6 + 4.0), mid = sfbmA(P, 0.25, fw), agg = snoise(P, 0.006, fw);
  col = sBase * (0.8 + 0.3 * big + 0.12 * (pour - 0.5)) * (1.0 + sC2.z * 0.25 * (agg - 0.5));
  float r = sC3.x + 0.1 * (mid - 0.5);
  // saw-cut joints every sC1.x m (dark, slightly rough), cracks as thin noise ridges
  vec2 jq = abs(fract(P.xz / sC1.x + 0.5) - 0.5) * sC1.x; float jd = min(jq.x, jq.y);
  float joint = 1.0 - smoothstep(0.004, 0.004 + fw, jd);
  float cr = abs(sfbm(P * vec3(0.9, 0.0, 0.9) * 0.9) - 0.5); float crack = sC1.y * (1.0 - smoothstep(0.0015, 0.0025 + fw * 0.4, cr * 0.25)) * smoothstep(0.45, 0.6, sfbm(P * 0.3 + 7.0)) * clamp(0.01 / fw, 0.2, 1.0);
  col *= 1.0 - 0.6 * max(joint, crack);
  // oil stains (dark, lower roughness) and dirt drifts
  float oil = sC1.z * smoothstep(0.58, 0.72, sfbm(P * 0.35 + 9.0)) * (0.6 + 0.4 * mid);
  col = mix(col, sStain, oil * 0.85); r = mix(r, 0.35, oil);
  float dirt = sC1.w * smoothstep(0.45, 0.8, sfbm(P * 0.18 + 2.0)) * (0.5 + 0.5 * mid);
  col = mix(col, sDirt, dirt); r = mix(r, 0.95, dirt);
  // tyre tracks: two parallel bands along z (a yard lane), darker and polished
  float tr = sC2.w * (1.0 - smoothstep(0.25, 0.45, abs(abs(P.x - 6.0) - 1.0))) * (0.5 + 0.5 * mid);
  col *= 1.0 - 0.25 * tr; r = mix(r, r * 0.75, tr);
  // wet (Lagarde): porous darkening, then water fills the low spots (height from low-frequency noise)
  float wet = sC2.x, ht = sfbm(P * 0.16 + 13.0) + 0.12 * mid - (1.0 - joint) * 0.0 - joint * 0.08;
  float level = mix(0.0, 0.62, sC2.y) + sC3.z;
  float water = sC2.y * smoothstep(level, level - 0.03 - fw * 0.02, ht);
  col *= mix(1.0, 0.45, wet * 0.9);
  r = mix(r, 0.18, wet * 0.7);
  col = mix(col, col * 0.7, water); r = mix(r, 0.02, water);
  sWater = water;
  sH = (1.0 - water) * (0.0006 * agg * (1.0 - wet * 0.5) - 0.004 * max(joint, crack)) + water * sC3.y * 0.0008 * svn(P * 12.0);
  sRough = clamp(r, 0.02, 1.0); sMetal = 0.0;
}
vec3 sBump(vec3 n){
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx); float det = dot(sx, r1);
  vec3 g = sign(det) * (dFdx(sH) * r1 + dFdy(sH) * r2), b = abs(det) * n - g;
  return dot(b, b) > 1e-24 && !any(isnan(b)) ? normalize(b) : n;
}
`;

const C = h => new THREE.Color(h);
const lin = h => { const c = new THREE.Color(h); return new THREE.Vector3(c.r, c.g, c.b); };   // three converts hex sRGB -> linear

function build(kind, spec) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, envMapIntensity: spec.env ?? 1, side: spec.side ?? THREE.FrontSide });
  if (spec.baked) m.vertexColors = true;
  const E = spec.erect || null;   // MODELING c4 shared uniforms (sharedUniforms()): the giant's build, oil list, snow, mud height
  m.defines = { ...(spec.baked ? { S_BAKED: '' } : {}), ...(spec.box ? { S_BOX: '' } : {}), ...(E ? { S_ERECT: '' } : {}), ...(spec.object || E ? { S_OBJ: '' } : {}), ...(spec.oldChips ? { S_OLDCHIPS: '' } : {}) };
  const u = m.userData.su = {};
  if (kind === 'steel') {
    const use = Array.from({ length: 6 }, (_, i) => { const p = spec.use?.[i]; return new THREE.Vector4(p?.[0] ?? 0, p?.[1] ?? 0, p?.[2] ?? 0, p?.[3] ?? 0); });
    Object.assign(u, {
      sTop: { value: lin(spec.top ?? 0xc9a227) }, sPrimer: { value: lin(spec.primer ?? 0x7a3322) }, sBare: { value: lin(spec.bare ?? 0x8c8f92) }, sScale: { value: lin(spec.scale ?? 0x2b2d30) },
      sRustA: { value: lin(spec.rustA ?? 0xa4501c) }, sRustB: { value: lin(spec.rustB ?? 0x6a3317) }, sRustC: { value: lin(spec.rustC ?? 0x2e1a10) }, sGrime: { value: lin(spec.grimeC ?? 0x1c1915) }, sDust: { value: lin(spec.dustC ?? 0x8a8170) },
      sMud: { value: lin(spec.mudC ?? 0x4a4036) }, sSnowC: { value: lin(spec.snowC ?? 0xe9ecee) },
      sP1: { value: new THREE.Vector4(spec.chip ?? 0.025, spec.wear ?? 0.6, spec.rust ?? 0.4, spec.streak ?? 1.2) },
      sP2: { value: new THREE.Vector4(spec.grime ?? 0.35, spec.grimeH ?? 1.2, spec.ground ?? 0, spec.dust ?? 0.2) },
      sP3: { value: new THREE.Vector4(spec.rough ?? 0.42, spec.primerRough ?? 0.72, spec.wet ?? 0, spec.age ?? 0.5) },
      sP4: { value: new THREE.Vector4(spec.oil ?? 0, spec.blisters ?? 0.4, spec.handling ?? 0, spec.bump ?? 1) },
      sP5: { value: new THREE.Vector4(spec.edgeW ?? 0.018, spec.coverage ?? 1, spec.traffic ?? 0, spec.kick ?? 0) },
      sP6: { value: new THREE.Vector4(spec.tone ?? 0.24, spec.rivets ?? 0, spec.rivR ?? 0.07, spec.rivP ?? 0.42) },
      sP7: { value: new THREE.Vector4(spec.metal ?? 0, spec.metalBare ?? 0.85, spec.snow ?? 0, spec.aoStr ?? (E || spec.baked ? 0.9 : 0)) },
      sUse: { value: use },
    });
    if (E) Object.assign(u, { uBuild: E.uBuild, uDropW: E.uDropW, uDropH: E.uDropH, uOil: E.uOil, uSnow: E.uSnow, uMudH: E.uMudH });
  } else {
    Object.assign(u, {
      sBase: { value: lin(spec.base ?? 0x8f8b82) }, sStain: { value: lin(spec.stain ?? 0x1d1b18) }, sDirt: { value: lin(spec.dirtC ?? 0x5d5244) },
      sC1: { value: new THREE.Vector4(spec.joint ?? 6, spec.cracks ?? 0.5, spec.oil ?? 0.4, spec.dirt ?? 0.4) },
      sC2: { value: new THREE.Vector4(spec.wet ?? 0, spec.puddles ?? 0, spec.aggregate ?? 1, spec.tracks ?? 0) },
      sC3: { value: new THREE.Vector4(spec.rough ?? 0.82, spec.ripple ?? 0, spec.level ?? 0, 0) },
    });
  }
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_DECL).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + ERECT_BUILD).replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + VERT_BODY);
    const F = kind === 'steel' ? STEEL_FRAG : CONCRETE_FRAG, fn = kind === 'steel' ? 'steelLayers' : 'concreteLayers';
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', NOISE + F + '\nvoid main() {')
      .replace('#include <color_fragment>', `#include <color_fragment>\n ${fn}(diffuseColor.rgb);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = sRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = sMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = sBump(normal);');
    if (kind === 'steel') sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', '#include <aomap_fragment>\n { float a_ = mix(1.0, sAOi, sP7.w); reflectedLight.indirectDiffuse *= a_; reflectedLight.indirectSpecular *= mix(a_, 1.0, sBareK * 0.5); reflectedLight.directDiffuse *= mix(1.0, a_, 0.3 * sP7.w); }');
  };
  m.customProgramCacheKey = () => kind + 'c2' + (spec.baked ? 'B' : '') + (spec.box ? 'X' : '') + (E ? 'E' : '') + (spec.object ? 'O' : '') + (spec.oldChips ? 'C' : '');
  m.name = spec.name || kind;
  if (E) m.userData.depth = erectDepth(E);
  return litPatch(m, { planar: !!spec.planar, ssr: !!spec.ssr });
}
// the ERECTOR build for the shadow (depth) pass: a mesh gets it as customDepthMaterial (members.js Batch does this)
const _depthCache = new WeakMap();
export function erectDepth(U) {
  if (_depthCache.has(U)) return _depthCache.get(U);
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = sh => { Object.assign(sh.uniforms, { uBuild: U.uBuild, uDropW: U.uDropW, uDropH: U.uDropH });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aStage; uniform float uBuild; uniform float uDropW; uniform float uDropH;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { float bAge_ = uBuild - aStage.x; if (bAge_ < 0.0) transformed = vec3(0.0, -1.0e4, 0.0); else { float k_ = clamp(bAge_ / uDropW, 0.0, 1.0); transformed.y += (1.0 - k_ * k_ * (3.0 - 2.0 * k_)) * uDropH * aStage.w; } }`); };
  m.customProgramCacheKey = () => 'erect-depth-c2'; _depthCache.set(U, m); return m;
}

export const steelMaterial = (spec = {}) => build('steel', spec);
// MODELING c4's stackMaterial() options, mapped onto the one steel (c2). U: erect sharedUniforms(). Same names, same meaning:
//   coat primer bare mud rust snow  wear grime rustAmt rivets rivR rivP rough spec roughPrimer metal metalBare oil tone aoStr env name
// plus anything steelMaterial takes (handling, kick, traffic, use points, wet, dust, chip size...).
export function erectSteel(U, o = {}) {
  const hex = c => c == null ? undefined : (typeof c === 'string' ? new THREE.Color(c).getHex() : c);
  return build('steel', {
    erect: U, top: hex(o.coat ?? '#3b3c3a'), primer: hex(o.primer ?? '#a8442a'), bare: hex(o.bare ?? '#6b6a66'), scale: hex(o.bare ?? '#3a3936'), mudC: hex(o.mud ?? '#4a4036'),
    rustA: hex(o.rust ?? '#7a3d1c'), rustB: hex(o.rust ?? '#6a3519'), rustC: 0x2a1a12, snowC: hex(o.snow ?? '#e9ecee'),
    wear: (o.wear ?? 1) * 0.9, grime: (o.grime ?? 1) * 0.55, grimeH: 0.01, rust: (o.rustAmt ?? 0.6), streak: 1.6, chip: o.chip ?? 0.045, rivets: o.rivets ?? 1, rivR: o.rivR ?? 0.07, rivP: o.rivP ?? 0.42,
    rough: o.rough ?? 0.58, primerRough: o.roughPrimer ?? 0.82, metal: o.metal ?? 0.18, metalBare: o.metalBare ?? 0.65, oil: o.oil ?? 1, tone: o.tone ?? 0.35, aoStr: o.aoStr ?? 0.9,
    env: o.env ?? 0.9, snow: 1, age: 0.55, blisters: 0.3, dust: 0.05, edgeW: 0.02, kick: 0.6, handling: 0, coverage: 1, name: o.name || 'steel', ...o.light,
  });
}
export const concreteMaterial = (spec = {}) => build('concrete', spec);
// set a layer value live (e.g. wet over time): mat.userData.su.sP3.value.z = 0.8
export function setSurface(m, key, comp, v) { const u = m.userData.su?.[key]; if (u) { if (comp == null) u.value = v; else u.value[comp] = v; } }

// glass: a dielectric (F0 0.04) that reflects the physical sky; dirt and a sill line of grime; optional interior tint
export function glassMaterial({ tint = 0x1a1f22, dirt = 0.3, rough = 0.04, env = 1.0 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color: tint, roughness: rough, metalness: 0, envMapIntensity: env, ior: 1.52, specularIntensity: 1, clearcoat: 0 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSP;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vSP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSP;\n' + NOISE)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n { float d = ${dirt.toFixed(3)} * (smoothstep(0.55, 0.8, sfbm(vSP * vec3(2.0, 0.6, 2.0))) * 0.6 + 0.4 * sfbm(vSP * 9.0)); roughnessFactor = mix(roughnessFactor, 0.55, d); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.14, 0.12), d * 0.6); }`);
  };
  m.customProgramCacheKey = () => 'glass' + dirt;
  return litPatch(m);
}
// oil: a dark film on steel or concrete with thin-film interference (three's iridescence; thickness from noise)
export function oilMaterial({ base = 0x121110, rough = 0.12, thickness = [260, 720] } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), id = g.createImageData(256, 256);
  let s = 11; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; const pts = Array.from({ length: 24 }, () => [r() * 256, r() * 256, 20 + r() * 70]);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { let v = 0; for (const [px, py, pr] of pts) { const dx = Math.min(Math.abs(x - px), 256 - Math.abs(x - px)), dy = Math.min(Math.abs(y - py), 256 - Math.abs(y - py)); v += Math.exp(-(dx * dx + dy * dy) / (pr * pr)); } const k = (y * 256 + x) * 4, q = Math.round(255 * (0.5 + 0.5 * Math.sin(v * 4.0))); id.data[k] = 0; id.data[k + 1] = q; id.data[k + 2] = 0; id.data[k + 3] = 255; }
  g.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshPhysicalMaterial({ color: base, roughness: rough, metalness: 0.0, iridescence: 1, iridescenceIOR: 1.33, iridescenceThicknessRange: thickness, iridescenceThicknessMap: t, specularIntensity: 1, ior: 1.6 });   // c2: no clearcoat over the film (it hid the colours)
  return litPatch(m);
}

// (c2) a spill's outline: a flat shape whose radius wanders (two harmonics of noise + lobes), not a disc. Lies in the xz plane.
export function oilPoolGeometry(radius = 0.35, { seed = 3, lobes = 3, seg = 96 } = {}) {
  let a = seed * 9301 + 49297; const R = () => ((a = (a * 233280 + 49297) % 233280) / 233280);
  const ph = Array.from({ length: 6 }, () => R() * 6.283), am = Array.from({ length: 6 }, () => 0.04 + R() * 0.12), sh = new THREE.Shape();
  for (let i = 0; i <= seg; i++) { const t = i / seg * 6.283; let r = 1; for (let k = 0; k < 6; k++) r += am[k] * Math.sin(t * (k + 1 + (k > 2 ? lobes : 0)) + ph[k]) / (k > 2 ? 2 : 1);
    const x = Math.cos(t) * r * radius, y = Math.sin(t) * r * radius * 0.8; i ? sh.lineTo(x, y) : sh.moveTo(x, y); }
  return new THREE.ShapeGeometry(sh, 2).rotateX(-Math.PI / 2);
}

// ---------------------------------------------------------------- presets (named by what they are, not a look)
export const SURFACES = {
  craneYellow:   { top: 0xd0a019, primer: 0x7a3322, chip: 0.03, wear: 0.65, rust: 0.45, streak: 1.6, grime: 0.35, grimeH: 2.5, dust: 0.25, rough: 0.45, age: 0.6, blisters: 0.5, box: true },
  primerRed:     { top: 0x7a3322, primer: 0x7a3322, chip: 0.02, wear: 0.55, rust: 0.55, streak: 0.8, grime: 0.3, grimeH: 1.0, dust: 0.35, rough: 0.72, age: 0.35, blisters: 0.2, box: true, name: 'red oxide primer' },
  primerGrey:    { top: 0x6f716e, primer: 0x6f716e, chip: 0.02, wear: 0.5, rust: 0.4, grime: 0.3, dust: 0.3, rough: 0.7, age: 0.3, box: true },
  structuralGrey:{ top: 0x5d625f, primer: 0x7a3322, chip: 0.035, wear: 0.6, rust: 0.5, streak: 2.0, grime: 0.45, grimeH: 1.8, dust: 0.3, rough: 0.5, age: 0.7, blisters: 0.5, box: true },
  greenMachine:  { top: 0x3f5a46, primer: 0x6f716e, chip: 0.025, wear: 0.7, rust: 0.35, grime: 0.55, oil: 0.5, handling: 1, dust: 0.15, rough: 0.4, age: 0.55, box: true },
  rustedPlate:   { top: 0x5d625f, primer: 0x7a3322, chip: 0.05, wear: 1.6, rust: 1.0, streak: 0.9, grime: 0.3, dust: 0.1, rough: 0.6, age: 0.95, blisters: 0.9, coverage: 0.6, box: true },
  millSteel:     { top: 0x2b2d30, primer: 0x2b2d30, coverage: 0, chip: 0.04, wear: 0.4, rust: 0.45, grime: 0.4, oil: 0.4, dust: 0.1, rough: 0.5, age: 0.6, box: true },
  truckPaint:    { top: 0x8d1b1b, primer: 0x6f716e, chip: 0.012, wear: 0.35, rust: 0.2, streak: 0.5, grime: 0.4, grimeH: 0.9, dust: 0.2, rough: 0.3, age: 0.4, baked: true },
  concreteYard:  { base: 0x8f8b82, joint: 6, cracks: 0.6, oil: 0.5, dirt: 0.45, aggregate: 1, tracks: 0.6, rough: 0.82 },
  concreteFloor: { base: 0x7d7a74, joint: 4, cracks: 0.3, oil: 0.7, dirt: 0.25, aggregate: 0.6, rough: 0.6 },
};

// ---------------------------------------------------------------- geometry that carries box edges for the shader
// a box (w, h, d) centred at (x, y, z), optionally rotated (euler); carries aLP (local position) and aHS (half size)
export function boxGeometry(w, h, d, x = 0, y = 0, z = 0, rot = null) {
  const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position, n = p.count;
  g.setAttribute('aLP', new THREE.BufferAttribute(new Float32Array(p.array), 3)); g.setAttribute('aLN', new THREE.BufferAttribute(new Float32Array(g.attributes.normal.array), 3));
  const hs = new Float32Array(n * 3); for (let i = 0; i < n; i++) { hs[i * 3] = w / 2; hs[i * 3 + 1] = h / 2; hs[i * 3 + 2] = d / 2; }
  g.setAttribute('aHS', new THREE.BufferAttribute(hs, 3));
  if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)));
  g.translate(x, y, z); g.deleteAttribute('uv');
  return g;
}
export const mergeBoxes = gs => mergeGeometries(gs, false);

// swap the MODELING house materials (materials.js PALETTE names) on a loaded asset for layered surfaces
export function upgradeAsset(root, map = {}) {
  const cache = new Map();
  root.traverse(o => {
    if (!o.isMesh) return;
    const name = o.material?.name || '', spec = map[name];
    if (spec === undefined) { litPatch(o.material); return; }
    if (spec === null) { litPatch(o.material); return; }
    if (spec.glass) { if (!cache.has(name)) cache.set(name, glassMaterial(spec)); o.material = cache.get(name); return; }
    if (!cache.has(name)) cache.set(name, steelMaterial({ baked: true, box: false, ...spec, name }));
    o.material = cache.get(name);
  });
  return root;
}
