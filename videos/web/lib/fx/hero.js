// HERO: a close-up human with real anatomy, for the shots people.js cannot carry (HUMAN studio, cycle 1).
// Built on the CC0 MakeHuman base mesh hm08 and its 163-bone default rig (clavicles, 3 joints in every finger, an
// opposable thumb, jaw and face bones), baked by videos/scripts/bake_hero.py into assets/hero/. People.js stays the
// crowd; a Hero swaps in when a person is more than about a quarter of the frame, when a hand touches a tool, or when
// a face is seen at mid distance.
//
//   import { loadHeroData, Hero } from '../lib/fx/hero.js';
//   const data = await loadHeroData();                         // once (4 MB)
//   const h = new Hero(data, { variant: 'forge', height: 1.8, shirt: '#3a4452', kind: 'work', hat: 'hard', beard: 0.4 });
//   scene.add(h.group);
//   h.applyClip(clip.sample(t, { twos: true }));               // a bvh.js clip retargeted with heroMap(h.names) onto h.rig
//   h.grip('R', { p, d, r: 0.018 });                           // fingers close onto a handle (world axis p + s*d, radius r)
//   h.fist('L');                                               // the same solver on a thin bar inside the palm = a fist
//   h.expr({ shout: 0.8, brow: 0.6 });                         // MakeHuman expression units (mouth open, brows down...)
// RIG c1: option glovesSide: 'L' | 'R' (with gloves) gloves one hand only.
// 8 Oct 2026: option softBrows: true (opt-in, off by default) draws the brows without card edges (a rounded inner end, a long tapered tail,
// edges broken by the hairs) and fades the lid shadow and the forehead's lines and sheen round the curve, for faces seen in close-up.
// HUMAN c8 HOOKS (all opt-in; an untouched hero compiles and builds exactly as before; review/studio_human_c8/after/hooks/NOTES.md):
// o.skinHook / h.useSkinHook(hook) (a lane's skin GLSL in named slots), the skin section markers SKIN_MARKERS, h.skinU.hBrow (the
// painted brow's weight), material.defines.SKIN_COVER + attribute aCover (skin under drawn cloth), hNotSkin (the paint mask, with a
// skinHook), V.mouth (a face's own stomion), o.eyeFit (iris from the fitted globe), o.collarEdge (a tee's band on the drawn neckline).
//
// Cycle 2 (HUMAN studio): h.gesture('R', 'ROTFRONT' | 'OVERHEAD' | 'PUMP' | 'CLIMB_REACH' | 'BANNER_TOP' | ..., { p })
// poses an arm by IK from gesture.js and closes the fist; h.gestures(camera, W, H) measures both arms (the salute
// check); h.inkStrokes(camera, W, H) gives the face's ink strokes for print (lid, catchlight, brow, nostril, mouth,
// nasolabial fold, cheekbone; Spider-Verse); h.faceTier(camera, H) = 'silhouette' (< 200 px face), 'planes'
// (200-600) or 'lit' (> 600), the rule for how a face at that size is rendered. Clothes now HANG: below the chest the
// shirt falls straight from its widest ring (no pecs, navel or buttocks under the cloth), trousers drop from the seat
// and the knee; standoff 1.5 cm shirts, 3 cm coats. The hard hat is one shell with its brim and peak (no floating
// disc) sized to the skull; hair shows at the temples and nape under every hat.
// Clothing is a shell cut from the body surface (shirt, trousers, boots) pushed out along the bind normals with a
// turned hem where it ends, so sleeves and collars have an edge that catches light. Hair and beard are shells too.
// Materials: skin with a warm sheen at grazing angles (the light through the rim of an ear or a cheek), cloth by kind
// (work twill, flannel plaid, denim, canvas duck, leather) with folds, seams and dirt, wet eyes. The G-buffer
// (gbuffer.js) gets metric uvs that ring every limb along its axis, so an engraver's lines wrap the form.
import * as THREE from 'three';
import { GESTURES, gestureDirs, gestureSolve, measureArm, registerAudit } from './gesture.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

let _data = null;
export async function loadHeroData(base = new URL('../../assets/hero/', import.meta.url).href) {
  if (_data) return _data;
  const [meta, buf] = await Promise.all([fetch(base + 'hero.json').then(r => r.json()), fetch(base + 'hero.bin').then(r => r.arrayBuffer())]);
  const T = { float32: Float32Array, uint16: Uint16Array, uint32: Uint32Array, uint8: Uint8Array, float64: Float64Array };
  const arr = k => { const a = meta.arrays[k]; if (!a) return null; const n = a.shape.reduce((x, y) => x * y, 1); return new T[a.dtype](buf, a.offset, n); };
  _data = { meta, arr };
  Object.defineProperty(_data, 'bundle', { value: true });   // PRODUCTION: a Hero built on THIS data is a scene's hero (-> the current person)
  return _data;
}

import { drapeShell, rim, CUTS, collar, bootsC7, skirtC7 } from './garment.js';
import { fabricMaterial, fabricDepth, fabricPack } from './cloth/fabric_glsl.js';
import { heroFabrics } from './cloth/wardrobe.js';
const R = { head: 0, neck: 1, torso: 2, uarm: 3, farm: 4, hand: 5, finger: 6, pelvis: 7, thigh: 8, shin: 9, foot: 10, jaw: 11 };
export const HERO_REGIONS = R;

// finger chains per side: [metacarpal-or-null, j1, j2, j3], link radius (m, at 1.8 m height)
const FINGERS = [['thumb', null, 'finger1-1', 'finger1-2', 'finger1-3', 0.0105], ['index', 'metacarpal1', 'finger2-1', 'finger2-2', 'finger2-3', 0.0085],
  ['middle', 'metacarpal2', 'finger3-1', 'finger3-2', 'finger3-3', 0.009], ['ring', 'metacarpal3', 'finger4-1', 'finger4-2', 'finger4-3', 0.0085],
  ['pinky', 'metacarpal4', 'finger5-1', 'finger5-2', 'finger5-3', 0.0075]];
const LIMITS = { mcp: 1.62, pip: 1.85, dip: 1.25, tmcp: 1.0, tip: 1.35 };

// ---------------------------------------------------------------- shaders (patches onto MeshPhysicalMaterial)
const SKIN_VERT_PARS = `attribute vec4 aHero; varying vec4 vHero; varying vec3 vBind;`;
const SKIN_VERT = `vHero = aHero; vBind = position;`;
const NOISE = `
float hh(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hh(i), hh(i + vec3(1,0,0)), f.x), mix(hh(i + vec3(0,1,0)), hh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hh(i + vec3(0,0,1)), hh(i + vec3(1,0,1)), f.x), mix(hh(i + vec3(0,1,1)), hh(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++){ s += a * vn3(p); p *= 2.03; a *= .5; } return s; }
`;
// skin: pores and mottling, lips, brows, stubble, knuckles, nails, dirt in the creases; face features from uniforms
const SKIN_FRAG_PARS = `varying vec4 vHero; varying vec3 vBind; uniform vec3 hHair; uniform float hStubble, hDirt, hAge, hSeed;
uniform vec3 hEyeL, hEyeR, hMouth, hChin; uniform float hBoots, hSweat; uniform vec4 hCover, hCover2;` + NOISE;
const SKIN_FRAG = `
{ float reg = vHero.x; vec3 b = vBind; vec3 base = diffuseColor.rgb;
  if (b.y > hEyeL.y - 0.15 && reg > 1.5 && reg < 10.5) reg = 11.;   // cycle 3: a head-jaw triangle interpolates the region id through 2..10 (hands, nails, feet): keep it face
  if (hBoots > 0.5 && reg > 9.5 && reg < 10.5 && b.y < 0.35) discard;
  if (hCover.w > 0.5) {                                             // HUMAN c6: skin that the clothes cover is not drawn (it still casts), so it never pokes through at a bent knee or elbow
    float rg = floor(reg + 0.5), al = vHero.y;                       // reg: the jaw-seam-corrected region (an interpolated id across the jaw passes through 2..10)
    if (b.y > hEyeL.y - 0.14) rg = -1.0;                             // the head and the top of the neck only (at -0.25 it also caught the shoulders of a short body)
    if ((rg == 8.0 || rg == 9.0) && al < hCover.y - 0.12) discard;                         // legs under the trousers
    if (rg == 7.0 && hCover2.x > 0.5 && b.y < hCover2.w) discard;                         // pelvis, below the waistband
    if ((rg == 3.0 || rg == 4.0) && al < hCover.x - 0.1 && hCover2.y > 0.5) discard;       // arms under the sleeves
    if (b.y < hCover2.w && (rg < 2.5 || rg > 6.5)) discard;          // everything under the trousers below the waist, whatever region the bake gave it (region seams z-fought through the cloth as dotted lines)
    if (reg > 1.5 && reg < 3.5 && (rg == 2.0 || abs(b.x) < 0.16) && hCover2.y > 0.5 && b.y > hCover2.w && (b.y < hCover.z - 0.1 || (b.y < hCover.z - 0.025 && (abs(b.x) > 0.065 || b.z < -0.02)))) discard;   // torso skin under the top, and the upper-arm weights that spill onto the chest (they drew skin-coloured cracks along the region seam)   // and the shoulders and back up to the collar   // the chest and back under the top (a nipple through the shirt was the skin, not the cloth)
    if (b.y < hCover2.w && (rg < 2.5 || rg > 6.5)) discard;          // everything under the trousers below the waist, whatever region the bake gave it (region seams z-fought through the cloth as dotted lines)
    if (rg == 2.0 && hCover2.y > 0.5 && b.y < hCover.z - 0.1 - 0.12 * exp(-pow(b.x / 0.05, 2.0)) * step(0.0, b.z) && b.y > hCover2.z) discard;   // torso under the top (clear of the open collar)
  }   // cycle 3: feet only. The region id is interpolated, so across a head(0)-jaw(11) triangle it passes through 10: that cut the zig-zag 'torn jaw' seam into every face
  float n1 = vn3(b * 900.0), n2 = fbm3(b * 60.0 + hSeed);
  vec3 col = base * (0.93 + 0.12 * n2) * mix(vec3(1.0), vec3(1.05, 0.93, 0.9), vn3(b * 30.0 + 7.0));
  float pRough = 0.52 + 0.1 * n1;
  vec3 col0 = col;
  if (reg < 1.5 || reg > 10.5) {                                   // head and jaw (and the top of the neck, faded by height: no region edge)
    vec3 eL = hEyeL, eR = hEyeR; float eyeY = (eL.y + eR.y) * 0.5, ax = abs(b.x);
    float eyeX = abs(eL.x);
    // brows: a tapered arch of short strokes over each socket (thick and upswept at the inner end, thin at the tail)
    { float u = clamp((ax - 0.008) / 0.05, 0.0, 1.0);
      float cy = eyeY + 0.021 + 0.007 * sin(u * 2.6) - 0.004 * u * u;
      float th = mix(0.0065, 0.0022, u);
      float d = b.y - cy;
#ifdef HERO_SOFT_BROWS
      // o.softBrows (8 Oct 2026, opt-in; A SPECTRE IS HAUNTING's close-up read the brows as cards): no card edges. The inner end rounds off
      // instead of stopping 8 mm from the centre line (with the lid shadow it drew a lighter band down the brow), the tail tapers over 2.6 cm,
      // and the upper and lower edges are broken by the hairs themselves, thinning out instead of ending on a line
      float inner = smoothstep(0.004, 0.017, ax), zc = smoothstep(eL.z - 0.036, eL.z - 0.024, b.z), tail = smoothstep(0.066, 0.04, ax);
      float edgeN = vn3(vec3(ax * 1400.0, b.y * 260.0, hSeed + 3.0)) - 0.5;
      float inBrow = smoothstep(th * 1.2, th * 0.25, abs(d) + edgeN * th * 0.6) * inner * tail * zc;
#else
      float inBrow = smoothstep(th, th * 0.55, abs(d)) * step(0.008, ax) * smoothstep(0.062, 0.052, ax) * step(eL.z - 0.03, b.z);
#endif
      vec2 sd = vec2(ax, b.y); float ang = mix(1.2, 0.25, u);                       // stroke direction: up at the head, out at the tail
      vec2 dirA = vec2(cos(ang), sin(ang)), dirB = vec2(-dirA.y, dirA.x);
      float strokes = smoothstep(0.45, 0.85, vn3(vec3(dot(sd, dirB) * 2600.0, dot(sd, dirA) * 180.0, hSeed)));
#ifdef HERO_SOFT_BROWS
      col = mix(col, hHair * 0.45, inBrow * (0.2 + 0.8 * strokes));
      col *= 1.0 - 0.12 * smoothstep(0.012, 0.0, d + 0.006) * smoothstep(-0.02, 0.0, d + 0.006) * smoothstep(0.0, 0.022, ax) * tail * zc; }  // brow shadow on the lid, fading to the centre
#else
      col = mix(col, hHair * 0.45, inBrow * (0.35 + 0.65 * strokes));
      col *= 1.0 - 0.12 * smoothstep(0.012, 0.0, d + 0.006) * smoothstep(-0.02, 0.0, d + 0.006) * step(0.008, ax) * smoothstep(0.06, 0.045, ax) * step(eL.z - 0.03, b.z); }  // brow shadow on the lid
#endif
    // lips: redder and smoother, the parting line dark
    vec2 mq = vec2(b.x / 0.026, (b.y - hMouth.y) / 0.011);
    float lip = exp(-dot(mq, mq)) * step(hMouth.z - 0.03, b.z);
    col = mix(col, col * vec3(0.92, 0.62, 0.58), 0.6 * lip); pRough = mix(pRough, 0.35, lip);
    col *= 1.0 - 0.5 * exp(-(pow(b.x / 0.024, 2.0) + pow((b.y - hMouth.y) / 0.0016, 2.0))) * step(hMouth.z - 0.02, b.z);
    // cheeks and nose flush, ears redder
    col = mix(col, col * vec3(1.03, 0.84, 0.8), 0.35 * exp(-(pow((ax - 0.04) / 0.022, 2.0) + pow((b.y - eyeY + 0.03) / 0.02, 2.0))) * step(eL.z - 0.02, b.z));
    col = mix(col, col * vec3(1.04, 0.85, 0.8), 0.3 * smoothstep(0.065, 0.075, ax));
    // stubble / beard shadow on the jaw, chin and upper lip (not the lips)
    float jaw = smoothstep(eyeY - 0.045, eyeY - 0.07, b.y) * (1.0 - smoothstep(0.35, 0.95, lip * 3.0)) * step(-0.04, b.z - hChin.z + 0.08);
    jaw *= 1.0 - smoothstep(0.07, 0.085, ax) * smoothstep(eyeY - 0.06, eyeY - 0.03, b.y);
    jaw *= smoothstep(hChin.y - 0.07, hChin.y - 0.01, b.y);        // the stubble thins out under the jaw (cycle 2: the torn jaw edge was the region boundary)
    col = mix(col, hHair * 0.55 + col * 0.25, hStubble * jaw * (0.45 + 0.4 * smoothstep(0.4, 0.7, n1)));
    // eye sockets and lids: a little darker, a crease
    for (int s = 0; s < 2; s++) { vec3 e = s == 0 ? eL : eR; vec2 d = vec2(b.x - e.x, b.y - e.y);
      float sock = exp(-(d.x * d.x / 0.0004 + d.y * d.y / 0.00025)) * step(e.z - 0.03, b.z);
      col *= 1.0 - 0.18 * sock;
      col *= 1.0 - 0.25 * smoothstep(0.003, 0.0, abs(d.y - 0.012 - 0.12 * d.x * d.x / 0.0004 * 0.01)) * step(abs(d.x), 0.016) * step(e.z - 0.02, b.z); }
    // age: forehead lines and crow's feet
#ifdef HERO_SOFT_BROWS
    float fzA = smoothstep(eL.z - 0.016, eL.z - 0.004, b.z), fzB = smoothstep(eL.z - 0.026, eL.z - 0.014, b.z);   // softBrows: the forehead's lines and sheen fade round its curve, no seam
    col *= 1.0 - hAge * 0.12 * smoothstep(0.75, 0.95, sin(b.y * 520.0 + vn3(b * 40.0) * 5.0 + ax * 60.0) * 0.5 + 0.5) * smoothstep(0.3, 0.6, vn3(b * 25.0)) * smoothstep(eyeY + 0.03, eyeY + 0.045, b.y) * smoothstep(eyeY + 0.085, eyeY + 0.07, b.y) * fzA;
    pRough = mix(pRough, 0.42, 0.5 * smoothstep(eyeY + 0.02, eyeY + 0.06, b.y) * fzB);    // oily forehead
#else
    col *= 1.0 - hAge * 0.12 * smoothstep(0.75, 0.95, sin(b.y * 520.0 + vn3(b * 40.0) * 5.0 + ax * 60.0) * 0.5 + 0.5) * smoothstep(0.3, 0.6, vn3(b * 25.0)) * smoothstep(eyeY + 0.03, eyeY + 0.045, b.y) * smoothstep(eyeY + 0.085, eyeY + 0.07, b.y) * step(eL.z - 0.01, b.z);
    pRough = mix(pRough, 0.42, 0.5 * smoothstep(eyeY + 0.02, eyeY + 0.06, b.y) * step(eL.z - 0.02, b.z));    // oily forehead
#endif
    if (reg > 0.5 && reg < 1.5) col = mix(col0, col, smoothstep(hChin.y - 0.08, hChin.y - 0.02, b.y));
  }
  if (reg > 4.5 && reg < 6.5) {                                     // hands: knuckles redder, nails, creases, dirt
    float dors = vHero.w, fl = vHero.y - 3.0, ph = floor(fl), a = fract(fl);
    pRough = 0.58;
    if (reg > 5.5) {
      // knuckle creases across the back of each joint, redder skin over the joints
      float jn = smoothstep(0.16, 0.0, a) + smoothstep(0.84, 1.0, a) * step(ph, 1.5);
      col = mix(col, col * vec3(1.03, 0.8, 0.76), 0.35 * jn * dors);
      float cr = sin(a * 180.0 + vn3(b * 300.0) * 3.0) * 0.5 + 0.5;
      col *= 1.0 - 0.35 * dors * smoothstep(0.12, 0.0, abs(a - (ph < 0.5 ? 0.0 : 0.02))) * step(0.5, ph) * smoothstep(0.4, 0.9, cr);
      // the nail: the back of the last phalanx, pale and glossy, a darker cuticle and dirt under the free edge
      float nail = step(1.5, ph) * smoothstep(0.42, 0.52, a) * smoothstep(0.35, 0.6, dors);
      col = mix(col, vec3(0.78, 0.62, 0.56) * (0.9 + 0.2 * vn3(b * 800.0)), nail * 0.85);
      col *= 1.0 - 0.45 * nail * smoothstep(0.06, 0.0, abs(a - 0.5));
      col = mix(col, vec3(0.12, 0.08, 0.06), nail * smoothstep(0.9, 0.97, a) * hDirt);
      pRough = mix(pRough, 0.22, nail);
      col *= 1.0 - 0.25 * (1.0 - dors) * smoothstep(0.1, 0.0, abs(a - 0.5)) * step(-0.5, ph);        // palm-side flexion creases
    } else {
      // back of the hand: tendons fanning to the knuckles, the knuckle bumps redder
      float ten = smoothstep(0.6, 1.0, sin(atan(b.z, b.x) * 70.0) * 0.5 + 0.5) * dors * smoothstep(0.3, 1.2, vHero.y - 1.0);
      col *= 1.0 + 0.06 * ten;
      col = mix(col, col * vec3(1.02, 0.84, 0.8), 0.3 * dors * smoothstep(1.85, 2.0, vHero.y));
    }
    col *= 1.0 - hDirt * 0.4 * smoothstep(0.5, 0.75, fbm3(b * 120.0));
  }
  col *= mix(1.0, 0.82 + 0.18 * n2, hDirt);
  if (hSweat > 0.001) {                                             // HUMAN c6: sweat where it runs (brow, temples, upper lip, neck, forearms, the backs of the hands); beads catch a hard key
    float eyeY2 = (hEyeL.y + hEyeR.y) * 0.5, front = step(hEyeL.z - 0.05, b.z);
    float m = 0.0;
    if (reg < 1.5 || reg > 10.5) m = smoothstep(eyeY2 + 0.015, eyeY2 + 0.045, b.y) * front + 0.7 * smoothstep(0.055, 0.07, abs(b.x)) * smoothstep(eyeY2 - 0.03, eyeY2 + 0.01, b.y) + 0.6 * exp(-(pow(b.x / 0.02, 2.0) + pow((b.y - hMouth.y - 0.012) / 0.008, 2.0))) * front;
    if (reg < 1.5 || reg > 10.5) m = max(m, 0.8 * smoothstep(hChin.y - 0.03, hChin.y - 0.08, b.y));   // the neck, by height (the region id is interpolated across the jaw seam)
    if (reg > 3.5 && reg < 5.5) m = max(m, 0.55 * vHero.w + 0.35);
    float bead = smoothstep(0.78, 0.9, vn3(b * 420.0 + hSeed)) * m;
    m *= hSweat; bead *= hSweat;
    col *= 1.0 - 0.07 * m; pRough = mix(pRough, 0.2, m * 0.85); pRough = mix(pRough, 0.06, bead);
  }
  diffuseColor.rgb = col;
  roughnessFactor = pRough;
}`;
// HUMAN c8 HOOKS: the exact SKIN_FRAG text the opt-in skin hooks rewrite (Hero's skinLazy; review/studio_human_c8/after/hooks/NOTES.md)
const SKIN_HEAD = '{ float reg = vHero.x; vec3 b = vBind; vec3 base = diffuseColor.rgb;\n', SKIN_END = '  roughnessFactor = pRough;\n}';
const BROW_PAINT = 'col = mix(col, hHair * 0.45, inBrow * (0.35 + 0.65 * strokes));';
const BROW_LID = 'col *= 1.0 - 0.12 * smoothstep(0.012, 0.0, d + 0.006) * smoothstep(-0.02, 0.0, d + 0.006) * step(0.008, ax) * smoothstep(0.06, 0.045, ax) * step(eL.z - 0.03, b.z);';
const BROW_LID_SOFT = 'col *= 1.0 - 0.12 * smoothstep(0.012, 0.0, d + 0.006) * smoothstep(-0.024, 0.0, d + 0.006) * smoothstep(0.0, 0.018, ax) * smoothstep(0.066, 0.036, ax) * smoothstep(eL.z - 0.045, eL.z - 0.02, b.z);';   // lane D's soft ends
// the skin's sections, in run order, after the skin block: an outside patch inserts its code BEFORE its section's marker (so within a
// section patches run in the order they were applied): albedo (lane B), paint (lane D hair: scalp, brows, beard zone), style (lane E:
// clay, mottle fade, underwear), end (anything that must run last: the integrator's bust band). Emitted only when a patch is chained
// onto the skin material or a skinHook is set (comment lines; an untouched hero's source is unchanged).
export const SKIN_MARKERS = ['//@skin-albedo', '//@skin-paint', '//@skin-style', '//@skin-end'];
// softBrows (8 Oct 2026, ours) under the H2 hook: the soft brow's paint is weighted by hBrow as BROW_PAINT is (card brows set it to 0); its lid
// shadow already has soft ends. Applied by the skin's lazy below, only when hBrow has left 1 (else the source is the softBrows source as before).
const SOFT_BROW_PAINT = 'col = mix(col, hHair * 0.45, inBrow * (0.2 + 0.8 * strokes));', SOFT_BROW_PAINT_H = 'col = mix(col, hHair * 0.45, hBrow * inBrow * (0.2 + 0.8 * strokes));';

// cloth: kinds 0 work twill, 1 flannel plaid, 2 denim, 3 canvas duck, 4 leather, 5 knit, 6 boot leather
const CLOTH_VERT_PARS = SKIN_VERT_PARS + ` varying vec3 vBN;`, CLOTH_VERT = SKIN_VERT + ` vBN = normal;`;
const CLOTH_FRAG_PARS = `varying vec4 vHero; varying vec3 vBind; varying vec3 vBN; uniform vec3 cA, cB; uniform float cKind, cDirt, cSeed, cWet, cPart; uniform vec4 cHem, cHem2;
uniform float cWear, cSweat, cFoldK, cRetro, cC7; uniform vec4 cFlex, cFlex2, cVest, cBootP, cBootP2; float cRetroMask = 0.0;` + NOISE + `
float band(float x, float c, float w){ return smoothstep(w, w * 0.4, abs(x - c)); }`;
// CLOTHING c1: the cloth shader in pieces (their concatenation is the c6/c7 CLOTH_FRAG, byte for byte), so the fabric path can keep
// the cuts and construction (CF_HEAD, CF_DETAIL) and take the surface, wear and light from lib/fx/cloth/fabric_glsl.js
const CF_HEAD = `
{ vec3 b = vBind; float reg = vHero.x, along = vHero.y; int K = int(cKind + 0.5), PT = int(cPart + 0.5);
  bool arm = reg > 2.5 && reg < 5.5, leg = reg > 7.5 && reg < 10.5;
  float hemBand = 0.0, belt = 0.0, btn = 0.0, pocket = 0.0;
  float nz = (vn3(b * 90.0) - 0.5) * 0.012 * (1.0 - 0.85 * cC7);   // HUMAN c7: a cut edge carries a rim (garment.js), so it is cut clean
  if (PT >= 4) {                                                    // HUMAN c7 parts: 4 collar, 5 rim (binding / turned hem), 6 patch pocket
    float a = vHero.w;
    if (PT == 4) hemBand = smoothstep(0.08, 0.0, abs(a - 0.55)) * 0.6 + smoothstep(0.1, 0.0, 1.0 - a) * 0.8;   // the fold line and the stitched edge
    if (PT == 5) hemBand = 0.35 + 0.4 * smoothstep(0.2, 0.0, abs(fract(a) - 0.75));                             // the binding: a darker doubled edge, a stitch on its face
    if (PT == 6) hemBand = a > 2.5 ? 1.2 : 0.0;                                                                 // the pocket's wall
  } else if (PT == 0) {                                                    // shirt / coat: cuff, neckline (open collar V), tuck
    if (arm && along > cHem.x + nz) discard;
    float neck = cHem.w - 0.05 * exp(-pow(b.x / 0.035, 2.0)) * step(0.0, b.z);
    if (!arm && b.y > neck + nz * 0.5) discard;
    if (!arm && b.y < cHem2.y) discard;
    if (arm) hemBand = smoothstep(0.07, 0.0, abs(along - cHem.x + 0.035));
    if (!arm) hemBand = smoothstep(0.012, 0.0, abs(b.y - neck + 0.006));
    if (!arm && cVest.x > 0.5 && cVest.x < 1.5 && b.z > 0.0) {      // HUMAN c6 coat (cVest = 1, skirt hem y, skirt top y, waist y): a front placket with buttons, patch pockets, a chest pocket
      float px = b.x - 0.01, ax = abs(b.x);
      hemBand += smoothstep(0.0035, 0.0, abs(px - 0.016)) + smoothstep(0.0035, 0.0, abs(px + 0.016));
      float by = mod(b.y - cVest.y - 0.05, 0.1) - 0.05; if (b.y < cHem.w - 0.07 && b.y > cVest.y + 0.03) btn = smoothstep(0.0075, 0.005, length(vec2(px, by)));
      vec2 pk = vec2(ax - 0.115, b.y - cVest.y - 0.1), pe = abs(pk) - vec2(0.055, 0.065); float pd = max(pe.x, pe.y);
      if (cC7 < 0.5) { hemBand += smoothstep(0.004, 0.0, abs(pd + 0.003)) * 1.4; pocket = step(pd, 0.0); }   // c7: patch pockets are geometry (garment.js skirtC7)
      vec2 ck = vec2(b.x - 0.095, b.y - cHem.w + 0.2), ce = abs(ck) - vec2(0.045, 0.05); float cd = max(ce.x, ce.y);
      hemBand += smoothstep(0.004, 0.0, abs(cd + 0.003)) * 1.4; pocket = max(pocket, step(cd, 0.0) * 0.7);
    }
  } else if (PT == 1) {                                             // trousers: waist + belt, hem turn-up
    bool shin = reg > 8.55 && reg < 10.5;                          // HUMAN c6 fix: across a pelvis-thigh triangle the region id and 'along' interpolate, so the hem test fired along the groin seam (holes and a stitched V)
    bool c6c = cFoldK > 0.0 || cWear > 0.0 || cSweat > 0.0;          // c6 cloth only: older figures keep their exact pixels
    if (leg && (shin || !c6c) && along > cHem.y + nz) discard;
    if (!leg && b.y > cHem2.x + nz * 0.3) discard;
    belt = cHem2.z * step(cHem2.x - 0.038, b.y) * (leg ? 0.0 : 1.0);
    if (leg && (shin || !c6c)) hemBand = smoothstep(0.05, 0.0, abs(along - cHem.y + 0.03));
  } else if (PT == 3) {                                             // HUMAN c6: the hi-vis vest: armholes, V neck, hem (cVest = shoulder x, armpit y, neck y, hem y)
    float ax = abs(b.x);
    if (b.y < cVest.w + nz * 0.3) discard;
    if (b.y > cVest.y - 0.02 && ax > cVest.x - 0.045 - 0.05 * smoothstep(cVest.y, cVest.z, b.y)) discard;
    float vneck = cVest.z - 0.2 + 2.2 * max(0.0, ax - 0.004);
    if (b.z > 0.0 && b.y > vneck && ax < 0.11) discard;
    if (b.y > cVest.z - 0.03 && (ax < 0.055 || ax > 0.145)) discard;
    if (b.z > 0.0 && ax < 0.006) discard;                            // the zip, open a finger's width
    hemBand = smoothstep(0.012, 0.0, abs(b.y - cVest.w - 0.006)) + smoothstep(0.01, 0.0, abs(b.y - vneck)) * step(0.0, b.z);
  } else {                                                          // boots: the shaft top
    hemBand = smoothstep(0.012, 0.0, abs(b.y - 0.205)) + smoothstep(0.006, 0.0, abs(b.y - 0.022));   // shaft collar, welt
    belt = -step(b.y, 0.018);                                        // the sole (flagged negative)
    if (cC7 > 0.5) { belt = vHero.w > 0.25 && vHero.w < 0.75 ? -1.0 : 0.0;                                       // c7: the sole is its own part (aHero.w 0.5)
      hemBand = smoothstep(0.008, 0.0, abs(b.y - 0.236)) * 1.4; }
  }
`;
const CF_KIND = `  float n1 = vn3(b * 400.0), n2 = fbm3(b * 25.0 + cSeed);
  vec3 col = cA; float pRough = 0.85;
  float ang = atan(b.z, b.x);
  if (K == 1) {                                                     // flannel: two-colour plaid with a twill slub
    vec2 g = vec2(b.x + b.z * 0.4, b.y) * 26.0 + cSeed;
    float sx = step(0.55, fract(g.x)), sy = step(0.55, fract(g.y));
    float lx = band(fract(g.x), 0.2, 0.05), ly = band(fract(g.y), 0.2, 0.05);
    col = cA * (1.0 - 0.45 * sx - 0.45 * sy + 0.25 * sx * sy); col = mix(col, cB, 0.55 * max(lx, ly)); pRough = 0.95;
  } else if (K == 2) {                                              // denim: twill line, fades at thighs and knees
    col *= 0.9 + 0.15 * vn3(vec3(b.x * 900.0 + b.y * 900.0, b.z * 300.0, 0.0));
    col *= 1.0 + 0.3 * smoothstep(0.3, 0.9, along) * smoothstep(1.0, 0.7, along) * step(0.0, b.z) * (reg > 7.5 && reg < 8.5 ? 1.0 : 0.0);
    pRough = 0.9;
  } else if (K == 3) {                                              // canvas duck: weave, faded, stiff
    col *= 0.88 + 0.18 * n2; col *= 1.0 + 0.08 * (vn3(b * 1400.0) - 0.5); pRough = 0.95;
  } else if (K == 4) {                                              // leather: grain, scorch, sheen
    col *= 0.78 + 0.4 * n2; pRough = 0.55 + 0.25 * n2;
    col = mix(col, vec3(0.05, 0.035, 0.025), 0.55 * smoothstep(0.62, 0.8, fbm3(b * 14.0 + cSeed)));
  } else if (K == 5) {                                              // knit rib
    col *= 0.85 + 0.25 * abs(fract(ang * 30.0) - 0.5) * 2.0; pRough = 0.98;
  } else if (K == 6) {                                              // boots
    col *= 0.8 + 0.3 * n2; pRough = 0.5; col = mix(col, col * 1.5 + 0.03, 0.3 * smoothstep(0.7, 0.9, n2));
  } else if (K == 7) {                                              // HUMAN c6: hi-vis polyester mesh (bird's-eye knit) with retroreflective tape
    float knit = smoothstep(0.25, 0.45, abs(fract(b.x * 520.0) - 0.5) + abs(fract(b.y * 520.0) - 0.5) * 0.6);
    col = cA * (0.86 + 0.14 * knit) * (0.92 + 0.12 * n2); pRough = 0.78;
    float ax = abs(b.x), y0 = cVest.w;
    float tape = max(smoothstep(0.027, 0.023, abs(b.y - y0 - 0.07)), smoothstep(0.027, 0.023, abs(b.y - y0 - 0.19)));
    tape = max(tape, smoothstep(0.027, 0.023, abs(ax - 0.095)) * step(y0 + 0.19, b.y));
    float glass = smoothstep(0.35, 0.65, vn3(vec3(b.xy * 2400.0, 3.0)));           // the glass-bead face
    col = mix(col, vec3(0.2, 0.21, 0.21) * (0.85 + 0.15 * glass), tape); pRough = mix(pRough, 0.5, tape);
    cRetroMask = tape * (0.8 + 0.2 * glass) * (1.0 - 0.6 * cWear * smoothstep(0.4, 0.8, n2));
  } else {                                                          // work twill
    col *= 0.9 + 0.14 * n2; col *= 1.0 + 0.06 * (vn3(vec3((b.x + b.y) * 1500.0, b.z * 500.0, 1.0)) - 0.5); pRough = 0.88;
  }
`;
const CF_DETAIL = `  col *= 1.0 - 0.18 * hemBand; col *= 1.0 - 0.07 * pocket; col = mix(col, vec3(0.06, 0.05, 0.045), btn); pRough = mix(pRough, 0.35, btn);   // HUMAN c6 coat details                                      // doubled cloth at a turned edge: darker stitch line
  col *= 1.0 - 0.35 * smoothstep(0.35, 0.5, abs(fract(along * 40.0 + b.y * 30.0) - 0.5)) * hemBand * 0.3;
  if (belt < -0.5) { col = vec3(0.045, 0.04, 0.035); pRough = 0.9;
    if (cC7 > 0.5) { float lug = step(0.5, fract(b.z * 55.0)) * smoothstep(0.012, 0.004, b.y), stitch = smoothstep(0.0025, 0.0, abs(b.y - 0.0185 - 0.01 * step(b.z, cBootP.z - 0.06))) * step(0.5, fract(b.z * 220.0));
      col *= 1.0 - 0.55 * lug; col = mix(col, vec3(0.35, 0.3, 0.22), 0.7 * stitch); col = mix(col, vec3(0.16, 0.11, 0.07), smoothstep(0.004, 0.0, b.y - 0.0) * 0.0); } }
  if (cC7 > 0.5 && PT == 2 && vHero.w > 0.75) {                     // c7 boots: the lacing over the instep and up the shaft (eyelets, crossed laces, the tongue)
    float cxB = vHero.z > 0.0 ? cBootP.x : cBootP.y, dx = b.x - cxB, ax = abs(dx);
    float slot = smoothstep(0.022, 0.016, ax), eye = smoothstep(0.0045, 0.0028, length(vec2(ax - 0.019, mod(b.y + 0.011, 0.022) - 0.011)));
    float lc = smoothstep(0.0035, 0.0, abs(fract((b.y + ax * 0.9) / 0.022) - 0.5) * 0.022) * step(ax, 0.019);
    col = mix(col, col * 0.55, slot * 0.6); col = mix(col, vec3(0.62, 0.52, 0.36), lc * 0.85); col = mix(col, vec3(0.6, 0.58, 0.52), eye); pRough = mix(pRough, 0.3, eye); }
  if (belt > 0.5) { col = vec3(0.07, 0.05, 0.035) * (0.8 + 0.4 * n2); pRough = 0.45;
    float buckle = step(abs(b.x), 0.028) * step(0.0, b.z); col = mix(col, vec3(0.5, 0.46, 0.38), buckle); pRough = mix(pRough, 0.25, buckle); }
`;
const CF_DIRT = `  col *= mix(1.0, 0.72 + 0.28 * n2, cDirt);
`;
const CF_WEAR = `  if (cWear > 0.001 && K != 6) {                                     // HUMAN c6: wear where the work touches the cloth
    vec3 dust = vec3(0.52, 0.47, 0.4); float w = cWear, fr = clamp(vBN.z, 0.0, 1.0), sp = fbm3(b * 18.0 + cSeed * 3.0);
    if (leg) {
      float knee = exp(-pow(along - 1.0, 2.0) / 0.012) * fr;                                       // knees: abraded paler, ground-in dirt
      col = mix(col, col * 1.35 + 0.035, 0.55 * w * knee * smoothstep(0.35, 0.65, sp));
      col = mix(col, dust * 0.45, 0.35 * w * knee * smoothstep(0.55, 0.75, fbm3(b * 50.0)));
      float wipe = smoothstep(0.25, 0.4, along) * smoothstep(0.85, 0.6, along) * fr * smoothstep(0.55, 0.8, fbm3(vec3(b.x * 30.0, b.y * 9.0, b.z * 30.0) + cSeed));
      col = mix(col, col * 0.5, 0.6 * w * wipe);                                                    // thighs where hands are wiped
      float hem = smoothstep(cHem.y - 0.45, cHem.y + 0.02, along);
      col = mix(col, dust, 0.5 * w * hem * (0.6 + 0.4 * sp));                                      // trouser bottoms: dust climbs from the ground
    }
    if (arm) col = mix(col, col * 0.55, 0.5 * w * smoothstep(cHem.x - 0.25, cHem.x, along) * smoothstep(0.4, 0.7, sp));     // cuffs: grime
    if (!arm && !leg) { col = mix(col, col * 0.6, 0.35 * w * smoothstep(0.62, 0.82, fbm3(b * 9.0 + cSeed * 5.0)));          // smudges on the body of the garment
      col = mix(col, col * 1.12 + 0.02, 0.4 * w * smoothstep(0.6, 0.95, vBN.y));                                         // sun-faded over the shoulders
      col = mix(col, dust * 0.8, 0.25 * w * smoothstep(0.6, 0.2, b.y / max(cHem.w, 0.5))); }
    pRough = mix(pRough, min(1.0, pRough + 0.08), w);
  }
  if (cSweat > 0.001 && PT == 0 && !arm) {                            // HUMAN c6: sweat through the shirt: the sternum, between the shoulder blades, the armpits
    float ax = abs(b.x), ch = b.y / max(cHem.w, 0.5);
    float m = exp(-(pow(ax / 0.05, 2.0) + pow((ch - 0.84) / 0.06, 2.0))) * step(0.0, b.z) + exp(-(pow(ax / 0.07, 2.0) + pow((ch - 0.83) / 0.07, 2.0))) * step(b.z, 0.0) + exp(-pow((ax - 0.15) / 0.035, 2.0) - pow((ch - 0.8) / 0.05, 2.0));
    m *= smoothstep(0.3, 0.6, fbm3(b * 14.0 + cSeed) + 0.3) * cSweat;
    col *= 1.0 - 0.28 * clamp(m, 0.0, 1.0); pRough = mix(pRough, 0.6, clamp(m, 0.0, 1.0));
  }
  col *= 1.0 - 0.3 * cWet; pRough = mix(pRough, 0.45, cWet);
  diffuseColor.rgb = col; roughnessFactor = pRough;
}`;
const CLOTH_FRAG = CF_HEAD + CF_KIND + CF_DETAIL + CF_DIRT + CF_WEAR;
const RETRO_EMIT = 'totalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * cRetroMask * cRetro * clamp(dot(normal, normalize(vViewPosition)) * 1.3 - 0.1, 0.0, 1.0);';
// fold bump: sin bands around the elbow, the knee, the waist, the armpit, modulated by noise
const CLOTH_NORMAL = `
{ vec3 b = vBind; float reg = vHero.x, along = vHero.y;
  float h = 0.0;
  // HUMAN c6: the region gates are smooth for c6 cloth. reg is interpolated across a seam triangle, and a hard gate (reg > 7.5) switched
  // the fold field off mid-triangle, so its derivative drew a dotted crack along the groin and round the elbow. Older figures keep the hard gates.
  float armW, legW, torW, farmK;
  if (cFoldK > 0.001) { armW = smoothstep(2.5, 2.95, reg) * (1.0 - smoothstep(4.05, 4.5, reg)); legW = smoothstep(7.5, 7.95, reg) * (1.0 - smoothstep(9.05, 9.5, reg));
    torW = smoothstep(1.5, 1.95, reg) * (1.0 - smoothstep(2.05, 2.5, reg)); farmK = smoothstep(3.2, 3.8, reg); }
  else { armW = (reg > 2.5 && reg < 4.5) ? 1.0 : 0.0; legW = (reg > 7.5 && reg < 9.5) ? 1.0 : 0.0; torW = (reg > 1.5 && reg < 2.5) ? 1.0 : 0.0; farmK = reg < 3.5 ? 0.0 : 1.0; }
  float shinK = cFoldK > 0.001 ? smoothstep(8.2, 8.8, reg) : (reg < 8.5 ? 0.0 : 1.0);
  h += armW * sin(along * 70.0 + vn3(b * 20.0) * 6.0) * exp(-pow(along - mix(0.95, 0.05, farmK), 2.0) / 0.03);
  h += legW * (sin(along * 60.0 + vn3(b * 18.0) * 6.0) * exp(-pow(along - mix(0.97, 0.03, shinK), 2.0) / 0.02) + 0.6 * sin(b.y * 180.0 + vn3(b * 9.0) * 5.0) * smoothstep(0.35, 0.1, b.y));
  h += torW * 0.7 * sin(b.y * 150.0 + vn3(b * 12.0) * 6.0) * exp(-pow(b.y - 1.0, 2.0) / 0.004);
  h += (fbm3(b * 30.0) - 0.5) * 1.2;
  if (cFoldK > 0.001) {                                              // HUMAN c6: folds driven by the joints (a wrinkle map that follows the pose): cFlex = elbow L, R, knee L, R; cFlex2 = hip L, R
    float sd = vHero.z, eF = sd > 0.0 ? cFlex.x : cFlex.y, kF = sd > 0.0 ? cFlex.z : cFlex.w, hF = sd > 0.0 ? cFlex2.x : cFlex2.y, nz2 = vn3(b * 22.0 + 4.0);
    { float d = along - 1.0, inner = clamp(vBN.z * 0.8 + 0.4, 0.0, 1.0);
      h += armW * cFoldK * eF * 1.2 * sin(d * 62.0 + nz2 * 4.0 + b.x * 25.0) * exp(-d * d / 0.03) * inner;              // the inside of the elbow stacks
      h += armW * cFoldK * eF * 0.6 * sin(d * 34.0 + nz2 * 5.0) * exp(-d * d / 0.08) * (1.0 - inner); }               // the outside stretches into long diagonals
    { float d = along - 1.0, back = clamp(-vBN.z * 0.8 + 0.4, 0.0, 1.0);
      h += legW * cFoldK * kF * 1.4 * sin(d * 58.0 + nz2 * 4.0 + b.x * 22.0) * exp(-d * d / 0.025) * back;
      h += legW * cFoldK * kF * 0.7 * sin(d * 30.0 + nz2 * 5.0) * exp(-d * d / 0.06) * (1.0 - back);
      h += legW * cFoldK * hF * 1.6 * sin(along * 80.0 + nz2 * 6.0 + abs(b.x) * 30.0) * exp(-along * along / 0.04) * clamp(vBN.z, 0.0, 1.0); }   // the hip crease when the thigh comes up
    h += cFoldK * 0.5 * (fbm3(vec3(b.x * 14.0, b.y * 40.0, b.z * 14.0) + cSeed) - 0.5) * mix(0.6, 1.0, torW);     // garment drape breakup
    h *= 1.0 + 0.6 * cWear;
  }
  h *= 0.0009;
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition), r1 = cross(dy, normal), r2 = cross(normal, dx);
  float gx = dFdx(h), gy = dFdy(h);
  if (cFoldK > 0.001) { float gm = max(abs(gx), abs(gy)), cap = 0.00022; if (gm > cap) { gx *= cap / gm; gy *= cap / gm; } }   // HUMAN c6: cap the bump slope per pixel: a fold is gentle; at a region seam the field changed within a pixel or two and drew a dotted crack
  float det = dot(dx, r1); vec3 grad = sign(det) * (gx * r1 + gy * r2);
  normal = normalize(abs(det) * normal - grad);
}`;
// CLOTHING c1: the hero cloth pieces the fabric path (lib/fx/cloth/fabric_glsl.js) builds on: hero cuts and construction, fabric surface
// (vert: under a drape's CLOTH_REST the cuts read aRest, the undraped bind position, which cloth/fabric_glsl.js declares under that define)
// CLOTH3 (round 3, opt-in): the head for a SEWN panel (K2's patterns sewn by K1, built by K3's finish.js). It declares the locals the
// fabric surface reads (b, reg, along, K, PT, arm, leg, hemBand, belt, btn, pocket, nz) and nothing else: no bind-space cuts (neckline,
// cuff, tuck, hem: a sewn garment's edges are its own boundary and its tuck is K1's cull) and no painted construction (c6 placket, pockets,
// belt: finish.js builds construction as geometry). cloth/fabric_glsl.js uses it only for fabricMaterial({ sewn: true }); nothing in this
// file reads it, so every hero's shaders are as before. arm / leg false: a panel's coordinate is its own flat uv, not a hero limb.
const CF_HEAD_SEWN = `
{ vec3 b = vBind; float reg = vHero.x, along = vHero.y; int K = int(cKind + 0.5), PT = int(cPart + 0.5);
  bool arm = false, leg = false;
  float hemBand = 0.0, belt = 0.0, btn = 0.0, pocket = 0.0, nz = 0.0;
`;
export const HERO_CLOTH_GLSL = { vertPars: CLOTH_VERT_PARS, vert: CLOTH_VERT + '\n#ifdef CLOTH_REST\nvBind = aRest;\n#endif\n', fragPars: CLOTH_FRAG_PARS, head: CF_HEAD, detail: CF_DETAIL, emissive: RETRO_EMIT, sewnHead: CF_HEAD_SEWN };
const HAIR_FRAG_PARS = `varying vec4 vHero; varying vec3 vBind; uniform vec3 hHair; uniform float hSeed, hKind, hRecede; uniform vec4 hHead; uniform vec3 hMouthP;` + NOISE + `
float sst(float a, float b, float x){ return smoothstep(a, b, x); }`;
const HAIR_FRAG = `
{ vec3 b = vBind; float ang = atan(b.z, b.x);
  float eyeY = hHead.x, front = hHead.y, hcz = hHead.z, ax = abs(b.x);
  float fz = (b.z - hcz) / (front - hcz);
  float nz = (vn3(b * 160.0) - 0.5) * 0.003;
  float fine = vn3(vec3(ang * 900.0, b.y * 2500.0, hSeed));            // per-strand: the edge thins out instead of stopping
  if (hKind < 0.5) {                                                  // scalp: forehead line with temples, sideburns, nape
    float line = eyeY + 0.066 + hRecede + 0.014 * sst(0.015, 0.05, ax) * sst(0.3, 0.9, fz) - 0.008 * sst(0.0, 0.02, 0.02 - ax);
    float sideLine = eyeY + 0.03 + hHead.w - 0.06 * sst(0.3, -0.7, fz);          // sideburn down to the ear top, then the nape (hHead.w: c6 women, no sideburn)
    float l = mix(sideLine, line, sst(0.62, 0.82, fz));
    bool ear = ax > 0.062 && fz > 0.05 && fz < 0.5 && b.y < eyeY + 0.02;   // clear the ear
    if ((b.y - l - nz) / 0.009 < fine || ear) discard;
    if (hHead.w > 0.0 && b.y < eyeY + 0.025 && fz > -0.1) discard;     // c6 women: no sideburn strands in front of the ear
  } else {                                                            // beard: jaw, chin, moustache; clear the lips and cheeks
    float top = mix(eyeY - 0.045, eyeY - 0.03, sst(0.035, 0.065, ax));
    if ((top + nz - b.y) / 0.008 < fine) discard;
    vec2 lp = vec2(b.x / 0.028, (b.y - hMouthP.y) / 0.0095);
    if (dot(lp, lp) < 1.0 && b.z > hMouthP.z - 0.025) discard;
    if (fz < 0.1 && b.y > eyeY - 0.09) discard;                       // behind the jaw angle, under the ear
  }
  float strand = vn3(vec3(ang * 140.0, b.y * 30.0, hSeed)) * 0.6 + vn3(vec3(ang * 400.0, b.y * 60.0, hSeed + 3.0)) * 0.4;
  diffuseColor.rgb = hHair * (0.7 + 0.6 * strand);
  roughnessFactor = 0.55 + 0.3 * strand;
}`;
const EYE_FRAG_PARS = `varying vec4 vHero; uniform vec3 eIris; uniform float eSeed;` + NOISE;
const EYE_FRAG = `
{ vec3 d = normalize(vHero.yzw); float c = d.z;                       // eye-local direction, +z = the gaze
  float r = acos(clamp(c, -1.0, 1.0));
  vec3 white = vec3(0.86, 0.8, 0.74) * (0.9 + 0.1 * vn3(d * 30.0)); white = mix(white, vec3(0.8, 0.5, 0.45), 0.25 * smoothstep(0.7, 1.4, r));
  float iris = smoothstep(0.43, 0.4, r), pupil = smoothstep(0.17, 0.15, r);
  float fib = vn3(vec3(atan(d.y, d.x) * 12.0, r * 20.0, eSeed));
  vec3 ic = eIris * (0.6 + 0.6 * fib) * mix(1.0, 0.5, smoothstep(0.3, 0.42, r));
  vec3 col = mix(white, ic, iris); col = mix(col, vec3(0.01), pupil);
  diffuseColor.rgb = col; roughnessFactor = 0.08;
}`;
// HUMAN c8 HOOKS (o.eyeFit): the same eye with the iris edge from the fitted globe (vHero.x, rad) and a 1.8 mm pupil
const EYE_FRAG_FIT = EYE_FRAG.replace('float iris = smoothstep(0.43, 0.4, r), pupil = smoothstep(0.17, 0.15, r);',
  'float eI = vHero.x, eP = asin(sin(eI) * 1.8 / 5.85), iris = smoothstep(eI + 0.015, eI - 0.015, r), pupil = smoothstep(eP + 0.01, eP - 0.01, r);')
  .replace('mix(1.0, 0.5, smoothstep(0.3, 0.42, r))', 'mix(1.0, 0.5, smoothstep(eI - 0.115, eI + 0.005, r))');

// HUMAN c7: skin with a soft, red terminator. The direct diffuse is wrapped per channel (red furthest, blue least), the cheap form of
// pre-integrated skin shading (Penner and Borshukov, GPU Pro 2, 2011): light scattered under the skin carries red past the shadow line
// on the neck, under the nose and the jaw, instead of a cut to black. Specular keeps the true N.L.
const WRAP_DIFFUSE = `{ float nlW = dot( geometryNormal, directLight.direction ); vec3 wW = hSkinWrap;
    vec3 dW = clamp( ( vec3( nlW ) + wW ) / ( 1.0 + wW ), 0.0, 1.0 ); dW *= dW * ( 3.0 - 2.0 * dW ) * 0.35 + 0.65;
    reflectedLight.directDiffuse += dW * directLight.color * BRDF_Lambert( material.diffuseColor ); }`;
// HUMAN c7: asperity scattering (Koenderink and Pont, "The secret of velvety skin", 2003): the fine hairs of skin and the fibres standing
// off cloth scatter light FORWARD, so a body lit from behind gets a bright rim where its outline turns away from the eye. A smooth
// BRDF has no such lobe (light from straight behind cannot reflect toward the camera), which is why a figure with the sun behind it read
// as evenly lit, no rim. The term: a forward-scattering phase lobe x the path length through the fuzz layer (1 / N.V), only where the
// light reaches (it rides the light's own shadow), tinted by the surface.
const ASPERITY = u => `{ vec3 vA = normalize( geometryViewDir ); float fA = max( 0.0, dot( -vA, directLight.direction ) ); fA = fA * fA * fA * fA * fA * fA;
    float pA = 1.0 / max( abs( dot( geometryNormal, vA ) ), 0.22 ), gA = smoothstep( -0.3, 0.3, dot( geometryNormal, directLight.direction ) );
    reflectedLight.directDiffuse += directLight.color * ${u} * fA * pA * gA * ( material.diffuseColor * 0.6 + 0.04 ); }`;
// HUMAN c8 HOOKS: `lazy(sh, wrapped)` (the skin only) is asked at compile time for the opt-in parts in use and returns {} when none is
// (then this function emits exactly what it did before); `lazyKey()` adds to the program key. wrapped = another patch has chained onto
// this material's onBeforeCompile (an outside lane). Returned parts: vertPars, vert, fragPars, frag replace the defaults; normalPre runs
// BEFORE '#include <normal_fragment_maps>' (the hero has no normal map, so it is the first normal code, as a lane applied last was);
// diffuse replaces the direct-diffuse statement in lights_physical_pars (the ASPERITY term is still appended); lights after
// lights_physical_fragment; ao before aomap_fragment; lightsEnd after lights_fragment_end.
function patch(mat, { vertPars = SKIN_VERT_PARS, vert = SKIN_VERT, fragPars, frag, normal = '', uniforms = {}, key, emissive = '', wrap = false, asp = null, lazy = null, lazyKey = null }) {
  const fn = sh => {
    const L = lazy ? lazy(sh, mat.onBeforeCompile !== fn) : {}, vp = L.vertPars ?? vertPars, vt = L.vert ?? vert, fp = L.fragPars ?? fragPars, fr = L.frag ?? frag;
    Object.assign(sh.uniforms, uniforms);
    if (wrap || asp || L.diffuse) { const DL = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(DL, (L.diffuse || (wrap ? WRAP_DIFFUSE : DL)) + (asp ? ASPERITY(asp) : '')))
        .replace('#include <common>', '#include <common>\n' + (wrap ? 'uniform vec3 hSkinWrap;\n' : '') + (asp ? `uniform float ${asp};\n` : '')); }
    // CLOTHING c1 drape (cloth/drape.js sets material.defines.CLOTH_REST and the attribute aRest, the undraped bind position): the cuts and
    // the surface read the cloth's own coordinate, not where the drape moved it. Only when that define is set: undraped, the source is as before
    const rest = sh.defines && sh.defines.CLOTH_REST && vt.includes('vBind = position;');
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + vp + (rest ? '\nattribute vec3 aRest;' : '')).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (rest ? vt.replace('vBind = position;', 'vBind = aRest;') : vt));
    if (L.normalPre) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', L.normalPre + '\n#include <normal_fragment_maps>');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + fp)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + fr)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + normal)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + emissive);
    if (L.lights) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + L.lights);
    if (L.ao) sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', L.ao + '\n#include <aomap_fragment>');
    if (L.lightsEnd) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + L.lightsEnd);
  };
  mat.onBeforeCompile = fn;
  mat.customProgramCacheKey = () => key + (wrap ? '-wrap' : '') + (asp ? '-asp' : '') + (lazyKey ? lazyKey() : '');
  return mat;
}

// ---------------------------------------------------------------- the person
const OUTFITS = {   // shirt region coverage and kinds
  work: { top: 0, sleeve: 0.45, collar: 1 }, flannel: { top: 1, sleeve: 0.35, collar: 1 }, tee: { top: 3, sleeve: -0.62, collar: 0 },
  coat: { top: 3, sleeve: 1.0, collar: 1, coat: 1 }, leather: { top: 4, sleeve: 1.0, collar: 1, coat: 1 }, bare: { top: -1 },
  coverall: { top: 0, sleeve: 0.95, collar: 1, coverall: 1 },        // HUMAN c6: one garment, top and bottom the same cloth, no belt
};
// HUMAN c6: one shared uniform: a light near the lens (a headlamp, a truck's lights, a flash). Retroreflective tape sends
// it straight back, so tape that reads dull grey under the overhead key blazes when this is up. 0 = no light at the lens.
export const RETRO = { value: 0 };
export class Hero {
  constructor(data, o = {}) {
    const { meta, arr } = data, o0 = o;
    this.o = o = { variant: 'forge', height: 1.8, skin: '#b07a58', hair: '#2a1c12', eyes: '#4a3420', beard: 0.3, stubble: 0.7, age: 0.25, hairLen: 1,
      kind: 'work', shirt: '#3a4452', shirt2: '#1a1a1a', trousers: '#2c3e5e', trouserKind: 2, boots: '#3a2616', hat: 'none', hatColor: '#e8c020',
      dirt: 0.25, seed: 7, gloves: false, wear: 0, sweat: 0, folds: 0, vest: null, hairStyle: 'short', ease: 1, ...o };
    if (o.kind === 'coverall') { o.trousers = o.trousersSame === false ? o.trousers : o.shirt; o.trouserKind = 0; if (o.belt == null) o.belt = false; }
    const vi = Math.max(0, meta.variants.findIndex(v => v.name === o.variant)), V = meta.variants[vi];
    this.meta = meta; this.names = meta.bones.map(b => b.name); this.idx = Object.fromEntries(this.names.map((n, i) => [n, i]));
    const pos = arr('pos_' + V.name), n = meta.n;
    this.scale = o.height / V.height;
    this.group = new THREE.Group();       // scaled to the height at the end, after every mesh is bound
    // bones: identity bind rotations, positioned at their heads
    const heads = V.heads, tails = V.tails;
    this.bones = meta.bones.map((b, i) => { const B = new THREE.Bone(); B.name = b.name; return B; });
    meta.bones.forEach((b, i) => { const B = this.bones[i], h = heads[i], p = b.parent >= 0 ? heads[b.parent] : [0, 0, 0]; B.position.set(h[0] - p[0], h[1] - p[1], h[2] - p[2]); if (b.parent >= 0) this.bones[b.parent].add(B); });
    this.root = this.bones[this.idx.root]; this.group.add(this.root);
    this.bindPos = this.bones.map(B => B.position.clone());
    this.head0 = heads.map(h => new THREE.Vector3(...h)); this.tail0 = tails.map(t => new THREE.Vector3(...t));
    this.skeleton = new THREE.Skeleton(this.bones);
    this.group.updateMatrixWorld(true); this.skeleton.calculateInverses();
    // the retarget rig: parent table + bind bone directions + leg length (bvh.js)
    // retarget directions: from a bone's head to the head of the next joint the BVH maps (not to the MakeHuman tail,
    // which on the root points forward and on the forearm follows the A-pose), so the corrections line limbs up
    const I = this.idx;
    const dir = this.head0.map((h, i) => this.tail0[i].clone().sub(h).normalize());
    const TIP = { root: 'neck01', spine04: 'spine02', spine02: 'neck01', neck01: 'head', neck03: 'head', 'clavicle.L': 'upperarm01.L', 'clavicle.R': 'upperarm01.R',
      'upperarm01.L': 'lowerarm01.L', 'upperarm01.R': 'lowerarm01.R', 'lowerarm01.L': 'wrist.L', 'lowerarm01.R': 'wrist.R', 'wrist.L': 'finger3-1.L', 'wrist.R': 'finger3-1.R',
      'upperleg01.L': 'lowerleg01.L', 'upperleg01.R': 'lowerleg01.R', 'lowerleg01.L': 'foot.L', 'lowerleg01.R': 'foot.R' };
    for (const [b, t] of Object.entries(TIP)) if (I[b] != null && I[t] != null) dir[I[b]] = this.head0[I[t]].clone().sub(this.head0[I[b]]).normalize();
    this.rig = { parent: meta.bones.map(b => b.parent), dir, legLen: this.head0[I['upperleg01.L']].distanceTo(this.head0[I['foot.L']]),
      twist: [[I['lowerarm02.L'], I['wrist.L'], 0.6], [I['lowerarm02.R'], I['wrist.R'], 0.6]] };

    // shared per-vertex attributes: skin, region + limb coordinate, metric uvs for the G-buffer
    const SI = arr('skinIndex'), SW = arr('skinWeight'), REG = arr('region'), AL = arr('along');
    const aHero = new Float32Array(n * 4), uv = new Float32Array(n * 2);
    const hd = k => this.head0[I[k]];
    for (let v = 0; v < n; v++) {
      const r = REG[v], x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], s = x > 0 ? 'L' : 'R';
      // y: a continuous coordinate down each limb (arm: 0 shoulder, 1 elbow, 2 wrist, 3 fingertips; leg: 0 hip, 1 knee, 2 ankle)
      const lc = r === R.uarm || r === R.thigh ? AL[v] : (r === R.farm || r === R.hand || r === R.shin || r === R.foot) ? 1 + AL[v] : AL[v];   // fingers: 3 + phalanx + along (bake)
      aHero[v * 4] = r; aHero[v * 4 + 1] = lc; aHero[v * 4 + 2] = x > 0 ? 1 : -1;
      let a0, a1;
      if (r >= R.uarm && r <= R.finger) { a0 = hd('upperarm01.' + s); a1 = hd('wrist.' + s); }
      else if (r >= R.thigh && r <= R.foot) { a0 = hd('upperleg01.' + s); a1 = hd('foot.' + s); }
      if (a0) { const d = a1.clone().sub(a0).normalize(), p = new THREE.Vector3(x, y, z).sub(a0), u = p.dot(d), q = p.clone().addScaledVector(d, -u);
        const e1 = new THREE.Vector3(0, 0, 1).cross(d).normalize(), e2 = d.clone().cross(e1); uv[v * 2] = -u + 3; uv[v * 2 + 1] = Math.atan2(q.dot(e2), q.dot(e1)) * 0.05; }
      else { uv[v * 2] = y; uv[v * 2 + 1] = Math.atan2(x, z) * 0.14; }
    }
    this.aHero = aHero;
    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    base.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4)); base.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    base.setAttribute('aHero', new THREE.BufferAttribute(aHero, 4)); base.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const bodyIdx = arr('idx_body');
    base.setIndex(new THREE.BufferAttribute(bodyIdx, 1)); base.computeVertexNormals();
    this.nrm = base.attributes.normal.array;
    this._pads = {};      // palm-side vertices of each finger's last two phalanges: the skin that must touch a handle
    // dorsal flag for finger and hand vertices (nails, knuckle creases, tendons): normal against the palm normal
    for (const side of ['L', 'R']) { const h = n => this.head0[I[`${n}.${side}`]], a = h('finger5-1').clone().sub(h('finger2-1')).normalize(), f = h('finger3-1').clone().sub(h('wrist')).normalize();
      const pn = new THREE.Vector3().crossVectors(f, a).normalize(); if (this.tail0[I[`finger1-3.${side}`]].clone().sub(h('finger2-1')).dot(pn) < 0) pn.negate();
      const sg = side === 'L' ? 1 : -1, N = this.nrm;
      for (let v = 0; v < n; v++) { const r = REG[v]; if ((r !== R.finger && r !== R.hand) || Math.sign(pos[v * 3]) !== sg) continue;
        aHero[v * 4 + 3] = clamp(-(N[v * 3] * pn.x + N[v * 3 + 1] * pn.y + N[v * 3 + 2] * pn.z) * 1.6);
        if (r === R.finger && aHero[v * 4 + 3] < 0.05 && AL[v] >= 4) { const bn = meta.bones[SI[v * 4]].name, f = bn.slice(0, 7); (this._pads[side + f] ||= []).push(v); } } }
    // expression morphs
    base.morphAttributes.position = meta.expr.map(e => new THREE.BufferAttribute(arr('expr_' + e), 3)); base.morphTargetsRelative = true;
    this.exprIndex = Object.fromEntries(meta.expr.map((e, i) => [e, i]));

    // features for the skin shader (bind space)
    const eyes = arr('eyes_' + V.name), eside = arr('eye_side'), eL = new THREE.Vector3(), eR = new THREE.Vector3(); let nL = 0, nR = 0;
    for (let k = 0; k < meta.ne; k++) { const p = new THREE.Vector3(eyes[k * 3], eyes[k * 3 + 1], eyes[k * 3 + 2]); if (eside[k]) { eL.add(p); nL++; } else { eR.add(p); nR++; } }
    eL.divideScalar(nL); eR.divideScalar(nR); this.eyeL = eL; this.eyeR = eR;
    // HUMAN c8 HOOKS (P2): a face that knows its own stomion (face/face.js withFace writes V.mouth) gives it; else the rule of thumb
    const mouth = V.mouth ? new THREE.Vector3(...V.mouth) : this._featureMouth(pos, n, REG, eL, eR), chin = new THREE.Vector3(0, mouth.y - 0.05, mouth.z - 0.01);
    this.mouth = mouth; if (V.mouth) this.mouthFrom = 'V.mouth';   // (HOOKS: face/face.js fitHeroFeatures reads it)

    const rnd = mulberry(o.seed * 7919 + 3);
    this.sex = V.sex || 'm';
    this._c6 = !!(o.folds || o.wear || o.vest || o.sweat || o.kind === 'coverall');     // HUMAN c6 figure: the c6 cloth rules apply
    const skinU = { hCover: { value: new THREE.Vector4(0, 0, 0, 0) }, hCover2: { value: new THREE.Vector4(0, 0, 0, 0) }, hSweat: { value: o.sweat }, hHair: { value: new THREE.Color(o.hair) }, hStubble: { value: o.stubble }, hDirt: { value: o.dirt }, hAge: { value: o.age }, hSeed: { value: rnd() * 10 },
      hEyeL: { value: eL }, hEyeR: { value: eR }, hMouth: { value: mouth }, hChin: { value: chin }, hBoots: { value: 0 } };
    this.skinU = skinU;
    if (o.c7) { skinU.hSkinWrap = { value: new THREE.Vector3(...(o.skinWrap || [0.5, 0.2, 0.12])) }; skinU.hAsp = { value: o.asperity ?? 0.6 }; }
    // HUMAN c8 HOOKS (H2, lane D): skinU.hBrow weights hero.js's painted brow (1 = as before; 0 = off under card brows, and the lid
    // shadow takes soft ends). Its GLSL is emitted only once the value has left 1 (setting it does that, before or after the first
    // render), so an ungroomed hero's source is unchanged; non-enumerable, so it is not in the uniforms an untouched hero hands three.
    const hBrowU = { _v: 1, _gl: false, _mat: null, get value() { return this._v; }, set value(v) { if (v === this._v) return; this._v = v; if (v !== 1 && !this._gl && this._mat) this._mat.needsUpdate = true; } };
    Object.defineProperty(skinU, 'hBrow', { value: hBrowU, enumerable: false });
    for (const hk of [].concat(o.skinHook || [])) Object.assign(skinU, hk.uniforms || {});   // H1: a hook's uniforms ride in skinU
    const skinMat = patch(new THREE.MeshPhysicalMaterial({ color: o.skin, roughness: 0.5, sheen: o.c7 ? 0.22 : 0.55, sheenRoughness: 0.45, sheenColor: new THREE.Color(o.c7 ? '#c87866' : '#ff5a3c'), clearcoat: 0.08, clearcoatRoughness: 0.5 }),
      { fragPars: SKIN_FRAG_PARS, frag: SKIN_FRAG, uniforms: skinU, key: o.softBrows ? 'hero-skin-sb' : 'hero-skin', wrap: !!o.c7, asp: o.c7 ? 'hAsp' : null,   // HUMAN c7: the red sheen went saturated orange under light/'s display
        lazy: (sh, wrapped) => { const L = this._skinLazy(sh, wrapped); if (L.frag && o.softBrows && hBrowU._v !== 1) L.frag = L.frag.replace(SOFT_BROW_PAINT, SOFT_BROW_PAINT_H); return L; }, lazyKey: () => (hBrowU._v !== 1 ? '-brow' : '') + [].concat(this.o.skinHook || []).map(hk => '|' + (hk.key || 'hook')).join('') });
    hBrowU._mat = skinMat;
    if (o.softBrows) skinMat.defines = { ...(skinMat.defines || {}), HERO_SOFT_BROWS: '' };     // opt-in (8 Oct 2026): brows without card edges, no forehead seam (SKIN_FRAG)
    this.body = new THREE.SkinnedMesh(base, skinMat); this.body.frustumCulled = false; this.body.castShadow = this.body.receiveShadow = true;
    this.body.userData.subject = 1; this.body.userData.part = 'skin';
    this.group.add(this.body); this.body.bind(this.skeleton, new THREE.Matrix4());
    this.meshes = [this.body];

    // ---- clothing shells: each covers a superset of faces; the hems (cuff, waist, neckline, trouser bottom, boot top)
    // are cut exactly in the cloth shader on continuous coordinates, so edges are clean lines, not triangle zig-zags
    const fit = OUTFITS[o.kind] || OUTFITS.work, yv = v => pos[v * 3 + 1], lcv = v => aHero[v * 4 + 1];
    const hipY = this.head0[I['upperleg01.L']].y, waistY = this.head0[I.spine04].y + 0.01, neckY = this.head0[I.neck01].y + 0.035;
    this.hems = { armEnd: 1 + (fit.sleeve ?? 0.45), legEnd: 1.9, bootTop: 1.8, waistY, tuckY: waistY - 0.09, neckY, hipY };
    if (o.sleeve != null) this.hems.armEnd = 1 + o.sleeve;
    const H = this.hems, tri = bodyIdx;
    const cov = (v, part) => {
      const r = REG[v], y = yv(v), lc = lcv(v);
      if (part === 'top') { if (fit.top < 0) return false;
        if (r === R.torso || r === R.neck) return y < H.neckY + 0.03;
        if (r === R.uarm || r === R.farm) return lc < H.armEnd + 0.12;
        if (r === R.pelvis) return y > H.tuckY - 0.03 || !!fit.coat;
        if (r === R.thigh) return false;          // cycle 2: a coat wrapped round each thigh read as shorts; it ends at the hip
        return false; }
      if (part === 'bottom') { if (r === R.pelvis || r === R.thigh) return true;
        if (this._c6 && y < H.waistY && y > H.hipY - 0.22 && Math.abs(pos[v * 3]) < 0.1 && r !== R.uarm && r !== R.farm && r !== R.hand && r !== R.finger) return true;   /* HUMAN c6: the crotch, whatever region the bake gave it (a hole there showed the body) */
        if (r === R.shin || r === R.foot) return lc < H.legEnd + 0.1; return (r === R.torso) && y < H.waistY + (this._c6 ? 0.09 : 0.03); }
      if (part === 'boots') return (r === R.foot) || (r === R.shin && lc > H.bootTop - 0.1);
      return false;
    };
    const mkShell = (part, thick) => {
      const faces = []; for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b2 = tri[t + 1], c = tri[t + 2];
        if (part === 'top') { const rs = [REG[a], REG[b2], REG[c]]; if (rs.some(r => r === R.head || r === R.jaw)) continue;
          if (rs.some(r => r === R.neck) && !(cov(a, part) && cov(b2, part) && cov(c, part))) continue; }
        if (cov(a, part) || cov(b2, part) || cov(c, part)) faces.push(a, b2, c); }
      return this._shell(base, faces, thick, part);
    };
    this.cloth = {};
    if (o.cloth) this._fabInit(pos, REG);                              // CLOTHING c1: fabrics per garment (cloth/wardrobe.js) and the limb frames the fabric shader needs
    if (fit.top >= 0) this.cloth.top = this._addCloth(mkShell('top', fit.coat ? 0.03 : 0.015), { kind: fit.top, a: o.shirt, b: o.shirt2, dirt: o.dirt, part: 0, key: 'top' });
    // HUMAN c6: a coat hangs past the hips as one tube; so does a shirt worn out (o.untucked; a tee is worn out unless untucked: false)
    if (this._c6 && this.cloth.top && (fit.coat || o.untucked || (o.kind === 'tee' && o.untucked !== false))) { this.cloth.skirt = this._coatSkirt(base, pos, REG, o, !fit.coat);
      if (!fit.coat) this.cloth.top.material.uniforms_c6.cHem2.value.y = H.tuckY; }
    this.cloth.bottom = this._addCloth(mkShell('bottom', 0.012), { kind: o.trouserKind, a: o.trousers, b: o.trousers, dirt: o.dirt * 1.2, part: 1, key: 'bottom' });
    if (o.cloth && o.kind === 'coverall' && this.cloth.top) this._weldCoverall();   // CLOTHING c1: a coverall is one garment (no step at the waist)
    // HUMAN c6: a hi-vis vest over whatever the top is: a torso shell standing off the shirt (or coat), cut in the shader to armholes, V neck and hem
    if (o.vest) { const sx = Math.abs(this.head0[I['upperarm01.L']].x), armpit = this.head0[I['upperarm01.L']].y - 0.15, vh = H.waistY - 0.1;
      const vf = []; for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b2 = tri[t + 1], c = tri[t + 2]; const ok = v => (REG[v] === R.torso || REG[v] === R.pelvis || REG[v] === R.neck) && yv(v) > vh - 0.03 && yv(v) < H.neckY + 0.02; if (ok(a) && ok(b2) && ok(c)) vf.push(a, b2, c); }
      this._vestThick = (fit.coat ? 0.03 : 0.015) + 0.016;
      const col = o.vest === 'orange' ? '#ff6a10' : o.vest === 'hivis' ? '#c8f028' : o.vest;
      this.cloth.vest = this._addCloth(this._shell(base, vf, this._vestThick, 'vest'), { kind: 7, a: col, b: col, dirt: o.dirt * 0.7, part: 3, key: 'vest' });
      this.cloth.vest.material.uniforms_c6.cVest.value.set(sx, armpit, H.neckY, vh); }
    this.cloth.boots = o.c7 ? this._bootsC7(pos, REG, o) : this._boots(pos, REG, o);
    if (o.c7) this._c7parts(base, pos, REG, o, fit);
    // gloves (HUMAN c3): o.gloves = true (work gloves to the wrist) | 'gauntlet' (a lineman's rubber glove to mid-forearm).
    // A thin leather shell over the hand, the fingers and the cuff; o.gloveColor
    if (o.gloves) { const g0 = o.gloves === 'gauntlet' ? 1.5 : 1.9, gl = [], gs = o.glovesSide === 'L' ? 1 : o.glovesSide === 'R' ? -1 : 0,   // RIG c1: glovesSide 'L' | 'R' gloves one hand only (a bare hand beside a gloved one)
      inG = v => (!gs || Math.sign(pos[v * 3]) === gs) && (REG[v] === R.hand || REG[v] === R.finger || (REG[v] === R.farm && lcv(v) > g0));
      for (let t = 0; t < tri.length; t += 3) if (inG(tri[t]) && inG(tri[t + 1]) && inG(tri[t + 2])) gl.push(tri[t], tri[t + 1], tri[t + 2]);
      if (gl.length) this.cloth.gloves = this._addCloth(this._shell(base, gl, 0.0035, 'gloves'), { kind: 4, a: o.gloveColor || '#2a2420', b: o.gloveColor || '#2a2420', dirt: o.dirt * 0.6, part: 2, key: 'gloves' }); }
    // hair (short, a shell over the scalp with a hairline) and beard
    this._hair(base, pos, REG, eL, eR, mouth, o);
    // eyes
    { const g = new THREE.BufferGeometry(), ne = meta.ne, ep = eyes, ea = new Float32Array(ne * 4), es = new Uint16Array(ne * 4), ew = new Float32Array(ne * 4);
      // HUMAN c8 HOOKS (lane B, o.eyeFit): directions from the globe's centre (a sphere fitted to the front cap) instead of the shell's
      // vertex centroid, which sits 4-6 mm in front of it and drew a 3-4 mm iris (the startled stare); the iris edge is then
      // asin(5.85 mm / r) per eye (Rufer et al. 2005: white-to-white 11.7 mm), carried in aHero.x. eyeL / eyeR stay the centroids.
      const G = o.eyeFit ? this._eyeGlobes(ep, arr('idx_eyes'), ne, eside) : null;
      for (let k = 0; k < ne; k++) { const c = G ? G[eside[k] ? 1 : 0].c : eside[k] ? eL : eR, d = new THREE.Vector3(ep[k * 3], ep[k * 3 + 1], ep[k * 3 + 2]).sub(c).normalize(); ea.set([G ? G[eside[k] ? 1 : 0].iris : 0, d.x, d.y, d.z], k * 4); es[k * 4] = I.head; ew[k * 4] = 1; }
      if (G) { this.eyeGlobeL = G[1]; this.eyeGlobeR = G[0]; }
      g.setAttribute('position', new THREE.BufferAttribute(ep, 3)); g.setAttribute('aHero', new THREE.BufferAttribute(ea, 4));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(es, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(ew, 4));
      g.setIndex(new THREE.BufferAttribute(arr('idx_eyes'), 1)); g.computeVertexNormals();
      const m = patch(new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03 }),
        { vertPars: 'attribute vec4 aHero; varying vec4 vHero;', vert: 'vHero = aHero;', fragPars: EYE_FRAG_PARS, frag: G ? EYE_FRAG_FIT : EYE_FRAG, uniforms: { eIris: { value: new THREE.Color(o.eyes) }, eSeed: { value: rnd() * 10 } }, key: G ? 'hero-eye-fit' : 'hero-eye' });
      this.eyes = new THREE.SkinnedMesh(g, m); this.eyes.frustumCulled = false; this.eyes.bind(this.skeleton, new THREE.Matrix4()); this.eyes.userData.subject = 1; this.group.add(this.eyes); this.meshes.push(this.eyes); }
    // teeth and tongue (seen in a shout)
    for (const [k, col] of [['helper-upper-teeth', '#d8cdb8'], ['helper-lower-teeth', '#d0c4ae'], ['helper-tongue', '#8a3a36']]) {
      const g = new THREE.BufferGeometry(); for (const a of ['position', 'skinIndex', 'skinWeight']) g.setAttribute(a, base.attributes[a]);
      g.morphAttributes.position = base.morphAttributes.position; g.morphTargetsRelative = true;
      g.setIndex(new THREE.BufferAttribute(arr('idx_' + k), 1)); g.computeVertexNormals();
      const m = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial({ color: col, roughness: 0.35 })); m.frustumCulled = false; m.bind(this.skeleton, new THREE.Matrix4()); this.group.add(m); this.meshes.push(m); m.userData.subject = 1; m.userData.helper = true; m.visible = false;
      m.morphTargetInfluences = this.body.morphTargetInfluences;
    }
    this._hat(o);
    if (o.hairStyle === 'bun' || o.hairStyle === 'tail') this._hairTie(o);
    // shells are supersets cut in the colour shader, so they must not cast (the shadow pass would see the uncut shell
    // and put the face in the shadow of a beard that is not there); the body under them casts instead
    for (const m of this.meshes) { m.receiveShadow = true; m.castShadow = !(m.userData.part === 'hair' || m.userData.part === 'cloth') || m.userData.proc === true; }
    this._rest = this.bones.map(B => B.quaternion.clone());
    this.group.scale.setScalar(this.scale); this.group.updateMatrixWorld(true);
    this._flex = {};
    this._foldK = o.folds || 0;
    if (this._c6) this._coverSkin();
    // CLOTHING c1: garment shells cast, through a depth material that runs their cuts (cloth/fabric_glsl.js fabricDepth): the skin
    // inside a sleeve end was lit by a low sun through the gap (the glowing cuffs), and no garment shadowed another
    if (o.cloth) for (const [k, m] of Object.entries(this.cloth)) for (const x of [].concat(m || [])) if (!x.userData.proc && x.material.uniforms_c6) { x.customDepthMaterial = fabricDepth(x.material, HERO_CLOTH_GLSL); x.castShadow = true; }
    // and the skin hidden under a sleeve or trouser leg now stops ~6 cm inside the hem (it stopped 3 cm in): looking up into a sleeve end
    // the eye passed through the hidden skin and the arm's culled far side and out under the back of the hem, so the sky showed through
    // every sleeve end (the bright bands at dawn, grey under overcast). With the sleeve casting, the skin it now shows is in its shadow.
    if (o.cloth && this._c6) { this.skinU.hCover.value.x -= 0.1; this.skinU.hCover.value.y -= 0.1; }
    if (o.cloth) this.fabrics = Object.fromEntries(Object.entries(this.cloth).filter(([, m]) => m).map(([k, m]) => [k, Array.isArray(m) ? m.map(x => x.material.userData.fabric || null) : m.material.userData.fabric || null]));
    registerAudit(this);
    if (data && data.bundle && personWanted()) personQueue(this, o0);   // PRODUCTION: a scene's hero becomes the current person (below)
  }
  // the camera the audit measures this hero's gestures with (render.mjs -> gate.py people check)
  watch(camera) { this._auditCam = camera; return this; }
  // ---------------------------------------------------------------- HUMAN c8 HOOKS (all opt-in; review/studio_human_c8/after/hooks/NOTES.md)
  // H1: a lane's skin GLSL in named slots of the skin patch, instead of matching hero.js's text from outside. hook = { vertPars, vert,
  // fragPars, frag, normal, diffuse, lights, ao, lightsEnd, uniforms, key } (every field optional). Given as o.skinHook (an object or a
  // list) or later through this (a hook with the same key replaces the earlier one); takes effect at the next compile.
  useSkinHook(hook) {
    const L = [].concat(this.o.skinHook || []).filter(x => !hook.key || x.key !== hook.key); L.push(hook); this.o.skinHook = L.length === 1 ? L[0] : L;
    Object.assign(this.skinU, hook.uniforms || {}); this.body.material.needsUpdate = true; return this;
  }
  // o.eyeFit: per eye (index 1 = eside true, the left), the outer shell component's front cap (6 mm) fitted with a sphere by linear least
  // squares (likeness/eyes.js fitEyes, the same rule): { c, r, iris } with iris = asin(5.85 mm / r) in the hero's own metres
  _eyeGlobes(P, I, n, side) {
    const par = Int32Array.from({ length: n }, (_, i) => i), f = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
    for (let t = 0; t < I.length; t += 3) { const a = f(I[t]), b = f(I[t + 1]), c = f(I[t + 2]); par[b] = a; par[f(c)] = a; }
    const comps = new Map(); for (let i = 0; i < n; i++) { const k = f(i); if (!comps.has(k)) comps.set(k, []); comps.get(k).push(i); }
    return [0, 1].map(s => {
      const zmaxOf = vs => vs.reduce((m, i) => Math.max(m, P[i * 3 + 2]), -1e9), cs = [...comps.values()].filter(vs => !!side[vs[0]] === !!s).sort((a, b) => zmaxOf(b) - zmaxOf(a)), zmax = zmaxOf(cs[0]);
      const A = Array.from({ length: 4 }, () => new Float64Array(5));   // normal equations of |p|^2 = 2 c.p + d, augmented
      for (const i of cs[0]) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; if (z <= zmax - 0.006) continue; const row = [2 * x, 2 * y, 2 * z, 1], rhs = x * x + y * y + z * z;
        for (let a = 0; a < 4; a++) { for (let b = 0; b < 4; b++) A[a][b] += row[a] * row[b]; A[a][4] += row[a] * rhs; } }
      for (let c = 0; c < 4; c++) { let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]];
        for (let r = 0; r < 4; r++) if (r !== c) { const k = A[r][c] / A[c][c]; for (let q = c; q < 5; q++) A[r][q] -= k * A[c][q]; } }
      const cx = A[0][4] / A[0][0], cy = A[1][4] / A[1][1], cz = A[2][4] / A[2][2], d = A[3][4] / A[3][3], r = Math.sqrt(d + cx * cx + cy * cy + cz * cz);
      return { c: new THREE.Vector3(cx, cy, cz), r, iris: Math.asin(Math.min(0.95, 0.00585 / (r * this.scale))) }; });
  }
  // the skin's compile-time pieces: {} when no hook is in use (patch() then emits the c7 source as before)
  _skinLazy(sh, wrapped) {
    const hooks = [].concat(this.o.skinHook || []), hb = this.skinU.hBrow, brow = hb._v !== 1, cover = !!(sh.defines && sh.defines.SKIN_COVER);
    hb._gl = brow;
    if (!hooks.length && !brow && !cover && !wrapped) return {};
    const J = k => hooks.map(x => x[k]).filter(Boolean).join('\n');
    let vp = SKIN_VERT_PARS, vt = SKIN_VERT, fp = SKIN_FRAG_PARS, fr = SKIN_FRAG;
    if (brow) { fp += '\nuniform float hBrow;'; sh.uniforms.hBrow = hb;                                             // H2
      fr = fr.replace(BROW_PAINT, 'col = mix(col, hHair * 0.45, hBrow * inBrow * (0.35 + 0.65 * strokes));').replace(BROW_LID, `if (hBrow < 0.5) ${BROW_LID_SOFT} else ${BROW_LID}`); }
    if (cover) { vp += '\n#ifdef SKIN_COVER\nattribute float aCover; varying float vCover;\n#endif'; vt += '\n#ifdef SKIN_COVER\nvCover = aCover;\n#endif';   // H3
      fp += '\n#ifdef SKIN_COVER\nvarying float vCover;\n#endif'; fr = fr.replace(SKIN_HEAD, SKIN_HEAD + '#ifdef SKIN_COVER\n  if (vCover > 0.5) discard;   // under drawn cloth (the stack\'s aCover)\n#endif\n'); }
    if (hooks.length) fp += '\nfloat hNotSkin = 0.0;   // the paint mask: 1 where a paint over the skin is not skin (underwear, a band); lane B\'s light transport skips it';
    if (J('vertPars')) vp += '\n' + J('vertPars'); if (J('vert')) vt += '\n' + J('vert'); if (J('fragPars')) fp += '\n' + J('fragPars');
    // the hook's frag runs right after hero.js's own skin code and BEFORE any patch that still anchors on 'roughnessFactor = pRough;\n}':
    // it sits inside the skin block, which then ends on that anchor again (pRough re-read, a no-op), so old-anchor patches follow it
    if (J('frag')) fr = fr.slice(0, fr.lastIndexOf(SKIN_END)) + '  roughnessFactor = pRough;\n  {\n' + J('frag') + '\n  }\n  pRough = roughnessFactor;\n' + SKIN_END;
    if (wrapped || hooks.length) fr += '\n' + SKIN_MARKERS.join('\n');
    return { vertPars: vp, vert: vt, fragPars: fp, frag: fr, normalPre: J('normal'), diffuse: hooks.map(x => x.diffuse).filter(Boolean).pop() || null, lights: J('lights'), ao: J('ao'), lightsEnd: J('lightsEnd') };
  }

  _featureMouth(pos, n, REG, eL, eR) {        // the mouth: the most forward point of the face 5-8 cm under the eyes
    const eyeY = (eL.y + eR.y) / 2; let best = null;
    for (let v = 0; v < n; v++) { if (REG[v] !== R.head && REG[v] !== R.jaw) continue; const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      if (Math.abs(x) < 0.004 && y < eyeY - 0.055 && y > eyeY - 0.085 && (!best || z > best.z)) best = new THREE.Vector3(0, y, z); }
    // the parting line sits a little under the most forward point of the upper lip
    return best ? best.setY(best.y - 0.004) : new THREE.Vector3(0, eyeY - 0.07, eL.z);
  }
  // a skinned shell over the chosen body faces: pushed out along the bind normals by the cloth's thickness, then
  // relaxed (umbrella smoothing) so it bridges the body's hollows the way cloth does (spine groove, armpit, toes),
  // but never sinks below the minimum thickness. Loose parts (shin of a trouser leg, the belly of a shirt) stand off more.
  _shell(base, faces, thick, part) {
    const P = base.attributes.position.array, N = this.nrm, used = new Map(), vs = [];
    for (const v of faces) if (!used.has(v)) { used.set(v, vs.length); vs.push(v); }
    const m = vs.length, AH = base.attributes.aHero.array;
    const off = new Float32Array(m);
    vs.forEach((v, k) => { const r = AH[v * 4], lc = AH[v * 4 + 1], y = P[v * 3 + 1]; let t = thick;
      if (part === 'top') { if (r === R.uarm || r === R.farm) t = Math.min(t, 0.014) + 0.006 * Math.sin(Math.PI * clamp(lc - 0.15)) + 0.004; if (r === R.torso && P[v * 3 + 2] > 0) t += 0.004 * sstep(this.hems.waistY + 0.25, this.hems.waistY, y); if (r === R.torso && P[v * 3 + 2] < 0) t += 0.003; }
      if (part === 'bottom') { if (r === R.shin || r === R.foot) t += 0.008 + 0.02 * sstep(0.9, 1.9, lc); if (r === R.thigh) t += 0.006 + 0.006 * sstep(0.4, 1.0, lc); if (y > this.hems.waistY - 0.06) t += 0.003; }
      if (part === 'boots') { t += 0.004 + (r === R.foot ? 0.006 : 0); }
      if (this.o.ease !== 1 && (part === 'bottom' || part === 'top') && (t > thick || !this._c6)) t = thick + (t - thick) * this.o.ease;   // c6: ease loosens, never tightens (a sleeve thinner than the shell's base went under the skin)           // HUMAN c6: looser work clothes
      if (part === 'vest' && r === R.torso && P[v * 3 + 2] > 0) t += 0.006 * sstep(this.hems.waistY + 0.3, this.hems.waistY, y);
      if (part === 'hair') t = thick * (0.6 + 0.4 * sstep(this.eyeL.y + 0.02, this.skullTop, y));
      off[k] = t; });
    // neighbours
    const nb = Array.from({ length: m }, () => new Set());
    for (let t = 0; t < faces.length; t += 3) { const a = used.get(faces[t]), b = used.get(faces[t + 1]), c = used.get(faces[t + 2]); nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
    // HUMAN c6: cloth does not follow small anatomy (nipples, the cleft between breasts, the navel, the shoulder blades): the shell
    // keeps its distance from a SMOOTHED skin, not from the skin itself (c6 figures only; older calls keep the anatomy reference)
    let Pr = null;
    if (this._c6 && (part === 'top' || part === 'vest' || part === 'bottom')) { Pr = new Float32Array(m * 3); vs.forEach((v, k) => { for (let c = 0; c < 3; c++) Pr[k * 3 + c] = P[v * 3 + c]; });
      const its = part === 'vest' ? 80 : part === 'top' ? 80 : 10, inLim = part === 'bottom' ? 0.009 : 0.018;
      for (let it = 0; it < its; it++) { const Y = new Float32Array(Pr); for (let k = 0; k < m; k++) { const S = nb[k]; if (!S.size) continue; let sx = 0, sy = 0, sz = 0; for (const j of S) { sx += Pr[j * 3]; sy += Pr[j * 3 + 1]; sz += Pr[j * 3 + 2]; } const n = S.size;
        // inflate-only smoothing: a vertex may move out along its normal (bridging a hollow) but never in (it would cut a convex form)
        const dx = sx / n - Pr[k * 3], dy = sy / n - Pr[k * 3 + 1], dz = sz / n - Pr[k * 3 + 2], v = vs[k], dn = dx * N[v * 3] + dy * N[v * 3 + 1] + dz * N[v * 3 + 2];
        Y[k * 3] = Pr[k * 3] + 0.6 * dx; Y[k * 3 + 1] = Pr[k * 3 + 1] + 0.6 * dy; Y[k * 3 + 2] = Pr[k * 3 + 2] + 0.6 * dz;
        const q = (Y[k * 3] - P[v * 3]) * N[v * 3] + (Y[k * 3 + 1] - P[v * 3 + 1]) * N[v * 3 + 1] + (Y[k * 3 + 2] - P[v * 3 + 2]) * N[v * 3 + 2];
        if (q < -inLim) { Y[k * 3] -= N[v * 3] * (q + inLim); Y[k * 3 + 1] -= N[v * 3 + 1] * (q + inLim); Y[k * 3 + 2] -= N[v * 3 + 2] * (q + inLim); } } Pr = Y; } }
    const PR = Pr ? (k, c) => Pr[k * 3 + c] : (k, c) => P[vs[k] * 3 + c];
    // HUMAN c6: the offset direction is a SMOOTHED normal: with the skin's own normals a nipple, a navel or a knuckle of the
    // spine fans the offsets out and the bump comes back through the cloth however smooth the reference is
    const NK = new Float32Array(m * 3); vs.forEach((v, k) => { for (let c = 0; c < 3; c++) NK[k * 3 + c] = N[v * 3 + c]; });
    if (Pr) for (let it = 0; it < 12; it++) { const Y = new Float32Array(NK); for (let k = 0; k < m; k++) { let sx = NK[k * 3], sy = NK[k * 3 + 1], sz = NK[k * 3 + 2]; for (const j of nb[k]) { sx += NK[j * 3]; sy += NK[j * 3 + 1]; sz += NK[j * 3 + 2]; } const l = Math.hypot(sx, sy, sz) || 1; Y[k * 3] = sx / l; Y[k * 3 + 1] = sy / l; Y[k * 3 + 2] = sz / l; } NK.set(Y); }
    // HUMAN c6: the thickness is a smooth field. Each region adds its own ease (thigh, upper arm), so the offset stepped at the region
    // seams; the keep-thickness pass held the step and the cloth folded over itself along the groin and the elbow (a dark stitched V)
    if (Pr) for (let it = 0; it < 8; it++) { const o2 = new Float32Array(off); for (let k = 0; k < m; k++) { let sum = off[k], c = 1; for (const j of nb[k]) { sum += off[j]; c++; } o2[k] = sum / c; } off.set(o2); }
    let X = new Float32Array(m * 3); vs.forEach((v, k) => { for (let c = 0; c < 3; c++) X[k * 3 + c] = PR(k, c) + NK[k * 3 + c] * off[k]; });
    const iters = part === 'boots' ? 40 : part === 'hair' ? 2 : part === 'beard' ? 3 : part === 'bottom' ? 16 : part === 'top' ? 24 : part === 'vest' ? 30 : 6, lam = 0.55, keep = part === 'boots' ? 0.35 : 0.8;
    const relax = n => { for (let it = 0; it < n; it++) {
      const Y = new Float32Array(X);
      for (let k = 0; k < m; k++) { const S = nb[k]; if (!S.size) continue; let sx = 0, sy = 0, sz = 0; for (const j of S) { sx += X[j * 3]; sy += X[j * 3 + 1]; sz += X[j * 3 + 2]; }
        const n = S.size; Y[k * 3] = X[k * 3] + lam * (sx / n - X[k * 3]); Y[k * 3 + 1] = X[k * 3 + 1] + lam * (sy / n - X[k * 3 + 1]); Y[k * 3 + 2] = X[k * 3 + 2] + lam * (sz / n - X[k * 3 + 2]); }
      // keep at least the minimum thickness outside the skin
      for (let k = 0; k < m; k++) { const v = vs[k]; const dx = Y[k * 3] - PR(k, 0), dy = Y[k * 3 + 1] - PR(k, 1), dz = Y[k * 3 + 2] - PR(k, 2);
        const d = dx * NK[k * 3] + dy * NK[k * 3 + 1] + dz * NK[k * 3 + 2], need = off[k] * keep;
        if (d < need) { Y[k * 3] += NK[k * 3] * (need - d); Y[k * 3 + 1] += NK[k * 3 + 1] * (need - d); Y[k * 3 + 2] += NK[k * 3 + 2] * (need - d); } }
      X = Y;
    } };
    relax(iters);
    // the hang (cycle 2): cloth falls from the widest ring above it instead of following the anatomy below it
    if (part === 'top' || part === 'bottom' || part === 'vest') { this._hang(X, vs, P, AH, part === 'vest' ? 'top' : part); relax(4); }
    // HUMAN c6: weld. The body mesh splits its vertices along UV and region seams; each copy got its own offset, hang and smoothing,
    // so the shell cracked open along the seams (dotted dark lines at the groin, the elbow, the knee once the skin under it was hidden)
    if (Pr) { const key = k => `${Math.round(P[vs[k] * 3] * 2e4)},${Math.round(P[vs[k] * 3 + 1] * 2e4)},${Math.round(P[vs[k] * 3 + 2] * 2e4)}`, grp = new Map();
      for (let k = 0; k < m; k++) { const kk = key(k); (grp.get(kk) || grp.set(kk, []).get(kk)).push(k); }
      for (const [, g] of grp) { if (g.length < 2) continue; let sx = 0, sy = 0, sz = 0; for (const k of g) { sx += X[k * 3]; sy += X[k * 3 + 1]; sz += X[k * 3 + 2]; }
        for (const k of g) { X[k * 3] = sx / g.length; X[k * 3 + 1] = sy / g.length; X[k * 3 + 2] = sz / g.length; } } }
    // HUMAN c7: the drape. The chest panel of a top or a vest is a membrane in tension (garment.js drapeShell), pinned at the shoulders,
    // side seams and waist, resting on the smoothed skin: it bridges apex to apex, falls straight from each apex and rounds over it.
    if (this.o.c7 && Pr && (part === 'top' || part === 'vest')) { const H = this.hems, mob = new Float32Array(m);
      vs.forEach((v, k) => { if (AH[v * 4] !== R.torso) return; const y = P[v * 3 + 1];
        mob[k] = sstep(H.waistY - 0.02, H.waistY + 0.06, y) * (1 - sstep(H.neckY - 0.11, H.neckY - 0.05, y)) * sstep(0.05, 0.4, NK[k * 3 + 2]) * (1 - sstep(0.1, 0.16, Math.abs(P[v * 3]))); });
      this._drape = drapeShell(X, PR, NK, off, faces, used, mob, { its: this.o.drapeIts ?? 220, shrink: this.sex === 'f' ? 0.06 : 0.035 }); }
    const si = new Uint16Array(m * 4), sw = new Float32Array(m * 4), hero = new Float32Array(m * 4), uv = new Float32Array(m * 2), bind = new Float32Array(m * 3);
    const SI = base.attributes.skinIndex.array, SW = base.attributes.skinWeight.array, UV = base.attributes.uv.array;
    vs.forEach((v, k) => { for (let c = 0; c < 4; c++) { si[k * 4 + c] = SI[v * 4 + c]; sw[k * 4 + c] = SW[v * 4 + c]; hero[k * 4 + c] = AH[v * 4 + c]; } uv[k * 2] = UV[v * 2]; uv[k * 2 + 1] = UV[v * 2 + 1];
      if (Pr && (AH[v * 4] === R.torso || AH[v * 4] === R.pelvis || AH[v * 4] === R.neck)) hero[k * 4 + 1] = 0;   // HUMAN c6: 'along' is 0 where a limb starts, so it is continuous across the groin and shoulder seams (it jumped, and the knee wear and cuff grime drew a band along each seam)
      for (let c = 0; c < 3; c++) bind[k * 3 + c] = P[v * 3 + c]; });
    const idx = faces.map(v => used.get(v));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(X, 3)); g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setAttribute('aHero', new THREE.BufferAttribute(hero, 4)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    // HUMAN c7: the hang, hull and drape fold a few triangles over (their winding turns inward), and computeVertexNormals then averages
    // inward normals into the shading: under a hard key the cloth went pure black in patches (the chest of a coat, the upper arms),
    // whatever the light. Re-wind any triangle that faces into the body, and keep every vertex normal on the body's side.
    if (this.o.c7 && Pr) { for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2];
        const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, rx = NK[a * 3] + NK[b * 3] + NK[c * 3], ry = NK[a * 3 + 1] + NK[b * 3 + 1] + NK[c * 3 + 1], rz = NK[a * 3 + 2] + NK[b * 3 + 2] + NK[c * 3 + 2];
        if (nx * rx + ny * ry + nz * rz < 0) { idx[t + 1] = c; idx[t + 2] = b; } } }
    g.setIndex(idx); g.computeVertexNormals();
    if (this.o.cloth) g.userData.vs = vs;                              // CLOTHING c1: shell vertex -> body vertex (the coverall weld)
    if (this.o.c7 && Pr) { const Nn = g.attributes.normal.array; for (let k = 0; k < m; k++) { let x = Nn[k * 3], y = Nn[k * 3 + 1], z = Nn[k * 3 + 2]; const d = x * NK[k * 3] + y * NK[k * 3 + 1] + z * NK[k * 3 + 2];
        if (d < 0.3) { const w = 0.3 - d; x += NK[k * 3] * w * 1.5; y += NK[k * 3 + 1] * w * 1.5; z += NK[k * 3 + 2] * w * 1.5; } const l = Math.hypot(x, y, z) || 1; Nn[k * 3] = x / l; Nn[k * 3 + 1] = y / l; Nn[k * 3 + 2] = z / l; } }
    return g;
  }
  // Hang rule. TOP: torso/pelvis vertices below the chest are pushed out radially (about the body's axis, per 10-degree
  // sector) to at least the widest radius of their sector between them and the chest, so the shirt drops straight
  // from the chest and the shoulder blades (coats all the way to the hem; tucked shirts gather in to the belt).
  // BOTTOM: each trouser leg drops straight from the knee (tapering 8 % to the hem), and the seat bridges 8 cm below
  // the buttocks. In bind space, on the shell positions X (in place).
  _hang(X, vs, P, AH, part) {
    const I = this.idx, H = this.hems, coat = !!(OUTFITS[this.o.kind] || {}).coat, NB = 36, TAU = Math.PI * 2;
    const sectorOf = a => ((a / TAU + 1) % 1) * NB;
    const bmaxAt = (bm, f) => { const i0 = Math.floor(f) % NB, i1 = (i0 + 1) % NB, w = f - Math.floor(f); return bm[i0] * (1 - w) + bm[i1] * w; };
    const push = (k, cx, cz, r1) => { const dx = X[k * 3] - cx, dz = X[k * 3 + 2] - cz, r = Math.hypot(dx, dz); if (r < 1e-5 || r1 <= r) return; X[k * 3] = cx + dx * r1 / r; X[k * 3 + 2] = cz + dz * r1 / r; };
    if (part === 'top') {
      const ks = []; vs.forEach((v, k) => { const r = AH[v * 4]; if (r === R.torso || r === R.pelvis) ks.push(k); });
      if (!ks.length) return;
      // axis: the torso's z centre per 2 cm slice
      const zc = new Map(); for (const k of ks) { const y = Math.round(X[k * 3 + 1] / 0.02); const e = zc.get(y) || [1e9, -1e9]; e[0] = Math.min(e[0], X[k * 3 + 2]); e[1] = Math.max(e[1], X[k * 3 + 2]); zc.set(y, e); }
      const czAt = y => { const e = zc.get(Math.round(y / 0.02)); return e ? (e[0] + e[1]) / 2 : 0; };
      const fem = this.sex === 'f' || this._c6, axC = fem ? 0.15 : 0.06;           // HUMAN c6: a woman's shirt drops from the bust (the fullest point is off the midline)
      let chestY = 0, zmax = -1e9; for (const k of ks) if (Math.abs(X[k * 3]) < axC && X[k * 3 + 1] < H.neckY - 0.08 && (!fem || X[k * 3 + 1] > H.waistY + 0.12) && X[k * 3 + 2] > zmax) { zmax = X[k * 3 + 2]; chestY = X[k * 3 + 1]; }
      const y0 = chestY + 0.01, bm = new Float32Array(NB);
      ks.sort((a, b) => X[b * 3 + 1] - X[a * 3 + 1]);
      // cycle 3: ONE axis (the chest slice's centre) for every height. With a centre per slice the lordosis moved the
      // axis forward at the waist and the chest's front radius, applied from there, blew the shirt into a barrel belly
      // (and puffed the shoulders seen from behind). Now the cloth drops vertically from the chest ring, tapers 12%
      // toward the hem, and never stands more than 5 cm off the body.
      const cz0 = czAt(y0);
      // HUMAN c6: across the chest the cloth spans the hollows (the cleft between breasts or pectorals, under the arms' fold): each
      // 2 cm slice from the hang line up to the collar is pushed out to its own convex hull, so the garment reads as one volume
      if (this._c6) { const sl = new Map(); for (const k of ks) { const y = X[k * 3 + 1]; if (y < y0 - 0.02 || y > H.neckY - 0.04) continue; const key = Math.round(y / 0.02); (sl.get(key) || sl.set(key, []).get(key)).push(k); }
        for (const [, kk] of sl) { if (kk.length < 6) continue; const pts = kk.map(k => [X[k * 3], X[k * 3 + 2], k]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
          const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], hi = [];
          for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
          for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
          const hull = lo.slice(0, -1).concat(hi.slice(0, -1)); if (hull.length < 3) continue;
          let mx = 0, mz = 0; for (const p of hull) { mx += p[0]; mz += p[1]; } mx /= hull.length; mz /= hull.length;
          for (const p of pts) { const dx = p[0] - mx, dz = p[1] - mz, r = Math.hypot(dx, dz); if (r < 1e-5) continue; const ux = dx / r, uz = dz / r; let best = r;
            for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length], ex = b[0] - a[0], ez = b[1] - a[1], den = ux * ez - uz * ex; if (Math.abs(den) < 1e-9) continue;
              const t = ((a[0] - mx) * ez - (a[1] - mz) * ex) / den, u = ((a[0] - mx) * uz - (a[1] - mz) * ux) / den; if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) { best = Math.max(r, Math.min(t, r + 0.05)); break; } }
            X[p[2] * 3] = mx + ux * best; X[p[2] * 3 + 2] = mz + uz * best; } } }
      // HUMAN c6: above the bust the cloth spans in a straight line from the collarbones to the fullest point (a tent), instead of
      // following the breast's upper curve down to a shelf at the apex (which read as a cone, or a nipple, through the shirt)
      if (this._c6) { const yT = H.neckY - 0.07, NT = 72, sec = (x, z) => Math.round(((Math.atan2(x, z - cz0) / TAU + 1) % 1) * NT) % NT, rA = new Float32Array(NT), rT = new Float32Array(NT);
        for (const k of ks) { const y = X[k * 3 + 1], x = X[k * 3], z = X[k * 3 + 2], r = Math.hypot(x, z - cz0), i = sec(x, z);
          if (Math.abs(y - y0) < 0.015) rA[i] = Math.max(rA[i], r); if (Math.abs(y - yT) < 0.012) rT[i] = Math.max(rT[i], r); }
        if (yT > y0 + 0.04) for (const k of ks) { const y = X[k * 3 + 1]; if (y <= y0 || y >= yT) continue; const x = X[k * 3], z = X[k * 3 + 2], i = sec(x, z); if (!rA[i] || !rT[i]) continue;
          const u = (y - y0) / (yT - y0), tgt = rA[i] + (rT[i] - rA[i]) * u; push(k, 0, cz0, Math.min(tgt, Math.hypot(x, z - cz0) + 0.04)); } }
      for (const k of ks) { const y = X[k * 3 + 1], cz = cz0, dx = X[k * 3], dz = X[k * 3 + 2] - cz, r = Math.hypot(dx, dz), f = sectorOf(Math.atan2(dx, dz));
        if (y >= y0) { if (y < y0 + 0.08) { const i = Math.round(f) % NB; bm[i] = Math.max(bm[i], r); } continue; }
        const hang = coat ? 1 : sstep(H.tuckY - 0.01, H.waistY + 0.07, y);            // tucked: gathered in at the belt
        const target = Math.min(bmaxAt(bm, f) * (1 - (fem ? 0.06 : 0.12) * clamp((y0 - y) / 0.4)), r + (fem ? 0.085 : 0.05));
        if (hang > 0) push(k, 0, cz, r + Math.max(0, target - r) * hang);
        const i = Math.round(f) % NB; if (bm[i] === 0) bm[i] = r; }
    } else {
      for (const side of ['L', 'R']) {
        const a0 = this.head0[I['upperleg01.' + side]], kn = this.head0[I['lowerleg01.' + side]], an = this.head0[I['foot.' + side]];
        const ks = []; vs.forEach((v, k) => { const r = AH[v * 4]; if ((r === R.thigh || r === R.shin) && Math.sign(P[v * 3]) === (side === 'L' ? 1 : -1)) ks.push(k); });
        const axisAt = y => { const t = clamp((kn.y - y) / (kn.y - an.y)); return y > kn.y ? [a0.x + (kn.x - a0.x) * (a0.y - y) / (a0.y - kn.y), a0.z + (kn.z - a0.z) * (a0.y - y) / (a0.y - kn.y)] : [kn.x + (an.x - kn.x) * t, kn.z + (an.z - kn.z) * t]; };
        const bm = new Float32Array(NB);
        ks.sort((a, b) => X[b * 3 + 1] - X[a * 3 + 1]);
        for (const k of ks) { const y = X[k * 3 + 1], [cx, cz] = axisAt(y), dx = X[k * 3] - cx, dz = X[k * 3 + 2] - cz, r = Math.hypot(dx, dz), f = sectorOf(Math.atan2(dx, dz));
          if (y > kn.y + 0.1) continue;
          if (y >= kn.y - 0.02) { const i = Math.round(f) % NB; bm[i] = Math.max(bm[i], r); continue; }
          push(k, cx, cz, Math.max(r, bmaxAt(bm, f) * (1 - 0.08 * clamp((kn.y - y) / (kn.y - an.y))))); }
      }
      // the seat: back of the pelvis and upper thighs bridges down 8 cm from the buttocks' fullest point
      const ks = []; vs.forEach((v, k) => { const r = AH[v * 4]; if ((r === R.pelvis || r === R.thigh) && P[v * 3 + 2] < this.head0[I['upperleg01.L']].z) ks.push(k); });
      let buttY = 0, zmin = 1e9; for (const k of ks) if (X[k * 3 + 2] < zmin) { zmin = X[k * 3 + 2]; buttY = X[k * 3 + 1]; }
      for (const k of ks) { const y = X[k * 3 + 1]; if (y > buttY || y < buttY - 0.1) continue; const w = sstep(buttY - 0.1, buttY - 0.02, y);
        const z1 = zmin + (X[k * 3 + 2] - zmin) * (1 - w) ; if (Math.abs(X[k * 3]) < 0.16) X[k * 3 + 2] = Math.min(X[k * 3 + 2], z1 + 0.01 * (1 - w)); }
      // HUMAN c6: the front. Cloth does not follow the crotch: the fly front spans from thigh to thigh as one shallow dome over
      // whatever is under it (the trousers followed the anatomy and read as a body-stocking)
      if (this._c6) { const hz = this.head0[I['upperleg01.L']].z, kf = []; vs.forEach((v, k) => { const r = AH[v * 4]; if ((r === R.pelvis || r === R.thigh || r === R.torso) && P[v * 3 + 2] > hz && Math.abs(P[v * 3]) < 0.11) kf.push(k); });
        let crY = 1e9; for (const k of kf) if (Math.abs(X[k * 3]) < 0.02) crY = Math.min(crY, X[k * 3 + 1]);
        let zF = -1e9; for (const k of kf) { const y = X[k * 3 + 1]; if (Math.abs(X[k * 3]) < 0.05 && y > crY && y < crY + 0.14) zF = Math.max(zF, X[k * 3 + 2]); }
        if (zF > -1e8) for (const k of kf) { const y = X[k * 3 + 1], x = X[k * 3]; if (y < crY - 0.02 || y > crY + 0.2) continue;
          const w = sstep(crY - 0.02, crY + 0.03, y) * (1 - sstep(crY + 0.13, crY + 0.2, y)), zt = zF + 0.004 - 3.0 * x * x - 0.25 * Math.max(0, crY + 0.03 - y);
          if (zt > X[k * 3 + 2]) X[k * 3 + 2] += (zt - X[k * 3 + 2]) * w; } }
    }
  }
  // HUMAN c6: the skirt of a coat or jacket. The coat shell ends where the body's pelvis region ends, which is the groin
  // crease: a V at the front and a cut under each buttock, so every coat read as a leotard. Cloth does not follow that crease;
  // it falls from the hips as one tube round both thighs. This lofts that tube: rings from just under the waist down to the hem
  // (chore coat: well below the seat; jacket: at the seat), each ring the convex hull, seen from above, of everything above
  // it (the coat shell at the top, then the hips, the seat and both thighs pushed out by the cloth's thickness), so it drops
  // straight from the widest point and spans the gap between the legs; a turned hem gives the edge a thickness. Skinned
  // rigidly to the hips (each column takes the weights of the nearest pelvis vertex), so a stride can push a thigh through
  // the front: for standing and working heroes, not a walk cycle.
  _coatSkirt(base, pos, REG, o, shirt = false) {
    const H = this.hems, N = this.nrm, AH = base.attributes.aHero.array, SI = base.attributes.skinIndex.array, SW = base.attributes.skinWeight.array, n = this.meta.n;
    const leather = o.kind === 'leather', yTop = H.waistY - 0.01, yHem = H.hipY - (shirt ? 0.035 : leather ? 0.09 : 0.15), off = (shirt ? 0.01 : leather ? 0.013 : 0.015) * (o.ease || 1);
    H.skirtTop = yTop;                                               // the trousers stop under the coat (their waistband stood out through it)
    const TX = this.cloth.top.geometry.attributes.position.array, src = [];
    for (let k = 0; k < TX.length; k += 3) { const y = TX[k + 1]; if (y > yTop - 0.06 && y < yTop + 0.03) src.push([TX[k], y, TX[k + 2]]); }
    for (let v = 0; v < n; v++) { const r = REG[v], y = pos[v * 3 + 1]; if ((r === R.pelvis || r === R.thigh || r === R.torso) && y < yTop + 0.03 && y > yHem - 0.03)
      src.push([pos[v * 3] + N[v * 3] * off, y, pos[v * 3 + 2] + N[v * 3 + 2] * off]); }
    src.sort((a, b) => b[1] - a[1]);
    const hull = pts => { const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (O, A, B) => (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]), lo = [], hi = [];
      for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
      return lo.slice(0, -1).concat(hi.slice(0, -1)); };
    const radial = (hl, cx, cz, a) => { const ux = Math.sin(a), uz = Math.cos(a); let best = 0;
      for (let i = 0; i < hl.length; i++) { const A = hl[i], B = hl[(i + 1) % hl.length], ex = B[0] - A[0], ez = B[1] - A[1], den = ux * ez - uz * ex; if (Math.abs(den) < 1e-9) continue;
        const t = ((A[0] - cx) * ez - (A[1] - cz) * ex) / den, u = ((A[0] - cx) * uz - (A[1] - cz) * ux) / den; if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.max(best, t); } return best; };
    const NR = 9, NA = 56, rings = [];
    let cx = 0, cz = 0; { const h0 = hull(src.filter(p => p[1] > yTop - 0.04).map(p => [p[0], p[2]])); for (const p of h0) { cx += p[0]; cz += p[1]; } cx /= h0.length || 1; cz /= h0.length || 1; }
    for (let j = 0; j < NR; j++) { const t = j / (NR - 1), y = yTop + (yHem - yTop) * t, hl = hull(src.filter(p => p[1] >= y - 0.01).map(p => [p[0], p[2]]));
      const flare = 1 + 0.02 * t * t; rings.push({ y, r: Array.from({ length: NA }, (_, i) => radial(hl, cx, cz, i / NA * Math.PI * 2) * flare + 0.003) }); }
    // the top edge tucks 1.5 cm inside the coat shell, so the skirt grows out of the coat's surface instead of starting at a lip
    rings.unshift({ y: yTop + 0.045, r: rings[0].r.map(r => r - 0.015) });
    // the turned hem: a ring folded back inside, 1.2 cm up
    const last = rings[NR - 1]; rings.push({ y: last.y + 0.012, r: last.r.map(r => r - 0.007) });
    // pelvis vertices for the weights
    const pv = []; for (let v = 0; v < n; v++) if (REG[v] === R.pelvis && pos[v * 3 + 1] > H.hipY - 0.02) pv.push(v);
    if (o.c7 && !shirt) {   // HUMAN c7: two halves (back vent, front overlap) that follow the thighs, patch pockets as parts (garment.js skirtC7)
      const { skirt, pockets } = skirtC7(this, { rings, cx, cz, NA, pos, SI, SW, AH, pv, yTop, R }), fit = OUTFITS[o.kind] || OUTFITS.work;
      const m = this._addCloth(skirt, { kind: fit.top, a: o.shirt, b: o.shirt2, dirt: o.dirt, part: 0, key: 'skirt' }); m.userData.proc = true; m.material.uniforms_c6.cHem2.value.y = yHem - 0.2;
      for (const c of [m, this.cloth.top]) c.material.uniforms_c6.cVest.value.set(1, yHem, yTop, H.waistY);
      const pk = this._addCloth(pockets, { kind: fit.top, a: o.shirt, b: o.shirt2, dirt: o.dirt * 1.2, part: 6, key: 'pockets' }); pk.userData.proc = true; this.cloth.pockets = pk;
      return m; }
    const P = [], si = [], sw = [], ah = [], idx = [];
    for (let i = 0; i <= NA; i++) { const a = (i % NA) / NA * Math.PI * 2, ux = Math.sin(a), uz = Math.cos(a);
      const r0 = rings[0].r[i % NA], qx = cx + ux * r0, qz = cz + uz * r0; let bv = pv[0], bd = 1e9;
      for (const v of pv) { const d = (pos[v * 3] - qx) ** 2 + (pos[v * 3 + 1] - yTop) ** 2 * 0.3 + (pos[v * 3 + 2] - qz) ** 2; if (d < bd) { bd = d; bv = v; } }
      rings.forEach((rg, j) => { const r = rg.r[i % NA]; P.push(cx + ux * r, rg.y, cz + uz * r); for (let c = 0; c < 4; c++) { si.push(SI[bv * 4 + c]); sw.push(SW[bv * 4 + c]); }
        ah.push(R.pelvis, 0, AH[bv * 4 + 2], AH[bv * 4 + 3]); }); }
    const NRr = rings.length;
    for (let i = 0; i < NA; i++) for (let j = 0; j < NRr - 1; j++) { const a = i * NRr + j, b = a + 1, c = a + NRr, d = c + 1; idx.push(a, b, c, c, b, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setAttribute('aHero', new THREE.Float32BufferAttribute(ah, 4)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(P.length / 3 * 2), 2));
    g.setIndex(idx); g.computeVertexNormals();
    const fit = OUTFITS[o.kind] || OUTFITS.work;
    const m = this._addCloth(g, { kind: fit.top, a: o.shirt, b: o.shirt2, dirt: o.dirt, part: 0, key: 'skirt' }); m.userData.proc = true; m.material.uniforms_c6.cHem2.value.y = yHem - 0.2;   // the skirt is its own hem
    if (!shirt) for (const c of [m, this.cloth.top]) c.material.uniforms_c6.cVest.value.set(1, yHem, yTop, H.waistY);
    return m;
  }
  // work boots: a lofted last per foot (heel counter, toe box, welt, sole), skinned to foot / toe / shin; the body's
  // own foot (toes) is cut away under it in the skin shader
  _boots(pos, REG, o) {
    const I = this.idx, n = this.meta.n, parts = [];
    for (const [side, sg] of [['L', 1], ['R', -1]]) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let v = 0; v < n; v++) if (REG[v] === R.foot && Math.sign(pos[v * 3]) === sg) { x0 = Math.min(x0, pos[v * 3]); x1 = Math.max(x1, pos[v * 3]); z0 = Math.min(z0, pos[v * 3 + 2]); z1 = Math.max(z1, pos[v * 3 + 2]); }
      const ank = this.head0[I['foot.' + side]], toeJ = this.head0[I['toe1-1.' + side]], cx = (x0 + x1) / 2, W = (x1 - x0) / 2 + 0.008, L = z1 - z0 + 0.02, zh = z0 - 0.008;
      const bF = I['foot.' + side], bT = I['toe1-1.' + side], bS = I['lowerleg02.' + side];
      // sections along the foot: [t (0 heel .. 1 toe), half width, height, centre y]
      const K = [[0, 0.55, 0.3, 0.045], [0.04, 0.8, 0.62, 0.05], [0.12, 0.92, 0.8, 0.06], [0.3, 0.9, 0.85, 0.062], [0.5, 1.0, 0.72, 0.055], [0.66, 1.02, 0.55, 0.047], [0.8, 0.95, 0.45, 0.041], [0.9, 0.8, 0.38, 0.036], [0.97, 0.55, 0.3, 0.032], [1, 0.2, 0.18, 0.03]];
      const seg = 28, rows = K.length, P = [], SI = [], SW = [];
      const toeZ = toeJ.z;
      for (const [t, w, h, yc] of K) for (let i = 0; i <= seg; i++) {
        const th = i / seg * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th), e = 2 / 3.2;
        const px = cx + sg * 0 + W * w * Math.sign(c) * Math.pow(Math.abs(c), e), py = Math.max(0.0, yc + 0.06 * h * Math.sign(sn) * Math.pow(Math.abs(sn), e) * (sn > 0 ? 1.3 : 0.75)), pz = zh + t * L;
        P.push(px, py, pz); const wt = sstep(toeZ - 0.02, toeZ + 0.02, pz); SI.push(bF, bT, 0, 0); SW.push(1 - wt, wt, 0, 0);
      }
      // shaft: rings round the ankle up the shin
      const shaftRows = 6, sh0 = rows * (seg + 1);
      for (let j = 0; j < shaftRows; j++) { const y = 0.06 + j / (shaftRows - 1) * 0.15, rx = W * 0.95 - j * 0.002, rz = 0.06 - j * 0.003, zc = ank.z - 0.015 + j * 0.002;
        for (let i = 0; i <= seg; i++) { const th = i / seg * Math.PI * 2; P.push(ank.x + rx * Math.cos(th), y, zc + rz * Math.sin(th)); const wt = sstep(0.1, 0.19, y); SI.push(bF, bS, 0, 0); SW.push(1 - wt, wt, 0, 0); } }
      const idx = [];
      const grid = (r0, nr) => { for (let j = 0; j < nr - 1; j++) for (let i = 0; i < seg; i++) { const a = r0 + j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1; idx.push(a, c, b, b, c, d); } };
      grid(0, rows); grid(sh0, shaftRows);
      // caps: heel and toe fans
      const cap = (r, flip) => { const c0 = P.length / 3; let sx = 0, sy = 0, sz = 0; for (let i = 0; i <= seg; i++) { sx += P[(r + i) * 3]; sy += P[(r + i) * 3 + 1]; sz += P[(r + i) * 3 + 2]; }
        P.push(sx / (seg + 1), sy / (seg + 1), sz / (seg + 1) + (flip ? 0.004 : -0.004)); SI.push(...SI.slice(r * 4, r * 4 + 4)); SW.push(...SW.slice(r * 4, r * 4 + 4));
        for (let i = 0; i < seg; i++) flip ? idx.push(c0, r + i, r + i + 1) : idx.push(c0, r + i + 1, r + i); };
      cap(0, false); cap((rows - 1) * (seg + 1), true);
      const g = new THREE.BufferGeometry(); const Pf = new Float32Array(P), hero = new Float32Array(P.length / 3 * 4);
      for (let k = 0; k < P.length / 3; k++) { hero[k * 4] = k >= sh0 && k < sh0 + shaftRows * (seg + 1) ? R.shin : R.foot; hero[k * 4 + 1] = 2 + (P[k * 3 + 1] > 0.02 ? 0 : -0.5); hero[k * 4 + 2] = sg; }
      g.setAttribute('position', new THREE.BufferAttribute(Pf, 3)); g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
      g.setAttribute('aHero', new THREE.BufferAttribute(hero, 4)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(P.length / 3 * 2).map((_, k) => k % 2 ? 0 : P[Math.floor(k / 2) * 3 + 2] * 3), 2));
      g.setIndex(idx); g.computeVertexNormals();
      parts.push(g);
    }
    const out = parts.map(g => { const m = this._addCloth(g, { kind: 6, a: o.boots, b: o.boots, dirt: o.dirt, part: 2, key: 'boots' }); m.material.side = THREE.FrontSide; m.userData.proc = true; return m; });
    this.skinU.hBoots.value = 1;
    return out;
  }
  // HUMAN c7: boots from parts (garment.js bootsC7): an upper on a wider sole (the welt), a heel block, lugs, a padded collar, laces
  _bootsC7(pos, REG, o) {
    const { geoms, lace } = bootsC7(this, pos, REG, R), out = [];
    geoms.forEach((g, i) => { const sole = i % 2 === 1; const m = this._addCloth(g, { kind: 6, a: sole ? (o.soleColor || '#1e1b18') : o.boots, b: o.boots, dirt: o.dirt, part: 2, key: 'boots' }); m.material.side = THREE.FrontSide; m.userData.proc = true;
      m.material.uniforms_c6.cBootP.value.set(lace[0].cx, lace[1].cx, (lace[0].ankZ + lace[1].ankZ) / 2, lace[0].W); out.push(m); });
    this.skinU.hBoots.value = 1; return out;
  }
  // HUMAN c7: the parts that make the clothes real: a collar that closes over the neck, bound edges on the vest, rolled cuffs and
  // trouser hems (garment.js). Each is a skinned mesh with its own thickness, and casts (it is not cut in the shader).
  _c7parts(base, pos, REG, o, fit) {
    const SI = base.attributes.skinIndex.array, SW = base.attributes.skinWeight.array, H = this.hems, add = (g, spec) => { if (!g) return null; const m = this._addCloth(g, spec); m.userData.proc = true; m.userData.c7 = true; return m; };
    const top = this.cloth.top, colKind = o.kind === 'tee' ? 'band' : fit.coat ? 'coat' : 'shirt';
    // HUMAN c8 HOOKS (seam 16, opt-in o.collarEdge): a tee's band follows the shirt's drawn neckline (garment.js collar edge), not the cut line
    if (top && o.collar !== false) this.cloth.collar = add(collar(this, pos, REG, SI, SW, R, { kind: colKind, gap: colKind === 'band' ? 0.02 : 0.42, onto: top.geometry, ...(o.cloth ? { fit: true } : {}), ...(o.collarEdge && colKind === 'band' ? { edge: true } : {}) }), { kind: fit.top, a: o.shirt, b: o.shirt2, dirt: o.dirt, part: 4, key: 'collar' });
    const rims = [];
    if (this.cloth.vest) { const cv = this.cloth.vest.material.uniforms_c6.cVest.value, col = o.vest === 'orange' ? '#c84a08' : o.vest === 'hivis' ? '#98b818' : o.vest;
      rims.push(add(rim(this.cloth.vest.geometry, CUTS.vest(cv), { rn: 0.0045, rt: 0.008 }), { kind: 0, a: col, b: col, dirt: o.dirt * 0.8, part: 5, key: 'rims', fab: this._fabMap?.vest })); }
    if (top && H.armEnd < 2.05) rims.push(add(rim(top.geometry, CUTS.cuff(H.armEnd), { rn: 0.0045, rt: 0.008, smooth: 6 }), { kind: fit.top, a: o.shirt, b: o.shirt2, dirt: o.dirt, part: 5, key: 'rims', fab: this._fabMap?.top }));
    if (this.cloth.bottom) rims.push(add(rim(this.cloth.bottom.geometry, CUTS.hem(H.legEnd), { rn: 0.005, rt: 0.01, smooth: 6 }), { kind: o.trouserKind, a: o.trousers, b: o.trousers, dirt: o.dirt * 1.2, part: 5, key: 'rims', fab: this._fabMap?.bottom }));
    this.cloth.rims = rims.filter(Boolean);
    for (const m of [...this.cloth.rims, this.cloth.collar].filter(Boolean)) m.material.uniforms_c6.cAsp.value *= 0.22;   // thin tubes: the 1/N.V path term over-brightened their whole turn (glowing cuffs against the sun)
  }
  // CLOTHING c1 (o.cloth): the fabric of each garment (cloth/wardrobe.js heroFabrics: o.kind / o.trouserKind / o.vest defaults, o.cloth
  // as a { part: fabric } map overrides) and the hero-level numbers the fabric shader reads: each limb's bind axis (shoulder -> wrist,
  // hip -> ankle) with its lateral direction (seam angle 0 = the outside of the limb, pi = the underarm / inseam), the mean radius of
  // each (the coordinate round a limb is angle x radius, in metres), the torso's radius and axis depth, the segment lengths.
  _fabInit(pos, REG) {
    const I = this.idx, J = k => this.head0[I[k]], n = this.meta.n, O = [], D = [], E = [];
    this._fabMap = heroFabrics(this.o, typeof this.o.cloth === 'object' ? this.o.cloth : null);
    for (const [a, b, sg] of [['upperarm01.L', 'wrist.L', 1], ['upperarm01.R', 'wrist.R', -1], ['upperleg01.L', 'foot.L', 1], ['upperleg01.R', 'foot.R', -1]]) {
      const o = J(a).clone(), d = J(b).clone().sub(o).normalize(), x = new THREE.Vector3(sg, 0, 0); x.addScaledVector(d, -x.dot(d)).normalize(); O.push(o); D.push(d); E.push(x); }
    const rs = [0, 0, 0, 0], cn = [0, 0, 0, 0], p = new THREE.Vector3();
    for (let v = 0; v < n; v++) { const r = REG[v], i = (r === R.uarm || r === R.farm) ? (pos[v * 3] > 0 ? 0 : 1) : (r === R.thigh || r === R.shin) ? (pos[v * 3] > 0 ? 2 : 3) : -1; if (i < 0) continue;
      p.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]).sub(O[i]); p.addScaledVector(D[i], -p.dot(D[i])); rs[i] += p.length(); cn[i]++; }
    const yC = this.hems.waistY + 0.15; let z0 = 1e9, z1 = -1e9;
    for (let v = 0; v < n; v++) if (REG[v] === R.torso && Math.abs(pos[v * 3 + 1] - yC) < 0.03) { z0 = Math.min(z0, pos[v * 3 + 2]); z1 = Math.max(z1, pos[v * 3 + 2]); }
    const cz = z0 < z1 ? (z0 + z1) / 2 : 0; let rt = 0, ct = 0;
    for (let v = 0; v < n; v++) if (REG[v] === R.torso && Math.abs(pos[v * 3 + 1] - yC) < 0.03) { rt += Math.hypot(pos[v * 3], pos[v * 3 + 2] - cz); ct++; }
    const mr = (a, b) => (rs[a] / Math.max(1, cn[a]) + rs[b] / Math.max(1, cn[b])) / 2;
    this._fabU = { fLimbO: { value: O }, fLimbD: { value: D }, fLimbE: { value: E }, fRad: { value: new THREE.Vector4(mr(0, 1) + 0.012, mr(2, 3) + 0.015, (ct ? rt / ct : 0.14) + 0.02, cz) },
      fLen: { value: new THREE.Vector2(J('upperarm01.L').distanceTo(J('lowerarm01.L')), J('upperleg01.L').distanceTo(J('lowerleg01.L'))) } };
  }
  // CLOTHING c1: a coverall is ONE garment. hero.js builds it as a top and a bottom shell with their own offsets and hang, so the top's
  // lower edge stood off the bottom as a hem at the waist. Under o.cloth, over the band where both shells exist the bottom takes the
  // top's shape (1.5 mm outside it, never pulled in past most of its own offset) and its shading normal, blending back to its own shape
  // below: the top's edge lies under the bottom and the garment runs through. (Letting the top hang from the chest like a coat made a
  // pouch over the belly that met the trouser's fly in a crease: the shape is the drape's to solve. The drape should keep this band welded.)
  _weldCoverall() {
    const T = this.cloth.top.geometry, B = this.cloth.bottom.geometry, tv = T.userData.vs, bv = B.userData.vs; if (!tv || !bv) return;
    const P = this.body.geometry.attributes.position.array, BN = this.nrm, TX = T.attributes.position.array, BX = B.attributes.position.array, TN = T.attributes.normal.array, H = this.hems;
    const at = new Map(); tv.forEach((v, k) => at.set(v, k)); const m = bv.length, D = new Float32Array(m * 3), fixd = new Uint8Array(m); let n = 0;
    // the displacement that puts each bottom vertex on the top (1.5 mm out, never pulled in past most of its own offset), fixed where the
    // top's shell is whole (above tuckY + 1 cm); everywhere else it is diffused over the bottom shell's own connectivity, decaying over a
    // few rings, so the transition back to the trouser shape is smooth (following the top's coverage drew a crease along the groin)
    bv.forEach((v, k) => { const t = at.get(v); if (t == null || P[v * 3 + 1] < H.tuckY + 0.01) return;
      const d0 = i => (BX[i * 3] - P[v * 3]) * BN[v * 3] + (BX[i * 3 + 1] - P[v * 3 + 1]) * BN[v * 3 + 1] + (BX[i * 3 + 2] - P[v * 3 + 2]) * BN[v * 3 + 2];
      const q = [0, 1, 2].map(c => TX[t * 3 + c] + TN[t * 3 + c] * 0.0015), oq = (q[0] - P[v * 3]) * BN[v * 3] + (q[1] - P[v * 3 + 1]) * BN[v * 3 + 1] + (q[2] - P[v * 3 + 2]) * BN[v * 3 + 2], lift = Math.max(0, 0.8 * d0(k) - oq);
      for (let c = 0; c < 3; c++) D[k * 3 + c] = q[c] + BN[v * 3 + c] * lift - BX[k * 3 + c]; fixd[k] = 1; n++; });
    const nb = Array.from({ length: m }, () => new Set()), I = B.index.array; for (let i = 0; i < I.length; i += 3) for (const [a, b] of [[I[i], I[i + 1]], [I[i + 1], I[i + 2]], [I[i + 2], I[i]]]) { nb[a].add(b); nb[b].add(a); }
    for (let it = 0; it < 60; it++) { const E = new Float32Array(D); for (let k = 0; k < m; k++) { if (fixd[k] || !nb[k].size) continue; let x = 0, y = 0, z = 0; for (const j of nb[k]) { x += D[j * 3]; y += D[j * 3 + 1]; z += D[j * 3 + 2]; }
      const s = 0.93 / nb[k].size; E[k * 3] = x * s; E[k * 3 + 1] = y * s; E[k * 3 + 2] = z * s; } D.set(E); }
    for (let i = 0; i < m * 3; i++) BX[i] += D[i];
    B.attributes.position.needsUpdate = true; B.computeVertexNormals();
    const BNn = B.attributes.normal.array; bv.forEach((v, k) => { const t = at.get(v); if (t == null || !fixd[k]) return; for (let c = 0; c < 3; c++) BNn[k * 3 + c] = TN[t * 3 + c]; });   // the same shading normal as the top where they meet
    this._welded = n;
  }
  _addCloth(g, { kind, a, b, dirt, part = 0, key = null, fab = null }) {
    const H = this.hems, coat = !!(OUTFITS[this.o.kind] || {}).coat;
    const U = { cA: { value: new THREE.Color(a) }, cB: { value: new THREE.Color(b) }, cKind: { value: kind }, cDirt: { value: dirt }, cSeed: { value: this.o.seed * 1.7 }, cWet: { value: 0 },
      cPart: { value: part }, cHem: { value: new THREE.Vector4(H.armEnd, H.legEnd, H.bootTop, H.neckY) }, cHem2: { value: new THREE.Vector4(part === 1 && H.skirtTop != null ? H.skirtTop : H.waistY + (this._c6 ? 0.05 : 0), coat ? H.hipY - 0.3 : this._c6 ? H.waistY + 0.035 : H.tuckY, this.o.belt === false ? 0 : 1, 0) },   // c6: a tucked shirt goes into the trousers under the waistband (it hung outside them to the groin: a leotard)
      cWear: { value: this.o.wear || 0 }, cSweat: { value: this.o.sweat || 0 }, cFoldK: { value: this.o.folds || 0 }, cRetro: RETRO, cFlex: { value: (this._cFlex ||= new THREE.Vector4()) }, cFlex2: { value: (this._cFlex2 ||= new THREE.Vector4()) }, cVest: { value: new THREE.Vector4(0.2, 1.3, 1.5, 1.0) }, cC7: { value: this.o.c7 ? 1 : 0 }, cAsp: { value: this.o.c7 ? (this.o.clothAsperity ?? 0.9) : 0 }, cBootP: { value: new THREE.Vector4(0, 0, 0, 0) }, cBootP2: { value: new THREE.Vector4(0, 0, 0, 0) } };
    // CLOTHING c1 (o.cloth): the garment's fabric decides its surface (cloth/fabric_glsl.js); the cuts and construction above stay hero.js's
    const mat = this.o.cloth ? fabricMaterial({ fabric: fab || this._fabMap[key] || 'twillPC', color: a, color2: b, uniforms: { ...U, ...this._fabU }, glsl: HERO_CLOTH_GLSL, key: 'hero-fabric' }) : patch(new THREE.MeshPhysicalMaterial({ color: a, roughness: 0.85, sheen: kind === 4 || kind === 6 ? 0 : 0.3, sheenRoughness: 0.8, sheenColor: new THREE.Color(a).lerp(new THREE.Color('#ffffff'), 0.2), side: THREE.DoubleSide }),
      { vertPars: CLOTH_VERT_PARS, vert: CLOTH_VERT, fragPars: CLOTH_FRAG_PARS, frag: CLOTH_FRAG, normal: CLOTH_NORMAL, uniforms: U, key: 'hero-cloth', asp: this.o.c7 ? 'cAsp' : null,
        emissive: RETRO_EMIT });
    if (!this.o.cloth) mat.uniforms_c6 = U;
    const m = new THREE.SkinnedMesh(g, mat); m.frustumCulled = false; m.bind(this.skeleton, new THREE.Matrix4()); m.userData.subject = 1; m.userData.part = 'cloth';
    this.group.add(m); this.meshes.push(m); return m;
  }
  _hair(base, pos, REG, eL, eR, mouth, o) {
    const I = this.idx, eyeY = (eL.y + eR.y) / 2, n = this.meta.n, rnd = mulberry(o.seed * 31 + 5);
    const hc = this.head0[I.head], top = (() => { let t = 0; for (let v = 0; v < n; v++) if (REG[v] === R.head) t = Math.max(t, pos[v * 3 + 1]); return t; })();
    this.skullTop = top;
    const front = eL.z, recede = o.age * 0.02;
    const inHair = v => { if (REG[v] !== R.head) return false; const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], ax = Math.abs(x);
      const fz = (z - hc.z) / (front - hc.z + 1e-6);                // 0 at the head centre, 1 at the eyes
      let line = eyeY + 0.055 + recede + 0.012 * sstep(0.02, 0.05, ax) * sstep(0.3, 0.9, fz);          // forehead, temples (generous: the shader cuts)
      if (fz < 0.55) line = eyeY + 0.015 - 0.075 * sstep(0.35, -0.6, fz);                              // sideburn -> nape
      return y > line; };
    const bodyIdx = base.index.array, hf = [], bf = [];
    const inBeard = v => { if (!(o.beard > 0.05)) return false; const r = REG[v]; if (r !== R.head && r !== R.jaw) return false; const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], ax = Math.abs(x);
      if (z < hc.z - 0.02) return false; if (y > eyeY - 0.025) return false;
      return y > eyeY - 0.17; };
    for (let t = 0; t < bodyIdx.length; t += 3) { const a = bodyIdx[t], b = bodyIdx[t + 1], c = bodyIdx[t + 2];
      if (o.hairLen > 0 && (inHair(a) || inHair(b) || inHair(c))) hf.push(a, b, c);
      if (inBeard(a) || inBeard(b) || inBeard(c)) bf.push(a, b, c); }
    const HU0 = { hHair: { value: new THREE.Color(o.hair) }, hSeed: { value: rnd() * 10 }, hRecede: { value: recede }, hHead: { value: new THREE.Vector4(eyeY, front, hc.z, this._c6 && this.sex === 'f' ? 0.03 : 0) }, hMouthP: { value: mouth } };
    const mk = (faces, th, key) => { if (!faces.length) return null; const g = this._shell(base, faces, th, key);
      const HU = { ...HU0, hKind: { value: key === 'beard' ? 1 : 0 } };
      const m = new THREE.SkinnedMesh(g, patch(new THREE.MeshPhysicalMaterial({ color: o.hair, roughness: 0.6, sheen: 0.3, sheenRoughness: 0.4, sheenColor: new THREE.Color(o.hair).lerp(new THREE.Color('#ffffff'), 0.15) }),
        { fragPars: HAIR_FRAG_PARS, frag: HAIR_FRAG, uniforms: HU, key: 'hero-hair' }));
      m.material.side = THREE.DoubleSide;
      m.frustumCulled = false; m.bind(this.skeleton, new THREE.Matrix4()); m.userData.subject = 1; m.userData.part = 'hair'; this.group.add(m); this.meshes.push(m); return m; };
    this.hairMesh = mk(hf, 0.004 + 0.004 * o.hairLen, 'hair');
    this.beardMesh = mk(bf, 0.002 + 0.006 * o.beard, 'beard');
  }
  _hat(o) {
    if (o.hat === 'none') return;
    const I = this.idx, hb = this.bones[I.head], hc = this.head0[I.head], top = this.skullTop, eyeY = (this.eyeL.y + this.eyeR.y) / 2;
    const cx = 0, cz = hc.z - 0.005, band = eyeY + 0.07, g = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial({ color: o.hatColor, roughness: o.hat === 'hard' ? 0.3 : 0.85, clearcoat: o.hat === 'hard' ? 0.6 : 0, clearcoatRoughness: 0.3, sheen: o.hat === 'hard' ? 0 : 0.6, sheenColor: new THREE.Color(o.hatColor).lerp(new THREE.Color('#fff'), 0.3) });
    if (o.hat === 'hard') {
      // cycle 3: a real V-Gard profile. The cycle-2 shell hugged the skull (2.8 cm over the crown) with a flat flange, so
      // in profile it read as a bowler with a floating disc and the sky showed under the brim. Now: an egg crown that
      // stands 4.5 cm clear of the skull (the suspension), straighter sides, a centre ridge; a drip rim that turns DOWN
      // round the sides and back; a front peak angled ~14 degrees down; and the dark suspension band inside the shell
      // from the band down to the brow, so no light passes between hat and head.
      const fit = this._skullAt(band), rx = fit.rx + 0.009, rz = fit.rz + 0.009, Hh = top - band + 0.045;
      const pts = [new THREE.Vector2(0.975, -0.02), new THREE.Vector2(1.05, -0.022), new THREE.Vector2(1.12, -0.024), new THREE.Vector2(1.16, -0.032), new THREE.Vector2(1.17, -0.04), new THREE.Vector2(1.15, -0.042),
        new THREE.Vector2(1.1, -0.03), new THREE.Vector2(1.02, -0.012), new THREE.Vector2(1.0, 0.0)];
      for (let k = 1; k <= 20; k++) { const a = k / 20, th = a * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(th) * (1 + 0.035 * Math.sin(th * 2)) * (1 - 0.08 * a * a), 0.004 + Math.pow(Math.sin(th), 0.85) * Hh)); }
      const lg = new THREE.LatheGeometry(pts, 64), pa = lg.attributes.position;
      for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), rr = Math.hypot(x, z) || 1, ca = z / rr, fr = Math.pow(Math.max(0, ca), 1.4);
        if (y < -0.0005) { const r2 = 1 + (rr - 1) * (0.55 + 0.35 * Math.max(0, ca) + 1.0 * fr), k = r2 / rr; pa.setXYZ(i, x * k * rx, y * (1 - 0.7 * fr) - 0.014 * fr * (r2 - 1) / 0.3, z * k * rz); }   // the peak: longer, flatter, angled down
        else { const ridge = 1 + 0.07 * Math.exp(-Math.pow(x / rr / 0.11, 2)) * sstep(0.25 * Hh, Hh, y); pa.setXYZ(i, x * rx * ridge, y, z * rz * ridge * (ca > 0 ? 1.03 : 1)); } }
      lg.computeVertexNormals();
      const shell = new THREE.Mesh(lg, mat); shell.position.set(fit.cx, band - 0.004, fit.cz); mat.side = THREE.DoubleSide;
      g.add(shell);
      const susp = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.034, 40, 1, true), new THREE.MeshStandardMaterial({ color: '#1a1714', roughness: 0.9, side: THREE.DoubleSide }));
      susp.scale.set(fit.rx + 0.004, 1, fit.rz + 0.004); susp.position.set(fit.cx, band - 0.017, fit.cz); g.add(susp);
    } else if (o.hat === 'cap' || o.hat === 'knit') {
      // HUMAN c6 figures: the crown is fitted to this skull at the band (the cycle-1 crown was one size, so on a smaller head it stood off as a dome)
      const fit6 = this._c6 ? this._skullAt(band + 0.005) : null, R0 = fit6 ? fit6.rx + (o.hat === 'knit' ? 0.007 : 0.005) : 0.106, zs = fit6 ? (fit6.rz + 0.006) / R0 : 1.13;
      const H = top - band + (o.hat === 'knit' ? (fit6 ? 0.022 : 0.03) : 0.012), pts = []; for (let k = 0; k <= 14; k++) { const a = k / 14 * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * R0, Math.sin(a) * H * (1 + (o.hat === 'knit' ? 0.2 * Math.sin(a * 2) : 0)))); }
      const crown = new THREE.Mesh(new THREE.LatheGeometry(pts, 36), mat); crown.scale.set(1, 1, zs); crown.position.set(fit6 ? fit6.cx : cx, band - (fit6 ? 0.018 : 0.012), fit6 ? fit6.cz : cz - 0.004);
      if (fit6 && o.hat === 'knit') {   // HUMAN c6: a beanie is pulled down to the brows and over the tops of the ears, straight-sided, with a turned-up rib cuff, sitting lower at the back
        const b0 = eyeY + 0.028, f0 = this._skullAt(b0 + 0.004), f1 = this._skullAt(b0 + 0.04), Rb = f0.rx + 0.009, zk = (f0.rz + 0.009) / Rb, Hk = top - b0 + 0.02, kp = [];
        for (let k = 0; k <= 4; k++) { const u = k / 4; kp.push(new THREE.Vector2(Rb + (f1.rx + 0.008 - Rb) * u, 0.045 * u)); }
        for (let k = 1; k <= 14; k++) { const a = k / 14 * Math.PI / 2, r1 = f1.rx + 0.008; kp.push(new THREE.Vector2(Math.cos(a) * r1, 0.045 + Math.sin(a) * (Hk - 0.045) * (1 + 0.12 * Math.sin(a * 2)))); }
        crown.geometry.dispose(); crown.geometry = new THREE.LatheGeometry(kp, 40); crown.scale.set(1, 1, zk); crown.position.set(f0.cx, b0, f0.cz); crown.rotation.x = -0.12;
        const cuffP = [new THREE.Vector2(Rb + 0.002, -0.002), new THREE.Vector2(Rb + 0.007, 0.004), new THREE.Vector2(Rb + 0.0075, 0.03), new THREE.Vector2(Rb + 0.003, 0.036)];
        const cuff = new THREE.Mesh(new THREE.LatheGeometry(cuffP, 40), patch(mat.clone(), { fragPars: 'varying vec3 vBind;', frag: 'diffuseColor.rgb *= 0.8 + 0.2 * smoothstep(0.2, 0.8, abs(fract(atan(vBind.z, vBind.x) * 24.0) - 0.5) * 2.0);', key: 'hero-knit-rib' }));
        cuff.scale.set(1, 1, zk); cuff.position.copy(crown.position); cuff.rotation.x = -0.12; g.add(cuff); }
      g.add(crown);
      if (o.hat === 'cap') { const bill = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.005, 24, 1, false, -0.85, 1.7), mat); bill.scale.set(0.95, 1, 0.85); bill.position.set(fit6 ? fit6.cx : cx, band - (fit6 ? 0.016 : 0.012), fit6 ? fit6.cz + fit6.rz * 0.55 : cz + 0.07); bill.rotation.x = 0.18; g.add(bill); }
    }
    // HUMAN c6: a hard hat that has been worn (o.hatWear, default o.wear): scuffs and scratches, dirt in the ridge and under the
    // brim, the crown faded by sun, stickers on the sides. Opt-in; a new hat stays a new hat.
    const hw = o.hatWear ?? o.wear ?? 0;
    if (o.hat === 'hard' && hw > 0) {
      const HW = { hwK: { value: hw }, hwSeed: { value: (o.seed || 1) * 3.7 }, hwSt: { value: new THREE.Color(o.sticker || '#2a8a3a') } };
      mat.onBeforeCompile = sh => { Object.assign(sh.uniforms, HW);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvHP = position;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vHP; uniform float hwK, hwSeed; uniform vec3 hwSt;' + NOISE)
          .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
{ vec3 p = vHP; float up = clamp(p.y / 0.12, 0.0, 1.0), ang = atan(p.x, p.z);
  vec3 c = diffuseColor.rgb;
  c = mix(c, c * 0.82 + vec3(0.1, 0.1, 0.09), 0.5 * hwK * up * up);                                         // sun fade on the crown
  float scr = smoothstep(0.88, 0.97, vn3(vec3(ang * 40.0 + vn3(p * 30.0) * 3.0, p.y * 900.0, hwSeed)));       // fine scratches round the dome
  float gouge = smoothstep(0.86, 0.96, vn3(vec3(p.x * 60.0, p.y * 250.0, p.z * 60.0 + hwSeed)));
  c = mix(c, c * 0.55, hwK * (0.5 * scr + 0.6 * gouge));
  float grime = smoothstep(0.45, 0.8, fbm3(p * 40.0 + hwSeed)) * (0.4 + 0.6 * smoothstep(0.03, -0.02, p.y));    // dirt, heavier on the brim
  c = mix(c, vec3(0.16, 0.14, 0.11), 0.5 * hwK * grime);
  float side = step(0.0, p.x) * 2.0 - 1.0;
  vec2 q = vec2(p.z / 0.03 - 0.4 * side, (p.y - 0.06) / 0.022);                                              // a sticker on each side (a square and a cross)
  float st = step(abs(q.x), 1.0) * step(abs(q.y), 1.0) * step(0.08, abs(p.x));
  float crs = st * max(step(abs(q.x), 0.3), step(abs(q.y), 0.3));
  c = mix(c, side > 0.0 ? vec3(0.88, 0.86, 0.8) : hwSt, st * step(0.2, hwK) * (1.0 - 0.4 * scr));
  c = mix(c, side > 0.0 ? hwSt : vec3(0.88, 0.86, 0.8), crs * step(0.2, hwK));
  c *= 0.9 + 0.2 * (vn3(p * 18.0 + hwSeed) - 0.5) * hwK;                                                     // uneven
  diffuseColor.rgb = c; roughnessFactor = mix(roughnessFactor, 0.62, hwK * (0.5 + 0.5 * grime)); }`);
      };
      mat.customProgramCacheKey = () => 'hero-hardhat-wear'; mat.clearcoat = 0.6 * (1 - hw); mat.roughness = 0.3 + 0.25 * hw;
    }
    // hats live in the head bone's frame
    g.position.sub(hc); g.traverse(m => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; m.userData.subject = 1; } });
    hb.add(g); this.hatGroup = g;
  }
  // HUMAN c6: long hair tied back (o.hairStyle 'bun' | 'tail'): a bun low on the back of the head (it sits under a hard hat's
  // rim) or a tail from the nape to between the shoulder blades, in the head bone's frame, with strands along its length
  _hairTie(o) {
    const I = this.idx, hb = this.bones[I.head], hc = this.head0[I.head], eyeY = (this.eyeL.y + this.eyeR.y) / 2, sk = this._skullAt(eyeY + 0.02), g = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial({ color: o.hair, roughness: 0.55, sheen: 0.5, sheenRoughness: 0.35, sheenColor: new THREE.Color(o.hair).lerp(new THREE.Color('#fff'), 0.25) });
    mat.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTP = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTP;' + NOISE).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        { float a = atan(vTP.x, vTP.z); float st = vn3(vec3(a * 26.0, vTP.y * 14.0, 1.0)) * 0.6 + vn3(vec3(a * 80.0, vTP.y * 30.0, 2.0)) * 0.4; diffuseColor.rgb *= 0.65 + 0.6 * st; roughnessFactor = 0.45 + 0.35 * st; }`); };
    mat.customProgramCacheKey = () => 'hero-hairtie';
    const back = sk.cz - sk.rz;
    if (o.hairStyle === 'bun') { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat); m.scale.set(0.045, 0.038, 0.035); m.position.set(0, eyeY + 0.005, back - 0.012); g.add(m); }
    else { const pts = []; for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push(new THREE.Vector3(0, eyeY + 0.02 - 0.24 * t, back - 0.012 - 0.04 * Math.sin(t * 1.6))); }
      const curve = new THREE.CatmullRomCurve3(pts), tube = new THREE.TubeGeometry(curve, 24, 1, 14, false), pa = tube.attributes.position;
      for (let i = 0; i < pa.count; i++) { const v = new THREE.Vector3(pa.getX(i), pa.getY(i), pa.getZ(i)), t = clamp((eyeY + 0.02 - v.y) / 0.24), c = curve.getPoint(t), r = 0.034 * (1 - 0.6 * t) * (t < 0.1 ? 0.75 : 1) + 0.004; v.sub(c).normalize().multiplyScalar(r).add(c); pa.setXYZ(i, v.x, v.y, v.z); }
      tube.computeVertexNormals(); g.add(new THREE.Mesh(tube, mat));
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.004, 8, 20), new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.6 })); tie.position.copy(curve.getPoint(0.12)); tie.rotation.x = Math.PI / 2 - 0.3; g.add(tie); }
    g.position.sub(hc); g.traverse(m => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; m.userData.subject = 1; m.userData.part = 'hairtie'; } });
    hb.add(g); this.hairTie = g;
  }

  // the skull's half-extents and centre at height y (bind), from the head's own vertices within 1 cm of y
  _skullAt(y) {
    const P = this.body.geometry.attributes.position.array, AH = this.aHero; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let v = 0; v < this.meta.n; v++) { if (AH[v * 4] !== R.head || Math.abs(P[v * 3 + 1] - y) > 0.01) continue; x0 = Math.min(x0, P[v * 3]); x1 = Math.max(x1, P[v * 3]); z0 = Math.min(z0, P[v * 3 + 2]); z1 = Math.max(z1, P[v * 3 + 2]); }
    if (x0 > x1) return { rx: 0.118, rz: 0.132, cx: 0, cz: this.head0[this.idx.head].z };
    return { rx: (x1 - x0) / 2 + 0.004, rz: (z1 - z0) / 2 + 0.004, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
  }
  // ---------------------------------------------------------------- posing
  resetPose() { this.bones.forEach((B, i) => { B.quaternion.identity(); B.position.copy(this.bindPos[i]); }); this._flex = {}; }
  // sample: { q: Quaternion[] (local, bind-aligned), root: Vector3 (hips, mesh units) } from bvh.js Clip.sample
  applyClip(s, { root = true } = {}) {
    for (let i = 0; i < this.bones.length; i++) this.bones[i].quaternion.copy(s.q[i]);
    if (root) this.root.position.copy(s.root);
    this._flex = {};
  }
  update() { this.group.updateMatrixWorld(true); if (this._foldK > 0) this._flexUniforms(); if (this.person && this.person.P && this.correct) this.correct.update(); }
  // HUMAN c6: hide the skin under the garments (colour pass only; the body still casts the shadow)
  _coverSkin() { const H = this.hems, fit = OUTFITS[this.o.kind] || OUTFITS.work;
    this.skinU.hCover.value.set(H.armEnd, H.legEnd, H.neckY, 1); this.skinU.hCover2.value.set(1, fit.top >= 0 && this.cloth.top ? 1 : 0, (fit.coat ? H.hipY - 0.3 : H.tuckY) + 0.05, H.waistY - 0.07); }
  // HUMAN c6: elbow, knee and hip flexion (rad) into the cloth's fold uniforms, so the wrinkles follow the pose
  _flexUniforms() {
    const P = n => new THREE.Vector3().setFromMatrixPosition(this.bone(n).matrixWorld), ang = (a, b, c) => { const u = a.clone().sub(b).normalize(), v = c.clone().sub(b).normalize(); return Math.PI - Math.acos(clamp(u.dot(v), -1, 1)); };
    const f = {}; for (const s of ['L', 'R']) { f['e' + s] = ang(P(`upperarm01.${s}`), P(`lowerarm01.${s}`), P(`wrist.${s}`)); f['k' + s] = ang(P(`upperleg01.${s}`), P(`lowerleg01.${s}`), P(`foot.${s}`));
      f['h' + s] = ang(P('neck01'), P(`upperleg01.${s}`), P(`lowerleg01.${s}`)); }
    this._cFlex.set(f.eL, f.eR, f.kL, f.kR); this._cFlex2.set(f.hL, f.hR, 0, 0); return f;
  }
  // take the root's heading out (keep its pitch and roll), so group.rotation.y alone says where the man faces
  cancelYaw() { const q = this.root.quaternion, f = new THREE.Vector3(0, 0, 1).applyQuaternion(q); const yaw = Math.atan2(f.x, f.z);
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw)); this.root.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw); return yaw; }
  bone(name) { return this.bones[this.idx[name]]; }
  joint(name, out = new THREE.Vector3()) { this.group.updateMatrixWorld(true); return out.setFromMatrixPosition(this.bone(name).matrixWorld); }
  tip(name, out = new THREE.Vector3()) { const i = this.idx[name]; this.group.updateMatrixWorld(true); return out.copy(this.tail0[i]).sub(this.head0[i]).applyMatrix4(this.bones[i].matrixWorld); }
  // rotate a bone about a WORLD axis by angle (post-solve corrections, looks, reaches)
  rotateWorld(name, axis, ang) { const B = this.bone(name); this.group.updateMatrixWorld(true);
    const pq = new THREE.Quaternion(); B.parent.getWorldQuaternion(pq); const a = axis.clone().applyQuaternion(pq.clone().invert()).normalize();
    B.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(a, ang)); }
  expr({ shout = 0, brow = 0, squint = 0, sneer = 0, grit = 0 } = {}) {
    const inf = this.body.morphTargetInfluences, E = this.exprIndex; inf.fill(0);
    const set = (k, v) => { if (E[k] != null) inf[E[k]] = v; };
    set('mouth-open', shout); set('mouth-upward-retraction', shout * 0.5 + grit * 0.6); set('mouth-depression-retraction', shout * 0.35 + grit * 0.4);
    set('eyebrows-left-down', brow); set('eyebrows-right-down', brow); set('eye-left-slit', squint); set('eye-right-slit', squint);
    set('nose-left-elevation', sneer + shout * 0.3); set('nose-right-elevation', sneer + shout * 0.3); set('neck-platysma', shout * 0.6 + grit * 0.4);
    for (const m of this.meshes) if (m.morphTargetInfluences && m !== this.body && m.geometry.morphAttributes.position) m.morphTargetInfluences = inf;
    // the jaw drops with the shout (bone) as well as the morph
    const J = this.bone('jaw'); J.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.32 * shout);
    // teeth and tongue only when the mouth is open (closed, the helper meshes poke through the chin: the 'torn jaw')
    for (const m of this.meshes) if (m.userData.helper) m.visible = shout > 0.12;
  }

  // ---------------------------------------------------------------- hands
  // bind-space hand frame per side (computed once): n points out of the PALM (tested against the thumb tip, which
  // rests in front of the palm), a runs across the knuckles (index -> pinky), f along the fingers; plus the palm skin
  // point at the distal crease, where a handle bears
  _hand0(side) {
    if (this._h0?.[side]) return this._h0[side];
    const h = n => this.head0[this.idx[`${n}.${side}`]];
    const i1 = h('finger2-1'), p1 = h('finger5-1'), m1 = h('finger3-1'), w = h('wrist');
    const a = p1.clone().sub(i1).normalize(), f = m1.clone().sub(w).normalize();
    const n = new THREE.Vector3().crossVectors(f, a).normalize();
    const c = i1.clone().add(p1).multiplyScalar(0.5);
    const thumbTip = this.tail0[this.idx[`finger1-3.${side}`]];
    if (thumbTip.clone().sub(c).dot(n) < 0) n.negate();
    // palm skin: hand-region vertices facing n, 70-95% of the way from the wrist to the knuckles
    const P = this.body.geometry.attributes.position.array, N = this.nrm, AH = this.aHero, L = m1.distanceTo(w);
    const acc = new THREE.Vector3(); let k = 0;
    for (let v = 0; v < this.meta.n; v++) { if (AH[v * 4] !== R.hand || Math.sign(P[v * 3]) !== (side === 'L' ? 1 : -1)) continue;
      const q = new THREE.Vector3(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]), t = q.clone().sub(w).dot(f) / L;
      if (t < 0.7 || t > 0.95) continue; if (N[v * 3] * n.x + N[v * 3 + 1] * n.y + N[v * 3 + 2] * n.z < 0.6) continue; acc.add(q); k++; }
    const palm = k ? acc.divideScalar(k) : c.clone().addScaledVector(n, 0.015);
    this._h0 = this._h0 || {}; return (this._h0[side] = { a, f, n, c, w, palm });
  }
  // the same frame in world space now (rigid with the wrist bone)
  palm(side) {
    this.group.updateMatrixWorld(true);
    const H = this._hand0(side), W = this.bone(`wrist.${side}`), q = new THREE.Quaternion(); W.getWorldQuaternion(q);
    const toW = p => p.clone().sub(H.w).applyQuaternion(q).multiplyScalar(this.scale).add(new THREE.Vector3().setFromMatrixPosition(W.matrixWorld));
    return { a: H.a.clone().applyQuaternion(q), f: H.f.clone().applyQuaternion(q), n: H.n.clone().applyQuaternion(q), c: toW(H.c), palm: toW(H.palm), w: toW(H.w) };
  }
  _flexAxis(side, name) {   // the finger's flexion axis in its own bind (world-aligned) frame, sign: + curls to the palm
    const key = side + name; if (this._flex[key]) return this._flex[key];
    const i = this.idx[`${name}.${side}`], d = this.tail0[i].clone().sub(this.head0[i]).normalize();
    const H = this._hand0(side);
    let ax = new THREE.Vector3().crossVectors(d, H.n);
    if (name.startsWith('finger1')) ax.add(H.f.clone().multiplyScalar(side === 'L' ? 0.4 : -0.4));
    return (this._flex[key] = ax.normalize());
  }
  // where a handle of radius r sits in this hand right now: across the palm on the knuckle line, tilted like a power grip
  handle(side, r = 0.017, { tilt = 0.3, slide = 0, press = 0.002 } = {}) {
    const P = this.palm(side);
    const d = P.a.clone().applyAxisAngle(P.n, (side === 'L' ? -1 : 1) * tilt).normalize();
    const p = P.palm.clone().addScaledVector(P.n, r - press * this.scale).addScaledVector(d, slide);
    return { p, d, r };
  }
  // close the fingers of `side` onto a cylinder { p, d, r } (world). Each joint closes until its link touches the
  // cylinder (or its limit); distal joints keep closing after a proximal one stops, so the fingers wrap. The thumb
  // swings across (opposition) and closes from the other side. Returns the per-finger pad gaps (m).
  grip(side, cyl, { steps = 90, thumb = true, spread = 0 } = {}) {
    const s = this.scale, P = new THREE.Vector3(), Q = new THREE.Vector3(), d = cyl.d.clone().normalize();
    const distAxis = x => { const v = x.clone().sub(cyl.p); return v.addScaledVector(d, -v.dot(d)).length(); };
    const res = {};
    for (const [fname, meta, j1, j2, j3, rad] of FINGERS) {
      if (fname === 'thumb') { if (thumb) res.thumb = this._thumb(side, cyl, distAxis); continue; }
      const rf = rad * s * 1.1, chain = [j1, j2, j3].map(n => `${n}.${side}`), bones = chain.map(n => this.bone(n));
      const base = bones.map(B => B.quaternion.clone()), th = [0, 0, 0], lim = fname === 'thumb' ? [0.55, LIMITS.tmcp, LIMITS.tip] : [LIMITS.mcp, LIMITS.pip, LIMITS.dip];
      const rate = fname === 'thumb' ? [0.5, 1, 1] : [1, 1.15, 0.85], axes = chain.map(n => this._flexAxis(side, n.split('.')[0]));
      if (fname === 'thumb') { // opposition: swing the thumb across the palm before it closes
        const Pm = this.palm(side), B = bones[0];
        this.rotateWorld(chain[0], Pm.f, (side === 'L' ? -1 : 1) * 0.55); base[0].copy(B.quaternion);
      }
      const blocked = [false, false, false];
      const apply = () => { bones.forEach((B, k) => B.quaternion.copy(base[k]).multiply(new THREE.Quaternion().setFromAxisAngle(axes[k], th[k]))); bones[0].updateMatrixWorld(true); };
      const linkPts = k => { const B = bones[k], i = this.idx[chain[k]]; const a = P.setFromMatrixPosition(B.matrixWorld).clone(); const b = this.tail0[i].clone().sub(this.head0[i]).multiplyScalar(k === 2 ? 1.1 : 1).applyMatrix4(B.matrixWorld); return [a, b]; };
      const pen = k => { const [a, b] = linkPts(k); let m = Infinity; for (let q = 0; q <= 6; q++) m = Math.min(m, distAxis(Q.copy(a).lerp(b, q / 6))); return m < cyl.r + rf; };
      const step = 0.025;
      for (let it = 0; it < steps; it++) {
        let moved = false;
        for (let k = 0; k < 3; k++) if (!blocked[k] && th[k] < lim[k]) { th[k] = Math.min(lim[k], th[k] + step * rate[k]); moved = true; }
        apply();
        for (let k = 0; k < 3; k++) if (pen(k)) { // back off the most distal moving joint at or before k
          for (let q = k; q >= 0; q--) if (!blocked[q]) { th[q] = Math.max(0, th[q] - step * rate[q]); blocked[q] = true; break; }
          apply();
        }
        if (!moved) break;
      }
      // refine: creep each joint toward contact in small steps (sub-millimetre at the fingertip)
      for (let k = 0; k < 3; k++) for (let it = 0; it < 12; it++) { if (th[k] >= lim[k]) break; th[k] += 0.004; apply(); if (pen(k) || (k < 2 && pen(k + 1))) { th[k] -= 0.004; apply(); break; } }
      // skin contact: close the two distal joints until the finger's own pad skin (skinned vertices) meets the handle
      let gap = this.skinGap(side, j1.slice(0, 7), cyl, distAxis);
      // pressed too deep (the capsules are thinner than the skin): open the joints until the pad just bears
      for (const k of [0, 1, 2]) for (let it = 0; it < 40 && gap < -0.0008 * this.scale && th[k] > 0; it++) { th[k] = Math.max(0, th[k] - 0.01); apply(); gap = this.skinGap(side, j1.slice(0, 7), cyl, distAxis); }
      for (const k of [2, 1]) for (let it = 0; it < 30 && gap > 0.0004 * this.scale && th[k] < lim[k]; it++) { th[k] = Math.min(lim[k], th[k] + 0.012); apply(); gap = this.skinGap(side, j1.slice(0, 7), cyl, distAxis); if (gap < -0.0015 * this.scale) { th[k] -= 0.012; apply(); gap = this.skinGap(side, j1.slice(0, 7), cyl, distAxis); break; } }
      res[fname] = { gap, th: th.slice() };
    }
    return res;
  }
  // the thumb: search the CMC swing (two angles) so the pad lands on the handle across from the fingers, resting
  // near the index finger's middle joint (a power grip), then close the two distal joints onto the handle
  _thumb(side, cyl, distAxis) {
    const names = ['finger1-1', 'finger1-2', 'finger1-3'].map(n => `${n}.${side}`), B = names.map(n => this.bone(n)), base = B.map(b => b.quaternion.clone());
    const P = this.palm(side), rf = 0.0105 * this.scale * 1.1, idx2 = this.bone(`finger2-2.${side}`);
    const pq = new THREE.Quaternion(); B[0].parent.getWorldQuaternion(pq); const inv = pq.clone().invert();
    const axF = P.f.clone().applyQuaternion(inv).normalize(), axA = P.a.clone().applyQuaternion(inv).normalize();
    const ax2 = this._flexAxis(side, 'finger1-2'), ax3 = this._flexAxis(side, 'finger1-3');
    const set = (al, be, c2, c3) => { B[0].quaternion.copy(base[0]).premultiply(new THREE.Quaternion().setFromAxisAngle(axF, al)).premultiply(new THREE.Quaternion().setFromAxisAngle(axA, be));
      B[1].quaternion.copy(base[1]).multiply(new THREE.Quaternion().setFromAxisAngle(ax2, c2)); B[2].quaternion.copy(base[2]).multiply(new THREE.Quaternion().setFromAxisAngle(ax3, c3)); B[0].updateMatrixWorld(true); };
    const pts = () => { const out = []; for (let k = 0; k < 3; k++) { const i = this.idx[names[k]], a = new THREE.Vector3().setFromMatrixPosition(B[k].matrixWorld), b = this.tail0[i].clone().sub(this.head0[i]).applyMatrix4(B[k].matrixWorld); for (let q = 0; q <= 4; q++) out.push(a.clone().lerp(b, q / 4)); } return out; };
    const target = new THREE.Vector3().setFromMatrixPosition(idx2.matrixWorld);
    const cost = () => { const p = pts(); let pen = 0; for (const x of p) pen += Math.max(0, cyl.r + rf * 0.85 - distAxis(x)); const tip = p[p.length - 1];
      return pen * 40 + Math.abs(distAxis(tip) - cyl.r - rf) * 3 + tip.distanceTo(target) * 0.6; };
    let best = { c: Infinity };
    for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) for (const c2 of [0.2, 0.6]) { const al = i * 0.14, be = j * 0.14; set(al, be, c2, c2 * 1.2); const c = cost(); if (c < best.c) best = { c, al, be, c2 }; }
    for (let it = 0; it < 3; it++) { const st = 0.05 / (it + 1); for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (let k = -1; k <= 1; k++) { const al = best.al + i * st, be = best.be + j * st, c2 = Math.max(0, best.c2 + k * st); set(al, be, c2, c2 * 1.2); const c = cost(); if (c < best.c) best = { c, al, be, c2 }; } }
    set(best.al, best.be, best.c2, best.c2 * 1.2);
    let gap = this.skinGap(side, 'finger1', cyl, distAxis);
    for (let it = 0; it < 25 && gap > 0.0004 * this.scale; it++) { best.c2 += 0.015; set(best.al, best.be, best.c2, best.c2 * 1.2); gap = this.skinGap(side, 'finger1', cyl, distAxis); if (gap < -0.0015 * this.scale) { best.c2 -= 0.015; set(best.al, best.be, best.c2, best.c2 * 1.2); gap = this.skinGap(side, 'finger1', cyl, distAxis); break; } }
    return { gap, cost: best.c, th: [best.al, best.be, best.c2] };
  }
  // the nearest pad skin of a finger (skinned vertices) to a cylinder's surface, metres (negative = pressed in)
  skinGap(side, finger, cyl, distAxis) {
    const pads = this._pads[side + finger]; if (!pads) return Infinity;
    this.group.updateMatrixWorld(true); this.skeleton.update(); const p = new THREE.Vector3(); let m = Infinity;
    for (const v of pads) { this.body.getVertexPosition(v, p); p.applyMatrix4(this.body.matrixWorld); m = Math.min(m, distAxis(p) - cyl.r); }
    return m;
  }
  // ---------------------------------------------------------------- gestures (cycle 2)
  _body() {   // the body frame now: facing (horizontal), up, out-to-the-left, origin under the feet
    this.group.updateMatrixWorld(true);
    const rq = new THREE.Quaternion(); this.root.getWorldQuaternion(rq);
    const up = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rq).setY(0).normalize(), xL = new THREE.Vector3().crossVectors(up, fwd).normalize();
    return { up, fwd, xL, o: new THREE.Vector3().setFromMatrixPosition(this.group.matrixWorld) };
  }
  _aimWorld(name, from, to) { const B = this.bone(name); this.group.updateMatrixWorld(true);
    const pq = new THREE.Quaternion(); B.parent.getWorldQuaternion(pq);
    const r = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
    B.quaternion.premultiply(pq.clone().invert().multiply(r).multiply(pq)); }
  // pose one arm onto a gesture.js glyph by two-bone IK (upper arm aimed, then twisted so the elbow bends in its own
  // plane, then the forearm aimed); closes the fist (or a grip for prop gestures) and draws the fist `fistScale` big
  gesture(side, name, { p = 0.5, fist = true, fistScale = 1, fistForm = null } = {}) {
    const s = side === 'L' ? 1 : -1, F = this._body(), toW = d => F.xL.clone().multiplyScalar(d[0]).addScaledVector(F.up, d[1]).addScaledVector(F.fwd, d[2]);
    const UA = `upperarm01.${side}`, LA = `lowerarm01.${side}`, WR = `wrist.${side}`;
    let dirs;
    if (GESTURES[name]?.target) { const k = this.o.height / 1.78, rel = this.joint(UA).sub(F.o); dirs = gestureSolve(name, s, { p, shoulder: [rel.dot(F.xL) / k, rel.dot(F.up) / k, rel.dot(F.fwd) / k] }); }
    else dirs = gestureDirs(name, s, p);
    if (!dirs) return null;
    const u = toW(dirs.u), f = toW(dirs.f);
    this._aimWorld(UA, this.joint(LA).sub(this.joint(UA)), u);
    { const E = this.joint(LA), Wr = this.joint(WR), fc = Wr.sub(E); fc.addScaledVector(u, -fc.dot(u)); const fd = f.clone().addScaledVector(u, -f.dot(u));
      if (fc.lengthSq() > 1e-6 && fd.lengthSq() > 1e-6) { fc.normalize(); fd.normalize(); const ang = Math.atan2(new THREE.Vector3().crossVectors(fc, fd).dot(u), fc.dot(fd)); this.rotateWorld(UA, u, ang); } }
    this._aimWorld(LA, this.joint(WR).sub(this.joint(LA)), f);
    this.update();
    if (fist && GESTURES[name]?.fist !== false) this.fist(side, { form: fistForm });
    this.bone(WR).scale.setScalar(fistScale);
    (this._gest ||= {})[side] = { name, fistScale };
    this.update();
    return { u, f };
  }
  // both arms measured like folk.gestures(): [{ side, name, interior, elev, faDev, ahead, fistPx, hand, elbow, flags }]
  gestures(camera, W = 1080, H = 1920) {
    camera.updateMatrixWorld(); const F = this._body(), v = new THREE.Vector3(), fpx = H / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const P3 = p => Array.isArray(p) ? v.set(p[0], p[1], p[2]) : v.copy(p);
    const proj = p => { P3(p).project(camera); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H]; };
    const ppm = p => fpx / Math.max(0.05, -P3(p).applyMatrix4(camera.matrixWorldInverse).z);
    const head = this.joint('head').addScaledVector(F.up, 0.1 * this.scale), out = [];
    for (const side of ['L', 'R']) { const g = this._gest?.[side];
      const m = measureArm({ S: this.joint(`upperarm01.${side}`), E: this.joint(`lowerarm01.${side}`), Wr: this.joint(`wrist.${side}`), head, fwd: F.fwd, prop: !!(g && GESTURES[g.name]?.prop) }, proj, ppm, 0.1 * this.o.height / 1.78 * (g ? g.fistScale : 1));
      if (m) out.push({ side, name: g ? g.name : 'clip', ...m }); }
    return out;
  }
  // how big the face is on screen, and so how it is rendered (the cycle-2 rule): 'silhouette' < 200 px (rim or lost
  // profile only), 'planes' 200-600 px (print, rim or two-tone with ink strokes), 'lit' > 600 px (raking light only)
  faceTier(camera, H = 1920) {
    const hp = this.joint('head'); camera.updateMatrixWorld(); const z = -hp.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const px = 0.24 * this.o.height / 1.8 * H / (2 * z * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    return { px: Math.round(px), tier: px < 200 ? 'silhouette' : px < 600 ? 'planes' : 'lit' };
  }
  // ink strokes for the face (Spider-Verse: hand-placed lines attached to the head, not sculpted wrinkles), in px:
  // [{ kind, pts: [[x, y], ...], w: px, ink: 'ink' | 'paper' }]. Only the strokes on the side that faces the camera.
  inkStrokes(camera, W = 1080, H = 1920, { shout = 0 } = {}) {
    this.group.updateMatrixWorld(true); camera.updateMatrixWorld();
    const hb = this.bone('head'), h0 = this.head0[this.idx.head], jb = this.bone('jaw'), j0 = this.head0[this.idx.jaw];
    const toW = (p, jaw = false) => (jaw ? p.clone().sub(j0).applyMatrix4(jb.matrixWorld) : p.clone().sub(h0).applyMatrix4(hb.matrixWorld));
    const v = new THREE.Vector3(), proj = p => { v.copy(p).project(camera); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H]; };
    const cen = toW(new THREE.Vector3(0, (this.eyeL.y + this.eyeR.y) / 2 - 0.02, h0.z)), camP = camera.position;
    const vis = (p, n) => n.clone().normalize().dot(camP.clone().sub(p).normalize()) > 0.3;
    const fpx = H / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)), ppm = fpx / Math.max(0.05, -cen.clone().applyMatrix4(camera.matrixWorldInverse).z);
    const wt = mm => Math.max(0.8, mm * 0.001 * ppm), out = [], M = this.mouth, B = (x, y, z) => new THREE.Vector3(x, y, z);
    const nrmAt = p => p.clone().sub(cen);
    const stroke = (kind, pts, mm, ink = 'ink', jaw = false) => { const w = pts.map(p => toW(p, jaw)); const mid = w[Math.floor(w.length / 2)];
      if (!vis(mid, nrmAt(mid))) return; out.push({ kind, pts: w.map(proj), w: wt(mm), ink }); };
    for (const [e, sg] of [[this.eyeL, 1], [this.eyeR, -1]]) {
      const lid = [], brow = [];
      for (let k = 0; k <= 8; k++) { const u = k / 8 - 0.5; lid.push(B(e.x + sg * u * 0.03, e.y + 0.0045 + 0.005 * (1 - 4 * u * u), e.z + 0.009 - 0.01 * u * u)); brow.push(B(e.x + sg * (u * 0.046 + 0.004), e.y + 0.019 + 0.006 * (1 - 4 * u * u) - 0.004 * u * sg * sg, e.z + 0.012 - 0.012 * u * u)); }
      stroke('lid', lid, 1.6); stroke('brow', brow, 2.4);
      stroke('socket', lid.map(p => p.clone().add(B(0, 0.004, -0.002))), 3.2);
      stroke('catchlight', [B(e.x - sg * 0.002, e.y + 0.002, e.z + 0.0085), B(e.x - sg * 0.0015, e.y + 0.0025, e.z + 0.0085)], 1.5, 'paper');
      if (false) stroke('cheekbone', [B(e.x + sg * 0.018, e.y - 0.026, e.z - 0.004), B(e.x + sg * 0.03, e.y - 0.034, e.z - 0.012), B(e.x + sg * 0.036, e.y - 0.046, e.z - 0.02)], 1.2);
      if (false) stroke('nostril', [B(sg * 0.006, M.y + 0.024, M.z + 0.004), B(sg * 0.016, M.y + 0.021, M.z - 0.004), B(sg * 0.018, M.y + 0.028, M.z - 0.008)], 1.6);
      if (false) stroke('nasolabial', [B(sg * 0.02, M.y + 0.026, M.z - 0.01), B(sg * 0.027, M.y + 0.01, M.z - 0.012), B(sg * 0.029, M.y - 0.008, M.z - 0.016)], 0.9);
    }
    if (shout < 0.3) stroke('mouth', [B(-0.024, M.y - 0.001, M.z - 0.012), B(-0.01, M.y + 0.001, M.z - 0.002), B(0, M.y, M.z), B(0.01, M.y + 0.001, M.z - 0.002), B(0.024, M.y - 0.001, M.z - 0.012)], 1.8);
    return out;
  }
  // a relaxed working hand hanging at the side: every finger curled a little (the bind hand is flat and splayed)
  // HUMAN c6: { cascade: true } is the resting hand of a living person (the "finger cascade" hand surgeons check): the index
  // least flexed, each finger after it more, the PIP joint doing most of it, the thumb lying along the index. The default
  // (every finger curled alike, ~55/70/45 degrees) is unchanged for existing callers; at a hanging arm it read as a claw.
  relaxHand(side, amt = 1, { cascade = false } = {}) {
    const CAS = { index: [0.22, 0.42, 0.2], middle: [0.32, 0.55, 0.26], ring: [0.42, 0.66, 0.3], pinky: [0.52, 0.76, 0.34] };
    for (const [fname, meta, j1, j2, j3] of FINGERS) { const c = CAS[fname], ch = fname === 'thumb' ? (cascade ? [[j1, 0.12], [j2, 0.22], [j3, 0.2]] : [[j2, 0.4], [j3, 0.45]]) : cascade ? [[j1, c[0]], [j2, c[1]], [j3, c[2]]] : [[j1, 0.95], [j2, 1.2], [j3, 0.75]];
      for (const [j, a] of ch) { if (!j) continue; const B = this.bone(`${j}.${side}`); if (!B) continue; B.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(this._flexAxis(side, j), a * amt)); } }
    this.update();
  }
  fist(side, { tight = 1, form = null } = {}) {
    if (form === 'bridgman') return this.fistBridgman(side, { tight });
    const H = this.handle(side, 0.011 * this.scale, { tilt: 0.1 }); H.p.addScaledVector(this.palm(side).n, -0.006 * tight * this.scale); return this.grip(side, H); }
  // HUMAN c4: the fist built to Bridgman's three structural facts (Constructive Anatomy), opt-in (fist(side, { form:
  // 'bridgman' }) or gesture(side, name, { fistForm: 'bridgman' })); the default fist is unchanged.
  //  1. "Clenched, each circle of knuckles forms an ARCH with the same common centre": the ring and little metacarpals
  //     flex at the carpus (the palm cups), so the knuckle row steps down from the index and middle to the little finger.
  //  2. The fingers fold into the palm, THEN "clamp the thumb over the middle phalanges": the thumb's pad is searched onto
  //     the outer face of the index and middle fingers' second segments (not left open beside the fist).
  //  3. "Into the square of the knuckles a blunt wedge is seen to enter from above": the proximal phalanges are driven to
  //     ~90 degrees so their backs make one flat front plane under the knuckles (the square); the wrist cocks back a little.
  fistBridgman(side, { tight = 1, arch = 1, cock = 0.12 } = {}) {
    const flexMeta = (n, a) => { const B = this.bone(`${n}.${side}`); if (B) B.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(this._flexAxis(side, n), a)); };
    flexMeta('metacarpal3', 0.1 * arch); flexMeta('metacarpal4', 0.22 * arch); flexMeta('metacarpal2', 0.03 * arch);
    if (cock) { const P = this.palm(side); this.rotateWorld(`wrist.${side}`, P.a, (side === 'L' ? 1 : -1) * cock); }
    this.update();
    const H = this.handle(side, 0.009 * this.scale, { tilt: 0.02 }); H.p.addScaledVector(this.palm(side).n, -0.008 * tight * this.scale);
    const res = this.grip(side, H, { thumb: false });
    // a clenched fist has no gaps between the fingers: adduct each proximal phalanx toward the middle finger (about the
    // palm normal), the sign chosen by which way brings its middle joint nearer the middle finger's
    { const n = this.palm(side).n, mid = () => this.joint(`finger3-2.${side}`);
      for (const [j1, j2, amt] of [['finger2-1', 'finger2-2', 0.07], ['finger4-1', 'finger4-2', 0.08], ['finger5-1', 'finger5-2', 0.16]]) {
        const d0 = this.joint(`${j2}.${side}`).distanceTo(mid()); this.rotateWorld(`${j1}.${side}`, n, amt); this.update();
        if (this.joint(`${j2}.${side}`).distanceTo(mid()) > d0) { this.rotateWorld(`${j1}.${side}`, n, -2 * amt); this.update(); } } }
    // square the front: every proximal phalanx at >= 1.45 rad (the backs of the first segments make one plane)
    for (const [fname, meta, j1] of FINGERS) { if (fname === 'thumb') continue; const r = res[fname]; if (!r) continue; const add = Math.max(0, 1.45 - r.th[0]);
      if (add > 0) { const B = this.bone(`${j1}.${side}`); B.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(this._flexAxis(side, j1), add)); r.th[0] += add; } }
    this.update();
    res.thumb = this._thumbClamp(side);
    this.update();
    (this._fistInfo ||= {})[side] = res;
    return res;
  }
  // world points along a bone's link (head -> tail), n+1 samples
  _link(name, n = 4) { const B = this.bone(name), i = this.idx[name]; const a = new THREE.Vector3().setFromMatrixPosition(B.matrixWorld), b = this.tail0[i].clone().sub(this.head0[i]).applyMatrix4(B.matrixWorld);
    return Array.from({ length: n + 1 }, (_, q) => a.clone().lerp(b, q / n)); }
  // the thumb clamped over the middle phalanges of the index and middle fingers: search the CMC swing and the two distal
  // flexions so the thumb's distal pad lands on the outer face of those segments, with no penetration of any finger
  _thumbClamp(side) {
    this.group.updateMatrixWorld(true);
    const names = ['finger1-1', 'finger1-2', 'finger1-3'].map(n => `${n}.${side}`), B = names.map(n => this.bone(n)), base = B.map(b => b.quaternion.clone());
    const P = this.palm(side), s = this.scale, rT = 0.0105 * s, pq = new THREE.Quaternion(); B[0].parent.getWorldQuaternion(pq); const inv = pq.clone().invert();
    const axF = P.f.clone().applyQuaternion(inv).normalize(), axA = P.a.clone().applyQuaternion(inv).normalize(), ax2 = this._flexAxis(side, 'finger1-2'), ax3 = this._flexAxis(side, 'finger1-3');
    const caps = []; for (const [fname, meta, j1, j2, j3, rad] of FINGERS) { if (fname === 'thumb') continue; for (const j of [j1, j2, j3]) caps.push({ pts: this._link(`${j}.${side}`, 3), r: rad * s }); }
    const mid = n => this._link(`${n}.${side}`, 2)[1];
    const M = mid('finger2-2').add(mid('finger3-2')).multiplyScalar(0.5), C = new THREE.Vector3(); let nC = 0;
    for (const c of caps) for (const p of c.pts) { C.add(p); nC++; } C.multiplyScalar(1 / nC);
    const out = M.clone().sub(C).normalize(), T = M.clone().addScaledVector(out, 0.0095 * s + rT * 0.8);
    const set = (al, be, c2, c3) => { B[0].quaternion.copy(base[0]).premultiply(new THREE.Quaternion().setFromAxisAngle(axF, al)).premultiply(new THREE.Quaternion().setFromAxisAngle(axA, be));
      B[1].quaternion.copy(base[1]).multiply(new THREE.Quaternion().setFromAxisAngle(ax2, c2)); B[2].quaternion.copy(base[2]).multiply(new THREE.Quaternion().setFromAxisAngle(ax3, c3)); B[0].updateMatrixWorld(true); };
    const cost = () => { const L2 = this._link(names[1], 3), L3 = this._link(names[2], 3), pad = L3[1].clone().lerp(L3[2], 0.5); let pen = 0;
      for (const p of [...L2, ...L3]) for (const c of caps) for (const q of c.pts) { const d = p.distanceTo(q) - (c.r + rT * 0.9); if (d < 0) pen -= d; }
      return pad.distanceTo(T) * 10 + pen * 60; };
    let best = { c: Infinity };
    for (let i = -9; i <= 9; i++) for (let j = -9; j <= 9; j++) for (const c2 of [0.2, 0.5, 0.8]) { const al = i * 0.13, be = j * 0.13; set(al, be, c2, c2 * 0.9); const c = cost(); if (c < best.c) best = { c, al, be, c2, c3: c2 * 0.9 }; }
    for (let it = 0; it < 4; it++) { const st = 0.06 / (it + 1); for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (let k = -1; k <= 1; k++) for (let l = -1; l <= 1; l++) {
      const al = best.al + i * st, be = best.be + j * st, c2 = Math.max(0, best.c2 + k * st), c3 = Math.max(0, best.c3 + l * st); set(al, be, c2, c3); const c = cost(); if (c < best.c) best = { c, al, be, c2, c3 }; } }
    set(best.al, best.be, best.c2, best.c3);
    const L3 = this._link(names[2], 3); return { cost: +best.c.toFixed(4), padToTarget: +(L3[1].clone().lerp(L3[2], 0.5).distanceTo(T) / s).toFixed(4), th: [best.al, best.be, best.c2, best.c3] };
  }
  // HUMAN c4, the Graham forearm (Monument to Joe Louis, 1986: the forearm IS the object; mass in the upper third, a
  // taper to the wrist): thickens the forearm near the elbow and tapers it to the wrist by bone scale, the hand and the
  // fist kept at their own size. Opt-in; call after posing. k = 0 restores.
  forearm(side, k = 1) {
    const a = this.bone(`lowerarm01.${side}`), b = this.bone(`lowerarm02.${side}`), w = this.bone(`wrist.${side}`); if (!a || !b || !w) return;
    const s1 = 1 + 0.16 * k, s2 = 1 - 0.1 * k;
    a.scale.set(s1, 1, s1); b.scale.set(s2 / s1, 1, s2 / s1); const ws = w.scale.y || 1; w.scale.set(ws / s2, ws, ws / s2); this.update();
  }
  // world matrix to hang a tool on: origin on the handle axis at the palm, +Y along the handle (toward the thumb side)
  toolFrame(side, h) { const y = h.d.clone(), z = this.palm(side).n.clone().negate(); const x = new THREE.Vector3().crossVectors(y, z).normalize(); z.crossVectors(x, y).normalize();
    return new THREE.Matrix4().makeBasis(x, y, z).setPosition(h.p); }
}

// ---------------------------------------------------------------- PRODUCTION (round 7, 8 Oct): a scene's Hero IS the studio's current person
// review/studio_human_c8/after/production/NOTES.md. `new Hero(await loadHeroData(), o)` builds as before (the SCAFFOLD the scene's load-time
// code reads and attaches to) and queues the current person (lib/fx/person makePerson, one at a time a page: FABRIC7's hooks are page-wide):
// CAST from the scene's options (sex of the variant, o.age, o.skin, o.beard) onto the people the person system builds, then GRAFTED: the
// scaffold's bone objects stay (the scene holds them), take the person's rest and drive the person's meshes; the scaffold's meshes go; the
// hero's state becomes the person's. Frames wait for every queued person (window.renderFrame is wrapped while one is pending). A person that
// does not build leaves the scaffold (h.person.error). A Hero built on any other data (a person record: lib/fx/person's own P.h) is the core.
// ON BY DEFAULT in a page (iteration 3). The one A/B switch left, for the gate that measures this default (removed with the scaffold's superseded
// code when its measurer rules): ?person=0 on the page (or globalThis.ACP_PERSON = 0) builds the scaffold alone. Node tools opt in (ACP_PERSON=1).
const PG = globalThis;
function personWanted() {
  if (PG.ACP_PERSON != null) return !!+PG.ACP_PERSON;
  try { const q = PG.location && PG.location.search ? new URLSearchParams(PG.location.search).get('person') : null; if (q != null) return q !== '0'; } catch (e) { /* no page */ }
  try { const v = PG.process && PG.process.env && PG.process.env.ACP_PERSON; if (v != null) return v !== '0'; } catch (e) { /* no env */ }
  return typeof PG.window !== 'undefined' && typeof PG.document !== 'undefined';
}
// a page's diagnostic (iteration 3 only, one plate: ?pdbg=lambert): the grafted person's skin drawn with a plain MeshStandardMaterial of its own
// colour, so a plate tells whether a face the scene's light does not reach is the light's path or the skin shader's response to that light
const personDebug = () => { try { return PG.location && PG.location.search ? new URLSearchParams(PG.location.search).get('pdbg') : null; } catch (e) { return null; } };
// who the person system builds today (integration v7: the twelve lineup people with dressed bakes); replaced by lib/fx/person's own list when it exports one
const CAST_FALLBACK = ['L08_f24_hispanic', 'L12_f39_white', 'L22_f27_black', 'L20_f29_asian', 'L14_f42_black', 'L06_f53_white', 'L21_m32_black', 'L03_m38_asian', 'L05_m59_black', 'L11_m23_white', 'L17_m28_hispanic', 'L23_m45_white'];
// the page-wide set of pending person work (people.js adds its crowd load to the same set): a frame waits for all of it
const PEND = PG.__acpPersonPending || (PG.__acpPersonPending = new Set());
const PQ = { tail: Promise.resolve(), pending: PEND, used: new Set(), studio: null, cast: null, log: [] };
export const PERSON_QUEUE = PQ;
const lstar = hex => { const c = new THREE.Color(hex), f = x => (x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116); if (!THREE.ColorManagement.enabled) c.convertSRGBToLinear();
  return 116 * f(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) - 16; };
async function personCast(PI) {
  if (PQ.cast) return PQ.cast;
  const names = (PI.CAST && PI.CAST.map(c => c.name || c)) || (PI.castList && (await PI.castList()).map(c => c.name || c)) || CAST_FALLBACK;
  const L = await fetch(new URL('../../assets/body/lineup.json', import.meta.url).href).then(r => r.json()), by = Object.fromEntries((L.people || []).map(p => [p.name, p]));
  return (PQ.cast = names.filter(n => by[n]).map(n => ({ name: n, sex: by[n].sex, age: by[n].age, group: by[n].group, skin: by[n].skin, L: lstar(by[n].skin) })));
}
// the scene's casting -> the nearest person: same sex, then skin lightness (CIE L*: the scene's choice of who, weighted first) and age; each person
// once a page while any is left
export function castForHero(o, sex, cast, used = new Set()) {
  const ageK = typeof o.age === 'number' ? o.age : 0.25, age = 20 + 50 * clamp((ageK - 0.1) / 0.85), Ls = lstar(o.skin || '#b07a58');
  const pool = cast.filter(c => c.sex === sex).length ? cast.filter(c => c.sex === sex) : cast;
  let best = null, bs = Infinity; for (const c of pool) { const s = Math.abs(c.L - Ls) / 8 + Math.abs(c.age - age) / 16 + (used.has(c.name) ? 100 : 0); if (s < bs) { bs = s; best = c; } }
  return { ...best, want: { sex, age: Math.round(age), L: Math.round(Ls) } };
}
// the scene's beard (only where it asked for one) as the groom's choice
const beardOf = o => (o.beard == null && o.stubble == null) ? null : (o.beard ?? 0) >= 0.6 ? 'full' : (o.beard ?? 0) >= 0.3 ? 'short' : (o.stubble ?? 0) >= 0.5 ? 'stubble' : 'none';
function personGate() {
  if (typeof window === 'undefined' || PG.__personGate) return; PG.__personGate = true;
  const wrap = f => (typeof f !== 'function' || f.__personGated) ? f : Object.assign(function (...a) { return PQ.pending.size ? Promise.all([...PQ.pending]).then(() => f.apply(this, a)) : f.apply(this, a); }, { __personGated: true });
  let rf = wrap(window.renderFrame);
  try { Object.defineProperty(window, 'renderFrame', { configurable: true, enumerable: true, get: () => rf, set: f => { rf = wrap(f); } }); } catch (e) { /* a scene's own accessor: frames do not wait */ }
}
function personQueue(S, o0) {
  personGate();
  const sceneO = { ...S.o }, raw = { ...o0 };
  S.person = { state: 'queued', who: null, ms: null, error: null, P: null };
  const job = PQ.tail.then(async () => {
    const t0 = (PG.performance || Date).now();
    try {
      const PI = await import('./person/index.js');
      PQ.studio = PQ.studio || await PI.loadPersonStudio();
      const c = castForHero(raw, S.sex, await personCast(PI), PQ.used); PQ.used.add(c.name);
      S.person.who = c.name; S.person.cast = c;
      const hair = {}, b = beardOf(raw); if (b && S.sex === 'm') hair.beard = b;
      const P = await PI.makePerson(c.name, { studio: PQ.studio, wear: 'work', ...(Object.keys(hair).length ? { hair } : {}) });
      graftPerson(S, P, sceneO, raw);
      S.person.state = 'person'; S.person.P = P; S.person.ms = Math.round((PG.performance || Date).now() - t0);
      PQ.log.push({ who: c.name, ms: S.person.ms, want: c.want });
      try { console.log(`[person] ${sceneO.variant} -> ${c.name} (${S.person.ms} ms; at the scene's height x${S.person.fit?.k}, dyed ${S.person.fit?.dyed})`); } catch (e) { /* no console */ }
    } catch (e) {
      S.person.state = 'scaffold'; S.person.error = String((e && e.stack) || e).slice(0, 600);
      try { console.warn('[person] the scaffold stays: ' + S.person.error.split('\n')[0]); } catch (e2) { /* no console */ }
    }
  });
  PQ.tail = job; PQ.pending.add(job); job.then(() => PQ.pending.delete(job));
  S.person.ready = job;
  return job;
}
// THE GRAFT: the person's meshes onto the scaffold's bones, the hero's state the person's
function graftPerson(S, P, sceneO, raw = {}) {
  const h = P.h, n = S.bones.length;
  if (h.bones.length !== n || h.names.some((nm, i) => nm !== S.names[i])) throw new Error('graft: the person\'s rig is not the hero bundle\'s');
  // THE SCENE'S HEIGHT (iteration 3): the scene asked for a hero of its height and composed its shots on that hero's head (cameras, eye lights,
  // look-at points: spectre's close-up is framed on the eyes at 1.694 m). The person stands at it: one uniform scale that puts the person's eyes
  // at rest where the scaffold's were (casting picks the nearest person; the scale is bounded to +-8 %, beyond that the person keeps its own)
  const s0 = S.group.scale.x, s1 = h.group.scale.x, eyeS = (S.eyeL.y + S.eyeR.y) / 2 * s0, eyeP = (h.eyeL.y + h.eyeR.y) / 2 * s1;
  const fitK = eyeP > 0 && Math.abs(eyeS / eyeP - 1) <= 0.08 ? eyeS / eyeP : 1, s2 = s1 * fitK, k = s0 / s2;
  S.person.fit = { k: +fitK.toFixed(4), eyeScaffold: +eyeS.toFixed(4), eyePerson: +eyeP.toFixed(4), stature: +((h.o.height || 0) * fitK).toFixed(3), dyed: 0 };
  // what is the scaffold's own (hero.js built it) and what did the scene add
  const own = new Set([S.root, S.body, S.eyes, S.hatGroup, S.hairTie, S.hairMesh, S.beardMesh, ...(S.meshes || [])].filter(Boolean));
  for (const v of Object.values(S.cloth || {})) for (const m of [].concat(v || [])) if (m) own.add(m);
  // mesh flags the scene set on the scaffold (layers it enabled): carried to every person mesh
  let layers = 0; for (const m of S.meshes || []) layers |= m.layers.mask;
  // 1. the bones: the person's rest, the scene's rotations; the root's offset from its rest kept in world units; scene things on bones re-scaled
  const rootI = S.idx.root, rootOff = S.root.position.clone().sub(S.bindPos[rootI]).multiplyScalar(k);
  for (let i = 0; i < n; i++) { const B = S.bones[i]; B.position.copy(h.bindPos[i]); B.scale.set(1, 1, 1);   // (a scene's applyBody scales go: the person has its own body)
    for (const c of [...B.children]) { if (c.isBone || own.has(c)) continue; if (c === S.hatGroup || c === S.hairTie) continue; c.position.multiplyScalar(k); c.scale.multiplyScalar(k); } }
  S.root.position.add(rootOff);
  for (const c of [...S.group.children]) if (!own.has(c) && !c.isBone) { c.position.multiplyScalar(k); c.scale.multiplyScalar(k); }
  // 2. the scaffold's meshes out (the old hat's materials kept for the person's hat, so a scene's edits to them carry)
  const hatMats = []; if (S.hatGroup) S.hatGroup.traverse(m => { if (m.isMesh) hatMats.push(m.material); });
  for (const m of own) { if (m === S.root) continue; if (m.parent) m.parent.remove(m); m.traverse?.(x => { if (x.isMesh) { x.geometry?.dispose?.(); if (!hatMats.includes(x.material)) [].concat(x.material).forEach(mt => mt?.dispose?.()); } }); }
  // 3. the person's meshes onto the scaffold's bones (each skeleton rebuilt over the same bone objects, the person's inverses kept)
  const map = new Map(h.bones.map((b, i) => [b, S.bones[i]])), skels = new Map();
  const reskel = sk => { if (!skels.has(sk)) skels.set(sk, new THREE.Skeleton(sk.bones.map(b => map.get(b) || b), sk.boneInverses.map(m => m.clone()))); return skels.get(sk); };
  for (const c of [...h.group.children]) { if (c.isBone) continue; S.group.add(c); }
  for (let i = 0; i < n; i++) for (const c of [...h.bones[i].children]) if (!c.isBone) S.bones[i].add(c);
  S.group.traverse(m => { if (m.isSkinnedMesh && m.skeleton && !own.has(m) && m.skeleton.bones.some(b => map.has(b))) m.bind(reskel(m.skeleton), m.bindMatrix); if (m.isMesh && layers) m.layers.mask |= layers; });
  // 4. the hero's state is the person's; P.h shares the bones (CORRECT5's per-pose update reads the scene's pose)
  const keep = new Set(['group', 'bones', 'root', 'skeleton', '_auditCam', 'clip', 'o2', 'person', 'o']);
  for (const key of Object.keys(h)) if (!keep.has(key)) S[key] = h[key];
  S.o = { ...sceneO, ...h.o, height: (h.o.height || sceneO.height) * fitK };
  S.skeleton = reskel(h.skeleton);
  for (let i = 0; i < n; i++) h.bones[i] = S.bones[i];
  h.root = S.root; h.skeleton = S.skeleton; h.group = S.group;
  S.group.scale.setScalar(s2); S.scale = h.scale = h.scale * fitK;
  // THE SCENE'S COLOURS (iteration 3): the scene's shirt / trousers / boots, where it named them, dye the person's own outfit (as the crowd takes
  // its trade's colours): each garment by its kind, each construction part (hems, stitching, plackets) by the garment its own colour belongs to
  S.person.fit.dyed = dyeOutfit(S, raw);
  if (personDebug() === 'lambert' && S.body) { const m0 = [].concat(S.body.material)[0]; S.body.material = new THREE.MeshStandardMaterial({ color: m0.color ? m0.color.clone() : 0xb08070, roughness: 0.55 }); S.person.fit.debug = 'lambert'; }
  // 5. the scene's hat, on the person's skull (the scene's hat materials); the scalp cards hidden under it until the person build takes a hat
  S.hatGroup = null; S.hairTie = null;
  if (sceneO.hat && sceneO.hat !== 'none') { S._hat(sceneO); let k2 = 0; if (S.hatGroup && hatMats.length) S.hatGroup.traverse(m => { if (m.isMesh && hatMats[k2]) { m.material.dispose(); m.material = hatMats[k2]; } if (m.isMesh) k2++; });
    if (S.hatGroup && layers) S.hatGroup.traverse(m => { if (m.isMesh) m.layers.mask |= layers; });
    S.group.traverse(m => { if (m.userData && m.userData.part === 'hair8' && !['brows', 'lashes', 'lashesLow', 'beard', 'moustache'].includes(m.userData.hairPart)) m.visible = false; }); }
  S.group.updateMatrixWorld(true); if (S.correct) S.correct.update();
  return S;
}
// the scene's colours on the person's outfit: k3 parts (lib/fx/person's garments) re-dyed through fabricPack (the fibre's own take on the dye:
// the same function that dyed them at build), in place on the material's uniforms; foundations and soles, laces, eyelets keep their own
function dyeOutfit(S, raw) {
  const kindOf = s => /top|shirt|tee|jacket|coat|outer|vest|blouse|dress|sweat|hood/.test(s) ? 'top' : /trouser|pant|chino|jean|skirt|short|bottom|overall/.test(s) ? 'bottom' : null;
  const dye = { top: raw.shirt, bottom: raw.trousers, boot: raw.boots }, lumH = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const parts = []; S.group.traverse(m => { const k3 = m.isMesh && m.userData && m.userData.k3, mt = m.material && [].concat(m.material)[0]; if (k3 && mt && mt.uniforms_c6 && mt.userData && mt.userData.fabric) parts.push({ m, k3, mt, c0: new THREE.Color(k3.color || mt.color) }); });
  const garments = parts.filter(p => p.k3.group === 'garment').map(p => ({ ...p, kind: kindOf(String(p.k3.name || '').toLowerCase()) })).filter(p => p.kind);
  const dyeOf = p => { if (p.k3.group === 'garment') { const kd = kindOf(String(p.k3.name || '').toLowerCase()); return kd && dye[kd] ? { hex: dye[kd], f: 1 } : null; }
    if (p.k3.group === 'boot') return /upper/.test(p.k3.name || '') && dye.boot ? { hex: dye.boot, f: 1 } : null;
    if (p.k3.group !== 'construction' || !garments.length) return null;
    let best = null, bd = Infinity; for (const g of garments) { const d = (g.c0.r - p.c0.r) ** 2 + (g.c0.g - p.c0.g) ** 2 + (g.c0.b - p.c0.b) ** 2; if (d < bd) { bd = d; best = g; } }
    return best && dye[best.kind] ? { hex: dye[best.kind], f: Math.min(1.6, Math.max(0.4, lumH(p.c0) / Math.max(1e-4, lumH(best.c0)))) } : null; };
  let n = 0;
  for (const p of parts) { const d = dyeOf(p); if (!d) continue;
    const want = new THREE.Color(d.hex); if (d.f !== 1) want.multiplyScalar(d.f);
    const pk = fabricPack(p.mt.userData.fabric, '#' + want.getHexString()), U = p.mt.uniforms_c6, u = pk.uniforms;
    for (const key of ['fWeft', 'fCore', 'fLin', 'fSeam', 'fFlu']) if (U[key] && u[key] && U[key].value && U[key].value.copy) U[key].value.copy(u[key].value);
    if (U.cA) U.cA.value.copy(pk.params.color); if (U.cB) U.cB.value.copy(pk.params.color);
    p.mt.color.copy(pk.params.color); if (p.mt.sheenColor) p.mt.sheenColor.copy(pk.params.sheenColor); n++; }
  return n;
}
