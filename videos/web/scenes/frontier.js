// FRONTIER (v5): the frontier as a chant of heat. Horseback, iron, rails, power,
// concrete, the moon: every era a year slammed over a burning field. The lights
// went out. 2036: the machine is the next frontier. Always ours. Arriving.
import { W, H, C, loadFonts, loadBeats, loadImage, clamp, lerp, ease, Finish, sigil, signoff, closer, outCanvas, hud } from '../lib/kit.js';
import { Heat, FIELD as F, PAL as P, sliceGlitch, punch, scaleBar, riders } from '../lib/heat.js';

const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('frontier');
const logo = await loadImage('../assets/acp_logo_dark.png');
const finish = new Finish(1869);
const heat = new Heat(0.5);

const WORDS = [[4, 'A CONTINENT.'], [8, 'ON HORSEBACK.'], [11, null], [12, 'THEN'], [13, 'IRON.'], [15, null],
  [16, '1869.'], [18, 'RAILS.'], [21, null], [24, 'COAST'], [26, 'TO COAST.'], [29, null],
  [32, '1935.'], [34, 'POWER.'], [37, null], [40, 'EVERY'], [42, 'FARM.'], [45, null],
  [48, '1936.'], [50, 'CONCRETE.'], [52, 'A MOUNTAIN.'], [55, null],
  [56, '1969.'], [58, 'THE MOON.'], [60, '8 YEARS.'], [63, null],
  [64, 'THEN'], [66, 'THE LIGHTS'], [68, 'WENT OUT.'], [71, null],
  [72, '2036.'], [74, 'THE MACHINE.'], [77, null], [80, 'THE NEXT'], [82, 'FRONTIER.'], [85, null],
  [88, 'ALWAYS'], [90, 'OURS.'], [93, null], [96, 'ARRIVING.'], [99, null]];
const YEARS = new Set(['1869.', '1935.', '1936.', '1969.', '2036.']);
const HOT = new Set(['ON HORSEBACK.', 'IRON.', 'RAILS.', 'TO COAST.', 'POWER.', 'FARM.', 'CONCRETE.', 'THE MOON.', 'WENT OUT.', 'THE MACHINE.', 'FRONTIER.', 'OURS.', 'ARRIVING.']);
// [beat, field, palette, riders, horizon shift]
const SHOTS = [[0, F.steppe, P.infrared, 1, -0.2], [8, F.steppe, P.ironbow, 2, 0], [12, F.sun, P.ironbow, 0, 0],
  [16, F.grid, P.ironbow, 0, 0], [18, F.grid, P.rainbow, 0, 0], [20, F.tunnel, P.ironbow, 0, 0], [22, F.grid, P.infrared, 0, 0],
  [24, F.steppe, P.ironbow, 2, 0.25], [26, F.grid, P.ironbow, 0, 0], [28, F.sun, P.rainbow, 0, 0], [30, F.tunnel, P.infrared, 0, 0],
  [32, F.lattice, P.ironbow, 0, 0], [34, F.sun, P.ironbow, 0, 0], [36, F.lattice, P.rainbow, 0, 0], [38, F.die, P.ironbow, 0, 0],
  [40, F.steppe, P.rainbow, 0, 0.2], [42, F.lattice, P.infrared, 0, 0], [44, F.die, P.rainbow, 0, 0], [46, F.tunnel, P.ironbow, 0, 0],
  [48, F.corridor, P.ironbow, 0, 0], [50, F.corridor, P.infrared, 0, 0], [52, F.heat, P.ironbow, 0, 0], [54, F.corridor, P.rainbow, 0, 0],
  [56, F.sun, P.ironbow, 0, 0], [58, F.sun, P.rainbow, 0, 0], [60, F.tunnel, P.ironbow, 0, 0], [62, F.tunnel, P.rainbow, 0, 0],
  [64, F.heat, P.ice, 0, 0],
  [72, F.die, P.ironbow, 0, 0], [74, F.lattice, P.ironbow, 0, 0], [76, F.die, P.rainbow, 0, 0], [78, F.tunnel, P.ironbow, 0, 0],
  [80, F.grid, P.ironbow, 0, 0], [82, F.sun, P.ironbow, 0, 0], [84, F.lattice, P.rainbow, 0, 0], [86, F.die, P.infrared, 0, 0],
  [88, F.steppe, P.ironbow, 3, 0], [90, F.steppe, P.infrared, 3, -0.2], [92, F.sun, P.ironbow, 4, 0], [94, F.steppe, P.rainbow, 3, 0.25],
  [96, F.steppe, P.ironbow, 3, 0], [98, F.tunnel, P.ironbow, 0, 0], [100, F.corridor, P.turrell, 0, 0]];
const PN = ['ironbow', 'infrared', 'rainbow', 'ice', 'infrared'];
const at = (list, beat) => { let r = list[0]; for (const x of list) if (beat >= x[0]) r = x; return r; };

window.renderFrame = async (t) => {
  const beat = B.beat(t), frame = Math.round(t * 30);
  if (beat >= 104) { closer(ctx, (beat - 104) * B.spb); finish.apply(ctx, frame, { grain: 0.05, vignette: 0.6 }); return; }
  const kick = B.env('kick', t, 10), imp = B.env('impact', t, 5);
  const [s0, field, pal, dens, hz] = at(SHOTS, beat);
  const age = beat - s0;
  const drop = (beat >= 16 && beat < 64) || (beat >= 72 && beat < 100);
  const dark = beat >= 64 && beat < 72 ? clamp((beat - 64) / 3) : 0;
  const zoom = 1 + 0.09 * kick + 0.22 * imp + age * 0.035 + (field === F.tunnel ? age * 0.1 : 0);
  heat.draw(ctx, t * (1 - 0.85 * dark), { field, pal, kick: kick * (1 - dark), zoom, hz,
    freeze: dark * 0.8, hot: dark ? -0.5 * dark : field === F.corridor ? -0.2 : drop ? 0.08 : 0,
    split: 0.003 + 0.016 * kick + (drop ? 0.006 : 0), warp: drop ? 1.25 : 1, seed: s0 * 1.13,
    melt: beat >= 72 && beat < 100 ? 0.04 + 0.05 * kick : 0, rot: drop ? Math.sin(beat * 1.1) * 0.02 : 0 });
  if (dens) riders(ctx, B, t, dens, pal !== P.infrared, H * (1 - (-0.2 + hz) * zoom) / 2, s0);
  if (beat < 100) {
    hud(ctx, t, beat < 64 ? 36.6 + beat * 18 + kick * 20 : beat < 72 ? lerp(1188, 12, dark) : 1500 + beat * 40 + kick * 80,
      W / 2 + Math.sin(t * 1.7) * 200, 700 + Math.cos(t * 1.1) * 180, beat < 64 ? 'BUILD' : beat < 72 ? 'IDLE' : 'BUILD', dark > 0.5 ? '#dff4ff' : '#fff');
    scaleBar(ctx, dark > 0.5 ? 'ice' : PN[pal], dark > 0.5 ? '12°' : `${Math.round(40 + beat * 14)}°`, '36°');
  }
  if (beat >= 100) {
    const u = ease.outExpo(clamp((beat - 100) / 1));
    sigil(ctx, W / 2, 820, 210 * lerp(1.7, 1, u) * (1 + 0.07 * kick), { color: C.cream, alpha: u, tagline: true });
  }
  const cut = age < 0.3 ? 1 - age / 0.3 : 0;
  sliceGlitch(ctx, (drop ? 0.4 : 0.15) * kick + 0.8 * cut * (beat >= 16 ? 1 : 0.2) + 0.4 * imp, frame * 11 + 7, drop ? 12 : 6);
  const w = at(WORDS, beat);
  if (w[1] && beat >= w[0]) {
    const yr = YEARS.has(w[1]);
    punch(ctx, w[1], (beat - w[0]) * B.spb, { y: yr ? 1020 : 1540, size: yr ? 440 : HOT.has(w[1]) ? 270 : 230,
      color: dark > 0.5 ? '#e8f7ff' : HOT.has(w[1]) || yr ? '#ffffff' : C.cream, jitter: drop ? 1 : 0.3, seed: w[0] * 3 });
  }
  ctx.globalAlpha = 0.9; ctx.drawImage(logo, 40, H - 160, 96, 96); ctx.globalAlpha = 1;
  const flash = [16, 32, 48, 56, 72].reduce((f, b) => f + (beat >= b && beat < b + 0.25 ? 0.85 - (beat - b) * 3.4 : 0), 0);
  finish.apply(ctx, frame, { grain: 0.1, vignette: 0.75, flash });
};
window.sceneReady = true;
