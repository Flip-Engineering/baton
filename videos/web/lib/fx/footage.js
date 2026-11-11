// FOOTAGE: compositing engine for the client's red steppe footage (511 frames, 1080x1920, one channel).
// WebGL2 on SwiftShader. Stores:
//   - hi-res frames: an LRU of 4 R8+mip textures. fx.frame(f) takes a FLOAT frame and cross-fades floor/ceil,
//     so slow ride rates (t*6) move smoothly instead of stepping.
//   - the time VOLUME: every frame as one layer of a 360x640 R8 array, read from the baked cache
//     out/.footage/ (scripts/bake_footage.py, run automatically by render.mjs) in one texSubImage3D.
//   - masks: an LRU of named W x H R8 masks (type, sigils); effects pick one with `mask: key`.
//   - TARGETS: named render-to-texture outputs. Any effect takes `out: 'name'` and renders there instead
//     of fx.canvas; `src: 'name'` / `inside: 'name'` read a target back, fx.comp() layers targets with
//     blend modes, transforms and motion blur, fx.show(name) puts one on fx.canvas.
//
//   const fx = await Footage.load();                          // ~1-2 s from the baked cache
//   const f = fx.ride(t, { rate: 8 }); await fx.frame(f);     // float frame, cross-faded
//   fx.crowd({ ...fx.look('gold-horde'), f0: t * 30, bg: false, out: 'crowd', res: 0.5 });
//   fx.plain({ ...fx.look('hero-sun', { sky: { sun: { x: 0.5, y: 0.36 } } }), ...fx.follow(f), cut: 'rider', out: 'hero' });
//   fx.comp([{ src: 'hero', blend: 'copy' }, { src: 'crowd' }, { src: 'hero' }]);
//   fx.embers({ t }); ctx.drawImage(fx.canvas, 0, 0);
//
// Effects: plain, slit, echo, ink, crowd, type, parallax (+ comp, embers, trans, show). All share the LOOK
// params (grade, style, gain, bias, gamma, levels, glow, clarity, sc, sky, rim, zoom, cx, cy, rot, res) and the
// named, brand-locked presets in LOOKS (fx.look(name, overrides)).
import { W, H, clamp, lerp } from '../kit.js';

// ---------------------------------------------------------------- grades: 5-stop luma -> colour ramps
// BRAND grades stay inside ACP red #C91F37/#BD1818, cream #F4E6D0 and black (plus darkened/warmed mixes of
// them). LAB grades step off-brand and are kept for experiments only; no LOOK uses them.
export const GRADE = {
  acp:      ['#000000', '#300407', '#8e0f1c', '#c91f37', '#f4e6d0'],
  blood:    ['#000000', '#2a0204', '#86101a', '#d91d30', '#ffd9c8'],
  infrared: ['#050001', '#240006', '#5c000f', '#c91f37', '#ffe6dc'],
  cream:    ['#0b0303', '#3c1410', '#9c6c58', '#e6d2b6', '#f4e6d0'],
  gold:     ['#040100', '#3a0a06', '#9a2a12', '#e0a868', '#f4e6d0'],
  poster:   ['#0b0303', '#0b0303', '#bd1818', '#c91f37', '#f4e6d0'],
  bone:     ['#0a0606', '#2b1d1a', '#6e5a50', '#cbb8a2', '#f4e6d0'],
  negative: ['#f4e6d0', '#e6c4a6', '#c91f37', '#4a060e', '#070102'],
  // lab-only (off-brand):
  steel:    ['#010205', '#141d29', '#4e5d6c', '#b9c3ca', '#f6f2ea'],
  thermal:  ['#00000a', '#28006e', '#9600a0', '#e6341e', '#ffe89a'],
};
export const LAB_ONLY = new Set(['steel', 'thermal']);
const STYLE = { grade: 0, poster: 1, engrave: 2, halftone: 3 };
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const palArr = g => new Float32Array((Array.isArray(g) ? g : GRADE[g] || GRADE.acp).flatMap(hex));
// brand check: every stop is near-neutral, very dark, or a warm hue in the red..amber range (340..45 deg)
export function brandSafe(g) {
  return (Array.isArray(g) ? g : GRADE[g] || []).every(c => {
    const [r, gg, b] = hex(c), mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), s = mx ? (mx - mn) / mx : 0;
    if (s < 0.15 || mx < 0.12) return true;
    let h = mx === r ? ((gg - b) / (mx - mn)) % 6 : mx === gg ? (b - r) / (mx - mn) + 2 : (r - gg) / (mx - mn) + 4;
    h = (h * 60 + 360) % 360; return h >= 340 || h <= 45;
  });
}

// ---------------------------------------------------------------- LOOKS: reviewed presets, brand-locked
// Spread into any effect call: fx.ink({ ...fx.look('woodcut'), ...fx.follow(f) }). Overrides merge (sky and sun deep).
const SKY_FIELD = { mode: 'field', pal: ['#0b0203', '#6a0a14', '#c91f37'], cloud: 1.1, hzGlow: 0.5, glowColor: '#f4e6d0' };
export const LOOKS = {
  // 19th-c. wood-engraving plate: cream paper, black line, the sky engraved (not blank paper)
  woodcut: { style: 'engrave', grade: 'cream', ink: '#0b0303', gain: 1.5, bias: -0.06, gamma: 0.8, hatch: 9, hatchAng: 0.35,
    edgeLo: 0.1, edgeHi: 0.26, edgeW: 2.2, clarity: 1.2, sc: 0.45, sky: { mode: 'tone', top: 0.12, hzV: 0.86, cloud: 1.6 } },
  // flat reds, sobel ink, a cream sun with radial rays behind the rider
  'constructivist-poster': { style: 'poster', grade: 'poster', levels: 3, ink: '#0b0303', gain: 1.6, bias: -0.22,
    edgeLo: 0.08, edgeHi: 0.2, edgeW: 2.5, clarity: 0.6,
    sky: { mode: 'field', pal: ['#0b0303', '#bd1818', '#c91f37'], cloud: 0.5, rays: 1, sun: { r: 0.2, amt: 1 }, sunColor: '#f4e6d0' } },
  // currency plate: fine oxblood hatch on cream, sky tone-engraved, crisp edges
  banknote: { style: 'engrave', grade: 'cream', ink: '#4a060e', gain: 1.3, bias: -0.04, gamma: 0.9, hatch: 6, hatchAng: 0.9,
    edgeLo: 0.09, edgeHi: 0.22, edgeW: 1.6, clarity: 1.1, sc: 0.35, sky: { mode: 'tone', top: 0.45, hzV: 0.78, cloud: 1.8 } },
  // parallax dolly in brand red with a graded sky field and cream dust
  'infrared-dolly': { grade: 'acp', gain: 1.15, bias: -0.08, gamma: 1.2, glow: 0.25, clarity: 0.8, rim: 0.6, rimColor: '#f4e6d0',
    fog: '#c91f37', fogAmt: 0.3, hzGlow: 0.2, dust: 1, dustSize: 6, dustA: '#f4e6d0', dustB: '#c91f37', sky: SKY_FIELD },
  // the multiplied horde in warm brand gold, sun-hot horizon
  'gold-horde': { grade: 'gold', gain: 1.1, bias: -0.05, glow: 0.3, fog: '#b8402a', rowInk: '#0b0303', rim: '#f4e6d0',
    sky: { mode: 'field', pal: ['#0b0203', '#7a1410', '#d0602a'], cloud: 1, hzGlow: 0.8, glowColor: '#f4e6d0' } },
  // HERO: the banner rider as a black silhouette against a giant cream sun, rim-lit
  'hero-sun': { grade: 'acp', gain: 1.5, bias: -0.2, gamma: 1.3, clarity: 1, sc: 0.4, rim: 1, rimColor: '#f4e6d0', glow: 0,
    sky: { ...SKY_FIELD, key: [0.27, 0.35], silhouette: 1, sun: { r: 0.17, amt: 1 }, sunColor: '#f4e6d0', rays: 0.6 } },
  // HERO: the ☭≡/acc lockup burning in the sky behind the rider (the scene draws it into a mask: sky.sigil = key)
  'hero-sigil': { grade: 'acp', gain: 1.5, bias: -0.2, gamma: 1.3, clarity: 1, sc: 0.4, rim: 0.9, rimColor: '#f4e6d0',
    sky: { ...SKY_FIELD, key: [0.27, 0.35], sigilAmt: 1, sigilColor: '#f4e6d0', rays: 0.3 } },
};

// ---------------------------------------------------------------- shaders
const VS_QUAD = `#version 300 es
in vec2 p; out vec2 vUv;
void main(){ vUv = vec2(p.x*.5+.5, .5-p.y*.5); gl_Position = vec4(p,0,1); }`;

const PRE = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2D uF, uF2; uniform sampler2DArray uV; uniform sampler2D uM; uniform sampler2D uD; uniform sampler2D uRM;
uniform sampler2D uIn, uS;
uniform vec2 uR; uniform float uT, uKick, uVN, uSeed, uJit, uFK, uSrc, uFi;
uniform vec3 uPal[5]; uniform float uGain, uBias, uGamma, uLevels, uGlow, uHatch, uHatchAng, uClar, uSC;
uniform int uStyle; uniform vec3 uInk; uniform float uSoft, uPxS;
uniform int uSkyM; uniform float uHz, uSkyTop, uSkyHzV, uCloud, uRays, uSigil, uHzG; uniform vec2 uSkyKey;
uniform vec3 uSky0, uSky1, uSky2, uSunC, uSigC, uHzGC; uniform vec4 uSun;
uniform float uRim, uSil, uSilT; uniform vec3 uRimC; uniform int uCut; uniform vec2 uCutW;
#define FC (gl_FragCoord.xy*uPxS)
uniform vec4 uCam;                        // zoom, cx, cy, rot  (source window)
in vec2 vUv; out vec4 o;
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
const float LO=.075, SPAN=.68;                               // source R: ~20..190 -> 0..1
vec2 SQ(){ vec2 p=FC/vec2(1080.,1920.); return vec2(p.x,1.-p.y); }   // screen uv (top-left origin) at any res
// source luma: frame A cross-faded with frame B by uFK (smooth slow motion), or a target's luminance (src:)
float rawS(vec2 uv,float l){ return dot(textureLod(uIn,vec2(uv.x,1.-uv.y),l).rgb,vec3(.3,.59,.11))*SPAN+LO; }
float rawF(vec2 uv,float b){ if(uSrc>.5) return rawS(uv,b); float a=texture(uF,uv,b).r; if(uFK>.004) a=mix(a,texture(uF2,uv,b).r,uFK); return a; }
float rawFL(vec2 uv,float l){ if(uSrc>.5) return rawS(uv,l); float a=textureLod(uF,uv,l).r; if(uFK>.004) a=mix(a,textureLod(uF2,uv,l).r,uFK); return a; }
float lumF(vec2 uv){ return clamp((rawF(uv,uSoft)-LO)/SPAN,0.,1.); }
float lumFL(vec2 uv,float l){ return clamp((rawFL(uv,l)-LO)/SPAN,0.,1.); }
float lumV(vec2 uv,float f){ f=clamp(f,0.,uVN-1.); float a=floor(f), k=f-a;
  float x=mix(texture(uV,vec3(uv,a)).r, texture(uV,vec3(uv,min(a+1.,uVN-1.))).r, k);
  return clamp((x-LO)/SPAN,0.,1.); }
float wrapF(float f){ return mod(f, uVN); }
vec2 src(vec2 uv){ vec2 d=(uv-.5)*vec2(1.,1.7778); float c=cos(uCam.w), s=sin(uCam.w);
  d=mat2(c,-s,s,c)*d; return d/vec2(1.,1.7778)/uCam.x + uCam.yz; }
vec3 pal(float v){ v=clamp(v,0.,1.)*4.; int i=int(min(floor(v),3.)); float f=v-float(i);
  vec3 a=uPal[0], b=uPal[1]; for(int k=0;k<4;k++) if(k==i){ a=uPal[k]; b=uPal[k+1]; } return mix(a,b,f); }
float tone(float v){ return pow(clamp(v*uGain+uBias,0.,1.),uGamma); }
// CLARITY: large-radius unsharp against mip 3.5 (~12-16 px at 1080), edge-aware (big edges get no boost, so no
// halos), then an S-curve (uSC). Makes the soft source's silhouettes read at phone size.
float detail(vec2 uv, float v){ if(uClar<=0. && uSC<=0.) return v; float m=lumFL(uv,3.5); float d=v-m;
  v=clamp(v+uClar*d*(1.-smoothstep(.16,.5,abs(d))),0.,1.); return mix(v, v*v*(3.-2.*v), uSC); }
// SKY: the blown sky is keyed (bright AND above the frame's horizon) and replaced. tone: a luma remap that keeps
// the footage's own clouds (works under every style), field: an RGB sky (gradient + clouds + sun/rays/sigil).
float skyK(vec2 uv, float v){ if(uSkyM==0) return 0.; return smoothstep(uSkyKey.x,uSkyKey.y,v)*smoothstep(uHz+.012,uHz-.022,uv.y); }
float cloudHP(vec2 uv){ return lumFL(uv,1.5)-lumFL(uv,5.); }
float skyTone(vec2 uv, float v){ if(uSkyM!=1) return v; float k=skyK(uv,v); if(k<=0.) return v;
  float h=clamp((uHz-uv.y)/max(uHz,.05),0.,1.);
  float s=mix(uSkyHzV,uSkyTop,pow(h,.7))+cloudHP(uv)*uCloud*1.6;
  return mix(v,clamp(s,0.,1.),k); }
vec3 skyCol(vec2 uv, vec2 q){
  float h=clamp((uHz-uv.y)/max(uHz,.05),0.,1.);
  float y=clamp(1.-h+cloudHP(uv)*uCloud*2.2+(lumFL(uv,4.)-.6)*.25*uCloud,0.,1.);
  y=pow(y,1.5);
  vec3 col= y<.5 ? mix(uSky0,uSky1,y*2.) : mix(uSky1,uSky2,(y-.5)*2.);
  col+=uHzGC*exp(-h*14.)*uHzG;
  if(uSun.w>0.){ vec2 d=(uv-uSun.xy)*vec2(1.,1.7778); float r=length(d)/uSun.z;
    float disc=smoothstep(1.,.992,r);
    float band=smoothstep(.0,.08,-cloudHP(uv)*uCloud);                  // the real clouds cross the disc
    float ang=atan(d.y,d.x);
    float ray=pow(max(0.,sin(ang*16.+uT*.15)),10.)*uRays*exp(-max(r-1.,0.)*1.1)*step(1.,r);
    col=mix(col,uSunC*(1.-band*.45),disc*uSun.w);
    col+=uSunC*(exp(-max(r-1.,0.)*4.)*.35+ray*.28)*uSun.w*(1.-disc); }
  if(uSigil>0.){ float s=texture(uS,q).r, g=textureLod(uS,q,4.).r;
    col=mix(col,uSigC,s*uSigil); col+=uSigC*g*.45*uSigil*(1.-s); }
  return col; }
// FIN: every effect ends here. Sky field replace, RIM light (the new sky bleeding over the silhouette edge,
// read from the blurred key, hotter toward the sun) and the output alpha for layering (cut: sky | rider).
vec4 fin(vec3 col, vec2 uv, float v){
  float k=skyK(uv,mix(v,lumFL(uv,1.4),.6)); float a=1.;             // key from a slightly blurred luma: no JPEG blocks
  if(uSkyM==2 && k>.002) col=mix(col,skyCol(uv,SQ()),k);            // (branch: ground pixels skip the sky)
  float dsc=0.;
  if(uSkyM==2 && uSun.w>0. && uSil>0.){                  // SILHOUETTE: inside the sun disc the key goes binary, so the
    vec2 d=(uv-uSun.xy)*vec2(1.,1.7778);                   // rider cuts a crisp black shape out of the disc (no grey ghosting)
    float disc=smoothstep(1.02,.99,length(d)/uSun.z)*smoothstep(uHz+.015,uHz-.005,uv.y);
    float kk=smoothstep(uSilT-.035,uSilT+.035,mix(v,lumFL(uv,1.4),.6));
    col=mix(col,mix(uInk,uSunC,kk),disc*uSil); k=mix(k,kk,disc*uSil); dsc=disc*uSil; }
  if(uRim>0. && uSkyM>0 && uv.y<uHz+.03){ float kb=skyK(uv,lumFL(uv,2.6)); float r=clamp(kb-k,0.,1.)*(1.-k);
    float sn=uSun.w>0. ? 1.+1.5*exp(-length((uv-uSun.xy)*vec2(1.,1.7778))/max(uSun.z,.01)*.8) : 1.;
    col+=uRimC*r*uRim*1.6*sn*(1.-dsc); }
  if(uCut==1) a=1.-k;
  else if(uCut==2){ float win=smoothstep(uCutW.y,uCutW.y*.55,abs(uv.x-uCutW.x));   // the rider + his own patch of
    float med=clamp((texture(uRM,vec2(uv.y,(uFi+.5)/uVN)).r-LO)/SPAN,0.,1.);
    float dm=smoothstep(.02,.1,med-lumFL(uv,1.5));                               // darker than his row: horse and legs
    a=win*max((1.-k)*smoothstep(uHz+.09,uHz+.02,uv.y), dm*smoothstep(uHz+.24,uHz+.16,uv.y)); } // ground: he rides IN FRONT
  return vec4(col,a); }
// engraving: parallel lines whose width follows darkness and whose path bends with the image,
// a cross-hatch joins in the shadows. px = pixel coords, v = toned luma, w = low-freq luma for bending.
float engrave(vec2 px, float v, float w){
  float d=1.-v; float per=uHatch; vec2 j=vec2(uJit*3.1, uJit*1.7);
  float a=uHatchAng; vec2 dir=vec2(cos(a),sin(a));
  float s1=dot(px+j,dir)/per + w*5. + n2(px*.01)*1.2;
  float l1=abs(fract(s1)-.5)*2.; float aa=1.5/per*2.;
  float c=1.-smoothstep(d*1.05-aa, d*1.05+aa, l1);
  vec2 dir2=vec2(cos(a+1.2),sin(a+1.2)); float s2=dot(px-j,dir2)/(per*.8) - w*3.;
  float l2=abs(fract(s2)-.5)*2.; float d2=clamp((d-.5)*1.6,0.,1.);
  c=max(c, 1.-smoothstep(d2-aa, d2+aa, l2));
  float stip=step(.985-d*.05, h21(floor(px/2.)+floor(uJit*7.)))*step(.25,d);
  return clamp(max(c,stip*.8),0.,1.); }
float halftone(vec2 px, float v){ float per=uHatch*1.4; float a=.6; mat2 R=mat2(cos(a),-sin(a),sin(a),cos(a));
  vec2 q=R*px/per; vec2 f=fract(q)-.5; float r=sqrt(clamp(1.-v,0.,1.))*.62; float aa=1.2/per;
  return 1.-smoothstep(r-aa, r+aa, length(f)); }
vec3 shade(float v, vec2 px, float w){
  v=tone(v);
  if(uStyle==1){ float q=floor(v*uLevels+.5)/uLevels; return pal(q); }
  if(uStyle==2){ float c=engrave(px, v, w); vec3 paper=pal(clamp(v*.35+.65,0.,1.)); return mix(paper, uInk, c); }
  if(uStyle==3){ float c=halftone(px, v); return mix(pal(1.), uInk, c); }
  return pal(v); }
vec3 glow(vec2 uv){ if(uGlow<=0.) return vec3(0.); float b=lumFL(uv,5.); return pal(1.)*pow(b,3.)*uGlow; }
`;

const FS = {
  // straight footage through the look
  plain: `${PRE}
void main(){ vec2 uv=src(vUv); float v0=lumF(uv); float v=skyTone(uv,detail(uv,v0)); float w=lumFL(uv,4.);
  o=fin(shade(v,FC,w)+glow(uv)*(1.-skyK(uv,v0)),uv,v0); }`,

  // slit-scan: every column/row/ring is a different moment. mode 0 cols, 1 rows, 2 radial, 3 wave, 4 mask-driven
  slit: `${PRE}
uniform float uF0, uSpan, uMode, uBands, uWave, uSeam; uniform vec3 uSeamC;
void main(){
  vec2 q=vUv; float g;
  if(uMode<.5) g=q.x; else if(uMode<1.5) g=q.y;
  else if(uMode<2.5) g=clamp(length((q-vec2(.5,.52))*vec2(1.,1.7778))*.9,0.,1.);
  else if(uMode<3.5) g=clamp(q.x+uWave*(sin(q.y*7.+uT*2.3)*.12+sin(q.y*23.-uT*4.)*.03),0.,1.);
  else g=textureLod(uM,q,2.).r;
  float seam=0.;
  if(uBands>0.){ float gb=g*uBands; float fb=fract(gb); seam=1.-smoothstep(0.,2.5*uBands/1080.,min(fb,1.-fb));
    g=(floor(gb)+smoothstep(.0,1.,fb)*.15)/uBands; }
  float f=wrapF(uF0+uSpan*g); vec2 uv=src(q);
  vec2 tx=vec2(1.5/360.,1.5/640.)/uCam.x;
  float v0=lumV(uv,f); float nb=(lumV(uv+vec2(tx.x,0),f)+lumV(uv-vec2(tx.x,0),f)+lumV(uv+vec2(0,tx.y),f)+lumV(uv-vec2(0,tx.y),f))*.25;
  float v=clamp(v0+(v0-nb)*(1.4+uClar),0.,1.);                  // unsharp: the volume is low-res
  float k=skyK(uv,v0);
  if(uSkyM==1){ float h=clamp((uHz-uv.y)/max(uHz,.05),0.,1.); v=mix(v,clamp(mix(uSkyHzV,uSkyTop,pow(h,.7))+(v0-nb)*uCloud*3.,0.,1.),k); }
  vec3 col=shade(v,FC,nb);
  if(uSkyM==2) col=mix(col,skyCol(uv,q),k);
  col=mix(col,uSeamC,seam*uSeam);
  o=vec4(col,1.); }`,

  // echo: ghosts of where the riders were. mode 0 light ghosts, 1 ink smear, 2 brand time-split, 3 RGB split (lab-only)
  echo: `${PRE}
uniform float uF0, uTaps, uSpacing, uDecay, uEMode, uEGain; uniform vec3 uE0, uE1;
void main(){
  vec2 uv=src(vUv); float v0=lumF(uv); float w=lumFL(uv,4.);
  if(uEMode>1.5){ float r=lumV(uv,wrapF(uF0)), g=lumV(uv,wrapF(uF0-uSpacing)), b=lumV(uv,wrapF(uF0-2.*uSpacing));
    if(uEMode>2.5){ vec3 c=vec3(tone(r), tone(g)*.92, tone(b)*.86); o=vec4(mix(c, c*c*vec3(1.1,.9,.9), .3),1.); return; }
    float v=skyTone(uv,detail(uv,v0)); vec3 col=shade(v,FC,w);
    float lead=clamp((g-r)*3.5,0.,1.), trail=clamp((r-b)*3.5,0.,1.);     // cream where it arrives, red where it was
    col=mix(col,uE1,trail*uEGain); col=mix(col,uE0,lead*.85*uEGain);
    o=fin(col,uv,v0); return; }
  float v=skyTone(uv,detail(uv,v0));
  vec3 col=shade(v,FC,w);
  vec3 acc=vec3(0.); float dk=0.;
  for(int k=1;k<24;k++){ float fk=float(k); if(fk>=uTaps) break;
    float vk=lumV(uv,wrapF(uF0-fk*uSpacing)); float e=max(0.,v0-vk)*pow(uDecay,fk);
    vec3 ec=mix(uE0,uE1,fk/uTaps); acc=max(acc, ec*smoothstep(.02,.35,e)*1.2); dk=max(dk,smoothstep(.02,.3,e)*pow(uDecay,fk*.5)); }
  float ga=clamp(max(acc.r,max(acc.g,acc.b))*uEGain,0.,1.);
  vec4 fo=fin(col,uv,v0); col=fo.rgb;
  col = uEMode<.5 ? mix(col, acc/max(.001,max(acc.r,max(acc.g,acc.b))), ga*.85) : mix(col, uInk, dk*uEGain);
  o=vec4(col+glow(uv),fo.a); }`,

  // rotoscope: posterize/engrave + sobel ink outline, boiling on twos
  ink: `${PRE}
uniform float uEdgeW, uEdgeLo, uEdgeHi, uPaperN;
void main(){
  vec2 uv=src(vUv)+vec2(uJit*.0006,uJit*.0004); vec2 tx=uEdgeW/vec2(1080.,1920.)/uCam.x;
  float s[9]; int n=0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ s[n++]=lumFL(uv+vec2(x,y)*tx,1.3); }
  float gx=(s[2]+2.*s[5]+s[8])-(s[0]+2.*s[3]+s[6]), gy=(s[6]+2.*s[7]+s[8])-(s[0]+2.*s[1]+s[2]);
  float e=smoothstep(uEdgeLo,uEdgeHi,length(vec2(gx,gy)));
  float v0=s[4]; float v=skyTone(uv,detail(uv,v0)); float w=lumFL(uv,4.);
  vec3 col=shade(v,FC,w);
  float fib=n2(FC*vec2(.02,.35))*.6+n2(FC*.3)*.4;
  col*=1.-uPaperN*(fib-.5)*.25;
  float k=skyK(uv,v0);
  col=mix(col,uInk,e*(1.-k*.7));
  o=fin(col+glow(uv)*.5,uv,v0); }`,

  // multiplied crowd: perspective rows of riders. Each row is a strip of the footage's horizon band; the
  // strip is cut into tiles, each tile re-centred on the TRACKED rider of its own moment (uK track texture),
  // ping-pong mirrored, jittered and rescaled per tile, so one rider becomes a front a mile wide. Matte = darker
  // than the row's own median (a horizontal high-pass), so hills and ground drop out and only figures survive.
  // uBg 0: no background, alpha = figures + dust bands (for layering over another target)
  crowd: `${PRE}
uniform sampler2D uK;
uniform float uF0, uRows, uBandY, uBandUp, uBandDn, uMatLo, uMatHi, uMirror, uWin, uRun0, uRunLen, uGap, uBgZ, uBg, uJx; uniform vec3 uFog, uRowInk, uRimR;
uniform vec4 uRow[14]; uniform vec4 uRow2[14];
void main(){
  vec2 q=vUv; if(uMirror>.5) q.x=.5+abs(q.x-.5);
  vec3 col=uFog; float al=0.;
  if(uBg>.5){ vec2 bq=(q-.5)/uBgZ+vec2(.5,.5); float bv0=lumFL(bq,2.2); float bv=skyTone(bq,detail(bq,bv0));
    col=fin(shade(bv,FC,lumFL(bq,4.))+glow(bq)*(1.-skyK(bq,bv0)),bq,bv0).rgb; al=1.; }
  for(int r=0;r<14;r++){ if(float(r)>=uRows) break;
    vec4 A=uRow[r], B=uRow2[r];                  // A: horizonY, scale, phase, tOff   B: fog, speed, haze, seed
    float sy=uBandY+(q.y-A.x)/A.y;
    if(sy<uBandY-uBandUp || sy>uBandY+uBandDn) continue;
    float fy=smoothstep(uBandY-uBandUp,uBandY-uBandUp+.05,sy)*(1.-smoothstep(uBandY+uBandDn-.06,uBandY+uBandDn,sy));
    float hz=exp(-pow((sy-uBandY-.03)/.045,2.))*B.z*(.6+.4*n2(vec2(q.x*9.+float(r)*3.,uT*.5)));
    col=mix(col, uFog, clamp(hz,0.,1.)); al=max(al,clamp(hz,0.,1.)*.85);
    float lx=(q.x-.5)/A.y/uWin+A.z; float ti=floor(lx); float fx=fract(lx)-.5;
    float hs=h21(vec2(ti+B.w, float(r)*7.13+B.w));
    if(hs<uGap) continue;
    fx+=(h21(vec2(ti,B.w+3.))-.5)*uJx;            // break the stamped grid: per-tile x jitter
    float sc=1.+(h21(vec2(ti,B.w+9.))-.5)*.22;      // and per-tile scale
    float f=uRun0+mod(uF0*B.y*(.85+.3*hs)+A.w+hs*uRunLen*3.7, uRunLen);
    vec2 tr=texture(uK,vec2((floor(f)+.5)/uVN,.5)).xy;
    if(mod(ti,2.)>.5) fx=-fx;
    float syj=uBandY+(sy-uBandY)*sc+(hs-.5)*.05;
    float fl=floor(f);
    float v=clamp((texture(uV,vec3(tr.x+fx*uWin*sc, syj, fl)).r-LO)/SPAN,0.,1.);
    float wide=clamp((texture(uRM,vec2(syj,(fl+.5)/uVN)).r-LO)/SPAN,0.,1.);
    float below=smoothstep(uBandY+.01,uBandY+uBandDn,syj);
    float m=smoothstep(uMatLo,uMatHi,wide-v)*fy*smoothstep(.5,.4,abs(fx))*(1.-below*below);
    vec3 ink=mix(uRowInk, uFog, clamp(B.x+(h21(vec2(ti,B.w+5.))-.5)*.35,0.,1.));   // per-tile depth, not one flat stamp
    float rim=m*(1.-m)*4.*smoothstep(uBandY+.02,uBandY-.04,sy)*smoothstep(.8,.3,A.y);
    col=mix(col, ink, m); col+=uRimR*rim*(1.-B.x)*.6; al=al+(1.-al)*m; }
  o=vec4(col,al); }`,

  // footage inside giant type: extruded letters, stroke, drop shadow; inside is the live frame, a slit, or a TARGET
  type: `${PRE}
uniform float uExLen, uInMode, uF0, uSpan, uStroke, uOutDim; uniform vec2 uExDir; uniform vec4 uCamIn;
uniform vec3 uPalO[5], uExA, uExB, uStrokeC;
vec3 palO(float v){ v=clamp(v,0.,1.)*4.; int i=int(min(floor(v),3.)); float f=v-float(i);
  vec3 a=uPalO[0], b=uPalO[1]; for(int k=0;k<4;k++) if(k==i){ a=uPalO[k]; b=uPalO[k+1]; } return mix(a,b,f); }
void main(){
  vec2 q=vUv; float m=texture(uM,q).r;
  vec2 uvo=src(q); float vo=lumF(uvo);
  vec3 col=fin(palO(tone(skyTone(uvo,vo)))*uOutDim,uvo,vo).rgb;
  float ex=0.;
  bool near=textureLod(uM,q-uExDir*uExLen*.5,6.).r>.002 || textureLod(uM,q,5.).r>.002;   // early-out far from the letters
  if(near) for(int k=1;k<=12;k++){ float fk=float(k)/12.; if(texture(uM,q-uExDir*uExLen*fk).r>.5){ ex=fk; break; } }
  if(ex>0. && m<.5){ vec3 e=mix(uExA,uExB,ex); float stripe=.85+.15*step(.5,fract(ex*6.)); col=e*stripe; }
  float sh=texture(uM,q-uExDir*uExLen*1.35-vec2(0.,.004)).r; if(ex==0. && m<.5) col*=1.-.55*sh;
  if(m>.02){
    vec2 uvi=(q-.5)*vec2(1.,1.7778); uvi=uvi/vec2(1.,1.7778)/uCamIn.x+uCamIn.yz;
    vec3 ic;
    if(uInMode>1.5) ic=texture(uIn,vec2(uvi.x,1.-uvi.y)).rgb;                 // a target: e.g. the crowd
    else { float v= uInMode<.5 ? lumF(uvi) : lumV(uvi, wrapF(uF0+uSpan*q.x));
      ic=shade(detail(uvi,v),FC,lumFL(uvi,4.))+glow(uvi); }
    col=mix(col, ic, smoothstep(.02,.98,m)); }
  vec2 px=1./uR; float mx=0.;
  if(near) for(int k=0;k<8;k++){ float a=float(k)*.785; mx=max(mx,texture(uM,q+vec2(cos(a),sin(a))*px*uStroke).r); }
  float stroke=clamp(mx-m,0.,1.); col=mix(col,uStrokeC,stroke);
  o=vec4(col,1.); }`,

  // depth prepass for parallax: blurred luma of the volume frame + a landscape prior
  depth: `${PRE}
uniform float uF0;
void main(){ vec2 uv=src(vUv); float f=wrapF(uF0);
  float b=0., l=0.;
  for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++){ vec2 o_=vec2(x,y); b+=lumV(uv+o_*vec2(.006,.0034)/uCam.x,f); l+=lumV(uv+o_*vec2(.03,.017)/uCam.x,f); }
  b/=25.; l/=25.;
  float dark=clamp((l-b)*3.5,0.,1.);
  float d = uv.y<uHz ? mix(1.,.55,pow((uHz-uv.y)/uHz,1.3)) - b*.12 : pow(clamp(1.-(uv.y-uHz)/(1.-uHz),0.,1.),1.6)*.97;
  d-=dark*.45*smoothstep(.25,.0,abs(uv.y-uHz));
  o=vec4(clamp(d,0.,1.), b, 0., 1.); }`,

  // layer: one target drawn through a transform with directional + zoom motion blur (comp / transitions)
  layer: `#version 300 es
precision highp float;
uniform sampler2D uIn, uIn2; uniform vec4 uXf; uniform vec2 uBlurV; uniform float uZB, uOp, uOpaque, uSolid, uSand; uniform int uN;
uniform vec3 uCol; in vec2 vUv; out vec4 o;
vec4 samp(vec2 q){ if(q.x<0.||q.x>1.||q.y<0.||q.y>1.) return vec4(0.); vec4 c=texture(uIn,vec2(q.x,1.-q.y));
  if(uOpaque>.5) c.a=1.; return vec4(c.rgb*c.a,c.a); }
void main(){
  if(uSolid>.5){ o=vec4(uCol*uOp,uOp); return; }
  if(uSand>.5){ vec2 q=vec2(vUv.x,1.-vUv.y); vec4 p=texture(uIn,q), m=texture(uIn2,q);   // plate, mid layer, plate's cut on top
    o=vec4(mix(mix(p.rgb,m.rgb,m.a),p.rgb,p.a),1.); return; }
  vec2 d=(vUv-.5-uXf.yz)*vec2(1.,1.7778); float c=cos(uXf.w), s=sin(uXf.w); d=mat2(c,-s,s,c)*d;
  vec2 q=d/vec2(1.,1.7778)/uXf.x+.5;
  vec4 acc=vec4(0.);
  for(int i=0;i<24;i++){ if(i>=uN) break; float t=uN>1 ? float(i)/float(uN-1)-.5 : 0.;
    vec2 qq=q+uBlurV*t; qq=(qq-.5)/(1.+uZB*t)+.5; acc+=samp(qq); }
  o=acc/float(max(uN,1))*uOp; }`,
};

const VS_MESH = `#version 300 es
precision highp float;
in vec2 p; uniform mat4 uMVP; uniform sampler2D uD; uniform float uDepth, uDist;
out vec2 vUv; out float vZ;
void main(){ vec2 uv=p; float d=texture(uD,clamp(uv,0.,1.)).r; vZ=d;
  float z=-d*uDepth; float s=(uDist-z)/uDist;
  vec3 P=vec3((uv.x-.5)*1.125*s, (.5-uv.y)*2.*s, z);
  vUv=uv; gl_Position=uMVP*vec4(P,1.); }`;
const FS_MESH = PRE.replace('in vec2 vUv;', 'in vec2 vUv; in float vZ;') + `
uniform vec3 uFog; uniform float uFogAmt, uHzGlow;
void main(){ vec2 uv=src(vUv); float v0=lumF(uv); float v=skyTone(uv,detail(uv,v0)); float w=lumFL(uv,4.);
  vec4 c=fin(shade(v,FC,w)+glow(uv)*(1.-skyK(uv,v0)),uv,v0); vec3 col=c.rgb;
  col=mix(col,uFog,smoothstep(.45,1.,vZ)*uFogAmt);
  col+=pal(1.)*exp(-abs(uv.y-uHz)*18.)*uHzGlow;
  o=vec4(col,c.a); }`;
const VS_PTS = `#version 300 es
precision highp float;
in vec4 a; uniform mat4 uMVP; uniform float uT, uKick, uPx; out float vA; out float vC;
void main(){ vec3 P=a.xyz; P.x=mod(P.x+uT*(.25+a.w*.6)+1.2,2.4)-1.2; P.y+=sin(uT*1.3+a.w*40.)*.03;
  vec4 c=uMVP*vec4(P,1.); gl_Position=c; float s=uPx*(1.+a.w*2.)/c.w; gl_PointSize=max(1.,s*(1.+uKick*.8));
  vA=clamp(1.2/max(c.w,.5),0.,1.)*(.35+.65*fract(a.w*13.)); vC=step(.8,fract(a.w*7.)); }`;
const FS_PTS = `#version 300 es
precision highp float; in float vA; in float vC; uniform vec3 uA, uB; out vec4 o;
void main(){ vec2 d=gl_PointCoord-.5; float r=length(d); float a=smoothstep(.5,.0,r)*vA; o=vec4(mix(uA,uB,vC)*a, a); }`;
// embers / ash: screen-space sprites rising through the frame, deterministic in t (a.xyzw = x0, phase, depth, seed)
const VS_EMB = `#version 300 es
precision highp float;
in vec4 a; uniform float uT, uKick, uPx, uRise, uWind, uY0, uY1; out float vA; out float vC;
void main(){ float life=fract(a.y+uT*uRise*(.4+a.z)); float y=mix(uY1,uY0,life);
  float x=a.x+uWind*life*(.3+a.z)+sin(uT*(1.+a.w*3.)+a.w*40.)*.015*(1.+a.z);
  gl_Position=vec4(x*2.-1., 1.-y*2., 0., 1.);
  float z=.3+a.z*1.4; gl_PointSize=max(1.,uPx*z*(1.+uKick*.6));
  float fl=.55+.45*sin(uT*(7.+a.w*9.)+a.w*60.);
  vA=smoothstep(0.,.12,life)*smoothstep(1.,.6,life)*fl*(.35+.65*a.z); vC=fract(a.w*7.); }`;
const FS_EMB = `#version 300 es
precision highp float; in float vA; in float vC; uniform vec3 uA, uB, uC; out vec4 o;
void main(){ vec2 d=gl_PointCoord-.5; float r=length(d); float core=smoothstep(.5,.0,r); core*=core;
  vec3 c= vC<.55 ? uA : vC<.85 ? uB : uC; o=vec4(c*core*vA, core*vA); }`;

// ---------------------------------------------------------------- tiny mat4
const M4 = {
  persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2), r = 1 / (n - f);
    return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (n + f) * r, -1, 0, 0, 2 * n * f * r, 0]; },
  look(e, c, u) {
    const sub = (a, b) => a.map((x, i) => x - b[i]), nrm = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const z = nrm(sub(e, c)), x = nrm(cross(u, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]; },
  mul(a, b) { const o = new Array(16).fill(0);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k];
    return o; },
};

// per-pixel texture-fetch estimate for the automatic resolution budget
const TAPS = { plain: 5, slit: 6, echo: 4, ink: 12, crowd: 3, type: 16 };
const SOFT = new Set(['slit', 'echo', 'crowd']);          // volume-based: res 0.5 is visually free
const easeIO = x => (x = clamp(x), x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// ---------------------------------------------------------------- engine
export class Footage {
  static async load(opts = {}) { const f = new Footage(opts); await f._init(); return f; }
  constructor({ dir = '../assets/riders/', count = 511, good = '../assets/riders_good.json', vol = [360, 640],
    cache = 12, slots = 4, masks = 4, meshRes = [120, 213], dust = 2600, embers = 1400, bake = '../../out/.footage/',
    budget = { effect: 24, frame: 44 } } = {}) {
    Object.assign(this, { dir, count, goodUrl: good, vol, cacheN: cache, slotsN: slots, masksN: masks, meshRes, dustN: dust,
      emberN: embers, bakeDir: bake, budget });
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    const gl = this.gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('footage: no webgl2');
    this.bitmaps = new Map(); this.slots = new Map(); this.masks = new Map(); this.targets = new Map();
    this.progs = {}; this.cur = { a: -1, b: -1, k: 0 }; this.stats = {}; this.spent = 0; this._warned = new Set();
  }
  url(i) { return `${this.dir}${String(i + 1).padStart(4, '0')}.jpg`; }

  async _init() {
    const gl = this.gl, t0 = performance.now();
    this.good = (await (await fetch(this.goodUrl)).json()).map(i => i - 1);      // 0-based frame indices with riders
    this.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.dummy = this._tex2d(); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.dummyR = this._tex2d(); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1));
    // time volume (unit 1)
    const [vw, vh] = this.vol, N = this.count;
    this.texV = gl.createTexture(); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texV);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8, vw, vh, N);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.rowMed = new Uint8Array(N * 160); this.trk = new Float32Array(N * 4);
    if (!(await this._loadBaked())) await this._buildLive();
    this.texK = this._tex2d(); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, 1, 0, gl.RGBA, gl.FLOAT, this.trk);
    this.texRM = this._tex2d(); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 160, N, 0, gl.RED, gl.UNSIGNED_BYTE, this.rowMed);
    // track hash (FNV-1a over the float bytes): identical across runs when read from the bake
    let h = 2166136261; for (const b of new Uint8Array(this.trk.buffer)) h = Math.imul(h ^ b, 16777619) >>> 0;
    this.stats.trackHash = h.toString(16).padStart(8, '0');
    // depth target (unit 3)
    const [dw, dh] = [180, 320];
    this.texD = this._tex2d(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, dw, dh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    this.fbD = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbD);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texD, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); this.dSize = [dw, dh];
    // parallax mesh
    const [mx, my] = this.meshRes, v = [], idx = [];
    const os = 0.18;                                               // overscan so camera moves never reveal an edge
    for (let y = 0; y <= my; y++) for (let x = 0; x <= mx; x++) v.push(-os + (1 + 2 * os) * x / mx, -os + (1 + 2 * os) * y / my);
    for (let y = 0; y < my; y++) for (let x = 0; x < mx; x++) { const a = y * (mx + 1) + x; idx.push(a, a + 1, a + mx + 1, a + 1, a + mx + 2, a + mx + 1); }
    this.mesh = { vb: gl.createBuffer(), ib: gl.createBuffer(), n: idx.length };
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh.vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.mesh.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    // dust motes (parallax) and embers (screen space), seeded LCG
    let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const d = new Float32Array(this.dustN * 4);
    for (let i = 0; i < this.dustN; i++) d.set([r() * 2.4 - 1.2, r() * 2.2 - 1.1, -r() * 3.2 + 0.6, r()], i * 4);
    this.dust = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.dust); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
    const e = new Float32Array(this.emberN * 4);
    for (let i = 0; i < this.emberN; i++) e.set([r() * 1.3 - 0.15, r(), Math.pow(r(), 2.2), r()], i * 4);
    this.emb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.emb); gl.bufferData(gl.ARRAY_BUFFER, e, gl.STATIC_DRAW);
    this.stats.loadMs = Math.round(performance.now() - t0);
  }
  // the baked cache (scripts/bake_footage.py): one fetch, one texSubImage3D, deterministic track
  async _loadBaked() {
    try {
      const idx = await (await fetch(this.bakeDir + 'index.json')).json();
      const [vw, vh] = this.vol;
      if (idx.n !== this.count || idx.vol[0] !== vw || idx.vol[1] !== vh) return false;
      const [vb, rb] = await Promise.all([idx.files.vol, idx.files.rowmed].map(async f => new Uint8Array(await (await fetch(this.bakeDir + f)).arrayBuffer())));
      if (vb.length !== vw * vh * this.count || rb.length !== 160 * this.count) return false;
      const gl = this.gl; gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texV);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, vw, vh, this.count, gl.RED, gl.UNSIGNED_BYTE, vb);
      this.rowMed.set(rb);
      idx.track.forEach((k, i) => this.trk.set(k, i * 4));
      this.stats.source = `bake ${idx.key}`; return true;
    } catch (e) { return false; }
  }
  // fallback: decode every JPEG in the browser (7-12 s). Track differs slightly from the bake (browser resize).
  async _buildLive() {
    const gl = this.gl, [vw, vh] = this.vol, N = this.count;
    console.warn('footage: no bake in out/.footage/ (run scripts/bake_footage.py); building the volume live');
    const tc = document.createElement('canvas'); tc.width = 90; tc.height = 160;
    const tg = tc.getContext('2d', { willReadFrequently: true }), raw = new Array(N);
    let next = 0;
    const worker = async () => {
      while (next < N) {
        const i = next++;
        const blob = await (await fetch(this.url(i))).blob();
        const bm = await createImageBitmap(blob, { resizeWidth: vw, resizeHeight: vh, resizeQuality: 'medium' });
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texV);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, vw, vh, 1, gl.RED, gl.UNSIGNED_BYTE, bm);
        tg.drawImage(bm, 0, 0, 90, 160); raw[i] = this._locate(tg.getImageData(0, 0, 90, 160).data, i);
        bm.close();
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    for (let i = 0; i < N; i++) { let x = 0, y = 0, m = 0, w = 0;
      for (let d = -4; d <= 4; d++) { const r = raw[Math.min(N - 1, Math.max(0, i + d))], k = r[2] + 1e-3; x += r[0] * k; y += r[1] * k; m += r[2]; w += k; }
      this.trk.set([x / w, y / w, m / 9, raw[i][3]], i * 4); }
    this.stats.source = 'live';
  }
  // dark upright mass in the horizon band of a 90x160 thumbnail (same rule as bake_footage.py)
  _locate(d, i) {
    const med = new Uint8Array(160), col = new Float64Array(90), Wt = [];
    for (let y = 0; y < 160; y++) { const row = []; for (let x = 0; x < 90; x++) row.push(d[(y * 90 + x) * 4]);
      med[y] = row.sort((a, b) => a - b)[45]; this.rowMed[i * 160 + y] = med[y]; }
    for (let y = 50; y < 100; y++) for (let x = 0; x < 90; x++) { const w = Math.max(0, med[y] - d[(y * 90 + x) * 4] - 14); Wt.push(w); col[x] += w; }
    let c = 0, best = -1; for (let x = 0; x < 90; x++) { let s = 0; for (let k = -2; k <= 2; k++) s += col[x + k] || 0; if (s > best) { best = s; c = x; } }
    let sx = 0, sy = 0, m = 0;
    for (let y = 50; y < 100; y++) for (let x = Math.max(0, c - 11); x < Math.min(90, c + 12); x++) { const w = Wt[(y - 50) * 90 + x]; sx += w * x; sy += w * y; m += w; }
    const sky = [...med.slice(20, 56)].sort((a, b) => a - b)[18] || 1; let hz = 0.52;
    for (let y = 56; y < 120; y++) if (med[y] < 0.72 * sky) { hz = y / 160; break; }
    return m > 0 ? [sx / m / 90, sy / m / 160, m / 1e4, hz] : [0.5, 0.5, 0, hz];
  }
  _tex2d(unit = 0) {
    const gl = this.gl, t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  _prog(name, vs, fs) {
    if (this.progs[name]) return this.progs[name];
    const gl = this.gl, p = gl.createProgram();
    for (const [type, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const sh = gl.createShader(type); gl.shaderSource(sh, s); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`footage ${name}: ${gl.getShaderInfoLog(sh)}`);
      gl.attachShader(p, sh);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`footage ${name}: ${gl.getProgramInfoLog(p)}`);
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace('[0]', '')] = gl.getUniformLocation(p, a.name); }
    return (this.progs[name] = { p, u });
  }
  // compile every program up front (SwiftShader compiles are 0.2-1 s each; keeps them out of the first frames)
  warm() {
    const t0 = performance.now();
    for (const n of ['plain', 'slit', 'echo', 'ink', 'crowd', 'type', 'depth', 'layer']) this._prog(n, VS_QUAD, FS[n]);
    this._prog('mesh', VS_MESH, FS_MESH); this._prog('pts', VS_PTS, FS_PTS); this._prog('emb', VS_EMB, FS_EMB);
    return (this.stats.warmMs = Math.round(performance.now() - t0));
  }
  _warn(k, msg) { if (!this._warned.has(k)) { this._warned.add(k); console.warn(msg); } }

  // ------------------------------------------------ read heads (shared by every footage scene)
  // the lone banner rider crosses 18..84; a second pass 108..150; the far riders 376..424
  static RUNS = [[18, 84], [108, 150], [376, 424]];
  // a looping FLOAT source frame inside a rider run; rate in source frames per second (30 = real time)
  ride(t, { run = 0, rate = 30, off = 0 } = {}) {
    const [a, b] = Footage.RUNS[run] ?? run; return a + (((t * rate + off) % (b - a)) + (b - a)) % (b - a);
  }
  // camera window that follows the tracked rider. zoom is capped (default 1.6: the source is soft, 2x+ is blobs);
  // at = where on screen the rider sits ([0.5, 0.6] = small, lower-middle, leaving a composed sky above);
  // lock blends toward a static camera. Returns {zoom, cx, cy} ready to spread into any effect.
  follow(f, { zoom = 1.3, at = [0.5, 0.6], lock = 0.85, maxZoom = 1.6 } = {}) {
    zoom = Math.min(zoom, maxZoom); const k = this.track(f), hw = 0.5 / zoom, hh = 0.5 / zoom;
    const cx = lerp(0.5 - (at[0] - 0.5) / zoom, k.x - (at[0] - 0.5) / zoom, lock);
    const cy = lerp(0.5 - (at[1] - 0.5) / zoom, k.y - (at[1] - 0.5) / zoom, lock);
    return { zoom, cx: clamp(cx, hw, 1 - hw), cy: clamp(cy, hh, 1 - hh) };
  }
  // where a source-uv point lands on screen for a camera window (to aim type or a 2D sigil at the rider)
  toScreen(p, cam) { return [(p.x - cam.cx) * cam.zoom + 0.5, (p.y - cam.cy) * cam.zoom + 0.5]; }

  // ------------------------------------------------ frames (LRU of hi-res R8+mip textures)
  wrap(i) { return ((Math.round(i) % this.count) + this.count) % this.count; }
  goodAt(k) { const g = this.good; return g[((Math.floor(k) % g.length) + g.length) % g.length]; }
  async bitmap(i) {
    i = this.wrap(i);
    if (!this.bitmaps.has(i)) {
      const blob = await (await fetch(this.url(i))).blob();
      this.bitmaps.set(i, await createImageBitmap(blob));
      if (this.bitmaps.size > this.cacheN) { const [k, b] = this.bitmaps.entries().next().value; b.close(); this.bitmaps.delete(k); }
    }
    return this.bitmaps.get(i);
  }
  async _resident(i) {
    i = this.wrap(i);
    if (this.slots.has(i)) { const s = this.slots.get(i); this.slots.delete(i); this.slots.set(i, s); return s; }
    const tA = performance.now(), bm = await this.bitmap(i), gl = this.gl, t0 = performance.now();
    let tex;
    if (this.slots.size >= this.slotsN) {          // evict the least recently used slot that is not in use right now
      const keep = new Set([this.cur.a, this.cur.b]);
      const k = [...this.slots.keys()].find(x => !keep.has(x)) ?? this.slots.keys().next().value;
      tex = this.slots.get(k).tex; this.slots.delete(k);
    } else tex = this._tex2d();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, bm);
    gl.generateMipmap(gl.TEXTURE_2D);
    const s = { i, tex }; this.slots.set(i, s);
    if (this.profile) this._sync();
    this.stats.decodeMs = Math.round(t0 - tA); this.stats.uploadMs = Math.round(performance.now() - t0);
    return s;
  }
  _split(f, blend) {
    if (!blend) { const a = this.wrap(f); return { a, b: a, k: 0 }; }
    const fl = Math.floor(f + 1e-6), k = f - fl;
    return k < 0.02 ? { a: this.wrap(fl), b: this.wrap(fl), k: 0 } : k > 0.98 ? { a: this.wrap(fl + 1), b: this.wrap(fl + 1), k: 0 }
      : { a: this.wrap(fl), b: this.wrap(fl + 1), k };
  }
  // make float frame f current: floor/ceil resident, cross-faded by fract(f). blend:false snaps (old behaviour).
  // Several frames per renderFrame are fine (LRU of `slots`); pick one per effect with `frame: f`.
  async frame(f, { blend = true } = {}) {
    const st = this._split(f, blend);
    await this._resident(st.a); if (st.k) await this._resident(st.b);
    this.cur = st; return st;
  }
  // preload several frames (keeps the last one current): await fx.frames(f, f + 30)
  async frames(...fs) { for (const f of fs) await this.frame(f); }
  _frameState(o) {
    if (o.frame == null) return this.cur;
    const st = this._split(o.frame, o.blend ?? true);
    if (!this.slots.has(st.a) || (st.k && !this.slots.has(st.b))) { this._warn('fr' + st.a, `footage: frame ${o.frame} not resident (await fx.frame first); using current`); return this.cur; }
    return st;
  }
  // named masks: draw(g) paints white on black into a W x H canvas. LRU of `masks`; effects take `mask: key`
  // (default: the last one set). redraw:true repaints an existing key (animated masks).
  mask(key, draw, { redraw = false } = {}) {
    this.maskCur = key;
    if (this.masks.has(key) && !redraw) { const m = this.masks.get(key); this.masks.delete(key); this.masks.set(key, m); return m; }
    if (!this.mc) { this.mc = document.createElement('canvas'); this.mc.width = W; this.mc.height = H; this.mg = this.mc.getContext('2d'); }
    const g = this.mg; g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.strokeStyle = '#fff';
    g.save(); draw(g); g.restore();
    let m = this.masks.get(key);
    if (!m) { if (this.masks.size >= this.masksN) { const [k, old] = this.masks.entries().next().value; this.masks.delete(k); m = old; } else m = { tex: this._tex2d() }; }
    this.masks.delete(key);
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, m.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, this.mc);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.masks.set(key, m); return m;
  }
  _maskTex(key) { const m = this.masks.get(key ?? this.maskCur); return m ? m.tex : this.dummyR; }

  // ------------------------------------------------ targets (render-to-texture)
  // fx.target(name, res): an RGBA8 texture + FBO at W*res x H*res (created on demand; any effect's `out:` makes one)
  target(name, res = 1) {
    let t = this.targets.get(name);
    if (t && t.res === res) return t;
    const gl = this.gl, w = Math.round(W * res), h = Math.round(H * res);
    if (!t) t = { name, tex: this._tex2d(), fb: gl.createFramebuffer() };
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    Object.assign(t, { w, h, res, mips: false }); this.targets.set(name, t); return t;
  }
  // a target as a sampled input; mips=true builds its mip chain (src: reads blur/glow/clarity from it)
  _inTex(name, mips) {
    const t = this.targets.get(name); if (!t) { this._warn('t' + name, `footage: no target '${name}'`); return this.dummy; }
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (mips && !t.mips) { gl.generateMipmap(gl.TEXTURE_2D); t.mips = true; }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, t.mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    return t.tex;
  }
  _bindOut(o, res) {
    const gl = this.gl;
    if (o.out) { const t = this.target(o.out, res); t.mips = false; gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.viewport(0, 0, t.w, t.h); return { t }; }
    if (res < 1) { const lo = this._lowFb(res); gl.bindFramebuffer(gl.FRAMEBUFFER, lo.fb); gl.viewport(0, 0, lo.w, lo.h); return { lo }; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); return {};
  }
  _endOut(b) {
    const gl = this.gl;
    if (b.lo) { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, b.lo.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, b.lo.w, b.lo.h, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.LINEAR); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    return b.t ?? this.canvas;
  }

  // ------------------------------------------------ drawing
  // resolution: an explicit o.res wins; otherwise an effect whose per-pixel fetch estimate is over budget.effect,
  // or that would push this frame's full-res fetch total over budget.frame, drops to 0.5 (soft) / 0.75 (ink).
  // fx.begin() resets the per-frame total (call it at the top of renderFrame).
  begin() { this.spent = 0; this.stats.autoRes = null; }
  _autoRes(name, o, taps) {
    if (o.res != null) { this.spent += taps * o.res * o.res; return o.res; }
    const fb = SOFT.has(name) ? 0.5 : name === 'ink' ? 0.75 : 0.5;
    let res = 1;
    if (taps > this.budget.effect || this.spent + taps > this.budget.frame) { res = fb; this.stats.autoRes = `${name}:${taps}->${res}`; }
    this.spent += taps * res * res; return res;
  }
  _taps(name, o) {
    let t = TAPS[name] ?? 6;
    if (name === 'echo') t += o.mode === 'chroma' || o.mode === 'rgb' ? 3 : (o.taps ?? 12);
    if (name === 'crowd') t += 3 * (o.rows?.length ?? 9) * 0.35 + (o.bg === false ? 0 : 5);
    const sk = o.sky?.mode; if (sk === 'tone') t += 2; if (sk === 'field') t += 4 + (o.sky.sigil ? 2 : 0);
    if (o.clarity || o.sc) t += 1; if (typeof o.rim === 'number' && o.rim) t += 1;
    return Math.round(t);
  }
  _look(pr, o) {
    const gl = this.gl, u = pr.u;
    gl.useProgram(pr.p);
    const st = this._frameState(o), sa = this.slots.get(st.a), sb = this.slots.get(st.b);
    const inTex = o.src ? this._inTex(o.src, true) : (typeof o.inside === 'string' && !['slit', 'frame'].includes(o.inside)) ? this._inTex(o.inside, false) : this.dummy;
    const sig = o.sky?.sigil ? this._maskTex(o.sky.sigil) : this.dummyR;
    [[gl.TEXTURE_2D, sa?.tex ?? this.dummyR], [gl.TEXTURE_2D_ARRAY, this.texV], [gl.TEXTURE_2D, this._maskTex(o.mask)], [gl.TEXTURE_2D, this.texD],
     [gl.TEXTURE_2D, this.texK], [gl.TEXTURE_2D, this.texRM], [gl.TEXTURE_2D, (sb ?? sa)?.tex ?? this.dummyR], [gl.TEXTURE_2D, inTex], [gl.TEXTURE_2D, sig]]
      .forEach(([tgt, tex], k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(tgt, tex); });
    for (const [n, unit] of [['uF', 0], ['uV', 1], ['uM', 2], ['uD', 3], ['uK', 4], ['uRM', 5], ['uF2', 6], ['uIn', 7], ['uS', 8]]) if (u[n]) gl.uniform1i(u[n], unit);
    const f1 = (n, v) => { if (u[n] != null) gl.uniform1f(u[n], v); };
    const v3 = (n, c) => { if (u[n] != null) gl.uniform3fv(u[n], hex(c)); };
    const i1 = (n, v) => { if (u[n] != null) gl.uniform1i(u[n], v); };
    if (u.uR) gl.uniform2f(u.uR, W, H);
    f1('uT', o.t ?? 0); f1('uKick', o.kick ?? 0); f1('uVN', this.count); f1('uSeed', o.seed ?? 0); f1('uJit', o.jit ?? 0);
    f1('uFK', o.src ? 0 : st.k); f1('uSrc', o.src ? 1 : 0); f1('uFi', st.a);
    if (u.uPal) gl.uniform3fv(u.uPal, palArr(o.grade ?? 'acp'));
    f1('uGain', o.gain ?? 1); f1('uBias', o.bias ?? 0); f1('uGamma', o.gamma ?? 1); f1('uLevels', o.levels ?? 4);
    f1('uGlow', o.glow ?? 0); f1('uSoft', o.soft ?? 0.8); f1('uHatch', o.hatch ?? 11); f1('uHatchAng', o.hatchAng ?? 0.5);
    f1('uClar', o.clarity ?? 0); f1('uSC', o.sc ?? 0);
    i1('uStyle', STYLE[o.style ?? 'grade']);
    v3('uInk', o.ink ?? '#0b0303');
    if (u.uCam) gl.uniform4f(u.uCam, o.zoom ?? 1, o.cx ?? 0.5, o.cy ?? 0.5, o.rot ?? 0);
    // sky
    const sky = o.sky ?? {}, mode = { tone: 1, field: 2 }[sky.mode] ?? 0, trk = this.track(Math.max(0, st.a));
    i1('uSkyM', mode); f1('uHz', sky.hz ?? o.hz ?? trk.hz);
    if (u.uSkyKey) gl.uniform2f(u.uSkyKey, ...(sky.key ?? [0.22, 0.4]));
    f1('uSkyTop', sky.top ?? 0.3); f1('uSkyHzV', sky.hzV ?? 0.75); f1('uCloud', sky.cloud ?? 1); f1('uRays', sky.rays ?? 0);
    const sp = sky.pal ?? SKY_FIELD.pal; v3('uSky0', sp[0]); v3('uSky1', sp[1]); v3('uSky2', sp[2]);
    f1('uHzG', sky.hzGlow ?? 0.4); v3('uHzGC', sky.glowColor ?? '#f4e6d0');
    const sun = sky.sun; if (u.uSun) gl.uniform4f(u.uSun, sun?.x ?? trk.x, sun?.y ?? (trk.y - 0.1), sun?.r ?? 0.25, sun ? (sun.amt ?? 1) : 0);
    v3('uSunC', sky.sunColor ?? '#f4e6d0'); f1('uSigil', sky.sigil ? (sky.sigilAmt ?? 1) : 0); v3('uSigC', sky.sigilColor ?? '#f4e6d0');
    f1('uSil', sky.silhouette ?? 0); f1('uSilT', sky.silT ?? 0.34);
    f1('uRim', typeof o.rim === 'number' ? o.rim : 0); v3('uRimC', o.rimColor ?? '#f4e6d0');
    i1('uCut', { sky: 1, rider: 2 }[o.cut] ?? 0);
    if (u.uCutW) gl.uniform2f(u.uCutW, o.cutX ?? trk.x, o.cutW ?? 0.16);
    return { f1, v3, i1, u };
  }
  _quad(pr) {
    const gl = this.gl, loc = gl.getAttribLocation(pr.p, 'p');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  _run(name, o, set) {
    const gl = this.gl, t0 = performance.now();
    if (o.src && o.src === o.out) throw new Error(`footage ${name}: src and out are the same target`);
    const pr = this._prog(name, VS_QUAD, FS[name]);
    const res = this._autoRes(name, o, this._taps(name, o));
    const b = this._bindOut(o, res); gl.disable(gl.BLEND);
    setPx(this, pr, res);
    const L = this._look(pr, o); set && set(L);
    this._quad(pr);
    const r = this._endOut(b);
    if (o.sync || this.profile) { this._sync(); this.stats[name] = Math.round(performance.now() - t0); }
    return r;
  }
  _lowFb(res) {
    this.lows = this.lows || {};
    if (!this.lows[res]) {
      const gl = this.gl, w = Math.round(W * res), h = Math.round(H * res), tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.lows[res] = { fb, w, h };
    }
    return this.lows[res];
  }
  _sync() { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this._px || (this._px = new Uint8Array(4))); }
  sync() { this._sync(); }

  // ------------------------------------------------ presets
  look(name, over = {}) {
    const L = LOOKS[name]; if (!L) throw new Error(`footage: no look '${name}' (${Object.keys(LOOKS).join(', ')})`);
    const sky = L.sky || over.sky ? { ...(L.sky || {}), ...(over.sky || {}) } : undefined;
    if (sky && L.sky?.sun && over.sky?.sun) sky.sun = { ...L.sky.sun, ...over.sky.sun };
    return { ...L, ...over, ...(sky ? { sky } : {}) };
  }

  // ------------------------------------------------ effects
  plain(o = {}) { return this._run('plain', o); }
  // f0: first source frame (float), span: frames across the sweep, mode: cols|rows|radial|wave|mask
  slit(o = {}) {
    const modes = { cols: 0, rows: 1, radial: 2, wave: 3, mask: 4 };
    return this._run('slit', o, ({ f1, v3 }) => {
      f1('uF0', o.f0 ?? 0); f1('uSpan', o.span ?? 60); f1('uMode', modes[o.mode ?? 'cols']); f1('uBands', o.bands ?? 0);
      f1('uWave', o.wave ?? 1); f1('uSeam', o.seam ?? 0.6); v3('uSeamC', o.seamColor ?? '#f4e6d0');
    });
  }
  // echo: f0 = current frame; taps, spacing (frames), decay; mode ghost | smear | chroma (brand: cream lead,
  // red trail) | rgb (the old RGB split: off-brand, lab only)
  echo(o = {}) {
    const modes = { ghost: 0, smear: 1, chroma: 2, rgb: 3 };
    if (o.mode === 'rgb') this._warn('rgb', 'footage: echo mode rgb is off-brand (cyan/yellow/blue); use chroma');
    return this._run('echo', o, ({ f1, v3 }) => {
      f1('uF0', o.f0 ?? (this.cur.a + this.cur.k)); f1('uTaps', o.taps ?? 12); f1('uSpacing', o.spacing ?? 2); f1('uDecay', o.decay ?? 0.93);
      f1('uEMode', modes[o.mode ?? 'ghost']); f1('uEGain', o.echoGain ?? 1);
      v3('uE0', o.echoHead ?? '#f4e6d0'); v3('uE1', o.echoTail ?? '#c91f37');
    });
  }
  // rotoscope: style engrave|poster|halftone + sobel outline; jit = boil (change on twos)
  ink(o = {}) {
    return this._run('ink', { style: 'engrave', grade: 'cream', ...o }, ({ f1 }) => {
      f1('uEdgeW', o.edgeW ?? 2); f1('uEdgeLo', o.edgeLo ?? 0.18); f1('uEdgeHi', o.edgeHi ?? 0.45); f1('uPaperN', o.paper ?? 1);
    });
  }
  // rows: [{y, scale, phase, t, fog, speed, haze, seed}] back to front (y = screen horizon of the row, 0..1).
  // run: [first, last] source frames the riders are drawn from (default: the lone banner rider, 18..84)
  // bg:false -> no footage background, alpha = figures + dust (layer it over a hero plate with fx.comp)
  // jx: per-tile x jitter (0..0.4) so the rows stop reading as a stamped grid
  crowd(o = {}) {
    const rows = o.rows ?? Footage.rows(), run = o.run ?? [18, 84], gl = this.gl;
    return this._run('crowd', { ...o, rows }, ({ f1, v3, u }) => {
      const A = new Float32Array(56), B = new Float32Array(56);
      rows.slice(0, 14).forEach((r, i) => { A.set([r.y, r.scale, r.phase ?? 0, r.t ?? 0], i * 4); B.set([r.fog ?? 0, r.speed ?? 1, r.haze ?? 0.5, r.seed ?? i], i * 4); });
      if (u.uRow) gl.uniform4fv(u.uRow, A); if (u.uRow2) gl.uniform4fv(u.uRow2, B);
      f1('uF0', o.f0 ?? 0); f1('uRows', Math.min(14, rows.length)); f1('uRun0', run[0]); f1('uRunLen', run[1] - run[0]);
      f1('uBandY', o.bandY ?? 0.5); f1('uBandUp', o.bandUp ?? 0.13); f1('uBandDn', o.bandDn ?? 0.1); f1('uWin', o.win ?? 0.3);
      f1('uMatLo', o.matLo ?? 0.09); f1('uMatHi', o.matHi ?? 0.26); f1('uMirror', o.mirror ? 1 : 0); f1('uGap', o.gap ?? 0.15);
      f1('uBgZ', o.bgZoom ?? 1); f1('uBg', o.bg === false ? 0 : 1); f1('uJx', o.jx ?? 0.18);
      v3('uFog', o.fog ?? '#e2485c'); v3('uRowInk', o.rowInk ?? '#0b0303'); v3('uRimR', typeof o.rim === 'string' ? o.rim : '#ffd2b0');
    });
  }
  // a default perspective stack: n rows from the horizon (far, small, fogged) to the bottom (near, big, ink)
  static rows({ n = 9, y0 = 0.5, y1 = 1.05, s0 = 0.16, s1 = 1.2, seed = 3, speed = 1, haze = 0.55 } = {}) {
    let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: n }, (_, i) => {
      const u = i / Math.max(1, n - 1);
      return { y: y0 + (y1 - y0) * Math.pow(u, 1.35), scale: s0 + (s1 - s0) * Math.pow(u, 1.8), phase: r(), t: Math.floor(r() * 60),
        fog: Math.pow(1 - u, 2.2) * 0.85, speed: speed * (0.8 + 0.4 * r()), haze: haze * (1 - u * 0.6), seed: i * 3.7 + seed };
    });
  }
  // smoothed rider track for frame i: {x, y} centre of the rider in source uv, m = mass, hz = horizon y
  track(i) { const k = this.wrap(i) * 4, T = this.trk; return { x: T[k], y: T[k + 1], m: T[k + 2], hz: T[k + 3] || 0.52 }; }
  // text: fx.mask(key, draw) first (or mask: key). inside: 'frame' (live) | 'slit' (time across x) | a target name
  type(o = {}) {
    return this._run('type', o, ({ f1, v3, u }) => {
      const gl = this.gl, ins = o.inside ?? 'frame';
      f1('uExLen', o.exLen ?? 0.05); gl.uniform2f(u.uExDir, ...(o.exDir ?? [0.35, -0.94]));
      f1('uInMode', ins === 'slit' ? 1 : ins === 'frame' ? 0 : 2); f1('uF0', o.f0 ?? this.cur.a); f1('uSpan', o.span ?? 40);
      f1('uStroke', o.stroke ?? 5); f1('uOutDim', o.outDim ?? 0.55);
      gl.uniform4f(u.uCamIn, o.inZoom ?? 1, o.inCx ?? 0.5, o.inCy ?? 0.5, 0);
      gl.uniform3fv(u.uPalO, palArr(o.outGrade ?? 'acp'));
      v3('uExA', o.exA ?? '#5a0610'); v3('uExB', o.exB ?? '#140104'); v3('uStrokeC', o.strokeColor ?? '#f4e6d0');
    });
  }
  // 2.5D: depth from luma/blur + landscape prior displaces a mesh; cam = {x, y, z, yaw, pitch, fov}
  parallax(o = {}) {
    const gl = this.gl, t0 = performance.now();
    const f0 = o.f0 ?? (this.cur.a + this.cur.k), hz = o.hz ?? this.track(Math.max(0, this.cur.a)).hz;
    const pd = this._prog('depth', VS_QUAD, FS.depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbD); gl.viewport(0, 0, ...this.dSize); gl.disable(gl.BLEND);
    setPx(this, pd, 1); const Ld = this._look(pd, o); Ld.f1('uF0', f0); Ld.f1('uHz', hz); this._quad(pd);
    const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 40, ...(o.cam || {}) };
    const dist = 1 / Math.tan(cam.fov * Math.PI / 360), depth = o.depth ?? 2.2;
    const eye = [cam.x, cam.y, dist + cam.z];
    const tgt = [cam.x + Math.sin(cam.yaw) * 3, cam.y + Math.sin(cam.pitch) * 3, dist + cam.z - 3];
    const mvp = M4.mul(M4.persp(cam.fov * Math.PI / 180, W / H, 0.05, 50), M4.look(eye, tgt, [0, 1, 0]));
    const res = o.res ?? 1; this.spent += 10 * res * res;
    const b = this._bindOut(o, res);
    const pm = this._prog('mesh', VS_MESH, FS_MESH);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    setPx(this, pm, res);
    const L = this._look(pm, o);
    gl.uniformMatrix4fv(L.u.uMVP, false, mvp); L.f1('uDepth', depth); L.f1('uDist', dist);
    L.v3('uFog', o.fog ?? '#c91f37'); L.f1('uFogAmt', o.fogAmt ?? 0.35); L.f1('uHz', hz); L.f1('uHzGlow', o.hzGlow ?? 0.25);
    const loc = gl.getAttribLocation(pm.p, 'p');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mesh.vb); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.mesh.ib);
    gl.drawElements(gl.TRIANGLES, this.mesh.n, gl.UNSIGNED_INT, 0);
    gl.disableVertexAttribArray(loc);
    if ((o.dust ?? 1) > 0) {
      const pp = this._prog('pts', VS_PTS, FS_PTS); gl.useProgram(pp.p);
      gl.uniformMatrix4fv(pp.u.uMVP, false, mvp); gl.uniform1f(pp.u.uT, o.t ?? 0); gl.uniform1f(pp.u.uKick, o.kick ?? 0);
      gl.uniform1f(pp.u.uPx, (o.dustSize ?? 5) * (o.dust ?? 1) * res);
      gl.uniform3fv(pp.u.uA, hex(o.dustA ?? '#f4e6d0')); gl.uniform3fv(pp.u.uB, hex(o.dustB ?? '#c91f37'));
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      const la = gl.getAttribLocation(pp.p, 'a');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dust); gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 4, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, this.dustN); gl.disableVertexAttribArray(la); gl.disable(gl.BLEND);
    }
    const r = this._endOut(b);
    if (o.sync || this.profile) { this._sync(); this.stats.parallax = Math.round(performance.now() - t0); }
    return r;
  }

  // ------------------------------------------------ hero moment (the mythic shot, one call)
  // The banner rider small on the lower third, a composed sky (giant sun disc or a sigil mask) behind, rim light on
  // the silhouette edge, a horde layered AROUND him (far rows behind, near rows in front, via the rider cut-out),
  // embers on top. res: plate resolution (0.75 default: the soft source loses nothing, ~0.56x the cost; 0.5 in
  // transitions). f: float source frame (await fx.frame(f) first). look: 'hero-sun' | 'hero-sigil' | any LOOK.
  // sigil: a mask key (draw it with fx.mask first) for 'hero-sigil'. Returns out (a target) or fx.canvas.
  hero({ t = 0, f, look = 'hero-sun', out = null, zoom = 1.3, at = [0.42, 0.62], lock = 0.9, sky = {}, sigil = 'sigil',
    rows = 'auto', crowd = {}, kick = 0, embers = { size: 10, opacity: 1 }, res = 0.75 } = {}) {
    f = f ?? (this.cur.a + this.cur.k);
    const cam = this.follow(f, { zoom, at, lock }), k = this.track(f);
    // the horde's horizon is the PLATE's horizon on screen, so the rows stand on the same ground as the rider
    if (rows === 'auto') rows = Footage.rows({ n: 8, seed: 11, y0: (k.hz - cam.cy) * cam.zoom + 0.505, y1: 1.02, s0: 0.1, s1: 0.7, haze: 0.8 });
    const base = look === 'hero-sigil' ? { sigil } : { sun: { x: k.x + 0.02, y: k.hz - 0.045, r: 0.17 } };   // a low sun right behind his torso and banner
    const L = this.look(look, { sky: { ...base, ...sky, ...(sky.sun ? { sun: { ...(base.sun || {}), ...sky.sun } } : {}) } });
    if (rows) {
      this.plain({ ...L, ...cam, t, frame: f, cut: 'rider', cutW: 0.13, out: '_hero', res });
      this.crowd({ grade: 'acp', f0: t * 30, rows, bg: false, fog: '#9a1c28', rowInk: '#0b0303', rim: '#f4e6d0', gap: 0.08, jx: 0.3,
        out: '_horde', res: Math.min(0.4, 0.5 * res), t, ...crowd });
      this.comp([{ src: '_hero', mid: '_horde', blend: 'copy' }], { out });
    } else this.comp([{ src: this.plain({ ...L, ...cam, t, frame: f, out: '_hero', res }).name, blend: 'copy' }], { out });
    if (embers) this.embers({ t, out, kick, ...embers });
    return out ? this.targets.get(out) : this.canvas;
  }

  // ------------------------------------------------ layering
  // comp(layers, {out, clear}): draws layers in order onto `out` (a target) or fx.canvas.
  //   layer: { src: target | color: '#hex', blend: 'over'|'add'|'screen'|'multiply'|'copy', opacity, opaque,
  //            scale, x, y, rot (screen transform), blur: [dx, dy] (directional motion blur, screen uv),
  //            zoomBlur (radial), taps (blur samples when moving, default 12, max 24),
//            mid: target -> SANDWICH in one pass: src plate (opaque), mid layered over it, src's own alpha (its cut-out)
//            back on top. The hero moment's plate / horde / rider in 2 fetches instead of 3 full passes }
  // Output is premultiplied; fx.show()/'copy' layers force it opaque.
  comp(layers, { out = null, clear = '#000000', res = 1, sync = false } = {}) {
    const gl = this.gl, t0 = performance.now();
    const b = this._bindOut({ out }, out ? res : 1);
    const pr = this._prog('layer', VS_QUAD, FS.layer); gl.useProgram(pr.p);
    if (clear) { const c = hex(clear); gl.clearColor(c[0], c[1], c[2], 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    for (const L of layers) {
      if (L.src && L.src === out) throw new Error('footage comp: a layer cannot read its own output');
      const mode = L.blend ?? 'over';
      if (mode === 'copy') gl.disable(gl.BLEND); else gl.enable(gl.BLEND);
      if (mode === 'add') gl.blendFunc(gl.ONE, gl.ONE);
      else if (mode === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
      else if (mode === 'multiply') gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const tex = L.src ? this._inTex(L.src, false) : this.dummy;         // (_inTex switches the active unit)
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(pr.u.uIn, 7);
      gl.uniform4f(pr.u.uXf, L.scale ?? 1, L.x ?? 0, L.y ?? 0, L.rot ?? 0);
      const bl = L.blur ?? [0, 0]; gl.uniform2f(pr.u.uBlurV, bl[0], bl[1]); gl.uniform1f(pr.u.uZB, L.zoomBlur ?? 0);
      const moving = Math.hypot(bl[0], bl[1]) > 0.002 || Math.abs(L.zoomBlur ?? 0) > 0.01;
      gl.uniform1i(pr.u.uN, moving ? Math.min(24, L.taps ?? 12) : 1);
      gl.uniform1f(pr.u.uOp, L.opacity ?? 1); gl.uniform1f(pr.u.uOpaque, mode === 'copy' || L.opaque ? 1 : 0);
      gl.uniform1f(pr.u.uSolid, L.color ? 1 : 0); gl.uniform3fv(pr.u.uCol, hex(L.color ?? '#000000'));
      gl.uniform1f(pr.u.uSand, L.mid ? 1 : 0);
      if (L.mid) { const t2 = this._inTex(L.mid, false); gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, t2); gl.uniform1i(pr.u.uIn2, 8); }
      this._quad(pr);
    }
    gl.disable(gl.BLEND);
    const r = this._endOut(b);
    if (sync || this.profile) { this._sync(); this.stats.comp = Math.round(performance.now() - t0); }
    return r;
  }
  // put a target on fx.canvas (opaque)
  show(name) { return this.comp([{ src: name, blend: 'copy' }]); }
  // embers / ash rising through the frame, screen-blended, deterministic in t. Draws onto `out` (a target) or
  // fx.canvas WITHOUT clearing, so call it after the layer it sits on. colors: [main, hot, rare] (brand).
  embers({ t = 0, out = null, n, size = 7, rise = 0.12, wind = 0.08, kick = 0, y0 = 0, y1 = 1.05, colors = ['#c91f37', '#f4e6d0', '#ff5a3a'], opacity = 1 } = {}) {
    const gl = this.gl, pr = this._prog('emb', VS_EMB, FS_EMB);
    let res = 1;
    if (out) { const tg = this.target(out, this.targets.get(out)?.res ?? 1); res = tg.res; gl.bindFramebuffer(gl.FRAMEBUFFER, tg.fb); gl.viewport(0, 0, tg.w, tg.h); tg.mips = false; }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); }
    gl.useProgram(pr.p);
    const u = pr.u; gl.uniform1f(u.uT, t); gl.uniform1f(u.uKick, kick); gl.uniform1f(u.uPx, size * res);
    gl.uniform1f(u.uRise, rise); gl.uniform1f(u.uWind, wind); gl.uniform1f(u.uY0, y0); gl.uniform1f(u.uY1, y1);
    const [a, b2, c] = colors.map(hex); gl.uniform3fv(u.uA, a.map(x => x * opacity)); gl.uniform3fv(u.uB, b2.map(x => x * opacity)); gl.uniform3fv(u.uC, c.map(x => x * opacity));
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    const la = gl.getAttribLocation(pr.p, 'a');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.emb); gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 4, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, Math.min(n ?? this.emberN, this.emberN)); gl.disableVertexAttribArray(la); gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    return out ? this.targets.get(out) : this.canvas;
  }
  // transition kit between two targets, u = 0..1:
  //   whip:  A pans out, B pans in along dir with motion blur peaking mid-move (a camera whip)
  //   punch: A punches in (scale up, radial blur) through a cream flash into B settling from 1.25x
  //   slam:  hard cut at u = 0.5 with a decaying shake + flash (for kicks)
  trans(kind, a, b, u, { dir = [1, 0], out = null, taps = 14, flash = '#f4e6d0' } = {}) {
    const e = easeIO(u), v = Math.sin(Math.PI * clamp(u));
    if (kind === 'whip') {
      const d = Math.hypot(...dir), dx = dir[0] / d, dy = dir[1] / d;
      return this.comp([
        { src: a, blend: 'copy', x: -dx * e, y: -dy * e, blur: [dx * v * 0.2, dy * v * 0.2], taps },
        { src: b, blend: 'over', opaque: true, x: dx * (1 - e), y: dy * (1 - e), blur: [dx * v * 0.2, dy * v * 0.2], taps },
      ], { out });
    }
    if (kind === 'punch') {
      const pre = u < 0.5, k = pre ? u / 0.5 : (u - 0.5) / 0.5;
      const L = pre ? [{ src: a, blend: 'copy', scale: 1 + 1.6 * k * k, zoomBlur: 0.9 * k, taps }]
        : [{ src: b, blend: 'copy', scale: 1 + 0.25 * Math.pow(1 - k, 3), zoomBlur: 0.5 * Math.pow(1 - k, 2), taps }];
      const fl = Math.max(0, 1 - Math.abs(u - 0.5) / 0.14);
      if (fl > 0) L.push({ color: flash, opacity: fl * 0.7 });
      return this.comp(L, { out });
    }
    const k = u < 0.5 ? a : b, age = Math.max(0, u - 0.5) * 12, sh = u >= 0.5 ? Math.exp(-age * 2) : 0;
    const L = [{ src: k, blend: 'copy', scale: 1 + 0.06 * sh, x: 0.02 * sh * Math.sin(age * 9), y: 0.012 * sh * Math.cos(age * 13) }];
    if (u >= 0.5 && age < 1) L.push({ color: flash, opacity: 0.5 * (1 - age) });
    return this.comp(L, { out });
  }
}
function setPx(fx, pr, res) { const gl = fx.gl; gl.useProgram(pr.p); if (pr.u.uPxS != null) gl.uniform1f(pr.u.uPxS, 1 / res); }

// 2D helpers for scenes ------------------------------------------------------------------
// Multiply-stack N copies of a canvas with offsets/mirrors (cheap 2D crowd; no GL)
export function stack2d(ctx, img, layers) {
  for (const { x = 0, y = 0, s = 1, flip = false, op = 'multiply', alpha = 1 } of layers) {
    ctx.save(); ctx.globalCompositeOperation = op; ctx.globalAlpha = alpha;
    ctx.translate(W / 2 + x, H / 2 + y); ctx.scale(flip ? -s : s, s); ctx.drawImage(img, -W / 2, -H / 2, W, H); ctx.restore();
  }
}
export { clamp };
