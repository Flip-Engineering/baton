// STYLE c2 / S1: DrawStage, lane E's StyleStage with one more medium kind, 'draw' (the drawn surface of glsl.js + lane E's
// line.js on top + a drawn ground). Every other recipe goes to StyleStage unchanged, so one stage renders lane E's STYLES and
// DRAW_STYLES side by side.
//
//   const stage = new DrawStage({ width, height });
//   await stage.render(ctx, 'hatch', { scene, camera, rig, heroes: [h1, h2], sunDir });   // or any lane E key
//   await stage.bindAOV(scene, camera)                                                     // per-pixel bind position + mesh id
import * as THREE from 'three';
import { StyleStage, STYLES, setSurface } from '../recipes.js';
import { stylePass } from '../surface.js';
import { drawLines, figureMask } from '../line.js';
import { DRAW_U, patchDraw, packDrawFields, drawFieldTexture, paperQuad, blueNoiseTexture } from './glsl.js';
import { loadDrawAnatomy, drawFields } from './fields.js';

const raw = (c, out = new THREE.Color()) => { const n = parseInt(String(c).replace('#', ''), 16); return out.setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, THREE.LinearSRGBColorSpace); };   // display values, uploaded as they are
const hash2 = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };   // the ground's dots stay put frame to frame (Math.random boiled them)
const levelOf = R => { const l = (R.shape || {}).level ?? 0; return typeof l === 'number' ? l : (l.default ?? 0); };

// fields + the chained patch on every material of a hero (after lane E's surface patch); idempotent
// STYLE c4: WebGL allows 16 vertex attributes a program (SwiftShader and ANGLE alike), and three's morph targets spend one of them
// (gl_VertexID); past it the program does not link and three draws nothing for that mesh. The v4 body (13 attributes of its own +
// lane E's aStyle / aStyleN + gl_VertexID = 16) had no room for aDr0 / aDr1: the body vanished in every drawn and graphic style, and
// in the photoreal render of the same person afterwards (one program). Each geometry now takes the fields the way it has room for:
// two attributes (as before), one packed attribute (DR_PACK), or none (DR_TEX: the packed field in a float texture read by
// gl_VertexID). opts.pack: 'auto' (default) | 'attr' | 'tex' | false (as before, everywhere).
export const MAX_ATTRIBS = 16;
const nAttr = (h, m) => Object.keys(m.geometry.attributes).filter(k => k !== 'aDr0' && k !== 'aDr1' && k !== 'aDrQ').length
  + (m === h.body && !m.geometry.attributes.aStyle ? 2 : 0) + (Object.keys(m.geometry.morphAttributes || {}).length ? 1 : 0);
export function installDraw(h, A, { pack = 'auto' } = {}) {
  if (h._draw) return h._draw;
  const f = drawFields(h, A); let k = 0, n = 0; const how = new Map(), rep = { attr: 0, tex: 0 };   // per material: the tightest of its meshes
  const rank = { two: 0, attr: 1, tex: 2 };
  h.group.traverse(m => { if (!m.isMesh) return; const a = nAttr(h, m), w = pack === false ? 'two' : pack === 'attr' ? 'attr' : pack === 'tex' ? 'tex' : a + 2 <= MAX_ATTRIBS ? 'two' : a + 1 <= MAX_ATTRIBS ? 'attr' : 'tex';
    for (const mt of [].concat(m.material)) if (!how.has(mt) || rank[w] > rank[how.get(mt)]) how.set(mt, w); });
  const users = new Map(); h.group.traverse(m => { if (m.isMesh) for (const mt of [].concat(m.material)) users.set(mt, (users.get(mt) || 0) + 1); });
  h.group.traverse(m => { if (!m.isMesh) return; const id = m === h.body ? 0 : ++k;
    for (const mt of [].concat(m.material)) { let w = how.get(mt) || 'two'; if (w === 'tex' && users.get(mt) > 1) w = 'attr';   // a texture is per geometry
      if (!m.geometry.attributes.aDr0) continue;
      const tex = w === 'tex' ? drawFieldTexture(m.geometry) : null; if (w === 'attr' && !m.geometry.attributes.aDrQ) packDrawFields(m.geometry);
      if (patchDraw(mt, id, { pack: w === 'attr', tex })) { n++; if (w !== 'two') rep[w]++; } } });
  return (h._draw = { ...f, materials: n, packed: rep });
}

// the medium's uniforms from a recipe (missing entries keep the defaults of glsl.js)
const DEF = { tone: [0.0, 0.08, 0.22, 0.25], local: [0.35, 0.65, 0.8, 0.7], hatch: [5.0, 1.0, 1.0, 0.0015], levels: [0.1, 0.42, 0.68, 0.0], face: [0.35, 0.7, 0.25, 0], grain: [1.4, 0.3, 0.5, 0.6], paperK: [0.06, 0.05, 1.6, 0] };
export function setDrawMedium(M, R = {}) {
  const U = DRAW_U; U.drKind.value = M.draw ?? 1;
  for (const [k, u] of [['tone', 'drTone'], ['local', 'drLocal'], ['hatch', 'drHatch'], ['levels', 'drLevels'], ['face', 'drFace'], ['grain', 'drGrain'], ['paperK', 'drPaperK']]) { const v = M[k] || DEF[k]; U[u].value.set(v[0], v[1], v[2], v[3] ?? DEF[k][3]); }
  raw(M.ink || '#15110f', U.drInk.value); raw(M.ink2 || M.ink || '#15110f', U.drInk2.value); raw(M.paper || '#efe6d2', U.drPaper.value); raw(M.chalk || '#f6f1e4', U.drChalk.value);
  if (R.surface?.key) U.drKey.value.set(...R.surface.key).normalize();
}

export class DrawStage extends StyleStage {
  constructor(o = {}) { super(o); this.recipes = o.recipes || {}; }
  recipe(r) { if (typeof r !== 'string') return r; const R = this.recipes[r] || STYLES[r]; if (!R) throw new Error('no style ' + r); return { ...R, key: r }; }
  async render(ctx, recipe, o) {
    const R = this.recipe(recipe), M = R.medium || {};
    if (M.kind !== 'draw') return super.render(ctx, R, o);
    const { scene, camera } = o, hs = o.heroes || [o.hero], W = this.W, H = this.H, t0 = performance.now(), U = DRAW_U;
    const A = await loadDrawAnatomy().catch(e => { console.warn('draw: no lane A anatomy, fibres off', e); return null; }); blueNoiseTexture();
    let st = null;
    for (const h of hs) { const s1 = this.prepare(h, o.extras || []); setSurface(s1, R.surface || { surface: 'skin', fade: 1 }); installDraw(h, A); st ||= s1; }
    setDrawMedium(M, R);
    if (!R.surface?.key) { const sun = o.sunDir || new THREE.Vector3(-0.5, 0.7, 0.5); U.drKey.value.copy(sun).normalize().transformDirection(camera.matrixWorldInverse); }
    U.drRes.value.set(W, H); U.drScreen.value = o.screen || R.screen ? 1 : 0;
    // the figure's size on screen (px per metre at the heroes, mean): hatch spacing and line weight follow the FIGURE, not the canvas
    // (line.js scales by canvas width: a 4860-wide row drew 6 px contours on 900 px figures on the first farm board)
    const ppm = hs.reduce((a, h) => { const p = h.joint('head'), q = p.clone(); q.y -= 1; const A = p.project(camera), B = q.project(camera); return a + Math.abs(A.y - B.y) * 0.5 * H; }, 0) / hs.length;
    const k = Math.min(3, Math.max(0.25, ppm / 540)); U.drScale.value = k; this.stats.figureScale = +k.toFixed(3);
    const r = this.r, q = (this._paper ||= paperQuad()); const t1 = performance.now();
    // STYLE c4: the ground's drawn surface reads the key's shadow map; stylePass holds it (autoUpdate off), so a drawn frame with no
    // lit render before it read a map never drawn (the dark slab under one figure, JUDGE c10) and a walk read the first frame's
    // shadow. The map is now drawn in this pass, from the people and ground it shows.
    r.shadowMap.needsUpdate = true;
    scene.add(q); U.drMode.value = 1; r.setRenderTarget(null);
    try { stylePass(r, scene, camera, 0, { clear: [U.drPaper.value.r, U.drPaper.value.g, U.drPaper.value.b, 1] }); } finally { U.drMode.value = 0; scene.remove(q); U.drScreen.value = 0; }
    const g = ctx; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.glc, 0, 0); this.stats.pass = Math.round(performance.now() - t1);
    let aov = null; const t2 = performance.now();
    if (R.line || M.ground !== false) aov = this.aov(scene, camera, M.aovK ?? 1);   // full resolution: a half-res AOV stair-steps the contour on a big stage
    if (M.ground !== false) this._ground(g, hs, camera, M, aov);
    if (R.line) drawLines(g, aov, { ...R.line, weight: (R.line.weight ?? 2) * Math.min(2.5, Math.max(0.4, k)) ** 0.6 / (W / 1080), level: levelOf(R), heroes: hs, camera, key: R.line.uniform ? new THREE.Vector3(0, 0, 0) : U.drKey.value, ink: R.line.ink || M.lineInk || M.ink });
    this.stats.lines = Math.round(performance.now() - t2);
    g.restore(); this.stats.total = Math.round(performance.now() - t0);
    return { ms: this.stats.total, pass: this.stats.pass, lines: this.stats.lines };
  }
  // a drawn cast shadow under each figure: ruled strokes (hatch, litho), a smudge (conte), dots (dither); none for ligne claire.
  // It lies on the ground (projected footprint), so it is as still as the ground; the figure is masked out of it.
  _ground(g, hs, camera, M, aov) {
    const kind = M.draw ?? 1; if (kind === 5) return;
    const W = this.W, H = this.H, S = H / 1080, c = Object.assign(document.createElement('canvas'), { width: W, height: H }), cg = c.getContext('2d');
    const pj = p => { const v = p.clone().project(camera); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H]; };
    cg.strokeStyle = cg.fillStyle = M.ink || '#15110f';
    for (const h of hs) {
      const f = h.joint('foot.L').add(h.joint('foot.R')).multiplyScalar(0.5); f.y = 0; const side = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
      const sun = DRAW_U.drKey.value.clone().transformDirection(camera.matrixWorld); const off = new THREE.Vector3(-sun.x, 0, -sun.z).multiplyScalar(0.18);
      const a = pj(f.clone().add(off).addScaledVector(side, -0.3)), b = pj(f.clone().add(off).addScaledVector(side, 0.3)), cpt = pj(f.clone().add(off)), d = pj(f.clone().add(off).add(new THREE.Vector3(0, 0, 0.12)));
      const rx = Math.abs(b[0] - a[0]) / 2, ry = Math.max(3 * S, Math.abs(d[1] - cpt[1]) * 1.6 + 4 * S), cx = cpt[0], cy = cpt[1];
      if (kind === 2) { const gr = cg.createRadialGradient(cx, cy, 0, cx, cy, rx); gr.addColorStop(0, 'rgba(20,18,16,0.38)'); gr.addColorStop(1, 'rgba(20,18,16,0)'); cg.save(); cg.translate(cx, cy); cg.scale(1, ry / rx); cg.translate(-cx, -cy); cg.fillStyle = gr; cg.beginPath(); cg.arc(cx, cy, rx, 0, Math.PI * 2); cg.fill(); cg.restore(); continue; }
      const sp = Math.max(3, 5 * S) * (kind === 3 ? 0.8 : 1), lw = Math.max(0.8, 1.1 * S) * (kind === 3 ? 1.8 : 1);
      if (kind === 4) { for (let y = -ry; y <= ry; y += 2) for (let x = -rx; x <= rx; x += 2) { const e = (x / rx) ** 2 + (y / ry) ** 2; if (e < 1 && ((x * 7 + y * 13 + (x * y) % 5) & 3) === 0 && hash2(Math.round(cx + x), Math.round(cy + y)) < 0.9 - e) cg.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1); } continue; }
      cg.lineWidth = lw; cg.lineCap = 'round';
      for (let y = -ry; y <= ry; y += sp) { const w = rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2)); if (w < 2) continue; cg.globalAlpha = 0.8 * (1 - Math.abs(y / ry) ** 2); cg.beginPath(); cg.moveTo(cx - w, cy + y); cg.lineTo(cx + w, cy + y); cg.stroke(); }
      cg.globalAlpha = 1;
    }
    if (aov) { const mk = figureMask(aov); cg.globalCompositeOperation = 'destination-out'; cg.drawImage(mk, 0, 0, W, H); }
    g.drawImage(c, 0, 0);
  }
  // per-pixel bind position (xyz, metres in the person's bind) and mesh id + 1 (w; 0 = nothing), rows top-down; float RT
  bindAOV(scene, camera, k = 1) {
    const w = Math.round(this.W * k), h = Math.round(this.H * k), r = this.r;
    if (!this._brt || this._brt.width !== w || this._brt.height !== h) { this._brt?.dispose(); this._brt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true }); }
    const buf = new Float32Array(w * h * 4), prev = r.getRenderTarget();
    DRAW_U.drMode.value = 2; r.setRenderTarget(this._brt);
    try { stylePass(r, scene, camera, 0, { clear: [0, 0, 0, 0] }); r.readRenderTargetPixels(this._brt, 0, 0, w, h, buf); } finally { DRAW_U.drMode.value = 0; r.setRenderTarget(prev); }
    const out = new Float32Array(w * h * 4); for (let y = 0; y < h; y++) out.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return { w, h, data: out };
  }
}

// motion coherence (Benard et al. 2011's criterion, measured): for two consecutive frames A, B (RGBA bytes) and their bind
// AOVs, each figure pixel of B is matched to the pixel of A showing the SAME point of the same mesh (bind position within tol
// metres); the residual |B(x) - A(x')| is what changed on the surface itself (flicker, swimming), the plain |B(x) - A(x)| is
// what changed on the screen (motion). A mark fixed to the body has a small residual whatever the motion. Matching is to the
// nearest pixel, so a fine high-contrast line pays a resampling floor (a half-pixel shift of a 3-pixel hatch): the residual is
// also given on both frames blurred by a 3 x 3 box ('blur'), which keeps the swimming of a texture and drops that floor.
export function coherence(imgA, imgB, aovA, aovB, { tol = 0.004, cell = 0.004 } = {}) {
  const { w, h } = aovA, A = aovA.data, B = aovB.data, grid = new Map(), hk = (cx, cy, cz, id) => (((cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791) ^ (id * 2654435761)) >>> 0);   // integer keys (a string Map was ~1 s a frame)
  for (let i = 0; i < w * h; i++) { if (A[i * 4 + 3] < 0.5) continue; const k = hk(Math.floor(A[i * 4] / cell), Math.floor(A[i * 4 + 1] / cell), Math.floor(A[i * 4 + 2] / cell), Math.round(A[i * 4 + 3])); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(i); }
  const lum = d => { const o = new Float32Array(w * h); for (let i = 0; i < w * h; i++) o[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255; return o; };
  const blur = a => { const o = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; s += a[yy * w + xx]; n++; } o[y * w + x] = s / n; } return o; };
  const la = lum(imgA), lb = lum(imgB), ba = blur(la), bb = blur(lb);
  let nRes = 0, sRes = 0, sResB = 0, nScr = 0, sScr = 0, sScrB = 0, still = 0, sStill = 0;
  for (let i = 0; i < w * h; i++) { if (B[i * 4 + 3] < 0.5) continue; const x = B[i * 4], y = B[i * 4 + 1], z = B[i * 4 + 2], id = Math.round(B[i * 4 + 3]);
    sScr += Math.abs(lb[i] - la[i]); sScrB += Math.abs(bb[i] - ba[i]); nScr++;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell); let best = -1, bd = tol * tol;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const l = grid.get(hk(cx + dx, cy + dy, cz + dz, id)); if (!l) continue;
      for (const j of l) { if (Math.round(A[j * 4 + 3]) !== id) continue; const d = (A[j * 4] - x) ** 2 + (A[j * 4 + 1] - y) ** 2 + (A[j * 4 + 2] - z) ** 2; if (d < bd) { bd = d; best = j; } } }
    if (best < 0) continue; const r = Math.abs(lb[i] - la[best]); sRes += r; sResB += Math.abs(bb[i] - ba[best]); nRes++;
    if (best === i) { still++; sStill += r; } }
  const q = (a, n) => n ? a / n : 0;
  return { residual: q(sRes, nRes), screen: q(sScr, nScr), residualBlur: q(sResB, nRes), screenBlur: q(sScrB, nScr), matched: q(nRes, nScr), n: nScr, stillPx: still, stillResidual: q(sStill, still) };
}
