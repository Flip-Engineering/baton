// HORDE v12 (cycle 3): the poster layer. Two values and one disc: a blood-red sky falling to near-black, every body
// pure black, one cream sun at 35-45 % of the frame width, the horizon low (Days of Heaven), and the 2D set pieces
// that read better designed than modelled: the Black Sunday dust wall (a GL billow field), Hogan's wild train in
// profile, the fist made of fists (the impact card), the flare smoke, the star field.
import * as THREE from 'three';
import { W, H, clamp, lerp, rng } from '../lib/kit.js';

export const P = {
  sky0: '#040001', sky1: '#2a0204', sky2: '#7a0808', blood: '#b3120f', hot: '#e0321a', low: '#070001',
  cream: '#f3e4c8', disc: '#f6e6c4', ink: '#050101', red: '#d0151c', flat: '#b3120f',
};
const fr = x => x - Math.floor(x);

// ---------------------------------------------------------------- the sky: blood red at the horizon to near-black; one hard cream disc
// o.hy horizon (px), o.sun [x, y, r], o.night 0..1 (the red drains to black), o.halo (the disc's red corona), o.band (a hot
// line on the horizon), o.ground (fill below the horizon)
export function posterSky(g, { hy = 1560, sun = null, night = 0, halo = 1, band = 1, ground = P.low, top = null, discA = 1 } = {}) {
  const u = clamp(hy / H, 0.08, 0.98);
  const k = 1 - night, mix = (a, b, x) => { const A = new THREE.Color(a), B = new THREE.Color(b); return '#' + A.lerp(B, x).getHexString(); };
  const gr = g.createLinearGradient(0, 0, 0, hy);
  gr.addColorStop(0, top || mix(P.sky0, '#000000', night));
  gr.addColorStop(0.42, mix(P.sky1, '#030104', night));
  gr.addColorStop(0.8, mix(P.sky2, '#0a0206', night * 0.9));
  gr.addColorStop(1, mix(P.blood, '#1a0306', night * 0.85));
  g.fillStyle = gr; g.fillRect(0, 0, W, Math.ceil(hy) + 1);
  if (sun && k > 0.02) {
    const [x, y, r] = sun; halo *= 0.3 + 0.7 * discA;
    if (halo > 0) { const q = g.createRadialGradient(x, y, r * 0.9, x, y, r * 3.2); q.addColorStop(0, `rgba(235,70,30,${0.55 * halo * k})`); q.addColorStop(0.45, `rgba(170,20,12,${0.25 * halo * k})`); q.addColorStop(1, 'rgba(120,0,0,0)');
      g.fillStyle = q; g.fillRect(0, 0, W, hy); }
    g.save(); g.beginPath(); g.rect(0, 0, W, hy); g.clip();
    const q = g.createRadialGradient(x, y - r * 0.15, 0, x, y, r); q.addColorStop(0, '#fbf0d8'); q.addColorStop(0.8, P.disc); q.addColorStop(1, '#ecd0a0');
    if (discA > 0.02) { g.globalAlpha = k * discA; g.fillStyle = q; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
    g.restore();
  }
  if (band > 0) { const b = g.createLinearGradient(0, hy - 60, 0, hy + 4); b.addColorStop(0, 'rgba(224,50,26,0)'); b.addColorStop(1, `rgba(240,70,30,${0.55 * band * k})`); g.fillStyle = b; g.fillRect(0, hy - 60, W, 64); }
  if (ground) { g.fillStyle = ground; g.fillRect(0, hy, W, H - hy); }
}
export function stars(g, a, { seed = 3, n = 5200, y0 = 0, y1 = H, drift = 0 } = {}) {
  if (a <= 0) return; const r = rng(seed);
  g.save();
  for (let i = 0; i < n; i++) {
    const x = r() * W, y = y0 + r() * (y1 - y0) + drift * (0.3 + r() * 0.7), m = r(), s = m < 0.012 ? 3.4 : m < 0.08 ? 2.2 : m < 0.4 ? 1.5 : 1;
    const band = Math.exp(-Math.pow((x - W * 0.35 - (y - H * 0.3) * 0.35) / 260, 2));      // a faint Milky Way lane
    if (m > 0.4 && r() > 0.35 + 0.6 * band) continue;
    g.globalAlpha = Math.min(1, a * (0.55 + 0.6 * r())); g.fillStyle = m < 0.03 ? '#ffe8d0' : '#fff6ee'; g.fillRect(x, ((y % H) + H) % H, s * 1.4, s * 1.4);
  }
  g.restore();
}

// ---------------------------------------------------------------- the Black Sunday dust wall (GL): a boiling billow field
// A 2D field on a fullscreen quad: a cauliflower top edge (big lobes on small lobes), domain-warped billows that roll
// toward the lens (the field zooms about its base), lit from behind and above by the red sky (lit crowns, black
// bellies), with pockets of fire inside it (the flares of the men in the storm). Rendered at half size.
const DW_FS = `
precision highp float;
uniform vec2 uRes; uniform float uT, uTop, uBase, uGlow, uRoll, uLit, uSeed, uFront, uSunX; uniform vec3 uBurn;
uniform vec3 uDark, uMid, uRim, uFire;
varying vec2 vUv;
float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h1(i), h1(i + vec2(1, 0)), f.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++) { s += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * vec2(1080.0, 1920.0);
  // roll toward the lens: the field grows about a point on its base
  vec2 c = vec2(540.0, uBase); float z = exp(-uRoll);
  vec2 q = c + (px - c) * z;
  vec2 p = q / 260.0;
  float t = uT;
  vec2 w = vec2(fbm(p * 0.7 + vec2(0.0, t * 0.05)), fbm(p * 0.7 + vec2(5.2, -t * 0.04))) - 0.5;
  float f = fbm(p * 1.1 + w * 1.6 + vec2(t * 0.02, t * 0.07));
  // the top edge: big lobes (width ~ 300 px) with small ones on them
  float xl = q.x / 300.0;
  float lobe = 0.0; for (int k = 0; k < 3; k++) { float fk = float(k); lobe += abs(sin(xl * (1.0 + fk * 1.7) + fk * 2.1 + uSeed + t * 0.03 * (fk + 1.0))) * (120.0 / (1.0 + fk * 1.4)); }
  float top = uTop - lobe - 90.0 * fbm(vec2(q.x / 140.0, t * 0.05));
  float d = (q.y - top) / 420.0 + (f - 0.5) * 0.55;              // > 0 inside the wall
  float a = smoothstep(0.0, 0.05, d);
  // shading: every billow's crown lit from above and behind, its belly black; the whole wall darkens toward its base
  float crown = smoothstep(0.55, 0.9, fbm(p * 2.2 + w * 2.0 + vec2(0.0, t * 0.09)));
  float nearTop = 1.0 - smoothstep(0.0, 0.5, d);
  float lit = clamp(nearTop * 0.9 + crown * 0.7 * (1.0 - smoothstep(0.4, 2.2, d)), 0.0, 1.0) * uLit;
  lit *= 0.75 + 0.5 * smoothstep(900.0, 0.0, abs(q.x - uSunX));
  vec3 col = mix(uDark, uMid, clamp(f * 1.2 - 0.2, 0.0, 1.0) * (1.0 - smoothstep(0.3, 1.6, d)));
  col = mix(col, uRim, pow(lit, 1.6));
  // fire pockets deep in the wall
  float fire = pow(clamp(fbm(p * 0.9 + w * 3.0 + vec2(t * 0.11, -t * 0.03)) * 1.35 - 0.45, 0.0, 1.0), 3.0) * smoothstep(0.25, 0.9, d) * uGlow;
  col += uFire * fire * 2.4;
  // the front: the wall's foot boils nearer and darker (uFront > 0 darkens the lower frame)
  col *= 1.0 - uFront * smoothstep(uBase - 500.0, uBase + 300.0, q.y) * 0.45;
  if (uBurn.z > 0.0) { float bd = length(px - uBurn.xy) / uBurn.z; col += uRim * (exp(-bd * bd) * 1.3 + exp(-bd) * 0.35) * (1.2 - f); col += vec3(1.0, 0.85, 0.6) * exp(-bd * bd * 9.0) * 0.8 * (1.3 - f); }
  gl_FragColor = vec4(col * a, a);
}`;
export class DustWall {
  constructor() {
    this.cv = document.createElement('canvas'); this.cv.width = 540; this.cv.height = 960;
    this.r = new THREE.WebGLRenderer({ canvas: this.cv, alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    this.r.setPixelRatio(1); this.r.setSize(540, 960, false); this.r.setClearColor(0x000000, 0);
    const U = this.U = { uRes: { value: new THREE.Vector2(540, 960) }, uT: { value: 0 }, uTop: { value: 400 }, uBase: { value: 1700 }, uGlow: { value: 0 }, uRoll: { value: 0 },
      uLit: { value: 1 }, uSeed: { value: 0 }, uFront: { value: 0 }, uSunX: { value: 540 }, uBurn: { value: new THREE.Vector3(0, 0, 0) },
      uDark: { value: new THREE.Color('#2a0605') }, uMid: { value: new THREE.Color('#7a1409') }, uRim: { value: new THREE.Color('#f0582a') }, uFire: { value: new THREE.Color('#ff4a14') } };
    const m = new THREE.ShaderMaterial({ uniforms: U, transparent: true, premultipliedAlpha: true, depthTest: false,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: DW_FS });
    this.scene = new THREE.Scene(); this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m)); this.cam = new THREE.Camera();
  }
  // o: t, top, base, glow, roll, lit, seed, front, sunX, colours
  draw(g, o = {}) {
    const U = this.U;
    for (const k of ['t', 'top', 'base', 'glow', 'roll', 'lit', 'seed', 'front', 'sunX']) if (o[k] != null) U['u' + k[0].toUpperCase() + k.slice(1)].value = o[k];
    U.uBurn.value.set(...(o.burn || [0, 0, 0]));
    for (const k of ['dark', 'mid', 'rim', 'fire']) if (o[k]) U['u' + k[0].toUpperCase() + k.slice(1)].value.set(o[k]);
    this.r.clear(); this.r.render(this.scene, this.cam);
    g.save(); g.globalAlpha = o.alpha ?? 1; g.imageSmoothingQuality = 'high'; g.drawImage(this.cv, 0, 0, W, H); g.restore();
  }
}

// ---------------------------------------------------------------- the fist made of fists (the impact card, Deineka / 1930 massed hands)
// Flat red; one giant raised fist whose body is hundreds of small black figures with their own fists up.
const FIST = [ // the outline in a 1000 x 1920 box: knuckles up, the thumb across, the forearm to the bottom edge
  [385, 1920], [405, 1500], [410, 1160], [392, 1060], [352, 985], [318, 900], [306, 812], [318, 742], [352, 700],
  [340, 640], [350, 585], [386, 552], [430, 548], [462, 566], [488, 530], [532, 516], [576, 528], [602, 556], [632, 530], [676, 522], [716, 544], [738, 588],
  [764, 572], [800, 584], [822, 624], [826, 700], [812, 800], [800, 900], [772, 990], [712, 1070], [680, 1160], [676, 1500], [700, 1920]];
const CREASES = [[[360, 700], [700, 690]], [[352, 810], [560, 790]], [[470, 560], [470, 690]], [[602, 560], [596, 690]], [[738, 590], [724, 690]], [[560, 790], [700, 700]]];
export function fistCard(sil, { seed = 1, flip = false, zoom = 1, fig = 62, ground = P.flat } = {}) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = ground; g.fillRect(0, 0, W, H);
  const path = new Path2D(); const tx = p => [(flip ? 1000 - p[0] : p[0]) * 1.08 * zoom + (1 - zoom) * 540, 60 + (p[1] - 60) * zoom + (1 - zoom) * 400];
  FIST.forEach((p, i) => { const [x, y] = tx(p); if (i) path.lineTo(x, y); else path.moveTo(x, y); }); path.closePath();
  // the figures, packed in staggered rows inside the fist (and a crowd across the foot of the frame the forearm rises out of)
  const r = rng(seed * 101 + 7), poses = ['pumpHi', 'overhead', 'pumpLo', 'pumpHi'];
  const fill = (clip, y0, y1, h, pack) => {
    g.save(); if (clip) g.clip(clip);
    for (let y = y0, row = 0; y < y1 + h; y += h * 0.34, row++) {
      for (let x = -40 + (row % 2) * h * 0.14 + r() * h * 0.1; x < W + 40; x += h * pack * (0.8 + 0.4 * r())) {
        const type = Math.floor(r() * sil.types.length), cell = sil.cell(type, poses[Math.floor(r() * 4)]); if (!cell) continue;
        sil.blit(g, cell, x, y + (r() - 0.5) * h * 0.08, h * (0.92 + 0.16 * r()), { flip: r() < 0.5, color: P.ink });
      }
    }
    g.restore();
  };
  fill(path, 420 * zoom, 1920, fig * zoom, 0.2);
  // the knuckle and thumb creases: thin red cuts through the figures so the hand reads as a hand
  g.save(); g.clip(path); g.strokeStyle = ground; g.lineCap = 'round'; g.lineWidth = 9 * zoom;
  for (const [a, b] of CREASES) { const A = tx(a), B = tx(b); g.beginPath(); g.moveTo(...A); g.quadraticCurveTo((A[0] + B[0]) / 2, (A[1] + B[1]) / 2 + 18 * zoom, ...B); g.stroke(); }
  g.restore();
  // a crowd rank across the bottom (the fist rises out of the mass)
  fill(null, 1690, 1920, 150, 0.19);
  return c;
}

// ---------------------------------------------------------------- flare smoke: a lit plume rising off a raised flare, and its light on the ground
const PUFF = (() => { const s = 96, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d'); const q = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  q.addColorStop(0, 'rgba(255,255,255,0.9)'); q.addColorStop(0.5, 'rgba(255,255,255,0.35)'); q.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = q; g.fillRect(0, 0, s, s); return c; })();
const tinted = new Map();
function tintPuff(col) { if (tinted.has(col)) return tinted.get(col); const c = document.createElement('canvas'); c.width = c.height = 96; const g = c.getContext('2d'); g.drawImage(PUFF, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, 96, 96); tinted.set(col, c); return c; }
export function flareSmoke(g, x, y, r, t, seed, a = 1) {
  const T = tintPuff('#c02a16'), D = tintPuff('#2a0806');
  for (let k = 0; k < 6; k++) { const u = fr(t * 0.45 + k / 6 + seed * 0.37), yy = y - u * r * 9, rr = r * (0.5 + u * 3.2), xx = x + Math.sin(u * 3 + seed) * r * 1.2 + u * r * 2.5;
    g.globalAlpha = a * 0.28 * (1 - u); g.drawImage(u < 0.35 ? T : D, xx - rr, yy - rr, rr * 2, rr * 2); }
  g.globalAlpha = 1;
}
export function groundSpill(g, x, y, r, a = 1) {
  const q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, `rgba(255,60,24,${0.35 * a})`); q.addColorStop(1, 'rgba(160,10,4,0)');
  g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = q; g.beginPath(); g.ellipse(x, y, r, r * 0.3, 0, 0, Math.PI * 2); g.fill(); g.restore();
}

// ---------------------------------------------------------------- a rim toward the sun for any 2D silhouette: the shape minus itself shifted toward the light
const _shape = document.createElement('canvas'); _shape.width = W; _shape.height = H; const _sg = _shape.getContext('2d');
const _rimC = document.createElement('canvas'); _rimC.width = W; _rimC.height = H; const _rimG = _rimC.getContext('2d');
export function rimLight(g, shape, dx, dy, color = '#e0401c', alpha = 1) {
  _rimG.setTransform(1, 0, 0, 1, 0, 0); _rimG.globalCompositeOperation = 'source-over'; _rimG.clearRect(0, 0, W, H);
  _rimG.drawImage(shape, 0, 0); _rimG.globalCompositeOperation = 'source-in'; _rimG.fillStyle = color; _rimG.fillRect(0, 0, W, H);
  _rimG.globalCompositeOperation = 'destination-out'; _rimG.drawImage(shape, dx, dy);
  g.save(); g.globalAlpha = alpha; g.drawImage(_rimC, 0, 0); g.restore();
}

// ---------------------------------------------------------------- Hogan's wild train (Butte, April 1894): a 4-4-0 and coal cars packed with men, in profile
// Train-local units: rail top at y = 0, x forward (the engine faces +x). 1 unit ~ 3.1 cm (a man 1.78 m ~ 57 units).
function wheel(g, x, y, r, a, spokes = 12) {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.arc(x, y, r * 0.82, 0, Math.PI * 2, true); g.fill('evenodd');
  g.beginPath(); g.arc(x, y, r * 0.2, 0, Math.PI * 2); g.fill();
  g.lineWidth = r * 0.07; for (let k = 0; k < spokes; k++) { const q = a + k * Math.PI * 2 / spokes; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(q) * r * 0.84, y + Math.sin(q) * r * 0.84); g.stroke(); }
}
export const TRAIN = { loco: 600, car: 290, n: 9 };
export function trainLength() { return TRAIN.loco + TRAIN.car * TRAIN.n; }
// the whole train in train-local units into g (already transformed); t drives wheels, rods, flags; crew from trainCrew2D()
export function drawTrain(g, t, sil, crew, { speed = 1 } = {}) {
  const ink = P.ink; g.fillStyle = ink; g.strokeStyle = ink; g.lineJoin = 'round';
  const a = -t * 9 * speed;                            // driver rotation (rad)
  // ---- the cars, rear to front: coal gondolas (open tops), men standing in them to the waist, riders on the ladders and couplings
  for (let i = TRAIN.n - 1; i >= 0; i--) {
    const x0 = -(i + 1) * TRAIN.car, L = TRAIN.car - 14;
    for (const m of crew.filter(c => c.car === i)) {
      const cell = sil.cell(m.type, m.pose); if (cell) sil.blit(g, cell, x0 + m.x, m.y, 57 * m.s, { flip: m.flip, color: ink });
      if (m.flag) { const px = x0 + m.x + (m.flip ? -10 : 10), top = m.y - 57 * m.s * 2.1; g.lineWidth = 2.4; g.beginPath(); g.moveTo(px, m.y - 30); g.lineTo(px - 6, top); g.stroke();
        g.save(); g.fillStyle = P.red; g.beginPath(); const fw = 62, fh = 38; g.moveTo(px - 6, top);
        for (let k = 0; k <= 10; k++) { const u = k / 10; g.lineTo(px - 6 - u * fw, top + Math.sin(u * 5 + t * 14 + m.x) * 5 * u + u * 4); }
        for (let k = 10; k >= 0; k--) { const u = k / 10; g.lineTo(px - 6 - u * fw, top + fh + Math.sin(u * 5 + t * 14 + m.x + 0.6) * 5 * u + u * 6); }
        g.closePath(); g.fill(); g.restore(); g.fillStyle = ink; }
    }
    g.fillStyle = ink;
    g.beginPath(); for (let k = 0; k <= 12; k++) { const u = k / 12; g.lineTo(x0 + 10 + u * (L - 6), -76 - 16 * Math.sin(u * Math.PI) * (0.7 + 0.3 * Math.sin(i * 3 + k))); } g.lineTo(x0 + L + 4, -70); g.lineTo(x0 + 10, -70); g.fill();   // the coal heaped over the sides
    g.fillRect(x0 + 7, -72, L, 42);                                     // the gondola body
    g.fillRect(x0 + 3, -75, L + 8, 5);                                   // top rail
    g.fillRect(x0 + 10, -34, L - 6, 8);                                   // sill
    for (let k = 0; k <= 7; k++) g.fillRect(x0 + 7 + k * L / 7 - 2, -74, 5, 46);   // stakes
    // trucks and wheels
    for (const tx of [x0 + 50, x0 + L - 36]) { g.fillRect(tx - 34, -38, 68, 12); wheel(g, tx - 17, -16, 16, a * 2.8, 8); wheel(g, tx + 17, -16, 16, a * 2.8 + 0.4, 8); }
    // couplers and ladders
    g.fillRect(x0 - 8, -40, 22, 8);
    g.lineWidth = 2; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(x0 + L - 4, -66 + k * 10); g.lineTo(x0 + L + 8, -66 + k * 10); g.stroke(); }
    g.beginPath(); g.moveTo(x0 + L + 8, -75); g.lineTo(x0 + L + 8, -30); g.stroke();
  }
  // ---- the tender
  const T0 = 360; g.fillRect(T0 - 170, -128, 160, 100); g.beginPath(); g.moveTo(T0 - 172, -128); g.quadraticCurveTo(T0 - 100, -168, T0 - 12, -132); g.lineTo(T0 - 12, -128); g.fill();
  for (const tx of [T0 - 140, T0 - 42]) { g.fillRect(tx - 30, -40, 60, 12); wheel(g, tx - 15, -16, 16, a * 2.8, 8); wheel(g, tx + 15, -16, 16, a * 2.8 + 0.3, 8); }
  // ---- the engine
  g.fillRect(360, -236, 110, 18);                                       // cab roof
  g.beginPath(); g.rect(372, -220, 92, 150); g.rect(392, -200, 50, 46); g.fill('evenodd');     // the cab, its window open to the sky
  g.fillRect(450, -150, 290, 76);                                       // boiler
  g.beginPath(); g.ellipse(742, -112, 12, 40, 0, 0, Math.PI * 2); g.fill();                    // smokebox door
  g.fillRect(700, -156, 44, 84);                                        // smokebox
  g.beginPath(); g.moveTo(706, -156); g.lineTo(700, -226); g.lineTo(688, -250); g.lineTo(752, -250); g.lineTo(740, -226); g.lineTo(734, -156); g.fill();   // the diamond stack
  g.beginPath(); g.ellipse(600, -150, 26, 26, 0, Math.PI, 0); g.fill();                        // steam dome
  g.beginPath(); g.ellipse(520, -150, 20, 20, 0, Math.PI, 0); g.fill();                        // sand dome
  g.fillRect(596, -186, 8, 12);                                         // whistle
  g.fillRect(736, -186, 24, 30);                                        // headlamp
  g.fillRect(450, -76, 300, 8);                                         // running board
  g.beginPath(); g.moveTo(752, -60); g.lineTo(820, -4); g.lineTo(740, -4); g.fill();          // the pilot (cowcatcher)
  g.lineWidth = 2; for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(752, -58); g.lineTo(750 + k * 12, -4); g.stroke(); }
  g.fillRect(600, -80, 96, 30);                                         // cylinder
  // drivers and the leading truck
  const D = [[440, 58], [566, 58]]; for (const [x, r] of D) wheel(g, x, -r, r, a, 16);
  wheel(g, 650, -22, 22, a * 2.6, 10); wheel(g, 712, -22, 22, a * 2.6 + 0.5, 10);
  // side rod (crank pins at 0.55 r, quartered) and the main rod to the crosshead
  const pin = ([x, r]) => [x + Math.cos(a) * r * 0.55, -r + Math.sin(a) * r * 0.55];
  const p0 = pin(D[0]), p1 = pin(D[1]); g.lineWidth = 9; g.lineCap = 'round';
  g.beginPath(); g.moveTo(...p0); g.lineTo(...p1); g.stroke();
  const ch = [640 + Math.cos(a) * 18, -64]; g.lineWidth = 7; g.beginPath(); g.moveTo(...p1); g.lineTo(...ch); g.stroke(); g.fillRect(ch[0] - 10, -70, 30, 12);
  // the engine crew: the engineer leaning out of the cab, men on the running board and the pilot
  for (const m of crew.filter(c => c.car === -1)) { const cell = sil.cell(m.type, m.pose); if (cell) sil.blit(g, cell, m.x, m.y, 57 * m.s, { flip: m.flip, color: ink });
    if (m.flag) { const px = m.x + 8, top = m.y - 120; g.lineWidth = 2.4; g.beginPath(); g.moveTo(px, m.y - 30); g.lineTo(px, top); g.stroke();
      g.save(); g.fillStyle = P.red; g.beginPath(); g.moveTo(px, top); for (let k = 0; k <= 10; k++) { const u = k / 10; g.lineTo(px - u * 70, top + Math.sin(u * 5 + t * 14) * 5 * u); }
      for (let k = 10; k >= 0; k--) { const u = k / 10; g.lineTo(px - u * 70, top + 42 + Math.sin(u * 5 + t * 14 + 0.6) * 5 * u); } g.closePath(); g.fill(); g.restore(); g.fillStyle = ink; } }
}
// the crew: ~6 men per car to the waist inside the gondola, a rider on each ladder, men on the couplings, flags
export function trainCrew2D(sil, seed = 16) {
  const r = rng(seed), out = [], poses = ['standA', 'standB', 'pumpHi', 'overhead', 'standC', 'pumpLo'];
  for (let i = 0; i < TRAIN.n; i++) {
    const n = 7 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) out.push({ car: i, x: 26 + k * (TRAIN.car - 60) / (n - 1) + (r() - 0.5) * 10, y: -80 - r() * 8, s: 0.96 + r() * 0.1, type: Math.floor(r() * sil.types.length),
      pose: poses[Math.floor(r() * poses.length)], flip: r() < 0.5, flag: (k === 2 || k === 6) && r() < 0.6 });
    out.push({ car: i, x: TRAIN.car - 6, y: -30, s: 0.95, type: Math.floor(r() * sil.types.length), pose: r() < 0.5 ? 'pumpHi' : 'standB', flip: true });   // the ladder rider
  }
  for (const [x, y, pose, flag] of [[215, -150, 'pumpHi'], [262, -158, 'overhead'], [312, -150, 'standA', true], [418, -236, 'pumpHi'], [668, -150, 'standB'], [726, -150, 'overhead']])
    out.push({ car: -1, x, y, s: 0.95, type: Math.floor(r() * sil.types.length), pose, flip: r() < 0.5, flag });
  return out;
}
// the smoke plume off the stack, trailing back along the train, lit red on its sun side (screen coords)
export function plume(g, x, y, s, t, { len = 1400, sunX = 540, speed = 1 } = {}) {
  const D = tintPuff('#0a0102'), L = tintPuff('#e0321a');
  for (let i = 0; i < 46; i++) { const u = fr(i / 46 + t * 0.35 * speed), px = x - u * len * s, py = y - 40 * s - u * 260 * s - Math.sin(u * 7 + i) * 30 * s * u, rr = s * (26 + u * 140);
    const lit = 0.55 * (1 - u * 0.7);
    if (lit > 0.01) { g.globalAlpha = lit; g.drawImage(L, px - rr * 1.05, py - rr * 1.25, rr * 2.1, rr * 1.6); }
    g.globalAlpha = 0.95 * (1 - u * 0.8); g.drawImage(D, px - rr, py - rr * 0.8, rr * 2, rr * 2); }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------- the boot (b64): a work boot in profile comes down on the hardpan in slow
// motion, black against the disc; the ground splits into four wide bright fissures running from the heel to the horizon (the stripes)
const BOOT = [[-150, 0], [185, 0], [206, -10], [214, -34], [203, -58], [165, -80], [100, -97], [66, -112], [58, -150], [52, -196], [-112, -204], [-122, -160], [-150, -96], [-162, -44]];
const LEG = [[-122, -192], [-138, -420], [-156, -1400], [96, -1400], [84, -420], [60, -190]];
export function bootShot(g, t, age, { hy = 1330, sun = [850, 1110, 240], heel = [650, 1720], s = 1.7, drop = 0, open = 0, sil = null } = {}) {
  posterSky(g, { hy, sun, ground: null });
  // the ground: dark hardpan running to the horizon, warm toward the disc
  const gr = g.createLinearGradient(0, hy, 0, H); gr.addColorStop(0, '#5a0a06'); gr.addColorStop(0.25, '#240303'); gr.addColorStop(1, '#070101'); g.fillStyle = gr; g.fillRect(0, hy, W, H - hy);
  const vp = [sun[0], hy];
  // the four fissures: quads from under the heel to the vanishing point, their far ends racing out to the horizon
  if (open > 0) {
    const reach = Math.min(1, open), glow = Math.min(1, open * 3);
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 4; k++) {
      const off = (k - 1.5) * 105, x0 = heel[0] + 90 + off * 1.3, y0 = heel[1] + 30 + Math.abs(off) * 0.2, w0 = 34;
      const ex = lerp(x0, vp[0] + off * 0.02, reach), ey = lerp(y0, vp[1] + 2, reach), w1 = lerp(w0, 1.2, reach);
      const path = (wa, wb) => { g.beginPath(); g.moveTo(x0 - wa, y0); for (let i = 1; i <= 16; i++) { const u = i / 16, j = Math.sin(u * 23 + k * 5) * 5 * (1 - u); g.lineTo(lerp(x0 - wa, ex - wb, u) + j, lerp(y0, ey, u)); }
        for (let i = 16; i >= 0; i--) { const u = i / 16, j = Math.sin(u * 23 + k * 5) * 5 * (1 - u); g.lineTo(lerp(x0 + wa, ex + wb, u) + j, lerp(y0, ey, u)); } g.closePath(); };
      g.fillStyle = `rgba(255,50,16,${0.35 * glow})`; path(w0 * 3.2, w1 * 3); g.fill();
      g.fillStyle = `rgba(255,120,40,${0.8 * glow})`; path(w0, w1); g.fill();
      g.fillStyle = `rgba(255,236,200,${0.95 * glow})`; path(w0 * 0.35, w1 * 0.35); g.fill();
    }
    const q = g.createRadialGradient(heel[0] + 70, heel[1], 0, heel[0] + 70, heel[1], 460); q.addColorStop(0, `rgba(255,90,30,${0.5 * glow})`); q.addColorStop(1, 'rgba(160,10,4,0)');
    g.fillStyle = q; g.fillRect(0, hy, W, H - hy);
    g.restore();
  }
  // the boot and the trouser leg (black), lit from below by the fissures once they open
  _sg.setTransform(1, 0, 0, 1, 0, 0); _sg.clearRect(0, 0, W, H);
  _sg.setTransform(-s, 0, 0, s, heel[0] - 150 * s, heel[1] - drop); _sg.fillStyle = P.ink;      // mirrored: the toe to the left, the heel toward the fissures
  for (const poly of [LEG, BOOT]) { _sg.beginPath(); poly.forEach((p, i) => i ? _sg.lineTo(...p) : _sg.moveTo(...p)); _sg.closePath(); _sg.fill(); }
  _sg.fillRect(-150, -8, 350, 8); _sg.fillStyle = '#000'; for (let k = 0; k < 11; k++) _sg.fillRect(-140 + k * 31, -3, 16, 6);   // the lugs
  _sg.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(_shape, 0, 0);
  rimLight(g, _shape, 4, 3, '#e8461e', 0.8);
  if (open > 0) rimLight(g, _shape, 0, -5, '#ffb070', Math.min(1, open * 3));
  // debris and grit thrown into the light, black against the disc; sparks out of the fissures
  if (open > 0) { const r = rng(64), a0 = age;
    for (let i = 0; i < 90; i++) { const ang = -Math.PI * (0.15 + 0.7 * r()), v = 300 + 900 * r(), sz = 3 + 14 * r() * r(), x = heel[0] + 40 + (r() - 0.5) * 260, tt = a0 * 0.45;
      const px = x + Math.cos(ang) * v * tt, py = heel[1] + Math.sin(ang) * v * tt + 900 * tt * tt;
      if (py > heel[1] + 20) continue;
      const spark = i % 4 === 0; g.fillStyle = spark ? '#ffb070' : P.ink; g.globalAlpha = spark ? Math.max(0, 1 - a0 * 0.8) : 1;
      g.save(); g.translate(px, py); g.rotate(r() * 6 + tt * 8); g.beginPath(); g.moveTo(-sz, -sz * 0.4); g.lineTo(sz * 0.6, -sz * 0.7); g.lineTo(sz, sz * 0.5); g.lineTo(-sz * 0.3, sz * 0.8); g.closePath(); g.fill(); g.restore(); }
    g.globalAlpha = 1; }
}
