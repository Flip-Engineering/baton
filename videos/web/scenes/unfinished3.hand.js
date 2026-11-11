// 1776 v8: the writing hand and its quill, ray-marched once at load into sprites (colour + height), then laid on the
// desk by unfinished3.js with parallax (the camera ray is marched against the height sprite) and real depth of field.
// World units are centimetres: X right, Y up the page, Z up off the paper; the nib touches the paper at the origin.
//
// A RIGHT hand in a tripod grip, seen from above (the writer sits below the page, the arm comes in from the lower right):
//  - the pen frame: D runs up the shaft from the nib toward the writer's shoulder, U is 'up' square to the shaft, and
//    S = D x U points to the writer's LEFT of the shaft (down-left on the page): the thumb side;
//  - the index finger lies on top of the shaft, the thumb opposes it on the left, the middle finger carries it from below
//    on the right; ring and little finger curl under the palm, the little finger's edge on the sheet; the back of the
//    hand faces up and a little away from the thumb (the hand rests rolled onto its little-finger edge);
//  - the quill is a goose primary: an amber horn barrel cut to a split, inked nib, a white rachis that bows a little
//    away from the arm, a narrow leading vane and a wide trailing vane of barbs with splits and a downy base;
//  - the sleeve runs out of every frame: a 1776 gathered-linen shirt cuff under a blue broadcloth coat with a deep
//    turned-back cuff and two buttons, or a 2024 duck-canvas work jacket (weave, triple stitching, frayed cuff).
// renderHand({ sleeve, px, box, mode }) -> { cv, cmPx, box }; mode 'color' (premultiplied RGBA: the hand, the quill
// and their soft shadow on the paper) or 'height' (R + G/255 = height above the paper / 32 cm; B = 1 where solid)
const nrm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const add = (...vs) => vs.reduce((a, b) => a.map((x, i) => x + b[i]));
const sub = (a, b) => a.map((x, i) => x - b[i]);
const mul = (v, s) => v.map(x => x * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const f3 = v => `vec3(${v.map(x => (+x).toFixed(4)).join(',')})`;
const f1 = x => (+x).toFixed(4);

// ---------------------------------------------------------------- the pen frame
const ELEV = 44 * Math.PI / 180, AZ = -40 * Math.PI / 180;
const D = [Math.cos(AZ) * Math.cos(ELEV), Math.sin(AZ) * Math.cos(ELEV), Math.sin(ELEV)];
const U = nrm(add([0, 0, 1], mul(D, -D[2])));
const S = nrm(cross(D, U));                                             // the thumb side (writer's left of the shaft)
const P = (a, u, s) => add(mul(D, a), mul(U, u), mul(S, s));
const VW = S;                                                           // the vane's width direction (level across)
const CURVE = 0.0022;                                                   // the rachis bows away from the arm (-S)

// ---------------------------------------------------------------- the grip (pen frame a, u, s; radii in cm)
// chains run knuckle (MCP) -> PIP -> DIP -> tip centre; the thumb runs CMC -> MCP -> IP -> tip
export const POSE = {
  index: [[9.4, 1.55, -1.55, 0.98], [7.05, 2.55, -0.95, 0.8], [4.95, 1.55, -0.42, 0.68], [3.05, 0.78, -0.18, 0.6]],
  middle: [[9.75, 0.05, -3.35, 1.02], [7.0, -0.35, -2.75, 0.84], [4.8, -1.15, -1.5, 0.71], [2.9, -0.75, -0.5, 0.62]],
  ring: [[9.85, -1.45, -4.85, 0.96], [7.55, -2.65, -5.0, 0.8], [6.3, -4.2, -4.6, 0.68], [6.95, -5.25, -4.05, 0.58]],
  little: [[9.8, -2.95, -6.1, 0.86], [8.05, -4.35, -6.35, 0.72], [7.45, -5.65, -5.95, 0.61], [8.1, -6.4, -5.35, 0.53]],
  thumb: [[13.2, -3.9, 1.6, 1.15], [9.3, -0.35, 2.45, 1.08], [6.35, 0.2, 1.95, 0.9], [3.75, 0.3, 0.98, 0.78]],
  wrist: [16.2, -7.6, -3.0],
};

function build(sleeve) {
  // the 2024 hand is a working hand: thicker fingers and heavier knuckles (the 1776 hand is the engrosser's)
  const heavy = sleeve === '2024' ? 1.08 : 1;
  const J = {}; for (const k of ['index', 'middle', 'ring', 'little', 'thumb']) J[k] = POSE[k].map(([a, u, s, r], i) => ({ p: P(a, u, s), r: r * (i < 3 ? heavy : 1 + (heavy - 1) * 0.6) }));
  const WR = P(...POSE.wrist);
  // the back of the hand: square to the plane through the index and little knuckles and the wrist, facing up
  let NH = nrm(cross(sub(J.index[0].p, WR), sub(J.little[0].p, WR))); if (NH[2] < 0) NH = mul(NH, -1);
  // the forearm leaves the wrist toward the lower right, level with the desk, then keeps going out of frame
  const ARMD = nrm([0.6, -0.8, 0.05]);
  const EL = add(WR, mul(ARMD, 30)), FAR = add(EL, mul(nrm([0.58, -0.81, 0.1]), 95));
  const dors = (dir, hint = NH) => nrm(sub(hint, mul(dir, dot(hint, dir))));
  const fingers = {};
  for (const [k, ch] of Object.entries(J)) {
    const dirs = ch.slice(1).map((j, i) => nrm(sub(j.p, ch[i].p)));
    const hint = k === 'thumb' ? nrm(add(mul(S, 0.75), mul(NH, 0.35), mul(U, 0.3))) : NH;
    fingers[k] = { ch, dirs, nail: dors(dirs[2], hint), joints: [1, 2].map(i => ({ p: ch[i].p, r: ch[i].r, d: nrm(add(dirs[i - 1], dirs[i])), n: dors(nrm(add(dirs[i - 1], dirs[i])), hint) })) };
  }
  return { J, WR, NH, ARMD, EL, FAR, fingers, SL: sleeve === '1776' };
}

function glsl(sleeve) {
  const B = build(sleeve), { J, WR, NH, EL, FAR, fingers, SL } = B;
  const K = ['index', 'middle', 'ring', 'little'];
  const segs = k => J[k].slice(0, 3).map((j, i) => `d=min(d,sdRC(p,${f3(j.p)},${f3(J[k][i + 1].p)},${f1(j.r)},${f1(J[k][i + 1].r)}));`).join('');
  const finger = k => {
    const F = fingers[k], t = J[k][3], dT = F.dirs[2];
    return `{float d=1e5;${segs(k)}` +
      // joint swell (dorsal) and the fingertip pad (palmar)
      F.joints.map(j => `d=smin(d,length(p-${f3(add(j.p, mul(j.n, j.r * 0.18)))})-${f1(j.r * 1.02)},.1);`).join('') +
      `d=smin(d,length(p-${f3(add(t.p, mul(F.nail, -t.r * 0.18), mul(dT, -t.r * 0.1)))})-${f1(t.r * 0.98)},.12);` +
      `if(d<fing){fing=d;FI=${K.indexOf(k)}.;}` +
      // the nail: a thin shell set into the dorsal tip
      `{vec3 q=p-${f3(add(t.p, mul(dT, -t.r * 0.36), mul(F.nail, t.r * 0.9)))};` +
      `float e=sdE(vec3(dot(q,${f3(nrm(cross(dT, F.nail)))}),dot(q,${f3(dT)}),dot(q,${f3(F.nail)})),vec3(${f1(t.r * 0.74)},${f1(t.r * (SL ? 1.08 : 0.92))},${f1(t.r * 0.2)}));nail=min(nail,e);}}`;
  };
  // the palm: capsules from each knuckle back to the heel, knuckle heads, a slab, tendons, the thenar mound, the web
  const heel = k => add(WR, mul(sub(J[k][0].p, WR), 0.18), mul(NH, 0.25));
  const palm = K.map(k => `pl=smin(pl,sdRC(p,${f3(J[k][0].p)},${f3(heel(k))},${f1(J[k][0].r * 1.02)},1.55),1.25);`).join('');
  const tendons = K.map(k => `tn=min(tn,sdCap(p,${f3(add(J[k][0].p, mul(NH, J[k][0].r * 0.72)))},${f3(add(WR, mul(sub(J[k][0].p, WR), 0.3), mul(NH, 1.62)))},.2));`).join('');
  const knuckles = K.map(k => `pl=smin(pl,length(p-${f3(add(J[k][0].p, mul(NH, 0.3), mul(fingers[k].dirs[0], -0.2)))})-${f1(J[k][0].r * 0.9)},.45);`).join('');
  const th = J.thumb, TF = fingers.thumb;
  const thenar = add(mul(add(th[0].p, th[1].p, J.index[0].p), 1 / 3), mul(NH, -1.1));
  // detail tables for shading: finger joints (PIP, DIP, thumb IP) as centre, axis, dorsal, radius
  const JN = []; for (const k of [...K, 'thumb']) for (const j of fingers[k].joints.slice(k === 'thumb' ? 1 : 0)) JN.push(j);
  const jdecl = `const int NJ=${JN.length};const vec3 JP[${JN.length}]=vec3[](${JN.map(j => f3(j.p)).join(',')});` +
    `const vec3 JD[${JN.length}]=vec3[](${JN.map(j => f3(j.d)).join(',')});const vec3 JNn[${JN.length}]=vec3[](${JN.map(j => f3(j.n)).join(',')});` +
    `const float JR[${JN.length}]=float[](${JN.map(j => f1(j.r)).join(',')});`;
  // veins on the back of the hand: branching lines from the wrist toward the gaps between the knuckles
  const vA = add(WR, mul(NH, 1.9), mul(sub(J.index[0].p, WR), 0.12)), vM = add(mul(add(J.index[0].p, J.middle[0].p), 0.5), mul(NH, 1.05)),
    vB = add(mul(add(J.middle[0].p, J.ring[0].p), 0.5), mul(NH, 0.95)), vJ = add(mul(add(vA, vM), 0.5), mul(NH, 0.2), mul(sub(J.ring[0].p, J.index[0].p), 0.1));
  const vC = add(WR, mul(NH, 1.7), mul(sub(J.little[0].p, WR), 0.1)), vD = add(mul(add(J.ring[0].p, J.little[0].p), 0.5), mul(NH, 0.8));
  const ax = nrm(sub(EL, WR));
  const scarP = add(J.index[0].p, mul(NH, 0.9), mul(sub(WR, J.index[0].p), 0.28)), scarA = nrm(sub(J.middle[0].p, WR)), scarN = nrm(cross(NH, scarA));
  return `#version 300 es
precision highp float;
uniform vec4 uBox; uniform vec2 uRes; uniform int uMode; uniform vec3 uView;
out vec4 o;
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float sdRC(vec3 p,vec3 a,vec3 b,float r1,float r2){vec3 ba=b-a;float l2=dot(ba,ba),rr=r1-r2,a2=l2-rr*rr,il2=1./l2;vec3 pa=p-a;
  float y=dot(pa,ba),z=y-l2;vec3 xv=pa*l2-ba*y;float x2=dot(xv,xv),y2=y*y*l2,z2=z*z*l2,k=sign(rr)*rr*rr*x2;
  if(sign(z)*a2*z2>k)return sqrt(x2+z2)*il2-r2;if(sign(y)*a2*y2<k)return sqrt(x2+y2)*il2-r1;return(sqrt(x2*a2*il2)+y*rr)*il2-r1;}
float sdCap(vec3 p,vec3 a,vec3 b,float r){vec3 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h)-r;}
float sdSeg(vec3 p,vec3 a,vec3 b){vec3 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}
float sdE(vec3 p,vec3 r){float k0=length(p/r),k1=length(p/(r*r));return k0*(k0-1.)/k1;}
float h31(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float vn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
  return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*vn(p);p*=2.03;a*=.5;}return s;}
const vec3 PD=${f3(D)}, PU=${f3(U)}, PS=${f3(S)}, VW=${f3(VW)}, NH=${f3(NH)};
const vec3 WR=${f3(WR)}, EL=${f3(EL)}, FAR=${f3(FAR)}, AX=${f3(ax)};
const bool SL=${SL};
${jdecl}
// the shaft: horn barrel cut to a split nib, then the rachis; it bows a little away from the arm
vec3 shaftPt(float a){return PD*a-VW*${f1(CURVE)}*a*a;}
float shaft(vec3 p){float a=clamp(dot(p,PD),0.,34.);vec3 r=p-shaftPt(a);
  float rad=a<1.7?mix(.03,.36,smoothstep(0.,1.7,a)):a<9.?.37:mix(.31,.06,clamp((a-9.)/25.,0.,1.));
  float d=length(r)-rad; if(a<1.7){d=max(d,-(dot(r,PU)+.12-.26*(1.7-a)));}      // the nib's scoop
  return max(d,-dot(p,PD)-.02);}
float MAT, FI;
float body(vec3 p){
  float fing=1e5,nail=1e5,pl=1e5,tn=1e5; FI=-1.;
  ${K.map(finger).join('\n  ')}
  ${palm}
  ${knuckles}
  pl=smin(pl,sdE(p-${f3(add(mul(add(heel('middle'), heel('ring'), J.middle[0].p, J.ring[0].p), 0.25), mul(NH, -0.35)))},vec3(3.4,3.2,2.)),1.3);
  ${tendons}
  pl=smin(pl,tn,.35);
  // the thumb: the thenar mound, the metacarpal, then the two phalanges
  float tb=sdRC(p,${f3(th[0].p)},${f3(th[1].p)},${f1(th[0].r)},${f1(th[1].r)});
  tb=smin(tb,sdRC(p,${f3(th[1].p)},${f3(th[2].p)},${f1(th[1].r)},${f1(th[2].r)}),.18);
  tb=smin(tb,sdRC(p,${f3(th[2].p)},${f3(th[3].p)},${f1(th[2].r)},${f1(th[3].r)}),.14);
  tb=smin(tb,length(p-${f3(add(TF.joints[1].p, mul(TF.joints[1].n, 0.15)))})-${f1(th[2].r * 1.03)},.1);
  tb=smin(tb,sdE(p-${f3(thenar)},vec3(1.8,1.5,1.2)),.9);
  tb=smin(tb,sdRC(p,${f3(th[0].p)},${f3(add(WR, mul(S, 1.3), mul(NH, -0.4)))},${f1(th[0].r)},2.1),1.2);   // the thenar runs back into the wrist
  if(tb<fing){fing=tb;FI=4.;}
  {vec3 q=p-${f3(add(th[3].p, mul(TF.dirs[2], -th[3].r * 0.35), mul(TF.nail, th[3].r * 0.88)))};
   nail=min(nail,sdE(vec3(dot(q,${f3(nrm(cross(TF.dirs[2], TF.nail)))}),dot(q,${f3(TF.dirs[2])}),dot(q,${f3(TF.nail)})),vec3(${f1(th[3].r * 0.78)},${f1(th[3].r * 1.0)},${f1(th[3].r * 0.19)})));}
  float web=sdRC(p,${f3(th[1].p)},${f3(P(9.7, -1.05, -0.8))},.78,.9);        // the web between thumb and index, under the shaft
  web=smin(web,sdRC(p,${f3(P(11.2, -2.3, 1.2))},${f3(P(11.8, -1.7, -1.9))},1.05,1.2),.8);
  float hand=smin(pl,fing,.7); hand=smin(hand,web,.9); hand=smin(hand,tb,.6);
  float arm=sdRC(p,WR,EL,2.7,3.6); arm=smin(arm,sdRC(p,EL,FAR,3.6,5.2),2.);
  hand=smin(hand,arm,1.6);
  hand+=.006*(vn(p*9.)-.5);
  // the sleeve
  vec3 w=p-WR; float al=dot(w,AX); vec3 rr=w-AX*al; float ang=atan(dot(rr,cross(AX,vec3(0,0,1))),rr.z);
  float sl, sm=0.;
  float farS=sdRC(p,EL+AX*1.,FAR,SL?5.:4.9,SL?6.6:6.4);                          // past the elbow: the upper sleeve
  if(SL){
    // gathered linen: a frill flaring out of the coat cuff over the wrist, in soft pleats (a thin shell)
    float fr=sdRC(p,WR+AX*.6,WR+AX*4.2,3.35,3.05)-.2*sin(ang*9.+al*1.2)-.08*sin(ang*21.+1.3)-.35*smoothstep(3.2,.8,al);
    fr=max(fr,-(al-.4)); fr=max(fr,-fr-.09);
    // the broadcloth sleeve, and its deep turned-back cuff with a lip and two buttons
    float coat=sdRC(p,WR+AX*3.4,EL,3.75,4.5)-.1*sin(ang*3.+al*.7)-.05*sin(ang*7.+al*1.9);
    float cuff=max(sdRC(p,WR+AX*3.,WR+AX*11.,4.15,4.45),abs(al-7.)-4.)-.06*smoothstep(.3,0.,abs(al-3.1));
    coat=min(coat,cuff); coat=smin(coat,farS,2.);
    float btn=1e5; for(int i=0;i<2;i++){vec3 c=WR+AX*(5.6+float(i)*2.6)+normalize(vec3(0,0,1)-AX*AX.z)*4.3+cross(AX,vec3(0,0,1))*.35;
      btn=min(btn,sdE(p-c,vec3(.62,.62,.34)));}
    sl=min(min(fr,coat),btn);
    sm=sl==fr?4.:sl==btn?6.:5.;
  } else {
    // duck canvas: a buttoned cuff band, the sleeve bunched in soft folds above it
    float band=max(sdRC(p,WR+AX*1.6,WR+AX*5.1,3.25,3.3),abs(al-3.35)-1.75);
    float coat=sdRC(p,WR+AX*4.8,EL,3.55,4.4)-(.14*sin(al*1.35+.9*sin(ang*2.+al*.3))+.09*sin(ang*3.+al*.5))*smoothstep(4.5,8.,al)*(1.-.5*smoothstep(16.,26.,al))-.03*sin(ang*11.+al*2.);
    coat=smin(coat,farS,2.2); coat=max(coat,-(al-1.5));
    float btn=sdE(p-(WR+AX*3.35+normalize(vec3(0,0,1)-AX*AX.z)*3.3+cross(AX,vec3(0,0,1))*.9),vec3(.55,.55,.3));
    sl=min(min(band,coat),btn); sm=sl==btn?6.:sl==band?7.:5.;
  }
  float sh=shaft(p);
  float d=min(min(hand,sl),min(sh,nail));
  MAT=d==sh?3.:d==nail?1.:d==sl?sm:0.;
  return d;}
float map(vec3 p){return body(p);}
vec3 nor(vec3 p){vec2 e=vec2(.003,-.003);return normalize(e.xyy*map(p+e.xyy)+e.yyx*map(p+e.yyx)+e.yxy*map(p+e.yxy)+e.xxx*map(p+e.xxx));}
const vec3 LD=normalize(vec3(-.55,.5,.62));                // the candle: upper left, low
float soft(vec3 ro,vec3 rd){float r=1.,t=.05;for(int i=0;i<44;i++){float h=map(ro+rd*t);r=min(r,10.*h/t);t+=clamp(h,.03,.9);if(r<.002||t>45.)break;}return clamp(r,0.,1.);}
// the vane: a thin sheet through the rachis (ray-plane), level across; barbs, splits and the downy base as texture
const vec3 VN=normalize(cross(PD,VW));
bool vane(vec3 ro,vec3 rd,out float t,out vec4 col){
  float den=dot(rd,VN); if(abs(den)<1e-4)return false; t=-dot(ro,VN)/den; if(t<0.)return false;
  vec3 p=ro+rd*t; float a=dot(p,PD); float s=dot(p,VW)+${f1(CURVE)}*a*a;           // across the vane, from the bowed rachis
  if(a<10.||a>34.)return false;
  float u=(a-10.)/24.;
  float wide=s<0.?1.:0.;                                      // the wide trailing vane on the side away from the arm
  float wA=3.3*pow(sin(3.1416*min(1.,u*1.03)),.45)*(1.-.18*u), wB=1.15*pow(sin(3.1416*min(1.,u*1.05)),.6);
  float as=abs(s), barb=a-as*(wide>.5?1.4:1.1);               // barbs sweep out toward the tip
  // the barbs cling in bundles; some bundles part, leaving a split; each bundle ends at its own length
  float bc=barb*2.1+.9*vn(vec3(barb*.6,wide*7.,1.)), bf=fract(bc), rnd=h31(vec3(floor(bc),wide*13.,3.));
  float w=(wide>.5?wA:wB)*(.84+.16*rnd);
  if(as>w||as<.05)return false;
  if(rnd>.86&&min(bf,1.-bf)<.06+.3*(rnd-.86)&&as>w*.62)return false;       // notches at the edge
  float st=.5+.5*sin(barb*40.+vn(vec3(barb*5.,as*3.,1.))*4.);
  vec3 c=mix(vec3(.96,.94,.9),vec3(.8,.77,.72),.35*fbm(vec3(barb*1.5,as*1.2,wide*4.)));
  c*=.93+.07*st; c*=.88+.12*smoothstep(0.,.22,min(bf,1.-bf));
  if(u>.62&&wide>.5) c*=mix(1.,.72,smoothstep(.62,.95,u)*(.6+.4*sin(barb*1.3)));   // a grey bar toward the tip
  float ef=smoothstep(w*.72,w,as), al=mix(.95,.3,ef*ef)*(.86+.14*st);
  if(u<.12){ float fl=smoothstep(.12,0.,u); al*=1.-.6*fl*(.5+.5*sin(barb*90.+as*25.)); c=mix(c,vec3(.98,.97,.95),fl*.7); }   // downy afterfeather
  col=vec4(c,al); return true;}
// fine detail on the skin (shading only): creases over the finger joints, veins
float creases(vec3 p){float b=0.;
  for(int i=0;i<NJ;i++){vec3 q=p-JP[i];float t=dot(q,JD[i]);vec3 rq=q-JD[i]*t;float dors=dot(normalize(rq+1e-5),JNn[i]);
    float w=exp(-t*t/(JR[i]*JR[i]*.3))*smoothstep(.25,.8,dors)*(.4+.6*vn(q*3.+float(i)));
    b+=w*(.6+.4*vn(q*5.))*smoothstep(.35,.9,.5+.5*sin(t*26./JR[i]+(dot(rq,cross(JD[i],JNn[i])))*3.+vn(q*6.)*2.5));}
  return b;}
float veins(vec3 p){
  float d=min(min(sdSeg(p,${f3(vA)},${f3(vJ)}),sdSeg(p,${f3(vJ)},${f3(vM)})),min(sdSeg(p,${f3(vJ)},${f3(vB)}),sdSeg(p,${f3(vC)},${f3(vD)})));
  d+=.12*(vn(p*3.)-.5); return smoothstep(.34,0.,d);}
void main(){
  // the sprite is parametrised by where the viewing ray meets the paper: seen along uView (the scene camera's mean
  // direction), so the hand's parallax and its overhangs (the quill) are baked for the way the camera looks at it
  vec2 uv=gl_FragCoord.xy/uRes; vec3 pg=vec3(mix(uBox.x,uBox.z,uv.x),mix(uBox.y,uBox.w,uv.y),0.); vec3 rd=uView;
  float tmax=70./-rd.z; vec3 ro=pg-rd*tmax;
  float t=0.,h; bool hit=false;
  for(int i=0;i<240;i++){h=map(ro+rd*t);if(h<.002){hit=true;break;}t+=h*.9;if(t>tmax+1.)break;}
  float tv; vec4 vc; bool hv=vane(ro,rd,tv,vc)&&(!hit||tv<t);
  if(uMode==1){                                              // height (cm above the paper), 16-bit in R,G; B = solid
    float z=hit?(ro+rd*t).z:0.; if(hv&&vc.a>.3) z=max(z,(ro+rd*tv).z); z=clamp(z/32.,0.,.99998);
    float hi=floor(z*255.)/255.; o=vec4(hi,(z-hi)*255.,(hit||(hv&&vc.a>.3))?1.:0.,1.); return; }
  vec3 col=vec3(0); float alpha=0.;
  if(hit){vec3 p=ro+rd*t,n=nor(p);map(p);float m=MAT,fi=FI;
    float sh=soft(p+n*.02,LD); float tvs; vec4 vs; if(vane(p+n*.02,LD,tvs,vs))sh*=1.-.8*vs.a;
    float ao=0.;for(int k=1;k<6;k++){float hh=.16*float(k);ao+=(hh-map(p+n*hh))/pow(2.,float(k));}ao=clamp(1.-1.7*ao,0.,1.);
    vec3 key=vec3(1.,.8,.6)*1.35, fill=vec3(.22,.23,.3)*.6;
    vec3 alb; float spec=0., rough=24.;
    if(m==0.){                                               // skin
      vec2 e=vec2(.01,0.); float c0=creases(p);
      vec3 g=vec3(creases(p+e.xyy)-c0,creases(p+e.yxy)-c0,creases(p+e.yyx)-c0)/.01;
      float vv=veins(p); vec3 vg=vec3(veins(p+e.xyy)-vv,veins(p+e.yxy)-vv,veins(p+e.yyx)-vv)/.01;
      vec3 pn=vec3(vn(p*28.),vn(p*28.+7.),vn(p*28.+13.))-.5;                    // pores
      n=normalize(n+.0016*g-.05*vg*(SL?.6:1.)+pn*.04);
      alb=SL?vec3(.76,.6,.54):vec3(.64,.47,.37);
      alb*=.92+.14*fbm(p*1.5);
      alb=mix(alb,alb*vec3(1.05,.8,.78),.55*smoothstep(.45,.85,fbm(p*2.2+3.)));   // blotches
      float kn=0.; for(int i=0;i<NJ;i++) kn=max(kn,exp(-dot(p-JP[i],p-JP[i])/(JR[i]*JR[i]*1.3)));
      alb=mix(alb,alb*vec3(1.08,.8,.78),.55*kn);             // redder over the knuckles
      alb*=1.-.16*clamp(c0,0.,1.);                             // the creases hold shadow
      alb=mix(alb,alb*vec3(.8,.86,1.05),.5*vv);                // a blue cast over the veins
      ${SL ? '' : `{float sc=smoothstep(.12,0.,abs(dot(p-${f3(scarP)},${f3(scarN)})))*step(abs(dot(p-${f3(scarP)},${f3(scarA)})),1.2);
        alb=mix(alb,vec3(.8,.62,.56),.6*sc);}                                                                   // an old work scar`}
      float ndl=dot(n,LD);
      vec3 wrap=vec3(.42,.2,.14); vec3 dif=clamp((ndl+wrap)/(1.+wrap),0.,1.);
      dif*=mix(vec3(1),vec3(1.,.55,.45),(1.-sh)*.6);           // the shadow edge warms (light under the skin)
      col=alb*(key*dif*mix(.2,1.,sh)+fill*ao)*ao;
      // light through thin flesh: fingertips and edges glow red against the candle
      float th=0.; for(int k=1;k<4;k++) th+=max(0.,-map(p-n*.25*float(k)))*.9;
      col+=alb*vec3(1.,.32,.2)*key*.3*exp(-th*2.2)*clamp(.3-ndl,0.,1.)*sh;
      spec=.28; rough=16.+10.*fbm(p*5.);
    } else if(m==1.){                                        // nail
      alb=mix(vec3(.86,.64,.58),vec3(.94,.9,.84),.35)*(.95+.08*vn(p*30.));
      ${SL ? '' : 'alb=mix(alb,vec3(.55,.45,.36),.25*vn(p*12.));'}
      col=alb*(key*max(dot(n,LD),0.)*sh+fill)*ao; spec=.8; rough=70.; }
    else if(m==3.){ float a=dot(p,PD);                       // horn barrel, inked nib, white rachis
      alb=mix(vec3(.08,.05,.03),mix(vec3(.78,.64,.4),vec3(.93,.91,.86),smoothstep(8.5,11.,a)),smoothstep(.8,2.2,a));
      alb*=.94+.08*vn(vec3(a*6.,0.,0.));
      if(a<1.4) alb=mix(alb,vec3(.02),smoothstep(.06,.0,abs(dot(p,PS))));          // the slit
      col=alb*(key*clamp((dot(n,LD)+.3)/1.3,0.,1.)*sh+fill)*ao; spec=.9; rough=60.;
      col+=alb*vec3(1.,.75,.4)*.18*step(a,9.)*step(1.8,a)*(1.-sh);                   // light through the horn
    }
    else if(m==4.){ alb=vec3(.93,.91,.86)*(.88+.1*fbm(p*9.))*(.96+.04*sin(dot(p,vec3(90.,70.,40.)))); vec3 dif=vec3(clamp((dot(n,LD)+.45)/1.45,0.,1.));
      col=alb*(key*dif*mix(.35,1.,sh)+fill)*ao; col+=alb*vec3(1.,.9,.75)*.12*(1.-sh); spec=.04; }
    else if(m==6.){ alb=SL?vec3(.74,.58,.3):vec3(.3,.26,.22); col=alb*(key*max(dot(n,LD),0.)*sh+fill)*ao; spec=SL?1.2:.5; rough=SL?50.:30.; }
    else {                                                     // cloth
      vec3 w=p-WR; float al=dot(w,AX); vec3 rr=w-AX*al; float ang=atan(dot(rr,cross(AX,vec3(0,0,1))),rr.z);
      if(SL){ alb=vec3(.075,.1,.2)*(.82+.3*fbm(p*11.))*(.95+.05*vn(p*60.));   // broadcloth: felted, faint nap
        float lip=smoothstep(.25,0.,abs(al-3.15))+smoothstep(.25,0.,abs(al-10.9));
        alb*=1.+.35*lip; alb=mix(alb,alb*1.25,smoothstep(3.,3.3,al)*smoothstep(11.,10.6,al)*.25);           // the cuff facing
        alb=mix(alb,vec3(.55,.45,.25),smoothstep(.05,0.,abs(al-3.45))*.5*step(.5,fract(ang*14.)));        // the cuff stitching
      } else {
        float weave=.5+.5*sin(al*95.)*sin(ang*100.);
        alb=vec3(.5,.36,.19)*(.8+.3*fbm(p*2.5))*(.9+.12*weave)*(.92+.1*vn(p*40.));
        alb=mix(alb,vec3(.66,.54,.36),.35*smoothstep(.55,.9,fbm(p*.9+4.)));                              // wear and fade
        float seam=abs(ang-1.9), stitch=0.;
        for(int k=0;k<3;k++) stitch=max(stitch,smoothstep(.022,0.,abs(seam-.08*float(k-1)))*step(.45,fract(al*5.+float(k)*.3)));
        alb=mix(alb,vec3(.78,.62,.32),stitch*.9);              // triple stitching down the sleeve seam
        if(m==7.){ float e=smoothstep(.35,0.,abs(al-1.6)); alb=mix(alb,vec3(.72,.6,.42),e*(.5+.5*vn(vec3(ang*30.,al*9.,1.))));   // frayed cuff edge
          for(int k=0;k<2;k++) alb=mix(alb,vec3(.78,.62,.32),smoothstep(.02,0.,abs(al-2.1-float(k)*2.5))*step(.4,fract(ang*22.))); }
      }
      float ndl=dot(n,LD);
      col=alb*(key*clamp((ndl+.25)/1.25,0.,1.)*mix(.25,1.,sh)+fill)*ao; spec=SL?.1:.05; rough=10.;
      col*=mix(1.,.28,smoothstep(26.,70.,al));                // the far sleeve falls into the writer's own shadow
    }
    vec3 hv2=normalize(LD+vec3(0,0,1)); col+=key*spec*pow(max(dot(n,hv2),0.),rough)*sh*.35;
    alpha=1.;
  }
  if(hv){ vec3 p=ro+rd*tv; float ndl=abs(dot(VN,LD)); float sh=soft(p+VN*sign(dot(VN,LD))*.05,LD);
    vec3 key=vec3(1.,.8,.6)*1.35; vec3 c=vc.rgb*(key*(.35+.65*ndl)*mix(.45,1.,sh)+vec3(.2,.2,.26)*.6);
    c+=vc.rgb*vec3(1.,.7,.4)*.28*(1.-ndl);                     // light through the vane
    col=mix(col,c,vc.a); alpha=max(alpha,vc.a); }
  if(alpha<1.){                                               // the paper under it: soft shadow and contact darkening
    vec3 p=pg; float sh=soft(p+vec3(0,0,.03),LD); float tvs; vec4 vs; if(vane(p,LD,tvs,vs))sh*=1.-.6*vs.a;
    float c=exp(-max(map(p),0.)/.2);
    float sa=clamp((1.-sh)*.55+c*.3,0.,.85);
    col=col*alpha; alpha=alpha+sa*(1.-alpha);
    o=vec4(col,alpha); return; }
  o=vec4(col,1.);
}`;
}

export const VIEW_TILT = 20;                                           // degrees from straight down, toward the page top
export function renderHand({ sleeve = '1776', px = 1100, box = [-6, -24, 27, 9], mode = 'color', tilt = VIEW_TILT } = {}) {
  const [x0, y0, x1, y1] = box, w = px, h = Math.round(px * (y1 - y0) / (x1 - x0));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: mode === 'color', alpha: true, antialias: false });
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('hand shader: ' + gl.getShaderInfoLog(s)); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2(gl_VertexID==1?3.:-1.,gl_VertexID==2?3.:-1.);gl_Position=vec4(p,0,1);}'));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, glsl(sleeve)));
  gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
  gl.useProgram(pr); gl.viewport(0, 0, w, h);
  gl.uniform4f(gl.getUniformLocation(pr, 'uBox'), x0, y0, x1, y1); gl.uniform2f(gl.getUniformLocation(pr, 'uRes'), w, h);
  gl.uniform1i(gl.getUniformLocation(pr, 'uMode'), mode === 'height' ? 1 : 0);
  const tl = tilt * Math.PI / 180; gl.uniform3f(gl.getUniformLocation(pr, 'uView'), 0, Math.sin(tl), -Math.cos(tl));
  // tiles, so a slow software rasteriser never hits the GPU watchdog
  gl.enable(gl.SCISSOR_TEST);
  const T = 96; for (let ty = 0; ty < h; ty += T) for (let tx = 0; tx < w; tx += T) { gl.scissor(tx, ty, T, T); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.finish(); }
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  if (mode === 'height') {                                     // the raw bytes (no premultiply), top row first
    const px8 = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px8);
    const g = out.getContext('2d'), id = g.createImageData(w, h);
    for (let y = 0; y < h; y++) id.data.set(px8.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    g.putImageData(id, 0, 0);
  } else out.getContext('2d').drawImage(cv, 0, 0);
  const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
  return { cv: out, cmPx: w / (x1 - x0), box, tilt };
}
