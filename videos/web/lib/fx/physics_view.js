// PHYSICS VIEWS: WebGL2 renderers that give the CPU simulations material, depth and light.
//
//   RigidView  2.5D bodies for a RigidWorld: every sprite gets a signed distance field, and one
//              instanced pass draws each body as a solid slab: a side wall swept along the extrusion
//              vector (sphere-traced through the SDF), a normal-mapped bevel from the SDF, a luma bump
//              (engraving reads as carved), Blinn specular that catches the bevel edges, per-material
//              params (stone / enamel / rubber / iron), soft drop shadows (max-blended so they never
//              double-darken), depth-of-field for background layers (mip blur + soft SDF edge), haze.
//   CrowdView  a Crowd on a ground plane seen through a pitched pinhole camera: terrain lit by a
//              plane-space light-pool buffer, hero agents as walking torch-bearer silhouettes rim-lit
//              by their own flame, the rest as torch dust that shrinks to points with distance, fog,
//              a bloom chain and heat haze over the flames. CROWD_LOOKS: torch | ink.
import { W, H, clamp } from '../kit.js';
import { sdfOf } from './physics.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
function glc(w, h, opts = {}) {
  const cv = canvas(w, h);
  const gl = cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true, depth: true, ...opts });
  if (!gl) throw new Error('webgl2 unavailable');
  return { cv, gl };
}
function prog(gl, vs, fs) {
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n')); return s; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace('[0]', '')] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}
function setU(gl, pr, uni) {
  let unit = 0;
  for (const [k, val] of Object.entries(uni)) {
    const loc = pr.u[k]; if (loc == null) continue;
    if (val instanceof WebGLTexture) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, val); gl.uniform1i(loc, unit++); }
    else if (typeof val === 'number') gl.uniform1f(loc, val);
    else if (val.length === 2) gl.uniform2fv(loc, val); else if (val.length === 3) gl.uniform3fv(loc, val);
    else if (val.length === 9 && k === 'CAM') gl.uniformMatrix3fv(loc, false, val); else gl.uniform4fv(loc, val);
  }
}
function tex(gl, w, h, { data = null, fmt = 'rgba8', filter = 'linear', wrap = 'clamp', mip = false, premul = false } = {}) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  const F = { rgba8: [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE], rgba16f: [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT] }[fmt];
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul);
  if (data instanceof HTMLCanvasElement) gl.texImage2D(gl.TEXTURE_2D, 0, F[0], F[1], F[2], data);
  else gl.texImage2D(gl.TEXTURE_2D, 0, F[0], w, h, 0, F[1], F[2], data);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  const fl = filter === 'linear' ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : fl); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, fl);
  const wr = wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
  return t;
}
function fbo(gl, w, h, fmt = 'rgba8') { const t = tex(gl, w, h, { fmt }); const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return { t, fb, w, h }; }
const NOISE = `
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++){ v += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return v; }`;
const BB = `vec3 bb(float x){ x = clamp(x, 0., 1.6);
  vec3 c = mix(vec3(0), vec3(.35, .01, .02), smoothstep(0., .15, x));
  c = mix(c, vec3(.79, .07, .12), smoothstep(.1, .35, x)); c = mix(c, vec3(1., .42, .08), smoothstep(.32, .68, x));
  c = mix(c, vec3(1., .8, .42), smoothstep(.62, 1., x)); c = mix(c, vec3(1., .97, .9), smoothstep(.95, 1.4, x)); return c; }`;
const FSQ = `#version 300 es
out vec2 v; void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); v = p; gl_Position = vec4(p * 2. - 1., 0., 1.); }`;

// ================================================================== RIGID VIEW (2.5D)
// amb, diff, spec, shininess | bevel px, bevel slope, bump, wall darkening | substrate rgb (worn spots, walls), wall = substrate mix
export const MATERIALS = {
  stone:  { a: [0.30, 1.00, 0.22, 14], b: [10, 1.1, 1.6, 0.55], c: [0.30, 0.27, 0.25, 0.25] },
  enamel: { a: [0.26, 0.95, 1.10, 70], b: [7, 1.4, 0.35, 0.5], c: [0.09, 0.07, 0.07, 0.85] },
  rubber: { a: [0.34, 0.85, 0.28, 9], b: [9, 1.0, 0.8, 0.5], c: [0.28, 0.04, 0.06, 0.6] },
  iron:   { a: [0.22, 0.80, 1.40, 40], b: [6, 1.4, 0.5, 0.45], c: [0.05, 0.045, 0.045, 1.0] },
  gilt:   { a: [0.25, 0.90, 1.50, 50], b: [8, 1.2, 0.8, 0.45], c: [0.30, 0.20, 0.06, 0.7] },
};
const RANGE = 24, PAD = 18;
export class RigidView {
  // light: toward the light (x right, y down, z to viewer); extrude: world px offset of the slab's back face
  // res < 1 renders at a fraction of the frame (a blurred background layer at 0.5 costs a quarter); drawImage it at W x H
  constructor(world, { res = 1, materials = ['stone'], light = [-0.5, -0.65, 0.58], extrude = [9, -22], atlasW = 2048 } = {}) {
    const width = Math.round(W * res), height = Math.round(H * res);
    Object.assign(this, { world, width, height, res, light, extrude, atlasW });
    this.matNames = materials;
    const { cv, gl } = glc(width, height); this.cv = cv; this.gl = gl;
    this.open = 0; this.built = false;      // open: 0..1, fixed bodies (unreleased shards) bevel only their source outline until the scene opens them
    this.pr = prog(gl, `#version 300 es
      in vec2 c; in vec4 iPose, iRect, iOrig;
      uniform mat3 CAM; uniform vec2 R; uniform float M, PASS;
      out vec2 sp; flat out vec4 vPose, vRect, vOrig;
      void main(){
        vec2 lp = mix(vec2(-M), iRect.zw + M, c); sp = lp;
        vec2 q = lp - iOrig.xy; float ca = cos(iPose.z), sa = sin(iPose.z);
        vec2 w = iPose.xy + vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
        vec3 s = CAM * vec3(w, 1.);
        vPose = iPose; vRect = iRect; vOrig = iOrig;
        gl_Position = vec4(s.x / R.x * 2. - 1., 1. - s.y / R.y * 2., 0., 1.); }`,
    `#version 300 es
      precision highp float;
      in vec2 sp; flat in vec4 vPose, vRect, vOrig; out vec4 o;
      uniform sampler2D ALB, SDF; uniform vec2 ATL, E, shOff; uniform vec3 L; uniform float PASS, blur, shA, shSoft, openAll, RANGE_, PAD_;
      uniform vec4 MA[6], MB[6], MC[6], haze;
      vec4 S(vec2 p){ return texture(SDF, (vRect.xy + p) / ATL); }
      float boxD(vec2 p){ vec2 d = max(-p, p - vRect.zw); return length(max(d, 0.)); }
      bool inPad(vec2 p){ return all(greaterThan(p, vec2(-PAD_ + 1.))) && all(lessThan(p, vRect.zw + PAD_ - 1.)); }
      float sdR(vec2 p){ return inPad(p) ? (S(p).r - .5) * 2. * RANGE_ : max(boxD(p), PAD_ - 1.); }
      vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
      void main(){
        int m = int(vOrig.z + .5); float open = max(vOrig.w, openAll);
        float dR = sdR(sp), bl = 1. + blur;
        // drop shadow onto the backdrop, in the same pass: depth .95 sits behind every body, and the first
        // shadow written at a pixel blocks the next (LESS), so overlapping shadows never double-darken
        #define SHADOW { if (shA <= 0.) discard; float d = sdR(sp - rot(shOff, -vPose.z)); if (d > shSoft) discard; \
          o = vec4(0, 0, 0, (1. - smoothstep(-shSoft, shSoft, d)) * shA); gl_FragDepth = .95; return; }
        if (dR > length(E) + bl + 1.) SHADOW                 // farther from the shape than the extrusion reaches
        vec4 s0 = inPad(sp) ? S(sp) : vec4(1);
        vec4 A = MA[m], Bm = MB[m], Cm = MC[m];
        vec3 Lw = normalize(L);
        if (dR < .5 * bl) {
          // ---- face: bevel from the edge SDF (outline before a shard is released), bump from the albedo luma
          float e = 1.5;
          vec4 sx0 = S(sp - vec2(e, 0)), sx1 = S(sp + vec2(e, 0)), sy0 = S(sp - vec2(0, e)), sy1 = S(sp + vec2(0, e));
          float bw = Bm.x;
          #define EDGE(s) max((s.g - .5) * 2. * RANGE_, mix(-RANGE_, (s.r - .5) * 2. * RANGE_, open))
          #define HGT(s) smoothstep(0., bw, -EDGE(s))
          vec2 gH = vec2(HGT(sx1) - HGT(sx0), HGT(sy1) - HGT(sy0)) / (2. * e) * bw;
          vec2 gB = vec2(sx1.b - sx0.b, sy1.b - sy0.b) / (2. * e);
          vec3 n = normalize(vec3(-gH * Bm.y - gB * Bm.z * 6., 1.));
          n.xy = rot(n.xy, vPose.z);
          float lod = log2(bl);
          vec4 al = textureLod(ALB, (vRect.xy + sp) / ATL, lod);
          vec3 base = mix(Cm.rgb, al.rgb / max(al.a, 1e-3), clamp(al.a * 1.4 - .2, 0., 1.));
          float diff = max(dot(n, Lw), 0.);
          vec3 hv = normalize(Lw + vec3(0, 0, 1)); float spec = pow(max(dot(n, hv), 0.), A.w) * A.z;
          float h = HGT(s0), cav = mix(.72, 1., smoothstep(0., .5, h));          // the bevel foot sits in its own shadow
          vec3 col = base * (A.x + A.y * diff) * cav + spec * vec3(1., .95, .88);
          float cov = clamp(.5 - dR / bl, 0., 1.);
          col = mix(col, haze.rgb, haze.a);
          o = vec4(col * cov, cov);
          gl_FragDepth = .3 - .25 * vPose.w;
          return;
        }
        // ---- side wall: sphere-trace the sweep of the face along the extrusion vector
        vec2 Es = rot(E, -vPose.z); float D = length(Es); vec2 dir = Es / max(D, 1e-4);
        float st = 0., md = 1e9; bool hit = false;
        for (int i = 0; i < 16; i++) {
          float d = sdR(sp - dir * st); md = min(md, d);
          if (d < .3) { hit = true; break; }
          st += max(d, .8); if (st > D) break;
        }
        float cov = hit ? 1. : clamp(.5 - md / bl, 0., 1.);
        if (cov <= 0.) SHADOW
        st = min(st, D);
        vec2 q = sp - dir * st;
        float e = 1.5;
        vec2 g = vec2(sdR(q + vec2(e, 0)) - sdR(q - vec2(e, 0)), sdR(q + vec2(0, e)) - sdR(q - vec2(0, e)));
        vec2 nw = rot(normalize(g + 1e-5), vPose.z);
        vec3 n = normalize(vec3(nw, .25));
        vec4 al = textureLod(ALB, (vRect.xy + q) / ATL, log2(bl) + 1.);
        vec3 base = mix(al.rgb / max(al.a, 1e-3), Cm.rgb, Cm.a) * (1. - Bm.w);
        float k = st / max(D, 1e-4);
        float diff = max(dot(n, Lw), 0.);
        vec3 hv = normalize(Lw + vec3(0, 0, 1)); float spec = pow(max(dot(n, hv), 0.), A.w * .5) * A.z * .5;
        vec3 col = base * (A.x * .7 + A.y * diff) * (1. - .55 * k) + spec * (1. - k) * vec3(1., .94, .86);
        col = mix(col, haze.rgb, haze.a);
        o = vec4(col * cov, cov);
        gl_FragDepth = .6 + .3 * k - .05 * vPose.w;
      }`);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const q = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, q); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const lc = gl.getAttribLocation(this.pr.p, 'c'); gl.enableVertexAttribArray(lc); gl.vertexAttribPointer(lc, 2, gl.FLOAT, false, 0, 0);
    this.ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.ib);
    ['iPose', 'iRect', 'iOrig'].forEach((nm, k) => { const l = gl.getAttribLocation(this.pr.p, nm); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 48, k * 16); gl.vertexAttribDivisor(l, 1); });
  }
  // pack every body's sprite into an albedo atlas + an SDF atlas (r: own edge, g: source outline, b: luma bump)
  _build() {
    const defs = this.world.defs, gl = this.gl, AW = this.atlasW;
    const items = defs.map((d, i) => ({ i, d, w: d.sprite ? d.sprite.width : 0, h: d.sprite ? d.sprite.height : 0 })).filter(x => x.w);
    items.sort((a, b) => b.h - a.h);
    let x = PAD, y = PAD, rowH = 0;
    for (const it of items) {
      if (x + it.w + PAD > AW) { x = PAD; y += rowH + PAD * 2; rowH = 0; }
      it.ax = x; it.ay = y; x += it.w + PAD * 2; rowH = Math.max(rowH, it.h);
    }
    const AH = Math.min(8192, 1 << Math.ceil(Math.log2(y + rowH + PAD)));
    const alb = canvas(AW, AH), ag = alb.getContext('2d');
    const sdf = new Uint8Array(AW * AH * 4);
    for (let k = 0; k < sdf.length; k += 4) { sdf[k] = 255; sdf[k + 1] = 255; sdf[k + 2] = 0; sdf[k + 3] = 255; }
    const srcSD = new Map();
    const enc = d => Math.max(0, Math.min(255, Math.round((0.5 + d / (2 * RANGE)) * 255)));
    for (const it of items) {
      const sp = it.d.sprite; ag.drawImage(sp, it.ax, it.ay);
      const pw = it.w + PAD * 2, ph = it.h + PAD * 2;
      const pc = canvas(pw, ph), pg = pc.getContext('2d', { willReadFrequently: true }); pg.drawImage(sp, PAD, PAD);
      const data = pg.getImageData(0, 0, pw, ph).data, own = sdfOf(data, pw, ph, 127);
      let out = own;
      if (it.d.src) {       // shard: outline SDF of the whole source, cropped
        let e = srcSD.get(it.d.src.cv);
        if (!e) { const c = it.d.src.cv, sd = sdfOf(c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data, c.width, c.height, 127); e = { sd, w: c.width, h: c.height }; srcSD.set(c, e); }
        out = new Float32Array(pw * ph);
        for (let yy = 0; yy < ph; yy++) for (let xx = 0; xx < pw; xx++) {
          const sx = xx - PAD + it.d.src.x, sy = yy - PAD + it.d.src.y;
          out[yy * pw + xx] = sx >= 0 && sy >= 0 && sx < e.w && sy < e.h ? e.sd[sy * e.w + sx] : RANGE;
        }
      }
      for (let yy = 0; yy < ph; yy++) for (let xx = 0; xx < pw; xx++) {
        const X = it.ax - PAD + xx, Y = it.ay - PAD + yy; if (X < 0 || Y < 0 || X >= AW || Y >= AH) continue;
        const k = (Y * AW + X) * 4, j = yy * pw + xx, a = data[j * 4 + 3] / 255;
        sdf[k] = enc(own[j]); sdf[k + 1] = enc(out[j]);
        sdf[k + 2] = Math.round(((data[j * 4] * 0.3 + data[j * 4 + 1] * 0.5 + data[j * 4 + 2] * 0.2) / 255 * a) * 255);
      }
    }
    this.ATL = [AW, AH];
    // albedo premultiplied by the browser canvas; mips give the depth-of-field blur
    this.albTex = tex(gl, AW, AH, { data: alb, mip: true, premul: true });
    this.sdfTex = tex(gl, AW, AH, { data: sdf });
    this.rects = new Map(items.map(it => [it.i, [it.ax, it.ay, it.w, it.h]]));
    this.maxDim = Math.max(...items.map(it => Math.max(it.w, it.h)));
    this.built = true;
  }
  // cam = canvas-style affine [a, b, c, d, e, f] (world -> screen); ids: subset; blur px; haze [r,g,b,amount]
  render(t, { cam = [1, 0, 0, 1, 0, 0], ids = null, blur = 0, haze = [0, 0, 0, 0], shadow = { off: [16, 20], soft: 14, alpha: 0.5 }, light = this.light, extrude = this.extrude, open = this.open, clear = true } = {}) {
    if (!this.built) this._build();
    const gl = this.gl, w = this.world, st = w.at(t), n = w.defs.length;
    const list = (ids || w.defs.map((_, i) => i)).filter(i => st[n * 3 + i] && this.rects.has(i)).sort((a, b) => w.defs[a].z - w.defs[b].z || a - b);
    const buf = new Float32Array(list.length * 12);
    list.forEach((i, k) => {
      const d = w.defs[i], r = this.rects.get(i), mi = Math.max(0, typeof d.mat === 'string' ? this.matNames.indexOf(d.mat) : d.mat || 0);
      buf.set([st[i * 3], st[i * 3 + 1], st[i * 3 + 2], list.length > 1 ? k / (list.length - 1) : 0, r[0], r[1], r[2], r[3], d.ox, d.oy, mi, d.fixed ? 0 : 1], k * 12);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.width, this.height);
    if (clear) { gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
    gl.useProgram(this.pr.p); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ib); gl.bufferData(gl.ARRAY_BUFFER, buf, gl.DYNAMIC_DRAW);
    const MA = [], MB = [], MC = [];
    for (let k = 0; k < 6; k++) { const m = MATERIALS[this.matNames[k]] || MATERIALS.stone; MA.push(...m.a); MB.push(...m.b); MC.push(...m.c); }
    const ex = Math.hypot(...extrude), so = shadow && shadow.alpha > 0 ? Math.hypot(...shadow.off) + shadow.soft : 0, k = this.res;
    const base = { CAM: [cam[0] * k, cam[1] * k, 0, cam[2] * k, cam[3] * k, 0, cam[4] * k, cam[5] * k, 1], R: [this.width, this.height], ALB: this.albTex, SDF: this.sdfTex, ATL: this.ATL,
      L: light, E: extrude, shOff: shadow.off, shA: shadow.alpha, shSoft: shadow.soft, blur, haze, openAll: open, RANGE_: RANGE, PAD_: PAD,
      MA: new Float32Array(MA), MB: new Float32Array(MB), MC: new Float32Array(MC) };
    // one pass: faces + walls + drop shadows (depth: faces in front of walls, walls front-to-back, shadows last)
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    setU(gl, this.pr, { ...base, shA: shadow ? shadow.alpha : 0, PASS: 1, M: Math.max(ex + 3 + blur, so + 2) });
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, list.length);
    gl.disable(gl.DEPTH_TEST);
    return this.cv;
  }
}

// ================================================================== CROWD VIEW (perspective ground plane)
export const CROWD_LOOKS = {
  torch: { ground: [0.20, 0.15, 0.13], amb: [0.05, 0.035, 0.035], pool: [1.0, 0.36, 0.12], poolK: 1.0, fog: [0.13, 0.03, 0.03], fogK: 0.00028,
    sky0: [0.012, 0.01, 0.014], sky1: [0.22, 0.04, 0.04], dust: [1.0, 0.55, 0.22], dustK: 1.0, fig: [0.035, 0.028, 0.03], rim: [1.0, 0.55, 0.25],
    bloom: 0.4, haze: 1.0, exposure: 1.0, blend: 'add', flame: 1 },
  ink: { ground: [0.93, 0.88, 0.79], amb: [1, 1, 1], pool: [-0.5, -0.55, -0.6], poolK: 0.6, fog: [0.9, 0.86, 0.8], fogK: 0.00018,
    sky0: [0.93, 0.89, 0.82], sky1: [0.9, 0.84, 0.76], dust: [0.08, 0.05, 0.05], dustK: 1.0, fig: [0.07, 0.05, 0.05], rim: [0.75, 0.1, 0.15],
    bloom: 0, haze: 0, exposure: 1, blend: 'ink', flame: 0 },
};
// projection shared by JS and GLSL: plane point (X, Y, height) -> screen; see cam() below
export function projectPlane(c, X, Y, h = 0) {
  const s = Math.sin(c.pitch), co = Math.cos(c.pitch), u = X - c.look[0], w = Y - c.look[1];
  const z = c.dist - w * co - h * s, yc = h * co - w * s;
  return [c.screen[0] + c.focal * u / z, c.screen[1] - c.focal * yc / z, z];
}
const PROJ = `uniform vec4 CAMP, LOOK; uniform vec2 R;
vec3 proj(vec3 P){ float s = sin(CAMP.x), c = cos(CAMP.x); float u = P.x - LOOK.x, w = P.y - LOOK.y;
  float z = CAMP.y - w * c - P.z * s, yc = P.z * c - w * s; return vec3(LOOK.z + CAMP.z * u / z, LOOK.w - CAMP.z * yc / z, z); }
vec4 clip(vec2 sc){ return vec4(sc.x / R.x * 2. - 1., 1. - sc.y / R.y * 2., 0., 1.); }`;
export class CrowdView {
  static preset(name, crowd, o = {}) { return new CrowdView(crowd, { ...CROWD_LOOKS[name], ...o }); }
  constructor(crowd, o = {}) {
    Object.assign(this, { width: W, height: H, heroes: 300, figH: 120, torchH: 118, poolR: 150, dustSize: 22, lightRect: [-1400, -2600, 4000, 5200], ...CROWD_LOOKS.torch, ...o });
    this.crowd = crowd;
    const { cv, gl } = glc(this.width, this.height, { depth: false }); this.cv = cv; this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('no float render targets');
    this.P = {
      pool: prog(gl, `#version 300 es
        in vec2 p; uniform vec4 PX; uniform float PS; out float fl;
        void main(){ vec2 q = (p - PX.xy) / PX.zw; gl_Position = vec4(q * 2. - 1., 0, 1); gl_PointSize = PS; fl = fract(sin(float(gl_VertexID) * 12.9898) * 43758.5453); }`,
      `#version 300 es
        precision highp float; in float fl; out vec4 o; uniform vec3 POOL; uniform float T;
        void main(){ float d = length(gl_PointCoord - .5) * 2.; float a = exp(-d * d * 3.2) * (1. - d); if (a <= 0.) discard;
          float f = .8 + .2 * sin(T * 17. + fl * 60.) * sin(T * 5.3 + fl * 21.); o = vec4(POOL * a * f, 1); }`),
      ground: prog(gl, FSQ, `#version 300 es
        precision highp float; in vec2 v; out vec4 o; ${PROJ}
        uniform sampler2D GT, LT; uniform vec4 PX; uniform vec3 GC, AMB, FOG, SKY0, SKY1; uniform float FOGK, POOLK, T, INK;
        ${NOISE}
        void main(){ vec2 sc = vec2(v.x * R.x, (1. - v.y) * R.y);
          float s = sin(CAMP.x), c = cos(CAMP.x), xn = (sc.x - LOOK.z) / CAMP.z, yn = -(sc.y - LOOK.w) / CAMP.z;
          float Ry = yn * c - s;
          vec3 sky = mix(SKY1, SKY0, smoothstep(-.02, .5, yn - s / max(c, 1e-3)));
          if (Ry > -.03) sky *= .8 + .4 * fbm(vec2(xn * 2.5 + T * .02, yn * 7.));       // clouds only where sky shows
          if (Ry > -1e-4) { o = vec4(sky, 1); return; }
          float tt = -CAMP.y * s / Ry;
          vec2 P = vec2(tt * xn, CAMP.y * c + tt * (-yn * s - c)) + LOOK.xy;
          float dist = tt * length(vec3(xn, Ry, -yn * s - c));
          vec3 alb = GC * texture(GT, P / 700.).rgb * (.75 + .5 * texture(GT, P / 5100. + .31).a);
          vec3 lt = texture(LT, (P - PX.xy) / PX.zw).rgb * POOLK;
          vec3 col = INK > .5 ? alb * (1. + lt) : alb * (AMB + lt);
          float f = 1. - exp(-dist * FOGK);
          col = mix(col, FOG, f);
          col = mix(col, sky, smoothstep(-.03, 0., Ry) );
          o = vec4(col, 1); }`),
      bake: prog(gl, FSQ, `#version 300 es
        precision highp float; in vec2 v; out vec4 o; ${NOISE}
        float pn(vec2 p, float per){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(h12(mod(i, per)), h12(mod(i + vec2(1, 0), per)), f.x), mix(h12(mod(i + vec2(0, 1), per)), h12(mod(i + vec2(1, 1), per)), f.x), f.y); }
        void main(){ vec2 p = v; float a = 0., amp = .5, per = 8.; for (int i = 0; i < 6; i++){ a += amp * pn(p * per, per); per *= 2.; amp *= .5; }
          float st = smoothstep(.62, .7, pn(p * 64., 64.)) * .5;                 // pebbles
          float rut = smoothstep(.45, .5, pn(vec2(p.x * 4., p.y * 32.), 32.) ) * .15;   // trampled furrows
          float g = .55 + .7 * (a - .5) + st - rut;
          o = vec4(vec3(g * 1.05, g * .95, g * .88), pn(p * 4., 4.)); }`),     // a = large-scale variation
      dots: prog(gl, `#version 300 es
        in vec2 p; ${PROJ} uniform float PS, TH, FOGK, T, HERO; out float br; out float fl;
        void main(){ vec3 s = proj(vec3(p, TH)); float k = CAMP.z / s.z;
          fl = fract(sin(float(gl_VertexID) * 78.233) * 43758.5453);
          gl_Position = s.z > 10. ? clip(s.xy) : vec4(2, 2, 2, 1);
          gl_PointSize = clamp(PS * k, 1.6, 26.);
          br = clamp(pow(k, .6), .08, 1.4) * exp(-s.z * FOGK * .6) * (float(gl_VertexID) < HERO ? .55 : 1.); }`,
      `#version 300 es
        precision highp float; in float br; in float fl; out vec4 o; uniform vec3 DC; uniform float T, INK;
        void main(){ vec2 q = gl_PointCoord - .5; float d = length(q) * 2.; float a = INK > .5 ? smoothstep(1., .6, d) : exp(-d * d * 5.) * (1. - d);
          if (a <= 0.) discard; float f = .75 + .25 * sin(T * 23. + fl * 40.);
          o = INK > .5 ? vec4(DC * a, a) * br : vec4(DC * a * br * f + vec3(1., .9, .75) * smoothstep(.35, 0., d) * br * f, 0); }`),
      figs: prog(gl, `#version 300 es
        in vec2 c; in vec4 iA; in vec4 iB; ${PROJ} uniform float FH; out vec2 uv; out float fz; flat out vec4 vB;
        // iA = (X, Y, pose, flip), iB = (light r, g, b, flicker)
        void main(){ vec3 f = proj(vec3(iA.xy, 0.)), h = proj(vec3(iA.xy, FH)); float hh = f.y - h.y, ww = hh * .5;
          float x = mix(-ww * .5, ww * .5, c.x), y = mix(-hh, 0., c.y);
          uv = vec2((iA.z + (iA.w > .5 ? 1. - c.x : c.x)) / 8., c.y); fz = f.z; vB = iB;
          gl_Position = clip(vec2(f.x + x, f.y + y)); }`,
      `#version 300 es
        precision highp float; in vec2 uv; in float fz; flat in vec4 vB; out vec4 o; uniform sampler2D FA; uniform vec3 FC, RIM, FOG; uniform float FOGK;
        void main(){ vec4 a = texture(FA, uv); if (a.r < .02) discard;
          vec3 col = FC * (1. + vB.rgb * 2.2) + RIM * a.g * vB.a * 1.6;
          float fg = 1. - exp(-fz * FOGK); col = mix(col, FOG, fg);
          o = vec4(col * a.r, a.r); }`),
      flames: prog(gl, `#version 300 es
        in vec2 c; in vec4 iA; in vec4 iB; ${PROJ} uniform float FH, SZ; out vec2 q; out float seed; out float fk;
        void main(){ vec3 hnd = proj(vec3(iA.xy, FH * .9)); vec3 f = proj(vec3(iA.xy, 0.)), h = proj(vec3(iA.xy, FH)); float hh = f.y - h.y;
          float sz = hh * SZ, off = (iA.w > .5 ? -1. : 1.) * hh * .16;
          q = c * 2. - 1.; seed = iB.w; fk = exp(-hnd.z * .00018);
          gl_Position = clip(vec2(hnd.x + off + q.x * sz * .5, hnd.y - hh * .03 - (q.y * .5 + .5) * sz * 1.5)); }`,
      `#version 300 es
        precision highp float; in vec2 q; in float seed; in float fk; out vec4 o; uniform float T; ${NOISE} ${BB}
        void main(){ float n = vn(vec2(q.x * 3. + seed * 17., q.y * 2.5 - T * 9.)), n2 = vn(vec2(q.x * 7. - seed, q.y * 6. - T * 15.));
          vec2 p = vec2(q.x + (n - .5) * .5 * (q.y + 1.), q.y);
          float w = mix(.62, .08, clamp(p.y * .5 + .5, 0., 1.));
          float d = length(vec2(p.x / w, (p.y + .45) * .75));
          float f = smoothstep(1., .15, d) * (.75 + .5 * n2);
          vec3 c = bb(f * 1.35) * f * 1.6 * fk; o = vec4(c, 0); }`),
      blur: prog(gl, FSQ, `#version 300 es
        precision highp float; in vec2 v; out vec4 o; uniform sampler2D S; uniform vec2 D;
        void main(){ vec3 c = texture(S, v).rgb * .227;
          c += (texture(S, v + D * 1.385).rgb + texture(S, v - D * 1.385).rgb) * .316;
          c += (texture(S, v + D * 3.231).rgb + texture(S, v - D * 3.231).rgb) * .0703; o = vec4(c, 1); }`),
      comp: prog(gl, FSQ, `#version 300 es
        precision highp float; in vec2 v; out vec4 o; uniform sampler2D S, B1, B2; uniform float BLOOM, HAZE, T, EXPO, INK; ${NOISE}
        void main(){
          vec3 b1 = texture(B1, v).rgb, b2 = texture(B2, v).rgb;
          float heat = clamp(dot(b2, vec3(.3, .5, .2)) * 3., 0., 1.);
          vec2 off = (vec2(vn(v * vec2(60., 100.) + vec2(0, T * 2.3)), vn(v * vec2(60., 100.) + vec2(9.1, T * 2.9))) - .5) * .006 * HAZE * heat;
          vec3 c = texture(S, v + off).rgb;
          if (INK < .5) { c += b1 * BLOOM * .8 + b2 * BLOOM * 1.4; c = 1. - exp(-c * EXPO); }
          o = vec4(c, 1); }`),
    };
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.pbuf = gl.createBuffer(); this.qbuf = gl.createBuffer(); this.ibuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.qbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.LT = fbo(gl, 384, 512, 'rgba16f');
    this.S = fbo(gl, this.width, this.height);
    const qw = this.width >> 2, qh = this.height >> 2;
    this.E1 = fbo(gl, qw, qh, 'rgba16f'); this.E1b = fbo(gl, qw, qh, 'rgba16f');
    this.E2 = fbo(gl, qw >> 1, qh >> 1, 'rgba16f'); this.E2b = fbo(gl, qw >> 1, qh >> 1, 'rgba16f');
    // ground albedo, baked once (tileable)
    this.GT = fbo(gl, 1024, 1024); this._fs(this.P.bake, this.GT, {});
    gl.bindTexture(gl.TEXTURE_2D, this.GT.t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.generateMipmap(gl.TEXTURE_2D);
    this.FA = tex(gl, 0, 0, { data: figureAtlas(), mip: true });
  }
  _fs(pr, target, uni) {
    const gl = this.gl; gl.useProgram(pr.p); setU(gl, pr, uni);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null); gl.viewport(0, 0, target ? target.w : this.width, target ? target.h : this.height);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  _attr(pr, name, buf, size, stride = 0, off = 0, div = 0) {
    const gl = this.gl, l = gl.getAttribLocation(pr.p, name); if (l < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, off); gl.vertexAttribDivisor(l, div);
  }
  _resetAttrs() { const gl = this.gl; for (let i = 0; i < 8; i++) { gl.disableVertexAttribArray(i); gl.vertexAttribDivisor(i, 0); } }
  // cam: { pitch (rad), dist, focal, look: [X, Y] plane point at the screen centre, screen: [sx, sy] }
  render(t, cam, { heat = 1, strike = 0 } = {}) {
    const gl = this.gl, cr = this.crowd, n = cr.n, S = cr.at(t);
    const CAMP = [cam.pitch, cam.dist, cam.focal, 0], LOOK = [cam.look[0], cam.look[1], cam.screen[0], cam.screen[1]], R = [this.width, this.height];
    const PX = this.lightRect, ink = this.blend === 'ink' ? 1 : 0;
    gl.bindVertexArray(this.vao); this._resetAttrs();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pbuf); gl.bufferData(gl.ARRAY_BUFFER, S.subarray(0, n * 2), gl.DYNAMIC_DRAW);
    // 1. light pools in plane space
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.LT.fb); gl.viewport(0, 0, this.LT.w, this.LT.h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.P.pool.p); this._attr(this.P.pool, 'p', this.pbuf, 2);
    setU(gl, this.P.pool, { PX, PS: this.poolR * 2 / PX[2] * this.LT.w, POOL: this.pool.map(c => c * 0.16 * heat), T: t });
    gl.drawArrays(gl.POINTS, 0, n);
    // 2. scene: ground, figures (far -> near), dust, flames
    gl.disable(gl.BLEND);
    this._fs(this.P.ground, this.S, { CAMP, LOOK, R, GT: this.GT.t, LT: this.LT.t, PX, GC: this.ground, AMB: this.amb, FOG: this.fog, SKY0: this.sky0, SKY1: this.sky1,
      FOGK: this.fogK, POOLK: this.poolK * (1 + strike), T: t, INK: ink });
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.S.fb); gl.viewport(0, 0, this.width, this.height);
    // heroes: sort by depth, sample their light on the CPU-free path (light at the feet comes from the pool buffer via the ground; here a flat warm term)
    const nh = Math.min(this.heroes, n), hs = [];
    for (let i = 0; i < nh; i++) { const pr = projectPlane(cam, S[i * 2], S[i * 2 + 1]); if (pr[2] > 380) hs.push([pr[2], i]); }   // too close to the lens: dust only
    hs.sort((a, b) => b[0] - a[0]);
    const inst = new Float32Array(hs.length * 8);
    hs.forEach(([, i], k) => {
      const vx = S[n * 2 + i * 2], vy = S[n * 2 + i * 2 + 1], sp = Math.hypot(vx, vy);
      const ph = (t * (1.2 + sp / 160) + (i * 0.618) % 1) % 1, pose = Math.floor(ph * 4) + (i % 2) * 4 * 0;
      const fl = 0.75 + 0.25 * Math.sin(t * 19 + i * 1.7) * Math.sin(t * 6.1 + i);
      inst.set([S[i * 2], S[i * 2 + 1], sp < 25 ? 4 + (i % 4) : pose, vx < 0 ? 1 : 0, 0.10 * heat, 0.05 * heat, 0.03 * heat, fl * heat], k * 8);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.P.figs.p); this._resetAttrs();
    this._attr(this.P.figs, 'c', this.qbuf, 2); this._attr(this.P.figs, 'iA', this.ibuf, 4, 32, 0, 1); this._attr(this.P.figs, 'iB', this.ibuf, 4, 32, 16, 1);
    setU(gl, this.P.figs, { CAMP, LOOK, R, FH: this.figH, FA: this.FA, FC: this.fig, RIM: this.rim, FOG: this.fog, FOGK: this.fogK });
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, hs.length);
    // dust (every agent, torch height), additive (or ink over)
    // vw = viewport width (points are sized in viewport px; positions go through the frame-px projection)
    const dots = (vw, scale) => {
      gl.useProgram(this.P.dots.p); this._resetAttrs(); this._attr(this.P.dots, 'p', this.pbuf, 2);
      if (ink) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); else gl.blendFunc(gl.ONE, gl.ONE);
      setU(gl, this.P.dots, { CAMP, LOOK, R, PS: this.dustSize * scale * vw / this.width, TH: ink ? 0 : this.torchH, FOGK: this.fogK, T: t, HERO: nh,
        DC: this.dust.map(c => c * this.dustK * (ink ? 1 : heat)), INK: ink });
      gl.drawArrays(gl.POINTS, 0, n);
    };
    const flames = scale => {
      if (!this.flame || !hs.length) return;
      gl.useProgram(this.P.flames.p); this._resetAttrs();
      this._attr(this.P.flames, 'c', this.qbuf, 2); this._attr(this.P.flames, 'iA', this.ibuf, 4, 32, 0, 1); this._attr(this.P.flames, 'iB', this.ibuf, 4, 32, 16, 1);
      gl.blendFunc(gl.ONE, gl.ONE);
      setU(gl, this.P.flames, { CAMP, LOOK, R, FH: this.figH, SZ: 0.34 * scale, T: t });
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, hs.length);
    };
    // the projection works in frame px; a smaller target just scales the viewport
    dots(this.width, 1); flames(1);
    // 3. emission buffer (quarter res) -> bloom chain
    if (!ink && this.bloom > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.E1.fb); gl.viewport(0, 0, this.E1.w, this.E1.h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      dots(this.E1.w, 2.2); flames(1.6);
      gl.disable(gl.BLEND);
      const bl = (src, dst, d) => this._fs(this.P.blur, dst, { S: src.t, D: d });
      bl(this.E1, this.E1b, [1 / this.E1.w, 0]); bl(this.E1b, this.E1, [0, 1 / this.E1.h]);
      bl(this.E1, this.E2b, [2 / this.E1.w, 0]); bl(this.E2b, this.E2, [0, 2 / this.E2.h]);
      bl(this.E2, this.E2b, [2 / this.E2.w, 0]); bl(this.E2b, this.E2, [0, 2 / this.E2.h]);
    }
    gl.disable(gl.BLEND); this._resetAttrs();
    this._fs(this.P.comp, null, { S: this.S.t, B1: this.E1.t, B2: this.E2.t, BLOOM: ink ? 0 : this.bloom * (1 + strike), HAZE: this.haze, T: t, EXPO: this.exposure, INK: ink });
    return this.cv;
  }
}
// 8 torch-bearer silhouettes (4 stride phases + 4 standing variants), 64 x 160 each.
// r = silhouette, g = rim toward the raised torch (upper right), for the figure shader.
function figureAtlas() {
  const cw = 64, ch = 160, c = canvas(cw * 8, ch), g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  for (let k = 0; k < 8; k++) {
    g.save(); g.translate(k * cw + cw / 2, ch - 4);
    const walk = k < 4, ph = walk ? k / 4 * Math.PI * 2 : 0, sw = walk ? Math.sin(ph) : [0.15, -0.1, 0.05, -0.2][k - 4];
    const bob = walk ? Math.abs(Math.cos(ph)) * 3 : 0, lean = walk ? 0.05 : [0, 0.03, -0.02, 0.04][k - 4];
    const hip = [0, -58 - bob], sh = [hip[0] + lean * 40, hip[1] - 38];
    g.lineWidth = 8; // legs
    for (const s of [1, -1]) { const a = sw * 0.45 * s; g.beginPath(); g.moveTo(...hip); const kx = hip[0] + Math.sin(a) * 30, ky = hip[1] + Math.cos(a) * 30; g.lineTo(kx, ky); g.lineTo(kx + Math.sin(a - Math.max(0, -a) * 0.8) * 28, ky + 28); g.stroke(); }
    g.lineWidth = 15; g.beginPath(); g.moveTo(...hip); g.lineTo(...sh); g.stroke();                  // torso
    g.beginPath(); g.moveTo(hip[0] - 9, hip[1] + 6); g.lineTo(hip[0] + 9, hip[1] + 6); g.lineTo(sh[0] + 11, sh[1]); g.lineTo(sh[0] - 11, sh[1]); g.fill();   // coat
    g.beginPath(); g.arc(sh[0] + 1, sh[1] - 12, 8.5, 0, Math.PI * 2); g.fill();                        // head
    g.lineWidth = 6; g.beginPath(); g.moveTo(sh[0] + 5, sh[1] + 2); g.lineTo(sh[0] + 16, sh[1] - 16); g.lineTo(sh[0] + 18, sh[1] - 34); g.stroke();   // torch arm, raised
    g.lineWidth = 4; g.beginPath(); g.moveTo(sh[0] + 18, sh[1] - 26); g.lineTo(sh[0] + 20, sh[1] - 50); g.stroke();                                   // torch shaft
    g.lineWidth = 6; g.beginPath(); g.moveTo(sh[0] - 5, sh[1] + 2); g.lineTo(sh[0] - 9 - sw * 8, sh[1] + 22); g.lineTo(sh[0] - 7 - sw * 12, sh[1] + 40); g.stroke();   // free arm
    g.restore();
  }
  const id = g.getImageData(0, 0, c.width, c.height), d = id.data, a = new Uint8Array(c.width * c.height);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = y * c.width + x, s = a[i];
    const sx = Math.max(0, x - 3), sy = Math.min(c.height - 1, y + 3), sh = a[sy * c.width + sx];
    d[i * 4] = s; d[i * 4 + 1] = Math.max(0, s - sh); d[i * 4 + 2] = 0; d[i * 4 + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return c;
}
