// LAB: FOOTAGE (v2). The client's red steppe riders through lib/fx/footage.js, now as finished frames:
// brand-locked LOOKS, the blown sky replaced (tone or field), clarity on the soft source, the rider framed
// small (zoom <= 1.6) against a composed sky, and 2-3 layers per frame (far horde + hero rider + embers) through
// render targets. Every frame logs its ms ([bench] lines in the stills log). Track: productive (140 BPM).
import { W, H, C, loadFonts, loadBeats, clamp, lerp, ease, line, Finish, closer, outCanvas, seq, cue, BRAND, tinted } from '../lib/kit.js';
import { Footage } from '../lib/fx/footage.js';

const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('lab_footage');
const fx = await Footage.load();
console.log(`footage: loaded in ${fx.stats.loadMs} ms from ${fx.stats.source}, track ${fx.stats.trackHash}, shaders ${fx.warm()} ms`);
const finish = new Finish(41);
window.fx = fx;                                       // bench hook: fx.profile = true -> fx.stats per effect

const CUES = [
  ...seq(12, [[4, 'THE PLAINS.']]),
  ...seq(24, [[4, 'MILLIONS.', 1]]),
  ...seq(44, [[4, 'ONE RIDER.'], [4, 'ONE CLASS.', 1]]),
  ...seq(52, [[4, 'ARRIVING.', 1]]),
];
const LABELS = [[0, '01 SLIT-SCAN / sky tone, clarity'], [4, '01b SLIT / radial, field sky'],
  [8, "02 PARALLAX / look 'infrared-dolly'"], [16, "03 ROTOSCOPE / look 'woodcut'"],
  [20, "03b ROTOSCOPE / 'constructivist-poster'"], [24, '04 HORDE / 3 layers + embers'], [28, "04b CROWD / mirrored, 'gold-horde'"],
  [32, '05 ECHO / ghosts, sky tone'], [36, '05b ECHO / brand time-split'], [40, '06 GIANT / the crowd inside the word'],
  [44, "07 HERO / 'hero-sun' + rim + embers"], [52, "07b HERO / 'hero-sigil'"], [56, '08 TRANSITIONS / whip, punch']];

function label(beat) {
  let s = null; for (const [b, l] of LABELS) if (beat >= b) s = l;
  if (!s || beat >= 60) return;
  ctx.save(); ctx.globalAlpha = 0.85;
  ctx.fillStyle = 'rgba(8,1,2,0.55)'; ctx.fillRect(40, 64, 16 + s.length * 17.2, 46);
  line(ctx, s, 52, 97, { family: 'Plex Mono', size: 28, align: 'left', color: C.cream, maxW: W - 100 });
  ctx.restore();
}

const TYPE_HORDE = g => {
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = '760px Anton'; g.fillText('THE', W / 2, 880);
  g.font = '470px Anton'; g.fillText('HORDE', W / 2, 1440);
};
const TYPE_OURS = g => {
  g.textAlign = 'center'; g.font = '560px Anton';
  g.save(); g.translate(W / 2, 1180); g.scale(1, 1.9); g.fillText('OURS', 0, 0); g.restore();
};
const SIGIL = g => { const M = tinted(BRAND.acp_mark, '#ffffff'), s = 760; g.drawImage(M, W / 2 - s * M.width / M.height / 2, 330, s * M.width / M.height, s); };
const ROWS = Footage.rows({ n: 10, seed: 5 });
const ROWS2 = Footage.rows({ n: 12, seed: 9, y0: 0.44, s0: 0.12, s1: 1.2 });

// the hero plate: fx.hero() (rider small against a composed sun/sigil sky, rim light, horde around him, embers)
async function hero(t, look, out, o = {}) {
  const f = fx.ride(t, { rate: 8 }); await fx.frame(f);
  if (look === 'hero-sigil') fx.mask('sigil', SIGIL);
  return fx.hero({ t, f, look, out, kick: B.env('kick', t, 9), ...LO(), ...o });
}
// sections: [startBeat, name, (t, beat, out) -> draws to out (a target) or fx.canvas (null)]
const SECTIONS = [
  [0, 'slit', (t, b, out) => fx.slit({ f0: 18 + t * 6, span: lerp(2, 62, ease.inOutCubic(b / 4)), mode: 'wave', wave: 0.3 + b / 4, bands: 0,
    grade: 'acp', gain: 1.25, bias: -0.08, gamma: 1.2, clarity: 0.6, sky: { mode: 'tone', top: 0.22, hzV: 0.62, cloud: 1.4 },
    ...fx.follow(18 + t * 6 + 30, { zoom: 1.4, at: [0.5, 0.6], lock: 0.5 }), t, out })],
  [4, 'slit-radial', (t, b, out) => fx.slit({ f0: 18 + t * 8, span: 66, mode: 'radial', bands: 11, seam: 0.35 + 0.65 * B.env('cowm', t, 10),
    grade: 'acp', gain: 1.3, bias: -0.1, gamma: 1.1, sky: { mode: 'field', cloud: 1.2 }, seamColor: '#f4e6d0',
    ...fx.follow(18 + t * 8 + 33, { zoom: 1.5, at: [0.5, 0.58], lock: 0.6 }), rot: 0.05 * Math.sin(t), t, out })],
  [8, 'parallax', async (t, b, out) => { const u = (b - 8) / 8, f = fx.ride(t - 3.43, { off: 4, rate: 20 }); await fx.frame(f);
    return fx.parallax({ ...fx.look('infrared-dolly'), f0: f, t, kick: B.env('kick', t, 9), ...fx.follow(f, { zoom: 1.3, at: [0.46, 0.62], lock: 0.7 }),
      cam: { x: lerp(-0.12, 0.12, u), y: lerp(-0.03, 0.04, u), z: lerp(0, -0.6, ease.inOutCubic(u)), yaw: lerp(0.06, -0.07, u), pitch: -0.02 },
      depth: 2.4, out }); }],
  [16, 'woodcut', async (t, b, out) => { const twos = Math.floor(t * 15) / 15, jit = Math.floor(t * 15) % 3, f = fx.ride(twos - 6.86, { off: 10 });
    await fx.frame(f, { blend: false });
    return fx.ink({ ...fx.look('woodcut'), jit, ...fx.follow(f, { zoom: 1.5, at: [0.48, 0.6] }), out }); }],
  [20, 'poster', async (t, b, out) => { const jit = Math.floor(t * 15) % 3, f = fx.ride(Math.floor(t * 15) / 15 - 6.86, { off: 14 }), k = fx.track(f);
    await fx.frame(f, { blend: false });
    return fx.ink({ ...fx.look('constructivist-poster', { sky: { sun: { x: k.x + 0.04, y: k.y - 0.12, r: 0.22 } } }), jit, t,
      ...fx.follow(f, { zoom: 1.45, at: [0.5, 0.64] }), out }); }],
  [24, 'horde', (t, b, out) => hero(t, 'hero-sun', out, { zoom: 1.15, at: [0.36, 0.66], sky: { sun: { r: 0.2 } } })],
  [28, 'crowd-mirror', async (t, b, out) => { await fx.frame(fx.ride(t, { off: 30, run: 2 }));
    return fx.crowd({ ...fx.look('gold-horde'), f0: t * 30, rows: ROWS2, mirror: true, gap: 0.08, res: 0.5, t, out }); }],
  [32, 'echo-ghost', async (t, b, out) => { const f = fx.ride(t - 13.7); await fx.frame(f);
    return fx.echo({ f0: f, mode: 'ghost', taps: 8, spacing: 5, decay: 0.9, grade: 'acp', gain: 1.4, bias: -0.18, gamma: 1.2, clarity: 0.9, sc: 0.3,
      sky: { mode: 'field', cloud: 1.2 }, rim: 0.5, echoHead: '#f4e6d0', echoTail: '#c91f37', echoGain: 1.4,
      ...fx.follow(f, { zoom: 1.45, at: [0.55, 0.6], lock: 0.7 }), out }); }],
  [36, 'echo-chroma', async (t, b, out) => { const f = fx.ride(t - 13.7, { off: 8 }); await fx.frame(f); const kick = B.env('kick', t, 9);
    return fx.echo({ f0: f, mode: 'chroma', spacing: 3 + 5 * kick, grade: 'acp', gain: 1.45, bias: -0.2, gamma: 1.2, clarity: 0.8, sc: 0.3,
      sky: { mode: 'field', cloud: 1.1 }, rim: 0.6, echoGain: 1.2, ...fx.follow(f, { zoom: 1.4 + 0.03 * kick, at: [0.5, 0.62] }), out }); }],
  [40, 'giant', async (t, b, out) => { const f = fx.ride(t - 17.1, { off: 20 }); await fx.frame(f);
    fx.crowd({ ...fx.look('gold-horde'), f0: t * 30, rows: ROWS, gap: 0.05, jx: 0.25, out: 'crowd', res: 0.5, t });
    fx.mask('horde', TYPE_HORDE);
    return fx.type({ inside: 'crowd', mask: 'horde', grade: 'acp', gain: 1.4, bias: -0.18, gamma: 1.2, outGrade: 'acp', outDim: 0.6,
      sky: { mode: 'field' }, ...fx.follow(f, { zoom: 1.2, at: [0.5, 0.62] }), exLen: 0.045 + 0.02 * B.env('kick', t, 9), exDir: [0.3, -0.95],
      exA: '#c91f37', exB: '#3a0208', stroke: 6, out, ...LO() }); }],
  [44, 'hero-sun', (t, b, out) => hero(t, 'hero-sun', out)],
  [52, 'hero-sigil', (t, b, out) => hero(t, 'hero-sigil', out, { at: [0.5, 0.7], zoom: 1.2 })],
  [56, 'woodcut', null], [57, 'horde', null],
  [58.5, 'ours', async (t, b, out) => { const f = fx.ride(t); await fx.frame(f);
    fx.mask('ours', TYPE_OURS);
    return fx.type({ inside: 'slit', mask: 'ours', f0: 18, span: 60, grade: 'gold', gain: 1.4, bias: -0.1, outGrade: 'poster', outDim: 0.9,
      sky: { mode: 'field' }, inZoom: 1.4, inCx: 0.55, inCy: 0.47, exLen: 0.03, exDir: [-0.4, -0.9], exA: '#c91f37', exB: '#3a0208', stroke: 6, out, ...LO() }); }],
];
const byName = n => SECTIONS.find(s => s[2] && s[1] === n);
// transitions: [beat, kind, dur (beats)]: both sides render into targets A and B, fx.trans crosses them
const TRANS = [[16, 'punch', 0.5], [24, 'whip', 0.6], [44, 'punch', 0.5], [57, 'whip', 0.5], [58.5, 'punch', 0.5]];
function sectionAt(beat) { let s = SECTIONS[0]; for (const x of SECTIONS) if (beat >= x[0]) s = x; return s[2] ? s : byName(s[1]); }

let lo = false;                                          // true while a transition renders both sides
const LO = () => (lo ? { res: 0.5 } : {});
window.renderFrame = async (t) => {
  const beat = B.beat(t), frame = Math.round(t * 30), t0 = performance.now();
  fx.begin();
  let name, tGL = 0;
  if (beat >= 60) { closer(ctx, t - 60 * B.spb); finish.apply(ctx, frame, { grain: 0.06, vignette: 0.6 }); name = 'closer'; }
  else {
    const tr = TRANS.find(([b, , d]) => beat >= b - d / 2 && beat < b + d / 2);
    if (tr) {
      const [b, kind, d] = tr, A = sectionAt(b - d / 2 - 0.01), Bs = sectionAt(b + d / 2 + 0.01);
      lo = true; await A[2](t, beat, 'A'); await Bs[2](t, beat, 'B'); lo = false;
      fx.trans(kind, 'A', 'B', (beat - (b - d / 2)) / d, { dir: kind === 'whip' ? [1, -0.15] : [1, 0] });
      name = `${kind}:${A[1]}>${Bs[1]}`;
    } else { const s = sectionAt(beat); await s[2](t, beat, null); name = s[1]; }
    fx.sync(); tGL = performance.now() - t0;                  // GL work done (synced)
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.drawImage(fx.canvas, 0, 0);
    let flash = 0;
    for (const c of [4, 8, 20, 28, 32, 36, 40, 52]) if (beat >= c && beat < c + 0.3) flash = Math.max(flash, 0.5 * (1 - (beat - c) / 0.3));
    cue(ctx, CUES, beat, B.spb, { y: 1660, size: 230 + 30 * B.env('shout', t, 14), stroke: 14, red: C.red2, redStroke: '#0b0303' });
    label(beat);
    finish.apply(ctx, frame, { grain: 0.07, vignette: 0.55, flash });
  }
  ctx.getImageData(0, 0, 1, 1);                              // sync: count the GPU + 2D work in the frame time
  console.log(`[bench] ${name.padEnd(30)} t=${t.toFixed(2)} beat=${beat.toFixed(1)} ${Math.round(performance.now() - t0)} ms/frame (gl ${Math.round(tGL)})${fx.stats.autoRes ? '  auto-res ' + fx.stats.autoRes : ''}`);
};
window.sceneReady = true;
