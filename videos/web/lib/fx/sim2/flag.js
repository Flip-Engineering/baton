// FLAG (sim2): a banner in real wind for three.js scenes. Baked cloth sim + a fabric shader. Pure function of t.
//
//   import { Flag, printCanvas } from '../lib/fx/sim2/flag.js';
//   const art = printCanvas({ w: 1536, h: 1024, ground: '#c8141c', draw: (ctx, w, h) => acpEmblem(ctx, w * .5, h * .5, h * .6) });
//   const flag = new Flag(scene, { w: 3.0, h: 2.0, pole: t => ({ base: [0, 0, 0], top: [0, 6, 0] }),
//                                  wind: { dir: [1, 0, -0.3], speed: 11, gust: 0.45 }, t0: 0, t1: 8, art });
//   flag.update(t);                                   // before renderer.render; returns the flag's world bbox centre
//   flag.setLight({ sun: dirVec3, sunColor, sky, ground, fog });
//
// Simulation (baked once, at construction; deterministic):
//   Verlet particles on an nx x ny grid, position-based distance constraints (structural, shear, bend), fabric mass
//   (bunting ~0.2 kg/m^2), gravity, and per-triangle aerodynamics: drag + lift from the wind velocity relative to the
//   cloth, projected on the triangle normal (F = 1/2 rho Cd A |v_n| v_n). The wind is a mean flow + gust envelope +
//   travelling turbulence (eddies advected downstream at the mean speed), so ripples run from hoist to fly the way they
//   do on a real flag. The hoist edge is pinned to the pole (which may move: a carried flag). Substeps at 360 Hz,
//   frames stored at 60 Hz and interpolated, so a still at any t equals the same frame of a render.
// Shading (one draw, double sided): wool-bunting weave that fades out before it aliases, a printed front and a mirrored
// back, light TRANSMITTED through the cloth when the sun is behind it (the red glows and the print reads as a dark
// silhouette through it, as on a real flag against the sun), fold occlusion from per-vertex concavity, sheen at grazing
// angles, a stitched hem, a frayed fly edge, and exp fog. The pole, finial, halyard and snap hooks are real geometry.
import * as THREE from 'three';

function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function vn3(x, y, z, s) {      // smooth value noise, [-1, 1]
  const h = (i, j, k) => { let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177) + Math.imul(s, 1442695041); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 2147483648 - 1; };
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), fx = x - i, fy = y - j, fz = z - k;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz), L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h(i, j, k), h(i + 1, j, k), u), L(h(i, j + 1, k), h(i + 1, j + 1, k), u), v), L(L(h(i, j, k + 1), h(i + 1, j, k + 1), u), L(h(i, j + 1, k + 1), h(i + 1, j + 1, k + 1), u), v), w);
}

// A print canvas: ground colour + your drawing (the ACP emblem, a slogan). Returned canvas is the flag's FRONT.
export function printCanvas({ w = 1536, h = 1024, ground = '#c8141c', draw = null } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = ground; x.fillRect(0, 0, w, h); if (draw) draw(x, w, h); return c;
}

export class Flag {
  constructor(scene, o = {}) {
    const { w = 3, h = 2, nx = 44, ny = 30, t0 = 0, t1 = 8, preroll = 2.5, hz = 360, fps = 60, iters = 4, seed = 1, mass = 0.2,
      pole = () => ({ base: [0, 0, 0], top: [0, 5, 0] }), wind = { dir: [1, 0, 0], speed: 10, gust: 0.4 }, art = null, color = '#c8141c',
      poleR = 0.03, drop = null, rho = 1.2, cd = 1.1, bend = 0.12 } = o;
    Object.assign(this, { w, h, nx, ny, t0, t1, fps, pole, windO: wind });
    this.drop = drop ?? h;                  // pinned length of the hoist edge from the top
    const N = (nx + 1) * (ny + 1); this.N = N;
    // ---------------------------------------------------------------- bake
    const P = new Float64Array(N * 3), Q = new Float64Array(N * 3), F = new Float64Array(N * 3), invM = new Float64Array(N);
    const id = (i, j) => j * (nx + 1) + i, dx = w / nx, dy = h / ny;
    const pinPos = (t, j, out) => {    // hoist edge: along the pole, from the top down
      const p = pole(t), a = p.top, b = p.base, L = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const s = Math.min(1, (j / ny) * this.drop / L) , off = 0.02 + poleR;
      out[0] = a[0] + (b[0] - a[0]) * s; out[1] = a[1] + (b[1] - a[1]) * s - 0.05; out[2] = a[2] + (b[2] - a[2]) * s;
      // offset from the pole axis toward the fly (downwind on the xz plane at rest)
      const wd = norm2(wind.dir); out[0] += wd[0] * off; out[2] += wd[2] * off; return out;
    };
    this.pinPos = pinPos;
    const tS = t0 - preroll, wd = norm3(wind.dir);
    // initial: hanging along the wind direction a little, slightly drooped
    const tmp = [0, 0, 0];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      pinPos(tS, j, tmp); const k = id(i, j) * 3, x = i * dx;
      P[k] = tmp[0] + wd[0] * x * 0.3; P[k + 1] = tmp[1] - x * 0.95; P[k + 2] = tmp[2] + wd[2] * x * 0.3 + Math.sin(i * 0.7 + j) * 0.01;
      Q[k] = P[k]; Q[k + 1] = P[k + 1]; Q[k + 2] = P[k + 2];
      invM[id(i, j)] = i === 0 ? 0 : 1 / (mass * dx * dy);
    }
    // constraints: [a, b, rest, stiffness]
    const C = []; const add = (a, b, k) => C.push(a, b, Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]) * 0 + 0, k);
    const cons = [];
    const link = (i0, j0, i1, j1, k) => { if (i1 > nx || j1 > ny || i1 < 0) return; cons.push([id(i0, j0), id(i1, j1), Math.hypot((i1 - i0) * dx, (j1 - j0) * dy), k]); };
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      link(i, j, i + 1, j, 1); link(i, j, i, j + 1, 1);
      link(i, j, i + 1, j + 1, 0.6); if (i > 0) link(i, j, i - 1, j + 1, 0.6);
      link(i, j, i + 2, j, bend); link(i, j, i, j + 2, bend);
    }
    void C; void add;
    const CA = new Int32Array(cons.length * 2), CR = new Float64Array(cons.length * 2);
    cons.forEach((c, k) => { CA[k * 2] = c[0]; CA[k * 2 + 1] = c[1]; CR[k * 2] = c[2]; CR[k * 2 + 1] = c[3]; });
    // triangles for aero + render
    const tri = []; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1); tri.push(a, c, b, b, c, d); }
    this.tri = tri;
    const dt = 1 / hz, damp = 0.998, g = -9.81, sub = Math.round(hz / fps);
    const nF = Math.ceil((t1 - t0) * fps) + 2; this.frames = new Float32Array(nF * N * 3); this.nF = nF;
    const gust = t => 1 + (wind.gust ?? 0.4) * (0.6 * vn3(t * 0.35, 0.5, 1.5, seed) + 0.4 * vn3(t * 1.1, 2.5, 4.5, seed + 3));
    const U = wind.speed, turb = wind.turb ?? 0.35;
    const windAt = (x, y, z, t, out) => {
      // eddies advected downstream at the mean speed: sample noise at p - U t along the wind
      const s = 0.45, ax = x - wd[0] * U * t, ay = y, az = z - wd[2] * U * t, gg = gust(t) * U;
      out[0] = wd[0] * gg + turb * U * vn3(ax * s, ay * s, az * s, seed + 11);
      out[1] = wd[1] * gg + turb * U * 0.6 * vn3(ax * s + 7, ay * s, az * s, seed + 12);
      out[2] = wd[2] * gg + turb * U * vn3(ax * s, ay * s + 5, az * s, seed + 13);
      if (wind.fn) wind.fn(x, y, z, t, out);
      return out;
    };
    this.windAt = windAt;
    let t = tS, frame = 0; const wv = [0, 0, 0];
    const steps = Math.ceil((t1 + 1 / fps - tS) * hz);
    const T = tri.length / 3, WC = new Float64Array(T * 3), wsub = Math.max(1, Math.round(hz / 60));
    for (let st = 0; st <= steps; st++) {
      // record
      if (t >= t0 - 1e-9 && frame < nF && st % sub === 0) { const o = frame * N * 3; for (let k = 0; k < N * 3; k++) this.frames[o + k] = P[k]; frame++; }
      // forces
      F.fill(0);
      for (let q = 0; q < T; q++) {
        const a = tri[q * 3], b = tri[q * 3 + 1], c = tri[q * 3 + 2];
        const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
        const e1x = P[b * 3] - ax, e1y = P[b * 3 + 1] - ay, e1z = P[b * 3 + 2] - az, e2x = P[c * 3] - ax, e2y = P[c * 3 + 1] - ay, e2z = P[c * 3 + 2] - az;
        let nx_ = e1y * e2z - e1z * e2y, ny_ = e1z * e2x - e1x * e2z, nz_ = e1x * e2y - e1y * e2x; const A2 = Math.hypot(nx_, ny_, nz_); if (A2 < 1e-12) continue;
        nx_ /= A2; ny_ /= A2; nz_ /= A2;
        const cx = ax + (e1x + e2x) / 3, cy = ay + (e1y + e2y) / 3, cz = az + (e1z + e2z) / 3;
        if (st % wsub === 0) { windAt(cx, cy, cz, t, wv); WC[q * 3] = wv[0]; WC[q * 3 + 1] = wv[1]; WC[q * 3 + 2] = wv[2]; }
        else { wv[0] = WC[q * 3]; wv[1] = WC[q * 3 + 1]; wv[2] = WC[q * 3 + 2]; }
        // cloth velocity (Verlet)
        const vx = (P[a * 3] + P[b * 3] + P[c * 3] - Q[a * 3] - Q[b * 3] - Q[c * 3]) / (3 * dt), vy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1] - Q[a * 3 + 1] - Q[b * 3 + 1] - Q[c * 3 + 1]) / (3 * dt), vz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2] - Q[a * 3 + 2] - Q[b * 3 + 2] - Q[c * 3 + 2]) / (3 * dt);
        const rx = wv[0] - vx, ry = wv[1] - vy, rz = wv[2] - vz, vn = rx * nx_ + ry * ny_ + rz * nz_;
        const f = 0.5 * rho * cd * (A2 * 0.5) * vn * Math.abs(vn) / 3;
        // plus a little skin friction along the relative flow (keeps the fly edge from stalling)
        const tf = 0.02 * rho * (A2 * 0.5) / 3;
        for (const v of [a, b, c]) { F[v * 3] += f * nx_ + tf * rx; F[v * 3 + 1] += f * ny_ + tf * ry; F[v * 3 + 2] += f * nz_ + tf * rz; }
      }
      // integrate
      for (let v = 0; v < N; v++) {
        const im = invM[v], k = v * 3; if (im === 0) continue;
        for (let c = 0; c < 3; c++) {
          const x = P[k + c], acc = F[k + c] * im + (c === 1 ? g : 0);
          P[k + c] = x + (x - Q[k + c]) * damp + acc * dt * dt; Q[k + c] = x;
        }
      }
      t += dt;
      // pins
      for (let j = 0; j <= ny; j++) { const k = id(0, j) * 3; pinPos(t, j, tmp); Q[k] = P[k]; Q[k + 1] = P[k + 1]; Q[k + 2] = P[k + 2]; P[k] = tmp[0]; P[k + 1] = tmp[1]; P[k + 2] = tmp[2]; }
      // constraints (Gauss-Seidel, alternating order)
      for (let it = 0; it < iters; it++) {
        const n = CA.length / 2;
        for (let kk = 0; kk < n; kk++) {
          const q = (it & 1) ? n - 1 - kk : kk, a = CA[q * 2], b = CA[q * 2 + 1], ia = invM[a], ib = invM[b], s = ia + ib; if (s === 0) continue;
          const dxv = P[b * 3] - P[a * 3], dyv = P[b * 3 + 1] - P[a * 3 + 1], dzv = P[b * 3 + 2] - P[a * 3 + 2], L = Math.sqrt(dxv * dxv + dyv * dyv + dzv * dzv) || 1e-9;
          let c = (L - CR[q * 2]) / L * CR[q * 2 + 1]; if (CR[q * 2 + 1] < 0.5 && L < CR[q * 2]) c *= 0.3;   // bend resists stretch more than folding
          const ka = c * ia / s, kb = c * ib / s;
          P[a * 3] += dxv * ka; P[a * 3 + 1] += dyv * ka; P[a * 3 + 2] += dzv * ka;
          P[b * 3] -= dxv * kb; P[b * 3 + 1] -= dyv * kb; P[b * 3 + 2] -= dzv * kb;
        }
      }
    }
    this.nF = frame;
    // ---------------------------------------------------------------- render geometry
    // render grid: the sim grid upsampled x`up` with Catmull-Rom (smooth silhouettes and folds at close range)
    const up = this.up = o.up ?? 2, RX = nx * up, RY = ny * up, RN = (RX + 1) * (RY + 1); this.RX = RX; this.RY = RY; this.RN = RN;
    const rid = (i, j) => j * (RX + 1) + i;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(RN * 3), 3); this.pos.setUsage(THREE.DynamicDrawUsage);
    this.fold = new THREE.BufferAttribute(new Float32Array(RN), 1); this.fold.setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array(RN * 2); for (let j = 0; j <= RY; j++) for (let i = 0; i <= RX; i++) { uv[rid(i, j) * 2] = i / RX; uv[rid(i, j) * 2 + 1] = 1 - j / RY; }
    const rtri = []; for (let j = 0; j < RY; j++) for (let i = 0; i < RX; i++) { const a = rid(i, j), b = rid(i + 1, j), c = rid(i, j + 1), d = rid(i + 1, j + 1); rtri.push(a, c, b, b, c, d); }
    geo.setAttribute('position', this.pos); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('aFold', this.fold);
    geo.setIndex(rtri); this.geo = geo; this._row = new Float32Array((RX + 1) * (ny + 1) * 3); this._cur = new Float32Array(N * 3); this._f2 = new Float32Array(RN);
    const tex = art ? new THREE.CanvasTexture(art) : null; if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; }
    this.uni = {
      uArt: { value: tex }, uHasArt: { value: tex ? 1 : 0 }, uColor: { value: new THREE.Color(color) }, uSize: { value: new THREE.Vector2(w, h) },
      uSun: { value: new THREE.Vector3(0.3, 0.5, -0.8).normalize() }, uSunC: { value: new THREE.Color(3.2, 2.4, 1.8) },
      uSky: { value: new THREE.Color(0.35, 0.38, 0.5) }, uGnd: { value: new THREE.Color(0.2, 0.15, 0.1) },
      uFogC: { value: new THREE.Color(0.5, 0.45, 0.45) }, uFogD: { value: 0.0 }, uTrans: { value: 1.0 }, uWeave: { value: new THREE.Vector2(110, 75) },
      uFray: { value: 1 }, uSeed: { value: seed }, uDirt: { value: o.dirt ?? 0.25 }, uInk: { value: o.ink ?? 0.9 },
    };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uni, side: THREE.DoubleSide, vertexShader: FLAG_VS, fragmentShader: FLAG_FS, extensions: { derivatives: true } });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.userData.subject = 1;
    this.mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    scene.add(this.mesh);
    // pole, finial, halyard, snap hooks
    this.poleGroup = new THREE.Group(); scene.add(this.poleGroup);
    const metal = new THREE.MeshStandardMaterial({ color: o.poleColor || '#8d8a86', metalness: 0.85, roughness: 0.32 });
    const gold = new THREE.MeshStandardMaterial({ color: '#c99a3a', metalness: 1, roughness: 0.25 });
    this.poleMesh = new THREE.Mesh(new THREE.CylinderGeometry(poleR * 0.85, poleR, 1, 20, 1), o.poleMat || metal); this.poleMesh.castShadow = true;
    const fin = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(poleR * 2.3, 24, 16), gold); ball.position.y = poleR * 2.6; fin.add(ball);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(poleR * 1.3, poleR * 1.3, poleR * 1.2, 20), gold); collar.position.y = poleR * 0.3; fin.add(collar);
    if (o.spear) { const sp = new THREE.Mesh(new THREE.ConeGeometry(poleR * 1.6, poleR * 9, 4), gold); sp.position.y = poleR * 8; sp.rotation.y = Math.PI / 4; sp.scale.z = 0.35; fin.add(sp); }
    this.finial = fin;
    this.poleGroup.add(this.poleMesh, fin);
    this.hooks = []; for (const j of [0, ny]) { const hk = new THREE.Mesh(new THREE.TorusGeometry(poleR * 1.25, poleR * 0.22, 8, 20), metal); this.poleGroup.add(hk); this.hooks.push({ j, m: hk }); }
    this._n = new Float32Array(N * 3);
  }
  setLight({ sun, sunColor, sky, ground, fog, fogDensity, trans } = {}) {
    if (sun) this.uni.uSun.value.copy(sun).normalize(); if (sunColor) this.uni.uSunC.value.copy(sunColor);
    if (sky) this.uni.uSky.value.copy(sky); if (ground) this.uni.uGnd.value.copy(ground); if (fog) this.uni.uFogC.value.copy(fog);
    if (fogDensity != null) this.uni.uFogD.value = fogDensity; if (trans != null) this.uni.uTrans.value = trans;
    return this;
  }
  update(t) {
    const f = Math.max(0, Math.min(this.nF - 1.001, (t - this.t0) * this.fps)), i = Math.floor(f), u = f - i, N = this.N;
    const A = this.frames, o0 = i * N * 3, o1 = Math.min(this.nF - 1, i + 1) * N * 3, cur = this._cur;
    for (let k = 0; k < N * 3; k++) cur[k] = A[o0 + k] + (A[o1 + k] - A[o0 + k]) * u;
    // Catmull-Rom upsample: along i (per sim row), then along j
    const up = this.up, nx0 = this.nx, ny0 = this.ny, RX = this.RX, RY = this.RY, row = this._row, p = this.pos.array;
    const cr = (a, b, c, d, x) => 0.5 * (2 * b + (-a + c) * x + (2 * a - 5 * b + 4 * c - d) * x * x + (-a + 3 * b - 3 * c + d) * x * x * x);
    for (let j = 0; j <= ny0; j++) for (let I = 0; I <= RX; I++) {
      const fi = I / up, i0 = Math.min(nx0 - 1, Math.floor(fi)), x = fi - i0, g = k => j * (nx0 + 1) + Math.max(0, Math.min(nx0, k));
      for (let c = 0; c < 3; c++) row[(j * (RX + 1) + I) * 3 + c] = cr(cur[g(i0 - 1) * 3 + c], cur[g(i0) * 3 + c], cur[g(i0 + 1) * 3 + c], cur[g(i0 + 2) * 3 + c], x);
    }
    for (let J = 0; J <= RY; J++) for (let I = 0; I <= RX; I++) {
      const fj = J / up, j0 = Math.min(ny0 - 1, Math.floor(fj)), y = fj - j0, g = k => Math.max(0, Math.min(ny0, k)) * (RX + 1) + I;
      for (let c = 0; c < 3; c++) p[(J * (RX + 1) + I) * 3 + c] = cr(row[g(j0 - 1) * 3 + c], row[g(j0) * 3 + c], row[g(j0 + 1) * 3 + c], row[g(j0 + 2) * 3 + c], y);
    }
    this.pos.needsUpdate = true; this.geo.computeVertexNormals();
    // fold occlusion: concavity = how far the 4-neighbour mean sits in front of / behind the vertex along its normal
    const nx = this.RX, ny = this.RY, n = this.geo.attributes.normal.array, fo = this._f2;
    for (let j = 0; j <= ny; j++) for (let i2 = 0; i2 <= nx; i2++) {
      const k = j * (nx + 1) + i2; let mx = 0, my = 0, mz = 0, c = 0;
      for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const ii = i2 + a, jj = j + b; if (ii < 0 || jj < 0 || ii > nx || jj > ny) continue; const q = (jj * (nx + 1) + ii) * 3; mx += p[q]; my += p[q + 1]; mz += p[q + 2]; c++; }
      mx = mx / c - p[k * 3]; my = my / c - p[k * 3 + 1]; mz = mz / c - p[k * 3 + 2];
      fo[k] = (mx * n[k * 3] + my * n[k * 3 + 1] + mz * n[k * 3 + 2]) / (this.w / nx) * 2.4;     // + = concave on the front side
    }
    // smooth it (two box passes), so the occlusion follows folds, not grid cells
    const F2 = this.fold.array;
    for (let pass = 0; pass < 2; pass++) { const src = pass ? F2 : fo, dst = pass ? fo : F2;
      for (let j = 0; j <= ny; j++) for (let i2 = 0; i2 <= nx; i2++) { let s = 0, c = 0; for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) { const ii = i2 + a, jj = j + b; if (ii < 0 || jj < 0 || ii > nx || jj > ny) continue; s += src[jj * (nx + 1) + ii]; c++; } dst[j * (nx + 1) + i2] = s / c; } }
    F2.set(fo);
    this.fold.needsUpdate = true;
    // pole + hardware
    const P = this.pole(t), a = new THREE.Vector3(...P.base), b = new THREE.Vector3(...P.top), d = b.clone().sub(a), L = d.length();
    this.poleMesh.position.copy(a).addScaledVector(d, 0.5); this.poleMesh.scale.set(1, L, 1);
    this.poleMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    this.finial.position.copy(b); this.finial.quaternion.copy(this.poleMesh.quaternion);
    for (const hk of this.hooks) { const q = hk.j * this.up * (nx + 1) * 3; hk.m.position.set(p[q], p[q + 1], p[q + 2]); hk.m.quaternion.copy(this.poleMesh.quaternion); hk.m.rotateX(Math.PI / 2); }
    return this;
  }
}

const FLAG_VS = /* glsl */`
attribute float aFold; varying vec2 vUv; varying vec3 vN, vW; varying float vFold;
void main(){
  vUv = uv; vFold = aFold; vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FLAG_FS = /* glsl */`
uniform sampler2D uArt; uniform float uHasArt, uFogD, uTrans, uFray, uSeed, uDirt, uInk; uniform vec3 uColor, uSun, uSunC, uSky, uGnd, uFogC; uniform vec2 uSize, uWeave;
varying vec2 vUv; varying vec3 vN, vW; varying float vFold;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec3 V = normalize(cameraPosition - vW);
  bool front = gl_FrontFacing;
  vec3 N = normalize(vN) * (front ? 1.0 : -1.0);
  vec2 uv = vUv; vec2 m = uv * uSize;                 // metres on the cloth
  // fly-edge fray: threads pulled out of the last few cm, and a slightly ragged hem
  float fray = (1.0 - uv.x) * uSize.x;
  float rag = 0.012 + 0.035 * uFray * pow(vn(vec2(m.y * 30.0, 1.0)), 3.0) + 0.02 * uFray * step(0.93, h21(vec2(floor(m.y * 160.0), 3.0)));
  if (fray < rag) discard;
  // print: front reads the art, back reads it mirrored (printed through) and a little weaker
  vec2 auv = front ? uv : vec2(uv.x, uv.y);
  vec3 base = uColor; float ink = 0.0;
  if (uHasArt > 0.5) { vec4 a = texture2D(uArt, vec2(auv.x, 1.0 - auv.y)); vec3 ac = a.rgb; ink = clamp(length(ac - uColor) * 2.0, 0.0, 1.0); base = mix(ac, mix(ac, uColor, 0.35), front ? 0.0 : 0.4); }
  // weave: warp/weft threads of wool bunting, faded out by screen-space frequency (no moire)
  vec2 wv = m * uWeave; vec2 fw = fwidth(wv); float fade = 1.0 - smoothstep(0.25, 0.6, max(fw.x, fw.y));
  float th = 0.5 + 0.5 * sin(wv.x * 6.2832) * sin(wv.y * 6.2832 + 1.57 * step(0.5, fract(wv.x * 0.5)));
  float slub = vn(vec2(m.x * 9.0, m.y * 220.0)) * 0.5 + vn(vec2(m.x * 260.0, m.y * 7.0)) * 0.5;
  base *= mix(1.0, 0.86 + 0.2 * th, fade) * (0.94 + 0.1 * slub);
  // hem (double fabric) and a stitch line 18 mm in from the edges
  float e = min(min(m.x, uSize.x - m.x), min(m.y, uSize.y - m.y));
  float hem = step(e, 0.035); base *= 1.0 - 0.14 * hem;
  float stitch = smoothstep(0.003, 0.0, abs(e - 0.02)) * step(0.4, fract((m.x + m.y) * 90.0)); base = mix(base, base * 0.55, stitch * 0.6);
  // hoist sleeve: canvas heading strip
  float head = step(m.x, 0.06); base = mix(base, vec3(0.78, 0.74, 0.66) * (0.8 + 0.2 * th), head);
  // weathering: sun-bleach toward the fly, grime near the hoist
  base = mix(base, base * vec3(1.05, 0.95, 0.9) + 0.03, uDirt * smoothstep(0.4, 1.0, uv.x) * 0.5);
  base *= 1.0 - uDirt * 0.25 * vn(m * 3.0);
  // lighting
  vec3 L = normalize(uSun);
  float ndl = dot(N, L);
  float diff = max(ndl, 0.0);
  float occ = clamp(1.0 - max(vFold, 0.0) * 2.2, 0.25, 1.0) * clamp(1.0 + min(vFold, 0.0) * 0.6, 0.7, 1.0);
  vec3 amb = mix(uGnd, uSky, 0.5 + 0.5 * N.y) * occ;
  // transmission: light through the cloth from behind; ink blocks it (the emblem reads as a silhouette)
  float back = max(-ndl, 0.0);
  float trans = uTrans * back * (1.0 - uInk * ink * 0.85) * (1.0 - 0.5 * hem - 0.7 * head);
  vec3 tcol = uColor * uColor * 1.4 + 0.02;                           // deep, saturated transmitted red
  float vd = pow(max(dot(-V, L), 0.0), 3.0);                           // looking into the sun: forward scatter
  vec3 col = base * (uSunC * diff * occ + amb) + tcol * uSunC * trans * (0.35 + 0.9 * vd) * mix(1.0, 0.8 + 0.4 * th, fade);
  // sheen (fibre retro-reflection at grazing angles)
  float nv = max(dot(N, V), 0.0); col += uSunC * base * 0.35 * pow(1.0 - nv, 4.0) * diff;
  // fog
  float d = length(cameraPosition - vW); col = mix(col, uFogC, 1.0 - exp(-d * uFogD));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function norm2(v) { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; }
function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
