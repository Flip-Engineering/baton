// INKWASH (MODELING studio, cycle 2): a model drawn the way Herge's studio drew from a maquette: build it, then DRAW it.
//
// Why: every look on the slate prints a luminance plan (a photograph through a press). The reference the client gave for ACP
// machines (videos/sources/acp_fortress.jpg) is a ligne-claire / gouache-wash illustration: an even pen line, flat local colour,
// a cool wash in the shade, pigment pooling at the edges of a wash, white paper left where the light is. No look in looks.js
// could print that, and a 3D model has what a drawing needs and a photograph does not: the part IDs, the creases and the true
// silhouette, from a real G-buffer pass (Benard & Hertzmann, "Line drawings from 3D models").
//
//   const ink = new InkWash(renderer, W, H, { paper: '#ece4d2', sky: ['#1d2a52', '#6f86b0'] });
//   ink.render(scene, camera, { t, light: dirLight })        // draws the finished drawing into renderer.domElement
//   ink.aux(scene, camera, { near, far, w: 540, h: 960 })    // a looks.js `aux` canvas (R,G 16-bit log depth, B class) from the same pass
//
// Scene conventions: materials are MeshLambertMaterial (colour = the LOCAL colour as painted, optional `map` for decals; alphaTest
// on a decal discards). Per mesh userData: pid (part id; edges are drawn where two ids meet; a decal takes its host's pid),
// cls ('ground' | 'far' | 'mid' | 'subject' | 'spot' for the aux), line: false (no ink on this mesh's own boundary: ground), glass: true
// (see-through pane: the model behind it is drawn first, the pane adds a pale wash and a glint).
// Colour management is off: values pass through as authored (display space).
import * as THREE from 'three';
THREE.ColorManagement.enabled = false;

const CLS = { ground: 0, far: 64, mid: 128, spot: 180, subject: 255 };
const VS = `
out vec3 vN; out vec2 vUv; out float vZ;
void main(){
  vec3 objN = normal;
  vN = normalize(normalMatrix * objN); vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.); vZ = -mv.z; gl_Position = projectionMatrix * mv;
}`;
const FS = `
precision highp float;
in vec3 vN; in vec2 vUv; in float vZ;
uniform vec3 ALB; uniform float PID; uniform float CLS; uniform float GLS; uniform float HASMAP; uniform sampler2D MAP; uniform float AT;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
void main(){
  vec4 m = HASMAP > .5 ? texture(MAP, vUv) : vec4(1.);
  if (HASMAP > .5 && m.a < AT) discard;
  vec3 n = normalize(vN); if(!gl_FrontFacing) n = -n;
  o0 = vec4(n, vZ); o1 = vec4(PID / 255., CLS / 255., GLS, 1.); o2 = vec4(ALB * (HASMAP > .5 ? m.rgb : vec3(1.)), 1.);
}`;

const CVS = `out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
const CFS = `
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D BEAU, GA0, GA1, GA2, GB0, GB1, GB2;
uniform vec2 PX; uniform float S;      // pixel size in uv, resolution scale (1 = 1080 wide)
uniform vec3 PAPER, INK, SKYT, SKYB, SHADE, WARM;
uniform float T, LINE, WASH, EDGEDARK, HATCH, HAZE, SKYLINE, TRANSP, LIGHTINK, BOIL;
uniform vec3 HAZEC;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*vn(p); p = p*2.03 + 7.1; a *= .5; } return s; }
float luma(vec3 c){ return dot(c, vec3(.299,.587,.114)); }
// one G-buffer set: line strength at uv for radius r (px). x = silhouette / depth break, y = crease, z = id edge
vec3 edges(sampler2D G0, sampler2D G1, vec2 uv, float r){
  vec4 c0 = texture(G0, uv); vec4 i0 = texture(G1, uv);
  vec3 e = vec3(0.);
  for (int k = 0; k < 4; k++) {
    float a = float(k) * .785398; vec2 d = vec2(cos(a), sin(a)) * r * PX;
    vec4 p = texture(G0, uv + d), q = texture(G0, uv - d); vec4 ip = texture(G1, uv + d), iq = texture(G1, uv - d);
    bool bp = p.w <= 0., bq = q.w <= 0.;
    if (bp != bq) { e.x = 1.; continue; }
    if (bp && bq) continue;
    float lap = abs(1. / p.w + 1. / q.w - 2. / c0.w) * c0.w;      // inverse depth is linear across a plane: only a real step or crease leaves a residual
    e.x = max(e.x, smoothstep(.010, .04, lap));
    e.y = max(e.y, smoothstep(.62, .35, dot(normalize(p.xyz), normalize(q.xyz))));
    if (abs(ip.x - iq.x) > .0007) e.z = 1.;
  }
  return e;
}
void main(){
  vec2 uv = vUv, px = uv / PX;
  vec4 a0 = texture(GA0, uv), a1 = texture(GA1, uv), a2 = texture(GA2, uv);
  vec4 b0 = texture(GB0, uv), b1 = texture(GB1, uv), b2 = texture(GB2, uv);
  vec2 bo = BOIL > 0. ? vec2(37.1, 11.9) * floor(T * BOIL) : vec2(0.);   // a hand-drawn look boils on twos: the pen and the grain re-roll, the paper does not
  float paperN = fbm(px * .9) , grain = vn(px * 1.7 + bo) , wob = fbm(px * .012 + 3.);
  vec3 paper = PAPER * (.965 + .05 * paperN + .03 * grain);
  // ---- colour: the nearest opaque surface (B pass = no glass), washed
  vec3 col; float depthB = b0.w;
  if (depthB <= 0.) {
    // the sky is a wash: a graded ultramarine, heavier at the top, with blooms and a hard dry edge
    float g = pow(clamp(uv.y, 0., 1.), .8);
    vec3 s = mix(SKYB, SKYT, g);
    float bl = fbm(px * .006 + vec2(1.7, 4.2)), bl2 = fbm(px * .02 + 9.);
    s *= .86 + .3 * bl + .08 * (bl2 - .5);
    s = mix(s, paper, smoothstep(.62, .82, bl2) * .22 * (1. - g));
    col = s;
  } else {
    float la = luma(b2.rgb); float sh = luma(texture(BEAU, uv).rgb) / max(la, .035);   // shading ratio 0..~1.2
    float idj = h21(vec2(b1.x * 255., 3.1));
    vec3 loc = b2.rgb;
    // local colour varies a little from panel to panel (each panel is a separate brush-load)
    loc *= 1. + (idj - .5) * .09 * WASH;
    // two-step wash: lit (paper shows through), half, shade (cool, a second layer)
    float s1 = smoothstep(.80, .66, sh + (fbm(px * .03) - .5) * .05);     // half
    float s2 = smoothstep(.54, .40, sh + (fbm(px * .05 + 5.) - .5) * .04);  // deep
    vec3 lit = loc * WARM;
    col = mix(lit, loc * mix(vec3(1.), SHADE, .5), s1);
    col = mix(col, loc * SHADE * mix(SHADE, vec3(1.), .35) * 1.1, s2);
    // the wash: low-frequency value variation, a darker pooled rim inside every wash edge, granulation
    float wv = fbm(px * .011 + b1.x * 40.) - .5;
    col *= 1. + wv * .22 * WASH;
    col = mix(col, paper * col * 1.12, .18 * (1. - s1) * smoothstep(.45, .8, fbm(px * .02 + 2.)));  // paper breathing through the light side
    col *= 1. - .09 * WASH * (grain - .5) * (.4 + s1 + s2);
    // shade edges pool pigment
    float ps = abs(smoothstep(.80, .66, sh) - smoothstep(.72, .6, luma(texture(BEAU, uv + PX * 3.).rgb) / max(la, .035)));
    col *= 1. - .16 * ps * EDGEDARK;
    // cross-hatch in the deepest shade (a few pen strokes, not a fill)
    float hx = fract((px.x + px.y) / (5. * S)); float hy = fract((px.x - px.y) / (7. * S));
    float hh = (step(.9, hx) * s2 + step(.93, hy) * s2 * smoothstep(.2, .6, vn(px * .08))) * HATCH * (.6 + .4 * vn(px * .4));
    col = mix(col, INK, clamp(hh, 0., 1.) * .5);
    // aerial perspective
    col = mix(col, HAZEC, clamp(HAZE * (1. - exp(-depthB * .004)), 0., .85));
  }
  // ---- glass: the panes are drawn over what is behind them: a pale wash and a glint
  float glassA = a1.z > .5 ? 1. : 0.;
  if (glassA > 0. && a0.w > 0.) {
    vec3 gtint = vec3(.62, .74, .78);
    float gl = smoothstep(.45, .5, fract((px.x * .6 - px.y * .8) / (60. * S) + .2)) * smoothstep(.2, .8, vn(px * .02)) * .7;
    col = mix(col, gtint, .34);
    col = mix(col, paper, gl * .28 * smoothstep(.0, .6, a0.z));
  }
  // ---- ink: even pen line; silhouette heavier than creases; the line breaks a little where the pen lifts
  vec3 eB = edges(GB0, GB1, uv, 1.25 * S * LINE), eBs = edges(GB0, GB1, uv, 1.9 * S * LINE);
  float sil = eBs.x;                                           // silhouette: heavier
  float inner = max(eB.y * .95, max(eB.z * .9, eB.x * .85));
  vec3 eA = edges(GA0, GA1, uv, 1.25 * S * LINE);
  float glassEdge = (glassA > 0. || texture(GA1, uv + PX * 2.).z > .5) ? max(eA.z, eA.x) * .7 : 0.;
  float line = max(sil, max(inner, glassEdge));
  // no ink where a mesh asks for none (ground planes), except against the sky
  float pen = smoothstep(.05, .5, .62 + .5 * fbm(px * .035 + 11. + bo) - .22 * (1. - line)) ;
  float wt = mix(.8, 1., smoothstep(.2, .7, fbm(px * .02 + 21.)));
  line *= pen * wt;
  // far lines lighten (a reduced pen for the distance)
  float dz = max(b0.w, 0.); line *= mix(1., .55, clamp(dz / 160., 0., 1.));
  vec3 inkc = LIGHTINK > .5 ? INK : mix(INK, col * .25, .35);                        // line colour: sepia-blue, taking a little of the wash under it
  vec3 outc = mix(col, inkc, clamp(line, 0., 1.) * .94);
  // a soft bloom of the pigment just outside the line (ink bleeding into damp paper)
  outc *= 1. - .05 * smoothstep(.0, 1., edges(GB0, GB1, uv, 3.2 * S).z + edges(GB0, GB1, uv, 3.2 * S).y) * WASH;
  float aOut = 1.;
  if (TRANSP > .5) aOut = (depthB <= 0. && a0.w <= 0.) ? clamp(line, 0., 1.) : 1.;
  fragColor = vec4(outc * aOut, aOut);
}`;

export class InkWash {
  constructor(renderer, W, H, o = {}) {
    this.r = renderer; this.W = W; this.H = H; this.S = W / 1080; this.o = o;
    const mk = () => new THREE.WebGLRenderTarget(W, H, { count: 3, type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    this.ga = mk(); this.gb = mk();
    this.beau = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
    const c = s => new THREE.Color(s);
    this.gmat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide,
      uniforms: { ALB: { value: new THREE.Color() }, PID: { value: 0 }, CLS: { value: 128 }, GLS: { value: 0 }, HASMAP: { value: 0 }, MAP: { value: null }, AT: { value: 0.5 } } });
    const P = o.paper || '#ece5d3', ink = o.ink || '#1b1a24';
    this.cmat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: CVS, fragmentShader: CFS, depthTest: false, depthWrite: false,
      uniforms: {
        BEAU: { value: this.beau.texture }, GA0: { value: this.ga.textures[0] }, GA1: { value: this.ga.textures[1] }, GA2: { value: this.ga.textures[2] },
        GB0: { value: this.gb.textures[0] }, GB1: { value: this.gb.textures[1] }, GB2: { value: this.gb.textures[2] },
        PX: { value: new THREE.Vector2(1 / W, 1 / H) }, S: { value: this.S }, T: { value: 0 },
        PAPER: { value: c(P) }, INK: { value: c(ink) }, SKYT: { value: c((o.sky || ['#1b2850', '#7b8fb8'])[0]) }, SKYB: { value: c((o.sky || ['#1b2850', '#7b8fb8'])[1]) },
        SHADE: { value: c(o.shade || '#8f94b8') }, WARM: { value: c(o.warm || '#fffaf0') }, HAZEC: { value: c(o.hazeColor || '#b9bfd4') },
        LINE: { value: o.line ?? 1 }, WASH: { value: o.wash ?? 1 }, EDGEDARK: { value: o.edgeDark ?? 1 }, HATCH: { value: o.hatch ?? 1 }, HAZE: { value: o.haze ?? 0.25 }, SKYLINE: { value: 0 }, TRANSP: { value: o.transparent ? 1 : 0 }, LIGHTINK: { value: o.lightInk ? 1 : 0 }, BOIL: { value: o.boil ?? 0 },
      } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.cmat); this.quad.frustumCulled = false;
    this.qs = new THREE.Scene(); this.qs.add(this.quad); this.qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const U = this.gmat.uniforms, mat = this.gmat;
    this._before = function () {
      const d = this.userData, m = this.material, col = m.color || new THREE.Color(1, 1, 1);
      U.ALB.value.copy(col); U.PID.value = d.pid ?? 1; U.CLS.value = CLS[d.cls] ?? 128; U.GLS.value = d.glass ? 1 : 0;
      U.HASMAP.value = m.map ? 1 : 0; U.MAP.value = m.map || null; U.AT.value = m.alphaTest || 0.5; mat.uniformsNeedUpdate = true;
    };
  }
  _gpass(rt, scene, camera, hideGlass) {
    const r = this.r, hooks = [], hidden = [];
    scene.traverse(o => {
      if (o.userData.gbuffer === false && o.visible) { o.visible = false; hidden.push(o); }
      else if (hideGlass && o.userData.glass && o.visible) { o.visible = false; hidden.push(o); }
      if (o.isMesh) { hooks.push([o, o.onBeforeRender]); o.onBeforeRender = this._before; }
    });
    const bg = scene.background, om = scene.overrideMaterial, sm = r.shadowMap.autoUpdate, fog = scene.fog;
    scene.background = null; scene.fog = null; scene.overrideMaterial = this.gmat; r.shadowMap.autoUpdate = false;
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(scene, camera);
    scene.background = bg; scene.fog = fog; scene.overrideMaterial = om; r.shadowMap.autoUpdate = sm;
    for (const o of hidden) o.visible = true;
    for (const [o, f] of hooks) o.onBeforeRender = f;
  }
  render(scene, camera, { target = null, t = 0 } = {}) {
    const r = this.r; THREE.ColorManagement.enabled = false;
    r.outputColorSpace = THREE.LinearSRGBColorSpace; r.toneMapping = THREE.NoToneMapping;
    // beauty: the lit scene, opaque only (glass hidden), no sky
    const hid = []; scene.traverse(o => { if ((o.userData.glass || o.userData.gbuffer === false) && o.visible) { o.visible = false; hid.push(o); } });
    const bg = scene.background; scene.background = null;
    r.setRenderTarget(this.beau); r.setClearColor(0x000000, 0); r.clear(); r.render(scene, camera);
    scene.background = bg; for (const o of hid) o.visible = true;
    this._gpass(this.gb, scene, camera, true);
    this._gpass(this.ga, scene, camera, false);
    this.cmat.uniforms.T.value = t;
    r.setRenderTarget(target); r.setClearColor(this.o.transparent ? 0x000000 : 0xffffff, this.o.transparent ? 0 : 1); r.clear(); r.render(this.qs, this.qc);
    r.setRenderTarget(null);
  }
  // aux for looks.js (R,G = 16-bit log view depth, 65535 = sky; B = class) from the SAME pass, at w x h
  aux(scene, camera, { near = 1, far = 400, w = 540, h = 960 } = {}) {
    const r = this.r, gl = r.getContext(); this._gpass(this.ga, scene, camera, false);
    const n = this.W * this.H * 4, nd = this._nd || (this._nd = new Float32Array(n)), idc = this._ic || (this._ic = new Float32Array(n));
    const fb = r.properties.get(this.ga).__webglFramebuffer; gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, this.W, this.H, gl.RGBA, gl.FLOAT, nd);
    gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.readPixels(0, 0, this.W, this.H, gl.RGBA, gl.FLOAT, idc);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); r.setRenderTarget(null); r.resetState();
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'), im = g.createImageData(w, h), D = im.data, lnr = Math.log(far / near);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = Math.min(this.W - 1, Math.floor((x + .5) * this.W / w)), sy = Math.min(this.H - 1, Math.floor((h - 1 - y + .5) * this.H / h)), i = (sy * this.W + sx) * 4, z = nd[i + 3], o = (y * w + x) * 4;
      const l = z > 0 ? Math.round(Math.min(1, Math.max(0, Math.log(z / near) / lnr)) * 65534) : 65535;
      D[o] = l >> 8; D[o + 1] = l & 255; D[o + 2] = z > 0 ? Math.round(idc[i + 1] * 255) : 0; D[o + 3] = 255;
    }
    g.putImageData(im, 0, 0); return cv;
  }
}
