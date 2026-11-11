// MODELING composite (MODELING studio, cycle 1): a model built INTO a plate, not pasted on it.
//
// The three findings of the brief ("the model replaced the shot instead of serving it"; objects against nothing; one render
// setup) become four things this module does:
//   1. the camera is the plate's (camera.js): the same window, the same frustum, so the crop and any zoom are one camera;
//   2. the plate's depth becomes an INVISIBLE PROXY (plateProxy): it hides the model where the plate is nearer, casts the
//      plate's shadow onto the model (a finger over a wrist), and a shadow catcher takes the model's shadow onto the plate's
//      ground (Debevec 1998, differential rendering, done with a catcher instead of a re-modelled floor);
//   3. the plate's own event lights (plate.js lights[]) and the model's lights take the SAME numbers, so one event lands on
//      both: a cobot ring lights the fingers and the fingers' shadow moves on the ring;
//   4. the foreground person or hand is always the top layer (the plate's matte redrawn over the model), and the model is
//      graded into the plate (black level, contrast, softness, grain) before the piece's own look prints the whole frame.
//
//   const st = new ModelStage({ W, H, sol, view });                 // sol: camera.js solution for the plate
//   st.add(asset.root); st.key(dirCameraSpace, color, intensity); st.env(plateImg, ...)
//   st.addProxy(plateProxy(plate, sol, { zNear: .4, zFar: .7 }));
//   const cp = new Composite(plate, st);
//   cp.draw(ctx, t, { plate: { view, lights, ... }, model: { black: .02, contrast: 1.05, grain: .03 }, foreground: 'matte' });
import * as THREE from 'three';
import { plateCamera, setView, rayAt } from './camera.js';

export class ModelStage {
  constructor({ W = 1080, H = 1920, sol, view = [0, 0, 1, 1], exposure = 1, near = 0.05, far = 500, shadowSize = 2048, position = [0, 0, 0] } = {}) {
    this.W = W; this.H = H; this.sol = sol;
    const cv = this.canvas = document.createElement('canvas'); cv.width = W; cv.height = H;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1); r.setSize(W, H, false); r.setClearColor(0x000000, 0);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = exposure; r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = plateCamera(sol, view, { near, far, position });
    this.keyL = new THREE.DirectionalLight(0xffffff, 3); this.keyL.castShadow = true; this.keyL.shadow.mapSize.set(shadowSize, shadowSize);
    this.keyL.shadow.bias = -0.0002; this.keyL.shadow.normalBias = 0.002; this.keyL.shadow.radius = 4; this.scene.add(this.keyL, this.keyL.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.4); this.scene.add(this.hemi);
    this.events = {}; this.proxies = []; this.catchers = []; this.models = [];
    this.hidden = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  }
  add(obj) { this.scene.add(obj); this.models.push(obj); return this; }
  view(v) { setView(this.camera, v); return this; }
  // key light: direction TOWARD the light in camera space (+x right, +y up, +z toward the viewer)
  key(dirCam, color = 0xffffff, intensity = 3, dist = 6) {
    const d = dirCam.clone().normalize().applyQuaternion(this.camera.quaternion);
    this.keyL.color.set(color); this.keyL.intensity = intensity; this.keyL.userData.dir = d; this.keyL.userData.dist = dist;
    return this;
  }
  ambient(sky = 0x8899aa, ground = 0x080808, intensity = 0.4) { this.hemi.color.set(sky); this.hemi.groundColor.set(ground); this.hemi.intensity = intensity; return this; }
  env(tex, intensity = 1) { this.scene.environment = tex; this.scene.environmentIntensity = intensity; return this; }
  // an event light in world units: name, kind point|spot, position (world), colour, base intensity; render({ name: weight })
  event(name, { kind = 'point', color = 0xffffff, intensity = 1, pos = [0, 0, 0], target, angle = 0.6, penumbra = 0.7, distance = 0, decay = 2, shadow = false } = {}) {
    const L = kind === 'spot' ? new THREE.SpotLight(color, 0, distance, angle, penumbra, decay) : new THREE.PointLight(color, 0, distance, decay);
    L.position.set(...pos); if (L.target && target) { L.target.position.set(...target); this.scene.add(L.target); }
    if (shadow) { L.castShadow = true; L.shadow.mapSize.set(1024, 1024); L.shadow.bias = -0.0004; }
    L.userData.base = intensity; this.scene.add(L); this.events[name] = L; return L;
  }
  addProxy(mesh) { mesh.castShadow = true; mesh.receiveShadow = false; this.scene.add(mesh); this.proxies.push(mesh); return mesh; }
  // a shadow catcher plane (the ground the plate shows): world y = height, tinted shadow
  addCatcher(mesh, { color = 0x000000, opacity = 0.6 } = {}) {
    mesh.material = new THREE.ShadowMaterial({ color, opacity, transparent: true, depthWrite: false }); mesh.receiveShadow = true; mesh.userData.catcher = true; mesh.visible = false;
    this.scene.add(mesh); this.catchers.push(mesh); return mesh;
  }
  // fit the key's shadow camera to the models and proxies
  fit(pad = 1.1) {
    const box = new THREE.Box3(); for (const o of [...this.models, ...this.proxies]) box.union(new THREE.Box3().setFromObject(o));
    const c = box.getCenter(new THREE.Vector3()), R = box.getSize(new THREE.Vector3()).length() / 2 * pad, d = this.keyL.userData.dir || new THREE.Vector3(0, 1, 0.5).normalize();
    this.keyL.position.copy(c).addScaledVector(d, R * 2); this.keyL.target.position.copy(c); this.keyL.target.updateMatrixWorld();
    const sc = this.keyL.shadow.camera; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = R * 0.2; sc.far = R * 4; sc.updateProjectionMatrix();
    return this;
  }
  // beauty pass: the model over transparent, proxies as depth-only occluders and shadow casters
  renderModel(w = {}) {
    for (const [k, L] of Object.entries(this.events)) L.intensity = L.userData.base * (w[k] ?? 0);
    for (const p of this.proxies) p.visible = true; for (const c of this.catchers) c.visible = false;
    this.renderer.render(this.scene, this.camera); return this.canvas;
  }
  // shadow pass: the catchers show the model's shadow; the model itself is depth-only (casts, is not drawn)
  renderShadows(w = {}) {
    const saved = []; for (const m of this.models) m.traverse(o => { if (o.isMesh) { saved.push([o, o.material]); o.material = this.hidden; } });
    for (const p of this.proxies) p.visible = false; for (const c of this.catchers) c.visible = true;
    for (const [k, L] of Object.entries(this.events)) L.intensity = L.userData.base * (w[k] ?? 0);
    this.renderer.render(this.scene, this.camera);
    for (const [o, m] of saved) o.material = m; for (const c of this.catchers) c.visible = false;
    return this.canvas;
  }
}

// ---- the plate's depth as an invisible proxy (camera space -> world by the camera's quaternion/position)
export function readImage(img, w, h, blur = 0) {
  const c = document.createElement('canvas'); c.width = w || img.width; c.height = h || img.height; const g = c.getContext('2d', { willReadFrequently: true }); if (blur) g.filter = `blur(${blur}px)`; g.drawImage(img, 0, 0, c.width, c.height); return g.getImageData(0, 0, c.width, c.height);
}
// zNear / zFar: metres in front of the camera for nearness 1 / 0. alphaMin: keep cells where the matte >= this (subject only);
// pass alphaMin = 0 for the whole plate (a room proxy). frame: film frame index.
export function plateProxy(plate, sol, { zNear = 0.4, zFar = 0.7, alphaMin = 0.4, grid = 180, frame = 0, dilate = 2, curve = 1, smooth = 0 } = {}) {
  const D = readImage(plate.depth[frame], 0, 0, smooth), A = readImage(plate.alpha[frame], 0, 0);
  const gw = grid, gh = Math.round(grid * plate.ph / plate.pw), pos = new Float32Array((gw + 1) * (gh + 1) * 3), keep = new Uint8Array(gw * gh);
  const sample = (I, u, v) => { const x = Math.min(I.width - 1, Math.max(0, u * I.width | 0)), y = Math.min(I.height - 1, Math.max(0, v * I.height | 0)); return I.data[(y * I.width + x) * 4] / 255; };
  const q = new THREE.Quaternion(), v3 = new THREE.Vector3();
  for (let j = 0; j <= gh; j++) for (let i = 0; i <= gw; i++) {
    const u = i / gw, v = j / gh, n = Math.pow(sample(D, u, v), curve), z = zFar + (zNear - zFar) * n;
    const r = rayAt(sol, u * sol.w, v * sol.h); const p = r.multiplyScalar(z / -r.z); const k = (j * (gw + 1) + i) * 3; pos[k] = p.x; pos[k + 1] = p.y; pos[k + 2] = p.z;
  }
  const idx = [];
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    let a = 0; for (let dj = -dilate; dj <= dilate; dj++) for (let di = -dilate; di <= dilate; di++) { const uu = (i + 0.5 + di) / gw, vv = (j + 0.5 + dj) / gh; a = Math.max(a, sample(A, uu, vv)); }
    if (a < alphaMin) continue; const a0 = j * (gw + 1) + i, b0 = a0 + 1, c0 = a0 + gw + 1, d0 = c0 + 1; idx.push(a0, c0, b0, b0, c0, d0);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })); m.quaternion.copy(sol.quaternion); m.name = 'plateProxy';
  return m;
}

// ---- 2D compositing
export class Composite {
  constructor(plate, stage) {
    this.plate = plate; this.stage = stage; this.W = stage.W; this.H = stage.H;
    const mk = () => { const c = document.createElement('canvas'); c.width = this.W; c.height = this.H; return c; };
    this.base = mk(); this.tmp = mk(); this.mask = mk(); this.shad = mk();
    this._noise = null;
  }
  _grain(seed) {
    if (!this._noise) { const c = this._noise = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'), im = g.createImageData(512, 512); this._nd = im; }
    const d = this._nd.data; let s = (seed * 2654435761) >>> 0 || 1;
    for (let i = 0; i < d.length; i += 4) { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; const v = (s / 4294967296 + ((s >>> 8) & 255) / 255) * 0.5; d[i] = d[i + 1] = d[i + 2] = v * 255; d[i + 3] = 255; }
    this._noise.getContext('2d').putImageData(this._nd, 0, 0); return this._noise;
  }
  // grade the model layer into the plate: black level (lift), contrast about mid, saturation, blur (lens softness px), grain
  _gradeModel(src, { black = 0.02, contrast = 1, sat = 1, blur = 0.5, grain = 0.03, tint = [1, 1, 1], gain = 1, seed = 1, map = null } = {}) {
    const g = this.tmp.getContext('2d', { willReadFrequently: true }); g.clearRect(0, 0, this.W, this.H);
    g.filter = blur > 0.05 ? `blur(${blur}px)` : 'none'; g.drawImage(src, 0, 0); g.filter = 'none';
    const im = g.getImageData(0, 0, this.W, this.H), d = im.data, n = this._grain(seed).getContext('2d').getImageData(0, 0, 512, 512).data;
    const ox = (seed * 97) % 512, oy = (seed * 57) % 512, W = this.W;
    let lut = null;   // the piece's ink for the model: a gradient map by luminance, mixed with its own colour by (1 - keep)
    if (map) { lut = new Uint8ClampedArray(768); const S = map.stops.map(([u, h]) => { const n = parseInt(h.slice(1), 16); return [u, (n >> 16) & 255, (n >> 8) & 255, n & 255]; });
      for (let v = 0; v < 256; v++) { const u = v / 255; let a = S[0], b = S[S.length - 1]; for (let i = 0; i < S.length - 1; i++) if (u >= S[i][0] && u <= S[i + 1][0]) { a = S[i]; b = S[i + 1]; break; }
        const k = b[0] === a[0] ? 0 : (u - a[0]) / (b[0] - a[0]); lut[v * 3] = a[1] + (b[1] - a[1]) * k; lut[v * 3 + 1] = a[2] + (b[2] - a[2]) * k; lut[v * 3 + 2] = a[3] + (b[3] - a[3]) * k; } }
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const a = d[i + 3]; if (!a) continue;
      const x = p % W, y = (p / W) | 0, k = (((y + oy) & 511) * 512 + ((x + ox) & 511)) * 4, gn = (n[k] / 255 - 0.5) * grain * 255;
      let r = d[i] * gain * tint[0], gg = d[i + 1] * gain * tint[1], b = d[i + 2] * gain * tint[2];
      let L = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      if (lut) { const v = Math.min(255, Math.max(0, L)) | 0, kp = map.keep ?? 0; r = lut[v * 3] * (1 - kp) + r * kp; gg = lut[v * 3 + 1] * (1 - kp) + gg * kp; b = lut[v * 3 + 2] * (1 - kp) + b * kp; L = 0.2126 * r + 0.7152 * gg + 0.0722 * b; }
      r = L + (r - L) * sat; gg = L + (gg - L) * sat; b = L + (b - L) * sat;
      const m = 4 * (L / 255) * (1 - L / 255) + 0.3;   // midtone-weighted grain
      r = 128 + (r - 128) * contrast + black * 255 * (1 - r / 255) + gn * m; gg = 128 + (gg - 128) * contrast + black * 255 * (1 - gg / 255) + gn * m; b = 128 + (b - 128) * contrast + black * 255 * (1 - b / 255) + gn * m;
      d[i] = r; d[i + 1] = gg; d[i + 2] = b;
    }
    g.putImageData(im, 0, 0); return this.tmp;
  }
  // final frame into ctx. o: { plate: Plate.render opts (its view/lights/...), model: grade opts, events: weights, shadow: 0..1,
  //   foreground: 'matte' (redraw the plate's subject over the model) | 'sparks' (screen the plate's bright parts over) | 'none' }
  draw(ctx, t, o = {}) {
    const P = this.plate, S = this.stage, W = this.W, H = this.H, po = { grain: 0.035, push: 0, ...(o.plate || {}) };
    if (po.view) S.view(P.viewRect(po.view));
    // 1. the plate (its own event lights on its own surfaces)
    const pc = P.render(t, po); const bg = this.base.getContext('2d', { willReadFrequently: true }); bg.clearRect(0, 0, W, H); bg.drawImage(pc, 0, 0, W, H);
    if (o.plateMap) gradeMap(bg, o.plateMap.stops, o.plateMap);   // the piece's own ink on the plate (the model gets its own map in _gradeModel)
    ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(this.base, 0, 0);
    // 2. the model's shadow on the plate's ground (multiply)
    if (S.catchers.length && (o.shadow ?? 1) > 0) {
      const sc = S.renderShadows(o.events || {}); const sg = this.shad.getContext('2d'); sg.clearRect(0, 0, W, H); sg.drawImage(sc, 0, 0);
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = o.shadow ?? 1; ctx.drawImage(this.shad, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    // 3. the model, graded into the plate
    if (o.model !== false) {
      const mc = S.renderModel(o.events || {}); const gm = this._gradeModel(mc, { seed: (Math.floor(t * 30) % 97) + 1, ...(o.model || {}) });
      ctx.drawImage(gm, 0, 0);
    }
    // 4. the foreground is the top layer
    const fg = o.foreground ?? 'matte';
    if (fg === 'matte') {
      const ac = P.render(t, { ...po, mode: 'alpha', grain: 0 }); const mg = this.mask.getContext('2d', { willReadFrequently: true });
      mg.clearRect(0, 0, W, H); mg.drawImage(ac, 0, 0, W, H); const im = mg.getImageData(0, 0, W, H), d = im.data;
      const cm = this.tmp.getContext('2d'); cm.globalCompositeOperation = 'source-over'; cm.clearRect(0, 0, W, H); cm.drawImage(this.base, 0, 0);
      const bi = cm.getImageData(0, 0, W, H), b = bi.data, ck = o.choke ?? 0, k0 = 0.5 * ck, kg = 1 / (1 - k0 * 1.0 + 1e-6);
      for (let i = 0; i < d.length; i += 4) { const a = d[i] / 255; b[i + 3] = ck ? Math.min(255, Math.max(0, (a - k0) * kg) * 255) : d[i]; }
      cm.putImageData(bi, 0, 0); ctx.drawImage(this.tmp, 0, 0);
    } else if (fg === 'sparks') {
      // small bright specks only (sparks, flares): the plate's luminance minus its own local blur, so a bright bar behind the
      // model stays behind it and only the specks in front of it are put back on top
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = o.sparkGain ?? 0.85;
      const sg = this.tmp.getContext('2d', { willReadFrequently: true }), mg = this.mask.getContext('2d', { willReadFrequently: true });
      sg.globalCompositeOperation = 'source-over'; sg.clearRect(0, 0, W, H); sg.drawImage(this.base, 0, 0);
      mg.clearRect(0, 0, W, H); mg.filter = `blur(${o.sparkBlur ?? 9}px)`; mg.drawImage(this.base, 0, 0); mg.filter = 'none';
      const im = sg.getImageData(0, 0, W, H), d = im.data, bl = mg.getImageData(0, 0, W, H).data, th = (o.sparkThreshold ?? 0.22) * 255, k = 255 - th;
      for (let i = 0; i < d.length; i += 4) { const L = Math.max(d[i], d[i + 1], d[i + 2]) - Math.max(bl[i], bl[i + 1], bl[i + 2]); const e = L > th ? Math.min(1, (L - th) / k * 2) : 0; d[i] *= e; d[i + 1] *= e; d[i + 2] *= e; d[i + 3] = 255; }
      sg.putImageData(im, 0, 0); ctx.drawImage(this.tmp, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    return ctx.canvas;
  }
}

// a gradient map (the piece's own ink: palette stops by luminance) over the finished frame: the plate and the model print the
// same way. stops: [[0, '#rrggbb'], ..., [1, '#rrggbb']]; keep: 0..1 mix of the original colour (spot colours survive)
export function gradeMap(ctx, stops, { keep = 0, contrast = 1, mid = 0.5, gain = 1 } = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height, im = ctx.getImageData(0, 0, W, H), d = im.data;
  const S = stops.map(([u, h]) => { const n = parseInt(h.slice(1), 16); return [u, (n >> 16) & 255, (n >> 8) & 255, n & 255]; });
  const lut = new Uint8ClampedArray(256 * 3);
  for (let v = 0; v < 256; v++) { let a = S[0], b = S[S.length - 1]; const u = v / 255; for (let i = 0; i < S.length - 1; i++) if (u >= S[i][0] && u <= S[i + 1][0]) { a = S[i]; b = S[i + 1]; break; }
    const k = b[0] === a[0] ? 0 : (u - a[0]) / (b[0] - a[0]); lut[v * 3] = a[1] + (b[1] - a[1]) * k; lut[v * 3 + 1] = a[2] + (b[2] - a[2]) * k; lut[v * 3 + 2] = a[3] + (b[3] - a[3]) * k; }
  for (let i = 0; i < d.length; i += 4) {
    let L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255 * gain; L = Math.min(1, Math.max(0, mid + (L - mid) * contrast)); const v = (L * 255 + 0.5) | 0;
    d[i] = lut[v * 3] * (1 - keep) + d[i] * keep; d[i + 1] = lut[v * 3 + 1] * (1 - keep) + d[i + 1] * keep; d[i + 2] = lut[v * 3 + 2] * (1 - keep) + d[i + 2] * keep;
  }
  ctx.putImageData(im, 0, 0);
}

// ---- a sky for scenes with no plate: gradient dome (elevation stops, bottom -> top) that is also the environment map, so
// chrome, glass and wet ground reflect the sky the frame shows.
export function skyDome(renderer, scene, stops, { radius = 3000, fog = null, fogDensity = 0.004, exposure = 1 } = {}) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 512; const g = c.getContext('2d'), gr = g.createLinearGradient(0, 512, 0, 0);
  for (const [u, col] of stops) gr.addColorStop(u, '#' + col.toString(16).padStart(6, '0')); g.fillStyle = gr; g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false }));
  const uv = dome.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, Math.max(0, (uv.getY(i) - 0.5) * 2) ** 0.7);
  dome.renderOrder = -1; scene.add(dome);
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene(); es.add(dome.clone());
  const gnd = new THREE.Mesh(new THREE.CircleGeometry(2500, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: stops[0][1] })); gnd.position.y = -2; es.add(gnd);
  scene.environment = pm.fromScene(es, 0.03).texture; pm.dispose();
  if (fog != null) scene.fog = new THREE.FogExp2(fog, fogDensity);
  return dome;
}

// ---- 2D bloom / halation: the bright parts of the frame (lamps, arcs) bleed a little light. Threshold + wide blur, added.
// Halation on lit sources only (never on a silhouette edge): the threshold keeps it off dark masses.
export function bloom2d(ctx, { threshold = 0.82, radius = 22, gain = 0.6, tint = [1, 1, 1], scale = 4 } = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height, w = Math.round(W / scale), h = Math.round(H / scale);
  const a = document.createElement('canvas'); a.width = w; a.height = h; const g = a.getContext('2d', { willReadFrequently: true }); g.drawImage(ctx.canvas, 0, 0, w, h);
  const im = g.getImageData(0, 0, w, h), d = im.data, th = threshold * 255, k = 255 - th;
  for (let i = 0; i < d.length; i += 4) { const m = Math.max(d[i], d[i + 1], d[i + 2]), e = m > th ? (m - th) / k : 0; d[i] *= e * tint[0]; d[i + 1] *= e * tint[1]; d[i + 2] *= e * tint[2]; }
  g.putImageData(im, 0, 0);
  const b = document.createElement('canvas'); b.width = w; b.height = h; const bg = b.getContext('2d'); bg.filter = `blur(${radius / scale}px)`; bg.drawImage(a, 0, 0);
  bg.filter = `blur(${radius * 3 / scale}px)`; bg.globalAlpha = 0.6; bg.drawImage(a, 0, 0);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = gain; ctx.imageSmoothingEnabled = true; ctx.drawImage(b, 0, 0, W, H); ctx.restore();
}
