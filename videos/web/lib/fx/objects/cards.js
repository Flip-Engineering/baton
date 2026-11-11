// OBJECT CARDS (OBJECTS c1): bake an object once as a turntable of relightable angle cards, then play it in 2D.
//
// Why: a hero object in live three.js on this machine's SwiftShader costs 2-12 s a frame with shadows and AO. An
// impostor (Brucks' octahedral impostors, SpeedTree billboards, HUMAN's fist_cards.png) pays that once: every view is
// rendered offline into light LAYERS, and a frame is a texture lookup plus a few multiply-adds. Because the layers
// are separate lights (linear superposition, the relight.js method), the event light is still free at playback:
//   amb     ambient-only render WITH ground-truth AO (GTAO): the object's albedo, wear and crevices = the "fill" layer
//   key     the key light alone (with its shadows), e.g. the low sun
//   ev      the event light alone (with shadows), e.g. the lightning strike from high front-left
//   emit    emissives alone (marker lamps, headlamps, clock faces)
//   nd      view-space normal (rgb) + view depth (a), the input for any light added at playback (a headlight sweep)
// Views: n azimuths from az0 to az1 (a turntable arc) at one elevation; playback crossfades neighbours.
//
//   const cards = await ObjectCards.bake(stage, object, { n: 30, az: [-0.6, 0.9], el: 0.1, size: 640, fill: 0.85,
//                                                         key: { dir: [...], color, intensity }, ev: { dir, color, intensity } });
//   const player = new CardPlayer(1080, 1920);          // its own small WebGL2 canvas
//   player.draw(cards, { view: 12.4, amb: 1, key: 1, ev: strikeEnvelope(t, hit), emit: 1,
//                        sweep: { x: 0.2, y: 0.55, z: 0.6, color: [1, .95, .85], w: 1.5, cone: 0.35 }, rect: [x, y, w, h] });
//   ctx.drawImage(player.canvas, 0, 0);
// Cost: the bake is n x 5 renders (30 views ~ 2-4 min on 4 cores); playback ~10-40 ms a frame.
import * as THREE from 'three';

export class ObjectCards {
  static async bake(stage, object, o = {}) {
    const n = o.n ?? 30, size = o.size ?? 640, [az0, az1] = o.az ?? [-0.8, 0.8], el = o.el ?? 0.1, fill = o.fill ?? 0.85;
    const r = stage.renderer, scene = stage.scene;
    const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    const atlas = {}; for (const k of ['amb', 'key', 'ev', 'emit', 'nd']) { const c = document.createElement('canvas'); c.width = cols * size; c.height = rows * size; atlas[k] = c; }
    // a square bake canvas: the stage renders into its own canvas, so bake on a second renderer sharing nothing
    const bc = document.createElement('canvas'); bc.width = bc.height = size;
    const { Stage } = await import('./stage.js');
    const bs = new Stage(bc, { sky: stage.sky, noDome: true, key: { intensity: 0 }, rim: { intensity: 0 }, fill: { intensity: 0 }, aoRadius: o.aoRadius ?? 0.5, aoIntensity: 1.0, shadowSize: 2048 });
    bs.renderer.toneMapping = THREE.NoToneMapping; bs.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; bs.scene.environment = null; bs.scene.background = null;
    bs.renderer.setClearColor(0x000000, 0);
    const holder = new THREE.Group(); holder.add(object); bs.scene.add(holder);
    if (o.ground) bs.scene.add(o.ground);
    bs.fit(object);
    const box = new THREE.Box3().setFromObject(object), c = box.getCenter(new THREE.Vector3()), R = box.getSize(new THREE.Vector3()).length() / 2;
    const cam = new THREE.PerspectiveCamera(o.fov ?? 24, 1, 0.1, R * 20);
    const dist = R / Math.tan((o.fov ?? 24) * Math.PI / 360) / fill;
    const amb = new THREE.AmbientLight(0xffffff, 0); bs.scene.add(amb);
    const dirL = (spec, name) => { const L = new THREE.DirectionalLight(spec.color ?? 0xffffff, 0); L.castShadow = true; L.shadow.mapSize.set(2048, 2048); L.shadow.bias = -0.0004; L.shadow.normalBias = 0.02;
      const d = new THREE.Vector3(...spec.dir).normalize(); L.position.copy(c).addScaledVector(d, R * 3); L.target.position.copy(c); const sc = L.shadow.camera; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = R * 0.5; sc.far = R * 6; sc.updateProjectionMatrix(); bs.scene.add(L, L.target); L.name = name; return L; };
    const keyL = dirL(o.key ?? { dir: [0.6, 0.35, 0.7], color: 0xffa060 }, 'key'), evL = dirL(o.ev ?? { dir: [-0.5, 0.9, 0.4], color: 0xdce6ff }, 'ev');
    const keyI = o.key?.intensity ?? 2.5, evI = o.ev?.intensity ?? 3;
    // materials: remember emissive intensities; normal+depth override
    const meshes = []; object.traverse(m => { if (m.isMesh) meshes.push(m); });
    const emis = new Map(meshes.map(m => [m, m.material.emissiveIntensity ?? 0]));
    const setEmit = on => meshes.forEach(m => { if ('emissiveIntensity' in m.material) m.material.emissiveIntensity = on ? emis.get(m) : 0; });
    const ndMat = new THREE.ShaderMaterial({ uniforms: { uNear: { value: dist - R }, uFar: { value: dist + R } },
      vertexShader: 'varying vec3 vN; varying float vZ; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vZ = -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uNear, uFar; varying vec3 vN; varying float vZ; void main(){ vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; gl_FragColor = vec4(n * 0.5 + 0.5, clamp((vZ - uNear) / (uFar - uNear), 0.0, 1.0) * 0.98 + 0.01); }' });
    const views = [];
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const az = az0 + (az1 - az0) * (n === 1 ? 0 : i / (n - 1));
      cam.position.set(c.x + Math.sin(az) * dist * Math.cos(el), c.y + Math.sin(el) * dist, c.z + Math.cos(az) * dist * Math.cos(el)); cam.lookAt(c); cam.updateMatrixWorld();
      views.push({ az, view: cam.matrixWorldInverse.clone() });
      const x = (i % cols) * size, y = Math.floor(i / cols) * size;
      const pass = (k, { a = 0, key = 0, ev = 0, emit = false, ao = true }) => {
        amb.intensity = a; keyL.intensity = key; evL.intensity = ev; setEmit(emit); bs.ao = ao;
        bs.render(cam); atlas[k].getContext('2d').drawImage(bc, x, y);
      };
      pass('amb', { a: o.ambI ?? 1.0 }); pass('key', { key: keyI, ao: false }); pass('ev', { ev: evI, ao: false }); pass('emit', { emit: true, ao: false });
      scene.overrideMaterial = null; bs.scene.overrideMaterial = ndMat; amb.intensity = keyL.intensity = evL.intensity = 0; bs.ao = false; bs.render(cam); bs.scene.overrideMaterial = null;
      atlas.nd.getContext('2d').drawImage(bc, x, y);
      if (o.onProgress) o.onProgress(i + 1, n);
    }
    setEmit(true); bs.scene.remove(holder); if (o.ground) bs.scene.remove(o.ground);
    const ms = performance.now() - t0;
    return { n, size, cols, rows, atlas, views, az: [az0, az1], el, fov: o.fov ?? 24, dist, R, bakeMs: ms, keyColor: keyL.color, evColor: evL.color };
  }
}

// playback: a full-screen quad over a card rect, five atlases, a crossfade between neighbouring views
export class CardPlayer {
  constructor(w = 1080, h = 1920) {
    this.canvas = document.createElement('canvas'); this.canvas.width = w; this.canvas.height = h;
    this.r = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    this.r.setPixelRatio(1); this.r.setSize(w, h, false); this.r.setClearColor(0, 0);
    this.scene = new THREE.Scene(); this.cam = new THREE.OrthographicCamera(0, w, h, 0, -1, 1); this.w = w; this.h = h;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false,
      uniforms: { tA: { value: null }, tK: { value: null }, tE: { value: null }, tM: { value: null }, tN: { value: null },
        uGrid: { value: new THREE.Vector2(1, 1) }, uView: { value: new THREE.Vector3(0, 0, 0) }, uW: { value: new THREE.Vector4(1, 1, 0, 1) },
        uSweep: { value: new THREE.Vector4(0, 0, 0, 0) }, uSweepC: { value: new THREE.Vector4(1, 1, 1, 0.35) }, uExpo: { value: 1 },
        uKeyC: { value: new THREE.Color(1, 1, 1) }, uEvC: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `precision highp float; varying vec2 vUv;
uniform sampler2D tA, tK, tE, tM, tN; uniform vec2 uGrid; uniform vec3 uView; uniform vec4 uW, uSweep, uSweepC; uniform float uExpo; uniform vec3 uKeyC, uEvC;
vec2 cell(float i){ float cx = mod(i, uGrid.x), cy = floor(i / uGrid.x); return (vec2(cx, cy) + vec2(vUv.x, 1.0 - vUv.y)) / uGrid; }
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec4 shade(float i){
  vec2 p = cell(i); p.y = 1.0 - p.y;
  vec4 a = texture2D(tA, p), k = texture2D(tK, p), e = texture2D(tE, p), m = texture2D(tM, p), nd = texture2D(tN, p);
  vec3 col = a.rgb * uW.x + k.rgb * uW.y + e.rgb * uW.z + m.rgb * uW.w;
  if (uSweep.w > 0.0 && nd.a > 0.0) {
    // a moving spot (headlight / torch) in card space: position (x, y in 0..1, z toward the camera), lit by the normal
    vec3 N = normalize(nd.rgb * 2.0 - 1.0); vec3 P = vec3(vUv, 1.0 - nd.a);
    vec3 L = vec3(uSweep.x, uSweep.y, uSweep.z) - P; float d = length(L); L /= d;
    float cone = smoothstep(uSweepC.w, 0.0, length(vUv - uSweep.xy));
    col += a.rgb * uSweepC.rgb * max(dot(N, L), 0.0) * cone * uSweep.w * 2.2;
  }
  return vec4(col, smoothstep(0.0, 0.012, nd.a));
}
void main(){
  float i0 = floor(uView.x), f = uView.x - i0; float i1 = min(i0 + 1.0, uView.y - 1.0);
  vec4 c0 = shade(i0), c1 = shade(i1); vec4 c = mix(c0, c1, f);
  vec3 o = aces(c.rgb * uExpo); o = pow(o, vec3(1.0 / 2.2));
  gl_FragColor = vec4(o, c.a);
}` });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0), this.mat); this.scene.add(this.quad);
    this.tex = new WeakMap();
  }
  _t(cards) {
    if (!this.tex.has(cards)) { const T = {}; for (const [k, c] of Object.entries(cards.atlas)) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.flipY = true; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; T[k] = t; } this.tex.set(cards, T); }
    return this.tex.get(cards);
  }
  // rect: [x, y, w, h] in canvas px (top-left origin)
  draw(cards, o = {}) {
    const T = this._t(cards), u = this.mat.uniforms;
    u.tA.value = T.amb; u.tK.value = T.key; u.tE.value = T.ev; u.tM.value = T.emit; u.tN.value = T.nd;
    u.uGrid.value.set(cards.cols, cards.rows); u.uView.value.set(Math.max(0, Math.min(cards.n - 1.0001, o.view ?? 0)), cards.n, 0);
    u.uW.value.set(o.amb ?? 1, o.key ?? 1, o.ev ?? 0, o.emit ?? 1); u.uExpo.value = o.exposure ?? 1.4;
    const s = o.sweep; if (s) { u.uSweep.value.set(s.x, s.y, s.z ?? 0.6, s.w ?? 1); u.uSweepC.value.set(...(s.color ?? [1, 0.95, 0.85]), s.cone ?? 0.35); } else u.uSweep.value.set(0, 0, 0, 0);
    const [x, y, w, h] = o.rect ?? [0, (this.h - this.w) / 2, this.w, this.w];
    this.quad.position.set(x, this.h - y - h, 0); this.quad.scale.set(w, h, 1);
    this.r.clear(); this.r.render(this.scene, this.cam);
    return this.canvas;
  }
}
