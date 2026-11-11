// particles/swarm: the closed-form (stateless) point morph. Each particle is a pure function of (id, t, params):
// morph A -> B with stagger, flight scatter (random or along a ribbon field), swirl, lift, closed-form curl-noise
// "advection", shock pulses, explode, rise, light sweep, 3D camera, DOF sprites, streaks.
//   const sw = new Swarm(P, { n: 1 << 18 });
//   const A = sw.shape(pointsA), B = sw.shape(pointsB);
//   sw.draw(t, { preset: 'silk', a: A, b: B, u });              // raw params override the preset
//   const ch = sw.chain([{ ps: logo, beat: 8 }, { ps: words, beat: 24, order: 'y', flight: 'ribbon' }], { beats: B });
//   ch.draw(t, { layer: 'type' });                             // matchTo, stagger, flight, auto density: all derived
import { W, H, clamp } from '../../kit.js';
import { COMMON, PROJ, SPRITE_FS } from './core.js';
import { resize, matchTo, coverage } from './samplers.js';

// Named looks. A preset is a base param set; anything passed to draw() overrides it.
export const PRESETS = {
  // soft glowing silk: the default light language
  silk:    { turb: 4, freq: 0.004, flowSpeed: 0.3, steps: 2, size: 2.1, sizeVar: 0.6, alpha: 0.34, dof: 0.45, hot: 0.6, ribbon: 1, ribbonFreq: 0.0022 },
  // sparks leaving a shape upward, defocused, hot
  embers:  { turb: 6, freq: 0.005, flowSpeed: 0.4, steps: 1, size: 2, sizeVar: 0.8, alpha: 0.32, dof: 0.9, hot: 1.2, rise: 0 },
  // crisp flat Constructivist points: no turbulence, no defocus, hard discs (pair with a 'poster' layer)
  'poster-flat': { turb: 0, steps: 0, size: 2.6, sizeVar: 0, alpha: 1, dof: 0, hot: 0, hard: true, ribbon: 0.3, sweep: null, colorLead: 0.2 },
  // near-still matter (ice, stone): tiny slow drift, no flight glow
  frozen:  { turb: 1.5, freq: 0.006, flowSpeed: 0.05, steps: 1, size: 1.8, sizeVar: 0.3, alpha: 0.4, dof: 0.2, hot: 0 },
  // dark ink motes (pair with an 'ink' layer): heavier points, no glow
  ink:     { turb: 3, freq: 0.004, flowSpeed: 0.25, steps: 2, size: 2.4, sizeVar: 0.7, alpha: 0.5, dof: 0.2, hot: 0, colorLead: 0.12 },
  // turbulent storm: big curl displacement, fast
  storm:   { turb: 40, freq: 0.003, flowSpeed: 0.9, steps: 3, size: 1.9, sizeVar: 0.6, alpha: 0.3, dof: 0.6, hot: 0.8 },
};
// Flight styles for morphs (chain steps, or `flight:` in draw()).
export const FLIGHTS = {
  ribbon: { ribbon: 1, scatter: 620, swirl: 0.25 },          // neighbours travel together: a sheet folding
  swirl:  { ribbon: 0.5, scatter: 520, swirl: 2.2 },          // a vortex spiral around the frame centre
  burst:  { ribbon: 0.35, scatter: 900, swirl: 0.3, hot: 0.9, radial: 0.8 }, // a starburst out of staggerPoint, then assembly
  pour:   { ribbon: 1, scatter: 420, swirl: 0.05, lift: -260 }, // falls into place (column by column with order 'x')
  direct: { ribbon: 0, scatter: 60, swirl: 0 },               // straight lines, machine-like
};
const SM = { random: 0, y: 1, x: 2, radial: 3, key: 4 };

export class Swarm {
  constructor(P, { n = 1 << 18, texW = 1024 } = {}) {
    this.P = P; this.texW = texW; this.texH = Math.ceil(n / texW); this.n = texW * this.texH;
    this.shapes = [];
    this.pr = P.program('swarm', `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D PA, PB, CA, CB; uniform int TW, LINES, NSTEP;
uniform vec2 T, U, TURB;        // (head, tail) pairs: time, morph u, turbulence amp (px)
uniform float STAG, SMODE, FREQ, FSPEED, SCAT, SIZE, SVAR, BRIGHT, DOF, FOCUS, SEED, SWIRL, LIFT, CMIX, ALPHA, EXPL, RISE, SCL, HARD;
uniform vec3 TINT, HOT;
uniform vec4 PULSE, PULSE2;     // x, y, age, amp
uniform vec2 STAGP;
uniform float FDIM, CLEAD;  // CLEAD > 0: colour turns to shape b's by k = CLEAD (ahead of the position)   // dims particles in flight: alpha / (1 + FDIM*flight)
uniform vec2 DENS;    // alpha at the start / end of the morph (auto density: a small shape bursting into a big one)
uniform vec2 RIB; uniform float EXOUT, RAD;   // RAD: flight scatter points away from staggerPoint (a starburst)
uniform vec4 SWEEP;   // light sweep: angle, position (px along the direction), width (px), gain
${PROJ}
${COMMON}
out vec4 vC; out float vB;
vec3 pos(int id, float t, float u, float turb, out float fl, out float kk){
  ivec2 tc=ivec2(id%TW, id/TW);
  vec4 a=texelFetch(PA,tc,0), b=texelFetch(PB,tc,0);
  vec4 r=h4(uint(id)+uint(SEED));
  float key = SMODE<.5 ? r.x : SMODE<1.5 ? b.y/${H}. : SMODE<2.5 ? b.x/${W}. : SMODE<3.5 ? clamp(length(b.xy-STAGP)/1400.,0.,1.) : b.w;
  float k=clamp((u-key*STAG)/max(1.-STAG,1e-3),0.,1.);
  float e=k<.5 ? 4.*k*k*k : 1.-pow(-2.*k+2.,3.)/2.;
  kk=k; fl=sin(3.14159*k);
  vec3 p=mix(a.xyz,b.xyz,e);
  vec3 rnd=(r.yzw-.5)*vec3(1.,1.,1.6), cd=vec3(0.);
  if(RIB.x>0.){ vec3 m=a.xyz; vec4 n2=nd(vec3(m.xy*RIB.y*.7+9.1, SEED*.61+3.));
    cd=vec3(curl(m, SEED*.37, RIB.y).xy*.42, (n2.x-.5)*.35)+(r.yzw-.5)*vec3(.05,.05,.03); }
  vec3 fd=mix(rnd, cd*vec3(1.,1.,1.6), RIB.x);
  if(RAD>0.){ vec2 rd=b.xy-STAGP; fd=mix(fd, vec3(rd/(length(rd)+40.)*(.35+1.1*r.x*r.x), (r.w-.5)*.4)*1.3, RAD); }
  p+=fd*SCAT*fl;
  float ang=SWIRL*fl*(r.y-.3); vec2 c=p.xy-vec2(${W / 2}.,${H / 2}.); p.xy=vec2(${W / 2}.,${H / 2}.)+mat2(cos(ang),-sin(ang),sin(ang),cos(ang))*c;
  p.y-=LIFT*fl*(.5+r.z);
  float am=turb*(1.+2.5*fl);
  for(int i=0;i<4;i++){ if(i>=NSTEP) break; p+=curl(p, t*FSPEED+float(i)*.11, FREQ)*am/float(NSTEP); }
  for(int j=0;j<2;j++){ vec4 P_=j==0?PULSE:PULSE2; if(P_.w!=0.){ vec2 d=p.xy-P_.xy; float L=length(d)+1e-3; float front=P_.z*1900.;
    float w=exp(-pow((L-front)/180.,2.))*exp(-P_.z*2.5)*smoothstep(0.,260.,L); p.xy+=d/L*w*P_.w; p.z-=w*P_.w*.6; } }
  if(EXPL!=0.){ vec3 dr=normalize(vec3(r.yz-.5, r.w-.5)+1e-4);
    float mag = RIB.x>0. ? mix(.4+r.x, (.25+1.5*r.x*r.x)*(.6+.8*nd(vec3(a.xy*RIB.y*1.3, SEED+7.)).x), RIB.x) : (.4+r.x)*(1.+.5*sin(r.w*40.));
    p+=(RIB.x>0. ? mix(dr, cd*2.2, RIB.x) : dr)*EXPL*mix(1.,1.-e,EXOUT)*mag; }
  if(RISE>0.){ float q=RISE*(.15+r.z*r.z*1.8); p.y-=q; p.x+=sin(q*.01+r.w*30.)*q*.12; }
  return p;
}
void main(){
  int id= LINES==1 ? gl_VertexID/6 : gl_VertexID;
  float fl, k; vec3 p=pos(id,T.x,U.x,TURB.x,fl,k);
  vec4 pr=project(p);
  vec4 r=h4(uint(id)+uint(SEED)+99u);
  ivec2 tc=ivec2(id%TW, id/TW);
  float e=k*k*(3.-2.*k);
  vec3 col=mix(texelFetch(CA,tc,0).rgb, texelFetch(CB,tc,0).rgb, CLEAD>0. ? smoothstep(0.,CLEAD,k) : e);
  col=mix(col, TINT, CMIX)*(1.+HOT*fl*2.)*(HARD>.5 ? 1. : .75+.5*r.x);
  if(SWEEP.w!=0.){ float d=dot(p.xy, vec2(cos(SWEEP.x), sin(SWEEP.x)))-SWEEP.y; col*=1.+SWEEP.w*exp(-d*d/(SWEEP.z*SWEEP.z)); }
  float sz=SIZE*(1.+SVAR*(r.y*r.y*3.-.5))*pr.w;
  float blur=DOF*abs(pr.z-FOCUS)/CAM.x; float S=sz*(1.+blur*6.);
  S=clamp(S, 1., 48.);
  float a=ALPHA*BRIGHT*min(1., sz*sz/(S*S)*1.6)/(1.+FDIM*fl)*mix(DENS.x,DENS.y,e);
  if(pr.z<30.) a=0.;
  vB= HARD>.5 ? -1. : clamp(blur*3.,0.,1.);
  if(LINES==1){
    float fl2, k2; vec3 p2=pos(id,T.y,U.y,TURB.y,fl2,k2); vec4 pt=project(p2);
    vec2 sh=vec2(pr.x*${W / 2}., pr.y*${H / 2}.), st=vec2(pt.x*${W / 2}., pt.y*${H / 2}.);
    vec2 d=sh-st; float L=length(d); vec2 n= L>1e-3 ? vec2(-d.y,d.x)/L : vec2(0.,1.);
    int c=gl_VertexID%6; c= c==3 ? 2 : c==4 ? 1 : c==5 ? 3 : c; float isHead=float(c&1), side=float(c>>1)*2.-1.;
    float wdt=max(.6, sz*.45);
    vec2 q=mix(st, sh, isHead)+n*side*wdt;
    gl_Position=vec4(q.x/${W / 2}., q.y/${H / 2}., 0., 1.);
    vC=vec4(col, a*isHead*min(1., L/3.)*1.2); vB=0.;
    return;
  }
  gl_Position=vec4(pr.xy,0.,1.); gl_PointSize=S*SCL;
  vC=vec4(col, a);
}`, SPRITE_FS.replace('void main(){', 'uniform highp int LINES;\nvoid main(){ if(LINES==1){ o=vec4(vC.rgb*vC.a, vC.a); return; }'), {});
  }
  // Upload a PointSet (resized to n) -> shape id. Also measures its covered area (auto density).
  shape(ps) {
    const P = this.P; ps = resize(ps, this.n);
    const s = { pos: P.dataTex(this.texW, this.texH, ps.pos, true), col: P.dataTex(this.texW, this.texH, ps.col, false), ps, area: coverage(ps) };
    this.shapes.push(s); return this.shapes.length - 1;
  }
  // Resolve preset + flight + raw params into one param object.
  params(o) {
    const base = o.preset ? PRESETS[o.preset] : null;
    if (o.preset && !base) throw new Error('swarm: unknown preset ' + o.preset);
    const fl = o.flight ? FLIGHTS[o.flight] : null;
    return { ...(base || {}), ...(fl || {}), ...o };
  }
  // o: {preset, flight, a, b (shape ids), u (0..1 morph), stagger (0..0.9), staggerMode ('random'|'y'|'x'|'radial'|'key'),
  //     staggerPoint [x,y], radial (0..1: scatter away from staggerPoint), turb (px), freq (1/px), flowSpeed, steps (0..4), scatter (px in flight), swirl (rad), lift (px),
  //     size (px), sizeVar, bright, alpha, hot (flight glow), flightDim, auto (default true: scale alpha, flightDim and
  //     scatter from the area ratio of a to b), ribbon (0..1), ribbonFreq, explodeOut, tint, tintMix, dof, focus,
  //     sweep {angle, pos, width, gain}, pulse {x,y,age,amp}, pulse2, explode (px), rise (px), seed, count,
  //     streak (s: draw as speed lines), hard (flat discs), colorLead (0..1: take b's colours early in the flight), blend ('add'|'over'), layer (draw into P.layer(name))}
  // Pass `at: tt => params` to get correct streak tails (params evaluated at t - streak).
  draw(t, o0, at = null) {
    const o = this.params(o0);
    const P = this.P, gl = P.gl;
    const prevLayer = o.layer !== undefined ? P.layer(o.layer) : undefined;
    const u = P.use(this.pr);
    const A = this.shapes[o.a ?? 0], Bs = this.shapes[o.b ?? o.a ?? 0];
    P.bind(P.hdr); P.blend(o.blend || 'add'); gl.disable(gl.DEPTH_TEST);
    P.tex(0, A.pos); P.tex(1, Bs.pos); P.tex(2, A.col); P.tex(3, Bs.col);
    gl.uniform1i(u.PA, 0); gl.uniform1i(u.PB, 1); gl.uniform1i(u.CA, 2); gl.uniform1i(u.CB, 3); gl.uniform1i(u.TW, this.texW);
    const tail = o.streak ? this.params(at ? at(t - o.streak) : o) : o;
    const tt = o.streak ? t - o.streak : t;
    gl.uniform2f(u.T, t, tt); gl.uniform2f(u.U, o.u ?? 0, tail.u ?? o.u ?? 0); gl.uniform2f(u.TURB, o.turb ?? 30, tail.turb ?? o.turb ?? 30);
    // auto density: a morph between shapes of different area keeps a constant brightness per area, dims the
    // flight in proportion to the size change and throws a wider scatter when a small shape bursts into a big one
    let dens = [1, 1], fdim = o.flightDim ?? 0, scat = o.scatter ?? 300;
    if (o.auto !== false && A !== Bs) {
      const r = A.area / Bs.area, lr = Math.abs(Math.log2(r));
      dens = [Math.min(1, Math.pow(r, 0.6)), Math.min(1, Math.pow(1 / r, 0.6))];
      fdim += 1.2 * lr; scat *= 1 + 0.12 * Math.max(0, -Math.log2(r));
    }
    gl.uniform2f(u.DENS, dens[0], dens[1]);
    gl.uniform1f(u.STAG, o.stagger ?? 0.5); gl.uniform1f(u.SMODE, SM[o.staggerMode || 'random']); const sp = o.staggerPoint || [W / 2, H / 2]; gl.uniform2f(u.STAGP, sp[0], sp[1]);
    gl.uniform1f(u.FREQ, o.freq ?? 0.004); gl.uniform1f(u.FSPEED, o.flowSpeed ?? 0.35); gl.uniform1i(u.NSTEP, o.steps ?? 2);
    gl.uniform1f(u.SCAT, scat); gl.uniform1f(u.SWIRL, o.swirl ?? 0); gl.uniform1f(u.LIFT, o.lift ?? 0);
    gl.uniform1f(u.SIZE, o.size ?? 2); gl.uniform1f(u.SVAR, o.sizeVar ?? 0.4); gl.uniform1f(u.BRIGHT, o.bright ?? 1); gl.uniform1f(u.ALPHA, o.alpha ?? 0.5);
    const ti = o.tint || [1, 1, 1]; gl.uniform3f(u.TINT, ti[0], ti[1], ti[2]); gl.uniform1f(u.CMIX, o.tintMix ?? 0);
    const hot = o.hot ?? 0; gl.uniform3f(u.HOT, hot, hot * 0.6, hot * 0.4);
    gl.uniform1f(u.DOF, o.dof ?? 0); gl.uniform1f(u.FOCUS, o.focus ?? P.cam.f); gl.uniform1f(u.SEED, o.seed ?? 0); gl.uniform1f(u.EXPL, o.explode ?? 0); gl.uniform1f(u.RISE, o.rise ?? 0); gl.uniform1f(u.FDIM, fdim);
    gl.uniform2f(u.RIB, o.ribbon ?? 0, o.ribbonFreq ?? 0.0022); gl.uniform1f(u.EXOUT, o.explodeOut ? 1 : 0); gl.uniform1f(u.RAD, o.radial ?? 0);
    gl.uniform1f(u.SCL, P.pxs); gl.uniform1f(u.HARD, o.hard ? 1 : 0); gl.uniform1f(u.CLEAD, o.colorLead ?? 0);
    const swp = o.sweep || { gain: 0 }; gl.uniform4f(u.SWEEP, swp.angle ?? 0.6, swp.pos ?? 0, swp.width ?? 120, swp.gain ?? 0);
    const pu = o.pulse || { amp: 0 }, pu2 = o.pulse2 || { amp: 0 };
    gl.uniform4f(u.PULSE, pu.x ?? W / 2, pu.y ?? H / 2, pu.age ?? 0, pu.amp ?? 0); gl.uniform4f(u.PULSE2, pu2.x ?? W / 2, pu2.y ?? H / 2, pu2.age ?? 0, pu2.amp ?? 0);
    P.camUniforms(u);
    gl.uniform1i(u.LINES, o.streak ? 1 : 0);
    gl.bindVertexArray(P.vao);
    const N = Math.min(this.n, o.count ?? this.n);
    if (o.streak) gl.drawArrays(gl.TRIANGLES, 0, N * 6); else gl.drawArrays(gl.POINTS, 0, N);
    // the settled density of shape b, in the layer's density units (sprite footprint ~0.245 * size^2 * alpha):
    // layers normalise their tone map and fill threshold by it, so looks do not depend on count, size or area
    const L = P.inLayer;
    if (L && !o.streak) {
      const sz = (o.size ?? 2) * P.cam.zoom, sv = o.sizeVar ?? 0.4;
      L.ref += N * (o.alpha ?? 0.5) * (o.bright ?? 1) * 0.245 * sz * sz * (1 + sv * 0.5) * (o.hard ? 3.2 : 1) / Bs.area;
    }
    if (prevLayer !== undefined) P.layer(prevLayer);
  }
  // Declarative morph chain keyed to the beat clock:
  //   sw.chain([{ ps | shape, beat, dur = 3.4, order = 'y', flight = 'ribbon', preset, match = true, ...params }], { beats, preset })
  // Step 0 is the start shape. Step i (i > 0) morphs from step i-1 starting at `beat`, for `dur` beats: its point set
  // is matchTo()'d to the previous one along the order's axis ('x' -> columns, else rows), the stagger follows `order`
  // ('y' | 'x' | 'radial' | 'random' | 'key'), and the flight style comes from FLIGHTS. Returns
  //   { at(t) -> params, draw(t, extra), step(t) -> index, shapes }
  // `extra` is an object or (t, params) => object merged on top (per-section modulation: kicks, sweeps, layers).
  chain(steps, { beats, preset = 'silk', ...common } = {}) {
    const spb = beats ? beats.spb : 1;
    let prevPS = null;
    const S = steps.map((st, i) => {
      let id = st.shape, ps = st.ps || null;
      if (id == null) {
        if (!ps) throw new Error('chain: step needs ps or shape');
        if (i > 0 && prevPS && st.match !== false) ps = matchTo(ps, prevPS, { axis: st.order === 'x' ? 'x' : 'y', bands: st.bands ?? 96 });
        id = this.shape(ps);
      }
      prevPS = ps || this.shapes[id].ps;
      return { ...st, id, dur: st.dur ?? 3.4 };
    });
    const stepAt = t => { const b = t / spb; let i = 0; for (let k = 1; k < S.length; k++) if (b >= S[k].beat) i = k; return i; };
    const at = t => {
      const b = t / spb, i = stepAt(t), st = S[i];
      if (i === 0) return this.params({ preset: st.preset || preset, ...common, ...strip(st), a: st.id, b: st.id, u: 1 });
      const prev = S[i - 1], u = clamp((b - st.beat) / st.dur);
      const ord = st.order || 'y';
      // once settled (u = 1) the step holds its own shape (a = b), so explode / ribbon fields key off it
      return this.params({ preset: st.preset || preset, flight: st.flight || 'ribbon', stagger: 0.55, staggerMode: ord,
        ...common, ...strip(st), a: u >= 1 ? st.id : prev.id, b: st.id, u });
    };
    const ch = {
      shapes: S.map(s => s.id), step: stepAt, at,
      draw: (t, extra = {}, o = {}) => {
        const ex = typeof extra === 'function' ? extra : () => extra;
        const pAt = tt => { const p = at(tt); return { ...p, ...ex(tt, p) }; };
        this.draw(t, { ...pAt(t), ...o }, pAt);
      },
    };
    return ch;
  }
}
const strip = st => { const { ps, shape, beat, dur, order, match, bands, id, ...rest } = st; return rest; };
