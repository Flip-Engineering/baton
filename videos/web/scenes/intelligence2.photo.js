// ACCELERATE c10: living photographs (NASA public-domain stills + a Depth Anything V2 Small disparity map, baked by
// scenes/_c10/accelerate_bake.py). One WebGL2 pass: cover-fit window (cx, cy, zoom), a dolly (push) and a parallax shift that
// move texels by their own depth, a tone map to the piece's white ink world (ink -> paper, gamma, a warm second ink in the
// highlights), event light, grain on twos. Photographs stay photographs: tone, not halftone.
import { clamp } from '../lib/kit.js';

const VS = `#version 300 es
in vec2 a; out vec2 v; void main(){ v = a * .5 + .5; v.y = 1. - v.y; gl_Position = vec4(a, 0, 1); }`;
const FS = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D uC, uD;
uniform vec2 uWin;       // uv extent of the window
uniform vec2 uCen;       // uv centre of the window
uniform vec2 uFoc;       // dolly focus in window space (0..1)
uniform float uPush, uK0;
uniform vec2 uPar;       // parallax (uv at n = 1)
uniform float uLo, uHi, uGam, uCon, uGrain, uSeed, uWarm, uLight, uMix;
uniform vec2 uLP;        // light point (window space)
uniform vec3 uInk, uPaper;
uniform float uRot;
float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32 + uSeed); return fract(p.x * p.y); }
void main(){
  vec2 w = v;
  float n = 0.5;
  vec2 q = w;
  for (int k = 0; k < 4; k++){
    vec2 uv = uCen + (q - .5) * uWin;
    n = texture(uD, uv).r;
    float s = 1. + uPush * (uK0 + (1. - uK0) * n);
    q = uFoc + (w - uFoc) / s - uPar * n / uWin;
  }
  vec2 uv = uCen + (q - .5) * uWin;
  vec3 c = texture(uC, uv).rgb;
  float L = dot(c, vec3(.2126, .7152, .0722));
  // a soft local contrast: the lit side of near things lifts a little
  L = clamp((L - uLo) / (uHi - uLo), 0., 1.);
  L = pow(L, uGam);
  L = mix(L, L * L * (3. - 2. * L), uCon);
  float d = length((w - uLP) * vec2(1., 1.6));
  L += uLight * exp(-d * d * 5.) * (.25 + .75 * n);
  float g = (h(floor(gl_FragCoord.xy / 2.) + 7.) - .5) * uGrain;
  L = clamp(L + g * (1. - abs(L - .5) * 1.4), 0., 1.);
  vec3 col = mix(uInk, uPaper, L);
  col = mix(col, col * vec3(1.02, 1., .93), uWarm * L);       // the warm second ink rides the highlights
  col = mix(vec3(dot(col, vec3(.33))), col, uMix);
  o = vec4(col, 1.);
}`;

let gl = null, prog = null, cv = null, loc = {};
function init() {
  cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1920;
  gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  gl.useProgram(prog);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  for (const k of ['uC', 'uD', 'uWin', 'uCen', 'uFoc', 'uPush', 'uK0', 'uPar', 'uLo', 'uHi', 'uGam', 'uCon', 'uGrain', 'uSeed', 'uWarm', 'uLight', 'uMix', 'uLP', 'uInk', 'uPaper']) loc[k] = gl.getUniformLocation(prog, k);
}
const img = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const tex = (im, unit) => {
  const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
};
const hex = (s) => [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];

export class Photo {
  static async load(id) {
    if (!gl) init();
    const base = new URL('../assets/accelerate/', import.meta.url).href;
    const [c, d] = await Promise.all([img(base + id + '.jpg'), img(base + id + '_d.png')]);
    const p = new Photo(); p.id = id; p.w = c.naturalWidth; p.h = c.naturalHeight;
    p.tc = tex(c, 0); p.td = tex(d, 1);
    return p;
  }
  // draw the window into ctx at (x, y, w, h). o: cx, cy (uv of the window centre), zoom (1 = the window just covers the box),
  // push, k0, shift [sx, sy] (uv for the nearest texels), lo, hi, gamma, con, grain, warm, light, lightAt [x,y], ink, paper, mix, seed
  draw(ctx, x, y, w, h, o = {}) {
    const Wd = Math.min(1080, Math.round(w)), Hd = Math.min(1920, Math.round(h));
    gl.viewport(0, 0, Wd, Hd); cv.width !== 1080 && (cv.width = 1080);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tc); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.td);
    gl.uniform1i(loc.uC, 0); gl.uniform1i(loc.uD, 1);
    // cover fit: the window shows the part of the photo with the box's aspect, divided by zoom
    const ar = w / h, par = this.w / this.h;
    let uw, uh;
    if (par > ar) { uh = 1; uw = ar / par; } else { uw = 1; uh = par / ar; }
    const z = o.zoom ?? 1; uw /= z; uh /= z;
    const cx = clamp(o.cx ?? 0.5, uw / 2, 1 - uw / 2), cy = clamp(o.cy ?? 0.5, uh / 2, 1 - uh / 2);
    gl.uniform2f(loc.uWin, uw, uh); gl.uniform2f(loc.uCen, cx, cy);
    const f = o.focus ?? [0.5, 0.55];
    gl.uniform2f(loc.uFoc, f[0], f[1]); gl.uniform1f(loc.uPush, o.push ?? 0); gl.uniform1f(loc.uK0, o.k0 ?? 0.5);
    const s = o.shift ?? [0, 0]; gl.uniform2f(loc.uPar, s[0], s[1]);
    gl.uniform1f(loc.uLo, o.lo ?? 0.04); gl.uniform1f(loc.uHi, o.hi ?? 0.9); gl.uniform1f(loc.uGam, o.gamma ?? 0.85); gl.uniform1f(loc.uCon, o.con ?? 0.35);
    gl.uniform1f(loc.uGrain, o.grain ?? 0.05); gl.uniform1f(loc.uSeed, (o.seed ?? 0) % 97); gl.uniform1f(loc.uWarm, o.warm ?? 0.5);
    gl.uniform1f(loc.uLight, o.light ?? 0); const la = o.lightAt ?? [0.5, 0.5]; gl.uniform2f(loc.uLP, la[0], la[1]);
    gl.uniform1f(loc.uMix, o.mix ?? 0);
    gl.uniform3fv(loc.uInk, hex(o.ink ?? '#0b0b0d')); gl.uniform3fv(loc.uPaper, hex(o.paper ?? '#f7f7f2'));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    ctx.drawImage(cv, 0, cv.height - Hd, Wd, Hd, x, y, w, h);
  }
}
