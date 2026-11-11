// INTAGLIO: relights a flat ink layer as a physical engraved object, on the GPU context of a Print (print.js).
// Input is an "ink canvas" drawn in 2D: white = bare stock, black = key ink, pure red (#f00) = red overprint.
// (so key coverage = 1-R, red coverage = R-G, and total ink = 1-G, which doubles as the relief height map)
//
//   PRINT mode: ink stands proud of the sheet (intaglio ridges), paper tooth and fibre from a Print stock,
//               a raking key that orbits, glossy ridge speculars, ridge micro-shadows.
//   PLATE mode: the same lines are grooves cut into brushed, blued steel: dark groove floors, bright burr
//               on the edges that face the key, an anisotropic sheen band; INKED fills the grooves (a wiped plate).
//   Both: tilt-shift depth of field around a focus band (mip lod), grade, falloff.
//
//   const ig = new Intaglio(pr);
//   ig.render(ctx, inkCanvas, { mode: 0, light: 0.6, elev: 0.35, relief: 3, focus: [0.5, 0.2, 3] });
import { W, H } from '../kit.js';

const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

const FS = `#version 300 es
precision highp float;
uniform sampler2D INK, PAPER, NZ;
uniform vec2 R; uniform float LODH, T, MODE, INKED, RELIEF, ELEV, LANG, EXPO, FY, FW, FB, SHEENY, SHEENW, SHEEN, CA, FALL;
uniform vec2 LPOS; uniform vec3 KINK, RINK, PBASE, STEEL, HI, EDGE;
out vec4 o;
float nT(vec2 p){ return texture(NZ, p*.0078125).g; }
float fb(vec2 p){ return texture(NZ, p*.03125).r; }
float cov(vec2 uv, float lod){ return 1.-textureLod(INK, uv, lod).g; }
void main(){
  vec2 uv = gl_FragCoord.xy/R; vec2 p = gl_FragCoord.xy;
  float dof = FB*smoothstep(0., FW, abs(uv.y-FY)-FW*.25);          // tilt-shift macro: lod grows away from the focus band
  vec4 ik = textureLod(INK, uv, dof);
  float kc = clamp(1.-ik.r, 0., 1.), rc = clamp(ik.r-ik.g, 0., 1.), c = clamp(1.-ik.g, 0., 1.);
  if(CA>0.){ float cr = 1.-textureLod(INK, uv+vec2(CA/R.x,0.), dof).g; float cb = 1.-textureLod(INK, uv-vec2(CA/R.x,0.), dof).g; kc = max(kc, 0.); c = mix(c, (cr+cb)*.5, .5); }
  // relief: blurred coverage as a height field (lod ~1 = the swell of an inked line), gradient by central differences
  float l = LODH+dof; vec2 d = vec2(1.2)/R*(1.+dof);
  float hx = cov(uv+vec2(d.x,0.), l)-cov(uv-vec2(d.x,0.), l), hy = cov(uv+vec2(0.,d.y), l)-cov(uv-vec2(0.,d.y), l);
  vec4 pp = texture(PAPER, uv);
  float tx = texture(PAPER, uv+vec2(1.5/R.x,0.)).a-texture(PAPER, uv-vec2(1.5/R.x,0.)).a, ty = texture(PAPER, uv+vec2(0.,1.5/R.y)).a-texture(PAPER, uv-vec2(0.,1.5/R.y)).a;
  float sgn = MODE > .5 ? -1. : 1.;                                  // ridges on paper, grooves in the plate
  vec3 N = normalize(vec3(-(hx*RELIEF*sgn + tx*.8*(1.-MODE)), -(hy*RELIEF*sgn + ty*.8*(1.-MODE)), 1.));
  vec3 L = normalize(vec3(cos(LANG), sin(LANG), ELEV));
  vec3 V = vec3(0,0,1), Hh = normalize(L+V);
  float dif = max(dot(N,L), 0.)/max(L.z, .05);
  // key falloff across the sheet: the lamp sits at LPOS (uv), raking
  float fall = mix(1., 1.25-0.55*smoothstep(0., 1.3, length((uv-LPOS)*vec2(1., 1.78))), FALL);
  vec3 col;
  if(MODE < .5){
    vec3 base = pp.rgb;
    col = base*mix(vec3(1.), KINK/max(PBASE,.05), kc)*mix(vec3(1.), RINK/max(PBASE,.05), rc);
    col *= mix(1., dif, .55);
    float sp = pow(max(dot(N,Hh), 0.), 36.)*c*.22;                  // wet-looking ink ridge gloss
    col += sp*vec3(.9,.95,1.);
    col *= fall;
  } else {
    // brushed blued steel: fine anisotropic streaks along x, oil sheen, a highlight band where the lamp reflects
    float br = nT(vec2(p.x*.02, p.y*1.3))*.6 + nT(vec2(p.x*.004, p.y*.35))*.4;
    vec3 st = STEEL*(.75+.5*br);
    float band = exp(-pow((uv.y-SHEENY)/SHEENW, 2.))*(.75+.25*fb(p*.01));
    st = mix(st, HI*(.85+.3*br), clamp(band*SHEEN, 0., 1.));
    float oil = fb(p*.003+T*.01);
    st += vec3(.02,.035,.05)*smoothstep(.45,.8,oil)*band;
    float an = pow(max(dot(N,Hh), 0.), 60.);                          // bright burr on the edges that face the key
    float edge = clamp(length(vec2(hx,hy))*3., 0., 1.);
    vec3 groove = mix(vec3(.012,.016,.018), KINK*.6, INKED);
    col = mix(st*dif, groove, clamp(c*1.4, 0., 1.)*(1.-.35*edge));
    col += EDGE*an*edge*(1.-INKED*.7)*1.6;
    col += EDGE*max(dot(N,L)-L.z, 0.)*edge*.8*(1.-INKED*.5);
    col = mix(col, RINK*(.8+.25*dif), rc*.95);                        // red is an overprint on top of the plate
    col *= fall;
  }
  col *= EXPO;
  o = vec4(clamp(col, 0., 1.), 1.);
}`;

export class Intaglio {
  constructor(pr) {
    this.pr = pr; const gl = this.gl = pr.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('intaglio: ' + gl.getShaderInfoLog(s)); return s; };
    const p = this.prog = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, `#version 300 es\nin vec2 a; void main(){ gl_Position=vec4(a,0,1); }`));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('intaglio: ' + gl.getProgramInfoLog(p));
    this.u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); this.u[a.name] = gl.getUniformLocation(p, a.name); }
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texStorage2D(gl.TEXTURE_2D, 6, gl.RGBA8, pr.w, pr.h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const q of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, q, gl.CLAMP_TO_EDGE);
  }
  render(ctx, ink, o = {}) {
    const { mode = 0, inked = 0, relief = 3, elev = 0.35, light = 0.7, expo = 1, focus = [0.5, 1, 0], sheen = [0.5, 0.2, 0],
      ca = 0, t = 0, fall = 1, lpos = [0.2, 0.8], paper = 'cream', kink = '#0E1F18', rink = '#C8161E',
      steel = '#141b1f', hi = '#9FB2BC', edge = '#F4F1E8' } = o;
    const gl = this.gl, pr = this.pr, pt = pr.paper(paper);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, ink);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.useProgram(this.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, pr.w, pr.h);
    gl.bindBuffer(gl.ARRAY_BUFFER, pr.vb); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const tx = [[this.tex, 'INK'], [pt.tex, 'PAPER'], [pr.nz.tex, 'NZ']];
    tx.forEach(([tt, k], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tt); gl.uniform1i(this.u[k], i); });
    const U = this.u, f1 = (k, v) => U[k] && gl.uniform1f(U[k], v), f2 = (k, v) => U[k] && gl.uniform2fv(U[k], v), f3 = (k, v) => U[k] && gl.uniform3fv(U[k], v);
    f2('R', [pr.w, pr.h]); f1('LODH', o.lodh ?? (mode > 0.5 ? 0.35 : 0.6)); f1('T', t); f1('MODE', mode); f1('INKED', inked); f1('RELIEF', relief); f1('ELEV', elev); f1('LANG', light); f1('EXPO', expo);
    // focus = [y (0 top .. 1 bottom), half-width, max lod]; sheen = [y, width, strength] (uv y, top = 0)
    f1('FY', 1 - focus[0]); f1('FW', focus[1]); f1('FB', focus[2]);
    f1('SHEENY', 1 - sheen[0]); f1('SHEENW', sheen[1]); f1('SHEEN', sheen[2]); f1('CA', ca); f1('FALL', fall);
    f2('LPOS', [lpos[0], 1 - lpos[1]]);
    f3('KINK', hex(kink)); f3('RINK', hex(rink)); f3('PBASE', pt.base); f3('STEEL', hex(steel)); f3('HI', hex(hi)); f3('EDGE', hex(edge));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ctx.drawImage(pr.cv, 0, 0, W, H);
  }
}
