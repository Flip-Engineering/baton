// LIVING PHOTO (ARCHIVE SCENES studio, cycle 1): a real photograph played as a shot, for any scene.
//
// Why: HORDE's Butte shot enlarged 640 px service copies 6-7x and cut five looks in 4.4 s; the faces, flags and banners were gone and
// the photograph read as texture. Here the document stays the document. A shot is ONE photograph at the size it was scanned, ONE look,
// a camera that moves for a reason, and whatever is added (steam, dust, light, type) is confined to places the photograph allows.
//
//   import { LivingPhoto, LOOKS, path } from '../lib/fx/living_photo.js';
//   const P = await LivingPhoto.load('butte_forsyth');              // web/assets/archive/<name>/ baked by tools/archive_bake.py
//   const cam = path([{ t: 0, cx: .3, cy: .3, zoom: 1.2 }, { t: 3, cx: .27, cy: .52, zoom: 2.3 }], { reason: 'push from the flag to the faces under it' });
//   P.draw(ctx, t, { cam: cam(t), look: LOOKS.horde, atmos: [...], type: [...], lights: [...] });
//   P.magnification(cam(t))        // { x, note }: how many output px one MASTER px covers; > 1.5 means the shot is enlarging the scan
//
// What it offers (each is a tool, none is required):
//   camera   path(keys, {reason, ease}): cx, cy (plate uv), zoom (1 = full height), with push (a dolly into depth, 2.5D) and parallax.
//            Parallax is one layer displaced by its own depth, capped, so no matte edges tear and no fill is invented.
//   look     a LOOK is a small object: tone (contrast, pivot), ramp (shadow/mid/light colours), keep (share of the photograph's own colour),
//            warmth, sat, halation, vignette, grain. LOOKS.* are STARTING POINTS for each piece's own register, not the archive look.
//   atmos    steam / dust / smoke, drifting noise, confined to a MASK (region polygon in plate uv, optional depth band): it never
//            leaves where the photograph has space for it (steam off a stack, dust over the ground), and it is plate-anchored.
//   type     lettering set INSIDE the photograph: the text is drawn in plate space (so it moves with the parallax), takes the surface's
//            light and grain (ink multiplies, paint covers with the plate's own texture, light adds), and can be revealed by a wipe.
//   light    point lights over normals taken from the depth (a lamp, a flare), added to what is lit already.
//   grain    measured on the plate by the bake (meta.grain) and re-made at the size the print's grain has on screen.
//
// Backward compatible: a new module; nothing else changes. Needs WebGL2 (the scenes' own canvas stack already does).

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
export const EASE = { smooth, linear: x => clamp(x, 0, 1), out: x => 1 - Math.pow(1 - clamp(x, 0, 1), 2.2), inout: x => { x = clamp(x, 0, 1); return x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; } };

// A camera move with a stated reason. keys: [{t, cx, cy, zoom, push?, par?}], returns f(t) -> cam. f.reason is documentation for the shot list.
export function path(keys, { reason = '', ease = 'smooth' } = {}) {
  const e = EASE[ease] || smooth;
  const f = t => {
    if (t <= keys[0].t) return { ...keys[0] };
    for (let i = 1; i < keys.length; i++) if (t <= keys[i].t) {
      const a = keys[i - 1], b = keys[i], u = e((t - a.t) / (b.t - a.t || 1)), L = (k, d = 0) => (a[k] ?? d) + ((b[k] ?? d) - (a[k] ?? d)) * u;
      return { cx: L('cx', .5), cy: L('cy', .5), zoom: L('zoom', 1), push: L('push'), par: [L('px'), L('py')] };
    }
    return { ...keys[keys.length - 1], par: [keys[keys.length - 1].px || 0, keys[keys.length - 1].py || 0] };
  };
  f.reason = reason; f.keys = keys; f.t0 = keys[0].t; f.t1 = keys[keys.length - 1].t;
  return f;
}

// LOOKS: starting points. ramp = [shadow, mid, light] linear-ish rgb 0..1. keep = share of the photograph's own colour kept (0 = pure ramp).
// Each piece sets its own; two pieces sharing a preset is the failure this studio exists to avoid.
export const LOOKS = {
  none: { ramp: [[0, 0, 0], [.5, .5, .5], [1, 1, 1]], keep: 1, contrast: 1, pivot: .5, sat: 1, warmth: 0, halation: 0, vignette: 0, grain: .02, lift: 0 },
  // HORDE: the piece's blood-red, mid-tones kept (a print of a plate, not a threshold), grain as film
  horde: { ramp: [[.018, 0, .004], [.46, .04, .033], [1, .42, .30]], keep: 0, contrast: 1.2, pivot: .46, sat: 1, warmth: 0, halation: .22, vignette: .5, grain: .05, lift: .02 },
  // COMMON WEALTH: dusk colour, Kodachrome-like: warm highs, cool shadows, saturated mids (for FSA colour plates; applied to B&W it tones them)
  dusk: { ramp: [[.03, .045, .09], [.5, .36, .36], [1, .86, .72]], keep: .35, contrast: 1.08, pivot: .5, sat: 1.12, warmth: .02, halation: .3, vignette: .28, grain: .035, lift: .03 },
  // MACHINES: cream paper and one red ink
  print: { ramp: [[.11, .04, .035], [.8, .3, .22], [.98, .93, .83]], keep: 0, contrast: 1.2, pivot: .42, sat: 1, warmth: 0, halation: 0, vignette: .15, grain: .03, lift: 0 },
  // the plate as printed: silver, nothing added (a plain document look for a piece that wants the photograph unmarked)
  silver: { ramp: [[.02, .02, .022], [.5, .5, .5], [.96, .955, .94]], keep: 0, contrast: 1.08, pivot: .5, sat: 1, warmth: .02, halation: .08, vignette: .2, grain: .035, lift: .01 },
};

const VS = `#version 300 es
in vec2 a; out vec2 vUv; void main(){ vUv = a * .5 + .5; vUv.y = 1. - vUv.y; gl_Position = vec4(a, 0, 1); }`;
const NA = 3, NLT = 2;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uCol, uDep, uOv, uM0, uM1, uM2;
uniform vec2 uOut;            // output px
uniform vec4 uView;           // plate uv of output top-left (xy), extent (zw)
uniform float uAsp;           // plate w/h
uniform float uPush, uK0; uniform vec2 uFocus, uPar;
uniform vec3 uRamp0, uRamp1, uRamp2; uniform float uKeep, uCon, uPiv, uSat, uWarm, uHal, uVig, uGrain, uLift, uGrainPx, uSeed, uTime;
uniform vec4 uAt[${NA}];      // kind(0 off,1 steam,2 dust,3 smoke), strength, scale, speed
uniform vec4 uAw[${NA}];      // wind x, y, depth lo, depth hi
uniform vec3 uAc[${NA}];      // colour
uniform vec4 uLp[${NLT}]; uniform vec4 uLc[${NLT}];   // light pos x,y,z,radius ; colour rgb, weight
uniform float uOvA, uOvPaint;   // overlay (type) on; paint (covers) or ink (multiplies)
uniform float uRelief;
uniform vec2 uBurn;           // darken the top / bottom of the frame (a ground for type, never a box)
float lum(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + 1.), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + 11.7; a *= .5; } return s; }
vec2 unproject(vec2 b){
  vec2 q = b;
  for (int k = 0; k < 5; k++){ float n = textureLod(uDep, q, 0.).r; float s = 1. + uPush * (uK0 + (1. - uK0) * n); q = uFocus + (b - uFocus) / s - uPar * n; }
  return q;
}
void main(){
  vec2 b = uView.xy + vUv * uView.zw;
  vec2 q = unproject(b);
  vec2 qc = clamp(q, vec2(0.0005), vec2(.9995));
  vec3 c = texture(uCol, qc).rgb;
  float n = textureLod(uDep, qc, 0.).r;
  // unsharp from a coarser mip: the scan is bigger than the screen at most views, so this restores the edge the downscale softens
  vec3 blur = textureLod(uCol, qc, 1.6).rgb; c = c + (c - blur) * .35;
  float L = lum(c);
  // ---- look: tone curve, then a ramp (the photograph's own colour kept by uKeep)
  float t = clamp((L - uPiv) * uCon + uPiv + uLift * (1. - L), 0., 1.);
  vec3 ramp = t < .5 ? mix(uRamp0, uRamp1, t * 2.) : mix(uRamp1, uRamp2, t * 2. - 1.);
  vec3 own = mix(vec3(t), c, 1.);
  own = vec3(t) + (own - L) * uSat;
  c = mix(ramp, own + vec3(uWarm, uWarm * .3, -uWarm), uKeep);
  // ---- halation: bright edges bleed a little warm light
  if (uHal > 0.){ vec3 bl = textureLod(uCol, qc, 3.5).rgb; float bh = smoothstep(.55, 1., lum(bl)); c += uHal * bh * ramp * .55; }
  // ---- light: point lights over normals from the depth
  if (uLc[0].w + uLc[1].w > 0.){
    vec2 e = vec2(1.5 / uOut.x * uView.z * 1.0, 1.5 / uOut.y * uView.w);
    float dx = textureLod(uDep, qc + vec2(e.x, 0), 0.).r - textureLod(uDep, qc - vec2(e.x, 0), 0.).r;
    float dy = textureLod(uDep, qc + vec2(0, e.y), 0.).r - textureLod(uDep, qc - vec2(0, e.y), 0.).r;
    vec3 N = normalize(vec3(-dx * uRelief * 24., -dy * uRelief * 24., 1.));
    for (int i = 0; i < ${NLT}; i++){
      if (uLc[i].w <= 0.) continue;
      vec3 P = vec3(qc.x * uAsp, qc.y, n * .3), Lp = vec3(uLp[i].x * uAsp, uLp[i].y, uLp[i].z);
      vec3 d = Lp - P; float dist = length(d.xy); float lam = max(0., dot(N, normalize(d)));
      c += uLc[i].rgb * uLc[i].w * (.35 + .65 * lam) / (1. + pow(dist / max(1e-3, uLp[i].w), 2.)) * (.15 + L);
    }
  }
  // ---- atmosphere: noise inside a mask (and a depth band), anchored to the plate
  for (int i = 0; i < ${NA}; i++){
    if (uAt[i].x < .5) continue;
    float m = i == 0 ? texture(uM0, qc).r : i == 1 ? texture(uM1, qc).r : texture(uM2, qc).r;
    if (m <= .002) continue;
    float db = smoothstep(uAw[i].z - .05, uAw[i].z + .05, n) * (1. - smoothstep(uAw[i].w - .05, uAw[i].w + .05, n));
    if (uAw[i].w >= 1. && uAw[i].z <= 0.) db = 1.;
    vec2 p = vec2(qc.x * uAsp, qc.y) * uAt[i].z;
    vec2 wnd = uAw[i].xy * uTime * uAt[i].w;
    float k = uAt[i].x;
    vec2 pp = p - wnd; if (k < 1.5) pp.y *= .55; else if (k < 2.5) pp.y *= 2.6;
    float w = fbm(pp + fbm(pp * .8 + 3.1) * 1.4);
    float a = smoothstep(.34, .78, w) * m * db * uAt[i].y;
    vec3 col = uAc[i];
    c = mix(c, col * (k > 2.5 ? 1. : (.55 + .6 * L)), clamp(a, 0., .9));
  }
  // ---- type set in the photograph (drawn in plate space, so it moves with the parallax)
  if (uOvA > .5){
    vec4 ov = texture(uOv, q);
    if (ov.a > .003){
      float hp = L - lum(textureLod(uCol, qc, 2.).rgb);     // the surface's own texture shows through the lettering
      vec3 ink = uOvPaint > .5 ? ov.rgb * (.75 + .5 * L + hp * 1.6) : c * ov.rgb * (1. + hp * 1.4);
      c = mix(c, ink, ov.a);
    }
  }
  // ---- burn: a gradient darkening where the scene will set type
  c *= 1. - uBurn.x * (1. - smoothstep(0., .5, vUv.y)) - uBurn.y * smoothstep(.5, 1., vUv.y);
  // ---- vignette
  vec2 vv = vUv - .5; c *= 1. - uVig * smoothstep(.25, .85, length(vv * vec2(1., .8)) * 1.25);
  // ---- grain, at the size the print's grain has on screen
  if (uGrain > 0.){
    vec2 px = vUv * uOut / uGrainPx; float g = vn(px + uSeed * 7.1) + vn(px * 1.7 + 19. + uSeed * 3.3) - 1.;
    float m = 4. * clamp(L, 0., 1.) * (1. - clamp(L, 0., 1.)); c += g * uGrain * (.4 + m);
  }
  o = vec4(clamp(c, 0., 1.), 1);
}`;

const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('load ' + src)); i.src = src; });

export class LivingPhoto {
  static async load(name, { base = '/web/assets/archive/', width = 1080, height = 1920 } = {}) {
    const meta = await (await fetch(`${base}${name}/meta.json`)).json();
    const [ci, di] = await Promise.all([loadImg(`${base}${name}/color.jpg`), loadImg(`${base}${name}/depth.png`)]);
    return new LivingPhoto(meta, ci, di, width, height);
  }
  constructor(meta, ci, di, W, H) {
    this.meta = meta; this.W = W; this.H = H; this.pw = ci.width; this.ph = ci.height; this.asp = this.pw / this.ph;
    const cv = this.canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const gl = this.gl = cv.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error('living_photo: WebGL2 unavailable');
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const pr = this.pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    this.u = new Proxy({}, { get: (o, k) => o[k] ?? (o[k] = gl.getUniformLocation(pr, k)) });
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const al = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
    const tex = (img, mip, unpackFlipY = false) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, unpackFlipY);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      if (mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
      else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this._tex = tex;
    this.tCol = tex(ci, true); this.tDep = tex(di, true);
    const blank = Object.assign(document.createElement('canvas'), { width: 4, height: 4 });
    this.tOv = tex(blank, false); this.tM = [0, 1, 2].map(() => tex(blank, false));
    // overlays are drawn in plate space at 2048 px wide
    this.ovW = 2048; this.ovH = Math.round(2048 / this.asp);
    this._ov = Object.assign(document.createElement('canvas'), { width: this.ovW, height: this.ovH });
    this._ovKey = ''; this._mKey = ['', '', ''];
  }
  // How far this view enlarges the SCAN: output px per master px. The pack may be smaller than the master (meta.scale); the number is about the master.
  magnification(cam = {}) {
    const zoom = cam.zoom ?? 1, viewH_pack = this.ph / zoom;
    const perPack = this.H / viewH_pack, perMaster = perPack * (this.meta.scale || 1);
    const w = perMaster > 1.5 ? 'enlarges the scan: faces and lettering will soften' : perMaster > 1 ? 'about 1:1 on the scan' : 'scan is larger than the screen: full detail';
    return { x: +perMaster.toFixed(2), packX: +perPack.toFixed(2), note: w };
  }
  // The worst enlargement along a move, so a shot list can state it before a render.
  audit(cam, steps = 24) { let m = 0; for (let i = 0; i <= steps; i++) m = Math.max(m, this.magnification(cam(cam.t0 + (cam.t1 - cam.t0) * i / steps)).x); return +m.toFixed(2); }
  viewRect({ cx = .5, cy = .5, zoom = 1 } = {}) {
    const oa = this.W / this.H, h = 1 / zoom, w = (h * this.ph * oa) / this.pw;   // plate-uv extents: h of the plate height, w of its width
    const x = clamp(cx - w / 2, 0, 1 - w), y = clamp(cy - h / 2, 0, 1 - h);
    return [x, y, w, h];
  }
  // draw a polygon mask (plate uv points) into mask slot i, blurred, optional soft top/bottom ramp
  _mask(i, poly, blurPx = 24) {
    const key = JSON.stringify(poly) + blurPx; if (this._mKey[i] === key) return; this._mKey[i] = key;
    const w = 1024, h = Math.round(1024 / this.asp), c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.filter = `blur(${blurPx}px)`; g.fillStyle = '#fff'; g.beginPath();
    poly.forEach(([x, y], k) => k ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)); g.closePath(); g.fill();
    const gl = this.gl; gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, this.tM[i]); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  }
  // type items: {text, x, y (plate uv centre), h (plate uv cap height), rot (deg), font, color:[r,g,b] multiply tint, mode:'ink'|'paint', wipe:[t0,t1], align}
  _type(items, t) {
    const live = (items || []).filter(it => !it.wipe || t >= it.wipe[0]);
    const key = JSON.stringify(live.map(it => [it.text, it.x, it.y, it.h, it.rot, it.font, it.color, it.mode, it.wipe ? Math.round(smooth((t - it.wipe[0]) / (it.wipe[1] - it.wipe[0] || 1)) * 40) : 1]));
    if (key === this._ovKey) return live.length;
    this._ovKey = key; const g = this._ov.getContext('2d'); g.clearRect(0, 0, this.ovW, this.ovH);
    for (const it of live) {
      g.save(); g.translate(it.x * this.ovW, it.y * this.ovH); g.rotate((it.rot || 0) * Math.PI / 180);
      const capPx = it.h * this.ovH; g.font = `${capPx / .72}px ${it.font || '"Anton"'}`; g.textAlign = it.align || 'center'; g.textBaseline = 'middle';
      const wd = g.measureText(it.text).width; const u = it.wipe ? smooth((t - it.wipe[0]) / (it.wipe[1] - it.wipe[0] || 1)) : 1;
      if (u < 1) { g.beginPath(); const x0 = (it.align === 'left' ? 0 : it.align === 'right' ? -wd : -wd / 2); g.rect(x0 - 4, -capPx, wd * u + 8, capPx * 2); g.clip(); }
      // multiplicative ink: colour channel carries the tint the photograph is multiplied by where the ink lies (paper -> ink colour)
      const col = it.color || [.1, .02, .02], paint = it.mode === 'paint';
      g.fillStyle = `rgb(${Math.round(col[0] * 255)},${Math.round(col[1] * 255)},${Math.round(col[2] * 255)})`;
      g.globalAlpha = it.alpha ?? 1; g.fillText(it.text, 0, 0); g.restore();
    }
    const gl = this.gl; gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, this.tOv); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._ov);
    return live.length;
  }
  render(t = 0, o = {}) {
    const gl = this.gl, u = this.u, cam = o.cam || {}, look = { ...LOOKS.none, ...(o.look || {}) };
    gl.viewport(0, 0, this.W, this.H); gl.useProgram(this.pr);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tCol); gl.uniform1i(u.uCol, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tDep); gl.uniform1i(u.uDep, 1);
    const nType = this._type(o.type, t);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.tOv); gl.uniform1i(u.uOv, 2); gl.uniform1f(u.uOvA, nType ? 1 : 0); gl.uniform1f(u.uOvPaint, o.typeMode === 'paint' ? 1 : 0);
    const A = (o.atmos || []).slice(0, NA), at = new Float32Array(NA * 4), aw = new Float32Array(NA * 4), ac = new Float32Array(NA * 3);
    A.forEach((a, i) => {
      this._mask(i, a.region, a.soft ?? 24);
      at.set([{ steam: 1, dust: 2, smoke: 3 }[a.kind] || 1, a.strength ?? .5, a.scale ?? 6, a.speed ?? 1], i * 4);
      aw.set([...(a.wind || [0, -.05]), ...(a.depth || [0, 1])], i * 4); ac.set(a.color || [.9, .9, .9], i * 3);
      gl.activeTexture(gl.TEXTURE3 + i); gl.bindTexture(gl.TEXTURE_2D, this.tM[i]); gl.uniform1i(u['uM' + i], 3 + i);
    });
    for (let i = A.length; i < NA; i++) { gl.activeTexture(gl.TEXTURE3 + i); gl.bindTexture(gl.TEXTURE_2D, this.tM[i]); gl.uniform1i(u['uM' + i], 3 + i); }
    gl.uniform4fv(u['uAt[0]'], at); gl.uniform4fv(u['uAw[0]'], aw); gl.uniform3fv(u['uAc[0]'], ac);
    const L = (o.lights || []).slice(0, NLT), lp = new Float32Array(NLT * 4), lc = new Float32Array(NLT * 4);
    L.forEach((l, i) => { lp.set([l.x, l.y, l.z ?? .3, l.radius ?? .3], i * 4); lc.set([...(l.color || [1, 1, 1]), l.w ?? 1], i * 4); });
    gl.uniform4fv(u['uLp[0]'], lp); gl.uniform4fv(u['uLc[0]'], lc);
    const V = this._view = this.viewRect(cam);
    gl.uniform2f(u.uOut, this.W, this.H); gl.uniform4f(u.uView, ...V); gl.uniform1f(u.uAsp, this.asp);
    gl.uniform1f(u.uPush, cam.push || 0); gl.uniform1f(u.uK0, o.k0 ?? .35);
    gl.uniform2f(u.uFocus, ...(cam.focus || [V[0] + V[2] / 2, V[1] + V[3] / 2])); gl.uniform2f(u.uPar, ...(cam.par || [0, 0]));
    gl.uniform3f(u.uRamp0, ...look.ramp[0]); gl.uniform3f(u.uRamp1, ...look.ramp[1]); gl.uniform3f(u.uRamp2, ...look.ramp[2]);
    gl.uniform1f(u.uKeep, look.keep); gl.uniform1f(u.uCon, look.contrast); gl.uniform1f(u.uPiv, look.pivot); gl.uniform1f(u.uSat, look.sat);
    gl.uniform1f(u.uWarm, look.warmth); gl.uniform1f(u.uHal, look.halation); gl.uniform1f(u.uVig, look.vignette); gl.uniform1f(u.uLift, look.lift);
    // grain: amplitude from the look, size from the plate's own grain (px in the pack) times how big a pack px is on screen
    const g0 = this.meta.grain || {}, packPx = this.H / (this.ph * V[3]);
    gl.uniform1f(u.uGrain, o.grain ?? look.grain); gl.uniform1f(u.uGrainPx, clamp(Math.max(1.4, (g0.corr_px || 1.2) * packPx * .9), 1.4, 3.4));
    gl.uniform1f(u.uSeed, (o.seed ?? Math.floor(t * 24)) % 97); gl.uniform1f(u.uTime, t); gl.uniform2f(u.uBurn, o.burn?.top ?? 0, o.burn?.bottom ?? 0); gl.uniform1f(u.uRelief, o.relief ?? 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }
  draw(ctx, t = 0, o = {}) { this.render(t, o); ctx.drawImage(this.canvas, o.x ?? 0, o.y ?? 0, o.w ?? ctx.canvas.width, o.h ?? ctx.canvas.height); return this; }
  // plate px (of the pack) -> plate uv
  uv(px, py) { return [px / this.pw, py / this.ph]; }
}
