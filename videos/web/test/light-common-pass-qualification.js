import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { LitRenderer as BaselineRenderer } from '../lib/fx/light/pipeline.baseline.js';
import { LitRenderer as CandidateRenderer } from '../lib/fx/light/pipeline.js';
import { litPatch } from '../lib/fx/light/patch.js';

const result = document.querySelector('#result');
const query = new URLSearchParams(location.search);
const benchmarkRequested = query.get('benchmark') === '1';
window.__farmPassReport = { status: 'running' };
window.addEventListener('error', event => {
  window.__farmPassReport = { status: 'failed', error: event.message || String(event.error) };
  result.textContent = JSON.stringify(window.__farmPassReport, null, 2);
});
window.addEventListener('unhandledrejection', event => {
  window.__farmPassReport = { status: 'failed', error: String(event.reason) };
  result.textContent = JSON.stringify(window.__farmPassReport, null, 2);
});
const classify = shader => shader.includes('uniform float uClamp, uKaris') ? 'down'
  : shader.includes('uniform sampler2D tIn, tAdd') ? 'up'
    : shader.includes('uniform sampler2D tAcc, tBloom') ? 'final'
      : shader.includes('uniform sampler2D tMain, tVol') ? 'composite'
        : shader.includes('float contact(vec3 p') ? 'sso'
          : shader.includes('for (int y = -2; y <= 2; y++)') ? 'sso-blur'
            : shader.includes('uniform float uMode, uGain') ? 'debug' : 'other';
const originalDraw = FullScreenQuad.prototype.render;
let drawLog = [];
FullScreenQuad.prototype.render = function (renderer) {
  drawLog.push(classify(this.material.fragmentShader));
  return originalDraw.call(this, renderer);
};

// Both imports need the same setup code; the renderer class is injected here to keep the scenes identical.
function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  document.body.appendChild(canvas);
  return canvas;
}
function setupRenderer(Renderer, K = 1, width = 48, height = 48) {
  const canvas = makeCanvas(width, height), scene = new THREE.Scene();
  const material = litPatch(new THREE.MeshStandardMaterial({ color: 0x887766, roughness: 0.62, metalness: 0.08 }));
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.1, 0.8), material));
  scene.add(new THREE.AmbientLight(0xffffff, 0.8), new THREE.DirectionalLight(0xffd9ae, 2.5));
  const sphereMaterial = litPatch(new THREE.MeshStandardMaterial({ color: 0x2986a8, roughness: 0.3, metalness: 0.18 }));
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.44, 24, 16), sphereMaterial);
  sphere.position.set(0.72, -0.36, 0.34); scene.add(sphere);
  const emitter = litPatch(new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 80, roughness: 0.4 }));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8), emitter);
  glow.position.set(-0.84, 0.43, 0.2); scene.add(glow);
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 50);
  camera.position.set(0.15, 0.12, 3.6); camera.lookAt(0, 0, 0);
  const rig = {
    lens: { bloom: 0, halation: 0, vignette: 0, grain: 0 }, look: {}, wb: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    atmos: { density: 0, enabled: false, height: 40, base: 0, albedo: 0.9, g: 0.55, maxDist: 20 },
    sunOn: false, sunDir: new THREE.Vector3(0, 1, 0),
    update() {}, jitter() {}, followCamera() {}, volumeLights() { return []; }, keyLight() { return null; },
  };
  return { renderer: new Renderer({ canvas, width, height, quality: { K, vol: 0.25, sso: 0.5, volSteps: 2, msaa: 0 } }), scene, camera, rig, canvas, width, height };
}
function pixels(ctx) {
  const gl = ctx.renderer.renderer.getContext(), data = new Uint8Array(ctx.width * ctx.height * 4);
  gl.readPixels(0, 0, ctx.width, ctx.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return data;
}
function equalPixels(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function count(log, kind) { return log.filter(x => x === kind).length; }
function hashPixels(data) {
  let h = 2166136261;
  for (const byte of data) { h ^= byte; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const baseline = setupRenderer(BaselineRenderer), candidate = setupRenderer(CandidateRenderer);
let overlayCalls = 0;
const cases = [
  { name: 'noSSO skips the SSO passes', opts: { noSSO: true }, expectCandidate: { sso: 0, 'sso-blur': 0, down: 6, up: 5 } },
  { name: 'sso debug preserves the SSO passes when noSSO is set', opts: { noSSO: true, debug: 'sso' }, expectCandidate: { sso: 1, 'sso-blur': 1, down: 0, up: 0 } },
  { name: 'overlay hook retains its SSO input', opts: { noSSO: true, overlay(_renderer, lr) { overlayCalls++; if (!lr.sso2?.texture) throw new Error('overlay SSO target unavailable'); } }, expectCandidate: { sso: 1, 'sso-blur': 1, down: 6, up: 5 } },
  { name: 'undefined options retain configured lens effects', opts: {}, expectCandidate: { sso: 1, 'sso-blur': 1, down: 6, up: 5 } },
  { name: 'post zeros override nonzero rig lens', opts: { noSSO: true, post: { bloom: 0, halation: 0 } }, expectCandidate: { sso: 0, 'sso-blur': 0, down: 0, up: 0 }, lens: { bloom: 0.04, halation: 0.25 } },
  { name: 'nonzero post enables the chain after a zero frame', opts: { noSSO: true, post: { bloom: 0.18, halation: 0.3 } }, expectCandidate: { sso: 0, 'sso-blur': 0, down: 6, up: 5 }, lens: { bloom: 0, halation: 0 } },
  { name: 'post values override rig lens zeros', opts: { noSSO: true, post: { bloom: 0.5, halation: 0.2 } }, expectCandidate: { sso: 0, 'sso-blur': 0, down: 6, up: 5 }, lens: { bloom: 0, halation: 0 } },
  { name: 'exact-zero guard keeps null values on the existing chain', opts: { noSSO: true, post: { bloom: null, halation: 0 } }, expectCandidate: { sso: 0, 'sso-blur': 0, down: 6, up: 5 }, lens: { bloom: 0, halation: 0 } },
];

const report = [];
let zeroPixels, enabledPixels;
for (const [index, test] of cases.entries()) {
  const lens = { bloom: 0.04, halation: 0.25, vignette: 0, grain: 0, ...test.lens };
  baseline.rig.lens = { ...lens };
  candidate.rig.lens = { ...lens };
  drawLog = [];
  const baselineStart = performance.now();
  baseline.renderer.render({ scene: baseline.scene, camera: baseline.camera, rig: baseline.rig, t: index / 30, sync: false, ...test.opts });
  const baselineDraws = [...drawLog], baselinePixels = pixels(baseline), baselineMs = performance.now() - baselineStart;
  drawLog = [];
  const candidateStart = performance.now();
  candidate.renderer.render({ scene: candidate.scene, camera: candidate.camera, rig: candidate.rig, t: index / 30, sync: false, ...test.opts });
  const candidateDraws = [...drawLog], candidatePixels = pixels(candidate), candidateMs = performance.now() - candidateStart;
  const pixelMatch = equalPixels(baselinePixels, candidatePixels);
  const drawMatch = Object.entries(test.expectCandidate).every(([kind, expected]) => count(candidateDraws, kind) === expected);
  if (!pixelMatch || !drawMatch) throw new Error(`${test.name}: pixels=${pixelMatch}, draws=${drawMatch}, baseline=${JSON.stringify(baselineDraws)}, candidate=${JSON.stringify(candidateDraws)}`);
  const rgbPixels = Array.from({ length: 48 * 48 }, (_, i) => candidatePixels.slice(i * 4, i * 4 + 3));
  if (!rgbPixels.some(rgb => rgb.some(v => v > 0)) || new Set(rgbPixels.map(rgb => rgb.join(','))).size < 8) throw new Error(`${test.name}: test image was black or lacked scene variation`);
  if (test.name === 'undefined options retain configured lens effects') enabledPixels = candidatePixels;
  if (test.name === 'post zeros override nonzero rig lens') zeroPixels = candidatePixels;
  report.push({ name: test.name, pixelMatch, baselineMs, candidateMs, baseline: { sso: count(baselineDraws, 'sso'), ssoBlur: count(baselineDraws, 'sso-blur'), down: count(baselineDraws, 'down'), up: count(baselineDraws, 'up') }, candidate: { sso: count(candidateDraws, 'sso'), ssoBlur: count(candidateDraws, 'sso-blur'), down: count(candidateDraws, 'down'), up: count(candidateDraws, 'up') } });
}
if (overlayCalls !== 2) throw new Error(`overlay hook call count was ${overlayCalls}, expected 2`);
if (equalPixels(enabledPixels, zeroPixels)) throw new Error('enabled bloom and halation produced the same pixels as disabled effects');

// Check state recovery over a nonzero -> zero -> nonzero effect sequence on each renderer.
for (const [i, bloom] of [0.24, 0, 0.17].entries()) {
  const opts = { noSSO: true, post: { bloom, halation: bloom ? 0.2 : 0 } };
  for (const ctx of [baseline, candidate]) {
    ctx.rig.lens = { bloom: 0, halation: 0, vignette: 0, grain: 0 };
    drawLog = [];
    ctx.renderer.render({ scene: ctx.scene, camera: ctx.camera, rig: ctx.rig, t: 1 + i / 30, sync: false, ...opts });
    if (ctx === baseline) var seqBaseline = pixels(ctx); else {
      var seqCandidate = pixels(ctx);
      if (count(drawLog, 'down') !== (bloom === 0 ? 0 : 6) || count(drawLog, 'up') !== (bloom === 0 ? 0 : 5)) throw new Error(`candidate alternating effect frame ${i} had stale draw state`);
    }
  }
if (!equalPixels(seqBaseline, seqCandidate)) throw new Error(`alternating effects frame ${i} changed pixels`);
}

const freshBaseline = setupRenderer(BaselineRenderer), freshCandidate = setupRenderer(CandidateRenderer);
for (const ctx of [freshBaseline, freshCandidate]) {
  ctx.rig.lens = { bloom: 0, halation: 0, vignette: 0, grain: 0 };
  drawLog = [];
  ctx.renderer.render({ scene: ctx.scene, camera: ctx.camera, rig: ctx.rig, t: 2, sync: false, noSSO: true, post: { bloom: 0, halation: 0 } });
  if (ctx === freshBaseline) var freshBasePixels = pixels(ctx); else {
    var freshCandidatePixels = pixels(ctx);
    if (count(drawLog, 'down') !== 0 || count(drawLog, 'up') !== 0 || count(drawLog, 'sso') !== 0 || count(drawLog, 'sso-blur') !== 0) throw new Error('fresh candidate performed disabled draws');
  }
}
if (!equalPixels(freshBasePixels, freshCandidatePixels)) throw new Error('fresh zero-first render changed pixels');

const k12Baseline = setupRenderer(BaselineRenderer, 12), k12Candidate = setupRenderer(CandidateRenderer, 12);
for (const ctx of [k12Baseline, k12Candidate]) {
  ctx.rig.lens = { bloom: 0, halation: 0, vignette: 0, grain: 0 };
  drawLog = [];
  ctx.renderer.render({ scene: ctx.scene, camera: ctx.camera, rig: ctx.rig, t: 3, sync: false, noSSO: true, post: { bloom: 0, halation: 0 } });
  if (ctx === k12Baseline) var k12BasePixels = pixels(ctx); else {
    var k12CandidatePixels = pixels(ctx);
    if (count(drawLog, 'sso') || count(drawLog, 'sso-blur') || count(drawLog, 'down') || count(drawLog, 'up')) throw new Error('K=12 candidate performed disabled draws');
  }
}
if (!equalPixels(k12BasePixels, k12CandidatePixels)) throw new Error('K=12 zero-effects pixels changed');

const device = (() => {
  const gl = candidate.renderer.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
})();
let benchmark = null;
if (benchmarkRequested) {
  const width = Number(query.get('width') || 1080), height = Number(query.get('height') || 1920);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 64 || height < 64 || width > 2048 || height > 3072) throw new Error(`invalid benchmark dimensions ${width}x${height}`);
  const fullBase = setupRenderer(BaselineRenderer, 12, width, height), fullCandidate = setupRenderer(CandidateRenderer, 12, width, height);
  const scenarios = [
    { name: 'disabled-sso-and-bloom', opts: { noSSO: true, post: { bloom: 0, halation: 0 } }, expected: { sso: 0, 'sso-blur': 0, down: 0, up: 0 } },
    { name: 'fully-enabled-sso-and-bloom', opts: { noSSO: false, post: { bloom: 0.24, halation: 0.2 } }, expected: { sso: 12, 'sso-blur': 12, down: 6, up: 5 } },
  ];
  const runFullFrame = (ctx, opts, t) => {
    drawLog = [];
    const start = performance.now();
    ctx.renderer.render({ scene: ctx.scene, camera: ctx.camera, rig: ctx.rig, t, sync: false, ...opts });
    const data = pixels(ctx), elapsedMs = performance.now() - start, draws = [...drawLog];
    return { data, elapsedMs, hash: hashPixels(data), draws };
  };
  const pairs = [];
  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    fullBase.rig.lens = { bloom: 0, halation: 0, vignette: 0, grain: 0 };
    fullCandidate.rig.lens = { bloom: 0, halation: 0, vignette: 0, grain: 0 };
    const warmOrder = scenarioIndex === 0 ? [fullBase, fullCandidate] : [fullCandidate, fullBase];
    for (const ctx of warmOrder) runFullFrame(ctx, scenario.opts, 10 + scenarioIndex / 30);
    for (let i = 0; i < 7; i++) {
      const first = i % 2 === 0 ? fullBase : fullCandidate, second = first === fullBase ? fullCandidate : fullBase;
      const firstRun = runFullFrame(first, scenario.opts, 11 + i / 30), secondRun = runFullFrame(second, scenario.opts, 11 + i / 30);
      const baseRun = first === fullBase ? firstRun : secondRun, candidateRun = first === fullCandidate ? firstRun : secondRun;
      const pixelMatch = equalPixels(baseRun.data, candidateRun.data);
      const drawMatch = Object.entries(scenario.expected).every(([kind, expected]) => count(candidateRun.draws, kind) === expected);
      if (!pixelMatch || !drawMatch) throw new Error(`full-size ${scenario.name} pair ${i}: pixels=${pixelMatch}, draws=${drawMatch}`);
      pairs.push({ scenario: scenario.name, iteration: i, order: first === fullBase ? 'baseline-first' : 'candidate-first', baselineMs: baseRun.elapsedMs, candidateMs: candidateRun.elapsedMs, baselineHash: baseRun.hash, candidateHash: candidateRun.hash, pixelMatch, candidateDraws: scenario.expected });
      firstRun.data = null; secondRun.data = null;
    }
  }
  for (const ctx of [fullBase, fullCandidate]) { ctx.renderer.renderer.dispose(); ctx.renderer.renderer.forceContextLoss(); ctx.canvas.remove(); }
  benchmark = { width, height, K: 12, warmupPairsPerScenario: 1, measuredPairsPerScenario: 7, scene: 'procedural box, sphere, and HDR emitter', pairs };
}
for (const ctx of [baseline, candidate, freshBaseline, freshCandidate, k12Baseline, k12Candidate]) {
  ctx.renderer.renderer.dispose();
  ctx.renderer.renderer.forceContextLoss();
}
FullScreenQuad.prototype.render = originalDraw;
document.querySelectorAll('canvas').forEach(x => x.remove());
window.__farmPassReport = { status: 'passed', device, browser: navigator.userAgent, cases: report, alternating: 'nonzero -> zero -> nonzero pixels match', freshZeroFirst: 'pixels match; disabled draw counts are zero', K12: 'pixels match; disabled draw counts are zero', ...(benchmark ? { benchmark } : {}) };
result.textContent = JSON.stringify(window.__farmPassReport, null, 2);
