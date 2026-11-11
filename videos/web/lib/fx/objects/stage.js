// OBJECTS STAGE (OBJECTS c1): light an object like a photograph of a thing, not a cut-out.
//
// The critique's third cause of fakeness: "light never touches them". A Stage gives any object (or a whole shot) a
// motivated light rig and renders it ONCE through one tonemap:
//   sky      a gradient dome (the shot's own sky), also PMREM'd into the environment so chrome and glass reflect it
//   key      a low raking sun (shadow-fitted to the object's bbox), colour and azimuth per shot
//   fill     the sky's hemisphere bounce; rim: a back light that draws the edge the sky doesn't
//   events   named point / spot lights a shot fades on: 'strike' (lightning), 'headlamp' (a sweeping spot), 'arc'
//            (a welding arc: blue-white, flickering), 'ram' (a press flash), each with its own envelope from the shot
//   ao       GTAO (three/addons GTAOPass) so the crevices go dark: the part lines, wheel wells, column flutes
//   tonemap  ACES once, in the OutputPass (no double tonemap: the ALL POWER v1 burn-out)
//
//   const st = new Stage(canvas, { sky: SKIES.dusk, key: { az: -2.4, el: 0.12, color: 0xffa060, intensity: 4 } });
//   st.add(obj); st.fit(obj); st.render(camera, { strike: 0.8 });
//
// LIGHTING c2: { pipeline: 'light', light: PRESETS.x({...}) | 'sodiumNight', quality: 'final', practicals: [...] } renders the
// same Stage through light/ (LitRenderer + LightRig: physical sky and sun, practicals, haze, AO/contact shadows, reflections,
// the one display transform). key / fill / rim are then NOT added (the light record is the light); event() lights take
// `intensity` as CANDELA (pre-exposed by the rig); fogDensity becomes the rig's haze. Default (no pipeline) is unchanged.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LitRenderer } from '../light/pipeline.js';
import { LightRig } from '../light/rig.js';
import { PRESETS } from '../light/presets.js';
import { litPatchAll } from '../light/patch.js';

// skies: gradient stops bottom -> top (sRGB hex), plus a sun disc position hint
export const SKIES = {
  dusk:     { stops: [[0, 0xf6b25a], [0.08, 0xee8a3a], [0.25, 0xc4562a], [0.5, 0x6a2a2a], [1, 0x1a1020]], ground: 0x140c0a, fog: 0x7a3a24 },
  sodium:   { stops: [[0, 0x2a1a10], [0.2, 0x1a120c], [1, 0x07060a]], ground: 0x0e0b08, fog: 0x2a1c10 },
  storm:    { stops: [[0, 0x4a4a52], [0.3, 0x2a2a34], [1, 0x0c0c12]], ground: 0x0e0e10, fog: 0x2a2a30 },
  night:    { stops: [[0, 0x1a1c2a], [0.3, 0x0c0e18], [1, 0x040408]], ground: 0x060608, fog: 0x10121a },
  overcast: { stops: [[0, 0xc9c7c0], [0.4, 0xb4b2ac], [1, 0x9a9a98]], ground: 0x6a665e, fog: 0xb0aea8 },  // Becher light
  red:      { stops: [[0, 0xd02a1a], [0.5, 0xa01a14], [1, 0x5a0c0c]], ground: 0x1a0606, fog: 0x8a1a12 },
};
export function skyTexture(sky, h = 512) {
  const c = document.createElement('canvas'); c.width = 4; c.height = h; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, h, 0, 0);
  for (const [u, col] of sky.stops) gr.addColorStop(u, '#' + col.toString(16).padStart(6, '0'));
  g.fillStyle = gr; g.fillRect(0, 0, 4, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Stage {
  constructor(canvas, o = {}) {
    this.W = o.width ?? canvas.width; this.H = o.height ?? canvas.height;
    if (o.pipeline === 'light') return this._lit(canvas, o);
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: !!o.alpha });
    r.setPixelRatio(1); r.setSize(this.W, this.H, false);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = o.exposure ?? 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.setSky(o.sky ?? SKIES.dusk, o);
    // key (sun / flood), fill (hemisphere), rim (back light)
    const k = o.key || {};
    this.key = new THREE.DirectionalLight(k.color ?? 0xffb070, k.intensity ?? 3.5);
    this.key.castShadow = true; this.key.shadow.mapSize.set(o.shadowSize ?? 2048, o.shadowSize ?? 2048); this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.02;
    this.keyAz = k.az ?? -2.2; this.keyEl = k.el ?? 0.18;
    this.scene.add(this.key, this.key.target);
    this.hemi = new THREE.HemisphereLight(o.fill?.sky ?? 0x8a6a8a, o.fill?.ground ?? 0x2a1a12, o.fill?.intensity ?? 0.6); this.scene.add(this.hemi);
    const rm = o.rim || {};
    this.rim = new THREE.DirectionalLight(rm.color ?? 0xffd0a0, rm.intensity ?? 0); this.rimAz = rm.az ?? 2.6; this.rimEl = rm.el ?? 0.25; this.scene.add(this.rim, this.rim.target);
    this.events = {};
    this.ao = o.ao ?? true; this.aoOpt = o;
  }
  // (c2) the light/ pipeline behind the same Stage API
  _lit(canvas, o) {
    this.lit = true; this.litOpts = o.render || {}; this.t = 0;
    this.lr = new LitRenderer({ canvas, width: this.W, height: this.H, quality: o.quality || 'final' });
    this.renderer = this.lr.renderer; this.scene = new THREE.Scene();
    const rec = typeof o.light === 'string' ? PRESETS[o.light]({ practicals: o.practicals || [] }) : (o.light || PRESETS.lookdev({ practicals: o.practicals || [] }));
    if (o.fogDensity && !rec.atmosphere?.density) rec.atmosphere = { ...(rec.atmosphere || {}), density: o.fogDensity * 0.25 };
    this.rig = new LightRig(this.renderer, this.scene, rec);
    this.key = this.rig.sun; this.hemi = new THREE.HemisphereLight(0, 0, 0); this.rim = new THREE.DirectionalLight(0, 0); this.events = {}; this.ao = false;
    return this;
  }
  // GTAO needs the camera at construction: the composer is built on the first render with each camera
  _composer(camera) {
    if (this._cam === camera) return this.composer;
    const o = this.aoOpt, r = this.renderer;
    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(this.W, this.H, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(this.scene, camera));
    this.gtao = new GTAOPass(this.scene, camera, this.W, this.H);
    this.gtao.updateGtaoMaterial({ radius: o.aoRadius ?? 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: o.aoSamples ?? 16 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.gtao.blendIntensity = o.aoIntensity ?? 0.9;
    this.composer.addPass(this.gtao);
    this.composer.addPass(new OutputPass());
    this._cam = camera; return this.composer;
  }
  setSky(sky, o = {}) {
    if (this.lit) return;   // (c2) the light record owns the sky
    this.sky = sky;
    const tex = skyTexture(sky);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false }));
    // map the gradient on elevation: sphere uv.v runs 0 (bottom) .. 1 (top); horizon at 0.5 -> squeeze the lower half
    const uv = dome.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, Math.max(0, (uv.getY(i) - 0.5) * 2) ** 0.7);
    dome.userData.gbuffer = false; dome.renderOrder = -1;
    if (this.dome) this.scene.remove(this.dome); this.dome = dome; if (!o.noDome) this.scene.add(dome);
    if (o.fogDensity) this.scene.fog = new THREE.FogExp2(sky.fog, o.fogDensity);
    const pm = new THREE.PMREMGenerator(this.renderer); const es = new THREE.Scene(); es.add(dome.clone());
    // a bright horizon band so chrome catches a line of light (the thing a real chrome bumper shows)
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1500, 1500, 90, 32, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(sky.stops[0][1]).multiplyScalar(o.bandGain ?? 2.2), side: THREE.BackSide }));
    band.position.y = 30; es.add(band);
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(1500, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: sky.ground })); gnd.position.y = -2; es.add(gnd);
    this.scene.environment = pm.fromScene(es, 0.02).texture; pm.dispose();
  }
  add(...o) { this.scene.add(...o); return this; }
  // fit the key's shadow camera to an object (or a Box3), and aim the key / rim at it
  fit(obj, pad = 1.15) {
    if (this.lit) { const box = obj.isBox3 ? obj : new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3()), R = box.getSize(new THREE.Vector3()).length() / 2 * pad;
      this.center = c; this.radius = R; this.rig.center.copy(c); const sc = this.rig.sun.shadow.camera; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.far = R * 8; sc.updateProjectionMatrix(); this.rig.sunDist = R * 3; return this; }
    const box = obj.isBox3 ? obj : new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3()), R = box.getSize(new THREE.Vector3()).length() / 2 * pad;
    this.center = c; this.radius = R;
    const dir = (az, el) => new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.key.position.copy(c).addScaledVector(dir(this.keyAz, this.keyEl), R * 3); this.key.target.position.copy(c);
    const sc = this.key.shadow.camera; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = R * 0.5; sc.far = R * 6; sc.updateProjectionMatrix();
    this.rim.position.copy(c).addScaledVector(dir(this.rimAz, this.rimEl), R * 3); this.rim.target.position.copy(c);
    return this;
  }
  // an event light: kind 'point' | 'spot' | 'dir'; returns the light (intensity driven per frame by render({ name: w }))
  event(name, { kind = 'point', color = 0xffffff, intensity = 50, pos = [0, 10, 0], target = null, angle = 0.4, penumbra = 0.6, distance = 0, decay = 2, shadow = false } = {}) {
    const L = kind === 'spot' ? new THREE.SpotLight(color, 0, distance, angle, penumbra, decay) : kind === 'dir' ? new THREE.DirectionalLight(color, 0) : new THREE.PointLight(color, 0, distance, decay);
    L.position.set(...pos); if (L.target) { L.target.position.set(...(target || [0, 0, 0])); this.scene.add(L.target); }
    if (shadow) { L.castShadow = true; L.shadow.mapSize.set(1024, 1024); L.shadow.bias = -0.0005; if (kind === 'dir' && this.radius) { const sc = L.shadow.camera, R = this.radius; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.far = R * 8; sc.updateProjectionMatrix(); } }
    L.userData.base = this.lit ? intensity * this.rig.exposure : intensity; this.scene.add(L); this.events[name] = L; return L;
  }
  render(camera, w = {}) {
    for (const [k, L] of Object.entries(this.events)) L.intensity = L.userData.base * (w[k] ?? 0);
    if (this.lit) { if (!this._patched) { litPatchAll(this.scene, this.litOpts.patch || {}); this._patched = true; }
      return this.lr.render({ scene: this.scene, camera, rig: this.rig, t: w.t ?? this.t, ...this.litOpts }); }
    if (this.ao) this._composer(camera).render();
    else this.renderer.render(this.scene, camera);
  }
}

// ground planes with character: asphalt with lane paint, a concrete shop floor with expansion joints, dirt / gravel
export function groundPlane(kind = 'asphalt', { size = 400, color } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d');
  const base = { asphalt: '#26231f', concrete: '#6a665e', dirt: '#3a2e22', lawn: '#1e2616' }[kind] || '#333';
  g.fillStyle = color || base; g.fillRect(0, 0, 1024, 1024);
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 26000; i++) { const v = rnd(); g.fillStyle = `rgba(${v < 0.5 ? '0,0,0' : '255,245,230'},${0.04 + rnd() * 0.08})`; g.fillRect(rnd() * 1024, rnd() * 1024, 1 + rnd() * 3, 1 + rnd() * 3); }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.1})`; g.beginPath(); g.ellipse(rnd() * 1024, rnd() * 1024, 20 + rnd() * 90, 10 + rnd() * 40, rnd() * 3, 0, 7); g.fill(); }
  if (kind === 'concrete') { g.strokeStyle = 'rgba(20,18,14,0.6)'; g.lineWidth = 3; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 256, 0); g.lineTo(i * 256, 1024); g.stroke(); g.beginPath(); g.moveTo(0, i * 256); g.lineTo(1024, i * 256); g.stroke(); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(size / 12, size / 12); t.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: t, roughness: kind === 'concrete' ? 0.7 : 0.92, metalness: 0 }));
  m.receiveShadow = true; m.name = 'ground'; return m;
}
