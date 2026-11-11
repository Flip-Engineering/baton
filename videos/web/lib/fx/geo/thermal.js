// geo/thermal: LWIR viewfinder remap as one WebGL2 pass that samples the 2D canvas as a texture.
// No getImageData / putImageData and no intermediate 2D canvas: texImage2D(ctx.canvas) is a GPU-side copy,
// the pass renders at sensor resolution, and drawImage puts the result back over rect.
// luminance + local max -> palette ramp, sensor noise, fixed-pattern column noise, lens falloff.
//
//   const th = new Thermal(360, 640);   th.apply(ctx, { rect, palette: 'ironbow', t, gain, level, noise });
// Cheaper: draw the scene the sensor sees straight into th.ctx (a sensor-size 2D canvas; scale cams by th.scale)
// and pass { source: th.ctx.canvas }: the upload is then 4x smaller and the source layers render at quarter area.
//   us.draw(th.ctx, { cam: th.cam(cam), ... }); th.apply(ctx, { source: th.ctx.canvas });
import { rampCanvas } from './data.js';
import { GL } from './gl.js';

const FS = `#version 300 es
precision highp float; in vec2 v; out vec4 o; uniform sampler2D S, P; uniform float T, GAIN, LEVEL, NOISE; uniform vec2 RES; uniform vec4 RECT;
float h(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float L(vec2 uv){ vec3 c = texture(S, uv).rgb; return dot(c, vec3(.45, .35, .2)) + c.r * .15; }
void main(){ vec2 uv = RECT.xy + vec2(v.x, 1. - v.y) * RECT.zw, px = RECT.zw / RES;
  float l = L(uv) * .5; float m = 0.;
  for (int i = 0; i < 4; i++){ float a = float(i) * 1.5708 + .39; vec2 d = vec2(cos(a), sin(a)); l += L(uv + d * px * 1.8) * .125; m = max(m, L(uv + d.yx * px * 5.)); }
  l = mix(l, m, .22);
  float n = (h(gl_FragCoord.xy + T * 91.) - .5) * NOISE + (h(vec2(floor(gl_FragCoord.x / 2.), 7.)) - .5) * NOISE * .5;
  float x = clamp((l - LEVEL) * GAIN + .5 + n, 0., 1.);
  vec3 c = texture(P, vec2(x, .5)).rgb;
  vec2 q = v - .5; c *= 1. - dot(q, q) * .7;
  o = vec4(c, 1.); }`;

export class Thermal {
  constructor(w = 360, h = 640) {                 // a real LWIR core is 640x512: low res is the look, and cheap
    this.w = w; this.h = h; this.g = new GL(w, h, { alpha: false });
    this.src = this.g.tex(); this.pals = {};
    const c = document.createElement('canvas'); c.width = w; c.height = h; this.ctx = c.getContext('2d'); this.scale = w / 1080;
  }
  cam(cam) { const k = this.scale; return { ...cam, zoom: (cam.zoom || 1) * k, sx: (cam.sx ?? 540) * k, sy: (cam.sy ?? 960) * k };
  }
  apply(ctx, { rect = null, palette = 'ironbow', t = 0, gain = 1.6, level = 0.35, noise = 0.06, source = null } = {}) {
    const cw = ctx.canvas.width, ch = ctx.canvas.height, [x, y, w, h] = rect || [0, 0, cw, ch], g = this.g;
    g.upload(this.src, source || ctx.canvas);
    const P = this.pals[palette] || (this.pals[palette] = g.upload(g.tex(), rampCanvas(palette)));
    g.draw('thermal', FS, { T: Math.round(t * 30), GAIN: gain, LEVEL: level, NOISE: noise, RES: [this.w, this.h], RECT: [x / cw, y / ch, w / cw, h / ch] }, { S: this.src, P });
    ctx.drawImage(g.canvas, 0, 0, this.w, this.h, x, y, w, h);
  }
}
