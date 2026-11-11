// particles/flow: GPGPU particle flow (RGBA32F ping-pong state) with feedback trails, deterministic in t by replay
// from automatic checkpoints.
//   const fl = new Flow(P, { side: 512, t0: 0, spawn, target, trail: 0.9, every: 8, cache: 'scene.genesis' });
//   await fl.render(t, tt => simParams, tt => drawParams);     // steps / restores / replays to t, then draws
//   await fl.advance(t, simAt);                                // sim only (e.g. before a snapshot() handoff)
//
// Determinism: state(f) = step^f(state0). Every `every` frames the state (and the trail buffer, when trails are on)
// is checkpointed: in memory (LRU) and, with `cache`, on disk under out/.pcache/flow/<cache>/. Any render at frame f,
// a jump or the next sequential frame, continues from the latest valid point <= f (the current frame or the nearest
// checkpoint) through the same step + trail code, so a jump and a sequential render are bit-identical (there is no
// trail window approximation any more). A checkpoint's name carries a hash chain of the flow's sources, its input
// point sets and every sim/draw param value up to that frame, so editing a param at frame f only invalidates
// checkpoints from f on, and a stale checkpoint is never restored.
// Requirement: `at` and `draw` are pure functions of t (camera included, via draw(tt).cam).
import { W, H } from '../../kit.js';
import { COMMON, PROJ, SPRITE_FS, hashStr, hashBytes, stableKey, disk, toHalf } from './core.js';
import { resize, reorder } from './samplers.js';

const SIM_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
in vec2 uv; out vec4 o;
uniform sampler2D S, SP, TG; uniform int SIDE, HAS_SP, HAS_TG; uniform uint STEP, SEED;
uniform float T, DT, FREQ, SPEED, AMP, ATT, VORT, LIFE, DRAG, JIT;
uniform vec2 VC, WIND;
${COMMON}
vec4 spawnAt(int id, uint gen){
  vec4 r=h4(uint(id)*2654435761u ^ gen*97u ^ SEED);
  if(HAS_SP==1){ ivec2 tc=ivec2(hu(uint(id)+gen*7919u)%uint(SIDE), hu(uint(id)*3u+gen)%uint(SIDE)); vec4 s=texelFetch(SP,tc,0);
    return vec4(s.xyz+(r.xyz-.5)*vec3(JIT,JIT,JIT), .3+.7*r.w); }
  return vec4(r.x*${W}., r.y*${H}., (r.z-.5)*800., .3+.7*r.w);
}
void main(){
  ivec2 tc=ivec2(gl_FragCoord.xy); int id=tc.y*SIDE+tc.x;
  vec4 s=texelFetch(S,tc,0);
  if(STEP==0u){ o=spawnAt(id, uint(id%97)); o.w=fract(h4(uint(id)).x); return; }
  vec3 p=s.xyz; float life=s.w;
  vec3 v=curl(p, T*SPEED, FREQ)*AMP;
  vec2 d=p.xy-VC; float L=length(d)+1.; v.xy+=vec2(-d.y,d.x)/L*VORT*exp(-L/900.) - d/L*VORT*.15*exp(-L/900.);
  v.xy+=WIND;
  if(HAS_TG==1 && ATT>0.){ vec3 g=texelFetch(TG,tc,0).xyz; vec3 dg=g-p; v+=dg*ATT*(.6+.4*fract(float(id)*.618)); }
  p+=v*DT;
  life-=DT/LIFE*(.5+fract(float(id)*.7548));
  if(life<0. || p.y<-400. || p.y>${H + 400}. || p.x<-500. || p.x>${W + 500}.) { o=spawnAt(id, STEP); return; }
  o=vec4(p,life);
}`;
// draw: colour from the spawn texel (spawnColor), a c0..c1 random mix, or a position-keyed ramp (color: {by, ...})
const PTS_VS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D S, SC; uniform int SIDE, HAS_SC, CBY; uniform float SIZE, BRIGHT, DOF, FOCUS, ALPHA, SCL, CR, CJ;
uniform vec3 C0, C1, CS0, CS1, CS2, CS3; uniform vec2 CCEN;
${PROJ}
${COMMON}
out vec4 vC; out float vB;
vec3 ramp4(float k){ k=clamp(k,0.,1.)*3.; return k<1. ? mix(CS0,CS1,k) : k<2. ? mix(CS1,CS2,k-1.) : mix(CS2,CS3,k-2.); }
void main(){
  int id=gl_VertexID; ivec2 tc=ivec2(id%SIDE, id/SIDE); vec4 s=texelFetch(S,tc,0);
  vec4 pr=project(s.xyz); vec4 r=h4(uint(id)+5u);
  float fade=smoothstep(0.,.15,s.w)*smoothstep(1.,.85,s.w);
  vec3 col;
  if(CBY>0){
    vec2 d=s.xy-CCEN; float k = CBY==1 ? length(d*vec2(1.,1.12))/CR : CBY==2 ? d.y/CR*.5+.5 : CBY==3 ? d.x/CR*.5+.5 : s.w;
    col=ramp4(k+(r.z-.5)*CJ);
  } else col = HAS_SC==1 ? texelFetch(SC, ivec2(hu(uint(id)*7u+1u)%uint(SIDE), hu(uint(id)*3u)%uint(SIDE)),0).rgb : mix(C0, C1, pow(r.x,2.));
  float sz=SIZE*pr.w*(.6+r.y*.8); float blur=DOF*abs(pr.z-FOCUS)/CAM.x; float S_=clamp(sz*(1.+blur*6.),1.,40.);
  gl_Position=vec4(pr.xy,0.,1.); gl_PointSize=S_*SCL;
  vC=vec4(col, ALPHA*BRIGHT*fade*min(1.,sz*sz/(S_*S_)*1.6)*(pr.z<30.?0.:1.)); vB=clamp(blur*3.,0.,1.);
}`;
const BY = { radius: 1, y: 2, x: 3, life: 4 };

export class Flow {
  constructor(P, { side = 512, t0 = 0, fps = 30, sub = 2, spawn = null, target = null, trail = 0.88, seed = 1, trailScale = 0.5,
    every = 8, cache = null, memMB = 96 } = {}) {
    this.P = P; this.side = side; this.n = side * side; this.t0 = t0; this.fps = fps; this.sub = sub; this.seed = seed;
    this.trail = trail; this.every = every; this.cache = cache; this.memMB = memMB;
    const gl = P.gl;
    this.st = [P.target(side, side, gl.RGBA32F), P.target(side, side, gl.RGBA32F)];
    this.cur = 0; this.frame = -1; this.trailOk = false;
    const sp = spawn ? resize(spawn, this.n) : null;
    this.spawn = sp ? P.dataTex(side, side, sp.pos, true) : null;
    this.spawnCol = sp ? P.dataTex(side, side, sp.col, false) : null;
    this.targets = []; this._inKey = sp ? hashBytes(sp.pos) + hashBytes(sp.col) : '-';
    if (target) this.addTarget(target);
    const tw = Math.round(P.canvas.width * trailScale), th = Math.round(P.canvas.height * trailScale);
    this.tr = [P.target(tw, th, gl.RGBA16F), P.target(tw, th, gl.RGBA16F)]; this.tc = 0;
    this.sim = P.program('flowsim', P.quadVS, SIM_FS);
    this.pts = P.program('flowpts', PTS_VS, SPRITE_FS);
    this.fade = P.program('fade', P.quadVS, `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D S; uniform float K; uniform vec2 DRIFT;
void main(){ o=vec4(texture(S,uv+DRIFT).rgb*K,1.); }`);
    this.blit = P.program('blitadd', P.quadVS, `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D S; uniform float G;
void main(){ o=vec4(texture(S,uv).rgb*G,1.); }`);
    this.mem = new Map(); this.memBytes = 0; this.diskSet = null;
    this.hS = []; this.hT = []; this._atSig = null; this._drSig = null;
    this.stats = { restores: 0, diskLoads: 0, saves: 0, steps: 0 };
    (globalThis.__flows ||= []).push(this);          // tools/particles_determinism.mjs drops the memory checkpoints
  }
  addTarget(ps) { const r = resize(ps, this.n); const t = this.P.dataTex(this.side, this.side, r.pos, true); this.targets.push(t); this._inKey += hashBytes(r.pos); this.hS = []; this.hT = []; return this.targets.length - 1; }
  get base() {
    return this._base || (this._base = hashStr([SIM_FS, PTS_VS, SPRITE_FS, this.side, this.t0, this.fps, this.sub, this.seed, this.trail,
      this.tr[0].w, this.tr[0].h, this._inKey].join('|')));
  }
  // ---------- hash chains (sim params -> state; + draw params -> trail)
  _sKey(f, at) {
    const sig = at.toString(); if (sig !== this._atSig) { this._atSig = sig; this.hS = []; this.hT = []; }
    for (let k = this.hS.length; k <= f; k++) this.hS[k] = hashStr((k ? this.hS[k - 1] : this.base) + stableKey(at(this.t0 + k / this.fps)));
    return 's' + f + '_' + this.hS[f];
  }
  _tKey(f, at, D) {
    this._sKey(f, at);
    const sig = D.toString(); if (sig !== this._drSig) { this._drSig = sig; this.hT = []; }
    for (let k = this.hT.length; k <= f; k++) this.hT[k] = hashStr((k ? this.hT[k - 1] : this.base + 'T') + this.hS[k] + stableKey(D(this.t0 + k / this.fps)));
    return 't' + f + '_' + this.hT[f];
  }
  // ---------- checkpoint store
  _memPut(key, data) {
    if (this.mem.has(key)) return;
    this.mem.set(key, data); this.memBytes += data.byteLength;
    for (const [k, v] of this.mem) { if (this.memBytes <= this.memMB * 1048576 || this.mem.size <= 2) break; this.mem.delete(k); this.memBytes -= v.byteLength; }
  }
  async _get(key, type) {
    let d = this.mem.get(key);
    if (d) { this.mem.delete(key); this.mem.set(key, d); return d; }         // LRU touch
    if (!this.cache) return null;
    if (!this.diskSet) this.diskSet = new Set(await disk.list('flow/' + this.cache));
    if (!this.diskSet.has(key + '.bin')) return null;
    const ab = await disk.get(`flow/${this.cache}/${key}.bin`); if (!ab) return null;
    d = type === 'f16' ? new Uint16Array(ab) : new Float32Array(ab);
    this.stats.diskLoads++; this._memPut(key, d); return d;
  }
  async _restore(c, at, D) {
    const ks = this._sKey(c, at), kt = D ? this._tKey(c, at, D) : null;
    const s = await this._get(ks, 'f32'); if (!s || s.length !== this.n * 4) return false;
    let tr = null; if (kt) { tr = await this._get(kt, 'f16'); if (!tr || tr.length !== this.tr[0].w * this.tr[0].h * 4) return false; }
    this.P.upload(this.st[this.cur], s);
    if (tr) this.P.upload(this.tr[this.tc], tr);
    this.frame = c; this.trailOk = !!D; this.stats.restores++;
    return true;
  }
  _save(f, at, D) {
    const P = this.P, gl = P.gl;
    const ks = this._sKey(f, at);
    const put = (key, data) => { this._memPut(key, data); this.stats.saves++;
      if (this.cache && this.diskSet && !this.diskSet.has(key + '.bin')) { this.diskSet.add(key + '.bin'); disk.put(`flow/${this.cache}/${key}.bin`, data); } };
    if (!this.mem.has(ks) && !(this.diskSet && this.diskSet.has(ks + '.bin'))) {
      P.bind(this.st[this.cur]); const s = new Float32Array(this.n * 4); gl.readPixels(0, 0, this.side, this.side, gl.RGBA, gl.FLOAT, s); put(ks, s);
    }
    if (D) {
      const kt = this._tKey(f, at, D);
      if (!this.mem.has(kt) && !(this.diskSet && this.diskSet.has(kt + '.bin'))) {
        const t = this.tr[this.tc]; P.bind(t); const px = new Float32Array(t.w * t.h * 4); gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, px); put(kt, toHalf(px));
      }
    }
  }
  // ---------- stepping
  _step(frame, k, prm) {
    const P = this.P, gl = P.gl, u = P.use(this.sim);
    const src = this.st[this.cur], dst = this.st[1 - this.cur];
    P.bind(dst); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    P.tex(0, src.tex); gl.uniform1i(u.S, 0);
    if (this.spawn) { P.tex(1, this.spawn); gl.uniform1i(u.SP, 1); } gl.uniform1i(u.HAS_SP, this.spawn ? 1 : 0);
    const tg = prm.target != null ? this.targets[prm.target] : null;
    if (tg) { P.tex(2, tg); gl.uniform1i(u.TG, 2); } gl.uniform1i(u.HAS_TG, tg ? 1 : 0);
    const step = frame < 0 ? 0 : frame * this.sub + k + 1;
    gl.uniform1i(u.SIDE, this.side); gl.uniform1ui(u.STEP, step); gl.uniform1ui(u.SEED, this.seed);
    gl.uniform1f(u.T, this.t0 + (frame + k / this.sub) / this.fps); gl.uniform1f(u.DT, 1 / (this.fps * this.sub));
    gl.uniform1f(u.FREQ, prm.freq ?? 0.003); gl.uniform1f(u.SPEED, prm.flowSpeed ?? 0.3); gl.uniform1f(u.AMP, prm.amp ?? 120);
    gl.uniform1f(u.ATT, prm.attract ?? 0); gl.uniform1f(u.VORT, prm.vortex ?? 0); gl.uniform1f(u.LIFE, prm.life ?? 4);
    gl.uniform1f(u.JIT, prm.jitter ?? 6); const vc = prm.center || [W / 2, H / 2]; gl.uniform2f(u.VC, vc[0], vc[1]);
    const wd = prm.wind || [0, 0]; gl.uniform2f(u.WIND, wd[0], wd[1]);
    P.quad(); this.cur = 1 - this.cur;
  }
  _stepFrame(f, at) {
    const prm = at(this.t0 + f / this.fps);
    if (f === 0) this._step(-1, 0, prm);
    for (let k = 0; k < this.sub; k++) this._step(f, k, prm);
    this.frame = f; this.stats.steps++;
  }
  _drawTrail(D, f) {
    const P = this.P, gl = P.gl, o = D(this.t0 + f / this.fps);
    if (o.cam) P.setCamera(o.cam);
    const src = this.tr[this.tc], dst = this.tr[1 - this.tc];
    if (f === 0) for (const tr of this.tr) { P.bind(tr); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    const u = P.use(this.fade); P.bind(dst); gl.disable(gl.BLEND); P.tex(0, src.tex); gl.uniform1i(u.S, 0);
    gl.uniform1f(u.K, o.trail ?? this.trail); const dr = o.drift || [0, 0]; gl.uniform2f(u.DRIFT, dr[0] / W, -dr[1] / H); P.quad();
    this._points(dst, o);
    this.tc = 1 - this.tc;
  }
  _points(tgt, o) {
    const P = this.P, gl = P.gl, u = P.use(this.pts);
    P.bind(tgt); P.blend('add');
    P.tex(0, this.st[this.cur].tex); gl.uniform1i(u.S, 0);
    const sc = this.spawnCol && o.spawnColor; if (sc) { P.tex(1, this.spawnCol); gl.uniform1i(u.SC, 1); } gl.uniform1i(u.HAS_SC, sc ? 1 : 0);
    gl.uniform1i(u.SIDE, this.side); gl.uniform1f(u.SIZE, o.size ?? 1.5); gl.uniform1f(u.BRIGHT, o.bright ?? 1); gl.uniform1f(u.ALPHA, o.alpha ?? 0.25);
    gl.uniform1f(u.DOF, o.dof ?? 0); gl.uniform1f(u.FOCUS, o.focus ?? P.cam.f); gl.uniform1f(u.SCL, P.pxs);
    const c0 = o.c0 || [1, 0.15, 0.1], c1 = o.c1 || [1, 0.85, 0.7]; gl.uniform3f(u.C0, ...c0); gl.uniform3f(u.C1, ...c1);
    const cb = o.color || null; gl.uniform1i(u.CBY, cb ? BY[cb.by || 'radius'] : 0);
    if (cb) { const st = cb.stops, c = cb.center || [W / 2, H / 2]; gl.uniform2f(u.CCEN, c[0], c[1]); gl.uniform1f(u.CR, cb.r ?? 900); gl.uniform1f(u.CJ, cb.jitter ?? 0.1);
      for (let i = 0; i < 4; i++) gl.uniform3f(u['CS' + i], ...st[Math.min(i, st.length - 1)]); }
    P.camUniforms(u);
    gl.bindVertexArray(P.vao); gl.drawArrays(gl.POINTS, 0, Math.min(this.n, o.count ?? this.n));
  }
  // Bring the state (and the trail, when D is given) to frame f: continue from the current frame, or restore the
  // nearest checkpoint, or start from frame 0; then step through the same code a sequential render runs.
  async _reach(f, at, D) {
    const K = this.every;
    let start = this.frame >= 0 && this.frame <= f && (!D || this.trailOk) ? this.frame : -1;
    for (let c = Math.floor(f / K) * K; c > Math.max(start, 0); c -= K) if (await this._restore(c, at, D)) { start = c; break; }
    if (start < 0) { this._stepFrame(0, at); if (D) this._drawTrail(D, 0); start = 0; this.trailOk = !!D; }
    for (let fr = start + 1; fr <= f; fr++) {
      this._stepFrame(fr, at);
      if (D) this._drawTrail(D, fr); else this.trailOk = false;
      if (fr % K === 0) { if (this.cache && !this.diskSet) this.diskSet = new Set(await disk.list('flow/' + this.cache)); this._save(fr, at, D); }
    }
  }
  frameOf(t) { return Math.max(0, Math.round((t - this.t0) * this.fps)); }
  // Sim only (no trail): for handoffs (snapshot) and warm-up.
  async advance(t, at) { const cam = { ...this.P.cam }; await this._reach(this.frameOf(t), at, null); this.P.cam = cam; }
  // Advance / restore / replay to t, then draw. at(t) -> sim params {amp, freq, flowSpeed, attract, target, vortex,
  // center, wind, life, jitter}. draw: object or tt => object {size, alpha, bright, color: {by: 'radius'|'y'|'x'|'life',
  // center, r, stops: [rgb x 2..4], jitter} | spawnColor | c0, c1, dof, focus, trail (decay per frame; 0 = none),
  // trailGain, drift [px/frame], heads (also draw crisp full-res points), headCount, over, cam}.
  async render(t, at, draw = {}) {
    const P = this.P, gl = P.gl, t0 = performance.now(), steps0 = this.stats.steps;
    const D = typeof draw === 'function' ? draw : () => draw;
    const o = D(t), camNow = { ...P.cam }, hdr = P.hdr;
    const useTrail = (o.trail ?? this.trail) > 0;
    await this._reach(this.frameOf(t), at, useTrail ? D : null);
    P.cam = camNow; if (o.cam) P.setCamera(o.cam); P.hdr = hdr;
    if (useTrail) {
      if (o.over) {
        const u = P.use(this.blit); P.bind(P.hdr); P.blend('add'); gl.disable(gl.DEPTH_TEST);
        P.tex(0, this.tr[this.tc].tex); gl.uniform1i(u.S, 0); gl.uniform1f(u.G, o.trailGain ?? 1); P.quad();
      } else P.under(this.tr[this.tc].tex, o.trailGain ?? 1);
    }
    if (!useTrail || (o.heads ?? 0) > 0) this._points(P.hdr, { ...o, alpha: (o.alpha ?? 0.25) * (useTrail ? o.heads : 1), count: o.headCount ?? o.count });
    const L = P.inLayer; if (L && o.ref) L.ref += o.ref;
    this.lastMs = performance.now() - t0; this.lastSteps = this.stats.steps - steps0;
  }
  // Copy the current state positions out as a PointSet (e.g. to hand the flow over to a Swarm exactly).
  snapshot(order = 'none') {
    const P = this.P, gl = P.gl; P.bind(this.st[this.cur]);
    const pos = new Float32Array(this.n * 4); gl.readPixels(0, 0, this.side, this.side, gl.RGBA, gl.FLOAT, pos);
    const col = new Uint8Array(this.n * 4).fill(255);
    return reorder({ n: this.n, pos, col }, order);
  }
}
