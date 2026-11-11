// PRINTLAB: physically grounded film stocks and print processes for the renderer (the PRINT AND FILM LAB studio, c1).
// The same data files drive videos/engine/printlab (Python, stills and plates); tools/printlab/parity.mjs checks that
// both sides agree on the chart. Nothing here applies itself: a scene calls it, with the physical knobs it wants.
//
//   import { PrintLab, setType } from '../lib/printlab.js';
//   const lab = await PrintLab.create();                       // or PrintLab.create({ print }) to share a Print's GL context
//   await lab.stock('kodachrome25');                           // fetches web/lib/printlab/data/film/kodachrome25.json
//   lab.film(ctx, sourceCanvas, 'kodachrome25', { frame, gauge: '16mm', exposure: 0, grain: 1, decay: 0 });
//
//   const cam = { view_mm: 160, x_mm: 0, y_mm: 0 };            // the frame is a camera on the sheet (mm across)
//   const sheet = lab.paper('book1874', cam, 3);               // a target: linear reflectance + paper height
//   const forme = setType([{ text: 'WOOD', x_mm: 14, base_mm: 70, lines: 9, face: 'UltraPL' }], cam);   // 2D canvas: R face, G relief, B figure
//   lab.letterpress(sheet, forme, { ink: 'black1874', pressure: 0.45 });
//   lab.riso(sheet, toneCanvas, { ink: 'riso_federal_blue', misreg: [0.6, -0.3, 0.1] });
//   lab.draw(ctx, sheet);
//
// Film chain (per pixel, in this order): sRGB -> linear -> source_gamma / headroom -> layer exposure (stock spectral
// sensitivities) -> MTF (um) -> halation (base thickness, before the curve) -> log H -> datasheet curve per layer
// [-> printer light -> print curve] -> grain in density (rms granularity at 48 um, Selwyn-scaled) -> dye crosstalk ->
// equivalent neutral density -> fade / key / flicker -> projection transmittance -> decay -> dust -> gate weave.

const DATA = new URL('./printlab/data/', import.meta.url);
const A48 = Math.PI * 24 * 24;
export const GAUGES = { still135: [24, 36], '35mm': [21.95, 16.0], '16mm': [10.26, 7.49], super8: [5.79, 4.01], '8mm': [4.5, 3.3] };
export const FRAME_PITCH_MM = { still135: 38, '35mm': 19, '16mm': 7.62, super8: 4.23, '8mm': 3.81 };
const cache = {};
async function getJSON(rel) { return cache[rel] || (cache[rel] = await (await fetch(new URL(rel, DATA))).json()); }

// ------------------------------------------------------------------ the CPU half (mirrors engine/printlab/film.py)
function interp(x, xp, fp) {
  if (x <= xp[0]) return fp[0]; const n = xp.length; if (x >= xp[n - 1]) return fp[n - 1];
  let i = 1; while (xp[i] < x) i++; const t = (x - xp[i - 1]) / (xp[i] - xp[i - 1]); return fp[i - 1] + t * (fp[i] - fp[i - 1]);
}
function sortedInterp(x, xs, ys) { const idx = xs.map((v, i) => i).sort((a, b) => xs[a] - xs[b]); return interp(x, idx.map(i => xs[i]), idx.map(i => ys[i])); }
export function umPerPx(gauge, h = 1920, zoom = 1) { return GAUGES[gauge][1] * 1000 / h / zoom; }
export function meterOffset(st, meter = ['white', 0.06]) {
  if (st.print_curve) return -1.2 - Math.log10(0.18);
  const G = st.curves.G, lh = st.curves.logH, target = Math.min(...G) + meter[1];
  return sortedInterp(target, G, lh) - Math.log10(meter[0] === 'white' ? 0.9 : 0.18);
}
// PCG3D (Jarzynski & Olano 2020), the same as core.pcg3d in Python
function pcg3d(x, y, z) {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0; y = (Math.imul(y, 1664525) + 1013904223) >>> 0; z = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
  x ^= x >>> 16; y ^= y >>> 16; z ^= z >>> 16;
  x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
  return [x >>> 0, y >>> 0, z >>> 0];
}
const u01 = h => ((h >>> 8) + 0.5) / 16777216;
function gaussLattice(ix, iy, seed) { const [a, b] = pcg3d(ix | 0, iy | 0, seed | 0); return Math.sqrt(-2 * Math.log(u01(a))) * Math.cos(6.2831853 * u01(b)); }
function gnoise1(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v = (gaussLattice(ix, iy, seed) * (1 - sx) + gaussLattice(ix + 1, iy, seed) * sx) * (1 - sy) + (gaussLattice(ix, iy + 1, seed) * (1 - sx) + gaussLattice(ix + 1, iy + 1, seed) * sx) * sy;
  return v / Math.sqrt(((1 - sx) ** 2 + sx * sx) * ((1 - sy) ** 2 + sy * sy));
}
const g1 = (i, s) => gaussLattice(i, 0, s);
export function weave(st, frame, fps = 24, seed = 1) {
  const w = st.weave; if (w.sd_um <= 0 && w.pull_um <= 0) return [0, 0];
  const t = frame / fps / Math.max(w.tau_s, 1e-3);
  return [w.sd_um * gnoise1(t, 0.5, seed * 31 + 1) + w.pull_um * g1(frame, seed * 31 + 2),
          w.sd_um * 1.3 * gnoise1(t, 7.5, seed * 31 + 3) + w.pull_um * g1(frame, seed * 31 + 4)];
}
export function flicker(st, frame, seed = 1) {
  const sd = st.flicker.sd_D; if (sd <= 0) return 0;
  return sd * (0.8 * g1(frame, seed * 17 + 5) + 0.6 * gnoise1(frame / 9, 0.5, seed * 17 + 6));
}
const hexRGB = h => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const s2l = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

// ------------------------------------------------------------------ GLSL
const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform vec2 R; out vec4 o;
uvec3 pcg3d(uvec3 v){ v=v*1664525u+1013904223u; v.x+=v.y*v.z; v.y+=v.z*v.x; v.z+=v.x*v.y; v^=v>>16u;
  v.x+=v.y*v.z; v.y+=v.z*v.x; v.z+=v.x*v.y; return v; }
float u01(uint h){ return (float(h>>8u)+.5)*(1./16777216.); }
float glat(ivec2 i, uint s){ uvec3 h=pcg3d(uvec3(uint(i.x),uint(i.y),s)); return sqrt(-2.*log(u01(h.x)))*cos(6.2831853*u01(h.y)); }
float h01(ivec2 i, uint s){ return u01(pcg3d(uvec3(uint(i.x),uint(i.y),s)).x); }
float gnoise(vec2 p, uint s){ vec2 fl=floor(p), f=p-fl, sm=f*f*(3.-2.*f); ivec2 i=ivec2(fl);
  float v=mix(mix(glat(i,s),glat(i+ivec2(1,0),s),sm.x),mix(glat(i+ivec2(0,1),s),glat(i+ivec2(1,1),s),sm.x),sm.y);
  return v/sqrt(((1.-sm.x)*(1.-sm.x)+sm.x*sm.x)*((1.-sm.y)*(1.-sm.y)+sm.y*sm.y)); }
// pixel coordinates with row 0 at the top (numpy convention), as engine/printlab/core.field
vec2 pix(){ return vec2(gl_FragCoord.x-.5, R.y-gl_FragCoord.y-.5); }
float field(vec2 px, float cell, uint s, vec2 off, vec2 an, float ang){
  vec2 q=px+.5+off; float ca=cos(ang), sa=sin(ang);
  vec2 uv=vec2((q.x*ca+q.y*sa)/an.x, (-q.x*sa+q.y*ca)/an.y); float c=max(cell,1e-3);
  float a=gnoise(uv/c, s);
  vec2 uv2=vec2((uv.x*.8-uv.y*.6)/c*1.37+17.3, (uv.x*.6+uv.y*.8)/c*1.37+5.1);
  return (a+gnoise(uv2, s+7919u))*.70710678; }
float field0(vec2 px, float cell, uint s){ return field(px, cell, s, vec2(0.), vec2(1.), 0.); }
vec3 s2l(vec3 c){ return mix(c/12.92, pow((c+.055)/1.055, vec3(2.4)), step(.04045, c)); }
vec3 l2s(vec3 l){ l=max(l,0.); return mix(12.92*l, 1.055*pow(l, vec3(1./2.4))-.055, step(.0031308, l)); }
// 1D LUT rows in a float texture: row r, x in [x0, x1] over the texture width, linear between texels
float lut(sampler2D T, int row, float x, vec2 rng){ float w=float(textureSize(T,0).x);
  float f=clamp((x-rng.x)/(rng.y-rng.x),0.,1.)*(w-1.); int i=int(floor(f)); float t=f-float(i);
  float a=texelFetch(T, ivec2(i,row),0).r, b=texelFetch(T, ivec2(min(i+1,int(w)-1),row),0).r; return mix(a,b,t); }
`;
const FS = {
  // display -> layer exposure
  expose: `uniform sampler2D SRC; uniform mat3 SENS; uniform float SG, HEAD_; void main(){
    vec3 c=texelFetch(SRC, ivec2(gl_FragCoord.xy), 0).rgb; vec3 l=s2l(c);
    if(SG!=1.) l=pow(max(l,0.), vec3(1./SG));
    if(HEAD_>1.){ vec3 x=max((l-.8)/.2, 0.); l=mix(l, .8+(l-.8)*(1.+(HEAD_-1.)*x*x), step(.8,l)); }
    o=vec4(max(SENS*l, 1e-6), 1.); }`,
  // separable gaussian, per-channel sigma (px); DIR (1,0)/(0,1); reads at SCALE (src px per dst px)
  blur: `uniform sampler2D SRC; uniform vec3 SIG; uniform vec2 DIR; uniform float SCALE; void main(){
    vec2 ts=vec2(textureSize(SRC,0)); vec2 p=gl_FragCoord.xy*SCALE; float sm=max(SIG.x,max(SIG.y,SIG.z));
    if(sm<.06){ o=texture(SRC, p/ts); return; }
    int n=int(ceil(sm*3.)); vec3 acc=vec3(0.), wsum=vec3(0.);
    n=min(n,64); for(int k=-n;k<=n;k++){ float x=float(k);
      vec3 w=exp(-.5*x*x/max(SIG*SIG, vec3(1e-4))); acc+=w*texture(SRC,(p+DIR*x*SCALE)/ts).rgb; wsum+=w; }
    o=vec4(acc/wsum,1.); }`,
  down: `uniform sampler2D SRC; uniform float F; void main(){ vec2 ts=vec2(textureSize(SRC,0)); vec3 a=vec3(0.);
    for(int j=0;j<4;j++) for(int i=0;i<4;i++){ vec2 q=(floor(gl_FragCoord.xy)*F+(vec2(i,j)+.5)*F/4.)/ts; a+=texture(SRC,q).rgb; }
    o=vec4(a/16.,1.); }`,
  develop: `uniform sampler2D E, H1, H2, LUT; uniform vec3 HTINT; uniform float HSTR, OFF, P, CLOUD, AMP, CORR, COLOUR, PRINT, POFF,
    NEGX, FADEY, KEYD, FLK, DECAY, DUSTD, DUSTL, FRAME, PITCH, GRAIN; uniform vec3 GLAY, FADE, BASE, BTINT;
    uniform vec2 LRNG, DRNG, PRNG, ENDR, REG0, REG2; uniform mat3 DYE; uniform int HASDYE, HASEND, HASTAB; uniform uint SEED, GSEED;
    float sigD(float D){ return HASTAB==1 ? lut(LUT, 4, D, DRNG) : lut(LUT, 4, D, DRNG); }
    vec3 ex(vec2 px){ vec2 ts=vec2(textureSize(E,0)); vec2 uv=(vec2(px.x+.5, R.y-px.y-.5))/ts;
      vec3 e=texture(E,uv).rgb; return e+HSTR*HTINT*(.5*texture(H1,uv).rgb+.5*texture(H2,uv).rgb); }
    void main(){ vec2 px=pix();
      vec3 e=ex(px);
      if(REG0!=vec2(0.)||REG2!=vec2(0.)){ e.r=ex(px-REG0).r; e.b=ex(px-REG2).b; }
      vec3 L=log(max(e,1e-6))/log(10.)+OFF;
      if(NEGX>0.){ float k=NEGX*.25; L=(1.-k)*L+k*vec3((L.r+L.g+L.b)/3.); }
      vec3 D=vec3(lut(LUT,0,L.r,LRNG), lut(LUT,1,L.g,LRNG), lut(LUT,2,L.b,LRNG));
      float cell=max(1., CLOUD/P);
      if(PRINT>.5){
        if(GRAIN>0.){ float n=field0(px, cell, GSEED); D+=GRAIN*AMP*vec3(sigD(D.r),sigD(D.g),sigD(D.b))*n; }
        vec3 lt=-D+POFF; D=vec3(lut(LUT,3,lt.r,PRNG), lut(LUT,3,lt.g,PRNG), lut(LUT,3,lt.b,PRNG));
      } else if(GRAIN>0.){
        vec3 n;
        if(COLOUR>.5){ float cm=CORR>0.?field0(px,cell,GSEED):0.;
          for(int k=0;k<3;k++){ float own=CORR<1.?field0(px,cell,GSEED+1000003u*uint(k+1)):0.; n[k]=sqrt(CORR)*cm+sqrt(1.-CORR)*own; } }
        else { float own=CORR<1.?field0(px,cell,GSEED+1000003u):field0(px,cell,GSEED); n=vec3(own); }
        D+=GRAIN*AMP*vec3(sigD(D.r),sigD(D.g),sigD(D.b))*n*GLAY;
      }
      if(FADEY>0.) D*=1.-FADE*FADEY/10.;
      if(HASDYE==1) D=DYE*D;
      if(HASEND==1) D=vec3(lut(LUT,5,D.r,ENDR), lut(LUT,6,D.g,ENDR), lut(LUT,7,D.b,ENDR));
      if(KEYD>0.) D+=KEYD*clamp(D.g/2.4,0.,1.);
      D+=FLK;
      vec3 T=pow(vec3(10.), -(D-BASE))*BTINT;
      if(DECAY>0.){ // nitrate: the reel's decay potential at this frame's place on the strip
        float oy=FRAME*PITCH;
        float pot=.55*field(px,8000./P,SEED*3u+401u,vec2(0.,oy),vec2(1.),0.)+.25*field(px,900./P,SEED*3u+402u,vec2(0.,oy),vec2(1.),0.);
        float xx=(px.x+.5)/R.x; float edge=pow(1.-min(xx,1.-xx)*2.,2.); pot+=1.4*edge;
        float Lv=clamp(DECAY-1.2+pot,0.,5.); float a1=clamp(Lv,0.,1.); vec3 amber=vec3(1.,.8,.5);
        T=pow(T, vec3(1.-.35*a1))*(1.-a1+a1*amber);
        float a3=clamp(Lv-2.,0.,1.);
        if(a3>0.){ float cp=350./P; vec2 g=floor(px/cp); float best=9.;
          for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ ivec2 c=ivec2(g)+ivec2(i,j);
            vec2 ctr=(vec2(c)+.15+.7*vec2(h01(c,SEED+77u),h01(c,SEED+78u)))*cp; float hr=h01(c,SEED+79u); float rr=(.12+.5*hr*hr)*cp;
            if(h01(c,SEED+80u)<.45) best=min(best, length(px-ctr)/rr); }
          float ins=clamp((1.-best)*4.,0.,1.)*a3, ring=clamp(1.-abs(best-1.)*5.,0.,1.)*a3;
          T=T*(1.-ins)+(.55+.45*T)*amber*ins; T*=1.-.7*ring; }
        float a4=clamp(Lv-3.,0.,1.);
        if(a4>0.){ float foam=clamp(.5+.5*field0(px,60./P+1.,SEED+91u),0.,1.); T=T*(1.-a4)+vec3(.78,.52,.22)*(.45+.55*foam)*a4; }
        float a5=clamp(Lv-4.,0.,1.);
        if(a5>0.){ float grit=clamp(.6+.4*field0(px,1.2,SEED+93u),0.,1.); T=T*(1.-a5)+vec3(.2,.12,.06)*grit*a5; }
      }
      // dust: dark = dirt on the print/reversal original (projects black), light = dirt on the negative (prints white)
      for(int pass=0;pass<2;pass++){ float rate=pass==0?DUSTD:DUSTL; if(rate<=0.) continue;
        uint s0=SEED*131u+uint(FRAME)*977u+(pass==0?11u:23u); vec2 g=floor(px/96.); float cov=0.;
        for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ ivec2 c=ivec2(g)+ivec2(i,j); if(h01(c,s0)>=.012*rate) continue;
          float a=h01(c,s0+1u), b=h01(c,s0+2u), cc=h01(c,s0+3u); if(cc>=.8) continue;
          vec2 ctr=(vec2(c)+vec2(a,b))*96.; float r=(20.+100.*cc*cc)/P; vec2 dv=px+.5-ctr; float th=atan(dv.y,dv.x);
          float re=r*(1.+.35*sin(3.*th+6.283*a)+.2*sin(5.*th+6.283*b)); cov=max(cov, clamp(re+.5-length(dv),0.,1.)); }
        if(pass==0) T*=1.-cov; else T+=cov*(1.-T)*.95; }
      o=vec4(T,1.); }`,
  out: `uniform sampler2D SRC; uniform vec2 SH; void main(){ vec2 px=pix()-SH; vec2 ts=vec2(textureSize(SRC,0));
    vec3 T=texture(SRC, vec2(px.x+.5, R.y-px.y-.5)/ts).rgb; o=vec4(clamp(l2s(T),0.,1.),1.); }`,
  // ---------------------------------------------------------------- print: paper (rgb linear reflectance, a = height um)
  paper: `uniform vec3 BASE; uniform float TOOTH, FIB, FLEN, FORM, FSD, FLECK, MM; uniform vec2 OFF; uniform uint S;
    float pf(vec2 px, float mm, uint s, vec2 an, float ang){ float c=mm/MM; return field(px, max(c,1.), s, OFF, an, ang)*min(1.,c); }
    void main(){ vec2 px=pix();
      float fib=pf(px,FIB,S*11u+1u,vec2(FLEN,1.),.05), fib2=pf(px,FIB*1.3,S*11u+2u,vec2(FLEN*.7,1.),1.62);
      float form=pf(px,FORM,S*11u+3u,vec2(1.),0.), tooth=pf(px,.12,S*11u+4u,vec2(1.),0.);
      float h=TOOTH*(.35*tooth+.55*fib+.35*fib2+.3*form);
      vec3 c=BASE*(1.+FSD*form+.012*(fib+fib2));
      if(FLECK>0.){ float fl=pf(px,.15,S*11u+5u,vec2(1.),0.); c*=1.-.25*clamp((fl-3.2+.4*FLECK)*3.,0.,1.); }
      o=vec4(c,h); }`,
  // letterpress: FORME = 2D canvas, R face, G relief (um: (g-.5)*200), B figure (b-.5)*4. FACEB = blurred face (mip) for squash
  letterpress: `uniform sampler2D SHEET, FORME; uniform vec3 INK; uniform float MM, PRESS, FILM, STARVE, SQ, RIM, MSD, MMM, TOOTH, IMP;
    uniform vec2 OFF, MIS; uniform float ROT; uniform uint S;
    vec2 fuv(vec2 px){ vec2 c=R*.5; vec2 q=px-c; float cr=cos(-ROT), sr=sin(-ROT); q=vec2(cr*q.x-sr*q.y, sr*q.x+cr*q.y)+c-MIS;
      return vec2((q.x+.5)/R.x, 1.-(q.y+.5)/R.y); }
    void main(){ vec2 px=pix(); vec4 sh=texelFetch(SHEET, ivec2(gl_FragCoord.xy),0);
      vec2 uv=fuv(px); vec4 f=texture(FORME, uv); float face=f.r, rel=(f.g-.5)*200., fig=(f.b-.5)*4.;
      // squash zone: the face spread by ~SQ px (blurred face from the mip chain), with its neighbour's height
      float lod=log2(max(SQ,1.)); vec4 fb=textureLod(FORME, uv, lod+1.);
      float spread=smoothstep(.12,.45,fb.r)*step(face,.5); float relN=face>.5?rel:(fb.r>.01?(fb.g-.5)*200.*(1./max(fb.r,1e-3))*fb.r:0.);
      float squeeze=20.+80.*PRESS+(face>.5?rel:relN);
      float pit=TOOTH*1.2-sh.a; float reach=TOOTH*(1.+2.2*max(squeeze,0.)/60.)*(.75+.25*FILM);
      float contact=clamp((reach-pit)/1.5+.5,0.,1.)*clamp(squeeze/35.,0.,1.15);
      // roller starvation: ink already given up over the solid run above this point (mip estimate of the run)
      float run=0.; for(int k=1;k<=8;k++){ float d=float(k)*STARVE/8./MM; vec2 q=fuv(px-vec2(0.,d)); run+=texture(FORME,q).r; } run*=STARVE/8.;
      float t=FILM*(1.-.25*(1.-exp(-run/60.)))*(1.+MSD*field(px,MMM/MM,S+5u,OFF,vec2(1.),0.))*(1.+.07*fig);
      float rim=RIM*face*(1.-smoothstep(.55,.98,textureLod(FORME,uv,lod).r));
      float A=max(face,spread)*contact*t*(1.+rim);
      vec3 c=sh.rgb*pow(vec3(10.),-INK*clamp(A,0.,1.6));
      // impression shading from the blurred contact (kiss by default)
      float e=1.5; float dx=textureLod(FORME,fuv(px+vec2(e,0.)),lod+1.).r-textureLod(FORME,fuv(px-vec2(e,0.)),lod+1.).r;
      float dy=textureLod(FORME,fuv(px+vec2(0.,e)),lod+1.).r-textureLod(FORME,fuv(px-vec2(0.,e)),lod+1.).r;
      float dep=IMP/(MM*1000.)/(2.*e); c*=1.+.9*(dx*dep*.6-dy*dep*.8);
      o=vec4(c, sh.a-IMP*face*contact); }`,
  riso: `uniform sampler2D SHEET, TONE; uniform vec3 INK; uniform float MM, PITCH, SPREAD, BAND, DENS; uniform vec2 OFF, MIS; uniform float ROT; uniform uint S;
    float tone(vec2 px){ vec2 c=R*.5; vec2 q=px-c; float cr=cos(-ROT), sr=sin(-ROT); q=vec2(cr*q.x-sr*q.y, sr*q.x+cr*q.y)+c-MIS;
      return texture(TONE, vec2((q.x+.5)/R.x, 1.-(q.y+.5)/R.y)).r; }
    void main(){ vec2 px=pix(); vec4 sh=texelFetch(SHEET, ivec2(gl_FragCoord.xy),0); float t=clamp(tone(px),0.,1.), cov;
      if(PITCH>=1.){ vec2 d=floor((px+OFF)/PITCH); float thr=h01(ivec2(d),S); float dot_=step(thr,t);
        // ink spreads from each dot: average the 3x3 neighbourhood weighted by the spread
        float acc=dot_; float wsum=1.; float sp=max(SPREAD,.35);
        for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ if(i==0&&j==0) continue; ivec2 c=ivec2(d)+ivec2(i,j);
          float w=exp(-.5*float(i*i+j*j)*PITCH*PITCH/(sp*sp)); acc+=w*step(h01(c,S),t); wsum+=w; }
        cov=clamp(acc/wsum*1.15,0.,1.); }
      else { float n=1./(PITCH*PITCH); cov=clamp(t+sqrt(t*(1.-t)/n)*glat(ivec2(px),S),0.,1.); }
      float bnd=1.+BAND*(.6*field(px,max(40./MM,1.),S+1u,OFF,vec2(1.,8.),0.)+.5*field(px,max(1.2/MM,1.),S+2u,OFF,vec2(40.,1.),0.)*min(1.,1.2/MM));
      o=vec4(sh.rgb*pow(vec3(10.),-INK*cov*DENS*bnd), sh.a); }`,
  silkscreen: `uniform sampler2D SHEET, STEN; uniform vec3 INK, INKRGB; uniform float MM, MESH, ANG, OPAQ, OPAC, DSD, TUS; uniform vec2 OFF, MIS; uniform float ROT; uniform uint S;
    float st(vec2 px){ vec2 c=R*.5; vec2 q=px-c; float cr=cos(-ROT), sr=sin(-ROT); q=vec2(cr*q.x-sr*q.y, sr*q.x+cr*q.y)+c-MIS;
      return texture(STEN, vec2((q.x+.5)/R.x, 1.-(q.y+.5)/R.y)).r; }
    void main(){ vec2 px=pix(); vec4 sh=texelFetch(SHEET, ivec2(gl_FragCoord.xy),0); float cov;
      if(MESH>=1.5){ float a=ANG; vec2 u=vec2(px.x*cos(a)+px.y*sin(a), -px.x*sin(a)+px.y*cos(a))/MESH; vec2 cu=floor(u)+.5;
        vec2 ctr=vec2(cu.x*cos(a)-cu.y*sin(a), cu.x*sin(a)+cu.y*cos(a))*MESH;
        float s=st(ctr); if(TUS>0.) s+=TUS*.5*field0(ctr,.4/MM,S+3u)*(1.-abs(2.*s-1.))*2.;
        // the open cell, softened by the ink flowing under the threads
        vec2 fu=u-floor(u); float edge=min(min(fu.x,1.-fu.x),min(fu.y,1.-fu.y));
        float sN=st(px); cov=step(.5,s)*mix(1.,smoothstep(0.,.25,edge+.2),step(abs(sN-.5),.49)); cov=max(cov, step(.5,s)*step(.95,sN)); }
      else cov=clamp((st(px)-.5)*2.5+.5,0.,1.);
      float dep=1.+DSD*(field(px,max(25./MM,1.),S+1u,OFF,vec2(1.,10.),0.)+.5*field(px,max(2./MM,1.),S+2u,OFF,vec2(1.,6.),0.));
      vec3 c;
      if(OPAQ>.5){ float a=clamp(cov*(.93+.07*dep),0.,1.)*OPAC; c=sh.rgb*(1.-a)+INKRGB*(.9+.1*sh.rgb/.7)*a; }
      else c=sh.rgb*pow(vec3(10.),-INK*cov*dep);
      o=vec4(c, sh.a); }`,
  cyanotype: `uniform sampler2D SHEET, TR; uniform vec3 DMAX; uniform float MM, DOSE, H0, WASH, OX, STAIN; uniform vec2 OFF; uniform uint S;
    float pf(vec2 px, float mm, uint s, vec2 an, float ang){ float c=mm/MM; return field(px, max(c,1.), s, OFF, an, ang)*min(1.,c); }
    void main(){ vec2 px=pix(); vec4 sh=texelFetch(SHEET, ivec2(gl_FragCoord.xy),0);
      float tr=texture(TR, vec2((px.x+.5)/R.x, 1.-(px.y+.5)/R.y)).r;
      float mg=6./MM, rag=1.6/MM; float e=min(min(px.x,R.x-1.-px.x),min(px.y,R.y-1.-px.y))-mg;
      float br=pf(px,2.5,S+1u,vec2(1.,7.),0.)*rag+pf(px,.3,S+2u,vec2(1.),0.)*rag*.3;
      float coat=clamp((e+br)/max(.25/MM,.7),0.,1.)*(1.+.08*pf(px,4.,S+3u,vec2(8.,1.),0.));
      float H=DOSE*clamp(tr,0.,1.); float blue=(1.-exp(-H/H0))/(1.-exp(-1./H0));
      vec3 fin=DMAX*blue*coat;
      vec3 pre=vec3(.06,.03,.42)*(1.-blue)*coat+vec3(.42,.38,.40)*blue*coat;
      float yy=(px.y+.5)/R.y; float front=WASH*1.25-.12+.06*pf(px,12.,S+4u,vec2(3.,1.),0.)+.015*pf(px,1.,S+5u,vec2(1.),0.);
      float washed=clamp((front-yy)/.03,0.,1.);
      vec3 post=fin*(.72+.28*OX)+vec3(0.,0.,STAIN)*(1.-blue)*coat;
      float wet=washed*(1.-clamp((front-yy)/.35,0.,1.))*.25;
      vec3 D=pre*(1.-washed)+post*washed+wet*vec3(.05,.05,.04);
      o=vec4(sh.rgb*pow(vec3(10.),-D), sh.a); }`,
  gravure: `uniform sampler2D SHEET, TONE; uniform vec3 INK; uniform float MM, P, ANG, WALL, SNOW, ROUGH; uniform vec2 OFF; uniform uint S;
    void main(){ vec2 px=pix(); vec4 sh=texelFetch(SHEET, ivec2(gl_FragCoord.xy),0); vec2 q=px+OFF; float a=ANG;
      vec2 u=vec2(q.x*cos(a)+q.y*sin(a), -q.x*sin(a)+q.y*cos(a))/P; vec2 cu=floor(u);
      vec2 ctr=vec2((cu.x+.5)*cos(a)-(cu.y+.5)*sin(a), (cu.x+.5)*sin(a)+(cu.y+.5)*cos(a))*P-OFF;
      float d=textureLod(TONE, vec2((ctr.x+.5)/R.x, 1.-(ctr.y+.5)/R.y), P>1.5?log2(P*.3):0.).r;
      if(h01(ivec2(cu),S)<clamp((SNOW-d)/SNOW,0.,1.)*.6*ROUGH) d=0.;
      float wall=WALL*exp(-2.2*d); vec2 fu=u-cu; float ins;
      if(P>=2.){ float aa=1./P; ins=clamp((min(fu.x,1.-fu.x)-wall*.5)/aa+.5,0.,1.)*clamp((min(fu.y,1.-fu.y)-wall*.5)/aa+.5,0.,1.); }
      else ins=(1.-wall)*(1.-wall);
      o=vec4(sh.rgb*pow(vec3(10.),-INK*ins*d), sh.a); }`,
  show: `uniform sampler2D SRC; void main(){ vec4 s=texelFetch(SRC, ivec2(gl_FragCoord.xy),0); o=vec4(clamp(l2s(s.rgb),0.,1.),1.); }`,
};

// ------------------------------------------------------------------ the GL side
export class PrintLab {
  static async create(opts = {}) { const p = new PrintLab(opts); p.mat = await getJSON('print/materials.json'); return p; }
  constructor({ width = 1080, height = 1920, print = null } = {}) {
    this.w = width; this.h = height;
    if (print) { this.cv = print.cv; this.gl = print.gl; } else {
      this.cv = document.createElement('canvas'); this.cv.width = width; this.cv.height = height;
      this.gl = this.cv.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
    }
    const gl = this.gl; if (!gl) throw new Error('printlab.js needs WebGL2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('printlab.js needs EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.vao = gl.createVertexArray(); this.vb = gl.createBuffer();
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.progs = {}; this.t = {}; this.stocks = {}; this.luts = {};
    this.srcTex = this._tex(width, height, 'rgba8');
  }
  async stock(name) { return this.stocks[name] || (this.stocks[name] = await getJSON(`film/${name}.json`)); }
  _tex(w, h, fmt = 'f16', mip = false) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    const lv = mip ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_2D, lv, fmt === 'f16' ? gl.RGBA16F : fmt === 'f32' ? gl.RGBA32F : gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : fmt === 'f32' ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, fmt === 'f32' ? gl.NEAREST : gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    t.w = w; t.h = h; t.mip = mip; return t;
  }
  target(name, w = this.w, h = this.h, fmt = 'f16') {
    const k = `${name}|${w}x${h}`; if (this.t[k]) return this.t[k];
    const gl = this.gl, tex = this._tex(w, h, fmt), fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return (this.t[k] = { tex, fb, w, h, name });
  }
  _prog(name) {
    if (this.progs[name]) return this.progs[name];
    const gl = this.gl, sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`printlab ${name}: ${gl.getShaderInfoLog(s)}`); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec2 a; void main(){ gl_Position=vec4(a,0,1); }'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, HEAD + FS[name])); gl.bindAttribLocation(pr, 0, 'a'); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(`printlab ${name}: ${gl.getProgramInfoLog(pr)}`);
    const u = {}, n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(pr, i); u[a.name] = { loc: gl.getUniformLocation(pr, a.name), type: a.type }; }
    return (this.progs[name] = { pr, u });
  }
  _pass(name, tg, U = {}, T = {}) {
    const gl = this.gl, P = this._prog(name);
    gl.useProgram(P.pr); gl.bindFramebuffer(gl.FRAMEBUFFER, tg ? tg.fb : null);
    const w = tg ? tg.w : this.w, h = tg ? tg.h : this.h; gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vb); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    let unit = 0;
    for (const [k, t] of Object.entries(T)) { if (!P.u[k]) continue; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t.tex || t); gl.uniform1i(P.u[k].loc, unit++); }
    for (const [k, v] of Object.entries({ R: [w, h], ...U })) {
      const e = P.u[k]; if (!e) continue; const L = e.loc, ty = e.type;
      if (ty === gl.FLOAT) gl.uniform1f(L, v); else if (ty === gl.INT) gl.uniform1i(L, v); else if (ty === gl.UNSIGNED_INT) gl.uniform1ui(L, v >>> 0);
      else if (ty === gl.FLOAT_VEC2) gl.uniform2fv(L, v); else if (ty === gl.FLOAT_VEC3) gl.uniform3fv(L, v); else if (ty === gl.FLOAT_MAT3) gl.uniformMatrix3fv(L, true, v.flat());
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  _upload(tex, source, mip = false) {
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  }
  _canvasTex(key, source, mip = true) {
    const k = 'cv_' + key; let t = this.t[k];
    if (!t) { t = this.t[k] = { tex: this._tex(this.w, this.h, 'rgba8', mip) }; }
    this._upload(t.tex, source, mip); return t;
  }
  // per-stock LUT: rows 0-2 layer curves over logH, 3 print curve over logT, 4 sigma_D over D, 5-7 END over D
  _lut(st) {
    if (this.luts[st.id]) return this.luts[st.id];
    const N = 1024, rows = 8, a = new Float32Array(N * rows * 4), lh = st.curves.logH, lay = st.curves.layer;
    const LR = [lh[0], lh[lh.length - 1]], DR = [0, 4.2];
    const PR = st.print_curve ? [st.print_curve.logT[0], st.print_curve.logT[st.print_curve.logT.length - 1]] : [0, 1];
    const ER = st.end ? [st.end.D[0], st.end.D[st.end.D.length - 1]] : [0, 1];
    const g = st.grain;
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1), x = LR[0] + f * (LR[1] - LR[0]), d = DR[0] + f * (DR[1] - DR[0]);
      for (let c = 0; c < 3; c++) a[(c * N + i) * 4] = interp(x, lh, lay.map(r => r[c]));
      if (st.print_curve) a[(3 * N + i) * 4] = interp(PR[0] + f * (PR[1] - PR[0]), st.print_curve.logT, st.print_curve.D);
      a[(4 * N + i) * 4] = g.table ? interp(d, g.table.D, g.table.s) : (g.rms48 / 1000) * Math.pow(Math.max(d / g.at_D, 0), g.D_exp ?? 0.5);
      if (st.end) { const e = ER[0] + f * (ER[1] - ER[0]); for (let c = 0; c < 3; c++) a[((5 + c) * N + i) * 4] = interp(e, st.end.D, st.end['RGB'[c]]); }
    }
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, N, rows); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, rows, gl.RGBA, gl.FLOAT, a);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    return (this.luts[st.id] = { tex: t, LR, DR, PR, ER });
  }

  // ---------------------------------------------------------------- film
  // source: canvas / img / video at width x height. Returns this.cv (also drawn to ctx when given).
  film(ctx, source, stockName, o = {}) {
    const st = this.stocks[stockName]; if (!st) throw new Error(`printlab: await lab.stock('${stockName}') first`);
    const { frame = 0, fps = 24, seed = 1, zoom = 1, exposure = 0, meter = ['white', 0.06], headroom = 1, printer_points = 0,
      grain = 1, halation = 1, mtf = 1, weave_amt = 1, flicker_amt = 1, dust_amt = 1, decay = 0, fade_years = 0, key = null,
      registration = 1, source_gamma = 1 } = o;
    const gauge = o.gauge || st.gauge, p = umPerPx(gauge, this.h, zoom), W = this.w, H = this.h;
    this._upload(this.srcTex, source);
    const E = this.target('E'), E2 = this.target('E2'), Eb = this.target('Eb');
    this._pass('expose', E, { SENS: st.sens_matrix, SG: source_gamma, HEAD_: headroom }, { SRC: this.srcTex });
    const f50 = (st.records && st.records.mtf_f50) || [st.mtf.f50, st.mtf.f50, st.mtf.f50];
    const sig = f50.map(f => mtf * 187.4 / f / p);
    this._pass('blur', Eb, { SIG: sig, DIR: [1, 0], SCALE: 1 }, { SRC: E.tex });
    this._pass('blur', E2, { SIG: sig, DIR: [0, 1], SCALE: 1 }, { SRC: Eb.tex });
    const hal = st.halation, F = 4, hw = Math.ceil(W / F), hh = Math.ceil(H / F);
    const q = this.target('q', hw, hh), qa = this.target('qa', hw, hh), h1 = this.target('h1', hw, hh), h2 = this.target('h2', hw, hh);
    const useH = halation > 0 && hal.strength > 0;
    if (useH) {
      this._pass('down', q, { F }, { SRC: E2.tex });
      const t = hal.base_um / p / F;
      for (const [s, dst] of [[0.9 * t, h1], [2.2 * t, h2]]) {
        this._pass('blur', qa, { SIG: [s, s, s], DIR: [1, 0], SCALE: 1 }, { SRC: q.tex });
        this._pass('blur', dst, { SIG: [s, s, s], DIR: [0, 1], SCALE: 1 }, { SRC: qa.tex });
      }
    }
    const lut = this._lut(st), g = st.grain, colour = st.colour;
    let poff = 0;
    const lh = st.curves.logH, lay = st.curves.layer;
    if (st.print_curve) {
      const dnegW = interp(Math.log10(0.9) + meterOffset(st, meter), lh, lay.map(r => r[1]));
      const pd = st.print_curve.D, lt = st.print_curve.logT;
      poff = sortedInterp(Math.min(...pd) + meter[1], pd, lt) + dnegW - printer_points * 0.025;
    }
    let base;
    if (st.print_curve) { const m = Math.min(...st.print_curve.D); base = [m, m, m]; }
    else if (st.end) { const m = Math.min(...st.curves.G); base = [m, m, m]; }
    else { base = [0, 1, 2].map(c => Math.min(...lay.map(r => r[c]))); }
    let reg0 = [0, 0], reg2 = [0, 0];
    if (st.records && registration > 0) {
      const s = registration * st.records.reg_um / 2 / p;
      reg0 = [s * g1(1, seed + 500), s * g1(2, seed + 500)]; reg2 = [s * g1(5, seed + 500), s * g1(6, seed + 500)];
    }
    const Fd = this.target('F');
    const gseed = ((seed * 7919 + frame * 104729) & 0x7fffffff) >>> 0;
    this._pass('develop', Fd, {
      HTINT: hal.tint, HSTR: useH ? halation * hal.strength : 0, OFF: meterOffset(st, meter) + exposure * Math.log10(2), P: p,
      CLOUD: g.cloud_um, AMP: Math.sqrt(A48) / Math.max(p, g.cloud_um), CORR: g.corr, COLOUR: colour ? 1 : 0, PRINT: st.print_curve ? 1 : 0, POFF: poff,
      NEGX: st.neg_crosstalk || 0, FADEY: st.fade ? fade_years : 0, FADE: st.fade ? st.fade.per_decade : [0, 0, 0],
      KEYD: st.records ? (key ?? st.records.key_D) : 0, FLK: flicker_amt * flicker(st, frame, seed), DECAY: decay,
      DUSTD: dust_amt * st.dust.dark, DUSTL: dust_amt * st.dust.light, FRAME: frame, PITCH: FRAME_PITCH_MM[gauge] * 1000 / p, GRAIN: grain,
      GLAY: g.layer, BASE: base, BTINT: st.base_tint || [1, 1, 1], LRNG: lut.LR, DRNG: lut.DR, PRNG: lut.PR, ENDR: lut.ER,
      REG0: reg0, REG2: reg2, DYE: st.dye_matrix || [[1, 0, 0], [0, 1, 0], [0, 0, 1]], HASDYE: st.dye_matrix ? 1 : 0, HASEND: st.end ? 1 : 0,
      HASTAB: g.table ? 1 : 0, SEED: seed, GSEED: gseed,
    }, { E: E2.tex, H1: h1.tex, H2: h2.tex, LUT: lut.tex });
    const wv = weave_amt > 0 ? weave(st, frame, fps, seed).map(v => weave_amt * v / p) : [0, 0];
    this._pass('out', null, { SH: wv }, { SRC: Fd.tex });
    if (ctx) ctx.drawImage(this.cv, 0, 0, W, H);
    return this.cv;
  }

  // ---------------------------------------------------------------- print
  // cam: { view_mm, x_mm, y_mm }. A sheet is a float target: rgb = linear reflectance, a = paper height (um).
  _cam(cam) { const mm = cam.view_mm / this.w; return { mm, off: [(cam.x_mm || 0) / mm, (cam.y_mm || 0) / mm] }; }
  paper(kind, cam, seed = 1, name = 'sheet') {
    const p = typeof kind === 'string' ? this.mat.papers[kind] : kind, { mm, off } = this._cam(cam);
    const tg = this.target(name); tg.cam = cam; tg.paper = p; tg.seed = seed;
    this._pass('paper', tg, { BASE: p.rgb.map(s2l), TOOTH: p.tooth_um, FIB: p.fibre_mm, FLEN: p.fibre_len, FORM: p.formation_mm, FSD: p.formation_sd,
      FLECK: p.fleck || 0, MM: mm, OFF: off, S: seed }, {});
    return tg;
  }
  _swap(sheet) { const b = this.target(sheet.name + '_b'); return b; }
  _commit(sheet, tmp) { const gl = this.gl; gl.bindFramebuffer(gl.READ_FRAMEBUFFER, tmp.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sheet.fb);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST); }
  inkD(name) {
    const k = typeof name === 'string' ? this.mat.inks[name] : name;
    if (k.D) return k.D; if (k.hex) return hexRGB(k.hex).map(c => -Math.log10(Math.min(Math.max(s2l(c) / 0.92, 1e-3), 1)));
    return null;
  }
  _mis(sheet, misreg) { const { mm } = this._cam(sheet.cam); return misreg ? { MIS: [misreg[0] / mm, misreg[1] / mm], ROT: (misreg[2] || 0) * Math.PI / 180 } : { MIS: [0, 0], ROT: 0 }; }
  letterpress(sheet, forme, o = {}) {
    const pr = this.mat.process.letterpress, { mm, off } = this._cam(sheet.cam), tmp = this._swap(sheet);
    const sq = (o.squash_mm ?? pr.squash_mm) / mm * (0.6 + 0.8 * (o.pressure ?? 0.4));
    const pressure = o.pressure ?? 0.4;
    this._pass('letterpress', tmp, { INK: this.inkD(o.ink || 'black1874'), MM: mm, PRESS: pressure, FILM: o.ink_film ?? 1, STARVE: pr.starve_mm,
      SQ: sq, RIM: pr.rim, MSD: (o.mottle ?? 1) * pr.mottle_sd, MMM: pr.mottle_mm, TOOTH: sheet.paper.tooth_um, IMP: o.impression_um ?? (12 + 70 * pressure * pressure),
      OFF: off, S: o.seed ?? (sheet.seed * 7 + 3), ...this._mis(sheet, o.misreg) }, { SHEET: sheet.tex, FORME: this._canvasTex('forme', forme).tex });
    this._commit(sheet, tmp); return sheet;
  }
  riso(sheet, tone, o = {}) {
    const pr = this.mat.process.riso, { mm, off } = this._cam(sheet.cam), tmp = this._swap(sheet);
    this._pass('riso', tmp, { INK: this.inkD(o.ink || 'riso_federal_blue'), MM: mm, PITCH: 25.4 / (o.dpi || pr.dpi) / mm, SPREAD: Math.max(pr.spread_mm / mm, 0.35),
      BAND: (o.band ?? 1) * pr.band_sd, DENS: o.density ?? 1, OFF: off, S: o.seed ?? (sheet.seed * 13 + 5), ...this._mis(sheet, o.misreg) },
      { SHEET: sheet.tex, TONE: this._canvasTex('tone', tone).tex });
    this._commit(sheet, tmp); return sheet;
  }
  silkscreen(sheet, stencil, o = {}) {
    const pr = this.mat.process.silkscreen, { mm, off } = this._cam(sheet.cam), tmp = this._swap(sheet);
    const k = typeof (o.ink || 'screen_red') === 'string' ? this.mat.inks[o.ink || 'screen_red'] : o.ink;
    this._pass('silkscreen', tmp, { INK: k.D || [0, 0, 0], INKRGB: (k.rgb || [0, 0, 0]).map(s2l), OPAQ: k.rgb ? 1 : 0, OPAC: k.opacity ?? 0.95,
      MM: mm, MESH: 25.4 / (o.tpi || pr.tpi) / mm, ANG: (o.mesh_angle ?? 7) * Math.PI / 180, DSD: pr.deposit_sd, TUS: o.tusche || 0, OFF: off,
      S: o.seed ?? (sheet.seed * 17 + 7), ...this._mis(sheet, o.misreg) }, { SHEET: sheet.tex, STEN: this._canvasTex('sten', stencil).tex });
    this._commit(sheet, tmp); return sheet;
  }
  cyanotype(sheet, transmittance, o = {}) {
    const pr = this.mat.process.cyanotype, { mm, off } = this._cam(sheet.cam), tmp = this._swap(sheet);
    this._pass('cyanotype', tmp, { DMAX: this.mat.inks.prussian.D, MM: mm, DOSE: o.dose ?? 1, H0: pr.H0, WASH: o.wash ?? 1, OX: o.oxidise ?? 1,
      STAIN: o.stain ?? pr.stain, OFF: off, S: o.seed ?? (sheet.seed * 19 + 11) }, { SHEET: sheet.tex, TR: this._canvasTex('tr', transmittance).tex });
    this._commit(sheet, tmp); return sheet;
  }
  gravure(sheet, tone, o = {}) {
    const pr = this.mat.process.gravure, { mm, off } = this._cam(sheet.cam), tmp = this._swap(sheet);
    this._pass('gravure', tmp, { INK: this.inkD(o.ink || 'sepia_gravure'), MM: mm, P: 25.4 / (o.lpi || pr.lpi) / mm, ANG: (o.angle ?? pr.angle) * Math.PI / 180,
      WALL: pr.wall, SNOW: pr.snow, ROUGH: sheet.paper.tooth_um / 10, OFF: off, S: o.seed ?? (sheet.seed * 23 + 13) },
      { SHEET: sheet.tex, TONE: this._canvasTex('gtone', tone).tex });
    this._commit(sheet, tmp); return sheet;
  }
  draw(ctx, sheet) { this._pass('show', null, {}, { SRC: sheet.tex }); if (ctx) ctx.drawImage(this.cv, 0, 0, this.w, this.h); return this.cv; }
}

// ------------------------------------------------------------------ type set as sorts, for the GL press
// lines: [{ text, x_mm, base_mm, lines (pica lines of body), face (a loaded CSS font family), material: 'wood'|'metal', seed, wear }]
// Returns a canvas: R = face, G = relief (um: (g-.5)*200, per sort), B = wood figure (per sort, its own angle and phase).
export function setType(lines, cam, { width = 1080, height = 1920 } = {}) {
  const mm = cam.view_mm / width, ox = (cam.x_mm || 0) / mm, oy = (cam.y_mm || 0) / mm;
  const out = document.createElement('canvas'); out.width = width; out.height = height;
  const g = out.getContext('2d'); g.fillStyle = 'rgb(0,128,128)'; g.fillRect(0, 0, width, height);
  const tmp = document.createElement('canvas'); tmp.width = width; tmp.height = height; const tg = tmp.getContext('2d', { willReadFrequently: true });
  const od = g.getImageData(0, 0, width, height), D = od.data;
  let sid = 0;
  for (const L of lines) {
    const body = (L.lines || 10) * (25.4 / 6) / mm; let x = L.x_mm / mm - ox; const base = L.base_mm / mm - oy;
    tg.font = `${body}px "${L.face || 'serif'}"`; tg.textBaseline = 'alphabetic';
    for (const ch of L.text) {
      const adv = tg.measureText(ch).width, s = (L.seed || 1) * 1009 + (sid++) * 31;
      if (ch !== ' ') {
        tg.clearRect(0, 0, width, height); tg.fillStyle = '#fff'; tg.fillText(ch, x, base);
        const x0 = Math.max(0, Math.floor(x - 2)), x1 = Math.min(width, Math.ceil(x + adv + body * 0.2)), y0 = Math.max(0, Math.floor(base - body)), y1 = Math.min(height, Math.ceil(base + body * 0.35));
        if (x1 > x0 && y1 > y0) {
          const src = tg.getImageData(x0, y0, x1 - x0, y1 - y0).data;
          const wood = (L.material || 'wood') === 'wood';
          const h0 = (wood ? 12 : 4) * (2 * u01(pcg3d(s, 1, 7)[0]) - 1) * 1.7;
          const ang = ((L.grain_angle ?? 90) + 6 * (2 * u01(pcg3d(s, 2, 7)[0]) - 1)) * Math.PI / 180, ph = u01(pcg3d(s, 3, 7)[0]) * 6.283;
          const ca = Math.cos(ang), sa = Math.sin(ang), c0 = 0.5 / mm;
          for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
            const a = src[((yy - y0) * (x1 - x0) + (xx - x0)) * 4 + 3] / 255; if (a < 0.02) continue;
            const i = (yy * width + xx) * 4; if (a < D[i] / 255) continue;
            let fig = 0, rel = h0;
            if (wood) { const u = (xx * ca + yy * sa) / 30 / c0, v = (-xx * sa + yy * ca) / c0; fig = 0.8 * gnoise1(u, v, s + 5) * 0.7 + 0.2 * Math.sin((xx * ca + yy * sa) * mm / 1.7 * 6.283 + ph);
              const cr = gnoise1(xx * mm / 4, yy * mm / 4, s + 3); rel -= 45 * (L.wear ?? 0.3) * Math.min(Math.max(cr - 1.2, 0), 1); }
            D[i] = a * 255; D[i + 1] = Math.max(0, Math.min(255, 128 + rel / 200 * 255)); D[i + 2] = Math.max(0, Math.min(255, 128 + fig / 4 * 255)); D[i + 3] = 255;
          }
        }
      }
      x += adv + (L.tracking_mm || 0) / mm;
    }
  }
  g.putImageData(od, 0, 0);
  return out;
}
