// HORDE (footage): the promoted piece for lib/fx/footage.js. The client's banner rider as a mythic silhouette:
// a giant sun, then the ACP mark burning in the sky, the horde multiplied around him, the crowd inside the word,
// the lockup. Every shot is 2-3 layers (plate + horde + cut-out rider + embers) in brand LOOKS, crossed by the
// punch/whip/slam kit. Track: horde_footage (the horde charge cut to 8 bars, 160 BPM).
import { W, H, C, loadFonts, loadBeats, lerp, ease, Finish, closer, outCanvas, seq, cue, sigil, BRAND, tinted, line, clamp } from '../lib/kit.js';
import { Footage } from '../lib/fx/footage.js';

const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('horde_footage');
const fx = await Footage.load();
console.log(`footage: loaded in ${fx.stats.loadMs} ms from ${fx.stats.source}, track ${fx.stats.trackHash}, shaders ${fx.warm()} ms`);
const finish = new Finish(17);
window.fx = fx;

const CUES = [...seq(1, [[3, 'ONE RIDER.']]), ...seq(5, [[5, 'ONE CLASS.', 1]]), ...seq(11, [[5, 'MILLIONS.', 1]])];
const SIGIL = g => { const M = tinted(BRAND.acp_mark, '#ffffff'), s = 760; g.drawImage(M, W / 2 - s * M.width / M.height / 2, 330, s * M.width / M.height, s); };
const TYPE_HORDE = g => { g.textAlign = 'center'; g.font = '760px Anton'; g.fillText('THE', W / 2, 880); g.font = '470px Anton'; g.fillText('HORDE', W / 2, 1440); };
const HORDE = Footage.rows({ n: 12, seed: 9, y0: 0.53, y1: 1.02, s0: 0.1, s1: 0.8, haze: 0.7 });
const DENSE = Footage.rows({ n: 10, seed: 5 });
const kick = t => Math.max(B.env('kick', t, 9), B.env('impact', t, 5));

const SHOTS = [
  [0, 'sun', async (t, out) => { const f = fx.ride(t, { rate: 8 }); await fx.frame(f);
    return fx.hero({ t, f, ...LO(), look: 'hero-sun', zoom: lerp(1.25, 1.4, t / 1.5), at: [0.42, 0.6], kick: kick(t), out }); }],
  [4, 'sigil', async (t, out) => { const f = fx.ride(t, { rate: 8, off: 12 }); await fx.frame(f); fx.mask('sigil', SIGIL);
    return fx.hero({ t, f, ...LO(), look: 'hero-sigil', zoom: 1.35, at: [0.5, 0.7], kick: kick(t), out }); }],
  [10, 'horde', async (t, out) => { const f = fx.ride(t, { rate: 12, off: 30 }); await fx.frame(f);   // the horde rides out of the sun
    return fx.hero({ t, f, ...LO(), look: 'hero-sun', zoom: 1.05, at: [0.5, 0.6], rows: HORDE, crowd: { grade: 'gold', fog: '#7a1410', gap: 0.04 },
      sky: { sun: { x: 0.5, y: 0.44, r: 0.42 }, rays: 0.9 }, kick: kick(t), embers: { size: 11, rise: 0.18, opacity: 1 }, out }); }],
  [16, 'giant', async (t, out) => { const f = fx.ride(t, { off: 20 }); await fx.frame(f);
    fx.crowd({ ...fx.look('gold-horde'), f0: t * 30, rows: DENSE, gap: 0.05, jx: 0.25, out: 'crowd', res: 0.5, t });
    fx.mask('horde', TYPE_HORDE);
    return fx.type({ inside: 'crowd', mask: 'horde', grade: 'acp', gain: 1.4, bias: -0.18, gamma: 1.2, outGrade: 'acp', outDim: 0.6,
      sky: { mode: 'field' }, ...fx.follow(f, { zoom: 1.2, at: [0.5, 0.62] }), exLen: 0.045 + 0.025 * kick(t), exDir: [0.3, -0.95],
      exA: '#c91f37', exB: '#3a0208', stroke: 6, out, ...LO() }); }],
  [24, 'lockup', async (t, out) => { const f = fx.ride(t, { rate: 6, off: 40 }); await fx.frame(f);
    return fx.hero({ t, f, ...LO(), look: 'hero-sun', zoom: 1.3, at: [0.5, 0.66], sky: { sun: { r: 0.22 } }, kick: kick(t), out }); }],
];
const TRANS = [[4, 'punch', 0.5], [10, 'whip', 0.6], [16, 'slam', 0.25], [24, 'punch', 0.5]];
const shotAt = b => { let s = SHOTS[0]; for (const x of SHOTS) if (b >= x[0]) s = x; return s; };

let lo = false;                                          // true while a transition renders both sides
const LO = () => (lo ? { res: 0.5 } : {});
window.renderFrame = async (t) => {
  const beat = B.beat(t), frame = Math.round(t * 30), t0 = performance.now();
  fx.begin();
  let name, tGL = 0;
  if (beat >= 27.5) { closer(ctx, t - 27.5 * B.spb); finish.apply(ctx, frame, { grain: 0.06, vignette: 0.6 }); name = 'closer'; }
  else {
    const tr = TRANS.find(([b, , d]) => beat >= b - d / 2 && beat < b + d / 2);
    if (tr) {
      const [b, kind, d] = tr, A = shotAt(b - d / 2 - 0.01), Z = shotAt(b + 0.01);
      lo = true; await A[2](t, 'A'); await Z[2](t, 'B'); lo = false;
      fx.trans(kind, 'A', 'B', (beat - (b - d / 2)) / d, { dir: [1, -0.12] });
      name = `${kind}:${A[1]}>${Z[1]}`;
    } else { const s = shotAt(beat); await s[2](t, null); name = s[1]; }
    fx.sync(); tGL = performance.now() - t0;                  // GL work done (synced)
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.drawImage(fx.canvas, 0, 0);
    cue(ctx, CUES, beat, B.spb, { y: 1690, size: 240 + 34 * B.env('shout', t, 14), stroke: 14, red: C.red2, redStroke: '#0b0303' });
    if (beat >= 24) {                                        // the lockup lands in the sun, ACP.US under the rider
      const a = ease.outExpo(clamp((beat - 24.3) / 1.2));
      sigil(ctx, W / 2, 560, 170 * (1.3 - 0.3 * a), { color: '#0b0303', alpha: a });
      line(ctx, 'ACP.US', W / 2, 1720, { family: 'Archivo Black', size: 84, color: C.cream, alpha: clamp((beat - 25) * 2) });
    }
    finish.apply(ctx, frame, { grain: 0.07, vignette: 0.5, flash: 0.25 * B.env('impact', t, 10) });
  }
  ctx.getImageData(0, 0, 1, 1);
  console.log(`[bench] ${name.padEnd(22)} t=${t.toFixed(2)} beat=${beat.toFixed(1)} ${Math.round(performance.now() - t0)} ms/frame (gl ${Math.round(tGL)})${fx.stats.autoRes ? '  auto-res ' + fx.stats.autoRes : ''}`);
};
window.sceneReady = true;
