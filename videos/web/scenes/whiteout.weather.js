// WHITEOUT (WINTER SHIFT ep.1): the timeline and the weather, as data (research/series/snowbelt/ep1_brief.md, "Timeline" and "Editing grammar").
// Pure: no three, no DOM, so the scene (whiteout.js), the engine's node checks (labs/whiteout/whiteout_test.mjs) and the score's onset report
// read the same numbers. Song: 64 BPM (beat 0.9375 s, bar 3.75 s); the closer beat is 70 (65.625 s); the video ends at 67.03.
export const BPM = 64, SPB = 60 / BPM, CLOSE_BEAT = 70, END = 67.03;
export const TL = { open: 0, w1: 3.72, ont: 3.62, w2: 7.32, us: 7.22, w3: 11.15, both: 11.05, w4: 14.55, houlton: 14.45,
  strike: 18.516, w5: 24.141, hours: 24.09, two: 25.078, nurse: 26.953, w6: 33.516, money1: 33.47, money2: 37.266,
  w7: 41.05, hinge: 41.05, turn: 45.0, marx: 45.234, act1: 48.52, program: 48.98, act2: 52.27, act3: 56.62,
  one: 56.95, rebuild: 60.47, w8: 64.4, name: 64.6, mark: 65.625, end: 67.03 };

// the weather's cuts (frames at 30 fps: in / hold / out). `at` = the swap; the hold is centred on it unless `hold0` is given (the hinge's
// white holds from the swap for a full bar). The last white has no swap and holds to the end. dmin is the nearest surface in either
// shot (m), measured by the scene at boot from its own geometry (these are the plan's values, checked against that measure).
export const CUTS = [
  { name: 'w1', at: TL.w1, inF: 6, holdF: 6, outF: 16, dmin: 2.6 },
  { name: 'w2', at: TL.w2, inF: 6, holdF: 6, outF: 16, dmin: 3.2 },
  { name: 'w3', at: TL.w3, inF: 6, holdF: 6, outF: 16, dmin: 3.2 },
  { name: 'w4', at: TL.w4, inF: 6, holdF: 6, outF: 16, dmin: 9.0 },
  { name: 'w5', at: TL.w5, inF: 6, holdF: 6, outF: 16, dmin: 9.0 },
  { name: 'w6', at: TL.w6, inF: 6, holdF: 6, outF: 16, dmin: 4.0 },
  { name: 'w7', at: TL.w7, inF: 6, holdF: 118, outF: 36, hold0: TL.w7, dmin: 4.0 },
  { name: 'w8', at: 64.0, inF: 12, toEnd: true, hold0: 64.4, dmin: 6.0, swap: false },
];
// the action cuts after the turn (no weather: the work cuts)
export const ACTION_CUTS = [TL.act1, TL.act2, TL.act3];

// the wind (m/s at 10 m, from the left of frame 0): a gust carries each white, then at the hinge it drops below the drifting threshold
// and stays there through the build; it rises once more for the last white
export const WIND = { dir: [1, 0, 0.12], keys: [
  [0, 11], [2.9, 12], [3.45, 19], [4.2, 13], [5.0, 11], [6.6, 12], [7.15, 18.5], [7.9, 12.5], [9.0, 11], [10.4, 12], [10.95, 18.5], [11.8, 12],
  [13.5, 11], [14.2, 17.5], [15.2, 11], [17, 10], [21, 10.5], [23.5, 12], [24.0, 17], [24.8, 11], [28, 10], [32.6, 12], [33.4, 18], [34.2, 12],
  [38, 12.5], [40.6, 16], [41.05, 19], [42.5, 9], [45.0, 5], [56, 4.5], [62, 6], [63.6, 12], [64.3, 16], [67.1, 14]] };
// the designed visibility (MOR, m) between the cuts
export const VIS = { keys: [[0, 150], [3.7, 150], [3.9, 170], [7.3, 190], [7.4, 180], [11.1, 200], [11.3, 220], [14.5, 220], [14.7, 320], [24.1, 300],
  [24.3, 260], [33.4, 260], [33.6, 200], [41.0, 180], [45.0, 600], [56.6, 600], [56.8, 750], [63.0, 700], [64.4, 400]] };
export const BLOW = { H: 3.0, k: 0.6, threshold: 7 };

// the words (verbatim; research/series/snowbelt/ep1_brief.md "Words"), as set: [t0, t1, [[line, cap px], ...], { y: first baseline, credit | source }].
// Schibsted Grotesk 900 is a wide face: at the brief's line breaks its long cards would fit 888 px only at a 34-75 px cap, so each card
// is broken at its phrases (never after an article where it can be helped) and set at the largest cap its region holds; every line
// was measured with the face's own advances and kerning (tracking -0.01 em) to fit 888 px. The scene checks each line again at run
// time and shrinks a card that would overflow. Ranged left at x 96; leading 1.04; ink #0B0B0B on the white.
const U = (cap, ...ls) => ls.map(l => [l, cap]);
export const CARDS = [
  [0.0, 3.42, U(118, 'CLOSED', 'TONIGHT.'), { y: 470 }],
  [3.62, 7.22, [...U(74, 'ONTARIO, 2024:', 'EMERGENCY', 'ROOMS CLOSED'), ['1,117 TIMES.', 100]], { y: 300, source: 'ONTARIO HEALTH COALITION' }],
  [7.22, 11.05, U(62, 'UNITED STATES,', 'SINCE 2005:', '197 RURAL', 'HOSPITALS', 'CLOSED OR', 'STOPPED', 'ADMITTING', 'PATIENTS.'), { y: 290, source: 'UNC SHEPS CENTER · OCT 2026' }],
  [11.05, 14.45, U(74, 'ON BOTH SIDES', 'OF THE BORDER.'), { y: 560 }],
  [14.45, 18.30, U(56, 'HOULTON, MAINE ·', 'ON THE NEW', 'BRUNSWICK BORDER'), { y: 1380 }],
  [18.516, 23.90, U(54, '…THE NURSES', 'ORGANIZED A 4 DAY', 'STRIKE TO MAINTAIN', 'AT LEAST 3', 'REGISTERED NURSES', 'IN THE ER', 'AT ALL TIMES.'), { y: 1240 }],
  [24.09, 26.80, U(92, 'FROM 11 P.M.', 'TO 9 A.M.:'), { y: 1330, two: { t: TL.two, text: 'TWO.', cap: 150 } }],
  [26.953, 33.42, U(56, 'WITHOUT AN', 'ADDITIONAL NURSE,', 'WHO WILL TAKE', 'CARE OF THE REST', 'OF THE PATIENTS', 'IN THE EMERGENCY', 'DEPARTMENT?'), { y: 1190, credit: 'AN ER NURSE, HOULTON · MAY 2026' }],
  [33.47, 37.20, U(62, 'WHEN', 'THE INTERESTS', 'OF MONEY ARE PUT', 'AT THE EXPENSE', 'OF THE PEOPLE,'), { y: 1300 }],
  [37.266, 41.00, U(62, 'WE MUST', 'BAND TOGETHER', 'TO GIVE OUR VOICE', 'AUTHORITY', 'OVER MONEY.'), { y: 1300 }],
  [41.05, 44.90, U(71, 'CARE IS', 'A BUILDING,', 'AND THE PEOPLE', 'IN IT.'), { y: 838 }],
  [45.234, 48.40, U(64, '…GRADUAL', 'ABOLITION OF ALL', 'THE DISTINCTION', 'BETWEEN TOWN', 'AND COUNTRY…'), { y: 300, credit: 'MARX AND ENGELS · 1848' }],
  [48.98, 52.20, U(53, '…THE CONSTRUCTION', 'OF NEW HEALTHCARE', 'FACILITIES', 'IN RURAL AREAS.'), { y: 300, credit: 'AMERICAN COMMUNIST PARTY · PROGRAM' }],
  [56.95, 60.30, U(56, 'THE WORKING CLASS', 'OF AMERICA', 'IS ONE PEOPLE,'), { y: 1300 }],
  [60.47, 64.20, U(56, '…WE PROVE THIS', 'EVERY DAY', 'IN OUR COLLECTIVE', 'EFFORTS', 'TO SURVIVE', 'AND REBUILD…'), { y: 1240, credit: 'ACP EXECUTIVE BOARD · OCT 2024' }],
];
export const TYPE = { x: 96, maxW: 888, lead: 1.04, capRatio: 1440 / 2048, track: -0.01, ink: '#0B0B0B', small: { cap: 30, track: 0.06 } };
// the sign-off on the last white: the mark (lib/closer.js drawMark, ACP red) over the name, three lines in the series face
export const NAME = { t: TL.name, lines: ['AMERICAN', 'COMMUNIST', 'PARTY'], cap: 84, y: 1040, mark: { x: 96, y: 640, size: 260 } };
