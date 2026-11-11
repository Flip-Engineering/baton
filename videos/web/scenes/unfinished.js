// 1776 / UNFINISHED (v3, heat): 1776. Unfinished. Life. Liberty. Production. Of, by and for the people. 2036. Finish it.
import { piece, FIELD as F, PAL as P } from '../lib/piece.js';
await piece({ song: 'unfinished', seed: 1776, label: '1776', tempo: [17.76, 20], sigilAt: 64, endAt: 72,
  drops: [[16, 32], [48, 64]], flashes: [16, 48],
  words: [[4, '1776.'], [8, 'UNFINISHED.'], [12, null], [16, 'LIFE.'], [18, 'LIBERTY.'], [20, 'PRODUCTION.'], [24, null],
    [32, 'OF,'], [34, 'BY'], [36, 'AND FOR'], [38, 'THE PEOPLE.'], [42, null], [48, '2036.'], [52, 'FINISH IT.'], [56, null], [60, 'FINISH IT.'], [63, null]],
  hot: ['UNFINISHED.', 'PRODUCTION.', 'THE PEOPLE.', 'FINISH IT.'], big: ['1776.', '2036.'],
  shots: [[0, F.heat, P.infrared], [8, F.steppe, P.infrared, 1, -0.2], [12, F.tunnel, P.infrared],
    [16, F.sun, P.ironbow], [18, F.grid, P.ironbow], [20, F.die, P.ironbow], [22, F.heat, P.rainbow], [24, F.tunnel, P.ironbow], [26, F.corridor, P.ironbow],
    [28, F.lattice, P.ironbow], [30, F.tunnel, P.rainbow], [32, F.steppe, P.infrared, 2, -0.2], [34, F.crowd, P.infrared, 0, 0, (a) => a * 0.12], [36, F.crowd, P.ironbow, 0, 0, (a) => 0.25 + a * 0.1],
    [38, F.sun, P.ironbow, 4], [42, F.steppe, P.ironbow, 3], [46, F.tunnel, P.infrared],
    [48, F.sun, P.infrared], [52, F.sun, P.ironbow], [54, F.skyline, P.ironbow, 0, 0, (a) => a * 0.3], [56, F.tunnel, P.rainbow], [58, F.steppe, P.ironbow, 3], [60, F.sun, P.ironbow],
    [62, F.tunnel, P.ironbow], [64, F.corridor, P.turrell]] });
