// THE MAJORITY: the bowl. An unnamed open-air football stadium at night: three decks of stepped concrete with seat
// rows, aisles and vomitories, three LED ribbon rings on the deck fascias (the ≡ when they burn red), the rim walkway,
// the exterior shell, the field, six floodlight masts with haze cones, the sky; and THE CROWD: ~95,000 seats, each a
// shader-drawn person (head, hair or hat, torso by trade, arms, legs, cards, phones, headlamps), whose per-seat state
// (present, sit/stand/crouch, arms, card, phone, lamp) is written by the shot every frame.
import * as THREE from 'three';

export const SE = { A: 64, B: 42, n: 3.2 };                 // the bowl's inner superellipse (m), long axis x
export const DECKS = [
  { name: 'lower', d0: 4.0, rows: 28, tread: 0.86, rise: 0.40, h0: 1.3 },
  { name: 'club', d0: 32.5, rows: 10, tread: 0.9, rise: 0.52, h0: 16.4 },
  { name: 'upper', d0: 43.0, rows: 34, tread: 0.8, rise: 0.56, h0: 25.2 },
];
export const RINGS = [                                       // the three LED ribbon rings: fascia fronts facing the field
  { d: 31.6, y0: 13.4, y1: 15.6 },
  { d: 42.1, y0: 21.6, y1: 24.2 },
  { d: 70.9, y0: 45.2, y1: 47.8 },
];
const sc = (c, e) => Math.sign(c) * Math.pow(Math.abs(c), e);
export function bowlXZ(th, d) { const e = 2 / SE.n; return [(SE.A + d) * sc(Math.cos(th), e), (SE.B + d) * sc(Math.sin(th), e)]; }
export function bowlNormal(th, d) {                          // outward normal (xz) of the offset superellipse
  const a = bowlXZ(th - 0.002, d), b = bowlXZ(th + 0.002, d); const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
  return [tz / l, -tx / l];
}
export function deckRow(deck, r) { const D = DECKS[deck]; return { d: D.d0 + r * D.tread, y: D.h0 + r * D.rise }; }
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// arc-length table of the superellipse at offset d: theta for evenly spaced seats
function arcTable(d, N = 2048) {
  const th = [], s = [0]; let prev = bowlXZ(0, d), acc = 0;
  for (let i = 0; i <= N; i++) { const t = i / N * Math.PI * 2; th.push(t); if (i) { const p = bowlXZ(t, d); acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]); s.push(acc); prev = p; } }
  return { th, s, L: acc, at(u) { const x = u * acc; let lo = 0, hi = N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] < x) lo = m; else hi = m; } const f = (x - s[lo]) / Math.max(1e-6, s[hi] - s[lo]); return th[lo] + (th[hi] - th[lo]) * f; } };
}

// ------------------------------------------------------------------ shared GLSL
const NOISE = `
float h11(float n){ return fract(sin(n) * 43758.5453); }
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f); return mix(mix(h21(i), h21(i+vec2(1,0)), u.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y); }
`;
// the stadium light: a few flood directions + an ambient, identical for every custom material (the people.js crowd
// is lit by real three.js lights set to match)
export const LIGHT = {
  uFlood: { value: 1.0 }, uAmb: { value: new THREE.Color('#1b2436') }, uFloodCol: { value: new THREE.Color('#dfe9ff') },
  uFogCol: { value: new THREE.Color('#1a2233') }, uFogD: { value: 0.004 }, uTime: { value: 0 }, uWarm: { value: 0 },
};

// ------------------------------------------------------------------ the stands (stepped concrete + seats)
function standsMaterial(deck) {
  return new THREE.ShaderMaterial({
    uniforms: { ...LIGHT, uDeck: { value: deck }, uEmpty: { value: 1 } },
    vertexShader: `
      attribute vec3 aRow;            // row index, 0 tread / 1 riser, along-row metres
      varying vec3 vRow; varying vec3 vW; varying float vFog;
      void main(){ vRow = aRow; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vFog = length(mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: NOISE + `
      uniform float uFlood, uFogD, uDeck, uWarm; uniform vec3 uAmb, uFloodCol, uFogCol;
      varying vec3 vRow; varying vec3 vW; varying float vFog;
      void main(){
        float row = vRow.x, riser = vRow.y, s = vRow.z;
        vec3 conc = vec3(0.30, 0.30, 0.31) * (0.85 + 0.25 * vn(vW.xz * 0.7) + 0.08 * h21(floor(vW.xz * 6.0)));
        float seatU = fract(s / 0.55), aisle = step(fract(s / 13.8), 0.085);
        vec3 c = conc;
        // seats: a moulded plastic seat back on every tread, a dark gap between, the numbered riser
        if (riser < 0.5) {
          float fr = fract(row);
          float back = smoothstep(0.52, 0.56, fr) * smoothstep(0.92, 0.88, fr);
          float seatW = smoothstep(0.06, 0.12, seatU) * smoothstep(0.94, 0.88, seatU);
          vec3 seatC = mix(vec3(0.16, 0.19, 0.24), vec3(0.22, 0.25, 0.30), h21(vec2(floor(s / 0.55), floor(row))));
          c = mix(c, seatC, back * seatW * (1.0 - aisle));
          c *= 1.0 - 0.35 * smoothstep(0.9, 1.0, fr);
        } else { c *= 0.62; c = mix(c, vec3(0.5, 0.48, 0.42), aisle * 0.4); }
        c = mix(c, vec3(0.42, 0.42, 0.40), aisle * 0.5);
        // vomitories (lower deck): dark tunnel mouths every 1/10 of the ring, rows 9-15
        float lit = uFlood * (riser < 0.5 ? 0.75 : 0.45) + 0.05;
        vec3 col = c * (uAmb * 1.4 + uFloodCol * lit);
        col = mix(col, uFogCol, 1.0 - exp(-uFogD * vFog));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}
function buildStands(deck, segs = 400) {
  const D = DECKS[deck], pos = [], row = [], idx = [];
  const at = arcTable(D.d0 + D.rows * D.tread * 0.5);
  let v = 0;
  for (let r = 0; r <= D.rows; r++) {
    const d0 = D.d0 + r * D.tread, d1 = d0 + D.tread, y0 = D.h0 + r * D.rise, y1 = y0 + D.rise;
    const last = r === D.rows;
    // tread (y0, d0..d1) then riser (d1, y0..y1)
    for (const [kind, a0, a1] of [[0, [d0, y0], [last ? d0 + 1.8 : d1, y0]], ...(last ? [] : [[1, [d1, y0], [d1, y1]]])]) {
      for (let i = 0; i <= segs; i++) {
        const th = at.at(i / segs), sAlong = i / segs * at.L;
        for (const [d, y, f] of [[a0[0], a0[1], 0], [a1[0], a1[1], 1]]) {
          const [x, z] = bowlXZ(th, d); pos.push(x, y, z); row.push(kind === 0 ? r + f * (last ? 0.5 : 1) : r + 1, kind, sAlong);
        }
      }
      for (let i = 0; i < segs; i++) { const a = v + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      v += (segs + 1) * 2;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aRow', new THREE.Float32BufferAttribute(row, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, standsMaterial(deck)); m.material.side = THREE.DoubleSide; m.frustumCulled = false;
  return m;
}
// a band of the superellipse between offsets/heights: fascias, walls, the rim walkway
function band(d0, y0, d1, y1, segs, mat, uvScale = 1) {
  const pos = [], uv = [], idx = [], at = arcTable((d0 + d1) / 2);
  for (let i = 0; i <= segs; i++) { const th = at.at(i / segs); const [x0, z0] = bowlXZ(th, d0), [x1, z1] = bowlXZ(th, d1);
    pos.push(x0, y0, z0, x1, y1, z1); uv.push(i / segs * uvScale, 0, i / segs * uvScale, 1); }
  for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.userData.L = at.L; return m;
}
function flatMat(hex, k = 1) {
  return new THREE.ShaderMaterial({ uniforms: { ...LIGHT, uC: { value: new THREE.Color(hex) }, uK: { value: k } }, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; varying float vFog; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; vec4 mv = viewMatrix * w; vFog = length(mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: NOISE + `uniform vec3 uC, uAmb, uFloodCol, uFogCol; uniform float uK, uFlood, uFogD; varying vec2 vUv; varying float vFog; varying vec3 vW;
      void main(){ vec3 c = uC * (0.85 + 0.2 * vn(vW.xz * 0.5 + vW.y)) ; vec3 col = c * (uAmb * 1.3 + uFloodCol * (uFlood * 0.55 + 0.04) * uK);
      col = mix(col, uFogCol, 1.0 - exp(-uFogD * vFog)); gl_FragColor = vec4(col, 1.); }` });
}

// ------------------------------------------------------------------ the LED ribbon rings
// Each ring is a canvas (text scrolling round the bowl on a dot grid) mapped on the fascia band.
export class Ring {
  constructor(i, scene) {
    const R = RINGS[i]; this.R = R;
    this.cw = 4096; this.ch = 64; this.c = document.createElement('canvas'); this.c.width = this.cw; this.c.height = this.ch; this.g = this.c.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.c); this.tex.wrapS = THREE.RepeatWrapping; this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter; this.tex.generateMipmaps = false;
    this.mat = new THREE.ShaderMaterial({ uniforms: { ...LIGHT, tLed: { value: this.tex }, uRep: { value: 1 }, uGain: { value: 2.2 }, uOff: { value: 0 } }, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; varying float vFog; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.); vFog = length(mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D tLed; uniform float uRep, uGain, uOff, uFogD; uniform vec3 uFogCol; varying vec2 vUv; varying float vFog;
        void main(){ vec2 uv = vec2(fract(vUv.x * uRep + uOff), vUv.y);             // reads correctly from inside the bowl; v1's NACIREMA was its back face seen from outside (cR1 cameras never look through it)
          vec2 g = vec2(uv.x * ${4096 / 4}.0 * uRep, uv.y * 16.0);                  // the dot grid: 1024 x 16 LEDs per repeat
          vec2 f = fract(vec2(vUv.x * 1024.0 * uRep, uv.y * 16.0)) - 0.5;
          float dotm = smoothstep(0.5, 0.25, length(f));
          vec3 led = texture2D(tLed, vec2(uv.x, (floor(uv.y * 16.0) + 0.5) / 16.0)).rgb;
          vec3 c = vec3(0.012, 0.012, 0.016) + led * uGain * (0.25 + 0.75 * dotm);
          c = mix(c, uFogCol * 0.5, (1.0 - exp(-uFogD * vFog)) * 0.35);
          gl_FragColor = vec4(c, 1.0); }` });
    this.mesh = band(R.d, R.y0, R.d - 0.35, R.y1, 720, this.mat);
    this.mesh.material = this.mat; scene.add(this.mesh);
    // the fascia above and below the LED (dark steel)
    const fm = flatMat('#2a2d33', 0.8);
    scene.add(band(R.d, R.y0 - 0.9, R.d, R.y0, 360, fm));
    scene.add(band(R.d - 0.35, R.y1, R.d + 0.6, R.y1 + 0.5, 360, fm));
    this.state = null;
  }
  // text: repeated round the ring; col: css; bg: css; scroll: 0..1 offset; rep: repeats round the bowl
  draw(text, col = '#F4E6D0', { bg = '#000', rep = 6, scroll = 0, fill = 0, fillCol = '#E01818' } = {}) {
    const key = text + col + bg + fill + fillCol;
    this.mat.uniforms.uRep.value = rep; this.mat.uniforms.uOff.value = scroll;
    if (this.state === key) return; this.state = key;
    const g = this.g; g.fillStyle = bg; g.fillRect(0, 0, this.cw, this.ch);
    if (fill) { g.fillStyle = fillCol; g.globalAlpha = fill; g.fillRect(0, 0, this.cw, this.ch); g.globalAlpha = 1; }
    if (text) {
      g.fillStyle = col; g.font = `${this.ch * 0.66}px Michroma`; g.textBaseline = 'middle'; g.textAlign = 'center';
      const w = g.measureText(text + '  ').width, n = Math.max(1, Math.floor(this.cw / w));
      for (let i = 0; i < n; i++) g.fillText(text, (i + 0.5) * this.cw / n, this.ch * 0.53);
      g.fillRect(0, 2, this.cw, 3); g.fillRect(0, this.ch - 5, this.cw, 3);
    }
    this.tex.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ the field
function fieldTexture() {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 1024; const g = c.getContext('2d');
  // x: 120 yd (-60..60 m incl. end zones), z: 53.3 yd; scale 2048 px / 120 m
  const X = x => (x + 60) / 120 * 2048, Z = z => (z + 26.65) / 53.3 * 1024;
  for (let i = 0; i < 24; i++) { g.fillStyle = i % 2 ? '#2f6a33' : '#347238'; g.fillRect(X(-60 + i * 5), 0, X(-55) - X(-60) + 1, 1024); }
  g.fillStyle = '#2a5a2e'; g.fillRect(0, 0, X(-50), 1024); g.fillRect(X(50), 0, 2048 - X(50), 1024);          // end zones, plain
  g.strokeStyle = 'rgba(245,245,238,0.92)'; g.lineWidth = 5;
  for (let yd = 0; yd <= 100; yd += 5) { const x = X(-50 + yd * 0.9144 * 100 / 91.44); g.beginPath(); g.moveTo(x, Z(-24.4)); g.lineTo(x, Z(24.4)); g.stroke(); }
  g.lineWidth = 7; g.strokeRect(X(-60), Z(-24.4), X(60) - X(-60), Z(24.4) - Z(-24.4));
  g.lineWidth = 3; for (let yd = 1; yd < 100; yd++) if (yd % 5) { const x = X(-50 + yd * 0.9144 * 100 / 91.44); for (const z of [-24, -3.1, 3.1, 24]) { g.beginPath(); g.moveTo(x, Z(z) - 6); g.lineTo(x, Z(z) + 6); g.stroke(); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function fieldMat(tex) {
  return new THREE.ShaderMaterial({ uniforms: { ...LIGHT, tF: { value: tex }, uGlow: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying float vFog; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; vec4 mv = viewMatrix * w; vFog = length(mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: NOISE + `uniform sampler2D tF; uniform vec3 uAmb, uFloodCol, uFogCol; uniform float uFlood, uFogD, uGlow; varying vec2 vUv; varying float vFog; varying vec3 vW;
      void main(){ vec3 c = texture2D(tF, vUv).rgb; c = pow(c, vec3(2.2));
        c *= 0.8 + 0.35 * vn(vW.xz * 3.0) * vn(vW.xz * 0.2 + 3.0);
        float pool = 0.75 + 0.25 * exp(-dot(vW.xz * vec2(0.012, 0.02), vW.xz * vec2(0.012, 0.02)));
        vec3 col = c * (uAmb * 2.0 + uFloodCol * (uFlood * 2.1 * pool + 0.05)) + vec3(0.25, 0.9, 0.35) * uGlow;   // cR1: 3.6 -> 2.1 (the lines bloomed neon)
        col = mix(col, uFogCol, 1.0 - exp(-uFogD * vFog));
        gl_FragColor = vec4(col, 1.); }` });
}

// ------------------------------------------------------------------ floodlight masts, haze cones, the sky
function hazeMat() {
  return new THREE.ShaderMaterial({ uniforms: { ...LIGHT, uI: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY; void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.); vV = normalize(-mv.xyz); vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uI, uFlood; uniform vec3 uFloodCol; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ float f = pow(abs(dot(vN, vV)), 1.6); float a = f * pow(vY, 1.4) * 0.05 * uI * uFlood; gl_FragColor = vec4(uFloodCol * a, 1.0); }` });
}
export class Masts {
  constructor(scene) {
    this.group = new THREE.Group(); scene.add(this.group); this.lamps = [];
    const steel = flatMat('#3a3d44', 0.6);
    const lampMat = new THREE.ShaderMaterial({ uniforms: { uI: { value: 1 } }, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform float uI; varying vec2 vUv; void main(){ vec2 g = fract(vUv * vec2(8.0, 4.0)) - 0.5; float d = smoothstep(0.42, 0.18, length(g));
        vec3 c = vec3(0.9, 0.95, 1.0) * (0.04 + d * 9.0 * uI); gl_FragColor = vec4(c, 1.); }` });
    this.lampMat = lampMat; this.haze = hazeMat();
    this.pos = [];
    for (let i = 0; i < 6; i++) {
      const th = [0.55, Math.PI - 0.55, Math.PI + 0.55, -0.55, Math.PI / 2, -Math.PI / 2][i];
      const [x, z] = bowlXZ(th, 76), [nx, nz] = bowlNormal(th, 76), top = 72;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.4, top, 8), steel); mast.position.set(x, top / 2, z); this.group.add(mast);
      const head = new THREE.Group(); head.position.set(x, top, z); head.lookAt(0, 0, 0); this.group.add(head);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(16, 8, 0.8), steel); head.add(frame);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(15, 7), lampMat); face.position.z = 0.45; head.add(face);
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(7, 70, 120, 24, 1, true), this.haze); cone.geometry.translate(0, -60, 0);
      const cg = new THREE.Group(); cg.position.copy(head.position); cg.lookAt(0, -20, 0); cg.rotateX(-Math.PI / 2); cg.add(cone);
      // uv.y along the cone: 1 at the lamp, 0 at the far end
      const uvA = cone.geometry.attributes.uv; for (let k = 0; k < uvA.count; k++) uvA.setY(k, uvA.getY(k));
      this.group.add(cg); this.pos.push(head.position.clone());
      this.lamps.push({ head, cone: cg, face });
    }
  }
  set(intensity) { this.lampMat.uniforms.uI.value = intensity; this.haze.uniforms.uI.value = intensity; }
}
export function makeSky(scene) {
  const m = new THREE.ShaderMaterial({ uniforms: { uGlow: { value: 1 }, uRed: { value: 0 } }, side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
    fragmentShader: NOISE + `uniform float uGlow, uRed; varying vec3 vD;
      void main(){ float y = vD.y; vec3 top = vec3(0.004, 0.006, 0.014), hor = vec3(0.035, 0.045, 0.07);
        vec3 c = mix(hor, top, smoothstep(-0.05, 0.6, y));
        c += vec3(0.16, 0.12, 0.09) * exp(-max(y, 0.0) * 9.0) * uGlow;                          // the town's sodium glow on the horizon
        float st = step(0.9985, h21(floor(vD.xz / max(0.2, vD.y) * 400.0))) * smoothstep(0.1, 0.5, y);
        c += vec3(0.5) * st * 0.35;
        c = mix(c, c + vec3(0.12, 0.0, 0.0) * exp(-max(y, 0.0) * 5.0), uRed);
        gl_FragColor = vec4(c, 1.); }` });
  const s = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), m); s.scale.setScalar(20000); s.renderOrder = -10; s.frustumCulled = false; scene.add(s);
  return s;
}

// ------------------------------------------------------------------ THE CROWD: one shader-drawn person per seat
const CROWD_VS = `
attribute vec3 aPos; attribute vec4 aInfo; attribute vec4 aState; attribute vec4 aCard; attribute vec3 aCol;
uniform float uScale;
varying vec2 vL; varying vec4 vS; varying vec4 vC; varying vec4 vI; varying vec3 vCol; varying float vFog; varying float vFront; varying float vPx;
void main(){
  vS = aState; vC = aCard; vI = aInfo; vCol = aCol;
  if (aState.x < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 camPos = cameraPosition;
  vec3 toC = camPos - aPos;
  // cylindrical near the horizon, spherical when the camera looks down on the crowd
  vec3 upW = normalize(mix(vec3(0., 1., 0.), up, smoothstep(0.35, 0.85, normalize(toC).y)));
  float hgt = aInfo.z;                                          // body height scale (kids 0.7)
  float W = 1.0 * hgt, H = 2.5 * hgt;
  vL = vec2(position.x * W, position.y * H) / hgt;             // local metres at adult scale
  vec3 wp = aPos + right * position.x * W + upW * position.y * H;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vFog = length(mv.xyz);
  vec2 fdir = vec2(cos(aInfo.x), sin(aInfo.x));
  vFront = dot(normalize(toC.xz), fdir);
  gl_Position = projectionMatrix * mv;
  vPx = projectionMatrix[1][1] * 1.8 / max(0.1, -mv.z);       // screen-height fraction of a person (for AA)
}`;
const CROWD_FS = NOISE + `
uniform vec3 uAmb, uFloodCol, uFogCol; uniform float uFlood, uFogD, uTime, uRimK, uPhoneK, uLampK, uCardK, uRes, uStripeK;
varying vec2 vL; varying vec4 vS; varying vec4 vC; varying vec4 vI; varying vec3 vCol; varying float vFog; varying float vFront; varying float vPx;
float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.)) + min(max(d.x, d.y), 0.); }
float sdSeg(vec2 p, vec2 a, vec2 b, float r){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h) - r; }
void main(){
  vec2 p = vL; float seed = vI.y;
  float pose = vS.y;                  // 0 sit .. 1 stand ; <0 crouch
  float arms = vS.z, lamp = vS.w;
  float crouch = clamp(-pose, 0., 1.), stand = clamp(pose, 0., 1.);
  float heavy = h11(seed * 7.1), fem = step(0.62, h11(seed * 3.3));
  float hip = mix(0.52, 0.98, stand); hip = mix(hip, 0.42, crouch);
  float lean = crouch * 0.12;
  float sh = hip + mix(0.54, 0.34, crouch) - fem * 0.03;
  vec2 headC = vec2(lean * 1.6 * (h11(seed) - 0.5), sh + 0.18 - crouch * 0.05);
  float tw = 0.19 + heavy * 0.05 - fem * 0.03;
  // torso (tapered), legs, head, arms
  float yy = clamp((p.y - hip) / (sh - hip), 0., 1.);
  float dT = sdBox(p - vec2(0., (hip + sh) * 0.5), vec2(mix(tw * 0.92, tw, yy), (sh - hip) * 0.5)) - 0.03;
  float dL = 1e3;
  if (stand > 0.3 || crouch > 0.3) { dL = min(sdSeg(p, vec2(-0.08, hip), vec2(-0.1 - crouch * 0.12, 0.05), 0.07), sdSeg(p, vec2(0.08, hip), vec2(0.1 + crouch * 0.12, 0.05), 0.07)); }
  float hr = 0.105;
  float dH = length((p - headC) * vec2(1.0, 0.9)) - hr;
  // arms: shoulders -> elbows -> hands. arms up: a V of fists (one or both), a card held high, or a phone
  float oneArm = step(0.55, h11(seed * 5.7)) * step(vC.x, 0.5);
  vec2 sL = vec2(-tw + 0.02, sh - 0.04), sR = vec2(tw - 0.02, sh - 0.04);
  float aL = vC.x > 0.5 ? arms : 0.0, aR = arms;
  float card = step(0.5, vC.x);
  vec2 hLdown = vec2(-tw - 0.06, hip + 0.04), hRdown = vec2(tw + 0.06, hip + 0.04);
  // cR1: the raised arm is the PUMP glyph (upper arm out, elbow bent, forearm vertical, fist beside the head): never a
  // straight arm, never forward. Only one arm goes up; the far ranks raise vertical arms only (human.md c2 rule)
  vec2 hLup = card > 0.5 ? vec2(-0.22, sh + 0.55) : vec2(-tw - 0.12, sh + 0.42);
  vec2 hRup = card > 0.5 ? vec2(0.22, sh + 0.55) : vec2(tw + 0.12, sh + 0.42);
  vec2 hL = mix(hLdown, hLup, aL), hR = mix(hRdown, hRup, aR);
  if (crouch > 0.3) { hL = vec2(-0.2, hip + 0.1); hR = vec2(0.2, hip + 0.1); }
  vec2 eL = mix(mix(sL, hL, 0.5) + vec2(-0.07, -0.03), vec2(sL.x - 0.2, sL.y + 0.08), aL);     // the elbow out at shoulder height
  vec2 eR = mix(mix(sR, hR, 0.5) + vec2(0.07, -0.03), vec2(sR.x + 0.2, sR.y + 0.08), aR);
  float dA = min(min(sdSeg(p, sL, eL, 0.058), sdSeg(p, eL, hL, 0.05)), min(sdSeg(p, sR, eR, 0.058), sdSeg(p, eR, hR, 0.05)));
  float dFist = min(length(p - hL) - 0.055, length(p - hR) - 0.055);
  // hat: hard hat dome, trucker cap, knit cap, hood or bare
  float hk = h11(seed * 13.7);
  float dHat = 1e3;
  if (hk < 0.22) dHat = min(sdBox(p - headC - vec2(0., 0.06), vec2(0.13, 0.05)) - 0.03, sdBox(p - headC - vec2(0., 0.02), vec2(0.16, 0.012)));
  else if (hk < 0.45) dHat = min(sdBox(p - headC - vec2(0., 0.06), vec2(0.11, 0.045)) - 0.02, sdBox(p - headC - vec2(0.08 * sign(vFront), 0.025), vec2(0.1, 0.012)));
  else if (hk < 0.58) dHat = sdBox(p - headC - vec2(0., 0.07), vec2(0.1, 0.05)) - 0.03;
  float dCard = card > 0.5 ? sdBox(p - vec2(0., sh + 0.56), vec2(0.34, 0.24)) : 1e3;
  float d = min(min(min(dT, dL), min(dH, dA)), min(min(dFist, dHat), dCard));
  // AA width in local metres from the projected size
  float aa = max(0.015, 1.4 / max(1.0, vPx * uRes) * 2.5);
  float alpha = smoothstep(aa, -aa, d);
  if (alpha < 0.04) discard;
  // colour by part (detail fades with the projected size so a far crowd reads as texture, not noise)
  float pxH = vPx * uRes, det = smoothstep(12.0, 42.0, pxH);
  vec3 skin = mix(vec3(0.85, 0.62, 0.48), vec3(0.26, 0.16, 0.1), h11(seed * 17.3));
  vec3 hair = mix(vec3(0.05, 0.035, 0.03), vec3(0.45, 0.33, 0.2), step(0.8, h11(seed * 19.1)) * h11(seed * 23.0));
  vec3 shirt = vCol;
  float hiv = step(0.95, h11(seed * 29.0));
  float stripe = vC.w;                                          // cR1 STRIPE OUT: 1 red, 2 cream (clothing and phone light)
  vec3 stripeC = stripe > 1.5 ? vec3(0.62, 0.55, 0.44) : vec3(0.78, 0.05, 0.04);
  if (stripe > 0.5) { shirt = stripeC * (0.85 + 0.3 * h11(seed * 71.0)); hiv = 0.0; }
  if (hiv > 0.5) shirt = mix(vec3(0.62, 0.78, 0.06), vec3(0.9, 0.4, 0.05), step(0.5, h11(seed * 31.0)));
  vec3 c = shirt; vec2 pc = vec2(0., (hip + sh) * 0.5);
  if (dT < 0.0 && hiv > 0.5) { float tape = step(abs(p.y - (hip + sh) * 0.45 - 0.05), 0.022) + step(abs(p.y - sh + 0.12), 0.02); c = mix(c, vec3(1.1), clamp(tape, 0., 1.) * 0.7 * det); }
  if (dL < 0.0 && dT > 0.0) { c = mix(vec3(0.1, 0.13, 0.2), vec3(0.28, 0.2, 0.12), step(0.6, h11(seed * 37.0))); pc = vec2(0., hip * 0.5); }
  if (dA < 0.0 && dT > 0.0) { c = arms > 0.5 && h11(seed * 41.0) < 0.3 ? skin : shirt; pc = (sL + hL) * 0.5; }
  if (dFist < 0.0) { c = h11(seed * 43.0) < 0.2 ? vec3(0.5, 0.36, 0.2) : skin; }
  if (dH < 0.0) { c = vFront > -0.1 ? skin : hair; pc = headC;
    if (vFront > -0.1) { float hairTop = smoothstep(headC.y + 0.03, headC.y + 0.07, p.y); c = mix(c, hair, hairTop); }
  }
  if (dHat < 0.0) { vec3 hc = hk < 0.22 ? mix(vec3(0.92, 0.9, 0.86), vec3(0.95, 0.75, 0.1), step(0.5, h11(seed * 47.0))) : hk < 0.45 ? mix(vec3(0.5, 0.1, 0.08), vec3(0.12, 0.14, 0.2), h11(seed * 53.0)) : vec3(0.1, 0.1, 0.11); c = hc; pc = headC + vec2(0., 0.08); }
  c = mix(mix(shirt, skin, 0.25) * 0.9, c, 0.45 + 0.55 * det);
  // cR1: under ~30 px a person is TEXTURE, not a figure: the colour collapses toward one dark cloth value (no RGB static),
  // and only the lights (lamps, phones) and the Stripe Out colour carry
  c = mix(vec3(0.13, 0.14, 0.17) * (0.9 + 0.2 * h11(seed * 5.0)), c, smoothstep(20.0, 70.0, pxH));
  float emis = 0.0;
  if (dCard < 0.0) { c = vC.y > 0.5 ? vec3(0.88, 0.07, 0.07) : vec3(0.95, 0.9, 0.8); pc = vec2(0., sh + 0.56); emis = uCardK * (0.6 + 0.4 * h11(seed * 61.0)); }
  // light: flood key from above-behind the crowd, a rim, the ambient; pseudo-normal from the part centre
  vec2 q = (p - pc) / vec2(0.3, 0.4);
  vec3 n = normalize(vec3(q.x, q.y * 0.6, 0.8));
  float key = clamp(0.55 + 0.45 * n.y, 0., 1.);
  float rim = pow(clamp(1.0 - n.z, 0., 1.), 2.0) * uRimK;
  vec3 col = c * (uAmb * 1.6 + uFloodCol * (uFlood * (0.3 + 0.55 * key) + rim * uFlood)) ;
  col *= 0.9 + 0.2 * h11(seed * 67.0);
  if (emis > 0.0) col = c * (0.25 + emis * 2.2);
  // phone screen / flashlight and headlamp: emissive points (they bloom)
  float ph = vC.z; if (ph > 0.0) { vec2 pp = mix(hR, vec2(0.0, sh + 0.35), step(0.5, card)); float dp = length((p - pp) * vec2(1.0, 0.8)); col += vec3(0.85, 0.92, 1.0) * uPhoneK * ph * (smoothstep(max(0.07, aa * 1.6), 0.0, dp) * 6.0); }   // cR1: never smaller than a pixel
  if (lamp > 0.0 && vFront > -0.2) { float dl = length(p - headC - vec2(0.0, 0.07)); col += vec3(1.0, 0.97, 0.9) * lamp * uLampK * smoothstep(0.06, 0.0, dl) * 9.0; }
  if (stripe > 0.5) col = mix(col, stripeC * (0.5 + uStripeK), 0.55 * smoothstep(0.0, 1.0, uStripeK + 0.3));
  col = mix(col, uFogCol, 1.0 - exp(-uFogD * vFog));
  gl_FragColor = vec4(col, alpha);
}`;
// shirt palette: work clothes and plain hoodies; no team colours
const SHIRTS = ['#3a4452', '#4a5058', '#2e3844', '#5a5248', '#8a6232', '#6e5230', '#1c3a6a', '#2a5a34', '#6a1418', '#3a3a44',
  '#b8b0a0', '#2a2a30', '#7a5230', '#4a3020', '#6a6e72', '#2f6f78', '#8a1c1c', '#a07020', '#1a1a1c', '#55606a', '#8a7a62', '#23262c', '#4a2a2a', '#39414a'];
export class Crowd {
  constructor(scene, { spacing = 0.55, aisleEvery = 24 } = {}) {
    const seats = []; const r = mulberry(4242);
    for (let deck = 0; deck < 3; deck++) {
      const D = DECKS[deck];
      for (let row = 0; row < D.rows; row++) {
        const d = D.d0 + row * D.tread + D.tread * 0.55, y = D.h0 + row * D.rise;
        const at = arcTable(d), n = Math.floor(at.L / spacing);
        for (let i = 0; i < n; i++) {
          if (i % aisleEvery === 0 || i % aisleEvery === 1) continue;                 // stair aisles
          const u = (i + 0.5) / n, th = at.at(u);
          const [x, z] = bowlXZ(th, d), [nx, nz] = bowlNormal(th, d);
          seats.push({ x, y, z, face: Math.atan2(-nz, -nx), deck, row, th, u, sect: Math.floor(u * 40), seed: r() * 1000, h: r() < 0.035 ? 0.72 : 0.93 + r() * 0.12 });
        }
      }
    }
    seats.reverse();                                                                  // far rows first: painter's order for field-side cameras
    this.nBowl = seats.length;
    // the field crowd (only when the bowl has overflowed onto the field)
    for (let x = -58; x <= 58; x += 0.62) for (let z = -25; z <= 25; z += 0.62) {
      const jx = (r() - 0.5) * 0.3, jz = (r() - 0.5) * 0.3;
      seats.push({ x: x + jx, y: 0, z: z + jz, face: Math.atan2(-z, -x) + (r() - 0.5), deck: 3, row: 0, th: Math.atan2(z, x), u: 0, sect: 0, seed: r() * 1000, h: 0.9 + r() * 0.14, field: true });
    }
    this.seats = seats; const N = this.N = seats.length;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    const P = new Float32Array(N * 3), I = new Float32Array(N * 4), Cc = new Float32Array(N * 3);
    const col = new THREE.Color();
    seats.forEach((s, k) => { P.set([s.x, s.y, s.z], k * 3); I.set([s.face, s.seed, s.h, s.deck], k * 4); col.set(SHIRTS[Math.floor(s.seed * 7.13) % SHIRTS.length]).convertSRGBToLinear(); Cc.set([col.r, col.g, col.b], k * 3); });
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(P, 3)); g.setAttribute('aInfo', new THREE.InstancedBufferAttribute(I, 4)); g.setAttribute('aCol', new THREE.InstancedBufferAttribute(Cc, 3));
    this.S = new Float32Array(N * 4); this.C = new Float32Array(N * 4);
    this.aS = new THREE.InstancedBufferAttribute(this.S, 4); this.aS.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aState', this.aS);
    this.aC = new THREE.InstancedBufferAttribute(this.C, 4); this.aC.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aCard', this.aC);
    g.instanceCount = N;
    this.mat = new THREE.ShaderMaterial({ uniforms: { ...LIGHT, uRimK: { value: 1.0 }, uPhoneK: { value: 1 }, uLampK: { value: 1 }, uCardK: { value: 0 }, uRes: { value: 1000 }, uStripeK: { value: 0.4 } },
      vertexShader: CROWD_VS, fragmentShader: CROWD_FS, transparent: true, depthWrite: true });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; scene.add(this.mesh);
    this.g = g;
  }
  // fn(seat, k, S4, C4) writes the state of every seat; S4 = [present, pose, arms, lamp], C4 = [card, red, phone, _]
  apply(fn) {
    const S = this.S, C = this.C, st = [0, 0, 0, 0], ca = [0, 0, 0, 0];
    for (let k = 0; k < this.N; k++) {
      st[0] = 0; st[1] = 0; st[2] = 0; st[3] = 0; ca[0] = 0; ca[1] = 0; ca[2] = 0; ca[3] = 0;
      fn(this.seats[k], k, st, ca);
      const o = k * 4; S[o] = st[0]; S[o + 1] = st[1]; S[o + 2] = st[2]; S[o + 3] = st[3]; C[o] = ca[0]; C[o + 1] = ca[1]; C[o + 2] = ca[2]; C[o + 3] = ca[3];
    }
    this.aS.needsUpdate = true; this.aC.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ the whole bowl
export class Bowl {
  constructor(scene) {
    this.scene = scene;
    this.stands = DECKS.map((_, i) => { const m = buildStands(i); scene.add(m); return m; });
    // deck fronts (the fascia walls under each deck's first row) and the back walls
    const wall = flatMat('#3b3c40', 0.7), dark = flatMat('#18191c', 0.5);
    scene.add(band(DECKS[0].d0, 0, DECKS[0].d0, DECKS[0].h0, 360, wall));                 // the field wall
    scene.add(band(DECKS[0].d0 + DECKS[0].rows * DECKS[0].tread + 1.8, DECKS[0].h0 + DECKS[0].rows * DECKS[0].rise, RINGS[0].d + 0.6, RINGS[0].y0 - 0.9, 360, dark));
    scene.add(band(DECKS[1].d0 + DECKS[1].rows * DECKS[1].tread + 1.8, DECKS[1].h0 + DECKS[1].rows * DECKS[1].rise, RINGS[1].d + 0.6, RINGS[1].y0 - 0.9, 360, dark));
    const top = DECKS[2].h0 + DECKS[2].rows * DECKS[2].rise, dTop = DECKS[2].d0 + DECKS[2].rows * DECKS[2].tread;
    this.rimY = top; this.rimD = dTop;
    scene.add(band(dTop + 1.8, top, dTop + 1.8, top + 1.1, 360, flatMat('#2c2e33', 0.7)));      // the rim parapet
    scene.add(band(dTop + 1.8, top + 1.1, dTop + 3.2, top + 1.1, 360, flatMat('#2c2e33', 0.5)));
    // the halo board support (ring 3 stands on posts above the rim)
    scene.add(band(dTop + 3.0, 0, dTop + 3.0, top + 1.1, 360, flatMat('#34363b', 0.35)));     // the exterior shell
    this.rings = RINGS.map((_, i) => new Ring(i, scene));
    // the field + the surround
    const ft = fieldTexture();
    const field = new THREE.Mesh(new THREE.PlaneGeometry(120, 53.3), fieldMat(ft)); field.rotation.x = -Math.PI / 2; field.position.y = 0.01; scene.add(field); this.field = field;
    const surround = new THREE.Mesh(new THREE.PlaneGeometry(170, 120), flatMat('#1f3a24', 0.9)); surround.rotation.x = -Math.PI / 2; scene.add(surround);
    this.masts = new Masts(scene);
    this.sky = makeSky(scene);
    // the outside: a dark ground plane round the stadium (the lots are dressed per shot)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), flatMat('#0c0d10', 0.15)); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; scene.add(ground);
    this.ground = ground;
  }
}
