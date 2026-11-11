// PRINT: print & illustration simulation as a WebGL2 post pipeline. Feed it any render
// (2D canvas, three.js canvas, <img>, <video>, or a previous print result) and it returns
// the same picture pulled through a press: intaglio engraving, CMYK halftone, woodcut /
// linocut, risograph, letterpress, ink bleed, torn paper, on procedural paper stock.
//
//   import { Print } from '../lib/fx/print.js';
//   const pr = new Print();                                   // full-res 1080x1920 pipeline
//   pr.render(ctx, threeCanvas, [['engrave', { pitch: 8 }]],
//             { paper: 'cream', t, prep: { subject: 'aux' }, aux: gb.read() });
//
// Every effect is one fragment pass; steps chain (each reads the previous step's output),
// results can be kept by name (run(..., { out: 'a' })) and composited later ('torn' / 'over' with
// below: 'a'). Deterministic in t: grain "boils" at opts.boil fps (0 = frozen plate).
//
// Tone into the press (run/render opt `prep`, once per source, shared by every step that reads it):
//   auto levels from a histogram (percentiles; gamma puts the median on `mid`), edge-preserving
//   simplification (box-filtered Kuwahara at ~the line pitch: detail finer than a line merges into
//   shapes instead of aliasing into scratch-noise), local-contrast boost, and a subject weight
//   (G-buffer mask, depth range or a canvas) that keeps full ink on the subject and clears the ground.
// Object-anchored patterns (run opt `aux` = G-buffer: view normal + linear depth, object UV + subject
//   mask; see lib/fx/gbuffer.js): engraving lines, woodcut gouges, and (space: 'uv') halftone screens and
//   riso grain follow UV isolines with octave LOD, pitch scales with depth, contours from depth/normal breaks.
// Layers: alpha: 'ink' (ink coverage as alpha, stock transparent), opaque inks (opaque: true / foil: true)
//   for cream-on-black and gold, `mask` (canvas or target) limits any press or shapes a torn sheet.
// Overprint: any press step takes onto: '<target>' to print on a previous impression instead of fresh stock
// (two-colour letterpress, red block under a black key, riso drums). Per-step levels: [black, white, gamma].
import { W, H } from '../kit.js';

// ------------------------------------------------------------------ stock and inks
export const PAPERS = {
  cream:     { base: '#efe2c6', fib: 0.9, laid: 0.35, fleck: 0.25, mottle: 0.6, tooth: 0.7 },
  ivory:     { base: '#f4ead6', fib: 0.6, laid: 0.0, fleck: 0.1, mottle: 0.35, tooth: 0.5 },
  newsprint: { base: '#dcd6c6', fib: 1.2, laid: 0.0, fleck: 1.0, mottle: 0.8, tooth: 0.4 },
  kraft:     { base: '#b98f63', fib: 1.6, laid: 0.0, fleck: 0.6, mottle: 0.9, tooth: 0.8 },
  cotton:    { base: '#f5f1e8', fib: 0.5, laid: 0.0, fleck: 0.05, mottle: 0.25, tooth: 1.0 },
  rag:       { base: '#e9dcc0', fib: 1.4, laid: 0.6, fleck: 0.5, mottle: 1.0, tooth: 1.2 },
  black:     { base: '#161211', fib: 0.8, laid: 0.0, fleck: 0.1, mottle: 0.5, tooth: 0.9 },    // black stock for opaque / foil inks
  oxblood:   { base: '#3a0d10', fib: 0.9, laid: 0.2, fleck: 0.1, mottle: 0.7, tooth: 0.8 },
};
export const INKS = {
  black: '#16130f', carbon: '#0e0d0c', sepia: '#3a2416', blueblack: '#141a2a',
  red: '#c91f37', acp: '#bd1818', vermilion: '#d8341e', cream: '#f4e6d0', white: '#f7f1e3', gold: '#c9a04a', foil: '#d9b25e',
  // process
  cyan: '#00a0dc', magenta: '#e2007a', yellow: '#ffe600', key: '#1c1a1a',
  // Riso drum colours (published Riso spot colours)
  risoRed: '#ff4c3b', brightRed: '#f15060', fluoPink: '#ff48b0', federal: '#3d5588', medBlue: '#3255a4',
  risoBlue: '#0078bf', teal: '#00838a', green: '#00a95c', risoYellow: '#ffe800', orange: '#ff6c2f',
  burgundy: '#914e72', risoBlack: '#1a1a1a', purple: '#765ba7',
};
const hex = h => { h = INKS[h] || h; const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

// shipping preset: slower boil (encoders smear per-frame grain) and phone-scale minimum pitch / cell / grain (1080-px units)
export const SHIP = { boil: 6, min: { engrave: { pitch: 8 }, woodcut: { pitch: 12 }, halftone: { cell: 10 }, riso: { grain: 2, screen: 9 }, letterpress: { screen: 9 } } };

// ------------------------------------------------------------------ GLSL
const HEAD = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D SRC, AN, AB, PAPER, BELOW, NZ, AUXN, AUXU, MASK, SUBJ, ORIG;
uniform vec2 R; uniform float T, SEED, S, FR, LODB; uniform vec3 LV, PBASE;
uniform vec2 DRANGE, DPITCH; uniform vec3 MASKM;
// feature switches (HASAUX, UVSP, AOUT, OPQ, FOIL, HASMASK, OUTM, ONTO, TENS, <uniform>_ON) are compile-time #defines:
// SwiftShader runs both sides of a uniform branch, so every unused option used to cost its taps on every pixel
out vec4 o;
#define PI 3.14159265
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*n2(p); p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(1.7,9.2); a*=.5; } return v; }
// baked tileable noise (one texture fetch instead of 16 hashes): fbmT ~ fbm, nT ~ n2
// two taps at incommensurate scale/rotation hide the 32-unit tile period
float fbmT(vec2 p){ vec2 q=mat2(.8,.6,-.6,.8)*p*1.37+11.3; return (texture(NZ, p*.03125).r+texture(NZ, q*.03125).b)*.5*1.25-.125; }
vec2 fbm2T(vec2 p){ vec2 q=mat2(.8,.6,-.6,.8)*p*1.37+11.3; vec4 a=texture(NZ, p*.03125), b=texture(NZ, q*.03125); return (vec2(a.r+b.b, a.b+b.r))*.5*1.25-.125; }
float nT(vec2 p){ return texture(NZ, p*.0078125).g; }
float lum(vec3 c){ return dot(c, vec3(.299,.587,.114)); }
float lvl(float l){ return pow(clamp((l-LV.x)/max(LV.y-LV.x,1e-3),0.,1.), LV.z); }
vec3 lvl3(vec3 c){ return pow(clamp((c-LV.x)/max(LV.y-LV.x,1e-3),0.,1.), vec3(LV.z)); }
vec3 srcC(vec2 uv, float lod){ return lvl3(textureLod(SRC, uv, max(lod+LODB,0.)).rgb); }
float srcL(vec2 uv, float lod){ return lvl(lum(textureLod(SRC, uv, max(lod+LODB,0.)).rgb)); }
// the sheet being printed on: fresh stock, or (ONTO) a previous impression for overprinting; alpha mode prints on clear film
vec4 paper(vec2 uv){ vec4 p=texture(PAPER, uv); if(AOUT>.5) p.rgb=vec3(1.); else if(ONTO>.5) p.rgb=texture(BELOW,uv).rgb; return p; }
vec3 tr(vec3 ink){ return ink/max(PBASE,.05); }   // ink as transmittance over the stock
// gradient direction from the smoothed structure tensor (doubled-angle vector), biased to ang0 in flat areas; TENS=0: flat angle
vec2 gdir(vec2 uv, float ang0, float bias){ if(TENS<.5) return vec2(cos(ang0),sin(ang0));
  vec2 v=texture(AB,uv).gb*2.-1.; v+=bias*vec2(cos(2.*ang0),sin(2.*ang0));
  float th=.5*atan(v.y,v.x); return vec2(cos(th),sin(th)); }
// stripes across direction g without phase chaos: 6 fixed orientations, widths split by alignment weight.
// returns ink coverage 0..1 of lines of width w (fraction of the pitch) that run perpendicular to g.
float hatch(vec2 p, vec2 g, float pitch, float w, float bend, float off){
  float ga=atan(g.y,g.x)+off; float x=ga/(PI/6.); float k0=floor(x), fr=x-k0;
  float aa=1.6/(pitch*S), acc=1.;
  if(TENS<.5){ vec2 dk=vec2(cos(ga),sin(ga)); float dist=abs(fract(dot(p,dk)/pitch+bend)-.5)*2.; return (1.-smoothstep(w-aa,w+aa,dist))*step(.01,w); }
  for(int j=0;j<2;j++){ float k=k0+float(j); float c=cos((k-x)*PI/6.); float wk=pow(c*c,10.);
    float c2=cos((k+(j==0?1.:-1.)-x)*PI/6.); float wo=pow(c2*c2,10.); float wn=wk/(wk+wo);
    if(wn>.04){ float a=k*PI/6.; vec2 dk=vec2(cos(a),sin(a));
      float ph=dot(p,dk)/pitch+bend; float dist=abs(fract(ph)-.5)*2.;
      float ww=w*mix(wn,1.,.35)*(wn>.5?1.:wn*1.6);
      acc*=1.-(1.-smoothstep(ww-aa,ww+aa,dist))*step(.01,ww); } }
  return 1.-acc; }
// ---- G-buffer (aux): AUXN = view normal xyz + linear depth (0 = no geometry), AUXU = object uv + subject + coverage
float dscale(float z){ return mix(DPITCH.x, DPITCH.y, clamp((z-DRANGE.x)/max(DRANGE.y-DRANGE.x,1e-3),0.,1.)); }
// octave LOD for an object coordinate: returns (f0, blend) so that c*f0 has ~one unit per P output px; patterns
// split / merge by octaves as the object nears / recedes (anchored to the object: no swimming). Uniform flow only.
vec2 octv(vec2 c, float P){ float g=max(max(length(dFdx(c)),length(dFdy(c))),1e-7);
  float L=log2(1./(P*g)); return vec2(exp2(floor(L)), smoothstep(0.,1.,fract(L))); }
// ink coverage of lines along isolines of object coordinate c, target pitch P (output px), coverage w (0..1)
float isoLines(float c, float P, float w){
  float g=max(length(vec2(dFdx(c),dFdy(c))),1e-7); float L=log2(1./(P*g)); float bl=smoothstep(0.,1.,fract(L));
  float ph=c*exp2(floor(L)); float aa=clamp(fwidth(ph)*2.,.02,.5);
  float de=abs(fract(ph+.5)-.5)*2., dO=abs(fract(ph)-.5)*2.;          // 0 on the even / odd lines, 1 midway
  float we=w*mix(1.,.5,bl), wo=w*.5*bl;
  float ce=(1.-smoothstep(we-aa,we+aa,de))*step(.005,we), co=(1.-smoothstep(wo-aa,wo+aa,dO))*step(.005,wo);
  return max(ce,co); }
// ---- inks: multiply (transparent ink) or opaque / foil (covers the stock; cream on black, gold)
vec3 CP_=vec3(0.); float CA_=0.;
vec3 foilC(vec3 ink){ vec2 p=gl_FragCoord.xy/S; float sw=sin((p.x*.8+p.y*.45)*.0042-T*1.1+SEED*3.);
  float hi=pow(max(sw,0.),5.); float br=.55*nT(vec2(p.x*.012,p.y*.6))+.45*fbmT(p*.01);
  return clamp(ink*(.5+.35*br+.75*hi)+vec3(1.,.93,.75)*pow(max(sw,0.),30.)*.6,0.,1.); }
vec3 inkOn(vec3 col, vec3 ink, float k){ k=clamp(k,0.,1.);
  if(OPQ<.5) return col*mix(vec3(1.), tr(ink), k);
  vec3 ic=FOIL>.5?foilC(ink):ink; CP_=CP_*(1.-k)+ic*k; CA_=CA_*(1.-k)+k; return mix(col, ic, k); }
vec4 over(vec4 a, vec4 b){ float oa=a.a+b.a*(1.-a.a); return vec4(oa>1e-5?(a.rgb*a.a+b.rgb*b.a*(1.-a.a))/oa:vec3(0.), oa); }
vec4 mixA(vec4 a, vec4 b, float t){ vec4 p=mix(vec4(a.rgb*a.a,a.a), vec4(b.rgb*b.a,b.a), t); return vec4(p.a>1e-5?p.rgb/p.a:vec3(0.), p.a); }
float maskAt(vec2 uv, float lod){ vec4 t=textureLod(MASK, uv, lod); float m=MASKM.x<.5?t.a:MASKM.x<1.5?lum(t.rgb):lum(t.rgb)*t.a; return MASKM.y>.5?1.-m:m; }
// every press ends here: opaque sheet, or ink-as-alpha; then the mask limits it (outside: stock / below / source / clear)
vec4 fin(vec3 col, vec2 uv){ vec4 r;
  if(AOUT>.5){
    if(OPQ>.5) r=vec4(CA_>1e-4?CP_/CA_:vec3(0.), CA_);
    else { vec3 Tt=clamp(col,0.,1.); float a=1.-min(Tt.r,min(Tt.g,Tt.b)); r=vec4(a>1e-4?(Tt-(1.-a))/a:vec3(0.), a); }
    if(ONTO>.5) r=over(r, texture(BELOW,uv));
  } else r=vec4(col,1.);
  if(HASMASK>.5){ float m=maskAt(uv,0.);
    vec4 outside=OUTM<.5?(AOUT>.5?vec4(0.):vec4(texture(PAPER,uv).rgb,1.)):OUTM<1.5?texture(BELOW,uv):OUTM<2.5?vec4(texture(ORIG,uv).rgb,1.):vec4(0.);
    r=mixA(outside, r, m); }
  return r; }
`;

const FS = {
  // blit / copy (optional vignette on the way out)
  copy: `uniform float VIG; void main(){ vec2 uv=gl_FragCoord.xy/R; vec4 c=texture(SRC, uv);
    if(VIG>0.){ vec2 q=(uv-.5)*vec2(1.,R.y/R.x); c.rgb*=1.-VIG*smoothstep(.35,1.05,length(q)*1.05); } o=c; }`,

  // ---------------- tone prep (once per source) ----------------
  // tiny luminance + subject weight map for the auto-levels histogram
  lumTiny: `uniform float LOD; uniform vec2 SUBJD;
  float subjW(vec2 uv){ if(SUBJM<.5) return 1.; if(SUBJM<1.5) return texture(AUXU,uv).b; if(SUBJM<2.5){ float z=texture(AUXN,uv).w; return z<=0.?0.:1.-smoothstep(SUBJD.x,SUBJD.y,z); } vec4 s=texture(SUBJ,uv); return lum(s.rgb)*s.a; }
  void main(){ vec2 uv=gl_FragCoord.xy/R; o=vec4(lum(textureLod(SRC,uv,LOD).rgb), subjW(uv), 0., 1.); }`,
  // levelled source at prep res: rgb + lum^2 (for the Kuwahara variances)
  prepDown: `uniform float LOD; void main(){ vec3 c=lvl3(textureLod(SRC,gl_FragCoord.xy/R,LOD).rgb); float l=lum(c); o=vec4(c,l*l); }`,
  // generalized Kuwahara from four quadrant means read off the mip chain of (rgb, lum^2) (weights fall with the
  // quadrant variance; no box passes), then local contrast,
  // subject weighting (full ink on the subject, ground cleared toward the stock), optional negative plate
  prepK: `uniform float KOFF, KLOD, BOOST, CLEAR, SUBK, LODBIG, SUBJMAX; uniform vec2 SUBJD, TX;
  float subjW(vec2 uv){ if(SUBJM<.5) return 1.; if(SUBJM<1.5) return texture(AUXU,uv).b; if(SUBJM<2.5){ float z=texture(AUXN,uv).w; return z<=0.?0.:1.-smoothstep(SUBJD.x,SUBJD.y,z); } vec4 s=texture(SUBJ,uv); return lum(s.rgb)*s.a; }
  void main(){ vec2 uv=gl_FragCoord.xy/R; vec3 c;
    if(KOFF_ON>.5){ vec3 acc=vec3(0.); float ws=0.;
      for(int k=0;k<4;k++){ vec2 off=vec2((k==0||k==2)?-1.:1., k<2?-1.:1.)*KOFF*TX; vec4 s=textureLod(SRC,uv+off,KLOD);
        float ml=lum(s.rgb); float v=max(s.a-ml*ml,0.); float wk=1./(1.+pow(v*400.,2.)); acc+=s.rgb*wk; ws+=wk; }
      c=acc/ws; }
    else c=texture(SRC,uv).rgb;
    float l=lum(c), lbig=lvl(lum(textureLod(ORIG,uv,LODBIG).rgb));
    float lb=clamp(l+BOOST*(l-lbig),0.,1.);
    vec3 rc=c; float lr=l;
    if(NEG_ON>.5){ lb=1.-lb; rc=1.-c; lr=1.-l; }     // negative plate (light ink on dark stock): the lights take the ink
    float w=subjW(uv);
    float lf=mix(mix(lb,1.,CLEAR), mix(lb, lb*lb*(3.-2.*lb), SUBK), w);   // cleared ground = no ink, either way
    lf=mix(lf, min(lf, SUBJMAX), step(.5, w));      // subjMax: no paper-white highlight blobs inside a figure (hands, hi-vis)
    vec3 oc=lf>lr?mix(rc, vec3(1.), (lf-lr)/max(1.-lr,1e-3)):rc*(lf/max(lr,1e-3));
    o=vec4(clamp(oc,0.,1.), w); }`,
  // pack canvas G-buffer channels (normal rgb, depth r 0..1, uv rg, mask r) into the float aux targets
  auxPack: `uniform float MODE; void main(){ vec2 uv=gl_FragCoord.xy/R; float z=texture(AN,uv).r; float cov=step(z,.999);
    if(MODE<.5) o=vec4(texture(SRC,uv).rgb*2.-1., cov>0.?max(z,1e-3):0.); else o=vec4(texture(AB,uv).rg, texture(BELOW,uv).r*cov, cov); }`,

  // analysis at reduced res: r = levelled luminance, gb = doubled-angle gradient vector, a = edge strength
  analyze: `uniform vec2 SR;
  void main(){ vec2 uv=gl_FragCoord.xy/R; vec2 d=1./R;
    float l00=srcL(uv+d*vec2(-1,-1),1.5), l10=srcL(uv+d*vec2(0,-1),1.5), l20=srcL(uv+d*vec2(1,-1),1.5);
    float l01=srcL(uv+d*vec2(-1,0),1.5),  l11=srcL(uv,1.5),               l21=srcL(uv+d*vec2(1,0),1.5);
    float l02=srcL(uv+d*vec2(-1,1),1.5),  l12=srcL(uv+d*vec2(0,1),1.5),  l22=srcL(uv+d*vec2(1,1),1.5);
    float gx=(l20+2.*l21+l22)-(l00+2.*l01+l02), gy=(l02+2.*l12+l22)-(l00+2.*l10+l20);
    float g2=gx*gx+gy*gy; vec2 v=vec2(gx*gx-gy*gy, 2.*gx*gy)/(g2+1e-6)*(g2/(g2+.004));
    o=vec4(l11, v*.5+.5, clamp(sqrt(g2)*2.,0.,1.)); }`,
  blur: `uniform vec2 DIR;
  void main(){ vec2 uv=gl_FragCoord.xy/R; vec4 s=texture(SRC,uv)*.2270;
    s+=(texture(SRC,uv+DIR*1.385)+texture(SRC,uv-DIR*1.385))*.3162;
    s+=(texture(SRC,uv+DIR*3.231)+texture(SRC,uv-DIR*3.231))*.0703; o=s; }`,

  // tileable noise bake (512px, REPEAT): r,b = 4-octave fbm on a 32-cell lattice, g = value noise on a 128-cell lattice, a = white
  noise: `float hp(vec2 i, float P, float sd){ return h21(mod(i,P)+sd); }
  float np(vec2 p, float P, float sd){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hp(i,P,sd),hp(i+vec2(1,0),P,sd),f.x),mix(hp(i+vec2(0,1),P,sd),hp(i+vec2(1,1),P,sd),f.x),f.y); }
  float fp(vec2 p, float P, float sd){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*np(p,P,sd); p*=2.; P*=2.; a*=.5; } return v/.9375; }
  void main(){ vec2 u=gl_FragCoord.xy/R; o=vec4(fp(u*32.,32.,0.), np(u*128.,128.,5.), fp(u*32.,32.,17.), h21(gl_FragCoord.xy)); }`,

  // procedural stock: rgb = paper colour, a = surface height (tooth / fibre relief). Built on the baked noise
  // (was ALU fbm + two fibre layers; preload() moves the bake to setup so no frame pays for a first use)
  paper: `uniform vec3 BASE; uniform float FIB, LAID, FLECK, MOTTLE, TOOTH;
  float fibre(vec2 p, float cs, float sd){ vec2 c=floor(p/cs); float f=0.;
    for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 id=c+vec2(i,j); float r=h21(id+sd);
      vec2 o0=(id+vec2(h21(id+3.1+sd),h21(id+7.7+sd)))*cs; float a=r*6.2831; vec2 dd=vec2(cos(a),sin(a));
      vec2 q=p-o0; float t=clamp(dot(q,dd),-cs*.9,cs*.9); float bend=sin(t*.08+r*9.)*3.;
      float dist=length(q-dd*t-vec2(-dd.y,dd.x)*bend); f=max(f, (1.-smoothstep(.3,1.1,dist))*(.4+.6*h21(id+2.))); }
    return f; }
  void main(){ vec2 p=gl_FragCoord.xy/S;
    float m=fbmT(p*.004)*.7+fbmT(p*.02+3.)*.3;
    float fb=fibre(p,30.,0.);
    float tooth=fbmT(p*.45)*.6+nT(p*1.3)*.4;
    float laid=LAID*(.5+.5*smoothstep(.75,1.,abs(sin(p.y*.55))))+LAID*1.4*smoothstep(.985,1.,abs(sin(p.x*.0245)));
    float dark=step(lum(BASE),.3);
    vec3 c=BASE*(1.-.07*MOTTLE*(m-.5)*2.)*(1.-.035*TOOTH*(tooth-.5)*2.)+dark*vec3(.014)*MOTTLE*(m-.5)*2.;
    c*=1.-.04*laid; c=mix(c, c*vec3(1.05,1.03,.98)+dark*vec3(.03), fb*.35*FIB);
    float fl=step(.9975-.0015*FLECK, h21(floor(p/1.6)+.3))*FLECK;
    c*=1.-fl*(.25+.4*h21(floor(p/1.6)+9.));
    float cf=smoothstep(.93,1.,fibre(p*.5,60.,11.))*FLECK*.6; c=mix(c, vec3(.55,.2,.18)*c, cf*.5);
    o=vec4(c, clamp(.5+(tooth-.5)*TOOTH*.9+fb*.25*FIB-(m-.5)*.2,0.,1.)); }`,

  // INTAGLIO ENGRAVING: swelling lines along the contours, bent by the form, crosshatch in the shadows,
  // stipple in the half-lights, plate tone, optional watercolour wash and plate mark.
  // With aux: lines are UV isolines on the objects (cross-contour, like a burin), pitch by depth, contour lines at
  // depth / normal breaks; the sky / background keeps screen-space ruling at ANG.
  engrave: `uniform float PITCH, ANG, BENDK, XH, STIP, WASH, PLATE, MARK, CONT; uniform vec3 INK;
  void main(){ vec2 uv=gl_FragCoord.xy/R; vec2 p=gl_FragCoord.xy/S; vec4 pp=paper(uv);
    float ls=srcL(uv,.6), lb=texture(AN,uv).r, l=mix(ls,lb,.3); float d=1.-l;
    float wob=.86+.28*nT(p*.02+SEED);
    float w1=clamp(d*1.08*wob,0.,.9), w2=clamp((d-.46)*1.5*wob,0.,.8)*XH, w3=clamp((d-.74)*2.2,0.,.8)*XH;
    float c1=0., c2=0., c3=0., ga=0., cont=0., st=0.;
    vec2 g=gdir(uv,ANG,.3);
    if(HASAUX>.5){
      vec4 au=texture(AUXU,uv), an=texture(AUXN,uv); ga=smoothstep(.55,.95,au.a);
      float P=PITCH*S*dscale(an.w);
      c1=isoLines(au.x, P, w1); c2=isoLines(au.y, P*.92, w2); c3=isoLines((au.x+au.y)*.7071, P*.8, w3);
      vec2 oc=octv(au.xy, P*.9); vec2 sp=au.xy*oc.x; vec2 si=floor(sp); vec2 sf=fract(sp)-.5+(vec2(h21(si),h21(si+4.))-.5)*.35;
      st=(1.-smoothstep(.0,.08+.22*smoothstep(.05,.4,d),length(sf)))*STIP*step(.04,d)*(1.-smoothstep(.3,.5,d))*(1.-oc.y*.5);
      if(CONT_ON>.5){ float k=1.6*S; float dz=k*length(vec2(dFdx(an.w),dFdy(an.w)))/max(an.w,1e-3);      // contour at depth / crease breaks,
        float dn=k*length(vec3(length(dFdx(an.xyz)),length(dFdy(an.xyz)),0.));                          // from derivatives: no extra taps
        cont=CONT*max(smoothstep(.03,.09,dz), smoothstep(.35,.8,dn)*step(.5,au.a)); }
      c1*=ga; c2*=ga; c3*=ga; st*=ga;
    }
    if(ga<.99){ float k=1.-ga; float bend=lb*BENDK+(TENS>.5?.35*fbmT(p*.004+SEED):0.);   // with a G-buffer the background ruling stays straight
      c1=max(c1,hatch(p,g,PITCH,w1,bend,0.)*k);
      c2=max(c2,hatch(p,g,PITCH*.92,w2,bend*.6,1.05)*k);
      c3=max(c3,hatch(p,g,PITCH*.8,w3,0.,-.62)*k);
      vec2 sp=p/(PITCH*.9); vec2 si=floor(sp); vec2 sf=fract(sp)-.5+(vec2(h21(si),h21(si+4.))-.5)*.35;
      st=max(st,(1.-smoothstep(.0,.08+.22*smoothstep(.05,.4,d),length(sf)))*STIP*step(.04,d)*(1.-smoothstep(.3,.5,d))*k); }
    float cov=1.-(1.-c1)*(1.-c2)*(1.-c3)*(1.-st)*(1.-cont);
    cov*=.82+.18*smoothstep(.25,.7,pp.a+.2*nT(p*.7));
    float tone=PLATE*(.05+.1*fbmT(p*.006+SEED))*(.4+d);
    vec3 base=pp.rgb;
    if(WASH_ON>.5){ vec3 sc=srcC(uv,3.); vec3 w=mix(vec3(1.),sc/max(max(sc.r,max(sc.g,sc.b)),.2),.8); base*=mix(vec3(1.),w,WASH*(.4+.6*smoothstep(.1,.8,fbmT(p*.01+2.)))); }
    vec3 col=inkOn(base, OPQ>.5?INK:INK*.95, clamp(cov+tone,0.,1.));
    if(MARK_ON>.5){ vec2 hs=R/S*.5; vec2 q=abs(p-hs)-(hs-MARK); float e=max(q.x,q.y); float sh=smoothstep(-6.,0.,e)*(1.-smoothstep(0.,4.,e)); col*=1.-.12*sh; col*=1.+.05*smoothstep(0.,3.,e)*(1.-smoothstep(3.,12.,e)); if(e>0.) col=mix(col,pp.rgb*1.02,.9); }
    o=fin(col,uv); }`,

  // CMYK HALFTONE: GCR separation, four rotated screens, per-plate misregistration, dot gain & ragged dots
  // (space: 'uv' + aux: the screens are printed on the objects, octave-LOD cells)
  halftone: `uniform float CELL, GAIN, ROUGH, KONLY; uniform vec4 ANGS; uniform vec2 M0,M1,M2,M3; uniform vec3 IC, IM, IY, IK;
  vec4 cmyk(vec3 c){ float k=1.-max(max(c.r,c.g),c.b); vec3 cmy=(1.-c-k)/(1.-k+1e-4); return vec4(cmy,k); }
  vec2 UC; vec2 UO; float UG;
  float spot(vec2 q){ return .5*(cos(6.2831*q.x)+cos(6.2831*q.y)); }
  float plate(vec2 p, float ang, int ch){ float ca=cos(ang), sa=sin(ang); mat2 m=mat2(ca,sa,-sa,ca);
    float sp=spot(m*p/CELL);
    if(UG>0.) sp=mix(sp, mix(spot(m*UC*UO.x), spot(m*UC*UO.x*2.), UO.y), UG);
    vec3 c=srcC(p*S/R, log2(CELL*S*.5)); vec4 k=cmyk(c); float v=KONLY_ON>.5?1.-lum(c):k[ch];
    v=clamp(v*(1.+GAIN)-.03,0.,1.);
    sp+=ROUGH*(nT(p*.9+float(ch)*13.+FR*1.7)-.5)*.35*(1.-UG*.6);
    float th=(1.-2.*v)*1.12; float aa=6.2831/(CELL*S)*.9;
    return smoothstep(th-aa,th+aa,sp)*step(.015,v); }
  void main(){ vec2 uv=gl_FragCoord.xy/R; vec2 p=gl_FragCoord.xy/S; vec4 pp=paper(uv); vec3 col=pp.rgb;
    UG=0.; UC=vec2(0.); UO=vec2(1.,0.);
    if(HASAUX>.5 && UVSP>.5){ vec4 au=texture(AUXU,uv); float z=texture(AUXN,uv).w; UC=au.xy; UO=octv(au.xy, CELL*S*dscale(z)); UG=smoothstep(.55,.95,au.a); }
    float ab=.8+.2*smoothstep(.2,.7,pp.a);
    if(KONLY_ON>.5){ col=inkOn(col,IK,plate(p+M3,ANGS.w,3)*ab); o=fin(col,uv); return; }
    col=inkOn(col,IY,plate(p+M2,ANGS.z,2)*ab);
    col=inkOn(col,IM,plate(p+M1,ANGS.y,1)*ab);
    col=inkOn(col,IC,plate(p+M0,ANGS.x,0)*ab);
    col=inkOn(col,IK,plate(p+M3,ANGS.w,3)*ab);
    o=fin(col,uv); }`,

  // WOODCUT / LINOCUT: posterised key block with jagged cut edges, gouge strokes in the midtones following
  // the form, chisel flecks along the edges, wood grain & starved ink in the solids; optional second (red) block.
  // With aux: the gouges are UV isolines on the objects (tapered segments along the other coordinate), octave LOD.
  woodcut: `uniform float T1, T2, PITCH, JAG, GRAIN, CHISEL, LINO, TWO, ANG, CONT; uniform vec3 INK, INK2; uniform vec2 OFF2;
  // white gouge strokes across g, width u (0..1 of pitch), tapered at both ends; two nearest of 6 orientations
  float gouge(vec2 p, vec2 g, float pitch, float u, float bend, float seglen){
    float ga=atan(g.y,g.x); float x=ga/(PI/6.); float k0=floor(x); float cut=0.; float aa=1.6/(pitch*S);
    for(int j=0;j<2;j++){ float k=k0+float(j); float c=cos((k-x)*PI/6.); float wk=pow(c*c,10.);
      float c2=cos((k+(j==0?1.:-1.)-x)*PI/6.); float wo=pow(c2*c2,10.); float wn=wk/(wk+wo);
      if(wn>=.5){ float an=k*PI/6.; vec2 dk=vec2(cos(an),sin(an)), tk=vec2(-dk.y,dk.x);   // one gouge direction per region: no crosshatch in a block cut
        float ph=dot(p,dk)/pitch+bend; float li=floor(ph);
        float seg=fract(dot(p,tk)/(pitch*seglen)+h21(vec2(li,SEED))*7.);
        float taper=pow(max(sin(PI*seg),0.),.7);
        float cw=u*taper*(.85+.3*nT(p*.05));
        float dist=abs(fract(ph)-.5)*2.;
        cut=max(cut, 1.-smoothstep(cw-aa,cw+aa,dist)); } }
    return cut; }
  // gouges along isolines of object coordinate c, segmented along cs (both anchored to the object)
  float isoGouge(float c, float cs, float P, float u, float seglen, vec2 p){
    float g=max(length(vec2(dFdx(c),dFdy(c))),1e-7); float L=log2(1./(P*g)); float bl=smoothstep(0.,1.,fract(L));
    float ph=c*exp2(floor(L)); float aa=clamp(fwidth(ph)*2.,.02,.5);
    vec2 os=octv(vec2(cs), P*seglen); float cut=0., wn=.85+.3*nT(p*.05);
    for(int j=0;j<2;j++){ float q=ph-(j==0?0.:.5); float li=floor(q+.5); float dd=abs(q-li)*2.;
      float wj=j==0?u*mix(1.,.5,bl):u*.5*bl;
      float r=h21(vec2(li,float(j)+SEED))*7.;
      float s0=fract(cs*os.x+r), s1=fract(cs*os.x*2.+r);
      float taper=mix(pow(max(sin(PI*s0),0.),.7), pow(max(sin(PI*s1),0.),.7), os.y);
      float cw=wj*taper*wn;
      cut=max(cut,(1.-smoothstep(cw-aa,cw+aa,dd))*step(.005,wj)); }
    return cut; }
  void main(){ vec2 uv=gl_FragCoord.xy/R; vec2 p=gl_FragCoord.xy/S; vec4 pp=paper(uv);
    vec2 g=gdir(uv,ANG,.6); vec4 an0=texture(AN,uv); float lb=an0.r;
    vec2 w=(fbm2T(p*.018+SEED)-.5)*JAG*14.;
    vec2 uw=(p+w)*S/R; float l=srcL(uw,mix(1.2,2.,LINO));
    l=mix(l,lb,.25);
    float solid=1.-smoothstep(T1-.03,T1+.03,l);
    float u=clamp((mix(l,lb,.7)-T1)/(T2-T1),0.,1.);   // stroke width from the blurred tone: long clean gouges, not chatter
    float segl=mix(12.,16.,LINO);
    float ga=0., cut=0., sep=0.;
    if(HASAUX>.5){ vec4 au=texture(AUXU,uv), an=texture(AUXN,uv); ga=smoothstep(.55,.95,au.a);
      cut=isoGouge(au.x, au.y, PITCH*S*dscale(an.w), u, segl*.35, p)*ga;
      if(dot(an.xy,an.xy)>.01) g=normalize(an.xy);
      if(CONT_ON>.5){ float dz=1.3*S*length(vec2(dFdx(an.w),dFdy(an.w)))/max(an.w,1e-3);
        sep=CONT*smoothstep(.035,.1,dz)*step(.5,au.a); } }   // white cut where one form passes in front of another
    if(ga<.99) cut=max(cut, gouge(p,g,PITCH,u,lb*mix(2.,4.,LINO)+.5*fbmT(p*.004),segl)*(1.-ga));
    float mid=(1.-solid)*(1.-smoothstep(T2-.04,T2+.04,l));
    float ink=max(solid, mid*(1.-cut))*(1.-sep);
    // chisel chips: small tapered white flakes bitten into the black along strong edges
    vec2 tg=vec2(-g.y,g.x);
    float e=an0.a; vec2 cq=p/9.; vec2 ci=floor(cq); vec2 cf=fract(cq)-.5+(vec2(h21(ci+3.),h21(ci+5.))-.5)*.4;
    float chip=step(.88,h21(ci+SEED))*smoothstep(.12,.35,e)*CHISEL*(1.-LINO*.6);
    float along=dot(cf,g), acr=dot(cf,tg); float tri=step(abs(acr),.07*(1.-clamp(along/.4+.5,0.,1.)))*step(abs(along),.3);
    ink*=1.-chip*tri;
    // chatter: stray uncut bits in the cleared areas
    float k=ink;
    if(CHISEL>0. && ink<.5 && h21(floor(p/5.)+SEED)>.985) k=max(k, step(.6,fbmT(p*.02))*(1.-mid)*(1.-solid)*CHISEL);
    // wood grain in the ink (plank) or salty mottle (lino)
    if(k>.5){                                          // only inked pixels pay for the grain
      float starve=.18*smoothstep(.5,.2,pp.a);
      if(LINO_ON<.5){ vec2 gw=fbm2T(vec2(p.x*.003,p.y*.02)+SEED); float gl=.5+.5*sin(p.y*.33+gw.x*22.+gw.y*5.);
        starve+=smoothstep(.86,.97,gl)*(.5+.5*smoothstep(.4,.7,fbmT(p*.01+3.)))*GRAIN*.55; }   // thin pale grain lines, patchy
      else starve+=smoothstep(.6,.75,fbmT(p*.12)*.8+pp.a*.35)*GRAIN*.3;                        // salty lino
      k*=1.-clamp(starve,0.,1.); }
    vec3 col=pp.rgb;
    if(TWO_ON>.5){ vec2 p2=p+OFF2; vec2 u2=p2*S/R; vec3 sc=srcC(u2,2.5); float red=smoothstep(.06,.22,sc.r-max(sc.g,sc.b));
      float l2=srcL(u2,2.); float band=smoothstep(T1-.1,T1+.08,l2)*(1.-smoothstep(mix(T2,.95,.6),.98,l2));
      float rb=clamp(max(red,band*.85),0.,1.)*TWO; rb=smoothstep(.35,.55,rb+(fbmT(p2*.03)-.5)*.25);
      rb*=1.-GRAIN*.35*smoothstep(.55,.75,fbmT(p2*.15+4.));
      rb*=1.-smoothstep(.6,.76,l2);                     // the brightest lights are cut out of the red block too
      col=inkOn(col,INK2,rb); }
    col=inkOn(col,OPQ>.5?INK:INK*.97,k);
    o=fin(col,uv); }`,

  // RISOGRAPH: log-space separation into up to 3 spot inks, grain screen, per-drum misregistration,
  // uneven drum coverage and banding; inks multiply (overprint purples, browns...)
  // (screen > 0: the same spot separation screened as AM rosettes instead of riso grain = spot-colour offset litho)
  // (space: 'uv' + aux: grain / rosettes on the objects)
  riso: `uniform mat3 SEP; uniform vec3 I0,I1,I2,PB,SANG,SCRV; uniform vec2 O0,O1,O2; uniform float GR, AMT, UNEVEN, CONTR, SCR, SOFT, RGH;
  vec2 UC; vec2 UO; float UG; vec3 UNV; vec3 BND;
  float layer(int k, vec2 p, vec2 off){ vec2 q=p+off; vec2 uv=q*S/R; vec3 c=srcC(uv,SOFT);
    vec3 ld=log(max(c,.015)/PB); vec3 dd=SEP*ld; float d=k==0?dd.x:k==1?dd.y:dd.z;
    d=clamp((d-.5)*CONTR+.5,0.,1.)*AMT;
    d*=1.-UNEVEN*(.25*UNV[k]+.08*(.5+.5*sin(q.y*.045+float(k)*2.)));
    float dot_;
    if(SCR_ON>.5){ float scr=k==0?SCRV.x:k==1?SCRV.y:SCRV.z;
      if(scr<.5) dot_=d;                                  // screens[k] = 0: this ink prints flat (a mixed tint ink, no dots)
      else { float an=k==0?SANG.x:k==1?SANG.y:SANG.z; float ca=cos(an), sa=sin(an); mat2 m=mat2(ca,sa,-sa,ca); vec2 z=m*q/scr;
      float sp=.5*(cos(6.2831*z.x)+cos(6.2831*z.y));
      if(UG>0.){ vec2 z0=m*UC*UO.x, z1=z0*2.; sp=mix(sp, mix(.5*(cos(6.2831*z0.x)+cos(6.2831*z0.y)), .5*(cos(6.2831*z1.x)+cos(6.2831*z1.y)), UO.y), UG); }
      sp+=(nT(q*.9+float(k)*13.)-.5)*.3*RGH; float th=(1.-2.*d)*1.12, aa=6.2831/(scr*S)*.9;
      dot_=smoothstep(th-aa,th+aa,sp)*step(.015,d); } }
    else { vec2 gq=floor(q/GR); float th=mix(h21(gq+float(k)*37.+FR*3.1),nT(q*.33+float(k)*9.+FR*5.3),.45);
      if(UG>0.){ float tu=mix(h21(floor(UC*UO.x)+float(k)*37.+FR*3.1), h21(floor(UC*UO.x*2.)+float(k)*37.+FR*3.1), UO.y); th=mix(th, mix(tu,nT(UC*UO.x*.33+float(k)*9.),.45), UG); }
      dot_=smoothstep(th-.08,th+.08,d); }
    return dot_*(1.-.12*smoothstep(.6,.9,BND[k])); }
  void main(){ vec2 uv=gl_FragCoord.xy/R; vec2 p=gl_FragCoord.xy/S; vec4 pp=paper(uv); vec3 col=pp.rgb;
    UG=0.; UC=vec2(0.); UO=vec2(1.,0.);
    if(HASAUX>.5 && UVSP>.5){ vec4 au=texture(AUXU,uv); float z=texture(AUXN,uv).w; UC=au.xy; UO=octv(au.xy, (SCR>0.?SCR:GR)*S*dscale(z)); UG=smoothstep(.55,.95,au.a); }
    vec2 u2=fbm2T(p*.0025+SEED); UNV=vec3(u2, 1.-u2.x);                 // drum coverage (very low frequency: shared, the misreg offset is negligible)
    vec2 b2=fbm2T(p*.08); BND=vec3(b2, nT(p*.3+5.));
    float ab=.85+.15*smoothstep(.25,.7,pp.a);
    col=inkOn(col,I0,layer(0,p,O0)*ab);
    if(NI>1) col=inkOn(col,I1,layer(1,p,O1)*ab);
    if(NI>2) col=inkOn(col,I2,layer(2,p,O2)*ab);
    o=fin(col,uv); }`,

  // LETTERPRESS: thresholded forms as type-high blocks: debossed paper, ink squeezed to the rims,
  // salty/kissed ink in the solids, faint squeeze halo outside the edge.
  letterpress: `uniform float THR, SQUEEZE, DEBOSS, MOTTLE, KISS, SCREEN; uniform vec3 INK; uniform vec2 LIGHT; uniform vec2 AR;
  void main(){ vec2 uv=gl_FragCoord.xy/R; vec2 p=gl_FragCoord.xy/S; vec4 pp=paper(uv);
    float ls=srcL(uv,.5); float aa=.03;
    float m=1.-smoothstep(THR-aa,THR+aa,ls);
    if(SCREEN_ON>.5){ vec2 q=mat2(.7071,.7071,-.7071,.7071)*p/SCREEN; float sp=.5*(cos(6.2831*q.x)+cos(6.2831*q.y));
      float lz=srcL(uv,log2(SCREEN*S*.5)); float th=(2.*lz-1.)*1.12; float w=6.2831/(SCREEN*S);
      m=smoothstep(th-w,th+w,sp)*step(.02,1.-lz); }
    float lb=texture(AN,uv).r; float mb=1.-smoothstep(THR-.22,THR+.22,lb);
    vec2 dx=vec2(AR.x,0.), dy=vec2(0.,AR.y);
    vec2 gr=vec2(texture(AN,uv+dx).r-texture(AN,uv-dx).r, texture(AN,uv+dy).r-texture(AN,uv-dy).r);
    float shade=dot(gr,normalize(LIGHT))*DEBOSS*3.*(SCREEN>0.?.35:1.);
    vec3 base=pp.rgb*(1.+shade)*(1.-.05*DEBOSS*mb);
    float interior=smoothstep(.55,.95,mb);
    float salt=smoothstep(.55,.8,fbmT(p*.06+SEED)*.55+pp.a*.5+nT(p*.7)*.25)*MOTTLE*interior*(SCREEN>0.?.25:1.);
    float kiss=smoothstep(.2,.6,pp.a+.3*nT(p*.9));
    float cov=m*(1.-salt*.6)*mix(1.,.72+.28*kiss,KISS);
    float rim=m*(1.-interior)*SQUEEZE;
    float halo=(1.-m)*smoothstep(.12,.45,mb)*(1.-smoothstep(.45,.7,mb))*SQUEEZE*.35;
    vec3 col=inkOn(base,INK,cov);
    if(OPQ<.5){ col*=mix(vec3(1.),tr(INK)*.8,rim*.55); col=inkOn(col,INK,halo); }
    o=fin(col,uv); }`,

  // INK BLEED: ink wicks along paper fibres from every dark edge; wet edges pool darker; soft feathering
  bleedMap: `uniform float RAD, FIBRE; uniform vec3 PB;       // half-res: how much ink reaches each point, and which ink
  float dk(vec3 c){ return clamp(1.-lum(c)/lum(PB),0.,1.); }
  void main(){ vec2 uv=gl_FragCoord.xy/R; vec2 p=gl_FragCoord.xy/S;
    float fa=fbmT(p*.012+SEED)*12.; float fib=fbmT(vec2(dot(p,vec2(cos(fa),sin(fa)))*.35,dot(p,vec2(-sin(fa),cos(fa)))*.04));
    vec3 bc=textureLod(SRC,uv,1.).rgb; float best=dk(bc), acc=0.;
    for(int i=0;i<8;i++){ float a=fa+float(i)*2.39996; float r=RAD*(.25+.75*h21(p*.37+float(i)))*(.4+1.2*fib*FIBRE+(1.-FIBRE)*.6);
      vec3 c=textureLod(SRC,uv+vec2(cos(a),sin(a))*r*S/R,1.5).rgb; float d=dk(c)*(1.-.5*r/max(RAD,1.));
      acc+=d; if(d>best){ best=d; bc=c; } }
    o=vec4(bc, acc/8.); }`,
  bleed: `uniform float AMT, WET, FIBRE; uniform vec3 PB;
  float dk(vec3 c){ return clamp(1.-lum(c)/lum(PB),0.,1.); }
  void main(){ vec2 uv=gl_FragCoord.xy/R; vec2 p=gl_FragCoord.xy/S; vec3 c0=texture(SRC,uv).rgb; float d0=dk(c0);
    vec4 m=texture(AN,uv); vec3 bc=m.rgb; float acc=m.a;
    float fa=fbmT(p*.012+SEED)*12.; float fib=fbmT(vec2(dot(p,vec2(cos(fa),sin(fa)))*.5,dot(p,vec2(-sin(fa),cos(fa)))*.05));
    float spread=smoothstep(.12,.55,acc+(fib-.5)*.45*FIBRE)*AMT;
    float wet=WET*smoothstep(.2,.5,acc)*(1.-smoothstep(.5,.85,acc))*(1.-d0);
    vec3 soft=textureLod(SRC,uv,1.5).rgb;
    vec3 col=mix(c0, soft, .35*AMT);
    col=mix(col, min(col,bc), spread*(1.-d0*.5));
    col*=1.-wet*.25;
    o=vec4(col,1.); }`,

  // TORN PAPER: current input as a sheet torn to a (rotated) rectangle, or to any MASK shape, laid over BELOW
  // (target / stock / flat colour / clear), with a white fibrous rim, stray fibres, and a soft contact shadow.
  // EDGES masks which rectangle sides are torn (l,t,r,b). Output keeps alpha (clear below -> a cut-out sheet layer).
  torn: `uniform vec4 RECT, EDGES; uniform float ROT, TEAR, RIM, SHADOW, BELOWMODE, MLOD; uniform vec3 RIMC, BELOWC; uniform vec2 SOFF, SHIFT, MTX;
  float sdb(vec2 q, vec2 hb){ vec2 d=abs(q)-hb; return length(max(d,0.))+min(max(d.x,d.y),0.); }
  float tornD(vec2 pt, float lodAdd){
    if(HASMASK>.5){   // mask shape: blurred mip as a pseudo distance (1080 px), edge warped by the tear noise
      vec2 wv=(vec2(fbmT(pt*.018+SEED),fbmT(pt*.018+SEED+5.))-.5)*TEAR*1.2+(vec2(nT(pt*.12+SEED),nT(pt*.12+SEED+3.))-.5)*TEAR*.3+(nT(pt*.6)-.5)*2.;
      vec2 q=pt+wv; vec2 muv=vec2(q.x, R.y/S-q.y)*S/R; float bw=exp2(MLOD+lodAdd)*MTX.x;
      return (.5-maskAt(muv, MLOD+lodAdd))*bw*1.4; }
    vec2 c=(RECT.xy+RECT.zw)*.5, hb=(RECT.zw-RECT.xy)*.5; float cr=cos(ROT), sr=sin(ROT);
    vec2 q=mat2(cr,sr,-sr,cr)*(pt-c); float d=sdb(q,hb);
    vec2 e=abs(q)-hb; float wx=step(e.y,e.x); float tornness=wx>.5?(q.x<0.?EDGES.x:EDGES.z):(q.y<0.?EDGES.y:EDGES.w);
    float j=(fbmT(pt*.018+SEED)-.5)*TEAR*1.6+(nT(pt*.12+SEED)-.5)*TEAR*.35+(nT(pt*.6)-.5)*2.;
    return d+j*tornness; }
  void main(){ vec2 uv=gl_FragCoord.xy/R; vec2 pt=vec2(gl_FragCoord.x, R.y-gl_FragCoord.y)/S;
    vec4 below=BELOWMODE<.5?vec4(BELOWC,1.):BELOWMODE<1.5?texture(BELOW,uv):vec4(0.);
    float d=tornD(pt,0.);
    float ds=tornD(pt-SOFF,1.5); float sh=SHADOW*(1.-smoothstep(-6.,22.,ds));
    vec4 col=over(vec4(0.,0.,0.,.55*sh), below);
    float aa=1./S;
    float rimw=RIM*(.35+.9*fbmT(pt*.05+SEED+3.));
    vec3 rimc=RIMC*(.94+.08*nT(pt*.8));
    float inside=1.-smoothstep(-aa,aa,d);
    float onrim=smoothstep(-rimw-aa,-rimw+aa,d);
    vec3 sheet=mix(texture(SRC,uv+vec2(-SHIFT.x,SHIFT.y)*S/R).rgb, rimc, onrim);   // SHIFT moves the printed image with the sheet
    col=over(vec4(sheet,inside), col);
    float fa=h21(floor(pt/3.)+SEED)*6.28; float hair=step(.93,nT(vec2(dot(pt,vec2(cos(fa),sin(fa)))*.9,dot(pt,vec2(-sin(fa),cos(fa)))*.08)))*(1.-smoothstep(0.,4.,d))*step(0.,d);
    col=over(vec4(rimc*.95,hair*.8), col);
    o=col; }`,

  // OVER: the input (straight alpha) over BELOW (target / stock / flat colour / clear), opacity OPA, optional mask
  over: `uniform float OPA, BELOWMODE; uniform vec3 BELOWC;
  void main(){ vec2 uv=gl_FragCoord.xy/R; vec4 a=texture(SRC,uv); a.a*=OPA;
    vec4 b=BELOWMODE<.5?vec4(BELOWC,1.):BELOWMODE<1.5?texture(BELOW,uv):vec4(0.);
    if(HASMASK>.5) a.a*=maskAt(uv,0.);
    o=over(a,b); }`,
};

// ------------------------------------------------------------------ defaults per step
const DEF = {
  engrave: { pitch: 7, angle: 0.5, bend: 5, crosshatch: 1, stipple: 1, wash: 0, plate: 0.6, mark: 0, contour: 0.8, ink: 'black' },
  halftone: { cell: 11, gain: 0.12, rough: 1, angles: [15, 75, 0, 45], misreg: 2.5, kOnly: 0, inks: ['cyan', 'magenta', 'yellow', 'key'] },
  woodcut: { t1: 0.3, t2: 0.72, pitch: 11, jag: 1, grain: 1, chisel: 1, lino: 0, two: 0, angle: 0.3, contour: 1, ink: 'carbon', ink2: 'acp', off2: [3, -2] },
  riso: { inks: ['risoRed', 'federal'], screen: 0, angles: [15, 45, 75], grain: 1.6, amount: 1, uneven: 1, contrast: 1.1, misreg: 5, soft: 0, rough: 1 },
  letterpress: { thr: 0.45, screen: 0, squeeze: 1, deboss: 1, mottle: 0.5, kiss: 0.6, ink: 'acp', light: [-0.6, 0.8] },
  bleed: { radius: 7, amount: 0.8, wet: 1, fibre: 1 },
  torn: { rect: [60, 300, 1020, 1300], rot: 0, tear: 14, rim: 7, shadow: 0.6, edges: [1, 1, 1, 1], below: 'paper', rimColor: '#f7f1e3', shadowOffset: [8, 14] },
  over: { below: 'paper', opacity: 1 },
};
const FLAGS = { prepK: ['KOFF', 'NEG'], engrave: ['WASH', 'MARK', 'CONT'], halftone: ['KONLY'], woodcut: ['TWO', 'LINO', 'CONT'], riso: ['SCR'], letterpress: ['SCREEN'] };   // -> NAME_ON defines
const PRESSES = new Set(['engrave', 'halftone', 'woodcut', 'riso', 'letterpress']);
// extension hook (LOOKS studio c1, lib/fx/looks.js): register an extra fragment pass that shares HEAD (paper, inks, noise,
// hatch, fin) and runs through the same _pass(name, target, uniforms, textures). Additive: existing passes are untouched.
export function registerPrintPass(name, fs) { if (FS[name] && !String(name).startsWith('lk_')) throw new Error('print.js: pass exists: ' + name); FS[name] = fs; }
const NEEDS_AN = new Set(['engrave', 'woodcut', 'letterpress']);
export const PREP = { levels: 'auto', lo: 0.01, hi: 0.99, mid: 0.5, simplify: 10, boost: 0.5, subject: null, depth: null, clear: 0.6, contrast: 0.6, negative: false, subjMax: 1 };
const SUBJM = { aux: 1, depth: 2 };

// 3x3 invert (for the riso separation)
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g, det = a * A + b * B + c * Cc;
  if (Math.abs(det) < 1e-9) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, Cc / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

export class Print {
  // width/height: output res. analysis: structure-tensor res (fraction). prepScale: tone-prep res (fraction).
  // ship: true (or { boil }) applies SHIP to every run.
  constructor({ width = W, height = H, analysis = 0.25, prepScale = 0.5, ship = false } = {}) {
    this.w = width; this.h = height; this.S = width / 1080; this.ship = ship;
    this.cv = document.createElement('canvas'); this.cv.width = width; this.cv.height = height;
    const gl = this.gl = this.cv.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('print.js needs WebGL2');
    this.cbf = !!gl.getExtension('EXT_color_buffer_float'); this.fLin = !!gl.getExtension('OES_texture_float_linear');
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const vb = this.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.progs = {}; this.targets = {}; this.papers = {}; this.ver = 0;
    this.aw = Math.round(width * analysis); this.ah = Math.round(height * analysis);
    this.bw = Math.round(width * analysis / 4); this.bh = Math.round(height * analysis / 4);
    this.pw = Math.round(width * prepScale); this.ph = Math.round(height * prepScale);
    this.srcTex = this._tex(width, height, true);
    for (const [k, w, h] of [['an0', this.aw, this.ah], ['an1', this.aw, this.ah], ['an', this.aw, this.ah], ['ab0', this.bw, this.bh], ['ab', this.bw, this.bh], ['_tiny', 96, 170]])
      this.targets[k] = this._target(w, h);
    const hf = this.cbf ? 'f16' : false;
    this.targets._pA = this._target(this.pw, this.ph, true, hf);
    this.targets._prep = this._target(this.pw, this.ph, true);
    this.stats = {}; this.hasAux = 0; this.lv = [0, 1, 1];
    this.dummy = this._tex(1, 1, false);
    this.nz = this._target(512, 512);
    gl.bindTexture(gl.TEXTURE_2D, this.nz.tex);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.REPEAT);
    this._pass('noise', this.nz);
  }
  _tex(w, h, mip, fmt = false) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    const ifmt = fmt === 'f16' ? gl.RGBA16F : fmt === 'f32' ? gl.RGBA32F : gl.RGBA8;
    // render targets get immutable storage for the whole mip chain, so they are always complete (lod 0 is valid
    // even when the chain is stale); mips are regenerated lazily only for passes that read them with lod > 0
    if (mip === 'storage') gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, ifmt, w, h);
    else if (fmt) gl.texStorage2D(gl.TEXTURE_2D, 1, ifmt, w, h);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const lin = fmt !== 'f32' || this.fLin;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : lin ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, lin ? gl.LINEAR : gl.NEAREST);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    t.w = w; t.h = h; t.mip = mip; t.ver = 0;
    return t;
  }
  _target(w, h, mip = false, fmt = false) {
    const gl = this.gl, tex = this._tex(w, h, mip ? 'storage' : false, fmt), fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    tex.dirty = true; return { tex, fb, w, h };
  }
  target(name) { return this.targets[name] || (this.targets[name] = this._target(this.w, this.h, true)); }
  _prog(name, D = {}) {
    const defs = Object.entries(D).map(([k, v]) => `#define ${k} ${k === 'NI' ? v : (+v).toFixed(1)}\n`).join('');
    const pk = name + '|' + defs;
    if (this.progs[pk]) return this.progs[pk];
    const gl = this.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`print.js ${name}: ${gl.getShaderInfoLog(s)}`); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, `#version 300 es\nin vec2 a; void main(){ gl_Position=vec4(a,0,1); }`));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, HEAD.replace('\n', '\n' + defs) + FS[name]));
    gl.bindAttribLocation(pr, 0, 'a');
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(`print.js ${name}: ${gl.getProgramInfoLog(pr)}`);
    const u = {}, n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(pr, i); u[a.name] = { loc: gl.getUniformLocation(pr, a.name), type: a.type }; }
    return (this.progs[pk] = { pr, u });
  }
  // run one fragment pass into target tg (null = canvas) with uniforms U and texture bindings
  _pass(name, tg, U = {}, tex = {}) {
    const gl = this.gl, D = { HASAUX: 0, UVSP: 0, AOUT: 0, OPQ: 0, FOIL: 0, HASMASK: 0, OUTM: 0, ONTO: 0, TENS: 1 };
    for (const k in D) if (k in U) D[k] = U[k];
    for (const k of FLAGS[name] || []) D[k + '_ON'] = U[k] > 0 ? 1 : 0;
    if (name === 'riso') D.NI = U.NI;
    if (name === 'lumTiny' || name === 'prepK') D.SUBJM = U.SUBJM || 0;
    const P = this._prog(name, D);
    if (this.profile) { this._sync(); this._pt = performance.now(); }
    gl.useProgram(P.pr);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tg ? tg.fb : null);
    const w = tg ? tg.w : this.w, h = tg ? tg.h : this.h;
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vb);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const all = { R: [w, h], S: this.S * w / this.w, T: this.t || 0, SEED: this.seed || 0, FR: this.fr || 0, LV: this.lv || [0, 1, 1], TENS: 1,
      HASAUX: 0, DRANGE: this.drange || [1, 100], DPITCH: [1, 0.5], ...U };
    let unit = 0;
    for (const k of ['SRC', 'AN', 'AB', 'PAPER', 'BELOW', 'NZ', 'AUXN', 'AUXU', 'MASK', 'SUBJ', 'ORIG']) {
      if (!P.u[k]) continue;
      const t = (k === 'NZ' ? this.nz.tex : k === 'AUXN' ? (tex.AUXN || this.auxN) : k === 'AUXU' ? (tex.AUXU || this.auxU) : tex[k]) || this.dummy;
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      // an incomplete / stale mip chain samples black or old data: regenerate for passes that read with lod > 0
      if (t.mip && t.dirty && ((name !== 'copy' && name !== 'torn' && name !== 'over') || k === 'MASK')) { gl.generateMipmap(gl.TEXTURE_2D); t.dirty = false; this.stats.mips = (this.stats.mips || 0) + 1; }
      gl.uniform1i(P.u[k].loc, unit++);
    }
    for (const [k, v] of Object.entries(all)) {
      const e = P.u[k]; if (!e) continue;
      const L = e.loc, T = e.type;
      if (T === gl.FLOAT) gl.uniform1f(L, v);
      else if (T === gl.INT || T === gl.BOOL) gl.uniform1i(L, v);
      else if (T === gl.FLOAT_VEC2) gl.uniform2fv(L, v);
      else if (T === gl.FLOAT_VEC3) gl.uniform3fv(L, v);
      else if (T === gl.FLOAT_VEC4) gl.uniform4fv(L, v);
      else if (T === gl.FLOAT_MAT3) gl.uniformMatrix3fv(L, false, v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (tg) { tg.tex.dirty = true; tg.tex.ver = ++this.ver; }
    if (this.profile) { this._sync();
      const now = performance.now(); (this.prof ||= {})[name] = (this.prof[name] || 0) + now - (this._pt || now); this._pt = now; }
  }
  _sync() { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, this.nz.fb); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this._px || (this._px = new Uint8Array(4))); }
  // procedural paper stock, generated once per kind (or pass a custom {base, fib, ...} object). preload() bakes
  // the stocks a piece uses during setup, so no frame pays for a first use.
  paper(kind = 'cream') {
    const key = typeof kind === 'string' ? kind : JSON.stringify(kind);
    if (this.papers[key]) return this.papers[key];
    const p = typeof kind === 'string' ? PAPERS[kind] : { ...PAPERS.cream, ...kind };
    const tg = this._target(this.w, this.h, false);
    this._pass('paper', tg, { BASE: hex(p.base), FIB: p.fib, LAID: p.laid, FLECK: p.fleck, MOTTLE: p.mottle, TOOTH: p.tooth });
    tg.base = hex(p.base);
    return (this.papers[key] = tg);
  }
  preload(kinds = []) { const t0 = performance.now(); for (const k of kinds) this.paper(k); this._sync(); return performance.now() - t0; }
  _upload(tex, source, flip = true) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, source.width || source.videoWidth, source.height || source.videoHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (tex.mip) gl.generateMipmap(gl.TEXTURE_2D);
    tex.w = source.width || source.videoWidth; tex.h = source.height || source.videoHeight; tex.ver = ++this.ver;
  }
  // upload a source (canvas / img / video / named target); levels = [black, white, gamma] on luminance, or 'auto'
  src(source, { levels = [0, 1, 1] } = {}) {
    const t0 = performance.now();
    this.lvOpt = levels; this.lv = Array.isArray(levels) ? levels : [0, 1, 1];
    if (typeof source === 'string') this.cur = this.targets[source].tex;
    else { this._upload(this.srcTex, source); this.cur = this.srcTex; }
    this.stats.upload = performance.now() - t0;
    return this;
  }
  // G-buffer for object-anchored patterns: { nd: Float32Array rgba (view normal xyz, linear depth; 0 = empty),
  //   uvm: Float32Array rgba (u, v, subject 0..1, coverage), width, height, range: [near, far] } from gbuffer.js,
  // or 8-bit canvases { normal (rgb = n*.5+.5), depth (r, 0 near .. 1 far / empty), uv (rg), mask (r) }. null clears.
  setAux(aux) {
    const gl = this.gl;
    if (!aux) { this.hasAux = 0; return this; }
    if (aux.nd) {
      const { width: w, height: h } = aux, fmt = this.fLin ? 'f32' : 'f16';
      if (!this.auxN || this.auxN.w !== w || this.auxN.h !== h) { this.auxN = this._tex(w, h, false, fmt); this.auxU = this._tex(w, h, false, fmt); }
      for (const [t, d] of [[this.auxN, aux.nd], [this.auxU, aux.uvm]]) {
        gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, d); t.ver = ++this.ver; }
      this.drange = aux.range || [1, 100];
    } else {
      const w = aux.normal.width, h = aux.normal.height;
      if (!this.auxTg || this.auxTg[0].w !== w) this.auxTg = [this._target(w, h, false, this.cbf ? 'f16' : false), this._target(w, h, false, this.cbf ? 'f16' : false)];
      const up = {}; for (const k of ['normal', 'depth', 'uv', 'mask']) { if (!aux[k]) continue; up[k] = (this._auxUp ||= {})[k] || (this._auxUp[k] = this._tex(w, h, false)); this._upload(up[k], aux[k]); }
      const tx = { SRC: up.normal, AN: up.depth, AB: up.uv, BELOW: up.mask };
      this._pass('auxPack', this.auxTg[0], { MODE: 0 }, tx); this._pass('auxPack', this.auxTg[1], { MODE: 1 }, tx);
      this.auxN = this.auxTg[0].tex; this.auxU = this.auxTg[1].tex; this.drange = [0, 1];
    }
    this.hasAux = 1;
    return this;
  }
  // named mask upload (canvas / image), kept until replaced: then mask: 'name' in any step
  mask(name, source) {
    const t = this.targets[name] || (this.targets[name] = { tex: this._tex(source.width, source.height, true), w: source.width, h: source.height });
    this._upload(t.tex, source); t.tex.alpha = true; return this;
  }
  _maskTex(m) {
    if (!m) return null;
    let src = m, ch = null, inv = 0;
    if (typeof m === 'object' && m.src !== undefined && !(m instanceof HTMLElement)) { src = m.src; ch = m.channel; inv = m.invert ? 1 : 0; }
    let tex;
    if (typeof src === 'string') tex = this.targets[src].tex;
    else { tex = this._maskUp || (this._maskUp = this._tex(1, 1, true)); this._upload(tex, src); }
    ch = ch || (typeof src === 'string' ? (tex.alpha ? 'a' : 'l') : 'la');
    return { tex, M: [{ a: 0, l: 1, la: 2 }[ch], inv, 0], w: tex.w };
  }
  // auto levels: tiny luminance map, histogram weighted toward the subject, percentiles, gamma puts the median on `mid`
  _autoLevels(tex, pp, subjU, subjTex) {
    const gl = this.gl, tg = this.targets._tiny, buf = this._tinyBuf || (this._tinyBuf = new Uint8Array(tg.w * tg.h * 4));
    this.lv = [0, 1, 1];
    this._pass('lumTiny', tg, { LOD: Math.max(0, Math.log2(tex.w / tg.w)), ...subjU }, { SRC: tex, SUBJ: subjTex });
    gl.bindFramebuffer(gl.FRAMEBUFFER, tg.fb); gl.readPixels(0, 0, tg.w, tg.h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const hist = new Float64Array(256); let tot = 0;
    for (let i = 0; i < buf.length; i += 4) { const w = 0.15 + 0.85 * buf[i + 1] / 255; hist[buf[i]] += w; tot += w; }
    const pct = q => { let a = 0; for (let i = 0; i < 256; i++) { a += hist[i]; if (a >= q * tot) return i / 255; } return 1; };
    let lo = pct(pp.lo), hi = pct(pp.hi); if (hi - lo < 0.08) { const m = (hi + lo) / 2; lo = Math.max(0, m - 0.04); hi = Math.min(1, m + 0.04); }
    const med = Math.min(0.95, Math.max(0.05, (pct(0.5) - lo) / (hi - lo)));
    const gam = Math.min(2.5, Math.max(0.35, Math.log(pp.mid) / Math.log(med)));
    return (this.autoLv = [lo, hi, +gam.toFixed(3)]);
  }
  // tone prep for the current source -> the texture the presses read (cached per source version + options)
  _prep(prep) {
    const levOpt = this.lvOpt;
    if (!prep && levOpt !== 'auto') return { tex: this.cur, lv: this.lv, lodb: 0 };
    const pp = { ...PREP, ...(prep === true || !prep ? {} : prep) };
    if (!prep) Object.assign(pp, { simplify: 0, boost: 0, subject: null });
    else if (Array.isArray(levOpt) && (levOpt[0] || levOpt[1] !== 1 || levOpt[2] !== 1) && prep.levels === undefined) pp.levels = levOpt;
    const subj = pp.subject, subjMask = subj && typeof subj === 'object' ? this._maskTex(subj) : null;
    const subjU = { SUBJM: subjMask ? 3 : SUBJM[subj] || 0, SUBJD: pp.depth || [this.drange ? this.drange[0] : 0, this.drange ? (this.drange[0] + this.drange[1]) / 2 : 1] };
    if (!this.hasAux && subjU.SUBJM < 3) subjU.SUBJM = 0;
    const key = [this.cur.ver, this.hasAux && this.auxN ? this.auxN.ver : 0, JSON.stringify(pp), JSON.stringify(levOpt)].join('|');
    if (this.prepKey === key && !subjMask) return this.prepRes;
    const t0 = performance.now(), subjTex = subjMask && subjMask.tex;
    const lv = pp.levels === 'auto' ? this._autoLevels(this.cur, pp, subjU, subjTex) : pp.levels;
    let res;
    if (!pp.simplify && !pp.boost && !subjU.SUBJM && !pp.negative) res = { tex: this.cur, lv, lodb: 0 };
    else {
      const T = this.targets, cur = this.cur;
      this.lv = lv;
      this._pass('prepDown', T._pA, { LOD: Math.max(0, Math.log2(cur.w / this.pw)) }, { SRC: cur });
      const N = Math.max(0, pp.simplify * this.S * (this.pw / this.w) / 4);     // quadrant half-size in prep texels
      this._pass('prepK', T._prep, { KOFF: N, KLOD: Math.log2(Math.max(1, 2 * N + 1)), TX: [1 / this.pw, 1 / this.ph], BOOST: pp.boost, CLEAR: subjU.SUBJM ? pp.clear : 0, SUBK: pp.contrast, NEG: pp.negative ? 1 : 0, SUBJMAX: subjU.SUBJM ? pp.subjMax : 1,
        LODBIG: Math.max(0, Math.log2(40 * cur.w / 1080)), ...subjU }, { SRC: T._pA.tex, ORIG: cur, SUBJ: subjTex });
      res = { tex: T._prep.tex, lv: [0, 1, 1], lodb: Math.log2(this.pw / this.w) };
    }
    this.stats.prep = performance.now() - t0; this.stats.levels = lv;
    this.prepKey = key; this.prepRes = res;
    return res;
  }
  _analyze(tex, tensor = true) {
    const key = [tex.ver, this.lv.join(','), this.lodb, tensor].join('|');
    if (this.anFor === tex && this.anKey === key) return;
    this.anKey = key; this.anFor = tex;
    const T = this.targets;
    this._pass('analyze', T.an0, { LODB: this.lodb || 0 }, { SRC: tex });
    this._pass('blur', T.an1, { DIR: [1 / this.aw, 0] }, { SRC: T.an0.tex });
    this._pass('blur', T.an, { DIR: [0, 1 / this.ah] }, { SRC: T.an1.tex });
    if (!tensor) return;                                       // with a G-buffer the directions come from the objects
    this._pass('copy', T.ab0, {}, { SRC: T.an.tex });
    this._pass('blur', T.ab, { DIR: [1.5 / this.bw, 0] }, { SRC: T.ab0.tex });
    this._pass('blur', T.ab0, { DIR: [0, 1.5 / this.bh] }, { SRC: T.ab.tex });
    this._pass('blur', T.ab, { DIR: [1.5 / this.bw, 0] }, { SRC: T.ab0.tex });
    this._pass('blur', T.ab0, { DIR: [0, 1.5 / this.bh] }, { SRC: T.ab.tex });
  }
  _uniforms(fx, o, paperTg, pb) {
    const fr = this.fr || 0, jit = (k, amt) => { const r = Math.sin((fr + 1) * 12.9898 + k * 78.233) * 43758.5453; return (r - Math.floor(r) - 0.5) * 2 * amt; };
    switch (fx) {
      case 'engrave': return { PITCH: o.pitch, ANG: o.angle, BENDK: o.bend, XH: o.crosshatch, STIP: o.stipple, WASH: o.wash, PLATE: o.plate, MARK: o.mark, CONT: o.contour, INK: hex(o.ink) };
      case 'halftone': {
        const r = o.misreg, d = a => a * Math.PI / 180;
        return { CELL: o.cell, GAIN: o.gain, ROUGH: o.rough, KONLY: o.kOnly, ANGS: o.angles.map(d),
          M0: o.m0 || [r * 0.9, -r * 0.4], M1: o.m1 || [-r * 0.7, r * 0.6], M2: o.m2 || [r * 0.3, r], M3: o.m3 || [0, 0],
          IC: hex(o.inks[0]), IM: hex(o.inks[1]), IY: hex(o.inks[2]), IK: hex(o.inks[3]) };
      }
      case 'woodcut': return { T1: o.t1, T2: o.t2, PITCH: o.pitch, JAG: o.jag, GRAIN: o.grain, CHISEL: o.chisel, LINO: o.lino, TWO: o.two, ANG: o.angle, CONT: o.contour, INK: hex(o.ink), INK2: hex(o.ink2), OFF2: o.off2 };
      case 'riso': {
        const inks = o.inks.map(hex), n = inks.length;
        const cols = inks.map(c => c.map((x, i) => Math.log(Math.max(x, 0.015) / pb[i])));
        let sep;
        if (n === 3) sep = inv3([cols[0][0], cols[1][0], cols[2][0], cols[0][1], cols[1][1], cols[2][1], cols[0][2], cols[1][2], cols[2][2]]);
        if (!sep) {       // least squares for 1-2 inks (pinv), padded
          const A = cols.slice(0, Math.min(n, 2)); const k = A.length;
          const G = [[0, 0], [0, 0]]; for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) G[a][b] = A[a].reduce((s, x, i) => s + x * A[b][i], 0);
          let Gi; if (k === 1) Gi = [[1 / G[0][0], 0], [0, 0]]; else { const dt = G[0][0] * G[1][1] - G[0][1] * G[1][0]; Gi = [[G[1][1] / dt, -G[0][1] / dt], [-G[1][0] / dt, G[0][0] / dt]]; }
          const rows = [0, 1].map(a => [0, 1, 2].map(i => (k > 0 ? Gi[a][0] * (A[0] ? A[0][i] : 0) : 0) + (k > 1 ? Gi[a][1] * A[1][i] : 0)));
          sep = [rows[0][0], rows[0][1], rows[0][2], rows[1][0], rows[1][1], rows[1][2], 0, 0, 0];
        }
        // sep is row-major (dens = sep * ld); GLSL mat3 is column-major -> transpose
        const cm = [sep[0], sep[3], sep[6], sep[1], sep[4], sep[7], sep[2], sep[5], sep[8]];
        const r = o.misreg;
        return { SEP: cm, I0: inks[0], I1: inks[1] || [1, 1, 1], I2: inks[2] || [1, 1, 1], PB: pb, NI: n,
          O0: o.o0 || [jit(1, r * 0.3), jit(2, r * 0.3)], O1: o.o1 || [r + jit(3, r * 0.4), -r * 0.6 + jit(4, r * 0.4)], O2: o.o2 || [-r * 0.7 + jit(5, r * 0.3), r * 0.9 + jit(6, r * 0.3)],
          GR: o.grain, AMT: o.amount, UNEVEN: o.uneven, CONTR: o.contrast, SANG: o.angles.map(x => x * Math.PI / 180),
          // STUDIO CIV ASSETS c1: per-ink screens (0 = flat ink), a sharp source by default (soft: 1.2 = the old mip read), rough (dot edge noise)
          SCR: o.screens ? Math.max(...o.screens) : o.screen, SCRV: [0, 1, 2].map(i => o.screens ? (o.screens[i] ?? 0) : o.screen), SOFT: o.soft, RGH: o.rough };
      }
      case 'letterpress': return { SCREEN: o.screen, THR: o.thr, SQUEEZE: o.squeeze, DEBOSS: o.deboss, MOTTLE: o.mottle, KISS: o.kiss, INK: hex(o.ink), LIGHT: o.light, AR: [1 / this.aw, 1 / this.ah] };
      case 'bleed': return { AMT: o.amount, WET: o.wet, FIBRE: o.fibre, PB: paperTg.base };
      case 'torn': case 'over': {
        const b = o.below, mode = b === 'clear' || b === null ? 2 : typeof b === 'string' && b[0] !== '#' ? 1 : 0;
        const U = { BELOWMODE: mode, BELOWC: typeof b === 'string' && b[0] === '#' ? hex(b) : [0, 0, 0], OPA: o.opacity ?? 1 };
        if (fx === 'over') return U;
        return { ...U, SHIFT: o.shift || [0, 0], RECT: o.rect, EDGES: o.edges, ROT: o.rot, TEAR: o.tear, RIM: o.rim, SHADOW: o.shadow, RIMC: hex(o.rimColor), SOFF: o.shadowOffset };
      }
    }
    return {};
  }
  // run a chain of steps on the current source. steps: [[name, opts], ...] or [{fx, ...opts}]
  // run opts: { paper, t, seed, boil (fps; 0 = frozen), out (target name to keep), aux (G-buffer, see setAux),
  //             prep (true | { levels: 'auto' | [b,w,g], lo, hi, mid, simplify (px), boost, subject: 'aux'|'depth'|canvas,
  //                   depth: [near, far], clear, contrast, negative, subjMax (clamp inside the subject, 0.55 for crowds) }), ship }   (src/render levels: 'auto' = auto levels only)
  // step opts (any press): alpha: 'ink', opaque, foil, mask (canvas | target | {src, channel: 'a'|'l'|'la', invert}),
  //   outside ('paper' | 'below' | 'src' | 'clear'), space: 'uv', depthPitch: [near, far], from: 'src'|'prev'|target, onto, levels
  run(steps, opts = {}) {
    let { paper = 'cream', t = 0, seed = 1, boil = 6, out = 'main', aux, prep = null, ship = this.ship } = opts;
    const t0 = performance.now();
    if (aux !== undefined) this.setAux(aux);
    if (ship) boil = Math.min(boil, ship.boil ?? SHIP.boil);
    this.t = t; this.seed = seed; this.fr = boil ? Math.floor(t * boil) : 0;
    const scratch = [this.target('_a'), this.target('_b')];
    const raw = this.cur, lvRun = this.lv; let prev = raw, srcP = null;
    steps.forEach((st, i) => {
      const [fx, o0] = Array.isArray(st) ? st : [st.fx, st];
      const o = { ...DEF[fx], ...o0 };
      if (ship && SHIP.min[fx]) for (const [k, v] of Object.entries(SHIP.min[fx])) if (o[k] > 0 || k !== 'screen') o[k] = Math.max(o[k] || 0, v);
      if (ship && fx === 'riso' && o.screens) o.screens = o.screens.map(v => v > 0 ? Math.max(v, SHIP.min.riso.screen) : 0);
      const ptg = this.paper(o.paper || paper);
      const last = i === steps.length - 1;
      const tg = last ? (out === null ? null : this.target(out)) : scratch[i % 2];     // out: null = straight to the canvas (saves the copy pass)
      const from = o.from || (o.onto ? 'src' : 'prev');
      let input = from === 'src' ? raw : from === 'prev' ? prev : this.targets[from].tex, lodb = 0, lv = [0, 1, 1];
      if (PRESSES.has(fx) && input === raw) { this.lv = lvRun; srcP ||= this._prep(prep); input = srcP.tex; lodb = srcP.lodb; lv = srcP.lv; }
      if (tg && tg.tex === input) throw new Error('print.js: step reads its own output');
      // levels: step option > run/src levels for the source > identity for later steps and composites
      this.lv = (fx === 'bleed' || fx === 'torn' || fx === 'over') ? [0, 1, 1] : o.levels || lv;
      this.lodb = lodb;
      const aux_ = this.hasAux && PRESSES.has(fx) && o.aux !== false;
      if (NEEDS_AN.has(fx)) this._analyze(input, !aux_);
      let below = null, onto = 0;
      if (o.onto) { below = this.targets[o.onto].tex; onto = 1; if (this.targets[o.onto] === tg) throw new Error('onto == out'); }
      if (fx === 'torn' || fx === 'over') {
        if (o.below === 'paper') below = ptg.tex;
        else if (typeof o.below === 'string' && o.below[0] !== '#' && o.below !== 'clear') { const b = this.targets[o.below]; if (b === tg) throw new Error(fx + ': below == out'); below = b.tex; }
      }
      let an = this.targets.an.tex;
      if (fx === 'bleed') {                                   // spread map at half res, then a cheap full-res composite
        const bm = this.targets._bleed || (this.targets._bleed = this._target(this.w >> 1, this.h >> 1));
        this._pass('bleedMap', bm, { RAD: o.radius, FIBRE: o.fibre, PB: ptg.base }, { SRC: input });
        an = bm.tex;
      }
      const alpha = o.alpha === 'ink' ? 1 : 0, opq = o.opaque || o.foil ? 1 : 0;
      const pb = alpha ? [1, 1, 1] : ptg.base;
      const mk = this._maskTex(o.mask);
      const outside = o.outside || (alpha ? 'clear' : o.onto ? 'below' : 'paper');
      const U = { ...this._uniforms(fx, o, ptg, pb), ONTO: onto, PBASE: pb, LODB: lodb, TENS: aux_ ? 0 : 1, AOUT: alpha, OPQ: opq, FOIL: o.foil ? 1 : 0,
        UVSP: o.space === 'uv' ? 1 : 0, DPITCH: o.depthPitch || [1, 0.5], HASAUX: aux_ ? 1 : 0,
        HASMASK: mk ? 1 : 0, MASKM: mk ? mk.M : [0, 0, 0], OUTM: { paper: 0, below: 1, src: 2, clear: 3 }[outside] ?? 0 };
      if (fx === 'torn' && mk) { const bwpx = Math.max(o.rim * 2.2, 10); U.MLOD = Math.max(0, Math.log2(bwpx * this.S * mk.w / this.w)); U.MTX = [this.w / mk.w / this.S, 0]; }
      this._pass(fx, tg, U, { SRC: input, AN: an, AB: this.targets.ab0.tex, PAPER: ptg.tex, BELOW: below, MASK: mk && mk.tex, ORIG: raw });
      if (tg) { tg.tex.alpha = !!(alpha || ((fx === 'torn' || fx === 'over') && o.below === 'clear')); prev = tg.tex; }
    });
    this.lv = lvRun; this.lodb = 0;
    this.last = out === null ? null : this.target(out);
    this.stats.run = performance.now() - t0;
    return this.last;
  }
  // blit a target (default: last result) onto a 2D context (straight alpha composites; vignette 0..1 darkens the corners)
  draw(ctx, target = this.last, { alpha = 1, x = 0, y = 0, w = W, h = H, vignette = 0 } = {}) {
    const t0 = performance.now();
    if (typeof target === 'string') target = this.targets[target];
    if (target) this._pass('copy', null, { VIG: vignette }, { SRC: target.tex });   // null: the canvas already holds the result (run out: null)
    ctx.save(); ctx.globalAlpha *= alpha; ctx.drawImage(this.cv, x, y, w, h); ctx.restore();
    this.stats.draw = performance.now() - t0;
  }
  render(ctx, source, steps, opts = {}) { this.src(source, opts); const r = this.run(steps, opts); if (ctx) this.draw(ctx, r, opts.draw); return r; }
}
