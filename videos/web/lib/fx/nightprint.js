// NIGHT PRINT (Oct 2026; THE NIGHT OF 25 OCTOBER, ACP OCTOBER): the October series' horror grade for footage plates and any 2D canvas, and eyes that
// burn on footage. Deep black below a lifted key; what survives (lamps, dials, glass, sheets, smoke lit from inside) is lifted toward white and
// glows. The old order keeps its lamps; the masses get eyes, tracked on the plate. A module and its baker, like reel.js + reelbake.py.
//
//   import { NightPrint } from '../lib/fx/nightprint.js';
//   const np = new NightPrint(1080, 1920);                       // WebGL2, stateless in t (repro.js's pattern)
//   np.print(src, t, {
//     levels: [lo, hi, gamma],        // FS_LUMA-style pre-levels per plate (transfers differ: the CC0 copy is darker than the BBC's)
//     key: 0.62, knee: 0.10,          // below key - knee: black; a soft knee; above: lifted (lift) toward white
//     lift: 3.0, floor: 0.015, tint: [1, 0.97, 0.9],  // lift: the survivors' curve, 1 - (1 - x)^lift: 3 burns them white
//     iris: [cx, cy, rx, ry, soft],   // a soft window, all black outside it (high-key rooms; Eisenstein's own device); irisRound() for a circle
//     keep: [[x, y, r, gain], ...],   // discs the key must not lose, lifted by gain, the floor dropped (a dim dial, a lantern); r in plate heights
//     black: [[[x, y], ...], ...],    // polygons that must never glow (burned captions, a daylit window)
//     feather: [l, t, r, b],          // a landscape plate's edges fade into the black
//     place: { rect, z, cy },         // the plate's placement, as Reel.draw draws it: every mask above is in plate fractions and rides the push
//     boil: 12, grain: 0.04 });       // the key's film boil (fps), grain
//   post.apply(np.canvas, t, NightPrint.glow({ bloom: 1, halation: 0.6, tint: [1, 0.9, 0.75] }));   // the glow is post.js's (bloom + halation)
//   const tracks = await NightPrint.tracks('../assets/night25/plates');      // plates/<shot>/eyes.json, from scripts/reeleyes.py
//   np.eyes(g, tracks[shot], frame, { place, open: (pair, f) => 0..1, gain: 1, col: '#ffffff', style: 'eye' | 'glint', maxPx, minPx });
//                                    // maxPx / minPx clamp a pair's core px (a close-up's eyes capped; a distant crowd's raised to be seen)
//   np.eyesAt(g, [[xL, yL, xR, yR, open, sizePx], ...], { style, gain, col }); // eyes at screen points (25 OCTOBER's dial of eyes)
//   NightPrint.toScreen([x, y], place) -> [px, py]                           // plate fraction -> screen, Reel.drawShot's transform
// Eyes are drawn by lib/fx/eyes.js itself, unchanged: a private three.js scene with a fixed lens puts each pair on a plane at the depth that
// gives its on-screen size (from the track's eye spacing), so footage eyes and the lead's 3D crowd eyes are one look. 'glint' is the cold,
// small, flickering style (#cfe0ff, open 0.4-0.8) for spectacles and glass: the old order's lights, never its eyes.
//
//   python3 videos/scripts/reeleyes.py videos/web/assets/<piece>/reel.json [shot ...] [--force]   -> plates/<shot>/eyes.json
//   a shot in reel.json may carry "eyes", one of:
//     { "mode": "field", "poly": [[x, y], ...], "n": 160, "spacing": [0.022, 0.012], "seed": 1, "open": { "from": [x, y], "speed": 0.9 } }
//         blue-noise seeds inside the crowd's polygon (spacing from its bottom row to its top: heads shrink with distance), carried frame to frame
//         by cv2 DIS optical flow (PRESET_MEDIUM) on the baked gray plate, clamped to the polygon; a pair whose forward-backward error passes
//         1.5 px or that leaves the polygon is dropped and re-seeded; open delays ripple out from 'from'
//     { "mode": "faces", "scales": [0.5, 1, 2], "score": 0.75, "minEye": 6 }
//         YuNet (cv2.FaceDetectorYN, the cached yunet.onnx, as hand_faces_extract.py) gives both eye landmarks; linked into tracks by IoU, gaps of
//         6 frames or less bridged, one-euro smoothed. Frontal close-ups only (it misses profiles and distant crowds)
//     { "mode": "keys", "pairs": [[f, xL, yL, xR, yR], ...] }        hand keys, linearly interpolated
//     { "mode": "points", "pts": [[x, y], ...], "glint": true }        fixed sites carried by the flow (glasses on a table, spectacles)
//   eyes.json: { "w", "h", "n", "pairs": [{ "id", "delay", "glint", "f0", "f1", "xy": [[xL, yL, xR, yR], ...] }] }   (plate px, a row a frame)
//
// Checks (node, nothing rendered): node videos/web/labs/nightprint/nightprint_test.mjs [glslangValidator]: the print's math mirrored in JS
// (printPixel: the knee, the keep, the iris, the polygons, the feather, the placement against Reel.drawShot), the eyes' depth against
// eyes.js's own point-size formula, every baked track against its plates, and, given a validator, both shaders compiled as GLSL ES 3.00.
// research/capabilities/nightprint.md.
import * as THREE from 'three';
import { Eyes } from './eyes.js';

const VS = `#version 300 es
out vec2 v; void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); v = p; gl_Position = vec4(p * 2. - 1., 0., 1.); }`;
export const MAX_KEEP = 8, MAX_POLY = 4, MAX_VERT = 12;
// The print. y is flipped on upload (UNPACK_FLIP_Y) so v = (0,0) is the bottom-left of the source; px is top-down screen pixels.
const FS_PRINT = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D uS;
uniform vec2 uRes;
uniform vec4 uPlace;                 // x0, y0, dw, dh: the plate's rectangle on screen (px, top-down), as Reel.drawShot draws it
uniform vec3 uLev;                   // lo, hi, gamma
uniform vec4 uKey;                   // key, knee, lift, floor
uniform vec3 uTint;
uniform vec4 uIris; uniform vec2 uIrisS;    // cx, cy, rx, ry (plate fractions); soft (fraction of the radius), on
uniform vec4 uKeep[${MAX_KEEP}]; uniform int uNKeep;  // x, y, r (plate heights), gain
uniform vec2 uPoly[${MAX_POLY * MAX_VERT}]; uniform int uPolyN[${MAX_POLY}]; uniform int uNPoly;
uniform vec4 uFeather;               // l, t, r, b (plate fractions)
uniform vec4 uFx;                    // seed, boil on (0/1), grain, aa (px)
const vec3 LW = vec3(.2126, .7152, .0722);
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
// one polygon: inside (crossing number) and the distance to its nearest edge, in screen px
vec2 polyHit(int k, vec2 px){
  int n = uPolyN[k]; bool inside = false; float d = 1e9;
  for (int i = 0; i < ${MAX_VERT}; i++) {
    if (i >= n) break;
    int j = i == 0 ? n - 1 : i - 1;
    vec2 a = uPlace.xy + uPoly[k * ${MAX_VERT} + i] * uPlace.zw, b = uPlace.xy + uPoly[k * ${MAX_VERT} + j] * uPlace.zw;
    if (((a.y > px.y) != (b.y > px.y)) && (px.x < (b.x - a.x) * (px.y - a.y) / (b.y - a.y) + a.x)) inside = !inside;
    vec2 e = b - a, w = px - a; float u = clamp(dot(w, e) / max(dot(e, e), 1e-6), 0., 1.); d = min(d, length(w - e * u));
  }
  return vec2(inside ? 1. : 0., d);
}
void main(){
  vec2 px = vec2(v.x, 1. - v.y) * uRes;
  vec2 uv = (px - uPlace.xy) / uPlace.zw;                         // plate fraction under this pixel
  float asp = uPlace.z / uPlace.w;
  float l = dot(texture(uS, v).rgb, LW);
  l = pow(clamp((l - uLev.x) / max(1e-4, uLev.y - uLev.x), 0., 1.), uLev.z);
  // the key boils like film: a frame-held offset and a slow spatial wander
  float key = uKey.x + uFx.y * ((h12(vec2(uFx.x, 3.7)) - .5) * .02 + (vn(px * .003 + uFx.x * 7.) - .5) * .04);
  float knee = max(1e-3, uKey.y), lo = key - knee;
  // keep: inside a disc the plate is lifted by its gain and survives from a low floor up (a dim dial under the key)
  float keepW = 0.;
  for (int i = 0; i < ${MAX_KEEP}; i++) {
    if (i >= uNKeep) break;
    vec4 k = uKeep[i]; float d = length((uv - k.xy) * vec2(asp, 1.)) / max(1e-4, k.z);
    float kd = 1. - smoothstep(.75, 1., d);
    l = max(l, mix(l, min(1., l * k.w), kd)); keepW = max(keepW, kd);
  }
  float s = smoothstep(lo, key, l);
  s = max(s, keepW * smoothstep(.03, .15, l));
  float loK = mix(lo, .03, keepW);                                 // inside a keep the print's floor drops with the key
  float ln = clamp((l - loK) / max(1e-3, 1. - loK), 0., 1.);
  float y = s * (1. - pow(1. - ln, uKey.z));
  // the iris: all black outside a soft ellipse
  if (uIrisS.y > .5) { float e = length((uv - uIris.xy) / max(vec2(1e-4), uIris.zw)); y *= 1. - smoothstep(1. - uIrisS.x, 1., e); }
  // polygons that never glow (anti-aliased over uFx.w px)
  for (int k = 0; k < ${MAX_POLY}; k++) {
    if (k >= uNPoly) break;
    vec2 hit = polyHit(k, px); y *= 1. - hit.x * clamp(hit.y / max(1e-3, uFx.w), 0., 1.);
  }
  // the plate's edges fade into the night; nothing outside the plate
  float inb = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
  float fe = smoothstep(0., max(1e-4, uFeather.x), uv.x) * smoothstep(0., max(1e-4, uFeather.y), uv.y) * smoothstep(0., max(1e-4, uFeather.z), 1. - uv.x) * smoothstep(0., max(1e-4, uFeather.w), 1. - uv.y);
  y *= inb * fe;
  vec3 c = vec3(uKey.w) + (uTint - vec3(uKey.w)) * y;
  c += (h12(floor(px * .5) + uFx.x * 13.1) - .5) * uFx.z * (.25 + .75 * y);
  o = vec4(clamp(c, 0., 1.), 1.);
}`;
export const NIGHTPRINT_GLSL = { vert: { VS }, frag: { FS_PRINT } };

function compile(gl, fs) {
  const mk = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error('NightPrint: ' + gl.getShaderInfoLog(x)); return x; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('NightPrint: ' + gl.getProgramInfoLog(p));
  const u = {}; for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}

// ---------------------------------------------------------------- the pure parts (shared by the GPU path and the node checks)
// the plate's rectangle on screen: Reel.drawShot draws the frame at x + (w - w z) / 2, y + (h - h z) * cy, w z by h z
export function placeRect(place = {}, W = 1080, H = 1920) {
  const r = place.rect || {}, x = r.x ?? 0, y = r.y ?? 0, w = r.w ?? W, h = r.h ?? H, z = place.z ?? 1, cy = place.cy ?? 0.5;
  const dw = w * z, dh = h * z;
  return [x + (w - dw) / 2, y + (h - dh) * cy, dw, dh];
}
// the uniforms one print call sets (also what the CPU mirror reads)
export function printUniforms(o = {}, t = 0, W = 1080, H = 1920) {
  const boil = o.boil ?? 12, seed = boil ? Math.floor(t * boil + 1e-6) % 97 + 1 : 1;
  const keep = (o.keep || []).slice(0, MAX_KEEP), polys = (o.black || []).slice(0, MAX_POLY);
  const poly = new Float32Array(MAX_POLY * MAX_VERT * 2), polyN = new Int32Array(MAX_POLY);
  polys.forEach((P, k) => { const pts = P.slice(0, MAX_VERT); polyN[k] = pts.length; pts.forEach(([x, y], i) => { poly[(k * MAX_VERT + i) * 2] = x; poly[(k * MAX_VERT + i) * 2 + 1] = y; }); });
  const keepA = new Float32Array(MAX_KEEP * 4); keep.forEach((k, i) => keepA.set([k[0], k[1], k[2], k[3] ?? 1.6], i * 4));
  const ir = o.iris;
  return {
    uRes: [W, H], uPlace: placeRect(o.place, W, H), uLev: o.levels || [0.02, 0.98, 1],
    uKey: [o.key ?? 0.62, o.knee ?? 0.10, o.lift ?? 3.0, o.floor ?? 0.015], uTint: o.tint || [1, 0.97, 0.9],
    uIris: ir ? [ir[0], ir[1], ir[2], ir[3]] : [0.5, 0.5, 1, 1], uIrisS: [ir ? Math.max(1e-3, ir[4] ?? 0.25) : 0, ir ? 1 : 0],   // soft 0 -> a hard edge, never smoothstep(1, 1)
    uKeep: keepA, uNKeep: keep.length, uPoly: poly, uPolyN: polyN, uNPoly: polys.length,
    uFeather: o.feather || [0, 0, 0, 0], uFx: [seed, boil ? 1 : 0, o.grain ?? 0.04, o.aa ?? 1.5],
  };
}
const fract = x => x - Math.floor(x);
const smoothstep = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
function h12(px, py) { let a = fract(px * .1031), b = fract(py * .1031), c = fract(px * .1031); const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33); a += d; b += d; c += d; return fract((a + b) * c); }
function vn(x, y) { const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const m = (a, b, u) => a + (b - a) * u; return m(m(h12(ix, iy), h12(ix + 1, iy), fx), m(h12(ix, iy + 1), h12(ix + 1, iy + 1), fx), fy); }
// The print's math for one pixel, line for line with FS_PRINT (luma in, rgb out). px: top-down screen px. U: printUniforms().
export function printPixel(lumaIn, px, py, U) {
  const [x0, y0, dw, dh] = U.uPlace, u = (px - x0) / dw, v = (py - y0) / dh, asp = dw / dh;
  let l = Math.pow(Math.min(1, Math.max(0, (lumaIn - U.uLev[0]) / Math.max(1e-4, U.uLev[1] - U.uLev[0]))), U.uLev[2]);
  const [seed, boilOn, grain, aa] = U.uFx;
  const key = U.uKey[0] + boilOn * ((h12(seed, 3.7) - .5) * .02 + (vn(px * .003 + seed * 7, py * .003 + seed * 7) - .5) * .04);
  const knee = Math.max(1e-3, U.uKey[1]), lo = key - knee;
  let keepW = 0;
  for (let i = 0; i < U.uNKeep; i++) {
    const k = U.uKeep.slice(i * 4, i * 4 + 4), d = Math.hypot((u - k[0]) * asp, v - k[1]) / Math.max(1e-4, k[2]);
    const kd = 1 - smoothstep(.75, 1, d); l = Math.max(l, l + (Math.min(1, l * k[3]) - l) * kd); keepW = Math.max(keepW, kd);
  }
  let s = smoothstep(lo, key, l); s = Math.max(s, keepW * smoothstep(.03, .15, l));
  const loK = lo + (.03 - lo) * keepW, ln = Math.min(1, Math.max(0, (l - loK) / Math.max(1e-3, 1 - loK)));
  let y = s * (1 - Math.pow(1 - ln, U.uKey[2]));
  if (U.uIrisS[1] > .5) { const [cx, cy, rx, ry] = U.uIris, e = Math.hypot((u - cx) / Math.max(1e-4, rx), (v - cy) / Math.max(1e-4, ry)); y *= 1 - smoothstep(1 - U.uIrisS[0], 1, e); }
  for (let k = 0; k < U.uNPoly; k++) {
    const n = U.uPolyN[k]; let inside = false, d = 1e9;
    for (let i = 0; i < n; i++) {
      const j = i === 0 ? n - 1 : i - 1, P = U.uPoly, ia = (k * MAX_VERT + i) * 2, ib = (k * MAX_VERT + j) * 2;
      const ax = x0 + P[ia] * dw, ay = y0 + P[ia + 1] * dh, bx = x0 + P[ib] * dw, by = y0 + P[ib + 1] * dh;
      if (((ay > py) !== (by > py)) && (px < (bx - ax) * (py - ay) / (by - ay) + ax)) inside = !inside;
      const ex = bx - ax, ey = by - ay, wx = px - ax, wy = py - ay, t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / Math.max(ex * ex + ey * ey, 1e-6)));
      d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t));
    }
    y *= 1 - (inside ? 1 : 0) * Math.min(1, Math.max(0, d / Math.max(1e-3, aa)));
  }
  const inb = (u >= 0 && u <= 1 && v >= 0 && v <= 1) ? 1 : 0, F = U.uFeather;
  const fe = smoothstep(0, Math.max(1e-4, F[0]), u) * smoothstep(0, Math.max(1e-4, F[1]), v) * smoothstep(0, Math.max(1e-4, F[2]), 1 - u) * smoothstep(0, Math.max(1e-4, F[3]), 1 - v);
  y *= inb * fe;
  const fl = U.uKey[3], g = (h12(Math.floor(px * .5) + seed * 13.1, Math.floor(py * .5) + seed * 13.1) - .5) * grain * (.25 + .75 * y);
  return U.uTint.map(c => Math.min(1, Math.max(0, fl + (c - fl) * y + g)));
}

// the eyes' lens: a pair's on-screen spacing sets its depth, so eyes.js's own point size follows (spacing 0.052 m, the people.js eye frame)
export const EYE_LENS = { fov: 30, spacing: 0.052 };
export function eyeDepth(spacingPx, H = 1920, fov = EYE_LENS.fov) { const S = H / (2 * Math.tan(fov * Math.PI / 360)); return EYE_LENS.spacing * S / Math.max(0.5, spacingPx); }
// screen px at depth z -> camera-space point (the camera at the origin looking down -z)
export function unproject(px, py, z, W = 1080, H = 1920, fov = EYE_LENS.fov) {
  const th = Math.tan(fov * Math.PI / 360), nx = px / W * 2 - 1, ny = 1 - py / H * 2;
  return [nx * z * th * (W / H), ny * z * th, -z];
}
// the core px eyes.js gives a pair at the depth eyeDepth() picks for its spacing (size 0.016 m, the Eyes default): 0.31 x the spacing
export const eyeCorePx = (spacingPx, H = 1920, size = 0.016) => size * (H / (2 * Math.tan(EYE_LENS.fov * Math.PI / 360))) / eyeDepth(spacingPx, H);
// a round iris on a placed plate: [cx, cy, rx, ry, soft] in plate fractions for a circle of radius r plate heights
export const irisRound = (cx, cy, r, soft = 0.25, place = {}, W = 1080, H = 1920) => { const [, , dw, dh] = placeRect(place, W, H); return [cx, cy, r * dh / dw, r, soft]; };
const GLINT = { col: '#cfe0ff', size: 0.009, minPx: 1.6, halo: 7 };

export class NightPrint {
  constructor(W = 1080, H = 1920, { canvas = null } = {}) {
    this.W = W; this.H = H;
    this.canvas = canvas || Object.assign(document.createElement('canvas'), { width: W, height: H });
    const gl = this.gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false });
    if (!gl) throw new Error('NightPrint: no WebGL2');
    this.vao = gl.createVertexArray(); this.prog = compile(gl, FS_PRINT);
    this.src = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.eyeR = null; this.stats = {};
  }
  _upload(src) {
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.src); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const w = src.naturalWidth || src.videoWidth || src.width, h = src.naturalHeight || src.videoHeight || src.height;
    if (w === this.W && h === this.H) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }
  // src: the frame as composed on screen (the plate drawn where o.place says); returns this (the print is this.canvas)
  print(src, t = 0, o = {}) {
    const t0 = performance.now(), gl = this.gl, P = this.prog, U = printUniforms(o, t, this.W, this.H);
    this._upload(src);
    gl.useProgram(P.p); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.W, this.H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.src); gl.uniform1i(P.u.uS, 0);
    const f = (k, n, a) => { const loc = P.u[k]; if (loc == null) return; if (n === 1) gl.uniform1f(loc, a); else if (n === 2) gl.uniform2fv(loc, a); else if (n === 3) gl.uniform3fv(loc, a); else gl.uniform4fv(loc, a); };
    f('uRes', 2, U.uRes); f('uPlace', 4, U.uPlace); f('uLev', 3, U.uLev); f('uKey', 4, U.uKey); f('uTint', 3, U.uTint);
    f('uIris', 4, U.uIris); f('uIrisS', 2, U.uIrisS); f('uKeep', 4, U.uKeep); f('uPoly', 2, U.uPoly); f('uFeather', 4, U.uFeather); f('uFx', 4, U.uFx);
    if (P.u.uNKeep != null) gl.uniform1i(P.u.uNKeep, U.uNKeep);
    if (P.u.uNPoly != null) gl.uniform1i(P.u.uNPoly, U.uNPoly);
    if (P.u.uPolyN != null) gl.uniform1iv(P.u.uPolyN, U.uPolyN);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats = { ms: performance.now() - t0 };
    return this;
  }
  draw(ctx) { ctx.drawImage(this.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height); return this; }
  // post.js options for the glow (bloom + halation): the night print's survivors burn
  static glow({ bloom = 1, halation = 0.6, tint = [1, 0.9, 0.75], threshold = 0.55, radius = 1.1 } = {}) {
    return { bloom: { amount: bloom, threshold, radius, tint }, halation: { amount: halation, tint, threshold: Math.max(0.3, threshold - 0.05) } };
  }
  static toScreen([x, y], place = {}, W = 1080, H = 1920) { const [x0, y0, dw, dh] = placeRect(place, W, H); return [x0 + x * dw, y0 + y * dh]; }
  static async tracks(base) {
    const idx = await (await fetch(`${base}/index.json`)).json(), out = {};
    await Promise.all(Object.keys(idx).filter(k => idx[k].eyes).map(async k => { const r = await fetch(`${base}/${k}/eyes.json`); if (r.ok) out[k] = await r.json(); }));
    return out;
  }
  // a track's rows at a plate frame -> [{ pair, L: [x, y], R: [x, y] }] in screen px (single sites, L == R, stay single)
  static pairsAt(track, frame, place = {}, W = 1080, H = 1920) {
    const out = [], f = Math.round(frame);
    for (const p of track.pairs) {
      if (f < p.f0 || f > p.f1) continue;
      const r = p.xy[f - p.f0]; if (!r) continue;
      out.push({ pair: p, L: NightPrint.toScreen([r[0] / track.w, r[1] / track.h], place, W, H), R: NightPrint.toScreen([r[2] / track.w, r[3] / track.h], place, W, H) });
    }
    return out;
  }
  _eyesInit() {
    if (this.eyeR) return;
    const cv = Object.assign(document.createElement('canvas'), { width: this.W, height: this.H });
    this.eyeR = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
    this.eyeR.setPixelRatio(1); this.eyeR.setSize(this.W, this.H, false); this.eyeR.setClearColor(0x000000, 0);
    this.eyeScene = new THREE.Scene();
    this.eyeCam = new THREE.PerspectiveCamera(EYE_LENS.fov, this.W / this.H, 0.001, 1e5);
    this.eyeCam.position.set(0, 0, 0); this.eyeCam.lookAt(0, 0, -1); this.eyeCam.updateMatrixWorld(); this.eyeCam.updateProjectionMatrix();
    this.eye = new Eyes(this.eyeScene, { max: 4096 });
    this.glint = new Eyes(this.eyeScene, { max: 512, size: GLINT.size, minPx: GLINT.minPx, halo: GLINT.halo });
    this._v = [new THREE.Vector3(), new THREE.Vector3()];
  }
  // one pair onto the private lens: L, R screen px; open; size: the eye's own core px (else from the spacing)
  _pair(set, L, R, open, col, sizePx = 0) {
    const sp = Math.hypot(R[0] - L[0], R[1] - L[1]);
    const z = sizePx > 0 ? set.material.uniforms.uSize.value * (this.H / (2 * Math.tan(EYE_LENS.fov * Math.PI / 360))) / sizePx : eyeDepth(sp, this.H);
    const a = unproject(L[0], L[1], z, this.W, this.H), b = unproject(R[0], R[1], z, this.W, this.H);
    this._v[0].set(a[0], a[1], a[2]); this._v[1].set(b[0], b[1], b[2]);
    if (sp < 0.5) set.one(this._v[0], open, col); else set.pair(this._v[0], this._v[1], open, col);
  }
  _flush(g, gain = 1) {
    this.eye.gain = gain; this.glint.gain = gain;
    this.eye.end(this.eyeCam, this.H); this.glint.end(this.eyeCam, this.H);
    this.eyeR.render(this.eyeScene, this.eyeCam);
    g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1; g.drawImage(this.eyeR.domElement, 0, 0, this.W, this.H); g.restore();
  }
  // footage eyes: a track (eyes.json) at a plate frame, placed as the plate is. style 'eye' splits a single site into a pair (split px);
  // 'glint' keeps sites single, cold and flickering
  eyes(g, track, frame, { place = {}, open = null, gain = 1, col = '#ffffff', style = 'eye', split = 0, sizeK = 1, flicker = 1, maxPx = 0, minPx = 0 } = {}) {
    if (!track) return 0;
    this._eyesInit(); this.eye.begin(); this.glint.begin();
    const f = Math.round(frame), rows = NightPrint.pairsAt(track, f, place, this.W, this.H);
    let n = 0;
    for (const { pair, L, R } of rows) {
      let o = open ? open(pair, f) : smoothstep(pair.delay || 0, (pair.delay || 0) + 6, f);
      if (o <= 0.001) continue;
      const single = Math.hypot(R[0] - L[0], R[1] - L[1]) < 0.5;
      if (style === 'glint') {
        o *= 0.4 + 0.4 * (1 - flicker + flicker * h12(pair.id * 7.13 + 0.5, f * 1.37 + 0.5));
        this._pair(this.glint, L, R, o, GLINT.col, single ? 2.2 * sizeK : 0);
      } else if (single && split > 0) {
        this._pair(this.eye, [L[0] - split / 2, L[1]], [L[0] + split / 2, L[1]], o, col, 0);
      } else {
        const core = eyeCorePx(Math.hypot(R[0] - L[0], R[1] - L[1]));
        this._pair(this.eye, L, R, o, col, maxPx > 0 && core > maxPx ? maxPx : minPx > 0 && core < minPx ? minPx : 0);
      }
      n++;
    }
    this._flush(g, gain);
    return n;
  }
  // eyes at screen points: [[xL, yL, xR, yR, open, sizePx], ...]
  eyesAt(g, list, { style = 'eye', gain = 1, col = '#ffffff' } = {}) {
    this._eyesInit(); this.eye.begin(); this.glint.begin();
    for (const [xL, yL, xR, yR, o = 1, sz = 0] of list) {
      if (o <= 0.001) continue;
      if (style === 'glint') this._pair(this.glint, [xL, yL], [xR, yR], o, GLINT.col, sz); else this._pair(this.eye, [xL, yL], [xR, yR], o, col, sz);
    }
    this._flush(g, gain);
    return list.length;
  }
}
