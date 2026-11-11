// LIGHT / rig: ONE light record in physical units that drives the renderer (LIGHTING c1, critique L1).
//
//   const rig = new LightRig(renderer, scene, PRESETS.sodiumNight({ practicals: [...] }));
//   rig.update(t)     per frame (flicker, sparks); rig.jitter(k, K) per accumulated sub-frame (soft shadows)
//
// The record:
//   camera     { ev100 } or { N, shutter, iso }, ec (exposure compensation, stops), wb (kelvin | lamp name | null)
//   sky        { kind: clear|overcast|night, elevation, azimuth | day, hours, lat, turbidity, hazeH, illuminance, ... }
//   sun        { shadowSize, extent (m), center [x,y,z], softness }   (the key: its colour and lux come from the sky model)
//   atmosphere { density (1/m at the ground), height (m, exponential), base (m), albedo, g, ambient (multiplier),
//                maxDist (m), steps }
//   practicals [ Practical specs ]   (light/practicals.js)
//   lens       { bloom, halation, vignette, grain, flare }   look { contrast, sat, ... }   (light/display.js)
// Every light is set PRE-EXPOSED (Frostbite): value = physical * exposure, so a noon frame and a sodium-lit night share one
// pipeline and one display transform, and night is exposed for its sources instead of being dimmed day.
import * as THREE from 'three';
import { bakeSky, solarPosition } from './sky.js';
import { exposureFromEV100, ev100, whiteBalance, luminance } from './color.js';
import { Practical } from './practicals.js';

export class LightRig {
  constructor(renderer, scene, rec) {
    this.renderer = renderer; this.scene = scene; this.rec = rec;
    const cam = rec.camera || {};
    this.ev = cam.ev100 ?? ev100(cam.N ?? 8, cam.shutter ?? 1 / 125, cam.iso ?? 100);
    this.exposure = exposureFromEV100(this.ev, cam.ec ?? 0);
    this.wb = cam.wb ? whiteBalance(cam.wb, cam.wbStrength ?? 1) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    // sky + sun
    const sk = { ...(rec.sky || {}) };
    if (sk.hours != null) Object.assign(sk, solarPosition(sk));
    const t0 = performance.now();
    this.sky = bakeSky(sk); this.skyMs = performance.now() - t0;
    // the sky texture is stored PRE-EXPOSED (and clamped under half-float range: the Mie peak round a low sun can pass
    // 9e4 cd/m2, which overflows the PMREM's half floats into inf and NaN)
    const ex = this.exposure, sd = this.sky.data, pd = new Float32Array(sd.length);
    for (let i = 0; i < sd.length; i += 4) { pd[i] = Math.min(6e4, sd[i] * ex); pd[i + 1] = Math.min(6e4, sd[i + 1] * ex); pd[i + 2] = Math.min(6e4, sd[i + 2] * ex); pd[i + 3] = 1; }
    const tex = this.skyTex = new THREE.DataTexture(pd, this.sky.W, this.sky.H, THREE.RGBAFormat, THREE.FloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping; tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.colorSpace = THREE.LinearSRGBColorSpace; tex.needsUpdate = true;
    scene.background = tex; scene.backgroundIntensity = rec.sky?.backgroundGain ?? 1;
    const pm = new THREE.PMREMGenerator(renderer);
    this.env = pm.fromEquirectangular(tex).texture; pm.dispose();
    scene.environment = this.env; scene.environmentIntensity = rec.sky?.envGain ?? 1;
    const su = rec.sun || {};
    this.sunDir = new THREE.Vector3(...this.sky.sunDir);
    const E = this.sky.sunE, mx = Math.max(...E);
    this.sunOn = mx > 1e-6;
    const sun = this.sun = new THREE.DirectionalLight(mx > 0 ? new THREE.Color(E[0] / mx, E[1] / mx, E[2] / mx) : 0xffffff, mx * this.exposure * (su.gain ?? 1));
    sun.visible = this.sunOn; sun.castShadow = this.sunOn;
    if (this.sunOn) {
      const S = su.shadowSize ?? 2048; sun.shadow.mapSize.set(S, S); sun.shadow.bias = su.bias ?? -0.0003; sun.shadow.normalBias = su.normalBias ?? 0.04; sun.shadow.radius = 2;
      const ext = su.extent ?? 40, sc = sun.shadow.camera; sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = ext * 6; sc.updateProjectionMatrix();
    }
    this.center = new THREE.Vector3(...(su.center ?? [0, 0, 0])); this.sunDist = (su.extent ?? 40) * 3;
    this._placeSun(this.sunDir);
    scene.add(sun, sun.target);
    // the sun disc (only in the main pass; the sky texture is too coarse to hold it)
    if (this.sunOn && this.sky.elevation > -1 && rec.sky?.disc !== false) {
      const R = 1500, rr = R * Math.tan(0.0047 * (rec.sky?.discScale ?? 1)), L = this.sky.sunL, m = Math.max(...L) * this.exposure;
      const k = Math.min(m, 60000) / Math.max(m, 1e-9) * this.exposure;
      const disc = this.disc = new THREE.Mesh(new THREE.CircleGeometry(rr, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(L[0] * k, L[1] * k, L[2] * k), fog: false, depthWrite: false }));
      disc.position.copy(this.sunDir).multiplyScalar(R); disc.lookAt(0, 0, 0); disc.renderOrder = -1; disc.userData.noPrepass = true; disc.frustumCulled = false;
      scene.add(disc);
    }
    // practicals (the contact-shadow key goes first: three puts the first shadowed spot at index 0, which patch.js reads)
    this.practicals = (rec.practicals || []).slice().sort((a, b) => (b.contact ? 1 : 0) - (a.contact ? 1 : 0)).map(p => { const P = new Practical(p, this.exposure); scene.add(P.group); return P; });
    // (HUMAN c7) the floor is the fill: rec.bounce = true | { albedo, tint, floorY, gain }. One upward virtual light per practical at
    // the centroid of its floor pool (Keller's instant radiosity with one VPL per lamp: a gaffer's bounce card), carrying the flux
    // the pool reflects. Without it light/'s environment holds only the sun- and sky-lit ground, so under a lamp at night or indoors
    // everything that faces down (under a brim, the chin, the neck, under the bust, steel undersides) receives nothing at all.
    this.bounces = [];
    if (rec.bounce) { const B = rec.bounce === true ? {} : rec.bounce;
      for (const P of this.practicals) { if (P.spec.bounce === false) continue; for (const b of floorBounce(P, B) || []) { scene.add(b.light, b.light.target); this.bounces.push(b); } } }
    this.atmos = { density: 0.004, height: 40, base: 0, albedo: 0.9, g: 0.55, ambient: 1, maxDist: 400, steps: 40, ...(rec.atmosphere || {}) };
    this.lens = { bloom: 0.04, halation: 0.25, vignette: 0.35, grain: 0.03, ...(rec.lens || {}) };
    this.look = { ...(rec.look || {}) };
  }
  _placeSun(dir) { this.sun.position.copy(this.center).addScaledVector(dir, this.sunDist); this.sun.target.position.copy(this.center); this.sun.target.updateMatrixWorld(); }
  // per frame: envelopes. drive: { name: level } multiplies a practical's level by name (spec.name)
  update(t, drive = {}) {
    for (const P of this.practicals) {
      const on = drive[P.spec.name] ?? P.spec.on ?? 1;
      if (P.spec.drive) { const d = P.spec.drive(t); if (d) { if (d.pos) { P.pos.copy(d.pos); P.light.position.copy(d.pos); } if (d.cd != null) P.cd = d.cd; if (d.rgb) { const mx = Math.max(...d.rgb); P.col.setRGB(d.rgb[0] / mx, d.rgb[1] / mx, d.rgb[2] / mx); P.light.color.copy(P.col); P.peak = mx; } } }
      P.update(t, { on });
    }
    for (const b of this.bounces) b.light.intensity = b.k * b.P.light.intensity;   // the bounce follows its lamp (flicker, on/off)
  }
  // CAMERA7: a practical with spec.follow === 'camera' is a lamp placed for the NOMINAL camera (on the stage axis, looking along -z); it is translated sideways and up with the point
  // where the camera's own axis meets the set's back plane (this.followWall = { z, y }: the plane and the nominal height of that point), so its pool sits on the same part of the wall
  // for any head, any camera yaw: a photographer lights the background for the lens. The lamp's aim moves with it (its cone and its clearance of the head are the nominal ones).
  followCamera(camera) {
    const W = this.followWall; if (!W || !camera) return null;
    const F = this.practicals.filter(P => P.spec.follow === 'camera'); if (!F.length) return null;
    camera.updateMatrixWorld();
    const cp = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld), cf = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
    if (cf.z > -0.05) return null;
    const t = (W.z - cp.z) / cf.z, dx = cp.x + t * cf.x, dy = cp.y + t * cf.y - W.y;
    for (const P of F) {
      if (!P.home) P.home = { pos: P.pos.clone(), aim: P.aim.clone() };
      P.pos.set(P.home.pos.x + dx, P.home.pos.y + dy, P.home.pos.z); P.aim.set(P.home.aim.x + dx, P.home.aim.y + dy, P.home.aim.z);
      P.light.position.copy(P.pos);
      if (P.light.target) { P.light.target.position.copy(P.aim); P.light.target.updateMatrixWorld(); }
      if (P.head) P.head.position.copy(P.pos);
    }
    return { dx, dy };
  }
  // per accumulated sub-frame k of K: the sun within its disc (plus haze softening), practicals within their size
  jitter(k, K, hal = halton2) {
    const [u, v] = hal(k + 1);
    if (this.sunOn) {
      const soft = (this.rec.sun?.softness ?? 1) * 0.0047 * (K > 1 ? 1 : 0);
      const d = this.sunDir.clone(), t1 = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize(), t2 = new THREE.Vector3().crossVectors(d, t1);
      const a = 2 * Math.PI * u, r = Math.sqrt(v) * soft;
      this._placeSun(d.addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize());
    }
    if (K > 1) for (const P of this.practicals) P.jitter((u + 0.37 * P.seed) % 1, v);
  }
  // pre-exposed values the screen-space and volume passes need
  sunE() { const E = this.sky.sunE, e = this.exposure * (this.rec.sun?.gain ?? 1); return new THREE.Vector3(E[0] * e, E[1] * e, E[2] * e); }
  ambientL() { const E = this.sky.skyE, g = this.sky.sunE, s = Math.max(0, this.sunDir.y), a = this.rec.sky?.groundAlbedo ?? 0.18, e = this.exposure * this.atmos.ambient;
    // mean radiance of the surround: half sky (E/pi), half ground (albedo x total horizontal irradiance / pi)
    return new THREE.Vector3(...[0, 1, 2].map(c => (0.5 * E[c] / Math.PI + 0.5 * a * (E[c] + g[c] * s) / Math.PI) * e)); }
  volumeLights() { return this.practicals.filter(P => P.spec.volume).map(P => P.volumeRecord()); }   // a fixed set (no recompiles when a light dims to 0)
  keyLight() { return this.practicals.find(P => P.spec.contact) || null; }
}

// (HUMAN c7) the floor pool of one practical as an upward virtual light. The pool is integrated on a grid (irradiance from the
// lamp's own cone and inverse square), giving its flux, centroid and spread; the floor reflects albedo x flux as a lambertian
// disc, whose on-axis intensity is flux / pi. A point source set under the floor by 0.75 x the pool radius stands in for the disc
// (its near field stays finite at the feet), aimed up with a cone that falls to zero at the horizon (about cos theta).
// Returns [{ light, k, P, pool: { c, r, E, flux } }], k = bounce intensity / lamp intensity (both pre-exposed three.js values).
export function floorBounce(P, { albedo = 0.3, tint = [1, 0.97, 0.9], floorY = 0, gain = 1, n = 48, n5 = true } = {}) {
  const L = P.light, s = P.spec, h = P.pos.y - floorY; if (h <= 0.05) return null;
  const ax = P.aim.clone().sub(P.pos).normalize(), spot = L.isSpotLight;
  const cosO = spot ? Math.cos(L.angle) : -2, cosI = spot ? Math.cos(L.angle * (1 - L.penumbra)) : -1;
  const sm = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  const tHit = ax.y < -0.05 ? h / -ax.y : 0, c0 = P.pos.clone().addScaledVector(ax, tHit); c0.y = floorY;
  const R = Math.min(40, h * Math.min(6, Math.tan(Math.min(spot ? L.angle : 1.3, 1.35)) * 1.25 + 0.5)), dA = (2 * R / n) ** 2;
  let F = 0, cx = 0, cz = 0, m2 = 0; const pts = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = c0.x - R + (i + 0.5) * 2 * R / n, z = c0.z - R + (j + 0.5) * 2 * R / n;
    const dx = x - P.pos.x, dy = floorY - P.pos.y, dz = z - P.pos.z, d2 = dx * dx + dy * dy + dz * dz, d = Math.sqrt(d2);
    const cth = (dx * ax.x + dy * ax.y + dz * ax.z) / d, I = P.cd * (spot ? sm(cosO, cosI, cth) : 1), E = I * (-dy / d) / d2;
    if (E <= 0) continue; F += E * dA; cx += E * dA * x; cz += E * dA * z; pts.push([x, z, E * dA]); }
  if (F <= 0) return null; cx /= F; cz /= F; for (const [x, z, w] of pts) m2 += w * ((x - cx) ** 2 + (z - cz) ** 2); const r = Math.max(0.3, Math.sqrt(m2 / F));
  const Iv = albedo * F / Math.PI * gain;                                                  // cd, on axis, of the lit pool
  const col = new THREE.Color(P.col.r * tint[0], P.col.g * tint[1], P.col.b * tint[2]), mx = Math.max(col.r, col.g, col.b); col.multiplyScalar(1 / mx);
  // five virtual lights: the centroid (a third of the flux) and four at 0.8 r round it (a sixth each), so a face turned toward the lit
  // floor in front gets more of it than one turned toward the floor behind (one light at the centroid lost the pool's direction)
  const pool = { c: [cx, floorY, cz], r, E: F / (Math.PI * r * r), flux: F }, out = [];
  for (const [ox, oz, share] of n5 ? [[0, 0, 1 / 3], [0.8, 0, 1 / 6], [-0.8, 0, 1 / 6], [0, 0.8, 1 / 6], [0, -0.8, 1 / 6]] : [[0, 0, 1]]) {
    const light = new THREE.SpotLight(col, 0, 0, Math.PI / 2 - 0.02, 1, 2); light.castShadow = false; light.name = 'bounce:' + (s.name || s.kind);
    const px = cx + ox * r, pz = cz + oz * r, dep = (n5 ? 0.55 : 0.75) * r;
    light.position.set(px, floorY - dep, pz); light.target.position.set(px, floorY + 10, pz); light.target.updateMatrixWorld(); light.userData.bounce = true;
    // the lamp's colour is normalised to max 1 in both; the tint's own loss of brightness is kept
    out.push({ light, k: Iv / P.cd * mx * share, P, pool }); }
  return out;
}

export function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
export const halton2 = i => [halton(i, 2), halton(i, 3)];
