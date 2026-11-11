// geo/globe: orthographic globe with real coastlines, bases and great-circle arcs.
//
// Two renderers behind one draw():
//   shader styles  'photo' | 'night' | 'poster'  : a WebGL2 per-pixel sphere over baked equirectangular layers
//                  (land / coast / borders, 2,932 city lights, two cloud decks + terrain noise). The sun is a real
//                  direction: the terminator, ocean glint, night lights and the atmosphere's in-scatter and limb
//                  halo are computed from it, and clouds drift with t. Cost is one pass over the globe's screen rect.
//   2D styles      'solid' | 'wire' | 'dots'     : canvas 2D (the round-1 look). The static layer (ocean, graticule,
//                  land, borders, rivers, coast, texture, shading) is cached as a bitmap keyed on the rotation
//                  quantized to 0.2 deg + scale, so a slow or held globe redraws only atmosphere and overlays.
//
//   const globe = new Globe(geo, { cx, cy, r });
//   globe.draw(ctx, { rot, t, style: 'photo', sun: [-0.55, 0.45, 0.7], clouds: 0.8, atmo: 1, lights: 1, scale });
//   globe.drawBases(ctx, { rot, t, age, scale }); globe.drawArcs(ctx, arcs, { rot, scale }); globe.at(ll, rot, scale)
import { geoOrthographic, geoEquirectangular, geoPath, geoGraticule, geoInterpolate, geoDistance, geoRotation } from 'd3-geo';
import { C, clamp, lerp, ease, line } from '../../kit.js';
import { hash, v3, TAU, FLAGS } from './data.js';
import { GL, GLSL_NOISE } from './gl.js';

export const GLOBE_STYLES = {
  // day/night photographic in ACP colours: oxblood sea with sun glint, rust-and-cream land, cream clouds, red limb
  photo:  { mode: 0, sun: [-0.55, 0.42, 0.72], lights: 0.9, clouds: 0.75, atmo: 1 },
  // mostly night side: the sun behind the right limb, city lights carry the picture
  night:  { mode: 0, sun: [0.92, 0.25, -0.3], lights: 1.4, clouds: 0.45, atmo: 1.1 },
  // flat red / cream / black: hard terminator, flat cloud shapes with hard shadows, cream rim
  poster: { mode: 1, sun: [-0.6, 0.5, 0.62], lights: 0, clouds: 0.8, atmo: 0.6 },
};

const FS_BAKE = `#version 300 es
precision highp float; in vec2 v; out vec4 o;
${GLSL_NOISE}
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  float a = h21(i.xy + i.z * 17.), b = h21(i.xy + vec2(1, 0) + i.z * 17.), c = h21(i.xy + vec2(0, 1) + i.z * 17.), d = h21(i.xy + vec2(1, 1) + i.z * 17.);
  float e = h21(i.xy + (i.z + 1.) * 17.), f2 = h21(i.xy + vec2(1, 0) + (i.z + 1.) * 17.), g = h21(i.xy + vec2(0, 1) + (i.z + 1.) * 17.), hh = h21(i.xy + vec2(1, 1) + (i.z + 1.) * 17.);
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, f2, f.x), mix(g, hh, f.x), f.y), f.z); }
float f3(vec3 p){ float s = 0., a = .5; for (int i = 0; i < 6; i++){ s += a * n3(p); p = p * 2.07 + 3.1; a *= .5; } return s; }
void main(){ float lon = (v.x - .5) * 6.2831853, lat = (v.y - .5) * 3.1415927;
  vec3 p = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  vec3 q = p * 2.6 + vec3(f3(p * 3.), f3(p * 3. + 5.), 0.) * 1.4;           // domain-warped decks
  float band = .55 + .45 * cos(lat * 5.2);                                    // storm belts / subtropical gaps
  float c1 = smoothstep(.58, .82, f3(q) * (.7 + .45 * band));
  float c2 = smoothstep(.62, .85, f3(p * 7. + 11.) * (.8 + .3 * band));
  o = vec4(c1, c2, f3(p * 9. + 2.), 1.); }`;

const FS_GLOBE = `#version 300 es
precision highp float; in vec2 v; out vec4 o;
uniform sampler2D LAND, LITE, CLOUD; uniform vec2 RES, OFF, CEN; uniform float R, T, MODE, LIGHTS, CLOUDS, ATMO, GRID;
uniform mat3 ROT; uniform vec3 SUN;
vec2 ll(vec3 n){ vec3 w = transpose(ROT) * n; return vec2(atan(w.x, w.z), asin(clamp(w.y, -1., 1.))); }
vec2 uvOf(vec2 a){ return vec2(a.x / 6.2831853 + .5, .5 - a.y / 3.1415927); }
void main(){
  vec2 px = OFF + vec2(v.x, 1. - v.y) * RES;
  vec2 p = (px - CEN) / R; p.y = -p.y; float rho = length(p);
  vec3 S = normalize(SUN);
  vec3 red = vec3(.788, .122, .216), crm = vec3(.957, .902, .816);
  // atmosphere outside the disk: limb halo, brighter where the limb faces the sun
  if (rho > 1.) {
    float hgt = rho - 1.; vec2 dir = p / rho; float sf = clamp(dot(vec3(dir, 0.), S) * .7 + .45, 0., 1.);
    if (MODE == 1.) { float ring = step(hgt, .012); o = vec4(crm, ring * ATMO); return; }
    float k = exp(-hgt * 22.) * .9 + exp(-hgt * 6.) * .25;
    vec3 ac = mix(red * .9, vec3(1., .55, .32), exp(-hgt * 40.) * sf);
    float a = k * ATMO * (.25 + .9 * sf);
    o = vec4(ac * min(a, 1.) / max(min(a, 1.), 1e-3), clamp(a, 0., 1.)); return; }
  float z = sqrt(1. - rho * rho); vec3 N = vec3(p, z);
  vec2 g = ll(N), uv = uvOf(g);
  vec4 L = texture(LAND, uv); float land = L.r, coast = L.g, bord = L.b;
  float drift = T * .004;
  vec4 cl = texture(CLOUD, vec2(uv.x + drift, uv.y)), cl2 = texture(CLOUD, vec2(uv.x - drift * .6 + .31, uv.y));
  float cloud = clamp(cl.r * .9 + cl2.g * .45, 0., 1.) * CLOUDS;
  float ndl = dot(N, S), day = smoothstep(-.1, .16, ndl), lam = max(ndl, 0.);
  // graticule, analytic in lon/lat (10 deg)
  vec2 gd = g * 57.29578 / 10.; vec2 fw = fwidth(gd); vec2 gl2 = abs(fract(gd - .5) - .5) / max(fw, 1e-4);
  float grat = (1. - min(min(gl2.x, gl2.y), 1.)) * GRID;
  vec3 col; float a = 1.;
  if (MODE == 0.) {
    float tn = cl.b;
    vec3 sea = mix(vec3(.05, .012, .02), vec3(.13, .03, .04), .5 + .5 * N.z);
    vec3 ground = mix(vec3(.36, .09, .07), vec3(.6, .38, .26), smoothstep(.45, .75, tn));
    ground = mix(ground, vec3(.85, .8, .72), smoothstep(.62, .8, abs(g.y) / 1.5708));                  // pale high latitudes
    vec3 alb = mix(sea, ground, land);
    col = alb * (.035 + 1.15 * lam);
    vec3 H = normalize(S + vec3(0, 0, 1.));
    col += vec3(1., .78, .6) * pow(max(dot(N, H), 0.), 400.) * .6 * (1. - land) * (1. - cloud);        // sun glint on the sea
    col = mix(col, crm * .9, coast * .35 * (.3 + .7 * day));
    col = mix(col, vec3(.1, .02, .03), bord * .35 * land);
    col = mix(col, crm, grat * .08);
    // night: city lights under the cloud deck
    float lite = texture(LITE, uv).r;
    col += vec3(1., .64, .3) * lite * LIGHTS * (1. - day) * (1. - cloud * .7) * 1.6;
    // clouds: lit cream by day, faint by night, shadow offset toward the anti-sun
    float cs = texture(CLOUD, vec2(uv.x + drift - S.x * .004, uv.y + S.y * .004)).r * CLOUDS;
    col *= 1. - cs * .35 * day;
    col = mix(col, crm * (.05 + 1.05 * lam) + vec3(.2, .03, .04) * (1. - day) * .15, cloud * .85);
    // atmosphere in-scatter: limb brightening in the sun, a red terminator band
    float limb = pow(1. - z, 2.4);
    col += mix(red, vec3(1., .6, .38), lam) * limb * ATMO * (.18 + .9 * day);
    col += red * .5 * exp(-pow(ndl / .12, 2.)) * ATMO * .35;
  } else {                                                          // poster
    float lit = step(0., ndl);
    vec3 sea = mix(vec3(.043), vec3(.02), 1. - lit);
    vec3 lnd = mix(vec3(.36, .03, .07), red, lit);
    col = mix(sea, lnd, step(.5, land));
    float sh = step(.55, texture(CLOUD, vec2(uv.x + drift + .006, uv.y + .006)).r * CLOUDS);
    col = mix(col, col * .45, sh * lit);
    float cc = step(.55, cloud);
    col = mix(col, mix(crm * .55, crm, lit), cc);
    col = mix(col, crm, step(.5, coast) * .9 * (1. - cc));
    col = mix(col, crm, grat * .35 * (1. - land));
    col = mix(col, crm, smoothstep(.985, .995, rho));
  }
  o = vec4(col, a);
}`;

export class Globe {
  constructor(G, { cx = 540, cy = 960, r = 460 } = {}) {
    this.G = G.world; this.cx = cx; this.cy = cy; this.r = r;
    this.proj = geoOrthographic().clipAngle(90).precision(0.4);
    this.path = geoPath(this.proj);
    this.grat = geoGraticule().step([10, 10])();
    this.dots = this.G.dots.map(d => ({ ll: d, v: v3(d), h: hash(Math.round(d[0] * 100), Math.round(d[1] * 100)) }));
    this.lights = this.G.cities.map(c => ({ v: v3(c), pop: c[2] }));
    this.bases = this.G.bases.map(([name, lon, lat]) => ({ name, ll: [lon, lat], v: v3([lon, lat]) }));
    this.bases.flag = FLAGS.bases; this.flag = FLAGS.bases;
    this.home = { name: this.G.home[0], ll: [this.G.home[1], this.G.home[2]] };
    this.cache = null; this.stats = { hit: 0, miss: 0 };
  }
  _rotV(v) { const R = this._R; return [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]]; }
  _setRot(rot) {                                       // 3x3 matrix from d3's own rotation applied to the basis
    const f = geoRotation(rot), ex = v3(f([90, 0])), ey = v3(f([0, 90])), ez = v3(f([0, 0]));
    this._R = [ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]];
  }
  // screen position of a lon/lat (alt: 1 = surface); returns [x, y, visible, z]
  at(ll, rot, scale = 1, alt = 1) {
    if (rot) this._setRot(rot);
    const p = this._rotV(v3(ll)), r = this.r * scale * alt;
    const vis = p[2] > 0 || (p[0] * p[0] + p[1] * p[1]) * alt * alt > 1;
    return [this.cx + p[0] * r, this.cy - p[1] * r, vis, p[2]];
  }
  static face(lon, lat, tilt = 0) { return [-lon, -lat, tilt]; }

  // ---------------------------------------------------------------- shader globe
  _bake() {
    if (this.gl) return;
    const t0 = performance.now();
    const gl = this.gl = new GL(1080, 1920), EW = 4096, EH = 2048;
    const eq = geoEquirectangular().scale(EW / (2 * Math.PI)).translate([EW / 2, EH / 2]).precision(0.2);
    const c = document.createElement('canvas'); c.width = EW; c.height = EH; const g = c.getContext('2d'), p = geoPath(eq, g);
    g.fillStyle = '#000'; g.fillRect(0, 0, EW, EH);
    g.fillStyle = '#f00'; g.beginPath(); p(this.G.land); g.fill();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = '#0f0'; g.lineWidth = 2.2; g.beginPath(); p(this.G.land); g.stroke();
    g.strokeStyle = '#00f'; g.lineWidth = 1.6; g.beginPath(); p(this.G.borders); g.stroke();
    this.tLAND = gl.upload(gl.tex({ filter: 'mip', wrap: 'repeat' }), c);
    const lc = document.createElement('canvas'); lc.width = EW; lc.height = EH; const lg = lc.getContext('2d');
    lg.fillStyle = '#000'; lg.fillRect(0, 0, EW, EH); lg.globalCompositeOperation = 'lighter';
    for (const [lon, lat, pop] of this.G.cities) {
      const [x, y] = eq([lon, lat]), k = Math.sqrt(pop / 1.5e5), rr = 1.5 + 1.6 * k, sx = 1 / Math.max(0.2, Math.cos(lat * Math.PI / 180));
      const gr = lg.createRadialGradient(0, 0, 0, 0, 0, rr); gr.addColorStop(0, `rgba(255,0,0,${Math.min(1, 0.35 + 0.15 * k)})`); gr.addColorStop(1, 'rgba(255,0,0,0)');
      lg.save(); lg.translate(x, y); lg.scale(sx, 1); lg.fillStyle = gr; lg.fillRect(-rr, -rr, 2 * rr, 2 * rr); lg.restore();
    }
    this.tLITE = gl.upload(gl.tex({ filter: 'mip', wrap: 'repeat' }), lc);
    // clouds + terrain noise: one GL pass on the sphere (seamless), copied into a texture
    gl.resize(2048, 1024); gl.draw('bake', FS_BAKE, {}, {}, { w: 2048, h: 1024 });
    const cc = document.createElement('canvas'); cc.width = 2048; cc.height = 1024; cc.getContext('2d').drawImage(gl.canvas, 0, 0);
    this.tCLOUD = gl.upload(gl.tex({ filter: 'mip', wrap: 'repeat' }), cc);
    this.bakeMs = performance.now() - t0;
  }
  _drawShader(ctx, { rot, t, S, scale, lights, clouds, atmo, grid, sun, res }) {
    this._bake();
    const r = this.r * scale, cw = ctx.canvas.width, ch = ctx.canvas.height, pad = S.mode === 1 ? 1.03 : 1.3;
    const x0 = Math.max(0, Math.floor(this.cx - r * pad)), y0 = Math.max(0, Math.floor(this.cy - r * pad));
    const x1 = Math.min(cw, Math.ceil(this.cx + r * pad)), y1 = Math.min(ch, Math.ceil(this.cy + r * pad));
    if (x1 <= x0 || y1 <= y0) return;
    const gw = Math.round((x1 - x0) * res), gh = Math.round((y1 - y0) * res), gl = this.gl;
    gl.resize(Math.max(gl.canvas.width, gw), Math.max(gl.canvas.height, gh));   // grow only: no reallocation between sizes
    this._setRot(rot); const R = this._R;
    gl.draw('globe', FS_GLOBE, {
      RES: [x1 - x0, y1 - y0], OFF: [x0, y0], CEN: [this.cx, this.cy], R: r, T: t, MODE: S.mode,
      LIGHTS: lights ?? S.lights, CLOUDS: clouds ?? S.clouds, ATMO: atmo ?? S.atmo, GRID: grid, SUN: sun || S.sun,
      ROT: [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]],
    }, { LAND: this.tLAND, LITE: this.tLITE, CLOUD: this.tCLOUD }, { w: gw, h: gh });
    ctx.drawImage(gl.canvas, 0, 0, gw, gh, x0, y0, x1 - x0, y1 - y0);
  }

  // style: 'photo' | 'night' | 'poster' (shader) | 'solid' | 'wire' | 'dots' (2D)
  draw(ctx, { rot = [96, -30, 0], t = 0, style = 'photo', land = C.red, landHi = '#e0362f', ocean = ['#1c0507', '#060102'],
    coast = C.cream, grid = 0.35, borders = 0.6, lights = null, atmo = null, clouds = null, sun = null, shade = 1, reveal = 1, dotColor = C.cream,
    rivers = 0, scale = 1, texture = 0, res = 0.75 } = {}) {
    if (GLOBE_STYLES[style] || typeof style === 'object') {
      const S = typeof style === 'object' ? style : GLOBE_STYLES[style];
      return this._drawShader(ctx, { rot, t, S, scale, lights, clouds, atmo, grid, sun, res });
    }
    lights = lights ?? 0.8; atmo = atmo ?? 1;
    const { cx, cy } = this, r = this.r * scale;
    this._setRot(rot);
    if (atmo) {
      const g = ctx.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 1.32);
      g.addColorStop(0, `rgba(255,70,60,${0.55 * atmo})`); g.addColorStop(0.25, `rgba(201,31,55,${0.28 * atmo})`); g.addColorStop(1, 'rgba(120,0,10,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - r * 1.4, cy - r * 1.4, r * 2.8, r * 2.8);
    }
    if (style === 'dots') {                             // animated reveal: not cached (13k rects, ~60 ms)
      const og = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
      og.addColorStop(0, ocean[0]); og.addColorStop(1, ocean[1]); ctx.fillStyle = og; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
      if (grid) { this.proj.translate([cx, cy]).scale(r).rotate(rot); ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
        ctx.strokeStyle = `rgba(244,230,208,${0.16 * grid})`; ctx.lineWidth = 1; ctx.beginPath(); this.path.context(ctx)(this.grat); ctx.stroke(); ctx.restore(); }
      this._dots(ctx, r, t, reveal, dotColor);
    } else {
      // static layer cached on quantized rotation + scale + look
      const q = v => Math.round(v * 5) / 5;
      const key = [style, q(rot[0]), q(rot[1]), q(rot[2] || 0), Math.round(scale * 500), grid, borders, rivers, texture, shade, lights, land, coast].join('|');
      const pad = 4, side = Math.ceil(2 * r + 2 * pad);
      if (!this.cache || this.cache.key !== key) {
        this.stats.miss++;
        const cv = this.cache?.cv && this.cache.cv.width === side ? this.cache.cv : Object.assign(document.createElement('canvas'), { width: side, height: side });
        const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, side, side);
        const ox = cx - r - pad, oy = cy - r - pad; g.translate(-ox, -oy);
        this._static(g, { rot, t, style, land, landHi, ocean, coast, grid, borders, lights, shade, rivers, r, texture });
        this.cache = { key, cv, ox, oy };
      } else this.stats.hit++;
      ctx.drawImage(this.cache.cv, this.cache.ox, this.cache.oy);
    }
    ctx.strokeStyle = 'rgba(255,210,190,0.55)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  }
  _static(ctx, { rot, t, style, land, landHi, ocean, coast, grid, borders, lights, shade, rivers, r, texture }) {
    const { cx, cy } = this;
    this.proj.translate([cx, cy]).scale(r).rotate(rot);
    const path = this.path.context(ctx);
    const og = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
    og.addColorStop(0, ocean[0]); og.addColorStop(1, ocean[1]);
    ctx.fillStyle = og; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
    if (grid) { ctx.strokeStyle = `rgba(244,230,208,${0.16 * grid})`; ctx.lineWidth = 1; ctx.beginPath(); path(this.grat); ctx.stroke(); }
    if (style === 'solid') {
      const lg = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.1, cx, cy, r * 1.05);
      lg.addColorStop(0, landHi); lg.addColorStop(1, land);
      ctx.fillStyle = lg; ctx.beginPath(); path(this.G.land); ctx.fill();
    }
    if (borders) { ctx.strokeStyle = style === 'solid' ? `rgba(20,2,4,${0.7 * borders})` : `rgba(244,230,208,${0.35 * borders})`; ctx.lineWidth = 1; ctx.beginPath(); path(this.G.borders); ctx.stroke(); }
    if (rivers && this.G.rivers) { ctx.strokeStyle = `rgba(244,230,208,${0.35 * rivers})`; ctx.lineWidth = 1; ctx.beginPath(); path(this.G.rivers); ctx.stroke(); }
    ctx.strokeStyle = coast; ctx.lineWidth = style === 'wire' ? 1.6 : 1.2; ctx.globalAlpha = style === 'wire' ? 0.95 : 0.8;
    ctx.beginPath(); path(this.G.land); ctx.stroke(); ctx.globalAlpha = 1;
    if (style === 'solid' && texture) this._dots(ctx, r, t, 1, '#1a0204', texture);
    if (shade) {
      const sg = ctx.createRadialGradient(cx - r * 0.42, cy - r * 0.5, r * 0.15, cx, cy, r * 1.02);
      sg.addColorStop(0, 'rgba(255,240,220,0.10)'); sg.addColorStop(0.55, 'rgba(0,0,0,0)'); sg.addColorStop(0.85, `rgba(0,0,0,${0.45 * shade})`); sg.addColorStop(1, `rgba(0,0,0,${0.8 * shade})`);
      ctx.fillStyle = sg; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    }
    if (lights) {
      ctx.globalCompositeOperation = 'lighter';
      for (const c of this.lights) {
        const p = this._rotV(c.v); if (p[2] <= 0.05) continue;
        const night = clamp((p[0] * 0.8 - p[1] * 0.3 + 0.1) * 2.2); if (night <= 0) continue;
        const s = 0.7 + Math.log10(c.pop / 1.5e5) * 1.6;
        ctx.fillStyle = `rgba(255,214,160,${lights * night * clamp(p[2] * 3)})`;
        ctx.fillRect(cx + p[0] * r - s / 2, cy - p[1] * r - s / 2, s, s);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
  _dots(ctx, r, t, reveal, color, alpha = 1) {
    const { cx, cy } = this;
    ctx.fillStyle = color;
    for (const d of this.dots) {
      if (d.h > reveal) continue;
      const p = this._rotV(d.v); if (p[2] <= 0) continue;
      const s = 1.2 + 2.4 * p[2];
      ctx.globalAlpha = (0.35 + 0.65 * p[2]) * alpha;
      ctx.fillRect(cx + p[0] * r - s / 2, cy - p[1] * r - s / 2, s, s * 0.9);
    }
    ctx.globalAlpha = 1;
  }
  // bases: age (s) since the first base pinged; stagger per base. Returns visible screen points.
  drawBases(ctx, { rot, t = 0, age = 99, stagger = 0.08, color = C.cream, hot = C.red2, labels = 0, which = null, scale = 1, size = 1 } = {}) {
    this._setRot(rot);
    const r = this.r * scale, out = [];
    ctx.save();
    this.bases.forEach((b, i) => {
      if (which && !which.includes(i)) return;
      const a = age - i * stagger; if (a <= 0) return;
      const p = this._rotV(b.v); if (p[2] <= 0.02) return;
      const x = this.cx + p[0] * r, y = this.cy - p[1] * r, f = clamp(p[2] * 4);
      const pr = (t * 1.1 + hash(i)) % 1;
      ctx.globalAlpha = f * (1 - pr) * 0.9; ctx.strokeStyle = hot; ctx.lineWidth = 2.5 * size;
      ctx.beginPath(); ctx.ellipse(x, y, (8 + pr * 40) * size, (8 + pr * 40) * size * (0.3 + 0.7 * p[2]), Math.atan2(p[1], p[0]) + Math.PI / 2, 0, TAU); ctx.stroke();
      const pop = ease.outBack(clamp(a / 0.3));
      ctx.globalAlpha = f; ctx.fillStyle = hot; ctx.beginPath(); ctx.arc(x, y, 8 * pop * size, 0, TAU); ctx.fill();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 3.5 * pop * size, 0, TAU); ctx.fill();
      if (labels && a > 0.2) line(ctx, b.name, x + 14, y - 12, { family: 'Plex Mono', size: Math.max(34, 34 * labels), align: 'left', color, alpha: f * clamp((a - 0.2) * 4), maxW: 400 });
      out.push({ i, x, y, z: p[2], name: b.name });
    });
    ctx.restore();
    return out;
  }
  // great-circle arcs lifted off the surface. arcs: [{ from:[lon,lat], to:[lon,lat], u (0..1 head), tail (0..1), h, alpha }]
  drawArcs(ctx, arcs, { rot, color = '#fff2df', glow = C.red2, width = 2.4, scale = 1 } = {}) {
    this._setRot(rot);
    const r = this.r * scale, { cx, cy } = this;
    ctx.save(); ctx.lineCap = 'round'; ctx.globalCompositeOperation = 'lighter';
    for (const A of arcs) {
      const ip = geoInterpolate(A.from, A.to), d = geoDistance(A.from, A.to), h = A.h ?? 0.08 + d * 0.12, N = 48;
      const u1 = clamp(A.u ?? 1), u0 = clamp(u1 - (A.tail ?? 1));
      if (u1 <= u0) continue;
      const pts = [];
      for (let k = 0; k <= N; k++) {
        const s = lerp(u0, u1, k / N), p = this._rotV(v3(ip(s))), alt = 1 + h * Math.sin(Math.PI * s);
        const vis = p[2] > 0 || (p[0] * p[0] + p[1] * p[1]) * alt * alt > 1;
        pts.push([cx + p[0] * r * alt, cy - p[1] * r * alt, vis, k / N]);
      }
      for (let pass = 0; pass < 3; pass++) {
        const lw = [width * 6, width * 2.2, width][pass], col = pass < 2 ? glow : color, al = [0.14, 0.4, 1][pass];
        ctx.strokeStyle = col; ctx.lineWidth = lw;
        for (let c = 0; c < 4; c++) {
          ctx.globalAlpha = al * (A.alpha ?? 1) * (0.25 + 0.75 * (c + 1) / 4);
          ctx.beginPath(); let on = false;
          for (let k = Math.floor(c * N / 4); k <= Math.ceil((c + 1) * N / 4); k++) {
            const q = pts[k]; if (!q[2]) { on = false; continue; }
            if (!on) { ctx.moveTo(q[0], q[1]); on = true; } else ctx.lineTo(q[0], q[1]);
          }
          ctx.stroke();
        }
      }
      const hd = pts[N]; if (hd[2] && u1 < 1) {
        ctx.globalAlpha = 0.5; ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(hd[0], hd[1], 12, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hd[0], hd[1], 4, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }
}
