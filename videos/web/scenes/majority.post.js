// THE MAJORITY: the finish. The scene renders linear HDR at a reduced size; this pass adds the flood bloom (a bright
// prefilter and a small kawase chain at 1/4 and 1/8), anamorphic flare streaks off the floods and lamps, a filmic
// shoulder, the night grade (cold floods, sodium town), a vignette, grain and a touch of lens CA, straight to the canvas.
// Also: the LED type (Michroma sampled on a round-dot LED grid with bloom), drawn in 2D on top.
import * as THREE from 'three';

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const PRE = `precision highp float; varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uTexel;`;
const BRIGHT = PRE + `uniform float uTh;
  void main(){ vec3 c = vec3(0.0);
    for (int i = 0; i < 4; i++) { vec2 o = vec2(i == 0 || i == 2 ? -1.0 : 1.0, i < 2 ? -1.0 : 1.0) * uTexel; c += texture2D(tIn, vUv + o).rgb; }
    c *= 0.25; float l = max(c.r, max(c.g, c.b)); float k = max(l - uTh, 0.0) / max(l, 1e-4);
    gl_FragColor = vec4(min(c * k, vec3(40.0)), 1.0); }`;
const KAWASE = PRE + `uniform float uOff;
  void main(){ vec2 o = uTexel * (uOff + 0.5);
    vec3 c = texture2D(tIn, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tIn, vUv + vec2(o.x, -o.y)).rgb + texture2D(tIn, vUv + vec2(-o.x, o.y)).rgb + texture2D(tIn, vUv + vec2(o.x, o.y)).rgb;
    gl_FragColor = vec4(c * 0.25, 1.0); }`;
const STREAK = PRE + `uniform float uOff;
  void main(){ vec3 c = vec3(0.0); float w = 0.0;
    for (int i = -4; i <= 4; i++) { float k = exp(-float(i * i) / 8.0); c += texture2D(tIn, vUv + vec2(float(i) * uOff * uTexel.x, 0.0)).rgb * k; w += k; }
    gl_FragColor = vec4(c / w, 1.0); }`;
const COMP = `precision highp float; varying vec2 vUv;
  uniform sampler2D tIn, tB1, tB2, tSt; uniform vec2 uRes; uniform float uBloom, uStreak, uExpo, uSat, uVig, uGrain, uTime, uCa, uFlash, uBlack, uRedGrade, uContrast;
  uniform vec3 uLift, uGain, uFlashCol;
  float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  void main(){
    vec2 d = vUv - 0.5;
    vec3 c;
    c.r = texture2D(tIn, vUv + d * uCa).r; c.g = texture2D(tIn, vUv).g; c.b = texture2D(tIn, vUv - d * uCa).b;
    vec3 b = texture2D(tB1, vUv).rgb * 0.55 + texture2D(tB2, vUv).rgb * 0.8;
    vec3 st = texture2D(tSt, vUv).rgb;
    c += b * uBloom + st * uStreak * vec3(0.75, 0.85, 1.2);
    c *= uExpo;
    c = c * uGain + uLift;
    c = aces(c);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uSat);
    c = mix(c, vec3(l * 1.25, l * 0.25, l * 0.22), uRedGrade);
    c = (c - 0.5) * uContrast + 0.5;
    c *= 1.0 - uVig * dot(d * vec2(0.85, 1.0), d * vec2(0.85, 1.0)) * 1.8;
    c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
    c += (h12(vUv * uRes + fract(uTime * 7.13) * 91.0) - 0.5) * uGrain;
    c = mix(c, uFlashCol, uFlash);
    c = mix(c, vec3(0.0), uBlack);
    gl_FragColor = vec4(c, 1.0);
  }`;

export class Post {
  constructor(renderer, sw, sh, ow, oh) {
    this.r = renderer; this.sw = sw; this.sh = sh; this.ow = ow; this.oh = oh;
    const rt = (w, h, depth) => { const t = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: !!depth, samples: 0 }); t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter; return t; };
    this.rt = rt(sw, sh, true);
    const q = [Math.round(sw / 4), Math.round(sh / 4)], e = [Math.round(sw / 8), Math.round(sh / 8)];
    this.b4a = rt(...q); this.b4b = rt(...q); this.b8a = rt(...e); this.b8b = rt(...e); this.s4a = rt(...q); this.s4b = rt(...q);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); this.sc = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); this.quad.frustumCulled = false; this.sc.add(this.quad);
    const M = (fs, u) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false });
    this.mBright = M(BRIGHT, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uTh: { value: 1.0 } });
    this.mK = M(KAWASE, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uOff: { value: 1 } });
    this.mS = M(STREAK, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uOff: { value: 1 } });
    this.u = { tIn: { value: this.rt.texture }, tB1: { value: this.b4a.texture }, tB2: { value: this.b8a.texture }, tSt: { value: this.s4a.texture },
      uRes: { value: new THREE.Vector2(ow, oh) }, uBloom: { value: 0.9 }, uStreak: { value: 0.35 }, uExpo: { value: 1 }, uSat: { value: 1.0 }, uVig: { value: 0.55 },
      uGrain: { value: 0.035 }, uTime: { value: 0 }, uCa: { value: 0.004 }, uFlash: { value: 0 }, uBlack: { value: 0 }, uRedGrade: { value: 0 }, uContrast: { value: 1.04 },
      uLift: { value: new THREE.Color(0.004, 0.006, 0.012) }, uGain: { value: new THREE.Color(1, 1, 1) }, uFlashCol: { value: new THREE.Color(1, 0.95, 0.9) } };
    this.mC = M(COMP, this.u);
  }
  pass(mat, src, dst, texel) {
    mat.uniforms.tIn.value = src.texture; if (texel) mat.uniforms.uTexel.value.set(1 / texel[0], 1 / texel[1]);
    this.quad.material = mat; this.r.setRenderTarget(dst); this.r.render(this.sc, this.cam);
  }
  // render(scenes): draws [scene, camera] pairs into the HDR target (clearing depth between them), then the finish
  render(pairs, o = {}) {
    const r = this.r; r.setRenderTarget(this.rt); r.setClearColor(0x000000, 1); r.clear(true, true, true);
    r.autoClear = false;
    pairs.forEach(([s, c], i) => { if (i) r.clearDepth(); r.render(s, c); });
    r.autoClear = true;
    const sw = this.sw, sh = this.sh, q = [this.b4a.width, this.b4a.height], e = [this.b8a.width, this.b8a.height];
    this.mBright.uniforms.uTh.value = o.th ?? 1.1;
    this.pass(this.mBright, this.rt, this.b4a, [sw, sh]);
    this.mK.uniforms.uOff.value = 1; this.pass(this.mK, this.b4a, this.b4b, q);
    this.mK.uniforms.uOff.value = 1; this.pass(this.mK, this.b4b, this.b8a, q);
    this.mK.uniforms.uOff.value = 2; this.pass(this.mK, this.b8a, this.b8b, e);
    this.mK.uniforms.uOff.value = 3; this.pass(this.mK, this.b8b, this.b8a, e);
    this.mK.uniforms.uOff.value = 1; this.pass(this.mK, this.b4b, this.b4a, q);
    // streaks off the brightest points (4x wide chain)
    this.mS.uniforms.uOff.value = 3; this.pass(this.mS, this.b4b, this.s4a, q);
    this.mS.uniforms.uOff.value = 9; this.pass(this.mS, this.s4a, this.s4b, q);
    this.mS.uniforms.uOff.value = 24; this.pass(this.mS, this.s4b, this.s4a, q);
    const u = this.u;
    for (const k of ['bloom', 'streak', 'expo', 'sat', 'vig', 'grain', 'time', 'ca', 'flash', 'black', 'redGrade', 'contrast']) {
      const U = 'u' + k[0].toUpperCase() + k.slice(1); if (o[k] != null) u[U].value = o[k]; }
    const def = { bloom: 0.9, streak: 0.35, expo: 1, sat: 1, vig: 0.55, grain: 0.035, ca: 0.004, flash: 0, black: 0, redGrade: 0, contrast: 1.04 };
    for (const k in def) if (o[k] == null) u['u' + k[0].toUpperCase() + k.slice(1)].value = def[k];
    if (o.gain) u.uGain.value.setRGB(...o.gain); else u.uGain.value.setRGB(1, 1, 1);
    if (o.lift) u.uLift.value.setRGB(...o.lift); else u.uLift.value.setRGB(0.004, 0.006, 0.012);
    if (o.flashCol) u.uFlashCol.value.setRGB(...o.flashCol); else u.uFlashCol.value.setRGB(1, 0.95, 0.9);
    this.quad.material = this.mC; r.setRenderTarget(null); r.setViewport(0, 0, this.ow, this.oh); r.render(this.sc, this.cam);
  }
}

// ------------------------------------------------------------------ LED type
// Text is set in Michroma on a small canvas where one pixel is one LED, then every lit LED is drawn as a round
// emissive dot (a hot core and a soft halo), over a dark panel of unlit dots. Nothing lingers: the board scans on in
// two frames and snaps off.
export class LED {
  constructor(W, H) {
    this.W = W; this.H = H; this.cache = new Map();
    this.sprites = {};
  }
  sprite(col, pitch) {
    const key = col + pitch; if (this.sprites[key]) return this.sprites[key];
    const s = Math.ceil(pitch * 3.2), c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
    const cx = s / 2, r0 = pitch * 0.43;
    const halo = g.createRadialGradient(cx, cx, 0, cx, cx, s / 2); halo.addColorStop(0, col + 'aa'); halo.addColorStop(0.3, col + '33'); halo.addColorStop(1, col + '00');
    g.fillStyle = halo; g.fillRect(0, 0, s, s);
    const core = g.createRadialGradient(cx - r0 * 0.2, cx - r0 * 0.2, 0, cx, cx, r0); core.addColorStop(0, '#ffffff'); core.addColorStop(0.45, col); core.addColorStop(1, col + 'cc');
    g.fillStyle = core; g.beginPath(); g.arc(cx, cx, r0, 0, Math.PI * 2); g.fill();
    return (this.sprites[key] = c);
  }
  // the lit-LED grid for a text block (cached): lines, rows of LEDs per cap height
  grid(lines, capLEDs) {
    const key = lines.join('|') + capLEDs; if (this.cache.has(key)) return this.cache.get(key);
    const fs = capLEDs / 0.72, c = document.createElement('canvas'), g = c.getContext('2d');
    g.font = `${fs}px Michroma`;
    const ws = lines.map(l => Math.ceil(g.measureText(l).width)), w = Math.max(...ws) + 4, lh = Math.round(capLEDs * 1.5), h = lh * lines.length + 4;
    c.width = w; c.height = h; g.font = `${fs}px Michroma`; g.fillStyle = '#fff'; g.textBaseline = 'alphabetic'; g.textAlign = 'center';
    lines.forEach((l, i) => g.fillText(l, w / 2, 2 + i * lh + Math.round(capLEDs * 1.18)));
    const d = g.getImageData(0, 0, w, h).data, pts = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = d[(y * w + x) * 4 + 3]; if (a > 110) pts.push(x, y, a / 255); }
    const out = { w, h, pts }; this.cache.set(key, out); return out;
  }
  // draw a block centred at (cx, cy): pitch px per LED; col; age (s) for the scan-on; panel: draw the unlit board
  draw(ctx, lines, { cx = this.W / 2, cy = 700, pitch = 10, capLEDs = 14, col = '#F4E6D0', age = 1, panel = true, panelAlpha = 0.72, maxW = this.W - 90, glow = 1, tilt = 0 } = {}) {
    let G = this.grid(lines, capLEDs);
    if (G.w * pitch > maxW) pitch = maxW / G.w;
    const w = G.w * pitch, h = G.h * pitch, x0 = cx - w / 2, y0 = cy - h / 2;
    const scan = Math.min(1, age / (2 / 30));                           // two-frame scan-on, left to right
    ctx.save();
    if (panel) {
      const px = 26, py = 20;
      ctx.globalAlpha = panelAlpha; ctx.fillStyle = '#050506'; ctx.fillRect(x0 - px, y0 - py, w + px * 2, h + py * 2);
      ctx.globalAlpha = panelAlpha * 0.9; ctx.fillStyle = '#1b1b1f';
      for (let y = y0 - py + pitch * 0.5; y < y0 + h + py; y += pitch) for (let x = x0 - px + pitch * 0.5; x < x0 + w + px; x += pitch) { ctx.fillRect(x - pitch * 0.2, y - pitch * 0.2, pitch * 0.4, pitch * 0.4); }
      ctx.globalAlpha = 1;
    }
    const spr = this.sprite(col, pitch), s = spr.width;
    ctx.globalCompositeOperation = 'lighter';
    const P = G.pts;
    for (let i = 0; i < P.length; i += 3) {
      const x = x0 + (P[i] + 0.5) * pitch, y = y0 + (P[i + 1] + 0.5) * pitch;
      if ((x - x0) / w > scan) continue;
      ctx.globalAlpha = Math.min(1, P[i + 2] * 1.1) * glow;
      ctx.drawImage(spr, x - s / 2, y - s / 2);
    }
    ctx.restore();
    return { x0, y0, w, h, pitch };
  }
}
