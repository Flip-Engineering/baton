// COMMON WEALTH (v6, heat): the heartland as a burning plain; the storm strikes on the kicks;
// the class rises over the ridge at a gallop. Common wealth. Common prosperity. Ours.
import { piece, FIELD as F, PAL as P } from '../lib/piece.js';
import { W, H, rng } from '../lib/kit.js';
function bolt(ctx, seed, a) {                            // a forked lightning strike, white-hot
  const r = rng(seed);
  let x = W * (0.2 + r() * 0.6), y = 0;
  ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = '#fffbe8'; ctx.shadowColor = '#ffe0a0'; ctx.shadowBlur = 40; ctx.lineCap = 'round';
  ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(x, y);
  while (y < H * 0.62) { x += (r() - 0.5) * 140; y += 40 + r() * 70; ctx.lineTo(x, y);
    if (r() < 0.2) { ctx.save(); ctx.lineWidth = 4; ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 300, y + 120 + r() * 120); ctx.moveTo(x, y); ctx.restore(); } }
  ctx.stroke(); ctx.restore();
}
await piece({ song: 'commonwealth', seed: 160, label: 'HEARTLAND', tempo: [36.6, 10], sigilAt: 64, endAt: 72,
  drops: [[32, 64]], flashes: [32, 48],
  words: [[8, 'THE HEARTLAND.'], [13, null], [16, 'THE FIELDS.'], [20, 'THE STEEL.'], [24, 'THE STORM.'], [28, null],
    [32, 'COMMON'], [34, 'WEALTH.'], [37, null], [40, 'COMMON'], [42, 'PROSPERITY.'], [45, null], [48, 'THE CLASS'], [50, 'RISES.'], [53, null], [56, 'OURS.'], [60, null]],
  hot: ['THE HEARTLAND.', 'THE STORM.', 'WEALTH.', 'PROSPERITY.', 'RISES.', 'OURS.'],
  shots: [[0, F.steppe, P.infrared, 0, -0.2], [8, F.steppe, P.ironbow, 0, 0], [16, F.steppe, P.rainbow, 0, 0.25], [20, F.die, P.ironbow], [24, F.heat, P.infrared],
    [28, F.steppe, P.infrared, 1, -0.2], [32, F.sun, P.ironbow], [34, F.steppe, P.ironbow, 2], [36, F.grid, P.ironbow], [38, F.steppe, P.rainbow, 2, 0.25],
    [40, F.sun, P.infrared], [42, F.steppe, P.ironbow, 3], [44, F.heat, P.ironbow], [46, F.steppe, P.infrared, 3, -0.2],
    [48, F.crowd, P.infrared, 0, 0, (a) => a * 0.12], [50, F.crowd, P.ironbow, 0, 0, (a) => 0.25 + a * 0.15], [52, F.steppe, P.rainbow, 3], [54, F.tunnel, P.ironbow], [56, F.steppe, P.ironbow, 3, 0.25],
    [58, F.sun, P.infrared, 4], [60, F.steppe, P.ironbow, 3], [62, F.tunnel, P.infrared], [64, F.corridor, P.turrell]],
  extra: (ctx, t, beat, { kick }) => { if (beat >= 16 && beat < 32 && kick > 0.3) bolt(ctx, Math.floor(beat) * 13, kick); } });
