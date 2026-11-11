// STREAKS: velocity-stretched instanced quads on raw WebGL2 (VISUAL_BIBLE §1.10 `streaks.js`).
// Every mark is an ink core with a spectral fringe (red outside -> yellow -> green -> blue inside),
// multiply-blended onto a white field, so overlaps darken like ink and draw order never matters.
//   const sk = new Streaks();                         // owns an offscreen 1080x1920 WebGL2 canvas
//   const f = sk.field(n, seed);                      // n forward streak points (instanced)
//   const s = sk.segments(Float32Array, count);       // 3D segments: rebar, tie wire, pulses, tubes
//   sk.begin([0.97,0.97,0.95]); sk.drawField(f, u); sk.drawSegs(s, u); ctx.drawImage(sk.canvas, 0, 0);
// Stateless: every uniform is a pure function of t, so --stills and --from renders match a full render.
import { W, H, rng } from '../kit.js';

const PRISM = `
vec3 prism(float d, float core, float fr, float ink) {
  // d: px from the centre line; core: ink half-width px; fr: fringe width px
  float x = (d - core) / max(fr, 0.001);
  float aa = 0.8 / max(fr, 0.001);
  vec3 blue = vec3(0.25, 0.38, 1.0), green = vec3(0.3, 0.85, 0.42), yellow = vec3(1.0, 0.86, 0.12), red = vec3(1.0, 0.2, 0.12);
  float t = clamp(x, 0.0, 1.0) * 4.0;
  vec3 band = t < 1.0 ? mix(blue, green, smoothstep(0.6, 1.0, t)) : t < 2.0 ? mix(green, yellow, smoothstep(1.6, 2.0, t))
            : t < 3.0 ? mix(yellow, red, smoothstep(2.6, 3.0, t)) : red;
  vec3 c = mix(vec3(1.0), band, 1.0 - smoothstep(1.0 - aa, 1.0 + aa, x));
  return mix(c, vec3(ink), 1.0 - smoothstep(-aa, aa, x));
}`;

const FIELD_VS = `#version 300 es
layout(location=0) in vec2 aC;      // x: 0 head .. 1 tail, y: -1..1 across
layout(location=1) in vec4 aA;      // x, y (world lateral), z0 in [0,L), w (world width)
layout(location=2) in vec4 aB;      // seed, lenMul, tone (0 ink .. 1 grey), lane weight
uniform vec2 uRes, uVP;
uniform float uF, uS, uL, uNear, uShut, uRoll, uFr, uMaxW, uFog, uMode, uAng, uWake, uWakeDir, uLane, uGain, uMinW;
out vec2 vQ; out float vL, vHalf, vCore, vA, vInk, vFr;
void main() {
  vec2 head, tail; float wpx, a;
  if (uMode < 0.5) {                               // forward: points rush at the lens
    float d = mod(aA.z - uS, uL) + uNear;
    float dt = d + uShut * aB.y;
    vec2 xy = aA.xy;
    xy.x = mix(xy.x, sign(xy.x) * (0.35 + 0.6 * abs(aB.w - 0.5)), uLane * step(0.5, fract(aB.x * 7.13)));   // lanes: pull some points into the ≡ bands
    float cr = cos(uRoll), sr = sin(uRoll);
    xy = vec2(cr * xy.x - sr * xy.y, sr * xy.x + cr * xy.y);
    head = uVP + vec2(xy.x, -xy.y) * uF / d;
    tail = uVP + vec2(xy.x, -xy.y) * uF / dt;
    wpx = aA.w * uF / d;
    a = smoothstep(uNear, uNear * 2.2, d) * (1.0 - smoothstep(uL * uFog, uL, d));
  } else {                                          // flow: a 2D wake in screen space, depth layers for parallax
    float z = aA.z / uL;
    float par = mix(1.0, 0.1, z);
    vec2 dir = vec2(cos(uAng), sin(uAng)), nrm = vec2(-dir.y, dir.x);
    float span = 3400.0;
    float along = mod(aA.x * span + uS * par, span) - span * 0.5;
    head = uVP + dir * along + nrm * aA.y * 1500.0;
    tail = head - dir * uShut * par * aB.y;
    wpx = aA.w * mix(34.0, 2.5, z);
    a = 1.0 - z * 0.55;
    float side = dot(head - uVP, vec2(cos(uWakeDir), sin(uWakeDir)));
    a *= mix(1.0, smoothstep(uWake + 260.0, uWake - 200.0, side), step(0.001, abs(uWake)));
  }
  a *= smoothstep(0.5, 2.4, wpx);                  // sub-pixel far points fade into the white, never a noise cluster
  wpx = clamp(wpx, uMinW, uMaxW);
  a *= uGain;
  vec2 dv = tail - head; float L = length(dv);
  vec2 ax = L > 0.5 ? dv / L : vec2(1.0, 0.0), pr = vec2(-ax.y, ax.x);
  float fr = uFr * clamp(wpx / 7.0, 0.3, 1.0);
  float half_ = wpx * 0.5 + fr;
  vec2 p = head - ax * half_ + ax * (L + 2.0 * half_) * aC.x + pr * half_ * aC.y;
  vQ = vec2(aC.x * (L + 2.0 * half_) - half_, aC.y * half_);
  vL = L; vHalf = half_; vCore = wpx * 0.5; vA = a; vFr = fr;
  vInk = mix(0.045, 0.52, aB.z);
  vec2 ndc = p / uRes * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}`;

const FIELD_FS = `#version 300 es
precision highp float;
in vec2 vQ; in float vL, vHalf, vCore, vA, vInk, vFr;
out vec4 o;
${PRISM}
void main() {
  float s = clamp(vQ.x, 0.0, vL);
  float u = vL > 0.5 ? s / vL : 0.0;
  float d = length(vec2(vQ.x - s, vQ.y));
  float core = vCore * mix(1.0, 0.3, u);
  vec3 c = prism(d, core, vFr, vInk);
  float a = vA * mix(1.0, 0.18, u * u);
  o = vec4(mix(vec3(1.0), c, a), 1.0);
}`;

// 3D segments. p.z is a forward distance in [0, uPer); the whole set wraps with period uPer as the camera travels uS.
const SEG_VS = `#version 300 es
layout(location=0) in vec2 aC;
layout(location=1) in vec4 aP0;     // x, y, z, width (world)
layout(location=2) in vec4 aP1;     // x, y, z, kind (0 rebar, 1 tie wire, 2 pulse, 3 tube, 4 coupler)
layout(location=3) in vec4 aK;      // seed, reveal beat, tone, grow (0: none, 1: grow along)
uniform vec2 uRes, uVP;
uniform vec3 uCam;
uniform mat3 uRot;
uniform float uF, uS, uPer, uNear, uFront, uBeat, uFogN, uFogF, uMaxW, uFr, uGain;
out vec2 vQ; out float vL, vHalf, vCore, vA, vKind, vInk, vFr, vUd, vId, vSeed, vLenW;
vec3 cam(vec3 p) { return uRot * (p - uCam); }
void main() {
  float zm = 0.5 * (aP0.z + aP1.z);
  float off = mod(zm - uS, uPer) - zm;
  vec3 p0 = vec3(aP0.xy, aP0.z + off), p1 = vec3(aP1.xy, aP1.z + off);
  if (p1.z < p0.z) { vec3 t = p0; p0 = p1; p1 = t; }
  float lenW = length(p1 - p0);
  float g = aK.w > 0.5 ? clamp((uFront - p0.z) / max(p1.z - p0.z, 0.25), 0.0, 1.0) : step(p0.z, uFront);
  float rv = clamp((uBeat - aK.y) * 5.0, 0.0, 1.0);
  g *= rv;
  p1 = mix(p0, p1, g);
  vec3 c0 = cam(p0), c1 = cam(p1);
  float hide = 0.0;
  if (c0.z < uNear && c1.z < uNear) hide = 1.0;
  float u0 = 0.0, u1 = g;
  if (c0.z < uNear) { float k = (uNear - c0.z) / (c1.z - c0.z); c0 = mix(c0, c1, k); u0 = mix(u0, u1, k); }
  if (c1.z < uNear) { float k = (uNear - c1.z) / (c0.z - c1.z); c1 = mix(c1, c0, k); u1 = mix(u1, u0, k); }
  vec2 h = uVP + vec2(c0.x, -c0.y) * uF / c0.z, t = uVP + vec2(c1.x, -c1.y) * uF / c1.z;
  float w0 = aP0.w * uF / c0.z, w1 = aP0.w * uF / c1.z;
  float wpx = clamp(max(w0, w1), 2.6, uMaxW);
  float kind = aP1.w;
  float fr = kind > 1.5 && kind < 2.5 ? uFr : uFr * 0.35;
  fr *= clamp(wpx / 8.0, 0.3, 1.0);
  vec2 dv = t - h; float L = length(dv);
  vec2 ax = L > 0.5 ? dv / L : vec2(1.0, 0.0), pr = vec2(-ax.y, ax.x);
  float half_ = wpx * 0.5 + fr;
  vec2 p = h - ax * half_ + ax * (L + 2.0 * half_) * aC.x + pr * half_ * aC.y;
  vQ = vec2(aC.x * (L + 2.0 * half_) - half_, aC.y * half_);
  vL = L; vHalf = half_; vCore = wpx * 0.5; vKind = kind; vFr = fr; vSeed = aK.x; vLenW = lenW;
  float zc = 0.5 * (c0.z + c1.z);
  vA = (1.0 - smoothstep(uFogN, uFogF, zc)) * (1.0 - hide) * step(0.001, g) * uGain;
  vInk = mix(0.05, 0.6, aK.z);
  // perspective-correct distance along the bar in world units
  float iz0 = 1.0 / c0.z, iz1 = 1.0 / c1.z;
  float ua = mix(u0, u1, clamp(aC.x, 0.0, 1.0)) * lenW, iz = mix(iz0, iz1, clamp(aC.x, 0.0, 1.0));
  vUd = ua * iz; vId = iz;
  vec2 ndc = p / uRes * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}`;

const SEG_FS = `#version 300 es
precision highp float;
in vec2 vQ; in float vL, vHalf, vCore, vA, vKind, vInk, vFr, vUd, vId, vSeed, vLenW;
uniform float uBeat, uRib;
out vec4 o;
${PRISM}
void main() {
  float s = clamp(vQ.x, 0.0, vL);
  float d = length(vec2(vQ.x - s, vQ.y));
  float uw = vUd / vId;                 // world distance along the member
  float v = vQ.y / max(vCore, 0.5);     // -1..1 across the core
  vec3 c;
  if (vKind < 0.5) {                    // rebar: ink with diagonal ribs and a hard highlight
    c = prism(d, vCore, vFr, vInk);
    float rib = smoothstep(0.35, 0.5, abs(fract(uw / uRib + v * 0.28) - 0.5));
    float inCore = 1.0 - smoothstep(vCore - 0.8, vCore + 0.8, d);
    float hi = exp(-pow((v + 0.38) / 0.16, 2.0)) * (0.55 + 0.45 * rib);
    c = mix(c, mix(c, vec3(0.93), hi * 0.85), inCore * step(3.5, vCore * 2.0));
    c = mix(c, c * 0.55 + 0.02, (1.0 - rib) * inCore * 0.0);
    c = mix(c, vec3(vInk + 0.22), rib * inCore * 0.35 * step(4.0, vCore * 2.0));
  } else if (vKind < 1.5) {             // tie wire: thin twisted wire
    c = prism(d, vCore, vFr, vInk);
    float tw = step(0.5, fract(uw * 60.0 + v * 0.5));
    c = mix(c, vec3(0.55), tw * 0.3 * (1.0 - smoothstep(vCore - 0.5, vCore + 0.5, d)));
  } else if (vKind < 2.5) {             // pulse packet travelling along a bar
    float p = fract(uBeat * 0.9 + vSeed) * vLenW;
    float k = exp(-pow((uw - p) / 0.35, 2.0));
    c = prism(d, vCore * k, vFr * k, vInk);
    c = mix(vec3(1.0), c, smoothstep(0.02, 0.2, k));
  } else if (vKind < 3.5) {             // scaffold tube: a grey cylinder
    float sh = mix(0.72, 0.28, pow(abs(v), 1.6)) - 0.22 * exp(-pow((v + 0.45) / 0.2, 2.0)) * 0.0;
    c = mix(vec3(1.0), vec3(sh), 1.0 - smoothstep(vCore - 0.8, vCore + 0.8, d));
    c = mix(c, vec3(0.97), exp(-pow((v + 0.4) / 0.14, 2.0)) * (1.0 - smoothstep(vCore - 0.8, vCore + 0.8, d)));
  } else {                              // coupler: dark cast lump
    c = prism(d, vCore, vFr * 0.5, vInk * 0.8);
  }
  o = vec4(mix(vec3(1.0), c, vA), 1.0);
}`;

function compile(gl, vs, fs) {
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.slice(0, 200)); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export class Streaks {
  constructor(w = W, h = H) {
    this.canvas = document.createElement('canvas'); this.canvas.width = w; this.canvas.height = h;
    const gl = this.gl = this.canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false });
    if (!gl) throw new Error('webgl2 unavailable');
    this.fieldProg = compile(gl, FIELD_VS, FIELD_FS);
    this.segProg = compile(gl, SEG_VS, SEG_FS);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, -1, 1, 1, 0, 1]), gl.STATIC_DRAW);
    this.w = w; this.h = h;
  }
  _vao(data, count, nAttr) {
    const gl = this.gl, vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    for (let i = 0; i < nAttr; i++) {
      gl.enableVertexAttribArray(1 + i); gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, nAttr * 16, i * 16); gl.vertexAttribDivisor(1 + i, 1);
    }
    gl.bindVertexArray(null);
    return { vao, count };
  }
  // n streak points in a box |x|,|y| < R, z in [0, L). Near-axis points are thinned so the lens stays readable.
  field(n, { seed = 1, R = 14, L = 120, w = 0.05, clear = 0.9 } = {}) {
    const r = rng(seed), d = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
      let x, y; do { x = (r() * 2 - 1) * R; y = (r() * 2 - 1) * R * 1.4; } while (Math.hypot(x, y * 0.8) < clear * (0.6 + r()));
      d.set([x, y, r() * L, w * (0.4 + 1.6 * r() ** 2), r(), 0.5 + r(), r() < 0.85 ? r() * 0.1 : 0.3 + r() * 0.4, r()], i * 8);
    }
    return { ...this._vao(d, n, 2), L };
  }
  // 2D flow wake: x in [0,1) along, y in -1..1 across, z depth layer
  flow(n, { seed = 2, L = 1, w = 0.35 } = {}) {
    const r = rng(seed), d = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
      const z = r() ** 0.7;
      d.set([r(), (r() * 2 - 1), z * L, w * (0.3 + 1.2 * r() ** 2), r(), 0.4 + r() * 1.2, r() < 0.75 ? r() * 0.2 : 0.35 + r() * 0.5, r()], i * 8);
    }
    return { ...this._vao(d, n, 2), L };
  }
  segments(data, count) { return this._vao(data, count, 3); }
  begin(bg = [0.969, 0.969, 0.949]) {
    const gl = this.gl;
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.DST_COLOR, gl.ZERO);   // multiply: ink darkens paper
    gl.disable(gl.DEPTH_TEST);
  }
  _set(prog, u) {
    const gl = this.gl;
    for (const [k, v] of Object.entries(u)) {
      const loc = prog.u[k]; if (!loc) continue;
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v.length === 2) gl.uniform2fv(loc, v);
      else if (v.length === 3) gl.uniform3fv(loc, v);
      else if (v.length === 9) gl.uniformMatrix3fv(loc, false, v);
    }
  }
  drawField(f, u, count = f.count) {
    const gl = this.gl, P = this.fieldProg; gl.useProgram(P.p);
    this._set(P, { uRes: [this.w, this.h], uVP: [this.w / 2, this.h / 2], uL: f.L, uNear: 0.6, uFr: 4.5, uMaxW: 110, uFog: 0.55, uMode: 0,
      uAng: Math.PI, uWake: 0, uWakeDir: 0, uLane: 0, uGain: 1, uMinW: 2.6, uRoll: 0, ...u });
    gl.bindVertexArray(f.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, Math.min(count, f.count)); gl.bindVertexArray(null);
  }
  drawSegs(s, u) {
    const gl = this.gl, P = this.segProg; gl.useProgram(P.p);
    this._set(P, { uRes: [this.w, this.h], uVP: [this.w / 2, this.h / 2], uNear: 0.25, uFront: 1e9, uFogN: 20, uFogF: 60, uMaxW: 170, uFr: 4, uRib: 0.16,
      uGain: 1, uCam: [0, 0, 0], uRot: [1, 0, 0, 0, 1, 0, 0, 0, 1], ...u });
    gl.bindVertexArray(s.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, s.count); gl.bindVertexArray(null);
  }
}

// camera rotation (yaw, pitch, roll) as a column-major mat3 for uRot (world -> camera)
export function camRot(yaw = 0, pitch = 0, roll = 0) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // R = Rz(roll) * Rx(pitch) * Ry(yaw); returns column-major
  const Ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy], Rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp], Rz = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  const mul = (a, b) => { const o = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]; return o; };
  const m = mul(Rz, mul(Rx, Ry));                  // row-major
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}
