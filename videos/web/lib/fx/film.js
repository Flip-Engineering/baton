// FILM: a newsreel print emulation for THE IRON IS HOT (VISUAL_BIBLE §1.7: film.js, this piece only).
//
//   import { Film } from '../lib/fx/film.js';
//   const film = new Film(1080, 1920);
//   film.apply(sceneCanvas, overlayCanvas, frame, { colour: 0, burn: 0, iris: 1, ... });   // draws into film.canvas
//   ctx.drawImage(film.canvas, 0, 0);
//
// One WebGL2 pass over a mipmapped copy of the scene (any size; it is scaled to fit) plus a full-size
// overlay (supers, drawn with straight alpha), in this order:
//   gate weave + frame-line roll -> the burn front (UV melt, bubbling cells, char, orange edge) ->
//   Gary | mirror split -> silver-sepia gradient map or colour -> halation (red-orange even in sepia) and
//   bloom from the mip chain -> density flicker bands -> grain at three scales by luma -> long-lived
//   scratches, dust, a gate hair -> iris.
// Every input is a pure function of the frame, so a still renders the same as the movie.

const VS = `#version 300 es
out vec2 v;
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); v = p; gl_Position = vec4(p * 2. - 1., 0., 1.); }`;

const FS = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D S, T;
uniform vec2 res, weave, burnC;
uniform float frame, colour, burn, iris, roll, flick, grain, dust, scratch, hal, bloom, expo, mirror, split, sepiaHot, contrast, vig, leak;
uniform vec3 s0, s1, s2, s3;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ return vn(p) * .5 + vn(p * 2.03 + 7.1) * .25 + vn(p * 4.1 + 3.3) * .125 + vn(p * 8.3 + 1.7) * .0625; }
float luma(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
vec2 vor(vec2 p){ vec2 i = floor(p), f = fract(p); float d1 = 9., d2 = 9.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(x, y), q = g + h22(i + g) - f; float d = dot(q, q);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return vec2(sqrt(d1), sqrt(d2)); }
vec3 sepia(float l){
  l = clamp(l, 0., 1.);
  vec3 c = l < .33 ? mix(s0, s1, l / .33) : l < .7 ? mix(s1, s2, (l - .33) / .37) : mix(s2, s3, (l - .7) / .3);
  return c;
}
vec3 scene(vec2 uv){ return texture(S, uv).rgb; }
void main(){
  float asp = res.x / res.y;
  vec2 uv = v;
  uv.y = 1. - uv.y;                                   // canvas space: y down
  uv += weave;
  vec4 sup = texture(T, uv);                          // supers ride the gate weave but not the melt
  // frame-line roll on cuts: the picture slips and the black frame bar shows
  float barMask = 0.;
  if (roll > 0.) { float y = uv.y + roll; barMask = smoothstep(.0, .006, abs(fract(y) - .0) ) ; barMask = 1. - smoothstep(0., .035, min(fract(y), 1. - fract(y))); uv.y = fract(y); }
  // ---- the burn: a noisy front grows from the hot spot
  float e = -1.; vec2 cellId = vec2(0);
  if (burn > 0.) {
    vec2 q = (uv - burnC) * vec2(asp, 1.);
    float n = fbm(uv * vec2(6., 3.4) + 2.) - .5;
    e = burn - length(q) + n * .35 + (fbm(uv * 23.) - .5) * .06;
    vec2 dir = normalize(q + 1e-4);
    float melt = smoothstep(-.18, 0., e) * (1. - smoothstep(0., .02, e));
    vec2 vc = vor(uv * vec2(34., 34. / asp));
    uv -= dir * melt * (.045 + .03 * vc.x) * vec2(1. / asp, 1.);   // the emulsion slides toward the hole
    uv.y += melt * melt * .03;
  }
  vec2 suv = uv;
  if (mirror > 0.5 && suv.x > split) suv.x = 2. * split - suv.x;            // Gary | mirror
  vec3 src = scene(suv);
  vec3 lin = src * src;
  // ---- glows from the mip chain (halation is added after the grade, so it stays red-orange in sepia)
  vec3 g1 = textureLod(S, suv, 3.5).rgb, g2 = textureLod(S, suv, 5.).rgb, g3 = textureLod(S, suv, 6.5).rgb;
  vec3 gl = g1 * .5 + g2 * .35 + g3 * .25;
  vec3 hot = max(gl * gl - .28, 0.) * 1.6;
  float hotL = luma(hot);
  // ---- grade
  float l = sqrt(luma(lin) * exp2(expo));
  l = clamp(l + contrast * (l * l * (3. - 2. * l) - l), 0., 1.);
  vec3 sep = sepia(l);
  sep = mix(sep, sep * vec3(1.08, .93, .78) + vec3(.05, .01, 0.) , sepiaHot * smoothstep(.55, 1., luma(src)));   // the pour burns a little warm through the silver
  vec3 col = clamp(sqrt(lin * exp2(expo)), 0., 1.);
  col = clamp(col + contrast * .6 * (col * col * (3. - 2. * col) - col), 0., 1.);
  col = mix(vec3(luma(col)), col, 1.12);
  // the blue arc leaking into the sepia (the future, before STRIKE)
  float blue = clamp((src.b - max(src.r, src.g) * .92) * 3., 0., 1.) * leak;
  float cm = colour;
  if (burn > 0.) cm = max(cm, smoothstep(.05, .09, e));
  vec3 c = mix(sep, col, cm);
  c = mix(c, col * vec3(.85, 1., 1.25) + .08, blue);
  // density flicker: soft horizontal bands drifting through the print
  float band = vn(vec2(uv.y * 3.1 + frame * .41, frame * .77)) - .5;
  c *= flick * (1. + band * .06 * (1. - cm * .7));
  c += hot * hal * mix(vec3(1., .42, .14), vec3(1., .5, .2), cm) * (1. - .5 * cm) + hot * bloom * mix(vec3(1., .92, .8), vec3(.85, .95, 1.1), cm);
  // ---- the burn front: bubbling cells ahead of it, char, a white-orange edge, colour behind
  if (burn > 0.) {
    vec2 vc = vor(uv * vec2(34., 34. / asp));
    float bub = smoothstep(-.12, 0., e) * (1. - smoothstep(0., .01, e));
    c = mix(c, c * (.35 + .65 * smoothstep(.0, .35, vc.y - vc.x)) + vec3(.25, .08, 0.) * (1. - vc.x) * bub, bub * .8);
    float edge = exp(-abs(e - .012) * 110.);
    float charB = smoothstep(.0, .015, e) * (1. - smoothstep(.04, .075, e));
    c = mix(c, vec3(.03, .015, .01) + vec3(.4, .1, 0.) * (1. - vc.x) * .5, charB * .92);
    c += vec3(1., .55, .18) * edge * 1.4 + vec3(1., .9, .7) * exp(-abs(e - .012) * 300.) * .8;
  }
  { float sl = sqrt(luma(sup.rgb * sup.rgb)); vec3 st = mix(sepia(clamp(sl * 1.02, 0., 1.)), sup.rgb, cm); c = mix(c, st, sup.a); }
  // ---- grain: three scales, strongest in the midtones, stronger on the silver print
  vec2 px = v * res;
  float fk = mod(frame, 997.);
  float gA = vn(px / 1.3 + fk * vec2(37.1, 91.7)) - .5, gB = vn(px / 3.1 + fk * vec2(13.7, 71.3)) - .5, gC = vn(px / 9. + fk * vec2(5.3, 17.9)) - .5;
  float lg = luma(c);
  c += (gA * .55 + gB * .35 + gC * .2) * grain * (.3 + 1.6 * lg * (1. - lg)) * mix(1., .45, cm);
  // ---- scratches that live for ~1.5 s, dust that lives one frame, a gate hair that lives a few seconds
  if (scratch > 0.) {
    for (int k = 0; k < 3; k++) {
      float seg = floor((fk + float(k) * 17.) / 45.);
      if (h12(vec2(seg, float(k) + 3.)) > scratch) continue;
      float x = h12(vec2(seg, float(k))) * res.x + sin(px.y * .004 + seg) * 8. + (fk - seg * 45.) * (h12(vec2(seg, 9. + float(k))) - .5) * 1.5;
      float w = 1. + 1.5 * h12(vec2(seg, float(k) + 5.));
      float s = smoothstep(w, 0., abs(px.x - x)) * (.55 + .45 * vn(vec2(px.y * .02, seg)));
      c = mix(c, k == 1 ? vec3(.05, .04, .03) : vec3(.95, .92, .85), s * .6 * (1. - cm * .8));
    }
  }
  if (dust > 0.) {
    vec2 cell = floor(px / 70.); vec2 f = px / 70. - cell;
    float r = h12(cell + fk * 13.1);
    if (r < dust * .05) { vec2 pp = h22(cell + fk); float d = length((f - pp) * vec2(1., .5 + r * 9.)); c = mix(c, vec3(r < dust * .015 ? .92 : .03), smoothstep(.08 * (.5 + r * 12.), .01, d) * (1. - cm * .6)); }
    float hs = floor(fk / 70.);
    if (h12(vec2(hs, 4.)) < dust * .8) {                              // a gate hair curling in from an edge
      vec2 hp = vec2(h12(vec2(hs, 1.)) > .5 ? .9 : .08, .15 + .7 * h12(vec2(hs, 2.)));
      vec2 q = (v - hp) * vec2(asp, 1.) * 10.;
      float d = abs(q.y - sin(q.x * 2.3 + hs) * .35 - q.x * q.x * .2) ;
      c = mix(c, vec3(.03), smoothstep(.03, .0, d) * smoothstep(1.4, .2, abs(q.x)) * (1. - cm));
    }
  }
  // vignette (a projector's hot centre) and the iris
  vec2 qv = (v - .5) * vec2(asp, 1.);
  c *= 1. - vig * smoothstep(.25, .85, length(qv));
  if (iris < 1.5) { float r = iris * .62; c *= smoothstep(r, r - .03, length(qv)); }
  c = mix(c, vec3(.02, .015, .01), barMask);
  o = vec4(clamp(c, 0., 1.), 1.);
}`;

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

export class Film {
  constructor(W, H) {
    this.W = W; this.H = H;
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    const gl = this.gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Film shader: ' + gl.getShaderInfoLog(s)); return s; };
    const p = this.p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Film link: ' + gl.getProgramInfoLog(p));
    this.u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); this.u[a.name] = gl.getUniformLocation(p, a.name); }
    this.vao = gl.createVertexArray();
    const mk = mip => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT); return t; };
    this.tS = mk(true); this.tT = mk(false);
  }
  // o: colour 0..1 · burn (radius, 0 = off) · burnC [x,y] (uv) · iris (1.6 = open) · roll · weave [px,px] · flick
  //    grain · dust · scratch · hal · bloom · expo · contrast · vig · mirror/split · leak · sepia [4 hex]
  apply(src, over, frame, o = {}) {
    const gl = this.gl, u = this.u;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tS);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); gl.generateMipmap(gl.TEXTURE_2D);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, over);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.W, this.H);
    gl.useProgram(this.p); gl.bindVertexArray(this.vao);
    gl.uniform1i(u.S, 0); gl.uniform1i(u.T, 1);
    const sep = (o.sepia || ['#1a1410', '#7a6446', '#cdb48e', '#f6ecd6']).map(hex);
    gl.uniform3fv(u.s0, sep[0]); gl.uniform3fv(u.s1, sep[1]); gl.uniform3fv(u.s2, sep[2]); gl.uniform3fv(u.s3, sep[3]);
    gl.uniform2f(u.res, this.W, this.H);
    const w = o.weave || [0, 0];
    gl.uniform2f(u.weave, w[0] / this.W, w[1] / this.H);
    gl.uniform2fv(u.burnC, o.burnC || [0.5, 0.5]);
    const f = (k, d) => gl.uniform1f(u[k], o[k] ?? d);
    gl.uniform1f(u.frame, frame);
    f('colour', 0); f('burn', 0); f('iris', 2); f('roll', 0); f('flick', 1); f('grain', 0.1); f('dust', 0.6); f('scratch', 0.5);
    f('hal', 0.5); f('bloom', 0.3); f('expo', 0); f('mirror', 0); f('split', 0.5); f('sepiaHot', 0.5); f('contrast', 0.3); f('vig', 0.35); f('leak', 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }
}
