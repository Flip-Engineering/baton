// STYLE / recipes: one person, many renderings: a style is a recipe over four layers (shape, surface, line, medium),
// never a filter on a finished render (LOOKS c1's lesson; the precedents are productions that keep one rig and layer
// style over it: Spider-Verse's line and halftone over 3D, Arcane's painted surfaces, Klaus's drawn light over forms).
//
//   import { STYLES, styledPerson, StyleStage } from '../lib/fx/style/recipes.js';
//   const P = styledPerson(base, 'monumental');                         // SHAPE (shape.js), before clothes are built
//   const h = new Hero(P, { ...opts, variant: P.name, height }); P.finish(h);
//   const stage = new StyleStage({ width: 1080, height: 1920 });       // owns a LitRenderer and, lazily, Looks / Print / PrintLab
//   await stage.render(ctx, 'monumental', { scene, camera, rig, hero: h, ground });   // SURFACE, LINE, MEDIUM
//
// The medium layer only CALLS the studio's own modules, each fed what it was built to read:
//   lit       light/ LitRenderer through its one display transform (photoreal, clay); `meter: 'face'` exposes for the faces
//             through lane B's likeness/expose.js (each lit side read against its own skin reflectance; a group gets the mean)
//   designed  surface.js's designed pass (flat, poster, notan), display-referred, on paper
//   looks     looks.js source({ color, aux, hero: { rank: -1 }, tone }) + apply(name): the hero plate in the studio's looks
//             (KLUTSIS gravure, SERIGRAPH plates, NOTAN, RISO, NEWSREEL ...); aux packed from the style AOVs (log depth, class)
//   print     print.js engrave / woodcut / halftone through FigurePass.read() (lines on the form's own uvs, contours from depth)
//   ref       figure_ref.js engrave / print / silhouette on the lit render cut by the figure mask (Ward planes, a Klutsis
//             cut-out with a red plate): the film-people modes, now for a CG person
//   film      printlab.js film stocks over the lit render (Tri-X, Kodachrome, nitrate ...)
// LINE (line.js) draws on top where a recipe asks for it, at the shape's level.
import * as THREE from 'three';
import { styleShape } from './shape.js';
import { applySurface, setKey, stylePass, patchOther, PALETTES } from './surface.js';
import { lineAOV, drawLines, figureMask } from './line.js';
import { LitRenderer } from '../light/pipeline.js';

export const STYLES = {
  photoreal: { label: 'photoreal', shape: { level: 0 }, surface: { surface: 'skin', fade: 0 }, medium: { kind: 'lit', meter: 'face' } },
  clay: { label: 'clay', shape: { level: 0 }, surface: { surface: 'clay' }, medium: { kind: 'lit' } },
  heroic: { label: 'heroic canon', shape: { level: 0, canon: 'heroic' }, surface: { surface: 'skin', fade: 0 }, medium: { kind: 'lit', meter: 'face' } },
  monumental: { label: 'monumental', shape: { level: { default: 1, hands: 0.6 }, canon: 'monumental' }, surface: { surface: 'clay', clay: '#a39a8c' }, medium: { kind: 'lit' } },
  sculpted: { label: 'simplified / planes', shape: { level: { default: 2, head: 1.6, hands: 1.2 } }, surface: { surface: 'clay', clay: '#b0a796' }, line: { planes: 0.5, landmarks: 0, weight: 1.3, face: false }, medium: { kind: 'lit' } },
  mannequin: { label: 'primitives', shape: { level: { default: 3, head: 2.6 } }, surface: { surface: 'clay', clay: '#b4aa98' }, medium: { kind: 'lit' } },
  engraving: { label: 'engraving', shape: { level: 1 }, surface: { surface: 'skin', lift: 0.6 }, medium: { kind: 'print', press: 'engrave', opts: { pitch: 6.5, contour: 0.9, ink: '#15110f' }, paper: 'cream', prep: { simplify: 6, clear: 0.7, contrast: 0.7 } } },
  woodcut: { label: 'woodcut', shape: { level: 1.5 }, surface: { surface: 'skin', lift: 0.6 }, medium: { kind: 'print', press: 'woodcut', opts: { pitch: 12, contour: 1, ink: '#1a1410' }, paper: 'rag', prep: { simplify: 10, clear: 0.75 } } },
  halftone: { label: 'halftone print', shape: { level: 1 }, surface: { surface: 'skin', lift: 0.6 }, medium: { kind: 'looks', name: 'KLUTSIS' } },
  klutsis: { label: 'halftone cut-out', shape: { level: 1 }, surface: { surface: 'skin' }, medium: { kind: 'ref', mode: 'print', opts: { red: '#bd1818' } } },
  engraveRef: { label: 'Ward planes', shape: { level: 1.5 }, surface: { surface: 'clay' }, medium: { kind: 'ref', mode: 'engrave', opts: { planes: 5 } } },
  notan: { label: 'notan poster', shape: { level: { default: 2, head: 1.5, hands: 1 } }, surface: { surface: 'notan', palette: 'notan', tone: [0.08, 0.02, -2, 0], key: [-0.8, 0.45, 0.3] }, line: { weight: 2.4, planes: 0, landmarks: 0.6, faceK: 1 }, medium: { kind: 'designed', poster: 'disc' } },
  poster: { label: 'three-ink poster', shape: { level: { default: 2, head: 1.5, hands: 1 } }, surface: { surface: 'poster', palette: 'acp', tone: [0.05, 0.02, -2, 0], key: [-0.75, 0.5, 0.35] }, line: { weight: 2.2, planes: 0.3, landmarks: 0.6 }, medium: { kind: 'designed', poster: 'band' } },
  cel: { label: 'flat value', shape: { level: { default: 1.6, head: 1.2, hands: 1 } }, surface: { surface: 'flat', tone: [0.08, 0.025, 0.55, 0] }, line: { weight: 1.8, planes: 0.2, landmarks: 0.4 }, medium: { kind: 'designed' } },
  film: { label: 'film (Tri-X)', shape: { level: 0 }, surface: { surface: 'skin', fade: 0 }, medium: { kind: 'film', stock: 'trix7266', opts: { gauge: '35mm', exposure: 0 } } },
  looksNotan: { label: 'NOTAN look', shape: { level: 1 }, surface: { surface: 'skin' }, medium: { kind: 'looks', name: 'NOTAN' } },
  serigraph: { label: 'SERIGRAPH look', shape: { level: 1.5 }, surface: { surface: 'skin' }, medium: { kind: 'looks', name: 'SERIGRAPH' } },
};
const recipeOf = r => typeof r === 'string' ? { ...STYLES[r], key: r } : r;
export const shapeKey = r => { const s = recipeOf(r).shape || {}; return JSON.stringify({ l: s.level ?? 0, c: s.canon || 'natural', k: s.caricature ? s.caricature.k : null }); };
// SHAPE: the styled person (a hero data object) for a recipe. extra: { caricature: { mean, k } }, height
export function styledPerson(base, r, extra = {}) { const s = recipeOf(r).shape || {}; return styleShape(base, { ...s, ...extra, height: extra.height ?? base.height, caricature: s.caricature ? { ...s.caricature, ...(extra.caricature || {}) } : extra.caricature }); }

// a surface switch on an installed surface patch (one hero, many surfaces)
const SURF = { flat: 1, poster: 2, notan: 3 };
export function setSurface(st, s = {}) {
  const U = st.U, h = st.h, kind = s.surface || 'skin', pal = typeof s.palette === 'string' ? PALETTES[s.palette] : (s.palette || PALETTES.acp);
  U.stSurf.value = SURF[kind] || 1; U.stClayK.value = kind === 'clay' ? 1 : 0; U.stFade.value = s.fade ?? 1; U.stLift.value = s.lift ?? 0;
  if (s.clay) U.stClay.value.set(s.clay).convertSRGBToLinear();
  U.stTone.value.set(...(s.tone || [0.05, 0.03, 0.55, 0]));
  U.stPal.value.set(...(s.pal || (kind === 'flat' ? [1.0, 0.38, 0.55, 0] : kind === 'notan' ? [0.24, 0.24, 0.12, 0] : [0.16, 0.44, 0.12, 0])));
  U.stInk.value.set(pal.ink); U.stPaper.value.set(pal.paper); U.stRed.value.set(pal.red); U.stMid.value.set(pal.mid || pal.ink);
  U.stUWc.value.set(kind === 'clay' ? '#6a645c' : '#d8d2c6').convertSRGBToLinear();
  st._mat ||= []; if (!st._mat.length) h.group.traverse(m => { if (m.isMesh) for (const mt of [].concat(m.material)) if (mt) st._mat.push([mt, mt.sheen, mt.clearcoat]); });
  for (const [mt, sh, cc] of st._mat) { if (kind === 'clay') { if ('sheen' in mt) mt.sheen = 0; if ('clearcoat' in mt && !(h.eyes && h.eyes.material === mt)) mt.clearcoat = 0; } else { if ('sheen' in mt) mt.sheen = sh; if ('clearcoat' in mt) mt.clearcoat = cc; } }
  for (const k of ['hStubble', 'hDirt']) if (h.skinU[k]) { h._st0 ||= {}; h._st0[k] ??= h.skinU[k].value; h.skinU[k].value = kind === 'clay' ? 0 : h._st0[k]; }
  st.surface = kind; return st;
}

const mk = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
export class StyleStage {
  constructor({ width = 1080, height = 1920, quality = 'clip' } = {}) {
    this.W = width; this.H = height; this.glc = mk(width, height);
    this.lr = new LitRenderer({ canvas: this.glc, width, height, quality }); this.r = this.lr.renderer;
    this.lit = mk(width, height); this.stats = {};
  }
  // the surface patch on a hero (once), the ground and set patched so AOVs see them (ids 90+)
  prepare(h, extras = []) { if (!h.styleSurface) applySurface(h, { surface: 'skin', underwear: !!h._bare }); for (const [m, id] of extras) for (const mt of [].concat(m.material)) patchOther(mt, h.styleSurface, id); return h.styleSurface; }
  _lit(scene, camera, rig, o = {}) { const t0 = performance.now(); this.lr.render({ scene, camera, rig, t: o.t ?? 0, lens: o.lens || {}, K: o.K }); this.lr.sync?.();
    const g = this.lit.getContext('2d'); g.drawImage(this.glc, 0, 0); this.stats.lit = Math.round(performance.now() - t0); return this.lit; }
  // meter the faces with lane B's likeness/expose.js (one K=1 draft render, each face's lit side read against its own skin
  // reflectance) and set the rig for the mean of their stops: a group is exposed for the group, not for one face. Undone by
  // the caller with setRigStops(rig, scene, -stops).
  async meterFaces(scene, camera, rig, heroes, { bias = 0 } = {}) {
    const E = await import('../likeness/expose.js'), st = [];
    heroes.forEach((h, k) => { const m = E.meterFace({ lr: this.lr, scene, camera, rig, hero: h, render: k === 0 }); if (!m) return;
      // HUMAN c8 integration v2 (seam 12): THREE.Color(hex) already decodes sRGB to linear when ColorManagement is on (every lab turns
      // it on); the second decode read skin 0.8-1.7 stops dark and under-exposed every metered photoreal render. Decoded once now;
      // StyleStage.meterDecodeTwice = true restores the old reading exactly.
      const c = new THREE.Color(h.o.skin || '#b08a70'); if (StyleStage.meterDecodeTwice || !THREE.ColorManagement.enabled) c.convertSRGBToLinear();
      const skinY = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b + 0.03;   // albedo + the surface's specular share (lane B's skinY)
      st.push(Math.log2(skinY * 2 ** bias / Math.max(m.p75, 1e-8))); });
    if (!st.length) return { stops: 0, n: 0 };
    const stops = THREE.MathUtils.clamp(st.reduce((a, b) => a + b, 0) / st.length, -6, 6); E.setRigStops(rig, scene, stops);
    return { stops, n: st.length, each: st.map(x => +x.toFixed(2)), undo: () => E.setRigStops(rig, scene, -stops) };
  }
  // AOVs at half resolution (lines and aux), the figure mask
  // AOVs at full resolution on small stages (lines at their own scale), half on large ones
  aov(scene, camera, k = this.W < 1600 ? 1 : 0.5) { const w = Math.round(this.W * k), h = Math.round(this.H * k); return lineAOV(this.r, scene, camera, w, h); }
  // pack a looks.js aux (W/2 x H/2: R,G 16-bit log depth, B class 255 subject | 0 ground) from the AOVs
  lookAux(aov, [zn, zf] = [1, 80]) {
    const { w, h, ids, nd } = aov, c = mk(w, h), g = c.getContext('2d'), im = g.createImageData(w, h), D = im.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (h - 1 - y) * w + x, o = (y * w + x) * 4, cov = ids[i * 4 + 3] > 0, z = nd[i * 4 + 3];
      const l = !cov || z <= 0 ? 65535 : Math.round(65534 * THREE.MathUtils.clamp(Math.log(Math.max(z, zn) / zn) / Math.log(zf / zn), 0, 1));
      D[o] = l >> 8; D[o + 1] = l & 255; D[o + 2] = cov && ids[i * 4] < 90 ? 255 : 0; D[o + 3] = 255; }
    g.putImageData(im, 0, 0); return c; }
  // print.js's draw() defaults to 1080 x 1920 and Looks.apply() calls it without a size: the stage's own size is passed in
  // from outside (a stage of any size, nothing in looks.js or print.js changed)
  async _looks() { if (!this.looks) { const { Looks } = await import('../looks.js'); this.looks = new Looks({ width: this.W, height: this.H }); const pr = this.looks.pr, d0 = pr.draw, W = this.W, H = this.H; pr.draw = (c, t, o = {}) => d0.call(pr, c, t, { w: W, h: H, ...o }); } return this.looks; }
  async _print() { if (!this.print) { const { Print } = await import('../print.js'); this.print = new Print({ width: this.W, height: this.H }); this.print.preload(['cream', 'rag', 'ivory']); } return this.print; }
  async _fp() { if (!this.fp) { const { FigurePass, fpPatchScene } = await import('../figure_pass.js'); this.fp = new FigurePass(this.r, Math.round(this.W / 2), Math.round(this.H / 2)); this.fpPatchScene = fpPatchScene; } return this.fp; }
  async _plab() { if (!this.plab) { const { PrintLab } = await import('../../printlab.js'); this.plab = await PrintLab.create({ width: this.W, height: this.H }); } return this.plab; }

  // render a recipe into ctx (a 2D context of W x H). o: { scene, camera, rig, hero | heroes: [...], sunDir (world, toward the
  // light), t, extras: [[mesh, id]] (ground 90, set 91 ...: patched so the AOVs see them) }. Every hero in the frame takes the recipe.
  async render(ctx, recipe, o) {
    const R = recipeOf(recipe), { scene, camera, rig } = o, hs = o.heroes || [o.hero], h = hs[0], M = R.medium || { kind: 'lit' }, t0 = performance.now(), W = this.W, H = this.H;
    const sun = o.sunDir || (rig && rig.sunDir) || new THREE.Vector3(-0.5, 0.7, 0.5); let st = null;
    // the designed passes take a DESIGNED key (R.surface.key, view space) when the recipe gives one: a notan wants about half the
    // figure turned from the light, which a frontal sun never gives (first board: light-skinned figures printed nearly all paper)
    for (const hh of hs) { const s1 = this.prepare(hh, o.extras || []); setSurface(s1, R.surface || {}); if (R.surface?.key) s1.U.stKey.value.set(...R.surface.key).normalize(); else setKey(s1, camera, sun); st ||= s1; }
    const g = ctx; g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    const level = (() => { const s = R.shape || {}; const l = s.level ?? 0; return typeof l === 'number' ? l : (l.default ?? 0); })();
    const needLit = ['lit', 'looks', 'print', 'ref', 'film'].includes(M.kind);
    let lit = null, meter = null;
    if (needLit) { if (M.meter === 'face' && o.meter !== false) meter = await this.meterFaces(scene, camera, rig, o.heroes || [h]);
      try { lit = this._lit(scene, camera, rig, { t: o.t }); } finally { meter?.undo?.(); } }
    const pal = PALETTES[(R.surface || {}).palette] || PALETTES.acp;
    if (M.kind === 'lit') g.drawImage(lit, 0, 0);
    else if (M.kind === 'designed') {
      g.fillStyle = pal.paper; g.fillRect(0, 0, W, H);
      if (M.poster) { if (hs.length <= 2) for (const hh of hs) this._posterGround(g, M.poster, hh, camera, pal); else this._posterGround(g, 'band', hs[Math.floor(hs.length / 2)], camera, pal); }   // a row: one band under all (discs would chain)
      this.r.setRenderTarget(null); this.r.setClearColor(0x000000, 0); stylePass(this.r, scene, camera, 1, { clear: [0, 0, 0, 0] });
      g.drawImage(this.glc, 0, 0); }
    else if (M.kind === 'looks') {
      const lk = await this._looks(), aov = this.aov(scene, camera), aux = this.lookAux(aov);
      lk.source({ color: lit, aux, hero: { rank: -1, light: [-0.6, 0.55] }, tone: lit, depth: [1, 80], tonal: [] }, { color: 'c' + Math.random(), aux: 'a' + Math.random() });
      lk.apply(g, M.name, o.t ?? 0, {}); }
    else if (M.kind === 'print') {
      const pr = await this._print(), fp = await this._fp(); this.fpPatchScene(scene, m => m.userData.subject ?? (m.userData.ground ? 0 : 1));   // idempotent per material; new heroes get patched
      const aux = fp.read(scene, camera);
      pr.render(g, lit, [[M.press, M.opts || {}]], { t: o.t ?? 0, paper: M.paper || 'cream', aux, prep: { subject: 'aux', ...(M.prep || {}) }, out: null, boil: 0, draw: { w: W, h: H } }); }
    else if (M.kind === 'ref') {
      const ref = await import('../figure_ref.js'), aov = this.aov(scene, camera), mask = figureMask(aov), cut = mk(W, H), cg = cut.getContext('2d');
      cg.drawImage(mask, 0, 0, W, H); cg.globalCompositeOperation = 'source-in'; cg.drawImage(lit, 0, 0);
      const F = { name: 'cg', img: cut, w: W, h: H, meta: { foot: [W / 2, H] } };
      g.fillStyle = M.mode === 'print' ? '#efe6d2' : '#EFE6CF'; g.fillRect(0, 0, W, H);
      if (M.mode === 'print') { g.fillStyle = (M.opts || {}).red || '#bd1818'; g.fillRect(0, H * 0.62, W, H * 0.38); }
      ref[M.mode](g, F, { box: [0, 0, W, H], ...(M.opts || {}) }); }
    else if (M.kind === 'film') { const lab = await this._plab(); await lab.stock(M.stock); lab.film(g, lit, M.stock, { frame: 0, ...(M.opts || {}) }); }
    if (R.line) { const aov = this.aov(scene, camera); drawLines(g, aov, { ...R.line, level, heroes: hs, camera, key: st.U.stKey.value, ink: R.line.ink || pal.ink }); }
    g.restore();
    this.stats.total = Math.round(performance.now() - t0); this.stats.meter = meter;
    return { ms: this.stats.total, meter };
  }
  // the designed ground of a poster: a red disc behind the figure (Klutsis' sun), or a red band under it
  _posterGround(g, kind, h, camera, pal) {
    const W = this.W, H = this.H, pj = p => { const v = p.clone().project(camera); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H]; };
    const chest = pj(h.joint('spine01')), foot = pj(h.joint('foot.L').add(h.joint('foot.R')).multiplyScalar(0.5)), head = pj(h.joint('head'));
    g.fillStyle = pal.red;
    if (kind === 'disc') { const r = Math.abs(foot[1] - head[1]) * 0.34; g.beginPath(); g.arc(chest[0] + r * 0.18, chest[1] - r * 0.25, r, 0, Math.PI * 2); g.fill(); }
    else { g.save(); g.translate(W / 2, foot[1]); g.rotate(-Math.min(Math.PI / 6, Math.atan(H / W) * 0.6)); g.fillRect(-W, -H * 0.06, W * 2, H * 0.22); g.restore(); }
  }
}
