// THE NIGHT OF 25 OCTOBER v2: the plan (no DOM; labs/nightprint/night25_dry2.mjs runs it in node). Everything is a pure function of t
// (seconds; the song is 60 BPM, so beats are seconds; the masses' time is 90 BPM: 2/3 s a beat, three in the clock's two).
// v1 (8 Oct, published) is in git history (96c07bb). v2 (15 Oct, c20) after the director's brief (videos/review/NIGHT_OF_25_OCTOBER_c20/NOTES.md)
// and the client's 15 Oct note (develop the scenes, fill the gaps, longer is welcome):
//   - the night print eased: a toe instead of a cliff, faces and crowds legible, no round masks except Eisenstein's own iris at 1:59;
//   - no dot-pair eyes anywhere (they were another piece's device): the masses are Eisenstein's lit faces and crowds, cut full frame;
//   - the minister's resolution and his name are gone: the sheeted room and the creeping hands carry "in continuous session";
//   - the turns of the years are a frame-filling Dial whose face is the crowd, lit more and more as the hour hand turns, and the words
//     say what the turns are (the Party's own: "despite having occurred over a century ago, the world has yet to recover from ...");
//   - the night lands in America now: the hands stop on 2:00 again over a room at two in the morning, a bare bulb low over a table, the
//     people there lit from below (scenes/night25_room.js, the person pipeline); then the hands run again.
// Two takes (setTake): 'a' the night in v1's order, landing in the room; 'b' opens in the room at 2:00 and spins back to 1917.
// c21 (15 Oct, the client: develop the scenes, fill the logical gaps, longer is welcome) develops take a, the spine (b's open on a black room
// lost frame 0 and the night's hook; its draft taught that the present only reads once the night has been seen):
//   - the gap at the landing: c20 stopped the hands on arrival in the room and then let them run, which read as "the night goes on" and
//     left the room unexplained. Now the turns of the years come to rest a few minutes BEFORE two, the hands run a minute a second over
//     the room (the old order's clock, every light on, the people up through the night) and stop dead on 2:00 over their faces: the same
//     held breath as 1917, and the masses' time (three against two) begins under the mark. The room is the minute before the hinge.
//   - the gap over the lantern march: Lenin's first half (WE MUST NOT ALLOW OURSELVES TO BE FRIGHTENED) sat over the Committee for
//     Salvation's faces, as if they said it. It now sits on the cruiser (our side), held long enough to read and printed so it reads as a
//     ship; the second half (BY THE SCREAMS OF THE FRIGHTENED BOURGEOISIE.) lands on the marchers, which names them.
// v3 (16 Oct, the coordinator's review of v2; the client: develop, fill the gaps, longer is welcome). Takes a (the grey plates) and c (the room live):
//   - the cruiser (10.4 s on): the plate played from the lamps into the gun's smoke (the signal), its print lifted until the hull, the water and the
//     smoke show (a numpy mirror of the print's curve: v2's 19% of the frame over .1 became about 50%); the shot is the Aurora's gun, not two lamps;
//   - the red '... HAS BEEN DEPOSED.' over the throne: the throne's print pulled down (a third of its frame was above .6) and a soft scrim under the line;
//   - the Dial (30-36 s): the face is the masses' own plates (procession, beard, shout, sailor, mouth, the crowd; v2's were the hall's chandeliers),
//     each played through once a turn, 3 cuts a second at most; a ring and twelve hour marks in the hands' cream, the night put back outside the ring;
//   - the room: take c draws it LIVE in colour (night25.room.js, a module; the person pipeline, B recast L03 for L23's hair stripes, C L06): the present
//     is the one colour in the piece. Take a keeps v2's grey plates (the safe sibling: a plate cut needs a farm render and a commit, and the farm takes one scene a job);
//   - the landing: 2.8 s longer. After the stop, THE NIGHT / HAS NOT ENDED. in red (our own present tense; the Party's text above it is a quotation);
//     the film credit at 50 px, two lines, on a scrim, held 4 s (was 30 px, 3 s). The score's tail follows (songs2/night25_v2.py: mark = stop + 7.4).
import { placeRect } from '../lib/fx/nightprint.js';

export const W = 1080, H = 1920, CX = 510;
export const B90 = 2 / 3, HP = 1.2;                                            // a beat of the masses' time; an hour of the night
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;
export const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const easeIO = u => (u = clamp(u), u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const easeOut = u => 1 - Math.pow(1 - clamp(u), 3);
export function hash01(i, j = 0) { let x = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263)) >>> 0; x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; }

// ------------------------------------------------------------------ placements
export const RECT = {
  full: { x: 0, y: 0, w: W, h: H },
  session: { x: -150, y: 520, w: 1380, h: 1035 },                              // the ministers' room: the whole width, a band in the night
  crowd: { x: -330, y: 0, w: 2560, h: 1920 },                                   // the Dial: Palace Square's running crowd, filling the frame
  aurora: { x: 0, y: 160, w: W, h: H },
};

// ------------------------------------------------------------------ the night print, eased: levels from each plate's own luma, a toe (a wide
// knee from near black), a gentle lift so the midtones live; high-key rooms darkened by gamma. No iris but the palace's.
const ease = (lo, hi, g = 1, o = {}) => ({ levels: [lo, hi, g], key: 0.36, knee: 0.33, lift: 1.35, floor: 0.012, ...o });
export const PRINT = {
  n25_shroud: ease(0.06, 0.99, 1.45),
  n25_session: ease(0.08, 0.95, 1.5, { feather: [0.04, 0.10, 0.04, 0.10] }),
  n25_ministers: ease(0.04, 0.92, 1.3),
  n25_aurora: ease(0.03, 0.38, 0.8, { key: 0.22, knee: 0.26, lift: 1.4 }),        // v3: the hull, the water and the gun's smoke come up (v2's key .30 left two lamps on black)
  n25_procession: ease(0.035, 0.66, 0.95),
  n25_beard: ease(0.035, 0.74, 0.95),
  n25_shout: ease(0.03, 0.84, 1.0),
  n25_mouth: ease(0.03, 0.82, 1.0),
  n25_sailor: ease(0.04, 0.46, 0.9, { keep: [[0.5, 0.42, 0.16, 1.0]] }),         // his eyes take the light on the strike (printAt)
  n25_iris: ease(0.035, 0.75, 1.0),
  n25_hall1: ease(0.03, 0.95, 1.0),
  n25_chand: ease(0.05, 0.9, 1.05),
  n25_crystal: ease(0.05, 0.97, 1.15),
  n25_shroud2: ease(0.12, 0.95, 1.6),
  n25_hall3: ease(0.02, 0.88, 1.0),
  n25_hall4: ease(0.05, 0.98, 1.15),
  n25_throne: ease(0.05, 1.0, 1.8, { key: 0.55, knee: 0.3, lift: 1.0 }),       // v3: was blown out under the red line (a third of the frame above .6)
  n25_midnight: ease(0.035, 0.36, 1.0),                                          // the Dial's crowd (its key falls as the turns pass: printAt)
  n25_now_wide: ease(0.0, 0.92, 1.0), n25_now_a: ease(0.0, 0.92, 1.0), n25_now_b: ease(0.0, 0.92, 1.0), n25_now_c: ease(0.0, 0.92, 1.0),
  n25_now_low: ease(0.0, 0.95, 1.0), n25_now_high: ease(0.0, 0.92, 1.0),
};
export const ROOM_SHOTS = ['n25_now_wide', 'n25_now_a', 'n25_now_b', 'n25_now_c', 'n25_now_low', 'n25_now_high'];

// ------------------------------------------------------------------ THE TAKES. Each: the timeline (TL), the cuts, the hands' keys, the words.
// Hands: H(t) is clock time in hours, unwrapped (12 midnight, 20 = 8 p.m., 26 = 2 a.m.); keys are [t0, t1, kind, ...].
export const YEARS_N = 109;                                                     // 1917 -> 2026 (no date is shown)
const ROOMCUTS = R => [
  [R, 'n25_now_wide', { off: 0.2, rate: 0.6, z: [1.0, 1.04] }],
  [R + 2.4, 'n25_now_b', { off: 0.3, rate: 0.6, z: [1.0, 1.03] }],
  [R + 4.4, 'n25_now_a', { off: 0.3, rate: 0.6, z: [1.0, 1.03] }],
  [R + 6.4, 'n25_now_low', { off: 0.2, rate: 0.6, z: [1.0, 1.03] }],
  [R + 8.6, 'n25_now_high', { off: 0.2, rate: 0.5, z: [1.0, 1.04] }],
];
const NIGHT = (T, M) => [
  [T.race, 'n25_aurora', { off: 0.9, rate: 0.6, z: [1.02, 1.1], rect: RECT.aurora }],   // v3: from the lamps into the gun's smoke (the signal)
  [T.nine, 'n25_procession', { off: 0.3, rate: 0.9, z: [1.03, 1.07] }],
  [T.ten, 'n25_beard', { off: 0.2, rate: 0.85, z: [1.03, 1.07] }],
  [T.eleven, 'n25_shout', { off: 0.0, rate: 0.8, z: [1.03, 1.07] }],
  [T.twelve, 'n25_mouth', { off: 0.0, rate: 0.55, z: [1.03, 1.08] }],
  [T.one, 'n25_sailor', { off: 0.1, rate: 0.9, z: [1.02, 1.06] }],
  [T.iris, 'n25_iris', { off: 1.75, rate: 1.0, z: [1.0, 1.0] }],
  [T.two, null, {}],                                                             // the held breath: black, the hands stopped
  [M, 'n25_hall1', { off: 0.1, rate: 0.8, z: [1.04, 1.1] }],
  [M + B90, 'n25_chand', { off: 0.1, rate: 0.8, z: [1.04, 1.1] }],
  [M + 2 * B90, 'n25_crystal', { off: 0.2, rate: 0.8, z: [1.04, 1.1] }],
  [M + 3 * B90, 'n25_shroud2', { off: 0.3, rate: 0.8, z: [1.04, 1.1] }],
  [M + 4 * B90, 'n25_hall3', { off: 0.2, rate: 0.85, z: [1.04, 1.1] }],
  [M + 5 * B90, 'n25_hall4', { off: 0.2, rate: 0.85, z: [1.04, 1.1] }],
  [M + 6 * B90, 'n25_session', { off: 1.6, rate: 0.6, z: [1.04, 1.08], rect: RECT.session }],
  [T.deposed, 'n25_throne', { off: 0.15, rate: 0.6, z: [1.02, 1.08] }],
];
const HOURS_T = T => { T.nine = T.eight + HP; T.ten = T.nine + HP; T.eleven = T.ten + HP; T.twelve = T.eleven + HP; T.one = T.twelve + HP; T.iris = T.one + 1.2; T.two = T.iris + 1.4;
  T.masses = T.two + 0.8; T.deposed = T.masses + 8 * B90; };
const NIGHT_KEYS = T => [
  [T.ministers - 0.3, T.ministers, 'ease', 10, 11.5],                           // to 11:30 on the cut, and creeping on: still in session
  [T.ministers, T.race, 'creep', 11.5, 0.06],
  [T.race, T.eight, 'ease', 11.5 + 0.06 * (T.race - T.ministers), 20],          // the afternoon gone in a turn: 8 p.m. on the cruiser's lamp
  [T.eight, T.one, 'hours', 20],                                                 // an hour a strike
  [T.one, T.iris, 'easeOut', 25, 25.1667],
  [T.iris, T.two, 'lin', 25.1667, 25.9833],                                      // riding the iris to 1:59
];
const WORLD = ['THE WORLD HAS YET TO RECOVER FROM', 'OR FULLY DRAW OUT THE IMPLICATIONS', 'OF THIS MONUMENTAL', 'AND DECISIVE PERIOD', 'OF MODERN HISTORY …'];
const CREDIT = ['PICTURE: OCTOBER,', 'EISENSTEIN AND ALEKSANDROV, 1928'];
export const RUN_MIN = 8;                                                      // a: the minutes before two, now (a second each)
function nightA(live = false) {
  // c21: the cruiser held long enough to read (our side's ground, under Lenin's first half); the hours from 8 p.m. a little later
  const T = { hook: 0, back: 3.4, session: 3.9, ministers: 7.4, race: 10.4, eight: 11.6 }; HOURS_T(T);
  // c21, the landing: the turns of the years come to rest a few minutes before two, now; the hands run a minute a second over the room
  // (every light on, the people up through the night) and stop dead on 2:00 over their faces: the same held breath, and the masses' time
  // begins under the mark. (c20 had the hands stopped on arrival and then running, which read as the night simply going on.)
  T.dial = T.deposed + 2.7; T.years = T.dial + 1.2; T.land = T.years + 7.0; T.stop = T.land + RUN_MIN; T.run = T.stop; T.mark = T.stop + 7.4; T.end = T.mark + 3.2; T.live = live;   // v3: 2.8 s longer: the line over the room, the credit read whole
  const R = T.land, NOW = 26 + 12 * YEARS_N;
  const cuts = [
    [T.hook, 'n25_shroud', { off: 0.2, rate: 0.6, z: [1.0, 1.06] }],
    [T.session, 'n25_session', { off: 0.1, rate: 0.55, z: [1.0, 1.04], rect: RECT.session }],
    [T.ministers, 'n25_ministers', { off: 0.0, rate: 0.5, z: [1.02, 1.08] }],
    ...NIGHT(T, T.masses),
    [T.dial, 'n25_midnight', { off: 0.1, rate: 0.35, z: [1.0, 1.12], rect: RECT.crowd, cy: 0.62, dial: true }],
    [R, 'n25_now_wide', { off: 0.2, rate: 0.6, z: [1.0, 1.04] }],
    [R + 2.6, 'n25_now_b', { off: 0.3, rate: 0.6, z: [1.0, 1.03] }],
    [R + 4.2, 'n25_now_low', { off: 0.2, rate: 0.6, z: [1.0, 1.04] }],
    [R + 6.0, 'n25_now_a', { off: 0.2, rate: 0.55, z: [1.0, 1.05] }],                 // the stop lands here, on her face lit from below
    [T.stop + 1.6, 'n25_now_high', { off: 0.2, rate: 0.4, z: [1.0, 1.04] }],
  ];
  const keys = [
    [0, T.back, 'hold', 12],
    [T.back, T.back + 0.45, 'ease', 12, 10],                                    // two turns back to the morning: 10:00
    [T.back + 0.45, T.ministers - 0.3, 'hold', 10],
    ...NIGHT_KEYS(T),
    [T.two, T.years, 'stop', 26],                                                // 2:00, stopped
    [T.years, T.land, 'years', 26, -RUN_MIN / 60],                               // the hour hand turns the years, to a few minutes before two
    [T.land, T.stop, 'run', NOW - RUN_MIN / 60],                                 // now: a minute a second, the clock's own pulse
    [T.stop, 1e9, 'stop', NOW],                                                  // 2:00, stopped: the same breath
  ];
  const LEN = [T.race + 0.25, T.nine + 0.2];
  const cues = [
    [T.hook, T.back, ['THE NIGHT OF'], 1180, 112, 'main'],
    [T.hook, T.back, ['25 OCTOBER 1917.'], 1317, 112, 'red'],
    [T.back + 0.45, T.ministers, ['THE PROVISIONAL', 'GOVERNMENT', 'HAS BEEN DEPOSED.'], 360, 88, 'main'],
    [LEN[0], T.nine - 0.05, ['WE MUST NOT', 'ALLOW OURSELVES', 'TO BE FRIGHTENED'], 1030, 84, 'main'],
    [LEN[1], T.one - 0.05, ['BY THE SCREAMS', 'OF THE FRIGHTENED', 'BOURGEOISIE.'], 1030, 84, 'main'],
    [T.deposed + 0.1, T.dial, ['… HAS BEEN DEPOSED.'], 430, 104, 'red'],
    [T.years + 1.0, T.land - 0.2, ['DESPITE HAVING OCCURRED', 'OVER A CENTURY AGO,'], 330, 76, 'main'],
    [R + 0.7, T.stop - 0.3, WORLD, 300, 60, 'main'],
    [T.stop + 1.0, T.stop + 5.2, ['THE NIGHT', 'HAS NOT ENDED.'], 330, 100, 'red'],   // v3: the landing in our own present tense (the Party's text above is a quotation)
  ];
  const subs = [
    [T.back + 0.45, T.ministers, 'REVOLUTIONARY MILITARY COMMITTEE · 10 A.M.', 228, 38],
    [LEN[0], T.one - 0.05, 'LENIN · 1 OCTOBER 1917', 905, 38],
    [R + 0.7, T.stop - 0.3, 'AMERICAN COMMUNIST PARTY · 2024', 680, 34],
    [T.stop + 3.4, T.mark, CREDIT[0], 1690, 50],                                 // v3: was one line at 30 px
    [T.stop + 3.4, T.mark, CREDIT[1], 1752, 50],
  ];
  const scrims = [[T.deposed + 0.05, T.dial, 330, 700, 0.62], [T.stop + 1.0, T.stop + 5.2, 200, 620, 0.5], [T.stop + 3.4, T.mark, 1610, 1860, 0.7]];
  return { T, cuts, keys, cues, subs, scrims };
}
function nightB() {
  const T = { hook: 0, back: 3.4, shroud: 5.6, session: 6.3, ministers: 9.4, race: 12.0, eight: 12.6 }; HOURS_T(T);
  T.land = T.deposed + 2.7; T.run = T.land + 6.4; T.mark = T.land + 11.9; T.end = T.mark + 3.0;
  T.dial = T.back; T.years = T.back;                                             // (b: the turns run backwards, at the start)
  const R = T.land, NOW = 26 + 12 * YEARS_N;
  const cuts = [
    [T.hook, 'n25_now_wide', { off: 0.2, rate: 0.6, z: [1.0, 1.04] }],
    [T.back, 'n25_midnight', { off: 0.1, rate: 0.35, z: [1.12, 1.0], rect: RECT.crowd, cy: 0.62, dial: true }],
    [T.shroud, 'n25_shroud', { off: 0.2, rate: 0.6, z: [1.0, 1.06] }],
    [T.session, 'n25_session', { off: 0.1, rate: 0.55, z: [1.0, 1.04], rect: RECT.session }],
    [T.ministers, 'n25_ministers', { off: 0.0, rate: 0.5, z: [1.02, 1.08] }],
    ...NIGHT(T, T.masses),
    ...ROOMCUTS(R).map((c, i) => i === 0 ? [c[0], c[1], { ...c[2], off: 2.6 }] : c),
  ];
  const keys = [
    [0, T.back, 'hold', NOW],                                                    // 2:00 now, stopped
    [T.back, T.shroud, 'yearsBack', NOW, 10],                                   // back through the years to 10 a.m., 25 October 1917
    [T.shroud, T.ministers - 0.3, 'hold', 10],
    ...NIGHT_KEYS(T),
    [T.two, T.land, 'stop', 26],
    [T.land, T.run, 'hold', NOW],                                                // the same 2:00, in the room
    [T.run, 1e9, 'run', NOW],
  ];
  const LEN = [T.nine - 0.25, T.eleven - 0.25];
  const cues = [
    [T.hook + 0.3, T.back, ['THE NIGHT OF'], 1180, 112, 'main'],
    [T.hook + 0.3, T.back, ['25 OCTOBER 1917.'], 1317, 112, 'red'],
    [T.session, T.ministers, ['THE PROVISIONAL', 'GOVERNMENT', 'HAS BEEN DEPOSED.'], 360, 88, 'main'],
    [LEN[0], LEN[1], ['WE MUST NOT', 'ALLOW OURSELVES', 'TO BE FRIGHTENED'], 1030, 84, 'main'],
    [LEN[1], T.one - 0.05, ['BY THE SCREAMS', 'OF THE FRIGHTENED', 'BOURGEOISIE.'], 1030, 84, 'main'],
    [T.deposed + 0.1, T.land, ['… HAS BEEN DEPOSED.'], 430, 104, 'red'],
    [R + 0.7, R + 3.4, ['DESPITE HAVING OCCURRED', 'OVER A CENTURY AGO,'], 330, 76, 'main'],
    [R + 3.4, R + 8.4, WORLD, 300, 60, 'main'],
  ];
  const subs = [
    [T.session, T.ministers, 'REVOLUTIONARY MILITARY COMMITTEE · 10 A.M.', 228, 38],
    [LEN[0], T.one - 0.05, 'LENIN · 1 OCTOBER 1917', 905, 38],
    [R + 3.4, R + 8.4, 'AMERICAN COMMUNIST PARTY · 2024', 680, 34],
    [R + 8.6, T.mark, CREDIT.join(' '), 1700, 40],
  ];
  return { T, cuts, keys, cues, subs };
}
export const TAKES = { a: () => nightA(false), b: nightB, c: () => nightA(true) };   // c: take a with the room drawn live (night25.room.js), in colour

// live bindings, set by setTake
let DIAL_IDX = null;
export let TAKE = 'a', TL = {}, CUT_LIST = [], KEYS = [], CUES = [], SUBS = [], SCRIMS = [];
export function setTake(k = 'a') {
  const S = TAKES[k](); TAKE = k; TL = S.T; CUT_LIST = S.cuts; KEYS = S.keys; CUES = S.cues; SUBS = S.subs; SCRIMS = S.scrims || []; DIAL_IDX = null;
  return S;
}
setTake('a');

// THE DIAL's face: the masses, a plate a turn of the hour hand (the years), never faster than a few cuts a second (the turns themselves go on
// into a blur; the faces keep a pace an eye can take). a: from the crowd in the hall forwards; b: the same, backwards into 1917.
// v3: the face is the masses' own plates (the hall's chandeliers and glass were not hours; the Dial read as mud), each played through once a turn
export const DIAL_PLATES = ['n25_procession', 'n25_beard', 'n25_shout', 'n25_sailor', 'n25_mouth', 'n25_midnight'];
const DIAL_CAP = 3;                                                              // cuts a second, at most
function dialIndexTable() {
  const c = CUT_LIST.find(x => x[2] && x[2].dial); if (!c) return null;
  const i = CUT_LIST.indexOf(c), t0 = c[0], t1 = i + 1 < CUT_LIST.length ? CUT_LIST[i + 1][0] : TL.mark, dt = 1 / 240, out = [];
  let acc = 0, prev = turnsAt(t0);
  for (let t = t0; t <= t1 + dt; t += dt) { const N = turnsAt(t); acc += Math.min(Math.abs(N - prev), DIAL_CAP * dt); prev = N; out.push(acc); }
  return { t0, dt, out };
}
function turnsAt(t) { if (TAKE !== 'b') return yearsAt(t); const u = clamp((t - TL.back) / (TL.shroud - TL.back)); return YEARS_N * (1 - Math.pow(1 - u, 3.2)); }
export function dialShot(t) {
  if (!DIAL_IDX) DIAL_IDX = dialIndexTable(); const D = DIAL_IDX; if (!D) return DIAL_PLATES[0];
  const k = Math.max(0, Math.min(D.out.length - 1, Math.round((t - D.t0) / D.dt)));
  const j = Math.floor(D.out[k]) % DIAL_PLATES.length; dialU = D.out[k] - Math.floor(D.out[k]); return DIAL_PLATES[TAKE !== 'b' ? j : DIAL_PLATES.length - 1 - j];
}
let dialU = 0;                                                                     // where in its turn the Dial's plate is (0..1): the plate plays through once a turn
export function cutAt(t) {
  let i = -1; for (let k = 0; k < CUT_LIST.length; k++) if (t >= CUT_LIST[k][0]) i = k;
  if (i < 0 || t >= TL.mark) return null;
  let [t0, shot, o] = CUT_LIST[i]; const t1 = i + 1 < CUT_LIST.length ? CUT_LIST[i + 1][0] : TL.mark;
  if (o.dial) { shot = dialShot(t); o = { ...o, dialU, rect: shot === 'n25_midnight' ? RECT.crowd : RECT.full, cy: shot === 'n25_midnight' ? 0.62 : 0.5 }; }
  const age = t - t0, u = clamp(age / Math.max(1e-3, t1 - t0));
  if (!shot) return { i, t0, t1, shot: null, o, age, u };
  return { i, t0, t1, shot, o, age, u, rect: o.rect || RECT.full, z: lerp(o.z[0], o.z[1], u) };
}
export function plateFrame(c, n, fps = 24) { if (c.o.dialU != null) return Math.max(0, Math.min(n - 1, Math.floor(c.o.dialU * (n - 1)))); return Math.max(0, Math.min(n - 1, Math.floor((c.o.off + c.age * c.o.rate) * fps))); }
export function placeOf(c) { return { rect: c.rect, z: c.z, cy: c.o.cy ?? 0.5 }; }

// the print for a cut at t: the plate's own, plus what moves in it (the sailor's eyes taking the light; the Dial's crowd coming up)
export function printAt(c, t) {
  const o = { ...PRINT[c.shot] };
  if (c.shot === 'n25_sailor' && o.keep) o.keep = o.keep.map(([x, y, r]) => [x, y, r, 1 + 0.9 * sstep(TL.one + 0.15, TL.one + 0.55, t)]);
  if (c.o.dial) {
    // the Dial: the crowd comes up out of the dark as the turns pass (a: forwards, filling; b: backwards, emptying into 1917's dark)
    const k = TAKE !== 'b' ? clamp(yearsAt(t) / YEARS_N + 0.15 * sstep(c.t0, TL.years, t)) : 1 - clamp((t - TL.back) / (TL.shroud - TL.back));
    const lv = o.levels || [0.03, 0.9, 1]; o.levels = [lv[0], lv[1] * lerp(1.7, 0.9, k), lv[2]];   // the faces come up out of the dark as the turns pass
    if (c.shot === 'n25_midnight') { o.levels = [0.035, lerp(0.42, 0.28, k), 1.0]; }
  }
  return o;
}
// the iris shot: the night print's own iris follows the film's lit disc and finishes the close (to nothing at 2:00)
export function irisPrint(c, track, frame) {
  const k = trackAt(track, frame), close = 1 - sstep(TL.two - 0.35, TL.two - 0.02, c.t0 + c.age);
  const dh = c.rect.h * c.z, dw = c.rect.w * c.z, r = Math.max(0.0005, k[2] * 1.08 * close);
  return [k[0], k[1], r * dh / dw, r, 0.18];
}
export function trackAt(track, f) {
  if (!track || !track.length) return null;
  if (f <= track[0][0]) return track[0].slice(1);
  for (let i = 1; i < track.length; i++) if (f <= track[i][0]) { const a = track[i - 1], b = track[i], u = (f - a[0]) / Math.max(1e-6, b[0] - a[0]); return [lerp(a[1], b[1], u), lerp(a[2], b[2], u), lerp(a[3], b[3], u)]; }
  return track[track.length - 1].slice(1);
}

// ------------------------------------------------------------------ THE HANDS
// the years: N(t) turns of the hour hand from 2:00, accelerating (N = r0 (e^{ks} - 1)/k), the last turns at F1's frequency (the score's tone)
const YR_END = 43.65;
function yearLaw(T) { const n = YEARS_N, f = r0 => r0 * Math.exp(T * (YR_END - r0) / n) - YR_END; let a = 0.2, b = 20;
  for (let i = 0; i < 80; i++) { const m = (a + b) / 2; if (f(m) > 0) b = m; else a = m; } const r0 = (a + b) / 2; return { r0, k: (YR_END - r0) / n, T }; }
export function yearsAt(t) {
  const key = KEYS.find(k => k[2] === 'years'); if (!key) return 0;
  const [t0, t1] = key; if (t <= t0) return 0; if (t >= t1) return YEARS_N; const L = yearLaw(t1 - t0), s = t - t0;
  return Math.min(YEARS_N - 1e-6, L.r0 * (Math.exp(L.k * s) - 1) / L.k);
}
export function yearTimes() { const key = KEYS.find(k => k[2] === 'years'); if (!key) return []; const L = yearLaw(key[1] - key[0]), out = [];
  for (let i = 1; i < YEARS_N; i++) out.push(key[0] + Math.log(1 + i * L.k / L.r0) / L.k); return out; }
function hOf(t) {
  for (const key of KEYS) {
    const [t0, t1, kind, a, b] = key; if (t < t0 || t >= t1) continue;
    const u = (t - t0) / Math.max(1e-6, t1 - t0);
    switch (kind) {
      case 'hold': return a;
      case 'ease': return lerp(a, b, easeIO(u));
      case 'easeOut': return lerp(a, b, easeOut((t - t0) / 0.8));
      case 'lin': return lerp(a, b, u);
      case 'creep': return a + b * (t - t0);
      case 'hours': { const k = Math.floor((t - t0) / HP), v = (t - t0) / HP - k; return a + k + easeIO((v - 0.75) / 0.25); }   // each hour lands on its strike
      case 'stop': { const f = Math.round((t - t0) * 30); return a + (f === 0 ? 0.035 : f === 1 ? -0.012 : 0); }
      case 'years': return a + (12 * YEARS_N + (b || 0)) * yearsAt(t) / YEARS_N;
      case 'yearsBack': { const s = 1 - Math.pow(1 - clamp(u), 3.2); return a - (a - b) * s; }   // fast at first, slowing into the morning
      case 'run': { const k = Math.floor(t - t0), v = t - t0 - k; return a + (k + easeOut(v / 0.12)) / 60; }
    }
  }
  return 12;
}
export function handsAt(t) { const h = hOf(t); return { h, hour: ((h % 12) + 12) % 12 / 12 * 360, minute: ((h % 1) + 1) % 1 * 360 }; }
export function handsSweep(t, dt = 1 / 30, shutter = 0.5) { const a = hOf(t - dt * shutter / 2), b = hOf(t + dt * shutter / 2); return { hour: (b - a) / 12 * 360, minute: (b - a) * 360 }; }

// where they sit: a cut's round light (reel.json "dial" [x, y, r] or "track": the sheet, the cruiser's lamp, the iris, the bulb); held over
// the faces (a dial on each, then and now); the frame itself on the Dial; the black of the held breath (where the iris closed)
export const DIAL_BIG = { x: 540, y: 1000, R: 470 };
export const FACES_AT = { x: CX, y: 640, R: 200 };
export const BREATH_AT = { x: 540, y: 905, R: 240 };
const FACE_SHOTS = new Set(['n25_procession', 'n25_beard', 'n25_shout', 'n25_mouth', 'n25_sailor', 'n25_now_a', 'n25_now_b', 'n25_now_c']);
let SHOTS = {};
export function setShots(shots) { SHOTS = shots || {}; }
function anchorOf(c, nOf) {
  const s = SHOTS[c.shot]; if (!s || (!s.dial && !s.track)) return null;
  const [x0, y0, dw, dh] = placeRect(placeOf(c), W, H);
  let d = s.dial; if (s.track) d = trackAt(s.track, plateFrame(c, nOf ? nOf(c.shot) : 1e9));
  return { x: x0 + d[0] * dw, y: y0 + d[1] * dh, R: d[2] * dh };
}
function anchorCut(c, nOf) {
  if (c.o.dial) return { ...DIAL_BIG, big: true };
  if (FACE_SHOTS.has(c.shot)) return { ...FACES_AT };
  return anchorOf(c, nOf);
}
export function anchorAt(t, nOf = null) {
  const c = cutAt(t);
  if (!c) return { ...BREATH_AT };
  if (!c.shot) { const prev = cutAt(c.t0 - 1e-4), a = prev && prev.shot ? anchorCut(prev, nOf) : null; return a ? { x: a.x, y: a.y, R: BREATH_AT.R } : { ...BREATH_AT }; }
  const a = anchorCut(c, nOf); if (a) return a;
  // no round light: hold where the last one left them
  for (let j = c.i - 1; j >= 0; j--) { const cj = cutAt(CUT_LIST[j + 1][0] - 1e-4); if (!cj || !cj.shot) break; const aj = anchorCut(cj, nOf); if (aj) return aj; }
  return { ...BREATH_AT };
}
export function handsAlpha(t) {
  // they go out on the throne (the old order's chair, deposed) and come back on the Dial / the room
  const c = cutAt(t); if (c && c.shot === 'n25_throne') return 1 - sstep(c.t0, c.t0 + 0.3, t);
  if (c && c.o.dial && TAKE !== 'b') return sstep(c.t0, c.t0 + 0.4, t);
  return 1;
}
export const handLen = (R, big = false) => { const r = big ? R : Math.min(300, Math.max(0, R)); return { minute: 0.92 * r, hour: 0.6 * r, width: big ? Math.min(2.2, r / 240) : Math.min(1.2, Math.max(0.55, r / 240)) }; };
export const TYPE_MAXW = 836;

// ------------------------------------------------------------------ THE GLOW: post.js, held down: a little bloom on what burns, no halation
export function look(t) {
  if (t >= TL.mark) return {};
  return {
    bloom: { amount: 0.22, threshold: 0.86, radius: 0.9, tint: [1, 0.95, 0.88] },
    halation: { amount: 0.0, tint: [1, 0.86, 0.66], threshold: 0.95 },
    grain: { amount: 0.5, chroma: 0, size: 1.6 }, vignette: { amount: 0.3, inner: 0.4, outer: 1.1 },
    type: { glow: 0.05, tint: [1, 0.9, 0.75], shadow: 0.28, grain: 0.2 },
  };
}
