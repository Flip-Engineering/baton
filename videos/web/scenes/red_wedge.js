// RED WEDGE (v5, heat): zero. Build. Break the old world. Compute: ours. Aim. 1776: finish it.
// Master of all things. Motor of history. Arriving. The square and the wedge stay as hot shapes.
import { piece, FIELD as F, PAL as P } from '../lib/piece.js';
import { W, H, clamp, ease } from '../lib/kit.js';
function shapes(ctx, t, beat, { kick }) {
  if (beat < 4) {                                         // the square: a black zero punched through the heat
    const s = 520 * (1 + 0.08 * kick) * ease.outExpo(clamp(beat / 0.6));
    ctx.fillStyle = '#060000'; ctx.fillRect(W / 2 - s / 2, 760 - s / 2, s, s);
  }
  if (beat >= 8 && beat < 16) {                           // the wedge drives in on every kick
    const u = ease.outExpo(clamp((beat - 8) / 1.5)), x = -700 + u * 1250 + kick * 60;
    ctx.save(); ctx.fillStyle = '#e0101e'; ctx.shadowColor = '#ff4040'; ctx.shadowBlur = 60;
    ctx.beginPath(); ctx.moveTo(x - 600, 380); ctx.lineTo(x + 380, 820); ctx.lineTo(x - 600, 1160); ctx.fill(); ctx.restore();
  }
}
await piece({ song: 'red_wedge', seed: 140, label: 'AIM', tempo: [36.6, 20], sigilAt: 60, endAt: 64,
  drops: [[0, 32], [36, 60]], flashes: [0, 8, 16, 24, 36],
  words: [[0, 'ZERO.'], [4, 'BUILD.'], [7, null], [8, 'BREAK'], [10, 'THE OLD'], [12, 'WORLD.'], [15, null],
    [16, 'COMPUTE.'], [20, 'OURS.'], [23, null], [24, 'THE PLANET.'], [28, 'AIM.'], [31, null], [32, '1776.'], [34, 'FINISH IT.'],
    [36, 'MASTER'], [38, 'OF ALL THINGS.'], [41, null], [44, 'MOTOR'], [46, 'OF HISTORY.'], [49, null], [52, 'ARRIVING.'], [56, null]],
  hot: ['ZERO.', 'BUILD.', 'WORLD.', 'OURS.', 'AIM.', 'FINISH IT.', 'OF ALL THINGS.', 'OF HISTORY.', 'ARRIVING.'], big: ['1776.'],
  shots: [[0, F.heat, P.infrared], [4, F.sun, P.ironbow], [8, F.heat, P.ironbow], [12, F.tunnel, P.infrared],
    [16, F.die, P.ironbow], [18, F.lattice, P.rainbow], [20, F.die, P.infrared], [22, F.tunnel, P.ironbow], [24, F.globe, P.rainbow], [26, F.tunnel, P.ironbow],
    [28, F.corridor, P.ironbow], [32, F.heat, P.infrared], [34, F.sun, P.ironbow],
    [36, F.steppe, P.ironbow, 3], [38, F.sun, P.infrared, 4], [40, F.grid, P.ironbow], [42, F.lattice, P.ironbow], [44, F.steppe, P.rainbow, 3, 0.25],
    [46, F.sun, P.ironbow], [48, F.die, P.ironbow], [50, F.tunnel, P.rainbow], [52, F.sun, P.ironbow], [54, F.steppe, P.ironbow, 3], [56, F.tunnel, P.ironbow],
    [58, F.heat, P.ironbow], [60, F.corridor, P.turrell]],
  extra: shapes });
