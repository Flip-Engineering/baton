// particles/core: the WebGL2 context, the HDR pipeline with per-layer compositing, shared GLSL, hashing and the
// disk cache (out/.pcache) used by the samplers and the Flow checkpoints.
import { W, H, PAL } from '../../kit.js';

// ================================================================ GLSL shared
export const COMMON = `
uint hu(uint x){ x^=x>>16; x*=0x7feb352dU; x^=x>>15; x*=0x846ca68bU; x^=x>>16; return x; }
float hf(uint x){ return float(hu(x))*(1.0/4294967296.0); }
vec4 h4(uint i){ return vec4(hf(i*4u+11u),hf(i*4u+12u),hf(i*4u+13u),hf(i*4u+14u)); }
float h3(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
// value noise with analytic derivatives (x: value, yzw: gradient)
vec4 nd(vec3 x){
  vec3 p=floor(x), w=fract(x);
  vec3 u=w*w*w*(w*(w*6.-15.)+10.), du=30.*w*w*(w*(w-2.)+1.);
  float a=h3(p), b=h3(p+vec3(1,0,0)), c=h3(p+vec3(0,1,0)), d=h3(p+vec3(1,1,0));
  float e=h3(p+vec3(0,0,1)), f=h3(p+vec3(1,0,1)), g=h3(p+vec3(0,1,1)), h=h3(p+vec3(1,1,1));
  float k1=b-a, k2=c-a, k3=e-a, k4=a-b-c+d, k5=a-c-e+g, k6=a-b-e+f, k7=-a+b+c-d+e-f-g+h;
  return vec4(a+k1*u.x+k2*u.y+k3*u.z+k4*u.x*u.y+k5*u.y*u.z+k6*u.z*u.x+k7*u.x*u.y*u.z,
    du*vec3(k1+k4*u.y+k6*u.z+k7*u.y*u.z, k2+k5*u.z+k4*u.x+k7*u.z*u.x, k3+k6*u.x+k5*u.y+k7*u.x*u.y));
}
// divergence-free 2D curl field (two octaves) + a z drift from the noise value; p in px, returns a ~unit vector
vec3 curl(vec3 p, float t, float freq){
  vec4 a=nd(vec3(p.xy*freq, t)); vec4 b=nd(vec3(p.xy*freq*2.13+17.3, t*1.37+4.1));
  vec2 g=a.yz+b.yz*.5;
  return vec3(g.y, -g.x, (a.x-.5)*.6);
}
`;
export const PROJ = `
uniform vec4 CAM;   // f, rotY, rotX, zoom
uniform vec2 CAMC;  // pivot (px)
uniform vec3 CAMT;  // camera translate (px): pan x, pan y, dolly z
vec4 project(vec3 p){       // -> clip xy, eye depth z, screen scale
  vec3 q=p-vec3(CAMC,0.);
  float cy=cos(CAM.y), sy=sin(CAM.y), cx=cos(CAM.z), sx=sin(CAM.z);
  q=vec3(cy*q.x+sy*q.z, q.y, -sy*q.x+cy*q.z);
  q=vec3(q.x, cx*q.y-sx*q.z, sx*q.y+cx*q.z);
  q-=CAMT;
  float ez=CAM.x+q.z; float s=CAM.x/max(ez,1.)*CAM.w;
  vec2 sc=CAMC+q.xy*s;
  return vec4(sc.x/${W}.*2.-1., 1.-sc.y/${H}.*2., ez, s);
}
`;
// Point sprite: soft gaussian, or a bokeh disc (vB 0..1 = defocus). vB < 0: a hard flat disc (poster points).
export const SPRITE_FS = `#version 300 es
precision highp float;
in vec4 vC; in float vB;
out vec4 o;
void main(){
  vec2 q=gl_PointCoord*2.-1.; float r2=dot(q,q); if(r2>1.) discard;
  if(vB<0.){ o=vec4(vC.rgb*vC.a, vC.a); return; }
  float soft=exp(-r2*3.2);
  float bok=smoothstep(1.,.7,r2)*(.8+.2*smoothstep(.4,.95,r2));   // bokeh disc, faint bright rim
  o=vec4(vC.rgb*vC.a*mix(soft,bok,vB), vC.a*mix(soft,bok,vB));
}`;

// ================================================================ hashing (64-bit as two 32-bit lanes, hex)
export function hashBytes(buf, seed = '') {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
  const n4 = u8.byteLength >> 2, u32 = new Uint32Array(u8.buffer, u8.byteOffset, n4);
  let a = 0x811c9dc5 ^ hashStr32(seed), b = 0x9747b28c;
  for (let i = 0; i < n4; i++) { const v = u32[i]; a = Math.imul(a ^ v, 0x01000193); b = Math.imul(b ^ (v >>> 7 | v << 25), 0x5bd1e995); b ^= b >>> 15; }
  for (let i = n4 * 4; i < u8.byteLength; i++) { a = Math.imul(a ^ u8[i], 0x01000193); b = Math.imul(b ^ u8[i], 0x5bd1e995); }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
function hashStr32(s, h = 0x811c9dc5) { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return h >>> 0; }
export function hashStr(s) { return hashStr32(s).toString(16).padStart(8, '0') + hashStr32(s, 0x2545f491).toString(16).padStart(8, '0'); }
// Stable JSON for hashing params (functions by source, typed arrays by content hash, numbers rounded to 1e-9).
export function stableKey(v) {
  return JSON.stringify(v, (k, x) => typeof x === 'function' ? 'fn:' + hashStr(x.toString())
    : ArrayBuffer.isView(x) ? 'ta:' + hashBytes(x) : typeof x === 'number' ? Math.round(x * 1e9) / 1e9 : x);
}

// ================================================================ disk cache: out/.pcache
// Needs the PUT endpoint in web/cache_server.mjs (render.mjs and the tools serve it). Without it everything still
// works from memory; writes fail silently.
export const CACHE_URL = new URL('../../../../out/.pcache/', import.meta.url).href;
export const disk = {
  async get(path) { try { const r = await fetch(CACHE_URL + path); return r.ok ? await r.arrayBuffer() : null; } catch { return null; } },
  put(path, body) { const p = fetch(CACHE_URL + path, { method: 'PUT', body }).catch(() => null); disk.pending.add(p); p.finally(() => disk.pending.delete(p)); return p; },
  async list(dir) { try { const r = await fetch(CACHE_URL + dir + '/?list'); return r.ok ? await r.json() : []; } catch { return []; } },
  pending: new Set(),
  async flush() { await Promise.all([...disk.pending]); },
};
// Pack / unpack {field: TypedArray | number | string | object} records into one ArrayBuffer.
const TA = { Float32Array, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int32Array, Float64Array };
export function pack(entries) {       // entries: Map key -> record
  const head = [], bufs = []; let off = 0;
  for (const [key, rec] of entries) {
    const fields = {};
    for (const [f, v] of Object.entries(rec)) {
      if (ArrayBuffer.isView(v)) { const pad = (8 - off % 8) % 8; off += pad; bufs.push([off, v]); fields[f] = { ta: v.constructor.name, off, len: v.length }; off += v.byteLength; }
      else fields[f] = { v };
    }
    head.push({ key, fields });
  }
  const hj = new TextEncoder().encode(JSON.stringify(head)), h0 = 8 + hj.length + ((8 - (8 + hj.length) % 8) % 8);
  const out = new Uint8Array(h0 + off); const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x50434b31); dv.setUint32(4, hj.length); out.set(hj, 8);
  for (const [o, v] of bufs) out.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), h0 + o);
  return out;
}
export function unpack(ab) {
  const dv = new DataView(ab); if (dv.getUint32(0) !== 0x50434b31) return new Map();
  const hl = dv.getUint32(4), head = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 8, hl))), h0 = 8 + hl + ((8 - (8 + hl) % 8) % 8);
  const m = new Map();
  for (const { key, fields } of head) {
    const rec = {};
    for (const [f, d] of Object.entries(fields)) rec[f] = d.ta ? new TA[d.ta](ab, h0 + d.off, d.len) : d.v;
    m.set(key, rec);
  }
  return m;
}
// Build cache for point sets, matchTo permutations and atlases: one bundle per scene (out/.pcache/<name>.pts).
//   await pcache.load('lab_particles');  ...build...;  await pcache.save();
// Keys are content hashes (pixels, positions) or argument hashes, so a stale entry is never served.
export const pcache = {
  name: null, map: new Map(), used: new Set(), dirty: false, hits: 0, misses: 0,
  async load(name) {
    this.name = name; const ab = await disk.get(name + '.pts');
    if (ab) this.map = unpack(ab);
  },
  get(key) { const v = this.map.get(key); if (v) { this.hits++; this.used.add(key); } return v; },
  set(key, rec) { this.misses++; this.map.set(key, rec); this.used.add(key); this.dirty = true; return rec; },
  // write the bundle (only the entries this build used, so dead entries are dropped)
  async save() {
    if (!this.name || !this.dirty) return;
    const keep = new Map([...this.map].filter(([k]) => this.used.has(k)));
    await disk.put(this.name + '.pts', pack(keep)); this.dirty = false;
  },
};

// float32 <-> float16 (exact for values that came from an RGBA16F buffer)
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
export function toHalf(src) {
  const out = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    _f[0] = src[i]; const x = _u[0], s = (x >>> 16) & 0x8000, e = (x >>> 23) & 0xff, m = x & 0x7fffff;
    let h;
    if (e === 255) h = s | 0x7c00 | (m ? 0x200 : 0);
    else { const ee = e - 127 + 15;
      if (ee >= 31) h = s | 0x7c00;
      else if (ee <= 0) { if (ee < -10) h = s; else { const mm = (m | 0x800000) >> (1 - ee); h = s | ((mm + 0xfff + ((mm >> 13) & 1)) >> 13); } }
      else { h = s | (ee << 10) | (m >> 13); const r = m & 0x1fff; if (r > 0x1000 || (r === 0x1000 && (h & 1))) h++; } }
    out[i] = h;
  }
  return out;
}

// ================================================================ GL context + HDR pipeline with layers
// Main buffer: RGBA16F + depth; alpha = occluder coverage (Crowd, 'over' dust). Tone: 1-e^-x, optional heat ramp.
// Layers (P.layer(name, opts)): extra full-res RGBA16F buffers where additive particles also accumulate their
// alpha as a density (count) channel. Each layer has its own look, composited over the toned main in order:
//   mode 'glow'   density-aware light: log(1+density) tone, so a dense core turns hot cream and keeps its
//                 structure instead of saturating; hue = average particle colour (cream stays cream)
//   mode 'ink'    dark ink over the base (or over its own paper `ground`): coverage 1-e^-density, no light
//   mode 'poster' hard flat points, colours snapped to the brand palette, no bloom (Constructivist print)
//   any mode + fill > 0: the density is blurred at half res and thresholded into a crisp filled glyph (metaball
//                 fill with an optional bevel), the loose particles stay as a glowing edge and flying debris
// Layer opts: {mode, exposure, ref (settled density; set by Swarm.draw automatically), bloom, ramp, hot [h0,h1],
//   hotColor, fill (0..1), th (fill threshold, x ref), soft, fillColor (null = the particles' own colours),
//   bevel, edge (edge glow), spark (particle glints over the fill), snap (fill in exact brand colours: cream / red /
//   black), blur (px, fill smoothing), ground [rgb] + groundAmt (paper), inkK}
export class Particles {
  constructor({ scale = 1, bloomScale = 0.25, skyScale = 0.35 } = {}) {
    this.skyScale = skyScale; this.unders = [];
    const cv = this.canvas = document.createElement('canvas');
    cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
    this.scale = scale;
    const gl = this.gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false, alpha: false });
    if (!gl) throw new Error('particles: no WebGL2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('particles: EXT_color_buffer_float missing');
    gl.getExtension('OES_texture_float_linear');
    this.vao = gl.createVertexArray();
    this.progs = {};
    const w = cv.width, h = cv.height;
    this.main = this.hdr = this.target(w, h, gl.RGBA16F, true);
    this.layers = new Map(); this.pxs = scale;
    const bw = Math.round(w * bloomScale), bh = Math.round(h * bloomScale);
    this.bl = [this.target(bw, bh, gl.RGBA16F), this.target(bw, bh, gl.RGBA16F), this.target(bw >> 1, bh >> 1, gl.RGBA16F), this.target(bw >> 1, bh >> 1, gl.RGBA16F)];
    this.quadVS = `#version 300 es
in vec2 a; out vec2 uv; void main(){ uv=a*.5+.5; gl_Position=vec4(a,0,1); }`;
    this.qbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.qbuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.qvao = gl.createVertexArray(); gl.bindVertexArray(this.qvao);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
    this.cam = {}; this.prof = {};
    this.setCamera();
  }
  // ---------- helpers
  program(key, vs, fs, attribs = { a: 0 }) {
    if (this.progs[key]) return this.progs[key];
    const gl = this.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const l = src.split('\n').map((x, i) => `${i + 1}: ${x}`).join('\n'); throw new Error(key + ': ' + gl.getShaderInfoLog(s) + '\n' + l.slice(0, 6000)); } return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    for (const [n, i] of Object.entries(attribs)) gl.bindAttribLocation(p, i, n);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(key + ': ' + gl.getProgramInfoLog(p));
    const u = {}; const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
    return (this.progs[key] = { p, u });
  }
  use(pr) { this.gl.useProgram(pr.p); return pr.u; }
  target(w, h, fmt, depth = false) {
    const gl = this.gl;
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    const lin = fmt !== gl.RGBA32F;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, lin ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, lin ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let rb = null;
    if (depth) { rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb); }
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('particles: fbo incomplete ' + st);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h, rb, fmt };
  }
  // Bind a render target. pxs = target px per output px: point sprites multiply gl_PointSize by it, so a
  // Particles({scale: 0.5}) context or a half-res trail buffer draws the same image at lower resolution.
  bind(t) { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
    const w = t ? t.w : this.canvas.width; gl.viewport(0, 0, w, t ? t.h : this.canvas.height); this.pxs = w / W; }
  quad() { const gl = this.gl; gl.bindVertexArray(this.qvao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null); }
  tex(unit, t) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); }
  dataTex(w, h, data, float = true, linear = false) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA32F : gl.RGBA8, w, h, 0, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, data);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  // Read a render target back (RGBA float), e.g. for sampling or checkpoints.
  readback(t = this.hdr) {
    const gl = this.gl; this.bind(t);
    const px = new Float32Array(t.w * t.h * 4); gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, px);
    return { data: px, w: t.w, h: t.h, flipY: true };
  }
  // Upload into an existing target's texture (Float32Array for RGBA32F, Uint16Array half floats for RGBA16F).
  upload(t, data) {
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, t.w, t.h, gl.RGBA, data instanceof Uint16Array ? gl.HALF_FLOAT : gl.FLOAT, data);
  }
  // Camera shared by Swarm/Flow/Dust: focal f (px), rotY/rotX (rad) about pivot (cx,cy), zoom, pan (px), dolly (px, + = toward).
  setCamera({ f = 1600, rotY = 0, rotX = 0, zoom = 1, cx = W / 2, cy = H / 2, panX = 0, panY = 0, dolly = 0 } = {}) {
    Object.assign(this.cam, { f, rotY, rotX, zoom, cx, cy, panX, panY, dolly });
  }
  camUniforms(u) {
    const gl = this.gl, c = this.cam;
    gl.uniform4f(u.CAM, c.f, c.rotY, c.rotX, c.zoom); gl.uniform2f(u.CAMC, c.cx, c.cy); gl.uniform3f(u.CAMT, c.panX, c.panY, c.dolly);
  }
  // ---------- profiling: with P.profile = true, mark(name) waits for the GPU and books the time since the last mark.
  mark(name) {
    if (!this.profile) return;
    const gl = this.gl, b = new Uint8Array(4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
    const now = performance.now(); this.prof[name] = (this.prof[name] || 0) + now - this._pm; this._pm = now;
  }
  profStart() { this.prof = {}; if (this.profile) { this.mark('_'); delete this.prof._; } }
  // ---------- frame
  begin(bg = [0, 0, 0]) {
    const gl = this.gl; this.hdr = this.main; this.bind(this.main);
    gl.clearColor(bg[0], bg[1], bg[2], 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.unders = [];
    for (const L of this.layers.values()) { L.used = false; L.opts = {}; L.ref = 0; }
  }
  // Select the draw target: P.layer('type', {mode: 'glow', fill: 1, ...}) -> that layer (created and cleared on
  // first use in a frame; opts merge); P.layer() -> back to the main buffer. Returns the previous target name.
  layer(name = null, opts = {}) {
    const prev = this.hdr === this.main ? null : this.hdr.name;
    if (!name) { this.hdr = this.main; return prev; }
    let L = this.layers.get(name);
    if (!L) { const t = this.target(this.canvas.width, this.canvas.height, this.gl.RGBA16F); L = { name, t, used: false, opts: {}, ref: 0 }; t.name = name; t.layer = L; this.layers.set(name, L); }
    if (!L.used) { L.used = true; this.bind(L.t); const gl = this.gl; gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); L.order = this._lorder = (this._lorder || 0) + 1; }
    Object.assign(L.opts, opts);
    this.hdr = L.t;
    return prev;
  }
  get inLayer() { return this.hdr !== this.main ? this.hdr.layer : null; }
  // Register a low-res texture to be composited under the main layer (behind occluders) at present time.
  under(tex, gain = 1) { this.unders.push({ tex, gain }); }
  // Full-screen backdrop: vertical gradient + horizon glow + slow fbm cloud banks + sun + halo (low res, under).
  // sun: {x, y, r, color, clip (0..1: the disc stops at the horizon, a sunrise), bands (0..1: dark cloud strata across it)}
  sky(t, o = {}) {
    const gl = this.gl;
    const pr = this.program('sky', this.quadVS, `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform vec3 TOP, MID, BOT, GLOW, SUNC, HALOC; uniform float HZ, GW, CL, T, SUNR, SCLIP, SBAND; uniform vec2 SUN; uniform vec3 HALO;
${COMMON}
void main(){
  vec2 p=vec2(uv.x, 1.-uv.y); float y=p.y;
  vec3 c = y<HZ ? mix(TOP, MID, smoothstep(0., HZ, y)) : mix(MID, BOT, smoothstep(HZ, 1., y));
  float d=abs(y-HZ); c+=GLOW*exp(-d/GW)*(y<HZ?1.:.35);
  if(CL>0.){ vec2 q=vec2(p.x*2.2, (p.y-HZ)*7.); float n=nd(vec3(q+vec2(T*.05,0.),T*.04)).x*.6+nd(vec3(q*2.7,T*.07+3.)).x*.4;
    float band=smoothstep(.45,.9,n)*exp(-max(0.,HZ-y)*2.2)*step(y,HZ+.02); c+=GLOW*band*CL*.9; c*=1.-CL*.35*smoothstep(.5,.2,n)*step(y,HZ); }
  if(SUNR>0.){ vec2 s=(p-SUN)*vec2(${(W / H).toFixed(4)},1.); float r=length(s);
    float rim=smoothstep(SUNR*.9,SUNR,r)*smoothstep(SUNR*1.01,SUNR*.99,r);
    float grain=.9+.1*nd(vec3(s*40.,T*.3)).x;
    float disc=smoothstep(SUNR,SUNR*.985,r)*(.75+.25*smoothstep(SUNR,0.,r))*grain+rim*.6;
    if(SCLIP>0.) disc*=mix(1., smoothstep(HZ+.002,HZ-.002,y), SCLIP);        // sunk: the disc stops at the horizon
    if(SBAND>0.){ float st=nd(vec3(p.x*2.4+T*.03, p.y*46., 5.)).x*.7+nd(vec3(p.x*6.,p.y*90.,T*.05+9.)).x*.3;   // cloud strata across the disc
      disc*=1.-SBAND*smoothstep(.5,.72,st)*smoothstep(SUN.y+SUNR*.95,SUN.y-SUNR*.2,y); }
    c+=SUNC*(disc+.4*exp(-max(r-SUNR,0.)/(SUNR*.9))); }
  if(HALO.z>0.){ vec2 s=(p-HALO.xy)*vec2(${(W / H).toFixed(4)},1.); c+=HALOC*exp(-dot(s,s)/(HALO.z*HALO.z)); }
  o=vec4(c,1.);
}`);
    if (!this.skyT) this.skyT = this.target(Math.round(W * this.skyScale), Math.round(H * this.skyScale), gl.RGBA16F);
    const u = this.use(pr); this.bind(this.skyT);
    const v3 = (n, v) => gl.uniform3f(u[n], v[0], v[1], v[2]);
    v3('TOP', o.top || [0, 0, 0]); v3('MID', o.mid || [0.05, 0.005, 0.01]); v3('BOT', o.bottom || [0, 0, 0]); v3('GLOW', o.glow || [0.6, 0.08, 0.05]);
    v3('SUNC', o.sun?.color || [0, 0, 0]);
    gl.uniform1f(u.HZ, o.horizon ?? 0.6); gl.uniform1f(u.GW, o.glowW ?? 0.06); gl.uniform1f(u.CL, o.clouds ?? 0); gl.uniform1f(u.T, t);
    gl.uniform1f(u.SUNR, o.sun ? o.sun.r : 0); gl.uniform1f(u.SCLIP, o.sun?.clip ?? 0); gl.uniform1f(u.SBAND, o.sun?.bands ?? 0);
    const ha = o.halo || { r: 0 }; gl.uniform3f(u.HALO, ha.x ?? 0.5, ha.y ?? 0.5, ha.r); v3('HALOC', ha.color || [0, 0, 0]); gl.uniform2f(u.SUN, o.sun?.x ?? 0.5, o.sun?.y ?? 0.5);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); this.quad();
    this.under(this.skyT.tex, o.gain ?? 1);
  }
  // Blend modes. Main buffer: alpha = occluder coverage ('add' never raises it, 'over' does). Layers: 'add' also
  // accumulates alpha, which becomes the layer's density channel.
  blend(mode) {
    const gl = this.gl;
    if (mode === 'none') { gl.disable(gl.BLEND); return; }
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);
    if (mode === 'add') { if (this.hdr === this.main) gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE); }
    else gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // 'over', premultiplied
  }
  // ---------- present: main tone map (+ bloom, heat ramp, grade), then every used layer with its own look.
  // o (main): {exposure, bloom, bloomThresh, ramp, sat, contrast, lift}; per-layer looks come from P.layer(name, opts)
  // or o.layers = {name: opts}.
  present(ctx, o = {}) {
    const gl = this.gl; gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    const bloom = o.bloom ?? 0.6;
    if (!this.blackT) this.blackT = this.dataTex(1, 1, new Uint8Array(4), false);
    const Ls = [...this.layers.values()].filter(L => L.used).sort((a, b) => a.order - b.order).slice(0, 3);
    for (const L of Ls) { if (o.layers?.[L.name]) Object.assign(L.opts, o.layers[L.name]); L.cfg = layerCfg(L); }
    // 1. under layers (sky, flow trails...) summed into one half-res buffer
    if (!this.low) this.low = this.target(W >> 1, H >> 1, gl.RGBA16F);
    const sum = this.program('usum', this.quadVS, `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D U0, U1, U2; uniform vec3 UG;
void main(){ o=vec4(texture(U0,uv).rgb*UG.x+texture(U1,uv).rgb*UG.y+texture(U2,uv).rgb*UG.z,1.); }`);
    this.mark('pre-present');
    let u = this.use(sum); this.bind(this.low); const ug = [0, 0, 0];
    for (let i = 0; i < 3; i++) { const L = this.unders[i]; this.tex(i, L ? L.tex : this.blackT); gl.uniform1i(u['U' + i], i); ug[i] = L ? L.gain : 0; }
    gl.uniform3f(u.UG, ...ug); this.quad();
    // 2. fill layers: density blurred at half res (downsample, separable blur) -> the metaball field
    for (const L of Ls) if (L.cfg.fill) this._blurLayer(L);
    this.mark('lblur');
    const tex2 = (unit, t, name, uu) => { this.tex(unit, t); gl.uniform1i(uu[name], unit); };
    const LSRC = Ls.map((L, i) => `uniform sampler2D LS${i}, LB${i}; uniform vec4 LA${i}, LBp${i}, LCp${i}; uniform vec3 LC${i}, LG${i}, LH${i};`).join('\n');
    const setL = (uu, base) => Ls.forEach((L, i) => { const c = L.cfg;
      tex2(base + 2 * i, L.t.tex, 'LS' + i, uu); tex2(base + 2 * i + 1, c.fill ? L.blur[0].tex : this.blackT, 'LB' + i, uu);
      gl.uniform4f(uu['LA' + i], c.k, c.hot0, c.hot1, c.ramp); gl.uniform4f(uu['LBp' + i], c.fillAmt, c.th, c.soft, c.bevel);
      gl.uniform4f(uu['LCp' + i], c.edge, c.spark, c.groundAmt, c.inkK); if (uu['LC' + i]) gl.uniform3f(uu['LC' + i], ...c.fillColor);
      if (uu['LG' + i]) gl.uniform3f(uu['LG' + i], ...c.ground); if (uu['LH' + i]) gl.uniform3f(uu['LH' + i], ...c.hotColor);
      if (uu['LBL' + i]) gl.uniform1f(uu['LBL' + i], c.bloom); });
    // 3. bloom: bright pass at 1/4 res over main + unders + the glow of every layer (x its bloom gain)
    const anyBloom = bloom > 0 || Ls.some(L => L.cfg.bloom > 0);
    if (anyBloom) {
      const key = 'down:' + Ls.map(L => L.cfg.mode).join(',');
      const down = this.program(key, this.quadVS, `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D S, L; uniform vec2 PX; uniform float TH, BM;
${LSRC}
${Ls.map((L, i) => `uniform float LBL${i};`).join('\n')}
${LAYER_GLSL}
void main(){ vec3 c=vec3(0.); float a=0.; for(int y=0;y<2;y++) for(int x=0;x<2;x++){ vec4 h=texture(S,uv+(vec2(x,y)-.5)*PX); c+=h.rgb; a+=h.a; } c/=4.; a/=4.;
  c+=texture(L,uv).rgb*(1.-clamp(a,0.,1.));
  float l=max(c.r,max(c.g,c.b)); c=c*smoothstep(TH,TH*2.+.2,l)*BM;
  ${Ls.map((L, i) => L.cfg.mode === 'glow' ? `if(LBL${i}>0.){ vec4 T=vec4(0.); for(int y=0;y<2;y++) for(int x=0;x<2;x++) T+=texture(LS${i},uv+(vec2(x,y)-.5)*PX); T/=4.;
    vec3 g=glowC(T, LA${i}, LH${i}); float gm=max(g.r,max(g.g,g.b)); c+=g*smoothstep(.25,.9,gm)*LBL${i}; }` : '').join('\n  ')}
  o=vec4(c,1.); }`);
      const blur = this.program('blur', this.quadVS, `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D S; uniform vec2 D;
void main(){ vec3 c=texture(S,uv).rgb*.227; c+=(texture(S,uv+D*1.385).rgb+texture(S,uv-D*1.385).rgb)*.316; c+=(texture(S,uv+D*3.231).rgb+texture(S,uv-D*3.231).rgb)*.070; o=vec4(c,1.); }`);
      const merge = this.program('bmerge', this.quadVS, `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D A, B; void main(){ o=vec4(texture(A,uv).rgb*.6+texture(B,uv).rgb,1.); }`);
      u = this.use(down); this.bind(this.bl[0]); tex2(0, this.main.tex, 'S', u); tex2(1, this.low.tex, 'L', u);
      gl.uniform2f(u.PX, 2 / this.main.w, 2 / this.main.h); gl.uniform1f(u.TH, o.bloomThresh ?? 0.35); gl.uniform1f(u.BM, bloom > 0 ? 1 : 0);
      setL(u, 2); this.quad();
      u = this.use(blur); gl.uniform1i(u.S, 0);
      const pass = (src, dst, dx, dy) => { this.bind(dst); this.tex(0, src.tex); gl.uniform2f(u.D, dx / src.w, dy / src.h); this.quad(); };
      pass(this.bl[0], this.bl[1], 1.6, 0); pass(this.bl[1], this.bl[0], 0, 1.6);
      pass(this.bl[0], this.bl[2], 1.8, 0); pass(this.bl[2], this.bl[3], 0, 1.8); pass(this.bl[3], this.bl[2], 3.5, 0); pass(this.bl[2], this.bl[3], 0, 3.5);
      u = this.use(merge); this.bind(this.bl[1]); tex2(0, this.bl[0].tex, 'A', u); tex2(1, this.bl[3].tex, 'B', u); this.quad();
    }
    this.mark('bloom');
    // 4. tone map at full res + layer composites (generated per layer configuration)
    const key = 'tone:' + Ls.map(L => L.cfg.sig).join('|');
    const pr = this.program(key, this.quadVS, `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D S, B, L, PAPER; uniform float EXP, BL, RAMP, SAT, CON, BLW; uniform vec3 LIFT;
${LSRC}
${COMMON}
${LAYER_GLSL}
void main(){
  vec4 h=texelFetch(S,ivec2(gl_FragCoord.xy),0);
  vec3 bl=texture(B,uv).rgb;
  vec3 c=h.rgb+texture(L,uv).rgb*(1.-clamp(h.a,0.,1.))+bl*BL;
  c=1.-exp(-c*EXP);
  float l=dot(c,vec3(.3,.5,.2));
  if(RAMP>0.) c=mix(c, ramp(l*1.08), RAMP);
  c=mix(vec3(l), c, SAT);
  c=(c-.5)*CON+.5+LIFT;
  c=clamp(c,0.,1.);
  ${Ls.map((L, i) => layerComposite(L.cfg, i)).join('\n  ')}
  c+=(1.-exp(-bl*EXP))*BLW*(1.-c);        // layer bloom on top (when the main bloom is off)
  o=vec4(clamp(c,0.,1.),1.);
}`);
    const paper = this._paper();                       // (baked on first use: before the tone program is bound)
    u = this.use(pr); this.bind(null);
    tex2(0, this.main.tex, 'S', u); tex2(1, anyBloom ? this.bl[1].tex : this.blackT, 'B', u); tex2(2, this.low.tex, 'L', u);
    gl.uniform1f(u.EXP, o.exposure ?? 1.4); gl.uniform1f(u.BL, bloom); gl.uniform1f(u.BLW, bloom > 0 ? 0 : 1); gl.uniform1f(u.RAMP, o.ramp ?? 0);
    gl.uniform1f(u.SAT, o.sat ?? 1); gl.uniform1f(u.CON, o.contrast ?? 1); const l = o.lift || [0, 0, 0]; gl.uniform3f(u.LIFT, l[0], l[1], l[2]);
    setL(u, 3); tex2(10, paper.tex, 'PAPER', u);
    this.quad();
    this.mark('tone');
    // Wait for the GPU here, inside renderFrame (otherwise queued GL work lands in the screenshot call).
    { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    if (ctx) { ctx.imageSmoothingEnabled = true; ctx.drawImage(this.canvas, 0, 0, W, H); }
    this.hdr = this.main;
  }
  // Paper mottle for layer grounds, baked once (half res, value/1.3 in .r): two octaves of value noise.
  _paper() {
    if (this.paperT) return this.paperT;
    const gl = this.gl, t = this.paperT = this.target(W >> 1, H >> 1, gl.RGBA8);
    const pr = this.program('paper', this.quadVS, `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
${COMMON}
void main(){ vec2 p=gl_FragCoord.xy*2.; float v=.965+.05*nd(vec3(p*.004,1.)).x+.02*nd(vec3(p*.05,2.)).x; o=vec4(v/1.3,0.,0.,1.); }`);
    this.use(pr); this.bind(t); gl.disable(gl.BLEND); this.quad();
    return t;
  }
  _blurLayer(L) {
    const gl = this.gl, c = L.cfg;
    if (!L.blur) { const w = this.canvas.width >> 2, h = this.canvas.height >> 2;   // quarter res: the fill is a smooth field
      L.blur = [this.target(w, h, gl.RGBA16F), this.target(w, h, gl.RGBA16F)]; }
    const dn = this.program('ldown', this.quadVS, `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D S; uniform vec2 PX;
void main(){ vec4 c=vec4(0.); for(int y=0;y<2;y++) for(int x=0;x<2;x++) c+=texture(S,uv+(vec2(x,y)-.5)*2.*PX); o=c*.25; }`);   // 4 bilinear taps = a 4x4 box
    const bl = this.program('lblur', this.quadVS, `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D S; uniform vec2 D;
void main(){ vec4 c=texture(S,uv)*.227; c+=(texture(S,uv+D*1.385)+texture(S,uv-D*1.385))*.316; c+=(texture(S,uv+D*3.231)+texture(S,uv-D*3.231))*.070; o=c; }`);
    let u = this.use(dn); this.bind(L.blur[0]); this.tex(0, L.t.tex); gl.uniform1i(u.S, 0); gl.uniform2f(u.PX, 1 / L.t.w, 1 / L.t.h); this.quad();
    u = this.use(bl); gl.uniform1i(u.S, 0);
    const r = Math.max(0.3, c.blurPx / 4 / 3.2);        // blur radius in quarter-res px / the kernel's reach
    const pass = (src, dst, dx, dy) => { this.bind(dst); this.tex(0, src.tex); gl.uniform2f(u.D, dx / src.w, dy / src.h); this.quad(); };
    pass(L.blur[0], L.blur[1], r, 0); pass(L.blur[1], L.blur[0], 0, r);
  }
}

// ---------------------------------------------------------------- layer looks
const LAYER_DEF = {
  glow:   { exposure: 1, bloom: 0.5, ramp: 0, hot: [1.5, 3.6], fill: 0, th: 0.35, soft: 0.12, bevel: 0, edge: 0.8, spark: 0.25, groundAmt: 0, inkK: 1.2, blur: 7 },
  ink:    { exposure: 1, bloom: 0, ramp: 0, hot: [9, 10], fill: 0, th: 0.35, soft: 0.1, bevel: 0, edge: 0, spark: 0, groundAmt: 0, inkK: 1.4, blur: 6 },
  poster: { exposure: 1, bloom: 0, ramp: 0, hot: [9, 10], fill: 0, th: 0.3, soft: 0.04, bevel: 0, edge: 0, spark: 0, groundAmt: 0, inkK: 0.05, blur: 5 },
};
function layerCfg(L) {
  const o = L.opts, mode = o.mode || 'glow', d = LAYER_DEF[mode];
  const g = (k) => o[k] ?? d[k];
  const ref = o.ref ?? (L.ref || 1);
  const hot = g('hot'), fill = g('fill');
  const cfg = { mode, k: g('exposure') / ref, hot0: hot[0], hot1: hot[1], ramp: g('ramp'), bloom: g('bloom'),
    fillAmt: fill, fill: fill > 0, th: g('th'), soft: g('soft'), bevel: g('bevel'), edge: g('edge'), spark: g('spark'),
    groundAmt: o.ground ? g('groundAmt') || 1 : 0, ground: o.ground || [0, 0, 0], inkK: g('inkK'), blurPx: g('blur'),
    fillColor: o.fillColor || [-1, -1, -1], hotColor: o.hotColor || PAL.hot, snap: !!o.snap };
  if (o.groundAmt != null) cfg.groundAmt = o.ground ? o.groundAmt : 0;
  cfg.sig = `${mode}${cfg.fill ? 'F' : ''}${cfg.snap ? 'S' : ''}`;
  return cfg;
}
// GLSL: A = (k, hot0, hot1, ramp); Bp = (fill, th, soft, bevel); Cp = (edge, spark, groundAmt, inkK)
const LAYER_GLSL = `
vec3 ramp(float v){ v=clamp(v,0.,1.)*5.;
  vec3 c=mix(vec3(0.), vec3(.16,.01,.02), clamp(v,0.,1.));
  c=mix(c, vec3(.55,.03,.07), clamp(v-1.,0.,1.)); c=mix(c, vec3(.79,.12,.16), clamp(v-2.,0.,1.));
  c=mix(c, vec3(.96,.55,.36), clamp(v-3.,0.,1.)); return mix(c, vec3(.96,.90,.82), clamp(v-4.,0.,1.)); }
// density-aware light: v = log2(1 + density/ref); v = 1 at the settled density. Dense cores go hot, keep structure.
vec3 glowC(vec4 T, vec4 A, vec3 HC){
  float v=log2(1.+T.a*A.x); vec3 hue=T.rgb/max(T.a,1e-5);
  vec3 c=hue*min(v,1.);
  float pk=max(c.r,max(c.g,c.b)), h=smoothstep(A.y,A.z,v);
  if(pk>1.){ c/=pk; hue/=pk; h=max(h, .5*smoothstep(1.,2.2,pk)); }            // overbright: toward ember, never clipped pink
  vec3 EM=vec3(${PAL.ember.map(x => x.toFixed(3))});   // fire ramp: red -> ember -> hot (never through pink)
  c = h<.5 ? mix(c, EM*max(hue.r,.8), h*2.) : mix(EM, HC*min(.75+.12*v,1.25), h*2.-1.);
  if(A.w>0.) c=mix(c, ramp(dot(c,vec3(.3,.5,.2))*1.08), A.w);
  return c;
}
// snap to the brand palette by chroma (hue normalised by its peak), so a light sweep brightens red instead of
// turning it cream; the brightness survives as a mild highlight
vec3 snapPal(vec3 h){ vec3 P0=vec3(${PAL.cream.map(v => v.toFixed(3))}), P1=vec3(${PAL.red.map(v => v.toFixed(3))}), P2=vec3(${PAL.black.map(v => v.toFixed(3))});
  float b=max(h.r,max(h.g,h.b)); if(b<.22) return P2;
  vec3 n=h/b, n0=P0/max(P0.r,max(P0.g,P0.b)), n1=P1/max(P1.r,max(P1.g,P1.b));
  vec3 pc = dot(n-n0,n-n0)<dot(n-n1,n-n1) ? P0 : P1; float pb=max(pc.r,max(pc.g,pc.b));
  return min(pc*clamp(mix(1.,b/pb,.4),.8,1.3), vec3(1.)); }
`;
function layerComposite(c, i) {
  const S = `LS${i}`, Bt = `LB${i}`, A = `LA${i}`, Bp = `LBp${i}`, Cp = `LCp${i}`, FC = `LC${i}`, G = `LG${i}`, HC = `LH${i}`;
  let s = `{ vec4 T=texelFetch(${S},ivec2(gl_FragCoord.xy),0);
    if(${Cp}.z>0.) c=mix(c, ${G}*texture(PAPER,uv).r*1.3, ${Cp}.z);   // paper ground (baked mottle)
    float m=0.; vec3 fc=vec3(0.); float d=0.;
    ${c.fill ? `vec4 Q=texture(${Bt},uv);` : 'vec4 Q=vec4(0.);'}
    if(T.a>0. || Q.a*${A}.x>.004){                                  // skip pixels the layer never touched`;
  if (c.fill) s += `
    d=Q.a*${A}.x;
    m=smoothstep(${Bp}.y-${Bp}.z, ${Bp}.y+${Bp}.z, d)*${Bp}.x;
    fc= ${FC}.r>=0. ? ${FC} : Q.rgb/max(Q.a,1e-5);${c.snap ? '\n    fc=snapPal(fc);                                                    // exact brand colours' : ''}
    if(${Bp}.w>0.){ float e2=smoothstep(${Bp}.y-.12, ${Bp}.y+.3, d);        // bevel from an edge-limited field: flat inside, chiselled rims
      vec2 g=vec2(dFdx(e2),-dFdy(e2))*${Bp}.w*4.; vec3 n=normalize(vec3(-g,1.)); float lit=dot(n,normalize(vec3(-.45,.6,.66)))/.66;
      fc*=clamp(mix(1.,lit,.7),.45,1.22); }`;
  if (c.mode === 'glow') s += `
    vec3 gc=glowC(T, ${A}, ${HC});
    ${c.fill ? `float e=smoothstep(${Bp}.y*.25,${Bp}.y,d)*(1.-m)*${Bp}.x; gc+=(Q.rgb/max(Q.a,1e-5))*e*${Cp}.x*.6;` : ''}
    vec3 lit_=1.-(1.-c)*(1.-clamp(gc,0.,1.));                         // screen: light on the base
    c=mix(lit_, fc, m); c+=gc*m*${Cp}.y*(1.-c);                       // the fill, glints over it`;
  else if (c.mode === 'ink') s += `
    float cov=1.-exp(-T.a*${A}.x*${Cp}.w); vec3 ic= ${FC}.r>=0. ? ${FC} : T.rgb/max(T.a,1e-5);
    c=mix(c, ic, clamp(cov,0.,1.)); c=mix(c, fc, m);`;
  else s += `
    float cov=step(${Cp}.w, T.a); vec3 pc=snapPal(T.rgb/max(T.a,1e-5));
    c=mix(c, pc, cov); c=mix(c, ${FC}.r>=0. ? ${FC} : snapPal(fc), m);`;
  return s + '\n  } }';
}
