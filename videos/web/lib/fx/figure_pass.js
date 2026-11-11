// FIGURE PASS: one pose, three authored renderings (HUMAN studio, cycle 1).
// Any lit three.js material (MeshStandard / MeshPhysical / people.js / hero.js) is patched once with fpPatch(); the
// same scene can then render as
//   RIM    the HORDE silhouette grammar in 3D: near-black bodies, a crescent rim wherever a surface turns toward the
//          backlight (N.L from the light's direction, so the rim is where the light is, not an edge detector: no
//          sticker outlines), a warm terminator sliver, bloom through dust from the figure mask;
//   PRINT  a G-buffer for print.js (view normal + depth, metric object uv + subject) that respects every discard
//          (hems, hairlines) and custom skinning, so the engraver's lines, the woodcut gouges and the halftone screens
//          ride on the figures' own form;
//   LIT    the scene as lit (the patch is inert in mode 0).
//
//   import { fpPatch, FigurePass } from '../lib/fx/figure_pass.js';
//   scene.traverse(o => o.isMesh && fpPatch(o.material, { subject: o.userData.subject ?? 0 }));
//   const fp = new FigurePass(renderer, 540, 960);
//   const aux = fp.read(scene, camera);                       // -> print.js run opts { aux }
//   fp.rim(scene, camera, { light: sunWorldPos });            // renders the RIM mode into the renderer's canvas
import * as THREE from 'three';

export const FP = { mode: { value: 0 }, light: { value: new THREE.Vector3(0, 0, -1) }, rim: { value: new THREE.Color('#ffc79a') }, rim2: { value: new THREE.Color('#ff3a14') },
  body: { value: new THREE.Color('#0a0203') }, wrap: { value: 0.12 }, rimW: { value: 0.3 },
  // cycle 2: how much of the surface bump the rim reads (1 = all, as in cycle 1), the wrap and dust-bounce gains.
  // Crowds of people.js figures: rim(..., { bump: 0.25, wrapK: 0.05, bounce: 0.012 }) (no scan-line bands, no pale seat patch)
  bump: { value: 1 }, wrapK: { value: 0.35 }, bounce: { value: 0.08 } };

const FRAG_PARS = `uniform float fpMode, fpSubj, fpWrap, fpRimW, fpBump, fpWrapK, fpBounce; uniform vec2 fpUvS; uniform vec3 fpLight, fpRim, fpRim2, fpBody, fpSelf; varying vec2 fpUv;`;
const FRAG_OUT = `
  if (fpMode > 0.5) {
    vec3 fpN = normalize(normal);
    if (fpMode < 1.5) gl_FragColor = vec4(fpN, vViewPosition.z);
    else if (fpMode < 2.5) gl_FragColor = vec4(fpUv * fpUvS, fpSubj, 1.0);
    else {
      // RIM: the backlight grazes the side of the form that turns toward it; a thin hot core, a warm falloff, a
      // faint red wrap into the terminator, and the body almost black
      fpN = normalize(mix(fpGeoN, fpN, fpBump));   // cycle 2: crowds read the form, not the cloth bump (no scan-line bands)
      vec3 L = normalize(fpLight); float ndl = dot(fpN, L), fres = 1.0 - abs(fpN.z);
      float core = smoothstep(0.0, fpRimW, ndl) * pow(fres, 2.2);
      float wrap = smoothstep(-fpWrap, 0.2, ndl) * pow(fres, 3.0) * fpWrapK;
      vec3 c = fpBody + fpRim * core * 2.2 + fpRim2 * wrap;
      c += fpRim2 * fpBounce * smoothstep(0.2, -0.6, fpN.y);          // warm dust bounce from below
      c += fpSelf * (0.55 + 0.9 * max(0.0, -dot(fpN, L)) + core);    // cloth the sun shines through (a banner)
      gl_FragColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
    }
  }`;

// patch a lit material (chains any onBeforeCompile it already has). opts: subject (0..1), uvScale [su, sv]
export function fpPatch(mat, { subject = 1, uvScale = [1, 1], self = null } = {}) {
  if (!mat || mat.userData.fp) return mat;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  const U = { fpMode: FP.mode, fpLight: FP.light, fpRim: FP.rim, fpRim2: FP.rim2, fpBody: FP.body, fpWrap: FP.wrap, fpRimW: FP.rimW, fpBump: FP.bump, fpWrapK: FP.wrapK, fpBounce: FP.bounce, fpSubj: { value: subject }, fpSelf: { value: new THREE.Color(self || '#000000') }, fpUvS: { value: new THREE.Vector2(...uvScale) } };
  mat.userData.fp = U;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 fpUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nfpUv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS).replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nvec3 fpGeoN = normal;').replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + FRAG_OUT);
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '|fp';
  mat.needsUpdate = true;
  return mat;
}
export function fpPatchScene(scene, subjectOf = o => o.userData.subject ?? 0) {
  scene.traverse(o => { if (!o.isMesh || o.userData.gbuffer === false) return; const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) if (m && (m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial)) fpPatch(m, { subject: subjectOf(o), uvScale: o.userData.uvScale, self: o.userData.rimSelf }); });
}

export class FigurePass {
  constructor(renderer, width = 540, height = 960) {
    this.r = renderer; this.w = width; this.h = height;
    this.rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    this.nd = new Float32Array(width * height * 4); this.uvm = new Float32Array(width * height * 4);
  }
  _each(scene, fn) {           // hide what the pass cannot draw (unpatched materials, gbuffer:false)
    const hidden = [];
    scene.traverse(o => { if (!o.visible) return; const m = o.material; const ok = o.isMesh && o.userData.gbuffer !== false && (Array.isArray(m) ? m.every(x => x.userData.fp) : m && m.userData.fp);
      if ((o.isMesh || o.isLine || o.isPoints || o.isSprite) && !ok) { o.visible = false; hidden.push(o); } });
    const bg = scene.background, fog = scene.fog; scene.background = null; scene.fog = null;
    try { fn(); } finally { for (const o of hidden) o.visible = true; scene.background = bg; scene.fog = fog; }
  }
  _pass(scene, camera, mode, out) {
    const r = this.r, cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha(), sm = r.shadowMap.autoUpdate;
    FP.mode.value = mode; r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.rt); r.setClearColor(0x000000, 0); r.clear(); r.render(scene, camera);
    r.readRenderTargetPixels(this.rt, 0, 0, this.w, this.h, out);
    r.setRenderTarget(null); r.setClearColor(cc, ca); r.shadowMap.autoUpdate = sm; FP.mode.value = 0;
  }
  // G-buffer for print.js (rows bottom-up, as GL reads them and as gbuffer.js hands them over)
  read(scene, camera, { rangePct = [0.02, 0.98] } = {}) {
    const t0 = performance.now();
    this._each(scene, () => { this._pass(scene, camera, 1, this.nd); this._pass(scene, camera, 2, this.uvm); });
    const ds = []; for (let i = 3; i < this.nd.length; i += 16) if (this.nd[i] > 0) ds.push(this.nd[i]); ds.sort((a, b) => a - b);
    const range = ds.length ? [ds[Math.floor(ds.length * rangePct[0])], ds[Math.floor((ds.length - 1) * rangePct[1])]] : [1, 100];
    this.ms = performance.now() - t0;
    return { nd: this.nd, uvm: this.uvm, width: this.w, height: this.h, range };
  }
  // coverage mask (canvas, white = figure) from the last read(), for halos and grading
  mask(subjectOnly = true) {
    const c = document.createElement('canvas'); c.width = this.w; c.height = this.h; const g = c.getContext('2d'), im = g.createImageData(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { const i = (this.h - 1 - y) * this.w + x, o = y * this.w + x;
      const on = this.nd[i * 4 + 3] > 0 && (!subjectOnly || this.uvm[i * 4 + 2] > 0.5); im.data[o * 4] = im.data[o * 4 + 1] = im.data[o * 4 + 2] = 255; im.data[o * 4 + 3] = on ? 255 : 0; }
    g.putImageData(im, 0, 0); return c;
  }
  // RIM into the renderer's own canvas (transparent where there is no figure). light: world position of the sun
  rim(scene, camera, { light, rim, rim2, body, wrap, rimW, bump = 1, wrapK = 0.35, bounce = 0.08 } = {}) {
    FP.bump.value = bump; FP.wrapK.value = wrapK; FP.bounce.value = bounce;
    if (light) { const v = light.clone().applyMatrix4(camera.matrixWorldInverse); FP.light.value.copy(v).normalize(); }
    if (rim) FP.rim.value.set(rim); if (rim2) FP.rim2.value.set(rim2); if (body) FP.body.value.set(body); if (wrap != null) FP.wrap.value = wrap; if (rimW != null) FP.rimW.value = rimW;
    const r = this.r, cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha(), tm = r.toneMapping;
    this._each(scene, () => { FP.mode.value = 3; r.toneMapping = THREE.NoToneMapping; r.setClearColor(0x000000, 0); r.clear(); r.render(scene, camera); });
    FP.mode.value = 0; r.toneMapping = tm; r.setClearColor(cc, ca);
  }
}

// 2D helpers for the RIM composite (canvas 2D, 1080x1920)
export function haloFrom(g, maskCanvas, { color = '#ff3a14', color2 = '#ffc79a', blur = 40, alpha = 0.8, W = 1080, H = 1920 } = {}) {
  const t = document.createElement('canvas'); t.width = W; t.height = H; const tg = t.getContext('2d');
  tg.drawImage(maskCanvas, 0, 0, W, H); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = color; tg.fillRect(0, 0, W, H);
  g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = alpha; g.filter = `blur(${blur}px)`; g.drawImage(t, 0, 0);
  tg.globalCompositeOperation = 'source-in'; tg.fillStyle = color2; tg.fillRect(0, 0, W, H);
  g.globalAlpha = alpha * 0.6; g.filter = `blur(${Math.round(blur / 4)}px)`; g.drawImage(t, 0, 0); g.restore();
}
