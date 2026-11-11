// ERECT events (MODELING c4): scale events driven by contacts. A foot plant is the moment that says how big a thing is.
//
// Why: c3's reveal had motion as a smooth curve and nothing at the foot plant: no dust, no shake, no sound. The craft references:
//   - the miniature frame-rate rule: things fall at g, so a 40 m fall takes 2.9 s; debris and snow falling off a giant are slow
//     because they are far, not because the film is slowed (here g is always 9.81 m/s^2 and the giant's own pace is sqrt-scaled);
//   - dust at scale rolls OUT along the ground as a low wall and rises slowly (a burst takes seconds to develop, not frames);
//   - the AT-AT walk: the foot lands, the weight arrives a beat later, the camera (on the same ground) takes the jolt;
//   - sound is the event's other half: every event here is exported as a cue (time, kind, strength, distance) for the mix.
//
//   const K = new Kit(scene);  K.plant(t0, x, z, size);  K.clods(t0, from, vel, n);  K.snowFall(t0, from, n);  K.update(t, camera, sunD)
//   const s = shakeAt(t, K.hits, camPos)   -> { dx, dy, rx, rz } add to the camera;  K.cues -> [{ t, kind, strength, dist }]
import * as THREE from 'three';
import { Puffs, puffTex } from './yard.js';
import { rng } from './members.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)), G = 9.81;
// time for a body with terminal velocity vt to fall h metres from rest under linear drag
const landT = (h, vt) => { const k = G / vt; let t = h / vt + 1 / k; for (let i = 0; i < 6; i++) { const f = vt * (t - (1 - Math.exp(-k * t)) / k) - h, d = vt * (1 - Math.exp(-k * t)); t -= f / d; } return t; };
export class Kit {
  constructor(scene, { dust = 220, chunks = 260, seed = 7 } = {}) {
    this.scene = scene; this.R = rng(seed); this.bursts = []; this.falls = []; this.hits = []; this.cues = [];
    this.dust = new Puffs(scene, dust, { col: '#d9d2c4', shade: '#7a7268', sunCol: '#ffd09a' });
    // chunks: frozen mud clods and ice, instanced irregular solids
    const geo = new THREE.IcosahedronGeometry(1, 0); { const p = geo.attributes.position, R = rng(3); for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (.7 + R() * .5), p.getY(i) * (.6 + R() * .5), p.getZ(i) * (.7 + R() * .5)); geo.computeVertexNormals(); }
    this.chunk = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .9 }), chunks); this.chunk.castShadow = true; this.chunk.frustumCulled = false;
    this.chunk.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(chunks * 3), 3); scene.add(this.chunk); this.nChunk = chunks;
    // snow falling off a ledge: fine streaks (sprites)
    // snow sliding off a ledge (c4 r2): fine grains as points (a powder curtain that streams and thins) plus a faint veil of
    // wide, low-opacity puffs that spreads as it falls. The first version stretched big puffs and read as white smears up close.
    this.snow = new Puffs(scene, 90, { col: '#f4f4f2', shade: '#c4c7ca', sunCol: '#fff0d8' });
    this.nGrain = 2600; const gp = new Float32Array(this.nGrain * 3).fill(-1e4);
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
    this.grains = new THREE.Points(gg, new THREE.PointsMaterial({ color: '#eef0f1', size: .16, sizeAttenuation: true, map: grainTex(), transparent: true, opacity: .85, depthWrite: false, alphaTest: .02 }));
    this.grains.frustumCulled = false; scene.add(this.grains);
  }
  cue(t, kind, strength, where) { this.cues.push({ t: +t.toFixed(3), kind, strength: +strength.toFixed(2), x: where ? +where.x.toFixed(1) : null, z: where ? +where.z.toFixed(1) : null }); }
  // a foot (or knee) comes down at (x, z) with a contact patch `size` m across: dust ring, a low dust wall, a ground hit
  plant(t0, x, z, size = 9, strength = 1, { tint = '#d9d2c4' } = {}) { this.bursts.push({ t0, x, z, size, n: 70, seed: (this.R() * 1e9) | 0, strength }); this.hits.push({ t0, p: V3(x, 0, z), strength }); this.cue(t0, 'plant', strength, V3(x, 0, z)); }
  // clods thrown or shed from a point with a velocity spread (they fall at g, bounce once, settle)
  clods(t0, from, vel = V3(0, 0, 0), n = 40, { spread = 2.5, size = [.15, .7], col = ['#3e342b', '#6b5a48', '#e8e8e4'] } = {}) {
    for (let i = 0; i < n; i++) this.falls.push({ t0: t0 + this.R() * .5, p: from.clone().add(V3((this.R() - .5) * spread * 2, (this.R() - .5) * spread, (this.R() - .5) * spread * 2)), v: vel.clone().add(V3((this.R() - .5) * 3, this.R() * 1.5, (this.R() - .5) * 3)), s: size[0] + this.R() * (size[1] - size[0]), col: col[(this.R() * col.length) | 0], rot: V3(this.R() * 6, this.R() * 6, this.R() * 6), spin: (this.R() - .5) * 8 });
    this.cue(t0, 'debris', clamp(n / 60), from);
  }
  // snow sliding off a ledge at height: a curtain of fine powder that falls and spreads
  snowFall(t0, from, n = 60, { width = 12, dur = 2 } = {}) { this.snowSrc = (this.snowSrc || []).concat([{ t0, from: from.clone(), n, width, dur, seed: (this.R() * 1e9) | 0 }]); this.cue(t0 + landT(from.y, 7), 'snow_land', .4, from); }
  update(t, camera, sunD) {
    // dust: each burst's puffs roll outward along the ground (fast at first, slowing), rise slowly, grow and fade over ~8 s
    let q = 0; for (const s of this.dust.items) s.visible = false;
    for (const b of this.bursts) {
      const age = t - b.t0; if (age < 0 || age > 12) continue; const R = rng(b.seed);
      for (let i = 0; i < b.n && q < this.dust.items.length; i++) {
        const a = R() * Math.PI * 2, sp = (.35 + R() * .7) * b.size * .55 * b.strength, out = b.size * .45 + sp * (1 - Math.exp(-age / 1.6)) * 1.8, rise = (.15 + R() * .5) * age * (1 + R()), low = R() < .65;
        const sz = b.size * (low ? .3 : .45) * (.6 + R() * .7) * (1 + age * .35), s = this.dust.items[q++];
        s.visible = true; s.position.set(b.x + Math.cos(a) * out, (low ? .3 : 1) * sz * .35 + rise * (low ? .4 : 1), b.z + Math.sin(a) * out); s.scale.set(sz * 1.6, sz * (low ? .6 : 1), 1);
        s.material.opacity = clamp(age * 4) * Math.exp(-age / 3.5) * (.18 + R() * .3) * b.strength; s.material.rotation = R() * 6 + age * .1 * (R() - .5); s.userData.base = 0;
      }
    }
    this.dust.light(camera, sunD, 1.2);
    // chunks
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = V3(), P = V3(), col = new THREE.Color(); let k = 0;
    for (const f of this.falls) { if (k >= this.nChunk) break; const age = t - f.t0; if (age < 0) continue;
      // ballistic, one bounce at the ground with damping, then rest
      let y = f.p.y + f.v.y * age - .5 * G * age * age, x = f.p.x + f.v.x * age, z = f.p.z + f.v.z * age, spin = f.spin * age;
      const tg = (f.v.y + Math.sqrt(f.v.y * f.v.y + 2 * G * Math.max(0, f.p.y - f.s * .5))) / G;
      if (age > tg) { const a2 = age - tg, vy = (f.v.y - G * tg) * -.25, x0 = f.p.x + f.v.x * tg, z0 = f.p.z + f.v.z * tg; y = Math.max(f.s * .4, f.s * .5 + vy * a2 - .5 * G * a2 * a2); x = x0 + f.v.x * .3 * Math.min(a2, .4); z = z0 + f.v.z * .3 * Math.min(a2, .4); spin = f.spin * (tg + Math.min(a2, .4)); }
      E.set(f.rot.x + spin, f.rot.y, f.rot.z + spin * .5); Q.setFromEuler(E); S.setScalar(f.s); P.set(x, y, z); M.compose(P, Q, S); this.chunk.setMatrixAt(k, M); col.set(f.col); this.chunk.setColorAt(k, col); k++; }
    for (; k < this.nChunk; k++) { M.makeScale(0, 0, 0); this.chunk.setMatrixAt(k, M); }
    this.chunk.instanceMatrix.needsUpdate = true; if (this.chunk.instanceColor) this.chunk.instanceColor.needsUpdate = true;
    // snow curtains: grains leave the ledge over `dur` s, fall with air drag (terminal ~6-9 m/s for powder clumps), drift with
    // the wind and spread; a veil of wide faint puffs follows the curtain's centre and widens
    let m = 0, gi = 0; for (const s of this.snow.items) s.visible = false; const gpos = this.grains.geometry.attributes.position;
    for (const src of this.snowSrc || []) { const R = rng(src.seed), nG = Math.round(src.n * 30);
      for (let i = 0; i < nG && gi < this.nGrain; i++) { const rel = R() * src.dur, age = t - src.t0 - rel, x0 = src.from.x + (R() - .5) * src.width, z0 = src.from.z + (R() - .5) * 1.5, vt = 5 + R() * 4, k = G / vt;
        const drop = vt * (age - (1 - Math.exp(-k * Math.max(0, age))) / k), y = src.from.y - drop, wob = R() * 6;
        if (age < 0 || y < .05) continue;
        gpos.setXYZ(gi++, x0 + age * (.9 + R() * .8) + Math.sin(age * 2 + wob) * .3 * age, y, z0 + (R() - .5) * age * .8 + Math.cos(age * 1.7 + wob) * .2 * age); }
      for (let i = 0; i < Math.min(src.n, 30) && m < this.snow.items.length; i++) { const rel = R() * src.dur, age = t - src.t0 - rel; if (age < 0) continue; const vt = 7, k = G / vt;
        const y = src.from.y - vt * (age - (1 - Math.exp(-k * age)) / k); if (y < -2) continue; const s = this.snow.items[m++], sz = 2.5 + age * 2.2;
        s.visible = true; s.position.set(src.from.x + (R() - .5) * src.width * .8 + age * 1.2, Math.max(1, y), src.from.z + (R() - .5) * 2); s.scale.set(sz, sz * 1.15, 1);
        s.material.opacity = (.035 + R() * .045) * clamp(age * 3) * clamp(2.2 - age * .3); s.material.rotation = R() * 6; s.userData.base = y - 3; } }
    for (let i = gi; i < this.nGrain; i++) gpos.setXYZ(i, 0, -1e4, 0); gpos.needsUpdate = true;
    this.snow.light(camera, sunD, .8);
  }
}
// camera shake from ground hits: a heavy low thump (~7 Hz vertical, decaying in ~0.5 s), a slower sway (~1.6 Hz, ~1.4 s), both
// falling off with distance; strength 1 at 30 m is about 6 cm and 0.25 degrees. The weight arrives `delay` s after the contact.
// a soft round grain for the snow points
let _grain = null;
export function grainTex() { if (_grain) return _grain; const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.45, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return (_grain = t); }
export function shakeAt(t, hits, camPos, { delay = .06, gain = 1 } = {}) {
  let dy = 0, dx = 0, rx = 0, rz = 0;
  for (const h of hits) { const a = t - h.t0 - delay; if (a < 0 || a > 4) continue; const d = camPos.distanceTo(h.p), k = gain * h.strength * 30 / (30 + d);
    const thump = Math.exp(-a / .22) * Math.sin(2 * Math.PI * 7.2 * a), sway = Math.exp(-a / .9) * Math.sin(2 * Math.PI * 1.6 * a + .4), rattle = Math.exp(-a / .5) * Math.sin(2 * Math.PI * 13.1 * a) * .3;
    dy += k * (.06 * thump + .02 * sway); dx += k * .02 * (sway + rattle); rx += k * (.0045 * thump + .0012 * sway); rz += k * (.0018 * sway + .001 * rattle); }
  return { dx, dy, rx, rz };
}
export function applyShake(cam, s) { cam.position.x += s.dx; cam.position.y += s.dy; cam.rotateX(s.rx); cam.rotateZ(s.rz); }
