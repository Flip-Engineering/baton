// particles/crowd: walking figures from a procedural gait atlas (16 phases x 4 variants x side/front views),
// ground-plane perspective, depth test + alpha cutout, back-light rim, fog, banners. Non-instanced quads fetched by
// gl_VertexID (SwiftShader runs instanced draws at ~20 us per instance).
import { W, H, lerp, rng } from '../../kit.js';
import { pcache, hashStr } from './core.js';
import { samplePixels } from './samplers.js';

// Procedural gait atlas: 16 phases x 4 variants (plain, fist, banner, sign) x 2 views (side, front).
// Channels: R = body mask, G = red cloth (banner/sign/armband), B = rim (edge band), A = union mask.
// Cached (pcache) by its arguments + this function's source: the erosion pass is the slow part of a scene build.
export function walkerAtlas({ cell = 128, phases = 16 } = {}) {
  const key = 'atlas:' + hashStr(walkerAtlasRaw.toString() + cell + ',' + phases);
  const hit = pcache.get(key);
  if (hit) {
    const cv = document.createElement('canvas'); cv.width = hit.w; cv.height = hit.h;
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(hit.data.buffer, hit.data.byteOffset, hit.data.length), hit.w, hit.h), 0, 0);
    return { canvas: cv, cols: hit.cols, rows: hit.rows, cw: hit.cw, ch: hit.ch, phases: hit.phases, data: hit.data };
  }
  const at = walkerAtlasRaw({ cell, phases });
  const px = at.canvas.getContext('2d').getImageData(0, 0, at.canvas.width, at.canvas.height).data, data = new Uint8Array(px.buffer);
  pcache.set(key, { data, w: at.canvas.width, h: at.canvas.height, cols: at.cols, rows: at.rows, cw: at.cw, ch: at.ch, phases: at.phases });
  return { ...at, data };
}
function walkerAtlasRaw({ cell = 128, phases = 16 } = {}) {
  const cols = 16, rows = 8, cw = cell, ch = cell * 2;
  const cv = document.createElement('canvas'); cv.width = cols * cw; cv.height = rows * ch;
  const g = cv.getContext('2d');
  const body = document.createElement('canvas'); body.width = cw; body.height = ch; const bg = body.getContext('2d', { willReadFrequently: true });
  const red = document.createElement('canvas'); red.width = cw; red.height = ch; const rg = red.getContext('2d', { willReadFrequently: true });
  const s = ch / 256;     // design units: figure ~ 230 tall, feet at y=250
  const limb = (c, pts, w) => { c.lineWidth = w * s; c.beginPath(); c.moveTo(pts[0][0] * s, pts[0][1] * s); for (const p of pts.slice(1)) c.lineTo(p[0] * s, p[1] * s); c.stroke(); };
  const R = rng(77);
  for (let view = 0; view < 2; view++) for (let v = 0; v < 4; v++) for (let ph = 0; ph < phases; ph++) {
    const a = ph / phases * Math.PI * 2;
    for (const c of [bg, rg]) { c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cw, ch); c.lineCap = 'round'; c.lineJoin = 'round'; c.fillStyle = c.strokeStyle = '#fff'; }
    const cx = 64, bob = -Math.abs(Math.cos(a)) * 4 + 2, hipY = 142 + bob, shY = 72 + bob, headY = 46 + bob;
    if (view === 0) {            // side view, walking right
      const leg = (ph2, far) => { const sw = Math.sin(ph2), lift = Math.max(0, Math.cos(ph2)) ;
        const hip = [cx + (far ? -3 : 3), hipY], knee = [cx + sw * 22 + 6, hipY + 52 - lift * 6], foot = [cx + sw * 38 - lift * 4 + 2, 246 - lift * 16];
        limb(bg, [hip, knee, foot], 17); limb(bg, [foot, [foot[0] + 14, foot[1] + 2]], 8); };
      leg(a + Math.PI, 1); leg(a, 0);
      // torso: coat
      bg.beginPath(); bg.moveTo((cx - 17) * s, (shY + 2) * s); bg.quadraticCurveTo((cx - 4) * s, (shY - 10) * s, (cx + 16) * s, (shY + 2) * s);
      bg.lineTo((cx + 20) * s, (hipY + 18) * s); bg.lineTo((cx - 19) * s, (hipY + 20) * s); bg.closePath(); bg.fill();
      // head + neck + cap
      bg.beginPath(); bg.ellipse((cx + 5) * s, headY * s, 13 * s, 15 * s, 0.2, 0, 7); bg.fill();
      limb(bg, [[cx + 1, headY + 8], [cx + 1, shY]], 12);
      if (R() < 2) { bg.beginPath(); bg.ellipse((cx + 3) * s, (headY - 10) * s, 16 * s, 6 * s, -0.1, 0, 7); bg.fill(); }
      const sw = Math.sin(a);
      if (v === 1) {      // raised fist
        limb(bg, [[cx + 4, shY + 6], [cx + 14, shY - 26], [cx + 18, shY - 62]], 12); bg.beginPath(); bg.arc((cx + 18) * s, (shY - 66) * s, 8 * s, 0, 7); bg.fill();
        limb(bg, [[cx, shY + 6], [cx - sw * 18, shY + 44], [cx - sw * 26, shY + 78]], 11);
      } else if (v === 2) {  // banner pole over shoulder, red flag streaming back
        limb(bg, [[cx + 2, shY + 8], [cx + 16, shY + 34], [cx + 22, shY + 20]], 11);
        limb(bg, [[cx + 26, shY + 40], [cx - 18, shY - 150]], 5);
        rg.beginPath(); const fx = cx - 18, fy = shY - 150;
        rg.moveTo(fx * s, fy * s); for (let i = 0; i <= 10; i++) rg.lineTo((fx - i * 7) * s, (fy + Math.sin(a * 2 - i * 0.8) * 5 + i * 1.2) * s);
        for (let i = 10; i >= 0; i--) rg.lineTo((fx - i * 7 + 3) * s, (fy + 44 + Math.sin(a * 2 - i * 0.8) * 5 + i * 1.2) * s); rg.fill();
        limb(bg, [[cx, shY + 6], [cx - sw * 16, shY + 44], [cx - sw * 22, shY + 76]], 11);
      } else if (v === 3) {  // placard held high
        limb(bg, [[cx + 2, shY + 6], [cx + 10, shY - 24], [cx + 8, shY - 52]], 11);
        limb(bg, [[cx + 8, shY - 40], [cx + 8, shY - 70]], 5);
        rg.fillRect((cx - 20) * s, (shY - 120) * s, 56 * s, 52 * s);
        limb(bg, [[cx, shY + 6], [cx - sw * 16, shY + 44], [cx - sw * 22, shY + 76]], 11);
      } else {
        limb(bg, [[cx + 2, shY + 6], [cx + sw * 20 + 2, shY + 42], [cx + sw * 30 + 8, shY + 72]], 11);
        limb(bg, [[cx - 2, shY + 6], [cx - sw * 20, shY + 42], [cx - sw * 28, shY + 74]], 11);
      }
    } else {                     // front view, walking toward camera
      const sw = Math.sin(a);
      for (const side of [-1, 1]) {
        const lift = Math.max(0, sw * side);
        limb(bg, [[cx + side * 10, hipY], [cx + side * 12, hipY + 52 - lift * 10], [cx + side * 12, 246 - lift * 18]], 18);
        bg.beginPath(); bg.ellipse((cx + side * 13) * s, (248 - lift * 18) * s, 10 * s, 5 * s, 0, 0, 7); bg.fill();
      }
      bg.beginPath(); bg.moveTo((cx - 26) * s, (shY + 2) * s); bg.quadraticCurveTo(cx * s, (shY - 10) * s, (cx + 26) * s, (shY + 2) * s);
      bg.lineTo((cx + 22) * s, (hipY + 20) * s); bg.lineTo((cx - 22) * s, (hipY + 20) * s); bg.closePath(); bg.fill();
      bg.beginPath(); bg.ellipse(cx * s, headY * s, 13 * s, 16 * s, 0, 0, 7); bg.fill();
      limb(bg, [[cx, headY + 8], [cx, shY]], 13);
      bg.beginPath(); bg.ellipse(cx * s, (headY - 10) * s, 16 * s, 6 * s, 0, 0, 7); bg.fill();
      const arm = (side, swing) => limb(bg, [[cx + side * 24, shY + 6], [cx + side * 28, shY + 40 - swing * 4], [cx + side * 27, shY + 70 - swing * 10]], 11);
      if (v === 1) { limb(bg, [[cx + 24, shY + 6], [cx + 38, shY - 26], [cx + 36, shY - 62]], 12); bg.beginPath(); bg.arc((cx + 36) * s, (shY - 67) * s, 8.5 * s, 0, 7); bg.fill(); arm(-1, sw); }
      else if (v === 2) { limb(bg, [[cx + 24, shY + 6], [cx + 30, shY + 30], [cx + 30, shY + 10]], 11); limb(bg, [[cx + 30, shY + 60], [cx + 30, shY - 160]], 5);
        rg.beginPath(); const fx = cx + 30, fy = shY - 160; rg.moveTo(fx * s, fy * s);
        for (let i = 0; i <= 8; i++) rg.lineTo((fx + i * 6 * Math.cos(a * 0.5 + i * 0.3)) * s, (fy + Math.sin(a * 2 - i * 0.9) * 4 + i * 1.5) * s);
        for (let i = 8; i >= 0; i--) rg.lineTo((fx + i * 6 * Math.cos(a * 0.5 + i * 0.3)) * s, (fy + 46 + Math.sin(a * 2 - i * 0.9) * 4 + i * 1.5) * s); rg.fill(); arm(-1, sw); }
      else if (v === 3) { limb(bg, [[cx + 24, shY + 6], [cx + 20, shY - 30], [cx + 10, shY - 56]], 11); limb(bg, [[cx - 24, shY + 6], [cx - 20, shY - 30], [cx - 10, shY - 56]], 11);
        rg.fillRect((cx - 34) * s, (shY - 118) * s, 68 * s, 58 * s); }
      else { arm(-1, sw); arm(1, -sw); }
    }
    // composite into the atlas cell: R body, G red, B rim, A union
    const col = ph, row = view * 4 + v, ox = col * cw, oy = row * ch;
    const bd = bg.getImageData(0, 0, cw, ch).data, rd = rg.getImageData(0, 0, cw, ch).data;
    const out = g.createImageData(cw, ch), od = out.data;
    const A = i => Math.max(bd[i * 4 + 3], rd[i * 4 + 3]);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = y * cw + x, a0 = A(i);
      let mn = a0;           // erosion radius 3 for the rim band
      if (a0 > 0) for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) {
        if (dx * dx + dy * dy > 10) continue; const xx = x + dx, yy = y + dy;
        const q = xx < 0 || yy < 0 || xx >= cw || yy >= ch ? 0 : A(yy * cw + xx); if (q < mn) mn = q;
      }
      od[i * 4] = bd[i * 4 + 3]; od[i * 4 + 1] = rd[i * 4 + 3]; od[i * 4 + 2] = Math.max(0, a0 - mn); od[i * 4 + 3] = a0;
    }
    g.putImageData(out, ox, oy);
  }
  return { canvas: cv, cols, rows, cw, ch, phases };
}

// const crowd = new Crowd(P, { n: 12000, atlas: walkerAtlas(), layout: 'field', ... })
// crowd.draw(t, { horizon, camH, f, fog, ... })
// Layout is closed-form: each walker has a home (x, z), velocity (vx, vz), gait rate and phase; positions wrap inside the
// field, so any t is valid. layout: 'field' (random plain), 'column' (march band), or {points: PointSet} (mass formation:
// point xy -> ground x, depth z via o.mapFormation).
export class Crowd {
  constructor(P, { n = 8000, atlas = null, seed = 9, view = 'side', layout = 'field', xRange = [-3000, 3000], zRange = [300, 9000],
    vel = [110, 0], velVar = 0.3, variants = [0.62, 0.16, 0.12, 0.1], scale = [0.9, 1.15], formation = null, stride = 150 } = {}) {
    this.P = P; this.n = n; this.atlas = atlas || walkerAtlas(); this.xRange = xRange; this.zRange = zRange;
    const gl = P.gl, R = rng(seed), data = new Float32Array(n * 8);
    const cum = []; variants.reduce((a, b, i) => (cum[i] = a + b), 0);
    for (let i = 0; i < n; i++) {
      let x = lerp(xRange[0], xRange[1], R()), z = lerp(zRange[0], zRange[1], Math.sqrt(R()));   // density ~ z: even on screen
      if (layout === 'column') { z = lerp(zRange[0], zRange[1], R()); x = lerp(xRange[0], xRange[1], R()); }
      if (formation) { const j = Math.floor(R() * formation.n); x = formation.pos[j * 4]; z = formation.pos[j * 4 + 1]; }
      const vr = 1 + (R() - 0.5) * 2 * velVar;
      const rv = R(); let variant = cum.findIndex(c => rv <= c); if (variant < 0) variant = 0;
      const vx = vel[0] * vr, vz = vel[1] * vr, rate = Math.max(0.55, Math.hypot(vx, vz) / stride) * (0.93 + 0.14 * R());
      const flip = view === 'side' && vx < 0 ? -1 : 1;
      data.set([x, z, vx, vz, R(), rate, variant + (view === 'front' ? 4 : 0), flip * lerp(scale[0], scale[1], R())], i * 8);
    }
    const idx = [...Array(n).keys()].sort((a, b) => data[b * 8 + 1] - data[a * 8 + 1]);   // far to near (fog blends, cutout needs none)
    const d2 = new Float32Array(n * 8); idx.forEach((j, i) => d2.set(data.subarray(j * 8, j * 8 + 8), i * 8));
    this.data = d2;
    // per-walker data lives in an RGBA32F texture (2 texels each) fetched by gl_VertexID: no attributes, no instancing
    // (SwiftShader runs instanced draws at ~20 us per instance).
    this.dtw = 2048; const rows = Math.ceil(n * 2 / this.dtw), dt = new Float32Array(this.dtw * rows * 4); dt.set(d2);
    this.dtex = P.dataTex(this.dtw, rows, dt, true);
    const at = this.atlas;
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (at.data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, at.canvas.width, at.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, at.data);   // exact bytes (no canvas premultiply round trip)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, at.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.pr = P.program('crowd', `#version 300 es
precision highp float;
uniform highp sampler2D DT; uniform int DTW;
uniform float T, HZ, CAMH, F, FIGH, X0, X1, Z0, Z1, CAMX, CAMZ, PHASES, COLS, ROWS, MARCH, SWAY, MAXS, QTH, SCL; uniform int QUAD;
out float vZ; flat out vec3 vCell; flat out float vLean; out vec2 vQ;
void main(){
  int id= QUAD==1 ? gl_VertexID/6 : gl_VertexID; int k=id*2;
  vec4 A=texelFetch(DT, ivec2(k%DTW, k/DTW), 0), Bv=texelFetch(DT, ivec2((k+1)%DTW, (k+1)/DTW), 0);   // A: x, z, vx, vz   Bv: phase0, gait rate, variant, scale (sign = flip)
  float x=A.x+A.z*T*MARCH, z=A.y+A.w*T*MARCH;
  x=X0+mod(x-X0, X1-X0); z=Z0+mod(z-Z0, Z1-Z0);
  float ez=z-CAMZ; float s=F/max(ez,1.);
  float sx=${W / 2}.+(x-CAMX)*s, sy=HZ+CAMH*s;
  float hgt=FIGH*abs(Bv.w)*s;
  float dz=clamp(ez/40000.,0.,1.)*2.-1.;
  float ph=floor(fract(Bv.x+T*Bv.y*MARCH)*PHASES);
  vCell=vec3(ph, Bv.z, sign(Bv.w)); vZ=ez; vLean=SWAY*sin(T*1.3+A.x*.01)*.06;
  if(QUAD==1){      // big (near) figures: a tight 1:2 quad, half the fragments of a square sprite
    int c=gl_VertexID%6; c= c==3 ? 2 : c==4 ? 1 : c==5 ? 3 : c;
    vec2 q=vec2(float(c&1), float(c>>1)); vQ=vec2(.25+q.x*.5, q.y);
    vec2 pix=vec2(sx+(q.x-.5)*hgt*.5, sy-(1.-q.y)*hgt);
    gl_Position=vec4(pix.x/${W}.*2.-1., 1.-pix.y/${H}.*2., dz, 1.);
    if(ez<30. || hgt<=QTH) gl_Position=vec4(2.,2.,2.,1.);
    return;
  }
  vQ=vec2(-1.);
  gl_Position=vec4(sx/${W}.*2.-1., 1.-(sy-hgt*.5)/${H}.*2., dz, 1.);
  gl_PointSize=clamp(hgt, 1., MAXS)*SCL;
  if(ez<30. || hgt>QTH) gl_Position=vec4(2.,2.,2.,1.);
}`, `#version 300 es
precision highp float;
in float vZ; flat in vec3 vCell; flat in float vLean; in vec2 vQ;
uniform sampler2D AT; uniform vec3 BODY, RIM, RED, FOG; uniform float FOGD, RIMK, ALPHA, COLS, ROWS; uniform vec2 LDIR;
out vec4 o;
void main(){
  vec2 pc= vQ.x<0. ? gl_PointCoord : vQ; float cx=(pc.x-.25)*2.+vLean*(1.-pc.y);
  if(cx<0. || cx>1.) discard;
  if(vCell.z<0.) cx=1.-cx;
  vec2 cuv=(vCell.xy+vec2(cx,pc.y))/vec2(COLS,ROWS);
  vec4 m=texture(AT,cuv); if(m.a<.45) discard;
  // directional back-light rim: lit where the silhouette is empty toward the light (LDIR, in cell px)
  vec2 ld=LDIR*vec2(vCell.z,1.)/vec2(textureSize(AT,0));
  float edge=1.-texture(AT,cuv+ld).a;
  vec3 c=BODY*(1.-m.g)+RED*m.g*(1.+edge);
  c+=RIM*clamp(edge*1.2+m.b*.06,0.,1.5)*RIMK;
  float fog=1.-exp(-vZ/FOGD);
  c=mix(c, FOG, fog);
  o=vec4(c*ALPHA, ALPHA);
}`, {});
  }
  // o: {horizon (px), camH (px*world), f, figH (world units), camX, camZ, march (speed multiplier), body, rim, red, fog [rgb],
  //     fogDist, rimK, alpha, count}
  draw(t, o = {}) {
    const P = this.P, gl = P.gl, u = P.use(this.pr), at = this.atlas;
    P.bind(P.hdr); P.blend('over');
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    P.tex(0, this.tex); gl.uniform1i(u.AT, 0);
    gl.uniform1f(u.T, t); gl.uniform1f(u.HZ, o.horizon ?? H * 0.55); gl.uniform1f(u.CAMH, o.camH ?? 170); gl.uniform1f(u.F, o.f ?? 1400);
    gl.uniform1f(u.FIGH, o.figH ?? 175); gl.uniform1f(u.X0, this.xRange[0]); gl.uniform1f(u.X1, this.xRange[1]);
    gl.uniform1f(u.Z0, this.zRange[0]); gl.uniform1f(u.Z1, this.zRange[1]); gl.uniform1f(u.CAMX, o.camX ?? 0); gl.uniform1f(u.CAMZ, o.camZ ?? 0);
    gl.uniform1f(u.PHASES, at.phases); gl.uniform1f(u.COLS, at.cols); gl.uniform1f(u.ROWS, at.rows); gl.uniform1f(u.MARCH, o.march ?? 1); gl.uniform1f(u.SWAY, o.sway ?? 1);
    gl.uniform1f(u.MAXS, o.maxSize ?? 1023); gl.uniform1f(u.SCL, P.pxs);
    const v3 = (n, v) => gl.uniform3f(u[n], v[0], v[1], v[2]);
    v3('BODY', o.body || [0.02, 0.005, 0.005]); v3('RIM', o.rim || [1, 0.5, 0.3]); v3('RED', o.red || [0.7, 0.03, 0.06]); v3('FOG', o.fog || [0.3, 0.05, 0.04]);
    const ld = o.lightDir || [0, -5]; gl.uniform2f(u.LDIR, ld[0], ld[1]);
    gl.uniform1f(u.FOGD, o.fogDist ?? 6000); gl.uniform1f(u.RIMK, o.rimK ?? 1); gl.uniform1f(u.ALPHA, o.alpha ?? 1);
    // Walkers are quads (6 vertices each, non-instanced: SwiftShader runs instanced draws at ~20 us per instance).
    // quadAbove > 0 draws walkers shorter than that many px as square point sprites instead (measured slower: the
    // sprite square wastes half its fragments on a 1:2 figure).
    const cnt = Math.min(this.n, o.count ?? this.n);
    gl.uniform1f(u.QTH, o.quadAbove ?? 160);
    P.tex(1, this.dtex); gl.uniform1i(u.DT, 1); gl.uniform1i(u.DTW, this.dtw);
    gl.bindVertexArray(P.vao);
    const qa = o.quadAbove ?? 0;
    if (qa > 0) { gl.uniform1i(u.QUAD, 0); gl.drawArrays(gl.POINTS, 0, cnt); }
    if (qa < 1023) { gl.uniform1i(u.QUAD, 1); gl.drawArrays(gl.TRIANGLES, 0, cnt * 6); }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }
  // Render the crowd at time t as a flat mask (offscreen), and importance-sample it into a PointSet: morph targets that
  // match the crowd frame exactly (hand-off from particles to walkers). z = eye depth from the crowd's own projection.
  sample(t, n, drawOpts = {}, o = {}) {
    const P = this.P, gl = P.gl;
    const tgt = this._mask || (this._mask = P.target(W / 2, H / 2, gl.RGBA16F, true));
    const saveHdr = P.hdr; P.hdr = tgt;
    P.bind(tgt); gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.draw(t, { ...drawOpts, body: [1, 1, 1], red: [1, 0.2, 0.2], rim: [0, 0, 0], fog: [1, 1, 1], alpha: 1 });
    P.hdr = saveHdr;
    const rb = P.readback(tgt);
    const img = new Uint8ClampedArray(rb.data.length);
    for (let i = 0; i < rb.data.length; i++) img[i] = rb.data[i] * 255;
    return samplePixels(img, rb.w, rb.h, n, { scaleX: 2, scaleY: 2, flipY: true, color: null, ...o });
  }
}
