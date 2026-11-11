// STYLE c2 / S2 PAINT: PaintStage, lane E's StyleStage with five more medium kinds. A recipe of any other kind goes to StyleStage as it
// is (so lane E's STYLES render through this stage unchanged); a recipe of one of these kinds runs the same SHAPE / SURFACE / LINE
// layers and then its own medium:
//   mural        lit (metered at the faces) + the STROKE AOV -> media.js mural(); lane E's lines in umber
//   watercolour  lit (metered) + MATTER and FIELDS AOVs -> media.js watercolour(); lane E's lines as a sepia pencil, translucent
//   monument     lit with patch.js's monument material (bronze, plaster, stainless steel) on every part of the person (no metering:
//                the rig's own exposure, as a statue in daylight)
//   shadow       the STROKE AOV only -> media.js shadowPlay(): a card cut-out, the joints from the rig's joint centres
//   plate        PLATE + FIELDS AOVs with garments and hair hidden, the STROKE AOV with them (their ghosts) -> media.js plate()
//
//   import { PaintStage } from '../lib/fx/style/paint/stage.js';   // or index.js
//   const stage = new PaintStage({ width, height }); await stage.load();
//   await stage.render(ctx, 'mural' | PAINT_STYLES.mural | any lane E recipe, { scene, camera, rig, heroes, sunDir, extras: [[ground, 90]] });
// The stroke size is set per person per frame from the camera DISTANCE to the person's root (not the posed height, which bobs in a
// walk and would re-seed every stroke each frame), quantised to eighth-octaves.
import * as THREE from 'three';
import { StyleStage, STYLES, setSurface } from '../recipes.js';
import { setKey } from '../surface.js';
import { drawLines } from '../line.js';
import { loadAnatomy, paintFields, MUSCLES } from './fields.js';
import { applyPaint, paintOther, paintAOV, OBJ } from './patch.js';
import { mural, watercolour, shadowPlay, plate, fillHoles, lostEdges } from './media.js';

export const PAINT_KINDS = new Set(['mural', 'watercolour', 'monument', 'shadow', 'plate']);
const MAT = { bronze: 1, plaster: 2, steel: 3 };
const MATCOL = { 1: [[0.15, 0.092, 0.05], [0.12, 0.28, 0.22]], 2: [[0.72, 0.7, 0.65], [0.5, 0.5, 0.5]], 3: [[0.6, 0.61, 0.62], [0.3, 0.3, 0.3]] };
const mk = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

export class PaintStage extends StyleStage {
  constructor(o = {}) { super(o); this.pstats = {}; this.recipes = o.recipes || {}; }
  async load() { this.A ||= await loadAnatomy().catch(e => { console.warn('paint: no lane A anatomy', e); return null; }); return this; }
  recipe(r) { return typeof r === 'string' ? { ...(this.recipes[r] || STYLES[r]), key: r } : r; }
  // the fields and the patch on a hero (once; materials made later are patched on the next call)
  preparePaint(h, extras = []) { this.prepare(h, extras); if (!h._paintFields) paintFields(h, this.A); const pt = applyPaint(h, {});
    this.setU ||= { ...pt.U, ptMat: { value: 0 }, ptScreen: { value: 0 } };   // the set's own uniforms (shares the mode): a plinth never turns to metal
    for (const [m, id] of extras) for (const mt of [].concat(m.material)) paintOther(mt, this.setU, id >= 91 ? OBJ.set : OBJ.ground); return pt; }
  // px per metre at a hero's root, from the camera distance (stable through a walk), quantised to 1/8 octave
  pxPerM(h, camera) { const d = camera.position.distanceTo(h.group.getWorldPosition(new THREE.Vector3())), v = this.H / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * Math.max(0.05, d) / (camera.zoom || 1));
    return 2 ** (Math.round(Math.log2(v) * 8) / 8); }
  async render(ctx, recipe, o) {
    const R = this.recipe(recipe), M = R.medium || { kind: 'lit' };
    if (!PAINT_KINDS.has(M.kind)) return super.render(ctx, R, o);
    await this.load();
    const { scene, camera, rig } = o, hs = o.heroes || [o.hero], W = this.W, H = this.H, t0 = performance.now(), g = ctx, ms = {};
    const sun = o.sunDir || (rig && rig.sunDir) || new THREE.Vector3(-0.5, 0.7, 0.5);
    let st = null; const fig = [];
    for (const hh of hs) { const pt = this.preparePaint(hh, o.extras || []), s1 = hh.styleSurface; setSurface(s1, R.surface || {}); if (R.surface?.key) s1.U.stKey.value.set(...R.surface.key).normalize(); else setKey(s1, camera, sun); st ||= s1;
      const ppm = this.pxPerM(hh, camera), figPx = ppm * (hh.o.height || 1.7), sk = M.stroke || {}, strokePx = Math.min(sk.max ?? 12, Math.max(sk.min ?? 2.4, figPx * (sk.k ?? 0.0095)));
      pt.U.ptCell.value = strokePx / 0.72 / ppm; pt.U.ptFine.value = sk.fine ?? 0.42; pt.U.ptScreen.value = M.screen ? pt.U.ptUnit.value / ppm : 0;   // screen: the shower-door control
      const hp = Math.max(M.hatch?.min ?? 2.2, Math.min(M.hatch?.max ?? 4.2, figPx * (M.hatch?.k ?? 0.0036)));
      pt.U.ptHatch.value = hp / 0.38 / ppm; pt.U.ptKey.value.copy(s1.U.stKey.value);
      fig.push({ h: hh, pt, ppm, figPx, strokePx }); }
    const level = (() => { const l = (R.shape || {}).level ?? 0; return typeof l === 'number' ? l : (l.default ?? 0); })();
    let meter = null, lit = null;
    const doLit = async () => { const t = performance.now(); if (M.meter === 'face' && o.meter !== false) meter = o.meterFn ? o.meterFn() : await this.meterFaces(scene, camera, rig, hs);
      try { lit = this._lit(scene, camera, rig, { t: o.t, K: o.K }); } finally { meter?.undo?.(); } ms.lit = Math.round(performance.now() - t); };
    const aov = (modes) => { const t = performance.now(); const a = paintAOV(this.r, scene, camera, W, H, modes); ms.aov = (ms.aov || 0) + Math.round(performance.now() - t); return a; };
    const projected = (hh) => { const pj = p => { const v = p.clone().project(camera); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H]; }; return pj; };
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    let rep = {};
    if (M.kind === 'monument') {
      const mat = MAT[M.material] || 1, saved = [];
      for (const f of fig) { const U = f.pt.U; U.ptMat.value = mat; U.ptMatA.value.set(...(M.colA || MATCOL[mat][0]), 0); U.ptMatB.value.set(...(M.colB || MATCOL[mat][1]), 0);
        // a statue has no skin: hero.js's red wrap past the terminator and the asperity rim (skin terms, c7) are off for the render
        const su = f.h.skinU || {}; if (su.hSkinWrap) { saved.push([su.hSkinWrap, su.hSkinWrap.value.clone()]); su.hSkinWrap.value.set(0, 0, 0); } if (su.hAsp) { saved.push([su.hAsp, su.hAsp.value]); su.hAsp.value = 0; } }
      try { await doLit(); g.drawImage(lit, 0, 0); } finally { for (const f of fig) f.pt.U.ptMat.value = 0; for (const [u, v] of saved) { if (u.value && u.value.copy) u.value.copy(v); else u.value = v; } }
    } else if (M.kind === 'mural') {
      await doLit(); const A = aov(o.trace ? [1, 2, 3, 5] : [1, 2, 3]), heroes = fig.map(f => { const v = f.h.joint('spine03').project(camera); return { cx: (v.x * 0.5 + 0.5) * W }; }); this.lastAOV = A;
      const t = performance.now(); rep = mural(g, { W, H, lit, aov: A, opts: M, heroes, hold: o.hold }); ms.paint = Math.round(performance.now() - t);
    } else if (M.kind === 'watercolour') {
      await doLit(); const A = aov(o.trace ? [1, 2, 3, 5] : [2, 3]), heroes = fig.map(f => { const v = f.h.joint('spine03').project(camera); return { cx: (v.x * 0.5 + 0.5) * W }; });
      this.lastAOV = A; const t = performance.now(); rep = watercolour(g, { W, H, lit, aov: A, opts: M, heroes, hold: o.hold }); ms.paint = Math.round(performance.now() - t);
    } else if (M.kind === 'shadow') {
      const A = aov(o.trace ? [1, 5] : [1]), heroes = fig.map(f => { const pj = projected(f.h), h = f.h, J = [], cam = camera.position; this.lastAOV = A;
        const lim = [['lowerarm01', 'wrist', 0.042], ['lowerleg01', 'foot', 0.052]];
        for (const s of ['L', 'R']) for (const [a, b, r] of lim) { const pa = h.joint(`${a}.${s}`), pb = h.joint(`${b}.${s}`), [x, y] = pj(pa), [x2, y2] = pj(pb); J.push({ x, y, r: r * f.ppm, ang: Math.atan2(y2 - y, x2 - x) }); }

        const eL = h.joint('eye.L'), eR = h.joint('eye.R'), near = eL.distanceTo(cam) < eR.distanceTo(cam) ? eL : eR, [ex, ey] = pj(near), hd = h.joint('head'), fw = new THREE.Vector3(0, 0, 1).applyQuaternion(h.group.quaternion);
        const [fx] = pj(near.clone().addScaledVector(fw, 0.05)), prof = Math.abs(fx - ex) > 0.03 * f.ppm;
        const fy = Math.max(pj(h.joint('foot.L'))[1], pj(h.joint('foot.R'))[1]) + 0.05 * f.ppm; void hd;
        return { joints: J, eye: prof ? { x: ex, y: ey, px: 0.013 * f.ppm, ang: fx > ex ? 0.12 : -0.12 } : null, footY: fy }; });
      const t = performance.now(); rep = shadowPlay(g, { W, H, aov: A, opts: M, heroes, strokePx: Math.min(...fig.map(f => f.strokePx)) }); ms.paint = Math.round(performance.now() - t);
    } else if (M.kind === 'plate') {
      const hide = [], cover = []; for (const f of fig) { const u = f.h.skinU && f.h.skinU.hCover; if (u && u.value.w > 0.5) { cover.push([u, u.value.w]); u.value.w = 0; } }
      for (const f of fig) f.h.group.traverse(m => { if (m.isMesh && m.visible && m !== f.h.body && !(m.userData.part === 'eyes' || m === f.h.eyes || (f.h.likeness?.eyes?.mesh === m))) { m.visible = false; hide.push(m); } });
      let A; try { A = aov([4, 3]); } finally { for (const m of hide) m.visible = true; for (const [u, w] of cover) u.value.w = w; }
      if (M.ghosts !== false && hide.length) { const B = aov([1]); A.mg = B.m1; }
      const names = Object.fromEntries(MUSCLES.map(([, nm], i) => [i + 1, nm])), heroes = fig.map(f => { const pj = projected(f.h), [cx, cy] = pj(f.h.joint('spine03')); return { cx, cy, half: 0.5 * f.ppm }; });
      const t = performance.now(); rep = plate(g, { W, H, aov: A, opts: { ...M, names }, heroes }); ms.paint = Math.round(performance.now() - t);
    }
    if (R.line) { const t = performance.now(), la = this.aov(scene, camera, 1), L = R.line, pal = { ink: L.ink || '#16130f' };
      if ((L.alpha ?? 1) < 1) { const c = mk(W, H), cg = c.getContext('2d'); drawLines(cg, la, { ...L, level, heroes: hs, camera, key: st.U.stKey.value, ink: pal.ink }); g.globalAlpha = L.alpha; g.drawImage(c, 0, 0); g.globalAlpha = 1; }
      else drawLines(g, la, { ...L, level, heroes: hs, camera, key: st.U.stKey.value, ink: pal.ink });
      ms.line = Math.round(performance.now() - t); }
    if (rep.fig && M.kind !== 'shadow') { const big = Math.max(...fig.map(f => f.figPx)); rep.holes = fillHoles(g, rep.fig, W, H, { maxArea: Math.round((0.02 * big) ** 2), ring: Math.max(2, Math.round(2.5 * (R.line?.weight ?? 1) * W / 1080)) });
      if (M.lost) rep.lost = lostEdges(g, rep.fig, W, H, { r: M.lost.r ?? 4, contrast: M.lost.contrast ?? 38, k: Math.max(1, Math.min(...fig.map(f => f.strokePx)) / 7) }); }
    delete rep.fig;
    g.restore();
    ms.total = Math.round(performance.now() - t0); this.pstats = { ...ms, ...rep, strokePx: fig.map(f => +f.strokePx.toFixed(2)) };
    return { ms: ms.total, meter, stats: this.pstats };
  }
}
