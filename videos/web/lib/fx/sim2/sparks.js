// SPARKS (sim2): physically based sparks, spatter, slag and embers for three.js scenes. Stateless in t.
//
//   import { Sparks, blackbody } from '../lib/fx/sim2/sparks.js';
//   const sp = new Sparks(scene, { max: 8000, ground: 0, viewH: RH });
//   sp.burst({ t0: 1.2, pos: [0, 1, 0], dir: [1, 0.3, 0], spread: 0.35, n: 900, kind: 'grind', seed: 3 });
//   sp.stream({ t0: 0, t1: 4, rate: 1500, pos: [..], dir: [..], kind: 'grind', seed: 9 });   // a continuous jet
//   sp.embers({ t0: 0, t1: 8, rate: 40, box: [[x0, y0, z0], [x1, y1, z1]], seed: 2 });
//   sp.update(t, camera);            // once per frame, before renderer.render
//   const L = sp.light(t);           // { pos: Vector3, power, color } -> drive a PointLight so sparks light the worker
//
// Physics (per spark, closed form, no integration):
//   linear drag with a size-dependent coefficient k: v(a) = vt + (v0 - vt) e^(-k a), vt = g / k,
//   p(a) = p0 + vt a + (v0 - vt)(1 - e^(-k a)) / k. Ground contacts are solved exactly (the height is unimodal in a),
//   then the spark bounces with restitution + friction + scatter, and comes to rest on the floor, still glowing.
//   Carbon-steel grinding sparks BURST: part-way through their flight a share of them fork into 3-7 short hot
//   children (the "star" branching real carbon-steel sparks show; stainless and weld spatter do not).
//   Temperature T(a) = Tamb + (T0 - Tamb) e^(-a / tau), tau proportional to size; colour and radiance from a Planck
//   blackbody fit (radiance ~ (T/T0)^4 above ~850 K, invisible below), so sparks go white -> yellow -> orange -> dull red.
// Rendering: one instanced draw. Each spark is two motion-blurred sub-segments p(t - shutter) -> p(t - shutter/2) -> p(t)
// (so bounces bend the streak), drawn as screen-space capsules with an analytic antialiased gaussian core, at least
// `widthPx` wide (VISUAL_BIBLE §1.10: no GL lines). Additive, depth-tested against the scene, HDR (tone-mapped by three).
// Everything is precomputed per event at registration (deterministic from the seed); update(t) only evaluates.
import * as THREE from 'three';

const G = -9.81;
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Planck-ish blackbody colour (linear sRGB, max channel = 1) for T in kelvin (fit of the CIE 1931 locus, 1000-12000 K)
export function blackbody(T, out = [0, 0, 0]) {
  const t = T / 100;
  let r, g, b;
  if (t <= 66) { r = 1; g = Math.min(1, Math.max(0, (99.47 * Math.log(t) - 161.12) / 255)); }
  else { r = Math.min(1, 329.7 * Math.pow(t - 60, -0.1332) / 255); g = Math.min(1, 288.1 * Math.pow(t - 60, -0.0755) / 255); }
  if (t >= 66) b = 1; else if (t <= 19) b = 0; else b = Math.min(1, Math.max(0, (138.5 * Math.log(t - 10) - 305.04) / 255));
  // to linear
  out[0] = Math.pow(r, 2.2); out[1] = Math.pow(g, 2.2); out[2] = Math.pow(b, 2.2);
  return out;
}

// kinds: speed (m/s), size (mm), T0 (K), drag scale, bounce, burst probability, life (s)
export const KINDS = {
  grind: { speed: [14, 34], size: [0.08, 0.45], T0: [1900, 2350], drag: 1.0, rest: 0.32, fric: 0.55, burst: 0.34, life: [0.35, 1.1], w: 1.0 },
  weld: { speed: [1.5, 6.5], size: [0.25, 1.1], T0: [1850, 2200], drag: 0.35, rest: 0.42, fric: 0.7, burst: 0.0, life: [0.8, 2.6], w: 1.25 },
  pour: { speed: [2.5, 8], size: [0.6, 2.4], T0: [1750, 1950], drag: 0.18, rest: 0.18, fric: 0.5, burst: 0.08, life: [1.2, 3.2], w: 1.9 },
  strike: { speed: [4, 15], size: [0.3, 1.4], T0: [1400, 1650], drag: 0.6, rest: 0.3, fric: 0.6, burst: 0.12, life: [0.5, 1.6], w: 1.35 },
  cut: { speed: [8, 22], size: [0.2, 0.9], T0: [2000, 2500], drag: 0.5, rest: 0.25, fric: 0.6, burst: 0.2, life: [0.6, 1.8], w: 1.2 },
};

// one ballistic segment: starts at absolute time ts at p0 with v0, drag k
function segPos(s, a, out) {
  const k = s.k, e = Math.exp(-k * a), vty = G / k, f = (1 - e) / k;
  out[0] = s.p[0] + s.v[0] * f; out[1] = s.p[1] + vty * a + (s.v[1] - vty) * f; out[2] = s.p[2] + s.v[2] * f;
  return out;
}
function segVel(s, a, out) {
  const e = Math.exp(-s.k * a), vty = G / s.k;
  out[0] = s.v[0] * e; out[1] = vty + (s.v[1] - vty) * e; out[2] = s.v[2] * e; return out;
}

export class Sparks {
  constructor(scene, { max = 8000, ground = 0, viewH = 1920, widthPx = 2.6, shutter = 1 / 50, gain = 1, tAmb = 700, floorGlow = 1 } = {}) {
    this.max = max; this.ground = ground; this.viewH = viewH; this.widthPx = widthPx; this.shutter = shutter; this.gain = gain; this.tAmb = tAmb; this.floorGlow = floorGlow;
    this.parts = [];      // {t0, life, T0, tau, size, segs:[{ts, p, v, k, rest}], kind}
    this.emb = [];
    const q = new THREE.PlaneGeometry(1, 1); q.translate(0.5, 0, 0);
    const g = new THREE.InstancedBufferGeometry(); g.index = q.index; g.attributes.position = q.attributes.position;
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(max * 2 * 3), 3); this.aA.setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(max * 2 * 3), 3); this.aB.setUsage(THREE.DynamicDrawUsage);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(max * 2 * 4), 4); this.aC.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aA', this.aA); g.setAttribute('aB', this.aB); g.setAttribute('aC', this.aC);
    g.instanceCount = 0; this.geo = g;
    this.uni = { uRes: { value: new THREE.Vector2(1080, 1920) }, uW: { value: widthPx } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uni, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: true,
      vertexShader: /* glsl */`
        attribute vec3 aA, aB; attribute vec4 aC; uniform vec2 uRes; uniform float uW;
        varying vec2 vL; varying float vLen; varying vec4 vC; varying float vHW;
        void main(){
          vec4 ca = projectionMatrix * modelViewMatrix * vec4(aA, 1.0), cb = projectionMatrix * modelViewMatrix * vec4(aB, 1.0);
          if (ca.w < 0.05 || cb.w < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec2 sa = ca.xy / ca.w * 0.5 * uRes, sb = cb.xy / cb.w * 0.5 * uRes;
          vec2 d = sb - sa; float L = length(d); vec2 dir = L > 1e-3 ? d / L : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
          float hw = max(uW, aC.w * projectionMatrix[1][1] * 0.5 * uRes.y / ca.w) * 0.5 + 1.0;        // physical size or the minimum line width
          float along = position.x * (L + 2.0 * hw) - hw, across = position.y * 2.0 * hw;
          vec2 s = sa + dir * along + nrm * across;
          float w = mix(ca.w, cb.w, clamp(position.x, 0.0, 1.0)), z = mix(ca.z / ca.w, cb.z / cb.w, clamp(position.x, 0.0, 1.0));
          gl_Position = vec4(s / (0.5 * uRes) * w, z * w, w);
          vL = vec2(along, across); vLen = L; vHW = hw;
          // energy spread along the streak: a long streak is dimmer per pixel, but never below 35% (saturated film)
          vC = vec4(aC.rgb * clamp(6.0 * hw / (L + 2.0 * hw), 0.35, 1.0), 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vL; varying float vLen; varying vec4 vC; varying float vHW;
        void main(){
          float t = clamp(vL.x, 0.0, vLen); float d = length(vec2(vL.x - t, vL.y));
          float r = vHW - 1.0; float core = exp(-d * d / max(0.3, r * r * 0.35)); float halo = exp(-d / max(0.8, r * 1.2)) * 0.25;
          float a = (core + halo) * smoothstep(vHW, vHW - 1.0, d);
          if (a < 0.003) discard;
          // hotter core: push toward white in the centre
          vec3 c = vC.rgb * a + vec3(max(max(vC.r, vC.g), vC.b)) * core * core * 0.15;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 10; this.mesh.userData.gbuffer = false;
    scene.add(this.mesh);
    this._p = [0, 0, 0]; this._q = [0, 0, 0]; this._c = [0, 0, 0];
    this._light = { pos: new THREE.Vector3(), power: 0, color: new THREE.Color() };
  }

  // ---------------------------------------------------------------- registration
  // A burst: n sparks at t0 from pos, in a cone of half-angle `spread` around dir. o.jitterT spreads them in time.
  burst(o) {
    const K = { ...KINDS[o.kind || 'grind'], ...(o.over || {}) }, r = mulberry((o.seed || 1) * 9973 + 17);
    const n = o.n || 300, dir = norm(o.dir || [0, 1, 0]), spread = o.spread ?? 0.4, jt = o.jitterT || 0;
    const [u, w] = basis(dir);
    for (let i = 0; i < n; i++) {
      // cone sample, biased toward the axis (sparks leave a wheel as a sheet)
      const th = spread * Math.sqrt(r()) * (o.flat ? 1 : 1), ph = r() * Math.PI * 2;
      const fl = o.flat ? [Math.cos(ph) * (1 - o.flat), Math.sin(ph)] : [Math.cos(ph), Math.sin(ph)];
      const s = Math.sin(th), c = Math.cos(th);
      const d = [dir[0] * c + (u[0] * fl[0] + w[0] * fl[1]) * s, dir[1] * c + (u[1] * fl[0] + w[1] * fl[1]) * s, dir[2] * c + (u[2] * fl[0] + w[2] * fl[1]) * s];
      const sp = lerp(K.speed[0], K.speed[1], Math.pow(r(), 0.7)) * (o.speedK || 1);
      const p0 = o.posFn ? o.posFn(r) : [o.pos[0] + (r() - 0.5) * (o.radius || 0), o.pos[1] + (r() - 0.5) * (o.radius || 0), o.pos[2] + (r() - 0.5) * (o.radius || 0)];
      this._add(K, r, (o.t0 || 0) + r() * jt, p0, [d[0] * sp, d[1] * sp, d[2] * sp], o, 0);
    }
    if (!o._noSort) this._sort();
    return this;
  }
  // a continuous jet from t0 to t1 at `rate` sparks/s (a grinder, a cutting torch, a tap hole), optional moving pos/dir
  stream(o) {
    const n = Math.round((o.t1 - o.t0) * (o.rate || 800)), r = mulberry((o.seed || 1) * 31337 + 5);
    for (let i = 0; i < n; i++) {
      const t0 = o.t0 + (i + r()) / n * (o.t1 - o.t0);
      const pos = typeof o.pos === 'function' ? o.pos(t0) : o.pos, dir = typeof o.dir === 'function' ? o.dir(t0) : o.dir;
      const env = o.env ? o.env(t0) : 1; if (r() > env) continue;
      this.burst({ ...o, t0, pos, dir, n: 1, seed: (o.seed || 1) * 100003 + i, jitterT: 0, _noSort: true });
    }
    this._sort(); return this;
  }
  // embers: buoyant, turbulent, long-lived, flickering (a forge, a burning banner, a mill yard at night)
  embers(o) {
    const r = mulberry((o.seed || 1) * 7919 + 3), n = Math.round((o.t1 - o.t0) * (o.rate || 30)), [A, Bx] = o.box;
    for (let i = 0; i < n; i++) {
      const t0 = o.t0 + r() * (o.t1 - o.t0) - (o.preroll || 0) * r();
      this.emb.push({ t0, life: lerp(2.5, 7, r()), p: [lerp(A[0], Bx[0], r()), lerp(A[1], Bx[1], r()), lerp(A[2], Bx[2], r())],
        v: [(o.wind || [0, 0, 0])[0] + (r() - 0.5) * 0.4, (o.rise ?? 0.9) * lerp(0.5, 1.4, r()), (o.wind || [0, 0, 0])[2] + (r() - 0.5) * 0.4],
        ph: [r() * 6.28, r() * 6.28, r() * 6.28], fr: [lerp(0.6, 1.8, r()), lerp(0.9, 2.6, r()), lerp(0.5, 1.7, r())], amp: lerp(0.15, 0.6, r()) * (o.turb ?? 1),
        T0: lerp(1250, 1600, r()), size: lerp(0.4, 1.6, r()) * (o.size || 1), fl: r() * 100 });
    }
    return this;
  }

  _add(K, r, t0, p0, v0, o, gen) {
    const size = lerp(K.size[0], K.size[1], r() * r()) * (gen ? 0.55 : 1);     // mm; small sizes dominate
    const k = K.drag * 2.2 / Math.max(0.05, size) * (o.dragK || 1);           // small particles slow faster
    const life = (gen ? lerp(0.05, 0.16, r()) : lerp(K.life[0], K.life[1], r())) * (o.lifeK || 1);
    const T0 = (gen ? 2500 + 250 * r() : lerp(K.T0[0], K.T0[1], r())) * (o.tempK || 1);
    const part = { t0, life, T0, tau: (gen ? 0.07 : 0.18 + 0.9 * size / 1.2) * (o.coolK || 1), size, segs: [], w: K.w, gen };
    // flight segments with ground bounces
    let ts = 0, p = p0.slice(), v = v0.slice(); const q = [0, 0, 0];
    const gy = o.ground ?? this.ground;
    for (let b = 0; b < 4; b++) {
      const s = { ts, p: p.slice(), v: v.slice(), k, rest: false }; part.segs.push(s);
      // time to hit the ground from this segment (height unimodal): apex then bisection
      const vty = G / k; let aA = 0; if (v[1] > 0) aA = Math.log((v[1] - vty) / -vty) / k;
      const aMax = life - ts; if (aMax <= 0) break;
      if (segPos(s, Math.min(aA, aMax), q)[1] < gy && p[1] >= gy) { /* already below */ }
      if (segPos(s, aMax, q)[1] > gy) break;          // never lands within its life
      let lo = Math.min(aA, aMax), hi = aMax; for (let it = 0; it < 26; it++) { const m = (lo + hi) / 2; if (segPos(s, m, q)[1] > gy) lo = m; else hi = m; }
      const ah = (lo + hi) / 2; segPos(s, ah, q); const vv = segVel(s, ah, [0, 0, 0]);
      ts += ah; p = [q[0], gy + 1e-4, q[2]];
      const e = K.rest * lerp(0.6, 1.2, r()), f = K.fric * lerp(0.7, 1.1, r()), sc = 0.35 * Math.hypot(vv[0], vv[2]);
      v = [vv[0] * f + (r() - 0.5) * sc, -vv[1] * e, vv[2] * f + (r() - 0.5) * sc];
      if (Math.abs(v[1]) < 0.25) { part.segs.push({ ts, p, v: [0, 0, 0], k: 1, rest: true }); break; }
    }
    this.parts.push(part);
    // carbon burst: fork into short, hotter children part-way along the flight
    if (!gen && K.burst > 0 && r() < K.burst * (o.burstK ?? 1)) {
      const ab = life * lerp(0.25, 0.75, r()), P = this._at(part, ab, [0, 0, 0]), V = this._vel(part, ab, [0, 0, 0]);
      const m = 3 + Math.floor(r() * 5), sp = lerp(2, 5, r());
      for (let j = 0; j < m; j++) {
        const d = norm([r() - 0.5, r() - 0.5, r() - 0.5]);
        this._add(K, r, t0 + ab, P.slice(), [V[0] * 0.6 + d[0] * sp, V[1] * 0.6 + d[1] * sp, V[2] * 0.6 + d[2] * sp], o, 1);
      }
      part.life = Math.min(part.life, ab + 0.01);    // the parent is consumed by the burst
    }
  }
  _sort() { this.parts.sort((a, b) => a.t0 - b.t0); this._maxSpan = 0; for (const p of this.parts) this._maxSpan = Math.max(this._maxSpan, p.life + 8 * p.tau); }
  _seg(part, a) { let s = part.segs[0]; for (const x of part.segs) { if (x.ts <= a) s = x; else break; } return s; }
  _at(part, a, out) { const s = this._seg(part, a); if (s.rest) { out[0] = s.p[0]; out[1] = s.p[1]; out[2] = s.p[2]; return out; } return segPos(s, a - s.ts, out); }
  _vel(part, a, out) { const s = this._seg(part, a); if (s.rest) { out[0] = out[1] = out[2] = 0; return out; } return segVel(s, a - s.ts, out); }

  // ---------------------------------------------------------------- per frame
  update(t, camera, renderer) {
    if (renderer) { const v = renderer.getDrawingBufferSize(new THREE.Vector2()); this.uni.uRes.value.copy(v); }
    const A = this.aA.array, Bv = this.aB.array, C = this.aC.array, sh = this.shutter;
    const p0 = [0, 0, 0], p1 = [0, 0, 0], p2 = [0, 0, 0], col = this._c;
    let n = 0; const Lp = this._light.pos.set(0, 0, 0); let Lw = 0; const Lc = [0, 0, 0];
    const put = (a, b, c, i4) => { A[n * 3] = a[0]; A[n * 3 + 1] = a[1]; A[n * 3 + 2] = a[2]; Bv[n * 3] = b[0]; Bv[n * 3 + 1] = b[1]; Bv[n * 3 + 2] = b[2];
      C[n * 4] = c[0]; C[n * 4 + 1] = c[1]; C[n * 4 + 2] = c[2]; C[n * 4 + 3] = i4; n++; };
    const cap = this.max * 2;
    const PS = this.parts; let lo = 0, hi = PS.length; const tmin = t - (this._maxSpan || 10);
    while (lo < hi) { const m = (lo + hi) >> 1; if (PS[m].t0 < tmin) lo = m + 1; else hi = m; }
    for (let pi = lo; pi < PS.length; pi++) {
      const P = PS[pi]; const a = t - P.t0; if (a < 0) break;
      // after the flight, a resting spark keeps glowing on the floor while it cools; otherwise it dies at life
      const s = this._seg(P, a); const alive = a < P.life || (s.rest && a < P.life + 2.5 * P.tau * 3);
      if (!alive || n + 2 > cap) continue;
      const T = this.tAmb + (P.T0 - this.tAmb) * Math.exp(-a / P.tau) + (P.gen ? 0 : 120 * Math.sin(Math.min(1, a / P.life) * Math.PI));
      if (T < 820) continue;
      const rad = Math.pow(Math.max(0, (T - 780) / (P.T0 - 780)), 3.2) * (P.gen ? 1.8 : 1) * this.gain * (s.rest ? 0.6 * this.floorGlow : 1);
      if (rad < 0.004) continue;
      blackbody(T, col); const k = rad * 9.0 * P.w; col[0] *= k; col[1] *= k; col[2] *= k;
      const ta = Math.max(0, a - sh);
      this._at(P, ta, p0); this._at(P, (ta + a) / 2, p1); this._at(P, a, p2);
      const sz = P.size * 0.001 * P.w;
      put(p0, p1, col, sz); put(p1, p2, col, sz);
      Lp.x += p2[0] * rad; Lp.y += p2[1] * rad; Lp.z += p2[2] * rad; Lw += rad; Lc[0] += col[0]; Lc[1] += col[1]; Lc[2] += col[2];
    }
    for (const E of this.emb) {
      const a = t - E.t0; if (a < 0 || a > E.life || n + 2 > cap) continue;
      const pos = (aa, o) => { for (let i = 0; i < 3; i++) o[i] = E.p[i] + E.v[i] * aa + E.amp * (Math.sin(E.fr[i] * aa + E.ph[i]) - Math.sin(E.ph[i]) + 0.5 * Math.sin(E.fr[(i + 1) % 3] * 2.3 * aa + E.ph[(i + 2) % 3]) - 0.5 * Math.sin(E.ph[(i + 2) % 3])); return o; };
      const u = a / E.life, T = E.T0 * (1 - 0.35 * u) * (0.9 + 0.1 * Math.sin(E.fl + a * 23) * Math.sin(E.fl * 1.7 + a * 9));
      const rad = Math.pow(Math.max(0, (T - 780) / 800), 2.4) * Math.min(1, a * 3) * Math.min(1, (1 - u) * 4) * this.gain;
      if (rad < 0.004) continue;
      blackbody(T, col); const k = rad * 3.5; col[0] *= k; col[1] *= k; col[2] *= k;
      pos(Math.max(0, a - sh), p0); pos(a - sh / 2, p1); pos(a, p2);
      put(p0, p1, col, E.size * 0.001); put(p1, p2, col, E.size * 0.001);
    }
    this.geo.instanceCount = n;
    this.aA.needsUpdate = this.aB.needsUpdate = this.aC.needsUpdate = true;
    this.aA.clearUpdateRanges?.(); this.aA.addUpdateRange?.(0, n * 3); this.aB.clearUpdateRanges?.(); this.aB.addUpdateRange?.(0, n * 3); this.aC.clearUpdateRanges?.(); this.aC.addUpdateRange?.(0, n * 4);
    if (Lw > 0) Lp.multiplyScalar(1 / Lw);
    this._light.power = Lw; const m = Math.max(Lc[0], Lc[1], Lc[2], 1e-6); this._light.color.setRGB(Lc[0] / m, Lc[1] / m, Lc[2] / m);
    this.count = n / 2;
    return this;
  }
  light() { return this._light; }
}

// ---------------------------------------------------------------- helpers
function lerp(a, b, x) { return a + (b - a) * x; }
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function basis(d) { const a = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; const u = norm([d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]]);
  const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]; return [u, w]; }
