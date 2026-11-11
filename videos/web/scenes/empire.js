// EPOCH OF EMPIRES (v2, heat): the American Empire, 750 bases overseas (commonly cited; varies by source).
// At home: empty factories gone cold. Close the bases. Bring it home. Build here. Common wealth.
import { piece, FIELD as F, PAL as P } from '../lib/piece.js';
await piece({ song: 'empire', seed: 120, label: 'HOME', tempo: [36.6, 12], sigilAt: 64, endAt: 72,
  drops: [[32, 64]], darks: [[16, 32]], flashes: [32, 48],
  words: [[2, 'THE AMERICAN'], [5, 'EMPIRE.'], [8, '750 BASES.'], [12, 'OVERSEAS.'], [15, null],
    [16, 'AT HOME?'], [18, 'EMPTY'], [20, 'FACTORIES.'], [23, null], [24, 'GUARDING'], [26, 'RENT.'], [29, null],
    [32, 'CLOSE'], [34, 'THE BASES.'], [37, null], [40, 'BRING IT'], [42, 'HOME.'], [45, null],
    [48, 'BUILD'], [50, 'HERE.'], [53, null], [54, 'COMMON'], [56, 'WEALTH.'], [58, 'COMMON'], [60, 'PROSPERITY.'], [63, null]],
  hot: ['EMPIRE.', 'OVERSEAS.', 'FACTORIES.', 'RENT.', 'THE BASES.', 'HOME.', 'HERE.', 'WEALTH.', 'PROSPERITY.'],
  shots: [[0, F.globe, P.infrared], [8, F.globe, P.ironbow], [12, F.globe, P.infrared, 0, 0, 0.05],
    [16, F.die, P.ice], [24, F.corridor, P.ice],
    [32, F.globe, P.ironbow, 0, 0, (a) => 0.1 + a * 0.09], [36, F.grid, P.ironbow], [38, F.globe, P.rainbow, 0, 0, 0.6], [40, F.tunnel, P.ironbow], [42, F.globe, P.infrared, 0, 0, 1.1],
    [44, F.grid, P.rainbow], [46, F.heat, P.ironbow], [48, F.skyline, P.ironbow, 0, 0, (a) => a * 0.3], [50, F.skyline, P.infrared, 0, 0, (a) => 0.6 + a * 0.2], [52, F.crowd, P.ironbow, 0, 0, (a) => a * 0.2],
    [54, F.steppe, P.ironbow, 3], [56, F.sun, P.ironbow, 4], [58, F.steppe, P.rainbow, 3, 0.25], [60, F.sun, P.infrared], [62, F.tunnel, P.ironbow], [64, F.corridor, P.turrell]] });
