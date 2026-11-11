// PRODUCTIVE FORCES v4 (c12): the MONITORING WALL, now read off real archive film. A FLIR wall of the plant (VISUAL_BIBLE §2.10): every panel is a
// public-domain film shot (Master Hands 1936, Steel: Man's Servant 1938, A Great Railroad at Work 1942, Electronics at Work 1943, Boulder Dam,
// cut by _c12/productive_bake.py through tools/heat_key.py) turned into a HEAT field: people, hands, molten metal and running machines are hot,
// skies and windows are cold (a heat key, not luminance). The film writes TEMPERATURE into one float buffer, one viewport per panel; one sensor
// pass per panel maps it through that panel's palette and AGC (the v3 grammar: palettes, AGC hunt, NUC shutter freezes, bezels, readouts).
// The words are hot objects written into the same buffer. The water tower and its emblem stay 3D (three.js) and are the ending: the emblem cools
// and the lockup comes out of it. Script: research/scripts_final/productive.json. Song (c20): web/audio/songs2/productive_c20.py, three new scores on the music's grid
// (songs2/productive_tl20.py, 128 bpm, timeline20.json); takes productive2_a/_b/_c. The plant bed and productive_e.py are retired.
import * as THREE from 'three';
import { mergeGeometries } from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import { W, H, loadFonts, loadBeats, clamp, lerp, ease, rng, Finish, outCanvas, line, acpEmblem, setFont } from '../lib/kit.js';
import { drawMark, drawLockup, markBox } from '../lib/closer.js';

const ctx = outCanvas();
await loadFonts();
// c20: takes are their own scenes (productive2_a.js, _b.js: window.PF_SCENE / PF_TAKE) so the farm renders them side by side
const SCENE = window.PF_SCENE ?? 'productive2', TAKE = window.PF_TAKE ?? {};
const B = await loadBeats(SCENE);
const finish = new Finish(1538);
// c13: the piece's time is in SECONDS and its quick cuts fall on the firings of one machine (the song's pulse: songs2/productive_tl.py writes
// assets/productive/timeline.json: K = the structure, cuts = the firing times the wall swaps on). Nothing here is on a bar grid.
// c20: the picture is cut to the music (songs2/productive_tl20.py: 128 bpm, every card on a beat); timeline.json is the old pulse timeline
const TL = await (await fetch(new URL('../assets/productive/' + (window.PF_TL ?? 'timeline20') + '.json', import.meta.url))).json();
const T = TL.K;
// 8 Oct (archive audit item 7): the stop is 5 frames, not T.nuc .. T.nuc_open (the client called the 1.2 s grey field an "editing error"): the last
// thermal frame freezes on the shutter's clack at STOP and the pour comes in at T.nuc_open. The score (songs2/productive_e.py STOP) clacks here.
const STOP = T.nuc_open - 5 / 30;
const END = T.lock;                                 // the lockup; the render is trimmed 1.4 s after it

// ---------------------------------------------------------------- units: temperature in kC (1.0 = 1000 °C)
const F = (k) => k * 1800 + 32;                     // kC -> °F
const fmtF = (k) => { const f = F(k); return (Math.abs(f) >= 1000 ? Math.round(f).toLocaleString('en-US') : f.toFixed(1)) + '°F'; };
const AIR = 0.019;

// ---------------------------------------------------------------- renderer and sensor targets
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.autoClear = true;
const TS = 0.75, TW = Math.round(W * TS), TH = Math.round(H * TS);
const rtT = new THREE.WebGLRenderTarget(TW, TH, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, samples: 0 });
const rtB = new THREE.WebGLRenderTarget(W / 4, H / 4, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
const rtB2 = rtB.clone();
const MX = 54, MY = 96;
const rtM = new THREE.WebGLRenderTarget(MX, MY, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
const mbuf = new Float32Array(MX * MY * 4);

// ---------------------------------------------------------------- GLSL shared
const NOISE = `
float h13(vec3 p){ p = fract(p*.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float vn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
  return mix(mix(mix(h13(i), h13(i+vec3(1,0,0)), f.x), mix(h13(i+vec3(0,1,0)), h13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i+vec3(0,0,1)), h13(i+vec3(1,0,1)), f.x), mix(h13(i+vec3(0,1,1)), h13(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float v = 0., a = .5; for(int i=0;i<4;i++){ v += a*vn3(p); p = p*2.07+vec3(1.7,9.2,3.1); a *= .5; } return v; }
`;
const TM_VS = `
attribute float aT;
varying vec3 vW; varying vec3 vN; varying float vT; varying vec2 vUv; varying vec3 vI;
void main(){
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
#endif
  vec4 w = m * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(m) * normal); vUv = uv; vT = aT; vI = vec3(0.);
#ifdef USE_INSTANCING_COLOR
  vI = instanceColor;
#endif
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const TM_FS = NOISE + `
uniform float uBase, uAmp, uScale, uFlow, uEps, uAir, uFog, uTime, uMapAmt, uSky, uHot;
uniform vec4 uGrad, uStripe, uStripe2, uSun, uFlowDir;
uniform vec3 uSP[4]; uniform vec4 uS[4];
uniform sampler2D uMap;
varying vec3 vW; varying vec3 vN; varying float vT; varying vec2 vUv; varying vec3 vI;
void main(){
  vec3 N = normalize(vN); if(!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vW);
  float T = uBase + dot(vW, uGrad.xyz)*uGrad.w;
#ifdef HUMAN
  float fr = vT;
  if(fr > 15.){ if(vI.b < .5) discard; fr = .58; }
  else if(fr > 5.) fr = mix(.9, .6, step(.5, vI.b));
  T += vI.r * fr * (1. + (fbm3(vW*7.) - .5)*.35*(1. - step(.97, fr)));
#else
  T += vT + vI.r;
#endif
  if(uAmp != 0.) T += (fbm3(vW*uScale + uFlowDir.xyz*uTime*uFlow) - .5)*uAmp*(1. + vI.g);
  if(uStripe.w != 0.) T += sin(dot(vW, uStripe.xyz))*uStripe.w;
  if(uStripe2.w != 0.) T += smoothstep(.82, .9, fract(dot(vW, uStripe2.xyz)))*uStripe2.w;
  if(uMapAmt != 0.) T += texture2D(uMap, vUv).a * uMapAmt;
  float spec = 0.;
  vec3 R = reflect(-V, N);
  for(int i=0;i<4;i++){
    if(uS[i].x == 0.) continue;
    vec3 d = uSP[i] - vW; float r = max(length(d), .05); vec3 L = d/r;
    float fall = 1./(1. + r*r/(uS[i].y*uS[i].y));
    T += uS[i].x*uS[i].z*max(0., dot(N, L)*.8+.2)*fall;
    spec += uS[i].x*uS[i].w*pow(max(0., dot(R, L)), 18.)*fall;
  }
  T += uSun.w*max(0., dot(N, uSun.xyz));
  T -= uSky*max(0., N.y);
  float fres = pow(1. - abs(dot(N, V)), 3.);
  float eps = uEps*(1. - .5*fres);
  T = eps*T + (1. - eps)*uAir + spec*(1. - eps);
  T *= uHot;
  float dist = length(cameraPosition - vW);
  T = mix(T, uAir, 1. - exp(-dist*uFog));
  gl_FragColor = vec4(T, 0., 0., 1.);
}`;

// A "set" is one place in the plant: its own scene, camera and shared uniforms (time, air, heat sources).
function makeSet(name) {
  const U = { uTime: { value: 0 }, uAir: { value: AIR }, uFog: { value: 0.004 }, uSky: { value: 0.004 }, uHot: { value: 1 },
    uSun: { value: new THREE.Vector4(0.3, 0.8, 0.5, 0) },
    uSP: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, uS: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) } };
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(45, W / H, 0.05, 4000);
  return { name, U, scene, cam, mats: [] };
}
const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); blank.needsUpdate = true;
function mat(set, o = {}) {
  const m = new THREE.ShaderMaterial({
    vertexShader: TM_VS, fragmentShader: TM_FS, side: o.side ?? THREE.DoubleSide,
    defines: o.human ? { HUMAN: 1 } : {},
    uniforms: { ...set.U,
      uBase: { value: o.base ?? AIR }, uAmp: { value: o.amp ?? 0.004 }, uScale: { value: o.scale ?? 1 }, uFlow: { value: o.flow ?? 0 },
      uFlowDir: { value: new THREE.Vector4(...(o.flowDir ?? [0, -1, 0]), 0) }, uEps: { value: o.eps ?? 0.92 },
      uGrad: { value: new THREE.Vector4(...(o.grad ?? [0, 1, 0, 0])) }, uStripe: { value: new THREE.Vector4(...(o.stripe ?? [0, 0, 0, 0])) },
      uStripe2: { value: new THREE.Vector4(...(o.stripe2 ?? [0, 0, 0, 0])) },
      uMap: { value: o.map ?? blank }, uMapAmt: { value: o.mapAmt ?? 0 } },
  });
  set.mats.push(m);
  return m;
}
function heat(set, i, p, temp, radius, absorb = 0.05, spec = 0.6) { set.U.uSP.value[i].set(...p); set.U.uS.value[i].set(temp, radius, absorb, spec); }
function add(set, geo, m, x = 0, y = 0, z = 0, ry = 0, parent = null) {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; (parent || set.scene).add(o); return o;
}
// per-vertex temperature attribute
function withT(geo, fn) {
  const p = geo.attributes.position, n = geo.attributes.normal, a = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) a[i] = fn(p.getX(i), p.getY(i), p.getZ(i), n ? n.getX(i) : 0, n ? n.getY(i) : 0, n ? n.getZ(i) : 0);
  geo.setAttribute('aT', new THREE.BufferAttribute(a, 1));
  return geo;
}
const constT = (geo, v) => withT(geo, () => v);
function tf(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return geo.applyMatrix4(m);
}
const merge = (gs) => mergeGeometries(gs.map(g => g.index ? g.toNonIndexed() : g), false);
// ---------------------------------------------------------------- shapes
// ---------------------------------------------------------------- shapes
function ibeam(h, w = 0.4, d = 0.4, tw = 0.05) {           // an H column, height h, standing on y=0
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -d / 2); s.lineTo(w / 2, -d / 2); s.lineTo(w / 2, -d / 2 + tw); s.lineTo(tw / 2, -d / 2 + tw); s.lineTo(tw / 2, d / 2 - tw);
  s.lineTo(w / 2, d / 2 - tw); s.lineTo(w / 2, d / 2); s.lineTo(-w / 2, d / 2); s.lineTo(-w / 2, d / 2 - tw); s.lineTo(-tw / 2, d / 2 - tw);
  s.lineTo(-tw / 2, -d / 2 + tw); s.lineTo(-w / 2, -d / 2 + tw); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  return tf(g, { rx: -Math.PI / 2 });
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0, r1, h, n = 16, open = false) => new THREE.CylinderGeometry(r0, r1, h, n, 1, open);
function lathe(pts, n = 40) { return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), n); }
// a lattice mast / truss from thin bars between points
function bars(list, r = 0.06) {
  const gs = [];
  for (const [a, b] of list) {
    const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), d = Bv.clone().sub(A), L = d.length();
    const g = new THREE.CylinderGeometry(r, r, L, 5, 1, true);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, L / 2, 0));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(A, q, new THREE.Vector3(1, 1, 1)));
    gs.push(g);
  }
  return merge(gs);
}
function mast(h, w, levels) {                                // a square lattice tower (pylons, gantries)
  const L = [];
  for (let k = 0; k < levels; k++) {
    const y0 = h * k / levels, y1 = h * (k + 1) / levels, w0 = lerp(w, w * 0.45, k / levels), w1 = lerp(w, w * 0.45, (k + 1) / levels);
    const c0 = [[-w0, -w0], [w0, -w0], [w0, w0], [-w0, w0]], c1 = [[-w1, -w1], [w1, -w1], [w1, w1], [-w1, w1]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      L.push([[c0[i][0], y0, c0[i][1]], [c1[i][0], y1, c1[i][1]]]);
      L.push([[c0[i][0], y0, c0[i][1]], [c1[j][0], y1, c1[j][1]]]);
      L.push([[c1[i][0], y1, c1[i][1]], [c1[j][0], y1, c1[j][1]]]);
    }
  }
  return bars(L, 0.05 * w);
}

// ---------------------------------------------------------------- people: full-scale workers, 12-phase walk, cheer, stand
function floor(S, o = {}) { const f = add(S, new THREE.PlaneGeometry(o.size ?? 400, o.size ?? 400), mat(S, { base: 0.028, amp: 0.008, scale: 0.6, eps: 0.9, ...o })); f.rotation.x = -Math.PI / 2; return f; }
function textMap(draw, w = 1024, h = 256) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h); const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t; }
const TAU = Math.PI * 2;
const CR = (pts) => new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));

// ---------------------------------------------------------------- FILM: baked heat atlases (tools/heat_key.py, _c12/productive_bake.py)
const FBASE = new URL('../assets/productive/', import.meta.url);
const FMETA = await (await fetch(new URL('clips.json', FBASE))).json();
const FTEX = new Map();                                            // clip -> { tex, last }
async function filmEnsure(names, frame, ahead = []) {
  for (const n of [...names, ...ahead.filter(a => !names.includes(a) && FTEX.size + 1 <= 20)]) {
    const e = FTEX.get(n); if (e) { e.last = frame; continue; }
    const m = FMETA[n]; if (!m) throw new Error('no baked clip ' + n);
    const bmp = await createImageBitmap(await (await fetch(new URL(n + '.jpg', FBASE))).blob(), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const tex = new THREE.Texture(bmp);
    tex.format = THREE.RedFormat; tex.internalFormat = 'R8'; tex.type = THREE.UnsignedByteType;
    tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.flipY = false; tex.onUpdate = () => { bmp.close?.(); };           // after the upload the bitmap (RGBA, 80 MB) is not needed
    tex.needsUpdate = true;
    FTEX.set(n, { tex, last: frame, w: bmp.width, h: bmp.height });
  }
  while (FTEX.size > 20) {
    let k = null, lo = 1e18; for (const [n, e] of FTEX) if (!names.includes(n) && e.last < lo) { lo = e.last; k = n; }
    if (k == null) break; FTEX.get(k).tex.dispose(); FTEX.delete(k);
  }
}
// heat persistence (c13): the cooling prints of SHORTER HOURS. are the film's own hands. Two real grips (a fist on a lever; two hands holding a
// part) are cut out of the baked heat atlases (the heat key's own person matte, thresholded to the hand), and stamped onto a cold plate with a
// decaying alpha: what a real thermal camera sees on a touched surface, the shape of the actual grip, cooling over about two seconds.
const DW = 540, DH = 960;
const DCV = document.createElement('canvas'); DCV.width = DW; DCV.height = DH; const dg = DCV.getContext('2d');
const dTex = new THREE.CanvasTexture(DCV); dTex.minFilter = dTex.magFilter = THREE.LinearFilter;
const HANDS = {};
async function cutHand(name, clip, frame, rx, ry, rw, rh, lo = 0.5, hi = 0.68) {
  const m = FMETA[clip], bmp = await createImageBitmap(await (await fetch(new URL(clip + '.jpg', FBASE))).blob(), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const cv = document.createElement('canvas'); cv.width = rw; cv.height = rh; const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, (frame % m.cols) * m.cw + rx, Math.floor(frame / m.cols) * m.ch + ry, rw, rh, 0, 0, rw, rh); bmp.close?.();
  const im = g.getImageData(0, 0, rw, rh), d = im.data;
  for (let i = 0; i < d.length; i += 4) {                         // the matte: hand-warm pixels only, soft edge, a fade to the rect's border
    const v = d[i] / 255, x = ((i / 4) % rw) / rw - 0.5, y = Math.floor(i / 4 / rw) / rh - 0.5;
    const k = Math.min(1, Math.max(0, (v - lo) / (hi - lo))), e = Math.min(1, Math.max(0, (0.5 - Math.max(Math.abs(x), Math.abs(y))) / 0.1));
    const a = k * k * (3 - 2 * k) * e; d[i] = d[i + 1] = d[i + 2] = Math.round(255 * Math.min(1, v * 1.15) * a); d[i + 3] = Math.round(255 * a);
  }
  g.putImageData(im, 0, 0); HANDS[name] = { cv, w: rw, h: rh };
}
// c20: the cut-out grips read as yellow shards scattered over nine cells (director, c20). Now ONE gloved hand's print on one held plate:
// what a thermal camera sees where a work glove was pressed flat and lifted: palm and fingers warm, the fingertips and the edge
// cooler, the print sharp when the hand leaves and softening as the heat spreads into the steel and fades (about 2 s).
function glove(g, cx, cy, s, rot, age) {
  const a = clamp(age * 12) * Math.exp(-age / 1.15), spread = 1 + 0.12 * age;
  if (a < 0.01) return;
  const caps = (x0, y0, len, w, ang) => { g.save(); g.translate(x0, y0); g.rotate(ang); g.beginPath(); g.roundRect(-w / 2, -len, w, len + w * 0.3, w / 2); g.fill(); g.restore(); };
  const shape = (k) => {
    g.beginPath(); g.roundRect(-0.31 * s * k, -0.22 * s * k, 0.62 * s * k, 0.66 * s * k, 0.2 * s * k); g.fill();          // the palm
    [[-0.225, 0.47, -0.10], [-0.075, 0.55, -0.03], [0.075, 0.53, 0.03], [0.22, 0.42, 0.10]].forEach(([x, L, an]) => caps(x * s * k, -0.18 * s * k, L * s * k, 0.155 * s * k, an));
    caps(-0.27 * s * k, 0.2 * s * k, 0.4 * s * k, 0.17 * s * k, -1.05);                                                    // the thumb
  };
  g.save(); g.translate(cx, cy); g.rotate(rot); g.scale(spread, spread); g.fillStyle = '#fff';
  g.filter = `blur(${(3 + 9 * age).toFixed(1)}px)`; g.globalAlpha = 0.55 * a; shape(1.04);
  g.filter = `blur(${(1.5 + 7 * age).toFixed(1)}px)`; g.globalAlpha = 0.5 * a; g.translate(0, 0.06 * s); shape(0.72);        // the palm's centre, pressed hardest
  g.restore(); g.filter = 'none';
}
const FILM = (() => {
  const scene = new THREE.Scene();
  const m = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    uniforms: { tA: { value: null }, tD: { value: dTex }, uG: { value: new THREE.Vector4() }, uAS: { value: new THREE.Vector2() }, uF: { value: new THREE.Vector4() },
      uW: { value: new THREE.Vector4() }, uP: { value: new THREE.Vector4() }, uCool: { value: 0 }, uDecal: { value: 0 } },
    fragmentShader: `uniform sampler2D tA, tD; uniform vec4 uG, uF, uW, uP; uniform vec2 uAS; uniform float uCool, uDecal; varying vec2 vUv;
    float tap(float f, vec2 uv){ float col = mod(f, uG.x), row = floor(f/uG.x);
      vec2 px = vec2(col*uG.y + uv.x*uG.y, row*uG.z + uv.y*uG.z);
      px = clamp(px, vec2(col*uG.y + .5, row*uG.z + .5), vec2((col + 1.)*uG.y - .5, (row + 1.)*uG.z - .5));
      return texture2D(tA, px/uAS).r; }
    void main(){
      float x = mix(vUv.x, 1. - vUv.x, uF.w);
      vec2 uv = vec2(uW.x + (x - .5)*uW.z, uW.y + ((1. - vUv.y) - .5)*uW.w);
      float h = mix(tap(uF.x, uv), tap(uF.y, uv), uF.z);
      h = pow(clamp(h, 0., 1.), uP.z)*uP.w*(1. - uCool);
      h = max(h, texture2D(tD, vUv).r*uDecal);
      gl_FragColor = vec4(uP.x + h*(uP.y - uP.x), 0., 0., 1.);
    }` });
  const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); q.frustumCulled = false; scene.add(q);
  const KIND = { furn: [0.02, 1.2], plant: [0.02, 0.2], body: [0.02, 0.045] };
  // c: { clip, off (s into the clip), rate, mode loop|hold|pp, cx, cy, zoom, dx, push, flip, kind|lo,hi, gam, gain, cool, prints }
  return { scene, m, KIND,
    draw(c, st, age, asp, beat, kick) {
      const meta = FMETA[c.clip], e = FTEX.get(c.clip); const rate = c.rate ?? 1;
      let f = ((c.off ?? 0) + age * rate) * meta.fps, n = meta.n, f0, f1;
      const mode = c.mode ?? 'loop';
      if (mode === 'loop') { f = ((f % n) + n) % n; f0 = Math.floor(f); f1 = (f0 + 1) % n; }
      else if (mode === 'pp') { const p = 2 * (n - 1); f = ((f % p) + p) % p; if (f > n - 1) f = p - f; f0 = Math.floor(f); f1 = Math.min(n - 1, f0 + 1); }
      else { f = clamp(f, 0, n - 1); f0 = Math.floor(f); f1 = Math.min(n - 1, f0 + 1); }
      const zoom = (c.zoom ?? 1) + (c.push ?? 0) * age;
      let vh = meta.ch / zoom, vw = vh * asp; if (vw > meta.cw) { vw = meta.cw; vh = vw / asp; }
      const cx = clamp(((c.cx ?? 0.5) + (c.dx ?? 0) * age) * meta.cw, vw / 2, meta.cw - vw / 2) / meta.cw, cy = clamp((c.cy ?? 0.5) * meta.ch, vh / 2, meta.ch - vh / 2) / meta.ch;
      const U = m.uniforms; U.tA.value = e.tex; U.uG.value.set(meta.cols, meta.cw, meta.ch, 0); U.uAS.value.set(e.w, e.h);
      U.uF.value.set(f0, f1, f - Math.floor(f), c.flip ? 1 : 0); U.uW.value.set(cx, cy, vw / meta.cw, vh / meta.ch);
      const [lo, hi] = c.lo != null ? [c.lo, c.hi] : KIND[c.kind ?? 'plant'];
      U.uP.value.set(lo, hi, c.gam ?? 1, (typeof c.gain === "function" ? c.gain(beat) : (c.gain ?? 1)) * (1 + 0.1 * kick));
      U.uCool.value = typeof c.cool === 'function' ? c.cool(beat) : (c.cool ?? 0);
      if (c.glove) {
        dg.globalCompositeOperation = 'source-over'; dg.fillStyle = '#000'; dg.fillRect(0, 0, DW, DH);            // heat on black: alpha would be ignored by the sampler
        dg.globalCompositeOperation = 'lighter';
        const [b0, u, v, sz, rot] = c.glove; glove(dg, u * DW, v * DH, sz * DW, rot, Math.max(0, beat - b0));
        dg.globalCompositeOperation = 'source-over'; dTex.needsUpdate = true; U.uDecal.value = beat >= b0 ? 0.74 : 0;
      } else U.uDecal.value = 0;
      return [lo, hi];
    } };
})();

// ---------------------------------------------------------------- SET: the plant from the air; the emblem on the water tower glows hottest (WORKERS RULE.), then cools
const TOWER = (() => {
  const S = makeSet('tower'); S.U.uFog.value = 0.0011; S.U.uAir.value = 0.01; S.clear = -0.03; S.U.uSky.value = 0.006;
  floor(S, { base: 0.05, amp: 0.012, scale: 0.02, size: 6000, stripe2: [0.02, 0, 0.02, 0.004] });
  const r = rng(52);
  const shedG = merge([constT(tf(box(1, 1, 1), { y: 0.5 }), 0), ...[0, 1, 2, 3, 4].map(i => constT(tf(new THREE.CylinderGeometry(0.01, 0.1, 0.1, 3, 1), { x: -0.4 + i * 0.2, y: 1.02, rz: Math.PI / 2, sz: 10 }), 0.02))]);
  const NS = 34, sheds = new THREE.InstancedMesh(shedG, mat(S, { base: 0.03, amp: 0.02, scale: 0.05, stripe2: [0.3, 0, 0.3, 0.02] }), NS);
  { const m4 = new THREE.Matrix4(); for (let i = 0; i < NS; i++) { const x = -260 + (i % 7) * 85 + r() * 10, z = -220 + Math.floor(i / 7) * 95 + r() * 10;
      m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(60 + r() * 20, 18 + r() * 14, 30 + r() * 30)); sheds.setMatrixAt(i, m4); sheds.setColorAt(i, new THREE.Color(r() * 0.05, r(), 0)); } }
  S.scene.add(sheds);
  const bf = new THREE.Group(); bf.position.set(-150, 0, -40); S.scene.add(bf);
  add(S, lathe([[9, 0], [11, 20], [8, 50], [5, 62], [3, 70], [0.001, 72]], 24), mat(S, { base: 0.08, grad: [0, -1, 0, 0.0012], amp: 0.03, scale: 0.3 }), 0, 0, 0, 0, bf);
  for (let i = 0; i < 4; i++) add(S, cyl(6, 6, 48, 18), mat(S, { base: 0.06, amp: 0.02 }), 22 + i * 13, 24, -8, 0, bf);
  add(S, mast(80, 4, 8), mat(S, { base: 0.02 }), -14, 0, 0, 0, bf);
  for (const [x, z, h] of [[40, -150, 120], [70, -140, 110], [180, 60, 130]]) {
    add(S, cyl(4, 6, h, 18), mat(S, { base: 0.02, grad: [0, 1, 0, 0.0006], amp: 0.004 }), x, h / 2, z);
    add(S, cyl(4.05, 4.05, 5, 18, true), mat(S, { base: 0.35, amp: 0.05 }), x, h - 2, z);
  }
  const towerG = lathe([[40, 0], [34, 30], [27, 70], [25.5, 90], [26.5, 110], [28, 120], [27.4, 120], [25, 110], [24, 90], [25.5, 70], [32.5, 30], [38.6, 0]], 40);
  for (const [x, z] of [[260, -300], [340, -250]]) add(S, towerG, mat(S, { base: 0.024, grad: [0, 1, 0, 0.0002], amp: 0.006, scale: 0.05 }), x, 0, z);
  for (let i = 0; i < 8; i++) add(S, box(600, 0.4, 0.8), mat(S, { base: 0.02 }), 0, 0.2, 150 + i * 5);
  const cars = new THREE.InstancedMesh(box(3, 3.4, 15), mat(S, { base: 0.02, amp: 0.01 }), 60);
  { const m4 = new THREE.Matrix4(); for (let i = 0; i < 60; i++) { m4.compose(new THREE.Vector3(-280 + (i % 30) * 17, 1.9, 150 + Math.floor(i / 30) * 15), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(1, 1, 1)); cars.setMatrixAt(i, m4); cars.setColorAt(i, new THREE.Color(r() < 0.3 ? 0.6 : 0, 0, 0)); } }
  S.scene.add(cars);
  // the water tower with the emblem
  const wt = new THREE.Group(); wt.position.set(40, 0, 110); S.scene.add(wt);
  const legL = []; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; legL.push([[Math.cos(a) * 10, 0, Math.sin(a) * 10], [Math.cos(a) * 7, 36, Math.sin(a) * 7]]);
    const b = (i + 1) / 6 * TAU; for (const y of [10, 22]) legL.push([[Math.cos(a) * lerp(10, 7, y / 36), y, Math.sin(a) * lerp(10, 7, y / 36)], [Math.cos(b) * lerp(10, 7, (y + 12) / 36), y + 12, Math.sin(b) * lerp(10, 7, (y + 12) / 36)]]); }
  add(S, bars(legL, 0.5), mat(S, { base: 0.018 }), 0, 0, 0, 0, wt);
  add(S, lathe([[0.001, 34], [7, 36], [11, 40], [11.5, 48], [9, 53], [0.001, 55]], 40), mat(S, { base: 0.14, amp: 0.02, grad: [0, 1, 0, -0.0004] }), 0, 0, 0, 0, wt);
  const gearMap = textMap((g, w, h) => { g.clearRect(0, 0, w, h); acpEmblem(g, w / 2, h / 2, h - 24, { color: '#ffffff' }); }, 832, 512);
  const gearM = mat(S, { base: 0.1, map: gearMap, mapAmt: 1.8, amp: 0.1, scale: 1.2 });
  add(S, new THREE.PlaneGeometry(19.5, 12), gearM, 0, 44.5, 12.2, 0, wt);
  S.update = (t, sh, age) => { S.U.uTime.value = t; S.U.uHot.value = sh.hot ? sh.hot(age) : 1; gearM.uniforms.uMapAmt.value = (sh.gear ? sh.gear(age) : 0.4) * 1.9; };
  S.cams = {
    ORBIT: (t, age) => { const a = 0.55 + age * 0.1; return { p: [Math.sin(a) * 430, 95 - age * 4, Math.cos(a) * 430], l: [0, 8, 20], fov: 46 }; },
    LOW: (t, age) => ({ p: [150 - age * 8, 40, 260], l: [40, 44, 110], fov: 46 }),
    // WORKERS RULE.: in on the tower, then square up to the emblem (head-on, upright: the lockup comes out of it)
    TOWER: (t, age) => { const u = ease.outCubic(clamp(age / 0.9)), s = ease.inOutCubic(clamp((age - 0.8) / 0.9));
      return { p: [lerp(lerp(95, 52, u) + age * 1.2, 40, s), lerp(lerp(58, 47, u), 44.5, s), lerp(lerp(215, 172, u) - age * 1.6, 195.8, s)], l: [lerp(40, 40, s), 44.5, 121.8], fov: lerp(lerp(44, 34, u), 34, s) }; },
  };
  return S;
})();

// ---------------------------------------------------------------- the monitoring wall: layouts, cells, the timeline (beats)
const SETS = { tower: TOWER };
const BEZ_T = -0.05;                          // what the gaps between panels read (cold)
function grid(cols, rows, gap) {
  const w = (W - gap * (cols + 1)) / cols, h = (H - gap * (rows + 1)) / rows, out = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push({ x: Math.round(gap + i * (w + gap)), y: Math.round(gap + j * (h + gap)), w: Math.round(w), h: Math.round(h) });
  return out;
}
const LAYOUT = { '1': [{ x: 0, y: 0, w: W, h: H }], '2x2': grid(2, 2, 12), '3x3': grid(3, 3, 10), '4x4': grid(4, 4, 8), '1x4': grid(1, 4, 10), '1x2': grid(1, 2, 10) };
const X = (a, o) => ({ ...a, ...o });
// what each clip is (the temperature range its panel reads) and where the interesting part sits across the 4:3 frame (cx)
const CLIP = {
  ladle2: ['furn', 0.5], rods: ['furn', 0.3], group: ['furn', 0.4], pour: ['furn', 0.6], twomen: ['furn', 0.5], molds: ['furn', 0.5], bar: ['furn', 0.5],
  ladleHot: ['furn', 0.5], groupP: ['furn', 0.5], rodsP: ['furn', 0.5], twomenP: ['furn', 0.5], faceP: ['body', 0.5], lunch: ['body', 0.5], furnaceMen: ['furn', 0.5], hammer: ['furn', 0.5], press2: ['plant', 0.5],
  wire: ['plant', 0.5], lathe: ['body', 0.5], tester: ['body', 0.5], ingots: ['furn', 0.5], slab: ['furn', 0.5], door: ['furn', 0.5], tap: ['furn', 0.5],
  loco: ['plant', 0.5], nightloco: ['plant', 0.5], steam1400: ['plant', 0.5], streamline: ['plant', 0.5], steamApproach: ['plant', 0.5],
  tubesA: ['body', 0.5], tubesB: ['body', 0.5], tubesC: ['body', 0.5], damCrowd: ['body', 0.5], damForms: ['body', 0.5],
  // c20 re-bakes (videos/gpu/pf_heat_bake.py on the farm): faces keyed by anatomy, people matted per clip (Mask R-CNN + guided filter)
  hGoggles: ['body', 0.5], hCap: ['body', 0.5], hLunch: ['body', 0.5], hRed: ['body', 0.5], coatR: ['body', 0.5], faceR: ['body', 0.5],
  groupR: ['furn', 0.5], shovelR: ['furn', 0.5], ladleR: ['furn', 0.5],
};
const HAS = (n) => !!FMETA[n];
const NEW = (n, old) => (HAS(n) ? n : old);                  // the c20 clip when it is baked, else the old one
const CXO = {};
const f = (clip, o = {}) => ({ set: 'film', clip, kind: CLIP[clip][0], cx: CXO[clip] ?? CLIP[clip][1], pal: 0, machine: CLIP[clip][0] !== 'body' ? 1 : 0, ...o });
const FRAMES = (arr) => arr.map(a => (typeof a === 'string' ? f(a) : f(a[0], a[1])));
// ---- the sets (c13: no control close-ups, no dials: the people and the plant; every shot is film through the heat key)
const WALL0 = FRAMES(['lunch', 'ladle2', 'lathe', 'rods', 'wire', 'hammer', 'furnaceMen', 'steam1400', 'molds']);
const HOOKPOOL = ['pour', 'hammer', 'group', 'tap', 'tubesC', 'wire', 'door', 'press2', 'furnaceMen', 'slab', 'twomen', 'bar', 'damForms', 'lathe', 'lunch', 'tubesB'];
// a cell that cuts: an array of variants, each with .t (absolute seconds); swaps[j] goes to cell order[j % n] with pool[j % m]
const SWAPS = (base, pool, times, order, t0 = 0) => {
  const cells = base.map(c => [{ ...c, t: t0 }]);
  times.forEach((tc, j) => { cells[order[j % order.length]].push({ ...f(pool[j % pool.length], { off: (j * 0.9) % 4, flip: j % 3 === 2 ? 1 : 0 }), t: tc }); });
  return cells;
};
const O9 = [4, 0, 8, 2, 6, 1, 7, 3, 5], O4 = [0, 3, 1, 2], O16 = [5, 10, 0, 15, 6, 9, 3, 12, 1, 14, 7, 8, 2, 13, 4, 11];
const PEOPLE16 = FRAMES([['lunch', { off: 0 }], 'hammer', ['lathe', { off: 1 }], ['tester', { off: 0 }], ['rods', { off: 0 }], ['group', { off: 0 }], ['furnaceMen', { off: 0 }], ['press2', { off: 0 }],
  ['damCrowd', { off: 0 }], ['damCrowd', { off: 4, flip: 1 }], ['tubesA', { off: 4 }], ['tubesB', { off: 0 }], ['door', { off: 0 }], ['twomen', { off: 0 }], ['slab', { off: 0 }], ['lunch', { off: 3, flip: 1 }]]);
const PEOPLEPOOL = ['group', 'press2', 'lunch', 'damCrowd', 'rods', 'furnaceMen', 'hammer', 'lathe'];
const FLOORS9 = FRAMES(['lunch', 'group', 'hammer', ['rods', { off: 2 }], 'tester', 'twomen', 'lathe', ['group', { off: 3, flip: 1 }], 'damCrowd']);        // c14: each step into ACCELERATE is hotter, more people
const FACES4 = FRAMES(['lunch', 'twomen', 'rods', 'group']);
const RUN9 = FRAMES(['slab', 'press2', 'rods', 'furnaceMen', 'group', 'tap', 'hammer', 'lathe', 'door']);
const RUNPOOL = ['tap', 'slab', 'ingots', 'wire', 'furnaceMen', 'press2', 'pour', 'molds', 'lathe', 'rods', 'door', 'group'];
const TRACE_ORDER = [4, 0, 8, 2, 6, 1, 7, 3, 5];                     // the panels go cold in this order after the clocks jump
// the plates the hands leave heat on: plant, not dials (a gear, a flywheel, castings, a press, a cupola ...), frozen at a quiet frame
const PLATES = [['wire', 0.3], ['ingots', 0.5], ['door', 0.05], ['press2', 0.8], ['tap', 3.0], ['molds', 3.4], ['slab', 2.0], ['bar', 0.6], ['steam1400', 1.5]];
const SLOTS = [[0.3, 0.2], [0.7, 0.27], [0.32, 0.5], [0.7, 0.58], [0.5, 0.8], [0.26, 0.78], [0.74, 0.86]];
const GRIPS = ['gripL', 'gripR', 'gripR2', 'gripL2', 'gripL'];
const prRand = (seed, n, t0) => { const r = rng(seed), sl = SLOTS.map(x => [r(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]), out = [];
  for (let i = 0; i < n; i++) out.push([t0 + i * 0.32 + r() * 0.14, sl[i][0] + (r() - 0.5) * 0.06, sl[i][1] + (r() - 0.5) * 0.04, 190 + r() * 60, (r() - 0.5) * 1.0, r() < 0.5 ? 1 : -1, GRIPS[(i + seed) % 5]]); return out; };
// c20: SHORTER HOURS. is one held plate (the press, at rest) where the crew's last glove leaves its heat; then the plant relights alone
const PRINT1 = [f('press2', { mode: 'hold', rate: 0, off: 0.8, gain: 1.0, hunt: 0, cool: (t) => 0.55 + 0.3 * ease.inOutCubic(clamp((t - (T.shorter + 0.6)) / 2.0)), glove: [T.shorter + 0.25, 0.52, 0.80, 0.52, -0.18] })];
const TRACES9 = PLATES.map(([clip, off], i) => { const k = TRACE_ORDER.indexOf(i);
  return f(clip, { mode: 'hold', rate: 0, off, gain: 1.0, hunt: 0, cool: (t) => 0.8 * ease.inOutCubic(clamp((t - (T.shorter + 0.9 + k * 0.26)) / 1.5)), prints: prRand(40 + i, 3 + (i % 2), T.shorter + 0.15 + k * 0.2) }); });
const ALONE9 = FRAMES(['ingots', 'wire', 'pour', 'bar', 'lathe', 'tap', 'molds', 'steam1400', 'door']).map((c, i) => ({ ...c, dim: (t) => 0.06 + 0.94 * clamp((t - (T.alone + TRACE_ORDER.indexOf(i) * 0.16)) / 0.12) }));
const HOT9 = FRAMES(['lunch', 'hammer', 'tester', 'rods', 'group', 'lathe', 'twomen', 'damCrowd', 'furnaceMen']).map(c => ({ ...c, iso: 1, isoT: 0.02 + (c.kind === 'furn' ? 0.9 * 1.18 : c.kind === 'plant' ? 0.9 * 0.18 : 0.9 * 0.025) }));
const C = TL.cuts;
// [t, layout, cells, {nuc}]: every section of the wall. A cell may be an array of variants (a cell that cuts on the pulse's firings); nuc = a NUC freeze (3 frames)
const WALL = [
  [0, '3x3', SWAPS(WALL0, HOOKPOOL, C.hook, O9), { nuc: 1 }],                                                           // SURGE: the wall is alive from frame 0
  [T.more1, '4x4', PEOPLE16, { nuc: 1 }],
  [T.unleash, '1', [f(NEW('ladleR', 'ladleHot'), { shake: 1.5, hero: 1, rate: 0.75, push: 0.03, zoom: 1.3, cy: 0.4, gain: 1.15 })], { nuc: 1 }],                      // BREATHE: one picture, slow
  [T.chips, '2x2', SWAPS(FRAMES(['tubesA', ['tubesA', { off: 6, flip: 1 }], 'tubesB', 'tubesC']), ['tubesC', 'tubesB', 'tubesA', 'tubesC'], C.chips, O4, T.chips), { nuc: 1 }],      // the litany speeds up word by word
  [T.steel, '2x2', SWAPS(FRAMES(['pour', 'molds', 'bar', 'tap']), ['door', 'tap', 'ingots', 'pour'], C.steel, O4, T.steel), {}],
  [T.power, '2x2', SWAPS(FRAMES(['ingots', 'wire', 'lathe', 'door']), ['slab', 'wire', 'press2', 'lathe'], C.power, O4, T.power), {}],
  [T.trains, '2x2', SWAPS(FRAMES(['steam1400', 'streamline', 'steamApproach', 'nightloco']), ['loco', 'streamline', 'steam1400'], C.trains, O4, T.trains), {}],
  [T.trains + 0.3, '1', [f('streamline', { off: 3.5, rate: 0.8, push: 0.04 })], {}],                                // MORE TRAINS ends on the hottest railroad frame: the streamliner's headlight

  [T.people, '1', [f(NEW('groupR', 'groupP'), { rate: 0.8, push: 0.06, off: 0.9 })], { nuc: 1 }],                                    // BREATHE: one warm picture of people
  [T.ifp, '1', [f('rods', { rate: 0.9, push: 0.05 })], { nuc: 1 }],                                                // THE ACCELERATION: 1 -> 2x2 -> 3x3 -> 4x4
  [T.l2, '2x2', SWAPS(FRAMES(['group', 'lunch', 'hammer', ['rods', { off: 3, flip: 1 }]]), PEOPLEPOOL, C.ifp2, O4, T.l2), { nuc: 1 }],
  [T.l3, '3x3', SWAPS(FLOORS9, PEOPLEPOOL, C.ifp3, O9, T.l3), { nuc: 1 }],
  [T.accel, '4x4', SWAPS(PEOPLE16, PEOPLEPOOL, C.ifp4, O16, T.accel), { nuc: 1 }],
  [T.only, '1', [HAS('shovelR') ? f('shovelR', { off: 0.4, rate: 0.75, push: 0.05, gain: 1.05 }) : f('furnaceMen', { off: 4.0, rate: 0.7, push: 0.07, cx: 0.3, gain: 1.1 })], { nuc: 1 }],                   // the working class at scale
  [T.only + 1.3, '1', [f('damCrowd', { off: 3.4, rate: 0.7, zoom: 1.5, push: 0.06, cx: 0.55 })], {}],
  [T.tandem, '2x2', SWAPS(FRAMES(['lathe', 'tubesA', 'tester', ['lathe', { off: 5, flip: 1, cx: 0.3 }]]), ['tester', 'lathe', 'tubesB', 'tester'], C.tandem, O4, T.tandem), { nuc: 1 }],      // electronics, tight cuts on the pulse
  [T.usher, '1', [f(NEW('faceR', 'faceP'), { off: 0.8, rate: 0.5, push: 0.07 })], { nuc: 1 }],                                   // one face, slow and warm: the breath before the stop
  [T.claim, '1', [f('ladle2', { off: 2.0, rate: 0.8, shake: 1.5, hero: 1, gain: 1.3, hunt: 0 })], { nuc: 0 }],     // c20: hunt 0: the pour comes in settled (no AGC re-settle on the cut)               // the shutter opens on the hottest frame, moving: no second freeze or flat frame after the 5-frame stop
  [T.run, '3x3', SWAPS(RUN9, RUNPOOL, C.run, O9, T.run), { nuc: 1 }],
  [T.more_ev, '1x4', FRAMES(['pour', ['ladle2', { off: 3 }], 'tap', 'molds']), {}],
  [T.more_ev + 0.6, '4x4', PEOPLE16.map((c, i) => ({ ...c, off: (c.off ?? 0) + 2 })), { nuc: 1 }],
  [T.shorter, '1', PRINT1, { nuc: 1 }],                                                                          // the clocks jump to 14:00; the hands leave their heat on the plant
  [T.alone, '3x3', ALONE9, { nuc: 1 }],                                                                             // and the plant relights alone
  ...HUMANITY(),
  [T.m1, '1', [f(NEW('coatR', 'twomenP'), { zoom: 1, shake: 1.2, off: 0.9, rate: 0.6 })], { nuc: 1 }],
  [T.m2, '2x2', FACES4, { nuc: 1 }],
  [T.m3, '4x4', PEOPLE16.map((c, i) => ({ ...c, off: (c.off ?? 0) + 1 })), { nuc: 1 }],
  [T.workers, '1', [f('rods', { hero: 1, shake: 1.2, rate: 0.8, push: 0.05, gain: 1.1, off: 2.2, flip: 1, cx: 0.45,       // the ending is film: the hottest pour, full frame; the emblem comes out of the plant's own heat
    dim: (t) => 1 - 0.8 * ease.inOutCubic(clamp((t - T.cool) / 1.7)) })], { nuc: 1 }],
];
// c20 HUMANITY RUNS HOT.: real faces, large, their heat shaded by anatomy (the inner eye corners and the forehead hottest, the nose and
// the hair cooler, goggles black), climbing to white on the flash. Take 'A' (default): one face full-bleed, then two; take 'B': four.
function HUMANITY() {
  if (!HAS('hGoggles')) return [[T.humanity, '3x3', HOT9, { nuc: 1 }]];
  const rise = (t0) => (t) => 0.9 + 0.22 * ease.inOutCubic(clamp((t - t0) / 1.2));
  const face = (n, o = {}) => f(n, { rate: 0.6, push: 0.05, hunt: 0, ...o });
  if (TAKE.hum === 'B') {
    const four = ['hGoggles', 'hCap', 'hLunch', HAS('hRed') ? 'hRed' : 'hGoggles'].map((n, i) => face(n, { off: 0.2 * i, gain: rise(T.humanity) }));
    return [[T.humanity, '2x2', four, { nuc: 1 }]];
  }
  const mid = T.humanity + 0.7;
  return [[T.humanity, '1', [face('hGoggles', { gain: rise(T.humanity), push: 0.08 })], { nuc: 1 }],
          [mid, '1x2', [face('hCap', { gain: rise(T.humanity), off: 0.3 }), face('hLunch', { gain: rise(T.humanity), off: 0.2 })], { nuc: 1 }]];
}
const secAt = (beat) => { let r = WALL[0]; for (const s of WALL) if (beat >= s[0]) r = s; return r; };
const secIdx = (beat) => { let r = 0; WALL.forEach((s, i) => { if (beat >= s[0]) r = i; }); return r; };

// ---------------------------------------------------------------- the script (research/scripts_final/productive.json): [t, lines, hold s, tier, opts]
// hook = COMMUNISTS WANT with MORE. at 1.55x on one baseline; chant = the crowd word; lit = a litany word (66 % of the width); full = a claim at the full
// safe width; read = a sentence set in several lines at one size (the sources' own words, split where the stress falls, never opening on a connective);
// accel = IF THE PEOPLE HAVE MORE, / THE PRODUCTIVE FORCES / ACCELERATE FASTER., the last line set bigger than the first two. opts.rev = the second
// each line arrives at (the card moves without a word being cut); the sentences are whole.
const CUES = [
  [0, ['COMMUNISTS WANT MORE.'], T.more1, 'hook'], [T.more1, ['MORE.'], T.unleash - T.more1, 'chant'],
  [T.unleash, ['UNLEASH THE PRODUCTIVE', 'FORCES OF TECHNOLOGY.'], T.chips - T.unleash, 'read', { y: 1010, rev: [0, 0.75] }],
  [T.chips, ['MORE CHIPS.'], T.steel - T.chips, 'lit'], [T.steel, ['MORE STEEL.'], T.power - T.steel, 'lit'], [T.power, ['MORE POWER.'], T.trains - T.power, 'lit'],
  [T.trains, ['MORE TRAINS.'], T.litany_end - T.trains, 'lit'],
  [T.people, ['COMMUNISTS WANT', 'THE PEOPLE TO HAVE', 'MORE THINGS.'], T.ifp - T.people, 'read', { rev: [0, 0.75, 1.5] }],
  [T.ifp, ['IF THE PEOPLE HAVE MORE …', 'THE PRODUCTIVE FORCES', 'ACCELERATE FASTER.'], T.accel_end - T.ifp, 'accel', { rev: [0, T.l2 - T.ifp, T.accel - T.ifp] }],
  [T.only, ['ONLY THE ANTI-MONOPOLY', 'MOVEMENT OF THE', 'WORKING CLASS CAN,'], T.tandem - T.only, 'read', { rev: [0, 0.75, 1.5] }],
  [T.tandem, ['IN TANDEM WITH THE', 'ACCELERATION OF', 'AI TECHNOLOGY,'], T.usher - T.tandem, 'read', { rev: [0, 0.55, 1.1] }],
  [T.usher, ['USHER IN A NEW ERA', 'OF HUMAN', 'PROSPERITY.'], T.nuc_open - T.usher, 'read', { rev: [0, 0.8, 1.6] }],
  [T.claim, ['AI WILL BRING', 'COMMUNISM.'], T.run - T.claim, 'full', { rev: [0, 0.4], snap: 1 }],        // c20: the first line is there, whole, on the cut
  [T.more_ev, ['MORE EVERYTHING.'], T.shorter - T.more_ev, 'full'],
  [T.shorter, ['SHORTER HOURS AND', 'REINDUSTRIALIZATION', 'DEMAND WORKER', 'CONTROL AND AUTHORITY.'], T.humanity - T.shorter, 'read', { rev: [0, 0.6, 1.2, 1.8] }],
  [T.humanity, ['HUMANITY RUNS HOT.'], T.m1 - T.humanity, 'full'],
  [T.m1, ['MORE.'], T.m2 - T.m1, 'chant'], [T.m2, ['MORE.'], T.m3 - T.m2, 'chant'], [T.m3, ['MORE.'], T.workers - T.m3, 'chant'],
  [T.workers, ['WORKERS RULE.'], T.cool - T.workers + 0.3, 'full', { y: 1560, outline: 1 }],
];
const FLASHES = [[T.unleash, 0.55], [T.workers, 0.7]];     // c20: no flash on the pour: the cream mix over ironbow was the washed lavender first frame
const HOTFLASH = [[T.humanity, 0.9]];            // v6: HUMANITY RUNS HOT. pushes the top of the palette to white-hot and keeps the blacks (the white-mix flash read as a lavender wash)
const cueAt = (t) => { let r = null; for (const c of CUES) if (t >= c[0] && t < c[0] + c[2]) r = c; return r; };
const CREDIT = [[T.unleash, T.chips], [T.people, STOP]];     // Haz's sentences carry his title, gone before MORE CHIPS. (client, 1 Oct: title only, party named)
// ---------------------------------------------------------------- sensor pass: palettes, AGC, halos, isotherm, hot type (one pass per panel)
function lutTex() {
  const pals = [
    [[0, '#07001a'], [0.12, '#1c0350'], [0.28, '#5a078c'], [0.42, '#a01582'], [0.56, '#dc3c3a'], [0.7, '#f4780e'], [0.83, '#fdbd1c'], [0.93, '#fff07a'], [1, '#fffff4']],   // ironbow
    [[0, '#030303'], [0.5, '#7a7a7a'], [0.85, '#e4e4e0'], [1, '#ffffff']],                                                                               // white-hot
    [[0, '#000010'], [0.14, '#1a0c8c'], [0.28, '#0060ff'], [0.42, '#00d0c8'], [0.56, '#30e030'], [0.7, '#f0f000'], [0.84, '#ff6a00'], [0.94, '#ff1a1a'], [1, '#ffffff']], // rainbow
    [[0, '#02061c'], [0.25, '#0b2c78'], [0.5, '#1c7cc8'], [0.7, '#7cc8e8'], [0.82, '#e8c048'], [0.92, '#ffe070'], [1, '#fffff0']],                          // arctic
    [[0, '#000000'], [0.2, '#1c0002'], [0.42, '#5c0008'], [0.62, '#b8081c'], [0.8, '#ff2a2a'], [0.92, '#ff9a8a'], [1, '#fff0ea']],                          // red-black
  ];
  const w = 256, d = new Uint8Array(w * 8 * 4);
  const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  pals.forEach((st, row) => {
    for (let i = 0; i < w; i++) {
      const x = i / (w - 1); let k = 0; while (k < st.length - 2 && x > st[k + 1][0]) k++;
      const [x0, c0] = st[k], [x1, c1] = st[k + 1], f = clamp((x - x0) / (x1 - x0)), a = hex(c0), b = hex(c1);
      for (let c = 0; c < 3; c++) d[(row * w + i) * 4 + c] = Math.round(lerp(a[c], b[c], f));
      d[(row * w + i) * 4 + 3] = 255;
    }
  });
  const t = new THREE.DataTexture(d, w, 8); t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
}
const textCv = document.createElement('canvas'); textCv.width = W; textCv.height = H;
const tctx = textCv.getContext('2d');
const textTex = new THREE.CanvasTexture(textCv); textTex.minFilter = textTex.magFilter = THREE.LinearFilter;
const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false; postScene.add(quad);
const BLUR = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
  uniforms: { tT: { value: rtT.texture }, tX: { value: textTex }, textT: { value: 1 }, px: { value: new THREE.Vector2(1 / TW, 1 / TH) } },
  fragmentShader: `uniform sampler2D tT, tX; uniform float textT; uniform vec2 px; varying vec2 vUv;
  void main(){ float s = 0., m = 0.;
    for(int y=0;y<4;y++) for(int x=0;x<4;x++){ vec2 uv = vUv + (vec2(float(x), float(y)) - 1.5)*px*1.35;
      vec4 xx = texture2D(tX, uv); float mm = xx.r*xx.a; s += mix(texture2D(tT, uv).r, textT, mm); m += mm; }
    gl_FragColor = vec4(s/16., m/16., 0., 1.); }` });
const GAUSS = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
  uniforms: { tS: { value: null }, dir: { value: new THREE.Vector2() } },
  fragmentShader: `uniform sampler2D tS; uniform vec2 dir; varying vec2 vUv;
  void main(){ vec4 s = vec4(0.); float w = 0.; for(int i=-6;i<=6;i++){ float k = exp(-float(i*i)/18.); s += k*texture2D(tS, vUv + dir*float(i)); w += k; } gl_FragColor = s/w; }` });
function blurPass() {
  quad.material = BLUR; renderer.setRenderTarget(rtB); renderer.render(postScene, postCam);
  quad.material = GAUSS;
  GAUSS.uniforms.tS.value = rtB.texture; GAUSS.uniforms.dir.value.set(1.5 / rtB.width, 0); renderer.setRenderTarget(rtB2); renderer.render(postScene, postCam);
  GAUSS.uniforms.tS.value = rtB2.texture; GAUSS.uniforms.dir.value.set(0, 1.5 / rtB.height); renderer.setRenderTarget(rtB); renderer.render(postScene, postCam);
}
const MAXP = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
  uniforms: { tT: { value: rtT.texture }, px: { value: new THREE.Vector2(1 / TW, 1 / TH) } },
  fragmentShader: `uniform sampler2D tT; uniform vec2 px; varying vec2 vUv;
  void main(){ float mx = -9., s = 0.; for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++){ float T = texture2D(tT, vUv + vec2(float(x), float(y))*px*3.).r; mx = max(mx, T); s += T; }
    gl_FragColor = vec4(mx, s/25., 0., 1.); }` });
// The words: n = max(n, m*heat): a letter enters at mid-palette and reaches white in 3 frames (heat 0.5 -> 1.08), with a cold
// ring around it (the sensor's sharpening). No RGB split. flash never touches the letters; outline = isotherm on the ring.
const SENSOR = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
  uniforms: { tT: { value: rtT.texture }, tB: { value: rtB.texture }, tX: { value: textTex }, tL: { value: lutTex() },
    lo: { value: 0 }, hi: { value: 1 }, gam: { value: 1 }, eq: { value: 0.05 }, pal: { value: 0 },
    isoT: { value: 99 }, isoAmt: { value: 0 }, heat: { value: 1.08 }, outline: { value: 0 }, flash: { value: 0 }, flashHot: { value: 0 }, dim: { value: 1 }, uFlat: { value: 0 },
    sharp: { value: 0.55 }, glow: { value: 0.5 }, fpn: { value: 0.035 }, time: { value: 0 }, frame: { value: 0 }, blow: { value: 0 },
    rect: { value: new THREE.Vector4(0, 0, 1, 1) }, texel: { value: new THREE.Vector2(1 / TW, 1 / TH) } },
  fragmentShader: `uniform sampler2D tT, tB, tX, tL; uniform float lo, hi, gam, eq, pal, isoT, isoAmt, heat, outline, flash, flashHot, dim, uFlat, sharp, glow, fpn, time, frame, blow;
  uniform vec4 rect; uniform vec2 texel; varying vec2 vUv;
  float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
  vec3 P(float n){ return texture2D(tL, vec2(clamp(n, 0., 1.)*(255./256.)+.5/256., (pal+.5)/8.)).rgb; }
  vec3 PI(float n){ return texture2D(tL, vec2(clamp(n, 0., 1.)*(255./256.)+.5/256., .5/8.)).rgb; }   // the words always burn in ironbow
  void main(){
    vec2 uv = vUv;
    vec2 ctr = (rect.xy + rect.zw)*.5, hs = max((rect.zw - rect.xy)*.5, vec2(1e-3));
    vec2 cc = (uv - ctr)/hs*.5;                                   // panel-local, -0.5..0.5
    vec2 uvl = ctr + cc*(1. - .018*dot(cc, cc))*hs*2.;            // a touch of barrel inside each panel
    float T0 = texture2D(tT, uvl).r;
    float Tn = .25*(texture2D(tT, uvl+vec2(texel.x,0.)).r + texture2D(tT, uvl-vec2(texel.x,0.)).r + texture2D(tT, uvl+vec2(0.,texel.y)).r + texture2D(tT, uvl-vec2(0.,texel.y)).r);
    T0 = mix(T0, Tn, .35);
    vec2 bl = texture2D(tB, uv).rg;
    vec4 tx = texture2D(tX, uv); float m = tx.r*tx.a;
    float span = max(hi - lo, 1e-4);
    float T = T0 + sharp*(T0 - bl.r)*step(lo - span*.5, bl.r);   // no halo from the cold bezel gap into tight-AGC panels
    float ring = clamp(bl.g*1.6 - m, 0., 1.);
    T = mix(T, lo - span*.12, ring*.9);
    float n = log(1. + max(T - lo, -.2*eq)/eq)/log(1. + span/eq);
    n += glow*max(0., log(1. + max(bl.r - lo, 0.)/eq)/log(1. + span/eq) - .85);
    n = pow(clamp(n, 0., 1.25), gam);
    n += flashHot*smoothstep(.12, .7, n);
    vec2 fc = gl_FragCoord.xy;
    n += fpn*((h12(floor(fc/1.5)) - .5) + .7*(h12(vec2(floor(fc.x/1.5), 7.)) - .5) + .6*(h12(fc + frame*17.) - .5));
    vec3 c = P(n);
    float iso = step(isoT, T0)*isoAmt*(1. - step(.3, m));
    float hatch = step(.5, fract((fc.x + fc.y + time*90.)/16.));
    vec3 isoC = mix(vec3(1., .05, .16), vec3(1., .78, .8), hatch*.55);
    c = mix(c, isoC, iso*.92);
    c = mix(c, vec3(1., .9, .75), blow*smoothstep(.1, .9, n));
    c = mix(c, P(.33), uFlat);
    c *= (1. - .5*dot(cc, cc)*2.)*dim;
    c = mix(c, vec3(1., .96, .88), flash*(1. - clamp(ring*3., 0., 1.)));
    // the mind of light (green channel only: no cold ring), then the letters on top
    float fil = clamp(tx.g - tx.r, 0., 1.)*tx.a;
    c = mix(c, PI(.9 + .1*fil), fil);
    float nt = m*heat; vec3 ct = PI(min(nt, 1.));
    c = mix(c, ct, smoothstep(.08, .5, m));
    c = mix(c, isoC, ring*outline*.95);
    gl_FragColor = vec4(c, 1.);
  }` });
// ---------------------------------------------------------------- type: Anton, fitted to a width tier, written into the heat mask
function fitSize(str, target, cap) { setFont(tctx, 'Anton', 100); const w = tctx.measureText(str).width; return Math.min(cap, target * 100 / w); }
function drawCue(c, age) {
  const [, lines, , tier, o = {}] = c; const str = lines[0];
  const k = Math.exp(-age * 16);
  const rev = o.rev || lines.map(() => 0), al = (i) => (o.snap && rev[i] === 0 ? 1 : clamp((age - rev[i]) / 0.09));          // a line's heat comes up in 3 frames when its time arrives
  tctx.save(); tctx.fillStyle = '#fff'; tctx.textBaseline = 'alphabetic';
  if (tier === 'hook') {
    const a = 'COMMUNISTS WANT ', b = 'MORE.', R = 1.55;
    setFont(tctx, 'Anton', 100); const wa = tctx.measureText(a).width, wb = tctx.measureText(b).width;
    const s = (W - 120) * 100 / (wa + R * wb), x0 = W / 2 - (wa + R * wb) * s / 200, y = (o.y ?? 1010) + R * s * 0.36;
    setFont(tctx, 'Anton', s); tctx.fillText(a, x0, y);
    setFont(tctx, 'Anton', s * R); tctx.fillText(b, x0 + wa * s / 100, y);
  } else if (tier === 'read' || tier === 'accel') {
    let s = 9999; for (const l of lines) s = Math.min(s, fitSize(l, W - 180, 9999));
    s = Math.min(s, 190);
    const sz = lines.map((l, i) => (tier === 'accel' ? (i === 2 ? Math.min(fitSize(l, W - 110, 9999), 330) * (1 + 0.12 * Math.exp(-Math.max(0, age - rev[2]) * 14)) : s * (i === 0 ? 0.92 : 1.0)) : s));
    const lh = sz.map(z => z * 1.08), tot = lh.reduce((a, b) => a + b, 0);
    let y = (o.y ?? 960) - tot / 2;
    lines.forEach((l, i) => { setFont(tctx, 'Anton', sz[i]); const w = tctx.measureText(l).width; tctx.globalAlpha = al(i); tctx.fillText(l, W / 2 - w / 2, y + sz[i] * 0.86); y += lh[i]; });
  } else if (tier === 'full' && lines.length > 1) {
    let s = 9999; for (const l of lines) s = Math.min(s, fitSize(l, W - 200, 9999));
    s = Math.min(s, 330); const lh = s * 1.04, y0 = (o.y ?? 1000) - lh * (lines.length - 1) / 2;
    setFont(tctx, 'Anton', s);
    lines.forEach((l, i) => { const w = tctx.measureText(l).width; tctx.globalAlpha = al(i); tctx.fillText(l, W / 2 - w / 2, y0 + i * lh + s * 0.36); });
  } else {
    const target = tier === 'lit' ? W * 0.66 : W - 120, cap = tier === 'chant' ? 560 : 400;
    let s = fitSize(str, target, cap);
    if (tier !== 'full') s = Math.min(s * (1 + 0.14 * k), fitSize(str, W - 120, 9999));   // slam, never past the 60 px margins
    setFont(tctx, 'Anton', s); const w = tctx.measureText(str).width;
    tctx.fillText(str, W / 2 - w / 2, (o.y ?? 1000) + s * 0.36);
  }
  tctx.restore();
}

// ---------------------------------------------------------------- HUD: a monitoring wall's readouts, not a gun sight
const PALNAME = ['IRONBOW', 'WHITE HOT', 'RAINBOW', 'ARCTIC', 'RED HOT'];
const clockStr = (t, beat) => { const base = beat >= T.shorter ? Date.UTC(2000, 0, 1, 14, 0, 0) + (t - T.shorter) * 1000 : Date.UTC(2000, 0, 1, 6, 0, 0) + t * 1000;
  return new Date(base).toISOString().slice(11, 19); };
const bez = document.createElement('canvas'); bez.width = W; bez.height = H; const bctx = bez.getContext('2d');
function bezels(P, one) {
  if (one) return;
  bctx.globalCompositeOperation = 'source-over'; bctx.clearRect(0, 0, W, H); bctx.fillStyle = '#07050b'; bctx.fillRect(0, 0, W, H);
  bctx.globalCompositeOperation = 'destination-out';
  for (const p of P) { const r = Math.min(18, p.r.w * 0.045); bctx.beginPath(); bctx.roundRect(p.r.x, p.r.y, p.r.w, p.r.h, r); bctx.fill(); }
  bctx.drawImage(textCv, 0, 0);                                 // the words run hot across the bezels
  bctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(bez, 0, 0);
  ctx.save();
  for (const p of P) {
    const r = Math.min(18, p.r.w * 0.045);
    ctx.beginPath(); ctx.roundRect(p.r.x + 0.5, p.r.y + 0.5, p.r.w - 1, p.r.h - 1, r);
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.stroke();
    if (p.hit > 0.05) { ctx.lineWidth = 2 + 3 * p.hit; ctx.strokeStyle = `rgba(255,214,150,${0.75 * p.hit * p.dim})`; ctx.stroke(); }   // the panel's instrument
  }
  ctx.restore();
}
function hud(P, t, beat, one) {
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 5;
  for (const p of P) {
    const { r, c } = p, a = 0.9 * p.dim;
    if (a < 0.1) continue;
    const fs = one ? 60 : clamp(r.w * 0.06, 15, 40), pad = one ? 44 : Math.max(10, r.w * 0.04);
    line(ctx, fmtF(p.spot), r.x + pad, r.y + pad + fs * 0.9, { family: 'Plex Mono', size: fs, align: 'left', color: '#fff', alpha: a, maxW: r.w });
    if (r.w >= 300) line(ctx, clockStr(p.st, beat), r.x + pad, r.y + pad + fs * 1.75, { family: 'Plex Mono', size: fs * 0.62, align: 'left', color: '#fff', alpha: a * 0.8, maxW: r.w });
    if (c.machine) {                                            // a fixed spot marker: the panel's measuring point, never moving
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2, L = Math.max(8, r.w * 0.035);
      ctx.globalAlpha = a * 0.8; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(cx - L, cy); ctx.lineTo(cx - L * 0.35, cy); ctx.moveTo(cx + L * 0.35, cy); ctx.lineTo(cx + L, cy);
      ctx.moveTo(cx, cy - L); ctx.lineTo(cx, cy - L * 0.35); ctx.moveTo(cx, cy + L * 0.35); ctx.lineTo(cx, cy + L); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  if (one) {                                                    // the full-frame camera keeps its scale bar and palette
    const p = P[0];
    line(ctx, `ε 0.95  ${PALNAME[p.c.pal]}`, W - 48, 110, { family: 'Plex Mono', size: 30, align: 'right', color: '#fff' });
    const x = W - 74, y0 = 330, h = 860, img = SENSOR.uniforms.tL.value.image.data, g = ctx.createLinearGradient(0, y0 + h, 0, y0);
    for (let i = 0; i <= 16; i++) { const k = Math.round(i / 16 * 255), q = (p.c.pal * 256 + k) * 4; g.addColorStop(i / 16, `rgb(${img[q]},${img[q + 1]},${img[q + 2]})`); }
    ctx.fillStyle = g; ctx.fillRect(x, y0, 24, h); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x, y0, 24, h);
    line(ctx, fmtF(p.hi), x + 24, y0 - 16, { family: 'Plex Mono', size: 28, align: 'right', color: '#fff' });
    line(ctx, fmtF(p.lo), x + 24, y0 + h + 40, { family: 'Plex Mono', size: 28, align: 'right', color: '#fff' });
    if (p.c.iso) { ctx.fillStyle = '#ff1a3a'; ctx.fillRect(x - 4, y0 - 8 + h * (1 - clamp((p.c.isoT - p.lo) / (p.hi - p.lo))), 32, 8);
      line(ctx, `ISO > ${fmtF(p.c.isoT)}`, 48, 226, { family: 'Plex Mono', size: 34, align: 'left', color: '#ff5a6a' }); }
  }
  ctx.restore();
}
// ---------------------------------------------------------------- the ending: the emblem cools and the lockup comes out of it (upright, never rotated)
const CREAM = '#F4E6D0', RED = '#e8212e';
function ending(t) {
  if (t < T.cool) return;
  const u = t - T.cool;                                                       // the emblem has been hot type (emblemHeat) cooling in the sensor; the cream and red mark takes over as it goes dark
  const a = ease.inOutCubic(clamp((u - 1.0) / 0.8));
  ctx.save();
  drawMark(ctx, 540, 960, 488, { color: CREAM, alpha: 0.96 * a, badge: 1, stripes: [0, 0, 0, 0] });
  ctx.fillStyle = RED; drawMark(ctx, 540, 960, 488, { color: RED, alpha: a, badge: 0, stripes: [1, 1, 1, 1] });
  const p = (k) => ease.outCubic(clamp((t - (T.lock - 0.78) - k * 0.12) / 0.3));
  drawLockup(ctx, 540, 1330, 120, { color: CREAM, accent: RED, parts: { mark: p(0), eq: p(1), slash: p(2), acc: p(3) } });
  line(ctx, 'ACP.US', W / 2, 1470, { family: 'Archivo Black', size: 70, color: CREAM, alpha: clamp((t - (T.lock - 0.4)) * 3) });
  ctx.restore();
}
function emblemHeat(beat) {                                                    // the emblem written into the heat mask: hot metal, then it cools by temperature
  if (beat < T.workers + 1.0 || beat >= T.lock) return 1.08;
  const u = beat - T.cool, cooling = ease.inOutCubic(clamp(u / 1.8));
  const a = ease.outCubic(clamp((beat - (T.workers + 1.0)) / 0.5)) * (1 - ease.inOutCubic(clamp((u - 1.0) / 0.8)));
  if (a > 0.01) {
    tctx.save(); tctx.globalAlpha = a; drawMark(tctx, 540, 960, 600, { color: '#fff', alpha: 1, badge: 1, stripes: [0, 0, 0, 0] });
    tctx.globalCompositeOperation = 'destination-out'; tctx.globalAlpha = 0.55 * a; drawMark(tctx, 540, 960, 600, { color: '#000', alpha: 1, badge: 0, stripes: [1, 1, 1, 1] });
    tctx.restore();
  }
  return lerp(1.1, 0.34, cooling);
}
function credit(beat) {
  let a = 0; for (const [b0, b1] of CREDIT) if (beat >= b0 && beat < b1) a = clamp((beat - b0) * 3) * clamp((b1 - beat) * 3);
  if (a <= 0.01) return;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 8;
  line(ctx, 'EXECUTIVE CHAIRMAN,', W / 2, 1770, { family: 'Plex Mono', size: 34, color: '#fff', alpha: 0.92 * a, maxW: W - 120 });
  line(ctx, 'AMERICAN COMMUNIST PARTY', W / 2, 1815, { family: 'Plex Mono', size: 28, color: '#fff', alpha: 0.75 * a, maxW: W - 120 });
  ctx.restore();
}

// ---------------------------------------------------------------- the one true stop (c13): the thermal camera's own shutter. A NUC (non-uniformity correction): the
// camera holds its last frame while the sensor recalibrates (a real camera does this every few minutes), and the picture comes back on the hottest frame.
// Nothing presses anything: the camera recalibrates and the picture comes back hotter. The song clacks and then is exact silence inside it.
function nucShutter(t) {
  // 3 Oct (the client: "any idea what that editing error is in the middle of the video"): the v5 stop was a full-screen grey UI panel; c13-v9
  // made it the shutter's flag, a flat grey field for 1.2 s, which still read as the error (archive audit, 8 Oct). Now there is no grey field:
  // for 5 frames from STOP the picture holds (renderFrame) on the shutter's clack, the camera's NUC flag shows under the palette readout,
  // and the pour comes in at T.nuc_open.
  if (t < STOP || t >= T.nuc_open) return;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 5;
  line(ctx, 'NUC', W - 48, 168, { family: 'Plex Mono', size: 34, align: 'right', color: '#fff', alpha: 0.9 });
  ctx.globalAlpha = 0.9; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(W - 150, 142, 22, 22);
  ctx.fillStyle = '#fff'; ctx.fillRect(W - 145, 147, 12, 12);
  ctx.restore();
}

// ---------------------------------------------------------------- frame
const cBez = new THREE.Color(BEZ_T, 0, 0), cTmp = new THREE.Color(), camD = new THREE.PerspectiveCamera();
window.renderFrame = async (t) => {
  const beat = t, frame = Math.round(t * 30);
  const si = secIdx(beat), sec = WALL[si], [b0, lay, cells, so] = sec, rects = LAYOUT[lay], one = rects.length === 1;
  const vars = (cs) => cs.flatMap(c => (Array.isArray(c) ? c : [c]));
  const need = new Set(), nxt = new Set(); for (const c of vars(cells)) if (c.set === 'film') need.add(c.clip);
  for (const c of vars(WALL[Math.min(si + 1, WALL.length - 1)][2])) if (c.set === 'film') nxt.add(c.clip);
  await filmEnsure([...need], frame, [...nxt]);
  const secAge = beat - b0, nucOn = so.nuc && secAge < 0.1;
  const kick = B.env('pf_kick', t, 10), imp = B.env('impact', t, 5);
  // 1. temperature: one viewport per panel; the gaps read cold
  rtT.scissorTest = false; rtT.viewport.set(0, 0, TW, TH); renderer.setRenderTarget(rtT); renderer.setClearColor(cBez, 1); renderer.clear();
  const P = [];
  cells.forEach((c0, i) => {
    const r = rects[i]; if (!r) return;
    let c = c0; if (Array.isArray(c0)) { c = c0[0]; for (const v of c0) if (beat >= v.t) c = v; }          // a cell that cuts: the variant in force
    const cb0 = c.t ?? c.b0 ?? b0;
    const hold = nucOn ? b0 : (beat >= STOP && beat < T.nuc_open ? STOP : null);       // the stop: the last thermal frame freezes
    const st = hold != null ? hold : t, age = (hold ?? beat) - cb0;
    const vx = Math.round(r.x * TS), vy = Math.round((H - r.y - r.h) * TS), vw = Math.round(r.w * TS), vh = Math.round(r.h * TS);
    rtT.viewport.set(vx, vy, vw, vh); rtT.scissor.set(vx, vy, vw, vh); rtT.scissorTest = true;
    let lo, hi;
    if (c.set === 'film') {
      [lo, hi] = FILM.draw(c, st, age, r.w / r.h, hold ?? beat, hold != null ? 0 : kick);
      renderer.setRenderTarget(rtT); renderer.setClearColor(cTmp.setRGB(lo, 0, 0), 1); renderer.clear(); renderer.render(FILM.scene, camD);
    } else {
      const S = SETS[c.set]; S.update(st, c, age);
      const cv = S.cams[c.cam](st, age), cam = S.cam ?? S.cam0;
      const shake = hold != null ? 0 : (0.05 * kick + 0.12 * imp) * (c.shake ?? (one ? 1 : 0.35));
      cam.position.set(cv.p[0] + Math.sin(st * 31) * shake * 0.3, cv.p[1] + Math.cos(st * 27) * shake * 0.3, cv.p[2]);
      cam.lookAt(cv.l[0], cv.l[1], cv.l[2]);
      cam.aspect = r.w / r.h; cam.fov = cv.fov; cam.updateProjectionMatrix();
      renderer.setRenderTarget(rtT); renderer.setClearColor(cTmp.setRGB(S.clear ?? AIR, 0, 0), 1); renderer.clear(); renderer.render(S.scene, cam);
      [lo, hi] = typeof c.agc === 'function' ? c.agc(age) : c.agc;
    }
    const hunt = hold != null ? 0 : Math.exp(-age * 5) * Math.cos(age * 19) * (c.hunt ?? 0.15);
    hi = lo + (hi - lo) * (1 + hunt);
    P.push({ r, c, age, hit: 0, st, lo, hi, dim: c.dim ? c.dim(beat) : 1, spot: 0 });
  });
  rtT.scissorTest = false; rtT.viewport.set(0, 0, TW, TH);
  // 2. readback: each panel's hottest spot for its readout
  quad.material = MAXP; renderer.setRenderTarget(rtM); renderer.render(postScene, postCam);
  renderer.readRenderTargetPixels(rtM, 0, 0, MX, MY, mbuf);
  for (const p of P) { let mx = -9; const { x, y, w, h } = p.r;
    for (let j = 0; j < MY; j++) { const py = (1 - (j + 0.5) / MY) * H; if (py < y || py > y + h) continue;
      for (let i = 0; i < MX; i++) { const px = (i + 0.5) / MX * W; if (px >= x && px <= x + w) mx = Math.max(mx, mbuf[(j * MX + i) * 4]); } }
    p.spot = mx; }
  // 3. words: the heat mask
  tctx.clearRect(0, 0, W, H);
  tctx.fillStyle = 'rgba(0,0,0,0.01)'; tctx.fillRect(frame % 4, 0, 1, 1);   // never upload an all-blank canvas (Chrome can keep the last non-blank snapshot)
  const cue = cueAt(beat);
  let heatV = 1.08;
  if (cue) { const age = beat - cue[0]; drawCue(cue, age); heatV = age < 0.1 && !(cue[4] && cue[4].snap) ? lerp(0.78, 1.08, age / 0.1) : 1.08; }
  if (beat >= T.workers + 1.0) heatV = emblemHeat(beat);
  textTex.needsUpdate = true;
  BLUR.uniforms.textT.value = 0.0; blurPass();
  // 4. sensor: the gaps first, then one scissored pass per panel with its own palette and AGC
  const U = SENSOR.uniforms, flash = FLASHES.reduce((f, [b, a]) => f + (beat >= b && beat < b + 0.14 ? a * (1 - (beat - b) / 0.14) : 0), 0);
  U.heat.value = heatV; U.outline.value = cue && cue[4] && cue[4].outline ? clamp((beat - cue[0]) * 4) : 0;
  U.time.value = t; U.frame.value = frame; U.flash.value = flash;
  U.flashHot.value = HOTFLASH.reduce((f, [b, a]) => f + (beat >= b && beat < b + 0.2 ? a * (1 - (beat - b) / 0.2) : 0), 0);
  quad.material = SENSOR; renderer.setRenderTarget(null);
  const setP = (p) => {
    U.lo.value = p ? p.lo : 0; U.hi.value = p ? p.hi : 1.6; U.eq.value = p ? (p.c.set === 'film' ? (p.hi - p.lo) * 5 : (p.c.eq ?? (p.hi - p.lo) * 0.03)) : 0.05; U.pal.value = p ? p.c.pal : 0;
    U.isoT.value = p && p.c.isoT ? p.c.isoT : 99; U.isoAmt.value = p && p.c.iso ? clamp(p.age / 0.15) : 0; U.dim.value = p ? p.dim : 1;
    U.uFlat.value = p && nucOn && b0 > 0 && secAge < 1 / 30 ? 0.35 : 0; U.blow.value = 0;   // frame 0 is the thumbnail: no flat field there
    if (p) U.rect.value.set(p.r.x / W, 1 - (p.r.y + p.r.h) / H, (p.r.x + p.r.w) / W, 1 - p.r.y / H); else U.rect.value.set(0, 0, 1, 1);
  };
  renderer.setScissorTest(false); setP(null); renderer.render(postScene, postCam);
  renderer.setScissorTest(true);
  for (const p of P) { renderer.setScissor(p.r.x, H - p.r.y - p.r.h, p.r.w, p.r.h); setP(p); renderer.render(postScene, postCam); }
  renderer.setScissorTest(false);
  ctx.drawImage(renderer.domElement, 0, 0);
  // 5. bezels and readouts, the credit, the ending
  bezels(P, one);
  if (beat < T.cool + 0.3) hud(P, t, beat, one);
  credit(beat); ending(beat); nucShutter(beat);
  finish.apply(ctx, frame, { grain: 0.05, vignette: 0.3 });
};
window.sceneReady = true;
