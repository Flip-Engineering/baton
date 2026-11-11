// Micro-benchmarks for lib/fx/particles.js. node tools/particles_bench.mjs [test,test...]
import { W, H, C, loadFonts, loadImage, outCanvas } from '../lib/kit.js';
import { Particles, Swarm, Flow, Dust, Crowd, walkerAtlas, sampleText, sampleImage, sampleVolume } from '../lib/fx/particles.js';
const ctx = outCanvas();
await loadFonts();
const P = new Particles();
const gl = P.gl;
const sync = () => { const b = new Uint8Array(4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); };
const logo = await loadImage('../assets/acp_logo_dark.png');
const mk = n => { const s = new Swarm(P, { n }); const a = s.shape(sampleVolume('ball', s.n, { r: 700, color: [255, 120, 90] })); const b = s.shape(sampleImage(logo, s.n, { w: 900, edge: 0.5 })); return { s, a, b }; };
let sw = {}; const get = n => sw[n] || (sw[n] = mk(n));
const atlas = walkerAtlas();
const crowds = {}; const crowd = (n, z0 = 300) => crowds[n + '_' + z0] || (crowds[n + '_' + z0] = new Crowd(P, { n, atlas, zRange: [z0, 9000], view: 'front', vel: [0, -120] }));
const flow = new Flow(P, { side: 512, trail: 0.9 });
const flowAt = t => ({ amp: 140, freq: 0.0025, vortex: 200 });
const dust = new Dust(P, { n: 3000, dark: 0.3 });
const T = {
  clear: () => P.begin([0.02, 0, 0]),
  sky: () => P.sky(3, { clouds: 1 }),
  swarm262k: () => { const { s, a, b } = get(1 << 18); s.draw(3, { a, b, u: 0.5, size: 2, turb: 30 }); },
  swarm524k: () => { const { s, a, b } = get(1 << 19); s.draw(3, { a, b, u: 0.5, size: 2, turb: 30 }); },
  swarm1M: () => { const { s, a, b } = get(1 << 20); s.draw(3, { a, b, u: 0.5, size: 1.6, turb: 30 }); },
  swarm1M_steps1: () => { const { s, a, b } = get(1 << 20); s.draw(3, { a, b, u: 0.5, size: 1.6, turb: 30, steps: 1 }); },
  swarm262k_streak: () => { const { s, a, b } = get(1 << 18); s.draw(3, { a, b, u: 0.5, streak: 0.08, turb: 30 }); },
  swarm262k_ribbon: () => { const { s, a, b } = get(1 << 18); s.draw(3, { a, b, u: 0.5, size: 2, turb: 30, ribbon: 1, scatter: 600 }); },
  swarm262k_ribbon_explode: () => { const { s, a, b } = get(1 << 18); s.draw(3, { a, b, u: 0.5, size: 2, turb: 30, ribbon: 1, scatter: 600, explode: 400, explodeOut: true }); },
  swarm262k_dof: () => { const { s, a, b } = get(1 << 18); s.draw(3, { a, b, u: 0.5, size: 2, dof: 2, focus: 1300, turb: 30 }); },
  flow_seq: () => flow.render((flow.frame + 1) / 30, flowAt, { size: 1.4, alpha: 0.2 }),
  flow_sim_only: () => { flow._stepFrame(flow.frame + 1, flowAt); },
  flow_still_t8: () => { flow.frame = -1; flow.mem.clear(); flow.memBytes = 0; return flow.render(8, flowAt, { size: 1.4, alpha: 0.2 }); },
  flow_still_t8_ckpt: () => { flow.frame = -1; return flow.render(8, flowAt, { size: 1.4, alpha: 0.2 }); },
  dust3k: () => dust.draw(3, { size: 8, dof: 1.2, focus: 1600 }),
  crowd10k: () => crowd(10000).draw(3, {}),
  crowd40k: () => crowd(40000).draw(3, {}),
  crowd10k_z900: () => crowd(10000, 900).draw(3, {}),
  crowd10k_quads: () => crowd(10000).draw(3, { quadAbove: 0 }),
  crowd10k_pts: () => crowd(10000).draw(3, { quadAbove: 5000, maxSize: 1023 }),
  crowd10k_split60: () => crowd(10000).draw(3, { quadAbove: 60 }),
  crowd30k_z900: () => crowd(30000, 900).draw(3, {}),
  swarm262k_layer: () => { const { s, a, b } = get(1 << 18); P.layer('bench', { mode: 'glow' }); s.draw(3, { a, b, u: 0.5, size: 2, turb: 30 }); P.layer(); },
  present: () => P.present(null, { bloom: 0.8 }),
  present_layer_fill: () => { P.layer('bench', { mode: 'glow', fill: 1, bevel: 5, snap: true }); P.layer(); P.present(null, { bloom: 0.8 }); },
  present_nobloom: () => P.present(null, { bloom: 0 }),
  to2d: () => ctx.drawImage(P.canvas, 0, 0),
};
window.tests = Object.keys(T);
window.bench = async (name, reps = 3) => {
  await T[name](); sync();               // warm
  const ts = [];
  for (let i = 0; i < reps; i++) { const t0 = performance.now(); await T[name](); sync(); ts.push(performance.now() - t0); }
  ts.sort((a, b) => a - b); return ts[reps >> 1];
};
window.show = async (list) => { P.begin([0.01, 0, 0]); for (const n of list) await T[n](); P.present(ctx, { bloom: 0.8 }); };
window.sceneReady = true;
window.dbg = () => { const { s, a, b } = get(1 << 18); P.begin([0, 0, 0]); s.draw(3, { a, b, u: 1, size: 4, alpha: 1, turb: 0 });
  const px = new Float32Array(4 * 64 * 64); P.bind(P.hdr); gl.readPixels(508, 928, 64, 64, gl.RGBA, gl.FLOAT, px); let m = 0; for (const v of px) m = Math.max(m, v); return [m, gl.getError(), s.n]; };
{
  const cst = P.program('cst', P.quadVS, `#version 300 es
precision highp float; in vec2 uv; out vec4 o; void main(){ o=vec4(uv,.5,1.); }`);
  const fet = P.program('fet', P.quadVS, `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D S; void main(){ o=texelFetch(S,ivec2(gl_FragCoord.xy),0); }`);
  const t8 = P.target(W, H, gl.RGBA8), t16 = P.target(W, H, gl.RGBA16F);
  const run = (pr, tgt, src) => { P.use(pr); P.bind(tgt); if (src) { P.tex(0, src.tex); } gl.disable(gl.BLEND); P.quad(); };
  Object.assign(T, {
    q_const_default: () => run(cst, null), q_const_rgba8: () => run(cst, t8), q_const_rgba16: () => run(cst, t16),
    q_fetch16_to_default: () => run(fet, null, P.hdr), q_fetch16_to_rgba8: () => run(fet, t8, P.hdr),
    read_rgba8: () => { P.bind(t8); const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); },
    draw2d: () => { ctx.drawImage(P.canvas, 0, 0); ctx.getImageData(0, 0, 1, 1); },
  });
  window.tests = Object.keys(T);
}
{
  const t8 = P.target(W, H, gl.RGBA8);
  Object.assign(T, {
    sw_size1: () => { const { s, a, b } = get(1 << 18); s.draw(3, { a, b, u: 1, size: 1, sizeVar: 0, turb: 30 }); },
    sw_size2: () => { const { s, a, b } = get(1 << 18); s.draw(3, { a, b, u: 1, size: 2, sizeVar: 0, turb: 30 }); },
    sw_size4: () => { const { s, a, b } = get(1 << 18); s.draw(3, { a, b, u: 1, size: 4, sizeVar: 0, turb: 30 }); },
    sw_size2_rgba8: () => { const { s, a, b } = get(1 << 18); const h = P.hdr; P.hdr = t8; s.draw(3, { a, b, u: 1, size: 2, sizeVar: 0, turb: 30 }); P.hdr = h; },
    sw_size1_offscreen: () => { const { s, a, b } = get(1 << 18); P.setCamera({ panX: 5000 }); s.draw(3, { a, b, u: 1, size: 1, sizeVar: 0, turb: 30 }); P.setCamera(); },
    sw_streak_20k: () => { const { s, a, b } = get(1 << 18); s.draw(3, { a, b, u: 0.5, streak: 0.05, count: 20000 }); },
  });
  window.tests = Object.keys(T);
}
window.caps = () => [...gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)];
// Particles({ scale < 1 }): point sizes follow the target (P.pxs), so a half-res context renders the same image at
// lower resolution. Returns the mean luma (0..255) of a swarm frame at scale 1 and 0.5 after upscaling to W x H.
window.scaleCheck = async () => {
  const lum = (canvas) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.drawImage(canvas, 0, 0, W, H); const d = g.getImageData(0, 0, W, H).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] * 0.3 + d[i + 1] * 0.5 + d[i + 2] * 0.2; return s / (W * H); };
  const out = {};
  for (const scale of [1, 0.5]) {
    const Q = new Particles({ scale }), s = new Swarm(Q, { n: 1 << 17 });
    const a = s.shape(sampleImage(logo, s.n, { w: 900, edge: 0.5 }));
    Q.begin(); s.draw(3, { a, b: a, u: 1, size: 2, alpha: 0.4, turb: 0 }); Q.present(null, { bloom: 0, exposure: 1 });
    out[scale] = lum(Q.canvas).toFixed(2);
  }
  return out;
};
