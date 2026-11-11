// particles/dust: ambient 3D motes (embers, ash, snow, sparks). Depth is static per mote, so the list is sorted back
// to front once at build and drawn with premultiplied 'over' blending: dark ash really occludes, near embers blur
// into bokeh. Drift is closed-form with wrap-around in a depth-scaled window (fills the frame at every depth).
import { W, H, lerp, rng } from '../../kit.js';
import { PROJ, SPRITE_FS } from './core.js';

export class Dust {
  constructor(P, { n = 3000, seed = 5, zNear = -900, zFar = 2400, dark = 0 } = {}) {
    this.P = P; this.n = n;
    const R = rng(seed), items = [];
    for (let i = 0; i < n; i++) items.push([R() * W, R() * H, lerp(zNear, zFar, Math.pow(R(), 0.8)), R(), R(), R(), R() < dark ? 1 : 0, R()]);
    items.sort((a, b) => b[2] - a[2]);     // far first
    const data = new Float32Array(n * 8); items.forEach((it, i) => data.set(it, i * 8));
    const gl = P.gl;
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);
    this.pr = P.program('dust', `#version 300 es
precision highp float;
layout(location=0) in vec4 A; layout(location=1) in vec4 Bv;   // A: x, y, z, r0   Bv: r1, r2, dark, r3
uniform float T, SIZE, DOF, FOCUS, ALPHA, WOB, GLOW, SCL; uniform vec2 VEL; uniform vec3 COL, DCOL;
${PROJ}
out vec4 vC; out float vB;
void main(){
  float k=(CAM.x+A.z)/CAM.x; vec2 C=vec2(${W / 2}., ${H / 2}.), half_=vec2(${W / 2 + 200}., ${H / 2 + 200}.)*k;
  vec2 p=C+(A.xy-C)*k + VEL*T*(.5+A.w) + vec2(sin(T*(.5+Bv.x)+A.w*40.), cos(T*(.4+Bv.y)+A.w*23.))*WOB;
  p=C-half_+mod(p-(C-half_), half_*2.);
  vec4 pr=project(vec3(p, A.z));
  float sz=SIZE*(.35+Bv.w*1.3)*pr.w; float blur=DOF*abs(pr.z-FOCUS)/CAM.x; float S=clamp(sz*(1.+blur*5.),1.,140.);
  gl_Position=vec4(pr.xy,0.,1.); gl_PointSize=S*SCL;
  float flick=.65+.35*sin(T*(3.+Bv.x*6.)+Bv.y*60.);
  vec3 c = Bv.z>.5 ? DCOL : (Bv.w>.97 ? vec3(1.,.92,.8)*GLOW*1.6 : COL*GLOW*flick);
  vC=vec4(c, ALPHA*min(1., sz*sz/(S*S)*2.)*(pr.z<20.?0.:1.));
  vB=clamp(blur*2.5,0.,1.);
}`, SPRITE_FS, {});
  }
  // o: {size, dof, focus, alpha, vel [px/s], wobble, color [rgb], glow (HDR multiplier), dark [rgb], blend ('over'|'add')}
  draw(t, o = {}) {
    const P = this.P, gl = P.gl, u = P.use(this.pr);
    P.bind(P.hdr); P.blend(o.blend || 'over'); gl.disable(gl.DEPTH_TEST);
    gl.uniform1f(u.T, t); gl.uniform1f(u.SCL, P.pxs); gl.uniform1f(u.SIZE, o.size ?? 6); gl.uniform1f(u.DOF, o.dof ?? 1); gl.uniform1f(u.FOCUS, o.focus ?? P.cam.f);
    gl.uniform1f(u.ALPHA, o.alpha ?? 0.6); gl.uniform1f(u.WOB, o.wobble ?? 12); gl.uniform1f(u.GLOW, o.glow ?? 1.5);
    const v = o.vel || [20, -60]; gl.uniform2f(u.VEL, v[0], v[1]);
    const c = o.color || [1, 0.45, 0.25]; gl.uniform3f(u.COL, ...c); const d = o.dark || [0.02, 0.01, 0.01]; gl.uniform3f(u.DCOL, ...d);
    P.camUniforms(u);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.POINTS, 0, Math.min(this.n, o.count ?? this.n)); gl.bindVertexArray(null);
  }
}
