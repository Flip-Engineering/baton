// LIKENESS / sss_pass (SKIN6, round 6): screen-space subsurface scattering for skin rev 6, installed on a LitRenderer (lib/fx/light/
// pipeline.js) from OUTSIDE: nothing in the light pipeline changes, and a renderer nobody installs this on renders exactly as before.
//
//   import { installSkinSSS } from '/web/lib/fx/likeness/sss_pass.js';
//   const S = installSkinSSS(lr, { width: 1 });     // lr = new LitRenderer(...) (StyleStage's stage.lr); people built with skin: { rev: 6 }
//   S.enabled = false;                              // per frame; S.uninstall() restores the renderer
//
// Design (Jimenez, Sundstedt and Gutierrez 2009 screen-space SSS; Jimenez et al. 2015 "Separable Subsurface Scattering"):
//  - each accumulated sub-frame, right after the pipeline's MAIN pass (the renderer's render() into lr.main), two extra draws:
//    B: the whole scene again with the rev-6 skin's diffuse switched off (skin.js likeSSSMode 1: the skin writes alpha = not-skin, so
//       1 - alpha is the skin's coverage, hair cards in front included); C: the rev-6 bodies alone writing their albedo (mode 2).
//    The skin's diffuse is then main - B exactly (everything else draws the same both times; blending is linear in the skin's value).
//  - the diffuse is divided by sqrt(albedo) (pre- and post-scatter texturing: half the pigment detail stays sharp, as the epidermis'
//    melanin over the scattering dermis does), blurred with a separable kernel built from d'Eon and Luebke's six-Gaussian skin profile
//    (GPU Gems 3 ch. 14; per channel: red reaches ~3 mm, blue ~0.3 mm) at the pixel's own scale (its depth from the pipeline's
//    prepass), depth-aware (a sample off the surface or off the skin falls back to the centre: Jimenez's follow-surface), then
//    multiplied by sqrt(albedo) and the coverage, and put back in place of the unscattered diffuse in lr.main.
//  - the profile is in millimetres on a real-size person (world metres); `width` scales it (1 = the measured profile).
// Costs: two scene draws (B is the whole scene; C the bodies only) and four full-screen passes a sub-frame. With no rev-6 body in the
// scene it does nothing. Off-screen helpers only: no new vertex attribute or varying on any material (skin.js reads uniforms only).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SSS6 } from './skin.js';

// d'Eon and Luebke 2007, "Advanced techniques for realistic real-time skin rendering" (GPU Gems 3, ch. 14): variance (mm^2), RGB weight
export const SKIN_PROFILE = [[0.0064, [0.233, 0.455, 0.649]], [0.0484, [0.100, 0.336, 0.344]], [0.187, [0.118, 0.198, 0.0]],
  [0.567, [0.113, 0.007, 0.007]], [1.99, [0.358, 0.004, 0.0]], [7.41, [0.078, 0.0, 0.0]]];

// the separable kernel: n taps at offsets o (mm) spaced quadratically (fine near the centre), weights = the 1D profile integrated over
// each tap's interval, normalised per channel; returns [[wr, wg, wb, o], ...]
export function sssKernel({ n = 25, range = 7.5, width = 1, profile = SKIN_PROFILE } = {}) {
  const half = (n - 1) / 2, off = [];
  for (let i = 0; i < n; i++) { const t = (i - half) / half; off.push(range * width * Math.sign(t) * t * t); }
  const g1 = (v, x) => Math.exp(-x * x / (2 * v)) / Math.sqrt(2 * Math.PI * v);
  const prof = x => [0, 1, 2].map(c => profile.reduce((s, [v, w]) => s + w[c] * g1(v * width * width, x), 0));
  const cdf = (x, c) => profile.reduce((s, [v, w]) => s + w[c] * 0.5 * (1 + erf(x / Math.sqrt(2 * v * width * width))), 0);
  const K = off.map((o, i) => { const a = i > 0 ? (o + off[i - 1]) / 2 : -Infinity, b = i < n - 1 ? (o + off[i + 1]) / 2 : Infinity;
    return [...[0, 1, 2].map(c => cdf(b, c) - cdf(a, c)), o]; });
  for (let c = 0; c < 3; c++) { const s = K.reduce((t, k) => t + k[c], 0); for (const k of K) k[c] /= s; }
  void prof; return K;
}
function erf(x) { const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)); }

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
// E = skin diffuse / (coverage sqrt(albedo)); alpha = the view depth (m) where skin, 0 elsewhere
const PREP = `varying vec2 vUv; uniform sampler2D tA, tB, tC, tPre;
void main() { vec4 B = texture2D(tB, vUv); float m = clamp(1.0 - B.a, 0.0, 1.0); vec3 D = max(texture2D(tA, vUv).rgb - B.rgb, 0.0);
  vec3 sa = sqrt(max(texture2D(tC, vUv).rgb, vec3(1e-3))); float iz = texture2D(tPre, vUv).a;
  gl_FragColor = (m > 0.98 && iz > 0.0) ? vec4(D / (m * sa), 1.0 / iz) : vec4(0.0); }`;   // (integration v6) m > 0.98: a pixel the skin only partly covers (MSAA on lr.main: the preview / draft tiers) is left unscattered; dividing by its coverage blew a 2 % pixel up x50 and the blur spread it as a halo. Without MSAA (clip, motion, film) m is 0 or 1 and nothing changes
const BLUR = (n, last) => `varying vec2 vUv; uniform sampler2D tIn${last ? ', tA, tB, tC' : ''}; uniform vec4 uK[${n}]; uniform vec2 uDir, uTexel; uniform float uPxM, uFollow${last ? ', uDbg' : ''};
void main() { vec4 c = texture2D(tIn, vUv);
  ${last ? 'vec4 A = texture2D(tA, vUv), B = texture2D(tB, vUv);' : ''}
  if (c.a <= 0.0) { gl_FragColor = ${last ? 'A' : 'c'};${last ? ' if (uDbg > 0.5) gl_FragColor = vec4(uDbg > 2.5 && uDbg < 4.5 ? (uDbg < 3.5 ? texture2D(tC, vUv).rgb : B.rgb) : vec3(uDbg > 1.5 && uDbg < 2.5 ? clamp(1.0 - B.a, 0.0, 1.0) : 0.0), 1.0);' : ''} return; }
  float z = c.a, pxmm = uPxM / z * 0.001; vec3 acc = vec3(0.0);
  for (int i = 0; i < ${n}; i++) { vec4 k = uK[i]; vec4 s = texture2D(tIn, vUv + uDir * uTexel * (k.a * pxmm));
    float tol = 0.0015 + uFollow * abs(k.a) * 0.001, ok = s.a > 0.0 ? 1.0 - smoothstep(tol, 2.0 * tol, abs(s.a - z)) : 0.0;
    acc += k.rgb * mix(c.rgb, s.rgb, ok); }
  ${last ? `float m = clamp(1.0 - B.a, 0.0, 1.0); vec3 D = max(A.rgb - B.rgb, 0.0), sa = sqrt(max(texture2D(tC, vUv).rgb, vec3(1e-3)));
  gl_FragColor = vec4(A.rgb - D + acc * sa * m, A.a);
  if (uDbg > 0.5) { vec3 C = texture2D(tC, vUv).rgb; gl_FragColor = vec4(uDbg < 1.5 ? D * 4.0 : uDbg < 2.5 ? vec3(m) : uDbg < 3.5 ? C : uDbg < 4.5 ? B.rgb : uDbg < 5.5 ? acc * sa * m * 4.0 : abs(acc * sa * m - D) * 8.0, 1.0); }` : 'gl_FragColor = vec4(acc, z);'} }`;
const COPY = 'varying vec2 vUv; uniform sampler2D tIn; void main() { gl_FragColor = texture2D(tIn, vUv); }';

export function installSkinSSS(lr, opts = {}) {
  const r = lr.renderer, W = lr.W, H = lr.H, n = opts.taps ?? 25, samples = lr.main.samples || 0;
  const rt = (o = {}) => new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, samples, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, ...o });
  const rtB = rt(), rtC = rt(), rtE = rt({ depthBuffer: false, samples: 0, type: THREE.FloatType }), rtH = rt({ depthBuffer: false, samples: 0, type: THREE.FloatType }), rtO = rt({ depthBuffer: false, samples: 0 });   // E and H float: the depth rides in alpha
  const q = (fs, u) => new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false }));
  const S = { enabled: true, width: opts.width ?? 1, follow: opts.follow ?? 1.5, keyScale: opts.keyScale ?? 0.5, stats: { frames: 0, ms: 0, bodies: 0 } };
  const kU = () => sssKernel({ n, range: opts.range ?? 7.5, width: S.width }).map(k => new THREE.Vector4(...k));
  const prepQ = q(PREP, { tA: { value: lr.main.texture }, tB: { value: rtB.texture }, tC: { value: rtC.texture }, tPre: { value: lr.pre.texture } });
  const bu = () => ({ tIn: { value: null }, uK: { value: kU() }, uDir: { value: new THREE.Vector2() }, uTexel: { value: new THREE.Vector2(1 / W, 1 / H) }, uPxM: { value: 1 }, uFollow: { value: S.follow } });
  const hQ = q(BLUR(n, false), bu()), vQ = q(BLUR(n, true), { ...bu(), uDbg: { value: 0 }, tA: { value: lr.main.texture }, tB: { value: rtB.texture }, tC: { value: rtC.texture } });
  const copyQ = q(COPY, { tIn: { value: rtO.texture } });
  let busy = false, kW = S.width;
  const bodies = scene => { const out = []; scene.traverse(o => { if (o.isMesh && o.material?.userData?.likeSkin6 && o.visible) out.push(o); }); return out; };
  function passes(scene, camera) {
    const B = bodies(scene); S.stats.bodies = B.length; if (!B.length) return;
    const t0 = performance.now(), cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha(), tgt = r.getRenderTarget();
    if (kW !== S.width) { kW = S.width; const k = kU(); hQ.material.uniforms.uK.value = k; vQ.material.uniforms.uK.value = k; }
    // B: the scene with the skin's diffuse off (alpha = not skin)
    SSS6.likeSSSMode.value = 1; r.setRenderTarget(rtB); r.setClearColor(0x000000, 1); r.clear(); orig.call(r, scene, camera);
    // C: the bodies' albedo, alone
    SSS6.likeSSSMode.value = 2; const hid = [], keep = new Set(B), bg = scene.background; scene.background = null;
    scene.traverse(o => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.visible && !keep.has(o)) { o.visible = false; hid.push(o); } });
    r.setRenderTarget(rtC); r.setClearColor(0x000000, 0); r.clear(); orig.call(r, scene, camera);
    for (const o of hid) o.visible = true; scene.background = bg; SSS6.likeSSSMode.value = 0;
    // scatter
    const pxm = camera.projectionMatrix.elements[5] * H / 2;
    r.setRenderTarget(rtE); prepQ.render(r);
    const hu = hQ.material.uniforms; hu.tIn.value = rtE.texture; hu.uDir.value.set(1, 0); hu.uPxM.value = pxm; hu.uFollow.value = S.follow; r.setRenderTarget(rtH); hQ.render(r);
    const vu = vQ.material.uniforms; vu.tIn.value = rtH.texture; vu.uDir.value.set(0, 1); vu.uPxM.value = pxm; vu.uFollow.value = S.follow; vu.uDbg.value = S.debug || 0; r.setRenderTarget(rtO); vQ.render(r);
    r.setRenderTarget(lr.main); copyQ.render(r);
    r.setRenderTarget(tgt); r.setClearColor(cc, ca);
    S.stats.frames++; S.stats.ms += performance.now() - t0;
  }
  const orig = r.render;
  r.render = function (scene, camera) {
    const tgt = this.getRenderTarget(); orig.call(this, scene, camera);
    if (!busy && S.enabled && tgt === lr.main && scene.isScene) { busy = true; try { passes(scene, camera); } finally { busy = false; SSS6.likeSSSMode.value = 0; } }
  };
  const lrRender = lr.render;
  lr.render = function (o) { SSS6.likeSSSOn.value = S.enabled ? 1 : 0; SSS6.likeKey.value.w = S.keyScale; try { return lrRender.call(this, o); } finally { SSS6.likeSSSOn.value = 0; } };
  S.uninstall = () => { r.render = orig; lr.render = lrRender; for (const t of [rtB, rtC, rtE, rtH, rtO]) t.dispose(); };
  S.targets = { rtB, rtC, rtE, rtH, rtO };
  return S;
}
