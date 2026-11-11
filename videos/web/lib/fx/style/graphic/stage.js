// STYLE c3: GraphicStage, STYLE c2's DrawStage (itself lane E's StyleStage) with one more medium kind, 'graphic': the marks of
// glsl.js (one material pass), a key AOV (id, depth, smooth normal), and GPU passes only (an edge pass, then one composite that
// dilates the key line, cuts and sprays the stencil layers, misregisters the riso plates and lays the ground): no JS pixel loop,
// so a frame costs what three scene renders and two full-screen passes cost (frame rate on the farm's V100s).
// Every other recipe goes to DrawStage / StyleStage unchanged, so one stage renders lane E's STYLES, DRAW_STYLES and GRAPHIC_STYLES.
//
//   const stage = new GraphicStage({ width, height, recipes: { ...DRAW_STYLES, ...GRAPHIC_STYLES } });
//   await stage.render(ctx, 'lino', { scene, camera, rig, heroes: [h1, h2], sunDir, people: [P1, P2], ppm });
//   people: the makePerson records (for the flat local colours: skin, hair); ppm: px per metre fixed for a shot (a walk)
//   feedFaces: true (stage option or render option): faces under ~90 px get a designer's marks (faces.js), in ANY recipe
import * as THREE from 'three';
import { DrawStage, installDraw } from '../draw/stage.js';
import { loadDrawAnatomy } from '../draw/fields.js';
import { setSurface } from '../recipes.js';
import { GX_U, GX_COMMON, patchGraphic } from './glsl.js';
import { faceMarks } from './faces.js';
import { OUTFITS4 } from '../../cloth/wardrobe4/outfits4.js';   // STYLE c6: the wardrobe's tuck (data only)
import { hairColour5, GREY5 } from '../../hair/shade.js';         // STYLE c6 rev 7e.2: the hair's own colour model (read, never changed)

const raw = (c, out = new THREE.Color()) => { const n = parseInt(String(c).replace('#', ''), 16); return out.setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, THREE.LinearSRGBColorSpace); };
const KIND = { lino: 1, stencil: 2, riso: 3, flat: 4, chalk: 5, wash: 7, debug: 9, local: 8, phase: 10, mural: 11, notan: 12 };   // notan: a COMPOSITE kind (medium.comp) over the flat pass

// ids in the key AOV (gxObj + 1): body and eyes 1 (no hem between them), garments 10+, hair 51+ (no inner edges), other 70+
function classOf(h, m) {
  const part = m.userData.part || '', k3 = m.userData.k3;
  if (m === h.body) return { cls: 0, obj: 0 };
  if (/^eye/.test(part) || m === h.eyes) return { cls: 3, obj: 0 };
  if (/hair|brow|lash|beard/i.test(part)) return { cls: 2, obj: 50 };
  if (k3 || /cloth|garment|found|construction|boot|hat|glove/i.test(part)) return { cls: 1, obj: 9 };
  return { cls: 4, obj: 69 };
}
// STYLE c6 (rev 7): each garment's OWNER from its bake part (K4 / CLOTH5-8 bakes: userData.k3 { group, name }): the underwear
// ('found'), the shoes, the bottom, the top, the outer layer; construction parts (hems, cuffs, plackets, pockets, stitches) belong to
// their garment by name. null: not a sewn garment (older heroes' cloth: no rank, one group)
const GRP = { body: 0, found: 1, boot: 2, bottom: 3, top: 4, outer: 5, hair: 6, other: 7 };
export function ownerOf(m) {
  const k3 = m.userData.k3; if (!k3) return null; const g = k3.group || '', n = String(k3.name || '').toLowerCase();
  if (g === 'found') return 'found'; if (g === 'boot' || /^(boot|shoe)/.test(n)) return 'boot';
  if (/^(outer|jacket|coat|vest)/.test(n)) return 'outer';
  if (/^(trousers|jeans|fly|hem$|hem\.|waistband|button\.waist|skirt|chinos|pants|scrubpants|belt)/.test(n)) return 'bottom';
  if (/^(top|shirt|tee|sweat|collar|button\.collar|button\.cuff|buttons|placket|cuff|blouse|scrubtop|neckband)/.test(n)) return 'top';
  return g === 'garment' || g === 'construction' ? 'top' : null;
}
// the ranks: which of the bottom and the top is outside at the waist (tucked in or not) from the bind geometry: the garment whose
// cloth lies further from the waist's centre in the band just under the bottom's waist line is the outer one there
function layerRanks(h, owners, P = null) {
  const sets = { bottom: [], top: [] }; for (const [m, o] of owners) if ((o === 'bottom' || o === 'top') && m.visible && m.userData.k3?.group !== 'found') sets[o].push(m);
  let topOut = true, share = null;
  if (sets.bottom.length && sets.top.length) {
    let yT = -1e9; for (const m of sets.bottom) if (m.userData.k3?.group === 'garment') { const P = m.geometry.attributes.position.array; for (let i = 1; i < P.length; i += 3) yT = Math.max(yT, P[i]); }
    let y0 = 1e9, y1 = -1e9; { const P = h.body.geometry.attributes.position.array; for (let i = 1; i < P.length; i += 3) { y0 = Math.min(y0, P[i]); y1 = Math.max(y1, P[i]); } }
    const u = (y1 - y0) / 1.7;   // the bind space's metre (a 1.7 m body)
    const band = (m, f) => { const P = m.geometry.attributes.position.array; for (let i = 0; i < P.length; i += 3) if (P[i + 1] < yT - 0.015 * u && P[i + 1] > yT - 0.05 * u) f(P[i], P[i + 2]); };
    let cx = 0, cz = 0, n = 0; { const P = h.body.geometry.attributes.position.array; for (let i = 0; i < P.length; i += 3) if (P[i + 1] < yT - 0.015 * u && P[i + 1] > yT - 0.05 * u) { cx += P[i]; cz += P[i + 2]; n++; } }
    if (n) { cx /= n; cz /= n;
      // per angle round the waist: the outermost cloth of each garment; the top is outside where its cloth lies beyond the bottom's
      const NB = 36, rb = (ms) => { const r = new Float64Array(NB).fill(-1); for (const m of ms) band(m, (x, z) => { const a = Math.floor((Math.atan2(z - cz, x - cx) / (2 * Math.PI) + 0.5) * NB) % NB, d = Math.hypot(x - cx, z - cz); if (d > r[a]) r[a] = d; }); return r; };
      const rt = rb(sets.top), rB = rb(sets.bottom); let k = 0, out = 0; for (let a = 0; a < NB; a++) if (rt[a] > 0 && rB[a] > 0) { k++; if (rt[a] > rB[a] + 0.002 * u) out++; }
      if (k) { share = out / k; topOut = share >= 0.5; } } }
  // the wardrobe's own word wins where the person is one of K4's (a tucked shirt the cloth solve let out at the waist is still tucked)
  const spec = OUTFITS4[P?.info?.name] || OUTFITS4[String(P?.info?.name || '').replace(/^v\d+:/, '')], from = spec?.top ? 'wardrobe' : 'geometry';
  if (spec?.top) topOut = spec.top.tuck !== 'in';
  const order = ['boot', topOut ? 'bottom' : 'top', topOut ? 'top' : 'bottom', 'outer'].filter(o => [...owners.values()].includes(o));
  const rank = {}; order.forEach((o, i) => { rank[o] = order.length - 1 - i; }); rank.found = -1;
  return { rank, tucked: !topOut, topOutShare: share, from, order };
}
// the hair's flat colour from the person's OWN pigment (STYLE c6 rev 7e.2): the melanins the groom was made with (P.report.hair, else
// P.hair) through the hair system's colour model (hair/shade.js hairColour5: the volume's albedo in Cycles' units, Chiang et al. 2016), the
// grey share of unpigmented fibres (GREY5) mixed in by area; display-encoded as every flat colour is. Before this the looks read one hex per
// ancestry group (person/index.js HAIR_HEX: every white person's hair '#4a3424'), so a blonde, a grey bob and a dark brown printed alike
const _enc = x => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
export function hairFlatOf(P) {
  const m = P?.report?.hair?.melanin || P?.hair?.melanin; if (!m || typeof m !== 'object' || !(m.eu >= 0)) return null;
  const g = Math.max(0, Math.min(0.95, +(P?.hair?.grey ?? 0) || 0)), a = hairColour5(m.eu, m.ph ?? 0).albedo, w = hairColour5(GREY5, 0).albedo;
  const c = a.map((x, i) => _enc((1 - g) * x + g * w[i]));
  return '#' + c.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
}
// fields + chained patches on every material of a hero (once); P: the makePerson record (skin and hair colours), when given
export function installGraphic(h, A, P = null) {
  if (h._graphic) return h._graphic;
  installDraw(h, A);
  const skin = h.o?.skin || P?.info?.skin || '#b08a70', hair = hairFlatOf(P) || P?.hair?.hex || P?.hair?.colour || P?.hair?.color || h.o?.hair || '#2a1d14';
  let n = 0, kc = 0; const per = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }, head = { value: new THREE.Vector4(0, 0, 0, 0) }, surf = [];   // STYLE c5: the head's ball (view space) for the designed hair
  const owners = new Map(); h.group.traverse(m => { if (m.isMesh && classOf(h, m).cls === 1) { const o = ownerOf(m); if (o) owners.set(m, o); } });   // STYLE c6
  const LR = layerRanks(h, owners, P);
  h.group.traverse(m => { if (!m.isMesh) return; const c = classOf(h, m); per[c.cls]++;
    const ow = c.cls === 1 ? owners.get(m) : null, grp = c.cls === 0 || c.cls === 3 ? GRP.body : c.cls === 2 ? GRP.hair : ow ? GRP[ow] : GRP.other, rk = ow ? (LR.rank[ow] ?? 0) : 0;
    const obj = c.cls === 1 ? c.obj + (++kc % 30) : c.obj, mats = [].concat(m.material);
    for (const mt of mats) { if (!mt) continue;
      let flat = new THREE.Vector4(0, 0, 0, 0);
      if (c.cls === 0) { const s = raw(skin); flat.set(s.r, s.g, s.b, 1); }
      else if (c.cls === 2) { const s = raw(hair); flat.set(s.r, s.g, s.b, 1); }
      else if (c.cls === 1) { const hex = m.userData.k3?.color; if (hex) { const s = raw(hex); flat.set(s.r, s.g, s.b, 1); } else if (mt.color) { const s = mt.color.clone().convertLinearToSRGB(); flat.set(s.r, s.g, s.b, 1); } }
      const nv = { value: 0 }, key = c.cls === 0 ? 'skin' : c.cls === 2 ? 'hair' : ow && ow !== 'found' ? ow : null;   // STYLE c6 it10: the notan's surface
      if (key && flat.w > 0.5) surf.push({ key, u: nv, lv: 0.2126 * flat.x + 0.7152 * flat.y + 0.0722 * flat.z, n: m.geometry?.attributes?.position?.count || 0 });
      if (patchGraphic(mt, { gxObj: { value: obj }, gxFlat: { value: flat }, gxCls: { value: c.cls }, gxHead: head, gxRank: { value: rk }, gxGrp: { value: grp }, gxNv: nv })) n++; } });
  return (h._graphic = { materials: n, parts: per, skin, hair, head, layers: { ...LR, owners: owners.size }, surf });
}

// THE NOTAN'S VALUE PLAN (STYLE c6 it10). A notan is designed before it is cut: the artist gives each SHAPE of the figure one of the three
// values so that the shapes that meet read apart (Dow: 'the arrangement of dark and light'; Ward and Catlett keep a face off its collar and a
// hand off the cloth it hangs over), and each shape keeps as near its own local value as that allows. Read off the local value alone, the
// shapes that meet fall into one class (a deep-skinned man in a grey sweatshirt reads shirtless, navy scrubs swallow the arms and hands of
// the nurse wearing them, a jacket and jeans make one mass). The plan, for ANY person (it reads the person's surfaces: skin, hair and each
// owner garment's dye, never a name): every class for the hair and the garments is tried (3^n, n <= 5); a choice COSTS the distance from
// the surface's local luma into that class's band (in tenths of luma; the bands are the notan's own: x1.y, x1.z) and GAINS, for each pair
// of shapes that meet, its weight when their light classes differ and half of it when their shadow classes (one darker) differ; the
// cheapest wins (ties: the local classes). THE SKIN IS NEVER MOVED (a person's skin keeps its own value; the clothes and the hair are what
// the designer moves). Two garments of one dye keep one class (a set of scrubs). Weights: the face and hands against what they meet first.
const NOTAN_PAIRS = [['skin', 'outer', 3], ['skin', 'top', 3], ['skin', 'hair', 3], ['skin', 'bottom', 1.5], ['top', 'bottom', 2], ['outer', 'bottom', 2],
  ['outer', 'top', 1.5], ['hair', 'top', 1], ['hair', 'outer', 1], ['boot', 'bottom', 1]];
export function notanPlan(surf, x1 = [0.45, 0.25, 0.56]) {
  const [X, Y, Z] = x1, by = new Map();
  for (const s of surf || []) { const e = by.get(s.key); if (!e || s.n > e.n) by.set(s.key, s); }   // each surface's dye: its largest part
  const local = (k, lv) => k === 'skin' ? (lv > X ? 2 : 1) : lv < Y ? 0 : lv < Z ? 1 : 2;
  const band = [[0, Y], [Y, Z], [Z, 1e9]], cost = (lv, c) => (lv < band[c][0] ? band[c][0] - lv : lv >= band[c][1] ? lv - band[c][1] + 1e-3 : 0) / 0.1;
  const keys = [...by.keys()], lv = Object.fromEntries(keys.map(k => [k, by.get(k).lv])), L = Object.fromEntries(keys.map(k => [k, local(k, lv[k])]));
  const free = keys.filter(k => k !== 'skin'), outer = by.has('outer');
  // under a jacket the top shows at the throat only (the face's contact halves) and the hair meets the jacket, not the top
  const P = NOTAN_PAIRS.filter(([a, b]) => by.has(a) && by.has(b) && !(outer && a === 'hair' && b === 'top')).map(([a, b, w]) => [a, b, a === 'skin' && b === 'top' && outer ? w / 2 : w]);
  const ties = []; for (const a of free) for (const b of free) if (a < b && a !== 'hair' && b !== 'hair' && Math.abs(lv[a] - lv[b]) < 0.015) ties.push([a, b]);
  let best = { E: Infinity, C: { ...L } };
  for (let i = 0; i < 3 ** free.length; i++) {
    const C = { skin: L.skin }; let t = i, E = 0; for (const k of free) { C[k] = t % 3; t = Math.floor(t / 3); E += cost(lv[k], C[k]); }
    if (ties.some(([a, b]) => C[a] !== C[b])) continue;
    for (const [a, b, w] of P) E -= w * ((C[a] !== C[b]) + 0.5 * (Math.max(C[a] - 1, 0) !== Math.max(C[b] - 1, 0)));
    if (E < best.E - 1e-9) best = { E, C };
  }
  const shift = Object.fromEntries(keys.map(k => [k, (best.C[k] ?? L[k]) - L[k]]));
  return { local: L, cls: best.C, shift, lv };
}

// ---------------------------------------------------------------- the GPU passes
const FS_TRI = (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)); return g; })();
const VS = 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
const EDGE_FS = /* glsl */`
precision highp float; uniform sampler2D tK; uniform vec3 uKey; uniform vec4 uLine; uniform vec2 uRes;   // uLine: weight px, hem k, crease k, (w) the print's line (0: off)
uniform vec4 uLine2;   // STYLE c5: x lock lines inside the hair (a depth step of x m between hair pixels), y their weight k
layout(location = 0) out vec4 oE;
vec4 K(ivec2 p){ return texelFetch(tK, clamp(p, ivec2(0), ivec2(uRes) - 1), 0); }
// THE PRINT'S LINE (uLine.w > 0, the four-ink print): one weight (not swelled by the light or the depth step: the poster's ragged burrs were
// the per-pixel width), and between two parts of ONE garment (the key AOV's owner: a pocket, a placket, a cuff, a stitch on its shirt) a
// seam only where the part stands proud by more than uLine.w m (a collar's edge); between garments, skin and hair as before
float eGrp(vec4 k){ float id = floor(k.x + 0.5); return floor((k.x - id) / 0.04 + 0.5); }
bool eCloth(float id){ return id > 9.5 && id < 49.5; }
vec3 Nof(vec4 k){ return vec3(k.z, k.w, sqrt(max(0.0, 1.0 - k.z * k.z - k.w * k.w))); }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy); vec4 k = K(p); oE = vec4(0.0);
  if (k.x < 0.5) return;
  float id = floor(k.x + 0.5), z = k.y; vec3 n = Nof(k); bool hair = id > 50.5 && id < 70.5;
  float contour = 0.0, crease = 0.0, hem = 0.0, lock = 0.0;
  ivec2 D[4] = ivec2[4](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
  for (int i = 0; i < 4; i++) { vec4 q = K(p + D[i]); if (q.x < 0.5) { contour = 1.0; continue; }
    float jd = floor(q.x + 0.5), zj = q.y; bool jh = jd > 50.5 && jd < 70.5;
    if (hair && jh) { if (uLine2.x > 0.0 && zj - z > uLine2.x) lock = 1.0; continue; }   // the hair is one mass: its cards draw no inner lines (c5: but its locks)
    if (zj - z > z * (0.012 + 0.04 * (1.0 - abs(n.z)))) contour = max(contour, clamp((zj - z) / (z * 0.05), 0.0, 1.0) * 0.8 + 0.2);
    float dn = 1.0 - dot(n, Nof(q)); if (dn > 0.35) crease = max(crease, clamp((dn - 0.35) / 0.4, 0.0, 1.0));
    if (jd != id && zj >= z - z * 0.004) {
      float g = eGrp(k); bool one = uLine.w > 0.0 && eCloth(id) && eCloth(jd) && g > 0.5 && g < 6.5 && abs(eGrp(q) - g) < 0.5;
      if (!one || zj - z > uLine.w) hem = 1.0; } }
  float shade = 1.0 - clamp(dot(n, uKey) * 2.0 + 0.5, 0.0, 1.0), W = uLine.x;
  float r = 0.0, a = 0.0;
  if (contour > 0.0) { r = W * 0.5 * (0.55 + 0.6 * shade) * (0.7 + 0.3 * contour); a = 1.0; }
  else if (hem > 0.0 && uLine.y > 0.0) { r = W * 0.5 * 0.5 * (0.7 + 0.5 * shade) * uLine.y; a = 0.9; }
  else if (crease > 0.0 && uLine.z > 0.0) { r = W * 0.5 * 0.42 * crease * (0.6 + 0.6 * shade) * uLine.z; a = 0.85; }
  else if (lock > 0.0) { r = W * 0.5 * uLine2.y; a = 0.8; }
  if (uLine.w > 0.0 && a > 0.0) { if (contour > 0.0) r = W * 0.5 * 0.8; else if (hem > 0.0) { r = W * 0.5 * 0.55 * uLine.y; a = 1.0; } }   // the print: one weight
  oE = vec4(max(r, a > 0.0 ? 0.6 : 0.0), a, shade, id);
}`;
// the composite: background + figure + dilated key line + the medium's screen-side work. Uniforms per kind (uK*: see GRAPHIC_STYLES)
const COMP_FS = /* glsl */`
precision highp float;
uniform sampler2D tS, tE, tK, tP; uniform vec2 uRes; uniform float uKind, uRmax, uS; uniform vec3 uC0, uC1, uC2, uC3, uLineC, uBg, uBg2;   // tP: the print's cut planes (CUT_FS)
uniform vec4 uK0, uK1, uK2; uniform vec4 uFeet[16]; uniform float uNFeet; uniform vec4 uBand; uniform vec3 uKey;
uniform vec4 uX2;   // (the four-ink print, x2: on, the cut's radius px, the dark hair's lens, the ground's paper margin px)
uniform vec4 uL2, uP1, uHairHi, uX0, uX1;   // STYLE c5: flat2 (x on, y shadow smoothing radius px), the flat kind's p1, the hair's highlight colour; per-kind extras
layout(location = 0) out vec4 oC;
${GX_COMMON}
vec4 S(vec2 p){ return texelFetch(tS, clamp(ivec2(p), ivec2(0), ivec2(uRes) - 1), 0); }
vec4 E(ivec2 p){ return texelFetch(tE, clamp(p, ivec2(0), ivec2(uRes) - 1), 0); }
// the key line's coverage at p: the max over the edge pixels within uRmax of their anti-aliased discs
float lineCov(vec2 p){ float c = 0.0; int R = int(uRmax + 0.5);
  for (int y = -8; y <= 8; y++) { if (abs(y) > R) continue; for (int x = -8; x <= 8; x++) { if (abs(x) > R) continue;
    vec4 e = E(ivec2(p) + ivec2(x, y)); if (e.y <= 0.0) continue; float d = length(vec2(x, y)); c = max(c, clamp(e.x + 0.5 - d, 0.0, 1.0) * e.y); } }
  return c; }
// STYLE c5 FLAT2: the shadow shape smoothed over the form (a Gaussian over the same surface: same id, depth within 2 %), cut at its
// middle with an anti-aliased edge one derivative wide; the light shape; the fold contour; the hair's own highlight colour
vec2 tap0(int i, int n){ float r = sqrt((float(i) + 0.5) / float(n)), a = float(i) * 2.39996323; return r * vec2(cos(a), sin(a)); }
vec3 flat2(vec2 p, vec4 s){
  float a0 = s.a - 1.0, idx = floor(a0 + 0.001), fr = a0 - idx, hiB = step(0.495, fr), band = clamp((fr - 0.5 * hiB) / 0.49, 0.0, 1.0);
  vec3 lc = s.rgb; if (idx > 127.5) return lc;
  vec4 kc = texelFetch(tK, clamp(ivec2(p), ivec2(0), ivec2(uRes) - 1), 0); float idc = floor(kc.x + 0.5), zc = kc.y, shB = idx / 127.0;
  float hiS = hiB;
  if (uL2.y > 0.5) { float ws = 0.8, sa = 0.8 * shB, ha = 0.8 * hiB;
    for (int i = 0; i < 32; i++) { vec2 t = tap0(i, 32), o = t * uL2.y; vec4 q = S(p + o); if (q.a < 0.5) continue; float qa = q.a - 1.0, qi = floor(qa + 0.001); if (qi > 127.5) continue;
      vec4 kq = texelFetch(tK, clamp(ivec2(p + o), ivec2(0), ivec2(uRes) - 1), 0); if (abs(floor(kq.x + 0.5) - idc) > 0.5 || abs(kq.y - zc) > zc * 0.02) continue;
      float w = exp(-2.5 * dot(t, t)); ws += w; sa += w * qi / 127.0; ha += w * step(0.495, qa - qi); }
    shB = sa / ws; if (uL2.z > 0.5) hiS = ha / ws; }
  float aa = clamp(fwidth(shB) * 0.7, 0.02, 0.25), sh = smoothstep(0.5 - aa, 0.5 + aa, shB);
  if (uL2.z > 0.5) { float ah = clamp(fwidth(hiS) * 0.7, 0.02, 0.25); hiB = smoothstep(0.5 - ah, 0.5 + ah, hiS); }   // STYLE c5: the light shape smoothed like the shadow
  bool hair = idc > 50.5 && idc < 70.5;
  vec3 shadow = lc * uC3 * uP1.x, lightC = mix(lc, vec3(1.0), uP1.y), hiC = hair ? mix(lc, uHairHi.rgb, uHairHi.w) : mix(lc, vec3(1.0), uP1.z);
  return mix(mix(mix(lightC, hiC, hiB), shadow, sh), uLineC, band);
}
// STYLE c6 NOTAN (rev 7): the owner garment from the key AOV (installGraphic's gxGrp x 0.04 on the id), the local value class of a
// surface from its flat colour (0 ink, 1 mid, 2 paper: skin is mid or paper, never ink in the light, as Catlett keeps a dark face's
// lit planes; cloth and hair by value), one class darker in the shadow; the shadow shape smoothed over the form as flat2 does
// THE VALUE PLAN (it10; uK1.x 1): the style pass carries (the local luma, the surface's class shift + 2 over 4) and the class is the local
// class moved by the plan's shift (stage.js notanPlan: each person's shapes that meet read apart; the skin is never moved)
float nGrp(vec4 k){ float id = floor(k.x + 0.5); return floor((k.x - id) / 0.04 + 0.5); }
float nLocal(float lv, float g){ if (g < 0.5) return lv > uX1.x ? 2.0 : 1.0; return lv < uX1.y ? 0.0 : lv < uX1.z ? 1.0 : 2.0; }
float nClass(vec4 q, float g){ if (uK1.x < 0.5) return nLocal(gxLuma(q.rgb), g); return clamp(nLocal(q.r, g) + floor(q.g * 4.0 + 0.5) - 2.0, 0.0, 2.0); }
// THE SKIN'S LIT PLANE (it11; uK1.y 1, read off the plan's channel): where the skin's form faces the key (the style pass's light shape:
// N.key on the smooth normal above p2.z, the planes within ~45 degrees of the light) the skin steps up one class: deep skin mid to paper
// (the forehead, the cheekbone, the nose's lit side, the lit edge of an arm: the planes Catlett and Ward cut white and a photograph carries
// as the brightest of the figure), a light skin is paper already; the ink shadow only where the form turns away. A painted mark on the skin
// (the brows, stubble, the scalp's painted hair: the plan's b) keeps its own class
float nRaw(vec4 q, vec4 kq){ float a0 = q.a - 1.0, ix = floor(a0 + 0.001), lv = gxLuma(q.rgb); if (ix > 127.5) return lv > 0.5 ? 2.0 : 0.0;
  float g = nGrp(kq), c = nClass(q, g), sd = step(63.5, ix);
  if (uK1.y > 0.5 && g < 0.5) c = min(c + step(0.495, a0 - ix) * (1.0 - sd) * (1.0 - step(0.5, q.b)), 2.0);
  return max(c - sd, 0.0); }
float nLit(vec2 p, vec4 s, vec4 kc){
  float idc = floor(kc.x + 0.5), zc = kc.y, a0 = s.a - 1.0, ws = 0.8, sa = 0.8 * step(0.495, a0 - floor(a0 + 0.001));
  if (uL2.y < 0.5) return sa / ws;
  for (int i = 0; i < 32; i++) { vec2 t = tap0(i, 32), o = t * uL2.y; vec4 q = S(p + o); if (q.a < 0.5) continue; float qa = q.a - 1.0, qi = floor(qa + 0.001); if (qi > 127.5) continue;
    vec4 kq = texelFetch(tK, clamp(ivec2(p + o), ivec2(0), ivec2(uRes) - 1), 0); if (abs(floor(kq.x + 0.5) - idc) > 0.5 || abs(kq.y - zc) > zc * 0.02) continue;
    float w = exp(-2.5 * dot(t, t)); ws += w; sa += w * step(0.495, qa - qi); }
  return sa / ws; }
vec3 nInk(float c){ return c < 0.5 ? uC0 : c < 1.5 ? uC3 : uC2; }
float nShade(vec2 p, vec4 s, vec4 kc){
  float idc = floor(kc.x + 0.5), zc = kc.y, a0 = s.a - 1.0, shB = floor(a0 + 0.001) / 127.0, ws = 0.8, sa = 0.8 * shB;
  for (int i = 0; i < 32; i++) { vec2 t = tap0(i, 32), o = t * uL2.y; vec4 q = S(p + o); if (q.a < 0.5) continue; float qi = floor(q.a - 1.0 + 0.001); if (qi > 127.5) continue;
    vec4 kq = texelFetch(tK, clamp(ivec2(p + o), ivec2(0), ivec2(uRes) - 1), 0); if (abs(floor(kq.x + 0.5) - idc) > 0.5 || abs(kq.y - zc) > zc * 0.02) continue;
    float w = exp(-2.5 * dot(t, t)); ws += w; sa += w * qi / 127.0; }
  return sa / ws; }
// STENCIL7 (the CUT stencil): the style pass's shadow (b's fraction) smoothed over the form (one shape a form, as flat2
// and the notan: same surface, depth within 2 %), and the inks of a surface's layer (0 light, 1 mid, 2 dark): skin its OWN light and
// mid inks (STYLE c5's ramp of value, the person's hue; never black from the light), cloth the cream and the accent red, a LIGHT
// surface's shadow (a pale shirt, grey hair) the warm grey, the rest cream and warm grey; the dark layer black for all
float st7Shade(vec2 p, vec4 s, vec4 kc){
  float idc = floor(kc.x + 0.5), zc = kc.y, ws = 0.8, sa = 0.8 * fract(s.b) / 0.98;
  for (int i = 0; i < 32; i++) { vec2 t = tap0(i, 32), o = t * uL2.y; vec4 q = S(p + o); if (q.a < 0.5) continue;
    vec4 kq = texelFetch(tK, clamp(ivec2(p + o), ivec2(0), ivec2(uRes) - 1), 0); if (abs(floor(kq.x + 0.5) - idc) > 0.5 || abs(kq.y - zc) > zc * 0.02) continue;
    float w = exp(-2.5 * dot(t, t)); ws += w; sa += w * fract(q.b) / 0.98; }
  return sa / ws; }
vec3 st7Ink(vec4 q, float layer, float cL){
  if (layer > 1.5) return uC0;
  float cd = floor(q.b + 0.001);
  if (cd > 1.5) {
    float kL = floor(q.r * 0.5), tL = smoothstep(uK2.y, uK2.z, kL * 0.01);
    vec3 skinB = tL < 0.5 ? mix(vec3(0.36, 0.2, 0.11), vec3(0.66, 0.43, 0.28), tL * 2.0) : mix(vec3(0.66, 0.43, 0.28), vec3(0.92, 0.72, 0.58), tL * 2.0 - 1.0);
    if (uX0.x > 0.5) { vec3 rb = gxHSV(skinB); float qa = max(q.a - 1.0, 0.0), hu = fract(floor(qa + 0.0001) * 0.01 + 0.005 - 0.25), sa = fract(qa) / 0.99;
      skinB = gxRGB(vec3(hu, clamp(mix(rb.y, sa * uX0.y, uX0.z), 0.2, 0.78), rb.z)); }
    return layer < 0.5 ? mix(skinB, uC2, uK2.w * tL) : skinB * mix(0.52, 0.64, tL); }
  if (layer < 0.5) return uC2;
  return cd > 0.5 && cL > 0.5 ? uC1 : uC3; }
// THE POSTER AS A FOUR-INK PRINT (sovietPoster7: K 4 with uX1.x > 0.5; uX1 [on, plane radius m, the planes' terminator, registration px at
// 1080], uX2 [on, the cut's radius px, -, the ground's paper margin px]; uBg the fourth ink, a deep blue): the Stenbergs' and Lebedev's
// lithographs, four flat inks (paper, red, blue, black) and each person's own skin inks (deep skin reads deep), printed as plates:
//   PLANES  a cloth surface's shadow from its smooth normal averaged over the same OWNER garment (PLANE_FS) and CUT by a 1.2 cm majority
//           (CUT_FS: tP), one plane a form, a hard edge with one pixel of anti-aliasing; skin keeps flat2's smoothing (a face keeps its nose
//           and sockets); dark and brown hair ONE BLACK MASS with its LIT CRESCENT (the band along the mass's outline on the key's side,
//           PLANE_FS: as wide as medium.x2[2] where the outline faces the key, thinning to nothing as it turns away) in the blue (dark hair)
//           or the red (brown hair); light hair paper with a red (warm) or blue shadow; the hair's colour is the person's own pigment
//           (installGraphic: the hair system's melanin, grey strands mixed in)
//   INKS    a garment's dye (after the pull toward the red and the blue) to a light ink and a shadow ink: pale (a colour over 0.6 luma, a
//           neutral over 0.4) paper with a red (warm) or blue shadow; a warm colour red with a black shadow; the rest blue with a black
//           shadow; shoes black
//   PLATES  the black plate (the black inks, the key line, the cast shadow) at p, the colour plates uX1.w px off; the black OVERPRINTS (the
//           colour plate under a black is the surface's other ink), black-only shapes are trapped, the eyes in register; the ground's red cut
//           back from every figure by a paper margin. The composite prints the inks FLAT; the paper's tooth and the ink's film are WEAR_FS's
// an ink's colour: 0 paper, 1 red, 2 blue, 3 black, 4 the skin's light ink, 5 its shadow ink
vec3 pInk(float i, vec3 lc){ return i < 0.5 ? uC2 : i < 1.5 ? uC1 : i < 2.5 ? uBg : i < 3.5 ? uC0 : i < 4.5 ? lc : lc * uC3 * uP1.x; }
// a surface's (light ink, shadow ink); cls 0 skin, 1 cloth (and other), 2 hair
vec2 pInks(vec3 lc, float cls){
  if (cls < 0.5) return vec2(4.0, 5.0);
  vec3 h = gxHSV(lc); float y = gxLuma(lc); bool col = h.y > 0.3, warm = abs(fract(h.x - gxHSV(uC1).x + 0.5) - 0.5) < abs(fract(h.x - 0.6 + 0.5) - 0.5);
  if (y > (col ? 0.6 : 0.4)) return vec2(0.0, col && warm ? 1.0 : 2.0);
  if (col && warm && y > 0.1) return vec2(1.0, 3.0);
  return vec2(2.0, 3.0); }
// the figure at q as the plates print it (pFig2): returns the BLACK plate's coverage; col the colour plates' colour; trap 1: a surface black
// in both inks (dark hair, shoes: nothing prints under it, the composite fills the knockout from the pixel's own colour), 2: the eyes (the
// key stone's drawing, in register)
float pCut(float share){ float aa = clamp(0.6 / max(uX2.y, 1.0), 0.02, 0.3); return smoothstep(0.5 - aa, 0.5 + aa, share); }
vec2 pInks2(vec3 lc, float cls, float g){
  if (cls < 0.5) return vec2(4.0, 5.0);
  if (cls < 1.5 && g > 1.5 && g < 2.5) return vec2(3.0, 3.0);
  if (cls < 1.5) return pInks(lc, cls);
  // the hair: light (blonde, grey) paper with a red or blue shadow; brown (a warm pigment that still shows: M23's 0.055) the black mass
  // with a RED crescent; dark (black, near-black brown: F24's 0.017) the black mass with a BLUE crescent (pFig2 sets the crescent)
  vec3 h = gxHSV(lc); float y = gxLuma(lc); bool col = h.y > 0.3, warm = abs(fract(h.x - gxHSV(uC1).x + 0.5) - 0.5) < abs(fract(h.x - 0.6 + 0.5) - 0.5);
  if (y >= 0.3) return vec2(0.0, col && warm ? 1.0 : 2.0);
  return col && warm && y > 0.03 ? vec2(1.0, 3.0) : vec2(3.0, 3.0); }
float pFig2(vec2 q, out vec3 col, out float trap){
  vec4 s = S(q); col = uC2; trap = 0.0; if (s.a < 0.5) return 0.0;
  float a0 = s.a - 1.0, idx = floor(a0 + 0.001), fr = a0 - idx, hiB = step(0.495, fr), band = clamp((fr - 0.5 * hiB) / 0.49, 0.0, 1.0);
  vec3 lc = s.rgb; if (idx > 127.5) { trap = 2.0; return gxLuma(lc) > 0.5 ? 0.0 : 1.0; }
  ivec2 iq = clamp(ivec2(q), ivec2(0), ivec2(uRes) - 1); vec4 kc = texelFetch(tK, iq, 0);
  float id = floor(kc.x + 0.5), cls = id < 1.5 ? 0.0 : (id > 50.5 && id < 70.5) ? 2.0 : 1.0, g = floor((kc.x - id) / 0.04 + 0.5), sh;
  vec4 pc = texelFetch(tP, iq, 0);
  if (cls > 0.5) sh = 1.0 - pCut(pc.x);
  else sh = smoothstep(0.42, 0.58, uL2.y > 0.5 ? nShade(q, s, kc) : idx / 127.0);
  vec2 ik = pInks2(lc, cls, g);
  if (cls > 1.5) { band = 0.0; bool mass = pc.w - 1.0 > 0.3;   // the hair's mass, not a brow, a lash or a wisp (those stay black)
    // dark or brown hair: one black mass; on the mass, its lit crescent (CUT_FS's z: the share of the cut's disc in the crescent) in the
    // blue (dark) or the red (brown); brows, lashes and wisps black
    if (ik.y > 2.5) { if (!mass) ik = vec2(3.0, 3.0); else { ik = vec2(ik.x > 0.5 && ik.x < 1.5 ? 1.0 : 2.0, 3.0); sh = 1.0 - pCut(pc.z); } } }
  bool kL = ik.x > 2.5 && ik.x < 3.5, kS = ik.y > 2.5 && ik.y < 3.5, hair = cls > 1.5;
  vec3 cL = kL ? (kS || hair ? uC2 : pInk(ik.y, lc)) : pInk(ik.x, lc), cS = kS ? (kL || hair ? uC2 : pInk(ik.x, lc)) : pInk(ik.y, lc);
  col = mix(cL, cS, sh);
  float kb = mix(kL ? 1.0 : 0.0, kS ? 1.0 : 0.0, sh);
  if ((kL && kS) || (hair && kb > 0.5)) trap = 1.0;
  return max(kb, band); }
// the ground plate cut back from the figures: a figure within m px of q (two rings)
bool pNear(vec2 q, float m){ for (int i = 0; i < 16; i++) { float a = float(i) * 0.3926991; vec2 d = vec2(cos(a), sin(a)); if (S(q + d * m).a > 0.5 || S(q + d * m * 0.5).a > 0.5) return true; } return false; }
// a soft ground shadow under each figure (the feet), away from the key
float feet(vec2 p){ float s = 0.0; for (int i = 0; i < 16; i++) { if (float(i) >= uNFeet) break; vec4 f = uFeet[i]; vec2 q = (p - f.xy) / f.zw; s = max(s, 1.0 - smoothstep(0.55, 1.0, length(q))); } return s; }
float feetHard(vec2 p){ float s = 0.0; for (int i = 0; i < 16; i++) { if (float(i) >= uNFeet) break; vec4 f = uFeet[i]; vec2 q = (p - f.xy) / f.zw; s = max(s, 1.0 - smoothstep(0.9, 1.0, length(q))); } return s; }
// disc taps (a sunflower), radius 1
vec2 tap(int i, int n){ float r = sqrt((float(i) + 0.5) / float(n)), a = float(i) * 2.39996323; return r * vec2(cos(a), sin(a)); }
void main(){
  vec2 p = gl_FragCoord.xy, P = p / uS; int K = int(uKind + 0.5);
  vec4 s = S(p); float fig = s.a;
  float L = lineCov(p);
  float ground = uBand.x;                                                   // the feet line (px, GL rows), the ground starts there
  vec3 c;
  if (K == 1) {
    // LINO: the sheet; a black ground block from the feet down, cut with horizontal gouges thinning toward the horizon; the
    // figure; its key line (the edge of the block's cut)
    float tooth = gxF2(P * 0.9);
    vec3 paper = uC2 * (0.97 + 0.05 * tooth);
    c = paper;
    float gy = ground - p.y + uBand.y;                                      // px below the top of the block
    if (gy > 0.0) { float t = clamp(gy / (uRes.y * 0.22), 0.0, 1.0), rr = log(1.0 + gy / (40.0 * uS)) * 13.3, ln = floor(rr), d = abs(fract(rr) - 0.5);
      float along = P.x / (150.0 + 220.0 * gxH1(ln)) + gxH1(ln + 3.0) * 4.0, fa = fract(along);
      float prof = smoothstep(0.0, 0.25, fa) * (1.0 - smoothstep(0.55, 0.95, fa)) * step(0.4, gxH2(vec2(ln, floor(along))));
      float w = 0.5 * prof * (0.22 + 0.4 * t) * (1.0 - feet(p) * 0.9), aa = fwidth(rr);
      float cutG = 1.0 - smoothstep(w - aa, w + aa, d);
      c = mix(paper, uC0 * (0.92 + 0.12 * tooth), (1.0 - cutG) * smoothstep(0.0, 1.5 * uS, gy)); }
    if (fig > 0.5) c = s.rgb * mix(1.0, 0.94 + 0.1 * tooth, step(gxLuma(s.rgb), 0.3));
    c = mix(c, uLineC * (0.92 + 0.1 * tooth), L);
  } else if (K == 2) {
    // STENCIL7: the spray stencil CUT as a stencil is cut (the WPA's silkscreens, the street stencil): each surface
    // is ITS two layers, the light one and, inside the shadow smoothed over the form, one darker (no screen-space average of the tone
    // across surfaces: no thin mid rims where a light shape meets a dark one, no islands); the edges are the cut's (ss 2: clean curves);
    // the inks flat (no mottle); the key line on the dark layer; overspray ONLY just outside the figure's cut (droplets one 1080-px
    // each, falling off over uX1.y px) and round the ground bar; a plain wall. No bridges (c5's were averaged away over its 3.6 px
    // disc and never showed; per pixel they would stripe every dark shape)
    c = uBg * (0.975 + 0.035 * gxF2(P * 0.004 + 2.0));
    float gb = feetHard(p), gs = feet(p) * (1.0 - gb), drop = gxH2(floor(P) + 0.5);
    c = mix(c, uC0, max(gb, float(drop < gs * 0.22 * uX1.z)));
    if (fig > 0.5) {
      vec4 kc = texelFetch(tK, clamp(ivec2(p), ivec2(0), ivec2(uRes) - 1), 0);
      float Tl = s.r - 2.0 * floor(s.r * 0.5), cL = Tl > uK1.y ? 2.0 : Tl > uK1.x ? 1.0 : 0.0, skin = step(1.5, floor(s.b + 0.001));
      float sb = uL2.y > 0.5 ? st7Shade(p, s, kc) : fract(s.b) / 0.98, aa = clamp(fwidth(sb) * 0.7, 0.02, 0.25), sh = smoothstep(0.5 - aa, 0.5 + aa, sb);
      float cS = min(cL + 1.0, 2.0 - skin);                                 // the shadow layer: one darker (skin: its mid ink, never black)
      vec3 lo = st7Ink(s, cL, cL), hi = st7Ink(s, cS, cL);
      c = mix(lo, hi, sh);
      c = mix(c, uC0, L * uK1.z);
    } else {
      float fo = 0.0; vec4 q0 = vec4(0.0); bool got = false;
      for (int i = 0; i < 16; i++) { vec4 q = S(p + tap(i, 16) * uX1.y * uS); if (q.a > 0.5) { fo += 1.0; if (!got) { q0 = q; got = true; } } }
      fo /= 16.0;
      if (got && drop < fo * fo * 4.0 * uX1.z) c = st7Ink(q0, 0.0, 0.0);
      c = mix(c, uC0, L * uK1.z);
    }
  } else if (K == 3) {
    // RISO: two plates, each misregistered by its own offset (px at 1080), multiplied on the sheet (the inks are translucent);
    // the key line printed with the dark plate; a sun disc behind in the light plate's halftone (on the sheet)
    vec2 oa = uK0.xy * uS, ob = uK0.zw * uS;
    vec4 sa = S(p + oa), sb = S(p + ob);
    float ia = sa.a > 0.5 ? sa.r : 0.0, ib = sb.a > 0.5 ? sb.g : 0.0;
    float Lb = lineCov(p + ob);
    // the sheet's own inks: a disc (light plate, halftone falling off), the ground band
    vec2 ctr = uK2.xy, d0 = (p + oa - ctr); float rr = length(d0) / uK2.z;
    float kd = rr < 1.0 ? mix(0.95, 0.35, smoothstep(0.2, 1.0, rr)) * uK2.w : 0.0;
    vec2 g = mat2(0.966, -0.259, 0.259, 0.966) * (p + oa) / (uK1.x * uS); float spot = 0.5 - 0.25 * (cos(6.2831853 * g.x) + cos(6.2831853 * g.y));
    float bgA = step(spot, kd) * (1.0 - step(0.5, sa.a));
    float gy = ground - (p.y + ob.y), gband = smoothstep(-1.0, 1.0, gy + uBand.y) * uK1.y * (1.0 - step(0.5, sb.a));
    vec2 g2 = mat2(0.707, -0.707, 0.707, 0.707) * (p + ob) / (uK1.x * uS); float spot2 = 0.5 - 0.25 * (cos(6.2831853 * g2.x) + cos(6.2831853 * g2.y));
    float bgB = step(spot2, gband * 0.45 + feet(p + ob) * 0.5);
    float A = clamp(max(ia, bgA), 0.0, 1.0), B = clamp(max(max(ib, bgB), Lb), 0.0, 1.0);
    float tooth = gxF2(P * 1.1), grainA = 0.86 + 0.14 * gxF2(P * 0.35 + 3.0), grainB = 0.88 + 0.12 * gxF2(P * 0.35 + 9.0);
    vec3 paper = uC2 * (0.975 + 0.04 * tooth);
    c = paper * mix(vec3(1.0), uC1, A * (0.9 + 0.1 * tooth) * grainA) * mix(vec3(1.0), uC0, B * (0.92 + 0.08 * tooth) * grainB);
    if (uK1.z != 0.0) { vec4 sc = S(p + uK1.zw * uS); float Cc = sc.a > 0.5 ? sc.b : 0.0;   // STYLE c4: the blue plate, its own offset
      c *= mix(vec3(1.0), uC3, clamp(Cc, 0.0, 1.0) * (0.9 + 0.1 * tooth) * (0.87 + 0.13 * gxF2(P * 0.35 + 15.0))); }
  } else if (K == 4 && uX1.x > 0.5) {
    // THE PRINT (pFig2 above): the colour plates at q = p - o (the ground's red, the figure's colour inks), then the black plate at p (the
    // black inks, the key line, the cast shadow); the knockouts trapped, the eyes in register; the ground's red cut back from every figure
    // by a paper margin (uX2.w px). The inks FLAT here: the paper's tooth and the ink's film on it are WEAR_FS's, after this pass
    vec2 q = p - uX1.w * uS * vec2(0.8, -0.6); vec3 cc = uC2;
    float rr = length(q - uK2.xy) / max(uK2.z, 1.0); if (uK2.w > 0.5 && rr < 1.0) cc = uBg2;
    if (uK2.w < 0.5) { vec2 g = q - vec2(uRes.x * 0.5, ground); float yy = dot(g, vec2(-sin(uK0.z), cos(uK0.z))); if (yy < uRes.y * 0.05 && yy > -uRes.y * 0.17) cc = uBg2; }
    {
      vec3 fc, cp = uC2; float tq = 0.0, tp = 0.0, kb = 0.0;
      if (S(q).a > 0.5) { pFig2(q, fc, tq); cc = fc; }
      else if (uX2.w > 0.0 && distance(cc, uBg2) < 1e-4 && pNear(q, uX2.w)) cc = uC2;
      if (fig > 0.5) { kb = pFig2(p, cp, tp); if (tq > 0.5 || tp > 1.5) cc = cp; }
      kb = max(max(kb, L), feetHard(p) * 0.92);
      c = mix(cc, uC0, kb);
    }
  } else if (K == 4) {
    // FLAT (poster / cel): a designed ground (poster: the paper, a red band or disc behind; cel: a painted sky and floor), the
    // cast shadow shape under the feet, the figure, its key line
    float gy = ground - p.y;
    if (uK0.w < 0.5) { float tooth = gxF2(P * 0.9); c = uC2 * (0.97 + 0.05 * tooth);
      vec2 ctr = uK2.xy; float rr = length(p - ctr) / uK2.z; if (uK2.w > 0.5 && rr < 1.0) c = uBg2;
      if (uK2.w < 0.5) { vec2 q = p - vec2(uRes.x * 0.5, ground); float yy = dot(q, vec2(-sin(uK0.z), cos(uK0.z))); if (yy < uRes.y * 0.05 && yy > -uRes.y * 0.17) c = uBg2; }
      c = mix(c, uC0, feetHard(p) * 0.92); }
    else { float t = clamp((p.y - ground) / (uRes.y - ground), 0.0, 1.0); c = gy > 0.0 ? mix(uBg2 * 1.05, uBg2 * 0.9, clamp(gy / (uRes.y * 0.3), 0.0, 1.0)) : mix(uBg * 0.97, uBg * 1.08, t);
      c = mix(c, uBg2 * 0.62, feetHard(p)); }
    if (fig > 0.5) c = flat2(p, s);
    c = mix(c, uLineC, L);
  } else if (K == 5) {
    // CHALK: the board (slate with the ghosts of erased chalk), a chalk ground line and a hatched shadow, the figure, its chalk
    // contour (broken by the board's tooth)
    float tooth = gxN2(p * 0.7) * 0.5 + gxN2(p * 0.23) * 0.5, smear = gxF2(P * 0.006 + 1.3), arcs = gxF2(vec2(length(P - uRes / uS * vec2(0.3, 0.8)) * 0.02, 0.0) + P * 0.002);
    c = uC0 * (0.94 + 0.12 * tooth) + vec3(0.05, 0.055, 0.05) * smoothstep(0.55, 0.85, smear) * (0.6 + 0.4 * arcs);
    float gy = ground - p.y, gl = (1.0 - smoothstep(0.6 * uS, 1.8 * uS, abs(gy + 0.5 * uS))) * step(0.35, tooth);
    float hs = feet(p) * step(0.5, fract((p.x + p.y) / (5.0 * uS))) * step(0.4, tooth);
    c = mix(c, uC2 * 0.9, max(gl * 0.85, hs * 0.55));
    if (fig > 0.5) c = s.rgb;
    c = mix(c, uLineC, L * smoothstep(0.25, 0.6, tooth + 0.2) * 0.92);
  } else if (K == 7) {
    // WASH, WET (watercolour): the sheet (cold-pressed: two scales of tooth); the sky laid wet (its edge blooming into the paper); the figure's
    // washes BLEED into each other where the body is wet (alpha), along a feathered, paper-broken reach; pigment POOLED at every wash edge
    // as a thin dark rim (the drying front), stronger than c4; GRANULATION in the paper's valleys, heavier in the dense and cool washes;
    // the lights left as paper; a faint pencil line
    float t1 = gxN2(p * 0.55), t2 = gxN2(p * 0.17 + 3.0), t3 = gxN2(P * 0.05 + 9.0), tooth = t1 * 0.6 + t2 * 0.4;
    vec3 paper = uC2 * (0.962 + 0.05 * tooth + 0.015 * t3);
    float gy = ground - p.y, yy = (p.y - ground) / uRes.y;
    float sky = smoothstep(-0.25, 0.1, yy - 0.12 * (gxF2(P * 0.006) - 0.5)) * (1.0 - smoothstep(0.5, 0.95, yy + 0.2 * gxF2(P * 0.009 + 4.0)));
    float skyRim = smoothstep(0.0, 0.25, sky) * (1.0 - smoothstep(0.25, 0.6, sky));
    c = paper * mix(vec3(1.0), uBg, sky * uK0.x) * (1.0 - 0.12 * skyRim * uX0.w);
    c *= mix(vec3(1.0), uC3, feet(p) * uK0.y * smoothstep(0.2, 0.8, gxF2(P * 0.05) + 0.3));
    if (fig > 0.5) {
      float hr = step(1.5, s.r); vec3 w = s.rgb - 2.0 * hr; float wet = clamp(s.a - 1.0, 0.0, 1.0);
      // bleed: the washes within reach (wet x uX0.z px, the reach broken by the paper) averaged in, the same surface only (hair apart)
      if (wet > 0.02 && hr < 0.5) { vec3 wb = w; float nb = 1.0, R = uX0.z * uS * wet * (0.6 + 0.8 * t3);
        for (int i = 0; i < 16; i++) { vec2 o = tap(i, 16) * R; vec4 q = S(p + o); if (q.a < 0.5 || q.r > 1.5) continue; wb += q.rgb; nb += 1.0; }
        w = mix(w, wb / nb, 0.85); }
      float e = 0.0, eIn = 0.0, out1 = 0.0;
      for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398; vec2 o = vec2(cos(a), sin(a)) * uK0.z * uS; vec4 q = S(p + o);
        if (q.a > 0.5) { float qh = step(1.5, q.r); vec3 qw = q.rgb - 2.0 * qh; if (qh < 0.5 || hr < 0.5) { float dl = gxLuma(qw) - gxLuma(w); e = max(e, gxLuma(abs(qw - w))); eIn = max(eIn, dl); } } else out1 = 1.0; }
      float d = 1.0 - gxLuma(w);
      // the drying front: pigment pooled on the DARKER side of each edge (eIn > 0: a lighter wash next door), a thin rim
      float rim = smoothstep(0.015, 0.1, eIn) * (0.45 + 0.55 * d) + 0.7 * out1;
      w *= 1.0 - uK0.w * 1.6 * rim * (1.0 - 0.85 * hr);
      // granulation: pigment settled in the valleys of the paper, two scales, more in the dense and in the cool (glaze) washes
      float cool = clamp((w.b - w.r) * 3.0 + 0.3, 0.0, 1.0), gr = (t1 - 0.5) * 1.4 + (gxN2(p * 1.3 + 5.0) - 0.5) * 0.8;
      w *= 1.0 - uK1.x * uX0.w * d * (0.6 + 0.8 * cool) * gr;
      c = paper * clamp(w, 0.0, 1.0);
    }
    c = mix(c, uLineC, L * uK1.y);
  } else if (K == 11) {
    // MURAL (STYLE c5): the wall (fresco plaster: a lime ground, mottled, a few hairline cracks), a painted world behind (a sky band in
    // uBg over an earth band in uBg2 from a horizon above the feet, laid in horizontal strokes), the cast shadow in umber, the figure,
    // its BOLD contour (umber, the brush's edge broken by the plaster), the plaster's texture over everything (the wall does not move)
    float pl = gxF2(P * 0.02) * 0.5 + gxN2(P * 0.35) * 0.3 + gxN2(p * 0.9) * 0.2;
    float hz = ground + uX0.x * uS, gy = ground - p.y, br = gxF2(vec2(P.x * 0.01, P.y * 0.07)), br2 = gxN2(vec2(P.x * 0.04, P.y * 0.45));
    float t = clamp((p.y - hz) / (uRes.y - hz), 0.0, 1.0);
    c = p.y > hz ? mix(uBg * 1.04, uBg * 0.9, t) * (0.9 + 0.14 * br + 0.05 * br2) : uBg2 * (0.86 + 0.16 * br + 0.06 * br2) * mix(1.0, 0.86, clamp(gy / (uRes.y * 0.25), 0.0, 1.0));
    c = mix(c, uBg2 * 0.55, (1.0 - smoothstep(0.5 * uS, 2.5 * uS, abs(p.y - hz))) * 0.5);
    c = mix(c, uC0 * 1.3, feet(p) * 0.65);
    if (fig > 0.5) c = s.rgb;
    c = mix(c, uLineC, L * smoothstep(0.15, 0.45, pl + 0.15));
    float crack = (1.0 - smoothstep(0.0, 0.012, abs(gxN2(P * 0.012 + 3.0) - 0.5))) * step(0.6, gxN2(P * 0.004 + 1.0));
    c *= (0.93 + 0.1 * pl) * (1.0 - 0.25 * crack * uX0.y);
  } else if (K == 12) {
    // NOTAN (STYLE c6, rev 7; Dow's notan, the three-value poster): the sheet (paper), a disc behind the figures in the mid or the red
    // (bg2), the cast shadow in ink; the figure in THREE values (paper, mid, ink) from its local value and the smoothed light (one shape a
    // form); where two shapes of one value meet (deep skin against dark cloth, a shirt against its trousers, an arm over the body) the
    // farther one is cut back by a SEPARATION line (paper; ink between paper shapes), the woodcut's and the Stenbergs' white line; no
    // outline but where a paper shape meets the paper ground
    float tooth = gxF2(P * 0.9); c = uC2 * (0.975 + 0.04 * tooth);
    float rr = length(p - uK2.xy) / max(uK2.z, 1.0); if (uK2.w > 0.5 && rr < 1.0) c = uBg2 * (0.975 + 0.04 * tooth);
    c = mix(c, uC0, feetHard(p) * 0.95);
    if (fig > 0.5) {
      vec4 kc = texelFetch(tK, clamp(ivec2(p), ivec2(0), ivec2(uRes) - 1), 0); float gp = nGrp(kc), zp = kc.y, a0 = s.a - 1.0, ix = floor(a0 + 0.001), lv = gxLuma(s.rgb);
      float cH, sh = 0.0; vec3 col;
      if (ix > 127.5) { cH = lv > 0.5 ? 2.0 : 0.0; col = nInk(cH); }
      else { float sb = uL2.y > 0.5 ? nShade(p, s, kc) : ix / 127.0, aa = clamp(fwidth(sb) * 0.7, 0.02, 0.25); sh = smoothstep(0.5 - aa, 0.5 + aa, sb);
        float cL = nClass(s, gp), cS = max(cL - 1.0, 0.0); col = mix(nInk(cL), nInk(cS), sh); cH = sh > 0.5 ? cS : cL;
        // it11: the skin's lit plane, one class up where the smoothed light shape holds (never in the shadow; a mark keeps its class)
        if (uK1.y > 0.5 && gp < 0.5 && cL < 1.5 && s.b < 0.5) { float lt = smoothstep(0.42, 0.58, nLit(p, s, kc)) * (1.0 - sh);
          col = mix(col, nInk(cL + 1.0), lt); if (lt > 0.5) cH = cL + 1.0; } }
      // the separation (raw classes on both sides, the farther shape cut), and the paper shape's edge against the ground
      float cr = nRaw(s, kc), sep = 0.0, bgn = 0.0; vec2 nn = kc.zw; float nz = sqrt(max(0.0, 1.0 - dot(nn, nn)));
      for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398; vec2 o = vec2(cos(a), sin(a)) * uX1.w; vec4 q = S(p + o);
        if (q.a < 0.5) { bgn = 1.0; continue; }
        vec4 kq = texelFetch(tK, clamp(ivec2(p + o), ivec2(0), ivec2(uRes) - 1), 0); float gq = nGrp(kq), zq = kq.y;
        bool jump = zp - zq > zp * (0.015 + 0.04 * (1.0 - nz)); if (abs(gq - gp) < 0.5 && !jump) continue;
        if (abs(nRaw(q, kq) - cr) > 0.5) continue;
        if (jump || zq < zp * 0.996 || (abs(zq - zp) <= zp * 0.004 && gq > gp)) sep = 1.0; }
      if (sep > 0.5) col = cH > 1.5 ? uC0 : uC2;
      else if (bgn > 0.5 && cH > 1.5) col = uC0;
      c = col;
    }
  } else if (K == 0) { oC = vec4(uLineC * L, L); return; }              // lines only, premultiplied (over another stage's picture)
  else c = fig > 0.5 ? s.rgb : vec3(0.5);
  oC = vec4(c, 1.0);
}`;

// STYLE c4: NEWSREEL, a post pass on the LIT render (the v4 person as photographed on the stage): an orthochromatic black-and-white
// (red reads dark, as on the stocks of the 1920s-40s), a print curve, the lens's softness and halation, grain that changes every
// frame, the gate's weave (the frame shifts a fraction of a pixel, frame to frame), exposure flicker, a vignette, dust and the odd
// scratch; halftone > 0: printed as a coarse newspaper halftone of the same still (the press photograph). uF: frame number.
const NEWS_FS = /* glsl */`
precision highp float; uniform sampler2D tL; uniform vec2 uRes; uniform float uF, uS; uniform vec4 uN0, uN1, uN2; uniform vec3 uTint;
layout(location = 0) out vec4 oC;
${GX_COMMON}
float Y(vec2 q){ vec3 c = texture(tL, clamp(q / uRes, vec2(0.0), vec2(1.0))).rgb; c = gxLin(c); return dot(c, vec3(uN0.x, uN0.y, uN0.z)); }
void main(){
  vec2 p = gl_FragCoord.xy, P = p / uS; float f = uF;
  vec2 weave = (vec2(gxH1(f * 1.37), gxH1(f * 2.11 + 5.0)) - 0.5) * uN1.x * uS + vec2(0.0, sin(f * 0.9) * 0.35 * uN1.x * uS);
  vec2 q = p + weave;
  float y = Y(q) * 0.5 + (Y(q + vec2(1.0, 0.0) * uS) + Y(q - vec2(1.0, 0.0) * uS) + Y(q + vec2(0.0, 1.0) * uS) + Y(q - vec2(0.0, 1.0) * uS)) * 0.125;   // the lens's softness
  float hal = 0.0; for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398; hal += Y(q + vec2(cos(a), sin(a)) * 7.0 * uS); } hal /= 8.0;
  y = y + uN1.y * max(hal - 0.6, 0.0);                                                           // halation round the highlights
  y *= 1.0 + (gxH1(f * 0.71 + 3.0) - 0.5) * uN1.z;                                                // flicker
  float v = y / (y + 0.18); v = pow(clamp(v, 0.0, 1.0), uN0.w);                                    // a print curve (toe and shoulder)
  vec2 uv = p / uRes - 0.5; v *= 1.0 - uN2.x * dot(uv, uv) * 2.2;                                   // vignette
  float g = (gxH2(floor(P / 1.3) + f * 17.0) + gxH2(floor(P / 2.1) + f * 29.0 + 3.0)) - 1.0;      // grain, new every frame
  v += g * uN1.w * (0.35 + v * (1.0 - v) * 2.6);
  {
    float dust = step(0.9985, gxH2(floor(P / 3.0) + f * 7.3)) * step(0.5, gxH1(f * 0.3));
    float sx = gxH1(floor(f / 7.0) * 3.1) * uRes.x, scr = (1.0 - smoothstep(0.4, 1.2, abs(p.x - sx) / uS)) * step(0.82, gxH1(floor(f / 7.0) + 11.0)) * (0.5 + 0.5 * gxN2(vec2(p.y * 0.02, f)));
    v = mix(v, 0.05, dust * 0.8); v = mix(v, 0.92, scr * uN2.z); }
  oC = vec4(clamp(v * uTint, 0.0, 1.0), 1.0);
}`;
// STYLE c5: THE DESIGNED HAIR MASS, a pass between the style / key passes and the edges: the hair (ids 51-70) is one shape, the
// majority of a Gaussian disc of radius uR px (a few mm on the head): gaps between cards close, stray card tips and wisps go, the
// outline is a smooth curve the edge pass then inks. A pixel that joins the mass takes the mean hair (colour, shading codes, depth,
// normal); one that leaves it takes its nearest non-hair neighbour (face, collar) or the ground. uOut 0: the style AOV, 1: the key AOV.
const HAIR_FS = /* glsl */`
precision highp float; uniform sampler2D tS, tK; uniform vec2 uRes; uniform float uR, uOut;
layout(location = 0) out vec4 oC;
vec4 S(vec2 p){ return texelFetch(tS, clamp(ivec2(p), ivec2(0), ivec2(uRes) - 1), 0); }
vec4 K(vec2 p){ return texelFetch(tK, clamp(ivec2(p), ivec2(0), ivec2(uRes) - 1), 0); }
bool isH(vec4 k){ float id = floor(k.x + 0.5); return k.x > 0.5 && id > 50.5 && id < 70.5; }
vec2 tap(int i, int n){ float r = sqrt((float(i) + 0.5) / float(n)), a = float(i) * 2.39996323; return r * vec2(cos(a), sin(a)); }
void main(){
  vec2 p = gl_FragCoord.xy; vec4 s = S(p), k = K(p); bool hc = isH(k);
  float wT = 1.0, wH = hc ? 1.0 : 0.0, wO = 0.0, wB = 0.0, bO = 0.0, sh = 0.0, hi = 0.0, zH = 1e9, idH = hc ? k.x : 0.0;
  vec3 cH = hc ? s.rgb : vec3(0.0); vec2 nH = hc ? k.zw : vec2(0.0); vec4 sO = vec4(0.0), kO = vec4(0.0);
  if (hc) { float a0 = s.a - 1.0, ix = floor(a0 + 0.001); sh = ix; hi = step(0.495, a0 - ix); zH = k.y; }
  for (int i = 0; i < 40; i++) { vec2 t = tap(i, 40), o = t * uR; vec4 q = S(p + o), kq = K(p + o); float w = exp(-2.0 * dot(t, t)); wT += w;
    if (isH(kq)) { wH += w; cH += w * q.rgb; nH += w * kq.zw; float a0 = q.a - 1.0, ix = floor(a0 + 0.001); sh += w * ix; hi += w * step(0.495, a0 - ix); zH = min(zH, kq.y); idH = kq.x; }
    else if (kq.x > 0.5) { wO += w; if (w > bO) { bO = w; sO = q; kO = kq; } } else wB += w; }
  bool inH = wH > 0.5 * wT;
  vec4 rs = s, rk = k;
  if (inH) { float fr = hc ? s.a - 1.0 - floor(s.a - 1.0 + 0.001) : 0.0, bd = hc ? fr - 0.5 * step(0.495, fr) : 0.0;
    rs = vec4(cH / wH, 1.0 + floor(sh / wH + 0.5) + 0.5 * step(0.5, hi / wH) + bd); if (!hc) rk = vec4(idH, zH, nH / wH); }
  else if (!inH && hc) { if (wO > wB) { rs = sO; rk = kO; } else { rs = vec4(0.0); rk = vec4(0.0); } }
  oC = uOut < 0.5 ? rs : rk;
}`;
// STYLE c5: the supersampled composite averaged down (ss x ss texels a pixel): the fills' edges, the shadow shapes and the key line
// anti-aliased, so a line moving by a fraction of a pixel changes by a fraction, not by a whole pixel (the crawl)
const DS_FS = /* glsl */`
precision highp float; uniform sampler2D tC; uniform float uSS; layout(location = 0) out vec4 oC;
void main(){ int n = int(uSS + 0.5); ivec2 p = ivec2(gl_FragCoord.xy) * n; vec4 a = vec4(0.0);
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) { if (x >= n || y >= n) continue; a += texelFetch(tC, p + ivec2(x, y), 0); }
  oC = vec4(a.rgb / float(n * n), 1.0); }`;
// THE PRINT'S INK ON ITS PAPER (the four-ink print only: medium.wear; STYLE c6 rev 7e.2), a pass over the composite's FLAT inks (before the
// average down), fixed to the sheet (it does not ride the figure): the paper's TOOTH, its fibres ~0.6-1.3 px at 1080 (two octaves of value
// noise), lifts and sinks the paper's value by uW.x; an ink sits on the tooth's peaks, so its film thins over the valleys (uW.y: a fine
// grain of paper in every ink) and the deepest valleys stay bare (salt: a speck of paper), most in the OPEN MIDDLE of a shape and least at
// its edge (within uW.w px at 1080 of another ink the film is whole: the roller's ink gathers at the edge of a form), so each shape's edge
// stays clean and its density follows the plate. No cloud: nothing in it is larger than the paper's fibres. uW [tooth, grain, salt, reach]
const WEAR_FS = /* glsl */`
precision highp float; uniform sampler2D tC; uniform vec2 uRes; uniform float uS; uniform vec3 uC2; uniform vec4 uW;
layout(location = 0) out vec4 oC;
${GX_COMMON}
vec3 C(vec2 p){ return texelFetch(tC, clamp(ivec2(p), ivec2(0), ivec2(uRes) - 1), 0).rgb; }
void main(){
  vec2 p = gl_FragCoord.xy, P = p / uS; vec3 c = C(p);
  float t = gxN2(P * 1.7) * 0.6 + gxN2(P * 0.8 + 3.7) * 0.4;                  // the paper's relief here (0 a valley floor, 1 a peak top)
  float ink = clamp(distance(c, uC2) * 8.0, 0.0, 1.0), e = 0.0, R = uW.w * uS;
  for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398 + 0.3927; vec2 o = vec2(cos(a), sin(a)) * R;
    e = max(e, clamp(distance(C(p + o), c) * 6.0, 0.0, 1.0)); e = max(e, clamp(distance(C(p + o * 0.5), c) * 6.0, 0.0, 1.0)); }
  vec3 paper = uC2 * (1.0 - 0.5 * uW.x + uW.x * t);
  float bare = clamp(uW.y * t + smoothstep(0.78, 0.94, t) * uW.z * (0.25 + 0.75 * (1.0 - e)), 0.0, 1.0);
  vec3 o = c + (paper - uC2) * (1.0 - ink);                                // the bare sheet takes the tooth
  oC = vec4(mix(o, paper, bare * ink), 1.0);                               // the ink's film thin over the valleys, bare in the deepest
}`;
// THE PRINT'S PLANES CUT (the four-ink print only: medium.x1 on the flat kind; no pass for any other look). The plane is computed ONCE per
// pixel (PLANE_FS: the smooth normal over the same OWNER garment, rev 7a's key AOV group, so a pocket, a placket, a cuff and the stitches
// join their garment's plane; the hair one surface) and then CUT as a printer cuts a stencil for a plate (CUT_FS: the majority of the
// disc of radius x2[1] on the same surface: a sliver or a streak narrower than ~0.8 of the radius goes, a corner is rounded, the edge is
// one decision a shape), so the composite takes a hard, one-pixel edge from it. Skin keeps flat2's shadow (the faces' two tones scored well)
// PLANE_FS out: x the plane's light (N.key), y the surface code, z the depth, w 1 + the share of the 7 cm disc on this surface (> 0: a figure),
// + 2 on the hair's LIT CRESCENT: a hair pixel from which a step toward the key (on the screen, up to uCw px) leaves the mass for the ground
// or for a surface behind it (not for a face in front of it): the band along the mass's outline on the key's side, as wide as uCw where the
// outline faces the key and thinning to nothing as it turns away (the region between the outline and itself moved toward the light), on the
// side the averaged hair normal turns to the key
const PLANE_FS = /* glsl */`
precision highp float; uniform sampler2D tK; uniform vec2 uRes; uniform vec3 uKey; uniform float uR, uCw;
layout(location = 0) out vec4 oC;
vec4 K(vec2 p){ return texelFetch(tK, clamp(ivec2(p), ivec2(0), ivec2(uRes) - 1), 0); }
vec2 tap(int i, int n){ float r = sqrt((float(i) + 0.5) / float(n)), a = float(i) * 2.39996323; return r * vec2(cos(a), sin(a)); }
// a surface's code: a sewn garment its OWNER (100 + the group: found, boot, bottom, top, outer), other cloth its mesh id, the hair 60,
// the skin and the eyes 1, the rest its id
float code(vec4 k){ float id = floor(k.x + 0.5), g = floor((k.x - id) / 0.04 + 0.5);
  if (id > 50.5 && id < 70.5) return 60.0; if (id > 9.5 && id < 50.5 && g > 0.5 && g < 5.5) return 100.0 + g; return id; }
vec3 N(vec4 k){ return vec3(k.zw, sqrt(max(0.0, 1.0 - dot(k.zw, k.zw)))); }
void main(){
  vec2 p = gl_FragCoord.xy; vec4 k = K(p); oC = vec4(0.0);
  if (k.x < 0.5) return;
  float c = code(k), zc = k.y, wa = 1.0, wh = 1.0; vec3 nn = N(k);
  if (c > 1.5) for (int i = 0; i < 48; i++) { vec2 t = tap(i, 48); vec4 kq = K(p + t * uR); float w = exp(-2.0 * dot(t, t)); wa += w;
    if (kq.x < 0.5 || abs(code(kq) - c) > 0.5 || abs(kq.y - zc) > zc * 0.03) continue;
    nn += w * N(kq); wh += w; }
  float lit = dot(normalize(nn), uKey), cr = 0.0;
  if (c > 59.5 && c < 60.5 && uCw > 0.5 && lit > 0.0) { vec2 kd = normalize(uKey.xy + vec2(1e-4, 0.0));
    for (int j = 1; j <= 4; j++) { vec4 kq = K(p + kd * uCw * float(j) * 0.25);
      if (kq.x < 0.5 || (abs(code(kq) - 60.0) > 0.5 && kq.y > zc * 1.01)) { cr = 1.0; break; } } }
  oC = vec4(lit, c, zc, 1.0 + wh / wa + 2.0 * cr);   // w: 1 + the share of the disc that is this surface (the hair's mass: a brow or a lash is thin), + 2 the crescent
}`;
// CUT_FS (uC: the cut's radius px, the planes' terminator, -, -) out: x the share of the disc on the light side, y the surface code, z the
// share of the disc in the hair's lit crescent (PLANE_FS's flag), w PLANE_FS's 1 + the surface's share (the flag taken off); skin passes
// through (the composite does not read it)
const CUT_FS = /* glsl */`
precision highp float; uniform sampler2D tP; uniform vec2 uRes; uniform vec4 uC;
layout(location = 0) out vec4 oC;
vec4 P(vec2 p){ return texelFetch(tP, clamp(ivec2(p), ivec2(0), ivec2(uRes) - 1), 0); }
vec2 tap(int i, int n){ float r = sqrt((float(i) + 0.5) / float(n)), a = float(i) * 2.39996323; return r * vec2(cos(a), sin(a)); }
void main(){
  vec2 p = gl_FragCoord.xy; vec4 c0 = P(p); float f0 = step(2.5, c0.w); oC = vec4(c0.xyz, c0.w - 2.0 * f0);
  if (c0.w < 0.5 || c0.y < 1.5) return;
  float n = 1.0, lt = step(uC.y, c0.x), ln = f0;
  for (int i = 0; i < 40; i++) { vec4 q = P(p + tap(i, 40) * uC.x);
    if (q.w < 0.5 || abs(q.y - c0.y) > 0.5 || abs(q.z - c0.z) > c0.z * 0.03) continue;
    n += 1.0; lt += step(uC.y, q.x); ln += step(2.5, q.w); }
  oC = vec4(lt / n, c0.y, ln / n, c0.w - 2.0 * f0);
}`;
// STYLE c6 (rev 7d): a face's disc in world space for the montage's dodge: its centre between the eyes and the mouth (the nose, as the
// hero places them on its head bone: the bind-space eyes and stomion that inkStrokes uses), its radius 1.7 x the eyes-to-mouth distance
// (~12 cm), along the camera's up; a hero without them: the head joint 7 cm up, 12 cm. Reads the hero, never changes it
const _fv = new THREE.Vector3();
function faceDisc(h, camera) {
  try { h.group.updateMatrixWorld(true); camera.updateMatrixWorld(); const up = _fv.setFromMatrixColumn(camera.matrixWorld, 1).normalize().clone();
    let c, r = 0.12;
    if (h.eyeL && h.eyeR && h.mouth && h.head0 && h.idx?.head != null) { const hb = h.bone('head'), h0 = h.head0[h.idx.head], toW = p => p.clone().sub(h0).applyMatrix4(hb.matrixWorld);
      const e = toW(h.eyeL.clone().add(h.eyeR).multiplyScalar(0.5)), m = toW(h.mouth); c = e.clone().add(m).multiplyScalar(0.5); r = Math.min(0.16, Math.max(0.08, 1.7 * e.distanceTo(m))); }
    else { c = h.joint('head'); c.y += 0.07; }
    return { c, top: c.clone().addScaledVector(up, r) }; }
  catch (e) { return null; }
}
// STYLE c5: CONSTRUCTIVIST PHOTOMONTAGE (Klutsis, Rodchenko, Heartfield) and the RETOUCHED PRESS PHOTOGRAPH, from the LIT render of
// our people (as the newsreel) and the key AOV's mask (our people only, the stage left out):
//   uMode 0  montage: a printed sheet (cream), a red diagonal band through the figure's chest, a black bar, a red block at the foot for
//            type; the person CUT OUT (a white paper margin round the mask, the cut a little irregular), lifted off the sheet (a shadow),
//            printed as a coarse black halftone of an orthochromatic, contrasty photograph; uM2.x > 0: a red duotone in the shadows
//   uMode 1  press photograph: the background airbrushed out (a soft grey ground, a halo round the figure, the floor's shadow kept
//            under the feet), the whole printed as a 45-degree halftone with dot gain on newsprint
const MONT_FS = /* glsl */`
precision highp float; uniform sampler2D tL, tK; uniform vec2 uRes; uniform float uS, uMode; uniform vec3 uC0, uC1, uC2, uC3;
uniform vec4 uM0, uM1, uM2, uN0; uniform vec4 uFeet[16]; uniform float uNFeet; uniform vec2 uChest;
uniform vec4 uM3;   // the montage's print: x 1 a CLEAN printer's screen (each dot one cell's mean tone), 2 gravure
                    // (continuous tone, no screen); y the screen's floor (px: a finer screen, at feed size, fades into tone); z the paper's tooth;
                    // w (rev 7d) the floor of the skin-and-hair print's finer screen (px)
uniform vec4 uM4;   // x THE PRINTER'S DODGE, the face's log-mean ortho luma it lifts the skin to (0 off);
                    // y the dodge's largest gain; z its share on the figure's other skin (neck, arms, hands: 1 = the face's gain); w THE
                    // SKIN-AND-HAIR PRINT: its screen's cell as a share of the body's (an AM screen, the dot following the smoothed tone; 0 off)
uniform vec4 uHd[16]; uniform float uNHd;   // rev 7d: each face's centre (px, y up) and radius (px, ~12 cm), as the hero's own eyes and mouth place it
layout(location = 0) out vec4 oC;
${GX_COMMON}
float gD = 1.0;   // rev 7d: the dodge's gain at this pixel, on the SKIN samples of the photograph only (1: none)
float Kx(vec2 q){ return texelFetch(tK, clamp(ivec2(q), ivec2(0), ivec2(uRes) - 1), 0).x; }
bool skinAt(vec2 q){ float x = Kx(q); return x > 0.5 && x < 1.5; }   // the key AOV's id 1: body and eyes
float Y0(vec2 q){ vec3 c = gxLin(texture(tL, clamp(q / uRes, vec2(0.0), vec2(1.0))).rgb); return dot(c, uN0.xyz); }
float Y(vec2 q){ float y = Y0(q); return gD > 1.0 && skinAt(q) ? y * gD : y; }
float Mk(vec2 q){ return texelFetch(tK, clamp(ivec2(q), ivec2(0), ivec2(uRes) - 1), 0).x > 0.5 ? 1.0 : 0.0; }
vec2 tap(int i, int n){ float r = sqrt((float(i) + 0.5) / float(n)), a = float(i) * 2.39996323; return r * vec2(cos(a), sin(a)); }
// STYLE c6 (rev 7d): THE PRINTER'S DODGE. A printer exposes the print for the face: each face's log-mean ortho luma (40 taps within 0.7 of its
// disc, skin only: forehead, cheeks, eyes, chin) lifted to uM4.x, the gain never below 1 (a light face is untouched) and at most uM4.y;
// applied to that figure's skin (the face, and at uM4.z the neck, arms and hands: each skin pixel to the nearest face, the distance
// below a face counted a quarter, so a figure's hands go to its own face, not a neighbour's), never to its cloth or hair. Deep skin in
// dark clothes keeps its eyes, brows and mouth (the screen and the gravure had printed them as one black mass); nothing else moves
float headGain(int i){ vec4 h = uHd[i]; float s = 0.0, n = 0.0;
  for (int j = 0; j < 40; j++) { vec2 q = h.xy + tap(j, 40) * h.z * 0.7; if (skinAt(q)) { s += log(max(Y0(q), 1e-4)); n += 1.0; } }
  return n < 8.0 ? 1.0 : clamp(uM4.x / exp(s / n), 1.0, uM4.y); }
float dodgeAt(vec2 p, out float dH){ int hi = -1; float eB = 1e9; dH = 1e9;
  for (int i = 0; i < 16; i++) { if (float(i) >= uNHd) break; vec4 h = uHd[i]; vec2 d = (p - h.xy) / max(h.z, 1.0);
    float e = length(vec2(d.x, d.y < 0.0 ? d.y * 0.25 : d.y)); if (e < eB) { eB = e; hi = i; dH = length(d); } }
  if (hi < 0 || uM4.x <= 0.0) return 1.0;
  float w = max(1.0 - smoothstep(1.4, 1.9, dH), uM4.z * (1.0 - smoothstep(4.0, 5.0, eB)));
  return w > 0.0 ? pow(headGain(hi), w) : 1.0; }
float dil(vec2 p, float R){ float m = Mk(p); for (int i = 0; i < 32; i++) { m = max(m, Mk(p + tap(i, 32) * R)); } return m; }
float feet(vec2 p){ float s = 0.0; for (int i = 0; i < 16; i++) { if (float(i) >= uNFeet) break; vec4 f = uFeet[i]; vec2 q = (p - f.xy) / f.zw; s = max(s, 1.0 - smoothstep(0.4, 1.0, length(q))); } return s; }
float halftone(vec2 p, float cell, float ang, float k){ float c = cos(ang), s = sin(ang); vec2 h = mat2(c, -s, s, c) * p / cell;
  float spot = 0.5 - 0.25 * (cos(6.2831853 * h.x) + cos(6.2831853 * h.y)), aa = max(fwidth(spot), 1e-3); return 1.0 - smoothstep(k - aa, k + aa, spot); }
// rev 7d: c5's halftone with the edge's anti-aliasing from the spot's own gradient (no fwidth: it runs inside a per-pixel branch)
float halftoneA(vec2 p, float cell, float ang, float k){ float c = cos(ang), s = sin(ang); vec2 h = mat2(c, -s, s, c) * p / cell, t = 6.2831853 * h;
  float spot = 0.5 - 0.25 * (cos(t.x) + cos(t.y)), aa = max(1.5707963 / cell * length(sin(t)), 1e-3); return 1.0 - smoothstep(k - aa, k + aa, spot); }
float tone(vec2 p){ float y = Y(p) * 0.5 + (Y(p + vec2(1.0, 0.0)) + Y(p - vec2(1.0, 0.0)) + Y(p + vec2(0.0, 1.0)) + Y(p - vec2(0.0, 1.0))) * 0.125;
  float v = clamp(pow(y / (y + uN0.w), uM1.w), 0.0, 1.0); return clamp((v - 0.5) * (1.0 + uM2.w) + 0.5, 0.0, 1.0); }   // uM2.w: contrast
// the CLEAN screen. A printer's halftone: every dot sits at its cell's centre and its size is the MEAN tone of that cell
// (a ring of taps round the centre), so the photograph's speckle (skin pores, the knit, a texel's edge) no longer modulates the dots:
// a regular screen of round dots that grow into a checkerboard and then into solid; the four cells round p, the dots' union; a centre
// outside the cut-out takes p's own tone (the dots at the cut stay the figure's). k = (a - v) x b
float cellTone(vec2 q, float r){ float v = tone(q); for (int i = 0; i < 6; i++) { float a = float(i) * 1.0472 + 0.5236; v += tone(q + vec2(cos(a), sin(a)) * r); } return v / 7.0; }
float screenClean(vec2 p, vec2 ph, float cell, float ang, float a, float b){
  float cs = cos(ang), sn = sin(ang); mat2 Rm = mat2(cs, -sn, sn, cs), Ri = transpose(Rm);
  vec2 h = Rm * ph / cell, b0 = floor(h - 0.5) + 0.5; float cov = 0.0, aa = 0.75 / cell, v0 = tone(p);
  vec2 D[4] = vec2[4](vec2(0.0), vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(1.0));
  for (int j = 0; j < 4; j++) { vec2 ctr = b0 + D[j], pc = p - ph + Ri * (ctr * cell);
    float v = Mk(pc) > 0.5 ? cellTone(pc, cell * 0.32) : v0, k = clamp((a - v) * b, 0.0, 1.0);
    float r = k < 0.012 ? 0.0 : k < 0.785 ? sqrt(k / 3.14159) : mix(0.5, 0.7072, (k - 0.785) / 0.215);
    cov = max(cov, 1.0 - smoothstep(r - aa, r + aa, length(h - ctr))); }
  return cov; }
void main(){
  vec2 p = gl_FragCoord.xy, P = p / uS; float m = Mk(p), tooth = gxN2(P * 0.8) * 0.5 + gxN2(P * 0.21) * 0.5;
  if (uM3.x > 0.5) tooth = 0.5 + (gxN2(P * 0.21) * 0.5 + gxN2(P * 0.05) * 0.5 - 0.5) * uM3.z;   // STYLE c6: the sheet's tooth broad and quiet, no pixel speckle
  vec3 c;
  if (uMode < 0.5) {
    vec3 sheet = uC2 * (0.965 + 0.05 * tooth);
    // the layout: a red band through the chest (angle uM1.x), a black bar beside it, a red block at the foot
    vec2 d = p - uChest; float ca = cos(uM1.x), sa = sin(uM1.x), across = -sa * d.x + ca * d.y;
    c = sheet;
    if (abs(across) < uM1.y * uRes.y) c = uC1 * (0.95 + 0.05 * tooth);
    if (across > uM1.y * uRes.y * 1.25 && across < uM1.y * uRes.y * 1.55) c = uC0;
    if (p.y < uM1.z * uRes.y) c = uC1 * (0.94 + 0.05 * tooth);
    // the cut-out: margin (dilated mask, its radius wobbling a little along the cut), its shadow (offset), then the halftoned photograph
    float R = uM0.x * uS * (0.8 + 0.4 * gxN2(P * 0.03));
    float mar = dil(p, R), shd = dil(p + vec2(-1.0, 1.0) * uM0.y * uS, R);
    c = mix(c, c * 0.55, shd * (1.0 - mar) * 0.8);
    if (mar > 0.5) {
      c = uC3 * (0.975 + 0.03 * tooth);
      vec2 ph = uM0.w > 0.5 ? p - uChest : p;   // STYLE c5: the screen rides the cut-out (anchored at its chest), not the frame
      if (m > 0.5) {
        // the clean screen (uM3.x 1) faded into continuous tone where its cell falls under the floor (uM3.y px: at
        // feed size a printed screen is below the eye), or gravure (uM3.x 2: continuous tone, the mean of a small disc)
        float dH = 1e9; if (uNHd > 0.5 && uM4.x > 0.0) gD = dodgeAt(p, dH);   // rev 7d: the printer's dodge (every tone() below reads it)
        float cell = uM0.z * uS, vt = cellTone(p, max(0.8, cell * 0.25)), wS = uM3.x < 1.5 ? smoothstep(uM3.y * 0.6, uM3.y, cell) : 0.0;
        // rev 7d: THE SKIN-AND-HAIR PRINT. The face, the hands and the hair printed through a finer AM screen (each dot's edge follows the
        // smoothed tone inside its cell, as a process camera's screen does), cell x uM4.w but never under uM3.w px nor over the body's: a
        // feature smaller than the body's 6 px cell (an eye, a brow, the mouth) still bites the dots; the cloth keeps the clean screen. The
        // ruling changes only where skin or hair meets cloth (a cut the figure already has: Klutsis's heads pasted in from other prints);
        // where the body's screen fades into tone (feed size) so does this one
        float kx = Kx(p); bool fine = uM4.w > 0.0 && wS > 0.0 && ((kx > 0.5 && kx < 1.5) || (kx > 50.5 && kx < 69.5));
        float hc = clamp(cell * uM4.w, min(cell, uM3.w), cell), kv = clamp((1.0 - vt) * 1.04, 0.0, 1.0);
        float dot0 = mix(kv, wS > 0.0 ? (fine ? halftoneA(ph, hc, 0.7854, kv) : screenClean(p, ph, cell, 0.7854, 1.0, 1.04)) : 0.0, wS);
        vec3 photo = mix(uC3 * (0.975 + 0.03 * tooth), uC0, dot0 * 0.95);
        c = photo; }
    }
  } else {
    // the press photograph, retouched: the figure as photographed; the ground airbrushed to a soft grey with a halo, the shadow under the feet kept
    float v = tone(p), halo = dil(p, uM0.x * uS * 3.0) - m;
    vec2 uv = p / uRes - 0.5; float bgv = uM2.y + 0.06 * uv.y - 0.05 * dot(uv, uv) + 0.04 * halo;
    float keep = max(m, feet(p) * uM2.z);
    v = mix(bgv, v, keep);
    float k = clamp(1.0 - v, 0.0, 1.0) * 1.05; float dt = halftone(p, uM0.z * uS, 0.7854, k);
    vec3 news = uC2 * (0.95 + 0.06 * tooth);
    c = mix(news, uC0, dt * 0.9);
  }
  oC = vec4(c, 1.0);
}`;
const mkRT = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
export class GraphicStage extends DrawStage {
  constructor(o = {}) { super(o); this.feedFaces = o.feedFaces ?? true; this.gstats = {}; }
  // render only the patched heroes (everything without our patch hidden), display-referred, into rt
  _gxPass(scene, camera, mode, rt, { hairMass = 1 } = {}) {
    const r = this.r, hid = [], hair = [];
    if (hairMass !== 1) scene.traverse(o => { if (!o.visible || !o.isMesh) return; for (const m of [].concat(o.material)) { const U = m?.userData?.hairU; if (U?.hMisc && !hair.includes(U)) { hair.push(U); U._gx0 = U.hMisc.value.x; U.hMisc.value.x *= hairMass; } } }); scene.traverse(o => { if (!o.visible || !(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return; const ok = [].concat(o.material).every(m => m && m.userData && m.userData.graphic); if (!ok) { o.visible = false; hid.push(o); } });
    const bg = scene.background, fog = scene.fog, tm = r.toneMapping, sm = r.shadowMap.autoUpdate; scene.background = null; scene.fog = null; r.toneMapping = THREE.NoToneMapping; r.shadowMap.autoUpdate = false;
    try { GX_U.gxMode.value = mode; r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(scene, camera); }
    finally { GX_U.gxMode.value = 0; for (const o of hid) o.visible = true; for (const U of hair) U.hMisc.value.x = U._gx0; scene.background = bg; scene.fog = fog; r.toneMapping = tm; r.shadowMap.autoUpdate = sm; r.setRenderTarget(null); }
  }
  _quad(fs, uniforms) { const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false }); const q = new THREE.Mesh(FS_TRI, m); q.frustumCulled = false; const s = new THREE.Scene(); s.add(q); return { m, s }; }
  _ensure(W = this.W, H = this.H) {
    if (!this._rtS || this._rtS.width !== W || this._rtS.height !== H) { for (const t of [this._rtS, this._rtK, this._rtE, this._rtS2, this._rtK2, this._rtC, this._rtP, this._rtP2, this._rtW]) t?.dispose(); this._rtS = mkRT(W, H); this._rtK = mkRT(W, H); this._rtE = mkRT(W, H); this._rtS2 = this._rtK2 = this._rtC = this._rtP = this._rtP2 = this._rtW = null; }
    this._cam ||= new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._edge ||= this._quad(EDGE_FS, { tK: { value: null }, uKey: { value: new THREE.Vector3() }, uLine: { value: new THREE.Vector4() }, uLine2: { value: new THREE.Vector4() }, uRes: { value: new THREE.Vector2() } });
    this._comp ||= this._quad(COMP_FS, { tS: { value: null }, tE: { value: null }, tK: { value: null }, uRes: { value: new THREE.Vector2() }, uKind: { value: 1 }, uRmax: { value: 3 }, uS: { value: 1 },
      uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uC3: { value: new THREE.Color() }, uLineC: { value: new THREE.Color() }, uBg: { value: new THREE.Color() }, uBg2: { value: new THREE.Color() },
      uK0: { value: new THREE.Vector4() }, uK1: { value: new THREE.Vector4() }, uK2: { value: new THREE.Vector4() }, uFeet: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }, uNFeet: { value: 0 }, uBand: { value: new THREE.Vector4() }, uKey: { value: new THREE.Vector3() },
      uL2: { value: new THREE.Vector4() }, uP1: { value: new THREE.Vector4() }, uHairHi: { value: new THREE.Vector4() }, uX0: { value: new THREE.Vector4() }, uX1: { value: new THREE.Vector4() },
      tP: { value: null }, uX2: { value: new THREE.Vector4() } });   // the four-ink print
    this._hairQ ||= this._quad(HAIR_FS, { tS: { value: null }, tK: { value: null }, uRes: { value: new THREE.Vector2() }, uR: { value: 0 }, uOut: { value: 0 } });
    this._ds ||= this._quad(DS_FS, { tC: { value: null }, uSS: { value: 1 } });
    this._planeQ ||= this._quad(PLANE_FS, { tK: { value: null }, uRes: { value: new THREE.Vector2() }, uKey: { value: new THREE.Vector3() }, uR: { value: 1 }, uCw: { value: 0 } });   // the four-ink print's plane and cut
    this._wearQ ||= this._quad(WEAR_FS, { tC: { value: null }, uRes: { value: new THREE.Vector2() }, uS: { value: 1 }, uC2: { value: new THREE.Color() }, uW: { value: new THREE.Vector4() } });   // its ink on the paper
    this._cutQ ||= this._quad(CUT_FS, { tP: { value: null }, uRes: { value: new THREE.Vector2() }, uC: { value: new THREE.Vector4() } });
  }
  // STYLE c2's drawn media with the key line on the GPU (the opt-in port of their cost: line.js is a JS loop over a float AOV,
  // ~1.5 s a 1080 x 1920 frame on the farm): the same edge rules (contour heavier on the side turned from the key, hems, creases),
  // drawn over the drawn pass. Landmark lines (lane E's anchors) are not drawn here.
  async _linesOver(ctx, R, o) {
    const { scene, camera } = o, hs = o.heroes || [o.hero], W = this.W, H = this.H, r = this.r, L = R.line || {}, M = R.medium || {};
    const A = this._A ||= await loadDrawAnatomy().catch(() => null); hs.forEach((h, i) => installGraphic(h, A, (o.people || [])[i])); this._ensure();
    const ppm = o.ppm || this.ppmOf(hs, camera), k = Math.min(3, Math.max(0.2, ppm / 540)), wpx = (L.weight ?? 2) * Math.min(2.5, Math.max(0.4, k)) ** 0.6;
    const key = (await import('../draw/glsl.js')).DRAW_U.drKey.value.clone().normalize();
    this._gxPass(scene, camera, 2, this._rtK, { hairMass: 3.5 });
    const eu = this._edge.m.uniforms; eu.tK.value = this._rtK.texture; eu.uKey.value.copy(L.uniform ? new THREE.Vector3(0, 0, 1) : key); eu.uLine.value.set(wpx, L.hem ?? 0.6, L.crease ?? 0.5, 0); eu.uRes.value.set(W, H);
    r.setRenderTarget(this._rtE); r.setClearColor(0x000000, 0); r.clear(); r.render(this._edge.s, this._cam);
    const cu = this._comp.m.uniforms; cu.tS.value = this._rtS.texture; cu.tE.value = this._rtE.texture; cu.uRes.value.set(W, H); cu.uKind.value = 0; cu.uRmax.value = Math.min(8, Math.ceil(wpx * 0.6 + 1));
    raw(L.ink || M.lineInk || M.ink || '#15110f', cu.uLineC.value);
    r.setRenderTarget(null); r.setClearColor(0x000000, 0); r.clear(); r.render(this._comp.s, this._cam);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.glc, 0, 0); ctx.restore();
  }
  // px per metre at the heroes (mean of their heads), as DrawStage measures it
  ppmOf(hs, camera) { return hs.reduce((a, h) => { const p = h.joint('head'), q = p.clone(); q.y -= 1; const A = p.project(camera), B = q.project(camera); return a + Math.abs(A.y - B.y) * 0.5 * this.H; }, 0) / hs.length; }
  // the newsreel (and the press photograph): the lit render through NEWS_FS. o.lens, o.renderOpts (a STAGE's K / AO / contact), o.frame
  async _newsreel(ctx, R, o) {
    const M = R.medium || {}, W = this.W, H = this.H, r = this.r, t0 = performance.now();
    this.lr.render({ scene: o.scene, camera: o.camera, rig: o.rig, t: o.t ?? 0, lens: { ...(o.lens || {}), grain: 0, vignette: 0, bloom: 0, halation: 0 }, ...(o.renderOpts || {}) }); this.lr.sync?.();
    const lg = this.lit.getContext('2d'); lg.drawImage(this.glc, 0, 0);
    this._newsTex ||= new THREE.CanvasTexture(this.lit); this._newsTex.needsUpdate = true; this._newsTex.colorSpace = THREE.NoColorSpace; this._newsTex.flipY = true;
    this._cam ||= new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._news ||= this._quad(NEWS_FS, { tL: { value: null }, uRes: { value: new THREE.Vector2() }, uF: { value: 0 }, uS: { value: 1 }, uN0: { value: new THREE.Vector4() }, uN1: { value: new THREE.Vector4() }, uN2: { value: new THREE.Vector4() }, uTint: { value: new THREE.Vector3(1, 1, 1) } });
    const u = this._news.m.uniforms; u.tL.value = this._newsTex; u.uRes.value.set(W, H); u.uF.value = o.frame ?? Math.round((o.t ?? 0) * 24); u.uS.value = H / 1080;
    u.uN0.value.set(...(M.ortho || [0.08, 0.62, 0.3, 1.25])); u.uN1.value.set(...(M.film || [0.8, 0.5, 0.06, 0.07])); u.uN2.value.set(...(M.print || [0.32, 0, 0.6, 0])); u.uTint.value.set(...(M.tint || [1, 0.985, 0.95]));
    r.setRenderTarget(null); r.setClearColor(0x000000, 1); r.clear(); r.render(this._news.s, this._cam);
    if (o.sync) { const gl = r.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.glc, 0, 0); ctx.restore();
    this.stats.total = Math.round(performance.now() - t0); return { ms: this.stats.total };
  }
  // STYLE c5: the photomontage and the retouched press photograph (MONT_FS): the key AOV (our people), then the lit render, then one pass
  async _montage(ctx, R, o) {
    const M = R.medium || {}, W = this.W, H = this.H, r = this.r, t0 = performance.now(), hs = o.heroes || [o.hero], { scene, camera } = o;
    const A = this._A ||= await loadDrawAnatomy().catch(() => null);
    hs.forEach((h, i) => { const s1 = this.prepare(h, o.extras || []); setSurface(s1, { surface: 'skin', fade: 1 }); installGraphic(h, A, (o.people || [])[i]); });
    this._ensure();
    // STYLE c6 (rev 7): the layer resolve in the cut-out's mask AND in the lit photograph (the same vertex rule: inert at rest)
    const LY = M.layers; GX_U.gxLayer.value.set(LY ? LY[0] : 0, LY ? (LY[1] ?? 0) : 0, 0, 0);
    try {
    this._gxPass(scene, camera, 2, this._rtK, { hairMass: M.hairMass ?? 3 });
    let tK = this._rtK.texture;
    if (M.hairR) { const ppm = o.ppm || this.ppmOf(hs, camera); this._rtK2 ||= mkRT(W, H); const hu = this._hairQ.m.uniforms; hu.tS.value = tK; hu.tK.value = tK; hu.uRes.value.set(W, H);   // the cut follows the designed hair mass, not the cards' tips
      hu.uR.value = Math.min(18, Math.max(1.2, M.hairR * ppm)); hu.uOut.value = 1; r.setRenderTarget(this._rtK2); r.setClearColor(0x000000, 0); r.clear(); r.render(this._hairQ.s, this._cam); r.setRenderTarget(null); tK = this._rtK2.texture; }
    for (const h of hs) if (h.styleSurface) setSurface(h.styleSurface, { surface: 'skin', fade: 0 });
    this.lr.render({ scene, camera, rig: o.rig, t: o.t ?? 0, lens: { ...(o.lens || {}), grain: 0, vignette: 0, bloom: 0, halation: 0 }, ...(o.renderOpts || {}) }); this.lr.sync?.();
    this.lit.getContext('2d').drawImage(this.glc, 0, 0);
    this._montTK = tK; } finally { GX_U.gxLayer.value.set(0, 0, 0, 0); }
    const tK = this._montTK;
    this._newsTex ||= new THREE.CanvasTexture(this.lit); this._newsTex.needsUpdate = true; this._newsTex.colorSpace = THREE.NoColorSpace; this._newsTex.flipY = true;
    this._cam ||= new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._mont ||= this._quad(MONT_FS, { tL: { value: null }, tK: { value: null }, uRes: { value: new THREE.Vector2() }, uS: { value: 1 }, uMode: { value: 0 }, uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uC3: { value: new THREE.Color() },
      uM0: { value: new THREE.Vector4() }, uM1: { value: new THREE.Vector4() }, uM2: { value: new THREE.Vector4() }, uM3: { value: new THREE.Vector4() }, uN0: { value: new THREE.Vector4() }, uFeet: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }, uNFeet: { value: 0 }, uChest: { value: new THREE.Vector2() },
      uM4: { value: new THREE.Vector4() }, uHd: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }, uNHd: { value: 0 } });   // rev 7d: the dodge and the skin-and-hair print
    const tL = this._newsTex;
    const u = this._mont.m.uniforms, S = H / 1080; u.tL.value = tL; u.tK.value = tK; u.uRes.value.set(W, H); u.uS.value = S; u.uMode.value = M.mode ?? 0;
    for (const [k, c, d] of [['uC0', M.c0, '#151312'], ['uC1', M.c1, '#c4261d'], ['uC2', M.c2, '#ece3cf'], ['uC3', M.c3, '#f7f4ec']]) raw(c || d, u[k].value);
    u.uM0.value.set(...(M.m0 || [9, 7, 4.2, 0])); u.uM1.value.set(...(M.m1 || [0.38, 0.11, 0.12, 0.85])); u.uM2.value.set(...(M.m2 || [0, 0.86, 1, 0])); u.uN0.value.set(...(M.ortho || [0.2, 0.6, 0.2, 0.2])); u.uM3.value.set(...(M.m3 || [0, 0, 0, 0]));   // STYLE c6: m3 the clean screen / gravure (rev 7b)
    const pj = p => { const v = p.clone().project(camera); return [(v.x * 0.5 + 0.5) * W, (v.y * 0.5 + 0.5) * H]; };
    const ch = hs.map(h => pj(h.joint('spine03'))).reduce((a, b) => [a[0] + b[0] / hs.length, a[1] + b[1] / hs.length], [0, 0]); u.uChest.value.set(...ch);
    hs.forEach((h, i) => { if (i >= 16) return; const f = h.joint('foot.L').add(h.joint('foot.R')).multiplyScalar(0.5); f.y = 0; const c = pj(f), a = pj(f.clone().add(new THREE.Vector3(0.4, 0, 0))), d = pj(f.clone().add(new THREE.Vector3(0, 0, 0.3)));
      u.uFeet.value[i].set(c[0], c[1], Math.max(4 * S, Math.abs(a[0] - c[0])), Math.max(3 * S, Math.abs(d[1] - c[1]) * 1.5 + 3 * S)); });
    u.uNFeet.value = Math.min(16, hs.length);
    // STYLE c6 (rev 7d): m4 [dodge target, largest gain, share on the other skin, skin-and-hair screen x the body's]: each face's centre and
    // radius for MONT_FS (absent: uM4 0, no face placed)
    u.uM4.value.set(...(M.m4 || [0, 0, 0, 0])); u.uNHd.value = 0;
    if (M.m4) { let n = 0; for (const h of hs) { if (n >= 16) break; const f = faceDisc(h, camera); if (!f) continue; const a = pj(f.c), b = pj(f.top);
      u.uHd.value[n++].set(a[0], a[1], Math.max(2, Math.hypot(b[0] - a[0], b[1] - a[1])), 0); } u.uNHd.value = n; }
    r.setRenderTarget(null); r.setClearColor(0x000000, 1); r.clear(); r.render(this._mont.s, this._cam);
    if (o.sync) { const gl = r.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.glc, 0, 0); ctx.restore();
    this.stats.total = Math.round(performance.now() - t0); return { ms: this.stats.total };
  }
  async render(ctx, recipe, o) {
    const R = this.recipe(recipe), M = R.medium || {}, feed = o.feedFaces ?? this.feedFaces;
    if (M.kind === 'newsreel') return this._newsreel(ctx, R, o);
    if (M.kind === 'montage') return this._montage(ctx, R, o);
    if (M.kind !== 'graphic') {
      const gpu = M.kind === 'draw' && R.line && (o.gpuLines ?? R.gpuLines ?? this.gpuLines);
      const r = await super.render(ctx, gpu ? { ...R, line: null } : R, o);
      if (gpu) { const t1 = performance.now(); await this._linesOver(ctx, R, o); r.lines = Math.round(performance.now() - t1); r.gpuLines = true; }
      if (feed || gpu) { const hs = o.heroes || [o.hero]; faceMarks(ctx, hs, o.camera, { color: (R.line && R.line.ink) || M.lineInk || M.ink || '#17130f', feedOnly: !gpu, k: (R.line && R.line.faceK) ?? 0.8 }); }
      return r; }
    const { scene, camera } = o, hs = o.heroes || [o.hero], W = this.W, H = this.H, t0 = performance.now(), U = GX_U, r = this.r;
    const A = this._A ||= await loadDrawAnatomy().catch(e => { console.warn('graphic: no lane A anatomy', e); return null; });
    hs.forEach((h, i) => { const s1 = this.prepare(h, o.extras || []); setSurface(s1, { surface: 'skin', fade: 1 }); installGraphic(h, A, (o.people || [])[i]); });
    // STYLE c5: ss > 1 (recipe medium.ss or o.ss): every pass at ss x the size, the composite averaged down (ss 1: exactly as before)
    const ss = Math.max(1, Math.min(3, Math.round(o.ss ?? M.ss ?? 1))), Wi = W * ss, Hi = H * ss;
    this._ensure(Wi, Hi);
    // the medium's uniforms
    const ppm = o.ppm || this.ppmOf(hs, camera), k = Math.min(3, Math.max(0.2, ppm / 540)), S = H / 1080;
    U.gxKind.value = KIND[M.gx] ?? 1;
    for (const [key, u, d] of [['tone', 'gxTone', [0, 0.08, 0.2, 0.25]], ['local', 'gxLocal', [0.24, 0.62, 0.9, 0.7]], ['face', 'gxFace', [0.3, 0.25, 0.35, 0]], ['p1', 'gxP1', [0.15, 0.85, 0.5, 0]], ['p2', 'gxP2', [0, 0, 0, 0]]]) { const v = M[key] || d; U[u].value.set(v[0], v[1], v[2], v[3] ?? d[3]); }
    const sp = (M.spacing ?? 7) * Math.sqrt(k);   // px at a 1080-tall full figure (k = 1), growing as sqrt of the figure (more lines in a close-up)
    U.gxCell.value.set(sp * ss, ppm * ss, M.wobble ?? 0.0015, M.stroke ?? 0.05); if (M.gx === 'riso') U.gxP1.value.z *= S * ss;
    raw(M.c0 || '#141110', U.gxC0.value); raw(M.c1 || '#c81e1e', U.gxC1.value); raw(M.c2 || '#efe6d2', U.gxC2.value); raw(M.c3 || '#2a4b7c', U.gxC3.value);
    U.gxRes.value.set(Wi, Hi); U.gxScreen.value = o.screen || R.screen ? 1 : 0;
    const key = new THREE.Vector3(...((R.surface && R.surface.key) || [-0.6, 0.55, 0.5])).normalize(); U.gxKey.value.copy(key);
    const L = R.line || {}, wpx = (L.weight ?? 2) * Math.min(2.5, Math.max(0.35, k)) ** 0.6;   // as DrawStage: px at a 1080-tall full figure
    // STYLE c5: flat2 [shadow smoothing m, fold half-width x the line, fold weight on cloth], hair5 [shadow, highlight, strands, jitter], ex
    const F2 = M.flat2, H5 = M.hair5; U.gxLn.value.set(F2 ? 1 : 0, F2 ? Math.max(0.5, (F2[1] ?? 0.4) * wpx * ss) : 0, M.hairBand ?? 0, F2 ? (F2[2] ?? 0.6) : 0);
    U.gxHair.value.set(...(H5 || [0, 0, 0, 0])); U.gxEx.value.set(...(M.ex || [0, 0, 0, 0]));
    // STYLE c6 (rev 7): the layer resolve [skin m, per rank m] and the owner garment in the key AOV (the notan reads it); reset after the passes
    const NP = M.comp === 'notan' && M.plan ? 1 : 0;   // STYLE c6 it10: the notan's value plan (each person's classes, notanPlan)
    const LY = M.layers; U.gxLayer.value.set(LY ? LY[0] : 0, LY ? (LY[1] ?? 0) : 0, LY || M.comp ? 1 : 0, NP);
    for (const h of hs) { const sf = h._graphic?.surf || []; const pl = NP ? notanPlan(sf, M.x1 || undefined) : null; for (const e of sf) e.u.value = pl ? (pl.shift[e.key] ?? 0) : 0; if (pl) h._graphic.notan = pl; }
    for (const h of hs) { const hd = h._graphic?.head; if (!hd) continue; if (!H5) { hd.value.set(0, 0, 0, 0); continue; } const c = h.joint('head'); c.y += 0.075; c.applyMatrix4(camera.matrixWorldInverse); hd.value.set(c.x, c.y, c.z, 1); }
    // passes: style, key AOV, (STYLE c5: the designed hair mass), edges, composite (STYLE c5: averaged down)
    const t1 = performance.now();
    const hm = { hairMass: M.hairMass ?? 3.5 }; try { this._gxPass(scene, camera, 1, this._rtS, hm); this._gxPass(scene, camera, 2, this._rtK, hm); } finally { U.gxLayer.value.set(0, 0, 0, 0); }
    let tS = this._rtS.texture, tK = this._rtK.texture;
    if (M.hairR) { this._rtS2 ||= mkRT(Wi, Hi); this._rtK2 ||= mkRT(Wi, Hi); const hu = this._hairQ.m.uniforms; hu.tS.value = tS; hu.tK.value = tK; hu.uRes.value.set(Wi, Hi);
      hu.uR.value = Math.min(18 * ss, Math.max(1.2 * ss, M.hairR * ppm * ss));
      for (const [out, rt] of [[0, this._rtS2], [1, this._rtK2]]) { hu.uOut.value = out; r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(this._hairQ.s, this._cam); }
      tS = this._rtS2.texture; tK = this._rtK2.texture; }
    // THE CUT (the four-ink print only: medium.x1 on the flat kind): the planes of cloth and hair computed once (PLANE_FS: the smooth normal
    // over the same owner garment / the hair within x1[1]) and cut (CUT_FS: the majority of the light side, and of the dark hair's lens, over
    // a disc of x2[1]) into tP, which the composite reads at a pixel's two plates; no pass for any other look
    let tP = null; const X2 = !M.comp && M.gx === 'flat' && M.x1 ? (M.x2 || [1, 0.012, 0.025, 5]) : null, rCut = X2 ? Math.max(1, Math.min(48 * ss, (X2[1] ?? 0.012) * ppm * ss)) : 0;
    if (X2) { this._rtP ||= mkRT(Wi, Hi); this._rtP2 ||= mkRT(Wi, Hi);
      const pu = this._planeQ.m.uniforms; pu.tK.value = tK; pu.uRes.value.set(Wi, Hi); pu.uKey.value.copy(key); pu.uR.value = Math.max(1, Math.min(160 * ss, (M.x1[1] ?? 0.07) * ppm * ss));
      pu.uCw.value = Math.max(0, Math.min(160 * ss, (X2[2] ?? 0.025) * ppm * ss));   // the hair's lit crescent: x2[2] m wide where the outline faces the key
      r.setRenderTarget(this._rtP); r.setClearColor(0x000000, 0); r.clear(); r.render(this._planeQ.s, this._cam);
      const ku = this._cutQ.m.uniforms; ku.tP.value = this._rtP.texture; ku.uRes.value.set(Wi, Hi); ku.uC.value.set(rCut, M.x1[2] ?? 0.08, 0, 0);
      r.setRenderTarget(this._rtP2); r.setClearColor(0x000000, 0); r.clear(); r.render(this._cutQ.s, this._cam); r.setRenderTarget(null); tP = this._rtP2.texture; }
    const eu = this._edge.m.uniforms; eu.tK.value = tK; if (L.uniform) eu.uKey.value.set(0, 0, 1); else eu.uKey.value.copy(key); eu.uLine.value.set(L.weight === 0 ? 0 : wpx * ss, L.hem ?? 0.6, L.crease ?? 0.5, L.print ?? 0); eu.uRes.value.set(Wi, Hi); eu.uLine2.value.set(...(L.lock || [0, 0]), 0, 0);   // STYLE c6 rev 7e: line.print (m)
    r.setRenderTarget(this._rtE); r.setClearColor(0x000000, 0); r.clear(); r.render(this._edge.s, this._cam);
    const cu = this._comp.m.uniforms; cu.tS.value = tS; cu.tE.value = this._rtE.texture; cu.tK.value = tK; cu.uRes.value.set(Wi, Hi); cu.uKind.value = M.comp ? KIND[M.comp] : U.gxKind.value;   // STYLE c6: a composite kind of its own over a style pass
    cu.uRmax.value = L.weight === 0 ? 0 : Math.min(8, Math.ceil(wpx * ss * 0.6 + 1)); cu.uS.value = S * ss;
    for (const [u, c, d] of [['uC0', M.c0, '#141110'], ['uC1', M.c1, '#c81e1e'], ['uC2', M.c2, '#efe6d2'], ['uC3', M.c3, '#2a4b7c'], ['uLineC', L.ink || M.lineInk || M.c0, '#141110'], ['uBg', M.bg, '#d9d4c8'], ['uBg2', M.bg2, '#bd1818']]) raw(c || d, cu[u].value);
    for (const [u, key2] of [['uK0', 'k0'], ['uK1', 'k1'], ['uK2', 'k2'], ['uX0', 'x0'], ['uX1', 'x1']]) cu[u].value.set(...(M[key2] || [0, 0, 0, 0]));
    if (M.comp === 'notan') cu.uX1.value.w = Math.max(1.0 * ss, (M.x1?.[3] ?? 0.6) * wpx * ss);   // STYLE c6: the separation's reach (px at this size: never under one output pixel)
    if (M.comp === 'notan') cu.uK1.value.x = NP;   // it10: the style pass carries (luma, the class shift) for the notan to read
    if (M.comp === 'notan') cu.uK1.value.y = NP && M.lit ? 1 : 0;   // it11: the skin's lit plane (reads the plan's channel: its mark in b)
    cu.tP.value = tP || tK; if (X2) cu.uX2.value.set(1, rCut, X2[2] ?? 0.7, Math.max(0, (X2[3] ?? 0) * S * ss)); else cu.uX2.value.set(0, 0, 0, 0);   // tK only as a placeholder: the print alone reads tP
    cu.uL2.value.set(F2 ? 1 : 0, F2 ? Math.min(14 * ss, (F2[0] ?? 0) * ppm * ss) : 0, F2 && F2[3] ? 1 : 0, 0); cu.uP1.value.copy(U.gxP1.value);
    { const hh = M.hairHi || ['#ffffff', 0]; raw(hh[0], this._hhc ||= new THREE.Color()); cu.uHairHi.value.set(this._hhc.r, this._hhc.g, this._hhc.b, hh[1]); }
    cu.uKey.value.copy(key);
    // the feet (GL rows), the ground line, the designed ground's disc centred on the row
    const pj = p => { const v = p.clone().project(camera); return [(v.x * 0.5 + 0.5) * Wi, (v.y * 0.5 + 0.5) * Hi]; };
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize(), sunW = key.clone().transformDirection(camera.matrixWorld), off = new THREE.Vector3(-sunW.x, 0, -sunW.z).multiplyScalar(0.16);
    let gy = 0; hs.forEach((h, i) => { if (i >= 16) return; const f = h.joint('foot.L').add(h.joint('foot.R')).multiplyScalar(0.5); f.y = 0; f.add(off);
      const a = pj(f.clone().addScaledVector(side, -0.32)), b = pj(f.clone().addScaledVector(side, 0.32)), c = pj(f), d = pj(f.clone().add(new THREE.Vector3(0, 0, 0.14)));
      cu.uFeet.value[i].set(c[0], c[1], Math.abs(b[0] - a[0]) / 2, Math.max(3 * S * ss, Math.abs(d[1] - c[1]) * 1.4 + 4 * S * ss)); gy += c[1]; });
    cu.uNFeet.value = Math.min(16, hs.length); gy /= hs.length; cu.uBand.value.set(gy, (M.band ?? 0.01) * Hi, 0, 0);
    if (M.disc && o.ppm && this._discFix && this._discFix.ppm === o.ppm && this._discFix.ss === ss) cu.uK2.value.copy(this._discFix.v);   // a shot (ppm fixed): the disc stays where the first frame put it
    else if (M.disc) { const mid = hs[Math.floor(hs.length / 2)], ch = pj(mid.joint('spine03')), hd = pj(mid.joint('head')), ft = pj(mid.joint('foot.L')); const rr = Math.abs(hd[1] - ft[1]) * (hs.length > 2 ? 0.75 : 0.45) * M.disc;
      const kk = M.k2 || [0, 0, 0, 1]; cu.uK2.value.set(hs.length > 2 ? Wi * 0.5 : ch[0] + rr * 0.15, ch[1] + rr * 0.2, rr, kk[3]); if (o.ppm) this._discFix = { ppm: o.ppm, ss, v: cu.uK2.value.clone() }; }
    // the composite; the print's ink on its paper (WEAR_FS: medium.wear on the print only); the average down (ss > 1)
    const WR = X2 && M.wear ? M.wear : null;
    if (ss === 1 && !WR) { r.setRenderTarget(null); r.setClearColor(0x000000, 1); r.clear(); r.render(this._comp.s, this._cam); }
    else { this._rtC ||= mkRT(Wi, Hi); r.setRenderTarget(this._rtC); r.setClearColor(0x000000, 1); r.clear(); r.render(this._comp.s, this._cam); let tC = this._rtC.texture;
      if (WR) { const wu = this._wearQ.m.uniforms; wu.tC.value = tC; wu.uRes.value.set(Wi, Hi); wu.uS.value = S * ss; raw(M.c2 || '#efe6d2', wu.uC2.value); wu.uW.value.set(WR[0] ?? 0.05, WR[1] ?? 0.06, WR[2] ?? 0.45, WR[3] ?? 2.5);
        if (ss === 1) { r.setRenderTarget(null); r.setClearColor(0x000000, 1); r.clear(); r.render(this._wearQ.s, this._cam); }
        else { this._rtW ||= mkRT(Wi, Hi); r.setRenderTarget(this._rtW); r.setClearColor(0x000000, 1); r.clear(); r.render(this._wearQ.s, this._cam); tC = this._rtW.texture; } }
      if (ss > 1) { const du = this._ds.m.uniforms; du.tC.value = tC; du.uSS.value = ss; r.setRenderTarget(null); r.setClearColor(0x000000, 1); r.clear(); r.render(this._ds.s, this._cam); } }
    if (o.sync) { const gl = r.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }   // wait for the GPU (cost plates)
    this.gstats.gpu = Math.round(performance.now() - t1);
    const g = ctx; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.glc, 0, 0);
    // the faces: hero.js's ink strokes above ~90 px, a designer's marks below (faces.js), in the style's dark colour
    faceMarks(g, hs, camera, { color: M.faceInk || L.ink || M.c0 || '#141110', feedOnly: false, k: L.faceK ?? 0.8, W, H, ...(L.faceNose ? { nose: key.x < 0 ? L.faceNose : -L.faceNose } : {}) });
    g.restore();
    this.stats.total = Math.round(performance.now() - t0); this.stats.figureScale = +k.toFixed(3);
    return { ms: this.stats.total, gpu: this.gstats.gpu, ppm };
  }
}
// STYLE c6: the quad shaders, for the node compile check (labs/human8/style6_test.mjs: glslangValidator; nothing renders)
export const QUAD_SHADERS = { EDGE_FS, COMP_FS, NEWS_FS, HAIR_FS, DS_FS, MONT_FS, PLANE_FS, CUT_FS, WEAR_FS };
