// ERECT stage (MODELING c4): light with a value structure. Low sun through haze, a sky with a bright horizon and a darker top,
// shadows that are long, aerial perspective that grows with distance and is thicker near the ground (steam, frost haze), and
// a warm in-scatter toward the sun so a dark frame stands against a lit sky.
//
// Why: c3's frames all sat between 0.3 and 0.65 brightness (sky, ground and giant the same grey), so the giant read as a cutout
// and the people vanished. The party's painting is the opposite: light ground, light warm sky, dark masses, small dark people.
//
//   const S = new Stage(renderer, { W, H, sun: { az: 200, el: 9 } });  S.dress(scene);  S.fitShadow(center, radius);
//   S.render(scene, camera, ctx2d, t)    (RenderPass -> Atmos (depth) -> Bloom -> Output (AgX) -> grain/vignette in 2D)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { rng } from './members.js';

const d2r = Math.PI / 180, C = h => new THREE.Color(h);
export function sunDir(az, el) { const a = az * d2r, e = el * d2r; return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)); }   // az 0 = +z (toward camera side), 90 = +x

// ---------------------------------------------------------------- sky (equirect canvas) and its environment
export function skyTexture({ az = 200, el = 9, zenith = '#4a5d74', upper = '#7f92a8', horizon = '#f2c891', away = '#c2c3c0', ground = '#8a8478', sunCol = '#fff2d8', glow = '#ffcf8f', clouds = 1, seed = 3, W = 2048, H = 1024 } = {}) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), R = rng(seed);
  const sd = sunDir(az, el), su = (Math.atan2(sd.z, sd.x) / (2 * Math.PI) + .5), sv = Math.asin(sd.y) / Math.PI + .5, sx = su * W, sy = (1 - sv) * H, hy = H / 2;
  // vertical gradient, then a warm horizon band that is strongest under the sun
  let gr = g.createLinearGradient(0, 0, 0, hy); gr.addColorStop(0, zenith); gr.addColorStop(.55, upper); gr.addColorStop(.92, away); gr.addColorStop(1, away);
  g.fillStyle = gr; g.fillRect(0, 0, W, hy + 2);
  for (let k = -1; k <= 1; k++) { const x = sx + k * W, rg = g.createRadialGradient(x, hy, 10, x, hy, W * .42); rg.addColorStop(0, horizon); rg.addColorStop(.5, horizon + '88'); rg.addColorStop(1, horizon + '00'); g.save(); g.scale(1, .42); g.fillStyle = rg; g.fillRect(x - W * .5, 0, W, (hy + 4) / .42); g.restore(); }
  // the sun's glow (wide, then tight)
  for (let k = -1; k <= 1; k++) { const x = sx + k * W; let rg = g.createRadialGradient(x, sy, 2, x, sy, 420); rg.addColorStop(0, glow + 'ee'); rg.addColorStop(.25, glow + '66'); rg.addColorStop(1, glow + '00'); g.fillStyle = rg; g.fillRect(x - 440, sy - 440, 880, 880);
    rg = g.createRadialGradient(x, sy, 1, x, sy, 26); rg.addColorStop(0, '#ffffff'); rg.addColorStop(.35, sunCol); rg.addColorStop(1, sunCol + '00'); g.fillStyle = rg; g.fillRect(x - 30, sy - 30, 60, 60); }
  // cloud bands: long low stratus lit from below near the sun, darker away from it
  if (clouds) for (let i = 0; i < 260 * clouds; i++) {
    const y = hy * (.18 + .8 * Math.pow(R(), .7)), x = R() * W, w = 80 + R() * 520 * (y / hy), h = 3 + R() * 18 * (y / hy), du = Math.abs(((x - sx) / W + 1.5) % 1 - .5) * 2, lit = Math.max(0, 1 - du * 2.2) * (y / hy);
    const a = .05 + R() * .12; g.fillStyle = lit > .15 && R() < .7 ? `rgba(255,${200 + 40 * R() | 0},${150 + 50 * R() | 0},${a * (.6 + lit)})` : `rgba(${70 + 30 * R() | 0},${76 + 30 * R() | 0},${88 + 30 * R() | 0},${a})`;
    g.beginPath(); g.ellipse(x, y, w, h, 0, 0, 7); g.fill(); if (x + w > W) { g.beginPath(); g.ellipse(x - W, y, w, h, 0, 0, 7); g.fill(); }
  }
  // below the horizon: the ground's colour (the env's lower half: snow bounce)
  gr = g.createLinearGradient(0, hy, 0, H); gr.addColorStop(0, ground); gr.addColorStop(1, '#6e6a62'); g.fillStyle = gr; g.fillRect(0, hy, W, H - hy);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping; return t;
}

// ---------------------------------------------------------------- the aerial perspective pass (needs the scene depth)
class AtmosPass extends Pass {
  constructor(o) {
    super(); this.needsSwap = true;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uFogCol: { value: C(o.fog || '#b9b8b2') }, uSunCol: { value: C(o.sunFog || '#f3c792') }, uDensity: { value: o.density ?? .0011 }, uFall: { value: o.fall ?? .02 },
        uSunPow: { value: o.sunPow ?? 6 }, uSunAmt: { value: o.sunAmt ?? .85 }, uSkyHaze: { value: o.skyHaze ?? .22 }, uMax: { value: o.max ?? .93 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: `uniform sampler2D tDiffuse, tDepth; uniform mat4 uProjInv, uCamWorld; uniform vec3 uCamPos, uSunDir, uFogCol, uSunCol; uniform float uDensity, uFall, uSunPow, uSunAmt, uSkyHaze, uMax; varying vec2 vUv;
        void main(){ vec4 c = texture2D(tDiffuse, vUv); float d = texture2D(tDepth, vUv).x; if (any(isnan(c)) || any(isinf(c))) c = vec4(uFogCol, 1.); c.rgb = min(c.rgb, vec3(60.));
          vec4 v = uProjInv * vec4(vUv * 2. - 1., d * 2. - 1., 1.); v /= v.w; vec3 wp = (uCamWorld * vec4(v.xyz, 1.)).xyz, ray = wp - uCamPos; float dist = length(ray); vec3 dir = ray / max(dist, 1e-3);
          float sun = pow(max(dot(dir, uSunDir), 0.), uSunPow), sun2 = pow(max(dot(dir, uSunDir), 0.), 40.);
          vec3 fc = uFogCol + uSunCol * (sun * uSunAmt + sun2 * .6);
          if (d >= .99999) { float hz = pow(1. - clamp(dir.y, 0., 1.), 8.); c.rgb = mix(c.rgb, fc, hz * uSkyHaze); }
          else { float b = uFall, dy = ray.y; float od = uDensity * exp(-b * max(uCamPos.y, 0.)) * dist * (abs(b * dy) > 1e-3 ? (1. - exp(-b * dy)) / (b * dy) : 1.);
            float f = min(1. - exp(-od), uMax); c.rgb = mix(c.rgb, fc, f); }
          gl_FragColor = c; }`,
      depthTest: false, depthWrite: false });
    this.fsq = new FullScreenQuad(this.mat); this.camera = null;
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.mat.uniforms, cam = this.camera; u.tDiffuse.value = readBuffer.texture; u.tDepth.value = readBuffer.depthTexture;
    cam.updateMatrixWorld(); u.uProjInv.value.copy(cam.projectionMatrixInverse); u.uCamWorld.value.copy(cam.matrixWorld); u.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.fsq.render(renderer);
  }
}

export class Stage {
  constructor(renderer, { W = 540, H = 960, sun = { az: 200, el: 9 }, sky = {}, atmos = {}, bloom = { strength: .35, radius: .5, threshold: .9 }, key = 3.4, hemi = [.9, '#a8b6c6', '#cfc8bc'], exposure = 1, shadowSize = 4096, grain = .06, vig = .34, samples = 4 } = {}) {
    this.r = renderer; this.W = W; this.H = H; this.o = { sun, sky, atmos, bloom, key, hemi, exposure, grain, vig };
    this.sunD = sunDir(sun.az, sun.el);
    const depthTexture = new THREE.DepthTexture(W, H); depthTexture.type = THREE.UnsignedIntType;
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples, depthTexture });
    this.comp = new EffectComposer(renderer, rt); this.comp.setPixelRatio(1); this.comp.setSize(W, H);
    this.rp = new RenderPass(null, null); this.atm = new AtmosPass(atmos); this.atm.mat.uniforms.uSunDir.value.copy(this.sunD);
    this.comp.addPass(this.rp); this.comp.addPass(this.atm);
    if (bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), bloom.strength, bloom.radius, bloom.threshold); this.comp.addPass(this.bloom); }
    this.comp.addPass(new OutputPass());
    renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = exposure; renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.shadowSize = shadowSize;
    this.grainC = document.createElement('canvas'); this.grainC.width = this.grainC.height = 256; { const g = this.grainC.getContext('2d'), d = g.createImageData(256, 256), R = rng(17); for (let i = 0; i < d.data.length; i += 4) { const v = 128 + (R() - .5) * 120; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); }
  }
  dress(scene) {
    const o = this.o, sky = skyTexture({ az: o.sun.az, el: o.sun.el, ...o.sky }); scene.background = sky; scene.backgroundIntensity = o.sky.intensity ?? 1;
    const pm = new THREE.PMREMGenerator(this.r); scene.environment = pm.fromEquirectangular(sky).texture; pm.dispose(); scene.environmentIntensity = o.sky.env ?? .55;
    const sun = new THREE.DirectionalLight(C(o.sun.col || '#ffd9a8'), o.key); sun.castShadow = true; sun.shadow.mapSize.set(this.shadowSize, this.shadowSize); sun.shadow.bias = -.00025; sun.shadow.normalBias = .06; sun.shadow.radius = 3;
    const hm = new THREE.HemisphereLight(C(o.hemi[1]), C(o.hemi[2]), o.hemi[0]);
    scene.add(sun, sun.target, hm); this.sun = sun; this.hemi = hm; this.scene = scene; return this;
  }
  // fit the sun's shadow frustum round a sphere (centre Vector3, radius)
  fitShadow(center, radius, { depth = 600 } = {}) {
    const s = this.sun, c = s.shadow.camera; s.target.position.copy(center); s.position.copy(center).addScaledVector(this.sunD, depth * .5);
    c.left = -radius; c.right = radius; c.top = radius; c.bottom = -radius; c.near = 1; c.far = depth; c.updateProjectionMatrix(); s.target.updateMatrixWorld(); s.updateMatrixWorld();
  }
  render(scene, camera, ctx, t = 0) {
    this.rp.scene = scene; this.rp.camera = camera; this.atm.camera = camera; this.comp.render();
    if (!ctx) return; const W = this.W, H = this.H; ctx.drawImage(this.r.domElement, 0, 0, W, H);
    const o = this.o; if (o.grain) { ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = o.grain; const s = Math.floor(t * 12) % 4; ctx.translate(s * 97, s * 61); ctx.fillStyle = ctx.createPattern(this.grainC, 'repeat'); ctx.fillRect(-s * 97, -s * 61, W, H); ctx.restore(); }
    if (o.vig) { const v = ctx.createRadialGradient(W / 2, H * .46, Math.min(W, H) * .35, W / 2, H / 2, Math.hypot(W, H) * .6); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(16,14,12,${o.vig})`); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H); }
  }
  dispose() { this.comp.renderTarget1.dispose(); this.comp.renderTarget2.dispose(); this.bloom?.dispose?.(); }
}
