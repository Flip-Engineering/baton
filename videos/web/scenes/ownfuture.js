// OWN THE FUTURE (v4, heat): exit 2036 came early. A workers' party called for 2036 arrived in 2024, twelve years early; ten of us, 29 clubs, 100s of truckers; by 2036, a party of millions. The future belongs to the working class.
import { piece, FIELD as F, PAL as P } from '../lib/piece.js';
await piece({ song: 'ownfuture', seed: 130, label: '2036', tempo: [36.6, 14], sigilAt: 64, endAt: 68,
  drops: [[16, 48], [52, 64]], flashes: [16, 52],
  words: [[0, 'EXIT 2036.'], [2, 'FOOT DOWN.'], [4, "A WORKERS'"], [6, 'PARTY.'], [8, 'WE CALLED IT.'], [10, 'THE EXIT'], [11, 'CAME EARLY.'], [13, null], [14, '2036?'],
    [16, 'TRY 2024.'], [18, 'THE AMERICAN'], [19, 'COMMUNIST PARTY.'], [21, 'TWELVE YEARS'], [22, 'EARLY.'], [23, 'EARLY.'], [24, 'EARLY.'], [26, 'TEN OF US.'],
    [27, '29 CLUBS.'], [28, 'PORT NEWARK.'], [30, '100s OF TRUCKERS.'], [32, 'ON THE MARCH.'], [34, 'THROUGH'], [35, 'OUR STRUGGLE.'], [36, 'BY 2036.'], [37, 'A PARTY'], [38, 'OF MILLIONS.'],
    [40, 'FROM TEN'], [42, 'TO MILLIONS.'], [44, 'CALLING IT'], [46, 'AGAIN.'], [48, 'WHO OWNS'], [49, 'THE MACHINES?'], [50, 'WHO OWNS'],
    [51, 'THE FUTURE?'], [52, 'THE FUTURE'], [54, 'BELONGS TO'], [56, 'THE WORKING CLASS.'], [60, 'NEXT EXIT:'], [61, 'A PARTY'], [62, 'OF MILLIONS.'], [64, null]],
  hot: ['FOOT DOWN.', 'WE CALLED IT.', 'CAME EARLY.', 'COMMUNIST PARTY.', 'EARLY.', 'ON THE MARCH.', 'OUR STRUGGLE.', 'OF MILLIONS.', 'TO MILLIONS.', 'AGAIN.', 'THE MACHINES?', 'THE FUTURE?', 'THE FUTURE', 'THE WORKING CLASS.', 'NEXT EXIT:'], big: ['EXIT 2036.', 'TRY 2024.'],
  shots: [[0, F.tunnel, P.infrared], [8, F.sun, P.ironbow], [12, F.tunnel, P.ironbow],
    [16, F.pour, P.ironbow], [18, F.grid, P.ironbow], [20, F.die, P.ironbow], [22, F.die, P.rainbow], [24, F.lattice, P.ironbow], [26, F.sun, P.ironbow],
    [28, F.skyline, P.ironbow, 0, 0, (a) => a * 0.25], [30, F.skyline, P.infrared, 0, 0, (a) => 0.5 + a * 0.2], [32, F.heat, P.ironbow], [34, F.tunnel, P.rainbow], [36, F.die, P.infrared], [38, F.sun, P.ironbow],
    [40, F.lattice, P.rainbow], [42, F.heat, P.ironbow], [44, F.die, P.ironbow], [46, F.grid, P.rainbow], [48, F.sun, P.ironbow],
    [52, F.tunnel, P.ironbow], [54, F.sun, P.ironbow], [56, F.crowd, P.ironbow, 0, 0, (a) => a * 0.2], [58, F.lattice, P.ironbow], [60, F.sun, P.rainbow], [64, F.corridor, P.turrell]] });
