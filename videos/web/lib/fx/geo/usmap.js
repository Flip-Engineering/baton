// geo/usmap: the US county map as a lit relief, rendered on the GPU from baked map-space layers.
//
// Static layers are baked ONCE (constructor/first draw) into map-space textures, so a frame costs one
// full-screen fragment pass plus a 16 KB per-county data upload, whatever the camera does:
//   ID     county index per texel (nearest), 3x map scale, anti-alias fringe cleaned on the CPU
//   NRM    heightfield (blurred county weight + town mounds) baked to normal.xy, height, town glow (1.5x, one GL pass)
//   LINES  county / state / nation meshes (3x, mipmapped)     AUX  rivers, town light cores, land mask (3x, mipmapped)
//   PLATE  engraved relief (print.js, style 'engraving')
// so the per-pixel pass is 6 texture fetches (ID, DATA, NRM, LINES, AUX, RAMP).
// Per frame the CPU only computes each county's ignition (lit, front heat) -> a 64x64 data texture.
//
//   const us = new USMap(geo);
//   const { lit } = us.draw(ctx, { cam, t, style: 'ember' | 'poster' | 'night' | 'engraving' | 'thermal' | 'steel' | 'mono',
//                                  ignite: { origin, r, width }, relief: 1, light: [-0.7, -0.5] });
//   us.towns(ctx, { cam, ignite, minPop }); us.ring(ctx, { cam, ignite, km }); us.toScreen(us.project(ll), cam)
import { geoAlbers, geoAlbersUsa, geoPath, geoGraticule } from 'd3-geo';
import { clamp, lerp, ease, line } from '../../kit.js';
import { hash, camApply, camToScreen, rampCanvas, hex01, TAU, FLAGS } from './data.js';
import { GL, GLSL_NOISE } from './gl.js';

// style presets: the whole look, not just the ramp. bg: what the scene should paint behind (ocean shows through).
export const US_STYLES = {
  ember:     { mode: 0, ramp: 'ember', relief: 0.85, towns: 0.5, bg: '#070102', lines: [[0.03, 0.004, 0.008, 0.55], [0.96, 0.9, 0.82, 0.5], [0.96, 0.9, 0.82, 0.9], [0.96, 0.9, 0.82, 0.45]] },
  thermal:   { mode: 0, ramp: 'ironbow', relief: 0.6, towns: 0.4, bg: '#05020f', lines: [[0, 0, 0, 0.5], [1, 0.95, 0.85, 0.45], [1, 0.95, 0.85, 0.85], [1, 1, 1, 0.3]] },
  steel:     { mode: 0, ramp: 'steel', relief: 1, towns: 0.3, bg: '#050607', lines: [[0, 0, 0, 0.5], [0.9, 0.93, 0.95, 0.35], [0.9, 0.93, 0.95, 0.8], [0.8, 0.85, 0.9, 0.4]] },
  mono:      { mode: 0, ramp: 'whitehot', relief: 0.9, towns: 0.3, bg: '#050505', lines: [[0, 0, 0, 0.5], [1, 1, 1, 0.4], [1, 1, 1, 0.9], [1, 1, 1, 0.4]] },
  // flat red / cream / black, stepped tones, hard cast shadows (cream paper sea, black offset shadow of the land)
  poster:    { mode: 1, relief: 1, towns: 0, bg: '#F4E6D0', lines: [[0.043, 0.043, 0.043, 0.9], [0.043, 0.043, 0.043, 1], [0.043, 0.043, 0.043, 1], [0.043, 0.043, 0.043, 0.6]] },
  // photographic night lights: moonlit cool land, sodium town light, faint borders; ignite switches the lights on
  night:     { mode: 2, relief: 0.8, towns: 1, bg: '#030305', lines: [[0.5, 0.55, 0.65, 0.05], [0.55, 0.6, 0.7, 0.16], [0.6, 0.66, 0.78, 0.35], [0.3, 0.4, 0.55, 0.3]] },
  // print.js engraving of the lit relief on cream stock (baked once in map space); ignition inks counties red
  engraving: { mode: 3, relief: 1, towns: 0, bg: '#efe2c6', lines: [[0.09, 0.07, 0.06, 0.5], [0.09, 0.07, 0.06, 0.8], [0.09, 0.07, 0.06, 1], [0.1, 0.1, 0.12, 0.5]] },
};

const FS = `#version 300 es
precision highp float; precision highp sampler2D;
in vec2 v; out vec4 o;
uniform sampler2D ID, DATA, NRM, LINES, AUX, RAMP, PLATE;
uniform vec2 RES, MAP, SCR, CAMXY; uniform float ZOOM, ROT, MODE, RELIEF, TOWNS, T, HASPLATE;
uniform vec3 LDIR; uniform vec4 LC0, LC1, LC2, LC3;
${GLSL_NOISE}
float H(vec2 uv){ return texture(NRM, uv).b; }
void main(){
  vec2 px = vec2(v.x, 1. - v.y) * RES;                           // screen px, y down
  vec2 d = (px - SCR) / ZOOM; float c = cos(-ROT), s = sin(-ROT);
  vec2 m = vec2(d.x * c - d.y * s, d.x * s + d.y * c) + CAMXY;   // map-space px
  vec2 uv = m / MAP;
  if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) {        // outside the bake: sea
    if (MODE == 1.) { o = vec4(.957, .902, .816, 1.); return; }
    o = vec4(0); return; }
  vec4 idc = texture(ID, uv); float id = floor(idc.r * 255. + .5) + floor(idc.g * 255. + .5) * 256.;   // key = index + 1; 0 = sea
  vec4 ln = texture(LINES, uv), ax = texture(AUX, uv);
  float land = ax.b;
  // relief: normal from the heightfield, raking light
  vec4 nr = texture(NRM, uv); float h = nr.b; vec3 n = normalize(vec3(nr.xy * 2. - 1., 1.));
  vec3 L = normalize(LDIR); float lam = max(dot(n, L), 0.), flat0 = L.z;
  float shade = lam / max(flat0, .2);                              // 1 on flat ground
  vec4 D = vec4(0.); if (id > 0.) D = texelFetch(DATA, ivec2(int(mod(id, 64.)), int(id / 64.)), 0);
  float val = D.r, F = D.g, wn = D.b, lit = D.a;
  vec2 li = vec2(ax.g, nr.a);
  vec3 col; float a = land;
  if (MODE == 0.) {                                                // ramp + relief
    col = texture(RAMP, vec2(val, .5)).rgb;
    col *= mix(1., .25 + .9 * shade, RELIEF);
    col += vec3(1., .7, .45) * pow(max(dot(reflect(-L, n), vec3(0, 0, 1)), 0.), 18.) * .35 * RELIEF * lit;
    col += vec3(1., .82, .62) * li.r * TOWNS * (.25 + .75 * lit) + vec3(.8, .12, .1) * li.g * TOWNS * .5 * lit;
    col += vec3(1., .55, .35) * F * .55;
  } else if (MODE == 1.) {                                         // poster: 3 flat tones + hard shadows
    vec3 blk = vec3(.043), red = vec3(.788, .122, .216), crm = vec3(.957, .902, .816), drk = vec3(.35, .03, .06);
    float tone = lit > .5 ? (h > .5 ? 2. : 1.) : (h > .5 ? 1. : 0.);   // big flat shapes from the smoothed relief, not per county
    // hard cast shadow: march toward the light over the heightfield
    float sh = 0.; vec2 st = normalize(L.xy) * 2.2 / MAP;
    for (int i = 1; i <= 10; i++) { float hh = H(uv + st * float(i)); if (hh - h > float(i) * .012 * (1. - L.z)) sh = 1.; }
    sh = max(sh, step(shade, .72));
    col = tone > 1.5 ? crm : tone > .5 ? red : blk;
    if (sh > .5) col = tone > 1.5 ? red : tone > .5 ? drk : vec3(0.);
    col = mix(col, crm, step(.5, F) * .9);
    // sea: cream paper with the land's hard offset shadow
    float lsh = texture(AUX, uv - vec2(16., 22.) / MAP).b;
    vec3 sea = mix(crm, vec3(.07, .02, .03), step(.5, lsh) * .9);
    col = mix(sea, col, step(.5, land)); a = 1.;
  } else if (MODE == 2.) {                                         // night lights, photographic
    vec3 moon = vec3(.05, .06, .085) + vec3(.07, .08, .11) * shade * RELIEF;
    col = moon * (.55 + .45 * h);
    float on = mix(.06, 1., lit);
    col += vec3(1., .66, .3) * pow(li.r, .8) * 1.6 * on + vec3(.95, .32, .08) * li.g * .7 * on;
    col += vec3(1., .5, .25) * F * .35;
  } else {                                                         // engraving plate + red ink where lit
    col = HASPLATE > .5 ? texture(PLATE, uv).rgb : vec3(.93, .88, .78) * (.5 + .5 * shade);
    vec3 ink = vec3(.79, .12, .2);
    float ik = lit * (.55 + .45 * wn);
    col = mix(col, col * mix(vec3(1.), ink * 1.25, .85), ik);
    col = mix(col, ink, F * .6);
    a = 1.;
  }
  // meshes: county, state, nation, rivers
  col = mix(col, LC3.rgb, ax.r * LC3.a * land);
  col = mix(col, LC0.rgb, ln.r * LC0.a * land);
  col = mix(col, LC1.rgb, ln.g * LC1.a);
  col = mix(col, LC2.rgb, ln.b * LC2.a);
  a = max(a, max(ln.b * LC2.a, ln.g * LC1.a));
  o = vec4(col, a);
}`;

// grey relief for the engraving plate: lit relief, dark meshes, pale hatched sea
const FS_PLATE = `#version 300 es
precision highp float; in vec2 v; out vec4 o;
uniform sampler2D NRM, LINES, AUX; uniform vec2 MAP; uniform vec3 LDIR;
void main(){ vec2 uv = vec2(v.x, 1. - v.y); vec4 nr = texture(NRM, uv); float h = nr.b; vec3 n = normalize(vec3(nr.xy * 2. - 1., 1.));
  vec3 L = normalize(LDIR); float sh = max(dot(n, L), 0.) / max(L.z, .2);
  vec4 ln = texture(LINES, uv), ax = texture(AUX, uv);
  float g = mix(.86, clamp(.2 + .62 * sh - .25 * h, 0., 1.), ax.b);
  g = mix(g, .05, max(ln.b, ln.g * .8)); g = mix(g, .35, ln.r * .5); g = mix(g, .25, ax.r * .6);
  o = vec4(vec3(g), 1.); }`;

const FS_NRM = `#version 300 es
precision highp float; in vec2 v; out vec4 o; uniform sampler2D HGT, LITE; uniform vec2 MAP;
float H(vec2 uv){ return texture(HGT, uv).r; }
void main(){ vec2 uv = v, e = 1.2 / MAP;                  // bottom-up rows: copyTo() keeps uv.y = texture t
  vec2 g = vec2(H(uv - vec2(e.x, 0.)) - H(uv + vec2(e.x, 0.)), H(uv - vec2(0., e.y)) - H(uv + vec2(0., e.y))) * 20.;
  vec3 n = normalize(vec3(g, 1.)); o = vec4(n.xy * .5 + .5, H(uv), texture(LITE, uv).g); }`;

export class USMap {
  constructor(G, { fit = [[40, 40], [1040, 700]], bake = 3 } = {}) {
    const u = G.us; this.G = u; this.flag = FLAGS.countyWeight;
    this.proj = geoAlbersUsa().fitExtent(fit, u.nation);
    const path = geoPath(this.proj); this.path = path;
    const maxW = Math.max(...Object.values(u.weight));
    this.c = u.counties.map(f => {
      const d = path(f); if (!d) return null;
      const b = path.bounds(f), ce = this.proj(u.cent[f.id]) || path.centroid(f);
      const w = u.weight[f.id] || 0;
      return { id: f.id, f, p: new Path2D(d), x: ce[0], y: ce[1], b, w, wn: w > 0 ? clamp(Math.log10(w) / Math.log10(maxW)) : 0, r: hash(+f.id) };
    }).filter(Boolean);
    this.countyMesh = new Path2D(path(u.countyMesh));
    this.stateMesh = new Path2D(path(u.stateMesh));
    this.nation = new Path2D(path(u.nation));
    this.rivers = u.rivers ? new Path2D(path(u.rivers) || '') : null;
    this.grat = new Path2D(geoPath(geoAlbers().scale(this.proj.scale()).translate(this.proj.translate()))(geoGraticule().extent([[-150, 12], [-40, 72]]).step([5, 5])()) || '');
    this.cities = u.cities.map(([lon, lat, pop, name, st]) => { const p = this.proj([lon, lat]); return p && { x: p[0], y: p[1], pop, name, st, lon, lat }; })
      .filter(Boolean).sort((a, b) => b.pop - a.pop);
    this.pop = this.cities.reduce((s, c) => s + c.pop, 0);
    this.MAP = [1080, 760]; this.S = bake; this.view = [1080, 1920];
    this.data = new Uint8Array(64 * 64 * 4);
  }
  project(lonlat) { return this.proj(lonlat); }
  toScreen(p, cam) { return camToScreen(p, cam, this.view[0], this.view[1]); }

  // ---------------------------------------------------------------- bake (once)
  _canvas(s) { const c = document.createElement('canvas'); c.width = Math.round(this.MAP[0] * s); c.height = Math.round(this.MAP[1] * s); const g = c.getContext('2d', { willReadFrequently: true }); g.scale(s, s); return [c, g]; }
  _bake() {
    if (this.gl) return;
    const t0 = performance.now(), S = this.S;
    const gl = this.gl = new GL(1080, 1920);
    // ID: index+1 in r,g and a checksum in b; AA fringe pixels fail the checksum and take a valid neighbour
    const [ic, ig] = this._canvas(S);
    ig.fillStyle = '#000'; ig.fillRect(0, 0, this.MAP[0], this.MAP[1]);
    const chk = i => (i * 97 + 31) & 255;
    this.c.forEach((c, i) => { const k = i + 1; ig.fillStyle = `rgb(${k & 255},${k >> 8},${chk(k)})`; ig.fill(c.p); });
    const im = ig.getImageData(0, 0, ic.width, ic.height), D = im.data, w = ic.width, h = ic.height;
    const ok = new Uint8Array(w * h);
    for (let i = 0, p = 0; p < w * h; p++, i += 4) { const k = D[i] + D[i + 1] * 256; ok[p] = (k === 0 && D[i + 2] === 0) || (k > 0 && k <= this.c.length && D[i + 2] === chk(k)) ? 1 : 0; }
    for (let pass = 0; pass < 3; pass++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x; if (ok[p]) continue;
      for (const q of [p - 1, p + 1, p - w, p + w]) if (q >= 0 && q < w * h && ok[q] === 1) { D[p * 4] = D[q * 4]; D[p * 4 + 1] = D[q * 4 + 1]; D[p * 4 + 2] = D[q * 4 + 2]; ok[p] = 2; break; }
    }
    for (let p = 0; p < w * h; p++) { if (!ok[p]) { D[p * 4] = D[p * 4 + 1] = 0; } D[p * 4 + 3] = 255; }
    this.tID = gl.upload(gl.tex({ filter: 'nearest' }), { data: new Uint8Array(D.buffer), w, h });
    // heightfield: county weight, blurred, plus town mounds
    const [hc, hg] = this._canvas(1.5);
    hg.fillStyle = '#000'; hg.fillRect(0, 0, this.MAP[0], this.MAP[1]);
    for (const c of this.c) { const g = Math.round(40 + 150 * Math.pow(c.wn, 1.8)); hg.fillStyle = `rgb(${g},${g},${g})`; hg.fill(c.p); }
    const [hb, hbg] = this._canvas(1.5); hbg.setTransform(1, 0, 0, 1, 0, 0);
    hbg.filter = 'blur(15px)'; hbg.drawImage(hc, 0, 0); hbg.filter = 'none';
    hbg.globalCompositeOperation = 'lighter'; hbg.setTransform(1.5, 0, 0, 1.5, 0, 0);
    for (const c of this.cities) { if (c.pop < 20000) continue; const r = 5 + Math.sqrt(c.pop) * 0.018, a = Math.min(0.42, Math.sqrt(c.pop) / 2200);
      const g = hbg.createRadialGradient(c.x, c.y, 0, c.x, c.y, r); g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      hbg.fillStyle = g; hbg.fillRect(c.x - r, c.y - r, 2 * r, 2 * r); }
    const [hf, hfg] = this._canvas(1.5); hfg.setTransform(1, 0, 0, 1, 0, 0); hfg.filter = 'blur(3px)'; hfg.drawImage(hb, 0, 0);
    const tHGT = gl.upload(gl.tex(), hf);
    // meshes: r county, g state, b nation outline
    const [lc, lg] = this._canvas(S); lg.fillStyle = '#000'; lg.fillRect(0, 0, this.MAP[0], this.MAP[1]); lg.lineJoin = 'round';
    lg.globalCompositeOperation = 'lighter';
    lg.strokeStyle = '#f00'; lg.lineWidth = 0.45; lg.stroke(this.countyMesh);
    lg.strokeStyle = '#0f0'; lg.lineWidth = 1.0; lg.stroke(this.stateMesh);
    lg.strokeStyle = '#00f'; lg.lineWidth = 1.5; lg.stroke(this.nation);
    this.tLINES = gl.upload(gl.tex({ filter: 'mip' }), lc);
    // aux: r rivers, b land mask
    const [ac, ag] = this._canvas(S); ag.fillStyle = '#000'; ag.fillRect(0, 0, this.MAP[0], this.MAP[1]);
    ag.fillStyle = '#00f'; ag.fill(this.nation); ag.globalCompositeOperation = 'lighter';
    if (this.rivers) { ag.strokeStyle = '#f00'; ag.lineWidth = 0.7; ag.stroke(this.rivers); }
    for (const c of this.cities) {                              // town light cores (g)
      const k = Math.sqrt(c.pop / 5000), rc = 0.35 + 0.28 * k, g = ag.createRadialGradient(c.x, c.y, 0, c.x, c.y, rc);
      g.addColorStop(0, `rgba(0,${Math.min(255, 150 + 30 * k)},0,1)`); g.addColorStop(1, 'rgba(0,0,0,0)'); ag.fillStyle = g; ag.fillRect(c.x - rc, c.y - rc, 2 * rc, 2 * rc);
    }
    this.tAUX = gl.upload(gl.tex({ filter: 'mip' }), ac);
    // town light glow (g), folded into NRM.a
    const [tc, tg] = this._canvas(1.5); tg.fillStyle = '#000'; tg.fillRect(0, 0, this.MAP[0], this.MAP[1]); tg.globalCompositeOperation = 'lighter';
    for (const c of this.cities) {
      const k = Math.sqrt(c.pop / 5000), rg = 1.6 + 1.1 * k;
      const g = tg.createRadialGradient(c.x, c.y, 0, c.x, c.y, rg); g.addColorStop(0, `rgba(0,${Math.min(255, 40 + 18 * k)},0,1)`); g.addColorStop(1, 'rgba(0,0,0,0)');
      tg.fillStyle = g; tg.fillRect(c.x - rg, c.y - rg, 2 * rg, 2 * rg);
    }
    const tLITE = gl.upload(gl.tex(), tc);
    const nw = hf.width, nh = hf.height; gl.resize(nw, nh);
    gl.draw('nrm', FS_NRM, { MAP: this.MAP }, { HGT: tHGT, LITE: tLITE }, { w: nw, h: nh });
    this.tNRM = gl.copyTo(gl.tex(), nw, nh);
    gl.gl.deleteTexture(tHGT); gl.gl.deleteTexture(tLITE);
    this.tDATA = gl.tex({ filter: 'nearest' });
    this.ramps = {};
    this.bakeMs = performance.now() - t0;
  }
  // engraving plate: grey relief in map space pulled through print.js engrave; baked once per light direction
  // pitchPx: engraving line pitch in plate px (on screen: pitchPx / scale * zoom)
  plate({ Print, light = [-0.7, -0.55, 0.5], scale = 2, pitchPx = 7, paper = 'cream' } = {}) {
    this._bake();
    const key = light.join(','); if (this._plateKey === key) return;
    const gl = this.gl, w = Math.round(this.MAP[0] * scale), h = Math.round(this.MAP[1] * scale);
    gl.resize(w, h);
    gl.draw('plate', FS_PLATE, { MAP: this.MAP, LDIR: light }, { NRM: this.tNRM, LINES: this.tLINES, AUX: this.tAUX }, { w, h });
    const src = document.createElement('canvas'); src.width = w; src.height = h; src.getContext('2d').drawImage(gl.canvas, 0, 0);
    const pr = new Print({ width: w, height: h });
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    pr.render(out.getContext('2d'), src, [['engrave', { pitch: pitchPx / (w / 1080), angle: 0.6, crosshatch: 1, stipple: 0.6, contour: 1, ink: 'black' }]], { paper, t: 0, boil: 0, draw: { w, h } });
    this.tPLATE = gl.upload(gl.tex({ filter: 'mip' }), out);
    this._plateKey = key; pr.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  _ramp(name) { return this.ramps[name] || (this.ramps[name] = this.gl.upload(this.gl.tex(), rampCanvas(name))); }

  // ignition amount (0..1) and front heat for a county at time-radius r (map px)
  _ign(c, ig) {
    if (!ig) return [1, 0];
    const o = ig._o || (ig._o = this.proj(ig.origin) || [540, 400]);
    const d = Math.hypot(c.x - o[0], c.y - o[1]) * (1 + (c.r - 0.5) * (ig.noise ?? 0.35)) - (c.wn * (ig.pull ?? 60));
    const k = (ig.r - d) / (ig.width ?? 40);
    return [clamp(k), Math.exp(-k * k * 2.2) * (k > -0.6 ? 1 : 0)];
  }
  // one frame. res: relief pass scale, upscaled into ctx (default 0.8 = 64% of the pixels; 1 for hero stills). Returns { lit, front }.
  draw(ctx, { cam = { x: 540, y: 380, zoom: 1 }, ignite = null, t = 0, style = 'ember', dim = 1, grid = 0.35, borders = 1, rivers = 0,
    flicker = 1, unlit = 1, relief = null, towns = null, light = [-0.7, -0.55, 0.5], res = 0.8, embers = true, alpha = 1, flush = true } = {}) {
    this._bake();
    const S = typeof style === 'string' ? US_STYLES[style] : style;
    const cw = ctx.canvas.width, ch = ctx.canvas.height; this.view = [cw, ch];
    // per-county data: r = ramp value, g = front heat, b = weight, a = lit
    const fq = Math.floor(t * 15), front = [], D = this.data; let lit = 0;
    this.c.forEach((c, i) => {
      const [L, F] = this._ign(c, ignite); if (L > 0.5) lit++;
      let v = (0.08 + 0.1 * c.wn) * unlit;
      if (L > 0) { const fl = flicker * (hash(+c.id, fq) - 0.5) * 0.08 * (1 - L * 0.5); v = lerp(v, (0.3 + 0.64 * Math.pow(c.wn, 2.2) + fl) * dim, ease.outCubic(L)); }
      v = clamp(v + F * (ignite?.heat ?? 0.42)); if (F > 0.35) front.push(c);
      const k = (i + 1) * 4; D[k] = v * 255; D[k + 1] = F * 255; D[k + 2] = c.wn * 255; D[k + 3] = L * 255;
    });
    // graticule under the map (2D: it runs past the baked area)
    if (grid) { ctx.save(); const z = camApply(ctx, cam); ctx.strokeStyle = S.mode === 1 ? `rgba(11,11,11,${0.3 * grid})` : `rgba(201,31,55,${0.28 * grid})`; ctx.lineWidth = 1 / z; ctx.stroke(this.grat); ctx.restore(); }
    const gl = this.gl, gw = Math.round(cw * res), gh = Math.round(ch * res);
    gl.resize(Math.max(gl.canvas.width, gw), Math.max(gl.canvas.height, gh));   // grow only: no reallocation between sizes
    gl.upload(this.tDATA, { data: D, w: 64, h: 64 });
    const lc = S.lines.map((l, i) => [l[0], l[1], l[2], l[3] * (i === 3 ? rivers : borders)]);
    gl.draw('us', FS, {
      RES: [gw, gh], MAP: this.MAP, SCR: [(cam.sx ?? cw / 2) * res, (cam.sy ?? ch / 2) * res], CAMXY: [cam.x, cam.y], ZOOM: (cam.zoom || 1) * res, ROT: cam.rot || 0,
      MODE: S.mode, RELIEF: relief ?? S.relief, TOWNS: towns ?? S.towns, T: t, HASPLATE: this.tPLATE ? 1 : 0, LDIR: light,
      LC0: lc[0], LC1: lc[1], LC2: lc[2], LC3: lc[3],
    }, { ID: this.tID, DATA: this.tDATA, NRM: this.tNRM, LINES: this.tLINES, AUX: this.tAUX, RAMP: this._ramp(S.ramp || 'ember'), PLATE: this.tPLATE || this.tNRM }, { w: gw, h: gh });
    ctx.save(); ctx.globalAlpha *= alpha; ctx.drawImage(gl.canvas, 0, 0, gw, gh, 0, 0, cw, ch); ctx.restore();
    // flush the 2D canvas here (1-px read): measured 5.3 -> 2.4 s/frame when a 5,852-edge network is stroked on top of
    // the relief in the same flush (SwiftShader); costs ~nothing otherwise. flush: false to skip.
    if (flush) ctx.getImageData(0, 0, 1, 1);
    // the burning edge: hot cores + a few embers thrown outward (2D, only the front counties)
    if (embers && front.length && ignite) {
      ctx.save(); const z = camApply(ctx, cam), o = ignite._o;
      ctx.globalCompositeOperation = S.mode === 1 || S.mode === 3 ? 'source-over' : 'lighter';
      for (const c of front) {
        const [, F] = this._ign(c, ignite), s = (1.5 + 4 * c.wn) / Math.sqrt(z);
        if (S.mode !== 1 && S.mode !== 3) { ctx.fillStyle = `rgba(255,120,80,${0.25 * F})`; ctx.beginPath(); ctx.arc(c.x, c.y, s * 2.6, 0, TAU); ctx.fill(); }
        ctx.fillStyle = S.mode === 3 ? `rgba(201,31,55,${F})` : `rgba(255,240,215,${0.7 * F})`; ctx.beginPath(); ctx.arc(c.x, c.y, s * 0.8, 0, TAU); ctx.fill();
        if (c.r > 0.55) { const ang = Math.atan2(c.y - o[1], c.x - o[0]) + (c.r - 0.75) * 2, fly = (1 - F) * 26 + 6;
          ctx.fillStyle = S.mode === 1 ? `rgba(11,11,11,${F})` : `rgba(255,190,120,${0.8 * F})`; ctx.fillRect(c.x + Math.cos(ang) * fly, c.y + Math.sin(ang) * fly, 2.4 / z, 2.4 / z); }
      }
      ctx.restore();
    }
    return { front, lit };
  }
  // the ignition ring (projected circle) with an optional range label
  ring(ctx, { cam, ignite, label = true, color = '#F4E6D0', hot = '#C91F37', km = null, size = 36 }) {
    const o = this.proj(ignite.origin), z = cam.zoom || 1;
    const [sx, sy] = this.toScreen(o, cam), r = ignite.r * z;
    ctx.save();
    ctx.strokeStyle = color; ctx.globalAlpha = 0.5; ctx.lineWidth = 2; ctx.setLineDash([14, 10]);
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 0.18; ctx.lineWidth = 16; ctx.strokeStyle = hot; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
    if (label) {
      const a = -0.6, lx = sx + Math.cos(a) * r, ly = sy + Math.sin(a) * r;
      if (lx > 0 && lx < ctx.canvas.width - 200 && ly > 0) {
        ctx.fillStyle = color; ctx.fillRect(lx - 6, ly - 6, 12, 12);
        line(ctx, `R ${km != null ? Math.round(km).toLocaleString('en-US') + ' KM' : Math.round(ignite.r)}`, lx + 18, ly - 14, { family: 'Plex Mono', size, align: 'left', color, maxW: 420 });
      }
    }
    ctx.restore();
  }
  // towns as glowing points (largest first); u reveals by rank, minPop filters
  towns(ctx, { cam, u = 1, minPop = 20000, color = '#fff1dc', glow = '#C91F37', max = 4000, size = 1, ignite = null }) {
    ctx.save(); const z = camApply(ctx, cam);
    ctx.globalCompositeOperation = 'lighter';
    const n = Math.min(max, this.cities.length);
    for (let i = 0; i < n; i++) {
      const c = this.cities[i]; if (c.pop < minPop) break;
      if (i / n > u) break;
      let a = 1;
      if (ignite) { const [L] = this._ign(c, ignite); a = L; if (a <= 0) continue; }
      const s = (0.8 + Math.log10(c.pop / minPop + 1) * 2.4) * size / Math.sqrt(z);
      ctx.globalAlpha = 0.25 * a; ctx.fillStyle = glow; ctx.fillRect(c.x - s * 2.2, c.y - s * 2.2, s * 4.4, s * 4.4);
      ctx.globalAlpha = a; ctx.fillStyle = color; ctx.fillRect(c.x - s / 2, c.y - s / 2, s, s);
    }
    ctx.restore();
  }
}
export { FS as US_FS, FS_NRM as US_FS_NRM };   // AMERICA: geo/america.js reuses these shaders unchanged
