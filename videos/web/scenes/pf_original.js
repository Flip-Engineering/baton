// PRODUCTIVE FORCES (ORIGINAL) v3 (v2 + v1's hook, v1's nested Turrell Deng tunnel). The thermal original, rebuilt at native 1080x1920.
// A thermal camera's readout climbs from body heat (30 C) to the melting point of iron (Fe 1538 C) while the manifesto slams
// in two languages over 140 BPM F-minor phonk. Every picture is a real photograph of a productive force (Library of Congress
// FSA/OWI + HAER, public domain; two DOE/NIST wafer photos), heat-keyed to a temperature map (work/prep_images.py) and read
// through the camera: palette, AGC, shimmer, NUC, chroma split. One synthetic grid frame, one red Turrell break for Deng.
// The camera's last target is the ACP badge; its four stripes heat on the four cowbell hits (F Ab C F) and the lock lands on b76.
import { W, H, loadFonts, loadBeats, loadImage, clamp, lerp, ease, rng, outCanvas } from '../lib/kit.js';
import { drawMark, drawLockup, markBox } from '../lib/closer.js';

const SCENE = 'pf_original';
const A = '../assets/pf_original/';
const IMGS = ['aer_monessen', 'aer_bf8a', 'b17_final', 'a20_line', 'hotroll', 'pour_ingot', 'chips_researcher', 'utah_gen', 'Eaward',
  'b25_final', 'b25_fuse', 'lathe', 'mill_tool', 'rivet_nn', 'ship_workers', 'bf_cast_ford', 'bf_tap', 'dam_cherokee', 'ship_ways',
  'ship_cruiser', 'b17_rivet', 'ford_tool', 'aer_sinter', 'ladle_iron', 'cu_billet'];

// ------------------------------------------------------------------ the cut (beats). 140 BPM, 4 beats a bar.
// view: [cx, cy, zoom] -> [cx, cy, zoom] over the shot; subj: the hot thing the crosshair goes to (image coords 0..1)
const P = { iron: 0, rain: 1, turr: 2, white: 3 };
const SHOTS = [
  [0, 8, 'aer_monessen', P.iron, [0.28, 0.5, 1.0], [0.66, 0.5, 1.18], null, { gain: 0.95, gamma: 1.55 }],
  // v1's hook: TARGET holds one picture through b16 (the camera stops moving), a white flash, PRODUCTION on the SAME frozen picture
  [8, 18, 'aer_bf8a', P.iron, [0.42, 0.62, 1.12], [0.41, 0.60, 1.30], [0.36, 0.40], { gain: 1.0, gamma: 1.45, still: 16 }],
  // then IS NOT A SIN: the first time picture AND palette change, rainbow-hot, a second cut on the beat inside the card
  [18, 19, 'ladle_iron', P.rain, [0.45, 0.50, 1.0], [0.47, 0.52, 1.10], [0.45, 0.60], { gain: 0.80, gamma: 1.25 }],
  [19, 20, 'bf_tap', P.rain, [0.42, 0.70, 1.0], [0.50, 0.74, 1.12], [0.5, 0.78], { gain: 0.80, gamma: 1.25 }],
  [20, 24, null, P.iron],                                                       // the cold synthwave grid under NO DEGROWTH / 拒绝去增长
  [24, 26, 'pour_ingot', P.iron, [0.55, 0.55, 1.0], [0.50, 0.62, 1.2], [0.45, 0.72]],
  [26, 28, 'chips_researcher', P.rain, [0.52, 0.45, 1.0], [0.44, 0.45, 1.16], [0.44, 0.60]],
  [28, 30, 'utah_gen', P.iron, [0.35, 0.5, 1.0], [0.62, 0.5, 1.15], [0.62, 0.56]],
  [30, 32, 'Eaward', P.iron, [0.50, 0.65, 1.0], [0.50, 0.60, 1.2], [0.5, 0.7]],
  [32, 34, 'b25_final', P.rain, [0.70, 0.55, 1.0], [0.35, 0.55, 1.15], [0.62, 0.62]],
  [34, 36, 'b25_fuse', P.rain, [0.30, 0.5, 1.0], [0.62, 0.5, 1.2], [0.5, 0.5]],
  [36, 38, 'lathe', P.iron, [0.65, 0.55, 1.0], [0.78, 0.55, 1.2], [0.80, 0.62]],
  [38, 40, 'mill_tool', P.iron, [0.35, 0.50, 1.0], [0.55, 0.48, 1.18], [0.4, 0.4]],
  [40, 42, 'rivet_nn', P.iron, [0.50, 0.40, 1.0], [0.50, 0.55, 1.2], [0.4, 0.6]],
  [42, 44, 'ship_workers', P.rain, [0.50, 0.40, 1.0], [0.52, 0.5, 1.16], [0.52, 0.45]],
  [44, 46, 'bf_cast_ford', P.iron, [0.40, 0.65, 1.0], [0.60, 0.70, 1.2], [0.5, 0.75], { add: 0.06 }],
  [46, 48, 'bf_tap', P.iron, [0.42, 0.70, 1.0], [0.55, 0.78, 1.25], [0.5, 0.8], { add: 0.08 }],
  [48, 56, null, P.turr],                                                        // Deng: the red Turrell room
  [56, 57, 'dam_cherokee', P.iron, [0.50, 0.50, 1.0], [0.52, 0.52, 1.1], [0.5, 0.45], { add: 0.08 }],
  [57, 58, 'ship_ways', P.iron, [0.5, 0.5, 1.0], [0.5, 0.52, 1.12], [0.5, 0.5], { add: 0.08 }],
  [58, 59, 'ship_cruiser', P.iron, [0.5, 0.4, 1.0], [0.5, 0.52, 1.12], [0.5, 0.55], { add: 0.10 }],
  [59, 60, 'b17_rivet', P.iron, [0.45, 0.5, 1.0], [0.45, 0.5, 1.15], [0.35, 0.45], { add: 0.10 }],
  [60, 62, 'ford_tool', P.iron, [0.35, 0.5, 1.0], [0.6, 0.5, 1.12], [0.5, 0.5], { add: 0.10 }],
  [62, 64, 'aer_sinter', P.rain, [0.55, 0.45, 1.0], [0.4, 0.55, 1.12], [0.5, 0.5], { gain: 0.85, gamma: 1.25 }],
  [64, 66, 'ladle_iron', P.iron, [0.4, 0.55, 1.0], [0.5, 0.5, 1.14], [0.45, 0.65], { add: 0.18 }],
  [66, 68, 'cu_billet', P.iron, [0.55, 0.45, 1.0], [0.62, 0.45, 1.2], [0.6, 0.35], { add: 0.24 }],
  [68, 72, 'Eaward', P.iron, [0.50, 0.55, 1.18], [0.50, 0.50, 1.0], [0.5, 0.55], { add: 0.30, rise: 0.55 }],   // the crowd again, now at full heat
];

// ------------------------------------------------------------------ the words: [startBeat, endBeat, kind, lines, opts]
const WORDS = [
  [0.5, 8, 'L', ['INFRARED', 'SCAN'], { y: 700, size: 250 }],
  [2.0, 8, 'C', ['红外扫描'], { y: 1015, size: 150 }],
  [8, 16, 'L', ['PRODUCTIVE', 'FORCES'], { y: 860, size: 220, tag: 'TARGET: THE' }],
  [16, 18, 'L', ['PRODUCTION']], [18, 20, 'L', ['IS NOT', 'A SIN']], [20, 22, 'L', ['NO', 'DEGROWTH']], [22, 24, 'C', ['拒绝', '去增长']],
  [24, 26, 'L', ['MORE', 'STEEL']], [26, 28, 'L', ['MORE', 'CHIPS']], [28, 30, 'L', ['MORE', 'POWER']], [30, 32, 'L', ['MORE', 'HUMANS']],
  [32, 34, 'C', ['新质', '生产力']], [34, 36, 'L', ['NEW QUALITY', 'PRODUCTIVE', 'FORCES']],
  [36, 38, 'L', ['THE', 'MACHINE']], [38, 40, 'L', ['WORKS', 'FOR']], [40, 42, 'L', ['THE', 'WORKER']], [42, 44, 'C', ['工人', '阶级']],
  [44, 46, 'L', ['RUN', 'HOT']], [46, 48, 'L', ['RUN', 'FOREVER']],
  [56, 57, 'L', ['BUILD']], [57, 58, 'L', ['BUILD']], [58, 59, 'L', ['BUILD']],
  [60, 62, 'L', ['THE', 'FUTURE']], [62, 64, 'L', ['IS A', 'FACTORY']], [64, 68, 'C', ['未来', '是工厂']],
  [68, 72, 'L', ['HUMANITY', 'AT FULL', 'HEAT'], { hero: true }],
];

// ------------------------------------------------------------------ temperature (the argument): piecewise, monotone, ends on Fe 1538
const TK = [[0, 30], [8, 92], [16, 260], [24, 470], [32, 690], [40, 880], [48, 1010], [56, 1010], [59, 1180], [62, 1290], [66, 1420], [67.99, 1500], [68, 1538]];
function tempAt(b, kick) {
  if (b >= 68) return 1538;
  let v = TK[0][1];
  for (let i = 1; i < TK.length; i++) { if (b <= TK[i][0]) { const [b0, t0] = TK[i - 1], [b1, t1] = TK[i]; v = lerp(t0, t1, ease.inOutCubic((b - b0) / (b1 - b0)) * 0.35 + (b - b0) / (b1 - b0) * 0.65); break; } }
  return Math.min(1537.4, v + kick * 7 * (b > 16 && b < 48 || b > 56 ? 1 : 0));
}

// ------------------------------------------------------------------ GL: the camera
const VS = `#version 300 es
in vec2 a; out vec2 p; void main(){ p=a*.5+.5; gl_Position=vec4(a,0.,1.); }`;
const FS = `#version 300 es
precision highp float;
in vec2 p; out vec4 o;
uniform sampler2D T; uniform vec4 V; uniform int MODE, PAL; uniform float GAIN, GAMMA, ADD, KICK, TM, SEED, SPLIT, SHIM, COLD, GRIDT, TAU;
uniform vec4 HALO;
float h21(vec2 q){ q=fract(q*vec2(123.34,456.21)); q+=dot(q,q+45.32); return fract(q.x*q.y); }
float n2(vec2 q){ vec2 i=floor(q), f=fract(q); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 q){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*n2(q); q=q*2.03+vec2(1.7,9.2); a*=.5; } return v; }
vec3 lut(int pal, float v){ v=clamp(v,0.,1.); vec3 c[6];
  if(pal==0){ c[0]=vec3(0,0,.04);c[1]=vec3(.16,0,.43);c[2]=vec3(.59,0,.59);c[3]=vec3(.9,.2,.16);c[4]=vec3(1,.67,0);c[5]=vec3(1,1,.9); }
  else if(pal==1){ c[0]=vec3(0,0,.16);c[1]=vec3(0,.16,.78);c[2]=vec3(0,.78,.47);c[3]=vec3(.94,.94,0);c[4]=vec3(1,.16,0);c[5]=vec3(1); }
  else if(pal==2){ c[0]=vec3(.06,0,.03);c[1]=vec3(.3,0,.08);c[2]=vec3(.6,0,.1);c[3]=vec3(.9,.08,.08);c[4]=vec3(1,.24,.16);c[5]=vec3(1,.5,.45); }
  else { c[0]=vec3(0);c[1]=vec3(.1);c[2]=vec3(.35);c[3]=vec3(.65);c[4]=vec3(.9);c[5]=vec3(1); }
  float x=v*5.; int i=int(min(floor(x),4.)); float f=x-float(i); vec3 a=c[0], b=c[1];
  for(int k=0;k<5;k++) if(k==i){ a=c[k]; b=c[k+1]; }
  return mix(a,b,f); }
float gridField(vec2 q, float t){ q.y=-q.y; float hz=.1; float y=q.y+hz;
  if(y>0.){ float s=length(q-vec2(0,.55)); return clamp(.9-s*1.3,0.,1.)+fbm(q*3.+t*.1)*.25*y; }
  float z=1./(-y+.02); vec2 g=vec2(q.x*z, z+t*6.); float ln=max(smoothstep(.93,1.,fract(g.x)),smoothstep(.9,1.,fract(g.y)));
  return clamp(ln*(1.-exp(y*1.2))*1.2+(1.+y)*.35,0.,1.); }
// the Turrell tunnel: five nested rectangles receding to a hot core above centre; every edge catches light (v1's Deng object)
float turrell(vec2 q, float t){
  vec2 px=q*vec2(1080.,1920.);
  vec2 vp=vec2(.5,.405)+vec2(sin(t*.31)*.004,sin(t*.23)*.004);
  float push=1.+.035*clamp(t/3.4,0.,1.);                       // a very slow push in; the camera itself stays still
  float v=.06+.05*smoothstep(1.2,.0,length((q-vp)*vec2(1.,1.78)));
  float edges=0.;
  for(int i=0;i<5;i++){ float fi=float(i);
    float f=pow(.70,fi)*push*(1.+.012*sin(t*.5+fi*1.7));
    vec2 c=vp+(vec2(.5,.5)-vp)*f;
    vec2 hs=vec2(.37,.37)*f; vec2 d=(abs(q-c)-hs)*vec2(1080.,1920.);
    float sd=length(max(d,0.))+min(max(d.x,d.y),0.);
    float lvl=.22+.15*fi+(fi>3.5?.12:0.);
    float inside=smoothstep(1.5,-1.5,sd);
    v=mix(v,lvl,inside);
    edges+=(exp(-abs(sd)/2.2)*.55+exp(-abs(sd)/16.)*.22+exp(-abs(sd)/70.)*.07)*(.55+.12*fi);
  }
  float core=exp(-pow(length((q-vp)*vec2(1080.,1920.))/46.,2.));
  return v+edges*.55+core*.5+(fbm(q*3.+t*.05)-.5)*.02; }
float heatAt(vec2 q, float t){
  if(MODE==1){ vec2 g=(q*2.-1.)*vec2(1.,1.78)*.62; return gridField(g,t); }
  if(MODE==2) return turrell(q,t);
  if(MODE==3){ float d=length((q-HALO.xy)*vec2(1.,1.78)); float bump=exp(-d*d/(HALO.z*HALO.z))*HALO.w; return bump+ (fbm(q*5.+t*.3)-.5)*.02; }
  vec2 uv=V.xy+q*V.zw;
  float s=SHIM; vec2 dis=vec2(sin(q.y*38.+t*7.)+sin(q.y*91.-t*11.)*.5, sin(q.x*20.+t*5.))*.0011*s*V.zw;
  float v=texture(T,uv+dis).r; return v; }
void main(){
  vec2 q=vec2(p.x,1.-p.y);
  float tq=floor(TM*15.)/15.;                                    // a thermal camera is slow: 15 fps frames
  float sp=SPLIT; vec2 off=vec2(sp,0.)*V.zw;
  float v0=heatAt(q,TM), v1=v0, v2=v0;
  if(MODE==0 && sp>0.){ v1=heatAt(q+vec2(sp,0.),TM); v2=heatAt(q-vec2(sp,0.),TM); }
  float nz=(h21(floor(gl_FragCoord.xy/1.)+tq*91.3)-.5);
  float fp=(h21(vec2(floor(gl_FragCoord.x/2.),SEED))-.5);
  float fl=(n2(vec2(q.x*40.,q.y*60.)+tq*13.)-.5);
  vec3 v=vec3(v1,v0,v2);
  v=pow(clamp(v,0.,1.),vec3(GAMMA))*GAIN+ADD+KICK*.07;
  v+=vec3(nz*.05+fp*.035)+fl*.05*v;
  float scan=1.-.045*step(1.,mod(gl_FragCoord.y,3.));
  vec3 col=vec3(lut(PAL,v.x).r, lut(PAL,v.y).g, lut(PAL,v.z).b)*scan;
  col*=1.-COLD;
  float vg=smoothstep(1.25,.35,length((q-.5)*vec2(1.,1.4))); col*=mix(.45,1.,vg);
  o=vec4(col,1.); }`;

function makeGL() {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const gl = c.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
  gl.useProgram(pr);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, W, H);
  const U = {}; const u = n => U[n] ?? (U[n] = gl.getUniformLocation(pr, n));
  const tex = img => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
  return { c, gl, u, tex };
}

// ------------------------------------------------------------------ colours for the 2D layers (the same ironbow as the shader)
const IRON = [[0, 0, .04], [.16, 0, .43], [.59, 0, .59], [.9, .2, .16], [1, .67, 0], [1, 1, .9]];
function iron(v, a = 1) { v = clamp(v) * 5; const i = Math.min(4, Math.floor(v)), f = v - i; const c = IRON[i].map((x, k) => x + (IRON[i + 1][k] - x) * f);
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`; }

// ------------------------------------------------------------------ type: hot objects. One heavy condensed Latin (Anton), one heavy Chinese (Noto Sans SC Black).
const LATIN = '"Anton"', CJK = '"PF CJK", "Noto Sans SC", sans-serif';
function fit(ctx, lines, family, maxW, maxSize, mult = 1) {
  let s = maxSize;
  for (; s > 60; s -= 4) { ctx.font = `${s}px ${family}`; if (Math.max(...lines.map(l => ctx.measureText(l).width)) <= maxW) break; }
  return s * mult;
}
function drawWord(ctx, lines, kind, age, beatEnv, o = {}) {
  const fam = kind === 'C' ? CJK : LATIN;
  const maxW = o.maxW ?? 880, cap = o.size ?? (kind === 'C' ? 330 : (lines.length === 1 ? 330 : 300));
  const size = fit(ctx, lines, fam, maxW, cap, kind === 'C' ? 1 : 1);
  const lh = kind === 'C' ? size * 1.02 : size * 0.98;
  const total = lh * (lines.length - 1);
  const y0 = (o.y ?? 790) - total / 2;
  const u = ease.outExpo(clamp(age / 0.10)), sc = 1 + 0.24 * (1 - u), r = rng(Math.floor(age * 30) + lines[0].length * 7);
  const jit = age < 0.16 ? (r() - 0.5) * 26 * (1 - age / 0.16) : 0;
  const heat = o.hero ? 1 : 0.55 + 0.45 * beatEnv;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const pass = (dx, col, comp, alpha, blur, glow, stroke) => {
    ctx.save(); ctx.globalCompositeOperation = comp; ctx.globalAlpha = alpha;
    lines.forEach((l, i) => {
      ctx.save(); ctx.translate(W / 2 + jit + dx, y0 + i * lh); ctx.scale(sc, sc); ctx.font = `${size}px ${fam}`;
      if (stroke) { ctx.lineWidth = stroke; ctx.strokeStyle = 'rgba(8,0,14,0.78)'; ctx.strokeText(l, 0, 0); }
      if (blur) { ctx.shadowColor = glow; ctx.shadowBlur = blur; }
      ctx.fillStyle = col; ctx.fillText(l, 0, 0); ctx.restore();
    });
    ctx.restore();
  };
  pass(0, '#000', 'source-over', 1, 0, null, size * 0.075);                    // a dark keyline so the word reads on any picture
  if (age < 0.2) { const k = 1 - age / 0.2; pass(-18 * k, '#ff2040', 'lighter', 0.5 * k, 0, null, 0); pass(18 * k, '#10d8ff', 'lighter', 0.5 * k, 0, null, 0); }
  pass(0, iron(0.42, 1), 'source-over', 0.9, 90 + 40 * beatEnv, iron(0.34, 0.95), 0);      // purple-red falloff
  pass(0, iron(0.74, 1), 'source-over', 0.95, 34 + 12 * beatEnv, iron(0.74, 1), 0);        // orange body
  pass(0, iron(0.92 + 0.08 * heat), 'source-over', 1, 10, iron(1, 0.9), 0);                // white-hot core
  ctx.restore();
}

// ------------------------------------------------------------------ the HUD (ours only). Monospace, kept in the phone-safe band.
const MONO = '"Plex Mono"';
function txt(ctx, s, x, y, size, col, align = 'left', alpha = 1, bold = false) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.font = `${bold ? '600 ' : ''}${size}px ${MONO}`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8; ctx.fillStyle = col; ctx.fillText(s, x, y); ctx.restore();
}
function reticle(ctx, x, y, lock, t, col = '#fff', box = null) {         // lock: 0 searching .. 1 locked (box snaps in, corners close)
  ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 4; ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 6;
  const R = 54, g = 14;
  for (const [a, b, c, d] of [[-R, 0, -g, 0], [g, 0, R, 0], [0, -R, 0, -g], [0, g, 0, R]]) { ctx.beginPath(); ctx.moveTo(x + a, y + b); ctx.lineTo(x + c, y + d); ctx.stroke(); }
  const e = ease.outBack(lock), L = 34;
  const hw = box ? lerp(190, (box.x1 - box.x0) / 2 + 26, e) : lerp(150, 92, e), hh = box ? lerp(190, (box.y1 - box.y0) / 2 + 26, e) : lerp(150, 92, e);
  ctx.lineWidth = lock > 0.01 ? 6 : 3;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cx = x + sx * hw, cy = y + sy * hh; ctx.beginPath(); ctx.moveTo(cx - sx * L, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy - sy * L); ctx.stroke();
  }
  if (lock > 0.5) { ctx.beginPath(); ctx.arc(x, y, 14, 0, 7); ctx.fill(); }
  ctx.restore();
}
function hud(ctx, o) {
  const { beat, t, temp, label, rx, ry, lock, show, bar } = o;
  ctx.save();
  if (show > 0) {
    ctx.globalAlpha = show;
    txt(ctx, temp.toFixed(1) + '°C', 60, 345, 84, '#fff', 'left', 1, true);
    txt(ctx, label || 'ε 0.95   AGC ON', 62, 392, 28, label ? '#fff' : 'rgba(255,255,255,.8)', 'left', 1, !!label);
    // thermometer: the scale the argument climbs, with iron's melting point notched
    const x0 = 60, y0 = 450, h = 640, w = 22;
    const g = ctx.createLinearGradient(0, y0 + h, 0, y0); IRON.forEach((c, i) => g.addColorStop(i / 5, `rgb(${c.map(v => Math.round(v * 255)).join(',')})`));
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x0 - 5, y0 - 5, w + 10, h + 10); ctx.fillStyle = g; ctx.fillRect(x0, y0, w, h);
    const yv = v => y0 + h - h * clamp(v / 1600);
    ctx.fillStyle = '#fff'; ctx.fillRect(x0 - 12, yv(temp) - 3, w + 24, 6);
    ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fillRect(x0 - 10, yv(1538) - 1.5, w + 20, 3);
    txt(ctx, 'Fe 1538°C', x0 - 6, y0 - 14, 24, bar > 0 ? '#fff' : 'rgba(255,255,255,.8)', 'left', 1, bar > 0);
    txt(ctx, '30°', x0 + w + 14, y0 + h + 4, 22, 'rgba(255,255,255,.7)');
    if (bar > 0) { ctx.globalAlpha = show * bar; txt(ctx, 'MELTING POINT OF IRON', x0 - 6, y0 - 44, 20, '#fff'); }
    ctx.globalAlpha = show;
    // corner brackets of the safe band
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 3;
    for (const [x, y, sx, sy] of [[44, 262, 1, 1], [W - 44, 262, -1, 1], [44, 1242, 1, -1], [W - 44, 1242, -1, -1]]) { ctx.beginPath(); ctx.moveTo(x + 50 * sx, y); ctx.lineTo(x, y); ctx.lineTo(x, y + 50 * sy); ctx.stroke(); }
  }
  if (rx != null) {
    ctx.globalAlpha = Math.max(show, o.rshow ?? 0);
    reticle(ctx, rx, ry, lock, t, o.rcol || '#fff');
  }
  ctx.restore();
}

// ------------------------------------------------------------------ the closer: the camera's last target is the ACP badge
const MARK = { cx: 540, cy: 700, size: 410 };
function closer(ctx, beat, B, t) {
  const L = 76;
  const kb = B.env('kick', t, 9), imp = B.env('impact', t, 5);
  const stripeT = [74, 74.5, 75, 75.5];
  const heatS = stripeT.map((b, k) => clamp((beat - b) / 0.26));                 // 0..1: how far the stripe has grown out
  const lvl = [0.30, 0.50, 0.74, 1.0];
  const locked = beat >= L, age = Math.max(0, (beat - L) * B.spb);
  const lockU = locked ? clamp(age / 0.18) : 0;
  const cold = clamp((beat - 72.2) / 0.8);
  // the badge: cold at first (a dim purple outline in the noise), each stripe heats in its turn, then white-hot on the lock
  const base = locked ? 1 : lerp(0.16, 0.3, clamp((beat - 74) / 1.6));
  ctx.save();
  const sz = MARK.size * (1 + 0.012 * kb) * (locked ? 1 + 0.04 * Math.exp(-age * 9) : 1);
  const glow = (col, blur, a) => { ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = blur; ctx.globalAlpha = a; return ctx; };
  const fillBadge = (v, a) => drawMark(ctx, MARK.cx, MARK.cy, sz, { color: iron(v), alpha: a, stripes: [0, 0, 0, 0] });
  const appear = clamp((beat - 72.6) / 1.2);
  if (locked) {
    for (const [b, c, aa] of [[130, iron(0.45, .9), .7], [60, iron(0.75, 1), .9], [22, iron(0.95, 1), 1]]) { glow(c, b * (1 + 0.5 * Math.exp(-age * 6)), aa); drawMark(ctx, MARK.cx, MARK.cy, sz, { color: '#fff4dc', stripes: [1, 1, 1, 1] }); ctx.restore(); }
    drawMark(ctx, MARK.cx, MARK.cy, sz, { color: '#fffaf0', stripes: [1, 1, 1, 1] });
  } else {
    ctx.globalAlpha = appear;
    glow(iron(0.4, .9), 50, 0.5 * appear); fillBadge(base + 0.1 * Math.max(...heatS.map((h, k) => h * lvl[k])), 1); ctx.restore();
    fillBadge(base + 0.1 * Math.max(...heatS.map((h, k) => h * lvl[k])), appear);
    for (let k = 0; k < 4; k++) {                                                  // each stripe heats on its cowbell hit
      const h = heatS[k]; if (h <= 0) continue;
      const v = lerp(0.3, lvl[k], ease.outCubic(h)) + 0.18 * Math.exp(-(beat - stripeT[k]) * B.spb * 7);
      glow(iron(Math.min(1, v), .9), 38 + 28 * (1 - h), 0.9);
      const sp = [0, 0, 0, 0]; sp[k] = ease.outExpo(h);
      drawMark(ctx, MARK.cx, MARK.cy, sz, { color: iron(Math.min(1, v + 0.1)), stripes: sp, badge: 0 }); ctx.restore();
    }
  }
  ctx.restore();
  // the lock: the reticle's box snaps around the mark, label resolves
  const g = markBox(MARK.cx, MARK.cy, MARK.size);
  const bx = (g.box.x0 + g.box.x1) / 2, by = (g.box.y0 + g.box.y1) / 2;
  return { box: g.box, bx, by, lockU, locked, age, heatS, kb, imp };
}

// ------------------------------------------------------------------ the scene
const ctx = outCanvas();
await loadFonts();
for (const f of [['108', '邓'], ['111', '拒阶'], ['113', '硬'], ['114', '描厂'], ['115', '扫绝增'], ['116', '红未'], ['117', '去质级展才'], ['118', '外长生产力工人来是工发道理小平'], ['119', '新']]) {
  const ff = new FontFace('PF CJK', `url(${A}fonts/noto-sans-sc-${f[0]}-900-normal.woff2)`, { weight: '900' });
  document.fonts.add(await ff.load());
}
for (const n of ['108', '113', '117', '118']) {
  const ff = new FontFace('PF CJK Light', `url(${A}fonts/noto-sans-sc-${n}-400-normal.woff2)`, { weight: '400' });
  document.fonts.add(await ff.load());
}
await document.fonts.load('900 100px "PF CJK"', '红外扫描拒绝去增长');
const B = await loadBeats(SCENE);
const gl = makeGL(); const GL = gl.gl;
const TEX = {}, META = await (await fetch(A + 'src/meta.json')).json();
for (const n of IMGS) { const im = await loadImage(`${A}src/${n}.jpg`); TEX[n] = gl.tex(im); META[n].w = im.width; META[n].h = im.height; }
const SCR = rng(11);

function view(sp, beat, shotB0, shotB1, kick) {                                   // cover-fit window for a 9:16 frame
  const m = META[sp[2]], asp = m.w / m.h, fa = W / H;
  const u = ease.inOutCubic(clamp((beat - shotB0) / ((sp[7] && sp[7].still ? sp[7].still : shotB1) - shotB0)));
  const [ax, ay, az] = sp[4], [bx, by, bz] = sp[5];
  const z = lerp(az, bz, u) * (1 + 0.04 * kick);
  let vw, vh;
  if (asp >= fa) { vh = 1 / z; vw = vh * fa / asp; } else { vw = 1 / z; vh = vw * asp / fa; }
  const cx = clamp(lerp(ax, bx, u), vw / 2, 1 - vw / 2), cy = clamp(lerp(ay, by, u), vh / 2, 1 - vh / 2);
  return { x0: cx - vw / 2, y0: cy - vh / 2, vw, vh };
}
const shotAt = b => SHOTS.find(s => b >= s[0] && b < s[1]) || SHOTS[SHOTS.length - 1];

window.renderFrame = async (t) => {
  const beat = B.beat(t), frame = Math.round(t * 30);
  const kick = Math.max(B.env('kick', t, 11), 0), snare = B.env('snare', t, 12), imp = B.env('impact', t, 5), cow = B.env('cow', t, 14);
  const sh = shotAt(beat), [s0, s1, id, pal] = sh, opt = sh[7] || {};
  const inCloser = beat >= 72;
  const dropB = beat >= 16 && beat < 48 || beat >= 56 && beat < 72;
  // ---- picture (GL)
  const g = gl.gl, U = gl.u;
  let mode = id ? 0 : (pal === P.turr ? 2 : 1), vw4 = [0, 0, 1, 1], gain = opt.gain ?? 1.05, gamma = opt.gamma ?? 1.4;
  if (mode === 2) { gain = 1.0; gamma = 1.0; }
  if (id) vw4 = (() => { const v = view(sh, beat, s0, s1, kick); return [v.x0, v.y0, v.vw, v.vh]; })();
  let add = (opt.add ?? 0) + (beat >= 68 && beat < 72 ? (opt.rise ?? 0) * ease.inCubic((beat - 68) / 4) : 0);
  let cold = 0, palSel = pal;
  const halo = [0.5, 0.36, 0.5, 0];
  if (inCloser) {
    mode = 3; palSel = P.iron; gain = 1; gamma = 1; add = 0;
    const hs = [74, 74.5, 75, 75.5].map(b => clamp((beat - b) / 0.4));
    halo[3] = 0.02 + 0.10 * hs.reduce((a, b) => a + b, 0);
    halo[2] = 0.30; halo[1] = 0.37;
    if (beat >= 76) { const ag = (beat - 76) * B.spb; halo[3] = lerp(0.62, 0.035, 1 - Math.exp(-ag * 1.5)) ; halo[2] = lerp(0.42, 0.30, clamp(ag / 1.2)); }
  }
  // the first 2 frames after every cut are the camera's shutter calibration (NUC): a flat grey frame
  const sinceCut = (beat - (inCloser ? 72 : s0)) * B.spb;
  const nuc = !inCloser && beat > 0.1 && sinceCut < 0.034 && !(opt.still && beat >= opt.still) ? 1 : 0;
  g.uniform4f(U('V'), ...vw4); g.uniform1i(U('MODE'), mode); g.uniform1i(U('PAL'), palSel);
  g.uniform1f(U('GAIN'), nuc ? 0.3 : gain * (1 + 0.1 * kick)); g.uniform1f(U('GAMMA'), gamma); g.uniform1f(U('ADD'), nuc ? 0.2 : add);
  g.uniform1f(U('KICK'), kick * (dropB ? 1 : 0.4)); g.uniform1f(U('TM'), t); g.uniform1f(U('SEED'), Math.floor(beat * 3) + 1);
  g.uniform1f(U('SPLIT'), (dropB ? 0.004 : 0.0015) + 0.010 * kick + 0.012 * snare); g.uniform1f(U('SHIM'), id ? (0.6 + 1.2 * clamp(beat / 70)) : 0);
  g.uniform1f(U('COLD'), cold); g.uniform1f(U('GRIDT'), t); g.uniform1f(U('TAU'), 0); g.uniform4f(U('HALO'), ...halo);
  if (id) { g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, TEX[id]); g.uniform1i(U('T'), 0); }
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.drawImage(gl.c, 0, 0);
  // slice glitch on the snare / kick (the v1 look, cleaner: two slices, never the word)
  if (dropB && (snare > 0.55 || kick > 0.9) && !nuc) {
    const r = rng(frame * 13 + 5);
    for (let i = 0; i < 2; i++) { const y = Math.floor(r() * (H - 160)), hh = 24 + Math.floor(r() * 60), dx = (r() - 0.5) * 70; ctx.drawImage(gl.c, 0, y, W, hh, dx, y, W, hh); }
  }
  // ---- HUD state
  const temp = inCloser ? 1538 : tempAt(beat, kick);
  const intro = beat < 16;
  let rx = null, ry = null, lock = 0, label = null, rcol = '#fff';
  if (id && sh[6] && !inCloser) {                                              // the crosshair rides the shot's hot subject
    const v = { x0: vw4[0], y0: vw4[1], vw: vw4[2], vh: vw4[3] };
    const tx = (sh[6][0] - v.x0) / v.vw * W, ty = (sh[6][1] - v.y0) / v.vh * H;
    const sinceB = (beat - s0) * B.spb;
    const ease2 = ease.outExpo(clamp(sinceB / 0.18));
    rx = lerp(540 + Math.sin(t * 3) * 120, clamp(tx, 130, W - 130), ease2); ry = lerp(620 + Math.cos(t * 2.2) * 90, clamp(ty, 400, 1180), ease2);
    lock = clamp(sinceB / 0.22); label = beat >= 8 && intro ? 'LOCK: PRODUCTIVE FORCE' : null;
  } else if (beat < 8) {                                                       // the scan: the crosshair hunts across the aerial
    rx = 540 + Math.sin(t * 1.3) * 300; ry = 560 + Math.cos(t * 0.9) * 200; label = 'SCANNING...';
  }
  if (beat >= 68 && beat < 72) label = 'Fe 1538°C = IRON MELTS';
  const hudShow = inCloser ? 0 : (id || mode ? (beat >= 48 && beat < 56 ? 0.55 : 1) : 1);
  let flash = 0, flashCol = '255,244,220';
  // ---- words
  ctx.save();
  for (const w of WORDS) {
    const [b0, b1, kind, lines, o = {}] = w;
    if (beat >= b0 && beat < b1) {
      const age = (beat - b0) * B.spb, e = Math.max(kick, B.env('cow', t, 10) * 0.6);
      const fade = beat > b1 - 0.5 && b1 - b0 > 3 ? clamp((b1 - beat) / 0.5) : 1;
      ctx.globalAlpha = fade;
      if (o.tag) { txt(ctx, o.tag, W / 2, 590, 66, '#fff', 'center', 1, true); }
      drawWord(ctx, lines, kind, age, e, o);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
  // ---- Deng: the one still, quiet card. Small type on the tunnel; all three lines are up by mid-bar 1 so the stillness is long.
  if (beat >= 48 && beat < 56) {
    const b = beat - 48;
    const up = (b0, dur = 0.35) => ease.outCubic(clamp((b - b0) / dur));
    const line = (s, y, font, a, glow) => { if (a <= 0) return; ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = font;
      ctx.shadowColor = glow; ctx.shadowBlur = 26; ctx.fillStyle = 'rgba(255,60,50,.9)'; ctx.fillText(s, W / 2, y); ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(255,40,30,.9)';
      ctx.fillStyle = '#fff4ee'; ctx.fillText(s, W / 2, y); ctx.restore(); };
    ctx.save(); ctx.letterSpacing = '4px';
    line('发展才是硬道理', 1010, `400 124px "PF CJK Light", "PF CJK", sans-serif`, up(0, 0.6), 'rgba(255,30,20,1)');
    ctx.letterSpacing = '8px';
    line('DEVELOPMENT IS', 1130, `62px ${LATIN}`, up(0.55), 'rgba(255,30,20,.9)');
    line('THE HARD TRUTH', 1198, `62px ${LATIN}`, up(0.55), 'rgba(255,30,20,.9)');
    ctx.restore();
    const a = up(1.1, 0.5);
    if (a > 0) {
      ctx.save(); ctx.globalAlpha = a * 0.9; ctx.fillStyle = 'rgba(255,225,215,.8)'; ctx.fillRect(W / 2 - 110, 1262, 220, 2);
      ctx.fillStyle = '#ffe9de'; ctx.shadowColor = 'rgba(40,0,0,.9)'; ctx.shadowBlur = 8; ctx.textAlign = 'left';
      ctx.font = `400 40px "PF CJK Light", "PF CJK", sans-serif`; const w1 = ctx.measureText('邓小平').width; ctx.font = `500 30px ${MONO}`; const w2 = ctx.measureText('DENG XIAOPING, 1992').width;
      const x0 = W / 2 - (w1 + 22 + w2) / 2; ctx.font = `400 40px "PF CJK Light", "PF CJK", sans-serif`; ctx.fillText('邓小平', x0, 1316); ctx.font = `500 30px ${MONO}`; ctx.fillText('DENG XIAOPING, 1992', x0 + w1 + 22, 1314); ctx.restore();
    }
  }
  // ---- the climb hits iron: the HUD notches Fe 1538 on the slam
  const bar = beat >= 68 && beat < 72 ? ease.outCubic(clamp((beat - 68) / 0.3)) : (beat >= 56 && beat < 68 ? 0 : 0);
  hud(ctx, { beat, t, temp, label, rx, ry, lock, show: hudShow, bar, rcol });
  // ---- closer
  if (inCloser) {
    const c = closer(ctx, beat, B, t);
    // crosshair: hunts in from the crowd, finds the badge, the box snaps on the lock
    const hunt = clamp((beat - 72) / 2.2);
    const rxx = lerp(540 + Math.sin(t * 5) * 120 * (1 - hunt), c.bx, ease.outCubic(hunt)), ryy = lerp(900 + Math.cos(t * 4) * 140 * (1 - hunt), c.by, ease.outCubic(hunt));
    const lk = beat >= 76 ? ease.outBack(clamp(c.age / 0.2)) : hunt * 0.4;
    ctx.save(); ctx.globalAlpha = clamp((beat - 72) / 0.4);
    reticle(ctx, rxx, ryy, lk, t, beat >= 76 ? '#fff' : 'rgba(255,255,255,.8)', c.box);
    ctx.restore();
    txt(ctx, 'TARGET:', 60, 345, 40, 'rgba(255,255,255,.8)', 'left', clamp((beat - 72.3) / 0.5) * (1 - c.lockU * 0));
    txt(ctx, beat >= 76 ? 'ACP  LOCKED' : 'ACQUIRING...', 60, 400, 52, '#fff', 'left', clamp((beat - 72.3) / 0.5), true);
    txt(ctx, '1538.0°C', 60, 455, 36, 'rgba(255,255,255,.85)', 'left', clamp((beat - 72.3) / 0.5));
    if (beat >= 76) {
      const a1 = ease.outCubic(clamp((c.age - 0.12) / 0.3)), a2 = ease.outCubic(clamp((c.age - 0.45) / 0.35)), a3 = ease.outCubic(clamp((c.age - 0.9) / 0.45));
      ctx.save(); ctx.shadowColor = iron(0.7, .9); ctx.shadowBlur = 36;
      drawLockup(ctx, W / 2, 1055, 150, { color: '#fff2da', alpha: a1 }); ctx.restore();
      ctx.save(); ctx.globalAlpha = a2; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = `92px "Archivo Black"`; ctx.fillStyle = '#fff2da'; ctx.shadowColor = iron(0.7, .8); ctx.shadowBlur = 24;
      const s = 'ACP.US'; let x = W / 2 - (ctx.measureText(s).width + 6 * 5) / 2; ctx.textAlign = 'left';
      for (const ch of s) { ctx.fillText(ch, x, 1225); x += ctx.measureText(ch).width + 6; } ctx.restore();
      txt(ctx, 'PRO-PRODUCTION · PRO-AI · PRO-HUMAN', W / 2, 1290, 28, 'rgba(255,240,220,.85)', 'center', a3);
    }
    if (beat >= 76 && c.age < 0.12) flash = 0.9 * (1 - c.age / 0.12);
    if (beat >= 72 && beat < 72.12) { flash = 0.85 * (1 - (beat - 72) / 0.12); }
  }
  // finish: the human-made grain is the camera's own (shader); a flash on the slams
  if (beat >= 68 && beat < 68.1) flash = Math.max(flash, 0.8 * (1 - (beat - 68) / 0.1));
  if (beat >= 16 && beat < 16.34) flash = Math.max(flash, 0.82 * (1 - (beat - 16) / 0.34) ** 1.6);          // v1's flash: ~75 % white, ~130 ms decay
  if (beat >= 20 && beat < 20.07) { flash = Math.max(flash, 0.75); flashCol = '255,40,200'; }                  // one magenta frame into the grid
  if (beat >= 56 && beat < 56.1) flash = Math.max(flash, 0.6 * (1 - (beat - 56) / 0.1));
  if (beat < 0.3) { ctx.fillStyle = `rgba(0,0,0,${1 - beat / 0.3})`; ctx.fillRect(0, 0, W, H); }
  if (flash > 0) { ctx.fillStyle = `rgba(${flashCol},${clamp(flash)})`; ctx.fillRect(0, 0, W, H); }
  // the tail: the picture rides the last hold, then fades under the published cut
  const END = 82.4; if (beat > END - 1.1) { ctx.fillStyle = `rgba(0,0,0,${clamp((beat - (END - 1.1)) / 1.1)})`; ctx.fillRect(0, 0, W, H); }
};
window.sceneReady = true;
