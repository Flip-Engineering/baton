// RANKS: a crowd designed as value registers, built from the silhouette library (HUMAN studio, cycle 3).
//
// Why: every crowd on the slate was one picture, a fringe of fists over a black slab. The bodies were placed bottom-up
// and then styled. Every tradition that draws crowds well works top-down: Deineka's registers (each rank its own value,
// a clean gap between), Klutsis' scale collision (a hero element and a mass, never a middle scale), Masereel and
// Kollwitz carving the white BETWEEN ranks rather than round each body, Arntz's designed silhouettes. So a crowd here
// is 3-5 RANKS, each with a foot line, a figure height (the scale ladder: hero / near / mass / texture), a value, a
// density and a gesture budget, filled with designed silhouettes (sil.js) and lit like a Klaus cut-out: a baked rim
// and key from the 3D body plus a 2D edge rim toward the sun, a ground plate with contact and cast shadows (no melting
// feet), and an aux whose depth is FLAT per rank, so a look cuts its keyline only where the rank changes.
//
//   import { Ranks } from '../lib/fx/ranks.js';
//   const R = await Ranks.create();                                   // 1080 x 1920, loads the SIL atlas
//   const crowd = R.design({ seed: 3, ranks: [
//     { foot: 1640, h: 420, n: 7, raise: 0.3, flags: 1 },            // near: 20-25% of frame height
//     { foot: 1180, h: 150, n: 26, raise: 0.25, flags: 2 },           // mass
//     { foot: 1040, h: 62, n: 70, raise: 0.12 },                      // texture
//   ] });
//   const out = R.compose(ctx, crowd, t, { back: g => sky(g), sun: [540, 900], style: 'dusk' });   // -> { aux, layers, stats }
//   lk.source({ color: canvas, aux: out.aux, depth: [1, Math.E ** 4], tonal: ['subject', 'ground'], rankCut: true });
//
// Motion: fig.act = 'stand' | 'walk' | 'raise' | 'flag' | 'tool'. crowd.hit(hitT, { from: [x, y], speed }) schedules a
// fist wave: each raising figure's onset ripples outward from the hero (Massive's master and followers, 0-4 frame
// jitter); the envelope is ANTICIPATION (3 frames cocked), a STRIKE that lands on the hit frame with a smear, a 1-frame
// overshoot, then a settle that pumps on twos. crowd.surge(v) advances every rank (m/s of foot-line travel).
import * as THREE from 'three';
import { loadSil, BACK_FIST, STANDS, WALK } from './sil.js';

const rng = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hex = h => new THREE.Color().setStyle(h, THREE.LinearSRGBColorSpace);     // raw values: the ladder is authored in display values
const setc = (c, h) => c.setStyle(h, THREE.LinearSRGBColorSpace);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// the value ladders (rank 0 = nearest). Colours are the RAW render's; a look re-prints them from their tone.
export const RANK_STYLES = {
  dusk: {   // a low sun ahead of the crowd: near ranks near-black, each rank back a step into the lit dust
    ink: ['#0b0706', '#44200f', '#86401f', '#bc6636', '#dc8a52'], rim: '#ffb46a', rimAmt: [1.0, 0.8, 0.55, 0.35, 0.2], key: '#6a3a2a', keyAmt: [0.12, 0.1, 0.06, 0.03, 0], acc: '#050303', accAmt: [0.7, 0.55, 0.35, 0.15, 0],
    shadow: '#1a0906', shadowA: 0.72, ground: ['#c0602e', '#6a2c16'], dust: '#f09a58', flag: '#c8201a', flagDark: '#7a0c0a', emblem: '#f2c14a' },
  day: {    // flat daylight, WPA poster: the ranks step from dark to light, the key paints the lit side
    ink: ['#2a2622', '#4a4038', '#6e6254', '#948674', '#b6aa96'], rim: '#fff4d8', rimAmt: [0.35, 0.25, 0.15, 0.08, 0], key: '#e8d2a8', keyAmt: [0.55, 0.45, 0.3, 0.2, 0.1], acc: '#15110e', accAmt: [0.6, 0.45, 0.3, 0.1, 0],
    shadow: '#3a2e24', shadowA: 0.55, ground: ['#c9b48a', '#9a8460'], dust: '#e8dcc0', flag: '#bd1818', flagDark: '#7a0c0a', emblem: '#f2e6c8' },
  night: {  // sodium keys from above: the heads and shoulders catch the orange, the bodies fall to blue-black
    ink: ['#06070a', '#12141c', '#23242c', '#3a3432', '#5a4a3a'], rim: '#ffae4a', rimAmt: [1.0, 0.85, 0.6, 0.4, 0.25], key: '#ffae4a', keyAmt: [0.2, 0.15, 0.1, 0.05, 0], acc: '#020203', accAmt: [0.6, 0.5, 0.3, 0.1, 0],
    shadow: '#020203', shadowA: 0.8, ground: ['#3a2a1a', '#0a0a0c'], dust: '#ffae4a', flag: '#b0140e', flagDark: '#5a0806', emblem: '#ffcf70' },
};

const VS = /* glsl */`
precision highp float;
attribute vec3 position;
attribute vec4 aDst, aSrc, aCell, aTint;
uniform mat4 projectionMatrix, modelViewMatrix;
uniform vec2 uShadow;
varying vec2 vUv, vQ; varying vec4 vCell, vTint; varying float vUp;
void main(){
  vec2 q = position.xy;
  float fl = aCell.x;
  vec2 uq = vec2(fl > .5 ? 1. - q.x : q.x, q.y);
  vUv = mix(aSrc.xy, aSrc.zw, uq); vQ = q; vCell = aCell; vTint = aTint;
  float footU = fl > .5 ? 1. - aCell.y : aCell.y;
  vec2 p = aDst.xy + q * aDst.zw;
  vUp = (aCell.z - q.y);                               // cell units above the foot line
  if (aCell.w > .5) {                                  // cast shadow: flip about the foot line, thrown along uShadow
    vec2 F = aDst.xy + vec2(footU, aCell.z) * aDst.zw;
    float h = (aCell.z - q.y) * aDst.w; float dx = (q.x - footU) * aDst.z;
    p = F + vec2(dx, 0.) + (uShadow + vec2(aTint.z, 0.)) * h;
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0., 1.);
}`;
const FS = /* glsl */`
precision highp float;
uniform sampler2D uAtlas; uniform vec2 uTexel, uLight;
uniform vec3 uInk, uRim, uKey, uAcc, uShadowCol, uJit;
uniform float uRimAmt, uKeyAmt, uAccAmt, uShadowA, uEdge, uFigH;
varying vec2 vUv, vQ; varying vec4 vCell, vTint; varying float vUp;
void main(){
  vec4 s = texture2D(uAtlas, vUv);
  float a = s.a * vTint.w;
  if (a < .003) discard;
  if (vCell.w > .5) {                                  // shadow: dense at the foot, fading along its length
    float f = clamp(vUp / uFigH, 0., 1.);
    float k = step(.35, a) * uShadowA * (1. - .55 * f);
    gl_FragColor = vec4(uShadowCol * k, k); return; }
  float lowCut = smoothstep(.12, .26, vUp);            // no rim or key on the feet (a lifted boot sole glowed white: 'lanterns at the feet')
  vec2 lo = uLight * uTexel * uEdge; if (vCell.x > .5) lo.x = -lo.x;
  float aUp = texture2D(uAtlas, vUv + lo).a, aUp2 = texture2D(uAtlas, vUv + lo * .5).a;
  float edge = s.a * (1. - .5 * (aUp + aUp2));        // the 2D rim: coverage that has no coverage toward the sun
  float rim = edge * (.9 + .9 * s.r) * lowCut;          // the baked 3D rim only brightens the silhouette crescent (a lifted boot sole faces the sun and lit up whole)
  vec3 c = uInk + uJit * (vTint.x - .5);
  c = mix(c, uKey, s.g * uKeyAmt * lowCut);
  c = mix(c, uAcc, s.b * uAccAmt * vTint.y);
  c += uRim * rim * uRimAmt;
  gl_FragColor = vec4(c * a, a);
}`;

export class Ranks {
  static async create({ W = 1080, H = 1920 } = {}) { return new Ranks(await loadSil(), W, H); }
  constructor(sil, W = 1080, H = 1920) {
    this.sil = sil; this.W = W; this.H = H;
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.r = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    this.r.setPixelRatio(1); this.r.setSize(W, H, false); this.r.setClearColor(0x000000, 0);
    this.cam = new THREE.OrthographicCamera(0, W, 0, H, -10, 10); this.cam.position.z = 5; this.cam.updateMatrixWorld();
    const tex = new THREE.Texture(sil.bitmap); tex.flipY = false; tex.premultiplyAlpha = false; tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.anisotropy = 4; tex.needsUpdate = true;
    this.tex = tex;
    const max = 4096, g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    this.attr = {};
    for (const k of ['aDst', 'aSrc', 'aCell', 'aTint']) { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); this.attr[k] = a; }
    this.geo = g; this.max = max;
    this.U = { uAtlas: { value: tex }, uTexel: { value: new THREE.Vector2(1 / sil.W, 1 / sil.H) }, uLight: { value: new THREE.Vector2(0, -1) }, uEdge: { value: 3 },
      uInk: { value: hex('#000') }, uRim: { value: hex('#fff') }, uKey: { value: hex('#888') }, uAcc: { value: hex('#000') }, uShadowCol: { value: hex('#000') }, uJit: { value: new THREE.Vector3(0.03, 0.025, 0.02) },
      uRimAmt: { value: 1 }, uKeyAmt: { value: 0 }, uAccAmt: { value: 0.5 }, uShadowA: { value: 0.6 }, uShadow: { value: new THREE.Vector2(0.2, 0.7) }, uFigH: { value: 0.7 } };
    this.mat = new THREE.RawShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: this.U, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    this.layer = []; this.emblem = null;
  }

  // ---------------------------------------------------------------- design
  // ranks[i] = { foot (px y of the foot line), h (figure px), n | spacing, x0, x1 (px), raise (share), flags, tools,
  //   walk (bool), kinds (headwear allowed), jitter (foot-line depth spread, share of h), stride (s) }
  design({ seed = 1, ranks, heroX = null } = {}) {
    const r = rng(seed * 7919 + 3), S = this.sil, crowd = { ranks: [], seed, hitT: null, heroX };
    ranks.forEach((R, ri) => {
      if (R.draw) { crowd.ranks.push({ spec: R, figs: [], i: ri, custom: R.draw }); return; }   // a rank drawn by the caller (3D hero backs): (t) -> canvas
      // packing: shoulder-to-shoulder at pack 1 (a back is ~0.26 of the figure's height wide), in `rows` staggered
      // sub-rows (the rank's thickness), clumped, with an occasional gap (Deineka's rhythm, never a comb)
      const x0 = R.x0 ?? -0.08 * this.W, x1 = R.x1 ?? 1.08 * this.W, figs = [], rows = R.rows ?? (ri === 0 ? 1 : 2 + (ri > 1 ? 1 : 0)), pack = R.pack ?? 1.1;
      const used = new Set();
      for (let row = 0; row < rows; row++) {
        const kh = 1 - row * (R.thick ?? 0.16) * 0.6, hRow = R.h * kh, yRow = R.foot - row * (R.thick ?? 0.16) * R.h, sw = 0.26 * hRow / pack;
        let x = x0 + (row % 2 ? sw * 0.5 : 0) + r() * sw * 0.4;
        while (x < x1) {
          if (r() < (R.gaps ?? 0.07)) { x += sw * (1 + 1.5 * r()); continue; }
          const type = S.pick(r, { kinds: R.kinds, not: used }); used.add(type); if (used.size > 20) used.clear();
          const ty = S.types[type], hh = hRow * (ty.h / 1.78) * (1 + (r() - 0.5) * 0.04);
          figs.push({ rank: ri, row, type, x: x + (r() - 0.5) * sw * 0.3, y: yRow + (r() - 0.5) * (R.jitter ?? 0.07) * R.h, h: hh, flip: r() < 0.5, act: R.walk ? 'walk' : 'stand', ph: r(), seed: r(), val: r(), acc: 1 });
          x += sw * (0.72 + 0.5 * r());
        }
      }
      // gestures: raise / flag / tool budgets (flags first: they need room)
      const order = figs.map((_, i) => i).sort(() => r() - 0.5);
      let nf = R.flags || 0, nt = Math.round((R.tools || 0) * figs.length), nr = Math.round((R.raise || 0) * figs.length);
      for (const i of order) { const f = figs[i];
        if (nf > 0 && f.x > 0.05 * this.W && f.x < 0.95 * this.W) { f.act = 'flag'; f.flagSeed = r(); nf--; continue; }
        if (nt > 0) { f.act = 'tool'; f.tool = r() < 0.5 ? 'sledge' : 'shovel'; nt--; continue; }
        if (nr > 0) { f.raise = true; f.fist = BACK_FIST[Math.floor(r() * 2)]; if (!R.walk) f.act = 'raise'; nr--; continue; }
      }
      figs.sort((a, b) => a.y - b.y);
      crowd.ranks.push({ spec: R, figs, i: ri });
    });
    return crowd;
  }
  // a fist wave landing on hitT: onsets ripple from (fx, fy) at `speed` px per frame, jitter 0-4 frames
  hit(crowd, hitT, { from = [this.W / 2, this.H], speed = 90, jitter = 4, lead = 0 } = {}) {
    const r = rng(crowd.seed * 31 + 7);
    crowd.hitT = hitT;
    for (const R of crowd.ranks) for (const f of R.figs) if (f.raise) {
      const d = Math.hypot(f.x - from[0], (f.y - from[1]) * 0.5);
      f.onset = hitT + (lead + d / speed + Math.floor(r() * (jitter + 1))) / 30; f.act = 'strike'; }
    return crowd;
  }

  // the cell a figure shows at time t (and a ghost for the smear frame, and a y-stretch for the overshoot)
  _pose(f, t, fps = 30) {
    const S = this.sil, st = f.seed < 0.12 ? 'heave' : STANDS[Math.floor(f.seed * 3)];
    if (f.act === 'walk') { const stride = f.stride || 1.08, k = Math.floor(((t / stride + f.ph) % 1) * 8); const on2 = f.twos === false ? k : k; return { c: S.cell(f.type, WALK[on2 % 8]) }; }
    if (f.act === 'flag') return { c: S.cell(f.type, 'pole') };
    if (f.act === 'tool') return { c: S.cell(f.type, f.tool) };
    if (f.act === 'raise') return { c: S.cell(f.type, f.fist) };
    if (f.act === 'strike') {
      const k = Math.round((t - f.onset) * fps);
      if (k < -3) return { c: S.cell(f.type, st) };
      if (k < 0) return { c: S.cell(f.type, 'rise'), dy: 0.012 * (k + 4) };                  // anticipation: cocked, dipping
      if (k === 0) return { c: S.cell(f.type, 'pumpHi'), ghost: S.cell(f.type, 'rise'), smear: 1 };   // the strike: lands ON the frame, with a smear
      if (k === 1) return { c: S.cell(f.type, 'pumpHi'), sy: 1.035 };                          // overshoot
      const ph = Math.floor((k - 2) / 2);                                                       // settle, then pump on twos
      return { c: S.cell(f.type, k < 10 ? 'pumpHi' : (Math.floor((k - 10) / 8) % 2 ? 'pumpLo' : 'pumpHi')), ph };
    }
    return { c: S.cell(f.type, st) };
  }

  // ---------------------------------------------------------------- render
  _fill(list, kind) {
    const S = this.sil, A = this.attr; let n = 0;
    const put = (c, x, y, h, flip, val, acc, alpha, sy = 1) => {
      if (!c || n >= this.max) return;
      const k = h / (S.types[c.type].h * S.PPM), w = S.CW * k, hh = S.CH * k * sy, fu = c.foot[0] / S.CW, fv = c.foot[1] / S.CH;
      const dx = flip ? x - (1 - fu) * w : x - fu * w, dy = y - fv * hh;
      A.aDst.setXYZW(n, dx, dy, w, hh); A.aSrc.setXYZW(n, c.x / S.W, c.y / S.H, (c.x + S.CW) / S.W, (c.y + S.CH) / S.H);
      A.aCell.setXYZW(n, flip ? 1 : 0, fu, fv, kind); A.aTint.setXYZW(n, val, acc, this._fan ? (x - this._fan[0]) / this._fan[1] : 0, alpha); n++;
    };
    for (const it of list) {
      if (it.ghost) { put(it.ghost, it.x, it.y, it.h, it.flip, it.val, it.acc, 0.35); put(it.ghost, it.x, it.y - it.h * 0.05, it.h, it.flip, it.val, it.acc, 0.25); }
      put(it.c, it.x, it.y + (it.dy || 0) * it.h, it.h, it.flip, it.val, it.acc, 1, it.sy || 1);
    }
    for (const a of Object.values(A)) { a.needsUpdate = true; }
    this.geo.instanceCount = n; return n;
  }
  _draw() { this.r.setRenderTarget(null); this.r.clear(); this.r.render(this.scene, this.cam); }
  _layer(i) { let c = this.layer[i]; if (!c) { c = this.layer[i] = document.createElement('canvas'); c.width = this.W; c.height = this.H; } const g = c.getContext('2d'); g.clearRect(0, 0, this.W, this.H); return [c, g]; }

  // compose the crowd over whatever `back(g)` paints (sky, sun, far land). o: { style (name or object), sun: [x, y],
  //   ground: false | { y0 } (the plate from y0 down), shadow: [sx, sy] per unit height, t, fps, flagWind, dust }
  compose(ctx, crowd, t, o = {}) {
    const W = this.W, H = this.H, st = typeof o.style === 'object' ? o.style : RANK_STYLES[o.style || 'dusk'], U = this.U;
    const sun = o.sun || [W * 0.5, H * 0.45];
    const nR = crowd.ranks.length, t0 = performance.now();
    if (o.back) o.back(ctx);
    // the ground plate: its own value from the rearmost foot line down (lit dust toward the sun, darker toward us)
    const gy0 = o.ground?.y0 ?? Math.min(...crowd.ranks.map(R => R.spec.foot - R.spec.h * 0.12));
    if (o.ground !== false) {
      const gr = ctx.createLinearGradient(0, gy0, 0, H); gr.addColorStop(0, st.ground[0]); gr.addColorStop(1, st.ground[1]);
      ctx.fillStyle = gr; ctx.fillRect(0, gy0, W, H - gy0);
      if (o.dust !== false) { const rg = ctx.createRadialGradient(sun[0], gy0, 10, sun[0], gy0, W * 0.9); rg.addColorStop(0, st.dust); rg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = rg; ctx.fillRect(0, gy0, W, H - gy0); ctx.restore(); }
    }
    const layers = [], flags = [];
    for (let ri = nR - 1; ri >= 0; ri--) {
      const R = crowd.ranks[ri], L = Math.min(ri, st.ink.length - 1);
      if (R.custom) { const cv = R.custom(t), [lc, lg] = this._layer(ri); lg.drawImage(cv, 0, 0);
        const fc = (this._figs ||= [])[ri] || (this._figs[ri] = Object.assign(document.createElement('canvas'), { width: W, height: H })); const fg = fc.getContext('2d'); fg.clearRect(0, 0, W, H); fg.drawImage(cv, 0, 0);
        layers[ri] = { canvas: lc, figs: fc, flags: null, foot: R.spec.foot, h: R.spec.h }; ctx.drawImage(lc, 0, 0); continue; }
      const items = R.figs.map(f => { const p = this._pose(f, t, o.fps || 30); const s = crowd.surge ? crowd.surge(f, t) : null;
        return { ...p, x: f.x + (s ? s.dx : 0), y: f.y + (s ? s.dy : 0), h: f.h * (s ? s.k : 1), flip: f.flip, val: f.val, acc: f.acc, f }; }).filter(it => it.c);
      // shadows onto the ground (thrown toward the camera by a sun behind the crowd)
      const sv = o.shadow || [0, 0.28 + 0.14 * (1 - ri / Math.max(1, nR - 1))];
      this._fan = [sun[0], (o.fan ?? 1.1) * W];     // shadows fan out from under the sun (Rodchenko's radial ground)
      U.uShadow.value.set(sv[0], sv[1]); setc(U.uShadowCol.value, st.shadow); U.uShadowA.value = st.shadowA * (o.shadowAmt ?? 1); U.uFigH.value = 0.72;
      const [lc, lg] = this._layer(ri);
      // contact shadows: a flat ink disc of 0.6 body-width under each figure (the feet stand ON the plate)
      lg.save(); lg.fillStyle = st.shadow;
      for (const it of items) { const w = it.h * 0.16; lg.globalAlpha = 0.85; lg.beginPath(); lg.ellipse(it.x, it.y - it.h * 0.004, w, w * 0.22, 0, 0, Math.PI * 2); lg.fill(); }
      lg.restore();
      if (o.shadowAmt !== 0) { this._fill(items, 1); this._draw(); lg.drawImage(this.canvas, 0, 0); }
      this._fan = null;
      // the figures
      setc(U.uInk.value, st.ink[L]); setc(U.uRim.value, st.rim); setc(U.uKey.value, st.key); setc(U.uAcc.value, st.acc);
      U.uRimAmt.value = st.rimAmt[L]; U.uKeyAmt.value = st.keyAmt[L]; U.uAccAmt.value = st.accAmt[L];
      const lv = new THREE.Vector2(sun[0] - W / 2, sun[1] - (R.spec.foot - R.spec.h)).normalize(); U.uLight.value.set(lv.x, lv.y);
      U.uEdge.value = clamp(R.spec.h / 110, 1, 5.5) * 231 / R.spec.h;      // the 2D rim: 1 px at texture scale, ~5 px on a hero-scale back
      this._fill(items, 0); this._draw();
      // figures sit ABOVE their own rank's shadows, but only this rank's: draw the figure pass over the layer
      const fc = (this._figs ||= [])[ri] || (this._figs[ri] = Object.assign(document.createElement('canvas'), { width: W, height: H })), fg = fc.getContext('2d');
      fg.clearRect(0, 0, W, H); fg.drawImage(this.canvas, 0, 0);
      // flags and poles of this rank (2D, designed: a pole through both grips, cloth in folds, the emblem)
      const fl = (this._fls ||= [])[ri] || (this._fls[ri] = Object.assign(document.createElement('canvas'), { width: W, height: H })), flg = fl.getContext('2d'); flg.clearRect(0, 0, W, H); let hasFlag = false;
      for (const it of items) if (it.f.act === 'flag' && it.c.pole) { hasFlag = true; this._flag(fg, flg, it, t, st, o); }
      lg.drawImage(fc, 0, 0);
      if (hasFlag) lg.drawImage(fl, 0, 0);
      layers[ri] = { canvas: lc, figs: fc, flags: hasFlag ? fl : null, foot: R.spec.foot, h: R.spec.h };
      ctx.drawImage(lc, 0, 0);
      // lit dust in the gap in front of this rank: a thin band at its foot line, so the next rank stands clear of it
      if (ri > 0 && o.gap !== false) { const y = R.spec.foot, gh = R.spec.h * 0.22; const gr = ctx.createLinearGradient(0, y - gh, 0, y + gh * 0.4);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.75, st.dust); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.save(); ctx.globalAlpha = (o.gapAmt ?? 0.28) * (1 - ri / (nR + 1)); ctx.fillStyle = gr; ctx.fillRect(0, y - gh, W, gh * 1.4); ctx.restore(); }
    }
    const aux = this.aux(crowd, layers, gy0);
    this.stats = { ms: performance.now() - t0, figures: crowd.ranks.reduce((a, R) => a + R.figs.length, 0) };
    return { aux, layers, stats: this.stats, groundY: gy0 };
  }

  // a flag: pole through the two grips (up 2.4 figure-heights... no: 1.35 figure heights above the top hand),
  // cloth as a strip of wave segments shaded by its folds, the emblem printed on it
  _flag(fg, flg, it, t, st, o) {
    const S = this.sil, c = it.c, k = it.h / (S.types[c.type].h * S.PPM), fu = c.foot[0], fv = c.foot[1];
    const P = p => [it.flip ? it.x - (p[0] - fu) * k : it.x + (p[0] - fu) * k, it.y + (p[1] - fv) * k];
    const lo = P(c.pole[0]), hi = P(c.pole[1]); let dx = hi[0] - lo[0], dy = hi[1] - lo[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    if (dy > -0.6) { dx = 0.25 * Math.sign(dx || 1); dy = -0.97; }
    const b0 = [lo[0] - dx * it.h * 0.28, lo[1] - dy * it.h * 0.28], top = [hi[0] + dx * it.h * 0.95, hi[1] + dy * it.h * 0.95];
    fg.save(); fg.strokeStyle = '#120a06'; fg.lineCap = 'round'; fg.lineWidth = Math.max(1.5, it.h * 0.017);
    fg.beginPath(); fg.moveTo(...b0); fg.lineTo(...top); fg.stroke(); fg.restore();
    // cloth: w x h in figure units, flying away from the wind side
    const wind = o.flagWind ?? 1, fw = it.h * 0.62, fh = it.h * 0.4, side = it.f.flagSeed < 0.5 ? 1 : -1, n = 18;
    const pt = (u, v) => { const wave = Math.sin(u * 5.2 - t * 6 * wind + it.f.flagSeed * 9) * fh * 0.1 * u + Math.sin(u * 11 - t * 9) * fh * 0.025 * u;
      return [top[0] + side * u * fw * (1 - 0.1 * u * Math.abs(Math.sin(t * 2 + u))), top[1] + v * fh + wave + u * u * fh * 0.12]; };
    const g = flg; g.save();
    for (let i = 0; i < n; i++) { const u0 = i / n, u1 = (i + 1) / n;
      const a = pt(u0, 0), b = pt(u1, 0), c2 = pt(u1, 1), d = pt(u0, 1);
      const shade = 0.5 + 0.5 * Math.cos(u0 * 5.2 - t * 6 * wind + it.f.flagSeed * 9 + 0.8);
      g.fillStyle = shade > 0.62 ? st.flag : st.flagDark; if (shade > 0.9) g.fillStyle = st.flag;
      g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.lineTo(...c2); g.lineTo(...d); g.closePath(); g.fill();
      g.strokeStyle = g.fillStyle; g.lineWidth = 1; g.stroke(); }
    // the emblem: hammer-and-sickle mark near the hoist, riding the cloth's first third
    if (this.emblem && it.h > 60) { const e0 = pt(0.3, 0.5), s = fh * 0.5; g.globalAlpha = 0.95;
      const em = this._emb || (this._emb = (() => { const c = document.createElement('canvas'); c.width = this.emblem.width; c.height = this.emblem.height; const cg = c.getContext('2d'); cg.drawImage(this.emblem, 0, 0); cg.globalCompositeOperation = 'source-in'; cg.fillStyle = st.emblem; cg.fillRect(0, 0, c.width, c.height); return c; })());
      g.translate(e0[0], e0[1]); g.transform(1, 0.12 * Math.sin(t * 6 * wind + it.f.flagSeed * 9), 0, 1, 0, 0); g.drawImage(em, -s * 0.5, -s * 0.5, s, s); }
    g.restore();
  }

  // the aux the looks read: depth FLAT per rank (keylines only where the rank changes), class subject for figures,
  // spot for flags, the ground's depth running between the ranks' foot lines, sky beyond the rearmost rank
  aux(crowd, layers, gy0, { w = 540, h = 960 } = {}) {
    const c = this._auxC || (this._auxC = Object.assign(document.createElement('canvas'), { width: w, height: h })), g = c.getContext('2d', { willReadFrequently: true });
    const out = g.createImageData(w, h), D = out.data, nR = crowd.ranks.length, sy = this.H / h;
    const dOf = ri => 0.12 + 0.62 * ri / Math.max(1, nR - 1);
    const feet = crowd.ranks.map(R => R.spec.foot);
    for (let y = 0; y < h; y++) { const Y = y * sy; let d = 1, cls = 0;
      if (Y >= gy0) { // ground: interpolate depth by the foot lines (near ranks at the bottom)
        let dd = dOf(nR - 1) + 0.1; for (let i = 0; i < nR; i++) if (Y >= feet[i] - 1) { const a = i > 0 ? feet[i - 1] : this.H; const f = clamp((Y - feet[i]) / Math.max(1, a - feet[i])); dd = dOf(i) + 0.02 - f * (dOf(i) - (i > 0 ? dOf(i - 1) : 0.02)); break; }
        d = dd; cls = 0; }
      for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; if (d >= 1) { D[o] = 255; D[o + 1] = 255; D[o + 2] = 0; } else { const l = Math.round(65534 * d); D[o] = l >> 8; D[o + 1] = l & 255; D[o + 2] = cls; } D[o + 3] = 255; } }
    const t = this._auxT || (this._auxT = Object.assign(document.createElement('canvas'), { width: w, height: h })), tg = t.getContext('2d', { willReadFrequently: true });
    for (let ri = nR - 1; ri >= 0; ri--) { const L = layers[ri]; if (!L) continue;
      for (const [cv, cls] of [[L.figs, 255], [L.flags, 180]]) { if (!cv) continue;
        tg.clearRect(0, 0, w, h); tg.drawImage(cv, 0, 0, w, h); const A = tg.getImageData(0, 0, w, h).data, l = Math.round(65534 * dOf(ri));
        for (let j = 0; j < w * h; j++) if (A[j * 4 + 3] > 110) { D[j * 4] = l >> 8; D[j * 4 + 1] = l & 255; D[j * 4 + 2] = cls; } } }
    g.putImageData(out, 0, 0); return c;
  }
}

// ---------------------------------------------------------------- the feed-size acceptance check (A5 of the brief)
// canvas -> { darkMax (largest connected dark region, share of frame), rankValues (distinct mean values of the ranks'
// figure pixels), ... } measured at 270 px wide
export function feedCheck(canvas, layers = null, { dark = 0.14, exclude = null } = {}) {   // exclude (LOOKS c2b): a canvas of the DESIGNED hero mass (alpha); its pixels never count as slab
  const w = 270, h = 480, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(canvas, 0, 0, w, h); const D = g.getImageData(0, 0, w, h).data;
  const L = new Float32Array(w * h); for (let i = 0; i < w * h; i++) L[i] = (0.2126 * D[i * 4] + 0.7152 * D[i * 4 + 1] + 0.0722 * D[i * 4 + 2]) / 255;
  const Lx = L.slice(); if (exclude) { const e = document.createElement('canvas'); e.width = w; e.height = h; const eg = e.getContext('2d', { willReadFrequently: true }); eg.drawImage(exclude, 0, 0, w, h); const E = eg.getImageData(0, 0, w, h).data; for (let i = 0; i < w * h; i++) if (E[i * 4 + 3] > 60) Lx[i] = 1; }
  const seen = new Uint8Array(w * h); let best = 0; const st = [];
  for (let i = 0; i < w * h; i++) { if (seen[i] || L[i] > dark) continue; let n = 0; st.push(i); seen[i] = 1;
    while (st.length) { const j = st.pop(); n++; const x = j % w, y = (j / w) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const q = ny * w + nx; if (!seen[q] && L[q] <= dark) { seen[q] = 1; st.push(q); } } }
    best = Math.max(best, n); }
  const res = { darkMax: +(best / (w * h)).toFixed(3) };
  if (exclude) { seen.fill(0); let b2 = 0; for (let i = 0; i < w * h; i++) { if (seen[i] || Lx[i] > dark) continue; let n = 0; st.push(i); seen[i] = 1;
      while (st.length) { const j = st.pop(); n++; const x = j % w, y = (j / w) | 0;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const q = ny * w + nx; if (!seen[q] && Lx[q] <= dark) { seen[q] = 1; st.push(q); } } }
      b2 = Math.max(b2, n); } res.darkMaxRanks = +(b2 / (w * h)).toFixed(3); }
  if (layers) { const vals = [];
    for (const Ly of layers) { if (!Ly) continue; g.clearRect(0, 0, w, h); g.drawImage(Ly.figs, 0, 0, w, h); const A = g.getImageData(0, 0, w, h).data; let s = 0, n = 0;
      for (let i = 0; i < w * h; i++) if (A[i * 4 + 3] > 200) { s += L[i]; n++; } if (n) vals.push(+(s / n).toFixed(3)); }
    res.rankValues = vals; res.distinctRanks = vals.filter((v, i) => vals.every((u, j) => j >= i || Math.abs(u - v) > 0.04)).length;
    res.rankMerge = vals.slice(1).filter((v, i) => Math.abs(v - vals[i]) < 0.05).length; }   // c2b: adjacent ranks within 0.05 (the merge the slab measure should have counted)
  return res;
}
