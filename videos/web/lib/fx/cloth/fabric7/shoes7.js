// SHOES7 (FABRIC7, round 7, 8 Oct): the APPEARANCE and the drawn construction of our footwear. K4's sneaker (wardrobe4/shoe4.js) and CLOTH4's work boot (boot4.js) are
// good last-shaped geometry with no construction on it: AUDIT7 C21 reads them as white or brown blobs (soles the same colour as the uppers, a glossy plastic sole, laces as
// scribbles, no toe cap, no seams, no creases, no dirt). This module re-materials the parts by name after the person is built and DRAWS what the geometry does not carry:
//
//   upper    (sneaker canvas / boot leather: the fabric material the person already has) + construction in the foot's own frame:
//              foxing rows and a contact line at the sole, the toe-cap seam (groove + stitch rows, a rounded cap), the quarter-vamp seam, the heel counter and back-stay,
//              the eyestay rows either side of the throat, two metal-ringed air vents on the inner side (sneaker), the welt row (boot), the toe-box flex creases (colour AND
//              slope into the fabric's normal), dirt along the bottom edge and at the toe and heel, toe scuffs. Everything scales with the shoe (feature sizes x length / 27.5 cm).
//   sole     rubber, not the plain clearcoated plastic: satin (roughness 0.62, no clearcoat), cream-warm against a cooler upper, the midsole groove, yellowing at the bumper,
//            grime from the ground up the wall, scuff streaks along it, a fine stipple. (Boots: the leather-path sole becomes rubber too.)
//   eyelets  metal rings (nickel), the heel tab (sneaker) as webbing, the boot's toe-cap seam tube as thread: told apart by their place on the last.
//   laces    left as the fabric they are (K4's flat jersey / twill lace): their shape is geometry.
// The shoe's frame comes from its own geometry (the upper's z and x extent, the sole's wall-top profile in 16 bins and its ground), so any last K4 or CLOTH4 builds works; the shader
// reads the bind position through one varying (vS7) and four uniforms. No new vertex attribute (a garment mesh already carries many).
//
//   import { useShoes7, stopShoes7 } from '/web/lib/fx/cloth/fabric7/shoes7.js';
//   useShoes7({ dirt: 0.5, scuff: 0.5, crease: 1, stitch: 0.5 });   // stitch: the row half-width x (0.5 = a 0.75 mm sneaker row)   // BEFORE makePerson('latest:<name>') (it patches THREE.Object3D.prototype.add once: a shoe part is dressed when it is added)
// Needs: nothing else of fabric rev 7; with useFabric7() the canvas upper also carries its grain, tone and light.
import * as THREE from 'three';
import { lastUV7 } from './last7.js';

export const SHOES7_VERSION = 5;   // the integer is a flag (the bake page records it); there is one current revision: the last's own coordinate (last7.js), the three flex creases, the rubber toe cap. useShoes7({ geometryOnly: 1 }) applies the last's geometry fix and dresses nothing (the Cycles export labs/clothing2/fabric7_export.mjs).
const RE = /^(shoe|boot)\.(upper|sole|laces|eyelets)\.([LR])$/;
let ON = false, OPTS = { dirt: 0.5, scuff: 0.5, crease: 1, stitch: 0.5, parts: 'all', geometryOnly: 0 }, _patched = false;
export function useShoes7(o = {}) { OPTS = { ...OPTS, ...o }; ON = true; patchAdd(); return SHOES7_VERSION; }
export function stopShoes7() { ON = false; }
export const shoes7Options = () => ({ on: ON, ...OPTS });
function patchAdd() {
  if (_patched) return; _patched = true; const add0 = THREE.Object3D.prototype.add;
  THREE.Object3D.prototype.add = function (...objs) { const r = add0.apply(this, objs);
    if (ON) for (const o of objs) if (o?.isSkinnedMesh && o.userData?.k3?.name && RE.test(o.userData.k3.name)) { try { dressPart(this, o); } catch (e) { console.warn('shoes7:', o.userData.k3.name, e.message || e); } }
    return r; };
}
// explicit use (a page that builds people another way): dress every shoe part already under `root`
export function dressShoes7(root, o = {}) { OPTS = { ...OPTS, ...o }; const prev = ON; ON = true; let n = 0;
  root.traverse(m => { if (m.isSkinnedMesh && m.userData?.k3?.name && RE.test(m.userData.k3.name) && !m.material?.userData?.shoes7) { dressPart(m.parent, m); n++; } }); ON = prev; return n; }

// ---------------------------------------------------------------- the foot's frame (from the geometry), shared by the four parts of a foot
const BINS = 16;
function frameOf(parent, side, boot) {
  const U = parent.userData.shoes7 ||= {};
  return U[side] ||= { side, boot, F: { value: new THREE.Vector4(0, 0.27, 0, 0.045) }, G: { value: new THREE.Vector4(side === 'L' ? 1 : -1, boot ? 1 : 0, 0, 0) },
    C: { value: new THREE.Vector4(0.82, 0.80, 0.74, 0) }, T: { value: new THREE.Vector4(0.9, 0.9, 0.88, OPTS.stitch) }, S: { value: new THREE.Vector4(OPTS.dirt, OPTS.scuff, OPTS.crease, 0) }, B: { value: new Float32Array(BINS) }, got: {} };
}
function boundsOf(pos) { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < pos.length; i += 3) { x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]); z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]); } return { x0, x1, y0, y1, z0, z1 }; }
function fillUpper(fr, pos) { const b = boundsOf(pos); fr.F.value.set(b.z0, Math.max(b.z1 - b.z0, 0.05), (b.x0 + b.x1) / 2, Math.max((b.x1 - b.x0) / 2, 0.02)); fr.got.upper = b;
  // until the sole arrives: a wall top 2.5 cm over the upper's lowest point (so a page that never builds a sole still reads sensibly)
  if (!fr.got.sole) fr.B.value.fill(b.y0 + 0.025); }
function fillSole(fr, pos) { const b = boundsOf(pos); if (!fr.got.upper) fr.F.value.set(b.z0 + 0.002, Math.max(b.z1 - b.z0 - 0.004, 0.05), (b.x0 + b.x1) / 2, Math.max((b.x1 - b.x0) / 2 - 0.0025, 0.02));
  const L = fr.F.value.y, z0 = fr.F.value.x, top = new Float32Array(BINS).fill(-1e9);
  for (let i = 0; i < pos.length; i += 3) { const t = (pos[i + 2] - z0) / L, k = Math.round(Math.min(1, Math.max(0, t)) * (BINS - 1)); top[k] = Math.max(top[k], pos[i + 1]); }
  for (let k = 0; k < BINS; k++) if (top[k] < -1e8) top[k] = k ? top[k - 1] : b.y0 + 0.025;
  fr.B.value.set(top); fr.G.value.z = b.y0; fr.got.sole = b; }

// ---------------------------------------------------------------- GLSL
export const S7_VERT_PARS = 'varying vec3 vS7;';
export const S7_VERT = '\nvS7 = position;';
export const S7_PARS = `
varying vec3 vS7; uniform vec4 u7F, u7G, u7T, u7S, u7C; uniform float u7B[${BINS}];
float s7h(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float s7n(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(s7h(i), s7h(i + vec3(1.0, 0.0, 0.0)), f.x), mix(s7h(i + vec3(0.0, 1.0, 0.0)), s7h(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(s7h(i + vec3(0.0, 0.0, 1.0)), s7h(i + vec3(1.0, 0.0, 1.0)), f.x), mix(s7h(i + vec3(0.0, 1.0, 1.0)), s7h(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z); }
float s7ss(float a, float b, float x){ float u = clamp((x - a) / (b - a), 0.0, 1.0); return u * u * (3.0 - 2.0 * u); }
float s7wall(float t){ float x = clamp(t, 0.0, 1.0) * ${BINS - 1}.0, i = min(floor(x), ${BINS - 2}.0); int k = int(i); return mix(u7B[k], u7B[k + 1], x - i); }
float s7I(float x, float d){ return floor(x) * d + max(fract(x) - 1.0 + d, 0.0); }
float s7Pulse(float x, float d, float w){ w = max(w, 1e-4); return (s7I(x + 0.5 * w, d) - s7I(x - 0.5 * w, d)) / w; }
// a stitch row: thread dashes along arc a (pitch m) at distance d (m) from the row's line, the needle holes between them; px is the pixel's footprint (m).
// returns (thread, hole); fades to nothing as the pixel nears a stitch (the pattern then averages into the groove and the junction shading)
vec2 s7row(float d, float a, float pitch, float w, float px){
  float fx = 1.0 - s7ss(0.35 * pitch, 1.1 * pitch, px), cov = 1.0 - smoothstep(w - 0.5 * px, w + 0.5 * px, abs(d));
  float dash = s7Pulse(a / pitch, 0.74, px / pitch);
  return vec2(cov * dash, cov * (1.0 - dash) * 0.8) * fx; }
float s7groove(float d, float w, float px){ return exp(-d * d / (2.0 * w * w)) * (1.0 - s7ss(0.5 * w, 2.0 * w, px)); }
`;
// the upper's construction. In scope (fabric program, after the weave, wear and soil): col, pRough, gNap, pxm, gIn; gFoldG (the fabric's fold slope: creases add to it).
// Creases: three flex folds, 1.3 mm deep, sigma 2.1 mm (a footprint of 3 atlas texels), never gone; scuffs: patchy streaks whose direction wanders from patch to patch (no fan round a point);
// the sneaker's rubber toe cap (the front 1.2 cm, where the sole's pinched front leaves the upper showing).
export const S7_UPPER = `
{ float px = max(length(fwidth(vS7)), 1e-5);
if (gIn < 0.5) {
  float kb = u7G.y, kk = u7F.y / 0.275, L = u7F.y;
  float t = (vS7.z - u7F.x) / L, side = (vS7.x - u7F.z) * u7G.x, ls = clamp(side / u7F.w, -1.0, 1.0);
  float h = vS7.y - s7wall(t), lh = clamp(h / (0.055 * kk), 0.0, 1.0);
  float ar = atan(h * 1.4, side) * 0.04 * kk, ax = t * L, af = side > 0.0 ? ax : -ax;
  float pitch = (0.0036 + 0.0009 * kb) * kk, sw = (0.00075 + 0.0002 * kb) * kk * u7T.w, gw = 0.0007 * kk;
  vec3 thr = u7T.rgb; float st = 0.0, ho = 0.0, gv = 0.0; vec2 r;
  // the contact line at the sole and the foxing rows (sneaker) / the welt row (boot)
  float jn = 1.0 - s7ss(0.0, 0.0035 * kk, h);
  r = s7row(h - 0.0055 * kk, af, pitch, sw, px); st = max(st, r.x * (1.0 - kb)); ho = max(ho, r.y * (1.0 - kb));
  r = s7row(h - 0.0105 * kk, af + 0.5 * pitch, pitch, sw, px); st = max(st, r.x * (1.0 - kb)); ho = max(ho, r.y * (1.0 - kb));
  r = s7row(h - 0.0028 * kk, af, 1.25 * pitch, sw * 1.15, px); st = max(st, r.x * kb); ho = max(ho, r.y * kb);
  // the toe cap: a rounded overlay (its edge a groove, rows on the toe side)
  float tc = mix(0.865, 0.80, kb) - 0.06 * pow(lh, 1.3), dc = (t - tc) * L, cm = s7ss(0.0, 0.003 * kk, h);
  gv = max(gv, s7groove(dc, gw, px) * cm);
  r = s7row(dc - 0.0032 * kk, ar, pitch, sw, px); st = max(st, r.x * cm); ho = max(ho, r.y * cm);
  r = s7row(dc - 0.0067 * kk, ar + 0.5 * pitch, pitch, sw, px); st = max(st, r.x * cm * (1.0 - kb)); ho = max(ho, r.y * cm * (1.0 - kb));
  // the quarter-vamp seam (the sides only), the heel counter (a curved vertical seam, two rows on the heel side) and the back stay
  float tq = 0.40 + 0.17 * lh, dq = (t - tq) * L, qm = s7ss(0.25, 0.5, abs(ls)) * s7ss(0.08, 0.22, lh) * (1.0 - s7ss(0.8, 0.98, lh)) * (1.0 - 0.6 * kb);
  gv = max(gv, s7groove(dq, gw, px) * qm); r = s7row(dq + 0.0035 * kk, ar, pitch, sw, px); st = max(st, r.x * qm); ho = max(ho, r.y * qm);
  float th = 0.17 - 0.045 * lh, dh = (t - th) * L, hm = s7ss(0.0, 0.2, lh) * (1.0 - s7ss(0.97, 1.0, lh));
  gv = max(gv, s7groove(dh, gw, px) * hm); r = s7row(dh + 0.0035 * kk, ar, pitch, sw, px); st = max(st, r.x * hm); ho = max(ho, r.y * hm);
  r = s7row(dh + 0.0070 * kk, ar + 0.5 * pitch, pitch, sw, px); st = max(st, r.x * hm); ho = max(ho, r.y * hm);
  float bm = (1.0 - s7ss(0.04, 0.09, t)) * s7ss(0.1, 0.3, lh);
  r = s7row(abs(side) - 0.0035 * kk, h, pitch, sw, px); st = max(st, r.x * bm); ho = max(ho, r.y * bm);
  // the eyestay: two rows either side of the throat (the last turns the toe in: the same line as K4's eyelets)
  float xc = u7F.z - u7G.x * 0.11 * u7F.w * s7ss(0.45, 1.0, t), dx = abs(vS7.x - xc), em = s7ss(0.40, 0.42, t) * (1.0 - s7ss(0.62, 0.645, t)) * s7ss(0.55, 0.8, lh);
  r = s7row(dx - 0.0245 * kk, ax, pitch, sw, px); st = max(st, r.x * em); ho = max(ho, r.y * em);
  r = s7row(dx - 0.0300 * kk, ax + 0.5 * pitch, pitch, sw, px); st = max(st, r.x * em); ho = max(ho, r.y * em);
  // two air vents on the inner side (sneaker): a dark hole in a nickel ring
  float vt = 0.0, vh = 0.0;
  for (int i = 0; i < 2; i++) { vec2 dv = vec2((t - (0.305 + 0.04 * float(i))) * L, h - 0.019 * kk); float rr = length(dv) / kk, vm = (1.0 - kb) * s7ss(-0.35, -0.55, ls) * s7ss(0.004, 0.012, h) * (1.0 - s7ss(0.04, 0.06, h));
    vh = max(vh, (1.0 - smoothstep(0.0020, 0.0024, rr)) * vm); vt = max(vt, smoothstep(0.0020, 0.0024, rr) * (1.0 - smoothstep(0.0034, 0.0040, rr)) * vm); }
  // flex creases across the toe box: colour and slope (the fabric's fold normal carries them)
  float cw = 0.0, cr = 0.0, crs = 0.0, ca = u7S.z * (0.5 + 0.5 * kb);
  { float zs = vS7.z - u7F.x, zone = s7ss(0.2, 0.5, lh) * (1.0 - s7ss(0.82, 1.0, abs(ls)));
    for (int k = 0; k < 3; k++) { float fk = float(k), tk = 0.625 + 0.075 * fk + 0.02 * (s7h(vec3(fk, 3.1, 7.7)) - 0.5);                     // three folds about 2.1 cm apart on a 27.5 cm shoe, not evenly
      float wd = 0.011 * kk * (s7n(vec3(vS7.x * 38.0 + fk * 5.1, 1.7 + fk, 0.5)) - 0.5) * 2.0;                                              // each fold wanders across the foot by up to 1.1 cm
      float env = (0.7 + 0.3 * s7ss(0.2, 0.65, s7n(vec3(vS7.x * 26.0 + 9.0 * fk, 4.0 + fk, 2.0)))) * (0.75 + 0.25 * s7h(vec3(fk, 8.8, 1.3)));   // never gone              // deep in places, gone in others
      float d = zs - tk * L - wd, w = 0.0021 * kk, e1 = exp(-d * d / (2.0 * w * w)), w2 = 3.2 * w, d2 = d - w2, e2 = exp(-d2 * d2 / (2.0 * w2 * w2));
      float hk = -e1 + 0.35 * e2, sl = d / (w * w) * e1 - 0.35 * d2 / (w2 * w2) * e2;                                                       // a pinched groove with a soft shoulder on the toe side: height and slope along the foot
      float A = 0.0013 * kk * env * zone * ca;
      cr += hk * env * zone; crs += sl * A; cw = max(cw, env * zone * (e1 + 0.5 * e2)); }
    cr = clamp(cr * ca, -1.2, 1.2); }
  gFoldG.y += crs;
  // dirt along the bottom edge, at the toe and the heel; scuffs on the toe
  float dn = 0.55 + 0.45 * s7n(vec3(vS7.x * 140.0, vS7.y * 90.0, vS7.z * 140.0));
  float dirt = clamp(u7S.x * ((1.0 - s7ss(0.0, 0.03 * kk, h)) * 0.75 + 0.45 * s7ss(0.78, 1.0, t) * (1.0 - s7ss(0.0, 0.05 * kk, h)) + 0.25 * (1.0 - s7ss(0.0, 0.2, t)) * (1.0 - s7ss(0.0, 0.05 * kk, h))) * dn, 0.0, 0.7);
  float sa = 6.2832 * s7n(vec3(vS7.x * 21.0, vS7.y * 21.0, vS7.z * 21.0)), sc_ = cos(sa), ss_ = sin(sa);                               // the streaks' direction wanders from patch to patch (5 cm): no fan round one point
  float scn = s7n(vec3((sc_ * vS7.x + ss_ * vS7.z) * 160.0, vS7.y * 160.0, (sc_ * vS7.z - ss_ * vS7.x) * 26.0)), scuff = s7ss(0.62, 0.85, scn) * s7ss(0.45, 0.7, s7n(vec3(vS7.x * 33.0, vS7.y * 33.0, vS7.z * 33.0) + 5.0)) * s7ss(0.76, 0.95, t) * (1.0 - s7ss(0.1, 0.6, lh)) * u7S.y;   // patchy
  // compose
  float fx = 1.0 - s7ss(0.0012, 0.004, px);
  col *= 1.0 - 0.30 * gv * fx - 0.35 * jn * (1.0 - kb * 0.3);
  col *= 1.0 - 0.14 * ho;
  col = mix(col, thr, st * 0.8);
  col *= 1.0 + 0.14 * cr * fx;
  // the rubber toe cap, the front 1.2 cm of the sneaker's toe (its cap fan too: where the sole's pinched front leaves it showing, the c3 it2 grey disc, it is now the sole's own rubber)
  { float bmp = (1.0 - kb) * s7ss(0.955, 0.985, t), nzr = s7n(vec3(vS7.x * 70.0, vS7.y * 70.0, vS7.z * 70.0));
    vec3 rub = u7C.rgb * mix(vec3(1.0), vec3(1.0, 0.965, 0.90), 0.8) * (1.0 + 0.05 * (nzr - 0.5));
    col *= 1.0 - 0.30 * s7groove((t - 0.955) * L, gw, px) * fx * (1.0 - kb);
    col = mix(col, rub, bmp); pRough = mix(pRough, 0.62, bmp); gNap *= 1.0 - 0.7 * bmp; }
  col = mix(col, vec3(0.08, 0.075, 0.07), vh); col = mix(col, vec3(0.62, 0.61, 0.58), vt);
  col = mix(col, mix(vec3(0.17, 0.145, 0.115), col * 0.55, 0.3), dirt);
  col = mix(col, kb > 0.5 ? col * 1.22 + 0.015 : vec3(0.30, 0.27, 0.24), scuff * 0.55);   // scuffed leather is a little paler and (below) DULL, not a bright streak on a polished toe
  pRough = mix(pRough, 0.55, st * 0.6); pRough = mix(pRough, 0.32, vt * 0.8); pRough = mix(pRough, 0.95, dirt * 0.5); pRough = mix(pRough, 0.8, scuff);
  pRough = mix(pRough, pRough * (1.0 - 0.18 * kb * (0.5 + 0.5 * cr)), cw);
} }
`;
// the sole: rubber. In scope after roughnessmap_fragment: diffuseColor, roughnessFactor
export const S7_SOLE = `
{ float px = max(length(fwidth(vS7)), 1e-5), kb = u7G.y, kk = u7F.y / 0.275, L = u7F.y;
  float t = (vS7.z - u7F.x) / L, side = (vS7.x - u7F.z) * u7G.x;
  float wt = s7wall(t), gy = u7G.z, hs = clamp((vS7.y - gy) / max(wt - gy, 0.012), 0.0, 1.0), h = vS7.y - gy;
  vec3 c = diffuseColor.rgb;
  float nz = s7n(vec3(vS7.x * 70.0, vS7.y * 70.0, vS7.z * 70.0));
  c *= mix(vec3(1.0), vec3(1.0, 0.965, 0.90), 0.8 * (1.0 - kb));                                   // cream-warm against the cooler canvas
  c *= 1.0 + 0.05 * (nz - 0.5);
  float st = 1.0 - s7ss(0.001, 0.005, px);
  float mg = exp(-pow((hs - 0.58) / 0.045, 2.0)) * st;                                             // the midsole groove
  c *= 1.0 - (0.30 - 0.12 * kb) * mg;
  float bump = s7ss(0.84, 1.0, t) * s7ss(0.3, 0.8, hs);                                           // the bumper yellows and greys
  c = mix(c, c * vec3(1.0, 0.93, 0.78) * 0.93, 0.55 * bump * (1.0 - kb));
  float dn = 0.5 + 0.5 * s7n(vec3(vS7.x * 120.0, vS7.y * 60.0, vS7.z * 120.0));
  float dirt = clamp(u7S.x * (1.0 - s7ss(0.0, 0.55, hs)) * (0.55 + 0.6 * bump + 0.3 * (1.0 - s7ss(0.0, 0.15, t))) * dn * 1.1, 0.0, 0.75);
  c = mix(c, mix(vec3(0.16, 0.14, 0.115), c * 0.5, 0.3), dirt);
  float sc = s7ss(0.66, 0.9, s7n(vec3(vS7.z * 34.0, vS7.y * 520.0, side * 34.0))) * s7ss(0.1, 0.6, hs) * (1.0 - s7ss(0.8, 1.0, hs)) * u7S.y;   // scuff streaks along the wall
  c = mix(c, mix(vec3(0.22, 0.2, 0.18), c * 0.45, 0.4), 0.5 * sc);
  float ed = 1.0 - s7ss(0.0, 0.0025 * kk, h); c *= 1.0 - 0.35 * ed;                                // the ground edge
  diffuseColor.rgb = c;
  roughnessFactor = clamp(0.62 + 0.18 * (nz - 0.5) + 0.2 * dirt, 0.3, 1.0);
}
`;
// eyelets and tab: metal rings; the sneaker's heel tab (t < 0.15) webbing; the boot's toe-cap seam tube (t > 0.7) thread. After metalnessmap_fragment.
export const S7_EYE = `
{ float kb = u7G.y, t = (vS7.z - u7F.x) / u7F.y, tab = (1.0 - kb) * (1.0 - s7ss(0.12, 0.16, t)), seam = kb * s7ss(0.68, 0.72, t);
  float cl = max(tab, seam);
  diffuseColor.rgb = mix(diffuseColor.rgb, u7T.rgb * (seam > tab ? 0.78 : 0.9), cl);
  metalnessFactor = mix(0.92, 0.0, cl); roughnessFactor = mix(0.3, 0.82, cl); }
`;

// ---------------------------------------------------------------- the parts
function patchProgram(sh, kind, fabric) {
  sh.uniforms.u7F = this.F; sh.uniforms.u7G = this.G; sh.uniforms.u7T = this.T; sh.uniforms.u7S = this.S; sh.uniforms.u7B = this.B;
  sh.uniforms.u7C = this.C;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + S7_VERT_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>' + S7_VERT);
  let fs = sh.fragmentShader;
  if (fabric) {
    const a = 'vec3 fabP(){', b = 'diffuseColor.rgb = col; roughnessFactor = pRough;';
    if (!fs.includes(a) || !fs.includes(b)) throw new Error('shoes7: the fabric program changed (anchors)');
    fs = fs.replace(a, S7_PARS + a).replace(b, S7_UPPER + '  ' + b);
  } else {
    if (!fs.includes('#include <roughnessmap_fragment>') || !fs.includes('#include <metalnessmap_fragment>')) throw new Error('shoes7: three\'s physical shader changed');
    fs = fs.replace('#include <common>', '#include <common>\n' + S7_PARS);
    fs = kind === 'sole' ? fs.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + S7_SOLE) : fs.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + S7_EYE);
  }
  sh.fragmentShader = fs;
}
// lastUV7 on the upper's own geometry (a baked person's shoe is data, not rebuilt: the fix is applied as the part is added, in the engine, in the bake page and, through
// fabric7_export.mjs, in the Cycles export, so all three see the same vertices). aRest (the cloth-rest coordinate the fabric program reads as its position: a copy of uv made at load) follows uv.
function fixLast(mesh, boot) {
  const g = mesh.geometry, A = g.attributes; if (g.userData.last7 || !A.uv || !g.index) return;
  const r = lastUV7(A.position.array, A.uv.array, g.index.array, A.normal?.array, { boot }); g.userData.last7 = r; (globalThis.__last7 ||= []).push({ part: mesh.userData.k3?.name, ...r });
  if (!r.applied) return;
  if (A.aRest) { const R = A.aRest.array, U = A.uv.array; for (let i = 0; i < U.length / 2; i++) { R[i * 3] = U[i * 2]; R[i * 3 + 1] = U[i * 2 + 1]; } A.aRest.needsUpdate = true; }
  A.uv.needsUpdate = true; A.position.needsUpdate = true; if (A.normal) A.normal.needsUpdate = true; g.boundingSphere = null; g.boundingBox = null;
}
function dressPart(parent, mesh) {
  const m = RE.exec(mesh.userData.k3.name); if (!m) return;
  const [, fam, part, side] = m, boot = fam === 'boot';
  if (part === 'upper') fixLast(mesh, boot);                                       // the last's own coordinate and caps (before the frame reads the upper's extent)
  if (OPTS.geometryOnly) return;
  const fr = frameOf(parent, side, boot), pos = mesh.geometry.attributes.position.array;
  if (OPTS.parts !== 'all' && !String(OPTS.parts).split(',').includes(part)) return;
  (globalThis.__f7shoes ||= []).push(mesh);                                           // (the lab's feet camera finds the skeleton through it)
  const old = mesh.material, col = mesh.userData.k3.color || '#d8d4cc';
  if (part === 'upper') {
    fillUpper(fr, pos);
    // thread: the upper's own colour a little deeper (white canvas: a cream-grey thread; leather: a lighter tan)
    const c = new THREE.Color(col); fr.T.value.set(...(boot ? [Math.min(1, c.r * 2.1 + 0.05), Math.min(1, c.g * 1.9 + 0.04), Math.min(1, c.b * 1.5 + 0.02)] : [c.r * 0.9, c.g * 0.9, c.b * 0.88]), OPTS.stitch);
    if (old.uniforms_c6 && old.onBeforeCompile) {                                    // the fabric material: kept, the construction chained on
      const prev = old.onBeforeCompile, key0 = old.customProgramCacheKey();
      old.onBeforeCompile = (sh, r) => { prev(sh, r); patchProgram.call(fr, sh, 'upper', true); };
      old.customProgramCacheKey = () => key0 + '-s7u' + (boot ? 'b' : 's');
      old.userData.shoes7 = { part, boot }; old.needsUpdate = true;
    }
  } else if (part === 'sole') {
    fillSole(fr, pos); { const sc = new THREE.Color(col); fr.C.value.set(sc.r, sc.g, sc.b, 1); }   // the sole's colour, for the toe cap of the upper
    const mat = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.62, metalness: 0, specularIntensity: 0.55, sheen: 0.25, sheenRoughness: 0.7, sheenColor: new THREE.Color(col).lerp(new THREE.Color('#ffffff'), 0.4) });
    mat.onBeforeCompile = sh => patchProgram.call(fr, sh, 'sole', false); mat.customProgramCacheKey = () => 's7-sole' + (boot ? 'b' : 's'); mat.side = THREE.DoubleSide; mat.userData.shoes7 = { part, boot };
    mesh.material = mat; old.dispose?.();
  } else if (part === 'eyelets') {
    const mat = new THREE.MeshPhysicalMaterial({ color: '#b9b6ae', roughness: 0.3, metalness: 0.92, side: THREE.DoubleSide });
    mat.onBeforeCompile = sh => patchProgram.call(fr, sh, 'eyelets', false); mat.customProgramCacheKey = () => 's7-eye' + (boot ? 'b' : 's'); mat.userData.shoes7 = { part, boot };
    mesh.material = mat; old.dispose?.();
  }
}
