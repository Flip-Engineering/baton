// hand lab for MELTDOWN v9: renders meltdown8_hand.js alone (same shader, same lights) for fast look-dev.
// window.view({ q, wrist, tilt, yaw, eye:[dx,dy,dz] from target, tg:[local], fov, roll, key, pool, rim, bg }) -> draws
import { buildHand, pose, capsules, HAND_VS, HAND_FS_SKIN, HAND_FS_SLEEVE, noiseTex3D, meshVAO, setHandTables } from '../meltdown8_hand.js';
const W = 1080, H = 1920, HS = 7;
const cv = document.getElementById('out'); cv.width = W; cv.height = H;
const gl = cv.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, alpha: false });
const R = (s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; })(3131);
function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n')); throw new Error(gl.getShaderInfoLog(s)); } return s; }
function prog(vs, fs) { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); } return { p, u }; }
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
const BG = `#version 300 es
precision highp float; in vec2 vUv; uniform vec3 uA, uB; out vec4 o; void main(){ o = vec4(mix(uB, uA, vUv.y), 1.); }`;
const tVor = (() => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1024, 1024, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  gl.viewport(0, 0, 1024, 1024); gl.useProgram(prog(FSQ, VOR).p); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return t; })();
const PBG = prog(FSQ, BG);
gl.getExtension('EXT_color_buffer_float'); gl.getExtension('EXT_color_buffer_half_float');
const RT = (() => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, W, H, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { t, f }; })();
const PTM = prog(FSQ, `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D tS; out vec4 o;
void main(){ vec3 c = texture(tS, vUv).rgb; c = 1. - exp(-c*0.95); float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = clamp(mix(vec3(l), c, 1.3), 0., 1.); o = vec4(pow(c, vec3(1.)), 1.); }`);
const t0 = performance.now();
const HAND = buildHand({ h: 0.0125, hs: 0.024 });
const PH = prog(HAND_VS, HAND_FS_SKIN), PV = prog(HAND_VS, HAND_FS_SLEEVE), tN = noiseTex3D(gl, R), MS = meshVAO(gl, HAND.skin), MV = meshVAO(gl, HAND.sleeve);
for (const P of [PH, PV]) { gl.useProgram(P.p); setHandTables(gl, P.u); }
const PNOS = prog(HAND_VS, HAND_FS_SKIN.replace('#version 300 es\n', '#version 300 es\n#define NOSURF\n')); gl.useProgram(PNOS.p); setHandTables(gl, PNOS.u);
const PMIN = prog(HAND_VS, `#version 300 es
precision highp float; in vec3 vW, vN, vR, vA; in vec4 vL; flat in float vPart; out vec4 o; void main(){ o = vec4(vL.xyz*0.5 + vA.x*0.1, 1.); }`);
console.log(`lab ready ${((performance.now() - t0) / 1000).toFixed(1)}s`);
const nrm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); }, sub = (a, b) => a.map((x, i) => x - b[i]), add = (a, b) => a.map((x, i) => x + b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function frame(tilt, yaw) { const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt); return [cy, 0, -sy, -sy * st, ct, -cy * st, sy * ct, st, cy * ct]; }
const hp = (M, O, v) => [O[0] + (M[0] * v[0] + M[3] * v[1] + M[6] * v[2]) * HS, O[1] + (M[1] * v[0] + M[4] * v[1] + M[7] * v[2]) * HS, O[2] + (M[2] * v[0] + M[5] * v[1] + M[8] * v[2]) * HS];
function VPof(eye, tg, fov, roll, vx, vy, vw, vh) {
  const z = nrm(sub(eye, tg)), up0 = Math.abs(z[1]) > 0.97 ? [0, 0, -1] : [0, 1, 0]; let x = nrm(cross(up0, z)), y = cross(z, x);
  if (roll) { const c = Math.cos(roll), s = Math.sin(roll); const x2 = x.map((v, i) => v * c + y[i] * s); y = cross(z, x2); x = x2; }
  const V = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  const f = 1 / Math.tan(fov * Math.PI / 360), n = 0.1, fa = 600, asp = vw / vh;
  const P = [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0];
  const VP = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let v = 0; for (let q = 0; q < 4; q++) v += P[q * 4 + r] * V[c * 4 + q]; VP[c * 4 + r] = v; }
  return VP;
}
// cfgs: array of views, drawn into a grid (cols x rows) over the canvas
window.view = (cfgs, cols = 1) => {
  const rows = Math.ceil(cfgs.length / cols), vw = Math.floor(W / cols), vh = Math.floor(H / rows);
  gl.bindFramebuffer(gl.FRAMEBUFFER, RT.f); gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  cfgs.forEach((c, i) => {
    const vx = (i % cols) * vw, vy = H - (Math.floor(i / cols) + 1) * vh;
    gl.viewport(vx, vy, vw, vh); gl.enable(gl.SCISSOR_TEST); gl.scissor(vx, vy, vw, vh); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.useProgram(PBG.p); S(PBG.u, 'uA', ...(c.bgA || [0.45, 0.02, 0.03])); S(PBG.u, 'uB', ...(c.bgB || [0.12, 0.0, 0.01])); gl.drawArrays(gl.TRIANGLES, 0, 3);
    const M = frame(c.tilt ?? 0.72, c.yaw ?? -0.22), O = [0, -27, 0], P = pose(c.q ?? 0, { wrist: c.wrist ?? 0.55 });
    const tg = hp(M, O, c.tg || [0.02, 0.6, 0.15]), eye = add(tg, c.eye || [0, 4, 16]);
    const VP = VPof(eye, tg, c.fov || 54, c.roll || 0, vx, vy, vw, vh);
    const caps = capsules(P), A = new Float32Array(76), B = new Float32Array(76);
    caps.forEach(([a, e, r, bone], k) => { A.set([...hp(M, O, a), r * HS], k * 4); B.set([...hp(M, O, e), bone], k * 4); });
    for (const [PU0, m, sl] of [[PH, MS, 0], [PV, MV, 1]]) {
    const PU = c.minfs ? PMIN : c.nosurf && PU0 === PH ? PNOS : PU0, u = PU.u; gl.useProgram(PU.p);
    gl.uniformMatrix4fv(u.uVP, false, VP); S(u, 'uEye', ...eye); gl.uniform4fv(u.uDQ, P.dq); gl.uniformMatrix3fv(u.uHandM, false, new Float32Array(M)); S(u, 'uHandO', ...O); S(u, 'uHandS', HS);
    gl.uniform4fv(u.uCapA, A); gl.uniform4fv(u.uCapB, B); gl.uniform1i(u.uShadow, c.shadow ?? 1);
    const kI = c.key ?? 2.65, pI = c.pool ?? 2.5, rI = c.rim ?? 2.1;
    S(u, 'uKeyDir', ...nrm([0.12, 1, -0.3])); S(u, 'uKeyCol', kI, 0.78 * kI, 0.5 * kI);
    const q0 = c.close ?? 0; S(u, 'uPoolPos', ...hp(M, O, [0.02, 0.55 + 0.3 * q0, 0.3 + 0.12 * q0])); S(u, 'uPoolCol', pI, 0.72 * pI, 0.38 * pI);
    S(u, 'uRimCol', rI, 0.3 * rI, 0.1 * rI); S(u, 'uRimDir', ...nrm(add(nrm(sub(tg, eye)), [0, 0.35, 0]))); S(u, 'uAmbUp', 0.07, 0.035, 0.025); S(u, 'uAmbDn', 0.24, 0.025, 0.03); S(u, 'uFillDir', ...nrm(add(nrm(sub(eye, tg)), [-0.5, 0.35, 0]))); S(u, 'uFillCol', 0.6, 0.25, 0.13);
    S(u, 'uB', c.b ?? 58); S(u, 'uDis', c.dis ?? 0); gl.uniform1fv(u.uFlex, new Float32Array(P.flex)); S(u, 'uTrans', 1.2); S(u, 'uGlow', c.glow ?? 0); gl.uniform1i(u.uDebug, c.debug ?? 0);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, tN); gl.uniform1i(u.tN, 2); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tVor); gl.uniform1i(u.tVor, 3);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    S(u, 'uSleeve', sl); if (!c.nohand) { gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, m.type, 0); }
    }
    gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.bindVertexArray(null);
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.disable(gl.DEPTH_TEST); gl.useProgram(PTM.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, RT.t); gl.uniform1i(PTM.u.tS, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
  return gl.getError();
};
window.labSync = () => { const b = new Uint8Array(4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); return b[0]; };
window.labReady = true;
