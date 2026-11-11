// RELIGHT (WORLDS studio c2): bake a world once as a relightable 2.5D plate, then play its EVENTS as light, not as re-renders.
//
// Why: in c1 every event frame (a lightning flash, a flood switching on) re-marched the cloud volume and re-rendered the
// whole world (5-9 s a frame, 17-120 s for the first), and the storm's flash was a point light inside the cloud with a
// tiny ambient term on the land, so it never landed. Here (Nubis + the matte-painting method + compositing light AOVs):
//
//   plate   the world WITHOUT its live layer, rendered N times with sub-pixel and cloud-march jitter (blue-noise R2
//           offsets) and averaged: the dither along every density edge is gone, and the frame is paid for once.
//   layers  each event light is baked as its own light layer, by linear superposition: layer = R(rig at 1) - R(rig at 0)
//           with the same jitter, so fog, sky and noise cancel exactly and only that light's contribution remains
//           (the directional lightning key on the land and the elevator, the flash inside the cloud base, the floods,
//           a red lamp). A directional layer can carry a screen-space hard shadow marched on the plate's depth.
//   live    only the near layer (wheat, trucks, figures, the bolt channel, sprites) renders per frame, depth-tested
//           against the plate (the plate depth is written into the depth buffer first, reprojected for a small push).
//   frame   plate(t) = base + sum_k w_k(t) * layer_k, value-planned (dodge / burn bands, authored per shot), then the
//           live layer, the overlay, bloom and the look's grade exactly as Atmos.render does.
//
//   import { Relight, strikeEnvelope, Channel } from '../lib/fx/relight.js';
//   const R = new Relight(world.atmos, { clouds: [shelf] });
//   R.live(wheat.mesh);                                              // per-frame objects
//   R.layer('flash', { set: k => { ... } , shadow: { dir: [x, y, z], max: 300 } });   // the rig at intensity k (0 = off)
//   R.plan = [{ kind: 'rows', y0: 0, y1: 0.38, gain: 0.35, feather: 0.12 }];           // value plan (screen or depth bands)
//   await R.bake(cam, t, { n: 8, nLayer: 4 });                       // once per shot (or per camera move)
//   R.w.flash = 1.0; R.render(cam, t);                                // per frame: event weights drive the layers
//
// Backward compatible: nothing here touches Atmos unless a scene builds a Relight; atmos.render() is unchanged.
import * as THREE from 'three';

const Q_V = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
const R2 = i => [((0.5 + i * 0.7548776662) % 1) - 0.5, ((0.5 + i * 0.5698402909) % 1) - 0.5];   // R2 low-discrepancy (blue-noise-like) offsets

// the lightning return-stroke stutter at 30 fps (Arizona ATMO 489; ALDIS): 3-5 strokes 40-80 ms apart, with the
// channel glowing between them. Frame 0 = the first return stroke (the hit). The residuals keep the drop after the hit
// smaller than the hit itself, so the impact frame stays >= 1.5x its neighbours (LOOKS c1 rule).
export const STRIKE = [1.0, 0.42, 0.62, 0.8, 0.3, 0.36, 0.12, 0.05];
export function strikeEnvelope(t, hitT, fps = 30, pulses = STRIKE) { const f = Math.round((t - hitT) * fps); return f >= 0 && f < pulses.length ? pulses[f] : 0; }
// the channel is visible on the stroke frames only (a channel glowing between strokes is the residual)
export function channelEnvelope(t, hitT, fps = 30) { const f = Math.round((t - hitT) * fps); return [1, 0.5, 0.85, 1, 0.2, 0.45, 0, 0][f] ?? 0; }

export class Relight {
  constructor(atmos, { clouds = [], scale = 1 } = {}) {
    const A = this.A = atmos, w = A.w, h = A.h;
    this.clouds = clouds; this.lives = []; this.layers = {}; this.w = {}; this.plan = []; this.stats = {};
    const T = () => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.acc = [T(), T()]; this.base = T(); this.tmp = T();
    this.dist = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, depthBuffer: false });
    this.bakeCam = new THREE.PerspectiveCamera(); this.baked = false;
    this.accMat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, uniforms: { tA: { value: null }, tS: { value: null }, uK: { value: 1 } }, vertexShader: Q_V,
      fragmentShader: 'uniform sampler2D tA, tS; uniform float uK; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tA, vUv).rgb + uK * texture2D(tS, vUv).rgb, 1.); }' });
    this.clearMat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, vertexShader: Q_V, fragmentShader: 'void main(){ gl_FragColor = vec4(0.); }' });
    this.distMat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, uniforms: { tDepth: A.frameU.tDepth, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() } }, vertexShader: Q_V,
      fragmentShader: `uniform sampler2D tDepth; uniform mat4 uInvProj, uCamWorld; varying vec2 vUv;
        void main(){ float d = texture2D(tDepth, vUv).r; if (d >= 1.) { gl_FragColor = vec4(1e7, 1., 0., 1.); return; }
          vec4 vp = uInvProj * vec4(vUv*2.-1., d*2.-1., 1.); vp /= vp.w; vec3 wp = (uCamWorld * vp).xyz;
          gl_FragColor = vec4(length(wp - uCamWorld[3].xyz), 0., wp.y, 1.); }` });
    // screen-space hard shadow for a directional layer: march from each plate point toward the light on the plate depth
    this.shadowMat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, vertexShader: Q_V,
      uniforms: { tL: { value: null }, tDist: { value: this.dist.texture }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uVP: { value: new THREE.Matrix4() },
        uDir: { value: new THREE.Vector3(0, 1, 0) }, uMax: { value: 300 }, uThick: { value: 80 }, uSoft: { value: 0.0 } },
      fragmentShader: `uniform sampler2D tL, tDist; uniform mat4 uInvProj, uCamWorld, uVP; uniform vec3 uDir; uniform float uMax, uThick, uSoft; varying vec2 vUv;
        vec3 worldAt(vec2 uv, float s){ vec4 vp = uInvProj * vec4(uv*2.-1., 1., 1.); vp /= vp.w; vec3 d = normalize((uCamWorld * vec4(vp.xyz, 0.)).xyz); return uCamWorld[3].xyz + d * s; }
        void main(){ vec3 L = texture2D(tL, vUv).rgb; float s = texture2D(tDist, vUv).r;
          if (s > 1e6 || dot(L, L) < 1e-10) { gl_FragColor = vec4(L, 1.); return; }
          vec3 P = worldAt(vUv, s), C = uCamWorld[3].xyz; float occ = 0.;
          for (int i = 1; i <= 64; i++) { float u = float(i) / 64.; vec3 Q = P + normalize(uDir) * (u * u * uMax + .4 + s * .002);
            vec4 c = uVP * vec4(Q, 1.); if (c.w <= 0.) break; vec2 q = c.xy / c.w * .5 + .5; if (q.x < 0. || q.y < 0. || q.x > 1. || q.y > 1.) break;
            float sp = texture2D(tDist, q).r, sq = length(Q - C);
            if (sp < sq - max(.6, sq * .004) && sq - sp < uThick) { occ = 1.; break; } }
          gl_FragColor = vec4(L * (1. - occ * (1. - uSoft)), 1.); }` });
    // per frame: the plate (reprojected to the live camera), its layers, the value plan -> HDR; the live layer over it
    this.U = { tBase: { value: this.base.texture }, tDist: { value: this.dist.texture }, tLive: { value: null }, tLiveA: { value: null },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uBakeVP: { value: new THREE.Matrix4() }, uBakePos: { value: new THREE.Vector3() },
      uVP: { value: new THREE.Matrix4() }, uNear: { value: 1 }, uFar: { value: 1000 },
      tL0: { value: null }, tL1: { value: null }, tL2: { value: null }, tL3: { value: null }, tL4: { value: null }, tL5: { value: null },
      uW: { value: [0, 0, 0, 0, 0, 0] }, uPlanN: { value: 0 }, uPlanA: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }, uPlanB: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uPlanC: { value: Array.from({ length: 8 }, () => new THREE.Vector3(1, 1, 1)) } };
    const REPROJ = `
      uniform sampler2D tDist; uniform mat4 uInvProj, uCamWorld, uBakeVP, uVP; uniform vec3 uBakePos;
      vec3 rayDir(vec2 uv){ vec4 vp = uInvProj * vec4(uv*2.-1., 1., 1.); vp /= vp.w; return normalize((uCamWorld * vec4(vp.xyz, 0.)).xyz); }
      vec2 bakeUV(vec3 p){ vec4 c = uBakeVP * vec4(p, 1.); return c.xy / c.w * .5 + .5; }
      // fixed-point reprojection (parallax-occlusion style): the plate point this live pixel sees, for small camera moves
      vec2 plateUV(vec2 uv, out float s){ vec3 C = uCamWorld[3].xyz, d = rayDir(uv); vec2 q = bakeUV(C + d * 1e6); s = texture2D(tDist, q).r;
        if (s > 1e6) return q;
        for (int i = 0; i < 4; i++) { float sc = max(s - dot(C - uBakePos, d), 1.); q = bakeUV(C + d * sc); s = texture2D(tDist, q).r; if (s > 1e6) return q; }
        s = max(s - dot(C - uBakePos, d), 1.); return q; }`;
    this.REPROJ = REPROJ;
    this.depthMat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: Q_V, depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth, colorWrite: false,
      fragmentShader: REPROJ + `varying vec2 vUv;
        void main(){ float s; vec2 q = plateUV(vUv, s); if (s > 1e6) { gl_FragDepthEXT = 1.; gl_FragColor = vec4(0.); return; }
          vec4 c = uVP * vec4(uCamWorld[3].xyz + rayDir(vUv) * s, 1.); gl_FragDepthEXT = clamp(c.z / c.w * .5 + .5, 0., .9999999); gl_FragColor = vec4(0.); }` });
    this.compMat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: Q_V, depthTest: false, depthWrite: false,
      fragmentShader: REPROJ + `
        uniform sampler2D tBase, tLive, tLiveA, tL0, tL1, tL2, tL3, tL4, tL5; uniform float uW[6]; uniform int uPlanN; uniform vec4 uPlanA[8], uPlanB[8]; uniform vec3 uPlanC[8]; varying vec2 vUv;
        // value plan: kind 0 = screen rows (y0, y1 from the top, feather), 1 = distance band (d0, d1 m), 2 = sky only, 3 = ground only below a row
        float planMask(int i, vec2 uv, float s){ vec4 a = uPlanA[i], b = uPlanB[i]; float y = 1. - uv.y, k = 0.;
          if (a.x < .5) k = smoothstep(b.x - b.z, b.x + b.z, y) * (1. - smoothstep(b.y - b.z, b.y + b.z, y));
          else if (a.x < 1.5) k = smoothstep(b.x * (1. - b.z), b.x, s) * (1. - smoothstep(b.y, b.y * (1. + b.z), s));
          else if (a.x < 2.5) k = s > 1e6 ? smoothstep(b.x - b.z, b.x + b.z, y) * (1. - smoothstep(b.y - b.z, b.y + b.z, y)) : 0.;
          else k = s < 1e6 ? smoothstep(b.x - b.z, b.x + b.z, y) * (1. - smoothstep(b.y - b.z, b.y + b.z, y)) : 0.;
          if (b.w > 0.) { float cx = abs(uv.x - a.z) / max(a.w, 1e-3); k *= 1. - smoothstep(1. - b.w, 1., cx); }       // optional x window (centre, half-width, feather)
          return k * a.y; }
        void main(){
          float s; vec2 q = plateUV(vUv, s);
          vec3 c = texture2D(tBase, q).rgb;
          c += uW[0] * texture2D(tL0, q).rgb + uW[1] * texture2D(tL1, q).rgb + uW[2] * texture2D(tL2, q).rgb
             + uW[3] * texture2D(tL3, q).rgb + uW[4] * texture2D(tL4, q).rgb + uW[5] * texture2D(tL5, q).rgb;
          c = max(c, vec3(0.));
          for (int i = 0; i < 8; i++) { if (i >= uPlanN) break; float k = planMask(i, vUv, s); if (k <= 0.) continue;
            float l = dot(c, vec3(.2126, .7152, .0722)); vec3 g = mix(vec3(l), c, uPlanC[i].y);                     // saturation
            c = mix(c, g * uPlanC[i].x, k); }                                                                      // exposure (gain)
          vec4 lv = texture2D(tLiveA, vUv);
          if (lv.a > .5) c = texture2D(tLive, vUv).rgb;
          gl_FragColor = vec4(c, 1.); }` });
    this.copyMat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, uniforms: { tA: { value: null } }, vertexShader: Q_V,
      fragmentShader: 'uniform sampler2D tA; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tA, vUv).rgb, 1.); }' });
  }
  live(...objs) { for (const o of objs) if (o && !this.lives.includes(o)) this.lives.push(o); return this; }
  // a light layer: set(k) puts the world's rig for this light at intensity k (0 = the same rig, light off); done()
  // restores the base rig. clouds: true when the layer lights a cloud volume (the march is re-run for it).
  layer(name, { set, done = () => {}, shadow = null, clouds = false, n = null } = {}) {
    const i = Object.keys(this.layers).length; if (i >= 6) throw new Error('relight: 6 layers max');
    const rt = new THREE.WebGLRenderTarget(this.A.w, this.A.h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.layers[name] = { i, set, done, shadow, clouds, n, rt }; this.U['tL' + i].value = rt.texture; this.w[name] = 0; return this;
  }
  _camera(cam) { const camera = this.A.camera;
    if (cam) { camera.position.set(...cam.pos); camera.up.set(Math.sin(cam.roll || 0), Math.cos(cam.roll || 0), 0); camera.lookAt(...cam.target);
      if (cam.fov && camera.fov !== cam.fov) { camera.fov = cam.fov; camera.updateProjectionMatrix(); } }
    camera.updateMatrixWorld(); return camera; }
  _vis(liveOnly) {       // liveOnly: true -> only the live objects render; false -> everything but them; null -> restore
    const S = this.A.scene;
    if (liveOnly === null) { for (const [o, v] of this._saved || []) o.visible = v; this._saved = null; return; }
    this._saved = []; const keep = new Set(this.lives);
    for (const o of S.children) { if (o.isLight) continue; const isLive = keep.has(o); this._saved.push([o, o.visible]); if (liveOnly ? !isLive : isLive) o.visible = false; }
    for (const o of this.lives) if (o.parent && o.parent !== S) { this._saved.push([o, o.visible]); if (!liveOnly) o.visible = false; }
  }
  // the scene -> fog -> mid (cloud volumes) part of Atmos.render into A.rtF
  _scene(camera, t) {
    const A = this.A, W = A.world, r = A.renderer, U = A.U;
    U.uCamPos.value.copy(camera.position); U.uTime.value = t; A._events(t);
    A.frameU.uNear.value = camera.near; A.frameU.uFar.value = camera.far;
    for (const f of W.onBefore) f(camera); for (const f of A.pre) f(A, camera, t);
    const tm = r.toneMapping; r.toneMapping = THREE.NoToneMapping; r.setClearColor(0x000000, 1);
    r.setRenderTarget(A.rtC); r.clear(); r.render(A.scene, camera);
    const FM = A.fogMat.uniforms; FM.uInvProj.value.copy(camera.projectionMatrixInverse); FM.uCamWorld.value.copy(camera.matrixWorld);
    A._pass(A.fogMat, A.rtF);
    for (const f of A.mid) f(A, camera, t);
    r.toneMapping = tm;
  }
  _accum(k) { const A = this.A, M = this.accMat.uniforms; M.tA.value = this.acc[0].texture; M.tS.value = A.rtF.texture; M.uK.value = k; A._pass(this.accMat, this.acc[1]); this.acc.reverse(); }
  _zero() { this.A._pass(this.clearMat, this.acc[0]); }
  _store(target, k = 1) { const M = this.accMat.uniforms; M.tA.value = this.acc[0].texture; M.tS.value = this.acc[0].texture; M.uK.value = k - 1; this.A._pass(this.accMat, target); }
  _jitter(camera, i, n) {
    const A = this.A, [jx, jy] = i === 0 ? [0, 0] : R2(i);
    camera.setViewOffset(A.w, A.h, jx, jy, A.w, A.h); camera.updateProjectionMatrix();
    for (const cv of this.clouds) { cv.U.uJit.value = i * 37.17 + 0.5; cv._key = null; }
  }
  _unjitter(camera) { camera.clearViewOffset(); camera.updateProjectionMatrix(); for (const cv of this.clouds) cv.U.uJit.value = 0; }
  // bake the plate and every layer for camera `cam` at time t. n: plate samples; nLayer: samples per cloud-lit layer
  bake(cam, t = 0, { n = 8, nLayer = 4, over = 1 } = {}) {
    const A = this.A, t0 = performance.now(), camera = this._camera(cam);
    const ev = A._events; A._events = () => {};                  // events drive the per-frame weights; they must not touch the rig while it is baked
    // overscan: the plate covers a wider field than the live camera so a drift or push never reprojects past its edge
    const fov0 = camera.fov; if (over !== 1) { camera.fov = 2 * Math.atan(Math.tan(fov0 * Math.PI / 360) * over) * 180 / Math.PI; camera.updateProjectionMatrix(); }
    this._vis(false);                                             // base rig: the scene as built (every event light off)
    this._zero();
    for (let i = 0; i < n; i++) { this._jitter(camera, i, n); this._scene(camera, t); this._accum(1 / n);
      if (i === 0) { const M = this.distMat.uniforms; M.uInvProj.value.copy(camera.projectionMatrixInverse); M.uCamWorld.value.copy(camera.matrixWorld); A._pass(this.distMat, this.dist); } }
    this._store(this.base); this._unjitter(camera);
    this.stats.plateMs = Math.round(performance.now() - t0);
    for (const [name, L] of Object.entries(this.layers)) {
      const t1 = performance.now(), m = L.n ?? (L.clouds ? nLayer : Math.min(n, 4));
      if (!L.clouds) for (const cv of this.clouds) { cv._on0 = cv.on; cv.on = false; }       // a layer that does not light the clouds: they cancel, skip them
      this._zero();
      for (let i = 0; i < m; i++) {
        this._jitter(camera, i, m);
        L.set(1); this._scene(camera, t); this._accum(1 / m);
        if (L.clouds) for (const cv of this.clouds) cv._key = null;
        L.set(0); this._scene(camera, t); this._accum(-1 / m);
      }
      L.done(); this._unjitter(camera);
      if (!L.clouds) for (const cv of this.clouds) cv.on = cv._on0;
      if (L.shadow) { this._store(this.tmp); const S = this.shadowMat.uniforms; S.tL.value = this.tmp.texture; S.uDir.value.set(...L.shadow.dir).normalize();
        S.uMax.value = L.shadow.max ?? 300; S.uThick.value = L.shadow.thick ?? 80; S.uSoft.value = L.shadow.soft ?? 0;
        S.uInvProj.value.copy(camera.projectionMatrixInverse); S.uCamWorld.value.copy(camera.matrixWorld); S.uVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        A._pass(this.shadowMat, L.rt); }
      else this._store(L.rt);
      this.stats['layer_' + name + 'Ms'] = Math.round(performance.now() - t1);
    }
    for (const cv of this.clouds) cv._key = null;
    this._vis(null);
    this.bakeCam.copy(camera); this.bakeCam.updateMatrixWorld();
    this.U.uBakeVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.U.uBakePos.value.copy(camera.position);
    if (over !== 1) { camera.fov = fov0; camera.updateProjectionMatrix(); } this.over = over;
    A._events = ev;
    this.baked = true; this.stats.bakeMs = Math.round(performance.now() - t0);
    return this.stats;
  }
  // per frame: the relit plate + the live layer through the rest of the Atmos chain (overlay, bloom, grade)
  render(cam, t = 0) {
    const A = this.A, W = A.world, r = A.renderer, camera = this._camera(cam), U = this.U, t0 = performance.now();
    const Uat = A.U; Uat.uCamPos.value.copy(camera.position); Uat.uTime.value = t; A._events(t);
    A.frameU.uNear.value = camera.near; A.frameU.uFar.value = camera.far;
    for (const f of W.onBefore) f(camera); for (const f of A.pre) f(A, camera, t);
    U.uInvProj.value.copy(camera.projectionMatrixInverse); U.uCamWorld.value.copy(camera.matrixWorld);
    U.uVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    for (const [name, L] of Object.entries(this.layers)) U.uW.value[L.i] = this.w[name] || 0;
    const P = this.plan.slice(0, 8); U.uPlanN.value = P.length;
    P.forEach((p, i) => { const kind = { rows: 0, dist: 1, sky: 2, ground: 3 }[p.kind || 'rows'];
      U.uPlanA.value[i].set(kind, p.amt ?? 1, p.cx ?? 0.5, p.hw ?? 1);
      U.uPlanB.value[i].set(p.kind === 'dist' ? p.d0 : p.y0 ?? 0, p.kind === 'dist' ? p.d1 : p.y1 ?? 1, p.feather ?? 0.05, p.xFeather ?? 0);
      U.uPlanC.value[i].set(p.gain ?? 1, p.sat ?? 1, 0); });
    const tm = r.toneMapping; r.toneMapping = THREE.NoToneMapping;
    // 1. live layer: the plate's depth first, then the live objects depth-tested against it
    r.setRenderTarget(A.rtC); r.setClearColor(0x000000, 0); r.clear();
    A.quad.material = this.depthMat; r.autoClear = false; r.render(A.qscene, A.qcam);
    this._vis(true); r.render(A.scene, camera); this._vis(null); r.autoClear = true;
    r.setClearColor(0x000000, 1);
    const FM = A.fogMat.uniforms; FM.uInvProj.value.copy(camera.projectionMatrixInverse); FM.uCamWorld.value.copy(camera.matrixWorld);
    A._pass(A.fogMat, this.tmp);                                    // fog the live pixels (and the sky, unused)
    U.tLive.value = this.tmp.texture; U.tLiveA.value = A.rtC.texture;
    A._pass(this.compMat, A.rtF);
    this.stats.compMs = Math.round(performance.now() - t0);
    // 2. the rest of Atmos.render: overlay (depth-occluded by the plate + live depth), bloom, grade
    A.frameU.uOcc.value = 1;
    r.setRenderTarget(A.rtE); r.clear(); r.render(A.overlay, camera);
    const B = A.bloom, D = A.downMat.uniforms, Up = A.upMat.uniforms;
    for (let i = 0; i < B.length; i++) { const src = i === 0 ? A.rtF : B[i - 1];
      D.tA.value = src.texture; D.tB.value = A.rtE.texture; D.uFirst.value = i === 0 ? 1 : 0; D.uTexel.value.set(1 / src.width, 1 / src.height); A._pass(A.downMat, B[i]); }
    let prev = B[B.length - 1];
    for (let i = B.length - 2; i >= 0; i--) { Up.tA.value = prev.texture; Up.tB.value = B[i].texture; Up.uAdd.value = 1; Up.uTexel.value.set(0.5 / prev.width, 0.5 / prev.height); A._pass(A.upMat, A.bloomUp[i]); prev = A.bloomUp[i]; }
    A.gradeU.tB.value = prev.texture; A.gradeU.uSeed.value = (t * 7.31) % 17;
    if (A.post) A.post(A);
    const GU = A.gradeU; GU.uMB.value = 0; A._pass(A.gradeMat, null);
    r.toneMapping = tm;
    this.stats.frameMs = Math.round(performance.now() - t0);
    return W.canvas;
  }
  // the aux the LOOKS read (looks.js): 540x960, R,G = 16-bit log depth between near and far (65535 = sky), B = class.
  // classify(s metres | Infinity, x, y) -> 'ground' | 'far' | 'mid' | 'spot' | 'subject' | 'sky'. Read once from the plate.
  aux(classify, { w = 540, h = 960, near = 1, far = 20000, skyDepth = 0.97 } = {}) {
    const A = this.A, r = A.renderer;
    if (!this._distPx) { this._distPx = new Float32Array(A.w * A.h * 4); r.readRenderTargetPixels(this.dist, 0, 0, A.w, A.h, this._distPx); }
    const D = this._distPx, CL = { ground: 0, far: 64, mid: 128, spot: 180, subject: 255 }, LN = Math.log(far / near);
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d'), im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ov = this.over || 1, sx = Math.floor(((x + 0.5) / w - 0.5) / ov * A.w + A.w / 2), sy = Math.floor(((y + 0.5) / h - 0.5) / ov * A.h + A.h / 2), s0 = D[((A.h - 1 - sy) * A.w + sx) * 4], s = s0 > 1e6 ? Infinity : s0;
      const k = classify(s, sx, sy), o = (y * w + x) * 4; im.data[o + 3] = 255;
      if (k === 'sky') { im.data[o] = 255; im.data[o + 1] = 255; im.data[o + 2] = 0; continue; }
      const dd = s === Infinity ? skyDepth : Math.min(0.98, Math.max(0, Math.log(Math.max(s, near) / near) / LN)), l = Math.round(65534 * dd);
      im.data[o] = l >> 8; im.data[o + 1] = l & 255; im.data[o + 2] = CL[k] ?? 128; }
    g.putImageData(im, 0, 0); return c;
  }
  // the plate's own distance at a pixel (for probes): returns metres or Infinity
  readDist(x, y) { const px = new Float32Array(4), r = this.A.renderer; r.readRenderTargetPixels(this.dist, x, this.A.h - 1 - y, 1, 1, px); return px[0] > 1e6 ? Infinity : px[0]; }
}

// ------------------------------------------------------------------ the lightning channel: a 3D ribbon, HDR core + wide glow, 2-3 branches
// Drawn in the overlay, occluded by the plate (the elevator stands in front of it), faded by the same haze as the land.
export class Channel {
  constructor(atmos, { top, ground, seed = 7, branches = 3, width = 2.2, glow = 26, color = [0.82, 0.88, 1] } = {}) {
    this.A = atmos; let s = seed; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    // a tortuous channel: a descending random walk (steps 12-45 m, direction kinked +-35 deg about the line to the target,
    // pulled back toward it) - the stepped-leader look, not a midpoint-displaced squiggle
    const walk = (a, b, stepMin, stepMax, kink, pull) => { const P = [a.slice()]; let p = a.slice();
      for (let k = 0; k < 400; k++) { const to = [b[0] - p[0], b[1] - p[1], b[2] - p[2]], L = Math.hypot(...to); if (L < stepMax) { P.push(b.slice()); break; }
        const st = stepMin + (stepMax - stepMin) * rnd(), ux = to[0] / L, uy = to[1] / L, uz = to[2] / L;
        const dx = ux + (rnd() - 0.5) * 2 * Math.tan(kink) * (1 - pull), dz = uz + (rnd() - 0.5) * Math.tan(kink) * (1 - pull), dy = Math.min(uy, -0.35);
        const n = Math.hypot(dx, dy, dz); p = [p[0] + dx / n * st, p[1] + dy / n * st, p[2] + dz / n * st]; if (p[1] < b[1]) p[1] = b[1]; P.push(p.slice()); }
      return P; };
    const main = walk(top, ground, 14, 46, 0.62, 0.25);
    this.strands = [{ pts: main, w: 1 }];
    for (let b = 0; b < branches; b++) { const i0 = Math.floor(main.length * (0.12 + 0.45 * rnd())), p = main[i0], L = (top[1] - ground[1]) * (0.22 + 0.25 * rnd()), side = rnd() < 0.5 ? -1 : 1;
      const end = [p[0] + side * L * (0.5 + 0.6 * rnd()), Math.max(ground[1] + 20, p[1] - L), p[2] + (rnd() - 0.5) * L * 0.4]; this.strands.push({ pts: walk(p, end, 8, 30, 0.8, 0.1), w: 0.4 }); }
    this.U = { ...atmos.U, tDepth: atmos.frameU.tDepth, uRes: atmos.frameU.uRes, uI: { value: 0 }, uCol: { value: new THREE.Vector3(...color) } };
    const mk = (additiveGlow) => new THREE.ShaderMaterial({ uniforms: { ...this.U, uGlow: { value: additiveGlow } }, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `attribute float side, bw; varying float vS, vB, vD; varying vec3 vW; void main(){ vS = side; vB = bw; vW = position; vec4 mv = viewMatrix * vec4(position, 1.); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D tDepth; uniform vec2 uRes; uniform float uI, uGlow; uniform vec3 uCol; uniform vec3 uCamPos;
        uniform float uFogD, uFogH, uFogY0, uHazeGain; varying float vS, vB, vD; varying vec3 vW;
        void main(){ float d = texture2D(tDepth, gl_FragCoord.xy / uRes).r; if (d < gl_FragCoord.z - 1e-7) discard;       // behind the plate (the elevator) or a live object
          float x = abs(vS); float core = uGlow > .5 ? exp(-x*x*3.) * .06 : smoothstep(1., .15, x);
          float tr = exp(-uFogD * exp(-(uCamPos.y - uFogY0) / uFogH) * vD * .35);
          gl_FragColor = vec4(uCol * uI * vB * core * tr, 1.); }` });
    this.matCore = mk(0); this.matGlow = mk(1);
    this.core = new THREE.Mesh(new THREE.BufferGeometry(), this.matCore); this.glow = new THREE.Mesh(new THREE.BufferGeometry(), this.matGlow);
    for (const m of [this.core, this.glow]) { m.frustumCulled = false; m.userData.noReflect = true; atmos.overlay.add(m); }
    this.width = width; this.glowW = glow; this.visible = true;
    atmos.pre.push((a, cam) => this._build(cam));
  }
  // camera-facing ribbons, rebuilt per frame on the CPU (a few hundred vertices)
  _build(cam) {
    const C = cam.position; const mk = (wScale) => { const P = [], S = [], B = [];
      for (const st of this.strands) { const pts = st.pts;
        for (let i = 0; i < pts.length - 1; i++) { const a = new THREE.Vector3(...pts[i]), b = new THREE.Vector3(...pts[i + 1]);
          const dir = b.clone().sub(a), mid = a.clone().add(b).multiplyScalar(0.5), v = mid.clone().sub(C), side = dir.clone().cross(v).normalize();
          const dist = v.length(), w = wScale * st.w * Math.max(1, dist / 900) * (1 - 0.35 * i / pts.length);
          const a0 = a.clone().addScaledVector(side, -w), a1 = a.clone().addScaledVector(side, w), b0 = b.clone().addScaledVector(side, -w), b1 = b.clone().addScaledVector(side, w);
          P.push(...a0.toArray(), ...a1.toArray(), ...b1.toArray(), ...a0.toArray(), ...b1.toArray(), ...b0.toArray()); S.push(-1, 1, 1, -1, 1, -1); for (let k = 0; k < 6; k++) B.push(st.w); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('side', new THREE.Float32BufferAttribute(S, 1)); g.setAttribute('bw', new THREE.Float32BufferAttribute(B, 1)); return g; };
    this.core.geometry.dispose(); this.glow.geometry.dispose();
    this.core.geometry = mk(this.width); this.glow.geometry = mk(this.glowW);
  }
  set(i) { this.matCore.uniforms.uI.value = i; this.matGlow.uniforms.uI.value = i; this.core.visible = this.glow.visible = i > 0; }
  // a point on the main channel at fraction u from the top (the key light's origin: the lower third)
  at(u) { const p = this.strands[0].pts, k = Math.min(p.length - 1, Math.max(0, Math.round(u * (p.length - 1)))); return p[k]; }
}
