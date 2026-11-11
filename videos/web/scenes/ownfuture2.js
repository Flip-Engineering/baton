// OWN THE FUTURE (v8, cycle 6): a history, then the question, then the Party's own answer. The 2036 exit came early:
// 2036? Try 2024. Chicago, 7.21.24: the American Communist Party, twelve years early. Ten of us, 29 clubs; Port Newark,
// 100s of truckers signed up to unionize; on the march, through our struggle; by 2036, a party of millions. The
// Constitution's own reason for the slogan (planning, management and control: the battle for the future), the client's
// couplet over the break, and the Party's slogan verbatim on three sign bridges in a row, Burma-Shave style, in button
// copy fired by our high beams. Next exit: a party of millions; the loop rolls to the EXIT 2036 gantry.
// v8 restores v2's specifics inside v7's world; the song (songs2/ownfuture.py) was always keyed to v2's beats.
// Picture fixes: no tone curve (tonemap 0, no lifted blacks), no lens chroma on type, the client's own poster
// photograph as the trucker (a rostrum push-in), the HUMAN c4 film grip on a Class 8 wheel (ownfuture2.hands.js),
// millions as a growing field of lights, the organisers at the gate raked by headlights, a gate-camera HUD for the
// owners' systems of control.
import * as THREE from 'three';
import { mergeGeometries } from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import { W, H, C, loadFonts, loadBeats, clamp, lerp, smooth, ease, rng, outCanvas, Finish, BRAND, tinted, sigil, line } from '../lib/kit.js';
import { RQ } from '../lib/rq.js';
import { Post } from '../lib/fx/post.js';
import { People } from '../lib/fx/people.js';
import { loadTake, PEOPLE_MAP } from '../lib/fx/bvh.js';
import { faceArt, flyerArt, cbArt } from './ownfuture2.type.js';
import { loadFace } from '../lib/fx/type.js';
import { buttonCopy, buttonMaterial } from '../lib/fx/type_light.js';
import { makeDriver } from './ownfuture2.hands.js';

THREE.ColorManagement.enabled = false;
const out = outCanvas();
await loadFonts();
for (const [wt, f] of [['900', 'overpass-latin-900-normal.woff2'], ['700', 'overpass-latin-700-normal.woff2']]) {
  const ff = new FontFace('Overpass', `url(../assets/fonts/${f})`, { weight: wt }); document.fonts.add(await ff.load());
}
{ const ff = new FontFace('League Spartan', 'url(../assets/fonts/league-spartan-latin-900-normal.woff2)', { weight: '900' }); document.fonts.add(await ff.load()); }
const B = await loadBeats('ownfuture2');
const SPB = B.spb;
const LOCK = 64;                                     // the one brand card (kit closer) lands here

// ---------------------------------------------------------------- the script (research/scripts_final/ownfuture.json, verbatim)
const WORDS = [[0, 'EXIT 2036.'], [2, 'FOOT DOWN.'], [4, "A WORKERS' PARTY."], [8, 'WE CALLED IT.'], [10, 'THE EXIT'], [11, 'CAME EARLY.'], [13, null], [14, '2036?'],
  [16, 'TRY 2024.'], [17, 'CHICAGO 7.21.24.'], [18, 'THE AMERICAN'], [19, 'COMMUNIST PARTY.'], [21, 'TWELVE YEARS'], [22, 'EARLY.'], [23, 'EARLY.'], [24, 'EARLY.'],
  [26, 'TEN OF US.'], [27, '29 CLUBS.'], [28, 'PORT NEWARK.'], [29, '100s OF TRUCKERS'], [30, 'SIGNED UP'], [31, 'TO UNIONIZE.'], [32, 'ON THE MARCH.'],
  [34, 'THROUGH'], [35, 'OUR STRUGGLE.'], [36, 'BY 2036,'], [37, 'A PARTY'], [38, 'OF MILLIONS.'],
  [40, 'PLANNING,'], [41, 'MANAGEMENT,'], [42, 'AND CONTROL, …'], [44, 'THE BATTLE'], [46, 'FOR THE FUTURE.'],   // … marks the preamble's left-out clause
  [48, 'WHO OWNS'], [49, 'THE MACHINES?'], [50, 'WHO OWNS'], [51, 'THE FUTURE?'],
  [52, 'THE FUTURE'], [54, 'BELONGS TO'], [56, 'THE WORKING CLASS.'], [60, 'NEXT EXIT:'], [61, 'A PARTY'], [62, 'OF MILLIONS.'], [64, null]];
const COUPLET = { 'THE MACHINES?': 'WHO OWNS', 'THE FUTURE?': 'WHO OWNS' };   // the second half lands under the first
const EARLY_HITS = WORDS.filter(w => w[1] === 'EARLY.').map(w => w[0]);
const wordAt = b => { let r = WORDS[0]; for (const w of WORDS) if (b >= w[0]) r = w; return r; };

// ---------------------------------------------------------------- palette
const P = { teal: '#1F4A4F', teal2: '#2E6A70', deep: '#0E2A30', sod: '#FF8A2A', green: '#0B6B3A', dot: '#E53239', white: '#F2F4EE' };
const col = h => new THREE.Color(h);
const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------------------------------------------------------------- renderer (0.75 res + sharpen via post)
const ADOPT = false;   // GRAPHICS 4.A (lib/rq.js): true = native resolution on the GPU and a fenced copy, once this piece's farm A/B says so
const RS = RQ.scale(0.75, ADOPT), RW = Math.round(W * RS), RH = Math.round(H * RS);
// the light points' fixed-pixel limits (the 2 px floor, the bokeh discs, the 7 px cap) keep their displayed size at another scale: sizes are
// worked in 0.75-scale pixels (PXD) and drawn at PK = RS / 0.75 times that (PXM); both '' at 0.75
const PK = RQ.k(), PXM = RQ.glslMul(PK), PXD = RQ.glslMul(1 / PK);
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(RW, RH, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = false;
const rt = new THREE.WebGLRenderTarget(RW, RH, { samples: 4, type: THREE.UnsignedByteType });
const rtLo = new THREE.WebGLRenderTarget(Math.round(RW * 0.45), Math.round(RH * 0.45), { samples: 0 });
const cam = new THREE.PerspectiveCamera(60, W / H, 0.2, 9000);
const mcam = new THREE.PerspectiveCamera(34, 1, 0.5, 6000);   // the side mirror
const focalOf = (c, h) => h / 2 / Math.tan(THREE.MathUtils.degToRad(c.fov) / 2);

// ---------------------------------------------------------------- baked textures (canvas, once)
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function texOf(c, rep = false) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } t.anisotropy = 4; return t; }
const R0 = rng(130);
// asphalt: r = aggregate, g = tar snakes, b = wet sheen patches
const asph = (() => {
  const S = 512, c = cv(S, S), g = c.getContext('2d'), id = g.createImageData(S, S), d = id.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4, n = R0();
    const lo = 0.5 + 0.25 * Math.sin(x * 0.037 + Math.sin(y * 0.021) * 2) * Math.sin(y * 0.029 + 1.3);
    d[i] = 255 * clamp(lo * 0.6 + n * 0.5 * (R0() < 0.2 ? 1.6 : 0.8)); d[i + 1] = 0;
    d[i + 2] = 255 * clamp(0.5 + 0.5 * Math.sin(x * 0.019 + 2.1) * Math.sin(y * 0.013 + Math.sin(x * 0.05))); d[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(0,255,0,0.9)'; g.lineCap = 'round';
  for (let k = 0; k < 26; k++) {                                   // tar snakes: crack sealant runs
    let x = R0() * S, y = R0() * S, a = R0() * 6.28; g.lineWidth = 2 + R0() * 4; g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 40; s++) { a += (R0() - 0.5) * 0.9; x += Math.cos(a) * 6; y += Math.sin(a) * 6; g.lineTo(x, y); }
    g.stroke();
  }
  return texOf(c, true);
})();
// windshield droplets: rg = refraction normal, b = thickness; a tile of beads + runners
const dropTex = (() => {
  const S = 512, c = cv(S, S), g = c.getContext('2d'), id = g.createImageData(S, S), d = id.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = 128; d[i + 1] = 128; d[i + 2] = 0; d[i + 3] = 255; }
  const R = rng(77);
  const drop = (cx, cy, r, sy = 1) => {
    for (let y = Math.floor(cy - r * sy) - 1; y <= cy + r * sy + 1; y++) for (let x = Math.floor(cx - r) - 1; x <= cx + r + 1; x++) {
      const dx = (x - cx) / r, dy = (y - cy) / (r * sy), q = dx * dx + dy * dy; if (q >= 1) continue;
      const X = ((x % S) + S) % S, Y = ((y % S) + S) % S, i = (Y * S + X) * 4, h = Math.sqrt(1 - q);
      d[i] = 128 + 127 * clamp(-dx * 0.9, -1, 1); d[i + 1] = 128 + 127 * clamp(-dy * 0.9, -1, 1); d[i + 2] = Math.max(d[i + 2], 255 * (0.35 + 0.65 * h));
    }
  };
  for (let k = 0; k < 900; k++) drop(R() * S, R() * S, 0.8 + R() * R() * 3.2);
  for (let k = 0; k < 90; k++) drop(R() * S, R() * S, 3 + R() * 6, 1 + R() * 0.4);
  for (let k = 0; k < 10; k++) { const x = R() * S; let y = R() * S; for (let s = 0; s < 24; s++) { drop(x + Math.sin(s * 0.7) * 1.2, y, 2.2 + R(), 1.2); y += 3.5; } drop(x, y + 3, 6, 1.3); }
  g.putImageData(id, 0, 0);
  const t = texOf(c, true); t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; return t;
})();
// windshield grime: road film, bug marks, a wiper arc cleared through it
const grimeTex = (() => {
  const w = 540, h = 960, c = cv(w, h), g = c.getContext('2d'), R = rng(5);
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  for (let k = 0; k < 900; k++) { const x = R() * w, y = R() * h, r = 4 + R() * 40; const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${0.05 + R() * 0.08})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  g.globalCompositeOperation = 'destination-out';                 // two wiper sweeps clear the lower glass
  for (const [cx, rr] of [[150, 520], [470, 520]]) { g.beginPath(); g.arc(cx, h + 60, rr, Math.PI * 1.06, Math.PI * 1.94); g.arc(cx, h + 60, 90, Math.PI * 1.94, Math.PI * 1.06, true); g.fillStyle = 'rgba(0,0,0,0.72)'; g.fill(); }
  g.globalCompositeOperation = 'source-over';
  for (const [cx, rr] of [[150, 520], [470, 520]]) { g.beginPath(); g.arc(cx, h + 60, rr, Math.PI * 1.06, Math.PI * 1.94); g.lineWidth = 7; g.strokeStyle = 'rgba(255,255,255,0.28)'; g.stroke(); }
  for (let k = 0; k < 70; k++) { const x = R() * w, y = R() * h * 0.8; g.fillStyle = `rgba(255,255,255,${0.25 + R() * 0.4})`; g.beginPath();   // bug marks
    g.ellipse(x, y, 1 + R() * 2.5, 1 + R() * 2, R() * 3, 0, 6.28); g.fill(); g.fillRect(x, y, 1 + R() * 5, 1); }
  for (let k = 0; k < 30; k++) { const x = R() * w, y = R() * h; g.strokeStyle = `rgba(255,255,255,${0.06 + R() * 0.08})`; g.lineWidth = 1 + R() * 2;  // dried runnels
    g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + 4, y + 40, x - 3, y + 90, x + R() * 8, y + 150 + R() * 100); g.stroke(); }
  const t = texOf(c); t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; return t;
})();
// corrugation for containers and trailers (r = shade, fine vertical ribs, rust streaks, door end)
const corrTex = (() => {
  const c = cv(256, 64), g = c.getContext('2d'), R = rng(9);
  for (let x = 0; x < 256; x++) { const r = 0.62 + 0.38 * Math.pow(Math.abs(Math.sin(x * Math.PI / 6)), 0.6); g.fillStyle = `rgb(${r * 255},${r * 255},${r * 255})`; g.fillRect(x, 0, 1, 64); }
  for (let k = 0; k < 40; k++) { const x = R() * 256; g.fillStyle = `rgba(60,30,10,${0.1 + R() * 0.25})`; g.fillRect(x, R() * 10, 1 + R() * 3, 20 + R() * 44); }
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, 256, 3); g.fillRect(0, 61, 256, 3); g.fillRect(0, 0, 3, 64); g.fillRect(253, 0, 3, 64);
  const t = texOf(c, true); return t;
})();
// lattice truss (alpha) for crane booms and gantry
const trussTex = (() => {
  const c = cv(256, 64), g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 58);
  g.lineWidth = 4; g.beginPath(); for (let x = 0; x < 256; x += 32) { g.moveTo(x, 4); g.lineTo(x + 32, 60); g.moveTo(x + 32, 4); g.lineTo(x, 60); } g.stroke();
  const t = texOf(c, true); return t;
})();

// ---------------------------------------------------------------- shaders
const FOGF = `float fogAmt(float d, float k){ return 1. - exp(-d * k); }`;
// light points: glow (0), oval anamorphic bokeh (1), wet-road reflection streak (2)
class Lights {
  constructor(n, depthTest = true) {
    this.cap = n; this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.colA = new Float32Array(n * 3); this.sz = new Float32Array(n); this.sh = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colA, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.sz, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('shape', new THREE.BufferAttribute(this.sh, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { focal: { value: 1000 }, gain: { value: 1 }, bokeh: { value: 0 }, bokehK: { value: 1 }, hideRefl: { value: 0 }, fogK: { value: 0.0006 } },
      vertexShader: `attribute float size, shape; attribute vec3 color; uniform float focal, bokeh, bokehK, hideRefl, fogK; varying vec3 vC; varying float vS;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv;
          float d = max(-mv.z, 0.1); float s = size * focal / d${PXD}; if (bokeh > .5 && shape < 1.5) s = max(s * 1.3, bokehK * (6. + 26. * clamp(size, 0., 1.)));
          float k = 1.; if (s < 2.) { k = s * s / 4.; s = 2.; } s = min(s, 420.);
          vS = bokeh > .5 && shape < 1.5 ? 1. : shape; if (shape > 1.5 && hideRefl > .5) { k = 0.; s = 0.; }
          if (shape > 1.5) s *= 2.2;
          gl_PointSize = s${PXM}; vC = color * k * exp(-d * fogK); }`,
      fragmentShader: `uniform float gain; varying vec3 vC; varying float vS;
        void main(){ vec2 p = gl_PointCoord * 2. - 1.; float a;
          if (vS < .5) { float r2 = dot(p, p); a = exp(-r2 * 24.) * 1.3 + exp(-r2 * 6.) * .25 + exp(-r2 * 1.8) * .05; }
          else if (vS < 1.5) { vec2 q = vec2(p.x * 1.65, p.y); float r = length(q); a = smoothstep(1., .9, r) * (.35 + .5 * smoothstep(.5, .95, r)) * (1. - .15 * p.y); }
          else { vec2 q = vec2(p.x * 7., p.y * 1.02); float r2 = dot(q, q); a = exp(-r2 * 2.) * .55 * (1. - .25 * sin(p.y * 23.)); }
          gl_FragColor = vec4(vC * a * gain, 1.); }`,
      transparent: true, depthWrite: false, depthTest, blending: THREE.AdditiveBlending,
    });
    this.obj = new THREE.Points(g, this.mat); this.obj.frustumCulled = false; this.obj.renderOrder = 10; this.g = g;
  }
  reset() { this.n = 0; }
  add(x, y, z, r, gg, b, size, shape = 0) {
    if (this.n >= this.cap) return; const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; this.colA[i * 3] = r; this.colA[i * 3 + 1] = gg; this.colA[i * 3 + 2] = b; this.sz[i] = size; this.sh[i] = shape;
  }
  // the lamp's image in the wet road, placed where the camera ray meets the ground
  refl(x, y, z, r, gg, b, size, k = 0.35) {
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z; if (y <= 0.05 || cy <= 0.05) return;
    const f = cy / (cy + y); this.add(cx + (x - cx) * f, 0.03, cz + (z - cz) * f, r * k, gg * k, b * k, size * 1.4, 2);
  }
  commit() { for (const k of ['position', 'color', 'size', 'shape']) this.g.attributes[k].needsUpdate = true; this.g.setDrawRange(0, this.n); }
}

// sky: teal dusk with a thin warm band, or night with the sodium dome over the port
const skyMat = new THREE.ShaderMaterial({
  uniforms: { top: { value: col('#0c2328') }, mid: { value: col(P.teal) }, hor: { value: col('#4f7f80') }, band: { value: col('#c9763a') }, bandW: { value: 0.035 }, bandA: { value: 1 }, glow: { value: new THREE.Vector3(0, 0, -1) }, glowC: { value: col('#000000') } },
  vertexShader: `varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = vec4(p.xy, p.w * .99995, p.w); }`,
  fragmentShader: `uniform vec3 top, mid, hor, band, glowC, glow; uniform float bandW, bandA; varying vec3 vD;
    float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){ vec3 d = normalize(vD); float h = d.y;
      vec3 c = mix(hor, mid, smoothstep(-.02, .22, h)); c = mix(c, top, smoothstep(.18, .85, h));
      c += band * bandA * (exp(-pow((h + .005) / bandW, 2.)) * .9 + exp(-pow(h / (bandW * 4.), 2.)) * .25) * smoothstep(-.06, 0., h);
      c += glowC * pow(max(dot(d, normalize(glow)), 0.), 6.) * smoothstep(.35, -.02, h);
      c = mix(c, hor * .35, smoothstep(0., -.08, h));
      c += (h12(gl_FragCoord.xy) - .5) / 255.;
      gl_FragColor = vec4(c, 1.); }`,
  side: THREE.BackSide, depthWrite: false, depthTest: false,
});
const mkSky = () => { const m = new THREE.Mesh(new THREE.SphereGeometry(8000, 32, 16), skyMat); m.renderOrder = -10; m.frustumCulled = false; m.onBeforeRender = (r, sc, c) => { m.position.copy(c.position); m.updateMatrixWorld(); }; return m; };
// the red dot: one flat disc, a soft DARK halo (never a glow), sized to 8 % of the frame width whatever the lens;
// redrawn flat after the lens pass when it is unoccluded (dotAfterLens), so no streak, bloom or chroma split touches it
const dotMat = new THREE.ShaderMaterial({
  uniforms: { c: { value: col(P.dot) }, a: { value: 1 } },
  vertexShader: `varying vec2 vU; void main(){ vU = uv * 2. - 1.; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `uniform vec3 c; uniform float a; varying vec2 vU; void main(){ float r = length(vU) * 7.;
    float disc = smoothstep(1.02, .98, r); float halo = .32 * exp(-max(r - 1., 0.) * 1.6) * (1. - disc);
    gl_FragColor = vec4(c * disc, max(disc, halo) * a); }`,
  transparent: true, depthWrite: false, blending: THREE.NormalBlending, fog: false,
});
function mkDot() { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), dotMat); m.renderOrder = -5; m.frustumCulled = false; return m; }
let DOT = null;                                        // this frame's dot: world position (for the flat redraw after the lens)
function placeDot(m, az, el, dist = 5000) {            // az: radians from -Z toward +X, el: radians up
  m.position.set(cam.position.x + Math.sin(az) * Math.cos(el) * dist, cam.position.y + Math.sin(el) * dist, cam.position.z - Math.cos(az) * Math.cos(el) * dist);
  const rad = 0.04 * W / focalOf(cam, H);              // disc radius 4 % of the width: diameter 8 %
  m.scale.setScalar(dist * rad * 7 * 2); m.quaternion.copy(cam.quaternion);
  if (m.visible) DOT = { p: m.position.clone(), rpx: 0.04 * W };
}

// ground: asphalt / concrete with lane paint, sodium pools on a lamp lattice, our headlights, wet sheen
const groundMat = (mode) => new THREE.ShaderMaterial({
  uniforms: { tA: { value: asph }, rig: { value: new THREE.Vector3() }, head: { value: 1 }, amb: { value: col('#1b3134') }, sod: { value: col(P.sod) }, sodI: { value: 1 },
    lampS: { value: new THREE.Vector2(50, 50) }, lampO: { value: new THREE.Vector2(-6.6, 0) }, lampR: { value: 16 }, fogC: { value: col('#2c5256') }, fogK: { value: 0.0012 }, sky: { value: col('#3c6a6c') }, wet: { value: 0.6 },
    lgT: { value: null }, lgOn: { value: 0 }, lgC: { value: new THREE.Vector2() }, lgD: { value: new THREE.Vector2(1, 0) }, lgS: { value: new THREE.Vector2(10, 5) }, lgCol: { value: col('#e8e6de') } },
  vertexShader: `varying vec3 vW; varying float vD; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform sampler2D tA, lgT; uniform vec3 rig, amb, sod, fogC, sky, lgCol; uniform float head, sodI, lampR, fogK, wet, lgOn; uniform vec2 lampS, lampO, lgC, lgD, lgS; varying vec3 vW; varying float vD;
    ${FOGF}
    float ln(float d, float w){ float f = fwidth(d) * .8; return 1. - smoothstep(w - f, w + f, abs(d)); }
    void main(){ vec2 p = vW.xz; vec3 a = texture2D(tA, p / 7.).rgb; vec3 a2 = texture2D(tA, p / 31. + .37).rgb;
      vec3 alb = vec3(.085, .09, .095) * (.6 + .7 * a.r) * (.8 + .4 * a2.r); alb *= 1. - .55 * a.g;
      float m = 0., yl = 0.;
      ${mode === 'hw' ? `float dash = step(mod(p.y, 12.), 3.); float dashO = step(mod(p.y + 6., 12.), 3.);
      m += (ln(p.x, .075) + ln(p.x - 3.6, .075)) * dash + ln(p.x - 7.2, .09);
      m += (ln(p.x + 11.4, .075) + ln(p.x + 15., .075)) * dashO + ln(p.x + 18.7, .09);
      yl = ln(p.x + 3.6, .08) + ln(p.x + 7.8, .08);
      float shoulder = step(7.3, p.x); alb *= 1. + .25 * shoulder;
      m += shoulder * ln(fract(p.y / 5.) - .5, .08) * step(p.x, 8.2) * .0;` :
      `float lane = ln(mod(p.x + 1.875, 3.75) - 1.875, .07) * step(abs(p.x), 30.) * step(mod(p.y, 9.), 4.5);
      m += lane * step(0., p.y); m += ln(abs(p.x) - 30., .1) * step(0., p.y);
      float slab = ln(fract(p.x / 6.) - .5, .02) + ln(fract(p.y / 6.) - .5, .02); alb *= 1. - .35 * clamp(slab, 0., 1.) * step(p.y, 0.);
      alb *= 1. + .3 * step(p.y, 0.) * (a2.r - .5);
      yl = ln(abs(p.x) - 9., .12) * step(p.y, 0.) * step(mod(p.y, 3.), 1.8);`}
      vec3 alb0 = alb; m *= .55 + .45 * a.r;
      alb = mix(alb, vec3(.72, .72, .68) * ${mode === 'hw' ? '1.' : '.55'}, clamp(m, 0., 1.) * .85); alb = mix(alb, vec3(.75, .56, .12), clamp(yl, 0., 1.) * .85);
      float paint = 0.;                                  // the pavement legend: road paint with glass beads, worn in the wheel paths
      if (lgOn > .5) { vec2 dd = p - lgC; vec2 nn = vec2(-lgD.y, lgD.x); float u = dot(dd, lgD) / lgS.x + .5, v = .5 - dot(dd, nn) / lgS.y;
        if (u > 0. && u < 1. && v > 0. && v < 1.) { paint = texture2D(lgT, vec2(u, v)).r * (.75 + .25 * a.r); alb = mix(alb0 * .8, lgCol * .85, paint * .94); } }
      vec3 L = amb;
      vec2 q = (p - lampO) / lampS; vec2 c0 = floor(q + .5);
      for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
        vec2 lp = (c0 + vec2(float(i), float(j))) * lampS + lampO; ${mode === 'hw' ? 'if (i != 0) continue; lp.x = lampO.x;' : 'if (abs(lp.x + 11.) > 61. || lp.y > 31. || lp.y < -1411.) continue;'}
        vec2 dd = p - lp; float r2 = dot(dd, dd) / (lampR * lampR);
        ${mode === 'hw' ? 'vec2 d2 = p - lp - vec2(3.5, 0.); vec2 d3 = p - lp + vec2(3.5, 0.); r2 = min(dot(d2, d2), dot(d3, d3)) / (lampR * lampR);' : ''}
        L += sod * sodI * (1.2 / (1. + r2 * 2.5)) * exp(-r2 * .35); }
      vec2 dv = p - rig.xz; float fwd = -dv.y; float lat = dv.x;
      L += vec3(1., .95, .86) * head * smoothstep(1., 6., fwd) * exp(-lat * lat / (.05 * fwd * fwd + 2.)) * 18. / (fwd + 14.);
      vec3 c = alb * L * 3.;
      c += lgCol * paint * head * smoothstep(1., 6., fwd) * exp(-lat * lat / (.08 * fwd * fwd + 4.)) * 2. / (fwd + 10.);   // bead return
      float sheen = wet * (.35 + .65 * a.b) * (1. - a.g * .3) * (1. - paint * .6);
      c += sky * sheen * .16 * smoothstep(20., 300., vD);
      c = mix(c, fogC, fogAmt(vD, fogK));
      gl_FragColor = vec4(c, 1.); }`,
});

// retroreflective sign face: letters flare hard in the headlights, green face less so
const signMat = (map) => new THREE.ShaderMaterial({
  uniforms: { map: { value: map }, amb: { value: 0.55 }, flare: { value: 0 }, sweep: { value: -1 }, fogC: { value: col('#2c5256') }, fogK: { value: 0.0012 } },
  vertexShader: `varying vec2 vU; varying float vD; void main(){ vU = uv; vec4 mv = modelViewMatrix * vec4(position, 1.); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform sampler2D map; uniform float amb, flare, sweep, fogK; uniform vec3 fogC; varying vec2 vU; varying float vD; ${FOGF}
    void main(){ vec3 t = texture2D(map, vU).rgb; float wh = smoothstep(.5, .85, min(t.r, min(t.g, t.b)));
      float band = exp(-pow((vU.x - sweep) * 5., 2.));
      vec3 c = t * (amb + flare * mix(.35, 2.4, wh) + band * mix(.25, 1.8, wh));
      c = mix(c, fogC, fogAmt(vD, fogK) * .8); gl_FragColor = vec4(c, 1.); }`,
});

// volumetric sodium cone: closed-form single scatter falloff along the axis and across the rim
const coneMat = new THREE.ShaderMaterial({
  uniforms: { c: { value: col(P.sod) }, k: { value: 0.12 } },
  vertexShader: `varying float vY; varying vec3 vN, vV; void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.); vV = normalize(-mv.xyz); vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 c; uniform float k; varying float vY; varying vec3 vN, vV; void main(){ float rim = pow(abs(dot(vN, vV)), 1.6);
    gl_FragColor = vec4(c * k * rim * pow(vY, 1.8), 1.); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});

// ---------------------------------------------------------------- geometry helpers
function bx(w, h, d, x, y, z, c, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d); if (rx || ry || rz) g.rotateX(rx).rotateY(ry).rotateZ(rz); g.translate(x, y, z); return paint(g, c);
}
function cyl(r, len, x, y, z, c, axis = 'y', seg = 12, r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, len, seg); if (axis === 'x') g.rotateZ(Math.PI / 2); if (axis === 'z') g.rotateX(Math.PI / 2); g.translate(x, y, z); return paint(g, c);
}
function rod(x0, y0, z0, x1, y1, z1, r, c) {      // a square member between two points (braces, stays, rails)
  const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), L = a.distanceTo(b);
  const g = new THREE.BoxGeometry(r, L, r); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return paint(g, c);
}
function paint(g, c) { g = g.index ? g.toNonIndexed() : g; const cc = col(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g; }
const merge = (list) => mergeGeometries(list, false);
const vc = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, ...o });

// a Class 8 conventional tractor, long hood, facing -Z; origin on the ground at the front axle line
function tractorGeo() {
  const body = '#ffffff', chrome = '#8d949a', dark = '#121416', glass = '#0a1214', tire = '#0c0c0c';
  const L = [
    bx(2.5, 0.42, 0.34, 0, 0.78, -3.55, chrome), bx(1.15, 1.25, 0.12, 0, 1.55, -3.45, chrome),
    bx(1.0, 1.1, 0.06, 0, 1.55, -3.52, dark), bx(2.05, 0.95, 2.3, 0, 1.62, -2.3, body), bx(2.1, 0.3, 2.2, 0, 2.15, -2.2, body, 0.12),
    bx(2.55, 0.5, 1.7, 0, 1.08, -2.55, body), bx(2.45, 1.95, 1.7, 0, 2.55, -0.45, body), bx(2.2, 0.85, 0.06, 0, 2.95, -1.33, glass, -0.2),
    bx(0.06, 0.7, 0.9, 1.24, 2.95, -0.7, glass), bx(0.06, 0.7, 0.9, -1.24, 2.95, -0.7, glass),
    bx(2.45, 2.4, 2.0, 0, 2.75, 1.4, body), bx(2.4, 0.7, 1.6, 0, 4.1, 1.1, body, -0.25),
    cyl(0.11, 2.6, 1.32, 3.1, 0.35, chrome), cyl(0.11, 2.6, -1.32, 3.1, 0.35, chrome),
    cyl(0.36, 1.3, 1.12, 0.85, 0.3, chrome, 'z'), cyl(0.36, 1.3, -1.12, 0.85, 0.3, chrome, 'z'),
    bx(1.0, 0.3, 8.2, 0, 0.95, 1.2, dark), bx(0.12, 0.6, 0.12, 1.45, 2.9, -1.2, dark), bx(0.08, 1.0, 0.4, 1.55, 2.85, -1.25, chrome),
    bx(0.12, 0.6, 0.12, -1.45, 2.9, -1.2, dark), bx(0.08, 1.0, 0.4, -1.55, 2.85, -1.25, chrome),
  ];
  for (const z of [-2.6, 2.3, 3.6]) for (const s of [-1, 1]) L.push(cyl(0.52, 0.34, s * 1.05, 0.52, z, tire, 'x', 14));
  return merge(L);
}
function chassisGeo() {                         // drayage container chassis under a 40 ft box, rear at +z
  const dark = '#141516', tire = '#0c0c0c';
  const L = [bx(0.9, 0.28, 12.4, 0, 1.25, 9.0, dark), bx(2.44, 0.16, 0.3, 0, 1.3, 3.0, dark), bx(2.44, 0.16, 0.3, 0, 1.3, 15.0, dark), bx(2.44, 0.2, 0.25, 0, 0.62, 15.1, '#6b1210')];
  for (const z of [12.9, 14.2]) for (const s of [-1, 1]) L.push(cyl(0.52, 0.6, s * 0.95, 0.52, z, tire, 'x', 14));
  return merge(L);
}
const TR = tractorGeo(), CH = chassisGeo();
const BOXG = new THREE.BoxGeometry(2.44, 2.6, 12.2);   // a 40 ft box; corrugation ribs from contMat
const contMat = new THREE.MeshLambertMaterial({ map: corrTex });
const LIVERY = ['#1d4f7a', '#9e2a22', '#2f6d4a', '#6c6f73', '#b4541e', '#2a3b5a', '#7a1f3a', '#c9b48a', '#1f6b72', '#4a4a52', '#8a6a2e', '#e2e0da'];
// rig light layout (local, facing -Z)
const RIGL = { head: [[0.95, 1.2, -3.72], [-0.95, 1.2, -3.72]], roof: [-0.7, -0.35, 0, 0.35, 0.7].map(x => [x, 3.55, -1.3]),
  side: [0, 3, 6, 9, 12].map(z => [1.25, 1.45, 3.2 + z]), tail: [[0.95, 1.1, 15.25], [-0.95, 1.1, 15.25]] };
// a rig = tractor + chassis + container; placed by (x, z, yaw)
class Rigs {
  constructor(scene, n, dark = false) {
    this.tr = new THREE.InstancedMesh(TR, vc(), n); this.ch = new THREE.InstancedMesh(CH, vc(), n); this.ct = new THREE.InstancedMesh(BOXG, contMat, n);
    for (const m of [this.tr, this.ch, this.ct]) { m.frustumCulled = false; scene.add(m); }
    const R = rng(n * 7 + 3), body = dark ? ['#3a3834', '#4a1414', '#141e30', '#2a2c2e', '#1c2622', '#3a2a1a', '#101214'] : ['#d8d4cc', '#8e1c1c', '#1b2f52', '#e4e2de', '#3a3f45', '#6b1a1a', '#23452e', '#b8b2a4', '#11161c'];
    for (let i = 0; i < n; i++) { this.tr.setColorAt(i, col(body[Math.floor(R() * body.length)])); this.ct.setColorAt(i, col(LIVERY[Math.floor(R() * LIVERY.length)]).multiplyScalar(dark ? 0.55 : 1)); this.ch.setColorAt(i, col('#ffffff')); }
    this.n = 0; this.cap = n; this.list = [];
  }
  reset() { this.n = 0; this.list.length = 0; }
  add(x, z, yaw = 0, y = 0, lit = 1, box = true) {
    if (this.n >= this.cap) return; const i = this.n++; const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
    this.tr.setMatrixAt(i, m); this.ch.setMatrixAt(i, m);
    const mc = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeTranslation(0, 2.72 + (box ? 0 : -50), 9.0)); mc.premultiply(new THREE.Matrix4().makeTranslation(x, y, z));
    this.ct.setMatrixAt(i, mc); this.list.push([x, z, yaw, y, lit]);
  }
  commit() { for (const m of [this.tr, this.ch, this.ct]) { m.count = this.n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } }
  lights(Lt, { head = 1, tail = 1, marker = 1, refl = true, front = true, flash = 0 } = {}) {
    for (const [x, z, yaw, y, lit] of this.list) {
      if (!lit) continue; const c = Math.cos(yaw), s = Math.sin(yaw);
      const P = (p) => [x + p[0] * c + p[2] * s, y + p[1], z - p[0] * s + p[2] * c];
      if (front && head) for (const h of RIGL.head) { const q = P(h); const k = head * (1 + flash * 2.5); Lt.add(q[0], q[1], q[2], 1.6 * k, 1.5 * k, 1.35 * k, 0.55 + flash * 0.5); if (refl) Lt.refl(q[0], q[1], q[2], 1.4 * k, 1.3 * k, 1.1 * k, 0.5); }
      if (marker) { for (const h of RIGL.roof) { const q = P(h); Lt.add(q[0], q[1], q[2], 1.3 * marker, 0.55 * marker, 0.1 * marker, 0.16); }
        for (const h of RIGL.side) for (const sx of [1, -1]) { const q = P([h[0] * sx, h[1], h[2]]); Lt.add(q[0], q[1], q[2], 1.1 * marker, 0.45 * marker, 0.05 * marker, 0.13); } }
      if (tail) for (const h of RIGL.tail) { const q = P(h); Lt.add(q[0], q[1], q[2], 1.5 * tail, 0.08 * tail, 0.06 * tail, 0.32); if (refl) Lt.refl(q[0], q[1], q[2], 1.2 * tail, 0.06, 0.05, 0.4); }
    }
  }
}

// flat matte silhouette layers (poster-flat parallax): a long strip drawn once, repeated along the road
function skyline(g, R, x, x1, base, mh) {   // towers with setbacks, crowns, spires and rooftop tanks: never plain boxes
  while (x < x1) { const ww = 22 + R() * 56, hh = 30 + R() * R() * mh, k = R();
    g.fillRect(x, base - hh, ww, hh);
    if (hh > mh * 0.35 && k < 0.45) { const s1 = ww * (0.55 + R() * 0.2); g.fillRect(x + (ww - s1) / 2, base - hh - hh * 0.18, s1, hh * 0.18 + 1); const s2 = s1 * 0.6; g.fillRect(x + (ww - s2) / 2, base - hh - hh * 0.3, s2, hh * 0.12 + 1);
      if (R() < 0.6) g.fillRect(x + ww / 2 - 1.5, base - hh * 1.3 - 40 - R() * 50, 3, 50 + hh * 0.05); }
    else if (hh > mh * 0.25 && k < 0.65) { g.beginPath(); g.moveTo(x, base - hh); g.lineTo(x + ww / 2, base - hh - ww * 0.8); g.lineTo(x + ww, base - hh); g.fill(); }
    else if (k < 0.8) { g.beginPath(); g.ellipse(x + ww * 0.3, base - hh - 14, 8, 8, 0, 3.14, 6.28); g.fill(); g.fillRect(x + ww * 0.3 - 8, base - hh - 14, 16, 14); }
    else { for (let j = 0; j < 3; j++) g.fillRect(x + 4 + j * ww / 3, base - hh - 8 - R() * 8, 4, 16); }
    x += ww + (R() < 0.25 ? 40 + R() * 160 : 2); }
}
function silhouetteTex(kind, seed) {
  const w = 4096, h = 512, c = cv(w, h), g = c.getContext('2d'), R = rng(seed); g.fillStyle = '#fff';
  const base = h - 4; g.fillRect(0, base - 6, w, 10);
  const tree = (x, s) => { g.beginPath(); for (let a = 0; a <= 8; a++) { const r = s * (0.6 + R() * 0.5); g.ellipse(x + (a - 4) * s * 0.35, base - s * 1.1 - Math.sin(a / 8 * 3.14) * s * 0.9, r * 0.6, r * 0.7, 0, 0, 6.28); } g.fill(); g.fillRect(x - s * 0.08, base - s, s * 0.16, s); };
  if (kind === 'near') {                                  // treeline, sound wall, billboards, a water tower
    for (let x = 0; x < w; x += 18 + R() * 30) tree(x, 20 + R() * 30);
    for (let x = 0; x < w; x += 600 + R() * 500) { if (R() < 0.5) continue; const bw = 120 + R() * 60, bh = 60; g.fillRect(x, base - 170, bw, bh); g.fillRect(x + bw * 0.3, base - 115, 6, 115); g.fillRect(x + bw * 0.7, base - 115, 6, 115); for (let k = 0; k < 4; k++) g.fillRect(x + 10 + k * bw / 4, base - 178, 3, 10); }
    const tx = 1300; g.beginPath(); g.ellipse(tx, base - 250, 60, 34, 0, 0, 6.28); g.fill(); g.fillRect(tx - 60, base - 250, 120, 20); for (const dx of [-44, -15, 15, 44]) g.fillRect(tx + dx - 3, base - 230, 6, 230);
    g.lineWidth = 4; g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(tx - 44, base - 60); g.lineTo(tx + 44, base - 150); g.moveTo(tx + 44, base - 60); g.lineTo(tx - 44, base - 150); g.stroke();
  } else if (kind === 'mid') {                            // refinery tank farm, stacks, pylons, warehouses (the Turnpike's own skyline)
    for (let x = 0; x < w; x += 40 + R() * 90) { const t = R();
      if (t < 0.3) { const r = 30 + R() * 40, hh = 30 + R() * 30; g.fillRect(x, base - hh, r * 2, hh); g.beginPath(); g.ellipse(x + r, base - hh, r, 6, 0, 0, 6.28); g.fill(); }
      else if (t < 0.45) { const hh = 120 + R() * 180; g.fillRect(x, base - hh, 8 + R() * 8, hh); }
      else if (t < 0.6) { const hh = 140 + R() * 60; g.beginPath(); g.moveTo(x - 28, base); g.lineTo(x - 5, base - hh); g.lineTo(x + 5, base - hh); g.lineTo(x + 28, base); g.fill(); g.fillRect(x - 36, base - hh * 0.8, 72, 5); g.fillRect(x - 28, base - hh * 0.62, 56, 4); }
      else if (t < 0.8) { const ww = 120 + R() * 180, hh = 30 + R() * 30; g.fillRect(x, base - hh, ww, hh); x += ww; }
      else { const hh = 60 + R() * 60; g.fillRect(x, base - hh, 50, hh); for (let k = 0; k < 4; k++) g.fillRect(x + k * 14, base - hh - 25, 5, 25); } }
  } else if (kind === 'far') {                            // the far skyline: setbacks, crowns, spires, rooftop tanks, masts
    let x = 0; while (x < w) { const ww = 26 + R() * 64, hh = 30 + R() * R() * 300, kind2 = R();
      g.fillRect(x, base - hh, ww, hh);
      if (hh > 120 && kind2 < 0.45) { const s1 = ww * (0.55 + R() * 0.2); g.fillRect(x + (ww - s1) / 2, base - hh - hh * 0.18, s1, hh * 0.18 + 1); const s2 = s1 * 0.6; g.fillRect(x + (ww - s2) / 2, base - hh - hh * 0.3, s2, hh * 0.12 + 1);
        if (R() < 0.6) g.fillRect(x + ww / 2 - 1.5, base - hh * 1.3 - 50 - R() * 60, 3, 60 + hh * 0.05); }
      else if (hh > 90 && kind2 < 0.65) { g.beginPath(); g.moveTo(x, base - hh); g.lineTo(x + ww / 2, base - hh - ww * 0.8); g.lineTo(x + ww, base - hh); g.fill(); }
      else if (kind2 < 0.8) { g.beginPath(); g.ellipse(x + ww * 0.3, base - hh - 14, 8, 8, 0, 3.14, 6.28); g.fill(); g.fillRect(x + ww * 0.3 - 8, base - hh - 14, 16, 14); }
      else { for (let k = 0; k < 3; k++) g.fillRect(x + 4 + k * ww / 3, base - hh - 8 - R() * 8, 4, 16); }
      x += ww + (R() < 0.25 ? 40 + R() * 160 : 2); }
  } else if (kind === 'portfar') {                        // Bayonne arch, far cranes of Elizabeth, the skyline
    g.lineWidth = 10; g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(600, base); g.quadraticCurveTo(1100, base - 520, 1600, base); g.stroke(); g.fillRect(560, base - 150, 1080, 10);
    for (let k = 0; k < 20; k++) g.fillRect(620 + k * 50, base - 150, 3, 150);
    for (let k = 0; k < 7; k++) { const x0 = 2200 + k * 170; g.fillRect(x0, base - 180, 8, 180); g.fillRect(x0 + 60, base - 180, 8, 180); g.fillRect(x0 - 60, base - 190, 200, 10); g.beginPath(); g.moveTo(x0, base - 190); g.lineTo(x0 + 30, base - 260); g.lineTo(x0 + 60, base - 190); g.fill(); }
    skyline(g, R, 3300, w, base, 260);
  }
  const t = texOf(c, true); t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
function silLayer(scene, tex, color, dist, height, side) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(6000, height), new THREE.MeshBasicMaterial({ map: tex, color: col(color), transparent: true, alphaTest: 0.5, fog: false, depthWrite: true }));
  m.material.map = tex; m.userData = { dist, side, height };
  tex.repeat.set(6000 / (height * 8), 1);
  scene.add(m); return m;
}
function placeLayer(m, cz, cx = 0) {
  const { dist, side, height } = m.userData;
  if (side === 0) { m.position.set(cx, height / 2 - 1, cz - dist); m.rotation.y = 0; }
  else { m.position.set(cx + side * dist, height / 2 - 1, cz); m.rotation.y = -side * Math.PI / 2; m.material.map.offset.x = (side * cz / 6000) * m.material.map.repeat.x; }
}

// ================================================================= WORLD 1: the interstate at teal dusk
const HW = new THREE.Scene();
HW.fog = new THREE.FogExp2(col('#2c5256'), 0.0012);
HW.add(mkSky());
const hwDot = mkDot(); HW.add(hwDot);
const hwHemi = new THREE.HemisphereLight(col('#6aa2a2'), col('#1a2224'), 1.1); HW.add(hwHemi);
const hwKey = new THREE.DirectionalLight(col('#e0a070'), 0.6); hwKey.position.set(-1, 0.3, -1); HW.add(hwKey);
const hwGroundMat = groundMat('hw');
const hwGround = new THREE.Mesh(new THREE.PlaneGeometry(400, 3000), hwGroundMat); hwGround.rotation.x = -Math.PI / 2; HW.add(hwGround);
const verge = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshLambertMaterial({ color: col('#1c2a22') })); verge.rotation.x = -Math.PI / 2; verge.position.y = -0.05; HW.add(verge);
// median jersey barrier and the right guardrail (w-beam on posts)
const jersey = new THREE.Mesh(merge([bx(0.6, 0.35, 3000, 0, 0.18, 0, '#9a9c96'), bx(0.25, 0.75, 3000, 0, 0.7, 0, '#a8aaa4')]), vc()); jersey.position.x = -6.65; HW.add(jersey);
const rail = new THREE.Mesh(merge([bx(0.08, 0.32, 3000, 0, 0.72, 0, '#9fa6a8'), bx(0.12, 0.08, 3000, 0.04, 0.72, 0, '#c8ced0')]), vc()); rail.position.x = 10.4; HW.add(rail);
const posts = new THREE.InstancedMesh(bx(0.15, 0.9, 0.15, 0, 0.45, 0, '#6b6f70'), vc(), 400); posts.frustumCulled = false; HW.add(posts);
// light poles on the median, twin arms, sodium heads
const poleG = merge([cyl(0.14, 13, 0, 6.5, 0, '#55595a', 'y', 8, 0.2), bx(7.4, 0.14, 0.14, 0, 12.8, 0, '#55595a'), bx(0.7, 0.18, 0.35, 3.6, 12.65, 0, '#2a2a2a'), bx(0.7, 0.18, 0.35, -3.6, 12.65, 0, '#2a2a2a')]);
const poles = new THREE.InstancedMesh(poleG, vc(), 60); poles.frustumCulled = false; HW.add(poles);
const hwCones = new THREE.InstancedMesh(new THREE.ConeGeometry(7, 12.4, 20, 1, true).translate(0, -6.2, 0), coneMat, 40); hwCones.frustumCulled = false; HW.add(hwCones);
// the gantry: truss over all lanes, sign panel with route shield
const gantry = new THREE.Group();
const trussM = new THREE.MeshLambertMaterial({ color: col('#8a9092'), map: trussTex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
gantry.add(new THREE.Mesh(merge([bx(0.7, 11, 0.7, -8.2, 5.5, 0, '#7f8587'), bx(0.7, 11, 0.7, 11.2, 5.5, 0, '#7f8587'), bx(1.6, 0.6, 1.6, -8.2, 0.3, 0, '#8d8f8a'), bx(1.6, 0.6, 1.6, 11.2, 0.3, 0, '#8d8f8a'),
  bx(20, 0.22, 0.22, 1.5, 10.2, -0.55, '#7f8587'), bx(20, 0.22, 0.22, 1.5, 10.2, 0.55, '#7f8587'), bx(20, 0.22, 0.22, 1.5, 9.0, -0.55, '#7f8587'), bx(20, 0.22, 0.22, 1.5, 9.0, 0.55, '#7f8587')]), vc()));
for (const z of [-0.55, 0.55]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(19.4, 1.2), trussM); trussM.map.repeat.set(10, 1); p.position.set(1.5, 9.6, z); gantry.add(p); }
const signCanvas = cv(2048, 576);
const signTex = texOf(signCanvas); signTex.generateMipmaps = true;
const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 4.5), signMat(signTex)); sign.position.set(1.5, 7.1, 0.7); gantry.add(sign);
const signBack = new THREE.Mesh(bx(16.1, 4.6, 0.12, 1.5, 7.1, 0.58, '#5d6365'), vc()); gantry.add(signBack);
for (const x of [-4.5, 1.5, 7.5]) gantry.add(new THREE.Mesh(bx(0.12, 2.3, 0.12, x, 9.4, 0.62, '#5d6365'), vc()));
HW.add(gantry);
const hwSil = [silLayer(HW, silhouetteTex('near', 3), '#0a1a1d', 140, 52, 1), silLayer(HW, silhouetteTex('near', 4), '#0a1a1d', 140, 52, -1),
  silLayer(HW, silhouetteTex('mid', 5), '#12292d', 420, 150, 1), silLayer(HW, silhouetteTex('mid', 6), '#12292d', 420, 150, -1),
  silLayer(HW, silhouetteTex('far', 7), '#1b3a3e', 1300, 200, 1), silLayer(HW, silhouetteTex('far', 8), '#1b3a3e', 1300, 200, -1), silLayer(HW, silhouetteTex('far', 9), '#24484b', 2600, 260, 0)];
const hwRigs = new Rigs(HW, 40);
const cars = new THREE.InstancedMesh(merge([bx(1.8, 0.7, 4.4, 0, 0.6, 0, '#15181a'), bx(1.6, 0.55, 2.2, 0, 1.2, 0.2, '#0c1012')]), vc(), 60); cars.frustumCulled = false; HW.add(cars);
const hwL = new Lights(3000); HW.add(hwL.obj);

// ================================================================= WORLD 2: Port Newark at night, sodium floodlit
const PT = new THREE.Scene();
PT.fog = new THREE.FogExp2(col('#4a4a3e'), 0.0022);   // sodium haze at blue hour
PT.add(mkSky());
const ptDot = mkDot(); PT.add(ptDot);
PT.add(new THREE.HemisphereLight(col('#4a7a80'), col('#6a4420'), 1.1));
const ptKey = new THREE.DirectionalLight(col('#ff9a48'), 1.5); ptKey.position.set(0.4, 1, 0.3); PT.add(ptKey);
const ptKey2 = new THREE.DirectionalLight(col('#4a8a90'), 0.35); ptKey2.position.set(-0.5, 0.4, -1); PT.add(ptKey2);
const ptGroundMat = groundMat('port'); ptGroundMat.uniforms.lampS.value.set(60, 60); ptGroundMat.uniforms.lampO.value.set(-11, 30); ptGroundMat.uniforms.lampR.value = 26;
ptGroundMat.uniforms.amb.value = col('#34403e'); ptGroundMat.uniforms.sodI.value = 2.6; ptGroundMat.uniforms.fogC.value = col('#4a4a3e'); ptGroundMat.uniforms.fogK.value = 0.0022; ptGroundMat.uniforms.sky.value = col('#8a8068'); ptGroundMat.uniforms.wet.value = 1.0;
const ptGround = new THREE.Mesh(new THREE.PlaneGeometry(1400, 3200), ptGroundMat); ptGround.rotation.x = -Math.PI / 2; ptGround.position.set(0, 0, -500); PT.add(ptGround);
const water = new THREE.Mesh(new THREE.PlaneGeometry(3000, 4000), new THREE.MeshLambertMaterial({ color: col('#071216') })); water.rotation.x = -Math.PI / 2; water.position.set(1600, -2, -600); PT.add(water);
// container yard: blocks of stacks either side of the port road, inside the gate (z < 0)
const yard = (() => {
  const R = rng(2025), items = [];
  for (const side of [-1, 1]) for (let bz = -40; bz > -1500; bz -= 76) for (let row = 0; row < (side > 0 ? 14 : 22); row++) {
    const x = side * (18 + row * 2.9 + Math.floor(row / 7) * 9); if (side > 0 && x > 82) continue;
    for (let k = 0; k < 5; k++) { const z = bz - k * 13; if (R() < 0.06) continue; if (side > 0 && z < -270 && z > -480) continue; /* the apron under the hull lettering */ const hgt = 1 + Math.floor(R() * R() * 5 + (row % 7 === 3 ? 0 : 1)); for (let s = 0; s < Math.min(hgt, 5); s++) items.push([x, 1.3 + s * 2.6, z - 6.1, R()]); }
  }
  const m = new THREE.InstancedMesh(BOXG, contMat, items.length); const M = new THREE.Matrix4();
  items.forEach(([x, y, z, r], i) => { M.makeTranslation(x, y, z); m.setMatrixAt(i, M); const c = col(LIVERY[Math.floor(r * LIVERY.length)]); c.multiplyScalar(0.8 + 0.4 * hash(i)); m.setColorAt(i, c); });
  PT.add(m); return m;
})();
// ship-to-shore cranes along the quay (this piece's hero prop): portal legs, boom truss, machinery house, trolley, spreader
const CRANE_X = 100, CRANES = [-160, -215, -270, -445, -500, -555];   // a gap at z -280..-435: the hull lettering
const craneBody = (() => {
  const red = '#b8321f', wh = '#c9c4b8', dk = '#2b2b2b';
  const L = [];
  for (const x of [-14, 14]) for (const z of [-9, 9]) L.push(bx(1.2, 46, 1.2, x, 23, z, red));
  L.push(bx(30, 1.6, 1.4, 0, 46, -9, red), bx(30, 1.6, 1.4, 0, 46, 9, red), bx(1.4, 1.6, 18, -14, 46, 0, red), bx(1.4, 1.6, 18, 14, 46, 0, red), bx(30, 1.2, 1.2, 0, 14, -9, red), bx(30, 1.2, 1.2, 0, 14, 9, red));
  L.push(bx(110, 1.3, 1.3, 30, 49, -3, wh), bx(110, 1.3, 1.3, 30, 49, 3, wh), bx(110, 0.9, 0.9, 30, 53, -3, wh), bx(110, 0.9, 0.9, 30, 53, 3, wh));
  L.push(bx(1.2, 30, 1.2, -6, 64, 0, wh, 0, 0, 0.25), bx(1.2, 30, 1.2, 6, 64, 0, wh, 0, 0, -0.25), bx(14, 5, 8, -16, 53.5, 0, wh), bx(8, 3, 6, -26, 52, 0, dk));
  // portal bracing (X-braces in every frame), the A-frame stays to boom tip and backreach, stair tower, boom-tip house
  for (const z of [-9, 9]) for (const [y0, y1] of [[14, 30], [30, 46]]) { L.push(rod(-14, y0, z, 14, y1, z, 0.55, red), rod(14, y0, z, -14, y1, z, 0.55, red)); }
  for (const x of [-14, 14]) for (const [y0, y1] of [[14, 30], [30, 46]]) { L.push(rod(x, y0, -9, x, y1, 9, 0.5, red), rod(x, y0, 9, x, y1, -9, 0.5, red)); }
  for (const z of [-3, 3]) { L.push(rod(0, 78, z, 84, 53, z, 0.35, wh), rod(0, 78, z, 50, 53, z, 0.3, wh), rod(0, 78, z, -30, 50, z, 0.35, wh)); }
  for (let x = -26; x <= 84; x += 7.3) { L.push(rod(x, 49, -3, x + 7.3, 53, -3, 0.3, wh), rod(x, 49, 3, x + 7.3, 53, 3, 0.3, wh)); }
  L.push(bx(2.6, 32, 2.6, -17, 30, 10.5, '#5a1a12'), bx(4, 3, 3, 85, 51, 0, wh), bx(2, 1, 22, 0, 14.8, 0, red));
  return merge(L);
})();
const craneM = new THREE.InstancedMesh(craneBody, vc(), CRANES.length); CRANES.forEach((z, i) => craneM.setMatrixAt(i, new THREE.Matrix4().makeTranslation(CRANE_X, 0, z))); PT.add(craneM);
const craneTruss = new THREE.InstancedMesh(new THREE.PlaneGeometry(110, 4), new THREE.MeshLambertMaterial({ color: col('#c9c4b8'), map: (() => { const t = trussTex.clone(); t.repeat.set(26, 1); t.needsUpdate = true; return t; })(), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }), CRANES.length * 2);
CRANES.forEach((z, i) => { craneTruss.setMatrixAt(i * 2, new THREE.Matrix4().makeTranslation(CRANE_X + 30, 51, z - 3)); craneTruss.setMatrixAt(i * 2 + 1, new THREE.Matrix4().makeTranslation(CRANE_X + 30, 51, z + 3)); }); PT.add(craneTruss);
const trolley = new THREE.InstancedMesh(merge([bx(6, 2.4, 7, 0, 0, 0, '#3a3a3a'), bx(0.12, 20, 0.12, -1.5, -11, -2, '#222'), bx(0.12, 20, 0.12, 1.5, -11, 2, '#222'), bx(0.12, 20, 0.12, -1.5, -11, 2, '#222'), bx(0.12, 20, 0.12, 1.5, -11, -2, '#222')]), vc(), CRANES.length); PT.add(trolley);
const spreader = new THREE.InstancedMesh(merge([bx(2.6, 0.8, 12.4, 0, 0, 0, '#c9a21f'), bx(2.44, 2.6, 12.2, 0, -1.7, 0, '#ffffff')]), vc(), CRANES.length); PT.add(spreader);
CRANES.forEach((z, i) => spreader.setColorAt(i, col(LIVERY[i % LIVERY.length])));
// ships alongside: dark hulls, deck stacks, bridge houses
const ships = (() => {
  const L = [bx(44, 34, 330, 0, 13, 0, '#101316'), bx(44.4, 5, 330.4, 0, -1.5, 0, '#5a1812'), bx(34, 22, 14, 0, 41, 120, '#d4d0c6'), bx(20, 8, 10, 0, 56, 120, '#d4d0c6'),
    bx(40, 1.2, 322, 0, 30.6, 0, '#2a2e30')];
  return new THREE.Mesh(merge(L), vc());
})();
ships.position.set(150, 0, -350); ships.material.emissive = col('#1c130b'); PT.add(ships);
const deck = (() => { const R = rng(88), items = []; for (let z = -150; z < 100; z += 12.8) for (let x = -18; x <= 18; x += 2.6) { const hh = 5 + Math.floor(R() * 5); for (let s = 0; s < hh; s++) items.push([150 + x, 32.4 + s * 2.6, -350 + z, R()]); }
  const m = new THREE.InstancedMesh(BOXG, contMat, items.length); items.forEach(([x, y, z, r], i) => { m.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y, z)); m.setColorAt(i, col(LIVERY[Math.floor(r * LIVERY.length)]).multiplyScalar(0.75)); }); PT.add(m); return m; })();
// floodlight masts on a 60 m lattice
const MASTS = []; for (let z = 30; z > -1400; z -= 60) for (const x of [-11, 49, -71]) { if (x === 49 && z < -260 && z > -490) continue; MASTS.push([x, z]); }   // the apron under the hull stays open
const mastM = new THREE.InstancedMesh(merge([cyl(0.35, 34, 0, 17, 0, '#4a4a48', 'y', 8, 0.6), bx(4.4, 1.2, 1.2, 0, 34.2, 0, '#2a2a2a'), bx(4.4, 0.15, 1.8, 0, 33.4, 0, '#3a3a3a')]), vc(), MASTS.length);
MASTS.forEach(([x, z], i) => mastM.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0, z))); PT.add(mastM);
const ptCones = new THREE.InstancedMesh(new THREE.ConeGeometry(16, 34, 24, 1, true).translate(0, -17, 0), coneMat.clone(), MASTS.length);
MASTS.forEach(([x, z], i) => ptCones.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 33.5, z))); ptCones.material.uniforms.k.value = 0.11; PT.add(ptCones);
// the gate complex at z = 0: canopy over 8 inbound lanes, booths, booms
const GATE_Z = 0, LANES = [-13.1, -9.4, -5.6, -1.9, 1.9, 5.6, 9.4, 13.1];
const gateG = (() => { const L = [bx(64, 1.4, 16, 0, 8.4, GATE_Z, '#e6e4de'), bx(64, 0.4, 16.4, 0, 7.6, GATE_Z, '#3a3a3a')];
  for (const x of [-30, -15.2, 0, 15.2, 30]) for (const z of [-6, 6]) L.push(bx(0.5, 7.6, 0.5, x, 3.8, GATE_Z + z, '#9a9a96'));
  for (const x of [-11.25, -7.5, -3.75, 3.75, 7.5, 11.25]) L.push(bx(1.2, 2.6, 2.4, x, 1.3, GATE_Z + 3, '#c8c6c0'), bx(1.25, 0.9, 1.8, x, 1.9, GATE_Z + 3, '#ffd29a'));
  return merge(L); })();
PT.add(new THREE.Mesh(gateG, vc({ emissive: col('#221407') })));
const booms = new THREE.InstancedMesh(merge([bx(3.3, 0.26, 0.2, 1.65, 0, 0, '#f0ebe0'), ...[0, 1, 2].map(k => bx(0.45, 0.28, 0.22, 0.45 + k * 1.1, 0, 0, '#d01818')), bx(0.5, 1.1, 0.5, 0, -0.55, 0, '#d8b020')]), vc({ emissive: col('#3a2a18') }), LANES.length); PT.add(booms);
// the exit gantry at the port exit road (the loop pair): same truss and sign as the interstate one
const EXIT_Z = -1180;
const gantry2 = gantry.clone(); gantry2.position.set(0, 0, EXIT_Z); PT.add(gantry2);
const ptSil = [silLayer(PT, silhouetteTex('portfar', 11), '#1c2a2c', 1800, 420, 0), silLayer(PT, silhouetteTex('mid', 12), '#15191a', 700, 170, -1), silLayer(PT, silhouetteTex('far', 13), '#1f2e30', 1500, 190, -1)];
const ptRigs = new Rigs(PT, 300, true);                  // port rigs: dark bodies, so they read as silhouette and lamps in the haze
const ptL = new Lights(9000); PT.add(ptL.obj);


// ---------------------------------------------------------------- the organisers: people.js on real walking takes (CMU motion capture)
// Hi-vis and rain gear, never front-lit: they walk toward the camera with the queue's headlights behind them.
const MOCAP = '../../sources/mocap/cmu/';
const walkClips = (await Promise.all(['07_01', '08_01', '16_15', '35_01', '02_01', '45_01'].map(k => loadTake(MOCAP + k + '.bvh', { travel: true }))))
  .map(tk => tk.retarget(PEOPLE_MAP, People.RIG));
const folk = new People(PT, { max: 26, viewH: RH, lodPx: [220, 60], budget: [18, 26], shadows: 'none', receiveShadow: false });
const MARCH = [];                                       // { id, x, z0, bearer }
{
  const R = rng(512), trades = ['steel', 'farm', 'rail', 'farm', 'overalls', 'steel'];
  const lay = [[-1.2, 0, 1], [1.2, 0, 1]];              // the two banner bearers, then the column behind them
  for (let k = 0; k < 20; k++) lay.push([(R() - 0.5) * 3.0, 2.8 + Math.floor(k / 4) * 1.5 + R() * 0.6, 0]);
  lay.forEach(([x, z, bearer], i) => {
    const d = People.varied(trades[i % trades.length], 700 + i);
    const id = folk.add(d);
    const st = bearer ? { act: 'walk', gesture: [{ name: 'BANNER_TOP', side: i ? 1 : -1 }, { name: 'BANNER_LOW', side: i ? -1 : 1 }] }
      : { act: 'clip', clip: walkClips[i % walkClips.length], loop: true, twos: true, rootMotion: false, ct: R() * 8 };
    folk.set(id, { heading: Math.PI, ...st }); MARCH.push({ id, x, z, bearer: !!bearer, off: R() * 10 });
  });
}
const poleMat = new THREE.MeshLambertMaterial({ color: col('#2a1e14') });
const bannerPoles = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), poleMat); m.visible = false; PT.add(m); return m; });
function folkHide() { for (const m of folk.meshes) m.visible = false; for (const p of bannerPoles) p.visible = false; for (const M of MARCH) folk.set(M.id, { visible: false }); }

// ---------------------------------------------------------------- type in the world: faces, their structures and their lamps
const faceCache = new Map();
function faceTex(kind, text, o) {
  const k = kind + '|' + text + '|' + JSON.stringify(o || {});
  if (!faceCache.has(k)) { const a = faceArt(kind, text, o); const t = texOf(a.c); const tm = a.m === a.c ? t : texOf(a.m); t.anisotropy = tm.anisotropy = 8; faceCache.set(k, { a, t, tm }); }
  return faceCache.get(k);
}
const faceMat = () => new THREE.ShaderMaterial({
  uniforms: { map: { value: null }, mask: { value: null }, key: { value: new THREE.Color() }, flood: { value: new THREE.Color() }, emis: { value: 0 }, retro: { value: 0 },
    trans: { value: new THREE.Color() }, flash: { value: 0 }, sweep: { value: -9 }, fogC: { value: new THREE.Color() }, fogK: { value: 0.001 }, time: { value: 0 }, wave: { value: 0 } },
  vertexShader: `uniform float time, wave; varying vec2 vU; varying float vD; void main(){ vU = uv; vec3 p = position;
    if (wave > 0.) { float u = uv.x; p.z += wave * (sin(u * 6.5 - time * 5.) * .06 + sin(u * 13. - time * 9. + uv.y * 2.) * .015) * (.3 + .7 * sin(u * 3.14159)); p.y -= wave * .05 * sin(u * 3.14159); }
    vec4 mv = modelViewMatrix * vec4(p, 1.); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform sampler2D map, mask; uniform vec3 key, flood, trans, fogC; uniform float emis, retro, flash, sweep, fogK; varying vec2 vU; varying float vD; ${FOGF}
    void main(){ vec3 a = texture2D(map, vU).rgb; float mk = texture2D(mask, vU).r;
      vec3 c = a * (key + flood * pow(1. - vU.y, 1.4)) + a * emis + a * mk * retro + a * (1. - mk) * trans;
      c += a * mk * exp(-pow((vU.x - sweep) * 4., 2.)) * (retro * 1.4 + .25);
      c += vec3(1., .97, .9) * mk * flash;
      c = mix(c, fogC, fogAmt(vD, fogK) * .85); gl_FragColor = vec4(c, 1.); }`,
  side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
});
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _bm = new THREE.Matrix4();
class Face {
  constructor(scene, segs = 1) { this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, segs, segs > 1 ? 6 : 1), faceMat()); this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 2; scene.add(this.mesh); this.u = this.mesh.material.uniforms; }
  show(kind, text, o) { const f = faceTex(kind, text, o); this.u.map.value = f.t; this.u.mask.value = f.tm; this.art = f.a; this.text = text; this.mesh.visible = true; return this; }
  // centre, width in metres, right and up vectors (the face normal is right x up)
  basis(x, y, z, w, right, up) { _bx.copy(right).normalize(); _by.copy(up).normalize(); _bz.crossVectors(_bx, _by); _bm.makeBasis(_bx, _by, _bz);
    this.mesh.quaternion.setFromRotationMatrix(_bm); this.mesh.position.set(x, y, z); this.mesh.scale.set(w, w / this.art.aspect, 1); this.w = w; this.h = w / this.art.aspect; this.mesh.updateMatrixWorld(); return this; }
  // upright, facing yaw (0 = facing +Z), with a snap: the face swings flat on the hit
  at(x, y, z, w, yaw = 0, tilt = 0) { const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), up = new THREE.Vector3(0, 1, 0).applyAxisAngle(r, -tilt); void n; return this.basis(x, y, z, w, r, up); }
  lit({ key = [0.2, 0.2, 0.2], flood = [0, 0, 0], emis = 0, retro = 0, trans = [0, 0, 0], flash = 0, sweep = -9, fog = ['#2c5256', 0.0012], t = 0, wave = 0 } = {}) {
    const u = this.u; u.key.value.setRGB(...key); u.flood.value.setRGB(...flood); u.emis.value = emis; u.retro.value = retro; u.trans.value.setRGB(...trans); u.flash.value = flash; u.sweep.value = sweep;
    u.fogC.value.set(fog[0]); u.fogK.value = fog[1]; u.time.value = t; u.wave.value = wave; return this; }
  hide() { this.mesh.visible = false; }
  // where the type lands on screen: cap height and line width in output px (the 150 px floor / 70 % width rule)
  metrics() { if (!this.mesh.visible) return null; const P = (u, v) => new THREE.Vector3(u, v, 0).applyMatrix4(this.mesh.matrixWorld).project(cam);
    const a = this.art, l = P(-a.span / 2, 0), r = P(a.span / 2, 0), t = P(0, a.cap / 2), b = P(0, -a.cap / 2);
    return { text: this.text, cap: Math.abs(t.y - b.y) / 2 * H, span: Math.hypot((r.x - l.x) / 2 * W, (r.y - l.y) / 2 * H), cx: (l.x + r.x) / 4 * W + W / 2, lx: (l.x + 1) / 2 * W, rx: (r.x + 1) / 2 * W, behind: l.z > 1 || r.z > 1 }; }
}
const hwFace = new Face(HW), ptFace = new Face(PT), ptBanner = new Face(PT, 40);
// structures: steel posts, catwalks, housings (unit boxes, instanced, set per frame)
class Struct {
  constructor(scene, n = 24) { this.m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: col('#3a3e40') }), n); this.m.frustumCulled = false; this.m.count = 0; scene.add(this.m); this.n = 0; this.cap = n; this.M = new THREE.Matrix4(); }
  reset() { this.n = 0; }
  box(x, y, z, sx, sy, sz, yaw = 0) { if (this.n >= this.cap) return; this.M.makeRotationY(yaw).scale(new THREE.Vector3(sx, sy, sz)).setPosition(x, y, z); this.m.setMatrixAt(this.n++, this.M); }
  post(x, y0, y1, z, w = 0.35) { this.box(x, (y0 + y1) / 2, z, w, y1 - y0, w); }
  commit() { this.m.count = this.n; this.m.instanceMatrix.needsUpdate = true; }
}
const hwStruct = new Struct(HW), ptStruct = new Struct(PT);
// the warehouse whose wall carries MILLIONS BY 2036. (east of the queue, facing it)
const WH = { x: -70, z: 95, w: 44, h: 15, d: 60 };
const warehouse = new THREE.Mesh(merge([bx(WH.d, WH.h, WH.w, WH.x - WH.d / 2, WH.h / 2, WH.z, '#2a2420'), bx(WH.d + 1, 1.2, WH.w + 1, WH.x - WH.d / 2, WH.h + 0.6, WH.z, '#1a1614'),
  ...[0, 1, 2, 3, 4].map(k => bx(0.6, 1.2, 0.8, WH.x + 0.4, WH.h - 0.2, WH.z - WH.w / 2 + 4 + k * 9, '#101010'))]), vc()); PT.add(warehouse);

// ---------------------------------------------------------------- the gantry face (route shield = the four-stripe ACP emblem)
const OV = (s, wt = 900) => `${wt} ${s}px "Overpass"`;
function shield(g, x, y, h) {
  const w = h * 0.92; g.save(); g.translate(x, y);
  const path = () => { g.beginPath(); g.moveTo(-w / 2, -h * 0.42); g.quadraticCurveTo(-w * 0.25, -h * 0.5, 0, -h * 0.44); g.quadraticCurveTo(w * 0.25, -h * 0.5, w / 2, -h * 0.42);
    g.bezierCurveTo(w * 0.56, h * 0.05, w * 0.35, h * 0.35, 0, h * 0.5); g.bezierCurveTo(-w * 0.35, h * 0.35, -w * 0.56, h * 0.05, -w / 2, -h * 0.42); g.closePath(); };
  path(); g.fillStyle = '#f4f2ea'; g.fill(); g.save(); g.scale(0.9, 0.9); path(); g.fillStyle = '#b3121a'; g.fill();
  g.clip(); const gr = g.createLinearGradient(0, -h / 2, 0, h / 2); gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = gr; g.fillRect(-w, -h, 2 * w, 2 * h);
  const E = BRAND.acp_emblem, ew = w * 0.9, eh = ew * E.height / E.width; g.drawImage(tinted(E, '#fbf4e6'), -ew / 2, -h * 0.06 - eh / 2, ew, eh); g.restore();   // v8: larger, so the four stripes stay four through rain, grain and distance
  g.restore();
}
function beads(g, w, h, seed, a = 0.07) {
  const R = rng(seed); g.save();
  for (let k = 0; k < w * h / 180; k++) { g.fillStyle = R() < 0.5 ? `rgba(255,255,255,${a * R()})` : `rgba(0,0,0,${a * R()})`; g.fillRect(R() * w, R() * h, 2, 2); }
  for (let k = 0; k < 30; k++) { const x = R() * w, ll = h * (0.1 + R() * 0.4); const gr = g.createLinearGradient(0, h, 0, h - ll); gr.addColorStop(0, 'rgba(30,20,10,0.35)'); gr.addColorStop(1, 'rgba(30,20,10,0)'); g.fillStyle = gr; g.fillRect(x, h - ll, 3 + R() * 14, ll); }
  g.restore();
}
// ================================================================= BUTTON COPY (lib/fx/type_light.js) in this piece's worlds
// buttonMaterial wants americana_road's Headlights uniforms and atmos3d's uCamPos + lightAt(); this piece has neither
// world, so a thin shim: our own two lamps riding under the camera, and a light field that returns nothing (the port's
// lamps reach the legend only through uAmb). The legend is dark until OUR beams reach it.
const OVF = await loadFace('overpass');
const HL = { uHL0: { value: new THREE.Vector3() }, uHL1: { value: new THREE.Vector3() }, uHLF: { value: new THREE.Vector3(0, 0, -1) }, uHLI: { value: 2200 } };
const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blackTex.needsUpdate = true;
const ATM = { U: { uCamPos: { value: new THREE.Vector3() } } };
const LFS = { U: { tLight: { value: blackTex }, uLightBox: { value: new THREE.Vector4(1e6, 1e6, 1e6 + 1, 1e6 + 1) }, uLightGain: { value: 0 } } };
function headlights(c, drop = 1.25) {                  // the lamps ride 1.25 m under the eye, 0.78 m either side, aimed along the road
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion); f.y = 0; f.normalize(); const rt = new THREE.Vector3(-f.z, 0, f.x);
  [-1, 1].forEach((sd, i) => { const p = c.position.clone().addScaledVector(rt, sd * 0.78).addScaledVector(f, 1.0); p.y -= drop; HL[i ? 'uHL1' : 'uHL0'].value.copy(p); });
  HL.uHLF.value.copy(f); ATM.U.uCamPos.value.copy(c.position);
}
// polygonOffset: the render target's depth is coarse at 60 m, so a panel 3 cm in front of its back plate z-fights in bands
const inFront = m => Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
const btnPanel = (legend, gainB, amb = 0.004) => inFront(buttonMaterial(ATM, LFS, { U: HL }, legend, { gainB, ambient: amb }));
// a small retroreflective plate (the exit tab, the route shield): canvas art on signMat, flared by our beams
function plate(draw, wM, hM, pxPerM = 220) {
  const c = cv(Math.round(wM * pxPerM), Math.round(hM * pxPerM)), g = c.getContext('2d'); draw(g, c.width, c.height);
  const t = texOf(c); t.generateMipmaps = true; const m = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), inFront(signMat(t))); m.material.uniforms.amb.value = 0.06; return m;
}
const tabArt = (label) => (g, w, h) => { g.fillStyle = P.green; g.beginPath(); g.roundRect(0, 0, w, h, h * 0.18); g.fill(); beads(g, w, h, 5);
  g.strokeStyle = P.white; g.lineWidth = h * 0.07; g.beginPath(); g.roundRect(h * 0.1, h * 0.1, w - h * 0.2, h - h * 0.2, h * 0.12); g.stroke();
  let s = h * 0.62; g.font = OV(s); while (g.measureText(label).width > w - h * 0.6) { s -= 2; g.font = OV(s); }
  g.fillStyle = P.white; g.textAlign = 'center'; g.fillText(label, w / 2, h / 2 + g.measureText('H').actualBoundingBoxAscent / 2); };

// the payoff sign bridge over the port exit road: one oversize event panel, WE OWN / TOMORROW in button copy,
// the four-stripe ACP route shield and an EXIT 2036 tab riding on top (the loop rhyme). 7.5 x 4.0 m, bottom at 5.6 m.
const PAY_Z = -1040, PAYX = 1.8, PAYY = 7.6, PAYW = 7.5, PAYH = 4.0;
// the Party's slogan across three bridges in a row (Burma-Shave serial signs): one legend and one material per bridge
const PAYL = {
  'THE FUTURE': buttonCopy(OVF, [{ text: 'THE FUTURE', cap: 1.45 }], { wM: PAYW, hM: PAYH, pxPerM: 300, sx: 0.82, gap: 0.3 }),
  'BELONGS TO': buttonCopy(OVF, [{ text: 'BELONGS TO', cap: 1.45 }], { wM: PAYW, hM: PAYH, pxPerM: 300, sx: 0.82, gap: 0.3 }),
  'THE WORKING CLASS.': buttonCopy(OVF, [{ text: 'THE WORKING', cap: 1.2 }, { text: 'CLASS', cap: 1.55 }], { wM: PAYW, hM: PAYH, pxPerM: 300, sx: 0.82, gap: 0.3 }),
};
const PAYM = Object.fromEntries(Object.entries(PAYL).map(([k, L]) => [k, btnPanel(L, 7.0)]));
const payLegend = PAYL['THE WORKING CLASS.'], payMat = PAYM['THE WORKING CLASS.'];
const payTabL = buttonCopy(OVF, [{ text: 'EXIT 2036', cap: 0.5 }], { wM: 3.4, hM: 0.95, pxPerM: 300, sx: 0.9, border: 0.07 });
const payTabMat = btnPanel(payTabL, 5.0);
const payBridge = new THREE.Group();
payBridge.add(new THREE.Mesh(merge([bx(0.7, 12.6, 0.7, -9.5, 6.3, 0, '#5f6567'), bx(0.7, 12.6, 0.7, 13.1, 6.3, 0, '#5f6567'), bx(1.6, 0.6, 1.6, -9.5, 0.3, 0, '#77796f'), bx(1.6, 0.6, 1.6, 13.1, 0.3, 0, '#77796f'),
  bx(22.6, 0.22, 0.22, 1.8, 12.2, -0.55, '#5f6567'), bx(22.6, 0.22, 0.22, 1.8, 12.2, 0.55, '#5f6567'), bx(22.6, 0.22, 0.22, 1.8, 11.0, -0.55, '#5f6567'), bx(22.6, 0.22, 0.22, 1.8, 11.0, 0.55, '#5f6567'),
  bx(PAYW + 0.1, PAYH + 0.1, 0.14, PAYX, PAYY, 0.3, '#2a2e30'), ...[-2.4, 0, 2.4].map(x => bx(0.12, 3.2, 0.12, PAYX + x, 10.4, 0.5, '#4a4f51'))]), vc()));
for (const z of [-0.55, 0.55]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(22, 1.2), trussM); p.position.set(1.8, 11.6, z); payBridge.add(p); }
const payPanel = new THREE.Mesh(new THREE.PlaneGeometry(PAYW, PAYH), payMat); payPanel.position.set(PAYX, PAYY, 0.64); payBridge.add(payPanel);
const payTab = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.95), payTabMat); payTab.position.set(PAYX + PAYW / 2 - 1.9, PAYY + PAYH / 2 + 0.55, 0.62); payBridge.add(payTab);
payBridge.add(new THREE.Mesh(bx(3.5, 1.05, 0.08, PAYX + PAYW / 2 - 1.9, PAYY + PAYH / 2 + 0.55, 0.3, '#2a2e30'), vc()));
const payShield = plate((g, w, h) => { shield(g, w / 2, h / 2, h * 0.98); }, 1.5, 1.6, 300); payShield.position.set(PAYX - PAYW / 2 + 0.9, PAYY + PAYH / 2 + 0.85, 0.62); payBridge.add(payShield);
payBridge.position.set(0, 0, PAY_Z); PT.add(payBridge);
// drop 1's exit sign on the shoulder: TWELVE YEARS / EARLY in button copy at LOW beam only (dimmer than the payoff),
// with the CHICAGO · 7.21.24 tab (the 2024 date rides as picture text)
const twLegend = buttonCopy(OVF, [{ text: 'TWELVE YEARS', cap: 1.25 }, { text: 'EARLY', cap: 2.0 }], { wM: 9.6, hM: 4.9, pxPerM: 260, sx: 0.8, gap: 0.24 });
const twMat = btnPanel(twLegend, 3.0);
const tryLegend = buttonCopy(OVF, [{ text: 'TRY', cap: 1.1 }, { text: '2024', cap: 2.3 }], { wM: 9.6, hM: 4.9, pxPerM: 260, sx: 0.8, gap: 0.24 });
const tryMat = btnPanel(tryLegend, 3.0);
const twSign = new THREE.Group();
twSign.add(new THREE.Mesh(merge([bx(9.7, 5.0, 0.14, 0, 0, -0.35, '#2a2e30'), bx(0.45, 7.6, 0.45, -3.2, -4.6, -0.35, '#6b7072'), bx(0.45, 7.6, 0.45, 3.2, -4.6, -0.35, '#6b7072')]), vc()));
const twPanel = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 4.9), twMat); twSign.add(twPanel);
const twTab = plate(tabArt('CHICAGO 7.21.24'), 5.4, 0.95, 260); twTab.position.set(2.1, 2.95, 0); twSign.add(twTab);
const sumTab = plate(tabArt('2036 − 2024 = 12'), 5.4, 0.95, 260); sumTab.position.set(2.1, 2.95, 0.005); twSign.add(sumTab);   // the arithmetic is the argument (Guminer's 2 + 2 = 5)
twSign.add(new THREE.Mesh(bx(5.5, 1.05, 0.08, 2.1, 2.95, -0.3, '#2a2e30'), vc()));
twSign.visible = false; HW.add(twSign);
function panelMetrics(mesh, legend, text, li = null) {   // screen cap and span of a button-copy legend (its biggest line, or line li)
  mesh.updateMatrixWorld(); const Lb = legend.block.lines, i = li ?? legend.capsM.indexOf(Math.max(...legend.capsM)), l = Lb[i], P2 = legend.pxPerM;
  const Pt = (x, y) => new THREE.Vector3(x / P2 - legend.wM / 2, legend.hM / 2 - y / P2, 0).applyMatrix4(mesh.matrixWorld).project(cam);
  const cy = (l.bbox.y1 + l.bbox.y2) / 2, cap = legend.capsM[i] * P2, a = Pt(l.bbox.x1, cy), r = Pt(l.bbox.x2, cy), t = Pt((l.bbox.x1 + l.bbox.x2) / 2, cy - cap / 2), bb = Pt((l.bbox.x1 + l.bbox.x2) / 2, cy + cap / 2);
  return { text, cap: Math.abs(t.y - bb.y) / 2 * H, span: Math.abs(r.x - a.x) / 2 * W, lx: (Math.min(a.x, r.x) + 1) / 2 * W, rx: (Math.max(a.x, r.x) + 1) / 2 * W, behind: a.z > 1 };
}

let signCap = 0.4, signSpan = 0.6;
const SIGN_TABS = { 'NEXT EXIT:': 'EXIT 2036', 'A PARTY': 'EXIT 2036', 'OF MILLIONS.': 'EXIT 2036', 'PORT NEWARK.': 'EXIT 13A' };
function drawSign(label) {
  const g = signCanvas.getContext('2d'), w = signCanvas.width, h = signCanvas.height;
  g.fillStyle = P.green; g.fillRect(0, 0, w, h); beads(g, w, h, 12);
  g.strokeStyle = P.white; g.lineWidth = 14; g.beginPath(); g.roundRect(22, 22, w - 44, h - 44, 34); g.stroke();
  shield(g, 225, h / 2 + 4, 430);
  g.fillStyle = P.white; g.textBaseline = 'alphabetic'; let s = 330; g.font = OV(s); while (g.measureText(label).width > w - 480 && s > 60) { s -= 4; g.font = OV(s); }
  const mw = g.measureText(label).width, cap = g.measureText('H').actualBoundingBoxAscent; g.fillText(label, 420 + (w - 460 - mw) / 2, h / 2 + cap / 2);
  signCap = cap / h; signSpan = mw / w;
  const tab = SIGN_TABS[label]; if (tab) {             // the exit tab riding the sign's top edge (NJ Turnpike 13A serves Port Newark)
    g.font = OV(78); const tw = g.measureText(tab).width + 70; g.fillStyle = P.white; g.beginPath(); g.roundRect(w - 60 - tw, 40, tw, 104, 14); g.fill();
    g.fillStyle = P.green; g.fillText(tab, w - 60 - tw + 35, 40 + 52 + g.measureText('H').actualBoundingBoxAscent / 2); }
  for (const [x, y] of [[60, 60], [w - 60, 60], [60, h - 60], [w - 60, h - 60]]) { g.fillStyle = '#c8cfc9'; g.beginPath(); g.arc(x, y, 9, 0, 6.28); g.fill(); }
  signTex.needsUpdate = true;
}
let signLabel = '';
function stripDraw(ctx, src, cx, cy, w, h, yaw) {   // pseudo-3D yaw by vertical strips (the flyer, the CB faceplate)
  const N = yaw ? 40 : 1, D = 1500;
  for (let i = 0; i < N; i++) {
    const u0 = i / N, u1 = (i + 1) / N, X0 = (u0 - 0.5) * w, X1 = (u1 - 0.5) * w, z0 = X0 * Math.sin(yaw), z1 = X1 * Math.sin(yaw);
    const x0 = X0 * Math.cos(yaw) * D / (D + z0), x1 = X1 * Math.cos(yaw) * D / (D + z1), hh = h * D / (D + (z0 + z1) / 2);
    ctx.drawImage(src, u0 * src.width, 0, src.width / N, src.height, cx + x0, cy - hh / 2, x1 - x0 + (N > 1 ? 0.7 : 0), hh);
  }
}

// ---------------------------------------------------------------- 2D foreground art (the cab, the mirror, the poster)
const comp = cv(W, H), cg = comp.getContext('2d');
const tmpC = cv(W, H), tg = tmpC.getContext('2d');
// the client's own poster (sources/acp_own_the_future.jpg): the photograph itself, cropped above its type (its y 0-1700
// of 2048 carries no lettering), is the trucker. A rostrum camera over the print, in the photomontage sense.
const POSTER = await createImageBitmap(await (await fetch('../../sources/acp_own_the_future.jpg')).blob());
const PDOT = [1006, 221];                               // the poster's red dot, in poster px
// the HUMAN c4 film grip on a Class 8 wheel (ownfuture2.hands.js)
const driver = await makeDriver({ k: 1.45, hubX: 600, hubY: 1420 });
function rimFill(g, path, fill, rim, rw = 3, dx = 0, dy = -2) {   // silhouette fill + a thin light rim on one side
  g.save(); g.fillStyle = rim; g.translate(dx, dy); g.fill(path); g.restore();
  g.save(); g.fillStyle = fill; g.translate(-dx * 0.2, -dy * 0.2 + rw * 0.2); g.fill(path); g.restore();
}
// the trucker in profile, looking up (proportions traced from the client's poster, never its pixels): a soft
// six-panel BASEBALL cap (rounded crown, button, a long curved bill), brow, nose, lips, chin, collar. One opaque flat
// silhouette, lit only by the sky behind it: no rim outline, no glow. 1080x1920 frame coords; tilt lifts the head.
const TRK = [['M', -60, 1990], ['L', -60, 1860], ['C', 0, 1840, 50, 1810, 62, 1770],
  ['C', 40, 1700, 22, 1600, 30, 1520], ['C', 34, 1460, 40, 1430, 52, 1410],                        // back of the skull to the cap band
  ['C', 70, 1320, 160, 1262, 270, 1254], ['C', 370, 1248, 440, 1285, 462, 1345],                   // the soft crown
  ['C', 520, 1352, 610, 1362, 668, 1380], ['C', 684, 1386, 686, 1396, 672, 1400], ['C', 610, 1404, 530, 1402, 478, 1412],   // the bill
  ['C', 486, 1428, 490, 1446, 494, 1462], ['C', 498, 1478, 505, 1486, 512, 1494],                  // brow under the bill
  ['C', 530, 1520, 556, 1552, 574, 1572], ['C', 582, 1582, 578, 1592, 564, 1595],                  // nose
  ['C', 556, 1600, 556, 1610, 562, 1618], ['C', 568, 1626, 567, 1634, 560, 1638],                  // lip
  ['C', 556, 1642, 559, 1648, 564, 1654], ['C', 567, 1664, 563, 1670, 556, 1674],                  // mouth, lower lip
  ['C', 559, 1690, 568, 1706, 566, 1718], ['C', 562, 1734, 540, 1742, 512, 1744],                  // chin (stubble line)
  ['C', 480, 1748, 452, 1770, 440, 1800], ['C', 436, 1830, 450, 1850, 480, 1860],                  // throat
  ['L', 560, 1878], ['C', 660, 1900, 760, 1940, 820, 1995], ['L', -60, 1995]];                     // jacket collar, shoulder
function truckerPath(s = 1, ox = 0, oy = 0, tilt = 0.2) {
  const p = new Path2D(), px = 300, py = 1800, c = Math.cos(-tilt), sn = Math.sin(-tilt);
  const P2 = (x, y) => { const w = clamp((1840 - y) / 60); const a = -tilt * w, ca = Math.cos(a), sa = Math.sin(a); void c; void sn;
    const X = px + (x - px) * ca - (y - py) * sa, Y = py + (x - px) * sa + (y - py) * ca; return [ox + X * s, oy + Y * s]; };
  for (const [k, ...v] of TRK) { if (k === 'M') p.moveTo(...P2(v[0], v[1])); else if (k === 'L') p.lineTo(...P2(v[0], v[1])); else p.bezierCurveTo(...P2(v[0], v[1]), ...P2(v[2], v[3]), ...P2(v[4], v[5])); }
  p.closePath(); const [bx0, by0] = P2(266, 1250); p.ellipse(bx0, by0, 13 * s, 8 * s, -tilt, 0, 6.28);   // the cap's button
  return p;
}
function drawTrucker(g, s, ox, oy, tilt = 0.2) { g.save(); g.fillStyle = '#040606'; g.fill(truckerPath(s, ox, oy, tilt)); g.restore(); }
// a work glove as one silhouette (never fingers): knuckle ridge, thumb, cuff; a thin sodium rim on the knuckles only
function drawGlove(g, x, y, sc, rot, rimC = 'rgba(255,160,80,0.55)', sq = 0) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(sc * (1 - sq * 0.03), sc);
  const p = new Path2D(); p.moveTo(-95, 120); p.lineTo(-95, 40); p.bezierCurveTo(-112, 20, -120, -12, -102, -30); p.bezierCurveTo(-94, -42, -82, -46, -70, -44);
  const k = new Path2D(); k.moveTo(-70, -44);
  for (let i = 0; i < 4; i++) { const x0 = -70 + i * 40; p.quadraticCurveTo(x0 + 20, -66 - (i === 1 ? 4 : 0), x0 + 40, -46); k.quadraticCurveTo(x0 + 20, -66 - (i === 1 ? 4 : 0), x0 + 40, -46); }
  p.bezierCurveTo(102, -40, 108, -10, 100, 20); p.lineTo(94, 120); p.closePath();
  g.fillStyle = '#050606'; g.fill(p); g.strokeStyle = rimC; g.lineWidth = 3 / sc; g.stroke(k); g.restore();
}
// the break, first half: from behind the driver's shoulder, the wheel rim and a gloved hand against the lit glass
function drawWheel(g, F, t) {
  const { text, age } = F, sq = text === 'THE MACHINES?' ? Math.exp(-age * 5) : 0;
  drawPillars(g, 1, 'rgba(255,150,70,0.28)');
  g.save(); const dg = g.createLinearGradient(0, 1450, 0, H); dg.addColorStop(0, '#0b0f10'); dg.addColorStop(0.06, '#050707'); dg.addColorStop(1, '#030404'); g.fillStyle = dg;
  g.beginPath(); g.moveTo(-10, 1680); g.bezierCurveTo(300, 1640, 780, 1650, W + 10, 1690); g.lineTo(W + 10, H + 10); g.lineTo(-10, H + 10); g.fill();
  const cx = W * 0.6, cy = 1930, rx = 640, ry = 520;
  g.lineWidth = 74; g.strokeStyle = '#040505'; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, Math.PI * 1.02, Math.PI * 1.98); g.stroke();
  g.lineWidth = 3; g.strokeStyle = 'rgba(255,160,80,0.35)'; g.beginPath(); g.ellipse(cx, cy - 34, rx - 4, ry - 30, 0, Math.PI * 1.12, Math.PI * 1.7); g.stroke();
  const a = Math.PI * 1.5 - 0.42, hx = cx + Math.cos(a) * rx, hy = cy + Math.sin(a) * ry, tang = Math.atan2(Math.cos(a) * ry, -Math.sin(a) * rx);
  g.fillStyle = '#040505'; g.save(); g.translate(hx, hy + 20); g.rotate(tang + Math.PI + 0.15); g.fillRect(-80, 100, 170, 700); g.restore();   // the jacket cuff and forearm, off the bottom edge
  drawGlove(g, hx, hy + 20 + sq * 3, 1.2, tang + Math.PI, 'rgba(255,160,80,0.55)', sq);
  g.restore();
}
function drawMirror(g, x, y, w, h, s = 1, content = null, frameC = '#0a0c0c', rimC = '#6aa0a0') {   // west-coast mirror on its arm
  g.save(); g.lineCap = 'round';
  g.strokeStyle = frameC; g.lineWidth = 12 * s; g.beginPath(); g.moveTo(x + w * 0.5, y - 14 * s); g.lineTo(W + 40, y - 14 * s); g.moveTo(x + w * 0.5, y + h + 14 * s); g.lineTo(W + 40, y + h + 40 * s); g.stroke();
  g.strokeStyle = rimC; g.globalAlpha = 0.35; g.lineWidth = 2 * s; g.beginPath(); g.moveTo(x + w * 0.5, y - 20 * s); g.lineTo(W + 40, y - 20 * s); g.stroke(); g.globalAlpha = 1;
  g.fillStyle = frameC; g.beginPath(); g.roundRect(x - 16 * s, y - 16 * s, w + 32 * s, h + 32 * s, 26 * s); g.fill();
  g.beginPath(); g.roundRect(x, y, w, h, 18 * s); g.save(); g.clip();
  if (content) content(g, x, y, w, h); else { g.fillStyle = '#0c1a1c'; g.fillRect(x, y, w, h); }
  const gr = g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(0.4, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.3)'); g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.restore();
  g.strokeStyle = rimC; g.globalAlpha = 0.6; g.lineWidth = 2.5 * s; g.beginPath(); g.roundRect(x - 16 * s, y - 16 * s, w + 32 * s, h + 32 * s, 26 * s); g.stroke(); g.globalAlpha = 1;
  for (const [bx_, by_] of [[x + w * 0.5, y - 16 * s], [x + w * 0.5, y + h + 16 * s]]) { g.fillStyle = '#20282a'; g.beginPath(); g.arc(bx_, by_, 9 * s, 0, 6.28); g.fill(); g.fillStyle = rimC; g.globalAlpha = 0.7; g.beginPath(); g.arc(bx_ - 2 * s, by_ - 2 * s, 3 * s, 0, 6.28); g.fill(); g.globalAlpha = 1; }
  g.restore();
}
// the cab interior from the driver's seat: dash, gauges with amber backlight and live needles, wheel, gloves
function drawCab(g, { mph = 60, rpm = 0.5, lean = 0, hands = 1, cb = 0, horn = 0, amber = 1, t = 0, dashY = 1430, wheel = 1, hood = 1, zoom = 1, glove: o_glove = 0 }) {
  g.save(); if (zoom !== 1) { g.translate(W / 2, dashY + 294 - 330); g.scale(zoom, zoom); g.translate(-W / 2, -(dashY + 294)); } g.translate(W / 2, dashY); g.rotate(lean); g.translate(-W / 2, -dashY);
  if (hood) {                                           // the long hood running out ahead, sky on its crown
    const hp = new Path2D(); hp.moveTo(170, dashY + 20); hp.lineTo(360, dashY - 110); hp.lineTo(720, dashY - 110); hp.lineTo(910, dashY + 20); hp.closePath();
    const gr = g.createLinearGradient(0, dashY - 110, 0, dashY); gr.addColorStop(0, '#2c4446'); gr.addColorStop(0.1, '#0d1516'); gr.addColorStop(1, '#070a0a'); g.fillStyle = gr; g.fill(hp);
    g.fillStyle = '#b8c0bc'; g.fillRect(528, dashY - 132, 24, 22); g.fillStyle = 'rgba(255,190,110,0.8)'; g.fillRect(534, dashY - 128, 12, 6);   // hood ornament
  }
  const dp = new Path2D(); dp.moveTo(-40, dashY - 30); dp.bezierCurveTo(300, dashY - 70, 780, dashY - 70, W + 40, dashY - 30); dp.lineTo(W + 40, H + 700); dp.lineTo(-40, H + 700); dp.closePath();
  const dg = g.createLinearGradient(0, dashY - 70, 0, H); dg.addColorStop(0, '#1b2224'); dg.addColorStop(0.05, '#0b0d0e'); dg.addColorStop(1, '#040505'); g.fillStyle = dg; g.fill(dp);
  g.strokeStyle = 'rgba(120,170,168,0.35)'; g.lineWidth = 3; g.beginPath(); g.moveTo(-40, dashY - 30); g.bezierCurveTo(300, dashY - 70, 780, dashY - 70, W + 40, dashY - 30); g.stroke();
  const gauge = (cx, cy, r, v, lbl, n = 9) => {
    g.save(); const gr = g.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.25); gr.addColorStop(0, `rgba(255,150,40,${0.18 * amber})`); gr.addColorStop(1, 'rgba(255,150,40,0)'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r * 1.25, 0, 6.28); g.fill();
    g.fillStyle = '#060707'; g.beginPath(); g.arc(cx, cy, r, 0, 6.28); g.fill();
    g.strokeStyle = '#6d7472'; g.lineWidth = r * 0.07; g.beginPath(); g.arc(cx, cy, r, 0, 6.28); g.stroke();
    g.strokeStyle = 'rgba(230,240,236,0.5)'; g.lineWidth = r * 0.03; g.beginPath(); g.arc(cx, cy, r * 1.01, -2.6, -1.6); g.stroke();
    g.strokeStyle = `rgba(255,170,60,${0.9 * amber})`; g.fillStyle = `rgba(255,178,80,${0.95 * amber})`; g.font = `700 ${Math.round(r * 0.2)}px "Plex Mono"`; g.textAlign = 'center';
    for (let k = 0; k <= n * 2; k++) { const a = -Math.PI * 1.25 + k / (n * 2) * Math.PI * 1.5, big = k % 2 === 0; g.lineWidth = big ? r * 0.045 : r * 0.022;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r * (big ? 0.72 : 0.8), cy + Math.sin(a) * r * (big ? 0.72 : 0.8)); g.lineTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9); g.stroke();
      if (big && r > 60) g.fillText(String(k / 2 * (lbl === 'MPH' ? 10 : 5)), cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55 + r * 0.07); }
    g.font = `700 ${Math.round(r * 0.16)}px "Plex Mono"`; g.fillText(lbl, cx, cy + r * 0.45);
    const a = -Math.PI * 1.25 + clamp(v) * Math.PI * 1.5; g.strokeStyle = '#ff5a1e'; g.lineWidth = r * 0.05; g.lineCap = 'round'; g.shadowColor = '#ff5a1e'; g.shadowBlur = 12;
    g.beginPath(); g.moveTo(cx - Math.cos(a) * r * 0.12, cy - Math.sin(a) * r * 0.12); g.lineTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82); g.stroke();
    g.shadowBlur = 0; g.fillStyle = '#1a1c1c'; g.beginPath(); g.arc(cx, cy, r * 0.09, 0, 6.28); g.fill(); g.restore();
  };
  gauge(385, dashY + 150, 118, mph / 90, 'MPH'); gauge(695, dashY + 150, 118, rpm, 'RPM', 6);
  for (const [i, v] of [[0, 0.6], [1, 0.45], [2, 0.7], [3, 0.35]]) gauge(160 + i * 253 + (i > 1 ? 0 : 0), dashY + 330, 52, v + Math.sin(t * 0.7 + i) * 0.01, ['OIL', 'AIR', 'FUEL', 'VOLT'][i], 4);
  // the CB radio under the dash
  g.fillStyle = '#0e1011'; g.fillRect(760, dashY + 420, 250, 70); g.fillStyle = `rgba(255,70,30,${0.9 * amber})`; g.font = '700 30px "Plex Mono"'; g.fillText('CH 19', 820, dashY + 466);
  if (wheel) {
    const wy = dashY + 470, rx = 470, ry = 250;
    g.lineWidth = 58; g.strokeStyle = '#0a0b0b'; g.beginPath(); g.ellipse(W / 2, wy, rx, ry, 0, Math.PI * 1.03, Math.PI * 1.97); g.stroke();
    g.lineWidth = 6; g.strokeStyle = 'rgba(110,160,158,0.45)'; g.beginPath(); g.ellipse(W / 2, wy - 24, rx - 6, ry - 20, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    g.lineWidth = 3; g.strokeStyle = `rgba(255,150,60,${0.25 * amber})`; g.beginPath(); g.ellipse(W / 2, wy + 22, rx - 20, ry - 34, 0, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    if (hands) for (const sx of [-1, 1]) {                // gloved hands at ten and two: four fingers wrapped over the rim, thumb along it
      const ang = Math.PI * 1.5 + sx * 0.78, hx = W / 2 + Math.cos(ang) * rx, hy = wy + Math.sin(ang) * ry;
      const tang = Math.atan2(Math.cos(ang) * ry, -Math.sin(ang) * rx);
      g.save(); g.translate(hx, hy); g.rotate(tang);
      g.fillStyle = '#23180f'; g.beginPath(); g.ellipse(0, 52, 70, 60, 0, 0, 6.28); g.fill();                  // back of the hand, below the rim
      for (let k = 0; k < 4; k++) {                                                                          // fingers over the rim
        const fx = -45 + k * 30; const fp = new Path2D(); fp.roundRect(fx - 14, -36, 28, 76, 13);
        const fg = g.createLinearGradient(0, -36, 0, 40); fg.addColorStop(0, '#6a4e34'); fg.addColorStop(0.35, '#3b2a1b'); fg.addColorStop(1, '#1a120b');
        g.fillStyle = fg; g.fill(fp); g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 2.5; g.stroke(fp);
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(fx - 12, -6); g.lineTo(fx + 12, -6); g.moveTo(fx - 12, 16); g.lineTo(fx + 12, 16); g.stroke();
        g.fillStyle = 'rgba(160,200,196,0.35)'; g.beginPath(); g.ellipse(fx - 3, -26, 7, 4, 0, 0, 6.28); g.fill();
      }
      g.fillStyle = '#35261a'; g.beginPath(); g.ellipse(-sx * 70, 18, 16, 44, sx * 1.2, 0, 6.28); g.fill();   // thumb
      g.strokeStyle = 'rgba(210,190,160,0.28)'; g.setLineDash([3, 4]); g.lineWidth = 1.6; g.beginPath(); g.ellipse(0, 52, 60, 50, 0, 3.6, 5.8); g.stroke(); g.setLineDash([]);
      g.restore();
    }
  }
  if (wheel && o_glove) { const wy = dashY + 470, a = Math.PI * 1.5 + 0.62, hx = W / 2 + Math.cos(a) * 470, hy = wy + Math.sin(a) * 250; drawGlove(g, hx, hy + 18, 0.9, Math.atan2(Math.cos(a) * 250, -Math.sin(a) * 470) + Math.PI); }
  g.restore();
  if (cb) {                                              // keying the CB: a handheld mic in a gloved fist, coiled cord to the radio, TX lamp lit
    const x = 330 + (1 - cb) * -200, y = 1180 + (1 - cb) * 300; g.save();
    g.strokeStyle = '#0c0c0c'; g.lineWidth = 8; g.beginPath(); g.moveTo(820, dashY + 455);
    for (let k = 0; k < 40; k++) { const u = k / 39; g.lineTo(lerp(820, x + 10, u) + Math.sin(k * 2.4) * 16, lerp(dashY + 455, y + 150, u) + Math.cos(k * 2.4) * 10); } g.stroke();
    g.translate(x, y); g.rotate(-0.25);
    const mp = new Path2D(); mp.roundRect(-58, -120, 116, 250, 50); const mg = g.createLinearGradient(-58, 0, 58, 0); mg.addColorStop(0, '#2a2e30'); mg.addColorStop(0.3, '#121415'); mg.addColorStop(1, '#070808');
    g.fillStyle = mg; g.fill(mp); g.strokeStyle = 'rgba(140,190,186,0.55)'; g.lineWidth = 2.5; g.stroke(mp);
    g.fillStyle = '#050505'; for (let k = 0; k < 6; k++) for (let j = 0; j < 4; j++) { g.beginPath(); g.arc(-27 + j * 18, -92 + k * 15, 3.4, 0, 6.28); g.fill(); }
    g.fillStyle = '#ff2a14'; g.shadowColor = '#ff2a14'; g.shadowBlur = 14; g.beginPath(); g.arc(30, -2, 5, 0, 6.28); g.fill(); g.shadowBlur = 0;
    for (let k = 0; k < 4; k++) { const fy = -10 + k * 30; const fp = new Path2D(); fp.roundRect(-78, fy, 150, 27, 13);               // fingers around the grip
      const fg = g.createLinearGradient(0, fy, 0, fy + 27); fg.addColorStop(0, '#6a4e34'); fg.addColorStop(0.4, '#3b2a1b'); fg.addColorStop(1, '#1a120b'); g.fillStyle = fg; g.fill(fp);
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 2; g.stroke(fp); g.fillStyle = 'rgba(160,200,196,0.3)'; g.beginPath(); g.ellipse(50, fy + 7, 10, 3, 0, 0, 6.28); g.fill(); }
    g.fillStyle = '#35261a'; g.beginPath(); g.ellipse(-70, 40, 22, 60, 0.3, 0, 6.28); g.fill();
    g.fillStyle = '#23180f'; g.beginPath(); g.ellipse(-110, 120, 60, 110, 0.4, 0, 6.28); g.fill();
    g.restore();
  }
  if (horn) {                                             // the air-horn lanyard from the headliner, pulled
    const x = 760, y0 = 0, y1 = 420 + horn * 260; g.save(); g.strokeStyle = '#1a1512'; g.lineWidth = 10; g.beginPath(); g.moveTo(x, y0); g.lineTo(x - 20, y1); g.stroke();
    g.fillStyle = '#3a2a1c'; g.beginPath(); g.ellipse(x - 22, y1 + 80, 88, 120, 0.1, 0, 6.28); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 3; for (const k of [-45, -15, 15, 45]) { g.beginPath(); g.moveTo(x - 22 + k, y1 + 10); g.lineTo(x - 22 + k * 0.8, y1 + 150); g.stroke(); }
    g.strokeStyle = 'rgba(150,190,184,0.45)'; g.lineWidth = 4; g.beginPath(); g.ellipse(x - 22, y1 + 80, 88, 120, 0.1, 3.4, 4.6); g.stroke(); g.restore();
  }
}
function drawPillars(g, amt = 1, rimC = 'rgba(110,160,158,0.5)') {   // A-pillars and the header, the windshield's frame
  g.save(); g.fillStyle = '#050606';
  const l = new Path2D(); l.moveTo(-10, -10); l.lineTo(120, -10); l.lineTo(40, 1400); l.lineTo(-10, 1400); l.closePath(); g.fill(l);
  const r = new Path2D(); r.moveTo(W + 10, -10); r.lineTo(W - 120, -10); r.lineTo(W - 40, 1400); r.lineTo(W + 10, 1400); r.closePath(); g.fill(r);
  g.fillRect(-10, -10, W + 20, 90); g.strokeStyle = rimC; g.lineWidth = 3; g.beginPath(); g.moveTo(120, 80); g.lineTo(40, 1400); g.moveTo(W - 120, 80); g.lineTo(W - 40, 1400); g.moveTo(120, 80); g.lineTo(W - 120, 80); g.stroke();
  g.restore();
}
// rain: slanted streaks, stateless per frame
function rain(g, frame, n, alpha, slant = 0.12, len = 60, lit = 'rgba(200,230,228,') {
  g.save(); g.lineWidth = 1.6; g.lineCap = 'round';
  for (let i = 0; i < n; i++) { const h1 = hash(i * 13.1 + frame * 1.37), h2 = hash(i * 7.7 + frame * 2.11), h3 = hash(i * 3.3 + frame * 0.73);
    const x = h1 * (W + 200) - 100, y = h2 * (H + 200) - 100, l = len * (0.4 + h3);
    g.strokeStyle = lit + (alpha * (0.3 + 0.7 * h3)).toFixed(3) + ')'; g.beginPath(); g.moveTo(x, y); g.lineTo(x - slant * l, y + l); g.stroke(); }
  g.restore();
}

// ---------------------------------------------------------------- windshield pass (droplets refract the frame, grime catches the glare)
const passMat = new THREE.ShaderMaterial({
  uniforms: { tS: { value: rt.texture }, tD: { value: dropTex }, tG: { value: grimeTex }, drop: { value: 0 }, grime: { value: 0 }, rainA: { value: 0 }, time: { value: 0 }, slant: { value: 0.1 }, off: { value: new THREE.Vector2() }, asp: { value: RW / RH }, sharp: { value: 0.35 }, px: { value: new THREE.Vector2(1 / RW, 1 / RH) } },
  vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: `uniform sampler2D tS, tD, tG; uniform float drop, grime, asp, sharp, rainA, time, slant; uniform vec2 off, px; varying vec2 vU;
    float h1(float n){ return fract(sin(n * 91.345) * 47453.5453); }
    // rain in the light: sparse streak columns, each drop only visible where the frame behind it is lit (sodium cones, headlights)
    float rainL(vec2 uv, float cols, float spd, float len, float seed){ vec2 p = vec2((uv.x + (1. - uv.y) * slant) * cols, uv.y); float c = floor(p.x), r = h1(c + seed);
      float y = fract(p.y * (0.7 + r * .6) + time * spd * (0.8 + r * .5) + r * 13.); float fx = abs(fract(p.x) - .5);
      return step(.62, h1(c * 1.7 + seed + 3.)) * smoothstep(len, 0., y) * smoothstep(0., .015, y) * smoothstep(.5, .1, fx); }
    void main(){ vec2 uv = vU; vec3 c;
      vec4 d = texture2D(tD, vec2(uv.x * asp, uv.y) * 1.6 + off); vec4 d2 = texture2D(tD, vec2(uv.x * asp, uv.y) * 0.9 + off * 0.5 + .31);
      float m = max(d.b, d2.b * .9) * drop; vec2 n = ((d.b > d2.b ? d.rg : d2.rg) - .5) * 2.;
      vec2 suv = uv - n * m * vec2(.05, .03) * .8;
      c = texture2D(tS, suv).rgb;
      vec3 blur = (texture2D(tS, uv + px * vec2(1.5, 0.)).rgb + texture2D(tS, uv - px * vec2(1.5, 0.)).rgb + texture2D(tS, uv + px * vec2(0., 1.5)).rgb + texture2D(tS, uv - px * vec2(0., 1.5)).rgb) * .25;
      c += (c - blur) * sharp * (1. - m);
      c *= 1. - .3 * m * smoothstep(.5, 1., length(n)); c += m * .012 * vec3(.6, .8, .8);
      float g = texture2D(tG, uv).r * grime;
      vec3 glare = (texture2D(tS, uv + vec2(.05, 0.)).rgb + texture2D(tS, uv - vec2(.05, 0.)).rgb + texture2D(tS, uv + vec2(0., .035)).rgb + texture2D(tS, uv - vec2(0., .035)).rgb + texture2D(tS, uv).rgb) * .2;
      c += g * (glare * 1.5 + vec3(.012, .02, .02));
      if (rainA > 0.) { float lum = dot(glare, vec3(.3, .5, .2)); float rr = rainL(uv, 260., 2.6, .09, 1.) * .7 + rainL(uv, 140., 1.9, .14, 7.) + rainL(uv, 70., 1.3, .2, 13.) * .8;
        c += rr * rainA * (glare * 2.4) * smoothstep(.12, .6, lum); }
      gl_FragColor = vec4(c, 1.); }`,
  depthTest: false, depthWrite: false,
});
const passScene = new THREE.Scene(); const passQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), passMat); passQuad.frustumCulled = false; passScene.add(passQuad);
const passCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// ---------------------------------------------------------------- post: the anamorphic lens
const post = new Post(W, H);
const lensOpts = (o) => ({                             // v7: no bloom, no streaks; halation only on true highlights; the hit's chroma ghost in lens.ca
  ...(o.hal === 0 ? {} : { halation: { amount: 0.15, tint: [1, 0.35, 0.12], threshold: 0.9 } }),
  lens: { distort: o.distort ?? 0.02, ca: o.ca || 0 },          // v8: no standing chroma split (it fringed every sign); only the hit's ghost
  film: { tonemap: 0, exposure: o.expo ?? -0.2, contrast: 0.18, sat: o.sat ?? 1.06, split: { shadows: [0.18, 0.4, 0.42], highlights: [0.78, 0.55, 0.36], amount: 0.35 }, fade: 0 },   // v8: the ACES curve off (it greyed v7: median 42, whites capped at 231)
  vignette: { amount: 0.25, inner: 0.35, outer: 1.0 }, grain: { amount: 0.45, size: 1.3, chroma: 0.2 }, seed: 13,
});
const finish = new Finish(130);

// ================================================================= world state per frame
const V = 26;                                         // interstate cruising speed, m/s
// the convoy's answer on every EARLY. hit: the marker lights blink twice (off-on, off-on: the trucker's 'thank you')
const markerAt = (t) => { const b = B.beat(t + 0.5 / 30); let h = -1; for (const e of EARLY_HITS) if (b >= e) h = e; if (h < 0) return 1;
  const f = Math.round((t - h * SPB) * 30); return f < 0 || f > 9 ? 1 : [0, 0, 2.6, 2.6, 0, 0, 2.6, 2.6, 1.4, 1.2][f]; };
const convoyN = (b) => b < 6 ? 0 : b < 10 ? 1 : b < 26 ? Math.min(9, 1 + Math.floor(b - 9)) : 10;   // mirror-count build: one more pair per beat
function hwWorld(t, b, o) {
  const rz = o.rz, rx = o.rx ?? 1.8;                 // our rig: front axle position
  hwGroundMat.uniforms.rig.value.set(rx, 0, rz); hwGroundMat.uniforms.head.value = o.head ?? 1;
  const cz = cam.position.z;
  hwGround.position.set(0, 0, cz - 1000); verge.position.set(0, -0.05, cz - 1000); jersey.position.z = cz - 1200; rail.position.z = cz - 1200;
  const M = new THREE.Matrix4();
  const p0 = Math.floor(cz / 2) * 2; for (let i = 0; i < 400; i++) { M.makeTranslation(10.45, 0, p0 + 60 - i * 2); posts.setMatrixAt(i, M); } posts.instanceMatrix.needsUpdate = true;
  hwL.reset();
  const l0 = Math.floor(cz / 50) * 50;
  for (let i = 0; i < 40; i++) { const z = l0 + 150 - i * 50; const gap = o.poleGap && z > o.poleGap[0] && z < o.poleGap[1]; M.makeTranslation(-6.65, gap ? -200 : 0, z); poles.setMatrixAt(i, M); if (gap) { M.makeTranslation(0, -200, 0); hwCones.setMatrixAt(i, M); continue; }
    for (const sx of [-1, 1]) { const x = -6.65 + sx * 3.6; hwL.add(x, 12.5, z, 1.5, 0.75, 0.25, 1.1); hwL.refl(x, 12.5, z, 1.3, 0.6, 0.2, 1.1, 0.35); }
    M.makeTranslation(-6.65 + 3.6, 12.6, z); hwCones.setMatrixAt(i, M); }
  poles.count = 40; poles.instanceMatrix.needsUpdate = true; hwCones.count = 40; hwCones.instanceMatrix.needsUpdate = true;
  for (const m of hwSil) { placeLayer(m, cz, 0); m.visible = o.sil !== false; }
  // the gantry
  gantry.position.set(0, 0, o.gz ?? 1e5); gantry.visible = o.gz !== undefined;
  if (o.sign && o.sign !== signLabel) { drawSign(o.sign); signLabel = o.sign; }
  const gd = Math.abs(cz - (o.gz ?? 1e5)); sign.material.uniforms.flare.value = Math.min(0.6, (o.flare ?? 1) * clamp(30 / (gd + 4)) * 0.8); sign.material.uniforms.sweep.value = o.sweep ?? -1;
  // rigs: ours, then the convoy behind, then parked ones
  hwRigs.reset();
  if (o.own !== false) hwRigs.add(rx, rz, 0, 0, 1);
  const n = o.convoy ?? 0;
  for (let i = 0; i < n; i++) { const lane = [-1.8, 5.4, 1.8][i % 3]; const z = rz + 18 + i * 14 + (i % 3) * 5 + Math.sin(t * 0.7 + i) * 1.2; hwRigs.add(lane, z, 0, 0, 1); }
  for (const [x, z] of (o.extra || [])) hwRigs.add(x, z, 0, 0, 1);
  hwRigs.commit(); hwRigs.lights(hwL, { head: 1, tail: 1, marker: markerAt(t), flash: o.flash || 0 });
  // oncoming traffic (+Z) on the far lanes and cars in ours
  const R = rng(4); let ci = 0;
  for (let i = 0; i < 26; i++) { const lane = [-9.6, -13.2, -16.8][i % 3], sp = 30 + R() * 8, ph = R() * 1400; const z = ((ph + t * sp) % 1400) - 1300 + cz;
    M.makeTranslation(lane, 0, z); cars.setMatrixAt(ci++, M); for (const s of [-0.7, 0.7]) { hwL.add(lane + s, 0.75, z - 2.3, 1.5, 1.45, 1.35, 0.4); hwL.refl(lane + s, 0.75, z - 2.3, 1.2, 1.1, 1.0, 0.4, 0.5); } }
  for (let i = 0; i < 8; i++) { const lane = [-1.8, 5.4, -1.8][i % 3], z = cz - 120 - i * 90 - ((t * 4 + i * 37) % 90); M.makeTranslation(lane, 0, z); cars.setMatrixAt(ci++, M);
    for (const s of [-0.7, 0.7]) { hwL.add(lane + s, 0.8, z + 2.2, 1.4, 0.05, 0.04, 0.3); hwL.refl(lane + s, 0.8, z + 2.2, 1.0, 0.05, 0.04, 0.3, 0.5); } }
  cars.count = ci; cars.instanceMatrix.needsUpdate = true;
  // raised pavement reflectors: brightness follows the alignment with our headlights
  const r0 = Math.floor(cz / 12) * 12;
  for (let i = 0; i < 70; i++) { const z = r0 + 24 - i * 12; const ahead = rz - z;
    for (const x of [0, 3.6]) { const al = ahead > 0 ? clamp(40 / (ahead + 8)) * Math.exp(-((x - rx) ** 2) / (0.02 * ahead * ahead + 6)) * 2 + 0.12 : 0.1; hwL.add(x, 0.05, z, 1.4 * al, 1.3 * al, 1.1 * al, 0.14); }
    hwL.add(-3.65, 0.05, z, 1.4 * 0.35, 1.0 * 0.35, 0.1, 0.12); hwL.add(-7.9, 0.05, z + 6, 1.2, 0.1, 0.05, 0.1); }
  hwL.commit();
  hwDot.visible = o.dot !== false; placeDot(hwDot, o.dotAz ?? 0.25, o.dotEl ?? 0.42, 5000, o.dotR ?? 0.012);
}
function ptWorld(t, b, o) {
  const cz = cam.position.z;
  ptGroundMat.uniforms.rig.value.set(o.rx ?? 1.8, 0, o.rz ?? 1e5); ptGroundMat.uniforms.head.value = o.head ?? 1;
  for (const m of ptSil) { placeLayer(m, cz, 0); m.visible = true; } ptGround.visible = true;
  ptSil[0].position.z = -1900;
  ptL.reset(); const M = new THREE.Matrix4();
  // floodlights: a cluster of 6 heads per mast
  const sg = o.surge ?? 1; ptGroundMat.uniforms.sodI.value = 2.6 * sg;
  for (const [x, z] of MASTS) for (let k = 0; k < 6; k++) { const hx = x - 1.8 + (k % 3) * 1.8, hz = z + (k < 3 ? -0.5 : 0.5); ptL.add(hx, 33.6, hz, 1.6 * sg, 0.8 * sg, 0.28 * sg, 1.0); if (k === 1) ptL.refl(x, 33.6, z, 1.4 * sg, 0.7 * sg, 0.22 * sg, 1.3, 0.22); }
  // cranes: trolley and spreader cycles, boom tip lights, red aviation lights, deck floodlights
  CRANES.forEach((z, i) => {
    const ph = t * 0.35 + i * 1.7; let trX = CRANE_X + 30 + Math.sin(ph) * 40, dy = 20 + Math.max(0, Math.sin(ph * 2)) * 18;
    if (i === 0 && o.hoist !== undefined) { trX = CRANE_X + 4; dy = o.hoist; }
    trolley.setMatrixAt(i, M.makeTranslation(trX, 47, z)); spreader.setMatrixAt(i, M.makeTranslation(trX, 47 - dy, z));
    ptL.add(CRANE_X + 85, 50, z, 1.6, 0.1, 0.06, 0.8); ptL.add(CRANE_X, 76, z, 1.6, 0.08, 0.05, 0.7); ptL.add(CRANE_X - 26, 55, z, 1.4, 0.1, 0.05, 0.6);
    for (let k = 0; k < 6; k++) ptL.add(CRANE_X + 5 + k * 12, 47.5, z + (k % 2 ? 3 : -3), 1.5, 1.0, 0.55, 0.9);
    ptL.add(trX, 45.5, z, 1.6, 1.4, 1.1, 1.3);
    for (const zz of [-9, 9]) for (const xx of [-14, 14]) ptL.add(CRANE_X + xx, 14.5, z + zz, 1.4, 0.8, 0.3, 0.5);
  });
  trolley.instanceMatrix.needsUpdate = true; spreader.instanceMatrix.needsUpdate = true;
  for (let k = 0; k < 24; k++) ptL.add(150 + (k % 2 ? 17 : -17), 30, -350 + 150 - k * 13, 1.3, 1.1, 0.8, 0.8);
  for (let k = 0; k < 12; k++) ptL.add(150 + (k - 6) * 2.5, 38 + (k % 3) * 2.4, -230, 1.2, 1.0, 0.6, 0.35);
  // gate: booth windows, canopy strip lights, booms (lifted from b52)
  for (let k = 0; k < 16; k++) ptL.add(-30 + k * 4, 7.3, GATE_Z + (k % 2 ? 5 : -5), 1.6, 1.5, 1.3, 0.9);
  const lift = o.lift ?? 0;
  LANES.forEach((x, i) => { const a = lift * (1.35 + Math.sin(i * 3) * 0.1) * clamp((b - 52) * 2 - i * 0.12 + (lift >= 1 ? 99 : 0)); M.makeRotationZ(a).setPosition(x - 1.7, 1.1, GATE_Z - 6.5); booms.setMatrixAt(i, M);
    ptL.add(x - 1.7, 1.4, GATE_Z - 6.4, a > 0.5 ? 0.1 : 1.5, a > 0.5 ? 1.2 : 0.08, a > 0.5 ? 0.4 : 0.05, 0.3); });
  booms.instanceMatrix.needsUpdate = true;
  // rigs: the queue in 8 lanes (hundreds), or rolling in after the booms
  ptRigs.reset();
  const roll = o.roll ?? 0;
  for (let li = 0; li < LANES.length; li++) for (let k = 0; k < (o.qn ?? 30); k++) {
    let z = GATE_Z + 8 + k * 19.5 + (li % 2) * 6 + (o.qGap && k >= 2 ? o.qGap : 0); const go = roll > 0 ? Math.max(0, roll - k * 0.35) : 0; z -= go * go * 4 + go * 6;
    if (o.skipLane === li && k < 3) continue;
    ptRigs.add(LANES[li], z, 0, 0, 1);
  }
  if (o.own) ptRigs.add(o.rx ?? 1.9, o.rz, 0, 0, 1);
  for (const [x, z, yaw] of (o.extra || [])) ptRigs.add(x, z, yaw, 0, 1);
  ptRigs.commit(); ptRigs.lights(ptL, { head: 1, tail: 1, marker: markerAt(t), flash: o.flash || 0, refl: true });
  gantry2.visible = o.gantry === true;
  if (o.sign && o.sign !== signLabel) { drawSign(o.sign); signLabel = o.sign; }
  if (o.gantry) { const gd = Math.abs(cz - EXIT_Z); gantry2.children.forEach(c => { if (c.material === sign.material) {} }); sign.material.uniforms.flare.value = Math.min(0.55, (o.flare ?? 1) * clamp(40 / (gd + 4)) * 0.6); sign.material.uniforms.sweep.value = o.sweep ?? -1; }
  ptL.commit();
  ptDot.visible = o.dot !== false; placeDot(ptDot, o.dotAz ?? 0.35, o.dotEl ?? 0.45, 5000, o.dotR ?? 0.011);
}
function setSky(kind, k = 0) {
  const u = skyMat.uniforms;
  if (kind === 'dusk') { u.top.value.set('#0b2126'); u.mid.value.set('#1f4a4f'); u.hor.value.set('#4d7c7c'); u.band.value.set('#d07a3a'); u.bandW.value = 0.03; u.bandA.value = 1 - k * 0.5; u.glowC.value.set('#000000'); }
  else if (kind === 'dawn') {                        // first light over the Kills: pale zenith, a warm band low in the east
    u.top.value.set('#1c3a44'); u.mid.value.set('#3b6670'); u.hor.value.set('#b08a66'); u.band.value.set('#e39a58'); u.bandW.value = 0.06; u.bandA.value = 0.9;
    u.glowC.value.set('#7a5030'); u.glow.value.set(0.2, 0, -1); }
  else if (kind === 'blue') {                        // blue hour over the port (Mann): slate-teal zenith, the low sky lit from below by the sodium
    u.top.value.set('#123640'); u.mid.value.set('#24525a'); u.hor.value.set('#7a6a52'); u.band.value.set('#b8743c'); u.bandW.value = 0.07; u.bandA.value = 0.55;
    u.glowC.value.set('#6a4424'); u.glow.value.set(0.4, 0, -1); }
  else { u.top.value.set('#061418'); u.mid.value.set('#0e2a30'); u.hor.value.set('#3a3a2e'); u.band.value.set('#a0582a'); u.bandW.value = 0.05; u.bandA.value = 0.6; u.glowC.value.set('#5a3416'); u.glow.value.set(0.4, 0, -1); }
}
function camLook(px, py, pz, lx, ly, lz, fov = 60, roll = 0) {
  cam.position.set(px, py, pz); cam.up.set(Math.sin(roll), Math.cos(roll), 0); cam.lookAt(lx, ly, lz); cam.fov = fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
}

// ================================================================= shots, keyed to beats
// every line has its own surface in the world; the shot is built so that surface reads (cap >= 150 px or >= 70 % width)
const ZH = -20000;                                   // the interstate's stretch for the opening
// ---------------------------------------------------------------- v8: millions as a field of lights
// OF MILLIONS.: from over the warehouse roof, the metro's street grid lights up outward from the port, point by point
// (v2's lattice of multiplying lights, which showed millions better than v7's three trucks in a mirror).
const FIELD = (() => {
  const N = 120000, pos = new Float32Array(N * 3), colA = new Float32Array(N * 3), th = new Float32Array(N), R = rng(2036);
  for (let i = 0; i < N; i++) {
    let x, z; const street = R();
    if (street < 0.45) { x = Math.round((-7000 + R() * 7100) / 90) * 90 + (R() - 0.5) * 3; z = -9000 + R() * 9600; }        // north-south streets
    else if (street < 0.9) { z = Math.round((-9000 + R() * 9600) / 70) * 70 + (R() - 0.5) * 3; x = -7000 + R() * 7100; }     // east-west streets
    else { x = -7000 + R() * 7100; z = -9000 + R() * 9600; }                                                                      // yards, lots, windows
    if (x > 120) x = 120 - R() * 400;                                                                                            // the water stays dark
    pos[i * 3] = x; pos[i * 3 + 1] = 0.5 + R() * R() * 12; pos[i * 3 + 2] = z;
    const w = R(); const c = w < 0.62 ? [1.0, 0.55, 0.18] : w < 0.9 ? [1.0, 0.86, 0.66] : [0.75, 0.9, 1.0];
    const k = 0.5 + R() * 0.7; colA[i * 3] = c[0] * k; colA[i * 3 + 1] = c[1] * k; colA[i * 3 + 2] = c[2] * k;
    th[i] = Math.hypot(x + 20, z + 400) / 9500 + (R() - 0.5) * 0.18;                                                             // lights from the port outward
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(colA, 3)); g.setAttribute('th', new THREE.BufferAttribute(th, 1));
  const mat = new THREE.ShaderMaterial({ uniforms: { grow: { value: 0 }, focal: { value: 1000 } },
    vertexShader: `attribute vec3 color; attribute float th; uniform float grow, focal; varying vec3 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; float d = max(-mv.z, 1.);
        float on = smoothstep(th - .025, th, grow); float s = 7. * focal / d${PXD}; float k = 1.; if (s < 1.6) { k = s * s / 2.56; s = 1.6; }
        gl_PointSize = min(s, 7.)${PXM}; vC = color * k * on * (.55 + .45 * exp(-d * .00012)) * (1. + 2.5 * exp(-pow((grow - th) * 40., 2.))); }`,
    fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord * 2. - 1.; float a = exp(-dot(p, p) * 3.); gl_FragColor = vec4(vC * a, 1.); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const m = new THREE.Points(g, mat); m.frustumCulled = false; m.visible = false; PT.add(m); return m;
})();
const roofFace = new Face(PT);
// v8: the organisers at the gate, raked by a rig's headlights (warm white, from the queue), not silhouettes under a banner
const marchKey = new THREE.SpotLight(0xfff0dc, 0, 70, 0.55, 0.7, 1.2); PT.add(marchKey, marchKey.target);
const marchFill = new THREE.SpotLight(0xffc890, 0, 70, 0.6, 0.8, 1.2); PT.add(marchFill, marchFill.target);
// the terminal's gate camera: machine-vision boxes on every rig, the owner's systems of planning, management and control
function gateHUD(g, F, t, tight) {
  const { text, age } = F; g.save();
  g.fillStyle = 'rgba(0,18,10,0.28)'; g.fillRect(0, 0, W, H);                                   // the camera's own cast
  for (let y = 0; y < H; y += 4) { g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(0, y, W, 1); }   // scan lines
  let id = 4417;
  for (const [x, z, yaw, y] of ptRigs.list) {
    const pts = [[-1.3, 0, -3.8], [1.3, 0, -3.8], [-1.3, 4.1, -3.8], [1.3, 4.1, -3.8], [-1.3, 0, 15.3], [1.3, 0, 15.3], [-1.3, 4.1, 15.3], [1.3, 4.1, 15.3]].map(([a, b, c]) => new THREE.Vector3(x + a, y + b, z + c).project(cam));
    if (pts.some(p => p.z > 1)) continue; const xs = pts.map(p => (p.x + 1) / 2 * W), ys = pts.map(p => (1 - p.y) / 2 * H);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (x1 < 0 || x0 > W || y1 < 0 || y0 > H || x1 - x0 < 24) continue;
    const lock = tight && ((id * 7) % 3 === 0) && age > 0.1;
    g.strokeStyle = lock ? 'rgba(255,60,50,0.95)' : 'rgba(120,255,170,0.8)'; g.lineWidth = lock ? 4 : 2.5; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    if (x1 - x0 > 70) { g.font = '700 22px "Plex Mono"'; g.fillStyle = lock ? 'rgba(255,90,80,0.95)' : 'rgba(150,255,190,0.9)'; g.fillText(`TRK ${id} ${lock ? 'HOLD' : 'DWELL ' + String(2 + (id % 5)).padStart(2, '0') + ':' + String((id * 13) % 60).padStart(2, '0')}`, x0 + 4, y0 - 8); }
    id += 37;
  }
  g.font = '700 34px "Plex Mono"'; g.fillStyle = 'rgba(170,255,200,0.95)';
  g.fillText(F.name === 'gateCam0' ? 'YARD PLAN  BERTH 2' : 'GATE 4  OCR CAM 07', 50, 110); g.fillText(`${String(5 + Math.floor(t * 30) % 1).padStart(2, '0')}:4${Math.floor(t) % 10}:${String(Math.floor(t * 30) % 60).padStart(2, '0')}`, 50, 156);
  g.font = '700 26px "Plex Mono"'; g.fillStyle = 'rgba(170,255,200,0.7)'; g.fillText('ACP CONSTITUTION, PREAMBLE', 50, H - 120);
  // the line itself, in the system's own readout: a boxed field under the feed
  let s = 170; g.font = `700 ${s}px "Plex Mono"`; while (g.measureText(text).width > W - 140) { s -= 4; g.font = `700 ${s}px "Plex Mono"`; }
  const tw = g.measureText(text).width, cap = g.measureText('H').actualBoundingBoxAscent, bx0 = (W - tw) / 2, by = 1500;
  g.fillStyle = 'rgba(0,10,6,0.72)'; g.fillRect(bx0 - 30, by - cap - 40, tw + 60, cap + 80);
  g.strokeStyle = 'rgba(120,255,170,0.9)'; g.lineWidth = 3; g.strokeRect(bx0 - 30, by - cap - 40, tw + 60, cap + 80);
  g.fillStyle = tight && age > 0.1 ? '#ff5a4e' : '#b4ffcc'; g.fillText(text, bx0, by);
  g.restore(); TYPE2D = { text, cap, span: tw, lx: bx0, rx: bx0 + tw };
}
// the client's poster, on a rostrum: u = push (0..1), anchored on the trucker's face so the push travels up his gaze
function posterPhoto(g, u = 0) {
  const s0 = H / 1700, s = s0 * (1 + 0.14 * u), ax = 700, ay = 1250, sx = (ax - 280) * s0, sy = ay * s0;   // the face (ax, ay) holds its screen point
  const x0 = sx - (ax - 280) * s, y0 = sy - ay * s;
  g.save(); g.imageSmoothingQuality = 'high'; g.drawImage(POSTER, 280, 0, 1080 / s0, 1700, x0, y0, 1080 / s0 * s, 1700 * s); g.restore();
  // the photo's grain lifted to our print: a faint warm plate so it sits with the lens pass
  return { x: x0 + (PDOT[0] - 280) * s, y: y0 + PDOT[1] * s, r: 28.5 * s };
}
const SH = [
  [0, 'gantry'], [2, 'chase'], [4, 'bumper'], [6, 'board'], [8, 'dashcam'], [10, 'track'], [11, 'track2'], [13, 'bank'], [14, 'ramp'],
  [16, 'shoulder'], [17, 'tab'], [18, 'poster'], [21, 'shoulderTw'], [22, 'trackEarly'], [23, 'paveEarly'], [24, 'blaze'],
  [26, 'sideDrone'], [27, 'paveClubs'], [28, 'guide'], [29, 'queueHigh'], [30, 'flyer'], [32, 'march'],
  [34, 'rollCranes'], [35, 'spreader'], [36, 'cb'], [37, 'wallDrone'], [38, 'aerial'],
  [40, 'gateCam0'], [41, 'gateCam'], [42, 'gateCam2'], [44, 'horns'], [46, 'paveEarly2'], [48, 'wheel'], [50, 'posterLook'],
  [52, 'bridge1'], [54, 'bridge2'], [56, 'payGantry'], [60, 'exitGantry']];
const shotAt = b => { let r = SH[0]; for (const s of SH) if (b >= s[0]) r = s; return r; };
const zAt = (tt, k = 1, t0 = 0) => ZH - V * t0 - V * k * (tt - t0);    // our odometer (closed form), k = speed factor after t0
const HWFOG = ['#2c5256', 0.0012], PTFOG = ['#4a4a3e', 0.0022];
const snapYaw = () => 0;                             // (v6: faces stay put; the hit is a headlight flash on the letters)
const hitFlash = (age) => Math.exp(-age * 9) * 0.45;
let TYPE2D = null;                                  // metrics of a 2D in-world line (flyer, CB, poster print, mirror etching)
let PTHEMI = null; PT.traverse(o => { if (o.isHemisphereLight) PTHEMI = o; });
const legend = (mat, kind, text, cx, cz, w, dx = 1, dz = 0, colr = '#e8e6de') => {
  const f = faceTex(kind, text), u = mat.uniforms; u.lgOn.value = 1; u.lgT.value = f.t; u.lgC.value.set(cx, cz); u.lgD.value.set(dx, dz).normalize(); u.lgS.value.set(w, w / f.a.aspect); u.lgCol.value.set(colr);
  return { text, f, cx, cz, w, h: w / f.a.aspect, dx, dz };
};
function legendMetrics(L) {                          // screen size of a pavement legend's type
  if (!L) return null; const a = L.f.a, d = new THREE.Vector2(L.dx, L.dz).normalize(), n = new THREE.Vector2(-d.y, d.x);
  const P = (u, v) => new THREE.Vector3(L.cx + d.x * u * L.w - n.x * v * L.h, 0.02, L.cz + d.y * u * L.w - n.y * v * L.h).project(cam);
  const l = P(-a.span / 2, 0), r = P(a.span / 2, 0), t = P(0, a.cap / 2), bb = P(0, -a.cap / 2);
  return { text: L.text, cap: Math.hypot((t.x - bb.x) / 2 * W, (t.y - bb.y) / 2 * H), span: Math.hypot((r.x - l.x) / 2 * W, (r.y - l.y) / 2 * H), lx: (l.x + 1) / 2 * W, rx: (r.x + 1) / 2 * W };
}
function signMetrics(mesh, text) {                   // the gantry's own face (16 x 4.5 m; the label sits right of the shield)
  mesh.updateMatrixWorld(); const cxu = (420 + (2048 - 460) / 2) / 2048 - 0.5;
  const P = (u, v) => new THREE.Vector3(u * 16, v * 4.5, 0).applyMatrix4(mesh.matrixWorld).project(cam);
  const l = P(cxu - signSpan / 2, 0), r = P(cxu + signSpan / 2, 0), t = P(cxu, signCap / 2), bb = P(cxu, -signCap / 2);
  return { text, cap: Math.abs(t.y - bb.y) / 2 * H, span: Math.abs(r.x - l.x) / 2 * W, lx: (l.x + 1) / 2 * W, rx: (r.x + 1) / 2 * W };
}
function goose(L, x, y, z, n, w, dir) {              // a row of gooseneck flood lamps along a face's top or bottom edge
  for (let k = 0; k < n; k++) { const u = n > 1 ? k / (n - 1) - 0.5 : 0; L.add(x + dir.x * u * w, y, z + dir.z * u * w, 1.6, 1.25, 0.8, 0.5); }
}

function frame(t) {
  // cues are keyed to the nearest frame: the hit frame itself shows the new shot and word (b at t + half a frame)
  const b = B.beat(t), bq = B.beat(t + 0.5 / 30), [s0, name] = shotAt(bq), lb = Math.max(0, b - s0), lt = lb * SPB, tS = s0 * SPB, frameN = Math.round(t * 30);
  const kick = B.env('kick', t, 9), imp = B.env('impact', t, 5);
  const w = wordAt(bq), text = w[1], age = Math.max(0, (b - w[0]) * SPB), snap = text ? snapYaw(text, age) : 0, fl = text ? hitFlash(age) : 0;
  DOT = null; twSign.visible = false; payBridge.visible = false; FIELD.visible = false; roofFace.hide(); marchKey.intensity = 0; marchFill.intensity = 0;
  const S = { world: 'hw', ov: null, drop: 0, grime: 0, rain: 0, lens: {}, lo: false, mirror: null, face: null, leg: null, sign: null };
  const ztrip = zAt(t);
  setSky('dusk');
  hwFace.hide(); ptFace.hide(); ptBanner.hide(); hwStruct.reset(); ptStruct.reset(); folkHide(); TYPE2D = null;
  hwGroundMat.uniforms.lgOn.value = 0; ptGroundMat.uniforms.lgOn.value = 0; if (PTHEMI) PTHEMI.intensity = 0.9;
  switch (name) {
    case 'gantry': {                                 // EXIT 2036.: frame 0, the gantry already rushing at the cab, the flare across its face
      const d = lerp(24, 19, ease.inCubic(lb / 2)), rz = ZH; const cz = rz - 1.2;
      camLook(1.6, 2.7, cz, 2.6, 6.2, cz - 30, 62, Math.sin(t * 9) * 0.004);
      hwWorld(t, b, { rz, own: false, gz: cz - d - 0.6, sign: 'EXIT 2036.', convoy: 0, flare: 1.4 + kick, sweep: lerp(-0.2, 1.3, (lb % 1)), dotEl: 0.5 });
      S.sign = 'EXIT 2036.'; S.drop = 0.3; S.grime = 0.55; S.ov = 'hood'; S.rain = 0.5; S.lens = {}; break;
    }
    case 'chase': {                                  // FOOT DOWN.: the drone over the cab, the rig runs over the lane legend
      const rz = ztrip, zL = zAt(tS + SPB) - 15;
      camLook(1.9, 14.5, rz + 4.5, 1.8, 0, rz - 13, 58, 0.0);
      hwWorld(t, b, { rz, own: true, convoy: 2, dotEl: 0.45, dotAz: 0.3, sil: true });
      S.leg = legend(hwGroundMat, 'pave', text, 1.8, zL, 10.4, 1, 0, '#e2e0d8');
      S.rain = 0.3; S.lens = {}; break;
    }
    case 'bumper': case 'board': {                   // A WORKERS' PARTY.: the bulletin board at the roadside, floodlit in the rain
      const zB = zAt(4 * SPB) - 3.9 - 72, bx0 = 15, by = 10.2, bw = name === 'bumper' ? 15 : 16.5;
      if (name === 'bumper') { const rz = zAt(t, 0.45, tS); camLook(1.6, 0.6, rz - 3.9, 14.8, 8.4, zB, 24, 0.02); hwWorld(t, b, { rz, own: false, dotEl: 0.3, convoy: 0 }); S.rain = 0.25; S.lens = {}; }
      else { camLook(-3.8, 1.6, zB + 60, 15.3, 8.6, zB, 29, 0); hwWorld(t, b, { rz: zAt(t) + 30, own: false, dotEl: 0.3, convoy: 0 }); S.rain = 0.35; S.lens = {}; }
      hwFace.show('billboard', text).at(bx0, by, zB, bw, -0.16 + snap).lit({ key: [0.62, 0.6, 0.55], flood: [0.7, 0.55, 0.38], retro: 0, flash: fl * 0.5, fog: HWFOG });
      const r = new THREE.Vector3(Math.cos(-0.16), 0, -Math.sin(-0.16));
      for (const u of [-0.3, 0.3]) hwStruct.post(bx0 + r.x * u * bw, 0, by - 2.3, zB + r.z * u * bw, 0.9);
      hwStruct.box(bx0, by - 2.55, zB + 0.6, bw, 0.2, 1.2, -0.16);
      S.lamps = () => { for (let k = 0; k < 4; k++) { const u = (k + 0.5) / 4 - 0.5; hwL.add(bx0 + r.x * u * bw, by - 2.7, zB + r.z * u * bw + 1.2, 1.6, 1.3, 0.85, 0.55); } };
      S.face = hwFace; break;
    }
    case 'dashcam': {                                // WE CALLED IT.: the dash-cam file under an overhead message sign
      const rz = zAt(t, 0.1, tS), zV = zAt(tS) - 22;
      camLook(1.9, 2.8, rz - 0.4, 3.3, 5.6, rz - 60, 66, 0);
      hwWorld(t, b, { rz, own: false, convoy: 1 });
      hwFace.show('vms', text).at(3.4, 7.3, zV, 11.6, snap).lit({ key: [0.05, 0.05, 0.05], emis: 0.42, fog: HWFOG });
      hwStruct.box(3.4, 7.3, zV - 0.55, 12.9, 2.5, 0.8); hwStruct.post(11, 0, 8.5, zV - 0.5, 0.6); hwStruct.box(6, 8.7, zV - 0.5, 10.4, 0.35, 0.35);
      S.face = hwFace; S.ov = 'dashcam'; S.drop = 0.25; S.grime = 0.35; S.rain = 0.4; S.lens = {distort: 0.03, sat: 0.8, ca: 0.004}; break;
    }
    case 'track': case 'track2': case 'trackEarly': { // THE EXIT / CAME EARLY. (two trailers in a row, a serial sign) / EARLY.
      const tight = name === 'trackEarly', rigZ = ztrip + 26 + (name === 'track2' ? 34 : 0), cx = tight ? -13.8 : -19.5;
      camLook(cx, tight ? 1.9 : 3.2, rigZ + 9 + (tight ? 1.5 : 0) - lt * 0.8, 5.4, 2.5, rigZ + 9, tight ? 50 : 50, 0);
      hwWorld(t, b, { rz: rigZ - 40, own: false, convoy: 0, extra: [[5.4, rigZ]], dotAz: 1.2, dotEl: 0.35, poleGap: [rigZ - 8, rigZ + 26] });
      hwFace.show('container', text, { livery: tight ? '#1d3f6a' : name === 'track2' ? '#2f6d4a' : '#7a1f22' }).at(5.4 - 1.3, 2.72, rigZ + 9.0, 12.2, -Math.PI / 2 + snap * 0.3)
        .lit({ key: [0.55, 0.42, 0.3], flood: [0.25, 0.3, 0.3], fog: HWFOG, flash: fl * 0.6 });
      S.face = hwFace; S.rain = 0.7; S.lens = {}; break;
    }
    case 'bank': {                                   // (breath) the rig swings off onto the exit, the cab banks
      const rz = ztrip, sw = ease.inOutCubic(clamp(lb)), rx = 1.8 + sw * 5;
      camLook(rx - 0.2, 2.9, rz + 1.2, rx + 2 + sw * 12, 2.0, rz - 60, 64, -0.07 * Math.sin(sw * 3.1) - 0.03);
      hwWorld(t, b, { rz, rx, own: false, convoy: 3, gz: rz - 700, sign: 'EXIT 2036.' });
      S.ov = 'cab'; S.cab = { mph: 58 - 10 * sw, rpm: 0.55, lean: 0.05 * Math.sin(sw * 3.1), t, hands: 0, glove: 1 }; S.drop = 0.4; S.grime = 0.5; S.rain = 0.4; break;
    }
    case 'ramp': {                                   // HANG ON.: the curve warning on the ramp, flashers going
      const rz = zAt(t, 0.3, tS), rx = 7.4, zW = zAt(tS) - 17;
      camLook(rx - 0.2, 2.9, rz + 1.2, 11.0, 3.0, zW, 62, -0.04);
      hwWorld(t, b, { rz, rx, own: false, convoy: 2 });
      hwFace.show('warning', text).at(11.2, 3.6, zW, 10, -0.18 + snap).lit({ key: [0.1, 0.1, 0.09], retro: 0.55, flash: fl * 0.25, fog: HWFOG, sweep: lerp(-0.3, 1.3, clamp(age / 0.5)) });   // retroreflective sheeting in OUR beams, not a lamp
      hwStruct.post(9.5, 0, 1.9, zW - 0.3, 0.2); hwStruct.post(12.9, 0, 1.9, zW + 0.3, 0.2);
      const on = Math.floor(t * 4) % 2; S.lamps = () => { for (const [dx, k] of [[-3.6, on], [3.6, 1 - on]]) hwL.add(11.2 + dx, 5.3, zW - dx * 0.18, 1.8 * k + 0.05, 0.9 * k + 0.02, 0.1 * k, 0.6); };
      S.face = hwFace; S.ov = 'cab'; S.cab = { mph: 38 - 6 * lb, rpm: 0.4, lean: -0.03, t, hands: 0, glove: 1 }; S.drop = 0.45; S.grime = 0.5; S.rain = 0.5; break;
    }
    case 'shoulder': case 'shoulderTw': case 'blaze': case 'tab': {
      // the shoulder exit signs in button copy under OUR beams. TRY 2024. (drop 1): the rig brakes onto the shoulder, the
      // sign 60 m out on the hit; CHICAGO 7.21.24.: close on its date tab; TWELVE YEARS: the next sign, its tab doing the
      // sum (2036 − 2024 = 12); EARLY. (b24): tight on that sign's bottom row as the driver flashes the highs
      const stop = ZH - V * B.barLen * 4.2, zS = stop - 60, tw = name === 'shoulderTw' || name === 'blaze';
      twPanel.material = tw ? twMat : tryMat; twTab.visible = !tw; sumTab.visible = tw;
      twSign.visible = true; twSign.position.set(8.6, 7.4, zS); twSign.rotation.y = -0.06;
      let cx, cy, cz, lx, ly, fov;
      if (name === 'shoulder') { const u = ease.outCubic(clamp(lb / 1.5)), d = lerp(60, 50, u); cx = 4.4; cy = lerp(1.6, 1.3, u); cz = zS + d; lx = 8.6; ly = 7.4 + 0.3 * u; fov = lerp(19, 22, u); }
      else if (name === 'tab') { cx = 9.9; cy = 9.6; cz = zS + 13.5 - lb * 1.0; lx = 10.6; ly = 9.7; fov = 44; }
      else if (name === 'shoulderTw') { cx = 5.0; cy = 1.5; cz = zS + 44 - lb * 3; lx = 8.8; ly = 8.1; fov = 23; }
      else { cx = 7.6; cy = 3.4; cz = zS + 27 - lb * 2.5; lx = 7.9; ly = 6.6; fov = 35; }
      camLook(cx, cy, cz, lx, ly, zS, fov, 0);
      hwWorld(t, b, { rz: cz - 1.2, rx: cx, convoy: 0, own: false, dotEl: 0.16, dotAz: 0.18, head: 1 });
      headlights(cam);
      const M = twPanel.material; M.uniforms.uPitch.value = name === 'shoulder' ? 1.2 * Math.exp(-lb * 3) : name === 'blaze' ? 7 : 0;
      if (name === 'blaze') { const fr = Math.round((t - tS) * 30); M.uniforms.uHigh.value = fr < 0 ? 0 : fr < 1 ? 1 : fr < 11 ? lerp(1, 0.75, (fr - 1) / 10) : 0.75; M.uniforms.uCut.value = 9; }
      else { M.uniforms.uHigh.value = name === 'shoulderTw' ? 0.45 : 0; M.uniforms.uCut.value = name === 'shoulder' ? lerp(7, 15, clamp((t - tS) * 30 / 6)) : name === 'tab' ? 15 : 16; if (name === 'shoulderTw') M.uniforms.uPitch.value = 5; }   // v8: the rig still on the highs from the brake stop, so TWELVE YEARS reads from its first frame
      twTab.material.uniforms.flare.value = name === 'tab' ? 0.55 : 0.35; sumTab.material.uniforms.flare.value = name === 'blaze' ? 0.7 : 0.45;
      if (name === 'shoulder' || name === 'shoulderTw') S.btn = () => panelMetrics(twPanel, tw ? twLegend : tryLegend, text, name === 'shoulder' ? 1 : 0);
      if (name === 'blaze') S.btn = () => panelMetrics(twPanel, twLegend, text, 1);
      S.rain = 0.4; S.lens = { hal: 0, ca: name === 'shoulder' || name === 'blaze' ? 0.006 * Math.exp(-(t - tS) * 14) : 0 }; if (name === 'shoulder') S.brake = lb; break;
    }
    case 'poster': {                                 // THE AMERICAN / COMMUNIST PARTY.: the client's own poster, its own print type
      const stop = ZH - V * B.barLen * 4.2;
      camLook(14, 1.5, stop, 54, 1.5 + 40 * Math.tan(0.44), stop + 12, 52, 0); hwWorld(t, b, { rz: stop, rx: 8.6, head: 0.6, dot: false, sil: false });
      S.ov = 'poster'; S.push = 0.06 * clamp((b - 18) / 3); S.print = text; S.lens = { sat: 1.0 }; break;
    }
    case 'paveEarly': case 'paveClubs': {            // EARLY. / 29 CLUBS.: straight down on the convoy crossing the legend
      const zc = zAt(tS) - 22;
      camLook(1.8, 21, zc + 3, 1.8, 0, zc, 52, 0.0);
      hwWorld(t, b, { rz: ztrip, own: true, convoy: name === 'paveClubs' ? 9 : 6, sil: true });
      S.leg = legend(hwGroundMat, 'pave', text, 1.8, zc, name === 'paveClubs' ? 8.4 : 7.4, 1, 0, name === 'paveClubs' ? '#e2e0d8' : '#b89a2a');
      S.rain = 0.3; S.lens = {}; break;
    }
    case 'guide': {                                  // PORT NEWARK.: the green guide sign over the lanes, the convoy under it, the cranes beyond
      setSky('dusk', 1); const rz = ztrip, gz = zAt(tS) - 60;
      camLook(-2.4, 3.4, rz + 6 - lb * 2, 1.9, 7.6, gz, 34, 0.01);
      hwWorld(t, b, { rz, own: true, convoy: 6, gz, sign: text, flare: 1.1, sweep: lerp(-0.2, 1.3, clamp(lb)), dotAz: 0.2, dotEl: 0.38 });
      S.sign = text; S.rain = 0.45; S.lens = {}; break;
    }
    case 'sideDrone': {                              // TEN OF US.: the lead trailer's side, nine more rigs behind it in the rain
      setSky('dusk', 1); const rz = ztrip;
      camLook(1.8 - 24, 6.5 + lb * 0.4, rz + 8.6 - lb * 0.8, 0.5, 2.7, rz + 9.2, 56, 0.02);
      hwWorld(t, b, { rz, own: true, convoy: 9, dotAz: -0.8, dotEl: 0.3, poleGap: [rz - 8, rz + 26] });
      hwFace.show('roof', text).at(1.8 - 1.3, 2.72, rz + 9.0, 12.2, -Math.PI / 2).lit({ key: [0.42, 0.44, 0.44], flood: [0.2, 0.24, 0.26], fog: HWFOG, flash: fl * 0.5 });
      S.face = hwFace; S.rain = 0.55; S.lens = {}; break;
    }
    // ------------------------------------------------ the port
    case 'flyer': {                                  // TRUCKERS SIGN UP.: out of the driver's window, the flyer handed up in the queue
      S.world = 'pt'; setSky('blue'); camLook(-5.6, 3.0, 36, -14, 0.8, 12, 60, 0.05);
      ptWorld(t, b, { qn: 30, skipLane: 2, dotAz: 0.1 }); S.ov = 'flyer'; S.drop = 0.2; S.grime = 0.2; S.rain = 0.6; S.lens = {}; break;
    }
    case 'queueHigh': {                              // RIG BY RIG.: from high over the gate queue, the legend painted across the lanes
      S.world = 'pt'; setSky('blue'); camLook(-12 + lt * 1.5, 44, 122 - lt * 2, 0, 0, 57, 30, 0.02);
      ptWorld(t, b, { qn: 30, qGap: 26, roll: 0 });
      S.leg = legend(ptGroundMat, 'pave', text, 0, 57, 22, 1, 0, '#c8c4b8');
      S.rain = 0.4; S.lens = {}; break;
    }
    case 'march': {                                  // ON THE MARCH.: the organisers walk the gate queue at dawn (Port Newark, Mar 2025), raked by the rigs' headlights
      S.world = 'pt'; setSky('dawn'); if (PTHEMI) PTHEMI.intensity = 0.3;
      const walk = (t - tS) * 1.3, z0 = 29 - walk, x0 = -17.6;
      camLook(x0 + 0.3, 1.25, 20.5 - walk * 0.3, x0 - 0.2, 2.0, 60, 46, 0);
      ptWorld(t, b, { qn: 30, dotAz: -0.2, dotEl: 0.3 });
      for (const m of MARCH) { const st = folk.get(m.id);
        const z = z0 + m.z, x = x0 + m.x;
        folk.set(m.id, { visible: true });
        if (m.bearer) folk.set(m.id, { x, z, heading: Math.PI, ph: (t + m.off) * 5.6, t: t + m.off });
        else folk.set(m.id, { x, z, heading: Math.PI + Math.sin(m.off) * 0.05, ct: t + m.off, t: t + m.off });
        void st; }
      marchKey.intensity = 240; marchKey.position.set(x0 + 7.5, 1.3, z0 + 3.5); marchKey.target.position.set(x0 - 0.5, 1.3, z0 + 3.5);   // the next rig's lamps, low and warm
      marchFill.intensity = 60; marchFill.position.set(x0 - 3, 1.2, z0 - 9); marchFill.target.position.set(x0, 1.4, z0 + 2); marchKey.target.updateMatrixWorld(); marchFill.target.updateMatrixWorld();
      folk.update(cam);
      const tops = MARCH.filter(m => m.bearer).map((m, i) => { const lo = folk.gripPos(m.id, i ? -1 : 1), hi = folk.gripPos(m.id, i ? 1 : -1), d = hi.clone().sub(lo).normalize(); if (d.y < 0.5) d.set(0, 1, 0);
        const b0 = lo.clone().addScaledVector(d, -0.7), top = hi.clone().addScaledVector(d, 1.25); const P = bannerPoles[i]; P.visible = true;
        P.position.copy(b0).add(top).multiplyScalar(0.5); P.scale.set(1, b0.distanceTo(top), 1); P.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(b0).normalize()); return top; });
      const mid = tops[0].clone().add(tops[1]).multiplyScalar(0.5), span = tops[0].distanceTo(tops[1]);
      ptBanner.show('banner', text).basis(mid.x, mid.y - 0.45, mid.z, span * 0.98, tops[0].clone().sub(tops[1]).setY(0), new THREE.Vector3(0, 1, 0))
        .lit({ key: [0.55, 0.36, 0.28], trans: [0.5, 0.16, 0.1], fog: PTFOG, t, wave: 1 });   // printed cloth, the queue's headlights through it from behind
      if (ptBanner.mesh.matrixWorld.elements[10] > 0) {}   // faces +Z or -Z both render (double-sided)
      S.face = ptBanner; S.rain = 0.7; S.lens = {}; break;
    }
    case 'spreader': {                               // WE MADE IT.: a box on the crane's spreader goes up over the camera, stencil on its flank
      S.world = 'pt'; setSky('blue'); const hoist = lerp(25, 20, ease.inOutCubic(clamp(lb / 2))), zc = -160;   // the box rides above the portal beam (y 14)
      camLook(CRANE_X - 24, 12 + lb * 1.6, zc + 1, CRANE_X + 3, 47 - hoist - 1.7 - 0.4, zc, 46, 0);   // the lens rides the lift: the stencil stays in the frame's middle band
      ptWorld(t, b, { qn: 12, hoist });
      ptFace.show('container', text, { livery: '#2f6d4a' }).at(CRANE_X + 4 - 1.3, 47 - hoist - 1.7, zc, 12.2, -Math.PI / 2).lit({ key: [0.5, 0.36, 0.2], flood: [0.9, 0.55, 0.25], fog: PTFOG, flash: fl * 0.5 });
      S.face = ptFace; S.rain = 0.6; S.lens = {}; break;
    }
    case 'cb': {                                     // CALLING IT AGAIN.: the CB in macro, the mic keyed
      S.world = 'pt'; setSky('blue'); const cz = 33; camLook(-5.4, 2.9, cz, -5.8, 3.4, -200, 58, 0);
      ptWorld(t, b, { qn: 30, skipLane: 2, rz: cz - 1.3, rx: -5.6, own: false });
      S.ov = 'cbMacro'; S.drop = 0.5; S.grime = 0.5; S.rain = 0.3; S.lens = {}; break;
    }
    case 'wallDrone': {                              // MILLIONS BY 2036.: the mural on the warehouse wall, two floods; square on, then the drone rises
      S.world = 'pt'; setSky('blue'); const u = ease.inOutCubic(clamp(lb / 2));
      camLook(WH.x + 72 - u * 4, lerp(7.6, 12.5, u), WH.z, WH.x, lerp(7.5, 8.6, u), WH.z, 56, 0);
      ptWorld(t, b, { qn: 30, dotAz: -1.9, dotEl: 0.22 });
      ptFace.show('mural', text).at(WH.x + 0.12, 7.45, WH.z, 40, Math.PI / 2).lit({ key: [0.16, 0.13, 0.11], flood: [1.0, 0.76, 0.46], fog: PTFOG });
      S.murLamps = true; S.face = ptFace; S.rain = 0.35; S.lens = {}; break;
    }
    case 'mirrorEtch': {                             // WATCH US GROW.: the mirror fills the frame, the convoy grows in it, the line etched on the glass
      setSky('blue'); const rz = ztrip, n = Math.min(30, 6 + Math.floor(lb * 10));
      camLook(0.2, 3.0, rz - 0.9, -12, 4.0, rz - 40, 55, 0);
      hwWorld(t, b, { rz, own: false, convoy: n, dotEl: 0.36, dotAz: -0.4 });
      S.lo = true; S.mirror = { rz, n, x: 60, y: 210, w: 960, h: 1360, etch: text }; S.drop = 0.3; S.rain = 0.4; S.lens = {}; break;
    }
    case 'paveEarly2': {                             // EARLY.: straight down on the port road, rigs rolling over the legend
      S.world = 'pt'; setSky('blue'); camLook(0, 24, -30, 0, 0, -36, 52, 0);
      ptWorld(t, b, { qn: 30, lift: 1, roll: Math.max(0, lb - 0.5) * 7 });   // the rigs roll over the legend from the next half-beat
      S.leg = legend(ptGroundMat, 'pave', text, 0, -36, 9.5, 1, 0, '#f4f2ea');
      S.rain = 0.3; S.lens = {}; break;
    }
    case 'aerial': {                                 // OF MILLIONS.: over the warehouse roof, the metro's lights come on outward from the port
      S.world = 'pt'; setSky('blue'); const u = ease.inOutCubic(clamp(lb / 2));
      // the text first; then the drone climbs and the lens swings up and west over the metro as its lights come on
      const v = ease.inOutCubic(clamp((lb - 0.5) / 1.4));
      camLook(WH.x - 30 + v * 40, lerp(78, 330, v), WH.z + 70 - v * 60, lerp(WH.x - 30, -2600, v), 0, lerp(WH.z - 90, -3400, v), lerp(58, 64, v), 0);
      ptWorld(t, b, { qn: 30, dotAz: 0.1, dotEl: 0.28 });
      FIELD.visible = true; for (const m of ptSil) m.visible = false; ptGround.visible = v < 0.2; FIELD.material.uniforms.grow.value = lerp(0.03, 1.15, Math.pow(clamp((t - tS) / (2 * SPB)), 1.3)); FIELD.material.uniforms.focal.value = focalOf(cam, RH);
      roofFace.show('pave', text).basis(WH.x - 30, WH.h + 1.25, WH.z, 50, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)).lit({ key: [0.75, 0.7, 0.62], flood: [0.25, 0.18, 0.1], fog: PTFOG });
      S.face = roofFace; S.rain = 0.2; S.lens = {}; break;
    }
    case 'gateCam0': case 'gateCam': case 'gateCam2': {               // MANAGEMENT, / AND CONTROL,: the terminal's gate camera, a box on every rig
      S.world = 'pt'; setSky('blue'); const tight = name === 'gateCam2';
      if (tight) camLook(6, 12 - lb * 0.4, 40, 1.5, 0, 76, 44, 0); else if (name === 'gateCam0') camLook(-30, 48, -60, -50, 0, -200, 50, 0); else camLook(-14, 15, 28, 0, 0, 70, 56, 0.0);
      ptWorld(t, b, { qn: 30, lift: 0, dotAz: 0.6, dotEl: 0.2 });
      S.ov = 'gateCam'; S.tight = tight; S.rain = 0.25; S.lens = { distort: 0.05, sat: 0.7 }; break;
    }
    case 'vmsPort': {                                // EARLY.: the port's message sign over the exit road
      S.world = 'pt'; setSky('blue'); const zV = -120;
      camLook(2.2, 3.2 + lb * 0.3, zV + 20 - lb * 1.5, 0.3, 7.2, zV, 40, 0.02);
      ptWorld(t, b, { qn: 12, lift: 1, roll: 5 });
      ptFace.show('vms', text).at(0, 7.4, zV, 8.4, snap).lit({ key: [0.05, 0.05, 0.05], emis: 0.42, fog: PTFOG });
      ptStruct.box(0, 7.4, zV - 0.45, 8.8, 3, 0.7); ptStruct.post(-6, 0, 9.2, zV - 0.45, 0.5); ptStruct.post(6, 0, 9.2, zV - 0.45, 0.5); ptStruct.box(0, 9.2, zV - 0.45, 12.5, 0.4, 0.4);
      S.face = ptFace; S.rain = 0.6; S.lens = {}; break;
    }
    case 'horns': case 'booms': {                    // EARLY. / HAMMER DOWN.: the gate canopy's lightbox; highs flashing / the booms lift
      S.world = 'pt'; setSky('blue');
      if (name === 'horns') { const f2 = Math.max(0, Math.sin(lb * Math.PI * 4)) * clamp(lb * 3); camLook(0, 5.6, 56 - lb * 1.5, 0, 9.8, 0, 48, 0); ptWorld(t, b, { qn: 30, flash: f2 });
        ptFace.show('lightbox', text).at(0, 10.9, GATE_Z + 8.3, 19, snap).lit({ key: [0.3, 0.27, 0.22], flood: [0.3, 0.22, 0.12], emis: 0.18, fog: PTFOG }); S.lens = {}; }
      else { const ag = (t - tS), sg = 1 + 1.3 * Math.exp(-ag * 7); camLook(0.4, 1.7 + 0.25 * Math.exp(-ag * 9) * Math.sin(ag * 60), -42 + lb * 2, 0, 6.2, 0, 44, 0.02);
        ptWorld(t, b, { qn: 30, lift: 1, roll: Math.max(0, lb - 0.4) * 1.6, flash: 0.6 * Math.exp(-ag * 8), surge: sg }); if (PTHEMI) PTHEMI.intensity = 1.1 * sg;
        ptFace.show('lightbox', text).at(0, 10.9, GATE_Z - 8.3, 15, Math.PI + snap).lit({ key: [0.32 * sg, 0.28 * sg, 0.22 * sg], flood: [0.35 * sg, 0.25 * sg, 0.12 * sg], emis: 0.18, fog: PTFOG }); S.lens = { ca: 0.008 * Math.exp(-ag * 14) }; }
      for (const x of [-9, 9]) ptStruct.post(x, 9.1, 10.9 - 1.77, GATE_Z + (name === 'horns' ? 8 : -8), 0.3);
      S.face = ptFace; S.rain = 0.55; break;
    }
    case 'wheel': {                                  // WHO OWNS / THE MACHINES?: from behind the driver's shoulder, a gloved hand on the rim against the glass
      S.world = 'pt'; setSky('blue'); const cz = 40 - (t - tS) * 3.2;   // creeping in the queue: the port lights slide across the glass
      camLook(-5.5, 2.9, cz, -3.2, 6.8, cz - 60, 50, 0.01);
      ptWorld(t, b, { qn: 30, skipLane: 2, rz: cz - 1.3, rx: -5.6, own: false, dotAz: 0.3, dotEl: 0.22 });
      S.ov = 'wheel'; S.sky = true; S.skyYs = [330, 520]; S.drop = 0.3; S.grime = 0.45; S.rain = 0.3; S.lens = {}; break;
    }
    case 'posterLook': {                             // WHO OWNS / THE FUTURE?: the poster frame, the trucker looks up at the dot
      const stop = ZH - V * B.barLen * 4.2;
      camLook(14, 1.5, stop, 54, 1.5 + 40 * Math.tan(0.44), stop + 12, 52, 0); hwWorld(t, b, { rz: stop, rx: 8.6, head: 0.6, dot: false, sil: false });
      S.ov = 'posterLook'; S.sky = true; S.skyYs = [470, 660]; S.push = ease.inOutCubic(clamp(lb / 2)); S.lens = { sat: 1.0 }; break;
    }
    case 'rollCranes': {                             // HERE WE COME.: tracking a box through the crane legs
      S.world = 'pt'; setSky('blue'); const rigZ = -112 - (t - tS) * 9;
      camLook(CRANE_X - 7 - 22, 2.6, rigZ + 9 - 0.5, CRANE_X - 7, 3.2, rigZ + 9, 56, 0);
      ptWorld(t, b, { qn: 30, lift: 1, roll: 6 + lb, extra: [[CRANE_X - 7, rigZ, 0], [CRANE_X - 7, rigZ + 24, 0], [CRANE_X + 6, rigZ - 30, 0]] });
      ptFace.show('container', text, { livery: '#b4541e' }).at(CRANE_X - 7 - 1.3, 2.72, rigZ + 9, 12.2, -Math.PI / 2 + snap * 0.3).lit({ key: [0.55, 0.38, 0.22], flood: [0.5, 0.3, 0.12], fog: PTFOG, flash: fl * 0.6 });
      S.face = ptFace; S.rain = 0.6; S.lens = {}; break;
    }
    case 'rollDark': break;
    case 'bridge1': case 'bridge2': case 'payGantry': {   // THE FUTURE / BELONGS TO / THE WORKING CLASS.: three bridges in a row
      // each bridge's legend is dark until our beams reach it; on the hit the driver flashes the highs and every button
      // fires; the rig rolls on toward the next. The last one holds four beats and goes dark overhead as we pass under.
      S.world = 'pt'; setSky('blue'); payBridge.visible = true;
      const key = name === 'bridge1' ? 'THE FUTURE' : name === 'bridge2' ? 'BELONGS TO' : 'THE WORKING CLASS.', L = PAYL[key], Mt = PAYM[key];
      payPanel.material = Mt;
      const zF = PAY_Z + 0.64, hitT = tS, fr = Math.round((t - hitT) * 30), last = name === 'payGantry';
      const ag = t - hitT; let d = (last ? 24 : 30) - 7.5 * ag - 0.6 * ag * ag, cy = 2.4 + 0.02 * Math.sin(t * 11), pitch;
      const p6 = Math.atan2(PAYY - 0.3 - cy, 6);
      pitch = d > 6 ? Math.atan2(PAYY - 0.3 - cy, d) : d > 0 ? lerp(p6, 1.15, ease.inOutCubic(1 - d / 6)) : lerp(1.15, 0.1, ease.inOutCubic(clamp(-d / 9)));
      const fovP = Math.min(66, 2 * Math.atan(8.6 / (2 * Math.max(d, 4) * (W / H))) * 180 / Math.PI);
      camLook(PAYX + (name === 'bridge2' ? -0.8 : name === 'bridge1' ? 0.8 : 0), cy, zF + d, PAYX, cy + Math.sin(pitch) * 50, zF + d - Math.cos(pitch) * 50, Math.max(30, fovP), 0.004 * Math.sin(t * 7));
      ptWorld(t, b, { qn: 0, lift: 1, roll: 0, rz: zF + d + 1.2, rx: PAYX, own: false, dotAz: 0.34, dotEl: 0.36, head: 1 });
      headlights(cam);
      const high = fr < 0 ? 0 : fr < 1 ? 1 : fr < 11 ? lerp(1, 0.7, (fr - 1) / 10) : last ? 0.7 * (1 - smooth(59, 60, b)) : 0.7;
      for (const m of [Mt, payTabMat]) { m.uniforms.uHigh.value = high; m.uniforms.uCut.value = 9.0; m.uniforms.uPitch.value = Math.max(6.5, Math.atan2(PAYY + 1.7 - (cy - 1.25), Math.max(d, 0.5)) * 180 / Math.PI - 13); }
      payShield.material.uniforms.flare.value = 0.05 + 0.5 * high; payShield.material.uniforms.amb.value = 0.05;
      S.btn = () => panelMetrics(payPanel, L, text);
      S.drop = 0.18; S.grime = 0.25; S.rain = 0.35; S.lens = { hal: 0, ca: 0.006 * Math.exp(-Math.max(0, t - hitT) * 14) }; break;
    }
    case 'exitGantry': {                             // (the loop) rolling out of the port toward the next gantry: EXIT 2036. at low beam, the lockup lands over it
      S.world = 'pt'; setSky('dusk'); const u = clamp((b - 60) / 8), d = lerp(56, 24.6, ease.outCubic(u)); const cz = EXIT_Z + d;
      camLook(1.6, 2.7, cz, lerp(2.4, 2.6, u), lerp(5.4, 6.2, u), cz - 30, lerp(30, 62, ease.inOutCubic(u)), 0);
      ptWorld(t, b, { qn: 0, gantry: true, sign: text || 'OF MILLIONS.', rz: cz + 1.2, rx: 1.8, own: false, flare: 0.5, sweep: -1, dotEl: 0.5, dotAz: 0.25, dot: bq < LOCK });
      S.sign = text || 'OF MILLIONS.'; S.gantry2 = true; S.ov = 'hood'; S.drop = 0.3; S.grime = 0.55; S.rain = 0.5; S.lens = {}; break;
    }
  }
  if (S.sky && text) { const w0 = COUPLET[text]; S.skyType = w0 ? { lines: [w0, text], ages: [age + SPB, age], ys: S.skyYs } : { lines: [text], ages: [age], ys: S.skyYs }; }
  hwStruct.commit(); ptStruct.commit();
  if (S.lamps) { S.lamps(); hwL.commit(); }
  if (S.murLamps) { for (const dz of [-11, 11]) { ptL.add(WH.x + 7, 0.8, WH.z + dz, 1.8, 1.4, 0.8, 0.9); ptL.add(WH.x + 7, 1.6, WH.z + dz, 0.4, 0.3, 0.2, 0.25); } ptL.commit(); }
  if (S.wallLit) { for (let k = 0; k < 7; k++) ptL.add(WH.x + 1.4, 14.4, WH.z - 18 + k * 6, 1.6, 1.2, 0.7, 0.5); ptFace.u.flood.value.setRGB(1.1, 0.82, 0.5); ptFace.u.key.value.setRGB(0.16, 0.12, 0.1); ptL.commit(); }
  return { S, b, lb, name, kick, imp, frameN, text, age };
}

// the mirror's content: the convoy behind us, headlights as oval bokeh
function renderMirror(S) {
  const m = S.mirror, sx = RW / W, sy = RH / H;
  const x = Math.round(m.x * sx), y = Math.round((H - m.y - m.h) * sy), w = Math.round(m.w * sx), h = Math.round(m.h * sy);
  mcam.position.set(0.15, 3.0, m.rz - 1.1); mcam.fov = 46; mcam.aspect = w / h; mcam.up.set(0, 1, 0); mcam.lookAt(1.2, 2.0, m.rz + 80); mcam.updateProjectionMatrix(); mcam.updateMatrixWorld();
  hwL.mat.uniforms.bokeh.value = 1; hwL.mat.uniforms.hideRefl.value = 1; hwL.mat.uniforms.focal.value = focalOf(mcam, h); hwL.mat.uniforms.bokehK.value = 1.4;
  renderer.setRenderTarget(null); renderer.setScissorTest(true); renderer.setScissor(x, y, w, h); renderer.setViewport(x, y, w, h);
  renderer.setClearColor(0x000000, 1); renderer.clear(true, true); renderer.render(HW, mcam);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, RW, RH);
  hwL.mat.uniforms.bokeh.value = 0; hwL.mat.uniforms.hideRefl.value = 0;
}

// ================================================================= renderFrame
const _px = new Uint8Array(4 * 5);
window.renderFrame = async (t) => {
  const bq = B.beat(t + 0.5 / 30), frameN = Math.round(t * 30);
  const F = frame(t), S = F.S;
  const scene = S.world === 'hw' ? HW : PT, L = S.world === 'hw' ? hwL : ptL;
  const target = S.lo ? rtLo : rt;
  L.mat.uniforms.focal.value = focalOf(cam, target.height);
  renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, cam);
  // windshield pass to the canvas (droplets, grime, rain lit by whatever light is behind it)
  passMat.uniforms.tS.value = target.texture; passMat.uniforms.drop.value = S.drop; passMat.uniforms.grime.value = S.grime;
  passMat.uniforms.rainA.value = S.rain * 0.45; passMat.uniforms.time.value = t;
  passMat.uniforms.off.value.set(0, -t * 0.012); passMat.uniforms.sharp.value = S.lo ? 0 : 0.45; passMat.uniforms.px.value.set(1 / target.width, 1 / target.height);
  renderer.setRenderTarget(null); renderer.setViewport(0, 0, RW, RH); renderer.render(passScene, passCam);
  // is the red dot in the clear? (5 taps in the rendered frame: all must read as the dot's red)
  let dotS = null;
  if (DOT && !S.mirror) { const v = DOT.p.clone().project(cam);
    if (v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) { const gl = renderer.getContext(), px = (v.x + 1) / 2 * RW, py = (v.y + 1) / 2 * RH, r = DOT.rpx * RS * 0.6; let ok = true;
      [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].forEach(([dx, dy], i) => { gl.readPixels(Math.round(px + dx), Math.round(py + dy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, _px.subarray(i * 4, i * 4 + 4)); });
      for (let i = 0; i < 5; i++) { const R = _px[i * 4], G = _px[i * 4 + 1]; if (!(R > 90 && R > G * 1.8)) ok = false; }
      if (ok) dotS = { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, r: DOT.rpx }; } }
  if (S.mirror) renderMirror(S);
  // 2D composite
  cg.globalCompositeOperation = 'source-over'; cg.globalAlpha = 1; DOT2D = null;
  RQ.present(cg, renderer.domElement, renderer.getContext(), { w: W, h: H });
  if (S.shade) { cg.fillStyle = `rgba(2,4,5,${S.shade})`; cg.fillRect(0, 0, W, H); }
  overlay(cg, S, F, t);
  if (S.rain) rain(cg, frameN, Math.round(90 * S.rain), 0.16);
  // where the line landed (read back by the review script: the 150 px floor)
  window.__type = F.text ? (S.btn ? S.btn() : S.face ? S.face.metrics() : S.leg ? legendMetrics(S.leg) : S.sign ? signMetrics(S.gantry2 ? gantry2.children.find(c => c.material === sign.material) || sign : sign, S.sign) : TYPE2D) : null;
  // post: the lens (no bloom, no streaks, no white lift)
  post.apply(comp, t, lensOpts(S.lens), { ctx: out });
  // the sky type of the couplet, set after the lens: flat, white, a dark keyline, the hit's chroma ghost settling
  if (S.skyType) skyType(out, S.skyType);
  // the red dot: one flat disc on top of the lens
  const dd = DOT2D || dotS; if (dd && bq < LOCK) flatDot(out, dd.x, dd.y, dd.r);
  if (dd) LASTDOT = dd;
  if (bq >= LOCK) lockup(out, Math.max(0, (B.beat(t) - LOCK) * SPB), LASTDOT);
};
let DOT2D = null, LASTDOT = null;
function flatDot(g, x, y, r) { g.save(); g.fillStyle = P.dot; g.beginPath(); g.arc(x, y, r, 0, 6.28); g.fill(); g.restore(); }
// the couplet: WHO OWNS / THE MACHINES? set flat in the sky (Ruscha-plain): white heavy condensed caps, 3 px keyline
function skyType(g, { lines, ages, ys = [760, 960] }) {
  g.save(); g.textAlign = 'center'; g.lineJoin = 'round';
  const face = z => `400 ${z}px "Anton"`, maxW = 960;
  lines.forEach((txt, i) => {
    let s = 260; g.font = face(s); while (g.measureText(txt).width > maxW) { s -= 4; g.font = face(s); }
    const off = lerp(7, 0, ease.outCubic(clamp(ages[i] / 0.13))), y = ys[i], x = W / 2;   // v8: the hit's ghost only (4 frames), never a standing fringe
    if (off > 0.5) { g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(229,50,57,${0.08 * off})`; g.fillText(txt, x + off, y); g.fillStyle = `rgba(40,190,210,${0.065 * off})`; g.fillText(txt, x - off, y); }
    g.globalCompositeOperation = 'source-over'; g.strokeStyle = 'rgba(6,10,12,0.92)'; g.lineWidth = 6; g.strokeText(txt, x, y); g.fillStyle = '#F4F2EA'; g.fillText(txt, x, y);
    if (i === lines.length - 1) { const m = g.measureText(txt); TYPE2D = { text: txt, cap: m.actualBoundingBoxAscent, span: m.width, lx: x - m.width / 2, rx: x + m.width / 2 }; }
  });
  g.restore();
}
// the sign-off laid over the last world frame: a flat panel of the piece's teal, the ☭≡/acc lockup, ACP.US; the red dot
// flies down from the sky and docks as the gear's hub
function lockup(g, age, dot) {
  const a = ease.outExpo(clamp(age / 0.25)), y0 = 1330, hh = 500;
  g.save(); g.globalAlpha = a; g.fillStyle = P.teal; g.fillRect(0, y0 - hh / 2, W, hh);
  g.fillStyle = '#F4F2EA'; g.fillRect(0, y0 - hh / 2, W, 5); g.fillRect(0, y0 + hh / 2 - 5, W, 5); g.restore();
  const k = Math.exp(-age * 10), size = 200 * (1 + 0.3 * k), cy = y0 - 60;
  sigil(g, W / 2, cy, size, { color: '#F4F2EA', accent: '#F4F2EA', alpha: a });
  line(g, 'ACP.US', W / 2, y0 + 200, { family: 'Archivo Black', size: 76, color: '#F4F2EA', alpha: clamp((age - 0.3) * 5) });
  const L = BRAND.acc_lockup, M = BRAND.acp_mark, wL = L.width * size / L.height, hx = W / 2 - wL / 2 + (M.width * size / L.height) / 2, hy = cy;
  const u = ease.inOutCubic(clamp((age - 0.1) / 0.35)), from = dot || { x: W * 0.8, y: 360, r: 0.04 * W };
  flatDot(g, lerp(from.x, hx, u), lerp(from.y, hy, u), lerp(from.r, size * 0.11, u));
}

const flyer = { art: null };
function overlay(g, S, F, t) {
  const { b, lb, kick } = F;
  switch (S.ov) {
    case 'hood': { // dash mount: the hood's crown and the wiper rest at the bottom edge
      const y = 1780; const gr = g.createLinearGradient(0, y - 60, 0, H); gr.addColorStop(0, '#223a3c'); gr.addColorStop(0.15, '#0a1010'); gr.addColorStop(1, '#050707');
      g.fillStyle = gr; g.beginPath(); g.moveTo(-10, H + 10); g.lineTo(-10, y + 40); g.quadraticCurveTo(W / 2, y - 70, W + 10, y + 40); g.lineTo(W + 10, H + 10); g.fill();
      g.strokeStyle = '#050606'; g.lineWidth = 12; g.beginPath(); g.moveTo(60, y - 20); g.lineTo(520, y - 60); g.moveTo(560, y - 60); g.lineTo(1020, y - 20); g.stroke();
      break;
    }
    case 'pillars': drawPillars(g); break;
    case 'cab': drawPillars(g); drawCab(g, S.cab); break;
    case 'dashcam': { // the dash-cam file: OSD in Plex Mono
      g.save(); g.font = '700 40px "Plex Mono"'; g.fillStyle = '#f2f2e8'; g.shadowColor = '#000'; g.shadowBlur = 6;
      g.fillText('NOV 1, 2022', 54, 118); g.fillText(`19:42:${String(7 + Math.floor(lb * SPB)).padStart(2, '0')}`, 54, 170);
      g.fillStyle = frameIsRec(t) ? '#ff2020' : 'rgba(255,32,32,0.2)'; g.beginPath(); g.arc(W - 200, 104, 14, 0, 6.28); g.fill(); g.fillStyle = '#f2f2e8'; g.fillText('REC', W - 176, 118);
      g.strokeStyle = 'rgba(242,242,232,0.7)'; g.lineWidth = 3; for (const [x, y, sx, sy] of [[30, 40, 1, 1], [W - 30, 40, -1, 1], [30, H - 130, 1, -1], [W - 30, H - 130, -1, -1]]) { g.beginPath(); g.moveTo(x, y + 50 * sy); g.lineTo(x, y); g.lineTo(x + 50 * sx, y); g.stroke(); }
      g.restore(); break;
    }
    case 'poster': case 'posterLook': { const d = posterPhoto(g, S.push || 0); DOT2D = { x: d.x, y: d.y, r: d.r };
      if (S.print) printType(g, S.print, F.age, false); break; }
    case 'wheel': {                                   // the couplet's first half: the film grip closes on THE MACHINES? (b49)
      drawPillars(g, 1, 'rgba(255,150,70,0.28)');
      g.save(); const dg = g.createLinearGradient(0, 1500, 0, H); dg.addColorStop(0, 'rgba(4,6,7,0)'); dg.addColorStop(0.2, '#050707'); dg.addColorStop(1, '#030404'); g.fillStyle = dg; g.fillRect(0, 1500, W, H - 1500); g.restore();
      driver(g, t, 49 * SPB); break; }
    case 'gateCam': gateHUD(g, F, t, S.tight); break;
    case 'flyer': drawFlyer(g, F, t); break;
    case 'cbMacro': drawCB(g, F, t); break;
  }
  if (S.mirror) { const m = S.mirror; drawMirror(g, m.x, m.y, m.w, m.h, 1, (gg, x, y, w, h) => { gg.drawImage(renderer.domElement, x * RS, y * RS, w * RS, h * RS, x, y, w, h); if (m.etch) etch(gg, m.etch, x, y, w, h, F.age); }, '#070909', '#7fb4b2');
    g.save(); const dg = g.createLinearGradient(0, 1660, 0, H); dg.addColorStop(0, '#3a1012'); dg.addColorStop(0.08, '#1c0708'); dg.addColorStop(1, '#070303'); g.fillStyle = dg; g.beginPath(); g.moveTo(-10, 1740); g.lineTo(W + 10, 1700); g.lineTo(W + 10, H + 10); g.lineTo(-10, H + 10); g.fill();
    g.strokeStyle = 'rgba(140,200,196,0.6)'; g.lineWidth = 3; g.beginPath(); g.moveTo(-10, 1740); g.lineTo(W + 10, 1700); g.stroke(); g.restore(); }
  if (S.brake !== undefined) { // air-brake blowdown: vapour puffs from under the tractor, stateless in the shot's age
    const age = S.brake * SPB; g.save(); g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 40; k++) { const a = age - 0.05 - hash(k) * 0.3; if (a <= 0) continue; const x = 760 + hash(k + 3) * 260 + a * (hash(k + 7) - 0.5) * 500, y = 1500 - a * 120 * hash(k + 11), r = 30 + a * 260 * hash(k + 5);
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(160,190,190,${0.12 * Math.exp(-a * 2)})`); gr.addColorStop(1, 'rgba(160,190,190,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    g.restore(); }
}
const frameIsRec = t => Math.floor(t * 2) % 2 === 0;
// the line etched into the mirror glass (where OBJECTS IN MIRROR would be): frosted letters that catch the headlights in the glass
function etch(g, text, x, y, w, h, age) {
  g.save(); let s = 200; g.font = `400 ${s}px "Anton"`; while (g.measureText(text).width > w * 0.9) { s -= 4; g.font = `400 ${s}px "Anton"`; }
  const tw = g.measureText(text).width, cap = g.measureText('H').actualBoundingBoxAscent, bx0 = x + (w - tw) / 2, by = y + h - 70;
  g.fillStyle = 'rgba(210,235,232,0.30)'; g.fillText(text, bx0, by);
  g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(255,250,240,${0.25 + 0.5 * Math.exp(-age * 6)})`; g.fillText(text, bx0, by);
  g.globalCompositeOperation = 'source-over'; g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; g.strokeText(text, bx0 + 2, by + 2);
  g.restore(); TYPE2D = { text, cap, span: tw, lx: bx0, rx: bx0 + tw };
}
// the poster's own print type: cream ink over a misregistered red plate, a little ink spread, set on the poster's grid
function printType(g, text, age, wide) {
  g.save(); let s = wide ? 330 : 300; const face = (z) => `400 ${z}px "Anton"`; g.font = face(s); while (g.measureText(text).width > 900) { s -= 6; g.font = face(s); }
  const tw = g.measureText(text).width, cap = g.measureText('H').actualBoundingBoxAscent, x = 90, y = wide ? 470 : 560;
  const sl = ease.outCubic(clamp(age / 0.12)), yy = y + (1 - sl) * 40;
  g.globalAlpha = sl; g.fillStyle = '#c0161a'; g.fillText(text, x + 9, yy + 7);
  g.fillStyle = '#efe4c8'; g.fillText(text, x, yy);
  g.globalCompositeOperation = 'destination-out'; const R = rng(text.length * 5); for (let k = 0; k < 500; k++) { g.fillStyle = `rgba(0,0,0,${0.2 + R() * 0.5})`; g.fillRect(x + R() * tw, yy - cap + R() * cap, 1 + R() * 3, 1 + R() * 3); }
  g.restore(); TYPE2D = { text, cap, span: tw, lx: x, rx: x + tw };
}
// the flyer handed up to the cab: the organiser's arm in a hi-vis sleeve from below, the driver's glove from the window
function drawFlyer(g, F, t) {
  const { text, age } = F; if (!text) return; if (!flyer.art || flyer.text !== text) { flyer.art = flyerArt(text); flyer.text = text; }
  const up = ease.outBack(clamp(age / 0.22)), lift = (1 - up) * 520 + Math.sin(t * 2.3) * 6;
  // the door and the window frame (we lean out of the cab)
  g.save(); g.fillStyle = '#060707'; g.fillRect(0, 0, 70, H); g.fillRect(0, 0, W, 60);
  g.strokeStyle = 'rgba(255,170,90,0.45)'; g.lineWidth = 3; g.beginPath(); g.moveTo(70, 60); g.lineTo(70, H); g.moveTo(70, 60); g.lineTo(W, 60); g.stroke(); g.restore();
  // the organiser's arm: sleeve silhouette with retroreflective bands, from the bottom right
  const fx = 560, fy = 930 + lift, fw = 930, fh = fw * flyer.art.c.height / flyer.art.c.width, rot = -0.07;
  g.save(); g.translate(fx + fw * 0.3, fy + fh * 0.42); g.rotate(-0.5);
  const arm = new Path2D(); arm.moveTo(-70, 0); arm.lineTo(70, 0); arm.lineTo(150, 1100); arm.lineTo(-120, 1100); arm.closePath();
  g.fillStyle = '#0a0a08'; g.fill(arm); g.strokeStyle = 'rgba(255,160,80,0.5)'; g.lineWidth = 4; g.stroke(arm);
  { const yy = 300; g.fillStyle = `rgba(200,210,190,${0.35 + 0.25 * kickOf(t)})`; g.beginPath(); g.moveTo(-70 - yy * 0.045, yy); g.lineTo(70 + yy * 0.075, yy); g.lineTo(70 + (yy + 26) * 0.075, yy + 26); g.lineTo(-70 - (yy + 26) * 0.045, yy + 26); g.fill(); }
  g.fillStyle = '#050505'; g.fillRect(-78, -10, 156, 70);   // knit cuff
  g.restore();
  // the flyer itself (print, lit by the sodium from above and a headlight from the right)
  g.save(); g.translate(fx, fy); g.rotate(rot);
  stripDraw(g, flyer.art.c, 0, 0, fw, fh, 0.14);
  const lg = g.createLinearGradient(-fw / 2, -fh / 2, fw / 2, fh / 2); lg.addColorStop(0, 'rgba(255,170,80,0.10)'); lg.addColorStop(0.6, 'rgba(40,20,0,0.20)'); lg.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.globalCompositeOperation = 'multiply'; g.fillStyle = '#e8b27a'; g.fillRect(-fw / 2 - 20, -fh / 2 - 20, fw + 40, fh + 40); g.globalCompositeOperation = 'source-over'; g.fillStyle = lg; g.fillRect(-fw / 2 - 20, -fh / 2 - 20, fw + 40, fh + 40);
  // the organiser's glove pinching the lower right corner, the driver's glove taking the top left
  // the organiser's glove pinching the lower right corner, the driver's glove taking the top left: silhouettes, never fingers
  drawGlove(g, fw * 0.40, fh * 0.46, 0.8, -0.35 + Math.PI, 'rgba(255,170,90,0.4)');
  const reach = ease.outCubic(clamp((age - 0.25) / 0.35));
  g.save(); g.translate(-fw * 0.42 - (1 - reach) * 240, -fh * 0.5 - (1 - reach) * 300);
  g.fillStyle = '#0c0b09'; g.beginPath(); g.moveTo(-40, -30); g.lineTo(60, -10); g.lineTo(-160, -900); g.lineTo(-360, -900); g.closePath(); g.fill();   // the driver's forearm from the cab window
  drawGlove(g, 0, 0, 0.85, 2.6 + Math.PI, 'rgba(255,170,90,0.4)'); g.restore();
  g.restore();
  TYPE2D = { text, cap: flyer.art.cap * fh, span: flyer.art.span * fw * 0.99, lx: fx - fw * flyer.art.span / 2, rx: fx + fw * flyer.art.span / 2 };
}
const kickOf = t => B.env('kick', t, 9);
// the CB radio in macro: the faceplate fills the frame under the dash, the mic keyed in a glove
const cbC = { art: null };
function drawCB(g, F, t) {
  const { text, age } = F; if (!text) return; if (!cbC.art || cbC.text !== text) { cbC.art = cbArt(text); cbC.text = text; }
  g.save(); const dg = g.createLinearGradient(0, 700, 0, H); dg.addColorStop(0, 'rgba(0,0,0,0)'); dg.addColorStop(0.12, 'rgba(6,7,8,0.96)'); dg.addColorStop(1, '#050606'); g.fillStyle = dg; g.fillRect(0, 700, W, H - 700);
  const cw = 1040, ch = cw * cbC.art.c.height / cbC.art.c.width, cx = W / 2 + 10, cy = 1150 + (1 - ease.outCubic(clamp(age / 0.2))) * 60;
  g.shadowColor = 'rgba(255,150,40,0.35)'; g.shadowBlur = 60; stripDraw(g, cbC.art.c, cx, cy, cw, ch, -0.1); g.shadowBlur = 0;
  // glove and mic cord from the right
  g.strokeStyle = '#0c0c0c'; g.lineWidth = 9; g.beginPath(); g.moveTo(cx + cw * 0.42, cy + ch * 0.45);
  for (let k = 0; k < 30; k++) { const u = k / 29; g.lineTo(lerp(cx + cw * 0.42, 1000, u) + Math.sin(k * 2.4) * 14, lerp(cy + ch * 0.45, 1800, u) + Math.cos(k * 2.4) * 9); } g.stroke();
  g.fillStyle = '#1e1a14'; g.beginPath(); g.ellipse(930, 1790, 120, 170, -0.4, 0, 6.28); g.fill(); g.fillStyle = '#121416'; g.beginPath(); g.roundRect(860, 1600, 120, 230, 44); g.fill();
  g.fillStyle = '#ff2a14'; g.shadowColor = '#ff2a14'; g.shadowBlur = 16; g.beginPath(); g.arc(950, 1660, 7, 0, 6.28); g.fill(); g.restore();
  TYPE2D = { text, cap: cbC.art.cap * ch, span: cbC.art.span * cw * 0.99, lx: cx - cw * cbC.art.span / 2, rx: cx + cw * cbC.art.span / 2 };
}

function posterOverlay(g, kind, lb, t, look = 0) {
  // the poster frame: dot upper right, the trucker's profile lower left, the mirror at right edge
  const push = kind === 'posterPush' ? 1 + lb * 0.03 : kind === 'posterTight' ? 1.28 : 1;
  const breath = Math.sin(t * 1.3) * 3 + Math.sin(t * 0.47) * 2;
  if (kind !== 'posterWide') {
    // the red dot, poster-flat
    const dx = kind === 'posterTight' ? 760 : 810, dy = kind === 'posterTight' ? 330 : 270, r = 36 * (kind === 'posterMirror' ? 0.8 : 1);
    if (kind !== 'posterMirror') { const R2 = 0.04 * W; g.save(); const gr = g.createRadialGradient(dx, dy, R2, dx, dy, R2 * 2.4); gr.addColorStop(0, 'rgba(4,10,12,0.35)'); gr.addColorStop(1, 'rgba(4,10,12,0)'); g.fillStyle = gr; g.fillRect(dx - R2 * 3, dy - R2 * 3, R2 * 6, R2 * 6); g.restore();
      flatDot(g, dx, dy, R2); DOT2D = { x: dx, y: dy, r: R2 }; void r; }   // one flat disc, a soft dark halo; redrawn after the lens
    // the horizon: a thin warm band with poles and a lamp mast, poster-flat
    g.save(); g.fillStyle = '#060909'; for (const [x, hh] of [[700, 260], [690, 60], [930, 90], [1000, 40], [1060, 70], [180, 50], [300, 30]]) { g.fillRect(x, H - 40 - hh, 5, hh); if (hh > 50) g.fillRect(x - 18, H - 40 - hh, 40, 6); }
    g.fillRect(0, H - 44, W, 44); g.restore();
    if (kind === 'posterMirror') {            // the mirror close: the teal sky, the warm band and the red dot held in its glass; the cap brim entering
      drawMirror(g, 470, 330, 500, 1250, 1.2, (gg, x, y, w, h) => {
        const gr = gg.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#0f2a2e'); gr.addColorStop(0.6, '#2c5a5c'); gr.addColorStop(0.8, '#4f7c7a'); gr.addColorStop(0.86, '#c07a42'); gr.addColorStop(0.9, '#3a2618'); gr.addColorStop(1, '#0a0806'); gg.fillStyle = gr; gg.fillRect(x, y, w, h);
        const dx = x + w * 0.42 + lb * 20, dy = y + h * 0.56; const hg = gg.createRadialGradient(dx, dy, 30, dx, dy, 170); hg.addColorStop(0, 'rgba(120,16,14,0.5)'); hg.addColorStop(1, 'rgba(120,16,14,0)'); gg.fillStyle = hg; gg.fillRect(dx - 170, dy - 170, 340, 340);
        gg.fillStyle = P.dot; gg.beginPath(); gg.arc(dx, dy, 34, 0, 6.28); gg.fill();
        gg.fillStyle = '#060808'; for (const [px_, ph] of [[0.15, 0.2], [0.4, 0.07], [0.85, 0.12]]) { gg.fillRect(x + w * px_, y + h * (0.88 - ph), 5, h * ph); gg.fillRect(x + w * px_ - 18, y + h * (0.88 - ph), 40, 5); }
        gg.fillRect(x, y + h * 0.885, w, h * 0.2);
        for (let k = 0; k < 40; k++) { gg.fillStyle = `rgba(200,230,228,${0.2 + 0.3 * hash(k + 5)})`; gg.beginPath(); gg.ellipse(x + hash(k) * w, y + hash(k + 1) * h, 2 + 5 * hash(k + 2), 3 + 6 * hash(k + 3), 0, 0, 6.28); gg.fill(); }
      }, '#060808', '#7fb4b2');
      g.save(); g.translate(-230, 250); drawTrucker(g, 0.95, 0, 0, 0.2); g.restore();
      return;
    }
    g.save(); const s = push; g.translate(-(s - 1) * 300, -(s - 1) * 1700 + breath);
    drawTrucker(g, s, -40, 20, 0.2 + 0.07 * look); g.restore();
    drawMirror(g, 975, 1215, 130, 470, 1, (gg, x, y, w, h) => { const gr = gg.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#16383c'); gr.addColorStop(1, '#2c5456'); gg.fillStyle = gr; gg.fillRect(x, y, w, h); }, '#060808', '#6fa6a2');
  } else {
    // wide: the trucker standing beside the parked cab (projected from the world), the whole teal sky over him
    const stop = ZH - V * B.barLen * 4.2, v = new THREE.Vector3(10.7, 0, stop - 1.2).project(cam), fx = (v.x + 1) / 2 * W, fy = (1 - v.y) / 2 * H;
    const hp = 1.8 * focalOf(cam, H) / cam.position.distanceTo(new THREE.Vector3(10.7, 0.9, stop - 1.2)), s = hp / 230;
    g.save(); g.translate(fx, fy - 58 * s); g.scale(s, s); g.fillStyle = '#030505'; const x = 0, y = 0;
    g.save(); g.translate(x - 2, y - 150); g.rotate(-0.35); g.beginPath(); g.ellipse(0, 0, 16, 19, 0, 0, 6.28); g.fill(); g.fillRect(-20, -22, 36, 12); g.fillRect(10, -18, 22, 5); g.restore();
    g.beginPath(); g.moveTo(x - 30, y - 128); g.lineTo(x + 26, y - 128); g.lineTo(x + 24, y - 40); g.lineTo(x - 28, y - 40); g.fill();
    g.fillRect(x - 24, y - 42, 20, 100); g.fillRect(x + 2, y - 42, 20, 100);
    g.save(); g.translate(x + 22, y - 124); g.rotate(-0.35); g.fillRect(-6, 0, 13, 74); g.restore(); g.save(); g.translate(x - 26, y - 124); g.rotate(0.1); g.fillRect(-6, 0, 13, 76); g.restore();
    g.restore();
  }
}

// warm-up: compile every program once (both worlds, the region, the mirror) so frame 0 is not a cold compile
drawSign('EXIT 2036.'); signLabel = 'EXIT 2036.';
for (const tt of [0, 30 * SPB, 32.5 * SPB, 40.5 * SPB, 7 * SPB, 16.3 * SPB, 48.6 * SPB, 55.7 * SPB, 56.3 * SPB, 60.5 * SPB, 64.5 * SPB]) await window.renderFrame(tt);   // incl. the button-copy panels: their first frame must not be the hit
LASTDOT = null;
// the march: step the column through its shot and move anyone whose hand lands on another's crotch in frame
// (people.js hazards(), the gate's people check), so the layout is clean before the first real frame
for (let round = 0; round < 14; round++) { let moved = 0;
  for (let ff = Math.floor(32 * SPB * 30); ff <= Math.ceil(34 * SPB * 30); ff++) { frame(ff / 30);
    for (const h of folk.hazards(cam)) { const A = MARCH.find(q => q.id === h.a), Bm = MARCH.find(q => q.id === h.b), m = A && !A.bearer ? A : Bm && !Bm.bearer ? Bm : null;
      if (m) { if (Math.abs(m.x) < 2.4) m.x += m.x >= 0 ? 0.3 : -0.3; m.z += 0.35; moved++; } } }
  if (!moved) break; }
window.__lab = { renderer, camera: cam, scenes: { hw: HW, pt: PT }, frame, comp, post, B };   // read-only handle for the looks bake (LOOKS c2); renders nothing
window.sceneReady = true;
