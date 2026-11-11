// PROJECT: 2.5D camera projection for photographs (the matte-painting / 'photobash' move). A photo is projected
// from the camera that took it onto proxy depth, then a new camera moves through it: parallax, a push, a Rodchenko
// low angle and roll, a dolly-zoom. Cutout cards from the library (prep.py cut + depth) stand in front of the clean
// plate at their own depth with relief. WebGL2, stateless in its inputs.
//
//   import { Project } from '../lib/fx/project.js';
//   const pj = new Project(1080, 1920);
//   pj.begin({ fov: 38, pos: [0, 0, 0], yaw: 0, pitch: 0, roll: 0, shift: [0, 0] });   // the new camera (rest = the photo's)
//   pj.plate(plate.clean, { horizon: 0.66, near: 6, far: 60, sky: 400, x: 0.0 });      // background: ramp depth ground + sky
//   pj.card(plate.cut, { depth: plate.depth, box: plate.box, size: plate.size, z: 7, relief: 0.8 });   // subject at its place
//   pj.card(otherCut, { at: [-0.3, 0.1], z: 18, h: 0.35 });                              // a card from another photo
//   pj.end(ctx, { haze: ['#b8141b', 0.35], grain: 0.04 });
//
// Coordinates: the plate is framed by the rest camera with its height filling the frame (x crops; plate(x) pans the
// crop, -1..1). A card with box/size sits exactly where it was in its own photo (so the cut lines up with the
// clean plate at rest); a card with at [x, y] (frame units, -1..1 on height) and h (fraction of frame height at its
// depth) is placed anywhere. Depth: plate = horizon ramp (sky at 'sky' m, ground from far at the horizon to near at
// the bottom edge); card = z m plus relief * (its depth map's subject height).
const VS = `#version 300 es
in vec2 aUv;
uniform sampler2D uDepth; uniform int uMode;          // 0 plate ramp, 1 card
uniform mat4 uVP; uniform float uTan, uAsp, uHz, uNear, uFar, uSky, uZ, uRelief, uX;
uniform vec4 uBox, uCard;                             // uBox: card uv -> plate uv (x0, y0, w, h); uCard: at.x, at.y, h, w
uniform float uHasDepth, uOs;
out vec2 vUv; out float vZ;
void main(){
  vec2 uv = uMode == 0 ? vec2(mix(-uOs, 1. + uOs, aUv.x), mix(-uOs * 2., 1., aUv.y)) : aUv; float Z; vec2 p;   // plate overscan (sky side x2)                      // p: rest-camera image plane coords (y up, height -1..1)
  if (uMode == 0) {
    float y = 1. - uv.y;                               // 0 bottom .. 1 top of the photo
    float g = clamp((uHz - uv.y) / uHz, 0., 1.);        // 0 at the horizon .. 1 at the bottom edge (y down in uv)
    float below = step(uHz, uv.y);
    float t = clamp((uv.y - uHz) / (1. - uHz), 0., 1.);
    Z = below > .5 ? mix(uFar, uNear, t) : mix(uFar, uSky, smoothstep(0., .25, uHz - uv.y));
    p = vec2((uv.x - .5) * uAsp * 2. - uX * (uAsp - 9. / 16.), (.5 - uv.y) * 2.);
  } else {
    vec2 puv = uBox.xy + uv * uBox.zw;
    float rel = uHasDepth > .5 ? textureLod(uDepth, puv, 0.).r : 0.;
    Z = uZ - rel * uRelief;
    p = uCard.z > 0. ? vec2(uCard.x + (uv.x - .5) * uCard.w, uCard.y + (.5 - uv.y) * uCard.z)
                     : vec2((puv.x - .5) * uAsp * 2. - uX * (uAsp - 9. / 16.), (.5 - puv.y) * 2.);
  }
  vec3 P = vec3(p * uTan * Z, -Z);
  vUv = uv; vZ = Z;
  gl_Position = uVP * vec4(P, 1.);
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in float vZ; out vec4 o;
uniform sampler2D uImg; uniform vec3 uHaze; uniform float uHazeK, uHazeD, uCardA;
void main(){
  vec4 c = texture(uImg, clamp(vUv, 0., 1.));
  if (uCardA > .5 && c.a < .02) discard;
  float h = uHazeK * (1. - exp(-vZ / uHazeD));
  o = vec4(mix(c.rgb, uHaze, h), uCardA > .5 ? c.a : 1.);   // alpha-to-coverage antialiases the cut edge
}`;

const mat = {
  persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; },
  mul(a, b) { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return o; },
  rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; },
  rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
  rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
  trans(x, y, z) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]; },
};

export class Project {
  constructor(W = 1080, H = 1920, { canvas = null, restFov = 38 } = {}) {
    this.W = W; this.H = H; this.restFov = restFov;
    this.canvas = canvas || Object.assign(document.createElement('canvas'), { width: W, height: H });
    const gl = this.gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: true, alpha: false });
    const mk = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.p = p; this.u = {}; for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const a = gl.getActiveUniform(p, i); this.u[a.name] = gl.getUniformLocation(p, a.name); }
    this.grids = {}; this.tex = new WeakMap(); this.stats = {};
  }
  _grid(nx, ny) {
    const k = nx + 'x' + ny; if (this.grids[k]) return this.grids[k];
    const gl = this.gl, v = new Float32Array((nx + 1) * (ny + 1) * 2), idx = new Uint32Array(nx * ny * 6);
    for (let j = 0, q = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { v[q++] = i / nx; v[q++] = j / ny; }
    for (let j = 0, q = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.set([a, c, b, b, c, d], q); q += 6; }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.p, 'aUv'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    return (this.grids[k] = { vao, n: idx.length });
  }
  _tex(img, depth = false) {
    let t = this.tex.get(img); if (t) return t;
    const gl = this.gl; t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (depth) {                                         // 16-bit depth packed in RG (prep.py) -> R16F
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0); const p = x.getImageData(0, 0, w, h).data, f = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) f[i] = (p[i * 4] * 256 + p[i * 4 + 1]) / 65535;
      // the card's relief is its pillow height over the subject: rebase so the subject edge is 0
      let mn = 1; for (let i = 0; i < w * h; i++) if (f[i] > 0.5 && f[i] < mn) mn = f[i];
      for (let i = 0; i < w * h; i++) f[i] = Math.max(0, f[i] - mn) * 4;
      // soften the relief (two box passes, r ~ 1.2 % of the width) so the mesh edge does not stair-step
      const r = Math.max(2, Math.round(w * 0.012)), tmp = new Float32Array(w * h);
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y < h; y++) { let acc = 0; for (let x = -r; x <= r; x++) acc += f[y * w + Math.min(w - 1, Math.max(0, x))];
          for (let x = 0; x < w; x++) { tmp[y * w + x] = acc / (2 * r + 1); acc += f[y * w + Math.min(w - 1, x + r + 1)] - f[y * w + Math.max(0, x - r)]; } }
        for (let x = 0; x < w; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
          for (let y = 0; y < h; y++) { f[y * w + x] = acc / (2 * r + 1); acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.FLOAT, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex.set(img, t); return t;
  }
  begin({ fov = this.restFov, pos = [0, 0, 0], yaw = 0, pitch = 0, roll = 0, shift = [0, 0] } = {}, { haze = ['#000000', 0], hazeD = 40 } = {}) {
    const gl = this.gl; this.t0 = performance.now();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.W, this.H);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND);
    const P = mat.persp(fov * Math.PI / 180, this.W / this.H, 0.1, 2000);
    // view = inverse(camera): camera = T(pos) * Ry(yaw) * Rx(pitch) * Rz(roll); inverse = Rz(-r) Rx(-p) Ry(-y) T(-pos)
    let V = mat.mul(mat.rotZ(-roll), mat.mul(mat.rotX(-pitch), mat.mul(mat.rotY(-yaw), mat.trans(-pos[0], -pos[1], -pos[2]))));
    V = mat.mul(mat.trans(shift[0], shift[1], 0), V);
    gl.useProgram(this.p); const u = this.u;
    gl.uniformMatrix4fv(u.uVP, false, new Float32Array(mat.mul(P, V)));
    gl.uniform1f(u.uTan, Math.tan(this.restFov * Math.PI / 360));
    const hx = haze[0].replace('#', ''); gl.uniform3f(u.uHaze, ...[0, 2, 4].map(i => parseInt(hx.slice(i, i + 2), 16) / 255)); gl.uniform1f(u.uHazeK, haze[1]); gl.uniform1f(u.uHazeD, hazeD);
    return this;
  }
  plate(img, { horizon = 0.62, near = 6, far = 60, sky = 300, x = 0, overscan = 0.15 } = {}) {
    const gl = this.gl, u = this.u, w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    this.asp = w / h; this.x = x;
    gl.uniform1i(u.uMode, 0); gl.uniform1f(u.uAsp, w / h); gl.uniform1f(u.uHz, horizon); gl.uniform1f(u.uNear, near); gl.uniform1f(u.uFar, far); gl.uniform1f(u.uSky, sky); gl.uniform1f(u.uX, x);
    gl.uniform1f(u.uCardA, 0); gl.uniform1f(u.uOs, overscan);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._tex(img)); gl.uniform1i(u.uImg, 0);
    const g = this._grid(96, 160); gl.bindVertexArray(g.vao); gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_INT, 0);
    return this;
  }
  card(img, { depth = null, box = null, size = null, z = 8, relief = 0.6, at = null, h = 0.5 } = {}) {
    const gl = this.gl, u = this.u, w = img.naturalWidth || img.width, hh = img.naturalHeight || img.height;
    gl.uniform1i(u.uMode, 1); gl.uniform1f(u.uZ, z); gl.uniform1f(u.uRelief, relief); gl.uniform1f(u.uCardA, 1);
    if (box && size) gl.uniform4f(u.uBox, box[0] / size[0], box[1] / size[1], (box[2] - box[0]) / size[0], (box[3] - box[1]) / size[1]);
    else gl.uniform4f(u.uBox, 0, 0, 1, 1);
    gl.uniform4f(u.uCard, at ? at[0] : 0, at ? at[1] : 0, at ? h * 2 : 0, at ? h * 2 * w / hh : 0);
    gl.uniform1f(u.uAsp, size ? size[0] / size[1] : this.asp || w / hh); gl.uniform1f(u.uX, this.x || 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._tex(img)); gl.uniform1i(u.uImg, 0);
    gl.activeTexture(gl.TEXTURE1); if (depth) gl.bindTexture(gl.TEXTURE_2D, this._tex(depth, true)); gl.uniform1i(u.uDepth, 1); gl.uniform1f(u.uHasDepth, depth ? 1 : 0);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    const g = this._grid(160, Math.round(160 * hh / w)); gl.bindVertexArray(g.vao); gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_INT, 0);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    return this;
  }
  end(ctx = null) {
    if (ctx) ctx.drawImage(this.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
    this.stats = { ms: performance.now() - this.t0 };
    return this;
  }
}
