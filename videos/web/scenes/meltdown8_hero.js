// MELTDOWN v12: the worker's hand as a live hero layer. Wraps the anatomical hand of meltdown8_hand.js (built for v9, never
// shipped) in an offscreen WebGL2 canvas that renders one full-frame view onto TRANSPARENT ground, so the scene's 2D
// compositor can lay it over any world and print over it. createHero() builds the meshes once (about 8 s under swiftshader).
//   hero.draw(g, v)   v = { q (0 open .. 2 fist), wrist, yaw, tilt, eye:[dx,dy,dz], tg:[x,y,z] (hand-local), fov, roll,
//                           key, pool, rim, glow, fade, dx, dy }  ->  returns the projected knuckles [{x, y, ang, len}] x4
//   the knuckles are where the four ACP bars sit on the fist (the bars are drawn by the scene, then become the gear).
import { buildHand, pose, capsules, xform, FINGERS, HAND_VS, HAND_FS_SKIN, HAND_FS_SLEEVE, noiseTex3D, meshVAO, setHandTables } from './meltdown8_hand.js';

const HS = 7, O = [0, -27, 0];
const nrm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); }, sub = (a, b) => a.map((x, i) => x - b[i]), add = (a, b) => a.map((x, i) => x + b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function frame(tilt, yaw) { const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt); return [cy, 0, -sy, -sy * st, ct, -cy * st, sy * ct, st, cy * ct]; }
const hp = (M, v) => [O[0] + (M[0] * v[0] + M[3] * v[1] + M[6] * v[2]) * HS, O[1] + (M[1] * v[0] + M[4] * v[1] + M[7] * v[2]) * HS, O[2] + (M[2] * v[0] + M[5] * v[1] + M[8] * v[2]) * HS];
function viewProj(eye, tg, fov, roll, asp) {
  const z = nrm(sub(eye, tg)), up0 = Math.abs(z[1]) > 0.97 ? [0, 0, -1] : [0, 1, 0]; let x = nrm(cross(up0, z)), y = cross(z, x);
  if (roll) { const c = Math.cos(roll), s = Math.sin(roll); const x2 = x.map((v, i) => v * c + y[i] * s); y = cross(z, x2); x = x2; }
  const V = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  const f = 1 / Math.tan(fov * Math.PI / 360), n = 0.1, fa = 600;
  const P = [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0];
  const VP = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let v = 0; for (let q = 0; q < 4; q++) v += P[q * 4 + r] * V[c * 4 + q]; VP[c * 4 + r] = v; }
  return VP;
}
const project = (VP, p, W, H) => { const x = VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12], y = VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13], w = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15];
  return [(x / w * 0.5 + 0.5) * W, (1 - (y / w * 0.5 + 0.5)) * H]; };

export function createHero(W = 1080, H = 1920, o = {}) {
  const sc = o.scale ?? 1, RW = Math.round(W * sc), RH = Math.round(H * sc);
  const cv = document.createElement('canvas'); cv.width = RW; cv.height = RH;
  const gl = cv.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error('hero: no webgl2');
  const R = (s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; })(3131);
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); } return { p, u }; };
  const S = (u, n, ...v) => { const l = u[n]; if (l == null) return; [gl.uniform1f, gl.uniform2f, gl.uniform3f, gl.uniform4f][v.length - 1].call(gl, l, ...v); };
  const FSQ = `#version 300 es
out vec2 vUv; void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); vUv = p; gl_Position = vec4(p*2.-1., 0., 1.); }`;
  const VOR = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
float hash2(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
vec2 hash22(vec2 p){ return vec2(hash2(p), hash2(p+17.31)); }
void main(){ vec2 p = vUv*16.; vec2 i = floor(p), f = fract(p); float d1 = 9., d2 = 9.; vec2 id = vec2(0.);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g = vec2(x,y), gw = mod(i+g, 16.); vec2 q = g + hash22(gw) - f; float d = length(q);
    if (d < d1){ d2 = d1; d1 = d; id = gw; } else if (d < d2) d2 = d; }
  o = vec4(d1, d2 - d1, hash2(id), 0.5); }`;
  const tVor = (() => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1024, 1024, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.REPEAT], [gl.TEXTURE_WRAP_T, gl.REPEAT]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.viewport(0, 0, 1024, 1024); gl.useProgram(prog(FSQ, VOR).p); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return t; })();
  gl.getExtension('EXT_color_buffer_float'); gl.getExtension('EXT_color_buffer_half_float');
  const RT = (() => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, RW, RH, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, RW, RH); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { t, f }; })();
  // tonemap onto transparent ground: premultiplied colour, alpha = the hand's coverage (the hand writes alpha 1; the clear is 0)
  const PTM = prog(FSQ, `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D tS; uniform float uFade; out vec4 o;
void main(){ vec4 s = texture(tS, vUv); vec3 c = s.rgb / max(s.a, 1e-3); c = 1. - exp(-c*0.95); float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = clamp(mix(vec3(l), c, 1.3), 0., 1.);
  float a = clamp(s.a, 0., 1.) * uFade; o = vec4(c * a, a); }`);
  const HAND = buildHand({ h: o.h ?? 0.0125, hs: o.hs ?? 0.024 });
  const PH = prog(HAND_VS, HAND_FS_SKIN), PV = prog(HAND_VS, HAND_FS_SLEEVE), tN = noiseTex3D(gl, R), MS = meshVAO(gl, HAND.skin), MV = meshVAO(gl, HAND.sleeve);
  for (const P of [PH, PV]) { gl.useProgram(P.p); setHandTables(gl, P.u); }

  function draw(g, c = {}) {
    const M = frame(c.tilt ?? 0.3, c.yaw ?? -0.15), P = pose(c.q ?? 0, { wrist: c.wrist ?? 0.5 });
    const tg = hp(M, c.tg || [0, 0.5, 0.15]), eye = add(tg, c.eye || [0, 2, 42]);
    const VP = viewProj(eye, tg, c.fov || 50, c.roll || 0, W / H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, RT.f); gl.viewport(0, 0, RW, RH); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const caps = capsules(P), A = new Float32Array(76), B = new Float32Array(76);
    caps.forEach(([a, e, r, bone], k) => { A.set([...hp(M, a), r * HS], k * 4); B.set([...hp(M, e), bone], k * 4); });
    for (const [PU, m, sl] of [[PH, MS, 0], [PV, MV, 1]]) {
      const u = PU.u; gl.useProgram(PU.p);
      gl.uniformMatrix4fv(u.uVP, false, VP); S(u, 'uEye', ...eye); gl.uniform4fv(u.uDQ, P.dq); gl.uniformMatrix3fv(u.uHandM, false, new Float32Array(M)); S(u, 'uHandO', ...O); S(u, 'uHandS', HS);
      gl.uniform4fv(u.uCapA, A); gl.uniform4fv(u.uCapB, B); gl.uniform1i(u.uShadow, 1);
      const kI = c.key ?? 2.65, pI = c.pool ?? 2.5, rI = c.rim ?? 2.1, q0 = Math.min(1, (c.q ?? 0) / 2);
      S(u, 'uKeyDir', ...nrm([0.12, 1, -0.3])); S(u, 'uKeyCol', kI, 0.78 * kI, 0.5 * kI);
      S(u, 'uPoolPos', ...hp(M, [0.02, 0.55 + 0.3 * q0, 0.3 + 0.12 * q0])); S(u, 'uPoolCol', pI, 0.72 * pI, 0.38 * pI);
      S(u, 'uRimCol', rI, 0.3 * rI, 0.1 * rI); S(u, 'uRimDir', ...nrm(add(nrm(sub(tg, eye)), [0, 0.35, 0]))); S(u, 'uAmbUp', 0.07, 0.035, 0.025); S(u, 'uAmbDn', 0.24, 0.025, 0.03);
      S(u, 'uFillDir', ...nrm(add(nrm(sub(eye, tg)), [-0.5, 0.35, 0]))); S(u, 'uFillCol', 0.6, 0.25, 0.13);
      S(u, 'uB', c.b ?? 58); S(u, 'uDis', c.dis ?? 0); gl.uniform1fv(u.uFlex, new Float32Array(P.flex)); S(u, 'uTrans', 1.2); S(u, 'uGlow', c.glow ?? 0); gl.uniform1i(u.uDebug, 0);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, tN); gl.uniform1i(u.tN, 2); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tVor); gl.uniform1i(u.tVor, 3);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      S(u, 'uSleeve', sl); gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, m.type, 0);
    }
    gl.disable(gl.CULL_FACE); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, RW, RH); gl.disable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(PTM.p); S(PTM.u, 'uFade', c.fade ?? 1); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, RT.t); gl.uniform1i(PTM.u.tS, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
    g.save(); g.drawImage(cv, c.dx || 0, c.dy || 0, W, H); g.restore();
    // the four knuckles (MCP heads, on the back of the hand) projected to the frame: [{x, y, ang, len}] pinky..index
    const kn = FINGERS.map((f, i) => {
      const a = xform(P, 0, [f.J[0][0], f.J[0][1] + 0.06, -0.12]), b = xform(P, 1 + i * 3, [f.J[1][0], f.J[1][1], -0.12]);
      const pa = project(VP, hp(M, a), W, H), pb = project(VP, hp(M, b), W, H);
      return { x: (pa[0] + pb[0]) / 2 + (c.dx || 0), y: (pa[1] + pb[1]) / 2 + (c.dy || 0), ang: Math.atan2(pb[1] - pa[1], pb[0] - pa[0]), len: Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) };
    });
    return kn;
  }
  return { draw, ms: HAND.ms, cv };
}
