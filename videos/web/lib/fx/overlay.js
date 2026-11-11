// OVERLAY: an offscreen transparent WebGL layer composited into a 2D scene canvas (TOOLING c8, 2026-09-29).
// Any scene that draws a WebGL/three.js character or object on top of (or between) canvas-2D layers needs the same
// scaffolding: a second canvas with a premultiplied-alpha context, a clear to transparent, a drawImage onto the scene's
// 2D context, and a plan for when SwiftShader loses the context under load (which killed a full-length MELTDOWN render).
// meltdown8_hero.js hand-rolled it; this is the shared version.
//
//   import { createOverlay, createThreeOverlay } from '../lib/fx/overlay.js';
//
//   // raw WebGL2
//   const ov = createOverlay(1080, 1920, { scale: 0.75 });     // scale < 1 renders smaller and upsamples (a soft layer)
//   ov.onRestore(gl => rebuildMyGLResources(gl));                // called after a lost context comes back; rebuild buffers here
//   ov.begin();                                                  // binds the default framebuffer, viewport, clears to (0,0,0,0)
//   ...draw with ov.gl, output PREMULTIPLIED colour (rgb*a, a)...
//   ov.composite(g, { alpha: 0.9, dx: 0, dy: 0 });               // g = the scene's 2D context; skips (and counts) while lost
//
//   // three.js
//   const t = createThreeOverlay(THREE, 1080, 1920, { scale: 1 });   // t.renderer, t.scene, t.camera (PerspectiveCamera)
//   t.render(g, { alpha: 1 });                                       // renders t.scene with t.camera, composites onto g
//
// Guarantees: transparent clear every frame; premultiplied blend ('source-over' by default, pass blend: 'lighter' etc.);
// no drawing while the context is lost (a lost context draws garbage or stale pixels) so a lost frame shows the 2D
// layers alone, and ov.stats.lostFrames says how many frames that was so a render can be redone; ov.alive() to test.
// Everything is a plain object with no scene state, so a scene may hold several overlays (hero + smoke).
export function createOverlay(W = 1080, H = 1920, o = {}) {
  const sc = o.scale ?? 1, RW = Math.max(1, Math.round(W * sc)), RH = Math.max(1, Math.round(H * sc));
  const cv = document.createElement('canvas'); cv.width = RW; cv.height = RH;
  const gl = cv.getContext('webgl2', { antialias: o.antialias ?? false, alpha: true, premultipliedAlpha: true,
    preserveDrawingBuffer: true, depth: o.depth ?? true, stencil: o.stencil ?? false });
  if (!gl) throw new Error('overlay: no webgl2');
  const ov = { canvas: cv, gl, width: RW, height: RH, stats: { frames: 0, lostFrames: 0, restores: 0 }, lost: false };
  const restoreFns = [];
  cv.addEventListener('webglcontextlost', e => { e.preventDefault(); ov.lost = true; });
  cv.addEventListener('webglcontextrestored', () => { ov.lost = false; ov.stats.restores++; for (const f of restoreFns) f(gl); });
  ov.alive = () => !ov.lost && !gl.isContextLost();
  ov.onRestore = f => { restoreFns.push(f); return ov; };
  ov.begin = (clear = [0, 0, 0, 0]) => {
    if (!ov.alive()) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, RW, RH); gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(...clear); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | (o.stencil ? gl.STENCIL_BUFFER_BIT : 0));
    return true;
  };
  ov.composite = (g, c = {}) => {
    ov.stats.frames++;
    if (!ov.alive()) { ov.stats.lostFrames++; return false; }
    g.save(); g.globalAlpha = c.alpha ?? 1; g.globalCompositeOperation = c.blend || 'source-over';
    if (c.smooth !== undefined) g.imageSmoothingEnabled = c.smooth;
    g.drawImage(cv, c.dx || 0, c.dy || 0, c.w ?? W, c.h ?? H); g.restore();
    return true;
  };
  ov.dispose = () => { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); restoreFns.length = 0; };
  return ov;
}

// three.js flavour: its own WebGLRenderer (alpha, premultiplied, preserved buffer) so the main scene's renderer, if any,
// is untouched. Pass the THREE namespace in (the scene imports it) so this module stays import-free.
export function createThreeOverlay(THREE, W = 1080, H = 1920, o = {}) {
  const sc = o.scale ?? 1, RW = Math.max(1, Math.round(W * sc)), RH = Math.max(1, Math.round(H * sc));
  const cv = document.createElement('canvas'); cv.width = RW; cv.height = RH;
  const renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, premultipliedAlpha: true, antialias: o.antialias ?? false,
    preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(RW, RH, false); renderer.setClearColor(0x000000, 0);
  if (o.toneMapping !== undefined) renderer.toneMapping = o.toneMapping;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(o.fov ?? 40, W / H, o.near ?? 0.1, o.far ?? 200);
  const t = { canvas: cv, renderer, scene, camera, width: RW, height: RH, stats: { frames: 0, lostFrames: 0, restores: 0 }, lost: false };
  cv.addEventListener('webglcontextlost', e => { e.preventDefault(); t.lost = true; });
  cv.addEventListener('webglcontextrestored', () => { t.lost = false; t.stats.restores++; });  // three re-uploads by itself
  t.alive = () => !t.lost && !renderer.getContext().isContextLost();
  t.render = (g, c = {}) => {
    t.stats.frames++;
    if (!t.alive()) { t.stats.lostFrames++; return false; }
    renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(scene, camera);
    g.save(); g.globalAlpha = c.alpha ?? 1; g.globalCompositeOperation = c.blend || 'source-over';
    g.drawImage(cv, c.dx || 0, c.dy || 0, c.w ?? W, c.h ?? H); g.restore();
    return true;
  };
  t.dispose = () => { renderer.dispose(); const x = renderer.getContext().getExtension('WEBGL_lose_context'); if (x) x.loseContext(); };
  return t;
}
