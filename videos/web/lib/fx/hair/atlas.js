// HAIR / atlas: the strand alpha atlas every card samples, generated here (no painted or bought hair textures). Pure JS into a
// typed array, so the same atlas is made in the browser and in node (the card test), and written out as a PNG for review by
// labs/human8/hair_test.mjs --png (assets/hair/atlas.png).
//
// Layout: 2048 x 512, sixteen 128-px tiles side by side; v runs along the hair (row 0 = the root, row 511 = the tip), u across the
// card. A tile is drawn as individual strands, the way a card painter works (Yuksel and Tariq's "Advanced techniques in real-time hair
// rendering and simulation", SIGGRAPH 2010 course, and the card practice of Sintorn and Assarsson and of game hair since): each strand
// a tapered line from a jittered root, its own length (so density falls toward the tip), a low-frequency drift, the tile's form
// (wave, ringlet, coil zig-zag) and a root-to-tip fade. Channels:
//   R  the strand's own random id (the shader greys a fraction of strands by it: salt and pepper, not a tint)
//   G  coverage (alpha; also what three's alphaMap reads, so the shadow-map depth material cuts the same strands)
//   B  across-strand shading (a strand is a cylinder: brighter on its axis), and 0 between strands
// Coverage is composited "over" (a = 1 - (1 - a)(1 - c)), so a mipmap's mean is the true fractional coverage; with the stochastic
// alpha test in shade.js that keeps thin hair from vanishing at distance (the usual alpha-test mip problem).
import * as THREE from 'three';
import { mulberry } from './field.js';

export const AW = 2048, AH = 512, TW = 128;
export const TILE = { straight: 0, sparse: 1, wavy: 2, curly: 3, coily: 4, coilyFuzz: 5, brow: 6, lash: 7, beard: 8, beardLong: 9, plait: 10, loc: 11, fuzz: 12, vellus: 13, dense: 14, net: 15 };
// (HAIR4: the rev-4 atlas's own tiles sit in the brow / lash / beard slots, which the scalp never uses; atlas4Textures below. Kept out of
// TILE, whose entries are the tiles the v1 / v3 atlases draw)
export const TILE4 = { ringlet: 6, coil4: 7, curlySparse: 8, wavySparse: 9 };
// u range of a tile, inset by 2 px (mip bleed between tiles)
export const tileU = (name, a = 0, b = 1) => { const t = TILE[name] ?? TILE4[name] ?? 0, u0 = (t * TW + 2) / AW, u1 = ((t + 1) * TW - 2) / AW; return [u0 + (u1 - u0) * a, u0 + (u1 - u0) * b]; };

// tile recipes: n strands, width at the root (px), length range (fraction of the tile height), form
const RECIPE = {
  straight: { n: 95, w: [1.1, 1.8], len: [0.55, 1.0], start: 0.06, drift: 6, form: 'straight', fade: 0.25 },
  sparse: { n: 34, w: [0.9, 1.4], len: [0.4, 1.0], start: 0.12, drift: 14, form: 'straight', fade: 0.35, stray: 0.25 },
  wavy: { n: 90, w: [1.1, 1.7], len: [0.55, 1.0], start: 0.06, drift: 6, form: 'wave', amp: 7, per: 0.42, fade: 0.25 },
  curly: { n: 80, w: [1.2, 1.9], len: [0.5, 1.0], start: 0.05, drift: 4, form: 'ringlet', amp: 15, per: 0.17, fade: 0.2 },
  coily: { n: 150, w: [1.0, 1.6], len: [0.45, 1.0], start: 0.02, drift: 10, form: 'coil', amp: 5, per: 0.035, fade: 0.15, round: true },
  coilyFuzz: { n: 60, w: [0.8, 1.2], len: [0.3, 0.9], start: 0.05, drift: 16, form: 'coil', amp: 6, per: 0.04, fade: 0.35, round: true },
  brow: { n: 11, w: [2.6, 3.6], len: [0.55, 0.95], start: 0.0, drift: 8, form: 'arc', bend: 7, fade: 0.15, spread: 0.75, taper: 0.8 },
  lash: { n: 4, w: [7.0, 9.0], len: [0.7, 1.0], start: 0.0, drift: 0, form: 'arc', bend: 18, fade: 0.05, spread: 0.55, converge: 0.35, taper: 0.7 },
  // (beard strands start at staggered heights: a common start drew each card's root end as a straight edge, the cheek line as blocks)
  beard: { n: 30, w: [2.0, 2.8], len: [0.4, 0.9], start: 0.3, drift: 16, form: 'wave', amp: 6, per: 0.35, fade: 0.15 },
  beardLong: { n: 66, w: [1.4, 2.2], len: [0.45, 1.0], start: 0.25, drift: 10, form: 'wave', amp: 9, per: 0.3, fade: 0.2 },
  plait: { n: 140, w: [1.3, 2.0], len: [0.95, 1.0], start: 0.0, drift: 3, form: 'straight', fade: 0.0, opaque: true },
  loc: { n: 260, w: [1.0, 1.6], len: [0.05, 0.16], start: -1, drift: 28, form: 'felt', fade: 0.0, opaque: true },
  fuzz: { n: 14, w: [0.8, 1.1], len: [0.3, 1.0], start: 0.1, drift: 30, form: 'coil', amp: 4, per: 0.08, fade: 0.4 },
  vellus: { n: 30, w: [0.6, 0.9], len: [0.25, 0.7], start: 0.0, drift: 8, form: 'straight', fade: 0.5 },
  dense: { n: 150, w: [1.2, 1.9], len: [0.8, 1.0], start: 0.02, drift: 4, form: 'straight', fade: 0.1 },
};

// HAIR3 (round 3, opt-in: atlasTexture(seed, 3), hairMaterial({ atlas: 3 })): the same sixteen slots, the scalp tiles redrawn finer
// and more varied. Real scalp hair is ~0.05-0.09 mm a strand; at a 1.2 cm card (128 px) lane D's strands were ~0.14 mm and evenly
// spread, so a card read as a combed plank. v3: thinner strands, ~2x as many, uneven lengths, strands that drift together toward the
// tip (a clump: 'sparse' is now a clump that converges, the outer layer's tile), wavy/curly tiles with the clump sharing its phase,
// 'fuzz' a flyaway (two or three strays), 'vellus' finer. Brows, lashes, beards, plaits, locs and the net are unchanged.
const RECIPE3 = { ...RECIPE,
  straight: { n: 190, w: [0.7, 1.2], len: [0.45, 1.0], start: 0.08, drift: 9, form: 'straight', fade: 0.3, groups: 7, gconv: 0.35 },
  sparse: { n: 70, w: [0.6, 1.1], len: [0.5, 1.0], start: 0.1, drift: 5, form: 'straight', fade: 0.3, converge: 0.55, spread: 0.85, stray: 0.12 },
  wavy: { n: 170, w: [0.7, 1.2], len: [0.5, 1.0], start: 0.08, drift: 7, form: 'wave', amp: 6, per: 0.42, fade: 0.3, groups: 6, gconv: 0.3 },
  curly: { n: 150, w: [0.8, 1.3], len: [0.45, 1.0], start: 0.05, drift: 4, form: 'ringlet', amp: 13, per: 0.19, fade: 0.25, groups: 4, gconv: 0.25 },
  coily: { n: 230, w: [0.7, 1.1], len: [0.4, 1.0], start: 0.02, drift: 8, form: 'coil', amp: 5, per: 0.04, fade: 0.2, round: true },
  coilyFuzz: { n: 90, w: [0.6, 0.9], len: [0.3, 0.9], start: 0.05, drift: 10, form: 'coil', amp: 6, per: 0.045, fade: 0.35, round: true },
  fuzz: { n: 3, w: [0.6, 0.9], len: [0.6, 1.0], start: 0.0, drift: 26, form: 'wave', amp: 5, per: 0.6, fade: 0.45, spread: 0.4 },
  vellus: { n: 40, w: [0.4, 0.7], len: [0.2, 0.7], start: 0.0, drift: 10, form: 'straight', fade: 0.55 },
  dense: { n: 260, w: [0.8, 1.3], len: [0.75, 1.0], start: 0.02, drift: 5, form: 'straight', fade: 0.12 },
};
function drawTile(D, ti, name, seed, R = RECIPE) {
  const rc = R[name], rnd = mulberry(seed * 977 + ti * 31 + 5), x0t = ti * TW;
  const put = (x, y, c, id, sh) => { const xi = x | 0, yi = y | 0; if (xi < x0t + 1 || xi >= x0t + TW - 1 || yi < 0 || yi >= AH || c <= 0.002) return; const k = (yi * AW + xi) * 4;
    const a = D[k + 1] / 255, na = 1 - (1 - a) * (1 - c); D[k + 1] = Math.round(na * 255);
    if (c > 0.35) { D[k] = id; D[k + 2] = Math.max(D[k + 2], Math.round(sh * 255 * c)); } };
  // stamp a soft disc of radius r (px) at (x, y)
  const stamp = (x, y, r, a, id) => { const R2 = r + 1; for (let yy = Math.floor(y - R2); yy <= Math.ceil(y + R2); yy++) for (let xx = Math.floor(x - R2); xx <= Math.ceil(x + R2); xx++) {
    const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y), c = Math.min(1, Math.max(0, r + 0.5 - d)) * a; if (c > 0) put(xx, yy, c, id, 0.55 + 0.45 * Math.cos(Math.min(1, d / Math.max(r, 0.5)) * Math.PI / 2)); } };
  if (name === 'net' && R === RECIPE3) { // (v3 atlas only; the snood's net stays on the v1 atlas) BOX-BRAID relief for HAIR3's braid
    // tubes: a stack of chevrons, two per tile height (the over-under of a three-strand plait seen from the side, repeated twice round
    // the tube), each band filled with fine strands slanting out from the braid's spine, the grooves between bands part-covered so the
    // stochastic alpha shows the tube's dark inside there
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let y = 0; y < AH; y++) for (let x = 1; x < TW - 1; x++) { const u = (x + 0.5) / TW, v = (y + 0.5) / AH, uc = (u * 2) % 1, du = Math.abs(uc - 0.5);
      const vv = ((v * 2 + du * 1.1) % 1 + 1) % 1, g = Math.min(vv, 1 - vv), band = ss(0.02, 0.16, g);
      const strand = 0.5 + 0.5 * Math.cos((vv * 9 + du * 14) * Math.PI * 2 + Math.sin(x * 0.37) * 0.6), sh = 0.25 + 0.75 * band * (0.7 + 0.3 * strand);
      put(x0t + x, y, 0.45 + 0.55 * band, 1 + ((Math.floor(vv * 9 + du * 14) * 37 + Math.floor(u * 4) * 11) % 250), sh); }
    return; }
  if (name === 'net') { // a knotted net (snood): diamond mesh lines, ~6 mm cells at a 4 cm card
    for (let y = 0; y < AH; y++) for (let x = 1; x < TW - 1; x++) { const u = (x + 0.5) / TW * 4, v = (y + 0.5) / AH * 16, a = Math.abs(((u + v) % 1 + 1) % 1 - 0.5), b = Math.abs(((u - v) % 1 + 1) % 1 - 0.5);
      const c = Math.max(Math.max(0, 1 - Math.abs(a - 0.5) * 22), Math.max(0, 1 - Math.abs(b - 0.5) * 22)); if (c > 0) put(x0t + x, y, Math.min(1, c * 1.4), 128, 0.8); }
    return; }
  const S = rc.spread ?? 1;
  for (let s = 0; s < rc.n; s++) {
    const id = 1 + Math.floor(rnd() * 254), w0 = rc.w[0] + (rc.w[1] - rc.w[0]) * rnd(), L = (rc.len[0] + (rc.len[1] - rc.len[0]) * rnd()) * AH;
    let x = x0t + TW / 2 + (rnd() - 0.5) * (TW - 8) * S, y = rc.start < 0 ? rnd() * AH : rc.start * AH * rnd();
    const ph = rnd() * Math.PI * 2, drift = (rnd() - 0.5) * 2 * rc.drift, stray = rc.stray && rnd() < rc.stray ? (rnd() - 0.5) * 70 : 0;
    const bend = (rc.bend || 0) * (0.7 + 0.6 * rnd()) * (S < 1 ? 1 : rnd() < 0.5 ? -1 : 1), conv = rc.converge || 0, xc = x0t + TW / 2;
    const ang = name === 'loc' ? (rnd() - 0.5) * 2.2 : 0;
    // (v3) clumps inside a card: each strand drifts toward one of a few group centres toward the tip
    const gx = rc.groups ? x0t + TW / 2 + ((Math.floor(rnd() * rc.groups) + 0.5) / rc.groups - 0.5) * (TW - 12) : 0, gc = rc.groups ? (rc.gconv || 0) * (0.6 + 0.8 * rnd()) : 0;
    const steps = Math.max(8, Math.ceil(L / 0.8));
    const xs = x;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, yy = y + (name === 'loc' ? Math.cos(ang) * t * L * 3 : t * L);
      let xx = xs + drift * t * t + stray * t * t * t;
      if (rc.form === 'wave') xx += (rc.amp || 0) * Math.sin(ph + t * L / AH / rc.per * 2 * Math.PI) * Math.min(1, t * 4);
      else if (rc.form === 'ringlet') xx += (rc.amp || 0) * Math.sin(ph + (y + t * L) / AH / rc.per * 2 * Math.PI) * Math.min(1, t * 3);
      else if (rc.form === 'coil') { const q = (y + t * L) / AH / rc.per + ph; xx += (rc.amp || 0) * (2 * Math.abs(((q % 1) + 1) % 1 - 0.5) * 2 - 1) * (0.7 + 0.3 * Math.sin(q * 0.37)); }
      else if (rc.form === 'arc') xx += bend * t * t + (xc - xs) * conv * t * t;
      else if (rc.form === 'felt') xx += Math.sin(ang) * t * L * 3;
      if (rc.form !== 'arc' && rc.converge) xx += (xc - xs) * rc.converge * t * t;
      if (gc) xx += (gx - xs) * gc * Math.min(1, t * 1.4);
      const taper = rc.taper ?? 1, r = Math.max(0.35, w0 * 0.5 * (1 - taper * Math.pow(t, 1.3)) + (1 - taper) * 0.2);
      // root-to-tip fade (and the coil tiles end in a rounded, fuzzy tip)
      let a = 1 - (rc.fade || 0) * Math.pow(t, 1.5);
      if (rc.round) a *= 1 - Math.max(0, (yy / AH - 0.82) / 0.18) * Math.pow(Math.abs((xx - xc) / (TW / 2)), 1.5) * 1.2;
      if (rc.opaque) a = 1;
      stamp(xx, yy, r, Math.max(0, a), id);
    }
  }
  if (name === 'loc' || name === 'plait') { // a felted or plaited core: fill the gaps (a loc is opaque; the plait sub-strand too) with darker fibre
    for (let y = 0; y < AH; y++) for (let x = x0t + 1; x < x0t + TW - 1; x++) { const k = (y * AW + x) * 4; if (D[k + 1] < 200) { D[k + 1] = Math.max(D[k + 1], 235); if (!D[k]) D[k] = 1 + ((x * 7 + y * 13) % 250); D[k + 2] = Math.min(D[k + 2], 60); } } }
}

const _atlas = {};
export function atlasData(seed = 8, ver = 1) {
  const key = ver === 3 ? 'v3' : 'v1';
  if (_atlas[key] && _atlas[key].seed === seed) return _atlas[key];
  const D = new Uint8Array(AW * AH * 4); for (let i = 3; i < D.length; i += 4) D[i] = 255;
  for (const [name, ti] of Object.entries(TILE)) drawTile(D, ti, name, seed, ver === 3 ? RECIPE3 : RECIPE);
  _atlas[key] = { seed, data: D, w: AW, h: AH, ver };
  return _atlas[key];
}
const _tex = {};
export function atlasTexture(seed = 8, ver = 1) {
  const key = ver === 3 ? 'v3' : 'v1';
  if (_tex[key] && _tex[key].userData.seed === seed) return _tex[key];
  const A = atlasData(seed, ver), t = new THREE.DataTexture(A.data, A.w, A.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; t.userData.seed = seed; t.userData.ver = ver;
  return (_tex[key] = t);
}

// ---------------------------------------------------------------- HAIR4 (round 4, opt-in: groomHero rev 4): strand tiles baked in Cycles
// The scalp tiles of the rev-4 atlas are renders of our own strand patches (review/studio_human_c8/after/hair4/tools/bake_tiles.py:
// ringlets, type-4 coil masses and defined coils, straight and wavy clumps, a flyaway, vellus), assembled into two 2048 x 512 PNGs in
// assets/hair/atlas4/ (make_atlas4.py): atlas4.png R strand id, G coverage, B occlusion among the strands (Cycles' AO, 1 = open);
// atlas4_flow.png R, G the strand tangent in the card plane as a doubled angle from the hair's direction (0.5 + 0.5 m cos 2a,
// 0.5 + 0.5 m sin 2a), B the clump column's normal across the card; atlas4_n.png the CLUMP's normal in card space (the curl tiles). The braid, loc and plait slots are the v3 procedural tiles. Most tiles are
// PERIODIC along the hair (a card repeats them every 4 card-widths: grow.js CardBuilder4), so the curl keeps its size on any card.
// The textures are made at once from the v3 atlas (a placeholder that renders) and filled when the PNGs arrive: await hair4Ready()
// before a still. Node has no image decoder here: setAtlas4Data(atlas, flow) fills them from raw RGBA (labs/human8/hair4_look.mjs).
export const PERIODIC4 = { straight: 1, sparse: 1, wavy: 1, curly: 1, coily: 1, coilyFuzz: 1, ringlet: 1, coil4: 1, curlySparse: 1, wavySparse: 1, dense: 1 };
let _t4 = null;
function tex4(data) { const t = new THREE.DataTexture(data, AW, AH, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4;
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; return t; }
async function decodePNG(url) {
  const blob = await (await fetch(url)).blob(), bm = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bm.width, bm.height) : Object.assign(document.createElement('canvas'), { width: bm.width, height: bm.height });
  const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(bm, 0, 0); const d = c.getImageData(0, 0, bm.width, bm.height).data;
  if (bm.width !== AW || bm.height !== AH) throw new Error('atlas4: ' + url + ' is ' + bm.width + 'x' + bm.height); return d;
}
export function atlas4Textures(base = new URL('../../../assets/hair/atlas4/', import.meta.url).href) {
  if (_t4) return _t4;
  const A = new Uint8Array(atlasData(8, 3).data), Fl = new Uint8Array(AW * AH * 4);
  for (let i = 0; i < Fl.length; i += 4) { Fl[i] = 255; Fl[i + 1] = 128; Fl[i + 2] = 128; Fl[i + 3] = 255; }
  const Nm = new Uint8Array(AW * AH * 4); for (let i = 0; i < Nm.length; i += 4) { Nm[i] = 128; Nm[i + 1] = 128; Nm[i + 2] = 255; Nm[i + 3] = 255; }
  _t4 = { atlas: tex4(A), flow: tex4(Fl), nrm: tex4(Nm), loaded: false, error: null };
  const browser = typeof document !== 'undefined' && typeof createImageBitmap !== 'undefined';
  _t4.ready = !browser ? Promise.resolve(false) : Promise.all([decodePNG(base + 'atlas4.png'), decodePNG(base + 'atlas4_flow.png'), decodePNG(base + 'atlas4_n.png')])
    .then(([a, f, nm]) => { setAtlas4Data(a, f, nm); return true; }).catch(e => { _t4.error = String(e); console.warn('hair atlas4 not loaded (the v3 atlas stands in):', e); return false; });
  return _t4;
}
export function setAtlas4Data(a, f, nm = null) { const T = atlas4Textures(); T.atlas.image.data.set(a); T.flow.image.data.set(f); if (nm) { T.nrm.image.data.set(nm); T.nrm.needsUpdate = true; } T.atlas.needsUpdate = T.flow.needsUpdate = true; T.loaded = true; return T; }
export function hair4Ready() { return atlas4Textures().ready; }
