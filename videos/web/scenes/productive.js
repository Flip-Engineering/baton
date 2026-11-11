// PRODUCTIVE FORCES (v4, heat): communists want more. Run every force hot; the class runs hottest, AI runs just as hot; AI brings communism. Finally.
import { piece, FIELD as F, PAL as P } from '../lib/piece.js';
import { line } from '../lib/kit.js';
// In-world texture, never a spine frame: the Willow Run stencil over the airframe line (§10.2.1, homed here).
const stamp = (ctx, t, beat) => {
  if (beat < 13 || beat >= 16) return;
  line(ctx, 'WILLOW RUN', 60, 330, { family: 'Plex Mono', size: 46, align: 'left', color: '#ffffff', alpha: 0.9 });
  line(ctx, '#8,000', 60, 390, { family: 'Plex Mono', size: 46, align: 'left', color: '#ffffff', alpha: 0.9 });
};
await piece({ song: 'productive', seed: 1538, label: 'OUTPUT', tempo: [98.6, 45], unit: '°F', tagline: false, textY: 1240, sigilAt: 60, endAt: 64,
  drops: [[8, 40], [44, 60]], flashes: [8, 24, 44, 52], extra: stamp,
  words: [[0, 'COMMUNISTS'], [1.5, 'WANT MORE.'], [3, 'MORE.'], [4, 'UNLEASH'], [6, 'PRODUCTION.'],
    [8, 'RUN HOT.'], [10.5, 'MORE CHIPS.'], [12, 'MORE STEEL.'], [13, 'ONE PLANE'], [14.5, 'AN HOUR.'], [16, 'MORE POWER.'], [17, 'MORE TRAINS.'],
    [18.5, 'MORE HUMANS.'], [21, 'THE WORKING CLASS.'], [24, 'HOTTEST.'], [25, 'AI RUNS'], [26.5, 'JUST AS HOT.'],
    [28, 'AI.'], [29, 'BRINGS'], [30.5, 'COMMUNISM.'], [32, 'MORE EVERYTHING.'], [33.5, 'FEWER HOURS.'], [36, 'WORKER RULE.'], [38.5, 'RUN HOT.'],
    [40, null], [40.75, 'MERITOCRACY'], [42, 'OF LABOR.'],
    [44, 'HUMANITY'], [46, 'AT FULL HEAT.'], [48, 'AI.'], [49, 'BRINGS'], [50, 'COMMUNISM.'], [52, 'FINALLY.'], [56, 'RUN HOT.'], [58, 'MORE.'], [60, null]],
  hot: ['UNLEASH', 'PRODUCTION.', 'RUN HOT.', 'AN HOUR.', 'MORE HUMANS.', 'JUST AS HOT.', 'BRINGS', 'COMMUNISM.', 'MORE EVERYTHING.', 'FEWER HOURS.',
    'WORKER RULE.', 'OF LABOR.', 'HUMANITY', 'AT FULL HEAT.'],
  big: ['COMMUNISTS', 'WANT MORE.', 'MORE.', 'HOTTEST.', 'AI.', 'FINALLY.'],
  shots: [[0, F.pour, P.ironbow], [3, F.die, P.ironbow], [4, F.grid, P.ironbow], [6, F.tunnel, P.ironbow],
    [8, F.sun, P.ironbow], [10.5, F.die, P.ironbow], [12, F.pour, P.ironbow], [13, F.lattice, P.ironbow], [16, F.grid, P.ironbow], [17, F.tunnel, P.ironbow],
    [18.5, F.crowd, P.ironbow, 0, 0, (a) => a * 0.2], [21, F.crowd, P.ironbow, 0, 0, (a) => 0.2 + a * 0.1], [24, F.crowd, P.ironbow, 0, 0, (a) => 0.55 + a * 0.1],
    [25, F.sun, P.ironbow], [26.5, F.die, P.ironbow], [28, F.heat, P.ironbow], [29, F.lattice, P.ironbow], [30.5, F.pour, P.infrared],
    [32, F.grid, P.rainbow], [33.5, F.crowd, P.ironbow, 0, 0, (a) => 0.5 - a * 0.15], [36, F.pour, P.ironbow], [38.5, F.pour, P.infrared],
    [40, F.corridor, P.infrared], [42, F.pour, P.ironbow], [44, F.sun, P.ironbow], [46, F.crowd, P.rainbow, 0, 0, (a) => 0.4 + a * 0.15],
    [48, F.die, P.ironbow], [49, F.heat, P.ironbow], [50, F.lattice, P.ironbow],
    [52, F.skyline, P.ironbow, 0, 0, (a) => a * 0.3], [56, F.tunnel, P.ironbow], [58, F.pour, P.ironbow], [60, F.corridor, P.turrell]] });
