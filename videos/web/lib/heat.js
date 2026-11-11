// HEAT: the round-one look rebuilt on the GPU. Full-bleed procedural fields read
// through thermal-camera palettes, with melt, freeze-crack, chromatic split,
// slice glitch and scanlines. Every frame is an image, never an empty diagram.
import { W, H, C, clamp, line, rng } from './kit.js';

export const FIELD = { heat: 0, tunnel: 1, die: 2, grid: 3, corridor: 4, lattice: 5, steppe: 6, sun: 7, globe: 8, pour: 9, skyline: 10, crowd: 11 };
export const PAL = { ironbow: 0, infrared: 1, rainbow: 2, ice: 3, turrell: 4 };

const FS = `#version 300 es
precision highp float;
uniform vec2 R; uniform float AUX, HZ, T, BEAT, KICK, MIXV, ZOOM, WARP, MELT, FREEZE, SPLIT, HOT, ROT, SEED;
uniform int FA, FB, PA, PB; uniform float PMIX;
out vec4 o;
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*n2(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return v; }
vec2 vor(vec2 p){ vec2 i=floor(p), f=fract(p); float d1=9., d2=9.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y); vec2 q=g+vec2(h21(i+g),h21(i+g+7.))-f; float d=dot(q,q);
    if(d<d1){ d2=d1; d1=d; } else if(d<d2) d2=d; }
  return vec2(sqrt(d1), sqrt(d2)-sqrt(d1)); }
vec3 lut(int p, float v){ v=clamp(v,0.,1.);
  vec3 c[6];
  if(p==0){ c[0]=vec3(0,0,.04);c[1]=vec3(.16,0,.43);c[2]=vec3(.59,0,.59);c[3]=vec3(.9,.2,.16);c[4]=vec3(1,.67,0);c[5]=vec3(1,1,.9); }
  else if(p==1){ c[0]=vec3(0);c[1]=vec3(.14,0,.03);c[2]=vec3(.36,0,.06);c[3]=vec3(.78,.04,.16);c[4]=vec3(1,.24,.35);c[5]=vec3(1,.86,.84); }
  else if(p==2){ c[0]=vec3(0,0,.16);c[1]=vec3(0,.16,.78);c[2]=vec3(0,.78,.47);c[3]=vec3(.94,.94,0);c[4]=vec3(1,.16,0);c[5]=vec3(1); }
  else if(p==3){ c[0]=vec3(0,.01,.04);c[1]=vec3(.02,.08,.2);c[2]=vec3(.1,.3,.5);c[3]=vec3(.45,.72,.86);c[4]=vec3(.82,.93,1.);c[5]=vec3(1); }
  else { c[0]=vec3(.06,0,.03);c[1]=vec3(.3,0,.08);c[2]=vec3(.6,0,.1);c[3]=vec3(.9,.08,.08);c[4]=vec3(1,.24,.16);c[5]=vec3(1,.5,1); }
  float x=v*5.; int i=int(min(floor(x),4.)); float f=x-float(i);
  vec3 a=c[0],b=c[1];
  for(int k=0;k<5;k++) if(k==i){ a=c[k]; b=c[k+1]; }
  return mix(a,b,f); }
float field(int m, vec2 p, float t){
  if(m==0){ vec2 q=p*1.6; q.y-=t*.9; float w=fbm(q+fbm(q*1.3+t*.2)*WARP*2.);
    return pow(w,1.4)*1.5 - (p.y+1.)*.12; }
  if(m==1){ float r=length(p)+1e-3, a=atan(p.y,p.x); float z=.35/r + t*1.6;
    float ring=smoothstep(.85,1.,fract(z*2.)), spoke=smoothstep(.9,1.,fract(a/6.2831*24.+z*.2));
    float heat=fbm(vec2(a*3.,z*2.)); return clamp(heat*.7+ring*.6+spoke*.4,0.,1.)*smoothstep(0.,.6,r)+ (1.-smoothstep(0.,.25,r))*.9; }
  if(m==2){ vec2 q=p*3.5+vec2(0,t*.3); vec2 g=fract(q)-.5, id=floor(q);
    float cell=step(abs(g.x),.42)*step(abs(g.y),.42); float hot=h21(id+floor(t*1.5)*.1);
    vec2 q2=q*6.; float tr=step(.92,fract(q2.x+(h21(floor(q2))>.5?0.:.5)))+step(.92,fract(q2.y));
    float core=exp(-dot(g,g)*18.)*hot; return clamp(cell*(.25+tr*.25)+core*1.1+fbm(q*2.+t)*.2,0.,1.); }
  if(m==3){ p.y=-p.y; float hz=.1; float y=p.y+hz; if(y>0.){ float s=length(p-vec2(0,.55)); return clamp(.9-s*1.3,0.,1.)*1.+fbm(p*3.+t*.1)*.25*y; }
    float z=1./(-y+.02); vec2 g=vec2(p.x*z, z+t*6.); float ln=max(smoothstep(.93,1.,fract(g.x)),smoothstep(.9,1.,fract(g.y)));
    return clamp(ln*(1.-exp(y*1.2))*1.2+(1.+y)*.35,0.,1.); }
  if(m==4){ float d=max(abs(p.x)*1.25,abs(p.y)); float z=log(d+1e-3)*2.2 - t*1.8; float band=fract(z);
    return clamp(smoothstep(0.,.08,band)*smoothstep(1.,.85,band)*(.45+.55*d)+exp(-d*6.)*.8,0.,1.); }
  if(m==5){ vec2 q=p*3.+vec2(t*.2,-t*.3); vec2 v=vor(q); float edge=1.-smoothstep(0.,.06,v.y); float node=exp(-v.x*v.x*60.);
    return clamp(edge*.55+node*1.2+fbm(q+t)*.25,0.,1.); }
  if(m==6){ p.y=-p.y; float hz=-.2+HZ; if(p.y>hz){ float c=fbm(vec2(p.x*1.4-t*.15,p.y*4.))*1.1; float glow=exp(-(p.y-hz)*5.); return clamp(c*.6+glow*.75+.1,0.,1.); }
    float d=hz-p.y; float gr=fbm(vec2(p.x*9./(d+.05)+t*3.,d*30.)); return clamp(gr*.5*exp(-d*2.)+exp(-d*14.)*.5,0.,1.); }
  if(m==8){ float R0=.62; float r=length(p); if(r>R0){ return exp(-(r-R0)*9.)*.55; }
    vec3 n=vec3(p/R0, sqrt(max(0.,1.-dot(p,p)/(R0*R0)))); float lon=atan(n.x,n.z)+t*.35, lat=asin(n.y);
    vec2 g=vec2(lon*3.8197, lat*5.7); vec2 id=floor(g*2.), f=fract(g*2.)-.5;
    float land=smoothstep(.42,.56,fbm(vec2(lon*1.4,lat*2.2)+3.)); float grid=max(smoothstep(.96,1.,fract(g.x)),smoothstep(.96,1.,fract(g.y)))*.35;
    float base=step(.86,h21(id))*step(AUX,h21(id+11.))*land; float dot_=exp(-dot(f,f)*40.)*base*(0.8+.4*sin(t*9.+h21(id)*30.));
    return clamp(.15+land*.5*n.z+grid+dot_*1.6,0.,1.); }
  if(m==9){ float w=.07+.02*sin(p.y*9.-t*6.); float x=p.x+.03*sin(p.y*4.+t*3.); float stream=exp(-x*x/(w*w))*step(-.95,p.y);
    float flow=fbm(vec2(x*20.,p.y*6.-t*8.)); float pool=exp(-max(0.,p.y-.6)*0.)*smoothstep(.55,.75,p.y)*(.6+.4*fbm(vec2(p.x*4.,t)))*exp(-abs(p.x)*1.2);
    vec2 sp=vec2(p.x*14.,p.y*14.+t*9.); vec2 si=floor(sp); float spark=step(.93,h21(si))*exp(-dot(fract(sp)-.5,fract(sp)-.5)*60.)*smoothstep(1.2,.2,length(p-vec2(0,.65)));
    return clamp(stream*(.75+.35*flow)+pool+spark*1.2+fbm(p*2.+t*.1)*.12,0.,1.); }
  if(m==10){ float gy=.55-AUX*.25; float sky=clamp(.35-(p.y+1.)*.12+fbm(vec2(p.x*2.,p.y*3.-t*.2))*.25,0.,1.);
    float col=floor(p.x*9.+40.); float hgt=gy-(.25+h21(vec2(col,1.))*.9)*(0.4+AUX*.9); float c=sky;
    if(p.y>hgt){ vec2 wv=vec2(p.x*9.*6., p.y*28.); float win=step(.35,fract(wv.x))*step(.4,fract(wv.y))*step(.35,h21(floor(wv)+col+floor(t*2.)*.0));
      c=.08+win*(.7+.3*sin(t*2.+col)); }
    return clamp(c,0.,1.); }
  if(m==11){ float c=fbm(p*2.+t*.1)*.18*(1.-smoothstep(-.2,.6,p.y)); float occ=0.;
    for(int k=6;k>=0;k--){ float fk=float(k); float row=-.05+fk*.17-AUX*.35; float sc=.05+fk*.035;
      vec2 q=vec2((p.x+fk*.41+sin(t*.7+fk)*.02)/sc, (p.y-row)/sc); vec2 id=vec2(floor(q.x),fk); vec2 f=vec2(fract(q.x)-.5,q.y);
      f.x+=(h21(id)-.5)*.25; f.y+=(h21(id+5.)-.5)*.3+sin(t*6.+h21(id)*20.)*.04;
      float head=smoothstep(.2,.14,length(f-vec2(0.,-.62)));
      float wdt=.2+.22*smoothstep(-.42,-.05,f.y); float body=smoothstep(wdt,wdt-.05,abs(f.x))*step(-.42,f.y);
      float m_=max(head,body); float heatv=(.55+.35*h21(id+3.))*(.45+fk*.09)+head*.25;
      if(occ<.5 && m_>.5){ c=heatv*(1.-.3*smoothstep(0.,1.4,f.y)); occ=1.; } }
    return clamp(c,0.,1.); }
  float s=length(p-vec2(0,.1)); float rays=pow(abs(sin(atan(p.y-.1,p.x)*14.+t*.6)),8.)*.5;
  return clamp(1.1-s*1.1+rays*(1.-s)+fbm(p*4.-t)*.2,0.,1.);
}
float scene(vec2 p, float t){
  float a=field(FA,p,t);
  if(MIXV>0.) a=mix(a, field(FB,p,t+3.), MIXV);
  return a;
}
void main(){
  vec2 uv=gl_FragCoord.xy/R; vec2 p=(uv*2.-1.); p.x*=R.x/R.y; p.y=-p.y;
  float cr=cos(ROT), sr=sin(ROT); p=mat2(cr,-sr,sr,cr)*p; p/=ZOOM;
  if(MELT>0.){ float d=pow(fbm(vec2(uv.x*7.,1.3)),2.)*1.2+.15*n2(vec2(uv.x*40.,2.)); p.y-=MELT*d*1.6; p.x+=MELT*.03*sin(p.y*5.+T*2.); }
  float t=T+SEED;
  float v=scene(p,t)*(1.+HOT)+KICK*.18;
  float vr=v, vb=v;
  if(SPLIT>0.){ vr=scene(p+vec2(SPLIT,0.),t)*(1.+HOT)+KICK*.18; vb=scene(p-vec2(SPLIT,0.),t)*(1.+HOT)+KICK*.18; }
  vec3 c1=vec3(lut(PA,vr).r, lut(PA,v).g, lut(PA,vb).b);
  vec3 c=c1;
  if(PMIX>0.){ vec3 c2=vec3(lut(PB,vr).r, lut(PB,v).g, lut(PB,vb).b); c=mix(c1,c2,PMIX); }
  if(FREEZE>0.){ vec2 vv=vor(p*4.+7.); float crack=1.-smoothstep(0.,.025+.02*FREEZE,vv.y);
    c=mix(c, lut(3, v*.9+.1), FREEZE); c=mix(c, vec3(1.), crack*FREEZE*.9); }
  c*=.92+.08*sin(gl_FragCoord.y*1.7);
  o=vec4(c,1.);
}`;

export class Heat {
  constructor(scale = 0.5) {
    this.cv = document.createElement('canvas');
    this.cv.width = Math.round(W * scale); this.cv.height = Math.round(H * scale);
    const gl = this.gl = this.cv.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = this.pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, `#version 300 es
in vec2 a; void main(){ gl_Position=vec4(a,0,1); }`));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr); gl.useProgram(pr);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['AUX', 'HZ', 'R', 'T', 'BEAT', 'KICK', 'MIXV', 'ZOOM', 'WARP', 'MELT', 'FREEZE', 'SPLIT', 'HOT', 'ROT', 'SEED', 'FA', 'FB', 'PA', 'PB', 'PMIX'])
      this.u[n] = gl.getUniformLocation(pr, n);
  }
  // o: {field, fieldB, mix, pal, palB, palMix, zoom, warp, melt, freeze, split, hot, rot, seed, kick}
  draw(ctx, t, o = {}) {
    this.shade(t, o);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.cv, 0, 0, W, H);
  }
  // Render once and share: returns a small 2D canvas (scale x full frame) holding this frame's field.
  // The WebGL read-back happens once here; draw the result as often as needed with
  // ctx.drawImage(tex, 0, 0, W, H) (background, every masked word, ...). Never call draw() twice a frame.
  // Cost notes: SPLIT > 0 evaluates the field 3x and MIX > 0 evaluates two fields; leave both 0 when unused.
  render(t, o = {}) {
    this.shade(t, o);
    if (!this.tex) { this.tex = document.createElement('canvas'); this.tex.width = this.cv.width; this.tex.height = this.cv.height;
      this.texg = this.tex.getContext('2d', { willReadFrequently: true }); }
    this.texg.drawImage(this.cv, 0, 0);
    return this.tex;
  }
  shade(t, o = {}) {
    const gl = this.gl, u = this.u;
    gl.viewport(0, 0, this.cv.width, this.cv.height);
    gl.uniform2f(u.R, this.cv.width, this.cv.height);
    gl.uniform1f(u.T, t); gl.uniform1f(u.KICK, o.kick || 0);
    gl.uniform1i(u.FA, o.field ?? 0); gl.uniform1i(u.FB, o.fieldB ?? 0); gl.uniform1f(u.MIXV, o.mix || 0);
    gl.uniform1i(u.PA, o.pal ?? 0); gl.uniform1i(u.PB, o.palB ?? 0); gl.uniform1f(u.PMIX, o.palMix || 0);
    gl.uniform1f(u.ZOOM, o.zoom || 1); gl.uniform1f(u.WARP, o.warp ?? 1); gl.uniform1f(u.MELT, o.melt || 0);
    gl.uniform1f(u.FREEZE, o.freeze || 0); gl.uniform1f(u.SPLIT, o.split || 0); gl.uniform1f(u.HOT, o.hot || 0);
    gl.uniform1f(u.ROT, o.rot || 0); gl.uniform1f(u.HZ, o.hz || 0); gl.uniform1f(u.AUX, o.aux || 0); gl.uniform1f(u.SEED, o.seed || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.cv;
  }
}

// Slice glitch: shift horizontal bands of the finished frame.
const _g = document.createElement('canvas'); _g.width = W; _g.height = H; const _gc = _g.getContext('2d');
export function sliceGlitch(ctx, amt, seed, n = 10) {
  if (amt <= 0) return;
  _gc.clearRect(0, 0, W, H); _gc.drawImage(ctx.canvas, 0, 0);
  const r = rng(seed | 0);
  for (let i = 0; i < n; i++) {
    const y = r() * H, h = 8 + r() * 120, dx = (r() - 0.5) * 2 * amt * 160;
    ctx.drawImage(_g, 0, y, W, h, dx, y, W, h);
  }
}

// Punch text: one huge line with red/cyan ghosts that snap together on the hit.
export function punch(ctx, str, age, { y = 1000, size = 260, color = '#ffffff', ghost = 1, family = 'Anton', stroke = 16, jitter = 0, seed = 1 } = {}) {
  if (age < 0) return;
  const k = Math.exp(-age * 9);
  const s = size * (1 + 0.35 * k);
  const off = (18 + 60 * k) * ghost;
  const r = rng(seed + Math.floor(age * 30));
  const jx = (r() - 0.5) * jitter * 30, jy = (r() - 0.5) * jitter * 12;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  line(ctx, str, W / 2 - off + jx, y + jy, { family, size: s, color: 'rgba(255,0,40,0.85)', maxW: W - 70 });
  line(ctx, str, W / 2 + off + jx, y + jy, { family, size: s, color: 'rgba(0,230,255,0.6)', maxW: W - 70 });
  ctx.restore();
  line(ctx, str, W / 2 + jx, y + jy, { family, size: s, color, stroke, strokeColor: '#0b0303', maxW: W - 70 });
}

// Thermal scale bar on the right edge, like a FLIR viewfinder.
export function scaleBar(ctx, pal, hi, lo) {
  const x = W - 70, y0 = 380, h = 900;
  const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
  const stops = { ironbow: ['#fffff0', '#ffaa00', '#e53228', '#960096', '#29006e', '#00000a'],
    infrared: ['#ffdcd6', '#ff3c5a', '#c80a28', '#5c000f', '#240008', '#000'],
    ice: ['#fff', '#d1edff', '#73b8db', '#1a4d80', '#051433', '#00030a'],
    rainbow: ['#fff', '#ff2800', '#f0f000', '#00c878', '#0028c8', '#000028'] }[pal] || [];
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = g; ctx.fillRect(x, y0, 26, h);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x, y0, 26, h);
  line(ctx, hi, x + 13, y0 - 20, { family: 'Plex Mono', size: 30, color: '#fff' });
  line(ctx, lo, x + 13, y0 + h + 44, { family: 'Plex Mono', size: 30, color: '#fff' });
}

// a rider as a heat signature (hot = true) or a silhouette on a burning sky
export function horseman(ctx, x, y, sc, ph, flag, col) {
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc); ctx.fillStyle = ctx.strokeStyle = col;
  const bob = Math.sin(ph * 2) * 3, B0 = -60 + bob;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [lx, o, hind] of [[-32, 0, 1], [-24, 0.45, 0], [28, 1.6, 1], [36, 2.05, 0]]) {
    const q = Math.sin(ph + o * 1.2), kx = lx + q * 16, ky = B0 + 30, fx = kx + (hind ? -10 : 12) + q * 12, fy = Math.min(0, B0 + 62 - Math.max(0, q) * 10);
    ctx.lineWidth = 11; ctx.beginPath(); ctx.moveTo(lx, B0 + 4); ctx.lineTo(kx, ky); ctx.stroke();
    ctx.lineWidth = 5.5; ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke(); }
  ctx.beginPath();
  ctx.moveTo(-46, B0 - 6); ctx.bezierCurveTo(-40, B0 - 22, 20, B0 - 22, 38, B0 - 16);
  ctx.bezierCurveTo(56, B0 - 30, 64, B0 - 50, 70, B0 - 56); ctx.lineTo(76, B0 - 62); ctx.lineTo(80, B0 - 55);
  ctx.bezierCurveTo(88, B0 - 46, 96, B0 - 32, 98, B0 - 26); ctx.lineTo(90, B0 - 22);
  ctx.bezierCurveTo(80, B0 - 30, 70, B0 - 30, 58, B0 - 8); ctx.bezierCurveTo(52, B0 + 10, 30, B0 + 16, 0, B0 + 14);
  ctx.bezierCurveTo(-30, B0 + 16, -50, B0 + 10, -46, B0 - 6); ctx.fill();
  ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-44, B0 - 8); ctx.bezierCurveTo(-64, B0 - 12, -74, B0 + 4, -86, B0 + 2 + Math.sin(ph) * 8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-8, B0 - 14); ctx.lineTo(-18, B0 - 50); ctx.lineTo(0, B0 - 56); ctx.lineTo(14, B0 - 16); ctx.fill();
  ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-4, B0 - 46); ctx.lineTo(30, B0 - 34); ctx.lineTo(56, B0 - 42); ctx.stroke();
  ctx.beginPath(); ctx.arc(-4, B0 - 68, 10, 0, 7); ctx.fill();
  ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-2, B0 - 16); ctx.lineTo(8, B0 + 8); ctx.stroke();
  if (flag) { ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(-12, B0 - 30); ctx.lineTo(-30, B0 - 170); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = '#e0101e'; ctx.beginPath(); ctx.moveTo(-30, B0 - 170);
    for (let i = 0; i <= 8; i++) ctx.lineTo(-30 - i * 10, B0 - 170 + Math.sin(ph * 1.5 - i * 0.7) * 7 + i);
    for (let i = 8; i >= 0; i--) ctx.lineTo(-30 - i * 10, B0 - 134 + Math.sin(ph * 1.5 - i * 0.7) * 7 + i);
    ctx.fill(); }
  ctx.restore();
}
// density 1: a line on the ridge; 2: a wave; 3: the horde fills the plain; 4: giant silhouettes
export function riders(ctx, B, t, dens, hot, horizon, seed = 0) {
  const r = rng(dens * 11 + 3 + seed), n = [0, 12, 16, 26, 4][dens];
  const kick = Math.max(B.env('kick', t, 12), B.env('taiko', t, 9));
  const list = [];
  for (let i = 0; i < n; i++) {
    const depth = dens === 4 ? 2.4 + r() * 1.2 : dens === 1 ? 0.3 + r() * 0.15 : 0.35 + r() * (dens === 3 ? 1.5 : 1.0);
    const speed = (180 + r() * 120) * depth, span = W + 1100 * depth;
    const x = ((r() * span + t * speed) % span) - 550 * depth;
    list.push({ depth, x, ph: t * 15 * (0.9 + r() * 0.2) + i * 1.7, flag: r() < 0.2 });
  }
  list.sort((a, b) => a.depth - b.depth);
  for (const q of list) {
    const y = horizon + (q.depth - 0.3) * 640 - kick * 14 * q.depth;
    ctx.save();
    if (hot) { ctx.shadowColor = '#ffdca0'; ctx.shadowBlur = 30 * q.depth; }
    horseman(ctx, q.x, y, 2.3 * q.depth, q.ph, q.flag, hot ? '#fff6e0' : '#0d0002');
    ctx.restore();
  }
}

