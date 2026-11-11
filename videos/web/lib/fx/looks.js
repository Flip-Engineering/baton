// LOOKS: one call, one complete art-directed finish (LOOKS studio, cycle 1).
//
// A look is a recipe, not a filter. Every look starts from a VALUE PLAN (designed separations, Dow's notan) built from
// the scene's own masks, then prints / exposes those plates in one medium: palette, paper, press or film, grain, edge
// treatment, cadence (twos), type in the look's own ink, its own transition and its own impact frame.
//
//   import { Looks } from '../lib/fx/looks.js';
//   const lk = new Looks();                                    // shares one print.js GL context (paper, noise, presses)
//   lk.source({ color, aux, glow, shape, type, stamp, depth: [near, far] }, key);   // canvases / images; key skips re-uploads
//   lk.apply(ctx, 'KLUTSIS', t, { kick, hit, fps: 30 });       // -> finished frame drawn into ctx
//   lk.transition(ctx, 'SODIUM', 'KLUTSIS', t, u, { ... });   // incoming look owns the transition (plate slide, tear...)
//   lk.impactFrame(t, hitT) -> 0 (none) | 1..n                  // frame index relative to the hit: lands ON the hit frame
//
// Inputs (all optional except color):
//   color  the render (1080x1920 canvas / image)
//   aux    540x960 RGB: R,G = 16-bit log view depth (65535 = sky), B = class (0 ground, 64 far mass, 128 mid structure,
//          180 spot object (flag, banner), 255 subject). web/looks_bake.mjs writes it from a lab; a 2D scene draws it.
//          Without aux the plan falls back to 3-value k-means-like luma thresholds (still a plan, not a filter).
//   glow   grey: steam / plume / smoke coverage (printed as paper, lit mass or screen, per look)
//   shape  grey: the look's designed spot shape (disc, 30-degree band, wedge) - the red plate is a SHAPE, never a grade
//   type   RGBA, type set black on clear; printed in the look's own ink (never glow, never neon, never fringe)
//   stamp  RGBA, seal / stamp art (INTAGLIO's impact prints it in red)
//
// Kill list, enforced by the recipes (research/capabilities/looks.md): bloom halos on silhouettes (halation is
// threshold-only and never crosses a key mass), neon / emissive type, macroblock glitch, the exposure-lift "flash"
// (impacts are a different IMAGE: plate alone, invert, negative, burn), chromatic fringe on type, screen patterns that
// swim (print looks move on twos and boil at 6-12 fps), more than one medium per beat.
import { Print, INKS, registerPrintPass } from './print.js';

const hx = h => { h = INKS[h] || h; const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

// ------------------------------------------------------------------ recipes (data)
// cls: value per class for the plan (0 = paper / light, 1 = full key ink). Classes: sky, far, mid, ground, subject.
// work: detail only on the subject (+ falloff); outside it the masses print flat (economy: Dow, CIV's MORE RAILS.)
export const LOOKS = {
  KLUTSIS: { medium: 'print', paper: 'cream', twos: true, boil: 6, inks: { key: '#15110e', spot: '#bd1818' },
    cls: { sky: 0, far: 0.55, mid: 1, ground: 1, subject: 1 }, cut: 1.6, cutSky: 1, trans: 'slide', impact: 3,
    owners: ['HORDE', 'THE GIANT'], note: 'photomontage: cut-outs with a paper keyline and a board shadow, the red plate a shape' },
  SERIGRAPH: { medium: 'print', paper: 'cream', twos: true, boil: 6,
    inks: { p1: '#e3a93f', p2: '#b8432e', p3: '#34425a', p4: '#1b1714' },
    cls: { sky: 0.45, far: 0.75, mid: 1, ground: 1, subject: 1 }, cut: 1.2, cutSky: 0, trans: 'squeegee', impact: 4,
    owners: ['COMMON WEALTH', '1776 inserts'], note: 'WPA silkscreen: 4 opaque plates light to dark, stepped gradients, plate gaps' },
  INTAGLIO: { medium: 'press', paper: 'cotton', twos: false, boil: 0, inks: { key: '#1c3a2e', spot: '#b31b22' },
    grey: { sky: 0.97, plume: 0.9, light: 1, far: 0.62, keyFlat: 0.2, keyLo: 0.12, keyHi: 0.78, ground: 0.4, spot: 0.55 },
    cut: 1.4, cutSky: 0, trans: 'iris', impact: 3, owners: ['PEOPLES BANK'], note: 'banknote engraving, burin lines on the subject only, red letterpress seal' },
  RISO: { medium: 'print', paper: 'newsprint', twos: true, boil: 6, inks: { a: '#f15060', b: '#1a1a1a' },
    cls: { sky: 0, far: 0.5, mid: 1, ground: 1, subject: 1 }, cut: 1.2, cutSky: 0, trans: 'feed', impact: 5,
    owners: ['RED WEDGE', 'THE MAJORITY'], note: 'two drums, fluoro red + black, stochastic grain, kick-driven misregistration' },
  NEWSREEL: { medium: 'film', twos: false, cls: { sky: 0, far: 0.5, mid: 1, ground: 1, subject: 1 }, val: { sky: 0.84, far: 0.42, subject: 0.06, ground: 0.12 },
    cut: 0, trans: 'splice', impact: 3, owners: ['IRON IS HOT', 'POLITICAL ECONOMY'], note: '35 mm orthochromatic print: reds print black, skies burn white' },
  BROADSIDE: { medium: 'press', paper: 'rag', twos: true, boil: 6, inks: { key: '#23160f', spot: '#bd1818' },
    grey: { sky: 1, plume: 1, light: 1, far: 0.55, keyFlat: 0.05, keyLo: 0.05, keyHi: 0.5, ground: 0.2, spot: 0.5 },
    cut: 2.2, cutSky: 0, trans: 'tear', impact: 2, owners: ['1776', 'HORDE (chronicle beat)'], note: 'two-block woodcut on rag: carved white contour between forms' },
  SODIUM: { medium: 'film', twos: false, cls: { sky: 0, far: 0.5, mid: 1, ground: 1, subject: 1 },
    cut: 0, trans: 'burn', impact: 2, owners: ['OWN THE FUTURE', 'COMMON WEALTH (storm)', 'THE GIANT (night)'],
    note: '2383-style print: density blacks, one flat sky value, sodium sources, threshold halation that never crosses a silhouette' },
  NOTAN: { medium: 'print', paper: 'ivory', twos: false, boil: 0, inks: { key: '#0d0c0b', spot: '#c91f37' },
    cls: { sky: 1, far: 0.62, mid: 1, ground: 1, subject: 1 }, cut: 1.3, cutSky: 1, trans: 'sweep', impact: 1,
    owners: ['MELTDOWN', 'ACCELERATE', 'ACC IDENT'], note: '1-bit with blue-noise mids, exactly one spot red owned by the meaning' },
};
// LOOKS c2: the rank ladder (Masereel / Ward: each rank its own value, a carved gap between, never an outline round a
// body) and the look's own sky. ladder = ink coverage of ranks 0 (nearest) .. 3+ in the look's own medium; gnd = the one
// flat ground value; disc = this look may keep a disc behind a crowd (budget: two looks). Read only in ladder mode
// (source({ ranks }) / source({ sky: 'designed' })); c1 behaviour is unchanged without them.
const C2 = {
  KLUTSIS:   { ladder: [1, 0.72, 0.34, 0.15], gnd: 0, disc: true },      // c2b: round dots; the 40-60% band (where dots join) avoided      // dot density (the band is its shape)
  SERIGRAPH: { ladder: [4, 3, 2, 1], gnd: 0, disc: false },               // plate order: ink, slate, brick, ochre
  INTAGLIO:  { ladder: [0.0, 0.22, 0.42, 0.6], gnd: 0.93, disc: false }, // planned grey -> hatch density
  RISO:      { ladder: [1, 0.55, 0.9, 0.42], gnd: 0, disc: false },       // black solid, black grain, red solid, red grain
  NEWSREEL:  { ladder: [0.06, 0.28, 0.5, 0.68], gnd: 0.2, disc: false },  // exposure per rank
  BROADSIDE: { ladder: [0.04, 0.34, 0.5, 0.64], gnd: 0.97, disc: false }, // planned grey -> gouge thinning
  SODIUM:    { ladder: [0.22, 0.31, 0.41, 0.52], gnd: 0.62, disc: false },  // c2b: amber-lit ranks over a lit pool (hero mode)
  NOTAN:     { ladder: [1, 0.62, 0.36, 0.16], gnd: 0, disc: true },      // c2b: line-tint share per rank       // dither density; no rim outlines
};
for (const k in C2) Object.assign(LOOKS[k], { c2: C2[k] });
export const LOOK_NAMES = Object.keys(LOOKS);

// ------------------------------------------------------------------ GLSL (appended after print.js HEAD)
// texture slots (print.js _pass): SRC colour, AN aux, AB glow, MASK shape, SUBJ type, AUXN stamp, ORIG plan, AUXU plan2,
// BELOW look A (transitions) or a press result, PAPER stock, NZ noise
const LK = `
uniform vec3 ZOOM; uniform float IMP, KICK, FRN, CUTSKY, RANKCUT, SKYD, DISC, GNDV; uniform vec2 AUXR; uniform vec3 ANCH; uniform vec4 RNK, LAD; uniform vec3 SCR; uniform vec2 RKO0, RKO1, RKO2, RKO3;   // anchor: the source's spot centre + radius (1080 px, y up)
vec2 vuv(vec2 uv){ return (uv-.5)/ZOOM.x+.5+ZOOM.yz; }
float cov(float f){ float w=fwidth(f)*.8+1e-3; return smoothstep(.5-w,.5+w,f); }
float covS(float f, float s){ return smoothstep(.5-s,.5+s,f); }
float ign(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(.06711056,.00583715)))); }   // interleaved gradient noise (blue-ish, stable)
float starve(vec2 p, float k){ return 1.-k*(1.-smoothstep(.22,.62,fbmT(p*.55+SEED*7.)))*(.6+.4*nT(p*.08)); }
vec3 rgbOf(vec2 uv){ return texture(SRC, vuv(uv)).rgb; }
float typeA(vec2 uv){ return texture(SUBJ, uv).a; }
float tzAt(vec2 uv){ return smoothstep(.3,.7,texture(AN,uv).r); }          // tonal zone (plan3): screen the tone, never a slab
// c2 ladder mode (RNK.w = 1): the rank of a figure texel (0 = nearest), -1 off the figures; its ladder value
float rkAt(vec2 uv){ if(RNK.w<.5) return -1.; float b=texture(AN,uv).b; return b<.0625?-1.:floor(b*8.+.5)-1.; }
float ladV(float r){ return r<.5?LAD.x: r<1.5?LAD.y: r<2.5?LAD.z: LAD.w; }
// screens pinned to the thing they print on (Obra Dinn / Spider-Verse): the shot's screen frame SCR (origin, scale) and
// each rank card's own offset, so dots ride with the card instead of swimming over it
vec2 rko(float r){ return r<-.5?vec2(0.): r<.5?RKO0: r<1.5?RKO1: r<2.5?RKO2: RKO3; }
vec2 spx(vec2 px, float r){ return (px-SCR.xy-rko(r))/max(SCR.z,1e-3); }
float gndAt(vec2 uv){ return RNK.w>.5 ? texture(AN,uv).g*step(rkAt(uv),-.5) : 0.; }   // the ground class (flat in ladder mode)
// c2b: THE LOOK PRINTS THE SUBJECT. HERO (source({ hero })): the look passes read the hero plate (lk_tone, bound to AB):
// R = the hero's tone (0 shadow .. 1 lit: the lit render when the scene gives one, else the silhouette inflated into a
// pillow and lit from HL), G = the hero's coverage, B = its pillow height (0 at the edge .. 1 deep inside), A = the
// cut-paper margin (a dilated hero). Each medium turns T into its own marks (gravure dots, burin lines, gouges, drums,
// plates, an exposure, amber); NOTAN alone keeps a solid black hero.
uniform float HERO, TGUARD; uniform vec4 HL;
float heroM(vec2 uv){ if(HERO<.5) return 0.; float g=texture(AB,uv).g, w=fwidth(g)*.8+1e-3; return smoothstep(.5-w,.5+w,g); }
float heroMs(vec2 uv){ return HERO>.5 ? texture(AB,uv).g : 0.; }
float heroT(vec2 uv){ return texture(AB,uv).r; }
float heroH(vec2 uv){ return texture(AB,uv).b; }
float heroE(vec2 uv){ return HERO>.5 ? texture(AB,uv).a : 0.; }
// a real AM screen: round dots that grow with tone on a rotated grid; past 50% the paper shows as round holes (never
// the cos+cos checkerboard); dot gain spreads each edge by ~0.6 px. v = ink coverage, cell in px (at 1080), a radians
float amDot(vec2 p, float v, float cell, float a){
  if(v<.015) return 0.; if(v>.985) return 1.;
  float c=cos(a), s=sin(a); vec2 q=mat2(c,s,-s,c)*p/cell; float aa=.75/cell, g=.6/cell;
  if(v<=.5){ float r=sqrt(v/3.14159)+g; return 1.-smoothstep(r-aa,r+aa,length(fract(q)-.5)); }
  float r=max(sqrt((1.-v)/3.14159)-g,0.); return smoothstep(r-aa,r+aa,length(fract(q+.5)-.5)); }
// a 1-bit line tint (NOTAN's ranks: ruled, never dithered): v = ink share of each rule
float lineTint(vec2 p, float v, float pitch, float a){ if(v<.02) return 0.; if(v>.98) return 1.;
  float d=abs(fract(dot(p, vec2(-sin(a),cos(a)))/pitch)-.5)*2.; float aa=1.2/pitch; return 1.-smoothstep(v-aa, v+aa, d); }
// type guard (c2b): the words are never cut by the subject. Around each glyph (a ~10 px margin) the key masses yield to
// paper, so a letter over the hammer prints whole instead of splitting into ink and knock-out halves
float tGuard(vec2 uv){ if(TGUARD<.5) return 0.; return smoothstep(.03,.14,textureLod(SUBJ,uv,3.2).a); }
`;

// PLAN (at aux res): R key mass, G tone, B spot, A keyline cut.   PLAN2: R subject, G far, B plume, A sky
const PLAN_COMMON = `uniform vec4 CW; uniform float CWS, LNR, KT, CUTR, HASAUXI; uniform vec3 LVL;
float dAt(ivec2 p){ ivec2 s=textureSize(AN,0); p=clamp(p,ivec2(0),s-1); vec3 a=texelFetch(AN,p,0).rgb; return (a.r*65280.+a.g*255.)/65535.; }
float cAt(ivec2 p){ ivec2 s=textureSize(AN,0); p=clamp(p,ivec2(0),s-1); return texelFetch(AN,p,0).b*255.; }
ivec2 toAux(vec2 uv){ vec2 v=vuv(uv); v.y=v.y; return ivec2(floor(v*AUXR)); }
float massOf(float c, float d){ if(d>.99999) return CW.x*0.; return c>220.?CW.w: c>150.?CWS: c>96.?CW.z: c>32.?CW.y: CW.x; }
float toneAt(vec2 uv){ float l=lum(textureLod(SRC, vuv(uv), 1.).rgb); return pow(clamp((l-LVL.x)/max(LVL.y-LVL.x,1e-3),0.,1.), LVL.z); }
`;
const FS_PLAN = PLAN_COMMON + `uniform float SKYV; uniform vec4 TONAL;
void main(){ vec2 uv=gl_FragCoord.xy/R; float tone=toneAt(uv);
  if(HASAUXI<.5){ float k=1.-smoothstep(.3,.36,tone); o=vec4(k, tone, 0., 0.); return; }
  ivec2 ip=toAux(uv); float d=dAt(ip), c=cAt(ip), sky=step(.99999,d);
  float key=sky>.5?SKYV:massOf(c,d);
  float spot=(sky<.5 && c>150. && c<220.)?1.:0.;
  // keyline: this texel is the FAR side of a depth step (a nearer surface within CUTR aux px) -> paper cut
  float cut=0.;
  float tzc = c>220.?TONAL.w: c>150.?0.: c>96.?TONAL.z: c>32.?TONAL.y: TONAL.x;
  if(CUTR>0. && (sky<.5 || CUTSKY>.5) && (sky>.5 || tzc<.5 || RANKCUT>.5)){ float lz=sky>.5?1e9:d*LNR;   /* RANKCUT (HUMAN c3): a ranked crowd's aux is flat per rank, so tonal ranks cut too */
    for(int j=0;j<16;j++){ float a=float(j)*.3927; float r=CUTR*(j<8?1.:.55); vec2 off=vec2(cos(a),sin(a))*r*(j<8?1.:1.)+(j<8?vec2(0.):vec2(cos(a+.2),sin(a+.2))*.0);
      ivec2 q=ip+ivec2(round(off)); float dq=dAt(q); if(dq>.99999) continue;
      if(lz-dq*LNR>KT){ cut=1.; break; } } }
  if(RNK.w>.5){ cut=0.;   /* c2 ladder: the gap is carved only in a FARTHER rank's figure where a nearer rank's figure overlaps it (heads and
                             shoulders), never against the ground (the picket-fence legs) and never round a body standing on the sky */
    if(CUTR>0. && sky<.5 && c>150.) for(int j=0;j<16;j++){ float a=float(j)*.3927; vec2 off=vec2(cos(a),sin(a))*CUTR*(j<8?1.:.55);
      ivec2 q=ip+ivec2(round(off)); float dq=dAt(q); if(dq>.99999 || cAt(q)<150.) continue;
      if((d-dq)*LNR>KT){ cut=1.; break; } } }
  o=vec4(key, tone, spot, cut); }`;
const FS_PLAN3 = PLAN_COMMON + `uniform vec4 TONAL;
void main(){ vec2 uv=gl_FragCoord.xy/R; if(HASAUXI<.5){ o=vec4(0.); return; }
  ivec2 ip=toAux(uv); float d=dAt(ip), c=cAt(ip); if(d>.99999){ o=vec4(0.); return; }
  float tz = c>220.?TONAL.w: c>150.?0.: c>96.?TONAL.z: c>32.?TONAL.y: TONAL.x;
  float rk=0.; if(RNK.w>.5 && c>150.){ tz=0.; rk=(clamp(floor((d-RNK.x)/max(RNK.y-RNK.x,1e-4)*RNK.z+.5),0.,6.)+1.)/8.; }   // c2: rank code, figures print from the ladder
  o=vec4(tz, c<32.?1.:0., rk, 1.); }`;
const FS_PLAN2 = PLAN_COMMON + `
void main(){ vec2 uv=gl_FragCoord.xy/R; vec2 v=vuv(uv);
  float gl=texture(AB, v).r;
  if(HASAUXI<.5){ o=vec4(0.,0.,gl,0.); return; }
  ivec2 ip=toAux(uv); float d=dAt(ip), c=cAt(ip), sky=step(.99999,d);
  o=vec4(c>220.?1.:0., (c>32.&&c<96.)?1.:0., gl, sky); }`;

// c2b hero plate: pass 1 (lk_hmask) the hero's coverage, pass 2 (lk_tone) its tone, pillow height and paper margin.
// The hero is rank 0 of a ranked crowd (the close man, the far hand) or, without ranks, the subject class. A lit
// render of the hero (source({ tone })) arrives in AUXN; without one the silhouette is inflated and lit from HL.
const FS_HMASK = PLAN_COMMON + `uniform float HASTONE, HRANK;
void main(){ vec2 uv=gl_FragCoord.xy/R; float m=0.;
  if(HASAUXI>.5){ ivec2 ip=toAux(uv); float d=dAt(ip), c=cAt(ip);
    if(d<.99999 && c>220.){ if(RNK.w>.5 && HRANK>-.5){ float rk=clamp(floor((d-RNK.x)/max(RNK.y-RNK.x,1e-4)*RNK.z+.5),0.,6.); m=step(abs(rk-HRANK),.1); } else m=1.; } }
  float st=lum(textureLod(SRC, vuv(uv), 1.).rgb);
  float ut=HASTONE>.5 ? lum(textureLod(AUXN, vuv(uv), 2.6).rgb) : 0.;   // a touch of blur: a live night render's dither must not become the tone
  o=vec4(m, st, ut*m, 1.); }`;
const FS_TONE = `uniform float HASTONE; uniform vec4 HLT;
float hq(vec2 uv){ return (textureLod(ORIG,uv,2.).r*.3+textureLod(ORIG,uv,3.3).r*.4+textureLod(ORIG,uv,4.6).r*.3); }
void main(){ vec2 uv=gl_FragCoord.xy/R; vec4 m0=texture(ORIG,uv); float m=m0.r;
  vec2 e=4./R; float h=hq(uv);
  float gx=hq(uv+vec2(e.x,0.))-hq(uv-vec2(e.x,0.)), gy=hq(uv+vec2(0.,e.y))-hq(uv-vec2(0.,e.y));
  vec3 n=normalize(vec3(-gx*HLT.w, -gy*HLT.w, 1.)); vec3 L=normalize(vec3(HLT.x, HLT.y, .75));
  float lam=clamp(dot(n,L),0.,1.);
  float pillow=.72*smoothstep(.5,.62,lam)+.28*smoothstep(.2,1.,lam);   // a hard terminator (poster modelling), not an emboss                                       // the silhouette as a lit form (inflated)
  float rim=smoothstep(.3,.75,m0.g);                                           // the render's own rim light stays the brightest value
  vec4 mm=textureLod(ORIG,uv,9.); float mean=mm.b/max(mm.r,1e-3);           // the lit render auto-levelled inside the hero
  float lt=pow(smoothstep(mean*.45, mean*3.,  m0.b),1.1);                    /* keyed low: the figure stays a dark mass, the light only on the planes that face the key (a pale auto-level made the clothed figure read naked) */
  float T = HASTONE>.5 ? clamp(lt*.78+pillow*.22,0.,1.) : max(pillow*.8+.06*h, rim*.9);
  T = max(T, rim*HLT.z);
  float edge=smoothstep(.04,.14,textureLod(ORIG,uv,2.4).r);                   // the cut-paper margin (~8 px round the hero)
  o=vec4(T, textureLod(ORIG,uv,.7).r, h, edge); }`;

// planned grey for the press looks (INTAGLIO engrave, BROADSIDE woodcut): the value plan as a photograph the press reads
const FS_PGREY = `uniform vec4 GA, GB; uniform float GSPOT;
void main(){ vec2 uv=gl_FragCoord.xy/R; vec4 p=texture(ORIG,uv), q=texture(AUXU,uv);
  float work=smoothstep(.05,.45,textureLod(AUXU,uv,4.).r);
  float rk=rkAt(uv);
  float lt=smoothstep(.72,.92,lum(rgbOf(uv)))*step(rk,-.5)*(1.-q.a*SKYD);
  float key=cov(p.r), cut=cov(p.a), sky=q.a, far=q.g, plume=q.b;
  float g=mix(GB.y, GB.z, smoothstep(.05,.8,p.g));                       // tonal key where the work is
  g=mix(GB.x, g, work);
  float v=mix(GB.w, g, key);                                               // ground vs key mass
  v=mix(v, GA.w, far*(1.-work));
  v=mix(v, mix(.08,.96,smoothstep(.22,.75,p.g)), tzAt(uv));
  v=mix(v, GA.x + (1.-GA.x)*.0, sky);
  v=mix(v, GSPOT, cov(p.b));
  v=mix(v, mix(GA.y*.8, GA.y, p.g), smoothstep(.15,.6,plume)*(1.-key*.7));
  v=mix(v, GA.z, lt*(1.-sky));
  if(rk>-.5) v=rk<.5 ? min(v, ladV(rk)+.25*work) : ladV(rk);             // c2 ladder: a planned grey per rank (the press turns it into line density)
  if(gndAt(uv)>.5) v=GNDV;
  v=mix(v, 1., cut);
  o=vec4(vec3(clamp(v,0.,1.)),1.); }`;

// ---- the looks
const FS_KLUTSIS = `uniform vec3 IK, IS; uniform vec2 KOFF; uniform float SHL, EVT, PEEL;
float dotScreen(vec2 p, float v, float cell){ if(HERO>.5 || RNK.w>.5) return amDot(p, v, cell*1.6, .785);   // c2b: round AM dots, 10 px cells
  float ca=.7071; mat2 m=mat2(ca,ca,-ca,ca); vec2 q=m*p/cell; float sp=.5*(cos(6.2831*q.x)+cos(6.2831*q.y));
  float th=(1.-2.*v)*1.1; float aa=6.2831/cell*.9; return smoothstep(th-aa,th+aa,sp)*step(.02,v); }
void main(){ vec2 uv=gl_FragCoord.xy/R, px=gl_FragCoord.xy/S; vec4 pp=paper(uv);
  vec2 ko=KOFF*S/R;
  vec4 P=texture(ORIG,uv+ko), P0=texture(ORIG,uv), Q=texture(AUXU,uv+ko);
  float work=smoothstep(.05,.45,textureLod(AUXU,uv,4.).r);
  float key=cov(P.r), cut=cov(P0.a), plume=Q.b;
  vec2 bn=vec2(-.5,.866); float bd=abs(dot(px-ANCH.xy, bn))-ANCH.z*.95; float band=1.-smoothstep(-.8,.8,bd);
  float red=max(band*mix(1.,DISC,SKYD), cov(P0.b));
  float rk=rkAt(uv+ko);
  float lt=smoothstep(.72,.92,lum(rgbOf(uv+ko)))*(1.-Q.a)*step(rk,-.5);      // c2: no rim light carved out of a rank (the outline ban)
  // gravure dot in the mids of the key plate, on the subject only
  float mids=(RNK.w>.5?smoothstep(.5,.8,P.g):smoothstep(.12,.55,P.g))*work*key*(rk>.5?0.:1.);
  float k=key*(1.-mids*(1.-dotScreen(spx(px,rk), 1.-P.g*.85, 6.5)));
  float tz=tzAt(uv+ko);
  k=mix(k, dotScreen(spx(px,-1.), clamp(1.-smoothstep(.22,.75,P.g),0.,1.)*.96, 6.5), tz);
  if(rk>.5) k=key*dotScreen(spx(px,rk), ladV(rk), 6.5-.6*rk);                   // c2 ladder: every rank back a step lighter in dot density
  float gd=gndAt(uv+ko); if(gd>.5) k=GNDV>0.?dotScreen(spx(px,-1.),GNDV,6.5):0.; // one flat ground
  k=max(k*(1.-lt), dotScreen(spx(px,-1.)+3., plume*.28, 6.5)*(1.-key));        // steam: a light gravure tint, never a glow
  // c2b: the hero is a cut photograph: the lit render as photo-gravure (round dots, 11 px, 45 deg), trimmed with a
  // paper margin that sits on the board and casts its shadow; the red band runs UNDER it
  float hm=heroM(uv+ko), he=heroE(uv+ko);
  if(he>.01){ float T=heroT(uv+ko); float inkv=clamp(1.-T*.85,0.,1.); inkv=inkv*inkv*(3.-2.*inkv);
    float hk=amDot(spx(px,-1.)*1., mix(.1,.97,inkv), 11., .785);
    k=mix(k*(1.-step(.5,he)), hk, hm); red*=1.-step(.5,he); }
  float T=typeA(uv), tg=tGuard(uv);
  k*=1.-tg*(1.-T); red*=1.-tg*(1.-T)*step(.5,key);                              // c2b: the words sit on paper, never cut by a mass
  if(IMP>.5 && IMP<1.5){ if(EVT>.5){ float fig=cov(P0.r)*(1.-texture(AN,uv).g)*(1.-gndAt(uv)); fig=max(fig, step(.5,heroE(uv)));
      red=1.-fig; k=0.; } else { red=1.; k=key*(1.-lt); } }
  if(EVT>.5 && PEEL>-1.5 && IMP>1.5){   // c2b: after the hold the red flood PEELS off along the band axis (paper edge, lifted lip) while the black walks in
    vec2 dir=normalize(vec2(.866,.5)); float span=dot(R/S,abs(dir))*.5+60.; float e=dot(px-R/S*.5, dir)-mix(-span, span, PEEL);
    float fig=cov(P0.r)*(1.-texture(AN,uv).g)*(1.-gndAt(uv)); fig=max(fig, step(.5,heroE(uv)));
    float fl=step(0.,e)*(1.-fig); red=max(red, fl); if(e>0. && e<7.) red*=.72; }   // impact 1 (c2b): the composed red plate: red on EVERYTHING but the figures, which print as paper
  // board shadow of the cut-outs (paper lifted off the board); SHL lengthens it while the board lifts (anticipation)
  float shm=max(cov(texture(ORIG,uv+ko+vec2(-7.,9.)*SHL*S/R).r), step(.5,heroE(uv+ko+vec2(-7.,9.)*SHL*S/R)));
  float sh=shm*(1.-key)*(1.-step(.5,he));
  vec3 col=pp.rgb*(1.-.18*min(2.,SHL*.8)*sh);
  float kr=red*(1.-cut*(1.-step(.5,IMP)*step(IMP,1.5)*EVT))*starve(px,.35);
  col=inkOn(col, IS, kr);
  float kk=clamp(k*(1.-cut),0.,1.);
  kk = TGUARD>.5 ? max(kk, T) : max(kk*(1.-T), T*(1.-kk));                          // type: key ink (c2b: always whole ink on paper)
  if(IMP>.5 && IMP<1.5 && EVT>.5) kk=T;
  col=inkOn(col, IK, kk*starve(px+11.,.25));
  o=fin(col,uv); }`;

const FS_SERIGRAPH = `uniform vec3 I1, I2, I3, I4; uniform vec4 SKYB; uniform float EVT, SQG, MIS; uniform vec4 SQ, SQM; uniform vec2 SQD; uniform float BW;
float lev(vec2 uv){ vec4 P=texture(ORIG,uv), Q=texture(AUXU,uv); float key=cov(P.r), cut=cov(P.a);
  float y=uv.y; float rk=rkAt(uv);
  // stepped sky: source tone + height, quantised into 4 bands with a hand-cut wobble. c2 designed sky (SKYD): height
  // only, 4 steps from a designed palette, the edge cut by hand (low-frequency wander, no flag-colour smears)
  float s=SKYD>.5 ? clamp(1.-(y-.44)*1.9,0.,1.)+.022*(nT(vec2(gl_FragCoord.x/S*.0022,y*2.+SEED))-.5)+.006*(nT(gl_FragCoord.xy/S*vec2(.03,.2))-.5)
                  : clamp(1.-(y-.42)*1.55 + (P.g-.4)*.25, 0., 1.)+ .035*(nT(gl_FragCoord.xy/S*vec2(.004,.03)+SEED)-.5);
  float skyL = s>SKYB.x?0.: s>SKYB.y?1.: s>SKYB.z?2.: 3.;
  if(HERO>.5 && SKYD>.5) skyL = s<.45?1.: s<.62?2.: s<.8?3.: 0.;   // c2b: the type field is the ochre step (ink words), slate holds the horizon
  float L = Q.a>.5 ? skyL : 3.;
  L = mix(L, 2., Q.g);                                  // far rows: slate becomes brick-slate mid plate
  float sun=texture(MASK, vuv(uv)).r*mix(1.,DISC,SKYD); if(Q.a>.5 && sun>.5) L=0.;
  L = key>.5 ? 4. : L;
  float tz=tzAt(uv); if(tz>.5) L = RANKCUT>.5 ? (P.g>.66?1.: P.g>.44?2.: P.g>.2?3.: 4.) : (P.g>.62?1.: P.g>.3?3.: 4.);   // RANKCUT (HUMAN c3): ranks step through all four plates
  if(rk>-.5) L=ladV(rk);                                  // c2 ladder: ink, slate, brick, ochre from the front rank back
  if(gndAt(uv)>.5) L=GNDV;                                // one flat ground plate
  float pl=Q.b; if(pl>.45) L=0.; else if(pl>.18) L=min(L,1.);
  if(cov(P.b)>.5) L=2.;                                   // spot objects: the brick plate
  float lt=smoothstep(.75,.9,lum(rgbOf(uv)))*(1.-Q.a)*step(rk,-.5); if(lt>.5) L=1.;
  if(cut>.5 && L>=3.) L=1.;                                // keyline printed as the ochre gap
  if(cut>.5 && RNK.w>.5) L=0.;                             // c2: the carved gap is paper
  if(heroM(uv)>.5){ float hT=heroT(uv); L = hT>.62 ? 1. : hT>.34 ? 2. : 4.; }   // c2b: the hero in three plates (key light ochre, mid brick, shadow ink)
  else if(heroE(uv)>.5 && HERO>.5) L=0.;                                         // its paper trap
  if(HERO>.5){ float T=typeA(uv); if(tGuard(uv)>.5 && L>=3.5) L=0.; if(T>.5) L=4.; return L; }   // c2b: the words are the ink key, on paper
  float T=typeA(uv); if(T>.5) L = L>=(RNK.w>.5||SKYD>.5?2.5:3.5) ? 0. : 4.;
  return L; }
float mesh(vec2 p){ vec2 q=abs(fract(mat2(.7071,.7071,-.7071,.7071)*p/3.6)-.5); return max(1.-smoothstep(.08,.2,q.x), 1.-smoothstep(.08,.2,q.y)); }
void main(){ vec2 uv=gl_FragCoord.xy/R, px=gl_FragCoord.xy/S; vec4 pp=paper(uv); vec3 col=pp.rgb;
  vec2 o1=vec2(1.5,-1.)*MIS*S/R, o2=vec2(-1.2,1.4)*MIS*S/R, o3=vec2(2.,.8)*MIS*S/R, o4=vec2(-.6,-1.8)*MIS*S/R;
  float streak=.94+.06*nT(vec2(px.x*.004,px.y*.35)+SEED);
  float c1=step(.5,lev(uv+o1)), c2=step(1.5,lev(uv+o2)), c3=step(2.5,lev(uv+o3)), c4=step(3.5,lev(uv+o4));
  if(HERO>.5){ // c2b: every plate prints ONLY its own shapes (no ochre/brick underbase peeking out as a fringe); the
    // misregistration leaves a hairline paper gap, and the darker plate traps 1 px over the lighter one
    float l1=lev(uv+o1), l2=lev(uv+o2), l3=lev(uv+o3);
    c1=step(.5,l1)*step(l1,1.5); c2=step(1.5,l2)*step(l2,2.5); c3=step(2.5,l3)*step(l3,3.5); }
  // impact: the brick plate printed alone for 2 frames, then the others land one per frame (ochre, slate, ink)
  if(IMP>.5){ if(IMP<2.5) c1=0.; if(IMP<3.5) c3=0.; c4=0.; }
  float yT=1.-uv.y, wob=.004*(nT(vec2(px.x*.01,SEED*3.))-.5), fresh=1.;
  if(EVT>.5){   // c2 squeegee: each plate is deposited only through its own stencil, behind its pull's front
    float y=yT+wob; c1*=step(y,SQ.x); c2*=step(y,SQ.y); c3*=step(y,SQ.z); c4*=step(y,SQ.w)*SQG;
    fresh=step(y,SQ.x); }
  col=mix(col, I1*streak, c1*.96);
  col=mix(col, I2*streak, c2*.97);
  col=mix(col, I3*streak, c3*.97);
  col=mix(col, I4*(.97+.03*streak), c4*.98);
  col*=.97+.03*smoothstep(.2,.8,pp.a);
  if(EVT>.5){
    if(fresh<.5) col=texture(BELOW,uv).rgb;                                  // ahead of the first pull: the outgoing sheet
    col*=1.-SQM.x*.16*mesh(px);                                               // the screen is down: the mesh over the sheet
    if(SQD.y>.5){ float by=SQM.y*R.y/S, d=(yT*R.y/S-by)*SQD.x;                 // d > 0 ahead of the blade (px)
      vec3 bi=SQM.z<1.5?I1:SQM.z<2.5?I2:SQM.z<3.5?I3:I4;
      float bead=1.-smoothstep(SQM.w-2.,SQM.w,d); bead*=step(0.,d); float hz=(d-SQM.w*.35)/(SQM.w*.18+.5), hl=exp(-hz*hz);
      col=mix(col, bi*(.8+.35*hl)+.25*hl, bead*.97);                            // the rolling bead of this plate's ink
      float bl=step(-BW,d)*step(d,0.);                                           // the rubber blade (c2b: 32 px), its edge catching light
      col=mix(col, mix(mix(vec3(.62,.2,.1), vec3(.09,.085,.09), smoothstep(-BW,-BW*.6,d)), vec3(.55,.52,.5), smoothstep(-5.,-1.,d))*(.9+.1*nT(vec2(px.x*.05,1.))), bl);   // rubber (red), holder (black), lit edge
      col*=1.-.35*step(d,-BW)*exp(min(0.,(d+BW)/14.));                               // the blade's shadow on the sheet behind it (c2b: min() - exp overflowed to inf, 0*inf = NaN = the black sheet)
    } }
  o=fin(col,uv); }`;

const FS_RISO = `uniform vec3 IA, IB; uniform vec2 ROFF;
float grainT(vec2 p, float v){ float n=ign(floor(p/1.6))*.6+.4*nT(p*.9+FR*3.1); return step(n, v); }
void main(){ vec2 uv=gl_FragCoord.xy/R, px=gl_FragCoord.xy/S; vec4 pp=paper(uv);
  vec2 ro=ROFF*S/R;
  vec4 P=texture(ORIG,uv), Q=texture(AUXU,uv), Pr=texture(ORIG,uv+ro), Qr=texture(AUXU,uv+ro);
  float work=smoothstep(.05,.45,textureLod(AUXU,uv,4.).r);
  float key=cov(P.r), cut=cov(P.a);
  float rk=rkAt(uv), rkr=rkAt(uv+ro);
  float lt=smoothstep(.72,.9,lum(rgbOf(uv)))*(1.-Q.a)*step(rk,-.5), ltr=smoothstep(.72,.9,lum(rgbOf(uv+ro)))*(1.-Qr.a)*step(rkr,-.5);
  // black drum: the masses, tone grain inside the subject
  float kd=key*(1.-work*smoothstep(.25,.7,P.g)*.75);
  kd=max(kd, Q.g*.55*(1.-key));
  float tz=tzAt(uv); kd=mix(kd, (1.-smoothstep(.2,.7,P.g))*.92, tz);
  if(rk>-.5) kd=rk<1.5?ladV(rk):0.;                               // c2 ladder: the black drum takes the two front ranks
  if(gndAt(uv)>.5) kd=GNDV;
  kd*=(1.-lt)*(1.-cut);
  if(heroM(uv)>.5) kd=smoothstep(.62,.12,heroT(uv))*.97;              // c2b: the black drum prints the hero's shadow side
  else if(heroE(uv)>.5) kd=0.;
  // red drum: the shape, the spot, the lit sky as a grain gradient; steam knocks out of it
  float shape=texture(MASK, vuv(uv+ro)).r;
  float rd=SKYD>.5 ? Qr.a*clamp(1.-(uv.y-.4)*5.,0.,1.)*.55 : Qr.a*smoothstep(.3,.85,Pr.g)*.75;   // c2 designed sky: a grain rise off the horizon, no halo
  rd=max(rd, max(covS(shape,.04)*mix(1.,DISC,SKYD), cov(Pr.b)));
  rd=max(rd, ltr); rd=max(rd, tzAt(uv+ro)*smoothstep(.2,.6,Pr.g)*.85);
  if(rkr>-.5) rd=(rkr>1.5?ladV(rkr):0.)*(1.-cov(Pr.a));   // c2 ladder: the red drum takes the back ranks (and the flags)
  if(rkr>-.5) rd=max(rd, cov(Pr.b));
  if(gndAt(uv+ro)>.5) rd=0.;
  if(heroM(uv+ro)>.5) rd=smoothstep(.3,.8,heroT(uv+ro))*.95;          // c2b: the red drum its lit side; they overlap in the half-tones
  else if(heroE(uv+ro)>.5) rd=0.;
  rd*=1.-smoothstep(.2,.6,Qr.b)*.85;
  float T=typeA(uv), Tr=typeA(uv+ro);
  float tg=tGuard(uv); kd*=1.-tg*(1.-T); rd*=1.-tGuard(uv+ro)*step(.5,key);
  kd=max(kd*(1.-T), T); rd*=(1.-Tr);
  float band=1.-.07*smoothstep(.3,.7,nT(vec2(0.,px.y*.004+SEED)));    // drum banding
  float gk=grainT(spx(px,rk), clamp(kd,0.,1.)*band), gr=grainT(spx(px,rkr)+17., clamp(rd,0.,1.)*band);
  gk=max(gk*step(.02,kd), step(.92,kd));                          // solids stay solid
  vec3 col=pp.rgb;
  col=inkOn(col, IA, gr*.95*starve(px,.3));
  col=inkOn(col, IB, gk*.92*starve(px+5.,.3));
  o=fin(col,uv); }`;

const FS_NOTAN = `uniform vec3 IK, IS;
void main(){ vec2 uv=gl_FragCoord.xy/R, px=gl_FragCoord.xy/S; vec4 pp=paper(uv);
  vec4 P=texture(ORIG,uv), Q=texture(AUXU,uv);
  float work=smoothstep(.05,.45,textureLod(AUXU,uv,4.).r);
  float key=cov(P.r), cut=cov(P.a), sky=Q.a;
  float rk=rkAt(uv);
  float lt=smoothstep(.62,.85,lum(rgbOf(uv)))*step(rk,-.5);            // c2: no rim outlines round figures
  // value: 1 = ink. Masses solid; the rim / lit mids of the subject and the lit water dithered (blue noise, 2 px cells)
  float v=P.r;
  v=mix(v, 1.-smoothstep(.2,.75,P.g), work*key*.9);
  v=mix(v, 1.-P.g*1.3, (1.-sky)*(1.-key));
  float tz=tzAt(uv); v=mix(v, 1.-smoothstep(.22,.72,P.g), tz);
  v=mix(v, 0., smoothstep(.2,.55,Q.b));                              // steam: white
  if(rk>-.5) v=rk<.5 ? ladV(rk)*(1.-work*.9*smoothstep(.55,.85,P.g)) : ladV(rk);   // c2 ladder: dither density per rank
  if(gndAt(uv)>.5) v=GNDV;
  if(SKYD>.5 && sky>.5) v=0.;                                          // c2 designed sky: paper; the red disc is the one spot
  v*=1.-lt;
  float d=step(ign(floor(spx(px,rk)/2.)), clamp(v,0.,1.));
  if(HERO>.5) d=lineTint(spx(px,rk), clamp(v,0.,1.), 7.+rk, 0.);   // c2b: ranks ruled in 1-bit line tints (no dither checkers)
  float ink=mix(d, step(.5,v), step(.93,v)+step(v,.07));
  if(heroM(uv)>.5) ink=1.;                                               // NOTAN alone keeps the hero one solid black
  ink*=1.-tGuard(uv)*(1.-typeA(uv))*step(.5,P.r);
  ink*=(1.-cut);
  float T=typeA(uv); ink=max(ink*(1.-T), T*(1.-ink));
  float shape=texture(MASK, vuv(uv)).r, red=max(covS(shape,.03)*(1.-key*(1.-sky)), cov(P.b));
  red*=1.-T;
  if(IMP>.5) ink=1.-ink;                                               // impact: full invert, the red held
  vec3 col=pp.rgb;
  col=inkOn(col, IK, ink*(1.-red));
  col=inkOn(col, IS, red);
  o=fin(col,uv); }`;

// film looks: plan-driven 3-value exposure, print curve, luma grain, threshold halation that never crosses a mass
const FILM = `
float grain35(vec2 px, float l, float amt){ float g=(nT(px*.62+FR*13.7)-.5)*.65+(nT(px*1.3+FR*7.1)-.5)*.35; return g*amt*(.25+1.6*l*(1.-l)); }
vec3 printCurve(vec3 c, float toe, float sh){ c=max(c,0.); vec3 a=c*c/(c+toe); return a/(a+sh*(1.-a)+1e-4)*(1.+sh*.0); }
`;
const FS_SODIUM = FILM + `uniform vec3 SKYA, SKYB2, SOD, LAND; uniform vec4 BEAM; uniform float COLEV;
// c2b SODIUM (HERO mode): low-pressure sodium is one wavelength, so inside the lamp light every colour collapses to one
// amber hue and differs only in lightness; outside it the night is teal-black. No sun, no disc, no halo. The sky is the
// city's own sodium glow low down, teal above. Colour exists only where a full-spectrum emitter reaches (a headlight):
// COLEV / BEAM bring the scene's real chroma back inside the beam - the colour event is SODIUM's impact.
vec3 sodiumC(vec2 uv, vec2 px){ vec4 P=texture(ORIG,uv), Q=texture(AUXU,uv); vec3 src=rgbOf(uv); float L=lum(src);
  float key=cov(P.r), sky=Q.a; float rk=rkAt(uv);
  vec3 amb=vec3(1.,.66,.3);                                        // the sodium hue (589 nm), lightness only
  float gb=0.; for(int i=0;i<4;i++){ float dy=(40.+float(i)*110.)*S/R.y; gb+=textureLod(AN,uv-vec2(0.,dy),6.5).g*(1.-float(i)*.2); }   // ground below (blurred): the city's glow sits on the horizon
  gb=smoothstep(.15,1.6,gb);
  vec3 c=mix(vec3(.11,.2,.22), vec3(.42,.25,.12), gb*(1.-smoothstep(.0,.35,uv.y-.0)*.0));
  c=mix(c, vec3(.1,.19,.21), smoothstep(.72,1.,uv.y)*.5);
  vec3 land=amb*(.22+.5*smoothstep(.15,.8,P.g));                  // the lamp pool on the ground: lit amber, its own texture
  c=mix(c, land, 1.-sky);
  c=mix(c, amb*(.07+.3*P.g*P.g), key*(1.-texture(AN,uv).g));      // masses: amber-lit silhouettes, never pure black
  if(rk>-.5) c=mix(amb, vec3(.34,.56,.6), clamp(rk/3.,0.,1.)*.55)*ladV(rk);   // ranks: one value each, the far ones in teal haze
  if(gndAt(uv)>.5) c=amb*GNDV;
  float wh=smoothstep(.45,.8,min(src.r,min(src.g,src.b)));
  if(cov(P.b)>.5) c=amb*(.11+.82*wh);                              // a red flag / a green sign: umber like everything else; a sign's white letters stay its lightest value
  float hm=heroM(uv); if(hm>.5){ float T=heroT(uv); c=amb*(.05+.8*pow(T,1.4)); }   // the hero: amber monochrome tone
  float srcl=smoothstep(.8,.97,L)*step(rk,-.5)*(1.-sky)*(1.-hm);   // lamps themselves: the hot core
  c=mix(c, vec3(1.,.86,.6), srcl);
  // the colour event: inside the beam the real chroma returns at the same lightness (the scene under white light)
  if(COLEV>0.){ float r=length(px-BEAM.xy)/max(BEAM.z,1.);
    // BEAM.w 0: an EMITTER disc (a sun, a lamp): one flat colour sampled at its centre (a poster sun, no rings), cut edge,
    //   and the hero goes to a backlit silhouette against it (never amber sand).
    // 1: a HEADLIGHT on retroreflective paint: only the spot class in the beam lights, snapped to sign paint (interstate
    //   green or ACP red) with its legend kept (the minority value of the sign: white on a dark field, paint on a light one).
    // 2: a FLOODLIGHT (a searchlight on a crowd): everything but the sky in the cone takes back its real chroma at print
    //   value; the spot class snaps to paint.
    float spot=cov(P.b);
    vec2 cuv=BEAM.xy*S/R; vec3 ec=textureLod(SRC, vuv(cuv), 5.).rgb; ec=ec/max(max(ec.r,max(ec.g,ec.b)),.02);
    { float mn=min(ec.r,min(ec.g,ec.b)); if(1.-mn>.15){ ec=max(ec-mn*.85,0.); ec/=max(max(ec.r,max(ec.g,ec.b)),.02); } }   /* a poster sun: the core's hue at full saturation, never salmon */
    vec3 paint = src.r>src.g*1.25 ? vec3(.8,.09,.07) : vec3(.02,.4,.22);
    // sign paint by the sign's own lightness: its dark value prints as paint, its light value as cream (a green panel with
    // white letters; a yellow panel with dark letters becomes cream with green letters) - per texel, no neighbourhood, so
    // no outlined glyphs; the hue of the dark value picks the paint (red / orange stays ACP red, everything else green)
    vec3 sign=mix(paint, vec3(.95,.94,.89), smoothstep(.44,.52,L));
    float inb; vec3 tc;
    if(BEAM.w<.5){ inb=(1.-smoothstep(.985,1.,r))*COLEV; tc=clamp(ec*.84,0.,1.);
      float sil=max(hm, key*(1.-sky)*inb);   /* the hero, and any structure (a crane, a tower) crossing the disc: backlit silhouettes */
      c=mix(c, tc, inb*(1.-sil)); c=mix(c, vec3(.075,.045,.035), COLEV*sil*.92); }
    else if(BEAM.w<1.5){ inb=(1.-smoothstep(.7,1.,r))*COLEV*spot; c=mix(c, sign, inb); }
    else { inb=(1.-smoothstep(.55,1.,r))*COLEV*(1.-sky)*(1.-hm);
      vec3 sat=clamp(mix(vec3(L), src, 1.6),0.,1.); float lv=smoothstep(.12,.5,lum(c))*.84+.06; tc=mix(vec3(lv)*vec3(.97,.99,1.02), sat/max(lum(sat),.04)*lv, .3);   /* white light: the amber goes neutral, the real hues come back */
      tc=mix(tc, sign, spot); c=mix(c, tc, inb); }
    c=mix(c, c*vec3(1.04,1.02,1.08)+.025, inb*(1.-smoothstep(.0,.3,r))*step(.5,BEAM.w)); }
  return c; }
void main(){ vec2 uv=gl_FragCoord.xy/R, px=gl_FragCoord.xy/S;
  if(HERO>.5){ vec3 c=sodiumC(uv,px);
    c=printCurve(c, .03, .5);
    float T=typeA(uv); c=mix(c, vec3(.95,.89,.78), T);
    c+=grain35(px, lum(c), .07);
    float vg=length((uv-.5)*vec2(1.,1.78)); c*=1.-.2*smoothstep(.6,1.2,vg);
    o=vec4(clamp(c,0.,1.),1.); return; }
  vec4 P=texture(ORIG,uv), Q=texture(AUXU,uv); vec3 src=rgbOf(uv); float L=lum(src);
  float work=smoothstep(.05,.45,textureLod(AUXU,uv,4.).r);
  float key=cov(P.r), sky=Q.a, plume=smoothstep(.1,.7,Q.b);
  // 3 values as masses: sky one flat slate-teal (a hint of gradient), land density black, sources sodium
  vec3 c=mix(SKYA, SKYB2, SKYD>.5 ? .18+.1*uv.y : clamp(P.g*1.4,0.,1.)*.45);   // c2 designed: one flat slate-teal
  vec3 land=LAND*(.25+ .9*pow(L,1.6)) + SOD*pow(max(L-.35,0.),1.5)*1.6;          // water / ground keep their reflections
  c=mix(c, land, 1.-sky);
  vec3 body=vec3(.012,.01,.01)+SOD*pow(max(L-.3,0.),1.7)*work*1.2;           // silhouettes: density, detail only on the subject
  c=mix(c, body, key);
  float tz=tzAt(uv); c=mix(c, LAND*.15+SOD*smoothstep(.3,.85,P.g)*1.1, tz);
  vec3 plc=mix(vec3(.36,.24,.14), vec3(.96,.8,.56), smoothstep(.2,.8,P.g));    // steam lit from below: the third value
  c=mix(c, plc, plume*(1.-key*.8));
  float rk=rkAt(uv);
  if(rk>-.5){ float lv=ladV(rk); c=mix(vec3(1.06,.95,.84), vec3(.72,1.02,1.08), clamp(rk/3.,0.,1.))*lv;      // c2 ladder: haze lifts each rank
    if(rk<.5) c+=SOD*pow(max(L-.3,0.),1.7)*work*.6; }
  if(gndAt(uv)>.5) c=vec3(1.1,.95,.8)*GNDV;
  float src_=smoothstep(.72,.95,L)*step(rk,-.5)*(1.-sky*SKYD);
  c=mix(c, mix(SOD, vec3(1.,.93,.8), smoothstep(.9,1.,L)), src_*(1.-sky*.5));
  // threshold halation from sources only, red-orange, single-sided: never onto a key mass
  vec2 v=vuv(uv); float hb=0.;
  hb+=max(lum(textureLod(SRC,v,3.).rgb)-.62,0.)*.9; hb+=max(lum(textureLod(SRC,v,4.5).rgb)-.55,0.)*.8;
  c+=vec3(1.,.32,.08)*hb*(1.-key)*(1.-src_)*(1.-SKYD*max(sky,step(-.5,rk)));   // c2: no halo coin in the designed sky, none on a rank
  if(SKYD>.5){ float sb=texture(AUXU,uv-vec2(0.,3.*S/R.y)).a, gb=gndAt(uv-vec2(0.,4.*S/R.y));   // c2: the sodium horizon line (ground meets sky only)
    c=mix(c, SOD*1.05, sky*(1.-sb)*0.+sky*gb*.9); }
  if(IMP>.5 && IMP<1.5) c=(vec3(1.)-clamp(c,0.,1.))*vec3(1.,.6,.38);        // impact 1: the orange-mask negative
  c=printCurve(c*(IMP>1.5 && IMP<2.5?1.9:1.), .04, .55);
  if(IMP>1.5 && IMP<2.5) c=clamp((c-.42)*1.5+.42,0.,1.);                    // impact 2: a stop of real contrast, not a lift
  float T=typeA(uv); c=mix(c, vec3(.95,.89,.78), T);
  c+=grain35(px, lum(c), .085);
  float vg=length((uv-.5)*vec2(1.,1.78)); c*=1.-.28*smoothstep(.55,1.15,vg);
  o=vec4(clamp(c,0.,1.),1.); }`;

const FS_NEWSREEL = FILM + `uniform vec4 CV; uniform vec2 WEAVE; uniform float FLICK;
void main(){ vec2 uv0=gl_FragCoord.xy/R; vec2 uv=uv0+WEAVE*S/R; vec2 px=gl_FragCoord.xy/S;
  vec4 P=texture(ORIG,uv), Q=texture(AUXU,uv); vec3 src=rgbOf(uv);
  float ortho=dot(src, vec3(.08,.42,.5));                                  // orthochromatic: red prints near black
  float work=smoothstep(.05,.45,textureLod(AUXU,uv,4.).r);
  float key=cov(P.r), sky=Q.a, plume=smoothstep(.1,.6,Q.b);
  float v=mix(CV.w, .12+.5*ortho, 1.-sky);                                  // ground
  v=mix(v, CV.x + .12*(P.g-.5), sky);                                        // the sky burns white
  v=mix(v, CV.y, Q.g*(1.-key));
  v=mix(v, CV.z + .55*smoothstep(.25,.8,ortho)*work, key);
  v=mix(v, .06, cov(P.b));
  v=mix(v, .92, plume*(1.-key*.7));
  float tz=tzAt(uv); v=mix(v, .06+.9*smoothstep(.2,.75,P.g), tz);
  float rk=rkAt(uv);
  if(rk>-.5) v=ladV(rk)+.04*(P.g-.5)*step(rk,.5);                          // c2 ladder: one exposure per rank
  if(gndAt(uv)>.5) v=GNDV+.03*(uv.y-.2);
  if(SKYD>.5 && sky>.5) v=CV.x-.1+.16*uv.y;                               // c2 designed sky: a burnt sky, no sun disc
  if(heroM(uv)>.5){ float hT=heroT(uv); v=.04+.8*smoothstep(.28,.72,hT); }    // c2b: the hero exposed orthochromatic, a hard key
  float lt=smoothstep(.7,.92,lum(src))*step(rk,-.5)*(1.-sky*SKYD); v=mix(v, 1., lt);
  v+=max(lum(textureLod(SRC,vuv(uv),4.).rgb)-.7,0.)*.6*(1.-key)*(1.-SKYD);  // halation from sources only
  float T=typeA(uv0); v=mix(v, v>.5?.04:.97, T);
  float fk=IMP<.5?0.:IMP<1.5?.9:IMP<2.5?.5:.2;                             // flash frame: over-exposed to the base, then 2 frames of decay
  v=mix(v, 1., fk);
  v*=1.+FLICK;
  vec3 c=printCurve(vec3(v), .03, .6);
  c=mix(vec3(.05,.045,.04), vec3(.96,.93,.86), c.r);
  if(fk>0.){ float e=length((uv0-.5)*vec2(1.,1.7)); c=mix(c, vec3(.85,.42,.12), smoothstep(.55,1.1,e)*.9*fk/.9); }   // burnt emulsion edge
  c+=grain35(px*.8, c.g, .16);
  float vg=length((uv0-.5)*vec2(1.,1.7)); c*=1.-.35*smoothstep(.5,1.1,vg);
  o=vec4(clamp(c,0.,1.),1.); }`;

// press overlays: red letterpress spot, keyline, type, stamp and impact on top of a print.js press result (BELOW)
const FS_PRESSOV = `uniform vec3 IK, IS; uniform vec2 JOLT; uniform float WLINE, STAMPK, MODEP; uniform vec3 STC;
void main(){ vec2 uv=gl_FragCoord.xy/R, px=gl_FragCoord.xy/S; vec4 pp=paper(uv);
  vec2 j=JOLT*S/R;
  vec3 col=texture(BELOW, uv+j).rgb;
  vec4 P=texture(ORIG,uv+j);
  float shape=texture(MASK, vuv(uv+j)).r*mix(1.,DISC,SKYD), red=max(covS(shape,.03), cov(P.b));
  vec2 q=px-ANCH.xy-JOLT; float rr=length(q)/max(ANCH.z,1.), th=atan(q.y,q.x);
  if(MODEP<.5 && SKYD>.5){ // c2 designed sky: a banknote-ruled sky (lathe lines in the key ink), no rosette behind a crowd
    vec4 Q2=texture(AUXU,uv+j); float yy=px.y+14.*sin(px.x*.011+px.y*.002)+6.*sin(px.x*.027-1.3);
    float ln=1.-smoothstep(.1,.28,abs(fract(yy/7.)-.5)); float fade=smoothstep(.3,.9,uv.y);
    col=inkOn(col, IK, ln*Q2.a*(.25+.45*fade)*starve(px,.3)); red=cov(P.b);
  } else if(MODEP<.5){ // banknote rosette: two families of guilloche lines in the anchor's disc, red letterpress
    float g1=abs(fract(rr*26.+.09*sin(th*15.))-.5), g2=abs(fract(rr*26.-.09*sin(th*15.+1.3))-.5), g3=abs(fract(th*38./6.2831+rr*3.)-.5);
    float ln=max(max(1.-smoothstep(.05,.13,g1), 1.-smoothstep(.05,.13,g2)), (1.-smoothstep(.04,.1,g3))*step(rr,.55));
    red=max(ln*(1.-smoothstep(1.12,1.16,rr)), cov(P.b));
  } else {      // linocut sky: the red block cut into horizontal bands that thin toward the horizon, the sun a solid disc
    // (horizontal gouges only: radiating rays around a red disc would read as another nation's flag)
    float up=(px.y-(ANCH.y-ANCH.z*.2))/(ANCH.z*2.6);                    // 0 near the disc's foot .. 1 high sky
    float ph=px.y/(9.+18.*clamp(up,0.,1.)); float fr=abs(fract(ph+.15*nT(vec2(px.x*.01,floor(ph))))-.5)*2.;
    float w=mix(.35,.85,clamp(up,0.,1.));                                 // red share of each band grows upward
    float blk=(1.-smoothstep(w-.08,w+.08,fr))*step(-.25,up)*(1.-smoothstep(.95,1.15,up+.1*nT(vec2(px.x*.02,3.))))*texture(AUXU,uv+j).a;
    red=max(max(covS(shape,.03), blk), cov(P.b)); }
  red*=1.-SKYD*smoothstep(.02,.2,textureLod(SUBJ,uv+j,4.).a);                  // c2: the red block never runs under the words
  col=inkOn(col, IS, red*.85*starve(px,.35)*(1.-cov(P.a)));
  if(HERO>.5){ float he=heroE(uv+j), hm=heroMs(uv+j);
    if(he>.01){ float hT=heroT(uv+j), hh=heroH(uv+j); vec2 hp=spx(px,-1.);
      float ink;
      if(MODEP<.5){ // INTAGLIO: a burin line engraving. Parallel lines bent over the form by the pillow height (they follow
        // the volume the way a banknote portrait's do), swelling in the shadows, a second set crossing in the deepest ones;
        // knife-crisp (fwidth AA), no dots, no blur
        float dk=1.-hT*.9; float ph=dot(hp, vec2(.34,.94))/6.2 + hh*5.5; float w=mix(.13,.52,dk);
        float f=abs(fract(ph)-.5)*2.; float aa=fwidth(ph)*2.; float l1=1.-smoothstep(w-aa,w+aa,f);
        float ph2=dot(hp, vec2(.9,-.44))/5.4 - hh*3.; float f2=abs(fract(ph2)-.5)*2.; float aa2=fwidth(ph2)*2.;
        float w2=(dk-.55)*.9; float l2=(1.-smoothstep(w2-aa2, w2+aa2, f2))*step(.55,dk);
                ink=max(l1,l2);
      } else {      // BROADSIDE: a white-line woodcut. The hero is the black block; gouges follow its contour (isolines of the
        // pillow) and bend across the interior, cut wider toward the light; the gouge ends are ragged, not grain
        float jag=.12*(nT(hp*.09)-.5);
        float ph=hh*7.+jag + dot(hp,vec2(.2,.98))/40.*(1.-smoothstep(.2,.7,hh));
        float ph2=dot(hp, vec2(.26,.97))/13. + hh*2.2 + jag;
        float g1=abs(fract(ph)-.5)*2., g2=abs(fract(ph2)-.5)*2.;
        float wl=mix(.0,.62,smoothstep(.15,.95,hT));                // white share: none in the shadow, broad in the light
        float aa=fwidth(ph)*1.5+.02, aa2=fwidth(ph2)*1.5+.02;
        float cutA=(1.-smoothstep(wl-aa,wl+aa,g1))*(1.-smoothstep(.55,.8,hh));  // contour gouges near the edge
        float cutB=(1.-smoothstep(wl*.8-aa2,wl*.8+aa2,g2))*smoothstep(.4,.7,hh);  // body gouges inside
        ink=1.-max(cutA,cutB);
      }
      float hmask=step(.5,hm);
      col=mix(col, pp.rgb, step(.5,he));                            // paper round the hero (the press prints nothing under it)
      col=inkOn(col, IK, ink*hmask*starve(px+7.,.25));
    } }
  if(HERO>.5){ float tg=tGuard(uv+j)*(1.-typeA(uv+j)); float dk=1.-lum(col)/max(lum(pp.rgb),.01); col=mix(col, pp.rgb, tg*smoothstep(.5,.7,dk)); }
  float T=typeA(uv+j);
  // letterpress type: ink with a deboss shade on the lower-right lip
  float Td=typeA(uv+j+vec2(-1.5,1.5)*S/R);
  col*=1.-.18*clamp(Td-T,0.,1.);
  col=inkOn(col, IK, T*starve(px+3.,.3));
  if(STAMPK>0.){ // the seal: slammed (ink squashed 8% wide on the hit frame), then the deboss shade
    vec2 sc=STC.xy, sp=(px-JOLT-sc)/STC.z+sc; vec2 suv=sp*S/R;
    vec4 st=texture(AUXN, suv); float k=clamp(st.a*1.15,0.,1.)*STAMPK*starve(px*1.3,.45+.2*(1.-STAMPK));
    col=inkOn(col, IS, k); col*=1.-.14*clamp(texture(AUXN,suv+vec2(-2.,2.)*S/R).a-st.a,0.,1.)*STAMPK; }
  if(WLINE>.5){ // white-line invert: the carved contours in cream on a black block
    float e=0.; vec2 d=vec2(2.5)*S/R; float c0=lum(texture(BELOW,uv).rgb);
    e=abs(lum(texture(BELOW,uv+vec2(d.x,0.)).rgb)-c0)+abs(lum(texture(BELOW,uv+vec2(0.,d.y)).rgb)-c0);
    float ln=max(smoothstep(.12,.3,e), cov(P.a)); ln=max(ln, T);
    col=mix(IK*.9, pp.rgb, ln); }
  o=fin(col,uv); }`;

// transitions: A = BELOW (outgoing, finished), B = SRC (incoming, finished). The incoming look owns the act.
const FS_TRANS = `uniform float MODE, U, SEEDT; uniform vec2 CEN; uniform vec3 PL0, PL1, PL2, PL3, PL4;
vec3 A_(vec2 uv){ return texture(BELOW,uv).rgb; } vec3 B_(vec2 uv){ return texture(SRC,uv).rgb; }
void main(){ vec2 uv=gl_FragCoord.xy/R, px=gl_FragCoord.xy/S, sz=R/S; vec3 col;
  if(MODE<1.5){                         // 1 plate slide on the 30-degree axis: B is a sheet laid over A, paper edge + cast shadow
    vec2 dir=normalize(vec2(.866,.5)); float span=dot(sz,abs(dir))*.5+90.; float e=mix(-span, span, U);
    float edge=dot(px-sz*.5, dir)-e;                                     // < 0: under the incoming sheet
    vec2 buv=uv-dir*(e-span)*.22*S/R;                                    // the sheet's content travels in with it (parallax, no empty margin)
    bool off=any(lessThan(buv,vec2(0.)))||any(greaterThan(buv,vec2(1.)));
    col = edge<0. ? (off ? PL0 : B_(buv)) : A_(uv)*(1.-.4*exp(-edge/22.));     // cast shadow of the sheet on A
    if(edge<0. && edge>-6.) col=mix(col, PL0, .92);                              // the sheet's paper edge
    if(edge>=0. && edge<5.) col=mix(col, PL0*.5, .9);                            // c2: the board's thickness, in its own shadow
  } else if(MODE<2.5){                  // 2 squeegee: cream flood then 4 opaque plates pulled left to right, one per quarter beat
    vec3 b=B_(uv); float n=0.; float x=uv.x+.03*(nT(vec2(px.y*.01,SEEDT))-.5);
    for(int k=0;k<4;k++){ float f=clamp(U*4.5-float(k)*1.12,0.,1.1); if(x<f) n=float(k)+2.; }
    vec3 pl[5]; pl[0]=PL0; pl[1]=PL1; pl[2]=PL2; pl[3]=PL3; pl[4]=PL4;
    float best=1e9; int li=0; for(int k=0;k<5;k++){ float dd=distance(b,pl[k]); if(dd<best){ best=dd; li=k; } }
    if(n<.5) col=A_(uv); else if(float(li)<=n-1.) col=b; else col=pl[int(n)-1]*mix(1.,.97,nT(px*.2));
    for(int k=0;k<4;k++){ float f=clamp(U*4.5-float(k)*1.12,0.,1.1); float d=(x-f)*R.x/S; if(f>0.&&f<1.&&d>-5.&&d<3.) col=mix(col, pl[min(k+1,4)]*.65, .85); }
  } else if(MODE<3.5){                  // 3 torn sheet: A tears away along a ragged diagonal, fibre rim, B already printed under it
    float a=-.35; vec2 dn=vec2(sin(a),cos(a)); float s=dot(px-sz*.5, dn)/sz.y+.5; float front=mix(-.15,1.2,U);
    float jag=.018*(fbmT(vec2(dot(px,vec2(cos(a),-sin(a)))*.03,SEEDT))-.5)+.006*(nT(px*.3)-.5);
    float e=(s-(1.-front))+jag;
    if(e<0.) col=B_(uv); else { col=A_(uv); if(e<.006) col=mix(col, PL0*(.95+.05*nT(px*.8)), smoothstep(.006,.0,e)); }
    if(e<0. && e>-.02) col*=1.-.25*smoothstep(-.02,0.,e);
  } else if(MODE<4.5){                  // 4 paper feed: the next sheet slides up; A's trailing edge smears
    float y=uv.y, f=U; if(y<f){ col=B_(vec2(uv.x, y-f+1.)); } else { col=A_(vec2(uv.x, y-f)); float d=(y-f)*R.y/S; if(d<40.) col=mix(col, A_(vec2(uv.x,0.002)), (1.-d/40.)*.6*step(.3,nT(vec2(px.x*.08,1.)))); }
  } else if(MODE<5.5){                  // 5 splice: frame-line roll, tape and a cement flash at the join
    float roll=(1.-U)*.22; float y=uv.y-roll; vec3 c;
    if(y>=0.) c=B_(vec2(uv.x,y)); else c=A_(vec2(uv.x,y+1.));
    float fl=abs(uv.y-roll)*R.y/S; if(fl<22.) c=vec3(.04);
    float tape=smoothstep(60.,52.,abs(uv.y-roll)*R.y/S)*step(.02,U)*(1.-U*.6); c=mix(c, c*vec3(1.05,1.02,.9)+.06, tape*.5);
    if(U<.34) c=mix(c, vec3(.97,.94,.86), smoothstep(80.,0.,abs(uv.y-roll)*R.y/S)*.9);
    col=c;
  } else if(MODE<6.5){                  // 6 guilloche iris: rosette rings draw out from the centre and reveal B
    vec2 q=(px-CEN*sz); float r=length(q), th=atan(q.y,q.x); float R0=U*1.25*length(sz);
    float ros=R0*(1.+.06*sin(th*18.+U*6.)+.04*sin(th*7.-U*3.));
    col = r<ros ? B_(uv) : A_(uv);
    float band=smoothstep(80.,0.,abs(r-ros)); float lines=smoothstep(.7,.95,abs(sin(r*.35+sin(th*24.)*2.)));
    col=mix(col, PL1, band*lines*.9);
  } else if(MODE<7.5){                  // 7 light-leak burn from the brightest source: hot core, orange, red rim, then B
    vec2 q=px-CEN*sz; float r=length(q)/length(sz); float n=fbmT(px*.006+SEEDT)*.35;
    float f=U*1.5; float d=r*(1.+n)-f;
    if(d<-.35) col=B_(uv); else { col=A_(uv);
      vec3 burn=mix(vec3(1.,.94,.78), vec3(1.,.42,.08), smoothstep(-.35,-.12,d)); burn=mix(burn, vec3(.55,.05,.02), smoothstep(-.12,.02,d));
      col=mix(col, burn, smoothstep(.06,-.06,d)); if(d<-.3) col=mix(burn,B_(uv),smoothstep(-.3,-.35,d)); }
  } else {                              // 8 threshold sweep: light eats dark, masked by the source's own luma
    float l=lum(texture(ORIG,uv).rgb); float th=1.05-U*1.15; col = l>th ? B_(uv) : A_(uv);
  }
  o=vec4(col,1.); }`;

let REG = false;
function register() {
  if (REG) return; REG = true;
  const add = (n, s) => registerPrintPass(n, LK + s);
  add('lk_hmask', FS_HMASK); add('lk_tone', FS_TONE); add('lk_plan', FS_PLAN); add('lk_plan2', FS_PLAN2); add('lk_plan3', FS_PLAN3); add('lk_pgrey', FS_PGREY);
  add('lk_KLUTSIS', FS_KLUTSIS); add('lk_SERIGRAPH', FS_SERIGRAPH); add('lk_RISO', FS_RISO); add('lk_NOTAN', FS_NOTAN);
  add('lk_SODIUM', FS_SODIUM); add('lk_NEWSREEL', FS_NEWSREEL); add('lk_pressov', FS_PRESSOV); add('lk_trans', FS_TRANS);
}
const TMODE = { slide: 1, squeegee: 2, tear: 3, feed: 4, splice: 5, iris: 6, burn: 7, sweep: 8 };
const hash = k => { const r = Math.sin(k * 12.9898 + 78.233) * 43758.5453; return r - Math.floor(r); };

export class Looks {
  constructor({ width = 1080, height = 1920, print = null } = {}) {
    register();
    this.pr = print || new Print({ width, height });
    this.w = width; this.h = height; this.S = width / 1080;
    this.pr.preload(['cream', 'newsprint', 'rag', 'cotton', 'ivory']);
    const P = this.pr;
    this.tex = {}; this.keys = {};
    this.stats = {};
  }
  _up(name, source, mip = true) {
    if (!source) return null;
    const P = this.pr; let t = this.tex[name];
    if (!t) t = this.tex[name] = P._tex(1, 1, mip);
    P._upload(t, source); return t;
  }
  // sources: { color, aux, glow, shape, type, stamp, depth: [near, far], cutKT (ln depth step, default .035) }.
  // key: pass a value per layer ({ color: frameIndex, type: 'ALL OF IT' ...}) to skip unchanged uploads.
  source(s, key = {}) {
    const t0 = performance.now();
    for (const n of ['color', 'aux', 'glow', 'shape', 'type', 'stamp', 'tone']) {
      if (!(n in s)) continue;
      if (key[n] !== undefined && this.keys[n] === key[n] && this.tex[n]) continue;
      this.keys[n] = key[n];
      if (s[n]) this._up(n, s[n], n !== 'aux'); else { delete this.tex[n]; }
      if (n === 'color' && s[n]) this.lv = null;
    }
    if (s.depth) this.depth = s.depth;
    if (s.anchor) this.anchor = s.anchor;
    if (s.stampAt) this.stampAt = s.stampAt;
    this.kt = s.cutKT ?? this.kt ?? 0.035;
    if ('tonal' in s) this.tonal = s.tonal || [];
    if ('rankCut' in s) this.rankCut = !!s.rankCut;          // HUMAN c3 (ranks.js): keylines between ranks even on tonal classes
    // LOOKS c2 (all optional; without them every look prints exactly as in c1):
    //   ranks: true | { n, near, far }  the rank ladder. Figure texels (class >= 180) are ranked by their flat depth
    //          (ranks.js writes 0.12 .. 0.74 for n ranks); each look prints each rank one step lighter in its own
    //          medium, the ground as one flat value, and cuts its gap only where a nearer figure overlaps a farther one.
    //   sky: 'designed'  the look's own sky; a disc (shape) survives only in the two looks allowed one (KLUTSIS, NOTAN)
    if ('ranks' in s) { const r = s.ranks; this.ranks = r ? { n: 4, near: 0.12, far: 0.74, ...(r === true ? {} : r) } : null; }
    if ('sky' in s) this.skyD = s.sky === 'designed';
    // LOOKS c2b: THE LOOK PRINTS THE SUBJECT (optional; on by default with sky: 'designed', off for c1 callers).
    //   hero: true | { rank: 0 (ladder rank that is the hero; -1 = the whole subject class), light: [x, y] (the key's
    //         direction on screen, y up), rim: 0..1 (how much of the render's own rim light survives), k: pillow depth }
    //         | false.  Each medium prints the hero's tone in its own marks (see FS_TONE); NOTAN keeps it solid.
    //   tone: a canvas of the hero LIT (a second render with a key light; luma is read). Without it the silhouette is
    //         inflated into a pillow and lit from `light`.
    //   typeGuard: true (default with hero) - the words are never cut by a mass: a ~10 px paper margin round each glyph.
    if ('hero' in s || 'sky' in s) { const h = 'hero' in s ? s.hero : (this.skyD ? true : null); this.hero = h ? { rank: 0, light: [-0.6, 0.55], rim: 1, k: 7, ...(h === true ? {} : h) } : null; }
    if ('typeGuard' in s) this.tguard = !!s.typeGuard;
    // TYPE c2: type that is LIGHT (button copy, drones, a lit sign) is scene luminance, not type-slot ink. A canvas of
    // those pixels only (RGBA, clear elsewhere) is laid over the finished look with 'lighten', so no plan can invert,
    // threshold or ink it away (NOTAN swallowed the word on the plant flare in WORLDS c2). Optional; null clears it.
    if ('typeLight' in s) this.typeLight = s.typeLight || null;
    this.stats.upload = performance.now() - t0;
    return this;
  }
  _levels() {
    if (this.lv) return this.lv;
    const P = this.pr; const lv = P._autoLevels(this.tex.color, { lo: 0.02, hi: 0.985, mid: 0.45 }, { SUBJM: 0 }, null);
    return (this.lv = lv);
  }
  // cadence: print looks move on twos (the frame the scene should render its source at)
  static twos(t, fps = 30) { return Math.floor(Math.round(t * fps) / 2) * 2 / fps; }
  // impact frame index: 1 on the hit's own frame, 2 the next ... up to n; 0 otherwise. Pure in t.
  static impactFrame(t, hitT, n = 3, fps = 30) { const k = Math.round(t * fps) - Math.round(hitT * fps); return k >= 0 && k < n ? k + 1 : 0; }
  // transition progress for a reveal that LANDS on the hit: starts `frames` before it, u = 1 on the hit frame
  static landing(t, hitT, frames = 4, fps = 30) { const k = Math.round(t * fps) - Math.round(hitT * fps); return Math.min(1, Math.max(0, (k + frames) / frames)); }

  _plan(L, t, zoom) {
    const P = this.pr, T = this.tex, aux = T.aux;
    const aw = aux ? aux.w : 540, ah = aux ? aux.h : 960;
    if (!this.plan || this.plan.w !== aw) { this.plan = P._target(aw, ah, true); this.plan2 = P._target(aw, ah, true); this.plan3 = P._target(aw, ah, true); }
    const [zn, zf] = this.depth || [1, 1000], lv = this._levels();
    const cls = L.cls || { sky: 0, far: 0.5, mid: 1, ground: 1, subject: 1 };
    const rn = this.ranks, U = { RNK: rn ? [rn.near, rn.far, rn.n - 1, 1] : [0, 1, 1, 0], ZOOM: zoom, AUXR: [aw, ah], CW: [cls.ground, cls.far, cls.mid, cls.subject], CWS: cls.spot ?? 0, SKYV: cls.sky,
      TONAL: ['ground', 'far', 'mid', 'subject'].map(k => (this.tonal || []).includes(k) ? 1 : 0), LNR: Math.log(zf / zn), KT: this.kt, CUTR: (L.cut || 0) * aw / 540, CUTSKY: L.cutSky ? 1 : 0, HASAUXI: aux ? 1 : 0, LVL: lv, RANKCUT: this.rankCut ? 1 : 0 };
    const tx = { SRC: T.color, AN: aux || P.dummy, AB: T.glow || P.dummy };
    P._pass('lk_plan', this.plan, U, tx);
    P._pass('lk_plan2', this.plan2, U, tx);
    P._pass('lk_plan3', this.plan3, U, tx);
    if (this.hero && this.hero.rank != null) {           // c2b hero plate (rank: null = c2b media without a hero plate: a crowd with no hero)
      if (!this.plan4 || this.plan4.w !== aw) { this.hmask = P._target(aw, ah, true); this.plan4 = P._target(aw, ah, true); }
      const h = this.hero, ht = !!this.tex.tone;
      P._pass('lk_hmask', this.hmask, { ...U, HASTONE: ht ? 1 : 0, HRANK: h.rank ?? 0 }, { ...tx, AUXN: this.tex.tone || P.dummy });
      P._pass('lk_tone', this.plan4, { HASTONE: ht ? 1 : 0, HLT: [h.light[0], h.light[1], h.rim ?? 1, h.k ?? 7] }, { ORIG: this.hmask.tex });
    }
  }
  _common(t, o) {
    const T = this.tex, P = this.pr;
    return { tex: { SRC: T.color, AN: this.plan3.tex, AB: this.hero ? (this.hero.rank != null && this.plan4 ? this.plan4.tex : P.dummy) : (T.glow || P.dummy), MASK: T.shape || P.dummy, SUBJ: T.type || P.dummy, AUXN: T.stamp || P.dummy, ORIG: this.plan.tex, AUXU: this.plan2.tex } };
  }
  // render look `name` into a named target (or the canvas); returns the target
  _look(name, t, o = {}, out = 'lk_out') {
    const L = LOOKS[name]; if (!L) throw new Error('look ' + name);
    const P = this.pr, fps = o.fps || 30, fr = Math.round(t * fps);
    const tq = L.twos ? Looks.twos(t, fps) : t;
    P.t = tq; P.seed = o.seed ?? 1; P.fr = L.boil ? Math.floor(tq * L.boil) : fr; P.lv = [0, 1, 1];
    const zoom = o.zoom || [1, 0, 0];
    this._plan(L, tq, zoom);
    const { tex } = this._common(tq, o);
    const tg = out === null ? null : P.target(out);
    const paper = P.paper(L.paper || 'cream');
    tex.PAPER = paper.tex;
    const imp = o.imp || 0, kick = o.kick || 0;
    const an = this.anchor || [540, 960, 250];
    const c2 = L.c2 || {}, rn = this.ranks, ro = o.rankOff || [], sc = o.screen || [0, 0, 1];
    const base = { ANCH: [an[0], 1920 - an[1], an[2]], ZOOM: zoom, IMP: imp, KICK: kick, FRN: fr, PBASE: paper.base, TENS: 0, RANKCUT: this.rankCut ? 1 : 0,
      RNK: rn ? [rn.near, rn.far, rn.n - 1, 1] : [0, 1, 1, 0], LAD: c2.ladder || [1, 1, 1, 1], GNDV: c2.gnd ?? 0, SKYD: this.skyD ? 1 : 0, DISC: c2.disc ? 1 : 0,
      // screens pinned: o.screen = [ox, oy, scale] (px, y down) for the shot; o.rankOff = [[dx, dy], ...] per rank card (px, y down)
      SCR: [sc[0], -sc[1], sc[2]], RKO0: [(ro[0] || [0, 0])[0], -(ro[0] || [0, 0])[1]], RKO1: [(ro[1] || [0, 0])[0], -(ro[1] || [0, 0])[1]], RKO2: [(ro[2] || [0, 0])[0], -(ro[2] || [0, 0])[1]], RKO3: [(ro[3] || [0, 0])[0], -(ro[3] || [0, 0])[1]],
      EVT: o.evt ? 1 : 0, HERO: this.hero ? 1 : 0, TGUARD: (this.tguard ?? !!this.hero) ? 1 : 0, BW: 32, COLEV: o.colev || 0, BEAM: o.beam ? [o.beam[0], 1920 - o.beam[1], o.beam[2], o.beam[3] ?? 1] : [540, 960, 600, 0] };
    const I = L.inks || {};
    switch (name) {
      case 'KLUTSIS': {
        // c1: 2 frames 12 px off register. c2 event (o.evt): the black plate lands 12 px off and walks back over 3 frames;
        // o.lift (0..1) raises the board before the hit (the key plate up 6 px, its shadow lengthening)
        const off = o.evt ? [0, 1, 0.66, 0.33][imp - 1] ?? 0 : imp >= 2 ? 1 : 0, lift = o.lift || 0;
        const s = o.koff ? [o.koff[0], o.koff[1]] : this.hero && o.evt ? [-4 * lift, 12 * lift] : [12 * off, -7 * off + 6 * lift];   // c2b: the event passes its own plate offset
        P._pass('lk_KLUTSIS', tg, { ...base, PEEL: o.peel ?? -2, IK: hx(I.key), IS: hx(I.spot), KOFF: s, SHL: 1 + (this.hero ? 1.3 : 1.6) * lift }, tex); break; }
      case 'SERIGRAPH':
        { const q = o.sq || {};   // c2 squeegee state (see Looks.squeegee): plate fronts, key strength, mesh, blade, bead, misregistration
          P._pass('lk_SERIGRAPH', tg, { ...base, I1: hx(I.p1), I2: hx(I.p2), I3: hx(I.p3), I4: hx(I.p4), SKYB: this.skyD ? [0.9, 0.8, 0.66, 0] : [0.62, 0.42, 0.2, 0],   // c2 designed sky: a thin paper glow at the horizon, ochre, brick, then slate holds the top
           
            SQ: q.fronts || [1, 1, 1, 1], SQG: q.key ?? 1, SQM: [q.mesh || 0, q.blade ?? -1, q.plate || 1, q.bead || 0], SQD: [q.dir || 1, q.blade != null && q.blade > -0.05 && q.blade < 1.05 ? 1 : 0], MIS: q.mis ?? 1 },
            o.below ? { ...tex, BELOW: o.below } : tex); } break;
      case 'RISO': {
        const since = o.kickAge ?? 99, jump = imp ? 14 * Math.exp(-(imp - 1) / 1.6) : 0;
        const ro = [3 + 4 * kick + jump, -2 - 1.5 * kick - jump * 0.35];
        P._pass('lk_RISO', tg, { ...base, IA: hx(I.a), IB: hx(I.b), ROFF: ro }, tex); break; }
      case 'NOTAN': P._pass('lk_NOTAN', tg, { ...base, IK: hx(I.key), IS: hx(I.spot) }, tex); break;
      case 'SODIUM':
        P._pass('lk_SODIUM', tg, { ...base, SKYA: hx('#0f252c'), SKYB2: hx('#2c4f58'), SOD: hx('#ffae4a'), LAND: hx('#2a1a10') }, tex); break;
      case 'NEWSREEL': {
        const c = L.val, wv = [(hash(fr * 1.3) - 0.5) * 1.6, (hash(fr * 2.7 + 3) - 0.5) * 1.2];
        P._pass('lk_NEWSREEL', tg, { ...base, CV: [c.sky, c.far, c.subject, c.ground], WEAVE: wv, FLICK: (hash(fr * 0.77) - 0.5) * 0.08 }, tex); break; }
      case 'INTAGLIO': case 'BROADSIDE': {
        const G = L.grey, pg = P.target('lk_pgrey');
        P._pass('lk_pgrey', pg, { ...base, GA: [G.sky, G.plume, G.light, G.far], GB: [G.keyFlat, G.keyLo, G.keyHi, G.ground], GSPOT: G.spot }, tex);
        P.src('lk_pgrey'); P.lv = [0, 1, 1];
        const step = name === 'INTAGLIO'
          ? ['engrave', { pitch: 7.5, ink: I.key, plate: 0.3, mark: 36, contour: 0.6, angle: 0.35, crosshatch: 1, stipple: 0.6 }]
          : ['woodcut', { t1: 0.3, t2: 0.66, pitch: 11, jag: 0.7, chisel: 0.25, grain: rn ? 0.3 : 0.8, ink: I.key, two: 0, lino: 0, angle: 0.4, contour: 0.4 }];   // c2 ladder: grain down (the zebra on the solids)
        P.run([step], { t: tq, paper: L.paper, boil: L.boil || 0, out: 'lk_press', aux: null });
        const jolt = name === 'INTAGLIO' && imp ? (imp <= 2 ? [0, -6] : [0, -2]) : [0, 0];
        P._pass('lk_pressov', tg, { ...base, IK: hx(I.key), IS: hx(I.spot), JOLT: jolt, STC: [(this.stampAt || [540, 960])[0], 1920 - (this.stampAt || [540, 960])[1], imp === 1 ? 1.08 : 1], MODEP: name === 'BROADSIDE' ? 1 : 0, WLINE: name === 'BROADSIDE' && imp ? 1 : 0,
          STAMPK: name === 'INTAGLIO' ? (o.stamp ?? 0) * (imp === 3 ? 0.55 : 1) : 0 }, { ...tex, BELOW: P.targets.lk_press.tex });
        break; }
    }
    if (tg) { tg.tex.dirty = true; }
    return tg;
  }
  // one finished frame. o: { kick, imp (impact frame index), zoom: [scale, ox, oy], fps, stamp (0..1 INTAGLIO seal) }
  apply(ctx, name, t, o = {}) {
    const t0 = performance.now();
    this._look(name, t, o, null);
    this.pr.draw(ctx, null);
    this._light(ctx);
    this.stats.ms = performance.now() - t0;
    return this;
  }
  // A -> B, u 0..1. The incoming look (B) owns the act (its recipe's `trans`), unless o.mode overrides.
  transition(ctx, a, b, t, u, o = {}) {
    const t0 = performance.now(), P = this.pr;
    if (u <= 0) return this.apply(ctx, a, t, o.a || o);
    if (u >= 1 && !o.hold) return this.apply(ctx, b, t, o.b || o);
    this._look(a, t, o.a || o, 'lk_A');
    this._look(b, t, o.b || o, 'lk_B');
    const LB = LOOKS[b], mode = TMODE[o.mode || LB.trans];
    const pl = LB.inks && LB.inks.p1 ? ['#efe2c6', LB.inks.p1, LB.inks.p2, LB.inks.p3, LB.inks.p4] : ['#f4ead6', '#1c3a2e', '#bd1818', '#34425a', '#15110e'];
    P._pass('lk_trans', null, { MODE: mode, U: u, SEEDT: 3.1, CEN: o.center || [0.5, 0.5], PL0: hx(pl[0]), PL1: hx(pl[1]), PL2: hx(pl[2]), PL3: hx(pl[3]), PL4: hx(pl[4]) },
      { BELOW: P.targets.lk_A.tex, SRC: P.targets.lk_B.tex, ORIG: this.tex.color });
    P.draw(ctx, null);
    this._light(ctx);
    this.stats.ms = performance.now() - t0;
    return this;
  }
  // ---------------------------------------------------------------- LOOKS c2: acts with a before, a during and an after
  // One call per frame for a whole act that lands ON a hit (the song's measured onset, not the grid):
  //   lk.event(ctx, 'KLUTSIS', t, { hitT, from: 'SODIUM', slideAt: 25.31 })   plate slide (lands on slideAt), the board
  //       lifts through the anticipation (default 12 frames), the composed red plate with the figures cut out as paper ON
  //       the hit, the black plate 12 px off walking back over 3 frames, then the sheet settles (8-12 frames)
  //   lk.event(ctx, 'SERIGRAPH', t, { hitT, from: 'RISO' })   squeegee: a flood stroke (screen coated, nothing printed),
  //       4 accelerating pulls (10, 8, 6, 4 frames), each depositing its plate only through its stencil behind a visible
  //       blade and ink bead; the key plate shows through the mesh until the screen lifts ON the hit; then the lift and
  //       a misregistration settle
  // Everything else in o goes to the look (rankOff, screen, zoom ...). Returns { phase, k } for the caller's own motion.
  event(ctx, name, t, o = {}) {
    const fps = o.fps || 30, k = Math.round(t * fps) - Math.round(o.hitT * fps), P = this.pr, t0 = performance.now();
    const ease = x => x * x * (3 - 2 * x), zb = o.zoom || [1, 0, 0];
    const settle = (k, amp, tau = 3.2) => k < 0 ? 0 : amp * Math.exp(-k / tau) * Math.cos(k * 1.35);
    let phase = 'hold';
    if (name === 'KLUTSIS') {
      // c2b: slide (lands on slideAt) -> anticipation: the board lifts 12 px, its shadow doubles, a 2.5% push-in (antic
      // frames; o.anticFrom: a frame index to start from, e.g. a measured silence) -> ON the hit the composed red plate,
      // HELD 3 frames (red on everything but the figures) -> the black plate slides in 18 px off-axis over 2 frames ->
      // walks into register over 3 -> the sheet settles (a damped jolt through zoom)
      const an = o.antic ?? 12, sl = o.slideAt != null ? Math.round(o.slideAt * fps) - Math.round(o.hitT * fps) : null, sd = o.slideFrames || 10;
      if (sl != null && o.from && k < sl) {                          // the plate slide lands on its own onset
        const u = Math.min(1, Math.max(0, (k - (sl - sd)) / sd)); phase = u <= 0 ? 'before' : 'slide';
        this.transition(ctx, o.from, 'KLUTSIS', t, 1 - Math.pow(1 - u, 2.2), { ...o, a: o.fromOpts || {}, b: { ...o, evt: 1 }, hold: true, mode: 'slide' });
        this.stats.ms = performance.now() - t0; return { phase, k };
      }
      const hold = o.hold ?? 3, OFF = [[-2.6, 1.3], [-1.5, 0.75], [-1, 0.5], [-0.5, 0.25], [-0.18, 0.09]];   // x 12 px: off-axis on the 30-degree band
      let lift = 0, imp = 0, zoom = zb, koff = null, peel = -2;
      const creep = k >= 0 ? 1 : k >= -an ? (k + an + 1) / an : 0;   // c2b: the camera creeps in linearly through the whole anticipation (a held breath that still moves)
      if (k < 0 && k >= -an) { const x = (k + an + 1) / an; lift = x * x * (3 - 2 * x); phase = 'antic'; if (k >= -2) lift = 1.15; }
      else if (k >= 0 && k < hold) { imp = 1; phase = 'act'; lift = 1.15 * (1 - k / hold); }
      else if (k >= hold && k < hold + OFF.length) { imp = 2; phase = 'act'; koff = OFF[k - hold].map(v => v * 12); peel = (k - hold + 1) / (OFF.length + 1); }
      const push = 1 + 0.02 * Math.min(1, lift) + (o.creep ?? 0.05) * creep;
      zoom = [zb[0] * push, zb[1], zb[2]];
      if (k >= hold) { const j = settle(k - hold, 7); zoom = [zb[0] * (1 + (o.creep ?? 0.05) + 0.0035 * Math.abs(j) / 7), zb[1], zb[2] + j / 1920]; if (k >= hold + OFF.length) phase = k < 20 ? 'follow' : 'after'; }
      this._look('KLUTSIS', t, { ...o, evt: 1, imp, lift, zoom, fps, koff, peel }, null);
    } else if (name === 'SERIGRAPH') {
      // c2b: flood (nothing prints) -> 3 pulls of the light plates (ochre, brick, slate), each only through its stencil,
      // behind a 32 px blade with a rolling bead of its own ink -> the ink key is pulled under the mesh (a faint ghost) ->
      // ON the hit the screen lifts and the key lands whole (figures, hero shadows, the words): the biggest change of the act
      const pulls = o.pulls || [9, 8, 6, 5], flood = o.flood ?? 8, start = -pulls.reduce((a, b) => a + b, 0), fs = start - flood;
      const q = { fronts: [0, 0, 0, 0], key: 0.12, mesh: 0, blade: -1, plate: 1, bead: 0, dir: 1, mis: 1 };
      if (k < fs) { phase = 'before'; this.apply(ctx, o.from || 'SERIGRAPH', t, o.fromOpts || o); this.stats.ms = performance.now() - t0; return { phase, k }; }
      if (k < start) { phase = 'antic'; const u = ease((k - fs + 1) / flood); q.blade = 1.02 - u * 1.06; q.dir = -1; q.mesh = 0.35 + 0.65 * u; q.bead = 30 - 6 * u; q.plate = 1; }
      else if (k < 0) {
        phase = 'act'; q.mesh = 1; let a = start;
        for (let p = 0; p < 4; p++) { const d = pulls[p];
          if (k >= a + d) { q.fronts[p] = 1.1; a += d; continue; }
          const u = (k - a + 1) / d, f = -0.02 + 1.06 * Math.pow(u, 1.6);        // each pull accelerates into its end
          q.fronts[p] = f; q.blade = f; q.plate = p + 1; q.bead = 26 - 4 * p; break; }
      } else {
        q.fronts = [1.1, 1.1, 1.1, 1.1]; q.key = 1;                          // the screen springs back: the key plate lands ON the hit
        q.mesh = k === 0 ? 0.3 : k === 1 ? 0.12 : 0; q.mis = 1 + settle(k, 2.4, 4);
        phase = k < 2 ? 'act' : k < 16 ? 'follow' : 'after';
      }
      let below = null;
      if (q.fronts[0] < 1.05 || phase === 'antic') { this._look(o.from || 'SERIGRAPH', t, { ...(o.fromOpts || o) }, 'lk_A'); below = P.targets.lk_A.tex; }
      const zoom = k >= 0 ? [zb[0], zb[1], zb[2] + settle(k, 3, 3) / 1920] : zb;
      this._look('SERIGRAPH', t, { ...o, evt: 1, sq: q, below: below || P.dummy, zoom, fps }, null);
    } else if (name === 'SODIUM') {
      // c2b: the colour event. The night is amber monochrome; a full-spectrum beam (a truck's headlights, o.beam
      // [x, y, r] px y-down, o.beamFrom the approach start) swings in through the anticipation as a small white-hot spot
      // (colour barely returning), and ON the hit the real colour lands inside the whole beam - the red banner, the green
      // sign - then holds and falls back to amber over ~20 frames, the spot object keeping its colour longest
      const an = o.antic ?? 8, bm = o.beam || [540, 900, 700], from = o.beamFrom || [bm[0] + 380, bm[1] + 500];
      let colev = 0, beam = bm;
      if (k < 0 && k >= -an) { const x = (k + an + 1) / an; phase = 'antic'; colev = 0.25 * x;
        beam = [from[0] + (bm[0] - from[0]) * x, from[1] + (bm[1] - from[1]) * x, bm[2] * (0.12 + 0.18 * x), bm[3] ?? 1]; }
      else if (k >= 0) { phase = k < 3 ? 'act' : k < 20 ? 'follow' : 'after'; colev = k < 4 ? 1 : Math.max(0.35, 1 - (k - 4) / 22); beam = [bm[0] + (o.sweep ?? (bm[3] === 2 ? 7 : 0)) * k, bm[1], bm[2] * (k < 4 ? 1 : Math.max(0.55, 1 - (k - 4) / 40)), bm[3] ?? 1]; }   // mode 2: the searchlight keeps sweeping (px / frame)
      const zoom = k >= 0 ? [zb[0] * (1 + 0.006 * Math.exp(-k / 5)), zb[1], zb[2]] : zb;
      this._look('SODIUM', t, { ...o, colev, beam, zoom, fps }, null);
    } else { this._look(name, t, o, null); }
    P.draw(ctx, null); this._light(ctx);
    this.stats.ms = performance.now() - t0;
    return { phase, k };
  }
  // light type stays the brightest value class of the frame, whatever the look did underneath
  _light(ctx) {
    if (!this.typeLight || !ctx) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'lighten';
    ctx.drawImage(this.typeLight, 0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
  }
}

// ------------------------------------------------------------------ INKWASH (MODELING c2): line and wash for MODELLED subjects
// A look that needs what a luminance plan cannot give: part ids, creases and the true silhouette from a real G-buffer of a three.js scene
// (lib/fx/modeling/inkwash.js; kit in lib/fx/modeling/mecha/). Even pen line, flat local colour, a cool wash in the shade, pigment pooling at wash edges,
// paper left white where the light is. Reference: the ACP fortress painting (videos/sources/acp_fortress.jpg). Additive: LOOKS / LOOK_NAMES are
// unchanged (INKWASH is not a plan recipe, so no existing loop over LOOK_NAMES can reach it).
//   const InkWash = await loadInkWash(); const ink = new InkWash(renderer, 1080, 1920, { paper, sky: [top, horizon], lightInk: false });
//   applyInkWash(ink, scene, camera, ctx, t);            // draws the finished drawing into a 2D ctx
//   ink.aux(scene, camera, { near, far })                // the same pass as a looks.js `aux` canvas, so the model prints through any recipe above
// (lazy: inkwash.js imports 'three', and not every piece page maps it, so looks.js must not import it statically)
export const loadInkWash = async () => (await import('./modeling/inkwash.js')).InkWash;
export const MODEL_LOOKS = { INKWASH: { medium: 'line-and-wash', owners: ['MECHA PROLETARIAT (proposed)', 'any modelled machine'], note: 'ligne claire from the G-buffer, flat colour, watercolour wash; red only in the mark' } };
export function applyInkWash(ink, scene, camera, ctx, t = 0) { ink.render(scene, camera, { t }); ctx.drawImage(ink.r.domElement, 0, 0, ctx.canvas.width, ctx.canvas.height); return ink; }

// the brief's one-call form: applyLook(name, sources, t, k) on a shared instance, drawn into k.ctx
let SHARED = null;
export function applyLook(name, src, t, k = {}) {
  SHARED ||= new Looks();
  SHARED.source(src, k.keys || {});
  SHARED.apply(k.ctx, name, t, k);
  return SHARED;
}

// ------------------------------------------------------------------ aux for 2D scenes
// A 2D scene already draws its layers separately (sky, far rank, figure, flag, type): hand them over as classes and
// relative depths and get the aux canvas the plan reads. Layers are drawn far to near; alpha > 0.5 claims the texel.
//   const aux = auxFromLayers([{ canvas: farRank, cls: 'far', depth: 0.7 }, { canvas: rider, cls: 'subject', depth: 0.2 },
//                              { canvas: flag, cls: 'spot', depth: 0.25 }]);   // depth 0 (near) .. 1 (far); sky = none
//   lk.source({ color, aux, depth: [1, Math.E ** 4] }) - with depth [1, e^4] a 0.03 cutKT is a ~12% depth step
const CLS = { ground: 0, far: 64, mid: 128, spot: 180, subject: 255 };
let _auxC = null;
export function auxFromLayers(layers, { w = 540, h = 960 } = {}) {
  const c = _auxC && _auxC.width === w ? _auxC : (_auxC = Object.assign(document.createElement('canvas'), { width: w, height: h }));
  const g = c.getContext('2d', { willReadFrequently: true }), out = g.createImageData(w, h), D = out.data;
  for (let j = 0; j < w * h; j++) { D[j * 4] = 255; D[j * 4 + 1] = 255; D[j * 4 + 2] = 0; D[j * 4 + 3] = 255; }
  const t = document.createElement('canvas'); t.width = w; t.height = h; const tg = t.getContext('2d', { willReadFrequently: true });
  for (const L of layers) {
    tg.clearRect(0, 0, w, h); tg.drawImage(L.canvas, 0, 0, w, h); const A = tg.getImageData(0, 0, w, h).data;
    const l = Math.round(65534 * Math.min(1, Math.max(0, L.depth ?? 0.5))), cls = CLS[L.cls] ?? 128;
    for (let j = 0; j < w * h; j++) if (A[j * 4 + 3] > 127) { D[j * 4] = l >> 8; D[j * 4 + 1] = l & 255; D[j * 4 + 2] = cls; }
  }
  g.putImageData(out, 0, 0); return c;
}
