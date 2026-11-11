// PLATES: spot-colour separations drawn as plates (STUDIO CIV ASSETS c1, 1 Oct).
//
// How a three-ink poster is really made: each ink is its own plate, cut at full size. Flats are solid ink; a tint
// is a designed decision (a mixed flat, a ruled line tint, a coarse Ben-Day dot), never the accident of running a
// soft RGB picture through a separation. print.js `riso { screen }` separates an RGB composite into AM screens,
// which turns every flat into a dot mixture (a "60% red" prints as red + black + paper dots, brick-pink at phone
// size) and makes figure and ground the same grey dots. Plates removes that at the source:
//
//   - the scene draws INTO PLATES, one full-res coverage canvas per ink (alpha = ink coverage 0..1);
//   - each plate prints with its own designed tint set: coverage snaps to `levels` with hard edges (a gradient becomes
//     cut bands, the WPA / Hokusai way), solids print solid, the in-between levels print as `tint`:
//       'flat'  a mixed tint ink (silkscreen: the printer mixes a lighter ink)      -> clean flat colour
//       'line'  a ruled line tint at `pitch` / `angle`                                -> engraved / comic shading
//       'cross' line tint, crossed above ~45%
//       'dot'   a held AM dot at `pitch` (round Ben-Day when coarse)
//       'stip'  a held jittered dot field (coarse stochastic)
//     `tint` may also be a list, one mode per level: { levels: [0.4, 0.72, 1], tint: ['flat', 'line'] } prints a light
//     flat stone and a ruled shadow from the same black plate (the last mode repeats for the remaining levels)
//   - photographs and other multi-colour images go to a `photo` layer that IS separated (Beer-Lambert, like riso) and
//     screened, bounded by its own alpha: dots live inside photographs, the ROSTA rule;
//   - `benday` is a mask plate: where it is painted, every tint prints as coarse round dots (a deliberate statement);
//   - misregistration is a fixed offset per plate (boil 0 by default: dots and edges hold still on a held shot).
//
// Two ways in:
//   1. Draw plates directly:  P.fill(path, 'red', 1); P.stroke(path, 'black', 3); P.knock(path); P.plate('gold') -> ctx
//      (paint plate contexts with P.cov(k) as the colour: a channel colour whose alpha is the coverage).
//   2. P.tone: a CanvasRenderingContext2D look-alike that ROUTES ordinary drawing to the plates. Colours are matched to
//      the inks (an ink's own rgb with alpha a = that ink at coverage a; paper / white = knock-out; any other colour is
//      split into the inks by optical density), gradients become per-ink gradients, source-over knocks out the inks
//      under it (a printer's knock-out), multiply overprints, single-colour canvases drawn with drawImage are masks,
//      multi-colour images go to the photo layer. A scene written for a "multiply tone plate" (empire4's `tn`) adopts
//      plates by swapping its tone canvas for P.tone. See research/capabilities/plates.md.
//
//   import { Plates } from '../lib/fx/plates.js';
//   const P = new Plates(pr, { paper: STOCK, inks: [
//     { name: 'red', hex: '#D11F24', levels: [0.5, 1], tint: 'flat' },
//     { name: 'black', hex: '#111111', levels: [0.3, 0.6, 1], tint: 'line', pitch: 11, angle: 45 },
//     { name: 'gold', hex: '#C9A04A', levels: [0.55, 1], tint: 'flat' } ] });
//   P.begin();  ... draw ...  P.print(ctx, { t, misreg: 1.6 });
import { W, H } from '../kit.js';
import { registerPrintPass } from './print.js';

const CHN = ['255,0,0', '0,255,0', '0,0,255'];
const MODES = { flat: 0, line: 1, cross: 2, dot: 3, stip: 4 };
const hex3 = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255), (n >> 8 & 255), (n & 255)]; };
const f3 = h => hex3(h).map(v => v / 255);
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const lum3 = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

// ------------------------------------------------------------------ the press pass (shares print.js HEAD: paper, noise, inkOn, fin)
const FS = `uniform vec4 L0,L1,L2,M0,M1,M2; uniform vec3 PT, AG, I0, I1, I2, PB, RF; uniform vec2 O0, O1, O2, SH;
uniform float TOOTH, BPITCH, RSCR, ROUGH, NINK, EDGE, PCON; uniform mat3 SEP;
// snap a coverage to the plate's designed levels with hard edges (AA from the coverage's own derivative)
float snapc(float c, vec4 L){ float fw=max(fwidth(c)*.6, 2e-3), prev=0., s=0.;
  for(int i=0;i<4;i++){ float l=L[i]; if(l>1.5) break; float th=(prev+l)*.5; s+=(l-prev)*smoothstep(th-fw, th+fw, c); prev=l; }
  return s; }
float lineT(vec2 p, float ang, float pitch, float s){ vec2 d=vec2(cos(ang), sin(ang)); float u=dot(p, vec2(-d.y, d.x))/pitch;
  float dist=abs(fract(u)-.5)*2.; float aa=1.6/pitch; return (1.-smoothstep(s-aa, s+aa, dist))*step(.004,s); }
float dotT(vec2 p, float ang, float pitch, float s, float k){ float ca=cos(ang), sa=sin(ang); vec2 z=mat2(ca,sa,-sa,ca)*p/pitch;
  float sp=.5*(cos(6.2831*z.x)+cos(6.2831*z.y)); sp+=(nT(p*.9+k*13.)-.5)*.3*ROUGH; float th=(1.-2.*s)*1.12, aa=6.2831/pitch*.9;
  return smoothstep(th-aa, th+aa, sp)*step(.004,s); }
float stipT(vec2 p, float pitch, float s, float k){ vec2 g=floor(p/pitch); float best=0.;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 id=g+vec2(i,j); vec2 c=(id+.25+.5*vec2(h21(id+k*7.1), h21(id+k*3.3+9.)))*pitch;
    float r=pitch*sqrt(s/3.1416)*(.85+.3*h21(id+k)); best=max(best, 1.-smoothstep(r-.8, r+.8, length(p-c))); }
  return best*step(.004,s); }
float tintOf(float s, float mode, float pitch, float ang, vec2 p, float k){
  if(s>.995) return 1.;
  if(mode<.5) return s;
  if(mode<1.5) return lineT(p, ang, pitch, s);
  if(mode<2.5){ if(s<.45) return lineT(p, ang, pitch, s); float a=1.-sqrt(1.-s); return 1.-(1.-lineT(p, ang, pitch, a))*(1.-lineT(p, ang+1.5708, pitch, a)); }
  if(mode<3.5) return dotT(p, ang, pitch, s, k);
  return stipT(p, pitch, s, k); }
float plate(int k, vec2 p, vec4 L, vec4 M, float pitch, float ang, vec2 off, float ben){
  vec2 q=p+off; vec2 uv=q*S/R; vec4 pk=textureLod(SRC, uv, 0.);
  float c=k==0?pk.r:k==1?pk.g:pk.b;
  float s=snapc(c, L);
  // the tint mode of the level nearest s (each designed level can print its own way: a flat stone, a ruled shadow)
  float mode=M.x, bd=abs(s-L.x); if(abs(s-L.y)<bd){ bd=abs(s-L.y); mode=M.y; } if(abs(s-L.z)<bd){ bd=abs(s-L.z); mode=M.z; } if(abs(s-L.w)<bd){ mode=M.w; }
  if(ben>.5 && s<.995) return dotT(q, ang, BPITCH, s, float(k));
  return tintOf(s, mode, pitch, ang, q, float(k)); }
float photo(int k, vec2 p, vec2 off){
  vec2 q=p+off; vec2 uv=q*S/R; vec4 c=textureLod(ORIG, uv, 0.); if(c.a<.004) return 0.;
  vec3 ld=log(max(mix(PB, c.rgb, c.a), .015)/PB); vec3 dd=SEP*ld; float d=clamp(((k==0?dd.x:k==1?dd.y:dd.z)-.5)*PCON+.5, 0., 1.);
  return dotT(q, AG[k], RSCR, d, float(k)+5.); }
void main(){ vec2 uv=gl_FragCoord.xy/R; vec2 p=gl_FragCoord.xy/S+SH; vec4 pp=paper(uv); vec3 col=pp.rgb;
  float ben=0.; if(HASMASK>.5) ben=step(.5, maskAt(uv, 0.));
  // ink starves where the paper tooth stands low (static: the stock does not move)
  float tooth=1.-TOOTH*smoothstep(.5,.85, 1.-pp.a+.3*(nT(p*.12)-.5));
  float k0=plate(0, p, L0, M0, PT.x, AG.x, O0, ben), k1=0., k2=0.;
  if(NINK>1.5) k1=plate(1, p, L1, M1, PT.y, AG.y, O1, ben);
  if(NINK>2.5) k2=plate(2, p, L2, M2, PT.z, AG.z, O2, ben);
  if(RF.x>.5){ k0=1.-(1.-k0)*(1.-photo(0, p, O0)); if(NINK>1.5) k1=1.-(1.-k1)*(1.-photo(1, p, O1)); if(NINK>2.5) k2=1.-(1.-k2)*(1.-photo(2, p, O2)); }
  col=inkOn(col, I0, k0*tooth);
  if(NINK>1.5) col=inkOn(col, I1, k1*tooth);
  if(NINK>2.5) col=inkOn(col, I2, k2*tooth);
  o=fin(col, uv); }`;
let registered = false;
function register() { if (registered) return; registerPrintPass('pl_spot', FS); registered = true; }

function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g, det = a * A + b * B + c * Cc;
  if (Math.abs(det) < 1e-9) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, Cc / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
const mkc = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; };

// ------------------------------------------------------------------ colour -> ink coverages
// parse any CSS colour once (a 1x1 canvas does the parsing), cached
const _pc = mkc(1, 1)[1], _cache = new Map();
function rgba(css) {
  let v = _cache.get(css); if (v) return v;
  _pc.clearRect(0, 0, 1, 1); _pc.fillStyle = '#000'; _pc.fillStyle = css; _pc.fillRect(0, 0, 1, 1);
  const d = _pc.getImageData(0, 0, 1, 1).data; v = [d[0], d[1], d[2], d[3] / 255];
  if (_cache.size > 4000) _cache.clear(); _cache.set(css, v); return v;
}

export class Plates {
  // pr: a Print (print.js) whose GL context, paper stocks and noise the plates print with. inks: up to 3, in print order.
  // paper: a print.js stock name or object. scale: plate resolution (1 = 1080x1920; keep it 1 for print grade).
  constructor(pr, { inks, paper = 'cream', scale = 1, knockGain = 2.5, tooth = 0.07, bendayPitch = 26, photoScreen = 11, photoContrast = 1.15, rough = 0 } = {}) {
    register();
    this.pr = pr; this.paperKind = paper; this.scale = scale; this.knockGain = knockGain;
    this.opts = { tooth, bendayPitch, photoScreen, photoContrast, rough };
    this.w = Math.round(W * scale); this.h = Math.round(H * scale);
    this.inks = (inks || [{ name: 'red', hex: '#D11F24' }, { name: 'black', hex: '#111111' }, { name: 'gold', hex: '#C9A04A' }]).slice(0, 3)
      .map((k, i) => ({ levels: [0.5, 1], tint: 'flat', pitch: 11, angle: [15, 45, 75][i], ...k, i, rgb: hex3(k.hex) }));
    this.byName = Object.fromEntries(this.inks.map(k => [k.name, k]));
    this.c = []; this.g = [];
    for (const k of this.inks) { const [c, g] = mkc(this.w, this.h); this.c.push(c); this.g.push(g); }
    [this.photoC, this.photoG] = mkc(this.w, this.h);     // multi-colour images: separated + screened in the press
    [this.benC, this.benG] = mkc(this.w, this.h);         // Ben-Day statement mask
    [this.pk, this.pkg] = mkc(this.w, this.h);            // packed plates (r, g, b = ink 0, 1, 2 coverage)
    [this.scr, this.scg] = mkc(8, 8);                     // scratch for masks / echoes (resized on demand)
    const gl = pr.gl;
    this.tex = { pk: pr._tex(this.w, this.h, false), ph: pr._tex(this.w, this.h, false), bn: pr._tex(this.w, this.h, false) };
    this.pbase = null; this.stats = { routed: 0, photo: 0, masks: 0 };
    this.tone = new InkRouter(this);
    this.begin();
  }
  get paper() { return this.pr.paper(this.paperKind); }
  // a channel colour for painting plate contexts directly: P.plate('red').fillStyle = P.cov(0.5)
  cov(a = 1, ink = 0) { const i = typeof ink === 'string' ? this.byName[ink].i : ink; return `rgba(${CHN[i]},${clamp01(a)})`; }
  plate(name) { return this.g[this.byName[name].i]; }
  begin() {
    for (const g of [...this.g, this.photoG, this.benG]) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, this.w, this.h); g.lineCap = 'round'; g.lineJoin = 'round'; if (this.scale !== 1) g.setTransform(this.scale, 0, 0, this.scale, 0, 0); }
    this.photoUsed = false; this.benUsed = false; this.stats = { routed: 0, photo: 0, masks: 0 };
    this.tone._reset();
    return this;
  }
  // direct drawing helpers (1080-px units). cov 0..1 = the ink's coverage before snapping to its levels
  fill(path, ink, cov = 1, rule = 'nonzero') { const k = this.byName[ink], g = this.g[k.i]; g.fillStyle = this.cov(cov, k.i); g.fill(path, rule); return this; }
  stroke(path, ink, width = 2, cov = 1) { const k = this.byName[ink], g = this.g[k.i]; g.strokeStyle = this.cov(cov, k.i); g.lineWidth = width; g.stroke(path); return this; }
  // knock out every plate (or the named ones) inside a path: bare paper. amt < 1 lifts the inks by that much
  knock(path, amt = 1, only = null, rule = 'nonzero') {
    for (const k of this.inks) { if (only && !only.includes(k.name)) continue; const g = this.g[k.i]; g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = `rgba(0,0,0,${amt})`; g.fill(path, rule); g.restore(); }
    return this;
  }
  // a Ben-Day statement: inside the path every tint prints as coarse round dots
  benday(path) { this.benUsed = true; this.benG.fillStyle = '#fff'; this.benG.fill(path); return this; }
  // a photograph / multi-colour image into the photo layer (separated into the inks, screened, bounded by its alpha)
  photo(img, ...args) { this.photoUsed = true; this.photoG.drawImage(img, ...args); return this; }
  // run f(ctx, inkIndex) on every plate (shared transforms, clips, echoes)
  each(f) { this.inks.forEach((k, i) => f(this.g[i], i, k)); return this; }
  // hard step-and-repeat echo of every plate (replaces soft smears): n copies offset by dx, dy, each at a lower coverage
  echo(dx, dy = 0, n = 3, fall = 0.6) {
    if (this.scr.width !== this.w) { this.scr.width = this.w; this.scr.height = this.h; }
    this.each(g => { const s = this.scg; s.setTransform(1, 0, 0, 1, 0, 0); s.globalCompositeOperation = 'copy'; s.drawImage(g.canvas, 0, 0);
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-over';
      for (let k = 1; k <= n; k++) { g.globalAlpha = Math.pow(fall, k); g.drawImage(this.scr, dx * k * this.scale, dy * k * this.scale); } g.restore(); });
    return this;
  }
  _sep(pb) {   // Beer-Lambert separation matrix for the photo layer (as print.js riso)
    const inks = this.inks.map(k => f3(k.hex)), cols = inks.map(c => c.map((x, i) => Math.log(Math.max(x, 0.015) / pb[i])));
    while (cols.length < 3) cols.push([1e-3, 2e-3, 3e-3]);
    const sep = inv3([cols[0][0], cols[1][0], cols[2][0], cols[0][1], cols[1][1], cols[2][1], cols[0][2], cols[1][2], cols[2][2]]) || [1, 0, 0, 0, 1, 0, 0, 0, 1];
    return [sep[0], sep[3], sep[6], sep[1], sep[4], sep[7], sep[2], sep[5], sep[8]];
  }
  // print the plates onto the stock and draw into ctx. o: { t, misreg (px), offsets: [[dx,dy] x3], boil (fps, 0 = held),
  //   inks: { name: { levels, tint, pitch, angle } } per-print overrides, shake: [x, y], paper }
  print(ctx, o = {}) {
    const t0 = performance.now(), pr = this.pr, gl = pr.gl;
    const { t = 0, misreg = 1.2, boil = 0, offsets = null, shake = [0, 0] } = o;
    if (o.flush !== false) this.flush();   // CIVILIZATION v12: print() intermittently read blank plates on a loaded box until each was read once
    const g = this.pkg; g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.fillStyle = '#000'; g.fillRect(0, 0, this.w, this.h);
    g.globalCompositeOperation = 'lighter'; for (const c of this.c) g.drawImage(c, 0, 0); g.globalCompositeOperation = 'source-over';
    pr._upload(this.tex.pk, this.pk);
    if (this.photoUsed) pr._upload(this.tex.ph, this.photoC);
    if (this.benUsed) pr._upload(this.tex.bn, this.benC);
    const ptg = pr.paper(o.paper || this.paperKind), pb = ptg.base;
    const fr = boil ? Math.floor(t * boil) : 0, jit = (k, a) => { if (!boil) return 0; const r = Math.sin((fr + 1) * 12.9898 + k * 78.233) * 43758.5453; return (r - Math.floor(r) - 0.5) * 2 * a; };
    const m = misreg, OFF = offsets || [[jit(1, m * 0.3), jit(2, m * 0.3)], [m * 0.7 + jit(3, m * 0.4), -m * 0.5 + jit(4, m * 0.4)], [-m * 0.6 + jit(5, m * 0.3), m * 0.8 + jit(6, m * 0.3)]];
    const ink = this.inks.map(k => ({ ...k, ...((o.inks || {})[k.name] || {}) }));
    const L = k => { const l = (ink[k] ? ink[k].levels : [1]).filter(v => v > 0).sort((a, b) => a - b).slice(0, 4); while (l.length < 4) l.push(9); return l; };
    // tint: one mode for every level, or one per level (in the order of the sorted levels)
    const md = k => { if (!ink[k]) return [0, 0, 0, 0]; const t = ink[k].tint, n = L(k).filter(v => v < 2).length;
      const arr = Array.isArray(t) ? t : [t]; return [0, 1, 2, 3].map(i => MODES[arr[Math.min(i, arr.length - 1)]] ?? 0).map((v, i) => i < n ? v : 0); }, pt = k => ink[k] ? Math.max(3, ink[k].pitch) : 10, ag = k => (ink[k] ? ink[k].angle : 0) * Math.PI / 180;
    const U = { L0: L(0), L1: L(1), L2: L(2), M0: md(0), M1: md(1), M2: md(2), PT: [pt(0), pt(1), pt(2)], AG: [ag(0), ag(1), ag(2)],
      I0: f3(ink[0].hex), I1: ink[1] ? f3(ink[1].hex) : [1, 1, 1], I2: ink[2] ? f3(ink[2].hex) : [1, 1, 1], PB: pb, PBASE: pb,
      O0: OFF[0], O1: OFF[1] || [0, 0], O2: OFF[2] || [0, 0], SH: shake, TOOTH: o.tooth ?? this.opts.tooth, BPITCH: o.bendayPitch ?? this.opts.bendayPitch,
      RSCR: o.photoScreen ?? this.opts.photoScreen, PCON: o.photoContrast ?? this.opts.photoContrast, ROUGH: o.rough ?? this.opts.rough, NINK: this.inks.length, RF: [this.photoUsed ? 1 : 0, 0, 0],
      SEP: this._sep(pb), HASMASK: this.benUsed ? 1 : 0, MASKM: [0, 0, 0] };
    pr.t = t; pr.fr = fr;
    pr._pass('pl_spot', null, U, { SRC: this.tex.pk, ORIG: this.tex.ph, MASK: this.benUsed ? this.tex.bn : null, PAPER: ptg.tex });
    if (ctx) { ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(pr.cv, 0, 0, W, H); ctx.restore(); }
    this.stats.ms = performance.now() - t0;
    return this;
  }
  // read one pixel from every plate canvas (and the photo / Ben-Day layers) so any deferred raster work is done before they are composited.
  // print() calls this itself (o.flush = false to skip). Costs well under a millisecond on the CPU-backed plate canvases.
  flush() {
    for (const c of [...this.g, this.photoG, this.benG]) c.getImageData(0, 0, 1, 1);
    return this;
  }
  // a clean-edged silhouette mask from any Path2D (a scatter of discs, a union of strokes): fill, blur, hard-threshold the alpha.
  // opts: { box: [x0, y0, x1, y1] (default whole frame), blur px (3), lo / hi alpha 0..255 band the threshold ramps over (96, 160) }
  // returns { c, x, y }: a canvas of the box with an opaque-black mask, and its top-left. Paint it with g.drawImage(m.c, m.x, m.y),
  // or use it with globalCompositeOperation 'destination-out' to knock a plate. Draw in 1080-px units regardless of plate scale.
  silhouette(path, { box = [0, 0, W, H], blur = 3, lo = 96, hi = 160 } = {}) {
    const [bx0, by0, bx1, by1] = box.map(Math.round), w = Math.max(2, bx1 - bx0), h = Math.max(2, by1 - by0);
    const [a, ga] = mkc(w, h), [b, gb] = mkc(w, h);
    ga.setTransform(1, 0, 0, 1, -bx0, -by0); ga.fillStyle = '#000'; ga.fill(path); ga.setTransform(1, 0, 0, 1, 0, 0);
    gb.filter = `blur(${blur}px)`; gb.drawImage(a, 0, 0); gb.filter = 'none';
    const id = gb.getImageData(0, 0, w, h), d = id.data, span = Math.max(1, hi - lo);
    for (let i = 3; i < d.length; i += 4) { const v = (d[i] - lo) / span; d[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255); d[i - 3] = d[i - 2] = d[i - 1] = 0; }
    gb.putImageData(id, 0, 0);
    return { c: b, x: bx0, y: by0 };
  }
  // coverage per ink at a point (debug / tests): reads the plates back
  sample(x, y) { return this.g.map(g => g.getImageData(Math.round(x * this.scale), Math.round(y * this.scale), 1, 1).data[3] / 255); }
}

// ------------------------------------------------------------------ the router: a 2D-context look-alike that draws into plates
// Supports what tone-plate code uses: fillStyle / strokeStyle (CSS colours and linear / radial gradients), globalAlpha,
// globalCompositeOperation ('multiply' = overprint, 'source-over' = knock out + lay, 'destination-out' = lift), the path
// API, fill / fillRect / stroke / strokeRect / clearRect / clip, transforms, save / restore, drawImage, fillText.
class GradRec {
  constructor(type, args) { this.type = type; this.args = args; this.stops = []; }
  addColorStop(o, c) { this.stops.push([o, c]); }
}
const PATH_OPS = ['moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect', 'quadraticCurveTo', 'bezierCurveTo', 'closePath', 'roundRect'];
const XF_OPS = ['setTransform', 'resetTransform', 'translate', 'scale', 'rotate', 'transform'];
const STROKE_PROPS = ['lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'lineDashOffset', 'font', 'textAlign', 'textBaseline'];

class InkRouter {
  constructor(P) {
    this.P = P; this.canvas = { width: W, height: H }; this.alphaMode = 'coverage';   // or 'density' (see _sepColor)
    this.liftPhoto = false;         // true: knock-outs and lights painted through the router also lift the photo layer
    for (const op of PATH_OPS) this[op] = (...a) => { this._path[op](...a); };
    for (const op of XF_OPS) this[op] = (...a) => { const s = P.scale;
      const fix = op === 'setTransform' && a.length === 6 && s !== 1 ? [a[0] * s, a[1] * s, a[2] * s, a[3] * s, a[4] * s, a[5] * s] : a;
      for (const g of this._ctxs()) op === 'resetTransform' && s !== 1 ? g.setTransform(s, 0, 0, s, 0, 0) : g[op](...fix); };
    this._reset();
  }
  _ctxs() { return [...this.P.g, this.P.photoG]; }
  _reset() { this._path = new Path2D(); this.st = { fill: '#000', stroke: '#000', alpha: 1, op: 'source-over', dash: [] }; this._stack = []; this.filter = 'none';
    for (const k of STROKE_PROPS) this['_' + k] = undefined; }
  // state
  get fillStyle() { return this.st.fill; } set fillStyle(v) { this.st.fill = v; }
  get strokeStyle() { return this.st.stroke; } set strokeStyle(v) { this.st.stroke = v; }
  get globalAlpha() { return this.st.alpha; } set globalAlpha(v) { this.st.alpha = v; }
  get globalCompositeOperation() { return this.st.op; } set globalCompositeOperation(v) { this.st.op = v; }
  save() { this._stack.push({ ...this.st, props: STROKE_PROPS.map(k => this['_' + k]) }); for (const g of this._ctxs()) g.save(); }
  restore() { const s = this._stack.pop(); if (s) { STROKE_PROPS.forEach((k, i) => { this['_' + k] = s.props[i]; }); delete s.props; this.st = s; } for (const g of this._ctxs()) g.restore(); }
  setLineDash(d) { this.st.dash = d; } getLineDash() { return this.st.dash; }
  createLinearGradient(...a) { return new GradRec('linear', a); }
  createRadialGradient(...a) { return new GradRec('radial', a); }
  createPattern() { return null; }
  beginPath() { this._path = new Path2D(); }
  clip(p, rule) { const path = p instanceof Path2D ? p : this._path; const r = typeof p === 'string' ? p : rule || 'nonzero'; for (const g of this._ctxs()) g.clip(path, r); }
  fill(p, rule) { const path = p instanceof Path2D ? p : this._path; this._paint('fill', path, typeof p === 'string' ? p : rule || 'nonzero'); }
  stroke(p) { this._paint('stroke', p instanceof Path2D ? p : this._path); }
  fillRect(x, y, w, h) { const q = new Path2D(); q.rect(x, y, w, h); this._paint('fill', q, 'nonzero'); }
  strokeRect(x, y, w, h) { const q = new Path2D(); q.rect(x, y, w, h); this._paint('stroke', q); }
  clearRect(x, y, w, h) { for (const g of this._ctxs()) g.clearRect(x, y, w, h); }
  fillText(s, x, y, mw) { this._paint('text', [s, x, y, mw]); }
  strokeText(s, x, y, mw) { this._paint('stroketext', [s, x, y, mw]); }
  measureText(s) { const g = this.P.g[0]; this._props(g); return g.measureText(s); }
  _props(g) { for (const k of STROKE_PROPS) if (this['_' + k] !== undefined) g[k] = this['_' + k]; g.setLineDash(this.st.dash); }
  // colour -> { paper: bool, cov: [c0, c1, c2], a }
  _sepColor(css) {
    const [r, g, b, a] = rgba(css), P = this.P, pr = this._pb || (this._pb = P.paper.base.map(v => v * 255));
    if ((r > 250 && g > 250 && b > 250) || (Math.abs(r - pr[0]) + Math.abs(g - pr[1]) + Math.abs(b - pr[2]) < 9)) return { paper: true, cov: [0, 0, 0], a };
    for (const k of P.inks) if (Math.abs(r - k.rgb[0]) + Math.abs(g - k.rgb[1]) + Math.abs(b - k.rgb[2]) < 7) {
      // alphaMode 'density': the alpha came from a multiply-alpha encoding of an optical density d (empire4's T()):
      // a = (1 - L^d) / (1 - L), L = the ink's luminance against the paper. Decode d, which is what the scene meant.
      let c = a; if (this.alphaMode === 'density') { const L = Math.min(0.98, Math.max(0.02, lum3(k.rgb) / lum3(pr))); c = clamp01(Math.log(Math.max(1e-4, 1 - a * (1 - L))) / Math.log(L)); }
      const cov = [0, 0, 0]; cov[k.i] = c; return { paper: false, cov, a }; }
    // any other colour: optical densities against the paper, split into the inks (clamped), scaled by alpha
    const S = this._S || (this._S = P._sep(P.paper.base)), ld = [r, g, b].map((v, i) => Math.log(Math.max(v / 255, 0.015) / P.paper.base[i]));
    const d = [0, 1, 2].map(i => S[i] * ld[0] + S[i + 3] * ld[1] + S[i + 6] * ld[2]);   // S is column-major
    return { paper: false, cov: d.map(v => clamp01(v) * a), a };
  }
  _style(src, gA) {   // -> { solid: sep } or { grad: GradRec, stops: [[o, sep]] }
    if (typeof src === 'string') { const s = this._sepColor(src); return { solid: { ...s, cov: s.cov.map(v => v * gA), a: s.a * gA } }; }
    if (src instanceof GradRec) return { grad: src, stops: src.stops.map(([o, c]) => { const s = this._sepColor(c); return [o, { ...s, cov: s.cov.map(v => v * gA), a: s.a * gA }]; }) };
    return null;
  }
  // a fillStyle for plate g: per-ink alpha `f(sep)` from a solid or a gradient
  _fs(g, sty, f, chan) {
    if (sty.solid) return `rgba(${chan},${clamp01(f(sty.solid))})`;
    const R = sty.grad, gr = R.type === 'linear' ? g.createLinearGradient(...R.args) : g.createRadialGradient(...R.args);
    for (const [o, s] of sty.stops) gr.addColorStop(clamp01(o), `rgba(${chan},${clamp01(f(s))})`);
    return gr;
  }
  _any(sty, f) { return sty.solid ? f(sty.solid) > 1e-4 : sty.stops.some(([, s]) => f(s) > 1e-4); }
  _do(g, kind, path, rule, style) {
    this._props(g);
    if (kind === 'fill') { g.fillStyle = style; g.fill(path, rule); }
    else if (kind === 'stroke') { g.strokeStyle = style; g.stroke(path); }
    else if (kind === 'text') { g.fillStyle = style; g.fillText(...path.filter(v => v !== undefined)); }
    else if (kind === 'stroketext') { g.strokeStyle = style; g.strokeText(...path.filter(v => v !== undefined)); }
  }
  _paint(kind, path, rule) {
    const P = this.P, src = kind === 'stroke' || kind === 'stroketext' ? this.st.stroke : this.st.fill, sty = this._style(src, this.st.alpha);
    if (!sty) return;
    P.stats.routed++;
    const op = this.st.op, gain = P.knockGain;
    const paperish = sty.solid ? sty.solid.paper : sty.stops.every(([, s]) => s.paper);
    const lift = (g, f) => { if (!this._any(sty, f)) return; g.save(); g.globalCompositeOperation = 'destination-out'; this._do(g, kind, path, rule, this._fs(g, sty, f, '0,0,0')); g.restore(); };
    if (op === 'destination-out') { for (const g of this._ctxs()) if (g !== P.photoG || this.liftPhoto) lift(g, s => s.a); return; }
    if (paperish || (sty.grad && sty.stops.some(([, s]) => s.paper))) {
      // paper: under source-over it lifts every ink by its alpha (a knock-out / a light); under multiply it does nothing
      if (op === 'source-over' || op === 'copy') for (const g of this._ctxs()) if (g !== P.photoG || this.liftPhoto) lift(g, s => s.paper ? s.a : 0);
      if (paperish) return;
    }
    const knock = op === 'source-over' || op === 'copy';
    P.inks.forEach((k, i) => {
      const g = P.g[i], own = s => s.paper ? 0 : s.cov[i];
      if (knock) { const others = s => s.paper ? 0 : (s.cov[i] > 1e-4 ? 0 : Math.min(1, s.a * gain)); lift(g, others); }
      if (!this._any(sty, own)) return;
      g.save(); g.globalCompositeOperation = 'source-over'; this._do(g, kind, path, rule, this._fs(g, sty, own, CHN[i])); g.restore();
    });
    // photographs are placed deliberately (P.photo); router paints lift them only when liftPhoto is set
    if (knock && P.photoUsed && this.liftPhoto) lift(P.photoG, s => s.paper ? s.a : Math.min(1, s.a * gain));
  }
  // drawImage: a single-colour image (a mask filled with one colour) is routed like a fill; anything else is a photo
  drawImage(img, ...args) {
    const P = this.P, info = this._imgColor(img);
    if (!info) { P.stats.photo++; P.photoUsed = true; const g = P.photoG; g.save(); g.globalAlpha = this.st.alpha; g.globalCompositeOperation = this.st.op === 'multiply' ? 'multiply' : 'source-over'; g.drawImage(img, ...args); g.restore(); return; }
    P.stats.masks++;
    // the mask's alpha, tinted per plate through a scratch canvas the size of the image
    const iw = img.width, ih = img.height, s = P.scr;
    if (s.width !== iw || s.height !== ih) { s.width = iw; s.height = ih; }
    const sty = this._style(`rgba(${info[0]},${info[1]},${info[2]},${info[3]})`, this.st.alpha).solid;
    const lay = (g, chan, a, op) => { if (a <= 1e-4) return; const sg = P.scg; sg.setTransform(1, 0, 0, 1, 0, 0); sg.globalCompositeOperation = 'copy'; sg.drawImage(img, 0, 0);
      sg.globalCompositeOperation = 'source-in'; sg.fillStyle = `rgba(${chan},${clamp01(a)})`; sg.fillRect(0, 0, iw, ih); sg.globalCompositeOperation = 'source-over';
      g.save(); g.globalCompositeOperation = op; g.drawImage(s, ...args); g.restore(); };
    const op = this.st.op, knock = op === 'source-over' || op === 'copy';
    if (sty.paper) { if (knock) for (const g of this._ctxs()) lay(g, '0,0,0', sty.a, 'destination-out'); return; }
    P.inks.forEach((k, i) => { const g = P.g[i];
      if (knock && sty.cov[i] <= 1e-4) lay(g, '0,0,0', Math.min(1, sty.a * P.knockGain), 'destination-out');
      lay(g, CHN[i], sty.cov[i], 'source-over'); });
  }
  // [r, g, b, maxAlpha] if every visible pixel shares one colour (checked on a 48-px proxy), else null
  _imgColor(img) {
    if (img.__ink) return img.__ink;
    const pw = 48, ph = Math.max(8, Math.round(48 * (img.height || 1) / (img.width || 1)));
    const [c, g] = this._probe || (this._probe = mkc(pw, ph)); if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    g.clearRect(0, 0, pw, ph); g.drawImage(img, 0, 0, pw, ph); const d = g.getImageData(0, 0, pw, ph).data;
    let ref = null, amax = 0;
    for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; if (a < 128) continue; amax = Math.max(amax, a);
      if (!ref) { ref = [d[i], d[i + 1], d[i + 2]]; continue; }
      if (Math.abs(d[i] - ref[0]) + Math.abs(d[i + 1] - ref[1]) + Math.abs(d[i + 2] - ref[2]) > 24) return null; }
    return ref ? [...ref, 1] : [0, 0, 0, 0];
  }
}
for (const k of STROKE_PROPS) Object.defineProperty(InkRouter.prototype, k, { get() { return this['_' + k]; }, set(v) { this['_' + k] = v; } });

// the paper colour as #rrggbb (for scenes that need it)
export const plateInk = (P, name) => P.byName[name].hex;
