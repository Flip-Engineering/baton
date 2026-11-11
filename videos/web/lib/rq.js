// RQ (GRAPHICS 4.A, 8 Oct 2026): the offscreen render scale and the WebGL -> 2D copy, one place for every bare three.js scene
// (research/GRAPHICS_UPGRADE_20261008.md section 4.A). The scenes rendered their 3D at 0.5-0.8 of 1080x1920 and drew it up
// bilinear, most of them without forcing the GPU to finish first. The defaults stay exactly as they were; the change is opt-in:
//
//   import { RQ } from '../lib/rq.js';
//   const ADOPT = false;                        // flipped per scene in the commit that records its farm A/B (the piece's notes)
//   const SC = RQ.scale(0.75, ADOPT);           // ?sc= wins; else (adopted, or ?rq=1) on a hardware GPU: 1; else the legacy number
//   ...
//   RQ.present(ctx, glc, renderer.getContext());                 // the 3D copy: drawImage(glc, 0, 0, W, H) of ctx's canvas
//   RQ.present(ctx, glc, gl, { fence: true });                   // a scene that already fenced before its copy keeps doing so
//   gl_PointSize = clamp(...)${RQ.glslMul(RQ.k())};              // a fixed-pixel size, kept at its displayed size ('' at legacy)
//
// Knobs: the page query, or window.ACP_FX.rq = { sc, rq } set by an A/B variant page (videos/scripts/ab_variant.py) before the
// scene's module loads; the query wins.
//   ?sc=S   the offscreen scale, as the scenes that read it before did (scale only: the copy stays the legacy copy)
//   ?rq=1   preview adoption: what ADOPT = true gives: scale 1 on a hardware GPU, a 1-px readPixels fence before every copy
//           (the ladder.js:162 fix for black / stale frames on the farm), the copy drawn with imageSmoothingQuality 'high'
// With no knob and ADOPT false the scene's frames are what they were: its legacy scale, its own fence or none, its own 2D state,
// no extra WebGL context (the GPU probe runs only when adoption is asked for), no log line.
const Q = (() => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(''); } })();
const FX = (() => { try { return (globalThis.ACP_FX && globalThis.ACP_FX.rq) || {}; } catch (e) { return {}; } })();
const knob = k => (Q.has(k) ? Q.get(k) : FX[k] != null ? String(FX[k]) : null);
const on = (v => v != null && v !== '' && v !== '0' && v !== 'false')(knob('rq'));

let gpu = null;
function probeGPU() {                     // gary2036.js:30's test: a hardware renderer string (not SwiftShader / llvmpipe / software)
  try {
    const c = document.createElement('canvas'), g = c.getContext('webgl2') || c.getContext('webgl');
    if (!g) return false;
    const e = g.getExtension('WEBGL_debug_renderer_info'), r = e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '';
    const lose = g.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();          // the probe's context is not kept
    return !!e && !/swiftshader|llvmpipe|softpipe|software/i.test(r);
  } catch (e) { return false; }
}

export const RQ = {
  get gpu() { if (gpu === null) gpu = probeGPU(); return gpu; },
  on,                                     // ?rq=1 (or ACP_FX.rq.rq) on this page
  legacy: null, sc: null, adopted: false, why: 'legacy',
  // the offscreen scale for this page; records it, so k() and present() know the mode
  scale(legacy, adopted = false) {
    this.legacy = legacy; this.adopted = !!adopted;
    const s = knob('sc'), n = Number(s);
    if (s != null && s !== '' && n > 0) { this.sc = n; this.why = 'sc=' + s; }
    else if ((adopted || on) && this.gpu) { this.sc = 1; this.why = adopted ? 'adopted, GPU' : 'rq=1, GPU'; }
    else { this.sc = legacy; this.why = (adopted || on) ? 'no hardware GPU: legacy' : 'legacy'; }
    if (this.fine || this.sc !== legacy) console.log(`[rq] scale ${this.sc} (${this.why}; legacy ${legacy})${this.fine ? ', fence + smoothing high' : ''}`);
    return this.sc;
  },
  // adopted or previewed: the copy is fenced and smoothed 'high'
  get fine() { return this.adopted || on; },
  // displayed size / render size against legacy: fixed-pixel sizes (gl_PointSize clamps, 1-px lines) multiply by this; 1 at legacy
  k() { return this.sc && this.legacy ? this.sc / this.legacy : 1; },
  // a GLSL factor for k: '' when k is 1, so a legacy shader's source stays byte for byte what it was
  glslMul(k = this.k()) { return k === 1 ? '' : ` * ${k.toFixed(6)}`; },
  // the 3D copy. Legacy: exactly drawImage(src, x, y, w, h) with the caller's 2D state, after the scene's own fence if it had one.
  // Fine: a 1-px readPixels fence first (the GPU finishes the frame before the copy), then the copy at imageSmoothingQuality 'high'.
  present(ctx, src, gl, { fence = false, x = 0, y = 0, w = ctx.canvas.width, h = ctx.canvas.height } = {}) {
    if (fence || this.fine) { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    if (!this.fine) { ctx.drawImage(src, x, y, w, h); return; }
    const se = ctx.imageSmoothingEnabled, sq = ctx.imageSmoothingQuality;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, x, y, w, h);
    ctx.imageSmoothingEnabled = se; ctx.imageSmoothingQuality = sq;
  },
};
