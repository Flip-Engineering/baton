// REPRO: reprographic presses that print.js and post.js do not have. WebGL2, stateless in t.
//
//   import { Repro } from '../lib/fx/repro.js';
//   const rp = new Repro(1080, 1920);
//   rp.toner(src, t, { gen: 3 });            // photocopier (POLITICAL ECONOMY's medium: VISUAL_BIBLE §1.2 'toner')
//   rp.gravure(src, t, { ink: 'sepia' });    // rotogravure (the 1930s photo-magazine: USSR in Construction, AIZ)
//   rp.silkscreen(src, t, { inks: ['#e9dcc4', '#c3161c', '#17130f'] });   // WPA flat-ink screen print
//   rp.threestrip(src, t, { reg, plates });  // Technicolor dye transfer, plate by plate (ORE TO ORBIT)
//   rp.duotone(src, t, { reg, pres, cell });  // a two-plate halftone (black key + red) with each plate's own registration (NEVER VANQUISHED)
//   rp.draw(ctx)                             // or use rp.canvas directly
//
// src: any image / canvas / video frame (uploaded once per call; pass the same canvas each frame). Every call renders
// the whole frame; 'onto' is not needed because these are finishing media (they replace the picture).
//
// toner {gen 1-4, contrast, dark, edge (xerographic edge effect: solids go hollow, edges stay dense), grain (toner
//   particle size px), speckle, streaks (drum lines), band (horizontal banding), skew (rad per generation), lid (the
//   black border where the lid was open: [l, t, r, b] px or 0), ink, paper, boil (fps of toner shimmer; 0 = frozen)}.
//   Each generation re-images the last one: a slight misplacement + scale, a blur, the tone curve and a new toner
//   threshold, so detail coarsens and midtones break into speckle, the way a copy of a copy does.
// gravure {cell (px), ink, paper, angle (deg), depth, sharp}: constant-size cells, ink depth by tone, cell walls
//   visible in the solids, the sawtooth edge on type and contours that only gravure has.
// silkscreen {inks [paper, light, mid, dark], cuts [3 thresholds], soft (px smoothing = hand-cut stencil), misreg
//   (px per layer), mesh (thread px), squeegee}: tone plates cut from a smoothed luma, printed opaque, lightest first.
const hex = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); };
const INK = { black: '#16130f', toner: '#141312', sepia: '#3b2416', green: '#1f2a22', red: '#b8141b', acp: '#BD1818', cream: '#f4e6d0', paper: '#eeebe3', photo: '#f3efe6' };
const ink = c => hex(INK[c] || c);

const VS = `#version 300 es
out vec2 v; void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); v = p; gl_Position = vec4(p * 2. - 1., 0., 1.); }`;
const HEAD = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform vec2 uRes; uniform float uT, uSeed;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ return vn(p) * .5 + vn(p * 2.03 + 7.1) * .3 + vn(p * 4.1 + 3.3) * .2; }
const vec3 LW = vec3(.2126, .7152, .0722);
`;
// y is flipped on upload (UNPACK_FLIP_Y) so v = (0,0) is the bottom-left in every texture; px is top-down.
const FS_LUMA = HEAD + `
uniform sampler2D uS; uniform vec3 uLev;
void main(){ float l = dot(texture(uS, v).rgb, LW); l = clamp((l - uLev.x) / (uLev.y - uLev.x), 0., 1.); o = vec4(pow(l, uLev.z), 0., 0., 1.); }`;

// one toner generation: reads the previous generation (a luma texture, 1 = paper), writes the new copy's luma
const FS_TONER = HEAD + `
uniform sampler2D uS; uniform float uGen, uContrast, uDark, uEdge, uGrain, uSpeck, uStreak, uBand, uSkew, uLast;
uniform vec4 uLid; uniform vec2 uShift;
void main(){
  vec2 px = vec2(v.x, 1. - v.y) * uRes;                  // top-down px
  // the sheet lies on the glass a little off: rotate about the centre, shift, scale
  vec2 c = px - uRes * .5; float a = uSkew; c = mat2(cos(a), sin(a), -sin(a), cos(a)) * c * (1. + .004 * uGen) + uShift;
  vec2 q = c + uRes * .5; vec2 uv = vec2(q.x, uRes.y - q.y) / uRes;
  float off = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
  float L = mix(1., texture(uS, uv).r, off);
  float Lb = mix(1., textureLod(uS, uv, 1.2 + .4 * uGen).r, off);              // optics blur
  float Lwide = mix(1., textureLod(uS, uv, 5.5).r, off);                      // the neighbourhood (fringing field)
  float D = 1. - mix(L, Lb, .55);                                              // toner density wanted
  // xerographic edge effect: a big solid develops weakly in its middle, strongly at its rim
  float solid = 1. - Lwide;
  D = D * (1. - uEdge * .55 * smoothstep(.35, .95, solid)) + uEdge * .9 * max(0., (1. - Lb) - solid);
  D = clamp((D - .5) * uContrast + .5 + uDark, 0., 1.);
  // toner particles: threshold against particle-sized noise, so midtones break into speckle
  vec2 gp = px / uGrain + uSeed * 17.;
  float n = vn(gp) * .6 + h12(floor(px) + uSeed) * .4;
  float ink = smoothstep(n - .12, n + .12, D);
  // background toner: specks, drum streaks, banding
  float sp = step(1. - uSpeck * .0025, h12(floor(px / 2.) + uSeed * 3.1)) * step(.5, vn(px * .01 + uSeed));
  float sk = smoothstep(.994, 1., h12(vec2(floor(px.x / 1.5), uSeed))) * uStreak * (.4 + .6 * vn(vec2(px.x * .05, px.y * .004)));
  float bd = uBand * (vn(vec2(0., px.y * .006 + uSeed)) - .5);
  ink = clamp(ink + sp * .9 + sk + bd * .5, 0., 1.);
  // lid open: toner everywhere outside the sheet, feathered
  if (uLast > .5) { vec4 e = vec4(px.x, px.y, uRes.x - px.x, uRes.y - px.y) - uLid;
    float lid = 1. - smoothstep(-2., 6., min(min(e.x, e.y), min(e.z, e.w)) + (vn(px * .08) - .5) * 10.);
    ink = max(ink, lid * step(.5, dot(uLid, vec4(1)))); }
  o = vec4(1. - ink, 0., 0., 1.);
}`;
const FS_TONER_OUT = HEAD + `
uniform sampler2D uS; uniform vec3 uInk, uPaper;
void main(){ vec2 px = vec2(v.x, 1. - v.y) * uRes;
  float L = texture(uS, v).r;
  vec3 paper = uPaper * (.97 + .05 * fbm(px * .02)) * (1. - .04 * smoothstep(.3, 1., length(v - .5) * 1.4));
  // toner sits on the paper with a faint sheen and a little spread
  vec3 c = mix(uInk, paper, L);
  o = vec4(c, 1.); }`;

const FS_GRAVURE = HEAD + `
uniform sampler2D uS; uniform vec3 uInk, uPaper, uLev; uniform float uCell, uAng, uDepth, uSharp;
float lum(vec2 uv){ float l = dot(texture(uS, uv).rgb, LW); l = clamp((l - uLev.x) / (uLev.y - uLev.x), 0., 1.); return pow(l, uLev.z); }
void main(){
  vec2 px = vec2(v.x, 1. - v.y) * uRes;
  float c = cos(uAng), s = sin(uAng); mat2 R = mat2(c, s, -s, c);
  vec2 q = R * px / uCell, id = floor(q), f = fract(q);
  // the cylinder's cell samples the image at its centre: that sampling is what saws the edges
  vec2 cpx = transpose(R) * ((id + .5) * uCell); vec2 cuv = vec2(cpx.x, uRes.y - cpx.y) / uRes;
  float dens = 1. - mix(lum(cuv), lum(v), uSharp);
  // cell walls (unetched copper) stay as thin light lines in the solids; ink fills the cell and spreads a little
  float wall = .09 + .05 * (1. - dens), aw = max(fwidth(q.x), 1e-3) * .8;
  vec2 b = smoothstep(vec2(wall - aw), vec2(wall + aw), f) * smoothstep(vec2(wall - aw), vec2(wall + aw), 1. - f);
  float inkv = dens * uDepth * mix(mix(.5, .97, smoothstep(.45, .95, dens)), 1., b.x * b.y);   // ink floods the walls in the solids
  inkv *= .92 + .16 * (h12(id + uSeed) - .5) + .06 * (vn(px * .6) - .5);
  vec3 paper = uPaper * (.97 + .05 * fbm(px * .015));
  o = vec4(paper * mix(vec3(1), uInk, clamp(inkv, 0., 1.)), 1.);
}`;

// three-strip (7 Oct): Technicolor's dye transfer. The frame is separated into its three dye plates (cyan prints the red record, magenta the green,
// yellow the blue); each plate has its own registration offset (px) and presence (0 = not yet printed: that record stays paper-white), so a
// picture can arrive plate by plate and snap into register on a hit. A dye curve (the imbibition print's toe and shoulder) and a soft grain.
const FS_THREE = HEAD + `
uniform sampler2D uS; uniform vec2 uOC, uOM, uOY; uniform vec3 uPres; uniform float uSat, uCurve, uGrain;
float rec(vec2 off, int ch){ vec2 uv = v + vec2(off.x, -off.y) / uRes; vec3 c = texture(uS, uv).rgb;
  float inb = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.); return mix(1., ch == 0 ? c.r : ch == 1 ? c.g : c.b, inb); }
void main(){
  vec3 c = vec3(rec(uOC, 0), rec(uOM, 1), rec(uOY, 2));
  float l = dot(c, LW); c = clamp(mix(vec3(l), c, uSat), 0., 1.);
  c = mix(c, c * c * (3. - 2. * c), uCurve);                                   // the dye's toe and shoulder
  c = mix(vec3(1.), c, uPres);                                                  // a plate not yet printed leaves its record white
  vec2 px = vec2(v.x, 1. - v.y) * uRes;
  c *= 1. + uGrain * (h12(floor(px * .7) + uSeed) - .5) * .12;
  o = vec4(clamp(c, 0., 1.), 1.);
}`;

const FS_BLUR = HEAD + `
uniform sampler2D uS; uniform vec2 uDir;
void main(){ vec4 a = texture(uS, v) * .227;
  for (int i = 1; i < 5; i++) { float w = i == 1 ? .1945 : i == 2 ? .1216 : i == 3 ? .054 : .0162; vec2 d = uDir * float(i) / uRes;
    a += (texture(uS, v + d) + texture(uS, v - d)) * w; }
  o = a; }`;
const FS_SILK = HEAD + `
uniform sampler2D uS; uniform vec3 uI0, uI1, uI2, uI3, uCut, uLev; uniform float uSoft, uMesh, uSqueegee; uniform vec2 uM1, uM2, uM3;
uniform sampler2D uB;
float lum(vec2 uv, float lod){ float l = dot(texture(uB, uv).rgb, LW); l = clamp((l - uLev.x) / (uLev.y - uLev.x), 0., 1.); return pow(l, uLev.z); }
float plate(vec2 px, vec2 mis, float cut){
  vec2 q = px - mis; vec2 uv = vec2(q.x, uRes.y - q.y) / uRes;
  float L = lum(uv, uSoft);
  // the mesh: at an edge the stencil breaks along threads (a stepped, woven edge)
  vec2 m = abs(fract(q / uMesh) - .5);
  float thread = (max(m.x, m.y) - .25) * .04;
  float w = fwidth(L) * .8 + .004;
  return smoothstep(cut + w, cut - w, L + thread);
}
void main(){
  vec2 px = vec2(v.x, 1. - v.y) * uRes;
  float p1 = plate(px, uM1, uCut.x), p2 = plate(px, uM2, uCut.y), p3 = plate(px, uM3, uCut.z);
  // squeegee: coverage falls off in streaks along the pull; the ink film shows the mesh as a faint grid
  float sq = 1. - uSqueegee * smoothstep(.65, 1., vn(vec2(px.x * .09, px.y * .003) + uSeed)) * .22;   // streaks along the pull (vertical)
  vec2 m = abs(fract(px / uMesh) - .5); float grid = .96 + .04 * smoothstep(.35, .5, max(m.x, m.y));
  vec3 c = uI0 * (.97 + .05 * fbm(px * .015));
  c = mix(c, uI1 * grid, p1 * sq);
  c = mix(c, uI2 * grid, p2 * sq);
  c = mix(c, uI3 * grid, p3 * min(1., sq + .2));
  // ink ridge: a slightly darker lip at each plate's edge
  o = vec4(c, 1.);
}`;

// duotone (8 Oct): the two-colour halftone of the letterpress weekly. A key plate (black) carries the shadows, a second plate (red) the whole
// tonal range at less density; each is screened at its own angle (45 and 75 degrees) and printed with its own registration offset (px), so a
// picture can drift out of register and come back into it. cell 0 prints continuous tone. blur (mip bias) softens the source (the chloroform).
const FS_DUO = HEAD + `
uniform sampler2D uS; uniform vec2 uOA, uOB, uPres; uniform vec3 uIA, uIB, uPaper; uniform vec4 uCA, uCB; uniform float uCell, uGrain, uBlur;
float lum(vec2 px){ vec2 uv = vec2(px.x, uRes.y - px.y) / uRes; float inb = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
  return mix(1., dot(texture(uS, uv, uBlur).rgb, LW), inb); }
float dens(vec2 p, vec4 c){ return smoothstep(c.x, c.y, 1. - lum(p)) * c.z; }
float plate(vec2 px, vec2 off, vec4 c){
  if (uCell < 1.) return dens(px - off, c);
  float cs = cos(c.w), sn = sin(c.w); mat2 R = mat2(cs, sn, -sn, cs);
  vec2 q = R * (px - off) / uCell, id = floor(q), f = fract(q) - .5;
  float d = dens(transpose(R) * ((id + .5) * uCell), c), r = sqrt(d) * .74, aw = max(fwidth(q.x), 1e-3) * .9;
  return (1. - smoothstep(r - aw, r + aw, length(f))) * clamp(r / aw, 0., 1.);   // no dot where there is no ink (else a lattice over the whites)
}
void main(){
  vec2 px = vec2(v.x, 1. - v.y) * uRes;
  float a = plate(px, uOA, uCA) * uPres.x, b = plate(px, uOB, uCB) * uPres.y;
  vec3 c = uPaper * mix(vec3(1), uIB, b) * mix(vec3(1), uIA, a);
  c *= 1. + uGrain * (h12(floor(px * .7) + uSeed) - .5) * .1;
  o = vec4(clamp(c, 0., 1.), 1.);
}`;

function compile(gl, fs) {
  const mk = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}

export class Repro {
  constructor(W = 1080, H = 1920, { canvas = null } = {}) {
    this.W = W; this.H = H;
    this.canvas = canvas || Object.assign(document.createElement('canvas'), { width: W, height: H });
    const gl = this.gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false });
    this.vao = gl.createVertexArray(); this.P = {}; this.T = {};
    this.src = this._tex(W, H, true);
    this.stats = {};
  }
  _p(name, fs) { return this.P[name] ||= compile(this.gl, fs); }
  _tex(w, h, mip = false) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  _target(name) {
    if (this.T[name]) return this.T[name];
    const gl = this.gl, tex = this._tex(this.W, this.H, true), fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return (this.T[name] = { tex, fb });
  }
  _upload(src) {
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const w = src.naturalWidth || src.videoWidth || src.width, h = src.naturalHeight || src.videoHeight || src.height;
    if (w === this.W && h === this.H) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }
  _run(P, target, uni, texs = []) {
    const gl = this.gl; gl.useProgram(P.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null); gl.viewport(0, 0, this.W, this.H);
    texs.forEach((t, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); });
    gl.uniform2f(P.u.uRes, this.W, this.H);
    for (const k in uni) { const loc = P.u[k], val = uni[k]; if (!loc) continue;
      if (typeof val === 'number') gl.uniform1f(loc, val); else if (val.length === 2) gl.uniform2fv(loc, val); else if (val.length === 3) gl.uniform3fv(loc, val); else gl.uniform4fv(loc, val); }
    if (P.u.uS) gl.uniform1i(P.u.uS, 0); if (P.u.uB) gl.uniform1i(P.u.uB, 1);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (target) { gl.bindTexture(gl.TEXTURE_2D, target.tex); gl.generateMipmap(gl.TEXTURE_2D); }
  }
  _seed(t, boil) { return boil ? Math.floor(t * boil + 1e-6) % 97 + 1 : 1; }

  toner(src, t = 0, o = {}) {
    const t0 = performance.now(); this._upload(src);
    const gen = Math.max(1, Math.min(4, o.gen ?? 2)), seed = this._seed(t, o.boil ?? 8);
    const lev = o.levels || [0.03, 0.97, 1];
    this._run(this._p('luma', FS_LUMA), this._target('a'), { uLev: lev }, [this.src]);
    let a = this._target('a'), b = this._target('b');
    const lid = o.lid === 0 ? [0, 0, 0, 0] : (o.lid || [26, 34, 22, 40]);
    for (let g = 0; g < gen; g++) {
      const last = g === gen - 1 ? 1 : 0;
      this._run(this._p('toner', FS_TONER), b, {
        uGen: g + 1, uContrast: o.contrast ?? 1.9, uDark: o.dark ?? 0.02, uEdge: o.edge ?? 0.7, uGrain: o.grain ?? 1.6,
        uSpeck: (o.speckle ?? 1) * (0.5 + g * 0.35), uStreak: o.streaks ?? 0.35, uBand: o.band ?? 0.25,
        uSkew: (o.skew ?? 0.0025) * (g % 2 ? -1 : 1), uShift: [(g * 7.3) % 5 - 2, (g * 5.1) % 4 - 1.5], uLid: lid, uLast: last,
        uSeed: seed * 13 + g * 101, uT: t }, [a.tex]);
      [a, b] = [b, a];
    }
    this._run(this._p('tonerOut', FS_TONER_OUT), null, { uInk: ink(o.ink || 'toner'), uPaper: ink(o.paper || 'paper'), uSeed: seed }, [a.tex]);
    this.stats = { ms: performance.now() - t0, passes: gen + 2 };
    return this;
  }
  gravure(src, t = 0, o = {}) {
    const t0 = performance.now(); this._upload(src);
    this._run(this._p('gravure', FS_GRAVURE), null, {
      uInk: ink(o.ink || 'sepia'), uPaper: ink(o.paper || 'photo'), uLev: o.levels || [0.02, 0.98, 1], uCell: Math.max(6, o.cell ?? 7),
      uAng: (o.angle ?? 45) * Math.PI / 180, uDepth: o.depth ?? 1.05, uSharp: o.sharp ?? 0.25, uSeed: this._seed(t, o.boil ?? 0) }, [this.src]);
    this.stats = { ms: performance.now() - t0, passes: 1 };
    return this;
  }
  // separable 9-tap gaussian of the uploaded source into target 'blur' (radius ~ r px)
  _blur(r) {
    const P = this._p('blur', FS_BLUR), a = this._target('b1'), b = this._target('blur');
    this._run(P, a, { uDir: [r / 4, 0] }, [this.src]); this._run(P, b, { uDir: [0, r / 4] }, [a.tex]);
    return b.tex;
  }
  silkscreen(src, t = 0, o = {}) {
    const t0 = performance.now(); this._upload(src); const bt = this._blur(o.soft ?? 5);
    const I = (o.inks || ['#e9dcc4', '#c3161c', '#6a1512', '#17130f']).map(ink), mr = o.misreg ?? 3, seed = this._seed(t, o.boil ?? 0);
    const j = k => [Math.sin(seed * 3.1 + k * 2.3) * mr, Math.cos(seed * 1.7 + k * 1.9) * mr];
    this._run(this._p('silk', FS_SILK), null, {
      uI0: I[0], uI1: I[1], uI2: I[2], uI3: I[3], uCut: o.cuts || [0.72, 0.45, 0.22], uLev: o.levels || [0.02, 0.98, 1],
      uMesh: o.mesh ?? 3.2, uSqueegee: o.squeegee ?? 0.5, uM1: j(1), uM2: j(2), uM3: j(3), uSeed: seed }, [this.src, bt]);
    this.stats = { ms: performance.now() - t0, passes: 1 };
    return this;
  }
  // threestrip {reg: [[dx,dy] cyan, [dx,dy] magenta, [dx,dy] yellow] (px), plates: [c, m, y] presence 0..1, sat, curve, grain, boil}
  threestrip(src, t = 0, o = {}) {
    const t0 = performance.now(); this._upload(src); const r = o.reg || [[0, 0], [0, 0], [0, 0]];
    this._run(this._p('three', FS_THREE), null, { uOC: r[0], uOM: r[1], uOY: r[2], uPres: o.plates || [1, 1, 1], uSat: o.sat ?? 1.15, uCurve: o.curve ?? 0.35,
      uGrain: o.grain ?? 0.6, uSeed: this._seed(t, o.boil ?? 12) }, [this.src]);
    this.stats = { ms: performance.now() - t0, passes: 1 };
    return this;
  }
  // duotone {reg: [[dx,dy] key, [dx,dy] second] (px), pres: [key, second] 0..1, inks: [key, second], paper, curves: [[lo, hi, depth], ...],
  //   cell (px; 0 = continuous), angles (deg), blur (mip bias), grain, boil}. Paper defaults to white, so the result can be multiplied onto a sheet.
  duotone(src, t = 0, o = {}) {
    const t0 = performance.now(); this._upload(src); const r = o.reg || [[0, 0], [0, 0]], I = o.inks || ['black', 'acp'], C = o.curves || [[0.38, 0.95, 1], [0.04, 0.82, 0.88]];
    const A = (o.angles || [45, 75]).map(a => a * Math.PI / 180);
    this._run(this._p('duo', FS_DUO), null, { uOA: r[0], uOB: r[1], uPres: o.pres || [1, 1], uIA: ink(I[0]), uIB: ink(I[1]), uPaper: ink(o.paper || '#ffffff'),
      uCA: [...C[0], A[0]], uCB: [...C[1], A[1]], uCell: o.cell ?? 7, uGrain: o.grain ?? 0.5, uBlur: o.blur ?? 0, uSeed: this._seed(t, o.boil ?? 12) }, [this.src]);
    this.stats = { ms: performance.now() - t0, passes: 1 };
    return this;
  }
  draw(ctx) { ctx.drawImage(this.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height); return this; }
}
