import { displayGLSLConst } from './light/display.js';   // LIGHTING c2: the one display transform, as an option (display: 'acp')
// SDF: a WebGL2 raymarcher for monumental 3D worlds (brutalist architecture, monuments, industrial
// halls, silos and domes, towers, terrain) with soft sun shadows, AO, height fog, volumetric god-rays,
// screen-space sun shafts, wet-floor reflections, mip bloom and a grade.
//
//   import { SDF, WORLDS, LOOKS, kit, compose } from '../lib/fx/sdf.js';
//   const fort = new SDF({ world: 'fortress', decal: img });                  // march at 0.4 of 1080x1920 (default)
//   fort.render(t, { look: LOOKS.NOON, cam, mark: 1, gateGlow: .4, hero: { x: 2, z: 64, heading: 2.2, phase: t * 9 } });
//   ctx.drawImage(fort.canvas, 0, 0);                                         // canvas is already 1080x1920
//
// Pipeline per frame (all deterministic in t; noise is hashed from the pixel, never from a clock):
//   1. MARCH at `scale` (default .4): colour + mask, volumetric in-scatter, log depth + material id (3 targets).
//      Enhanced sphere tracing (over-relaxed steps OMEGA with fallback), pixel-cone hit test, per-part AABB early-outs.
//   2. EDGE AA: pixels on a depth or material discontinuity get 2 extra sub-pixel rays (3-tap average); the rest copy.
//   3. POST at march res: volume denoise, bloom, sun shafts, grade (contrast, sat, lift/gain, cream highlight key, crush).
//   4. UPSCALE to the output size: Catmull-Rom (5 taps) + a sharpen clamped to the local texel range, damped on depth edges.
//      handoff:true instead writes colour (top half) + packed depth (bottom half) for world3d.SDFLayer (three.js depth merge).
//
// A world is GLSL defining `vec2 mapObj(vec3 p)` (distance, material id) and `void material(vec3 p, vec3 n, float id, inout Mat m)`.
// Either write it by hand (WORLDS below) or generate it from parts: compose([kit.keep({...}), kit.ring({...}), ...]).
// Materials come from the shared library in COMMON: matConcrete (board-formed, pour lines, tie holes, water streaks,
// AO grime, spalls), matPaint (worn painted metal, chips, rust), matRust, matWet (puddles with mirror reflections),
// matEarth (terrain), matFigure (dark cloth, rim-lit). Figures are articulated SDFs (sdFigure) with a walk cycle.

// ------------------------------------------------------------------ GLSL: shared kit
const COMMON = /* glsl */`
#define PI 3.14159265
#define SAT(x) clamp(x,0.,1.)
uniform vec2 R; uniform float T, KICK, FLASH, SEED;
uniform vec3 CP, CT; uniform float FOV, ROLL;
uniform vec3 SUN, SUNC, SKYT, SKYH, GRND, FOGC; uniform float FOGD, FOGH, FOGS, VOLA, AMB, EXPO;
uniform vec4 RIM;                    // rim (kicker) light from behind the subject: rgb, a = amount on every surface
uniform vec4 U[8];
uniform sampler2D DECAL;
uniform sampler2D BN;                // 64x64 blue noise (void-and-cluster, baked once per page): stable dither without the IGN crosshatch
float gFine=1.;                      // 1 on primary rays and normals (displacement + full figures), 0 in shadow / AO / reflection rays
float gOcc=1.;                       // AO at the shading point (materials: grime in crevices)
float gT=0.;                         // hit distance (materials fade fine detail with distance)
float gCheap=0.;                     // 1 in reflections and AA taps: materials skip their fine detail
float gPix=.001;                     // one march pixel's footprint per metre of ray (set per primary ray): figure and crowd LOD
float bn(vec2 fc){ return texelFetch(BN,ivec2(fc)&63,0).r; }
float h11(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float h21(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
vec2 h22(vec2 p){ vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); q+=dot(q,q.yzx+33.33); return fract((q.xx+q.yz)*q.zy); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*n2(p); p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,1.7); a*=.5; } return v; }
float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); float n=i.x+i.y*57.+i.z*113.;
  return mix(mix(mix(h11(n),h11(n+1.),f.x),mix(h11(n+57.),h11(n+58.),f.x),f.y),
             mix(mix(h11(n+113.),h11(n+114.),f.x),mix(h11(n+170.),h11(n+171.),f.x),f.y),f.z); }
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
// ---- primitives
float sdBox(vec3 p, vec3 b){ vec3 q=abs(p)-b; return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.); }
float sdBox2(vec2 p, vec2 b){ vec2 q=abs(p)-b; return length(max(q,0.))+min(max(q.x,q.y),0.); }
float sdCylY(vec3 p, float r, float h){ vec2 d=abs(vec2(length(p.xz),p.y))-vec2(r,h); return min(max(d.x,d.y),0.)+length(max(d,0.)); }
float sdCylX(vec3 p, float r, float h){ return sdCylY(p.yxz,r,h); }
float sdCylZ(vec3 p, float r, float h){ return sdCylY(p.xzy,r,h); }
float sdCap(vec3 p, vec3 a, vec3 b, float r){ vec3 pa=p-a, ba=b-a; float h=SAT(dot(pa,ba)/dot(ba,ba)); return length(pa-ba*h)-r; }
// tapered capsule (radius ra at a, rb at b): limbs
float sdLimb(vec3 p, vec3 a, vec3 b, float ra, float rb){ vec3 pa=p-a, ba=b-a; float h=SAT(dot(pa,ba)/dot(ba,ba)); return length(pa-ba*h)-mix(ra,rb,h); }
float sdTorus(vec3 p, vec2 t){ return length(vec2(length(p.xz)-t.x,p.y))-t.y; }
float smin(float a, float b, float k){ float h=SAT(.5+.5*(b-a)/k); return mix(b,a,h)-k*h*(1.-h); }
vec2 opU(vec2 a, vec2 b){ return a.x<b.x?a:b; }
// ---- architecture kit
float sdBattered(vec3 p, vec3 b, vec2 batter){ float k=(p.y+b.y); vec3 bb=vec3(b.x-batter.x*k, b.y, b.z-batter.y*k);
  return sdBox(p,max(bb,vec3(.01)))*.9; }
float sdWedge(vec3 p, float w, float h, float d){ float b=sdBox(p-vec3(0,h*.5,0),vec3(w,h*.5,d*.5));
  return max(b, dot(p-vec3(0,0,d*.5), normalize(vec3(0,d,h)))); }
float sdStairs(vec3 p, float w, float rise, float run, float n){
  float s=clamp(floor(-p.z/run),0.,n-1.); float d=1e5;
  for(int k=-1;k<=1;k++){ float i=clamp(s+float(k),0.,n-1.); float top=(i+1.)*rise, zc=-(i+.5)*run;
    d=min(d, sdBox(p-vec3(0,top*.5,zc-(n-1.-i)*run*.5), vec3(w,top*.5,run*.5+(n-1.-i)*run*.5))); }
  return d; }
float sdSilo(vec3 p, float r, float h){ float c=sdCylY(p-vec3(0,h*.5,0),r,h*.5); vec3 q=p-vec3(0,h,0); q.y*=1.6; return min(c,(length(q)-r)/1.6); }
float sdDome(vec3 p, float r, float dh){ float drum=sdCylY(p-vec3(0,dh*.5,0),r,dh*.5); float s=length(p-vec3(0,dh,0))-r; return min(drum,max(s,-(p.y-dh))); }
float sdGear(vec3 p, float r, float n, float w, float t){
  float l=length(p.xz); float ring=max(abs(l-(r-w*.5))-w*.5, abs(p.y)-t);
  float a=atan(p.z,p.x); float sec=2.*PI/n; a=mod(a+sec*.5,sec)-sec*.5; vec2 q=vec2(cos(a),sin(a))*l;
  float tooth=max(sdBox2(q-vec2(r+w*.2,0.),vec2(w*.3,w*.3)), abs(p.y)-t);
  return min(ring,tooth); }
float sdZiggurat(vec3 p, float r0, float dr, float rise, float n){
  float r=length(p.xz); float k=clamp(floor((r-r0)/dr),-1.,n-1.); float d=1e5;
  for(int j=-1;j<=1;j++){ float kk=clamp(k+float(j),-1.,n-1.); float rad=r0+(kk+1.)*dr; float top=(n-kk)*rise;
    d=min(d, sdCylY(p-vec3(0,top*.5,0), rad, top*.5)); }
  return d; }
float terrainH(vec2 xz, float amp, float scale, float flatR){ float r=length(xz); float k=smoothstep(flatR,flatR*2.5,r);
  return (fbm(xz*scale)*amp+ fbm(xz*scale*4.)*amp*.15)*k; }
float seams(vec2 uv, vec2 size, float w){ uv.x+=h11(floor(uv.y/size.y))*size.x; vec2 g=abs(fract(uv/size)-.5)*size; return smoothstep(0.,w,min(size.x*.5-g.x,size.y*.5-g.y)); }
// cheap displacement for hero concrete: pour-line grooves every lift m plus spalled pits. Only near the surface and only
// on primary rays (gFine), so shadow, AO and far rays pay nothing. d = the structure's distance before displacement.
float dispConcrete(vec3 p, float d, float lift){
#ifdef NODISP
  return d;
#endif
  if(gFine<.5||d>.3) return d;
  float lv=lift*.5-abs(fract(p.y/lift)-.5)*lift;                       // distance to the nearest pour line
  float groove=smoothstep(.09,.0,lv)*.05;
  float sp=smoothstep(.7,.85,n3(p*.9))*.07;
  return d+(groove+sp)*.7; }
// ---- materials
struct Mat { vec3 alb; float spec; float gloss; vec3 emi; float rim; float refl; };
vec3 triW(vec3 n){ vec3 w=abs(n); w*=w; w*=w; return w/(w.x+w.y+w.z); }
float triFbm(vec3 p, vec3 n, float s){ vec3 w=triW(n); float v=0.;
  if(w.x>.02) v+=w.x*fbm(p.zy*s); if(w.y>.02) v+=w.y*fbm(p.xz*s); if(w.z>.02) v+=w.z*fbm(p.xy*s); return v; }
float triN(vec3 p, vec3 n, float s){ vec3 w=triW(n); float v=0.; if(w.x>.02) v+=w.x*n2(p.zy*s); if(w.y>.02) v+=w.y*n2(p.xz*s); if(w.z>.02) v+=w.z*n2(p.xy*s); return v; }
vec2 faceUV(vec3 p, vec3 n){ return abs(n.x)>abs(n.z)?p.zy:p.xy; }
// Every material has a cheap tier (gCheap = 1: reflections and AA taps) that keeps the tone and drops the fine detail.
// board-formed concrete: 15 cm formwork boards (staggered ends, faint grain), 2.4 m pour lifts with cold joints and a tone
// per pour, tie holes, water streaks running down from every joint, grime from AO and rising damp, spalls showing aggregate.
void matConcrete(inout Mat m, vec3 p, vec3 n, vec3 base, float age){
  float big=triN(p,n,.05)*.65+triN(p,n,.17)*.35;
  vec3 c=base*(.8+.36*big);
  float fade=SAT(1.-gT/350.);
  if(gCheap<.5&&abs(n.y)<.7){
    vec2 f=faceUV(p,n); float u=f.x, v=f.y;
    float lift=floor(v/2.4), lv=v-lift*2.4;
    c*=.93+.13*h11(lift*7.13+floor(u/9.)*3.3);
    float bi=floor(v/.15), bu=u+h11(bi)*2.4;
    c*=mix(1.,.95+.06*h21(vec2(bi,floor(bu/2.4)))+.025*n2(vec2(bu*2.,v*30.)),fade);
    float db=min(fract(v/.15),1.-fract(v/.15))*.15;                     // board seams
    c*=1.-.07*smoothstep(.01,.0,db)*fade;
    float dj=min(lv,2.4-lv)+(h11(floor(u*1.5)+lift*3.)-.5)*.02;          // cold joint
    c*=1.-.4*smoothstep(.05,.0,dj);
    vec2 th=(fract(vec2(u/1.2,(lv-.3)/.6))-.5)*vec2(1.2,.6);              // tie holes
    c*=1.-.4*smoothstep(.028,.016,length(th))*fade;
    float sn=n2(vec2(u*2.3+lift*13.,v*.1))*(.6+.4*h11(floor(u*6.)));      // water streaks, strongest under each joint
    float streak=smoothstep(.2,.55,sn)*(exp(-(2.4-lv)*.7)*.7+.3)*age;
    float runs=smoothstep(.62,.9,n2(vec2(u*.8,v*.015+4.)))*age;           // long runs from the parapets
    c=mix(c,c*vec3(.62,.62,.6),SAT(streak+runs*.6));
    float sp=smoothstep(.7,.76,triN(p,n,.9))*age;                         // spalls: exposed aggregate
    c=mix(c,base*vec3(1.04,1.,.94),sp*.45*fade);
  } else if(gCheap<.5) c*=.92+.1*triN(p,n,1.5);
  float grime=SAT((1.-gOcc)*1.2+exp(-max(p.y,0.)*.3)*.7*age)*(.6+.5*big);
  c=mix(c,c*vec3(.55,.51,.47),grime*.75);
  m.alb=c; m.spec=.05+.04*big; m.gloss=10.; }
// worn painted metal: chipped paint (chips find the exposed, occluded and low areas), bare steel, rust in the chips
void matPaint(inout Mat m, vec3 p, vec3 n, vec3 paint, float wear){
  float w=triN(p,n,.8)*.65+triN(p,n,2.3)*.35, fine=gCheap>.5?.5:triN(p,n,9.);
  float chip=smoothstep(.66-.28*wear,.7-.28*wear,w+(1.-gOcc)*.25+fine*.08);
  float rs=smoothstep(.55,.85,triN(p*1.7+3.,n,.7)+(1.-gOcc)*.5+exp(-max(p.y,0.)*.4)*.3-(1.-wear)*.6);
  vec3 rust=mix(vec3(.26,.09,.035),vec3(.5,.22,.07),fine);
  m.alb=mix(paint*(.88+.24*w),vec3(.3,.3,.29),chip); m.alb=mix(m.alb,rust,rs);
  m.spec=mix(.4,.06,rs)*(1.-chip*.3); m.gloss=mix(46.,8.,max(rs,chip*.5)); }
void matRust(inout Mat m, vec3 p, vec3 n, float amt){
  float r=smoothstep(.5,.8,triN(p*1.3,n,.8)+(1.-gOcc)*.4+amt-.5);
  m.alb=mix(m.alb,mix(vec3(.25,.085,.03),vec3(.48,.2,.06),gCheap>.5?.5:triN(p,n,7.)),r); m.spec*=1.-r*.8; m.gloss=mix(m.gloss,8.,r); }
// cast bronze (the ring): blackened patina with a hammered high-frequency grain, dark runs, cavities that blacken and
// polished wear on the arrises (edge 0..1 from the part's own profile). No low-frequency blotches ("camo").
void matBronze(inout Mat m, vec3 p, vec3 n, vec3 base, float edge){
  float fine=gCheap>.5?.5:triN(p,n,7.)*.55+triN(p,n,19.)*.45;
  float mid=triN(p,n,2.3);
  vec3 c=base*(.78+.4*fine)*(.92+.16*mid);
  float run=smoothstep(.5,.85,n2(vec2((p.x+p.z)*2.7,p.y*.09)))*(gCheap>.5?.5:1.);
  c=mix(c,c*vec3(.5,.46,.42),run*.6);
  c=mix(c,c*.55,SAT((1.-gOcc)*1.3));
  float w=SAT(edge*(.65+.7*fine));
  m.alb=mix(c,vec3(.62,.44,.25)*(.8+.35*fine),w); m.spec=mix(.3,.85,w); m.gloss=mix(20.,110.,w); }
// the ring ignites: heat collects on the arrises and in the grooves, flickering at a small scale (not one big blotch)
vec3 igniteEmi(vec3 p, float edge, float amt){
  float f=n2(p.xy*1.3+vec2(0.,T*1.7))*.6+n2(p.yz*3.1-vec2(T*.9,0.))*.4;
  return vec3(1.,.07,.05)*amt*(.7+2.6*SAT(edge)+1.2*(1.-gOcc)+.9*f); }
// wet ground: mirror puddles in the low spots of a noise mask, damp sheen elsewhere. wet 0..1
void matWet(inout Mat m, vec3 p, float wet){
  float pud=smoothstep(.5,.56,n2(p.xz*.08)*.62+n2(p.xz*.23)*.38+wet*.3-.14);
  float damp=wet*(.45+.55*n2(p.xz*.27+5.));
  m.alb*=mix(1.,.5,max(pud,damp*.55));
  m.spec=mix(m.spec,.9,max(pud,damp*.4)); m.gloss=mix(m.gloss,300.,pud);
  m.refl=max(m.refl,pud*.92+damp*.22); }
// terrain: grass/dust on the flats, rock strata on the slopes
void matEarth(inout Mat m, vec3 p, vec3 n, vec3 flat_, vec3 rock){
  float sl=smoothstep(.72,.9,n.y); float v=triN(p,n,.15)*.6+triN(p,n,.5)*.4;
  vec3 r=rock*(.7+.5*v)*(.85+.15*sin(p.y*1.7+v*6.));
  vec3 f=flat_*(.88+.2*n2(p.xz*.03))*(.92+.14*(gCheap>.5?.5:n2(p.xz*1.7)));
  m.alb=mix(r,f,sl); m.spec=.04; m.gloss=8.; }
// figures: dark cloth, read as silhouettes with a rim; part .2 = the red scarf
void matFigure(inout Mat m, vec3 p, float part){
  m.alb=vec3(.034,.032,.031)*(.75+.5*n3(p*11.)); m.spec=.12; m.gloss=10.; m.rim=1.;
  if(part>.15){ m.alb=vec3(.5,.025,.035); m.spec=.15; m.rim=.7; } }
// ---- figures
vec3 legIK(float th, float kn, float L, out vec3 knee){ knee=L*vec3(sin(th),-cos(th),0.); return knee+L*vec3(sin(th-kn),-cos(th-kn),0.); }
// FIGURE: an articulated worker (~1.8 m) in local space facing +x, feet on y=0. ph = stride phase (rad, about 2 per metre walked),
// g = gait 0 (standing) .. 1 (full stride), coat 0 (jacket) .. 1 (long coat + hood). Tapered limbs with smooth-min joints;
// the pelvis height plants the lower foot. Returns (distance, part): 0 cloth, .1 head/hood, .2 scarf.
vec2 sdFigure(vec3 p, float ph, float g, float coat){
  float s=sin(ph);
  float thL=.42*g*s, thR=-thL;
  float knL=g*(.08+.8*max(0.,sin(ph+1.1))), knR=g*(.08+.8*max(0.,sin(ph+1.1+PI)));
  vec3 kL, kR; vec3 aL=legIK(thL,knL,.44,kL), aR=legIK(thR,knR,.44,kR);
  float hy=.09-min(aL.y,aR.y);
  vec3 P=vec3(0,hy,0), C=P+vec3(.03+.05*g,.44,0.), N=C+vec3(.02,.15,0.), H=N+vec3(.035,.11,0.);
  vec3 hl=P+vec3(0,-.04,.1), hr=P+vec3(0,-.04,-.1);
  float legs=min(min(sdLimb(p,hl,hl+kL,.095,.065),sdLimb(p,hl+kL,hl+aL,.065,.05)),min(sdLimb(p,hr,hr+kR,.095,.065),sdLimb(p,hr+kR,hr+aR,.065,.05)));
  legs=min(legs,min(sdLimb(p,hl+aL,hl+aL+vec3(.17,-.035,0.),.055,.045),sdLimb(p,hr+aR,hr+aR+vec3(.17,-.035,0.),.055,.045)));
  vec3 q=p; q.x*=1.3;
  float tor=sdLimb(q,P*vec3(1.3,1,1),C*vec3(1.3,1,1),.16,.2)/1.3;
  float hem=hy-.1-.38*coat;
  float ct=sdLimb(q,(C+vec3(0,.03,0))*vec3(1.3,1,1),vec3(-.03*1.3,hem,0.),.19,.21+.1*coat)/1.3; tor=min(tor,max(ct,hem-p.y));
  vec3 SL=C+vec3(0,.06,.2), SR=C+vec3(0,.06,-.2);
  float al=-.38*g*s, ar=-al;
  vec3 eL=SL+.29*vec3(sin(al),-cos(al),0.), wL=eL+.27*vec3(sin(al+.35),-cos(al+.35),0.);
  vec3 eR=SR+.29*vec3(sin(ar),-cos(ar),0.), wR=eR+.27*vec3(sin(ar+.35),-cos(ar+.35),0.);
  float arms=min(min(sdLimb(p,SL,eL,.08,.062),sdLimb(p,eL,wL,.062,.046)),min(sdLimb(p,SR,eR,.08,.062),sdLimb(p,eR,wR,.062,.046)));
  tor=smin(tor,arms,.05);
  float hd=length(p-H)-.1;
  float hood=length(p-H-vec3(-.03,.02,0.))-.135; hd=coat>.5?smin(hd,hood,.02):hd;
  float body=smin(tor,hd,.05);
  float scarf=sdLimb(p,N-vec3(0,.06,0),N+vec3(.01,.02,0),.105,.088);
  vec2 r=vec2(min(body,legs),0.);
  if(hd<r.x+.004) r.y=.1;
  if(scarf<r.x) r=vec2(scarf,.2);
  return r; }
// far LOD (4 terms): coat cone, head, two legs
vec2 sdFigureLite(vec3 p, float ph, float g){
  float s=sin(ph)*.3*g;
  float body=sdLimb(p,vec3(0,.6,0),vec3(.04,1.45,0),.24,.19);
  float head=length(p-vec3(.07,1.66,0))-.12;
  float legs=min(sdLimb(p,vec3(0,.9,.1),vec3(s,.06,.1),.09,.06),sdLimb(p,vec3(0,.9,-.1),vec3(-s,.06,-.1),.09,.06));
  return vec2(min(smin(body,head,.05),legs),0.); }
// silhouette LOD (under ~12 march px tall): one tapered body and a head, no limbs. At 0.4 scale thin limbs alias into
// rows of glyph-like squiggles; a coverage-sized blob reads as a person and stays stable in motion.
vec2 sdFigureBlob(vec3 p, float ph, float g){
  float s=sin(ph)*.1*g;
  float body=sdLimb(p,vec3(s,.04,0),vec3(.04,1.42,0),.2,.24);
  return vec2(smin(body,length(p-vec3(.06,1.63,0))-.14,.08),0.); }
// a figure with LOD by projected size and ray kind: full on primary rays within ~70 m, lite, then the blob.
// Crowds switch to a pre-filtered density band below ~6 march px (FIG_BAND): see kit.crowd and the monument terraces.
#define FIG_BLOB .15
#define FIG_BAND .3
vec2 figure(vec3 q, vec3 wp, float ph, float g, float coat){
  float d=length(wp-CP);
  if(d*gPix>FIG_BLOB) return sdFigureBlob(q,ph,g);
  return (gFine>.5&&d<70.)?sdFigure(q,ph,g,coat):sdFigureLite(q,ph,g); }
`;

// ------------------------------------------------------------------ GLSL: lighting, march, AA pass
const LIGHT = /* glsl */`
#ifndef DETAIL_Y0
#define DETAIL_Y0 0.
#endif
#ifndef OMEGA
#define OMEGA 1.2
#endif
#ifndef RFAR
#define RFAR 200.
#endif
#ifdef DETAIL
vec2 mapS(vec3 p){ return opU(mapObj(p), mapDetail(p)); }
#else
#define mapS mapObj
#endif
vec2 map(vec3 p){
#ifdef GROUND
  return opU(mapS(p), vec2(p.y, 0.));
#else
  return mapS(p);
#endif
}
#ifdef SHDETAIL
#define mapSh mapS
#else
#define mapSh mapObj
#endif
vec3 normalAt(vec3 p, float t){ vec2 e=vec2(1,-1)*max(.0015*t,.004);
  return normalize(e.xyy*map(p+e.xyy).x+e.yyx*map(p+e.yyx).x+e.yxy*map(p+e.yxy).x+e.xxx*map(p+e.xxx).x); }
float shadow(vec3 ro, vec3 rd, float k){ float r=1., t=.08; gFine=0.;
  for(int i=0;i<SHSTEPS;i++){ float h=mapSh(ro+rd*t).x; r=min(r,k*h/t);
    t+=clamp(h,.05+t*.02,SHMAX/float(SHSTEPS)*3.); if(r<.002||t>SHMAX) break; }
  gFine=1.; return SAT(r); }
#ifndef VSMIN
#define VSMIN 1.
#endif
float hardShadow(vec3 ro, vec3 rd){ float t=.3; for(int i=0;i<VSTEPS;i++){ float h=mapObj(ro+rd*t).x; if(h<.02*t) return 0.; t+=max(h,VSMIN); if(t>VSHMAX) break; } return 1.; }
float ao(vec3 p, vec3 n){ gFine=0.; float o=0., s=1.; for(int i=1;i<=AOSTEPS;i++){ float h=AOR*float(i)/float(AOSTEPS); o+=(h-map(p+n*h).x)*s; s*=.7; } gFine=1.; return SAT(1.-o*1.6/AOR); }
#ifndef HITK
#define HITK .0005
#endif
#ifndef SKY
vec3 sky(vec3 rd){ float y=max(rd.y,0.); vec3 c=mix(SKYH,SKYT,pow(y,.4)); float s=max(dot(rd,SUN),0.);
  c+=SUNC*(pow(s,600.)*18.+pow(s,24.)*.25+pow(s,4.)*.08);
#ifdef CLOUDS
  // prefiltered: cp's footprint per pixel grows as 1/(rd.y+.06)^2 toward the horizon, where the upper octaves alias into
  // dashed streaks; fade their contrast by that footprint and let the band thin out before the horizon
  vec2 cp=rd.xz/(rd.y+.06); float fp=gPix*length(rd.xz)/((rd.y+.06)*(rd.y+.06))*2.6;
  float cf=fbm(cp*vec2(1.1,2.6)+vec2(T*.02,0.)); cf=mix(cf,.5,SAT(fp*1.5-.1));
  float cl=smoothstep(.5,.85,cf)*smoothstep(.03,.25,rd.y);
  c=mix(c,(SKYH*.8+SUNC*.12*pow(s,3.))*CLOUDS,cl*.6);
#endif
  return c; }
#endif
#ifndef VOLDENS
float volDens(vec3 p){ return exp(-max(p.y,0.)*FOGH); }
#endif
vec3 aces(vec3 x){ return SAT((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14)); }
vec3 fogRay(vec3 col, vec3 ro, vec3 rd, float t){
  float fk=rd.y*FOGH, fa=FOGD*exp(-ro.y*FOGH)*(abs(fk)>1e-5?(1.-exp(-t*fk))/fk:t); float fog=1.-exp(-max(fa,0.));
  return mix(col,FOGC+SUNC*pow(SAT(dot(rd,SUN)),6.)*FOGS,fog); }
vec3 skyFog(vec3 rd, vec3 ro){ vec3 col=sky(rd); float fog=1.-exp(-FOGD*FAR*exp(-ro.y*FOGH)*pow(1.-SAT(rd.y),6.)*.25);
  return mix(col,FOGC+SUNC*pow(SAT(dot(rd,SUN)),6.)*FOGS,fog); }
// one primary ray: returns display-space colour (exposure, ACES, gamma) + shaft mask; t, id and in-scatter out
float gRefl=0.;
vec3 gWW;
// the primary ray through pixel fc (march res): origin, direction, one pixel's cone per metre
void camRay(vec2 fc, out vec3 ro, out vec3 rd, out float pixK){
  vec2 uv=(fc*2.-R)/R.y;
  vec3 ww=normalize(CT-CP); vec3 up=vec3(sin(ROLL),cos(ROLL),0.); vec3 uu=normalize(cross(ww,up)); vec3 vv=cross(uu,ww);
  float fl=1./tan(radians(FOV)*.5);
  rd=normalize(uv.x*uu+uv.y*vv+ww*fl); ro=CP; pixK=2./(fl*R.y); gWW=ww; }
#ifdef PRE_ON
// coarse cone-march seed (1/4 res, see PREPASS): min safe start distance over the 2x2 nearest tiles, and whether all of
// them left the scene without touching mapObj (sky-only tile: skip the march)
uniform sampler2D PRE; uniform vec2 PRER;
float preSeed(vec2 fc, out bool skyOnly){
  vec2 cp=fc/4.-.5; ivec2 c0=ivec2(floor(cp)); float l=1., sk=1.;
  for(int k=0;k<4;k++){ vec4 q=texelFetch(PRE,clamp(c0+ivec2(k&1,k>>1),ivec2(0),ivec2(PRER)-1),0); l=min(l,q.r+q.g/255.); sk=min(sk,q.b); }
  skyOnly=sk>.5; return .1*exp(l*log(FAR*20.)); }
#endif
vec4 trace(vec2 fc, out float tOut, out float idOut, out vec3 vsOut){
  gRefl=0.;
  vec3 ro, rd; float pixK; camRay(fc,ro,rd,pixK); vec3 ww=gWW;
  gPix=pixK;
  float tmax=FAR, tg=1e9;
#ifdef GROUND
  if(rd.y<0.){ tg=-ro.y/rd.y; tmax=min(tmax,tg); }
#endif
  // enhanced sphere tracing: over-relaxed steps, falling back to plain steps once the bounding spheres stop overlapping.
  // Over-relaxation is clamped toward 1 for grazing rays and far along the ray (it skipped thin crests there and left
  // dashed streaks at the horizon); a step that lands inside (non-Lipschitz terrain, over-relaxation) backs out.
  float t=.1, om=OMEGA, prevR=0., stepL=0., hk=max(HITK,pixK*.5); vec2 h=vec2(1e5,-1.); bool hit=false, skipM=false;
#ifdef PRE_ON
  t=max(t,preSeed(fc,skipM)); if(skipM) t=tmax+1.;
#endif
  float gz=smoothstep(.03,.15,abs(rd.y)), omFar=FAR*.3;
  for(int i=0;i<STEPS;i++){
    if(skipM) break;
    h=mapObj(ro+rd*t); float r=h.x;
    if(r<0.&&r<-hk*t){ t=max(.1,t+r*1.2); om=1.; stepL=0.; prevR=0.; continue; }
    om=min(om,1.+(OMEGA-1.)*gz*SAT(1.-t/omFar));
    bool fail=om>1.&&(abs(r)+prevR)<stepL;
    if(fail){ stepL-=om*stepL; om=1.; } else stepL=r*om*RELAX;
    prevR=abs(r);
    if(!fail&&r<hk*t){ hit=true; break; }
    t+=stepL; if(t>tmax) break; }
  if(!hit&&!skipM&&t<tmax&&h.x<pixK*t*4.+.01) hit=true;                // budget ran out within ~4 px of a surface: take it (no sky holes)
  if(skipM) t=min(t,tmax+1.);
#ifdef DETAIL
  { float ta=0., tb=hit?t:min(tmax,FAR);
    if(abs(rd.y)>1e-4){ float t0=(DETAIL_Y0-ro.y)/rd.y, t1=(DETAIL_Y0+DETAIL-ro.y)/rd.y; ta=max(ta,min(t0,t1)); tb=min(tb,max(t0,t1)); }
    else if(ro.y>DETAIL_Y0+DETAIL||ro.y<DETAIL_Y0) tb=-1.;
    if(tb>ta){ float td=max(ta,.1);
      for(int i=0;i<DSTEPS;i++){ vec2 hd=mapDetail(ro+rd*td); if(hd.x<max(.0015,pixK*.5)*td){ t=td; h=hd; hit=true; break; } td+=hd.x; if(td>tb) break; } }
  }
#endif
#ifdef GROUND
  if(!hit && tg<FAR){ t=tg; h=vec2(0.,0.); hit=true; }
#endif
  vec3 col; float mask=0.;
  if(hit){
    vec3 p=ro+rd*t; vec3 n=h.y==0.&&abs(p.y)<.01?vec3(0,1,0):normalAt(p,t);
#ifdef AAPASS
    float occ=.8; gCheap=1.;
#else
    float occ=ao(p,n);
#endif
    gOcc=occ; gT=t;
    Mat m=Mat(vec3(.7),.1,16.,vec3(0),0.,0.);
#ifndef NOMAT
    material(p,n,h.y,m);
#endif
    float dif=SAT(dot(n,SUN)); float sh=dif>0.?shadow(p+n*(.03+.002*t),SUN,SHK):0.;
    vec3 hal=normalize(SUN-rd); float fres=pow(1.-SAT(dot(n,-rd)),5.);
    float spe=pow(SAT(dot(n,hal)),m.gloss)*m.spec*(0.04+.96*fres)*(m.gloss+8.)/25.;
    vec3 skyAmb=mix(GRND, SKYT*.6+SKYH*.4, n.y*.5+.5);
    float bounce=SAT(-n.y*.5+.5)*SAT(1.-p.y*.02);
    col=m.alb*(SUNC*dif*sh + skyAmb*AMB*occ + GRND*bounce*.25*occ) + SUNC*min(spe,50.)*sh*1.5 + m.emi;
    vec3 Lr=normalize(ww+vec3(0,.35,0));                               // rim: a kicker behind the subject catches the silhouette edges
    col+=RIM.rgb*(RIM.a+m.rim)*SAT(dot(n,Lr)+.3)*pow(1.-SAT(dot(n,-rd)),2.5)*(.35+.65*occ);
    gRefl=m.refl*(.3+.7*fres)*SAT(1.-t/RFAR);          // wet floors: mirrored in the post pass (screen-space reflection)
    col=fogRay(col,ro,rd,t);
  } else { t=FAR*2.; col=skyFog(rd,ro);
    mask=SAT(pow(max(dot(rd,SUN),0.),8.)*2.+(col.r+col.g+col.b)*.05); h.y=-1.; }
  vec3 vs=vec3(0);
#if VOLN>0
  { // shadowed single-scatter sun in-scatter. Jitter is blue noise from the pixel (stable on holds, no boiling in the shafts,
    // and no IGN crosshatch for the camera to pan through); the post pass blurs it depth-aware, so few samples read smooth.
    float tm=min(t,VFAR), dt=tm/float(VOLN), j=bn(fc); float acc=0.;
    for(int i=0;i<VOLN;i++){ float ti=dt*(float(i)+j); vec3 q=ro+rd*ti; float de=volDens(q);
      acc+=de*hardShadow(q,SUN)*exp(-FOGD*de*ti)*FOGD*dt; }
    float mu=SAT(dot(rd,SUN)); float ph=.12+.9*pow(mu,10.)+.25*mu*mu;
    vs=SUNC*VOLA*ph*acc; }
#endif
  tOut=t; idOut=h.y; vsOut=vs;
  col*=EXPO; col=aces(col); col=pow(col,vec3(1./2.2));
  return vec4(col,mask); }
#if defined(PREPASS)
// COARSE CONE-MARCH PREPASS (1/4 res): one ray per 4x4 tile marched with a cone wide enough to cover the rays of the
// 2x2 tiles nearest any fine pixel (6 fine px per metre of ray). Every sphere the loop steps through contains those
// rays, so the distance before the last step is a safe start for all of them; a tile that leaves the scene without
// touching mapObj is sky-only (or ground-only) and the fine pass skips its march. Writes packed log t (floored, so the
// decode never overshoots) and the sky flag. Plain steps, no over-relaxation, full displacement (conservative).
layout(location=0) out vec4 o;
void main(){
  vec3 ro, rd; float pixK; camRay(gl_FragCoord.xy*4.,ro,rd,pixK);
  float cone=pixK*6., tmax=FAR;
#ifdef GROUND
  if(rd.y<0.) tmax=min(tmax,-ro.y/rd.y);
#endif
  float t=.1, tp=.1; bool stop=false;
  for(int i=0;i<STEPS;i++){ float r=mapObj(ro+rd*t).x; if(r<cone*t){ stop=true; break; } tp=t; t+=r; if(t>tmax) break; }
  float l=SAT(log(max(tp,.1)/.1)/log(FAR*20.))*.9999;
  o=vec4(floor(l*255.)/255.,floor(fract(l*255.)*255.)/255.,(!stop&&t>tmax)?1.:0.,1.); }
#elif defined(AAPASS)
// EDGE AA: pixels on a silhouette (second difference of the log depth: a plane's gradient does not count) or a material
// change get extra sub-pixel rays, alpha-blended onto the march colour (weight taps / (taps + 1)); the rest write alpha 0 and
// return at once, which SwiftShader skips per quad (neither a stencil mask nor discard skips the shading there).
uniform sampler2D PD; uniform float EDGE, AAW;
layout(location=0) out vec4 o;
vec2 dk(ivec2 q){ vec4 k=texelFetch(PD,clamp(q,ivec2(0),ivec2(R)-1),0); return vec2(k.r+k.g/255.,k.b); }
void main(){
  ivec2 ip=ivec2(gl_FragCoord.xy);
  vec2 d0=dk(ip), a=dk(ip+ivec2(1,0)), b=dk(ip-ivec2(1,0)), c=dk(ip+ivec2(0,1)), d=dk(ip-ivec2(0,1));
  float e=max(abs(a.x+b.x-2.*d0.x),abs(c.x+d.x-2.*d0.x));
  float ie=max(max(abs(d0.y-a.y),abs(d0.y-b.y)),max(abs(d0.y-c.y),abs(d0.y-d.y)));
  if(e<EDGE&&(ie<.003||e<EDGE*.25)){ o=vec4(0); return; }   // not an edge: alpha 0 keeps the march colour (return, unlike discard, skips the rest)
  float tt, ii; vec3 vv;
  vec3 s=trace(gl_FragCoord.xy+vec2(-.33,.3),tt,ii,vv).rgb;
#if AATAPS>1
  s+=trace(gl_FragCoord.xy+vec2(.3,-.33),tt,ii,vv).rgb;
#endif
  o=vec4(s/float(AATAPS),AAW); }
#else
layout(location=0) out vec4 o;
layout(location=1) out vec4 o2;
layout(location=2) out vec4 o3;
void main(){
  float t, id; vec3 vs; o=trace(gl_FragCoord.xy,t,id,vs);
  o2=vec4(pow(aces(vs*EXPO),vec3(1./2.2)),1.);
  float l=SAT(log(max(t,.1)/.1)/log(FAR*20.)); float hi=floor(l*255.)/255.;
  o3=vec4(hi,fract(l*255.),fract(id*.137+.5),gRefl); }
#endif
`;

const POST = /* glsl */`#version 300 es
precision highp float;
#define SAT(x) clamp(x,0.,1.)
uniform sampler2D A, V, D, BN; uniform float VOL; uniform vec2 R, SUNUV, OFF; uniform float RAYS, BLOOM, THR, VIG, SAT_, CON, KICK, FLASH, T, GRAIN, CREAM, CRUSH;
uniform vec3 LIFT, GAIN, TINT;
uniform vec3 CP, CW, CU, CV, SUN, SUNC, SKYT, SKYH, FOGC; uniform float FL, LNK, EXPO, FOGD, FOGH, FOGS, FARD;
out vec4 o;
float h21(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
float bn(vec2 fc){ return texelFetch(BN,ivec2(fc)&63,0).r; }
float dl(vec2 f){ vec4 k=texelFetch(D,ivec2(clamp(f,vec2(0),R-1.)),0); return k.r+k.g/255.; }
float dep(vec2 f){ return .1*exp(dl(f)*LNK); }
vec2 toScreen(vec3 q){ vec3 d=q-CP; float z=max(dot(d,CW),.01); return (vec2(dot(d,CU),dot(d,CV))/z*FL*R.y+R)*.5; }
// screen-space reflection for wet floors (reflectivity in D.a): march the mirrored ray against the log depth, refine the
// hit by bisection, and blend toward the sky + fog fallback by hit confidence (screen-edge distance, how solidly the ray
// is behind the surface, march distance), so the fallback feathers in instead of breaking into salt and pepper.
vec3 ssr(vec2 fc, float k){
  vec2 uv=(fc*2.-R)/R.y; vec3 rd=normalize(uv.x*CU+uv.y*CV+CW*FL); float t=dep(fc); vec3 p=CP+rd*t;
  float j=bn(fc); vec3 r=normalize(reflect(rd,vec3(0,1,0))+vec3(j-.5,0.,bn(fc+vec2(23.,41.))-.5)*.006);
  float y=max(r.y,0.); vec3 c=mix(SKYH,SKYT,pow(y,.55)); float sn=max(dot(r,SUN),0.); c+=SUNC*(pow(sn,24.)*.25+pow(sn,4.)*.08);
  float fog=1.-exp(-FOGD*FARD*exp(-p.y*FOGH)*pow(1.-y,6.)*.25); c=mix(c,FOGC+SUNC*pow(sn,6.)*FOGS,fog);
  vec3 fb=pow(aces(c*EXPO),vec3(1./2.2));
  float s=.4+j*.4, sp=0.;
  for(int i=0;i<18;i++){ vec3 q=p+r*s; vec3 d=q-CP; if(dot(d,CW)<.1) break;
    vec2 g=toScreen(q); if(g.x<0.||g.y<0.||g.x>R.x||g.y>R.y) break;
    float ts=dep(g), dq=length(d), th=max(1.5,s*.35);
    if(ts<dq-.05&&dq-ts<th){
      float a=sp, b=s;
      for(int k=0;k<3;k++){ float m=(a+b)*.5; vec3 qm=p+r*m; if(dep(toScreen(qm))<length(qm-CP)-.05) b=m; else a=m; }
      vec3 qh=p+r*b; g=toScreen(qh); float dh=length(qh-CP)-dep(g);
      vec2 e=min(g,R-g)/R.y; float conf=SAT(min(e.x,e.y)*14.)*(1.-.6*SAT(dh/th))*(1.-.5*float(i)/18.);
      return mix(fb,texture(A,g/R).rgb,conf); }
    sp=s; s*=1.28; }
  return fb; }
void main(){
  vec2 fc=gl_FragCoord.xy-OFF; vec2 uv=fc/R; vec3 c=texture(A,uv).rgb;
  float rk=texelFetch(D,ivec2(fc),0).a;
  if(rk>.01) c=mix(c,ssr(fc,rk),rk);
  if(VOL>0.){ // depth-aware blur of the in-scatter: a blue-noise-rotated golden spiral, weighted by log-depth similarity
    float d0=dl(fc), a0=bn(fc)*6.2832; vec3 v=textureLod(V,uv,1.).rgb*.5; float ws=.5;
    for(int i=0;i<12;i++){ float a=a0+float(i)*2.39996, rr=1.2+float(i)*.55; vec2 f=fc+vec2(cos(a),sin(a))*rr;
      float w=exp(-abs(dl(f)-d0)*70.); v+=textureLod(V,f/R,1.).rgb*w; ws+=w; }
    v/=ws; c=1.-(1.-c)*(1.-v); }
  if(BLOOM>0.){ vec3 b=textureLod(A,uv,2.).rgb*.35+textureLod(A,uv,3.5).rgb*.35+textureLod(A,uv,5.).rgb*.3;
    c+=max(b-THR,0.)*BLOOM*(1.+KICK); }
  if(RAYS>0.){ vec2 d=(SUNUV-uv)/24.; vec2 p=uv; float acc=0., w=1.; float j=bn(fc);
    p+=d*j; for(int i=0;i<24;i++){ acc+=textureLod(A,p,1.).a*w; w*=.93; p+=d; }
    c+=TINT*acc*RAYS/12.; }
  c=(c-.5)*(1.+CON)+.5; float l=dot(c,vec3(.299,.587,.114)); c=mix(vec3(l),c,SAT_);
  c=c*GAIN+LIFT*(1.-c);
  c=max(c-CRUSH,0.)/(1.-CRUSH);                                          // black point: silhouettes go to ink
  l=dot(c,vec3(.299,.587,.114)); c=mix(c,vec3(.957,.902,.816)*(l*.35+.72),smoothstep(.55,.95,l)*CREAM);   // cream highlight key
  vec2 q=uv-.5; c*=1.-VIG*dot(q,q)*2.2;
  c+=(h21(fc*1.37+fract(T*3.1)*101.)-.5)*GRAIN;
  c=mix(c,vec3(.957,.902,.816),FLASH);
  o=vec4(clamp(c,0.,1.),1.); }`;

const UPSCALE = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D P; uniform vec2 RS, RO; uniform float SHARP;
out vec4 o;
void main(){
  vec2 uv=gl_FragCoord.xy/RO;
  // Catmull-Rom in 5 bilinear taps, then a sharpen against the plain bilinear value, clamped to the taps' range (no ringing)
  vec2 sp=uv*RS; vec2 t1=floor(sp-.5)+.5; vec2 f=sp-t1;
  vec2 w0=f*(-.5+f*(1.-.5*f)), w1=1.+f*f*(-2.5+1.5*f), w2=f*(.5+f*(2.-1.5*f)), w3=f*f*(-.5+.5*f);
  vec2 w12=w1+w2, t12=(t1+w2/w12)/RS, t0=(t1-1.)/RS, t3=(t1+2.)/RS;
  vec3 a=textureLod(P,vec2(t0.x,t12.y),0.).rgb, b=textureLod(P,vec2(t12.x,t0.y),0.).rgb, c=textureLod(P,t12,0.).rgb,
       d=textureLod(P,vec2(t3.x,t12.y),0.).rgb, e=textureLod(P,vec2(t12.x,t3.y),0.).rgb;
  vec3 cr=(a*w0.x*w12.y+b*w12.x*w0.y+c*w12.x*w12.y+d*w3.x*w12.y+e*w12.x*w3.y)/(w0.x*w12.y+w12.x*w0.y+w12.x*w12.y+w3.x*w12.y+w12.x*w3.y);
  vec3 bl=textureLod(P,uv,0.).rgb;
  o=vec4(clamp(cr+(cr-bl)*SHARP,min(min(min(a,b),min(d,e)),c),max(max(max(a,b),max(d,e)),c)),1.); }`;

const PACK = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D D; out vec4 o;
void main(){ o=texelFetch(D,ivec2(gl_FragCoord.xy),0); }`;

// ------------------------------------------------------------------ looks: sun / sky / fog / rim / post bundles
// Colours are linear RGB (can exceed 1). Any field can be overridden per render: render(t, { look: LOOKS.RED_SUN, fog: { density } }).
// `three` carries matching settings for world3d.applyLook() (sRGB hex), so an SDF shot and a three.js shot cut together.
export const LOOKS = {
  // low warm sun through haze, long shadows, shafts: the mythic morning
  DAWN: { sun: { dir: [-0.32, 0.2, -1], color: [2.4, 1.5, 0.9] }, sky: { top: [0.06, 0.07, 0.13], horizon: [0.75, 0.42, 0.28], ground: [0.2, 0.16, 0.16] },
    fog: { color: [0.3, 0.21, 0.2], density: 0.0021, falloff: 0.012, scatter: 0.16 }, amb: 0.55, exposure: 0.75, rim: [1, 0.82, 0.6, 0.05],
    post: { rays: 0.6, rayTint: [1, 0.72, 0.45], bloom: 0.5, threshold: 0.65, contrast: 0.18, vignette: 0.55, cream: 0.15 },
    three: { sun: '#ffb070', sunI: 3.2, hemiSky: '#8a90b8', hemiGround: '#3a2418', hemiI: 0.8, fog: '#b07058', fogD: 0.0012, skyTop: '#23233c', exposure: 1.3 } },
  // hard white noon, blue sky, cold fill: the brutalist catalogue read
  NOON: { sun: { dir: [-0.75, 0.55, 0.38], color: [2.1, 2.0, 1.8] }, sky: { top: [0.05, 0.12, 0.5], horizon: [0.4, 0.58, 0.92], ground: [0.55, 0.5, 0.45] },
    fog: { color: [0.62, 0.72, 0.92], density: 0.0012, falloff: 0.01, scatter: 0.3 }, amb: 0.65, exposure: 0.66, rim: [1, 0.95, 0.85, 0],
    post: { bloom: 0.35, threshold: 0.75, contrast: 0.14, vignette: 0.35, sat: 1.0 },
    three: { sun: '#fff2e0', sunI: 3.4, hemiSky: '#9fb8ff', hemiGround: '#6a5a48', hemiI: 1.0, fog: '#a8bce0', fogD: 0.0009, skyTop: '#3050a0', exposure: 1.0 } },
  // a red sun low behind the subject: black silhouettes, cream rims, red only in the sky band and the emissives.
  // Keeps a cream/black value key (crush + cream highlights) so the frame is never a uniform red wash.
  RED_SUN: { sun: { dir: [0.3, 0.2, -1], color: [3.0, 0.62, 0.34] }, sky: { top: [0.002, 0.002, 0.003], horizon: [0.17, 0.02, 0.018], ground: [0.03, 0.022, 0.02] },
    fog: { color: [0.035, 0.018, 0.018], density: 0.0017, falloff: 0.013, scatter: 0.05 }, amb: 0.22, exposure: 0.95, rim: [1.0, 0.88, 0.72, 0.9],
    post: { rays: 0.45, rayTint: [1, 0.7, 0.55], bloom: 0.55, threshold: 0.66, contrast: 0.3, vignette: 0.65, cream: 0.6, crush: 0.06, sat: 0.95 },
    three: { sun: '#ff5a30', sunI: 3.0, hemiSky: '#402028', hemiGround: '#100808', hemiI: 0.35, fog: '#2a0d0c', fogD: 0.0013, skyTop: '#050306', exposure: 1.2 } },
  // sodium floodlight key from low left, cold blue night sky, moon rim: the citadel at night
  SODIUM_NIGHT: { sun: { dir: [0.85, 0.14, 0.5], color: [2.3, 1.1, 0.34] }, sky: { top: [0.008, 0.012, 0.035], horizon: [0.07, 0.07, 0.11], ground: [0.05, 0.04, 0.035] },
    fog: { color: [0.05, 0.045, 0.06], density: 0.0014, falloff: 0.01, scatter: 0.12 }, amb: 0.3, exposure: 1.0, rim: [0.6, 0.72, 1.0, 0.3],
    post: { bloom: 0.8, threshold: 0.5, contrast: 0.16, vignette: 0.55, cream: 0.2, crush: 0.02 },
    three: { sun: '#ff9a40', sunI: 0.25, hemiSky: '#303a60', hemiGround: '#1a1010', hemiI: 0.3, fog: '#1a1622', fogD: 0.0015, skyTop: '#05060c', exposure: 1.0 } },
};
LOOKS.DUSK = { ...LOOKS.DAWN, sun: { dir: [0.8, 0.16, 0.6], color: [2.6, 1.3, 0.7] }, three: { ...LOOKS.DAWN.three, sun: '#ffa060', sunI: 3.0 } };

// ------------------------------------------------------------------ hand-written worlds
// Each declares `params` (name -> 'Uk.c' slot, or [slot] for a vec4 object) with `defaults`; render(t, { name: value }) maps them.
export const WORLDS = {
  // THE FORTRESS: white board-formed brutalist keep, ACP mark on its face, wet plaza, workers in dark coats.
  fortress: {
    params: { mark: 'U0.x', cloud: 'U0.y', gateGlow: 'U0.z', walk: 'U0.w', markRed: 'U1.x', hero: [2, ['x', 'z', 'heading', 'phase']], wet: 'U1.y' },
    defaults: { mark: 1, cloud: 0.05, gateGlow: 0.25, walk: 0, markRed: 0, hero: [0, 0, 0, -1], wet: 0.6 },
    figures: ['hero'],
    defines: { GROUND: 1, DETAIL: 2.1, DSTEPS: 32, FAR: 900, STEPS: 84, SHSTEPS: 18, SHMAX: 160, SHK: 24, AOSTEPS: 2, AOR: 3, RELAX: 0.9, OMEGA: 1.3, RFAR: 220, VOLN: 0, VSTEPS: 1, VSHMAX: 1, VFAR: 1, SKY: 1 },
    glsl: /* glsl */`
vec2 hero(vec3 p){                       // U2 = (x, z, heading, stride phase); phase < 0 = no hero
  if(U[2].w<0.) return vec2(1e5,0);
  vec3 q=p-vec3(U[2].x,0,U[2].y); q.xz=rot(U[2].z)*q.xz; float b=sdCap(q,vec3(0,.3,0),vec3(0,1.6,0),.8);
  if(b>.3) return vec2(b,5.);
  vec2 f=sdFigure(q,U[2].w,1.,1.); return vec2(f.x,5.+f.y); }
vec2 mapDetail(vec3 p){
  vec2 hr=hero(p);
  float rb=sdBox(p-vec3(0,1.1,96),vec3(70,1.1,54)); if(rb>.3) return hr.x<rb?hr:vec2(rb,0);
  vec2 cell=vec2(9.,8.); vec2 id=floor(p.xz/cell); vec2 r=h22(id+3.); vec2 c=(id+.5)*cell;
  float edge=-sdBox2(p.xz-c,cell*.5)+.25;
  if(r.x<.4||(c.y<60.&&abs(c.x)<22.)) return hr.x<edge?hr:vec2(edge,0);
  float walk=step(.35,r.y); float sp=.35+.4*r.y; float ph=U[0].w*sp*.25+r.x*7.;       // pacing at ~1-2 m/s
  float tri=abs(fract(ph)*2.-1.); float dir=fract(ph)<.5?-1.:1.;
  vec3 q=p; q.xz-=c+vec2((r.x-.7)*2.,(r.y-.5)*3.); q.x-=walk*(tri-.5)*5.; q.x*=mix(1.,dir,walk);
  if(r.y>.8){ q.xz=rot(r.x*6.)*q.xz; }
  float d=sdCap(q,vec3(0,.3,0),vec3(0,1.6,0),.75);
  vec2 res=vec2(min(d,edge),5.);
  if(d<.3){ vec2 f=figure(q,p,walk*U[0].w*6.+r.x*9.,walk,step(.5,r.x)); res=vec2(min(f.x,edge),5.+f.y); }
  float crate=(r.x>.88&&c.y<110.)?sdBox(p-vec3(c.x+2.6,.55,c.y+1.8),vec3(.9,.55,.7)):1e5;
  if(crate<res.x) res=vec2(min(crate,edge),7.);
  return hr.x<res.x?hr:res; }
vec2 mapObj(vec3 p){
  vec2 r=vec2(1e5,0);
  float bb=sdBox(p-vec3(-10,62,-10),vec3(125,64,80));
  if(bb>2.) return opU(r,vec2(bb,1.));
  vec3 nF=vec3(0,.196,.981);
  float keep=sdBox(p-vec3(0,31,1),vec3(38,32,34));
  if(keep<2.){
    keep=sdBox(p-vec3(0,30,0),vec3(36,30,32));
    keep=max(keep, dot(p-vec3(0,0,32),nF));
    keep=max(keep, dot(vec3(abs(p.x),p.y,0)-vec3(36,0,0),vec3(.993,.119,0)));
    float band=abs(mod(p.y,11.)-5.5)-5.05; band=max(band,-sdBox(p-vec3(0,44,26),vec3(17.5,16.5,10.)));
    keep=max(keep,-max(band, -dot(p-vec3(0,0,32),nF)-.6));
    float px=mod(p.x+4.,8.)-4.; float pil=max(max(abs(px)-.7,dot(p-vec3(0,0,32.9),nF)),max(abs(p.x)-34.,p.y-58.));
    pil=max(pil,-sdBox(p-vec3(0,44,26),vec3(17.5,16.5,10.)));
    keep=min(keep,max(pil,-p.y+.0));
    float gate=sdBox(p-vec3(0,9.5,34),vec3(9.,9.5,16.)); float frame=sdBox(p-vec3(0,11.,33.),vec3(11.5,11.,2.2));
    keep=max(keep,-gate); keep=max(keep,-frame); keep=min(keep, max(sdBox(p-vec3(0,21.3,29.5),vec3(12.,.7,3.)),-gate));
    vec2 sc=floor(vec2(p.y/6.,p.z/7.)); float k=h21(sc+step(0.,p.x)*17.);            // side service boxes: irregular, some missing,
    float bx=36.-.1198*(sc.x*6.+3.)+.45-step(k,.4)*2.;                                   // each one bolted to the battered flank at its own height
    float sbx=sdBox(vec3(abs(p.x)-bx,mod(p.y,6.)-3.,mod(p.z,7.)-3.5),vec3(.8,.5+.7*k,.8+1.2*fract(k*7.)));
    keep=min(keep, max(sbx,max(max(p.y-50.,3.-p.y),max(p.z-(27.-.2*p.y),-29.-p.z))));
    keep=max(keep,-sdBox(p-vec3(0,1.5,19),vec3(8.9,1.6,1.)));
    keep=dispConcrete(p,keep,2.4);
  }
  float pyl=sdBox(p-vec3(0,13,38),vec3(56,14,20));
  if(pyl<2.){
    vec3 pq=p; pq.x=abs(pq.x);
    pyl=sdWedge(pq-vec3(22.,0,36.),10.,26.,22.); pyl=min(pyl, sdWedge(pq-vec3(47.,0,20.),8.,20.,26.));
    pyl=min(pyl, sdBox(p-vec3(0,1.5,40.),vec3(16.,1.5,6.)));
    pyl=min(pyl, sdStairs(p-vec3(0,0,56.),9.,.3,1.,10.));
    pyl=min(pyl, sdBox(vec3(abs(p.x)-9.6,p.y-3.6,p.z-51.),vec3(.35,.9,5.)));
    pyl=dispConcrete(p,pyl,2.4);
  }
  float crown=sdBox(p-vec3(0,96,-8),vec3(28,36,24));
  if(crown<2.){
    crown=sdBattered(p-vec3(0,66,-6),vec3(26,6,22),vec2(.25,.25));
    crown=min(crown, sdBox(p-vec3(0,76,-8),vec3(15,4.5,13)));
    crown=min(crown, sdBox(p-vec3(-6,83,-8),vec3(6,3,6)));
    crown=min(crown, sdCylY(p-vec3(-6,90,-8),2.2,5.)); crown=min(crown, sdCylY(p-vec3(-6,104,-8),.7,14.));
    crown=min(crown, sdCylY(p-vec3(-6,121,-8),.25,6.));
    crown=min(crown, sdBox(p-vec3(12,82,-14),vec3(3,2,3)));
    crown=min(crown, max(sdBox(vec3(mod(p.x,5.)-2.5,p.y-73.,p.z-7.),vec3(1.,1.,1.4)),abs(p.x)-13.));
  }
  float silo=sdBox(p-vec3(70,34,-12),vec3(30,35,32));
  float pipe=silo;
  if(silo<2.){
    vec3 sq=p-vec3(58,0,-2); silo=sdSilo(sq,8.,46.); silo=min(silo,sdSilo(sq-vec3(16,0,-14),7.,54.));
    silo=min(silo,sdSilo(sq-vec3(-4,0,-22),6.5,62.)); silo=min(silo,sdSilo(sq-vec3(26,0,10),5.,34.));
    pipe=min(sdCylX(p-vec3(47,30,4),1.1,12.),sdCylX(p-vec3(47,40,-6),.8,14.));
    pipe=min(pipe,sdCylY(p-vec3(68,20,8),.7,20.)); pipe=min(pipe,sdCylY(p-vec3(52,58,-24),.5,12.));
    pipe=min(pipe,sdCylY(p-vec3(66.5,23,-2),1.,23.));
  }
  float wing=sdBox(p-vec3(-64,38,-8),vec3(28,40,30));
  if(wing<2.){
    wing=sdBox(p-vec3(-60,14,-6),vec3(24,14,26)); wing=max(wing,dot(p-vec3(0,0,20),vec3(0,.243,.97)));
    wing=min(wing, sdBox(p-vec3(-74,26,-14),vec3(9,26,9))); wing=min(wing,sdBox(p-vec3(-74,53,-14),vec3(6,2,6)));
    wing=min(wing, sdCylY(p-vec3(-74,66,-14),.4,12.));
    vec3 dq=p-vec3(-58,34,-4); dq.yz=rot(-.6)*dq.yz; float dish=max(abs(length(dq-vec3(0,-4,0))-5.)-.25,dq.y+2.5); wing=min(wing,dish);
    wing=min(wing, sdCylY(p-vec3(-58,30,-4),.3,4.));
  }
  float back=min(sdBox(p-vec3(10,40,-72),vec3(115,40,8)),sdBox(p-vec3(70,55,-60),vec3(20,55,10)));
  r=opU(r,vec2(keep,1.)); r=opU(r,vec2(pyl,1.)); r=opU(r,vec2(crown,2.)); r=opU(r,vec2(silo,3.));
  r=opU(r,vec2(pipe,6.)); r=opU(r,vec2(wing,2.)); r=opU(r,vec2(back,9.));
  return r; }
vec3 sky(vec3 rd){ float y=max(rd.y,0.); vec3 c=mix(SKYH,SKYT,pow(y,.45));
  float s=max(dot(rd,SUN),0.); c+=SUNC*(pow(s,800.)*20.+pow(s,32.)*.2);
  vec2 cp=rd.xz/(rd.y+.08); float fp=gPix*length(rd.xz)/((rd.y+.08)*(rd.y+.08))*3.;
  float cl=mix(fbm(cp*vec2(1.2,3.)+vec2(T*U[0].y,0.)),.5,SAT(fp*1.5-.1)); cl=smoothstep(.55,.85,cl)*smoothstep(.03,.25,rd.y);
  c=mix(c,(SKYH*.9+SUNC*.12)*1.1,cl*.55);
  return c; }
void material(vec3 p, vec3 n, float id, inout Mat m){
  if(id<.5){                                   // plaza: cast slabs, joints, painted lines, wet
    float s=seams(p.xz,vec2(8.,8.),.08); matConcrete(m,p,n,vec3(.62,.61,.6),.6); m.alb*=.8+.2*s;
    float ln=step(abs(mod(p.x+4.,24.)-12.),.18)*step(40.,p.z)+step(abs(p.z-44.),.15)*step(abs(p.x),30.);
    m.alb=mix(m.alb,vec3(.6,.05,.06),ln*.75*(.6+.4*n2(p.xz*3.)));
    matWet(m,p,U[1].y);
  } else if(id<1.5||id>8.5){                   // board-formed concrete, the mark, the gate
    matConcrete(m,p,n,id>8.5?vec3(.78,.79,.8):vec3(.9,.88,.84),.75);
#ifdef DECAL_ON
    if(id<1.5&&n.z>.5&&U[0].x>0.){
      vec2 d=vec2((p.x+15.)/30., (58.-p.y)/30.);
      if(d.x>0.&&d.x<1.&&d.y>0.&&d.y<1.){ vec4 k=texture(DECAL,d); float wear=smoothstep(.15,.45,fbm(p.xy*1.7)+.2)*(1.-.5*smoothstep(.4,.9,fbm(vec2(p.x*1.3,p.y*.1))));
        float a=k.a*U[0].x*wear; m.alb=mix(m.alb,k.rgb*.9*(.85+.15*gOcc),a); m.emi+=k.rgb*vec3(1.,.2,.2)*a*U[1].x*step(.4,k.r-k.g); }
    }
#endif
    if(id<1.5&&p.z>17.5&&p.z<33.&&p.y<18.9&&p.y>.05&&abs(p.x)<8.95){
      float rib=smoothstep(.0,.08,abs(fract(p.x/1.5)-.5)-.4); float hb=step(abs(mod(p.y,4.5)-2.25),.18);
      m.alb=vec3(.09,.09,.1)*(.7+.3*rib)*(1.-hb*.5)*(.85+.3*triN(p,n,1.3)); m.spec=.45; m.gloss=40.; matRust(m,p,n,.05);
      float slit=exp(-p.x*p.x*6.)*step(p.z,18.6);
      m.emi=vec3(1.,.62,.3)*(slit*(3.+6.*U[0].z)+step(.94,fract(p.z*.3))*step(17.5,p.y)*U[0].z*2.); }
  } else if(id<2.5){ matConcrete(m,p,n,vec3(.8,.8,.79),.85);
  } else if(id<3.5){                           // silos: painted steel, riveted rings, number plates
    float ring=smoothstep(.0,.1,abs(fract(p.y/4.)-.5)-.44); matPaint(m,p,n,vec3(.86,.85,.82)*(.88+.12*(1.-ring)),.55);
    float plate=step(abs(p.y-14.),1.2)*step(.94,fract(atan(p.z+2.,p.x-58.)/6.283*6.)); m.alb=mix(m.alb,vec3(.7,.1,.09),plate);
  } else if(id<5.5){ matFigure(m,p,id-5.);
  } else if(id<6.5){ matPaint(m,p,n,vec3(.45,.46,.47),.8); matRust(m,p,n,.3);
  } else if(id<7.5){ matPaint(m,p,n,vec3(.55,.3,.1),.7); }
}
`,
  },

  // THE HALL: industrial nave, portal frames every 8 m, sawtooth skylights, machines, red banners, a wet floor that
  // mirrors the doorway, a few workers on the aisle, volumetric sun shafts through the roof.
  hall: {
    params: { sway: 'U0.x', glow: 'U0.y', dust: 'U0.z', walk: 'U0.w', wet: 'U1.x' },
    defaults: { sway: 0, glow: 0.4, dust: 0.3, walk: 0, wet: 0.8 },
    defines: { GROUND: 1, DETAIL: 2.1, DSTEPS: 24, FAR: 300, STEPS: 84, SHSTEPS: 16, SHMAX: 60, SHK: 16, AOSTEPS: 2, AOR: 2.5, RELAX: 0.85, OMEGA: 1.25, RFAR: 140, VOLN: 10, VSTEPS: 10, VSHMAX: 60, VFAR: 170, VOLDENS: 1 },
    glsl: /* glsl */`
vec2 hallBody(vec3 p);
vec2 mapDetail(vec3 p){                    // workers pacing the aisle, one per 14 m cell (some empty), U0.w = walk time
  float rb=sdBox(p-vec3(0,1.05,-60),vec3(5.,1.1,76.)); if(rb>.3) return vec2(rb,0);
  float zi=floor(p.z/14.), zc=(zi+.5)*14.; float r=h11(zi*3.7+1.);
  float edge=7.3-abs(p.z-zc);
  if(r<.35) return vec2(edge,0);
  float ph=U[0].w*.08+r*3.; float dir=fract(ph)<.5?-1.:1.; float tri=abs(fract(ph)*2.-1.);
  vec3 q=p-vec3((r-.5)*5.,0.,zc+(tri-.5)*8.); q.xz=vec2(q.z*dir,-q.x*dir);
  float d=sdCap(q,vec3(0,.3,0),vec3(0,1.6,0),.75); if(d>.3) return vec2(min(d,edge),5.);
  vec2 f=figure(q,p,U[0].w*6.+r*6.,1.,1.); return vec2(min(f.x,edge),5.+f.y); }
vec2 mapObj(vec3 p){
  float gab=sdBox(p-vec3(0,14,-138),vec3(16,14,2)); gab=max(gab,-sdBox(p-vec3(0,11,-138),vec3(6,11,4)));
  vec2 r=vec2(gab,1.); r=opU(r,vec2(sdBox(p-vec3(0,24.5,-135.8),vec3(3.2,2.8,.1)),4.));
  vec2 b=hallBody(p); b.x=max(b.x,-(p.z+136.));
  return opU(r,b); }
vec2 hallBody(vec3 p){
  vec2 r=vec2(1e5,0.);
  vec3 q=p; float zi=floor(q.z/8.); q.z=mod(q.z,8.)-4.;
  float walls=max(-(abs(p.x)-14.), abs(p.x)-15.);
  float bay=sdBox(vec3(abs(p.x)-14.5,p.y-9.,q.z),vec3(1.,4.5,2.6)); walls=max(walls,-bay);
  float col=sdBox(vec3(abs(q.x)-13.4,q.y-8.,q.z),vec3(.45,8.,.35));
  float girder=sdBox(vec3(q.x,q.y-16.6,q.z),vec3(14.,.5,.28));
  float rz=mod(p.z,8.); float roofY=17.5+rz*.45; float roof=(abs(p.y-roofY)-.25)*.9; roof=max(roof,abs(p.x)-14.5);
  float glaz=step(6.4,rz); roof=glaz>.5?1e5:roof; float ridge=sdBox(vec3(q.x,q.y-20.8,q.z-3.6),vec3(14.5,.3,.4));
  float truss=sdBox(vec3(q.x,q.y-18.6,q.z),vec3(14.,1.8,.12)); truss=max(truss,-sdBox(vec3(q.x,q.y-18.6,q.z),vec3(14.,1.5,.5)));
  truss=min(truss, sdBox(vec3(mod(q.x,3.)-1.5,q.y-18.6,q.z),vec3(.12,1.8,.12)));
  float crane=min(sdBox(vec3(abs(p.x)-12.,p.y-13.,p.z),vec3(.5,.6,400.)), sdBox(vec3(p.x,p.y-13.4,p.z+40.),vec3(12.,.8,1.2)));
  vec3 mq=vec3(abs(p.x)-6.5,p.y,q.z); float hm=h11(zi*7.3+step(0.,p.x)*3.);
  float mach=sdBox(mq-vec3(0,1.2+hm*1.5,0),vec3(2.2,1.2+hm*1.5,1.8)); mach=min(mach,sdBox(mq-vec3(0,3.+hm*3.,0.),vec3(1.4,.5,1.2)));
  mach=min(mach, sdCylZ(mq-vec3(0,2.4+hm*1.5,0),1.,2.));
  float struct_=min(min(col,girder),min(ridge,truss)); struct_=min(struct_,crane);
  float sway=sin(p.y*.4+U[0].x+zi)*.25; vec3 bq=vec3(abs(q.x)-10.,p.y,q.z-sway); float ban=mod(zi,2.)<.5?sdBox(bq-vec3(0,11.2,0),vec3(1.5,5.,.05)):1e5;
  r=opU(r,vec2(walls,1.)); r=opU(r,vec2(struct_,2.)); r=opU(r,vec2(roof,1.)); r=opU(r,vec2(mach,3.)); r=opU(r,vec2(ban,4.));
  return r; }
float volDens(vec3 p){ return (.35+.65*n3(p*.25+vec3(0,0,T*.3)))*step(p.y,20.)*(.6+U[0].z); }
void material(vec3 p, vec3 n, float id, inout Mat m){
  if(id<.5){ float s=seams(p.xz,vec2(6.,6.),.05); matConcrete(m,p,n,vec3(.4,.39,.37),.9); m.alb*=.8+.2*s; m.spec=.25; m.gloss=30.;
    float ln=step(abs(abs(p.x)-3.6),.12); m.alb=mix(m.alb,vec3(.86,.8,.7)*(.6+.4*n2(p.xz*2.)),ln*.8);
    matWet(m,p,U[1].x); }
  else if(id<1.5){ matConcrete(m,p,n,vec3(.74,.72,.69),.9); }
  else if(id<2.5){ matPaint(m,p,n,vec3(.1,.1,.105),.7); }
  else if(id<3.5){ float sf=step(.72,fract(p.y*.55+h11(floor(p.z/8.))*3.));            // black machines, ACP-red safety bands
    matPaint(m,p,n,mix(vec3(.11,.105,.1),vec3(.55,.05,.06),sf),.55); matRust(m,p,n,.15); vec2 li=fract(p.zy*vec2(.7,1.1)); m.emi=vec3(1.,.14,.07)*U[0].y*step(.9,li.x)*step(.85,li.y)*3.; }
  else if(id<4.5){ m.alb=vec3(.62,.04,.05)*(.8+.3*n2(p.xy*3.))*(.8+.2*gOcc); m.emi=vec3(.25,.01,.01)*U[0].y; m.rim=.2; }
  else matFigure(m,p,id-5.);
}
`,
  },

  // THE MONUMENT: a colossal stele on a stepped plinth, a toothed ring gate behind it, blade pylons, red banners,
  // a crowd of figures on the terraces; height fog lit by a low sun.
  monument: {
    params: { ignite: 'U0.x', sway: 'U0.y', crowd: 'U0.z', breath: 'U0.w', lamps: 'U1.x', wet: 'U1.y' },
    defaults: { ignite: 0, sway: 0, crowd: 0.45, breath: 0, lamps: 0.2, wet: 0.3 },
    defines: { GROUND: 1, DETAIL: 33, DSTEPS: 36, FAR: 1400, STEPS: 84, SHSTEPS: 14, SHMAX: 260, SHK: 10, AOSTEPS: 2, AOR: 4, RELAX: 0.95, OMEGA: 1.3, RFAR: 400, VOLN: 0, VSTEPS: 12, VSHMAX: 420, VSMIN: 4, VFAR: 700, VOLDENS: 1 },
    glsl: /* glsl */`
vec2 mapDetail(vec3 p){
  float r=length(p.xz); float rb=max(p.y-30.,abs(r-99.)-41.); if(rb>.3) return vec2(rb,0);
  float k=clamp(floor((r-58.)/10.),0.,7.); float top=(8.-k)*3.5;
  float a=atan(p.z,p.x); float cells=floor((63.+k*10.)*6.283/2.2);
  if(length(p-CP)*gPix>FIG_BAND){ // under ~6 px: a pre-filtered density band per terrace (ragged top), not rows of glyphs
    float hb=(1.25+.45*n2(vec2(a*cells*.5,k*7.)))*smoothstep(.05,.5,U[0].z);
    return vec2(min(max(abs(r-63.-k*10.)-1.5,abs(p.y-top-hb*.5)-hb*.5),1.2),5.); }
  float ai=floor((a/6.283+.5)*cells);
  float ac=((ai+.5)/cells-.5)*6.283; float rad=63.+k*10.+(h11(ai+k*31.)-.5)*5.;
  vec2 c=vec2(cos(ac),sin(ac))*rad;
  if(h11(ai*1.7+k*3.1)>U[0].z) return vec2(1.2,0);
  vec3 q=p-vec3(c.x,top,c.y); q.xz=rot(-ac+PI)*q.xz;                     // facing the stele
  float hull=sdCap(q,vec3(0,.3,0),vec3(0,1.6,0),.6); if(hull>.3) return vec2(min(hull,1.2),5.);
  vec2 f=sdFigureLite(q,sin(T*2.+ai)*.4,0.);
  return vec2(min(f.x,1.2),5.); }
vec2 mapObj(vec3 p){
  vec2 r=vec2(1e5,0);
  if(p.z>150.&&p.z<900.){ vec3 a=vec3(abs(p.x)-42.,p.y,mod(p.z,36.)-18.); float ob=sdBox(a-vec3(0,16,0),vec3(2.2-a.y*.02,16.,2.2-a.y*.02)); ob=min(ob,sdBox(a-vec3(0,1.2,0),vec3(4.,1.2,4.)));
    r=opU(r,vec2(ob,6.)); r=opU(r,vec2(length(a-vec3(0,33.,0))-.9,7.)); }
  else r.x=min(r.x,max(max(abs(p.x)-48.,max(150.-p.z,p.z-900.)),p.y-35.)+.5);
  float rr0=length(p.xz); if(rr0>380.){ float a=atan(p.z,p.x); float sec=6.2832/40.; float ai=floor(a/sec); float ac=(ai+.5)*sec;
    vec2 c=vec2(cos(ac),sin(ac))*(520.+h11(ai)*160.); float hh=50.+h11(ai+3.)*170.; vec3 tq=p-vec3(c.x,hh*.5,c.y);
    float tw=sdBox(tq,vec3(10.+h11(ai+5.)*14.,hh*.5,10.+h11(ai+6.)*10.)); tw=min(tw,sdBox(tq-vec3(0,hh*.5+hh*.12,0),vec3(4.,hh*.12,4.)));
    r=opU(r,vec2(tw*.8,8.)); }
  else r.x=min(r.x,380.-rr0+1.);
  float bb=sdBox(p-vec3(0,130,-20),vec3(145,135,145)); if(bb>2.) return opU(r,vec2(bb,1.));
  float plinth=sdZiggurat(p,58.,10.,3.5,8.);
  vec3 q=p-vec3(0,31.5,0); float taper=1.-q.y*.0022;
  float stele=sdBox(vec3(q.x/taper,q.y-110.,q.z/taper),vec3(18.,110.,7.))*taper;
  stele=max(stele,-sdBox(q-vec3(0,120.,0),vec3(2.2,70.,20.)));
  stele=max(stele,-sdBox(vec3(q.x,mod(q.y,14.)-7.,q.z-7.),vec3(15.,.35,.6)));
  stele=dispConcrete(p,stele,3.5);
  vec3 g=p-vec3(0,130,-34); g=g.xzy; float ring=sdGear(g,78.,24.,12.,4.);
  vec3 b=p; b.x=abs(b.x); b-=vec3(46,31.5,6); b.xy=rot(-.28)*b.xy; float blade=sdBox(b-vec3(0,60,0),vec3(2.2,60,10.));
  float sw=sin(p.y*.05+U[0].y)*.8; vec3 hq=vec3(abs(p.x)-11.,p.y-150.,p.z-7.8-sw*.3); float ban=sdBox(hq,vec3(3.4,62.,.15));
  r=opU(r,vec2(plinth,1.)); r=opU(r,vec2(stele,2.)); r=opU(r,vec2(ring,3.)); r=opU(r,vec2(blade,2.)); r=opU(r,vec2(ban,4.));
  return r; }
float volDens(vec3 p){ return exp(-max(p.y,0.)*FOGH)*(.55+.9*n3(p*.018+vec3(T*.05,0,T*.08)))*(1.+U[0].w); }
void material(vec3 p, vec3 n, float id, inout Mat m){
  if(id<.5){ matConcrete(m,p,n,vec3(.34,.32,.3),.8); m.alb*=.7+.5*fbm(p.xz*.05); matWet(m,p,U[1].y); }
  else if(id<1.5){ matConcrete(m,p,n,vec3(.66,.63,.59),.9); }
  else if(id<2.5){ matConcrete(m,p,n,vec3(.72,.7,.66),.8); }
  else if(id<3.5){ vec3 g=(p-vec3(0,130,-34)).xzy; float prof=abs(sdGear(vec3(g.x,0.,g.z),78.,24.,12.,4.)), fc=4.-abs(g.y);
    float edge=(1.-smoothstep(.1,.9,prof))*(1.-smoothstep(.1,.9,fc));
    matBronze(m,p,n,vec3(.12,.085,.06),edge); m.emi=igniteEmi(p,edge,U[0].x); }
  else if(id<4.5){ m.alb=vec3(.62,.04,.05)*(.85+.2*n2(p.xy*4.)); m.emi=vec3(.3,.0,.0)*U[0].x; }
  else if(id<5.5){ matFigure(m,p,0.); }
  else if(id<6.5){ matConcrete(m,p,n,vec3(.2,.19,.18),.6); m.spec=.3; m.gloss=30.; }
  else if(id<7.5){ m.alb=vec3(1.,.1,.08); m.emi=vec3(4.,.25,.15)*(.3+U[1].x); }
  else { matConcrete(m,p,n,vec3(.5,.5,.5),.9); }
}
`,
  },
};

// ------------------------------------------------------------------ composable parts -> generated worlds
// kit.*() returns a part: { glsl (a function body over local p), bound (AABB centre + half size, world), mat, params, detail }.
// compose(parts, opts) writes mapObj/mapDetail/material with an AABB early-out per part and allocates the named params,
// so a scene assembles placement instead of copying 150-line world strings:
//   const W = compose([kit.terrain({ amp: 38, pads: [[0, 0, 90, 24]] }), kit.keep({ pos: [0, 24, 0], mark: true }),
//                      kit.obelisks({ pos: [0, 24, 0], n: 6 }), kit.crane({ pos: [52, 24, -20] }), kit.crowd({ rect: [-30, 60, 30, 120], y: 24 })]);
//   const frontier = new SDF({ world: W, decal: logo });  frontier.render(t, { look: LOOKS.DAWN, cam, walk: t, fill: .8, gateGlow: .5 });
const f3 = v => `vec3(${v.map(x => (+x).toFixed(3)).join(',')})`;
const f1 = x => (+x).toFixed(4);
let _pid = 0;
function part(o) { return { name: `pt${_pid++}`, params: {}, ...o }; }
// JS twins of the GLSL noise (terrain heights for camera and placement)
const fr = x => x - Math.floor(x);
function jh21(x, y) { let a = fr(x * 0.1031), b = fr(y * 0.1031), c = fr(x * 0.1031); const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33); a += d; b += d; c += d; return fr((a + b) * c); }
function jn2(x, y) { const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = jh21(ix, iy), b = jh21(ix + 1, iy), c = jh21(ix, iy + 1), d = jh21(ix + 1, iy + 1); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; }
function jfbm(x, y) { let v = 0, a = 0.5; for (let i = 0; i < 4; i++) { v += a * jn2(x, y); const nx = 1.6 * x - 1.2 * y + 3.1, ny = 1.2 * x + 1.6 * y + 1.7; x = nx; y = ny; a *= 0.5; } return v; }
const jsstep = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

export const kit = {
  // brutalist keep: battered front and sides, horizontal ribs, pilasters, a gate with a blast door, optional painted mark.
  // size = half extents [x, y, z]; params: gateGlow (and mark, markRed when mark:true)
  keep({ pos = [0, 0, 0], size = [36, 30, 32], rib = 11, gate = true, mark = false, rotY = 0, color = [0.9, 0.88, 0.84], age = 0.75 } = {}) {
    const [hx, hy, hz] = size;
    return part({ kind: 'keep', pos, rotY, mat: 'concrete', color, age, decal: mark ? { x0: -hx * 0.42, y1: hy * 1.93, s: hx * 0.83, z: hz } : null,
      params: { gateGlow: 0.25, ...(mark ? { mark: 1, markRed: 0 } : {}) }, gate: gate ? { w: hx * 0.25, h: hy * 0.63, z: hz } : null,
      bound: [pos[0], pos[1] + hy + 2, pos[2], Math.max(hx, hz) + 4, hy + 3, Math.max(hx, hz) + 4],
      glsl: `vec3 nF=normalize(vec3(0,.2,1.));
  float d=sdBox(p-vec3(0,${f1(hy)},0),${f3([hx, hy, hz])});
  d=max(d,dot(p-vec3(0,0,${f1(hz)}),nF)); d=max(d,dot(vec3(abs(p.x),p.y,0)-vec3(${f1(hx)},0,0),vec3(.993,.119,0)));
  float band=abs(mod(p.y,${f1(rib)})-${f1(rib / 2)})-${f1(rib / 2 - 0.45)};
  ${mark ? `band=max(band,-sdBox(p-vec3(0,${f1(hy * 1.47)},${f1(hz * 0.8)}),vec3(${f1(hx * 0.49)},${f1(hy * 0.55)},10.)));` : ''}
  d=max(d,-max(band,-dot(p-vec3(0,0,${f1(hz)}),nF)-.6));
  float px=mod(p.x+4.,8.)-4.; float pil=max(max(abs(px)-.7,dot(p-vec3(0,0,${f1(hz + 0.9)}),nF)),max(abs(p.x)-${f1(hx - 2)},p.y-${f1(hy * 1.93)}));
  ${mark ? `pil=max(pil,-sdBox(p-vec3(0,${f1(hy * 1.47)},${f1(hz * 0.8)}),vec3(${f1(hx * 0.49)},${f1(hy * 0.55)},10.)));` : ''}
  d=min(d,max(pil,-p.y));
  ${gate ? `float gt=sdBox(p-vec3(0,${f1(hy * 0.32)},${f1(hz + 2)}),vec3(${f1(hx * 0.25)},${f1(hy * 0.32)},16.)); d=max(d,-gt);
  d=max(d,-sdBox(p-vec3(0,${f1(hy * 0.37)},${f1(hz + 1)}),vec3(${f1(hx * 0.32)},${f1(hy * 0.37)},2.2)));
  d=min(d,max(sdBox(p-vec3(0,${f1(hy * 0.71)},${f1(hz - 2.5)}),vec3(${f1(hx * 0.33)},.7,3.)),-gt));` : ''}
  vec2 sc=floor(vec2(p.y/6.,p.z/7.)); float k=h21(sc+step(0.,p.x)*17.);             // service boxes bolted to the battered flanks
  float bx=${f1(hx)}-.1198*(sc.x*6.+3.)+.45-step(k,.4)*2.;
  float sbx=sdBox(vec3(abs(p.x)-bx,mod(p.y,6.)-3.,mod(p.z,7.)-3.5),vec3(.8,.5+.7*k,.8+1.2*fract(k*7.)));
  d=min(d,max(sbx,max(max(p.y-${f1(hy * 1.66)},3.-p.y),max(p.z-(${f1(hz - 5)}-.2*p.y),-${f1(hz - 3)}-p.z))));
  return dispConcrete(p,d,2.4);` });
  },
  // tapered stele with a vertical slot and course grooves; h total height, w/d half width/depth
  stele({ pos = [0, 0, 0], w = 18, h = 220, d = 7, taper = 0.0022, slot = true, mark = false, color = [0.72, 0.7, 0.66], age = 0.8 } = {}) {
    return part({ kind: 'stele', pos, mat: 'concrete', color, age, params: mark ? { mark: 1, markRed: 0 } : {},
      decal: mark ? { x0: -w * 0.8, y1: h * 0.62, s: w * 1.6, z: d * (1 - h * 0.31 * taper) } : null,
      bound: [pos[0], pos[1] + h / 2, pos[2], w + 1, h / 2 + 1, d + 1],
      glsl: `float tp=1.-p.y*${f1(taper)};
  float s=sdBox(vec3(p.x/tp,p.y-${f1(h / 2)},p.z/tp),${f3([w, h / 2, d])})*tp;
  ${slot ? `s=max(s,-sdBox(p-vec3(0,${f1(h * 0.55)},0),vec3(${f1(w * 0.12)},${f1(h * 0.32)},${f1(d * 3)})));` : ''}
  s=max(s,-sdBox(vec3(p.x,mod(p.y,14.)-7.,p.z-${f1(d)}),vec3(${f1(w * 0.83)},.35,.6)));
  return dispConcrete(p,s,3.5);` });
  },
  // toothed ring gate standing vertical, facing +z (rotY turns it). params: ignite (red emissive rim)
  ring({ pos = [0, 130, -34], r = 78, teeth = 24, width = 12, thick = 4, rotY = 0, color = [0.12, 0.085, 0.06] } = {}) {
    return part({ kind: 'ring', pos, rotY, mat: 'bronze', color, params: { ignite: 0 }, emissive: 'ignite',
      // polished wear where the ring's profile edge meets a face (lp = local p in the material dispatch)
      edgeGlsl: `(1.-smoothstep(.1,.9,abs(sdGear(vec3(lp.x,0.,lp.y),${f1(r)},${f1(teeth)},${f1(width)},${f1(thick)}))))*(1.-smoothstep(.1,.9,${f1(thick)}-abs(lp.z)))`,
      bound: [pos[0], pos[1], pos[2], r + width + 2, r + width + 2, r + width + 2],
      glsl: `return sdGear(p.xzy,${f1(r)},${f1(teeth)},${f1(width)},${f1(thick)});` });
  },
  // stepped round plinth (ziggurat): crown radius r0, n terraces of depth step and height rise
  plinth({ pos = [0, 0, 0], r0 = 58, step = 10, rise = 3.5, n = 8, color = [0.66, 0.63, 0.59] } = {}) {
    const R0 = r0 + step * n;
    return part({ kind: 'plinth', pos, mat: 'concrete', color, age: 0.9, bound: [pos[0], pos[1] + (n + 1) * rise / 2, pos[2], R0 + 1, (n + 1) * rise / 2 + 1, R0 + 1],
      glsl: `return sdZiggurat(p,${f1(r0)},${f1(step)},${f1(rise)},${f1(n)});` });
  },
  // an avenue of obelisks on both sides of the z axis, n per side from z0 every spacing m, a lamp on each (param lamps)
  obelisks({ pos = [0, 0, 0], n = 12, x = 42, z0 = 150, spacing = 36, h = 32, color = [0.2, 0.19, 0.18] } = {}) {
    const z1 = z0 + n * spacing;
    return part({ kind: 'obelisks', pos, mat: 'granite', color, params: { lamps: 0.3 }, lampY: h + 0.05,
      bound: [pos[0], pos[1] + h / 2 + 1, pos[2] + (z0 + z1) / 2, x + 6, h / 2 + 2, (z1 - z0) / 2 + 2],
      glsl: `float zz=clamp(p.z,${f1(z0)},${f1(z1 - 0.01)}); vec3 a=vec3(abs(p.x)-${f1(x)},p.y,p.z-(floor((zz-${f1(z0)})/${f1(spacing)})+.5)*${f1(spacing)}-${f1(z0)});
  float ob=sdBox(a-vec3(0,${f1(h / 2)},0),vec3(2.2-a.y*.02,${f1(h / 2)},2.2-a.y*.02)); ob=min(ob,sdBox(a-vec3(0,1.2,0),vec3(4.,1.2,4.)));
  return min(ob,length(a-vec3(0,${f1(h + 1)},0))-.9);` });
  },
  // silos: list of [dx, dz, radius, height] relative to pos
  silos({ pos = [0, 0, 0], list = [[0, 0, 8, 46], [16, -14, 7, 54], [-4, -22, 6.5, 62]], color = [0.86, 0.85, 0.82] } = {}) {
    let mx = 0, my = 0; for (const [a, b, r, h] of list) { mx = Math.max(mx, Math.abs(a) + r, Math.abs(b) + r); my = Math.max(my, h + r); }
    return part({ kind: 'silos', pos, mat: 'paint', color, wear: 0.55, bound: [pos[0], pos[1] + my / 2, pos[2], mx + 1, my / 2 + 1, mx + 1],
      glsl: `float d=1e5; ${list.map(([a, b, r, h]) => `d=min(d,sdSilo(p-vec3(${f1(a)},0,${f1(b)}),${f1(r)},${f1(h)}));`).join(' ')} return d;` });
  },
  // a wall (half extents) with buttresses every `every` m on its +z face
  wall({ pos = [0, 0, 0], size = [115, 40, 8], every = 14, rotY = 0, color = [0.78, 0.79, 0.8] } = {}) {
    const [hx, hy, hz] = size;
    return part({ kind: 'wall', pos, rotY, mat: 'concrete', color, age: 0.85, bound: [pos[0], pos[1] + hy, pos[2], Math.max(hx, hz) + 5, hy + 1, Math.max(hx, hz) + 5],
      glsl: `float d=sdBox(p-vec3(0,${f1(hy)},0),${f3(size)});
  vec3 q=vec3(mod(p.x,${f1(every)})-${f1(every / 2)},p.y,p.z-${f1(hz)}); d=min(d,max(sdWedge(q,1.4,${f1(hy * 1.8)},6.),abs(p.x)-${f1(hx)}));
  return dispConcrete(p,d,2.4);` });
  },
  // blade pylons leaning outward left and right of the axis
  blades({ pos = [0, 0, 0], gap = 46, lean = 0.28, h = 120, color = [0.72, 0.7, 0.66] } = {}) {
    return part({ kind: 'blades', pos, mat: 'concrete', color, age: 0.8, bound: [pos[0], pos[1] + h / 2, pos[2], gap + h * 0.35 + 4, h / 2 + 4, 12],
      glsl: `vec3 b=p; b.x=abs(b.x); b-=vec3(${f1(gap)},0,0); b.xy=rot(-${f1(lean)})*b.xy; return sdBox(b-vec3(0,${f1(h / 2)},0),vec3(2.2,${f1(h / 2)},10.));` });
  },
  // a tower crane (the unfinished): lattice mast, jib and counter-jib, cab, a hook on a cable. Painted ACP red by default.
  crane({ pos = [0, 0, 0], h = 62, jib = 44, rotY = 0.6, color = [0.62, 0.05, 0.05], hook = 0.55 } = {}) {
    const L = jib;
    return part({ kind: 'crane', pos, rotY, mat: 'paint', color, wear: 0.5, bound: [pos[0], pos[1] + h / 2 + 3, pos[2], L + 3, h / 2 + 5, L + 3],
      glsl: `vec3 q=p; float d;
  { d=sdBox(vec3(abs(q.x)-1.,q.y-${f1(h / 2)},abs(q.z)-1.),vec3(.1,${f1(h / 2)},.1));
    vec3 v=vec3(q.x,mod(q.y+1.,2.)-1.,q.z); d=min(d,max(sdBox(v,vec3(1.05,.06,1.05)),-sdBox(v,vec3(.95,1.,.95))));
    float yy=mod(q.y,2.)-1.;
    d=min(d,max(max(abs(q.z-yy)*.707-.05,abs(abs(q.x)-1.)-.05),abs(q.z)-1.));
    d=min(d,max(max(abs(q.x-yy)*.707-.05,abs(abs(q.z)-1.)-.05),abs(q.x)-1.));
    d=max(d,max(q.y-${f1(h)},-q.y)); }
  { vec3 j=q-vec3(0,${f1(h)},0);
    float ch=min(sdCap(j,vec3(-${f1(L * 0.3)},0,.8),vec3(${f1(L)},0,.8),.09),sdCap(j,vec3(-${f1(L * 0.3)},0,-.8),vec3(${f1(L)},0,-.8),.09));
    ch=min(ch,sdCap(j,vec3(-${f1(L * 0.3)},1.6,0),vec3(${f1(L)},.4,0),.09));
    float xm=mod(j.x,2.)-1.; float top=mix(1.6,.4,SAT((j.x+${f1(L * 0.3)})/${f1(L * 1.3)}));
    ch=min(ch,max(sdCap(vec3(xm,j.y,abs(j.z)),vec3(-1.,0.,.8),vec3(1.,top,0.),.06),abs(j.x-${f1(L * 0.35)})-${f1(L * 0.65)}));
    ch=min(ch,sdBox(j-vec3(0,4.,0),vec3(.35,4.,.35))); ch=min(ch,sdCap(j,vec3(0,8.,0),vec3(${f1(L * 0.7)},.5,0),.05)); ch=min(ch,sdCap(j,vec3(0,8.,0),vec3(-${f1(L * 0.3)},.5,0),.05));
    ch=min(ch,sdBox(j-vec3(-${f1(L * 0.26)},-1.,0),vec3(2.,1.4,1.2))); ch=min(ch,sdBox(j-vec3(2.,-1.2,1.6),vec3(1.2,1.,.9)));
    float hx=${f1(L * hook)}; ch=min(ch,sdCap(j,vec3(hx,0,0),vec3(hx,-${f1(h * 0.45)},0),.04)); ch=min(ch,sdBox(j-vec3(hx,-${f1(h * 0.45)},0),vec3(.4,.5,.3)));
    d=min(d,ch); }
  return d;` });
  },
  // heightfield terrain (fbm hills + ridges) with flat pads [x, z, radius, height] for structures. Replaces GROUND.
  // terrain.h(x, z) is its JS twin for placing the camera and things on it.
  terrain({ amp = 40, scale = 0.004, pads = [], seed = 3, flat = [0.34, 0.3, 0.22], rock = [0.4, 0.36, 0.32], size = 3000 } = {}) {
    const S = (seed * 13.1) % 97;
    const padG = pads.map(([x, z, r, h]) => `{ float k=smoothstep(${f1(r)},${f1(r * 1.9)},length(q-vec2(${f1(x)},${f1(z)}))); H=mix(${f1(h)},H,k); }`).join(' ');
    const P = part({ kind: 'terrain', pos: [0, 0, 0], mat: 'earth', color: flat, rock, terrain: true,
      bound: [0, amp * 1.1, 0, size, amp * 1.1 + 2, size],
      glsl: `vec2 q=p.xz; float H=(pow(fbm(q*${f1(scale)}+${f1(S)}),1.6)*${f1(amp * 1.6)}+(1.-abs(n2(q*${f1(scale * 2.1)})*2.-1.))*${f1(amp * 0.25)}+(gFine>.5?fbm(q*${f1(scale * 12)})*${f1(amp * 0.04)}:0.));
  ${padG} return (p.y-H)*.55;` });
    P.h = (x, z) => {
      let H = Math.pow(jfbm(x * scale + S, z * scale + S), 1.6) * amp * 1.6 + (1 - Math.abs(jn2(x * scale * 2.1, z * scale * 2.1) * 2 - 1)) * amp * 0.25 + jfbm(x * scale * 12, z * scale * 12) * amp * 0.04;
      for (const [px, pz, r, h] of pads) { const k = jsstep(r, r * 1.9, Math.hypot(x - px, z - pz)); H = h + (H - h) * k; }
      return H;
    };
    return P;
  },
  // a crowd in a rect [x0, z0, x1, z1] at height y: figures on a jittered grid walking along `heading` (march) or milling.
  // params: fill (0..1 how many cells are occupied), walk (time, drives the strides and the column's advance)
  crowd({ rect = [-30, 40, 30, 110], y = 0, cell = [3.2, 3.2], heading = Math.PI, march = true, speed = 1.3, coat = 0.6 } = {}) {
    const [x0, z0, x1, z1] = rect;
    return part({ kind: 'crowd', pos: [0, 0, 0], detail: true, y, mat: 'figure', params: { fill: 0.7, walk: 0 },
      bound: [(x0 + x1) / 2, y + 1.05, (z0 + z1) / 2, (x1 - x0) / 2 + 1, 1.1, (z1 - z0) / 2 + 1],
      glsl: `vec3 w=p-vec3(${f1((x0 + x1) / 2)},${f1(y)},${f1((z0 + z1) / 2)}); w.xz=rot(${f1(-heading)})*w.xz;
  ${march ? `w.z+=P_walk*${f1(speed)};` : ''}
  vec2 cs=${`vec2(${f1(cell[0])},${f1(cell[1])})`}; vec2 id=floor(w.xz/cs); vec2 r=h22(id+7.); vec2 c=(id+.5)*cs;
  float edge=-sdBox2(w.xz-c,cs*.5)+.25;
  if(r.x>P_fill) return vec2(edge,0.);
  vec3 q=w-vec3(c.x+(r.x-.5)*cs.x*.4,0.,c.y+(r.y-.5)*cs.y*.4); q.xz=vec2(-q.z,q.x);
  ${march ? '' : 'q.xz=rot(r.y*6.283)*q.xz;'}
  float hull=sdCap(q,vec3(0,.3,0),vec3(0,1.6,0),.6); if(hull>.3) return vec2(min(hull,edge),20.);
  vec2 f=figure(q,p,P_walk*${f1(speed * 5.5)}+r.x*6.283,${march ? '1.' : 'step(.6,r.y)'},${f1(coat)}*step(.3,r.y));
  return vec2(min(f.x,edge),20.+f.y);` });
  },
  // one hero figure: param hero = { x, z, heading, phase } (phase < 0 hides it) at height y. Keep the camera >= ~15 m away.
  hero({ y = 0, coat = 1 } = {}) {
    return part({ kind: 'hero', pos: [0, 0, 0], detail: true, y, mat: 'figure', params: { hero: [0, 0, 0, -1] }, figure: 'hero',
      bound: null,
      glsl: `if(P_hero.w<0.) return vec2(1e5,20.);
  vec3 q=p-vec3(P_hero.x,${f1(y)},P_hero.y); q.xz=rot(P_hero.z)*q.xz; float b=sdCap(q,vec3(0,.3,0),vec3(0,1.6,0),.8);
  if(b>.3) return vec2(b,20.); vec2 f=sdFigure(q,P_hero.w,1.,${f1(coat)}); return vec2(f.x,20.+f.y);` });
  },
  // your own GLSL: body returns a float distance over local p. mat: concrete|paint|granite|bronze|earth, color, bound [cx,cy,cz,hx,hy,hz]
  custom({ glsl, pos = [0, 0, 0], rotY = 0, bound, mat = 'concrete', color = [0.8, 0.8, 0.8], age = 0.8, params = {} }) {
    return part({ kind: 'custom', pos, rotY, glsl, bound, mat, color, age, params });
  },
};

// build a world { glsl, defines, params, defaults } from parts. opts: ground ('wet' | 'plaza' | false; ignored with a terrain part),
// wet (0..1), defines (merged over the defaults), sky (GLSL for a custom sky()), clouds (0..1)
export function compose(parts, { ground = 'plaza', wet = 0.4, groundColor = [0.5, 0.49, 0.47], defines = {}, clouds = 0 } = {}) {
  // allocate params: vec4 params (figures) take whole U slots first, then scalars pack 4 per slot
  const P = {}, defaults = {}; let slot = 0, comp = 0;
  for (const p of parts) for (const [k, v] of Object.entries(p.params || {})) if (Array.isArray(v) && !(k in P)) { P[k] = [slot++, ['x', 'z', 'heading', 'phase']]; defaults[k] = v; }
  const scalar = (k, v) => { if (comp === 4) { slot++; comp = 0; } P[k] = `U${slot}.${'xyzw'[comp++]}`; defaults[k] = v; };
  for (const p of parts) for (const [k, v] of Object.entries(p.params || {})) if (!Array.isArray(v) && !(k in P)) scalar(k, v);
  if (!('wet' in P)) scalar('wet', wet);
  if (slot > 7) throw new Error('compose: more than 8 param slots');
  const macro = Object.entries(P).map(([k, v]) => Array.isArray(v) ? `#define P_${k} U[${v[0]}]` : `#define P_${k} U[${v[1]}].${v[3]}`).join('\n');
  const terr = parts.find(p => p.terrain), obj = parts.filter(p => !p.detail), det = parts.filter(p => p.detail);
  const idOf = new Map(); obj.forEach((p, i) => idOf.set(p, i + 1));
  const toLocal = (p, v = 'p') => `lp=${v}-${f3(p.pos)};` + (p.rotY ? ` lp.xz=rot(${f1(p.rotY)})*lp.xz;` : '');
  let g = macro + '\n';
  for (const p of obj) g += `float ${p.name}(vec3 p){ ${p.glsl} }\n`;
  for (const p of det) g += `vec2 ${p.name}(vec3 p){ ${p.glsl} }\n`;
  g += 'vec2 mapObj(vec3 p){ vec2 r=vec2(1e5,0.); float b; vec3 lp;\n';
  for (const p of obj) {
    const id = idOf.get(p), B = p.bound;
    if (p.terrain) g += `  { float top=${f1(B[1] + B[4])}; float dd=p.y>top?p.y-top+1.:${p.name}(p); if(dd<r.x) r=vec2(dd,${id}.); }\n`;
    else g += `  b=sdBox(p-${f3(B.slice(0, 3))},${f3(B.slice(3))}); if(b>1.5) r.x=min(r.x,b); else { ${toLocal(p)} float dd=${p.name}(lp); if(dd<r.x) r=vec2(dd,${id}.); }\n`;
  }
  g += '  return r; }\n';
  const D = { FAR: 1600, STEPS: 90, SHSTEPS: 16, SHMAX: 220, SHK: 14, AOSTEPS: 2, AOR: 3, RELAX: 0.9, OMEGA: 1.3, RFAR: 300, VOLN: 0, VSTEPS: 1, VSHMAX: 1, VFAR: 1 };
  if (clouds) D.CLOUDS = clouds;
  if (!terr && ground) D.GROUND = 1;
  if (det.length) {
    const ys = det.map(p => p.y || 0); const y0 = Math.min(...ys), y1 = Math.max(...ys);
    D.DETAIL = y1 - y0 + 2.1; D.DETAIL_Y0 = y0; D.DSTEPS = 36;
    g += 'vec2 mapDetail(vec3 p){ vec2 r=vec2(1e5,0.);\n';
    for (const p of det) {
      const B = p.bound;
      if (B) g += `  { float b=sdBox(p-${f3(B.slice(0, 3))},${f3(B.slice(3))}); if(b>.3) r.x=min(r.x,b); else r=opU(r,${p.name}(p)); }\n`;
      else g += `  r=opU(r,${p.name}(p));\n`;
    }
    g += '  return r; }\n';
  }
  // material dispatch: one branch per part, from the shared material library
  g += 'void material(vec3 p, vec3 n, float id, inout Mat m){ vec3 lp, ln;\n';
  g += `  if(id<.5){ matConcrete(m,p,n,${f3(groundColor)},.7); m.alb*=.8+.2*seams(p.xz,vec2(8.,8.),.08); matWet(m,p,P_wet); return; }\n`;
  g += '  if(id>19.5){ matFigure(m,p,id-20.); return; }\n';
  for (const p of obj) {
    const id = idOf.get(p), c = f3(p.color || [0.8, 0.8, 0.8]);
    let body = toLocal(p) + ' ln=n;' + (p.rotY ? ` ln.xz=rot(${f1(p.rotY)})*ln.xz;` : '') + ' ';
    if (p.mat === 'concrete') body += `matConcrete(m,p,n,${c},${f1(p.age ?? 0.8)});`;
    else if (p.mat === 'paint') body += `matPaint(m,p,n,${c},${f1(p.wear ?? 0.5)});`;
    else if (p.mat === 'granite') body += `matConcrete(m,p,n,${c},.6); m.spec=.3; m.gloss=30.;`;
    else if (p.mat === 'bronze') body += p.edgeGlsl ? `float edge=${p.edgeGlsl}; matBronze(m,p,n,${c},edge);` : `float edge=0.; matBronze(m,p,n,${c},0.);`;
    else if (p.mat === 'earth') body += `matEarth(m,p,n,${c},${f3(p.rock || [0.4, 0.36, 0.32])}); { float fl=smoothstep(.9,.97,n.y); if(fl>0.){ Mat w=m; matWet(w,p,P_wet*.4); m.alb=mix(m.alb,w.alb,fl); m.refl=w.refl*fl; m.spec=mix(m.spec,w.spec,fl); m.gloss=mix(m.gloss,w.gloss,fl); } }`;
    if (p.emissive === 'ignite') body += p.mat === 'bronze' ? ` m.emi=igniteEmi(p,edge,P_ignite);` : ` m.emi=vec3(1.,.08,.06)*P_ignite*(2.5+2.*n2(p.xy*1.3+T));`;
    if (p.lampY != null) body += ` if(lp.y>${f1(p.lampY)}){ m.alb=vec3(1.,.1,.08); m.emi=vec3(4.,.25,.15)*(.3+P_lamps); }`;
    if (p.decal) {
      const d = p.decal;
      body += `
#ifdef DECAL_ON
    { vec2 dd=vec2((lp.x-(${f1(d.x0)}))/${f1(d.s)},(${f1(d.y1)}-lp.y)/${f1(d.s)});
      if(ln.z>.5&&dd.x>0.&&dd.x<1.&&dd.y>0.&&dd.y<1.){ vec4 k=texture(DECAL,dd); float wear=smoothstep(.15,.45,fbm(lp.xy*1.7)+.2)*(1.-.5*smoothstep(.4,.9,fbm(vec2(lp.x*1.3,lp.y*.1))));
        float a=k.a*P_mark*wear; m.alb=mix(m.alb,k.rgb*.9*(.85+.15*gOcc),a); m.emi+=k.rgb*vec3(1.,.2,.2)*a*P_markRed*step(.4,k.r-k.g); } }
#endif
`;
    }
    if (p.gate) {
      const q = p.gate;
      body += ` if(lp.z>${f1(q.z - 15)}&&lp.z<${f1(q.z + 1)}&&lp.y<${f1(q.h)}&&lp.y>.05&&abs(lp.x)<${f1(q.w - 0.05)}){
      float rib=smoothstep(.0,.08,abs(fract(lp.x/1.5)-.5)-.4); m.alb=vec3(.09,.09,.1)*(.7+.3*rib)*(.85+.3*triN(p,n,1.3)); m.spec=.45; m.gloss=40.; matRust(m,p,n,.05);
      m.emi=vec3(1.,.62,.3)*exp(-lp.x*lp.x*6.)*step(lp.z,${f1(q.z - 13.4)})*(3.+6.*P_gateGlow); }`;
    }
    g += `  if(id<${id}.5){ ${body} return; }\n`;
  }
  g += '}\n';
  return { glsl: g, defines: { ...D, ...defines }, params: P, defaults, parts, figures: det.filter(p => p.figure).map(p => p.figure), h: terr ? terr.h : (() => 0) };
}

// ------------------------------------------------------------------ engine
const RESERVED = new Set(['cam', 'sun', 'sky', 'fog', 'amb', 'exposure', 'vol', 'u', 'kick', 'flash', 'seed', 'post', 'look', 'rim', 'params']);
export class SDF {
  // world: key of WORLDS, a compose() result, or { glsl, defines, params, defaults }.
  // scale: march resolution vs the output (default .4). aa: edge supersampling (default on). upscale: GL upscale to the output
  // size (default on; canvas is then w x h). handoff: canvas = colour over packed depth for world3d.SDFLayer. sharp: upscale sharpen.
  // display (LIGHTING c2): 'aces' (default, the old Narkowicz fit, unchanged) or 'acp' = light/display.js's ONE transform (pass the
  // rig's white balance as wb, and light it with light/adapters.js sdfLook(rig) so the values are pre-exposed physical light)
  constructor({ world = 'fortress', scale = 0.4, decal = null, w = 1080, h = 1920, defines = {}, aa = true, aaTaps = 1, upscale = true, handoff = false, sharp = 0.5, edge = 0.025, display = 'aces', look = {}, wb = null } = {}) {
    const def = this.def = typeof world === 'string' ? WORLDS[world] : world;
    this.w = Math.round(w * scale); this.h = Math.round(h * scale); this.ow = w; this.oh = h;
    this.aa = aa; this.aaTaps = aaTaps; this.handoff = handoff; this.upscale = upscale && !handoff; this.sharp = sharp; this.edge = edge;
    const cv = this.canvas = document.createElement('canvas');
    cv.width = this.upscale ? w : this.w; cv.height = this.upscale ? h : handoff ? this.h * 2 : this.h;
    const gl = this.gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false });
    if (!gl) throw new Error('sdf: webgl2 unavailable');
    const D = this.defines = { ...def.defines, ...defines };
    if (decal) D.DECAL_ON = 1;
    const INT = ['STEPS', 'SHSTEPS', 'AOSTEPS', 'VOLN', 'VSTEPS', 'DSTEPS', 'RSTEPS', 'AATAPS'];
    const head = (X) => '#version 300 es\nprecision highp float;\n' + Object.entries(X).filter(([, v]) => v !== false && v !== null && v !== undefined)
      .map(([k, v]) => `#define ${k} ${INT.includes(k) ? Math.round(v) : Number(v).toFixed(4)}`).join('\n') + '\n';
    const ACESL = 'vec3 aces(vec3 x){ return SAT((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14)); }', ACESP = 'vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }';
    const acp = display === 'acp' ? displayGLSLConst(look, wb) + '\nvec3 aces(vec3 x){ return acpDisplayLinear(x); }' : null;
    if (acp && (!LIGHT.includes(ACESL) || !POST.includes(ACESP))) console.warn('sdf: display acp could not find the tone curve to replace');
    const LIGHTd = acp ? LIGHT.replace(ACESL, acp) : LIGHT, POSTd = acp ? POST.replace(ACESP, acp) : POST;
    this.display = display;
    this.prog = this._prog(head(D) + COMMON + def.glsl + LIGHTd);
    if (aa) this.aaProg = this._prog(head({ ...D, AAPASS: 1, AATAPS: aaTaps, VOLN: 0, SHSTEPS: Math.ceil(D.SHSTEPS / 2), DSTEPS: D.DSTEPS ? Math.ceil(D.DSTEPS * 0.75) : undefined }) + COMMON + def.glsl + LIGHTd);
    this.post = this._prog(POSTd);
    if (this.upscale) this.up = this._prog(UPSCALE);
    if (handoff) this.pack = this._prog(PACK);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const p of [this.prog, this.aaProg, this.post, this.up, this.pack]) { if (!p) continue; const l = gl.getAttribLocation(p, 'a'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0); }
    const tex = (levels, filt = gl.LINEAR) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, this.w, this.h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
    const full = 1 + Math.floor(Math.log2(Math.max(this.w, this.h)));
    this.hasVol = (D.VOLN || 0) > 0;
    this.texB = tex(full);                           // march colour (+ AA taps blended in), mipmapped for bloom / shafts
    this.vtex = tex(4); this.dtex = tex(1, gl.NEAREST);
    const fbo = (atts) => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      atts.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
      gl.drawBuffers(atts.map((_, i) => gl.COLOR_ATTACHMENT0 + i)); return f; };
    this.fb = fbo([this.texB, this.vtex, this.dtex]);
    if (aa) this.fbAA = fbo([this.texB]);
    if (this.upscale) { this.ptex = tex(1); this.fbP = fbo([this.ptex]); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.decal = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.decal);
    if (decal) { gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, decal); gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.u = this._locs(this.prog); this.au = aa ? this._locs(this.aaProg) : null; this.pu = this._locs(this.post);
    this.uu = this.up ? this._locs(this.up) : null; this.ku = this.pack ? this._locs(this.pack) : null;
    this.params = def.params || {}; this.defaults = def.defaults || {}; this.minFigureDist = 15; this._warned = false;
  }
  _prog(fs) {
    const gl = this.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s);
        const lines = src.split('\n'); const m = /0:(\d+)/.exec(log); const ln = m ? +m[1] : 0;
        throw new Error('sdf shader: ' + log + '\n' + lines.slice(Math.max(0, ln - 3), ln + 2).join('\n')); } return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec2 a; void main(){ gl_Position=vec4(a,0,1); }'));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('sdf link: ' + gl.getProgramInfoLog(p));
    return p;
  }
  _locs(p) {
    const gl = this.gl, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS), o = {};
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); o[a.name.replace('[0]', '')] = gl.getUniformLocation(p, a.name); }
    return o;
  }
  // named params -> the U[] vec4 array. Order: world defaults, legacy o.u, then o.params and any top-level key the world names.
  _U(o) {
    const U = new Float32Array(32), P = this.params;
    const put = (k, v) => { const s = P[k]; if (s == null || v == null) return;
      if (Array.isArray(s)) { const [slot, fields] = s; const a = Array.isArray(v) ? v : fields.map((f, i) => v[f] ?? (this.defaults[k] || [])[i] ?? 0); U.set(a.slice(0, 4), slot * 4); }
      else { const slot = +s[1], c = 'xyzw'.indexOf(s[3]); U[slot * 4 + c] = +v; } };
    for (const k in this.defaults) put(k, this.defaults[k]);
    (o.u || []).forEach((v, i) => v && U.set(v.slice(0, 4), i * 4));
    for (const k in (o.params || {})) put(k, o.params[k]);
    for (const k in o) if (!RESERVED.has(k) && k in P) put(k, o[k]);
    return U;
  }
  // Render one frame. All fields optional; `look` (LOOKS.*) supplies sun/sky/fog/amb/exposure/rim/post, and any of them can be
  // overridden directly (objects merge field by field). World params by name (see WORLDS[..].params or compose().params).
  //  cam {pos, target, fov, roll}; sun {dir, color}; sky {top, horizon, ground}; fog {color, density, falloff, scatter};
  //  rim [r, g, b, amount]; vol; amb; exposure; kick; flash;
  //  post {rays, rayTint, bloom, threshold, vignette, sat, contrast, lift, gain, grain, cream, crush}
  render(t, o = {}) {
    const gl = this.gl, u = this.u, pu = this.pu, L = o.look || {};
    const m = (k) => ({ ...(L[k] || {}), ...(o[k] || {}) });
    const cam = o.cam || {}, sun = m('sun'), sky = m('sky'), fog = m('fog'), P = m('post');
    const amb = o.amb ?? L.amb ?? 1, exposure = o.exposure ?? L.exposure ?? 1, rim = o.rim || L.rim || [1, 0.9, 0.8, 0];
    const pos = cam.pos || [0, 2, 40], tgt = cam.target || [0, 10, 0];
    const sd = norm(sun.dir || [-0.4, 0.8, 0.5]);
    const U = this._U(o);
    this._checkFigures(U, pos);
    const setMarch = (p, uu) => {
      gl.useProgram(p);
      gl.uniform2f(uu.R, this.w, this.h); gl.uniform1f(uu.T, t); gl.uniform1f(uu.KICK, o.kick || 0); gl.uniform1f(uu.FLASH, o.flash || 0); gl.uniform1f(uu.SEED, o.seed || 0);
      gl.uniform3fv(uu.CP, pos); gl.uniform3fv(uu.CT, tgt); gl.uniform1f(uu.FOV, cam.fov || 40); gl.uniform1f(uu.ROLL, cam.roll || 0);
      gl.uniform3fv(uu.SUN, sd); gl.uniform3fv(uu.SUNC, sun.color || [3.2, 3.0, 2.7]);
      gl.uniform3fv(uu.SKYT, sky.top || [0.07, 0.16, 0.55]); gl.uniform3fv(uu.SKYH, sky.horizon || [0.45, 0.62, 0.95]); gl.uniform3fv(uu.GRND, sky.ground || [0.5, 0.45, 0.4]);
      gl.uniform3fv(uu.FOGC, fog.color || [0.6, 0.7, 0.9]); gl.uniform1f(uu.FOGD, fog.density ?? 0.002); gl.uniform1f(uu.FOGH, fog.falloff ?? 0.02); gl.uniform1f(uu.FOGS, fog.scatter ?? 0.35);
      gl.uniform1f(uu.VOLA, o.vol ?? L.vol ?? 1); gl.uniform1f(uu.AMB, amb); gl.uniform1f(uu.EXPO, exposure); gl.uniform4fv(uu.RIM, rim);
      gl.uniform4fv(uu.U, U);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.decal); gl.uniform1i(uu.DECAL, 1);
    };
    const pf = this.profile, st = {}; let T0 = pf ? performance.now() : 0;
    const lap = (k) => { if (!pf) return; this.sync(); const T1 = performance.now(); st[k] = Math.round(T1 - T0); T0 = T1; };
    // 1. march (a handoff layer marches only the screen rect of its parts' bounds; the rest is cleared to 'miss')
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb); gl.viewport(0, 0, this.w, this.h);
    const sc = this.handoff ? this._rect(cam) : null;
    if (sc) { gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 1]); gl.clearBufferfv(gl.COLOR, 2, [1, 1, 1, 0]);
      gl.enable(gl.SCISSOR_TEST); gl.scissor(...sc); }
    setMarch(this.prog, u); gl.drawArrays(gl.TRIANGLES, 0, 3); lap('march');
    // 2. edge AA
    if (this.aa) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbAA);
      const w = 1 / (this.aaTaps + 1);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      setMarch(this.aaProg, this.au); gl.uniform1f(this.au.AAW, 1 - w); gl.uniform1f(this.au.EDGE, this.edge);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.dtex); gl.uniform1i(this.au.PD, 4);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND); lap('aa');
    }
    gl.disable(gl.SCISSOR_TEST);
    if (this.hasVol) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.vtex); gl.generateMipmap(gl.TEXTURE_2D); }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texB); gl.generateMipmap(gl.TEXTURE_2D);
    lap('mips');
    // 3. post (into the upscale source, the canvas top half for a handoff, or the canvas)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.upscale ? this.fbP : null);
    const offY = this.handoff ? this.h : 0;
    gl.viewport(0, offY, this.w, this.h);
    gl.useProgram(this.post); gl.uniform1i(pu.A, 0); gl.uniform1i(pu.V, 2); gl.uniform1f(pu.VOL, this.hasVol ? 1 : 0);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.dtex); gl.uniform1i(pu.D, 4);
    { const ww = norm(sub(tgt, pos)), rl = cam.roll || 0, upv = [Math.sin(rl), Math.cos(rl), 0], uu = norm(cross(ww, upv)), vv = cross(uu, ww);
      gl.uniform3fv(pu.CP, pos); gl.uniform3fv(pu.CW, ww); gl.uniform3fv(pu.CU, uu); gl.uniform3fv(pu.CV, vv);
      gl.uniform1f(pu.FL, 1 / Math.tan((cam.fov || 40) * Math.PI / 360)); gl.uniform1f(pu.LNK, Math.log(this.defines.FAR * 20)); gl.uniform1f(pu.FARD, this.defines.FAR);
      gl.uniform3fv(pu.SUN, sd); gl.uniform3fv(pu.SUNC, sun.color || [3.2, 3.0, 2.7]); gl.uniform3fv(pu.SKYT, sky.top || [0.07, 0.16, 0.55]); gl.uniform3fv(pu.SKYH, sky.horizon || [0.45, 0.62, 0.95]);
      gl.uniform3fv(pu.FOGC, fog.color || [0.6, 0.7, 0.9]); gl.uniform1f(pu.FOGD, fog.density ?? 0.002); gl.uniform1f(pu.FOGH, fog.falloff ?? 0.02); gl.uniform1f(pu.FOGS, fog.scatter ?? 0.35);
      gl.uniform1f(pu.EXPO, exposure); }
    const suv = this.project(sd.map((v, i) => pos[i] + v * 1e4), cam);
    gl.uniform2f(pu.R, this.w, this.h); gl.uniform2f(pu.OFF, 0, offY); gl.uniform2f(pu.SUNUV, suv[0], suv[1]); gl.uniform1f(pu.T, t);
    gl.uniform1f(pu.RAYS, P.rays || 0); gl.uniform3fv(pu.TINT, P.rayTint || [1, 0.9, 0.8]);
    gl.uniform1f(pu.BLOOM, P.bloom ?? 0.6); gl.uniform1f(pu.THR, P.threshold ?? 0.55); gl.uniform1f(pu.VIG, this.handoff ? 0 : P.vignette ?? 0.35);
    gl.uniform1f(pu.SAT_, P.sat ?? 1); gl.uniform1f(pu.CON, P.contrast ?? 0.08); gl.uniform1f(pu.KICK, o.kick || 0); gl.uniform1f(pu.FLASH, o.flash || 0);
    gl.uniform3fv(pu.LIFT, P.lift || [0, 0, 0]); gl.uniform3fv(pu.GAIN, P.gain || [1, 1, 1]); gl.uniform1f(pu.GRAIN, this.handoff ? 0 : P.grain ?? 0.03);
    gl.uniform1f(pu.CREAM, P.cream ?? 0); gl.uniform1f(pu.CRUSH, P.crush ?? 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3); lap('post');
    // 4. upscale to the output / pack the depth under the colour
    if (this.upscale) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.ow, this.oh);
      gl.useProgram(this.up); const uu = this.uu;
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.ptex); gl.uniform1i(uu.P, 5);
      gl.uniform2f(uu.RS, this.w, this.h); gl.uniform2f(uu.RO, this.ow, this.oh); gl.uniform1f(uu.SHARP, o.sharp ?? this.sharp);
      gl.drawArrays(gl.TRIANGLES, 0, 3); lap('upscale');
    } else if (this.handoff) {
      gl.viewport(0, 0, this.w, this.h); gl.useProgram(this.pack);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.dtex); gl.uniform1i(this.ku.D, 4);
      gl.drawArrays(gl.TRIANGLES, 0, 3); lap('pack');
    }
    if (pf) this.stats = st;
    return this.canvas;
  }
  // pixel rect [x, y, w, h] covering the projected bounds of a composed world's parts (null = whole screen)
  _rect(cam) {
    const parts = (this.def.parts || []).filter(p => p.bound && !p.terrain); if (!parts.length) return null;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const p of parts) { const b = p.bound;
      for (let i = 0; i < 8; i++) { const c = [b[0] + (i & 1 ? b[3] : -b[3]), b[1] + (i & 2 ? b[4] : -b[4]), b[2] + (i & 4 ? b[5] : -b[5])];
        const uv = this.project(c, cam); if (uv[0] < -8) return null;
        x0 = Math.min(x0, uv[0]); y0 = Math.min(y0, uv[1]); x1 = Math.max(x1, uv[0]); y1 = Math.max(y1, uv[1]); } }
    const X0 = Math.max(0, Math.floor(x0 * this.w) - 4), Y0 = Math.max(0, Math.floor(y0 * this.h) - 4);
    const X1 = Math.min(this.w, Math.ceil(x1 * this.w) + 4), Y1 = Math.min(this.h, Math.ceil(y1 * this.h) + 4);
    return X1 > X0 && Y1 > Y0 ? [X0, Y0, X1 - X0, Y1 - Y0] : [0, 0, 1, 1];
  }
  // figures closer than minFigureDist read as toys: warn once (the API steers scenes to >= ~15 m)
  _checkFigures(U, pos) {
    if (this._warned) return;
    for (const k of this.def.figures || []) { const s = this.params[k]; if (!Array.isArray(s)) continue; const b = s[0] * 4;
      if (U[b + 3] < 0) continue; const d = Math.hypot(U[b] - pos[0], 1 - pos[1], U[b + 1] - pos[2]);
      if (d < this.minFigureDist) { console.warn(`sdf: camera ${d.toFixed(1)} m from figure '${k}' (< ${this.minFigureDist} m): the SDF figures are built for silhouettes at >= 15 m`); this._warned = true; } }
  }
  // world point -> uv (0..1, y up) for a camera; used for the screen-space shafts and for pinning 2D type to 3D points
  project(p, cam = {}) {
    const pos = cam.pos || [0, 2, 40], tgt = cam.target || [0, 10, 0], roll = cam.roll || 0;
    const ww = norm(sub(tgt, pos)), up = [Math.sin(roll), Math.cos(roll), 0], uu = norm(cross(ww, up)), vv = cross(uu, ww);
    const d = sub(p, pos), z = dot(d, ww), f = 1 / Math.tan((cam.fov || 40) * Math.PI / 360);
    if (z <= 0) return [-9, -9];
    const x = dot(d, uu) / z * f, y = dot(d, vv) / z * f;
    return [0.5 + x * this.h / this.w / 2, 0.5 + y / 2];
  }
  draw(ctx, x = 0, y = 0, w = ctx.canvas.width, h = ctx.canvas.height) { ctx.imageSmoothingQuality = 'high'; ctx.drawImage(this.canvas, x, y, w, h); }
  // readPixels fence: only for profiling (?prof=1) and warm-up; never on the render path
  sync() { const px = new Uint8Array(4); this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px); }
  get far() { return this.defines.FAR; }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
export { sub, dot, cross, norm };
