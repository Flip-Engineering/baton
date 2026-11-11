// LIGHT / medium: local participating media (steam, smoke, fume, impact dust) as one small 3D texture that the volume
// pass marches, so every shadowed light cuts beams through them and the practicals inside them light them from within
// (LIGHTING c1, critique L4 / L6).
//
//   const med = new Medium({ box: [[-20, 0, -20], [20, 16, 20]], res: [64, 32, 64], maxDensity: 0.8 });
//   med.add(plume({ pos: [3, 6, -2], kind: 'steam', rate: 6 }));
//   med.add(dustBurst({ pos: [0, 0, 0], t0: 2.3, energy: 1 }));
//   med.update(t, sunDir)   once per frame (not per sub-frame): fills the texture
// Texture channels (RGBA8): R density (x maxDensity, 1/m), G transmittance toward the sun (self-shadowing, marched on the
// CPU: the deep-shadow / Frostbite "volumetric shadow map" idea at voxel resolution), B albedo (0 soot .. 1 steam).
// Sources are deterministic functions of t (puffs on closed-form paths), so a still and the movie agree.
import * as THREE from 'three';

const hash3 = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
           l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
}
const rnd = s => { let a = s | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };

export class Medium {
  constructor({ box = [[-20, 0, -20], [20, 16, 20]], res = [56, 28, 56], maxDensity = 0.8, noise = 0.55, noiseScale = 0.35, detail = null } = {}) {
    // detail (c2): { scale (1/m of the eroding noise), erode (0..1), multi (multiple-scattering gain), lightShadow (bool) }
    this.detail = detail || { scale: 1.6, erode: 0.6, multi: 0.6, lightShadow: true };
    this.min = new THREE.Vector3(...box[0]); this.max = new THREE.Vector3(...box[1]); this.size = this.max.clone().sub(this.min);
    this.res = res; this.maxDensity = maxDensity; this.noise = noise; this.noiseScale = noiseScale;
    const [nx, ny, nz] = res; this.data = new Uint8Array(nx * ny * nz * 4); this.dens = new Float32Array(nx * ny * nz); this.alb = new Float32Array(nx * ny * nz);
    const t = this.texture = new THREE.Data3DTexture(this.data, nx, ny, nz);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
    this.sources = []; this.active = false;
  }
  add(src) { this.sources.push(src); return src; }
  // fill the grid at time t. sunDir: unit vector toward the sun (or null for no sun)
  update(t, sunDir = null) {
    const [nx, ny, nz] = this.res, D = this.dens, A = this.alb, vs = this.size.x / nx, vy = this.size.y / ny, vz = this.size.z / nz;
    D.fill(0); A.fill(0);
    let any = false;
    for (const s of this.sources) for (const p of s.puffs(t)) {
      if (p.d <= 1e-4) continue; any = true;
      const i0 = Math.max(0, Math.floor((p.x - p.r - this.min.x) / vs)), i1 = Math.min(nx - 1, Math.ceil((p.x + p.r - this.min.x) / vs));
      const j0 = Math.max(0, Math.floor((p.y - p.r * (p.sy ?? 1) - this.min.y) / vy)), j1 = Math.min(ny - 1, Math.ceil((p.y + p.r * (p.sy ?? 1) - this.min.y) / vy));
      const k0 = Math.max(0, Math.floor((p.z - p.r - this.min.z) / vz)), k1 = Math.min(nz - 1, Math.ceil((p.z + p.r - this.min.z) / vz));
      const ir2 = 1 / (p.r * p.r), isy = 1 / (p.sy ?? 1);
      for (let k = k0; k <= k1; k++) { const z = this.min.z + (k + 0.5) * vz - p.z;
        for (let j = j0; j <= j1; j++) { const y = (this.min.y + (j + 0.5) * vy - p.y) * isy;
          for (let i = i0; i <= i1; i++) { const x = this.min.x + (i + 0.5) * vs - p.x, q = (x * x + y * y + z * z) * ir2; if (q >= 1) continue;
            const f = (1 - q) * (1 - q) * p.d, n = i + nx * (j + ny * k); A[n] += f * p.a; D[n] += f; } } }
    }
    this.active = any;
    const data = this.data, ns = this.noiseScale, nz0 = this.noise;
    // noise breaks the puffs into billows (evaluated only where there is medium), drifting up with time
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const n = i + nx * (j + ny * k); let d = D[n];
      if (d > 0) {
        const X = (this.min.x + (i + 0.5) * vs) * ns, Y = (this.min.y + (j + 0.5) * vy) * ns - t * 0.25, Z = (this.min.z + (k + 0.5) * vz) * ns;
        const f = 0.6 * vnoise(X, Y, Z) + 0.4 * vnoise(X * 2.3 + 7, Y * 2.3, Z * 2.3 + 3);
        A[n] /= d; d *= Math.max(0, 1 - nz0 + nz0 * 2 * f); D[n] = Math.min(1, d);
      }
      data[n * 4] = Math.round(D[n] * 255); data[n * 4 + 2] = Math.round(Math.min(1, A[n]) * 255); data[n * 4 + 3] = 255;
    }
    // self-shadowing toward the sun: march each voxel up the sun direction through the grid (voxel steps)
    const sx = sunDir ? sunDir.x / vs : 0, sy = sunDir ? sunDir.y / vy : 0, sz = sunDir ? sunDir.z / vz : 0, sl = Math.hypot(sx, sy, sz) || 1;
    const dx = sx / sl, dy = sy / sl, dz = sz / sl, stepM = 1 / sl, K = this.maxDensity * stepM;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const n = i + nx * (j + ny * k);
      if (!sunDir || !any) { data[n * 4 + 1] = 255; continue; }
      let tau = 0, x = i + 0.5, y = j + 0.5, z = k + 0.5;
      for (let s = 0; s < 40; s++) { x += dx; y += dy; z += dz; const a = x | 0, b = y | 0, c = z | 0; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) break; tau += D[a + nx * (b + ny * c)] * K; if (tau > 6) break; }
      data[n * 4 + 1] = Math.round(Math.exp(-tau) * 255);
    }
    this.texture.needsUpdate = true;
    return this;
  }
}

// ---------------------------------------------------------------- sources
// a continuous plume: steam from a quench or a vent, smoke from a stack, fume from an arc
//   kind: steam (albedo .97, buoyant, short-lived), smoke (albedo .3, long), fume (albedo .6, thin), dust (albedo .55)
const KIND = { steam: { a: 0.97, rise: 2.4, life: 3.5, d: 0.9, grow: 0.9 }, smoke: { a: 0.32, rise: 1.6, life: 9, d: 0.7, grow: 0.7 }, fume: { a: 0.65, rise: 0.9, life: 4, d: 0.35, grow: 0.45 }, dust: { a: 0.55, rise: 0.3, life: 7, d: 0.6, grow: 0.8 } };
export function plume({ pos, kind = 'steam', rate = 5, r0 = 0.4, wind = [0.6, 0, 0.2], seed = 3, on = () => 1, ...o } = {}) {
  const K = { ...KIND[kind], ...o };
  return { kind, puffs(t) {
    const out = [], dt = 1 / rate, n0 = Math.floor((t - K.life * 2) / dt), n1 = Math.floor(t / dt);
    for (let n = Math.max(n0, -100000); n <= n1; n++) {
      const te = n * dt, a = t - te; if (a < 0) continue; const R = rnd(seed * 9973 + n), lv = on(te); if (lv <= 0) continue;
      const tau = 1.2, up = K.rise * tau * (1 - Math.exp(-a / tau)) + 0.15 * a;
      const jx = (R() - 0.5) * r0, jz = (R() - 0.5) * r0, sw = 0.25 * a * (R() - 0.5);
      const r = r0 + K.grow * Math.sqrt(a) * (0.8 + 0.4 * R());
      out.push({ x: pos[0] + jx + wind[0] * a + sw, y: pos[1] + up, z: pos[2] + jz + wind[2] * a - sw, r, d: K.d * lv * Math.exp(-a / K.life) * Math.min(1, a * 6) * (r0 / r) ** 1.2, a: K.a });
    }
    return out;
  } };
}
// impact dust (c2): what a heavy thing hitting dirt actually raises (high-speed footage of drops and foot-plants):
//   a SKIRT  a thin sheet driven out along the ground by the air pushed from under the load, fast then stalling (1 - e^-a/tau)
//   a ROLL   the skirt's leading edge curls up into a toroidal roll (puffs rise as they slow, then hang and spread)
//   a CORE   a dense, darker column thrown up from the contact, falling back and thinning
//   GRIT     a few fast, small, dense puffs thrown furthest (they read as the dust trails of the debris)
// Many small puffs (not 30 big balls): the grid holds their union as one cloud, the volume pass's erosion tears its outline.
// energy scales speed and size with sqrt (a heavier hit is slower and wider, not just bigger); deterministic in t.
export function dustBurst({ pos, t0 = 0, energy = 1, radius = 6, n = 64, seed = 7, wind = [0.5, 0, 0.15], albedo = 0.55, core = 1 } = {}) {
  const R = rnd(seed), P = [];
  for (let i = 0; i < n; i++) P.push({ kind: 'skirt', ang: (i / n) * 2 * Math.PI + (R() - 0.5) * 0.5, k: 0.55 + 0.6 * R(), s: 0.6 + 0.7 * R(), roll: R(), ph: R() * 6.28 });
  for (let i = 0; i < Math.round(14 * core); i++) P.push({ kind: 'core', ang: R() * 6.28, k: 0.12 * R(), up: 0.6 + 1.0 * R(), s: 0.7 + 0.6 * R() });
  for (let i = 0; i < 10; i++) P.push({ kind: 'grit', ang: R() * 6.28, k: 0.9 + 0.5 * R(), up: 0.3 + 0.6 * R(), s: 0.35 + 0.3 * R() });
  return { kind: 'dust', puffs(t) {
    const a = t - t0; if (a <= 0) return [];
    const out = [], E = Math.sqrt(energy), fade = Math.exp(-a / 7) * Math.min(1, a / 0.05);
    for (const p of P) {
      let x, y, z, r, sy, d;
      if (p.kind === 'skirt') {
        const Rr = radius * E * p.k * (1 - Math.exp(-a / 0.38));
        const lift = (0.25 + 0.9 * p.roll) * E * (1 - Math.exp(-Math.max(0, a - 0.15) / 0.9));       // the roll rises behind the front
        x = Math.cos(p.ang) * Rr; z = Math.sin(p.ang) * Rr; y = 0.15 + lift + 0.05 * a;
        r = (0.25 + 0.45 * Math.sqrt(a) * E) * p.s; sy = 0.55 + 0.35 * p.roll; d = 0.95 * (1.1 - 0.4 * p.roll);
      } else if (p.kind === 'core') {
        const Rr = radius * E * p.k * (1 - Math.exp(-a / 0.5)), up = p.up * E * 2.4 * (1 - Math.exp(-a / 0.35)) - 0.35 * Math.max(0, a - 0.8);
        x = Math.cos(p.ang) * Rr; z = Math.sin(p.ang) * Rr; y = 0.3 + Math.max(0.2, up);
        r = (0.3 + 0.5 * Math.sqrt(a) * E) * p.s; sy = 1.1; d = 1.0;
      } else {
        const Rr = radius * E * p.k * 1.3 * (1 - Math.exp(-a / 0.3));
        x = Math.cos(p.ang) * Rr; z = Math.sin(p.ang) * Rr; y = 0.2 + p.up * E * 1.6 * (1 - Math.exp(-a / 0.25)) - 0.6 * Math.max(0, a - 0.4);
        r = (0.15 + 0.3 * Math.sqrt(a)) * p.s; sy = 0.8; d = 0.8 * Math.exp(-a / 1.2);
      }
      out.push({ x: pos[0] + x + wind[0] * a, y: pos[1] + Math.max(0.1, y), z: pos[2] + z + wind[2] * a, r, sy, d: d * fade * Math.min(1, 0.9 * E), a: albedo * (p.kind === 'core' ? 0.85 : 1) });
    }
    return out;
  } };
}
// a moving-source column (c2): steam or smoke from a source that moves (the giant's stacks), with the MODELING c4 Plume's
// kinematics (a column that rises, drifts with the wind and grows) as many small puffs. pos: () => [x, y, z] at time t.
export function column({ pos, h = 40, w = 5, wind = [1, 0, 0.3], rate = 1, n = 60, d = 0.6, a = 0.97, seed = 5 } = {}) {
  const R = rnd(seed), S = Array.from({ length: n }, () => [R(), R(), R(), R()]);
  return { kind: 'column', puffs(t) {
    const out = [], p0 = typeof pos === 'function' ? pos(t) : pos;
    S.forEach(([u, b, c, e], i) => {
      const age = ((t * rate * 0.12 + i / n) % 1), y = age * h;
      const sz = w * (0.35 + age * 1.6) * (0.75 + e * 0.5);
      out.push({ x: p0[0] + (b - 0.5) * w * 0.5 + wind[0] * age * age * h * 0.6, y: p0[1] + y + wind[1] * age * h, z: p0[2] + (c - 0.5) * w * 0.5 + wind[2] * age * age * h * 0.6,
        r: sz * 0.5, sy: 0.85, d: d * Math.min(1, age * 8) * (1 - age) * (1 - age * 0.3), a });
    });
    return out;
  } };
}
// a static bank of low ground haze or a hanging pall in a hall (slowly breathing)
export function bank({ box, d = 0.25, a = 0.8, n = 30, seed = 5 } = {}) {
  const R = rnd(seed), P = Array.from({ length: n }, () => [R(), R(), R(), 0.6 + 0.8 * R(), R() * 6]);
  return { kind: 'bank', puffs(t) { return P.map(([u, v, w, s, ph]) => ({ x: box[0][0] + u * (box[1][0] - box[0][0]) + 0.3 * Math.sin(t * 0.2 + ph), y: box[0][1] + v * (box[1][1] - box[0][1]), z: box[0][2] + w * (box[1][2] - box[0][2]), r: s * Math.min(box[1][1] - box[0][1], 4) , sy: 0.5, d, a })); } };
}
