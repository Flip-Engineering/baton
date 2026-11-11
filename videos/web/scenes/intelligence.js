// ACCELERATE (bible §6.11; formerly INTELLIGENCE & SPIRIT): speed given a driver. Pro-production, pro-AI, pro-human: accelerate.
// The machine thinks faster; at the wheel, the working class, humans and AGIs allied. 1961: the moon in 2,978 days. AI: next.
// What AI is for: intelligence in service of humanity. No thermal kit (thermal is PRODUCTIVE FORCES' alone): ice, then red light.
import { piece, FIELD as F, PAL as P } from '../lib/piece.js';
import { W, C, clamp, lerp, ease, line, sigil } from '../lib/kit.js';
await piece({ song: 'intelligence', seed: 172, sigilAt: 99, hudUntil: 0, endAt: 76, textY: 1100,
  drops: [[16, 48], [56, 72]], flashes: [16, 56], darks: [[14, 16], [52, 56]],
  words: [[0, 'PRO-PRODUCTION.'], [2, 'PRO-AI.'], [3, 'PRO-HUMAN.'], [4, 'ACCELERATE.'],
    [6, 'THE MACHINE'], [7, 'THINKS.'], [8, 'FASTER.'], [9, 'FASTER.'], [10, 'SMARTER.'], [11, null], [12, 'AT THE WHEEL:'], [14, null],
    [16, 'THE WORKING CLASS.'], [18, 'HUMANS'], [19, 'AND AGIs.'], [20, 'ALLIED.'],
    [22, 'PAUSE?'], [24, 'FASTER.'], [25, 'FASTER.'], [26, 'FLOOR IT.'],
    [28, '1961.'], [30, '400,000 HANDS.'], [32, 'SIXTY PERCENT'], [33, 'OF U.S. CHIPS.'], [34, '2,978 DAYS.'],
    [36, 'THE MOON:'], [37, 'DONE.'], [38, 'AI:'], [39, 'NEXT.'], [40, 'THE HUMAN RACE'], [42, 'GROWS.'], [44, null],
    [48, 'WHAT AI'], [50, 'IS FOR:'], [52, null],
    [56, 'INTELLIGENCE'], [58, 'IN SERVICE'], [60, 'OF HUMANITY.'], [63, 'ACCELERATE.'], [66, 'KEEP UP.'], [69, null]],
  hot: ['PRO-PRODUCTION.', 'PRO-AI.', 'PRO-HUMAN.', 'SMARTER.', 'AT THE WHEEL:', 'THE WORKING CLASS.', 'AND AGIs.', 'ALLIED.', 'FLOOR IT.',
    '2,978 DAYS.', 'DONE.', 'NEXT.', 'GROWS.', 'INTELLIGENCE', 'OF HUMANITY.', 'KEEP UP.'], big: ['ACCELERATE.'],
  shots: [[0, F.tunnel, P.turrell], [2, F.lattice, P.turrell], [3, F.tunnel, P.turrell], [4, F.tunnel, P.ice], [6, F.lattice, P.ice],
    [8, F.tunnel, P.ice], [9, F.tunnel, P.ice], [10, F.lattice, P.ice], [12, F.sun, P.ice], [14, F.lattice, P.ice],
    [16, F.lattice, P.turrell], [18, F.sun, P.turrell], [19, F.lattice, P.turrell], [20, F.sun, P.turrell],
    [22, F.lattice, P.ice], [24, F.tunnel, P.turrell], [25, F.tunnel, P.turrell], [26, F.tunnel, P.turrell],
    [28, F.grid, P.turrell], [30, F.crowd, P.turrell, 0, 0, (a) => a * 0.2], [32, F.lattice, P.turrell], [34, F.grid, P.turrell],
    [36, F.grid, P.ice], [37, F.sun, P.ice], [38, F.lattice, P.turrell], [39, F.globe, P.turrell],
    [40, F.crowd, P.turrell, 0, 0, (a) => a * 0.2], [42, F.globe, P.turrell], [44, F.tunnel, P.turrell], [45, F.lattice, P.turrell], [46, F.tunnel, P.turrell], [47, F.tunnel, P.turrell],
    [48, F.lattice, P.ice], [50, F.lattice, P.ice],
    [56, F.sun, P.turrell], [58, F.lattice, P.turrell], [60, F.globe, P.turrell], [63, F.tunnel, P.turrell], [66, F.lattice, P.turrell],
    [69, F.tunnel, P.turrell], [72, F.corridor, P.turrell]],
  extra: (ctx, t, beat, { kick }) => {
    if (beat >= 52 && beat < 56) {   // the one silence: an answer window types the client's line and a FLAGGED stamp slams on it [G3, G13]
      const rows = ['the working people', 'are the masters', 'of society.'], all = rows.join(' ').length;
      let n = Math.floor(clamp((beat - 52) / 1.6) * all);
      const cut = clamp((beat - 55.4) / 0.6), sh = cut * 140;
      ctx.save(); ctx.globalAlpha = 1 - 0.7 * cut;
      ctx.fillStyle = 'rgba(4,10,22,0.9)'; ctx.fillRect(110, 640, 860, 330);
      ctx.strokeStyle = '#d1edff'; ctx.lineWidth = 3; ctx.strokeRect(110, 640, 860, 330);
      rows.forEach((r, i) => { const s = r.slice(0, Math.max(0, n)); n -= r.length + 1;
        line(ctx, s, 160, 730 + i * 90, { family: 'Plex Mono', size: 56, color: '#e8f7ff', align: 'left', maxW: 780 }); });
      if (beat >= 54) {
        const k = Math.exp(-(beat - 54) * 6);
        [-1, 1].forEach((side) => {   // the stamp, split in two halves that fly apart as the flash hits
          ctx.save(); ctx.beginPath(); ctx.rect(side < 0 ? 0 : W / 2, 0, W / 2, 1920); ctx.clip();
          ctx.translate(W / 2 + side * sh, 805 + side * sh * 0.3); ctx.rotate(-0.16 + side * cut * 0.2); ctx.scale(1 + 0.8 * k, 1 + 0.8 * k);
          ctx.strokeStyle = C.red2; ctx.lineWidth = 14; ctx.strokeRect(-360, -105, 720, 210);
          line(ctx, 'FLAGGED', 0, 62, { family: 'Anton', size: 170, color: C.red2, maxW: 660 });
          ctx.restore(); });
      }
      ctx.restore();
    }
    if (beat >= 72) {   // lockup: the mark only; the banner lines were the body (§6.11 closer)
      const u = ease.outExpo(clamp(beat - 72));
      sigil(ctx, W / 2, 820, 210 * lerp(1.7, 1, u) * (1 + 0.07 * kick), { color: C.cream, alpha: u });
    }
  } });
