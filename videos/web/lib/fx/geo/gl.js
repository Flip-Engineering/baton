// Tiny WebGL2 helper shared by the geo renderers (USMap relief, shader globe, thermal remap).
// One canvas + context per renderer; full-screen-triangle passes; textures from canvases or typed arrays.
// sync() forces the GPU to finish (a 1-pixel readback) so callers can time stages honestly under SwiftShader.
export const VS = `#version 300 es
out vec2 v; void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); v = p; gl_Position = vec4(p * 2. - 1., 0., 1.); }`;

export class GL {
  constructor(w, h, { alpha = true } = {}) {
    this.canvas = document.createElement('canvas'); this.canvas.width = w; this.canvas.height = h;
    const gl = this.gl = this.canvas.getContext('webgl2', { alpha, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, depth: false });
    if (!gl) throw new Error('geo/gl: no WebGL2');
    this.progs = {}; this.px = new Uint8Array(4);
  }
  resize(w, h) { if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; } }
  prog(name, fs) {
    if (this.progs[name]) return this.progs[name];
    const gl = this.gl;
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(`geo/gl ${name}: ${gl.getShaderInfoLog(x)}`); return x; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`geo/gl ${name}: ${gl.getProgramInfoLog(p)}`);
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = { loc: gl.getUniformLocation(p, a.name), type: a.type, size: a.size }; }
    return (this.progs[name] = { p, u });
  }
  // filter: 'linear' | 'nearest' | 'mip'; wrap: 'clamp' | 'repeat' (s only; t always clamps)
  tex({ filter = 'linear', wrap = 'clamp' } = {}) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    const f = filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter === 'mip' ? gl.LINEAR_MIPMAP_LINEAR : f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    t.filter = filter; return t;
  }
  // source: canvas/image, or { data: Uint8Array, w, h }
  upload(t, src, { flip = false } = {}) {
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (src.data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, src.w, src.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (t.filter === 'mip') gl.generateMipmap(gl.TEXTURE_2D);
    t.w = src.w || src.width; t.h = src.h || src.height;
    return t;
  }
  // one full-screen pass into the canvas (viewport w x h from the top-left). U: uniforms by name; T: textures by sampler name
  draw(name, fs, U = {}, T = {}, { w = this.canvas.width, h = this.canvas.height, blend = false } = {}) {
    const gl = this.gl, P = this.prog(name, fs);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // a sub-rect of a larger (grow-only) canvas: clear first, so bilinear reads past its edge see zeros, not an older frame
    if (w < this.canvas.width || h < this.canvas.height) { gl.disable(gl.SCISSOR_TEST); gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.viewport(0, this.canvas.height - h, w, h); gl.useProgram(P.p);
    if (blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
    let unit = 0;
    for (const [k, t] of Object.entries(T)) { if (!P.u[k]) continue; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(P.u[k].loc, unit++); }
    for (const [k, v] of Object.entries(U)) {
      const e = P.u[k]; if (!e) continue; const L = e.loc;
      if (e.type === gl.FLOAT) e.size > 1 ? gl.uniform1fv(L, v) : gl.uniform1f(L, v);
      else if (e.type === gl.INT || e.type === gl.BOOL) gl.uniform1i(L, v);
      else if (e.type === gl.FLOAT_VEC2) gl.uniform2fv(L, v);
      else if (e.type === gl.FLOAT_VEC3) gl.uniform3fv(L, v);
      else if (e.type === gl.FLOAT_VEC4) gl.uniform4fv(L, v);
      else if (e.type === gl.FLOAT_MAT3) gl.uniformMatrix3fv(L, false, v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // copy the top-left w x h of the canvas (as last drawn) into texture t, rows bottom-up (uv.y = gl y)
  copyTo(t, w, h) { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 0, this.canvas.height - h, w, h, 0); if (t.filter === 'mip') gl.generateMipmap(gl.TEXTURE_2D); t.w = w; t.h = h; return t; }
  clear() { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  sync() { const gl = this.gl; gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.px); }
}

// shared GLSL: hash / value noise / fbm, sRGB-ish helpers
export const GLSL_NOISE = `
float h21(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ v += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return v; }
`;
